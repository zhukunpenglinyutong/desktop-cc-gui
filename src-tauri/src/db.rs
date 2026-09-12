use parking_lot::Mutex;
use rusqlite::{Connection, OptionalExtension};

/// Folded into the scanner's stat signature so a schema/derivation change
/// still invalidates cached parse results.
pub const CACHE_VERSION: &str = "2";

pub struct Db(pub Mutex<Connection>);

impl Db {
    pub fn open() -> rusqlite::Result<Self> {
        Self::open_at(&crate::paths::db_path())
    }
    pub fn open_at(path: &std::path::Path) -> rusqlite::Result<Self> {
        // The db sits next to config.json (provider API keys): owner-only.
        // Touch the file first so the permission lands before sqlite's own
        // lazy creation can pick a looser umask default.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::OpenOptions::new()
                .create(true)
                .write(true)
                .open(path);
            if let Err(e) = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)) {
                eprintln!("[db] chmod 0600 {}: {e}", path.display());
            }
        }
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;
        migrate(&conn)?;
        Ok(Self(Mutex::new(conn)))
    }

    /// All registered workspace roots (session attribution + path confinement).
    pub fn workspace_paths(&self) -> Result<Vec<String>, String> {
        let conn = self.0.lock();
        let mut stmt = conn
            .prepare("SELECT path FROM workspaces")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for row in rows {
            match row {
                Ok(path) => out.push(path),
                Err(e) => eprintln!("[db] skipping undecodable workspace row: {e}"),
            }
        }
        Ok(out)
    }

    /// Directories the user explicitly granted file access to on top of the
    /// registered workspaces (the on-demand grant flow, files::grant_root).
    pub fn granted_roots(&self) -> Result<Vec<String>, String> {
        let conn = self.0.lock();
        let mut stmt = conn
            .prepare("SELECT path FROM granted_roots ORDER BY granted_at")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for row in rows {
            match row {
                Ok(path) => out.push(path),
                Err(e) => eprintln!("[db] skipping undecodable granted_roots row: {e}"),
            }
        }
        Ok(out)
    }

    pub fn add_granted_root(&self, path: &str) -> Result<(), String> {
        let conn = self.0.lock();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        conn.execute(
            "INSERT OR IGNORE INTO granted_roots(path, granted_at) VALUES(?1, ?2)",
            rusqlite::params![path, now],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn remove_granted_root(&self, path: &str) -> Result<(), String> {
        let conn = self.0.lock();
        conn.execute("DELETE FROM granted_roots WHERE path=?1", [path])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    /// Per-plugin KV value (plugins::plugin_storage_get). Stored as JSON text;
    /// a corrupt row surfaces as an error instead of a silent `None` so the
    /// plugin host notices instead of losing state quietly.
    /// Devices that have reached the LAN bridge, newest first. `approved_at`
    /// being set is what lets a device through: the user approves each new
    /// device in the app before it can see or drive anything.
    pub fn web_devices(&self) -> Result<Vec<crate::web::WebDevice>, String> {
        let conn = self.0.lock();
        let mut stmt = conn
            .prepare(
                "SELECT id, user_agent, created_at, last_seen_at, approved_at, name
                 FROM web_devices ORDER BY COALESCE(approved_at, 0) DESC, last_seen_at DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(crate::web::WebDevice {
                    id: r.get(0)?,
                    user_agent: r.get(1)?,
                    created_at: r.get(2)?,
                    last_seen_at: r.get(3)?,
                    approved_at: r.get(4)?,
                    name: r.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    }

    pub fn web_device_get(&self, id: &str) -> Result<Option<crate::web::WebDevice>, String> {
        let conn = self.0.lock();
        conn.query_row(
            "SELECT id, user_agent, created_at, last_seen_at, approved_at, name
             FROM web_devices WHERE id=?1",
            rusqlite::params![id],
            |r| {
                Ok(crate::web::WebDevice {
                    id: r.get(0)?,
                    user_agent: r.get(1)?,
                    created_at: r.get(2)?,
                    last_seen_at: r.get(3)?,
                    approved_at: r.get(4)?,
                    name: r.get(5)?,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())
    }

    /// Remember a device that is asking for access (idempotent: a device that
    /// keeps polling just refreshes `last_seen_at`, and an approval survives).
    pub fn web_device_touch(&self, id: &str, user_agent: &str, now: i64) -> Result<(), String> {
        let conn = self.0.lock();
        conn.execute(
            "INSERT INTO web_devices (id, user_agent, created_at, last_seen_at)
             VALUES (?1, ?2, ?3, ?3)
             ON CONFLICT(id) DO UPDATE SET last_seen_at=?3,
               user_agent=CASE WHEN excluded.user_agent != '' THEN excluded.user_agent ELSE user_agent END",
            rusqlite::params![id, user_agent, now],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Remember the model id a session ran, spelled as the picker spells it
    /// ("provider/model"). The engine's own transcript keeps only the bare
    /// model name, so this row is the session's provider + model memory for
    /// every other client and for the next app start.
    pub fn remember_session_model(
        &self,
        engine: &str,
        session_id: &str,
        model: &str,
        now: i64,
    ) -> Result<(), String> {
        let conn = self.0.lock();
        conn.execute(
            "INSERT INTO session_models(engine, session_id, model, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(engine, session_id) DO UPDATE SET model=excluded.model, updated_at=excluded.updated_at",
            rusqlite::params![engine, session_id, model, now],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Approve (or re-approve) a device. Unknown ids are ignored: the row is
    /// created by the device's own request, never by the UI.
    pub fn web_device_approve(&self, id: &str, now: i64) -> Result<bool, String> {
        let conn = self.0.lock();
        let changed = conn
            .execute(
                "UPDATE web_devices SET approved_at=?2 WHERE id=?1",
                rusqlite::params![id, now],
            )
            .map_err(|e| e.to_string())?;
        Ok(changed > 0)
    }

    /// Remember a name for a paired device. An empty name clears it, so the row
    /// falls back to the user-agent summary on its own.
    pub fn web_device_set_name(&self, id: &str, name: &str) -> Result<bool, String> {
        let conn = self.0.lock();
        let trimmed = name.trim();
        let changed = conn
            .execute(
                "UPDATE web_devices SET name=?2 WHERE id=?1",
                rusqlite::params![id, (!trimmed.is_empty()).then_some(trimmed)],
            )
            .map_err(|e| e.to_string())?;
        Ok(changed > 0)
    }

    /// Revoke a device; its cookie stops matching on the next request.
    pub fn web_device_revoke(&self, id: &str) -> Result<bool, String> {
        let conn = self.0.lock();
        let changed = conn
            .execute("DELETE FROM web_devices WHERE id=?1", rusqlite::params![id])
            .map_err(|e| e.to_string())?;
        Ok(changed > 0)
    }

    pub fn plugin_kv_get(
        &self,
        plugin_id: &str,
        key: &str,
    ) -> Result<Option<serde_json::Value>, String> {
        let conn = self.0.lock();
        let raw: Option<String> = conn
            .query_row(
                "SELECT value FROM plugin_kv WHERE plugin_id=?1 AND key=?2",
                rusqlite::params![plugin_id, key],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        match raw {
            None => Ok(None),
            Some(text) => serde_json::from_str(&text)
                .map(Some)
                .map_err(|e| format!("decode plugin_kv[{plugin_id}/{key}]: {e}")),
        }
    }

    pub fn plugin_kv_set(
        &self,
        plugin_id: &str,
        key: &str,
        value: &serde_json::Value,
    ) -> Result<(), String> {
        let text = serde_json::to_string(value).map_err(|e| e.to_string())?;
        let conn = self.0.lock();
        conn.execute(
            "INSERT INTO plugin_kv(plugin_id, key, value) VALUES(?1, ?2, ?3)
             ON CONFLICT(plugin_id, key) DO UPDATE SET value=excluded.value",
            rusqlite::params![plugin_id, key, text],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn plugin_kv_delete(&self, plugin_id: &str, key: &str) -> Result<(), String> {
        let conn = self.0.lock();
        conn.execute(
            "DELETE FROM plugin_kv WHERE plugin_id=?1 AND key=?2",
            rusqlite::params![plugin_id, key],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Whole-plugin wipe: uninstall with delete_data, and the tombstone purge
    /// after the 30-day retention window (plugins::KV_TOMBSTONE_TTL_SECS).
    pub fn plugin_kv_delete_all(&self, plugin_id: &str) -> Result<(), String> {
        let conn = self.0.lock();
        conn.execute(
            "DELETE FROM plugin_kv WHERE plugin_id=?1",
            rusqlite::params![plugin_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }
}

/// One-time import of the legacy desktop-cc-gui workspace list
/// (`paths::legacy_workspaces_path`): old users open the upgrade and find
/// their sidebar intact. Rows already registered (same path) only adopt the
/// legacy order; new paths are inserted with their legacy id/name. Guarded
/// by a meta flag so a workspace removed in the new app is never
/// resurrected on the next launch.
pub fn import_legacy_workspaces_once(db: &Db) -> Result<(), String> {
    import_legacy_workspaces_from(db, &crate::paths::legacy_workspaces_path())
}

fn import_legacy_workspaces_from(db: &Db, path: &std::path::Path) -> Result<(), String> {
    let conn = db.0.lock();
    let done = conn
        .query_row(
            "SELECT value FROM meta WHERE key='legacy_workspaces_import_v1'",
            [],
            |r| r.get::<_, String>(0),
        )
        .ok();
    if done.is_some() {
        return Ok(());
    }

    if path.is_file() {
        let content =
            std::fs::read_to_string(path).map_err(|e| format!("read {}: {e}", path.display()))?;
        let legacy: Vec<serde_json::Value> =
            serde_json::from_str(&content).map_err(|e| format!("parse {}: {e}", path.display()))?;
        // Sidebar order: ungrouped workspaces first (file order), then each
        // group with its internal sortOrder. Worktree children (parentId)
        // have no new-app equivalent and are skipped.
        let mut entries: Vec<(usize, &serde_json::Value)> = legacy
            .iter()
            .enumerate()
            .filter(|(_, w)| {
                w.get("parentId").and_then(|v| v.as_str()).is_none()
                    && w.get("path")
                        .and_then(|v| v.as_str())
                        .is_some_and(|p| !p.trim().is_empty())
            })
            .collect();
        entries.sort_by_key(|(i, w)| {
            let group = w
                .pointer("/settings/groupId")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let sort = w
                .pointer("/settings/sortOrder")
                .and_then(|v| v.as_i64())
                .unwrap_or(i64::MAX);
            (u8::from(!group.is_empty()), group.to_string(), sort, *i)
        });

        let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let mut index = 0i64;
        let mut imported_paths = std::collections::HashSet::new();
        for (_, w) in &entries {
            let path = w.get("path").and_then(|v| v.as_str()).unwrap_or("").trim();
            let name = w
                .get("name")
                .and_then(|v| v.as_str())
                .filter(|n| !n.trim().is_empty())
                .unwrap_or_else(|| path.rsplit('/').next().unwrap_or(path));
            let id = w
                .get("id")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
            // Group assignment rides along with the row (legacy
            // `settings.groupId`); a conflict keeps any assignment the user
            // already made in the new app.
            let group_id = w
                .pointer("/settings/groupId")
                .and_then(|v| v.as_str())
                .filter(|s| !s.trim().is_empty());
            tx.execute(
                "INSERT INTO workspaces(id, path, name, sort_order, group_id) VALUES(?1,?2,?3,?4,?5)
                 ON CONFLICT(path) DO UPDATE SET sort_order=excluded.sort_order,
                    group_id=COALESCE(workspaces.group_id, excluded.group_id)",
                rusqlite::params![id, path, name, index, group_id],
            )
            .map_err(|e| e.to_string())?;
            imported_paths.insert(path.to_string());
            index += 1;
        }
        // Rows the legacy list doesn't know (added in the new app before the
        // upgrade) keep their relative order, appended after the import.
        let mut stmt = tx
            .prepare(
                "SELECT id, path FROM workspaces
                 ORDER BY sort_order IS NULL, sort_order, COALESCE(last_opened_at, 0) DESC",
            )
            .map_err(|e| e.to_string())?;
        let remaining: Vec<(String, String)> = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?
            .flatten()
            .collect();
        drop(stmt);
        for (id, row_path) in remaining {
            if imported_paths.contains(&row_path) {
                continue;
            }
            tx.execute(
                "UPDATE workspaces SET sort_order=?2 WHERE id=?1",
                rusqlite::params![id, index],
            )
            .map_err(|e| e.to_string())?;
            index += 1;
        }
        tx.commit().map_err(|e| e.to_string())?;
    }

    // Flag set even without a legacy file (fresh machine): never re-probe.
    conn.execute(
        "INSERT OR REPLACE INTO meta(key, value) VALUES('legacy_workspaces_import_v1', '1')",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS workspaces(
            id TEXT PRIMARY KEY,
            path TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            last_opened_at INTEGER
        );
        CREATE TABLE IF NOT EXISTS sessions(
            engine TEXT NOT NULL,
            session_id TEXT NOT NULL,
            workspace_path TEXT NOT NULL,
            file_path TEXT NOT NULL,
            file_size INTEGER NOT NULL,
            file_mtime_ms INTEGER NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            preview TEXT NOT NULL DEFAULT '',
            created_at INTEGER,
            updated_at INTEGER,
            message_count INTEGER NOT NULL DEFAULT 0,
            pinned INTEGER NOT NULL DEFAULT 0,
            custom_title TEXT,
            PRIMARY KEY(engine, session_id)
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON sessions(workspace_path);
        CREATE TABLE IF NOT EXISTS meta(
            key TEXT PRIMARY KEY,
            value TEXT
        );
        CREATE TABLE IF NOT EXISTS granted_roots(
            path TEXT PRIMARY KEY,
            granted_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS web_devices(
            id TEXT PRIMARY KEY,
            user_agent TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL,
            last_seen_at INTEGER NOT NULL,
            approved_at INTEGER,
            name TEXT
        );
        CREATE TABLE IF NOT EXISTS usage_ledger(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts INTEGER NOT NULL,
            engine TEXT NOT NULL,
            model TEXT NOT NULL DEFAULT '',
            session_id TEXT,
            workspace_path TEXT,
            input_tokens INTEGER NOT NULL DEFAULT 0,
            output_tokens INTEGER NOT NULL DEFAULT 0,
            cache_read INTEGER NOT NULL DEFAULT 0,
            cache_write INTEGER NOT NULL DEFAULT 0,
            duration_ms INTEGER,
            reports INTEGER NOT NULL DEFAULT 1
        );
        CREATE INDEX IF NOT EXISTS idx_usage_ledger_ts ON usage_ledger(ts);
        CREATE TABLE IF NOT EXISTS plugin_kv(
            plugin_id TEXT NOT NULL,
            key TEXT NOT NULL,
            value TEXT NOT NULL,
            PRIMARY KEY(plugin_id, key)
        );
        CREATE TABLE IF NOT EXISTS session_models(
            engine TEXT NOT NULL,
            session_id TEXT NOT NULL,
            model TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY(engine, session_id)
        );
        ",
    )?;
    // NB: no `cache_version` meta row — it was written but never read; cache
    // freshness is carried by the scanner's stat signature (see CACHE_VERSION).
    // Additive migration: usage rows gained a per-turn request count.
    let has_reports = conn
        .prepare("PRAGMA table_info(usage_ledger)")?
        .query_map([], |r| r.get::<_, String>(1))?
        .filter_map(Result::ok)
        .any(|name| name == "reports");
    if !has_reports {
        conn.execute(
            "ALTER TABLE usage_ledger ADD COLUMN reports INTEGER NOT NULL DEFAULT 1",
            [],
        )?;
    }
    // Additive migration: a name the user gave a paired device, shown instead
    // of the user-agent summary.
    let has_device_name = conn
        .prepare("PRAGMA table_info(web_devices)")?
        .query_map([], |row| row.get::<_, String>(1))?
        .flatten()
        .any(|name| name == "name");
    if !has_device_name {
        conn.execute("ALTER TABLE web_devices ADD COLUMN name TEXT", [])?;
    }

    // Additive migration: user-defined workspace order (drag reorder).
    let has_sort_order = conn
        .prepare("PRAGMA table_info(workspaces)")?
        .query_map([], |row| row.get::<_, String>(1))?
        .flatten()
        .any(|name| name == "sort_order");
    if !has_sort_order {
        conn.execute("ALTER TABLE workspaces ADD COLUMN sort_order INTEGER", [])?;
    }

    // Additive migration: sidebar group assignment (工作区分组), matching the
    // legacy app's per-workspace `settings.groupId` in workspaces.json.
    let has_group_id = conn
        .prepare("PRAGMA table_info(workspaces)")?
        .query_map([], |row| row.get::<_, String>(1))?
        .flatten()
        .any(|name| name == "group_id");
    if !has_group_id {
        conn.execute("ALTER TABLE workspaces ADD COLUMN group_id TEXT", [])?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Scratch(std::path::PathBuf);
    impl Scratch {
        fn new() -> Self {
            let dir =
                std::env::temp_dir().join(format!("ccgui-next-db-test-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
        fn path(&self, name: &str) -> std::path::PathBuf {
            self.0.join(name)
        }
    }
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn session_model_record_round_trips_and_takes_the_newest() {
        let scratch = Scratch::new();
        let db = Db::open_at(&scratch.path("app.db")).unwrap();
        db.0.lock()
            .execute(
                "INSERT INTO sessions(engine, session_id, workspace_path, file_path, file_size, file_mtime_ms, title)
                 VALUES('omp', 's1', '/ws', 'f.jsonl', 1, 1, 'first message')",
                [],
            )
            .unwrap();
        // The join list_sessions runs: a session with no record has no model.
        let read = || -> Option<String> {
            let conn = db.0.lock();
            conn.query_row(
                "SELECT m.model FROM sessions s
                 LEFT JOIN session_models m ON m.engine = s.engine AND m.session_id = s.session_id
                 WHERE s.engine='omp' AND s.session_id='s1'",
                [],
                |r| r.get(0),
            )
            .unwrap()
        };
        assert_eq!(read(), None, "no record yet");

        db.remember_session_model("omp", "s1", "agentrouter qunyou/deepseek-v4-flash", 10)
            .unwrap();
        assert_eq!(
            read().as_deref(),
            Some("agentrouter qunyou/deepseek-v4-flash"),
            "the provider-qualified id is what survives"
        );

        db.remember_session_model("omp", "s1", "薄荷/claude-opus-5", 20)
            .unwrap();
        assert_eq!(read().as_deref(), Some("薄荷/claude-opus-5"), "newest wins");
    }

    #[test]
    fn web_device_needs_approval_before_the_gate_lets_it_through() {
        let scratch = Scratch::new();
        let db = Db::open_at(&scratch.path("app.db")).unwrap();

        db.web_device_touch("d1", "iPhone Safari", 1_000).unwrap();
        let pending = db.web_device_get("d1").unwrap().unwrap();
        assert!(pending.approved_at.is_none(), "a fresh device is pending");
        assert_eq!(pending.user_agent, "iPhone Safari");

        assert!(db.web_device_approve("d1", 2_000).unwrap());
        let approved = db.web_device_get("d1").unwrap().unwrap();
        assert_eq!(approved.approved_at, Some(2_000));
        assert_eq!(approved.created_at, 1_000, "approval keeps the first-seen time");

        assert!(db.web_device_revoke("d1").unwrap());
        assert!(db.web_device_get("d1").unwrap().is_none(), "revoked = forgotten");
    }

    #[test]
    fn web_device_touch_keeps_approval_and_lists_approved_first() {
        let scratch = Scratch::new();
        let db = Db::open_at(&scratch.path("app.db")).unwrap();

        db.web_device_touch("old", "ua", 1).unwrap();
        db.web_device_approve("old", 2).unwrap();
        db.web_device_touch("new", "ua", 3).unwrap();

        // Polling again must not lose the approval, blank the UA, or reset
        // first-seen — the waiting page reloads every 2.5s.
        db.web_device_touch("old", "", 4).unwrap();
        let old = db.web_device_get("old").unwrap().unwrap();
        assert_eq!(old.approved_at, Some(2));
        assert_eq!(old.user_agent, "ua");
        assert_eq!(old.last_seen_at, 4);

        let listed = db.web_devices().unwrap();
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].id, "old", "approved devices list first");
        assert_eq!(listed[1].id, "new");
    }

    fn list(db: &Db) -> Vec<(String, String, Option<i64>)> {
        let conn = db.0.lock();
        let mut stmt = conn
            .prepare(
                "SELECT id, path, sort_order FROM workspaces
                 ORDER BY sort_order IS NULL, sort_order",
            )
            .unwrap();
        stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<i64>>(2)?,
            ))
        })
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
    }

    #[test]
    fn legacy_import_merges_order_and_runs_once() {
        let scratch = Scratch::new();
        let db = Db::open_at(&scratch.path("app.db")).unwrap();
        // Pre-existing registrations: one path shared with the legacy list
        // (keeps its new-app id), one the legacy list doesn't know.
        {
            let conn = db.0.lock();
            conn.execute(
                "INSERT INTO workspaces(id, path, name, last_opened_at, sort_order)
                 VALUES('new-id-shared', '/ws/shared', 'shared-new-name', 100, 0)",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO workspaces(id, path, name, last_opened_at, sort_order)
                 VALUES('new-id-extra', '/ws/extra', 'extra', 200, 1)",
                [],
            )
            .unwrap();
        }
        let legacy = r#"[
            {"id":"legacy-grouped","name":"grouped-ws","path":"/ws/shared","kind":"main",
             "parentId":null,"settings":{"sortOrder":2,"groupId":"g1"}},
            {"id":"legacy-ungrouped","name":"ungrouped-ws","path":"/ws/ungrouped","kind":"main",
             "parentId":null,"settings":{"sortOrder":null,"groupId":null}},
            {"id":"legacy-child","name":"worktree-child","path":"/ws/child","kind":"worktree",
             "parentId":"legacy-grouped","settings":{"sortOrder":null,"groupId":null}}
        ]"#;
        let legacy_path = scratch.path("workspaces.json");
        std::fs::write(&legacy_path, legacy).unwrap();

        import_legacy_workspaces_from(&db, &legacy_path).unwrap();
        let rows = list(&db);
        // Ungrouped first, then grouped, then new-app-only rows; the
        // worktree child is skipped.
        assert_eq!(
            rows,
            vec![
                (
                    "legacy-ungrouped".to_string(),
                    "/ws/ungrouped".to_string(),
                    Some(0)
                ),
                (
                    "new-id-shared".to_string(),
                    "/ws/shared".to_string(),
                    Some(1)
                ),
                ("new-id-extra".to_string(), "/ws/extra".to_string(), Some(2)),
            ]
        );

        // Second run is a no-op: a removal in the new app is not resurrected.
        {
            let conn = db.0.lock();
            conn.execute("DELETE FROM workspaces WHERE id='legacy-ungrouped'", [])
                .unwrap();
        }
        import_legacy_workspaces_from(&db, &legacy_path).unwrap();
        assert_eq!(list(&db).len(), 2);
    }

    #[test]
    fn legacy_import_without_legacy_file_only_sets_flag() {
        let scratch = Scratch::new();
        let db = Db::open_at(&scratch.path("app.db")).unwrap();
        import_legacy_workspaces_from(&db, &scratch.path("missing.json")).unwrap();
        assert!(list(&db).is_empty());
        let conn = db.0.lock();
        let flag: String = conn
            .query_row(
                "SELECT value FROM meta WHERE key='legacy_workspaces_import_v1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(flag, "1");
    }
    #[test]
    fn plugin_kv_roundtrip_and_wipe() {
        let scratch = Scratch::new();
        let db = Db::open_at(&scratch.path("app.db")).unwrap();
        assert_eq!(db.plugin_kv_get("p1", "k").unwrap(), None);

        db.plugin_kv_set("p1", "k", &serde_json::json!({"n": 1})).unwrap();
        db.plugin_kv_set("p1", "other", &serde_json::json!("s")).unwrap();
        db.plugin_kv_set("p2", "k", &serde_json::json!(true)).unwrap();
        // Same key under another plugin is an independent row; overwrite wins.
        db.plugin_kv_set("p1", "k", &serde_json::json!({"n": 2})).unwrap();
        assert_eq!(
            db.plugin_kv_get("p1", "k").unwrap(),
            Some(serde_json::json!({"n": 2}))
        );
        assert_eq!(
            db.plugin_kv_get("p2", "k").unwrap(),
            Some(serde_json::json!(true))
        );

        db.plugin_kv_delete("p1", "other").unwrap();
        assert_eq!(db.plugin_kv_get("p1", "other").unwrap(), None);

        db.plugin_kv_delete_all("p1").unwrap();
        assert_eq!(db.plugin_kv_get("p1", "k").unwrap(), None);
        assert_eq!(
            db.plugin_kv_get("p2", "k").unwrap(),
            Some(serde_json::json!(true))
        );
    }
}
