use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const APP_HOME_DIR_NAME: &str = ".ccgui";
const LEGACY_APP_HOME_DIR_NAMES: &[&str] = &[".mossx", ".codemoss"];
const MIGRATION_SENTINEL_FILENAME: &str = ".migration.json";

pub(crate) fn app_home_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Unable to resolve home directory")?;
    ensure_app_home_dir_from_home(&home)
}

pub(crate) fn config_file_path() -> Result<PathBuf, String> {
    Ok(app_home_dir()?.join("config.json"))
}

pub(crate) fn client_storage_dir() -> Result<PathBuf, String> {
    Ok(app_home_dir()?.join("client"))
}

pub(crate) fn input_history_file_path() -> Result<PathBuf, String> {
    Ok(app_home_dir()?.join("inputHistory.json"))
}

pub(crate) fn project_memory_dir() -> Result<PathBuf, String> {
    Ok(app_home_dir()?.join("project-memory"))
}

pub(crate) fn note_card_dir() -> Result<PathBuf, String> {
    Ok(app_home_dir()?.join("note_card"))
}

pub(crate) fn agent_file_path() -> Result<PathBuf, String> {
    Ok(app_home_dir()?.join("agent.json"))
}

pub(crate) fn workspace_root_candidates() -> Result<Vec<PathBuf>, String> {
    let home = dirs::home_dir().ok_or("Unable to resolve home directory")?;
    Ok(workspace_root_candidates_from_home(&home))
}

pub(crate) fn prepare_app_data_dir(current_data_dir: &Path) -> Result<(), String> {
    prepare_app_data_dir_from_path(current_data_dir)
}

fn ensure_app_home_dir_from_home(home: &Path) -> Result<PathBuf, String> {
    let current = home.join(APP_HOME_DIR_NAME);
    if current.exists() {
        return Ok(current);
    }

    for legacy_name in LEGACY_APP_HOME_DIR_NAMES {
        let legacy_path = home.join(legacy_name);
        if !legacy_path.exists() {
            continue;
        }
        copy_dir_recursive(&legacy_path, &current)?;
        write_migration_sentinel(&current, legacy_name)?;
        return Ok(current);
    }

    Ok(current)
}

fn workspace_root_candidates_from_home(home: &Path) -> Vec<PathBuf> {
    let mut roots = vec![home.join(APP_HOME_DIR_NAME).join("workspace")];
    for legacy in LEGACY_APP_HOME_DIR_NAMES {
        roots.push(home.join(legacy).join("workspace"));
    }
    roots.push(home.join(".moss-x").join("workspace"));
    roots
}

fn prepare_app_data_dir_from_path(current_data_dir: &Path) -> Result<(), String> {
    if has_existing_app_data(current_data_dir) {
        return Ok(());
    }

    let Some(parent_dir) = current_data_dir.parent() else {
        return Ok(());
    };

    for legacy_dir in legacy_app_data_candidates(parent_dir) {
        if !legacy_dir.exists() || !has_existing_app_data(&legacy_dir) {
            continue;
        }
        copy_dir_recursive(&legacy_dir, current_data_dir)?;
        write_migration_sentinel(current_data_dir, &legacy_dir.to_string_lossy())?;
        return Ok(());
    }

    Ok(())
}

fn has_existing_app_data(dir: &Path) -> bool {
    dir.join("workspaces.json").exists()
        || dir.join("settings.json").exists()
        || dir.join("workspaces").exists()
        || dir.join("models").exists()
}

fn legacy_app_data_candidates(parent_dir: &Path) -> Vec<PathBuf> {
    [
        "com.zhukunpenglinyutong.codemoss",
        "com.zhukunpenglinyutong.mossx",
        "com.dimillian.codemoss",
    ]
    .into_iter()
    .map(|name| parent_dir.join(name))
    .collect()
}

fn copy_dir_recursive(source: &Path, destination: &Path) -> Result<(), String> {
    if source.is_file() {
        copy_file(source, destination)?;
        return Ok(());
    }

    fs::create_dir_all(destination).map_err(|error| error.to_string())?;
    let entries = fs::read_dir(source).map_err(|error| error.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        let file_type = entry.file_type().map_err(|error| error.to_string())?;

        if file_type.is_dir() {
            copy_dir_recursive(&source_path, &destination_path)?;
            continue;
        }

        if file_type.is_file() {
            copy_file(&source_path, &destination_path)?;
            continue;
        }

        if file_type.is_symlink() {
            let resolved = source_path
                .canonicalize()
                .unwrap_or_else(|_| source_path.clone());
            if resolved.is_dir() {
                copy_dir_recursive(&resolved, &destination_path)?;
            } else if resolved.is_file() {
                copy_file(&resolved, &destination_path)?;
            }
        }
    }

    Ok(())
}

fn copy_file(source: &Path, destination: &Path) -> Result<(), String> {
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::copy(source, destination)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn write_migration_sentinel(destination: &Path, legacy_name: &str) -> Result<(), String> {
    fs::create_dir_all(destination).map_err(|error| error.to_string())?;
    let migrated_at_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    let payload = format!(
        "{{\"source\":\"{}\",\"migratedAtMs\":{}}}",
        legacy_name, migrated_at_ms
    );
    fs::write(destination.join(MIGRATION_SENTINEL_FILENAME), payload)
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn prefers_existing_ccgui_home_without_overwriting_it() {
        let base = std::env::temp_dir().join(format!("ccgui-home-existing-{}", Uuid::new_v4()));
        let ccgui_dir = base.join(".ccgui");
        let mossx_dir = base.join(".mossx");
        std::fs::create_dir_all(&ccgui_dir).expect("create .ccgui");
        std::fs::create_dir_all(&mossx_dir).expect("create .mossx");
        std::fs::write(ccgui_dir.join("config.json"), "{\"brand\":\"ccgui\"}")
            .expect("write ccgui");
        std::fs::write(mossx_dir.join("config.json"), "{\"brand\":\"mossx\"}")
            .expect("write mossx");

        let resolved = ensure_app_home_dir_from_home(&base).expect("resolve app home");

        assert_eq!(resolved, ccgui_dir);
        assert_eq!(
            std::fs::read_to_string(ccgui_dir.join("config.json")).expect("read ccgui"),
            "{\"brand\":\"ccgui\"}",
        );

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn migrates_mossx_home_into_ccgui_when_new_dir_missing() {
        let base =
            std::env::temp_dir().join(format!("ccgui-home-migrate-mossx-{}", Uuid::new_v4()));
        let mossx_dir = base.join(".mossx");
        std::fs::create_dir_all(mossx_dir.join("client")).expect("create mossx client dir");
        std::fs::write(mossx_dir.join("config.json"), "{\"brand\":\"mossx\"}")
            .expect("write mossx");
        std::fs::write(
            mossx_dir.join("client").join("layout.json"),
            "{\"sidebarWidth\":320}",
        )
        .expect("write legacy layout");

        let resolved = ensure_app_home_dir_from_home(&base).expect("resolve migrated app home");
        let ccgui_dir = base.join(".ccgui");

        assert_eq!(resolved, ccgui_dir);
        assert_eq!(
            std::fs::read_to_string(ccgui_dir.join("config.json")).expect("read migrated config"),
            "{\"brand\":\"mossx\"}",
        );
        assert!(mossx_dir.join("client").join("layout.json").exists());

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn falls_back_to_codemoss_when_mossx_is_missing() {
        let base =
            std::env::temp_dir().join(format!("ccgui-home-migrate-codemoss-{}", Uuid::new_v4()));
        let codemoss_dir = base.join(".codemoss");
        std::fs::create_dir_all(&codemoss_dir).expect("create codemoss dir");
        std::fs::write(codemoss_dir.join("agent.json"), "{\"id\":\"legacy-agent\"}")
            .expect("write codemoss agent");

        let resolved = ensure_app_home_dir_from_home(&base).expect("resolve migrated app home");
        let ccgui_dir = base.join(".ccgui");

        assert_eq!(resolved, ccgui_dir);
        assert_eq!(
            std::fs::read_to_string(ccgui_dir.join("agent.json")).expect("read migrated agent"),
            "{\"id\":\"legacy-agent\"}",
        );

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn workspace_root_candidates_put_ccgui_first_and_keep_legacy_paths() {
        let home = PathBuf::from("/Users/demo");

        let roots = workspace_root_candidates_from_home(&home);

        assert_eq!(roots[0], home.join(".ccgui").join("workspace"));
        assert!(roots.contains(&home.join(".mossx").join("workspace")));
        assert!(roots.contains(&home.join(".codemoss").join("workspace")));
        assert!(roots.contains(&home.join(".moss-x").join("workspace")));
    }

    #[test]
    fn migrates_legacy_app_data_when_new_bundle_dir_only_has_window_state() {
        let base = std::env::temp_dir().join(format!("ccgui-app-data-{}", Uuid::new_v4()));
        let legacy_dir = base.join("com.zhukunpenglinyutong.codemoss");
        let current_dir = base.join("com.zhukunpenglinyutong.ccgui");

        std::fs::create_dir_all(legacy_dir.join("workspaces"))
            .expect("create legacy workspaces dir");
        std::fs::create_dir_all(&current_dir).expect("create current dir");
        std::fs::write(current_dir.join(".window-state.json"), "{\"window\":true}")
            .expect("write current window state");
        std::fs::write(legacy_dir.join("workspaces.json"), "{\"workspace\":1}")
            .expect("write legacy workspaces");
        std::fs::write(legacy_dir.join("settings.json"), "{\"theme\":\"light\"}")
            .expect("write legacy settings");
        std::fs::write(legacy_dir.join("workspaces").join("note.txt"), "hello")
            .expect("write legacy workspace payload");

        prepare_app_data_dir_from_path(&current_dir).expect("prepare app data");

        assert_eq!(
            std::fs::read_to_string(current_dir.join("workspaces.json"))
                .expect("read migrated workspaces"),
            "{\"workspace\":1}",
        );
        assert_eq!(
            std::fs::read_to_string(current_dir.join("settings.json"))
                .expect("read migrated settings"),
            "{\"theme\":\"light\"}",
        );
        assert_eq!(
            std::fs::read_to_string(current_dir.join("workspaces").join("note.txt"))
                .expect("read migrated workspace payload"),
            "hello",
        );
        assert_eq!(
            std::fs::read_to_string(current_dir.join(".window-state.json"))
                .expect("read preserved window state"),
            "{\"window\":true}",
        );

        std::fs::remove_dir_all(&base).ok();
    }

    #[test]
    fn does_not_overwrite_existing_ccgui_app_data() {
        let base = std::env::temp_dir().join(format!("ccgui-app-data-preserve-{}", Uuid::new_v4()));
        let legacy_dir = base.join("com.zhukunpenglinyutong.codemoss");
        let current_dir = base.join("com.zhukunpenglinyutong.ccgui");

        std::fs::create_dir_all(&legacy_dir).expect("create legacy dir");
        std::fs::create_dir_all(&current_dir).expect("create current dir");
        std::fs::write(legacy_dir.join("workspaces.json"), "{\"workspace\":1}")
            .expect("write legacy workspaces");
        std::fs::write(current_dir.join("workspaces.json"), "{\"workspace\":2}")
            .expect("write current workspaces");

        prepare_app_data_dir_from_path(&current_dir).expect("prepare app data");

        assert_eq!(
            std::fs::read_to_string(current_dir.join("workspaces.json"))
                .expect("read current workspaces"),
            "{\"workspace\":2}",
        );

        std::fs::remove_dir_all(&base).ok();
    }
}
