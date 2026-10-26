//! dsh 的分叉能力行（`ForkSupport`）。
//!
//! 为什么单独一个文件：dsh 与 Claude/Codex 的差异不只是"路径拼法"，而是**落盘
//! 形状整条都不同**——转录本是**多帧 zstd**（`<dsh home>/sessions/<cwd-slug>/
//! session-<uuid>/session.v<N>.jsonl.zstd`），明文 `BufReader::lines()` 读出来是
//! 二进制垃圾；切点也不是"第 n 条 user 记录"（一轮里可以有好几条 `user/message`），
//! 而是锚点轮的 `turn/end`。`fork.rs` 顶部的能力表注释就点名了这种情况：把实现
//! 放进新文件，表里加一行指向它。
//!
//! 下面这些是 dsh 磁盘格式的既有事实，别再重新推导：
//! - 每个会话目录里**恰好一个**转录本文件，名字 `session.v<N>.jsonl.zstd`，
//!   `N` 等于首行 header 的 `version`。
//! - 首行 header 是身份：`{"type":"session","version":4,"id":"session-<uuid>",
//!   "cwd":"…",…}`；`id` 必须与**所在目录名**逐字相等（两边都是
//!   `session-<uuid>`）。
//! - 轮次由 `turn/start` … `turn/end` 界定，一轮里可以有多条 `user/message`
//!   （子代理回报、`system-reminder`、自动检查点）。

use std::collections::HashSet;
use std::io::Write;
use std::path::{Path, PathBuf};

use super::fork::{is_uuid, ForkAnchor, ForkSupport};
use crate::history::Message;

/// 会话 id 前缀。dsh 的目录名与 header 的 `id` 都用它，两者是同一个字符串。
const DSH_SESSION_PREFIX: &str = "session-";

/// 转录本文件名主干（`session.v<N>.jsonl.zstd`；`<N>` 与后缀的解析归
/// `history::discovery::dsh_log_generation`，这里只借用它的结果，不另写一份）。
const DSH_LOG_STEM: &str = "session";

/// dsh 在分叉**能力表**里的那一行。
///
/// 放在这里而不是 `fork.rs`：行里挂的三个函数都定义在本模块，把"能力 + 实现"
/// 留在一处，新增引擎时只需新建一个文件 + 在表里加一个名字。
pub(crate) const DSH_FORK: super::fork::ForkSupport = super::fork::ForkSupport {
    engine: "dsh",
    source_id_ok,
    target_id: new_prefixed_uuid,
    keep_count,
    copy_prefix,
    derive_landing: Some(derive_landing),
};

/// dsh 能当分叉来源的会话 id 形状：`session-<uuid>`（真实值，目录名与 header 的
/// `id` 都是它），也收**裸 uuid**（老数据里出现过同形目录，调用方少写一截前缀
/// 时也不该被判成"不是合法 id"）。
///
/// 不能统一成 `is_uuid`（那是 Claude 的文件名约束）：它会把 dsh 的真实 id 全挡在
/// 门外；分支新 id 的形态见 `new_prefixed_uuid`，与本项无关。
pub(crate) fn source_id_ok(session_id: &str) -> bool {
    match session_id.strip_prefix(DSH_SESSION_PREFIX) {
        Some(rest) => !rest.is_empty() && is_uuid(rest),
        None => is_uuid(session_id),
    }
}

/// 转录本文件名：`session.v<N>.jsonl.zstd`。`N` 是**文件名**里的世代号，落盘时
/// 按源文件的世代重命名，所以它是名字的一部分。
///
/// ⚠️ **世代 0 的规范写法是裸名 `session.jsonl.zstd`，不是 `session.v0.jsonl.zstd`**。
/// `dsh_log_generation` 把裸名定为世代 0，并**显式拒绝**以 `0` 开头的世代号
/// （`digits.starts_with('0')` → `None`），因为 dsh 自己不产出前导零。所以这里必须跟着
/// 它的口径走：写成 `session.v0.…` 的话 `dsh_session_log()` 会当成不认识的文件跳过，
/// 分支在扫描器眼里等于不存在——命令报成功、库里也有行，但文件永不刷新、按文件名
/// 解析世代的一方（host 的 resume）也找不到它，表现就是"分支静默没有上下文"。
fn transcript_name(generation: u32) -> String {
    if generation == 0 {
        return format!("{DSH_LOG_STEM}.jsonl.zstd");
    }
    format!("{DSH_LOG_STEM}.v{generation}.jsonl.zstd")
}

/// 源转录本文件名 → 世代号。取不到说明这个文件根本不是 dsh 会话日志。
fn transcript_generation(source_path: &Path) -> Result<u32, String> {
    let name = source_path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| format!("源转录本文件名不可读: {}", source_path.display()))?;
    crate::history::discovery::dsh_log_generation(name)
        .ok_or_else(|| format!("源转录本不是 dsh 会话日志（session.v<N>.jsonl.zstd）: {name}"))
}

/// 源会话目录名 → 分支目录名：`session-<新 id>`。
///
/// 两个身份必须**是同一个字符串**：目录名与 header 的 `id`（`discovery.rs` 的
/// `identify_head` 读 header、`dsh_candidates()` 读目录，两边都要认出这条分支，
/// 对不上就会一边扫得到、一边读不出）。
///
/// **幂等**：分支 id 现在本身就是 `session-<uuid>`（`DSH_FORK.target_id`），这里不能再
/// 无脑拼一次，否则会得到 `session-session-<uuid>`。同时保留补前缀的能力，好让裸 UUID
/// 形态的调用方（老数据、测试）也能用。
fn branch_session_id(target_session_id: &str) -> String {
    if target_session_id.starts_with(DSH_SESSION_PREFIX) {
        target_session_id.to_string()
    } else {
        format!("{DSH_SESSION_PREFIX}{target_session_id}")
    }
}

/// 分支新 id（dsh）：**带 `session-` 前缀**的 UUIDv4。
///
/// 这是 dsh 的规范形态：目录名、header 的 `id`、host 自己建的投影缓存键都是它。磁盘
/// 上带前缀、DB 行与传给 host 的却是裸 UUID 时，host 会用裸 id 另建一份投影
/// （`inheritedEventCount: 0`），模型看不到继承的对话。
fn new_prefixed_uuid() -> String {
    format!("{DSH_SESSION_PREFIX}{}", uuid::Uuid::new_v4())
}

/// 分支落盘路径：与源会话目录**同级**（同一个 cwd-slug 目录下）+ `session-<新 id>/`
/// + 源文件同一个世代名。
///
/// 同级沿用引擎自己的发现规则（`<dsh home>/sessions/<cwd-slug>/session-<id>/`），
/// 从根上绕开 cwd-slug 编码的所有拼写假设。
fn derive_landing(source_path: &Path, target_session_id: &str) -> Result<PathBuf, String> {
    Ok(branch_dir(source_path, target_session_id)?
        .join(transcript_name(transcript_generation(source_path)?)))
}

/// 分支目录：`<cwd-slug 目录>/session-<新 id>`。
///
/// ⚠️ 必须是**源会话目录的父目录**（即 cwd-slug 目录），不能是源会话目录本身：
/// dsh 的会话是 slug 目录下的**兄弟**（`sessions/<slug>/session-<a>/`、
/// `sessions/<slug>/session-<b>/`）。写成 `<源会话目录>/session-<新 id>` 会把一个
/// 合法会话**塞进另一个会话的目录里**——既不在 dsh 的发现范围内，也会让
/// `delete_session_disk` 的结构校验把源会话目录看成"有多余内容"。
/// 命名只此一份，落盘与推导共用。
fn branch_dir(source_path: &Path, target_session_id: &str) -> Result<PathBuf, String> {
    let slug_dir = source_dir(source_path)?
        .parent()
        .ok_or_else(|| format!("源会话目录没有父目录: {}", source_path.display()))?;
    Ok(slug_dir.join(branch_session_id(target_session_id)))
}

/// 源**会话目录**（`…/session-<源 id>`），即转录本文件所在目录。
fn source_dir(source_path: &Path) -> Result<&Path, String> {
    source_path
        .parent()
        .ok_or_else(|| format!("源转录本没有父目录: {}", source_path.display()))
}

/// 事件类型：dsh 的类型在顶层（`turn/start` / `turn/end` / `user/message` …）。
fn line_type(value: &serde_json::Value) -> Option<&str> {
    value.get("type").and_then(serde_json::Value::as_str)
}

/// dsh 的记录级切点：**锚点轮的 `turn/end` 之后**。
///
/// 为什么不能照 Claude 那样切在"下一条 user 记录"上：dsh 一轮里可以有多条
/// `user/message`（子代理回报、`system-reminder`、自动检查点），按 user 记录切
/// 会**切进某一轮中间**，留下没有 `turn/end` 的残轮。这与 Codex 必须切在
/// `task_complete` 之后是同一个理由，只是各自的结束标记不同（故意不统一）。
///
/// 锚点轮**包含**在分支里（用户点的那一轮必须留下），所以切点是"该轮结束、下一轮
/// 开始"处 = `turn/end` 的**下一行**。`turn/end` 之后、下一条 `turn/start` 之前
/// 的记录跟着锚点轮走，不会漏。
///
/// 锚点轮没有 `turn/end`（未完成轮、转录本被截过）→ `None`：调用方据此明确报错，
/// 绝不退化成"取到文件末尾"——那会派生出内容不是用户所点的分支。
///
/// 轮号用**文件里 `turn/start` 的出现次序**数，不读 payload 里的 `turn` 字段：
/// 那个字段在本仓库里没有任何被验证过的形状（`dsh_session.rs` 只在 follow 流上
/// 处理 `turn/end`，没有存盘样本），拿它当判据等于把切点建在猜测上。
///
/// ⚠️ **不能把 `anchor_turn` 的返回值直接当轮号。** 它数的是**可见 user 消息**条数
/// （`anchor_hit_index` 的命中位置之前有几条 user 消息），而这里的轮界是
/// `turn/start`——dsh 的一轮里可以有多条可见 user 消息（子代理回报、自动 checkpoint）。
/// 两者在 1:1 时相等，一旦某轮不是 1:1，
/// 序号就会错位：锚点落在某轮的第二条 user 消息上时，按序号算出来的"轮"要么不存在
/// （→ 报定位失败，而用户明明看得见这条消息），要么是**更晚的一轮**（→ 分支静默
/// 多带了内容）。
///
/// 所以这里分两步：先用 `anchor_turn` 拿到"锚点是第几条可见 user 消息"（**只此一份**
/// 命中判据），再在文件里用**提取器同一个判据**（`dsh_user_message_text`）数可见
/// user 消息，找到那条消息所在的轮，切在它的 `turn/end` 上。
pub(crate) fn keep_count(
    path: &Path,
    anchor: &ForkAnchor,
    parsed: &[Message],
    // dsh 的切点靠轮标记（`turn/start` / `turn/end`）求，不需要"哪条原始记录算
    // 用户消息"的口径。签名与能力表保持一致，好让表里各行同型（与 Codex 同）。
    _accepted_frames: &HashSet<String>,
) -> Option<usize> {
    // 锚点是全文件第几条**可见 user 消息**（0 起）——命中判据只有 `anchor_turn` 这一份。
    let anchor_user_ordinal = super::fork::anchor_turn(parsed, anchor)?;

    let reader = crate::history::open_line_reader("dsh", path).ok()?;
    use std::io::BufRead;
    let mut current_turn = 0usize;
    let mut seen_users = 0usize;
    // 锚点那条消息落在第几轮：找到之后等这一轮的 `turn/end` 就是切点。
    let mut anchor_turn_number: Option<usize> = None;
    for (index, line) in reader.lines().enumerate() {
        let Ok(line) = line else { continue };
        let Some(value) = super::fork::parse_json_line(&line) else {
            continue;
        };
        match line_type(&value) {
            Some("turn/start") => current_turn += 1,
            Some("user/message") => {
                if crate::history::dsh_user_message_text(&value).is_some() {
                    if seen_users == anchor_user_ordinal {
                        anchor_turn_number = Some(current_turn);
                    }
                    seen_users += 1;
                }
            }
            Some("turn/end") if anchor_turn_number == Some(current_turn) => {
                // 含 `turn/end` 这一行：分支"包含锚点那一轮"。
                return Some(index + 1);
            }
            _ => {}
        }
    }
    // 锚点轮没有 `turn/end`：不猜，报定位失败。
    None
}

/// dsh 的前缀复制：按行读**解码后**的 NDJSON，只改首行 header 的 `id`，再以
/// zstd 写回 `<源目录>/session-<新 id>/session.v<N>.jsonl.zstd`。
///
/// 三个"为什么"：
/// - **读必须走 `history::open_line_reader`**：它是全仓唯一一处知道 dsh 是
///   zstd、且要跨帧拼到 EOF 的地方。自己再包一层就是第二个事实来源。
/// - **只改 header 的 `id`，不动 `cwd`**：与 Codex 同一条理由——分支按定义就在
///   同一个工作区，转录本里记的 cwd 已经是对的；改写它等于引入第二个可能不一致
///   的来源（DB 的 `workspace_path` vs 转录本的 `cwd`），只会在两者拼写不同时把
///   分支悄悄跑到别处。少改一个字段就少一个出错面。
/// - **目录名与 header 的 `id` 必须逐字相等**：所以 `id` 写成
///   `session-<新 id>`（分支目录叫什么，header 就写什么），而不是裸 uuid。落盘
///   成功后返回的也是这个目录里的**转录本文件路径**（调用方拿它做 `file_path`
///   登记，回滚时照着删文件）。
///
/// 落盘约定：目标目录必须**不存在或为空**（非空就是别人的东西，明确报错而不是
/// 覆盖）；文件用 `create_new`；任何失败都把半成品目录整个删掉再报错——半成品
/// 目录会被 `dsh_candidates()` 当成一个真会话扫出来（它只认"目录里有会话日志"）。
pub(crate) fn copy_prefix(
    source_path: &Path,
    target_session_id: &str,
    keep_records: usize,
) -> Result<PathBuf, String> {
    let generation = transcript_generation(source_path)?;
    let dir = branch_dir(source_path, target_session_id)?;
    let dest = dir.join(transcript_name(generation));

    // 目标目录名带的是**本次调用刚生成**的 UUIDv4：已经存在说明那是别人的东西
    // （上一轮失败留下的、用户手放的）。空目录可以继续用（上一次失败已经被
    // 清干净），非空一律拒绝——`remove_dir_all` 别人的目录比报错糟得多。
    if let Ok(entries) = std::fs::read_dir(&dir) {
        if entries.into_iter().next().is_some() {
            return Err(format!("分支会话目录已被占用: {}", dir.display()));
        }
    }

    let reader = crate::history::open_line_reader("dsh", source_path)?;
    use std::io::BufRead;

    let mut lines = reader.lines();
    // 首行必须是 header：身份所在，也是唯一一行要改的。读不到/解不出来就明确
    // 失败，绝不写一个没有 header 的分支。
    let header_line = match lines.next() {
        Some(Ok(line)) => line,
        Some(Err(error)) => return Err(format!("读取源转录本失败: {error}")),
        None => return Err("源转录本为空（没有 header）".into()),
    };
    let mut header = super::fork::parse_json_line(&header_line)
        .ok_or_else(|| "源转录本首行不是合法 JSON（dsh header）".to_string())?;
    let header_version = header
        .get("version")
        .and_then(serde_json::Value::as_u64)
        .and_then(|v| u32::try_from(v).ok());
    if header_version != Some(generation) {
        // 名字与 header 不一致时**拒绝**：两个都是事实来源，猜错一个就会写出一个
        // 宿主读不了（或应用扫不到）的分支。
        return Err(format!(
            "dsh 转录本的世代号与 header 的 version 不一致（文件名 v{generation} / header {header_version:?}）: {}",
            source_path.display()
        ));
    }
    let new_session_id = branch_session_id(target_session_id);
    if !rewrite_identity(&mut header, &new_session_id) {
        return Err("源转录本首行不是 dsh 会话 header（type=session）".into());
    }
    let header =
        serde_json::to_string(&header).map_err(|e| format!("序列化 dsh header 失败: {e}"))?;

    // 目录与文件都在下面创建；之后任何失败都要整目录清掉。
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建分支会话目录失败: {e}"))?;
    let written = (|| -> Result<(), String> {
        let file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&dest)
            .map_err(|e| format!("创建分支转录本失败: {e}"))?;
        // 压缩级别 0（zstd 的 "default"）：这里只是转发一份已经压过的转录本，
        // 不值得为体积再做取舍。
        // ⚠️ **第一帧必须恰好只是一行 header**。host 会校验这一点，不满足时
        // `session/create` 直接拒绝：
        //   "corrupt Zstandard session log: first frame is not exactly one header line"
        // 把整份日志写成**一帧**同样会让 host 读不了这条分支
        // （`inheritedEventCount` 记成 0、模型看不到继承的对话）。
        // 所以 header 单独占一帧、写完立刻关帧；其余行从**第二帧**开始。
        let mut file = file;
        {
            let mut header_frame = zstd::stream::write::Encoder::new(&mut file, 0)
                .map_err(|e| format!("初始化 zstd 编码器失败: {e}"))?;
            header_frame
                .write_all(header.as_bytes())
                .and_then(|_| header_frame.write_all(b"\n"))
                .map_err(|e| format!("写入分支转录本失败: {e}"))?;
            header_frame
                .finish()
                .map_err(|e| format!("刷新分支转录本失败: {e}"))?;
        }
        // 逐行搬，**不挑行**：辅助记录（`turn/start`、`step/*`、`tool/*`）也要搬，
        // 否则分支里的一轮没有边界标记，切点与宿主回读都会错。
        //
        // `keep_records` 数是"写出去的条数"（header 算第一条），与明文那条复制
        // 路径同一口径：`usize::MAX` = 整份文件。
        //
        // 第二帧**按需创建**：只保留 header（`keep_records == 1`）时不该多写一个空帧。
        let mut rest: Option<zstd::stream::write::Encoder<&mut std::fs::File>> = None;
        let mut written = 1usize;
        for line in lines {
            if written >= keep_records {
                break;
            }
            let line = line.map_err(|e| format!("读取源转录本失败: {e}"))?;
            if line.trim().is_empty() {
                continue;
            }
            if rest.is_none() {
                rest = Some(
                    zstd::stream::write::Encoder::new(&mut file, 0)
                        .map_err(|e| format!("初始化 zstd 编码器失败: {e}"))?,
                );
            }
            let frame = rest.as_mut().expect("刚创建过");
            frame
                .write_all(line.as_bytes())
                .and_then(|_| frame.write_all(b"\n"))
                .map_err(|e| format!("写入分支转录本失败: {e}"))?;
            written += 1;
        }
        if let Some(frame) = rest {
            frame
                .finish()
                .map_err(|e| format!("刷新分支转录本失败: {e}"))?;
        }
        Ok(())
    })();

    if let Err(error) = written {
        // 半成品目录会被扫描器当成真会话，所以整目录删掉再报错，不留半状态。
        cleanup_half_written(&dir, &dest);
        return Err(error);
    }
    Ok(dest)
}

/// 失败清理：先删可能已经写出来的转录本文件，再删目录。
///
/// 先 `remove_file` 再 `remove_dir_all` 而不是只删后者：目录里万一还有别的东西，
/// `remove_dir_all` 一样会连它一起删掉，而这两步至少让"我们只删自己写的东西"
/// 这件事在代码里看得见。目录非空时的兜底仍由 `remove_dir_all` 完成——"目录已
/// 建好、文件没写成"那一刻必须清干净。
fn cleanup_half_written(dir: &Path, dest: &Path) {
    if dest.is_file() {
        let _ = std::fs::remove_file(dest);
    }
    let _ = std::fs::remove_dir_all(dir);
}

/// dsh 的身份改写：**只改首行 header 的 `id`**（目录名与它必须一致）。
///
/// 不动 `cwd`（理由见 `copy_prefix`）。返回"这行改过没有"：首行不是 `session`
/// header 时调用方要报错，而不是悄悄写一个没有身份的分支。
fn rewrite_identity(value: &mut serde_json::Value, new_session_id: &str) -> bool {
    let Some(object) = value.as_object_mut() else {
        return false;
    };
    if object.get("type").and_then(serde_json::Value::as_str) != Some("session") {
        return false;
    }
    object.insert(
        "id".to_string(),
        serde_json::Value::String(new_session_id.to_string()),
    );
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::BufRead;

    /// **分支写出的文件名必须被我们自己的发现逻辑认得。**
    ///
    /// 世代号有两条独立约定：`transcript_name` 决定写什么名字，`dsh_log_generation`
    /// 决定什么名字算 dsh 会话日志。两者一旦不一致，分支在磁盘上真实存在、库里有行、
    /// 命令也报成功，**但扫描器永远看不见它**（`dsh_session_log()` 当成不认识的文件
    /// 跳过），而按文件名解析世代的一方（host 的 resume）同样找不到 → 表现是"分支静默
    /// 没有上下文"。世代 0 的裸名 `session.jsonl.zstd` 才是规范写法，写成
    /// `session.v0.…` 会被判为非法（前导零）。
    ///
    /// 所以这里断言的是**往返一致**，而不是逐字比对两个格式串——后者只能证明复制粘贴
    /// 正确，证明不了两边口径相同。
    #[test]
    fn written_transcript_names_are_recognised_by_discovery() {
        for generation in 0u32..=12 {
            let name = transcript_name(generation);
            assert_eq!(
                crate::history::discovery::dsh_log_generation(&name),
                Some(generation),
                "自己写出的文件名必须能被自己解析回同一个世代号: {name}"
            );
        }
    }

    /// host 会校验「**第一帧恰好只是一行 header**」，不满足时 `session/create` 直接
    /// 拒绝：
    ///   `corrupt Zstandard session log: first frame is not exactly one header line`
    ///
    /// 这条测试**按帧**读回文件，而不是让解码器把所有帧拼起来读——"分成几帧"正是
    /// 被校验的东西，拼起来读会把这个问题完全掩盖掉（整份日志写成一帧时，所有
    /// "能读回来"的断言仍然全绿）。
    #[test]
    fn first_zstd_frame_is_exactly_the_header_line() {
        use std::io::Read as _;

        let (root, source, _id) = fixture(4, 4, true);
        let target = new_prefixed_uuid();
        let dest = copy_prefix(&source, &target, usize::MAX).unwrap();

        let bytes = std::fs::read(&dest).unwrap();
        // zstd 帧起始魔数 0x28 B5 2F FD：找出所有帧起点，切出第一帧。
        let magic = [0x28u8, 0xb5, 0x2f, 0xfd];
        let mut starts = Vec::new();
        let mut i = 0usize;
        while i + 4 <= bytes.len() {
            if bytes[i..i + 4] == magic {
                starts.push(i);
                i += 4;
            } else {
                i += 1;
            }
        }
        assert!(
            starts.len() >= 2,
            "至少要两帧（header 一帧 + 其余行一帧），实际 {} 帧",
            starts.len()
        );

        let mut text = String::new();
        zstd::stream::read::Decoder::new(&bytes[starts[0]..starts[1]])
            .unwrap()
            .read_to_string(&mut text)
            .unwrap();
        let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
        assert_eq!(
            lines.len(),
            1,
            "第一帧必须**只有 header 一行**，实际 {} 行: {text:?}",
            lines.len()
        );
        assert!(
            lines[0].contains("\"type\":\"session\""),
            "第一帧必须是 dsh 的 session header: {}",
            lines[0]
        );
        assert!(
            lines[0].contains(&target),
            "header 的 id 必须是分支新 id（{target}），实际: {}",
            lines[0]
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    /// 分支 id 的**形态**逐引擎不同，且必须与各引擎自己的规范一致。
    ///
    /// 形态一旦分家，功能会以"看起来正常但没上下文"的方式坏掉：磁盘上（目录名 /
    /// header）用的是 `session-<uuid>`，而 DB 行与传给 host 的 id 是裸 UUID 时，host 会
    /// 用另一种写法另建一份投影（`inheritedEventCount: 0`、`rows` 只有新那一轮），
    /// **模型读不到继承的对话**。所以把三种形态一起钉住。
    #[test]
    fn branch_id_shape_matches_each_engines_own_convention() {
        for engine in ["claude", "codex"] {
            let support = super::super::fork::fork_support(engine).expect("引擎必须在能力表里");
            let id = (support.target_id)();
            assert!(
                super::super::fork::is_uuid(&id),
                "{engine} 的分支 id 必须是**裸 UUID**（Claude 的 --resume 会校验文件名 stem）: {id}"
            );
        }

        let dsh = (DSH_FORK.target_id)();
        let bare = dsh.strip_prefix(DSH_SESSION_PREFIX).unwrap_or_else(|| {
            panic!("dsh 的分支 id 必须带 `{DSH_SESSION_PREFIX}` 前缀（目录名/header/host 缓存键都是这个形态）: {dsh}")
        });
        assert!(
            super::super::fork::is_uuid(bare),
            "前缀之后必须是合法 UUID: {dsh}"
        );

        // **幂等**：目录名与 header 用的就是 `branch_session_id(...)`，而分支 id 现在
        // 本身已带前缀——再补一次会得到 `session-session-<uuid>`，两边同时失效。
        assert_eq!(
            branch_session_id(&dsh),
            dsh,
            "已经带前缀的 id 不能再补一次前缀"
        );
        assert_eq!(
            branch_session_id(bare),
            dsh,
            "裸 UUID 仍应能补出规范形态（老数据/测试用）"
        );
    }

    /// 一段三条消息的转录本：0 号轮里夹着一条 `system-reminder`、1 号轮里夹着
    /// 第二条 `user/message`（子代理回报）、2 号轮。行号固定：
    /// 0 header / 1 turn1 start / 2 user / 3 assistant / 4 reminder /
    /// 5 turn1 end / 6 turn2 start / 7 user / 8 子代理回报 / 9 assistant /
    /// 10 turn2 end（`with_last_end = false` 时没有第 10 行）。
    fn transcript(session_id: &str, cwd: &str, header_version: u32, last_end: bool) -> Vec<String> {
        let mut lines = vec![
            serde_json::json!({
                "type": "session",
                "version": header_version,
                "id": session_id,
                "createdAt": 1_791_000_000_000i64,
                "cwd": cwd,
                "isSeeded": false,
                "delegationDepth": 0,
                "agentPreset": "standard",
            })
            .to_string(),
            turn("turn/start", 1),
            user("第一轮提问"),
            assistant("第一轮回答"),
            serde_json::json!({
                "type": "user/message",
                "data": { "content": [{ "type": "text",
                    "text": "<system-reminder>注入的运行时上下文</system-reminder>" }] }
            })
            .to_string(),
            turn("turn/end", 1),
            turn("turn/start", 2),
            user("第二轮提问"),
            user("子代理回报（同一轮里的第二条 user 记录）"),
            assistant("第二轮回答"),
        ];
        if last_end {
            lines.push(turn("turn/end", 2));
        }
        lines
    }

    fn turn(kind: &str, turn: u32) -> String {
        // `data.turn` 只是记录字段：切点不读它（见 `keep_count` 的注释）。
        serde_json::json!({ "type": kind, "data": { "turn": turn } }).to_string()
    }

    fn user(text: &str) -> String {
        serde_json::json!({
            "type": "user/message",
            "data": { "content": [{ "type": "text", "text": text }] }
        })
        .to_string()
    }

    fn assistant(text: &str) -> String {
        serde_json::json!({
            "type": "assistant/message",
            "data": { "message": { "content": [{ "type": "text", "text": text }] } }
        })
        .to_string()
    }

    /// 单帧 zstd（与 `scanner.rs` 测试夹具同形）。dsh 的转录本是多帧，多帧那条由
    /// `multi_frame_transcripts_are_read_across_frames` 单独钉。
    fn write_zstd_lines(path: &Path, lines: &[String]) {
        let file = std::fs::File::create(path).unwrap();
        let mut encoder = zstd::stream::write::Encoder::new(file, 0).unwrap();
        for line in lines {
            encoder.write_all(line.as_bytes()).unwrap();
            encoder.write_all(b"\n").unwrap();
        }
        encoder.finish().unwrap();
    }

    /// 每行一个独立 zstd 帧，字节直接拼接——dsh 的转录本就是这个形状。
    fn write_multi_frame_lines(path: &Path, lines: &[String]) {
        let mut bytes = Vec::new();
        for line in lines {
            let mut encoder = zstd::stream::write::Encoder::new(Vec::new(), 0).unwrap();
            encoder.write_all(line.as_bytes()).unwrap();
            encoder.write_all(b"\n").unwrap();
            bytes.extend_from_slice(&encoder.finish().unwrap());
        }
        std::fs::write(path, bytes).unwrap();
    }

    /// 一个临时根目录下的源会话：`<root>/session-<uuid>/session.v<N>.jsonl.zstd`。
    /// 返回 `(根目录, 源转录本路径, 源会话 id)`。
    fn fixture(file_generation: u32, header_version: u32, last_end: bool) -> (PathBuf, PathBuf, String) {
        let root = std::env::temp_dir().join(format!("ccgui-fork-dsh-{}", uuid::Uuid::new_v4()));
        let session_id = branch_session_id(&uuid::Uuid::new_v4().to_string());
        let dir = root.join(&session_id);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(transcript_name(file_generation));
        let body = transcript(&session_id, "/ws", header_version, last_end);
        write_zstd_lines(&path, &body);
        (root, path, session_id)
    }

    fn parsed_messages(path: &Path) -> Vec<Message> {
        crate::history::parse_session_file("dsh", path, &HashSet::new())
            .unwrap()
            .messages
    }

    /// 解码后的每一行（分叉写出的文件必须能被同一条读取路径读回）。
    fn lines_of(path: &Path) -> Vec<String> {
        crate::history::open_line_reader("dsh", path)
            .unwrap()
            .lines()
            .map(|line| line.unwrap())
            .collect()
    }

    fn messages_of(path: &Path) -> Vec<String> {
        parsed_messages(path)
            .iter()
            .map(|m| format!("{}:{}", m.role, m.text))
            .collect()
    }

    fn anchor(text: &str) -> ForkAnchor {
        ForkAnchor {
            user_text_sha256: super::super::fork::text_sha256_hex(text),
            seq_hint: None,
        }
    }

    /// 锚点落在**同一轮里的第二条** user 消息上时，切点必须仍在那一轮。
    ///
    /// 守的是一个真实存在过的错位：`anchor_turn` 数的是**可见 user 消息**条数，而轮界是
    /// `turn/start`。夹具第 2 轮里放了两条可见 user 消息（`第二轮提问` + `子代理回报`，
    /// 子代理回报就是这样落盘的）。按"第几条消息 + 1 = 第几轮"去算，锚点点在第
    /// 二条上会得到**并不存在的第 3 轮**——用户点了自己看得见的消息，却收到"未能在
    /// 转录本中定位该轮消息"；更糟的情形是后面还有轮，切点会**静默落到更晚的一轮**。
    ///
    /// 所以分两步：先用 `anchor_turn` 定位是第几条可见 user 消息，再用提取器**同一个**判据
    /// （`dsh_user_message_text`）在文件里找出它所在的轮。
    #[test]
    fn anchoring_the_second_user_message_of_a_turn_still_cuts_that_turn() {
        let (root, source, _id) = fixture(4, 4, true);
        let parsed = parsed_messages(&source);
        let hit = anchor("子代理回报（同一轮里的第二条 user 记录）");

        let keep = keep_count(&source, &hit, &parsed, &HashSet::new())
            .expect("锚点是第 2 轮的第二条 user 消息，必须能定位到该轮");
        // 0 header / 1 turn1 start / 2 user / 3 assistant / 4 reminder / 5 turn1 end /
        // 6 turn2 start / 7 user / 8 子代理回报 / 9 assistant / 10 turn2 end
        assert_eq!(
            keep, 11,
            "切点必须含第 2 轮的 `turn/end`（第 10 行，含端点）：既不能定位失败，也不能少带/多带"
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    /// dsh 的落盘：分支目录 + 转录本；header 的 `id` 改写、`cwd` 原样，读回来的
    /// 消息与源一致。
    #[test]
    fn dsh_copy_prefix_rewrites_identity_and_keeps_messages() {
        let cwd = "D:\\private\\project\\desktop-cc-gui";
        let root = std::env::temp_dir().join(format!("ccgui-fork-dsh-{}", uuid::Uuid::new_v4()));
        let session_id = branch_session_id(&uuid::Uuid::new_v4().to_string());
        let dir = root.join(&session_id);
        std::fs::create_dir_all(&dir).unwrap();
        let source = dir.join(transcript_name(4));
        write_zstd_lines(&source, &transcript(&session_id, cwd, 4, true));

        let target = uuid::Uuid::new_v4().to_string();
        let landing = copy_prefix(&source, &target, usize::MAX).unwrap();

        // 落盘位置：同目录 + `session-<新 id>` + 源文件同一个世代名。
        assert_eq!(
            landing,
            root.join(branch_session_id(&target))
                .join("session.v4.jsonl.zstd"),
            "落盘路径必须按新 id 起名、沿用源文件的世代名"
        );
        assert_eq!(
            landing,
            derive_landing(&source, &target).unwrap(),
            "derive_landing 推出来的必须是同一条路径（登记时要用它）"
        );
        assert!(landing.is_file());
        assert_eq!(
            std::fs::read_dir(landing.parent().unwrap()).unwrap().count(),
            1,
            "分支目录里恰好一个转录本（多一个文件就说明写歪了）"
        );

        // header：id = `session-<新 id>`（与目录名逐字相等），cwd 一字不动。
        let branch_lines = lines_of(&landing);
        let header: serde_json::Value = serde_json::from_str(&branch_lines[0]).unwrap();
        assert_eq!(header["type"], "session");
        assert_eq!(header["id"], branch_session_id(&target));
        assert_eq!(
            header["id"].as_str().unwrap(),
            landing
                .parent()
                .unwrap()
                .file_name()
                .unwrap()
                .to_str()
                .unwrap(),
            "目录名与 header 的 id 必须逐字相等（发现与读取两条路都靠它）"
        );
        assert_eq!(header["cwd"], cwd, "cwd 不参与改写（与 Codex 同一条理由）");
        assert_eq!(header["version"], 4, "世代号是转录本格式的一部分，不动");
        assert_eq!(header["agentPreset"], "standard", "其余字段一个字都不动");

        // 消息：与源逐条相同（整份文件都搬）。
        assert_eq!(messages_of(&landing), messages_of(&source));
        assert_eq!(
            messages_of(&landing),
            [
                "user:第一轮提问",
                "assistant:第一轮回答",
                "user:第二轮提问",
                "user:子代理回报（同一轮里的第二条 user 记录）",
                "assistant:第二轮回答",
            ],
            "夹具前提：system-reminder 不产出消息，同一轮的两条 user 记录都保留"
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    /// 写出去的真的是 zstd（明文 `BufReader::lines()` 读出来是二进制垃圾），
    /// 而且**多帧**拼接的源能跨帧读完——dsh 的转录本就是这个形状（首帧常常只有
    /// header 一行）。
    #[test]
    fn multi_frame_transcripts_are_read_across_frames() {
        let root = std::env::temp_dir().join(format!("ccgui-fork-dsh-{}", uuid::Uuid::new_v4()));
        let session_id = branch_session_id(&uuid::Uuid::new_v4().to_string());
        let dir = root.join(&session_id);
        std::fs::create_dir_all(&dir).unwrap();
        let source = dir.join(transcript_name(4));
        let body = transcript(&session_id, "/ws", 4, true);
        write_multi_frame_lines(&source, &body);

        assert_eq!(
            lines_of(&source),
            body,
            "每一行都必须读回来（只读首帧的实现会在这里只剩 header）"
        );

        let target = uuid::Uuid::new_v4().to_string();
        let landing = copy_prefix(&source, &target, usize::MAX).unwrap();
        let branch = lines_of(&landing);
        assert_eq!(branch.len(), body.len(), "条数不能少");
        assert_eq!(branch[1..], body[1..], "除 header 的 id 外逐字相同");
        assert_eq!(
            parsed_messages(&landing).len(),
            parsed_messages(&source).len(),
            "跨帧复制后再解析，消息数必须一致"
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    /// `keep_count` 切在锚点轮的 `turn/end` 之后；一轮里有几条 `user/message`
    /// 都不影响切点。
    #[test]
    fn dsh_cut_lands_after_the_anchor_turns_end() {
        let (root, source, _id) = fixture(4, 4, true);
        let messages = parsed_messages(&source);
        let frames = HashSet::new();

        assert_eq!(
            keep_count(&source, &anchor("第一轮提问"), &messages, &frames),
            Some(6),
            "锚点轮 = 1 号轮：切在它的 turn/end 之后（第 6 行 = 2 号轮的 turn/start）"
        );
        assert_eq!(
            keep_count(&source, &anchor("第二轮提问"), &messages, &frames),
            Some(11),
            "锚点轮 = 2 号轮：它一轮里有两条 user 记录也不影响切点"
        );
        assert_eq!(
            keep_count(&source, &anchor("转录本里没有这句话"), &messages, &frames),
            None,
            "锚点没命中 → None（调用方明确报错，绝不退化成取到末尾）"
        );

        // 用返回值真复制一遍：分支里恰好是"1 号轮"，一条不多一条不少。
        let target = uuid::Uuid::new_v4().to_string();
        let landing = copy_prefix(&source, &target, 6).unwrap();
        assert_eq!(
            parsed_messages(&landing)
                .iter()
                .map(|m| m.text.clone())
                .collect::<Vec<_>>(),
            ["第一轮提问", "第一轮回答"],
            "切在 turn/end 之后：锚点轮留下，2 号轮的 turn/start 起一条都不能进来"
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    /// 锚点轮没有 `turn/end`（未完成轮）：`None`——绝不切在轮中间，也绝不取到末尾。
    #[test]
    fn dsh_cut_refuses_a_turn_without_end() {
        let (root, source, _id) = fixture(4, 4, false);
        let messages = parsed_messages(&source);
        let frames = HashSet::new();

        assert_eq!(
            keep_count(&source, &anchor("第二轮提问"), &messages, &frames),
            None,
            "未完成轮不能猜一个切点"
        );
        // 同一份文件里 1 号轮是完整的：它仍然要能切——避免把"整份文件都没有
        // turn/end"和"只有最后一轮没结束"混为一谈。
        assert_eq!(
            keep_count(&source, &anchor("第一轮提问"), &messages, &frames),
            Some(6)
        );

        let _ = std::fs::remove_dir_all(&root);
    }

    /// 失败清理：`cleanup_half_written` 必须把半成品目录**整个**删掉（半成品目录会被
    /// `dsh_candidates()` 当成一个真会话扫出来），且目录不存在时也要幂等。
    ///
    /// 为什么直接测这个函数、而不是造一次写入失败：写失败在单元测试里造不出来。
    /// 唯一能稳定触发的失败是「目标转录本已存在」，但那时目标目录必然非空，会**先**
    /// 被上面的「已被占用」检查拦下（那条路径绝不能删目录——可能是别人的东西，见
    /// `dsh_copy_prefix_never_adopts_an_occupied_directory`）。所以清理逻辑剩下的入口
    /// 只有真实的 I/O 异常（权限、磁盘满），无法在单测里可靠复现。直接钉住清理函数，
    /// 比留一条永远走不到断言的「端到端」测试有意义。
    #[test]
    fn cleanup_half_written_removes_the_partial_directory() {
        let root = std::env::temp_dir().join(format!("ccgui-fork-dsh-cleanup-{}", uuid::Uuid::new_v4()));
        let dir = root.join(branch_session_id(&uuid::Uuid::new_v4().to_string()));
        let dest = dir.join(transcript_name(4));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(&dest, b"half").unwrap();

        cleanup_half_written(&dir, &dest);
        assert!(
            !dir.exists(),
            "清理必须把半成品目录整个删掉（扫描器会把目录当成一个真会话）"
        );

        // 幂等：失败路径上目录可能压根没建起来。
        cleanup_half_written(&dir, &dest);
        assert!(!dir.exists());

        let _ = std::fs::remove_dir_all(&root);
    }

    /// 目标目录非空 → 明确报错，绝不覆盖、也绝不顺手删掉别人的东西。
    #[test]
    fn dsh_copy_prefix_never_adopts_an_occupied_directory() {
        let (root, source, _id) = fixture(4, 4, true);
        let target = uuid::Uuid::new_v4().to_string();
        let dir = root.join(branch_session_id(&target));
        std::fs::create_dir_all(&dir).unwrap();
        let foreign = dir.join("别人的东西.txt");
        std::fs::write(&foreign, "keep me").unwrap();

        let error = copy_prefix(&source, &target, usize::MAX).expect_err("目录非空时必须报错");
        assert!(error.contains("已被占用"), "{error}");
        assert_eq!(std::fs::read_to_string(&foreign).unwrap(), "keep me");

        let _ = std::fs::remove_dir_all(&root);
    }

    /// 空目录可以继续用（上一次失败已经清干净，只剩目录壳）：成功，且目录里
    /// 恰好一个转录本。
    #[test]
    fn dsh_copy_prefix_reuses_an_empty_directory() {
        let (root, source, _id) = fixture(4, 4, true);
        let target = uuid::Uuid::new_v4().to_string();
        let dir = root.join(branch_session_id(&target));
        std::fs::create_dir_all(&dir).unwrap();

        let landing = copy_prefix(&source, &target, usize::MAX).unwrap();
        assert_eq!(landing.parent().unwrap(), dir);
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);

        let _ = std::fs::remove_dir_all(&root);
    }

    /// 世代号不一致时拒绝：文件名与 header 的 `version` 都是事实来源，猜错一个
    /// 就会写出宿主读不了、或应用扫不到的分支。
    #[test]
    fn dsh_copy_prefix_refuses_a_generation_mismatch() {
        // 文件名 v3，header 说 4。
        let (root, source, _id) = fixture(3, 4, true);
        let target = uuid::Uuid::new_v4().to_string();

        let error = copy_prefix(&source, &target, usize::MAX).expect_err("世代号对不上必须报错");
        assert!(error.contains("世代号"), "{error}");
        assert!(!root.join(branch_session_id(&target)).exists());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn dsh_source_ids_accept_the_prefixed_and_bare_forms() {
        let uuid_text = "3f7a1c2e-9b44-4d18-8a55-6c0d2e7b91af";
        assert!(source_id_ok(uuid_text), "裸 uuid 也收");
        assert!(source_id_ok(&format!("session-{uuid_text}")));
        // 真实 id 是 `session-<uuid>`：按 UUID 判会把它们全挡在门外。
        assert!(!source_id_ok("session-"));
        assert!(!source_id_ok("session-不是uuid"));
        assert!(!source_id_ok(""));
        // 标题一类自由文本绝不能进 argv/路径。
        assert!(!source_id_ok("我的分叉会话"));
        assert!(!source_id_ok("branch-3f7a1c2e-9b44-4d18-8a55-6c0d2e7b91af"));
    }

    /// 能力表里的这一行必须真的指向 dsh 的实现（表是唯一白名单）。
    #[test]
    fn dsh_is_registered_in_the_fork_support_table() {
        let support = super::super::fork::fork_support("dsh").expect("dsh 必须在能力表里");
        assert_eq!(support.engine, "dsh");
        assert!(
            support.derive_landing.is_some(),
            "dsh 的落盘路径可推导，登记时不该让 file_path 留空"
        );
        assert!((support.source_id_ok)("session-3f7a1c2e-9b44-4d18-8a55-6c0d2e7b91af"));
        assert!(!(support.source_id_ok)("not-a-session"));
    }
}
