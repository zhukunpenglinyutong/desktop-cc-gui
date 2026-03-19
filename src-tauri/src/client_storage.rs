use serde_json::Value;
use std::path::PathBuf;

const ALLOWED_STORES: &[&str] = &["layout", "composer", "threads", "app", "leida"];
const PANEL_LOCK_PASSWORD_FILENAME: &str = "pwd.txt";

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

fn read_store(filename: &str) -> Result<Value, String> {
    let path = client_storage_dir()?.join(filename);
    if !path.exists() {
        return Ok(Value::Null);
    }
    let data = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&data).map_err(|e| e.to_string())
}

fn write_store(filename: &str, value: &Value) -> Result<(), String> {
    let dir = client_storage_dir()?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(filename);
    let data = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    std::fs::write(&path, data).map_err(|e| e.to_string())
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
