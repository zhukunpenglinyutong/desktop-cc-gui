//! Claude Code engine implementation
//!
//! Handles Claude Code CLI execution via `claude -p` (print mode) with
//! streaming JSON output.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::sync::Mutex as StdMutex;
#[cfg(unix)]
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{broadcast, Mutex, Notify, RwLock};
#[cfg(unix)]
use tokio::time::sleep;

use super::claude_message_content::{build_message_content, format_ask_user_answer};
use super::events::EngineEvent;
use super::{EngineConfig, EngineType, SendMessageParams};
#[path = "claude/approval.rs"]
mod approval;
#[path = "claude/event_conversion.rs"]
mod event_conversion;
mod lifecycle;
#[path = "claude/manager.rs"]
mod manager;
#[path = "claude_stream_helpers.rs"]
mod stream_helpers;
mod user_input;
use approval::{
    classify_claude_mode_blocked_tool, command_can_apply_as_local_file_action,
    extract_claude_command_string, looks_like_claude_permission_denial_message,
    ClaudeModeBlockedKind, SyntheticApprovalSummaryEntry,
};
#[cfg(test)]
use approval::{
    format_synthetic_approval_completion_text, format_synthetic_approval_resume_message,
    SYNTHETIC_APPROVAL_RESUME_MARKER_PREFIX,
};
#[cfg(test)]
#[path = "claude/tests_stream.rs"]
mod tests_stream;
pub use manager::ClaudeSessionManager;
#[cfg(test)]
use stream_helpers::extract_text_from_content;
#[cfg(test)]
use stream_helpers::extract_tool_result_text;
use stream_helpers::{
    extract_claude_tool_input, extract_claude_tool_name, extract_result_text, extract_string_field,
    is_claude_stream_control_line, looks_like_claude_runtime_error, parse_claude_stream_json_line,
    tool_input_signature,
};

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

#[derive(Debug, Clone, PartialEq, Eq)]
struct PendingClaudeToolSummary {
    tool_id: String,
    tool_name: String,
}

const RETRYABLE_PROMPT_TOO_LONG_PREFIX: &str = "__claude_retryable_prompt_too_long__:";
const AUTO_COMPACT_SIGNAL_SOURCE: &str = "auto_compact_retry";

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
    /// Disposal flag set when workspace/session is being torn down.
    disposed: AtomicBool,
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
    /// Last emitted text for assistant partial messages, isolated per turn
    last_emitted_text_by_turn: StdMutex<HashMap<String, String>>,
    /// Stdin handles per turn for AskUserQuestion responses
    stdin_by_turn: Mutex<HashMap<String, ChildStdin>>,
    /// Pending AskUserQuestion requests: request_id -> turn_id
    pending_user_inputs: StdMutex<HashMap<String, String>>,
    /// Pending synthetic Claude approval requests: request_id -> turn_id
    pending_approval_requests: StdMutex<HashMap<String, String>>,
    /// Synthetic approval summaries accumulated per turn for final completion reporting
    synthetic_approval_summaries_by_turn:
        StdMutex<HashMap<String, Vec<SyntheticApprovalSummaryEntry>>>,
    /// Per-turn signal to resume stdout processing after approval responses arrive
    approval_notify_by_turn: StdMutex<HashMap<String, Arc<Notify>>>,
    /// Per-turn formatted approval resolution text for kill+resume mechanism
    approval_resume_message_by_turn: StdMutex<HashMap<String, String>>,
    /// Per-turn signal to resume stdout processing after AskUserQuestion response
    user_input_notify_by_turn: StdMutex<HashMap<String, Arc<Notify>>>,
    /// Per-turn formatted AskUserQuestion answer for kill+resume mechanism
    user_input_answer_by_turn: StdMutex<HashMap<String, String>>,
}

impl ClaudeSession {
    fn configure_spawn_command(cmd: &mut Command) {
        #[cfg(unix)]
        unsafe {
            cmd.pre_exec(|| {
                if libc::setpgid(0, 0) == 0 {
                    Ok(())
                } else {
                    Err(std::io::Error::last_os_error())
                }
            });
        }
    }

    fn should_use_stream_json_input(params: &SendMessageParams) -> bool {
        let has_images = params
            .images
            .as_ref()
            .map_or(false, |imgs| imgs.iter().any(|s| !s.trim().is_empty()));
        if has_images {
            return true;
        }
        params.text.contains('\n') || params.text.contains('\r')
    }

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
            disposed: AtomicBool::new(false),
            tool_name_by_id: StdMutex::new(HashMap::new()),
            tool_input_by_id: StdMutex::new(HashMap::new()),
            tool_input_value_by_id: StdMutex::new(HashMap::new()),
            tool_id_by_block_index: StdMutex::new(HashMap::new()),
            pending_tools: StdMutex::new(Vec::new()),
            last_emitted_text_by_turn: StdMutex::new(HashMap::new()),
            stdin_by_turn: Mutex::new(HashMap::new()),
            pending_user_inputs: StdMutex::new(HashMap::new()),
            pending_approval_requests: StdMutex::new(HashMap::new()),
            synthetic_approval_summaries_by_turn: StdMutex::new(HashMap::new()),
            approval_notify_by_turn: StdMutex::new(HashMap::new()),
            approval_resume_message_by_turn: StdMutex::new(HashMap::new()),
            user_input_notify_by_turn: StdMutex::new(HashMap::new()),
            user_input_answer_by_turn: StdMutex::new(HashMap::new()),
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

    fn is_disposed(&self) -> bool {
        self.disposed.load(Ordering::SeqCst)
    }

    pub(crate) fn mark_disposed(&self) {
        self.disposed.store(true, Ordering::SeqCst);
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

    async fn fail_send_setup_and_terminate_child(
        &self,
        turn_id: &str,
        child: &mut Child,
        error_msg: String,
    ) -> Result<String, String> {
        if let Err(error) = self.terminate_child_process(turn_id, child).await {
            log::debug!(
                "[claude] failed to terminate setup-failed child process (turn={}): {}",
                turn_id,
                error
            );
        }
        self.clear_turn_ephemeral_state(turn_id);
        Err(error_msg)
    }

    /// Set session ID (after successful execution)
    pub async fn set_session_id(&self, id: Option<String>) {
        *self.session_id.write().await = id;
    }

    /// Build the Claude CLI command
    fn build_command(&self, params: &SendMessageParams, use_stream_json_input: bool) -> Command {
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

        if use_stream_json_input {
            // Use stream-json input format for image payloads and multiline text.
            // The actual content will be sent via stdin.
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
        if self.is_disposed() {
            let error_msg = "Claude session disposed; refusing to start new process".to_string();
            self.emit_turn_event(
                turn_id,
                EngineEvent::TurnError {
                    workspace_id: self.workspace_id.clone(),
                    error: error_msg.clone(),
                    code: None,
                },
            );
            self.clear_turn_ephemeral_state(turn_id);
            return Err(error_msg);
        }

        // Reset cumulative text tracker for the new turn only.
        if let Ok(mut map) = self.last_emitted_text_by_turn.lock() {
            map.remove(turn_id);
        }

        let use_stream_json_input = Self::should_use_stream_json_input(&params);

        let mut cmd = self.build_command(&params, use_stream_json_input);
        Self::configure_spawn_command(&mut cmd);

        // Spawn the process
        let mut child = match cmd.spawn() {
            Ok(child) => child,
            Err(e) => {
                let error_msg = format!("Failed to spawn claude: {}", e);
                self.emit_turn_event(
                    turn_id,
                    EngineEvent::TurnError {
                        workspace_id: self.workspace_id.clone(),
                        error: error_msg.clone(),
                        code: None,
                    },
                );
                self.clear_turn_ephemeral_state(turn_id);
                return Err(error_msg);
            }
        };

        // If stream-json input is enabled, write the message content to stdin.
        // This path is required for image payloads and multiline text prompts.
        if use_stream_json_input {
            if let Some(mut stdin) = child.stdin.take() {
                let message = match build_message_content(&params) {
                    Ok(value) => value,
                    Err(error) => {
                        drop(stdin);
                        return self
                            .fail_send_setup_and_terminate_child(
                                turn_id,
                                &mut child,
                                format!("Failed to build message: {}", error),
                            )
                            .await;
                    }
                };
                let message_str = match serde_json::to_string(&message) {
                    Ok(value) => value,
                    Err(error) => {
                        drop(stdin);
                        return self
                            .fail_send_setup_and_terminate_child(
                                turn_id,
                                &mut child,
                                format!("Failed to serialize message: {}", error),
                            )
                            .await;
                    }
                };

                if let Err(error) = stdin.write_all(message_str.as_bytes()).await {
                    drop(stdin);
                    return self
                        .fail_send_setup_and_terminate_child(
                            turn_id,
                            &mut child,
                            format!("Failed to write to stdin: {}", error),
                        )
                        .await;
                }
                if let Err(error) = stdin.write_all(b"\n").await {
                    drop(stdin);
                    return self
                        .fail_send_setup_and_terminate_child(
                            turn_id,
                            &mut child,
                            format!("Failed to write newline: {}", error),
                        )
                        .await;
                }
                // Drop stdin to signal EOF
                drop(stdin);
            } else {
                return self
                    .fail_send_setup_and_terminate_child(
                        turn_id,
                        &mut child,
                        "Failed to capture stdin for stream-json mode".to_string(),
                    )
                    .await;
            }
        } else {
            // For non-image messages, drop stdin immediately so the CLI
            // doesn't hang waiting for EOF.
            drop(child.stdin.take());
        }

        let stdout = match child.stdout.take() {
            Some(value) => value,
            None => {
                return self
                    .fail_send_setup_and_terminate_child(
                        turn_id,
                        &mut child,
                        "Failed to capture stdout".to_string(),
                    )
                    .await;
            }
        };

        let stderr = match child.stderr.take() {
            Some(value) => value,
            None => {
                return self
                    .fail_send_setup_and_terminate_child(
                        turn_id,
                        &mut child,
                        "Failed to capture stderr".to_string(),
                    )
                    .await;
            }
        };

        // Store child for interruption (per turn)
        let mut spawned_child = Some(child);
        {
            let mut active = self.active_processes.lock().await;
            if !self.is_disposed() {
                if let Some(child) = spawned_child.take() {
                    active.insert(turn_id.to_string(), child);
                }
            }
        }
        if let Some(mut child) = spawned_child.take() {
            let _ = self.terminate_child_process(turn_id, &mut child).await;
            let error_msg =
                "Claude session disposed during startup; terminated pending child process"
                    .to_string();
            self.emit_turn_event(
                turn_id,
                EngineEvent::TurnError {
                    workspace_id: self.workspace_id.clone(),
                    error: error_msg.clone(),
                    code: None,
                },
            );
            self.clear_turn_ephemeral_state(turn_id);
            return Err(error_msg);
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
                            self.set_session_id(Some(sid.to_string())).await;
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
                            if Self::is_prompt_too_long_error(error) {
                                continue;
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

                        if self.has_pending_approval_request_for_turn(turn_id) {
                            match self
                                .handle_file_approval_resume(turn_id, &params, &new_session_id)
                                .await
                            {
                                Ok(Some(new_lines)) => {
                                    lines = new_lines;
                                    continue;
                                }
                                Ok(None) => {}
                                Err(error) => {
                                    self.emit_turn_event(
                                        turn_id,
                                        EngineEvent::TurnError {
                                            workspace_id: self.workspace_id.clone(),
                                            error: error.clone(),
                                            code: None,
                                        },
                                    );
                                    self.clear_turn_ephemeral_state(turn_id);
                                    return Err(error);
                                }
                            }
                        }

                        // When AskUserQuestion is detected, delegate to the
                        // dedicated handler which waits for user input, kills the
                        // current CLI, and restarts with --resume.
                        if is_user_input_request {
                            match self
                                .handle_ask_user_question_resume(turn_id, &params, &new_session_id)
                                .await
                            {
                                Ok(Some(new_lines)) => {
                                    lines = new_lines;
                                    continue;
                                }
                                Ok(None) => {}
                                Err(error) => {
                                    self.emit_turn_event(
                                        turn_id,
                                        EngineEvent::TurnError {
                                            workspace_id: self.workspace_id.clone(),
                                            error: error.clone(),
                                            code: None,
                                        },
                                    );
                                    self.clear_turn_ephemeral_state(turn_id);
                                    return Err(error);
                                }
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

                if Self::is_prompt_too_long_error(&error_msg) {
                    self.clear_turn_ephemeral_state(turn_id);
                    return Err(Self::mark_retryable_prompt_too_long_error(&error_msg));
                }

                if let Some(mode_blocked_event) =
                    self.build_mode_blocked_signal_from_error(turn_id, &error_msg)
                {
                    self.emit_turn_event(turn_id, mode_blocked_event);
                }

                self.emit_turn_event(
                    turn_id,
                    EngineEvent::TurnError {
                        workspace_id: self.workspace_id.clone(),
                        error: error_msg.clone(),
                        code: None,
                    },
                );

                self.clear_turn_ephemeral_state(turn_id);
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
                self.clear_turn_ephemeral_state(turn_id);
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
                self.clear_turn_ephemeral_state(turn_id);
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
            if Self::is_prompt_too_long_error(&error_msg) {
                self.clear_turn_ephemeral_state(turn_id);
                return Err(Self::mark_retryable_prompt_too_long_error(&error_msg));
            }
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
            self.clear_turn_ephemeral_state(turn_id);
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

        self.clear_turn_ephemeral_state(turn_id);
        Ok(response_text)
    }

    async fn terminate_child_process(
        &self,
        _turn_id: &str,
        child: &mut Child,
    ) -> Result<(), String> {
        if matches!(child.try_wait(), Ok(Some(_))) {
            return Ok(());
        }

        #[cfg(target_os = "windows")]
        {
            if let Some(pid) = child.id() {
                match crate::utils::async_command("taskkill")
                    .args(["/PID", &pid.to_string(), "/T", "/F"])
                    .status()
                    .await
                {
                    Ok(status) if status.success() => {
                        let _ = child.wait().await;
                        return Ok(());
                    }
                    Ok(status) => {
                        if matches!(child.try_wait(), Ok(Some(_))) {
                            return Ok(());
                        }
                        log::warn!(
                            "[claude] taskkill failed for turn={} pid={} status={}",
                            _turn_id,
                            pid,
                            status
                        );
                    }
                    Err(error) => {
                        log::warn!(
                            "[claude] taskkill errored for turn={} pid={}: {}",
                            _turn_id,
                            pid,
                            error
                        );
                    }
                }
            }
        }

        #[cfg(unix)]
        {
            if let Some(pid) = child.id() {
                let process_group_id = pid as libc::pid_t;
                let terminate_status = unsafe { libc::kill(-process_group_id, libc::SIGTERM) };
                if terminate_status != 0 {
                    let error = std::io::Error::last_os_error();
                    if error.raw_os_error() != Some(libc::ESRCH) {
                        log::warn!(
                            "[claude] killpg(SIGTERM) failed for turn={} pgid={}: {}",
                            _turn_id,
                            process_group_id,
                            error
                        );
                    }
                } else {
                    sleep(Duration::from_millis(150)).await;
                }

                if matches!(child.try_wait(), Ok(Some(_))) {
                    let _ = child.wait().await;
                    return Ok(());
                }

                let kill_status = unsafe { libc::kill(-process_group_id, libc::SIGKILL) };
                if kill_status != 0 {
                    let error = std::io::Error::last_os_error();
                    if error.raw_os_error() != Some(libc::ESRCH) {
                        log::warn!(
                            "[claude] killpg(SIGKILL) failed for turn={} pgid={}: {}",
                            _turn_id,
                            process_group_id,
                            error
                        );
                    }
                }

                if matches!(child.try_wait(), Ok(Some(_))) {
                    let _ = child.wait().await;
                    return Ok(());
                }
            }
        }

        if let Err(error) = child.kill().await {
            if matches!(child.try_wait(), Ok(Some(_))) {
                return Ok(());
            }
            return Err(format!("Failed to kill process: {}", error));
        }
        if matches!(child.try_wait(), Ok(Some(_))) {
            return Ok(());
        }
        let _ = child.wait().await;
        Ok(())
    }

    /// Interrupt the current operation
    pub async fn interrupt(&self) -> Result<(), String> {
        // Set interrupted flag BEFORE killing so send_message() knows this was intentional
        self.interrupted.store(true, Ordering::SeqCst);
        let children: Vec<(String, Child)> = {
            let mut active = self.active_processes.lock().await;
            active.drain().collect()
        };
        let mut first_terminate_error: Option<String> = None;
        for (turn_id, mut child) in children {
            if let Err(error) = self.terminate_child_process(&turn_id, &mut child).await {
                log::warn!(
                    "[claude] interrupt failed to terminate child for turn={}: {}",
                    turn_id,
                    error
                );
                if first_terminate_error.is_none() {
                    first_terminate_error = Some(error);
                }
            }
        }
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
        self.last_emitted_text_by_turn
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
        self.user_input_notify_by_turn
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
        self.user_input_answer_by_turn
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
        self.pending_user_inputs
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
        if let Some(error) = first_terminate_error {
            return Err(error);
        }
        Ok(())
    }

    /// Interrupt a single turn without affecting other concurrent turns.
    pub async fn interrupt_turn(&self, turn_id: &str) -> Result<(), String> {
        self.interrupted.store(true, Ordering::SeqCst);
        let mut child = {
            let mut active = self.active_processes.lock().await;
            active.remove(turn_id)
        };
        if let Some(child_proc) = child.as_mut() {
            self.terminate_child_process(turn_id, child_proc).await?;
        }
        self.clear_turn_ephemeral_state(turn_id);
        Ok(())
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

    fn latest_pending_tool_summary(&self, turn_id: &str) -> Option<PendingClaudeToolSummary> {
        let pending = self.pending_tools.lock().ok()?;
        pending
            .iter()
            .rev()
            .find(|entry| entry.turn_id == turn_id)
            .map(|entry| PendingClaudeToolSummary {
                tool_id: entry.tool_id.clone(),
                tool_name: entry.tool_name.clone(),
            })
    }

    fn build_mode_blocked_signal_from_error(
        &self,
        turn_id: &str,
        error_message: &str,
    ) -> Option<EngineEvent> {
        if !looks_like_claude_permission_denial_message(error_message) {
            return None;
        }

        let pending_tool = self.latest_pending_tool_summary(turn_id)?;
        let tool_input = self.peek_tool_input_value(&pending_tool.tool_id);
        let blocked_kind = classify_claude_mode_blocked_tool(&pending_tool.tool_name)?;
        let should_emit_synthetic_approval = match blocked_kind {
            ClaudeModeBlockedKind::FileChange => true,
            ClaudeModeBlockedKind::CommandExecution => tool_input
                .as_ref()
                .and_then(extract_claude_command_string)
                .as_deref()
                .map(command_can_apply_as_local_file_action)
                .unwrap_or(false),
            ClaudeModeBlockedKind::RequestUserInput => false,
        };

        if should_emit_synthetic_approval {
            if let Ok(mut pending) = self.pending_approval_requests.lock() {
                pending.insert(pending_tool.tool_id.clone(), turn_id.to_string());
            }
            return Some(EngineEvent::ApprovalRequest {
                workspace_id: self.workspace_id.clone(),
                request_id: Value::String(pending_tool.tool_id.clone()),
                tool_name: pending_tool.tool_name.clone(),
                input: tool_input,
                message: Some(
                    "Approve to let the GUI apply this file change locally. Preview currently supports structured file tools plus safe single-path file commands.".to_string(),
                ),
            });
        }

        let (blocked_method, reason_code, reason, suggestion) = match blocked_kind {
            ClaudeModeBlockedKind::RequestUserInput => (
                "item/tool/requestUserInput",
                "claude_ask_user_question_permission_denied",
                "Claude denied AskUserQuestion before any approval request reached the GUI.",
                "Claude default mode remains gated. Use Plan mode when the workflow needs AskUserQuestion or other interactive clarification.",
            ),
            ClaudeModeBlockedKind::FileChange => (
                "item/fileChange/requestApproval",
                "claude_file_change_permission_denied",
                "Claude denied a file-change tool before any GUI approval request could start.",
                "Claude preview can bridge Write/CreateFile/CreateDirectory after approval. Other file tools still need full-access or a retry after changing Claude Code settings.",
            ),
            ClaudeModeBlockedKind::CommandExecution => (
                "item/commandExecution/requestApproval",
                "claude_command_execution_permission_denied",
                "Claude blocked a command-execution tool before any recoverable GUI approval request could start.",
                "Claude default mode cannot recover blocked Bash/command tools through the GUI approval bridge yet. Retry in full-access or rewrite the action to use supported file tools.",
            ),
        };

        Some(EngineEvent::Raw {
            workspace_id: self.workspace_id.clone(),
            engine: EngineType::Claude,
            data: json!({
                "type": "permission_denied",
                "source": "claude_permission_denied",
                "blockedMethod": blocked_method,
                "blocked_method": blocked_method,
                "effectiveMode": "code",
                "effective_mode": "code",
                "reasonCode": reason_code,
                "reason_code": reason_code,
                "reason": reason,
                "suggestion": suggestion,
                "requestId": pending_tool.tool_id,
                "request_id": pending_tool.tool_id,
                "toolName": pending_tool.tool_name,
                "tool_name": pending_tool.tool_name,
                "rawError": error_message,
                "raw_error": error_message,
            }),
        })
    }

    /// Compute the true delta from a cumulative assistant text.
    /// If the cumulative text starts with the previously emitted text,
    /// return only the new portion. Otherwise return the full text
    /// (this handles edge cases like context compaction).
    fn compute_text_delta(&self, turn_id: &str, cumulative: &str) -> String {
        if let Ok(mut map) = self.last_emitted_text_by_turn.lock() {
            let last = map.entry(turn_id.to_string()).or_default();
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

    fn peek_tool_input_value(&self, tool_id: &str) -> Option<Value> {
        if tool_id.is_empty() {
            return None;
        }
        self.tool_input_value_by_id
            .lock()
            .ok()
            .and_then(|map| map.get(tool_id).cloned())
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

    fn take_tool_completion_state(&self, tool_id: &str) -> (Option<String>, Option<Value>) {
        let tool_name = self.take_tool_name(tool_id);
        let cached_input = self.take_tool_input_value(tool_id);
        self.clear_pending_tool(tool_id);
        self.clear_tool_input(tool_id);
        (tool_name, cached_input)
    }

    fn build_tool_completed_with_parts(
        &self,
        tool_id: &str,
        output: Option<String>,
        error: Option<String>,
    ) -> Option<EngineEvent> {
        if tool_id.is_empty() {
            return None;
        }
        let (tool_name, cached_input) = self.take_tool_completion_state(tool_id);
        let output = output.map(|text| {
            if let Some(input) = cached_input.clone() {
                json!({
                    "_input": input,
                    "_output": text,
                })
            } else {
                Value::String(text)
            }
        });
        Some(EngineEvent::ToolCompleted {
            workspace_id: self.workspace_id.clone(),
            tool_id: tool_id.to_string(),
            tool_name,
            output,
            error,
        })
    }

    fn emit_tool_completion(
        &self,
        turn_id: &str,
        tool_id: &str,
        output: Option<String>,
        error: Option<String>,
    ) {
        if let Some(event) = self.build_tool_completed_with_parts(tool_id, output, error) {
            self.emit_turn_event(turn_id, event);
        }
    }

    fn build_tool_completed(
        &self,
        tool_id: &str,
        output: Option<String>,
        is_error: bool,
    ) -> Option<EngineEvent> {
        let error = if is_error {
            output.clone().filter(|text| !text.trim().is_empty())
        } else {
            None
        };
        let output = if is_error { None } else { output };
        self.build_tool_completed_with_parts(tool_id, output, error)
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

#[cfg(test)]
#[path = "claude/tests_core.rs"]
mod tests_core;
