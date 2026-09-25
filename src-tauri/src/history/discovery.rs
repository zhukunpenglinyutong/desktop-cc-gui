//! Session-file discovery: enumerate per-engine session files on disk and
//! identify head-keyed engine files. The scan pipeline that consumes these
//! candidates lives in `scanner.rs`; deletion (`reader.rs`) shares the
//! anchor roots so a discoverable session is always deletable.
use super::{same_or_child, SessionFile};
use std::path::{Path, PathBuf};

/// Bounded head peek: parse up to `max_lines` JSON lines from the head of a
/// file (plain or zstd). Reads in 16 KiB chunks and stops as soon as
/// `max_lines` complete lines have arrived, so a file costs ~tens of KB,
/// never the full cap. Codex embeds its full base_instructions system
/// prompt in the `session_meta` line, so line 1 alone runs to tens of KB —
/// a fixed 16 KiB read truncated it mid-JSON and every newer rollout failed
/// identification, while a fixed 1 MiB read would pull ~1 GB per 1000 files
/// on a cold scan for lines it never uses. Total reads stay bounded by
/// MAX_HEAD_BYTES. Newer pi-family files prepend a `title` line before the
/// `session` line, so line 1 alone is not enough either.
fn peek_head_json_lines(
    path: &Path,
    zstd_compressed: bool,
    max_lines: usize,
) -> Vec<serde_json::Value> {
    use std::io::{BufReader, Read};
    const CHUNK_BYTES: usize = 16 * 1024;
    const MAX_HEAD_BYTES: usize = 1024 * 1024;
    let Ok(file) = std::fs::File::open(path) else {
        return Vec::new();
    };
    let mut reader: Box<dyn Read> = if zstd_compressed {
        match zstd::stream::read::Decoder::new(BufReader::new(file)) {
            Ok(decoder) => Box::new(decoder),
            Err(_) => return Vec::new(),
        }
    } else {
        Box::new(file)
    };
    let mut buf = Vec::new();
    // Incremental newline count: re-scanning the whole buffer per chunk is
    // O(n²) on a long head.
    let mut newline_count = 0usize;
    let mut eof = false;
    while newline_count < max_lines && buf.len() < MAX_HEAD_BYTES {
        let mut chunk = [0u8; CHUNK_BYTES];
        match reader.read(&mut chunk) {
            Ok(0) => {
                eof = true;
                break;
            }
            Ok(n) => {
                newline_count += chunk[..n].iter().filter(|&&b| b == b'\n').count();
                buf.extend_from_slice(&chunk[..n]);
            }
            Err(_) => return Vec::new(),
        }
    }
    let head = String::from_utf8_lossy(&buf);
    let mut lines: Vec<&str> = head.split('\n').collect();
    if !eof {
        // The cap (or an unlucky chunk boundary) can leave the tail segment
        // mid-line; a partial line never parses, so drop it. At EOF the tail
        // is a complete final line.
        lines.pop();
    }
    lines
        .into_iter()
        .take(max_lines)
        .filter_map(|line| serde_json::from_str(line.trim()).ok())
        .collect()
}

pub(super) fn discover_claude(workspace: &Path) -> Vec<SessionFile> {
    // The CLI's config root honors CLAUDE_CONFIG_DIR; pinning ~/.claude here
    // would lose the history of users who relocate it.
    let base = crate::engine::engine_home(Some("CLAUDE_CONFIG_DIR"), ".claude").join("projects");
    let mut out = Vec::new();
    let mut seen_sessions = std::collections::HashSet::new();
    for dir in claude_project_dirs(&base, workspace) {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            if stem == "history" || !seen_sessions.insert(stem.to_string()) {
                continue;
            }
            out.push(SessionFile {
                engine: "claude",
                session_id: stem.to_string(),
                workspace_path: workspace.to_string_lossy().to_string(),
                file_path: path,
            });
        }
    }
    out
}

/// Strip the `\\?\` verbatim prefix Windows `canonicalize` adds — the CLI
/// encodes the plain path, so the prefix would break the match.
fn strip_verbatim_prefix(path: &str) -> &str {
    path.strip_prefix(r"\\?\").unwrap_or(path)
}

/// Candidate `<projects>/<encoded>` dirs for one workspace. Windows terminals
/// disagree on drive-letter case, slash direction, and trailing separators,
/// and the CLI encodes whatever cwd spelling it saw — so try the raw
/// spelling, a trailing-separator-trimmed one, and the canonicalized path.
fn claude_project_dirs(base: &Path, workspace: &Path) -> Vec<PathBuf> {
    fn push(
        out: &mut Vec<PathBuf>,
        seen: &mut std::collections::HashSet<String>,
        base: &Path,
        spelling: &str,
    ) {
        if !spelling.is_empty() && seen.insert(spelling.to_string()) {
            out.push(base.join(super::claude_encode_project_path(spelling)));
        }
    }
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let raw = workspace.to_string_lossy().to_string();
    let trimmed = raw.trim_end_matches(['/', '\\']).to_string();
    push(&mut out, &mut seen, base, &raw);
    push(&mut out, &mut seen, base, &trimmed);
    for spelling in [&raw, &trimmed] {
        if let Ok(canonical) = std::fs::canonicalize(spelling) {
            let canonical = strip_verbatim_prefix(&canonical.to_string_lossy()).to_string();
            push(&mut out, &mut seen, base, &canonical);
        }
    }
    out
}

/// v0.9 managed provider homes (`~/.ccgui/<engine>-provider-homes/<id>/`):
/// sessions launched under a managed provider profile wrote into these
/// CLI-home-shaped dirs. Scanned so users upgrading from v0.9 keep that
/// history instead of watching it vanish from the sidebar.
fn legacy_provider_homes(dir_name: &str) -> Vec<PathBuf> {
    let root = crate::paths::legacy_home().join(dir_name);
    let Ok(entries) = std::fs::read_dir(&root) else {
        return Vec::new();
    };
    entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect()
}

pub(super) fn discover_kimi(workspace: &Path) -> Vec<SessionFile> {
    let homes = dir_session_anchor_roots("kimi");
    let mut out = Vec::new();
    let mut seen_paths = std::collections::HashSet::new();
    for base in homes {
        for file in discover_kimi_in(&base, workspace) {
            if seen_paths.insert(file.file_path.clone()) {
                out.push(file);
            }
        }
    }
    out
}

fn discover_kimi_in(base: &Path, workspace: &Path) -> Vec<SessionFile> {
    let Ok(raw) = std::fs::read_to_string(base.join("session_index.jsonl")) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for line in raw.lines() {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        let work_dir = value
            .get("workDir")
            .or_else(|| value.get("work_dir"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if work_dir.is_empty() || !same_or_child(Path::new(work_dir), workspace) {
            continue;
        }
        let session_id = value
            .get("sessionId")
            .or_else(|| value.get("session_id"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let session_dir = value
            .get("sessionDir")
            .or_else(|| value.get("session_dir"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if session_id.is_empty() || session_dir.is_empty() {
            continue;
        }
        let wire = PathBuf::from(&session_dir)
            .join("agents")
            .join("main")
            .join("wire.jsonl");
        if wire.is_file() {
            out.push(SessionFile {
                engine: "kimi",
                session_id,
                workspace_path: workspace.to_string_lossy().to_string(),
                file_path: wire,
            });
        }
    }
    out
}

/// `/Users/foo/bar` → `-Users-foo-bar` (qodercli project dir names; reference
/// engine/qoder_history.rs::encode_qoder_project_slug).
fn qoder_encode_project_slug(path: &str) -> String {
    let mut value = path.trim().replace('\\', "/");
    while value.ends_with('/') && value.len() > 1 {
        value.pop();
    }
    if value.is_empty() {
        return String::new();
    }
    // Windows rejects a drive colon in a directory name (mkdir fails with
    // `目录名称无效`, ERROR_DIRECTORY), so `C:\ws\proj` has to encode to
    // `C--ws-proj`. The old `C:-ws-proj` could never exist on disk — and
    // `Path::join` reads it as a *drive-relative* path, which replaced the
    // whole base, sending both distributions to the process's working
    // directory instead of their own home.
    value.replace(['/', ':'], "-")
}

/// Candidate `<projects>/<slug>` dirs for one workspace — same spelling
/// spread as [`claude_project_dirs`] (raw / trailing-trimmed / canonical).
fn qoder_project_dirs(base: &Path, workspace: &Path) -> Vec<PathBuf> {
    fn push(
        out: &mut Vec<PathBuf>,
        seen: &mut std::collections::HashSet<String>,
        base: &Path,
        spelling: &str,
    ) {
        let slug = qoder_encode_project_slug(spelling);
        if !slug.is_empty() && seen.insert(slug.clone()) {
            out.push(base.join(slug));
        }
    }
    let mut out = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let raw = workspace.to_string_lossy().to_string();
    let trimmed = raw.trim_end_matches(['/', '\\']).to_string();
    push(&mut out, &mut seen, base, &raw);
    push(&mut out, &mut seen, base, &trimmed);
    for spelling in [&raw, &trimmed] {
        if let Ok(canonical) = std::fs::canonicalize(spelling) {
            let canonical = strip_verbatim_prefix(&canonical.to_string_lossy()).to_string();
            push(&mut out, &mut seen, base, &canonical);
        }
    }
    out
}

/// Qoder sessions: `<config-home>/projects/<cwd-slug>/<sessionId>.jsonl`, one
/// claude-shaped NDJSON file per session (reference qoder_history.rs). Each
/// distribution (Global `~/.qoder` / CN `~/.qoder-cn`) owns an independent
/// home. Slug-keyed per workspace, so discovery is a handful of readdirs.
pub(super) fn discover_qoder(
    workspace: &Path,
    distribution: crate::engine::qoder::QoderDistribution,
) -> Vec<SessionFile> {
    let base =
        crate::engine::engine_home(None, distribution.default_config_dir_name()).join("projects");
    let mut out = Vec::new();
    let mut seen_sessions = std::collections::HashSet::new();
    for dir in qoder_project_dirs(&base, workspace) {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            if !seen_sessions.insert(stem.to_string()) {
                continue;
            }
            out.push(SessionFile {
                engine: distribution.engine_id(),
                session_id: stem.to_string(),
                workspace_path: workspace.to_string_lossy().to_string(),
                file_path: path,
            });
        }
    }
    out
}

/// OpenCode data roots holding `storage/{session,message,part}/…` and
/// `opencode.db` (reference commands_opencode_catalog.rs
/// ::opencode_data_candidate_roots).
fn opencode_data_roots(workspace: &Path) -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Some(home) = std::env::var_os("OPENCODE_HOME") {
        roots.push(PathBuf::from(home));
    }
    if let Some(dir) = dirs::data_local_dir() {
        roots.push(dir.join("opencode"));
    }
    if let Some(dir) = dirs::data_dir() {
        roots.push(dir.join("opencode"));
    }
    // `dirs::home_dir()` reads the Windows Known Folder API, which ignores
    // HOME/USERPROFILE, so a scratch home never reached this root. Same split
    // `paths::home_dir` already applies for the v0.9 legacy homes; production
    // resolves identically either way.
    roots.push(
        crate::paths::home_dir()
            .join(".local")
            .join("share")
            .join("opencode"),
    );
    roots.push(workspace.join(".opencode"));
    let mut deduped: Vec<PathBuf> = Vec::new();
    for root in roots {
        if !deduped.contains(&root) {
            deduped.push(root);
        }
    }
    deduped
}

// OpenCode scan budgets. Session metadata files are ~400 bytes of pretty
// JSON; the caps exist so a bloated storage tree costs a bounded readdir
// count plus a few KB per file, never an unbounded walk (the repo has a
// 287MB-scan incident in its history).
const MAX_OPENCODE_PROJECT_DIRS: usize = 64;
const MAX_OPENCODE_SESSION_FILES: usize = 512;
const MAX_OPENCODE_META_BYTES: u64 = 64 * 1024;

/// Parse a small JSON file (opencode pretty-prints, so line readers do not
/// apply), reading at most `max_bytes`. Truncated or invalid JSON → None.
fn read_small_json(path: &Path, max_bytes: u64) -> Option<serde_json::Value> {
    use std::io::Read;
    let file = std::fs::File::open(path).ok()?;
    let mut buf = String::new();
    file.take(max_bytes).read_to_string(&mut buf).ok()?;
    serde_json::from_str(&buf).ok()
}

/// OpenCode sessions: `<root>/storage/session/<projectId>/<sessionId>.json`
/// (shape verified against opencode 1.1.16 on disk: `{id, projectID,
/// directory, title, time:{created,updated}}`). Attribution comes from the
/// metadata's `directory` field — the projectId dir is a content hash, not
/// a path encoding, so the tiny metadata file must be read (bounded above).
pub(super) fn discover_opencode(workspace: &Path) -> Vec<SessionFile> {
    let mut out = Vec::new();
    let mut seen_sessions = std::collections::HashSet::new();
    for root in opencode_data_roots(workspace) {
        let session_root = root.join("storage").join("session");
        let Ok(projects) = std::fs::read_dir(&session_root) else {
            continue;
        };
        for (index, project) in projects.flatten().enumerate() {
            if index >= MAX_OPENCODE_PROJECT_DIRS {
                break;
            }
            let project_dir = project.path();
            if !project_dir.is_dir() {
                continue;
            }
            let Ok(files) = std::fs::read_dir(&project_dir) else {
                continue;
            };
            for (index, file) in files.flatten().enumerate() {
                if index >= MAX_OPENCODE_SESSION_FILES {
                    break;
                }
                let path = file.path();
                if path.extension().and_then(|e| e.to_str()) != Some("json") {
                    continue;
                }
                let Some(meta) = read_small_json(&path, MAX_OPENCODE_META_BYTES) else {
                    continue;
                };
                let directory = meta.get("directory").and_then(|v| v.as_str()).unwrap_or("");
                if directory.is_empty() || !same_or_child(Path::new(directory), workspace) {
                    continue;
                }
                let session_id = meta
                    .get("id")
                    .and_then(|v| v.as_str())
                    .map(str::to_string)
                    .or_else(|| {
                        path.file_stem()
                            .and_then(|s| s.to_str())
                            .map(str::to_string)
                    })
                    .unwrap_or_default();
                if session_id.is_empty() || !seen_sessions.insert(session_id.clone()) {
                    continue;
                }
                out.push(SessionFile {
                    engine: "opencode",
                    session_id,
                    workspace_path: workspace.to_string_lossy().to_string(),
                    file_path: path,
                });
            }
        }
    }
    out
}

fn grok_url_decode(encoded: &str) -> String {
    let bytes = encoded.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = &encoded[i + 1..i + 3];
            if let Ok(byte) = u8::from_str_radix(hex, 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

pub(super) fn discover_grok(workspace: &Path) -> Vec<SessionFile> {
    let roots = dir_session_anchor_roots("grok");
    let mut out = Vec::new();
    for root in roots {
        out.extend(discover_grok_in(&root, workspace));
    }
    out
}

/// 目录型引擎(kimi/grok/dsh)会话目录的锚定根。kimi 的会话目录直接落在
/// 各 home 下(session_index 记录绝对路径);grok/dsh 落在 <home>/sessions/
/// 的 cwd 子目录下。发现(本模块)与删除(reader)共用这一份,保证
/// 「扫得到的会话必然删得掉」——v0.9 的 legacy/provider home 也在其列。
pub(crate) fn dir_session_anchor_roots(engine: &str) -> Vec<PathBuf> {
    match engine {
        "kimi" => {
            // Current CLI home, the v0.9-era CLI home (`~/.kimi`, KIMI_HOME
            // override), and every v0.9 managed provider home.
            let mut homes = vec![crate::engine::engine_home(None, ".kimi-code")];
            homes.push(crate::engine::engine_home(Some("KIMI_HOME"), ".kimi"));
            homes.extend(legacy_provider_homes("kimi-provider-homes"));
            homes
        }
        "grok" => {
            let mut roots = vec![crate::engine::engine_home(None, ".grok").join("sessions")];
            roots.extend(
                legacy_provider_homes("grok-provider-homes")
                    .into_iter()
                    .map(|home| home.join("sessions")),
            );
            roots
        }
        "dsh" => vec![crate::engine::engine_home(Some("DSH_HOME"), ".dsh").join("sessions")],
        // minimax: 会话目录落在 <data>/v2/sessions/<日期>/…-session_<id>/ 下,
        // db 行的 history_relative_dir 记录相对路径;锚定根与发现同源。
        "minimax" => {
            vec![crate::engine::engine_home(Some("MINIMAX_DATA_DIR"), ".minimax")
                .join("v2")
                .join("sessions")]
        }
        _ => Vec::new(),
    }
}

fn discover_grok_in(sessions_root: &Path, workspace: &Path) -> Vec<SessionFile> {
    let Ok(cwd_dirs) = std::fs::read_dir(sessions_root) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for cwd_entry in cwd_dirs.flatten() {
        let cwd_dir = cwd_entry.path();
        if !cwd_dir.is_dir() {
            continue;
        }
        let decoded = grok_url_decode(&cwd_entry.file_name().to_string_lossy());
        if !same_or_child(Path::new(&decoded), workspace) {
            continue;
        }
        let Ok(session_dirs) = std::fs::read_dir(&cwd_dir) else {
            continue;
        };
        for session_entry in session_dirs.flatten() {
            let session_dir = session_entry.path();
            if !session_dir.is_dir() {
                continue;
            }
            let chat = session_dir.join("chat_history.jsonl");
            if !chat.is_file() {
                continue;
            }
            let session_id = session_entry.file_name().to_string_lossy().to_string();
            if session_id.is_empty() {
                continue;
            }
            out.push(SessionFile {
                engine: "grok",
                session_id,
                workspace_path: workspace.to_string_lossy().to_string(),
                file_path: chat,
            });
        }
    }
    out
}

/// Antigravity conversations live under `~/.gemini/antigravity-cli/` as
/// sqlite files, indexed by `conversation_summaries.db` (`workspace_uris`).
pub(super) fn discover_agy(workspace: &Path) -> Vec<SessionFile> {
    let home = crate::engine::agy::agy_home();
    let conv_dir = home.join("conversations");
    let mut by_id: std::collections::HashMap<String, PathBuf> = std::collections::HashMap::new();

    if let Ok(conn) = rusqlite::Connection::open_with_flags(
        home.join("conversation_summaries.db"),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    ) {
        if let Ok(mut stmt) =
            conn.prepare("SELECT conversation_id, workspace_uris FROM conversation_summaries")
        {
            if let Ok(rows) = stmt.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            }) {
                for row in rows.flatten() {
                    let (id, uris) = row;
                    if id.trim().is_empty() {
                        continue;
                    }
                    if agy_uris_match_workspace(&uris, workspace) {
                        let path = conv_dir.join(format!("{id}.db"));
                        by_id.entry(id).or_insert(path);
                    }
                }
            }
        }
    }

    if let Ok(text) = std::fs::read_to_string(home.join("cache").join("last_conversations.json")) {
        if let Ok(map) = serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&text) {
            for (cwd, id) in map {
                let Some(id) = id.as_str().map(str::trim).filter(|s| !s.is_empty()) else {
                    continue;
                };
                if same_or_child(Path::new(&cwd), workspace) {
                    by_id
                        .entry(id.to_string())
                        .or_insert_with(|| conv_dir.join(format!("{id}.db")));
                }
            }
        }
    }

    by_id
        .into_iter()
        .filter(|(_, path)| path.is_file())
        .map(|(session_id, file_path)| SessionFile {
            engine: "agy",
            session_id,
            workspace_path: workspace.to_string_lossy().to_string(),
            file_path,
        })
        .collect()
}

/// MiniMax Code indexes its conversations in the runtime sqlite
/// (`<data>/v2/sqlite/runtime-state.sqlite`, columns `workspace_dir` /
/// `history_relative_dir`); transcripts live at
/// `<data>/v2/sessions/<history_relative_dir>/messages.jsonl`. The dated
/// directory names carry no workspace, so the db row is the only
/// workspace→session link.
pub(super) fn discover_minimax(workspace: &Path) -> Vec<SessionFile> {
    let data_dir = crate::engine::engine_home(Some("MINIMAX_DATA_DIR"), ".minimax");
    let sessions_root = data_dir.join("v2").join("sessions");
    let db_path = data_dir.join("v2").join("sqlite").join("runtime-state.sqlite");
    let mut out = Vec::new();
    let Ok(conn) = rusqlite::Connection::open_with_flags(
        &db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    ) else {
        return out;
    };
    let Ok(mut stmt) = conn.prepare(
        "SELECT session_id, COALESCE(workspace_dir, ''), COALESCE(project_workspace_dir, ''), \
         COALESCE(history_relative_dir, '') FROM local_runtime_sessions \
         WHERE session_kind = 'conversation' AND visibility = 'visible' AND archived = 0",
    ) else {
        return out;
    };
    let Ok(rows) = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
        ))
    }) else {
        return out;
    };
    for (session_id, workspace_dir, project_dir, relative) in rows.flatten() {
        let session_id = session_id.trim();
        let relative = relative.trim().trim_matches('/');
        if session_id.is_empty() || relative.is_empty() {
            continue;
        }
        let matches = |session_workspace: &str| {
            !session_workspace.is_empty()
                && same_or_child(Path::new(session_workspace), workspace)
        };
        if !matches(workspace_dir.trim()) && !matches(project_dir.trim()) {
            continue;
        }
        // The db row can outlive a GUI-side delete (the CLI keeps its own
        // ledger); a missing transcript simply drops out of the list.
        let messages = sessions_root.join(relative).join("messages.jsonl");
        if !messages.is_file() {
            continue;
        }
        out.push(SessionFile {
            engine: "minimax",
            session_id: session_id.to_string(),
            workspace_path: workspace.to_string_lossy().to_string(),
            file_path: messages,
        });
    }
    out
}

fn agy_uris_match_workspace(uris_json: &str, workspace: &Path) -> bool {
    let Ok(uris) = serde_json::from_str::<Vec<String>>(uris_json) else {
        return false;
    };
    uris.iter()
        .any(|uri| file_uri_path(uri).is_some_and(|path| same_or_child(&path, workspace)))
}

fn file_uri_path(uri: &str) -> Option<PathBuf> {
    let rest = uri.strip_prefix("file://")?;
    Some(PathBuf::from(percent_decode_path(rest)))
}

fn percent_decode_path(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (from_hex(bytes[i + 1]), from_hex(bytes[i + 2])) {
                out.push((hi << 4) | lo);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn from_hex(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// Codex Desktop / `codex exec` writes one rollout per spawned subagent.
/// Those files reuse the parent's first user line as the title, so listing
/// them next to the parent looks like duplicate conversations. The live
/// turn already surfaces them in the subagent strip.
fn is_codex_subagent_source(source: &serde_json::Value) -> bool {
    source
        .get("subagent")
        .map(|v| v.is_object() || v.as_bool() == Some(true))
        .unwrap_or(false)
}

fn is_codex_subagent_head(head: &serde_json::Value) -> bool {
    head.get("type").and_then(|v| v.as_str()) == Some("session_meta")
        && head
            .get("payload")
            .and_then(|p| p.get("source"))
            .is_some_and(is_codex_subagent_source)
}

pub(super) fn is_codex_subagent_file(path: &Path) -> bool {
    peek_head_json_lines(path, false, 8)
        .iter()
        .any(is_codex_subagent_head)
}

/// DSH writes one session file per spawned child. The header stamps
/// `origin: "subagent"` (and a positive `delegationDepth`); listing those
/// next to the parent looks like leftover review chats. The live turn
/// already surfaces them in the subagent strip.
fn is_dsh_subagent_source(source: &serde_json::Value) -> bool {
    if source.get("origin").and_then(|v| v.as_str()) == Some("subagent") {
        return true;
    }
    source
        .get("delegationDepth")
        .and_then(|v| v.as_i64())
        .is_some_and(|depth| depth > 0)
}

fn is_dsh_subagent_head(head: &serde_json::Value) -> bool {
    head.get("type").and_then(|v| v.as_str()) == Some("session") && is_dsh_subagent_source(head)
}

pub(super) fn is_dsh_subagent_file(path: &Path) -> bool {
    peek_head_json_lines(path, true, 8)
        .iter()
        .any(is_dsh_subagent_head)
}

/// Engine file identity from the first JSON line (codex session_meta /
/// pi-family & dsh session line). Returns (session_id, cwd).
pub(super) fn identify_head(engine: &str, path: &Path) -> Option<(String, String)> {
    let expected = match engine {
        "codex" => "session_meta",
        "pi" | "omp" | "dsh" => "session",
        _ => return None,
    };
    // Scan the first few head lines: newer pi-family files prepend a
    // `title` line before the `session` line.
    for head in peek_head_json_lines(path, engine == "dsh", 8) {
        if head.get("type").and_then(|v| v.as_str()) != Some(expected) {
            continue;
        }
        let source = if engine == "codex" {
            head.get("payload")?
        } else {
            &head
        };
        if engine == "codex" && source.get("source").is_some_and(is_codex_subagent_source) {
            return None;
        }
        if engine == "dsh" && is_dsh_subagent_source(source) {
            return None;
        }
        let id = source.get("id").and_then(|v| v.as_str())?.trim();
        let cwd = source.get("cwd").and_then(|v| v.as_str())?.trim();
        if id.is_empty() || cwd.is_empty() {
            return None;
        }
        return Some((id.to_string(), cwd.to_string()));
    }
    None
}

/// Codex rollout files (readdir only, no content reads).
pub(super) fn codex_candidates() -> Vec<PathBuf> {
    // Beyond the active home, every v0.9 managed provider home keeps its
    // own sessions tree.
    let mut homes = vec![crate::engine::codex_home()];
    homes.extend(legacy_provider_homes("codex-provider-homes"));
    let mut out = Vec::new();
    for home in homes {
        for root in [home.join("sessions"), home.join("archived_sessions")] {
            let mut stack = vec![root];
            while let Some(dir) = stack.pop() {
                let Ok(entries) = std::fs::read_dir(&dir) else {
                    continue;
                };
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_dir() {
                        stack.push(path);
                    } else if path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .map(|n| n.starts_with("rollout-") && n.ends_with(".jsonl"))
                        .unwrap_or(false)
                    {
                        out.push(path);
                    }
                }
            }
        }
    }
    out
}

pub(super) fn pi_family_candidates(home_dir_name: &str) -> Vec<PathBuf> {
    let root = crate::engine::engine_home(None, home_dir_name)
        .join("agent")
        .join("sessions");
    let mut out = Vec::new();
    let Ok(cwd_dirs) = std::fs::read_dir(&root) else {
        return out;
    };
    for cwd_entry in cwd_dirs.flatten() {
        let Ok(files) = std::fs::read_dir(cwd_entry.path()) else {
            continue;
        };
        for file in files.flatten() {
            let path = file.path();
            if path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
                out.push(path);
            }
        }
    }
    out
}

/// Canonical compressed DSH log generation. v0 is `session.jsonl.zstd`;
/// later formats are `session.vN.jsonl.zstd` (no leading zeros).
pub(crate) fn dsh_log_generation(name: &str) -> Option<u32> {
    const SUFFIX: &str = ".jsonl.zstd";
    let stem = name.strip_suffix(SUFFIX)?;
    if stem == "session" {
        return Some(0);
    }
    let digits = stem.strip_prefix("session.v")?;
    if digits.is_empty() || digits.starts_with('0') || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    digits.parse().ok()
}

fn dsh_session_log(dir: &Path) -> Option<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return None;
    };
    let mut best: Option<(u32, PathBuf)> = None;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let Some(generation) = dsh_log_generation(name) else {
            continue;
        };
        if best
            .as_ref()
            .is_none_or(|(current, _)| generation > *current)
        {
            best = Some((generation, path));
        }
    }
    best.map(|(_, path)| path)
}

pub(super) fn dsh_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    for root in dir_session_anchor_roots("dsh") {
        let Ok(cwd_dirs) = std::fs::read_dir(&root) else {
            continue;
        };
        for cwd_entry in cwd_dirs.flatten() {
            let Ok(session_dirs) = std::fs::read_dir(cwd_entry.path()) else {
                continue;
            };
            for session_entry in session_dirs.flatten() {
                if let Some(file) = dsh_session_log(&session_entry.path()) {
                    out.push(file);
                }
            }
        }
    }
    out
}

pub(super) fn path_is_under(path: &str, home: &Path) -> bool {
    let path = Path::new(path);
    if path.starts_with(home) {
        return true;
    }
    match (std::fs::canonicalize(path), std::fs::canonicalize(home)) {
        (Ok(path), Ok(home)) => path.starts_with(home),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::super::scanner::tests::{scratch_dir, write_zstd_jsonl, HomeGuard, HOME_LOCK};
    use super::*;

    /// Env-mutating guard for CLAUDE_CONFIG_DIR; shares HOME_LOCK so every
    /// env-dependent scanner test stays serialized.
    struct ClaudeConfigDirGuard {
        _lock: parking_lot::MutexGuard<'static, ()>,
        prev: Option<std::ffi::OsString>,
    }
    impl ClaudeConfigDirGuard {
        fn set(dir: &Path) -> Self {
            let lock = HOME_LOCK.lock();
            let prev = std::env::var_os("CLAUDE_CONFIG_DIR");
            std::env::set_var("CLAUDE_CONFIG_DIR", dir);
            Self { _lock: lock, prev }
        }
    }
    impl Drop for ClaudeConfigDirGuard {
        fn drop(&mut self) {
            match &self.prev {
                Some(value) => std::env::set_var("CLAUDE_CONFIG_DIR", value),
                None => std::env::remove_var("CLAUDE_CONFIG_DIR"),
            }
        }
    }

    #[test]
    fn identify_head_reads_session_line_after_title_line() {
        let dir = scratch_dir("identify");
        let path = dir.join("s.jsonl");
        std::fs::write(
            &path,
            concat!(
                "{\"type\":\"title\",\"v\":1,\"title\":\"t\"}\n",
                "{\"type\":\"session\",\"version\":3,\"id\":\"abc\",\"cwd\":\"/tmp/ws\"}\n",
            ),
        )
        .unwrap();
        assert_eq!(
            identify_head("omp", &path),
            Some(("abc".to_string(), "/tmp/ws".to_string()))
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn identify_head_skips_codex_subagent_rollout() {
        let dir = scratch_dir("identify-subagent");
        let path = dir.join("s.jsonl");
        std::fs::write(
            &path,
            concat!(
                "{\"type\":\"session_meta\",\"payload\":{\"id\":\"child\",\"cwd\":\"/ws\",",
                "\"source\":{\"subagent\":{\"thread_spawn\":{\"parent_thread_id\":\"parent\",",
                "\"depth\":1,\"agent_path\":\"/root/review\",\"agent_nickname\":\"Hypatia\"}}}}}\n",
            ),
        )
        .unwrap();
        assert_eq!(identify_head("codex", &path), None);
        assert!(is_codex_subagent_file(&path));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn dsh_log_generation_reads_v0_and_later() {
        assert_eq!(dsh_log_generation("session.jsonl.zstd"), Some(0));
        assert_eq!(dsh_log_generation("session.v3.jsonl.zstd"), Some(3));
        assert_eq!(dsh_log_generation("session.v12.jsonl.zstd"), Some(12));
        assert_eq!(dsh_log_generation("session.v03.jsonl.zstd"), None);
        assert_eq!(dsh_log_generation("session.v0.jsonl.zstd"), None);
        assert_eq!(dsh_log_generation("session.jsonl"), None);
        assert_eq!(dsh_log_generation("session.lock"), None);
    }

    #[test]
    fn dsh_session_log_picks_highest_generation() {
        let dir = scratch_dir("dsh-gen");
        write_zstd_jsonl(
            &dir.join("session.jsonl.zstd"),
            &[r#"{"type":"session","id":"old"}"#],
        );
        write_zstd_jsonl(
            &dir.join("session.v3.jsonl.zstd"),
            &[r#"{"type":"session","id":"new"}"#],
        );
        std::fs::write(dir.join("session.lock"), "").unwrap();
        let picked = dsh_session_log(&dir).unwrap();
        assert_eq!(picked.file_name().unwrap(), "session.v3.jsonl.zstd");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn identify_head_skips_dsh_subagent_session() {
        let dir = scratch_dir("identify-dsh-subagent");
        let path = dir.join("session.v3.jsonl.zstd");
        write_zstd_jsonl(
            &path,
            &[
                r#"{"type":"session","version":3,"id":"child","cwd":"/ws","createdAt":1,"isSeeded":false,"origin":"subagent","parentSession":"parent","delegationDepth":1}"#,
                r#"{"type":"user/message","time":1,"data":{"content":[{"type":"text","text":"你是一名只读代码评审员"}]}}"#,
            ],
        );
        assert_eq!(identify_head("dsh", &path), None);
        assert!(is_dsh_subagent_file(&path));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn identify_head_keeps_top_level_dsh_session() {
        let dir = scratch_dir("identify-dsh-parent");
        let path = dir.join("session.v3.jsonl.zstd");
        write_zstd_jsonl(
            &path,
            &[
                r#"{"type":"session","version":3,"id":"parent","cwd":"/ws","createdAt":1,"isSeeded":false,"delegationDepth":0}"#,
            ],
        );
        assert_eq!(
            identify_head("dsh", &path),
            Some(("parent".to_string(), "/ws".to_string()))
        );
        assert!(!is_dsh_subagent_file(&path));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn identify_head_first_line_session_still_works() {
        let dir = scratch_dir("identify-old");
        let path = dir.join("s.jsonl");
        std::fs::write(
            &path,
            "{\"type\":\"session\",\"version\":3,\"id\":\"old\",\"cwd\":\"/tmp/ws\"}\n",
        )
        .unwrap();
        assert_eq!(
            identify_head("pi", &path),
            Some(("old".to_string(), "/tmp/ws".to_string()))
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn strip_verbatim_prefix_removes_windows_prefix_only() {
        assert_eq!(
            strip_verbatim_prefix(r"\\?\C:\Users\zlt\proj"),
            r"C:\Users\zlt\proj"
        );
        assert_eq!(
            strip_verbatim_prefix(r"C:\Users\zlt\proj"),
            r"C:\Users\zlt\proj"
        );
        assert_eq!(
            strip_verbatim_prefix("/Users/demo/proj"),
            "/Users/demo/proj"
        );
    }

    /// A workspace recorded with a trailing separator must still find the
    /// history the CLI wrote under the trimmed spelling, and the config root
    /// must honor CLAUDE_CONFIG_DIR.
    #[test]
    fn discover_claude_matches_trailing_slash_spelling_under_config_dir() {
        let home = scratch_dir("discover-claude");
        let config_dir = home.join("claude-config");
        let workspace = home.join("ws");
        std::fs::create_dir_all(&workspace).unwrap();
        let encoded = super::super::claude_encode_project_path(&workspace.to_string_lossy());
        let project_dir = config_dir.join("projects").join(&encoded);
        std::fs::create_dir_all(&project_dir).unwrap();
        std::fs::write(project_dir.join("s1.jsonl"), "{}\n").unwrap();

        let _guard = ClaudeConfigDirGuard::set(&config_dir);
        let spelled = PathBuf::from(format!("{}/", workspace.to_string_lossy()));
        let found = discover_claude(&spelled);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].session_id, "s1");

        std::fs::remove_dir_all(&home).ok();
    }

    fn write_kimi_wire_session(
        index_dir: &Path,
        session_dir: &Path,
        workspace: &Path,
        session_id: &str,
    ) {
        let wire = session_dir.join("agents").join("main");
        std::fs::create_dir_all(index_dir).unwrap();
        std::fs::create_dir_all(&wire).unwrap();
        std::fs::write(wire.join("wire.jsonl"), "{}\n").unwrap();
        let line = format!(
            "{{\"workDir\":\"{}\",\"sessionId\":\"{session_id}\",\"sessionDir\":\"{}\"}}",
            workspace.to_string_lossy().replace('\\', "\\\\"),
            session_dir.to_string_lossy().replace('\\', "\\\\"),
        );
        std::fs::write(index_dir.join("session_index.jsonl"), format!("{line}\n")).unwrap();
    }

    /// v0.9 upgrade path: sessions under the old CLI home (~/.kimi) and under
    /// managed provider homes (~/.ccgui/kimi-provider-homes/<id>/) must both
    /// stay discoverable next to the current ~/.kimi-code home.
    #[test]
    fn discover_kimi_reads_legacy_and_provider_homes() {
        let home = scratch_dir("discover-kimi-legacy");
        let workspace = home.join("ws");
        std::fs::create_dir_all(&workspace).unwrap();
        write_kimi_wire_session(
            &home.join(".kimi"),
            &home.join("old-cli-session"),
            &workspace,
            "old-cli",
        );
        let provider_home = home.join(".ccgui").join("kimi-provider-homes").join("p1");
        write_kimi_wire_session(
            &provider_home,
            &home.join("managed-session"),
            &workspace,
            "managed",
        );

        let _guard = HomeGuard::set(&home);
        // A stray KIMI_HOME on the host would redirect the legacy home.
        let prev_kimi_home = std::env::var_os("KIMI_HOME");
        std::env::remove_var("KIMI_HOME");
        let found = discover_kimi(&workspace);
        match &prev_kimi_home {
            Some(value) => std::env::set_var("KIMI_HOME", value),
            None => std::env::remove_var("KIMI_HOME"),
        }
        let mut ids: Vec<&str> = found.iter().map(|f| f.session_id.as_str()).collect();
        ids.sort();
        assert_eq!(ids, ["managed", "old-cli"]);

        std::fs::remove_dir_all(&home).ok();
    }

    /// v0.9 upgrade path: grok sessions written under a managed provider home
    /// keep their <encoded-cwd>/<session>/chat_history.jsonl shape.
    #[test]
    fn discover_grok_reads_provider_homes() {
        let home = scratch_dir("discover-grok-legacy");
        let workspace = home.join("ws");
        std::fs::create_dir_all(&workspace).unwrap();
        let encoded: String = workspace
            .to_string_lossy()
            .bytes()
            .map(|b| format!("%{b:02X}"))
            .collect();
        let session_dir = home
            .join(".ccgui")
            .join("grok-provider-homes")
            .join("p1")
            .join("sessions")
            .join(encoded)
            .join("g1");
        std::fs::create_dir_all(&session_dir).unwrap();
        std::fs::write(session_dir.join("chat_history.jsonl"), "{}\n").unwrap();

        let _guard = HomeGuard::set(&home);
        let found = discover_grok(&workspace);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].session_id, "g1");

        std::fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn qoder_project_slug_matches_qodercli_encoding() {
        assert_eq!(
            qoder_encode_project_slug("/Users/foo/bar"),
            "-Users-foo-bar"
        );
        assert_eq!(
            qoder_encode_project_slug("/Users/foo/bar/"),
            "-Users-foo-bar"
        );
        assert_eq!(qoder_encode_project_slug(r"C:\ws\proj"), "C--ws-proj");
        assert_eq!(qoder_encode_project_slug("/"), "-");
        assert_eq!(qoder_encode_project_slug(""), "");
    }

    #[test]
    fn discover_qoder_finds_workspace_sessions_by_slug() {
        let home = scratch_dir("discover-qoder");
        let workspace = home.join("ws").join("proj");
        std::fs::create_dir_all(&workspace).unwrap();
        let slug = qoder_encode_project_slug(&workspace.to_string_lossy());
        let dir = home.join(".qoder").join("projects").join(&slug);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("sess-1.jsonl"), "{}\n").unwrap();
        std::fs::write(dir.join("notes.txt"), "x").unwrap();

        let _guard = HomeGuard::set(&home);
        let found = discover_qoder(&workspace, crate::engine::qoder::QoderDistribution::Global);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].engine, "qoder");
        assert_eq!(found[0].session_id, "sess-1");
        assert_eq!(found[0].workspace_path, workspace.to_string_lossy());

        std::fs::remove_dir_all(&home).ok();
    }

    #[test]
    fn discover_qoder_cn_reads_the_cn_home() {
        let home = scratch_dir("discover-qoder-cn");
        let workspace = home.join("ws").join("proj");
        std::fs::create_dir_all(&workspace).unwrap();
        let slug = qoder_encode_project_slug(&workspace.to_string_lossy());
        let dir = home.join(".qoder-cn").join("projects").join(&slug);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("sess-cn.jsonl"), "{}\n").unwrap();

        let _guard = HomeGuard::set(&home);
        let found = discover_qoder(&workspace, crate::engine::qoder::QoderDistribution::Cn);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].engine, "qoder-cn");
        assert_eq!(found[0].session_id, "sess-cn");
        // The CN distribution never reads the Global home.
        assert!(
            discover_qoder(&workspace, crate::engine::qoder::QoderDistribution::Global).is_empty()
        );

        std::fs::remove_dir_all(&home).ok();
    }

    /// OpenCode session metadata jsons are matched to the workspace by their
    /// `directory` field; the project dir name is a content hash.
    #[test]
    fn discover_opencode_matches_directory_field() {
        let home = scratch_dir("discover-opencode");
        let workspace = home.join("ws");
        std::fs::create_dir_all(&workspace).unwrap();
        let project = home.join(".local/share/opencode/storage/session/b8119e41");
        std::fs::create_dir_all(&project).unwrap();
        let session = |id: &str, directory: &str| {
            serde_json::json!({
                "id": id, "projectID": "b8119e41", "directory": directory,
                "title": "t", "time": {"created": 1, "updated": 2}
            })
            .to_string()
        };
        std::fs::write(
            project.join("ses_a.json"),
            session("ses_a", &workspace.to_string_lossy()),
        )
        .unwrap();
        std::fs::write(project.join("ses_b.json"), session("ses_b", "/elsewhere")).unwrap();
        std::fs::write(project.join("broken.json"), "{ not json").unwrap();

        let _guard = HomeGuard::set(&home);
        let found = discover_opencode(&workspace);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].engine, "opencode");
        assert_eq!(found[0].session_id, "ses_a");

        std::fs::remove_dir_all(&home).ok();
    }

    /// v0.9 upgrade path: codex rollouts under managed provider homes are
    /// enumerated alongside the active home's sessions.
    #[test]
    fn codex_candidates_include_provider_homes() {
        let home = scratch_dir("codex-candidates-legacy");
        let active = home
            .join(".codex")
            .join("sessions")
            .join("2026")
            .join("09")
            .join("01");
        let managed = home
            .join(".ccgui")
            .join("codex-provider-homes")
            .join("p1")
            .join("sessions")
            .join("2026")
            .join("08")
            .join("19");
        std::fs::create_dir_all(&active).unwrap();
        std::fs::create_dir_all(&managed).unwrap();
        std::fs::write(active.join("rollout-2026-09-01T00-00-00-new.jsonl"), "").unwrap();
        std::fs::write(managed.join("rollout-2026-08-19T00-00-00-old.jsonl"), "").unwrap();

        let _guard = HomeGuard::set(&home);
        let prev_codex_home = std::env::var_os("CODEX_HOME");
        std::env::remove_var("CODEX_HOME");
        let found = codex_candidates();
        match &prev_codex_home {
            Some(value) => std::env::set_var("CODEX_HOME", value),
            None => std::env::remove_var("CODEX_HOME"),
        }
        let names: Vec<String> = found
            .iter()
            .filter_map(|p| p.file_name().map(|n| n.to_string_lossy().to_string()))
            .collect();
        assert!(names.iter().any(|n| n.contains("new")));
        assert!(names.iter().any(|n| n.contains("old")));

        std::fs::remove_dir_all(&home).ok();
    }

    /// A first line past MAX_HEAD_BYTES must terminate the chunked read at
    /// the cap — no full-file read, no hang; identification just comes back
    /// empty and the file is skipped.
    #[test]
    fn peek_head_stays_bounded_when_line_exceeds_cap() {
        let dir = scratch_dir("peek-cap");
        let path = dir.join("big.jsonl");
        let huge = "x".repeat(2 * 1024 * 1024);
        std::fs::write(
            &path,
            format!(
                "{{\"type\":\"session_meta\",\"payload\":{{\"id\":\"a\",\"cwd\":\"{huge}\"}}}}}}\n"
            ),
        )
        .unwrap();
        assert!(peek_head_json_lines(&path, false, 8).is_empty());
        assert_eq!(identify_head("codex", &path), None);
        std::fs::remove_dir_all(&dir).ok();
    }

    /// minimax: runtime sqlite rows are the only workspace→session link; a
    /// row without a transcript on disk (GUI-side delete leaves the CLI's
    /// row behind) must drop out instead of resurrecting.
    #[test]
    fn discover_minimax_links_runtime_rows_to_transcripts() {
        let home = scratch_dir("discover-minimax");
        let data = home.join("minimax-data");
        let workspace = home.join("ws");
        let relative = "2026/09/20/17-19-21-163-session_bXZzX2Nj";
        let session_dir = data.join("v2").join("sessions").join(relative);
        std::fs::create_dir_all(&session_dir).unwrap();
        std::fs::write(session_dir.join("manifest.json"), "{}\n").unwrap();
        std::fs::write(session_dir.join("messages.jsonl"), "{}\n").unwrap();

        let db_dir = data.join("v2").join("sqlite");
        std::fs::create_dir_all(&db_dir).unwrap();
        let conn = rusqlite::Connection::open(db_dir.join("runtime-state.sqlite")).unwrap();
        let ws = workspace.to_string_lossy().replace('\'', "''");
        conn.execute_batch(&format!(
            "CREATE TABLE local_runtime_sessions (
                session_id TEXT PRIMARY KEY, workspace_dir TEXT, project_workspace_dir TEXT,
                history_relative_dir TEXT, session_kind TEXT, visibility TEXT, archived INTEGER);
            INSERT INTO local_runtime_sessions VALUES ('mvs_hit', '{ws}', '{ws}', '{relative}', 'conversation', 'visible', 0);
            INSERT INTO local_runtime_sessions VALUES ('mvs_other_workspace', '/elsewhere', '/elsewhere', '{relative}', 'conversation', 'visible', 0);
            INSERT INTO local_runtime_sessions VALUES ('mvs_task', '{ws}', '{ws}', '{relative}', 'task', 'visible', 0);
            INSERT INTO local_runtime_sessions VALUES ('mvs_archived', '{ws}', '{ws}', '{relative}', 'conversation', 'visible', 1);
            INSERT INTO local_runtime_sessions VALUES ('mvs_missing_transcript', '{ws}', '{ws}', 'gone/session', 'conversation', 'visible', 0);",
        ))
        .unwrap();

        let prev = std::env::var_os("MINIMAX_DATA_DIR");
        std::env::set_var("MINIMAX_DATA_DIR", &data);
        let found = discover_minimax(&workspace);
        match &prev {
            Some(value) => std::env::set_var("MINIMAX_DATA_DIR", value),
            None => std::env::remove_var("MINIMAX_DATA_DIR"),
        }
        assert_eq!(found.len(), 1, "only the matching visible conversation");
        assert_eq!(found[0].session_id, "mvs_hit");
        assert!(found[0].file_path.ends_with("messages.jsonl"));
        std::fs::remove_dir_all(&home).ok();
    }
}
