use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc;
use tokio::time::timeout;

pub(crate) mod args;
pub(crate) mod collaboration_policy;
mod commit_message;
pub(crate) mod config;
mod doctor;
pub(crate) mod home;
mod mcp_config;
mod model_selection;
pub(crate) mod rewind;
mod run_metadata;
mod session_runtime;
mod thread_listing;
pub(crate) mod thread_mode_state;

use self::args::resolve_workspace_codex_args;
use self::commit_message::build_commit_message_prompt;
pub(crate) use self::doctor::{run_claude_doctor_with_settings, run_codex_doctor_with_settings};
pub(crate) use self::home::resolve_workspace_codex_home;
use self::mcp_config::{
    list_global_mcp_servers as list_global_mcp_servers_impl, GlobalMcpServerEntry,
};
use self::model_selection::{normalize_model_id, pick_model_from_model_list_response};
use self::run_metadata::{extract_json_value, sanitize_run_worktree_name};
use self::thread_listing::{build_unified_codex_thread_page, resolve_workspace_fallback_model};
use crate::backend::app_server::spawn_workspace_session as spawn_workspace_session_inner;
pub(crate) use crate::backend::app_server::{ResumePendingSource, WorkspaceSession};
use crate::backend::events::AppServerEvent;
use crate::engine::SendMessageParams;
use crate::event_sink::TauriEventSink;
use crate::local_usage;
use crate::remote_backend;
use crate::shared::workspaces_core::disconnect_workspace_session_core;
use crate::shared::{codex_core, thread_titles_core};
use crate::state::AppState;
use crate::types::WorkspaceEntry;

pub(crate) use self::session_runtime::ensure_codex_session;
pub(crate) use self::session_runtime::{
    create_session_runtime_recovering_error, is_stopping_runtime_race_error,
};

const DELETE_ARCHIVE_TIMEOUT_MS: u64 = 2_000;
const CLAUDE_MANUAL_COMPACT_TIMEOUT_SECS: u64 = 120;

async fn run_start_thread_with_retry<FEnsure, FEnsureFuture, FStart, FStartFuture>(
    workspace_id: &str,
    ensure_runtime: FEnsure,
    start_thread: FStart,
) -> Result<Value, String>
where
    FEnsure: Fn() -> FEnsureFuture,
    FEnsureFuture: std::future::Future<Output = Result<(), String>>,
    FStart: Fn() -> FStartFuture,
    FStartFuture: std::future::Future<Output = Result<Value, String>>,
{
    ensure_runtime().await?;
    let first_attempt = start_thread().await;
    match first_attempt {
        Ok(response) => Ok(response),
        Err(error) if is_stopping_runtime_race_error(&error) => {
            log::warn!(
                "[start_thread] retrying after stopping runtime race for workspace {}: {}",
                workspace_id,
                error
            );
            ensure_runtime().await?;
            match start_thread().await {
                Ok(response) => Ok(response),
                Err(retry_error) if is_stopping_runtime_race_error(&retry_error) => {
                    log::warn!(
                        "[start_thread] stopping runtime race retry exhausted for workspace {}: {}",
                        workspace_id,
                        retry_error
                    );
                    Err(create_session_runtime_recovering_error())
                }
                Err(retry_error) => Err(retry_error),
            }
        }
        Err(error) => Err(error),
    }
}

pub(crate) async fn start_thread_with_runtime_retry(
    workspace_id: &str,
    model: Option<String>,
    state: &AppState,
    app: &AppHandle,
) -> Result<Value, String> {
    let normalized_model = normalize_model_id(model);
    run_start_thread_with_retry(
        workspace_id,
        || ensure_codex_session(workspace_id, state, app),
        || {
            codex_core::start_thread_core(
                &state.sessions,
                workspace_id.to_string(),
                normalized_model.clone(),
            )
        },
    )
    .await
}

fn emit_manual_compaction_event(
    app: &AppHandle,
    workspace_id: String,
    method: &str,
    params: Value,
) {
    let _ = app.emit(
        "app-server-event",
        AppServerEvent {
            workspace_id,
            message: json!({
                "method": method,
                "params": params,
            }),
        },
    );
}

async fn compact_claude_thread(
    workspace_id: String,
    thread_id: String,
    state: &AppState,
    app: &AppHandle,
) -> Result<Value, String> {
    let session_id = thread_id
        .strip_prefix("claude:")
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("Claude thread id is invalid: {thread_id}"))?
        .to_string();

    let workspace_entry = {
        let workspaces = state.workspaces.lock().await;
        workspaces
            .get(&workspace_id)
            .cloned()
            .ok_or_else(|| "Workspace not found".to_string())?
    };
    let workspace_path = PathBuf::from(&workspace_entry.path);
    let session = state
        .engine_manager
        .get_claude_session(&workspace_id, &workspace_path)
        .await;

    emit_manual_compaction_event(
        app,
        workspace_id.clone(),
        "thread/compacting",
        json!({
            "threadId": &thread_id,
            "thread_id": &thread_id,
            "auto": false,
            "manual": true,
        }),
    );

    let turn_id = format!("claude-compact-{}", uuid::Uuid::new_v4());
    let params = SendMessageParams {
        text: "/compact".to_string(),
        images: None,
        continue_session: true,
        session_id: Some(session_id),
        ..Default::default()
    };

    let compact_result = timeout(
        Duration::from_secs(CLAUDE_MANUAL_COMPACT_TIMEOUT_SECS),
        session.send_message(params, &turn_id),
    )
    .await
    .map_err(|_| {
        format!(
            "Claude /compact timed out after {} seconds",
            CLAUDE_MANUAL_COMPACT_TIMEOUT_SECS
        )
    })?;

    match compact_result {
        Ok(result_text) => {
            emit_manual_compaction_event(
                app,
                workspace_id,
                "thread/compacted",
                json!({
                    "threadId": &thread_id,
                    "thread_id": &thread_id,
                    "turnId": &turn_id,
                    "turn_id": &turn_id,
                    "auto": false,
                    "manual": true,
                }),
            );
            Ok(json!({
                "threadId": &thread_id,
                "turnId": &turn_id,
                "text": result_text,
                "status": "completed",
                "engine": "claude",
            }))
        }
        Err(error) => {
            emit_manual_compaction_event(
                app,
                workspace_id,
                "thread/compactionFailed",
                json!({
                    "threadId": &thread_id,
                    "thread_id": &thread_id,
                    "auto": false,
                    "manual": true,
                    "reason": error,
                }),
            );
            Err(error)
        }
    }
}

pub(crate) async fn spawn_workspace_session(
    entry: WorkspaceEntry,
    default_codex_bin: Option<String>,
    codex_args: Option<String>,
    app_handle: AppHandle,
    codex_home: Option<PathBuf>,
) -> Result<Arc<WorkspaceSession>, String> {
    let client_version = app_handle.package_info().version.to_string();
    let event_sink = TauriEventSink::new(app_handle);
    spawn_workspace_session_inner(
        entry,
        default_codex_bin,
        codex_args,
        codex_home,
        client_version,
        event_sink,
    )
    .await
}

#[tauri::command]
pub(crate) async fn codex_doctor(
    codex_bin: Option<String>,
    codex_args: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        let codex_bin = codex_bin.map(remote_backend::normalize_path_for_remote);
        return remote_backend::call_remote(
            &*state,
            app,
            "codex_doctor",
            json!({ "codexBin": codex_bin, "codexArgs": codex_args }),
        )
        .await;
    }

    let settings = state.app_settings.lock().await.clone();
    run_codex_doctor_with_settings(codex_bin, codex_args, &settings).await
}

pub(crate) fn remote_claude_doctor_request(claude_bin: Option<String>) -> (&'static str, Value) {
    (
        "claude_doctor",
        json!({
            "claudeBin": claude_bin.map(remote_backend::normalize_path_for_remote),
        }),
    )
}

#[tauri::command]
pub(crate) async fn claude_doctor(
    claude_bin: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        let (method, params) = remote_claude_doctor_request(claude_bin);
        return remote_backend::call_remote(&*state, app, method, params).await;
    }

    let settings = state.app_settings.lock().await.clone();
    run_claude_doctor_with_settings(claude_bin, &settings).await
}

#[tauri::command]
pub(crate) async fn start_thread(
    workspace_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "start_thread",
            json!({ "workspaceId": workspace_id }),
        )
        .await;
    }

    let resolved_model = resolve_workspace_fallback_model(&state, &workspace_id).await;
    start_thread_with_runtime_retry(&workspace_id, resolved_model, &state, &app).await
}

#[tauri::command]
pub(crate) async fn resume_thread(
    workspace_id: String,
    thread_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "resume_thread",
            json!({ "workspaceId": workspace_id, "threadId": thread_id }),
        )
        .await;
    }

    // Ensure Codex session exists before resuming thread
    ensure_codex_session(&workspace_id, &state, &app).await?;

    codex_core::resume_thread_core(&state.sessions, workspace_id, thread_id).await
}

#[tauri::command]
pub(crate) async fn fork_thread(
    workspace_id: String,
    thread_id: String,
    message_id: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "fork_thread",
            json!({
                "workspaceId": workspace_id,
                "threadId": thread_id,
                "messageId": message_id
            }),
        )
        .await;
    }

    // Ensure Codex session exists before forking thread
    ensure_codex_session(&workspace_id, &state, &app).await?;
    codex_core::fork_thread_core(&state.sessions, workspace_id, thread_id, message_id).await
}

#[tauri::command]
pub(crate) async fn rewind_codex_thread(
    workspace_id: String,
    thread_id: String,
    message_id: Option<String>,
    target_user_turn_index: u32,
    target_user_message_text: Option<String>,
    target_user_message_occurrence: Option<u32>,
    local_user_message_count: Option<u32>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "rewind_codex_thread",
            json!({
                "workspaceId": workspace_id,
                "threadId": thread_id,
                "messageId": message_id,
                "targetUserTurnIndex": target_user_turn_index,
                "targetUserMessageText": target_user_message_text,
                "targetUserMessageOccurrence": target_user_message_occurrence,
                "localUserMessageCount": local_user_message_count
            }),
        )
        .await;
    }

    ensure_codex_session(&workspace_id, &state, &app).await?;
    let rewind_response = rewind::rewind_thread_from_message(
        &state.sessions,
        &state.workspaces,
        workspace_id.clone(),
        thread_id,
        message_id,
        target_user_turn_index,
        target_user_message_text,
        target_user_message_occurrence,
        local_user_message_count,
    )
    .await?;

    let rewound_thread_id = rewind_response
        .get("thread")
        .and_then(|thread| thread.get("id"))
        .or_else(|| rewind_response.get("threadId"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .ok_or_else(|| "codex rewind response missing child thread id".to_string())?;

    disconnect_workspace_session_core(&state.sessions, Some(&state.runtime_manager), &workspace_id)
        .await;
    ensure_codex_session(&workspace_id, &state, &app).await?;
    codex_core::resume_thread_core(&state.sessions, workspace_id, rewound_thread_id).await?;

    Ok(rewind_response)
}

#[tauri::command]
pub(crate) async fn list_threads(
    workspace_id: String,
    cursor: Option<String>,
    limit: Option<u32>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "list_threads",
            json!({ "workspaceId": workspace_id, "cursor": cursor, "limit": limit }),
        )
        .await;
    }

    let has_session = {
        let sessions = state.sessions.lock().await;
        sessions.contains_key(&workspace_id)
    };
    build_unified_codex_thread_page(&state, &workspace_id, cursor, limit, has_session).await
}

#[tauri::command]
pub(crate) async fn list_global_mcp_servers() -> Result<Vec<GlobalMcpServerEntry>, String> {
    list_global_mcp_servers_impl().await
}

#[tauri::command]
pub(crate) async fn list_mcp_server_status(
    workspace_id: String,
    cursor: Option<String>,
    limit: Option<u32>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "list_mcp_server_status",
            json!({ "workspaceId": workspace_id, "cursor": cursor, "limit": limit }),
        )
        .await;
    }

    codex_core::list_mcp_server_status_core(&state.sessions, workspace_id, cursor, limit).await
}

#[tauri::command]
pub(crate) async fn archive_thread(
    workspace_id: String,
    thread_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "archive_thread",
            json!({ "workspaceId": workspace_id, "threadId": thread_id }),
        )
        .await;
    }

    codex_core::archive_thread_core(&state.sessions, workspace_id, thread_id).await
}

#[tauri::command]
pub(crate) async fn delete_codex_session(
    workspace_id: String,
    session_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "delete_codex_session",
            json!({ "workspaceId": workspace_id, "sessionId": session_id }),
        )
        .await;
    }

    let normalized_session_id = session_id.trim().to_string();
    if normalized_session_id.is_empty() {
        return Err("session_id is required".to_string());
    }

    let archive_result = codex_core::archive_thread_best_effort_core(
        &state.sessions,
        workspace_id.clone(),
        normalized_session_id.clone(),
        Duration::from_millis(DELETE_ARCHIVE_TIMEOUT_MS),
    )
    .await;
    if let Err(error) = &archive_result {
        log::debug!(
            "[delete_codex_session] Best-effort archive skipped for workspace {} session {}: {}",
            workspace_id,
            normalized_session_id,
            error
        );
    }

    let deleted_count = local_usage::delete_codex_session_for_workspace(
        &state.workspaces,
        &workspace_id,
        &normalized_session_id,
    )
    .await?;

    let session = {
        let sessions = state.sessions.lock().await;
        sessions.get(&workspace_id).cloned()
    };
    if let Some(session) = session {
        session
            .clear_thread_effective_mode(&normalized_session_id)
            .await;
    }

    Ok(json!({
        "deleted": deleted_count > 0,
        "deletedCount": deleted_count,
        "method": "filesystem",
        "archivedBeforeDelete": archive_result.is_ok(),
    }))
}

#[tauri::command]
pub(crate) async fn delete_codex_sessions(
    workspace_id: String,
    session_ids: Vec<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "delete_codex_sessions",
            json!({ "workspaceId": workspace_id, "sessionIds": session_ids }),
        )
        .await;
    }

    let normalized_session_ids = session_ids
        .into_iter()
        .map(|session_id| session_id.trim().to_string())
        .filter(|session_id| !session_id.is_empty())
        .collect::<Vec<_>>();
    if normalized_session_ids.is_empty() {
        return Ok(json!({ "results": [] }));
    }

    for session_id in &normalized_session_ids {
        if session_id.contains('/') || session_id.contains('\\') || session_id.contains("..") {
            return Err("invalid session_id".to_string());
        }
    }

    let mut archive_results = HashMap::new();
    for session_id in &normalized_session_ids {
        let archive_result = codex_core::archive_thread_best_effort_core(
            &state.sessions,
            workspace_id.clone(),
            session_id.clone(),
            Duration::from_millis(DELETE_ARCHIVE_TIMEOUT_MS),
        )
        .await;
        if let Err(error) = &archive_result {
            log::debug!(
                "[delete_codex_sessions] Best-effort archive skipped for workspace {} session {}: {}",
                workspace_id,
                session_id,
                error
            );
        }
        archive_results.insert(session_id.clone(), archive_result.is_ok());
    }

    let delete_results = local_usage::delete_codex_sessions_for_workspace(
        &state.workspaces,
        &workspace_id,
        &normalized_session_ids,
    )
    .await?;

    let session = {
        let sessions = state.sessions.lock().await;
        sessions.get(&workspace_id).cloned()
    };
    if let Some(session) = session {
        for result in &delete_results {
            if result.deleted {
                session
                    .clear_thread_effective_mode(&result.session_id)
                    .await;
            }
        }
    }

    let serialized_results = delete_results
        .into_iter()
        .map(|result| {
            json!({
                "sessionId": result.session_id,
                "deleted": result.deleted,
                "deletedCount": result.deleted_count,
                "method": "filesystem",
                "archivedBeforeDelete": archive_results
                    .get(&result.session_id)
                    .copied()
                    .unwrap_or(false),
                "error": result.error,
            })
        })
        .collect::<Vec<_>>();

    Ok(json!({ "results": serialized_results }))
}

#[tauri::command]
pub(crate) async fn send_user_message(
    workspace_id: String,
    thread_id: String,
    text: String,
    model: Option<String>,
    effort: Option<String>,
    access_mode: Option<String>,
    images: Option<Vec<String>>,
    collaboration_mode: Option<Value>,
    preferred_language: Option<String>,
    custom_spec_root: Option<String>,
    resume_source: Option<String>,
    resume_turn_id: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let normalized_model = normalize_model_id(model);
    let selected_mode = collaboration_mode
        .as_ref()
        .and_then(|value| {
            if let Some(text) = value.as_str() {
                return Some(text.to_string());
            }
            value
                .as_object()
                .and_then(|object| object.get("mode").or_else(|| object.get("id")))
                .and_then(Value::as_str)
                .map(ToString::to_string)
        })
        .map(|mode| {
            let normalized = mode.trim().to_lowercase();
            if normalized == "default" {
                "code".to_string()
            } else {
                normalized
            }
        })
        .filter(|mode| mode == "plan" || mode == "code");

    if remote_backend::is_remote_mode(&*state).await {
        let images = images.map(|paths| {
            paths
                .into_iter()
                .map(remote_backend::normalize_path_for_remote)
                .collect::<Vec<_>>()
        });
        let mut payload = Map::new();
        payload.insert("workspaceId".to_string(), json!(workspace_id));
        payload.insert("threadId".to_string(), json!(thread_id));
        payload.insert("text".to_string(), json!(text));
        payload.insert("model".to_string(), json!(normalized_model));
        payload.insert("effort".to_string(), json!(effort));
        payload.insert("accessMode".to_string(), json!(access_mode));
        payload.insert("images".to_string(), json!(images));
        payload.insert("preferredLanguage".to_string(), json!(preferred_language));
        payload.insert("resumeSource".to_string(), json!(resume_source));
        payload.insert("resumeTurnId".to_string(), json!(resume_turn_id));
        if let Some(spec_root) = custom_spec_root.clone() {
            if !spec_root.trim().is_empty() {
                payload.insert("customSpecRoot".to_string(), json!(spec_root));
            }
        }
        if let Some(mode) = collaboration_mode {
            if !mode.is_null() {
                payload.insert("collaborationMode".to_string(), mode);
            }
        }
        return remote_backend::call_remote(
            &*state,
            app,
            "send_user_message",
            Value::Object(payload),
        )
        .await;
    }

    // Ensure Codex session exists before sending message
    // This handles the case where user switches from Claude to Codex engine
    ensure_codex_session(&workspace_id, &state, &app).await?;
    let effective_model = if normalized_model.is_some() {
        normalized_model
    } else {
        resolve_workspace_fallback_model(&state, &workspace_id).await
    };
    let mode_enforcement_enabled = {
        let settings = state.app_settings.lock().await;
        settings.codex_mode_enforcement_enabled
    };

    let response = codex_core::send_user_message_core(
        &state.sessions,
        workspace_id.clone(),
        thread_id.clone(),
        text,
        effective_model,
        effort,
        access_mode,
        images,
        collaboration_mode,
        preferred_language,
        custom_spec_root,
        mode_enforcement_enabled,
    )
    .await?;

    if resume_source.as_deref() == Some("queue-fusion-cutover") {
        let session = {
            let sessions = state.sessions.lock().await;
            sessions.get(&workspace_id).cloned()
        };
        if let Some(session) = session {
            session
                .start_resume_pending_watch(
                    app.clone(),
                    thread_id.clone(),
                    None,
                    ResumePendingSource::QueueFusionCutover {
                        previous_turn_id: resume_turn_id
                            .map(|value| value.trim().to_string())
                            .filter(|value| !value.is_empty()),
                    },
                )
                .await;
        }
    }

    let session = {
        let sessions = state.sessions.lock().await;
        sessions.get(&workspace_id).cloned()
    };
    let (effective_runtime_mode, fallback_reason) = if let Some(session) = session {
        let runtime_mode = session
            .get_thread_effective_mode(&thread_id)
            .await
            .unwrap_or_else(|| "code".to_string());
        let fallback_reason = if selected_mode.is_some() && !session.collaboration_mode_supported()
        {
            Some("collaboration_mode_capability_unsupported_prompt_fallback")
        } else {
            None
        };
        (runtime_mode, fallback_reason)
    } else {
        ("code".to_string(), None)
    };
    let effective_ui_mode = if effective_runtime_mode == "plan" {
        "plan"
    } else {
        "default"
    };
    let selected_ui_mode = match selected_mode.as_deref() {
        Some("plan") => "plan",
        Some("code") => "default",
        _ => effective_ui_mode,
    };
    let _ = app.emit(
        "app-server-event",
        AppServerEvent {
            workspace_id: workspace_id.clone(),
            message: json!({
                "method": "collaboration/modeResolved",
                "params": {
                    "threadId": thread_id.clone(),
                    "thread_id": thread_id,
                    "selectedUiMode": selected_ui_mode,
                    "selected_ui_mode": selected_ui_mode,
                    "effectiveRuntimeMode": effective_runtime_mode.clone(),
                    "effective_runtime_mode": effective_runtime_mode,
                    "effectiveUiMode": effective_ui_mode,
                    "effective_ui_mode": effective_ui_mode,
                    "fallbackReason": fallback_reason,
                    "fallback_reason": fallback_reason
                }
            }),
        },
    );

    Ok(response)
}

#[tauri::command]
pub(crate) async fn collaboration_mode_list(
    workspace_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "collaboration_mode_list",
            json!({ "workspaceId": workspace_id }),
        )
        .await;
    }

    // Ensure Codex session exists before fetching collaboration modes
    ensure_codex_session(&workspace_id, &state, &app).await?;

    codex_core::collaboration_mode_list_core(&state.sessions, workspace_id).await
}

#[tauri::command]
pub(crate) async fn turn_interrupt(
    workspace_id: String,
    thread_id: String,
    turn_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "turn_interrupt",
            json!({ "workspaceId": workspace_id, "threadId": thread_id, "turnId": turn_id }),
        )
        .await;
    }

    codex_core::turn_interrupt_core(&state.sessions, workspace_id, thread_id, turn_id).await
}

#[tauri::command]
pub(crate) async fn thread_compact(
    workspace_id: String,
    thread_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let normalized_thread_id = thread_id.trim().to_string();
    if normalized_thread_id.is_empty() {
        return Err("thread_id is required".to_string());
    }

    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "thread_compact",
            json!({ "workspaceId": workspace_id, "threadId": normalized_thread_id }),
        )
        .await;
    }

    if normalized_thread_id.starts_with("claude:") {
        return compact_claude_thread(workspace_id, normalized_thread_id, &state, &app).await;
    }

    ensure_codex_session(&workspace_id, &state, &app).await?;
    let _ = app.emit(
        "app-server-event",
        AppServerEvent {
            workspace_id: workspace_id.clone(),
            message: json!({
                "method": "thread/compacting",
                "params": {
                    "threadId": normalized_thread_id,
                    "thread_id": normalized_thread_id,
                    "auto": false,
                    "manual": true
                }
            }),
        },
    );

    match codex_core::thread_compact_core(
        &state.sessions,
        workspace_id.clone(),
        normalized_thread_id.clone(),
    )
    .await
    {
        Ok(result) => Ok(result),
        Err(error) => {
            let _ = app.emit(
                "app-server-event",
                AppServerEvent {
                    workspace_id,
                    message: json!({
                        "method": "thread/compactionFailed",
                        "params": {
                            "threadId": normalized_thread_id,
                            "thread_id": normalized_thread_id,
                            "auto": false,
                            "manual": true,
                            "reason": error
                        }
                    }),
                },
            );
            Err(error)
        }
    }
}

#[tauri::command]
pub(crate) async fn start_review(
    workspace_id: String,
    thread_id: String,
    target: Value,
    delivery: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "start_review",
            json!({
                "workspaceId": workspace_id,
                "threadId": thread_id,
                "target": target,
                "delivery": delivery,
            }),
        )
        .await;
    }

    codex_core::start_review_core(&state.sessions, workspace_id, thread_id, target, delivery).await
}

#[tauri::command]
pub(crate) async fn model_list(
    workspace_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "model_list",
            json!({ "workspaceId": workspace_id }),
        )
        .await;
    }

    // Ensure Codex session exists before fetching model list
    ensure_codex_session(&workspace_id, &state, &app).await?;

    codex_core::model_list_core(&state.sessions, workspace_id).await
}

#[tauri::command]
pub(crate) async fn account_rate_limits(
    workspace_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "account_rate_limits",
            json!({ "workspaceId": workspace_id }),
        )
        .await;
    }

    // Ensure Codex session exists before fetching rate limits
    ensure_codex_session(&workspace_id, &state, &app).await?;

    codex_core::account_rate_limits_core(&state.sessions, workspace_id).await
}

#[tauri::command]
pub(crate) async fn account_read(
    workspace_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "account_read",
            json!({ "workspaceId": workspace_id }),
        )
        .await;
    }

    codex_core::account_read_core(&state.sessions, &state.workspaces, workspace_id).await
}

#[tauri::command]
pub(crate) async fn codex_login(
    workspace_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "codex_login",
            json!({ "workspaceId": workspace_id }),
        )
        .await;
    }

    codex_core::codex_login_core(
        &state.workspaces,
        &state.app_settings,
        &state.codex_login_cancels,
        workspace_id,
    )
    .await
}

#[tauri::command]
pub(crate) async fn codex_login_cancel(
    workspace_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "codex_login_cancel",
            json!({ "workspaceId": workspace_id }),
        )
        .await;
    }

    codex_core::codex_login_cancel_core(&state.codex_login_cancels, workspace_id).await
}

#[tauri::command]
pub(crate) async fn skills_list(
    workspace_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "skills_list",
            json!({ "workspaceId": workspace_id }),
        )
        .await;
    }

    // Local mode: try local file scanning first
    match crate::skills::skills_list_local_for_workspace(&*state, &workspace_id).await {
        Ok(entries) => {
            let skills_json: Vec<Value> = entries
                .into_iter()
                .map(|entry| {
                    json!({
                        "name": entry.name,
                        "path": entry.path,
                        "source": entry.source,
                        "description": entry.description,
                        "enabled": true,
                    })
                })
                .collect();
            Ok(json!(skills_json))
        }
        Err(crate::skills::SkillScanError::WorkspaceNotFound(_)) => {
            Err("workspace not found".to_string())
        }
        Err(err) => {
            log::warn!(
                "Local skills scan failed for workspace {}: {}, falling back to Codex CLI",
                workspace_id,
                err
            );
            codex_core::skills_list_core(&state.sessions, workspace_id).await
        }
    }
}

#[tauri::command]
pub(crate) async fn respond_to_server_request(
    workspace_id: String,
    request_id: Value,
    result: Value,
    thread_id: Option<String>,
    turn_id: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    let is_user_input_response = result.get("answers").is_some();
    let normalized_thread_id = thread_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    let normalized_turn_id = turn_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    let is_local_plan_prompt = request_id
        .as_str()
        .map(|value| value.starts_with("ccgui-plan-"))
        .unwrap_or(false);
    if remote_backend::is_remote_mode(&*state).await {
        remote_backend::call_remote(
            &*state,
            app,
            "respond_to_server_request",
            json!({
                "workspaceId": workspace_id,
                "requestId": request_id,
                "result": result,
                "threadId": normalized_thread_id,
                "turnId": normalized_turn_id,
            }),
        )
        .await?;
        return Ok(());
    }

    // Prefer request-id based Claude routing so AskUserQuestion responses
    // are delivered to the correct waiting Claude turn even when global
    // active-engine state is stale.
    if let Some(session) = state
        .engine_manager
        .claude_manager
        .get_session(&workspace_id)
        .await
    {
        if session.has_pending_user_input(&request_id) {
            return session.respond_to_user_input(request_id, result).await;
        }
        if session.has_pending_approval_request(&request_id) {
            return session
                .respond_to_approval_request(request_id, result)
                .await;
        }
    }

    codex_core::respond_to_server_request_core(
        &state.sessions,
        workspace_id.clone(),
        request_id,
        result,
    )
    .await?;

    if is_user_input_response && !is_local_plan_prompt {
        if let Some(thread_id) = normalized_thread_id {
            let session = {
                let sessions = state.sessions.lock().await;
                sessions.get(&workspace_id).cloned()
            };
            if let Some(session) = session {
                session
                    .start_resume_pending_watch(
                        app,
                        thread_id,
                        normalized_turn_id,
                        ResumePendingSource::UserInputResume,
                    )
                    .await;
            }
        }
    }

    Ok(())
}

/// Gets the diff content for commit message generation
#[tauri::command]
pub(crate) async fn get_commit_message_prompt(
    workspace_id: String,
    language: Option<String>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    // Get the diff from git
    let diff = crate::git::get_workspace_diff(&workspace_id, &state).await?;

    if diff.trim().is_empty() {
        return Err("No changes to generate commit message for".to_string());
    }

    Ok(build_commit_message_prompt(&diff, language.as_deref()))
}

#[tauri::command]
pub(crate) async fn remember_approval_rule(
    workspace_id: String,
    command: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    codex_core::remember_approval_rule_core(&state.workspaces, workspace_id, command).await
}

#[tauri::command]
pub(crate) async fn get_config_model(
    workspace_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "get_config_model",
            json!({ "workspaceId": workspace_id }),
        )
        .await;
    }

    codex_core::get_config_model_core(&state.workspaces, workspace_id).await
}

/// Generates a commit message in the background without showing in the main chat
#[tauri::command]
pub(crate) async fn generate_commit_message(
    workspace_id: String,
    language: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<String, String> {
    // Get the diff from git
    let diff = crate::git::get_workspace_diff(&workspace_id, &state).await?;

    if diff.trim().is_empty() {
        return Err("No changes to generate commit message for".to_string());
    }

    let prompt = build_commit_message_prompt(&diff, language.as_deref());

    // Get the session – requires a running Codex CLI process
    let session = {
        let sessions = state.sessions.lock().await;
        match sessions.get(&workspace_id) {
            Some(s) => s.clone(),
            None => {
                // Check whether the workspace is using Claude engine (no session needed)
                let is_claude = {
                    let workspaces = state.workspaces.lock().await;
                    workspaces
                        .get(&workspace_id)
                        .map(|e| {
                            e.settings
                                .engine_type
                                .as_deref()
                                .map(|t| t.eq_ignore_ascii_case("claude"))
                                .unwrap_or(true)
                        })
                        .unwrap_or(false)
                };
                if is_claude {
                    return Err("AI commit message generation requires the Codex CLI. \
                         Please install it first: npm install -g @openai/codex"
                        .to_string());
                }
                return Err(
                    "Workspace not connected. Please ensure the Codex CLI is installed \
                     and reconnect the workspace."
                        .to_string(),
                );
            }
        }
    };

    // Create a background thread
    let thread_params = json!({
        "cwd": session.entry.path,
        "approvalPolicy": "never"  // Never ask for approval in background
    });
    let thread_result = session.send_request("thread/start", thread_params).await?;

    // Handle error response
    if let Some(error) = thread_result.get("error") {
        let error_msg = error
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("Unknown error starting thread");
        return Err(error_msg.to_string());
    }

    // Extract threadId - try multiple paths since response format may vary
    let thread_id = thread_result
        .get("result")
        .and_then(|r| r.get("threadId"))
        .or_else(|| {
            thread_result
                .get("result")
                .and_then(|r| r.get("thread"))
                .and_then(|t| t.get("id"))
        })
        .or_else(|| thread_result.get("threadId"))
        .or_else(|| thread_result.get("thread").and_then(|t| t.get("id")))
        .and_then(|t| t.as_str())
        .ok_or_else(|| {
            format!(
                "Failed to get threadId from thread/start response: {:?}",
                thread_result
            )
        })?
        .to_string();

    // Hide background helper threads from the sidebar, even if a thread/started event leaked.
    let _ = app.emit(
        "app-server-event",
        AppServerEvent {
            workspace_id: workspace_id.clone(),
            message: json!({
                "method": "codex/backgroundThread",
                "params": {
                    "threadId": thread_id,
                    "action": "hide"
                }
            }),
        },
    );

    // Create channel for receiving events
    let (tx, mut rx) = mpsc::unbounded_channel::<Value>();

    // Register callback for this thread
    {
        let mut callbacks = session.background_thread_callbacks.lock().await;
        callbacks.insert(thread_id.clone(), tx);
    }

    // Start a turn with the commit message prompt
    let turn_params = json!({
        "threadId": thread_id,
        "input": [{ "type": "text", "text": prompt }],
        "cwd": session.entry.path,
        "approvalPolicy": "never",
        "sandboxPolicy": { "type": "readOnly" },
    });
    let turn_result = session.send_request("turn/start", turn_params).await;
    let turn_result = match turn_result {
        Ok(result) => result,
        Err(error) => {
            // Clean up if turn fails to start
            {
                let mut callbacks = session.background_thread_callbacks.lock().await;
                callbacks.remove(&thread_id);
            }
            let archive_params = json!({ "threadId": thread_id.as_str() });
            let _ = session.send_request("thread/archive", archive_params).await;
            return Err(error);
        }
    };

    if let Some(error) = turn_result.get("error") {
        let error_msg = error
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("Unknown error starting turn");
        {
            let mut callbacks = session.background_thread_callbacks.lock().await;
            callbacks.remove(&thread_id);
        }
        let archive_params = json!({ "threadId": thread_id.as_str() });
        let _ = session.send_request("thread/archive", archive_params).await;
        return Err(error_msg.to_string());
    }

    // Collect assistant text from events
    let mut commit_message = String::new();
    let timeout_duration = Duration::from_secs(60);
    let collect_result = timeout(timeout_duration, async {
        while let Some(event) = rx.recv().await {
            let method = event.get("method").and_then(|m| m.as_str()).unwrap_or("");

            match method {
                "item/agentMessage/delta" => {
                    // Extract text delta from agent messages
                    if let Some(params) = event.get("params") {
                        if let Some(delta) = params.get("delta").and_then(|d| d.as_str()) {
                            commit_message.push_str(delta);
                        }
                    }
                }
                "turn/completed" => {
                    // Turn completed, we can stop listening
                    break;
                }
                "turn/error" => {
                    // Error occurred
                    let error_msg = event
                        .get("params")
                        .and_then(|p| p.get("error"))
                        .and_then(|e| e.as_str())
                        .unwrap_or("Unknown error during commit message generation");
                    return Err(error_msg.to_string());
                }
                _ => {
                    // Ignore other events (turn/started, item/started, item/completed, reasoning events, etc.)
                }
            }
        }
        Ok(())
    })
    .await;

    // Unregister callback
    {
        let mut callbacks = session.background_thread_callbacks.lock().await;
        callbacks.remove(&thread_id);
    }

    // Archive the thread to clean up
    let archive_params = json!({ "threadId": thread_id });
    let _ = session.send_request("thread/archive", archive_params).await;

    // Handle timeout or collection error
    match collect_result {
        Ok(Ok(())) => {}
        Ok(Err(e)) => return Err(e),
        Err(_) => return Err("Timeout waiting for commit message generation".to_string()),
    }

    let trimmed = commit_message.trim().to_string();
    if trimmed.is_empty() {
        return Err("No commit message was generated".to_string());
    }

    Ok(trimmed)
}

#[tauri::command]
pub(crate) async fn list_thread_titles(
    workspace_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<HashMap<String, String>, String> {
    if remote_backend::is_remote_mode(&*state).await {
        let value = remote_backend::call_remote(
            &*state,
            app,
            "list_thread_titles",
            json!({ "workspaceId": workspace_id }),
        )
        .await?;
        return serde_json::from_value(value)
            .map_err(|error| format!("Invalid thread titles payload: {error}"));
    }

    thread_titles_core::list_thread_titles_core(&state.workspaces, workspace_id).await
}

#[tauri::command]
pub(crate) async fn set_thread_title(
    workspace_id: String,
    thread_id: String,
    title: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<String, String> {
    if remote_backend::is_remote_mode(&*state).await {
        let value = remote_backend::call_remote(
            &*state,
            app,
            "set_thread_title",
            json!({
                "workspaceId": workspace_id,
                "threadId": thread_id,
                "title": title,
            }),
        )
        .await?;
        return value
            .as_str()
            .map(|text| text.to_string())
            .ok_or_else(|| "Invalid set_thread_title response".to_string());
    }

    thread_titles_core::upsert_thread_title_core(&state.workspaces, workspace_id, thread_id, title)
        .await
}

#[tauri::command]
pub(crate) async fn rename_thread_title_key(
    workspace_id: String,
    old_thread_id: String,
    new_thread_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    if remote_backend::is_remote_mode(&*state).await {
        remote_backend::call_remote(
            &*state,
            app,
            "rename_thread_title_key",
            json!({
                "workspaceId": workspace_id,
                "oldThreadId": old_thread_id,
                "newThreadId": new_thread_id,
            }),
        )
        .await?;
        return Ok(());
    }

    thread_titles_core::rename_thread_title_core(
        &state.workspaces,
        workspace_id,
        old_thread_id,
        new_thread_id,
    )
    .await
}

#[tauri::command]
pub(crate) async fn generate_thread_title(
    workspace_id: String,
    thread_id: String,
    user_message: String,
    preferred_language: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<String, String> {
    if remote_backend::is_remote_mode(&*state).await {
        let value = remote_backend::call_remote(
            &*state,
            app,
            "generate_thread_title",
            json!({
                "workspaceId": workspace_id,
                "threadId": thread_id,
                "userMessage": user_message,
                "preferredLanguage": preferred_language,
            }),
        )
        .await?;
        return value
            .as_str()
            .map(|text| text.to_string())
            .ok_or_else(|| "Invalid generate_thread_title response".to_string());
    }

    ensure_codex_session(&workspace_id, &state, &app).await?;

    let cleaned_message = user_message.trim();
    if cleaned_message.is_empty() {
        return Err("Message is required to generate title".to_string());
    }

    let language_instruction = match preferred_language
        .unwrap_or_else(|| "en".to_string())
        .trim()
        .to_lowercase()
        .as_str()
    {
        "zh" | "zh-cn" | "zh-hans" | "chinese" => "Output language: Simplified Chinese.",
        _ => "Output language: English.",
    };

    let session = {
        let sessions = state.sessions.lock().await;
        sessions
            .get(&workspace_id)
            .ok_or("workspace not connected")?
            .clone()
    };

    let prompt = format!(
        "Generate a concise title for a coding chat thread from the first user message. \
Return only the title text, no quotes, no punctuation-only output, no markdown. \
Keep it between 3 and 8 words.\n\
{language_instruction}\n\nFirst user message:\n{cleaned_message}"
    );

    let thread_start_result = session
        .send_request(
            "thread/start",
            json!({
                "cwd": session.entry.path,
                "approvalPolicy": "never"
            }),
        )
        .await?;

    if let Some(error) = thread_start_result.get("error") {
        let message = error
            .get("message")
            .and_then(|value| value.as_str())
            .unwrap_or("Unknown error starting title thread");
        return Err(message.to_string());
    }

    let helper_thread_id = thread_start_result
        .get("result")
        .and_then(|result| result.get("threadId"))
        .or_else(|| {
            thread_start_result
                .get("result")
                .and_then(|result| result.get("thread"))
                .and_then(|thread| thread.get("id"))
        })
        .or_else(|| thread_start_result.get("threadId"))
        .or_else(|| {
            thread_start_result
                .get("thread")
                .and_then(|thread| thread.get("id"))
        })
        .and_then(|value| value.as_str())
        .ok_or_else(|| {
            format!(
                "Failed to get threadId from thread/start response: {:?}",
                thread_start_result
            )
        })?
        .to_string();

    let _ = app.emit(
        "app-server-event",
        AppServerEvent {
            workspace_id: workspace_id.clone(),
            message: json!({
                "method": "codex/backgroundThread",
                "params": {
                    "threadId": helper_thread_id,
                    "action": "hide"
                }
            }),
        },
    );

    let (tx, mut rx) = mpsc::unbounded_channel::<Value>();
    {
        let mut callbacks = session.background_thread_callbacks.lock().await;
        callbacks.insert(helper_thread_id.clone(), tx);
    }

    let turn_start_result = session
        .send_request(
            "turn/start",
            json!({
                "threadId": helper_thread_id,
                "input": [{ "type": "text", "text": prompt }],
                "cwd": session.entry.path,
                "approvalPolicy": "never",
                "sandboxPolicy": { "type": "readOnly" },
            }),
        )
        .await;

    let turn_start_result = match turn_start_result {
        Ok(result) => result,
        Err(error) => {
            {
                let mut callbacks = session.background_thread_callbacks.lock().await;
                callbacks.remove(&helper_thread_id);
            }
            let _ = session
                .send_request(
                    "thread/archive",
                    json!({ "threadId": helper_thread_id.as_str() }),
                )
                .await;
            return Err(error);
        }
    };

    if let Some(error) = turn_start_result.get("error") {
        let message = error
            .get("message")
            .and_then(|value| value.as_str())
            .unwrap_or("Unknown error starting title generation turn")
            .to_string();
        {
            let mut callbacks = session.background_thread_callbacks.lock().await;
            callbacks.remove(&helper_thread_id);
        }
        let _ = session
            .send_request(
                "thread/archive",
                json!({ "threadId": helper_thread_id.as_str() }),
            )
            .await;
        return Err(message);
    }

    let mut generated = String::new();
    let collect_result = timeout(Duration::from_secs(30), async {
        while let Some(event) = rx.recv().await {
            let method = event
                .get("method")
                .and_then(|value| value.as_str())
                .unwrap_or("");
            match method {
                "item/agentMessage/delta" => {
                    if let Some(delta) = event
                        .get("params")
                        .and_then(|params| params.get("delta"))
                        .and_then(|value| value.as_str())
                    {
                        generated.push_str(delta);
                    }
                }
                "turn/completed" => break,
                "turn/error" => {
                    let message = event
                        .get("params")
                        .and_then(|params| params.get("error"))
                        .and_then(|value| value.as_str())
                        .unwrap_or("Unknown error during title generation");
                    return Err(message.to_string());
                }
                _ => {}
            }
        }
        Ok(())
    })
    .await;

    {
        let mut callbacks = session.background_thread_callbacks.lock().await;
        callbacks.remove(&helper_thread_id);
    }

    let _ = session
        .send_request("thread/archive", json!({ "threadId": helper_thread_id }))
        .await;

    match collect_result {
        Ok(Ok(())) => {}
        Ok(Err(error)) => return Err(error),
        Err(_) => return Err("Timeout waiting for thread title generation".to_string()),
    }

    let normalized = generated
        .lines()
        .next()
        .unwrap_or("")
        .trim()
        .trim_matches('"')
        .to_string();
    if normalized.is_empty() {
        return Err("No thread title was generated".to_string());
    }

    let saved = thread_titles_core::upsert_thread_title_core(
        &state.workspaces,
        workspace_id,
        thread_id,
        normalized,
    )
    .await?;

    Ok(saved)
}

#[tauri::command]
pub(crate) async fn generate_run_metadata(
    workspace_id: String,
    prompt: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "generate_run_metadata",
            json!({ "workspaceId": workspace_id, "prompt": prompt }),
        )
        .await;
    }

    let cleaned_prompt = prompt.trim();
    if cleaned_prompt.is_empty() {
        return Err("Prompt is required.".to_string());
    }

    let session = {
        let sessions = state.sessions.lock().await;
        sessions
            .get(&workspace_id)
            .ok_or("workspace not connected")?
            .clone()
    };

    let title_prompt = format!(
        "You create concise run metadata for a coding task.\n\
Return ONLY a JSON object with keys:\n\
- title: short, clear, 3-7 words, Title Case\n\
- worktreeName: lower-case, kebab-case slug prefixed with one of: \
feat/, fix/, chore/, test/, docs/, refactor/, perf/, build/, ci/, style/.\n\
\n\
Choose fix/ when the task is a bug fix, error, regression, crash, or cleanup. \
Use the closest match for chores/tests/docs/refactors/perf/build/ci/style. \
Otherwise use feat/.\n\
\n\
Examples:\n\
{{\"title\":\"Fix Login Redirect Loop\",\"worktreeName\":\"fix/login-redirect-loop\"}}\n\
{{\"title\":\"Add Workspace Home View\",\"worktreeName\":\"feat/workspace-home\"}}\n\
{{\"title\":\"Update Lint Config\",\"worktreeName\":\"chore/update-lint-config\"}}\n\
{{\"title\":\"Add Coverage Tests\",\"worktreeName\":\"test/add-coverage-tests\"}}\n\
\n\
Task:\n{cleaned_prompt}"
    );

    let thread_params = json!({
        "cwd": session.entry.path,
        "approvalPolicy": "never"
    });
    let thread_result = session.send_request("thread/start", thread_params).await?;

    if let Some(error) = thread_result.get("error") {
        let error_msg = error
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("Unknown error starting thread");
        return Err(error_msg.to_string());
    }

    let thread_id = thread_result
        .get("result")
        .and_then(|r| r.get("threadId"))
        .or_else(|| {
            thread_result
                .get("result")
                .and_then(|r| r.get("thread"))
                .and_then(|t| t.get("id"))
        })
        .or_else(|| thread_result.get("threadId"))
        .or_else(|| thread_result.get("thread").and_then(|t| t.get("id")))
        .and_then(|t| t.as_str())
        .ok_or_else(|| {
            format!(
                "Failed to get threadId from thread/start response: {:?}",
                thread_result
            )
        })?
        .to_string();

    // Hide background helper threads from the sidebar, even if a thread/started event leaked.
    let _ = app.emit(
        "app-server-event",
        AppServerEvent {
            workspace_id: workspace_id.clone(),
            message: json!({
                "method": "codex/backgroundThread",
                "params": {
                    "threadId": thread_id,
                    "action": "hide"
                }
            }),
        },
    );

    let (tx, mut rx) = mpsc::unbounded_channel::<Value>();
    {
        let mut callbacks = session.background_thread_callbacks.lock().await;
        callbacks.insert(thread_id.clone(), tx);
    }

    let turn_params = json!({
        "threadId": thread_id,
        "input": [{ "type": "text", "text": title_prompt }],
        "cwd": session.entry.path,
        "approvalPolicy": "never",
        "sandboxPolicy": { "type": "readOnly" },
    });
    let turn_result = session.send_request("turn/start", turn_params).await;
    let turn_result = match turn_result {
        Ok(result) => result,
        Err(error) => {
            {
                let mut callbacks = session.background_thread_callbacks.lock().await;
                callbacks.remove(&thread_id);
            }
            let archive_params = json!({ "threadId": thread_id.as_str() });
            let _ = session.send_request("thread/archive", archive_params).await;
            return Err(error);
        }
    };

    if let Some(error) = turn_result.get("error") {
        let error_msg = error
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("Unknown error starting turn");
        {
            let mut callbacks = session.background_thread_callbacks.lock().await;
            callbacks.remove(&thread_id);
        }
        let archive_params = json!({ "threadId": thread_id.as_str() });
        let _ = session.send_request("thread/archive", archive_params).await;
        return Err(error_msg.to_string());
    }

    let mut response_text = String::new();
    let timeout_duration = Duration::from_secs(60);
    let collect_result = timeout(timeout_duration, async {
        while let Some(event) = rx.recv().await {
            let method = event.get("method").and_then(|m| m.as_str()).unwrap_or("");
            match method {
                "item/agentMessage/delta" => {
                    if let Some(params) = event.get("params") {
                        if let Some(delta) = params.get("delta").and_then(|d| d.as_str()) {
                            response_text.push_str(delta);
                        }
                    }
                }
                "turn/completed" => break,
                "turn/error" => {
                    let error_msg = event
                        .get("params")
                        .and_then(|p| p.get("error"))
                        .and_then(|e| e.as_str())
                        .unwrap_or("Unknown error during metadata generation");
                    return Err(error_msg.to_string());
                }
                _ => {}
            }
        }
        Ok(())
    })
    .await;

    {
        let mut callbacks = session.background_thread_callbacks.lock().await;
        callbacks.remove(&thread_id);
    }

    let archive_params = json!({ "threadId": thread_id });
    let _ = session.send_request("thread/archive", archive_params).await;

    match collect_result {
        Ok(Ok(())) => {}
        Ok(Err(e)) => return Err(e),
        Err(_) => return Err("Timeout waiting for metadata generation".to_string()),
    }

    let trimmed = response_text.trim();
    if trimmed.is_empty() {
        return Err("No metadata was generated".to_string());
    }

    let json_value =
        extract_json_value(trimmed).ok_or_else(|| "Failed to parse metadata JSON".to_string())?;
    let title = json_value
        .get("title")
        .and_then(|v| v.as_str())
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .ok_or_else(|| "Missing title in metadata".to_string())?;
    let worktree_name = json_value
        .get("worktreeName")
        .or_else(|| json_value.get("worktree_name"))
        .and_then(|v| v.as_str())
        .map(|v| sanitize_run_worktree_name(v))
        .filter(|v| !v.is_empty())
        .ok_or_else(|| "Missing worktree name in metadata".to_string())?;

    Ok(json!({
        "title": title,
        "worktreeName": worktree_name
    }))
}

#[cfg(test)]
mod tests {
    use super::thread_listing::{
        build_local_codex_session_preview, build_thread_list_empty_response,
        codex_session_identifier_candidates, merge_unified_codex_thread_entries,
    };
    use super::{create_session_runtime_recovering_error, run_start_thread_with_retry};
    use crate::types::{LocalUsageSessionSummary, LocalUsageUsageData};
    use serde_json::json;
    use std::collections::HashSet;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    #[test]
    fn build_thread_list_empty_response_has_expected_shape() {
        let response = build_thread_list_empty_response();
        assert_eq!(response["result"]["data"], json!([]));
        assert!(response["result"]["nextCursor"].is_null());
    }

    #[test]
    fn build_local_codex_session_preview_prefers_trimmed_summary() {
        let with_summary = build_local_codex_session_preview(
            Some("  fixed preview  ".to_string()),
            "openai/gpt-5".to_string(),
        );
        let without_summary =
            build_local_codex_session_preview(Some("   ".to_string()), "openai/gpt-5".to_string());
        assert_eq!(with_summary, "fixed preview");
        assert_eq!(without_summary, "Codex session (openai/gpt-5)");
    }

    #[test]
    fn merge_unified_codex_thread_entries_dedupes_and_keeps_metadata_stable() {
        let live_entries = vec![
            json!({
                "id": "thread-live",
                "preview": "live",
                "updatedAt": 100,
                "createdAt": 100
            }),
            json!({
                "id": "thread-dup",
                "preview": "remote",
                "updatedAt": 90,
                "createdAt": 90
            }),
            json!({
                "id": "thread-dup",
                "preview": "stale",
                "updatedAt": 80,
                "createdAt": 80
            }),
        ];
        let local_sessions = vec![
            LocalUsageSessionSummary {
                session_id: "thread-dup".to_string(),
                session_id_aliases: Vec::new(),
                timestamp: 110,
                cwd: None,
                model: "openai/gpt-5".to_string(),
                usage: LocalUsageUsageData::default(),
                cost: 0.0,
                summary: Some("local".to_string()),
                source: Some("custom".to_string()),
                provider: Some("openai".to_string()),
                file_size_bytes: Some(4_096),
                modified_lines: 0,
            },
            LocalUsageSessionSummary {
                session_id: "thread-local".to_string(),
                session_id_aliases: Vec::new(),
                timestamp: 105,
                cwd: None,
                model: "openai/gpt-5-mini".to_string(),
                usage: LocalUsageUsageData::default(),
                cost: 0.0,
                summary: Some("local-only".to_string()),
                source: Some("project".to_string()),
                provider: Some("openai".to_string()),
                file_size_bytes: Some(8_192),
                modified_lines: 0,
            },
        ];

        let workspace_session_ids: HashSet<String> = local_sessions
            .iter()
            .flat_map(codex_session_identifier_candidates)
            .collect();
        let merged = merge_unified_codex_thread_entries(
            live_entries,
            &local_sessions,
            &workspace_session_ids,
            "/tmp/workspace",
            10,
        );

        assert_eq!(merged.len(), 3);
        assert_eq!(merged[0]["id"], "thread-dup");
        assert_eq!(merged[0]["updatedAt"], 110);
        assert_eq!(merged[0]["preview"], "remote");
        assert_eq!(merged[0]["sizeBytes"], 4_096);
        assert_eq!(merged[0]["source"], "custom");
        assert_eq!(merged[0]["provider"], "openai");
        assert_eq!(merged[0]["sourceLabel"], "custom/openai");

        assert_eq!(merged[1]["id"], "thread-local");
        assert_eq!(merged[1]["localFallback"], true);
        assert_eq!(merged[1]["sizeBytes"], 8_192);
        assert_eq!(merged[1]["sourceLabel"], "project/openai");

        assert_eq!(merged[2]["id"], "thread-live");
    }

    #[test]
    fn merge_unified_codex_thread_entries_replaces_generic_vscode_source() {
        let live_entries = vec![json!({
            "id": "thread-dup",
            "preview": "remote",
            "updatedAt": 90,
            "createdAt": 90,
            "source": "vscode",
            "sourceLabel": "vscode"
        })];
        let local_sessions = vec![LocalUsageSessionSummary {
            session_id: "thread-dup".to_string(),
            session_id_aliases: Vec::new(),
            timestamp: 110,
            cwd: None,
            model: "openai/gpt-5".to_string(),
            usage: LocalUsageUsageData::default(),
            cost: 0.0,
            summary: Some("local".to_string()),
            source: Some("mossx".to_string()),
            provider: Some("openai".to_string()),
            file_size_bytes: Some(1_024),
            modified_lines: 0,
        }];

        let workspace_session_ids: HashSet<String> = local_sessions
            .iter()
            .flat_map(codex_session_identifier_candidates)
            .collect();
        let merged = merge_unified_codex_thread_entries(
            live_entries,
            &local_sessions,
            &workspace_session_ids,
            "/tmp/workspace",
            10,
        );
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0]["sizeBytes"], 1_024);
        assert_eq!(merged[0]["source"], "mossx");
        assert_eq!(merged[0]["sourceLabel"], "mossx/openai");
    }

    #[test]
    fn merge_unified_codex_thread_entries_matches_session_id_aliases() {
        let live_entries = vec![json!({
            "id": "rollout-2026-04-10T10-00-00-session-123",
            "preview": "remote",
            "updatedAt": 90,
            "createdAt": 90
        })];
        let local_sessions = vec![LocalUsageSessionSummary {
            session_id: "session-123".to_string(),
            session_id_aliases: vec!["rollout-2026-04-10T10-00-00-session-123".to_string()],
            timestamp: 110,
            cwd: None,
            model: "openai/gpt-5".to_string(),
            usage: LocalUsageUsageData::default(),
            cost: 0.0,
            summary: Some("local".to_string()),
            source: Some("cli".to_string()),
            provider: Some("openai".to_string()),
            file_size_bytes: Some(2_048),
            modified_lines: 0,
        }];

        let workspace_session_ids: HashSet<String> = local_sessions
            .iter()
            .flat_map(codex_session_identifier_candidates)
            .collect();
        let merged = merge_unified_codex_thread_entries(
            live_entries,
            &local_sessions,
            &workspace_session_ids,
            "/tmp/workspace",
            10,
        );

        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0]["id"], "rollout-2026-04-10T10-00-00-session-123");
        assert_eq!(merged[0]["sizeBytes"], 2_048);
        assert_eq!(merged[0]["source"], "cli");
        assert_eq!(merged[0]["sourceLabel"], "cli/openai");
    }

    #[test]
    fn merge_unified_codex_thread_entries_filters_background_helper_sessions() {
        let live_entries = vec![
            json!({
                "id": "thread-memory-helper",
                "preview": "live row should be hidden through local alias",
                "updatedAt": 120,
                "createdAt": 120
            }),
            json!({
                "id": "thread-title-helper",
                "preview": "Generate a concise title for a coding chat thread from the first user message. Return only title text.",
                "updatedAt": 115,
                "createdAt": 115
            }),
            json!({
                "id": "thread-visible",
                "preview": "normal user prompt",
                "updatedAt": 100,
                "createdAt": 100
            }),
        ];
        let local_sessions = vec![
            LocalUsageSessionSummary {
                session_id: "session-memory-helper".to_string(),
                session_id_aliases: vec!["thread-memory-helper".to_string()],
                timestamp: 125,
                cwd: None,
                model: "openai/gpt-5".to_string(),
                usage: LocalUsageUsageData::default(),
                cost: 0.0,
                summary: Some(
                    "## Memory Writing Agent: Phase 2 (Consolidation)\n\nConsolidate raw memories."
                        .to_string(),
                ),
                source: Some("cli".to_string()),
                provider: Some("openai".to_string()),
                file_size_bytes: Some(2_048),
                modified_lines: 0,
            },
            LocalUsageSessionSummary {
                session_id: "thread-visible-local".to_string(),
                session_id_aliases: Vec::new(),
                timestamp: 90,
                cwd: None,
                model: "openai/gpt-5".to_string(),
                usage: LocalUsageUsageData::default(),
                cost: 0.0,
                summary: Some("normal local prompt".to_string()),
                source: Some("cli".to_string()),
                provider: Some("openai".to_string()),
                file_size_bytes: Some(1_024),
                modified_lines: 0,
            },
        ];

        let workspace_session_ids: HashSet<String> = local_sessions
            .iter()
            .flat_map(codex_session_identifier_candidates)
            .collect();
        let merged = merge_unified_codex_thread_entries(
            live_entries,
            &local_sessions,
            &workspace_session_ids,
            "/tmp/workspace",
            10,
        );
        let ids = merged
            .iter()
            .filter_map(|entry| entry.get("id").and_then(|value| value.as_str()))
            .collect::<Vec<_>>();

        assert_eq!(ids, vec!["thread-visible", "thread-visible-local"]);
    }

    #[test]
    fn merge_unified_codex_thread_entries_does_not_backfill_cwd_for_unmapped_live_rows() {
        let live_entries = vec![json!({
            "id": "thread-live",
            "preview": "remote",
            "updatedAt": 90,
            "createdAt": 90
        })];

        let merged = merge_unified_codex_thread_entries(
            live_entries,
            &[],
            &HashSet::new(),
            "/tmp/workspace",
            10,
        );

        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0]["id"], "thread-live");
        assert!(merged[0].get("cwd").is_none() || merged[0]["cwd"].is_null());
    }

    #[test]
    fn merge_unified_codex_thread_entries_backfills_cwd_from_cached_workspace_ids() {
        let live_entries = vec![json!({
            "id": "thread-live",
            "preview": "remote",
            "updatedAt": 90,
            "createdAt": 90
        })];
        let mut workspace_session_ids = HashSet::new();
        workspace_session_ids.insert("thread-live".to_string());

        let merged = merge_unified_codex_thread_entries(
            live_entries,
            &[],
            &workspace_session_ids,
            "/tmp/workspace",
            10,
        );

        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0]["id"], "thread-live");
        assert_eq!(merged[0]["cwd"], "/tmp/workspace");
    }

    #[test]
    fn merge_unified_codex_thread_entries_backfills_workspace_cwd_for_mapped_live_rows() {
        let live_entries = vec![json!({
            "id": "rollout-2026-04-10T10-00-00-session-123",
            "preview": "remote",
            "updatedAt": 90,
            "createdAt": 90
        })];
        let local_sessions = vec![LocalUsageSessionSummary {
            session_id: "session-123".to_string(),
            session_id_aliases: vec!["rollout-2026-04-10T10-00-00-session-123".to_string()],
            timestamp: 110,
            cwd: None,
            model: "openai/gpt-5".to_string(),
            usage: LocalUsageUsageData::default(),
            cost: 0.0,
            summary: Some("local".to_string()),
            source: Some("cli".to_string()),
            provider: Some("openai".to_string()),
            file_size_bytes: Some(2_048),
            modified_lines: 0,
        }];

        let workspace_session_ids: HashSet<String> = local_sessions
            .iter()
            .flat_map(codex_session_identifier_candidates)
            .collect();
        let merged = merge_unified_codex_thread_entries(
            live_entries,
            &local_sessions,
            &workspace_session_ids,
            "/tmp/workspace",
            10,
        );

        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0]["id"], "rollout-2026-04-10T10-00-00-session-123");
        assert_eq!(merged[0]["cwd"], "/tmp/workspace");
    }

    #[tokio::test]
    async fn start_thread_retry_reacquires_after_manual_shutdown_race() {
        let ensure_calls = Arc::new(AtomicUsize::new(0));
        let start_calls = Arc::new(AtomicUsize::new(0));

        let result = run_start_thread_with_retry(
            "ws-1",
            {
                let ensure_calls = Arc::clone(&ensure_calls);
                move || {
                    let ensure_calls = Arc::clone(&ensure_calls);
                    async move {
                        ensure_calls.fetch_add(1, Ordering::SeqCst);
                        Ok(())
                    }
                }
            },
            {
                let start_calls = Arc::clone(&start_calls);
                move || {
                    let start_calls = Arc::clone(&start_calls);
                    async move {
                        let attempt = start_calls.fetch_add(1, Ordering::SeqCst);
                        if attempt == 0 {
                            Err(
                                "[RUNTIME_ENDED] Managed runtime stopped after manual shutdown."
                                    .to_string(),
                            )
                        } else {
                            Ok(json!({ "result": { "threadId": "thread-recovered" } }))
                        }
                    }
                }
            },
        )
        .await
        .expect("manual shutdown race should retry once");

        assert_eq!(result["result"]["threadId"], "thread-recovered");
        assert_eq!(ensure_calls.load(Ordering::SeqCst), 2);
        assert_eq!(start_calls.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn start_thread_retry_does_not_retry_non_runtime_shutdown_errors() {
        let ensure_calls = Arc::new(AtomicUsize::new(0));
        let start_calls = Arc::new(AtomicUsize::new(0));

        let error = run_start_thread_with_retry(
            "ws-1",
            {
                let ensure_calls = Arc::clone(&ensure_calls);
                move || {
                    let ensure_calls = Arc::clone(&ensure_calls);
                    async move {
                        ensure_calls.fetch_add(1, Ordering::SeqCst);
                        Ok(())
                    }
                }
            },
            {
                let start_calls = Arc::clone(&start_calls);
                move || {
                    let start_calls = Arc::clone(&start_calls);
                    async move {
                        start_calls.fetch_add(1, Ordering::SeqCst);
                        Err("workspace not connected".to_string())
                    }
                }
            },
        )
        .await
        .expect_err("non-runtime errors should surface directly");

        assert_eq!(error, "workspace not connected");
        assert_eq!(ensure_calls.load(Ordering::SeqCst), 1);
        assert_eq!(start_calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn start_thread_retry_returns_recoverable_error_when_stopping_race_persists() {
        let ensure_calls = Arc::new(AtomicUsize::new(0));
        let start_calls = Arc::new(AtomicUsize::new(0));

        let error = run_start_thread_with_retry(
            "ws-1",
            {
                let ensure_calls = Arc::clone(&ensure_calls);
                move || {
                    let ensure_calls = Arc::clone(&ensure_calls);
                    async move {
                        ensure_calls.fetch_add(1, Ordering::SeqCst);
                        Ok(())
                    }
                }
            },
            {
                let start_calls = Arc::clone(&start_calls);
                move || {
                    let start_calls = Arc::clone(&start_calls);
                    async move {
                        start_calls.fetch_add(1, Ordering::SeqCst);
                        Err(
                            "[RUNTIME_ENDED] Managed runtime stopped after manual shutdown."
                                .to_string(),
                        )
                    }
                }
            },
        )
        .await
        .expect_err("persistent stopping race should surface recoverable error");

        assert_eq!(error, create_session_runtime_recovering_error());
        assert_eq!(ensure_calls.load(Ordering::SeqCst), 2);
        assert_eq!(start_calls.load(Ordering::SeqCst), 2);
    }
}
