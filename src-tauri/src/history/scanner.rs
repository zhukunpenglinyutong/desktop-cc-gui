use super::{same_or_child, scan_summary_file, stat_signature, ScanSummary, SessionFile};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// Bump when title derivation changes so unchanged files still re-title.
const TITLE_VERSION: &str = "8";

/// Titles matching these prefixes were derived before envelope stripping
/// existed; one migration pass re-derives them even when files are unchanged.
const NOISE_TITLE_WHERE: &str = "title LIKE '<file %' ESCAPE '\\'
     OR title LIKE '[Image #%' ESCAPE '\\'
     OR title LIKE '<user\\_info%' ESCAPE '\\'
     OR title LIKE '<user\\_query%' ESCAPE '\\'
     OR title LIKE '# AGENTS.md instructions%'
     OR title LIKE '<environment\\_context%' ESCAPE '\\'
     OR title LIKE '<agents-instructions%'
     OR title LIKE '<skill>%'
     OR title LIKE '<recommended\\_plugins%' ESCAPE '\\'
     OR title LIKE '<command-message%'
     OR title LIKE '<command-name%'
     OR title LIKE '<INSTRUCTIONS>%'";

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

fn discover_claude(workspace: &Path) -> Vec<SessionFile> {
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
    fn push(out: &mut Vec<PathBuf>, seen: &mut std::collections::HashSet<String>, base: &Path, spelling: &str) {
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

fn discover_kimi(workspace: &Path) -> Vec<SessionFile> {
    // Current CLI home, the v0.9-era CLI home (`~/.kimi`, KIMI_HOME
    // override), and every v0.9 managed provider home.
    let mut homes = vec![crate::engine::engine_home(None, ".kimi-code")];
    homes.push(crate::engine::engine_home(Some("KIMI_HOME"), ".kimi"));
    homes.extend(legacy_provider_homes("kimi-provider-homes"));
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
    value.replace('/', "-")
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
fn discover_qoder(
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
    if let Some(home) = dirs::home_dir() {
        roots.push(home.join(".local").join("share").join("opencode"));
    }
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
fn discover_opencode(workspace: &Path) -> Vec<SessionFile> {
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
                let directory = meta
                    .get("directory")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if directory.is_empty() || !same_or_child(Path::new(directory), workspace) {
                    continue;
                }
                let session_id = meta
                    .get("id")
                    .and_then(|v| v.as_str())
                    .map(str::to_string)
                    .or_else(|| path.file_stem().and_then(|s| s.to_str()).map(str::to_string))
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

fn discover_grok(workspace: &Path) -> Vec<SessionFile> {
    let mut roots = vec![crate::engine::engine_home(Some("GROK_HOME"), ".grok").join("sessions")];
    roots.extend(
        legacy_provider_homes("grok-provider-homes")
            .into_iter()
            .map(|home| home.join("sessions")),
    );
    let mut out = Vec::new();
    for root in roots {
        out.extend(discover_grok_in(&root, workspace));
    }
    out
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
fn discover_agy(workspace: &Path) -> Vec<SessionFile> {
    let home = crate::engine::agy::agy_home();
    let conv_dir = home.join("conversations");
    let mut by_id: std::collections::HashMap<String, PathBuf> = std::collections::HashMap::new();

    if let Ok(conn) = rusqlite::Connection::open_with_flags(
        home.join("conversation_summaries.db"),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    ) {
        if let Ok(mut stmt) = conn.prepare(
            "SELECT conversation_id, workspace_uris FROM conversation_summaries",
        ) {
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

fn agy_uris_match_workspace(uris_json: &str, workspace: &Path) -> bool {
    let Ok(uris) = serde_json::from_str::<Vec<String>>(uris_json) else {
        return false;
    };
    uris.iter().any(|uri| {
        file_uri_path(uri).is_some_and(|path| same_or_child(&path, workspace))
    })
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

// ==================== Scan ====================

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanReport {
    pub scanned: usize,
    pub reparsed: usize,
    pub reused: usize,
}

/// One candidate session file on disk, identified lazily.
struct Candidate {
    engine: &'static str,
    path: PathBuf,
    /// Session id known from the filename/index without reading the file.
    known_id: Option<String>,
    /// Workspace attribution without reading the file (filename-keyed engines).
    known_workspace: Option<String>,
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

fn is_codex_subagent_file(path: &Path) -> bool {
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

fn is_dsh_subagent_file(path: &Path) -> bool {
    peek_head_json_lines(path, true, 8)
        .iter()
        .any(is_dsh_subagent_head)
}

/// Engine file identity from the first JSON line (codex session_meta /
/// pi-family & dsh session line). Returns (session_id, cwd).
fn identify_head(engine: &str, path: &Path) -> Option<(String, String)> {
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
fn codex_candidates() -> Vec<PathBuf> {
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

fn pi_family_candidates(home_dir_name: &str) -> Vec<PathBuf> {
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
fn dsh_log_generation(name: &str) -> Option<u32> {
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
        if best.as_ref().is_none_or(|(current, _)| generation > *current) {
            best = Some((generation, path));
        }
    }
    best.map(|(_, path)| path)
}

fn dsh_candidates() -> Vec<PathBuf> {
    let root = crate::engine::engine_home(Some("DSH_HOME"), ".dsh").join("sessions");
    let mut out = Vec::new();
    let Ok(cwd_dirs) = std::fs::read_dir(&root) else {
        return out;
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
    out
}

/// The scan only ever needs the
/// db and the event sink, so callers pass those two directly.
fn scan_with_sink(
    db: &crate::db::Db,
    sink: &Arc<crate::event_sink::EventSink>,
) -> Result<ScanReport, String> {
    let changed_sink = Arc::clone(sink);
    let progress_sink = Arc::clone(sink);
    scan_inner(
        db,
        move || changed_sink.emit_sessions_changed(),
        move |p| progress_sink.emit_scan_progress(p),
    )
}

/// The scan itself, decoupled from the event sink for testing.
pub fn scan_with(db: &crate::db::Db, on_changed: impl Fn()) -> Result<ScanReport, String> {
    scan_inner(db, on_changed, |_| {})
}

// ---------- phase helpers (each stage is lock-free except where noted) ----------

/// Enumerate every candidate session file (readdir/index only, no content).
fn gather_candidates(workspaces: &[String]) -> Vec<Candidate> {
    let mut candidates: Vec<Candidate> = Vec::new();
    let mut seen_paths: std::collections::HashSet<PathBuf> = std::collections::HashSet::new();
    for workspace_path in workspaces {
        let workspace = PathBuf::from(workspace_path);
        // Filename/index-keyed engines identify cheaply per workspace.
        for file in discover_claude(&workspace)
            .into_iter()
            .chain(discover_kimi(&workspace))
            .chain(discover_grok(&workspace))
            .chain(discover_agy(&workspace))
            .chain(discover_qoder(&workspace, crate::engine::qoder::QoderDistribution::Global))
            .chain(discover_qoder(&workspace, crate::engine::qoder::QoderDistribution::Cn))
            .chain(discover_opencode(&workspace))
        {
            if seen_paths.insert(file.file_path.clone()) {
                candidates.push(Candidate {
                    engine: file.engine,
                    path: file.file_path,
                    known_id: Some(file.session_id),
                    known_workspace: Some(file.workspace_path),
                });
            }
        }
    }
    // Head-keyed engines: enumerate once, attribute by content on change.
    for (engine, paths) in [
        ("codex", codex_candidates()),
        ("pi", pi_family_candidates(".pi")),
        ("omp", pi_family_candidates(".omp")),
        ("dsh", dsh_candidates()),
    ] {
        for path in paths {
            if seen_paths.insert(path.clone()) {
                candidates.push(Candidate {
                    engine,
                    path,
                    known_id: None,
                    known_workspace: None,
                });
            }
        }
    }
    candidates
}

/// Stat every candidate and fold (path, size, mtime) into one signature.
fn stat_all(workspaces: &[String], candidates: &[Candidate]) -> (Vec<Option<(i64, i64)>>, String) {
    let mut signature_hasher = Sha256::new();
    signature_hasher.update(format!("v{}|", crate::db::CACHE_VERSION).as_bytes());
    signature_hasher.update(b"codex_home=");
    signature_hasher.update(crate::engine::codex_home().to_string_lossy().as_bytes());
    signature_hasher.update(b"|");
    for w in workspaces {
        signature_hasher.update(w.as_bytes());
        signature_hasher.update(b"|");
    }
    let mut stats: Vec<Option<(i64, i64)>> = Vec::with_capacity(candidates.len());
    for cand in candidates {
        let sig = stat_signature(&cand.path);
        if let Some((size, mtime_ms)) = sig {
            signature_hasher.update(cand.path.to_string_lossy().as_bytes());
            signature_hasher.update(size.to_le_bytes());
            signature_hasher.update(mtime_ms.to_le_bytes());
        }
        stats.push(sig);
    }
    (stats, format!("{:x}", signature_hasher.finalize()))
}

/// Tier-1 gate (brief lock): a matching global signature means nothing
/// changed and the scan short-circuits. Also decides whether the one-time
/// title re-derivation migration is still pending.
struct Tier1 {
    signature: String,
    retitle_pending: bool,
}

fn tier1_gate(db: &crate::db::Db, signature: String) -> Result<Option<Tier1>, String> {
    let conn = db.0.lock();
    let previous: Option<String> = conn
        .query_row(
            "SELECT value FROM meta WHERE key='stat_signature'",
            [],
            |r| r.get(0),
        )
        .ok();
    let row_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0))
        .unwrap_or(0);
    let title_version: Option<String> = conn
        .query_row(
            "SELECT value FROM meta WHERE key='title_version'",
            [],
            |r| r.get(0),
        )
        .ok();
    // One-time migration: titles derived before envelope stripping
    // (`<file …` / `[Image #…` / `<user_info>`) or rows with no timestamps
    // force a single re-derivation even when files are unchanged.
    let retitle_pending = title_version.as_deref() != Some(TITLE_VERSION)
        && conn
            .query_row(
                &format!(
                    "SELECT COUNT(*) FROM sessions WHERE {NOISE_TITLE_WHERE} OR updated_at IS NULL"
                ),
                [],
                |r| r.get::<_, i64>(0),
            )
            .map_err(|e| e.to_string())?
            > 0;
    if previous.as_deref() == Some(signature.as_str()) && row_count > 0 && !retitle_pending {
        return Ok(None);
    }
    Ok(Some(Tier1 {
        signature,
        retitle_pending,
    }))
}

/// Prefetch (brief lock) the stored per-file stat keys and, while the
/// re-title migration runs, the paths whose titles are still noise. Lets the
/// parse phase decide "unchanged" without holding the db lock.
fn prefetch_stat_keys(
    db: &crate::db::Db,
    retitle_pending: bool,
) -> Result<
    (
        std::collections::HashMap<String, (i64, i64)>,
        std::collections::HashSet<String>,
    ),
    String,
> {
    let conn = db.0.lock();
    let mut stmt = conn
        .prepare("SELECT file_path, file_size, file_mtime_ms FROM sessions")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, i64>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut stats = std::collections::HashMap::new();
    for row in rows {
        match row {
            Ok((path, size, mtime)) => {
                stats.insert(path, (size, mtime));
            }
            Err(e) => eprintln!("[scanner] skipping undecodable session stat row: {e}"),
        }
    }
    let mut stale = std::collections::HashSet::new();
    if retitle_pending {
        let mut stmt = conn
            .prepare(&format!(
                "SELECT file_path FROM sessions WHERE {NOISE_TITLE_WHERE} OR updated_at IS NULL"
            ))
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        for row in rows {
            match row {
                Ok(path) => {
                    stale.insert(path);
                }
                Err(e) => eprintln!("[scanner] skipping undecodable stale-title row: {e}"),
            }
        }
    }
    Ok((stats, stale))
}

/// One changed file fully processed outside the db lock: identity peek (for
/// head-keyed engines) + the lightweight summary parse.
struct PreparedUpsert {
    engine: &'static str,
    session_id: String,
    workspace_path: String,
    path_str: String,
    size: i64,
    mtime_ms: i64,
    summary: ScanSummary,
}

fn prepare_candidate(
    cand: &Candidate,
    sig: (i64, i64),
    stat_keys: &std::collections::HashMap<String, (i64, i64)>,
    stale_paths: &std::collections::HashSet<String>,
    workspaces: &[String],
) -> Option<PreparedUpsert> {
    let (size, mtime_ms) = sig;
    let path_str = cand.path.to_string_lossy().to_string();
    // Unchanged on disk (stat key match) and not pending re-title: reuse.
    if stat_keys.get(&path_str) == Some(&sig) && !stale_paths.contains(&path_str) {
        return None;
    }
    // Identify the session (peek only for head-keyed engines).
    let (session_id, workspace_path) = match (&cand.known_id, &cand.known_workspace) {
        (Some(id), Some(ws)) => (id.clone(), ws.clone()),
        _ => {
            let Some((id, cwd)) = identify_head(cand.engine, &cand.path) else {
                return None;
            };
            // Attribute only files belonging to a registered workspace.
            if !workspaces
                .iter()
                .any(|w| same_or_child(Path::new(&cwd), Path::new(w)))
            {
                return None;
            }
            (id, cwd)
        }
    };
    let summary = scan_summary_file(cand.engine, &cand.path).ok()?;
    Some(PreparedUpsert {
        engine: cand.engine,
        session_id,
        workspace_path,
        path_str,
        size,
        mtime_ms,
        summary,
    })
}

/// Drop Codex / DSH subagent sessions that were indexed as top-level chats.
/// Returns true when any row was removed.
fn prune_hidden_subagent_sessions(db: &crate::db::Db) -> Result<bool, String> {
    let a = prune_engine_subagent_sessions(db, "codex", is_codex_subagent_file)?;
    let b = prune_engine_subagent_sessions(db, "dsh", is_dsh_subagent_file)?;
    Ok(a || b)
}

fn prune_engine_subagent_sessions(
    db: &crate::db::Db,
    engine: &str,
    is_subagent: fn(&Path) -> bool,
) -> Result<bool, String> {
    let paths: Vec<(String, String)> = {
        let conn = db.0.lock();
        let mut stmt = conn
            .prepare("SELECT session_id, file_path FROM sessions WHERE engine=?1")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([engine], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for row in rows {
            match row {
                Ok(pair) => out.push(pair),
                Err(e) => eprintln!("[scanner] skipping undecodable {engine} session row: {e}"),
            }
        }
        out
    };
    let dead: Vec<String> = paths
        .into_iter()
        .filter(|(_, path)| is_subagent(Path::new(path)))
        .map(|(id, _)| id)
        .collect();
    if dead.is_empty() {
        return Ok(false);
    }
    let conn = db.0.lock();
    for id in &dead {
        conn.execute(
            "DELETE FROM sessions WHERE engine=?1 AND session_id=?2",
            rusqlite::params![engine, id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(true)
}

fn path_is_under(path: &str, home: &Path) -> bool {
    let path = Path::new(path);
    if path.starts_with(home) {
        return true;
    }
    match (std::fs::canonicalize(path), std::fs::canonicalize(home)) {
        (Ok(path), Ok(home)) => path.starts_with(home),
        _ => false,
    }
}

/// Drop Codex rows indexed from a previous CODEX_HOME after the user points
/// CLI 管理 at another directory. Returns true when any row was removed.
///
/// No custom home → no-op. Default `~/.codex` users must not lose history
/// because of a path-prefix mismatch (symlink, case, missing file).
fn prune_codex_sessions_outside_home(db: &crate::db::Db) -> Result<bool, String> {
    #[cfg(not(test))]
    {
        let custom = crate::settings::read_settings()
            .ok()
            .and_then(|s| s.codex_home)
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
        if custom.is_none() {
            return Ok(false);
        }
    }
    let home = crate::engine::codex_home();
    // v0.9 provider-home sessions live outside any codex home but stay
    // valid history; pruning them would re-hide upgraded users' sessions.
    let legacy_root = crate::paths::legacy_home().join("codex-provider-homes");
    let paths: Vec<(String, String)> = {
        let conn = db.0.lock();
        let mut stmt = conn
            .prepare("SELECT session_id, file_path FROM sessions WHERE engine='codex'")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for row in rows {
            match row {
                Ok(pair) => out.push(pair),
                Err(e) => eprintln!("[scanner] skipping undecodable codex session row: {e}"),
            }
        }
        out
    };
    let dead: Vec<String> = paths
        .into_iter()
        .filter(|(_, path)| !path_is_under(path, &home) && !path_is_under(path, &legacy_root))
        .map(|(id, _)| id)
        .collect();
    if dead.is_empty() {
        return Ok(false);
    }
    let mut conn = db.0.lock();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for id in &dead {
        tx.execute(
            "DELETE FROM sessions WHERE engine='codex' AND session_id=?1",
            rusqlite::params![id],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(true)
}

fn prune_stale_sessions(db: &crate::db::Db) -> Result<bool, String> {
    let outside = prune_codex_sessions_outside_home(db)?;
    let subagent = prune_hidden_subagent_sessions(db)?;
    Ok(outside || subagent)
}

/// Phase B (one lock, one transaction): upsert every prepared row, then
/// record the signature that makes the next scan a short-circuit.
fn upsert_rows(db: &crate::db::Db, rows: &[PreparedUpsert], tier1: &Tier1) -> Result<(), String> {
    let mut conn = db.0.lock();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for row in rows {
        // Engines whose jsonl has no per-line timestamps would otherwise land
        // at updated_at=0 and fall off the sidebar's recent list. File mtime
        // is the fallback for every engine, not a grok-only special case.
        let created_at = row.summary.first_ts.or(Some(row.mtime_ms));
        let updated_at = row.summary.last_ts.or(Some(row.mtime_ms));
        tx.execute(
            "INSERT INTO sessions(engine, session_id, workspace_path, file_path, file_size, file_mtime_ms, title, preview, created_at, updated_at, message_count)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)
             ON CONFLICT(engine, session_id) DO UPDATE SET
                workspace_path=excluded.workspace_path,
                file_path=excluded.file_path,
                file_size=excluded.file_size,
                file_mtime_ms=excluded.file_mtime_ms,
                title=excluded.title,
                preview=excluded.preview,
                created_at=COALESCE(sessions.created_at, excluded.created_at),
                updated_at=excluded.updated_at,
                message_count=excluded.message_count",
            rusqlite::params![
                row.engine,
                row.session_id,
                row.workspace_path,
                row.path_str,
                row.size,
                row.mtime_ms,
                row.summary.title,
                row.summary.preview,
                created_at,
                updated_at,
                row.summary.message_count,
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.execute(
        "INSERT INTO meta(key, value) VALUES('stat_signature', ?1)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        rusqlite::params![tier1.signature],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO meta(key, value) VALUES('title_version', ?1)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [TITLE_VERSION],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

/// `on_progress` fires throttled during the parse loop and once with
/// `finished: true` when a scan that emitted any progress completes.
fn scan_inner(
    db: &crate::db::Db,
    on_changed: impl Fn(),
    on_progress: impl Fn(crate::event_sink::ScanProgress),
) -> Result<ScanReport, String> {
    let workspaces = db.workspace_paths()?;
    let candidates = gather_candidates(&workspaces);
    let (stats, signature) = stat_all(&workspaces, &candidates);
    let Some(tier1) = tier1_gate(db, signature)? else {
        let pruned = prune_stale_sessions(db)?;
        if super::codex_titles::sync(db)? || pruned {
            on_changed();
        }
        return Ok(ScanReport {
            scanned: candidates.len(),
            reparsed: 0,
            reused: candidates.len(),
        });
    };
    let (stat_keys, stale_paths) = prefetch_stat_keys(db, tier1.retitle_pending)?;

    // Phase A (lock-free): parse changed files, collect rows to upsert.
    let total = candidates.len();
    let step = (total / 50).max(1);
    if total > 0 {
        on_progress(crate::event_sink::ScanProgress {
            done: 0,
            total,
            finished: false,
        });
    }
    let mut rows = Vec::new();
    let mut reused = 0usize;
    for (index, (cand, sig)) in candidates.iter().zip(stats.iter()).enumerate() {
        let processed = index + 1;
        if processed % step == 0 {
            on_progress(crate::event_sink::ScanProgress {
                done: processed,
                total,
                finished: false,
            });
        }
        let Some(sig) = sig else {
            continue;
        };
        match prepare_candidate(cand, *sig, &stat_keys, &stale_paths, &workspaces) {
            Some(row) => rows.push(row),
            None => {
                if stat_keys.get(&cand.path.to_string_lossy().to_string()) == Some(sig) {
                    reused += 1;
                }
            }
        }
    }

    // Phase B: the db lock is held only for the upsert transaction.
    let reparsed = rows.len();
    upsert_rows(db, &rows, &tier1)?;
    prune_stale_sessions(db)?;
    super::codex_titles::sync(db)?;
    on_changed();
    if total > 0 {
        on_progress(crate::event_sink::ScanProgress {
            done: total,
            total,
            finished: true,
        });
    }
    Ok(ScanReport {
        scanned: total,
        reparsed,
        reused,
    })
}

/// Spawn a background scan off the Tauri runtime. Concurrent invocations
/// collapse: a scan already in flight makes the new call a no-op.
pub fn spawn_scan(db: Arc<crate::db::Db>, sink: Arc<crate::event_sink::EventSink>) {
    use std::sync::atomic::{AtomicBool, Ordering};
    static SCAN_RUNNING: AtomicBool = AtomicBool::new(false);
    if SCAN_RUNNING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }
    tauri::async_runtime::spawn_blocking(move || {
        // RAII so a panicking scan still frees the slot for the next one.
        struct ResetOnDrop;
        impl Drop for ResetOnDrop {
            fn drop(&mut self) {
                SCAN_RUNNING.store(false, Ordering::SeqCst);
            }
        }
        let _guard = ResetOnDrop;
        if let Err(error) = scan_with_sink(&db, &sink) {
            eprintln!("[scanner] scan failed: {error}");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Point HOME at a scratch dir for the duration of a test.
    /// Serialized: two tests mutating HOME in parallel would clobber each other.
    static HOME_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    struct HomeGuard {
        _lock: std::sync::MutexGuard<'static, ()>,
        prev: HomeEnvPair,
    }
    impl HomeGuard {
        fn set(home: &Path) -> Self {
            let lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            let prev = std::env::var_os("HOME");
            std::env::set_var("HOME", home);
            // engine_home's test fallback reads HOME, then USERPROFILE on
            // Windows — both must point at the scratch home, and BOTH must
            // be restored on drop even when HOME was unset before (the
            // typical Windows case).
            let prev_profile = std::env::var_os("USERPROFILE");
            std::env::set_var("USERPROFILE", home);
            Self {
                _lock: lock,
                prev: HomeEnvPair(prev, prev_profile),
            }
        }
    }

    struct HomeEnvPair(
        Option<std::ffi::OsString>,
        Option<std::ffi::OsString>,
    );

    impl Drop for HomeGuard {
        fn drop(&mut self) {
            let HomeEnvPair(home, profile) = &self.prev;
            match home {
                Some(value) => std::env::set_var("HOME", value),
                None => std::env::remove_var("HOME"),
            }
            match profile {
                Some(value) => std::env::set_var("USERPROFILE", value),
                None => std::env::remove_var("USERPROFILE"),
            }
        }
    }

    fn scratch_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ccgui-{tag}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
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

    fn write_zstd_jsonl(path: &Path, lines: &[&str]) {
        use std::io::Write;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        let file = std::fs::File::create(path).unwrap();
        let mut encoder = zstd::stream::write::Encoder::new(file, 0).unwrap();
        for line in lines {
            encoder.write_all(line.as_bytes()).unwrap();
            encoder.write_all(b"\n").unwrap();
        }
        encoder.finish().unwrap();
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
        write_zstd_jsonl(&dir.join("session.jsonl.zstd"), &[r#"{"type":"session","id":"old"}"#]);
        write_zstd_jsonl(&dir.join("session.v3.jsonl.zstd"), &[r#"{"type":"session","id":"new"}"#]);
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
            &[r#"{"type":"session","version":3,"id":"parent","cwd":"/ws","createdAt":1,"isSeeded":false,"delegationDepth":0}"#],
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

    /// Env-mutating guard for CLAUDE_CONFIG_DIR; shares HOME_LOCK so every
    /// env-dependent scanner test stays serialized.
    struct ClaudeConfigDirGuard {
        _lock: std::sync::MutexGuard<'static, ()>,
        prev: Option<std::ffi::OsString>,
    }
    impl ClaudeConfigDirGuard {
        fn set(dir: &Path) -> Self {
            let lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
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
    fn strip_verbatim_prefix_removes_windows_prefix_only() {
        assert_eq!(strip_verbatim_prefix(r"\\?\C:\Users\zlt\proj"), r"C:\Users\zlt\proj");
        assert_eq!(strip_verbatim_prefix(r"C:\Users\zlt\proj"), r"C:\Users\zlt\proj");
        assert_eq!(strip_verbatim_prefix("/Users/demo/proj"), "/Users/demo/proj");
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

    fn write_kimi_wire_session(index_dir: &Path, session_dir: &Path, workspace: &Path, session_id: &str) {
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
        write_kimi_wire_session(&home.join(".kimi"), &home.join("old-cli-session"), &workspace, "old-cli");
        let provider_home = home.join(".ccgui").join("kimi-provider-homes").join("p1");
        write_kimi_wire_session(&provider_home, &home.join("managed-session"), &workspace, "managed");

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
        assert_eq!(qoder_encode_project_slug("/Users/foo/bar"), "-Users-foo-bar");
        assert_eq!(qoder_encode_project_slug("/Users/foo/bar/"), "-Users-foo-bar");
        assert_eq!(qoder_encode_project_slug(r"C:\ws\proj"), "C:-ws-proj");
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
        let active = home.join(".codex").join("sessions").join("2026").join("09").join("01");
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

    /// A custom codex home must not prune sessions indexed from a v0.9
    /// managed provider home — they live outside every codex home by design.
    #[test] 
    fn prune_codex_outside_home_keeps_provider_home_sessions() -> Result<(), String> {
        let home = scratch_dir("prune-codex-legacy");
        let _guard = HomeGuard::set(&home);
        let legacy_dir = home.join(".ccgui").join("codex-provider-homes").join("p1").join("sessions");
        let other_dir = home.join("elsewhere");
        std::fs::create_dir_all(&legacy_dir).map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&other_dir).map_err(|e| e.to_string())?;
        let legacy_file = legacy_dir.join("rollout-old.jsonl");
        let other_file = other_dir.join("rollout-stray.jsonl");
        std::fs::write(&legacy_file, "").map_err(|e| e.to_string())?;
        std::fs::write(&other_file, "").map_err(|e| e.to_string())?;

        let db = crate::db::Db::open_at(&home.join("app.db")).map_err(|e| e.to_string())?;
        {
            let conn = db.0.lock();
            for (id, path) in [("keep", &legacy_file), ("drop", &other_file)] {
                conn.execute(
                    "INSERT INTO sessions(engine, session_id, workspace_path, file_path, file_size, file_mtime_ms, title) VALUES('codex', ?1, '/ws', ?2, 0, 0, 't')",
                    rusqlite::params![id, path.to_string_lossy().to_string()],
                )
                .map_err(|e| e.to_string())?;
            }
        }
        let removed = prune_codex_sessions_outside_home(&db)?;
        assert!(removed);
        let remaining: Vec<String> = {
            let conn = db.0.lock();
            let mut stmt = conn
                .prepare("SELECT session_id FROM sessions ORDER BY session_id")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |r| r.get(0))
                .map_err(|e| e.to_string())?
                .collect::<rusqlite::Result<Vec<String>>>()
                .map_err(|e| e.to_string())?;
            rows
        };
        assert_eq!(remaining, ["keep"]);

        drop(db);
        std::fs::remove_dir_all(&home).ok();
        Ok(())
    }

    /// End-to-end: an omp file with a prepended title line is attributed to
    /// a registered workspace and parsed into the sessions table.
    #[test]
    fn scan_attributes_omp_session_with_title_head() -> Result<(), String> {
        let home = scratch_dir("scan-home");
        let workspace = home.join("ws");
        let sessions_dir = home.join(".omp").join("agent").join("sessions").join("-ws");
        std::fs::create_dir_all(&sessions_dir).map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&workspace).map_err(|e| e.to_string())?;
        std::fs::write(
            sessions_dir.join("s.jsonl"),
            format!(
                "{}\n{}\n{}\n",
                "{\"type\":\"title\",\"v\":1,\"title\":\"t\"}",
                format!(
                    "{{\"type\":\"session\",\"version\":3,\"id\":\"sid-1\",\"timestamp\":\"2026-09-05T07:13:57.946Z\",\"cwd\":\"{}\"}}",
                    workspace.display().to_string().replace('\\', "\\\\")
                ),
                "{\"type\":\"message\",\"timestamp\":\"2026-09-05T07:14:06.682Z\",\"message\":{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"hello\"}]}}",
            ),
        )
        .map_err(|e| e.to_string())?;

        let _guard = HomeGuard::set(&home);
        let db = crate::db::Db::open_at(&home.join("app.db")).map_err(|e| e.to_string())?;
        {
            let conn = db.0.lock();
            conn.execute(
                "INSERT INTO workspaces(id, path, name) VALUES('w1', ?1, 'ws')",
                [workspace.to_string_lossy().to_string()],
            )
            .map_err(|e| e.to_string())?;
        }
        let report = scan_with(&db, || {})?;
        assert_eq!(report.reparsed, 1);
        let title: String = {
            let conn = db.0.lock();
            conn.query_row(
                "SELECT title FROM sessions WHERE engine='omp' AND session_id='sid-1'",
                [],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?
        };
        assert_eq!(title, "hello");

        // Simulate a v6 cache with an unchanged rollout and an injected title.
        // The migration must bypass both stat caches and preserve custom titles.
        {
            let conn = db.0.lock();
            conn.execute(
                "UPDATE sessions SET title='<recommended_plugins>plugins', custom_title='My title'",
                [],
            )
            .map_err(|e| e.to_string())?;
            conn.execute("UPDATE meta SET value='6' WHERE key='title_version'", [])
                .map_err(|e| e.to_string())?;
        }
        let report = scan_with(&db, || {})?;
        assert_eq!(report.reparsed, 1);
        {
            let conn = db.0.lock();
            let (title, custom): (String, String) = conn
                .query_row(
                    "SELECT title, custom_title FROM sessions WHERE session_id='sid-1'",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .map_err(|e| e.to_string())?;
            assert_eq!(title, "hello");
            assert_eq!(custom, "My title");
            let version: String = conn
                .query_row(
                    "SELECT value FROM meta WHERE key='title_version'",
                    [],
                    |r| r.get(0),
                )
                .map_err(|e| e.to_string())?;
            assert_eq!(version, TITLE_VERSION);
        }
        assert_eq!(scan_with(&db, || {})?.reparsed, 0);
        drop(db);
        std::fs::remove_dir_all(&home).ok();
        Ok(())
    }

    /// Grok injects `<user_info>` as the first user turn and omits per-line
    /// timestamps. Scan must still title from `<user_query>` and sort by mtime.
    #[test]
    fn scan_grok_titles_from_user_query_and_uses_mtime() -> Result<(), String> {
        let home = scratch_dir("scan-grok-home");
        let workspace = home.join("ws");
        std::fs::create_dir_all(&workspace).map_err(|e| e.to_string())?;
        let encoded: String = workspace
            .to_string_lossy()
            .bytes()
            .map(|b| {
                if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
                    (b as char).to_string()
                } else {
                    format!("%{b:02X}")
                }
            })
            .collect();
        let session_dir = home
            .join(".grok")
            .join("sessions")
            .join(&encoded)
            .join("sid-grok");
        std::fs::create_dir_all(&session_dir).map_err(|e| e.to_string())?;
        std::fs::write(
            session_dir.join("chat_history.jsonl"),
            concat!(
                "{\"type\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"<user_info>\\nOS Version: macos\\n</user_info>\"}]}\n",
                "{\"type\":\"user\",\"synthetic_reason\":\"system_reminder\",\"content\":[{\"type\":\"text\",\"text\":\"<system-reminder>x</system-reminder>\"}]}\n",
                "{\"type\":\"user\",\"prompt_index\":0,\"content\":[{\"type\":\"text\",\"text\":\"<user_query>这个鼠标移动上去</user_query>\"}]}\n",
                "{\"type\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"ok\"}]}\n",
            ),
        )
        .map_err(|e| e.to_string())?;

        let _guard = HomeGuard::set(&home);
        let db = crate::db::Db::open_at(&home.join("app.db")).map_err(|e| e.to_string())?;
        {
            let conn = db.0.lock();
            conn.execute(
                "INSERT INTO workspaces(id, path, name) VALUES('w1', ?1, 'ws')",
                [workspace.to_string_lossy().to_string()],
            )
            .map_err(|e| e.to_string())?;
        }
        let report = scan_with(&db, || {})?;
        assert_eq!(report.reparsed, 1);
        let (title, updated_at): (String, Option<i64>) = {
            let conn = db.0.lock();
            conn.query_row(
                "SELECT title, updated_at FROM sessions WHERE engine='grok' AND session_id='sid-grok'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|e| e.to_string())?
        };
        assert_eq!(title, "这个鼠标移动上去");
        assert!(
            updated_at.is_some() && updated_at.unwrap() > 0,
            "expected mtime fallback, got {updated_at:?}"
        );
        drop(db);
        std::fs::remove_dir_all(&home).ok();
        Ok(())
    }

    /// Codex embeds its full base_instructions system prompt in the
    /// session_meta line, pushing line 1 past the old 16 KiB head-peek cap;
    /// the truncated line failed to parse and the rollout was never
    /// attributed. A >16 KiB session_meta must still scan.
    #[test]
    fn scan_identifies_codex_rollout_with_huge_session_meta() -> Result<(), String> {
        let home = scratch_dir("scan-codex-home");
        let workspace = home.join("ws");
        std::fs::create_dir_all(&workspace).map_err(|e| e.to_string())?;
        let rollout_dir = home
            .join(".codex")
            .join("sessions")
            .join("2026")
            .join("09")
            .join("06");
        std::fs::create_dir_all(&rollout_dir).map_err(|e| e.to_string())?;
        let big_instructions = "x".repeat(40 * 1024);
        let cwd_json = workspace.display().to_string().replace('\\', "\\\\");
        std::fs::write(
            rollout_dir.join("rollout-2026-09-06T21-52-11-sid-codex.jsonl"),
            format!(
                "{{\"type\":\"session_meta\",\"payload\":{{\"id\":\"sid-codex\",\"cwd\":\"{cwd_json}\",\"base_instructions\":{{\"text\":\"{big_instructions}\"}}}}}}\n{{\"type\":\"response_item\",\"payload\":{{\"type\":\"message\",\"role\":\"user\",\"content\":[{{\"type\":\"input_text\",\"text\":\"你好啊\"}}]}}}}\n",
            ),
        )
        .map_err(|e| e.to_string())?;

        let _guard = HomeGuard::set(&home);
        let db = crate::db::Db::open_at(&home.join("app.db")).map_err(|e| e.to_string())?;
        {
            let conn = db.0.lock();
            conn.execute(
                "INSERT INTO workspaces(id, path, name) VALUES('w1', ?1, 'ws')",
                [workspace.to_string_lossy().to_string()],
            )
            .map_err(|e| e.to_string())?;
        }
        let report = scan_with(&db, || {})?;
        assert_eq!(report.reparsed, 1);
        let title: String = {
            let conn = db.0.lock();
            conn.query_row(
                "SELECT title FROM sessions WHERE engine='codex' AND session_id='sid-codex'",
                [],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?
        };
        assert_eq!(title, "你好啊");
        drop(db);
        std::fs::remove_dir_all(&home).ok();
        Ok(())
    }

    /// Spawned Codex subagent rollouts share the parent's first user line.
    /// They must not become extra sidebar rows, and a previously indexed
    /// child must be pruned on the next scan.
    #[test]
    fn scan_skips_and_prunes_codex_subagent_rollouts() -> Result<(), String> {
        let home = scratch_dir("scan-codex-subagent");
        let workspace = home.join("ws");
        std::fs::create_dir_all(&workspace).map_err(|e| e.to_string())?;
        let rollout_dir = home
            .join(".codex")
            .join("sessions")
            .join("2026")
            .join("09")
            .join("10");
        std::fs::create_dir_all(&rollout_dir).map_err(|e| e.to_string())?;
        let cwd = workspace.display().to_string();
        let user = serde_json::json!({
            "type": "response_item",
            "payload": {
                "type": "message",
                "role": "user",
                "content": [{"type": "input_text", "text": "改一下"}]
            }
        });
        std::fs::write(
            rollout_dir.join("rollout-2026-09-10T00-00-00-parent.jsonl"),
            format!(
                "{}\n{}\n",
                serde_json::json!({"type":"session_meta","payload":{"id":"parent","cwd":cwd,"source":"vscode"}}),
                user
            ),
        )
        .map_err(|e| e.to_string())?;
        let child_path = rollout_dir.join("rollout-2026-09-10T00-00-01-child.jsonl");
        std::fs::write(
            &child_path,
            format!(
                "{}\n{}\n",
                serde_json::json!({
                    "type": "session_meta",
                    "payload": {
                        "id": "child",
                        "cwd": cwd,
                        "source": {"subagent": {"thread_spawn": {"parent_thread_id": "parent", "depth": 1}}}
                    }
                }),
                user
            ),
        )
        .map_err(|e| e.to_string())?;

        let _guard = HomeGuard::set(&home);
        let db = crate::db::Db::open_at(&home.join("app.db")).map_err(|e| e.to_string())?;
        {
            let conn = db.0.lock();
            conn.execute(
                "INSERT INTO workspaces(id, path, name) VALUES('w1', ?1, 'ws')",
                [workspace.to_string_lossy().to_string()],
            )
            .map_err(|e| e.to_string())?;
            conn.execute(
                "INSERT INTO sessions(engine, session_id, workspace_path, file_path, file_size, file_mtime_ms, title) VALUES('codex', 'child', ?1, ?2, 1, 1, '改一下')",
                rusqlite::params![workspace.to_string_lossy().to_string(), child_path.to_string_lossy().to_string()],
            )
            .map_err(|e| e.to_string())?;
        }
        let report = scan_with(&db, || {})?;
        assert_eq!(report.reparsed, 1);
        let ids: Vec<String> = {
            let conn = db.0.lock();
            let mut stmt = conn
                .prepare("SELECT session_id FROM sessions WHERE engine='codex' ORDER BY session_id")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |r| r.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
        };
        assert_eq!(ids, vec!["parent".to_string()]);
        drop(db);
        std::fs::remove_dir_all(&home).ok();
        Ok(())
    }

    /// DSH writes one compressed log per spawned child. Those files must not
    /// become extra sidebar rows, and a previously indexed child must be
    /// pruned on the next scan.
    #[test]
    fn scan_skips_and_prunes_dsh_subagent_sessions() -> Result<(), String> {
        let home = scratch_dir("scan-dsh-subagent");
        let workspace = home.join("ws");
        std::fs::create_dir_all(&workspace).map_err(|e| e.to_string())?;
        let cwd = workspace.display().to_string();
        let escaped = cwd.replace('\\', "\\\\");
        let project = home
            .join(".dsh")
            .join("sessions")
            .join("--ws--");
        let parent_dir = project.join("parent");
        let child_dir = project.join("child");
        write_zstd_jsonl(
            &parent_dir.join("session.v3.jsonl.zstd"),
            &[
                &format!(
                    r#"{{"type":"session","version":3,"id":"parent","cwd":"{escaped}","createdAt":1,"isSeeded":false,"delegationDepth":0}}"#
                ),
                r#"{"type":"user/message","time":1,"data":{"content":[{"type":"text","text":"review"}]}}"#,
            ],
        );
        let child_path = child_dir.join("session.v3.jsonl.zstd");
        write_zstd_jsonl(
            &child_path,
            &[
                &format!(
                    r#"{{"type":"session","version":3,"id":"child","cwd":"{escaped}","createdAt":1,"isSeeded":false,"origin":"subagent","parentSession":"parent","delegationDepth":1}}"#
                ),
                r#"{"type":"user/message","time":1,"data":{"content":[{"type":"text","text":"你是一名只读代码评审员"}]}}"#,
            ],
        );
        let _guard = HomeGuard::set(&home);
        let db = crate::db::Db::open_at(&home.join("app.db")).map_err(|e| e.to_string())?;
        {
            let conn = db.0.lock();
            conn.execute(
                "INSERT INTO workspaces(id, path, name) VALUES('w1', ?1, 'ws')",
                [workspace.to_string_lossy().to_string()],
            )
            .map_err(|e| e.to_string())?;
            conn.execute(
                "INSERT INTO sessions(engine, session_id, workspace_path, file_path, file_size, file_mtime_ms, title) VALUES('dsh', 'child', ?1, ?2, 1, 1, '你是一名只读代码评审员')",
                rusqlite::params![workspace.to_string_lossy().to_string(), child_path.to_string_lossy().to_string()],
            )
            .map_err(|e| e.to_string())?;
        }
        let report = scan_with(&db, || {})?;
        assert_eq!(report.reparsed, 1);
        let ids: Vec<String> = {
            let conn = db.0.lock();
            let mut stmt = conn
                .prepare("SELECT session_id FROM sessions WHERE engine='dsh' ORDER BY session_id")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |r| r.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
        };
        assert_eq!(ids, vec!["parent".to_string()]);
        drop(db);
        std::fs::remove_dir_all(&home).ok();
        Ok(())
    }

    #[test]
    fn default_codex_home_keeps_indexed_sessions() -> Result<(), String> {
        let home = scratch_dir("scan-codex-default-keep");
        let workspace = home.join("ws");
        std::fs::create_dir_all(&workspace).map_err(|e| e.to_string())?;
        let rollout = home
            .join(".codex")
            .join("sessions")
            .join("rollout-keep.jsonl");
        std::fs::create_dir_all(rollout.parent().unwrap()).map_err(|e| e.to_string())?;
        let _guard = HomeGuard::set(&home);
        let db = crate::db::Db::open_at(&home.join("app.db")).map_err(|e| e.to_string())?;
        {
            let conn = db.0.lock();
            conn.execute(
                "INSERT INTO workspaces(id, path, name) VALUES('w1', ?1, 'ws')",
                [workspace.to_string_lossy().to_string()],
            )
            .map_err(|e| e.to_string())?;
            conn.execute(
                "INSERT INTO sessions(engine, session_id, workspace_path, file_path, file_size, file_mtime_ms, title) VALUES('codex', 'keep', ?1, ?2, 1, 1, '默认目录')",
                rusqlite::params![
                    workspace.to_string_lossy().to_string(),
                    rollout.to_string_lossy().to_string()
                ],
            )
            .map_err(|e| e.to_string())?;
        }
        scan_with(&db, || {})?;
        let count: i64 = {
            let conn = db.0.lock();
            conn.query_row(
                "SELECT COUNT(*) FROM sessions WHERE engine='codex' AND session_id='keep'",
                [],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?
        };
        assert_eq!(count, 1);
        drop(db);
        std::fs::remove_dir_all(&home).ok();
        Ok(())
    }

    #[test]
    fn scan_prunes_codex_rows_from_another_home() -> Result<(), String> {
        let home = scratch_dir("scan-codex-wrong-home");
        let workspace = home.join("ws");
        std::fs::create_dir_all(&workspace).map_err(|e| e.to_string())?;
        let _guard = HomeGuard::set(&home);
        let db = crate::db::Db::open_at(&home.join("app.db")).map_err(|e| e.to_string())?;
        {
            let conn = db.0.lock();
            conn.execute(
                "INSERT INTO workspaces(id, path, name) VALUES('w1', ?1, 'ws')",
                [workspace.to_string_lossy().to_string()],
            )
            .map_err(|e| e.to_string())?;
            conn.execute(
                "INSERT INTO sessions(engine, session_id, workspace_path, file_path, file_size, file_mtime_ms, title) VALUES('codex', 'old', ?1, '/Users/demo/.codex/sessions/old.jsonl', 1, 1, '旧目录')",
                [workspace.to_string_lossy().to_string()],
            )
            .map_err(|e| e.to_string())?;
        }
        scan_with(&db, || {})?;
        let count: i64 = {
            let conn = db.0.lock();
            conn.query_row(
                "SELECT COUNT(*) FROM sessions WHERE engine='codex'",
                [],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?
        };
        assert_eq!(count, 0);
        drop(db);
        std::fs::remove_dir_all(&home).ok();
        Ok(())
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
}
