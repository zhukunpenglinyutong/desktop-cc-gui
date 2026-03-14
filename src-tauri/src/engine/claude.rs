//! Claude Code engine implementation
//!
//! Handles Claude Code CLI execution via `claude -p` (print mode) with
//! streaming JSON output.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::sync::Mutex as StdMutex;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{broadcast, Mutex, Notify, RwLock};

use super::events::EngineEvent;
use super::{EngineConfig, EngineType, SendMessageParams};

#[derive(Debug, Clone)]
pub struct ClaudeTurnEvent {
    pub turn_id: String,
    pub event: EngineEvent,
}

#[derive(Debug, Clone)]
struct PendingClaudeTool {
    turn_id: String,
    tool_id: String,
    tool_name: String,
    input_signature: Option<String>,
}

/// Claude Code session for a workspace
pub struct ClaudeSession {
    /// Workspace identifier
    pub workspace_id: String,
    /// Workspace directory path
    pub workspace_path: PathBuf,
    /// Current Claude session ID (for --resume)
    session_id: RwLock<Option<String>>,
    /// Event broadcaster
    event_sender: broadcast::Sender<ClaudeTurnEvent>,
    /// Custom binary path
    bin_path: Option<String>,
    /// Custom home directory
    home_dir: Option<String>,
    /// Additional CLI arguments
    custom_args: Option<String>,
    /// Active child processes by turn ID (supports concurrent turns)
    active_processes: Mutex<HashMap<String, Child>>,
    /// Flag set by interrupt() so send_message() knows the process was killed intentionally
    interrupted: AtomicBool,
    /// Track tool names for completion events
    tool_name_by_id: StdMutex<HashMap<String, String>>,
    /// Track tool input buffers for streaming input_json_delta
    tool_input_by_id: StdMutex<HashMap<String, String>>,
    /// Cache the latest structured tool input so completion events can reuse it
    tool_input_value_by_id: StdMutex<HashMap<String, Value>>,
    /// Map turn-scoped content block index to tool id
    tool_id_by_block_index: StdMutex<HashMap<(String, i64), String>>,
    /// Track unresolved tools so transcript-style tool_result payloads can be paired back
    pending_tools: StdMutex<Vec<PendingClaudeTool>>,
    /// Last emitted text for assistant partial messages (used to compute true delta)
    last_emitted_text: StdMutex<String>,
    /// Stdin handles per turn for AskUserQuestion responses
    stdin_by_turn: Mutex<HashMap<String, ChildStdin>>,
    /// Pending AskUserQuestion requests: request_id_hash -> turn_id
    pending_user_inputs: StdMutex<HashMap<i64, String>>,
    /// Signal to resume stdout processing after user responds to AskUserQuestion
    user_input_notify: Arc<Notify>,
    /// Stores user's formatted AskUserQuestion answer for the kill+resume mechanism
    user_input_answer: StdMutex<Option<String>>,
}

impl ClaudeSession {
    /// Create a new Claude session for a workspace
    pub fn new(
        workspace_id: String,
        workspace_path: PathBuf,
        config: Option<EngineConfig>,
    ) -> Self {
        let (event_sender, _) = broadcast::channel(1024);
        let config = config.unwrap_or_default();

        Self {
            workspace_id,
            workspace_path,
            session_id: RwLock::new(None),
            event_sender,
            bin_path: config.bin_path,
            home_dir: config.home_dir,
            custom_args: config.custom_args,
            active_processes: Mutex::new(HashMap::new()),
            interrupted: AtomicBool::new(false),
            tool_name_by_id: StdMutex::new(HashMap::new()),
            tool_input_by_id: StdMutex::new(HashMap::new()),
            tool_input_value_by_id: StdMutex::new(HashMap::new()),
            tool_id_by_block_index: StdMutex::new(HashMap::new()),
            pending_tools: StdMutex::new(Vec::new()),
            last_emitted_text: StdMutex::new(String::new()),
            stdin_by_turn: Mutex::new(HashMap::new()),
            pending_user_inputs: StdMutex::new(HashMap::new()),
            user_input_notify: Arc::new(Notify::new()),
            user_input_answer: StdMutex::new(None),
        }
    }

    /// Get a receiver for engine events
    pub fn subscribe(&self) -> broadcast::Receiver<ClaudeTurnEvent> {
        self.event_sender.subscribe()
    }

    /// Get current session ID
    pub async fn get_session_id(&self) -> Option<String> {
        self.session_id.read().await.clone()
    }

    /// Emit a TurnError event to notify the frontend when an error occurs
    /// outside the normal send_message flow (e.g., spawn failure, early errors).
    fn emit_turn_event(&self, turn_id: &str, event: EngineEvent) {
        let _ = self.event_sender.send(ClaudeTurnEvent {
            turn_id: turn_id.to_string(),
            event,
        });
    }

    pub fn emit_error(&self, turn_id: &str, error: String) {
        self.emit_turn_event(
            turn_id,
            EngineEvent::TurnError {
                workspace_id: self.workspace_id.clone(),
                error,
                code: None,
            },
        );
    }

    /// Set session ID (after successful execution)
    pub async fn set_session_id(&self, id: Option<String>) {
        *self.session_id.write().await = id;
    }

    /// Build the Claude CLI command
    fn build_command(&self, params: &SendMessageParams, has_images: bool) -> Command {
        // Resolve the Claude CLI binary path:
        // 1. Use custom bin_path if configured
        // 2. Otherwise use find_cli_binary() to search npm global, cargo, etc.
        // 3. Fall back to bare "claude" as last resort
        let bin = if let Some(ref custom) = self.bin_path {
            custom.clone()
        } else {
            crate::backend::app_server::find_cli_binary("claude", None)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|| "claude".to_string())
        };

        // Use build_command_for_binary to properly handle .cmd/.bat files on Windows
        let mut cmd = crate::backend::app_server::build_command_for_binary(&bin);

        // Set working directory
        cmd.current_dir(&self.workspace_path);

        // Print mode (non-interactive)
        cmd.arg("-p");

        if has_images {
            // When images are present, use stream-json input format
            // The actual content will be sent via stdin
            cmd.arg(""); // Empty string as placeholder, real content via stdin
            cmd.arg("--input-format");
            cmd.arg("stream-json");
        } else {
            // Text-only mode
            cmd.arg(&params.text);
        }

        // Output format for streaming
        cmd.arg("--output-format");
        cmd.arg("stream-json");

        // Verbose for more events
        cmd.arg("--verbose");

        // Include partial messages for streaming text
        cmd.arg("--include-partial-messages");

        // Access mode / permission handling
        // Maps UI access modes to Claude Code CLI permission flags
        match params.access_mode.as_deref() {
            Some("full-access") => {
                // Full access: bypass all permission checks
                cmd.arg("--dangerously-skip-permissions");
            }
            Some("read-only") => {
                // Read-only / Plan mode: only allow planning, no execution
                cmd.arg("--permission-mode");
                cmd.arg("plan");
            }
            Some("default") => {
                // Default mode: each tool use requires explicit permission
                cmd.arg("--permission-mode");
                cmd.arg("default");
            }
            _ => {
                // "current" mode: auto-accept edits but still prompt for dangerous ops
                cmd.arg("--permission-mode");
                cmd.arg("acceptEdits");
            }
        }

        // Model selection
        if let Some(ref model) = params.model {
            cmd.arg("--model");
            cmd.arg(model);
        }

        // Session continuation / explicit session identity
        if params.continue_session {
            if let Some(ref session_id) = params.session_id {
                cmd.arg("--resume");
                cmd.arg(session_id);
            } else {
                cmd.arg("--continue");
            }
        } else if let Some(ref session_id) = params.session_id {
            // Force a fresh, stable identity for "new conversation" runs.
            // This prevents concurrent Claude turns from collapsing into the
            // same persisted session due CLI implicit reuse behavior.
            cmd.arg("--session-id");
            cmd.arg(session_id);
        }

        if let Some(spec_root) = params
            .custom_spec_root
            .as_ref()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
        {
            let spec_path = Path::new(spec_root);
            if spec_path.is_absolute() && spec_path != self.workspace_path.as_path() {
                cmd.arg("--add-dir");
                cmd.arg(spec_root);
            }
        }

        // Custom arguments
        if let Some(ref args) = self.custom_args {
            for arg in args.split_whitespace() {
                cmd.arg(arg);
            }
        }

        // Set up stdio - always pipe stdin so we can write responses
        // for AskUserQuestion tool calls mid-stream
        cmd.stdin(Stdio::piped());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        // Environment
        if let Some(ref home) = self.home_dir {
            cmd.env("CLAUDE_HOME", home);
        }

        cmd
    }

    /// Send a message and stream the response
    pub async fn send_message(
        &self,
        params: SendMessageParams,
        turn_id: &str,
    ) -> Result<String, String> {
        // Reset cumulative text tracker for the new turn
        if let Ok(mut last) = self.last_emitted_text.lock() {
            last.clear();
        }

        // Detect if there are images
        let has_images = params
            .images
            .as_ref()
            .map_or(false, |imgs| imgs.iter().any(|s| !s.trim().is_empty()));

        let mut cmd = self.build_command(&params, has_images);

        // Spawn the process
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn claude: {}", e))?;

        // If there are images, write the message content to stdin
        if has_images {
            if let Some(mut stdin) = child.stdin.take() {
                let message = build_message_content(&params)?;
                let message_str = serde_json::to_string(&message)
                    .map_err(|e| format!("Failed to serialize message: {}", e))?;

                stdin
                    .write_all(message_str.as_bytes())
                    .await
                    .map_err(|e| format!("Failed to write to stdin: {}", e))?;
                stdin
                    .write_all(b"\n")
                    .await
                    .map_err(|e| format!("Failed to write newline: {}", e))?;
                // Drop stdin to signal EOF
                drop(stdin);
            }
        } else {
            // For non-image messages, drop stdin immediately so the CLI
            // doesn't hang waiting for EOF.
            drop(child.stdin.take());
        }

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Failed to capture stdout".to_string())?;

        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Failed to capture stderr".to_string())?;

        // Store child for interruption (per turn)
        {
            let mut active = self.active_processes.lock().await;
            active.insert(turn_id.to_string(), child);
        }

        // Emit session started event
        self.emit_turn_event(
            turn_id,
            EngineEvent::SessionStarted {
                workspace_id: self.workspace_id.clone(),
                session_id: "pending".to_string(),
                engine: EngineType::Claude,
            },
        );

        // Emit turn started event
        self.emit_turn_event(
            turn_id,
            EngineEvent::TurnStarted {
                workspace_id: self.workspace_id.clone(),
                turn_id: turn_id.to_string(),
            },
        );

        // Read stdout line by line
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        let mut response_text = String::new();
        let mut saw_text_delta = false;
        let mut new_session_id: Option<String> = None;
        let mut error_output = String::new();
        let mut stream_runtime_error: Option<String> = None;
        let mut stream_error_event_emitted = false;

        // Spawn stderr reader
        let stderr_reader = BufReader::new(stderr);
        let _workspace_id_clone = self.workspace_id.clone();
        let stderr_handle = tokio::spawn(async move {
            let mut lines = stderr_reader.lines();
            let mut stderr_text = String::new();
            while let Ok(Some(line)) = lines.next_line().await {
                stderr_text.push_str(&line);
                stderr_text.push('\n');
            }
            stderr_text
        });

        // Process stdout events
        let mut session_id_emitted = false;
        while let Ok(Some(line)) = lines.next_line().await {
            if line.trim().is_empty() {
                continue;
            }

            match parse_claude_stream_json_line(&line) {
                Ok(event) => {
                    // If Claude only emits a final result without streaming deltas,
                    // synthesize a text delta so the frontend still renders a reply.
                    if !saw_text_delta {
                        if let Some(event_type) = event.get("type").and_then(|v| v.as_str()) {
                            if event_type == "result" {
                                if let Some(text) = extract_result_text(&event) {
                                    if !text.trim().is_empty() {
                                        saw_text_delta = true;
                                        response_text.push_str(&text);
                                        self.emit_turn_event(
                                            turn_id,
                                            EngineEvent::TextDelta {
                                                workspace_id: self.workspace_id.clone(),
                                                text,
                                            },
                                        );
                                    }
                                }
                            }
                        }
                    }

                    // Extract session ID if present and emit event with real session_id
                    // Check both snake_case (session_id) and camelCase (sessionId) field names
                    let sid = event
                        .get("session_id")
                        .or_else(|| event.get("sessionId"))
                        .and_then(|v| v.as_str());
                    if let Some(sid) = sid {
                        if !sid.is_empty() && sid != "pending" && !session_id_emitted {
                            new_session_id = Some(sid.to_string());
                            session_id_emitted = true;
                            // Emit SessionStarted with real session_id so frontend can update thread ID
                            self.emit_turn_event(
                                turn_id,
                                EngineEvent::SessionStarted {
                                    workspace_id: self.workspace_id.clone(),
                                    session_id: sid.to_string(),
                                    engine: EngineType::Claude,
                                },
                            );
                        }
                    }

                    // Convert and emit event
                    if let Some(unified_event) = self.convert_event(turn_id, &event) {
                        if let EngineEvent::TurnError { ref error, .. } = unified_event {
                            if stream_runtime_error.is_none() {
                                stream_runtime_error = Some(error.clone());
                            }
                            stream_error_event_emitted = true;
                        }

                        // Collect text for final response
                        if let EngineEvent::TextDelta { ref text, .. } = unified_event {
                            response_text.push_str(text);
                            saw_text_delta = true;
                        }

                        let is_user_input_request =
                            matches!(&unified_event, EngineEvent::RequestUserInput { .. });

                        self.emit_turn_event(turn_id, unified_event);

                        // When AskUserQuestion is detected, delegate to the
                        // dedicated handler which waits for user input, kills the
                        // current CLI, and restarts with --resume.
                        if is_user_input_request {
                            if let Some(new_lines) = self
                                .handle_ask_user_question_resume(turn_id, &params, &new_session_id)
                                .await
                            {
                                lines = new_lines;
                                continue;
                            }
                        }
                    }
                }
                Err(_e) => {
                    let trimmed = line.trim();
                    if is_claude_stream_control_line(trimmed) {
                        continue;
                    }
                    // Non-JSON output, might be error
                    error_output.push_str(&line);
                    error_output.push('\n');
                    if stream_runtime_error.is_none() {
                        if looks_like_claude_runtime_error(trimmed) {
                            stream_runtime_error = Some(trimmed.to_string());
                        }
                    }
                }
            }
        }

        // Wait for process to complete
        let mut child = {
            let mut active = self.active_processes.lock().await;
            active.remove(turn_id)
        };
        let status = if let Some(mut child_proc) = child.take() {
            child_proc.wait().await.ok()
        } else {
            None
        };

        // Get stderr
        let stderr_text = stderr_handle.await.unwrap_or_default();
        if !stderr_text.trim().is_empty() {
            error_output.push_str(&stderr_text);
        }

        // Update session ID
        if let Some(sid) = new_session_id {
            self.set_session_id(Some(sid)).await;
        }

        // Check for errors - emit TurnError whenever the process exits with
        // a non-zero status, regardless of whether partial output was received.
        // Previously this only triggered when response_text was empty, which
        // caused silent failures when the CLI produced partial output before crashing.
        if let Some(status) = status {
            if !status.success() {
                let error_msg = if !error_output.is_empty() {
                    error_output.trim().to_string()
                } else {
                    format!("Claude exited with status: {}", status)
                };

                log::error!("Claude process failed: {}", error_msg);

                self.emit_turn_event(
                    turn_id,
                    EngineEvent::TurnError {
                        workspace_id: self.workspace_id.clone(),
                        error: error_msg.clone(),
                        code: None,
                    },
                );

                return Err(error_msg);
            }
        } else {
            // Process handle was taken by interrupt() or missing.
            // Check the interrupted flag to distinguish user-initiated interrupts
            // from unexpected process disappearance.
            let was_interrupted = self.interrupted.swap(false, Ordering::SeqCst);
            if was_interrupted {
                log::info!("Turn {} was interrupted by user", turn_id);
                self.emit_turn_event(
                    turn_id,
                    EngineEvent::TurnError {
                        workspace_id: self.workspace_id.clone(),
                        error: "Session stopped.".to_string(),
                        code: None,
                    },
                );
                return Err("Session stopped.".to_string());
            }
            // Not a user interrupt — treat as unexpected termination
            if response_text.is_empty() {
                let error_msg = "Claude process terminated unexpectedly".to_string();
                log::error!("{}", error_msg);
                self.emit_turn_event(
                    turn_id,
                    EngineEvent::TurnError {
                        workspace_id: self.workspace_id.clone(),
                        error: error_msg.clone(),
                        code: None,
                    },
                );
                return Err(error_msg);
            }
        }

        // Claude may emit an in-stream error while still exiting with code 0.
        // In that case we must not mark the turn as completed successfully.
        if let Some(stream_error) = stream_runtime_error {
            let error_msg = if !error_output.trim().is_empty() {
                let stderr_text = error_output.trim();
                format!("{}\n{}", stream_error, stderr_text)
            } else {
                stream_error
            };
            log::error!("Claude stream reported runtime error: {}", error_msg);
            if !stream_error_event_emitted {
                self.emit_turn_event(
                    turn_id,
                    EngineEvent::TurnError {
                        workspace_id: self.workspace_id.clone(),
                        error: error_msg.clone(),
                        code: None,
                    },
                );
            }
            return Err(error_msg);
        }

        // Emit turn completed
        self.emit_turn_event(
            turn_id,
            EngineEvent::TurnCompleted {
                workspace_id: self.workspace_id.clone(),
                result: Some(serde_json::json!({
                    "text": response_text,
                })),
            },
        );

        Ok(response_text)
    }

    /// Interrupt the current operation
    pub async fn interrupt(&self) -> Result<(), String> {
        // Set interrupted flag BEFORE killing so send_message() knows this was intentional
        self.interrupted.store(true, Ordering::SeqCst);
        let mut active = self.active_processes.lock().await;
        for child in active.values_mut() {
            child
                .kill()
                .await
                .map_err(|e| format!("Failed to kill process: {}", e))?;
        }
        active.clear();
        // Clean up tool tracking state that would otherwise leak from interrupted turns.
        // Use unwrap_or_else to still clear even if the mutex was poisoned by a panic.
        self.tool_name_by_id
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
        self.tool_input_by_id
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
        self.tool_id_by_block_index
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
        self.pending_tools
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
        self.last_emitted_text
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
        Ok(())
    }

    /// Convert Claude event to unified format
    /// Handles Claude CLI 2.0.52+ event format: system, assistant, result, error
    fn convert_event(&self, turn_id: &str, event: &Value) -> Option<EngineEvent> {
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
                            let delta = self.compute_text_delta(&cumulative_text);
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
                                                &tool_id, input_val,
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
                    let delta = self.compute_text_delta(&cumulative_text);
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

                            let is_error = block
                                .get("is_error")
                                .or_else(|| block.get("isError"))
                                .or_else(|| event.get("is_error"))
                                .or_else(|| event.get("isError"))
                                .and_then(|v| v.as_bool())
                                .unwrap_or(false);
                            let output = extract_tool_result_output(block, event);
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
                    .and_then(|m| m.as_str())
                    .or_else(|| event.get("message").and_then(|m| m.as_str()))
                    .unwrap_or("Unknown error");
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
                        return self.convert_ask_user_question_to_request(&tool_id, input_val);
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

    /// Try to extract context window usage from any event
    /// Claude CLI may provide usage data in multiple locations:
    /// 1. context_window.current_usage (statusline/hooks - most accurate)
    /// 2. message.usage (assistant events)
    /// 3. usage (top-level usage field)
    fn try_extract_context_window_usage(&self, turn_id: &str, event: &Value) {
        // Try to find usage data from multiple sources
        let (usage, model_context_window) = self.find_usage_data(event);

        if let Some(usage) = usage {
            // Extract token counts
            let input_tokens = usage
                .get("input_tokens")
                .or_else(|| usage.get("inputTokens"))
                .and_then(|v| v.as_i64());

            let output_tokens = usage
                .get("output_tokens")
                .or_else(|| usage.get("outputTokens"))
                .and_then(|v| v.as_i64());

            // Claude provides separate cache_creation and cache_read tokens
            // Sum them for the total cached tokens (both occupy context window)
            let cache_creation = usage
                .get("cache_creation_input_tokens")
                .or_else(|| usage.get("cacheCreationInputTokens"))
                .or_else(|| usage.get("cache_creation_tokens"))
                .and_then(|v| v.as_i64())
                .unwrap_or(0);

            let cache_read = usage
                .get("cache_read_input_tokens")
                .or_else(|| usage.get("cacheReadInputTokens"))
                .or_else(|| usage.get("cache_read_tokens"))
                .and_then(|v| v.as_i64())
                .unwrap_or(0);

            let cached_tokens = if cache_creation > 0 || cache_read > 0 {
                Some(cache_creation + cache_read)
            } else {
                None
            };

            // Only emit if we have at least input_tokens
            if input_tokens.is_some() {
                log::debug!(
                    "[claude] Emitting UsageUpdate: input={:?}, output={:?}, cached={:?}, window={:?}",
                    input_tokens, output_tokens, cached_tokens, model_context_window
                );
                self.emit_turn_event(
                    turn_id,
                    EngineEvent::UsageUpdate {
                        workspace_id: self.workspace_id.clone(),
                        input_tokens,
                        output_tokens,
                        cached_tokens,
                        model_context_window,
                    },
                );
            }
        }
    }

    /// Find usage data from various locations in the event
    /// Returns (usage_data, model_context_window)
    fn find_usage_data<'a>(&self, event: &'a Value) -> (Option<&'a Value>, Option<i64>) {
        // 1. First priority: context_window.current_usage (most accurate snapshot)
        if let Some(context_window) = event.get("context_window") {
            log::debug!(
                "[claude] Found context_window field: {}",
                serde_json::to_string_pretty(context_window)
                    .unwrap_or_else(|_| context_window.to_string())
            );

            let model_context_window = context_window
                .get("context_window_size")
                .or_else(|| context_window.get("contextWindowSize"))
                .and_then(|v| v.as_i64());

            if let Some(current_usage) = context_window
                .get("current_usage")
                .or_else(|| context_window.get("currentUsage"))
            {
                return (Some(current_usage), model_context_window);
            }
        }

        // 2. Second priority: message.usage (assistant events)
        if let Some(message) = event.get("message") {
            if let Some(usage) = message.get("usage") {
                log::debug!(
                    "[claude] Found message.usage field: {}",
                    serde_json::to_string_pretty(usage).unwrap_or_else(|_| usage.to_string())
                );
                return (Some(usage), None);
            }
        }

        // 3. Third priority: top-level usage field
        if let Some(usage) = event.get("usage") {
            log::debug!(
                "[claude] Found top-level usage field: {}",
                serde_json::to_string_pretty(usage).unwrap_or_else(|_| usage.to_string())
            );
            return (Some(usage), None);
        }

        log::debug!(
            "[claude] No usage data found in event type: {:?}",
            event.get("type").and_then(|v| v.as_str())
        );
        (None, None)
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
                let result = self.build_tool_completed(&tool_id, output, is_error);
                self.clear_tool_block_index(turn_id, index);
                result
            }
            _ => None,
        }
    }

    fn resolve_tool_use_id(&self, block: &Value, index: Option<i64>) -> Option<String> {
        if let Some(id) = extract_string_field(
            block,
            &[
                "id",
                "tool_use_id",
                "toolUseId",
                "tool_useId",
                "toolId",
                "tool_id",
            ],
        ) {
            return Some(id);
        }
        index.map(|value| format!("tool-block-{}", value))
    }

    fn resolve_tool_result_id(
        &self,
        turn_id: &str,
        block: &Value,
        index: Option<i64>,
    ) -> Option<String> {
        if let Some(id) = extract_string_field(
            block,
            &["tool_use_id", "toolUseId", "tool_useId", "toolUseID"],
        ) {
            return Some(id);
        }
        if let Some(mapped) = self.tool_id_for_block_index(turn_id, index) {
            return Some(mapped);
        }
        if let Some(id) = extract_string_field(block, &["tool_id", "toolId", "id"]) {
            return Some(id);
        }
        self.match_pending_tool_result(turn_id, block)
            .or_else(|| self.latest_pending_tool_id(turn_id))
    }

    fn cache_tool_name(&self, tool_id: &str, tool_name: &str) {
        if tool_id.is_empty() || tool_name.is_empty() {
            return;
        }
        if let Ok(mut map) = self.tool_name_by_id.lock() {
            map.insert(tool_id.to_string(), tool_name.to_string());
        }
    }

    fn peek_tool_name(&self, tool_id: &str) -> Option<String> {
        if tool_id.is_empty() {
            return None;
        }
        self.tool_name_by_id
            .lock()
            .ok()
            .and_then(|map| map.get(tool_id).cloned())
    }

    fn take_tool_name(&self, tool_id: &str) -> Option<String> {
        if tool_id.is_empty() {
            return None;
        }
        self.tool_name_by_id
            .lock()
            .ok()
            .and_then(|mut map| map.remove(tool_id))
    }

    fn cache_tool_block_index(&self, turn_id: &str, index: i64, tool_id: &str) {
        if tool_id.is_empty() {
            return;
        }
        if let Ok(mut map) = self.tool_id_by_block_index.lock() {
            map.insert((turn_id.to_string(), index), tool_id.to_string());
        }
    }

    fn tool_id_for_block_index(&self, turn_id: &str, index: Option<i64>) -> Option<String> {
        let index = index?;
        self.tool_id_by_block_index
            .lock()
            .ok()
            .and_then(|map| map.get(&(turn_id.to_string(), index)).cloned())
    }

    fn clear_tool_block_index(&self, turn_id: &str, index: Option<i64>) {
        if let Some(index) = index {
            if let Ok(mut map) = self.tool_id_by_block_index.lock() {
                map.remove(&(turn_id.to_string(), index));
            }
        }
    }

    fn register_pending_tool(
        &self,
        turn_id: &str,
        tool_id: &str,
        tool_name: &str,
        input: Option<&Value>,
    ) {
        if tool_id.is_empty() || tool_name.is_empty() {
            return;
        }
        let input_signature = input.and_then(tool_input_signature);
        if let Ok(mut pending) = self.pending_tools.lock() {
            pending.retain(|entry| entry.tool_id != tool_id);
            pending.push(PendingClaudeTool {
                turn_id: turn_id.to_string(),
                tool_id: tool_id.to_string(),
                tool_name: tool_name.to_string(),
                input_signature,
            });
        }
    }

    fn clear_pending_tool(&self, tool_id: &str) {
        if tool_id.is_empty() {
            return;
        }
        if let Ok(mut pending) = self.pending_tools.lock() {
            pending.retain(|entry| entry.tool_id != tool_id);
        }
    }

    fn match_pending_tool_result(&self, turn_id: &str, block: &Value) -> Option<String> {
        let tool_name = extract_claude_tool_name(block)?;
        let input_signature =
            extract_claude_tool_input(block).and_then(|value| tool_input_signature(&value));
        let pending = self.pending_tools.lock().ok()?;

        if let Some(expected_input) = input_signature.as_deref() {
            if let Some(entry) = pending.iter().rev().find(|entry| {
                entry.turn_id == turn_id
                    && entry.tool_name == tool_name
                    && entry.input_signature.as_deref() == Some(expected_input)
            }) {
                return Some(entry.tool_id.clone());
            }
        }

        pending
            .iter()
            .rev()
            .find(|entry| entry.turn_id == turn_id && entry.tool_name == tool_name)
            .map(|entry| entry.tool_id.clone())
    }

    fn latest_pending_tool_id(&self, turn_id: &str) -> Option<String> {
        let pending = self.pending_tools.lock().ok()?;
        pending
            .iter()
            .rev()
            .find(|entry| entry.turn_id == turn_id)
            .map(|entry| entry.tool_id.clone())
    }

    /// Compute the true delta from a cumulative assistant text.
    /// If the cumulative text starts with the previously emitted text,
    /// return only the new portion. Otherwise return the full text
    /// (this handles edge cases like context compaction).
    fn compute_text_delta(&self, cumulative: &str) -> String {
        if let Ok(mut last) = self.last_emitted_text.lock() {
            if cumulative.starts_with(last.as_str()) {
                let delta = cumulative[last.len()..].to_string();
                *last = cumulative.to_string();
                return delta;
            }
            // Cumulative text doesn't extend the previous — emit full text
            *last = cumulative.to_string();
        }
        cumulative.to_string()
    }

    fn append_tool_input(&self, tool_id: &str, partial: &str) -> Option<Value> {
        if tool_id.is_empty() || partial.is_empty() {
            return None;
        }
        if let Ok(mut map) = self.tool_input_by_id.lock() {
            let entry = map.entry(tool_id.to_string()).or_default();
            entry.push_str(partial);
            if let Ok(value) = serde_json::from_str::<Value>(entry) {
                return Some(value);
            }
        }
        None
    }

    fn cache_tool_input_value(&self, tool_id: &str, input: &Value) {
        if tool_id.is_empty() {
            return;
        }
        if let Ok(mut map) = self.tool_input_value_by_id.lock() {
            map.insert(tool_id.to_string(), input.clone());
        }
    }

    fn take_tool_input_value(&self, tool_id: &str) -> Option<Value> {
        if tool_id.is_empty() {
            return None;
        }
        self.tool_input_value_by_id
            .lock()
            .ok()
            .and_then(|mut map| map.remove(tool_id))
    }

    fn clear_tool_input(&self, tool_id: &str) {
        if tool_id.is_empty() {
            return;
        }
        if let Ok(mut map) = self.tool_input_by_id.lock() {
            map.remove(tool_id);
        }
        if let Ok(mut map) = self.tool_input_value_by_id.lock() {
            map.remove(tool_id);
        }
    }

    /// Convert an AskUserQuestion tool_use input into a RequestUserInput engine event.
    /// The input from AskUserQuestion contains a `questions` array with `question`, `header`,
    /// `options` (each with `label` and `description`), and optional `multiSelect` flag.
    /// We transform this into the `item/tool/requestUserInput` format that the frontend expects.
    fn convert_ask_user_question_to_request(
        &self,
        tool_id: &str,
        input: &Value,
    ) -> Option<EngineEvent> {
        let raw_questions = input.get("questions").and_then(|q| q.as_array())?;
        let mut questions = Vec::new();
        for (idx, raw_q) in raw_questions.iter().enumerate() {
            let question_text = raw_q.get("question").and_then(|v| v.as_str()).unwrap_or("");
            let header = raw_q.get("header").and_then(|v| v.as_str()).unwrap_or("");
            // AskUserQuestion always allows a free-text "Other" option
            let is_other = true;
            let raw_options = raw_q
                .get("options")
                .and_then(|o| o.as_array())
                .cloned()
                .unwrap_or_default();
            let options: Vec<Value> = raw_options
                .into_iter()
                .filter_map(|opt| {
                    let label = opt.get("label")?.as_str()?.to_string();
                    let desc = opt
                        .get("description")
                        .and_then(|d| d.as_str())
                        .unwrap_or("")
                        .to_string();
                    if label.is_empty() {
                        return None;
                    }
                    Some(json!({ "label": label, "description": desc }))
                })
                .collect();
            questions.push(json!({
                "id": format!("q-{}", idx),
                "header": header,
                "question": question_text,
                "isOther": is_other,
                "isSecret": false,
                "options": if options.is_empty() { Value::Null } else { Value::Array(options) },
            }));
        }

        if questions.is_empty() {
            return None;
        }

        // Use a numeric request_id derived from the tool_id via DefaultHasher
        // for better distribution and lower collision probability.
        use std::hash::{Hash, Hasher};
        let request_id: i64 = {
            let mut hasher = std::collections::hash_map::DefaultHasher::new();
            tool_id.hash(&mut hasher);
            (hasher.finish() as i64).abs()
        };

        Some(EngineEvent::RequestUserInput {
            workspace_id: self.workspace_id.clone(),
            request_id: json!(request_id),
            questions: Value::Array(questions),
        })
    }

    /// Handle the AskUserQuestion flow: wait for user response, then kill the
    /// current CLI process and restart it with `--resume` carrying the user's
    /// actual answer.
    ///
    /// Returns the new stdout `Lines` reader if successfully resumed, or `None`
    /// if we should continue reading from the current process.
    async fn handle_ask_user_question_resume(
        &self,
        turn_id: &str,
        params: &SendMessageParams,
        new_session_id: &Option<String>,
    ) -> Option<tokio::io::Lines<BufReader<tokio::process::ChildStdout>>> {
        log::info!("AskUserQuestion detected, waiting for user (up to 5 min)…");
        let user_answered = tokio::select! {
            _ = self.user_input_notify.notified() => true,
            _ = tokio::time::sleep(
                std::time::Duration::from_secs(300)
            ) => false,
        };

        // Grab the formatted answer (if any)
        let answer_text = self
            .user_input_answer
            .lock()
            .ok()
            .and_then(|mut slot| slot.take());

        if !user_answered {
            log::info!("AskUserQuestion timed out (5 min), resuming original");
            return None;
        }

        let answer = match answer_text {
            Some(a) => a,
            None => return None,
        };

        // We need a session_id for --resume
        let sid = match new_session_id.clone() {
            Some(s) => s,
            None => {
                log::warn!(
                    "No session_id available for --resume, \
                     continuing with original output"
                );
                return None;
            }
        };

        log::info!(
            "Killing current CLI and restarting with --resume \
             to deliver user's answer"
        );

        // Kill the current process
        {
            let mut active = self.active_processes.lock().await;
            if let Some(mut child) = active.remove(turn_id) {
                let _ = child.kill().await;
                let _ = child.wait().await;
            }
        }

        // Build a resume command with the user's answer
        let mut resume_params = params.clone();
        resume_params.text = answer;
        resume_params.continue_session = true;
        resume_params.session_id = Some(sid);
        resume_params.images = None;

        let mut cmd = self.build_command(&resume_params, false);
        match cmd.spawn() {
            Ok(mut new_child) => {
                // Drop stdin immediately for the resume
                drop(new_child.stdin.take());

                let new_lines = new_child
                    .stdout
                    .take()
                    .map(|stdout| BufReader::new(stdout).lines());

                // Capture stderr of new process
                // (old stderr task will finish on its own)
                if let Some(new_stderr) = new_child.stderr.take() {
                    let _ws = self.workspace_id.clone();
                    tokio::spawn(async move {
                        let mut r = BufReader::new(new_stderr).lines();
                        while let Ok(Some(_)) = r.next_line().await {}
                    });
                }

                // Store new child for interruption
                {
                    let mut active = self.active_processes.lock().await;
                    active.insert(turn_id.to_string(), new_child);
                }

                log::info!("Resumed Claude with user's answer");
                new_lines
            }
            Err(e) => {
                log::error!("Failed to spawn resume process: {}", e);
                // Fall through — continue with original
                None
            }
        }
    }

    /// Handle a user's response to an AskUserQuestion dialog.
    ///
    /// The answer is formatted into a human-readable message and stored.
    /// The stdout reading loop will then kill the current CLI process
    /// (whose output is based on a default/empty AskUserQuestion result)
    /// and restart it with `--resume` carrying the user's actual answer.
    pub async fn respond_to_user_input(
        &self,
        request_id: Value,
        result: Value,
    ) -> Result<(), String> {
        let request_id_num = request_id.as_i64().unwrap_or(0);

        // Remove from pending tracking
        if let Ok(mut pending) = self.pending_user_inputs.lock() {
            pending.remove(&request_id_num);
        }

        // Format the answer and store it for the stdout loop to pick up
        let answer_text = format_ask_user_answer(&result);
        log::info!(
            "Claude engine: AskUserQuestion response (request_id={}): {}",
            request_id_num,
            answer_text
        );
        if let Ok(mut slot) = self.user_input_answer.lock() {
            *slot = Some(answer_text);
        }

        // Signal the stdout reading loop to resume — it will kill the
        // current process and restart with --resume + the answer.
        self.user_input_notify.notify_one();

        Ok(())
    }

    fn build_tool_completed(
        &self,
        tool_id: &str,
        output: Option<String>,
        is_error: bool,
    ) -> Option<EngineEvent> {
        if tool_id.is_empty() {
            return None;
        }
        let tool_name = self.take_tool_name(tool_id);
        let cached_input = self.take_tool_input_value(tool_id);
        self.clear_pending_tool(tool_id);
        self.clear_tool_input(tool_id);
        let error = if is_error {
            output.clone().filter(|text| !text.trim().is_empty())
        } else {
            None
        };
        let output = if is_error {
            None
        } else {
            output.map(|text| {
                if let Some(input) = cached_input.clone() {
                    json!({
                        "_input": input,
                        "_output": text,
                    })
                } else {
                    Value::String(text)
                }
            })
        };
        Some(EngineEvent::ToolCompleted {
            workspace_id: self.workspace_id.clone(),
            tool_id: tool_id.to_string(),
            tool_name,
            output,
            error,
        })
    }

    fn build_tool_output_delta(&self, tool_id: &str, delta: &str) -> Option<EngineEvent> {
        let trimmed = delta.trim_end();
        if tool_id.is_empty() || trimmed.is_empty() {
            return None;
        }
        Some(EngineEvent::ToolOutputDelta {
            workspace_id: self.workspace_id.clone(),
            tool_id: tool_id.to_string(),
            tool_name: self.peek_tool_name(tool_id),
            delta: trimmed.to_string(),
        })
    }
}

fn concat_text_blocks(blocks: &[Value]) -> Option<String> {
    let mut combined = String::new();
    for block in blocks {
        let kind = block.get("type").and_then(|t| t.as_str());
        if kind == Some("text") {
            if let Some(text) = block.get("text").and_then(|t| t.as_str()) {
                combined = merge_text_chunks(&combined, text);
            }
        }
    }

    if combined.trim().is_empty() {
        return None;
    }

    Some(combined)
}

fn extract_reasoning_fragment(block: &Value) -> Option<&str> {
    block
        .get("thinking")
        .and_then(|t| t.as_str())
        .or_else(|| block.get("reasoning").and_then(|t| t.as_str()))
        .or_else(|| block.get("text").and_then(|t| t.as_str()))
}

fn concat_reasoning_blocks(blocks: &[Value]) -> Option<String> {
    let mut combined = String::new();
    for block in blocks {
        let kind = block.get("type").and_then(|t| t.as_str());
        if kind == Some("thinking") || kind == Some("reasoning") {
            if let Some(text) = extract_reasoning_fragment(block) {
                combined = merge_text_chunks(&combined, text);
            }
        }
    }

    if combined.trim().is_empty() {
        return None;
    }

    Some(combined)
}

fn merge_text_chunks(existing: &str, incoming: &str) -> String {
    if incoming.is_empty() {
        return existing.to_string();
    }
    if existing.is_empty() {
        return incoming.to_string();
    }
    if incoming == existing || existing.contains(incoming) {
        return existing.to_string();
    }
    if incoming.starts_with(existing) || incoming.contains(existing) {
        return incoming.to_string();
    }
    if existing.starts_with(incoming) {
        return existing.to_string();
    }

    let mut boundaries: Vec<usize> = incoming.char_indices().map(|(idx, _)| idx).collect();
    boundaries.push(incoming.len());
    for boundary in boundaries.into_iter().rev() {
        if boundary == 0 {
            continue;
        }
        let prefix = &incoming[..boundary];
        if existing.ends_with(prefix) {
            return format!("{}{}", existing, &incoming[boundary..]);
        }
    }

    format!("{}{}", existing, incoming)
}

fn parse_claude_stream_json_line(line: &str) -> Result<Value, serde_json::Error> {
    let trimmed = line.trim();
    if let Some(payload) = trimmed.strip_prefix("data:") {
        return serde_json::from_str(payload.trim());
    }
    serde_json::from_str(trimmed)
}

fn is_claude_stream_control_line(line: &str) -> bool {
    let trimmed = line.trim();
    trimmed == "[DONE]"
        || trimmed.eq_ignore_ascii_case("data: [DONE]")
        || trimmed.starts_with("event:")
}

fn extract_delta_text_from_event(event: &Value) -> Option<String> {
    let part = event.get("part");
    for value in [
        event.get("delta").and_then(|value| value.as_str()),
        event.get("text").and_then(|value| value.as_str()),
        part.and_then(|value| value.get("delta"))
            .and_then(|value| value.as_str()),
        part.and_then(|value| value.get("text"))
            .and_then(|value| value.as_str()),
        part.and_then(|value| value.get("content"))
            .and_then(|value| value.as_str()),
    ] {
        if let Some(text) = value {
            if !text.is_empty() {
                return Some(text.to_string());
            }
        }
    }
    None
}

fn extract_tool_result_text(value: &Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
        return None;
    }
    if let Some(obj) = value.as_object() {
        for key in [
            "output",
            "stdout",
            "stderr",
            "text",
            "preview",
            "message",
            "response",
            "result",
            "content",
            "tool_output",
            "file",
            "loaded",
            "todos",
        ] {
            if let Some(nested) = obj.get(key).and_then(extract_tool_result_text) {
                return Some(nested);
            }
        }
        if obj
            .get("type")
            .and_then(|t| t.as_str())
            .map(|t| t == "text")
            .unwrap_or(false)
        {
            if let Some(text) = obj.get("text").and_then(|t| t.as_str()) {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    return Some(trimmed.to_string());
                }
            }
        }
        if !obj.is_empty() {
            let rendered = serde_json::to_string_pretty(obj).ok()?;
            if !rendered.trim().is_empty() {
                return Some(rendered);
            }
        }
    }
    if let Some(arr) = value.as_array() {
        let parts: Vec<String> = arr
            .iter()
            .filter_map(extract_tool_result_text)
            .filter(|text| !text.trim().is_empty())
            .collect();
        if !parts.is_empty() {
            return Some(parts.join("\n"));
        }
    }
    None
}

fn extract_tool_result_output(block: &Value, event: &Value) -> Option<String> {
    block
        .get("content")
        .or_else(|| block.get("tool_output"))
        .or_else(|| block.get("output"))
        .or_else(|| block.get("result"))
        .and_then(extract_tool_result_text)
        .or_else(|| {
            event
                .get("toolUseResult")
                .and_then(extract_tool_result_text)
        })
        .or_else(|| {
            event
                .get("tool_use_result")
                .and_then(extract_tool_result_text)
        })
}

fn tool_input_signature(value: &Value) -> Option<String> {
    serde_json::to_string(value).ok()
}

fn extract_claude_tool_name(value: &Value) -> Option<String> {
    value
        .get("name")
        .or_else(|| value.get("tool_name"))
        .and_then(|field| field.as_str())
        .map(str::trim)
        .filter(|field| !field.is_empty())
        .map(ToString::to_string)
}

fn extract_claude_tool_input(value: &Value) -> Option<Value> {
    value
        .get("input")
        .cloned()
        .or_else(|| value.get("tool_input").cloned())
}

fn extract_string_field(value: &Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(raw) = value.get(*key).and_then(|v| v.as_str()) {
            let trimmed = raw.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

fn extract_text_from_content(value: &Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
        return None;
    }
    if let Some(obj) = value.as_object() {
        if obj
            .get("type")
            .and_then(|t| t.as_str())
            .map(|t| t == "text")
            .unwrap_or(false)
        {
            if let Some(text) = obj.get("text").and_then(|t| t.as_str()) {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    return Some(trimmed.to_string());
                }
            }
        }
    }
    if let Some(arr) = value.as_array() {
        return concat_text_blocks(arr);
    }
    None
}

fn extract_result_text(event: &Value) -> Option<String> {
    let content = event
        .get("message")
        .and_then(|m| m.get("content"))
        .or_else(|| event.get("content"))
        .or_else(|| {
            event
                .get("result")
                .and_then(|r| r.get("message"))
                .and_then(|m| m.get("content"))
        })
        .or_else(|| event.get("result").and_then(|r| r.get("content")));
    content.and_then(extract_text_from_content)
}

fn looks_like_claude_runtime_error(line: &str) -> bool {
    let text = line.trim();
    if text.is_empty() {
        return false;
    }
    let lower = text.to_ascii_lowercase();
    lower.starts_with("api error:")
        || lower.contains("unexpected end of json input")
        || lower.starts_with("error:")
}

/// Format the user's AskUserQuestion answers into a human-readable message
/// that can be sent as a follow-up via `--resume`.
fn format_ask_user_answer(result: &Value) -> String {
    let mut parts = Vec::new();

    if let Some(answers_obj) = result.get("answers").and_then(|a| a.as_object()) {
        for (_key, entry) in answers_obj {
            if let Some(arr) = entry.get("answers").and_then(|a| a.as_array()) {
                let texts: Vec<&str> = arr.iter().filter_map(|v| v.as_str()).collect();
                if !texts.is_empty() {
                    parts.push(texts.join(", "));
                }
            }
        }
    }

    if parts.is_empty() {
        "The user dismissed the question without selecting an option.".to_string()
    } else {
        format!(
            "The user answered the AskUserQuestion: {}. Please continue based on this selection.",
            parts.join("; ")
        )
    }
}

/// Build message content with images for stream-json input
fn build_message_content(params: &SendMessageParams) -> Result<Value, String> {
    let mut content = Vec::new();

    // Process images
    if let Some(ref images) = params.images {
        for image_path in images {
            let trimmed = image_path.trim();
            if trimmed.is_empty() {
                continue;
            }

            if trimmed.starts_with("data:") {
                // Base64 data URL format: data:image/png;base64,<data>
                let parts: Vec<&str> = trimmed.splitn(2, ',').collect();
                if parts.len() == 2 {
                    let media_type = parts[0]
                        .strip_prefix("data:")
                        .and_then(|s| s.strip_suffix(";base64"))
                        .unwrap_or("image/png");
                    content.push(json!({
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": parts[1]
                        }
                    }));
                }
            } else if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
                // URL image
                content.push(json!({
                    "type": "image",
                    "source": {
                        "type": "url",
                        "url": trimmed
                    }
                }));
            } else {
                // Local file path - read and convert to base64
                let path = std::path::Path::new(trimmed);
                if let Ok(data) = std::fs::read(path) {
                    let base64_data = STANDARD.encode(&data);
                    let media_type = match path.extension().and_then(|e| e.to_str()) {
                        Some("png") => "image/png",
                        Some("jpg") | Some("jpeg") => "image/jpeg",
                        Some("gif") => "image/gif",
                        Some("webp") => "image/webp",
                        _ => "image/png",
                    };
                    content.push(json!({
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": base64_data
                        }
                    }));
                }
            }
        }
    }

    // Add text content
    if !params.text.trim().is_empty() {
        content.push(json!({
            "type": "text",
            "text": params.text.trim()
        }));
    }

    // Claude CLI stream-json format requires:
    // {"type":"user","message":{"role":"user","content":[...]}}
    Ok(json!({
        "type": "user",
        "message": {
            "role": "user",
            "content": content
        }
    }))
}

/// Claude session manager for all workspaces
pub struct ClaudeSessionManager {
    sessions: Mutex<HashMap<String, Arc<ClaudeSession>>>,
    default_config: RwLock<EngineConfig>,
}

impl ClaudeSessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            default_config: RwLock::new(EngineConfig::default()),
        }
    }

    /// Set default configuration
    pub async fn set_config(&self, config: EngineConfig) {
        *self.default_config.write().await = config;
    }

    /// Get or create a session for a workspace
    pub async fn get_or_create_session(
        &self,
        workspace_id: &str,
        workspace_path: &Path,
    ) -> Arc<ClaudeSession> {
        let mut sessions = self.sessions.lock().await;

        if let Some(session) = sessions.get(workspace_id) {
            return session.clone();
        }

        let config = self.default_config.read().await.clone();
        let session = Arc::new(ClaudeSession::new(
            workspace_id.to_string(),
            workspace_path.to_path_buf(),
            Some(config),
        ));

        sessions.insert(workspace_id.to_string(), session.clone());
        session
    }

    /// Remove a session
    pub async fn remove_session(&self, workspace_id: &str) -> Option<Arc<ClaudeSession>> {
        let mut sessions = self.sessions.lock().await;
        sessions.remove(workspace_id)
    }

    /// Get a session if it exists
    pub async fn get_session(&self, workspace_id: &str) -> Option<Arc<ClaudeSession>> {
        let sessions = self.sessions.lock().await;
        sessions.get(workspace_id).cloned()
    }

    /// Interrupt all active sessions (used during app shutdown)
    pub async fn interrupt_all(&self) {
        let sessions = self.sessions.lock().await;
        for session in sessions.values() {
            let _ = session.interrupt().await;
        }
    }
}

impl Default for ClaudeSessionManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tokio::sync::broadcast::error::TryRecvError;

    #[test]
    fn session_creation() {
        let session = ClaudeSession::new(
            "test-workspace".to_string(),
            PathBuf::from("/tmp/test"),
            None,
        );

        assert_eq!(session.workspace_id, "test-workspace");
    }

    #[test]
    fn build_command_adds_external_spec_root_when_configured() {
        let session = ClaudeSession::new(
            "test-workspace".to_string(),
            PathBuf::from("/tmp/test"),
            None,
        );
        let mut params = SendMessageParams::default();
        params.text = "hello".to_string();
        params.custom_spec_root = Some(if cfg!(windows) {
            "C:\\tmp\\external-openspec".to_string()
        } else {
            "/tmp/external-openspec".to_string()
        });

        let command = session.build_command(&params, false);
        let args: Vec<String> = command
            .as_std()
            .get_args()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect();

        assert!(args.windows(2).any(|window| {
            window[0] == "--add-dir" && window[1] == params.custom_spec_root.clone().unwrap()
        }));
    }

    #[test]
    fn build_command_uses_session_id_for_new_conversation_without_continue() {
        let session = ClaudeSession::new(
            "test-workspace".to_string(),
            PathBuf::from("/tmp/test"),
            None,
        );
        let mut params = SendMessageParams::default();
        params.text = "hello".to_string();
        params.continue_session = false;
        params.session_id = Some("11111111-1111-4111-8111-111111111111".to_string());

        let command = session.build_command(&params, false);
        let args: Vec<String> = command
            .as_std()
            .get_args()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect();

        assert!(args.windows(2).any(|window| {
            window[0] == "--session-id" && window[1] == "11111111-1111-4111-8111-111111111111"
        }));
        assert!(!args
            .iter()
            .any(|arg| arg == "--continue" || arg == "--resume"));
    }

    #[test]
    fn build_command_uses_resume_when_continue_session_is_enabled() {
        let session = ClaudeSession::new(
            "test-workspace".to_string(),
            PathBuf::from("/tmp/test"),
            None,
        );
        let mut params = SendMessageParams::default();
        params.text = "hello".to_string();
        params.continue_session = true;
        params.session_id = Some("22222222-2222-4222-8222-222222222222".to_string());

        let command = session.build_command(&params, false);
        let args: Vec<String> = command
            .as_std()
            .get_args()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect();

        assert!(args.windows(2).any(|window| {
            window[0] == "--resume" && window[1] == "22222222-2222-4222-8222-222222222222"
        }));
        assert!(!args.iter().any(|arg| arg == "--session-id"));
    }

    #[tokio::test]
    async fn session_manager_get_or_create() {
        let manager = ClaudeSessionManager::new();

        let session1 = manager
            .get_or_create_session("ws-1", Path::new("/tmp/ws1"))
            .await;
        let session2 = manager
            .get_or_create_session("ws-1", Path::new("/tmp/ws1"))
            .await;

        // Should return the same session
        assert_eq!(session1.workspace_id, session2.workspace_id);
    }

    #[test]
    fn emit_error_broadcasts_turn_scoped_event() {
        let session = ClaudeSession::new(
            "test-workspace".to_string(),
            PathBuf::from("/tmp/test"),
            None,
        );
        let mut receiver = session.subscribe();

        session.emit_error("turn-a", "boom".to_string());

        let received = receiver.try_recv().expect("expected one error event");
        assert_eq!(received.turn_id, "turn-a");
        match received.event {
            EngineEvent::TurnError { error, .. } => assert_eq!(error, "boom"),
            other => panic!("unexpected event: {:?}", other),
        }
        assert!(matches!(receiver.try_recv(), Err(TryRecvError::Empty)));
    }

    #[test]
    fn extract_text_from_content_concatenates_fragmented_blocks() {
        let content = json!([
            {"type": "text", "text": "你"},
            {"type": "text", "text": "好！我"},
            {"type": "text", "text": "是"},
            {"type": "text", "text": "Antigravity"}
        ]);

        let text = extract_text_from_content(&content);
        assert_eq!(text.as_deref(), Some("你好！我是Antigravity"));
    }

    #[test]
    fn convert_event_prefers_combined_text_when_thinking_and_text_coexist() {
        let session = ClaudeSession::new(
            "test-workspace".to_string(),
            PathBuf::from("/tmp/test"),
            None,
        );
        let mut receiver = session.subscribe();

        let event = json!({
            "type": "assistant",
            "message": {
                "content": [
                    {"type": "thinking", "thinking": "先想一下"},
                    {"type": "text", "text": "你"},
                    {"type": "text", "text": "好"}
                ]
            }
        });

        let converted = session.convert_event("turn-a", &event);
        match converted {
            Some(EngineEvent::TextDelta { text, .. }) => assert_eq!(text, "你好"),
            other => panic!("expected text delta, got {:?}", other),
        }

        let reasoning_event = receiver
            .try_recv()
            .expect("expected reasoning delta to be emitted");
        assert_eq!(reasoning_event.turn_id, "turn-a");
        match reasoning_event.event {
            EngineEvent::ReasoningDelta { text, .. } => assert_eq!(text, "先想一下"),
            other => panic!("expected reasoning delta, got {:?}", other),
        }
        assert!(matches!(receiver.try_recv(), Err(TryRecvError::Empty)));
    }

    #[test]
    fn convert_event_supports_reasoning_block_alias() {
        let session = ClaudeSession::new(
            "test-workspace".to_string(),
            PathBuf::from("/tmp/test"),
            None,
        );

        let event = json!({
            "type": "assistant",
            "message": {
                "content": [
                    {"type": "reasoning", "reasoning": "先分析约束条件"}
                ]
            }
        });

        let converted = session.convert_event("turn-a", &event);
        match converted {
            Some(EngineEvent::ReasoningDelta { text, .. }) => {
                assert_eq!(text, "先分析约束条件")
            }
            other => panic!("expected reasoning delta, got {:?}", other),
        }
    }

    #[test]
    fn convert_event_supports_assistant_message_delta_aliases() {
        let session = ClaudeSession::new(
            "test-workspace".to_string(),
            PathBuf::from("/tmp/test"),
            None,
        );

        let event = json!({
            "type": "assistant_message_delta",
            "delta": "stream chunk",
        });

        let converted = session.convert_event("turn-a", &event);
        match converted {
            Some(EngineEvent::TextDelta { text, .. }) => assert_eq!(text, "stream chunk"),
            other => panic!("expected text delta, got {:?}", other),
        }
    }

    #[test]
    fn convert_event_supports_message_snapshot_aliases() {
        let session = ClaudeSession::new(
            "test-workspace".to_string(),
            PathBuf::from("/tmp/test"),
            None,
        );

        let first = json!({
            "type": "assistant_message",
            "message": {
                "content": [
                    {"type": "text", "text": "你好"},
                ]
            }
        });
        let second = json!({
            "type": "assistant_message",
            "message": {
                "content": [
                    {"type": "text", "text": "你好，世界"},
                ]
            }
        });

        match session.convert_event("turn-a", &first) {
            Some(EngineEvent::TextDelta { text, .. }) => assert_eq!(text, "你好"),
            other => panic!("expected first text delta, got {:?}", other),
        }
        match session.convert_event("turn-a", &second) {
            Some(EngineEvent::TextDelta { text, .. }) => assert_eq!(text, "，世界"),
            other => panic!("expected second text delta, got {:?}", other),
        }
    }

    #[test]
    fn parse_claude_stream_json_line_supports_data_prefix() {
        let parsed = parse_claude_stream_json_line(
            "data: {\"type\":\"assistant_message_delta\",\"delta\":\"ok\"}",
        )
        .expect("expected parser to accept data: prefix");
        assert_eq!(
            parsed.get("type").and_then(|value| value.as_str()),
            Some("assistant_message_delta"),
        );
    }

    #[test]
    fn convert_stream_event_supports_reasoning_delta_alias() {
        let session = ClaudeSession::new(
            "test-workspace".to_string(),
            PathBuf::from("/tmp/test"),
            None,
        );

        let event = json!({
            "type": "stream_event",
            "event": {
                "type": "content_block_delta",
                "delta": {
                    "type": "reasoning_delta",
                    "reasoning": "先看日志，再定位根因"
                }
            }
        });

        let converted = session.convert_event("turn-a", &event);
        match converted {
            Some(EngineEvent::ReasoningDelta { text, .. }) => {
                assert_eq!(text, "先看日志，再定位根因")
            }
            other => panic!("expected reasoning delta, got {:?}", other),
        }
    }

    #[test]
    fn convert_stream_event_maps_tool_result_text_delta_to_tool_output_delta() {
        let session = ClaudeSession::new(
            "test-workspace".to_string(),
            PathBuf::from("/tmp/test"),
            None,
        );
        session.cache_tool_name("tool-1", "Bash");
        session.cache_tool_block_index("turn-a", 7, "tool-1");

        let event = json!({
            "type": "stream_event",
            "event": {
                "type": "content_block_delta",
                "index": 7,
                "delta": {
                    "type": "text_delta",
                    "text": "total 12\n"
                }
            }
        });

        let converted = session.convert_event("turn-a", &event);
        match converted {
            Some(EngineEvent::ToolOutputDelta {
                tool_id,
                tool_name,
                delta,
                ..
            }) => {
                assert_eq!(tool_id, "tool-1");
                assert_eq!(tool_name.as_deref(), Some("Bash"));
                assert_eq!(delta, "total 12");
            }
            other => panic!("expected tool output delta, got {:?}", other),
        }
    }

    #[test]
    fn convert_stream_event_caches_tool_result_block_index_before_text_deltas() {
        let session = ClaudeSession::new(
            "test-workspace".to_string(),
            PathBuf::from("/tmp/test"),
            None,
        );
        session.cache_tool_name("tool-42", "Bash");
        session.register_pending_tool("turn-a", "tool-42", "Bash", None);

        let start_event = json!({
            "type": "stream_event",
            "event": {
                "type": "content_block_start",
                "index": 11,
                "content_block": {
                    "type": "tool_result",
                    "tool_use_id": "tool-42"
                }
            }
        });
        assert!(session.convert_event("turn-a", &start_event).is_none());

        let delta_event = json!({
            "type": "stream_event",
            "event": {
                "type": "content_block_delta",
                "index": 11,
                "delta": {
                    "type": "text_delta",
                    "text": "README.md\n"
                }
            }
        });

        let converted = session.convert_event("turn-a", &delta_event);
        match converted {
            Some(EngineEvent::ToolOutputDelta { tool_id, delta, .. }) => {
                assert_eq!(tool_id, "tool-42");
                assert_eq!(delta, "README.md");
            }
            other => panic!("expected tool output delta, got {:?}", other),
        }
    }

    #[test]
    fn convert_stream_event_emits_tool_completed_for_tool_result_delta() {
        let session = ClaudeSession::new(
            "test-workspace".to_string(),
            PathBuf::from("/tmp/test"),
            None,
        );
        session.cache_tool_name("tool-55", "Edit");
        session.register_pending_tool("turn-a", "tool-55", "Edit", None);

        let event = json!({
            "type": "stream_event",
            "event": {
                "type": "content_block_delta",
                "index": 5,
                "delta": {
                    "type": "tool_result",
                    "tool_use_id": "tool-55",
                    "content": [{"type": "text", "text": "updated file\n"}]
                }
            }
        });

        let converted = session.convert_event("turn-a", &event);
        match converted {
            Some(EngineEvent::ToolCompleted {
                tool_id,
                tool_name,
                output,
                error,
                ..
            }) => {
                assert_eq!(tool_id, "tool-55");
                assert_eq!(tool_name.as_deref(), Some("Edit"));
                assert_eq!(output, Some(Value::String("updated file".to_string())));
                assert_eq!(error, None);
            }
            other => panic!("expected tool completed, got {:?}", other),
        }
    }

    #[test]
    fn build_tool_completed_embeds_cached_input_with_output() {
        let session = ClaudeSession::new(
            "test-workspace".to_string(),
            PathBuf::from("/tmp/test"),
            None,
        );
        session.cache_tool_name("tool-input", "Bash");
        session.cache_tool_input_value(
            "tool-input",
            &json!({
                "command": "pwd",
                "cwd": "/repo",
            }),
        );

        let converted =
            session.build_tool_completed("tool-input", Some("/repo".to_string()), false);
        match converted {
            Some(EngineEvent::ToolCompleted {
                output: Some(Value::Object(payload)),
                ..
            }) => {
                assert_eq!(
                    payload.get("_output"),
                    Some(&Value::String("/repo".to_string()))
                );
                assert_eq!(
                    payload.get("_input").and_then(|value| value.get("command")),
                    Some(&Value::String("pwd".to_string()))
                );
            }
            other => panic!("expected embedded output payload, got {:?}", other),
        }
    }

    #[test]
    fn extract_tool_result_text_reads_preview_and_loaded_entries() {
        let preview = json!({
            "preview": "settings.local.json"
        });
        assert_eq!(
            extract_tool_result_text(&preview),
            Some("settings.local.json".to_string())
        );

        let loaded = json!({
            "loaded": [
                "/repo/README.md",
                "/repo/package.json"
            ]
        });
        assert_eq!(
            extract_tool_result_text(&loaded),
            Some("/repo/README.md\n/repo/package.json".to_string())
        );
    }

    #[test]
    fn convert_stream_event_falls_back_to_latest_pending_tool_when_result_lacks_identifiers() {
        let session = ClaudeSession::new(
            "test-workspace".to_string(),
            PathBuf::from("/tmp/test"),
            None,
        );
        session.cache_tool_name("tool-latest", "Bash");
        session.register_pending_tool("turn-a", "tool-latest", "Bash", None);

        let start_event = json!({
            "type": "stream_event",
            "event": {
                "type": "content_block_start",
                "index": 12,
                "content_block": {
                    "type": "tool_result"
                }
            }
        });
        assert!(session.convert_event("turn-a", &start_event).is_none());

        let delta_event = json!({
            "type": "stream_event",
            "event": {
                "type": "content_block_delta",
                "index": 12,
                "delta": {
                    "type": "text_delta",
                    "text": "README.md\n"
                }
            }
        });

        let converted = session.convert_event("turn-a", &delta_event);
        match converted {
            Some(EngineEvent::ToolOutputDelta { tool_id, delta, .. }) => {
                assert_eq!(tool_id, "tool-latest");
                assert_eq!(delta, "README.md");
            }
            other => panic!("expected tool output delta, got {:?}", other),
        }
    }

    #[test]
    fn convert_event_reads_transcript_style_tool_output_payload() {
        let session = ClaudeSession::new(
            "test-workspace".to_string(),
            PathBuf::from("/tmp/test"),
            None,
        );
        session.cache_tool_name("tool-99", "bash");
        session.register_pending_tool("turn-a", "tool-99", "bash", None);

        let event = json!({
            "type": "tool_result",
            "tool_use_id": "tool-99",
            "tool_output": {
                "output": "commit-a\ncommit-b\n",
                "exit": 0
            }
        });

        let converted = session.convert_event("turn-a", &event);
        match converted {
            Some(EngineEvent::ToolCompleted {
                tool_id,
                tool_name,
                output,
                error,
                ..
            }) => {
                assert_eq!(tool_id, "tool-99");
                assert_eq!(tool_name.as_deref(), Some("bash"));
                assert_eq!(
                    output,
                    Some(Value::String("commit-a\ncommit-b".to_string()))
                );
                assert_eq!(error, None);
            }
            other => panic!("expected tool completed, got {:?}", other),
        }
    }

    #[test]
    fn convert_event_matches_transcript_style_tool_result_without_tool_use_id() {
        let session = ClaudeSession::new(
            "test-workspace".to_string(),
            PathBuf::from("/tmp/test"),
            None,
        );
        let tool_input = json!({
            "command": "git log --oneline -10",
            "description": "查看最近提交"
        });
        session.cache_tool_name("tool-bash-1", "bash");
        session.register_pending_tool("turn-a", "tool-bash-1", "bash", Some(&tool_input));

        let event = json!({
            "type": "tool_result",
            "tool_name": "bash",
            "tool_input": {
                "command": "git log --oneline -10",
                "description": "查看最近提交"
            },
            "tool_output": {
                "output": "commit-a\ncommit-b\n",
                "exit": 0
            }
        });

        let converted = session.convert_event("turn-a", &event);
        match converted {
            Some(EngineEvent::ToolCompleted {
                tool_id,
                tool_name,
                output,
                error,
                ..
            }) => {
                assert_eq!(tool_id, "tool-bash-1");
                assert_eq!(tool_name.as_deref(), Some("bash"));
                assert_eq!(
                    output,
                    Some(Value::String("commit-a\ncommit-b".to_string()))
                );
                assert_eq!(error, None);
            }
            other => panic!("expected tool completed, got {:?}", other),
        }
    }

    #[test]
    fn convert_event_reads_project_jsonl_user_tool_result_content() {
        let session = ClaudeSession::new(
            "test-workspace".to_string(),
            PathBuf::from("/tmp/test"),
            None,
        );
        session.cache_tool_name("tool-user-1", "Bash");
        session.register_pending_tool("turn-a", "tool-user-1", "Bash", None);

        let event = json!({
            "type": "user",
            "message": {
                "role": "user",
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": "tool-user-1",
                    "content": "/repo\n",
                    "is_error": false
                }]
            }
        });

        let converted = session.convert_event("turn-a", &event);
        match converted {
            Some(EngineEvent::ToolCompleted {
                tool_id,
                tool_name,
                output,
                error,
                ..
            }) => {
                assert_eq!(tool_id, "tool-user-1");
                assert_eq!(tool_name.as_deref(), Some("Bash"));
                assert_eq!(output, Some(Value::String("/repo".to_string())));
                assert_eq!(error, None);
            }
            other => panic!("expected tool completed, got {:?}", other),
        }
    }

    #[test]
    fn convert_event_preserves_read_input_for_project_jsonl_user_tool_result() {
        let session = ClaudeSession::new(
            "test-workspace".to_string(),
            PathBuf::from("/tmp/test"),
            None,
        );

        let start_event = json!({
            "type": "assistant",
            "message": {
                "content": [{
                    "type": "tool_use",
                    "id": "read-tool-1",
                    "name": "Read",
                    "input": {
                        "file_path": "/repo/README.md"
                    }
                }]
            }
        });

        match session.convert_event("turn-a", &start_event) {
            Some(EngineEvent::ToolStarted { tool_id, input, .. }) => {
                assert_eq!(tool_id, "read-tool-1");
                assert_eq!(
                    input.as_ref().and_then(|value| value.get("file_path")),
                    Some(&Value::String("/repo/README.md".to_string()))
                );
            }
            other => panic!("expected tool started, got {:?}", other),
        }

        let completed_event = json!({
            "type": "user",
            "message": {
                "role": "user",
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": "read-tool-1",
                    "content": "     1→hello world\n"
                }]
            }
        });

        match session.convert_event("turn-a", &completed_event) {
            Some(EngineEvent::ToolCompleted {
                tool_id,
                output: Some(Value::Object(payload)),
                ..
            }) => {
                assert_eq!(tool_id, "read-tool-1");
                assert_eq!(
                    payload
                        .get("_input")
                        .and_then(|value| value.get("file_path")),
                    Some(&Value::String("/repo/README.md".to_string()))
                );
                assert_eq!(
                    payload.get("_output"),
                    Some(&Value::String("1→hello world".to_string()))
                );
            }
            other => panic!("expected embedded read payload, got {:?}", other),
        }
    }

    #[test]
    fn convert_event_reads_project_jsonl_user_tool_result_stdout_fallback() {
        let session = ClaudeSession::new(
            "test-workspace".to_string(),
            PathBuf::from("/tmp/test"),
            None,
        );
        session.cache_tool_name("tool-user-stdout", "Bash");
        session.register_pending_tool("turn-a", "tool-user-stdout", "Bash", None);

        let event = json!({
            "type": "user",
            "message": {
                "role": "user",
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": "tool-user-stdout",
                    "content": "",
                    "is_error": false
                }]
            },
            "toolUseResult": {
                "stdout": "total 32\n-rw-r--r-- README.md\n",
                "stderr": ""
            }
        });

        let converted = session.convert_event("turn-a", &event);
        match converted {
            Some(EngineEvent::ToolCompleted {
                tool_id,
                tool_name,
                output,
                error,
                ..
            }) => {
                assert_eq!(tool_id, "tool-user-stdout");
                assert_eq!(tool_name.as_deref(), Some("Bash"));
                assert_eq!(
                    output,
                    Some(Value::String("total 32\n-rw-r--r-- README.md".to_string()))
                );
                assert_eq!(error, None);
            }
            other => panic!("expected tool completed, got {:?}", other),
        }
    }

    #[test]
    fn convert_event_matches_tool_result_without_id_or_name_to_latest_pending_tool() {
        let session = ClaudeSession::new(
            "test-workspace".to_string(),
            PathBuf::from("/tmp/test"),
            None,
        );
        session.cache_tool_name("tool-fallback", "bash");
        session.register_pending_tool("turn-a", "tool-fallback", "bash", None);

        let event = json!({
            "type": "tool_result",
            "tool_output": {
                "output": "ok\n",
                "exit": 0
            }
        });

        let converted = session.convert_event("turn-a", &event);
        match converted {
            Some(EngineEvent::ToolCompleted {
                tool_id,
                tool_name,
                output,
                error,
                ..
            }) => {
                assert_eq!(tool_id, "tool-fallback");
                assert_eq!(tool_name.as_deref(), Some("bash"));
                assert_eq!(output, Some(Value::String("ok".to_string())));
                assert_eq!(error, None);
            }
            other => panic!("expected tool completed, got {:?}", other),
        }
    }

    #[test]
    fn convert_event_matches_most_recent_same_name_tool_when_input_missing() {
        let session = ClaudeSession::new(
            "test-workspace".to_string(),
            PathBuf::from("/tmp/test"),
            None,
        );
        session.cache_tool_name("tool-bash-older", "bash");
        session.register_pending_tool(
            "turn-a",
            "tool-bash-older",
            "bash",
            Some(&json!({ "command": "pwd" })),
        );
        session.cache_tool_name("tool-bash-newer", "bash");
        session.register_pending_tool(
            "turn-a",
            "tool-bash-newer",
            "bash",
            Some(&json!({ "command": "find . -name \"*.py\"" })),
        );

        let event = json!({
            "type": "tool_result",
            "tool_name": "bash",
            "tool_output": {
                "output": "42\n",
                "exit": 0
            }
        });

        let converted = session.convert_event("turn-a", &event);
        match converted {
            Some(EngineEvent::ToolCompleted {
                tool_id, output, ..
            }) => {
                assert_eq!(tool_id, "tool-bash-newer");
                assert_eq!(output, Some(Value::String("42".to_string())));
            }
            other => panic!("expected tool completed, got {:?}", other),
        }
    }

    #[test]
    fn convert_event_avoids_duplicate_when_assistant_blocks_repeat_whole_message() {
        let session = ClaudeSession::new(
            "test-workspace".to_string(),
            PathBuf::from("/tmp/test"),
            None,
        );

        let first = json!({
            "type": "assistant",
            "message": {
                "content": [
                    {"type": "text", "text": "你好！很高兴见到你。\n\n有什么我可以帮你的吗"}
                ]
            }
        });
        let second = json!({
            "type": "assistant",
            "message": {
                "content": [
                    {"type": "text", "text": "有什么我可以帮你的吗？"},
                    {"type": "text", "text": "你好！很高兴见到你。\n\n有什么我可以帮你的吗？"}
                ]
            }
        });

        match session.convert_event("turn-a", &first) {
            Some(EngineEvent::TextDelta { text, .. }) => {
                assert_eq!(text, "你好！很高兴见到你。\n\n有什么我可以帮你的吗")
            }
            other => panic!("expected first text delta, got {:?}", other),
        }

        match session.convert_event("turn-a", &second) {
            Some(EngineEvent::TextDelta { text, .. }) => assert_eq!(text, "？"),
            other => panic!("expected punctuation-only delta, got {:?}", other),
        }
    }

    #[test]
    fn looks_like_claude_runtime_error_detects_api_json_eof() {
        assert!(looks_like_claude_runtime_error(
            "API Error: Unexpected end of JSON input"
        ));
        assert!(looks_like_claude_runtime_error(
            "error: transport dropped unexpectedly"
        ));
    }

    #[test]
    fn looks_like_claude_runtime_error_ignores_regular_output() {
        assert!(!looks_like_claude_runtime_error("你好，我继续给你方案"));
        assert!(!looks_like_claude_runtime_error("{\"type\":\"assistant\"}"));
    }
}
