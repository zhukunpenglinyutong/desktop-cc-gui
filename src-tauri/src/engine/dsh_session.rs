//! DSH host-session turn driver: one codemoss send = one host turn, streamed
//! over the gateway mux.
//!
//! Wire (verified live against dsh 0.1.2):
//! - RPC is plain HTTP ([`crate::dsh_host::host_call`], cookie-authenticated):
//!   `workspace/create` → `session/create` (resume passes the known
//!   sessionId) → `session/selectModel`? → `session/prompt` (mode "queue");
//!   interrupt sends `session/cancel`. Attachments ride the prompt as base64
//!   image content parts, after [`super::dsh_images`] declares the input
//!   modality on hand-declared `llm-pi-ai` routes (`settings/mutate`).
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

use super::{dsh_images, EngineEvent, SendRequest, TurnCore, TurnState, VirtualRunGuard};
use crate::dsh_host::host_call;

/// 提取并规范化上下文窗口字段
fn attach_context_window(mut usage: Value) -> Value {
    if usage.get("model_context_window").is_some() {
        return usage;
    }

    let window = usage
        .get("context_window")
        .or_else(|| usage.get("contextWindow"))
        .or_else(|| usage.get("model_context_window"))
        .and_then(|v| match v {
            Value::Number(n) => n.as_i64(),
            Value::String(s) => s.parse().ok(),
            _ => None,
        })
        .filter(|&w| w > 0);

    if let Some(w) = window {
        if let Some(obj) = usage.as_object_mut() {
            obj.insert("model_context_window".to_string(), Value::Number(w.into()));
        }
    }

    usage
}

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
/// plan 权限下等待 host 回读 plan/mode{active:true} 的上限：无 open turn
/// 时 /plan 立即 committed 并追加该日志事件，超时即 host 未确认。
const PLAN_MODE_CONFIRM_TIMEOUT: Duration = Duration::from_secs(10);

type Ws =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

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
    /// 工作区路径：plan-review 记录的身份字段（record.workspace_path）。
    workspace: String,
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
    let preassigned_session_id = req.session_id.clone();
    view.workspace = req.workspace.to_string_lossy().into_owned();
    // Abort-safe backstop: the by-name removals below only run when the task
    // finishes normally. An abort or a panic would otherwise leave this run's
    // keys pinning a concurrency slot until app exit.
    let _registry_guard =
        VirtualRunGuard::new(Arc::clone(&core.registry), core.run_id.clone(), virtual_pid);
    let result = turn_inner(&core, &mut state, &mut view, &req, &host, &killed).await;
    // Pending questions die with the turn: settle their cards BEFORE any
    // terminal dispatch, or the monotonic saw_done/saw_error guard in
    // dispatch_event would drop these and leave answerable cards pointing at
    // a settled turn.
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
        // 停住的计划审批随运行消亡即过期（P1 收尾义务，PRD §8 防线 3）。
        super::reader::expire_parked_plans(&core, &mut state, &key);
    }
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
        core.dispatch_event(&mut state, EngineEvent::Done { session_id, usage });
    }
    core.registry.remove_if_pid(&core.run_id, virtual_pid);
    // Clean up both the native session id (if the engine reported one) and
    // the preassigned session id (if we resumed an existing conversation).
    // A resumed session was keyed at spawn under req.session_id, so we must
    // remove that alias even if the native id differs or never arrived.
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
    // 计划审批模式（PRD §5-DSH.2）：先经 commands/list 探测 host 是否组合了
    // plan-mode 插件，缺失即受控报错——HTTP 200 不等于命令存在，绝不降级
    // auto 执行。
    let plan_mode = req.permission.as_deref() == Some("plan");
    if plan_mode {
        ensure_plan_command(&origin, &session_id).await?;
    }

    // Model: the picker's ids are `provider/model` selector ids (models.rs).
    if let Some(model) = req.model.as_deref().filter(|m| m.contains('/')) {
        let (provider, model) = model.split_once('/').unwrap_or(("", model));
        if !provider.is_empty() && !model.is_empty() {
            let mut select_args = json!({ "request": { "sessionId": session_id, "provider": provider, "model": model } });
            if let Some(effort) = req
                .effort
                .as_deref()
                .map(str::trim)
                .filter(|e| !e.is_empty())
            {
                select_args["request"]["effort"] = json!(effort);
                select_args["request"]["reasoningEffort"] = json!(effort);
            }
            let selected = host_call(&origin, "session/selectModel", select_args).await;
            if selected.is_err() {
                core.dispatch_event(
                    state,
                    EngineEvent::Warn(format!("模型切换未生效，继续使用会话当前模型：{model}")),
                );
            }
        }
    }

    // Attachments: load through the shared image pipeline, then make sure
    // the session's route actually admits images — hand-declared llm-pi-ai
    // routes default to text-only until ccgui writes the modality claim.
    let prompt_images = dsh_images::load_prompt_images(&req.images, &req.workspace)?;
    if !prompt_images.is_empty() {
        let Some((provider, model)) =
            dsh_images::current_selection(&origin, req.model.as_deref()).await
        else {
            return Err(
                "DSH 需要先选定模型才能发送图片：host 未报告当前 provider/model".to_string(),
            );
        };
        dsh_images::ensure_image_admission(&origin, &provider, &model).await?;
    }

    let mut ws = mux_connect(&origin, cookie.as_deref()).await?;
    // Streams must be live before the prompt so no turn event races the
    // subscription: the follow snapshot proves the follow subscription landed,
    // and the $events ready frame carries the clientId every question answer
    // needs. Waiting for both kills the race where a waterfall frame arrived
    // before the ready frame and the question was skipped as "未就绪".
    let opened = ws_open_and_wait(&mut ws, &session_id).await;
    view.events_client_id = opened.events_client_id;
    if view.events_client_id.is_none() {
        core.dispatch_event(
            state,
            EngineEvent::Warn("提问通道未就绪，本轮中的提问请求将被跳过".to_string()),
        );
    }
    if plan_mode {
        // 进入 plan 模式：commands/execute "/plan"，并等 follow 流回读
        // plan/mode{active:true} 提交后才允许下发 prompt（事件回读确认）。
        enter_plan_mode(&origin, &session_id, &mut ws, opened.plan_active).await?;
    }

    let mut prompt_request = json!({
        "requestId": format!("codemoss-{}", uuid::Uuid::new_v4()),
        "sessionId": session_id,
        "mode": "queue",
        "content": dsh_images::build_prompt_content(&req.prompt, &prompt_images),
        "clientTimeZone": client_time_zone(),
    });
    if let Some(effort) = req
        .effort
        .as_deref()
        .map(str::trim)
        .filter(|e| !e.is_empty())
    {
        prompt_request["effort"] = json!(effort);
        prompt_request["reasoningEffort"] = json!(effort);
    }
    let prompt = crate::dsh_host::host_call_rpc(
        &origin,
        "session/prompt",
        json!({ "request": prompt_request }),
    )
    .await;
    if let Err(error) = prompt {
        let _ = ws.close(None).await;
        return Err(format!(
            "任务下发失败：{}",
            dsh_images::format_prompt_refusal(&error)
        ));
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

// ==================== plan mode entry ====================

/// 前置探测（PRD §5-DSH.1/2）：commands/list 确认 plan 命令存在。缺插件
/// （列表无 plan）或探测失败都受控报错，不降级 auto。
async fn ensure_plan_command(origin: &str, session_id: &str) -> Result<(), String> {
    let listed = host_call(origin, "commands/list", json!({ "agentId": session_id }))
        .await
        .map_err(|error| format!("无法确认 host 的 plan 命令（commands/list 失败）：{error}"))?;
    if !plan_command_listed(&listed) {
        return Err(
            "当前 dsh host 未组合 plan-mode 插件（commands/list 无 plan 命令），无法进入计划审批模式；不会降级为 auto 执行"
                .to_string(),
        );
    }
    Ok(())
}

/// commands/list 应答里的 plan 命令存在性（纯函数，便于单测）。
fn plan_command_listed(listed: &Value) -> bool {
    listed
        .as_array()
        .map(|commands| {
            commands
                .iter()
                .any(|command| command.get("name").and_then(Value::as_str) == Some("plan"))
        })
        .unwrap_or(false)
}

/// commands/execute 的应答分类（纯函数，便于单测）：未知命令返回
/// undefined（线上为 null/缺 commandId）——HTTP 200 不算成功；handler 级
/// 错误（result.kind=="error"）同样受控拒绝。
fn plan_execute_outcome(result: &Value) -> Result<(), String> {
    if result.get("commandId").and_then(Value::as_str).is_none() {
        return Err(
            "host 未确认 /plan 命令（应答为 undefined）：plan-mode 插件可能未组合，无法进入计划审批模式"
                .to_string(),
        );
    }
    if result.pointer("/result/kind").and_then(Value::as_str) == Some("error") {
        let text = result
            .pointer("/result/text")
            .and_then(Value::as_str)
            .unwrap_or("");
        return Err(format!("/plan 命令执行失败：{text}"));
    }
    Ok(())
}

/// plan 权限的进入序列（PRD §5-DSH.2，P0 取证 DSH 节）：commands/execute
/// {agentId, line:"/plan", submittedAttachments:[]}，然后等 follow 流回读
/// plan/mode{active:true} 才返回。任何一步失败都受控报错，不降级 auto。
async fn enter_plan_mode(
    origin: &str,
    session_id: &str,
    ws: &mut Ws,
    already_active: bool,
) -> Result<(), String> {
    let result = host_call(
        origin,
        "commands/execute",
        json!({
            "agentId": session_id,
            "line": "/plan",
            "submittedAttachments": [],
        }),
    )
    .await
    .map_err(|error| format!("进入 plan 模式失败（commands/execute /plan）：{error}"))?;
    plan_execute_outcome(&result)?;
    if already_active {
        // 快照投影已显示 plan.active：本次 /plan 是 noop，不会再追加
        // plan/mode 事件，无需等待回读。
        return Ok(());
    }
    await_plan_mode_active(ws).await
}

/// 等 follow 流回读 plan/mode{active:true}（P0：无 open turn 时 /plan 立即
/// committed 并向会话日志追加该事件，随 follow 流下行）。超时/断流 =
/// host 未确认，受控报错；期间到达的其它事件（含 plan/mode:false）按
/// 正常事件忽略。
async fn await_plan_mode_active(ws: &mut Ws) -> Result<(), String> {
    let started = tokio::time::Instant::now();
    while started.elapsed() < PLAN_MODE_CONFIRM_TIMEOUT {
        let remaining = PLAN_MODE_CONFIRM_TIMEOUT - started.elapsed();
        match tokio::time::timeout(remaining, ws.next()).await {
            Ok(Some(Ok(Message::Text(text)))) => {
                let Ok(value) = serde_json::from_str::<Value>(text.as_str()) else {
                    continue;
                };
                if value.get("type").and_then(Value::as_str) != Some("item")
                    || value.get("streamId").and_then(Value::as_str) != Some(STREAM_FOLLOW)
                {
                    continue;
                }
                if value.pointer("/value/event/type").and_then(Value::as_str)
                    == Some("plan/mode")
                    && value.pointer("/value/event/data/active").and_then(Value::as_bool)
                        == Some(true)
                {
                    return Ok(());
                }
            }
            Ok(Some(Ok(_))) => {} // ping/pong/binary: keep waiting
            _ => break,
        }
    }
    Err(
        "等待 plan/mode active 确认超时：host 未确认进入 plan 模式，已中止发送（不降级 auto）"
            .to_string(),
    )
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
                view.tool_names
                    .insert(call_id.to_string(), name.to_string());
            }
            let args = data
                .get("arguments")
                .and_then(Value::as_str)
                .and_then(|text| serde_json::from_str::<Value>(text).ok())
                .or_else(|| data.get("arguments").cloned());
            core.dispatch_event(
                state,
                super::tool_call_message_with_id(
                    name,
                    args.as_ref(),
                    data.get("callId").and_then(Value::as_str),
                ),
            );
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
                super::tool_result_patch_with_id(
                    &name,
                    Some(&json!({ "text": text, "isError": is_error })),
                    (!call_id.is_empty()).then_some(call_id),
                ),
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
        // 计划审批的配套状态事件：批准后的 plan/mode:false 与 pending
        // inactive 投影都是正常会话日志事件（PRD §5-DSH.6/7）——既不是
        // 审批退出路径（/plan off 不实现为退出捷径），也不是错误。
        "plan/mode" => {}
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
                        view.last_usage = Some(attach_context_window(usage.clone()));
                        core.dispatch_event(
                            state,
                            EngineEvent::Usage(attach_context_window(usage.clone())),
                        );
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
            // Questions park host-side until the user answers from the card
            // (answer_question posts the outcome); approvals keep the v1
            // auto-allow policy; unknown waterfall kinds reject as before.
            if kind == "user-questions/request" {
                park_question(core, state, view, value, origin, &client_id, event_id).await;
                return;
            }
            // v1 policy: approvals auto-allow — API-created sessions already
            // run tools without a permission flow (the headless engine had
            // the same implicit behavior), and codemoss has no approval UI
            // for host sessions yet.
            let (outcome, notice) = if kind == "approval/request" {
                (json!({ "kind": "result", "value": "allowed-once" }), None)
            } else {
                (
                    json!({
                        "kind": "rejected",
                        "error": { "code": "cancelled", "message": "the user cancelled ask_user_question" },
                    }),
                    Some("已取消一个未识别的交互请求".to_string()),
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
        // Cancellation of a pending waterfall previously delivered under the
        // same id: settle the card so it never stays answerable against a
        // request the host already withdrew.
        Some("cancel") => {
            if let Some(event_id) = value.get("eventId").and_then(Value::as_str) {
                core.dispatch_event(
                    state,
                    EngineEvent::QuestionSettled {
                        request_id: event_id.to_string(),
                    },
                );
            }
        }
        _ => {}
    }
}

/// Park a `user-questions/request` waterfall: surface the question card and
/// stash the answer context under the same request id. `$events/result` needs
/// the origin + clientId + eventId triple plus the original request (question
/// ids), none of which the UI projection carries — so the parked value is the
/// answer context, not the render input.
async fn park_question(
    core: &TurnCore,
    state: &mut TurnState,
    view: &TurnView,
    value: &Value,
    origin: &str,
    client_id: &str,
    event_id: &str,
) {
    let request = value.get("request").cloned().unwrap_or(Value::Null);
    // plan-review presentation intent（PRD §5-DSH.6：仅以 intent.kind 识别
    // 计划）走类型化审批主干，不再折叠进普通问题卡。
    if let Some(question) = plan_review_question(&request) {
        park_plan_review(core, state, view, &question, origin, client_id, event_id).await;
        return;
    }
    let questions = render_questions(&request);
    if questions.is_empty() {
        // A question nobody can see must not park the host forever: reject
        // the waterfall and say so.
        reject_waterfall(origin, client_id, event_id, "empty question request").await;
        core.dispatch_event(
            state,
            EngineEvent::Warn("收到空的提问请求，已跳过".to_string()),
        );
        return;
    }
    core.dispatch_event(
        state,
        EngineEvent::Question {
            request_id: event_id.to_string(),
            tool_use_id: None,
            input: json!({ "questions": questions }),
        },
    );
    // dispatch_event parked the render input under this request id; overwrite
    // it with the answer context the answer command actually needs.
    if let Some(entry) = core.registry.get(&core.run_id) {
        if let Ok(mut parked) = entry.questions.lock() {
            parked.insert(
                event_id.to_string(),
                json!({
                    "dsh": {
                        "origin": origin,
                        "clientId": client_id,
                        "eventId": event_id,
                        "request": request,
                    }
                }),
            );
        }
    }
}
/// Reject a waterfall the UI can never answer, so the host does not park
/// forever on a request we refuse to surface.
async fn reject_waterfall(origin: &str, client_id: &str, event_id: &str, message: &str) {
    let _ = host_call(
        origin,
        "$events/result",
        json!({
            "clientId": client_id,
            "eventId": event_id,
            "outcome": {
                "kind": "rejected",
                "error": { "name": "UserQuestionError", "code": "cancelled", "message": message },
            },
        }),
    )
    .await;
}

/// plan-review intent 识别（PRD §5-DSH.6：仅以 intent.kind=="plan-review"
/// 识别计划；P0 取证的结构里它是 questions[0]）。
fn plan_review_question(request: &Value) -> Option<Value> {
    request
        .get("questions")?
        .as_array()?
        .first()
        .filter(|question| {
            question.pointer("/intent/kind").and_then(Value::as_str) == Some("plan-review")
        })
        .cloned()
}

/// 正文首个 markdown 标题（与 dsh-plan-mode firstHeading 同规则：行首
/// 1-6 个 # + 空白 + 非空文本）；无标题返回 None，调用方给默认名。
fn first_heading(plan: &str) -> Option<String> {
    plan.lines().find_map(|line| {
        let line = line.trim_end();
        let hashes = line.chars().take_while(|c| *c == '#').count();
        if !(1..=6).contains(&hashes) {
            return None;
        }
        let rest = &line[hashes..];
        if !rest.starts_with(char::is_whitespace) {
            return None;
        }
        let title = rest.trim();
        (!title.is_empty()).then(|| title.to_string())
    })
}

/// plan-review presentation intent（P0 取证：dsh-plan-mode exit_plan_mode
/// 经 userQuestions.ask 下行，questions[0] 的 detail 是完整 markdown、
/// intent.approve 是原生批准标签）：构造类型化 PlanReview 并 dispatch
/// PlanReviewReady——落盘赋 revision、native_request 停车由 reader 统一
/// 处理。原生回复上下文（$events/result 帧）随 context 停在后端注册表，
/// 事件载荷永不含它。
async fn park_plan_review(
    core: &TurnCore,
    state: &mut TurnState,
    view: &TurnView,
    question: &Value,
    origin: &str,
    client_id: &str,
    event_id: &str,
) {
    let content = question
        .get("detail")
        .and_then(Value::as_str)
        .filter(|detail| !detail.trim().is_empty());
    let approve = question
        .pointer("/intent/approve")
        .and_then(Value::as_str)
        .filter(|label| !label.is_empty());
    let question_id = question
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty());
    let (Some(content), Some(approve), Some(question_id)) = (content, approve, question_id)
    else {
        // fail-closed：正文/批准标签/问题 id 缺一都无法构造忠实于原生语义
        // 的审批——拒绝该 waterfall 让 host 解除阻塞并警告，绝不降级为普通
        // 问题卡（那会丢失审批语义）。
        reject_waterfall(origin, client_id, event_id, "malformed plan-review request").await;
        core.dispatch_event(
            state,
            EngineEvent::Warn(
                "收到残缺的计划评审请求（缺正文/批准标签/问题 id），已拒绝".to_string(),
            ),
        );
        return;
    };
    let title = first_heading(content).unwrap_or_else(|| "计划评审".to_string());
    let content_hash = super::plan_review::content_hash(content);
    // 回复帧照 question_outcome/answer_question 的既有 $events/result 形状
    // （{clientId, eventId, outcome:{kind:"result", value:{answers:[…]}}}）。
    // 批准帧：selected=[intent.approve 的真实标签] 且绝不携带 custom 键
    // （Host 严格判定 selected.length===1 && selected[0]===approve &&
    // custom===void 0）；反馈帧：selected:[] + custom 占位符，发送时由
    // respond_plan_review 把占位符替换为用户反馈文本。
    let outcome = |answers: Value| {
        json!({
            "clientId": client_id,
            "eventId": event_id,
            "outcome": { "kind": "result", "value": { "answers": [answers] } },
        })
    };
    let approve_frame = outcome(json!({ "id": question_id, "selected": [approve] }));
    let changes_frame = outcome(
        json!({ "id": question_id, "selected": [], "custom": super::PLAN_FEEDBACK_PLACEHOLDER }),
    );
    let now = super::plan_review::now_ms();
    let record = super::plan_review::PlanReview {
        plan_id: format!("dsh-plan-{event_id}"),
        engine: core.engine_id.clone(),
        session_id: state.native_session_id.clone().unwrap_or_default(),
        workspace_path: view.workspace.clone(),
        run_id: Some(core.run_id.clone()),
        revision: 0, // dispatch 落盘时赋 revision，适配器不自带
        title,
        content: content.to_string(),
        content_hash: content_hash.clone(),
        complete: true,
        review_kind: super::plan_review::PlanReviewKind::NativeRequest,
        native_plan_id: Some(question_id.to_string()),
        // plan 是软行为引导：批准后 plan mode 退出，工具调用回到 host 会话
        // 既有策略（v1 auto-allow），审批本身不改变执行权限。
        exec_permission: "auto".to_string(),
        status: super::plan_review::PlanStatus::AwaitingReview,
        execution: super::plan_review::PlanExecution::NotStarted,
        decision: None,
        decision_intent_at: None,
        applied_at: None,
        created_at: now,
        updated_at: now,
        superseded_by: None,
    };
    // 停车上下文（respond_plan_review 的读取约定）：route/origin/path/
    // contentHash/frames 顶层平铺；revision 键由 dispatch 注入，适配器不占。
    let context = json!({
        "route": "http",
        "origin": origin,
        "path": "$events/result",
        "contentHash": content_hash,
        "frames": { "approve": approve_frame, "changes": changes_frame },
    });
    core.dispatch_event(
        state,
        EngineEvent::PlanReviewReady {
            record: Box::new(record),
            context,
        },
    );
}

/// Project a dsh `user-questions/request` payload onto the QuestionSpec shape
/// the UI renders (the claude control-protocol shape): `header` defaults,
/// `detail` folds into the question text, options pass through unchanged.
/// (plan-review intent 的请求在 park_question 入口就被拦截去审批主干，
/// 永不经过这个映射。) The answer command
/// re-derives answer keys from the parked original request through this same
/// mapping, so the two must never drift apart.
pub(crate) fn render_questions(request: &Value) -> Vec<Value> {
    let Some(questions) = request.get("questions").and_then(Value::as_array) else {
        return Vec::new();
    };
    questions
        .iter()
        .map(|question| {
            let mut text = question
                .get("question")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            if let Some(detail) = question
                .get("detail")
                .and_then(Value::as_str)
                .filter(|detail| !detail.trim().is_empty())
            {
                text = format!("{text}\n\n{detail}");
            }
            json!({
                "question": text,
                "header": question.get("header").and_then(Value::as_str).unwrap_or("提问"),
                "multiSelect": question.get("multiSelect").and_then(Value::as_bool).unwrap_or(false),
                "options": question.get("options").cloned().unwrap_or_else(|| json!([])),
            })
        })
        .collect()
}

/// Build the `$events/result` outcome for a parked dsh question. `answers` is
/// the UI's map (rendered question text → picked label(s)); a free-form
/// string matching no option label travels as `custom`. `None` (or a
/// non-object) means the user dismissed the card.
pub(crate) fn question_outcome(request: &Value, answers: Option<&Value>) -> Value {
    let Some(answers) = answers.and_then(Value::as_object) else {
        return json!({
            "kind": "rejected",
            "error": { "name": "UserQuestionError", "code": "cancelled", "message": "the user cancelled ask_user_question" },
        });
    };
    let rendered = render_questions(request);
    let questions = request
        .get("questions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut items = Vec::new();
    for (index, question) in questions.iter().enumerate() {
        let id = question
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        // Answers key on the rendered question text (detail folded in), so
        // re-derive the same key rather than trusting the raw question.
        let key = rendered
            .get(index)
            .and_then(|r| r.get("question"))
            .and_then(Value::as_str)
            .unwrap_or("");
        let known_labels: Vec<&str> = question
            .get("options")
            .and_then(Value::as_array)
            .map(|options| {
                options
                    .iter()
                    .filter_map(|o| o.get("label").and_then(Value::as_str))
                    .collect()
            })
            .unwrap_or_default();
        let item = match answers.get(key) {
            Some(Value::Array(labels)) => json!({ "id": id, "selected": labels }),
            Some(Value::String(text)) if known_labels.contains(&text.as_str()) => {
                json!({ "id": id, "selected": [text] })
            }
            Some(Value::String(text)) => {
                json!({ "id": id, "selected": [], "custom": text })
            }
            _ => json!({ "id": id, "selected": [] }),
        };
        items.push(item);
    }
    json!({ "kind": "result", "value": { "answers": items } })
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

/// Streams opened on the mux: the events clientId plus the plan projection
/// read off the follow snapshot (plan 权限下区分 /plan noop 与 committed —
/// 已激活时不会再有 plan/mode 事件可回读）。
struct StreamsOpened {
    events_client_id: Option<String>,
    /// follow 快照里 plan 投影的 active 位（dsh-plan-mode wire view
    /// {active, pending}）；快照缺失或投影未注册时为 false。
    plan_active: bool,
}

/// Open both logical streams and wait for the follow snapshot (proof the
/// follow subscription is live) AND the `$events` ready frame (its clientId
/// heads every `$events/result` answer) before the caller dispatches the
/// prompt — with a bounded fallback so a gateway that skips either cannot
/// stall sends. Returns the events clientId when the ready frame arrived in
/// time; a late ready frame is still picked up by the main loop.
async fn ws_open_and_wait(ws: &mut Ws, session_id: &str) -> StreamsOpened {
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
        return StreamsOpened {
            events_client_id: None,
            plan_active: false,
        };
    }
    let mut follow_ready = false;
    let mut events_client_id: Option<String> = None;
    let mut plan_active = false;
    let started = tokio::time::Instant::now();
    while started.elapsed() < FOLLOW_READY_TIMEOUT && !(follow_ready && events_client_id.is_some())
    {
        let next = tokio::time::timeout(FOLLOW_READY_TIMEOUT - started.elapsed(), ws.next()).await;
        match next {
            Ok(Some(Ok(Message::Text(text)))) => {
                let Ok(value) = serde_json::from_str::<Value>(text.as_str()) else {
                    continue;
                };
                if value.get("type").and_then(Value::as_str) != Some("item") {
                    continue;
                }
                match value.get("streamId").and_then(Value::as_str) {
                    Some(STREAM_FOLLOW)
                        if value.pointer("/value/type").and_then(Value::as_str)
                            == Some("snapshot") =>
                    {
                        follow_ready = true;
                        // plan 投影的裁剪视图 {active, pending}（dsh-plan-mode
                        // planProjectionDefinition wire）；缺失即未注册插件。
                        plan_active = value
                            .pointer("/value/projections/values/plan/active")
                            .and_then(Value::as_bool)
                            .unwrap_or(false);
                    }
                    Some(STREAM_EVENTS)
                        if value.pointer("/value/type").and_then(Value::as_str)
                            == Some("ready") =>
                    {
                        events_client_id = value
                            .pointer("/value/clientId")
                            .and_then(Value::as_str)
                            .map(str::to_string);
                    }
                    _ => {}
                }
            }
            Ok(Some(Ok(_))) | Ok(Some(Err(_))) | Ok(None) | Err(_) => break,
        }
    }
    StreamsOpened {
        events_client_id,
        plan_active,
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

    #[tokio::test]
    async fn tool_messages_preserve_call_id_in_emitted_payloads() {
        let emitter = Arc::new(CollectingEmitter(StdMutex::new(Vec::new())));
        let core = TurnCore {
            sink: EventSink::new(emitter.clone()),
            registry: Arc::new(ProcessRegistry::default()),
            engine_id: "dsh".to_string(),
            run_id: "test-run".to_string(),
            db: None,
        };
        let mut state = TurnState::new(None);
        let mut view = TurnView::default();

        handle_session_event(
            &core,
            &mut state,
            &mut view,
            "tool/call",
            &json!({
                "callId": "call-17",
                "name": "bash",
                "arguments": { "command": "pnpm test" }
            }),
        );
        handle_session_event(
            &core,
            &mut state,
            &mut view,
            "tool/result",
            &json!({
                "message": {
                    "source": { "callId": "call-17" },
                    "content": [{ "type": "text", "text": "done", "isError": false }]
                }
            }),
        );
        core.sink.flush();

        let events = emitter.0.lock().unwrap().clone();
        let messages: Vec<Value> = collect_kinds(&events)
            .into_iter()
            .filter_map(|(kind, data)| (kind == "message").then_some(data))
            .collect();
        assert_eq!(messages.len(), 2);
        assert!(messages
            .iter()
            .all(|data| data.get("toolCallId").and_then(Value::as_str) == Some("call-17")));
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
            db: None,
        };
        let req = SendRequest {
            session_id: None,
            workspace: PathBuf::from("/tmp"),
            prompt: "用一句话回答：1+1等于几？".to_string(),
            prompt_contributions: Vec::new(),
            images: Vec::new(),
            model: None,
            effort: None,
            service_tier: None,
            permission: None,
            additional_dirs: Vec::new(),
            provider_id: None,
            computer_use: None,
            allowed_tools: None,
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
                    value
                        .get("kind")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string(),
                    value.get("data").cloned().unwrap_or(Value::Null),
                ));
            }
        }
        let session = kinds
            .iter()
            .find(|(kind, _)| kind == "session")
            .map(|(_, data)| data.as_str().unwrap_or("").to_string());
        let session = session.expect("session id must be announced");
        assert!(
            session.starts_with("session-"),
            "unexpected session id {session}"
        );
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
                    db: None,
                };
                let req = SendRequest {
                    session_id,
                    workspace: PathBuf::from("/tmp"),
                    prompt,
                    prompt_contributions: Vec::new(),
                    images: Vec::new(),
                    model: None,
                    effort: None,
                    service_tier: None,
                    permission: None,
                    additional_dirs: Vec::new(),
                    provider_id: None,
                    computer_use: None,
                    allowed_tools: None,
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
        assert!(
            !session_id.is_empty(),
            "turn 1 announced no session: {kinds1:?}"
        );
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
        assert_eq!(
            session_id2, session_id,
            "resumed turn changed the session id"
        );
        assert!(
            kinds2.iter().any(|(kind, data)| kind == "message"
                && data.get("role").and_then(Value::as_str) == Some("tool")),
            "no tool row streamed: {kinds2:?}"
        );
        assert!(
            kinds2.iter().any(|(kind, data)| kind == "message"
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

    /// A TurnCore with a registry entry under its run id (so question parking
    /// has somewhere to land) plus the collected flushes for assertions.
    fn test_core() -> (TurnCore, Arc<ProcessRegistry>, Arc<CollectingEmitter>) {
        let emitter = Arc::new(CollectingEmitter(StdMutex::new(Vec::new())));
        let registry = Arc::new(ProcessRegistry::default());
        registry.insert(
            "test-run".to_string(),
            crate::engine::registry::ChildEntry {
                child: None,
                pid: 4_000_000_099,
                run_id: "test-run".to_string(),
                killed: Arc::new(AtomicBool::new(false)),
                reader_abort: Arc::new(std::sync::OnceLock::new()),
                stdin: None,
                questions: Arc::new(StdMutex::new(HashMap::new())),
                plans: Arc::new(StdMutex::new(HashMap::new())),
            },
        );
        let core = TurnCore {
            sink: EventSink::new(emitter.clone()),
            registry: Arc::clone(&registry),
            engine_id: "dsh".to_string(),
            run_id: "test-run".to_string(),
            db: None,
        };
        (core, registry, emitter)
    }

    #[test]
    fn render_questions_maps_the_dsh_shape_onto_the_card_spec() {
        let request = json!({
            "questions": [
                {
                    "id": "q1",
                    "question": "选哪个？",
                    "header": "方案",
                    "multiSelect": true,
                    "options": [{ "label": "A", "description": "a" }, { "label": "B" }],
                },
                {
                    "id": "q2",
                    "question": "为什么选这个方案？",
                    "detail": "背景：上一轮评审要求收紧范围",
                    // no header / options: defaults kick in
                },
            ]
        });
        let rendered = render_questions(&request);
        assert_eq!(rendered.len(), 2);
        assert_eq!(rendered[0]["question"], "选哪个？");
        assert_eq!(rendered[0]["header"], "方案");
        assert_eq!(rendered[0]["multiSelect"], true);
        assert_eq!(rendered[0]["options"][0]["label"], "A");
        // 普通问题的 detail 仍折叠进问题文本；plan-review intent 的请求不
        // 走这个映射（park_question 入口拦截，见审批主干测试）。
        assert_eq!(
            rendered[1]["question"],
            "为什么选这个方案？\n\n背景：上一轮评审要求收紧范围"
        );
        assert_eq!(rendered[1]["header"], "提问");
        assert_eq!(rendered[1]["multiSelect"], false);
        assert_eq!(rendered[1]["options"], json!([]));
        assert_eq!(render_questions(&json!({})), Vec::<Value>::new());
        // 仅 intent.kind=="plan-review" 被识别为计划评审；普通 intent 或缺
        // intent 的请求仍走旧问题路径。
        assert!(plan_review_question(&request).is_none());
        let review_request = json!({
            "questions": [{
                "id": "plan-review",
                "question": "Approve this plan and leave plan mode?",
                "detail": "# 计划\nstep 1",
                "intent": { "kind": "plan-review", "approve": "Approve" },
            }]
        });
        assert!(plan_review_question(&review_request).is_some());
        let other_intent = json!({
            "questions": [{ "id": "q", "question": "x", "intent": { "kind": "confirm" } }]
        });
        assert!(plan_review_question(&other_intent).is_none());
    }

    #[test]
    fn question_outcome_maps_labels_custom_and_dismiss() {
        let request = json!({
            "questions": [
                { "id": "q1", "question": "单选", "options": [{ "label": "A" }, { "label": "B" }] },
                { "id": "q2", "question": "多选", "multiSelect": true,
                  "options": [{ "label": "x" }, { "label": "y" }] },
                { "id": "q3", "question": "自由", "options": [{ "label": "A" }] },
            ]
        });
        let answers = json!({ "单选": "A", "多选": ["x", "y"], "自由": "随便写写" });
        let outcome = question_outcome(&request, Some(&answers));
        assert_eq!(outcome["kind"], "result");
        assert_eq!(
            outcome["value"]["answers"][0],
            json!({ "id": "q1", "selected": ["A"] })
        );
        assert_eq!(
            outcome["value"]["answers"][1],
            json!({ "id": "q2", "selected": ["x", "y"] })
        );
        // Free-form text matching no option label travels as custom.
        assert_eq!(
            outcome["value"]["answers"][2],
            json!({ "id": "q3", "selected": [], "custom": "随便写写" })
        );
        // Dismissed card → cancelled rejection.
        let dismissed = question_outcome(&request, None);
        assert_eq!(dismissed["kind"], "rejected");
        assert_eq!(dismissed["error"]["code"], "cancelled");
        // An unanswered question still echoes its id with an empty selection.
        let partial = question_outcome(&request, Some(&json!({})));
        assert_eq!(
            partial["value"]["answers"][0],
            json!({ "id": "q1", "selected": [] })
        );
    }

    #[tokio::test]
    async fn question_waterfall_emits_card_and_parks_answer_context() {
        let (core, registry, emitter) = test_core();
        let mut state = TurnState::new(None);
        let mut view = TurnView {
            events_client_id: Some("client-1".to_string()),
            ..TurnView::default()
        };
        let frame = json!({
            "type": "waterfall",
            "event": "user-questions/request",
            "eventId": "evt-1",
            "agentId": "agent-1",
            "request": {
                "questions": [
                    { "id": "q1", "question": "选哪个？", "options": [{ "label": "A" }, { "label": "B" }] }
                ]
            },
        });
        handle_events_frame(
            &core,
            &mut state,
            &mut view,
            &frame,
            "http://127.0.0.1:3080",
        )
        .await;
        core.sink.flush();

        // Card pushed to the UI…
        let kinds = collect_kinds(&emitter.0.lock().unwrap());
        let question = kinds
            .iter()
            .find(|(kind, _)| kind == "question")
            .map(|(_, data)| data.clone())
            .expect("no question event pushed");
        assert_eq!(question["requestId"], "evt-1");
        assert_eq!(question["input"]["questions"][0]["question"], "选哪个？");
        // …and the answer context parked under the same request id.
        let parked = registry
            .get("test-run")
            .and_then(|entry| {
                entry
                    .questions
                    .lock()
                    .ok()
                    .and_then(|q| q.get("evt-1").cloned())
            })
            .expect("answer context not parked");
        assert_eq!(parked["dsh"]["origin"], "http://127.0.0.1:3080");
        assert_eq!(parked["dsh"]["clientId"], "client-1");
        assert_eq!(parked["dsh"]["eventId"], "evt-1");
        assert_eq!(parked["dsh"]["request"]["questions"][0]["id"], "q1");
    }

    #[tokio::test]
    async fn waterfall_without_events_channel_warns_and_parks_nothing() {
        let (core, registry, emitter) = test_core();
        let mut state = TurnState::new(None);
        let mut view = TurnView::default(); // no events_client_id
        let frame = json!({
            "type": "waterfall",
            "event": "user-questions/request",
            "eventId": "evt-2",
            "request": { "questions": [{ "id": "q1", "question": "x" }] },
        });
        handle_events_frame(
            &core,
            &mut state,
            &mut view,
            &frame,
            "http://127.0.0.1:3080",
        )
        .await;
        core.sink.flush();
        let kinds = collect_kinds(&emitter.0.lock().unwrap());
        assert!(kinds.iter().any(|(kind, _)| kind == "warn"), "{kinds:?}");
        assert!(
            !kinds.iter().any(|(kind, _)| kind == "question"),
            "{kinds:?}"
        );
        let empty = registry
            .get("test-run")
            .map(|entry| entry.questions.lock().map(|q| q.is_empty()).unwrap_or(true));
        assert_eq!(empty, Some(true));
    }

    #[tokio::test]
    async fn waterfall_cancel_frame_settles_the_card() {
        let (core, _registry, emitter) = test_core();
        let mut state = TurnState::new(None);
        let mut view = TurnView {
            events_client_id: Some("client-1".to_string()),
            ..TurnView::default()
        };
        let frame = json!({
            "type": "waterfall",
            "event": "user-questions/request",
            "eventId": "evt-3",
            "request": { "questions": [{ "id": "q1", "question": "x", "options": [{ "label": "A" }] }] },
        });
        handle_events_frame(
            &core,
            &mut state,
            &mut view,
            &frame,
            "http://127.0.0.1:3080",
        )
        .await;
        handle_events_frame(
            &core,
            &mut state,
            &mut view,
            &json!({ "type": "cancel", "eventId": "evt-3" }),
            "http://127.0.0.1:3080",
        )
        .await;
        core.sink.flush();
        let kinds = collect_kinds(&emitter.0.lock().unwrap());
        assert!(
            kinds
                .iter()
                .any(|(kind, data)| kind == "question_settled" && data["requestId"] == "evt-3"),
            "{kinds:?}"
        );
    }
    /// plan-review intent（P0 取证结构）→ 类型化 PlanReview 记录 + 停车的
    /// 原生回复帧：批准帧 selected=[intent.approve] 且无 custom 键，反馈帧
    /// selected:[] + custom 占位符；批准标签来自 intent.approve（这里故意
    /// 用非英文标签），标题取正文首个 markdown 标题。
    #[tokio::test]
    async fn plan_review_intent_builds_record_and_parks_native_frames() {
        let (core, registry, emitter) = test_core();
        let mut state = TurnState::new(Some("session-1".to_string()));
        let mut view = TurnView {
            events_client_id: Some("client-1".to_string()),
            workspace: "/tmp/ws".to_string(),
            ..TurnView::default()
        };
        let content = "# 上线计划\n\n1. 迁移数据库\n2. 灰度发布";
        let frame = json!({
            "type": "waterfall",
            "event": "user-questions/request",
            "eventId": "evt-plan-1",
            "agentId": "session-1",
            "request": {
                "questions": [{
                    "id": "plan-review",
                    "header": "Plan review",
                    "question": "Approve this plan and leave plan mode?",
                    "detail": content,
                    "options": [
                        { "label": "批准执行", "description": "Leave plan mode" },
                        { "label": "继续规划", "description": "Stay in plan mode" },
                    ],
                    "intent": { "kind": "plan-review", "approve": "批准执行" },
                }]
            },
        });
        handle_events_frame(
            &core,
            &mut state,
            &mut view,
            &frame,
            "http://127.0.0.1:3080",
        )
        .await;
        core.sink.flush();

        // 走审批主干：有 plan_review 事件，没有普通 question 卡。
        let kinds = collect_kinds(&emitter.0.lock().unwrap());
        assert!(
            !kinds.iter().any(|(kind, _)| kind == "question"),
            "plan-review 不得走普通问题路径: {kinds:?}"
        );
        let record = kinds
            .iter()
            .find(|(kind, _)| kind == "plan_review")
            .map(|(_, data)| data.clone())
            .expect("no plan_review event pushed");
        assert_eq!(record["planId"], "dsh-plan-evt-plan-1");
        assert_eq!(record["engine"], "dsh");
        assert_eq!(record["sessionId"], "session-1");
        assert_eq!(record["workspacePath"], "/tmp/ws");
        assert_eq!(record["title"], "上线计划");
        assert_eq!(record["content"], content);
        assert_eq!(
            record["contentHash"],
            crate::engine::plan_review::content_hash(content)
        );
        assert_eq!(record["complete"], true);
        assert_eq!(record["reviewKind"], "native_request");
        assert_eq!(record["nativePlanId"], "plan-review");
        assert_eq!(record["status"], "awaiting_review");
        // 事件载荷永不含原生回复上下文。
        assert!(record.get("frames").is_none(), "{record}");
        assert!(record.get("context").is_none(), "{record}");

        // 停车上下文：{revision, route, origin, path, contentHash, frames}
        // 顶层平铺（revision 由 dispatch 注入；测试无 db，保持 0）。
        let parked = registry
            .get("test-run")
            .and_then(|entry| {
                entry
                    .plans
                    .lock()
                    .ok()
                    .and_then(|plans| plans.get("dsh-plan-evt-plan-1").cloned())
            })
            .expect("native reply context not parked");
        assert_eq!(parked["revision"], 0);
        assert_eq!(parked["route"], "http");
        assert_eq!(parked["origin"], "http://127.0.0.1:3080");
        assert_eq!(parked["path"], "$events/result");
        assert_eq!(
            parked["contentHash"],
            crate::engine::plan_review::content_hash(content)
        );
        // 批准帧：$events/result 既有形状，selected=[intent.approve 的真实
        // 标签]，且绝不携带 custom 键（Host 严格判定 custom===void 0）。
        let approve = &parked["frames"]["approve"];
        assert_eq!(approve["clientId"], "client-1");
        assert_eq!(approve["eventId"], "evt-plan-1");
        assert_eq!(
            approve["outcome"],
            json!({
                "kind": "result",
                "value": { "answers": [{ "id": "plan-review", "selected": ["批准执行"] }] },
            })
        );
        assert!(
            !approve.to_string().contains("custom"),
            "approve frame must not carry a custom key: {approve}"
        );
        // 反馈帧：selected:[] + custom 占位符（发送时替换为用户反馈）。
        let changes = &parked["frames"]["changes"];
        assert_eq!(
            changes["outcome"],
            json!({
                "kind": "result",
                "value": { "answers": [{
                    "id": "plan-review",
                    "selected": [],
                    "custom": crate::engine::PLAN_FEEDBACK_PLACEHOLDER,
                }] },
            })
        );
    }

    /// 残缺的 plan-review 请求（缺 intent.approve）fail-closed：拒绝
    /// waterfall + 警告，不落 plan_review 事件、不停车、不降级为问题卡。
    #[tokio::test]
    async fn malformed_plan_review_is_rejected_fail_closed() {
        let (core, registry, emitter) = test_core();
        let mut state = TurnState::new(Some("session-1".to_string()));
        let mut view = TurnView {
            events_client_id: Some("client-1".to_string()),
            ..TurnView::default()
        };
        let frame = json!({
            "type": "waterfall",
            "event": "user-questions/request",
            "eventId": "evt-plan-2",
            "request": {
                "questions": [{
                    "id": "plan-review",
                    "question": "Approve?",
                    "detail": "# 计划\nstep 1",
                    "intent": { "kind": "plan-review" },
                }]
            },
        });
        handle_events_frame(
            &core,
            &mut state,
            &mut view,
            &frame,
            "http://127.0.0.1:3080",
        )
        .await;
        core.sink.flush();
        let kinds = collect_kinds(&emitter.0.lock().unwrap());
        assert!(kinds.iter().any(|(kind, _)| kind == "warn"), "{kinds:?}");
        assert!(
            !kinds
                .iter()
                .any(|(kind, _)| kind == "plan_review" || kind == "question"),
            "{kinds:?}"
        );
        let empty = registry
            .get("test-run")
            .map(|entry| entry.plans.lock().map(|plans| plans.is_empty()).unwrap_or(true));
        assert_eq!(empty, Some(true));
    }

    /// commands 应答分类：undefined（线上 null/缺 commandId）≠ 成功；
    /// handler 级 error 同样拒绝；commands/list 的 plan 探测。
    #[test]
    fn commands_results_are_not_http_success() {
        // 未知命令 → undefined → 线上 null：HTTP 200 也不算成功。
        assert!(plan_execute_outcome(&Value::Null).is_err());
        assert!(plan_execute_outcome(&json!({})).is_err());
        assert!(plan_execute_outcome(&json!({ "result": { "kind": "success" } })).is_err());
        // handler 级错误（如 /plan off 携带附件）受控拒绝并带原文。
        let error = plan_execute_outcome(
            &json!({ "commandId": "cmd-1", "result": { "kind": "error", "text": "boom" } }),
        )
        .unwrap_err();
        assert!(error.contains("boom"), "{error}");
        assert!(plan_execute_outcome(
            &json!({ "commandId": "cmd-1", "result": { "kind": "success", "text": "Plan mode on." } }),
        )
        .is_ok());
        // commands/list：无 plan = 插件未组合。
        assert!(plan_command_listed(
            &json!([{ "name": "plan", "description": "Enter or leave plan mode" }])
        ));
        assert!(!plan_command_listed(&json!([{ "name": "compact" }])));
        assert!(!plan_command_listed(&json!([])));
        assert!(!plan_command_listed(&Value::Null));
    }

    /// 标题取正文首个 markdown 标题（与 dsh-plan-mode firstHeading 同
    /// 规则）；无标题时记录标题回退为「计划评审」。
    #[test]
    fn first_heading_matches_the_native_rule() {
        assert_eq!(first_heading("# 标题\nbody"), Some("标题".to_string()));
        assert_eq!(first_heading("前言\n## 二节"), Some("二节".to_string()));
        assert_eq!(first_heading("###### 六级"), Some("六级".to_string()));
        assert_eq!(first_heading("####### 七级"), None);
        assert_eq!(first_heading("#no-space"), None);
        assert_eq!(first_heading("# "), None);
        assert_eq!(first_heading("no heading at all"), None);
    }

    /// Flatten the sink's batched flushes into (kind, data) pairs.
    fn collect_kinds(events: &[String]) -> Vec<(String, Value)> {
        let mut kinds = Vec::new();
        for raw in events {
            let flushed: Value = serde_json::from_str(raw).expect("flushed batch must be JSON");
            let batch = flushed.as_array().cloned().unwrap_or_else(|| vec![flushed]);
            for value in batch {
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
