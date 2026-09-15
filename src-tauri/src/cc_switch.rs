//! Read-only interop with cc-switch (~/.cc-switch).
//!
//! Sources (probed in this order, never written):
//!   1. `~/.cc-switch/cc-switch.db`  (cc-switch v3, SQLite `providers` table)
//!   2. `~/.cc-switch/config.json`   (cc-switch v2, legacy JSON)
//! plus user-picked files via `import_cc_switch_from_path` (`.json` → legacy
//! parse, anything else → SQLite).
//!
//! Pull model: the frontend polls `check_cc_switch` on the settings page; when
//! the source file's fingerprint (mtime + length) differs from both the last-imported and the
//! user-dismissed hash, it offers a sync banner. `import_cc_switch` copies
//! providers into our own config, tagged `source: "cc-switch"` so later syncs
//! may update/prune them while never touching manually created channels.

use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};

use crate::config::{self, ConfigStore};
use crate::paths;

/// Our engine id -> cc-switch app key (legacy json `apps` key / db
/// `app_type`). Engines cc-switch doesn't manage (kimi/pi/omp/dsh) have no
/// mapping and are skipped on import.
fn ccs_app_key(engine: &str) -> Option<&'static str> {
    match engine {
        "claude" => Some("claude"),
        "codex" => Some("codex"),
        "grok" => Some("grokbuild"),
        _ => None,
    }
}

const IMPORT_ENGINES: [&str; 3] = ["claude", "codex", "grok"];

fn ccs_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".cc-switch")
}

fn ccs_db_path() -> PathBuf {
    ccs_dir().join("cc-switch.db")
}

fn ccs_config_path() -> PathBuf {
    ccs_dir().join("config.json")
}

/// The file cc-switch currently writes: the v3 db wins over the legacy json.
fn ccs_source_path() -> Option<PathBuf> {
    let db = ccs_db_path();
    if db.is_file() {
        return Some(db);
    }
    let json = ccs_config_path();
    json.is_file().then_some(json)
}

fn is_json_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("json"))
        .unwrap_or(false)
}

/// Sync bookkeeping lives in its own file so AppSettings stays untouched.
fn sync_state_path() -> PathBuf {
    paths::app_home().join("cc-switch-sync.json")
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncState {
    /// Fingerprint of the cc-switch source file we last imported.
    #[serde(default)]
    seen_hash: String,
    /// Fingerprint the user dismissed with "稍后"; don't nag until it changes again.
    #[serde(default)]
    dismissed_hash: String,
}

/// Cheap change token: mtime + length. cc-switch mutates its store through
/// SQLite writes, so any real change bumps mtime; content-hashing the whole
/// file meant reading tens of MB on every settings-page mount (and, as a
/// sync command, on Tauri's main thread — that was the visible freeze).
fn fingerprint(path: &Path) -> Option<(String, u64)> {
    let meta = std::fs::metadata(path).ok()?;
    let mtime_ms = meta
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()?
        .as_millis() as u64;
    Some((format!("{mtime_ms}:{}", meta.len()), mtime_ms))
}

fn read_sync_state() -> SyncState {
    std::fs::read_to_string(sync_state_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_sync_state(state: &SyncState) -> Result<(), String> {
    let content = serde_json::to_string(state).map_err(|e| e.to_string())?;
    crate::settings::atomic_write(&sync_state_path(), &content)
}

/// One cc-switch provider, normalized to the legacy JSON entry shape
/// (`{ name, settingsConfig, icon?, iconColor? }`) so `convert_provider`
/// handles both sources unchanged.
type CcsProviders = Vec<(String, Value)>;

/// Per-engine provider lists keyed by our engine id. `None` = cc-switch
/// never managed that app (import skips it, no pruning); `Some([])` = the
/// app exists but has no providers (import may prune).
type EngineProviders = Vec<(String, Option<CcsProviders>)>;

/// Legacy v2 JSON: `apps.<app>.providers` as a map (id → entry) or an array
/// (entries carry their own `id`).
fn json_engine_providers(root: &Value, engine: &str) -> Option<CcsProviders> {
    let app_key = ccs_app_key(engine)?;
    let section = root["apps"].get(app_key)?;
    let list = match &section["providers"] {
        Value::Object(map) => map.iter().map(|(id, p)| (id.clone(), p.clone())).collect(),
        Value::Array(items) => items
            .iter()
            .filter_map(|p| {
                let id = p.get("id")?.as_str()?.to_string();
                Some((id, p.clone()))
            })
            .collect(),
        _ => Vec::new(),
    };
    Some(list)
}

/// v3 SQLite: `providers` table filtered by `app_type`. A corrupt
/// `settings_config` row degrades to an empty object instead of failing the
/// whole batch.
fn db_engine_providers(conn: &Connection, engine: &str) -> Result<Option<CcsProviders>, String> {
    let Some(app_key) = ccs_app_key(engine) else {
        return Ok(None);
    };
    let mut stmt = conn
        .prepare(
            "SELECT id, name, settings_config FROM providers \
             WHERE app_type = ?1 ORDER BY sort_index, created_at",
        )
        .map_err(|e| format!("prepare cc-switch db query: {e}"))?;
    let rows = stmt
        .query_map([app_key], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| format!("query cc-switch db: {e}"))?;
    let mut out = Vec::new();
    for row in rows {
        let (id, name, settings_text) = row.map_err(|e| format!("read cc-switch db row: {e}"))?;
        let settings_config = serde_json::from_str(&settings_text)
            .unwrap_or_else(|_| Value::Object(Default::default()));
        out.push((
            id,
            serde_json::json!({ "name": name, "settingsConfig": settings_config }),
        ));
    }
    Ok(Some(out))
}

fn load_from_json(path: &Path, engines: &[&str]) -> Result<EngineProviders, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("read cc-switch config: {e}"))?;
    let root: Value =
        serde_json::from_slice(&bytes).map_err(|e| format!("parse cc-switch config: {e}"))?;
    Ok(engines
        .iter()
        .map(|e| (e.to_string(), json_engine_providers(&root, e)))
        .collect())
}

fn load_from_db(path: &Path, engines: &[&str]) -> Result<EngineProviders, String> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("open cc-switch db: {e}"))?;
    engines
        .iter()
        .map(|e| Ok((e.to_string(), db_engine_providers(&conn, e)?)))
        .collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CcSwitchStatus {
    pub installed: bool,
    pub changed: bool,
    /// Total providers across the engines we can import.
    pub providers: usize,
    pub hash: String,
    pub modified_ms: u64,
}

fn count_db_providers(conn: &Connection) -> usize {
    IMPORT_ENGINES
        .iter()
        .filter_map(|e| ccs_app_key(e))
        .map(|key| {
            conn.query_row(
                "SELECT COUNT(*) FROM providers WHERE app_type = ?1",
                [key],
                |row| row.get::<_, i64>(0),
            )
            .unwrap_or(0) as usize
        })
        .sum()
}

fn count_json_providers(root: &Value) -> usize {
    IMPORT_ENGINES
        .iter()
        .filter_map(|e| ccs_app_key(e))
        .map(|key| {
            let providers = &root["apps"][key]["providers"];
            match providers {
                Value::Object(map) => map.len(),
                Value::Array(items) => items.len(),
                _ => 0,
            }
        })
        .sum()
}

#[tauri::command]
pub async fn check_cc_switch() -> Result<CcSwitchStatus, String> {
    // spawn_blocking: this poll runs on every settings-page mount, and sync
    // commands execute on Tauri's main thread — even the stat/count below
    // must not stall IPC delivery there.
    tauri::async_runtime::spawn_blocking(check_cc_switch_blocking)
        .await
        .map_err(|e| e.to_string())?
}

fn check_cc_switch_blocking() -> Result<CcSwitchStatus, String> {
    let empty = || CcSwitchStatus {
        installed: false,
        changed: false,
        providers: 0,
        hash: String::new(),
        modified_ms: 0,
    };
    let Some(path) = ccs_source_path() else {
        return Ok(empty());
    };
    let Some((hash, modified_ms)) = fingerprint(&path) else {
        return Ok(empty());
    };
    let state = read_sync_state();
    let changed = hash != state.seen_hash && hash != state.dismissed_hash;
    // Counting opens the db — only worth the io when the sync banner can
    // actually show.
    let providers = if !changed {
        0
    } else if is_json_file(&path) {
        std::fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
            .map(|root| count_json_providers(&root))
            .unwrap_or(0)
    } else {
        Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map(|conn| count_db_providers(&conn))
            .unwrap_or(0)
    };
    Ok(CcSwitchStatus {
        installed: true,
        changed,
        providers,
        hash,
        modified_ms,
    })
}

#[tauri::command]
pub fn dismiss_cc_switch(hash: String) -> Result<(), String> {
    let mut state = read_sync_state();
    state.dismissed_hash = hash;
    write_sync_state(&state)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CcSwitchImportResult {
    pub added: usize,
    pub updated: usize,
    /// Id collides with a manually created channel — left untouched.
    pub skipped: usize,
    /// cc-switch-sourced channels that disappeared upstream.
    pub removed: usize,
}

fn env_str(env: &Value, key: &str) -> Option<String> {
    env.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// Convert one cc-switch provider into our channel value. Keeps the original
/// `settingsConfig` verbatim: provider_files merges its raw `env` /
/// `config` first when materializing the CLI's native config, so extra keys
/// (e.g. ANTHROPIC_SMALL_FAST_MODEL) survive the import.
fn convert_provider(engine: &str, id: &str, p: &Value) -> Value {
    let mut out = serde_json::Map::new();
    let name = p["name"].as_str().unwrap_or(id);
    out.insert("name".into(), Value::String(name.to_string()));
    if let Some(sc) = p.get("settingsConfig") {
        out.insert("settingsConfig".into(), sc.clone());
    }
    if let Some(icon) = p.get("icon").and_then(Value::as_str) {
        out.insert("icon".into(), Value::String(icon.to_string()));
    }
    if let Some(color) = p.get("iconColor").and_then(Value::as_str) {
        out.insert("iconColor".into(), Value::String(color.to_string()));
    }

    let sc = &p["settingsConfig"];
    match engine {
        // Claude/Grok: convention fields live in settingsConfig.env.
        "claude" | "grok" => {
            let env = &sc["env"];
            let (base, key, model) = if engine == "claude" {
                (
                    "ANTHROPIC_BASE_URL",
                    "ANTHROPIC_AUTH_TOKEN",
                    "ANTHROPIC_MODEL",
                )
            } else {
                ("GROK_BASE_URL", "GROK_API_KEY", "GROK_MODEL")
            };
            if let Some(v) = env_str(env, base) {
                out.insert("baseUrl".into(), Value::String(v));
            }
            if let Some(v) = env_str(env, key) {
                out.insert("apiKey".into(), Value::String(v));
            }
            if let Some(v) = env_str(env, model) {
                out.insert("model".into(), Value::String(v));
            }
        }
        // Codex: { auth: { OPENAI_API_KEY }, config: <config.toml text> }.
        "codex" => {
            if let Some(v) = env_str(&sc["auth"], "OPENAI_API_KEY") {
                out.insert("apiKey".into(), Value::String(v));
            }
            if let Some(toml_text) = sc["config"].as_str() {
                if let Ok(tbl) = toml::from_str::<Value>(toml_text) {
                    if let Some(m) = tbl["model"].as_str() {
                        out.insert("model".into(), Value::String(m.to_string()));
                    }
                    // First model_providers.*.base_url wins.
                    if let Some(providers) = tbl["model_providers"].as_object() {
                        for mp in providers.values() {
                            if let Some(u) = mp["base_url"].as_str() {
                                out.insert("baseUrl".into(), Value::String(u.to_string()));
                                break;
                            }
                        }
                    }
                }
            }
        }
        _ => {}
    }

    out.insert("source".into(), Value::String("cc-switch".into()));
    out.insert("ccsId".into(), Value::String(id.to_string()));
    Value::Object(out)
}

/// Merge one engine's cc-switch providers into our config. `prune` removes
/// cc-switch-sourced channels that disappeared upstream — only safe when the
/// source is cc-switch's own authoritative store, never for a user-picked
/// file (it may be a partial export).
fn merge_engine(
    engine: &str,
    providers: &CcsProviders,
    prune: bool,
    result: &mut CcSwitchImportResult,
) -> Result<(), String> {
    config::mutate_section_unlocked(engine, |section| {
        for (id, p) in providers {
            let converted = convert_provider(engine, id, p);
            match section.providers.get(id) {
                None => {
                    section.providers.insert(id.clone(), converted);
                    result.added += 1;
                }
                Some(existing)
                    if existing.get("source").and_then(Value::as_str) == Some("cc-switch") =>
                {
                    section.providers.insert(id.clone(), converted);
                    result.updated += 1;
                }
                Some(_) => result.skipped += 1,
            }
        }
        if prune {
            let stale: Vec<String> = section
                .providers
                .iter()
                .filter(|(id, v)| {
                    v.get("source").and_then(Value::as_str) == Some("cc-switch")
                        && !providers.iter().any(|(pid, _)| pid == *id)
                })
                .map(|(id, _)| id.clone())
                .collect();
            for id in stale {
                section.providers.remove(&id);
                if section.current.as_deref() == Some(id.as_str()) {
                    section.current = None;
                }
                result.removed += 1;
            }
        }
        Ok(())
    })
}

fn import_engines(engine: &str) -> Vec<&str> {
    if engine == "all" {
        IMPORT_ENGINES.to_vec()
    } else {
        vec![engine]
    }
}

fn run_import(
    store: &ConfigStore,
    load: impl FnOnce() -> Result<EngineProviders, String>,
    prune: bool,
) -> Result<CcSwitchImportResult, String> {
    let _guard = store.0.lock().map_err(|e| e.to_string())?;
    let loaded = load()?;
    let mut result = CcSwitchImportResult {
        added: 0,
        updated: 0,
        skipped: 0,
        removed: 0,
    };
    for (engine, providers) in &loaded {
        if let Some(list) = providers {
            merge_engine(engine, list, prune, &mut result)?;
        }
    }
    // Import only updates our in-app channel list. Spawn injects env; native
    // CLI files stay official.
    Ok(result)
}

/// Import cc-switch providers from the detected local source (v3 db first,
/// legacy json fallback). `engine` is one of our engine ids or "all".
#[tauri::command]
pub fn import_cc_switch(
    store: tauri::State<'_, ConfigStore>,
    engine: String,
) -> Result<CcSwitchImportResult, String> {
    let path = ccs_source_path().ok_or_else(|| {
        "cc-switch not found (~/.cc-switch/cc-switch.db or config.json)".to_string()
    })?;
    let engines = import_engines(&engine);
    let is_json = is_json_file(&path);
    let result = run_import(
        &store,
        || {
            if is_json {
                load_from_json(&path, &engines)
            } else {
                load_from_db(&path, &engines)
            }
        },
        true,
    )?;

    let mut state = read_sync_state();
    if let Some((fp, _)) = fingerprint(&path) {
        state.seen_hash = fp;
        write_sync_state(&state)?;
    }
    Ok(result)
}

/// Import from a user-picked file: `.json` parses as the legacy config,
/// anything else as the v3 SQLite db. Never prunes — a picked file may be a
/// partial export, so a missing row doesn't mean "deleted upstream".
#[tauri::command]
pub fn import_cc_switch_from_path(
    store: tauri::State<'_, ConfigStore>,
    path: String,
    engine: String,
) -> Result<CcSwitchImportResult, String> {
    let path = PathBuf::from(path);
    let engines = import_engines(&engine);
    let is_json = is_json_file(&path);
    run_import(
        &store,
        || {
            if is_json {
                load_from_json(&path, &engines)
            } else {
                load_from_db(&path, &engines)
            }
        },
        false,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_path(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("ccgui-ccs-test-{}-{}", std::process::id(), name));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn json_providers_accept_map_and_array_shapes() {
        let dir = temp_path("json");
        let path = dir.join("config.json");
        let json = r#"{
          "apps": {
            "claude": {
              "providers": {
                "p1": { "name": "Map Entry", "settingsConfig": { "env": { "ANTHROPIC_BASE_URL": "https://a.example" } } }
              }
            },
            "codex": {
              "providers": [
                { "id": "p2", "name": "Array Entry", "settingsConfig": { "auth": { "OPENAI_API_KEY": "sk-x" }, "config": "model = \"gpt-x\"\n[model_providers.foo]\nbase_url = \"https://b.example/v1\"" } }
              ]
            }
          }
        }"#;
        std::fs::write(&path, json).unwrap();

        let loaded = load_from_json(&path, &["claude", "codex", "grok"]).unwrap();
        assert_eq!(loaded.len(), 3);
        let claude = loaded[0].1.as_ref().unwrap();
        assert_eq!(claude.len(), 1);
        assert_eq!(claude[0].0, "p1");
        let codex = loaded[1].1.as_ref().unwrap();
        assert_eq!(codex.len(), 1);
        assert_eq!(codex[0].0, "p2");
        // grokbuild section absent → None (no import, no prune).
        assert!(loaded[2].1.is_none());

        // Flat fields extract through convert_provider for both shapes.
        let converted = convert_provider("claude", "p1", &claude[0].1);
        assert_eq!(converted["baseUrl"], "https://a.example");
        assert_eq!(converted["source"], "cc-switch");
        let converted = convert_provider("codex", "p2", &codex[0].1);
        assert_eq!(converted["apiKey"], "sk-x");
        assert_eq!(converted["baseUrl"], "https://b.example/v1");
        assert_eq!(converted["model"], "gpt-x");
    }

    #[test]
    fn db_providers_read_sqlite_and_normalize() {
        let dir = temp_path("db");
        let path = dir.join("cc-switch.db");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "CREATE TABLE providers (
               id TEXT, name TEXT, category TEXT, website_url TEXT,
               settings_config TEXT, app_type TEXT,
               sort_index INTEGER, created_at INTEGER
             );",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO providers VALUES ('d1', 'Db Entry', NULL, NULL, ?1, 'claude', 0, 0)",
            [r#"{"env": {"ANTHROPIC_BASE_URL": "https://c.example", "ANTHROPIC_AUTH_TOKEN": "sk-y"}}"#],
        )
        .unwrap();
        // A corrupt settings_config row degrades to an empty object.
        conn.execute(
            "INSERT INTO providers VALUES ('d2', 'Broken', NULL, NULL, 'not json', 'claude', 1, 1)",
            [],
        )
        .unwrap();
        drop(conn);

        let loaded = load_from_db(&path, &["claude"]).unwrap();
        let claude = loaded[0].1.as_ref().unwrap();
        assert_eq!(claude.len(), 2);
        assert_eq!(claude[0].0, "d1");
        let converted = convert_provider("claude", "d1", &claude[0].1);
        assert_eq!(converted["name"], "Db Entry");
        assert_eq!(converted["baseUrl"], "https://c.example");
        assert_eq!(converted["apiKey"], "sk-y");
        // Corrupt row still imports, with an empty settingsConfig.
        assert!(claude[1].1["settingsConfig"].is_object());
        // Unmapped engine → None.
        let loaded = load_from_db(&path, &["kimi"]).unwrap();
        assert!(loaded[0].1.is_none());
    }
}
