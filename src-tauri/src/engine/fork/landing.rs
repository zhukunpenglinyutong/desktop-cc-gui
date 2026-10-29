//! 落盘与登记：写分支转录本、登记 `sessions` 行、失败回滚。

use super::*;
/// 登记分支，并把两条失败路径都收口成"连文件一起回滚"的 `Err`。
///
/// `register_fork_landing_with_path` 的 `Ok(false)`（文件不在、拒绝登记）**不是
/// 成功**：命令会返回一个看起来"已经落地"的 `ForkPlan`，而 `sessions` 行并不
/// 存在——分支页签打开就是 `session not found`，正是设计稿 §4.1 禁止的半状态。
/// 所以 `false` 与 `Err` 同等对待，都由这里删掉刚写的文件再报错。
pub(super) fn register_fork_or_rollback(
    db: &crate::db::Db,
    engine: &str,
    source_session_id: &str,
    target_session_id: &str,
    written: &Path,
    title: &str,
    degraded: &mut Vec<String>,
) -> Result<(), String> {
    let registered = register_fork_landing_with_path(
        db,
        engine,
        source_session_id,
        target_session_id,
        Some(&written.to_string_lossy()),
        Some(title),
        degraded,
    );
    match registered {
        Ok(true) => Ok(()),
        Ok(false) => {
            // 文件在写完与登记之间消失（外部删除、杀软隔离）：登记拒绝写一行指向
            // 不存在文件的记录，这里也没什么可回滚的，但绝不能报成功。
            cleanup_fork_artifact(engine, written);
            Err(format!(
                "分支转录本未被登记（文件不存在）: {}",
                written.display()
            ))
        }
        Err(error) => {
            cleanup_fork_artifact(engine, written);
            Err(error)
        }
    }
}


/// 按能力表回滚分支产物；查不到能力项时退化成"只删文件"（未知引擎本不该走到这里，
/// 但回滚路径不能因此 panic 或什么都不删）。
pub(super) fn cleanup_fork_artifact(engine: &str, written: &Path) {
    let cleanup = fork_support(engine)
        .map(|support| support.cleanup)
        .unwrap_or(remove_written_file);
    cleanup(written);
}


/// 回滚与"坏行"语义的回归用例。
#[cfg(test)]
mod artifact_tests {
    use super::*;

    fn temp_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("ccgui-{tag}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// dsh 的分支产物是目录 + 里面的转录本：回滚必须把目录一起删掉，否则那个
    /// `session-<uuid>` 一直被占着（下次同 id 复用会撞上"目录已被占用"）。
    #[test]
    fn dsh_rollback_removes_the_branch_directory_too() {
        let dir = temp_dir("dsh-rollback");
        let branch = dir.join("session-3f7a1c2e-9b44-4d18-8a55-6c0d2e7b91af");
        std::fs::create_dir_all(&branch).unwrap();
        let written = branch.join("session.v4.jsonl.zstd");
        std::fs::write(&written, b"x").unwrap();

        cleanup_fork_artifact("dsh", &written);

        assert!(!written.exists(), "转录本应被删掉");
        assert!(!branch.exists(), "分支目录应被删掉");
        assert!(dir.exists(), "上层目录不是我们的，不该动");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 单文件引擎（Claude / Codex）只删文件，不碰上层目录——那是引擎的会话目录，
    /// 里面还有别的会话。
    #[test]
    fn rollback_for_file_only_engines_keeps_the_engine_directory() {
        let dir = temp_dir("claude-rollback");
        let written = dir.join("8a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d.jsonl");
        std::fs::write(&written, b"x").unwrap();

        cleanup_fork_artifact("claude", &written);

        assert!(!written.exists());
        assert!(dir.exists(), "引擎会话目录不属于本次分叉，不能删");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 非 UTF-8 的行必须**原样搬过去**：`BufRead::lines()` 遇到它会直接报错，
    /// 与"坏行不使整个分叉失败"的契约相反。
    #[test]
    fn a_non_utf8_line_is_copied_verbatim_instead_of_failing_the_fork() {
        let dir = temp_dir("bad-utf8");
        let source = dir.join("source.jsonl");
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"{\"type\":\"x\"}\n");
        bytes.extend_from_slice(&[0xFF, 0xFE, b'\n']); // 非法 UTF-8 的一行
        bytes.extend_from_slice(b"\n"); // 空行：不写出去
        bytes.extend_from_slice(b"{\"type\":\"y\"}\n");
        std::fs::write(&source, &bytes).unwrap();

        let dest = dir.join("branch.jsonl");
        copy_plain_jsonl_prefix(&source, &dest, usize::MAX, |_| false).unwrap();

        let mut expected = Vec::new();
        expected.extend_from_slice(b"{\"type\":\"x\"}\n");
        expected.extend_from_slice(&[0xFF, 0xFE, b'\n']);
        expected.extend_from_slice(b"{\"type\":\"y\"}\n");
        assert_eq!(std::fs::read(&dest).unwrap(), expected);
        let _ = std::fs::remove_dir_all(&dir);
    }
}


/// Codex rollout 文件名里的时间戳段：`rollout-<YYYY-MM-DDTHH-MM-SS>-<id>.jsonl`，
/// 与 `codex` 自己以及 `scanner.rs` 测试里的既有命名同形。
///
/// 只用于**命名**、不参与身份判定，所以直接按 UTC 手算，不引入日期库。
pub(super) fn timestamp_slug() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    timestamp_slug_from_unix(secs)
}


/// 纯函数（便于测试）：Unix 秒 → `YYYY-MM-DDTHH-MM-SS`（UTC，前推格里历）。
/// 算法是 Howard Hinnant 的 `civil_from_days`，避免为一行格式化引入依赖。
pub(super) fn timestamp_slug_from_unix(secs: i64) -> String {
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (hour, minute, second) = (rem / 3_600, (rem % 3_600) / 60, rem % 60);
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { y + 1 } else { y };
    format!("{year:04}-{month:02}-{day:02}T{hour:02}-{minute:02}-{second:02}")
}


/// 中间分叉的落盘：把源转录本的前 `keep_records` 条记录复制成目标会话文件。
///
/// **必须在引擎 spawn 之前完成**：两个引擎随后都用普通续接读这个文件
/// （Claude `--resume <新id>`、Codex `thread/resume <新id>`），文件不在就失败。
///
/// 为什么两个引擎都自己复制、不用引擎侧的「原地裁剪」设施（设计稿 §2.4）：
/// - Claude **没有**历史裁剪设施（`--fork-session` 只能从末尾分叉）。
/// - Codex 的 `thread/rollback` 是**追加式**记录（`event_msg/thread_rolled_back`
///   + `num_turns`），被回退的轮次仍然留在转录本里。那样应用时间线会显示
///   模型**已经看不到**的内容——界面与模型上下文不一致。自己裁剪前缀则两者
///   天然一致，且两个引擎共用一套机制。
///
/// 命名、编码与身份改写都在能力表里（`ForkSupport::copy_prefix`），这里只负责
/// 取源会话与调用。复制不能内联成一个"按行搬"的循环：那种循环默认源转录本是
/// **明文 JSONL**，而 dsh 的转录本是多帧 zstd
/// （`history::extract::open_line_reader` 就是为它包了 `zstd::stream::read::Decoder`）
/// ——按行读只会读成二进制垃圾。这是**没写出来的假设**，比一个显式分支更危险：
/// 它不会编译失败，只会在新引擎上悄悄写出一个坏文件。
pub(crate) fn materialize_trimmed_fork(
    db: &crate::db::Db,
    engine: &str,
    source_session_id: &str,
    target_session_id: &str,
    keep_records: usize,
) -> Result<PathBuf, String> {
    let support = ensure_fork_supported(engine)?;
    let source = crate::history::reader::session_meta_by_id(db, engine, source_session_id)?
        .ok_or_else(|| format!("fork source vanished: {source_session_id}"))?;
    // 体积护栏由 `fork_session` 在**解析之前**统一把关
    // （`ensure_fork_source_within_limit`），这里不再重复检查：本函数是它唯一的
    // 调用方，两处判断会变成两个事实来源。
    (support.copy_prefix)(
        Path::new(&source.file_path),
        target_session_id,
        keep_records,
    )
}


/// 源转录本所在目录就是分支的落盘目录：同目录才能沿用引擎自己的发现规则（也绕开
/// workspace 路径编码的所有拼写假设）。
pub(super) fn source_dir(source_path: &Path) -> Result<&Path, String> {
    source_path
        .parent()
        .ok_or_else(|| format!("源转录本没有父目录: {}", source_path.display()))
}


/// 明文 JSONL 的前缀复制骨架：Claude 与 Codex 共用（dsh 是多帧 zstd，由它自己的
/// `copy_prefix` 写，不套这一层）。
///
/// 复制规则（设计稿 §2.3/§2.5）：
/// - 不挑行：辅助记录（`attachment` / `mode` / `system` / `turn_context` …）也要
///   搬，因为会话记录的 `parentUuid` 指向它们，只挑 user/assistant 会把链写坏。
/// - 坏行原样搬过去（CLI 容忍坏行，不为一行坏数据让整个分叉失败）。
/// - 目标用 `create_new`：目标是新 uuid 文件，不可能覆盖已有文件；失败即清理。
///
/// 身份改写由调用方以 `rewrite_identity` 注入（返回"这行改过没有"）：**改写规则
/// 逐引擎不同，故意不统一**——Claude 逐行改 `sessionId`，Codex 只改第一行的
/// `session_meta.payload.id`（见两个 `*_rewrite_identity` 的注释）。
pub(super) fn copy_plain_jsonl_prefix(
    source_path: &Path,
    dest: &Path,
    keep_records: usize,
    rewrite_identity: impl Fn(&mut serde_json::Value) -> bool,
) -> Result<PathBuf, String> {
    if dest.exists() {
        // 绝不"复用"同名文件：这个名字带的是**本次调用刚生成**的 UUIDv4，重试
        // 也只会拿到新 id，所以这里撞上同名文件说明那是别人的东西（上一轮失败
        // 留下的、用户手放的、另一个程序写的）。继续用就等于把一个无关转录本
        // 登记成分支——比报错糟得多。`create_new` 本来就拒绝覆盖，这里提前一步
        // 把冲突说清楚。
        return Err(format!("分支转录本路径已被占用: {}", dest.display()));
    }

    let file = std::fs::File::open(source_path).map_err(|e| format!("打开源转录本失败: {e}"))?;
    let mut reader = std::io::BufReader::new(file);
    use std::io::{BufRead, Write};
    let mut out = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(dest)
        .map_err(|e| format!("创建分支转录本失败: {e}"))?;

    let write_result = (|| -> Result<(), String> {
        // 按**字节**读，不按 `String` 行读：`BufRead::lines()` 遇到非 UTF-8 字节会
        // 直接返回 `InvalidData`，整个分叉跟着失败——而这里的契约是"坏行原样搬过去"。
        // 转录本原则上都是 UTF-8，但只要有一行不是，用户就分叉不了、且报错信息与
        // 真实原因（"这一行不是 UTF-8"）对不上。按字节读之后，能解析成 JSON 的就
        // 改写身份，解不出来的（含非 UTF-8）原样写出，行为与注释一致。
        let mut buffer: Vec<u8> = Vec::new();
        let mut index = 0usize;
        loop {
            if index >= keep_records {
                break;
            }
            buffer.clear();
            let read = reader
                .read_until(b'\n', &mut buffer)
                .map_err(|e| format!("读取源转录本失败: {e}"))?;
            if read == 0 {
                break;
            }
            // 去掉行尾换行（`lines()` 同样会去掉 `\n` 与紧随的 `\r`）。
            if buffer.last() == Some(&b'\n') {
                buffer.pop();
                if buffer.last() == Some(&b'\r') {
                    buffer.pop();
                }
            }
            index += 1;
            // 空行不写出去（与旧行为一致）；行号照旧计入 `keep_records`，因为切点
            // 给的是**源行号**。
            if buffer.iter().all(|byte| byte.is_ascii_whitespace()) {
                continue;
            }
            let rewritten: Vec<u8> = match std::str::from_utf8(&buffer) {
                // 非 UTF-8：原样搬（无法解析 JSON，也就无从改写身份）。
                Err(_) => buffer.clone(),
                Ok(text) => match serde_json::from_str::<serde_json::Value>(text) {
                    Ok(mut value) => {
                        if rewrite_identity(&mut value) {
                            serde_json::to_string(&value)
                                .map_err(|e| format!("序列化记录失败: {e}"))?
                                .into_bytes()
                        } else {
                            buffer.clone()
                        }
                    }
                    // 坏行（CLI 容忍）原样搬过去，不因为一行坏数据让整个分叉失败。
                    Err(_) => buffer.clone(),
                },
            };
            out.write_all(&rewritten)
                .map_err(|e| format!("写入分支转录本失败: {e}"))?;
            out.write_all(b"\n")
                .map_err(|e| format!("写入分支转录本失败: {e}"))?;
        }
        out.flush().map_err(|e| format!("刷新分支转录本失败: {e}"))
    })();

    if let Err(error) = write_result {
        // 半成品绝不能留在引擎的会话目录里被当成一个真会话：删掉再报错。
        drop(out);
        let _ = std::fs::remove_file(dest);
        return Err(error);
    }
    Ok(dest.to_path_buf())
}


/// Claude 没被点名落盘路径时的推导（`ForkSupport::derive_landing`）。
///
/// 落盘位置与名字：**与源文件同目录** + `<新id>.jsonl`。`--resume` 按文件名 stem
/// 定位转录本，所以名字只能由新 id 决定，不能带别的东西；行内的 `sessionId` 必须
/// 与它一致（见 `claude_rewrite_identity`）。
pub(super) fn claude_derive_landing(source_path: &Path, target_session_id: &str) -> Result<PathBuf, String> {
    Ok(source_dir(source_path)?.join(format!("{target_session_id}.jsonl")))
}


/// Claude 的身份改写：**逐行**改顶层 `sessionId`（文件名 stem 与行内 id 必须一致，
/// CLI 按 stem 定位）。没有这个键的记录（辅助记录、坏行）原样搬。
pub(super) fn claude_rewrite_identity(value: &mut serde_json::Value, target_session_id: &str) -> bool {
    let Some(object) = value.as_object_mut() else {
        return false;
    };
    if !object.contains_key("sessionId") {
        return false;
    }
    object.insert(
        "sessionId".to_string(),
        serde_json::Value::String(target_session_id.to_string()),
    );
    true
}


/// Claude 的前缀复制：明文 JSONL 按行搬，逐行改身份（见 `claude_rewrite_identity`）。
pub(super) fn claude_copy_prefix(
    source_path: &Path,
    target_session_id: &str,
    keep_records: usize,
) -> Result<PathBuf, String> {
    let dest = claude_derive_landing(source_path, target_session_id)?;
    copy_plain_jsonl_prefix(source_path, &dest, keep_records, |value| {
        claude_rewrite_identity(value, target_session_id)
    })
}


/// Codex 的前缀复制：明文 JSONL 按行搬，身份只改第一行的 `session_meta`
/// （见 `codex_rewrite_identity`）。落盘形状是 `rollout-<ts>-<新id>.jsonl`，
/// 与源文件同目录。
///
/// `discovery.rs` 的 `codex_candidates()` 只收 `rollout-*.jsonl`（按
/// `starts_with("rollout-")` 判断），写成 `<新id>.jsonl` 会被自己的扫描器永久忽略——
/// 登记时也就拿不到路径、分支页签读不到历史。注意：CLI 自己 resume 时**不看**
/// 文件名（§5.3），但应用侧看，两边要求不同。
///
/// 这里也是 Codex 的 `derive_landing` 为 `None` 的原因：名字里的时间戳是**落盘
/// 那一刻**取的，事后推不出同名文件。
pub(super) fn codex_copy_prefix(
    source_path: &Path,
    target_session_id: &str,
    keep_records: usize,
) -> Result<PathBuf, String> {
    let dest = source_dir(source_path)?.join(format!(
        "rollout-{}-{target_session_id}.jsonl",
        timestamp_slug()
    ));
    copy_plain_jsonl_prefix(source_path, &dest, keep_records, |value| {
        codex_rewrite_identity(value, target_session_id)
    })
}


/// Codex 的身份改写：线程身份在**第一行**的 `session_meta.payload.id`。
/// CLI 按**内容里的这个 id** 发现会话（§5.3），文件名不参与定位
/// ——`rollout-<ts>-<id>.jsonl` 与 `<id>.jsonl` 两种命名都能 resume，所以这里不必
/// 迁就文件名约定。
///
/// **不动 `cwd`**：分支必然与源会话同工作区，rollout 里记的就是正确路径；改写它
/// 等于引入一个可能不一致的来源（DB 的 workspace_path vs rollout 的 cwd），只会
/// 在两者拼写不同时悄悄把分支跑到别处。少改一个字段就少一个出错面。
pub(super) fn codex_rewrite_identity(value: &mut serde_json::Value, target_session_id: &str) -> bool {
    let Some(object) = value.as_object_mut() else {
        return false;
    };
    if object.get("type").and_then(serde_json::Value::as_str) != Some("session_meta") {
        return false;
    }
    let Some(payload) = object
        .get_mut("payload")
        .and_then(serde_json::Value::as_object_mut)
    else {
        return false;
    };
    payload.insert(
        "id".to_string(),
        serde_json::Value::String(target_session_id.to_string()),
    );
    true
}


/// 把源会话的内部帧身份整份复制到分支（设计稿 §4.1 步骤 7），**一条语句**。
///
/// 为什么不用设计稿点名的 `db.record_accepted_internal_frame_hash`：那是个按条写入
/// 的 helper，**没有任何上限**（上限只存在于 IPC 命令
/// `reader::record_accepted_internal_frame` 里），逐条调用会让一次分叉产生 2N 条
/// 语句（每条还各删一次 `fts_state`）；它返回的 `Ok(false)` 意思是"这条身份已经
/// 在了"，与"超限"毫无关系。这里的复制是 `INSERT ... SELECT`：一次读写、与源集合
/// 一一对应，并按与那条 IPC 路径**同一组常量**把关。
///
/// 装不下就报错，而不是少复制几条：少复制意味着分支会把本该隐藏的内部帧显示出来，
/// 而命令仍报成功——从界面上看不出分支与源会话的差别。这与
/// `record_accepted_internal_frame` 在上限处报错是同一个理由。
pub(super) fn copy_accepted_frames(
    conn: &rusqlite::Connection,
    engine: &str,
    source_session_id: &str,
    target_session_id: &str,
    workspace_path: &str,
    source_count: usize,
) -> Result<(), String> {
    if source_count == 0 {
        return Ok(());
    }
    // 与 IPC 那条路径同一把尺子：先看分支这一行自己还剩多少，再看全表。
    let (target_count, total): (i64, i64) = conn
        .query_row(
            "SELECT
                (SELECT COUNT(*) FROM accepted_internal_frames
                  WHERE engine=?1 AND session_id=?2),
                (SELECT COUNT(*) FROM accepted_internal_frames)",
            rusqlite::params![engine, target_session_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| format!("读取已记录的内部帧身份数失败: {e}"))?;
    let headroom = (MAX_RECORDED_FRAMES_PER_SESSION - target_count)
        .min(MAX_RECORDED_FRAMES_TOTAL - total)
        .max(0);
    if source_count as i64 > headroom {
        return Err(format!(
            "已记录的内部帧身份已达上限（每会话 {MAX_RECORDED_FRAMES_PER_SESSION} / 全局 {MAX_RECORDED_FRAMES_TOTAL}），无法把源会话的 {source_count} 条身份复制到分支，分叉已取消"
        ));
    }
    conn.execute(
        "INSERT OR IGNORE INTO accepted_internal_frames(engine, session_id, frame_hash, workspace_path)
         SELECT ?1, ?2, frame_hash, ?3 FROM accepted_internal_frames
          WHERE engine=?1 AND session_id=?4
          ORDER BY rowid
          LIMIT ?5",
        rusqlite::params![
            engine,
            target_session_id,
            workspace_path,
            source_session_id,
            source_count as i64
        ],
    )
    .map_err(|e| format!("复制已记录的内部帧身份失败: {e}"))?;
    // 与 IPC 那条路径同一个理由：FTS 标记只看文件 stat + INDEX_VERSION，而分支
    // 转录本里搬过来的内部帧可能已经被索引过，不删标记它们就永久可搜。整批删
    // 一次就够，不必每插入一条删一次。
    conn.execute(
        "DELETE FROM fts_state WHERE engine=?1 AND session_id=?2",
        rusqlite::params![engine, target_session_id],
    )
    .map_err(|e| format!("重置分支会话索引标记失败: {e}"))?;
    Ok(())
}


/// 分叉落地后把新会话登记进应用自己的表。
///
/// 前缀文件先由 `materialize_trimmed_fork` 写好，随后必须补上这一行，否则：
///   - 侧栏不会出现这条分支（`emit_sessions_changed` 只重读表、不重扫）；
///   - 打开分叉 tab 时 `load_session_page` 会报 `session not found`。
///
/// 会话记忆（model / effort / provider）从**源会话**复制；标题由**调用方**给定
/// （`fork_session` 已用 `next_fork_title` 拼好 `<源会话当前名> (fork #N)`），
/// 调用方没给才退回来源的当前名本身。
/// `explicit_path` 可点名转录本真正的落盘路径（省略时按能力表推导：
/// `ForkSupport::derive_landing`；推不出来的引擎 `file_path` 留空交给扫描器补）。
/// 文件还不存在就返回 `Ok(false)`，绝不登记一条指向不存在文件的记录；**调用方
/// 必须把 `false` 当失败**（`register_fork_or_rollback` 会连文件一起回滚）。
pub(crate) fn register_fork_landing_with_path(
    db: &crate::db::Db,
    engine: &str,
    source_session_id: &str,
    target_session_id: &str,
    explicit_path: Option<&str>,
    title: Option<&str>,
    degraded: &mut Vec<String>,
) -> Result<bool, String> {
    let source = crate::history::reader::session_meta_by_id(db, engine, source_session_id)?
        .ok_or_else(|| format!("fork source vanished: {source_session_id}"))?;
    let source_path = Path::new(&source.file_path);

    // 与 §2.5 的身份规则一致：能推导落盘路径的引擎（Claude 按**文件名 stem**
    // 定位，位置就是源文件所在目录——直接复用，绕开 workspace 路径编码的所有
    // 拼写假设）走 `ForkSupport::derive_landing`；推不出来的引擎（Codex 的
    // rollout 名由 `materialize_trimmed_fork` 按 `rollout-<ts>-<id>.jsonl` 自己
    // 起名、并由调用方**点名**报上来）宁可留空 `file_path` 交给扫描器补，也不猜
    // 一个可能不对的路径。
    let target = match explicit_path {
        // 调用方点名了落盘路径：直接用它。
        Some(path) if !path.trim().is_empty() => Some(PathBuf::from(path)),
        _ => match fork_support(engine).and_then(|support| support.derive_landing) {
            Some(derive_landing) => Some(derive_landing(source_path, target_session_id)?),
            // 既没报路径、又推不出来：不猜文件名，先登记一行让分支在侧栏出现，
            // `file_path` 留空交给扫描器补。
            None => None,
        },
    };
    if let Some(target) = target.as_ref() {
        if !target.is_file() {
            // 文件不在就拒绝登记（`Ok(false)`），绝不写一行指向不存在文件的记录。
            // 调用方**必须**把它当失败（见 `register_fork_or_rollback`）：没有
            // "下一次发送再试"这条路，命令报成功而表里没有行就是半状态。
            return Ok(false);
        }
    }
    let path_for_row = target
        .as_ref()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();

    // 帧身份：复制源会话的记录集（设计稿 §4.1 步骤 7）。不复制的话，分支里被
    // 隐藏的 CCGUI 内部帧会重新显示出来——新 id 的记录集为空，等于"从未接受过
    // 任何帧"。分支摘要也要按这套身份算（决定哪些帧该被隐藏），所以先取出来。
    let (frames, _) = db.accepted_internal_frames(engine, source_session_id)?;
    let source_frame_count = frames.len();

    // 摘要来自真实文件，不臆测（标题/预览/时间/条数都由解析得出）。
    // 路径未知（调用方没点名、能力表也推不出来，见上面的 `derive_landing`）时留空
    // 统计值，扫描器随后补齐。
    let (summary, size, mtime_ms) = match target.as_ref() {
        Some(path) => {
            let summary = crate::history::scan_summary_file(engine, path, &frames)?;
            let (size, mtime_ms) = crate::history::stat_signature(path)
                .ok_or_else(|| format!("无法读取分支转录本: {}", path.display()))?;
            (summary, size, mtime_ms)
        }
        None => (
            crate::history::ScanSummary {
                title: String::new(),
                preview: String::new(),
                first_ts: None,
                last_ts: None,
                message_count: 0,
            },
            0,
            0,
        ),
    };
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let created_at = summary.first_ts.or(Some(mtime_ms));
    let updated_at = summary.last_ts.or(Some(mtime_ms));
    // `custom_title`（侧栏标签）用**调用方给的分支标题**：`fork_session` 已经用
    // `next_fork_title` 拼好 `<源会话当前名> (fork #N)`（后缀语言中立，不需要前端
    // 造句）。调用方没给就退回来源的当前名本身——**不加后缀**：宁可少一个标记，
    // 也不在这里写死一种语言的后缀。
    let custom_title = title
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            source
                .custom_title
                .clone()
                .filter(|t| !t.trim().is_empty())
                .unwrap_or_else(|| source.title.clone())
        });
    let custom_title = custom_title.trim().to_string();
    // ⚠️ `title` 列必须写**扫描推导出来的标题**（`summary.title`），不能写分支标
    // 题。两列共用同一个值会同时坏两件事：
    //
    //   1. `title` 本该是"转录本第一条用户消息"，写成 `… (fork #N)` 就让这一行的
    //      `title` 在一段时间内是假的——未重扫的行在侧栏回退显示分支标题，重扫过的
    //      行显示推导标题，同一批分支显示不一致。
    //   2. `title` 是**未改名会话的有效名**（`taken_titles` 两列先折成一个名字），
    //      于是分支自己会被数成源会话的同级：`A` 的 #1 分支把标题写进 `title`
    //      之后，下一个分支从「同级最大值」算出来就是 #3（#1 是它自己）。等某次
    //      重扫把 `title` 覆盖成推导标题，编号又变回 #2——**同一个操作因中间是否
    //      发生重扫而拿到不同编号**。
    //
    // 结论：分支编号只由 `custom_title` 决定；`title` 只做转录本的忠实投影。
    let title = summary.title.trim().to_string();
    // 内部帧身份 + `sessions` 行 + `custom_title` 写在**同一个事务**里（形状照
    // scanner.rs 的既有写法：`db.0.lock()` → `conn.transaction()`）：三条写入要么
    // 全成、要么全不成。INSERT 成功而 UPDATE 失败会留下一条没有标题的孤儿行；
    // 帧身份写进去而 `sessions` 行没写成，会留下一个没有会话的记录集——扫描和
    // `remove_workspace` 都再也认不出它，而调用方只删得掉文件。
    {
        let mut conn = db.0.lock();
        let tx = conn
            .transaction()
            .map_err(|e| format!("开始登记事务失败: {e}"))?;
        copy_accepted_frames(
            &tx,
            engine,
            source_session_id,
            target_session_id,
            &source.workspace_path,
            source_frame_count,
        )?;
        // 写进 sessions 行的是**复制后**的记录集签名，所以在同一个事务里按目标
        // 会话重新派生：省略该列会得到 ''（该列 NOT NULL DEFAULT ''），与
        // accepted_internal_frames 派生出来的值不一致——扫描器据此判断"这一行有
        // 哪些帧被隐藏"，签名不对就会重新显示或漏隐藏。
        let (_, signature) =
            crate::db::accepted_internal_frames_from(&tx, engine, target_session_id)?;
        tx.execute(
            "INSERT INTO sessions(engine, session_id, workspace_path, file_path, file_size,
                                  file_mtime_ms, title, preview, created_at, updated_at,
                                  message_count, accepted_frames_signature)
             VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)
             ON CONFLICT(engine, session_id) DO UPDATE SET
                workspace_path=excluded.workspace_path,
                file_path=excluded.file_path,
                file_size=excluded.file_size,
                file_mtime_ms=excluded.file_mtime_ms,
                title=excluded.title,
                preview=excluded.preview,
                updated_at=excluded.updated_at,
                message_count=excluded.message_count,
                accepted_frames_signature=excluded.accepted_frames_signature",
            rusqlite::params![
                engine,
                target_session_id,
                source.workspace_path,
                path_for_row,
                size,
                mtime_ms,
                title,
                summary.preview,
                created_at,
                updated_at,
                summary.message_count,
                signature,
            ],
        )
        .map_err(|e| format!("登记分支会话失败: {e}"))?;
        // upsert_rows 不碰 custom_title；分叉要显式设它，否则侧栏会退回
        // 从转录本推导的原标题，看不出这是分支。分支编号的唯一来源就是这一列。
        tx.execute(
            "UPDATE sessions SET custom_title=?3 WHERE engine=?1 AND session_id=?2",
            rusqlite::params![engine, target_session_id, custom_title],
        )
        .map_err(|e| format!("设置分支标题失败: {e}"))?;
        tx.commit()
            .map_err(|e| format!("登记分支会话失败: {e}"))?;
    }
    // 会话记忆三行：复用现成 helper，不手写 SQL（设计稿 §4.1 步骤 9）。
    //
    // 写失败**不回滚**分支——文件和 `sessions` 行此刻都已成立，为三行"记住上次用的
    // 模型"把整个分支删掉是本末倒置。但也**不能静默**：静默的后果是分支悄悄用引擎默认
    // 模型跑，用户以为是原会话那一套。所以逐项记日志、如实报告降级，不留 `let _ =`。

    if let Some(model) = source.model.as_deref().filter(|m| !m.trim().is_empty()) {
        if let Err(e) = db.remember_session_model(engine, target_session_id, model, now) {
            degraded.push("model".into());
            eprintln!("[fork] 分支 {target_session_id} 未能继承模型（{e}）");
        }
    }
    if let Some(effort) = source.effort.as_deref().filter(|e| !e.trim().is_empty()) {
        if let Err(e) = db.remember_session_effort(engine, target_session_id, effort, now) {
            degraded.push("effort".into());
            eprintln!("[fork] 分支 {target_session_id} 未能继承思考档位（{e}）");
        }
    }
    if let Some(provider) = source.provider.as_deref().filter(|p| !p.trim().is_empty()) {
        if let Err(e) = db.remember_session_provider(engine, target_session_id, provider, now) {
            degraded.push("provider".into());
            eprintln!("[fork] 分支 {target_session_id} 未能继承供应商（{e}）");
        }
    }

    Ok(true)
}

