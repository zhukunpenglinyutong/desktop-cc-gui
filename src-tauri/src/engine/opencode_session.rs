//! OpenCode server-session turn driver: one codemoss send = one turn on the
//! managed `opencode serve`.
//!
//! Wire (verified live against opencode 1.18.30/1.18.31):
//! - `POST /session` (resume reuses the stored ses_ id) →
//!   `GET /event` (SSE, global stream filtered by sessionID) must be live
//!   before `POST /session/:id/prompt_async` (204, fire-and-forget).
//! - The turn streams as `message.part.updated` / `message.part.delta`
//!   (text+reasoning), tool parts carry their state, `session.status`
//!   busy→idle settles the turn, `session.error` fails it.
//! - The built-in `question` tool parks server-side: `question.asked` →
//!   answer card → `POST /question/:requestID/reply {answers: string[][]}`
//!   (or `/reject`). `permission.asked` is auto-answered: "once" per
//!   ask, or "always" under bypass (approve matching asks for the rest
//!   of the session) — either way the old headless run never prompted,
//!   same net outcome; config denies never reach us.
//! - Interrupt sends `POST /session/:id/abort`.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures_util::StreamExt;
use serde_json::{json, Value};
use tokio::sync::mpsc;

use super::opencode_server::{self, OpencodeServerState};
use super::{EngineEvent, SendRequest, TurnCore, TurnState};

/// The killed-flag poll cadence inside the select loop.
const KILL_POLL: Duration = Duration::from_millis(150);

/// Per-turn projection state for the SSE stream.
#[derive(Default)]
struct TurnView {
    /// (messageID, partID) → part type, so deltas route text vs reasoning
    /// (both delta on the part's `text` field; the type only arrives with
    /// `message.part.updated`).
    part_types: HashMap<(String, String), String>,
    /// Usage from the latest finished assistant message (Done snapshot).
    last_usage: Option<Value>,
    /// `"provider/model"` → effective context window, read once per turn from
    /// the server's merged config. opencode's usage payload carries only token
    /// counts, so the window has to be attached from here or the gauge falls
    /// back to its assumed 200k.
    context_windows: HashMap<String, u64>,
    turn_ended: bool,
    saw_content: bool,
}

/// Drive one send as a server turn. Mirrors `run_host_turn`'s settle
/// contract: dispatch events until a terminal done/error, settle parked
/// questions first, then drain this run's registry entries.
pub(crate) async fn run_server_turn(
    core: TurnCore,
    req: SendRequest,
    bin: String,
    server: Arc<OpencodeServerState>,
    killed: Arc<AtomicBool>,
    virtual_pid: u32,
) {
    run_server_turn_with_probe_port(
        core,
        req,
        bin,
        server,
        killed,
        virtual_pid,
        opencode_server::DEFAULT_PORT,
    )
    .await
}

/// `probe_port` 可注入:测试让驱动 adopt mock server,不必占用默认端口。
async fn run_server_turn_with_probe_port(
    core: TurnCore,
    req: SendRequest,
    bin: String,
    server: Arc<OpencodeServerState>,
    killed: Arc<AtomicBool>,
    virtual_pid: u32,
    probe_port: u16,
) {
    let mut state = TurnState::new(req.session_id.clone());
    let mut view = TurnView::default();
    let preassigned_session_id = req.session_id.clone();
    let result = turn_inner(
        &core, &mut state, &mut view, &req, &bin, &server, &killed, probe_port,
    )
    .await;
    // Pending questions die with the turn: settle their cards BEFORE any
    // terminal dispatch, or the monotonic saw_done/saw_error guard would drop
    // these and leave answerable cards pointing at a settled turn.
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
    if let Err(error) = result {
        core.dispatch_event(&mut state, EngineEvent::Error(error));
    }
    if !state.saw_done && !state.saw_error {
        // User-initiated stop commits the partial turn as done; an SSE drop
        // mid-turn without any content is an error (reported by turn_inner).
        let session_id = state.native_session_id.clone();
        let usage = if killed.load(Ordering::SeqCst) {
            None
        } else {
            view.last_usage.clone()
        };
        core.dispatch_event(&mut state, EngineEvent::Done { session_id, usage });
    }
    core.registry.remove_if_pid(&core.run_id, virtual_pid);
    if let Some(session_id) = state.native_session_id.clone() {
        core.registry.remove_if_pid(&session_id, virtual_pid);
    }
    if let Some(session_id) = preassigned_session_id {
        core.registry.remove_if_pid(&session_id, virtual_pid);
    }
    core.sink.flush();
}

async fn turn_inner(
    core: &TurnCore,
    state: &mut TurnState,
    view: &mut TurnView,
    req: &SendRequest,
    bin: &str,
    server: &Arc<OpencodeServerState>,
    killed: &Arc<AtomicBool>,
    probe_port: u16,
) -> Result<(), String> {
    let origin = opencode_server::ensure_server(server, bin, probe_port).await?;
    let directory = req.workspace.to_string_lossy().to_string();

    // The context gauge needs the model's window; opencode's usage payload
    // never carries one, so read the server's merged config once per turn and
    // attach it on each usage event (a probe failure just keeps the gauge's
    // own fallback — never fails the turn).
    view.context_windows = load_context_windows(&origin, &directory).await;

    // Session continuity: resume the stored ses_ id, else create one. The
    // question tool only exists server-side, so the session must live on the
    // server even though the transcript renders here.
    let session_id = match req.session_id.as_deref() {
        Some(id) => id.to_string(),
        None => create_session(&origin, &directory, &req.prompt).await?,
    };
    core.dispatch_event(state, EngineEvent::SessionId(session_id.clone()));

    // The SSE stream must be live before the prompt, or a question asked at
    // the very top of the turn would park unnoticed. Spawning the reader is
    // not enough — wait for the subscription to actually connect (bounded:
    // a wedged stream must not stall sends, but the user hears about it).
    let (mut events, ready) = spawn_event_stream(&origin, &directory, session_id.clone());
    let ready = tokio::time::timeout(Duration::from_secs(5), ready).await;
    if !matches!(ready, Ok(Ok(true))) {
        core.dispatch_event(
            state,
            EngineEvent::Warn("事件流未就绪，本轮中的提问请求可能无法显示".to_string()),
        );
    }
    prompt(&origin, &directory, &session_id, req).await?;

    let mut kill_poll = tokio::time::interval(KILL_POLL);
    kill_poll.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    // Wire value for answering permission asks this turn: bypass remembers
    // approvals session-wide ("always"), every other mode approves each ask
    // individually ("once").
    let permission_reply = permission_reply(req.permission.as_deref());
    loop {
        tokio::select! {
            frame = events.recv() => match frame {
                Some(value) => {
                    handle_server_event(core, state, view, &value, &origin, &directory, permission_reply).await;
                    if view.turn_ended {
                        return Ok(());
                    }
                }
                // The server dropped the stream mid-turn: without it neither
                // content nor asks arrive. Done/error already seen settles
                // normally; anything else is a transport failure.
                None => {
                    if view.turn_ended || state.saw_done || state.saw_error {
                        return Ok(());
                    }
                    return Err("opencode 事件流中断,本轮结果未知".to_string());
                }
            },
            _ = kill_poll.tick() => {
                if killed.load(Ordering::SeqCst) {
                    let _ = opencode_server::post(
                        &origin,
                        &format!("/session/{session_id}/abort"),
                        &directory,
                        None,
                    )
                    .await;
                    return Ok(());
                }
            }
        }
    }
}

/// Effective model context windows from the server's merged config:
/// `provider.<pid>.models.<mid>.limit.context` → `"pid/mid"`. Best effort —
/// a missing/unreachable config just yields an empty map, and the gauge keeps
/// its own fallback.
async fn load_context_windows(origin: &str, directory: &str) -> HashMap<String, u64> {
    let Ok(client) = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
    else {
        return HashMap::new();
    };
    let Ok(response) = client
        .get(format!("{origin}/config"))
        .query(&[("directory", directory)])
        .send()
        .await
    else {
        return HashMap::new();
    };
    if !response.status().is_success() {
        return HashMap::new();
    }
    match response.json::<Value>().await {
        Ok(config) => parse_context_windows(&config),
        Err(_) => HashMap::new(),
    }
}

/// Pull `provider.<pid>.models.<mid>.limit.context` into a `"pid/mid"` map.
fn parse_context_windows(config: &Value) -> HashMap<String, u64> {
    let mut windows = HashMap::new();
    let Some(providers) = config.get("provider").and_then(Value::as_object) else {
        return windows;
    };
    for (provider_id, provider) in providers {
        let Some(models) = provider.get("models").and_then(Value::as_object) else {
            continue;
        };
        for (model_id, model) in models {
            if let Some(context) = model.pointer("/limit/context").and_then(Value::as_u64) {
                windows.insert(format!("{provider_id}/{model_id}"), context);
            }
        }
    }
    windows
}

/// Attach the model's window to a usage payload when opencode didn't report
/// one, keyed as `model_context_window` — the field the rest of the app reads.
/// The provider/model come off the assistant message, so resumed sessions and
/// model switches both resolve correctly.
fn attach_context_window(
    mut usage: Value,
    info: &Value,
    windows: &HashMap<String, u64>,
) -> Value {
    if usage.get("model_context_window").is_some() {
        return usage;
    }
    let provider = info.get("providerID").and_then(Value::as_str).unwrap_or("");
    let model = info.get("modelID").and_then(Value::as_str).unwrap_or("");
    if provider.is_empty() || model.is_empty() {
        return usage;
    }
    if let Some(window) = windows.get(&format!("{provider}/{model}")) {
        if let Some(object) = usage.as_object_mut() {
            object.insert("model_context_window".to_string(), Value::from(*window));
        }
    }
    usage
}

async fn create_session(origin: &str, directory: &str, prompt: &str) -> Result<String, String> {
    let title: String = prompt.trim().chars().take(40).collect();
    let body = if title.is_empty() {
        json!({})
    } else {
        json!({ "title": title })
    };
    let created = reqwest::Client::new()
        .post(format!("{origin}/session"))
        .query(&[("directory", directory)])
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("opencode 创建会话失败:{e}"))?
        .json::<Value>()
        .await
        .map_err(|e| format!("opencode 创建会话响应无法解析:{e}"))?;
    created
        .get("id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "opencode 创建会话未返回 id".to_string())
}

async fn prompt(
    origin: &str,
    directory: &str,
    session_id: &str,
    req: &SendRequest,
) -> Result<(), String> {
    let mut parts = vec![json!({ "type": "text", "text": req.prompt })];
    // Images ride as data-URL file parts (the serve transport).
    for raw in &req.images {
        let (mime, data) = super::images::load_image(raw, &req.workspace)?;
        parts.push(json!({
            "type": "file",
            "mime": mime,
            "url": format!("data:{mime};base64,{data}"),
        }));
    }
    let mut body = json!({ "parts": parts });
    // GUI model selectors are `provider/model`; prompt_async wants the split.
    if let Some(model) = req.model.as_deref().and_then(|m| m.split_once('/')) {
        body["model"] = json!({ "providerID": model.0, "modelID": model.1 });
    }
    // "plan" selects the read-only plan agent; "auto" is the default build agent.
    if req.permission.as_deref() == Some("plan") {
        body["agent"] = json!("plan");
    }
    if let Some(effort) = req
        .effort
        .as_deref()
        .map(str::trim)
        .filter(|e| !e.is_empty())
    {
        body["variant"] = json!(effort);
    }
    let response = reqwest::Client::new()
        .post(format!("{origin}/session/{session_id}/prompt_async"))
        .query(&[("directory", directory)])
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("opencode 任务下发失败:{e}"))?;
    if !response.status().is_success() {
        let status = response.status();
        let detail = response.text().await.unwrap_or_default();
        return Err(format!("opencode 任务下发失败（{status}）: {detail}"));
    }
    Ok(())
}

/// Spawn the global SSE reader (`GET /event`) and forward decoded frames for
/// this session only. The channel closes when the stream ends. The oneshot
/// reports whether the subscription connected, so the prompt can gate on it.
fn spawn_event_stream(
    origin: &str,
    directory: &str,
    session_id: String,
) -> (mpsc::Receiver<Value>, tokio::sync::oneshot::Receiver<bool>) {
    let (tx, rx) = mpsc::channel::<Value>(64);
    let (ready_tx, ready_rx) = tokio::sync::oneshot::channel::<bool>();
    let url = format!("{origin}/event");
    let directory = directory.to_string();
    tokio::spawn(async move {
        let response = reqwest::Client::new()
            .get(&url)
            .query(&[("directory", directory.as_str())])
            .send()
            .await;
        let Ok(response) = response else {
            let _ = ready_tx.send(false);
            return;
        };
        let _ = ready_tx.send(response.status().is_success());
        let mut buffer = String::new();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let Ok(chunk) = chunk else { break };
            buffer.push_str(&String::from_utf8_lossy(&chunk));
            // SSE frames are blank-line separated; only `data:` lines matter.
            while let Some(at) = buffer.find("\n\n") {
                let frame = buffer[..at].to_string();
                buffer.drain(..at + 2);
                for line in frame.lines() {
                    let Some(data) = line.strip_prefix("data:") else {
                        continue;
                    };
                    let Ok(value) = serde_json::from_str::<Value>(data.trim()) else {
                        continue;
                    };
                    // Only this turn's session: the global stream mixes every
                    // session on the server. Session-less frames (heartbeats,
                    // server.connected) never match and drop here.
                    let matches_session = value
                        .pointer("/properties/sessionID")
                        .and_then(Value::as_str)
                        == Some(session_id.as_str());
                    if matches_session && tx.send(value).await.is_err() {
                        return;
                    }
                }
            }
        }
    });
    (rx, ready_rx)
}

/// Reply sent to `permission.asked`: bypass pre-approves matching asks for
/// the rest of the session ("always"), every other mode approves each ask
/// individually ("once"). Explicit `deny` rules never produce an ask, so
/// they hold under either reply.
fn permission_reply(permission: Option<&str>) -> &'static str {
    if permission == Some("bypass") {
        "always"
    } else {
        "once"
    }
}

/// One server event for this session, projected to engine events.
async fn handle_server_event(
    core: &TurnCore,
    state: &mut TurnState,
    view: &mut TurnView,
    value: &Value,
    origin: &str,
    directory: &str,
    permission_reply: &str,
) {
    let kind = value.get("type").and_then(Value::as_str).unwrap_or("");
    let properties = value.get("properties").cloned().unwrap_or(Value::Null);
    match kind {
        "message.part.updated" => {
            let part = properties.get("part").cloned().unwrap_or(Value::Null);
            let part_type = part.get("type").and_then(Value::as_str).unwrap_or("");
            let key = (
                part.get("messageID")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                part.get("id")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
            );
            view.part_types.insert(key, part_type.to_string());
            if part_type == "tool" {
                handle_tool_part(core, state, &part);
            }
        }
        "message.part.delta" => {
            let key = (
                properties
                    .get("messageID")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                properties
                    .get("partID")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
            );
            let delta = properties
                .get("delta")
                .and_then(Value::as_str)
                .unwrap_or("");
            if delta.is_empty() {
                return;
            }
            view.saw_content = true;
            match view.part_types.get(&key).map(String::as_str) {
                Some("reasoning") => {
                    core.dispatch_event(state, EngineEvent::Thinking(delta.to_string()))
                }
                // Unknown parts default to text: part.updated normally lands
                // before the first delta, and text is the common case.
                _ => core.dispatch_event(state, EngineEvent::Delta(delta.to_string())),
            }
        }
        "message.updated" => {
            let info = properties.get("info").cloned().unwrap_or(Value::Null);
            if info.get("role").and_then(Value::as_str) != Some("assistant") {
                return;
            }
            // Finished assistant messages carry the authoritative token usage.
            if let Some(tokens) = info.get("tokens").filter(|t| !t.is_null()) {
                let usage = attach_context_window(tokens.clone(), &info, &view.context_windows);
                view.last_usage = Some(usage.clone());
                core.dispatch_event(state, EngineEvent::Usage(usage));
            }
            // A model/API error embedded in the assistant message fails the
            // turn when nothing else recovers it.
            if let Some(message) = extract_error_message(&info) {
                core.dispatch_event(state, EngineEvent::Warn(message));
            }
        }
        "session.status" => {
            let status = properties.pointer("/status/type").and_then(Value::as_str);
            match status {
                Some("idle") => {
                    view.turn_ended = true;
                    // Done is dispatched by the caller after the question
                    // drain, with the usage snapshot attached.
                }
                Some("retry") => {
                    core.dispatch_event(
                        state,
                        EngineEvent::Retry {
                            attempt: properties
                                .pointer("/status/attempt")
                                .and_then(Value::as_u64)
                                .unwrap_or(0),
                            max: 0,
                            message: properties
                                .pointer("/status/message")
                                .and_then(Value::as_str)
                                .unwrap_or("")
                                .to_string(),
                        },
                    );
                }
                Some("busy") => {
                    // Clears any retry indicator on the run status line.
                    core.dispatch_event(
                        state,
                        EngineEvent::Retry {
                            attempt: 0,
                            max: 0,
                            message: String::new(),
                        },
                    );
                }
                _ => {}
            }
        }
        "session.error" => {
            let message = extract_error_message(&properties)
                .unwrap_or_else(|| "opencode 会话错误".to_string());
            view.turn_ended = true;
            core.dispatch_event(state, EngineEvent::Error(message));
        }
        "question.asked" => park_question(core, state, &properties, origin, directory),
        "question.replied" | "question.rejected" => {
            if let Some(request_id) = properties
                .get("requestID")
                .and_then(Value::as_str)
                .map(str::to_string)
            {
                core.dispatch_event(state, EngineEvent::QuestionSettled { request_id });
            }
        }
        "permission.asked" => {
            // The attached client has no approval UI; the old one-shot run
            // ran under the CLI's own config (allow by default). Auto-allow
            // instead of parking the turn: "always" under bypass (the
            // server remembers it for the session), "once" otherwise.
            if let Some(request_id) = properties.get("id").and_then(Value::as_str) {
                let _ = opencode_server::post(
                    origin,
                    &format!("/permission/{request_id}/reply"),
                    directory,
                    Some(json!({ "reply": permission_reply })),
                )
                .await;
            }
        }
        _ => {}
    }
}

/// One tool part's state transition: "running" opens the row,
/// completed/error patches its result (the pi row convention).
fn handle_tool_part(core: &TurnCore, state: &mut TurnState, part: &Value) {
    let name = part.get("tool").and_then(Value::as_str).unwrap_or("tool");
    let tool_state = part.get("state").cloned().unwrap_or(Value::Null);
    let status = tool_state
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("");
    match status {
        "completed" | "error" => {
            let result = if status == "error" {
                json!({
                    "text": tool_state.get("error").and_then(Value::as_str).unwrap_or("tool error"),
                    "isError": true,
                })
            } else {
                tool_state.get("output").cloned().unwrap_or(Value::Null)
            };
            core.dispatch_event(state, super::tool_result_patch(name, Some(&result)));
        }
        "running" | "pending" => {
            core.dispatch_event(
                state,
                super::tool_call_message(name, tool_state.get("input")),
            );
        }
        _ => {}
    }
}

/// Park a server-side question: surface the card and stash the answer
/// context (HTTP reply needs origin + requestId + the original questions for
/// answer ordering) under the same request id.
fn park_question(
    core: &TurnCore,
    state: &mut TurnState,
    properties: &Value,
    origin: &str,
    directory: &str,
) {
    let request_id = properties
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let questions = render_questions(properties);
    if request_id.is_empty() || questions.is_empty() {
        return;
    }
    core.dispatch_event(
        state,
        EngineEvent::Question {
            request_id: request_id.clone(),
            tool_use_id: None,
            input: json!({ "questions": questions }),
        },
    );
    // dispatch_event parked the render input; overwrite with the answer
    // context the answer command actually needs.
    if let Some(entry) = core.registry.get(&core.run_id) {
        if let Ok(mut parked) = entry.questions.lock() {
            parked.insert(
                request_id,
                json!({
                    "opencode": {
                        "origin": origin,
                        "directory": directory,
                        "requestId": properties.get("id").cloned().unwrap_or(Value::Null),
                        "request": properties,
                    }
                }),
            );
        }
    }
}

/// Project a `question.asked` payload onto the card spec: `multiple` →
/// `multiSelect`, options pass through. `custom` needs nothing — the card
/// always offers free-form input. The answer command re-derives answer keys
/// from the parked original through this same mapping.
fn render_questions(properties: &Value) -> Vec<Value> {
    let Some(questions) = properties.get("questions").and_then(Value::as_array) else {
        return Vec::new();
    };
    questions
        .iter()
        .map(|question| {
            json!({
                "question": question.get("question").and_then(Value::as_str).unwrap_or(""),
                "header": question.get("header").and_then(Value::as_str).unwrap_or("提问"),
                "multiSelect": question.get("multiple").and_then(Value::as_bool).unwrap_or(false),
                "options": question.get("options").cloned().unwrap_or_else(|| json!([])),
            })
        })
        .collect()
}

/// Build the `/question/:requestID/reply` body from the UI's answer map
/// (rendered question text → label(s) or free-form text): one string array
/// per question, in the original order; free text travels as its own entry
/// (opencode treats unknown labels as custom text).
/// `request` is the parked `question.asked` properties object.
pub(crate) fn reply_answers(request: &Value, answers: &Value) -> Option<Vec<Vec<String>>> {
    let rendered = render_questions(request);
    let questions = request.get("questions").and_then(Value::as_array)?;
    let map = answers.as_object()?;
    let mut out = Vec::new();
    for (index, _) in questions.iter().enumerate() {
        let key = rendered
            .get(index)
            .and_then(|r| r.get("question"))
            .and_then(Value::as_str)
            .unwrap_or("");
        let selected: Vec<String> = match map.get(key) {
            Some(Value::Array(labels)) => labels
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect(),
            Some(Value::String(text)) => vec![text.clone()],
            _ => Vec::new(),
        };
        out.push(selected);
    }
    Some(out)
}

/// Extract a readable message from an opencode error object
/// (`{name, data: {message}}` shapes, with string fallbacks).
fn extract_error_message(value: &Value) -> Option<String> {
    for pointer in ["/error/data/message", "/error/message", "/data/message"] {
        if let Some(text) = value.pointer(pointer).and_then(Value::as_str) {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    value
        .get("error")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn asked() -> Value {
        json!({
            "id": "que_1",
            "sessionID": "ses_1",
            "questions": [
                { "question": "部署到哪?", "header": "目标",
                  "options": [{ "label": "staging", "description": "预发" }, { "label": "prod" }] },
                { "question": "附带哪些组件?", "header": "组件", "multiple": true,
                  "options": [{ "label": "api" }, { "label": "web" }, { "label": "worker" }] },
                { "question": "备注?", "header": "自由", "options": [] },
            ],
        })
    }

    #[test]
    fn render_questions_maps_multiple_to_multiselect() {
        let rendered = render_questions(&asked());
        assert_eq!(rendered.len(), 3);
        assert_eq!(rendered[0]["header"], "目标");
        assert_eq!(rendered[0]["multiSelect"], false);
        assert_eq!(rendered[0]["options"][0]["description"], "预发");
        assert_eq!(rendered[1]["multiSelect"], true);
        assert_eq!(rendered[2]["options"], json!([]));
        // 缺 header 时兜底。
        assert_eq!(
            render_questions(&json!({ "questions": [{ "question": "x" }] }))[0]["header"],
            "提问"
        );
        assert_eq!(render_questions(&json!({})), Vec::<Value>::new());
    }

    #[test]
    fn reply_answers_orders_labels_and_free_text_per_question() {
        let answers = json!({
            "部署到哪?": "prod",
            "附带哪些组件?": ["api", "worker"],
            "备注?": "周三灰度",
        });
        let reply = reply_answers(&asked(), &answers).expect("reply");
        assert_eq!(
            reply,
            vec![
                vec!["prod".to_string()],
                vec!["api".to_string(), "worker".to_string()],
                vec!["周三灰度".to_string()],
            ]
        );
        // 未回答的问题回空数组,位置不动。
        let partial = reply_answers(&asked(), &json!({})).expect("reply");
        assert_eq!(partial, vec![Vec::<String>::new(), Vec::new(), Vec::new()]);
        // 畸形上下文不悄悄吞掉。
        assert!(reply_answers(&json!({}), &answers).is_none());
    }

    /// End-to-end against a mock `opencode serve` on the default port:
    /// health → session create → prompt_async → SSE (delta + question.asked)
    /// → HTTP reply → idle → Done. Proves the whole driver path without a
    /// live model.
    #[tokio::test]
    async fn serves_a_full_question_turn_against_a_mock_server() {
        use crate::engine::registry::ChildEntry;
        use crate::engine::ProcessRegistry;
        use crate::event_sink::{Emit, EventSink};
        use std::sync::Mutex as StdMutex;
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        use tokio::net::TcpListener;

        struct CollectingEmitter(StdMutex<Vec<String>>);
        impl Emit for CollectingEmitter {
            fn emit_json(&self, _name: &str, raw_json: &str) {
                self.0.lock().unwrap().push(raw_json.to_string());
            }
        }

        async fn respond_json(socket: &mut tokio::net::TcpStream, body: &str) {
            let response = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = socket.write_all(response.as_bytes()).await;
        }

        let (reply_seen_tx, mut reply_seen) = mpsc::channel::<String>(1);
        // The mock server: one connection at a time, scripted responses.
        // 非默认端口:不跟本机真实 opencode serve(4096)打架,驱动侧也用同
        // 一个探测端口 adopt 这个 mock。
        const MOCK_PORT: u16 = 4190;
        let listener = TcpListener::bind(("127.0.0.1", MOCK_PORT))
            .await
            .expect("mock server must bind its port");
        let server_task = tokio::spawn(async move {
            let mut sse_socket = None;
            loop {
                let (mut socket, _) = listener.accept().await.expect("accept");
                let mut head = Vec::new();
                let mut byte = [0u8; 1];
                // Read request line + headers (bodies are small; read per
                // content-length below).
                while !head.windows(4).any(|w| w == b"\r\n\r\n") {
                    if socket.read(&mut byte).await.unwrap_or(0) == 0 {
                        break;
                    }
                    head.push(byte[0]);
                    if head.len() > 16384 {
                        break;
                    }
                }
                let head = String::from_utf8_lossy(&head).to_string();
                let request_line = head.lines().next().unwrap_or("").to_string();
                // Header 名大小写不敏感:本机代理会重写为 Content-Length。
                let content_length: usize = head
                    .lines()
                    .find_map(|l| {
                        let (name, value) = l.split_once(':')?;
                        name.trim()
                            .eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse().ok())
                            .flatten()
                    })
                    .unwrap_or(0);
                let mut body = vec![0u8; content_length];
                if content_length > 0 {
                    let _ = socket.read_exact(&mut body).await;
                }
                eprintln!("[mock] {request_line}");
                if request_line.starts_with("GET /global/health") {
                    respond_json(&mut socket, r#"{"healthy":true,"version":"mock"}"#).await;
                } else if request_line.starts_with("POST /session?") {
                    respond_json(&mut socket, r#"{"id":"ses_mock1","slug":"mock"}"#).await;
                } else if request_line.starts_with("GET /event") {
                    // Chunked SSE stream; keep the socket for scripted frames.
                    let _ = socket
                        .write_all(
                            b"HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ntransfer-encoding: chunked\r\n\r\n",
                        )
                        .await;
                    sse_socket = Some(socket);
                } else if request_line.starts_with("POST /session/ses_mock1/prompt_async") {
                    let _ = socket
                        .write_all(b"HTTP/1.1 204 No Content\r\nconnection: close\r\n\r\n")
                        .await;
                    if let Some(sse) = sse_socket.as_mut() {
                        let frames = [
                            json!({"type":"message.part.updated","properties":{"sessionID":"ses_mock1","part":{"id":"p1","messageID":"m1","type":"text"}}}),
                            json!({"type":"message.part.delta","properties":{"sessionID":"ses_mock1","messageID":"m1","partID":"p1","field":"text","delta":"先问一个问题"}}),
                            json!({"type":"question.asked","properties":{"id":"que_mock","sessionID":"ses_mock1","questions":[{"question":"部署到哪?","header":"目标","options":[{"label":"staging"},{"label":"prod"}]}]}}),
                        ];
                        for frame in frames {
                            let data = format!("data: {frame}\n\n");
                            let chunk = format!("{:x}\r\n{data}\r\n", data.len());
                            let _ = sse.write_all(chunk.as_bytes()).await;
                        }
                    }
                } else if request_line.starts_with("POST /question/que_mock/reply") {
                    let _ = reply_seen_tx
                        .send(String::from_utf8_lossy(&body).to_string())
                        .await;
                    respond_json(&mut socket, "true").await;
                    if let Some(sse) = sse_socket.as_mut() {
                        let frames = [
                            json!({"type":"message.part.delta","properties":{"sessionID":"ses_mock1","messageID":"m1","partID":"p1","field":"text","delta":",已收到 prod"}}),
                            json!({"type":"session.status","properties":{"sessionID":"ses_mock1","status":{"type":"idle"}}}),
                        ];
                        for frame in frames {
                            let data = format!("data: {frame}\n\n");
                            let chunk = format!("{:x}\r\n{data}\r\n", data.len());
                            let _ = sse.write_all(chunk.as_bytes()).await;
                        }
                    }
                } else {
                    respond_json(&mut socket, r#"{"error":"unmocked"}"#).await;
                }
            }
        });

        let emitter = Arc::new(CollectingEmitter(StdMutex::new(Vec::new())));
        let registry = Arc::new(ProcessRegistry::default());
        let core = TurnCore {
            sink: EventSink::new(emitter.clone()),
            registry: Arc::clone(&registry),
            engine_id: "opencode".to_string(),
            run_id: "oc-test-run".to_string(),
            db: None,
        };
        // The virtual registry entry the host path creates at send time.
        registry.insert(
            "oc-test-run".to_string(),
            ChildEntry {
                child: None,
                pid: 4_000_000_201,
                run_id: "oc-test-run".to_string(),
                killed: Arc::new(AtomicBool::new(false)),
                reader_abort: Arc::new(std::sync::OnceLock::new()),
                stdin: None,
                questions: Arc::new(StdMutex::new(HashMap::new())),
                plans: Arc::new(StdMutex::new(HashMap::new())),
                live_compact: None,
            },
        );
        let req = SendRequest {
            session_id: None,
            workspace: std::path::PathBuf::from("/tmp"),
            prompt: "测试提问".to_string(),
            prompt_contributions: Vec::new(),
            native_compact: false,
            images: Vec::new(),
            model: None,
            effort: None,
            service_tier: None,
            permission: None,
            additional_dirs: Vec::new(),
            provider_id: None,
            computer_use: None,
            memory_bot: None,
            allowed_tools: None,
            auto_compact_threshold_tokens: None,
        };
        let turn = tokio::spawn(run_server_turn_with_probe_port(
            core,
            req,
            "opencode".to_string(),
            Arc::new(OpencodeServerState::default()),
            Arc::new(AtomicBool::new(false)),
            4_000_000_201,
            MOCK_PORT,
        ));
        // 等提问 park 进 registry,然后走 answer_question 的完整路径:读
        // parked 上下文 → reply_answers → POST /question/:id/reply。
        let mut parked = None;
        for _ in 0..40 {
            tokio::time::sleep(Duration::from_millis(100)).await;
            parked = registry.get("oc-test-run").and_then(|entry| {
                entry
                    .questions
                    .lock()
                    .ok()
                    .and_then(|q| q.get("que_mock").cloned())
            });
            if parked.is_some() {
                break;
            }
        }
        let parked = parked.expect("question never parked");
        let context = parked.get("opencode").cloned().expect("answer context");
        let origin = context["origin"].as_str().unwrap().to_string();
        let directory = context["directory"].as_str().unwrap().to_string();
        let answers = reply_answers(&context["request"], &json!({ "部署到哪?": "prod" }))
            .expect("reply answers");
        opencode_server::post(
            &origin,
            "/question/que_mock/reply",
            &directory,
            Some(json!({ "answers": answers })),
        )
        .await
        .expect("reply post");
        turn.await.expect("turn task");
        server_task.abort();

        let events = emitter.0.lock().unwrap().clone();
        let mut kinds = Vec::new();
        for raw in &events {
            let flushed: Value = serde_json::from_str(raw).expect("flushed batch must be JSON");
            for value in flushed.as_array().cloned().unwrap_or_else(|| vec![flushed]) {
                kinds.push((
                    value
                        .get("kind")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string(),
                    value.get("data").cloned().unwrap_or(Value::Null),
                ));
            }
        }
        // Session announced, deltas streamed, question parked, done settled.
        assert!(
            kinds
                .iter()
                .any(|(k, d)| k == "session" && d == "ses_mock1"),
            "{kinds:?}"
        );
        let deltas: String = kinds
            .iter()
            .filter(|(k, _)| k == "delta")
            .filter_map(|(_, d)| d.as_str())
            .collect();
        assert_eq!(deltas, "先问一个问题,已收到 prod", "{kinds:?}");
        let question = kinds
            .iter()
            .find(|(k, _)| k == "question")
            .map(|(_, d)| d.clone())
            .expect("no question event");
        assert_eq!(question["requestId"], "que_mock");
        assert_eq!(
            question["input"]["questions"][0]["options"][1]["label"],
            "prod"
        );
        assert!(kinds.iter().any(|(k, _)| k == "done"), "{kinds:?}");
        assert!(!kinds.iter().any(|(k, _)| k == "error"), "{kinds:?}");

        // The answered card must be out of the parked map (answer path removes
        // it before the turn-end drain ever sees it — same contract as the
        // answer_question command).
        let still_parked = registry.get("oc-test-run").and_then(|entry| {
            entry
                .questions
                .lock()
                .ok()
                .and_then(|q| q.get("que_mock").cloned())
        });
        // The reply was posted directly (mirroring answer_question), which
        // does not remove the parked copy; the drain settles it afterwards.
        assert!(
            still_parked.is_none(),
            "drain must settle the parked question"
        );
        // The mock saw the reply body the driver's mapping produced.
        let reply_body = reply_seen.try_recv().expect("mock saw no reply POST");
        let reply_json: Value = serde_json::from_str(&reply_body).expect("reply body json");
        assert_eq!(reply_json, json!({ "answers": [["prod"]] }));
    }

    #[test]
    fn parses_context_windows_from_merged_config() {
        let config = json!({
            "provider": {
                "qf": { "models": {
                    "deepseek-v4.1-flash": {
                        "limit": { "context": 1_048_576, "output": 393_216 }
                    },
                    "no-limit": {}
                }},
                "opencode": { "models": {
                    "big-pickle": { "limit": { "context": 200_000 } }
                }}
            }
        });
        let windows = parse_context_windows(&config);
        assert_eq!(windows.get("qf/deepseek-v4.1-flash"), Some(&1_048_576));
        assert_eq!(windows.get("opencode/big-pickle"), Some(&200_000));
        assert_eq!(windows.get("qf/no-limit"), None);
        assert!(parse_context_windows(&json!({})).is_empty());
        // The mock server's unmocked reply must not match or panic.
        assert!(parse_context_windows(&json!({ "error": "unmocked" })).is_empty());
    }

    #[test]
    fn attaches_the_window_only_when_usage_omits_it() {
        let mut windows = HashMap::new();
        windows.insert("qf/deepseek-v4.1-flash".to_string(), 1_048_576u64);
        let info = json!({ "providerID": "qf", "modelID": "deepseek-v4.1-flash" });

        let usage =
            attach_context_window(json!({ "input": 12018, "output": 50 }), &info, &windows);
        assert_eq!(usage["model_context_window"], 1_048_576);

        // An engine-reported window wins; an unknown model stays untouched.
        let reported = attach_context_window(
            json!({ "input": 1, "model_context_window": 200_000 }),
            &info,
            &windows,
        );
        assert_eq!(reported["model_context_window"], 200_000);
        let unknown = attach_context_window(
            json!({ "input": 1 }),
            &json!({ "providerID": "other", "modelID": "x" }),
            &windows,
        );
        assert!(unknown.get("model_context_window").is_none());
    }

    #[test]
    fn error_messages_come_out_of_nested_shapes() {
        assert_eq!(
            extract_error_message(&json!({
                "error": { "name": "APIError", "data": { "message": "invalid x-api-key" } }
            })),
            Some("invalid x-api-key".to_string())
        );
        assert_eq!(
            extract_error_message(&json!({ "error": "plain" })),
            Some("plain".to_string())
        );
        assert_eq!(extract_error_message(&json!({})), None);
    }

    #[test]
    fn bypass_answers_permission_asks_always() {
        assert_eq!(permission_reply(Some("bypass")), "always");
        // Every other mode (and unresolved/unknown values) approves each
        // ask individually; the engine trait already falls back to "auto".
        assert_eq!(permission_reply(Some("auto")), "once");
        assert_eq!(permission_reply(Some("plan")), "once");
        assert_eq!(permission_reply(Some("manual")), "once");
        assert_eq!(permission_reply(None), "once");
    }
}
