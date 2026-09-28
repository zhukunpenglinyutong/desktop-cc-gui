use super::{
    command_for_binary, images, push_session_id, BuiltCommand, Engine, EngineEvent, SendRequest,
};
use serde_json::Value;
/// OMP ACP 计划会话驱动（P3 主方案）。声明在这里而不是 mod.rs：适配器
/// 归 pi_family 所有，mod.rs 只需 send_reserved 的 Own 分支条件与
/// send_host_stream 的 "omp" 匹配臂两处路由改动。
#[path = "omp_acp.rs"]
pub(crate) mod omp_acp;

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

/// pi and omp are the same CLI protocol (omp is a fork of pi), but they
/// diverge at spawn: pi runs one-shot `--print --mode json`, while omp runs
/// `--mode rpc-ui` — the only headless mode where the CLI registers its `ask`
/// tool (hasUI gate) and bridges the question dialogs as `extension_ui_request`
/// frames we can answer over stdin.
pub struct PiFamilyEngine {
    pub id: &'static str,
    pub home_dir_name: &'static str, // ".pi" | ".omp"
    /// omp rpc-ui v2 大帧的重组缓冲:chunkId → 分片。pi 的 json 模式用不到。
    rpc_chunks: std::sync::Mutex<std::collections::HashMap<String, RpcChunkAcc>>,
}

/// v2 `rpc_chunk` 分片序列的重组中间态。
struct RpcChunkAcc {
    parts: Vec<Option<String>>,
    received: usize,
}

/// omp `confirm` 对话框映射成两选卡片时的「确认」选项 label;应答帧的
/// confirmed 判定与 emit 侧共用这一常量,两边不许各自拼字符串。
pub(crate) const CONFIRM_YES_LABEL: &str = "确认";

/// pi 没有内置提问工具(omp 的 ask 是 fork 自加的):这个桥扩展就是 pi 会话
/// 的 ask_user 工具,逐题调 ctx.ui.select/input —— rpc 模式下它们成为
/// extension_ui_request 帧,由本应用渲染成问题卡并应答。选项语义对齐 omp
/// 的 ask 降级链:单选一帧 select;多选是「选到 Done 为止」的循环;Other
/// 哨兵转 input 收自由文本。运行时零导入(jiti 不需要解析任何依赖),
/// parameters 直接给 JSON Schema(TypeBox schema 本就是 JSON Schema)。
const PI_ASK_BRIDGE: &str = r#"// CC GUI ask bridge — pi sessions get their ask_user tool from this
// extension. One select/input dialog per question (pi's wire format has no
// multi-select), mirroring omp's degraded ask chain so the host app renders
// both engines with the same card.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const OTHER_OPTION = "Other (type your own)";
const DONE_OPTION = "✓ Done selecting";

interface AskOption {
	label: string;
	description?: string;
}
interface AskQuestion {
	id: string;
	question: string;
	header?: string;
	multi?: boolean;
	options: AskOption[];
}

const DISMISSED = "The user dismissed the question; continue without it and say what you assumed.";

export default function ccguiAskBridge(pi: ExtensionAPI) {
	pi.registerTool({
		name: "ask_user",
		label: "Ask user",
		description:
			"Ask the user one or more questions and wait for the answers. Use it when a decision, " +
			"preference or missing detail changes what you would do; never for facts you can look up. " +
			"Each question takes 2-4 mutually exclusive options (first = recommended when one is " +
			"clearly best); the user can always pick Other to type a custom answer.",
		promptSnippet: "ask the user questions with selectable options",
		parameters: {
			type: "object",
			additionalProperties: false,
			required: ["questions"],
			properties: {
				questions: {
					type: "array",
					minItems: 1,
					items: {
						type: "object",
						additionalProperties: false,
						required: ["id", "question", "options"],
						properties: {
							id: { type: "string", description: "Stable question id, echoed in the answer." },
							question: { type: "string" },
							header: { type: "string", description: "Short chip label." },
							multi: { type: "boolean", description: "Allow selecting several options." },
							options: {
								type: "array",
								minItems: 2,
								items: {
									type: "object",
									additionalProperties: false,
									required: ["label"],
									properties: {
										label: { type: "string" },
										description: { type: "string" },
									},
								},
							},
						},
					},
				},
			},
		} as never,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!ctx.hasUI) {
				return {
					content: [{ type: "text", text: "Error: ask_user needs an interactive session (rpc mode provides one)." }],
				};
			}
			const lines: string[] = [];
			for (const q of params.questions as AskQuestion[]) {
				const labels = q.options.map((o) => o.label);
				if (q.multi === true) {
					const selected: string[] = [];
					let custom: string | undefined;
					for (;;) {
						const remaining = labels.filter((l) => !selected.includes(l));
						const title = selected.length > 0 ? `${q.question} (${selected.length} selected)` : q.question;
						const choice = await ctx.ui.select(title, [...remaining, DONE_OPTION, OTHER_OPTION]);
						if (choice === undefined) {
							return { content: [{ type: "text", text: DISMISSED }], details: { cancelled: true } };
						}
						if (choice === DONE_OPTION) break;
						if (choice === OTHER_OPTION) {
							custom = (await ctx.ui.input(q.question, "Type your answer")) ?? undefined;
							break;
						}
						selected.push(choice);
					}
					lines.push(`${q.id}: ${custom !== undefined ? `custom: ${custom}` : selected.join(", ") || "(none)"}`);
				} else {
					const choice = await ctx.ui.select(q.question, [...labels, OTHER_OPTION]);
					if (choice === undefined) {
						return { content: [{ type: "text", text: DISMISSED }], details: { cancelled: true } };
					}
					if (choice === OTHER_OPTION) {
						const custom = await ctx.ui.input(q.question, "Type your answer");
						lines.push(`${q.id}: ${custom ?? "(no answer)"}`);
					} else {
						lines.push(`${q.id}: ${choice}`);
					}
				}
			}
			return {
				content: [{ type: "text", text: `User answers:\n${lines.join("\n")}` }],
				details: { answers: lines },
			};
		},
	});
}
"#;

/// 把桥扩展写到 app_home(内容比对,变了才重写),返回 `-e` 要用的路径。
fn ensure_pi_ask_bridge() -> Result<String, String> {
    let dir = crate::paths::app_home().join("pi-extensions");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("create pi extension dir {}: {e}", dir.display()))?;
    let path = dir.join("ccgui-ask-bridge.ts");
    let stale = std::fs::read_to_string(&path)
        .map(|current| current != PI_ASK_BRIDGE)
        .unwrap_or(true);
    if stale {
        std::fs::write(&path, PI_ASK_BRIDGE)
            .map_err(|e| format!("write pi ask bridge {}: {e}", path.display()))?;
    }
    Ok(path.to_string_lossy().into_owned())
}

pub fn pi() -> PiFamilyEngine {
    PiFamilyEngine {
        id: "pi",
        home_dir_name: ".pi",
        rpc_chunks: std::sync::Mutex::new(std::collections::HashMap::new()),
    }
}

pub fn omp() -> PiFamilyEngine {
    PiFamilyEngine {
        id: "omp",
        home_dir_name: ".omp",
        rpc_chunks: std::sync::Mutex::new(std::collections::HashMap::new()),
    }
}

/// omp 的显式 plan 请求由 ACP 计划传输承接：mod.rs 据此把该次发送路由进
/// send_host_stream 的 "omp" 臂（omp_acp::run_acp_turn），而不是普通
/// rpc-ui 子进程。
pub(crate) fn acp_plan_requested(req: &SendRequest) -> bool {
    req.permission.as_deref() == Some("plan")
}

/// ACP 计划会话的启动命令：`omp --mode acp`（src/cli/flag-tables.ts:
/// 123-127；`omp acp` 子命令等价，src/commands/acp.ts:30-33）。子进程由
/// omp_acp 驱动 spawn，stdin/stdout 是 JSON-RPC 管道，所以这里没有
/// stdin_payload，也不带 --extension ask 桥（ACP 的提问走 elicitation）。
/// 模型/effort 经 ACP 协议（session/set_config_option model|thinking）
/// 在握手后传入，不在 argv 上重复，保持用户选择不降级。
fn build_omp_acp_plan_command(
    req: &SendRequest,
    mut cmd: tokio::process::Command,
) -> Result<BuiltCommand, String> {
    // 审批点（planModeState/proposal handler）是纯内存状态，session/load
    // 不重注册（acp-agent.ts:670-736 vs 1844-1866）：恢复的会话没有可
    // 核验的人工等待点，spawn 前受控拒绝。
    if req.session_id.is_some() {
        return Err(omp_acp::RESUME_REFUSAL.to_string());
    }
    // 操作电脑的 MCP 注入只针对 rpc 通道验证过；ACP 计划路径未验证，
    // 受控拒绝而非静默降级。
    if req.computer_use == Some(true) {
        return Err(
            "操作电脑与 OMP ACP 计划会话不兼容：.omp/mcp.json 注入未在 ACP 传输验证".to_string(),
        );
    }
    cmd.args(["--mode", "acp"]);
    // service-tier 没有 ACP 配置等价物，保持启动 flag（与 rpc 路径同一
    // 校验与 gating：仅显式 openai-codex 选择器才传）。
    if req.model.as_deref().is_some_and(|m| {
        m.strip_prefix("openai-codex/")
            .is_some_and(|id| !id.is_empty())
    }) {
        if let Some(tier) = req.service_tier.as_deref() {
            if !matches!(tier, "default" | "priority") {
                return Err("Invalid OMP OpenAI service tier".to_string());
            }
            cmd.args(["--service-tier", tier]);
        }
    }
    Ok(BuiltCommand {
        command: cmd,
        stdin_payload: None,
        keep_stdin_open: false,
        cleanup_files: Vec::new(),
        mcp_restore: None,
        preassigned_session_id: None,
    })
}

impl Engine for PiFamilyEngine {
    fn id(&self) -> &'static str {
        self.id
    }

    fn supports_images(&self) -> bool {
        true
    }
    fn supports_effort(&self) -> bool {
        true
    }

    /// omp reads `.omp/mcp.json` from the workspace, which the send injects;
    /// pi's MCP discovery differs and is not wired up (honest no).
    fn supports_computer_use(&self) -> bool {
        self.id == "omp"
    }
    /// omp exposes real approval switches (`--approval-mode`,
    /// `--auto-approve`); pi 0.85 has none of them, so it keeps the trait
    /// default. "plan" 由 OMP 原生 ACP 计划流程承接（plan_approval 的
    /// Typed 声明 + omp_acp 驱动）；`--plan-yolo` 自动批准流程已移除，
    /// 永远不会再作为"人工计划审批"入口回来（PRD §5-OMP.7）。
    ///
    /// `always-ask`/`write` are deliberately absent: they leave write/exec
    /// tools on a `prompt` policy, and print mode has no UI to answer with —
    /// the CLI aborts the turn with "requires approval but no interactive UI
    /// available" the moment a gated tool runs. Only the non-prompting modes
    /// can be honored headlessly.
    fn supported_permissions(&self) -> &'static [&'static str] {
        if self.id == "omp" {
            &["auto", "bypass", "plan"]
        } else {
            &["auto"]
        }
    }

    /// OMP 的人工计划审批走原生 ACP 计划流程（session/set_mode plan +
    /// elicitation.form 握手 + 计划文件全文，omp_acp 驱动）。pi 没有任何
    /// 计划能力，静默回退到 auto 是被禁止的降级。旧的 `--plan-yolo`
    /// 无头流程自动批准计划，永远不能再作为"人工计划审批"入口
    /// （PRD §5-OMP.7）。
    fn plan_approval(&self) -> crate::engine::plan_review::PlanApproval {
        if self.id == "omp" {
            crate::engine::plan_review::PlanApproval::Typed {
                review_kind: crate::engine::plan_review::PlanReviewKind::NativeRequest,
                evidence: "OMP 18.0.11 acp-agent.ts elicitation.form 握手 + 计划文件全文（行号见 P0）",
                limitations: "ACP 反馈仅二值 Refine 信号无文本载体；审批点跨重启不可恢复；仅新会话可进入计划模式",
            }
        } else {
            crate::engine::plan_review::PlanApproval::Unavailable {
                reason: "pi exposes no plan mode; a plan request would silently degrade to auto",
            }
        }
    }

    fn supports_tool_constraints(&self) -> bool {
        self.id == "pi"
    }

    fn build_command(&self, req: &SendRequest, bin: &str) -> Result<BuiltCommand, String> {
        let mut cmd = command_for_binary(bin);
        if let Some(tools) = req.allowed_tools.as_deref() {
            if self.id != "pi"
                || tools.is_empty()
                || tools
                    .iter()
                    .any(|tool| !matches!(tool.as_str(), "read" | "grep" | "find" | "ls"))
                || req.computer_use == Some(true)
            {
                return Err("read-only tool constraints require Pi built-in read/grep/find/ls tools without computer use".into());
            }
            if req.session_id.as_deref().is_some_and(|session| {
                session.contains('/') || session.contains('\\') || session.ends_with(".jsonl")
            }) {
                return Err(
                    "read-only Pi runs accept session IDs, not writable session file paths".into(),
                );
            }
            cmd.args(["--no-extensions", "--tools", &tools.join(",")]);
        }
        // OMP 原生 ACP 计划流程（PRD §5-OMP 主方案）：显式 plan 请求改走
        // ACP 传输，omp_acp 驱动接管子进程（stdio JSON-RPC + elicitation
        // 停车）。计划审批是用户决策——这条命令行绝不携带
        // --plan-yolo/--plan-yolo-into/--auto-approve。
        if self.id == "omp" && acp_plan_requested(req) {
            return build_omp_acp_plan_command(req, cmd);
        }
        // pi 与 omp 都走 rpc:提问对话框以 extension_ui_request 帧到达、应答
        // 写回 stdin。omp 用 rpc-ui(hasUI 打开 CLI 内置 ask);pi 用 rpc 加
        // 自带的 ask 桥扩展(pi 没有内置提问工具)。
        let rpc_ui = self.id == "omp";
        let rpc_mode = rpc_ui || self.id == "pi";
        if rpc_ui {
            cmd.arg("--mode");
            cmd.arg("rpc-ui");
            cmd.arg("--extension");
            cmd.arg(ensure_pi_ask_bridge()?);
        } else if rpc_mode {
            cmd.arg("--mode");
            cmd.arg("rpc");
            if req.allowed_tools.is_none() {
                cmd.arg("--extension");
                cmd.arg(ensure_pi_ask_bridge()?);
            }
        } else {
            cmd.arg("--print");
            cmd.arg("--mode");
            cmd.arg("json");
        }
        if let Some(model) = req.model.as_deref() {
            cmd.arg("--model");
            cmd.arg(model);
        }
        // Only explicit OpenAI-Codex selectors opt into this per-app preference.
        // Never leak it to pi, another provider or an unknown CLI default.
        if self.id == "omp"
            && req.model.as_deref().is_some_and(|m| {
                m.strip_prefix("openai-codex/")
                    .is_some_and(|id| !id.is_empty())
            })
        {
            if let Some(tier) = req.service_tier.as_deref() {
                if !matches!(tier, "default" | "priority") {
                    return Err("Invalid OMP OpenAI service tier".to_string());
                }
                cmd.args(["--service-tier", tier]);
            }
        }
        // Let the CLI encode thinking for the selected provider; adding generic
        // effort fields in the bridge breaks Responses and other strict APIs.
        if let Some(effort) = req.effort.as_deref() {
            cmd.arg("--thinking");
            cmd.arg(effort);
        }
        match self.resolve_permission(req.permission.as_deref()) {
            // Skips every approval tier for this run, and also sets the
            // session's explicit auto-approve flag (not just the setting), so
            // the ACP permission gate stands down too.
            "bypass" => {
                cmd.arg("--auto-approve");
            }
            // "auto": leave the CLI's own tools.approvalMode alone. omp 的
            // 显式 plan 请求已在上面改走 ACP 命令（build_omp_acp_plan_command
            // 在 prepare_launch 的门禁之后），到不了这个 rpc 分支；pi 的
            // plan 请求被 ensure_plan_approval 在构建命令前受控拒绝。
            _ => {}
        }
        if let Some(session_id) = req.session_id.as_deref() {
            if !session_id.starts_with('-') {
                // rpc 模式的 resume:omp 用 `--resume`(接受 id 前缀),pi 用
                // `--session <id>`(--session-id 在 pi 是「给新会话指派
                // id」,不是恢复)。pi 的 json 一次性模式才走 --session-id。
                if self.id == "omp" {
                    cmd.arg("--resume");
                } else if rpc_mode {
                    cmd.arg("--session");
                } else {
                    cmd.arg("--session-id");
                }
                cmd.arg(session_id);
            }
        }
        // Image attachments as `@<abs path>` file references ahead of the
        // prompt. data: URLs can't be file-referenced; the frontend's paste
        // flow already materializes blobs to files, so anything left is
        // skipped here rather than breaking argv. rpc 模式拒绝 @file 参数,
        // omp 的图片改走 prompt 命令的 base64 字段(见下)。
        if !rpc_mode {
            for raw in &req.images {
                if let Some(absolute) = images::absolutize_image_path(raw, &req.workspace) {
                    cmd.arg(format!("@{}", absolute.display()));
                }
            }
        }
        if rpc_mode {
            // rpc 模式的 prompt 是 stdin 上的 NDJSON 命令(位置参数不派发)。
            // 命令按序执行:get_state 拿 sessionId(json 模式的 session 头帧
            // 在 rpc 没有等价物)→ 下发任务;omp 额外先协商 v2 分片。早写无
            // 害:输入循环在 session 就绪后才启动,管道会缓冲这些行。
            let mut prompt = serde_json::json!({
                "id": "ccgui-prompt",
                "type": "prompt",
                "message": req.prompt,
            });
            if !req.images.is_empty() {
                let mut payloads = Vec::new();
                for raw in &req.images {
                    let (mime, data) = images::load_image(raw, &req.workspace)?;
                    payloads.push(serde_json::json!({
                        "type": "image",
                        "data": data,
                        "mimeType": mime,
                    }));
                }
                prompt["images"] = Value::Array(payloads);
            }
            // v2 分片协商是 omp 的 fork 自加;pi 只有 v1(超大帧截断降级,
            // 不影响会话)。json 模式的 session 头帧在 rpc 没有等价物,
            // get_state 响应带回 sessionId。
            let mut lines = Vec::new();
            if rpc_ui {
                lines.push(serde_json::json!({"id": "ccgui-negotiate", "type": "negotiate_protocol", "protocolVersion": 2}).to_string());
            }
            if let Some(effort) = req
                .effort
                .as_deref()
                .map(str::trim)
                .filter(|e| !e.is_empty())
            {
                lines.push(serde_json::json!({"id": "ccgui-effort", "type": "set_thinking_level", "level": effort}).to_string());
            }
            lines.push(serde_json::json!({"id": "ccgui-state", "type": "get_state"}).to_string());
            lines.push(prompt.to_string());
            let payload = lines.join("\n");
            // omp 没有 --mcp-config 启动参数(MCP 只从固定文件发现):
            // 注入工作区 .omp/mcp.json,回合结束按引用计数恢复,崩溃残留
            // 由下次启动的 sweep 兜底(见 computer_use::inject_workspace_mcp)。
            let mcp_restore = if req.computer_use == Some(true) && self.id == "omp" {
                crate::computer_use::inject_workspace_mcp(&req.workspace)?
            } else {
                None
            };
            return Ok(BuiltCommand {
                command: cmd,
                stdin_payload: Some(payload),
                // 提问应答(extension_ui_response)在同一根 stdin 上回写;
                // Done 事件落定时 reader 会关闭它,rpc 进程随之 drain 退出。
                keep_stdin_open: true,
                cleanup_files: Vec::new(),
                mcp_restore,
                preassigned_session_id: None,
            });
        }
        // Prompt travels through stdin, never argv: on Windows the pi shim is a
        // `.cmd` batch file spawned via `cmd /c`, and cmd.exe cuts a multiline
        // argument at the first newline - every line after the first was
        // dropped. pi joins piped stdin into the initial message
        // (`readPipedStdin` -> `buildInitialMessage`), so the prompt rides
        // stdin verbatim, matching codex; `@<abs path>` image refs stay in argv.
        Ok(BuiltCommand {
            command: cmd,
            stdin_payload: Some(req.prompt.clone()),
            keep_stdin_open: false,
            cleanup_files: Vec::new(),
            mcp_restore: None,
            preassigned_session_id: None,
        })
    }

    fn parse_line(&self, line: &str, out: &mut Vec<EngineEvent>) {
        // v2 分片重组:完整帧递归走正常解析,分片中途不产生事件。廉价前置
        // 判断避免给每一行付出锁的代价。
        if line.contains("\"rpc_chunk\"") {
            if let Some(frame) = self.reassemble_chunk(line) {
                parse_pi_family_line(&frame, out);
            }
            return;
        }
        parse_pi_family_line(line, out);
    }
}

impl PiFamilyEngine {
    /// 重组一条 v2 `rpc_chunk` 序列;收齐时返回完整帧文本。乱序/重复分片
    /// 都接受;count 自相矛盾的序列整条丢弃。
    fn reassemble_chunk(&self, line: &str) -> Option<String> {
        use base64::Engine as _;
        let value: Value = serde_json::from_str(line).ok()?;
        if value.get("type").and_then(Value::as_str) != Some("rpc_chunk") {
            return None;
        }
        let chunk_id = value.get("chunkId").and_then(Value::as_str)?.to_string();
        let index = value.get("index").and_then(Value::as_u64)? as usize;
        let count = value.get("count").and_then(Value::as_u64)? as usize;
        let data = value.get("data").and_then(Value::as_str)?.to_string();
        if count == 0 || index >= count {
            return None;
        }
        let mut chunks = self.rpc_chunks.lock().ok()?;
        let acc = chunks
            .entry(chunk_id.clone())
            .or_insert_with(|| RpcChunkAcc {
                parts: vec![None; count],
                received: 0,
            });
        if acc.parts.len() != count {
            chunks.remove(&chunk_id);
            return None;
        }
        if acc.parts.get(index).is_some_and(Option::is_none) {
            acc.parts[index] = Some(data);
            acc.received += 1;
        }
        if acc.received < count {
            return None;
        }
        let acc = chunks.remove(&chunk_id)?;
        let mut bytes = Vec::new();
        for part in acc.parts {
            let decoded = base64::engine::general_purpose::STANDARD
                .decode(part?.as_bytes())
                .ok()?;
            bytes.extend_from_slice(&decoded);
        }
        String::from_utf8(bytes).ok()
    }
}

/// 构造 omp rpc-ui 的提问应答帧。answers 是 UI 的 map(渲染题文 → 选中
/// label 或自由文本);omp 的降级链一次一题,取唯一的值。None = 用户忽略
/// (cancelled,CLI 侧按用户取消继续)。
pub(crate) fn extension_ui_answer_frame(
    method: &str,
    request_id: &str,
    answers: Option<&Value>,
) -> Value {
    let answer = answers
        .and_then(Value::as_object)
        .and_then(|map| map.values().next());
    let Some(answer) = answer else {
        return serde_json::json!({
            "type": "extension_ui_response",
            "id": request_id,
            "cancelled": true,
        });
    };
    // select/input/editor 的应答都是单个字符串;数组只可能来自 UI 的
    // 多选卡片(omp 的 select 帧是单选),兜底拼接。
    let text = match answer {
        Value::String(s) => s.clone(),
        Value::Array(labels) => labels
            .iter()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>()
            .join(", "),
        other => other.to_string(),
    };
    if method == "confirm" {
        return serde_json::json!({
            "type": "extension_ui_response",
            "id": request_id,
            "confirmed": text == CONFIRM_YES_LABEL,
        });
    }
    serde_json::json!({
        "type": "extension_ui_response",
        "id": request_id,
        "value": text,
    })
}

/// Shared NDJSON parser for pi and omp (`--mode json`).
fn parse_pi_family_line(line: &str, out: &mut Vec<EngineEvent>) {
    // Stream updates can include the entire growing message twice (message
    // and assistantMessageEvent.partial). Skip those snapshots without
    // allocating a JSON object tree for every token.
    #[derive(serde::Deserialize)]
    struct Envelope {
        #[serde(rename = "type")]
        kind: String,
        #[serde(rename = "assistantMessageEvent")]
        event: Option<Delta>,
    }
    #[derive(serde::Deserialize)]
    struct Delta {
        #[serde(rename = "type")]
        kind: String,
        delta: Option<String>,
    }
    let Ok(envelope) = serde_json::from_str::<Envelope>(line) else {
        return;
    };
    if envelope.kind == "message_update" {
        if let Some(delta) = envelope.event {
            if let Some(text) = delta.delta.filter(|text| !text.is_empty()) {
                match delta.kind.as_str() {
                    "text_delta" => out.push(EngineEvent::Delta(text)),
                    "thinking_delta" => out.push(EngineEvent::Thinking(text)),
                    _ => {}
                }
            }
        }
        return;
    }
    let event_type = envelope.kind.as_str();
    if !matches!(
        event_type,
        "session"
            | "tool_execution_start"
            | "tool_execution_end"
            | "message_end"
            | "message_start"
            | "turn_end"
            | "agent_end"
            | "auto_retry_start"
            | "auto_retry_end"
            | "auto_compaction_start"
            | "auto_compaction_end"
            | "agent_settled"
            | "response"
            | "extension_ui_request"
            | "rpc_frame_error"
            | "thinking_level_changed"
    ) {
        return;
    }
    let Ok(value) = serde_json::from_str::<Value>(line) else {
        return;
    };
    match event_type {
        // Response stream opens: reader.rs starts the genMs window here so
        // TTFT and tool-argument decoding are counted, not just text deltas.
        "message_start" => out.push(EngineEvent::Generation { active: true }),
        "session" => {
            push_session_id(&value, "id", out);
        }
        "thinking_level_changed" => {
            if let Some(level) = value.get("thinkingLevel").and_then(Value::as_str) {
                let trimmed = level.trim();
                if !trimmed.is_empty() {
                    out.push(EngineEvent::Effort(trimmed.to_string()));
                }
            }
        }
        // omp rpc-ui 的命令响应:get_state 带回 sessionId(json 模式的
        // session 头帧在 rpc 模式没有等价物);prompt 下发失败是致命的,其余
        // 命令失败仅告警。negotiate_protocol 失败 = 服务端只讲 v1,大帧可能
        // 截断降级,但会话本身不受影响。
        "response" => {
            let command = value.get("command").and_then(Value::as_str).unwrap_or("");
            let success = value
                .get("success")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            if success {
                if command == "get_state" {
                    if let Some(id) = value
                        .pointer("/data/sessionId")
                        .and_then(Value::as_str)
                        .filter(|id| !id.is_empty())
                    {
                        out.push(EngineEvent::SessionId(id.to_string()));
                    }
                }
            } else {
                let error = value
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("未知错误");
                match command {
                    "prompt" => out.push(EngineEvent::Error(format!("omp 任务下发失败:{error}"))),
                    "negotiate_protocol" => {}
                    _ => out.push(EngineEvent::Warn(format!(
                        "omp 命令 {command} 失败:{error}"
                    ))),
                }
            }
        }
        // v1 超大帧被截断或服务端分帧失败:内容有损,但至少让用户知道。
        "rpc_frame_error" => {
            out.push(EngineEvent::Warn(
                "omp 协议帧错误,部分输出可能被截断".to_string(),
            ));
        }
        "extension_ui_request" => parse_ui_request(&value, out),
        // pi 的完全落定(omp 不发这个帧,真发了也被单调落定守卫丢弃)。
        "agent_settled" => out.push(EngineEvent::AgentSettled),
        "tool_execution_start" => {
            let name = value
                .get("toolName")
                .and_then(Value::as_str)
                .unwrap_or("tool");
            let intent = value.get("intent").and_then(Value::as_str);
            out.push(super::tool_call_message(
                tool_label(name, intent),
                value.get("args"),
            ));
        }
        "tool_execution_end" => {
            let name = value.get("toolName").and_then(Value::as_str).unwrap_or("");
            let result = value.get("result");
            out.push(super::tool_result_patch(name, result));
        }
        "message_end" => {
            if let Some(model) = value
                .get("message")
                .and_then(|m| m.get("model"))
                .or_else(|| value.get("model"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
            {
                out.push(EngineEvent::Model(model.to_string()));
            }
            if let Some(effort) = value
                .get("message")
                .and_then(|m| m.get("thinking_effort"))
                .or_else(|| value.get("thinking_effort"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
            {
                out.push(EngineEvent::Effort(effort.to_string()));
            }
            if let Some(usage) = value
                .get("message")
                .and_then(|m| m.get("usage"))
                .filter(|u| !u.is_null())
            {
                out.push(EngineEvent::Usage(attach_context_window(usage.clone())));
            }
            // A failed model call can still retry. Only a terminal agent_end
            // (or process EOF) decides the run's outcome.
            if let Some(error) = nested_error_text(&value, &["message"]) {
                out.push(EngineEvent::Warn(error));
            }
        }
        "auto_compaction_start" => {
            // Forwarded by rpc-ui (omp) only — pi's rpc whitelist carries
            // just the end event, which harmlessly clears a never-shown
            // indicator.
            out.push(EngineEvent::Compaction {
                active: true,
                reason: value
                    .get("reason")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(str::to_string),
            });
        }
        "auto_compaction_end" => {
            out.push(EngineEvent::Compaction {
                active: false,
                reason: None,
            });
        }
        "auto_retry_start" => {
            // The CLI is backing off before re-issuing the request (provider
            // 5xx / stream-envelope failures). Live progress, not an error:
            // the run status line renders "重试中 x/y" and the next content
            // event clears it.
            out.push(EngineEvent::Retry {
                attempt: value.get("attempt").and_then(Value::as_u64).unwrap_or(0),
                max: value
                    .get("maxAttempts")
                    .and_then(Value::as_u64)
                    .unwrap_or(0),
                message: value
                    .get("errorMessage")
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .unwrap_or("")
                    .to_string(),
            });
        }
        "auto_retry_end" => {
            // A retry saga can hand off to compaction/continuation. Clear its
            // indicator, but leave run settlement to terminal agent_end/EOF.
            out.push(EngineEvent::Retry {
                attempt: 0,
                max: 0,
                message: String::new(),
            });
            if value.get("success").and_then(Value::as_bool) == Some(false) {
                let error = value
                    .get("finalError")
                    .and_then(Value::as_str)
                    .filter(|text| !text.trim().is_empty())
                    .unwrap_or("Automatic retry failed")
                    .to_string();
                out.push(EngineEvent::AttemptEnd { error: Some(error) });
            }
        }
        "turn_end" | "agent_end" => {
            let error = attempt_error(&value);
            // turn_end precedes the retry decision. OMP explicitly marks its
            // final agent_end; pi/older CLIs may emit agent_end BEFORE retry
            // and lack isTerminal, so their outcome remains provisional to EOF.
            if event_type == "agent_end"
                && value.get("isTerminal").and_then(Value::as_bool) == Some(true)
                && value.get("willRetry").and_then(Value::as_bool) != Some(true)
            {
                out.push(match error {
                    Some(error) => EngineEvent::Error(error),
                    None => EngineEvent::Done {
                        session_id: None,
                        usage: None,
                    },
                });
            } else {
                out.push(EngineEvent::AttemptEnd { error });
            }
        }
        _ => {}
    }
}

/// The final assistant result wins; earlier failed attempts may have recovered.
fn attempt_error(value: &Value) -> Option<String> {
    let message = value.get("message").or_else(|| {
        value
            .get("messages")?
            .as_array()?
            .iter()
            .rev()
            .find(|message| message.get("role").and_then(Value::as_str) == Some("assistant"))
    });
    nested_error_text(value, &["message"])
        .or_else(|| message.and_then(|message| nested_error_text(message, &[])))
        .or_else(|| {
            (message?.get("stopReason")?.as_str()? == "error")
                .then(|| "Model request failed".to_string())
        })
}
/// Display label for a tool call: the human-readable intent when the CLI
/// provides one, prefixed with the tool name so the frontend's type
/// classification still sees the raw name token.
pub fn tool_label(name: &str, intent: Option<&str>) -> String {
    match intent {
        Some(intent) if !intent.trim().is_empty() && intent.trim() != name => {
            format!("{} · {}", name, intent.trim())
                .chars()
                .take(120)
                .collect()
        }
        _ => name.to_string(),
    }
}

/// Find the first non-empty error text across the shapes omp emits:
/// `<prefix>.errorMessage`, top-level `errorMessage`, `error.message`, and
/// `<prefix>.error` when it is a plain string. Returns the
/// trimmed text; None when the event carries no error.
fn nested_error_text(value: &Value, prefix: &[&str]) -> Option<String> {
    let mut candidates: Vec<Option<&str>> = Vec::new();
    for pre in prefix {
        candidates.push(
            value
                .get(*pre)
                .and_then(|m| m.get("errorMessage"))
                .and_then(Value::as_str),
        );
    }
    candidates.push(value.get("errorMessage").and_then(Value::as_str));
    candidates.push(
        value
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(Value::as_str),
    );
    for pre in prefix {
        candidates.push(
            value
                .get(*pre)
                .and_then(|m| m.get("error"))
                .and_then(Value::as_str),
        );
    }
    candidates
        .into_iter()
        .flatten()
        .map(str::trim)
        .find(|text| !text.is_empty())
        .map(str::to_string)
}

/// omp rpc-ui 的提问/输入对话框桥。AskTool 在没有 askDialog 帧的 rpc-ui 下
/// 退化为逐题 select/editor 链(多选是 CLI 侧的多轮 select 循环),所以线
/// 上只有单选与自由文本;每个需应答的 method 映射为一张问题卡,应答帧由
/// `extension_ui_answer_frame` 构造。cancel 是撤销通知(无需应答,关掉卡片即可);
/// notify/setStatus/setWidget 等 fire-and-forget method 不在此出现。
fn parse_ui_request(value: &Value, out: &mut Vec<EngineEvent>) {
    let method = value.get("method").and_then(Value::as_str).unwrap_or("");
    if method == "cancel" {
        if let Some(target) = value.get("targetId").and_then(Value::as_str) {
            out.push(EngineEvent::QuestionSettled {
                request_id: target.to_string(),
            });
        }
        return;
    }
    let id = value.get("id").and_then(Value::as_str).unwrap_or("");
    if id.is_empty() {
        return;
    }
    let title = value
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let (question, options) = match method {
        "select" => {
            let labels = value
                .get("options")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            // optionDetails 与 options 位置对齐,只携带 description。
            let details = value.get("optionDetails").and_then(Value::as_array);
            let options: Vec<Value> = labels
                .iter()
                .enumerate()
                .filter_map(|(index, label)| {
                    let label = label.as_str()?;
                    let description = details
                        .and_then(|d| d.get(index))
                        .and_then(|d| d.get("description"))
                        .and_then(Value::as_str);
                    Some(match description {
                        Some(d) => serde_json::json!({ "label": label, "description": d }),
                        None => serde_json::json!({ "label": label }),
                    })
                })
                .collect();
            if options.is_empty() {
                return;
            }
            (title, options)
        }
        "confirm" => {
            let message = value.get("message").and_then(Value::as_str).unwrap_or("");
            let question = if message.is_empty() {
                title
            } else {
                format!("{title}\n\n{message}")
            };
            (
                question,
                vec![
                    serde_json::json!({ "label": CONFIRM_YES_LABEL }),
                    serde_json::json!({ "label": "取消" }),
                ],
            )
        }
        // input/editor 是自由文本:卡片的自由输入框承担,无选项。
        "input" | "editor" => (title, Vec::new()),
        _ => return,
    };
    out.push(EngineEvent::Question {
        request_id: id.to_string(),
        tool_use_id: None,
        input: serde_json::json!({
            "questions": [{
                "question": question,
                "header": "提问",
                "multiSelect": false,
                "options": options,
            }],
            // 应答侧只需要 method 来决定响应帧形状;id 就是 request_id。
            "extui": { "method": method },
        }),
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plan_req(permission: Option<&str>) -> SendRequest {
        SendRequest {
            session_id: None,
            workspace: std::path::PathBuf::from("/tmp/ccgui-pi-family-test"),
            prompt: "规划一下".to_string(),
            images: Vec::new(),
            model: None,
            effort: None,
            service_tier: None,
            permission: permission.map(str::to_string),
            additional_dirs: Vec::new(),
            provider_id: None,
            computer_use: None,
            allowed_tools: None,
        }
    }

    fn argv_of(built: &BuiltCommand) -> Vec<String> {
        built
            .command
            .as_std()
            .get_args()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect()
    }

    #[test]
    fn omp_plan_capability_is_typed_and_pi_stays_unavailable() {
        assert_eq!(omp().supported_permissions(), ["auto", "bypass", "plan"]);
        assert_eq!(pi().supported_permissions(), ["auto"]);
        let crate::engine::plan_review::PlanApproval::Typed {
            review_kind,
            limitations,
            ..
        } = omp().plan_approval()
        else {
            panic!("omp plan approval must be Typed once the ACP adapter is wired");
        };
        assert_eq!(
            review_kind,
            crate::engine::plan_review::PlanReviewKind::NativeRequest
        );
        // 限制说明必须向用户讲清：无文本反馈载体、审批点不可恢复、仅新会话。
        assert!(limitations.contains("Refine"), "{limitations}");
        assert!(matches!(
            pi().plan_approval(),
            crate::engine::plan_review::PlanApproval::Unavailable { .. }
        ));
    }

    #[test]
    fn acp_plan_requested_only_matches_explicit_plan() {
        assert!(acp_plan_requested(&plan_req(Some("plan"))));
        assert!(!acp_plan_requested(&plan_req(Some("auto"))));
        assert!(!acp_plan_requested(&plan_req(Some("bypass"))));
        assert!(!acp_plan_requested(&plan_req(None)));
    }

    #[test]
    fn omp_plan_builds_the_acp_command_without_any_auto_approve_flag() {
        let mut req = plan_req(Some("plan"));
        req.model = Some("openai-codex/gpt-5.4".to_string());
        req.service_tier = Some("priority".to_string());
        let built = omp().build_command(&req, "fake-omp").unwrap();
        let args = argv_of(&built);
        // ACP 入口 flag（flag-tables.ts:123-127），stdin 由驱动接管。
        let mode = args.iter().position(|arg| arg == "--mode").expect("--mode");
        assert_eq!(args[mode + 1], "acp");
        // 自动批准参数绝不出现在计划命令行（PRD §5-OMP.5）。
        assert!(!args.contains(&"--plan-yolo".to_string()), "{args:?}");
        assert!(!args.contains(&"--plan-yolo-into".to_string()), "{args:?}");
        assert!(!args.contains(&"--auto-approve".to_string()), "{args:?}");
        // rpc-ui 的 ask 桥不属于 ACP 传输。
        assert!(!args.contains(&"--extension".to_string()), "{args:?}");
        // 模型/effort 走 ACP 配置协议，不在 argv 上重复（不降级 smol）。
        assert!(!args.contains(&"--model".to_string()), "{args:?}");
        assert!(!args.contains(&"--thinking".to_string()), "{args:?}");
        // service-tier 没有 ACP 等价物，保持启动 flag 且通过校验。
        let tier = args
            .iter()
            .position(|arg| arg == "--service-tier")
            .expect("--service-tier");
        assert_eq!(args[tier + 1], "priority");
        assert!(built.stdin_payload.is_none());
        assert!(!built.keep_stdin_open);
        // 非法 tier 与 rpc 路径同一校验。
        req.service_tier = Some("flex".to_string());
        assert!(omp().build_command(&req, "fake-omp").is_err());
    }

    #[test]
    fn omp_plan_refuses_resume_and_computer_use_before_spawn() {
        // 恢复的会话没有可核验的人工等待点（planModeState 纯内存）。
        let mut req = plan_req(Some("plan"));
        req.session_id = Some("01JOLD".to_string());
        let error = omp().build_command(&req, "fake-omp").err().unwrap();
        assert!(error.contains("全新会话"), "{error}");
        // 操作电脑的 MCP 注入未在 ACP 传输验证。
        let mut req = plan_req(Some("plan"));
        req.computer_use = Some(true);
        assert!(omp().build_command(&req, "fake-omp").is_err());
        // auto/bypass 路径不受影响（回归护栏）。
        assert!(omp().build_command(&plan_req(Some("auto")), "fake-omp").is_ok());
    }

    #[test]
    fn message_end_reports_actual_thinking_effort() {
        let mut out = Vec::new();
        parse_pi_family_line(
            &serde_json::json!({
                "type": "message_end",
                "message": { "model": "kimi-k2", "thinking_effort": "xhigh" }
            })
            .to_string(),
            &mut out,
        );
        assert!(
            out.iter()
                .any(|e| matches!(e, EngineEvent::Effort(level) if level == "xhigh")),
            "got {out:?}"
        );

        // Blank or absent effort emits nothing.
        for line in [
            serde_json::json!({ "type": "message_end", "thinking_effort": " " }).to_string(),
            serde_json::json!({ "type": "message_end", "message": {} }).to_string(),
        ] {
            let mut out = Vec::new();
            parse_pi_family_line(&line, &mut out);
            assert!(
                !out.iter().any(|e| matches!(e, EngineEvent::Effort(_))),
                "got {out:?}"
            );
        }
    }

    #[test]
    fn message_start_opens_the_generation_window() {
        let mut out = Vec::new();
        let line = r#"{"type":"message_start","message":{"role":"assistant","content":[]}}"#;
        parse_pi_family_line(line, &mut out);
        match &out[..] {
            [EngineEvent::Generation { active: true }] => {}
            other => panic!("expected generation start, got {other:?}"),
        }
    }

    #[test]
    fn stream_updates_skip_snapshots_and_preserve_delta_order() {
        let mut out = Vec::new();
        for (kind, text) in [("thinking_delta", "思考\n"), ("text_delta", "答案\"你好\"")] {
            let snapshot =
                serde_json::json!({"content": [{"type": "text", "text": "长文本".repeat(20000)}]});
            let line = serde_json::json!({
                "type": "message_update", "message": snapshot,
                "assistantMessageEvent": {"type": kind, "delta": text, "partial": snapshot}
            })
            .to_string();
            parse_pi_family_line(&line, &mut out);
        }
        assert_eq!(out.len(), 2);
        assert!(matches!(&out[0], EngineEvent::Thinking(t) if t == "思考\n"));
        assert!(matches!(&out[1], EngineEvent::Delta(t) if t == "答案\"你好\""));
        for line in [
            r#"{"type":"message_update"}"#,
            r#"{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":""}}"#,
            r#"{"type":"message_update","assistantMessageEvent":{"type":"toolcall_delta","delta":"ignored"}}"#,
            "{incomplete",
        ] {
            parse_pi_family_line(line, &mut out);
        }
        assert_eq!(out.len(), 2);
    }

    #[test]
    fn rpc_get_state_response_announces_the_session_id() {
        let line = serde_json::json!({
            "id": "ccgui-state",
            "type": "response",
            "command": "get_state",
            "success": true,
            "data": { "sessionId": "01JABC", "isStreaming": false },
        })
        .to_string();
        let mut out = Vec::new();
        parse_pi_family_line(&line, &mut out);
        assert!(
            matches!(&out[..], [EngineEvent::SessionId(id)] if id == "01JABC"),
            "got {out:?}"
        );
    }

    #[test]
    fn rpc_prompt_failure_is_terminal_and_other_commands_warn() {
        let mut out = Vec::new();
        parse_pi_family_line(
            &serde_json::json!({
                "id": "ccgui-prompt", "type": "response", "command": "prompt",
                "success": false, "error": "rate limited",
            })
            .to_string(),
            &mut out,
        );
        assert!(matches!(&out[..], [EngineEvent::Error(_)]), "got {out:?}");

        let mut out = Vec::new();
        parse_pi_family_line(
            &serde_json::json!({
                "id": "x", "type": "response", "command": "compact",
                "success": false, "error": "busy",
            })
            .to_string(),
            &mut out,
        );
        assert!(matches!(&out[..], [EngineEvent::Warn(_)]), "got {out:?}");

        // negotiate_protocol 失败 = v1 降级,不告警不致命。
        let mut out = Vec::new();
        parse_pi_family_line(
            &serde_json::json!({
                "id": "ccgui-negotiate", "type": "response", "command": "negotiate_protocol",
                "success": false, "error": "unsupported",
            })
            .to_string(),
            &mut out,
        );
        assert!(out.is_empty(), "got {out:?}");
    }

    #[test]
    fn auto_compaction_events_map_to_compaction_progress() {
        let mut out = Vec::new();
        parse_pi_family_line(
            &serde_json::json!({
                "type": "auto_compaction_start", "reason": "threshold", "action": "compact",
            })
            .to_string(),
            &mut out,
        );
        assert!(
            matches!(&out[..], [EngineEvent::Compaction { active: true, reason }] if reason.as_deref() == Some("threshold")),
            "got {out:?}"
        );

        let mut out = Vec::new();
        parse_pi_family_line(
            &serde_json::json!({ "type": "auto_compaction_end" }).to_string(),
            &mut out,
        );
        assert!(
            matches!(&out[..], [EngineEvent::Compaction { active: false, .. }]),
            "got {out:?}"
        );
    }

    #[test]
    fn select_request_becomes_a_question_card() {
        let line = serde_json::json!({
            "type": "extension_ui_request",
            "id": "0192ab3cd4ef0123",
            "method": "select",
            "title": "部署到哪?",
            "options": ["staging (Recommended)", "prod", "Other (type your own)"],
            "optionDetails": [{ "description": "预发" }, {}, {}],
        })
        .to_string();
        let mut out = Vec::new();
        parse_pi_family_line(&line, &mut out);
        match &out[..] {
            [EngineEvent::Question {
                request_id, input, ..
            }] => {
                assert_eq!(request_id, "0192ab3cd4ef0123");
                assert_eq!(input["questions"][0]["question"], "部署到哪?");
                assert_eq!(
                    input["questions"][0]["options"][0]["label"],
                    "staging (Recommended)"
                );
                assert_eq!(input["questions"][0]["options"][0]["description"], "预发");
                assert_eq!(input["extui"]["method"], "select");
            }
            other => panic!("expected question event, got {other:?}"),
        }
    }

    #[test]
    fn input_and_editor_requests_are_free_text_cards() {
        for method in ["input", "editor"] {
            let line = serde_json::json!({
                "type": "extension_ui_request",
                "id": "req-free",
                "method": method,
                "title": "随便说点啥",
            })
            .to_string();
            let mut out = Vec::new();
            parse_pi_family_line(&line, &mut out);
            match &out[..] {
                [EngineEvent::Question { input, .. }] => {
                    assert_eq!(input["questions"][0]["options"], serde_json::json!([]));
                    assert_eq!(input["extui"]["method"], method);
                }
                other => panic!("expected question event, got {other:?}"),
            }
        }
    }

    #[test]
    fn confirm_request_maps_to_a_two_option_card_and_cancel_settles() {
        let line = serde_json::json!({
            "type": "extension_ui_request",
            "id": "req-confirm",
            "method": "confirm",
            "title": "继续吗",
            "message": "这会删除文件",
        })
        .to_string();
        let mut out = Vec::new();
        parse_pi_family_line(&line, &mut out);
        match &out[..] {
            [EngineEvent::Question { input, .. }] => {
                assert_eq!(input["questions"][0]["question"], "继续吗\n\n这会删除文件");
                assert_eq!(
                    input["questions"][0]["options"][0]["label"],
                    CONFIRM_YES_LABEL
                );
                assert_eq!(input["extui"]["method"], "confirm");
            }
            other => panic!("expected question event, got {other:?}"),
        }

        let cancel = serde_json::json!({
            "type": "extension_ui_request",
            "method": "cancel",
            "targetId": "req-confirm",
        })
        .to_string();
        let mut out = Vec::new();
        parse_pi_family_line(&cancel, &mut out);
        assert!(
            matches!(&out[..], [EngineEvent::QuestionSettled { request_id }] if request_id == "req-confirm"),
            "got {out:?}"
        );
    }

    #[test]
    fn extension_ui_answer_frame_builds_the_response_per_method() {
        // select:input 的 value 原样回传(CLI 按 label 恒等匹配,自由文本兜底
        // 成选中项)。
        let frame = extension_ui_answer_frame(
            "select",
            "r1",
            Some(&serde_json::json!({ "部署到哪?": "prod" })),
        );
        assert_eq!(frame["type"], "extension_ui_response");
        assert_eq!(frame["id"], "r1");
        assert_eq!(frame["value"], "prod");

        // 自由文本同样走 value。
        let frame =
            extension_ui_answer_frame("editor", "r2", Some(&serde_json::json!({ "q": "随便" })));
        assert_eq!(frame["value"], "随便");

        // confirm 映射 confirmed 布尔。
        let yes = extension_ui_answer_frame(
            "confirm",
            "r3",
            Some(&serde_json::json!({ "q": CONFIRM_YES_LABEL })),
        );
        assert_eq!(yes["confirmed"], true);
        let no =
            extension_ui_answer_frame("confirm", "r3", Some(&serde_json::json!({ "q": "取消" })));
        assert_eq!(no["confirmed"], false);

        // 忽略 = cancelled。
        let cancel = extension_ui_answer_frame("select", "r4", None);
        assert_eq!(cancel["cancelled"], true);
    }

    #[test]
    fn rpc_chunks_reassemble_into_a_full_frame() {
        use base64::Engine as _;
        let engine = omp();
        let frame = serde_json::json!({
            "type": "extension_ui_request",
            "id": "chunked-1",
            "method": "input",
            "title": "大帧标题",
        })
        .to_string();
        let bytes = frame.as_bytes();
        let half = bytes.len() / 2;
        for (index, slice) in [(0, &bytes[..half]), (1, &bytes[half..])].into_iter() {
            let chunk = serde_json::json!({
                "type": "rpc_chunk",
                "chunkId": "c1",
                "index": index,
                "count": 2,
                "byteLength": slice.len(),
                "data": base64::engine::general_purpose::STANDARD.encode(slice),
            })
            .to_string();
            let mut out = Vec::new();
            engine.parse_line(&chunk, &mut out);
            if index == 0 {
                assert!(out.is_empty(), "mid-sequence events: {out:?}");
            } else {
                assert!(
                    matches!(&out[..], [EngineEvent::Question { request_id, .. }] if request_id == "chunked-1"),
                    "got {out:?}"
                );
            }
        }
    }

    #[test]
    #[ignore = "manual parser throughput benchmark"]
    fn benchmark_snapshot_updates() {
        let snapshot = serde_json::json!({"content": (0..200).map(|_| serde_json::json!({"type":"text", "text":"x".repeat(320)})).collect::<Vec<_>>()});
        let line = serde_json::json!({"type":"message_update", "message":snapshot, "assistantMessageEvent":{"type":"text_delta", "delta":"token", "partial":snapshot}}).to_string();
        let start = std::time::Instant::now();
        for _ in 0..1000 {
            std::hint::black_box(serde_json::from_str::<Value>(&line).unwrap());
        }
        let full = start.elapsed();
        let start = std::time::Instant::now();
        let mut out = Vec::new();
        for _ in 0..1000 {
            out.clear();
            parse_pi_family_line(&line, &mut out);
            std::hint::black_box(&out);
        }
        eprintln!(
            "1000 snapshot updates ({} bytes): full JSON {:?}, delta parser {:?}",
            line.len(),
            full,
            start.elapsed()
        );
    }

    #[test]
    fn tool_execution_start_carries_args_path() {
        let line = serde_json::json!({
            "type": "tool_execution_start",
            "toolCallId": "tool_1",
            "toolName": "edit",
            "args": { "path": "src/app.tsx", "input": {} },
            "intent": "Adding chrome token"
        })
        .to_string();
        let mut out = Vec::new();
        parse_pi_family_line(&line, &mut out);
        match &out[0] {
            EngineEvent::Message {
                role,
                text,
                path,
                args,
                ..
            } => {
                assert_eq!(role, "tool");
                assert_eq!(text, "edit · Adding chrome token");
                assert_eq!(path.as_deref(), Some("src/app.tsx"));
                assert_eq!(
                    args,
                    &Some(serde_json::json!({"path": "src/app.tsx", "input": {}}))
                );
            }
            _ => panic!("expected tool message"),
        }

        // bash-style args carry no path key -> None. No file chip, but the
        // command still lands in `args` for the expandable panel.
        let line = serde_json::json!({
            "type": "tool_execution_start",
            "toolCallId": "tool_2",
            "toolName": "bash",
            "args": { "command": "ls" }
        })
        .to_string();
        let mut out = Vec::new();
        parse_pi_family_line(&line, &mut out);
        match &out[0] {
            EngineEvent::Message { path, args, .. } => {
                assert_eq!(*path, None);
                assert_eq!(args, &Some(serde_json::json!({"command": "ls"})));
            }
            _ => panic!("expected tool message"),
        }
    }

    #[test]
    fn tool_execution_start_carries_todo_payload() {
        let line = serde_json::json!({
            "type": "tool_execution_start",
            "toolCallId": "tool_3",
            "toolName": "todo",
            "args": {
                "op": "init",
                "list": [
                    {"phase": "scaffold", "items": ["scan files", "write code"]}
                ]
            }
        })
        .to_string();
        let mut out = Vec::new();
        parse_pi_family_line(&line, &mut out);
        match &out[0] {
            EngineEvent::Message {
                todos: Some(todos), ..
            } => {
                assert!(todos.replace);
                assert_eq!(todos.items.len(), 2);
                assert_eq!(todos.items[0].content, "scan files");
                assert_eq!(todos.items[0].status, "pending");
                assert_eq!(todos.items[1].content, "write code");
                assert_eq!(todos.items[1].status, "pending");
            }
            _ => panic!("expected tool message with todos"),
        }

        // Non-todo tool args carry no payload.
        let line = serde_json::json!({
            "type": "tool_execution_start",
            "toolCallId": "tool_4",
            "toolName": "bash",
            "args": { "command": "ls" }
        })
        .to_string();
        let mut out = Vec::new();
        parse_pi_family_line(&line, &mut out);
        match &out[0] {
            EngineEvent::Message { todos, .. } => assert!(todos.is_none()),
            _ => panic!("expected tool message"),
        }
    }

    /// The live path's only reliable todo source for this tool. Two real
    /// gaps it covers: the start event carries no `args` for `todo` (so the
    /// list would stay stale until the session was reloaded), and a
    /// phase-wide `done` names a PHASE, which no task-keyed patch could
    /// apply. `abandoned` is omp's own spelling for a dropped task and must
    /// not read as still-to-do.
    #[test]
    fn tool_execution_end_carries_the_authoritative_todo_snapshot() {
        let line = serde_json::json!({
            "type": "tool_execution_end",
            "toolCallId": "tool_5",
            "toolName": "todo",
            "result": {
                "content": [{"type": "text", "text": "Remaining items (1)"}],
                "details": {
                    "phases": [
                        {"name": "scaffold", "tasks": [
                            {"content": "scan files", "status": "completed"},
                            {"content": "write code", "status": "running"}
                        ]},
                        {"name": "verify", "tasks": [
                            {"content": "run tests", "status": "pending"},
                            {"content": "update snapshots", "status": "abandoned"},
                            {"content": "await review", "status": "blocked", "blocker": "waiting on user"}
                        ]}
                    ],
                    "storage": "session"
                }
            }
        })
        .to_string();
        let mut out = Vec::new();
        parse_pi_family_line(&line, &mut out);
        match &out[0] {
            EngineEvent::Message {
                todos: Some(todos),
                patch,
                ..
            } => {
                // A full post-op list, not a delta: it replaces what the row holds.
                assert!(todos.replace);
                assert!(*patch, "must land on the in-flight todo row");
                let seen: Vec<(&str, &str)> = todos
                    .items
                    .iter()
                    .map(|i| (i.content.as_str(), i.status.as_str()))
                    .collect();
                assert_eq!(
                    seen,
                    [
                        ("scan files", "complete"),
                        ("write code", "active"),
                        ("run tests", "pending"),
                        ("update snapshots", "dropped"),
                        ("await review", "blocked"),
                    ]
                );
            }
            other => panic!("expected a todo snapshot patch, got {other:?}"),
        }

        // A non-todo tool's result carries no list.
        let line = serde_json::json!({
            "type": "tool_execution_end",
            "toolName": "bash",
            "result": {"content": [{"type": "text", "text": "ok"}]}
        })
        .to_string();
        let mut out = Vec::new();
        parse_pi_family_line(&line, &mut out);
        match &out[0] {
            EngineEvent::Message { todos, .. } => assert!(todos.is_none()),
            other => panic!("expected tool result patch, got {other:?}"),
        }
    }

    #[test]
    fn message_end_extracts_nested_error_shapes_as_warn() {
        for line in [
            serde_json::json!({"type":"message_end","message":{"errorMessage":"upstream 429"}}),
            serde_json::json!({"type":"message_end","errorMessage":"top-level 429"}),
            serde_json::json!({"type":"message_end","error":{"message":"nested 429"}}),
            serde_json::json!({"type":"message_end","message":{"error":"message.error 429"}}),
        ] {
            let mut out = Vec::new();
            parse_pi_family_line(&line.to_string(), &mut out);
            match out.last() {
                Some(EngineEvent::Warn(text)) => assert!(text.contains("429"), "{line}"),
                other => panic!("expected Warn for {line}, got {other:?}"),
            }
        }
    }

    #[test]
    fn turn_end_preserves_provisional_errors_from_all_shapes() {
        for line in [
            serde_json::json!({"type":"turn_end","errorMessage":"boom"}),
            serde_json::json!({"type":"turn_end","error":{"message":"nested boom"}}),
            // Real omp 401 shape: the failure nests in `message.errorMessage`
            // with stopReason=error on the enclosing message.
            serde_json::json!({"type":"turn_end","message":{"role":"assistant","stopReason":"error","errorStatus":401,"errorMessage":"401 Invalid token"}}),
        ] {
            let mut out = Vec::new();
            parse_pi_family_line(&line.to_string(), &mut out);
            match out.first() {
                Some(EngineEvent::AttemptEnd { error: Some(text) }) => {
                    assert!(text.contains("boom") || text.contains("401"), "{line}")
                }
                other => panic!("expected provisional error for {line}, got {other:?}"),
            }
        }
    }

    #[test]
    fn agent_end_after_error_does_not_emit_done() {
        // A terminal agent_end must preserve failure rather than emit Done.
        let line = serde_json::json!({
            "type":"agent_end",
            "message":{"stopReason":"error","errorMessage":"401 Invalid token"},
            "isTerminal":true
        })
        .to_string();
        let mut out = Vec::new();
        parse_pi_family_line(&line, &mut out);
        assert!(matches!(out[0], EngineEvent::Error(_)), "got {out:?}");
        assert!(
            !out.iter().any(|e| matches!(e, EngineEvent::Done { .. })),
            "Done leaked after Error: {out:?}"
        );

        // Healthy turn: agent_end without an error still settles with Done.
        let ok_line = serde_json::json!({"type":"agent_end","isTerminal":true}).to_string();
        let mut ok_out = Vec::new();
        parse_pi_family_line(&ok_line, &mut ok_out);
        assert!(
            matches!(ok_out[0], EngineEvent::Done { .. }),
            "got {ok_out:?}"
        );
    }

    #[test]
    fn failed_attempt_can_retry_before_the_agent_finishes() {
        // turn_end describes one model call, before the session decides
        // whether to retry. It must not cause the runner to kill the CLI.
        let lines = [
            serde_json::json!({"type":"message_end","message":{"role":"assistant","stopReason":"error","errorMessage":"socket closed unexpectedly"}}),
            serde_json::json!({"type":"turn_end","message":{"role":"assistant","stopReason":"error","errorMessage":"socket closed unexpectedly"}}),
            serde_json::json!({"type":"auto_retry_start","attempt":1,"maxAttempts":50,"errorMessage":"socket closed unexpectedly"}),
            serde_json::json!({"type":"agent_end","isTerminal":false,"messages":[{"role":"assistant","stopReason":"error","errorMessage":"socket closed unexpectedly"}]}),
            serde_json::json!({"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"recovered"}}),
            serde_json::json!({"type":"auto_retry_end","success":true,"attempt":1}),
        ];
        let mut out = Vec::new();
        for line in lines {
            parse_pi_family_line(&line.to_string(), &mut out);
        }
        assert!(
            !out.iter()
                .any(|event| matches!(event, EngineEvent::Error(_) | EngineEvent::Done { .. })),
            "retry was terminated: {out:?}"
        );
        assert!(out
            .iter()
            .any(|event| matches!(event, EngineEvent::Delta(text) if text == "recovered")));
    }

    #[test]
    fn terminal_agent_end_uses_the_last_assistant_result() {
        let mut out = Vec::new();
        parse_pi_family_line(
            &serde_json::json!({
                "type":"agent_end", "isTerminal":true,
                "messages":[
                    {"role":"assistant","stopReason":"stop","content":[]},
                    {"role":"assistant","stopReason":"error","errorMessage":"HTTP 502"},
                    {"role":"toolResult","content":[]}
                ]
            })
            .to_string(),
            &mut out,
        );
        assert!(
            matches!(out.as_slice(), [EngineEvent::Error(text)] if text == "HTTP 502"),
            "final error was lost: {out:?}"
        );

        out.clear();
        parse_pi_family_line(
            &serde_json::json!({
                "type":"agent_end", "isTerminal":true,
                "messages":[
                    {"role":"assistant","stopReason":"error","errorMessage":"HTTP 502"},
                    {"role":"assistant","stopReason":"stop","content":[]}
                ]
            })
            .to_string(),
            &mut out,
        );
        assert!(
            matches!(out.as_slice(), [EngineEvent::Done { .. }]),
            "recovered error leaked: {out:?}"
        );
    }

    #[test]
    fn exhausted_retry_settles_when_the_agent_finishes() {
        let mut out = Vec::new();
        for line in [
            serde_json::json!({"type":"auto_retry_end", "success":false,
                "attempt":50, "finalError":"socket closed unexpectedly"}),
            serde_json::json!({"type":"agent_end", "isTerminal":true,
                "messages":[{"role":"assistant", "stopReason":"error",
                    "errorMessage":"socket closed unexpectedly"}]}),
        ] {
            parse_pi_family_line(&line.to_string(), &mut out);
        }
        assert!(
            matches!(out.last(), Some(EngineEvent::Error(text)) if text == "socket closed unexpectedly"),
            "final failure was lost: {out:?}"
        );
        assert!(!out
            .iter()
            .any(|event| matches!(event, EngineEvent::Done { .. })));
    }

    #[test]
    fn build_command_passes_effort_through() {
        let engine = omp();
        let req = SendRequest {
            session_id: None,
            prompt: "hi".into(),
            images: vec![],
            workspace: std::path::PathBuf::from("/tmp"),
            model: None,
            effort: Some("ultra".into()),
            service_tier: None,
            permission: None,
            additional_dirs: vec![],
            provider_id: None,
            computer_use: None,
            allowed_tools: None,
        };
        let built = engine.build_command(&req, "omp").unwrap();
        let args: Vec<String> = built
            .command
            .as_std()
            .get_args()
            .map(|a| a.to_string_lossy().to_string())
            .collect();
        assert!(args.windows(2).any(|w| w == ["--thinking", "ultra"]));
    }

    #[test]
    fn build_command_injects_set_thinking_level_in_rpc_mode() {
        let engine = omp();
        let req = SendRequest {
            session_id: Some("s1".into()),
            prompt: "hi".into(),
            images: vec![],
            workspace: std::path::PathBuf::from("/tmp"),
            model: None,
            effort: Some("high".into()),
            service_tier: None,
            permission: None,
            additional_dirs: vec![],
            provider_id: None,
            computer_use: None,
            allowed_tools: None,
        };
        let built = engine.build_command(&req, "omp").unwrap();
        let payload = built.stdin_payload.expect("rpc stdin payload");
        let commands: Vec<serde_json::Value> = payload
            .lines()
            .map(|line| serde_json::from_str(line).expect("valid RPC command JSON"))
            .collect();
        assert_eq!(
            commands,
            vec![
                serde_json::json!({"id": "ccgui-negotiate", "type": "negotiate_protocol", "protocolVersion": 2}),
                serde_json::json!({"id": "ccgui-effort", "type": "set_thinking_level", "level": "high"}),
                serde_json::json!({"id": "ccgui-state", "type": "get_state"}),
                serde_json::json!({"id": "ccgui-prompt", "type": "prompt", "message": "hi"}),
            ]
        );
    }

    #[test]
    fn parse_thinking_level_changed_event() {
        let mut out = Vec::new();
        let line = serde_json::json!({
            "type": "thinking_level_changed",
            "thinkingLevel": "high"
        })
        .to_string();
        parse_pi_family_line(&line, &mut out);
        assert!(out
            .iter()
            .any(|e| matches!(e, EngineEvent::Effort(l) if l == "high")));
    }

    #[test]
    fn omp_build_command_includes_bridge_extension() {
        let engine = omp();
        let req = SendRequest {
            session_id: None,
            prompt: "hi".into(),
            images: vec![],
            workspace: std::path::PathBuf::from("/tmp"),
            model: None,
            effort: Some("high".into()),
            service_tier: None,
            permission: None,
            additional_dirs: vec![],
            provider_id: None,
            computer_use: None,
            allowed_tools: None,
        };
        let built = engine.build_command(&req, "omp").unwrap();
        let args: Vec<String> = built
            .command
            .as_std()
            .get_args()
            .map(|a| a.to_string_lossy().to_string())
            .collect();
        assert!(args
            .windows(2)
            .any(|w| w[0] == "--extension" && w[1].ends_with("ccgui-ask-bridge.ts")));
    }
}
