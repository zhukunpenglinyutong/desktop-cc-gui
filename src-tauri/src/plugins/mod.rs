//! Phase-1 plugin host: local-path install/uninstall/enable/disable, plugin
//! file reads confined to the plugin directory, and per-plugin KV storage
//! (db.rs `plugin_kv`). State lives in `~/.ccgui-next/plugins.json`; the
//! plugins themselves in `~/.ccgui-next/plugins/<id>/`.
//!
//! Uninstall data policy (plan §9.1): `delete_data=false` keeps the KV rows
//! and records a tombstone; `plugin_list` purges rows whose tombstone is
//! older than KV_TOMBSTONE_TTL_SECS.
//!
//! Install is a staging/backup rename transaction (fs::install_from); a
//! crash mid-swap leaves at worst a stale `.staging-`/`.backup-` dir, and
//! the next install of the same id self-heals by renaming a stranded backup
//! back into place before proceeding.
//!
//! Layout: manifest.rs = manifest parse + permission whitelist; state.rs =
//! plugins.json records + state lock; fs.rs = source-tree walk, the install
//! transaction, and the manifest/record merge.

pub(crate) mod asset_protocol;
pub(crate) mod assets;
mod file_lock;
mod fs;
mod manifest;
pub mod market;
mod state;
pub(crate) mod storage;

pub use state::{KV_TOMBSTONE_TTL_SECS, PluginInfo, PluginRecord, PluginsState};
pub(crate) use state::{plugin_access, plugin_enabled_permissions};

use std::path::Path;
use std::sync::Arc;

/// Files a plugin may ask the host to read (plugin_read_file whitelist).
const READABLE_FILES: &[&str] = &["main.js", "styles.css", "manifest.json"];

#[tauri::command]
pub async fn plugin_list(db: tauri::State<'_, Arc<crate::db::Db>>) -> Result<Vec<PluginInfo>, String> {
    let db = Arc::clone(db.inner());
    tauri::async_runtime::spawn_blocking(move || {
        state::list_plugins(&db, &state::plugins_dir(), &state::state_path())
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn plugin_install_from_path(
    state: tauri::State<'_, crate::AppState>,
    path: String,
) -> Result<PluginInfo, String> {
    // spawn_blocking: sync commands execute on Tauri's main thread (see
    // cc_switch.rs), and the recursive copy below must not stall IPC there.
    let sink = Arc::clone(&state.sink);
    tauri::async_runtime::spawn_blocking(move || {
        fs::install_from(
            &state::plugins_dir(),
            &state::state_path(),
            Path::new(path.trim()),
            "local",
            |p| sink.emit_install_progress(p),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

fn uninstall_at(
    db: &crate::db::Db,
    plugins_dir: &Path,
    state_path: &Path,
    id: &str,
    delete_data: bool,
) -> Result<(), String> {
    uninstall_with_storage_at(db, plugins_dir, state_path, id, delete_data, None)
}

fn uninstall_with_storage_at(
    db: &crate::db::Db,
    plugins_dir: &Path,
    state_path: &Path,
    id: &str,
    delete_data: bool,
    storage_roots: Option<&storage::StorageRoots>,
) -> Result<(), String> {
    manifest::require_valid_id(id)?;
    let dir = plugins_dir.join(id);
    {
        // One locked read→mutate→write: the not-installed check, the record
        // removal, and the tombstone write-back must not interleave with a
        // concurrent install/enable of the same id.
        let _guard = state::lock_state(state_path)?;
        let mut state = state::read_state(state_path)?;
        if !dir.exists() && !state.plugins.contains_key(id) {
            return Err(format!("{id}: plugin not installed"));
        }
        let document_guard = if delete_data {
            let guard = storage::lock_documents_at(state_path, id, storage_roots)?;
            // Keep the physical root locked through preflight, removal and
            // state persistence, even against another host's storage selection.
            storage::assert_documents_deletable(&guard)?;
            Some(guard)
        } else {
            None
        };
        fs::remove_dir_if_exists(&dir)?;
        state.plugins.remove(id);
        // Directory grants are capabilities, never retained user data: they go
        // regardless of delete_data, so a reinstall starts with no access.
        state.asset_directories.remove(id);
        if let Some(guard) = &document_guard {
            // Preserve document files and their selected location unless the
            // user explicitly requests whole-plugin data deletion.
            storage::delete_plugin_documents(guard)?;
            state.document_storage.remove(id);
            db.plugin_kv_delete_all(id)?;
            state.kv_tombstones.remove(id);
        } else {
            state
                .kv_tombstones
                .insert(id.to_string(), state::now_secs());
        }
        state::write_state(state_path, &state)?;
    }
    // Services this plugin spawned with lifecycle="plugin" must not outlive
    // the plugin itself.
    crate::plugin_caps::kill_tracked_children(id);
    Ok(())
}

#[tauri::command]
pub async fn plugin_uninstall(
    db: tauri::State<'_, Arc<crate::db::Db>>,
    id: String,
    delete_data: bool,
) -> Result<(), String> {
    let db = Arc::clone(db.inner());
    tauri::async_runtime::spawn_blocking(move || {
        uninstall_at(&db, &state::plugins_dir(), &state::state_path(), &id, delete_data)
    }).await.map_err(|e| e.to_string())?
}

fn set_enabled_at(
    plugins_dir: &Path,
    state_path: &Path,
    id: &str,
    enabled: bool,
) -> Result<PluginInfo, String> {
    manifest::require_valid_id(id)?;
    let record = state::update_record(state_path, id, |record| {
        record.enabled = enabled;
        if enabled {
            // Re-enabling is the user's explicit "trust it again": clear the
            // quarantine and the error that caused it.
            record.quarantined = false;
            record.last_error = None;
        }
    })?;
    if !enabled {
        // Disabling takes effect immediately for lifecycle="plugin"
        // children too — they belong to the enabled plugin's runtime.
        crate::plugin_caps::kill_tracked_children(id);
    }
    Ok(fs::info_for(plugins_dir, id, &record))
}

#[tauri::command]
pub async fn plugin_set_enabled(id: String, enabled: bool) -> Result<PluginInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        set_enabled_at(&state::plugins_dir(), &state::state_path(), &id, enabled)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn plugin_quarantine(id: String, error: String) -> Result<PluginInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        manifest::require_valid_id(&id)?;
        let record = state::update_record(&state::state_path(), &id, |record| {
            record.quarantined = true;
            record.last_error = Some(error.clone());
        })?;
        // Quarantine also stops this plugin's owned lifecycle processes.
        crate::plugin_caps::kill_tracked_children(&id);
        Ok(fs::info_for(&state::plugins_dir(), &id, &record))
    }).await.map_err(|e| e.to_string())?
}

/// Artwork bytes for the installed-plugin UI (the market/installed row icon
/// and the detail gallery), returned as a data URL: the webview needs no
/// filesystem access, `~/.ccgui-next` stays behind the asset protocol's deny
/// list, and only files shipped by that very plugin can be read.
#[tauri::command]
pub fn plugin_read_artwork(id: String, path: String) -> Result<String, String> {
    manifest::require_valid_id(&id)?;
    fs::artwork_data_url(&state::plugins_dir(), &id, &path)
}

#[tauri::command]
pub fn plugin_read_file(id: String, name: String) -> Result<String, String> {
    manifest::require_valid_id(&id)?;
    if !READABLE_FILES.contains(&name.as_str()) {
        return Err(format!(
            "{name}: not readable (want one of {})",
            READABLE_FILES.join(", ")
        ));
    }
    let path = state::plugins_dir().join(&id).join(&name);
    let size = std::fs::metadata(&path)
        .map_err(|e| format!("stat {}: {e}", path.display()))?
        .len();
    if size > fs::MAX_FILE_BYTES {
        return Err(format!("{name}: exceeds the 16MB limit ({size} bytes)"));
    }
    std::fs::read_to_string(&path).map_err(|e| format!("read {}: {e}", path.display()))
}

/// KV read gate. A read only exposes what the plugin already stored, so it
/// needs the plugin to be installed and to have declared the `storage`
/// permission — but it works while the plugin is disabled or quarantined so
/// users can inspect what is there before deciding to delete it.
fn storage_read_guard(state_path: &Path, id: &str) -> Result<(), String> {
    manifest::require_valid_id(id)?;
    let (_enabled, _quarantined, permissions) = state::record_access(state_path, id)?;
    if !permissions.iter().any(|permission| permission == "storage") {
        return Err(format!("{id}: missing storage permission"));
    }
    Ok(())
}

/// KV write gate (set/delete): additionally requires the plugin to be
/// enabled and not quarantined, so a disabled or blamed plugin cannot keep
/// writing to the database behind the user's back.
fn storage_write_guard(state_path: &Path, id: &str) -> Result<(), String> {
    storage_read_guard(state_path, id)?;
    let (enabled, quarantined, _) = state::record_access(state_path, id)?;
    if !enabled {
        return Err(format!("{id}: plugin is disabled"));
    }
    if quarantined {
        return Err(format!("{id}: plugin is quarantined"));
    }
    Ok(())
}

#[tauri::command]
pub fn plugin_storage_get(
    db: tauri::State<'_, Arc<crate::db::Db>>,
    id: String,
    key: String,
) -> Result<Option<serde_json::Value>, String> {
    storage_read_guard(&state::state_path(), &id)?;
    db.plugin_kv_get(&id, &key)
}

#[tauri::command]
pub fn plugin_storage_set(
    db: tauri::State<'_, Arc<crate::db::Db>>,
    id: String,
    key: String,
    value: serde_json::Value,
) -> Result<(), String> {
    storage_write_guard(&state::state_path(), &id)?;
    db.plugin_kv_set(&id, &key, &value)
}

#[tauri::command]
pub fn plugin_storage_delete(
    db: tauri::State<'_, Arc<crate::db::Db>>,
    id: String,
    key: String,
) -> Result<(), String> {
    storage_write_guard(&state::state_path(), &id)?;
    db.plugin_kv_delete(&id, &key)
}

#[cfg(test)]
pub(crate) mod test_support {
    use std::path::{Path, PathBuf};

    pub(crate) struct Scratch(pub PathBuf);
    impl Scratch {
        pub(crate) fn new() -> Self {
            let dir = std::env::temp_dir()
                .join(format!("ccgui-next-plugins-test-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
        pub(crate) fn path(&self, name: &str) -> PathBuf {
            self.0.join(name)
        }
    }
    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    pub(crate) fn write_plugin(dir: &Path, manifest: &str) {
        std::fs::create_dir_all(dir).unwrap();
        std::fs::write(dir.join("manifest.json"), manifest).unwrap();
    }

    /// Create a directory link (junction on Windows, symlink elsewhere) so
    /// reparse-point hardening can be exercised on both platforms.
    pub(crate) fn create_dir_link(link: &Path, target: &Path) -> bool {
        #[cfg(windows)]
        {
            std::process::Command::new("cmd")
                .arg("/C")
                .arg("mklink")
                .arg("/J")
                .arg(link)
                .arg(target)
                .status()
                .map(|status| status.success())
                .unwrap_or(false)
        }
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(target, link).is_ok()
        }
    }

    pub(crate) fn valid_manifest(id: &str) -> String {
        format!(
            r#"{{"id":"{id}","name":"Test","version":"1.2.3","tier":"declarative",
                "permissions":["storage","ui:panel-tab"]}}"#
        )
    }

    /// validate_manifest with the file list install_from would have walked.
    pub(crate) fn validate(dir: &Path) -> Result<super::manifest::PluginManifest, String> {
        let files = super::fs::collect_files(dir)?;
        super::manifest::validate_manifest(dir, &files)
    }
}

#[cfg(test)]
mod tests {
    use super::test_support::{valid_manifest, write_plugin, Scratch};
    use super::{fs, set_enabled_at, storage_read_guard, storage_write_guard, uninstall_at, uninstall_with_storage_at};
    use super::storage::{
        select_location_at, write_text_at, StorageLocationKind, StorageLocationSelection,
        StorageRoots,
    };

    #[tokio::test]
    async fn disable_and_uninstall_kill_lifecycle_plugin_children() {
        let scratch = Scratch::new();
        let plugins_dir = scratch.path("plugins");
        let state_path = scratch.path("plugins.json");

        let source = scratch.path("src-life");
        write_plugin(&source, &valid_manifest("life-plugin"));
        fs::install_from(&plugins_dir, &state_path, &source, "local", |_| {}).unwrap();
        // Freshly installed plugins start disabled; enable first.
        set_enabled_at(&plugins_dir, &state_path, "life-plugin", true).unwrap();

        crate::plugin_caps::register_tracked_child(
            "life-plugin",
            crate::plugin_caps::spawn_test_sleeper(),
        );
        set_enabled_at(&plugins_dir, &state_path, "life-plugin", false).unwrap();
        // The disable hook already drained and killed the tracked child.
        assert_eq!(crate::plugin_caps::kill_tracked_children("life-plugin"), 0);

        set_enabled_at(&plugins_dir, &state_path, "life-plugin", true).unwrap();
        crate::plugin_caps::register_tracked_child(
            "life-plugin",
            crate::plugin_caps::spawn_test_sleeper(),
        );
        let db = crate::db::Db::open_at(&scratch.path("app.db")).unwrap();
        uninstall_at(&db, &plugins_dir, &state_path, "life-plugin", false).unwrap();
        // Same for uninstall: nothing left for a later kill to find.
        assert_eq!(crate::plugin_caps::kill_tracked_children("life-plugin"), 0);
    }

    fn write_kv_state(path: &std::path::Path, id: &str, enabled: bool, quarantined: bool, permissions: &[&str]) {
        let mut state = super::state::PluginsState::default();
        let mut record = super::state::PluginRecord::fresh("test", 1);
        record.enabled = enabled;
        record.quarantined = quarantined;
        record.permissions = permissions.iter().map(|p| (*p).to_string()).collect();
        state.plugins.insert(id.into(), record);
        super::state::write_state(path, &state).unwrap();
    }

    #[test]
    fn kv_gates_require_install_storage_permission_and_a_clean_enabled_plugin() {
        let scratch = Scratch::new();
        let state_path = scratch.path("plugins.json");
        let id = "usage-stats";

        // Not installed: neither reads nor writes get through.
        assert!(storage_read_guard(&state_path, id).unwrap_err().contains("not installed"));
        assert!(storage_write_guard(&state_path, id).unwrap_err().contains("not installed"));

        // Installed without the `storage` permission.
        write_kv_state(&state_path, id, true, false, &["ui:panel-tab"]);
        assert!(storage_read_guard(&state_path, id)
            .unwrap_err()
            .contains("missing storage permission"));
        assert!(storage_write_guard(&state_path, id)
            .unwrap_err()
            .contains("missing storage permission"));

        // Disabled: reads survive, writes and deletes do not.
        write_kv_state(&state_path, id, false, false, &["storage"]);
        assert!(storage_read_guard(&state_path, id).is_ok());
        assert!(storage_write_guard(&state_path, id).unwrap_err().contains("disabled"));

        // Quarantined: same split, distinct reason.
        write_kv_state(&state_path, id, true, true, &["storage"]);
        assert!(storage_read_guard(&state_path, id).is_ok());
        assert!(storage_write_guard(&state_path, id).unwrap_err().contains("quarantined"));

        // Installed, enabled, clean, permissioned: everything opens.
        write_kv_state(&state_path, id, true, false, &["storage"]);
        assert!(storage_read_guard(&state_path, id).is_ok());
        assert!(storage_write_guard(&state_path, id).is_ok());

        // The id grammar gate still runs first on both paths.
        assert!(storage_read_guard(&state_path, "a").unwrap_err().contains("invalid plugin id"));
        assert!(storage_write_guard(&state_path, "a").unwrap_err().contains("invalid plugin id"));
    }

    #[test]
    fn uninstall_refuses_a_reparse_point_document_tree_before_removing_the_plugin() {
        use super::test_support::create_dir_link;
        let scratch = Scratch::new();
        let plugins_dir = scratch.path("plugins");
        let state_path = scratch.path("plugins.json");
        let source = scratch.path("source");
        write_plugin(
            &source,
            r#"{"id":"docs.plugin","name":"Test","version":"1.2.3","tier":"declarative","permissions":["plugin.storage"]}"#,
        );
        fs::install_from(&plugins_dir, &state_path, &source, "local", |_| {}).unwrap();
        set_enabled_at(&plugins_dir, &state_path, "docs.plugin", true).unwrap();
        let roots = StorageRoots {
            data: scratch.path("data"),
            program: scratch.path("program"),
        };
        let custom = scratch.path("custom");
        select_location_at(
            &state_path,
            &roots,
            "docs.plugin",
            StorageLocationSelection {
                kind: StorageLocationKind::Custom,
                path: Some(custom.to_string_lossy().into_owned()),
            },
        )
        .unwrap();
        write_text_at(&state_path, &roots, "docs.plugin", "state", "saved", None).unwrap();
        let outside = scratch.path("outside");
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("keep"), "keep").unwrap();
        let root = custom.join("plugin-data").join("docs.plugin");
        assert!(create_dir_link(&root.join("escape"), &outside), "could not create a directory link");

        let db = crate::db::Db::open_at(&scratch.path("app.db")).unwrap();
        let error =
            uninstall_with_storage_at(&db, &plugins_dir, &state_path, "docs.plugin", true, Some(&roots))
                .unwrap_err();
        assert!(error.contains("reparse point"), "unexpected: {error}");
        // Nothing was shed: the install, its record, and the outside data survive.
        assert!(plugins_dir.join("docs.plugin").is_dir(), "plugin directory was removed anyway");
        assert!(crate::plugins::state::read_state(&state_path)
            .unwrap()
            .plugins
            .contains_key("docs.plugin"));
        assert!(root.join("state").exists());
        assert!(outside.join("keep").exists());
    }

    #[test]
    fn uninstall_preserves_or_deletes_document_storage_by_policy() {
        for delete_data in [false, true] {
            let scratch = Scratch::new();
            let plugins_dir = scratch.path("plugins");
            let state_path = scratch.path("plugins.json");
            let source = scratch.path("source");
            write_plugin(
                &source,
                r#"{"id":"docs.plugin","name":"Test","version":"1.2.3","tier":"declarative","permissions":["plugin.storage"]}"#,
            );
            fs::install_from(&plugins_dir, &state_path, &source, "local", |_| {}).unwrap();
            set_enabled_at(&plugins_dir, &state_path, "docs.plugin", true).unwrap();
            let roots = StorageRoots {
                data: scratch.path("data"),
                program: scratch.path("program"),
            };
            let custom = scratch.path("custom");
            select_location_at(
                &state_path,
                &roots,
                "docs.plugin",
                StorageLocationSelection {
                    kind: StorageLocationKind::Custom,
                    path: Some(custom.to_string_lossy().into_owned()),
                },
            )
            .unwrap();
            write_text_at(&state_path, &roots, "docs.plugin", "state", "saved", None).unwrap();
            let mut state = super::state::read_state(&state_path).unwrap();
            state.asset_directories.insert(
                "docs.plugin".into(),
                vec![super::assets::AssetDirectoryGrant {
                    grant_id: "old-capability".into(),
                    path: custom.to_string_lossy().into_owned(),
                }],
            );
            super::state::write_state(&state_path, &state).unwrap();
            let document = custom.join("plugin-data/docs.plugin/state");
            let db = crate::db::Db::open_at(&scratch.path("app.db")).unwrap();
            uninstall_with_storage_at(
                &db,
                &plugins_dir,
                &state_path,
                "docs.plugin",
                delete_data,
                Some(&roots),
            )
            .unwrap();
            assert_eq!(document.exists(), !delete_data);
            let state = super::state::read_state(&state_path).unwrap();
            assert_eq!(state.document_storage.contains_key("docs.plugin"), !delete_data);
            // Grants are capabilities: cleared either way, unlike documents.
            assert!(!state.asset_directories.contains_key("docs.plugin"));
        }
    }
}
