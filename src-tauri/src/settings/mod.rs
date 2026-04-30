use std::collections::HashMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{Manager, State, Window};

use crate::codex::args::resolve_workspace_codex_args;
use crate::codex::home::resolve_workspace_codex_home;
use crate::event_sink::TauriEventSink;
use crate::remote_backend;
use crate::shared::settings_core::{
    app_settings_change_requires_codex_restart, get_app_settings_core, get_codex_config_path_core,
    get_codex_unified_exec_external_status_core, resolve_window_theme_preference,
    restart_codex_sessions_for_app_settings_change_core, restore_app_settings_core,
    restore_codex_unified_exec_official_default_core,
    set_codex_unified_exec_official_override_core, update_app_settings_core,
};
use crate::state::AppState;
use crate::types::{AppSettings, CodexUnifiedExecExternalStatus, WorkspaceEntry};
use crate::window;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexRuntimeReloadResult {
    status: String,
    stage: String,
    restarted_sessions: usize,
    message: Option<String>,
}

async fn spawn_reloaded_codex_sessions(
    state: &AppState,
    window: &Window,
) -> Result<Vec<(String, Arc<crate::backend::app_server::WorkspaceSession>)>, String> {
    let (connected_entries, workspace_index): (
        Vec<WorkspaceEntry>,
        HashMap<String, WorkspaceEntry>,
    ) = {
        let workspaces = state.workspaces.lock().await;
        let sessions = state.sessions.lock().await;
        let connected_entries = workspaces
            .values()
            .filter(|entry| sessions.contains_key(&entry.id))
            .cloned()
            .collect::<Vec<_>>();
        (connected_entries, workspaces.clone())
    };
    if connected_entries.is_empty() {
        return Ok(Vec::new());
    }
    let app_settings_snapshot = state.app_settings.lock().await.clone();
    let auto_compaction_enabled = app_settings_snapshot.codex_auto_compaction_enabled;
    let mut staged_sessions: Vec<(String, Arc<crate::backend::app_server::WorkspaceSession>)> =
        Vec::new();

    for entry in connected_entries {
        let parent_entry = entry
            .parent_id
            .as_ref()
            .and_then(|parent_id| workspace_index.get(parent_id))
            .cloned();
        let default_bin = app_settings_snapshot.codex_bin.clone();
        let codex_args = resolve_workspace_codex_args(
            &entry,
            parent_entry.as_ref(),
            Some(&app_settings_snapshot),
        );
        let codex_home = resolve_workspace_codex_home(&entry, parent_entry.as_ref());
        let new_session = match crate::backend::app_server::spawn_workspace_session_with_auto_compaction_threshold(
            entry.clone(),
            default_bin,
            codex_args,
            codex_home,
            env!("CARGO_PKG_VERSION").to_string(),
            f64::from(app_settings_snapshot.codex_auto_compaction_threshold_percent),
            auto_compaction_enabled,
            TauriEventSink::new(window.app_handle().clone()),
        )
        .await
        {
            Ok(session) => session,
            Err(error) => {
                for (_, staged_session) in staged_sessions {
                    let _ = crate::runtime::terminate_workspace_session_with_source(
                        staged_session,
                        None,
                        crate::backend::app_server::RuntimeShutdownSource::SettingsRestart,
                    )
                    .await;
                }
                return Err(format!("spawn workspace {} failed: {error}", entry.id));
            }
        };
        staged_sessions.push((entry.id.clone(), new_session));
    }

    Ok(staged_sessions)
}

#[tauri::command]
pub(crate) async fn get_app_settings(
    state: State<'_, AppState>,
    window: Window,
) -> Result<AppSettings, String> {
    let settings = get_app_settings_core(&state.app_settings).await;
    let window_theme = resolve_window_theme_preference(&settings);
    let _ = window::apply_window_appearance(&window, window_theme.as_str());
    Ok(settings)
}

#[tauri::command]
pub(crate) async fn update_app_settings(
    settings: AppSettings,
    state: State<'_, AppState>,
    window: Window,
) -> Result<AppSettings, String> {
    let previous = state.app_settings.lock().await.clone();
    let updated =
        update_app_settings_core(settings, &state.app_settings, &state.settings_path).await?;
    if app_settings_change_requires_codex_restart(&previous, &updated) {
        let auto_compaction_threshold_percent =
            f64::from(updated.codex_auto_compaction_threshold_percent);
        let auto_compaction_enabled = updated.codex_auto_compaction_enabled;
        if let Err(error) = restart_codex_sessions_for_app_settings_change_core(
            &state.workspaces,
            &state.sessions,
            &state.app_settings,
            Some(&state.runtime_manager),
            |entry, default_bin, codex_args, codex_home| {
                crate::backend::app_server::spawn_workspace_session_with_auto_compaction_threshold(
                    entry,
                    default_bin,
                    codex_args,
                    codex_home,
                    env!("CARGO_PKG_VERSION").to_string(),
                    auto_compaction_threshold_percent,
                    auto_compaction_enabled,
                    crate::event_sink::TauriEventSink::new(window.app_handle().clone()),
                )
            },
        )
        .await
        {
            let rollback_error =
                restore_app_settings_core(&previous, &state.app_settings, &state.settings_path)
                    .await
                    .err();
            let message = match rollback_error {
                Some(rollback_error) => {
                    format!("{error} (rollback failed: {rollback_error})")
                }
                None => error,
            };
            return Err(message);
        }
    }
    let window_theme = resolve_window_theme_preference(&updated);
    let _ = window::apply_window_appearance(&window, window_theme.as_str());
    Ok(updated)
}

#[tauri::command]
pub(crate) async fn get_codex_config_path() -> Result<String, String> {
    get_codex_config_path_core()
}

#[tauri::command]
pub(crate) async fn get_codex_unified_exec_external_status(
) -> Result<CodexUnifiedExecExternalStatus, String> {
    get_codex_unified_exec_external_status_core()
}

#[tauri::command]
pub(crate) async fn restore_codex_unified_exec_official_default(
) -> Result<CodexUnifiedExecExternalStatus, String> {
    restore_codex_unified_exec_official_default_core()
}

#[tauri::command]
pub(crate) async fn set_codex_unified_exec_official_override(
    enabled: bool,
) -> Result<CodexUnifiedExecExternalStatus, String> {
    set_codex_unified_exec_official_override_core(enabled)
}

#[tauri::command]
pub(crate) async fn reload_codex_runtime_config(
    state: State<'_, AppState>,
    window: Window,
) -> Result<CodexRuntimeReloadResult, String> {
    if remote_backend::is_remote_mode(&*state).await {
        let response = remote_backend::call_remote(
            &*state,
            window.app_handle().clone(),
            "reload_codex_runtime_config",
            json!({}),
        )
        .await?;
        return serde_json::from_value(response).map_err(|err| err.to_string());
    }

    let _reload_guard = state.codex_runtime_reload_lock.lock().await;
    let staged_sessions = spawn_reloaded_codex_sessions(&state, &window).await?;
    if staged_sessions.is_empty() {
        return Ok(CodexRuntimeReloadResult {
            status: "applied".to_string(),
            stage: "noop".to_string(),
            restarted_sessions: 0,
            message: Some("No connected Codex sessions to reload.".to_string()),
        });
    }

    let restarted_sessions = staged_sessions.len();
    for (workspace_id, new_session) in staged_sessions {
        crate::runtime::replace_workspace_session_with_source(
            &state.sessions,
            Some(&state.runtime_manager),
            workspace_id,
            new_session,
            "reload-runtime-config",
            crate::backend::app_server::RuntimeShutdownSource::SettingsRestart,
        )
        .await?;
    }

    Ok(CodexRuntimeReloadResult {
        status: "applied".to_string(),
        stage: "swapped".to_string(),
        restarted_sessions,
        message: None,
    })
}
