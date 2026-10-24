use rusqlite::{types::ValueRef, Connection, OpenFlags, TransactionBehavior};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, HashSet};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

const MAX_BYTES: usize = 64 * 1024 * 1024;

/// A session-scoped native view. Removing existing message/part entries deletes
/// those native records; identities and ownership are not editable or insertable.
pub(super) fn read(path: &Path, session_id: &str) -> Result<String, String> {
    check_session_id(session_id)?;
    let value = match crate::history::split_opencode_db_path(path) {
        Some((db, address_id)) => {
            check_address(&db, &address_id, session_id)?;
            let mut conn = open_db(&db, false)?;
            let tx = conn.transaction().map_err(db_error)?;
            let view = db_view(&tx, session_id)?;
            tx.commit().map_err(db_error)?;
            view
        }
        None => tree_snapshot(path, session_id)?.view,
    };
    document_text(&value)
}

pub(super) fn write(path: &Path, session_id: &str, content: &str) -> Result<String, String> {
    check_session_id(session_id)?;
    if content.len() > MAX_BYTES {
        return Err("OpenCode editable document exceeds 64 MiB".into());
    }
    let view: Value = serde_json::from_str(content)
        .map_err(|e| format!("Invalid OpenCode editable JSON: {e}"))?;
    match crate::history::split_opencode_db_path(path) {
        Some((db, address_id)) => {
            check_address(&db, &address_id, session_id)?;
            write_db(&db, session_id, &view)
        }
        None => write_tree(path, session_id, &view),
    }
}

fn check_session_id(id: &str) -> Result<(), String> {
    if !id.starts_with("ses_") || !safe_id(id) {
        return Err("Invalid OpenCode session identity".into());
    }
    Ok(())
}

fn safe_id(id: &str) -> bool {
    !id.is_empty() && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

fn check_address(db: &Path, address_id: &str, session_id: &str) -> Result<(), String> {
    if address_id != session_id || db.file_name().and_then(|n| n.to_str()) != Some("opencode.db") {
        return Err("OpenCode database address does not match this session".into());
    }
    Ok(())
}

struct Budget(usize);
impl Budget {
    fn consume(&mut self, bytes: usize) -> Result<(), String> {
        self.0 = self.0.checked_add(bytes).filter(|n| *n <= MAX_BYTES)
            .ok_or_else(|| "OpenCode native session exceeds 64 MiB".to_string())?;
        Ok(())
    }
}

struct BoundedJson(Vec<u8>);
impl Write for BoundedJson {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if bytes.len() > MAX_BYTES - self.0.len() {
            return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "OpenCode editable document exceeds 64 MiB"));
        }
        self.0.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> { Ok(()) }
}

fn encode(value: &Value, pretty: bool) -> Result<Vec<u8>, String> {
    let mut output = BoundedJson(Vec::new());
    let result = if pretty {
        serde_json::to_writer_pretty(&mut output, value)
    } else {
        serde_json::to_writer(&mut output, value)
    };
    result.map_err(|e| format!("Cannot serialize complete OpenCode document: {e}"))?;
    Ok(output.0)
}

fn document_text(value: &Value) -> Result<String, String> {
    String::from_utf8(encode(value, true)?).map_err(|e| format!("OpenCode view is not UTF-8: {e}"))
}

fn object<'a>(value: &'a Value, label: &str) -> Result<&'a Map<String, Value>, String> {
    value.as_object().ok_or_else(|| format!("OpenCode {label} must be an object"))
}

fn array<'a>(value: &'a Value, label: &str) -> Result<&'a Vec<Value>, String> {
    value.as_array().ok_or_else(|| format!("OpenCode {label} must be an array"))
}

fn identity<'a>(value: &'a Value, field: &str) -> Result<&'a str, String> {
    value.get(field).and_then(Value::as_str).filter(|s| safe_id(s))
        .ok_or_else(|| format!("Invalid OpenCode {field} identity"))
}

fn same_fields(original: &Value, edited: &Value, fields: &[&str]) -> Result<(), String> {
    object(edited, "native record")?;
    for field in fields {
        if original.get(*field) != edited.get(*field) {
            return Err(format!("OpenCode {field} identity/ownership cannot be changed"));
        }
    }
    Ok(())
}

fn check_view(view: &Value, format: &str, session_id: &str) -> Result<(), String> {
    let fields = object(view, "document")?;
    if fields.len() != 4 || view.get("format").and_then(Value::as_str) != Some(format)
        || view.get("sessionId").and_then(Value::as_str) != Some(session_id)
        || !fields.contains_key("session") || !fields.contains_key("messages") {
        return Err("OpenCode document format or session identity changed".into());
    }
    array(&view["messages"], "messages")?;
    Ok(())
}

fn index_records<'a>(records: &'a [Value], nested: bool) -> Result<BTreeMap<&'a str, &'a Value>, String> {
    let mut out = BTreeMap::new();
    for entry in records {
        let record = if nested {
            let fields = object(entry, "message entry")?;
            if fields.len() != 2 || !fields.contains_key("message") || !fields.contains_key("parts") {
                return Err("OpenCode message entry must contain message and parts".into());
            }
            array(&entry["parts"], "parts")?;
            &entry["message"]
        } else { entry };
        let id = identity(record, "id")?;
        if out.insert(id, entry).is_some() {
            return Err(format!("Duplicate OpenCode native record {id}"));
        }
    }
    Ok(out)
}

struct NativeFile {
    bytes: Vec<u8>,
}

struct TreeSnapshot {
    view: Value,
    storage: PathBuf,
    metadata: PathBuf,
    files: BTreeMap<PathBuf, NativeFile>,
}

/// Reject symlinks/junction escapes anywhere below the indexed storage root,
/// including directories which do not yet exist in an empty native session.
fn checked_path(root: &Path, path: &Path, file: bool) -> Result<bool, String> {
    let relative = path.strip_prefix(root).map_err(|_| "OpenCode path escapes native storage")?;
    let mut current = root.to_path_buf();
    for component in relative.components() {
        if !matches!(component, std::path::Component::Normal(_)) {
            return Err("OpenCode native path contains an unsafe component".into());
        }
        current.push(component.as_os_str());
        let meta = match std::fs::symlink_metadata(&current) {
            Ok(meta) => meta,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(e) => return Err(format!("Inspect OpenCode {}: {e}", current.display())),
        };
        if meta.file_type().is_symlink()
            || !std::fs::canonicalize(&current).map_err(|e| e.to_string())?.starts_with(root)
            || (current != path && !meta.is_dir()) {
            return Err("OpenCode native path crosses a link or invalid directory".into());
        }
        if current == path && (file && !meta.is_file() || !file && !meta.is_dir()) {
            return Err("OpenCode native path has an unexpected file type".into());
        }
    }
    Ok(true)
}

fn tree_file(root: &Path, path: &Path, budget: &mut Budget, files: &mut BTreeMap<PathBuf, NativeFile>) -> Result<Value, String> {
    if !checked_path(root, path, true)? {
        return Err(format!("OpenCode native file is missing: {}", path.display()));
    }
    let mut bytes = Vec::new();
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    if file.metadata().map_err(|e| e.to_string())?.len() > (MAX_BYTES - budget.0) as u64 {
        return Err("OpenCode native session exceeds 64 MiB".into());
    }
    file.take((MAX_BYTES - budget.0 + 1) as u64).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    budget.consume(bytes.len())?;
    let value: Value = serde_json::from_slice(&bytes)
        .map_err(|e| format!("Invalid OpenCode native JSON {}: {e}", path.display()))?;
    object(&value, "native record")?;
    files.insert(path.to_path_buf(), NativeFile { bytes });
    Ok(value)
}

fn source_matches(path: &Path, expected: &[u8]) -> Result<bool, String> {
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    if file.metadata().map_err(|e| e.to_string())?.len() != expected.len() as u64 { return Ok(false); }
    let mut buffer = [0u8; 8192];
    let mut offset = 0;
    loop {
        let count = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if count == 0 { return Ok(offset == expected.len()); }
        let Some(bytes) = expected.get(offset..offset + count) else { return Ok(false); };
        if bytes != &buffer[..count] { return Ok(false); }
        offset += count;
    }
}

fn json_paths(root: &Path, dir: &Path) -> Result<Vec<PathBuf>, String> {
    if !checked_path(root, dir, false)? { return Ok(Vec::new()); }
    let mut paths = Vec::new();
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().and_then(|s| s.to_str()) == Some("json") {
            paths.push(path);
        }
    }
    paths.sort();
    Ok(paths)
}

fn check_tree_record(value: &Value, path: &Path, session_id: &str, message_id: Option<&str>) -> Result<(), String> {
    if Some(identity(value, "id")?) != path.file_stem().and_then(|s| s.to_str())
        || value.get("sessionID").and_then(Value::as_str) != Some(session_id)
        || message_id.is_some_and(|id| value.get("messageID").and_then(Value::as_str) != Some(id)) {
        return Err("OpenCode native record does not match its filename/session ownership".into());
    }
    Ok(())
}

fn tree_snapshot(path: &Path, session_id: &str) -> Result<TreeSnapshot, String> {
    let project = path.parent().ok_or("Invalid OpenCode session path")?;
    let session_dir = project.parent().ok_or("Invalid OpenCode session path")?;
    let project_name = project.file_name().and_then(|s| s.to_str()).filter(|s| safe_id(s))
        .ok_or("Invalid OpenCode project directory")?;
    if session_dir.file_name().and_then(|s| s.to_str()) != Some("session")
        || path.extension().and_then(|s| s.to_str()) != Some("json")
        || path.file_stem().and_then(|s| s.to_str()) != Some(session_id) {
        return Err("OpenCode session path does not match the native storage layout".into());
    }
    let storage = std::fs::canonicalize(session_dir.parent().ok_or("Invalid OpenCode storage root")?)
        .map_err(|e| format!("OpenCode storage root is unavailable: {e}"))?;
    let metadata = storage.join("session").join(project_name).join(format!("{session_id}.json"));
    let mut files = BTreeMap::new();
    let mut budget = Budget(0);
    let session = tree_file(&storage, &metadata, &mut budget, &mut files)?;
    if identity(&session, "id")? != session_id
        || session.get("projectID").is_some_and(|id| id.as_str() != Some(project_name)) {
        return Err("OpenCode native session metadata has mismatched ownership".into());
    }
    let mut messages = Vec::new();
    for message_path in json_paths(&storage, &storage.join("message").join(session_id))? {
        let message = tree_file(&storage, &message_path, &mut budget, &mut files)?;
        check_tree_record(&message, &message_path, session_id, None)?;
        let message_id = identity(&message, "id")?;
        let mut parts = Vec::new();
        for part_path in json_paths(&storage, &storage.join("part").join(message_id))? {
            let part = tree_file(&storage, &part_path, &mut budget, &mut files)?;
            check_tree_record(&part, &part_path, session_id, Some(message_id))?;
            parts.push(part);
        }
        messages.push(json!({"message":message,"parts":parts}));
    }
    messages.sort_by(|a, b| {
        let created = |value: &Value| value["message"]["time"]["created"].as_i64().unwrap_or(i64::MAX);
        created(a).cmp(&created(b)).then_with(|| a["message"]["id"].as_str().cmp(&b["message"]["id"].as_str()))
    });
    Ok(TreeSnapshot { view: json!({"format":"opencode-tree","sessionId":session_id,"session":session,"messages":messages}), storage, metadata, files })
}

struct FileChange {
    path: PathBuf,
    original: Vec<u8>,
    replacement: Option<Vec<u8>>,
    backup: Option<PathBuf>,
}

fn write_tree(path: &Path, session_id: &str, edited: &Value) -> Result<String, String> {
    check_view(edited, "opencode-tree", session_id)?;
    let snapshot = tree_snapshot(path, session_id)?;
    same_fields(&snapshot.view["session"], &edited["session"], &["id", "projectID", "directory", "parentID"])?;
    let original_messages = index_records(array(&snapshot.view["messages"], "messages")?, true)?;
    let edited_messages = index_records(array(&edited["messages"], "messages")?, true)?;
    let mut replacements = BTreeMap::new();
    replacements.insert(snapshot.metadata.clone(), &edited["session"]);
    for (id, entry) in edited_messages {
        let original = original_messages.get(id).ok_or("Cannot insert or rename OpenCode messages")?;
        same_fields(&original["message"], &entry["message"], &["id", "sessionID", "messageID"])?;
        replacements.insert(snapshot.storage.join("message").join(session_id).join(format!("{id}.json")), &entry["message"]);
        let original_parts = index_records(array(&original["parts"], "parts")?, false)?;
        for (part_id, part) in index_records(array(&entry["parts"], "parts")?, false)? {
            let original_part = original_parts.get(part_id).ok_or("Cannot insert, rename or reparent OpenCode parts")?;
            same_fields(original_part, part, &["id", "sessionID", "messageID"])?;
            replacements.insert(snapshot.storage.join("part").join(id).join(format!("{part_id}.json")), part);
        }
    }
    let mut originals = BTreeMap::new();
    originals.insert(snapshot.metadata.clone(), &snapshot.view["session"]);
    for entry in array(&snapshot.view["messages"], "messages")? {
        let id = identity(&entry["message"], "id")?;
        originals.insert(snapshot.storage.join("message").join(session_id).join(format!("{id}.json")), &entry["message"]);
        for part in array(&entry["parts"], "parts")? {
            let part_id = identity(part, "id")?;
            originals.insert(snapshot.storage.join("part").join(id).join(format!("{part_id}.json")), part);
        }
    }
    let mut changes = Vec::new();
    let mut budget = Budget(0);
    for (path, native) in snapshot.files {
        let replacement = replacements.get(&path).copied();
        if replacement == originals.get(&path).copied() {
            budget.consume(native.bytes.len())?;
            continue;
        }
        let replacement = replacement.map(|value| encode(value, true)).transpose()?;
        if let Some(bytes) = &replacement { budget.consume(bytes.len())?; }
        changes.push(FileChange { path, original: native.bytes, replacement, backup: None });
    }
    // Validate the complete return document before any native file changes.
    let canonical = document_text(edited)?;
    // Validate every native source before the first mutation. Do not delete a
    // directory: unrelated/unknown files alongside native JSON remain intact.
    for change in &changes {
        if !checked_path(&snapshot.storage, &change.path, true)?
            || !source_matches(&change.path, &change.original)? {
            return Err("OpenCode native source changed while saving; reload before editing".into());
        }
    }
    let mut applied = 0;
    let result = (|| {
        for change in &mut changes {
            if !checked_path(&snapshot.storage, &change.path, true)?
                || !source_matches(&change.path, &change.original)? {
                return Err("OpenCode native source changed while saving; reload before editing".into());
            }
            if let Some(bytes) = &change.replacement {
                super::atomic_write_existing(&change.path, bytes)?;
            } else {
                let backup = change.path.with_file_name(format!(".ccgui-opencode-delete-{}", uuid::Uuid::new_v4()));
                std::fs::rename(&change.path, &backup).map_err(|e| format!("Stage OpenCode deletion: {e}"))?;
                change.backup = Some(backup);
            }
            applied += 1;
        }
        Ok::<(), String>(())
    })();
    if let Err(error) = result {
        let mut rollback_errors = Vec::new();
        for change in changes[..applied].iter().rev() {
            let rollback = match &change.backup {
                Some(backup) => std::fs::rename(backup, &change.path).map_err(|e| e.to_string()),
                None => super::atomic_write_existing(&change.path, &change.original),
            };
            if let Err(error) = rollback { rollback_errors.push(error); }
        }
        return Err(if rollback_errors.is_empty() { error } else {
            format!("{error}; OpenCode rollback failed: {}", rollback_errors.join("; "))
        });
    }
    for change in changes {
        if let Some(backup) = change.backup {
            let _ = std::fs::remove_file(backup);
        }
    }
    Ok(canonical)
}

fn db_error(error: rusqlite::Error) -> String { format!("OpenCode database: {error}") }

fn open_db(path: &Path, writable: bool) -> Result<Connection, String> {
    if !std::fs::metadata(path).map_err(|e| format!("OpenCode database is unavailable: {e}"))?.is_file() {
        return Err("OpenCode database is not a regular file".into());
    }
    let flags = if writable { OpenFlags::SQLITE_OPEN_READ_WRITE } else { OpenFlags::SQLITE_OPEN_READ_ONLY };
    let conn = Connection::open_with_flags(path, flags).map_err(db_error)?;
    conn.busy_timeout(std::time::Duration::from_secs(5)).map_err(db_error)?;
    if writable { conn.execute_batch("PRAGMA foreign_keys=ON;").map_err(db_error)?; }
    Ok(conn)
}

fn db_rows(conn: &Connection, query: &str, owner: &str, decode_data: bool, budget: &mut Budget) -> Result<Vec<Value>, String> {
    let mut stmt = conn.prepare(query).map_err(db_error)?;
    let columns: Vec<String> = stmt.column_names().into_iter().map(str::to_owned).collect();
    let mut rows = stmt.query([owner]).map_err(db_error)?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(db_error)? {
        let mut value = Map::new();
        for (index, column) in columns.iter().enumerate() {
            budget.consume(column.len() + 1)?;
            let field = match row.get_ref(index).map_err(db_error)? {
                ValueRef::Null => Value::Null,
                ValueRef::Integer(n) => { budget.consume(8)?; json!(n) }
                ValueRef::Real(n) => {
                    budget.consume(8)?;
                    Value::Number(serde_json::Number::from_f64(n).ok_or("OpenCode non-finite SQLite value cannot be edited losslessly")?)
                }
                ValueRef::Text(bytes) => {
                    budget.consume(bytes.len())?;
                    let text = std::str::from_utf8(bytes).map_err(|e| format!("OpenCode SQLite text is not UTF-8: {e}"))?;
                    if decode_data && column == "data" {
                        let data: Value = serde_json::from_str(text).map_err(|e| format!("OpenCode native data JSON is corrupt: {e}"))?;
                        object(&data, "data")?;
                        data
                    } else { Value::String(text.to_owned()) }
                }
                ValueRef::Blob(bytes) => { budget.consume(bytes.len())?; json!({"$sqliteBlob":bytes}) }
            };
            value.insert(column.clone(), field);
        }
        if decode_data && !value.get("data").is_some_and(Value::is_object) {
            return Err("OpenCode message/part data must be native JSON text".into());
        }
        out.push(Value::Object(value));
    }
    Ok(out)
}

fn check_db_data(row: &Value, session_id: &str, message_id: Option<&str>) -> Result<(), String> {
    let id = identity(row, "id")?;
    if row.get("session_id").is_some_and(|value| value.as_str() != Some(session_id))
        || message_id.is_some_and(|id| row.get("message_id").and_then(Value::as_str) != Some(id)) {
        return Err("OpenCode SQLite row has cross-session ownership".into());
    }
    let data = &row["data"];
    object(data, "data")?;
    for (field, expected) in [("id", Some(id)), ("sessionID", Some(session_id)), ("messageID", message_id)] {
        if data.get(field).is_some_and(|value| value.as_str() != expected) {
            return Err(format!("OpenCode data {field} does not match native row ownership"));
        }
    }
    Ok(())
}

fn db_view(conn: &Connection, session_id: &str) -> Result<Value, String> {
    let mut budget = Budget(0);
    let mut sessions = db_rows(conn, "SELECT * FROM session WHERE id=?1", session_id, false, &mut budget)?;
    if sessions.len() != 1 { return Err("OpenCode native session row is missing or not unique".into()); }
    let session = sessions.pop().unwrap();
    if identity(&session, "id")? != session_id { return Err("OpenCode session row identity mismatch".into()); }
    let native_messages = db_rows(conn, "SELECT * FROM message WHERE session_id=?1 ORDER BY time_created, id", session_id, true, &mut budget)?;
    let mut messages = Vec::new();
    let mut message_ids = HashSet::new();
    let mut part_ids = HashSet::new();
    for message in native_messages {
        check_db_data(&message, session_id, None)?;
        let id = identity(&message, "id")?;
        if !message_ids.insert(id.to_owned()) { return Err("OpenCode message identities are not unique".into()); }
        let parts = db_rows(conn, "SELECT * FROM part WHERE message_id=?1 ORDER BY time_created, id", id, true, &mut budget)?;
        for part in &parts {
            check_db_data(part, session_id, Some(id))?;
            if !part_ids.insert(identity(part, "id")?.to_owned()) { return Err("OpenCode part identities are not unique".into()); }
        }
        messages.push(json!({"message":message,"parts":parts}));
    }
    Ok(json!({"format":"opencode-sqlite","sessionId":session_id,"session":session,"messages":messages}))
}

fn check_db_edit(original: &Value, edited: &Value, editable: &[&str]) -> Result<(), String> {
    let original_fields = object(original, "native row")?;
    let edited_fields = object(edited, "native row")?;
    if original_fields.len() != edited_fields.len() || original_fields.keys().any(|key| !edited_fields.contains_key(key)) {
        return Err("OpenCode native SQLite columns cannot be added or removed".into());
    }
    for (column, value) in original_fields {
        if !editable.contains(&column.as_str()) && edited_fields.get(column) != Some(value) {
            return Err(format!("OpenCode native SQLite {column} is read-only; edit native data/title instead"));
        }
    }
    if editable.contains(&"data") {
        same_fields(&original["data"], &edited["data"], &["id", "sessionID", "messageID"])?;
    }
    Ok(())
}

fn update_data(conn: &Connection, table: &str, original: &Value, edited: &Value) -> Result<(), String> {
    if original["data"] == edited["data"] { return Ok(()); }
    let data = encode(&edited["data"], false)?;
    let text = std::str::from_utf8(&data).map_err(|e| e.to_string())?;
    let changed = conn.execute(&format!("UPDATE {table} SET data=?1 WHERE id=?2"), rusqlite::params![text, identity(original, "id")?]).map_err(db_error)?;
    if changed != 1 { return Err("OpenCode native row disappeared while saving".into()); }
    Ok(())
}

fn write_db(path: &Path, session_id: &str, edited: &Value) -> Result<String, String> {
    check_view(edited, "opencode-sqlite", session_id)?;
    let mut conn = open_db(path, true)?;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(db_error)?;
    let original = db_view(&tx, session_id)?;
    check_db_edit(&original["session"], &edited["session"], &["title"])?;
    let original_messages = index_records(array(&original["messages"], "messages")?, true)?;
    let edited_messages = index_records(array(&edited["messages"], "messages")?, true)?;
    for (id, entry) in &edited_messages {
        let native = original_messages.get(id).ok_or("Cannot insert or rename OpenCode SQLite messages")?;
        check_db_edit(&native["message"], &entry["message"], &["data"])?;
        check_db_data(&entry["message"], session_id, None)?;
        let original_parts = index_records(array(&native["parts"], "parts")?, false)?;
        for (part_id, part) in index_records(array(&entry["parts"], "parts")?, false)? {
            let native_part = original_parts.get(part_id).ok_or("Cannot insert, rename or reparent OpenCode SQLite parts")?;
            check_db_edit(native_part, part, &["data"])?;
            check_db_data(part, session_id, Some(id))?;
        }
    }
    if original["session"].get("title") != edited["session"].get("title") {
        let title = match edited["session"].get("title") {
            Some(Value::String(title)) => Some(title.as_str()),
            Some(Value::Null) => None,
            _ => return Err("OpenCode session title must be text or null".into()),
        };
        tx.execute("UPDATE session SET title=?1 WHERE id=?2", rusqlite::params![title, session_id]).map_err(db_error)?;
    }
    for (id, native) in original_messages {
        match edited_messages.get(id) {
            None => {
                tx.execute("DELETE FROM part WHERE message_id=?1", [id]).map_err(db_error)?;
                tx.execute("DELETE FROM message WHERE id=?1 AND session_id=?2", rusqlite::params![id, session_id]).map_err(db_error)?;
            }
            Some(entry) => {
                update_data(&tx, "message", &native["message"], &entry["message"])?;
                let edited_parts = index_records(array(&entry["parts"], "parts")?, false)?;
                for (part_id, native_part) in index_records(array(&native["parts"], "parts")?, false)? {
                    if let Some(part) = edited_parts.get(part_id) {
                        update_data(&tx, "part", native_part, part)?;
                    } else {
                        tx.execute("DELETE FROM part WHERE id=?1 AND message_id=?2", rusqlite::params![part_id, id]).map_err(db_error)?;
                    }
                }
            }
        }
    }
    drop(original);
    // Include native triggers/columns in the snapshot while rollback remains
    // possible; serialization failures must never follow a successful commit.
    let canonical = document_text(&db_view(&tx, session_id)?)?;
    tx.commit().map_err(db_error)?;
    Ok(canonical)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    struct Scratch(PathBuf);
    impl Scratch {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("ccgui-opencode-edit-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Scratch {
        fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); }
    }

    fn tree_fixture(scratch: &Scratch) -> PathBuf {
        let storage = scratch.0.join("storage");
        for (name, value) in [
            ("session/proj/ses_one.json", json!({"id":"ses_one","projectID":"proj","directory":"/ws","title":"original","unknown":{"flag":true}})),
            ("message/ses_one/msg_one.json", json!({"id":"msg_one","sessionID":"ses_one","role":"user","unknown":17})),
            ("part/msg_one/prt_one.json", json!({"id":"prt_one","sessionID":"ses_one","messageID":"msg_one","type":"text","text":"before","unknown":{"nested":"keep"}})),
            ("part/msg_one/prt_two.json", json!({"id":"prt_two","sessionID":"ses_one","messageID":"msg_one","type":"text","text":"delete me"})),
            ("session/proj/ses_other.json", json!({"id":"ses_other","projectID":"proj","directory":"/ws"})),
            ("message/ses_other/msg_other.json", json!({"id":"msg_other","sessionID":"ses_other","role":"user"})),
            ("part/msg_other/prt_other.json", json!({"id":"prt_other","sessionID":"ses_other","messageID":"msg_other","type":"text","text":"unrelated"})),
        ] {
            let path = storage.join(name);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, value.to_string()).unwrap();
        }
        storage.join("session/proj/ses_one.json")
    }

    fn db_fixture(scratch: &Scratch) -> PathBuf {
        let path = scratch.0.join("opencode.db");
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.execute_batch("PRAGMA foreign_keys=ON;
            CREATE TABLE session(id TEXT PRIMARY KEY, directory TEXT NOT NULL, title TEXT, unknown BLOB);
            CREATE TABLE message(id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES session(id), time_created INTEGER, data TEXT NOT NULL, unknown TEXT);
            CREATE TABLE part(id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES message(id), session_id TEXT NOT NULL REFERENCES session(id), time_created INTEGER, data TEXT NOT NULL, unknown BLOB);
            INSERT INTO session VALUES('ses_one','/ws','original',X'0102'),('ses_other','/ws','other',X'0304');
            INSERT INTO message VALUES('msg_one','ses_one',1,'{\"role\":\"user\",\"unknown\":42}','keep'),('msg_other','ses_other',2,'{\"role\":\"user\"}','unrelated');
            INSERT INTO part VALUES('prt_one','msg_one','ses_one',1,'{\"type\":\"text\",\"text\":\"before\",\"unknown\":{\"key\":true}}',X'FF00'),('prt_two','msg_one','ses_one',2,'{\"type\":\"text\",\"text\":\"delete me\"}',X'01'),('prt_other','msg_other','ses_other',3,'{\"type\":\"text\",\"text\":\"unrelated\"}',X'02');").unwrap();
        crate::history::opencode_db_session_path(&path, "ses_one")
    }

    #[test]
    fn opencode_tree_text_roundtrip_preserves_unknown_and_other_session() {
        let scratch = Scratch::new();
        let path = tree_fixture(&scratch);
        let other = scratch.0.join("storage/part/msg_other/prt_other.json");
        let other_bytes = std::fs::read(&other).unwrap();
        let mut view: Value = serde_json::from_str(&read(&path, "ses_one").unwrap()).unwrap();
        view["messages"][0]["parts"][0]["text"] = json!("after 中文 🌟");
        write(&path, "ses_one", &view.to_string()).unwrap();
        let native: Value = serde_json::from_slice(&std::fs::read(scratch.0.join("storage/part/msg_one/prt_one.json")).unwrap()).unwrap();
        assert_eq!(native["text"], "after 中文 🌟");
        assert_eq!(native["unknown"]["nested"], "keep");
        assert_eq!(std::fs::read(other).unwrap(), other_bytes);
        let reread: Value = serde_json::from_str(&read(&path, "ses_one").unwrap()).unwrap();
        assert_eq!(reread["messages"][0]["parts"][0]["text"], native["text"]);
    }

    #[test]
    fn opencode_tree_deletes_native_parts_and_messages() {
        let scratch = Scratch::new();
        let path = tree_fixture(&scratch);
        let mut view: Value = serde_json::from_str(&read(&path, "ses_one").unwrap()).unwrap();
        view["messages"][0]["parts"].as_array_mut().unwrap().pop();
        write(&path, "ses_one", &view.to_string()).unwrap();
        assert!(!scratch.0.join("storage/part/msg_one/prt_two.json").exists());
        view["messages"] = json!([]);
        write(&path, "ses_one", &view.to_string()).unwrap();
        assert!(!scratch.0.join("storage/message/ses_one/msg_one.json").exists());
        assert!(!scratch.0.join("storage/part/msg_one/prt_one.json").exists());
        assert!(scratch.0.join("storage/part/msg_other/prt_other.json").exists());
    }

    #[test]
    fn opencode_tree_rejects_identity_and_path_escape_before_writes() {
        let scratch = Scratch::new();
        let path = tree_fixture(&scratch);
        let original = std::fs::read(&path).unwrap();
        let view: Value = serde_json::from_str(&read(&path, "ses_one").unwrap()).unwrap();
        for pointer in ["/sessionId", "/session/id", "/messages/0/message/sessionID", "/messages/0/parts/0/messageID", "/messages/0/parts/0/id"] {
            let mut changed = view.clone();
            *changed.pointer_mut(pointer).unwrap() = json!("../ses_other");
            assert!(write(&path, "ses_one", &changed.to_string()).is_err(), "{pointer}");
        }
        assert_eq!(std::fs::read(&path).unwrap(), original);
        assert!(read(&path, "ses_other").is_err());
    }

    #[test]
    fn opencode_sqlite_text_roundtrip_preserves_native_columns_and_other_session() {
        let scratch = Scratch::new();
        let path = db_fixture(&scratch);
        let mut view: Value = serde_json::from_str(&read(&path, "ses_one").unwrap()).unwrap();
        view["messages"][0]["parts"][0]["data"]["text"] = json!("after 中文 🌟");
        view["session"]["title"] = json!("edited title");
        write(&path, "ses_one", &view.to_string()).unwrap();
        let conn = rusqlite::Connection::open(scratch.0.join("opencode.db")).unwrap();
        let (data, blob): (String, Vec<u8>) = conn.query_row("SELECT data,unknown FROM part WHERE id='prt_one'", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        let native: Value = serde_json::from_str(&data).unwrap();
        assert_eq!(native["text"], "after 中文 🌟");
        assert_eq!(native["unknown"]["key"], true);
        assert_eq!(blob, vec![255, 0]);
        assert_eq!(conn.query_row("SELECT data FROM part WHERE id='prt_other'", [], |r| r.get::<_, String>(0)).unwrap(), "{\"type\":\"text\",\"text\":\"unrelated\"}");
        assert_eq!(conn.query_row("SELECT unknown FROM message WHERE id='msg_one'", [], |r| r.get::<_, String>(0)).unwrap(), "keep");
        assert_eq!(conn.query_row("SELECT title FROM session WHERE id='ses_one'", [], |r| r.get::<_, String>(0)).unwrap(), "edited title");
    }

    #[test]
    fn opencode_sqlite_deletes_actual_rows_and_rejects_reparenting() {
        let scratch = Scratch::new();
        let path = db_fixture(&scratch);
        let mut view: Value = serde_json::from_str(&read(&path, "ses_one").unwrap()).unwrap();
        view["messages"][0]["parts"][0]["message_id"] = json!("msg_other");
        assert!(write(&path, "ses_one", &view.to_string()).is_err());
        view["messages"][0]["parts"][0]["message_id"] = json!("msg_one");
        view["messages"][0]["parts"].as_array_mut().unwrap().pop();
        write(&path, "ses_one", &view.to_string()).unwrap();
        view["messages"] = json!([]);
        write(&path, "ses_one", &view.to_string()).unwrap();
        let conn = rusqlite::Connection::open(scratch.0.join("opencode.db")).unwrap();
        assert_eq!(conn.query_row("SELECT count(*) FROM part WHERE session_id='ses_one'", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
        assert_eq!(conn.query_row("SELECT count(*) FROM message WHERE session_id='ses_one'", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
        assert_eq!(conn.query_row("SELECT count(*) FROM part WHERE session_id='ses_other'", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
    }

    #[test]
    fn opencode_sqlite_invalid_later_part_rolls_back_all_edits() {
        let scratch = Scratch::new();
        let path = db_fixture(&scratch);
        let mut view: Value = serde_json::from_str(&read(&path, "ses_one").unwrap()).unwrap();
        view["messages"][0]["parts"][0]["data"]["text"] = json!("must not persist");
        view["messages"][0]["parts"][1]["session_id"] = json!("ses_other");
        assert!(write(&path, "ses_one", &view.to_string()).is_err());
        let conn = rusqlite::Connection::open(scratch.0.join("opencode.db")).unwrap();
        let raw: String = conn.query_row("SELECT data FROM part WHERE id='prt_one'", [], |r| r.get(0)).unwrap();
        assert_eq!(serde_json::from_str::<Value>(&raw).unwrap()["text"], "before");
    }

    #[test]
    fn opencode_sqlite_storage_error_rolls_back_prior_row_updates() {
        let scratch = Scratch::new();
        let path = db_fixture(&scratch);
        let conn = rusqlite::Connection::open(scratch.0.join("opencode.db")).unwrap();
        conn.execute_batch("CREATE TRIGGER reject_second_part BEFORE UPDATE ON part WHEN NEW.id='prt_two' BEGIN SELECT RAISE(ABORT,'isolated native write failure'); END;").unwrap();
        let mut view: Value = serde_json::from_str(&read(&path, "ses_one").unwrap()).unwrap();
        view["session"]["title"] = json!("must roll back");
        view["messages"][0]["parts"][0]["data"]["text"] = json!("must roll back");
        view["messages"][0]["parts"][1]["data"]["text"] = json!("trigger failure");
        assert!(write(&path, "ses_one", &view.to_string()).is_err());
        let raw: String = conn.query_row("SELECT data FROM part WHERE id='prt_one'", [], |r| r.get(0)).unwrap();
        assert_eq!(serde_json::from_str::<Value>(&raw).unwrap()["text"], "before");
        assert_eq!(conn.query_row("SELECT title FROM session WHERE id='ses_one'", [], |r| r.get::<_, String>(0)).unwrap(), "original");
    }

    #[test]
    fn opencode_native_views_roundtrip_more_than_one_mebibyte() {
        let scratch = Scratch::new();
        let tree = tree_fixture(&scratch);
        let database = db_fixture(&scratch);
        let text = "完整 transcript 🌟\n".repeat(80_000);
        assert!(text.len() > 1024 * 1024);
        for (path, pointer) in [(&tree, "/messages/0/parts/0/text"), (&database, "/messages/0/parts/0/data/text")] {
            let mut view: Value = serde_json::from_str(&read(path, "ses_one").unwrap()).unwrap();
            *view.pointer_mut(pointer).unwrap() = json!(text);
            write(path, "ses_one", &view.to_string()).unwrap();
            let document = read(path, "ses_one").unwrap();
            assert!(document.len() > 1024 * 1024);
            let actual: Value = serde_json::from_str(&document).unwrap();
            assert_eq!(actual.pointer(pointer).and_then(Value::as_str), Some(text.as_str()));
        }
    }

    #[test]
    fn opencode_sqlite_part_without_session_column_edits_and_deletes() {
        let scratch = Scratch::new();
        let path = db_fixture(&scratch);
        let conn = rusqlite::Connection::open(scratch.0.join("opencode.db")).unwrap();
        conn.execute_batch("ALTER TABLE part DROP COLUMN session_id;").unwrap();
        let mut view: Value = serde_json::from_str(&read(&path, "ses_one").unwrap()).unwrap();
        assert!(view["messages"][0]["parts"][0].get("session_id").is_none());
        view["messages"][0]["parts"][0]["data"]["text"] = json!("native compatibility");
        view["messages"][0]["parts"].as_array_mut().unwrap().pop();
        write(&path, "ses_one", &view.to_string()).unwrap();
        assert_eq!(conn.query_row("SELECT count(*) FROM part WHERE message_id='msg_one'", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
        let data: String = conn.query_row("SELECT data FROM part WHERE id='prt_one'", [], |r| r.get(0)).unwrap();
        assert_eq!(serde_json::from_str::<Value>(&data).unwrap()["text"], "native compatibility");
        assert_eq!(conn.query_row("SELECT count(*) FROM part WHERE message_id='msg_other'", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
    }

    #[test]
    fn opencode_tree_deletion_preserves_unknown_non_json_files() {
        let scratch = Scratch::new();
        let path = tree_fixture(&scratch);
        let extra = scratch.0.join("storage/part/msg_one/native-extra.bin");
        std::fs::write(&extra, [1u8, 2, 3]).unwrap();
        let mut view: Value = serde_json::from_str(&read(&path, "ses_one").unwrap()).unwrap();
        view["messages"] = json!([]);
        write(&path, "ses_one", &view.to_string()).unwrap();
        assert_eq!(std::fs::read(extra).unwrap(), vec![1, 2, 3]);
    }

    #[test]
    fn opencode_rejects_inserted_records_and_duplicate_native_identities() {
        let scratch = Scratch::new();
        let tree = tree_fixture(&scratch);
        let database = db_fixture(&scratch);
        for path in [&tree, &database] {
            let view: Value = serde_json::from_str(&read(path, "ses_one").unwrap()).unwrap();
            let mut duplicate = view.clone();
            let entry = duplicate["messages"][0].clone();
            duplicate["messages"].as_array_mut().unwrap().push(entry);
            assert!(write(path, "ses_one", &duplicate.to_string()).is_err());
            let mut inserted = view.clone();
            inserted["messages"][0]["message"]["id"] = json!("msg_new");
            assert!(write(path, "ses_one", &inserted.to_string()).is_err());
            let mut duplicate = view.clone();
            let part = duplicate["messages"][0]["parts"][0].clone();
            duplicate["messages"][0]["parts"].as_array_mut().unwrap().push(part);
            assert!(write(path, "ses_one", &duplicate.to_string()).is_err());
        }
    }

    #[test]
    fn opencode_rejects_missing_corrupt_and_oversized_documents() {
        let scratch = Scratch::new();
        let path = tree_fixture(&scratch);
        assert!(read(&scratch.0.join("missing.json"), "ses_one").is_err());
        assert!(write(&path, "ses_one", &" ".repeat(MAX_BYTES + 1)).is_err());
        std::fs::write(scratch.0.join("storage/part/msg_one/prt_one.json"), "not json").unwrap();
        assert!(read(&path, "ses_one").is_err());
        let missing = crate::history::opencode_db_session_path(&scratch.0.join("missing/opencode.db"), "ses_one");
        assert!(read(&missing, "ses_one").is_err());
        assert!(!scratch.0.join("missing/opencode.db").exists());
    }

    #[test]
    fn opencode_sqlite_consecutive_saves_use_committed_native_columns() {
        let scratch = Scratch::new();
        let path = db_fixture(&scratch);
        let conn = rusqlite::Connection::open(scratch.0.join("opencode.db")).unwrap();
        conn.execute_batch("CREATE TRIGGER native_part_timestamp AFTER UPDATE OF data ON part BEGIN UPDATE part SET time_created=time_created+1 WHERE id=NEW.id; END;").unwrap();
        let mut first: Value = serde_json::from_str(&read(&path, "ses_one").unwrap()).unwrap();
        first["messages"][0]["parts"][0]["data"]["text"] = json!("first native edit");
        let canonical = write(&path, "ses_one", &first.to_string()).unwrap();
        let mut second: Value = serde_json::from_str(&canonical).unwrap();
        assert_eq!(second["messages"][0]["parts"].as_array().unwrap().iter().find(|part| part["id"] == "prt_one").unwrap()["time_created"], 2);
        second["messages"][0]["parts"].as_array_mut().unwrap().iter_mut().find(|part| part["id"] == "prt_one").unwrap()["data"]["text"] = json!("second native edit");
        let canonical = write(&path, "ses_one", &second.to_string()).unwrap();
        let saved: Value = serde_json::from_str(&canonical).unwrap();
        assert_eq!(saved["messages"][0]["parts"].as_array().unwrap().iter().find(|part| part["id"] == "prt_one").unwrap()["time_created"], 3);
        let data: String = conn.query_row("SELECT data FROM part WHERE id='prt_one'", [], |row| row.get(0)).unwrap();
        assert_eq!(serde_json::from_str::<Value>(&data).unwrap()["text"], "second native edit");
        assert_eq!(conn.query_row("SELECT data FROM part WHERE id='prt_other'", [], |row| row.get::<_, String>(0)).unwrap(), "{\"type\":\"text\",\"text\":\"unrelated\"}");
    }

    #[cfg(unix)]
    #[test]
    fn opencode_tree_rejects_symlinked_native_parts() {
        let scratch = Scratch::new();
        let path = tree_fixture(&scratch);
        let target = scratch.0.join("outside.json");
        std::fs::write(&target, "{\"text\":\"outside\"}").unwrap();
        let part = scratch.0.join("storage/part/msg_one/prt_one.json");
        std::fs::remove_file(&part).unwrap();
        std::os::unix::fs::symlink(&target, &part).unwrap();
        assert!(read(&path, "ses_one").is_err());
        assert_eq!(std::fs::read_to_string(target).unwrap(), "{\"text\":\"outside\"}");
    }
}
