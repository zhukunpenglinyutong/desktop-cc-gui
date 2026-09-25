use super::{parse_session_file, Message, ParsedSession, SessionMeta};
use base64::Engine as _;
use rusqlite::OptionalExtension;
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
         WHERE NOT EXISTS (
             SELECT 1 FROM session_archives a
             WHERE a.engine = s.engine AND a.session_id = s.session_id
         )
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
                remote: None,
                remote_path: None,
            })
        },
    )
}

fn list_archived_sessions_from(db: &crate::db::Db) -> Result<Vec<SessionMeta>, String> {
    let conn = db.0.lock();
    let mut stmt = conn
        .prepare("SELECT snapshot_json FROM session_archives ORDER BY archived_at DESC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        match row {
            Ok(json) => match serde_json::from_str::<SessionMeta>(&json) {
                Ok(session) => out.push(session),
                Err(e) => eprintln!("[history] skipping corrupt archive snapshot: {e}"),
            },
            Err(e) => eprintln!("[history] skipping unreadable archive row: {e}"),
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn list_archived_sessions(
    state: tauri::State<'_, crate::AppState>,
) -> Result<Vec<SessionMeta>, String> {
    list_archived_sessions_from(&state.db)
}

fn archive_session_in(db: &crate::db::Db, session: &SessionMeta) -> Result<(), String> {
    if session.engine.trim().is_empty()
        || session.session_id.trim().is_empty()
        || session.workspace_path.trim().is_empty()
    {
        return Err("archive_session: engine, sessionId and workspacePath are required".into());
    }
    let snapshot = serde_json::to_string(session).map_err(|e| e.to_string())?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    let conn = db.0.lock();
    conn.execute(
        "INSERT INTO session_archives(engine, session_id, workspace_path, snapshot_json, archived_at)
         VALUES(?1,?2,?3,?4,?5)
         ON CONFLICT(engine, session_id) DO UPDATE SET
           workspace_path=excluded.workspace_path,
           snapshot_json=excluded.snapshot_json,
           archived_at=excluded.archived_at",
        rusqlite::params![
            session.engine,
            session.session_id,
            session.workspace_path,
            snapshot,
            now
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn archive_session(
    state: tauri::State<'_, crate::AppState>,
    session: SessionMeta,
) -> Result<(), String> {
    archive_session_in(&state.db, &session)?;
    state.sink.emit_sessions_changed();
    Ok(())
}

fn restore_session_in(db: &crate::db::Db, engine: &str, session_id: &str) -> Result<(), String> {
    let conn = db.0.lock();
    conn.execute(
        "DELETE FROM session_archives WHERE engine=?1 AND session_id=?2",
        rusqlite::params![engine, session_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn restore_session(
    state: tauri::State<'_, crate::AppState>,
    engine: String,
    session_id: String,
) -> Result<(), String> {
    restore_session_in(&state.db, &engine, &session_id)?;
    state.sink.emit_sessions_changed();
    Ok(())
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
    // Same standard as run ids (send_message_inner): bounded length and a
    // channel-id charset (plugin-prefixed ids use alnum/-/_; dots tolerated
    // for hand-written configs). A hand-edited db must not smuggle odd keys
    // into downstream lookups.
    if engine.trim().is_empty() || engine.len() > 64 {
        return Err("invalid engine".into());
    }
    if session_id.trim().is_empty() || session_id.len() > 256 {
        return Err("invalid session id".into());
    }
    if provider_id.len() > 128
        || !provider_id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b'.'))
    {
        return Err("invalid provider id".into());
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
    find_session_file_path(db, engine, session_id)?
        .ok_or_else(|| format!("session not found: {engine}/{session_id}"))
}

fn find_session_file_path(
    db: &crate::db::Db,
    engine: &str,
    session_id: &str,
) -> Result<Option<PathBuf>, String> {
    let conn = db.0.lock();
    conn.query_row(
        "SELECT file_path FROM sessions WHERE engine=?1 AND session_id=?2",
        rusqlite::params![engine, session_id],
        |r| r.get::<_, String>(0),
    )
    .optional()
    .map(|path| path.map(PathBuf::from))
    .map_err(|e| format!("lookup session {engine}/{session_id}: {e}"))
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

/// Rough in-memory footprint of one parsed session. Text and images used to
/// be the whole story, but tool-result-heavy sessions keep most of their
/// bytes in retained payloads: an hourly task's omp transcript measured
/// 28MB of `result.details` against 18MB of chat text, so a text-only sum
/// lets the 128MB budget admit multiples of itself.
fn value_footprint(value: &serde_json::Value) -> usize {
    match value {
        serde_json::Value::String(s) => s.len(),
        serde_json::Value::Array(items) => {
            items.iter().map(value_footprint).sum::<usize>() + items.len() * 32
        }
        serde_json::Value::Object(map) => map
            .iter()
            .map(|(k, v)| k.len() + value_footprint(v) + 32)
            .sum::<usize>(),
        _ => 8,
    }
}

fn todo_footprint(todos: &crate::engine::TodosPayload) -> usize {
    todos
        .items
        .iter()
        .map(|i| i.content.len() + i.status.len() + i.id.as_deref().map(str::len).unwrap_or(0) + 32)
        .sum()
}

fn message_footprint(m: &Message) -> usize {
    m.text.len()
        + m.images.iter().map(|i| i.len()).sum::<usize>()
        + m.ts.as_deref().map(str::len).unwrap_or(0)
        + m.path.as_deref().map(str::len).unwrap_or(0)
        + m.model.as_deref().map(str::len).unwrap_or(0)
        + m.effort.as_deref().map(str::len).unwrap_or(0)
        + m.args.as_ref().map(value_footprint).unwrap_or(0)
        + m.result.as_ref().map(value_footprint).unwrap_or(0)
        + m.usage.as_ref().map(value_footprint).unwrap_or(0)
        + m.todos.as_ref().map(todo_footprint).unwrap_or(0)
        + 128
}

fn parsed_footprint(parsed: &ParsedSession) -> usize {
    parsed.messages.iter().map(message_footprint).sum()
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
        + fold
            .iter()
            .map(|(_, row)| message_footprint(row))
            .sum::<usize>();
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
    subagent_fold(messages)
        .into_iter()
        .map(|(_, row)| row)
        .collect()
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
    if message.todos.is_some() {
        return true;
    }
    if message.args.as_ref().is_some_and(|args| {
        args.get("tasks").is_some()
            || args.get("ids").is_some()
            || args.get("todos").is_some()
            || args.get("op").is_some()
    }) {
        return true;
    }
    if message.result.as_ref().and_then(|result| result.get("details")).is_some_and(|details| {
        ["jobs", "peers", "progress", "phases"].iter().any(|key| details.get(key).is_some())
            || details.get("op").and_then(serde_json::Value::as_str) == Some("jobs")
    }) {
        return true;
    }
    let head = message.text.split('·').next().unwrap_or_default().trim().to_ascii_lowercase();
    let first = head.split(|c: char| c.is_whitespace() || c == '/' || c == '\\').next().unwrap_or_default().replace('-', "_");
    matches!(first.as_str(), "task" | "agent" | "spawn" | "spawn_agent" | "spawn_subagent"
        | "workflow" | "run_workflow" | "pipeline" | "dispatch" | "dispatch_agent" | "delegate" | "todo")
        || ["spawn agent", "agent swarm", "agent_swarm", "workflow", "subagent", "todo"].iter().any(|name| head.contains(name))
}

fn subagent_history_row(message: &Message, delegation: bool) -> Message {
    Message {
        seq: message.seq,
        role: message.role.clone(),
        text: if delegation {
            message.text.clone()
        } else {
            String::new()
        },
        ts: None,
        path: None,
        args: if delegation {
            message.args.clone()
        } else {
            None
        },
        // Status snapshots and result presence matter; the full output still
        // lives in the paginated timeline and need not cross IPC twice.
        result: if delegation {
            message.result.as_ref().map(|result| match result.get("details") {
                Some(details) => serde_json::json!({ "details": details }),
                None => serde_json::Value::Bool(true),
            })
        } else { None },
        todos: if delegation { message.todos.clone() } else { None },
        usage: None,
        model: None,
        effort: None,
        duration_ms: None,
        images: Vec::new(),
    }
}

/// Slice a cached parse into a page (shared by local and remote loaders).
fn page_from_cached(
    cached: &CachedSession,
    limit: Option<usize>,
    before_seq: Option<i64>,
) -> SessionPage {
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
    SessionPage {
        messages: page,
        next_before,
        subagent_history: subagent_history_until(messages, &cached.fold, start),
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
    Ok(page_from_cached(&cached, limit, before_seq))
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

/// 远程会话路径形状白名单。本地等价物 session_file_path 只认 db 登记的
/// 引擎 home 内文件;远程会话没有 db 行(remotePath 由插件会话源上报),
/// 用「绝对 .jsonl + 落在该引擎已知会话目录形态」收口,挡住借 IPC 读
/// 发行版内任意 .jsonl 文件。
fn is_plausible_remote_session_path(engine: &str, path: &str) -> bool {
    // dsh 转录本是 zstd 压缩的 session*.jsonl.zstd;其余引擎均为 .jsonl。
    let suffix_ok = path.ends_with(".jsonl") || (engine == "dsh" && path.ends_with(".jsonl.zstd"));
    if !suffix_ok || !path.starts_with('/') {
        return false;
    }
    // 拒绝 `..` 段与 NUL:防止借拼路径逃出会话树。
    if path.contains('\0') || path.split('/').any(|seg| seg == "..") {
        return false;
    }
    let markers: &[&str] = match engine {
        // ~/.claude/projects/<encoded>/<sid>.jsonl;qoder 同构(.qoder*/projects)
        "claude" | "qoder" => &["/projects/"],
        // codex ~/.codex/sessions/…;kimi/grok/dsh 同样以 sessions 目录为根
        "codex" | "kimi" | "grok" | "dsh" | "agy" => &["/sessions/", "/session/"],
        // pi 家族:~/.{pi,omp}/agent/sessions/…
        "pi" | "omp" => &["/agent/sessions/"],
        _ => &["/sessions/", "/session/", "/projects/"],
    };
    markers.iter().any(|m| path.contains(m))
}

/// 远程转录本拉取上限(base64 前)。
const MAX_REMOTE_SESSION_BYTES: u64 = 64 * 1024 * 1024;

/// 远程工作区会话的历史回放:插件会话源把远端 jsonl 绝对路径随 `remotePath`
/// 上报;这里经引擎 spawn 同一套远程通道 `base64` 拉回转录本,落到本机缓存
/// 文件后复用既有解析/分页/子代理折叠。缓存文件仅在内容有变化时重写(stat
/// 签名不变 → 翻页命中解析缓存,不重析)。
#[tauri::command]
pub async fn load_remote_session_page(
    state: tauri::State<'_, crate::AppState>,
    workspace_path: String,
    engine: String,
    session_id: String,
    remote_path: String,
    limit: Option<usize>,
    before_seq: Option<i64>,
) -> Result<SessionPage, String> {
    use sha2::Digest as _;
    if !is_plausible_remote_session_path(&engine, &remote_path) {
        return Err(format!("远程会话路径不合法: {remote_path}"));
    }
    let transport =
        crate::engine::wsl_transport::transport_for_workspace(&state.db, &workspace_path)
            .ok_or_else(|| format!("工作区 {workspace_path} 未登记远程传输"))?;
    // 先远端 stat 卡住字节上限再 base64,超限/不可读直接非零退出,
    // 避免超大转录本经 1.33× 膨胀后全量进内存。
    let quoted = crate::engine::wsl_transport::sh_quote(&remote_path);
    let script = format!(
        "sz=$(stat -c %s -- {quoted} 2>/dev/null) || {{ echo '远程会话文件不可读' >&2; exit 3; }}; \
         [ \"$sz\" -le {MAX_REMOTE_SESSION_BYTES} ] || {{ echo \"远程会话文件过大(${{sz}}B,上限 {MAX_REMOTE_SESSION_BYTES}B)\" >&2; exit 4; }}; \
         base64 -w0 -- {quoted}"
    );
    // run_script_output 已剥传输层噪声;载荷是单行 base64。
    let raw = crate::engine::wsl_transport::run_script_output(&transport, &script).await?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(raw.trim())
        .map_err(|e| format!("远程转录本解码失败: {e}"))?;

    let dir = crate::paths::app_home().join("remote-sessions");
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建缓存目录失败: {e}"))?;
    let digest = sha2::Sha256::digest(format!(
        "{workspace_path}|{engine}|{session_id}|{remote_path}"
    ));
    let name: String = digest[..16].iter().map(|b| format!("{b:02x}")).collect();
    let cache_path = dir.join(format!("{name}.jsonl"));
    let stale = std::fs::read(&cache_path)
        .map(|old| old != bytes)
        .unwrap_or(true);
    if stale {
        let tmp = dir.join(format!("{name}.jsonl.tmp"));
        std::fs::write(&tmp, &bytes).map_err(|e| format!("写缓存失败: {e}"))?;
        std::fs::rename(&tmp, &cache_path).map_err(|e| format!("缓存落位失败: {e}"))?;
    }

    let engine_for_parse = engine.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let cached = cached_session(&engine_for_parse, &cache_path)?;
        Ok(page_from_cached(&cached, limit, before_seq))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Remove the session's on-disk file/dir. kimi/grok/dsh transcripts live
/// under a per-session dir — validated against the engine's anchor roots
/// before removal so a corrupt/stale db row can never point remove_dir_all
/// at an arbitrary tree. Returns Ok when the disk state is gone (or wisely
/// skipped), Err when the removal failed — callers keep the db row on Err
/// so a session cannot "delete then resurrect" on the next scan.
fn delete_session_disk(engine: &str, path: &Path) -> Result<(), String> {
    match engine {
        "claude" | "codex" | "pi" | "omp" | "agy" | "qoder" | "qoder-cn" => {
            match std::fs::remove_file(path) {
                Ok(()) => Ok(()),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
                Err(e) => Err(format!("remove {}: {e}", path.display())),
            }
        }
        // opencode: the db row points at `storage/session/<project>/<id>.json`;
        // the transcript also lives in `storage/message/<id>/` and one
        // `storage/part/<msg>/` dir per message — all under the same storage root.
        "opencode" => delete_opencode_session_disk(path),
        "kimi" | "grok" | "dsh" | "minimax" => delete_dir_session_disk(engine, path),
        // 未知引擎硬失败:宁可删除报错,也不能静默跳过磁盘删除让会话在下次
        // 扫描"复活"(dsh 曾落进 kimi/grok 兜底 arm,锚定校验必失败而删不掉)。
        _ => Err(format!("delete_session: unknown engine {engine}")),
    }
}

/// kimi/grok/dsh:db 行指向会话目录内的主转录本,删除整个会话目录
/// (subagent 日志等随目录一起清)。锚定根与扫描器
/// dir_session_anchor_roots 同源——扫得到的会话必然删得掉(含 v0.9
/// legacy/provider home),stale/损坏的 db 行也无法把 remove_dir_all
/// 指向任意目录树。
fn delete_dir_session_disk(engine: &str, path: &Path) -> Result<(), String> {
    delete_dir_session_disk_anchored(
        engine,
        path,
        &super::discovery::dir_session_anchor_roots(engine),
    )
}

/// 根列表可注入:单测不依赖 HOME/DSH_HOME 等进程级环境变量。
fn delete_dir_session_disk_anchored(
    engine: &str,
    path: &Path,
    roots: &[PathBuf],
) -> Result<(), String> {
    // kimi: .../<sessionDir>/agents/main/wire.jsonl -> <sessionDir>
    // grok: .../<sessionDir>/chat_history.jsonl -> <sessionDir>
    // dsh:  .../<sessionDir>/session*.jsonl.zstd -> <sessionDir>
    let Some(session_dir) = (if engine == "kimi" {
        path.parent()
            .and_then(|p| p.parent())
            .and_then(|a| a.parent())
    } else {
        path.parent()
    }) else {
        return Err(format!("no session dir for {}", path.display()));
    };
    let anchored = roots.iter().any(|root| {
        crate::files::canonicalize_lenient(session_dir)
            .map(|resolved| {
                crate::files::canonicalize_lenient(root)
                    .map(|base| resolved.starts_with(base))
                    .unwrap_or(false)
            })
            .unwrap_or(false)
    });
    let structure_ok = match engine {
        // Kimi dirs must show the expected agents/main/wire.jsonl shape.
        "kimi" => session_dir
            .join("agents")
            .join("main")
            .join("wire.jsonl")
            .is_file(),
        "grok" => session_dir.join("chat_history.jsonl").is_file(),
        // minimax 会话目录 = manifest.json + messages.jsonl 的 dated dir。
        "minimax" => {
            path.is_file() && session_dir.join("manifest.json").is_file()
        }
        // dsh 主转录本的世代文件名即结构标记(db 路径本就来自同名规则的扫描)。
        _ => {
            path.is_file()
                && path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|name| super::discovery::dsh_log_generation(name).is_some())
        }
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
pub(super) fn delete_session_blocking(
    db: &crate::db::Db,
    engine: &str,
    session_id: &str,
) -> Result<(), String> {
    // A failed first turn can announce an id before its transcript is indexed.
    // Hold the scan lock through deletion so an older scan cannot reinsert it.
    if !crate::config::ENGINES.contains(&engine) {
        return Err(format!("delete_session: unknown engine {engine}"));
    }
    let scan_guard = super::scanner::SCAN_LOCK.lock();
    let mut path = find_session_file_path(db, engine, session_id)?;
    if path.is_none() {
        super::scanner::scan_with_guard(db, || {}, &scan_guard)
            .map_err(|e| format!("scan before deleting {engine}/{session_id}: {e}"))?;
        path = find_session_file_path(db, engine, session_id)?;
    }
    if let Some(path) = path {
        delete_session_disk(engine, &path)?;
    }
    // No indexed transcript after the scan is a valid empty/failed session.
    // Model and effort can already exist even when no transcript was created.
    let mut conn = db.0.lock();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for table in [
        "sessions",
        "session_models",
        "session_efforts",
        "session_providers",
        "session_archives",
    ] {
        tx.execute(
            &format!("DELETE FROM {table} WHERE engine=?1 AND session_id=?2"),
            rusqlite::params![engine, session_id],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
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

/// 远程(WSL 发行版内)会话删除:插件会话源上报的 remotePath 经与
/// load_remote_session_page 相同的形状白名单校验后,走同一套远程通道
/// rm。dsh 的同目录旧世代日志一并清掉,目录仅在删空时移除(有其它文件
/// 则保留)。远程会话没有本地 db 行,无需 emit_sessions_changed——前端
/// 删除后自行刷新,插件源重新 list 时文件已不存在。
#[tauri::command]
pub async fn delete_remote_session(
    state: tauri::State<'_, crate::AppState>,
    workspace_path: String,
    engine: String,
    remote_path: String,
) -> Result<(), String> {
    if !is_plausible_remote_session_path(&engine, &remote_path) {
        return Err(format!("远程会话路径不合法: {remote_path}"));
    }
    let transport =
        crate::engine::wsl_transport::transport_for_workspace(&state.db, &workspace_path)
            .ok_or_else(|| format!("工作区 {workspace_path} 未登记远程传输"))?;
    let quoted = crate::engine::wsl_transport::sh_quote(&remote_path);
    let mut script = format!("rm -f -- {quoted}");
    if engine == "dsh" {
        // 世代日志同目录共存(session.jsonl.zstd / session.vN.jsonl.zstd),
        // 只删当前代会留下旧代被插件源重新列出;目录删空才移除。
        script.push_str(&format!(
            "\ndir=$(dirname -- {quoted})\nrm -f -- \"$dir\"/session.jsonl.zstd \"$dir\"/session.v*.jsonl.zstd\nrmdir -- \"$dir\" 2>/dev/null || true"
        ));
    }
    crate::engine::wsl_transport::run_script_output(&transport, &script).await?;
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
    /// "worktree" = git worktree child hanging under its parent workspace
    /// row in the sidebar; None = ordinary workspace.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    /// Parent workspace id; only set when kind="worktree".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    /// Opaque metadata written via host-capability callers (plugin
    /// `workspaces.add`); absent for ordinary directories. The backend never
    /// interprets it — consumers (spawn transport, plugin panels) own the shape.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meta: Option<serde_json::Value>,
}

#[tauri::command]
pub fn list_workspaces(state: tauri::State<'_, crate::AppState>) -> Result<Vec<Workspace>, String> {
    query_rows(
        &state,
        "SELECT id, path, name, last_opened_at, sort_order, group_id, kind, parent_id, meta FROM workspaces
         ORDER BY sort_order IS NULL, sort_order, COALESCE(last_opened_at, 0) DESC",
        |r| {
            let meta_json: Option<String> = r.get(8)?;
            Ok(Workspace {
                id: r.get(0)?,
                path: r.get(1)?,
                name: r.get(2)?,
                last_opened_at: r.get(3)?,
                sort_order: r.get(4)?,
                group_id: r.get(5)?,
                kind: r.get(6)?,
                parent_id: r.get(7)?,
                meta: meta_json.and_then(|s| serde_json::from_str(&s).ok()),
            })
        },
    )
}

#[tauri::command]
pub fn add_workspace(
    state: tauri::State<'_, crate::AppState>,
    path: String,
    meta: Option<serde_json::Value>,
    kind: Option<String>,
    parent_id: Option<String>,
) -> Result<Workspace, String> {
    // `wsl` meta steers engine traffic over ssh to a plugin-named host (出站
    // + 远程执行导向) — it must come through plugin_caps::plugin_add_workspace
    // where the manifest grant is checked server-side. This general command
    // serves trusted host UI only (a plugin bypassing the JS gate via direct
    // IPC would otherwise set it here).
    if let Some(m) = &meta {
        if m.as_object().is_some_and(|o| o.contains_key("wsl")) {
            return Err(
                "wsl meta requires plugin_add_workspace (host:workspace:remote grant)".to_string(),
            );
        }
    }
    // kind/parent_id shape checks: "worktree" requires an existing parent
    // row; an ordinary workspace must not carry a parent.
    match kind.as_deref() {
        None => {
            if parent_id.is_some() {
                return Err("parent_id requires kind=\"worktree\"".to_string());
            }
        }
        Some("worktree") => {
            let pid = parent_id
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .ok_or_else(|| "kind=\"worktree\" requires parent_id".to_string())?;
            let exists = {
                let conn = state.db.0.lock();
                conn.query_row(
                    "SELECT 1 FROM workspaces WHERE id=?1",
                    rusqlite::params![pid],
                    |_| Ok(()),
                )
                .is_ok()
            };
            if !exists {
                return Err(format!("unknown parent workspace: {pid}"));
            }
        }
        Some(other) => return Err(format!("unknown workspace kind: {other}")),
    }
    add_workspace_inner(&state, &path, meta, kind, parent_id)
}

/// Shared body of `add_workspace` / `plugin_caps::plugin_add_workspace`:
/// shape checks + upsert. Grant checks live in the callers.
pub(crate) fn add_workspace_inner(
    state: &crate::AppState,
    path: &str,
    meta: Option<serde_json::Value>,
    kind: Option<String>,
    parent_id: Option<String>,
) -> Result<Workspace, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("empty path".to_string());
    }
    // Host-capability callers (plugin workspaces.add) may register paths that
    // do not exist on this machine (remote host / WSL distro) — meta presence
    // is the opt-in that skips the local is_dir check.
    if meta.is_none() {
        let dir = std::path::PathBuf::from(trimmed);
        if !dir.is_dir() {
            return Err(format!("not a directory: {trimmed}"));
        }
    }
    if let Some(m) = &meta {
        if m.as_object().is_none_or(|o| o.is_empty()) {
            return Err("meta must be a non-empty object when provided".to_string());
        }
    }
    let name = std::path::Path::new(trimmed)
        .file_name()
        .and_then(|n| n.to_str())
        .map(str::to_string)
        // "/" 这类纯分隔符路径:file_name 为 None 且 trim 后为空 → 原串兜底,
        // 空名字进 db 只会换来一个无法辨认的侧栏条目。
        .unwrap_or_else(|| match trimmed.trim_end_matches(['/', '\\']) {
            "" => trimmed.to_string(),
            rest => rest.to_string(),
        });
    let id = uuid::Uuid::new_v4().to_string();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let meta_json = meta.as_ref().map(|m| m.to_string());
    {
        let conn = state.db.0.lock();
        conn.execute(
            "INSERT INTO workspaces(id, path, name, last_opened_at, kind, parent_id, meta)
             VALUES(?1,?2,?3,?4,?5,?6,?7)
             ON CONFLICT(path) DO UPDATE SET last_opened_at=excluded.last_opened_at,
                kind=COALESCE(excluded.kind, workspaces.kind),
                parent_id=COALESCE(excluded.parent_id, workspaces.parent_id),
                meta=COALESCE(excluded.meta, workspaces.meta)",
            rusqlite::params![id, trimmed, name, now, kind, parent_id, meta_json],
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
        kind,
        parent_id,
        meta,
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

    fn archived_fixture() -> SessionMeta {
        SessionMeta {
            engine: "codex".into(),
            session_id: "archived-1".into(),
            workspace_path: "/ws/demo".into(),
            file_path: "/tmp/archived-1.jsonl".into(),
            file_size: 12,
            file_mtime_ms: 34,
            title: "Archived title".into(),
            preview: "preview".into(),
            created_at: Some(1),
            updated_at: Some(2),
            message_count: 3,
            pinned: false,
            custom_title: None,
            model: Some("provider/model".into()),
            effort: Some("high".into()),
            provider: Some("provider".into()),
            remote: None,
            remote_path: None,
        }
    }

    fn visible_session_count(db: &crate::db::Db) -> i64 {
        db.0.lock()
            .query_row(
                "SELECT COUNT(*) FROM sessions s WHERE NOT EXISTS (
                   SELECT 1 FROM session_archives a
                   WHERE a.engine=s.engine AND a.session_id=s.session_id
                 )",
                [],
                |r| r.get(0),
            )
            .unwrap()
    }

    #[test]
    fn archive_hides_across_scans_and_restore_reveals() {
        let scratch = Scratch::new();
        let db = crate::db::Db::open_at(&scratch.0.join("app.db")).unwrap();
        let session = archived_fixture();
        db.0.lock().execute(
            "INSERT INTO sessions(engine,session_id,workspace_path,file_path,file_size,file_mtime_ms,title,preview,created_at,updated_at,message_count)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            rusqlite::params![
                session.engine,
                session.session_id,
                session.workspace_path,
                session.file_path,
                session.file_size,
                session.file_mtime_ms,
                session.title,
                session.preview,
                session.created_at,
                session.updated_at,
                session.message_count,
            ],
        ).unwrap();

        assert_eq!(visible_session_count(&db), 1);
        archive_session_in(&db, &session).unwrap();
        assert_eq!(visible_session_count(&db), 0);
        assert_eq!(
            list_archived_sessions_from(&db).unwrap()[0].session_id,
            "archived-1"
        );

        // A scanner update never touches the independent archive marker.
        db.0.lock().execute(
            "UPDATE sessions SET updated_at=99 WHERE engine='codex' AND session_id='archived-1'",
            [],
        ).unwrap();
        assert_eq!(visible_session_count(&db), 0);

        restore_session_in(&db, "codex", "archived-1").unwrap();
        assert_eq!(visible_session_count(&db), 1);
        assert!(list_archived_sessions_from(&db).unwrap().is_empty());
    }

    #[test]
    fn archive_snapshot_preserves_remote_delete_route() {
        let scratch = Scratch::new();
        let db = crate::db::Db::open_at(&scratch.0.join("app.db")).unwrap();
        let mut session = archived_fixture();
        session.engine = "dsh".into();
        session.file_path.clear();
        session.remote = Some(true);
        session.remote_path =
            Some("/home/dev/.dsh/sessions/-ws-demo/archived-1/session.jsonl.zstd".into());

        archive_session_in(&db, &session).unwrap();
        let archived = list_archived_sessions_from(&db).unwrap();
        assert_eq!(archived[0].remote, Some(true));
        assert_eq!(archived[0].remote_path, session.remote_path);
    }

    #[test]
    fn remote_session_path_shape_is_per_engine() {
        // 合法形态:绝对 .jsonl 且落在该引擎已知会话目录下
        assert!(is_plausible_remote_session_path(
            "claude",
            "/home/dev/.claude/projects/-home-dev-proj/s-1.jsonl"
        ));
        assert!(is_plausible_remote_session_path(
            "codex",
            "/home/dev/.codex/sessions/2026/09/15/rollout-abc.jsonl"
        ));
        assert!(is_plausible_remote_session_path(
            "omp",
            "/home/dev/.omp/agent/sessions/s-1.jsonl"
        ));
        // 形状不符:相对路径、非 jsonl、`..` 段、目录形态不匹配
        assert!(!is_plausible_remote_session_path(
            "claude",
            "home/dev/x.jsonl"
        ));
        assert!(!is_plausible_remote_session_path(
            "claude",
            "/home/dev/.claude/projects/p/s.txt"
        ));
        assert!(!is_plausible_remote_session_path(
            "claude",
            "/home/dev/.claude/projects/../settings.jsonl"
        ));
        // 任意 .jsonl(不在会话目录形态下)一律拒绝 —— 防借 IPC 读发行版文件
        assert!(!is_plausible_remote_session_path(
            "claude",
            "/etc/cron.d/job.jsonl"
        ));
        assert!(!is_plausible_remote_session_path(
            "codex",
            "/home/dev/.claude/projects/p/s.jsonl"
        ));
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
        std::fs::write(
            &path,
            lines
                .iter()
                .map(serde_json::Value::to_string)
                .collect::<Vec<_>>()
                .join("\n"),
        )
        .unwrap();
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
        assert!(page
            .messages
            .iter()
            .all(|message| message.text.starts_with("later")));
        let wire = serde_json::to_value(&page).unwrap();
        let history = wire["subagentHistory"]
            .as_array()
            .expect("session history is independent of pagination");
        let task = history.iter().find(|row| row["text"] == "task").unwrap();
        assert_eq!(task["args"]["tasks"][0]["name"], "SavedReviewer");
        assert_eq!(task["args"]["tasks"][0]["task"], brief);
        let roster = history.iter().find(|row| row["text"] == "hub").unwrap();
        assert_eq!(
            roster["result"]["details"]["jobs"][0]["status"],
            "completed"
        );
        let older =
            load_session_page_blocking(&db, "omp", "saved", Some(100), page.next_before).unwrap();
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
            plain(0, "user"),      // closed by the delegation at 1
            delegation(1),         // emits user 0 + itself
            plain(2, "assistant"), // turn boundary
            plain(3, "user"),      // replaced by user 4: absent from the full fold
            plain(4, "user"),      // closed by the delegation at 5
            delegation(5),
            plain(6, "user"),      // spent past the cut by the boundary at 7
            plain(7, "thinking"),  // turn boundary, emits user 6
            plain(8, "user"),      // trailing unclosed user
            plain(9, "assistant"), // no boundary: follows a boundary, not a delegation
        ];
        let fold = subagent_fold(&messages);
        for start in 0..=messages.len() {
            let cut =
                serde_json::to_value(subagent_history_until(&messages, &fold, start)).unwrap();
            let fresh = serde_json::to_value(subagent_history(&messages[..start])).unwrap();
            assert_eq!(cut, fresh, "start={start}");
        }
    }

    #[test]
    fn delete_session_preserves_database_errors() {
        let scratch = Scratch::new();
        let db = crate::db::Db::open_at(&scratch.0.join("app.db")).unwrap();
        db.0.lock().execute("DROP TABLE sessions", []).unwrap();

        let error = delete_session_blocking(&db, "codex", "missing").unwrap_err();
        assert!(error.contains("lookup session codex/missing"), "{error}");
        assert!(error.contains("no such table"), "{error}");
        assert!(!error.contains("session not found"));
    }

    #[test]
    fn delete_session_keeps_records_when_disk_removal_fails() {
        let scratch = Scratch::new();
        // remove_file on a directory fails on both Unix and Windows.
        let path = scratch.0.join("not-a-transcript.jsonl");
        std::fs::create_dir(&path).unwrap();
        let db = crate::db::Db::open_at(&scratch.0.join("app.db")).unwrap();
        for engine in ["claude", "codex"] {
            db.0.lock().execute(
                "INSERT INTO sessions(engine,session_id,workspace_path,file_path,file_size,file_mtime_ms) VALUES(?1,'failed','/ws',?2,0,0)",
                rusqlite::params![engine, path.to_string_lossy().as_ref()],
            ).unwrap();
            db.remember_session_model(engine, "failed", "model", 1)
                .unwrap();
            db.remember_session_effort(engine, "failed", "high", 1)
                .unwrap();

            let error = delete_session_blocking(&db, engine, "failed").unwrap_err();
            assert!(error.contains("remove "), "{error}");
            assert!(path.is_dir());
            for table in ["sessions", "session_models", "session_efforts"] {
                let count: i64 = db
                    .0
                    .lock()
                    .query_row(
                        &format!(
                            "SELECT COUNT(*) FROM {table} WHERE engine=?1 AND session_id='failed'"
                        ),
                        [engine],
                        |r| r.get(0),
                    )
                    .unwrap();
                assert_eq!(count, 1, "{engine}: {table}");
            }
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
    /// dsh sessions live in a per-session dir (`<home>/sessions/<cwd>/<dir>/
    /// session*.jsonl.zstd`) with subagent logs alongside — deleting takes
    /// the whole dir. Regression: dsh used to fall into the kimi/grok
    /// fallback arm, whose `.grok` anchor always rejected the delete, so the
    /// transcript survived and the next scan resurrected the session.
    #[test]
    fn delete_dsh_removes_session_dir() {
        let scratch = Scratch::new();
        let root = scratch.0.join("dsh").join("sessions");
        let dir = root.join("-home-dev-ws").join("sess-1");
        std::fs::create_dir_all(&dir).unwrap();
        let log = dir.join("session.v1.jsonl.zstd");
        std::fs::write(&log, b"zstd-bytes").unwrap();
        std::fs::write(dir.join("subagent.log"), b"x").unwrap();

        delete_dir_session_disk_anchored("dsh", &log, &[root]).unwrap();
        assert!(!dir.exists());
    }

    /// A dsh dir outside every anchor root is refused (stale db rows must
    /// never aim remove_dir_all at an arbitrary tree).
    #[test]
    fn delete_dsh_refuses_outside_anchor() {
        let scratch = Scratch::new();
        let root = scratch.0.join("dsh").join("sessions");
        let dir = root.join("-home-dev-ws").join("sess-1");
        std::fs::create_dir_all(&dir).unwrap();
        let log = dir.join("session.jsonl.zstd");
        std::fs::write(&log, b"zstd-bytes").unwrap();

        let elsewhere = scratch.0.join("other-home");
        delete_dir_session_disk_anchored("dsh", &log, &[elsewhere]).unwrap();
        assert!(log.exists());
    }

    /// A non-generation file name is not a dsh transcript — refuse.
    #[test]
    fn delete_dsh_refuses_non_generation_name() {
        let scratch = Scratch::new();
        let root = scratch.0.join("dsh").join("sessions");
        let dir = root.join("-home-dev-ws").join("sess-1");
        std::fs::create_dir_all(&dir).unwrap();
        let log = dir.join("session.jsonl");
        std::fs::write(&log, b"{}").unwrap();

        delete_dir_session_disk_anchored("dsh", &log, &[root]).unwrap();
        assert!(log.exists());
    }

    /// kimi discovery spans the current home plus legacy/provider homes; the
    /// delete anchor must accept every root discovery scans, or sessions
    /// from a legacy home delete-then-resurrect.
    #[test]
    fn delete_kimi_anchors_every_discovery_root() {
        let scratch = Scratch::new();
        let primary = scratch.0.join(".kimi-code");
        let legacy = scratch.0.join(".kimi");
        let dir = legacy.join("sess-9");
        let wire = dir.join("agents").join("main").join("wire.jsonl");
        std::fs::create_dir_all(wire.parent().unwrap()).unwrap();
        std::fs::write(&wire, b"{}").unwrap();

        // 只锚定主 home(旧行为):legacy home 的会话被拒删。
        delete_dir_session_disk_anchored("kimi", &wire, &[primary.clone()]).unwrap();
        assert!(wire.exists());
        // 锚定根与发现同源:删除成功。
        delete_dir_session_disk_anchored("kimi", &wire, &[primary, legacy]).unwrap();
        assert!(!dir.exists());
    }

    /// Unknown engines fail loudly instead of silently skipping the disk
    /// delete (the silent path is how deleted sessions resurrect).
    #[test]
    fn delete_unknown_engine_errors() {
        let scratch = Scratch::new();
        let path = scratch.0.join("sess.jsonl");
        std::fs::write(&path, "{}").unwrap();
        assert!(delete_session_disk("future-engine", &path).is_err());
        assert!(path.exists());
    }

    /// dsh 远程转录本是 zstd 压缩:同 /sessions/ 形态下放行 .jsonl.zstd。
    #[test]
    fn remote_dsh_zstd_path_shape() {
        assert!(is_plausible_remote_session_path(
            "dsh",
            "/home/dev/.dsh/sessions/-home-dev-ws/sess-1/session.v2.jsonl.zstd"
        ));
        // 其它引擎不认 zstd 后缀;dsh 的 zstd 也得落在会话目录形态内。
        assert!(!is_plausible_remote_session_path(
            "claude",
            "/home/dev/.claude/projects/p/session.jsonl.zstd"
        ));
        assert!(!is_plausible_remote_session_path(
            "dsh",
            "/home/dev/notes/session.jsonl.zstd"
        ));
    }
    /// Tool-result-heavy sessions are the steady state (an hourly task's omp
    /// transcript measured 28MB of `result.details` against 18MB of chat
    /// text): the cache budget must see those payloads, or the 128MB cap
    /// admits multiples of itself. Regression: `parsed_footprint` only
    /// summed text + images + ts, so args AND result are each sized here.
    #[test]
    fn parsed_footprint_counts_retained_tool_payloads() {
        let big_args = "A".repeat(20_000);
        let big_result = "R".repeat(20_000);
        let row = |args: Option<serde_json::Value>, result: Option<serde_json::Value>| Message {
            seq: 1,
            role: "tool".into(),
            text: "ok".into(),
            ts: None,
            path: None,
            args,
            result,
            todos: None,
            usage: Some(json!({ "input_tokens": 10 })),
            model: None,
            effort: None,
            duration_ms: None,
            images: Vec::new(),
        };
        let full = ParsedSession {
            messages: vec![row(
                Some(json!({ "command": big_args })),
                Some(json!({ "details": { "log": big_result } })),
            )],
        };
        // 40k of args+result dwarfs the 2-char text; a threshold above either
        // payload alone fails if args OR result accounting is dropped.
        assert!(
            parsed_footprint(&full) >= 38_000,
            "args and result payloads must both count toward the cache budget",
        );
        // The same row shape without the payloads is orders of magnitude
        // smaller: the footprint tracks retained bytes, not the row count.
        let bare = ParsedSession {
            messages: vec![row(None, None)],
        };
        assert!(
            parsed_footprint(&full) > parsed_footprint(&bare) + 39_000,
            "the payloads, not the row, drive the footprint",
        );
    }
}
