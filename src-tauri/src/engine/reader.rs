//! Stdout reader and per-turn streaming state: the capped line reader,
//! event dispatch core, and settle/cleanup path for engine process runs.

use super::codex_usage;
use super::events::EngineEvent;
#[cfg(test)]
use super::grok;
#[cfg(windows)]
use super::job;
use super::plan_review;
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
/// Event-routing core shared by process runs ([`RunContext`]) and virtual
/// host-stream runs ([`dsh_session::run_host_turn`]): the fields
/// `dispatch_event` needs to route engine events to the UI sink and keep the
/// registry's session aliasing in step.
pub(crate) struct TurnCore {
    pub(crate) sink: Arc<event_sink::EventSink>,
    pub(crate) registry: Arc<ProcessRegistry>,
    pub(crate) engine_id: String,
    pub(crate) run_id: String,
    /// 审批事实源:计划事件到达即落盘(engine/plan_review.rs)。驱动内部与
    /// 测试构造点没有 db 句柄时为 None——那些路径不产生计划事件。
    pub(crate) db: Option<Arc<crate::db::Db>>,
}
/// 停住的计划审批随运行消亡:原生请求不再有效,记录过期并推送
/// PlanReviewSettled,历史 UI 不得假装还能批准(PRD §8 防线 3)。
/// host-transport 驱动(dsh/grok/qoder/codex/omp-acp)在自己的 settle 段
/// 对每个注册键调用一次,语义与 run_reader 的收尾一致。无 db 句柄的
/// 路径不产生计划事件,plans 必然为空。
pub(crate) fn expire_parked_plans(core: &TurnCore, state: &mut TurnState, key: &str) {
    let Some(db) = &core.db else {
        return;
    };
    let parked: Vec<(String, i64)> = core
        .registry
        .take_plans(key)
        .into_iter()
        .map(|(plan_id, revision, _)| (plan_id, revision))
        .collect();
    if let Ok(expired) = plan_review::expire_reviews(db, &parked) {
        for (plan_id, revision, _previous) in expired {
            core.dispatch_event(state, EngineEvent::PlanReviewSettled {
                plan_id,
                revision,
                status: plan_review::PlanStatus::Expired.as_str().to_string(),
            });
        }
    }
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
        // Terminal state is monotonic, even if a CLI or its usage tail emits
        // more data before exiting: no late retry/content/warn event may
        // revive a settled run. The one exception is SessionId — a done that
        // raced the CLI's session announcement must still rekey/announce, or
        // the conversation strands under its provisional key.
        if (state.saw_done || state.saw_error) && !matches!(event, EngineEvent::SessionId(_)) {
            return;
        }
        match event {
            EngineEvent::AgentActivity { active } => {
                if self.registry.set_agent_active(&self.run_id, active) {
                    state.push(&self.sink, &self.run_id, &self.engine_id,
                        "live_compact_ready", serde_json::json!({"active": active}));
                }
            }
            EngineEvent::AssistantMessageStart => state.push(
                &self.sink,
                &self.run_id,
                &self.engine_id,
                "assistant_message_start",
                Value::Null,
            ),
            EngineEvent::AssistantMessageEnd => state.push(
                &self.sink,
                &self.run_id,
                &self.engine_id,
                "assistant_message_end",
                Value::Null,
            ),
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
                tool_call_id,
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
                // The engine's own call id, when it reported one: the
                // frontend pairs a result with its call on this rather than
                // on the tool name, which collides across parallel calls.
                if let Some(tool_call_id) = tool_call_id {
                    payload["toolCallId"] = Value::String(tool_call_id);
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
                if !self.registry.observe_compaction(&self.run_id, active, reason.as_deref()) {
                    return;
                }
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
            EngineEvent::PlanDraft {
                plan_id,
                text,
                replace,
            } => {
                // 草稿只是预览:不落盘为可审批版本,UI 不得据此激活批准。
                state.push(
                    &self.sink,
                    &self.run_id,
                    &self.engine_id,
                    "plan_draft",
                    serde_json::json!({
                        "planId": plan_id,
                        "text": text,
                        "replace": replace,
                    }),
                );
            }
            EngineEvent::PlanReviewReady { record, context } => {
                state.gen_end();
                // 完整正文 + 等待点确认后才落盘/下发 awaiting_review;原生
                // 回复上下文只停在后端注册表,事件载荷永不含它。
                let mut record = *record;
                if let Some(db) = &self.db {
                    match plan_review::record_review(db, &record) {
                        Ok(revision) => record.revision = revision,
                        Err(error) => {
                            // 审批事实源写不进去就不能假装可审批:按错误
                            // 落定,原生上下文不停车,等待点随运行结束消亡。
                            self.dispatch_event(
                                state,
                                EngineEvent::Error(format!(
                                    "plan review could not be persisted: {error}"
                                )),
                            );
                            return;
                        }
                    }
                }
                // next_turn(Codex)没有活的原生请求:计划轮次已正常结束,
                // 批准=另起一次执行 turn;审批元数据在记录本体(session_id=
                // 线程、native_plan_id=item、content_hash),不停车——否则
                // 运行一结束就被 expire,用户永远批不了。native_request 才
                // 停车,形状与 respond_plan_review 的读取约定一致:
                // {revision, route, frames, ...} 顶层平铺——context 是适配器
                // 产出的对象,revision 由后端注入,适配器不得占用该键。
                if record.review_kind == plan_review::PlanReviewKind::NativeRequest {
                if let Some(entry) = self.registry.get(&self.run_id) {
                    if let Ok(mut plans) = entry.plans.lock() {
                        let mut parked = context;
                        if let Some(map) = parked.as_object_mut() {
                            map.insert(
                                "revision".to_string(),
                                serde_json::Value::from(record.revision),
                            );
                        } else {
                            parked = serde_json::json!({
                                "revision": record.revision,
                                "opaque": parked,
                            });
                        }
                        plans.insert(record.plan_id.clone(), parked);
                    }
                }
                }
                let payload = serde_json::to_value(&record)
                    .unwrap_or_else(|_| serde_json::json!({ "planId": record.plan_id }));
                state.push(&self.sink, &self.run_id, &self.engine_id, "plan_review", payload);
            }
            EngineEvent::PlanReviewSettled {
                plan_id,
                revision,
                status,
            } => {
                if let Some(entry) = self.registry.get(&self.run_id) {
                    if let Ok(mut plans) = entry.plans.lock() {
                        plans.remove(&plan_id);
                    }
                }
                state.push(
                    &self.sink,
                    &self.run_id,
                    &self.engine_id,
                    "plan_review_settled",
                    serde_json::json!({
                        "planId": plan_id,
                        "revision": revision,
                        "status": status,
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
            EngineEvent::Launch {
                model,
                effort,
                comparison_model,
            } => {
                let mut payload = selection_payload(model, effort);
                if let Some(model) = comparison_model {
                    payload["comparisonModel"] = model.map(Value::String).unwrap_or(Value::Null);
                }
                state.push(&self.sink, &self.run_id, &self.engine_id, "launch", payload);
            }
            EngineEvent::Served { model, effort } => {
                state.push(
                    &self.sink,
                    &self.run_id,
                    &self.engine_id,
                    "served",
                    selection_payload(model, effort),
                );
            }
            EngineEvent::McpServers { servers, tools } => {
                // Not a chat event: the MCP settings page reads this snapshot
                // (workspace-scoped, timestamped) instead of the stream.
                crate::mcp::record_from_run(
                    &self.run_id,
                    state.native_session_id.as_deref(),
                    servers,
                    tools,
                );
            }
            EngineEvent::Done { session_id, usage } => {
                let gen_ms = state.take_gen_ms();
                state.saw_done = true;
                crate::mcp::mark_run_ended(&self.run_id);
                if let Some(id) = session_id {
                    self.adopt_session_id(state, &id, false);
                }
                // The turn is over: EOF the interactive stdin so the CLI
                // exits instead of waiting for a next message forever.
                self.registry.close_stdin(&self.run_id);
                state.push_with_gen_ms(
                    &self.sink,
                    &self.run_id,
                    &self.engine_id,
                    "done",
                    serde_json::json!({ "usage": usage }),
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
    pub(crate) comparison_model: Option<Option<String>>,
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
/// `{model?, effort?}` for the launch/served selection events. Absent sides
/// are omitted, not nulled: a sparse report must never read as an
/// authoritative empty one.
fn selection_payload(model: Option<String>, effort: Option<String>) -> Value {
    let mut out = serde_json::Map::new();
    if let Some(model) = model.filter(|m| !m.trim().is_empty()) {
        out.insert("model".to_string(), Value::String(model));
    }
    if let Some(effort) = effort.filter(|e| !e.trim().is_empty()) {
        out.insert("effort".to_string(), Value::String(effort));
    }
    Value::Object(out)
}
/// Read NDJSON stdout until EOF, dispatch events, then settle the turn:
/// registry cleanup, temp-file cleanup, and the terminal done/error event.
pub(crate) async fn run_reader(stdout: ChildStdout, ctx: RunContext) {
    let mut state = TurnState::new(ctx.preassigned_session_id.clone());
    // The launch selection is one `launch` event, not `model`/`effort`
    // reports: the response check compares it against what the stream later
    // reports as served, and neither side may be read as the other.
    if ctx.initial_model.is_some() || ctx.initial_effort.is_some() {
        ctx.dispatch_event(
            &mut state,
            EngineEvent::Launch {
                comparison_model: ctx.comparison_model.clone(),
                model: ctx.initial_model.clone(),
                effort: ctx.initial_effort.clone(),
            },
        );
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
        let read = tokio::select! {
            line = read_line_capped(&mut reader, &mut line_buf) => line,
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
        expire_parked_plans(&ctx.core, &mut state, &key);
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

    if !state.saw_done && !state.saw_error {
        let killed = ctx.killed.load(std::sync::atomic::Ordering::SeqCst);
        if killed {
            // User-initiated stop: commit whatever streamed so far as a
            // normal turn end — a SIGKILL'd child is not a failure.
            state.push(
                &ctx.core.sink,
                &ctx.core.run_id,
                &ctx.core.engine_id,
                "done",
                serde_json::json!({ "usage": null }),
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
                serde_json::json!({ "usage": null }),
            );
        }
    }
    if status.is_some() {
        state.confirm_exit(&ctx.core);
    }
    ctx.core.sink.flush();
}
#[cfg(test)]
mod staging_tests {
    use super::*;
    use crate::engine::ChildEntry;
    use std::collections::HashMap;

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

    /// Absent sides stay absent: a sparse report must never read as an
    /// authoritative empty one.
    #[test]
    fn selection_payload_omits_unreported_sides() {
        assert_eq!(
            selection_payload(Some("claude-opus-5-5".to_string()), None),
            serde_json::json!({ "model": "claude-opus-5-5" })
        );
        assert_eq!(
            selection_payload(None, Some("xhigh".to_string())),
            serde_json::json!({ "effort": "xhigh" })
        );
        assert_eq!(
            selection_payload(Some(" ".to_string()), Some(String::new())),
            serde_json::json!({})
        );
    }

    #[tokio::test]
    async fn launch_event_preserves_resolved_and_unresolved_alias_evidence() {
        struct Capture(Mutex<Vec<Value>>);
        impl event_sink::Emit for Capture {
            fn emit_json(&self, _: &str, payload: &str) {
                self.0
                    .lock()
                    .unwrap()
                    .push(serde_json::from_str(payload).unwrap());
            }
        }
        let capture = Arc::new(Capture(Mutex::new(Vec::new())));
        let sink = event_sink::EventSink::new(capture.clone());
        let core = TurnCore {
            sink,
            registry: Arc::new(ProcessRegistry::default()),
            engine_id: "claude".into(),
            run_id: "test".into(),
            db: None,
        };
        let mut state = TurnState::new(None);
        for model in [Some("claude-opus-5-5".to_string()), None] {
            core.dispatch_event(
                &mut state,
                EngineEvent::Launch {
                    model: Some("opus".into()),
                    effort: Some("high".into()),
                    comparison_model: Some(model),
                },
            );
        }
        core.sink.flush();
        let emitted = capture.0.lock().unwrap();
        let events: Vec<_> = emitted
            .iter()
            .flat_map(|batch| batch.as_array().unwrap())
            .collect();
        assert_eq!(
            events[0]["data"],
            serde_json::json!({"model":"opus", "effort":"high", "comparisonModel":"claude-opus-5-5"})
        );
        assert_eq!(
            events[1]["data"],
            serde_json::json!({"model":"opus", "effort":"high", "comparisonModel":null})
        );
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
                    db: None,
                },
                engine_impl: Box::new(grok::GrokEngine),
                pid: 0,
                preassigned_session_id: None,
                initial_model: None,
                comparison_model: None,
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
            plans: Arc::new(Mutex::new(HashMap::new())),
            live_compact: None,
        };
        registry.insert("run-abort".into(), entry.clone());
        registry.insert_alias("session-abort".into(), entry);
        let ctx = RunContext {
            core: TurnCore {
                sink: event_sink::EventSink::new(Arc::new(Noop)),
                registry: Arc::clone(&registry),
                engine_id: "grok".into(),
                run_id: "run-abort".into(),
                db: None,
            },
            engine_impl: Box::new(grok::GrokEngine),
            pid: 4242,
            preassigned_session_id: None,
            initial_model: None,
            comparison_model: None,
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
            plans: Arc::new(Mutex::new(HashMap::new())),
            live_compact: None,
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
                plans: Arc::new(Mutex::new(HashMap::new())),
                live_compact: None,
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
    struct Collector(parking_lot::Mutex<Vec<Value>>);
    impl event_sink::Emit for Collector {
        fn emit_json(&self, _: &str, raw: &str) {
            self.0
                .lock()
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
                    db: None,
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
                assert!(collector.0.lock().is_empty());
                state.confirm_exit(&core);
                state.confirm_exit(&core);
                core.sink.flush();
                let events = collector.0.lock();
                assert_eq!(events.len(), 1);
                assert_eq!(events[0]["kind"], if fail { "error" } else { "done" });
            }
        }
    }

    #[tokio::test]
    async fn assistant_boundaries_use_the_ordered_run_envelope_without_settling() {
        let collector = Arc::new(Collector::default());
        let core = TurnCore {
            sink: event_sink::EventSink::new(collector.clone()),
            registry: Arc::new(ProcessRegistry::default()),
            engine_id: "omp".into(),
            run_id: "assistant-boundary-test".into(),
            db: None,
        };
        let mut state = TurnState::new(Some("session".into()));
        state.attempt_error = Some("previous attempt".into());
        core.dispatch_event(&mut state, EngineEvent::Generation { active: true });
        let generation_start = state.gen_open_since;
        for event in [
            EngineEvent::AssistantMessageStart,
            EngineEvent::Thinking("reason".into()),
            EngineEvent::Delta("first".into()),
            EngineEvent::AssistantMessageEnd,
            EngineEvent::AssistantMessageStart,
            EngineEvent::Delta("second".into()),
            EngineEvent::AssistantMessageEnd,
        ] {
            core.dispatch_event(&mut state, event);
        }
        assert!(!state.saw_done && !state.saw_error);
        assert_eq!(state.attempt_error.as_deref(), Some("previous attempt"));
        assert_eq!(state.gen_open_since, generation_start);
        assert!(state.gen_explicit);
        core.sink.flush();
        let events = collector.0.lock();
        let kinds: Vec<_> = events.iter().map(|event| event["kind"].as_str().unwrap()).collect();
        assert_eq!(kinds, [
            "assistant_message_start", "thinking", "delta", "assistant_message_end",
            "assistant_message_start", "delta", "assistant_message_end",
        ]);
        for (index, event) in events.iter().enumerate() {
            assert_eq!(event["runId"], "assistant-boundary-test");
            assert_eq!(event["sessionId"], "session");
            assert_eq!(event["engine"], "omp");
            assert_eq!(event["seq"], (index + 1) as u64);
            if matches!(event["kind"].as_str(), Some("assistant_message_start" | "assistant_message_end")) {
                assert_eq!(event.get("data"), Some(&Value::Null));
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
            db: None,
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
            tool_call_id: None,
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
        let events = collector.0.lock();
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
                db: None,
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
            core.dispatch_event(&mut state, EngineEvent::AssistantMessageStart);
            core.dispatch_event(&mut state, EngineEvent::AssistantMessageEnd);
            core.dispatch_event(
                &mut state,
                EngineEvent::Done {
                    session_id: None,
                    usage: None,
                },
            );
            core.sink.flush();
            let events = collector.0.lock();
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
                    plans: Arc::new(Mutex::new(std::collections::HashMap::new())),
                    live_compact: None,
                },
            );
            let context = RunContext {
                core: TurnCore {
                    sink: sink.clone(),
                    registry: registry.clone(),
                    engine_id: "pi".into(),
                    run_id: run_id.into(),
                    db: None,
                },
                engine_impl: Box::new(crate::engine::pi_family::pi()),
                pid,
                preassigned_session_id: None,
                initial_model: None,
                comparison_model: None,
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
                    if !collector.0.lock().is_empty() {
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
                .iter()
                .any(|event| matches!(event["kind"].as_str(), Some("done" | "error"))));
            assert!(registry.kill(run_id));
            tokio::time::timeout(std::time::Duration::from_secs(3), reader)
                .await
                .unwrap()
                .unwrap();
            assert!(child.lock().await.try_wait().unwrap().is_some());
            assert_eq!(registry.active_run_count(), 0);
            let events = collector.0.lock();
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
}
#[cfg(test)]
mod plan_dispatch_tests {
    //! PlanReviewReady 的 dispatch 契约:落盘赋 revision、停车上下文顶层
    //! 平铺 {revision, route, frames, ...}(respond_plan_review 按此读取)、
    //! 事件载荷不含原生上下文;审批事实源写失败则转 Error 落定、不停车。
    use super::*;
    use crate::engine::ChildEntry;
    use std::collections::HashMap;

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

    fn ready_core(
        tag: &str,
        drop_table: bool,
    ) -> (TurnCore, Arc<Collector>, Arc<crate::db::Db>) {
        let dir = std::env::temp_dir().join(format!(
            "ccgui-plan-dispatch-{tag}-{}-{}",
            std::process::id(),
            plan_review::now_ms()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let db = Arc::new(crate::db::Db::open_at(&dir.join("app.db")).unwrap());
        if drop_table {
            db.0.lock()
                .execute("DROP TABLE plan_reviews", [])
                .unwrap();
        }
        let collector = Arc::new(Collector::default());
        let core = TurnCore {
            sink: event_sink::EventSink::new(collector.clone()),
            registry: Arc::new(ProcessRegistry::default()),
            engine_id: "dsh".into(),
            run_id: "run-plan".into(),
            db: Some(Arc::clone(&db)),
        };
        core.registry.insert(
            "run-plan".into(),
            ChildEntry {
                child: None,
                pid: 4242,
                run_id: "run-plan".into(),
                killed: Arc::new(std::sync::atomic::AtomicBool::new(false)),
                reader_abort: Arc::new(std::sync::OnceLock::new()),
                stdin: None,
                questions: Arc::new(Mutex::new(HashMap::new())),
                plans: Arc::new(Mutex::new(HashMap::new())),
                live_compact: None,
            },
        );
        (core, collector, db)
    }

    fn review(plan_id: &str) -> plan_review::PlanReview {
        plan_review::PlanReview {
            plan_id: plan_id.into(),
            engine: "dsh".into(),
            session_id: "sess-plan".into(),
            workspace_path: "/tmp/ccgui-plan-dispatch-ws".into(),
            run_id: Some("run-plan".into()),
            revision: 0,
            title: "Dispatch plan".into(),
            content: "# Plan\n\nbody".into(),
            content_hash: plan_review::content_hash("# Plan\n\nbody"),
            complete: true,
            review_kind: plan_review::PlanReviewKind::NativeRequest,
            native_plan_id: Some("native-1".into()),
            exec_permission: "auto".into(),
            status: plan_review::PlanStatus::AwaitingReview,
            execution: plan_review::PlanExecution::NotStarted,
            decision: None,
            decision_intent_at: None,
            applied_at: None,
            created_at: 0,
            updated_at: 0,
            superseded_by: None,
        }
    }

    #[tokio::test]
    async fn plan_review_ready_persists_parks_flat_and_emits_without_context() {
        let (core, collector, db) = ready_core("ok", false);
        let mut state = TurnState::new(Some("sess-plan".into()));
        core.dispatch_event(
            &mut state,
            EngineEvent::PlanReviewReady {
                record: Box::new(review("plan-x")),
                context: serde_json::json!({
                    "route": "stdin",
                    "frames": {"approve": {"ok": true}},
                }),
            },
        );
        core.sink.flush();

        // 落盘:revision 由后端赋值。
        let stored = plan_review::get_review(&db, "plan-x", 1)
            .unwrap()
            .expect("record persisted");
        assert_eq!(stored.revision, 1);
        assert_eq!(stored.status, plan_review::PlanStatus::AwaitingReview);

        // 停车:context 顶层平铺 + 后端注入的 revision,供 respond 直接读。
        let entry = core.registry.get("run-plan").unwrap();
        let parked = entry.plans.lock().unwrap().get("plan-x").cloned().unwrap();
        assert_eq!(parked["revision"], 1);
        assert_eq!(parked["route"], "stdin");
        assert!(parked["frames"]["approve"]["ok"].as_bool().unwrap());

        // 事件:camelCase record,永不含原生回复上下文。
        let events = collector.0.lock().unwrap();
        let payload = events
            .iter()
            .find(|event| event["kind"].as_str() == Some("plan_review"))
            .expect("plan_review event emitted");
        assert_eq!(payload["data"]["planId"], "plan-x");
        assert_eq!(payload["data"]["revision"], 1);
        assert_eq!(payload["sessionId"], "sess-plan");
        assert!(payload["data"].get("context").is_none(), "{payload}");
        assert!(payload["data"].get("frames").is_none(), "{payload}");
    }

    #[tokio::test]
    async fn a_persistence_failure_settles_as_error_without_parking() {
        let (core, collector, _db) = ready_core("fail", true);
        let mut state = TurnState::new(Some("sess-plan".into()));
        core.dispatch_event(
            &mut state,
            EngineEvent::PlanReviewReady {
                record: Box::new(review("plan-y")),
                context: serde_json::json!({"route": "stdin"}),
            },
        );
        core.sink.flush();

        // 审批事实源写不进去:不停车、不推 plan_review,按 Error 落定——
        // 绝不假装这个计划可以审批。
        let entry = core.registry.get("run-plan").unwrap();
        assert!(entry.plans.lock().unwrap().is_empty());
        let events = collector.0.lock().unwrap();
        assert!(
            events
                .iter()
                .all(|event| event["kind"].as_str() != Some("plan_review")),
            "{events:?}"
        );
        let error = events
            .iter()
            .find(|event| event["kind"].as_str() == Some("error"))
            .expect("persistence failure surfaces as error");
        assert!(
            error["data"]
                .as_str()
                .unwrap()
                .contains("could not be persisted"),
            "{error}"
        );
    }
}
