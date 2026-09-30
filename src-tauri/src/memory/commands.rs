//! Tauri 命令入口（设置 → 智能体 → 记忆页签）。与 MCP 工具共用 mod.rs 里的
//! 同一套 `add` / `update` / `remove` / `clear`：命令层不加规则，只把 IPC 参数
//! 翻译成类型（target 字符串）并透传结构化错误。

use std::sync::Arc;
use tauri::State;

use super::pending::{self, PendingWrite, WriteOutcome};
use super::review::{self, ReviewOutcome};
use super::{add, clear, remove_by_id, update, view, MemoryEntry, MemoryError, MemoryView, Target};
use crate::db::Db;

#[tauri::command]
pub fn memory_list(
    db: State<'_, Arc<Db>>,
    bot_id: Option<String>,
) -> Result<MemoryView, MemoryError> {
    view(&db, bot_id.as_deref())
}

/// 面板手动新增。`source` 固定为 `user`：区分「人写的」和「模型写的」，
/// 面板上可以标注来源，复盘与工具写入走 `agent`。
#[tauri::command]
pub fn memory_add(
    db: State<'_, Arc<Db>>,
    bot_id: Option<String>,
    target: String,
    content: String,
) -> Result<MemoryEntry, MemoryError> {
    let target = Target::parse(&target)?;
    let (entry, _created) = add(&db, target, bot_id.as_deref(), &content, "user")?;
    Ok(entry)
}

#[tauri::command]
pub fn memory_update(
    db: State<'_, Arc<Db>>,
    id: String,
    content: String,
) -> Result<MemoryEntry, MemoryError> {
    update(&db, &id, &content)
}

#[tauri::command]
pub fn memory_remove(db: State<'_, Arc<Db>>, id: String) -> Result<(), MemoryError> {
    remove_by_id(&db, &id)
}

#[tauri::command]
pub fn memory_clear(
    db: State<'_, Arc<Db>>,
    bot_id: Option<String>,
    target: String,
) -> Result<usize, MemoryError> {
    let target = Target::parse(&target)?;
    clear(&db, target, bot_id.as_deref())
}

/// 批准一条待审批写入并落盘。失败（超限 / 暂存后原文已变 / 扫描）时条目
/// 保留在队列里，错误就地交给面板展示——批准是用户看过内容后的明确动作，
/// 不能悄悄丢掉。
#[tauri::command]
pub fn memory_pending_approve(
    db: State<'_, Arc<Db>>,
    id: String,
) -> Result<WriteOutcome, MemoryError> {
    pending::approve(&db, &id)
}

/// 驳回一条待审批写入；内容不再落盘。
#[tauri::command]
pub fn memory_pending_reject(
    db: State<'_, Arc<Db>>,
    id: String,
) -> Result<PendingWrite, MemoryError> {
    pending::reject(&db, &id)
}

/// 后台复盘：会话结束（或每 N 轮）时用渠道跑一次模型调用，整理本轮对话。
/// 复盘失败的细节都收在 `ReviewOutcome` 里返回（不是命令错误）：界面据此
/// 说明「跳过 / 失败」的原因，Err 只留给真正的系统级错误。
#[tauri::command]
pub async fn memory_review(
    db: State<'_, Arc<Db>>,
    bot_id: String,
    engine: String,
    provider_id: Option<String>,
    model: Option<String>,
    transcript: String,
) -> Result<ReviewOutcome, String> {
    Ok(review::review(
        &db,
        &bot_id,
        &engine,
        provider_id.as_deref(),
        model.as_deref(),
        &transcript,
    )
    .await)
}
