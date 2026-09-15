use super::{parse_session_file, Message, ParsedSession, SessionMeta};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionPage {
    pub messages: Vec<Message>,
    pub next_before: Option<i64>,
    /// Earlier delegation rows and turn boundaries, independent of paging.
    pub subagent_history: Vec<Message>,
}

/// Lock the db, run a parameterless query, and collect rows through `map_row`.
fn query_rows<T>(
    state: &crate::AppState,
    sql: &str,
    map_row: impl Fn(&rusqlite::Row<'_>) -> rusqlite::Result<T>,
) -> Result<Vec<T>, String> {
    let conn = state.db.0.lock();
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], map_row).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        match row {
            Ok(value) => out.push(value),
            Err(e) => eprintln!("[history] skipping undecodable row: {e}"),
        }
    }
    Ok(out)
}

/// Run a sessions-table mutation, then notify listeners.
fn mutate_sessions(
    state: &crate::AppState,
    sql: &str,
    params: impl rusqlite::Params,
) -> Result<(), String> {
    let conn = state.db.0.lock();
    conn.execute(sql, params).map_err(|e| e.to_string())?;
    drop(conn);
    state.sink.emit_sessions_changed();
    Ok(())
}

#[tauri::command]
pub fn list_sessions(state: tauri::State<'_, crate::AppState>) -> Result<Vec<SessionMeta>, String> {
    query_rows(
        &state,
        "SELECT s.engine, s.session_id, s.workspace_path, s.file_path, s.file_size, s.file_mtime_ms,
                s.title, s.preview, s.created_at, s.updated_at, s.message_count, s.pinned, s.custom_title,
                m.model, e.effort, p.provider_id
         FROM sessions s
         LEFT JOIN session_models m ON m.engine = s.engine AND m.session_id = s.session_id
         LEFT JOIN session_efforts e ON e.engine = s.engine AND e.session_id = s.session_id
         LEFT JOIN session_providers p ON p.engine = s.engine AND p.session_id = s.session_id
         ORDER BY COALESCE(s.updated_at, 0) DESC",
        |r| {
            Ok(SessionMeta {
                engine: r.get(0)?,
                session_id: r.get(1)?,
                workspace_path: r.get(2)?,
                file_path: r.get(3)?,
                file_size: r.get(4)?,
                file_mtime_ms: r.get(5)?,
                title: r.get(6)?,
                preview: r.get(7)?,
                created_at: r.get(8)?,
                updated_at: r.get(9)?,
                message_count: r.get(10)?,
                pinned: r.get::<_, i64>(11)? != 0,
                custom_title: r.get(12)?,
                model: r.get(13)?,
                effort: r.get(14)?,
                provider: r.get(15)?,
            })
        },
    )
}

/// Remember the model id a session ran, spelled as the picker spells it
/// ("provider/model"). The engine's transcript only carries the bare model
/// name, so this row is what keeps a session's provider and model across
/// clients and restarts — see [`SessionMeta::model`].
#[tauri::command]
pub fn remember_session_model(
    state: tauri::State<'_, crate::AppState>,
    engine: String,
    session_id: String,
    model: String,
) -> Result<(), String> {
    if model.trim().is_empty() {
        return Ok(());
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    state
        .db
        .remember_session_model(&engine, &session_id, &model, now)?;
    state.sink.emit_sessions_changed();
    Ok(())
}

/// Remember the reasoning effort a session ran, beside its model and for the
/// same reason — see [`SessionMeta::effort`].
#[tauri::command]
pub fn remember_session_effort(
    state: tauri::State<'_, crate::AppState>,
    engine: String,
    session_id: String,
    effort: String,
) -> Result<(), String> {
    if effort.trim().is_empty() {
        return Ok(());
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    state
        .db
        .remember_session_effort(&engine, &session_id, &effort, now)?;
    state.sink.emit_sessions_changed();
    Ok(())
}

/// Remember the in-app channel a session ran. Spawn injects env from this id
/// and never rewrites the CLI's own files — see [`SessionMeta::provider`].
#[tauri::command]
pub fn remember_session_provider(
    state: tauri::State<'_, crate::AppState>,
    engine: String,
    session_id: String,
    provider_id: String,
) -> Result<(), String> {
    if provider_id.trim().is_empty() {
        return Ok(());
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    state
        .db
        .remember_session_provider(&engine, &session_id, &provider_id, now)?;
    state.sink.emit_sessions_changed();
    Ok(())
}

fn session_file_path(
    db: &crate::db::Db,
    engine: &str,
    session_id: &str,
) -> Result<PathBuf, String> {
    let conn = db.0.lock();
    conn.query_row(
        "SELECT file_path FROM sessions WHERE engine=?1 AND session_id=?2",
        rusqlite::params![engine, session_id],
        |r| r.get::<_, String>(0),
    )
    .map(PathBuf::from)
    .map_err(|_| format!("session not found: {engine}/{session_id}"))
}

/// One cache entry: the parse plus the subagent fold over all its messages,
/// so paging cuts the fold at the page start instead of refolding the whole
/// prefix on every turn of the page. The fold derives from `parsed.messages`
/// alone, so it invalidates with the same stat key.
struct CachedSession {
    parsed: ParsedSession,
    fold: SubagentFold,
}

/// Parsed sessions keyed by (path, size, mtime_ms): paging re-slices a cached
/// parse instead of re-reading the file. Bounded two ways: 32 entries and a
/// ~128MB byte budget (image data URLs make entries heavy).
static PARSED_CACHE: LazyLock<Mutex<HashMap<(PathBuf, i64, i64), Arc<CachedSession>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static PARSED_CACHE_BYTES: LazyLock<Mutex<usize>> = LazyLock::new(|| Mutex::new(0));

const PARSED_CACHE_CAPACITY: usize = 32;
const PARSED_CACHE_BUDGET_BYTES: usize = 128 * 1024 * 1024;

/// Rough in-memory footprint of one parsed session (text + image payloads).
fn parsed_footprint(parsed: &ParsedSession) -> usize {
    parsed
        .messages
        .iter()
        .map(|m| {
            m.text.len()
                + m.images.iter().map(|i| i.len()).sum::<usize>()
                + m.ts.as_deref().map(str::len).unwrap_or(0)
                + 128
        })
        .sum()
}

fn cached_session(engine: &str, path: &Path) -> Result<Arc<CachedSession>, String> {
    let Some((size, mtime_ms)) = super::stat_signature(path) else {
        // Unstattable file: let the parse produce the real error.
        let parsed = parse_session_file(engine, path)?;
        let fold = subagent_fold(&parsed.messages);
        return Ok(Arc::new(CachedSession { parsed, fold }));
    };
    let key = (path.to_path_buf(), size, mtime_ms);
    if let Some(hit) = PARSED_CACHE.lock().map_err(|e| e.to_string())?.get(&key) {
        return Ok(Arc::clone(hit));
    }
    let parsed = parse_session_file(engine, path)?;
    let fold = subagent_fold(&parsed.messages);
    // The fold's cloned delegation rows count toward the budget too.
    let footprint = parsed_footprint(&parsed)
        + fold.iter().map(|(_, row)| row.text.len() + 128).sum::<usize>();
    let cached = Arc::new(CachedSession { parsed, fold });
    let mut cache = PARSED_CACHE.lock().map_err(|e| e.to_string())?;
    let mut bytes = PARSED_CACHE_BYTES.lock().map_err(|e| e.to_string())?;
    // Over budget or capacity: drop everything rather than evicting entries
    // one by one (pages are re-parseable, and scans are cheap by stat key).
    if cache.len() >= PARSED_CACHE_CAPACITY || *bytes + footprint > PARSED_CACHE_BUDGET_BYTES {
        cache.clear();
        *bytes = 0;
    }
    *bytes += footprint;
    cache.insert(key, Arc::clone(&cached));
    Ok(cached)
}

/// The fold over a whole session, each row tagged with the index of the
/// message whose processing emitted it: a delegation or boundary row tags its
/// own index, a user row tags the index of the delegation or boundary that
/// closes its turn, and the trailing unclosed user tags `usize::MAX`. Paging
/// cuts this at the page start — see `subagent_history_until`.
type SubagentFold = Vec<(usize, Message)>;

/// Keep the inputs the subagent fold consumes, not old chat bodies or tool output.
/// Turn boundaries remain so a reopened session never treats an old spawn as new.
fn subagent_fold(messages: &[Message]) -> SubagentFold {
    let mut rows = SubagentFold::new();
    let mut last_user = None;
    let mut needs_boundary = false;
    for (index, message) in messages.iter().enumerate() {
        if message.role == "user" {
            last_user = Some(message);
            continue;
        }
        let delegation = message.role == "tool" && is_subagent_history_tool(message);
        let boundary = needs_boundary && matches!(message.role.as_str(), "assistant" | "thinking");
        if !delegation && !boundary {
            continue;
        }
        if let Some(user) = last_user.take() {
            rows.push((index, subagent_history_row(user, false)));
        }
        rows.push((index, subagent_history_row(message, delegation)));
        needs_boundary = delegation;
    }
    if !rows.is_empty() {
        if let Some(user) = last_user {
            rows.push((usize::MAX, subagent_history_row(user, false)));
        }
    }
    rows
}

/// The fold of one prefix, kept for tests as the reference the cached
/// truncation is pinned against.
#[cfg(test)]
fn subagent_history(messages: &[Message]) -> Vec<Message> {
    subagent_fold(messages).into_iter().map(|(_, row)| row).collect()
}

/// Cut a full-session fold at `start`, byte-identical to folding
/// `messages[..start]` directly. Rows triggered before the cut keep the order
/// the prefix fold emits them in; the pending user at the cut is appended
/// exactly when the prefix fold would — its turn was never closed inside the
/// prefix (even when the full fold spends it on a delegation past the cut, or
/// a newer user replaces it and it never appears there at all).
fn subagent_history_until(messages: &[Message], fold: &SubagentFold, start: usize) -> Vec<Message> {
    let mut rows: Vec<Message> = fold
        .iter()
        .take_while(|(trigger, _)| *trigger < start)
        .map(|(_, row)| row.clone())
        .collect();
    if rows.is_empty() {
        return rows;
    }
    let Some(user_index) = messages[..start].iter().rposition(|m| m.role == "user") else {
        return rows;
    };
    // The pending user was already spent if a delegation or boundary closed
    // its turn inside the prefix; as the last user before the cut, any row
    // triggered between it and the cut closed its turn.
    let closed = fold
        .iter()
        .any(|(trigger, _)| user_index < *trigger && *trigger < start);
    if !closed {
        rows.push(subagent_history_row(&messages[user_index], false));
    }
    rows
}

fn is_subagent_history_tool(message: &Message) -> bool {
    if message.args.as_ref().is_some_and(|args| args.get("tasks").is_some() || args.get("ids").is_some()) {
        return true;
    }
    if message.result.as_ref().and_then(|result| result.get("details")).is_some_and(|details| {
        ["jobs", "peers", "progress"].iter().any(|key| details.get(key).is_some())
            || details.get("op").and_then(serde_json::Value::as_str) == Some("jobs")
    }) {
        return true;
    }
    let head = message.text.split('·').next().unwrap_or_default().trim().to_ascii_lowercase();
    let first = head.split(|c: char| c.is_whitespace() || c == '/' || c == '\\').next().unwrap_or_default().replace('-', "_");
    matches!(first.as_str(), "task" | "agent" | "spawn" | "spawn_agent" | "spawn_subagent"
        | "workflow" | "run_workflow" | "pipeline" | "dispatch" | "dispatch_agent" | "delegate")
        || ["spawn agent", "agent swarm", "agent_swarm", "workflow", "subagent"].iter().any(|name| head.contains(name))
}

fn subagent_history_row(message: &Message, delegation: bool) -> Message {
    Message {
        seq: message.seq,
        role: message.role.clone(),
        text: if delegation { message.text.clone() } else { String::new() },
        ts: None,
        path: None,
        args: if delegation { message.args.clone() } else { None },
        // Status snapshots and result presence matter; the full output still
        // lives in the paginated timeline and need not cross IPC twice.
        result: if delegation {
            message.result.as_ref().map(|result| match result.get("details") {
                Some(details) => serde_json::json!({ "details": details }),
                None => serde_json::Value::Bool(true),
            })
        } else { None },
        todos: None,
        usage: None,
        model: None,
        effort: None,
        duration_ms: None,
        images: Vec::new(),
    }
}

/// Sync body of `load_session_page` (parsing multi-MB session files must not
/// run on the IPC main thread).
fn load_session_page_blocking(
    db: &crate::db::Db,
    engine: &str,
    session_id: &str,
    limit: Option<usize>,
    before_seq: Option<i64>,
) -> Result<SessionPage, String> {
    let path = session_file_path(db, engine, session_id)?;
    let cached = cached_session(engine, &path)?;
    let limit = limit.unwrap_or(100).clamp(1, 500);
    let messages = &cached.parsed.messages;
    let (page, next_before, start) = match before_seq {
        Some(before) => {
            let end = messages
                .iter()
                .position(|m| m.seq >= before)
                .unwrap_or(messages.len());
            let start = end.saturating_sub(limit);
            let next = if start > 0 {
                messages.get(start).map(|m| m.seq)
            } else {
                None
            };
            (messages[start..end].to_vec(), next, start)
        }
        None => {
            let start = messages.len().saturating_sub(limit);
            let next = if start > 0 {
                messages.get(start).map(|m| m.seq)
            } else {
                None
            };
            (messages[start..].to_vec(), next, start)
        }
    };
    Ok(SessionPage {
        messages: page,
        next_before,
        subagent_history: subagent_history_until(messages, &cached.fold, start),
    })
}

#[tauri::command]
pub async fn load_session_page(
    state: tauri::State<'_, crate::AppState>,
    engine: String,
    session_id: String,
    limit: Option<usize>,
    before_seq: Option<i64>,
) -> Result<SessionPage, String> {
    let db = Arc::clone(&state.db);
    tauri::async_runtime::spawn_blocking(move || {
        load_session_page_blocking(&db, &engine, &session_id, limit, before_seq)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Remove the session's on-disk file/dir. kimi/grok wire files live under a
/// per-session dir — validated against the engine home before removal so a
/// corrupt/stale db row can never point remove_dir_all at an arbitrary tree.
/// Returns Ok when the disk state is gone (or wisely skipped), Err when the
/// removal failed — callers keep the db row on Err so a session cannot
/// "delete then resurrect" on the next scan.
fn delete_session_disk(engine: &str, path: &Path) -> Result<(), String> {
    match engine {
        "claude" | "codex" | "pi" | "omp" | "agy" | "qoder" | "qoder-cn" => {
            match std::fs::remove_file(path) {
                Ok(()) => Ok(()),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(e) => Err(format!("remove {}: {e}", path.display())),
            }
        },
        // opencode: the db row points at `storage/session/<project>/<id>.json`;
        // the transcript also lives in `storage/message/<id>/` and one
        // `storage/part/<msg>/` dir per message — all under the same storage root.
        "opencode" => delete_opencode_session_disk(path),
        _ => {
            // kimi: .../<sessionDir>/agents/main/wire.jsonl -> <sessionDir>
            // grok: .../<sessionDir>/chat_history.jsonl -> <sessionDir>
            let Some(session_dir) = (if engine == "kimi" {
                path.parent()
                    .and_then(|p| p.parent())
                    .and_then(|a| a.parent())
            } else {
                path.parent()
            }) else {
                return Err(format!("no session dir for {}", path.display()));
            };
            let home = crate::engine::engine_home(
                None,
                if engine == "kimi" {
                    ".kimi-code"
                } else {
                    ".grok"
                },
            );
            let anchored = crate::files::canonicalize_lenient(session_dir)
                .map(|resolved| {
                    crate::files::canonicalize_lenient(&home)
                        .map(|root| resolved.starts_with(root))
                        .unwrap_or(false)
                })
                .unwrap_or(false);
            // Kimi dirs must show the expected agents/main/wire.jsonl shape.
            let structure_ok = if engine == "kimi" {
                session_dir
                    .join("agents")
                    .join("main")
                    .join("wire.jsonl")
                    .is_file()
            } else {
                session_dir.join("chat_history.jsonl").is_file()
            };
            if !anchored || !structure_ok {
                eprintln!(
                    "[history] refusing disk delete outside {} home or unexpected layout: {}",
                    engine,
                    session_dir.display()
                );
                return Ok(());
            }
            match std::fs::remove_dir_all(session_dir) {
                Ok(()) => Ok(()),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(e) => Err(format!("remove {}: {e}", session_dir.display())),
            }
        }
    }
}

/// Remove one OpenCode session's storage tree: the metadata file (`path` =
/// `…/storage/session/<project>/<id>.json`), the `storage/message/<id>/`
/// dir, and the `storage/part/<msg>/` dirs of its messages. The layout check
/// (`…/storage/session/*/*.json`) anchors the removal so a corrupt db row
/// can never point remove_dir_all at an arbitrary tree — same guard as the
/// kimi/grok arm above.
fn delete_opencode_session_disk(path: &Path) -> Result<(), String> {
    let session_id = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
    let storage = path
        .parent()
        .and_then(|project| project.parent())
        .filter(|session_root| session_root.file_name().and_then(|n| n.to_str()) == Some("session"))
        .and_then(|session_root| session_root.parent());
    let structure_ok = session_id.starts_with("ses_")
        && path.extension().and_then(|e| e.to_str()) == Some("json")
        && storage.is_some_and(|root| root.join("session").is_dir());
    let Some(storage) = storage.filter(|_| structure_ok) else {
        eprintln!(
            "[history] refusing opencode disk delete outside storage/session layout: {}",
            path.display()
        );
        return Ok(());
    };
    // Part dirs are keyed by message id, so collect them before the message
    // dir goes away.
    let message_dir = storage.join("message").join(session_id);
    let mut message_ids: Vec<std::ffi::OsString> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&message_dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.extension().and_then(|e| e.to_str()) == Some("json") {
                if let Some(stem) = p.file_stem() {
                    message_ids.push(stem.to_os_string());
                }
            }
        }
    }
    match std::fs::remove_file(path) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(format!("remove {}: {e}", path.display())),
    }
    if message_dir.is_dir() {
        std::fs::remove_dir_all(&message_dir)
            .map_err(|e| format!("remove {}: {e}", message_dir.display()))?;
    }
    for id in message_ids {
        let part_dir = storage.join("part").join(&id);
        if part_dir.is_dir() {
            std::fs::remove_dir_all(&part_dir)
                .map_err(|e| format!("remove {}: {e}", part_dir.display()))?;
        }
    }
    Ok(())
}

/// Sync body of `delete_session` (disk + db work off the main thread).
fn delete_session_blocking(
    db: &crate::db::Db,
    engine: &str,
    session_id: &str,
) -> Result<(), String> {
    let path = session_file_path(db, engine, session_id)?;
    delete_session_disk(engine, &path)?;
    let conn = db.0.lock();
    conn.execute(
        "DELETE FROM sessions WHERE engine=?1 AND session_id=?2",
        rusqlite::params![engine, session_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn delete_session(
    state: tauri::State<'_, crate::AppState>,
    engine: String,
    session_id: String,
) -> Result<(), String> {
    let db = Arc::clone(&state.db);
    let sink = Arc::clone(&state.sink);
    tauri::async_runtime::spawn_blocking(move || {
        delete_session_blocking(&db, &engine, &session_id)
    })
    .await
    .map_err(|e| e.to_string())??;
    sink.emit_sessions_changed();
    Ok(())
}

#[tauri::command]
pub fn pin_session(
    state: tauri::State<'_, crate::AppState>,
    engine: String,
    session_id: String,
    pinned: bool,
) -> Result<(), String> {
    mutate_sessions(
        &state,
        "UPDATE sessions SET pinned=?3 WHERE engine=?1 AND session_id=?2",
        rusqlite::params![engine, session_id, pinned as i64],
    )
}

#[tauri::command]
pub fn rename_session(
    state: tauri::State<'_, crate::AppState>,
    engine: String,
    session_id: String,
    title: String,
) -> Result<(), String> {
    let value = if title.trim().is_empty() {
        None
    } else {
        Some(title.trim().to_string())
    };
    mutate_sessions(
        &state,
        "UPDATE sessions SET custom_title=?3 WHERE engine=?1 AND session_id=?2",
        rusqlite::params![engine, session_id, value],
    )
}

#[tauri::command]
pub fn rescan_sessions(state: tauri::State<'_, crate::AppState>) {
    super::scanner::spawn_scan(Arc::clone(&state.db), Arc::clone(&state.sink));
}

// ==================== Workspaces ====================

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub id: String,
    pub path: String,
    pub name: String,
    pub last_opened_at: Option<i64>,
    pub sort_order: Option<i64>,
    /// Sidebar group (工作区分组) this workspace belongs to; None = ungrouped.
    pub group_id: Option<String>,
}

#[tauri::command]
pub fn list_workspaces(state: tauri::State<'_, crate::AppState>) -> Result<Vec<Workspace>, String> {
    query_rows(
        &state,
        "SELECT id, path, name, last_opened_at, sort_order, group_id FROM workspaces
         ORDER BY sort_order IS NULL, sort_order, COALESCE(last_opened_at, 0) DESC",
        |r| {
            Ok(Workspace {
                id: r.get(0)?,
                path: r.get(1)?,
                name: r.get(2)?,
                last_opened_at: r.get(3)?,
                sort_order: r.get(4)?,
                group_id: r.get(5)?,
            })
        },
    )
}

#[tauri::command]
pub fn add_workspace(
    state: tauri::State<'_, crate::AppState>,
    path: String,
) -> Result<Workspace, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("empty path".to_string());
    }
    let dir = std::path::PathBuf::from(trimmed);
    if !dir.is_dir() {
        return Err(format!("not a directory: {trimmed}"));
    }
    let name = dir
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(trimmed)
        .to_string();
    let id = uuid::Uuid::new_v4().to_string();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    {
        let conn = state.db.0.lock();
        conn.execute(
            "INSERT INTO workspaces(id, path, name, last_opened_at) VALUES(?1,?2,?3,?4)
             ON CONFLICT(path) DO UPDATE SET last_opened_at=excluded.last_opened_at",
            rusqlite::params![id, trimmed, name, now],
        )
        .map_err(|e| e.to_string())?;
    }
    super::scanner::spawn_scan(Arc::clone(&state.db), Arc::clone(&state.sink));
    Ok(Workspace {
        id,
        path: trimmed.to_string(),
        name,
        last_opened_at: Some(now),
        sort_order: None,
        group_id: None,
    })
}

/// Assign a workspace to a sidebar group (None = ungrouped). The group must
/// exist in app settings so a deleted group never lingers on a row.
#[tauri::command]
pub fn set_workspace_group(
    state: tauri::State<'_, crate::AppState>,
    id: String,
    group_id: Option<String>,
) -> Result<(), String> {
    if let Some(gid) = group_id.as_deref() {
        let exists = crate::settings::read_settings()?
            .workspace_groups
            .iter()
            .any(|g| g.id == gid);
        if !exists {
            return Err(format!("unknown group: {gid}"));
        }
    }
    let conn = state.db.0.lock();
    conn.execute(
        "UPDATE workspaces SET group_id=?2 WHERE id=?1",
        rusqlite::params![id, group_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn reorder_workspaces(
    state: tauri::State<'_, crate::AppState>,
    ids: Vec<String>,
) -> Result<(), String> {
    let conn = state.db.0.lock();
    for (index, id) in ids.iter().enumerate() {
        conn.execute(
            "UPDATE workspaces SET sort_order=?2 WHERE id=?1",
            rusqlite::params![id, index as i64],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn remove_workspace(
    state: tauri::State<'_, crate::AppState>,
    id: String,
) -> Result<(), String> {
    let conn = state.db.0.lock();
    let path: Option<String> = conn
        .query_row(
            "SELECT path FROM workspaces WHERE id=?1",
            rusqlite::params![id],
            |r| r.get(0),
        )
        .ok();
    conn.execute("DELETE FROM workspaces WHERE id=?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    if let Some(path) = path {
        conn.execute(
            "DELETE FROM sessions WHERE workspace_path=?1",
            rusqlite::params![path],
        )
        .map_err(|e| e.to_string())?;
    }
    drop(conn);
    state.sink.emit_sessions_changed();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    struct Scratch(PathBuf);
    impl Scratch {
        fn new() -> Self {
            let dir = std::env::temp_dir().join(format!("ccgui-history-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
    }
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn session_page_restores_subagents_older_than_the_visible_page() {
        let scratch = Scratch::new();
        let path = scratch.0.join("session.jsonl");
        let db_path = scratch.0.join("app.db");
        let brief = "# Target\nReview the relay.\n# Acceptance\nRecover without toggling.";
        let mut lines = vec![
            json!({"type":"message","message":{"role":"user","content":"Review"}}),
            json!({"type":"message","message":{"role":"assistant","content":[{
                "type":"toolCall","id":"dispatch","name":"task",
                "arguments":{"tasks":[{"name":"SavedReviewer","agent":"reviewer","task":brief}]}
            }]}}),
            json!({"type":"message","message":{"role":"toolResult","toolCallId":"dispatch",
                "content":[{"type":"text","text":"Spawned"}],
                "details":{"progress":[{"id":"SavedReviewer","status":"pending"}]}
            }}),
            json!({"type":"message","message":{"role":"assistant","content":[{
                "type":"toolCall","id":"roster","name":"hub","arguments":{"op":"jobs"}
            }]}}),
            json!({"type":"message","message":{"role":"toolResult","toolCallId":"roster",
                "content":[{"type":"text","text":"Review complete"}],
                "details":{"op":"jobs","jobs":[{"id":"SavedReviewer","status":"completed"}]}
            }}),
        ];
        for i in 0..120 {
            lines.push(json!({"type":"message","message":{"role":"assistant","content":format!("later {i}")}}));
        }
        std::fs::write(&path, lines.iter().map(serde_json::Value::to_string).collect::<Vec<_>>().join("\n")).unwrap();
        {
            let db = crate::db::Db::open_at(&db_path).unwrap();
            db.0.lock().execute(
                "INSERT INTO sessions(engine,session_id,workspace_path,file_path,file_size,file_mtime_ms,title) VALUES('omp','saved','/ws',?1,1,1,'Review')",
                rusqlite::params![path.to_string_lossy().as_ref()],
            ).unwrap();
        }
        // Reopen the DB as a fresh process would, with no frontend roster cache.
        let db = crate::db::Db::open_at(&db_path).unwrap();
        let page = load_session_page_blocking(&db, "omp", "saved", Some(100), None).unwrap();
        assert_eq!(page.messages.len(), 100);
        assert!(page.messages.iter().all(|message| message.text.starts_with("later")));
        let wire = serde_json::to_value(&page).unwrap();
        let history = wire["subagentHistory"].as_array().expect("session history is independent of pagination");
        let task = history.iter().find(|row| row["text"] == "task").unwrap();
        assert_eq!(task["args"]["tasks"][0]["name"], "SavedReviewer");
        assert_eq!(task["args"]["tasks"][0]["task"], brief);
        let roster = history.iter().find(|row| row["text"] == "hub").unwrap();
        assert_eq!(roster["result"]["details"]["jobs"][0]["status"], "completed");
        let older = load_session_page_blocking(&db, "omp", "saved", Some(100), page.next_before).unwrap();
        assert!(older.messages.iter().any(|row| row.text == "task"));
    }

    fn plain(seq: i64, role: &str) -> Message {
        Message {
            seq,
            role: role.into(),
            text: String::new(),
            ts: None,
            path: None,
            args: None,
            result: None,
            todos: None,
            usage: None,
            model: None,
            effort: None,
            duration_ms: None,
            images: Vec::new(),
        }
    }

    fn delegation(seq: i64) -> Message {
        let mut message = plain(seq, "tool");
        message.text = "task · worker".into();
        message.args = Some(json!({"tasks": []}));
        message
    }

    /// Cutting the cached full fold at a page start must reproduce a fresh
    /// fold of that prefix byte for byte — including the pending-user row
    /// that the full fold spends past the cut, and one a newer user replaces
    /// so it never appears in the full fold at all.
    #[test]
    fn truncated_fold_matches_a_fresh_prefix_fold() {
        let messages = vec![
            plain(0, "user"),       // closed by the delegation at 1
            delegation(1),          // emits user 0 + itself
            plain(2, "assistant"),  // turn boundary
            plain(3, "user"),       // replaced by user 4: absent from the full fold
            plain(4, "user"),       // closed by the delegation at 5
            delegation(5),
            plain(6, "user"),       // spent past the cut by the boundary at 7
            plain(7, "thinking"),   // turn boundary, emits user 6
            plain(8, "user"),       // trailing unclosed user
            plain(9, "assistant"),  // no boundary: follows a boundary, not a delegation
        ];
        let fold = subagent_fold(&messages);
        for start in 0..=messages.len() {
            let cut = serde_json::to_value(subagent_history_until(&messages, &fold, start)).unwrap();
            let fresh = serde_json::to_value(subagent_history(&messages[..start])).unwrap();
            assert_eq!(cut, fresh, "start={start}");
        }
    }

    /// qoder sessions are a single jsonl — the plain remove_file arm.
    #[test]
    fn delete_qoder_removes_single_file() {
        let scratch = Scratch::new();
        let path = scratch.0.join("sess-1.jsonl");
        std::fs::write(&path, "{}\n").unwrap();
        delete_session_disk("qoder", &path).unwrap();
        assert!(!path.exists());
    }

    /// opencode spreads a session over session/message/part; deleting the
    /// metadata file must take the message dir and its part dirs, and leave
    /// other sessions' trees alone.
    #[test]
    fn delete_opencode_removes_storage_tree() {
        let scratch = Scratch::new();
        let storage = scratch.0.join("data").join("storage");
        let meta = storage.join("session").join("proj1").join("ses_x.json");
        std::fs::create_dir_all(meta.parent().unwrap()).unwrap();
        std::fs::write(&meta, "{}").unwrap();
        let msg_dir = storage.join("message").join("ses_x");
        std::fs::create_dir_all(&msg_dir).unwrap();
        std::fs::write(msg_dir.join("msg_1.json"), "{}").unwrap();
        let part_dir = storage.join("part").join("msg_1");
        std::fs::create_dir_all(&part_dir).unwrap();
        std::fs::write(part_dir.join("prt_1.json"), "{}").unwrap();
        let other_part_dir = storage.join("part").join("msg_other");
        std::fs::create_dir_all(&other_part_dir).unwrap();
        std::fs::write(other_part_dir.join("prt_9.json"), "{}").unwrap();

        delete_session_disk("opencode", &meta).unwrap();
        assert!(!meta.exists());
        assert!(!msg_dir.exists());
        assert!(!part_dir.exists());
        assert!(other_part_dir.exists());
    }

    /// A path outside the storage/session layout is refused (db corruption
    /// must never aim remove_dir_all at an arbitrary tree).
    #[test]
    fn delete_opencode_refuses_unexpected_layout() {
        let scratch = Scratch::new();
        let stray = scratch.0.join("random").join("ses_x.json");
        std::fs::create_dir_all(stray.parent().unwrap()).unwrap();
        std::fs::write(&stray, "{}").unwrap();
        delete_session_disk("opencode", &stray).unwrap();
        assert!(stray.exists());
    }
}
