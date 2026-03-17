use serde::Serialize;
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::io::ErrorKind;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc;
use tokio::time::timeout;

pub(crate) mod args;
pub(crate) mod collaboration_policy;
pub(crate) mod config;
pub(crate) mod home;
pub(crate) mod thread_mode_state;

use self::args::resolve_workspace_codex_args;
use self::home::resolve_workspace_codex_home;
pub(crate) use crate::backend::app_server::WorkspaceSession;
use crate::backend::app_server::{
    build_codex_path_env, check_codex_installation, get_cli_debug_info, probe_codex_app_server,
    resolve_codex_launch_context, spawn_workspace_session as spawn_workspace_session_inner,
};
use crate::backend::events::AppServerEvent;
use crate::event_sink::TauriEventSink;
use crate::local_usage;
use crate::remote_backend;
use crate::shared::{codex_core, thread_titles_core};
use crate::state::AppState;
use crate::types::{LocalUsageSessionSummary, WorkspaceEntry};

fn normalize_model_id(candidate: Option<String>) -> Option<String> {
    candidate
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn pick_model_from_model_list_response(response: &Value) -> Option<String> {
    let entries = response
        .get("result")
        .and_then(|result| result.get("data"))
        .or_else(|| response.get("data"))
        .and_then(Value::as_array)?;

    let pick_from_entry = |entry: &Value| {
        let model = entry
            .get("model")
            .and_then(Value::as_str)
            .or_else(|| entry.get("id").and_then(Value::as_str));
        model
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
    };

    entries
        .iter()
        .find(|entry| {
            entry
                .get("isDefault")
                .or_else(|| entry.get("is_default"))
                .and_then(Value::as_bool)
                .unwrap_or(false)
        })
        .and_then(pick_from_entry)
        .or_else(|| entries.iter().find_map(pick_from_entry))
}

fn build_thread_list_empty_response() -> Value {
    json!({
        "result": {
            "data": [],
            "nextCursor": null
        }
    })
}

fn thread_list_response_is_empty(response: &Value) -> bool {
    response
        .get("result")
        .and_then(|result| result.get("data"))
        .or_else(|| response.get("data"))
        .and_then(Value::as_array)
        .map(|items| items.is_empty())
        .unwrap_or(true)
}

fn build_local_codex_session_preview(summary: Option<String>, model: String) -> String {
    let preview = summary
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    preview.unwrap_or_else(|| format!("Codex session ({model})"))
}

fn build_local_codex_thread_fallback_response_from_sessions(
    workspace_path: &str,
    sessions: &[LocalUsageSessionSummary],
    requested_limit: usize,
) -> Value {
    let data: Vec<Value> = sessions
        .iter()
        .take(requested_limit)
        .map(|session| {
            let preview =
                build_local_codex_session_preview(session.summary.clone(), session.model.clone());
            let title = preview.clone();
            json!({
                "id": session.session_id,
                "preview": preview,
                "title": title,
                "cwd": workspace_path,
                "createdAt": session.timestamp,
                "updatedAt": session.timestamp,
                "localFallback": true
            })
        })
        .collect();
    json!({
        "result": {
            "data": data,
            "nextCursor": null
        }
    })
}

async fn build_local_codex_thread_fallback_response(
    state: &AppState,
    workspace_id: &str,
    limit: Option<u32>,
) -> Option<Value> {
    let requested_limit = limit.unwrap_or(50).clamp(1, 200) as usize;
    let fallback = local_usage::list_codex_session_summaries_for_workspace(
        &state.workspaces,
        workspace_id,
        requested_limit,
    )
    .await;
    let (workspace_path, sessions) = match fallback {
        Ok(result) => result,
        Err(error) => {
            log::debug!(
                "[list_threads] Local session fallback unavailable for {}: {}",
                workspace_id,
                error
            );
            return None;
        }
    };
    Some(build_local_codex_thread_fallback_response_from_sessions(
        &workspace_path,
        &sessions,
        requested_limit,
    ))
}

async fn resolve_workspace_config_model(state: &AppState, workspace_id: &str) -> Option<String> {
    let (entry, parent_entry) = {
        let workspaces = state.workspaces.lock().await;
        let entry = workspaces.get(workspace_id).cloned()?;
        let parent_entry = entry
            .parent_id
            .as_ref()
            .and_then(|pid| workspaces.get(pid).cloned());
        (entry, parent_entry)
    };
    let codex_home = resolve_workspace_codex_home(&entry, parent_entry.as_ref());
    normalize_model_id(config::read_config_model(codex_home).ok().flatten())
}

async fn resolve_workspace_fallback_model(state: &AppState, workspace_id: &str) -> Option<String> {
    let from_config = resolve_workspace_config_model(state, workspace_id).await;
    if from_config.is_some() {
        return from_config;
    }
    let model_list = codex_core::model_list_core(&state.sessions, workspace_id.to_string())
        .await
        .ok();
    model_list
        .as_ref()
        .and_then(pick_model_from_model_list_response)
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
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let (default_bin, default_args) = {
        let settings = state.app_settings.lock().await;
        (settings.codex_bin.clone(), settings.codex_args.clone())
    };
    let resolved = codex_bin
        .clone()
        .filter(|value| !value.trim().is_empty())
        .or(default_bin);
    let resolved_args = codex_args
        .clone()
        .filter(|value| !value.trim().is_empty())
        .or(default_args);
    let path_env = build_codex_path_env(resolved.as_deref());

    // Get debug info first (always collect this)
    let debug_info = get_cli_debug_info(resolved.as_deref());

    // Try to check installation - don't fail early, collect all info
    let version_result = check_codex_installation(resolved.clone()).await;
    let (version, cli_error) = match version_result {
        Ok(v) => (v, None),
        Err(e) => (None, Some(e)),
    };

    let launch_context = resolve_codex_launch_context(resolved.as_deref());

    // Try app-server check only if version check passed
    let probe_status = if version.is_some() {
        Some(probe_codex_app_server(resolved.clone(), resolved_args.as_deref()).await?)
    } else {
        None
    };
    let app_server_ok = probe_status
        .as_ref()
        .map(|status| status.ok)
        .unwrap_or(false);

    let (node_ok, node_version, node_details) = {
        let mut node_command = crate::utils::async_command("node");
        if let Some(ref path_env) = path_env {
            node_command.env("PATH", path_env);
        }
        node_command.arg("--version");
        node_command.stdout(std::process::Stdio::piped());
        node_command.stderr(std::process::Stdio::piped());
        match timeout(Duration::from_secs(5), node_command.output()).await {
            Ok(result) => match result {
                Ok(output) => {
                    if output.status.success() {
                        let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
                        (
                            !version.is_empty(),
                            if version.is_empty() {
                                None
                            } else {
                                Some(version)
                            },
                            None,
                        )
                    } else {
                        let stderr = String::from_utf8_lossy(&output.stderr);
                        let stdout = String::from_utf8_lossy(&output.stdout);
                        let detail = if stderr.trim().is_empty() {
                            stdout.trim()
                        } else {
                            stderr.trim()
                        };
                        (
                            false,
                            None,
                            Some(if detail.is_empty() {
                                "Node failed to start.".to_string()
                            } else {
                                detail.to_string()
                            }),
                        )
                    }
                }
                Err(err) => {
                    if err.kind() == ErrorKind::NotFound {
                        (false, None, Some("Node not found on PATH.".to_string()))
                    } else {
                        (false, None, Some(err.to_string()))
                    }
                }
            },
            Err(_) => (
                false,
                None,
                Some("Timed out while checking Node.".to_string()),
            ),
        }
    };

    let details = if let Some(ref err) = cli_error {
        Some(err.clone())
    } else if let Some(status) = probe_status.as_ref() {
        if status.ok {
            None
        } else {
            status
                .details
                .clone()
                .or_else(|| Some("Failed to run `codex app-server --help`.".to_string()))
        }
    } else {
        None
    };

    Ok(json!({
        "ok": version.is_some() && app_server_ok,
        "codexBin": resolved,
        "version": version,
        "appServerOk": app_server_ok,
        "details": details,
        "path": path_env,
        "nodeOk": node_ok,
        "nodeVersion": node_version,
        "nodeDetails": node_details,
        "resolvedBinaryPath": launch_context.resolved_bin,
        "wrapperKind": launch_context.wrapper_kind,
        "pathEnvUsed": launch_context.path_env,
        "proxyEnvSnapshot": debug_info.get("proxyEnvSnapshot").cloned().unwrap_or(Value::Null),
        "appServerProbeStatus": probe_status.as_ref().map(|status| status.status.clone()),
        "fallbackRetried": probe_status.as_ref().map(|status| status.fallback_retried).unwrap_or(false),
        "debug": debug_info,
    }))
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

    // Ensure Codex session exists before starting thread
    ensure_codex_session(&workspace_id, &state, &app).await?;
    let resolved_model = resolve_workspace_fallback_model(&state, &workspace_id).await;

    codex_core::start_thread_core(&state.sessions, workspace_id, resolved_model).await
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
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "fork_thread",
            json!({ "workspaceId": workspace_id, "threadId": thread_id }),
        )
        .await;
    }

    // Ensure Codex session exists before forking thread
    ensure_codex_session(&workspace_id, &state, &app).await?;

    codex_core::fork_thread_core(&state.sessions, workspace_id, thread_id).await
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

    // Check if Codex session exists
    // If not, try to create one (user may have installed Codex later)
    // If that fails, return empty result (Codex not available)
    let has_session = {
        let sessions = state.sessions.lock().await;
        sessions.contains_key(&workspace_id)
    };

    if !has_session {
        // Try to create a Codex session
        // This handles the case where user installed Codex after creating the workspace
        let warmup = timeout(
            Duration::from_secs(4),
            ensure_codex_session(&workspace_id, &state, &app),
        )
        .await;
        match warmup {
            Err(_) => {
                log::warn!(
                    "[list_threads] Codex session warmup timed out for workspace {}",
                    workspace_id
                );
                if cursor.is_none() {
                    if let Some(fallback) =
                        build_local_codex_thread_fallback_response(&state, &workspace_id, limit)
                            .await
                    {
                        log::info!(
                            "[list_threads] Using local session fallback after warmup timeout for workspace {}",
                            workspace_id
                        );
                        return Ok(fallback);
                    }
                }
                return Ok(build_thread_list_empty_response());
            }
            Ok(Err(e)) => {
                // Codex not available (not installed or other error)
                // Return empty result - Claude sessions are fetched separately
                log::debug!(
                    "[list_threads] Codex session creation failed for {}: {}",
                    workspace_id,
                    e
                );
                if cursor.is_none() {
                    if let Some(fallback) =
                        build_local_codex_thread_fallback_response(&state, &workspace_id, limit)
                            .await
                    {
                        log::info!(
                            "[list_threads] Using local session fallback after warmup failure for workspace {}",
                            workspace_id
                        );
                        return Ok(fallback);
                    }
                }
                return Ok(build_thread_list_empty_response());
            }
            Ok(_) => {
                log::info!(
                    "[list_threads] Created Codex session for workspace {}",
                    workspace_id
                );
            }
        }
    }

    match codex_core::list_threads_core(
        &state.sessions,
        workspace_id.clone(),
        cursor.clone(),
        limit,
    )
    .await
    {
        Ok(response) => {
            if cursor.is_none() && thread_list_response_is_empty(&response) {
                if let Some(fallback) =
                    build_local_codex_thread_fallback_response(&state, &workspace_id, limit).await
                {
                    if !thread_list_response_is_empty(&fallback) {
                        log::info!(
                            "[list_threads] Using local session fallback after empty list for workspace {}",
                            workspace_id
                        );
                        return Ok(fallback);
                    }
                }
            }
            Ok(response)
        }
        Err(error) => {
            if cursor.is_none() && error.contains("workspace not connected") {
                if let Some(fallback) =
                    build_local_codex_thread_fallback_response(&state, &workspace_id, limit).await
                {
                    log::info!(
                        "[list_threads] Using local session fallback after list error for workspace {}",
                        workspace_id
                    );
                    return Ok(fallback);
                }
                return Ok(build_thread_list_empty_response());
            }
            Err(error)
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GlobalMcpServerEntry {
    name: String,
    enabled: bool,
    transport: Option<String>,
    command: Option<String>,
    url: Option<String>,
    args_count: usize,
    source: String,
}

fn parse_disabled_mcp_set(root: &Map<String, Value>) -> HashSet<String> {
    root.get("disabledMcpServers")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str())
                .map(|item| item.trim().to_string())
                .filter(|item| !item.is_empty())
                .collect::<HashSet<_>>()
        })
        .unwrap_or_default()
}

fn parse_mcp_entries_from_object(
    mcp_servers: &Map<String, Value>,
    disabled_servers: &HashSet<String>,
    source: &str,
) -> Vec<GlobalMcpServerEntry> {
    let mut entries = Vec::new();
    for (name, raw_spec) in mcp_servers {
        let server_name = name.trim();
        if server_name.is_empty() {
            continue;
        }
        let spec = match raw_spec.as_object() {
            Some(value) => value,
            None => continue,
        };
        let transport = spec
            .get("type")
            .and_then(|value| value.as_str())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let command = spec
            .get("command")
            .and_then(|value| value.as_str())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let url = spec
            .get("url")
            .and_then(|value| value.as_str())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let args_count = spec
            .get("args")
            .and_then(|value| value.as_array())
            .map(|items| items.len())
            .unwrap_or(0);
        entries.push(GlobalMcpServerEntry {
            name: server_name.to_string(),
            enabled: !disabled_servers.contains(server_name),
            transport,
            command,
            url,
            args_count,
            source: source.to_string(),
        });
    }
    entries.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    entries
}

fn parse_mcp_entries_from_array(mcp_servers: &[Value], source: &str) -> Vec<GlobalMcpServerEntry> {
    let mut entries = Vec::new();
    for raw_item in mcp_servers {
        let item = match raw_item.as_object() {
            Some(value) => value,
            None => continue,
        };
        let name = item
            .get("id")
            .or_else(|| item.get("name"))
            .and_then(|value| value.as_str())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let Some(name) = name else {
            continue;
        };
        let enabled = item
            .get("enabled")
            .and_then(|value| value.as_bool())
            .unwrap_or(true);
        let spec = item
            .get("server")
            .and_then(|value| value.as_object())
            .unwrap_or(item);
        let transport = spec
            .get("type")
            .and_then(|value| value.as_str())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let command = spec
            .get("command")
            .and_then(|value| value.as_str())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let url = spec
            .get("url")
            .and_then(|value| value.as_str())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let args_count = spec
            .get("args")
            .and_then(|value| value.as_array())
            .map(|items| items.len())
            .unwrap_or(0);
        entries.push(GlobalMcpServerEntry {
            name,
            enabled,
            transport,
            command,
            url,
            args_count,
            source: source.to_string(),
        });
    }
    entries.sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    entries
}

fn parse_mcp_entries_from_json_value(
    root: &Value,
    source: &str,
) -> Result<Vec<GlobalMcpServerEntry>, String> {
    let object = root
        .as_object()
        .ok_or_else(|| "MCP config root is not a JSON object".to_string())?;
    let disabled_servers = parse_disabled_mcp_set(object);
    match object.get("mcpServers") {
        Some(Value::Object(mcp_servers)) => Ok(parse_mcp_entries_from_object(
            mcp_servers,
            &disabled_servers,
            source,
        )),
        Some(Value::Array(mcp_servers)) => Ok(parse_mcp_entries_from_array(mcp_servers, source)),
        Some(_) => Ok(Vec::new()),
        None => Ok(Vec::new()),
    }
}

fn read_json_file(path: &PathBuf) -> Result<Value, String> {
    let raw = std::fs::read_to_string(path)
        .map_err(|error| format!("Failed to read {}: {}", path.display(), error))?;
    serde_json::from_str::<Value>(&raw)
        .map_err(|error| format!("Failed to parse {}: {}", path.display(), error))
}

#[tauri::command]
pub(crate) async fn list_global_mcp_servers() -> Result<Vec<GlobalMcpServerEntry>, String> {
    let home = dirs::home_dir().ok_or_else(|| "Cannot determine home directory".to_string())?;
    let claude_json_path = home.join(".claude.json");
    if claude_json_path.exists() {
        match read_json_file(&claude_json_path)
            .and_then(|root| parse_mcp_entries_from_json_value(&root, "claude_json"))
        {
            Ok(entries) if !entries.is_empty() => return Ok(entries),
            Ok(_) => {}
            Err(error) => {
                log::warn!(
                    "[list_global_mcp_servers] Failed to parse {}: {}",
                    claude_json_path.display(),
                    error
                );
            }
        }
    }

    let codemoss_config_path = home.join(".codemoss").join("config.json");
    if codemoss_config_path.exists() {
        match read_json_file(&codemoss_config_path)
            .and_then(|root| parse_mcp_entries_from_json_value(&root, "codemoss_config"))
        {
            Ok(entries) => return Ok(entries),
            Err(error) => {
                log::warn!(
                    "[list_global_mcp_servers] Failed to parse {}: {}",
                    codemoss_config_path.display(),
                    error
                );
            }
        }
    }

    Ok(Vec::new())
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

/// Ensure a Codex session exists for the workspace. If not, spawn one.
/// This is called before sending messages to handle the case where user
/// switches from Claude to Codex engine without reconnecting the workspace.
pub(crate) async fn ensure_codex_session(
    workspace_id: &str,
    state: &AppState,
    app: &AppHandle,
) -> Result<(), String> {
    // Check if session already exists
    {
        let sessions = state.sessions.lock().await;
        if sessions.contains_key(workspace_id) {
            return Ok(());
        }
    }

    // Session doesn't exist, spawn one
    log::info!(
        "[ensure_codex_session] No session for workspace {}, spawning new Codex session",
        workspace_id
    );

    let (entry, parent_entry) = {
        let workspaces = state.workspaces.lock().await;
        let entry = workspaces
            .get(workspace_id)
            .cloned()
            .ok_or_else(|| "workspace not found".to_string())?;
        let parent_entry = entry
            .parent_id
            .as_ref()
            .and_then(|pid| workspaces.get(pid).cloned());
        (entry, parent_entry)
    };

    let (default_bin, codex_args) = {
        let settings = state.app_settings.lock().await;
        (
            settings.codex_bin.clone(),
            resolve_workspace_codex_args(&entry, parent_entry.as_ref(), Some(&settings)),
        )
    };

    let codex_home = resolve_workspace_codex_home(&entry, parent_entry.as_ref());
    let mode_enforcement_enabled = {
        let settings = state.app_settings.lock().await;
        settings.codex_mode_enforcement_enabled
    };

    let session = spawn_workspace_session(
        entry.clone(),
        default_bin,
        codex_args,
        app.clone(),
        codex_home,
    )
    .await?;
    session.set_mode_enforcement_enabled(mode_enforcement_enabled);

    state.sessions.lock().await.insert(entry.id, session);
    Ok(())
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
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    if remote_backend::is_remote_mode(&*state).await {
        remote_backend::call_remote(
            &*state,
            app,
            "respond_to_server_request",
            json!({ "workspaceId": workspace_id, "requestId": request_id, "result": result }),
        )
        .await?;
        return Ok(());
    }

    // Route to the appropriate engine based on active engine type
    let active_engine = state.engine_manager.get_active_engine().await;
    if active_engine == crate::engine::EngineType::Claude {
        if let Some(session) = state
            .engine_manager
            .claude_manager
            .get_session(&workspace_id)
            .await
        {
            return session.respond_to_user_input(request_id, result).await;
        }
    }

    codex_core::respond_to_server_request_core(&state.sessions, workspace_id, request_id, result)
        .await
}

/// Gets the diff content for commit message generation
#[tauri::command]
pub(crate) async fn get_commit_message_prompt(
    workspace_id: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    // Get the diff from git
    let diff = crate::git::get_workspace_diff(&workspace_id, &state).await?;

    if diff.trim().is_empty() {
        return Err("No changes to generate commit message for".to_string());
    }

    let prompt = format!(
        "Generate a concise git commit message for the following changes. \
Follow conventional commit format (e.g., feat:, fix:, refactor:, docs:, etc.). \
Focus on the 'why' rather than the 'what'. Keep the summary line under 72 characters. \
Only output the commit message, nothing else.\n\n\
Changes:\n{diff}"
    );

    Ok(prompt)
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
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<String, String> {
    // Get the diff from git
    let diff = crate::git::get_workspace_diff(&workspace_id, &state).await?;

    if diff.trim().is_empty() {
        return Err("No changes to generate commit message for".to_string());
    }

    let prompt = format!(
        "Generate a concise git commit message for the following changes. \
Follow conventional commit format (e.g., feat:, fix:, refactor:, docs:, etc.). \
Focus on the 'why' rather than the 'what'. Keep the summary line under 72 characters. \
Only output the commit message, nothing else.\n\n\
Changes:\n{diff}"
    );

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

fn extract_json_value(raw: &str) -> Option<Value> {
    let start = raw.find('{')?;
    let end = raw.rfind('}')?;
    if end <= start {
        return None;
    }
    serde_json::from_str::<Value>(&raw[start..=end]).ok()
}

fn sanitize_run_worktree_name(value: &str) -> String {
    let trimmed = value.trim().to_lowercase();
    let mut cleaned = String::new();
    let mut last_dash = false;
    for ch in trimmed.chars() {
        let next = if ch.is_ascii_alphanumeric() || ch == '/' {
            last_dash = false;
            Some(ch)
        } else if ch == '-' || ch.is_whitespace() || ch == '_' {
            if last_dash {
                None
            } else {
                last_dash = true;
                Some('-')
            }
        } else {
            None
        };
        if let Some(ch) = next {
            cleaned.push(ch);
        }
    }
    while cleaned.ends_with('-') || cleaned.ends_with('/') {
        cleaned.pop();
    }
    let allowed_prefixes = [
        "feat/",
        "fix/",
        "chore/",
        "test/",
        "docs/",
        "refactor/",
        "perf/",
        "build/",
        "ci/",
        "style/",
    ];
    if allowed_prefixes
        .iter()
        .any(|prefix| cleaned.starts_with(prefix))
    {
        return cleaned;
    }
    for prefix in allowed_prefixes.iter() {
        let dash_prefix = prefix.replace('/', "-");
        if cleaned.starts_with(&dash_prefix) {
            return cleaned.replacen(&dash_prefix, prefix, 1);
        }
    }
    format!("feat/{}", cleaned.trim_start_matches('/'))
}

#[cfg(test)]
mod tests {
    use super::{
        build_local_codex_session_preview,
        build_local_codex_thread_fallback_response_from_sessions, build_thread_list_empty_response,
        normalize_model_id, pick_model_from_model_list_response,
    };
    use crate::types::{LocalUsageSessionSummary, LocalUsageUsageData};
    use serde_json::json;

    #[test]
    fn normalize_model_id_trims_and_filters_empty() {
        assert_eq!(
            normalize_model_id(Some(" gpt-5 ".to_string())),
            Some("gpt-5".to_string())
        );
        assert_eq!(normalize_model_id(Some("   ".to_string())), None);
        assert_eq!(normalize_model_id(None), None);
    }

    #[test]
    fn pick_model_prefers_default_entry() {
        let response = json!({
            "result": {
                "data": [
                    { "id": "openai/gpt-4.1", "isDefault": false },
                    { "model": "openai/gpt-5.3-codex", "isDefault": true }
                ]
            }
        });
        assert_eq!(
            pick_model_from_model_list_response(&response),
            Some("openai/gpt-5.3-codex".to_string())
        );
    }

    #[test]
    fn pick_model_falls_back_to_first_entry() {
        let response = json!({
            "data": [
                { "id": "openai/gpt-5-mini" },
                { "model": "openai/gpt-5.3-codex" }
            ]
        });
        assert_eq!(
            pick_model_from_model_list_response(&response),
            Some("openai/gpt-5-mini".to_string())
        );
    }

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
    fn build_local_codex_thread_fallback_response_maps_and_limits_entries() {
        let sessions = vec![
            LocalUsageSessionSummary {
                session_id: "session-a".to_string(),
                timestamp: 1_700_000_001_000,
                model: "openai/gpt-5".to_string(),
                usage: LocalUsageUsageData::default(),
                cost: 0.0,
                summary: Some("  hello world  ".to_string()),
            },
            LocalUsageSessionSummary {
                session_id: "session-b".to_string(),
                timestamp: 1_700_000_002_000,
                model: "openai/gpt-5-mini".to_string(),
                usage: LocalUsageUsageData::default(),
                cost: 0.0,
                summary: None,
            },
        ];

        let response = build_local_codex_thread_fallback_response_from_sessions(
            "/tmp/workspace",
            &sessions,
            1,
        );
        let data = response["result"]["data"]
            .as_array()
            .expect("fallback data array");

        assert_eq!(data.len(), 1);
        assert_eq!(data[0]["id"], "session-a");
        assert_eq!(data[0]["preview"], "hello world");
        assert_eq!(data[0]["title"], "hello world");
        assert_eq!(data[0]["cwd"], "/tmp/workspace");
        assert_eq!(data[0]["createdAt"], 1_700_000_001_000_i64);
        assert_eq!(data[0]["updatedAt"], 1_700_000_001_000_i64);
        assert_eq!(data[0]["localFallback"], true);
        assert!(response["result"]["nextCursor"].is_null());
    }
}
