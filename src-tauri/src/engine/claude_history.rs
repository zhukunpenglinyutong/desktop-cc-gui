//! Read Claude Code session history from ~/.claude/projects/
//!
//! Claude Code stores session data as JSONL files in:
//! `~/.claude/projects/{encoded-path}/{session-id}.jsonl`
//!
//! Path encoding: all non-alphanumeric characters are replaced with hyphens.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::fs;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::Semaphore;

/// Summary of a Claude Code session for sidebar display
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSessionSummary {
    pub session_id: String,
    pub first_message: String,
    pub updated_at: i64,
    pub created_at: i64,
    pub message_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_size_bytes: Option<u64>,
}

/// Encode a filesystem path to Claude's project directory name.
/// All non-alphanumeric characters (except hyphens) become hyphens.
fn encode_project_path(path: &str) -> String {
    path.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect()
}

/// Get the Claude projects base directory (~/.claude/projects/)
fn claude_projects_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".claude").join("projects"))
}

fn candidate_workspace_paths(workspace_path: &Path) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    let mut seen = HashSet::new();

    let raw = workspace_path.to_path_buf();
    let raw_str = raw.to_string_lossy().to_string();
    if !raw_str.is_empty() && seen.insert(raw_str.clone()) {
        candidates.push(raw);
    }

    let trimmed = raw_str.trim_end_matches(|c| c == '/' || c == '\\');
    if trimmed != raw_str && seen.insert(trimmed.to_string()) {
        candidates.push(PathBuf::from(trimmed.to_string()));
    }

    if let Ok(canonical) = std::fs::canonicalize(workspace_path) {
        let canonical_str = canonical.to_string_lossy().to_string();
        if !canonical_str.is_empty() && seen.insert(canonical_str) {
            candidates.push(canonical);
        }
    }

    if trimmed != raw_str {
        if let Ok(canonical_trimmed) = std::fs::canonicalize(trimmed) {
            let canonical_trimmed_str = canonical_trimmed.to_string_lossy().to_string();
            if !canonical_trimmed_str.is_empty() && seen.insert(canonical_trimmed_str) {
                candidates.push(canonical_trimmed);
            }
        }
    }

    candidates
}

fn is_encoded_workspace_prefix_match(candidate: &str, encoded_workspace: &str) -> bool {
    if candidate == encoded_workspace {
        return true;
    }
    if !candidate.starts_with(encoded_workspace) {
        return false;
    }
    candidate
        .as_bytes()
        .get(encoded_workspace.len())
        .is_some_and(|next| *next == b'-')
}

fn claude_project_dirs_for_path(base_dir: &Path, workspace_path: &Path) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let mut seen = HashSet::new();
    let mut encoded_workspace_paths = Vec::new();
    for path in candidate_workspace_paths(workspace_path) {
        let encoded = encode_project_path(&path.to_string_lossy());
        if !encoded.is_empty() {
            encoded_workspace_paths.push(encoded.clone());
        }
        let dir = base_dir.join(&encoded);
        if seen.insert(dir.clone()) {
            dirs.push(dir);
        }
    }
    encoded_workspace_paths.sort();
    encoded_workspace_paths.dedup();

    if let Ok(entries) = std::fs::read_dir(base_dir) {
        for entry in entries.flatten() {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if !file_type.is_dir() {
                continue;
            }
            let file_name = entry.file_name();
            let Some(dir_name) = file_name.to_str() else {
                continue;
            };
            if !encoded_workspace_paths.iter().any(|encoded_workspace| {
                is_encoded_workspace_prefix_match(dir_name, encoded_workspace)
            }) {
                continue;
            }
            let dir = entry.path();
            if seen.insert(dir.clone()) {
                dirs.push(dir);
            }
        }
    }

    dirs
}

/// Parse an ISO 8601 timestamp string to epoch milliseconds
fn parse_timestamp(ts: &str) -> Option<i64> {
    // Parse ISO 8601 format: "2026-02-02T06:36:06.284Z"
    chrono::DateTime::parse_from_rfc3339(ts)
        .ok()
        .map(|dt| dt.timestamp_millis())
}

/// Extract text content from a message content field.
/// Content can be a string or an array of content blocks.
fn extract_text_from_content(content: &Value) -> Option<String> {
    match content {
        Value::String(s) => {
            let text = s.trim();
            if text.is_empty() {
                None
            } else {
                Some(text.to_string())
            }
        }
        Value::Array(arr) => {
            for block in arr {
                if let Some(block_type) = block.get("type").and_then(|v| v.as_str()) {
                    if block_type == "text" {
                        if let Some(text) = block.get("text").and_then(|v| v.as_str()) {
                            let trimmed = text.trim();
                            if !trimmed.is_empty() {
                                return Some(trimmed.to_string());
                            }
                        }
                    }
                }
            }
            None
        }
        _ => None,
    }
}

fn is_supported_image_media_type(media_type: Option<&str>) -> bool {
    media_type
        .map(|value| value.trim().to_ascii_lowercase())
        .map(|value| value.starts_with("image/"))
        .unwrap_or(false)
}

fn extract_images_from_content(content: &Value) -> Vec<String> {
    let mut images = Vec::new();
    let mut seen = HashSet::new();
    let Some(blocks) = content.as_array() else {
        return images;
    };
    for block in blocks {
        let Some(block_type) = block.get("type").and_then(|value| value.as_str()) else {
            continue;
        };
        if block_type != "image" {
            continue;
        }
        let Some(source) = block.get("source").and_then(|value| value.as_object()) else {
            continue;
        };
        let source_type = source
            .get("type")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        let image_value = match source_type.as_str() {
            "url" => source
                .get("url")
                .and_then(|value| value.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| value.to_string()),
            "base64" => {
                let media_type = source.get("media_type").and_then(|value| value.as_str());
                let data = source
                    .get("data")
                    .and_then(|value| value.as_str())
                    .map(str::trim)
                    .filter(|value| !value.is_empty());
                if is_supported_image_media_type(media_type) {
                    data.map(|payload| {
                        format!(
                            "data:{};base64,{}",
                            media_type.unwrap_or("image/png"),
                            payload
                        )
                    })
                } else {
                    None
                }
            }
            _ => None,
        };
        if let Some(value) = image_value {
            if seen.insert(value.clone()) {
                images.push(value);
            }
        }
    }
    images
}

/// Check if a user message should be filtered out (meta/warmup/command messages)
fn is_filtered_message(text: &str) -> bool {
    text.starts_with("<command-name>")
        || text.starts_with("<command-message>")
        || text.starts_with("<local-command-stdout>")
        || text.contains("Warmup")
        || text.contains(
            "Caveat: The messages below were generated by the user while running local commands",
        )
}

/// Truncate a string to max_chars, adding ellipsis if truncated
fn truncate(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        s.to_string()
    } else {
        let truncated: String = s.chars().take(max_chars).collect();
        format!("{}…", truncated)
    }
}

/// Scan a single JSONL file and extract session summary metadata.
/// Reads the file line-by-line to find the first user message and track timestamps.
async fn scan_session_file(path: &Path) -> Option<ClaudeSessionSummary> {
    let file = fs::File::open(path).await.ok()?;
    let file_size_bytes = file.metadata().await.ok().map(|metadata| metadata.len());
    let reader = BufReader::new(file);
    let mut lines = reader.lines();

    let mut first_user_message: Option<String> = None;
    let mut first_timestamp: Option<i64> = None;
    let mut last_timestamp: Option<i64> = None;
    let mut message_count: usize = 0;

    while let Ok(Some(line)) = lines.next_line().await {
        let line = line.trim().to_string();
        if line.is_empty() {
            continue;
        }

        let entry: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        // Track timestamps from any entry that has one
        if let Some(ts_str) = entry.get("timestamp").and_then(|v| v.as_str()) {
            if let Some(ts) = parse_timestamp(ts_str) {
                if first_timestamp.is_none() {
                    first_timestamp = Some(ts);
                }
                last_timestamp = Some(ts);
            }
        }

        // Count message entries (user or assistant)
        let msg = entry.get("message");
        let role = msg
            .and_then(|m| m.get("role"))
            .and_then(|r| r.as_str())
            .unwrap_or("");

        if role == "user" || role == "assistant" {
            message_count += 1;
        }

        // Extract first user message (non-meta, non-filtered)
        if first_user_message.is_none() && role == "user" {
            let is_meta = entry
                .get("isMeta")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            if is_meta {
                continue;
            }

            if let Some(content) = msg.and_then(|m| m.get("content")) {
                if let Some(text) = extract_text_from_content(content) {
                    if !is_filtered_message(&text) {
                        first_user_message = Some(truncate(&text, 45));
                    }
                }
            }
        }
    }

    // Skip completely empty sessions (no messages at all)
    if message_count < 1 {
        return None;
    }

    let session_id = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();

    if session_id.is_empty() {
        return None;
    }

    let first_message = first_user_message
        .unwrap_or_else(|| format!("Session {}", &session_id[..8.min(session_id.len())]));
    let now_ms = chrono::Utc::now().timestamp_millis();

    Some(ClaudeSessionSummary {
        session_id,
        first_message,
        updated_at: last_timestamp.unwrap_or(now_ms),
        created_at: first_timestamp.unwrap_or(now_ms),
        message_count,
        file_size_bytes,
    })
}

/// List Claude Code sessions for a given workspace path.
///
/// Reads from `~/.claude/projects/{encoded-path}/*.jsonl`,
/// filtering out subagent sessions (`agent-*.jsonl`).
pub async fn list_claude_sessions(
    workspace_path: &Path,
    limit: Option<usize>,
) -> Result<Vec<ClaudeSessionSummary>, String> {
    let base_dir = claude_projects_dir().ok_or("Cannot determine home directory")?;
    let project_dirs = claude_project_dirs_for_path(&base_dir, workspace_path);

    let mut jsonl_paths: Vec<PathBuf> = Vec::new();
    let mut seen_paths = HashSet::new();
    let mut found_dir = false;

    for project_dir in project_dirs {
        if !project_dir.exists() {
            continue;
        }
        found_dir = true;
        let mut entries = fs::read_dir(&project_dir)
            .await
            .map_err(|e| format!("Failed to read Claude project directory: {}", e))?;

        while let Ok(Some(entry)) = entries.next_entry().await {
            let path = entry.path();
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                // Only .jsonl files, skip agent-* subagent sessions
                if name.ends_with(".jsonl") && !name.starts_with("agent-") {
                    if seen_paths.insert(path.clone()) {
                        jsonl_paths.push(path);
                    }
                }
            }
        }
    }

    if !found_dir {
        return Ok(Vec::new());
    }

    // Scan all session files concurrently with a concurrency limit to prevent
    // memory exhaustion from spawning too many parallel file reads.
    const MAX_CONCURRENT_SCANS: usize = 10;
    let semaphore = Arc::new(Semaphore::new(MAX_CONCURRENT_SCANS));
    let mut handles = Vec::new();
    for path in jsonl_paths {
        let permit = semaphore.clone();
        handles.push(tokio::spawn(async move {
            let _permit = permit.acquire().await;
            scan_session_file(&path).await
        }));
    }

    let mut sessions: Vec<ClaudeSessionSummary> = Vec::new();
    for handle in handles {
        if let Ok(Some(summary)) = handle.await {
            sessions.push(summary);
        }
    }

    // Sort by updated_at descending (most recent first)
    sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));

    // Apply limit
    let limit = limit.unwrap_or(200);
    sessions.truncate(limit);

    Ok(sessions)
}

/// A single message from a Claude Code session, suitable for frontend display.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSessionMessage {
    pub id: String,
    pub role: String,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub images: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<String>,
    /// "message", "reasoning", or "tool"
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_input: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_output: Option<Value>,
}

/// Usage data extracted from Claude session
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSessionUsage {
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub cache_creation_input_tokens: Option<i64>,
    pub cache_read_input_tokens: Option<i64>,
}

/// Result of loading a Claude session, including messages and usage data
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSessionLoadResult {
    pub messages: Vec<ClaudeSessionMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<ClaudeSessionUsage>,
}

fn rewrite_session_id_fields(value: &mut Value, source_session_id: &str, forked_session_id: &str) {
    match value {
        Value::Object(map) => {
            for (key, nested) in map.iter_mut() {
                if (key == "session_id" || key == "sessionId")
                    && nested
                        .as_str()
                        .map(|sid| sid == source_session_id)
                        .unwrap_or(false)
                {
                    *nested = Value::String(forked_session_id.to_string());
                    continue;
                }
                rewrite_session_id_fields(nested, source_session_id, forked_session_id);
            }
        }
        Value::Array(items) => {
            for item in items {
                rewrite_session_id_fields(item, source_session_id, forked_session_id);
            }
        }
        _ => {}
    }
}

fn resolve_session_file_path(
    base_dir: &Path,
    workspace_path: &Path,
    session_id: &str,
) -> Result<PathBuf, String> {
    let project_dirs = claude_project_dirs_for_path(base_dir, workspace_path);
    for project_dir in project_dirs {
        let candidate = project_dir.join(format!("{}.jsonl", session_id));
        if candidate.exists() {
            return Ok(candidate);
        }
    }
    Err(format!("Session file not found: {}", session_id))
}

fn is_target_user_message_entry(entry: &Value, target_message_id: &str) -> bool {
    let role = entry
        .get("message")
        .and_then(|message| message.get("role"))
        .and_then(|value| value.as_str())
        .unwrap_or("");
    if role != "user" {
        return false;
    }
    entry
        .get("uuid")
        .and_then(|value| value.as_str())
        .or_else(|| {
            entry
                .get("message")
                .and_then(|message| message.get("id"))
                .and_then(|value| value.as_str())
        })
        .map(|value| value == target_message_id)
        .unwrap_or(false)
}

/// Load full message history for a specific Claude Code session.
///
/// Reads the JSONL file and returns all user/assistant messages
/// as structured data compatible with the frontend ConversationItem type.
/// Also extracts the last usage data from assistant messages.
pub async fn load_claude_session(
    workspace_path: &Path,
    session_id: &str,
) -> Result<ClaudeSessionLoadResult, String> {
    let base_dir = claude_projects_dir().ok_or("Cannot determine home directory")?;
    load_claude_session_from_base_dir(&base_dir, workspace_path, session_id).await
}

async fn load_claude_session_from_base_dir(
    base_dir: &Path,
    workspace_path: &Path,
    session_id: &str,
) -> Result<ClaudeSessionLoadResult, String> {
    let project_dirs = claude_project_dirs_for_path(&base_dir, workspace_path);
    let mut session_file: Option<PathBuf> = None;

    for project_dir in project_dirs {
        let candidate = project_dir.join(format!("{}.jsonl", session_id));
        if candidate.exists() {
            session_file = Some(candidate);
            break;
        }
    }

    let session_file =
        session_file.ok_or_else(|| format!("Session file not found: {}", session_id))?;

    let file = fs::File::open(&session_file)
        .await
        .map_err(|e| format!("Failed to open session file: {}", e))?;
    let reader = BufReader::new(file);
    let mut lines = reader.lines();

    let mut messages: Vec<ClaudeSessionMessage> = Vec::new();
    let mut last_usage: Option<ClaudeSessionUsage> = None;
    let mut counter: usize = 0;

    while let Ok(Some(line)) = lines.next_line().await {
        let line = line.trim().to_string();
        if line.is_empty() {
            continue;
        }

        let entry: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let msg = match entry.get("message") {
            Some(m) => m,
            None => continue,
        };

        let role = msg.get("role").and_then(|r| r.as_str()).unwrap_or("");

        if role != "user" && role != "assistant" {
            continue;
        }

        // Extract usage data from assistant messages
        if role == "assistant" {
            if let Some(usage) = msg.get("usage") {
                last_usage = Some(ClaudeSessionUsage {
                    input_tokens: usage.get("input_tokens").and_then(|v| v.as_i64()),
                    output_tokens: usage.get("output_tokens").and_then(|v| v.as_i64()),
                    cache_creation_input_tokens: usage
                        .get("cache_creation_input_tokens")
                        .and_then(|v| v.as_i64()),
                    cache_read_input_tokens: usage
                        .get("cache_read_input_tokens")
                        .and_then(|v| v.as_i64()),
                });
            }
        }

        // Skip meta entries
        let is_meta = entry
            .get("isMeta")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        if is_meta {
            continue;
        }

        let timestamp = entry
            .get("timestamp")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let uuid = entry.get("uuid").and_then(|v| v.as_str()).unwrap_or("");

        let content = msg.get("content");

        // Extract text and structured content from the message
        match content {
            Some(Value::String(text)) => {
                let text = text.trim();
                if text.is_empty() {
                    continue;
                }
                counter += 1;
                let id = if uuid.is_empty() {
                    format!("claude-msg-{}", counter)
                } else {
                    uuid.to_string()
                };
                messages.push(ClaudeSessionMessage {
                    id,
                    role: role.to_string(),
                    text: text.to_string(),
                    images: None,
                    timestamp,
                    kind: "message".to_string(),
                    tool_type: None,
                    title: None,
                    tool_input: None,
                    tool_output: None,
                });
            }
            Some(Value::Array(blocks)) => {
                // Process content blocks: text, thinking, tool_use, tool_result
                let mut text_parts: Vec<String> = Vec::new();
                let image_sources = extract_images_from_content(&Value::Array(blocks.clone()));

                for block in blocks {
                    let block_type = block.get("type").and_then(|v| v.as_str()).unwrap_or("");

                    match block_type {
                        "text" => {
                            if let Some(t) = block.get("text").and_then(|v| v.as_str()) {
                                let t = t.trim();
                                if !t.is_empty() {
                                    text_parts.push(t.to_string());
                                }
                            }
                        }
                        "thinking" | "reasoning" => {
                            // Extract thinking/reasoning content
                            let thinking_text = block
                                .get("thinking")
                                .or_else(|| block.get("reasoning"))
                                .or_else(|| block.get("text"))
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .trim();
                            if !thinking_text.is_empty() {
                                counter += 1;
                                let id = if uuid.is_empty() {
                                    format!("claude-reasoning-{}", counter)
                                } else {
                                    format!("{}-reasoning", uuid)
                                };
                                messages.push(ClaudeSessionMessage {
                                    id,
                                    role: role.to_string(),
                                    text: thinking_text.to_string(),
                                    images: None,
                                    timestamp: timestamp.clone(),
                                    kind: "reasoning".to_string(),
                                    tool_type: None,
                                    title: None,
                                    tool_input: None,
                                    tool_output: None,
                                });
                            }
                        }
                        "tool_use" => {
                            let tool_name =
                                block.get("name").and_then(|v| v.as_str()).unwrap_or("tool");
                            let input = block
                                .get("input")
                                .map(|v| serde_json::to_string_pretty(v).unwrap_or_default())
                                .unwrap_or_default();
                            counter += 1;
                            let tool_id = block
                                .get("id")
                                .or_else(|| block.get("tool_use_id"))
                                .or_else(|| block.get("toolUseId"))
                                .or_else(|| block.get("tool_useId"))
                                .or_else(|| block.get("toolId"))
                                .or_else(|| block.get("tool_id"))
                                .and_then(|v| v.as_str())
                                .unwrap_or("");
                            let id = if tool_id.is_empty() {
                                format!("claude-tool-{}", counter)
                            } else {
                                tool_id.to_string()
                            };
                            messages.push(ClaudeSessionMessage {
                                id,
                                role: role.to_string(),
                                text: input,
                                images: None,
                                timestamp: timestamp.clone(),
                                kind: "tool".to_string(),
                                tool_type: Some(tool_name.to_string()),
                                title: Some(tool_name.to_string()),
                                tool_input: block.get("input").cloned(),
                                tool_output: None,
                            });
                        }
                        "tool_result" => {
                            let result_content = block
                                .get("content")
                                .and_then(|v| {
                                    if let Some(s) = v.as_str() {
                                        Some(s.to_string())
                                    } else if let Some(arr) = v.as_array() {
                                        // tool_result content can also be an array
                                        let texts: Vec<String> = arr
                                            .iter()
                                            .filter_map(|item| {
                                                if item.get("type").and_then(|t| t.as_str())
                                                    == Some("text")
                                                {
                                                    item.get("text")
                                                        .and_then(|t| t.as_str())
                                                        .map(|s| s.to_string())
                                                } else {
                                                    None
                                                }
                                            })
                                            .collect();
                                        if texts.is_empty() {
                                            None
                                        } else {
                                            Some(texts.join("\n"))
                                        }
                                    } else {
                                        None
                                    }
                                })
                                .unwrap_or_default();
                            if !result_content.is_empty() {
                                counter += 1;
                                let tool_use_id = block
                                    .get("tool_use_id")
                                    .or_else(|| block.get("toolUseId"))
                                    .or_else(|| block.get("tool_useId"))
                                    .or_else(|| block.get("toolUseID"))
                                    .or_else(|| block.get("toolId"))
                                    .or_else(|| block.get("tool_id"))
                                    .or_else(|| block.get("id"))
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("");
                                let id = if tool_use_id.is_empty() {
                                    format!("claude-toolresult-{}", counter)
                                } else {
                                    format!("{}-result", tool_use_id)
                                };
                                let is_error = block
                                    .get("is_error")
                                    .or_else(|| block.get("isError"))
                                    .and_then(|v| v.as_bool())
                                    .unwrap_or(false);
                                messages.push(ClaudeSessionMessage {
                                    id,
                                    role: "assistant".to_string(),
                                    text: result_content,
                                    images: None,
                                    timestamp: timestamp.clone(),
                                    kind: "tool".to_string(),
                                    tool_type: Some(if is_error {
                                        "error".to_string()
                                    } else {
                                        "result".to_string()
                                    }),
                                    title: Some(if is_error {
                                        "Error".to_string()
                                    } else {
                                        "Result".to_string()
                                    }),
                                    tool_input: None,
                                    tool_output: entry
                                        .get("toolUseResult")
                                        .cloned()
                                        .or_else(|| block.get("output").cloned()),
                                });
                            }
                        }
                        _ => {}
                    }
                }

                // Add accumulated text parts as a message
                if !text_parts.is_empty() || !image_sources.is_empty() {
                    counter += 1;
                    let id = if uuid.is_empty() {
                        format!("claude-msg-{}", counter)
                    } else {
                        uuid.to_string()
                    };
                    messages.push(ClaudeSessionMessage {
                        id,
                        role: role.to_string(),
                        text: text_parts.join("\n\n"),
                        images: if image_sources.is_empty() {
                            None
                        } else {
                            Some(image_sources)
                        },
                        timestamp,
                        kind: "message".to_string(),
                        tool_type: None,
                        title: None,
                        tool_input: None,
                        tool_output: None,
                    });
                }
            }
            _ => continue,
        }
    }

    Ok(ClaudeSessionLoadResult {
        messages,
        usage: last_usage,
    })
}

/// Fork a Claude session by cloning `{session_id}.jsonl` to a new UUID-named file.
///
/// The cloned JSONL entries keep content intact while rewriting `session_id/sessionId`
/// fields to the new session id, so subsequent `--resume` uses the forked session.
pub async fn fork_claude_session(
    workspace_path: &Path,
    session_id: &str,
) -> Result<String, String> {
    let base_dir = claude_projects_dir().ok_or("Cannot determine home directory")?;
    let source_file = resolve_session_file_path(&base_dir, workspace_path, session_id)?;
    let target_dir = source_file
        .parent()
        .map(PathBuf::from)
        .ok_or_else(|| "Invalid session file path".to_string())?;

    let forked_session_id = uuid::Uuid::new_v4().to_string();
    let target_file = target_dir.join(format!("{}.jsonl", forked_session_id));

    let src = fs::File::open(&source_file)
        .await
        .map_err(|e| format!("Failed to open source session file: {}", e))?;
    let mut reader = BufReader::new(src).lines();

    let mut dst = fs::File::create(&target_file)
        .await
        .map_err(|e| format!("Failed to create forked session file: {}", e))?;

    while let Ok(Some(line)) = reader.next_line().await {
        let mut output = line;
        if let Ok(mut json_value) = serde_json::from_str::<Value>(&output) {
            rewrite_session_id_fields(&mut json_value, session_id, &forked_session_id);
            output = serde_json::to_string(&json_value)
                .map_err(|e| format!("Failed to serialize forked session entry: {}", e))?;
        }
        dst.write_all(output.as_bytes())
            .await
            .map_err(|e| format!("Failed to write forked session entry: {}", e))?;
        dst.write_all(b"\n")
            .await
            .map_err(|e| format!("Failed to finalize forked session entry: {}", e))?;
    }

    dst.flush()
        .await
        .map_err(|e| format!("Failed to flush forked session file: {}", e))?;

    Ok(forked_session_id)
}

/// Fork a Claude session from a specific user message.
///
/// Clones `{session_id}.jsonl` into a new UUID session file, rewriting all
/// `session_id/sessionId` fields, and truncating history before the target user
/// message (exclusive). This preserves rewind semantics as full user+assistant
/// turn rollback. Returns an error when the target message id cannot be found.
async fn fork_claude_session_from_message_in_base_dir(
    base_dir: &Path,
    workspace_path: &Path,
    session_id: &str,
    message_id: &str,
) -> Result<String, String> {
    let target_message_id = message_id.trim();
    if target_message_id.is_empty() {
        return Err("message_id is required".to_string());
    }

    let source_file = resolve_session_file_path(base_dir, workspace_path, session_id)?;
    let target_dir = source_file
        .parent()
        .map(PathBuf::from)
        .ok_or_else(|| "Invalid session file path".to_string())?;

    let forked_session_id = uuid::Uuid::new_v4().to_string();
    let target_file = target_dir.join(format!("{}.jsonl", forked_session_id));

    let src = fs::File::open(&source_file)
        .await
        .map_err(|e| format!("Failed to open source session file: {}", e))?;
    let mut reader = BufReader::new(src).lines();
    let mut dst = fs::File::create(&target_file)
        .await
        .map_err(|e| format!("Failed to create forked session file: {}", e))?;
    let mut found_target = false;

    while let Ok(Some(line)) = reader.next_line().await {
        let mut output = line;
        if let Ok(mut json_value) = serde_json::from_str::<Value>(&output) {
            if is_target_user_message_entry(&json_value, target_message_id) {
                found_target = true;
                break;
            }
            rewrite_session_id_fields(&mut json_value, session_id, &forked_session_id);
            output = serde_json::to_string(&json_value)
                .map_err(|e| format!("Failed to serialize forked session entry: {}", e))?;
        }
        dst.write_all(output.as_bytes())
            .await
            .map_err(|e| format!("Failed to write forked session entry: {}", e))?;
        dst.write_all(b"\n")
            .await
            .map_err(|e| format!("Failed to finalize forked session entry: {}", e))?;
    }

    if !found_target {
        let _ = fs::remove_file(&target_file).await;
        return Err(format!(
            "Target user message not found in session {}: {}",
            session_id, target_message_id
        ));
    }

    dst.flush()
        .await
        .map_err(|e| format!("Failed to flush forked session file: {}", e))?;

    Ok(forked_session_id)
}

pub async fn fork_claude_session_from_message(
    workspace_path: &Path,
    session_id: &str,
    message_id: &str,
) -> Result<String, String> {
    let base_dir = claude_projects_dir().ok_or("Cannot determine home directory")?;
    fork_claude_session_from_message_in_base_dir(&base_dir, workspace_path, session_id, message_id)
        .await
}

/// Delete a Claude Code session by removing its JSONL file from disk.
///
/// Looks for `{session_id}.jsonl` across all candidate project directories
/// for the given workspace path. Also removes any associated agent-* files.
pub async fn delete_claude_session(workspace_path: &Path, session_id: &str) -> Result<(), String> {
    let base_dir = claude_projects_dir().ok_or("Cannot determine home directory")?;
    let project_dirs = claude_project_dirs_for_path(&base_dir, workspace_path);

    let session_filename = format!("{}.jsonl", session_id);
    let agent_prefix = format!("agent-{}", session_id);
    let mut deleted = false;

    for project_dir in project_dirs {
        // Delete the main session file
        let session_file = project_dir.join(&session_filename);
        if session_file.exists() {
            fs::remove_file(&session_file)
                .await
                .map_err(|e| format!("Failed to delete session file: {}", e))?;
            deleted = true;
        }

        // Also delete any agent-{session_id}*.jsonl subagent files
        if project_dir.exists() {
            if let Ok(mut entries) = fs::read_dir(&project_dir).await {
                while let Ok(Some(entry)) = entries.next_entry().await {
                    if let Some(name) = entry.file_name().to_str() {
                        if name.starts_with(&agent_prefix) && name.ends_with(".jsonl") {
                            let _ = fs::remove_file(entry.path()).await;
                        }
                    }
                }
            }
        }
    }

    if deleted {
        Ok(())
    } else {
        Err(format!("Session file not found: {}", session_id))
    }
}

#[cfg(test)]
mod tests {
    use super::{
        extract_images_from_content, fork_claude_session_from_message_in_base_dir,
        is_encoded_workspace_prefix_match, load_claude_session_from_base_dir,
    };
    use serde_json::json;
    use uuid::Uuid;

    #[test]
    fn extract_images_from_content_supports_base64_and_url() {
        let content = json!([
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/png",
                    "data": "AAAA"
                }
            },
            {
                "type": "image",
                "source": {
                    "type": "url",
                    "url": "https://example.com/a.png"
                }
            }
        ]);
        let images = extract_images_from_content(&content);
        assert_eq!(
            images,
            vec![
                "data:image/png;base64,AAAA".to_string(),
                "https://example.com/a.png".to_string()
            ]
        );
    }

    #[test]
    fn extract_images_from_content_dedupes_repeated_entries() {
        let content = json!([
            {
                "type": "image",
                "source": {
                    "type": "url",
                    "url": "https://example.com/a.png"
                }
            },
            {
                "type": "image",
                "source": {
                    "type": "url",
                    "url": "https://example.com/a.png"
                }
            }
        ]);
        let images = extract_images_from_content(&content);
        assert_eq!(images, vec!["https://example.com/a.png".to_string()]);
    }

    #[test]
    fn encoded_workspace_prefix_match_supports_nested_project_dirs() {
        assert!(is_encoded_workspace_prefix_match(
            "-Users-chenxiangning-code-AI-github-codeg-mossx",
            "-Users-chenxiangning-code-AI-github-codeg"
        ));
        assert!(!is_encoded_workspace_prefix_match(
            "-Users-chenxiangning-code-AI-github-codegen",
            "-Users-chenxiangning-code-AI-github-codeg"
        ));
    }

    #[tokio::test]
    async fn load_claude_session_parses_reasoning_blocks() {
        let unique = Uuid::new_v4().to_string();
        let temp_root = std::env::temp_dir().join(format!("ccgui-claude-history-{}", unique));
        let base_dir = temp_root.join("claude-projects");
        let workspace_path = temp_root.join("workspace");
        std::fs::create_dir_all(&workspace_path).expect("create workspace path");
        std::fs::create_dir_all(&base_dir).expect("create base dir");

        let encoded_workspace = workspace_path
            .to_string_lossy()
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '-' {
                    c
                } else {
                    '-'
                }
            })
            .collect::<String>();
        let project_dir = base_dir.join(encoded_workspace);
        std::fs::create_dir_all(&project_dir).expect("create project dir");

        let session_id = format!("reasoning-block-{}", unique);
        let session_path = project_dir.join(format!("{}.jsonl", session_id));
        let line = json!({
            "uuid": "assistant-turn-1",
            "timestamp": "2026-04-12T12:00:00.000Z",
            "message": {
                "role": "assistant",
                "content": [
                    {
                        "type": "reasoning",
                        "reasoning": "Inspect runtime state and compare the latest snapshots"
                    },
                    {
                        "type": "text",
                        "text": "Done"
                    }
                ]
            }
        });
        std::fs::write(&session_path, format!("{}\n", line)).expect("write session");

        let result = load_claude_session_from_base_dir(&base_dir, &workspace_path, &session_id)
            .await
            .expect("load session");
        let reasoning = result
            .messages
            .iter()
            .find(|message| message.kind == "reasoning")
            .expect("reasoning message");
        assert_eq!(
            reasoning.text,
            "Inspect runtime state and compare the latest snapshots"
        );
        assert!(result
            .messages
            .iter()
            .any(|message| message.kind == "message" && message.text == "Done"));

        let _ = std::fs::remove_dir_all(&temp_root);
    }

    #[tokio::test]
    async fn fork_claude_session_from_message_truncates_before_target_user_message() {
        let unique = Uuid::new_v4().to_string();
        let temp_root = std::env::temp_dir().join(format!("ccgui-claude-fork-{}", unique));
        let base_dir = temp_root.join("claude-projects");
        let workspace_path = temp_root.join("workspace");
        std::fs::create_dir_all(&workspace_path).expect("create workspace path");
        std::fs::create_dir_all(&base_dir).expect("create base dir");

        let encoded_workspace = workspace_path
            .to_string_lossy()
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '-' {
                    c
                } else {
                    '-'
                }
            })
            .collect::<String>();
        let project_dir = base_dir.join(encoded_workspace);
        std::fs::create_dir_all(&project_dir).expect("create project dir");

        let source_session_id = format!("source-session-{}", unique);
        let source_path = project_dir.join(format!("{}.jsonl", source_session_id));
        let target_message_id = Uuid::new_v4().to_string();
        let lines = vec![
            json!({
                "uuid": Uuid::new_v4().to_string(),
                "session_id": source_session_id,
                "message": { "role": "user", "content": "first user message" }
            }),
            json!({
                "uuid": Uuid::new_v4().to_string(),
                "sessionId": source_session_id,
                "message": { "role": "assistant", "content": "assistant reply" }
            }),
            json!({
                "uuid": target_message_id,
                "session_id": source_session_id,
                "message": { "role": "user", "content": "target user message" }
            }),
            json!({
                "uuid": Uuid::new_v4().to_string(),
                "session_id": source_session_id,
                "message": { "role": "assistant", "content": "must be truncated" }
            }),
        ];
        let payload = lines
            .iter()
            .map(|line| line.to_string())
            .collect::<Vec<String>>()
            .join("\n");
        std::fs::write(&source_path, format!("{}\n", payload)).expect("write source session");

        let forked_session_id = fork_claude_session_from_message_in_base_dir(
            &base_dir,
            &workspace_path,
            &source_session_id,
            &target_message_id,
        )
        .await
        .expect("fork from target message");

        let forked_path = project_dir.join(format!("{}.jsonl", forked_session_id));
        assert!(forked_path.exists());
        let forked_text = std::fs::read_to_string(&forked_path).expect("read forked session");
        let forked_lines: Vec<_> = forked_text
            .lines()
            .filter(|line| !line.trim().is_empty())
            .collect();
        assert_eq!(forked_lines.len(), 2);

        let parsed_lines: Vec<serde_json::Value> = forked_lines
            .iter()
            .map(|line| serde_json::from_str(line).expect("parse forked line"))
            .collect();
        for entry in &parsed_lines {
            let rewritten = entry
                .get("session_id")
                .or_else(|| entry.get("sessionId"))
                .and_then(|value| value.as_str());
            assert_eq!(rewritten, Some(forked_session_id.as_str()));
        }
        assert_eq!(
            parsed_lines[1]
                .get("message")
                .and_then(|message| message.get("role"))
                .and_then(|value| value.as_str()),
            Some("assistant")
        );
        assert!(!parsed_lines
            .iter()
            .any(|entry| entry.get("uuid").and_then(|value| value.as_str())
                == Some(target_message_id.as_str())));

        let _ = std::fs::remove_dir_all(&temp_root);
    }

    #[tokio::test]
    async fn fork_claude_session_from_message_errors_when_target_not_found() {
        let unique = Uuid::new_v4().to_string();
        let temp_root = std::env::temp_dir().join(format!("ccgui-claude-fork-miss-{}", unique));
        let base_dir = temp_root.join("claude-projects");
        let workspace_path = temp_root.join("workspace");
        std::fs::create_dir_all(&workspace_path).expect("create workspace path");
        std::fs::create_dir_all(&base_dir).expect("create base dir");

        let encoded_workspace = workspace_path
            .to_string_lossy()
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '-' {
                    c
                } else {
                    '-'
                }
            })
            .collect::<String>();
        let project_dir = base_dir.join(encoded_workspace);
        std::fs::create_dir_all(&project_dir).expect("create project dir");

        let source_session_id = format!("source-session-{}", unique);
        let source_path = project_dir.join(format!("{}.jsonl", source_session_id));
        let lines = vec![
            json!({
                "uuid": Uuid::new_v4().to_string(),
                "session_id": source_session_id,
                "message": { "role": "user", "content": "first user message" }
            }),
            json!({
                "uuid": Uuid::new_v4().to_string(),
                "session_id": source_session_id,
                "message": { "role": "assistant", "content": "assistant reply" }
            }),
        ];
        let payload = lines
            .iter()
            .map(|line| line.to_string())
            .collect::<Vec<String>>()
            .join("\n");
        std::fs::write(&source_path, format!("{}\n", payload)).expect("write source session");

        let before_files: Vec<_> = std::fs::read_dir(&project_dir)
            .expect("list project files")
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .collect();
        let error = fork_claude_session_from_message_in_base_dir(
            &base_dir,
            &workspace_path,
            &source_session_id,
            "missing-user-message-id",
        )
        .await
        .expect_err("target message should be missing");
        assert!(error.contains("Target user message not found"));
        let after_files: Vec<_> = std::fs::read_dir(&project_dir)
            .expect("list project files")
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .collect();
        assert_eq!(after_files.len(), before_files.len());

        let _ = std::fs::remove_dir_all(&temp_root);
    }
}
