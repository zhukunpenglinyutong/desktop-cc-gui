use serde_json::Value;

use super::approval::{
    classify_claude_mode_blocked_tool, command_can_apply_as_local_file_action,
    extract_claude_command_string, looks_like_claude_permission_denial_message,
    ClaudeModeBlockedKind,
};
use super::stream_helpers::{
    concat_reasoning_blocks, concat_text_blocks, extract_claude_tool_input,
    extract_claude_tool_name, extract_delta_text_from_event, extract_reasoning_fragment,
    extract_result_text, extract_tool_result_output, extract_tool_result_text,
    tool_result_is_error,
};
use super::ClaudeSession;
use crate::engine::events::EngineEvent;
use crate::engine::EngineType;

#[derive(Clone, Copy)]
enum ClaudeSyntheticApprovalKind {
    FileChange,
    CommandExecution,
}

fn is_claude_file_change_tool(tool_name: &str) -> bool {
    matches!(
        tool_name.trim().to_ascii_lowercase().as_str(),
        "applypatch"
            | "createfile"
            | "createdirectory"
            | "delete"
            | "deletefile"
            | "edit"
            | "multiedit"
            | "notebookedit"
            | "remove"
            | "removefile"
            | "rewrite"
            | "unlink"
            | "write"
    )
}

fn is_claude_command_tool(tool_name: &str) -> bool {
    matches!(
        classify_claude_mode_blocked_tool(tool_name),
        Some(ClaudeModeBlockedKind::CommandExecution)
    )
}

fn has_claude_permission_signal(message: &str) -> bool {
    looks_like_claude_permission_denial_message(message)
}

fn detect_claude_synthetic_approval_kind(
    tool_input: Option<&Value>,
    tool_name: &str,
    message: &str,
) -> Option<ClaudeSyntheticApprovalKind> {
    if !has_claude_permission_signal(message) {
        return None;
    }

    if is_claude_file_change_tool(tool_name) {
        return Some(ClaudeSyntheticApprovalKind::FileChange);
    }

    if is_claude_command_tool(tool_name) {
        if tool_input
            .and_then(extract_claude_command_string)
            .as_deref()
            .map(command_can_apply_as_local_file_action)
            .unwrap_or(false)
        {
            return Some(ClaudeSyntheticApprovalKind::FileChange);
        }
        return Some(ClaudeSyntheticApprovalKind::CommandExecution);
    }

    None
}

impl ClaudeSession {
    fn build_command_mode_blocked_signal(
        &self,
        turn_id: &str,
        tool_id: &str,
        tool_name: &str,
        output: &str,
    ) -> EngineEvent {
        self.clear_pending_tool(tool_id);
        self.clear_tool_input(tool_id);
        self.take_tool_name(tool_id);
        EngineEvent::Raw {
            workspace_id: self.workspace_id.clone(),
            engine: EngineType::Claude,
            data: serde_json::json!({
                "type": "permission_denied",
                "source": "claude_permission_denied",
                "blockedMethod": "item/commandExecution/requestApproval",
                "blocked_method": "item/commandExecution/requestApproval",
                "effectiveMode": "code",
                "effective_mode": "code",
                "reasonCode": "claude_command_execution_permission_denied",
                "reason_code": "claude_command_execution_permission_denied",
                "reason": "Claude blocked a command-execution tool before any recoverable GUI approval request could start.",
                "suggestion": "Claude default mode cannot recover blocked Bash/command tools through the GUI approval bridge yet. Retry in full-access or rewrite the action to use supported file tools.",
                "requestId": tool_id,
                "request_id": tool_id,
                "toolName": tool_name,
                "tool_name": tool_name,
                "rawError": output,
                "raw_error": output,
                "turnId": turn_id,
                "turn_id": turn_id,
            }),
        }
    }

    fn maybe_handle_claude_permission_block(
        &self,
        turn_id: &str,
        tool_id: &str,
        output: &str,
    ) -> Option<EngineEvent> {
        let Some(tool_name) = self.peek_tool_name(tool_id) else {
            return None;
        };
        let tool_input = self.peek_tool_input_value(tool_id);
        let Some(kind) =
            detect_claude_synthetic_approval_kind(tool_input.as_ref(), &tool_name, output)
        else {
            return None;
        };

        match kind {
            ClaudeSyntheticApprovalKind::FileChange => {
                let request_id = Value::String(tool_id.to_string());
                let input = tool_input;
                if let Ok(mut pending) = self.pending_approval_requests.lock() {
                    pending.insert(tool_id.to_string(), turn_id.to_string());
                }
                self.emit_turn_event(
                    turn_id,
                    EngineEvent::ApprovalRequest {
                        workspace_id: self.workspace_id.clone(),
                        request_id,
                        tool_name,
                        input,
                        message: Some(
                            "Approve to let the GUI apply this file change locally. Preview currently supports structured file tools plus safe single-path file commands.".to_string(),
                        ),
                    },
                );
                None
            }
            ClaudeSyntheticApprovalKind::CommandExecution => {
                Some(self.build_command_mode_blocked_signal(turn_id, tool_id, &tool_name, output))
            }
        }
    }

    /// Convert Claude event to unified format
    /// Handles Claude CLI 2.0.52+ event format: system, assistant, result, error
    pub(super) fn convert_event(&self, turn_id: &str, event: &Value) -> Option<EngineEvent> {
        // Debug: print the full event JSON
        log::debug!(
            "[claude] Received event: {}",
            serde_json::to_string_pretty(event).unwrap_or_else(|_| event.to_string())
        );

        // Check for context_window field in ANY event (Claude statusline/hooks)
        // This provides the most accurate context usage snapshot
        self.try_extract_context_window_usage(turn_id, event);

        let event_type = event.get("type")?.as_str()?;

        match event_type {
            // Legacy stream_event format (kept for backward compatibility)
            "stream_event" => self.convert_stream_event(turn_id, event),

            // Claude CLI 2.0.52+ format: system init event
            "system" => {
                let has_init_payload = event
                    .get("subtype")
                    .and_then(|value| value.as_str())
                    .map(|value| value.eq_ignore_ascii_case("init"))
                    .unwrap_or(false)
                    || event.get("tools").is_some()
                    || event.get("mcp_servers").is_some()
                    || event.get("mcpServers").is_some();

                if has_init_payload {
                    return Some(EngineEvent::Raw {
                        workspace_id: self.workspace_id.clone(),
                        engine: EngineType::Claude,
                        data: event.clone(),
                    });
                }

                // System events contain session_id and initialization info
                // Extract session_id here as a fallback (also checked at top-level parsing)
                // Check both snake_case (session_id) and camelCase (sessionId) field names
                if let Some(sid) = event
                    .get("session_id")
                    .or_else(|| event.get("sessionId"))
                    .and_then(|v| v.as_str())
                {
                    if !sid.is_empty() && sid != "pending" {
                        return Some(EngineEvent::SessionStarted {
                            workspace_id: self.workspace_id.clone(),
                            session_id: sid.to_string(),
                            engine: EngineType::Claude,
                        });
                    }
                }
                if Self::has_compaction_system_signal(event) {
                    return Some(EngineEvent::Raw {
                        workspace_id: self.workspace_id.clone(),
                        engine: EngineType::Claude,
                        data: event.clone(),
                    });
                }
                None
            }

            // Claude CLI 2.0.52+ format: assistant message event
            "assistant" => {
                // Extract text content from the message
                if let Some(message) = event.get("message") {
                    if let Some(content) = message.get("content").and_then(|c| c.as_array()) {
                        let reasoning_text = concat_reasoning_blocks(content);

                        if let Some(cumulative_text) = concat_text_blocks(content) {
                            // assistant partial messages contain cumulative text.
                            // Compute the true delta to avoid sending the full text
                            // on every update, which causes excessive re-renders.
                            let delta = self.compute_text_delta(turn_id, &cumulative_text);
                            if !delta.is_empty() {
                                if let Some(reasoning) = reasoning_text.as_deref() {
                                    self.emit_turn_event(
                                        turn_id,
                                        EngineEvent::ReasoningDelta {
                                            workspace_id: self.workspace_id.clone(),
                                            text: reasoning.to_string(),
                                        },
                                    );
                                }
                                return Some(EngineEvent::TextDelta {
                                    workspace_id: self.workspace_id.clone(),
                                    text: delta,
                                });
                            }
                        }

                        for block in content {
                            let block_type = block.get("type").and_then(|t| t.as_str());
                            match block_type {
                                Some("tool_use") => {
                                    let tool_name = extract_claude_tool_name(block)
                                        .unwrap_or_else(|| "unknown".to_string());
                                    let index = block.get("index").and_then(|v| v.as_i64());
                                    let tool_id = self
                                        .resolve_tool_use_id(block, index)
                                        .unwrap_or_else(|| "unknown".to_string());
                                    let input = extract_claude_tool_input(block);

                                    if let Some(index) = index {
                                        self.cache_tool_block_index(turn_id, index, &tool_id);
                                    }
                                    self.cache_tool_name(&tool_id, &tool_name);
                                    if let Some(input) = input.as_ref() {
                                        self.cache_tool_input_value(&tool_id, input);
                                    }
                                    self.register_pending_tool(
                                        turn_id,
                                        &tool_id,
                                        &tool_name,
                                        input.as_ref(),
                                    );

                                    // Intercept AskUserQuestion tool to emit a RequestUserInput event
                                    if tool_name == "AskUserQuestion" {
                                        if let Some(ref input_val) = input {
                                            return self.convert_ask_user_question_to_request(
                                                &tool_id, input_val, turn_id,
                                            );
                                        }
                                    }

                                    return Some(EngineEvent::ToolStarted {
                                        workspace_id: self.workspace_id.clone(),
                                        tool_id: tool_id.to_string(),
                                        tool_name,
                                        input,
                                    });
                                }
                                Some("tool_result") => {
                                    let index = block.get("index").and_then(|v| v.as_i64());
                                    let tool_id = self
                                        .resolve_tool_result_id(turn_id, block, index)
                                        .unwrap_or_default();
                                    if tool_id.is_empty() {
                                        return None;
                                    }
                                    let content =
                                        block.get("content").or_else(|| block.get("tool_output"));
                                    let is_error = block
                                        .get("is_error")
                                        .or_else(|| block.get("isError"))
                                        .and_then(|v| v.as_bool())
                                        .unwrap_or(false);
                                    let output = content.and_then(extract_tool_result_text);
                                    if is_error {
                                        if let Some(text) = output.as_deref() {
                                            if let Some(mode_blocked_event) = self
                                                .maybe_handle_claude_permission_block(
                                                    turn_id, &tool_id, text,
                                                )
                                            {
                                                self.clear_tool_block_index(turn_id, index);
                                                return Some(mode_blocked_event);
                                            }
                                            if self.has_pending_approval_request(&Value::String(
                                                tool_id.clone(),
                                            )) {
                                                self.clear_tool_block_index(turn_id, index);
                                                return None;
                                            }
                                        }
                                    }
                                    let result =
                                        self.build_tool_completed(&tool_id, output, is_error);
                                    self.clear_tool_block_index(turn_id, index);
                                    return result;
                                }
                                _ => {}
                            }
                        }

                        if let Some(reasoning) = reasoning_text {
                            return Some(EngineEvent::ReasoningDelta {
                                workspace_id: self.workspace_id.clone(),
                                text: reasoning,
                            });
                        }
                    }
                }
                None
            }

            // Compatibility: some runtimes emit explicit delta events instead of
            // cumulative assistant snapshots.
            "assistant_message_delta" | "message_delta" | "text_delta" | "output_text_delta" => {
                if let Some(text) =
                    extract_delta_text_from_event(event).or_else(|| extract_result_text(event))
                {
                    if !text.is_empty() {
                        return Some(EngineEvent::TextDelta {
                            workspace_id: self.workspace_id.clone(),
                            text,
                        });
                    }
                }
                None
            }

            // Compatibility: some runtimes emit assistant snapshots as
            // `assistant_message`/`message`.
            "assistant_message" | "message" => {
                let role = event
                    .get("message")
                    .and_then(|m| m.get("role"))
                    .or_else(|| event.get("role"))
                    .and_then(|value| value.as_str())
                    .unwrap_or("")
                    .to_ascii_lowercase();
                if role == "user" {
                    return None;
                }
                if let Some(cumulative_text) = extract_result_text(event) {
                    let delta = self.compute_text_delta(turn_id, &cumulative_text);
                    if !delta.is_empty() {
                        return Some(EngineEvent::TextDelta {
                            workspace_id: self.workspace_id.clone(),
                            text: delta,
                        });
                    }
                }
                None
            }

            "user" => {
                if let Some(message) = event.get("message") {
                    if let Some(content) = message.get("content").and_then(|c| c.as_array()) {
                        for block in content {
                            let block_type = block.get("type").and_then(|t| t.as_str());
                            if block_type != Some("tool_result") {
                                continue;
                            }

                            let index = block.get("index").and_then(|v| v.as_i64());
                            let tool_id = self
                                .resolve_tool_result_id(turn_id, block, index)
                                .unwrap_or_default();
                            if tool_id.is_empty() {
                                continue;
                            }

                            let is_error = tool_result_is_error(block, event);
                            let output = extract_tool_result_output(block, event);
                            if is_error {
                                if let Some(text) = output.as_deref() {
                                    if let Some(mode_blocked_event) = self
                                        .maybe_handle_claude_permission_block(
                                            turn_id, &tool_id, text,
                                        )
                                    {
                                        self.clear_tool_block_index(turn_id, index);
                                        return Some(mode_blocked_event);
                                    }
                                    if self.has_pending_approval_request(&Value::String(
                                        tool_id.clone(),
                                    )) {
                                        self.clear_tool_block_index(turn_id, index);
                                        return None;
                                    }
                                }
                            }
                            let result = self.build_tool_completed(&tool_id, output, is_error);
                            self.clear_tool_block_index(turn_id, index);
                            return result;
                        }
                    }
                }

                Some(EngineEvent::Raw {
                    workspace_id: self.workspace_id.clone(),
                    engine: EngineType::Claude,
                    data: event.clone(),
                })
            }

            // Claude CLI 2.0.52+ format: final result event
            "result" => {
                // Note: Usage extraction is handled by try_extract_context_window_usage()
                // which looks for context_window.current_usage (the accurate context snapshot)
                // We don't use result.usage here as it represents cumulative session stats,
                // not the current context window usage

                // Final result event - turn completed
                Some(EngineEvent::TurnCompleted {
                    workspace_id: self.workspace_id.clone(),
                    result: Some(event.clone()),
                })
            }

            "reasoning_delta" | "thinking_delta" => {
                let text = extract_reasoning_fragment(event)
                    .map(|value| value.to_string())
                    .or_else(|| extract_delta_text_from_event(event))?;
                Some(EngineEvent::ReasoningDelta {
                    workspace_id: self.workspace_id.clone(),
                    text,
                })
            }

            "error" => {
                let message = event
                    .get("error")
                    .and_then(|e| e.get("message"))
                    .or_else(|| event.get("error"))
                    .and_then(|m| m.as_str())
                    .or_else(|| event.get("message").and_then(|m| m.as_str()))
                    .unwrap_or("Unknown error");
                if let Some(mode_blocked_event) =
                    self.build_mode_blocked_signal_from_error(turn_id, message)
                {
                    return Some(mode_blocked_event);
                }
                Some(EngineEvent::TurnError {
                    workspace_id: self.workspace_id.clone(),
                    error: message.to_string(),
                    code: event
                        .get("error")
                        .and_then(|e| e.get("code"))
                        .and_then(|c| c.as_str())
                        .map(|s| s.to_string()),
                })
            }
            "tool_use" => {
                let tool_name =
                    extract_claude_tool_name(event).unwrap_or_else(|| "unknown".to_string());
                let index = event.get("index").and_then(|v| v.as_i64());
                let tool_id = self
                    .resolve_tool_use_id(event, index)
                    .unwrap_or_else(|| "unknown".to_string());
                let input = extract_claude_tool_input(event);
                if let Some(index) = index {
                    self.cache_tool_block_index(turn_id, index, &tool_id);
                }
                self.cache_tool_name(&tool_id, &tool_name);
                if let Some(input) = input.as_ref() {
                    self.cache_tool_input_value(&tool_id, input);
                }
                self.register_pending_tool(turn_id, &tool_id, &tool_name, input.as_ref());

                // Intercept AskUserQuestion tool to emit a RequestUserInput event
                if tool_name == "AskUserQuestion" {
                    if let Some(ref input_val) = input {
                        return self
                            .convert_ask_user_question_to_request(&tool_id, input_val, turn_id);
                    }
                }

                Some(EngineEvent::ToolStarted {
                    workspace_id: self.workspace_id.clone(),
                    tool_id: tool_id.to_string(),
                    tool_name,
                    input,
                })
            }
            "tool_result" => {
                let index = event.get("index").and_then(|v| v.as_i64());
                let tool_id = self
                    .resolve_tool_result_id(turn_id, event, index)
                    .unwrap_or_default();
                if tool_id.is_empty() {
                    return None;
                }
                let content = event.get("content").or_else(|| event.get("tool_output"));
                let is_error = event
                    .get("is_error")
                    .or_else(|| event.get("isError"))
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let output = content.and_then(extract_tool_result_text);
                if is_error {
                    if let Some(text) = output.as_deref() {
                        if let Some(mode_blocked_event) =
                            self.maybe_handle_claude_permission_block(turn_id, &tool_id, text)
                        {
                            self.clear_tool_block_index(turn_id, index);
                            return Some(mode_blocked_event);
                        }
                        if self.has_pending_approval_request(&Value::String(tool_id.clone())) {
                            self.clear_tool_block_index(turn_id, index);
                            return None;
                        }
                    }
                }
                let result = self.build_tool_completed(&tool_id, output, is_error);
                self.clear_tool_block_index(turn_id, index);
                result
            }

            _ => {
                // Pass through as raw event
                Some(EngineEvent::Raw {
                    workspace_id: self.workspace_id.clone(),
                    engine: EngineType::Claude,
                    data: event.clone(),
                })
            }
        }
    }

    /// Convert stream_event type
    fn convert_stream_event(&self, turn_id: &str, event: &Value) -> Option<EngineEvent> {
        let inner = event.get("event")?;
        let inner_type = inner.get("type").and_then(|v| v.as_str()).unwrap_or("");

        if inner_type == "content_block_start" {
            if let Some(block) = inner.get("content_block") {
                let block_type = block.get("type").and_then(|v| v.as_str()).unwrap_or("");
                match block_type {
                    "tool_use" => {
                        let tool_name = extract_claude_tool_name(block)
                            .unwrap_or_else(|| "unknown".to_string());
                        let index = inner.get("index").and_then(|v| v.as_i64());
                        let tool_id = self
                            .resolve_tool_use_id(block, index)
                            .unwrap_or_else(|| "unknown".to_string());
                        let input = extract_claude_tool_input(block);
                        if let Some(index) = index {
                            self.cache_tool_block_index(turn_id, index, &tool_id);
                        }

                        self.cache_tool_name(&tool_id, &tool_name);
                        if let Some(input) = input.as_ref() {
                            self.cache_tool_input_value(&tool_id, input);
                        }
                        self.register_pending_tool(turn_id, &tool_id, &tool_name, input.as_ref());
                        return Some(EngineEvent::ToolStarted {
                            workspace_id: self.workspace_id.clone(),
                            tool_id: tool_id.to_string(),
                            tool_name,
                            input,
                        });
                    }
                    "tool_result" => {
                        let index = inner.get("index").and_then(|v| v.as_i64());
                        let tool_id = self
                            .resolve_tool_result_id(turn_id, block, index)
                            .unwrap_or_default();
                        if tool_id.is_empty() {
                            return None;
                        }
                        if let Some(index) = index {
                            self.cache_tool_block_index(turn_id, index, &tool_id);
                        }
                        let content = block.get("content").or_else(|| block.get("tool_output"));
                        if content.is_none() {
                            return None;
                        }
                        let is_error = block
                            .get("is_error")
                            .or_else(|| block.get("isError"))
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false);
                        let output = content.and_then(extract_tool_result_text);
                        if is_error {
                            if let Some(text) = output.as_deref() {
                                if let Some(mode_blocked_event) = self
                                    .maybe_handle_claude_permission_block(turn_id, &tool_id, text)
                                {
                                    self.clear_tool_block_index(turn_id, index);
                                    return Some(mode_blocked_event);
                                }
                                if self
                                    .has_pending_approval_request(&Value::String(tool_id.clone()))
                                {
                                    self.clear_tool_block_index(turn_id, index);
                                    return None;
                                }
                            }
                        }
                        if let Some(event) = self.build_tool_completed(&tool_id, output, is_error) {
                            self.clear_tool_block_index(turn_id, index);
                            return Some(event);
                        }
                    }
                    _ => {}
                }
            }
        }

        if inner_type == "content_block_delta" {
            let delta = inner.get("delta");
            let delta_type = delta
                .and_then(|d| d.get("type"))
                .and_then(|t| t.as_str())
                .unwrap_or("");
            if delta_type == "input_json_delta" {
                let partial = delta
                    .and_then(|d| d.get("partial_json"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let index = inner.get("index").and_then(|v| v.as_i64());
                if let Some(tool_id) = self.tool_id_for_block_index(turn_id, index) {
                    if let Some(input) = self.append_tool_input(&tool_id, partial) {
                        let tool_name = self.peek_tool_name(&tool_id);
                        return Some(EngineEvent::ToolInputUpdated {
                            workspace_id: self.workspace_id.clone(),
                            tool_id,
                            tool_name,
                            input: Some(input),
                        });
                    }
                }
            }
        }

        let delta = inner.get("delta");
        let delta_type = delta
            .and_then(|d| d.get("type"))
            .and_then(|t| t.as_str())
            .unwrap_or("");

        match delta_type {
            "text_delta" => {
                let text = delta?.get("text")?.as_str()?;
                let index = inner.get("index").and_then(|v| v.as_i64());
                if let Some(tool_id) = self.tool_id_for_block_index(turn_id, index) {
                    if let Some(event) = self.build_tool_output_delta(&tool_id, text) {
                        return Some(event);
                    }
                }
                Some(EngineEvent::TextDelta {
                    workspace_id: self.workspace_id.clone(),
                    text: text.to_string(),
                })
            }
            "thinking_delta" | "reasoning_delta" => {
                let text = extract_reasoning_fragment(delta?)?;
                Some(EngineEvent::ReasoningDelta {
                    workspace_id: self.workspace_id.clone(),
                    text: text.to_string(),
                })
            }
            "tool_use" => {
                let tool_name = delta
                    .and_then(|d| d.get("name"))
                    .or_else(|| inner.get("name"))
                    .and_then(|n| n.as_str())
                    .unwrap_or("unknown");
                let index = inner.get("index").and_then(|v| v.as_i64());
                let tool_id = self
                    .resolve_tool_use_id(delta.unwrap_or(inner), index)
                    .unwrap_or_else(|| "unknown".to_string());
                let input = delta
                    .and_then(|d| d.get("input"))
                    .cloned()
                    .or_else(|| inner.get("input").cloned());

                if let Some(index) = index {
                    self.cache_tool_block_index(turn_id, index, &tool_id);
                }
                self.cache_tool_name(&tool_id, tool_name);
                if let Some(input) = input.as_ref() {
                    self.cache_tool_input_value(&tool_id, input);
                }
                self.register_pending_tool(turn_id, &tool_id, tool_name, input.as_ref());
                Some(EngineEvent::ToolStarted {
                    workspace_id: self.workspace_id.clone(),
                    tool_id: tool_id.to_string(),
                    tool_name: tool_name.to_string(),
                    input,
                })
            }
            "tool_result" => {
                let index = inner.get("index").and_then(|v| v.as_i64());
                let block = delta.unwrap_or(inner);
                let tool_id = self
                    .resolve_tool_result_id(turn_id, block, index)
                    .unwrap_or_default();
                if tool_id.is_empty() {
                    return None;
                }
                let content = block.get("content").or_else(|| block.get("tool_output"));
                let is_error = block
                    .get("is_error")
                    .or_else(|| block.get("isError"))
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let output = content.and_then(extract_tool_result_text);
                if is_error {
                    if let Some(text) = output.as_deref() {
                        if let Some(mode_blocked_event) =
                            self.maybe_handle_claude_permission_block(turn_id, &tool_id, text)
                        {
                            self.clear_tool_block_index(turn_id, index);
                            return Some(mode_blocked_event);
                        }
                        if self.has_pending_approval_request(&Value::String(tool_id.clone())) {
                            self.clear_tool_block_index(turn_id, index);
                            return None;
                        }
                    }
                }
                let result = self.build_tool_completed(&tool_id, output, is_error);
                self.clear_tool_block_index(turn_id, index);
                result
            }
            _ => None,
        }
    }
}
