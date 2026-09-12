use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::Path;

/// Codex app task names are stored separately from rollout messages. The
/// append-only index can contain multiple names for an ID; the last one wins.
fn read_names(path: &Path) -> HashMap<String, String> {
    let Ok(file) = std::fs::File::open(path) else {
        return HashMap::new();
    };
    let mut names = HashMap::new();
    for line in BufReader::new(file).lines() {
        let Ok(line) = line else { break };
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        let Some(id) = value.get("id").and_then(|v| v.as_str()) else {
            continue;
        };
        let Some(name) = value.get("thread_name").and_then(|v| v.as_str()) else {
            continue;
        };
        if !id.is_empty() && !name.trim().is_empty() {
            names.insert(id.to_owned(), name.trim().to_owned());
        }
    }
    names
}

/// Run even when rollout stat signatures match: renaming a task does not
/// modify its rollout. Update the derived title, leaving local custom titles
/// and message timestamps intact.
pub(super) fn sync(db: &crate::db::Db) -> Result<bool, String> {
    let home = crate::engine::codex_home();
    sync_from(db, &home.join("session_index.jsonl"))
}

fn sync_from(db: &crate::db::Db, path: &Path) -> Result<bool, String> {
    let names = read_names(path);
    if names.is_empty() {
        return Ok(false);
    }
    let mut conn = db.0.lock();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let updates: Vec<(String, String)> = {
        let mut stmt = tx
            .prepare("SELECT session_id, title FROM sessions WHERE engine='codex'")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?;
        let mut updates = Vec::new();
        for row in rows {
            let (id, title) = row.map_err(|e| e.to_string())?;
            if let Some(name) = names.get(&id).filter(|name| **name != title) {
                updates.push((id, name.clone()));
            }
        }
        updates
    };
    for (id, name) in &updates {
        tx.execute(
            "UPDATE sessions SET title=?1 WHERE engine='codex' AND session_id=?2",
            rusqlite::params![name, id],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(!updates.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sync_names_and_renames_preserving_fallback_and_custom_titles() -> Result<(), String> {
        let dir = std::env::temp_dir().join(format!("ccgui-codex-names-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let db = crate::db::Db::open_at(&dir.join("app.db")).map_err(|e| e.to_string())?;
        let index = dir.join("session_index.jsonl");
        {
            let conn = db.0.lock();
            for (engine, id) in [("codex", "a"), ("codex", "b"), ("omp", "a")] {
                conn.execute(
                    "INSERT INTO sessions(engine, session_id, workspace_path, file_path, file_size, file_mtime_ms, title, custom_title, updated_at) VALUES(?1, ?2, '/ws', ?3, 10, 20, 'first message', 'local name', 30)",
                    rusqlite::params![engine, id, format!("{engine}-{id}")],
                ).map_err(|e| e.to_string())?;
            }
        }
        assert!(!sync_from(&db, &index)?);
        std::fs::write(
            &index,
            concat!(
                "{\"id\":\"a\",\"thread_name\":\"Old name\"}\n",
                "{\"id\":\"a\",\"thread_name\":\"查看飞书 Bug 7070571790\"}\n",
                "{\"id\":\"b\",\"thread_name\":\" \"}\n",
                "{invalid trailing record\n"
            ),
        )
        .unwrap();
        assert!(sync_from(&db, &index)?);
        assert!(!sync_from(&db, &index)?);
        {
            let conn = db.0.lock();
            let row: (String, String, i64) = conn.query_row(
                "SELECT title, custom_title, updated_at FROM sessions WHERE engine='codex' AND session_id='a'",
                [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            ).unwrap();
            assert_eq!(
                row,
                ("查看飞书 Bug 7070571790".into(), "local name".into(), 30)
            );
            let fallback: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sessions WHERE title='first message'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(fallback, 2);
        }
        // Only the external title index changes; no rollout needs reparsing.
        std::fs::write(&index, "{\"id\":\"a\",\"thread_name\":\"Renamed\"}\n").unwrap();
        assert!(sync_from(&db, &index)?);
        let title: String =
            db.0.lock()
                .query_row(
                    "SELECT title FROM sessions WHERE engine='codex' AND session_id='a'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
        assert_eq!(title, "Renamed");
        drop(db);
        std::fs::remove_dir_all(dir).unwrap();
        Ok(())
    }
}
