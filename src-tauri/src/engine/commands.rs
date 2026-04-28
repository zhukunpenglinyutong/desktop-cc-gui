//! Tauri commands for engine management
//!
//! Provides frontend-accessible commands for engine detection, switching,
//! and configuration.

use chrono::{
    DateTime, Duration as ChronoDuration, Local, NaiveDate, NaiveDateTime, NaiveTime, TimeZone,
};
use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio::time::timeout;

use crate::backend::events::AppServerEvent;
use crate::remote_backend;
use crate::state::AppState;
use crate::types::WorkspaceEntry;

use super::codex_prompt_service::{normalize_custom_spec_root, run_codex_prompt_sync};
use super::events::{engine_event_to_app_server_event, EngineEvent};
use super::remote_bridge::{
    call_remote_typed, remote_detect_engines_request, remote_engine_interrupt_request,
    remote_engine_send_message_sync_request,
};
use super::status::{detect_gemini_status, detect_opencode_status};
use super::{EngineConfig, EngineStatus, EngineType};

#[path = "claude_forwarder.rs"]
mod claude_forwarder;
#[path = "commands_opencode.rs"]
mod commands_opencode;
#[path = "commands_opencode_helpers.rs"]
mod opencode_helpers;
#[path = "commands_parse_helpers.rs"]
mod parse_helpers;
use claude_forwarder::{
    handle_claude_forwarder_event, ClaudeForwarderRuntimeContext, ClaudeForwarderState,
};
pub use commands_opencode::*;
use opencode_helpers::*;
use parse_helpers::*;

/// Maximum lifetime for an event forwarder task. Prevents orphaned tasks from
/// leaking memory when the underlying process hangs or is killed externally.
const EVENT_FORWARDER_TIMEOUT_SECS: u64 = 30 * 60;
/// Gemini may emit fallback reasoning shortly after turn/completed.
/// Keep the forwarder alive briefly so realtime reasoning is not dropped.
const GEMINI_POST_COMPLETION_REASONING_GRACE_MS: u64 = 8_000;

#[derive(Clone, Copy, PartialEq, Eq)]
enum GeminiRenderLane {
    Text,
    Reasoning,
    Tool,
    Other,
}

impl Default for GeminiRenderLane {
    fn default() -> Self {
        Self::Other
    }
}

#[derive(Default)]
struct GeminiRenderRoutingState {
    last_render_lane: GeminiRenderLane,
    text_run_index: usize,
    reasoning_run_index: usize,
    active_text_item_id: Option<String>,
    active_reasoning_item_id: Option<String>,
    saw_text_delta: bool,
}

fn next_gemini_routed_item_id(
    state: &mut GeminiRenderRoutingState,
    render_lane: GeminiRenderLane,
    base_item_id: &str,
) -> String {
    if matches!(render_lane, GeminiRenderLane::Text)
        && (state.last_render_lane != GeminiRenderLane::Text || state.active_text_item_id.is_none())
    {
        state.text_run_index += 1;
        let text_item_id = if state.text_run_index == 1 {
            base_item_id.to_string()
        } else {
            format!("{base_item_id}:text-{}", state.text_run_index)
        };
        state.active_text_item_id = Some(text_item_id);
    }

    if matches!(render_lane, GeminiRenderLane::Reasoning)
        && (state.last_render_lane != GeminiRenderLane::Reasoning
            || state.active_reasoning_item_id.is_none())
    {
        state.reasoning_run_index += 1;
        state.active_reasoning_item_id = Some(format!(
            "{base_item_id}:reasoning-seg-{}",
            state.reasoning_run_index
        ));
    }

    let routed_item_id = match render_lane {
        GeminiRenderLane::Text => state
            .active_text_item_id
            .clone()
            .unwrap_or_else(|| base_item_id.to_string()),
        GeminiRenderLane::Reasoning => state
            .active_reasoning_item_id
            .clone()
            .unwrap_or_else(|| base_item_id.to_string()),
        GeminiRenderLane::Tool | GeminiRenderLane::Other => base_item_id.to_string(),
    };

    if !matches!(render_lane, GeminiRenderLane::Other) {
        state.last_render_lane = render_lane;
        if !matches!(render_lane, GeminiRenderLane::Reasoning) {
            state.active_reasoning_item_id = None;
        }
        if !matches!(render_lane, GeminiRenderLane::Text) {
            state.active_text_item_id = None;
        }
    }

    routed_item_id
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenCodeCommandEntry {
    pub name: String,
    pub description: Option<String>,
    #[serde(rename = "argumentHint")]
    pub argument_hint: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenCodeAgentEntry {
    pub id: String,
    pub description: Option<String>,
    pub is_primary: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenCodeProviderHealth {
    pub provider: String,
    pub connected: bool,
    pub credential_count: usize,
    pub matched: bool,
    pub authenticated_providers: Vec<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenCodeMcpServerState {
    pub name: String,
    pub enabled: bool,
    pub status: Option<String>,
    pub permission_hint: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenCodeStatusSnapshot {
    pub session_id: Option<String>,
    pub model: Option<String>,
    pub agent: Option<String>,
    pub variant: Option<String>,
    pub provider: Option<String>,
    pub provider_health: OpenCodeProviderHealth,
    pub mcp_enabled: bool,
    pub mcp_servers: Vec<OpenCodeMcpServerState>,
    pub mcp_raw: String,
    pub managed_toggles: bool,
    pub token_usage: Option<u64>,
    pub context_window: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenCodeSessionEntry {
    pub session_id: String,
    pub title: String,
    pub updated_label: String,
    pub updated_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenCodeProviderOption {
    pub id: String,
    pub label: String,
    pub description: Option<String>,
    pub category: String,
    pub recommended: bool,
}

#[derive(Debug, Clone, Default)]
struct OpenCodeMcpToggleState {
    global_enabled: bool,
    server_enabled: HashMap<String, bool>,
}

const OPENCODE_CACHE_TTL: Duration = Duration::from_secs(30);
static OPENCODE_COMMANDS_CACHE: OnceLock<Mutex<Option<(Instant, Vec<OpenCodeCommandEntry>)>>> =
    OnceLock::new();
static OPENCODE_AGENTS_CACHE: OnceLock<Mutex<Option<(Instant, Vec<OpenCodeAgentEntry>)>>> =
    OnceLock::new();
static OPENCODE_MCP_TOGGLE_STATE: OnceLock<Mutex<HashMap<String, OpenCodeMcpToggleState>>> =
    OnceLock::new();

fn strip_ansi_codes(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\u{1b}' {
            if let Some('[') = chars.peek().copied() {
                let _ = chars.next();
                for c in chars.by_ref() {
                    if ('@'..='~').contains(&c) {
                        break;
                    }
                }
                continue;
            }
        }
        out.push(ch);
    }
    out
}

fn extract_turn_result_text_internal(value: &Value, depth: usize) -> Option<String> {
    if depth > 4 {
        return None;
    }
    if let Some(text) = value
        .as_str()
        .map(str::trim)
        .filter(|text| !text.is_empty())
    {
        return Some(text.to_string());
    }
    if let Some(array) = value.as_array() {
        let mut merged = String::new();
        for item in array {
            if let Some(text) = extract_turn_result_text_internal(item, depth + 1) {
                if !merged.is_empty() {
                    merged.push('\n');
                }
                merged.push_str(&text);
            }
        }
        return if merged.trim().is_empty() {
            None
        } else {
            Some(merged)
        };
    }
    if let Some(object) = value.as_object() {
        for key in [
            "text",
            "delta",
            "output_text",
            "outputText",
            "content",
            "message",
        ] {
            if let Some(text) = object
                .get(key)
                .and_then(|entry| entry.as_str())
                .map(str::trim)
                .filter(|entry| !entry.is_empty())
            {
                return Some(text.to_string());
            }
        }
        for key in [
            "result", "response", "content", "message", "output", "data", "payload",
        ] {
            if let Some(entry) = object.get(key) {
                if let Some(text) = extract_turn_result_text_internal(entry, depth + 1) {
                    return Some(text);
                }
            }
        }
    }
    None
}

fn extract_turn_result_text(result: Option<&Value>) -> Option<String> {
    result.and_then(|value| extract_turn_result_text_internal(value, 0))
}

fn should_prefer_turn_result_text(result: Option<&Value>) -> bool {
    result
        .and_then(|value| value.get("syntheticApprovalResolved"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

fn is_likely_foreign_model_for_gemini(model: &str) -> bool {
    let normalized = model.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return false;
    }
    if normalized.contains("gemini") {
        return false;
    }
    if normalized.starts_with("claude-") {
        return true;
    }
    if normalized.starts_with("gpt-") || normalized.contains("codex") {
        return true;
    }
    normalized.starts_with("openai/")
        || normalized.starts_with("anthropic/")
        || normalized.starts_with("x-ai/")
        || normalized.starts_with("openrouter/")
        || normalized.starts_with("deepseek/")
        || normalized.starts_with("qwen/")
        || normalized.starts_with("meta/")
        || normalized.starts_with("mistral/")
}

fn is_likely_legacy_claude_model_id(model: &str) -> bool {
    model.trim().to_ascii_lowercase().starts_with("claude-")
}

fn is_valid_claude_model_for_passthrough(model: &str) -> bool {
    let trimmed = model.trim();
    if trimmed.is_empty() || trimmed.len() > 128 {
        return false;
    }
    trimmed.chars().all(|ch| {
        ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | ':' | '/' | '[' | ']')
    })
}

fn resolve_opencode_bin(config: Option<&EngineConfig>) -> String {
    if let Some(custom) = config.and_then(|c| c.bin_path.as_ref()) {
        return custom.clone();
    }
    crate::backend::app_server::find_cli_binary("opencode", None)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "opencode".to_string())
}

fn build_opencode_command(config: Option<&EngineConfig>) -> Command {
    let bin = resolve_opencode_bin(config);
    let mut cmd = crate::backend::app_server::build_command_for_binary(&bin);
    if let Some(home) = config.and_then(|c| c.home_dir.as_ref()) {
        cmd.env("OPENCODE_HOME", home);
    }
    cmd
}

fn opencode_session_candidate_paths(
    workspace_path: &Path,
    session_id: &str,
    config: Option<&EngineConfig>,
) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(home) = config.and_then(|item| item.home_dir.as_ref()) {
        roots.push(PathBuf::from(home).join("sessions"));
    }
    if let Some(home) = std::env::var_os("OPENCODE_HOME") {
        roots.push(PathBuf::from(home).join("sessions"));
    }
    if let Some(home) = dirs::home_dir() {
        roots.push(home.join(".opencode").join("sessions"));
    }
    roots.push(workspace_path.join(".opencode").join("sessions"));

    let mut candidates = Vec::new();
    for root in roots {
        for candidate in [
            root.join(session_id),
            root.join(format!("{session_id}.json")),
        ] {
            if !candidates.contains(&candidate) {
                candidates.push(candidate);
            }
        }
    }
    candidates
}

fn delete_opencode_session_files(
    workspace_path: &Path,
    session_id: &str,
    config: Option<&EngineConfig>,
) -> Result<(), String> {
    let normalized_session_id = session_id.trim();
    if normalized_session_id.is_empty()
        || normalized_session_id.contains('/')
        || normalized_session_id.contains('\\')
        || normalized_session_id.contains("..")
    {
        return Err("[SESSION_NOT_FOUND] Invalid OpenCode session id".to_string());
    }

    let mut deleted_any = false;

    let candidates =
        opencode_session_candidate_paths(workspace_path, normalized_session_id, config);
    for candidate in candidates {
        if !candidate.exists() {
            continue;
        }
        let delete_result = if candidate.is_dir() {
            fs::remove_dir_all(&candidate)
        } else {
            fs::remove_file(&candidate)
        };
        match delete_result {
            Ok(()) => {
                deleted_any = true;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => {
                return Err(format!(
                    "[IO_ERROR] Failed to delete OpenCode session path {}: {}",
                    candidate.display(),
                    error
                ));
            }
        }
    }

    for data_root in opencode_data_candidate_roots(workspace_path, config) {
        match delete_opencode_session_from_datastore(&data_root, normalized_session_id) {
            Ok(true) => {
                deleted_any = true;
            }
            Ok(false) => {}
            Err(error) => return Err(error),
        }
    }

    if deleted_any {
        return Ok(());
    }

    Err(format!(
        "[SESSION_NOT_FOUND] OpenCode session file not found: {}",
        normalized_session_id
    ))
}

fn opencode_data_candidate_roots(
    workspace_path: &Path,
    config: Option<&EngineConfig>,
) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(home) = config.and_then(|item| item.home_dir.as_ref()) {
        roots.push(PathBuf::from(home));
    }
    if let Some(home) = std::env::var_os("OPENCODE_HOME") {
        roots.push(PathBuf::from(home));
    }
    if let Some(data_home) = dirs::data_local_dir() {
        roots.push(data_home.join("opencode"));
    }
    if let Some(data_dir) = dirs::data_dir() {
        roots.push(data_dir.join("opencode"));
    }
    if let Some(home) = dirs::home_dir() {
        roots.push(home.join(".local").join("share").join("opencode"));
    }
    roots.push(workspace_path.join(".opencode"));

    let mut deduped = Vec::new();
    for root in roots {
        if !deduped.contains(&root) {
            deduped.push(root);
        }
    }
    deduped
}

fn delete_path_if_exists(path: &Path) -> Result<bool, String> {
    if !path.exists() {
        return Ok(false);
    }
    let result = if path.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    };
    match result {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!(
            "[IO_ERROR] Failed to delete OpenCode session path {}: {}",
            path.display(),
            error
        )),
    }
}

fn delete_opencode_session_from_datastore(
    data_root: &Path,
    session_id: &str,
) -> Result<bool, String> {
    let mut deleted_any = false;

    let db_path = data_root.join("opencode.db");
    if db_path.exists() {
        let connection = Connection::open(&db_path).map_err(|error| {
            format!(
                "[IO_ERROR] Failed to open OpenCode datastore {}: {}",
                db_path.display(),
                error
            )
        })?;
        connection
            .pragma_update(None, "foreign_keys", "ON")
            .map_err(|error| {
                format!(
                    "[IO_ERROR] Failed to enable OpenCode datastore foreign_keys {}: {}",
                    db_path.display(),
                    error
                )
            })?;
        let deleted_rows = connection
            .execute("DELETE FROM session WHERE id = ?1", params![session_id])
            .map_err(|error| {
                format!(
                    "[IO_ERROR] Failed to delete OpenCode session {} in {}: {}",
                    session_id,
                    db_path.display(),
                    error
                )
            })?;
        if deleted_rows > 0 {
            deleted_any = true;
        }
    }

    let storage_root = data_root.join("storage");
    if storage_root.exists() {
        let reader = fs::read_dir(&storage_root).map_err(|error| {
            format!(
                "[IO_ERROR] Failed to read OpenCode storage directory {}: {}",
                storage_root.display(),
                error
            )
        })?;
        for entry in reader {
            let entry = entry.map_err(|error| {
                format!(
                    "[IO_ERROR] Failed to read OpenCode storage entry under {}: {}",
                    storage_root.display(),
                    error
                )
            })?;
            let parent = entry.path();
            if !parent.is_dir() {
                continue;
            }
            if delete_path_if_exists(&parent.join(session_id))? {
                deleted_any = true;
            }
            if delete_path_if_exists(&parent.join(format!("{session_id}.json")))? {
                deleted_any = true;
            }
        }
    }

    Ok(deleted_any)
}

fn slugify_provider_label(value: &str) -> String {
    let mut out = String::new();
    let mut last_dash = false;
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            last_dash = false;
            continue;
        }
        if !last_dash {
            out.push('-');
            last_dash = true;
        }
    }
    out.trim_matches('-').to_string()
}

fn parse_provider_option_line(line: &str, category: &str) -> Option<OpenCodeProviderOption> {
    let trimmed = line
        .trim_start_matches(|ch: char| matches!(ch, '●' | '○' | '◆' | '◇' | '│'))
        .trim();
    if trimmed.is_empty() || trimmed.starts_with("Search:") || trimmed == "..." {
        return None;
    }
    let lower = trimmed.to_ascii_lowercase();
    if lower == "select provider"
        || lower == "add credential"
        || lower == "login method"
        || lower.contains("to select")
        || lower.contains("enter: confirm")
        || lower.contains("type: to search")
        || lower.starts_with("search:")
        || trimmed.starts_with('┌')
        || trimmed.starts_with('└')
        || trimmed.starts_with('■')
        || trimmed.starts_with('│')
    {
        return None;
    }
    let (label, description) = if let Some((left, right)) = trimmed.split_once('(') {
        (
            left.trim().to_string(),
            Some(right.trim_end_matches(')').trim().to_string()),
        )
    } else {
        (trimmed.to_string(), None)
    };
    if label.is_empty() {
        return None;
    }
    let id = slugify_provider_label(&label);
    if id.is_empty() {
        return None;
    }
    let recommended = description
        .as_ref()
        .map(|text| text.to_ascii_lowercase().contains("recommended"))
        .unwrap_or(false);
    Some(OpenCodeProviderOption {
        id,
        label,
        description,
        category: category.to_string(),
        recommended,
    })
}

fn fallback_opencode_provider_catalog() -> Vec<OpenCodeProviderOption> {
    let popular = vec![
        ("opencode-zen", "OpenCode Zen", Some("recommended")),
        ("anthropic", "Anthropic", Some("Claude Max or API key")),
        ("github-copilot", "GitHub Copilot", None),
        ("openai", "OpenAI", Some("ChatGPT Plus/Pro or API key")),
        ("google", "Google", None),
    ];
    let other = vec![
        ("z-ai", "Z.AI"),
        ("zenmux", "ZenMux"),
        ("io-net", "IO.NET"),
        ("nvidia", "Nvidia"),
        ("fastrouter", "FastRouter"),
        ("iflow", "iFlow"),
        ("modelscope", "ModelScope"),
        ("llama", "Llama"),
    ];

    let mut out = Vec::new();
    for (id, label, description) in popular {
        out.push(OpenCodeProviderOption {
            id: id.to_string(),
            label: label.to_string(),
            description: description.map(ToOwned::to_owned),
            category: "popular".to_string(),
            recommended: description
                .map(|text| text.to_ascii_lowercase().contains("recommended"))
                .unwrap_or(false),
        });
    }
    for (id, label) in other {
        out.push(OpenCodeProviderOption {
            id: id.to_string(),
            label: label.to_string(),
            description: None,
            category: "other".to_string(),
            recommended: false,
        });
    }
    out
}

async fn fetch_opencode_provider_catalog_preview(
    workspace_path: &PathBuf,
    config: Option<&EngineConfig>,
) -> Vec<OpenCodeProviderOption> {
    let mut cmd = build_opencode_command(config);
    cmd.current_dir(workspace_path);
    cmd.arg("auth");
    cmd.arg("login");
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.stdin(Stdio::null());
    let mut child = match cmd.spawn() {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };
    tokio::time::sleep(Duration::from_millis(900)).await;
    let _ = child.start_kill();
    let output = match tokio::time::timeout(Duration::from_secs(2), child.wait_with_output()).await
    {
        Ok(Ok(value)) => value,
        _ => return Vec::new(),
    };
    let stdout = strip_ansi_codes(&String::from_utf8_lossy(&output.stdout));
    let mut providers: Vec<OpenCodeProviderOption> = Vec::new();
    let mut category = "popular".to_string();
    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.eq_ignore_ascii_case("Popular") {
            category = "popular".to_string();
            continue;
        }
        if trimmed.eq_ignore_ascii_case("Other") {
            category = "other".to_string();
            continue;
        }
        if let Some(option) = parse_provider_option_line(line, &category) {
            providers.push(option);
        }
    }
    providers.sort_by(|a, b| a.label.cmp(&b.label));
    providers.dedup_by(|a, b| a.id == b.id);
    providers
}

async fn fetch_opencode_provider_catalog_from_auth_picker(
    workspace_path: &PathBuf,
    config: Option<&EngineConfig>,
) -> Vec<OpenCodeProviderOption> {
    let mut cmd = build_opencode_command(config);
    cmd.current_dir(workspace_path);
    cmd.arg("auth");
    cmd.arg("login");
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.stdin(Stdio::piped());
    let mut child = match cmd.spawn() {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };

    if let Some(stdin) = child.stdin.as_mut() {
        let mut payload = String::new();
        for _ in 0..520 {
            payload.push_str("\u{1b}[B");
        }
        payload.push('\u{3}');
        if stdin.write_all(payload.as_bytes()).await.is_err() {
            let _ = child.start_kill();
            return Vec::new();
        }
        let _ = stdin.flush().await;
    }

    let output = match tokio::time::timeout(Duration::from_secs(12), child.wait_with_output()).await
    {
        Ok(Ok(value)) => value,
        _ => return Vec::new(),
    };
    let stdout = strip_ansi_codes(&String::from_utf8_lossy(&output.stdout));
    let mut providers: Vec<OpenCodeProviderOption> = Vec::new();
    let mut category = "popular".to_string();
    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.eq_ignore_ascii_case("Popular") {
            category = "popular".to_string();
            continue;
        }
        if trimmed.eq_ignore_ascii_case("Other") {
            category = "other".to_string();
            continue;
        }
        if let Some(option) = parse_provider_option_line(line, &category) {
            if let Some(existing) = providers.iter_mut().find(|item| item.id == option.id) {
                if option.category == "popular" {
                    existing.category = "popular".to_string();
                }
                if existing.description.is_none() && option.description.is_some() {
                    existing.description = option.description.clone();
                }
                existing.recommended = existing.recommended || option.recommended;
                continue;
            }
            providers.push(option);
        }
    }
    providers.sort_by(|a, b| {
        let score_a = if a.category == "popular" { 0 } else { 1 };
        let score_b = if b.category == "popular" { 0 } else { 1 };
        score_a
            .cmp(&score_b)
            .then_with(|| b.recommended.cmp(&a.recommended))
            .then_with(|| a.label.cmp(&b.label))
    });
    providers.dedup_by(|a, b| a.id == b.id);
    providers
}

/// Detect all installed engines and their capabilities
#[tauri::command]
pub async fn detect_engines(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Vec<EngineStatus>, String> {
    if remote_backend::is_remote_mode(&*state).await {
        let (method, params) = remote_detect_engines_request();
        return call_remote_typed(&*state, &app, method, params).await;
    }
    let manager = &state.engine_manager;
    Ok(manager.detect_engines().await)
}

/// Get the currently active engine
#[tauri::command]
pub async fn get_active_engine(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<EngineType, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return call_remote_typed(&*state, &app, "get_active_engine", json!({})).await;
    }
    let manager = &state.engine_manager;
    Ok(manager.get_active_engine().await)
}

/// Switch to a different engine
#[tauri::command]
pub async fn switch_engine(
    engine_type: EngineType,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    if remote_backend::is_remote_mode(&*state).await {
        let _: Value = call_remote_typed(
            &*state,
            &app,
            "switch_engine",
            json!({ "engineType": engine_type }),
        )
        .await?;
        return Ok(());
    }
    let manager = &state.engine_manager;
    manager.set_active_engine(engine_type).await
}

/// Get cached status for a specific engine
#[tauri::command]
pub async fn get_engine_status(
    engine_type: EngineType,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Option<EngineStatus>, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return call_remote_typed(
            &*state,
            &app,
            "get_engine_status",
            json!({ "engineType": engine_type }),
        )
        .await;
    }
    let manager = &state.engine_manager;
    Ok(manager.get_engine_status(engine_type).await)
}

/// Get all cached engine statuses
#[tauri::command]
pub async fn get_all_engine_statuses(
    state: State<'_, AppState>,
) -> Result<Vec<EngineStatus>, String> {
    let manager = &state.engine_manager;
    Ok(manager.get_all_statuses().await)
}

/// Set engine configuration
#[tauri::command]
pub async fn set_engine_config(
    engine_type: EngineType,
    config: EngineConfig,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let manager = &state.engine_manager;
    manager.set_engine_config(engine_type, config).await;
    Ok(())
}

/// Get engine configuration
#[tauri::command]
pub async fn get_engine_config(
    engine_type: EngineType,
    state: State<'_, AppState>,
) -> Result<Option<EngineConfig>, String> {
    let manager = &state.engine_manager;
    Ok(manager.get_engine_config(engine_type).await)
}

/// Check if an engine is available
#[tauri::command]
pub async fn is_engine_available(
    engine_type: EngineType,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let manager = &state.engine_manager;
    Ok(manager.is_engine_available(engine_type).await)
}

/// Get list of available engines
#[tauri::command]
pub async fn get_available_engines(state: State<'_, AppState>) -> Result<Vec<EngineType>, String> {
    let manager = &state.engine_manager;
    Ok(manager.get_available_engines().await)
}

/// Get models for a specific engine
#[tauri::command]
pub async fn get_engine_models(
    engine_type: EngineType,
    force_refresh: Option<bool>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Vec<super::ModelInfo>, String> {
    let force_refresh = force_refresh.unwrap_or(false);
    if remote_backend::is_remote_mode(&*state).await {
        return call_remote_typed(
            &*state,
            &app,
            "get_engine_models",
            json!({ "engineType": engine_type, "forceRefresh": force_refresh }),
        )
        .await;
    }
    let manager = &state.engine_manager;

    match engine_type {
        EngineType::OpenCode => {
            let config = manager.get_engine_config(EngineType::OpenCode).await;
            let custom_bin = config
                .as_ref()
                .and_then(|cfg| cfg.bin_path.as_ref())
                .map(|s| s.as_str());
            let fresh_status = detect_opencode_status(custom_bin).await;

            if !fresh_status.models.is_empty() {
                return Ok(fresh_status.models);
            }

            if let Some(cached) = manager.get_engine_status(EngineType::OpenCode).await {
                if !cached.models.is_empty() {
                    return Ok(cached.models);
                }
            }

            Ok(fresh_status.models)
        }
        EngineType::Gemini => {
            let config = manager.get_engine_config(EngineType::Gemini).await;
            let custom_bin = config
                .as_ref()
                .and_then(|cfg| cfg.bin_path.as_ref())
                .map(|s| s.as_str());
            let fresh_status = detect_gemini_status(custom_bin).await;

            if !fresh_status.models.is_empty() {
                return Ok(fresh_status.models);
            }

            if let Some(cached) = manager.get_engine_status(EngineType::Gemini).await {
                if !cached.models.is_empty() {
                    return Ok(cached.models);
                }
            }

            Ok(fresh_status.models)
        }
        EngineType::Claude | EngineType::Codex => {
            if force_refresh {
                let status = manager.refresh_engine_status(engine_type).await;
                return Ok(status.models);
            }

            if let Some(status) = manager.get_engine_status(engine_type).await {
                if !status.models.is_empty() {
                    return Ok(status.models);
                }
            }

            let statuses = manager.detect_engines().await;
            let detected = statuses.into_iter().find(|s| s.engine_type == engine_type);

            if let Some(status) = detected {
                Ok(status.models)
            } else {
                Err(format!("{} not detected", engine_type.display_name()))
            }
        }
    }
}

/// Send a message using the active engine
/// For Claude: spawns async tasks for streaming events to the frontend
/// via app-server-event, returns immediately with turn ID.
#[tauri::command]
pub async fn engine_send_message(
    workspace_id: String,
    text: String,
    engine: Option<EngineType>,
    model: Option<String>,
    effort: Option<String>,
    access_mode: Option<String>,
    images: Option<Vec<String>>,
    continue_session: bool,
    thread_id: Option<String>,
    session_id: Option<String>,
    agent: Option<String>,
    variant: Option<String>,
    custom_spec_root: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        let images = images.map(|paths| {
            paths
                .into_iter()
                .map(remote_backend::normalize_path_for_remote)
                .collect::<Vec<_>>()
        });
        return remote_backend::call_remote(
            &*state,
            app,
            "engine_send_message",
            json!({
                "workspaceId": workspace_id,
                "text": text,
                "engine": engine,
                "model": model,
                "effort": effort,
                "accessMode": access_mode,
                "images": images,
                "continueSession": continue_session,
                "threadId": thread_id,
                "sessionId": session_id,
                "agent": agent,
                "variant": variant,
                "customSpecRoot": custom_spec_root,
            }),
        )
        .await;
    }

    let manager = &state.engine_manager;
    let active_engine = manager.get_active_engine().await;
    let requested_engine = engine;
    let effective_engine = requested_engine.unwrap_or(active_engine);
    log::info!(
        "[engine_send_message] engine={:?} active_engine={:?} workspace_id={} model={:?} continue_session={} thread_id={:?} session_id={:?} agent={:?} variant={:?}",
        effective_engine,
        active_engine,
        workspace_id,
        model,
        continue_session,
        thread_id,
        session_id,
        agent,
        variant
    );
    if let Some(explicit_engine) = requested_engine {
        if explicit_engine != active_engine {
            log::warn!(
                "[engine_send_message] explicit engine {:?} overrides active engine {:?}",
                explicit_engine,
                active_engine
            );
        }
    }
    let normalized_custom_spec_root = normalize_custom_spec_root(custom_spec_root.as_deref());

    match effective_engine {
        EngineType::Claude => {
            let workspace_entry = {
                let workspaces = state.workspaces.lock().await;
                workspaces
                    .get(&workspace_id)
                    .cloned()
                    .ok_or_else(|| "Workspace not found".to_string())?
            };
            let workspace_path = std::path::PathBuf::from(&workspace_entry.path);
            state
                .runtime_manager
                .record_starting(&workspace_entry, "claude", "engine-send-message")
                .await;

            let session = manager
                .get_claude_session(&workspace_id, &workspace_path)
                .await;

            let has_images = images
                .as_ref()
                .is_some_and(|entries| entries.iter().any(|entry| !entry.trim().is_empty()));
            let continue_session_for_send = continue_session;

            // Resolve session id according to mode:
            // 1) continue_session=true  -> explicit session_id or tracked session id
            // 2) continue_session=false -> force a fresh unique session id so concurrent
            //    Claude turns never collapse into one shared persisted session.
            let resolved_session_id = if continue_session {
                if session_id.is_some() {
                    session_id
                } else {
                    session.get_session_id().await
                }
            } else {
                Some(session_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string()))
            };

            let sanitized_model = model
                .as_ref()
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
                .and_then(|value| {
                    if is_valid_claude_model_for_passthrough(value) {
                        Some(value.to_string())
                    } else {
                        None
                    }
                });
            if model.is_some() && sanitized_model.is_none() {
                log::warn!(
                    "[engine_send_message] dropped invalid claude model={:?}, fallback to default",
                    model
                );
            }

            let response_session_id = resolved_session_id.clone();
            let params = super::SendMessageParams {
                text,
                model: sanitized_model,
                effort,
                access_mode,
                images,
                continue_session: continue_session_for_send,
                session_id: resolved_session_id,
                agent: None,
                variant: None,
                collaboration_mode: None,
                custom_spec_root: normalized_custom_spec_root.clone(),
            };

            // Generate unique render item ids for Claude's assistant/reasoning lanes.
            // The conversation curtain keeps message/reasoning as separate items.
            // Reusing one id across kinds causes realtime assistant text to be
            // overwritten by reasoning snapshots in the normalized assembler path.
            let turn_id = format!("claude-turn-{}", uuid::Uuid::new_v4());
            let thread_id = thread_id.unwrap_or_else(|| turn_id.clone());
            let assistant_item_id = format!("claude-item-{}", uuid::Uuid::new_v4());
            let reasoning_item_id = format!("claude-reasoning-{}", uuid::Uuid::new_v4());

            // Subscribe to session events BEFORE spawning send_message
            let mut receiver = session.subscribe();
            let app_clone = app.clone();
            let turn_id_for_forwarder = turn_id.clone();
            let runtime_manager = state.runtime_manager.clone();
            let workspace_entry_for_forwarder = workspace_entry.clone();
            let session_for_forwarder = session.clone();

            // Spawn event forwarder: reads from broadcast channel and emits Tauri events.
            tokio::spawn(async move {
                let turn_source = format!("turn:{turn_id_for_forwarder}");
                let stream_source = format!("stream:{turn_id_for_forwarder}");
                let runtime_context = ClaudeForwarderRuntimeContext {
                    runtime_manager,
                    workspace_entry: workspace_entry_for_forwarder,
                    session: session_for_forwarder,
                    turn_source,
                    stream_source,
                };
                let mut forwarder_state =
                    ClaudeForwarderState::new(thread_id, assistant_item_id, reasoning_item_id);
                let deadline = tokio::time::Instant::now()
                    + std::time::Duration::from_secs(EVENT_FORWARDER_TIMEOUT_SECS);
                loop {
                    let recv_result = tokio::time::timeout_at(deadline, receiver.recv()).await;
                    let turn_event = match recv_result {
                        Ok(Ok(event)) => event,
                        Ok(Err(tokio::sync::broadcast::error::RecvError::Closed)) => break,
                        Ok(Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped))) => {
                            log::warn!(
                                "Claude event forwarder lagged; skipped {} events for turn {}",
                                skipped,
                                turn_id_for_forwarder
                            );
                            continue;
                        }
                        Err(_) => break, // timeout reached
                    };
                    if turn_event.turn_id != turn_id_for_forwarder {
                        continue;
                    }

                    let event = turn_event.event;
                    let did_finish = handle_claude_forwarder_event(
                        event,
                        &mut forwarder_state,
                        &runtime_context,
                        &mut |payload| {
                            let _ = app_clone.emit("app-server-event", payload);
                        },
                    )
                    .await;
                    if did_finish {
                        break;
                    }
                }
            });

            // Spawn the message sender: drives the Claude CLI process
            let session_clone = session.clone();
            let turn_id_clone = turn_id.clone();
            let runtime_manager_for_sender = state.runtime_manager.clone();
            let workspace_entry_for_sender = workspace_entry.clone();
            tokio::spawn(async move {
                let send_result = if has_images {
                    session_clone.send_message(params, &turn_id_clone).await
                } else {
                    session_clone
                        .send_message_with_auto_compact_retry(params, &turn_id_clone)
                        .await
                };
                if let Err(e) = send_result {
                    log::error!("Claude send_message failed: {}", e);
                    runtime_manager_for_sender
                        .record_failure(
                            &workspace_entry_for_sender,
                            "claude",
                            "engine-send-message",
                            e,
                        )
                        .await;
                }
            });

            // Return immediately with turn info (frontend will receive streaming events)
            Ok(json!({
                "engine": "claude",
                "sessionId": response_session_id.clone(),
                "result": {
                    "sessionId": response_session_id.clone(),
                    "turn": {
                        "id": turn_id,
                        "status": "started"
                    },
                },
                "turn": {
                    "id": turn_id,
                    "status": "started"
                }
            }))
        }
        EngineType::Codex => {
            // For Codex, delegate to existing send_user_message command
            // The frontend should use the existing command for now
            Ok(json!({
                "delegateTo": "send_user_message",
                "engine": "codex",
            }))
        }
        EngineType::OpenCode => {
            let workspace_path = {
                let workspaces = state.workspaces.lock().await;
                workspaces
                    .get(&workspace_id)
                    .map(|w| std::path::PathBuf::from(&w.path))
                    .ok_or_else(|| "Workspace not found".to_string())?
            };

            let session = manager
                .get_or_create_opencode_session(&workspace_id, &workspace_path)
                .await;

            let resolved_session_id = if continue_session {
                if session_id.is_some() {
                    session_id
                } else {
                    session.get_session_id().await
                }
            } else {
                Some(session_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string()))
            };

            let sanitized_model = model
                .as_ref()
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
                .and_then(|value| {
                    if is_likely_legacy_claude_model_id(value) {
                        None
                    } else {
                        Some(value.to_string())
                    }
                });
            if model.is_some() && sanitized_model.is_none() {
                log::warn!(
                    "[engine_send_message] dropped invalid opencode model={:?}, fallback to default",
                    model
                );
            }
            let model_for_send =
                sanitized_model.or_else(|| Some("openai/gpt-5.3-codex".to_string()));

            let params = super::SendMessageParams {
                text,
                model: model_for_send,
                effort,
                access_mode,
                images,
                continue_session,
                session_id: resolved_session_id,
                agent,
                variant,
                collaboration_mode: None,
                custom_spec_root: normalized_custom_spec_root.clone(),
            };

            let turn_id = format!("opencode-turn-{}", uuid::Uuid::new_v4());
            let thread_id = thread_id.unwrap_or_else(|| turn_id.clone());
            let item_id = format!("opencode-item-{}", uuid::Uuid::new_v4());

            let mut receiver = session.subscribe();
            let app_clone = app.clone();
            let mut current_thread_id = thread_id.clone();
            let item_id_clone = item_id.clone();
            let turn_id_for_forwarder = turn_id.clone();
            // Spawn event forwarder (same pattern as Claude forwarder above).
            tokio::spawn(async move {
                let deadline = tokio::time::Instant::now()
                    + std::time::Duration::from_secs(EVENT_FORWARDER_TIMEOUT_SECS);
                loop {
                    let recv_result = tokio::time::timeout_at(deadline, receiver.recv()).await;
                    let turn_event = match recv_result {
                        Ok(Ok(event)) => event,
                        Ok(Err(tokio::sync::broadcast::error::RecvError::Closed)) => break,
                        Ok(Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped))) => {
                            log::warn!(
                                "OpenCode event forwarder lagged; skipped {} events for turn {}",
                                skipped,
                                turn_id_for_forwarder
                            );
                            continue;
                        }
                        Err(_) => break,
                    };
                    if turn_event.turn_id != turn_id_for_forwarder {
                        continue;
                    }

                    let event = turn_event.event;
                    let is_terminal = event.is_terminal();

                    if let Some(payload) =
                        engine_event_to_app_server_event(&event, &current_thread_id, &item_id_clone)
                    {
                        let _ = app_clone.emit("app-server-event", payload);
                    }

                    if let EngineEvent::SessionStarted {
                        session_id, engine, ..
                    } = &event
                    {
                        if !session_id.is_empty() && session_id != "pending" {
                            if matches!(engine, EngineType::OpenCode) {
                                current_thread_id = format!("opencode:{}", session_id);
                            }
                        }
                    }

                    if is_terminal {
                        break;
                    }
                }
            });

            let session_clone = session.clone();
            let turn_id_clone = turn_id.clone();
            tokio::spawn(async move {
                if let Err(e) = session_clone.send_message(params, &turn_id_clone).await {
                    log::error!("OpenCode send_message failed: {}", e);
                    session_clone.emit_error(&turn_id_clone, e);
                }
            });

            Ok(json!({
                "engine": "opencode",
                "result": {
                    "turn": {
                        "id": turn_id,
                        "status": "started"
                    },
                },
                "turn": {
                    "id": turn_id,
                    "status": "started"
                }
            }))
        }
        EngineType::Gemini => {
            let workspace_path = {
                let workspaces = state.workspaces.lock().await;
                workspaces
                    .get(&workspace_id)
                    .map(|w| std::path::PathBuf::from(&w.path))
                    .ok_or_else(|| "Workspace not found".to_string())?
            };

            let session = manager
                .get_or_create_gemini_session(&workspace_id, &workspace_path)
                .await;

            let resolved_session_id = if continue_session {
                if session_id.is_some() {
                    session_id
                } else {
                    session.get_session_id().await
                }
            } else {
                Some(session_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string()))
            };

            let sanitized_model = model
                .as_ref()
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
                .and_then(|value| {
                    if is_likely_foreign_model_for_gemini(value) {
                        None
                    } else {
                        Some(value.to_string())
                    }
                });
            if model.is_some() && sanitized_model.is_none() {
                log::warn!(
                    "[engine_send_message] dropped invalid gemini model={:?}, fallback to default",
                    model
                );
            }

            let params = super::SendMessageParams {
                text,
                model: sanitized_model,
                effort,
                access_mode,
                images,
                continue_session,
                session_id: resolved_session_id,
                agent: None,
                variant: None,
                collaboration_mode: None,
                custom_spec_root: normalized_custom_spec_root.clone(),
            };

            let turn_id = format!("gemini-turn-{}", uuid::Uuid::new_v4());
            let thread_id = thread_id.unwrap_or_else(|| turn_id.clone());
            let item_id = format!("gemini-item-{}", uuid::Uuid::new_v4());

            let mut receiver = session.subscribe();
            let app_clone = app.clone();
            let mut current_thread_id = thread_id.clone();
            let item_id_clone = item_id.clone();
            let turn_id_for_forwarder = turn_id.clone();
            let mut accumulated_agent_text = String::new();
            tokio::spawn(async move {
                let deadline = tokio::time::Instant::now()
                    + std::time::Duration::from_secs(EVENT_FORWARDER_TIMEOUT_SECS);
                let mut render_state = GeminiRenderRoutingState::default();
                let mut post_completion_grace_deadline: Option<tokio::time::Instant> = None;
                loop {
                    let active_deadline = post_completion_grace_deadline
                        .map(|grace| std::cmp::min(grace, deadline))
                        .unwrap_or(deadline);
                    let recv_result =
                        tokio::time::timeout_at(active_deadline, receiver.recv()).await;
                    let turn_event = match recv_result {
                        Ok(Ok(event)) => event,
                        Ok(Err(tokio::sync::broadcast::error::RecvError::Closed)) => break,
                        Ok(Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped))) => {
                            log::warn!(
                                "Gemini event forwarder lagged; skipped {} events for turn {}",
                                skipped,
                                turn_id_for_forwarder
                            );
                            continue;
                        }
                        Err(_) => break,
                    };
                    if turn_event.turn_id != turn_id_for_forwarder {
                        continue;
                    }

                    let event = turn_event.event;
                    let is_terminal = event.is_terminal();
                    let render_lane = match &event {
                        EngineEvent::TextDelta { .. } => GeminiRenderLane::Text,
                        EngineEvent::ReasoningDelta { .. } => GeminiRenderLane::Reasoning,
                        EngineEvent::ToolStarted { .. }
                        | EngineEvent::ToolCompleted { .. }
                        | EngineEvent::ToolInputUpdated { .. }
                        | EngineEvent::ToolOutputDelta { .. } => GeminiRenderLane::Tool,
                        _ => GeminiRenderLane::Other,
                    };
                    let routed_item_id =
                        next_gemini_routed_item_id(&mut render_state, render_lane, &item_id_clone);

                    if let EngineEvent::TextDelta { text, .. } = &event {
                        render_state.saw_text_delta = true;
                        accumulated_agent_text.push_str(text);
                    }

                    if let EngineEvent::TurnCompleted { result, .. } = &event {
                        let fallback_text =
                            extract_turn_result_text(result.as_ref()).unwrap_or_default();
                        let completed_text = if should_prefer_turn_result_text(result.as_ref()) {
                            fallback_text
                        } else if accumulated_agent_text.trim().is_empty() {
                            fallback_text
                        } else {
                            accumulated_agent_text.clone()
                        };
                        // Preserve realtime interleaving for Gemini: when text deltas
                        // already streamed, don't collapse them back into a single
                        // synthetic completed assistant message.
                        if !completed_text.trim().is_empty() && !render_state.saw_text_delta {
                            let synthetic = AppServerEvent {
                                workspace_id: event.workspace_id().to_string(),
                                message: json!({
                                    "method": "item/completed",
                                    "params": {
                                        "threadId": &current_thread_id,
                                        "item": {
                                            "id": &routed_item_id,
                                            "type": "agentMessage",
                                            "text": completed_text,
                                            "status": "completed",
                                        }
                                    }
                                }),
                            };
                            let _ = app_clone.emit("app-server-event", synthetic);
                        }
                    }

                    if let Some(payload) = engine_event_to_app_server_event(
                        &event,
                        &current_thread_id,
                        &routed_item_id,
                    ) {
                        let _ = app_clone.emit("app-server-event", payload);
                    }

                    if let EngineEvent::SessionStarted {
                        session_id, engine, ..
                    } = &event
                    {
                        if !session_id.is_empty() && session_id != "pending" {
                            if matches!(engine, EngineType::Gemini) {
                                current_thread_id = format!("gemini:{}", session_id);
                            }
                        }
                    }

                    if is_terminal {
                        if matches!(event, EngineEvent::TurnCompleted { .. }) {
                            post_completion_grace_deadline = Some(
                                tokio::time::Instant::now()
                                    + std::time::Duration::from_millis(
                                        GEMINI_POST_COMPLETION_REASONING_GRACE_MS,
                                    ),
                            );
                            continue;
                        }
                        break;
                    }
                }
            });

            let session_clone = session.clone();
            let turn_id_clone = turn_id.clone();
            tokio::spawn(async move {
                if let Err(e) = session_clone.send_message(params, &turn_id_clone).await {
                    log::error!("Gemini send_message failed: {}", e);
                }
            });

            Ok(json!({
                "engine": "gemini",
                "result": {
                    "turn": {
                        "id": turn_id,
                        "status": "started"
                    },
                },
                "turn": {
                    "id": turn_id,
                    "status": "started"
                }
            }))
        }
    }
}

/// Send a message and wait for the final plain-text response from the selected engine.
#[tauri::command]
pub async fn engine_send_message_sync(
    workspace_id: String,
    text: String,
    engine: Option<EngineType>,
    model: Option<String>,
    effort: Option<String>,
    access_mode: Option<String>,
    images: Option<Vec<String>>,
    continue_session: bool,
    session_id: Option<String>,
    agent: Option<String>,
    variant: Option<String>,
    custom_spec_root: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if text.trim().is_empty() {
        return Err("Prompt text cannot be empty".to_string());
    }
    if remote_backend::is_remote_mode(&*state).await {
        let (method, params) = remote_engine_send_message_sync_request(
            workspace_id,
            text,
            engine,
            model,
            effort,
            access_mode,
            images,
            continue_session,
            session_id,
            agent,
            variant,
            custom_spec_root,
        );
        return remote_backend::call_remote(&*state, app, method, params).await;
    }

    let manager = &state.engine_manager;
    let active_engine = manager.get_active_engine().await;
    let effective_engine = engine.unwrap_or(active_engine);
    let normalized_custom_spec_root = normalize_custom_spec_root(custom_spec_root.as_deref());

    match effective_engine {
        EngineType::Claude => {
            let workspace_path = {
                let workspaces = state.workspaces.lock().await;
                workspaces
                    .get(&workspace_id)
                    .map(|w| std::path::PathBuf::from(&w.path))
                    .ok_or_else(|| "Workspace not found".to_string())?
            };
            let session = manager
                .get_claude_session(&workspace_id, &workspace_path)
                .await;

            let has_images = images
                .as_ref()
                .is_some_and(|entries| entries.iter().any(|entry| !entry.trim().is_empty()));
            let continue_session_for_send = continue_session;

            let resolved_session_id = if session_id.is_some() {
                session_id
            } else if continue_session {
                session.get_session_id().await
            } else {
                None
            };

            let sanitized_model = model
                .as_ref()
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
                .and_then(|value| {
                    if is_valid_claude_model_for_passthrough(value) {
                        Some(value.to_string())
                    } else {
                        None
                    }
                });

            let response_session_id = resolved_session_id.clone();
            let params = super::SendMessageParams {
                text,
                model: sanitized_model,
                effort,
                access_mode,
                images,
                continue_session: continue_session_for_send,
                session_id: resolved_session_id,
                agent: None,
                variant: None,
                collaboration_mode: None,
                custom_spec_root: normalized_custom_spec_root.clone(),
            };

            let turn_id = format!("claude-sync-{}", uuid::Uuid::new_v4());
            let response = timeout(Duration::from_secs(900), async {
                if has_images {
                    session.send_message(params, &turn_id).await
                } else {
                    session
                        .send_message_with_auto_compact_retry(params, &turn_id)
                        .await
                }
            })
            .await
            .map_err(|_| "Claude response timed out".to_string())??;

            Ok(json!({
                "engine": "claude",
                "sessionId": response_session_id,
                "text": response
            }))
        }
        EngineType::OpenCode => {
            let workspace_path = {
                let workspaces = state.workspaces.lock().await;
                workspaces
                    .get(&workspace_id)
                    .map(|w| std::path::PathBuf::from(&w.path))
                    .ok_or_else(|| "Workspace not found".to_string())?
            };

            let session = manager
                .get_or_create_opencode_session(&workspace_id, &workspace_path)
                .await;
            let resolved_session_id = if continue_session {
                if session_id.is_some() {
                    session_id
                } else {
                    session.get_session_id().await
                }
            } else {
                Some(session_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string()))
            };

            let sanitized_model = model
                .as_ref()
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
                .and_then(|value| {
                    if is_likely_legacy_claude_model_id(value) {
                        None
                    } else {
                        Some(value.to_string())
                    }
                });
            let model_for_send =
                sanitized_model.or_else(|| Some("openai/gpt-5.3-codex".to_string()));

            let params = super::SendMessageParams {
                text,
                model: model_for_send,
                effort,
                access_mode,
                images,
                continue_session,
                session_id: resolved_session_id,
                agent,
                variant,
                collaboration_mode: None,
                custom_spec_root: normalized_custom_spec_root.clone(),
            };

            let turn_id = format!("opencode-sync-{}", uuid::Uuid::new_v4());
            let response = timeout(
                Duration::from_secs(900),
                session.send_message(params, &turn_id),
            )
            .await
            .map_err(|_| "OpenCode response timed out".to_string())??;

            Ok(json!({
                "engine": "opencode",
                "text": response
            }))
        }
        EngineType::Codex => {
            let response = run_codex_prompt_sync(
                &workspace_id,
                &text,
                model,
                effort,
                access_mode,
                normalized_custom_spec_root.clone(),
                &app,
                &state,
            )
            .await?;

            Ok(json!({
                "engine": "codex",
                "text": response
            }))
        }
        EngineType::Gemini => {
            let workspace_path = {
                let workspaces = state.workspaces.lock().await;
                workspaces
                    .get(&workspace_id)
                    .map(|w| std::path::PathBuf::from(&w.path))
                    .ok_or_else(|| "Workspace not found".to_string())?
            };

            let session = manager
                .get_or_create_gemini_session(&workspace_id, &workspace_path)
                .await;
            let resolved_session_id = if continue_session {
                if session_id.is_some() {
                    session_id
                } else {
                    session.get_session_id().await
                }
            } else {
                Some(session_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string()))
            };

            let sanitized_model = model
                .as_ref()
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
                .and_then(|value| {
                    if is_likely_foreign_model_for_gemini(value) {
                        None
                    } else {
                        Some(value.to_string())
                    }
                });

            let params = super::SendMessageParams {
                text,
                model: sanitized_model,
                effort,
                access_mode,
                images,
                continue_session,
                session_id: resolved_session_id,
                agent: None,
                variant: None,
                collaboration_mode: None,
                custom_spec_root: normalized_custom_spec_root.clone(),
            };

            let turn_id = format!("gemini-sync-{}", uuid::Uuid::new_v4());
            let response = timeout(
                Duration::from_secs(900),
                session.send_message(params, &turn_id),
            )
            .await
            .map_err(|_| "Gemini response timed out".to_string())??;

            Ok(json!({
                "engine": "gemini",
                "text": response
            }))
        }
    }
}

/// Interrupt the current operation for the active engine
#[tauri::command]
pub async fn engine_interrupt(
    workspace_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    if remote_backend::is_remote_mode(&*state).await {
        let (method, params) = remote_engine_interrupt_request(workspace_id);
        let _: Value = call_remote_typed(&*state, &app, method, params).await?;
        return Ok(());
    }
    let manager = &state.engine_manager;
    let active_engine = manager.get_active_engine().await;

    match active_engine {
        EngineType::Claude => {
            if let Some(session) = manager.claude_manager.get_session(&workspace_id).await {
                session.interrupt().await?;
            }
            Ok(())
        }
        EngineType::Codex => {
            // Codex interrupts are handled via turn_interrupt RPC from the frontend.
            // This path is a fallback; log for diagnostic visibility.
            log::info!(
                "engine_interrupt called for Codex workspace: {}",
                workspace_id
            );
            Ok(())
        }
        EngineType::OpenCode => {
            if let Some(session) = manager.get_opencode_session(&workspace_id).await {
                session.interrupt().await?;
            }
            Ok(())
        }
        EngineType::Gemini => {
            if let Some(session) = manager.get_gemini_session(&workspace_id).await {
                session.interrupt().await?;
            }
            Ok(())
        }
    }
}

/// Interrupt a specific turn for the active engine.
#[tauri::command]
pub async fn engine_interrupt_turn(
    workspace_id: String,
    turn_id: String,
    engine: Option<EngineType>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    if remote_backend::is_remote_mode(&*state).await {
        let _: Value = call_remote_typed(
            &*state,
            &app,
            "engine_interrupt_turn",
            json!({
                "workspaceId": workspace_id,
                "turnId": turn_id,
                "engine": engine,
            }),
        )
        .await?;
        return Ok(());
    }
    let manager = &state.engine_manager;
    let active_engine = manager.get_active_engine().await;
    let target_engine = engine.unwrap_or(active_engine);

    match target_engine {
        EngineType::Claude => {
            if let Some(session) = manager.claude_manager.get_session(&workspace_id).await {
                session.interrupt_turn(&turn_id).await?;
            }
            Ok(())
        }
        EngineType::Codex => {
            // Codex interrupts are handled via turn_interrupt RPC from the frontend.
            Ok(())
        }
        EngineType::OpenCode => {
            if let Some(session) = manager.get_opencode_session(&workspace_id).await {
                session.interrupt_turn(&turn_id).await?;
            }
            Ok(())
        }
        EngineType::Gemini => {
            if let Some(session) = manager.get_gemini_session(&workspace_id).await {
                session.interrupt_turn(&turn_id).await?;
            }
            Ok(())
        }
    }
}

#[cfg(test)]
#[path = "commands_tests.rs"]
mod commands_tests;
