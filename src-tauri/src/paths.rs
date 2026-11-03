use std::path::PathBuf;

fn read_portable_app_home() -> Option<PathBuf> {
    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let path = exe_dir.join("portable-data.json");
    let text = std::fs::read_to_string(path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    let raw = value.get("appHome")?.as_str()?.trim();
    if raw.is_empty() {
        return None;
    }
    let path = PathBuf::from(raw);
    // A portable home must be absolute: a relative path would resolve against
    // whatever directory the process happened to launch from and scatter app
    // data across machines.
    if path.is_relative() {
        return None;
    }
    // It must also sit OUTSIDE the user's home directory: tauri.conf.json's
    // assetProtocol scope statically denies only `$HOME/.ccgui-next`, so an
    // in-home portable dir (e.g. ~/portable-ccgui/data) would let webview JS
    // read provider API keys and session history through the asset: protocol.
    if path.starts_with(home_dir()) {
        return None;
    }
    Some(path)
}

/// Portable-mode home, resolved once: portable mode is decided at launch (the
/// pointer file sits next to the exe), and app_home() has ~40 callers —
/// several on per-IPC paths — so an uncached disk read + JSON parse on every
/// call is pure waste.
static PORTABLE_HOME: std::sync::LazyLock<Option<PathBuf>> =
    std::sync::LazyLock::new(read_portable_app_home);

/// Home dir without panicking: a headless/odd environment falls back to the
/// current directory so startup degrades instead of crashing.
///
/// Production resolves through `dirs` (Known Folder API on Windows). Tests
/// steer it through HOME / USERPROFILE instead, because `dirs` ignores the
/// environment on Windows and would read the real profile — the same split
/// `engine::fallback_home` uses. The scanner's provider-home tests set a
/// scratch HOME and expect `~/.ccgui` under it; without this the v0.9
/// legacy scan kept looking at the real profile and found nothing.
pub(crate) fn home_dir() -> PathBuf {
    #[cfg(test)]
    {
        if let Some(home) = std::env::var_os("HOME").filter(|v| !v.is_empty()) {
            return PathBuf::from(home);
        }
        #[cfg(windows)]
        if let Some(profile) = std::env::var_os("USERPROFILE").filter(|v| !v.is_empty()) {
            return PathBuf::from(profile);
        }
    }
    dirs::home_dir()
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
}

/// Serialize tests that steer process-global HOME / USERPROFILE (read by the
/// cfg(test) branch above): module-private locks would not exclude each other,
/// so every HOME-mutating test across the crate holds this one lock.
#[cfg(test)]
pub(crate) static HOME_ENV_LOCK: parking_lot::Mutex<()> = parking_lot::Mutex::new(());

/// Application home directory: ~/.ccgui-next/
pub fn app_home() -> PathBuf {
    if let Some(path) = PORTABLE_HOME.as_ref() {
        return path.clone();
    }
    home_dir().join(".ccgui-next")
}

pub fn legacy_home() -> PathBuf {
    home_dir().join(".ccgui")
}

/// Legacy desktop-cc-gui's workspace list: its Tauri app-data dir (bundle id
/// `com.zhukunpenglinyutong.ccgui`) holds workspaces.json — the sidebar the
/// upgrade imports on first launch so old users keep their workspaces.
pub fn legacy_workspaces_path() -> PathBuf {
    let base = dirs::config_dir().unwrap_or_else(home_dir);
    base.join("com.zhukunpenglinyutong.ccgui")
        .join("workspaces.json")
}

/// Legacy app's settings next to its workspace list: holds `workspaceGroups`
/// (sidebar 分组定义), imported on upgrade so groups survive the switch.
pub fn legacy_settings_path() -> PathBuf {
    let base = dirs::config_dir().unwrap_or_else(home_dir);
    base.join("com.zhukunpenglinyutong.ccgui")
        .join("settings.json")
}

/// Legacy desktop-cc-gui's agent catalog: `~/.ccgui/agent.json` (singular —
/// the new app's catalog is `agents.json`). Imported on upgrade.
pub fn legacy_agents_path() -> PathBuf {
    legacy_home().join("agent.json")
}

/// Legacy desktop-cc-gui's Tauri app-data dir: per-workspace custom prompts
/// lived under `workspaces/<id>/prompts` here.
pub fn legacy_app_data_dir() -> PathBuf {
    let base = dirs::config_dir().unwrap_or_else(home_dir);
    base.join("com.zhukunpenglinyutong.ccgui")
}

/// Legacy global prompts: the default Codex home's `prompts` dir, shared
/// with the Codex CLI itself (CODEX_HOME wins, matching the legacy
/// resolver). Migration copies out of it — never moves — because the CLI
/// still reads this directory.
pub fn legacy_global_prompts_dir() -> PathBuf {
    if let Some(value) = std::env::var_os("CODEX_HOME").filter(|v| !v.is_empty()) {
        return PathBuf::from(value).join("prompts");
    }
    home_dir().join(".codex").join("prompts")
}

pub fn config_path() -> PathBuf {
    app_home().join("config.json")
}

pub fn settings_path() -> PathBuf {
    app_home().join("settings.json")
}

pub fn db_path() -> PathBuf {
    app_home().join("app.db")
}

/// Directory containing the running executable (portable/program storage base).
pub fn program_dir() -> Result<PathBuf, String> {
    std::env::current_exe()
        .map_err(|error| format!("resolve current executable: {error}"))?
        .parent()
        .map(PathBuf::from)
        .ok_or_else(|| "current executable has no parent directory".to_string())
}

pub fn ensure_dirs() -> std::io::Result<()> {
    let home = app_home();
    std::fs::create_dir_all(&home)?;
    restrict_to_owner(&home);
    Ok(())
}

/// The app home holds API keys (config.json), access tokens (settings.json)
/// and session data. Older builds created it 0755 and wrote files 0644, so
/// any local user could read them; an owner-only directory closes that for
/// files written before atomic_write kept modes. Best effort: a directory we
/// do not own (or a filesystem without modes) is left as is.
fn restrict_to_owner(dir: &std::path::Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(dir) {
            if meta.permissions().mode() & 0o077 != 0 {
                let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
            }
        }
    }
    #[cfg(not(unix))]
    let _ = dir;
}

#[cfg(all(test, unix))]
mod owner_only_tests {
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn app_home_is_narrowed_to_its_owner() {
        let dir = std::env::temp_dir().join(format!("ccgui-home-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).unwrap();
        super::restrict_to_owner(&dir);
        let mode = std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o700);
        let _ = std::fs::remove_dir_all(dir);
    }
}
