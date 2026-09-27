//! Full-text search over session message bodies (⌘L palette content tab).
//!
//! Architecture follows agentsview's proven shape: message text lives once
//! in `session_messages`, an external-content FTS5 table (`messages_fts`)
//! holds only the index, and db triggers keep both in the same transaction.
//! Two deliberate deviations:
//!
//! - Tokenizer is `trigram`, not `porter unicode61`: unicode61 treats a run
//!   of Chinese as one token, so CJK substring search is impossible.
//!   trigram matches substrings (≥3 chars) across Chinese, English and
//!   punctuation alike. Queries containing any token shorter than 3 chars
//!   would silently drop that token in FTS5 (verified: `"提交"` matches
//!   nothing, `"已生成" "提交"` matches as if only 已生成 were asked), so
//!   they take the LIKE fallback with exact AND semantics instead.
//! - Indexing is a background pass chained off the history scan rather
//!   than a fs watcher: the scan already knows which session files changed,
//!   so the indexer only re-parses those (fts_state stat stamp per session).

use rusqlite::OptionalExtension;
use serde::Serialize;
use std::path::Path;
use std::sync::Arc;

use super::{parse_session_file, parse_ts_ms_str};

/// Bump when index derivation changes (what text is indexed, tokenizer) so
/// every session re-indexes exactly once on upgrade.
const INDEX_VERSION: &str = "1";

/// Stamp written when a session's file cannot be parsed. Bound to
/// INDEX_VERSION, so an index-format upgrade retries every failure once;
/// the stat check in PENDING_FROM retries sooner when the file changes.
fn failed_version() -> String {
    format!("failed:{INDEX_VERSION}")
}

/// Default/ceiling for one search page. The palette pages with LIMIT+1.
const DEFAULT_LIMIT: u32 = 20;
const MAX_LIMIT: u32 = 100;

/// Chars of context kept on each side of the first match in a LIKE-path
/// snippet (agentsview uses the same radius for its content search).
const SNIPPET_RADIUS: usize = 60;

/// snippet() marker bytes: control chars cannot appear in a chat message in
/// practice, so unlike agentsview's literal `<mark>` these can never be
/// forged by message content into a spurious highlight.
const MARK_OPEN: char = '\u{1}';
const MARK_CLOSE: char = '\u{2}';

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SnippetPart {
    pub text: String,
    pub marked: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageSearchHit {
    pub engine: String,
    pub session_id: String,
    pub workspace_path: String,
    pub workspace_name: Option<String>,
    pub title: String,
    pub custom_title: Option<String>,
    pub updated_at: Option<i64>,
    pub role: String,
    pub snippet: Vec<SnippetPart>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageSearchPage {
    pub hits: Vec<MessageSearchHit>,
    pub has_more: bool,
    /// Sessions still awaiting (re)indexing at query time. While >0 the hit
    /// list can grow without the query changing.
    pub pending: i64,
    /// Microseconds spent on the query itself (FTS/LIKE scan + snippet
    /// build). The bookkeeping counts (pending sessions, corpus size) run
    /// outside this clock: they measure the index, not the search, and the
    /// palette's stats line quotes this number as the search time.
    pub elapsed_us: u64,
    /// Messages in the content index — the corpus the query ran against.
    /// Paired with `elapsed_us` in the palette's "searched N messages" line.
    pub total_messages: i64,
}

// ==================== Indexer ====================

/// Sessions whose stored file stat disagrees with the index stamp (or that
/// were never indexed). Shared by the indexer loop and the `pending` count.
/// A failure stamp (?2) clears the session until its stat moves or
/// INDEX_VERSION bumps — otherwise deleted/moved transcript files would
/// re-fail every pass and stay pending forever.
const PENDING_FROM: &str = "
    FROM sessions s
    LEFT JOIN fts_state f ON f.engine = s.engine AND f.session_id = s.session_id
    WHERE f.version IS NULL
       OR (f.version != ?1 AND f.version != ?2)
       OR f.file_size != s.file_size
       OR f.file_mtime_ms != s.file_mtime_ms";

struct PendingSession {
    engine: String,
    session_id: String,
    file_path: String,
    file_size: i64,
    file_mtime_ms: i64,
    message_count: i64,
}

/// All sessions awaiting (re)indexing, in one snapshot.
fn pending_batch(db: &crate::db::Db) -> Result<Vec<PendingSession>, String> {
    let conn = db.0.lock();
    let mut stmt = conn
        .prepare(&format!(
            "SELECT s.engine, s.session_id, s.file_path, s.file_size, s.file_mtime_ms, s.message_count
             {PENDING_FROM}"
        ))
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![INDEX_VERSION, failed_version()], |r| {
            Ok(PendingSession {
                engine: r.get(0)?,
                session_id: r.get(1)?,
                file_path: r.get(2)?,
                file_size: r.get(3)?,
                file_mtime_ms: r.get(4)?,
                message_count: r.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

fn pending_count(db: &crate::db::Db) -> Result<i64, String> {
    let conn = db.0.lock();
    conn.query_row(
        &format!("SELECT COUNT(*) {PENDING_FROM}"),
        rusqlite::params![INDEX_VERSION, failed_version()],
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}

/// Messages currently in the content index: the corpus a query runs
/// against, reported next to the search duration.
fn message_count(db: &crate::db::Db) -> Result<i64, String> {
    let conn = db.0.lock();
    conn.query_row("SELECT COUNT(*) FROM session_messages", [], |r| r.get(0))
        .map_err(|e| e.to_string())
}

/// Write the fts_state row shared by the success and failure paths.
fn upsert_stamp(
    conn: &rusqlite::Connection,
    row: &PendingSession,
    version: &str,
) -> Result<(), String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    conn.execute(
        "INSERT INTO fts_state(engine, session_id, file_size, file_mtime_ms, version, indexed_at)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(engine, session_id) DO UPDATE SET
            file_size=excluded.file_size,
            file_mtime_ms=excluded.file_mtime_ms,
            version=excluded.version,
            indexed_at=excluded.indexed_at",
        rusqlite::params![
            row.engine,
            row.session_id,
            row.file_size,
            row.file_mtime_ms,
            version,
            now
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Sessions-row stat, re-checked under SCAN_LOCK before any stamp: a file
/// rewritten mid-parse must not be stamped at the new stat.
fn stat_unchanged(conn: &rusqlite::Connection, row: &PendingSession) -> Result<bool, String> {
    let current: Option<(i64, i64)> = conn
        .query_row(
            "SELECT file_size, file_mtime_ms FROM sessions WHERE engine=?1 AND session_id=?2",
            rusqlite::params![row.engine, row.session_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(current == Some((row.file_size, row.file_mtime_ms)))
}

/// Mark an unparseable session as attempted at its current stat. Previously
/// indexed messages stay (last-good content remains searchable); the stat
/// and version checks in PENDING_FROM re-pend the session when the file
/// changes or INDEX_VERSION bumps. Same SCAN_LOCK + stat re-check as the
/// success path.
fn stamp_failure(db: &crate::db::Db, row: &PendingSession) -> Result<(), String> {
    let _scan_guard = super::scanner::SCAN_LOCK.lock();
    let conn = db.0.lock();
    if stat_unchanged(&conn, row)? {
        upsert_stamp(&conn, row, &failed_version())?;
    }
    Ok(())
}

/// (Re)index one session. Returns true when the index now reflects the
/// file. A lost stat race leaves the session pending for the next pass; a
/// parse failure is failure-stamped so a permanently unparseable file
/// (e.g. deleted transcript) neither retries nor counts as pending until
/// its stat moves.
fn index_one(db: &crate::db::Db, row: &PendingSession) -> Result<bool, String> {
    let parsed = if row.message_count > 0 {
        // Index the same text the reader shows: parse with this session's
        // accepted internal frames, so hidden frames stay out of the index
        // (an empty set would re-reveal every frame the capture validator hid).
        let (accepted_frames, _) =
            db.accepted_internal_frames(&row.engine, &row.session_id)?;
        match parse_session_file(&row.engine, Path::new(&row.file_path), &accepted_frames) {
            Ok(parsed) => parsed,
            Err(error) => {
                eprintln!(
                    "[search] parse {} failed (stamped, retried on change): {error}",
                    row.file_path
                );
                stamp_failure(db, row)?;
                return Ok(false);
            }
        }
    } else {
        super::ParsedSession { messages: vec![] }
    };

    // Deletion paths hold SCAN_LOCK, so under it the sessions row cannot
    // vanish mid-write; the stat re-check keeps a file rewritten mid-parse
    // from being stamped as indexed at the new stat.
    let _scan_guard = super::scanner::SCAN_LOCK.lock();
    let mut conn = db.0.lock();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    if !stat_unchanged(&tx, row)? {
        return Ok(false);
    }
    tx.execute(
        "DELETE FROM session_messages WHERE engine=?1 AND session_id=?2",
        rusqlite::params![row.engine, row.session_id],
    )
    .map_err(|e| e.to_string())?;
    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO session_messages(engine, session_id, seq, role, text, ts_ms)
                 VALUES(?1, ?2, ?3, ?4, ?5, ?6)",
            )
            .map_err(|e| e.to_string())?;
        for message in &parsed.messages {
            if message.text.trim().is_empty() {
                continue;
            }
            let ts_ms = message.ts.as_deref().and_then(parse_ts_ms_str);
            stmt.execute(rusqlite::params![
                row.engine,
                row.session_id,
                message.seq,
                message.role,
                message.text,
                ts_ms,
            ])
            .map_err(|e| e.to_string())?;
        }
    }
    upsert_stamp(&tx, row, INDEX_VERSION)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(true)
}

/// Drain every pending session in one up-front snapshot: sessions
/// discovered mid-pass wait for the next pass (spawn_index follows every
/// scan), and each snapshot row is attempted exactly once — a corrupt file
/// can never clog a refetch loop's head batch and stall the whole pass.
/// Each session's parse is lock-free and its write transaction its own
/// short db-lock+SCAN_LOCK section, so a big first-time index never
/// starves ⌘L searches or scans.
pub fn index_pending(db: &crate::db::Db) -> Result<usize, String> {
    let mut indexed = 0usize;
    for row in pending_batch(db)? {
        // One bad session (e.g. FK race with workspace removal) must not
        // abort the pass for everyone behind it.
        match index_one(db, &row) {
            Ok(true) => indexed += 1,
            Ok(false) => {}
            Err(error) => eprintln!(
                "[search] indexing {}/{} failed: {error}",
                row.engine, row.session_id
            ),
        }
    }
    Ok(indexed)
}

/// Background index pass, collapse-safe like spawn_scan: a pass already in
/// flight makes the new call a no-op (its pending loop sees the new work).
pub fn spawn_index(db: Arc<crate::db::Db>) {
    use std::sync::atomic::{AtomicBool, Ordering};
    static INDEX_RUNNING: AtomicBool = AtomicBool::new(false);
    if INDEX_RUNNING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }
    tauri::async_runtime::spawn_blocking(move || {
        struct ResetOnDrop;
        impl Drop for ResetOnDrop {
            fn drop(&mut self) {
                INDEX_RUNNING.store(false, Ordering::SeqCst);
            }
        }
        let _guard = ResetOnDrop;
        if let Err(error) = index_pending(&db) {
            eprintln!("[search] index pass failed: {error}");
        }
    });
}

// ==================== Query ====================

/// A token is FTS-safe when trigram can see it whole: 3+ chars. Shorter
/// tokens silently match nothing in FTS5, so they route to LIKE instead.
fn fts_safe(tokens: &[&str]) -> bool {
    !tokens.is_empty() && tokens.iter().all(|t| t.chars().count() >= 3)
}

/// AND of quoted terms: quoting literalizes FTS5 operators and punctuation
/// (agentsview's PrepareFTSQuery), so user input can never 500 the query.
fn fts_query(tokens: &[&str]) -> String {
    tokens
        .iter()
        .map(|t| format!("\"{}\"", t.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" ")
}

fn like_pattern(token: &str) -> String {
    let mut out = String::with_capacity(token.len() + 2);
    out.push('%');
    for ch in token.chars() {
        if matches!(ch, '%' | '_' | '\\') {
            out.push('\\');
        }
        out.push(ch);
    }
    out.push('%');
    out
}

/// Split a snippet() result on the control-char markers into render-safe
/// segments. Manual scan (not str::split) so marker parity survives empty
/// or forged marker runs.
fn split_marks(snippet: &str) -> Vec<SnippetPart> {
    fn flush(parts: &mut Vec<SnippetPart>, buf: &mut String, marked: bool) {
        if !buf.is_empty() {
            parts.push(SnippetPart {
                text: std::mem::take(buf),
                marked,
            });
        }
    }
    let mut parts = Vec::new();
    let mut buf = String::new();
    let mut marked = false;
    for ch in snippet.chars() {
        match ch {
            c if c == MARK_OPEN => {
                flush(&mut parts, &mut buf, marked);
                marked = true;
            }
            c if c == MARK_CLOSE => {
                flush(&mut parts, &mut buf, marked);
                marked = false;
            }
            _ => buf.push(ch),
        }
    }
    flush(&mut parts, &mut buf, marked);
    parts
}

/// Case-insensitive char compare with index alignment preserved: one char
/// in, one char out (multi-char case folds like ẞ→ss compare by their first
/// char — highlight-only approximation, never affects matching itself).
fn lower_chars(text: &str) -> Vec<char> {
    text.chars()
        .map(|c| c.to_lowercase().next().unwrap_or(c))
        .collect()
}

fn find_from(haystack: &[char], needle: &[char], from: usize) -> Option<usize> {
    if needle.is_empty() || haystack.len() < needle.len() {
        return None;
    }
    (from..=haystack.len() - needle.len()).find(|&i| haystack[i..i + needle.len()] == *needle)
}

/// Rust-side snippet for the LIKE path: window around the earliest match,
/// every token occurrence marked. Same ±60-char radius as agentsview's
/// Go-side content snippet.
fn like_snippet(text: &str, needles: &[Vec<char>]) -> Vec<SnippetPart> {
    let lower = lower_chars(text);
    let first = needles.iter().filter_map(|n| find_from(&lower, n, 0)).min();
    let Some(first) = first else {
        // Row matched in SQL but not here (exotic case fold): show the head.
        let head: String = text.chars().take(SNIPPET_RADIUS * 2).collect();
        return vec![SnippetPart {
            text: head,
            marked: false,
        }];
    };
    let start = first.saturating_sub(SNIPPET_RADIUS);
    let end = (first + SNIPPET_RADIUS * 2).min(lower.len());
    let window: String = text.chars().skip(start).take(end - start).collect();
    let window_lower = lower_chars(&window);

    // Mark every occurrence of every token inside the window; overlaps keep
    // the earliest match (later token starting inside a marked run resumes
    // after it).
    let mut marks: Vec<(usize, usize)> = Vec::new();
    for needle in needles {
        let mut from = 0;
        while let Some(pos) = find_from(&window_lower, needle, from) {
            let to = pos + needle.len();
            marks.push((pos, to));
            from = to;
        }
    }
    marks.sort_unstable();
    let mut parts: Vec<SnippetPart> = Vec::new();
    let mut cursor = 0usize;
    let win_chars: Vec<char> = window.chars().collect();
    let push = |range: std::ops::Range<usize>, marked: bool, parts: &mut Vec<SnippetPart>| {
        if range.start < range.end {
            let text: String = win_chars[range].iter().collect();
            if let Some(last) = parts.last_mut() {
                if last.marked == marked {
                    last.text.push_str(&text);
                    return;
                }
            }
            parts.push(SnippetPart { text, marked });
        }
    };
    for (from, to) in marks {
        if from < cursor {
            continue;
        }
        push(cursor..from, false, &mut parts);
        push(from..to, true, &mut parts);
        cursor = to;
    }
    push(cursor..win_chars.len(), false, &mut parts);
    if start > 0 {
        parts.insert(
            0,
            SnippetPart {
                text: "…".to_string(),
                marked: false,
            },
        );
    }
    if end < lower.len() {
        parts.push(SnippetPart {
            text: "…".to_string(),
            marked: false,
        });
    }
    parts
}

struct RawHit {
    engine: String,
    session_id: String,
    role: String,
    text: Option<String>,
    snippet_sql: Option<String>,
    workspace_path: String,
    workspace_name: Option<String>,
    title: String,
    custom_title: Option<String>,
    updated_at: Option<i64>,
}

fn fts_search(
    db: &crate::db::Db,
    tokens: &[&str],
    limit: u32,
    offset: u32,
) -> Result<Vec<RawHit>, String> {
    let sql = format!(
        "WITH matched AS (
             SELECT rowid, bm25(messages_fts) AS rank
             FROM messages_fts WHERE messages_fts MATCH ?1
         ),
         best AS (
             SELECT m.id, m.engine, m.session_id, m.role, k.rank,
                    ROW_NUMBER() OVER (
                        PARTITION BY m.engine, m.session_id
                        ORDER BY k.rank, m.seq
                    ) AS rn
             FROM matched k JOIN session_messages m ON m.id = k.rowid
         )
         SELECT b.engine, b.session_id, b.role,
                snippet(messages_fts, 0, char(1), char(2), '…', 24),
                s.workspace_path, w.name, s.title, s.custom_title, s.updated_at
         FROM best b
         JOIN messages_fts ON messages_fts.rowid = b.id AND messages_fts MATCH ?1
         JOIN sessions s ON s.engine = b.engine AND s.session_id = b.session_id
         LEFT JOIN workspaces w ON w.path = s.workspace_path
         WHERE b.rn = 1
         ORDER BY b.rank ASC, s.updated_at DESC, b.engine, b.session_id
         LIMIT ?2 OFFSET ?3"
    );
    let conn = db.0.lock();
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(
            rusqlite::params![fts_query(tokens), limit as i64 + 1, offset as i64],
            |r| {
                Ok(RawHit {
                    engine: r.get(0)?,
                    session_id: r.get(1)?,
                    role: r.get(2)?,
                    text: None,
                    snippet_sql: Some(r.get(3)?),
                    workspace_path: r.get(4)?,
                    workspace_name: r.get(5)?,
                    title: r.get(6)?,
                    custom_title: r.get(7)?,
                    updated_at: r.get(8)?,
                })
            },
        )
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

fn like_search(
    db: &crate::db::Db,
    tokens: &[&str],
    limit: u32,
    offset: u32,
) -> Result<Vec<RawHit>, String> {
    let likes = (0..tokens.len())
        .map(|i| format!("m2.text LIKE ?{} ESCAPE '\\'", i + 1))
        .collect::<Vec<_>>()
        .join(" AND ");
    let sql = format!(
        "SELECT m.engine, m.session_id, m.role, m.text,
                s.workspace_path, w.name, s.title, s.custom_title, s.updated_at
         FROM (
             SELECT m2.*, ROW_NUMBER() OVER (
                 PARTITION BY m2.engine, m2.session_id ORDER BY m2.seq
             ) AS rn
             FROM session_messages m2
             WHERE {likes}
         ) m
         JOIN sessions s ON s.engine = m.engine AND s.session_id = m.session_id
         LEFT JOIN workspaces w ON w.path = s.workspace_path
         WHERE m.rn = 1
         ORDER BY s.updated_at DESC, m.engine, m.session_id
         LIMIT ?{} OFFSET ?{}",
        tokens.len() + 1,
        tokens.len() + 2,
    );
    let mut params: Vec<rusqlite::types::Value> =
        tokens.iter().map(|t| like_pattern(t).into()).collect();
    params.push((limit as i64 + 1).into());
    params.push((offset as i64).into());
    let conn = db.0.lock();
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(params), |r| {
            Ok(RawHit {
                engine: r.get(0)?,
                session_id: r.get(1)?,
                role: r.get(2)?,
                text: Some(r.get(3)?),
                snippet_sql: None,
                workspace_path: r.get(4)?,
                workspace_name: r.get(5)?,
                title: r.get(6)?,
                custom_title: r.get(7)?,
                updated_at: r.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(rows)
}

/// Blocking search body (spawn_blocking in the command): FTS with bm25 +
/// snippet() for 3+-char tokens, LIKE with a Rust-side snippet otherwise.
/// Order is fixed: bm25 relevance (recency as the tie-break) on the FTS
/// path, recency on the LIKE path (short tokens carry no ranking signal).
pub fn search(
    db: &crate::db::Db,
    query: &str,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<MessageSearchPage, String> {
    let trimmed = query.trim();
    let limit = limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let offset = offset.unwrap_or(0);
    // Reporting, not searching: the corpus count happens before the elapsed
    // clock starts (same for the pending count after it stops).
    let total_messages = message_count(db)?;
    if trimmed.is_empty() {
        return Ok(MessageSearchPage {
            hits: vec![],
            has_more: false,
            pending: pending_count(db)?,
            elapsed_us: 0,
            total_messages,
        });
    }
    let started = std::time::Instant::now();
    let tokens: Vec<&str> = trimmed.split_whitespace().collect();
    let needles: Vec<Vec<char>> = tokens.iter().map(|t| lower_chars(t)).collect();
    let raw = if fts_safe(&tokens) {
        fts_search(db, &tokens, limit, offset)?
    } else {
        // Short tokens have no ranking signal; recency is the honest order.
        like_search(db, &tokens, limit, offset)?
    };
    let has_more = raw.len() as u32 > limit;
    let hits = raw
        .into_iter()
        .take(limit as usize)
        .map(|hit| {
            let snippet = match (hit.snippet_sql, hit.text) {
                (Some(sql), _) => split_marks(&sql),
                (None, Some(text)) => like_snippet(&text, &needles),
                (None, None) => vec![],
            };
            MessageSearchHit {
                engine: hit.engine,
                session_id: hit.session_id,
                workspace_path: hit.workspace_path,
                workspace_name: hit.workspace_name,
                title: hit.title,
                custom_title: hit.custom_title,
                updated_at: hit.updated_at,
                role: hit.role,
                snippet,
            }
        })
        .collect();
    let elapsed_us = started.elapsed().as_micros().min(u64::MAX as u128) as u64;
    Ok(MessageSearchPage {
        hits,
        has_more,
        pending: pending_count(db)?,
        elapsed_us,
        total_messages,
    })
}

#[tauri::command]
pub async fn search_messages(
    state: tauri::State<'_, crate::AppState>,
    query: String,
    limit: Option<u32>,
    offset: Option<u32>,
) -> Result<MessageSearchPage, String> {
    let db = Arc::clone(&state.db);
    tauri::async_runtime::spawn_blocking(move || search(&db, &query, limit, offset))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Scratch(std::path::PathBuf);
    impl Scratch {
        fn new() -> Self {
            let dir = std::env::temp_dir().join(format!("ccgui-search-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
    }
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn insert_session(db: &crate::db::Db, session_id: &str, updated_at: i64) {
        db.0
            .lock()
            .execute(
                "INSERT INTO sessions(engine, session_id, workspace_path, file_path, file_size, file_mtime_ms, title, updated_at, message_count)
                 VALUES('claude', ?1, '/ws', '/tmp/x.jsonl', 0, 0, '', ?2, 1)",
                rusqlite::params![session_id, updated_at],
            )
            .unwrap();
    }

    fn insert_message(db: &crate::db::Db, session_id: &str, seq: i64, role: &str, text: &str) {
        db.0
            .lock()
            .execute(
                "INSERT INTO session_messages(engine, session_id, seq, role, text) VALUES('claude', ?1, ?2, ?3, ?4)",
                rusqlite::params![session_id, seq, role, text],
            )
            .unwrap();
    }

    fn marked_text(hit: &MessageSearchHit) -> String {
        hit.snippet
            .iter()
            .filter(|p| p.marked)
            .map(|p| p.text.as_str())
            .collect()
    }

    #[test]
    fn fts_matches_chinese_substring_and_marks_it() {
        let scratch = Scratch::new();
        let db = crate::db::Db::open_at(&scratch.0.join("app.db")).unwrap();
        insert_session(&db, "s1", 100);
        insert_message(
            &db,
            "s1",
            1,
            "assistant",
            "So do not commit; report. 已生成 v1.0.5 版本记录，详见更新日志",
        );

        let page = search(&db, "已生成 v1.0.5 版本记录", None, None).unwrap();
        assert_eq!(page.hits.len(), 1);
        assert_eq!(page.hits[0].session_id, "s1");
        assert_eq!(page.total_messages, 1, "corpus count the query ran against");
        assert!(marked_text(&page.hits[0]).contains("已生成"));
        // Substring across punctuation is a trigram strength.
        let page = search(&db, "1.0.5", None, None).unwrap();
        assert_eq!(page.hits.len(), 1);
    }

    #[test]
    fn short_tokens_fall_back_to_like_with_and_semantics() {
        let scratch = Scratch::new();
        let db = crate::db::Db::open_at(&scratch.0.join("app.db")).unwrap();
        insert_session(&db, "s1", 100);
        insert_message(&db, "s1", 1, "user", "帮我提交代码");
        insert_session(&db, "s2", 200);
        insert_message(&db, "s2", 1, "user", "提交过了但没有代码");
        insert_session(&db, "s3", 300);
        insert_message(&db, "s3", 1, "user", "只有提交这个词");

        // 2-char tokens would silently match nothing in trigram FTS.
        let page = search(&db, "提交 代码", None, None).unwrap();
        let ids: Vec<&str> = page.hits.iter().map(|h| h.session_id.as_str()).collect();
        assert_eq!(ids, ["s2", "s1"], "recency order, both tokens required");
        assert_eq!(page.total_messages, 3);
        assert!(page.hits[0]
            .snippet
            .iter()
            .any(|p| p.marked && p.text.contains("提交")));
    }

    #[test]
    fn one_hit_per_session_and_relevance_ties_break_by_recency() {
        let scratch = Scratch::new();
        let db = crate::db::Db::open_at(&scratch.0.join("app.db")).unwrap();
        insert_session(&db, "old", 100);
        insert_message(&db, "old", 1, "user", "搜索目标关键词 first");
        insert_message(&db, "old", 2, "assistant", "搜索目标关键词 second");
        insert_session(&db, "new", 200);
        insert_message(&db, "new", 1, "user", "搜索目标关键词 only");

        // All three matches score identically, so bm25 ties and the
        // updated_at tie-break decides: newest session first.
        let page = search(&db, "搜索目标关键词", None, None).unwrap();
        let ids: Vec<&str> = page.hits.iter().map(|h| h.session_id.as_str()).collect();
        assert_eq!(
            ids,
            ["new", "old"],
            "one row per session, newest first on a tie"
        );
    }

    #[test]
    fn deleting_session_cascades_index_rows() {
        let scratch = Scratch::new();
        let db = crate::db::Db::open_at(&scratch.0.join("app.db")).unwrap();
        insert_session(&db, "s1", 100);
        insert_message(&db, "s1", 1, "user", "删除后不可见的独特内容");
        db.0.lock()
            .execute("DELETE FROM sessions WHERE session_id='s1'", [])
            .unwrap();
        let page = search(&db, "删除后不可见", None, None).unwrap();
        assert!(page.hits.is_empty());
        assert_eq!(page.total_messages, 0, "cascade emptied the corpus too");
        let count: i64 =
            db.0.lock()
                .query_row("SELECT COUNT(*) FROM session_messages", [], |r| r.get(0))
                .unwrap();
        assert_eq!(count, 0);
    }

    fn claude_user_line(text: &str) -> String {
        serde_json::json!({
            "type": "user",
            "timestamp": "2026-09-20T10:00:00.000Z",
            "message": {"role": "user", "content": [{"type": "text", "text": text}]}
        })
        .to_string()
    }

    fn write_session_file(scratch: &Scratch, name: &str, lines: &[String]) -> std::path::PathBuf {
        let path = scratch.0.join(name);
        std::fs::write(&path, lines.join("\n") + "\n").unwrap();
        path
    }

    fn register_file_session(db: &crate::db::Db, session_id: &str, path: &std::path::Path) {
        let (size, mtime_ms) = super::super::stat_signature(path).unwrap();
        db.0
            .lock()
            .execute(
                "INSERT INTO sessions(engine, session_id, workspace_path, file_path, file_size, file_mtime_ms, message_count)
                 VALUES('claude', ?1, '/ws', ?2, ?3, ?4, 1)
                 ON CONFLICT(engine, session_id) DO UPDATE SET file_path=excluded.file_path,
                    file_size=excluded.file_size, file_mtime_ms=excluded.file_mtime_ms",
                rusqlite::params![session_id, path.to_string_lossy().as_ref(), size, mtime_ms],
            )
            .unwrap();
    }

    #[test]
    fn index_pending_parses_changed_files_only() {
        let scratch = Scratch::new();
        let db = crate::db::Db::open_at(&scratch.0.join("app.db")).unwrap();
        let path = write_session_file(
            &scratch,
            "s1.jsonl",
            &[claude_user_line("索引管道里的中文内容")],
        );
        register_file_session(&db, "s1", &path);

        assert_eq!(index_pending(&db).unwrap(), 1);
        assert_eq!(pending_count(&db).unwrap(), 0);
        let page = search(&db, "索引管道", None, None).unwrap();
        assert_eq!(page.hits.len(), 1);
        assert!(page.pending == 0);

        // Second pass with no change: nothing re-parses.
        assert_eq!(index_pending(&db).unwrap(), 0);

        // Appending to the file and refreshing the stat re-indexes.
        let mut lines = vec![claude_user_line("索引管道里的中文内容")];
        lines.push(claude_user_line("追加的新消息内容"));
        std::fs::write(&path, lines.join("\n") + "\n").unwrap();
        register_file_session(&db, "s1", &path);
        assert_eq!(index_pending(&db).unwrap(), 1);
        let page = search(&db, "追加的新消息", None, None).unwrap();
        assert_eq!(page.hits.len(), 1);
        // Old content stays (replace-then-insert keeps one copy).
        let count: i64 =
            db.0.lock()
                .query_row("SELECT COUNT(*) FROM session_messages", [], |r| r.get(0))
                .unwrap();
        assert_eq!(count, 2);
    }

    #[test]
    fn index_pending_stamps_unparseable_file_until_file_changes() {
        let scratch = Scratch::new();
        let db = crate::db::Db::open_at(&scratch.0.join("app.db")).unwrap();
        let path = scratch.0.join("missing.jsonl");
        let register = |size: i64, mtime: i64| {
            db.0
                .lock()
                .execute(
                    "INSERT INTO sessions(engine, session_id, workspace_path, file_path, file_size, file_mtime_ms, message_count)
                     VALUES('claude', 'gone', '/ws', ?1, ?2, ?3, 3)
                     ON CONFLICT(engine, session_id) DO UPDATE SET file_size=excluded.file_size,
                        file_mtime_ms=excluded.file_mtime_ms",
                    rusqlite::params![path.to_string_lossy().as_ref(), size, mtime],
                )
                .unwrap();
        };
        register(10, 10);
        // Parse fails → failure stamp: nothing indexed, nothing left pending.
        assert_eq!(index_pending(&db).unwrap(), 0);
        assert_eq!(pending_count(&db).unwrap(), 0);
        // A stable stat never retries…
        assert_eq!(index_pending(&db).unwrap(), 0);
        // …but a changed file re-pends the session for one fresh attempt.
        register(11, 11);
        assert_eq!(pending_count(&db).unwrap(), 1);
        assert_eq!(index_pending(&db).unwrap(), 0);
        assert_eq!(pending_count(&db).unwrap(), 0);
    }

    #[test]
    fn index_pending_survives_a_head_batch_of_permanent_failures() {
        let scratch = Scratch::new();
        let db = crate::db::Db::open_at(&scratch.0.join("app.db")).unwrap();
        // More dead rows than one batch used to hold, inserted first so the
        // old refetch loop met them at the head of every pending query.
        for i in 0..24 {
            db.0
                .lock()
                .execute(
                    "INSERT INTO sessions(engine, session_id, workspace_path, file_path, file_size, file_mtime_ms, message_count)
                     VALUES('claude', ?1, '/ws', ?2, 10, 10, 3)",
                    rusqlite::params![format!("dead-{i}"), scratch.0.join(format!("dead-{i}.jsonl")).to_string_lossy().as_ref()],
                )
                .unwrap();
        }
        // Good sessions behind the failures must still be indexed.
        for i in 0..4 {
            let path = write_session_file(
                &scratch,
                &format!("good-{i}.jsonl"),
                &[claude_user_line("可索引的正常内容")],
            );
            register_file_session(&db, &format!("good-{i}"), &path);
        }
        assert_eq!(index_pending(&db).unwrap(), 4);
        assert_eq!(pending_count(&db).unwrap(), 0);
        let page = search(&db, "可索引的正常内容", None, None).unwrap();
        assert_eq!(page.hits.len(), 4);
    }

    #[test]
    fn split_marks_tolerates_forged_and_adjacent_markers() {
        let parts = split_marks("a\u{1}b\u{2}c");
        assert_eq!(
            parts,
            vec![
                SnippetPart {
                    text: "a".into(),
                    marked: false
                },
                SnippetPart {
                    text: "b".into(),
                    marked: true
                },
                SnippetPart {
                    text: "c".into(),
                    marked: false
                },
            ]
        );
        // Marker chars already present in content cannot forge highlight
        // state beyond their own toggle.
        let parts = split_marks("\u{1}\u{2}x");
        assert_eq!(
            parts,
            vec![SnippetPart {
                text: "x".into(),
                marked: false
            }]
        );
    }

    #[test]
    fn like_snippet_marks_all_tokens_case_insensitively() {
        let needles = vec![lower_chars("error"), lower_chars("超时")];
        let parts = like_snippet("请求失败：Error 连接超时，重试后仍然 error 不断", &needles);
        let marked: String = parts
            .iter()
            .filter(|p| p.marked)
            .map(|p| p.text.as_str())
            .collect();
        assert!(marked.contains("Error"), "{marked}");
        assert!(marked.contains("超时"), "{marked}");
        assert!(marked.contains("error"), "{marked}");
    }
}
