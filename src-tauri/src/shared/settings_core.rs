use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::Mutex;

use crate::codex::config as codex_config;
use crate::shared::proxy_core;
use crate::storage::write_settings;
use crate::types::AppSettings;

const UI_SCALE_MIN: f64 = 0.8;
const UI_SCALE_MAX: f64 = 2.6;
const UI_SCALE_DEFAULT: f64 = 1.0;
const CANVAS_WIDTH_MODE_NARROW: &str = "narrow";
const CANVAS_WIDTH_MODE_WIDE: &str = "wide";
const LAYOUT_MODE_DEFAULT: &str = "default";
const LAYOUT_MODE_SWAPPED: &str = "swapped";

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

fn sync_codex_config_flags(settings: &AppSettings) {
    let _ = codex_config::write_unified_exec_enabled(settings.experimental_unified_exec_enabled);
}

pub(crate) async fn get_app_settings_core(app_settings: &Mutex<AppSettings>) -> AppSettings {
    let mut settings = app_settings.lock().await.clone();
    settings.sanitize_runtime_pool_settings();
    settings.experimental_collab_enabled = false;
    if let Ok(Some(unified_exec_enabled)) = codex_config::read_unified_exec_enabled() {
        settings.experimental_unified_exec_enabled = unified_exec_enabled;
    }
    settings.ui_scale = sanitize_ui_scale(settings.ui_scale);
    settings.canvas_width_mode = sanitize_canvas_width_mode(&settings.canvas_width_mode);
    settings.layout_mode = sanitize_layout_mode(&settings.layout_mode);
    settings
}

pub(crate) async fn update_app_settings_core(
    settings: AppSettings,
    app_settings: &Mutex<AppSettings>,
    settings_path: &PathBuf,
) -> Result<AppSettings, String> {
    let mut normalized = settings;
    normalized.experimental_collab_enabled = false;
    normalized.sanitize_runtime_pool_settings();
    normalized.canvas_width_mode = sanitize_canvas_width_mode(&normalized.canvas_width_mode);
    normalized.layout_mode = sanitize_layout_mode(&normalized.layout_mode);
    validate_ui_scale(normalized.ui_scale)?;
    proxy_core::validate_proxy_settings(&normalized)?;
    sync_codex_config_flags(&normalized);
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
    normalized.experimental_collab_enabled = false;
    sync_codex_config_flags(&normalized);
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

pub(crate) fn get_codex_config_path_core() -> Result<String, String> {
    codex_config::config_toml_path()
        .ok_or_else(|| "Unable to resolve CODEX_HOME".to_string())
        .and_then(|path| {
            path.to_str()
                .map(|value| value.to_string())
                .ok_or_else(|| "Unable to resolve CODEX_HOME".to_string())
        })
}

#[cfg(test)]
mod tests {
    use std::env;
    use std::fs;
    use std::path::Path;
    use std::sync::Mutex as StdMutex;

    use super::{
        get_app_settings_core, sanitize_canvas_width_mode, sanitize_layout_mode,
        sanitize_ui_scale, update_app_settings_core, validate_ui_scale, UI_SCALE_DEFAULT,
    };
    use crate::types::AppSettings;
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
    fn validate_ui_scale_rejects_invalid_values() {
        assert!(validate_ui_scale(0.7).is_err());
        assert!(validate_ui_scale(2.7).is_err());
        assert!(validate_ui_scale(f64::NAN).is_err());
    }

    #[tokio::test]
    async fn get_app_settings_core_ignores_private_external_feature_flags() {
        let _guard = ENV_LOCK.lock().unwrap();
        let codex_home = env::temp_dir().join(format!(
            "mossx-settings-core-{}",
            std::process::id()
        ));
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
        settings.experimental_unified_exec_enabled = false;

        let resolved = get_app_settings_core(&Mutex::new(settings)).await;

        assert!(!resolved.experimental_collab_enabled);
        assert!(resolved.experimental_collaboration_modes_enabled);
        assert!(!resolved.experimental_steer_enabled);
        assert!(resolved.codex_mode_enforcement_enabled);
        assert!(resolved.experimental_unified_exec_enabled);
    }

    #[tokio::test]
    async fn update_app_settings_core_only_syncs_unified_exec_to_external_config() {
        let _guard = ENV_LOCK.lock().unwrap();
        let test_root = env::temp_dir().join(format!(
            "mossx-settings-core-update-{}",
            std::process::id()
        ));
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
        settings.experimental_unified_exec_enabled = true;

        let result =
            update_app_settings_core(settings, &Mutex::new(AppSettings::default()), &settings_path)
                .await
                .unwrap();
        let config_contents = fs::read_to_string(codex_home.join("config.toml")).unwrap();

        assert!(!result.experimental_collab_enabled);
        assert!(config_contents.contains("unified_exec = true"));
        assert!(!config_contents.contains("collab ="));
        assert!(!config_contents.contains("collaboration_modes ="));
        assert!(!config_contents.contains("steer ="));
        assert!(!config_contents.contains("collaboration_mode_enforcement ="));
        let _ = fs::remove_dir_all(&test_root);
    }
}
