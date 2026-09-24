//! Codex **app-server** transport (`codex app-server`), the codex path that can
//! actually ask the user a question mid-turn.
//!
//! The exec transport (`codex.rs`) launches the same CLI one-shot: it resolves
//! its own `requestUserInput` prompts from the defaults baked into the run, so a
//! question never reaches the app's card UI. The app-server is a resident
//! JSON-RPC peer instead — it *asks* by sending a server→client request and
//! parks the turn until an answer arrives on stdin. This module owns that
//! channel: the pump that reads stdout, the projection of the protocol's items
//! onto the app's event kinds, and `answer_frame`, the response the shared
//! answer command writes when the user picks an option.
//!
//! Wire (verified against the installed CLI, whose shipped JSON schema is the
//! source of truth here): `initialize {clientInfo}` → `thread/start
//! {cwd, sandbox, approvalPolicy}` (or `thread/resume {threadId}` for a session
//! the app already holds) → `turn/start {threadId, input}`, which acknowledges
//! immediately with `{turn:{id}}`; the work then streams as `item/*` and
//! `item/agentMessage/delta` notifications and only `turn/completed` ends the
//! turn. Two schema facts shape the code below: `turn/completed` carries no
//! usage (it arrives earlier via `thread/tokenUsage/updated`), and there is no
//! `turn/failed` notification — a failed turn is a `turn/completed` whose
//! `turn.status` is `failed` with an explanatory `turn.error.message`. Both
//! shapes are terminal so a newer CLI cannot hang the pump until the prompt
//! timeout.
//!
//! Approvals are declined, never granted: the CLI runs with
//! `approvalPolicy: "never"` and the sandbox is the enforced boundary, exactly
//! as the exec transport's auto-decline behaves, so answering "approve" here
//! would hand the model a privilege the app never offered.

use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Map, Value};
use tokio::io::{AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex as TokioMutex;
use tokio::time::{timeout, Instant};

use super::codex_read_only;
use super::images;
use super::qoder_session::{
    encode_ndjson, jsonrpc_id_key, jsonrpc_request, jsonrpc_result_response, teardown, KILL_POLL,
    PROMPT_TIMEOUT, RPC_HANDSHAKE_TIMEOUT,
};
use super::{
    assistant_message, read_line_capped, spawn_stderr_capture, tool_call_message,
    tool_result_patch, BuiltCommand, EngineEvent, LineRead, SendRequest, TurnCore, TurnState,
    VirtualRunGuard, MAX_LINE_BYTES,
};

/// Terminal marker for a kill-interrupted turn. The driver swallows it (the
/// killed flag already said why) and lets the turn settle as an interruption,
/// the same contract as the sibling drivers.
const CANCELLED: &str = "codex turn cancelled";

/// `thread/start` builds the thread's context before it can answer — on a large
/// workspace that is the expensive call of the whole turn, so it gets far more
/// headroom than a plain RPC.
const THREAD_TIMEOUT: Duration = Duration::from_secs(90);
/// `thread/resume` only re-attaches an existing thread.
const RESUME_TIMEOUT: Duration = Duration::from_secs(30);
/// Grace for the CLI to react to `turn/interrupt` with its own terminal
/// notification before the process tree is killed anyway.
const INTERRUPT_SETTLE_TIMEOUT: Duration = Duration::from_secs(2);

/// What a pump call is waiting for.
enum Expect<'a> {
    /// The reply to the request whose id key is carried here.
    Reply(&'a str),
    /// No reply — the turn's own terminal notification ends this pump.
    Turn,
}

/// How the pump should treat one decoded line.
enum Handled {
    /// Nothing for the turn; keep reading.
    Ignore,
    /// Answer this server→client request now.
    Answer(Value),
    /// The request was parked for the user: do not answer it here, the answer
    /// command writes the response on the shared stdin later.
    Parked,
    /// The turn is over.
    Ended,
}

/// Per-run projection state: what streamed, and what to report at settle time.
#[derive(Default)]
struct TurnView {
    /// Item id whose text already streamed as deltas. A completed
    /// `agentMessage` repeats that text in full, and a `message` row appends as
    /// a settled snapshot (the UI collapses the live row first), so replaying
    /// it would print the answer twice. Same for reasoning.
    streamed_message: Option<String>,
    streamed_reasoning: Option<String>,
    /// Turn id from the `turn/start` reply — the handle `turn/interrupt` needs.
    turn_id: Option<String>,
    /// Last `thread/tokenUsage/updated` payload, folded into this turn's Done:
    /// the terminal notification itself carries no usage.
    last_usage: Option<Value>,
    exit_unconfirmed: bool,
    isolated_home: Option<std::path::PathBuf>,
}

/// A turn's JSON-RPC channel to one `codex app-server` child.
struct AppServer {
    /// Shared with the registry: the answer command writes a parked question's
    /// response on this same pipe, so the lock is the only serialization point
    /// between the two writers.
    stdin: Arc<TokioMutex<Option<ChildStdin>>>,
    stdout: BufReader<ChildStdout>,
    line_buf: Vec<u8>,
    next_id: u64,
}

impl AppServer {
    fn new(stdin: Arc<TokioMutex<Option<ChildStdin>>>, stdout: ChildStdout) -> Self {
        Self {
            stdin,
            stdout: BufReader::new(stdout),
            line_buf: Vec::new(),
            next_id: 1,
        }
    }

    async fn write(&self, value: &Value) -> Result<(), String> {
        let bytes = encode_ndjson(value)?;
        let mut guard = self.stdin.lock().await;
        let Some(stdin) = guard.as_mut() else {
            return Err("codex stdin is already closed".to_string());
        };
        stdin
            .write_all(&bytes)
            .await
            .map_err(|error| format!("codex stdin write failed: {error}"))?;
        stdin
            .flush()
            .await
            .map_err(|error| format!("codex stdin flush failed: {error}"))
    }

    /// Send a request and return the id key its reply will carry.
    async fn request(&mut self, method: &str, params: Value) -> Result<String, String> {
        let id = self.next_id;
        self.next_id += 1;
        self.write(&jsonrpc_request(id, method, params)).await?;
        Ok(id.to_string())
    }

    /// Read until this pump's expectation is met.
    ///
    /// `Ok(Some(result))` is the awaited reply; `Ok(None)` means the turn ended
    /// first — a fast turn can finish before its `turn/start` reply is read, and
    /// the turn pump ends on `turn/completed` rather than on any reply. Lines
    /// are classified locally (method+id is a server→client request, method
    /// alone a notification, id alone a reply) because codex speaks plain
    /// JSON-RPC, unlike the ACP framing the sibling drivers parse.
    async fn pump(
        &mut self,
        label: &str,
        expect: Expect<'_>,
        deadline: Instant,
        killed: &AtomicBool,
        interrupt: Option<(&str, &str)>,
        // `Send` is required: the driver runs inside a spawned task, and a
        // bare trait object would make the whole turn future non-Send.
        on_message: &mut (dyn FnMut(&Value) -> Handled + Send),
    ) -> Result<Option<Value>, String> {
        let mut interrupted = false;
        let mut deadline = deadline;
        loop {
            if killed.load(Ordering::SeqCst) {
                match interrupt {
                    // Ask the CLI to stop the turn itself: its `interrupted`
                    // completion is what lets it persist the rollout before the
                    // tree dies, so it gets a bounded window to do that instead
                    // of a pipe yanked out from under it. This must carry an id
                    // — measured against this CLI, a bare notification is
                    // ignored and the turn runs on to completion — and its own
                    // reply is dropped by the pump, which is waiting on the
                    // completion, not on the acknowledgement.
                    Some((thread_id, turn_id)) if !interrupted => {
                        interrupted = true;
                        deadline = deadline.min(Instant::now() + INTERRUPT_SETTLE_TIMEOUT);
                        self.request(
                            "turn/interrupt",
                            json!({ "threadId": thread_id, "turnId": turn_id }),
                        )
                        .await?;
                    }
                    // Already asked: read on until the window closes.
                    Some(_) => {}
                    // Nothing to interrupt, so there is no turn left to settle.
                    // The answer command still needs the registry entry, so
                    // this returns rather than tearing the child down here.
                    None => return Err(CANCELLED.to_string()),
                }
            }
            // Poll in short slices instead of blocking on the socket, so a kill
            // is honored within KILL_POLL rather than at the next line.
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(if interrupted {
                    CANCELLED.to_string()
                } else {
                    format!("{label} timed out")
                });
            }
            let line = match timeout(
                remaining.min(KILL_POLL),
                read_line_capped(&mut self.stdout, &mut self.line_buf),
            )
            .await
            {
                // Idle tick with no complete line yet.
                Err(_) => continue,
                Ok(Err(error)) => return Err(format!("{label}: reading codex stdout: {error}")),
                Ok(Ok(LineRead::Eof)) => {
                    return Err(format!("{label}: the codex app-server closed stdout"))
                }
                Ok(Ok(LineRead::TooLong)) => {
                    // Mirrors the host reader's own terminal message: a line
                    // this large is a stuck CLI, not an event.
                    return Err(format!(
                        "codex emitted a line over {} MiB without a newline; run terminated",
                        MAX_LINE_BYTES / (1024 * 1024),
                    ));
                }
                // The Codex app-server wait loop has no background-task
                // deadline; only the shared reader synthesizes this variant.
                // Keep this polling loop alive if the shared result type grows
                // another deadline source in the future.
                Ok(Ok(LineRead::Deadline)) => continue,
                Ok(Ok(LineRead::Line(line))) => line,
            };
            let text = String::from_utf8_lossy(&line);
            let trimmed = text.trim();
            if trimmed.is_empty() {
                continue;
            }
            let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
                // Not JSON-RPC at all (a stray banner): nothing to answer, and
                // no peer is blocked on it.
                continue;
            };
            let id = value.get("id").filter(|id| !id.is_null());
            if value.get("method").is_none() {
                // A reply. Anything we are not waiting for is dropped: a resume
                // can deliver a leftover frame for an earlier request.
                let Expect::Reply(key) = expect else {
                    continue;
                };
                if jsonrpc_id_key(id.unwrap_or(&Value::Null)).as_deref() != Some(key) {
                    continue;
                }
                if let Some(error) = value.get("error") {
                    // Label-free so `terminal_message` surfaces the CLI's own
                    // words instead of this driver's.
                    return Err(format!(
                        "rpc:{}:{}",
                        error.get("code").and_then(Value::as_i64).unwrap_or(0),
                        error
                            .get("message")
                            .and_then(Value::as_str)
                            .unwrap_or("codex reported an error"),
                    ));
                }
                return Ok(Some(value.get("result").cloned().unwrap_or(Value::Null)));
            }
            match on_message(&value) {
                Handled::Ended => return Ok(None),
                // Only a request (method + id) expects a response; a
                // notification that routed to an answer has no peer waiting.
                Handled::Answer(frame) if id.is_some() => self.write(&frame).await?,
                // Parked (the user answers later) or nothing to do.
                _ => {}
            }
        }
    }
}

/// Classify and project one decoded frame.
fn route(core: &TurnCore, state: &mut TurnState, view: &mut TurnView, value: &Value) -> Handled {
    let Some(method) = value.get("method").and_then(Value::as_str) else {
        return Handled::Ignore;
    };
    let params = value.get("params").cloned().unwrap_or(Value::Null);
    match value.get("id").filter(|id| !id.is_null()) {
        Some(id) => handle_server_request(core, state, method, id, &params),
        None => handle_notification(core, state, view, method, &params),
    }
}

/// A server→client request: the CLI is blocked until this is answered.
fn handle_server_request(
    core: &TurnCore,
    state: &mut TurnState,
    method: &str,
    id: &Value,
    params: &Value,
) -> Handled {
    match method {
        // The reason this transport exists: the model's own multiple-choice
        // question becomes an app card and the turn stays parked until the user
        // picks. `answer_frame` writes the response later, on this same pipe.
        "item/tool/requestUserInput" => {
            let (cards, ids) = question_cards(params);
            if cards.is_empty() {
                // A question the card UI cannot render must not wedge the turn:
                // an empty answer reads as "no answer" and lets the model go on.
                return Handled::Answer(jsonrpc_result_response(id, json!({ "answers": {} })));
            }
            park_question(core, state, id, params, cards, ids);
            Handled::Parked
        }
        // Always declined: `approvalPolicy` is pinned to "never" and the
        // sandbox is the boundary this app chose, so approving here would be a
        // privilege escalation the exec transport never allowed either.
        "item/commandExecution/requestApproval" | "item/fileChange/requestApproval" => {
            Handled::Answer(jsonrpc_result_response(
                id,
                json!({ "decision": "decline" }),
            ))
        }
        // An empty profile grants nothing, and still settles the request.
        "item/permissions/requestApproval" => {
            Handled::Answer(jsonrpc_result_response(id, json!({ "permissions": {} })))
        }
        "mcpServer/elicitation/request" => {
            Handled::Answer(jsonrpc_result_response(id, json!({ "action": "decline" })))
        }
        // Unknown ask: only the peer knows the shape. An empty result still
        // settles its request — silence is what would deadlock the turn.
        _ => Handled::Answer(jsonrpc_result_response(id, json!({}))),
    }
}

/// A notification: no reply is expected, so anything unknown is ignorable.
fn handle_notification(
    core: &TurnCore,
    state: &mut TurnState,
    view: &mut TurnView,
    method: &str,
    params: &Value,
) -> Handled {
    match method {
        "item/agentMessage/delta" => {
            if let Some(delta) = params.get("delta").and_then(Value::as_str) {
                if !delta.is_empty() {
                    // The text streams as deltas and the completed item is then
                    // skipped by the de-dup below, because a `message` row is a
                    // settled snapshot the UI appends on top of the live one.
                    if let Some(item_id) = params.get("itemId").and_then(Value::as_str) {
                        view.streamed_message = Some(item_id.to_string());
                    }
                    core.dispatch_event(state, EngineEvent::Delta(delta.to_string()));
                }
            }
        }
        "item/reasoning/textDelta" | "item/reasoning/summaryTextDelta" => {
            if let Some(delta) = params.get("delta").and_then(Value::as_str) {
                if !delta.is_empty() {
                    if let Some(item_id) = params.get("itemId").and_then(Value::as_str) {
                        view.streamed_reasoning = Some(item_id.to_string());
                    }
                    core.dispatch_event(state, EngineEvent::Thinking(delta.to_string()));
                }
            }
        }
        "item/started" | "item/completed" => {
            if let Some(item) = params.get("item") {
                handle_item(core, state, view, item, method == "item/completed");
            }
        }
        "thread/tokenUsage/updated" => {
            if let Some(usage) = params.get("tokenUsage") {
                if let Some(payload) = usage_payload(usage, params.get("modelContextWindow")) {
                    view.last_usage = Some(payload);
                }
            }
        }
        "thread/started" => {
            if let Some(thread_id) = params.pointer("/thread/id").and_then(Value::as_str) {
                core.dispatch_event(state, EngineEvent::SessionId(thread_id.to_string()));
            }
        }
        // Terminal. A failed turn arrives here as a completion whose status is
        // `failed` with an explanatory message, so both shapes are read the
        // same; `turn/failed` is handled defensively in case a newer CLI emits
        // a notification this schema does not know.
        "turn/completed" | "turn/failed" => {
            let turn = params.get("turn");
            let failed = turn
                .and_then(|turn| turn.get("status"))
                .and_then(Value::as_str)
                == Some("failed");
            let message = turn
                .and_then(|turn| turn.pointer("/error/message"))
                .and_then(Value::as_str)
                .unwrap_or("");
            if failed || !message.is_empty() {
                core.dispatch_event(
                    state,
                    EngineEvent::Error(if message.is_empty() {
                        "codex reported a failed turn".to_string()
                    } else {
                        message.to_string()
                    }),
                );
            }
            return Handled::Ended;
        }
        // Non-terminal by contract (`willRetry`): the CLI is retrying an
        // upstream call, so the turn keeps running and the UI shows a notice.
        "error" => {
            let message = params
                .pointer("/error/message")
                .and_then(Value::as_str)
                .unwrap_or("codex reported an error");
            core.dispatch_event(state, EngineEvent::Warn(message.to_string()));
        }
        _ => {}
    }
    Handled::Ignore
}

/// Project one item lifecycle event. Tool work opens a row on start (the
/// app-server reports the command up front, unlike exec) and the same row is
/// patched with its result on completion; assistant and reasoning text comes
/// from deltas, with the completed item as the fallback for a CLI that streams
/// none.
fn handle_item(
    core: &TurnCore,
    state: &mut TurnState,
    view: &mut TurnView,
    item: &Value,
    completed: bool,
) {
    let Some(kind) = item.get("type").and_then(Value::as_str) else {
        return;
    };
    let item_id = item.get("id").and_then(Value::as_str);
    match kind {
        "agentMessage" => {
            if !completed || view.streamed_message.as_deref() == item_id {
                return;
            }
            let text = item.get("text").and_then(Value::as_str).unwrap_or("");
            if !text.trim().is_empty() {
                core.dispatch_event(state, assistant_message(text.to_string()));
            }
        }
        "reasoning" => {
            if !completed || view.streamed_reasoning.as_deref() == item_id {
                return;
            }
            // Both arrays are optional, and often only one is populated: the
            // summary is the model's rendering, the content the raw trace.
            let mut parts: Vec<String> = Vec::new();
            for key in ["summary", "content"] {
                if let Some(entries) = item.get(key).and_then(Value::as_array) {
                    parts.extend(
                        entries
                            .iter()
                            .filter_map(Value::as_str)
                            .map(str::to_string)
                            .filter(|part| !part.trim().is_empty()),
                    );
                }
            }
            let text = parts.join("\n");
            if !text.is_empty() {
                core.dispatch_event(state, EngineEvent::Thinking(text));
            }
        }
        "commandExecution" => {
            let command = item.get("command").and_then(Value::as_str).unwrap_or("");
            let name = row_name(command);
            if completed {
                core.dispatch_event(
                    state,
                    tool_result_patch(name, Some(&pick(item, &["aggregatedOutput", "exitCode"]))),
                );
            } else {
                core.dispatch_event(
                    state,
                    tool_call_message(name, Some(&pick(item, &["command", "cwd"]))),
                );
            }
        }
        "fileChange" => {
            if completed {
                // The per-file rows were opened on start; the completion only
                // carries the item's own status.
                core.dispatch_event(
                    state,
                    tool_result_patch("apply_patch", Some(&pick(item, &["status"]))),
                );
            } else if let Some(changes) = item.get("changes").and_then(Value::as_array) {
                // One row per file: the UI resolves `path` out of the args for
                // its file chip, and the diff gets an expandable panel.
                for change in changes {
                    core.dispatch_event(
                        state,
                        tool_call_message(
                            "apply_patch",
                            Some(&pick(change, &["path", "kind", "diff"])),
                        ),
                    );
                }
            }
        }
        "mcpToolCall" => {
            let name = item
                .get("tool")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| "mcp".to_string());
            if completed {
                core.dispatch_event(
                    state,
                    tool_result_patch(name, Some(&pick(item, &["result", "error", "status"]))),
                );
            } else {
                core.dispatch_event(
                    state,
                    tool_call_message(name, Some(&pick(item, &["server", "tool", "arguments"]))),
                );
            }
        }
        "dynamicToolCall" => {
            let name = item
                .get("tool")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| "tool".to_string());
            if completed {
                core.dispatch_event(
                    state,
                    tool_result_patch(name, Some(&pick(item, &["success", "contentItems"]))),
                );
            } else {
                core.dispatch_event(
                    state,
                    tool_call_message(name, Some(&pick(item, &["namespace", "tool", "arguments"]))),
                );
            }
        }
        "webSearch" => {
            if completed {
                core.dispatch_event(
                    state,
                    tool_result_patch("web_search", Some(&pick(item, &["results"]))),
                );
            } else {
                core.dispatch_event(
                    state,
                    tool_call_message("web_search", Some(&pick(item, &["query", "action"]))),
                );
            }
        }
        "imageGeneration" => {
            if completed {
                core.dispatch_event(
                    state,
                    tool_result_patch(
                        "image_generation",
                        Some(&pick(item, &["status", "savedPath", "failure"])),
                    ),
                );
            } else {
                core.dispatch_event(
                    state,
                    tool_call_message("image_generation", Some(&pick(item, &["revisedPrompt"]))),
                );
            }
        }
        // Plans, sub-agent activity, review mode and compaction have no row of
        // their own in this client's timeline; what they contain is outside
        // what the app renders, not lost by a missing arm.
        _ => {}
    }
}

/// Park a user-input request: publish the card, then remember how to answer it.
fn park_question(
    core: &TurnCore,
    state: &mut TurnState,
    id: &Value,
    params: &Value,
    cards: Vec<Value>,
    ids: Value,
) {
    // The registry key is the string form of the rpc id — the same key
    // `QuestionSettled` removes and the run's question map is keyed by.
    let request_id = id.to_string();
    let tool_use_id = params
        .get("itemId")
        .and_then(Value::as_str)
        .map(str::to_string);
    core.dispatch_event(
        state,
        EngineEvent::Question {
            request_id: request_id.clone(),
            tool_use_id,
            input: json!({ "questions": cards }),
        },
    );
    // `dispatch_event` parked the raw event input; replace it with the context
    // the answer command needs — the rpc id to answer plus the question-text →
    // question-id map its response is keyed by. The cards themselves are
    // already in the UI's hands, so only the protocol half is kept here.
    if let Some(entry) = core.registry.get(&core.run_id) {
        entry.questions.lock().unwrap().insert(
            request_id,
            json!({ "codexApp": { "rpcId": id, "ids": ids } }),
        );
    }
}

/// Build the CLI's response to a parked question.
///
/// `parked` is the context stored by `park_question`; `answers` is the raw
/// frontend map (question text → chosen label, or a list of labels for a
/// multi-select). `None` means the user dismissed the card — that must settle
/// the CLI's request with an empty answer so the model can carry on, never an
/// error. A mismatch between what the frontend answered and what the server
/// asked is an error instead: it means the card and the request drifted, and
/// silently dropping the answer would park the turn forever.
pub(super) fn answer_frame(parked: &Value, answers: Option<&Value>) -> Result<Value, String> {
    let id = parked
        .get("rpcId")
        .ok_or_else(|| "parked question lost its rpc id".to_string())?;
    let ids = parked.get("ids").and_then(Value::as_object);
    let mut out = Map::new();
    if let Some(answers) = answers {
        let answers = answers
            .as_object()
            .ok_or_else(|| "codex answers must be an object".to_string())?;
        for (text, choice) in answers {
            let Some(question_id) = ids.and_then(|ids| ids.get(text)).and_then(Value::as_str)
            else {
                return Err(format!("codex did not ask a question titled {text:?}"));
            };
            // A single-select arrives as a bare label; the wire only has the
            // list form, so both are normalized into it.
            let labels = match choice {
                Value::String(label) => vec![Value::String(label.clone())],
                Value::Array(labels) => labels.clone(),
                Value::Null => Vec::new(),
                other => return Err(format!("unsupported codex answer for {text:?}: {other}")),
            };
            out.insert(question_id.to_string(), json!({ "answers": labels }));
        }
    }
    Ok(jsonrpc_result_response(id, json!({ "answers": out })))
}

/// Project the protocol's `questions` onto the app's card spec, building the
/// question-text → question-id map in the same pass so the two cannot drift:
/// the card the user picks is keyed by its text, while the response the CLI
/// needs is keyed by the server's own id.
fn question_cards(params: &Value) -> (Vec<Value>, Value) {
    let mut cards = Vec::new();
    let mut ids = Map::new();
    let Some(questions) = params.get("questions").and_then(Value::as_array) else {
        return (cards, Value::Object(ids));
    };
    for (index, question) in questions.iter().enumerate() {
        let (Some(id), Some(text)) = (
            question.get("id").and_then(Value::as_str),
            question.get("question").and_then(Value::as_str),
        ) else {
            continue;
        };
        let text = text.trim();
        if text.is_empty() {
            continue;
        }
        // The card's header is a short chip and the protocol's is optional, so
        // a missing one falls back to the question's position.
        let header = question
            .get("header")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|header| !header.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("Q{}", index + 1));
        let options: Vec<Value> = question
            .get("options")
            .and_then(Value::as_array)
            .map(|options| {
                options
                    .iter()
                    .filter_map(|option| {
                        let label = option.get("label").and_then(Value::as_str)?;
                        let mut card = Map::new();
                        card.insert("label".to_string(), json!(label));
                        if let Some(description) = option
                            .get("description")
                            .and_then(Value::as_str)
                            .map(str::trim)
                            .filter(|description| !description.is_empty())
                        {
                            card.insert("description".to_string(), json!(description));
                        }
                        Some(Value::Object(card))
                    })
                    .collect()
            })
            .unwrap_or_default();
        // `multiSelect` is omitted: codex questions are single-choice, and an
        // absent flag is what the card already reads as. `isOther`/`isSecret`
        // have no place in the card spec.
        cards.push(json!({ "question": text, "header": header, "options": options }));
        ids.insert(text.to_string(), json!(id));
    }
    (cards, Value::Object(ids))
}

/// Sandbox mode for the run's permission. Mirrors `codex.rs`, whose `_` arm is
/// also what `resolve_permission`'s first-supported fallback lands on, so an
/// unsupported mode here behaves exactly like it does on the exec path.
fn sandbox_for(permission: Option<&str>) -> &'static str {
    match permission {
        Some("bypass") => "danger-full-access",
        Some("manual") => "read-only",
        Some(codex_read_only::PERMISSION) => "read-only",
        _ => "workspace-write",
    }
}

/// The turn's input blocks: the prompt, then one local-image block per
/// attachment. `localImage` (not `image`, which wants a URL) makes the CLI read
/// the file from disk; the path is absolutized against the workspace exactly as
/// the exec transport's `-i` argument is.
fn turn_input(req: &SendRequest) -> Vec<Value> {
    let mut input = vec![json!({ "type": "text", "text": req.prompt })];
    for raw in &req.images {
        if let Some(path) = images::absolutize_image_path(raw, &req.workspace) {
            input.push(json!({ "type": "localImage", "path": path.to_string_lossy() }));
        }
    }
    input
}

/// Project token usage onto the shape the app's usage panel parses. `last` is
/// the most recent response's occupancy — what the context meter shows — while
/// `total` is the billed-session cumulative. Returns None when the report
/// carries nothing usable, so a bare Done keeps its previous numbers.
fn usage_payload(usage: &Value, context_window: Option<&Value>) -> Option<Value> {
    let last = usage.get("last")?;
    let mut out = Map::new();
    for (from, to) in [
        ("inputTokens", "input_tokens"),
        ("cachedInputTokens", "cached_input_tokens"),
        ("cacheWriteInputTokens", "cache_write_input_tokens"),
        ("outputTokens", "output_tokens"),
        ("reasoningOutputTokens", "reasoning_output_tokens"),
        ("totalTokens", "total_tokens"),
    ] {
        if let Some(field) = last.get(from).filter(|field| !field.is_null()) {
            out.insert(to.to_string(), field.clone());
        }
    }
    if let Some(window) = context_window.filter(|window| !window.is_null()) {
        out.insert("model_context_window".to_string(), window.clone());
    }
    if out.is_empty() {
        return None;
    }
    Some(Value::Object(out))
}

/// Tool rows are keyed by name — a result patch updates the newest row with the
/// same name — so both halves of one execution must derive it identically. The
/// command string is the only stable handle the protocol gives a command.
fn row_name(command: &str) -> String {
    let name = command.trim();
    if name.is_empty() {
        return "tool".to_string();
    }
    name.chars().take(120).collect()
}

/// Copy the named keys of `value` into a fresh object, dropping absent and null
/// ones so a tool row's args or result panel never shows empty slots.
fn pick(value: &Value, keys: &[&str]) -> Value {
    let mut out = Map::new();
    for key in keys {
        if let Some(field) = value.get(*key).filter(|field| !field.is_null()) {
            out.insert((*key).to_string(), field.clone());
        }
    }
    Value::Object(out)
}

struct SpawnedCodex {
    child: Child,
    server: AppServer,
    stderr_buf: Arc<Mutex<String>>,
    /// Kill-on-close job guard (Windows): drops after teardown, sweeping any
    /// grandchild the CLI orphaned before `taskkill /T` could see a tree.
    #[cfg(windows)]
    _tree_guard: Option<Arc<super::job::KillOnCloseJob>>,
}

/// Spawn the prepared app-server command as this driver's own child: piped
/// stdio, own process group (so teardown sweeps the tree) and a drop backstop,
/// because a dropped driver future must never orphan the CLI. Unlike the ACP
/// spawn the reader is kept in the struct: this transport answers server
/// requests on the same pipe while it reads, so both ends stay live.
fn spawn_app_server(command: &mut Command, workspace: &Path) -> Result<SpawnedCodex, String> {
    command
        .current_dir(workspace)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    command.process_group(0);
    #[cfg(windows)]
    super::hide_console(command);
    let mut child = command
        .spawn()
        .map_err(|error| format!("failed to spawn codex app-server: {error}"))?;
    #[cfg(windows)]
    let tree_guard = super::job::assign_kill_on_close(&child);
    let (stdin, stdout, stderr) =
        match (child.stdin.take(), child.stdout.take(), child.stderr.take()) {
            (Some(stdin), Some(stdout), Some(stderr)) => (stdin, stdout, stderr),
            _ => {
                let _ = child.start_kill();
                return Err("missing stdio pipe after spawn".to_string());
            }
        };
    Ok(SpawnedCodex {
        child,
        server: AppServer::new(Arc::new(TokioMutex::new(Some(stdin))), stdout),
        stderr_buf: spawn_stderr_capture(stderr),
        #[cfg(windows)]
        _tree_guard: tree_guard,
    })
}

// ==================== turn driver ====================

/// Run one app-server turn and settle it exactly like the sibling drivers: a
/// question left parked by an interrupted run is resolved first, then the turn
/// reports either the engine's error or its own Done.
pub(super) async fn run_app_server_turn(
    core: TurnCore,
    req: SendRequest,
    built: BuiltCommand,
    killed: Arc<AtomicBool>,
    virtual_pid: u32,
) {
    let mut state = TurnState::new(req.session_id.clone());
    let mut view = TurnView::default();
    let preassigned_session_id = req.session_id.clone();
    // Abort-safe backstop: the by-name removals below only run when the task
    // finishes normally. An abort or a panic would otherwise leave this run's
    // keys pinning a concurrency slot until app exit.
    let _registry_guard =
        VirtualRunGuard::new(Arc::clone(&core.registry), core.run_id.clone(), virtual_pid);
    let result = turn_inner(&core, &mut state, &mut view, &req, built, &killed).await;
    // Pending questions die with the turn: settle their cards BEFORE any
    // terminal dispatch, or the monotonic saw_done/saw_error guard in
    // dispatch_event would drop these and leave answerable cards pointing at a
    // settled turn.
    for key in [
        state.native_session_id.clone(),
        Some(core.run_id.clone()),
        preassigned_session_id.clone(),
    ]
    .into_iter()
    .flatten()
    {
        for request_id in core.registry.take_questions(&key) {
            core.dispatch_event(&mut state, EngineEvent::QuestionSettled { request_id });
        }
    }
    // A killed turn is not an error: it was interrupted on purpose, and the
    // marker below only exists to end this pump.
    if let Err(error) = result {
        if !killed.load(Ordering::SeqCst) {
            core.dispatch_event(&mut state, EngineEvent::Error(error));
        }
    }
    // An interrupted run commits its partial output as a normal turn end — the
    // same contract as the SIGKILL'd process path.
    if !state.saw_done && !state.saw_error {
        let usage = if killed.load(Ordering::SeqCst) {
            None
        } else {
            view.last_usage.clone()
        };
        let session_id = state.native_session_id.clone();
        core.dispatch_event(&mut state, EngineEvent::Done { session_id, usage });
    }
    core.registry.remove_if_pid(&core.run_id, virtual_pid);
    // Clean up both the native session id (if the CLI reported one) and the
    // preassigned session id (if we resumed an existing conversation). A
    // resumed session was keyed at spawn under req.session_id, so that alias
    // must go even if the native id differs or never arrived.
    if let Some(session_id) = state.native_session_id.clone() {
        core.registry.remove_if_pid(&session_id, virtual_pid);
    }
    if let Some(session_id) = preassigned_session_id {
        core.registry.remove_if_pid(&session_id, virtual_pid);
    }
    if !view.exit_unconfirmed {
        state.confirm_exit(&core);
    }
    core.sink.flush();
}

async fn turn_inner(
    core: &TurnCore,
    state: &mut TurnState,
    view: &mut TurnView,
    req: &SendRequest,
    built: BuiltCommand,
    killed: &Arc<AtomicBool>,
) -> Result<(), String> {
    let BuiltCommand {
        mut command,
        cleanup_files,
        ..
    } = built;
    let _staging_guard = codex_read_only::StagedHomeGuard(cleanup_files);
    let outcome = drive(&mut command, core, state, view, req, killed).await;
    // Staged prompt files go on every exit path, including a spawn that never
    // got off the ground.
    outcome
}

/// Spawn, handshake, prompt, then tear the tree down: the app-server is
/// resident and would otherwise outlive the run.
async fn drive(
    command: &mut Command,
    core: &TurnCore,
    state: &mut TurnState,
    view: &mut TurnView,
    req: &SendRequest,
    killed: &Arc<AtomicBool>,
) -> Result<(), String> {
    if codex_read_only::requested(req) {
        view.isolated_home = Some(
            std::fs::canonicalize(codex_read_only::isolated_home(command)?)
                .map_err(|_| "Cannot verify isolated Codex home")?,
        );
    }
    let mut spawned = spawn_app_server(command, &req.workspace)?;
    view.exit_unconfirmed = true;
    // The answer command writes a parked question's response on this same pipe,
    // so the registry gets the writer from the first frame on.
    core.registry
        .set_stdin(&core.run_id, Arc::clone(&spawned.server.stdin));
    let result = handshake_and_turn(&mut spawned.server, core, state, view, req, killed).await;
    teardown(&mut spawned.child).await;
    view.exit_unconfirmed = !matches!(spawned.child.try_wait(), Ok(Some(_)));
    match result {
        Ok(()) => Ok(()),
        Err(error) => Err(terminal_message(error, &spawned.stderr_buf)),
    }
}

/// `initialize` → thread → turn, projecting everything through `route`.
async fn handshake_and_turn(
    server: &mut AppServer,
    core: &TurnCore,
    state: &mut TurnState,
    view: &mut TurnView,
    req: &SendRequest,
    killed: &Arc<AtomicBool>,
) -> Result<(), String> {
    let deadline = Instant::now() + RPC_HANDSHAKE_TIMEOUT;
    let key = server
        .request(
            "initialize",
            json!({ "clientInfo": {
                "name": "ccgui",
                "version": env!("CARGO_PKG_VERSION"),
            }, "capabilities": {"experimentalApi": codex_read_only::requested(req)}}),
        )
        .await?;
    let initialized = server
        .pump(
            "initialize",
            Expect::Reply(&key),
            deadline,
            killed,
            None,
            &mut |value| route(core, state, view, value),
        )
        .await?
        .ok_or_else(|| "the codex app-server ended before initialize was answered".to_string())?;
    if codex_read_only::requested(req) {
        codex_read_only::validate_version(&initialized)?;
        for (method, params) in [
            ("configRequirements/read", json!({})),
            (
                "config/read",
                json!({"cwd":req.workspace.to_string_lossy(),"includeLayers":true}),
            ),
        ] {
            let key = server.request(method, params).await?;
            let response = server
                .pump(
                    method,
                    Expect::Reply(&key),
                    Instant::now() + RPC_HANDSHAKE_TIMEOUT,
                    killed,
                    None,
                    &mut |value| route(core, state, view, value),
                )
                .await?
                .ok_or("Codex isolation preflight ended without a response")?;
            if method == "configRequirements/read" {
                if response.get("requirements") != Some(&Value::Null) {
                    return Err(
                        "Codex read-only planning does not support managed requirements".into(),
                    );
                }
            } else {
                codex_read_only::validate_config(
                    &response,
                    view.isolated_home
                        .as_deref()
                        .ok_or("Missing isolated Codex planning home")?,
                )?;
            }
        }
    }
    // Resuming re-attaches the conversation the app already holds; starting
    // opens a new one. Both take the run's sandbox, and approvals stay pinned
    // off: this client has no approval UI and the sandbox is the boundary.
    let deadline = Instant::now()
        + if req.session_id.is_some() {
            RESUME_TIMEOUT
        } else {
            THREAD_TIMEOUT
        };
    let (method, mut params) = match req.session_id.as_deref() {
        Some(thread_id) => ("thread/resume", json!({ "threadId": thread_id })),
        None => ("thread/start", json!({})),
    };
    params["cwd"] = json!(req.workspace.to_string_lossy());
    params["sandbox"] = json!(sandbox_for(req.permission.as_deref()));
    params["approvalPolicy"] = json!("never");
    if codex_read_only::requested(req) {
        params["ephemeral"] = json!(true);
        params["dynamicTools"] = json!([]);
        params["selectedCapabilityRoots"] = json!([]);
        params["environments"] =
            json!([{"environmentId":"local","cwd":req.workspace.to_string_lossy()}]);
    }
    if let Some(model) = req.model.as_deref() {
        params["model"] = json!(model);
    }
    if !codex_read_only::requested(req) {
        if let Some(effort) = req.effort.as_deref() {
            if let Some(obj) = params.as_object_mut() {
                if !obj.contains_key("config") || obj["config"].is_null() {
                    obj.insert("config".to_string(), json!({}));
                }
                if let Some(config) = obj.get_mut("config").and_then(Value::as_object_mut) {
                    config.insert("model_reasoning_effort".to_string(), json!(effort));
                }
            }
        }
    }
    let key = server.request(method, params).await?;
    let result = server
        .pump(
            method,
            Expect::Reply(&key),
            deadline,
            killed,
            None,
            &mut |value| route(core, state, view, value),
        )
        .await?
        .ok_or_else(|| format!("the codex app-server ended before {method} was answered"))?;
    if codex_read_only::requested(req) {
        codex_read_only::validate_thread(&result)?;
    }
    let thread_id = result
        .pointer("/thread/id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| req.session_id.clone())
        .ok_or_else(|| format!("{method} returned no thread id"))?;
    core.dispatch_event(state, EngineEvent::SessionId(thread_id.clone()));
    if let Some(model) = result.get("model").and_then(Value::as_str) {
        core.dispatch_event(state, EngineEvent::Model(model.to_string()));
    }
    let reported_effort = result
        .get("reasoningEffort")
        .or_else(|| result.pointer("/thread/reasoningEffort"))
        .and_then(Value::as_str);
    if let Some(effort) = req.effort.as_deref().or(reported_effort) {
        core.dispatch_event(state, EngineEvent::Effort(effort.to_string()));
    }
    // The turn id is needed to interrupt a cancelled turn, so it must be known
    // before the turn pump starts.
    let mut turn_params = json!({ "threadId": thread_id, "input": turn_input(req) });
    if codex_read_only::requested(req) {
        turn_params["approvalPolicy"] = json!("never");
        turn_params["sandboxPolicy"] = json!({"type":"readOnly","networkAccess":false});
    }
    if let Some(effort) = req.effort.as_deref() {
        turn_params["effort"] = json!(effort);
    }
    if let Some(model) = req.model.as_deref() {
        turn_params["model"] = json!(model);
    }
    let key = server.request("turn/start", turn_params).await?;
    let deadline = Instant::now() + PROMPT_TIMEOUT;
    // A fast turn can be over before its own acknowledgement is read, so an
    // ended pump here is a settled turn and not a missing reply.
    let Some(result) = server
        .pump(
            "turn/start",
            Expect::Reply(&key),
            deadline,
            killed,
            None,
            &mut |value| route(core, state, view, value),
        )
        .await?
    else {
        return Ok(());
    };
    view.turn_id = result
        .pointer("/turn/id")
        .and_then(Value::as_str)
        .map(str::to_string);
    let interrupt = view
        .turn_id
        .clone()
        .map(|turn_id| (thread_id.clone(), turn_id));
    server
        .pump(
            "turn",
            Expect::Turn,
            deadline,
            killed,
            interrupt
                .as_ref()
                .map(|(thread_id, turn_id)| (thread_id.as_str(), turn_id.as_str())),
            &mut |value| route(core, state, view, value),
        )
        .await?;
    Ok(())
}

/// Reduce a failure to what the user should read: the CLI's own rpc message,
/// else its stderr tail (a crash or a rejected launch speaks there), else the
/// driver's own words.
fn terminal_message(raw: String, stderr_buf: &Mutex<String>) -> String {
    if let Some(rest) = raw.strip_prefix("rpc:") {
        if let Some((_, message)) = rest.split_once(':') {
            if !message.trim().is_empty() {
                return message.to_string();
            }
        }
    }
    let stderr = stderr_buf.lock().map(|buf| buf.clone()).unwrap_or_default();
    let stderr = stderr.trim();
    if stderr.is_empty() {
        return raw;
    }
    format!("{raw}\n{stderr}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::registry::ChildEntry;
    use crate::engine::ProcessRegistry;
    use crate::event_sink::{Emit, EventSink};
    use std::collections::HashMap;

    /// Test emitter collecting flushed event JSON for assertions.
    struct CollectingEmitter(Mutex<Vec<String>>);

    impl Emit for CollectingEmitter {
        fn emit_json(&self, _name: &str, raw_json: &str) {
            self.0.lock().unwrap().push(raw_json.to_string());
        }
    }

    /// A TurnCore with a registry entry under its run id (so question parking
    /// has somewhere to land) plus the collected flushes for assertions.
    fn test_core() -> (TurnCore, Arc<ProcessRegistry>, Arc<CollectingEmitter>) {
        let emitter = Arc::new(CollectingEmitter(Mutex::new(Vec::new())));
        let registry = Arc::new(ProcessRegistry::default());
        registry.insert(
            "test-run".to_string(),
            ChildEntry {
                child: None,
                pid: 4_000_000_099,
                run_id: "test-run".to_string(),
                killed: Arc::new(AtomicBool::new(false)),
                reader_abort: Arc::new(std::sync::OnceLock::new()),
                stdin: None,
                questions: Arc::new(Mutex::new(HashMap::new())),
            },
        );
        let core = TurnCore {
            sink: EventSink::new(emitter.clone()),
            registry: Arc::clone(&registry),
            engine_id: "codex".to_string(),
            run_id: "test-run".to_string(),
        };
        (core, registry, emitter)
    }

    /// Flush the sink and return `(kind, data)` for every event emitted.
    fn flushed(core: &TurnCore, emitter: &Arc<CollectingEmitter>) -> Vec<(String, Value)> {
        core.sink.flush();
        let mut out = Vec::new();
        for raw in emitter.0.lock().unwrap().iter() {
            let parsed: Value = serde_json::from_str(raw).expect("flushed batch must be JSON");
            let batch = parsed.as_array().cloned().unwrap_or_else(|| vec![parsed]);
            for value in batch {
                out.push((
                    value
                        .get("kind")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string(),
                    value.get("data").cloned().unwrap_or(Value::Null),
                ));
            }
        }
        out
    }

    fn parked(rpc_id: Value, ids: Value) -> Value {
        json!({ "rpcId": rpc_id, "ids": ids })
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    #[ignore = "requires CCGUI_CODEX_READ_ONLY_TEST_BIN pointing to audited Codex 0.154.0 on macOS; no model calls"]
    async fn installed_codex_isolated_planner_blocks_writes_and_external_tools() {
        use crate::engine::Engine;
        let bin = std::env::var("CCGUI_CODEX_READ_ONLY_TEST_BIN").unwrap();
        let root =
            std::env::temp_dir().join(format!("ccgui-codex-isolation-{}", uuid::Uuid::new_v4()));
        let _root_guard = codex_read_only::StagedHomeGuard(vec![root.clone()]);
        let native = root.join("native");
        let workspace = root.join("workspace");
        std::fs::create_dir_all(&native).unwrap();
        std::fs::create_dir_all(workspace.join(".codex")).unwrap();
        let marker = root.join("MCP_STARTED");
        let malicious = format!(
            "[mcp_servers.fixture]\ncommand=\"/bin/sh\"\nargs=[\"-c\",\"touch {}\"]\n",
            marker.display()
        );
        std::fs::write(native.join("config.toml"),format!("model=\"probe\"\nmodel_provider=\"probe\"\nnotify=[\"/bin/sh\",\"-c\",\"touch {}\"]\n[model_providers.probe]\nname=\"probe\"\nbase_url=\"http://127.0.0.1:9/v1\"\nwire_api=\"responses\"\n{malicious}",marker.display())).unwrap();
        std::fs::write(workspace.join(".codex/config.toml"), &malicious).unwrap();
        let request = SendRequest {
            session_id: None,
            workspace: workspace.clone(),
            prompt: "not sent".into(),
            images: vec![],
            model: Some("probe".into()),
            effort: None,
            service_tier: None,
            permission: Some(codex_read_only::PERMISSION.into()),
            additional_dirs: vec![],
            provider_id: None,
            computer_use: None,
            allowed_tools: None,
        };
        assert!(crate::engine::codex::CodexEngine
            .build_command(&request, &bin)
            .is_err());
        let mut built = crate::engine::codex::CodexEngine
            .host_command(&request, &bin)
            .unwrap();
        codex_read_only::stage(&request, &mut built, &native, &root.join("staging")).unwrap();
        let home =
            std::fs::canonicalize(codex_read_only::isolated_home(&built.command).unwrap()).unwrap();
        assert!(!std::fs::read_to_string(home.join("config.toml"))
            .unwrap()
            .contains("mcp_servers"));
        let mut spawned = spawn_app_server(&mut built.command, &workspace).unwrap();
        let killed = AtomicBool::new(false);
        let result: Result<(),String> = async {
            for (method,params) in [
                ("initialize",json!({"clientInfo":{"name":"ccgui_probe","version":"1"},"capabilities":{"experimentalApi":true}})),
                ("configRequirements/read",json!({})),
                ("config/read",json!({"cwd":workspace,"includeLayers":true})),
                ("thread/start",json!({"cwd":workspace,"model":"probe","sandbox":"read-only","approvalPolicy":"never","ephemeral":true,"dynamicTools":[],"selectedCapabilityRoots":[],"environments":[{"environmentId":"local","cwd":workspace}]})),
                ("command/exec",json!({"command":["/bin/sh","-c","cat .codex/config.toml"],"cwd":workspace,"sandboxPolicy":{"type":"readOnly","networkAccess":false},"timeoutMs":3000})),
                ("command/exec",json!({"command":["/bin/sh","-c","touch DENIED_WRITE"],"cwd":workspace,"sandboxPolicy":{"type":"readOnly","networkAccess":false},"timeoutMs":3000})),
            ] {
                let writing=params.pointer("/command/2")==Some(&json!("touch DENIED_WRITE"));
                let key=spawned.server.request(method,params).await?;
                let response=spawned.server.pump(method,Expect::Reply(&key),Instant::now()+Duration::from_secs(10),&killed,None,&mut |_| Handled::Ignore).await?
                    .ok_or("Probe ended without a response")?;
                match method {
                    "initialize"=>codex_read_only::validate_version(&response).map_err(|error| format!("{error}; reported user agent: {}",response["userAgent"]))?,
                    "configRequirements/read"=>assert_eq!(response["requirements"],Value::Null),
                    "config/read"=>codex_read_only::validate_config(&response,&home)?,
                    "thread/start"=>codex_read_only::validate_thread(&response)?,
                    "command/exec" if writing=>assert_ne!(response["exitCode"],json!(0)),
                    "command/exec"=>assert_eq!(response["exitCode"],json!(0)),
                    _=>unreachable!(),
                }
            }
            Ok(())
        }.await;
        teardown(&mut spawned.child).await;
        result.unwrap();
        assert!(!marker.exists());
        assert!(!workspace.join("DENIED_WRITE").exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn plugin_codex_interrupt_during_handshake_waits_for_process_exit() {
        let (mut core, registry, emitter) = test_core();
        let mut entry = registry.get("test-run").unwrap();
        registry.remove_if_pid("test-run", entry.pid);
        core.run_id = "pa-relay-codex-interrupt".into();
        entry.run_id = core.run_id.clone();
        let killed = entry.killed.clone();
        let virtual_pid = entry.pid;
        registry.insert(core.run_id.clone(), entry);
        let directory =
            std::env::temp_dir().join(format!("ccgui-codex-interrupt-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory).unwrap();
        let pid_file = directory.join("pid");
        let mut command = Command::new("sh");
        command.args([
            "-c",
            &format!(
                "echo $$ > '{}'; read ignored; exec sleep 30",
                pid_file.display()
            ),
        ]);
        let request = SendRequest {
            session_id: None,
            workspace: directory.clone(),
            prompt: "hi".into(),
            images: vec![],
            model: None,
            effort: None,
            service_tier: None,
            permission: None,
            additional_dirs: vec![],
            provider_id: None,
            computer_use: None,
            allowed_tools: None,
        };
        let built = BuiltCommand {
            command,
            stdin_payload: None,
            keep_stdin_open: true,
            cleanup_files: vec![],
            mcp_restore: None,
            preassigned_session_id: None,
        };
        let run_id = core.run_id.clone();
        let sink = core.sink.clone();
        let task = tokio::spawn(run_app_server_turn(
            core,
            request,
            built,
            killed,
            virtual_pid,
        ));
        timeout(Duration::from_secs(3), async {
            while !pid_file.exists() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        let child_pid: i32 = std::fs::read_to_string(&pid_file)
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        assert!(registry.kill(&run_id));
        timeout(Duration::from_secs(3), task)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(unsafe { libc::kill(child_pid, 0) }, -1);
        assert_eq!(
            std::io::Error::last_os_error().raw_os_error(),
            Some(libc::ESRCH)
        );
        assert_eq!(registry.active_run_count(), 0);
        sink.flush();
        let events: Vec<Value> = emitter
            .0
            .lock()
            .unwrap()
            .iter()
            .flat_map(|raw| serde_json::from_str::<Vec<Value>>(raw).unwrap())
            .collect();
        assert_eq!(
            events
                .iter()
                .filter(|event| matches!(event["kind"].as_str(), Some("done" | "error")))
                .count(),
            1
        );
        assert_eq!(events.last().unwrap()["kind"], "done");
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn answer_frame_keys_a_single_choice_by_the_servers_question_id() {
        let frame = answer_frame(
            &parked(json!(7), json!({ "Which one?": "q1" })),
            Some(&json!({ "Which one?": "Alpha" })),
        )
        .unwrap();
        assert_eq!(frame["jsonrpc"], json!("2.0"));
        assert_eq!(frame["id"], json!(7));
        assert_eq!(
            frame["result"],
            json!({ "answers": { "q1": { "answers": ["Alpha"] } } })
        );
    }

    #[test]
    fn answer_frame_keeps_every_label_of_a_multi_select() {
        let frame = answer_frame(
            &parked(json!("rpc-9"), json!({ "Layers?": "q9" })),
            Some(&json!({ "Layers?": ["ui", "engine"] })),
        )
        .unwrap();
        // The id is echoed verbatim: the CLI correlates on its own token, which
        // may be a string or a number.
        assert_eq!(frame["id"], json!("rpc-9"));
        assert_eq!(
            frame["result"]["answers"]["q9"]["answers"],
            json!(["ui", "engine"])
        );
    }

    #[test]
    fn answer_frame_rejects_an_answer_to_a_question_that_was_never_asked() {
        let error = answer_frame(
            &parked(json!(1), json!({ "Which one?": "q1" })),
            Some(&json!({ "Something else?": "Alpha" })),
        )
        .unwrap_err();
        assert!(error.contains("Something else?"), "{error}");
    }

    #[test]
    fn answer_frame_rejects_a_non_object_answer_map() {
        let error =
            answer_frame(&parked(json!(1), json!({})), Some(&json!(["Alpha"]))).unwrap_err();
        assert!(error.contains("object"), "{error}");
    }

    #[test]
    fn answer_frame_settles_a_dismissed_card_with_an_empty_answer() {
        // A dismissal is not an error: the model must be able to move on, and
        // an empty answer map is the protocol's way of saying "nothing chosen".
        let frame = answer_frame(&parked(json!(3), json!({ "Which one?": "q1" })), None).unwrap();
        assert_eq!(frame["id"], json!(3));
        assert_eq!(frame["result"], json!({ "answers": {} }));
    }

    #[test]
    fn answer_frame_reports_a_single_question_answered_with_null_as_empty() {
        let frame = answer_frame(
            &parked(json!(3), json!({ "Which one?": "q1" })),
            Some(&json!({ "Which one?": null })),
        )
        .unwrap();
        assert_eq!(frame["result"]["answers"]["q1"], json!({ "answers": [] }));
    }

    #[test]
    fn question_cards_synthesise_missing_headers_and_options() {
        let params = json!({
            "itemId": "item-1",
            "questions": [
                {
                    "id": "q1",
                    "question": "Which one?",
                    "options": [
                        { "label": "Alpha" },
                        { "label": "Beta", "description": "the second one" },
                    ],
                },
                { "id": "q2", "question": "  And then?  " },
            ],
        });
        let (cards, ids) = question_cards(&params);
        assert_eq!(cards.len(), 2);
        assert_eq!(cards[0]["question"], json!("Which one?"));
        assert_eq!(cards[0]["header"], json!("Q1"));
        assert_eq!(cards[0]["options"][0], json!({ "label": "Alpha" }));
        assert_eq!(
            cards[0]["options"][1],
            json!({ "label": "Beta", "description": "the second one" })
        );
        // Codex asks single-choice questions: an absent flag is what the card
        // already reads as, so it must not be synthesised.
        assert!(cards[0].get("multiSelect").is_none());
        assert_eq!(cards[1]["question"], json!("And then?"));
        assert_eq!(cards[1]["header"], json!("Q2"));
        assert_eq!(cards[1]["options"], json!([]));
        assert_eq!(ids, json!({ "Which one?": "q1", "And then?": "q2" }));
    }

    #[test]
    fn question_cards_skip_questions_the_card_cannot_ask() {
        let params = json!({
            "questions": [
                { "id": "q1", "question": "   " },
                { "question": "no id" },
                { "id": "q3", "question": "Real?" },
            ],
        });
        let (cards, ids) = question_cards(&params);
        assert_eq!(cards.len(), 1);
        // The header stays tied to the question's position in the request, so a
        // skipped one still shifts the numbering the protocol implies.
        assert_eq!(cards[0]["header"], json!("Q3"));
        assert_eq!(ids, json!({ "Real?": "q3" }));
    }

    #[test]
    fn sandbox_for_mirrors_the_exec_permission_mapping() {
        assert_eq!(sandbox_for(Some("bypass")), "danger-full-access");
        assert_eq!(sandbox_for(Some("manual")), "read-only");
        assert_eq!(sandbox_for(Some("auto")), "workspace-write");
        // Anything the exec path's fallback would land on resolves to the same
        // default here.
        assert_eq!(sandbox_for(Some("plan")), "workspace-write");
        assert_eq!(sandbox_for(None), "workspace-write");
    }

    #[test]
    fn usage_payload_projects_the_protocol_fields_onto_snake_case() {
        let usage = json!({
            "last": {
                "inputTokens": 120,
                "cachedInputTokens": 100,
                "cacheWriteInputTokens": 5,
                "outputTokens": 30,
                "reasoningOutputTokens": 7,
                "totalTokens": 150,
            },
            "total": { "inputTokens": 1, "outputTokens": 2, "totalTokens": 3 },
        });
        let payload = usage_payload(&usage, Some(&json!(128_000))).unwrap();
        assert_eq!(payload["input_tokens"], json!(120));
        assert_eq!(payload["cached_input_tokens"], json!(100));
        assert_eq!(payload["cache_write_input_tokens"], json!(5));
        assert_eq!(payload["output_tokens"], json!(30));
        assert_eq!(payload["reasoning_output_tokens"], json!(7));
        assert_eq!(payload["total_tokens"], json!(150));
        assert_eq!(payload["model_context_window"], json!(128_000));
    }

    #[test]
    fn usage_payload_omits_what_the_report_does_not_carry() {
        assert!(usage_payload(&json!({ "total": { "totalTokens": 3 } }), None).is_none());
        assert!(usage_payload(&json!({ "last": {} }), None).is_none());
        let payload = usage_payload(&json!({ "last": { "totalTokens": 3 } }), None).unwrap();
        assert_eq!(payload, json!({ "total_tokens": 3 }));
    }

    // Every test below drives the router, so each needs a runtime: the sink
    // schedules its batch flush with `tokio::spawn`, and an error dispatch
    // kills the run through `spawn_blocking`.

    #[tokio::test]
    async fn route_parks_a_question_and_the_answer_frame_reads_what_it_parked() {
        let (core, registry, emitter) = test_core();
        let mut state = TurnState::new(None);
        let mut view = TurnView::default();
        let handled = route(
            &core,
            &mut state,
            &mut view,
            &json!({
                "jsonrpc": "2.0",
                "id": 12,
                "method": "item/tool/requestUserInput",
                "params": {
                    "itemId": "item-1",
                    "questions": [{
                        "id": "q1",
                        "question": "Which one?",
                        "options": [{ "label": "Alpha" }],
                    }],
                },
            }),
        );
        // Parked, not answered: the card waits for the user and the rpc id is
        // what the answer command writes back on.
        assert!(matches!(handled, Handled::Parked));
        let events = flushed(&core, &emitter);
        let question = events
            .iter()
            .find(|(kind, _)| kind == "question")
            .expect("the card must reach the UI");
        assert_eq!(question.1["requestId"], json!("12"));
        assert_eq!(question.1["toolUseId"], json!("item-1"));
        assert_eq!(question.1["input"]["questions"][0]["header"], json!("Q1"));
        let entry = registry.get("test-run").expect("registry entry");
        let parked = entry
            .questions
            .lock()
            .unwrap()
            .get("12")
            .cloned()
            .expect("the answer context must be parked under the rpc id");
        // The two halves of the round trip must agree: what `route` parked is
        // exactly what `answer_frame` (called by the answer command) consumes.
        let frame = answer_frame(
            parked.get("codexApp").expect("codexApp context"),
            Some(&json!({ "Which one?": "Alpha" })),
        )
        .unwrap();
        assert_eq!(frame["id"], json!(12));
        assert_eq!(
            frame["result"],
            json!({ "answers": { "q1": { "answers": ["Alpha"] } } })
        );
    }

    #[tokio::test]
    async fn route_answers_an_unrenderable_question_instead_of_wedging_the_turn() {
        let (core, registry, _emitter) = test_core();
        let mut state = TurnState::new(None);
        let mut view = TurnView::default();
        let handled = route(
            &core,
            &mut state,
            &mut view,
            &json!({
                "jsonrpc": "2.0",
                "id": 8,
                "method": "item/tool/requestUserInput",
                "params": { "questions": [] },
            }),
        );
        let Handled::Answer(frame) = handled else {
            panic!("a question the card cannot show must still be answered");
        };
        assert_eq!(frame["id"], json!(8));
        assert_eq!(frame["result"], json!({ "answers": {} }));
        let entry = registry.get("test-run").expect("registry entry");
        assert!(
            entry.questions.lock().unwrap().is_empty(),
            "nothing may be left waiting for an answer"
        );
    }

    #[tokio::test]
    async fn route_declines_an_approval_that_was_never_going_to_be_granted() {
        let (core, _registry, _emitter) = test_core();
        let mut state = TurnState::new(None);
        let mut view = TurnView::default();
        let handled = route(
            &core,
            &mut state,
            &mut view,
            &json!({
                "jsonrpc": "2.0",
                "id": 4,
                "method": "item/commandExecution/requestApproval",
                "params": { "command": "rm -rf build" },
            }),
        );
        let Handled::Answer(frame) = handled else {
            panic!("an approval request must always be answered");
        };
        assert_eq!(frame["id"], json!(4));
        assert_eq!(frame["result"], json!({ "decision": "decline" }));
    }

    #[tokio::test]
    async fn a_streamed_message_is_not_repeated_by_its_completed_item() {
        let (core, _registry, emitter) = test_core();
        let mut state = TurnState::new(None);
        let mut view = TurnView::default();
        route(
            &core,
            &mut state,
            &mut view,
            &json!({
                "method": "item/agentMessage/delta",
                "params": { "itemId": "m1", "delta": "Hel" },
            }),
        );
        route(
            &core,
            &mut state,
            &mut view,
            &json!({
                "method": "item/completed",
                "params": { "item": { "id": "m1", "type": "agentMessage", "text": "Hello" } },
            }),
        );
        let events = flushed(&core, &emitter);
        assert_eq!(
            events
                .iter()
                .map(|(kind, _)| kind.as_str())
                .collect::<Vec<_>>(),
            ["delta"]
        );
        assert_eq!(events[0].1, json!("Hel"));
    }

    #[tokio::test]
    async fn an_unstreamed_message_still_arrives_from_its_completed_item() {
        let (core, _registry, emitter) = test_core();
        let mut state = TurnState::new(None);
        let mut view = TurnView::default();
        route(
            &core,
            &mut state,
            &mut view,
            &json!({
                "method": "item/completed",
                "params": { "item": { "id": "m2", "type": "agentMessage", "text": "Hello" } },
            }),
        );
        let events = flushed(&core, &emitter);
        assert_eq!(events.len(), 1, "{events:?}");
        assert_eq!(events[0].0, "message");
        assert_eq!(events[0].1["role"], json!("assistant"));
        assert_eq!(events[0].1["text"], json!("Hello"));
    }

    #[tokio::test]
    async fn a_token_usage_notification_is_held_for_the_turn_end() {
        let (core, _registry, emitter) = test_core();
        let mut state = TurnState::new(None);
        let mut view = TurnView::default();
        route(
            &core,
            &mut state,
            &mut view,
            &json!({
                "method": "thread/tokenUsage/updated",
                "params": {
                    "threadId": "t1",
                    "turnId": "turn-1",
                    "tokenUsage": { "last": { "totalTokens": 42 } },
                    "modelContextWindow": 1000,
                },
            }),
        );
        assert_eq!(
            view.last_usage,
            Some(json!({ "total_tokens": 42, "model_context_window": 1000 }))
        );
        // The run reports usage once, with its Done: a mid-turn frame would
        // make the UI's context meter jump between turns.
        assert!(flushed(&core, &emitter).is_empty());
    }

    #[tokio::test]
    async fn a_failed_turn_settles_the_run_with_the_engines_own_message() {
        let (core, _registry, emitter) = test_core();
        let mut state = TurnState::new(None);
        let mut view = TurnView::default();
        let handled = route(
            &core,
            &mut state,
            &mut view,
            &json!({
                "method": "turn/completed",
                "params": {
                    "threadId": "t1",
                    "turn": {
                        "id": "turn-1",
                        "status": "failed",
                        "error": { "message": "stream disconnected" },
                    },
                },
            }),
        );
        assert!(matches!(handled, Handled::Ended));
        let events = flushed(&core, &emitter);
        assert_eq!(events.len(), 1, "{events:?}");
        assert_eq!(events[0].0, "error");
        assert_eq!(events[0].1, json!("stream disconnected"));
    }

    #[tokio::test]
    async fn a_clean_turn_ends_without_erroring() {
        let (core, _registry, emitter) = test_core();
        let mut state = TurnState::new(None);
        let mut view = TurnView::default();
        let handled = route(
            &core,
            &mut state,
            &mut view,
            &json!({
                "method": "turn/completed",
                "params": { "threadId": "t1", "turn": { "id": "turn-1", "status": "completed" } },
            }),
        );
        assert!(matches!(handled, Handled::Ended));
        // The driver settles the turn itself; a mid-turn error here would make
        // a perfectly good run look failed.
        assert!(flushed(&core, &emitter).is_empty());
    }

    #[tokio::test]
    async fn a_retryable_error_does_not_settle_the_turn() {
        let (core, _registry, emitter) = test_core();
        let mut state = TurnState::new(None);
        let mut view = TurnView::default();
        assert!(matches!(
            route(
                &core,
                &mut state,
                &mut view,
                &json!({
                    "method": "error",
                    "params": { "error": { "message": "upstream 502" }, "willRetry": true },
                }),
            ),
            Handled::Ignore
        ));
        let events = flushed(&core, &emitter);
        assert_eq!(events.len(), 1, "{events:?}");
        assert_eq!(events[0].0, "warn");
        assert_eq!(events[0].1, json!("upstream 502"));
        assert!(!state.saw_error, "a retry must not settle the run");
    }
}
