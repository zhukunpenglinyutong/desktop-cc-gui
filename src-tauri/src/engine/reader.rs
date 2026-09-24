//! Stdout reader and per-turn streaming state: the capped line reader,
//! event dispatch core, and settle/cleanup path for engine process runs.

use super::codex_usage;
use super::events::{EngineEvent, TaskSummary};
#[cfg(test)]
use super::grok;
#[cfg(windows)]
use super::job;
use super::registry::{kill_process_group, ProcessRegistry};
use super::Engine;
use crate::event_sink;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
#[cfg(test)]
use tokio::process::Command;
use tokio::process::{Child, ChildStderr, ChildStdout};
use tokio::sync::Mutex as TokioMutex;

/// Grace between a Stop kill and force-aborting the reader task. A healthy
/// settle (kill → EOF → wait → terminal event) finishes in milliseconds;
/// the abort only fires when a killed child still won't die and the reader
/// would otherwise park on `wait()` forever.
pub(crate) const READER_SETTLE_GRACE: std::time::Duration = std::time::Duration::from_secs(10);
/// Silence timeout for draining the stdout pipe after the child exits. The
/// bytes the CLI wrote before dying are already buffered by the OS, so a
/// read either completes immediately or never will: a background
/// grandchild that inherited the pipe keeps it open with nothing to say.
/// Bounded by silence rather than EOF, the reader settles the run instead
/// of parking on the grandchild forever (which leaked the run's registry
/// entries — ps shows no process, yet the concurrency gate stays full).
pub(crate) const POST_EXIT_DRAIN: std::time::Duration = std::time::Duration::from_millis(200);
/// Grace after the last background task settles before stdin is closed: the
/// CLI answers a finished background task with one more turn (its completion
/// note), and EOF-ing stdin first truncates that turn mid-generation.
const BACKGROUND_GRACE: std::time::Duration = std::time::Duration::from_secs(30);
/// Silence bound while background tasks are still live but have gone quiet.
/// The read loop re-arms it from NOW on every task frame, so it bounds how
/// long the run may sit with no task activity — not how long the process may
/// live: a task that keeps reporting (or the completion turn it triggers)
/// extends the run past this. ccgui no longer lets the CLI's own wind-down
/// sweep live tasks (stdin stays open while they run), so this is the only
/// lever left on a task that wedges without ever emitting a final frame.
const BACKGROUND_STALL: std::time::Duration = std::time::Duration::from_secs(30 * 60);
/// Absolute wall-clock bound on one background phase, measured from its
/// first pending task. BACKGROUND_STALL re-arms on every task/content frame
/// — deliberately, so live work is never cut — but a CLI that wedges into a
/// heartbeat loop must not pin stdin, the process, and a concurrency slot
/// forever. Four hours is far past any task the CLI reports (before this
/// lifecycle change its own wind-down swept them at ~10 minutes).
const BACKGROUND_ABS_CAP: std::time::Duration = std::time::Duration::from_secs(4 * 60 * 60);
/// Hard cap on one NDJSON line from an engine. Real events are kilobytes;
/// `BufReader::lines` has no limit, so a runaway engine writing without
/// newlines would buffer the line whole and OOM the host.
pub(crate) const MAX_LINE_BYTES: usize = 16 * 1024 * 1024;
/// Stdin payload writer: engines consuming stream-json stdin get the payload,
/// then EOF (drop closes the pipe) — unless `keep_open`, where the handle is
/// returned instead so control responses can follow on the same pipe.
pub(crate) fn spawn_stdin_writer(
    child: &mut Child,
    payload: Option<String>,
    keep_open: bool,
) -> Option<Arc<TokioMutex<Option<tokio::process::ChildStdin>>>> {
    if !keep_open {
        let Some(payload) = payload else {
            return None;
        };
        if let Some(mut stdin) = child.stdin.take() {
            tokio::spawn(async move {
                let _ = stdin.write_all(payload.as_bytes()).await;
                let _ = stdin.write_all(b"\n").await;
                // drop closes stdin -> EOF
            });
        }
        return None;
    }
    let keep = Arc::new(TokioMutex::new(child.stdin.take()));
    if let Some(payload) = payload {
        let handle = Arc::clone(&keep);
        tokio::spawn(async move {
            let mut guard = handle.lock().await;
            if let Some(stdin) = guard.as_mut() {
                let _ = stdin.write_all(payload.as_bytes()).await;
                let _ = stdin.write_all(b"\n").await;
            }
        });
    }
    Some(keep)
}
/// Diagnostics ring: keeps the last 4KB for the error banner.
pub(crate) fn ring_push(buf: &Arc<Mutex<String>>, text: &str) {
    const CAP: usize = 4096;
    let mut guard = match buf.lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    guard.push_str(text);
    if guard.len() > CAP {
        // drain panics on a non-char-boundary start — snap forward. The old
        // stderr ring could panic mid-CJK here, silently killing the
        // capture task and starving the error banner of the failure text.
        let mut keep = guard.len() - CAP;
        while !guard.is_char_boundary(keep) {
            keep += 1;
        }
        guard.drain(..keep);
    }
}
/// Stderr capture ring: keeps the last 4KB for the error banner.
pub(crate) fn spawn_stderr_capture(stderr: ChildStderr) -> Arc<Mutex<String>> {
    let buf = Arc::new(Mutex::new(String::new()));
    let target = Arc::clone(&buf);
    tokio::spawn(async move {
        let mut reader = BufReader::new(stderr);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line).await {
                Ok(0) | Err(_) => break,
                Ok(_) => ring_push(&target, &line),
            }
        }
    });
    buf
}
// ==================== stderr redaction ====================

/// Engine stderr can echo the channel credentials from the CLI's own config files; redact credential
/// shapes before the tail is shown to the user in an error banner.
pub(super) fn redact_secrets(text: &str) -> String {
    use std::sync::LazyLock;
    static PATTERNS: LazyLock<Vec<regex::Regex>> = LazyLock::new(|| {
        [
            r"(?i)sk-[A-Za-z0-9_-]+",
            r"(?i)bearer\s+\S+",
            r"(?i)api[_-]?key\s*[=:]\s*\S+",
            r"(?i)token\s*[=:]\s*\S+",
        ]
        .iter()
        .filter_map(|p| regex::Regex::new(p).ok())
        .collect()
    });
    let mut out = text.to_string();
    for pattern in PATTERNS.iter() {
        out = pattern.replace_all(&out, "***").into_owned();
    }
    out
}
/// Mutable per-run streaming state shared by the reader loop's dispatch.
pub(crate) struct TurnState {
    seq: u64,
    pub(crate) native_session_id: Option<String>,
    pub(crate) saw_done: bool,
    pub(crate) saw_error: bool,
    attempt_error: Option<String>,
    // NOTE: TurnState lives for the whole process (one run_reader per
    // spawn), so once saw_error is set every later event in this process
    // is suppressed. That is correct for the current one-process-per-turn
    // engines (omp --print, codex exec); a future multi-turn-per-process
    // engine must reset this per turn instead.
    saw_any_output: bool,
    pending_terminal: Option<(String, Value)>,
    exit_confirmed: bool,
    /// Start of the model-generation window currently open, if any.
    gen_open_since: Option<Instant>,
    /// The open window was opened by an explicit start marker
    /// (`Generation{active:true}`), so only an explicit end / usage report
    /// may close it — tool rows stream inside such a response.
    gen_explicit: bool,
    /// Generation milliseconds closed but not yet attached to a usage report.
    gen_ms: u64,
    /// Content-bearing frames (delta/thinking/message) of the CURRENT turn.
    /// A `done` that closes a turn with none of them is not a reply ending:
    /// the CLI ran a turn it had queued itself — the resume-time
    /// reconciliation task notification it emits for a previous process's
    /// still-running tasks — while the message the user actually sent sits
    /// behind it. Treating that done as terminal suppressed the real turn's
    /// frames (the "reply never shows in the UI" report), so such a done
    /// leaves the run open (see the Done arm).
    pub(crate) saw_content: bool,
    /// Live background tasks of this run (claude task frames). While non-empty
    /// after a `done`, the reader keeps the CLI's stdin open so its wind-down
    /// cannot sweep them, and lets the follow-up completion turn through.
    /// Holds only the tasks this run waits for: ambient (session-scoped) ones
    /// arrive in the same frames but never finish inside a turn, so counting
    /// them would hold stdin open on every turn end of a session that has one.
    pub(crate) pending_tasks: std::collections::HashMap<String, TaskSummary>,
    /// A `done` arrived while background tasks were still running: the reply
    /// has settled but the run is not terminal until they finish and the CLI's
    /// follow-up turn (if any) ends.
    pub(crate) awaiting_tasks: bool,
    /// When set, the read loop closes stdin once this instant passes.
    pub(crate) close_deadline: Option<tokio::time::Instant>,
    /// Pending tasks inserted from a `task_started` frame that no
    /// `background_tasks_changed` level frame has vouched for yet. The start
    /// frame carries no ambient flag, so a session-scoped task can sit here
    /// until the next REPLACE evicts it; while an id is in this set its
    /// progress frames do NOT re-arm the stall bound, or a stranded ambient
    /// heartbeat would defer stdin closure forever.
    pub(crate) pending_unconfirmed: std::collections::HashSet<String>,
    /// First instant of the current background phase (its first pending
    /// task). Caps every re-armed deadline at BACKGROUND_ABS_CAP from this
    /// point; reset when the pending set empties.
    pub(crate) bg_phase_started: Option<tokio::time::Instant>,
}
impl TurnState {
    pub(crate) fn new(preassigned: Option<String>) -> Self {
        Self {
            seq: 0,
            native_session_id: preassigned,
            saw_done: false,
            saw_error: false,
            attempt_error: None,
            saw_any_output: false,
            pending_terminal: None,
            exit_confirmed: false,
            gen_open_since: None,
            gen_explicit: false,
            gen_ms: 0,
            saw_content: false,
            pending_tasks: std::collections::HashMap::new(),
            awaiting_tasks: false,
            close_deadline: None,
            pending_unconfirmed: std::collections::HashSet::new(),
            bg_phase_started: None,
        }
    }

    fn push(
        &mut self,
        sink: &Arc<event_sink::EventSink>,
        run_id: &str,
        engine_id: &str,
        kind: &str,
        data: Value,
    ) {
        self.push_meta(sink, run_id, engine_id, kind, data, None)
    }

    /// Push a usage/done report carrying the measured generation window.
    fn push_with_gen_ms(
        &mut self,
        sink: &Arc<event_sink::EventSink>,
        run_id: &str,
        engine_id: &str,
        kind: &str,
        data: Value,
        gen_ms: Option<u64>,
    ) {
        self.push_meta(sink, run_id, engine_id, kind, data, gen_ms)
    }

    fn push_meta(
        &mut self,
        sink: &Arc<event_sink::EventSink>,
        run_id: &str,
        engine_id: &str,
        kind: &str,
        data: Value,
        gen_ms: Option<u64>,
    ) {
        if !self.exit_confirmed
            && run_id.starts_with("pa-")
            && matches!(engine_id, "pi" | "codex")
            && matches!(kind, "done" | "error")
        {
            self.pending_terminal = Some((kind.to_string(), data));
            return;
        }
        self.seq += 1;
        let mut payload = serde_json::json!({
            "runId": run_id,
            "sessionId": self.native_session_id,
            "engine": engine_id,
            "seq": self.seq,
            "kind": kind,
            "data": data,
            // Emit-side timestamp (Unix ms): plugins compute throughput from
            // consecutive reports; arrival time would add IPC batching jitter.
            "ts": std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0),
        });
        if let Some(gen_ms) = gen_ms {
            // Measured generation window (stream open → close, tool execution
            // excluded) for the report that just landed. Absent on every
            // report the host could not time; consumers fall back to
            // consecutive-report timing in that case.
            payload["genMs"] = Value::from(gen_ms);
        }
        sink.push(payload);
    }

    /// Mark the model as generating: opens the window when none is open.
    /// `explicit` records an engine-provided start marker (message_start),
    /// which only an explicit end or a usage report may close.
    fn gen_begin(&mut self, explicit: bool) {
        if self.gen_open_since.is_none() {
            self.gen_open_since = Some(Instant::now());
            self.gen_explicit = explicit;
        }
    }

    /// Close the open window, accumulating its span.
    fn gen_end(&mut self) {
        if let Some(since) = self.gen_open_since.take() {
            self.gen_ms += since.elapsed().as_millis() as u64;
        }
        self.gen_explicit = false;
    }

    /// Close the open window and consume the accumulated span as this
    /// report's `genMs`. None when nothing measurable was collected, so the
    /// consumer keeps its report-to-report fallback.
    fn take_gen_ms(&mut self) -> Option<u64> {
        self.gen_end();
        let ms = std::mem::take(&mut self.gen_ms);
        (ms > 0).then_some(ms)
    }

    pub(crate) fn confirm_exit(&mut self, core: &TurnCore) {
        self.exit_confirmed = true;
        if let Some((kind, data)) = self.pending_terminal.take() {
            self.push(&core.sink, &core.run_id, &core.engine_id, &kind, data);
        }
    }
}

/// A task-lifecycle frame: panel state for the run's background work, not
/// content of a turn — it is forwarded even after done/error.
fn is_task_event(event: &EngineEvent) -> bool {
    matches!(
        event,
        EngineEvent::TaskStarted { .. }
            | EngineEvent::TaskProgress { .. }
            | EngineEvent::TaskNotification { .. }
            | EngineEvent::TasksChanged { .. }
    )
}

/// Frames of the CLI's follow-up turn, which begins once the run's background
/// tasks finish. Only content-bearing frames (plus the turn's own done and its
/// usage/model tails) may reopen a settled-but-awaiting run.
fn continues_after_done(event: &EngineEvent) -> bool {
    matches!(
        event,
        EngineEvent::Delta(_)
            | EngineEvent::Thinking(_)
            | EngineEvent::Message { .. }
            | EngineEvent::Done { .. }
            | EngineEvent::Usage(_)
            | EngineEvent::Model(_)
    )
}

/// Whether a post-terminal event must be dropped. Task frames always pass;
/// SessionId keeps its historical exception; while awaiting tasks the
/// follow-up turn passes; everything else stays suppressed (terminal monotonic).
fn suppressed_after_terminal(state: &TurnState, event: &EngineEvent) -> bool {
    if matches!(event, EngineEvent::SessionId(_)) || is_task_event(event) {
        return false;
    }
    if state.saw_error {
        return true;
    }
    if !state.saw_done {
        return false;
    }
    !(state.awaiting_tasks && continues_after_done(event))
}

/// Recompute the stdin-close deadline from the run's current phase:
/// - settled reply still awaiting its background phase (`saw_done &&
///   awaiting`): the 30s grace once nothing is pending — room for the CLI's
///   completion turn to start — and the 30-minute silence bound while tasks
///   are live;
/// - a turn still open with live background tasks: the 30-minute silence
///   bound, re-armed by task frames AND by the turn's own content frames,
///   so a long follow-up/user turn is never EOF'd mid-generation;
/// - anything else (an active turn with nothing pending): no deadline, the
///   pre-background lifecycle behavior.
/// A deadline is never set past BACKGROUND_ABS_CAP from the phase's first
/// task, so a heartbeat-looping CLI cannot pin the run forever.
fn refresh_close_deadline(state: &mut TurnState, now: tokio::time::Instant) {
    if state.pending_tasks.is_empty() {
        state.bg_phase_started = None;
        state.close_deadline = if state.saw_done && state.awaiting_tasks {
            Some(now + BACKGROUND_GRACE)
        } else {
            None
        };
        return;
    }
    let phase_start = *state.bg_phase_started.get_or_insert(now);
    state.close_deadline =
        Some((now + BACKGROUND_STALL).min(phase_start + BACKGROUND_ABS_CAP));
}
/// Final level frame for a run that dies with tasks still pending. `saw_done`
/// is already true (the reply settled, its background phase was still open), so
/// no terminal event is synthesized and the frontend would keep every running
/// row until its 30-minute orphan sweep. An empty `tasks` frame is REPLACE
/// semantics: the live set is now empty, so the panel settles those rows as
/// stopped on the spot. No-op when nothing is pending.
fn push_final_task_frame(state: &mut TurnState, core: &TurnCore) {
    if state.pending_tasks.is_empty() {
        return;
    }
    state.pending_tasks.clear();
    state.push(
        &core.sink,
        &core.run_id,
        &core.engine_id,
        "tasks",
        serde_json::json!({ "tasks": [] }),
    );
}

/// Event-routing core shared by process runs ([`RunContext`]) and virtual
/// host-stream runs ([`dsh_session::run_host_turn`]): the fields
/// `dispatch_event` needs to route engine events to the UI sink and keep the
/// registry's session aliasing in step.
pub(crate) struct TurnCore {
    pub(crate) sink: Arc<event_sink::EventSink>,
    pub(crate) registry: Arc<ProcessRegistry>,
    pub(crate) engine_id: String,
    pub(crate) run_id: String,
}
impl TurnCore {
    /// Adopt a native session id: rekey the registry entry (no overwrite) and
    /// remember it for subsequent event payloads.
    fn adopt_session_id(&self, state: &mut TurnState, id: &str, announce: bool) {
        if state.native_session_id.as_deref() == Some(id) {
            return;
        }
        state.native_session_id = Some(id.to_string());
        self.registry.rekey(&self.run_id, id.to_string());
        if announce {
            state.push(
                &self.sink,
                &self.run_id,
                &self.engine_id,
                "session",
                Value::String(id.to_string()),
            );
        }
    }

    pub(crate) fn dispatch_event(&self, state: &mut TurnState, event: EngineEvent) {
        // Terminal state is monotonic for turn CONTENT — but a run with live
        // background tasks is not terminal yet: its task frames are panel
        // state, and the CLI's completion turn arrives after the reply's done.
        // The legacy SessionId exception stays (a done racing the CLI's
        // session announcement must still rekey the conversation).
        if suppressed_after_terminal(state, &event) {
            return;
        }
        if state.saw_done && state.awaiting_tasks && !is_task_event(&event) {
            // The follow-up turn starts inside this process: reopen the run.
            // ANY non-task frame counts as its start, not just content — the
            // CLI may open with a preamble (usage/model tails, a re-announced
            // session) before its first token, and the 30s grace armed for its
            // arrival would otherwise EOF stdin into the middle of the turn.
            // (Terminal kinds that stay suppressed, retry/warn/error, never
            // reach here: suppressed_after_terminal drops them above.)
            state.saw_done = false;
            state.awaiting_tasks = false;
            if state.pending_tasks.is_empty() {
                // Nothing left to bound this phase — but a lone preamble
                // frame (a late SessionId racing the done, a usage tail) is
                // not proof a real turn follows. Keep a bounded fallback: the
                // turn's first content frame clears it via the renewal below,
                // while a stray frame lets the stall bound close stdin
                // instead of stranding the run open forever.
                state.close_deadline =
                    Some(tokio::time::Instant::now() + BACKGROUND_STALL);
            } else {
                // Tasks still pending: re-arm the (capped) stall bound — not
                // the 30s grace, which would EOF stdin into the turn's
                // preamble. A follow-up turn that wedges before its done must
                // not pin stdin, the process, and its concurrency slot.
                refresh_close_deadline(state, tokio::time::Instant::now());
            }
        }
        // Track content per turn: the Done arm uses it to tell a real reply
        // ending from a queued notification-only turn (see `saw_content`).
        if matches!(
            event,
            EngineEvent::Delta(_) | EngineEvent::Thinking(_) | EngineEvent::Message { .. }
        ) {
            state.saw_content = true;
            // A turn that keeps producing content is alive: re-arm the
            // silence bound (or drop it once nothing is pending) so a long
            // follow-up/user turn is never EOF'd mid-generation — the
            // deadline exists to bound silence, never speech.
            if !state.saw_done
                && (state.close_deadline.is_some() || !state.pending_tasks.is_empty())
            {
                refresh_close_deadline(state, tokio::time::Instant::now());
            }
        }
        match event {
            EngineEvent::Delta(text) => {
                state.gen_begin(false);
                state.push(
                    &self.sink,
                    &self.run_id,
                    &self.engine_id,
                    "delta",
                    Value::String(text),
                )
            }
            EngineEvent::Thinking(text) => {
                state.gen_begin(false);
                state.push(
                    &self.sink,
                    &self.run_id,
                    &self.engine_id,
                    "thinking",
                    Value::String(text),
                )
            }
            EngineEvent::Generation { active } => {
                // Internal marker: never streamed, only folded into genMs.
                if active {
                    state.gen_begin(true);
                } else {
                    state.gen_end();
                }
            }
            EngineEvent::Message {
                role,
                text,
                path,
                todos,
                args,
                result,
                patch,
            } => {
                // A tool row opening (or its arg patch), or a completed
                // assistant snapshot (codex/kimi report whole messages), ends
                // the response stream that preceded it. Windows opened by an
                // explicit start marker keep running: claude streams tool
                // arguments inside the same response and closes it at
                // message_stop.
                let response_end = role == "assistant"
                    || (role == "tool" && result.is_none());
                if response_end && !state.gen_explicit {
                    state.gen_end();
                }
                let mut payload = serde_json::json!({ "role": role, "text": text });
                if let Some(path) = path {
                    payload["path"] = Value::String(path);
                }
                if let Some(todos) = todos {
                    if let Ok(value) = serde_json::to_value(todos) {
                        payload["todos"] = value;
                    }
                }
                if let Some(args) = args {
                    payload["args"] = args;
                }
                if let Some(result) = result {
                    payload["result"] = result;
                }
                if patch {
                    payload["patch"] = Value::Bool(true);
                }
                state.push(
                    &self.sink,
                    &self.run_id,
                    &self.engine_id,
                    "message",
                    payload,
                )
            }
            EngineEvent::AttemptEnd { error } => state.attempt_error = error,
            EngineEvent::SessionId(id) => self.adopt_session_id(state, &id, true),
            EngineEvent::Usage(usage) => {
                let gen_ms = state.take_gen_ms();
                state.push_with_gen_ms(
                    &self.sink,
                    &self.run_id,
                    &self.engine_id,
                    "usage",
                    usage,
                    gen_ms,
                )
            }
            EngineEvent::Error(error) => {
                state.gen_end();
                state.saw_error = true;
                crate::mcp::mark_run_ended(&self.run_id);
                state.push(
                    &self.sink,
                    &self.run_id,
                    &self.engine_id,
                    "error",
                    Value::String(error),
                );
                // The turn failed terminally: the frontend settles (send
                // button back to idle) on this event, so a still-running
                // CLI process would keep burning tokens invisibly while the
                // UI claims the session ended. Kill the process tree now —
                // the killed flag makes the runner's EOF path a no-op
                // (saw_error already settled the turn) and the registry
                // entry drains as usual.
                //
                // Off the reader thread: the kill blocks on the Windows tree
                // walk, and stalling this task would also stall the stdout
                // drain it owns. saw_error already settled the turn, so
                // nothing here depends on the kill completing first.
                let registry = Arc::clone(&self.registry);
                let run_id = self.run_id.clone();
                tokio::task::spawn_blocking(move || registry.kill(&run_id));
            }
            EngineEvent::Compaction { active, reason } => {
                // Not terminal: compaction is a mid-turn pause while the CLI
                // summarizes; the UI swaps its status label until the end
                // event (or turn settle) clears it.
                state.gen_end();
                state.push(
                    &self.sink,
                    &self.run_id,
                    &self.engine_id,
                    "compaction",
                    serde_json::json!({ "active": active, "reason": reason }),
                );
            }
            EngineEvent::Warn(error) => {
                // Not terminal: no saw_error — EOF settle still decides the
                // turn's fate if the CLI gives up after this notice.
                state.gen_end();
                state.push(
                    &self.sink,
                    &self.run_id,
                    &self.engine_id,
                    "warn",
                    Value::String(error),
                );
            }
            EngineEvent::Retry {
                attempt,
                max,
                message,
            } => {
                // Not terminal: the CLI is backing off and will re-issue the
                // request. The frontend renders it as live progress in the
                // run status line (not as an error banner) and clears it on
                // the next content event.
                state.gen_end();
                state.push(
                    &self.sink,
                    &self.run_id,
                    &self.engine_id,
                    "retry",
                    serde_json::json!({ "attempt": attempt, "max": max, "message": message }),
                );
            }
            EngineEvent::PermissionDenied {
                tool,
                path,
                message,
            } => {
                // Not terminal either: the CLI works around the denial and
                // the turn continues — the UI offers the grant alongside.
                state.gen_end();
                state.push(
                    &self.sink,
                    &self.run_id,
                    &self.engine_id,
                    "permission_denied",
                    serde_json::json!({ "tool": tool, "path": path, "message": message }),
                );
            }
            EngineEvent::Question {
                request_id,
                tool_use_id,
                input,
            } => {
                // Park the ask: the answer command rebuilds updatedInput from
                // this exact input (the control protocol wants the full tool
                // input back, with the answers merged in).
                state.gen_end();
                if let Some(entry) = self.registry.get(&self.run_id) {
                    if let Ok(mut questions) = entry.questions.lock() {
                        questions.insert(request_id.clone(), input.clone());
                    }
                }
                state.push(
                    &self.sink,
                    &self.run_id,
                    &self.engine_id,
                    "question",
                    serde_json::json!({
                        "requestId": request_id,
                        "toolUseId": tool_use_id,
                        "input": input,
                    }),
                );
            }
            EngineEvent::AgentSettled => {
                // 等价一次性模式的 EOF 收尾(见下方 finalize):未恢复的尝试
                // 错误按 Error 落定,否则正常 Done。Done 分支会关掉 stdin,
                // rpc 进程随之 drain 退出,EOF 收尾看到 saw_done 自然空转。
                let event = match state.attempt_error.take() {
                    Some(error) => EngineEvent::Error(error),
                    None => EngineEvent::Done {
                        session_id: None,
                        usage: None,
                    },
                };
                self.dispatch_event(state, event);
            }
            EngineEvent::QuestionSettled { request_id } => {
                if let Some(entry) = self.registry.get(&self.run_id) {
                    if let Ok(mut questions) = entry.questions.lock() {
                        questions.remove(&request_id);
                    }
                }
                state.push(
                    &self.sink,
                    &self.run_id,
                    &self.engine_id,
                    "question_settled",
                    serde_json::json!({ "requestId": request_id }),
                );
            }
            EngineEvent::ControlPermissionDeny {
                request_id,
                tool_name,
            } => {
                // No approval UI in this client: deny in place so the CLI is
                // not left parked until its deadline. Net behavior matches
                // the pre-control-protocol headless run (ask -> denial, the
                // model works around it). Best effort: if the pipe is gone
                // the CLI is already dead and its own deadline settles.
                let registry = Arc::clone(&self.registry);
                let run_id = self.run_id.clone();
                let line = serde_json::json!({
                    "type": "control_response",
                    "response": {
                        "subtype": "success",
                        "request_id": request_id,
                        "response": {
                            "behavior": "deny",
                            "message": format!(
                                "This client cannot show tool-permission prompts; the {tool_name} call was denied. Work around it, or tell the user what you would have run so they can approve it another way."
                            ),
                        },
                    },
                })
                .to_string();
                tokio::spawn(async move {
                    let _ = registry.write_line(&run_id, line).await;
                });
            }
            EngineEvent::Model(model) => {
                state.push(
                    &self.sink,
                    &self.run_id,
                    &self.engine_id,
                    "model",
                    Value::String(model),
                );
            }
            EngineEvent::Effort(effort) => {
                state.push(
                    &self.sink,
                    &self.run_id,
                    &self.engine_id,
                    "effort",
                    Value::String(effort),
                );
            }
            EngineEvent::McpServers { servers, tools } => {
                // Keep the runtime snapshot path from the v1.0.8 MCP support.
                crate::mcp::record_from_run(
                    &self.run_id,
                    state.native_session_id.as_deref(),
                    servers,
                    tools,
                );
            }
            EngineEvent::TaskStarted {
                id,
                task_type,
                description,
                subagent_type,
                is_backgrounded,
                spawn_depth,
                workflow_name,
            } => {
                // task_started carries no ambient flag (known gap): a
                // session-scoped task inserted here is corrected by the next
                // background_tasks_changed REPLACE. Until that level frame
                // vouches for the entry it stays `pending_unconfirmed`: it may
                // hold the run open, but its progress frames do NOT re-arm the
                // stall bound — a stranded ambient heartbeat must not defer
                // stdin closure forever. Only a genuinely new entry may move
                // the deadline — duplicates must not re-arm it.
                let inserted = state
                    .pending_tasks
                    .insert(
                        id.clone(),
                        TaskSummary {
                            id: id.clone(),
                            task_type: task_type.clone(),
                            description: description.clone(),
                            ambient: false,
                        },
                    )
                    .is_none();
                if inserted {
                    state.pending_unconfirmed.insert(id.clone());
                    refresh_close_deadline(state, tokio::time::Instant::now());
                }
                state.push(
                    &self.sink,
                    &self.run_id,
                    &self.engine_id,
                    "task_started",
                    serde_json::json!({
                        "taskId": id,
                        "taskType": task_type,
                        "description": description,
                        "subagentType": subagent_type,
                        "isBackgrounded": is_backgrounded,
                        "spawnDepth": spawn_depth,
                        "workflowName": workflow_name,
                    }),
                );
            }
            EngineEvent::TaskProgress {
                id,
                description,
                last_tool,
                usage,
            } => {
                // Only a task this run actually waits for may push the stall
                // bound out. An ambient (session-scoped) task heartbeats for
                // the session's whole life, so re-arming on it would defer
                // stdin closure forever — the one lever left on a run whose
                // task wedged without a final frame. A frame for a task that is
                // not pending is deliberately left alone even when nothing else
                // is pending: that is exactly the ambient case, and recomputing
                // there would hand out the 30s grace at every heartbeat. The
                // same holds for an entry no level frame has confirmed yet
                // (pending_unconfirmed): it entered through the task_started
                // ambient gap, so its heartbeats must not re-arm either.
                if state.pending_tasks.contains_key(&id)
                    && !state.pending_unconfirmed.contains(&id)
                {
                    refresh_close_deadline(state, tokio::time::Instant::now());
                }
                state.push(
                    &self.sink,
                    &self.run_id,
                    &self.engine_id,
                    "task_progress",
                    serde_json::json!({
                        "taskId": id,
                        "description": description,
                        "lastTool": last_tool,
                        "usage": usage,
                    }),
                );
            }
            EngineEvent::TaskNotification { id, status } => {
                // Only a notification that actually settles a pending task may
                // move the deadline: a notification about an ambient (or
                // otherwise untracked) task arriving during the 30s grace
                // must not hand out another 30s each time. Where the deadline
                // lands afterwards is refresh_close_deadline's call: a settled
                // reply gets the grace, an active turn gets the deadline
                // dropped — never a grace ticking under streaming output.
                if state.pending_tasks.remove(&id).is_some() {
                    state.pending_unconfirmed.remove(&id);
                    refresh_close_deadline(state, tokio::time::Instant::now());
                }
                state.push(
                    &self.sink,
                    &self.run_id,
                    &self.engine_id,
                    "task_notification",
                    serde_json::json!({ "taskId": id, "status": status }),
                );
            }
            EngineEvent::TasksChanged { tasks } => {
                // The level signal carries every task the CLI knows about,
                // including its ambient (session-scoped monitor/dream) ones.
                // Only the tasks this run actually waits for may hold the run
                // open: an ambient task never finishes inside a turn, so
                // counting it would keep stdin open to the stall bound at
                // every turn end of a session that has one — and would inflate
                // done's backgroundTasks above 0, stranding the UI's turn on a
                // background segment that never resolves. The frame itself is
                // forwarded whole: the panel shows ambient tasks too.
                let next: std::collections::HashMap<String, TaskSummary> = tasks
                    .iter()
                    .filter(|t| !t.ambient)
                    .map(|t| (t.id.clone(), t.clone()))
                    .collect();
                // Re-arm only when the pending set actually changed: an
                // ambient-only level frame during the 30s grace would
                // otherwise postpone stdin closure on every heartbeat.
                let changed = next.len() != state.pending_tasks.len()
                    || next.keys().any(|k| !state.pending_tasks.contains_key(k));
                state.pending_tasks = next;
                // Every surviving entry is vouched for by this level frame:
                // nothing stays unconfirmed (see `pending_unconfirmed`).
                state.pending_unconfirmed.clear();
                if changed {
                    refresh_close_deadline(state, tokio::time::Instant::now());
                }
                let wire: Vec<serde_json::Value> = tasks
                    .iter()
                    .map(|t| {
                        serde_json::json!({
                            "taskId": t.id,
                            "taskType": t.task_type,
                            "description": t.description,
                            "ambient": t.ambient,
                        })
                    })
                    .collect();
                state.push(
                    &self.sink,
                    &self.run_id,
                    &self.engine_id,
                    "tasks",
                    serde_json::json!({ "tasks": wire }),
                );
            }
            EngineEvent::Done { session_id, usage } => {
                let gen_ms = state.take_gen_ms();
                // A done with no content of its own is not the run's last
                // word: the CLI closes a notification-only turn it queued
                // itself (the resume-time reconciliation of a previous
                // process's tasks) before running the message the user sent,
                // and marking the run terminal here would suppress that
                // follow-up turn's frames. Keep the run open — its own done
                // (or the process-exit path) settles it.
                // Heuristic, with two known blind spots: (a) a reconciliation
                // turn that carries a whitespace-only content frame reads as a
                // real reply ending (saw_done=true) and the follow-up frames
                // stay suppressed — the "reply never shows" shape returns;
                // (b) a real turn with zero text frames (pure tool calls)
                // reads as run_continues, deferring its usage accounting to
                // the synthesized done at process exit. Both depend on CLI
                // frame shapes we cannot observe better from here.
                let run_continues = !state.saw_content;
                state.saw_content = false;
                state.saw_done = !run_continues;
                if let Some(id) = session_id {
                    self.adopt_session_id(state, &id, false);
                }
                let pending = state.pending_tasks.len();
                // A content-free done only closes the CLI's internal
                // reconciliation turn; the queued user turn is still active.
                // Keep its MCP run→workspace mapping until the actual terminal
                // done so a later MCP snapshot is not silently discarded.
                if pending == 0 && !run_continues {
                    crate::mcp::mark_run_ended(&self.run_id);
                }
                if pending == 0 {
                    // The turn is over and nothing is still running in this
                    // process: EOF the interactive stdin so the CLI exits
                    // instead of waiting for a next message forever.
                    self.registry.close_stdin(&self.run_id);
                    state.awaiting_tasks = false;
                    state.close_deadline = None;
                    state.bg_phase_started = None;
                } else {
                    // Background tasks outlive the turn. EOF now would make the
                    // CLI wind them down (its print-teardown sweep); keep stdin
                    // open and let the completion turn and task frames stream.
                    state.awaiting_tasks = true;
                    refresh_close_deadline(state, tokio::time::Instant::now());
                }
                state.push_with_gen_ms(
                    &self.sink,
                    &self.run_id,
                    &self.engine_id,
                    "done",
                    serde_json::json!({
                        "usage": usage,
                        "backgroundTasks": pending,
                        // A notification-only turn is followed by the user turn;
                        // preserve run routing until that real turn is settled.
                        "runContinues": run_continues,
                    }),
                    gen_ms,
                );
            }
        }
    }
}
/// Everything the stdout reader task needs (moved in at spawn).
pub(crate) struct RunContext {
    pub(crate) core: TurnCore,
    pub(crate) engine_impl: Box<dyn Engine>,
    pub(crate) pid: u32,
    /// Session id fixed before spawn (grok `-s`); seeds TurnState.
    pub(crate) preassigned_session_id: Option<String>,
    pub(crate) initial_model: Option<String>,
    pub(crate) initial_effort: Option<String>,
    pub(crate) child: Arc<TokioMutex<Child>>,
    pub(crate) killed: Arc<std::sync::atomic::AtomicBool>,
    pub(crate) cleanup_files: Vec<PathBuf>,
    /// omp computer-use workspace injection; restored with the same
    /// lifetime as cleanup_files (every exit path funnels through here).
    pub(crate) mcp_restore: Option<crate::computer_use::McpRestore>,
    pub(crate) stderr_buf: Arc<Mutex<String>>,
    /// Off-protocol stdout lines (plain text from CLI startup failures,
    /// wrapper errors, node crashes): parse_line drops non-JSON lines, so
    /// without this ring a failed run with empty stderr surfaces as a bare
    /// "exited with status" banner.
    pub(crate) stdout_plain_buf: Arc<Mutex<String>>,
    /// Kill-on-close job guard: drops with this context at settle, sweeping
    /// any grandchild the CLI orphaned (Windows pwsh.exe/conhost.exe).
    #[cfg(windows)]
    pub(crate) _tree_guard: Option<Arc<job::KillOnCloseJob>>,
}
impl Drop for RunContext {
    fn drop(&mut self) {
        // Also runs when the reader is aborted during interrupt or shutdown.
        cleanup_staged_files(&self.cleanup_files);
        if let Some(restore) = &self.mcp_restore {
            restore.restore();
        }
        // Last line of defence for the run's concurrency slot. The settle
        // path removes keys by name and `kill`'s abort backstop drains them
        // by run id, but a reader that dies any other way (a panic inside
        // dispatch, a task dropped without either path running) never
        // reaches those — and nothing sweeps dead pids, so the slot would
        // stay pinned until app exit and sending would eventually wedge on
        // "too many concurrent runs". Idempotent: on a healthy settle the
        // keys are already gone and this finds nothing.
        self.core
            .registry
            .remove_run_if_pid(&self.core.run_id, self.pid);
    }
}
impl RunContext {
    fn dispatch_event(&self, state: &mut TurnState, event: EngineEvent) {
        self.core.dispatch_event(state, event);
    }
}
/// Abort-safe registry cleanup for virtual (host-stream) runs, which own no
/// [`RunContext`]: their settle code sits at the end of the transport task,
/// so an abort (`kill`'s force-abort, shutdown) or a panic inside the turn
/// would strand their keys and pin a concurrency slot until app exit. Held
/// by the task for its whole life; idempotent on a healthy settle.
pub(crate) struct VirtualRunGuard {
    registry: Arc<ProcessRegistry>,
    run_id: String,
    virtual_pid: u32,
}

impl VirtualRunGuard {
    pub(crate) fn new(registry: Arc<ProcessRegistry>, run_id: String, virtual_pid: u32) -> Self {
        Self {
            registry,
            run_id,
            virtual_pid,
        }
    }
}

impl Drop for VirtualRunGuard {
    fn drop(&mut self) {
        self.registry
            .remove_run_if_pid(&self.run_id, self.virtual_pid);
    }
}

/// Remove leftover channel staging dirs (`claude-staging`/`grok-staging`
/// under app_home) from a crashed run: they hold per-send credentials and
/// must not linger on disk. Live runs recreate them per send, so sweeping
/// at startup is safe. Only these two known names are touched.
pub fn sweep_staging_dirs() {
    let home = crate::paths::app_home();
    for name in ["claude-staging", "grok-staging", "codex-plan-staging"] {
        let dir = home.join(name);
        if dir.exists() {
            if let Err(error) = std::fs::remove_dir_all(&dir) {
                eprintln!(
                    "[engine] failed to sweep staging dir {}: {error}",
                    dir.display()
                );
            }
        }
    }
}
pub(crate) fn cleanup_staged_files(paths: &[PathBuf]) {
    for path in paths {
        let result = if path.is_dir() {
            std::fs::remove_dir_all(path)
        } else {
            std::fs::remove_file(path)
        };
        if let Err(error) = result {
            if error.kind() != std::io::ErrorKind::NotFound {
                eprintln!(
                    "[engine] failed to remove staging path {}: {error}",
                    path.display()
                );
            }
        }
    }
}
/// One line read from the engine's stdout, size-capped.
pub(crate) enum LineRead {
    /// A complete line, newline terminator stripped (may be empty).
    Line(Vec<u8>),
    /// Clean EOF.
    Eof,
    /// No newline within MAX_LINE_BYTES: the run must be torn down.
    TooLong,
    /// The stdin-close deadline passed while the read was still pending.
    Deadline,
}
/// Cancellation-safe replacement for `BufReader::lines().next_line()` with a
/// hard byte cap: partial bytes live in the caller-owned `line`, and the
/// only await is `fill_buf`, so a `tokio::select!` tick landing mid-line
/// consumes and drops nothing — the property the old code relied on
/// `next_line` for (a cancelled `read_line` would lose the partial bytes).
/// Resuming the buffer is the whole point: a `line.clear()` here wiped the
/// bytes a cancelled call had already consumed from the reader, so a tick
/// landing mid-line truncated that line (a long `item.completed` parsed as
/// broken JSON and was dropped). The caller hands back the same buffer every
/// call, and `mem::take` empties it on a complete line while Eof/TooLong end
/// the run, so this only ever appends.
pub(crate) async fn read_line_capped(
    reader: &mut BufReader<ChildStdout>,
    line: &mut Vec<u8>,
) -> std::io::Result<LineRead> {
    loop {
        let available = reader.fill_buf().await?;
        if available.is_empty() {
            return Ok(if line.is_empty() {
                LineRead::Eof
            } else {
                // EOF mid-line: deliver the partial line, like next_line.
                LineRead::Line(std::mem::take(line))
            });
        }
        let end = available
            .iter()
            .position(|b| *b == b'\n')
            .unwrap_or(available.len());
        if line.len() + end > MAX_LINE_BYTES {
            return Ok(LineRead::TooLong);
        }
        line.extend_from_slice(&available[..end]);
        let has_newline = end < available.len();
        // Consume the newline too when present. No await between extend and
        // consume, so cancellation cannot split the pair.
        reader.consume(end + usize::from(has_newline));
        if has_newline {
            return Ok(LineRead::Line(std::mem::take(line)));
        }
    }
}
/// Read NDJSON stdout until EOF, dispatch events, then settle the turn:
/// registry cleanup, temp-file cleanup, and the terminal done/error event.
pub(crate) async fn run_reader(stdout: ChildStdout, ctx: RunContext) {
    let mut state = TurnState::new(ctx.preassigned_session_id.clone());
    if let Some(model) = ctx.initial_model.clone() {
        ctx.dispatch_event(&mut state, EngineEvent::Model(model));
    }
    if let Some(effort) = ctx.initial_effort.clone() {
        ctx.dispatch_event(&mut state, EngineEvent::Effort(effort));
    }
    // codex reports usage into its own session log instead of the stdout
    // stream (the stream only carries it with `turn.completed`), so a long
    // turn would otherwise show nothing until it ended. Poll that log
    // alongside the stream once the thread id is known. `read_line_capped`
    // is what makes the select safe: partial bytes stay in the caller-owned
    // buffer across polls, so a tick landing mid-line consumes and drops
    // nothing, and one runaway line can't grow without bound.
    let mut reader = BufReader::new(stdout);
    let mut line_buf = Vec::new();
    let is_codex = ctx.core.engine_id == "codex";
    let mut usage_tail: Option<codex_usage::UsageTail> = None;
    // Only the stream's own thread id (thread.started) may open the log: a
    // resumed run's preassigned id can name a thread the CLI is no longer
    // writing to, and tailing that file would miss this run's reports.
    let mut stream_session_id = false;
    // The CLI writes the rollout at thread start, so the open normally
    // succeeds on the first tick. Bound the retries anyway: each one walks
    // the whole `sessions/**` tree, and a run whose home is not the one being
    // written would walk it every tick for the length of the turn.
    let mut tail_attempts = 0u32;
    let mut poll = tokio::time::interval(std::time::Duration::from_millis(500));
    poll.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    // Pipe EOF alone cannot settle a run: a background grandchild that
    // inherited stdout keeps the pipe open after the CLI's death and parked
    // this loop forever — wait()/registry cleanup never ran and the run's
    // slots leaked. Watch the child directly; once it exits, reads are
    // bounded by POST_EXIT_DRAIN silence and the settle path below runs as
    // usual (its process-group sweep also kills the pipe-holding grandchild).
    // The watcher reaps the child early, so the post-loop wait() returns the
    // cached status; kill()/kill_all() signal the process group directly
    // when try_lock finds this waiter holding the child lock.
    let (exit_tx, mut exit_rx) = tokio::sync::oneshot::channel::<()>();
    {
        let child = Arc::clone(&ctx.child);
        tokio::spawn(async move {
            let mut guard = child.lock().await;
            let _ = guard.wait().await;
            let _ = exit_tx.send(());
        });
    }
    let mut child_exited = false;
    loop {
        // While background tasks hold stdin open, the run has no other bound:
        // arm a deadline so a wedged task cannot pin this process forever.
        let deadline = state.close_deadline;
        let read = tokio::select! {
            line = async {
                match deadline {
                    Some(at) => match tokio::time::timeout_at(
                        at,
                        read_line_capped(&mut reader, &mut line_buf),
                    )
                    .await
                    {
                        Ok(r) => r,
                        Err(_) => Ok(LineRead::Deadline),
                    },
                    None => read_line_capped(&mut reader, &mut line_buf).await,
                }
            } => line,
            _ = &mut exit_rx, if !child_exited => {
                child_exited = true;
                continue;
            }
            _ = poll.tick(), if is_codex && !state.saw_done && !state.saw_error => {
                if let Some(tail) = usage_tail.as_mut() {
                    for usage in tail.poll() {
                        ctx.dispatch_event(&mut state, EngineEvent::Usage(usage));
                    }
                } else if stream_session_id && tail_attempts < 20 {
                    // The CLI creates the log a moment after the thread
                    // id arrives. Attempt every tick rather than backing
                    // off: the tail starts at the file's end, so any wait
                    // here is a window in which a record lands unread.
                    tail_attempts += 1;
                    usage_tail = state
                        .native_session_id
                        .as_deref()
                        .and_then(codex_usage::UsageTail::open);
                }
                continue;
            }
            _ = tokio::time::sleep(POST_EXIT_DRAIN), if child_exited => break,
        };
        let line = match read {
            Ok(LineRead::Line(bytes)) => bytes,
            Ok(LineRead::Eof) => break,
            Ok(LineRead::TooLong) => {
                // A line this large is never a real event — the engine is
                // stuck writing garbage. Settle the turn as a terminal
                // error; dispatch also kills the process tree off-thread.
                ctx.dispatch_event(
                    &mut state,
                    EngineEvent::Error(format!(
                        "{} emitted a line over {} MiB without a newline; run terminated",
                        ctx.core.engine_id,
                        MAX_LINE_BYTES / (1024 * 1024),
                    )),
                );
                break;
            }
            // The background grace/stall deadline passed with stdin still
            // open: end the run through the only lever left — EOF the CLI's
            // stdin (its wind-down then sweeps whatever never finished).
            Ok(LineRead::Deadline) => {
                state.close_deadline = None;
                ring_push(
                    &ctx.stdout_plain_buf,
                    "background tasks silent past the close deadline; closing stdin\n",
                );
                ctx.core.registry.close_stdin(&ctx.core.run_id);
                continue;
            }
            Err(_) => break,
        };
        let text = String::from_utf8_lossy(&line);
        let trimmed = text.trim();
        if trimmed.is_empty() {
            continue;
        }
        state.saw_any_output = true;
        if serde_json::from_str::<Value>(trimmed).is_err() {
            // Every engine protocol here is NDJSON: a non-JSON line is
            // off-protocol diagnostics (clap usage errors, shell wrapper
            // complaints, node crashes) that no parse_line would keep.
            ring_push(&ctx.stdout_plain_buf, &format!("{trimmed}\n"));
        }
        let mut events = Vec::new();
        ctx.engine_impl.parse_line(trimmed, &mut events);
        stream_session_id |= events
            .iter()
            .any(|event| matches!(event, EngineEvent::SessionId(_)));
        for mut event in events {
            // Flush the final rollout records BEFORE done/error. Sending them
            // afterwards made observers adopt the already-finished run again.
            if matches!(event, EngineEvent::Done { .. } | EngineEvent::Error(_))
                && !state.saw_done
                && !state.saw_error
            {
                if let Some(tail) = usage_tail.as_mut() {
                    for usage in tail.poll() {
                        ctx.dispatch_event(&mut state, EngineEvent::Usage(usage));
                    }
                    if let EngineEvent::Done {
                        usage: Some(usage), ..
                    } = &mut event
                    {
                        *usage = tail.with_window(usage);
                    }
                }
            }
            ctx.dispatch_event(&mut state, event);
        }
    }

    // Last look at the session log: the final response's record may have
    // landed after the last poll tick.
    if let Some(tail) = usage_tail.as_mut() {
        for usage in tail.poll() {
            ctx.dispatch_event(&mut state, EngineEvent::Usage(usage));
        }
    }

    // Wait for exit
    let status = {
        let mut guard = ctx.child.lock().await;
        guard.wait().await.ok()
    };
    // Unix mirror of the Windows kill-on-close job guard: grandchildren the
    // CLI orphaned (background shells that outlived the turn) are still in
    // the run's process group — sweep them so a settled turn leaks nothing.
    // Clean exit → empty group → ESRCH no-op; a pid-reuse hit would need a
    // fresh process to take the just-reaped pid AND lead a new group within
    // microseconds. pid 0 is never signalled: kill(0, …) targets OUR group.
    #[cfg(unix)]
    if ctx.pid != 0 {
        kill_process_group(ctx.pid);
    }
    for path in &ctx.cleanup_files {
        let _ = std::fs::remove_file(path);
    }
    // Pending questions die with the run: settle their cards so the UI never
    // leaves an answerable question pointing at a dead process.
    for key in [
        state.native_session_id.clone(),
        Some(ctx.core.run_id.clone()),
    ]
    .into_iter()
    .flatten()
    {
        for request_id in ctx.core.registry.take_questions(&key) {
            ctx.dispatch_event(&mut state, EngineEvent::QuestionSettled { request_id });
        }
    }
    // Drain this run's registry entries: under the native session id after
    // rekey, and under the run id when the session id never arrived.
    if let Some(key) = state.native_session_id.clone() {
        ctx.core.registry.remove_if_pid(&key, ctx.pid);
    }
    ctx.core.registry.remove_if_pid(&ctx.core.run_id, ctx.pid);
    // Also clean up the preassigned session id alias if one was registered
    // at spawn (grok/codex resume): a resumed session was keyed under
    // ctx.preassigned_session_id, so we must remove that alias even if the
    // native id differs or never arrived.
    if let Some(key) = ctx.preassigned_session_id.as_deref() {
        ctx.core.registry.remove_if_pid(key, ctx.pid);
    }
    // omp writes some failures (upstream 403/5xx, quota exhaustion) to
    // stderr and then exits — sometimes cleanly, after a normal turn_end.
    // A non-empty stderr on a failed exit must reach the user even when a
    // done/error event already settled the turn; dropping it hides exactly
    // the errors the user cannot otherwise see.
    let stderr_tail = ctx
        .stderr_buf
        .lock()
        .map(|g| redact_secrets(g.trim()))
        .unwrap_or_default();
    let failed = status.map(|s| !s.success()).unwrap_or(true);
    if failed && !state.saw_error && !stderr_tail.is_empty() {
        state.push(
            &ctx.core.sink,
            &ctx.core.run_id,
            &ctx.core.engine_id,
            "warn",
            Value::String(format!("engine stderr: {stderr_tail}")),
        );
    }

    // The process is gone: whatever it still owed this run's task list is
    // never coming. Close the list out FIRST so any terminal done synthesized
    // below honestly reports backgroundTasks: 0 — reporting the pre-death
    // count would park the frontend in an awaiting phase no later frame can
    // resolve. Terminal events are staged until confirm_exit, so on the wire
    // this tasks frame still lands before the done it enables.
    push_final_task_frame(&mut state, &ctx.core);
    if !state.saw_error && state.saw_done && state.awaiting_tasks {
        // The reply settled but the run died inside its background phase
        // (stall deadline, user stop, natural wind-down): the frontend is in
        // the awaiting phase that only a terminal done(backgroundTasks: 0)
        // resolves — without it the session's awaitingTasks hangs until its
        // 30-minute orphan sweep.
        state.push(
            &ctx.core.sink,
            &ctx.core.run_id,
            &ctx.core.engine_id,
            "done",
            serde_json::json!({
                "usage": null,
                "backgroundTasks": 0,
                "runContinues": false,
            }),
        );
    }
    if !state.saw_done && !state.saw_error {
        // The task list was closed out above, so the backgroundTasks count
        // these synthesized settles report is 0.
        let killed = ctx.killed.load(std::sync::atomic::Ordering::SeqCst);
        if killed {
            // User-initiated stop: commit whatever streamed so far as a
            // normal turn end — a SIGKILL'd child is not a failure.
            state.push(
                &ctx.core.sink,
                &ctx.core.run_id,
                &ctx.core.engine_id,
                "done",
                serde_json::json!({
                    "usage": null,
                    // Keep the Done arm's contract on synthesized settles so
                    // the frontend never has to default the fields.
                    "backgroundTasks": state.pending_tasks.len(),
                    "runContinues": false,
                }),
            );
        } else if failed || !state.saw_any_output || state.attempt_error.is_some() {
            let mut message = state.attempt_error.take().unwrap_or_else(|| {
                format!(
                    "{} exited with status {}",
                    ctx.core.engine_id,
                    status
                        .map(|s| s.to_string())
                        .unwrap_or_else(|| "unknown".to_string())
                )
            });
            if !stderr_tail.is_empty() {
                message.push_str(&format!(": {stderr_tail}"));
            } else {
                // Startup failures of old/odd CLIs often land on stdout as
                // plain text instead of stderr; without this fallback the
                // banner is a bare exit code.
                let stdout_tail = ctx
                    .stdout_plain_buf
                    .lock()
                    .map(|g| redact_secrets(g.trim()))
                    .unwrap_or_default();
                if !stdout_tail.is_empty() {
                    message.push_str(&format!(": {stdout_tail}"));
                }
            }
            state.push(
                &ctx.core.sink,
                &ctx.core.run_id,
                &ctx.core.engine_id,
                "error",
                Value::String(message),
            );
        } else {
            // Clean EOF without an explicit done line (kimi).
            state.push(
                &ctx.core.sink,
                &ctx.core.run_id,
                &ctx.core.engine_id,
                "done",
                serde_json::json!({
                    "usage": null,
                    "backgroundTasks": state.pending_tasks.len(),
                    "runContinues": false,
                }),
            );
        }
    }
    // Release a deferred terminal event only after the task-list settlement
    // is out, so the final run event remains the last lifecycle transition.
    if status.is_some() {
        state.confirm_exit(&ctx.core);
    }
    // The process is gone: release the run→workspace mapping no matter how
    // the run settled. The Done/Error arms cover the orderly paths; a run
    // killed or crashed while awaiting its follow-up turn would otherwise
    // leak the mapping and pin the workspace snapshot at "ready" forever.
    crate::mcp::mark_run_ended(&ctx.core.run_id);
    ctx.core.sink.flush();
}
#[cfg(test)]
mod staging_tests {
    use super::*;
    use crate::engine::ChildEntry;
    use std::collections::HashMap;

    #[derive(Default)]
    struct EventLog(Mutex<Vec<Value>>);
    impl event_sink::Emit for EventLog {
        fn emit_json(&self, _: &str, raw: &str) {
            self.0
                .lock()
                .unwrap()
                .extend(serde_json::from_str::<Vec<Value>>(raw).unwrap());
        }
    }

    /// The ring truncates by byte count: a naive drain start can land
    /// mid-CJK and panic (killing the stderr capture task silently).
    #[test]
    fn ring_push_snaps_truncation_to_char_boundary() {
        let buf = Arc::new(Mutex::new(String::new()));
        ring_push(&buf, &"引擎错误".repeat(1000));
        // std Mutex stays: ring buffers are deliberately poison-tolerant
        // (a panicked capture task must not take down error reporting).
        let kept = buf.lock().unwrap_or_else(|p| p.into_inner());
        assert!(kept.len() <= 4096);
        assert!(kept.ends_with("引擎错误"));
    }

    struct Noop;
    impl event_sink::Emit for Noop {
        fn emit_json(&self, _: &str, _: &str) {}
    }

    #[tokio::test]
    async fn reader_context_cleans_private_configs_on_completion_and_abort() {
        for abort in [false, true] {
            let directory =
                std::env::temp_dir().join(format!("ccgui-reader-cleanup-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&directory).unwrap();
            std::fs::write(directory.join("config.toml"), "temporary credential").unwrap();
            let mut command = Command::new(if cfg!(windows) { "cmd.exe" } else { "sh" });
            command.args(if cfg!(windows) {
                ["/c", "exit 0"]
            } else {
                ["-c", "exit 0"]
            });
            let mut child = command.spawn().unwrap();
            child.wait().await.unwrap();
            let ctx = RunContext {
                core: TurnCore {
                    sink: event_sink::EventSink::new(Arc::new(Noop)),
                    registry: Arc::new(ProcessRegistry::default()),
                    engine_id: "grok".into(),
                    run_id: "test".into(),
                },
                engine_impl: Box::new(grok::GrokEngine),
                pid: 0,
                preassigned_session_id: None,
                initial_model: None,
                initial_effort: None,
                child: Arc::new(TokioMutex::new(child)),
                killed: Arc::new(std::sync::atomic::AtomicBool::new(false)),
                cleanup_files: vec![directory.clone()],
                mcp_restore: None,
                stderr_buf: Arc::new(Mutex::new(String::new())),
                stdout_plain_buf: Arc::new(Mutex::new(String::new())),
                // Upstream's own constructor omits this Windows-only guard
                // field (E0063 on Windows); a plain test child owns no job.
                #[cfg(windows)]
                _tree_guard: None,
            };
            let task = tokio::spawn(async move {
                if abort {
                    std::future::pending::<()>().await;
                }
                drop(ctx);
            });
            if abort {
                task.abort();
            }
            let result = task.await;
            assert_eq!(result.is_err(), abort);
            assert!(!directory.exists());
        }
    }

    /// 后台期静默死亡（这里用「写完一帧任务帧就退出的假 CLI」表示，例如它带走的
    /// 那个后台任务）：退出路径先补一帧空 level 帧（REPLACE 语义）让面板当场把
    /// running 行收敛，再合成终局 done——它必须如实报告 backgroundTasks: 0，
    /// 报死亡前的计数会把前端挂进没有任何后续帧能解开的等待相位。
    #[tokio::test]
    async fn a_run_that_dies_mid_background_phase_closes_its_task_list() {
        let frame = std::env::temp_dir()
            .join(format!("ccgui-reader-taskframe-{}.ndjson", uuid::Uuid::new_v4()));
        std::fs::write(
            &frame,
            "{\"type\":\"system\",\"subtype\":\"task_started\",\"task_id\":\"t1\",\
             \"task_type\":\"local_bash\",\"description\":\"sleep 60\"}\n",
        )
        .unwrap();
        let mut command = Command::new(if cfg!(windows) { "cmd.exe" } else { "sh" });
        if cfg!(windows) {
            command.args(["/c", "type"]).arg(&frame);
        } else {
            command.args(["-c", &format!("cat '{}'", frame.display())]);
        }
        command.stdout(std::process::Stdio::piped());
        let mut child = command.spawn().unwrap();
        let stdout = child.stdout.take().unwrap();
        let log = Arc::new(EventLog::default());
        let ctx = RunContext {
            core: TurnCore {
                sink: event_sink::EventSink::new(log.clone()),
                registry: Arc::new(ProcessRegistry::default()),
                engine_id: "claude".into(),
                run_id: "exit-with-tasks".into(),
            },
            engine_impl: Box::new(crate::engine::claude::ClaudeEngine::new()),
            pid: 0,
            preassigned_session_id: None,
            initial_model: None,
            initial_effort: None,
            child: Arc::new(TokioMutex::new(child)),
            killed: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            cleanup_files: Vec::new(),
            mcp_restore: None,
            stderr_buf: Arc::new(Mutex::new(String::new())),
            stdout_plain_buf: Arc::new(Mutex::new(String::new())),
            #[cfg(windows)]
            _tree_guard: None,
        };

        run_reader(stdout, ctx).await;
        let _ = std::fs::remove_file(&frame);

        let events = log.0.lock().unwrap();
        let kinds: Vec<&str> = events
            .iter()
            .map(|event| event["kind"].as_str().unwrap())
            .collect();
        assert_eq!(
            kinds,
            ["task_started", "tasks", "done"],
            "the exit path closes the task list before the terminal frame"
        );
        let settle = &events[1];
        assert_eq!(
            settle["data"]["tasks"].as_array().map(Vec::len),
            Some(0),
            "the final level frame must be the empty live set"
        );
        let done = events.last().unwrap();
        assert_eq!(
            done["data"]["backgroundTasks"], 0,
            "a dead process owes nothing: the count must not resurrect an awaiting phase"
        );
        assert_eq!(done["data"]["runContinues"], false);
    }

    /// 回复已结算（held done 已发）但 run 死在后台期：前端正等一帧
    /// done(backgroundTasks: 0) 来收敛 awaitingTasks 相位——退出尾部必须补它，
    /// 且帧序恒为 tasks:[] 在前、终局 done 在后。
    #[tokio::test]
    async fn a_run_dying_while_awaiting_tasks_gets_a_terminal_done() {
        let frame = std::env::temp_dir()
            .join(format!("ccgui-reader-awaitdie-{}.ndjson", uuid::Uuid::new_v4()));
        std::fs::write(
            &frame,
            concat!(
                "{\"type\":\"system\",\"subtype\":\"task_started\",\"task_id\":\"t1\",",
                "\"task_type\":\"local_bash\",\"description\":\"sleep 60\"}\n",
                "{\"type\":\"stream_event\",\"event\":{\"type\":\"content_block_delta\",",
                "\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"reply\"}}}\n",
                "{\"type\":\"result\",\"session_id\":\"s1\"}\n",
            ),
        )
        .unwrap();
        let mut command = Command::new(if cfg!(windows) { "cmd.exe" } else { "sh" });
        if cfg!(windows) {
            command.args(["/c", "type"]).arg(&frame);
        } else {
            command.args(["-c", &format!("cat '{}'", frame.display())]);
        }
        command.stdout(std::process::Stdio::piped());
        let mut child = command.spawn().unwrap();
        let stdout = child.stdout.take().unwrap();
        let log = Arc::new(EventLog::default());
        let ctx = RunContext {
            core: TurnCore {
                sink: event_sink::EventSink::new(log.clone()),
                registry: Arc::new(ProcessRegistry::default()),
                engine_id: "claude".into(),
                run_id: "exit-awaiting-tasks".into(),
            },
            engine_impl: Box::new(crate::engine::claude::ClaudeEngine::new()),
            pid: 0,
            preassigned_session_id: None,
            initial_model: None,
            initial_effort: None,
            child: Arc::new(TokioMutex::new(child)),
            killed: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            cleanup_files: Vec::new(),
            mcp_restore: None,
            stderr_buf: Arc::new(Mutex::new(String::new())),
            stdout_plain_buf: Arc::new(Mutex::new(String::new())),
            #[cfg(windows)]
            _tree_guard: None,
        };

        run_reader(stdout, ctx).await;
        let _ = std::fs::remove_file(&frame);

        let events = log.0.lock().unwrap();
        let kinds: Vec<&str> = events
            .iter()
            .map(|event| event["kind"].as_str().unwrap())
            .collect();
        assert_eq!(
            kinds,
            ["task_started", "delta", "done", "tasks", "done"],
            "held done first, then the task close-out, then the terminal done"
        );
        assert_eq!(events[2]["data"]["backgroundTasks"], 1, "the held done counts the live task");
        let terminal = events.last().unwrap();
        assert_eq!(terminal["data"]["backgroundTasks"], 0);
        assert_eq!(terminal["data"]["runContinues"], false);
        assert_eq!(terminal["data"]["usage"], serde_json::Value::Null);
    }

    /// Slot accounting must survive a reader that dies without reaching
    /// either settle path (abort here; a panic inside dispatch is the same
    /// shape). Nothing sweeps dead pids, so a stranded key pins a
    /// concurrency slot until app exit and sending eventually wedges on
    /// "too many concurrent runs".
    #[tokio::test]
    async fn dropping_a_run_context_frees_the_runs_concurrency_slot() {
        let mut command = Command::new(if cfg!(windows) { "cmd.exe" } else { "sh" });
        command.args(if cfg!(windows) {
            ["/c", "exit 0"]
        } else {
            ["-c", "exit 0"]
        });
        let mut child = command.spawn().unwrap();
        child.wait().await.unwrap();
        let registry = Arc::new(ProcessRegistry::default());
        let entry = ChildEntry {
            child: None,
            pid: 4242,
            run_id: "run-abort".into(),
            killed: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            reader_abort: Arc::new(std::sync::OnceLock::new()),
            stdin: None,
            questions: Arc::new(Mutex::new(HashMap::new())),
        };
        registry.insert("run-abort".into(), entry.clone());
        registry.insert_alias("session-abort".into(), entry);
        let ctx = RunContext {
            core: TurnCore {
                sink: event_sink::EventSink::new(Arc::new(Noop)),
                registry: Arc::clone(&registry),
                engine_id: "grok".into(),
                run_id: "run-abort".into(),
            },
            engine_impl: Box::new(grok::GrokEngine),
            pid: 4242,
            preassigned_session_id: None,
            initial_model: None,
            initial_effort: None,
            child: Arc::new(TokioMutex::new(child)),
            killed: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            cleanup_files: Vec::new(),
            mcp_restore: None,
            stderr_buf: Arc::new(Mutex::new(String::new())),
            stdout_plain_buf: Arc::new(Mutex::new(String::new())),
            #[cfg(windows)]
            _tree_guard: None,
        };
        let task = tokio::spawn(async move {
            let _held = ctx;
            std::future::pending::<()>().await;
        });
        task.abort();
        assert!(task.await.is_err());

        assert!(
            registry.get("run-abort").is_none(),
            "run-id key survived the abort"
        );
        assert!(
            registry.get("session-abort").is_none(),
            "session alias survived the abort"
        );
    }

    /// Virtual (host-stream) runs own no RunContext: the guard is what frees
    /// their keys when the transport task is aborted instead of settling.
    #[tokio::test]
    async fn dropping_a_virtual_run_guard_frees_every_key_of_that_run() {
        let registry = Arc::new(ProcessRegistry::default());
        let entry = ChildEntry {
            child: None,
            pid: 5150,
            run_id: "run-v".into(),
            killed: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            reader_abort: Arc::new(std::sync::OnceLock::new()),
            stdin: None,
            questions: Arc::new(Mutex::new(HashMap::new())),
        };
        registry.insert("run-v".into(), entry.clone());
        registry.insert_alias("session-v".into(), entry);
        // Another run's entry must be left alone.
        registry.insert(
            "run-other".into(),
            ChildEntry {
                child: None,
                pid: 5151,
                run_id: "run-other".into(),
                killed: Arc::new(std::sync::atomic::AtomicBool::new(false)),
                reader_abort: Arc::new(std::sync::OnceLock::new()),
                stdin: None,
                questions: Arc::new(Mutex::new(HashMap::new())),
            },
        );

        {
            let _guard = VirtualRunGuard::new(Arc::clone(&registry), "run-v".into(), 5150);
            assert!(registry.get("run-v").is_some());
        }

        assert!(registry.get("run-v").is_none());
        assert!(registry.get("session-v").is_none());
        assert!(
            registry.get("run-other").is_some(),
            "unrelated run was swept"
        );
    }
}
#[cfg(test)]
mod terminal_event_tests {
    use super::*;

    #[derive(Default)]
    struct Collector(Mutex<Vec<Value>>);
    impl event_sink::Emit for Collector {
        fn emit_json(&self, _: &str, raw: &str) {
            self.0
                .lock()
                .unwrap()
                .extend(serde_json::from_str::<Vec<Value>>(raw).unwrap());
        }
    }

    #[tokio::test]
    async fn plugin_pi_and_codex_terminals_wait_for_confirmed_exit() {
        for engine in ["pi", "codex"] {
            for fail in [false, true] {
                let collector = Arc::new(Collector::default());
                let core = TurnCore {
                    sink: event_sink::EventSink::with_name(
                        collector.clone(),
                        event_sink::PLUGIN_AGENT_EVENT_NAME,
                    ),
                    registry: Arc::new(ProcessRegistry::default()),
                    engine_id: engine.into(),
                    run_id: "pa-relay-test".into(),
                };
                let mut state = TurnState::new(None);
                core.dispatch_event(
                    &mut state,
                    if fail {
                        EngineEvent::Error("failed".into())
                    } else {
                        EngineEvent::Done {
                            session_id: None,
                            usage: None,
                        }
                    },
                );
                core.sink.flush();
                assert!(collector.0.lock().unwrap().is_empty());
                state.confirm_exit(&core);
                state.confirm_exit(&core);
                core.sink.flush();
                let events = collector.0.lock().unwrap();
                assert_eq!(events.len(), 1);
                assert_eq!(events[0]["kind"], if fail { "error" } else { "done" });
            }
        }
    }

    #[tokio::test]
    async fn usage_reports_carry_the_measured_generation_window() {
        let collector = Arc::new(Collector::default());
        let core = TurnCore {
            sink: event_sink::EventSink::new(collector.clone()),
            registry: Arc::new(ProcessRegistry::default()),
            engine_id: "pi".into(),
            run_id: "gen-ms-test".into(),
        };
        let mut state = TurnState::new(Some("session".into()));
        let tool_start = || EngineEvent::Message {
            role: "tool".into(),
            text: "read".into(),
            path: None,
            todos: None,
            args: None,
            result: None,
            patch: false,
        };

        // Explicit window: a mid-response tool row (claude streams tool args
        // inside the same message) must not close it.
        core.dispatch_event(&mut state, EngineEvent::Generation { active: true });
        core.dispatch_event(&mut state, EngineEvent::Delta("hi".into()));
        tokio::time::sleep(std::time::Duration::from_millis(30)).await;
        core.dispatch_event(&mut state, tool_start());
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        core.dispatch_event(
            &mut state,
            EngineEvent::Usage(serde_json::json!({"output_tokens": 3})),
        );

        // Implicit (delta-opened) window: the tool row closes it, so the
        // next usage report only measures what ran before the tool.
        core.dispatch_event(&mut state, EngineEvent::Delta("mid".into()));
        tokio::time::sleep(std::time::Duration::from_millis(30)).await;
        core.dispatch_event(&mut state, tool_start());
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        core.dispatch_event(
            &mut state,
            EngineEvent::Usage(serde_json::json!({"output_tokens": 3})),
        );

        core.sink.flush();
        let events = collector.0.lock().unwrap();
        let usages: Vec<u64> = events
            .iter()
            .filter(|event| event["kind"] == "usage")
            .filter_map(|event| event.get("genMs").and_then(Value::as_u64))
            .collect();
        assert_eq!(usages.len(), 2, "both usage reports carry genMs");
        assert!(usages[0] >= 200, "explicit window ignored the tool row: {usages:?}");
        assert!(usages[1] < 200, "implicit window closed at the tool row: {usages:?}");
    }

    #[tokio::test]
    async fn terminal_runs_do_not_emit_late_usage_text_or_duplicate_completion() {
        for fail in [false, true] {
            let collector = Arc::new(Collector::default());
            let core = TurnCore {
                sink: event_sink::EventSink::new(collector.clone()),
                registry: Arc::new(ProcessRegistry::default()),
                engine_id: "codex".into(),
                run_id: "terminal-test".into(),
            };
            let mut state = TurnState::new(Some("session".into()));
            core.dispatch_event(&mut state, EngineEvent::Delta("完成中文与 emoji 🐎".into()));
            core.dispatch_event(
                &mut state,
                EngineEvent::Usage(
                    serde_json::json!({"input_tokens": 90000, "model_context_window":1000000}),
                ),
            );
            core.dispatch_event(
                &mut state,
                if fail {
                    EngineEvent::Error("failed".into())
                } else {
                    EngineEvent::Done {
                        session_id: None,
                        usage: None,
                    }
                },
            );
            core.dispatch_event(
                &mut state,
                EngineEvent::Usage(serde_json::json!({"input_tokens":90000})),
            );
            core.dispatch_event(&mut state, EngineEvent::Delta("late".into()));
            core.dispatch_event(
                &mut state,
                EngineEvent::Done {
                    session_id: None,
                    usage: None,
                },
            );
            core.sink.flush();
            let events = collector.0.lock().unwrap();
            let kinds: Vec<_> = events
                .iter()
                .map(|event| event["kind"].as_str().unwrap())
                .collect();
            assert_eq!(
                kinds,
                ["delta", "usage", if fail { "error" } else { "done" }]
            );
            assert_eq!(events[0]["data"], "完成中文与 emoji 🐎");
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn plugin_pi_interrupt_emits_terminal_only_after_child_exit() {
        for early_done in [false, true] {
            let mut command = Command::new("sh");
            let delta = r#"{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"ready"}}"#;
            let done = if early_done {
                r#"printf '%s\n' '{"type":"agent_end","messages":[{"role":"assistant","stopReason":"stop"}]}';"#
            } else {
                ""
            };
            command.args([
                "-c",
                &format!("printf '%s\\n' '{delta}'; {done} exec sleep 30"),
            ]);
            command
                .stdout(std::process::Stdio::piped())
                .process_group(0)
                .kill_on_drop(true);
            let mut child = command.spawn().unwrap();
            let pid = child.id().unwrap();
            let stdout = child.stdout.take().unwrap();
            let child = Arc::new(TokioMutex::new(child));
            let collector = Arc::new(Collector::default());
            let sink = event_sink::EventSink::with_name(
                collector.clone(),
                event_sink::PLUGIN_AGENT_EVENT_NAME,
            );
            let registry = Arc::new(ProcessRegistry::default());
            let killed = Arc::new(std::sync::atomic::AtomicBool::new(false));
            let run_id = "pa-relay-interrupt";
            registry.insert(
                run_id.into(),
                crate::engine::ChildEntry {
                    child: Some(child.clone()),
                    pid,
                    run_id: run_id.into(),
                    killed: killed.clone(),
                    reader_abort: Arc::new(std::sync::OnceLock::new()),
                    stdin: None,
                    questions: Arc::new(Mutex::new(std::collections::HashMap::new())),
                },
            );
            let context = RunContext {
                core: TurnCore {
                    sink: sink.clone(),
                    registry: registry.clone(),
                    engine_id: "pi".into(),
                    run_id: run_id.into(),
                },
                engine_impl: Box::new(crate::engine::pi_family::pi()),
                pid,
                preassigned_session_id: None,
                initial_model: None,
                initial_effort: None,
                child: child.clone(),
                killed,
                cleanup_files: vec![],
                mcp_restore: None,
                stderr_buf: Arc::new(Mutex::new(String::new())),
                stdout_plain_buf: Arc::new(Mutex::new(String::new())),
            };
            let reader = tokio::spawn(run_reader(stdout, context));
            tokio::time::timeout(std::time::Duration::from_secs(3), async {
                loop {
                    sink.flush();
                    if !collector.0.lock().unwrap().is_empty() {
                        break;
                    }
                    tokio::time::sleep(std::time::Duration::from_millis(10)).await;
                }
            })
            .await
            .unwrap();
            tokio::time::sleep(std::time::Duration::from_millis(30)).await;
            sink.flush();
            assert!(!collector
                .0
                .lock()
                .unwrap()
                .iter()
                .any(|event| matches!(event["kind"].as_str(), Some("done" | "error"))));
            assert!(registry.kill(run_id));
            tokio::time::timeout(std::time::Duration::from_secs(3), reader)
                .await
                .unwrap()
                .unwrap();
            assert!(child.lock().await.try_wait().unwrap().is_some());
            assert_eq!(registry.active_run_count(), 0);
            let events = collector.0.lock().unwrap();
            assert_eq!(
                events
                    .iter()
                    .filter(|event| matches!(event["kind"].as_str(), Some("done" | "error")))
                    .count(),
                1
            );
            assert_eq!(events.last().unwrap()["kind"], "done");
        }
    }

    #[test]
    fn task_frames_survive_terminal_done() {
        let mut state = TurnState::new(None);
        state.saw_done = true;
        assert!(!suppressed_after_terminal(
            &state,
            &EngineEvent::TaskProgress { id: "t".into(), description: None, last_tool: None, usage: None }
        ));
        assert!(!suppressed_after_terminal(
            &state,
            &EngineEvent::TaskNotification { id: "t".into(), status: "completed".into() }
        ));
        // All four task variants must pass the terminal gate, not just the
        // two that arrive after done in the common case: a background task
        // started by the follow-up turn (or the level frame that closes it
        // out) lands after a done too.
        assert!(!suppressed_after_terminal(
            &state,
            &EngineEvent::TaskStarted {
                id: "t".into(),
                task_type: "local_bash".into(),
                description: "ping".into(),
                subagent_type: None,
                is_backgrounded: None,
                spawn_depth: None,
                workflow_name: None,
            }
        ));
        assert!(!suppressed_after_terminal(
            &state,
            &EngineEvent::TasksChanged { tasks: Vec::new() }
        ));
    }

    #[test]
    fn follow_up_turn_passes_only_while_awaiting_tasks() {
        let mut state = TurnState::new(None);
        state.saw_done = true;
        state.awaiting_tasks = true;
        assert!(!suppressed_after_terminal(&state, &EngineEvent::Delta("note".into())));
        assert!(!suppressed_after_terminal(&state, &EngineEvent::Done { session_id: None, usage: None }));
        // 非内容类事件（retry/warn/error）仍被终态挡住。
        assert!(suppressed_after_terminal(
            &state,
            &EngineEvent::Retry { attempt: 1, max: 3, message: "x".into() }
        ));
        state.awaiting_tasks = false;
        assert!(suppressed_after_terminal(&state, &EngineEvent::Delta("late".into())));
    }

    #[tokio::test]
    async fn hollow_done_leaves_room_for_the_cli_s_queued_turn() {
        let collector = Arc::new(Collector::default());
        let core = TurnCore {
            sink: event_sink::EventSink::new(collector.clone()),
            registry: Arc::new(ProcessRegistry::default()),
            engine_id: "claude".into(), run_id: "hollow-test".into(),
        };
        let mut state = TurnState::new(Some("session".into()));
        // The resume-time reconciliation turn carries no content of its own.
        core.dispatch_event(&mut state, EngineEvent::Model("m".into()));
        core.dispatch_event(&mut state, EngineEvent::Done { session_id: None, usage: None });
        assert!(!state.saw_done, "a content-free done is not the run's terminal event");
        // The CLI's queued turn — the message the user actually sent — still
        // has to stream, and its own done settles the run.
        core.dispatch_event(&mut state, EngineEvent::Delta("reply".into()));
        core.dispatch_event(&mut state, EngineEvent::Done { session_id: None, usage: None });
        assert!(state.saw_done);
        core.sink.flush();
        let events = collector.0.lock().unwrap();
        let kinds: Vec<_> = events.iter().map(|event| event["kind"].as_str().unwrap()).collect();
        assert_eq!(kinds, ["model", "done", "delta", "done"]);
        assert_eq!(events[1]["data"]["runContinues"], true);
        assert_eq!(events[3]["data"]["runContinues"], false);
    }

    #[tokio::test]
    async fn hollow_done_keeps_mcp_run_registered_until_the_real_turn_ends() {
        let collector = Arc::new(Collector::default());
        let core = TurnCore {
            sink: event_sink::EventSink::new(collector),
            registry: Arc::new(ProcessRegistry::default()),
            engine_id: "claude".into(),
            run_id: "mcp-hollow-done-test".into(),
        };
        let workspace = std::env::temp_dir().join("ccgui-mcp-hollow-done-test");
        let workspace = workspace.to_string_lossy().into_owned();
        crate::mcp::register_run(&core.run_id, &workspace);
        let mut state = TurnState::new(Some("session".into()));

        core.dispatch_event(
            &mut state,
            EngineEvent::McpServers {
                servers: vec![("test-server".into(), Some("connected".into()))],
                tools: Vec::new(),
            },
        );
        assert_eq!(crate::mcp::claude_section(Some(&workspace)).status, "ready");

        core.dispatch_event(&mut state, EngineEvent::Done { session_id: None, usage: None });
        assert_eq!(crate::mcp::claude_section(Some(&workspace)).status, "ready");

        core.dispatch_event(&mut state, EngineEvent::Delta("reply".into()));
        core.dispatch_event(&mut state, EngineEvent::Done { session_id: None, usage: None });
        assert_eq!(crate::mcp::claude_section(Some(&workspace)).status, "session_ended");
    }

    #[test]
    fn close_deadline_tracks_run_phase() {
        let now = tokio::time::Instant::now();
        let mut state = TurnState::new(None);

        // Active turn, nothing pending: no deadline (pre-background behavior).
        refresh_close_deadline(&mut state, now);
        assert_eq!(state.close_deadline, None);

        // Settled reply awaiting its background phase, nothing pending: grace.
        state.saw_done = true;
        state.awaiting_tasks = true;
        refresh_close_deadline(&mut state, now);
        assert_eq!(state.close_deadline, Some(now + BACKGROUND_GRACE));

        // A live task bounds either phase with the stall length…
        state
            .pending_tasks
            .insert("task-1".into(), task_summary("task-1", false));
        refresh_close_deadline(&mut state, now);
        assert_eq!(state.close_deadline, Some(now + BACKGROUND_STALL));

        // …including an open turn (hollow-done resume or reopened follow-up).
        state.saw_done = false;
        state.awaiting_tasks = false;
        refresh_close_deadline(&mut state, now);
        assert_eq!(state.close_deadline, Some(now + BACKGROUND_STALL));
    }

    /// L1 回归：停滞上限的每次续期都不超过自首个任务起的绝对上限——心跳
    /// 循环的失控 CLI 不能把 run 的 stdin、进程与并发槽永远钉住。
    #[test]
    fn rearmed_deadlines_never_pass_the_absolute_cap() {
        let mut state = TurnState::new(None);
        state
            .pending_tasks
            .insert("task-1".into(), task_summary("task-1", false));
        let start = tokio::time::Instant::now();
        state.bg_phase_started = Some(start);

        // A re-arm 3.5 hours into the phase clamps to the 4-hour cap.
        let late = start + std::time::Duration::from_secs(3 * 60 * 60 + 30 * 60);
        refresh_close_deadline(&mut state, late);
        assert_eq!(state.close_deadline, Some(start + BACKGROUND_ABS_CAP));
    }

    /// C1 回归：补完回合流式期间最后一个任务结算，不得武装 30s 宽限——
    /// 回合活跃时 pending→0 必须清掉期限，否则宽限到点会 EOF 截断生成。
    #[tokio::test]
    async fn task_settling_during_an_active_turn_drops_the_deadline() {
        let (core, _collector) = core_for("settle-during-turn");
        let mut state = TurnState::new(None);
        state
            .pending_tasks
            .insert("task-1".into(), task_summary("task-1", false));
        // Content done with a live task: settled, awaiting the completion turn.
        core.dispatch_event(&mut state, EngineEvent::Delta("reply".into()));
        core.dispatch_event(&mut state, EngineEvent::Done { session_id: None, usage: None });
        assert!(state.saw_done && state.awaiting_tasks);

        // The completion turn starts: its first content frame reopens the run.
        core.dispatch_event(&mut state, EngineEvent::Delta("completion".into()));
        assert!(!state.saw_done && !state.awaiting_tasks);

        // The last task settles mid-stream: no grace may tick under the turn.
        core.dispatch_event(
            &mut state,
            EngineEvent::TaskNotification { id: "task-1".into(), status: "completed".into() },
        );
        assert_eq!(
            state.close_deadline, None,
            "an active turn with nothing pending must have no deadline"
        );
    }

    /// C1 回归（通知轮形态）：resume 的空 done 之后，用户回合流式期间旧任务
    /// 全部结算，同样不得留下会在回合中段触发的宽限；且内容帧本身要顺延
    /// 停滞上限，长回答不会被 30 分钟静默误判。
    #[tokio::test]
    async fn hollow_done_then_user_turn_is_never_grace_bounded() {
        let (core, _collector) = core_for("hollow-then-user-turn");
        let mut state = TurnState::new(None);
        state
            .pending_tasks
            .insert("task-1".into(), task_summary("task-1", false));
        // The CLI's queued reconciliation turn closes with no content.
        core.dispatch_event(&mut state, EngineEvent::Done { session_id: None, usage: None });
        assert!(!state.saw_done, "a content-free done leaves the run open");
        assert!(state.awaiting_tasks);
        let armed = state.close_deadline.expect("live tasks arm the stall bound");
        std::thread::sleep(std::time::Duration::from_millis(5));

        // The queued user turn streams: content re-arms the silence bound…
        core.dispatch_event(&mut state, EngineEvent::Delta("real reply".into()));
        assert!(
            state.close_deadline > Some(armed),
            "streaming content re-arms the silence bound"
        );

        // …and the old tasks settling mid-turn drop the deadline outright.
        core.dispatch_event(
            &mut state,
            EngineEvent::TaskNotification { id: "task-1".into(), status: "completed".into() },
        );
        assert_eq!(state.close_deadline, None);
    }

    /// H2 回归：经 task_started 缺口进入 pending 的条目，未经 level 帧确认前
    /// 其进度心跳不得顺延停滞上限；level 帧确认后恢复顺延。
    #[tokio::test]
    async fn unconfirmed_task_progress_does_not_rearm_the_stall() {
        let (core, _collector) = core_for("unconfirmed-progress");
        let mut state = TurnState::new(None);
        state.saw_done = true;
        state.awaiting_tasks = true;

        core.dispatch_event(
            &mut state,
            EngineEvent::TaskStarted {
                id: "task-gap".into(),
                task_type: "local_agent".into(),
                description: "monitor".into(),
                subagent_type: None,
                is_backgrounded: None,
                spawn_depth: None,
                workflow_name: None,
            },
        );
        let armed = state.close_deadline.expect("a new task arms the stall bound");
        std::thread::sleep(std::time::Duration::from_millis(5));

        core.dispatch_event(
            &mut state,
            EngineEvent::TaskProgress {
                id: "task-gap".into(),
                description: Some("heartbeat".into()),
                last_tool: None,
                usage: None,
            },
        );
        assert_eq!(
            state.close_deadline,
            Some(armed),
            "an unconfirmed (ambient-gap) heartbeat must not re-arm the stall bound"
        );

        // The level frame vouches for the task: progress re-arms again.
        core.dispatch_event(
            &mut state,
            EngineEvent::TasksChanged { tasks: vec![task_summary("task-gap", false)] },
        );
        std::thread::sleep(std::time::Duration::from_millis(5));
        core.dispatch_event(
            &mut state,
            EngineEvent::TaskProgress {
                id: "task-gap".into(),
                description: Some("heartbeat".into()),
                last_tool: None,
                usage: None,
            },
        );
        assert!(
            state.close_deadline > Some(armed),
            "a level-frame-confirmed task re-arms the bound on progress"
        );
    }

    /// The core of the stdin policy: a done with a live task must NOT EOF the
    /// CLI's stdin (that EOF is what makes the CLI sweep its own background
    /// tasks), and the reported count is what tells the frontend the turn
    /// keeps going in the background.
    #[tokio::test]
    async fn done_with_pending_task_keeps_stdin_open_and_reports_count() {
        let collector = Arc::new(Collector::default());
        let core = TurnCore {
            sink: event_sink::EventSink::new(collector.clone()),
            // close_stdin is a no-op for a key with no registered entry, so
            // this run id needs no registry fixture.
            registry: Arc::new(ProcessRegistry::default()),
            engine_id: "claude".into(),
            run_id: "done-with-task".into(),
        };
        let mut state = TurnState::new(None);
        state.pending_tasks.insert(
            "task-1".into(),
            TaskSummary {
                id: "task-1".into(),
                task_type: "local_bash".into(),
                description: "sleep 60".into(),
                ambient: false,
            },
        );
        core.dispatch_event(&mut state, EngineEvent::Done { session_id: None, usage: None });
        core.sink.flush();
        assert!(state.awaiting_tasks, "a live task must leave the run awaiting its completion turn");
        assert!(state.close_deadline.is_some(), "an awaiting run must arm a stdin-close deadline");
        let events = collector.0.lock().unwrap();
        let done = events
            .iter()
            .find(|event| event["kind"] == "done")
            .expect("done event was not pushed");
        assert_eq!(done["data"]["backgroundTasks"], 1);
    }

    /// Ambient tasks (session-scoped monitors/dream) ride along in the level
    /// signal but must never hold the run open: they do not finish inside a
    /// turn, so counting them would keep stdin open to the stall bound at
    /// every turn end and would report a nonzero background count in done.
    #[tokio::test]
    async fn ambient_tasks_never_hold_the_run_open() {
        let collector = Arc::new(Collector::default());
        let core = TurnCore {
            sink: event_sink::EventSink::new(collector.clone()),
            registry: Arc::new(ProcessRegistry::default()),
            engine_id: "claude".into(),
            run_id: "ambient-tasks".into(),
        };
        let mut state = TurnState::new(None);
        let ambient = |id: &str| TaskSummary {
            id: id.to_string(),
            task_type: "local_agent".into(),
            description: "monitor".into(),
            ambient: true,
        };
        core.dispatch_event(
            &mut state,
            EngineEvent::TasksChanged {
                tasks: vec![
                    ambient("task-monitor"),
                    TaskSummary {
                        id: "task-real".into(),
                        task_type: "local_bash".into(),
                        description: "pnpm test".into(),
                        ambient: false,
                    },
                ],
            },
        );
        assert_eq!(state.pending_tasks.len(), 1, "ambient task entered pending_tasks");
        assert!(state.pending_tasks.contains_key("task-real"));

        core.dispatch_event(
            &mut state,
            EngineEvent::TasksChanged { tasks: vec![ambient("task-monitor")] },
        );
        assert!(
            state.pending_tasks.is_empty(),
            "a frame carrying only ambient tasks must leave nothing pending"
        );

        // The frame itself still reaches the panel whole: filtering decides
        // what holds the run open, not what the background task list shows.
        core.sink.flush();
        let events = collector.0.lock().unwrap();
        let last = events
            .iter()
            .filter(|event| event["kind"] == "tasks")
            .last()
            .expect("tasks event was not pushed");
        assert_eq!(last["data"]["tasks"][0]["taskId"], "task-monitor");
        assert_eq!(last["data"]["tasks"][0]["ambient"], true);
    }

    fn core_for(run_id: &str) -> (TurnCore, Arc<Collector>) {
        let collector = Arc::new(Collector::default());
        (
            TurnCore {
                sink: event_sink::EventSink::new(collector.clone()),
                registry: Arc::new(ProcessRegistry::default()),
                engine_id: "claude".into(),
                run_id: run_id.into(),
            },
            collector,
        )
    }

    fn task_summary(id: &str, ambient: bool) -> TaskSummary {
        TaskSummary {
            id: id.to_string(),
            task_type: "local_bash".into(),
            description: "pnpm test".into(),
            ambient,
        }
    }

    /// A reply that settled with one task still running: awaiting the CLI's
    /// completion turn, the 30s close grace armed.
    fn awaiting_state() -> TurnState {
        let mut state = TurnState::new(None);
        state.pending_tasks.insert("task-1".into(), task_summary("task-1", false));
        state.saw_done = true;
        state.awaiting_tasks = true;
        state.close_deadline = Some(tokio::time::Instant::now() + BACKGROUND_GRACE);
        state
    }

    /// 通知轮的开头帧也算「回合已重新开始」：CLI 可能先吐 usage/model 一类的
    /// 前导帧再出正文，只把 Delta/Thinking/Message/Done 当重开信号的话，30s
    /// 宽限会在正文到达之前 EOF 掉 stdin，通知轮被从中间截断。
    #[tokio::test]
    async fn any_non_task_frame_cancels_the_background_grace() {
        for follow_up in [
            EngineEvent::Usage(serde_json::json!({ "input_tokens": 1 })),
            EngineEvent::Model("claude-sonnet-4".into()),
        ] {
            let (core, _collector) = core_for("grace-cancel");
            let mut state = awaiting_state();

            core.dispatch_event(&mut state, follow_up);

            assert!(!state.saw_done, "the follow-up turn reopened the run");
            assert!(!state.awaiting_tasks);
            // Tasks are still pending: the 30s grace is gone (it would EOF
            // stdin into the turn's preamble), but the stall bound must
            // survive — a follow-up turn that wedges before its done must
            // not pin stdin, the process, and its concurrency slot forever.
            let deadline = state
                .close_deadline
                .expect("a reopen with pending tasks keeps the stall bound");
            assert!(
                deadline >= tokio::time::Instant::now() + BACKGROUND_GRACE,
                "the re-armed bound is the stall length, not the grace"
            );
        }
    }

    /// 重开时已无待办任务（宽限期内的通知轮）：保留一个有界的兜底期限——
    /// 孤立前导帧（如与 done 竞态迟到的 SessionId）不是真实回合的证据，清空
    /// 期限会让 run 永久挂在打开状态；真实回合的第一个内容帧会把它清掉。
    #[tokio::test]
    async fn reopen_with_no_pending_tasks_keeps_a_bounded_fallback() {
        let (core, _collector) = core_for("grace-cancel-empty");
        let mut state = awaiting_state();
        state.pending_tasks.clear();

        core.dispatch_event(
            &mut state,
            EngineEvent::Usage(serde_json::json!({ "input_tokens": 1 })),
        );

        assert!(!state.saw_done && !state.awaiting_tasks);
        let fallback = state
            .close_deadline
            .expect("a stray frame must not strand the run: keep a bounded fallback");
        assert!(
            fallback > tokio::time::Instant::now() + BACKGROUND_GRACE,
            "the fallback is the stall length, not the grace"
        );

        // A real turn's first content frame drops the fallback outright.
        core.dispatch_event(&mut state, EngineEvent::Delta("completion".into()));
        assert_eq!(
            state.close_deadline, None,
            "streaming content clears the fallback"
        );
    }

    /// 反之，任务帧不是通知轮：等待与期限都该原地不动（任务进度只重设期限，
    /// 不改等待状态）。
    #[tokio::test]
    async fn task_frames_leave_the_wait_and_its_deadline_alone() {
        let (core, _collector) = core_for("task-frame-keeps-wait");
        let mut state = awaiting_state();
        let armed = state.close_deadline;

        core.dispatch_event(
            &mut state,
            EngineEvent::TaskNotification { id: "task-1".into(), status: "completed".into() },
        );

        assert!(state.saw_done && state.awaiting_tasks);
        assert!(
            state.close_deadline.is_some_and(|at| at >= armed.unwrap()),
            "a task frame re-arms the bound instead of dropping it"
        );
    }

    /// TaskProgress 只能为本 run 真正在等的任务顺延停滞上限：ambient（会话级）
    /// 任务的生命周期比 turn 长，它每次心跳若都重算期限，就等于把这根唯一的
    /// 时间杠杆无限顺延下去。
    #[tokio::test]
    async fn task_progress_only_rearms_for_a_task_the_run_waits_for() {
        let (core, _collector) = core_for("progress-rearm");
        let mut state = TurnState::new(None);
        state.pending_tasks.insert("task-1".into(), task_summary("task-1", false));
        state.awaiting_tasks = true;
        // A deadline already in the past: recomputing moves it, leaving it
        // alone keeps the exact value.
        let stale = tokio::time::Instant::now() - std::time::Duration::from_secs(60);
        state.close_deadline = Some(stale);

        core.dispatch_event(
            &mut state,
            EngineEvent::TaskProgress {
                id: "task-monitor".into(),
                description: Some("Running Wait 590 seconds".into()),
                last_tool: None,
                usage: None,
            },
        );
        assert_eq!(
            state.close_deadline,
            Some(stale),
            "an ambient task's heartbeat must not extend the stall bound"
        );

        core.dispatch_event(
            &mut state,
            EngineEvent::TaskProgress {
                id: "task-1".into(),
                description: Some("阶段: probe".into()),
                last_tool: None,
                usage: None,
            },
        );
        assert!(
            state.close_deadline > Some(stale),
            "the task the run waits for still re-arms the bound"
        );
    }
    /// 不改变待办集合的帧不得顺延 30s 宽限：ambient-only 的 level 帧、以及
    /// 本 run 从未跟踪的任务通知，都不能每次心跳白送 30s。
    #[tokio::test]
    async fn frames_that_change_nothing_do_not_rearm_the_grace() {
        let (core, _collector) = core_for("no-change-no-rearm");
        let mut state = TurnState::new(None);
        state.saw_done = true;
        state.awaiting_tasks = true;
        let armed = tokio::time::Instant::now() + BACKGROUND_GRACE;
        state.close_deadline = Some(armed);

        core.dispatch_event(
            &mut state,
            EngineEvent::TasksChanged {
                tasks: vec![task_summary("task-monitor", true)],
            },
        );
        assert_eq!(
            state.close_deadline,
            Some(armed),
            "an ambient-only level frame must not re-arm the grace"
        );

        core.dispatch_event(
            &mut state,
            EngineEvent::TaskNotification {
                id: "task-monitor".into(),
                status: "completed".into(),
            },
        );
        assert_eq!(
            state.close_deadline,
            Some(armed),
            "a notification for an untracked task must not re-arm the grace"
        );
    }

    /// 后台期进程静默死亡：saw_done 已真，前端等不到任何终局帧，只能等 30 分钟
    /// 的 orphan sweep，期间尾部一直「运行中」。退出路径补一帧空 level 帧
    /// （REPLACE 语义），前端把该 run 的 running 行收敛为 stopped。
    #[tokio::test]
    async fn a_run_dying_with_pending_tasks_reports_an_empty_level_frame() {
        let (core, collector) = core_for("exit-with-tasks");
        let mut state = TurnState::new(None);
        state.pending_tasks.insert("task-1".into(), task_summary("task-1", false));

        push_final_task_frame(&mut state, &core);

        core.sink.flush();
        assert!(state.pending_tasks.is_empty());
        let events = collector.0.lock().unwrap();
        let last = events.last().expect("no final task frame was pushed");
        assert_eq!(last["kind"], "tasks");
        assert_eq!(
            last["data"]["tasks"].as_array().map(Vec::len),
            Some(0),
            "the level frame must be the empty live set"
        );
    }

    /// 没有挂起任务时退出不是「后台期死亡」：不该多推任何帧（否则每个正常
    /// 结束的 run 都会多一帧空列表，把面板的 running 行无谓地结算一遍）。
    #[tokio::test]
    async fn a_run_dying_without_pending_tasks_pushes_nothing() {
        let (core, collector) = core_for("exit-without-tasks");
        let mut state = TurnState::new(None);

        push_final_task_frame(&mut state, &core);

        core.sink.flush();
        assert!(collector.0.lock().unwrap().is_empty());
    }
}
