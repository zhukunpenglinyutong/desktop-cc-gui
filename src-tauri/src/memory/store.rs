//! 两个账本的读写（mod.rs 的 `add`/`replace`/`remove` 是唯一写入口，MCP 工具
//! 与 IPC 命令都从这里走）。规则与容量闸在 mod.rs，这里只管落库、匹配与作用域。

use rusqlite::OptionalExtension;

use super::{
    scan, MemoryEntry, MemoryError, MemoryLedger, MemoryView, Target, DEFAULT_MEMORY_LIMIT,
    GLOBAL_BOT_ID, USER_LIMIT,
};
use crate::db::Db;

pub(crate) fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 注入时的渲染：每条一行。写入上限与提示词注入共用这一个函数，界面上显示的
/// 用量就是模型真正读到的字符数。
pub fn render(entries: &[MemoryEntry]) -> String {
    entries
        .iter()
        .map(|entry| format!("- {}", entry.content))
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn used_chars(entries: &[MemoryEntry]) -> usize {
    render(entries).chars().count()
}

fn row_to_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<MemoryEntry> {
    Ok(MemoryEntry {
        id: row.get(0)?,
        target: row.get(1)?,
        bot_id: row.get(2)?,
        content: row.get(3)?,
        source: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

const SELECT_COLUMNS: &str = "id, target, bot_id, content, source, created_at, updated_at";

/// 解析 (target, botId) 成落库的 scope：USER 永远属于全局，不接受 bot id；
/// MEMORY 必须指名一个 Bot。
pub(crate) fn scope(target: Target, bot_id: Option<&str>) -> Result<(String, String), MemoryError> {
    match target {
        Target::User => Ok(("user".into(), GLOBAL_BOT_ID.into())),
        Target::Memory => {
            let id = bot_id
                .map(str::trim)
                .filter(|id| !id.is_empty())
                .ok_or_else(|| MemoryError::new("bad_scope", "memory target requires a bot id"))?;
            Ok(("memory".into(), id.to_string()))
        }
    }
}

/// 这个账本的上限：USER 固定，MEMORY 读 Bot 配置（Bot 已删则退回默认值，
/// 会话中途删掉 Bot 不会让在跑的工具失效）。
pub fn ledger_limit(target: Target, bot_id: &str) -> usize {
    match target {
        Target::User => USER_LIMIT,
        Target::Memory => crate::bots::memory_char_limit(bot_id).unwrap_or(DEFAULT_MEMORY_LIMIT),
    }
}

pub fn list(db: &Db, target: Target, bot_id: &str) -> Result<Vec<MemoryEntry>, MemoryError> {
    let (db_target, db_bot) = scope(target, Some(bot_id))?;
    let conn = db.0.lock();
    let mut stmt = conn
        .prepare(&format!(
            "SELECT {SELECT_COLUMNS} FROM memory_entries
             WHERE target=?1 AND bot_id=?2 ORDER BY created_at ASC, id ASC"
        ))
        .map_err(|e| MemoryError::new("db", e.to_string()))?;
    let rows = stmt
        .query_map(rusqlite::params![db_target, db_bot], row_to_entry)
        .map_err(|e| MemoryError::new("db", e.to_string()))?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| MemoryError::new("db", e.to_string()))
}

pub fn ledger(db: &Db, target: Target, bot_id: &str) -> Result<MemoryLedger, MemoryError> {
    let entries = list(db, target, bot_id)?;
    Ok(MemoryLedger {
        target: target.as_str().to_string(),
        bot_id: bot_id.to_string(),
        used: used_chars(&entries),
        limit: ledger_limit(target, bot_id),
        entries,
    })
}

pub fn view(db: &Db, bot_id: Option<&str>) -> Result<MemoryView, MemoryError> {
    let memory = match bot_id.map(str::trim).filter(|id| !id.is_empty()) {
        Some(id) => Some(ledger(db, Target::Memory, id)?),
        None => None,
    };
    Ok(MemoryView {
        memory,
        user: ledger(db, Target::User, GLOBAL_BOT_ID)?,
        pending: super::pending::list(db, bot_id)?,
    })
}

fn find_by_id(db: &Db, id: &str) -> Result<MemoryEntry, MemoryError> {
    let conn = db.0.lock();
    conn.query_row(
        &format!("SELECT {SELECT_COLUMNS} FROM memory_entries WHERE id=?1"),
        [id],
        row_to_entry,
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            MemoryError::new("not_found", format!("memory entry not found: {id}"))
        }
        other => MemoryError::new("db", other.to_string()),
    })
}

fn entry_by_content(
    db: &Db,
    target: &str,
    bot_id: &str,
    content: &str,
) -> Result<Option<MemoryEntry>, MemoryError> {
    let conn = db.0.lock();
    conn.query_row(
        &format!(
            "SELECT {SELECT_COLUMNS} FROM memory_entries
             WHERE target=?1 AND bot_id=?2 AND content=?3"
        ),
        rusqlite::params![target, bot_id, content],
        row_to_entry,
    )
    .optional()
    .map_err(|e| MemoryError::new("db", e.to_string()))
}

/// 容量闸：加入/替换后会超过上限就拒绝，报出当前用量与上限。调用方拿到
/// `limit` 错误后应合并或删除后重试——这里不做任何截断。
fn ensure_limit(entries: &[MemoryEntry], limit: usize) -> Result<(), MemoryError> {
    let used = used_chars(entries);
    if used > limit {
        return Err(MemoryError::new(
            "limit",
            format!("memory is full: {used}/{limit} chars; merge or remove entries first"),
        )
        .with_usage(used, limit));
    }
    Ok(())
}

/// 写前扫描 + trim。空内容直接拒绝。
/// 待审批的暂存也会调用它：队列里不放注定会被扫描拒绝的内容。
pub(crate) fn clean(content: &str) -> Result<String, MemoryError> {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return Err(MemoryError::new(
            "empty",
            "memory content must not be empty",
        ));
    }
    scan::scan(trimmed)
        .map_err(|rejection| MemoryError::new("scan", rejection.message()).with_scan(&rejection))?;
    Ok(trimmed.to_string())
}

/// 新增一条。与已有条目完全重复时不新增，返回已有条目与 `created=false`。
pub fn add(
    db: &Db,
    target: Target,
    bot_id: Option<&str>,
    content: &str,
    source: &str,
) -> Result<(MemoryEntry, bool), MemoryError> {
    let (db_target, db_bot) = scope(target, bot_id)?;
    let content = clean(content)?;
    if let Some(existing) = entry_by_content(db, &db_target, &db_bot, &content)? {
        return Ok((existing, false));
    }
    let mut entries = list(db, target, &db_bot)?;
    let limit = ledger_limit(target, &db_bot);
    let now = now_ms();
    let entry = MemoryEntry {
        id: uuid::Uuid::new_v4().to_string(),
        target: db_target.clone(),
        bot_id: db_bot.clone(),
        content,
        source: source.to_string(),
        created_at: now,
        updated_at: now,
    };
    entries.push(entry.clone());
    ensure_limit(&entries, limit)?;
    let conn = db.0.lock();
    conn.execute(
        "INSERT INTO memory_entries(id, target, bot_id, content, source, created_at, updated_at)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            entry.id,
            entry.target,
            entry.bot_id,
            entry.content,
            entry.source,
            entry.created_at,
            entry.updated_at
        ],
    )
    .map_err(|e| MemoryError::new("db", e.to_string()))?;
    Ok((entry, true))
}

/// 按子串唯一匹配一条。0 条 → `no_match`，多条 → `ambiguous`（要求更具体的
/// 子串，而不是猜测写哪条）。待审批的暂存也用它锁定目标条目。
pub(crate) fn match_one(
    db: &Db,
    target: Target,
    bot_id: Option<&str>,
    old_text: &str,
) -> Result<(MemoryEntry, Vec<MemoryEntry>), MemoryError> {
    let needle = old_text.trim();
    if needle.is_empty() {
        return Err(MemoryError::new(
            "no_match",
            "old_text is required to locate an entry",
        ));
    }
    let entries = match target {
        Target::User => list(db, target, GLOBAL_BOT_ID)?,
        Target::Memory => list(db, target, bot_id.unwrap_or(""))?,
    };
    let hits: Vec<&MemoryEntry> = entries
        .iter()
        .filter(|entry| entry.content.contains(needle))
        .collect();
    match hits.len() {
        0 => Err(MemoryError::new(
            "no_match",
            format!("no entry contains \"{needle}\""),
        )),
        1 => Ok((hits[0].clone(), entries)),
        count => Err(MemoryError::new(
            "ambiguous",
            format!("\"{needle}\" matches {count} entries; use a longer substring"),
        )),
    }
}

/// 用子串定位并替换整条内容。
pub fn replace(
    db: &Db,
    target: Target,
    bot_id: Option<&str>,
    old_text: &str,
    content: &str,
) -> Result<MemoryEntry, MemoryError> {
    let (existing, entries) = match_one(db, target, bot_id, old_text)?;
    let content = clean(content)?;
    let limit = ledger_limit(target, &existing.bot_id);
    let next: Vec<MemoryEntry> = entries
        .iter()
        .map(|entry| {
            if entry.id == existing.id {
                MemoryEntry {
                    content: content.clone(),
                    updated_at: now_ms(),
                    ..entry.clone()
                }
            } else {
                entry.clone()
            }
        })
        .collect();
    ensure_limit(&next, limit)?;
    let updated = next
        .iter()
        .find(|entry| entry.id == existing.id)
        .cloned()
        .expect("the replaced entry is in the rebuilt list");
    write_content(db, &updated)?;
    Ok(updated)
}

/// 用子串定位并删除。
pub fn remove(
    db: &Db,
    target: Target,
    bot_id: Option<&str>,
    old_text: &str,
) -> Result<MemoryEntry, MemoryError> {
    let (existing, _) = match_one(db, target, bot_id, old_text)?;
    delete(db, &existing.id)?;
    Ok(existing)
}

/// 面板编辑：按 id 改内容（同样过扫描与容量闸）。
pub fn update(db: &Db, id: &str, content: &str) -> Result<MemoryEntry, MemoryError> {
    let existing = find_by_id(db, id)?;
    let content = clean(content)?;
    let target = Target::parse(&existing.target)?;
    let entries = list(
        db,
        target,
        if existing.bot_id.is_empty() {
            GLOBAL_BOT_ID
        } else {
            &existing.bot_id
        },
    )?;
    let next: Vec<MemoryEntry> = entries
        .iter()
        .map(|entry| {
            if entry.id == id {
                MemoryEntry {
                    content: content.clone(),
                    updated_at: now_ms(),
                    ..entry.clone()
                }
            } else {
                entry.clone()
            }
        })
        .collect();
    ensure_limit(&next, ledger_limit(target, &existing.bot_id))?;
    let updated = next
        .iter()
        .find(|entry| entry.id == id)
        .cloned()
        .expect("the edited entry is in the rebuilt list");
    write_content(db, &updated)?;
    Ok(updated)
}

fn write_content(db: &Db, entry: &MemoryEntry) -> Result<(), MemoryError> {
    let conn = db.0.lock();
    conn.execute(
        "UPDATE memory_entries SET content=?2, updated_at=?3 WHERE id=?1",
        rusqlite::params![entry.id, entry.content, entry.updated_at],
    )
    .map_err(|e| MemoryError::new("db", e.to_string()))?;
    Ok(())
}

/// 面板按 id 删除（`memory_remove` 命令与 web 桥共用）。
pub fn remove_by_id(db: &Db, id: &str) -> Result<(), MemoryError> {
    delete(db, id)
}

fn delete(db: &Db, id: &str) -> Result<(), MemoryError> {
    let conn = db.0.lock();
    let changed = conn
        .execute("DELETE FROM memory_entries WHERE id=?1", [id])
        .map_err(|e| MemoryError::new("db", e.to_string()))?;
    if changed == 0 {
        return Err(MemoryError::new(
            "not_found",
            format!("memory entry not found: {id}"),
        ));
    }
    Ok(())
}

/// 清空一个账本，返回删掉的条数。
pub fn clear(db: &Db, target: Target, bot_id: Option<&str>) -> Result<usize, MemoryError> {
    let (db_target, db_bot) = scope(target, bot_id)?;
    let conn = db.0.lock();
    conn.execute(
        "DELETE FROM memory_entries WHERE target=?1 AND bot_id=?2",
        rusqlite::params![db_target, db_bot],
    )
    .map_err(|e| MemoryError::new("db", e.to_string()))
}

/// 删除一个 Bot 时顺带清掉它的 MEMORY（USER 是全局的，不动）。没有这条，
/// 记忆会留在库里但没有任何入口能看到或删掉。
pub fn forget_bot(db: &Db, bot_id: &str) -> Result<usize, MemoryError> {
    let conn = db.0.lock();
    conn.execute(
        "DELETE FROM memory_entries WHERE target='memory' AND bot_id=?1",
        [bot_id],
    )
    .map_err(|e| MemoryError::new("db", e.to_string()))
}
