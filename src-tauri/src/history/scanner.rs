use super::discovery::{
    codex_candidates, discover_agy, discover_claude, discover_grok, discover_kimi,
    discover_minimax, discover_opencode, discover_qoder, dsh_candidates, identify_head,
    is_codex_subagent_file, is_dsh_subagent_file, opencode_db_visible_sessions, path_is_under,
    pi_family_candidates,
};
use super::{same_or_child, scan_summary_file, split_opencode_db_path, stat_signature, ScanSummary};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;

// Scanning and deletion must agree on disk + index state. In particular, a
// scan that parsed a file before deletion must not upsert it afterwards.
pub(super) static SCAN_LOCK: parking_lot::Mutex<()> = parking_lot::Mutex::new(());

/// Bump when indexed title or preview derivation changes so unchanged files
/// are rebuilt from the current normalized history rows rather than trusted as
/// current. v9: envelope/title-noise migration (<local-command-*>,
/// slash-prefixed titles). v10: internal frames are hidden only when a live
/// capture validator recorded their identity, so summaries derived by the
/// older "any JSON-valid frame" guess are stale.
const TITLE_VERSION: &str = "10";

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

/// The scan only ever needs the
/// db and the event sink, so callers pass those two directly.
fn scan_with_sink(
    db: &crate::db::Db,
    sink: &Arc<crate::event_sink::EventSink>,
) -> Result<ScanReport, String> {
    let guard = SCAN_LOCK.lock();
    let changed_sink = Arc::clone(sink);
    let progress_sink = Arc::clone(sink);
    scan_inner(
        db,
        move || changed_sink.emit_sessions_changed(),
        move |p| progress_sink.emit_scan_progress(p),
        &guard,
    )
}

/// The scan itself, decoupled from the event sink for testing.
pub fn scan_with(db: &crate::db::Db, on_changed: impl Fn()) -> Result<ScanReport, String> {
    let guard = SCAN_LOCK.lock();
    scan_with_guard(db, on_changed, &guard)
}

/// Deletion keeps this guard until both the file and database rows are gone.
pub(super) fn scan_with_guard(
    db: &crate::db::Db,
    on_changed: impl Fn(),
    guard: &parking_lot::MutexGuard<'_, ()>,
) -> Result<ScanReport, String> {
    scan_inner(db, on_changed, |_| {}, guard)
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
            .chain(discover_minimax(&workspace))
            .chain(discover_qoder(
                &workspace,
                crate::engine::qoder::QoderDistribution::Global,
            ))
            .chain(discover_qoder(
                &workspace,
                crate::engine::qoder::QoderDistribution::Cn,
            ))
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

/// Stat every candidate and fold (path, size, mtime) into one signature. The
/// recorded accepted-frame table signature folds in too: recording a new frame
/// identity changes derived history without touching any session file, and a
/// matching global signature would otherwise skip the scan entirely.
fn stat_all(
    workspaces: &[String],
    candidates: &[Candidate],
    accepted_signature: &str,
) -> (Vec<Option<(i64, i64)>>, String) {
    let mut signature_hasher = Sha256::new();
    signature_hasher.update(format!("v{}|", crate::db::CACHE_VERSION).as_bytes());
    signature_hasher.update(accepted_signature.as_bytes());
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
/// changed unless indexed summaries were produced by an older derivation.
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
    // A summary derivation change invalidates every indexed title and preview:
    // their old values cannot reliably identify which normalization rule is
    // missing (for example, a visible prefix followed by a host-only tail).
    let retitle_pending = title_version.as_deref() != Some(TITLE_VERSION);
    if previous.as_deref() == Some(signature.as_str()) && row_count > 0 && !retitle_pending {
        return Ok(None);
    }
    Ok(Some(Tier1 {
        signature,
        retitle_pending,
    }))
}

/// One indexed session file as the db currently records it.
/// `accepted_signature` identifies the recorded internal-frame set that
/// produced its stored title/preview, so a newly recorded identity re-derives
/// exactly the sessions it can affect.
struct IndexedFile {
    size: i64,
    mtime_ms: i64,
    engine: String,
    session_id: String,
    accepted_signature: String,
}

/// Prefetch (brief lock) the stored per-file index state and, while a summary
/// migration runs, mark every indexed path stale. Parsing remains lock-free.
fn prefetch_stat_keys(
    db: &crate::db::Db,
    retitle_pending: bool,
) -> Result<(std::collections::HashMap<String, IndexedFile>, HashSet<String>), String> {
    let conn = db.0.lock();
    let mut stmt = conn
        .prepare(
            "SELECT file_path, file_size, file_mtime_ms, engine, session_id,
                    accepted_frames_signature
             FROM sessions",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                IndexedFile {
                    size: r.get(1)?,
                    mtime_ms: r.get(2)?,
                    engine: r.get(3)?,
                    session_id: r.get(4)?,
                    accepted_signature: r.get(5)?,
                },
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut stats = std::collections::HashMap::new();
    for row in rows {
        match row {
            Ok((path, indexed)) => {
                stats.insert(path, indexed);
            }
            Err(e) => eprintln!("[scanner] skipping undecodable session stat row: {e}"),
        }
    }
    let stale = if retitle_pending {
        stats.keys().cloned().collect()
    } else {
        HashSet::new()
    };
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
    /// Signature of the recorded frame identities this summary was derived
    /// from; stored so the next scan can tell a stale summary from a fresh one.
    accepted_signature: String,
    summary: ScanSummary,
}

fn prepare_candidate(
    cand: &Candidate,
    sig: (i64, i64),
    stat_keys: &std::collections::HashMap<String, IndexedFile>,
    stale_paths: &HashSet<String>,
    workspaces: &[String],
    accepted: &crate::db::AcceptedFrameIndex,
) -> Option<PreparedUpsert> {
    let (size, mtime_ms) = sig;
    let path_str = cand.path.to_string_lossy().to_string();
    // Unchanged on disk, derived from the same recorded frame identities, and
    // not pending re-title: reuse. The stored row names the session, so this
    // check costs no head peek.
    if let Some(indexed) = stat_keys.get(&path_str) {
        let current = accepted
            .get(indexed.engine.as_str())
            .and_then(|sessions| sessions.get(indexed.session_id.as_str()))
            .map_or("", |set| set.signature.as_str());
        if (indexed.size, indexed.mtime_ms) == sig
            && indexed.accepted_signature == current
            && !stale_paths.contains(&path_str)
        {
            return None;
        }
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
    let empty = crate::db::AcceptedFrameSet::default();
    let accepted_set = accepted
        .get(cand.engine)
        .and_then(|sessions| sessions.get(session_id.as_str()))
        .unwrap_or(&empty);
    let summary = scan_summary_file(cand.engine, &cand.path, &accepted_set.hashes).ok()?;
    Some(PreparedUpsert {
        engine: cand.engine,
        session_id,
        workspace_path,
        path_str,
        size,
        mtime_ms,
        accepted_signature: accepted_set.signature.clone(),
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
            .query_map([engine], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })
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
        crate::engine::plan_review::delete_reviews_for_session(&conn, engine, id)?;
    }
    Ok(true)
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
        crate::engine::plan_review::delete_reviews_for_session(&tx, "codex", id)?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(true)
}

/// Drop OpenCode subagent (child) and never-messaged sessions that an earlier
/// scan indexed before `discover_opencode` learned to filter them. The flat
/// file check used for codex/dsh can't inspect a virtual db address, so this
/// re-asks the shared database which indexed sessions are still visible.
fn prune_opencode_hidden_sessions(db: &crate::db::Db) -> Result<bool, String> {
    let grouped: std::collections::HashMap<PathBuf, Vec<String>> = {
        let conn = db.0.lock();
        let mut stmt = conn
            .prepare("SELECT session_id, file_path FROM sessions WHERE engine='opencode'")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;
        let mut grouped: std::collections::HashMap<PathBuf, Vec<String>> =
            std::collections::HashMap::new();
        for row in rows.flatten() {
            let (session_id, path) = row;
            if let Some((db_path, _)) = split_opencode_db_path(Path::new(&path)) {
                grouped.entry(db_path).or_default().push(session_id);
            }
        }
        grouped
    };
    let mut dead: Vec<String> = Vec::new();
    for (db_path, session_ids) in grouped {
        // Unreadable db (missing/locked): leave every indexed row alone.
        let Some(visible) = opencode_db_visible_sessions(&db_path, &session_ids) else {
            continue;
        };
        dead.extend(
            session_ids
                .into_iter()
                .filter(|id| !visible.contains(id)),
        );
    }
    if dead.is_empty() {
        return Ok(false);
    }
    let conn = db.0.lock();
    for id in &dead {
        conn.execute(
            "DELETE FROM sessions WHERE engine='opencode' AND session_id=?1",
            rusqlite::params![id],
        )
        .map_err(|e| e.to_string())?;
        crate::engine::plan_review::delete_reviews_for_session(&conn, "opencode", id)?;
    }
    Ok(true)
}

fn prune_stale_sessions(db: &crate::db::Db) -> Result<bool, String> {
    let outside = prune_codex_sessions_outside_home(db)?;
    let subagent = prune_hidden_subagent_sessions(db)?;
    let opencode = prune_opencode_hidden_sessions(db)?;
    Ok(outside || subagent || opencode)
}

/// Phase B (one lock, one transaction): upsert every prepared row, then
/// record the global scan markers only when every stale title was rebuilt.
fn upsert_rows(
    db: &crate::db::Db,
    rows: &[PreparedUpsert],
    tier1: &Tier1,
    advance_markers: bool,
) -> Result<(), String> {
    let mut conn = db.0.lock();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for row in rows {
        // Engines whose jsonl has no per-line timestamps would otherwise land
        // at updated_at=0 and fall off the sidebar's recent list. File mtime
        // is the fallback for every engine, not a grok-only special case.
        let created_at = row.summary.first_ts.or(Some(row.mtime_ms));
        let updated_at = row.summary.last_ts.or(Some(row.mtime_ms));
        tx.execute(
            "INSERT INTO sessions(engine, session_id, workspace_path, file_path, file_size, file_mtime_ms, title, preview, created_at, updated_at, message_count, accepted_frames_signature)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)
             ON CONFLICT(engine, session_id) DO UPDATE SET
                workspace_path=excluded.workspace_path,
                file_path=excluded.file_path,
                file_size=excluded.file_size,
                file_mtime_ms=excluded.file_mtime_ms,
                title=excluded.title,
                preview=excluded.preview,
                created_at=COALESCE(sessions.created_at, excluded.created_at),
                updated_at=excluded.updated_at,
                message_count=excluded.message_count,
                accepted_frames_signature=excluded.accepted_frames_signature",
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
                row.accepted_signature,
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    if advance_markers {
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
    }
    tx.commit().map_err(|e| e.to_string())
}

/// `on_progress` fires throttled during the parse loop and once with
/// `finished: true` when a scan that emitted any progress completes.
fn scan_inner(
    db: &crate::db::Db,
    on_changed: impl Fn(),
    on_progress: impl Fn(crate::event_sink::ScanProgress),
    _guard: &parking_lot::MutexGuard<'_, ()>,
) -> Result<ScanReport, String> {
    let workspaces = db.workspace_paths()?;
    let candidates = gather_candidates(&workspaces);
    let (accepted, accepted_signature) = db.accepted_internal_frame_index()?;
    let (stats, signature) = stat_all(&workspaces, &candidates, &accepted_signature);
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
    let mut retitle_complete = true;
    for (index, (cand, sig)) in candidates.iter().zip(stats.iter()).enumerate() {
        let processed = index + 1;
        if processed % step == 0 {
            on_progress(crate::event_sink::ScanProgress {
                done: processed,
                total,
                finished: false,
            });
        }
        let path_str = cand.path.to_string_lossy().to_string();
        let stale = stale_paths.contains(&path_str);
        let Some(sig) = sig else {
            if stale {
                retitle_complete = false;
            }
            continue;
        };
        match prepare_candidate(cand, *sig, &stat_keys, &stale_paths, &workspaces, &accepted) {
            Some(row) => rows.push(row),
            None => {
                if stale {
                    retitle_complete = false;
                }
                if stat_keys
                    .get(&path_str)
                    .is_some_and(|indexed| (indexed.size, indexed.mtime_ms) == *sig)
                {
                    reused += 1;
                }
            }
        }
    }

    // Phase B: the db lock is held only for the upsert transaction.
    let reparsed = rows.len();
    upsert_rows(
        db,
        &rows,
        &tier1,
        !tier1.retitle_pending || retitle_complete,
    )?;
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
        // Full-text index follows every scan — including tier-1
        // short-circuits: right after an upgrade the scan may see no file
        // change while the (empty) index still has every session pending.
        // The pass re-parses only sessions whose stat moved, so on a steady
        // machine this is one cheap COUNT query.
        super::search::spawn_index(db);
    });
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;

    /// Point HOME at a scratch dir for the duration of a test.
    /// Serialized: two tests mutating HOME in parallel would clobber each other.
    pub(crate) use crate::paths::HOME_ENV_LOCK as HOME_LOCK;
    pub struct HomeGuard {
        _lock: parking_lot::MutexGuard<'static, ()>,
        prev: HomeEnvPair,
    }
    impl HomeGuard {
        pub fn set(home: &Path) -> Self {
            let lock = HOME_LOCK.lock();
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

    struct HomeEnvPair(Option<std::ffi::OsString>, Option<std::ffi::OsString>);

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

    pub fn scratch_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ccgui-{tag}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    pub fn write_zstd_jsonl(path: &Path, lines: &[&str]) {
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

    /// A custom codex home must not prune sessions indexed from a v0.9
    /// managed provider home — they live outside every codex home by design.
    #[test]
    fn prune_codex_outside_home_keeps_provider_home_sessions() -> Result<(), String> {
        let home = scratch_dir("prune-codex-legacy");
        let _guard = HomeGuard::set(&home);
        let legacy_dir = home
            .join(".ccgui")
            .join("codex-provider-homes")
            .join("p1")
            .join("sessions");
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
                "{}\n{}\n{}\n{}\n",
                "{\"type\":\"title\",\"v\":1,\"title\":\"t\"}",
                format!(
                    "{{\"type\":\"session\",\"version\":3,\"id\":\"sid-1\",\"timestamp\":\"2026-09-05T07:13:57.946Z\",\"cwd\":\"{}\"}}",
                    workspace.display().to_string().replace('\\', "\\\\")
                ),
                "{\"type\":\"message\",\"timestamp\":\"2026-09-05T07:14:06.682Z\",\"message\":{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"hello\"}]}}",
                "{\"type\":\"message\",\"timestamp\":\"2026-09-05T07:14:07.682Z\",\"message\":{\"role\":\"assistant\",\"content\":[{\"type\":\"text\",\"text\":\"answer\\n<CCGUI_INTERNAL_abcdefgh>{\\\"pluginId\\\":\\\"bridge\\\"}</CCGUI_INTERNAL_abcdefgh>\"}]}}",
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
        let (title, preview): (String, String) = {
            let conn = db.0.lock();
            conn.query_row(
                "SELECT title, preview FROM sessions WHERE engine='omp' AND session_id='sid-1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|e| e.to_string())?
        };
        // This rollout's frame was never recorded by a live capture validator,
        // so history keeps it visible: an unrecorded look-alike is model output,
        // not a host-hidden frame.
        let frame = "<CCGUI_INTERNAL_abcdefgh>{\"pluginId\":\"bridge\"}</CCGUI_INTERNAL_abcdefgh>";
        assert_eq!(title, "hello");
        assert_eq!(preview, format!("answer\n{frame}"));

        // Simulate an older cache with an unchanged rollout whose summary still
        // carries the host-only request tail and hides a frame no validator ever
        // accepted. The summary migration must bypass both stat caches and
        // preserve custom titles.
        {
            let conn = db.0.lock();
            conn.execute(
                "UPDATE sessions SET title=?1, preview=?2, custom_title='My title'",
                rusqlite::params![
                    "hello\n\n[CCGUI internal request-tail]\nsecret",
                    "answer",
                ],
            )
            .map_err(|e| e.to_string())?;
            conn.execute("UPDATE meta SET value='7' WHERE key='title_version'", [])
                .map_err(|e| e.to_string())?;
        }
        let report = scan_with(&db, || {})?;
        assert_eq!(report.reparsed, 1);
        {
            let conn = db.0.lock();
            let (title, preview, custom): (String, String, String) = conn
                .query_row(
                    "SELECT title, preview, custom_title FROM sessions WHERE session_id='sid-1'",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .map_err(|e| e.to_string())?;
            assert_eq!(title, "hello");
            assert_eq!(preview, format!("answer\n{frame}"));
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

        // Recording the frame's identity is itself a summary input: the next
        // scan re-derives this session even though the file never changed, and
        // only then is the frame hidden.
        assert!(db
            .record_accepted_internal_frame_hash(
                "omp",
                "sid-1",
                &crate::history::internal_frame_hash(frame),
                "",
            )
            .map_err(|e| e.to_string())?);
        assert_eq!(scan_with(&db, || {})?.reparsed, 1);
        {
            let conn = db.0.lock();
            let preview: String = conn
                .query_row(
                    "SELECT preview FROM sessions WHERE session_id='sid-1'",
                    [],
                    |r| r.get(0),
                )
                .map_err(|e| e.to_string())?;
            assert_eq!(preview, "answer");
        }
        assert_eq!(scan_with(&db, || {})?.reparsed, 0);
        drop(db);
        std::fs::remove_dir_all(&home).ok();
        Ok(())
    }

    #[test]
    fn retitle_migration_retries_after_partial_parse_failure() -> Result<(), String> {
        let home = scratch_dir("scan-retitle-retry");
        let workspace = home.join("ws");
        let sessions_dir = home.join(".omp").join("agent").join("sessions").join("-ws");
        std::fs::create_dir_all(&sessions_dir).map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&workspace).map_err(|e| e.to_string())?;

        let session_contents = |id: &str, title: &str| {
            format!(
                "{}\n{}\n",
                format!(
                    "{{\"type\":\"session\",\"version\":3,\"id\":\"{id}\",\"timestamp\":\"2026-09-05T07:13:57.946Z\",\"cwd\":\"{}\"}}",
                    workspace.display().to_string().replace('\\', "\\\\")
                ),
                format!(
                    "{{\"type\":\"message\",\"timestamp\":\"2026-09-05T07:14:06.682Z\",\"message\":{{\"role\":\"user\",\"content\":[{{\"type\":\"text\",\"text\":\"{title}\"}}]}}}}"
                )
            )
        };
        let valid_path = sessions_dir.join("valid.jsonl");
        let retry_path = sessions_dir.join("retry.jsonl");
        std::fs::write(&valid_path, session_contents("valid", "valid title"))
            .map_err(|e| e.to_string())?;
        std::fs::write(&retry_path, session_contents("retry", "repaired title"))
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
        assert_eq!(scan_with(&db, || {})?.reparsed, 2);
        let original_signature: String = {
            let conn = db.0.lock();
            conn.query_row(
                "SELECT value FROM meta WHERE key='stat_signature'",
                [],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?
        };

        {
            let conn = db.0.lock();
            conn.execute(
                "UPDATE sessions SET title='<recommended_plugins>stale' WHERE session_id IN ('valid', 'retry')",
                [],
            )
            .map_err(|e| e.to_string())?;
            conn.execute("UPDATE meta SET value='7' WHERE key='title_version'", [])
                .map_err(|e| e.to_string())?;
        }
        std::fs::write(&retry_path, "not a session\n").map_err(|e| e.to_string())?;
        let workspace_paths = vec![workspace.to_string_lossy().to_string()];
        let (_, malformed_signature) =
            stat_all(&workspace_paths, &gather_candidates(&workspace_paths), "");
        assert_ne!(malformed_signature, original_signature);

        let partial = scan_with(&db, || {})?;
        assert_eq!(partial.reparsed, 1);
        {
            let conn = db.0.lock();
            let (version, signature, valid_title, retry_title): (String, String, String, String) = conn
                .query_row(
                    "SELECT
                        (SELECT value FROM meta WHERE key='title_version'),
                        (SELECT value FROM meta WHERE key='stat_signature'),
                        (SELECT title FROM sessions WHERE session_id='valid'),
                        (SELECT title FROM sessions WHERE session_id='retry')",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
                )
                .map_err(|e| e.to_string())?;
            assert_eq!(version, "7");
            assert_eq!(signature, original_signature);
            assert_eq!(valid_title, "valid title");
            assert_eq!(retry_title, "<recommended_plugins>stale");
        }

        std::fs::write(&retry_path, session_contents("retry", "repaired title"))
            .map_err(|e| e.to_string())?;
        scan_with(&db, || {})?;
        {
            let conn = db.0.lock();
            let (version, signature, retry_title): (String, String, String) = conn
                .query_row(
                    "SELECT
                        (SELECT value FROM meta WHERE key='title_version'),
                        (SELECT value FROM meta WHERE key='stat_signature'),
                        (SELECT title FROM sessions WHERE session_id='retry')",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .map_err(|e| e.to_string())?;
            let (_, repaired_signature) =
                stat_all(&workspace_paths, &gather_candidates(&workspace_paths), "");
            assert_eq!(version, TITLE_VERSION);
            assert_eq!(signature, repaired_signature);
            assert_eq!(retry_title, "repaired title");
        }

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

    #[test]
    fn delete_unscanned_failed_sessions_on_first_attempt() -> Result<(), String> {
        let home = scratch_dir(&format!("delete-unscanned-{}", uuid::Uuid::new_v4()));
        let _home_guard = HomeGuard::set(&home);
        // HomeGuard owns HOME_LOCK; restore engine overrides even on a panic.
        struct EngineHomes(Vec<(&'static str, Option<std::ffi::OsString>)>);
        impl Drop for EngineHomes {
            fn drop(&mut self) {
                for (key, value) in &self.0 {
                    match value {
                        Some(value) => std::env::set_var(key, value),
                        None => std::env::remove_var(key),
                    }
                }
            }
        }
        let _engine_homes = EngineHomes(
            ["CODEX_HOME", "CLAUDE_CONFIG_DIR"]
                .into_iter()
                .map(|key| (key, std::env::var_os(key)))
                .collect(),
        );
        std::env::set_var("CODEX_HOME", home.join(".codex"));
        std::env::set_var("CLAUDE_CONFIG_DIR", home.join(".claude"));
        let workspace = home.join("ws");
        std::fs::create_dir_all(&workspace).map_err(|e| e.to_string())?;
        let db = crate::db::Db::open_at(&home.join("app.db")).map_err(|e| e.to_string())?;
        db.0.lock()
            .execute(
                "INSERT INTO workspaces(id,path,name) VALUES('w1',?1,'ws')",
                [workspace.to_string_lossy().as_ref()],
            )
            .map_err(|e| e.to_string())?;
        let session_id = "failed-first-turn";
        let claude_path = home
            .join(".claude")
            .join("projects")
            .join(super::super::claude_encode_project_path(
                &workspace.to_string_lossy(),
            ))
            .join(format!("{session_id}.jsonl"));
        let codex_path = home
            .join(".codex")
            .join("sessions")
            .join("2026")
            .join("09")
            .join("18")
            .join(format!("rollout-2026-09-18T00-00-00-{session_id}.jsonl"));
        let fixtures = [
            (
                "claude",
                claude_path,
                vec![serde_json::json!({
                    "type": "user", "sessionId": session_id,
                    "message": {"role": "user", "content": "hello"}
                })],
            ),
            (
                "codex",
                codex_path,
                vec![
                    serde_json::json!({"type": "session_meta", "payload": {
                        "id": session_id, "cwd": workspace.to_string_lossy()
                    }}),
                    serde_json::json!({"type": "response_item", "payload": {
                        "type": "message", "role": "user",
                        "content": [{"type": "input_text", "text": "hello"}]
                    }}),
                ],
            ),
        ];
        for (engine, path, lines) in &fixtures {
            // Each engine starts with a real file and no sessions-table row.
            std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
            let text = lines
                .iter()
                .map(serde_json::Value::to_string)
                .collect::<Vec<_>>()
                .join("\n")
                + "\n";
            std::fs::write(path, text).map_err(|e| e.to_string())?;
            db.remember_session_model(engine, session_id, "model", 1)?;
            db.remember_session_effort(engine, session_id, "high", 1)?;
            db.record_accepted_internal_frame_hash(
                engine, session_id, &"a".repeat(64), &workspace.to_string_lossy(),
            )?;
            let count: i64 = db.0.lock().query_row(
                "SELECT COUNT(*) FROM sessions WHERE engine=?1 AND session_id=?2",
                rusqlite::params![engine, session_id], |r| r.get(0),
            ).map_err(|e| e.to_string())?;
            assert_eq!(count, 0);

            super::super::reader::delete_session_blocking(&db, engine, session_id)?;
            assert!(
                !path.exists(),
                "{engine}: first delete must remove the transcript"
            );
            scan_with(&db, || {})?;
            for table in ["accepted_internal_frames", "sessions", "session_models", "session_efforts"] {
                let count: i64 = db.0.lock().query_row(
                    &format!("SELECT COUNT(*) FROM {table} WHERE engine=?1 AND session_id=?2"),
                    rusqlite::params![engine, session_id], |r| r.get(0),
                ).map_err(|e| e.to_string())?;
                assert_eq!(count, 0, "{engine}: {table} must stay deleted after scanning");
            }
            // An already deleted session and one that never wrote a transcript
            // both complete without asking the user to delete a second time.
            super::super::reader::delete_session_blocking(&db, engine, session_id)?;
            db.remember_session_model(engine, "never-persisted", "model", 1)?;
            super::super::reader::delete_session_blocking(&db, engine, "never-persisted")?;
            let count: i64 = db.0.lock().query_row(
                "SELECT COUNT(*) FROM session_models WHERE engine=?1 AND session_id='never-persisted'",
                [engine], |r| r.get(0),
            ).map_err(|e| e.to_string())?;
            assert_eq!(count, 0);
        }
        db.0.lock()
            .execute("DROP TABLE meta", [])
            .map_err(|e| e.to_string())?;
        let error =
            super::super::reader::delete_session_blocking(&db, "codex", "scan-failed").unwrap_err();
        assert!(
            error.contains("scan before deleting codex/scan-failed"),
            "{error}"
        );
        assert!(error.contains("no such table"), "{error}");
        drop(db);
        std::fs::remove_dir_all(&home).map_err(|e| e.to_string())?;
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
        let project = home.join(".dsh").join("sessions").join("--ws--");
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

    /// An earlier scan (before the db arm filtered subagents / empty sessions)
    /// indexed rows that discovery no longer returns. The prune must drop them
    /// from the sidebar while leaving the still-visible session alone.
    #[test]
    fn scan_prunes_hidden_opencode_sessions() -> Result<(), String> {
        let home = scratch_dir("scan-opencode-hidden");
        let workspace = home.join("ws");
        std::fs::create_dir_all(&workspace).map_err(|e| e.to_string())?;
        let ws = workspace.to_string_lossy().to_string();
        let data_root = home.join(".local/share/opencode");
        std::fs::create_dir_all(&data_root).map_err(|e| e.to_string())?;
        let opencode_db = data_root.join("opencode.db");
        {
            let conn = rusqlite::Connection::open(&opencode_db).map_err(|e| e.to_string())?;
            conn.execute_batch(
                "CREATE TABLE session(id TEXT PRIMARY KEY, directory TEXT NOT NULL,
                    parent_id TEXT, time_archived INTEGER, time_updated INTEGER NOT NULL);
                 CREATE TABLE message(id TEXT PRIMARY KEY, session_id TEXT NOT NULL);",
            )
            .map_err(|e| e.to_string())?;
            let session = |id: &str, parent: Option<&str>, updated: i64| {
                conn.execute(
                    "INSERT INTO session VALUES(?1,?2,?3,NULL,?4)",
                    rusqlite::params![id, ws, parent, updated],
                )
                .map_err(|e| e.to_string())
            };
            session("ses_visible", None, 3)?;
            session("ses_subagent", Some("ses_visible"), 2)?;
            session("ses_empty", None, 1)?;
            conn.execute("INSERT INTO message VALUES('m_visible','ses_visible')", [])
                .map_err(|e| e.to_string())?;
            conn.execute("INSERT INTO message VALUES('m_subagent','ses_subagent')", [])
                .map_err(|e| e.to_string())?;
        }
        let _guard = HomeGuard::set(&home);
        let db = crate::db::Db::open_at(&home.join("app.db")).map_err(|e| e.to_string())?;
        {
            let conn = db.0.lock();
            conn.execute(
                "INSERT INTO workspaces(id, path, name) VALUES('w1', ?1, 'ws')",
                [&ws],
            )
            .map_err(|e| e.to_string())?;
            let index = |id: &str| {
                conn.execute(
                    "INSERT INTO sessions(engine, session_id, workspace_path, file_path, file_size, file_mtime_ms, title) VALUES('opencode', ?1, ?2, ?3, 1, 1, '')",
                    rusqlite::params![
                        id,
                        ws,
                        super::super::opencode_db_session_path(&opencode_db, id)
                            .to_string_lossy()
                            .to_string()
                    ],
                )
                .map_err(|e| e.to_string())
            };
            index("ses_visible")?;
            index("ses_subagent")?;
            index("ses_empty")?;
        }
        scan_with(&db, || {})?;
        let ids: Vec<String> = {
            let conn = db.0.lock();
            let mut stmt = conn
                .prepare("SELECT session_id FROM sessions WHERE engine='opencode' ORDER BY session_id")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |r| r.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
        };
        assert_eq!(ids, vec!["ses_visible".to_string()]);
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
}
