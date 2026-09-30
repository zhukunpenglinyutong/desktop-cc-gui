//! 待审批写入（「写入需要审批」开关）：模型工具与后台复盘的写入先转成待审批，
//! 用户在记忆面板里批准才真正落盘。面板手动写入永远直接落盘——审批的对象是
//! 模型，不是用户自己。
//!
//! 暂存时就把确定性的错误挡掉（空内容 / 安全扫描 / old_text 匹配不到或匹配
//! 多条），模型在当轮就能拿到原因改写；只有「审批时条目已变」和「审批时超限」
//! 留到批准那一刻判断，因为这两件事在暂存之后仍可能发生。批准走的是 store 里
//! 同一套 add/update/remove_by_id，所以容量闸与扫描在落盘前会再过一遍。

use rusqlite::OptionalExtension;
use serde::Serialize;

use super::store;
use super::{add, remove_by_id, update, MemoryEntry, MemoryError, Target};
use crate::db::Db;

pub const OP_ADD: &str = "add";
pub const OP_REPLACE: &str = "replace";
pub const OP_REMOVE: &str = "remove";

/// 一条等待用户批准的写入。`content`/`old_text` 的必填组合与记忆工具一致：
/// add 要 content，replace 两个都要，remove 只要 old_text。
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PendingWrite {
    pub id: String,
    /// `add` | `replace` | `remove`
    pub op: String,
    pub target: String,
    pub bot_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_text: Option<String>,
    /// 暂存时锁定的条目 id（replace/remove）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_entry_id: Option<String>,
    /// 暂存时目标条目的原文；审批时原文已变就拒绝执行，不覆盖用户的编辑。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_snapshot: Option<String>,
    /// `agent`（记忆工具）| `review`（后台复盘）。
    pub origin: String,
    pub created_at: i64,
}

/// 一次写入的结果：直接落盘，或转成待审批。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum WriteOutcome {
    Applied {
        /// remove 成功时没有条目。
        entry: Option<MemoryEntry>,
        created: bool,
    },
    Staged {
        pending: PendingWrite,
    },
}

fn row_to_pending(row: &rusqlite::Row<'_>) -> rusqlite::Result<PendingWrite> {
    Ok(PendingWrite {
        id: row.get(0)?,
        op: row.get(1)?,
        target: row.get(2)?,
        bot_id: row.get(3)?,
        content: row.get(4)?,
        old_text: row.get(5)?,
        target_entry_id: row.get(6)?,
        target_snapshot: row.get(7)?,
        origin: row.get(8)?,
        created_at: row.get(9)?,
    })
}

const SELECT_COLUMNS: &str =
    "id, op, target, bot_id, content, old_text, target_entry_id, target_snapshot, origin, created_at";

/// 已有一条完全相同的待审批时返回它：模型重试同一次写入不该在队列里堆出
/// 一串一模一样、要逐条批准的项目。
fn find_same(
    db: &Db,
    target: &str,
    bot_id: &str,
    op: &str,
    content: Option<&str>,
    old_text: Option<&str>,
) -> Result<Option<PendingWrite>, MemoryError> {
    let conn = db.0.lock();
    conn.query_row(
        &format!(
            "SELECT {SELECT_COLUMNS} FROM pending_memory_writes
             WHERE target=?1 AND bot_id=?2 AND op=?3
               AND content IS ?4 AND old_text IS ?5"
        ),
        rusqlite::params![target, bot_id, op, content, old_text],
        row_to_pending,
    )
    .optional()
    .map_err(|e| MemoryError::new("db", e.to_string()))
}

/// 把一次写入转成待审批。确定性问题（空 / 扫描 / 匹配不到）在这里就报错，
/// 队列里不会出现一个批准时注定失败的条目。
pub fn stage(
    db: &Db,
    target: Target,
    bot_id: Option<&str>,
    op: &str,
    content: Option<&str>,
    old_text: Option<&str>,
    origin: &str,
) -> Result<PendingWrite, MemoryError> {
    let (db_target, db_bot) = store::scope(target, bot_id)?;
    let (content, old_text) = match op {
        OP_ADD => (
            Some(store::clean(content.ok_or_else(|| {
                MemoryError::new("empty", "add requires content")
            })?)?),
            None,
        ),
        OP_REPLACE => {
            let content = store::clean(content.ok_or_else(|| {
                MemoryError::new("empty", "replace requires content (the full new entry)")
            })?)?;
            let old_text = old_text.ok_or_else(|| {
                MemoryError::new("no_match", "replace requires old_text")
            })?;
            (Some(content), Some(old_text.trim().to_string()))
        }
        OP_REMOVE => (
            None,
            Some(
                old_text
                    .ok_or_else(|| MemoryError::new("no_match", "remove requires old_text"))?
                    .trim()
                    .to_string(),
            ),
        ),
        other => {
            return Err(MemoryError::new(
                "bad_op",
                format!("unknown memory op: {other}"),
            ))
        }
    };

    // replace / remove：在这一刻就锁定目标条目并记下原文。之后条目被改，
    // 批准时会因快照不一致而拒绝（见 approve）。
    let (target_entry_id, target_snapshot) = match op {
        OP_ADD => (None, None),
        _ => {
            let needle = old_text.as_deref().unwrap_or_default();
            let (entry, _) = store::match_one(db, target, bot_id, needle)?;
            (Some(entry.id), Some(entry.content))
        }
    };

    if let Some(existing) = find_same(
        db,
        &db_target,
        &db_bot,
        op,
        content.as_deref(),
        old_text.as_deref(),
    )? {
        return Ok(existing);
    }

    let pending = PendingWrite {
        id: uuid::Uuid::new_v4().to_string(),
        op: op.to_string(),
        target: db_target.clone(),
        bot_id: db_bot.clone(),
        content,
        old_text,
        target_entry_id,
        target_snapshot,
        origin: origin.to_string(),
        created_at: store::now_ms(),
    };
    let conn = db.0.lock();
    conn.execute(
        "INSERT INTO pending_memory_writes
             (id, op, target, bot_id, content, old_text, target_entry_id, target_snapshot, origin, created_at)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        rusqlite::params![
            pending.id,
            pending.op,
            pending.target,
            pending.bot_id,
            pending.content,
            pending.old_text,
            pending.target_entry_id,
            pending.target_snapshot,
            pending.origin,
            pending.created_at
        ],
    )
    .map_err(|e| MemoryError::new("db", e.to_string()))?;
    Ok(pending)
}

/// 面板看到的待审批列表：这个 Bot 的 MEMORY 写入 + 全局 USER 写入（USER 没有
/// 主人，任何 Bot 的面板都能批准它）。`bot_id` 为空时只有 USER。
pub fn list(db: &Db, bot_id: Option<&str>) -> Result<Vec<PendingWrite>, MemoryError> {
    let conn = db.0.lock();
    let rows = match bot_id.map(str::trim).filter(|id| !id.is_empty()) {
        Some(id) => {
            let mut stmt = conn
                .prepare(&format!(
                    "SELECT {SELECT_COLUMNS} FROM pending_memory_writes
                     WHERE (target='memory' AND bot_id=?1) OR target='user'
                     ORDER BY created_at ASC, rowid ASC"
                ))
                .map_err(|e| MemoryError::new("db", e.to_string()))?;
            let rows = stmt
                .query_map([id], row_to_pending)
                .map_err(|e| MemoryError::new("db", e.to_string()))?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
        }
        None => {
            let mut stmt = conn
                .prepare(&format!(
                    "SELECT {SELECT_COLUMNS} FROM pending_memory_writes
                     WHERE target='user' ORDER BY created_at ASC, rowid ASC"
                ))
                .map_err(|e| MemoryError::new("db", e.to_string()))?;
            let rows = stmt
                .query_map([], row_to_pending)
                .map_err(|e| MemoryError::new("db", e.to_string()))?;
            rows.collect::<rusqlite::Result<Vec<_>>>()
        }
    };
    rows.map_err(|e| MemoryError::new("db", e.to_string()))
}

fn find_by_id(db: &Db, id: &str) -> Result<PendingWrite, MemoryError> {
    let conn = db.0.lock();
    conn.query_row(
        &format!("SELECT {SELECT_COLUMNS} FROM pending_memory_writes WHERE id=?1"),
        [id],
        row_to_pending,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            MemoryError::new("not_found", format!("pending write not found: {id}"))
        }
        other => MemoryError::new("db", other.to_string()),
    })
}

fn delete(db: &Db, id: &str) -> Result<(), MemoryError> {
    let conn = db.0.lock();
    let changed = conn
        .execute("DELETE FROM pending_memory_writes WHERE id=?1", [id])
        .map_err(|e| MemoryError::new("db", e.to_string()))?;
    if changed == 0 {
        return Err(MemoryError::new(
            "not_found",
            format!("pending write not found: {id}"),
        ));
    }
    Ok(())
}

/// 批准时目标条目还在、且原文没被改过才执行。返回 `stale` 而不是覆盖：
/// 暂存之后用户可能手动改过这条，模型的旧计划已经过期。
fn ensure_unchanged(db: &Db, pending: &PendingWrite) -> Result<(), MemoryError> {
    let Some(expected) = pending.target_snapshot.as_deref() else {
        return Ok(());
    };
    let Some(entry_id) = pending.target_entry_id.as_deref() else {
        return Ok(());
    };
    let conn = db.0.lock();
    let current: Option<String> = conn
        .query_row(
            "SELECT content FROM memory_entries WHERE id=?1",
            [entry_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| MemoryError::new("db", e.to_string()))?;
    match current {
        Some(content) if content == expected => Ok(()),
        Some(_) => Err(MemoryError::new(
            "stale",
            "the target entry changed after this write was queued; reject and ask the model again",
        )),
        None => Err(MemoryError::new(
            "stale",
            "the target entry no longer exists; reject this write",
        )),
    }
}

/// 执行一条待审批。成功才从队列删除；失败（超限 / 原文已变 / 扫描）保留条目，
/// 面板就地展示原因，用户可以驳回或修改后重试。
pub fn approve(db: &Db, id: &str) -> Result<WriteOutcome, MemoryError> {
    let pending = find_by_id(db, id)?;
    let target = Target::parse(&pending.target)?;
    // USER 的写入不属于任何 Bot，但开关是当初发起写入的那个 Bot 的。
    let bot_id = (!pending.bot_id.is_empty()).then_some(pending.bot_id.as_str());
    let outcome = match pending.op.as_str() {
        OP_ADD => {
            let content = pending.content.as_deref().ok_or_else(|| {
                MemoryError::new("empty", "queued add is missing content")
            })?;
            let (entry, created) = add(db, target, bot_id, content, &pending.origin)?;
            WriteOutcome::Applied {
                entry: Some(entry),
                created,
            }
        }
        OP_REPLACE => {
            let content = pending.content.as_deref().ok_or_else(|| {
                MemoryError::new("empty", "queued replace is missing content")
            })?;
            ensure_unchanged(db, &pending)?;
            let entry_id = pending.target_entry_id.as_deref().ok_or_else(|| {
                MemoryError::new("stale", "queued replace has no target entry")
            })?;
            let entry = update(db, entry_id, content)?;
            WriteOutcome::Applied {
                entry: Some(entry),
                created: false,
            }
        }
        OP_REMOVE => {
            ensure_unchanged(db, &pending)?;
            let entry_id = pending.target_entry_id.as_deref().ok_or_else(|| {
                MemoryError::new("stale", "queued remove has no target entry")
            })?;
            remove_by_id(db, entry_id)?;
            WriteOutcome::Applied {
                entry: None,
                created: false,
            }
        }
        other => {
            return Err(MemoryError::new(
                "bad_op",
                format!("unknown queued memory op: {other}"),
            ))
        }
    };
    delete(db, id)?;
    Ok(outcome)
}

/// 驳回一条待审批，返回被丢掉的内容（面板可以据此提示）。
pub fn reject(db: &Db, id: &str) -> Result<PendingWrite, MemoryError> {
    let pending = find_by_id(db, id)?;
    delete(db, id)?;
    Ok(pending)
}

/// 删除一个 Bot 时清掉它的待审批 MEMORY 写入（USER 是全局的，保留）。
pub fn forget_bot(db: &Db, bot_id: &str) -> Result<usize, MemoryError> {
    let conn = db.0.lock();
    conn.execute(
        "DELETE FROM pending_memory_writes WHERE target='memory' AND bot_id=?1",
        [bot_id],
    )
    .map_err(|e| MemoryError::new("db", e.to_string()))
}

/// 模型 / 复盘的一次写入动作（面板手动写入不走闸，没有这个枚举的入口）。
pub(crate) enum WriteOp<'a> {
    Add { content: &'a str },
    Replace { old_text: &'a str, content: &'a str },
    Remove { old_text: &'a str },
}

/// 写入闸的统一实现：`approval` 由调用方从 Bot 配置读一次传进来（工具进程
/// 每次发送都会重启，设置改了下一轮就生效；复盘一次运行内保持同一开关）。
/// 面板手动写入（source=user）不经过这里。
pub(crate) fn gated(
    db: &Db,
    target: Target,
    bot_id: Option<&str>,
    approval: bool,
    op: WriteOp<'_>,
    source: &str,
) -> Result<WriteOutcome, MemoryError> {
    if approval {
        let pending = match op {
            WriteOp::Add { content } => {
                stage(db, target, bot_id, OP_ADD, Some(content), None, source)?
            }
            WriteOp::Replace { old_text, content } => {
                stage(db, target, bot_id, OP_REPLACE, Some(content), Some(old_text), source)?
            }
            WriteOp::Remove { old_text } => {
                stage(db, target, bot_id, OP_REMOVE, None, Some(old_text), source)?
            }
        };
        return Ok(WriteOutcome::Staged { pending });
    }
    match op {
        WriteOp::Add { content } => {
            let (entry, created) = add(db, target, bot_id, content, source)?;
            Ok(WriteOutcome::Applied {
                entry: Some(entry),
                created,
            })
        }
        WriteOp::Replace { old_text, content } => {
            let entry = super::replace(db, target, bot_id, old_text, content)?;
            Ok(WriteOutcome::Applied {
                entry: Some(entry),
                created: false,
            })
        }
        WriteOp::Remove { old_text } => {
            super::remove(db, target, bot_id, old_text)?;
            Ok(WriteOutcome::Applied {
                entry: None,
                created: false,
            })
        }
    }
}

#[cfg(test)]
mod tests;
