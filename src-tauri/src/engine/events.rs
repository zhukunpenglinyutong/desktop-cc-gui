//! Unified event types for engine streaming output
//!
//! All engines emit events that are converted to this unified format
//! before being sent to the frontend.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::backend::events::AppServerEvent;

use super::EngineType;

/// Unified engine event for frontend consumption
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum EngineEvent {
    /// Session/conversation started
    #[serde(rename = "session:started")]
    SessionStarted {
        workspace_id: String,
        session_id: String,
        engine: EngineType,
        #[serde(skip_serializing_if = "Option::is_none")]
        turn_id: Option<String>,
    },

    /// Turn/response started
    #[serde(rename = "turn:started")]
    TurnStarted {
        workspace_id: String,
        turn_id: String,
    },

    /// Text content delta (streaming)
    #[serde(rename = "text:delta")]
    TextDelta { workspace_id: String, text: String },

    /// Reasoning/thinking content (for models that expose it)
    #[serde(rename = "reasoning:delta")]
    ReasoningDelta { workspace_id: String, text: String },

    /// Tool use started
    #[serde(rename = "tool:started")]
    ToolStarted {
        workspace_id: String,
        tool_id: String,
        tool_name: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        input: Option<Value>,
    },

    /// Tool use completed
    #[serde(rename = "tool:completed")]
    ToolCompleted {
        workspace_id: String,
        tool_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        tool_name: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        output: Option<Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },

    /// Tool input updated (streaming arguments)
    #[serde(rename = "tool:inputUpdated")]
    ToolInputUpdated {
        workspace_id: String,
        tool_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        tool_name: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        input: Option<Value>,
    },

    /// Tool output updated while the tool is still running
    #[serde(rename = "tool:outputDelta")]
    ToolOutputDelta {
        workspace_id: String,
        tool_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        tool_name: Option<String>,
        delta: String,
    },

    /// Approval request from engine
    #[serde(rename = "approval:request")]
    ApprovalRequest {
        workspace_id: String,
        request_id: Value,
        tool_name: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        input: Option<Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        message: Option<String>,
    },

    /// User input request (AskUserQuestion tool)
    #[serde(rename = "userInput:request")]
    RequestUserInput {
        workspace_id: String,
        request_id: Value,
        questions: Value,
    },

    /// Turn/response completed
    #[serde(rename = "turn:completed")]
    TurnCompleted {
        workspace_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        result: Option<Value>,
    },

    /// Turn/response error
    #[serde(rename = "turn:error")]
    TurnError {
        workspace_id: String,
        error: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        code: Option<String>,
    },

    /// Session ended
    #[serde(rename = "session:ended")]
    SessionEnded {
        workspace_id: String,
        session_id: String,
    },

    /// Usage/token information
    #[serde(rename = "usage:update")]
    UsageUpdate {
        workspace_id: String,
        input_tokens: Option<i64>,
        output_tokens: Option<i64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cached_tokens: Option<i64>,
        /// Model context window size (from Claude statusline/hooks)
        #[serde(skip_serializing_if = "Option::is_none")]
        model_context_window: Option<i64>,
    },

    /// Processing heartbeat while waiting for first visible output
    #[serde(rename = "processing:heartbeat")]
    ProcessingHeartbeat { workspace_id: String, pulse: u64 },

    /// Raw engine-specific event (passthrough)
    #[serde(rename = "raw")]
    Raw {
        workspace_id: String,
        engine: EngineType,
        data: Value,
    },
}

impl EngineEvent {
    /// Get the workspace ID for this event
    pub fn workspace_id(&self) -> &str {
        match self {
            EngineEvent::SessionStarted { workspace_id, .. } => workspace_id,
            EngineEvent::TurnStarted { workspace_id, .. } => workspace_id,
            EngineEvent::TextDelta { workspace_id, .. } => workspace_id,
            EngineEvent::ReasoningDelta { workspace_id, .. } => workspace_id,
            EngineEvent::ToolStarted { workspace_id, .. } => workspace_id,
            EngineEvent::ToolCompleted { workspace_id, .. } => workspace_id,
            EngineEvent::ToolInputUpdated { workspace_id, .. } => workspace_id,
            EngineEvent::ToolOutputDelta { workspace_id, .. } => workspace_id,
            EngineEvent::ApprovalRequest { workspace_id, .. } => workspace_id,
            EngineEvent::RequestUserInput { workspace_id, .. } => workspace_id,
            EngineEvent::TurnCompleted { workspace_id, .. } => workspace_id,
            EngineEvent::TurnError { workspace_id, .. } => workspace_id,
            EngineEvent::SessionEnded { workspace_id, .. } => workspace_id,
            EngineEvent::UsageUpdate { workspace_id, .. } => workspace_id,
            EngineEvent::ProcessingHeartbeat { workspace_id, .. } => workspace_id,
            EngineEvent::Raw { workspace_id, .. } => workspace_id,
        }
    }

    /// Check if this is a terminal event (turn completed or error)
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            EngineEvent::TurnCompleted { .. } | EngineEvent::TurnError { .. }
        )
    }
}

pub fn resolve_claude_realtime_item_id<'a>(
    event: &EngineEvent,
    assistant_item_id: &'a str,
    reasoning_item_id: &'a str,
) -> &'a str {
    match event {
        EngineEvent::ReasoningDelta { .. } => reasoning_item_id,
        _ => assistant_item_id,
    }
}

#[derive(Clone, Copy)]
enum ToolItemKind {
    MpcToolCall,
    CommandExecution,
    FileChange,
}

impl ToolItemKind {
    fn item_type(self) -> &'static str {
        match self {
            ToolItemKind::MpcToolCall => "mcpToolCall",
            ToolItemKind::CommandExecution => "commandExecution",
            ToolItemKind::FileChange => "fileChange",
        }
    }
}

fn resolve_tool_item_kind(tool_name: Option<&str>) -> ToolItemKind {
    let lower = tool_name.unwrap_or_default().trim().to_ascii_lowercase();
    if lower.is_empty() {
        return ToolItemKind::MpcToolCall;
    }
    // Command-like tools can contain "write" in their name (for example write_stdin).
    // Classify these first to avoid misreporting terminal interaction as file changes.
    if lower.contains("exec")
        || lower.contains("bash")
        || lower.contains("shell")
        || lower.contains("terminal")
        || lower.contains("command")
        || lower.contains("stdin")
    {
        return ToolItemKind::CommandExecution;
    }
    if lower.contains("apply")
        || lower.contains("patch")
        || lower.contains("write")
        || lower.contains("edit")
        || lower.starts_with("replace-")
        || lower.contains("replace-")
    {
        return ToolItemKind::FileChange;
    }
    ToolItemKind::MpcToolCall
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ClaudeCompactionSignal {
    Compacting,
    CompactBoundary,
    CompactionFailed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ClaudePermissionSignal {
    RequestUserInputBlocked,
    FileChangeBlocked,
    CommandExecutionBlocked,
}

fn normalize_claude_signal_token(value: &str) -> String {
    value.trim().to_ascii_lowercase().replace(['-', ' '], "_")
}

fn detect_claude_compaction_signal(data: &Value) -> Option<ClaudeCompactionSignal> {
    let candidates = [
        "subtype",
        "subType",
        "event",
        "event_type",
        "eventType",
        "name",
        "kind",
        "status",
        "phase",
        "state",
        "type",
    ];
    for key in candidates {
        let Some(raw) = data.get(key).and_then(|value| value.as_str()) else {
            continue;
        };
        let normalized = normalize_claude_signal_token(raw);
        if normalized.contains("compaction_failed")
            || normalized.contains("compact_failed")
            || normalized.contains("compactfailure")
        {
            return Some(ClaudeCompactionSignal::CompactionFailed);
        }
        if normalized.contains("compact_boundary") || normalized.contains("compacted") {
            return Some(ClaudeCompactionSignal::CompactBoundary);
        }
        if normalized.contains("compacting") {
            return Some(ClaudeCompactionSignal::Compacting);
        }
    }
    None
}

fn detect_claude_permission_signal(data: &Value) -> Option<ClaudePermissionSignal> {
    let signal_source = get_value_by_aliases(data, &["source"])
        .and_then(Value::as_str)
        .unwrap_or_default();
    if !signal_source.eq_ignore_ascii_case("claude_permission_denied") {
        return None;
    }

    let blocked_method = get_value_by_aliases(data, &["blockedMethod", "blocked_method"])
        .and_then(Value::as_str)
        .unwrap_or_default();
    if blocked_method == "item/tool/requestUserInput" {
        return Some(ClaudePermissionSignal::RequestUserInputBlocked);
    }
    if blocked_method == "item/fileChange/requestApproval" {
        return Some(ClaudePermissionSignal::FileChangeBlocked);
    }
    if blocked_method == "item/commandExecution/requestApproval" {
        return Some(ClaudePermissionSignal::CommandExecutionBlocked);
    }

    None
}

fn get_value_by_aliases<'a>(data: &'a Value, aliases: &[&str]) -> Option<&'a Value> {
    aliases.iter().find_map(|alias| data.get(*alias))
}

/// Convert an EngineEvent to an AppServerEvent using Codex-compatible JSON-RPC format.
/// This allows the frontend's existing useAppServerEvents hook to handle Claude events
/// identically to Codex events.
#[cfg(test)]
pub fn engine_event_to_app_server_event(
    event: &EngineEvent,
    thread_id: &str,
    item_id: &str,
) -> Option<AppServerEvent> {
    engine_event_to_app_server_event_with_turn_context(event, thread_id, item_id, None)
}

/// Convert an EngineEvent to an AppServerEvent and attach the known foreground
/// turn identity to terminal events. Some engines do not include the
/// app-generated turn id in their raw completed payload, but the forwarder already
/// knows the accepted turn id from the surrounding TurnEvent.
pub fn engine_event_to_app_server_event_with_turn_context(
    event: &EngineEvent,
    thread_id: &str,
    item_id: &str,
    turn_id_context: Option<&str>,
) -> Option<AppServerEvent> {
    let workspace_id = event.workspace_id().to_string();

    fn stringify_value(value: &Value) -> String {
        if let Some(text) = value.as_str() {
            return text.to_string();
        }
        serde_json::to_string_pretty(value).unwrap_or_default()
    }

    let message = match event {
        EngineEvent::SessionStarted {
            session_id,
            engine,
            turn_id,
            ..
        } => json!({
            "method": "thread/started",
            "params": {
                "threadId": thread_id,
                "sessionId": session_id,
                "turnId": turn_id,
                "engine": match engine {
                    EngineType::Claude => "claude",
                    EngineType::Codex => "codex",
                    EngineType::Gemini => "gemini",
                    EngineType::OpenCode => "opencode",
                },
            }
        }),
        EngineEvent::TurnStarted { turn_id, .. } => json!({
            "method": "turn/started",
            "params": {
                "turnId": turn_id,
                "threadId": thread_id,
            }
        }),
        EngineEvent::TextDelta { text, .. } => json!({
            "method": "item/agentMessage/delta",
            "params": {
                "threadId": thread_id,
                "itemId": item_id,
                "delta": text,
            }
        }),
        EngineEvent::ReasoningDelta { text, .. } => json!({
            "method": "item/reasoning/textDelta",
            "params": {
                "threadId": thread_id,
                "itemId": item_id,
                "delta": text,
            }
        }),
        EngineEvent::ToolStarted {
            tool_id,
            tool_name,
            input,
            ..
        } => {
            let item_kind = resolve_tool_item_kind(Some(tool_name.as_str()));
            let item = match item_kind {
                ToolItemKind::CommandExecution => json!({
                    "id": tool_id,
                    "type": item_kind.item_type(),
                    "input": input,
                    "arguments": input,
                    "status": "started",
                }),
                ToolItemKind::FileChange => json!({
                    "id": tool_id,
                    "type": item_kind.item_type(),
                    "input": input,
                    "arguments": input,
                    "status": "started",
                }),
                ToolItemKind::MpcToolCall => json!({
                    "id": tool_id,
                    "type": item_kind.item_type(),
                    "server": "claude",
                    "tool": tool_name,
                    "arguments": input,
                    "status": "started",
                }),
            };
            json!({
                "method": "item/started",
                "params": {
                    "threadId": thread_id,
                    "item": item,
                }
            })
        }
        EngineEvent::ToolCompleted {
            tool_id,
            tool_name,
            output,
            error,
            ..
        } => {
            let embedded_args = output
                .as_ref()
                .and_then(|value| value.get("_input"))
                .cloned();
            let normalized_output = output
                .as_ref()
                .and_then(|value| value.get("_output"))
                .cloned()
                .or_else(|| output.clone());
            let normalized_output_text = normalized_output.as_ref().map(stringify_value);
            let item_kind = resolve_tool_item_kind(tool_name.as_deref());
            let item = match item_kind {
                ToolItemKind::CommandExecution => json!({
                    "id": tool_id,
                    "type": item_kind.item_type(),
                    "input": embedded_args,
                    "arguments": embedded_args,
                    "aggregatedOutput": normalized_output_text.clone(),
                    "output": normalized_output_text.clone(),
                    "error": error.clone(),
                    "status": if error.is_some() { "failed" } else { "completed" },
                }),
                ToolItemKind::FileChange => json!({
                    "id": tool_id,
                    "type": item_kind.item_type(),
                    "input": embedded_args,
                    "arguments": embedded_args,
                    "output": normalized_output_text.clone(),
                    "error": error.clone(),
                    "status": if error.is_some() { "failed" } else { "completed" },
                }),
                ToolItemKind::MpcToolCall => json!({
                    "id": tool_id,
                    "type": item_kind.item_type(),
                    "server": "claude",
                    "tool": tool_name.clone().unwrap_or_else(|| tool_id.clone()),
                    "arguments": embedded_args,
                    "result": normalized_output_text.clone(),
                    "error": error.clone(),
                    "status": if error.is_some() { "failed" } else { "completed" },
                }),
            };
            json!({
                "method": "item/completed",
                "params": {
                    "threadId": thread_id,
                    "item": item,
                    "output": normalized_output_text,
                    "error": error,
                }
            })
        }
        EngineEvent::ToolInputUpdated {
            tool_id,
            tool_name,
            input,
            ..
        } => {
            let item_kind = resolve_tool_item_kind(tool_name.as_deref());
            let item = match item_kind {
                ToolItemKind::CommandExecution | ToolItemKind::FileChange => json!({
                    "id": tool_id,
                    "type": item_kind.item_type(),
                    "input": input,
                    "arguments": input,
                    "status": "started",
                }),
                ToolItemKind::MpcToolCall => json!({
                    "id": tool_id,
                    "type": item_kind.item_type(),
                    "server": "claude",
                    "tool": tool_name.clone().unwrap_or_else(|| tool_id.clone()),
                    "arguments": input,
                    "status": "started",
                }),
            };
            json!({
                "method": "item/updated",
                "params": {
                    "threadId": thread_id,
                    "item": item,
                }
            })
        }
        EngineEvent::ToolOutputDelta {
            tool_id,
            tool_name,
            delta,
            ..
        } => {
            let method = match resolve_tool_item_kind(tool_name.as_deref()) {
                ToolItemKind::FileChange => "item/fileChange/outputDelta",
                _ => "item/commandExecution/outputDelta",
            };
            json!({
                "method": method,
                "params": {
                    "threadId": thread_id,
                    "itemId": tool_id,
                    "delta": delta,
                }
            })
        }
        EngineEvent::TurnCompleted { result, .. } => {
            let mut params = serde_json::Map::new();
            params.insert("threadId".to_string(), Value::String(thread_id.to_string()));
            if let Some(turn_id) = turn_id_context
                .map(str::trim)
                .filter(|turn_id| !turn_id.is_empty())
            {
                params.insert("turnId".to_string(), Value::String(turn_id.to_string()));
            }
            params.insert("result".to_string(), result.clone().unwrap_or(Value::Null));
            params.insert("assistantFinalBoundary".to_string(), Value::Bool(true));
            json!({
                "method": "turn/completed",
                "params": Value::Object(params),
            })
        }
        EngineEvent::TurnError { error, code, .. } => json!({
            "method": "turn/error",
            "params": {
                "threadId": thread_id,
                "error": error,
                "code": code,
            }
        }),
        EngineEvent::UsageUpdate {
            input_tokens,
            output_tokens,
            cached_tokens,
            model_context_window,
            ..
        } => json!({
            "method": "thread/tokenUsage/updated",
            "params": {
                "threadId": thread_id,
                "tokenUsage": {
                    "total": {
                        "inputTokens": input_tokens,
                        "outputTokens": output_tokens,
                        "cachedInputTokens": cached_tokens,
                        "totalTokens": input_tokens.unwrap_or(0) + output_tokens.unwrap_or(0),
                    },
                    "last": {
                        "inputTokens": input_tokens,
                        "outputTokens": output_tokens,
                        "cachedInputTokens": cached_tokens,
                        "totalTokens": input_tokens.unwrap_or(0) + output_tokens.unwrap_or(0),
                    },
                    "modelContextWindow": model_context_window.unwrap_or(200000),
                }
            }
        }),
        EngineEvent::ProcessingHeartbeat { pulse, .. } => json!({
            "method": "processing/heartbeat",
            "params": {
                "threadId": thread_id,
                "pulse": pulse,
            }
        }),
        EngineEvent::ApprovalRequest {
            request_id,
            tool_name,
            input,
            message,
            ..
        } => {
            let tool_name_lower = tool_name.to_ascii_lowercase();
            let method = if tool_name_lower.contains("apply")
                || tool_name_lower.contains("patch")
                || tool_name_lower.contains("write")
                || tool_name_lower.contains("edit")
            {
                "item/fileChange/requestApproval"
            } else if tool_name_lower.contains("exec")
                || tool_name_lower.contains("bash")
                || tool_name_lower.contains("command")
            {
                "item/commandExecution/requestApproval"
            } else {
                "approval/request"
            };

            let mut merged_params = if let Some(Value::Object(map)) = input.clone() {
                map
            } else {
                serde_json::Map::new()
            };
            merged_params.insert("threadId".to_string(), Value::String(thread_id.to_string()));
            merged_params.insert("turnId".to_string(), Value::String(item_id.to_string()));
            merged_params.insert("itemId".to_string(), Value::String(item_id.to_string()));
            merged_params.insert("toolName".to_string(), Value::String(tool_name.clone()));
            if let Some(message_text) = message.clone() {
                merged_params.insert("message".to_string(), Value::String(message_text));
            }
            if let Some(raw_input) = input.clone() {
                merged_params.insert("input".to_string(), raw_input);
            }

            json!({
                "method": method,
                "params": Value::Object(merged_params),
                "id": request_id,
            })
        }
        EngineEvent::RequestUserInput {
            request_id,
            questions,
            ..
        } => json!({
            "method": "item/tool/requestUserInput",
            "params": {
                "threadId": thread_id,
                "turnId": item_id,
                "itemId": item_id,
                "questions": questions,
            },
            "id": request_id,
        }),
        EngineEvent::Raw { data, engine, .. } => {
            if matches!(engine, EngineType::Claude) {
                if let Some(signal) = detect_claude_permission_signal(data) {
                    match signal {
                        ClaudePermissionSignal::RequestUserInputBlocked
                        | ClaudePermissionSignal::FileChangeBlocked
                        | ClaudePermissionSignal::CommandExecutionBlocked => {
                            let blocked_method =
                                get_value_by_aliases(data, &["blockedMethod", "blocked_method"])
                                    .and_then(Value::as_str)
                                    .unwrap_or("item/tool/requestUserInput");
                            let effective_mode =
                                get_value_by_aliases(data, &["effectiveMode", "effective_mode"])
                                    .and_then(Value::as_str)
                                    .unwrap_or("code");
                            let reason_code =
                                get_value_by_aliases(data, &["reasonCode", "reason_code"])
                                    .and_then(Value::as_str)
                                    .unwrap_or("claude_permission_denied");
                            let reason = get_value_by_aliases(
                                data,
                                &["reason", "message", "rawError", "raw_error"],
                            )
                            .and_then(|value| {
                                if let Some(text) = value.as_str() {
                                    return Some(text.to_string());
                                }
                                if value.is_object() || value.is_array() {
                                    return serde_json::to_string(value).ok();
                                }
                                None
                            })
                            .unwrap_or_else(|| {
                                "Claude denied the interactive tool before GUI approval could start."
                                    .to_string()
                            });
                            let suggestion = get_value_by_aliases(data, &["suggestion"])
                                .and_then(Value::as_str)
                                .unwrap_or(
                                    "Use Plan mode for this Claude workflow until the approval bridge is implemented.",
                                );
                            let request_id =
                                get_value_by_aliases(data, &["requestId", "request_id"])
                                    .cloned()
                                    .unwrap_or_else(|| Value::String(item_id.to_string()));
                            json!({
                                "method": "collaboration/modeBlocked",
                                "params": {
                                    "threadId": thread_id,
                                    "thread_id": thread_id,
                                    "blockedMethod": blocked_method,
                                    "blocked_method": blocked_method,
                                    "effectiveMode": effective_mode,
                                    "effective_mode": effective_mode,
                                    "reasonCode": reason_code,
                                    "reason_code": reason_code,
                                    "reason": reason,
                                    "suggestion": suggestion,
                                    "requestId": request_id,
                                    "request_id": request_id,
                                }
                            })
                        }
                    }
                } else if let Some(signal) = detect_claude_compaction_signal(data) {
                    match signal {
                        ClaudeCompactionSignal::Compacting => {
                            let mut params = serde_json::Map::new();
                            params.insert(
                                "threadId".to_string(),
                                Value::String(thread_id.to_string()),
                            );
                            if let Some(value) =
                                get_value_by_aliases(data, &["usagePercent", "usage_percent"])
                            {
                                params.insert("usagePercent".to_string(), value.clone());
                            }
                            if let Some(value) = get_value_by_aliases(
                                data,
                                &["thresholdPercent", "threshold_percent"],
                            ) {
                                params.insert("thresholdPercent".to_string(), value.clone());
                            }
                            if let Some(value) =
                                get_value_by_aliases(data, &["targetPercent", "target_percent"])
                            {
                                params.insert("targetPercent".to_string(), value.clone());
                            }
                            json!({
                                "method": "thread/compacting",
                                "params": Value::Object(params),
                            })
                        }
                        ClaudeCompactionSignal::CompactBoundary => {
                            let turn_id_value = get_value_by_aliases(
                                data,
                                &["turnId", "turn_id", "requestId", "request_id"],
                            )
                            .and_then(|value| value.as_str())
                            .filter(|value| !value.trim().is_empty())
                            .unwrap_or(item_id)
                            .to_string();
                            json!({
                                "method": "thread/compacted",
                                "params": {
                                    "threadId": thread_id,
                                    "turnId": turn_id_value,
                                },
                            })
                        }
                        ClaudeCompactionSignal::CompactionFailed => {
                            let reason =
                                get_value_by_aliases(data, &["reason", "message", "error"])
                                    .and_then(|value| {
                                        if let Some(text) = value.as_str() {
                                            return Some(text.to_string());
                                        }
                                        if value.is_object() || value.is_array() {
                                            return serde_json::to_string(value).ok();
                                        }
                                        None
                                    })
                                    .unwrap_or_else(|| {
                                        "Automatic context compaction failed".to_string()
                                    });
                            json!({
                                "method": "thread/compactionFailed",
                                "params": {
                                    "threadId": thread_id,
                                    "reason": reason,
                                },
                            })
                        }
                    }
                } else {
                    json!({
                        "method": format!("{}/raw", engine.icon()),
                        "params": data,
                    })
                }
            } else {
                json!({
                    "method": format!("{}/raw", engine.icon()),
                    "params": data,
                })
            }
        }
        _ => return None,
    };

    Some(AppServerEvent {
        workspace_id,
        message,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_serialization() {
        let event = EngineEvent::TextDelta {
            workspace_id: "ws-1".to_string(),
            text: "Hello".to_string(),
        };

        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"type\":\"text:delta\""));
        // Note: serde's rename_all with internally tagged enums doesn't
        // automatically rename fields within variants
        assert!(json.contains("\"workspace_id\":\"ws-1\""));
    }

    #[test]
    fn event_workspace_id() {
        let event = EngineEvent::TurnStarted {
            workspace_id: "ws-test".to_string(),
            turn_id: "turn-1".to_string(),
        };

        assert_eq!(event.workspace_id(), "ws-test");
    }

    #[test]
    fn event_is_terminal() {
        let completed = EngineEvent::TurnCompleted {
            workspace_id: "ws-1".to_string(),
            result: None,
        };
        assert!(completed.is_terminal());

        let delta = EngineEvent::TextDelta {
            workspace_id: "ws-1".to_string(),
            text: "test".to_string(),
        };
        assert!(!delta.is_terminal());
    }

    #[test]
    fn turn_completed_maps_turn_context_to_app_server_payload() {
        let event = EngineEvent::TurnCompleted {
            workspace_id: "ws-1".to_string(),
            result: Some(json!({ "text": "done" })),
        };

        let mapped = engine_event_to_app_server_event_with_turn_context(
            &event,
            "thread-1",
            "assistant-1",
            Some("turn-1"),
        )
        .expect("mapped event");

        assert_eq!(
            mapped.message["method"],
            Value::String("turn/completed".to_string())
        );
        assert_eq!(
            mapped.message["params"]["threadId"],
            Value::String("thread-1".to_string())
        );
        assert_eq!(
            mapped.message["params"]["turnId"],
            Value::String("turn-1".to_string())
        );
        assert_eq!(mapped.message["params"]["result"]["text"], json!("done"));
        assert_eq!(
            mapped.message["params"]["assistantFinalBoundary"],
            json!(true)
        );
    }

    #[test]
    fn turn_completed_without_turn_context_keeps_legacy_shape_without_empty_turn_id() {
        let event = EngineEvent::TurnCompleted {
            workspace_id: "ws-1".to_string(),
            result: None,
        };

        let mapped =
            engine_event_to_app_server_event(&event, "thread-1", "assistant-1").expect("mapped");

        assert_eq!(
            mapped.message["method"],
            Value::String("turn/completed".to_string())
        );
        assert!(mapped.message["params"].get("turnId").is_none());
        assert_eq!(mapped.message["params"]["result"], Value::Null);
    }

    #[test]
    fn claude_realtime_item_id_uses_reasoning_lane_for_reasoning_events() {
        let reasoning_event = EngineEvent::ReasoningDelta {
            workspace_id: "ws-1".to_string(),
            text: "thinking".to_string(),
        };
        let text_event = EngineEvent::TextDelta {
            workspace_id: "ws-1".to_string(),
            text: "answer".to_string(),
        };

        assert_eq!(
            resolve_claude_realtime_item_id(&reasoning_event, "assistant-item", "reasoning-item"),
            "reasoning-item"
        );
        assert_eq!(
            resolve_claude_realtime_item_id(&text_event, "assistant-item", "reasoning-item"),
            "assistant-item"
        );
    }

    #[test]
    fn approval_request_maps_to_app_server_event() {
        let event = EngineEvent::ApprovalRequest {
            workspace_id: "ws-approval".to_string(),
            request_id: json!("req-42"),
            tool_name: "exec".to_string(),
            input: Some(json!({
                "argv": ["git", "status"]
            })),
            message: Some("git status".to_string()),
        };

        let mapped =
            engine_event_to_app_server_event(&event, "thread-1", "item-1").expect("mapped event");
        assert_eq!(mapped.workspace_id, "ws-approval");
        assert_eq!(
            mapped.message["method"],
            Value::String("item/commandExecution/requestApproval".to_string())
        );
        assert_eq!(mapped.message["id"], Value::String("req-42".to_string()));
        assert_eq!(
            mapped.message["params"]["threadId"],
            Value::String("thread-1".to_string())
        );
        assert_eq!(mapped.message["params"]["argv"], json!(["git", "status"]));
    }

    #[test]
    fn session_started_maps_turn_id_when_present() {
        let event = EngineEvent::SessionStarted {
            workspace_id: "ws-claude".to_string(),
            session_id: "ses-123".to_string(),
            engine: EngineType::Claude,
            turn_id: Some("turn-123".to_string()),
        };

        let mapped = engine_event_to_app_server_event(&event, "claude-pending-1", "item-1")
            .expect("mapped event");

        assert_eq!(
            mapped.message["method"],
            Value::String("thread/started".to_string())
        );
        assert_eq!(
            mapped.message["params"]["threadId"],
            Value::String("claude-pending-1".to_string())
        );
        assert_eq!(
            mapped.message["params"]["sessionId"],
            Value::String("ses-123".to_string())
        );
        assert_eq!(
            mapped.message["params"]["turnId"],
            Value::String("turn-123".to_string())
        );
    }

    #[test]
    fn claude_permission_denied_raw_event_maps_to_mode_blocked() {
        let event = EngineEvent::Raw {
            workspace_id: "ws-approval".to_string(),
            engine: EngineType::Claude,
            data: json!({
                "type": "permission_denied",
                "source": "claude_permission_denied",
                "blockedMethod": "item/tool/requestUserInput",
                "effectiveMode": "code",
                "reasonCode": "claude_ask_user_question_permission_denied",
                "reason": "Claude denied AskUserQuestion before any approval request reached the GUI.",
                "suggestion": "Use Plan mode for now.",
                "requestId": "tool-ask-1",
            }),
        };

        let mapped =
            engine_event_to_app_server_event(&event, "thread-1", "item-1").expect("mapped event");
        assert_eq!(
            mapped.message["method"],
            Value::String("collaboration/modeBlocked".to_string())
        );
        assert_eq!(
            mapped.message["params"]["blockedMethod"],
            Value::String("item/tool/requestUserInput".to_string())
        );
        assert_eq!(
            mapped.message["params"]["requestId"],
            Value::String("tool-ask-1".to_string())
        );
    }

    #[test]
    fn claude_file_change_permission_denied_raw_event_maps_to_mode_blocked() {
        let event = EngineEvent::Raw {
            workspace_id: "ws-approval".to_string(),
            engine: EngineType::Claude,
            data: json!({
                "type": "permission_denied",
                "source": "claude_permission_denied",
                "blockedMethod": "item/fileChange/requestApproval",
                "effectiveMode": "code",
                "reasonCode": "claude_file_change_permission_denied",
                "reason": "Claude denied a file-change tool before any GUI approval request could start.",
                "suggestion": "Use full-access or manually allow the workspace directory in Claude Code settings.",
                "requestId": "tool-edit-1",
            }),
        };

        let mapped =
            engine_event_to_app_server_event(&event, "thread-1", "item-1").expect("mapped event");
        assert_eq!(
            mapped.message["method"],
            Value::String("collaboration/modeBlocked".to_string())
        );
        assert_eq!(
            mapped.message["params"]["blockedMethod"],
            Value::String("item/fileChange/requestApproval".to_string())
        );
        assert_eq!(
            mapped.message["params"]["reasonCode"],
            Value::String("claude_file_change_permission_denied".to_string())
        );
        assert_eq!(
            mapped.message["params"]["requestId"],
            Value::String("tool-edit-1".to_string())
        );
    }

    #[test]
    fn claude_command_execution_permission_denied_raw_event_maps_to_mode_blocked() {
        let event = EngineEvent::Raw {
            workspace_id: "ws-approval".to_string(),
            engine: EngineType::Claude,
            data: json!({
                "type": "permission_denied",
                "source": "claude_permission_denied",
                "blockedMethod": "item/commandExecution/requestApproval",
                "effectiveMode": "code",
                "reasonCode": "claude_command_execution_permission_denied",
                "reason": "Claude blocked a command-execution tool before any recoverable GUI approval request could start.",
                "suggestion": "Retry in full-access or rewrite the action to use supported file tools.",
                "requestId": "tool-bash-1",
            }),
        };

        let mapped =
            engine_event_to_app_server_event(&event, "thread-1", "item-1").expect("mapped event");
        assert_eq!(
            mapped.message["method"],
            Value::String("collaboration/modeBlocked".to_string())
        );
        assert_eq!(
            mapped.message["params"]["blockedMethod"],
            Value::String("item/commandExecution/requestApproval".to_string())
        );
        assert_eq!(
            mapped.message["params"]["reasonCode"],
            Value::String("claude_command_execution_permission_denied".to_string())
        );
        assert_eq!(
            mapped.message["params"]["requestId"],
            Value::String("tool-bash-1".to_string())
        );
    }

    #[test]
    fn tool_output_delta_maps_to_command_execution_output_delta() {
        let event = EngineEvent::ToolOutputDelta {
            workspace_id: "ws-live".to_string(),
            tool_id: "tool-7".to_string(),
            tool_name: Some("exec_command".to_string()),
            delta: "line 1\n".to_string(),
        };

        let mapped =
            engine_event_to_app_server_event(&event, "thread-1", "item-1").expect("mapped event");
        assert_eq!(
            mapped.message["method"],
            Value::String("item/commandExecution/outputDelta".to_string())
        );
        assert_eq!(
            mapped.message["params"]["itemId"],
            Value::String("tool-7".to_string())
        );
        assert_eq!(
            mapped.message["params"]["delta"],
            Value::String("line 1\n".to_string())
        );
    }

    #[test]
    fn tool_started_maps_exec_command_to_command_execution_item() {
        let event = EngineEvent::ToolStarted {
            workspace_id: "ws-live".to_string(),
            tool_id: "tool-8".to_string(),
            tool_name: "exec_command".to_string(),
            input: Some(json!({
                "command": "git log --oneline -10",
                "cwd": "/repo",
            })),
        };

        let mapped =
            engine_event_to_app_server_event(&event, "thread-1", "item-1").expect("mapped event");
        assert_eq!(
            mapped.message["method"],
            Value::String("item/started".to_string())
        );
        assert_eq!(
            mapped.message["params"]["item"]["type"],
            Value::String("commandExecution".to_string())
        );
        assert_eq!(
            mapped.message["params"]["item"]["input"]["command"],
            Value::String("git log --oneline -10".to_string())
        );
    }

    #[test]
    fn tool_started_maps_write_stdin_to_command_execution_item() {
        let event = EngineEvent::ToolStarted {
            workspace_id: "ws-live".to_string(),
            tool_id: "tool-stdin".to_string(),
            tool_name: "write_stdin".to_string(),
            input: Some(json!({
                "chars": "y\n",
            })),
        };

        let mapped =
            engine_event_to_app_server_event(&event, "thread-1", "item-1").expect("mapped event");
        assert_eq!(
            mapped.message["params"]["item"]["type"],
            Value::String("commandExecution".to_string())
        );
    }

    #[test]
    fn tool_completed_maps_exec_command_to_command_execution_item() {
        let event = EngineEvent::ToolCompleted {
            workspace_id: "ws-live".to_string(),
            tool_id: "tool-9".to_string(),
            tool_name: Some("exec_command".to_string()),
            output: Some(Value::String("commit-a\ncommit-b".to_string())),
            error: None,
        };

        let mapped =
            engine_event_to_app_server_event(&event, "thread-1", "item-1").expect("mapped event");
        assert_eq!(
            mapped.message["method"],
            Value::String("item/completed".to_string())
        );
        assert_eq!(
            mapped.message["params"]["item"]["type"],
            Value::String("commandExecution".to_string())
        );
        assert_eq!(
            mapped.message["params"]["item"]["aggregatedOutput"],
            Value::String("commit-a\ncommit-b".to_string())
        );
        assert_eq!(
            mapped.message["params"]["item"]["output"],
            Value::String("commit-a\ncommit-b".to_string())
        );
        assert_eq!(
            mapped.message["params"]["output"],
            Value::String("commit-a\ncommit-b".to_string())
        );
    }

    #[test]
    fn tool_input_updated_maps_to_item_updated() {
        let event = EngineEvent::ToolInputUpdated {
            workspace_id: "ws-live".to_string(),
            tool_id: "tool-10".to_string(),
            tool_name: Some("exec_command".to_string()),
            input: Some(json!({
                "command": "pwd",
            })),
        };

        let mapped =
            engine_event_to_app_server_event(&event, "thread-1", "item-1").expect("mapped event");
        assert_eq!(
            mapped.message["method"],
            Value::String("item/updated".to_string())
        );
        assert_eq!(
            mapped.message["params"]["item"]["input"]["command"],
            Value::String("pwd".to_string())
        );
    }

    #[test]
    fn tool_output_delta_maps_apply_patch_to_file_change_output_delta() {
        let event = EngineEvent::ToolOutputDelta {
            workspace_id: "ws-live".to_string(),
            tool_id: "tool-patch".to_string(),
            tool_name: Some("apply_patch".to_string()),
            delta: "*** Update File: src/App.tsx".to_string(),
        };

        let mapped =
            engine_event_to_app_server_event(&event, "thread-1", "item-1").expect("mapped event");
        assert_eq!(
            mapped.message["method"],
            Value::String("item/fileChange/outputDelta".to_string())
        );
    }

    #[test]
    fn tool_output_delta_maps_replace_tool_to_file_change_output_delta() {
        let event = EngineEvent::ToolOutputDelta {
            workspace_id: "ws-live".to_string(),
            tool_id: "tool-replace".to_string(),
            tool_name: Some("replace-1774440197988-0 README.md".to_string()),
            delta: "updated README snippet".to_string(),
        };

        let mapped =
            engine_event_to_app_server_event(&event, "thread-1", "item-1").expect("mapped event");
        assert_eq!(
            mapped.message["method"],
            Value::String("item/fileChange/outputDelta".to_string())
        );
    }

    #[test]
    fn tool_started_maps_generic_replace_tool_to_mcp_item() {
        let event = EngineEvent::ToolStarted {
            workspace_id: "ws-live".to_string(),
            tool_id: "tool-replace-generic".to_string(),
            tool_name: "replace_variables".to_string(),
            input: Some(json!({
                "variables": ["A", "B"]
            })),
        };

        let mapped =
            engine_event_to_app_server_event(&event, "thread-1", "item-1").expect("mapped event");
        assert_eq!(
            mapped.message["method"],
            Value::String("item/started".to_string())
        );
        assert_eq!(
            mapped.message["params"]["item"]["type"],
            Value::String("mcpToolCall".to_string())
        );
    }

    #[test]
    fn tool_started_maps_replace_tool_to_file_change_item() {
        let event = EngineEvent::ToolStarted {
            workspace_id: "ws-live".to_string(),
            tool_id: "tool-replace".to_string(),
            tool_name: "replace-1774440197988-0 README.md".to_string(),
            input: Some(json!({
                "instruction": "update docs",
                "old_string": "old",
                "new_string": "new"
            })),
        };

        let mapped =
            engine_event_to_app_server_event(&event, "thread-1", "item-1").expect("mapped event");
        assert_eq!(
            mapped.message["method"],
            Value::String("item/started".to_string())
        );
        assert_eq!(
            mapped.message["params"]["item"]["type"],
            Value::String("fileChange".to_string())
        );
    }

    #[test]
    fn claude_raw_compacting_maps_to_thread_compacting() {
        let event = EngineEvent::Raw {
            workspace_id: "ws-compact".to_string(),
            engine: EngineType::Claude,
            data: json!({
                "type": "system",
                "subtype": "compacting",
                "usage_percent": 96,
                "threshold_percent": 95,
                "target_percent": 70,
            }),
        };

        let mapped = engine_event_to_app_server_event(&event, "claude:thread-1", "item-1")
            .expect("mapped event");
        assert_eq!(
            mapped.message["method"],
            Value::String("thread/compacting".to_string())
        );
        assert_eq!(
            mapped.message["params"]["usagePercent"],
            Value::Number(96.into())
        );
        assert_eq!(
            mapped.message["params"]["thresholdPercent"],
            Value::Number(95.into())
        );
        assert_eq!(
            mapped.message["params"]["targetPercent"],
            Value::Number(70.into())
        );
    }

    #[test]
    fn claude_raw_compact_boundary_maps_to_thread_compacted() {
        let event = EngineEvent::Raw {
            workspace_id: "ws-compact".to_string(),
            engine: EngineType::Claude,
            data: json!({
                "type": "system",
                "event": "compact_boundary",
            }),
        };

        let mapped = engine_event_to_app_server_event(&event, "claude:thread-1", "item-42")
            .expect("mapped event");
        assert_eq!(
            mapped.message["method"],
            Value::String("thread/compacted".to_string())
        );
        assert_eq!(
            mapped.message["params"]["threadId"],
            Value::String("claude:thread-1".to_string())
        );
        assert_eq!(
            mapped.message["params"]["turnId"],
            Value::String("item-42".to_string())
        );
    }

    #[test]
    fn claude_raw_compaction_failed_maps_to_thread_compaction_failed() {
        let event = EngineEvent::Raw {
            workspace_id: "ws-compact".to_string(),
            engine: EngineType::Claude,
            data: json!({
                "type": "system",
                "subtype": "compaction_failed",
                "reason": "auto compact failed",
            }),
        };

        let mapped = engine_event_to_app_server_event(&event, "claude:thread-1", "item-1")
            .expect("mapped event");
        assert_eq!(
            mapped.message["method"],
            Value::String("thread/compactionFailed".to_string())
        );
        assert_eq!(
            mapped.message["params"]["reason"],
            Value::String("auto compact failed".to_string())
        );
    }

    #[test]
    fn non_claude_raw_compaction_signal_stays_raw_passthrough() {
        let event = EngineEvent::Raw {
            workspace_id: "ws-compact".to_string(),
            engine: EngineType::OpenCode,
            data: json!({
                "type": "system",
                "subtype": "compacting",
            }),
        };

        let mapped = engine_event_to_app_server_event(&event, "opencode:thread-1", "item-1")
            .expect("mapped event");
        assert_eq!(
            mapped.message["method"],
            Value::String("opencode/raw".to_string())
        );
    }
}
