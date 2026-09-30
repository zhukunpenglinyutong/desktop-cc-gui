//! 持久记忆（计划 §8）：两个账本、写入前的一道闸、下一次会话注入。
//!
//! - 账本一：每个 Bot 一份 MEMORY（`target='memory'`），上限取该 Bot 的
//!   `memoryCharLimit`（默认 2,200 字）。
//! - 账本二：全局共用一份 USER（`target='user'`），上限 1,375 字。所有 Bot
//!   面对同一个用户，不应该让用户对每个 Bot 重复介绍自己。
//!
//! 写入只有三条路径——记忆面板的手动增改、`memory` MCP 工具（CLI 引擎里的
//! 模型调用）、以及将来的后台复盘——全部走这里同一套 `add`/`replace`/
//! `remove`：先过安全扫描，再查容量，重复条目直接返回成功。超限时**拒绝**
//! 并附上当前用量，由调用方合并后重试，绝不截断或静默丢弃（计划 §8.2）。
//!
//! 存储是独立的 `memory_entries` 表而不是 Bot 目录里的文件：USER 是全局的、
//! MCP 子进程要在主进程之外读写、将来按来源会话回溯，这些都是表比文件自然。

pub mod commands;
pub mod mcp;
pub mod pending;
pub mod review;
pub mod scan;
pub mod store;
#[cfg(test)]
mod tests;

use serde::Serialize;

use crate::db::Db;

/// 全局用户画像的字数上限（计划 §8.1）。
pub const USER_LIMIT: usize = 1375;
/// Bot 自己的笔记没有配置时的默认上限。
pub const DEFAULT_MEMORY_LIMIT: usize = 2200;
/// USER 账本不属于任何 Bot；数据库里以空 bot_id 表示。
pub const GLOBAL_BOT_ID: &str = "";

/// 一条记忆属于哪个账本。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Target {
    Memory,
    User,
}

impl Target {
    pub fn parse(raw: &str) -> Result<Self, MemoryError> {
        match raw {
            "memory" => Ok(Self::Memory),
            "user" => Ok(Self::User),
            other => Err(MemoryError::new(
                "bad_target",
                format!("unknown memory target: {other}"),
            )),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Memory => "memory",
            Self::User => "user",
        }
    }
}

/// 写入被退回时的结构化原因。前端按 `code` 本地化，`message` 说明具体细节
/// （也原样交给模型，让它改写后重试）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryError {
    pub code: &'static str,
    pub message: String,
    /// 安全扫描命中时，`injection` | `secret` | `invisible`。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    /// 超限时带上账本当前用量与上限。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub used: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<usize>,
}

impl MemoryError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            kind: None,
            used: None,
            limit: None,
        }
    }

    pub fn with_scan(mut self, rejection: &scan::ScanRejection) -> Self {
        self.kind = Some(rejection.kind.to_string());
        self
    }

    pub fn with_usage(mut self, used: usize, limit: usize) -> Self {
        self.used = Some(used);
        self.limit = Some(limit);
        self
    }
}

/// 落盘后的一条记忆。
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MemoryEntry {
    pub id: String,
    pub target: String,
    pub bot_id: String,
    pub content: String,
    /// `user`（手动写入）| `agent`（memory 工具写入）。
    pub source: String,
    pub created_at: i64,
    pub updated_at: i64,
}

/// 一个账本的当前状态：条目 + 注入时会用掉多少字。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryLedger {
    pub target: String,
    pub bot_id: String,
    pub entries: Vec<MemoryEntry>,
    /// 把条目渲染成 `- 内容` 行之后的字符数：注入提示词时实际占用的额度。
    pub used: usize,
    pub limit: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryView {
    /// 当前 Bot 的 MEMORY；没有选中 Bot 时为 None。
    pub memory: Option<MemoryLedger>,
    pub user: MemoryLedger,
    /// 等待用户批准的写入（这个 Bot 的 MEMORY + 全局 USER）。
    pub pending: Vec<pending::PendingWrite>,
}

/// 删除一个 Bot 时清掉它的 MEMORY 与待审批写入（USER 是全局的，不动）。
/// 两条存储各删各的，这里合成一个入口，调用方不会漏掉队列。
pub fn forget_bot(db: &Db, bot_id: &str) -> Result<usize, MemoryError> {
    let entries = store::forget_bot(db, bot_id)?;
    pending::forget_bot(db, bot_id)?;
    Ok(entries)
}

pub use store::{
    add, clear, ledger, ledger_limit, list, remove, remove_by_id, render, replace, update,
    used_chars, view,
};
