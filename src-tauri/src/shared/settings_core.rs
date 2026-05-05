use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::Mutex;

use crate::codex::config as codex_config;
use crate::shared::proxy_core;
use crate::storage::write_settings;
use crate::types::{AppSettings, CodexUnifiedExecExternalStatus};

const UI_SCALE_MIN: f64 = 0.8;
const UI_SCALE_MAX: f64 = 2.6;
const UI_SCALE_DEFAULT: f64 = 1.0;
const CANVAS_WIDTH_MODE_NARROW: &str = "narrow";
const CANVAS_WIDTH_MODE_WIDE: &str = "wide";
const LAYOUT_MODE_DEFAULT: &str = "default";
const LAYOUT_MODE_SWAPPED: &str = "swapped";
const THEME_SYSTEM: &str = "system";
const THEME_LIGHT: &str = "light";
const THEME_DARK: &str = "dark";
const THEME_DIM: &str = "dim";
const THEME_CUSTOM: &str = "custom";
const LIGHT_THEME_PRESET_MODERN: &str = "vscode-light-modern";
const LIGHT_THEME_PRESET_PLUS: &str = "vscode-light-plus";
const LIGHT_THEME_PRESET_GITHUB: &str = "vscode-github-light";
const LIGHT_THEME_PRESET_SOLARIZED: &str = "vscode-solarized-light";
const DARK_THEME_PRESET_MODERN: &str = "vscode-dark-modern";
const DARK_THEME_PRESET_PLUS: &str = "vscode-dark-plus";
const DARK_THEME_PRESET_GITHUB: &str = "vscode-github-dark";
const DARK_THEME_PRESET_GITHUB_DIMMED: &str = "vscode-github-dark-dimmed";
const DARK_THEME_PRESET_ONE_DARK_PRO: &str = "vscode-one-dark-pro";
const DARK_THEME_PRESET_MONOKAI: &str = "vscode-monokai";
const DARK_THEME_PRESET_SOLARIZED: &str = "vscode-solarized-dark";

fn sanitize_ui_scale(scale: f64) -> f64 {
    if !scale.is_finite() || scale < UI_SCALE_MIN || scale > UI_SCALE_MAX {
        return UI_SCALE_DEFAULT;
    }
    (scale * 100.0).round() / 100.0
}

fn sanitize_canvas_width_mode(mode: &str) -> String {
    match mode {
        CANVAS_WIDTH_MODE_NARROW | CANVAS_WIDTH_MODE_WIDE => mode.to_string(),
        _ => CANVAS_WIDTH_MODE_NARROW.to_string(),
    }
}

fn sanitize_layout_mode(mode: &str) -> String {
    match mode {
        LAYOUT_MODE_DEFAULT | LAYOUT_MODE_SWAPPED => mode.to_string(),
        _ => LAYOUT_MODE_DEFAULT.to_string(),
    }
}

fn sanitize_theme(theme: &str) -> String {
    match theme {
        THEME_SYSTEM | THEME_LIGHT | THEME_DARK | THEME_DIM | THEME_CUSTOM => theme.to_string(),
        _ => THEME_SYSTEM.to_string(),
    }
}

fn sanitize_light_theme_preset_id(preset_id: &str) -> String {
    match preset_id {
        LIGHT_THEME_PRESET_MODERN
        | LIGHT_THEME_PRESET_PLUS
        | LIGHT_THEME_PRESET_GITHUB
        | LIGHT_THEME_PRESET_SOLARIZED => preset_id.to_string(),
        _ => LIGHT_THEME_PRESET_MODERN.to_string(),
    }
}

fn sanitize_dark_theme_preset_id(preset_id: &str) -> String {
    match preset_id {
        DARK_THEME_PRESET_MODERN
        | DARK_THEME_PRESET_PLUS
        | DARK_THEME_PRESET_GITHUB
        | DARK_THEME_PRESET_GITHUB_DIMMED
        | DARK_THEME_PRESET_ONE_DARK_PRO
        | DARK_THEME_PRESET_MONOKAI
        | DARK_THEME_PRESET_SOLARIZED => preset_id.to_string(),
        _ => DARK_THEME_PRESET_MODERN.to_string(),
    }
}

fn sanitize_theme_preset_id(preset_id: &str) -> String {
    match preset_id {
        LIGHT_THEME_PRESET_MODERN
        | LIGHT_THEME_PRESET_PLUS
        | LIGHT_THEME_PRESET_GITHUB
        | LIGHT_THEME_PRESET_SOLARIZED
        | DARK_THEME_PRESET_MODERN
        | DARK_THEME_PRESET_PLUS
        | DARK_THEME_PRESET_GITHUB
        | DARK_THEME_PRESET_GITHUB_DIMMED
        | DARK_THEME_PRESET_ONE_DARK_PRO
        | DARK_THEME_PRESET_MONOKAI
        | DARK_THEME_PRESET_SOLARIZED => preset_id.to_string(),
        _ => DARK_THEME_PRESET_MODERN.to_string(),
    }
}

fn resolve_theme_preset_appearance(preset_id: &str) -> &'static str {
    match preset_id {
        LIGHT_THEME_PRESET_MODERN
        | LIGHT_THEME_PRESET_PLUS
        | LIGHT_THEME_PRESET_GITHUB
        | LIGHT_THEME_PRESET_SOLARIZED => THEME_LIGHT,
        _ => THEME_DARK,
    }
}

fn sanitize_theme_settings(settings: &mut AppSettings) {
    settings.theme = sanitize_theme(&settings.theme);
    settings.canvas_width_mode = sanitize_canvas_width_mode(&settings.canvas_width_mode);
    settings.layout_mode = sanitize_layout_mode(&settings.layout_mode);
    settings.light_theme_preset_id =
        sanitize_light_theme_preset_id(&settings.light_theme_preset_id);
    settings.dark_theme_preset_id = sanitize_dark_theme_preset_id(&settings.dark_theme_preset_id);
    settings.custom_theme_preset_id = sanitize_theme_preset_id(&settings.custom_theme_preset_id);
}

fn sanitize_terminal_shell_path(settings: &mut AppSettings) {
    settings.terminal_shell_path = settings
        .terminal_shell_path
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(ToOwned::to_owned);
}

fn sanitize_custom_skill_directories(settings: &mut AppSettings) {
    let mut seen = HashSet::new();
    settings.custom_skill_directories = settings
        .custom_skill_directories
        .iter()
        .filter_map(|path| {
            let normalized = path.trim();
            if normalized.is_empty() || !seen.insert(normalized.to_string()) {
                return None;
            }
            Some(normalized.to_string())
        })
        .collect();
}

pub(crate) fn resolve_window_theme_preference(settings: &AppSettings) -> String {
    if settings.theme == THEME_CUSTOM {
        return resolve_theme_preset_appearance(&settings.custom_theme_preset_id).to_string();
    }
    settings.theme.clone()
}

fn validate_ui_scale(scale: f64) -> Result<(), String> {
    if !scale.is_finite() {
        return Err("uiScale must be a finite number".to_string());
    }
    if scale < UI_SCALE_MIN || scale > UI_SCALE_MAX {
        return Err(format!(
            "uiScale must be within [{UI_SCALE_MIN}, {UI_SCALE_MAX}]"
        ));
    }
    Ok(())
}

fn official_unified_exec_default_enabled() -> bool {
    !cfg!(windows)
}

pub(crate) async fn get_app_settings_core(app_settings: &Mutex<AppSettings>) -> AppSettings {
    let mut settings = app_settings.lock().await.clone();
    settings.normalize_unified_exec_policy();
    settings.sanitize_runtime_pool_settings();
    sanitize_terminal_shell_path(&mut settings);
    sanitize_custom_skill_directories(&mut settings);
    settings.experimental_collab_enabled = false;
    settings.ui_scale = sanitize_ui_scale(settings.ui_scale);
    sanitize_theme_settings(&mut settings);
    settings
}

pub(crate) async fn update_app_settings_core(
    settings: AppSettings,
    app_settings: &Mutex<AppSettings>,
    settings_path: &PathBuf,
) -> Result<AppSettings, String> {
    let mut normalized = settings;
    normalized.normalize_unified_exec_policy();
    normalized.experimental_collab_enabled = false;
    normalized.sanitize_runtime_pool_settings();
    sanitize_terminal_shell_path(&mut normalized);
    sanitize_custom_skill_directories(&mut normalized);
    sanitize_theme_settings(&mut normalized);
    validate_ui_scale(normalized.ui_scale)?;
    proxy_core::validate_proxy_settings(&normalized)?;
    write_settings(settings_path, &normalized)?;
    proxy_core::apply_app_proxy_settings(&normalized)?;
    let mut current = app_settings.lock().await;
    *current = normalized.clone();
    Ok(normalized)
}

pub(crate) async fn restore_app_settings_core(
    previous: &AppSettings,
    app_settings: &Mutex<AppSettings>,
    settings_path: &PathBuf,
) -> Result<(), String> {
    let mut normalized = previous.clone();
    normalized.normalize_unified_exec_policy();
    normalized.experimental_collab_enabled = false;
    sanitize_terminal_shell_path(&mut normalized);
    sanitize_custom_skill_directories(&mut normalized);
    normalized.ui_scale = sanitize_ui_scale(normalized.ui_scale);
    sanitize_theme_settings(&mut normalized);
    write_settings(settings_path, &normalized)?;
    proxy_core::apply_app_proxy_settings(&normalized)?;
    let mut current = app_settings.lock().await;
    *current = normalized;
    Ok(())
}

pub(crate) async fn restart_codex_sessions_for_app_settings_change_core<F, Fut>(
    workspaces: &Mutex<std::collections::HashMap<String, crate::types::WorkspaceEntry>>,
    sessions: &Mutex<
        std::collections::HashMap<String, Arc<crate::backend::app_server::WorkspaceSession>>,
    >,
    app_settings: &Mutex<AppSettings>,
    runtime_manager: Option<&Arc<crate::runtime::RuntimeManager>>,
    spawn_session: F,
) -> Result<(), String>
where
    F: Fn(crate::types::WorkspaceEntry, Option<String>, Option<String>, Option<PathBuf>) -> Fut
        + Copy,
    Fut: std::future::Future<
        Output = Result<Arc<crate::backend::app_server::WorkspaceSession>, String>,
    >,
{
    crate::shared::workspaces_core::restart_all_connected_sessions_core(
        workspaces,
        sessions,
        app_settings,
        runtime_manager,
        spawn_session,
    )
    .await
}

pub(crate) fn app_settings_change_requires_codex_restart(
    previous: &AppSettings,
    updated: &AppSettings,
) -> bool {
    let proxy_changed = previous.system_proxy_enabled != updated.system_proxy_enabled
        || previous.system_proxy_url != updated.system_proxy_url;
    let unified_exec_policy_changed =
        previous.codex_unified_exec_policy != updated.codex_unified_exec_policy;
    let auto_compaction_threshold_changed = previous.codex_auto_compaction_threshold_percent
        != updated.codex_auto_compaction_threshold_percent;
    let auto_compaction_enabled_changed =
        previous.codex_auto_compaction_enabled != updated.codex_auto_compaction_enabled;
    proxy_changed
        || unified_exec_policy_changed
        || auto_compaction_threshold_changed
        || auto_compaction_enabled_changed
}

pub(crate) fn get_codex_config_path_core() -> Result<String, String> {
    codex_config::config_toml_path()
        .ok_or_else(|| "Unable to resolve CODEX_HOME".to_string())
        .and_then(|path| {
            path.to_str()
                .map(|value| value.to_string())
                .ok_or_else(|| "Unable to resolve CODEX_HOME".to_string())
        })
}

pub(crate) fn get_codex_unified_exec_external_status_core(
) -> Result<CodexUnifiedExecExternalStatus, String> {
    let flag_status = codex_config::inspect_unified_exec_override()?;
    Ok(CodexUnifiedExecExternalStatus {
        config_path: codex_config::config_toml_path()
            .and_then(|path| path.to_str().map(|value| value.to_string())),
        has_explicit_unified_exec: flag_status.has_explicit_key,
        explicit_unified_exec_value: flag_status.value,
        official_default_enabled: official_unified_exec_default_enabled(),
    })
}

pub(crate) fn restore_codex_unified_exec_official_default_core(
) -> Result<CodexUnifiedExecExternalStatus, String> {
    codex_config::clear_unified_exec_override()?;
    get_codex_unified_exec_external_status_core()
}

pub(crate) fn set_codex_unified_exec_official_override_core(
    enabled: bool,
) -> Result<CodexUnifiedExecExternalStatus, String> {
    codex_config::write_unified_exec_override(enabled)?;
    get_codex_unified_exec_external_status_core()
}

#[cfg(test)]
mod tests {
    use std::env;
    use std::fs;
    use std::path::Path;
    use std::sync::Mutex as StdMutex;

    use super::{
        app_settings_change_requires_codex_restart, get_app_settings_core,
        get_codex_unified_exec_external_status_core, resolve_window_theme_preference,
        restore_codex_unified_exec_official_default_core, sanitize_canvas_width_mode,
        sanitize_dark_theme_preset_id, sanitize_layout_mode, sanitize_light_theme_preset_id,
        sanitize_theme, sanitize_theme_preset_id, sanitize_ui_scale,
        set_codex_unified_exec_official_override_core, update_app_settings_core, validate_ui_scale,
        DARK_THEME_PRESET_GITHUB, DARK_THEME_PRESET_GITHUB_DIMMED, DARK_THEME_PRESET_MODERN,
        DARK_THEME_PRESET_MONOKAI, DARK_THEME_PRESET_ONE_DARK_PRO, DARK_THEME_PRESET_PLUS,
        DARK_THEME_PRESET_SOLARIZED, LIGHT_THEME_PRESET_GITHUB, LIGHT_THEME_PRESET_MODERN,
        LIGHT_THEME_PRESET_PLUS, LIGHT_THEME_PRESET_SOLARIZED, UI_SCALE_DEFAULT,
    };
    use crate::types::{AppSettings, CodexUnifiedExecPolicy};
    use tokio::sync::Mutex;

    static ENV_LOCK: StdMutex<()> = StdMutex::new(());

    struct CodexHomeTestGuard {
        previous: Option<String>,
        cleanup_path: Option<std::path::PathBuf>,
    }

    impl CodexHomeTestGuard {
        fn new(path: &Path) -> Self {
            let previous = env::var("CODEX_HOME").ok();
            env::set_var("CODEX_HOME", path);
            Self {
                previous,
                cleanup_path: Some(path.to_path_buf()),
            }
        }
    }

    impl Drop for CodexHomeTestGuard {
        fn drop(&mut self) {
            if let Some(previous) = self.previous.take() {
                env::set_var("CODEX_HOME", previous);
            } else {
                env::remove_var("CODEX_HOME");
            }
            if let Some(path) = self.cleanup_path.take() {
                let _ = fs::remove_dir_all(path);
            }
        }
    }

    #[test]
    fn sanitize_ui_scale_falls_back_for_out_of_range() {
        assert!((sanitize_ui_scale(0.2) - UI_SCALE_DEFAULT).abs() < f64::EPSILON);
        assert!((sanitize_ui_scale(2.7) - UI_SCALE_DEFAULT).abs() < f64::EPSILON);
    }

    #[test]
    fn sanitize_ui_scale_keeps_supported_values() {
        assert!((sanitize_ui_scale(0.8) - 0.8).abs() < f64::EPSILON);
        assert!((sanitize_ui_scale(1.25) - 1.25).abs() < f64::EPSILON);
        assert!((sanitize_ui_scale(2.6) - 2.6).abs() < f64::EPSILON);
    }

    #[test]
    fn sanitize_canvas_width_mode_falls_back_for_invalid_values() {
        assert_eq!(sanitize_canvas_width_mode("foo"), "narrow");
        assert_eq!(sanitize_canvas_width_mode(""), "narrow");
    }

    #[test]
    fn sanitize_canvas_width_mode_keeps_supported_values() {
        assert_eq!(sanitize_canvas_width_mode("narrow"), "narrow");
        assert_eq!(sanitize_canvas_width_mode("wide"), "wide");
    }

    #[test]
    fn sanitize_layout_mode_falls_back_for_invalid_values() {
        assert_eq!(sanitize_layout_mode("foo"), "default");
        assert_eq!(sanitize_layout_mode(""), "default");
    }

    #[test]
    fn sanitize_layout_mode_keeps_supported_values() {
        assert_eq!(sanitize_layout_mode("default"), "default");
        assert_eq!(sanitize_layout_mode("swapped"), "swapped");
    }

    #[test]
    fn sanitize_theme_falls_back_for_invalid_values() {
        assert_eq!(sanitize_theme("invalid"), "system");
    }

    #[test]
    fn sanitize_theme_keeps_supported_values() {
        assert_eq!(sanitize_theme("custom"), "custom");
        assert_eq!(sanitize_theme("dark"), "dark");
    }

    #[test]
    fn sanitize_theme_preset_ids_fall_back_for_invalid_values() {
        assert_eq!(
            sanitize_light_theme_preset_id("vscode-dark-modern"),
            LIGHT_THEME_PRESET_MODERN
        );
        assert_eq!(
            sanitize_dark_theme_preset_id("vscode-light-modern"),
            DARK_THEME_PRESET_MODERN
        );
        assert_eq!(
            sanitize_theme_preset_id("invalid"),
            DARK_THEME_PRESET_MODERN
        );
    }

    #[test]
    fn sanitize_theme_preset_ids_keep_supported_values() {
        assert_eq!(
            sanitize_light_theme_preset_id(LIGHT_THEME_PRESET_PLUS),
            LIGHT_THEME_PRESET_PLUS
        );
        assert_eq!(
            sanitize_light_theme_preset_id(LIGHT_THEME_PRESET_GITHUB),
            LIGHT_THEME_PRESET_GITHUB
        );
        assert_eq!(
            sanitize_light_theme_preset_id(LIGHT_THEME_PRESET_SOLARIZED),
            LIGHT_THEME_PRESET_SOLARIZED
        );
        assert_eq!(
            sanitize_dark_theme_preset_id(DARK_THEME_PRESET_PLUS),
            DARK_THEME_PRESET_PLUS
        );
        assert_eq!(
            sanitize_dark_theme_preset_id(DARK_THEME_PRESET_GITHUB),
            DARK_THEME_PRESET_GITHUB
        );
        assert_eq!(
            sanitize_dark_theme_preset_id(DARK_THEME_PRESET_GITHUB_DIMMED),
            DARK_THEME_PRESET_GITHUB_DIMMED
        );
        assert_eq!(
            sanitize_dark_theme_preset_id(DARK_THEME_PRESET_ONE_DARK_PRO),
            DARK_THEME_PRESET_ONE_DARK_PRO
        );
        assert_eq!(
            sanitize_dark_theme_preset_id(DARK_THEME_PRESET_MONOKAI),
            DARK_THEME_PRESET_MONOKAI
        );
        assert_eq!(
            sanitize_dark_theme_preset_id(DARK_THEME_PRESET_SOLARIZED),
            DARK_THEME_PRESET_SOLARIZED
        );
        assert_eq!(
            sanitize_theme_preset_id(LIGHT_THEME_PRESET_GITHUB),
            LIGHT_THEME_PRESET_GITHUB
        );
    }

    #[test]
    fn resolve_window_theme_preference_maps_custom_to_preset_appearance() {
        let mut settings = AppSettings::default();
        settings.theme = "custom".to_string();
        settings.custom_theme_preset_id = LIGHT_THEME_PRESET_GITHUB.to_string();
        assert_eq!(resolve_window_theme_preference(&settings), "light");

        settings.custom_theme_preset_id = DARK_THEME_PRESET_ONE_DARK_PRO.to_string();
        assert_eq!(resolve_window_theme_preference(&settings), "dark");
    }

    #[test]
    fn validate_ui_scale_rejects_invalid_values() {
        assert!(validate_ui_scale(0.7).is_err());
        assert!(validate_ui_scale(2.7).is_err());
        assert!(validate_ui_scale(f64::NAN).is_err());
    }

    #[test]
    fn app_settings_change_requires_restart_when_proxy_changes() {
        let previous = AppSettings::default();
        let mut updated = previous.clone();
        updated.system_proxy_enabled = !previous.system_proxy_enabled;

        assert!(app_settings_change_requires_codex_restart(
            &previous, &updated
        ));
    }

    #[test]
    fn app_settings_change_requires_restart_when_unified_exec_policy_changes() {
        let previous = AppSettings::default();
        let mut updated = previous.clone();
        updated.codex_unified_exec_policy = CodexUnifiedExecPolicy::ForceEnabled;

        assert!(app_settings_change_requires_codex_restart(
            &previous, &updated
        ));
    }

    #[test]
    fn app_settings_change_requires_restart_when_auto_compaction_threshold_changes() {
        let previous = AppSettings::default();
        let mut updated = previous.clone();
        updated.codex_auto_compaction_threshold_percent = 120;

        assert!(app_settings_change_requires_codex_restart(
            &previous, &updated
        ));
    }

    #[test]
    fn app_settings_change_requires_restart_when_auto_compaction_enabled_changes() {
        let previous = AppSettings::default();
        let mut updated = previous.clone();
        updated.codex_auto_compaction_enabled = false;

        assert!(app_settings_change_requires_codex_restart(
            &previous, &updated
        ));
    }

    #[test]
    fn app_settings_change_skips_restart_for_unrelated_fields() {
        let previous = AppSettings::default();
        let mut updated = previous.clone();
        updated.theme = "dark".to_string();

        assert!(!app_settings_change_requires_codex_restart(
            &previous, &updated
        ));
    }

    #[tokio::test]
    async fn get_app_settings_core_sanitizes_terminal_shell_path() {
        let mut settings = AppSettings::default();
        settings.terminal_shell_path =
            Some("  C:\\Program Files\\PowerShell\\7\\pwsh.exe  ".to_string());

        let resolved = get_app_settings_core(&Mutex::new(settings)).await;

        assert_eq!(
            resolved.terminal_shell_path.as_deref(),
            Some("C:\\Program Files\\PowerShell\\7\\pwsh.exe")
        );

        let mut blank_settings = AppSettings::default();
        blank_settings.terminal_shell_path = Some("   ".to_string());

        let resolved_blank = get_app_settings_core(&Mutex::new(blank_settings)).await;

        assert_eq!(resolved_blank.terminal_shell_path, None);
    }

    #[tokio::test]
    async fn get_app_settings_core_ignores_external_unified_exec_override() {
        let _guard = ENV_LOCK.lock().unwrap();
        let codex_home =
            env::temp_dir().join(format!("ccgui-settings-core-{}", std::process::id()));
        let _ = fs::remove_dir_all(&codex_home);
        fs::create_dir_all(&codex_home).unwrap();
        fs::write(
            codex_home.join("config.toml"),
            "[features]\ncollab = true\ncollaboration_modes = false\nsteer = true\ncollaboration_mode_enforcement = false\nunified_exec = true\n",
        )
        .unwrap();
        let _codex_home_guard = CodexHomeTestGuard::new(&codex_home);

        let mut settings = AppSettings::default();
        settings.experimental_collab_enabled = true;
        settings.experimental_collaboration_modes_enabled = true;
        settings.experimental_steer_enabled = false;
        settings.codex_mode_enforcement_enabled = true;
        settings.codex_unified_exec_policy = CodexUnifiedExecPolicy::Inherit;

        let resolved = get_app_settings_core(&Mutex::new(settings)).await;

        assert!(!resolved.experimental_collab_enabled);
        assert!(resolved.experimental_collaboration_modes_enabled);
        assert!(!resolved.experimental_steer_enabled);
        assert!(resolved.codex_mode_enforcement_enabled);
        assert_eq!(
            resolved.codex_unified_exec_policy,
            CodexUnifiedExecPolicy::Inherit
        );
    }

    #[tokio::test]
    async fn update_app_settings_core_stops_syncing_unified_exec_to_external_config() {
        let _guard = ENV_LOCK.lock().unwrap();
        let test_root =
            env::temp_dir().join(format!("ccgui-settings-core-update-{}", std::process::id()));
        let _ = fs::remove_dir_all(&test_root);
        fs::create_dir_all(&test_root).unwrap();
        let codex_home = test_root.join("codex-home");
        fs::create_dir_all(&codex_home).unwrap();
        let settings_path = test_root.join("settings.json");
        let _codex_home_guard = CodexHomeTestGuard::new(&codex_home);

        let mut settings = AppSettings::default();
        settings.experimental_collab_enabled = true;
        settings.experimental_collaboration_modes_enabled = true;
        settings.experimental_steer_enabled = true;
        settings.codex_mode_enforcement_enabled = false;
        settings.codex_unified_exec_policy = CodexUnifiedExecPolicy::ForceEnabled;

        let result = update_app_settings_core(
            settings,
            &Mutex::new(AppSettings::default()),
            &settings_path,
        )
        .await
        .unwrap();

        assert!(!result.experimental_collab_enabled);
        assert!(!codex_home.join("config.toml").exists());
        let _ = fs::remove_dir_all(&test_root);
    }

    #[tokio::test]
    async fn get_app_settings_core_resets_legacy_unified_exec_true_to_inherit() {
        let mut settings = AppSettings::default();
        settings.experimental_unified_exec_enabled = Some(true);

        let resolved = get_app_settings_core(&Mutex::new(settings)).await;

        assert_eq!(
            resolved.codex_unified_exec_policy,
            CodexUnifiedExecPolicy::Inherit
        );
        assert_eq!(resolved.experimental_unified_exec_enabled, None);
    }

    #[test]
    fn unified_exec_external_status_reports_explicit_override() {
        let _guard = ENV_LOCK.lock().unwrap();
        let codex_home =
            env::temp_dir().join(format!("ccgui-settings-core-status-{}", std::process::id()));
        let _ = fs::remove_dir_all(&codex_home);
        fs::create_dir_all(&codex_home).unwrap();
        fs::write(
            codex_home.join("config.toml"),
            "[features]\nunified_exec = false\n",
        )
        .unwrap();
        let _codex_home_guard = CodexHomeTestGuard::new(&codex_home);

        let status = get_codex_unified_exec_external_status_core().unwrap();

        assert!(status.has_explicit_unified_exec);
        assert_eq!(status.explicit_unified_exec_value, Some(false));
        assert_eq!(status.official_default_enabled, !cfg!(windows));
    }

    #[test]
    fn restore_codex_unified_exec_official_default_removes_override() {
        let _guard = ENV_LOCK.lock().unwrap();
        let codex_home =
            env::temp_dir().join(format!("ccgui-settings-core-repair-{}", std::process::id()));
        let _ = fs::remove_dir_all(&codex_home);
        fs::create_dir_all(&codex_home).unwrap();
        fs::write(
            codex_home.join("config.toml"),
            "[features]\nunified_exec = true\nsteer = false\n",
        )
        .unwrap();
        let _codex_home_guard = CodexHomeTestGuard::new(&codex_home);

        let status = restore_codex_unified_exec_official_default_core().unwrap();
        let config_contents = fs::read_to_string(codex_home.join("config.toml")).unwrap();

        assert!(!status.has_explicit_unified_exec);
        assert_eq!(status.explicit_unified_exec_value, None);
        assert!(!config_contents.contains("unified_exec ="));
        assert!(config_contents.contains("steer = false"));
    }

    #[test]
    fn set_codex_unified_exec_official_override_writes_explicit_value() {
        let _guard = ENV_LOCK.lock().unwrap();
        let codex_home =
            env::temp_dir().join(format!("ccgui-settings-core-set-{}", std::process::id()));
        let _ = fs::remove_dir_all(&codex_home);
        fs::create_dir_all(&codex_home).unwrap();
        let _codex_home_guard = CodexHomeTestGuard::new(&codex_home);

        let status = set_codex_unified_exec_official_override_core(true).unwrap();
        let config_contents = fs::read_to_string(codex_home.join("config.toml")).unwrap();

        assert!(status.has_explicit_unified_exec);
        assert_eq!(status.explicit_unified_exec_value, Some(true));
        assert!(config_contents.contains("unified_exec = true"));
    }
}
