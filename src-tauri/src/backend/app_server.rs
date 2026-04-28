use serde_json::{json, Value};
use std::collections::HashMap;
use std::env;
use std::path::PathBuf;
#[cfg(test)]
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;
#[cfg(test)]
use tokio::process::Command;
use tokio::process::{Child, ChildStdin};
use tokio::sync::{mpsc, oneshot, Mutex};
use tokio::time::timeout;

use crate::backend::events::{AppServerEvent, EventSink, TerminalOutput};
use crate::codex::collaboration_policy::strict_local_collaboration_profile_enabled;
use crate::codex::thread_mode_state::ThreadModeState;
use crate::runtime::{RuntimeEndedRecord, RuntimeManager};
use crate::types::WorkspaceEntry;

#[path = "app_server_event_helpers.rs"]
mod event_helpers;
use event_helpers::*;
#[path = "app_server_plan_enforcement.rs"]
mod plan_enforcement;
use plan_enforcement::*;
#[path = "app_server_runtime_lifecycle.rs"]
mod runtime_lifecycle;
use runtime_lifecycle::*;

#[derive(Clone)]
struct DeferredStartupEventSink<E: EventSink> {
    inner: E,
    state: Arc<StdMutex<DeferredStartupEventState>>,
}

enum DeferredStartupEventMode {
    Buffering,
    Forwarding,
    Discarding,
}

enum DeferredStartupEvent {
    AppServer(AppServerEvent),
    Terminal(TerminalOutput),
}

struct DeferredStartupEventState {
    mode: DeferredStartupEventMode,
    events: Vec<DeferredStartupEvent>,
}

impl<E: EventSink> DeferredStartupEventSink<E> {
    fn new(inner: E) -> Self {
        Self {
            inner,
            state: Arc::new(StdMutex::new(DeferredStartupEventState {
                mode: DeferredStartupEventMode::Buffering,
                events: Vec::new(),
            })),
        }
    }

    fn flush_and_forward(&self) {
        let events = {
            let mut state = self
                .state
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            state.mode = DeferredStartupEventMode::Forwarding;
            std::mem::take(&mut state.events)
        };
        for event in events {
            self.emit_deferred_event(event);
        }
    }

    fn discard(&self) {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        state.mode = DeferredStartupEventMode::Discarding;
        state.events.clear();
    }

    fn emit_deferred_event(&self, event: DeferredStartupEvent) {
        match event {
            DeferredStartupEvent::AppServer(event) => self.inner.emit_app_server_event(event),
            DeferredStartupEvent::Terminal(event) => self.inner.emit_terminal_output(event),
        }
    }
}

impl<E: EventSink> EventSink for DeferredStartupEventSink<E> {
    fn emit_app_server_event(&self, event: AppServerEvent) {
        let mut forward_event = Some(event);
        {
            let mut state = self
                .state
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            match state.mode {
                DeferredStartupEventMode::Buffering => {
                    if let Some(event) = forward_event.take() {
                        state.events.push(DeferredStartupEvent::AppServer(event));
                    }
                }
                DeferredStartupEventMode::Forwarding => {}
                DeferredStartupEventMode::Discarding => {
                    forward_event = None;
                }
            }
        }
        if let Some(event) = forward_event {
            self.inner.emit_app_server_event(event);
        }
    }

    fn emit_terminal_output(&self, event: TerminalOutput) {
        let mut forward_event = Some(event);
        {
            let mut state = self
                .state
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            match state.mode {
                DeferredStartupEventMode::Buffering => {
                    if let Some(event) = forward_event.take() {
                        state.events.push(DeferredStartupEvent::Terminal(event));
                    }
                }
                DeferredStartupEventMode::Forwarding => {}
                DeferredStartupEventMode::Discarding => {
                    forward_event = None;
                }
            }
        }
        if let Some(event) = forward_event {
            self.inner.emit_terminal_output(event);
        }
    }
}

#[allow(unused_imports)]
pub(crate) use crate::backend::app_server_cli::{
    apply_codex_app_server_args, build_codex_command_from_launch_context,
    build_codex_command_with_bin, build_codex_path_env, can_retry_wrapper_compatibility_launch,
    can_retry_wrapper_launch, check_cli_binary, check_codex_installation,
    codex_args_override_instructions, codex_external_spec_priority_config_arg,
    probe_codex_app_server, resolve_codex_launch_context,
    visible_console_fallback_enabled_from_env, wrapper_kind_for_binary,
    CodexAppServerLaunchOptions, CodexAppServerProbeStatus, CodexLaunchContext,
};
#[allow(unused_imports)]
pub use crate::backend::app_server_cli::{
    build_command_for_binary, build_command_for_binary_with_console, find_cli_binary,
    get_cli_debug_info,
};

#[cfg(test)]
const AUTO_COMPACTION_THRESHOLD_PERCENT: f64 = 92.0;
#[cfg(test)]
const AUTO_COMPACTION_TARGET_PERCENT: f64 = 70.0;
#[cfg(test)]
const AUTO_COMPACTION_COOLDOWN_MS: u64 = 90_000;
#[cfg(test)]
const AUTO_COMPACTION_INFLIGHT_TIMEOUT_MS: u64 = 120_000;
const DEFAULT_REQUEST_TIMEOUT_SECS: u64 = 300;
const DEFAULT_INITIAL_TURN_START_TIMEOUT_MS: u64 = 120_000;
const MIN_INITIAL_TURN_START_TIMEOUT_MS: u64 = 30_000;
const MAX_INITIAL_TURN_START_TIMEOUT_MS: u64 = 240_000;
const DEFAULT_RESUME_AFTER_USER_INPUT_TIMEOUT_MS: u64 = 45_000;
const MIN_RESUME_AFTER_USER_INPUT_TIMEOUT_MS: u64 = 10_000;
const MAX_RESUME_AFTER_USER_INPUT_TIMEOUT_MS: u64 = 180_000;
const TIMED_OUT_REQUEST_GRACE_MS: u64 = 180_000;
#[cfg(test)]
#[derive(Debug, Default, Clone)]
struct AutoCompactionThreadState {
    is_processing: bool,
    in_flight: bool,
    last_triggered_at_ms: u64,
}

#[derive(Debug, Clone)]
struct TimedOutRequest {
    method: String,
    thread_id: Option<String>,
    timed_out_at_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RuntimeShutdownSource {
    UserManualShutdown,
    ManualRelease,
    InternalReplacement,
    StaleReuseCleanup,
    SettingsRestart,
    AppExit,
    IdleEviction,
    CompatibilityManual,
}

impl RuntimeShutdownSource {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::UserManualShutdown => "user_manual_shutdown",
            Self::ManualRelease => "manual_release",
            Self::InternalReplacement => "internal_replacement",
            Self::StaleReuseCleanup => "stale_reuse_cleanup",
            Self::SettingsRestart => "settings_restart",
            Self::AppExit => "app_exit",
            Self::IdleEviction => "idle_eviction",
            Self::CompatibilityManual => "manual_shutdown",
        }
    }

    fn stale_reuse_reason(self) -> &'static str {
        match self {
            Self::UserManualShutdown => "user-manual-shutdown-requested",
            Self::ManualRelease => "manual-release-requested",
            Self::InternalReplacement => "internal-replacement-shutdown-requested",
            Self::StaleReuseCleanup => "stale-reuse-cleanup-shutdown-requested",
            Self::SettingsRestart => "settings-restart-shutdown-requested",
            Self::AppExit => "app-exit-shutdown-requested",
            Self::IdleEviction => "idle-eviction-shutdown-requested",
            Self::CompatibilityManual => "manual-shutdown-requested",
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) enum ResumePendingSource {
    UserInputResume,
    QueueFusionCutover { previous_turn_id: Option<String> },
}

impl ResumePendingSource {
    fn runtime_source_label(&self) -> &'static str {
        match self {
            Self::UserInputResume => "user-input-resume",
            Self::QueueFusionCutover { .. } => "queue-fusion-cutover",
        }
    }

    fn stalled_reason_code(&self) -> &'static str {
        match self {
            Self::UserInputResume => "resume_timeout",
            Self::QueueFusionCutover { .. } => "fusion_resume_timeout",
        }
    }

    fn stalled_stage(&self) -> &'static str {
        match self {
            Self::UserInputResume => "resume-pending",
            Self::QueueFusionCutover { .. } => "fusion-resume-pending",
        }
    }

    fn stalled_message(&self, timeout_ms: u64) -> String {
        match self {
            Self::UserInputResume => format!(
                "[TURN_STALLED] User input was submitted, but Codex did not resume within {}s. You can continue from the latest visible state.",
                timeout_ms.div_ceil(1000)
            ),
            Self::QueueFusionCutover { .. } => format!(
                "[TURN_STALLED] Queue fusion switched to a successor run, but Codex did not resume within {}s. You can continue from the latest visible state.",
                timeout_ms.div_ceil(1000)
            ),
        }
    }

    fn should_clear_on_event(&self, method: Option<&str>, turn_id: Option<&str>) -> bool {
        match self {
            Self::UserInputResume => true,
            Self::QueueFusionCutover { previous_turn_id } => {
                if !matches!(method, Some("turn/started")) {
                    return false;
                }
                let normalized_turn_id = turn_id.map(str::trim).filter(|value| !value.is_empty());
                match (previous_turn_id.as_deref(), normalized_turn_id) {
                    (Some(previous_turn_id), Some(candidate_turn_id)) => {
                        candidate_turn_id != previous_turn_id
                    }
                    (Some(_), None) => false,
                    (None, Some(_)) => true,
                    (None, None) => false,
                }
            }
        }
    }
}

#[derive(Debug, Clone)]
struct ResumePendingTurnState {
    nonce: String,
    turn_id: Option<String>,
    started_at_ms: u64,
    timeout_ms: u64,
    source: ResumePendingSource,
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_else(|_| Duration::from_millis(0))
        .as_millis() as u64
}

fn resolve_initial_turn_start_timeout_ms() -> u64 {
    let configured = env::var("MOSSX_INITIAL_TURN_START_TIMEOUT_MS")
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .unwrap_or(DEFAULT_INITIAL_TURN_START_TIMEOUT_MS);
    configured.clamp(
        MIN_INITIAL_TURN_START_TIMEOUT_MS,
        MAX_INITIAL_TURN_START_TIMEOUT_MS,
    )
}

fn resolve_resume_after_user_input_timeout_ms() -> u64 {
    let configured = env::var("MOSSX_RESUME_AFTER_USER_INPUT_TIMEOUT_MS")
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .unwrap_or(DEFAULT_RESUME_AFTER_USER_INPUT_TIMEOUT_MS);
    configured.clamp(
        MIN_RESUME_AFTER_USER_INPUT_TIMEOUT_MS,
        MAX_RESUME_AFTER_USER_INPUT_TIMEOUT_MS,
    )
}

fn extract_thread_id(value: &Value) -> Option<String> {
    let params = value.get("params")?;

    params
        .get("threadId")
        .or_else(|| params.get("thread_id"))
        .or_else(|| params.get("turn").and_then(|turn| turn.get("threadId")))
        .or_else(|| params.get("turn").and_then(|turn| turn.get("thread_id")))
        .and_then(|t| t.as_str())
        .map(|s| s.to_string())
        .or_else(|| {
            params
                .get("thread")
                .and_then(|thread| thread.get("id"))
                .and_then(|t| t.as_str())
                .map(|s| s.to_string())
        })
}

fn extract_turn_id(value: &Value) -> Option<String> {
    let params = value.get("params")?;

    params
        .get("turnId")
        .or_else(|| params.get("turn_id"))
        .or_else(|| params.get("turn").and_then(|turn| turn.get("id")))
        .and_then(|turn| turn.as_str())
        .map(ToOwned::to_owned)
}

fn extract_event_method(value: &Value) -> Option<&str> {
    value.get("method").and_then(Value::as_str)
}

fn extract_request_thread_id(params: &Value) -> Option<String> {
    params
        .get("threadId")
        .or_else(|| params.get("thread_id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

#[cfg(test)]
fn read_number_field(obj: &Value, keys: &[&str]) -> Option<f64> {
    keys.iter().find_map(|key| {
        obj.get(*key).and_then(|value| {
            value
                .as_f64()
                .or_else(|| value.as_i64().map(|v| v as f64))
                .or_else(|| value.as_u64().map(|v| v as f64))
                .or_else(|| value.as_str().and_then(|v| v.trim().parse::<f64>().ok()))
        })
    })
}

#[cfg(test)]
fn extract_compaction_usage_percent(value: &Value) -> Option<f64> {
    let method = extract_event_method(value)?;
    let params = value.get("params")?;
    let (used_tokens, context_window) = if method == "token_count" {
        let info = params.get("info")?;
        let last_usage = info
            .get("last_token_usage")
            .or_else(|| info.get("lastTokenUsage"))
            .filter(|usage| usage.is_object());
        // Require last/current snapshot for compaction decisions.
        // total_* fields are cumulative session stats and can stay high after compaction.
        let usage = last_usage?;
        let input_tokens =
            read_number_field(usage, &["input_tokens", "inputTokens"]).unwrap_or(0.0);
        let cached_tokens = read_number_field(
            usage,
            &[
                "cached_input_tokens",
                "cache_read_input_tokens",
                "cachedInputTokens",
                "cacheReadInputTokens",
            ],
        )
        .unwrap_or(0.0);
        let used_tokens = input_tokens + cached_tokens;
        let context_window = read_number_field(
            usage,
            &[
                "model_context_window",
                "modelContextWindow",
                "context_window",
            ],
        )
        .or_else(|| read_number_field(info, &["model_context_window", "modelContextWindow"]))
        .unwrap_or(200_000.0);
        (used_tokens, context_window)
    } else if method == "thread/tokenUsage/updated" {
        let usage = params
            .get("tokenUsage")
            .or_else(|| params.get("token_usage"))
            .unwrap_or(&Value::Null);
        // Require last/current snapshot for auto-compaction decisions.
        let snapshot = usage.get("last").filter(|value| value.is_object())?;
        let input_tokens =
            read_number_field(snapshot, &["inputTokens", "input_tokens"]).unwrap_or(0.0);
        let cached_tokens = read_number_field(
            snapshot,
            &[
                "cachedInputTokens",
                "cached_input_tokens",
                "cacheReadInputTokens",
                "cache_read_input_tokens",
            ],
        )
        .unwrap_or(0.0);
        let used_tokens = input_tokens + cached_tokens;
        let context_window = read_number_field(
            usage,
            &[
                "modelContextWindow",
                "model_context_window",
                "context_window",
            ],
        )
        .unwrap_or(200_000.0);
        (used_tokens, context_window)
    } else {
        return None;
    };
    if context_window <= 0.0 {
        return None;
    }
    Some((used_tokens / context_window) * 100.0)
}

#[cfg(test)]
fn is_codex_thread_id(thread_id: &str) -> bool {
    let normalized = thread_id.trim();
    if normalized.is_empty() {
        return false;
    }
    !normalized.starts_with("claude:")
        && !normalized.starts_with("claude-pending-")
        && !normalized.starts_with("opencode:")
        && !normalized.starts_with("opencode-pending-")
        && !normalized.starts_with("gemini:")
        && !normalized.starts_with("gemini-pending-")
}

fn should_skip_codex_stderr_line(line: &str) -> bool {
    let normalized = line.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return true;
    }
    normalized.contains("rmcp::transport::worker")
        && normalized.contains("transport channel closed")
        && normalized.contains("authrequired(")
}

#[cfg(test)]
fn evaluate_auto_compaction_state(
    state: &mut AutoCompactionThreadState,
    method: &str,
    usage_percent: Option<f64>,
    now: u64,
) -> bool {
    match method {
        "turn/started" => {
            state.is_processing = true;
        }
        "turn/completed" | "turn/error" => {
            state.is_processing = false;
        }
        "thread/compacted" => {
            state.is_processing = false;
            state.in_flight = false;
        }
        "thread/compactionFailed" => {
            state.in_flight = false;
        }
        _ => {}
    }

    if let Some(percent) = usage_percent {
        if percent <= AUTO_COMPACTION_TARGET_PERCENT {
            return false;
        }
        if percent < AUTO_COMPACTION_THRESHOLD_PERCENT {
            return false;
        }
    }

    if state.in_flight
        && now.saturating_sub(state.last_triggered_at_ms) > AUTO_COMPACTION_INFLIGHT_TIMEOUT_MS
    {
        state.in_flight = false;
    }

    if state.in_flight || state.is_processing {
        return false;
    }
    if now.saturating_sub(state.last_triggered_at_ms) < AUTO_COMPACTION_COOLDOWN_MS {
        return false;
    }

    state.in_flight = true;
    state.last_triggered_at_ms = now;
    true
}

pub(crate) struct WorkspaceSession {
    pub(crate) entry: WorkspaceEntry,
    pub(crate) child: Mutex<Child>,
    pub(crate) stdin: Mutex<ChildStdin>,
    pub(crate) wrapper_kind: String,
    pub(crate) resolved_bin: String,
    pub(crate) process_id: Option<u32>,
    pub(crate) pending: Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>,
    timed_out_requests: Mutex<HashMap<u64, TimedOutRequest>>,
    pub(crate) next_id: AtomicU64,
    /// Callbacks for background threads - events for these threadIds are sent through the channel
    pub(crate) background_thread_callbacks: Mutex<HashMap<String, mpsc::UnboundedSender<Value>>>,
    pub(crate) thread_mode_state: ThreadModeState,
    pub(crate) mode_enforcement_enabled: AtomicBool,
    pub(crate) collaboration_mode_supported: AtomicBool,
    plan_turn_state: Mutex<HashMap<String, PlanTurnState>>,
    local_user_input_requests: Mutex<HashMap<String, String>>,
    local_request_seq: AtomicU64,
    resume_pending_turns: Mutex<HashMap<String, ResumePendingTurnState>>,
    runtime_manager: StdMutex<Option<Arc<RuntimeManager>>>,
    active_turns: Mutex<HashMap<String, String>>,
    manual_shutdown_requested: AtomicBool,
    shutdown_source: StdMutex<Option<RuntimeShutdownSource>>,
    shutdown_had_active_work_protection: AtomicBool,
    runtime_end_emitted: AtomicBool,
}

impl WorkspaceSession {
    fn configure_spawn_command(cmd: &mut tokio::process::Command) {
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

    async fn write_message(&self, value: Value) -> Result<(), String> {
        let mut stdin = self.stdin.lock().await;
        let mut line = serde_json::to_string(&value).map_err(|e| e.to_string())?;
        line.push('\n');
        stdin
            .write_all(line.as_bytes())
            .await
            .map_err(|e| e.to_string())
    }

    pub(crate) async fn probe_health(&self, timeout_duration: Duration) -> Result<(), String> {
        self.send_request_with_timeout("model/list", json!({}), timeout_duration)
            .await
            .map(|_| ())
    }

    pub(crate) async fn send_request(&self, method: &str, params: Value) -> Result<Value, String> {
        self.send_request_with_timeout(
            method,
            params,
            Duration::from_secs(DEFAULT_REQUEST_TIMEOUT_SECS),
        )
        .await
    }

    pub(crate) async fn send_request_with_timeout(
        &self,
        method: &str,
        params: Value,
        timeout_duration: Duration,
    ) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(id, tx);
        if let Err(error) = self
            .write_message(json!({ "id": id, "method": method, "params": params }))
            .await
        {
            self.pending.lock().await.remove(&id);
            return Err(error);
        }
        // Add timeout to prevent pending entries from leaking forever
        // when the child process crashes without sending a response.
        match timeout(timeout_duration, rx).await {
            Ok(Ok(Ok(value))) => Ok(value),
            Ok(Ok(Err(error))) => Err(error),
            Ok(Err(_)) => {
                self.pending.lock().await.remove(&id);
                Err("request canceled".to_string())
            }
            Err(_) => {
                self.pending.lock().await.remove(&id);
                self.record_timed_out_request(id, method, extract_request_thread_id(&params))
                    .await;
                Err("request timed out".to_string())
            }
        }
    }

    pub(crate) fn default_request_timeout(&self) -> Duration {
        Duration::from_secs(DEFAULT_REQUEST_TIMEOUT_SECS)
    }

    pub(crate) fn initial_turn_start_timeout(&self) -> Duration {
        Duration::from_millis(resolve_initial_turn_start_timeout_ms())
    }

    pub(crate) fn attach_runtime_manager(&self, runtime_manager: Arc<RuntimeManager>) {
        *self
            .runtime_manager
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(runtime_manager);
    }

    fn runtime_manager(&self) -> Option<Arc<RuntimeManager>> {
        self.runtime_manager
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    pub(crate) async fn note_codex_turn_start_pending(
        &self,
        thread_id: &str,
        timeout_duration: Duration,
    ) {
        let normalized_thread_id = thread_id.trim();
        if normalized_thread_id.is_empty() {
            return;
        }
        if let Some(runtime_manager) = self.runtime_manager() {
            runtime_manager
                .note_foreground_turn_start_pending(
                    &self.entry,
                    "codex",
                    normalized_thread_id,
                    timeout_duration.as_millis() as u64,
                )
                .await;
        }
    }

    pub(crate) async fn note_codex_thread_create_pending(&self, timeout_duration: Duration) {
        if let Some(runtime_manager) = self.runtime_manager() {
            runtime_manager
                .note_foreground_thread_create_pending(
                    &self.entry,
                    "codex",
                    timeout_duration.as_millis() as u64,
                )
                .await;
        }
    }

    pub(crate) async fn clear_codex_foreground_work(
        &self,
        thread_id: Option<&str>,
        turn_id: Option<&str>,
    ) {
        if let Some(runtime_manager) = self.runtime_manager() {
            runtime_manager
                .clear_foreground_work_continuity("codex", &self.entry.id, thread_id, turn_id)
                .await;
        }
    }

    pub(crate) async fn clear_resume_pending_watch(
        &self,
        thread_id: Option<&str>,
        turn_id: Option<&str>,
        method: Option<&str>,
    ) {
        let Some(thread_id) = thread_id.map(str::trim).filter(|value| !value.is_empty()) else {
            return;
        };
        let mut resume_pending_turns = self.resume_pending_turns.lock().await;
        let should_remove = resume_pending_turns
            .get(thread_id)
            .map(|state| {
                if !state.source.should_clear_on_event(method, turn_id) {
                    return false;
                }
                if let Some(expected_turn_id) = state.turn_id.as_deref() {
                    if let Some(candidate_turn_id) = turn_id.map(str::trim) {
                        return candidate_turn_id.is_empty()
                            || candidate_turn_id == expected_turn_id;
                    }
                }
                true
            })
            .unwrap_or(false);
        if should_remove {
            resume_pending_turns.remove(thread_id);
        }
    }

    pub(crate) async fn start_resume_pending_watch(
        self: &Arc<Self>,
        app: AppHandle,
        thread_id: String,
        turn_id: Option<String>,
        source: ResumePendingSource,
    ) {
        let normalized_thread_id = thread_id.trim().to_string();
        if normalized_thread_id.is_empty() {
            return;
        }
        let normalized_turn_id = turn_id
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let timeout_ms = resolve_resume_after_user_input_timeout_ms();
        let state = ResumePendingTurnState {
            nonce: format!(
                "resume-pending-{}",
                self.next_id.fetch_add(1, Ordering::SeqCst)
            ),
            turn_id: normalized_turn_id.clone(),
            started_at_ms: now_millis(),
            timeout_ms,
            source: source.clone(),
        };
        self.resume_pending_turns
            .lock()
            .await
            .insert(normalized_thread_id.clone(), state.clone());
        if let Some(runtime_manager) = self.runtime_manager() {
            runtime_manager
                .note_foreground_resume_pending(
                    &self.entry,
                    "codex",
                    &normalized_thread_id,
                    normalized_turn_id.as_deref(),
                    source.runtime_source_label(),
                    timeout_ms,
                )
                .await;
        }
        let session = Arc::clone(self);
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(timeout_ms)).await;
            let timed_out_state = {
                let mut resume_pending_turns = session.resume_pending_turns.lock().await;
                match resume_pending_turns.get(&normalized_thread_id) {
                    Some(current) if current.nonce == state.nonce => {
                        resume_pending_turns.remove(&normalized_thread_id)
                    }
                    _ => None,
                }
            };
            let Some(timed_out_state) = timed_out_state else {
                return;
            };
            let message = timed_out_state
                .source
                .stalled_message(timed_out_state.timeout_ms);
            let _ = app.emit(
                "app-server-event",
                AppServerEvent {
                    workspace_id: session.entry.id.clone(),
                    message: build_turn_stalled_event(
                        &normalized_thread_id,
                        timed_out_state.turn_id.as_deref(),
                        timed_out_state.source.stalled_reason_code(),
                        timed_out_state.source.stalled_stage(),
                        timed_out_state.source.runtime_source_label(),
                        &message,
                        timed_out_state.started_at_ms,
                        timed_out_state.timeout_ms,
                    ),
                },
            );
        });
    }

    pub(crate) async fn send_notification(
        &self,
        method: &str,
        params: Option<Value>,
    ) -> Result<(), String> {
        let value = if let Some(params) = params {
            json!({ "method": method, "params": params })
        } else {
            json!({ "method": method })
        };
        self.write_message(value).await
    }

    pub(crate) async fn send_response(&self, id: Value, result: Value) -> Result<(), String> {
        self.write_message(json!({ "id": id, "result": result }))
            .await
    }

    pub(crate) fn set_mode_enforcement_enabled(&self, enabled: bool) {
        self.mode_enforcement_enabled
            .store(enabled, Ordering::Relaxed);
    }

    pub(crate) fn mode_enforcement_enabled(&self) -> bool {
        self.mode_enforcement_enabled.load(Ordering::Relaxed)
    }

    pub(crate) fn set_collaboration_mode_supported(&self, supported: bool) {
        self.collaboration_mode_supported
            .store(supported, Ordering::Relaxed);
    }

    pub(crate) fn collaboration_mode_supported(&self) -> bool {
        self.collaboration_mode_supported.load(Ordering::Relaxed)
    }

    pub(crate) async fn get_thread_effective_mode(&self, thread_id: &str) -> Option<String> {
        self.thread_mode_state.get(thread_id).await
    }

    pub(crate) async fn set_thread_effective_mode(&self, thread_id: &str, mode: &str) {
        self.thread_mode_state
            .set(thread_id.to_string(), mode)
            .await;
    }

    pub(crate) async fn inherit_thread_effective_mode(
        &self,
        parent_thread_id: &str,
        child_thread_id: &str,
    ) -> Option<String> {
        self.thread_mode_state
            .inherit(parent_thread_id, child_thread_id)
            .await
    }

    pub(crate) async fn clear_thread_effective_mode(&self, thread_id: &str) {
        self.thread_mode_state.remove(thread_id).await;
        self.plan_turn_state.lock().await.remove(thread_id);
    }

    pub(crate) async fn consume_local_user_input_request(&self, request_id: &str) -> bool {
        self.local_user_input_requests
            .lock()
            .await
            .remove(request_id)
            .is_some()
    }

    async fn fire_and_forget_request(&self, method: &str, params: Value) -> Result<(), String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        self.write_message(json!({ "id": id, "method": method, "params": params }))
            .await
    }
}

pub(crate) async fn spawn_workspace_session<E: EventSink>(
    entry: WorkspaceEntry,
    default_codex_bin: Option<String>,
    codex_args: Option<String>,
    codex_home: Option<PathBuf>,
    client_version: String,
    event_sink: E,
) -> Result<Arc<WorkspaceSession>, String> {
    let codex_bin = entry
        .codex_bin
        .clone()
        .filter(|value| !value.trim().is_empty())
        .or(default_codex_bin);
    let _ = check_codex_installation(codex_bin.clone()).await?;
    let launch_context = resolve_codex_launch_context(codex_bin.as_deref());

    if can_retry_wrapper_compatibility_launch(&launch_context) {
        return spawn_workspace_session_with_wrapper_fallback(
            entry,
            codex_args,
            codex_home,
            client_version,
            event_sink,
            &launch_context,
        )
        .await;
    }

    spawn_workspace_session_once(
        entry,
        codex_args,
        codex_home,
        client_version,
        event_sink,
        &launch_context,
        CodexAppServerLaunchOptions::primary(),
    )
    .await
}

async fn spawn_workspace_session_with_wrapper_fallback<E: EventSink>(
    entry: WorkspaceEntry,
    codex_args: Option<String>,
    codex_home: Option<PathBuf>,
    client_version: String,
    event_sink: E,
    launch_context: &CodexLaunchContext,
) -> Result<Arc<WorkspaceSession>, String> {
    let primary_sink = DeferredStartupEventSink::new(event_sink.clone());
    let primary_result = spawn_workspace_session_once(
        entry.clone(),
        codex_args.clone(),
        codex_home.clone(),
        client_version.clone(),
        primary_sink.clone(),
        launch_context,
        CodexAppServerLaunchOptions::primary(),
    )
    .await;
    match primary_result {
        Ok(session) => {
            primary_sink.flush_and_forward();
            Ok(session)
        }
        Err(primary_error) => {
            primary_sink.discard();
            log::warn!(
                "[codex-wrapper-fallback] retrying workspace={} bin={} wrapper={} without internal spec hint after primary failure: {}",
                entry.id,
                launch_context.resolved_bin,
                launch_context.wrapper_kind,
                primary_error
            );
            spawn_workspace_session_once(
                entry,
                codex_args,
                codex_home,
                client_version,
                event_sink,
                launch_context,
                CodexAppServerLaunchOptions::wrapper_compatibility_retry(),
            )
            .await
            .map_err(|retry_error| {
                format!(
                    "Primary wrapper launch failed: {primary_error}\nFallback retry failed: {retry_error}"
                )
            })
        }
    }
}

async fn spawn_workspace_session_once<E: EventSink>(
    entry: WorkspaceEntry,
    codex_args: Option<String>,
    codex_home: Option<PathBuf>,
    client_version: String,
    event_sink: E,
    launch_context: &CodexLaunchContext,
    launch_options: CodexAppServerLaunchOptions,
) -> Result<Arc<WorkspaceSession>, String> {
    let mut command =
        build_codex_command_from_launch_context(launch_context, launch_options.hide_console);
    WorkspaceSession::configure_spawn_command(&mut command);
    apply_codex_app_server_args(&mut command, codex_args.as_deref(), launch_options)?;
    command.current_dir(&entry.path);
    if let Some(codex_home) = codex_home {
        command.env("CODEX_HOME", codex_home);
    }
    command.stdin(std::process::Stdio::piped());
    command.stdout(std::process::Stdio::piped());
    command.stderr(std::process::Stdio::piped());

    let mut child = command.spawn().map_err(|e| e.to_string())?;
    let process_id = child.id();
    let stdin = child.stdin.take().ok_or("missing stdin")?;
    let stdout = child.stdout.take().ok_or("missing stdout")?;
    let stderr = child.stderr.take().ok_or("missing stderr")?;

    let session = Arc::new(WorkspaceSession {
        entry: entry.clone(),
        child: Mutex::new(child),
        stdin: Mutex::new(stdin),
        wrapper_kind: launch_context.wrapper_kind.to_string(),
        resolved_bin: launch_context.resolved_bin.clone(),
        process_id,
        pending: Mutex::new(HashMap::new()),
        timed_out_requests: Mutex::new(HashMap::new()),
        next_id: AtomicU64::new(1),
        background_thread_callbacks: Mutex::new(HashMap::new()),
        thread_mode_state: ThreadModeState::default(),
        mode_enforcement_enabled: AtomicBool::new(true),
        collaboration_mode_supported: AtomicBool::new(true),
        plan_turn_state: Mutex::new(HashMap::new()),
        local_user_input_requests: Mutex::new(HashMap::new()),
        local_request_seq: AtomicU64::new(1),
        resume_pending_turns: Mutex::new(HashMap::new()),
        runtime_manager: StdMutex::new(None),
        active_turns: Mutex::new(HashMap::new()),
        manual_shutdown_requested: AtomicBool::new(false),
        shutdown_source: StdMutex::new(None),
        shutdown_had_active_work_protection: AtomicBool::new(false),
        runtime_end_emitted: AtomicBool::new(false),
    });

    spawn_workspace_session_runtime_tasks(
        session.clone(),
        stdout,
        stderr,
        entry.id.clone(),
        event_sink.clone(),
    );

    let init_params = json!({
        "clientInfo": {
            "name": "ccgui",
            "title": "ccgui",
            "version": client_version
        },
        "capabilities": {
            // Plan mode collaboration and requestUserInput are experimental APIs in codex app-server.
            "experimentalApi": true
        },
    });
    let init_result = timeout(
        Duration::from_secs(15),
        session.send_request("initialize", init_params),
    )
    .await;
    let init_response = match init_result {
        Ok(response) => response,
        Err(_) => {
            let mut child = session.child.lock().await;
            let _ = child.kill().await;
            return Err(
                "Codex app-server did not respond to initialize. Check that `codex app-server` works in Terminal."
                    .to_string(),
            );
        }
    };
    if let Err(error) = init_response {
        let mut child = session.child.lock().await;
        let _ = child.kill().await;
        return Err(error);
    }
    session.send_notification("initialized", None).await?;

    let payload = AppServerEvent {
        workspace_id: entry.id.clone(),
        message: json!({
            "method": "codex/connected",
            "params": { "workspaceId": entry.id.clone() }
        }),
    };
    event_sink.emit_app_server_event(payload);

    Ok(session)
}

#[cfg(test)]
fn make_test_workspace_entry(id: &str) -> WorkspaceEntry {
    let mut settings = crate::types::WorkspaceSettings::default();
    settings.engine_type = Some("codex".to_string());
    WorkspaceEntry {
        id: id.to_string(),
        name: format!("Workspace {id}"),
        path: std::env::temp_dir().join(id).display().to_string(),
        codex_bin: None,
        kind: crate::types::WorkspaceKind::Main,
        parent_id: None,
        worktree: None,
        settings,
    }
}

#[cfg(test)]
fn spawn_test_runtime_process_for_runtime() -> (tokio::process::Child, String) {
    #[cfg(windows)]
    {
        let command_path = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string());
        let mut command = Command::new(&command_path);
        command.args(["/Q", "/K"]);
        command.stdin(Stdio::piped());
        command.stdout(Stdio::piped());
        command.stderr(Stdio::piped());
        let child = command
            .spawn()
            .unwrap_or_else(|error| panic!("failed to spawn {command_path}: {error}"));
        return (child, command_path);
    }

    #[cfg(not(windows))]
    {
        let command_path = "cat".to_string();
        let mut command = Command::new(&command_path);
        command.stdin(Stdio::piped());
        command.stdout(Stdio::piped());
        command.stderr(Stdio::piped());
        let child = command
            .spawn()
            .unwrap_or_else(|error| panic!("failed to spawn {command_path}: {error}"));
        (child, command_path)
    }
}

#[cfg(test)]
pub(crate) async fn make_test_workspace_session(id: &str) -> Arc<WorkspaceSession> {
    let (mut child, resolved_bin) = spawn_test_runtime_process_for_runtime();
    let process_id = child.id();
    let stdin = child.stdin.take().expect("test child stdin");
    Arc::new(WorkspaceSession {
        entry: make_test_workspace_entry(id),
        child: Mutex::new(child),
        stdin: Mutex::new(stdin),
        wrapper_kind: "direct".to_string(),
        resolved_bin,
        process_id,
        pending: Mutex::new(HashMap::new()),
        timed_out_requests: Mutex::new(HashMap::new()),
        next_id: AtomicU64::new(1),
        background_thread_callbacks: Mutex::new(HashMap::new()),
        thread_mode_state: crate::codex::thread_mode_state::ThreadModeState::default(),
        mode_enforcement_enabled: AtomicBool::new(false),
        collaboration_mode_supported: AtomicBool::new(false),
        plan_turn_state: Mutex::new(HashMap::new()),
        local_user_input_requests: Mutex::new(HashMap::new()),
        local_request_seq: AtomicU64::new(1),
        resume_pending_turns: Mutex::new(HashMap::new()),
        runtime_manager: StdMutex::new(None),
        active_turns: Mutex::new(HashMap::new()),
        manual_shutdown_requested: AtomicBool::new(false),
        shutdown_source: StdMutex::new(None),
        shutdown_had_active_work_protection: AtomicBool::new(false),
        runtime_end_emitted: AtomicBool::new(false),
    })
}

#[cfg(test)]
pub(crate) async fn dispose_test_workspace_session(session: &WorkspaceSession) {
    session.mark_manual_shutdown();
    let mut child = session.child.lock().await;
    let _ = child.kill().await;
    let _ = child.wait().await;
}

#[cfg(test)]
mod tests {
    use super::{
        build_late_turn_error_event, build_late_turn_started_event, build_mode_blocked_event,
        build_plan_blocker_user_input_event, codex_args_override_instructions,
        codex_external_spec_priority_config_arg, detect_plan_blocker_reason,
        detect_repo_mutating_blocked_method, evaluate_auto_compaction_state,
        extract_compaction_usage_percent, extract_plan_step_count, extract_stream_delta_text,
        extract_thread_id, is_codex_thread_id, is_plan_blocker_stream_method,
        is_repo_mutating_command_tokens, looks_like_executable_plan_text,
        looks_like_plan_blocker_prompt, looks_like_user_info_followup_prompt,
        normalize_command_tokens_from_item, should_block_request_user_input,
        should_skip_codex_stderr_line, visible_console_fallback_enabled_from_env,
        wrapper_kind_for_binary, AutoCompactionThreadState, DeferredStartupEventSink,
        PlanTurnState, RuntimeShutdownSource, TimedOutRequest, WorkspaceSession,
        MODE_BLOCKED_PLAN_REASON, MODE_BLOCKED_PLAN_SUGGESTION, MODE_BLOCKED_REASON,
        MODE_BLOCKED_REASON_CODE_PLAN_READONLY, MODE_BLOCKED_REASON_CODE_REQUEST_USER_INPUT,
        MODE_BLOCKED_SUGGESTION,
    };
    use crate::backend::events::{AppServerEvent, EventSink, TerminalOutput};
    use crate::runtime::RuntimeManager;
    use crate::types::{AppSettings, WorkspaceEntry, WorkspaceKind, WorkspaceSettings};
    use serde_json::{json, Value};
    use std::collections::HashMap;
    use std::process::Stdio;
    use std::sync::atomic::{AtomicBool, AtomicU64};
    use std::sync::{Arc, Mutex as StdMutex};
    use tokio::process::Command;
    use tokio::sync::{mpsc, oneshot, Mutex};

    #[derive(Clone, Default)]
    struct TestEventSink {
        app_server_events: Arc<StdMutex<Vec<AppServerEvent>>>,
    }

    impl TestEventSink {
        fn emitted_app_server_events(&self) -> Vec<AppServerEvent> {
            self.app_server_events
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .clone()
        }
    }

    impl EventSink for TestEventSink {
        fn emit_app_server_event(&self, event: AppServerEvent) {
            self.app_server_events
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .push(event);
        }

        fn emit_terminal_output(&self, _event: TerminalOutput) {}
    }

    #[test]
    fn deferred_startup_event_sink_buffers_until_flush() {
        let inner = TestEventSink::default();
        let sink = DeferredStartupEventSink::new(inner.clone());

        sink.emit_app_server_event(AppServerEvent {
            workspace_id: "workspace-1".to_string(),
            message: json!({ "method": "runtime/ended" }),
        });
        assert!(inner.emitted_app_server_events().is_empty());

        sink.flush_and_forward();
        let events = inner.emitted_app_server_events();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].message["method"], "runtime/ended");

        sink.emit_app_server_event(AppServerEvent {
            workspace_id: "workspace-1".to_string(),
            message: json!({ "method": "codex/connected" }),
        });
        let events = inner.emitted_app_server_events();
        assert_eq!(events.len(), 2);
        assert_eq!(events[1].message["method"], "codex/connected");
    }

    #[test]
    fn deferred_startup_event_sink_discards_primary_failure_events() {
        let inner = TestEventSink::default();
        let sink = DeferredStartupEventSink::new(inner.clone());

        sink.emit_app_server_event(AppServerEvent {
            workspace_id: "workspace-1".to_string(),
            message: json!({ "method": "runtime/ended" }),
        });
        sink.discard();
        sink.emit_app_server_event(AppServerEvent {
            workspace_id: "workspace-1".to_string(),
            message: json!({ "method": "codex/stderr" }),
        });

        assert!(inner.emitted_app_server_events().is_empty());
    }

    fn workspace_entry(id: &str) -> WorkspaceEntry {
        let mut settings = WorkspaceSettings::default();
        settings.engine_type = Some("codex".to_string());
        WorkspaceEntry {
            id: id.to_string(),
            name: format!("Workspace {id}"),
            path: std::env::temp_dir().join(id).display().to_string(),
            codex_bin: None,
            kind: WorkspaceKind::Main,
            parent_id: None,
            worktree: None,
            settings,
        }
    }

    fn spawn_test_runtime_process() -> (tokio::process::Child, String) {
        #[cfg(windows)]
        {
            let command_path = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string());
            let mut command = Command::new(&command_path);
            command.args(["/Q", "/K"]);
            command.stdin(Stdio::piped());
            command.stdout(Stdio::piped());
            command.stderr(Stdio::piped());
            let child = command
                .spawn()
                .unwrap_or_else(|error| panic!("failed to spawn {command_path}: {error}"));
            return (child, command_path);
        }

        #[cfg(not(windows))]
        {
            let command_path = "cat".to_string();
            let mut command = Command::new(&command_path);
            command.stdin(Stdio::piped());
            command.stdout(Stdio::piped());
            command.stderr(Stdio::piped());
            let child = command
                .spawn()
                .unwrap_or_else(|error| panic!("failed to spawn {command_path}: {error}"));
            return (child, command_path);
        }
    }

    async fn make_workspace_session(id: &str) -> Arc<WorkspaceSession> {
        let (mut child, resolved_bin) = spawn_test_runtime_process();
        let process_id = child.id();
        let stdin = child.stdin.take().expect("test child stdin");
        Arc::new(WorkspaceSession {
            entry: workspace_entry(id),
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            wrapper_kind: "direct".to_string(),
            resolved_bin,
            process_id,
            pending: Mutex::new(HashMap::new()),
            timed_out_requests: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            background_thread_callbacks: Mutex::new(HashMap::new()),
            thread_mode_state: crate::codex::thread_mode_state::ThreadModeState::default(),
            mode_enforcement_enabled: AtomicBool::new(false),
            collaboration_mode_supported: AtomicBool::new(false),
            plan_turn_state: Mutex::new(HashMap::new()),
            local_user_input_requests: Mutex::new(HashMap::new()),
            local_request_seq: AtomicU64::new(1),
            resume_pending_turns: Mutex::new(HashMap::new()),
            runtime_manager: StdMutex::new(None),
            active_turns: Mutex::new(HashMap::new()),
            manual_shutdown_requested: AtomicBool::new(false),
            shutdown_source: StdMutex::new(None),
            shutdown_had_active_work_protection: AtomicBool::new(false),
            runtime_end_emitted: AtomicBool::new(false),
        })
    }

    async fn dispose_workspace_session(session: &WorkspaceSession) {
        session.mark_manual_shutdown();
        let mut child = session.child.lock().await;
        let _ = child.kill().await;
        let _ = child.wait().await;
    }

    #[test]
    fn extract_thread_id_reads_camel_case() {
        let value = json!({ "params": { "threadId": "thread-123" } });
        assert_eq!(extract_thread_id(&value), Some("thread-123".to_string()));
    }

    #[test]
    fn extract_thread_id_reads_snake_case() {
        let value = json!({ "params": { "thread_id": "thread-456" } });
        assert_eq!(extract_thread_id(&value), Some("thread-456".to_string()));
    }

    #[test]
    fn extract_thread_id_reads_turn_nested_shape() {
        let value = json!({ "params": { "turn": { "threadId": "thread-turn-1" } } });
        assert_eq!(extract_thread_id(&value), Some("thread-turn-1".to_string()));
        let value = json!({ "params": { "turn": { "thread_id": "thread-turn-2" } } });
        assert_eq!(extract_thread_id(&value), Some("thread-turn-2".to_string()));
    }

    #[test]
    fn extract_thread_id_returns_none_when_missing() {
        let value = json!({ "params": {} });
        assert_eq!(extract_thread_id(&value), None);
    }

    #[test]
    fn extract_compaction_usage_percent_reads_token_count_last_payload() {
        let value = json!({
            "method": "token_count",
            "params": {
                "info": {
                    "last_token_usage": {
                        "input_tokens": 160000,
                        "cached_input_tokens": 40000,
                        "model_context_window": 200000
                    }
                }
            }
        });
        let percent = extract_compaction_usage_percent(&value).unwrap_or_default();
        assert!((percent - 100.0).abs() < 0.0001);
    }

    #[test]
    fn extract_compaction_usage_percent_returns_none_when_token_count_last_missing() {
        let value = json!({
            "method": "token_count",
            "params": {
                "info": {
                    "total_token_usage": {
                        "input_tokens": 160000,
                        "cached_input_tokens": 40000,
                        "model_context_window": 200000
                    }
                }
            }
        });
        assert!(extract_compaction_usage_percent(&value).is_none());
    }

    #[test]
    fn extract_compaction_usage_percent_prefers_last_token_count_snapshot() {
        let value = json!({
            "method": "token_count",
            "params": {
                "info": {
                    "total_token_usage": {
                        "input_tokens": 180000,
                        "cached_input_tokens": 0,
                        "model_context_window": 200000
                    },
                    "last_token_usage": {
                        "input_tokens": 20000,
                        "cached_input_tokens": 0,
                        "model_context_window": 200000
                    }
                }
            }
        });
        let percent = extract_compaction_usage_percent(&value).unwrap_or_default();
        assert!((percent - 10.0).abs() < 0.0001);
    }

    #[test]
    fn extract_compaction_usage_percent_reads_thread_last_usage_payload() {
        let value = json!({
            "method": "thread/tokenUsage/updated",
            "params": {
                "tokenUsage": {
                    "last": {
                        "inputTokens": 92000,
                        "cachedInputTokens": 0
                    },
                    "modelContextWindow": 100000
                }
            }
        });
        let percent = extract_compaction_usage_percent(&value).unwrap_or_default();
        assert!((percent - 92.0).abs() < 0.0001);
    }

    #[test]
    fn extract_compaction_usage_percent_returns_none_when_thread_last_missing() {
        let value = json!({
            "method": "thread/tokenUsage/updated",
            "params": {
                "tokenUsage": {
                    "total": {
                        "inputTokens": 92000,
                        "cachedInputTokens": 0
                    },
                    "modelContextWindow": 100000
                }
            }
        });
        assert!(extract_compaction_usage_percent(&value).is_none());
    }

    #[test]
    fn extract_compaction_usage_percent_prefers_thread_last_snapshot() {
        let value = json!({
            "method": "thread/tokenUsage/updated",
            "params": {
                "tokenUsage": {
                    "total": {
                        "inputTokens": 190000,
                        "cachedInputTokens": 0
                    },
                    "last": {
                        "inputTokens": 20000,
                        "cachedInputTokens": 0
                    },
                    "modelContextWindow": 200000
                }
            }
        });
        let percent = extract_compaction_usage_percent(&value).unwrap_or_default();
        assert!((percent - 10.0).abs() < 0.0001);
    }

    #[test]
    fn is_codex_thread_id_filters_non_codex_prefixes() {
        assert!(is_codex_thread_id("thread-1"));
        assert!(is_codex_thread_id("codex-abc"));
        assert!(!is_codex_thread_id("claude:session-1"));
        assert!(!is_codex_thread_id("claude-pending-1"));
        assert!(!is_codex_thread_id("opencode:session-1"));
        assert!(!is_codex_thread_id("gemini:session-1"));
        assert!(!is_codex_thread_id(""));
    }

    #[test]
    fn should_skip_codex_stderr_line_filters_rmcp_authrequired_noise() {
        let noisy_line = "\u{1b}[2m2026-04-14T05:38:37Z\u{1b}[0m \u{1b}[31mERROR\u{1b}[0m \u{1b}[2mrmcp::transport::worker\u{1b}[0m: worker quit with fatal: Transport channel closed, when AuthRequired(AuthRequiredError { www_authenticate_header: \"Bearer resource_metadata=https://mcp.stripe.com/.well-known/oauth-protected-resource\" })";
        assert!(should_skip_codex_stderr_line(noisy_line));
        assert!(should_skip_codex_stderr_line("   "));
        assert!(!should_skip_codex_stderr_line(
            "ERROR: git failed: fatal: not a git repository"
        ));
    }

    #[test]
    fn evaluate_auto_compaction_state_applies_processing_cooldown_and_trigger() {
        let mut state = AutoCompactionThreadState::default();

        assert!(!evaluate_auto_compaction_state(
            &mut state,
            "turn/started",
            Some(95.0),
            10_000,
        ));
        assert!(state.is_processing);
        assert!(!evaluate_auto_compaction_state(
            &mut state,
            "token_count",
            Some(95.0),
            20_000,
        ));
        assert!(!evaluate_auto_compaction_state(
            &mut state,
            "turn/completed",
            None,
            30_000,
        ));
        assert!(evaluate_auto_compaction_state(
            &mut state,
            "token_count",
            Some(95.0),
            100_000,
        ));
        assert!(state.in_flight);
        assert!(!evaluate_auto_compaction_state(
            &mut state,
            "token_count",
            Some(96.0),
            100_500,
        ));
        assert!(!evaluate_auto_compaction_state(
            &mut state,
            "thread/compacted",
            None,
            101_000,
        ));
        assert!(!evaluate_auto_compaction_state(
            &mut state,
            "token_count",
            Some(95.0),
            110_000,
        ));
        assert!(evaluate_auto_compaction_state(
            &mut state,
            "token_count",
            Some(95.0),
            200_000,
        ));
    }

    #[test]
    fn codex_args_override_instructions_detects_developer_instructions() {
        assert!(codex_args_override_instructions(Some(
            r#"-c developer_instructions="follow workspace policy""#
        )));
        assert!(codex_args_override_instructions(Some(
            r#"--config instructions="be concise""#
        )));
    }

    #[test]
    fn codex_args_override_instructions_ignores_unrelated_configs() {
        assert!(!codex_args_override_instructions(Some(
            r#"-c model="gpt-5.3-codex" --search"#
        )));
        assert!(!codex_args_override_instructions(None));
    }

    #[test]
    fn codex_external_spec_priority_config_arg_is_toml_quoted() {
        let arg = codex_external_spec_priority_config_arg();
        assert!(arg.starts_with("developer_instructions=\""));
        assert!(arg.ends_with('"'));
        assert!(arg.contains("writableRoots"));
    }

    #[test]
    fn build_late_turn_started_event_extracts_turn_identity() {
        let response = json!({
            "id": 9,
            "result": {
                "turn": {
                    "id": "turn-123",
                    "threadId": "thread-456"
                }
            }
        });

        let event = build_late_turn_started_event(&response).expect("late turn event");
        assert_eq!(
            event.get("method").and_then(Value::as_str),
            Some("turn/started")
        );
        assert_eq!(
            event
                .get("params")
                .and_then(|params| params.get("threadId"))
                .and_then(Value::as_str),
            Some("thread-456")
        );
        assert_eq!(
            event
                .get("params")
                .and_then(|params| params.get("turnId"))
                .and_then(Value::as_str),
            Some("turn-123")
        );
    }

    #[test]
    fn build_late_turn_error_event_extracts_thread_identity_and_message() {
        let response = json!({
            "id": 9,
            "error": {
                "message": "Upstream overloaded",
                "code": -32001
            }
        });
        let request = TimedOutRequest {
            method: "turn/start".to_string(),
            thread_id: Some("thread-456".to_string()),
            timed_out_at_ms: 0,
        };

        let event = build_late_turn_error_event(&response, &request).expect("late turn error");
        assert_eq!(
            event.get("method").and_then(Value::as_str),
            Some("turn/error")
        );
        assert_eq!(
            event
                .get("params")
                .and_then(|params| params.get("threadId"))
                .and_then(Value::as_str),
            Some("thread-456")
        );
        assert_eq!(
            event
                .get("params")
                .and_then(|params| params.get("error"))
                .and_then(|error| error.get("message"))
                .and_then(Value::as_str),
            Some("Upstream overloaded")
        );
        assert_eq!(
            event
                .get("params")
                .and_then(|params| params.get("willRetry"))
                .and_then(Value::as_bool),
            Some(false)
        );
    }

    #[test]
    fn build_late_turn_error_event_reads_nested_result_error_message() {
        let response = json!({
            "id": 9,
            "result": {
                "error": {
                    "message": "Late nested failure",
                    "code": -32002
                }
            }
        });
        let request = TimedOutRequest {
            method: "turn/start".to_string(),
            thread_id: Some("thread-789".to_string()),
            timed_out_at_ms: 0,
        };

        let event = build_late_turn_error_event(&response, &request).expect("late turn error");
        assert_eq!(
            event.get("method").and_then(Value::as_str),
            Some("turn/error")
        );
        assert_eq!(
            event
                .get("params")
                .and_then(|params| params.get("threadId"))
                .and_then(Value::as_str),
            Some("thread-789")
        );
        assert_eq!(
            event
                .get("params")
                .and_then(|params| params.get("error"))
                .and_then(|error| error.get("message"))
                .and_then(Value::as_str),
            Some("Late nested failure")
        );
    }

    #[tokio::test]
    async fn handle_runtime_end_emits_runtime_ended_and_settles_pending_state() {
        let session = make_workspace_session("runtime-ended-eof").await;
        let runtime_manager = Arc::new(RuntimeManager::new(&std::env::temp_dir()));
        runtime_manager
            .record_starting(&session.entry, "codex", "test")
            .await;
        runtime_manager
            .acquire_turn_lease(&session.entry, "codex", "turn:thread-1")
            .await;
        session.attach_runtime_manager(Arc::clone(&runtime_manager));
        session
            .record_runtime_event_activity(&json!({
                "method": "turn/started",
                "params": {
                    "threadId": "thread-stale",
                    "turnId": "turn-stale"
                }
            }))
            .await;
        session
            .record_runtime_event_activity(&json!({
                "method": "turn/completed",
                "params": {
                    "threadId": "thread-stale",
                    "turnId": "turn-stale"
                }
            }))
            .await;
        session
            .record_runtime_event_activity(&json!({
                "method": "turn/started",
                "params": {
                    "threadId": "thread-1",
                    "turnId": "turn-1"
                }
            }))
            .await;
        let (pending_tx, pending_rx) = oneshot::channel();
        session.pending.lock().await.insert(1, pending_tx);
        session
            .record_timed_out_request(2, "turn/start", Some("thread-2".to_string()))
            .await;
        let (callback_tx, _callback_rx) = mpsc::unbounded_channel();
        session
            .background_thread_callbacks
            .lock()
            .await
            .insert("thread-3".to_string(), callback_tx);

        let sink = TestEventSink::default();
        let message =
            "[RUNTIME_ENDED] Managed runtime stdout closed before the turn reached a terminal lifecycle event."
                .to_string();
        session
            .handle_runtime_end(&sink, "stdout_eof", message.clone(), None, None)
            .await;

        assert_eq!(
            pending_rx.await.expect("pending request should settle"),
            Err(message.clone())
        );
        assert!(session.pending.lock().await.is_empty());
        assert!(session.timed_out_requests.lock().await.is_empty());
        assert!(session.background_thread_callbacks.lock().await.is_empty());

        let events = sink.emitted_app_server_events();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].workspace_id, "runtime-ended-eof");
        assert_eq!(events[0].message["method"], "runtime/ended");
        assert_eq!(events[0].message["params"]["reasonCode"], "stdout_eof");
        assert_eq!(events[0].message["params"]["message"], message);
        assert_eq!(events[0].message["params"]["pendingRequestCount"], 2);
        assert_eq!(events[0].message["params"]["hadActiveLease"], true);
        assert_eq!(
            events[0].message["params"]["affectedTurnIds"],
            json!(["turn-1"])
        );
        assert_eq!(
            events[0].message["params"]["affectedActiveTurns"],
            json!([{ "threadId": "thread-1", "thread_id": "thread-1", "turnId": "turn-1", "turn_id": "turn-1" }])
        );
        let mut affected_threads = events[0].message["params"]["affectedThreadIds"]
            .as_array()
            .expect("affected thread ids array")
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect::<Vec<_>>();
        affected_threads.sort();
        assert_eq!(
            affected_threads,
            vec![
                "thread-1".to_string(),
                "thread-2".to_string(),
                "thread-3".to_string()
            ]
        );
        assert!(!affected_threads.contains(&"thread-stale".to_string()));

        let snapshot = runtime_manager.snapshot(&AppSettings::default()).await;
        let row = snapshot
            .rows
            .iter()
            .find(|item| item.workspace_id == "runtime-ended-eof")
            .expect("runtime row should exist");
        assert_eq!(row.last_exit_reason_code.as_deref(), Some("stdout_eof"));
        assert_eq!(row.last_exit_message.as_deref(), Some(message.as_str()));
        assert_eq!(row.last_exit_pending_request_count, 2);
        assert_eq!(row.turn_lease_count, 0);
        assert_eq!(row.stream_lease_count, 0);
        assert!(!row.active_work_protected);

        dispose_workspace_session(&session).await;
    }

    #[tokio::test]
    async fn handle_runtime_end_suppresses_event_when_internal_cleanup_has_no_affected_work() {
        let session = make_workspace_session("runtime-ended-internal-cleanup").await;
        let runtime_manager = Arc::new(RuntimeManager::new(&std::env::temp_dir()));
        runtime_manager
            .record_starting(&session.entry, "codex", "test")
            .await;
        session.attach_runtime_manager(Arc::clone(&runtime_manager));
        session.mark_shutdown_requested(RuntimeShutdownSource::InternalReplacement);

        let sink = TestEventSink::default();
        let message =
            "[RUNTIME_ENDED] Managed runtime stopped after manual shutdown (source: internal_replacement)."
                .to_string();
        session
            .handle_runtime_end(&sink, "manual_shutdown", message.clone(), None, None)
            .await;

        assert!(sink.emitted_app_server_events().is_empty());
        let snapshot = runtime_manager.snapshot(&AppSettings::default()).await;
        let row = snapshot
            .rows
            .iter()
            .find(|item| item.workspace_id == "runtime-ended-internal-cleanup")
            .expect("runtime diagnostics row should exist");
        assert_eq!(
            row.last_exit_reason_code.as_deref(),
            Some("manual_shutdown")
        );
        assert_eq!(row.last_exit_message.as_deref(), Some(message.as_str()));

        dispose_workspace_session(&session).await;
    }

    #[tokio::test]
    async fn handle_runtime_end_emits_shutdown_source_when_pending_work_is_affected() {
        let session = make_workspace_session("runtime-ended-source").await;
        let runtime_manager = Arc::new(RuntimeManager::new(&std::env::temp_dir()));
        runtime_manager
            .record_starting(&session.entry, "codex", "test")
            .await;
        session.attach_runtime_manager(Arc::clone(&runtime_manager));
        session.mark_shutdown_requested(RuntimeShutdownSource::ManualRelease);
        let (pending_tx, pending_rx) = oneshot::channel();
        session.pending.lock().await.insert(1, pending_tx);

        let sink = TestEventSink::default();
        let message =
            "[RUNTIME_ENDED] Managed runtime stopped after manual shutdown (source: manual_release)."
                .to_string();
        session
            .handle_runtime_end(&sink, "manual_shutdown", message.clone(), None, None)
            .await;

        assert_eq!(
            pending_rx.await.expect("pending request should settle"),
            Err(message.clone())
        );
        let events = sink.emitted_app_server_events();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].message["params"]["reasonCode"], "manual_shutdown");
        assert_eq!(
            events[0].message["params"]["shutdownSource"],
            "manual_release"
        );
        assert_eq!(events[0].message["params"]["pendingRequestCount"], 1);

        dispose_workspace_session(&session).await;
    }

    #[tokio::test]
    async fn handle_runtime_end_emits_when_runtime_manager_active_work_is_protected() {
        let session = make_workspace_session("runtime-ended-active-protected").await;
        let runtime_manager = Arc::new(RuntimeManager::new(&std::env::temp_dir()));
        runtime_manager.record_ready(&session, "test").await;
        runtime_manager
            .acquire_turn_lease(&session.entry, "codex", "turn:protected")
            .await;
        session.attach_runtime_manager(Arc::clone(&runtime_manager));

        let sink = TestEventSink::default();
        let message =
            "[RUNTIME_ENDED] Managed runtime process exited unexpectedly with code 9.".to_string();
        session
            .handle_runtime_end(&sink, "process_exit", message, Some(9), None)
            .await;

        let events = sink.emitted_app_server_events();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].message["params"]["reasonCode"], "process_exit");
        assert_eq!(events[0].message["params"]["pendingRequestCount"], 0);

        dispose_workspace_session(&session).await;
    }

    #[tokio::test]
    async fn handle_runtime_end_ignores_successor_active_work_for_stale_predecessor() {
        let original_session = make_workspace_session("runtime-ended-stale-predecessor").await;
        let successor_session = make_workspace_session("runtime-ended-stale-predecessor").await;
        let runtime_manager = Arc::new(RuntimeManager::new(&std::env::temp_dir()));
        runtime_manager
            .record_ready(&successor_session, "successor")
            .await;
        runtime_manager
            .acquire_turn_lease(&successor_session.entry, "codex", "turn:successor")
            .await;
        original_session.attach_runtime_manager(Arc::clone(&runtime_manager));
        original_session.mark_shutdown_requested(RuntimeShutdownSource::InternalReplacement);

        let sink = TestEventSink::default();
        let message =
            "[RUNTIME_ENDED] Managed runtime stopped after manual shutdown (source: internal_replacement)."
                .to_string();
        original_session
            .handle_runtime_end(&sink, "manual_shutdown", message, None, None)
            .await;

        assert!(sink.emitted_app_server_events().is_empty());
        let snapshot = runtime_manager.snapshot(&AppSettings::default()).await;
        let row = snapshot
            .rows
            .iter()
            .find(|item| item.workspace_id == "runtime-ended-stale-predecessor")
            .expect("successor runtime row should exist");
        assert_eq!(row.pid, successor_session.process_id);
        assert!(row.active_work_protected);
        assert!(row.last_exit_reason_code.is_none());

        dispose_workspace_session(&original_session).await;
        dispose_workspace_session(&successor_session).await;
    }

    #[tokio::test]
    async fn handle_runtime_end_emits_when_shutdown_started_with_foreground_work() {
        let session = make_workspace_session("runtime-ended-foreground-marker").await;
        session.mark_shutdown_requested(RuntimeShutdownSource::ManualRelease);
        session.mark_shutdown_had_active_work_protection();

        let sink = TestEventSink::default();
        let message =
            "[RUNTIME_ENDED] Managed runtime stopped after manual shutdown (source: manual_release)."
                .to_string();
        session
            .handle_runtime_end(&sink, "manual_shutdown", message, None, None)
            .await;

        let events = sink.emitted_app_server_events();
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].message["params"]["shutdownSource"],
            "manual_release"
        );

        dispose_workspace_session(&session).await;
    }

    #[tokio::test]
    async fn handle_runtime_end_is_idempotent_and_preserves_first_exit_metadata() {
        let session = make_workspace_session("runtime-ended-exit").await;
        let sink = TestEventSink::default();
        let (pending_tx, _pending_rx) = oneshot::channel();
        session.pending.lock().await.insert(1, pending_tx);

        session
            .handle_runtime_end(
                &sink,
                "process_exit",
                "[RUNTIME_ENDED] Managed runtime process exited unexpectedly with code 9."
                    .to_string(),
                Some(9),
                Some("15".to_string()),
            )
            .await;
        session
            .handle_runtime_end(
                &sink,
                "stdout_eof",
                "[RUNTIME_ENDED] Managed runtime stdout closed before the turn reached a terminal lifecycle event."
                    .to_string(),
                None,
                None,
            )
            .await;

        let events = sink.emitted_app_server_events();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].message["params"]["reasonCode"], "process_exit");
        assert_eq!(events[0].message["params"]["exitCode"], 9);
        assert_eq!(events[0].message["params"]["exitSignal"], "15");

        dispose_workspace_session(&session).await;
    }

    #[test]
    fn wrapper_kind_for_binary_labels_windows_wrappers() {
        assert_eq!(wrapper_kind_for_binary("codex"), "direct");
        assert_eq!(wrapper_kind_for_binary("C:/bin/codex.cmd"), "cmd-wrapper");
        assert_eq!(wrapper_kind_for_binary("C:/bin/codex.bat"), "bat-wrapper");
    }

    #[test]
    fn should_block_request_user_input_only_for_code_mode_when_enabled() {
        assert!(should_block_request_user_input(
            "item/tool/requestUserInput",
            Some("code"),
            true,
            true,
        ));
        assert!(!should_block_request_user_input(
            "item/tool/requestUserInput",
            Some("plan"),
            true,
            true,
        ));
        assert!(!should_block_request_user_input(
            "item/tool/requestUserInput",
            Some("code"),
            false,
            true,
        ));
        assert!(!should_block_request_user_input(
            "item/updated",
            Some("code"),
            true,
            true,
        ));
        assert!(!should_block_request_user_input(
            "item/tool/requestUserInput",
            Some("code"),
            true,
            false,
        ));
    }

    #[test]
    fn build_mode_blocked_event_has_required_params() {
        let event = build_mode_blocked_event(
            "thread-1",
            "item/tool/requestUserInput",
            "code",
            MODE_BLOCKED_REASON_CODE_REQUEST_USER_INPUT,
            MODE_BLOCKED_REASON,
            MODE_BLOCKED_SUGGESTION,
            Some(json!(91)),
        );
        assert_eq!(event["method"], "collaboration/modeBlocked");
        assert_eq!(event["params"]["threadId"], "thread-1");
        assert_eq!(event["params"]["thread_id"], "thread-1");
        assert_eq!(
            event["params"]["blockedMethod"],
            "item/tool/requestUserInput"
        );
        assert_eq!(
            event["params"]["blocked_method"],
            "item/tool/requestUserInput"
        );
        assert_eq!(event["params"]["effectiveMode"], "code");
        assert_eq!(event["params"]["effective_mode"], "code");
        assert_eq!(
            event["params"]["reasonCode"],
            "request_user_input_blocked_in_default_mode"
        );
        assert_eq!(
            event["params"]["reason_code"],
            "request_user_input_blocked_in_default_mode"
        );
        assert_eq!(
            event["params"]["reason"],
            "requestUserInput is blocked while effective_mode=code"
        );
        assert_eq!(event["params"]["requestId"], 91);
        assert_eq!(event["params"]["request_id"], 91);
    }

    #[test]
    fn normalize_command_tokens_from_item_supports_string_and_array() {
        let string_item = json!({
            "command": "git push origin main"
        });
        assert_eq!(
            normalize_command_tokens_from_item(&string_item),
            vec!["git", "push", "origin", "main"]
        );
        let array_item = json!({
            "command": ["git", "commit", "-m", "msg"]
        });
        assert_eq!(
            normalize_command_tokens_from_item(&array_item),
            vec!["git", "commit", "-m", "msg"]
        );
    }

    #[test]
    fn is_repo_mutating_command_tokens_detects_git_write_actions() {
        assert!(is_repo_mutating_command_tokens(
            &["git", "push", "origin", "main"]
                .iter()
                .map(|value| value.to_string())
                .collect::<Vec<_>>()
        ));
        assert!(is_repo_mutating_command_tokens(
            &["git", "commit", "-m", "msg"]
                .iter()
                .map(|value| value.to_string())
                .collect::<Vec<_>>()
        ));
        assert!(!is_repo_mutating_command_tokens(
            &["git", "status"]
                .iter()
                .map(|value| value.to_string())
                .collect::<Vec<_>>()
        ));
        assert!(!is_repo_mutating_command_tokens(
            &["rg", "--files"]
                .iter()
                .map(|value| value.to_string())
                .collect::<Vec<_>>()
        ));
    }

    #[test]
    fn detect_repo_mutating_blocked_method_detects_apply_patch_and_git_push() {
        let patch_event = json!({
            "method": "item/started",
            "params": {
                "threadId": "thread-1",
                "item": {
                    "id": "tool-1",
                    "type": "apply_patch"
                }
            }
        });
        assert_eq!(
            detect_repo_mutating_blocked_method(&patch_event),
            Some("item/tool/apply_patch".to_string())
        );

        let git_push_event = json!({
            "method": "item/started",
            "params": {
                "threadId": "thread-1",
                "item": {
                    "id": "tool-2",
                    "type": "commandExecution",
                    "command": ["git", "push", "origin", "main"]
                }
            }
        });
        assert_eq!(
            detect_repo_mutating_blocked_method(&git_push_event),
            Some("item/tool/commandExecution:git push origin main".to_string())
        );

        let read_only_event = json!({
            "method": "item/started",
            "params": {
                "threadId": "thread-1",
                "item": {
                    "id": "tool-3",
                    "type": "commandExecution",
                    "command": ["git", "status"]
                }
            }
        });
        assert_eq!(detect_repo_mutating_blocked_method(&read_only_event), None);
    }

    #[test]
    fn detect_repo_mutating_blocked_method_detects_item_request_approval_events() {
        let file_change_approval_event = json!({
            "method": "item/fileChange/requestApproval",
            "id": "req-1",
            "params": {
                "threadId": "thread-1"
            }
        });
        assert_eq!(
            detect_repo_mutating_blocked_method(&file_change_approval_event),
            Some("item/fileChange/requestApproval".to_string())
        );

        let command_approval_event = json!({
            "method": "item/commandExecution/requestApproval",
            "id": "req-2",
            "params": {
                "threadId": "thread-1"
            }
        });
        assert_eq!(
            detect_repo_mutating_blocked_method(&command_approval_event),
            Some("item/commandExecution/requestApproval".to_string())
        );
    }

    #[test]
    fn build_mode_blocked_event_for_plan_contains_standard_reason_code_and_suggestion() {
        let event = build_mode_blocked_event(
            "thread-plan-1",
            "item/tool/commandExecution:git push origin main",
            "plan",
            MODE_BLOCKED_REASON_CODE_PLAN_READONLY,
            MODE_BLOCKED_PLAN_REASON,
            MODE_BLOCKED_PLAN_SUGGESTION,
            None,
        );
        assert_eq!(event["method"], "collaboration/modeBlocked");
        assert_eq!(event["params"]["effectiveMode"], "plan");
        assert_eq!(event["params"]["reasonCode"], "plan_readonly_violation");
        assert_eq!(
            event["params"]["suggestion"],
            "Switch to Default mode and retry the write operation."
        );
    }

    #[test]
    fn detect_plan_blocker_reason_matches_not_git_repo_marker() {
        let event = json!({
            "method": "item/completed",
            "params": {
                "threadId": "thread-1",
                "item": {
                    "status": "completed",
                    "result": "NOT_GIT_REPO"
                }
            }
        });
        assert_eq!(
            detect_plan_blocker_reason(&event),
            Some("当前目录不是 Git 仓库，无法基于真实代码上下文继续计划。")
        );
    }

    #[test]
    fn detect_plan_blocker_reason_matches_missing_context_marker() {
        let event = json!({
            "method": "item/completed",
            "params": {
                "threadId": "thread-1",
                "item": {
                    "status": "completed",
                    "error": "No such file or directory: /tmp/not-found"
                }
            }
        });
        assert_eq!(
            detect_plan_blocker_reason(&event),
            Some("Plan 模式下发现关键路径或上下文缺失，继续推进前需要你确认范围与目标位置。")
        );
    }

    #[test]
    fn detect_plan_blocker_reason_matches_semantic_assistant_blocker_text() {
        let event = json!({
            "method": "item/completed",
            "params": {
                "threadId": "thread-1",
                "item": {
                    "type": "agentMessage",
                    "status": "completed",
                    "text": "出现一个阻塞：当前仓库只有 docs/，没有 src/。我先发一个选项问题，等你选择后再继续。"
                }
            }
        });
        assert_eq!(
            detect_plan_blocker_reason(&event),
            Some("Plan 模式检测到阻断条件，需要你先确认下一步后再继续。")
        );
    }

    #[test]
    fn detect_plan_blocker_reason_matches_agent_delta_blocker_text() {
        let event = json!({
            "method": "item/agentMessage/delta",
            "params": {
                "threadId": "thread-1",
                "delta": "出现一个阻塞：没有 src。需要你确认，我先发一个选项问题。"
            }
        });
        assert_eq!(detect_plan_blocker_reason(&event), None);
    }

    #[test]
    fn detect_plan_blocker_reason_matches_turn_completed_result_text() {
        let event = json!({
            "method": "turn/completed",
            "params": {
                "threadId": "thread-1",
                "result": {
                    "summary": "当前仓库只有 docs/plans，还没看到前端源码，无法把计划精确落地。下一步先发一个选项问题。"
                }
            }
        });
        assert_eq!(
            detect_plan_blocker_reason(&event),
            Some("Plan 模式检测到阻断条件，需要你先确认下一步后再继续。")
        );
    }

    #[test]
    fn detect_plan_blocker_reason_matches_turn_completed_turn_payload_text() {
        let event = json!({
            "method": "turn/completed",
            "params": {
                "threadId": "thread-1",
                "turn": {
                    "id": "turn-1",
                    "status": "completed",
                    "items": [{
                        "type": "agentMessage",
                        "text": "当前仓库只有 design.md，没有可执行前端代码文件，计划无法基于真实文件落地。先给你选项确认下一步。"
                    }]
                }
            }
        });
        assert_eq!(
            detect_plan_blocker_reason(&event),
            Some("Plan 模式检测到阻断条件，需要你先确认下一步后再继续。")
        );
    }

    #[test]
    fn detect_plan_blocker_reason_matches_turn_completed_followup_question_text() {
        let event = json!({
            "method": "turn/completed",
            "params": {
                "threadId": "thread-1",
                "result": {
                    "summary": "我还不知道你的出生日期，所以现在算不出来。请把你的出生年月日发我，我可以继续。"
                }
            }
        });
        assert_eq!(
            detect_plan_blocker_reason(&event),
            Some("Plan 模式检测到需要你补充关键信息，继续前请先确认输入。")
        );
    }

    #[test]
    fn looks_like_plan_blocker_prompt_matches_docs_without_src_style() {
        let text = "我已确认仓库当前只有 docs/plans 下的一份规划文档，还没看到前端源码；下一步先按你的规范检查 .claude/.codex/openspec。";
        assert!(looks_like_plan_blocker_prompt(text));
    }

    #[test]
    fn looks_like_plan_blocker_prompt_matches_key_blocker_phrase_from_ui() {
        let text = "我定位到一个关键阻塞：仓库里目前只有 docs/plans/2026-03-02-csv-export.md，没有前端源码目录（如 src/），因此无法给出基于真实文件的落地计划。先发一个选项让你决定下一步。";
        assert!(looks_like_plan_blocker_prompt(text));
    }

    #[test]
    fn looks_like_plan_blocker_prompt_matches_git_metadata_without_frontend_text() {
        let text =
            "我刚定位到一个阻塞点：当前工作区几乎只有 .git 元数据，没有看到任何前端实现目录。";
        assert!(looks_like_plan_blocker_prompt(text));
    }

    #[test]
    fn looks_like_plan_blocker_prompt_matches_missing_frontend_without_blocker_word() {
        let text = "当前仓库只有 design.md，没有可执行前端代码文件，计划无法基于真实代码落地。";
        assert!(looks_like_plan_blocker_prompt(text));
    }

    #[test]
    fn looks_like_executable_plan_text_matches_structured_plan_content() {
        let text = "实施计划：\n1. 定位导出入口\n2. 补充 CSV 下载逻辑\n3. 增加回归测试\n测试点：验证导出文件头与空态处理";
        assert!(looks_like_executable_plan_text(text));
    }

    #[test]
    fn looks_like_executable_plan_text_rejects_blocker_only_text() {
        let text = "当前仓库只有 design.md，没有可执行前端代码文件。";
        assert!(!looks_like_executable_plan_text(text));
    }

    #[test]
    fn extract_plan_step_count_reads_plan_updated_payload() {
        let event = json!({
            "method": "turn/plan/updated",
            "params": {
                "threadId": "thread-1",
                "plan": [
                    { "step": "Inspect", "status": "in_progress" },
                    { "step": "Implement", "status": "pending" }
                ]
            }
        });
        assert_eq!(extract_plan_step_count(&event), 2);
    }

    #[test]
    fn is_plan_blocker_stream_method_matches_reasoning_variants() {
        assert!(is_plan_blocker_stream_method("item/agentMessage/delta"));
        assert!(is_plan_blocker_stream_method("item/reasoning/textDelta"));
        assert!(is_plan_blocker_stream_method("item/reasoning/delta"));
        assert!(is_plan_blocker_stream_method(
            "item/reasoning/summaryTextDelta"
        ));
        assert!(!is_plan_blocker_stream_method(
            "item/reasoning/summaryPartAdded"
        ));
    }

    #[test]
    fn extract_stream_delta_text_reads_reasoning_delta_payload() {
        let event = json!({
            "method": "item/reasoning/textDelta",
            "params": {
                "threadId": "thread-1",
                "itemId": "item-1",
                "delta": "我刚定位到一个阻塞点：当前工作区几乎只有 .git 元数据。"
            }
        });
        assert_eq!(
            extract_stream_delta_text(&event),
            Some("我刚定位到一个阻塞点：当前工作区几乎只有 .git 元数据。".to_string())
        );
    }

    #[test]
    fn looks_like_user_info_followup_prompt_matches_age_question() {
        let text = "我还不知道你的出生日期。请把你的出生年月日发我，我就能继续。";
        assert!(looks_like_user_info_followup_prompt(text));
    }

    #[test]
    fn build_plan_blocker_user_input_event_has_questions() {
        let event = build_plan_blocker_user_input_event(
            "thread-1",
            Some("turn-1"),
            "ccgui-plan-blocker:1",
            "当前目录不是 Git 仓库，无法基于真实代码上下文继续计划。",
        );
        assert_eq!(event["method"], "item/tool/requestUserInput");
        assert_eq!(event["id"], "ccgui-plan-blocker:1");
        assert_eq!(event["params"]["threadId"], "thread-1");
        assert_eq!(event["params"]["turnId"], "turn-1");
        assert_eq!(
            event["params"]["questions"][0]["id"],
            "plan_blocker_resolution"
        );
    }

    #[test]
    fn build_plan_blocker_user_input_event_uses_generic_options_for_non_repo_reason() {
        let event = build_plan_blocker_user_input_event(
            "thread-1",
            Some("turn-1"),
            "ccgui-plan-blocker:2",
            "Plan 模式检测到需要你补充关键信息，继续前请先确认输入。",
        );
        assert_eq!(
            event["params"]["questions"][0]["options"][0]["label"],
            "直接补充关键信息 (Recommended)"
        );
    }

    #[test]
    fn plan_turn_state_default_has_no_synthetic_block() {
        let state = PlanTurnState::default();
        assert!(!state.synthetic_block_active);
        assert!(!state.has_user_input_request);
        assert!(state.active_turn_id.is_none());
    }

    #[test]
    fn visible_console_fallback_env_parser_accepts_supported_values() {
        assert!(visible_console_fallback_enabled_from_env(Some("1")));
        assert!(visible_console_fallback_enabled_from_env(Some("true")));
    }

    #[test]
    fn visible_console_fallback_env_parser_rejects_other_values() {
        assert!(!visible_console_fallback_enabled_from_env(None));
        assert!(!visible_console_fallback_enabled_from_env(Some("0")));
        assert!(!visible_console_fallback_enabled_from_env(Some("false")));
        assert!(!visible_console_fallback_enabled_from_env(Some("TRUE")));
        assert!(!visible_console_fallback_enabled_from_env(Some(" true ")));
    }
}
