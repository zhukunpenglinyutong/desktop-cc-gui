//! DSH host-session turn driver: one codemoss send = one host turn, streamed
//! over the gateway mux.
//!
//! Wire (verified live against dsh 0.1.2):
//! - RPC is plain HTTP ([`crate::dsh_host::host_call`], cookie-authenticated):
//!   `workspace/create` → `session/create` (resume passes the known
//!   sessionId) → `session/selectModel`? → `session/prompt` (mode "queue");
//!   interrupt sends `session/cancel`.
//! - Streams share one WebSocket, `ws://<origin>/api/remote.mux` with the
//!   auth cookie: open `$events` (the ready frame yields the events clientId;
//!   waterfall frames are approval/question calls, answered via
//!   `$events/result`) and `session/follow` with **`assistantStream: true`** —
//!   the opt-in that adds live `assistant-stream` frames (start / chunk
//!   {block-start, text-delta, reasoning-delta, usage, finish, block-end} /
//!   end committed). Without the opt-in only durable session events flow
//!   (assistant/message lands whole — that is tmd-cli's subscription).
//! - Durable follow events project to tool rows; durable `assistant/message`
//!   renders only when an attempt streamed no deltas (fallback), so live
//!   text never doubles.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;

use super::{EngineEvent, SendRequest, TurnCore, TurnState};
use crate::dsh_host::host_call;

const STREAM_EVENTS: &str = "events";
const STREAM_FOLLOW: &str = "follow";
/// Follow history replay is useless here (codemoss renders its own stored
/// conversation); the smallest window keeps the opening snapshot light.
const FOLLOW_MAX_MESSAGES: u32 = 1;
/// The killed-flag poll cadence inside the WS select loop.
const KILL_POLL: Duration = Duration::from_millis(150);
/// Wait for the follow snapshot (proof the subscription is live) at most
/// this long before dispatching the prompt.
const FOLLOW_READY_TIMEOUT: Duration = Duration::from_secs(5);

type Ws = tokio_tungstenite::WebSocketStream<
    tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
>;

/// Per-turn view state: live deltas arrive per assistant attempt, and the
/// durable `assistant/message` settlement must not double-render them.
#[derive(Default)]
struct TurnView {
    attempt_streamed_text: bool,
    last_usage: Option<Value>,
    turn_ended: bool,
    /// `$events` clientId from the ready frame; required on every answer.
    events_client_id: Option<String>,
    /// callId → tool name from dispatched `tool/call` rows, so the matching
    /// `tool/result` patch can find the row it belongs to.
    tool_names: HashMap<String, String>,
}

/// Drive one send as a host turn. Mirrors `run_reader`'s settle contract:
/// dispatch events until a terminal done/error, then drain this run's
/// registry entries. Transport/rpc failures surface as `EngineEvent::Error`.
pub(crate) async fn run_host_turn(
    core: TurnCore,
    req: SendRequest,
    host: Arc<crate::dsh_host::DshHostState>,
    killed: Arc<AtomicBool>,
    virtual_pid: u32,
) {
    let mut state = TurnState::new(req.session_id.clone());
    let mut view = TurnView::default();
    let result = turn_inner(&core, &mut state, &mut view, &req, &host, &killed).await;
    if let Err(error) = result {
        core.dispatch_event(&mut state, EngineEvent::Error(error));
    }
    // An interrupted run commits its partial output as a normal turn end —
    // the same contract as the SIGKILL'd process path.
    if !state.saw_done && !state.saw_error {
        let usage = if killed.load(Ordering::SeqCst) {
            None
        } else {
            view.last_usage.clone()
        };
        let session_id = state.native_session_id.clone();
        core.dispatch_event(
            &mut state,
            EngineEvent::Done { session_id, usage },
        );
    }
    core.registry.remove_if_pid(&core.run_id, virtual_pid);
    if let Some(session_id) = state.native_session_id.clone() {
        core.registry.remove_if_pid(&session_id, virtual_pid);
    }
    core.sink.flush();
}

async fn turn_inner(
    core: &TurnCore,
    state: &mut TurnState,
    view: &mut TurnView,
    req: &SendRequest,
    host: &Arc<crate::dsh_host::DshHostState>,
    killed: &Arc<AtomicBool>,
) -> Result<(), String> {
    // The host must be up before anything else: ensure adopts or spawns it
    // (serialized internally, so a chat send racing autostart is safe).
    let settings = crate::settings::read_settings().unwrap_or_default();
    let origin = crate::dsh_host::configured_origin(&settings);
    crate::dsh_host::ensure_host(host, &settings).await?;
    let cookie = crate::dsh_host::host_cookie(&origin);

    // Workspace: registered by path so resumed sessions keep their identity.
    let workspace = host_call(
        &origin,
        "workspace/create",
        json!({ "request": { "path": req.workspace.to_string_lossy() } }),
    )
    .await?
    .pointer("/workspace/workspaceId")
    .and_then(Value::as_str)
    .map(str::to_string)
    .ok_or("workspace/create 未返回 workspaceId")?;

    // Session continuity: codemoss passes back the native id it received via
    // the "session" event; a fresh id comes back for a new conversation.
    let mut create_args = json!({ "request": { "workspaceId": workspace } });
    if let Some(session_id) = req.session_id.as_deref() {
        create_args["request"]["sessionId"] = Value::String(session_id.to_string());
    }
    let session_id = host_call(&origin, "session/create", create_args)
        .await?
        .pointer("/sessionId")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or("session/create 未返回 sessionId")?;
    core.dispatch_event(state, EngineEvent::SessionId(session_id.clone()));

    // Model: the picker's ids are `provider/model` selector ids (models.rs).
    if let Some(model) = req.model.as_deref().filter(|m| m.contains('/')) {
        let (provider, model) = model.split_once('/').unwrap_or(("", model));
        if !provider.is_empty() && !model.is_empty() {
            let selected = host_call(
                &origin,
                "session/selectModel",
                json!({ "request": { "sessionId": session_id, "provider": provider, "model": model } }),
            )
            .await;
            if selected.is_err() {
                core.dispatch_event(
                    state,
                    EngineEvent::Warn(format!("模型切换未生效，继续使用会话当前模型：{model}")),
                );
            }
        }
    }

    let mut ws = mux_connect(&origin, cookie.as_deref()).await?;
    // Streams must be live before the prompt so no turn event races the
    // subscription; the follow snapshot proves the subscription landed.
    ws_open_and_wait(&mut ws, &session_id).await;

    let prompt = host_call(
        &origin,
        "session/prompt",
        json!({
            "request": {
                "requestId": format!("codemoss-{}", uuid::Uuid::new_v4()),
                "sessionId": session_id,
                "mode": "queue",
                "content": [{ "type": "text", "text": req.prompt }],
                "clientTimeZone": client_time_zone(),
            }
        }),
    )
    .await;
    if let Err(error) = prompt {
        let _ = ws.close(None).await;
        return Err(format!("任务下发失败：{error}"));
    }

    let (mut write, mut read) = ws.split();
    let mut kill_poll = tokio::time::interval(KILL_POLL);
    kill_poll.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            frame = read.next() => match frame {
                Some(Ok(Message::Text(text))) => {
                    let Ok(parsed) = serde_json::from_str::<Value>(text.as_str()) else {
                        continue;
                    };
                    if parsed.get("type").and_then(Value::as_str) != Some("item") {
                        continue;
                    }
                    let stream_id = parsed.get("streamId").and_then(Value::as_str).unwrap_or("");
                    let value = parsed.get("value").cloned().unwrap_or(Value::Null);
                    match stream_id {
                        STREAM_FOLLOW => handle_follow(core, state, view, &value),
                        STREAM_EVENTS => {
                            handle_events_frame(core, state, view, &value, &origin).await;
                        }
                        _ => {}
                    }
                    if view.turn_ended {
                        break;
                    }
                }
                Some(Ok(_)) => {} // ping/pong/binary: keep the loop going
                Some(Err(error)) => {
                    if killed.load(Ordering::SeqCst) || view.turn_ended {
                        break;
                    }
                    return Err(format!("dsh 会话流中断：{error}"));
                }
                None => {
                    if killed.load(Ordering::SeqCst) || view.turn_ended {
                        break;
                    }
                    return Err("dsh 会话流已关闭".to_string());
                }
            },
            _ = kill_poll.tick() => {
                if killed.load(Ordering::SeqCst) {
                    // Best-effort server-side cancel; if this races the
                    // turn's completion the host simply ignores it.
                    let _ = host_call(
                        &origin,
                        "session/cancel",
                        json!({ "request": { "sessionId": session_id } }),
                    )
                    .await;
                    break;
                }
            }
        }
    }
    let _ = write.close().await;
    Ok(())
}

// ==================== frame projection ====================

/// One follow-stream item: durable session events + the opted-in
/// `assistant-stream` live frames.
fn handle_follow(core: &TurnCore, state: &mut TurnState, view: &mut TurnView, value: &Value) {
    match value.get("type").and_then(Value::as_str) {
        Some("snapshot") => {} // history replay: codemoss renders its own log
        Some("event") => {
            let event = value.get("event").cloned().unwrap_or(Value::Null);
            let event_type = event.get("type").and_then(Value::as_str).unwrap_or("");
            let data = event.get("data").cloned().unwrap_or(Value::Null);
            handle_session_event(core, state, view, event_type, &data);
        }
        Some("assistant-stream") => handle_assistant_stream(core, state, view, value),
        _ => {}
    }
}

fn handle_session_event(
    core: &TurnCore,
    state: &mut TurnState,
    view: &mut TurnView,
    event_type: &str,
    data: &Value,
) {
    match event_type {
        "tool/call" => {
            let name = data.get("name").and_then(Value::as_str).unwrap_or("tool");
            if let Some(call_id) = data.get("callId").and_then(Value::as_str) {
                view.tool_names.insert(call_id.to_string(), name.to_string());
            }
            let args = data
                .get("arguments")
                .and_then(Value::as_str)
                .and_then(|text| serde_json::from_str::<Value>(text).ok())
                .or_else(|| data.get("arguments").cloned());
            core.dispatch_event(state, super::tool_call_message(name, args.as_ref()));
        }
        "tool/result" => {
            let call_id = data
                .pointer("/message/source/callId")
                .and_then(Value::as_str)
                .unwrap_or("");
            let name = view
                .tool_names
                .get(call_id)
                .cloned()
                .unwrap_or_else(|| "tool".to_string());
            let content = data
                .pointer("/message/content")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let text = content
                .iter()
                .filter_map(|block| block.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("\n");
            let is_error = content
                .iter()
                .any(|block| block.get("isError").and_then(Value::as_bool) == Some(true));
            core.dispatch_event(
                state,
                super::tool_result_patch(&name, Some(&json!({ "text": text, "isError": is_error }))),
            );
        }
        "assistant/message" => {
            // Settlement of the streamed attempt: render only when the live
            // deltas never flowed, else the message would appear twice.
            if !view.attempt_streamed_text {
                let text = message_text(data);
                if !text.is_empty() {
                    core.dispatch_event(state, EngineEvent::Delta(format!("{text}\n\n")));
                }
            }
            view.attempt_streamed_text = false;
        }
        "turn/end" => {
            view.turn_ended = true;
            let kind = data
                .pointer("/reason/kind")
                .and_then(Value::as_str)
                .unwrap_or("completed");
            if kind != "completed" {
                core.dispatch_event(state, EngineEvent::Warn(format!("本轮结束（{kind}）")));
            }
        }
        _ => {} // user/message / step/* / system/message / title: UI noise here
    }
}

/// `assistant-stream` live frames: start / chunk / end. Chunks carry the
/// model's raw deltas (text-delta, reasoning-delta, usage, finish, …).
fn handle_assistant_stream(
    core: &TurnCore,
    state: &mut TurnState,
    view: &mut TurnView,
    value: &Value,
) {
    let frame = value.get("frame").cloned().unwrap_or(Value::Null);
    match frame.get("type").and_then(Value::as_str) {
        Some("start") => view.attempt_streamed_text = false,
        Some("chunk") => {
            let chunk = frame.get("chunk").cloned().unwrap_or(Value::Null);
            match chunk.get("type").and_then(Value::as_str) {
                Some("text-delta") => {
                    let text = chunk.get("text").and_then(Value::as_str).unwrap_or("");
                    if !text.is_empty() {
                        view.attempt_streamed_text = true;
                        core.dispatch_event(state, EngineEvent::Delta(text.to_string()));
                    }
                }
                Some("reasoning-delta") => {
                    let text = chunk.get("text").and_then(Value::as_str).unwrap_or("");
                    if !text.is_empty() {
                        core.dispatch_event(state, EngineEvent::Thinking(text.to_string()));
                    }
                }
                Some("usage") => {
                    if let Some(usage) = chunk.get("usage") {
                        view.last_usage = Some(usage.clone());
                        core.dispatch_event(state, EngineEvent::Usage(usage.clone()));
                    }
                }
                _ => {} // block-start / block-end / tool-call-delta / finish
            }
        }
        _ => {} // end frames: the durable events settle the turn
    }
}

// ==================== $events (approvals / questions) ====================

async fn handle_events_frame(
    core: &TurnCore,
    state: &mut TurnState,
    view: &mut TurnView,
    value: &Value,
    origin: &str,
) {
    match value.get("type").and_then(Value::as_str) {
        // The events client id, required on every $events/result answer.
        Some("ready") => {
            if let Some(client_id) = value.get("clientId").and_then(Value::as_str) {
                view.events_client_id = Some(client_id.to_string());
            }
        }
        Some("waterfall") => {
            let Some(event_id) = value.get("eventId").and_then(Value::as_str) else {
                return;
            };
            let kind = value.get("event").and_then(Value::as_str).unwrap_or("");
            let Some(client_id) = view.events_client_id.clone() else {
                core.dispatch_event(
                    state,
                    EngineEvent::Warn("收到审批/提问请求但事件通道未就绪，已跳过".to_string()),
                );
                return;
            };
            // v1 policy: approvals auto-allow — API-created sessions already
            // run tools without a permission flow (the headless engine had
            // the same implicit behavior), and codemoss has no approval UI
            // for host sessions yet. Questions cancel with a surfaced notice.
            let (outcome, notice) = if kind == "approval/request" {
                (
                    json!({ "kind": "result", "value": "allowed-once" }),
                    None,
                )
            } else {
                (
                    json!({
                        "kind": "rejected",
                        "error": { "code": "cancelled", "message": "the user cancelled ask_user_question" },
                    }),
                    Some("已取消一个提问请求（host 会话暂无提问交互）".to_string()),
                )
            };
            let answered = host_call(
                origin,
                "$events/result",
                json!({ "clientId": client_id, "eventId": event_id, "outcome": outcome }),
            )
            .await;
            match (answered, notice) {
                (Err(_), _) => core.dispatch_event(
                    state,
                    EngineEvent::Warn("审批/提问应答失败，本轮可能被阻塞".to_string()),
                ),
                (Ok(_), Some(notice)) => {
                    core.dispatch_event(state, EngineEvent::Warn(notice));
                }
                (Ok(_), None) => {}
            }
        }
        _ => {}
    }
}

// ==================== transport helpers ====================

async fn mux_connect(origin: &str, cookie: Option<&str>) -> Result<Ws, String> {
    let authority = origin
        .strip_prefix("http://")
        .or_else(|| origin.strip_prefix("https://"))
        .unwrap_or(origin);
    let mut request = format!("ws://{authority}/api/remote.mux")
        .into_client_request()
        .map_err(|error| format!("dsh 会话流地址无效：{error}"))?;
    if let Some(value) = cookie.and_then(|cookie| cookie.parse().ok()) {
        request
            .headers_mut()
            .insert(tokio_tungstenite::tungstenite::http::header::COOKIE, value);
    }
    let (stream, _response) = tokio_tungstenite::connect_async(request)
        .await
        .map_err(|error| format!("dsh 会话流连接失败（{origin}）：{error}"))?;
    Ok(stream)
}

async fn ws_send(ws: &mut Ws, payload: Value) -> Result<(), String> {
    ws.send(Message::Text(payload.to_string().into()))
        .await
        .map_err(|error| format!("dsh 会话流发送失败：{error}"))
}

/// Open both logical streams and wait for the follow snapshot (proof the
/// subscription is live) before the caller dispatches the prompt — with a
/// bounded fallback so a gateway that skips snapshots cannot stall sends.
async fn ws_open_and_wait(ws: &mut Ws, session_id: &str) {
    let opened = async {
        ws_send(
            ws,
            json!({
                "type": "open",
                "streamId": STREAM_FOLLOW,
                "endpoint": "session/follow",
                "payload": { "args": { "request": {
                    "address": { "kind": "session", "sessionId": session_id },
                    "maxMessages": FOLLOW_MAX_MESSAGES,
                    "assistantStream": true,
                } } },
            }),
        )
        .await?;
        ws_send(
            ws,
            json!({
                "type": "open",
                "streamId": STREAM_EVENTS,
                "endpoint": "$events",
                "payload": { "args": {} },
            }),
        )
        .await
    };
    if let Err(error) = opened.await {
        eprintln!("[dsh] mux stream open failed: {error}");
        return;
    }
    let started = tokio::time::Instant::now();
    while started.elapsed() < FOLLOW_READY_TIMEOUT {
        let next = tokio::time::timeout(FOLLOW_READY_TIMEOUT - started.elapsed(), ws.next()).await;
        match next {
            Ok(Some(Ok(Message::Text(text)))) => {
                if let Ok(value) = serde_json::from_str::<Value>(text.as_str()) {
                    if value.get("type").and_then(Value::as_str) == Some("item")
                        && value.get("streamId").and_then(Value::as_str) == Some(STREAM_FOLLOW)
                        && value.pointer("/value/type").and_then(Value::as_str) == Some("snapshot")
                    {
                        return;
                    }
                }
            }
            Ok(Some(Ok(_))) | Ok(Some(Err(_))) | Ok(None) | Err(_) => return,
        }
    }
}

fn message_text(data: &Value) -> String {
    data.pointer("/message/content")
        .and_then(Value::as_array)
        .map(|blocks| {
            blocks
                .iter()
                .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
                .filter_map(|block| block.get("text").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default()
}

fn client_time_zone() -> String {
    std::env::var("TZ")
        .ok()
        .map(|tz| tz.trim_matches('"').trim().to_string())
        .filter(|tz| !tz.is_empty() && tz.contains('/'))
        .unwrap_or_else(|| "UTC".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::ProcessRegistry;
    use crate::event_sink::{Emit, EventSink};
    use std::path::PathBuf;
    use std::sync::Mutex as StdMutex;

    /// Test emitter collecting flushed event JSON for assertions.
    struct CollectingEmitter(StdMutex<Vec<String>>);

    impl Emit for CollectingEmitter {
        fn emit_json(&self, _name: &str, raw_json: &str) {
            self.0.lock().unwrap().push(raw_json.to_string());
        }
    }

    /// End-to-end against the configured local host (skipped by default):
    /// `cargo test --lib dsh_session -- --ignored --nocapture`.
    /// Proves the full chain: ensure host → workspace/session → prompt →
    /// assistantStream deltas → done, with session + usage events present.
    #[tokio::test]
    #[ignore = "needs a running dsh host at the configured origin"]
    async fn streams_a_live_host_turn() {
        let emitter = Arc::new(CollectingEmitter(StdMutex::new(Vec::new())));
        let sink = EventSink::new(emitter.clone());
        let core = TurnCore {
            sink,
            registry: Arc::new(ProcessRegistry::default()),
            engine_id: "dsh".to_string(),
            run_id: "test-run".to_string(),
        };
        let req = SendRequest {
            session_id: None,
            workspace: PathBuf::from("/tmp"),
            prompt: "用一句话回答：1+1等于几？".to_string(),
            images: Vec::new(),
            model: None,
            effort: None,
            service_tier: None,
            permission: None,
            additional_dirs: Vec::new(),
        };
        run_host_turn(
            core,
            req,
            Arc::new(crate::dsh_host::DshHostState::default()),
            Arc::new(AtomicBool::new(false)),
            4_000_000_001,
        )
        .await;

        let events = emitter.0.lock().unwrap().clone();
        for raw in &events {
            println!("event: {raw}");
        }
        assert!(!events.is_empty(), "no events flushed");
        // The sink batches each flush as a JSON array of events.
        let mut kinds: Vec<(String, Value)> = Vec::new();
        for raw in &events {
            let flushed: Value = serde_json::from_str(raw).expect("flushed batch must be JSON");
            let batch = flushed.as_array().cloned().unwrap_or_else(|| vec![flushed]);
            for value in batch {
                kinds.push((
                    value.get("kind").and_then(Value::as_str).unwrap_or("").to_string(),
                    value.get("data").cloned().unwrap_or(Value::Null),
                ));
            }
        }
        let session = kinds
            .iter()
            .find(|(kind, _)| kind == "session")
            .map(|(_, data)| data.as_str().unwrap_or("").to_string());
        let session = session.expect("session id must be announced");
        assert!(session.starts_with("session-"), "unexpected session id {session}");
        let deltas: String = kinds
            .iter()
            .filter(|(kind, _)| kind == "delta")
            .filter_map(|(_, data)| data.as_str())
            .collect();
        assert!(!deltas.trim().is_empty(), "no streamed deltas: {kinds:?}");
        assert!(
            kinds.iter().any(|(kind, _)| kind == "done"),
            "turn never settled: {kinds:?}"
        );
        assert!(
            !kinds.iter().any(|(kind, _)| kind == "error"),
            "unexpected error event: {kinds:?}"
        );
    }

    /// Resume + tools: turn 2 reuses turn 1's session id (codemoss passes it
    /// back as `session_id`), runs a tool, and projects a tool row plus its
    /// result patch. Same live-host gate as `streams_a_live_host_turn`.
    #[tokio::test]
    #[ignore = "needs a running dsh host at the configured origin"]
    async fn resumes_session_and_streams_tool_rows() {
        let run = |session_id: Option<String>, prompt: &str| {
            let prompt = prompt.to_string();
            async move {
                let emitter = Arc::new(CollectingEmitter(StdMutex::new(Vec::new())));
                let core = TurnCore {
                    sink: EventSink::new(emitter.clone()),
                    registry: Arc::new(ProcessRegistry::default()),
                    engine_id: "dsh".to_string(),
                    run_id: "test-run".to_string(),
                };
                let req = SendRequest {
                    session_id,
                    workspace: PathBuf::from("/tmp"),
                    prompt,
                    images: Vec::new(),
                    model: None,
                    effort: None,
                    service_tier: None,
                    permission: None,
                    additional_dirs: Vec::new(),
                };
                run_host_turn(
                    core,
                    req,
                    Arc::new(crate::dsh_host::DshHostState::default()),
                    Arc::new(AtomicBool::new(false)),
                    4_000_000_002,
                )
                .await;
                let events = emitter.0.lock().unwrap().clone();
                let kinds = collect_kinds(&events);
                (kinds, announced_session(&events))
            }
        };

        let (kinds1, session_id) = run(None, "用一句话回答：天空为什么是蓝色的？").await;
        assert!(!session_id.is_empty(), "turn 1 announced no session: {kinds1:?}");
        assert!(
            !kinds1.iter().any(|(kind, _)| kind == "error"),
            "turn 1 errored: {kinds1:?}"
        );

        // Resume: every payload must carry the session id from the first
        // event on (TurnState preseeded), and the tool row must stream.
        let (kinds2, session_id2) = run(
            Some(session_id.clone()),
            "请用 bash 工具执行命令 echo codemoss-stream-check，然后告诉我输出内容。",
        )
        .await;
        assert_eq!(session_id2, session_id, "resumed turn changed the session id");
        assert!(
            kinds2
                .iter()
                .any(|(kind, data)| kind == "message"
                    && data.get("role").and_then(Value::as_str) == Some("tool")),
            "no tool row streamed: {kinds2:?}"
        );
        assert!(
            kinds2
                .iter()
                .any(|(kind, data)| kind == "message"
                    && data.get("patch").and_then(Value::as_bool) == Some(true)
                    && data.get("result").is_some()),
            "no tool result patch: {kinds2:?}"
        );
        assert!(kinds2.iter().any(|(kind, _)| kind == "done"), "{kinds2:?}");
        assert!(
            !kinds2.iter().any(|(kind, _)| kind == "error"),
            "turn 2 errored: {kinds2:?}"
        );
    }

    /// Flatten the sink's batched flushes into (kind, data) pairs.
    fn collect_kinds(events: &[String]) -> Vec<(String, Value)> {
        let mut kinds = Vec::new();
        for raw in events {
            let flushed: Value = serde_json::from_str(raw).expect("flushed batch must be JSON");
            let batch = flushed.as_array().cloned().unwrap_or_else(|| vec![flushed]);
            for value in batch {
                kinds.push((
                    value.get("kind").and_then(Value::as_str).unwrap_or("").to_string(),
                    value.get("data").cloned().unwrap_or(Value::Null),
                ));
            }
        }
        kinds
    }

    /// The native session id from the "session" event, or the preseeded one
    /// carried by every payload of a resumed turn.
    fn announced_session(events: &[String]) -> String {
        for raw in events {
            let flushed: Value = serde_json::from_str(raw).expect("flushed batch must be JSON");
            let batch = flushed.as_array().cloned().unwrap_or_else(|| vec![flushed]);
            for value in batch {
                if value.get("kind").and_then(Value::as_str) == Some("session") {
                    return value
                        .pointer("/data")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string();
                }
                if let Some(id) = value.get("sessionId").and_then(Value::as_str) {
                    return id.to_string();
                }
            }
        }
        String::new()
    }
}
