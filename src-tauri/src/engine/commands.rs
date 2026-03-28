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
use crate::state::AppState;

use super::codex_prompt_service::{normalize_custom_spec_root, run_codex_prompt_sync};
use super::events::{engine_event_to_app_server_event, EngineEvent};
use super::status::{detect_gemini_status, detect_opencode_status};
use super::{EngineConfig, EngineStatus, EngineType};

#[path = "commands_parse_helpers.rs"]
mod parse_helpers;
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

fn parse_opencode_models_provider_ids(stdout: &str) -> Vec<String> {
    let mut providers = Vec::new();
    for raw in strip_ansi_codes(stdout).lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('{') || line.starts_with('[') {
            continue;
        }
        if line.starts_with("http://") || line.starts_with("https://") {
            continue;
        }
        let Some((provider, _model)) = line.split_once('/') else {
            continue;
        };
        let provider = provider.trim().to_lowercase();
        if provider.is_empty() {
            continue;
        }
        providers.push(provider);
    }
    providers.sort();
    providers.dedup();
    providers
}

fn provider_label_from_id(provider_id: &str) -> String {
    match provider_id {
        "z-ai" => "Z.AI".to_string(),
        "io-net" => "IO.NET".to_string(),
        "iflow" => "iFlow".to_string(),
        "zenmux" => "ZenMux".to_string(),
        "fastrouter" => "FastRouter".to_string(),
        "modelscope" => "ModelScope".to_string(),
        "minimax-cn-coding-plan" => "MiniMax Coding Plan (minimaxi.com)".to_string(),
        "minimax-cn" => "MiniMax (minimaxi.com)".to_string(),
        "opencode" => "OpenCode Zen".to_string(),
        "github-copilot" => "GitHub Copilot".to_string(),
        "openai" => "OpenAI".to_string(),
        "google" => "Google".to_string(),
        "anthropic" => "Anthropic".to_string(),
        _ => provider_id
            .split('-')
            .filter(|segment| !segment.is_empty())
            .map(|segment| {
                let mut chars = segment.chars();
                let Some(first) = chars.next() else {
                    return String::new();
                };
                format!("{}{}", first.to_ascii_uppercase(), chars.as_str())
            })
            .collect::<Vec<_>>()
            .join(" "),
    }
}

async fn fetch_opencode_provider_ids_from_models(
    workspace_path: &PathBuf,
    config: Option<&EngineConfig>,
) -> Vec<String> {
    let mut cmd = build_opencode_command(config);
    cmd.current_dir(workspace_path);
    cmd.arg("models");
    let output = match cmd.output().await {
        Ok(value) => value,
        Err(_) => return Vec::new(),
    };
    if !output.status.success() {
        return Vec::new();
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    parse_opencode_models_provider_ids(&stdout)
}

fn build_provider_prefill_query(provider_id: &str) -> Option<String> {
    let normalized = slugify_provider_label(provider_id);
    if normalized.is_empty() {
        return None;
    }
    let query = match normalized.as_str() {
        "minimax-cn-coding-plan" | "minimax-coding-plan" | "minimax-cn" => "minimax",
        "z-ai" | "zhipuai-coding-plan" | "zhipu-ai-coding-plan" => "zhipu",
        "github-models" | "github-token" => "github",
        other => other,
    };
    Some(query.to_string())
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

#[cfg(target_os = "macos")]
fn open_terminal_with_command(command: &str) -> Result<(), String> {
    let script = format!(
        "tell application \"Terminal\"\nactivate\ndo script \"{}\"\nend tell",
        command.replace('\\', "\\\\").replace('"', "\\\"")
    );
    let status = std::process::Command::new("osascript")
        .arg("-e")
        .arg(script)
        .status()
        .map_err(|e| format!("Failed to launch Terminal auth flow: {}", e))?;
    if !status.success() {
        return Err("Terminal auth flow returned non-zero exit code".to_string());
    }
    Ok(())
}

fn apply_mcp_toggle_state(
    workspace_id: &str,
    servers: Vec<OpenCodeMcpServerState>,
) -> (bool, Vec<OpenCodeMcpServerState>, HashMap<String, bool>) {
    let cache = OPENCODE_MCP_TOGGLE_STATE.get_or_init(|| Mutex::new(HashMap::new()));
    let mut guard = match cache.lock() {
        Ok(value) => value,
        Err(_) => return (true, servers, HashMap::new()),
    };
    let entry = guard
        .entry(workspace_id.to_string())
        .or_insert_with(|| OpenCodeMcpToggleState {
            global_enabled: true,
            server_enabled: HashMap::new(),
        });
    let global_enabled = entry.global_enabled;
    let server_enabled_map = entry.server_enabled.clone();
    let merged = servers
        .into_iter()
        .map(|mut item| {
            let override_enabled = server_enabled_map.get(&item.name).copied();
            let effective_enabled = global_enabled && override_enabled.unwrap_or(item.enabled);
            item.enabled = effective_enabled;
            item
        })
        .collect::<Vec<_>>();
    (global_enabled, merged, server_enabled_map)
}

/// Detect all installed engines and their capabilities
#[tauri::command]
pub async fn detect_engines(state: State<'_, AppState>) -> Result<Vec<EngineStatus>, String> {
    let manager = &state.engine_manager;
    Ok(manager.detect_engines().await)
}

/// Get the currently active engine
#[tauri::command]
pub async fn get_active_engine(state: State<'_, AppState>) -> Result<EngineType, String> {
    let manager = &state.engine_manager;
    Ok(manager.get_active_engine().await)
}

/// Switch to a different engine
#[tauri::command]
pub async fn switch_engine(
    engine_type: EngineType,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let manager = &state.engine_manager;
    manager.set_active_engine(engine_type).await
}

/// Get cached status for a specific engine
#[tauri::command]
pub async fn get_engine_status(
    engine_type: EngineType,
    state: State<'_, AppState>,
) -> Result<Option<EngineStatus>, String> {
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
    state: State<'_, AppState>,
) -> Result<Vec<super::ModelInfo>, String> {
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

/// List available OpenCode commands (cached for a short TTL).
#[tauri::command]
pub async fn opencode_commands_list(
    refresh: Option<bool>,
    state: State<'_, AppState>,
) -> Result<Vec<OpenCodeCommandEntry>, String> {
    let force_refresh = refresh.unwrap_or(false);
    let cache = OPENCODE_COMMANDS_CACHE.get_or_init(|| Mutex::new(None));
    if !force_refresh {
        let cached = cache
            .lock()
            .map_err(|_| "commands cache lock poisoned".to_string())?;
        if let Some((updated_at, data)) = cached.as_ref() {
            if updated_at.elapsed() < OPENCODE_CACHE_TTL {
                return Ok(data.clone());
            }
        }
    }

    let manager = &state.engine_manager;
    let config = manager.get_engine_config(EngineType::OpenCode).await;
    let mut cmd = build_opencode_command(config.as_ref());
    cmd.arg("--help");
    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to execute opencode --help: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!("opencode --help failed: {}", stderr));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed = parse_opencode_help_commands(&stdout);
    let mut cached = cache
        .lock()
        .map_err(|_| "commands cache lock poisoned".to_string())?;
    *cached = Some((Instant::now(), parsed.clone()));
    Ok(parsed)
}

/// List available OpenCode agents (cached for a short TTL).
#[tauri::command]
pub async fn opencode_agents_list(
    refresh: Option<bool>,
    state: State<'_, AppState>,
) -> Result<Vec<OpenCodeAgentEntry>, String> {
    let force_refresh = refresh.unwrap_or(false);
    let cache = OPENCODE_AGENTS_CACHE.get_or_init(|| Mutex::new(None));
    if !force_refresh {
        let cached = cache
            .lock()
            .map_err(|_| "agents cache lock poisoned".to_string())?;
        if let Some((updated_at, data)) = cached.as_ref() {
            if updated_at.elapsed() < OPENCODE_CACHE_TTL {
                return Ok(data.clone());
            }
        }
    }

    let manager = &state.engine_manager;
    let config = manager.get_engine_config(EngineType::OpenCode).await;
    let mut cmd = build_opencode_command(config.as_ref());
    cmd.arg("agent");
    cmd.arg("list");
    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to execute opencode agent list: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!("opencode agent list failed: {}", stderr));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed = parse_opencode_agent_list(&stdout);

    // Some plugin ecosystems expose extra agents in resolved config but not in `agent list`.
    // Merge config-derived agents so UI remains aligned with the actual runtime.
    let mut debug_cmd = build_opencode_command(config.as_ref());
    debug_cmd.arg("debug");
    debug_cmd.arg("config");
    let merged = match debug_cmd.output().await {
        Ok(debug_output) if debug_output.status.success() => {
            let debug_stdout = String::from_utf8_lossy(&debug_output.stdout);
            let config_agents = parse_opencode_debug_config_agents(&debug_stdout);
            merge_opencode_agents(parsed, config_agents)
        }
        _ => parsed,
    };

    let mut cached = cache
        .lock()
        .map_err(|_| "agents cache lock poisoned".to_string())?;
    *cached = Some((Instant::now(), merged.clone()));
    Ok(merged)
}

#[tauri::command]
pub async fn opencode_session_list(
    workspace_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<OpenCodeSessionEntry>, String> {
    let workspace_path = {
        let workspaces = state.workspaces.lock().await;
        workspaces
            .get(&workspace_id)
            .map(|w| PathBuf::from(&w.path))
            .ok_or_else(|| "Workspace not found".to_string())?
    };
    let manager = &state.engine_manager;
    let config = manager.get_engine_config(EngineType::OpenCode).await;
    let mut cmd = build_opencode_command(config.as_ref());
    cmd.current_dir(workspace_path);
    cmd.arg("session");
    cmd.arg("list");
    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to execute opencode session list: {}", e))?;
    if !output.status.success() {
        let stderr = strip_ansi_codes(&String::from_utf8_lossy(&output.stderr));
        return Err(format!("opencode session list failed: {}", stderr.trim()));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let entries = parse_opencode_session_list(&stdout);
    entries.iter().for_each(|entry| {
        if !entry.updated_label.trim().is_empty() && entry.updated_at.is_none() {
            log::warn!(
                "OpenCode session timestamp parse failed: session_id={}, updated_label={}",
                entry.session_id,
                entry.updated_label
            );
        }
    });
    Ok(entries)
}

#[tauri::command]
pub async fn opencode_delete_session(
    workspace_id: String,
    session_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_path = {
        let workspaces = state.workspaces.lock().await;
        workspaces
            .get(&workspace_id)
            .map(|w| PathBuf::from(&w.path))
            .ok_or_else(|| "[WORKSPACE_NOT_CONNECTED] Workspace not found".to_string())?
    };
    let manager = &state.engine_manager;
    let config = manager.get_engine_config(EngineType::OpenCode).await;

    let mut cmd = build_opencode_command(config.as_ref());
    cmd.current_dir(&workspace_path);
    cmd.arg("session");
    cmd.arg("delete");
    cmd.arg(&session_id);

    match cmd.output().await {
        Ok(output) if output.status.success() => {
            return Ok(json!({
                "deleted": true,
                "method": "cli",
            }));
        }
        Ok(output) => {
            let stderr = strip_ansi_codes(&String::from_utf8_lossy(&output.stderr));
            log::warn!(
                "opencode session delete failed, fallback to filesystem delete: session_id={}, stderr={}",
                session_id,
                stderr.trim()
            );
        }
        Err(error) => {
            log::warn!(
                "opencode session delete command unavailable, fallback to filesystem delete: session_id={}, error={}",
                session_id,
                error
            );
        }
    }

    delete_opencode_session_files(&workspace_path, &session_id, config.as_ref())?;

    Ok(json!({
        "deleted": true,
        "method": "filesystem",
    }))
}

#[tauri::command]
pub async fn opencode_stats(
    workspace_id: String,
    days: Option<u32>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let workspace_path = {
        let workspaces = state.workspaces.lock().await;
        workspaces
            .get(&workspace_id)
            .map(|w| PathBuf::from(&w.path))
            .ok_or_else(|| "Workspace not found".to_string())?
    };
    let manager = &state.engine_manager;
    let config = manager.get_engine_config(EngineType::OpenCode).await;
    let mut cmd = build_opencode_command(config.as_ref());
    cmd.current_dir(workspace_path);
    cmd.arg("stats");
    if let Some(days) = days {
        cmd.arg("--days");
        cmd.arg(days.to_string());
    }
    cmd.arg("--project");
    cmd.arg("");
    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to execute opencode stats: {}", e))?;
    if !output.status.success() {
        let stderr = strip_ansi_codes(&String::from_utf8_lossy(&output.stderr));
        return Err(format!("opencode stats failed: {}", stderr.trim()));
    }
    let stdout = strip_ansi_codes(&String::from_utf8_lossy(&output.stdout));
    let trimmed = stdout.trim().to_string();
    if trimmed.is_empty() {
        return Err("opencode stats returned empty output".to_string());
    }
    Ok(trimmed)
}

#[tauri::command]
pub async fn opencode_export_session(
    workspace_id: String,
    session_id: String,
    output_path: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_path = {
        let workspaces = state.workspaces.lock().await;
        workspaces
            .get(&workspace_id)
            .map(|w| PathBuf::from(&w.path))
            .ok_or_else(|| "Workspace not found".to_string())?
    };
    let manager = &state.engine_manager;
    let config = manager.get_engine_config(EngineType::OpenCode).await;
    let mut cmd = build_opencode_command(config.as_ref());
    cmd.current_dir(workspace_path);
    cmd.arg("export");
    cmd.arg(&session_id);
    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to execute opencode export: {}", e))?;
    if !output.status.success() {
        let stderr = strip_ansi_codes(&String::from_utf8_lossy(&output.stderr));
        return Err(format!("opencode export failed: {}", stderr.trim()));
    }
    let stdout = strip_ansi_codes(&String::from_utf8_lossy(&output.stdout));
    let json_text = extract_json_object_from_text(&stdout)
        .ok_or_else(|| "opencode export did not return JSON payload".to_string())?;
    let target_path = if let Some(path) = output_path {
        PathBuf::from(path)
    } else if let Some(downloads) = dirs::download_dir() {
        downloads.join(format!("opencode-{}.json", session_id))
    } else {
        PathBuf::from(format!("opencode-{}.json", session_id))
    };
    fs::write(&target_path, json_text.as_bytes())
        .map_err(|e| format!("Failed to write export file: {}", e))?;
    Ok(json!({
        "sessionId": session_id,
        "filePath": target_path.to_string_lossy().to_string(),
    }))
}

#[tauri::command]
pub async fn opencode_share_session(
    workspace_id: String,
    session_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_path = {
        let workspaces = state.workspaces.lock().await;
        workspaces
            .get(&workspace_id)
            .map(|w| PathBuf::from(&w.path))
            .ok_or_else(|| "Workspace not found".to_string())?
    };
    let manager = &state.engine_manager;
    let config = manager.get_engine_config(EngineType::OpenCode).await;
    let mut cmd = build_opencode_command(config.as_ref());
    cmd.current_dir(workspace_path);
    cmd.arg("run");
    cmd.arg("--session");
    cmd.arg(&session_id);
    cmd.arg("--share");
    cmd.arg("--format");
    cmd.arg("json");
    cmd.arg("share this session");
    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to execute opencode share: {}", e))?;
    if !output.status.success() {
        let stderr = strip_ansi_codes(&String::from_utf8_lossy(&output.stderr));
        return Err(format!("opencode share failed: {}", stderr.trim()));
    }
    let stdout = strip_ansi_codes(&String::from_utf8_lossy(&output.stdout));
    let stderr = strip_ansi_codes(&String::from_utf8_lossy(&output.stderr));
    let combined = format!("{}\n{}", stdout, stderr);
    let url = extract_first_url(&combined)
        .ok_or_else(|| "Share URL not found in opencode output".to_string())?;
    Ok(json!({
        "sessionId": session_id,
        "url": url,
    }))
}

#[tauri::command]
pub async fn opencode_import_session(
    workspace_id: String,
    source: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_path = {
        let workspaces = state.workspaces.lock().await;
        workspaces
            .get(&workspace_id)
            .map(|w| PathBuf::from(&w.path))
            .ok_or_else(|| "Workspace not found".to_string())?
    };
    let manager = &state.engine_manager;
    let config = manager.get_engine_config(EngineType::OpenCode).await;
    let mut cmd = build_opencode_command(config.as_ref());
    cmd.current_dir(workspace_path);
    cmd.arg("import");
    cmd.arg(&source);
    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to execute opencode import: {}", e))?;
    let stdout = strip_ansi_codes(&String::from_utf8_lossy(&output.stdout));
    let stderr = strip_ansi_codes(&String::from_utf8_lossy(&output.stderr));
    if !output.status.success() {
        return Err(format!("opencode import failed: {}", stderr.trim()));
    }
    let merged = format!("{}\n{}", stdout, stderr);
    let session_id = parse_imported_session_id(&merged);
    Ok(json!({
        "sessionId": session_id,
        "source": source,
        "output": merged.trim(),
    }))
}

#[tauri::command]
pub async fn opencode_mcp_status(
    workspace_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_path = {
        let workspaces = state.workspaces.lock().await;
        workspaces
            .get(&workspace_id)
            .map(|w| PathBuf::from(&w.path))
            .ok_or_else(|| "Workspace not found".to_string())?
    };
    let manager = &state.engine_manager;
    let config = manager.get_engine_config(EngineType::OpenCode).await;
    let mut cmd = build_opencode_command(config.as_ref());
    cmd.current_dir(workspace_path);
    cmd.arg("mcp");
    cmd.arg("list");
    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to execute opencode mcp list: {}", e))?;
    let stdout = strip_ansi_codes(&String::from_utf8_lossy(&output.stdout));
    let stderr = strip_ansi_codes(&String::from_utf8_lossy(&output.stderr));
    if !output.status.success() {
        return Err(format!("opencode mcp list failed: {}", stderr.trim()));
    }
    Ok(json!({
        "text": stdout.trim(),
    }))
}

#[tauri::command]
pub async fn opencode_provider_health(
    workspace_id: String,
    provider: Option<String>,
    state: State<'_, AppState>,
) -> Result<OpenCodeProviderHealth, String> {
    load_opencode_provider_health(&workspace_id, provider, &state).await
}

#[tauri::command]
pub async fn opencode_provider_catalog(
    workspace_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<OpenCodeProviderOption>, String> {
    let workspace_path = {
        let workspaces = state.workspaces.lock().await;
        workspaces
            .get(&workspace_id)
            .map(|w| PathBuf::from(&w.path))
            .ok_or_else(|| "Workspace not found".to_string())?
    };
    let manager = &state.engine_manager;
    let config = manager.get_engine_config(EngineType::OpenCode).await;
    let mut providers =
        fetch_opencode_provider_catalog_from_auth_picker(&workspace_path, config.as_ref()).await;
    if providers.is_empty() {
        providers = fetch_opencode_provider_catalog_preview(&workspace_path, config.as_ref()).await;
    }
    let dynamic_provider_ids =
        fetch_opencode_provider_ids_from_models(&workspace_path, config.as_ref()).await;
    for provider_id in dynamic_provider_ids {
        let normalized_id = slugify_provider_label(&provider_id);
        if normalized_id.is_empty() {
            continue;
        }
        if let Some(existing) = providers.iter_mut().find(|item| item.id == normalized_id) {
            if existing.label.is_empty() {
                existing.label = provider_label_from_id(&provider_id);
            }
            continue;
        }
        providers.push(OpenCodeProviderOption {
            id: normalized_id,
            label: provider_label_from_id(&provider_id),
            description: None,
            category: "other".to_string(),
            recommended: false,
        });
    }
    let fallback = fallback_opencode_provider_catalog();
    for item in fallback {
        if let Some(existing) = providers.iter_mut().find(|p| p.id == item.id) {
            if existing.category != "popular" && item.category == "popular" {
                existing.category = "popular".to_string();
            }
            existing.recommended = existing.recommended || item.recommended;
            if existing.description.is_none() && item.description.is_some() {
                existing.description = item.description;
            }
        } else {
            providers.push(item);
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
    Ok(providers)
}

#[tauri::command]
pub async fn opencode_provider_connect(
    workspace_id: String,
    provider_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_path = {
        let workspaces = state.workspaces.lock().await;
        workspaces
            .get(&workspace_id)
            .map(|w| PathBuf::from(&w.path))
            .ok_or_else(|| "Workspace not found".to_string())?
    };
    let manager = &state.engine_manager;
    let config = manager.get_engine_config(EngineType::OpenCode).await;
    let opencode_bin = resolve_opencode_bin(config.as_ref());
    let quoted_opencode_bin = shell_quote(&opencode_bin);
    let prefill = provider_id
        .as_ref()
        .and_then(|id| build_provider_prefill_query(id));
    let auth_command = if let Some(prefill_query) = prefill {
        let quoted_query = shell_quote(&prefill_query);
        format!(
            "{{ printf \"%s\\r\" {}; cat; }} | {} auth login",
            quoted_query, quoted_opencode_bin
        )
    } else {
        format!("{} auth login", quoted_opencode_bin)
    };
    let full_command = format!(
        "cd {} && {}",
        shell_quote(&workspace_path.to_string_lossy()),
        auth_command
    );

    #[cfg(target_os = "macos")]
    {
        open_terminal_with_command(&full_command)?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let mut cmd = build_opencode_command(config.as_ref());
        cmd.current_dir(workspace_path);
        cmd.arg("auth");
        cmd.arg("login");
        let _child = cmd
            .spawn()
            .map_err(|e| format!("Failed to start opencode auth login: {}", e))?;
    }

    Ok(json!({
        "started": true,
        "providerId": provider_id,
        "command": full_command,
    }))
}

async fn load_opencode_provider_health(
    workspace_id: &str,
    provider: Option<String>,
    state: &State<'_, AppState>,
) -> Result<OpenCodeProviderHealth, String> {
    let workspace_path = {
        let workspaces = state.workspaces.lock().await;
        workspaces
            .get(workspace_id)
            .map(|w| PathBuf::from(&w.path))
            .ok_or_else(|| "Workspace not found".to_string())?
    };
    let manager = &state.engine_manager;
    let config = manager.get_engine_config(EngineType::OpenCode).await;
    let mut cmd = build_opencode_command(config.as_ref());
    cmd.current_dir(workspace_path);
    cmd.arg("auth");
    cmd.arg("list");
    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to execute opencode auth list: {}", e))?;
    let stdout = strip_ansi_codes(&String::from_utf8_lossy(&output.stdout));
    let stderr = strip_ansi_codes(&String::from_utf8_lossy(&output.stderr));
    if !output.status.success() {
        return Ok(OpenCodeProviderHealth {
            provider: provider.unwrap_or_else(|| "unknown".to_string()),
            connected: false,
            credential_count: 0,
            matched: false,
            authenticated_providers: Vec::new(),
            error: Some(stderr.trim().to_string()),
        });
    }

    let providers = parse_opencode_auth_providers(&stdout);
    let normalized_target = provider
        .as_ref()
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty());
    let resolved_provider = normalized_target
        .clone()
        .or_else(|| providers.first().cloned());
    let matched = resolved_provider
        .as_ref()
        .map(|target| {
            providers
                .iter()
                .any(|name| provider_keys_match(target, name))
        })
        .unwrap_or(false);
    let connected = if normalized_target.is_some() {
        matched
    } else {
        !providers.is_empty()
    };

    Ok(OpenCodeProviderHealth {
        provider: resolved_provider.unwrap_or_else(|| "unknown".to_string()),
        connected,
        credential_count: providers.len(),
        matched,
        authenticated_providers: providers,
        error: None,
    })
}

/// Remove MCP toggle state for a workspace to free memory.
pub(crate) fn clear_mcp_toggle_state(workspace_id: &str) {
    if let Some(cache) = OPENCODE_MCP_TOGGLE_STATE.get() {
        if let Ok(mut guard) = cache.lock() {
            guard.remove(workspace_id);
        }
    }
}

#[tauri::command]
pub async fn opencode_mcp_toggle(
    workspace_id: String,
    server_name: Option<String>,
    enabled: Option<bool>,
    global_enabled: Option<bool>,
) -> Result<Value, String> {
    let cache = OPENCODE_MCP_TOGGLE_STATE.get_or_init(|| Mutex::new(HashMap::new()));
    let mut guard = cache
        .lock()
        .map_err(|_| "opencode mcp toggle lock poisoned".to_string())?;
    let entry = guard
        .entry(workspace_id.clone())
        .or_insert_with(|| OpenCodeMcpToggleState {
            global_enabled: true,
            server_enabled: HashMap::new(),
        });
    if let Some(global) = global_enabled {
        entry.global_enabled = global;
    }
    if let Some(name) = server_name {
        let normalized = name.trim().to_string();
        if !normalized.is_empty() {
            entry
                .server_enabled
                .insert(normalized, enabled.unwrap_or(true));
        }
    }
    Ok(json!({
        "workspaceId": workspace_id,
        "mcpEnabled": entry.global_enabled,
        "serverStates": entry.server_enabled,
        "managedToggles": true,
    }))
}

#[tauri::command]
pub async fn opencode_status_snapshot(
    workspace_id: String,
    thread_id: Option<String>,
    model: Option<String>,
    agent: Option<String>,
    variant: Option<String>,
    state: State<'_, AppState>,
) -> Result<OpenCodeStatusSnapshot, String> {
    let provider = derive_provider_from_model(model.as_deref());
    let provider_health =
        load_opencode_provider_health(&workspace_id, provider.clone(), &state).await?;
    let mcp = opencode_mcp_status(workspace_id.clone(), state).await?;
    let raw_mcp = mcp
        .get("text")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string();
    let parsed_servers = parse_opencode_mcp_servers(&raw_mcp);
    let (mcp_enabled, mcp_servers, _server_states) =
        apply_mcp_toggle_state(&workspace_id, parsed_servers);

    Ok(OpenCodeStatusSnapshot {
        session_id: resolve_session_id_from_thread(thread_id.as_deref()),
        model,
        agent,
        variant,
        provider,
        provider_health,
        mcp_enabled,
        mcp_servers,
        mcp_raw: raw_mcp,
        managed_toggles: true,
        token_usage: None,
        context_window: None,
    })
}

#[tauri::command]
pub async fn opencode_lsp_diagnostics(
    workspace_id: String,
    file_path: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_path = {
        let workspaces = state.workspaces.lock().await;
        workspaces
            .get(&workspace_id)
            .map(|w| PathBuf::from(&w.path))
            .ok_or_else(|| "Workspace not found".to_string())?
    };
    let manager = &state.engine_manager;
    let config = manager.get_engine_config(EngineType::OpenCode).await;
    let mut cmd = build_opencode_command(config.as_ref());
    cmd.current_dir(workspace_path);
    cmd.arg("debug");
    cmd.arg("lsp");
    cmd.arg("diagnostics");
    cmd.arg(&file_path);
    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to execute opencode debug lsp diagnostics: {}", e))?;
    let stdout = strip_ansi_codes(&String::from_utf8_lossy(&output.stdout));
    let stderr = strip_ansi_codes(&String::from_utf8_lossy(&output.stderr));
    if !output.status.success() {
        return Err(format!(
            "opencode debug lsp diagnostics failed: {}",
            stderr.trim()
        ));
    }
    Ok(json!({
        "filePath": file_path,
        "result": parse_json_value(&stdout).unwrap_or_else(|| json!({ "raw": stdout.trim() })),
    }))
}

#[tauri::command]
pub async fn opencode_lsp_symbols(
    workspace_id: String,
    query: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_path = {
        let workspaces = state.workspaces.lock().await;
        workspaces
            .get(&workspace_id)
            .map(|w| PathBuf::from(&w.path))
            .ok_or_else(|| "Workspace not found".to_string())?
    };
    let manager = &state.engine_manager;
    let config = manager.get_engine_config(EngineType::OpenCode).await;
    let mut cmd = build_opencode_command(config.as_ref());
    cmd.current_dir(workspace_path);
    cmd.arg("debug");
    cmd.arg("lsp");
    cmd.arg("symbols");
    cmd.arg(&query);
    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to execute opencode debug lsp symbols: {}", e))?;
    let stdout = strip_ansi_codes(&String::from_utf8_lossy(&output.stdout));
    let stderr = strip_ansi_codes(&String::from_utf8_lossy(&output.stderr));
    if !output.status.success() {
        return Err(format!(
            "opencode debug lsp symbols failed: {}",
            stderr.trim()
        ));
    }
    Ok(json!({
        "query": query,
        "result": parse_json_value(&stdout).unwrap_or_else(|| json!({ "raw": stdout.trim() })),
    }))
}

#[tauri::command]
pub async fn opencode_lsp_document_symbols(
    workspace_id: String,
    file_uri: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_path = {
        let workspaces = state.workspaces.lock().await;
        workspaces
            .get(&workspace_id)
            .map(|w| PathBuf::from(&w.path))
            .ok_or_else(|| "Workspace not found".to_string())?
    };
    let manager = &state.engine_manager;
    let config = manager.get_engine_config(EngineType::OpenCode).await;
    let mut cmd = build_opencode_command(config.as_ref());
    cmd.current_dir(workspace_path);
    cmd.arg("debug");
    cmd.arg("lsp");
    cmd.arg("document-symbols");
    cmd.arg(&file_uri);
    let output = cmd.output().await.map_err(|e| {
        format!(
            "Failed to execute opencode debug lsp document-symbols: {}",
            e
        )
    })?;
    let stdout = strip_ansi_codes(&String::from_utf8_lossy(&output.stdout));
    let stderr = strip_ansi_codes(&String::from_utf8_lossy(&output.stderr));
    if !output.status.success() {
        return Err(format!(
            "opencode debug lsp document-symbols failed: {}",
            stderr.trim()
        ));
    }
    Ok(json!({
        "fileUri": file_uri,
        "result": parse_json_value(&stdout).unwrap_or_else(|| json!({ "raw": stdout.trim() })),
    }))
}

#[tauri::command]
pub async fn opencode_lsp_definition(
    workspace_id: String,
    file_uri: String,
    line: u32,
    character: u32,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_path = {
        let workspaces = state.workspaces.lock().await;
        workspaces
            .get(&workspace_id)
            .map(|w| PathBuf::from(&w.path))
            .ok_or_else(|| "Workspace not found".to_string())?
    };
    let manager = &state.engine_manager;
    let config = manager.get_engine_config(EngineType::OpenCode).await;
    let mut cmd = build_opencode_command(config.as_ref());
    cmd.current_dir(workspace_path);
    cmd.arg("debug");
    cmd.arg("lsp");
    cmd.arg("definition");
    cmd.arg(&file_uri);
    cmd.arg(line.to_string());
    cmd.arg(character.to_string());
    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to execute opencode debug lsp definition: {}", e))?;
    let stdout = strip_ansi_codes(&String::from_utf8_lossy(&output.stdout));
    let stderr = strip_ansi_codes(&String::from_utf8_lossy(&output.stderr));
    if !output.status.success() {
        return Err(format!(
            "opencode debug lsp definition failed: {}",
            stderr.trim()
        ));
    }
    Ok(json!({
        "fileUri": file_uri,
        "line": line,
        "character": character,
        "result": parse_json_value(&stdout).unwrap_or_else(|| json!({ "raw": stdout.trim() })),
    }))
}

#[tauri::command]
pub async fn opencode_lsp_references(
    workspace_id: String,
    file_uri: String,
    line: u32,
    character: u32,
    include_declaration: Option<bool>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let workspace_path = {
        let workspaces = state.workspaces.lock().await;
        workspaces
            .get(&workspace_id)
            .map(|w| PathBuf::from(&w.path))
            .ok_or_else(|| "Workspace not found".to_string())?
    };
    let manager = &state.engine_manager;
    let config = manager.get_engine_config(EngineType::OpenCode).await;
    let mut cmd = build_opencode_command(config.as_ref());
    cmd.current_dir(workspace_path);
    cmd.arg("debug");
    cmd.arg("lsp");
    cmd.arg("references");
    cmd.arg(&file_uri);
    cmd.arg(line.to_string());
    cmd.arg(character.to_string());
    if include_declaration.unwrap_or(false) {
        cmd.arg("--include-declaration");
    }
    let output = cmd
        .output()
        .await
        .map_err(|e| format!("Failed to execute opencode debug lsp references: {}", e))?;
    let stdout = strip_ansi_codes(&String::from_utf8_lossy(&output.stdout));
    let stderr = strip_ansi_codes(&String::from_utf8_lossy(&output.stderr));
    if !output.status.success() {
        return Err(format!(
            "opencode debug lsp references failed: {}",
            stderr.trim()
        ));
    }
    Ok(json!({
        "fileUri": file_uri,
        "line": line,
        "character": character,
        "includeDeclaration": include_declaration.unwrap_or(false),
        "result": parse_json_value(&stdout).unwrap_or_else(|| json!({ "raw": stdout.trim() })),
    }))
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
            // Get workspace path
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
                    if value.starts_with("claude-") {
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

            // Generate a unique turn ID and item ID for this turn
            let turn_id = format!("claude-turn-{}", uuid::Uuid::new_v4());
            let thread_id = thread_id.unwrap_or_else(|| turn_id.clone());
            let item_id = format!("claude-item-{}", uuid::Uuid::new_v4());

            // Subscribe to session events BEFORE spawning send_message
            let mut receiver = session.subscribe();
            let app_clone = app.clone();
            let mut current_thread_id = thread_id.clone();
            let item_id_clone = item_id.clone();
            let turn_id_for_forwarder = turn_id.clone();
            let mut accumulated_agent_text = String::new();

            // Spawn event forwarder: reads from broadcast channel and emits Tauri events.
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
                    let is_terminal = event.is_terminal();

                    if let EngineEvent::TextDelta { text, .. } = &event {
                        accumulated_agent_text.push_str(text);
                    }

                    // Claude 引擎补发 agentMessage completed 事件：
                    // Claude API 只产生 TextDelta 流式增量 + TurnCompleted，
                    // 不会产生 item/completed + type:"agentMessage"。
                    // 这里优先使用流式累积文本，回退使用 result.text。
                    if let EngineEvent::TurnCompleted { result, .. } = &event {
                        let fallback_text =
                            extract_turn_result_text(result.as_ref()).unwrap_or_default();
                        let completed_text = if accumulated_agent_text.trim().is_empty() {
                            fallback_text
                        } else {
                            accumulated_agent_text.clone()
                        };
                        if !completed_text.trim().is_empty() {
                            let synthetic = AppServerEvent {
                                workspace_id: event.workspace_id().to_string(),
                                message: json!({
                                    "method": "item/completed",
                                    "params": {
                                        "threadId": &current_thread_id,
                                        "item": {
                                            "id": &item_id_clone,
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

                    // Emit event with CURRENT thread_id (for SessionStarted, this is the OLD pending id)
                    // Frontend uses this to rename claude-pending-xxx to claude:{sessionId}
                    if let Some(payload) =
                        engine_event_to_app_server_event(&event, &current_thread_id, &item_id_clone)
                    {
                        let _ = app_clone.emit("app-server-event", payload);
                    }

                    // Update thread_id AFTER emitting SessionStarted so subsequent events use new id
                    if let EngineEvent::SessionStarted {
                        session_id, engine, ..
                    } = &event
                    {
                        if !session_id.is_empty() && session_id != "pending" {
                            match engine {
                                EngineType::Claude => {
                                    current_thread_id = format!("claude:{}", session_id)
                                }
                                EngineType::OpenCode => {
                                    current_thread_id = format!("opencode:{}", session_id)
                                }
                                _ => {}
                            }
                        }
                    }

                    if is_terminal {
                        break;
                    }
                }
            });

            // Spawn the message sender: drives the Claude CLI process
            let session_clone = session.clone();
            let turn_id_clone = turn_id.clone();
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
                        let completed_text = if accumulated_agent_text.trim().is_empty() {
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
    let manager = &state.engine_manager;
    let active_engine = manager.get_active_engine().await;
    let effective_engine = engine.unwrap_or(active_engine);

    if text.trim().is_empty() {
        return Err("Prompt text cannot be empty".to_string());
    }
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
                    if value.starts_with("claude-") {
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
) -> Result<(), String> {
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

/// List Claude Code session history for a workspace path.
/// Reads JSONL files from ~/.claude/projects/{encoded-path}/.
#[tauri::command]
pub async fn list_claude_sessions(
    workspace_path: String,
    limit: Option<usize>,
) -> Result<Value, String> {
    let path = std::path::PathBuf::from(&workspace_path);
    let sessions = super::claude_history::list_claude_sessions(&path, limit).await?;
    serde_json::to_value(sessions).map_err(|e| e.to_string())
}

/// Load full message history for a specific Claude Code session.
#[tauri::command]
pub async fn load_claude_session(
    workspace_path: String,
    session_id: String,
) -> Result<Value, String> {
    let path = std::path::PathBuf::from(&workspace_path);
    let result = super::claude_history::load_claude_session(&path, &session_id).await?;
    serde_json::to_value(result).map_err(|e| e.to_string())
}

/// Fork a Claude Code session by cloning its JSONL history into a new session id.
#[tauri::command]
pub async fn fork_claude_session(
    workspace_path: String,
    session_id: String,
) -> Result<Value, String> {
    let path = std::path::PathBuf::from(&workspace_path);
    let forked_session_id = super::claude_history::fork_claude_session(&path, &session_id).await?;
    Ok(json!({
        "thread": {
            "id": format!("claude:{}", forked_session_id)
        },
        "sessionId": forked_session_id
    }))
}

/// Delete a Claude Code session (remove JSONL file from disk).
#[tauri::command]
pub async fn delete_claude_session(
    workspace_path: String,
    session_id: String,
) -> Result<(), String> {
    let path = std::path::PathBuf::from(&workspace_path);
    super::claude_history::delete_claude_session(&path, &session_id).await
}

/// List Gemini CLI session history for a workspace path.
#[tauri::command]
pub async fn list_gemini_sessions(
    workspace_path: String,
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let path = std::path::PathBuf::from(&workspace_path);
    let manager = &state.engine_manager;
    let config = manager.get_engine_config(EngineType::Gemini).await;
    let sessions = super::gemini_history::list_gemini_sessions(
        &path,
        limit,
        config.as_ref().and_then(|item| item.home_dir.as_deref()),
    )
    .await?;
    serde_json::to_value(sessions).map_err(|e| e.to_string())
}

/// Load full message history for a specific Gemini CLI session.
#[tauri::command]
pub async fn load_gemini_session(
    workspace_path: String,
    session_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let path = std::path::PathBuf::from(&workspace_path);
    let manager = &state.engine_manager;
    let config = manager.get_engine_config(EngineType::Gemini).await;
    let result = super::gemini_history::load_gemini_session(
        &path,
        &session_id,
        config.as_ref().and_then(|item| item.home_dir.as_deref()),
    )
    .await?;
    serde_json::to_value(result).map_err(|e| e.to_string())
}

/// Delete a Gemini CLI session.
#[tauri::command]
pub async fn delete_gemini_session(
    workspace_path: String,
    session_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let path = std::path::PathBuf::from(&workspace_path);
    let manager = &state.engine_manager;
    let config = manager.get_engine_config(EngineType::Gemini).await;
    super::gemini_history::delete_gemini_session(
        &path,
        &session_id,
        config.as_ref().and_then(|item| item.home_dir.as_deref()),
    )
    .await
}

#[cfg(test)]
#[path = "commands_tests.rs"]
mod commands_tests;
