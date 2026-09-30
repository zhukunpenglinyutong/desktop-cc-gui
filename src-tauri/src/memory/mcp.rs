//! `memory` MCP 工具（计划 §8.2）。CLI 引擎（Claude Code / Codex / omp）把本模块
//! 当子进程拉起，模型通过它读写两个账本；应用内的直接运行与将来阶段 2b 的后台
//! 复盘可以不走 MCP、直接调 `super::add` 等函数，但写入闸与容量闸是同一条
//! （都在 super 里），不存在第二套规则。
//!
//! 绑定方式：进程参数 `--bot-id <id>`，或环境变量 `CCGUI_MEMORY_BOT`（omp 只从
//! 工作区 mcp.json 发现服务器，条目里不带 Bot id，靠父进程环境传下来；见
//! engine/pi_family.rs）。拿不到 Bot id 时 target=memory 的调用直接拒绝——
//! 宁可不写，也不能把 A 的笔记写进 B 或全局。

use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::{
    CallToolResult, ContentBlock, ErrorData as McpError, Implementation, ServerCapabilities,
    ServerConfig,
};
use rmcp::{schemars, tool, tool_handler, tool_router, ServerHandler, ServiceExt};
use serde::Serialize;
use std::sync::Arc;

use super::pending::{gated, WriteOp, WriteOutcome};
use super::{list, used_chars, Target};
use crate::db::Db;

/// 环境变量名：omp 注入的工作区 mcp.json 不带每次运行的 Bot id，靠父 CLI 进程
/// 继承下来的这个变量把身份带进 MCP 子进程。
pub const BOT_ENV: &str = "CCGUI_MEMORY_BOT";

/// MCP 服务器名。claude/codex 的挂载与 preapprove（`mcp__ccgui-memory`）都以
/// 它为准。
pub const SERVER_NAME: &str = "ccgui-memory";

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct MemoryParams {
    /// One of: "add" | "replace" | "remove".
    action: String,
    /// "memory" = this bot's own notes; "user" = the global user profile
    /// shared by every bot. Preferences and habits go to "user"; project
    /// facts, corrections and pitfalls go to "memory".
    target: String,
    /// The full new entry text. Required for add and replace (replace swaps
    /// the whole entry, so this must be the complete new wording).
    #[serde(default)]
    content: Option<String>,
    /// A substring that uniquely identifies one existing entry. Required for
    /// replace and remove; if it matches several entries, make it longer.
    #[serde(default)]
    old_text: Option<String>,
}

#[derive(Debug, Serialize)]
struct ToolResult {
    success: bool,
    /// "1474/2200" — current ledger usage after the call (or at refusal).
    usage: String,
    /// The write went into the approval queue instead of the ledger (the
    /// bot's 写入需要审批 switch). The model must NOT retry it: usage is
    /// unchanged until the user approves.
    #[serde(skip_serializing_if = "is_false")]
    pending: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    /// On a capacity refusal the current entries are handed back so the model
    /// can merge or remove and retry in the same turn (plan §8.2). Never
    /// truncated, never silently dropped.
    #[serde(skip_serializing_if = "Option::is_none")]
    current_entries: Option<Vec<String>>,
}

fn is_false(value: &bool) -> bool {
    !*value
}

pub struct MemoryServer {
    db: Arc<Db>,
    /// Bot this session belongs to; empty when neither arg nor env named one.
    bot_id: String,
    /// 写入是否转待审批（这个 Bot 的「写入需要审批」开关）。构造时读一次：
    /// 进程每次发送都会重新拉起，用户改了开关下一轮就生效。
    write_approval: bool,
}

impl MemoryServer {
    fn target(&self, raw: &str) -> Result<Target, String> {
        // Fail closed without an identity: a server injected by a concurrent
        // run in the same workspace could otherwise write USER notes for a
        // session the app never opted in. 同工作区的另一个会话可能共享这个
        // 文件，靠环境变量区分；拿不到就别写。
        if self.bot_id.is_empty() {
            return Err(
                "this session is not bound to a bot; the memory tool is unavailable".into(),
            );
        }
        Target::parse(raw).map_err(|error| error.message)
    }

    fn bot_scope(&self) -> Option<&str> {
        (!self.bot_id.is_empty()).then_some(self.bot_id.as_str())
    }

    fn usage(&self, target: Target) -> Result<String, String> {
        let bot_id = match target {
            Target::User => super::GLOBAL_BOT_ID,
            Target::Memory => self.bot_id.as_str(),
        };
        let entries = list(&self.db, target, bot_id).map_err(|error| error.message)?;
        let limit = super::ledger_limit(target, bot_id);
        Ok(format!("{}/{}", used_chars(&entries), limit))
    }

    fn entries(&self, target: Target) -> Result<Vec<String>, String> {
        let bot_id = match target {
            Target::User => super::GLOBAL_BOT_ID,
            Target::Memory => self.bot_id.as_str(),
        };
        Ok(list(&self.db, target, bot_id)
            .map_err(|error| error.message)?
            .into_iter()
            .map(|entry| entry.content)
            .collect())
    }

    fn run(&self, params: &MemoryParams) -> ToolResult {
        match self.run_inner(params) {
            Ok(applied) => ToolResult {
                success: true,
                usage: applied.usage,
                pending: applied.pending,
                error: None,
                current_entries: None,
            },
            Err(failure) => {
                // A capacity refusal hands the ledger back; other failures
                // (scan, no match) carry just the reason.
                let current_entries = if failure.over_limit {
                    self.entries(failure.target).ok()
                } else {
                    None
                };
                let usage = self
                    .usage(failure.target)
                    .unwrap_or_else(|error| format!("unknown ({error})"));
                ToolResult {
                    success: false,
                    usage,
                    pending: false,
                    error: Some(failure.message),
                    current_entries,
                }
            }
        }
    }

    /// One successful call: the usage line plus whether it landed in the
    /// approval queue (usage then is the unchanged ledger).
    fn run_inner(&self, params: &MemoryParams) -> Result<Applied, Failure> {
        let target = self.target(&params.target).map_err(|message| Failure {
            target: Target::Memory,
            over_limit: false,
            message,
        })?;
        let outcome = match params.action.as_str() {
            "add" => {
                let content = params.content.as_deref().ok_or_else(|| Failure {
                    target,
                    over_limit: false,
                    message: "add requires content".into(),
                })?;
                gated(
                    &self.db,
                    target,
                    self.bot_scope(),
                    self.write_approval,
                    WriteOp::Add { content },
                    "agent",
                )
                .map_err(|error| Failure::from(error, target))?
            }
            "replace" => {
                let old_text = params.old_text.as_deref().ok_or_else(|| Failure {
                    target,
                    over_limit: false,
                    message: "replace requires old_text".into(),
                })?;
                let content = params.content.as_deref().ok_or_else(|| Failure {
                    target,
                    over_limit: false,
                    message: "replace requires content (the full new entry)".into(),
                })?;
                gated(
                    &self.db,
                    target,
                    self.bot_scope(),
                    self.write_approval,
                    WriteOp::Replace { old_text, content },
                    "agent",
                )
                .map_err(|error| Failure::from(error, target))?
            }
            "remove" => {
                let old_text = params.old_text.as_deref().ok_or_else(|| Failure {
                    target,
                    over_limit: false,
                    message: "remove requires old_text".into(),
                })?;
                gated(
                    &self.db,
                    target,
                    self.bot_scope(),
                    self.write_approval,
                    WriteOp::Remove { old_text },
                    "agent",
                )
                .map_err(|error| Failure::from(error, target))?
            }
            other => {
                return Err(Failure {
                    target,
                    over_limit: false,
                    message: format!("unknown action \"{other}\" (expected add|replace|remove)"),
                })
            }
        };
        let usage = self.usage(target).map_err(|message| Failure {
            target,
            over_limit: false,
            message,
        })?;
        Ok(Applied {
            usage,
            pending: matches!(outcome, WriteOutcome::Staged { .. }),
        })
    }
}

/// A successful tool call: the usage line and whether it was queued.
struct Applied {
    usage: String,
    pending: bool,
}

/// 写入失败 + 是否属于容量问题（决定要不要把当前条目带回去）。
struct Failure {
    target: Target,
    over_limit: bool,
    message: String,
}

impl Failure {
    fn from(error: super::MemoryError, target: Target) -> Self {
        Self {
            target,
            over_limit: error.code == "limit",
            message: error.message,
        }
    }
}

fn text_result(result: ToolResult) -> Result<CallToolResult, McpError> {
    let text = serde_json::to_string(&result)
        .unwrap_or_else(|error| format!("{{\"success\":false,\"error\":\"serialize: {error}\"}}"));
    let block = ContentBlock::text(text);
    Ok(if result.success {
        CallToolResult::success(vec![block])
    } else {
        CallToolResult::error(vec![block])
    })
}

#[tool_router]
impl MemoryServer {
    #[tool(description = "Read and write persistent memory across sessions. \
        Call this proactively, without waiting to be asked: when the user states a preference or habit \
        (target=user); when the user corrects you, or you hit an error and found the fix, or a durable \
        project/environment fact emerged (target=memory). Do not save trivia, public knowledge, large \
        code or logs, session-only details, anything already in the personality/working-rules, or any \
        credential. Entries have a character budget: a write that would exceed it is refused with the \
        current entries — merge or remove first, then retry. Saying \"I'll remember that\" saves nothing; \
        only this tool writes memory. When the reply carries pending=true, the write is waiting for \
        the user's approval: report it as queued and do not retry it.")]
    fn memory(
        &self,
        Parameters(params): Parameters<MemoryParams>,
    ) -> Result<CallToolResult, McpError> {
        text_result(self.run(&params))
    }
}

#[tool_handler]
impl ServerHandler for MemoryServer {
    fn get_info(&self) -> ServerConfig {
        let mut info = ServerConfig::default();
        info.capabilities = ServerCapabilities::builder().enable_tools().build();
        let mut implementation = Implementation::from_build_env();
        implementation.name = SERVER_NAME.into();
        implementation.version = env!("CARGO_PKG_VERSION").into();
        info.server_info = implementation;
        info.instructions = Some(
            "Persistent memory for this bot. Write with the memory tool as soon as something durable \
             appears in the conversation — a stated preference, a correction, a solved pitfall, an \
             environment fact. Never store credentials."
                .into(),
        );
        info
    }
}

fn spec_with(args: Vec<String>) -> Result<crate::computer_use::McpServerSpec, String> {
    let exe = std::env::current_exe().map_err(|e| format!("resolve own exe for memory: {e}"))?;
    Ok(crate::computer_use::McpServerSpec {
        name: SERVER_NAME.to_string(),
        command: exe.to_string_lossy().into_owned(),
        args,
        env: Vec::new(),
    })
}

/// 注入式挂载（omp 的工作区 `.omp/mcp.json`）：文档里不带每次运行的 Bot
/// id，身份由父进程的 [`BOT_ENV`] 继承给子进程（见 engine/pi_family.rs）。
pub fn server_spec() -> Result<crate::computer_use::McpServerSpec, String> {
    spec_with(vec!["--memory-mcp".to_string()])
}

/// 参数式挂载（claude 的 --mcp-config / codex 的 -c）：Bot id 直接写进 argv。
pub fn bound_spec(bot_id: &str) -> Result<crate::computer_use::McpServerSpec, String> {
    spec_with(vec![
        "--memory-mcp".to_string(),
        "--bot-id".to_string(),
        bot_id.to_string(),
    ])
}

/// 从进程参数 / 环境变量解析绑定的 Bot id。
fn bound_bot_id(args: impl IntoIterator<Item = String>) -> String {
    let mut args = args.into_iter();
    while let Some(arg) = args.next() {
        if arg == "--bot-id" {
            if let Some(value) = args.next() {
                let trimmed = value.trim();
                if !trimmed.is_empty() {
                    return trimmed.to_string();
                }
            }
        }
    }
    std::env::var(BOT_ENV)
        .map(|value| value.trim().to_string())
        .unwrap_or_default()
}

/// stdio 上服务直到父 CLI 关闭通道。stdout 只走协议帧，诊断一律 stderr。
pub fn serve_stdio() -> Result<(), String> {
    let bot_id = bound_bot_id(std::env::args());
    if bot_id.is_empty() {
        eprintln!("[memory] no bot bound (--bot-id / {BOT_ENV}); target=memory will be refused");
    }
    let db = Arc::new(Db::open().map_err(|e| format!("open app db: {e}"))?);
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| format!("start MCP runtime: {e}"))?;
    let write_approval = crate::bots::memory_write_approval(&bot_id);
    runtime.block_on(async move {
        let server = MemoryServer {
            db,
            bot_id,
            write_approval,
        }
            .serve(rmcp::transport::stdio())
            .await
            .map_err(|e| format!("MCP initialize: {e}"))?;
        server
            .waiting()
            .await
            .map_err(|e| format!("MCP serve: {e}"))
            .map(|_| ())
    })
}

#[cfg(test)]
mod tests;
