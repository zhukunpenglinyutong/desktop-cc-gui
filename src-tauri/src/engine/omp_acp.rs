//! OMP 18.0.11 的 ACP 计划会话驱动（PRD §5-OMP 主方案，最高优先级引擎）。
//!
//! 协议事实全部来自本机安装源码
//! （/Users/zhukunpeng/node_modules/@oh-my-pi/pi-coding-agent）与
//! p0-evidence-plan-approval-2026-09-24.md §OMP：
//! - 入口：`omp --mode acp`（src/cli/flag-tables.ts:123-127；`omp acp`
//!   子命令等价，src/commands/acp.ts:30-33）。裸 `--plan <value>` 是计划
//!   **模型角色**标志，不是模式开关（args.ts:187-217 注释）。
//! - initialize 的 clientCapabilities **必须声明 elicitation.form**
//!   （pi-utils/src/acp/protocol.ts:150）：OMP 在审批前检查该声明，
//!   **未声明时静默自动批准**（acp-agent.ts:2006-2007
//!   `if (!supportsForm) return true;`）。启动前自检，缺失即 fail-closed。
//! - session/new {cwd, mcpServers} → session/set_mode {modeId:"plan"}
//!   （acp-agent.ts:95；plan.enabled 默认 true，
//!   settings-schema.ts:4766-4770；set_mode 失败会返回 rpc 错误）。
//! - 模型/effort 经 ACP 配置协议传入：session/set_config_option
//!   {configId:"model"|"thinking", value}（acp-agent.ts:763-813），
//!   保持用户选择，不强制降级。
//! - 模型 write xd://propose 后，proposal handler 阻塞在
//!   `unstable_createElicitation` 的 Promise 上（线上方法
//!   `elicitation/create`，pi-utils/src/acp/connection.ts:109-111；
//!   阻塞点 acp-agent.ts:360-377、resolve.ts:297-311）。elicitation 只带
//!   **前 12 行预览**（acp-agent.ts:2009-2013），绝不当正文；正文=磁盘
//!   计划文件 local://<slug>-plan.md（approved-plan.ts:156-187）。
//! - 批准帧：elicitation select 的应答严格相等 "Approve and execute" 才
//!   批准（acp-agent.ts:97-98,2021）；取消/dismiss/超时一律落入 refine
//!   语义，**永不授权**（acp-agent.ts:2018-2021）。批准后同一 prompt
//!   turn 内返回工具结果继续执行（acp-agent.ts:1918-1941）。
//! - 恢复：planModeState/proposal handler 是纯内存，session/load 不重注册
//!   （acp-agent.ts:670-736 vs 1844-1866），审批点跨重启不可恢复——恢复
//!   请求直接拒绝。
//!
//! 计划文件白名单读取：限定 OMP 会话 artifacts 目录
//! （~/.omp/agent/sessions/<编码cwd>/<时间戳>_<sessionId>/local/，
//! session-manager.ts:109-112 + session-paths.ts:62-95 + dirs.ts:567-574,
//! 871-874），拒绝符号链接逃逸，大小上限 1 MiB，读后算 content_hash。
//! 计划文件的最终选择以「文件前 12 行 == elicitation 预览」绑定本次提案
//! 与正文版本，对不上就 fail-closed（PRD §5-OMP.3）。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

use serde_json::{json, Map, Value};

use crate::engine::plan_review::{self, PlanExecution, PlanReview, PlanReviewKind, PlanStatus};
use crate::engine::qoder_session::{
    answer_agent_request, initialize_params, jsonrpc_id_key, jsonrpc_result_response,
    session_update_from_notification, spawn_piped_acp, teardown, AcpLine, AcpProcess,
    QoderSessionUpdate, PROMPT_TIMEOUT, RPC_HANDSHAKE_TIMEOUT, SESSION_NEW_TIMEOUT,
};
use crate::engine::{
    cleanup_staged_files, BuiltCommand, EngineEvent, SendRequest, TurnCore, TurnState,
    VirtualRunGuard,
};

/// elicitation select 的批准选项标签；OMP 严格相等判定
/// （acp-agent.ts:97 `const APPROVE_OPTION = "Approve and execute";`、
/// :2021 `return value === APPROVE_OPTION;`）。逐字漂移 = 落入 refine。
const APPROVE_OPTION: &str = "Approve and execute";
/// 修改选项标签（acp-agent.ts:98）。ACP 反馈只有这个二值信号，没有文本
/// 载体；用户反馈文本留存于审批记录，无法写进回复帧。
const REFINE_OPTION: &str = "Refine plan";
/// OMP 计划提案到达的线上方法（pi-utils/src/acp/connection.ts:109-111）。
const ELICITATION_METHOD: &str = "elicitation/create";
/// ACP plan 模式 id（acp-agent.ts:95 `const ACP_PLAN_MODE_ID = "plan";`）。
const PLAN_MODE_ID: &str = "plan";
/// 计划文件全文读取上限（适配器自设安全边界；OMP 本身无长度限制）。
const MAX_PLAN_BYTES: usize = 1024 * 1024;

/// 恢复请求的受控拒绝理由（build_command 与驱动双重把关共用）。
pub(crate) const RESUME_REFUSAL: &str = "OMP ACP 计划会话必须从全新会话开始：审批点（planModeState 与 proposal handler）是纯内存状态，session/load 不会重新注册（acp-agent.ts:670-736 vs 1844-1866），恢复的会话没有可核验的人工等待点。请开新会话发起计划请求。";

/// Per-turn projection state: prompt 结果里的 usage、tool_call 名称补丁表、
/// usage_update 推送的上下文窗口。
#[derive(Default)]
struct TurnView {
    last_usage: Option<Value>,
    tool_names: HashMap<String, String>,
    context_window: Option<i64>,
}

/// Drive one send as an OMP ACP plan-mode turn. Settle contract mirrors
/// grok_acp::run_acp_turn：停住的提问卡片与计划审批先落定/过期，再发终态
/// 事件，最后按 run/session 键清理注册表。interrupt 语义与 grok 一致：
/// killed 时 partial output 按正常 turn end 提交。
pub(crate) async fn run_acp_turn(
    core: TurnCore,
    req: SendRequest,
    built: BuiltCommand,
    killed: Arc<AtomicBool>,
    virtual_pid: u32,
) {
    let BuiltCommand {
        mut command,
        cleanup_files,
        mcp_restore,
        ..
    } = built;
    let mut state = TurnState::new(None);
    let mut view = TurnView::default();
    // Abort-safe backstop（同 grok）：任务被 abort/panic 时不让注册键泄漏。
    let _registry_guard =
        VirtualRunGuard::new(Arc::clone(&core.registry), core.run_id.clone(), virtual_pid);
    let result = if req.session_id.is_some() {
        // 双保险：build_command 已在 spawn 前拒绝；防御层被绕过同样不许
        // 在一个没有人工等待点的恢复会话里跑计划。
        Err(RESUME_REFUSAL.to_string())
    } else {
        turn_inner(&core, &mut state, &mut view, &req, &mut command, &killed).await
    };
    // 停住的交互随运行消亡：先 settle 提问卡片、过期停住的计划审批
    // （契约 §收尾义务：每个注册键一次），再发终态——终态之后 dispatch
    // 会被单调 guard 丢弃。resume 已被拒绝，注册键只有 run_id 与握手后
    // 的 native session id。
    for key in [state.native_session_id.clone(), Some(core.run_id.clone())]
        .into_iter()
        .flatten()
    {
        for request_id in core.registry.take_questions(&key) {
            core.dispatch_event(&mut state, EngineEvent::QuestionSettled { request_id });
        }
        crate::engine::reader::expire_parked_plans(&core, &mut state, &key);
    }
    if let Err(error) = result {
        if !killed.load(Ordering::SeqCst) {
            core.dispatch_event(&mut state, EngineEvent::Error(error));
        }
    }
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
    if let Some(session_id) = state.native_session_id.clone() {
        core.registry.remove_if_pid(&session_id, virtual_pid);
    }
    core.sink.flush();
    if let Some(restore) = mcp_restore {
        restore.restore();
    }
    cleanup_staged_files(&cleanup_files);
}

async fn turn_inner(
    core: &TurnCore,
    state: &mut TurnState,
    view: &mut TurnView,
    req: &SendRequest,
    command: &mut tokio::process::Command,
    killed: &Arc<AtomicBool>,
) -> Result<(), String> {
    let mut spawned = spawn_piped_acp(command, &core.engine_id, &req.workspace)?;
    // 审批帧经注册表里的这根 stdin 回写（respond_plan_review 的
    // route:"stdin" 路径），必须在握手前挂上。
    core.registry
        .set_stdin(&core.run_id, Arc::clone(&spawned.acp.stdin));
    let result = handshake_and_prompt(&mut spawned.acp, core, state, view, req, killed).await;
    // ACP 是驻留会话协议：prompt 应答后 CLI 仍在，每条退出路径都拆树。
    teardown(&mut spawned.child).await;
    match result {
        Ok(()) => Ok(()),
        Err(error) => Err(terminal_message(error, &spawned.stderr_buf)),
    }
}

async fn handshake_and_prompt(
    acp: &mut AcpProcess,
    core: &TurnCore,
    state: &mut TurnState,
    view: &mut TurnView,
    req: &SendRequest,
    killed: &AtomicBool,
) -> Result<(), String> {
    // P0 关键安全事实：OMP 只在客户端声明 elicitation.form 时才把计划审批
    // 交给客户端，否则静默自动批准（acp-agent.ts:2006-2007）。构造后自检，
    // 缺失即在任何会话动作之前 fail-closed。
    let init = omp_initialize_params();
    if !elicitation_form_declared(&init) {
        return Err(
            "OMP ACP 握手缺少 clientCapabilities.elicitation.form 声明：OMP 未收到声明时会静默自动批准计划（acp-agent.ts:2006-2007），按失败关闭拒绝启动"
                .to_string(),
        );
    }
    acp.routed(
        "initialize",
        init,
        RPC_HANDSHAKE_TIMEOUT,
        killed,
        None,
        &mut |_| None,
    )
    .await?;
    let cwd = req.workspace.to_string_lossy().to_string();
    let session_result = acp
        .routed(
            "session/new",
            json!({ "cwd": cwd, "mcpServers": [] }),
            SESSION_NEW_TIMEOUT,
            killed,
            None,
            &mut |_| None,
        )
        .await?;
    let session_id = extract_session_id(&session_result)
        .ok_or_else(|| "OMP session/new 未返回 sessionId".to_string())?;
    if !plan_mode_advertised(&session_result) {
        return Err(
            "OMP 会话未提供 plan 模式（plan.enabled 被关闭），无法进入人工计划审批".to_string(),
        );
    }
    core.dispatch_event(state, EngineEvent::SessionId(session_id.clone()));
    // 模型/effort 走 ACP 配置协议（acp-agent.ts:763-813
    // setSessionConfigOption 的 MODEL/THINKING_CONFIG_ID），保持用户选择
    // 原样传入——不强制降级 smol，未知值由 CLI 报错并在 prompt 前失败。
    if let Some(model) = req
        .model
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        acp.routed(
            "session/set_config_option",
            json!({ "sessionId": session_id, "configId": "model", "value": model }),
            RPC_HANDSHAKE_TIMEOUT,
            killed,
            None,
            &mut |_| None,
        )
        .await
        .map_err(|error| format!("OMP 应用选定模型 `{model}` 失败: {error}"))?;
    }
    if let Some(effort) = req
        .effort
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        acp.routed(
            "session/set_config_option",
            json!({ "sessionId": session_id, "configId": "thinking", "value": effort }),
            RPC_HANDSHAKE_TIMEOUT,
            killed,
            None,
            &mut |_| None,
        )
        .await
        .map_err(|error| format!("OMP 应用推理强度 `{effort}` 失败: {error}"))?;
    }
    // set_mode 成功才 prompt（P0：plan.enabled 默认 true；被关闭时这里返回
    // "Unsupported ACP mode" 错误，直接失败而不是退回普通会话）。
    acp.routed(
        "session/set_mode",
        json!({ "sessionId": session_id, "modeId": PLAN_MODE_ID }),
        RPC_HANDSHAKE_TIMEOUT,
        killed,
        None,
        &mut |_| None,
    )
    .await
    .map_err(|error| format!("OMP 进入 plan 模式失败: {error}"))?;

    let blocks = prompt_blocks(&req.prompt, &req.images, &req.workspace)?;
    let workspace = req.workspace.clone();
    let result = {
        let mut router = |line: &AcpLine| match line {
            AcpLine::Notification { method, params } if method == "session/update" => {
                handle_session_update(core, state, view, params);
                None
            }
            // 计划提案的 elicitation 是审批主干的事：停住，等
            // respond_plan_review 经注册表 stdin 写回帧。这里绝不代答——
            // 取消/超时/dismiss 都不是批准（acp-agent.ts:2018-2021）。
            AcpLine::AgentRequest { id, method, params }
                if method == ELICITATION_METHOD && is_plan_approval_elicitation(params) =>
            {
                park_plan_review(core, state, &workspace, &session_id, id, params)
            }
            // 计划会话内的其他 elicitation（ask 工具的 select/confirm/
            // input）没有审批语义；ACP 计划传输暂未接普通提问通道，用取消
            // 语义关闭对话框，CLI 按「用户忽略」继续（同 dismiss，永不构成
            // 批准）。
            AcpLine::AgentRequest { id, method, .. } if method == ELICITATION_METHOD => {
                Some(jsonrpc_result_response(id, json!({ "action": "cancel" })))
            }
            AcpLine::AgentRequest { id, method, params } => {
                Some(answer_agent_request(&workspace, id, method, params))
            }
            _ => None,
        };
        acp.routed(
            "session/prompt",
            json!({ "sessionId": session_id, "prompt": blocks }),
            PROMPT_TIMEOUT,
            killed,
            Some(&session_id),
            &mut router,
        )
        .await?
    };
    if let Some(usage) = prompt_usage(&result, view.context_window) {
        view.last_usage = Some(usage.clone());
        core.dispatch_event(state, EngineEvent::Usage(usage));
    }
    Ok(())
}

// ==================== 握手与能力自检 ====================

/// OMP 的 initialize 参数：共享管线参数 + elicitation.form 声明
/// （protocol.ts:150 的 ClientCapabilities.elicitation.form）。
fn omp_initialize_params() -> Value {
    let mut params = initialize_params();
    params["clientCapabilities"]["elicitation"] = json!({ "form": {} });
    params
}

/// 启动前自检：OMP 未收到 form 声明会静默自动批准，声明缺失必须 fail。
fn elicitation_form_declared(params: &Value) -> bool {
    params
        .get("clientCapabilities")
        .and_then(|caps| caps.get("elicitation"))
        .and_then(|elic| elic.get("form"))
        .is_some_and(|form| !form.is_null())
}

/// session/new 响应的 modes.availableModes 是否含 plan（acp-agent.ts:
/// 1827-1837：plan.enabled 时才提供）。modes 缺失时交给 set_mode 的真实
/// 结果裁决（不编造字段）。
fn plan_mode_advertised(session_result: &Value) -> bool {
    session_result
        .get("modes")
        .and_then(|modes| modes.get("availableModes"))
        .and_then(Value::as_array)
        .map(|modes| {
            modes
                .iter()
                .any(|mode| mode.get("id").and_then(Value::as_str) == Some(PLAN_MODE_ID))
        })
        .unwrap_or(true)
}

fn extract_session_id(value: &Value) -> Option<String> {
    value
        .get("sessionId")
        .or_else(|| value.get("session_id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

/// ACP prompt content blocks: text plus base64 image blocks（OMP 声明
/// promptCapabilities.image=true，acp-agent.ts:668-673）。
fn prompt_blocks(text: &str, images: &[String], workspace: &Path) -> Result<Vec<Value>, String> {
    let mut blocks = vec![json!({ "type": "text", "text": text })];
    for raw in images {
        let (mime, base64) = crate::engine::images::load_image(raw, workspace)?;
        blocks.push(json!({
            "type": "image",
            "data": base64,
            "mimeType": mime,
        }));
    }
    Ok(blocks)
}

// ==================== elicitation 识别与审批帧 ====================

/// 严格识别计划审批 elicitation：mode=form 且 value 属性的 enum 恰好是
/// 两个计划选项（acp-agent.ts:354-365 的表单封装 + :2015 的
/// enum:[APPROVE_OPTION, REFINE_OPTION]）。ask 工具的 elicitation（别的
/// schema）不落入此分支。
fn is_plan_approval_elicitation(params: &Value) -> bool {
    if params.get("mode").and_then(Value::as_str) != Some("form") {
        return false;
    }
    let Some(enum_values) = params
        .get("requestedSchema")
        .and_then(|schema| schema.get("properties"))
        .and_then(|props| props.get("value"))
        .and_then(|value| value.get("enum"))
        .and_then(Value::as_array)
    else {
        return false;
    };
    enum_values.len() == 2
        && enum_values
            .iter()
            .any(|value| value.as_str() == Some(APPROVE_OPTION))
        && enum_values
            .iter()
            .any(|value| value.as_str() == Some(REFINE_OPTION))
}

/// 审批/修改两个回复帧，从 acp-agent.ts 的 elicitation 处理代码精确还原：
/// elicitFormFromAcpClient 把表单结果读作 `content.value`（:375-379），
/// 批准判定是 `value === "Approve and execute"` 严格相等（:2021）。帧的
/// result 形状是 CreateElicitationResponse
/// （pi-utils/src/acp/protocol.ts:440-443：
/// `{action:"accept", content:{...}}`）。
fn approval_frames(rpc_id: &Value) -> Value {
    json!({
        "approve": jsonrpc_result_response(rpc_id, json!({
            "action": "accept",
            "content": { "value": APPROVE_OPTION },
        })),
        "changes": jsonrpc_result_response(rpc_id, json!({
            "action": "accept",
            "content": { "value": REFINE_OPTION },
        })),
    })
}

/// 解析 elicitation message：
/// `Approve plan "<title>" and start implementation?\n\n<前12行预览><\n…?>`
/// （acp-agent.ts:2009-2013）。返回 (标题, 预览文本)。
fn parse_approval_message(message: &str) -> Option<(String, String)> {
    let rest = message.strip_prefix("Approve plan \"")?;
    let (title, after) = rest.split_once("\" and start implementation?")?;
    let title = title.trim();
    if title.is_empty() {
        return None;
    }
    let preview = after.strip_prefix("\n\n").unwrap_or(after);
    Some((title.to_string(), preview.to_string()))
}

/// 把文件正文与 elicitation 预览逐字绑定：预览 = 前 12 行 join("\n")，
/// 超过 12 行时末尾追加 "\n…"（acp-agent.ts:2010-2012）。两个方向的
/// 省略号语义都校验，对不上就不是本次提案的正文。
fn preview_matches(content: &str, preview: &str) -> bool {
    let (preview_body, had_ellipsis) = match preview.strip_suffix("\n…") {
        Some(body) => (body, true),
        None => (preview, false),
    };
    let lines: Vec<&str> = content.split('\n').collect();
    let head = lines
        .iter()
        .take(12)
        .copied()
        .collect::<Vec<_>>()
        .join("\n");
    head == preview_body && (lines.len() > 12) == had_ellipsis
}

// ==================== 计划文件白名单定位与读取 ====================

/// OMP 会话根目录候选（pi-utils/dirs.ts:567-574 getAgentDir、:871-874
/// getSessionsDir）：PI_CODING_AGENT_DIR 直接覆盖 agent 目录；默认布局下
/// XDG_DATA_HOME/omp 已存在时拍平 agent/ 前缀（dirs.ts:336-372）；
/// 否则 ~/.<PI_CONFIG_DIR=.omp>/agent/sessions。profile 布局
/// （profiles/<name>/agent）未覆盖——找不到即 fail-closed。
fn omp_sessions_roots() -> Vec<PathBuf> {
    if let Some(agent_dir) = std::env::var("PI_CODING_AGENT_DIR")
        .ok()
        .filter(|value| !value.trim().is_empty())
    {
        return vec![PathBuf::from(agent_dir).join("sessions")];
    }
    let mut roots = Vec::new();
    if let Some(xdg) = std::env::var("XDG_DATA_HOME")
        .ok()
        .filter(|value| !value.trim().is_empty())
    {
        let flattened = PathBuf::from(xdg).join("omp");
        if flattened.is_dir() {
            roots.push(flattened.join("sessions"));
        }
    }
    if let Some(home) = std::env::var_os("HOME") {
        let config = std::env::var("PI_CONFIG_DIR").unwrap_or_else(|_| ".omp".to_string());
        roots.push(
            PathBuf::from(home)
                .join(config)
                .join("agent")
                .join("sessions"),
        );
    }
    roots
}

/// path.resolve 的无 fs 部分：绝对化 + 规范化 `.`/`..`。
fn normalize_absolute(path: &Path) -> PathBuf {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(path)
    };
    let mut normalized = PathBuf::new();
    for component in absolute.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                normalized.pop();
            }
            other => normalized.push(other.as_os_str()),
        }
    }
    normalized
}

/// resolveEquivalentPath（pi-utils/dirs.ts:153-157）：realpath，失败回退
/// resolved 原样。
fn realpath_or(path: &Path) -> PathBuf {
    std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

/// encodeRelativeSessionDirName（session-paths.ts:41-44）。
fn encode_relative(prefix: &str, rel: &Path) -> String {
    let encoded = rel.to_string_lossy().replace(['/', '\\', ':'], "-");
    if encoded.is_empty() {
        prefix.to_string()
    } else if prefix.ends_with('-') {
        format!("{prefix}{encoded}")
    } else {
        format!("{prefix}-{encoded}")
    }
}

/// encodeLegacyAbsoluteSessionDirName（session-paths.ts:36-39）。
fn encode_legacy(resolved: &Path) -> String {
    let text = resolved.to_string_lossy();
    let without_root = text.trim_start_matches(['/', '\\']);
    format!("--{}--", without_root.replace(['/', '\\', ':'], "-"))
}

/// getDefaultSessionDirName（session-paths.ts:62-95）：home 相对 → `-…`，
/// tmp 相对 → `-tmp-…`，否则 legacy 绝对路径编码。前缀比较用 canonical
/// （realpath），legacy 名用 resolved（非 realpath，与上游一致）。
fn encode_session_dir_name(
    canonical: &Path,
    home: Option<&Path>,
    tmp: &Path,
    legacy_basis: &Path,
) -> String {
    if let Some(home) = home {
        if let Ok(rel) = canonical.strip_prefix(home) {
            return encode_relative("-", rel);
        }
    }
    if let Ok(rel) = canonical.strip_prefix(tmp) {
        return encode_relative("-tmp", rel);
    }
    encode_legacy(legacy_basis)
}

fn session_dir_name(workspace: &Path) -> String {
    let resolved = normalize_absolute(workspace);
    let canonical = realpath_or(&resolved);
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .map(|home| realpath_or(&normalize_absolute(&home)));
    let tmp = realpath_or(&std::env::temp_dir());
    encode_session_dir_name(&canonical, home.as_deref(), &tmp, &resolved)
}

/// 会话的 local:// 根目录候选：`<root>/<编码cwd>/<时间戳>_<sessionId>/local`。
/// artifacts 目录 = 会话文件去掉 .jsonl（session-manager.ts:109-112
/// artifactsDirectoryFor），local 根 = artifactsDir/local
/// （internal-urls/local-protocol.ts:243-251）。
fn session_local_roots(roots: &[PathBuf], workspace: &Path, session_id: &str) -> Vec<PathBuf> {
    let mut locals = Vec::new();
    let dir_name = session_dir_name(workspace);
    let suffix = format!("_{session_id}");
    for root in roots {
        let parent = root.join(&dir_name);
        let Ok(entries) = std::fs::read_dir(&parent) else {
            continue;
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            let Some(name) = name.to_str() else {
                continue;
            };
            if !name.ends_with(&suffix) || name.ends_with(".jsonl") {
                continue;
            }
            let local = entry.path().join("local");
            if local.is_dir() {
                locals.push(local);
            }
        }
    }
    locals
}

/// approved-plan.ts normalizePlanTitle 的净化规则（:21-46）。elicitation
/// 标题本身已是净化产物，这里防御性复算，保证拼出的文件名白名单合法。
fn sanitize_title(title: &str) -> String {
    let trimmed = title.trim();
    let without_ext = if trimmed.len() >= 3 && trimmed.to_ascii_lowercase().ends_with(".md") {
        &trimmed[..trimmed.len() - 3]
    } else {
        trimmed
    };
    let mut out = String::new();
    let mut last_dash = false;
    for ch in without_ext.chars() {
        if ch.is_whitespace() {
            if !last_dash && !out.is_empty() {
                out.push('-');
                last_dash = true;
            }
        } else if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
            out.push(ch);
            last_dash = ch == '-';
        }
    }
    out.trim_matches('-').to_string()
}

/// planSlugFromSupplied（approved-plan.ts:117-126）：标题净化后去掉尾部
/// `-plan`（大小写不敏感），空结果回退净化标题本身。
fn slug_from_title(title: &str) -> Option<String> {
    let sanitized = sanitize_title(title);
    if sanitized.is_empty() {
        return None;
    }
    let lower = sanitized.to_ascii_lowercase();
    let slug = lower
        .strip_suffix("-plan")
        .map(|stem| sanitized[..stem.len()].to_string())
        .filter(|stem| !stem.is_empty());
    Some(slug.unwrap_or(sanitized))
}

/// 计划文件候选名，顺序对齐 resolveApprovedPlan
/// （approved-plan.ts:156-187）：slug 推导 → 扫描外的状态路径 PLAN.md →
/// 扫描到的 *plan.md 新到旧（#listAcpLocalPlanFiles 的 /plan\.md$/i，
/// acp-agent.ts:1969-1988）→ PLAN.md 兜底。去重保序。
fn plan_candidate_names(local_root: &Path, slug: Option<&str>) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    if let Some(slug) = slug {
        names.push(format!("{slug}-plan.md"));
    }
    let mut scanned: Vec<(String, SystemTime)> = std::fs::read_dir(local_root)
        .map(|entries| {
            entries
                .flatten()
                .filter_map(|entry| {
                    let name = entry.file_name().to_string_lossy().into_owned();
                    let is_plan = name.to_ascii_lowercase().ends_with("plan.md");
                    let is_file = entry.file_type().map(|kind| kind.is_file()).unwrap_or(false);
                    if is_plan && is_file {
                        let mtime = entry
                            .metadata()
                            .and_then(|meta| meta.modified())
                            .unwrap_or(SystemTime::UNIX_EPOCH);
                        Some((name, mtime))
                    } else {
                        None
                    }
                })
                .collect()
        })
        .unwrap_or_default();
    scanned.sort_by(|left, right| right.1.cmp(&left.1));
    let scanned_names: Vec<String> = scanned.into_iter().map(|(name, _)| name).collect();
    if !scanned_names.iter().any(|name| name == "PLAN.md") {
        names.push("PLAN.md".to_string());
    }
    names.extend(scanned_names);
    names.push("PLAN.md".to_string());
    let mut seen = std::collections::HashSet::new();
    names.retain(|name| seen.insert(name.clone()));
    names
}

/// 白名单读取单个计划文件候选：文件名必须是单层 *plan.md；符号链接逃逸
/// 出 local 根即拒绝；大小上限 1 MiB；文件不存在返回 Ok(None) 让下一个
/// 候选上场。读到的正文由调用方算 content_hash。
fn read_plan_candidate(local_root: &Path, name: &str) -> Result<Option<String>, String> {
    if name.is_empty()
        || name.contains(['/', '\\'])
        || name.contains("..")
        || !name.to_ascii_lowercase().ends_with("plan.md")
    {
        return Err(format!("计划文件名 `{name}` 不在白名单内"));
    }
    let candidate = local_root.join(name);
    let root_canonical = std::fs::canonicalize(local_root)
        .map_err(|error| format!("计划目录 {} 不可读: {error}", local_root.display()))?;
    let file_canonical = match std::fs::canonicalize(&candidate) {
        Ok(path) => path,
        // 不存在（含悬空符号链接）= 该候选落空，尝试下一个。
        Err(_) => return Ok(None),
    };
    if !file_canonical.starts_with(&root_canonical) {
        return Err(format!(
            "计划文件 `{name}` 经符号链接逃逸出 OMP 会话 artifacts 目录，拒绝读取"
        ));
    }
    let meta = std::fs::metadata(&file_canonical).map_err(|error| error.to_string())?;
    if !meta.is_file() {
        return Ok(None);
    }
    if meta.len() > MAX_PLAN_BYTES as u64 {
        return Err(format!("计划文件 `{name}` 超过 1 MiB 上限，拒绝读取"));
    }
    let bytes = std::fs::read(&file_canonical).map_err(|error| error.to_string())?;
    if bytes.len() > MAX_PLAN_BYTES {
        return Err(format!("计划文件 `{name}` 超过 1 MiB 上限，拒绝读取"));
    }
    String::from_utf8(bytes)
        .map(Some)
        .map_err(|_| format!("计划文件 `{name}` 不是合法 UTF-8，拒绝当作计划正文"))
}

/// 定位并核验本次提案的计划文件：elicitation 只带前 12 行预览，全文必须
/// 从计划文件读；「前 12 行 == 预览」把提案与正文版本绑在一起，对不上
/// 绝不批准（PRD §5-OMP.3）。返回 (全文, elicitation 标题)。
fn load_verified_plan(local_roots: &[PathBuf], params: &Value) -> Result<(String, String), String> {
    let message = params
        .get("message")
        .and_then(Value::as_str)
        .ok_or_else(|| "OMP 计划 elicitation 缺少 message，无法核验正文".to_string())?;
    let (title, preview) = parse_approval_message(message)
        .ok_or_else(|| "OMP 计划 elicitation 的 message 不是计划审批格式，拒绝凭摘要批准".to_string())?;
    if local_roots.is_empty() {
        return Err(
            "在本机 OMP 会话目录中找不到该会话的 artifacts 目录（自定义 session-dir/profile 布局未覆盖），按失败关闭拒绝批准"
                .to_string(),
        );
    }
    let slug = slug_from_title(&title);
    let mut saw_plan_file = false;
    for root in local_roots {
        for name in plan_candidate_names(root, slug.as_deref()) {
            let Some(content) = read_plan_candidate(root, &name)? else {
                continue;
            };
            saw_plan_file = true;
            if preview_matches(&content, &preview) {
                return Ok((content, title));
            }
        }
    }
    Err(if saw_plan_file {
        "计划文件与 elicitation 预览不一致（提案后正文被改动？），按失败关闭拒绝批准；请让引擎重新提案"
            .to_string()
    } else {
        "OMP 会话 artifacts 目录中没有计划文件（local://*plan.md），按失败关闭拒绝批准".to_string()
    })
}

/// 正文第一个 markdown 一级标题（approved-plan.ts firstLevelOneHeading:
/// `/^[ \t]*#[ \t]+(.+?)[ \t]*$/m`）。
fn first_heading(content: &str) -> Option<String> {
    for line in content.lines() {
        let line = line.trim_start_matches([' ', '\t']);
        let Some(rest) = line.strip_prefix('#') else {
            continue;
        };
        if rest.starts_with('#') || !rest.starts_with([' ', '\t']) {
            continue;
        }
        let title = rest.trim_matches([' ', '\t']);
        if !title.is_empty() {
            return Some(title.to_string());
        }
    }
    None
}

// ==================== 停车与事件投影 ====================

/// 停住一次计划提案：完整正文核验通过后 dispatch PlanReviewReady（上下文
/// 形状 = 契约的 stdin 停车约定：{route, contentHash, frames} 顶层平铺，
/// revision 由后端注入）。核验失败 = fail-closed：dispatch Error 落定，
/// 绝不让等待点在正文不可核验时被批准；Error 落定会杀掉进程树，CLI 侧的
/// elicitation 随连接断开落入 refine 语义（acp-agent.ts:2018-2021）。
/// 两种结局都不写回复帧——返回 None，读循环据此等待/退出。
fn park_plan_review(
    core: &TurnCore,
    state: &mut TurnState,
    workspace: &Path,
    session_id: &str,
    rpc_id: &Value,
    params: &Value,
) -> Option<Value> {
    match build_review(core, workspace, session_id, rpc_id, params) {
        Ok((record, context)) => {
            core.dispatch_event(
                state,
                EngineEvent::PlanReviewReady {
                    record: Box::new(record),
                    context,
                },
            );
        }
        Err(error) => {
            core.dispatch_event(state, EngineEvent::Error(error));
        }
    }
    None
}

fn build_review(
    core: &TurnCore,
    workspace: &Path,
    session_id: &str,
    rpc_id: &Value,
    params: &Value,
) -> Result<(PlanReview, Value), String> {
    let roots = omp_sessions_roots();
    let locals = session_local_roots(&roots, workspace, session_id);
    let (content, proposed_title) = load_verified_plan(&locals, params)?;
    let title = first_heading(&content).unwrap_or(proposed_title);
    let hash = plan_review::content_hash(&content);
    let now = plan_review::now_ms();
    let record = PlanReview {
        // 同一会话的每次再提案递增同一 plan_id 的 revision（record_review
        // 自动 supersede 旧版本）；elicitation 的 rpc id 存 native_plan_id。
        plan_id: format!("omp-acp-plan/{session_id}"),
        engine: core.engine_id.clone(),
        session_id: session_id.to_string(),
        workspace_path: workspace.to_string_lossy().into_owned(),
        run_id: Some(core.run_id.clone()),
        revision: 0,
        title,
        content,
        content_hash: hash.clone(),
        complete: true,
        review_kind: PlanReviewKind::NativeRequest,
        native_plan_id: Some(jsonrpc_id_key(rpc_id).unwrap_or_else(|| rpc_id.to_string())),
        // 批准后同一 turn 继续执行，沿用本次启动的非 bypass 工具策略
        // （命令行没有 --auto-approve；PRD §1 不变量 4：批准不改变权限）。
        exec_permission: "auto".to_string(),
        status: PlanStatus::AwaitingReview,
        execution: PlanExecution::NotStarted,
        decision: None,
        decision_intent_at: None,
        applied_at: None,
        created_at: now,
        updated_at: now,
        superseded_by: None,
    };
    let context = json!({
        "route": "stdin",
        "contentHash": hash,
        "frames": approval_frames(rpc_id),
    });
    Ok((record, context))
}

/// One `session/update` notification projected to engine events. OMP 的
/// 增量词汇与 qoder/grok 相同，复用共享映射；usage_update 只取上下文
/// 窗口（acp-agent.ts:2153-2158），token 总量以 prompt 应答为准。
fn handle_session_update(
    core: &TurnCore,
    state: &mut TurnState,
    view: &mut TurnView,
    params: &Value,
) {
    let update_kind = params
        .get("update")
        .and_then(|update| update.get("sessionUpdate"))
        .and_then(Value::as_str);
    if update_kind == Some("usage_update") {
        if let Some(size) = params
            .get("update")
            .and_then(|update| update.get("size"))
            .and_then(Value::as_i64)
            .filter(|size| *size > 0)
        {
            view.context_window = Some(size);
        }
        return;
    }
    match session_update_from_notification(params) {
        QoderSessionUpdate::AgentMessageChunk { text } => {
            core.dispatch_event(state, EngineEvent::Delta(text));
        }
        QoderSessionUpdate::AgentThoughtChunk { text } => {
            core.dispatch_event(state, EngineEvent::Thinking(text));
        }
        QoderSessionUpdate::ToolStarted {
            tool_id,
            tool_name,
            input,
        } => {
            view.tool_names.insert(tool_id, tool_name.clone());
            core.dispatch_event(state, crate::engine::tool_call_message(tool_name, input.as_ref()));
        }
        QoderSessionUpdate::ToolCompleted {
            tool_id,
            tool_name,
            output,
            error,
        } => {
            let name = tool_name
                .or_else(|| view.tool_names.get(&tool_id).cloned())
                .unwrap_or_else(|| "tool".to_string());
            let result = match (output, error) {
                (Some(output), _) => output,
                (None, Some(error)) => json!({ "text": error, "isError": true }),
                (None, None) => Value::Null,
            };
            core.dispatch_event(state, crate::engine::tool_result_patch(name, Some(&result)));
        }
        QoderSessionUpdate::Ignore => {}
    }
}

/// prompt 应答的 usage（acp-agent.ts:2187-2206 buildTurnUsage：
/// 顶层 `usage.{input,output,total}Tokens(+cached*)`）。
fn prompt_usage(result: &Value, context_window: Option<i64>) -> Option<Value> {
    let usage = result.get("usage").filter(|usage| usage.is_object())?;
    let total = usage.get("totalTokens").and_then(Value::as_u64)?;
    if total == 0 {
        return None;
    }
    let mut out = Map::new();
    out.insert("totalTokens".to_string(), json!(total));
    if let Some(input) = usage.get("inputTokens").and_then(Value::as_u64) {
        out.insert("inputTokens".to_string(), json!(input));
    }
    if let Some(output) = usage.get("outputTokens").and_then(Value::as_u64) {
        out.insert("outputTokens".to_string(), json!(output));
    }
    if let Some(cached) = usage.get("cachedReadTokens").and_then(Value::as_u64) {
        out.insert("cacheRead".to_string(), json!(cached));
    }
    if let Some(cached) = usage.get("cachedWriteTokens").and_then(Value::as_u64) {
        out.insert("cacheWrite".to_string(), json!(cached));
    }
    if let Some(window) = context_window.filter(|window| *window > 0) {
        out.insert("model_context_window".to_string(), json!(window));
    }
    Some(Value::Object(out))
}

/// Terminal message precedence（同 grok）：rpc error 的 message 部分 →
/// CLI 的 stderr 尾巴 → 原始错误。
fn terminal_message(raw: String, stderr_buf: &Arc<Mutex<String>>) -> String {
    let bare = raw
        .strip_prefix("rpc:")
        .and_then(|rest| rest.split_once(':'))
        .map(|(_, message)| message.trim())
        .filter(|message| !message.is_empty());
    if let Some(message) = bare {
        return message.to_string();
    }
    let stderr_tail = stderr_buf
        .lock()
        .map(|tail| tail.trim().to_string())
        .unwrap_or_default();
    if !stderr_tail.is_empty() {
        return stderr_tail;
    }
    raw
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::registry::ChildEntry;
    use crate::engine::ProcessRegistry;
    use crate::event_sink::{Emit, EventSink};
    use std::sync::Mutex as StdMutex;

    /// Keeps the raw event JSON: parking is only observable through what the
    /// frontend receives and what the registry holds for the answer.
    struct CollectingEmitter(StdMutex<Vec<String>>);

    impl Emit for CollectingEmitter {
        fn emit_json(&self, _name: &str, raw_json: &str) {
            self.0.lock().unwrap().push(raw_json.to_string());
        }
    }

    fn test_core() -> (TurnCore, Arc<ProcessRegistry>, Arc<CollectingEmitter>) {
        let emitter = Arc::new(CollectingEmitter(StdMutex::new(Vec::new())));
        let registry = Arc::new(ProcessRegistry::default());
        registry.insert(
            "test-run".to_string(),
            ChildEntry {
                child: None,
                pid: 4_000_000_077,
                run_id: "test-run".to_string(),
                killed: Arc::new(AtomicBool::new(false)),
                reader_abort: Arc::new(std::sync::OnceLock::new()),
                stdin: None,
                questions: Arc::new(StdMutex::new(HashMap::new())),
                plans: Arc::new(StdMutex::new(HashMap::new())),
                live_compact: None,
            },
        );
        let core = TurnCore {
            sink: EventSink::new(emitter.clone()),
            registry: Arc::clone(&registry),
            engine_id: "omp".to_string(),
            run_id: "test-run".to_string(),
            db: None,
        };
        (core, registry, emitter)
    }

    fn test_request() -> SendRequest {
        SendRequest {
            session_id: None,
            workspace: PathBuf::from("/tmp/ccgui-omp-acp-test"),
            prompt: "规划一下".to_string(),
            prompt_contributions: Vec::new(),
            native_compact: false,
            images: Vec::new(),
            model: None,
            effort: None,
            service_tier: None,
            permission: Some("plan".to_string()),
            additional_dirs: Vec::new(),
            provider_id: None,
            computer_use: None,
            memory_bot: None,
            allowed_tools: None,
            auto_compact_threshold_tokens: None,
        }
    }

    fn elicitation_params(message: &str) -> Value {
        // Live shape: elicitFromAcpClient 把 select 包成单属性 value 的表单
        // （acp-agent.ts:354-365 + :2009-2017）。
        json!({
            "mode": "form",
            "sessionId": "s-1",
            "message": message,
            "requestedSchema": {
                "type": "object",
                "properties": { "value": { "type": "string", "enum": ["Approve and execute", "Refine plan"] } },
                "required": ["value"],
            },
        })
    }

    fn temp_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "ccgui-omp-acp-test-{}-{tag}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn initialize_declares_elicitation_form_and_the_check_gates_it() {
        let params = omp_initialize_params();
        assert!(elicitation_form_declared(&params));
        assert_eq!(
            params["clientCapabilities"]["elicitation"],
            json!({ "form": {} })
        );
        // 共享管线的裸参数没有声明——OMP 会因此静默自动批准，自检必须拦下。
        assert!(!elicitation_form_declared(&initialize_params()));
        assert!(!elicitation_form_declared(&json!({
            "clientCapabilities": { "elicitation": { "form": null } }
        })));
    }

    #[test]
    fn detects_only_the_plan_approval_elicitation() {
        assert!(is_plan_approval_elicitation(&elicitation_params(
            "Approve plan \"auth\" and start implementation?\n\n# Auth\n"
        )));
        // 选项顺序无关，但集合必须恰好是这两个标签。
        let mut swapped = elicitation_params("Approve plan \"a\" and start implementation?\n\nx");
        swapped["requestedSchema"]["properties"]["value"]["enum"] =
            json!(["Refine plan", "Approve and execute"]);
        assert!(is_plan_approval_elicitation(&swapped));
        // ask 工具的 elicitation（别的 schema/标签）绝不落入审批分支。
        for params in [
            json!({ "mode": "form", "requestedSchema": { "properties": { "value": { "type": "string" } } } }),
            json!({ "mode": "form", "requestedSchema": { "properties": { "value": { "enum": ["Approve and execute"] } } } }),
            json!({ "mode": "form", "requestedSchema": { "properties": { "value": { "enum": ["Approve and execute ", "Refine plan"] } } } }),
            json!({ "mode": "url", "requestedSchema": { "properties": { "value": { "enum": ["Approve and execute", "Refine plan"] } } } }),
            json!({}),
        ] {
            assert!(
                !is_plan_approval_elicitation(&params),
                "misclassified: {params}"
            );
        }
    }

    #[test]
    fn approval_frames_match_the_cli_labels_exactly() {
        // 标签逐字：任何漂移都会落入 refine 语义（acp-agent.ts:2021 严格
        // 相等），回复形状是 CreateElicitationResponse
        // {action:"accept", content:{value}}（protocol.ts:440-443）。
        let frames = approval_frames(&json!(9));
        assert_eq!(
            frames["approve"],
            json!({
                "jsonrpc": "2.0",
                "id": 9,
                "result": { "action": "accept", "content": { "value": "Approve and execute" } },
            })
        );
        assert_eq!(
            frames["changes"],
            json!({
                "jsonrpc": "2.0",
                "id": 9,
                "result": { "action": "accept", "content": { "value": "Refine plan" } },
            })
        );
        // 字符串 rpc id 保型往返。
        let frames = approval_frames(&json!("req-3"));
        assert_eq!(frames["approve"]["id"], json!("req-3"));
        assert_eq!(frames["changes"]["id"], json!("req-3"));
    }

    #[test]
    fn parses_the_approval_message_and_binds_the_preview() {
        let (title, preview) =
            parse_approval_message("Approve plan \"auth-refactor\" and start implementation?\n\n# 认证重构\n步骤一\n")
                .expect("approval message");
        assert_eq!(title, "auth-refactor");
        assert_eq!(preview, "# 认证重构\n步骤一\n");
        // 非审批格式一律 None（ask 的消息、截断的消息）。
        assert!(parse_approval_message("选哪种？").is_none());
        assert!(parse_approval_message("Approve plan \"\" and start implementation?").is_none());
        assert!(parse_approval_message("Approve plan \"x\" and run?").is_none());

        // 预览 = 前 12 行 + 省略号语义，两个方向都校验。
        let short = "a\nb\nc";
        assert!(preview_matches(short, "a\nb\nc"));
        assert!(!preview_matches(short, "a\nb\nc\n…"));
        let long: String = (1..=20).map(|n| format!("l{n}\n")).collect();
        let long = long.trim_end_matches('\n');
        let head12 = (1..=12).map(|n| format!("l{n}")).collect::<Vec<_>>().join("\n");
        assert!(preview_matches(long, &format!("{head12}\n…")));
        assert!(!preview_matches(long, &head12));
        // 提案后正文被改动 → 拒绝。
        assert!(!preview_matches(long, "l1\nl2\nCHANGED\n…"));
    }

    #[test]
    fn slug_and_heading_follow_the_cli_rules() {
        assert_eq!(slug_from_title("auth-refactor"), Some("auth-refactor".into()));
        // 尾部 -plan 剥掉（大小写不敏感），空 slug 回退净化标题。
        assert_eq!(slug_from_title("auth-plan"), Some("auth".into()));
        assert_eq!(slug_from_title("auth-PLAN"), Some("auth".into()));
        assert_eq!(slug_from_title("plan"), Some("plan".into()));
        assert_eq!(slug_from_title("My feature plan.md"), Some("My-feature".into()));
        assert_eq!(slug_from_title("!!!"), None);
        // 第一个一级标题；## 与无空格 # 不算。
        assert_eq!(first_heading("# 认证重构\n正文"), Some("认证重构".into()));
        assert_eq!(first_heading("## 二级\n# 一级"), Some("一级".into()));
        assert_eq!(first_heading("#noSpace\n正文"), None);
        assert_eq!(first_heading("没有标题"), None);
    }

    #[test]
    fn session_dir_name_encoding_matches_the_cli() {
        let home = Path::new("/Users/alice");
        let tmp = Path::new("/private/var/folders/xx");
        // home 相对（含 home 本身）→ 前缀 `-`。
        assert_eq!(
            encode_session_dir_name(Path::new("/Users/alice/proj"), Some(home), tmp, Path::new("/Users/alice/proj")),
            "-proj"
        );
        assert_eq!(
            encode_session_dir_name(home, Some(home), tmp, home),
            "-"
        );
        // tmp 相对 → `-tmp-…`。
        assert_eq!(
            encode_session_dir_name(Path::new("/private/var/folders/xx/ws"), Some(home), tmp, Path::new("/private/var/folders/xx/ws")),
            "-tmp-ws"
        );
        // 其他绝对路径 → legacy `--…--`，分隔符与冒号转 `-`。
        assert_eq!(
            encode_session_dir_name(Path::new("/Volumes/data/proj"), Some(home), tmp, Path::new("/Volumes/data/proj")),
            "--Volumes-data-proj--"
        );
    }

    #[test]
    fn whitelist_read_rejects_escape_oversize_and_missing() {
        let root = temp_dir("whitelist");
        let local = root.join("local");
        std::fs::create_dir_all(&local).unwrap();
        std::fs::write(local.join("auth-plan.md"), "# Auth\n").unwrap();

        // 正常读取；缺失候选 Ok(None)。
        assert_eq!(
            read_plan_candidate(&local, "auth-plan.md").unwrap(),
            Some("# Auth\n".to_string())
        );
        assert_eq!(read_plan_candidate(&local, "ghost-plan.md").unwrap(), None);
        // 非 *plan.md / 带分隔符 / 带 .. 的名字直接拒绝。
        assert!(read_plan_candidate(&local, "notes.md").is_err());
        assert!(read_plan_candidate(&local, "a/b-plan.md").is_err());
        assert!(read_plan_candidate(&local, "..\\x-plan.md").is_err());
        // 超限拒绝。
        std::fs::write(local.join("huge-plan.md"), vec![b'x'; MAX_PLAN_BYTES + 1]).unwrap();
        let error = read_plan_candidate(&local, "huge-plan.md").unwrap_err();
        assert!(error.contains("1 MiB"), "{error}");

        // 符号链接逃逸出 local 根 → 拒绝。
        #[cfg(unix)]
        {
            let outside = root.join("outside-plan.md");
            std::fs::write(&outside, "secret").unwrap();
            std::os::unix::fs::symlink(&outside, local.join("evil-plan.md")).unwrap();
            let error = read_plan_candidate(&local, "evil-plan.md").unwrap_err();
            assert!(error.contains("逃逸"), "{error}");
        }
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn verified_plan_loads_only_when_the_preview_matches() {
        let root = temp_dir("verified");
        let local = root.join("local");
        std::fs::create_dir_all(&local).unwrap();
        let content = "# Auth 计划\n第一步\n第二步\n";
        std::fs::write(local.join("auth-plan.md"), content).unwrap();
        let params = elicitation_params(
            "Approve plan \"auth\" and start implementation?\n\n# Auth 计划\n第一步\n第二步\n",
        );
        let (loaded, title) = load_verified_plan(&[local.clone()], &params).unwrap();
        assert_eq!(loaded, content);
        assert_eq!(title, "auth");
        // elicitation 只是预览：读到的必须是全文而不是 12 行摘要。
        assert!(loaded.contains("第一步"));

        // 预览对不上 → 拒绝（提案后改动）。
        let stale = elicitation_params(
            "Approve plan \"auth\" and start implementation?\n\n# 别的计划\n",
        );
        let error = load_verified_plan(&[local.clone()], &stale).unwrap_err();
        assert!(error.contains("不一致"), "{error}");
        // 没有 artifacts 根 → 拒绝。
        assert!(load_verified_plan(&[], &params).is_err());
        // 没有计划文件 → 拒绝。
        let empty = temp_dir("verified-empty");
        assert!(load_verified_plan(&[empty.clone()], &params).is_err());
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&empty);
    }

    #[test]
    fn session_local_roots_scans_the_session_artifacts_dir() {
        let base = temp_dir("roots");
        let sessions_root = base.join("sessions");
        // 工作区放临时目录里，编码名由同一函数算出（扫描逻辑与编码解耦测）。
        let workspace = base.join("ws");
        std::fs::create_dir_all(&workspace).unwrap();
        let encoded = session_dir_name(&workspace);
        let local = sessions_root
            .join(&encoded)
            .join("2026-09-24T10-00-00.000_01JTESTSESSION/local");
        std::fs::create_dir_all(&local).unwrap();
        // transcript 文件（.jsonl 后缀）与其它会话目录不入选。
        std::fs::write(
            sessions_root
                .join(&encoded)
                .join("2026-09-24T10-00-00.000_01JTESTSESSION.jsonl"),
            "{}",
        )
        .unwrap();
        std::fs::create_dir_all(
            sessions_root
                .join(&encoded)
                .join("2026-09-24T09-00-00.000_01JOTHER/local"),
        )
        .unwrap();
        let locals = session_local_roots(&[sessions_root], &workspace, "01JTESTSESSION");
        assert_eq!(locals, vec![local]);
        let _ = std::fs::remove_dir_all(&base);
    }

    #[tokio::test]
    async fn resume_is_refused_before_any_spawn() {
        let (core, _registry, emitter) = test_core();
        let mut req = test_request();
        req.session_id = Some("01JOLD".to_string());
        let built = BuiltCommand {
            // 拒绝必须先于 spawn：填一个必然失败的命令，若真的 spawn 了测试会
            // 以别的错误炸掉，而不是断言消息。
            command: tokio::process::Command::new("ccgui-definitely-not-a-real-binary"),
            stdin_payload: None,
            keep_stdin_open: false,
            cleanup_files: Vec::new(),
            mcp_restore: None,
            preassigned_session_id: None,
        };
        run_acp_turn(
            core,
            req,
            built,
            Arc::new(AtomicBool::new(false)),
            4_000_000_077,
        )
        .await;
        let emitted = emitter.0.lock().unwrap().join(" ");
        assert!(emitted.contains("\"error\""), "{emitted}");
        assert!(emitted.contains("全新会话"), "{emitted}");
    }
}
