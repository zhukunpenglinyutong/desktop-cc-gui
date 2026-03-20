use serde_json::Value;
use std::io::Write;
use std::path::Path;
use std::path::PathBuf;
use std::thread;
use std::time::{Duration, Instant};
use uuid::Uuid;

const ALLOWED_STORES: &[&str] = &["layout", "composer", "threads", "app", "leida"];
const PANEL_LOCK_PASSWORD_FILENAME: &str = "pwd.txt";
const CLIENT_STORE_LOCK_WAIT_TIMEOUT: Duration = Duration::from_secs(5);
const CLIENT_STORE_LOCK_RETRY_INTERVAL: Duration = Duration::from_millis(25);
const CLIENT_STORE_LOCK_STALE_TIMEOUT: Duration = Duration::from_secs(30);

fn client_storage_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Unable to resolve home directory")?;
    Ok(home.join(".codemoss").join("client"))
}

fn validate_store_name(store: &str) -> Result<(), String> {
    if ALLOWED_STORES.contains(&store) {
        Ok(())
    } else {
        Err(format!("Invalid client store name: {store}"))
    }
}

struct ClientStoreFileLock {
    path: PathBuf,
}

impl Drop for ClientStoreFileLock {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

fn client_store_lock_file_path(path: &Path) -> PathBuf {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| format!("{value}.lock"))
        .unwrap_or_else(|| "lock".to_string());
    path.with_extension(extension)
}

fn is_client_store_lock_stale(lock_path: &Path) -> bool {
    let metadata = match std::fs::metadata(lock_path) {
        Ok(metadata) => metadata,
        Err(_) => return false,
    };
    let modified_at = match metadata.modified() {
        Ok(modified_at) => modified_at,
        Err(_) => return false,
    };
    match modified_at.elapsed() {
        Ok(elapsed) => elapsed > CLIENT_STORE_LOCK_STALE_TIMEOUT,
        Err(_) => false,
    }
}

fn acquire_client_store_lock(path: &Path) -> Result<ClientStoreFileLock, String> {
    let lock_path = client_store_lock_file_path(path);
    if let Some(parent) = lock_path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let deadline = Instant::now() + CLIENT_STORE_LOCK_WAIT_TIMEOUT;
    loop {
        match std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&lock_path)
        {
            Ok(mut file) => {
                let _ = writeln!(file, "pid={}", std::process::id());
                return Ok(ClientStoreFileLock { path: lock_path });
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                if is_client_store_lock_stale(&lock_path) {
                    let _ = std::fs::remove_file(&lock_path);
                    continue;
                }
                if Instant::now() >= deadline {
                    return Err(format!(
                        "Timed out waiting for client store lock: {}",
                        lock_path.display()
                    ));
                }
                thread::sleep(CLIENT_STORE_LOCK_RETRY_INTERVAL);
            }
            Err(error) => return Err(error.to_string()),
        }
    }
}

fn with_client_store_lock<T>(path: &Path, op: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    let _lock_guard = acquire_client_store_lock(path)?;
    op()
}

fn write_string_atomically(path: &Path, content: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let parent = path
        .parent()
        .ok_or_else(|| format!("Client store path has no parent: {}", path.display()))?;
    let filename = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| format!("Client store path has invalid filename: {}", path.display()))?;
    let temp_path = parent.join(format!(".{filename}.{}.tmp", Uuid::new_v4()));
    let mut temp_file = std::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temp_path)
        .map_err(|error| error.to_string())?;
    temp_file
        .write_all(content.as_bytes())
        .map_err(|error| error.to_string())?;
    temp_file.sync_all().map_err(|error| error.to_string())?;

    #[cfg(target_os = "windows")]
    if path.exists() {
        std::fs::remove_file(path).map_err(|error| error.to_string())?;
    }

    if let Err(error) = std::fs::rename(&temp_path, path) {
        let _ = std::fs::remove_file(&temp_path);
        return Err(error.to_string());
    }
    Ok(())
}

fn read_store_unlocked(path: &Path) -> Result<Value, String> {
    if !path.exists() {
        return Ok(Value::Null);
    }
    let data = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&data).map_err(|e| e.to_string())
}

fn read_store(filename: &str) -> Result<Value, String> {
    let path = client_storage_dir()?.join(filename);
    read_store_unlocked(&path)
}

fn write_store_unlocked(path: &Path, value: &Value) -> Result<(), String> {
    let data = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    write_string_atomically(path, &data)
}

fn write_store(filename: &str, value: &Value) -> Result<(), String> {
    let dir = client_storage_dir()?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(filename);
    with_client_store_lock(&path, || write_store_unlocked(&path, value))
}

fn patch_store(filename: &str, patch: &serde_json::Map<String, Value>) -> Result<(), String> {
    let dir = client_storage_dir()?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(filename);
    with_client_store_lock(&path, || {
        let existing = read_store_unlocked(&path)?;
        let mut merged = match existing {
            Value::Object(map) => map,
            Value::Null => serde_json::Map::new(),
            _ => serde_json::Map::new(),
        };
        for (key, value) in patch {
            merged.insert(key.to_string(), value.clone());
        }
        write_store_unlocked(&path, &Value::Object(merged))
    })
}

#[tauri::command]
pub(crate) fn client_panel_lock_password_read() -> Result<Option<String>, String> {
    let path = client_storage_dir()?.join(PANEL_LOCK_PASSWORD_FILENAME);
    if !path.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok(Some(content))
}

#[tauri::command]
pub(crate) fn client_panel_lock_password_write(password: String) -> Result<(), String> {
    let dir = client_storage_dir()?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(PANEL_LOCK_PASSWORD_FILENAME);
    std::fs::write(&path, password).map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn client_store_read(store: String) -> Result<Value, String> {
    validate_store_name(&store)?;
    read_store(&format!("{store}.json"))
}

#[tauri::command]
pub(crate) fn client_store_write(store: String, data: Value) -> Result<(), String> {
    validate_store_name(&store)?;
    write_store(&format!("{store}.json"), &data)
}

#[tauri::command]
pub(crate) fn client_store_patch(store: String, patch: Value) -> Result<(), String> {
    validate_store_name(&store)?;
    let patch_map = patch
        .as_object()
        .ok_or_else(|| "client_store_patch expects an object patch".to_string())?;
    patch_store(&format!("{store}.json"), patch_map)
}

#[cfg(test)]
mod tests {
    use super::{read_store, write_store};
    use serde_json::json;
    use uuid::Uuid;

    #[test]
    fn read_missing_file_returns_null() {
        let filename = format!("test-missing-{}.json", Uuid::new_v4());
        let result = read_store(&filename).expect("should not error");
        assert_eq!(result, serde_json::Value::Null);
    }

    #[test]
    fn write_then_read_roundtrip() {
        let dir = std::env::temp_dir().join(format!("mossx-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        let filename = "test-roundtrip.json";
        let path = dir.join(filename);

        let value = json!({
            "sidebarWidth": 300,
            "collapsed": true
        });

        let data = serde_json::to_string_pretty(&value).unwrap();
        std::fs::write(&path, &data).unwrap();

        let content = std::fs::read_to_string(&path).unwrap();
        let read_back: serde_json::Value = serde_json::from_str(&content).unwrap();
        assert_eq!(read_back, value);

        std::fs::remove_dir_all(&dir).ok();
    }
}
