//! 会话分叉（Fork Conversation）。
//!
//! 设计稿：`docs/design/session-fork-conversation.zh-CN.md`。
//!
//! 两条落地路径：
//!
//! - **tip 分叉**（分叉点就是源会话末尾）—— 复制整份源转录本（`keep_records`
//!   为 `usize::MAX`），与中间分叉共用同一套「写前缀 + 登记」机制。
//! - **中间分叉**（分叉点更早）—— 复制源转录本的记录前缀写成目标会话文件，
//!   之后按普通 `--resume <新id>` 续接。
//!
//! **点击即落盘**：`fork_session` 命令内完成切点解析、前缀文件写入与 `sessions`
//! 行登记，返回时分叉会话已经存在，不经过发送路径。
//!
//! **引擎差异只有一处**：全部收口在 `ForkSupport` 能力表。主流程（解析切点 → 写
//! 前缀 → 登记 → 回滚）里没有一个引擎特判，接入新引擎只需要给表加一行。
//!
//! 分叉点一律落在**完整轮次**（提问 + 回答）边界上：只有提问没有回答的半截
//! 轮次不值得保留，分叉时丢掉它是正确行为。

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

// 帧身份的上限与 IPC 那条路径（`reader::record_accepted_internal_frame`）共用一组
// 常量：分叉复制的是同一张表里的同一批身份，两处各写一个数字必然漂移。
use crate::history::reader::{MAX_RECORDED_FRAMES_PER_SESSION, MAX_RECORDED_FRAMES_TOTAL};

mod anchor;
mod landing;
mod title;

use anchor::*;
use landing::*;
use title::*;

// anchor_turn 要给同层的 fork_dsh 用，按 crate 可见性单独再导出。
pub(crate) use anchor::anchor_turn;

// 这两个名字对外是 pub（web::dispatch 与 fork_dsh 都要用）。
pub use anchor::{text_sha256_hex, ForkAnchor};

/// `fork_session` 的返回：**已经落地**的分支（命令内已完成前缀文件写入与
/// `sessions` 行登记，前端拿 `target_session_id` 建 tab 即可直接读历史）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForkPlan {
    /// 分叉来源会话 id。
    pub source_session_id: String,
    /// 来源会话的引擎。
    pub source_engine: String,
    /// 来源会话的工作区（`sessions.workspace_path`）——**不是**调用方当前所在的
    /// 工作区。分支行按它登记，Claude 的 `--resume <新id>` 又只在 cwd 所属工程
    /// 目录里找转录本：前端必须按它建 tab，否则分支的第一条消息会在另一个 cwd
    /// 里 spawn，转录本也可能定位不到。
    pub workspace_path: String,
    /// 为分支分配的新会话 id（UUIDv4）。Claude 侧它必须同时是文件名 stem
    /// 与每行的 `sessionId`（`--resume` 按 stem 定位且校验 UUID 合法性）。
    pub target_session_id: String,
    /// 分叉点是否落在来源末尾：等价于**整份转录本都被搬了过去**
    /// （`keep_records == usize::MAX`）——锚点正好是最后一轮时同样成立。
    pub at_tip: bool,
    /// 分支保留的源记录条数（`usize::MAX` = 保留整个文件）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keep_records: Option<usize>,
    /// 来源会话**当前名**（`custom_title` 非空则用它，否则用转录本推导的 `title`），
    /// 供前端立即显示分支标题。命名规则 `<源会话当前名> (fork #N)` 就建在它上面：
    /// 分支标题从这里**追加**，不从中剥离任何东西（见 `next_fork_title`）。
    pub source_title: String,
    /// 已降级、但仍算成功的项（目前是链路最后一步的会话记忆：`model` / `effort` /
    /// `provider`）。分支**已经成立**，只是这几项没继承上——首轮会用引擎默认值，
    /// 前端要据此提示用户，而不是让他以为"和原会话一样"。
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub degraded: Vec<String>,
}

/// 分叉会话 id 的形状校验：必须是合法 UUID。
///
/// Claude 的 `--resume` 会拒绝非 UUID 且非标题的值
/// （`is not a UUID and does not match any session title`），因此新 id 只能是
/// UUIDv4。来源 id 同样要求是 UUID，避免把标题一类自由文本拼进 argv。
///
/// 它只是能力表里两行的 `source_id_ok`（这两个引擎的来源 id 都是 UUID），
/// **不是**所有引擎的通用判据：id 形状不同的引擎在表里换掉这一项即可。
pub fn is_uuid(value: &str) -> bool {
    uuid::Uuid::parse_str(value).is_ok()
}

/// 与 parse_session_file 一样的单行解析：坏行跳过，不使整个文件失败。
pub(crate) fn parse_json_line(line: &str) -> Option<serde_json::Value> {
    let trimmed = line.trim();
    if trimmed.is_empty() || !trimmed.contains('"') {
        return None;
    }
    serde_json::from_str::<serde_json::Value>(trimmed).ok()
}

/// 一个引擎的分叉能力：`fork_session` 全流程里**所有**引擎差异都收口在这里。
///
/// 为什么是一张表，而不是 `Engine` trait 上的方法：`Engine` 的方法都在**发送/启动**
/// 路径上被查询（`drives_own_transport` 每次 `send_reserved` 都要问一遍），而分叉
/// 能力只在 `fork_session` 这条命令里查一次。挂到 trait 上，另外十个永远不可能分叉
/// 的引擎都得跟着实现一遍或吃一个空默认实现——AGENTS.md 明确不为猜测中的未来需求
/// 引入抽象。
///
/// **下一个引擎怎么接**：
/// - 切点规则与落盘形状都能复用现成的（又一类明文 JSONL）→ 表里加一行，能力项
///   直接指向现成函数；
/// - 需要新的切点语义或新的落盘形状（近在眼前的例子是 dsh：转录本是**多帧
///   zstd**、切点也得走它自己的提取器）→ 把实现放进**新文件**，表里加一行指向它；
/// - 这件事不必动：`fork_session` 的编排（体积护栏 → 解析 → 标题 → 落盘 → 登记
///   → 回滚）、命令注册、标题编号、内部帧复制的那条事务。
///
/// 反过来，下面这些**故意没有**统一，别在后续重构里"顺手"合并（AGENTS.md：
/// 有明确语义差异的实现不强行统一）：
/// - `keep_count`：Claude 切在下一条可见 user 记录（它的记录链线性、没有轮次
///   标记），Codex 必须切在锚点轮的结束标记（`task_complete` 或 `turn_aborted`）之后。锚点没命中时的不对称
///   也是故意的：Claude 的末轮返回整份文件，Codex 的未完成轮返回 `None`（明确
///   报错），不是"失败就取尾巴"。
/// - 身份改写：Claude 逐行改 `sessionId`，Codex 只改第一行的 `session_meta.payload.id`
///   且刻意不碰 `cwd`。做成"可配置的字段列表"，就把"少改一个字段就少一个出错面"
///   这个结论换成了猜谜。
/// - 落盘命名：Claude `<新id>.jsonl`、Codex `rollout-<ts>-<新id>.jsonl`
///   （`discovery.rs` 的 `codex_candidates()` 只收 `rollout-` 前缀）。不是路径模板。
pub(crate) struct ForkSupport {
    /// 引擎 id：与 `sessions.engine`、`Engine::id()` 同值，表按它查。
    pub engine: &'static str,
    /// 该引擎能当**分叉来源**的会话 id 形状。
    ///
    /// 不能统一成 UUID 判据：`--resume` 只收 UUID、也拒绝标题一类的自由文本进
    /// argv，那是 Claude 自己的文件名约束；dsh 的真实 id 是 `session-<uuid>`，
    /// 按 UUID 判会把它们全挡在门外。分支新 id 的形态见 `target_id`，与本项无关。
    pub source_id_ok: fn(&str) -> bool,
    /// 分支新 id 的形态。
    ///
    /// Claude / Codex 是**裸 UUIDv4**（Claude 的 `--resume` 按文件名 stem 定位并校验它
    /// 是合法 UUID，多一截前缀会被拒）；dsh 的规范 id **带 `session-` 前缀**——目录名、
    /// header 的 `id`、host 自建的投影缓存键都是这个形态。
    ///
    /// 这个形态必须**处处一致**。host 按**传入的 id** 建投影缓存：磁盘用 `session-<uuid>`
    /// 而 IPC 传裸 UUID 时，投影会与转录本错开，模型读不到继承的对话（界面上有历史，
    /// agent 却说没有上下文）。
    pub target_id: fn() -> String,
    /// 记录级切点：分支保留源转录本的前几条记录。
    ///
    /// 这里要的是"这个引擎怎么**定位**切点"，而不是第二个"哪条原始记录算用户
    /// 消息"的判据——锚点是哪一轮由 `anchor_turn` 统一判（理由见那里的注释）。
    /// 最后一个参数是已接受的内部帧身份，`user_row_lines` 需要它才与提取器同源。
    pub keep_count: fn(
        &Path,
        &ForkAnchor,
        &[crate::history::Message],
        &std::collections::HashSet<String>,
    ) -> Option<usize>,
    /// 写出分支转录本（命名 + 编码 + 身份改写 + 失败清理），返回真正落盘的路径。
    ///
    /// 参数是 `(源转录本路径, 分支新 id, 保留记录数)`。命名与编码都留在里面，因为
    /// "复制前缀"这件事本身就依赖它们：明文 JSONL 可以按行搬，dsh 的多帧 zstd
    /// 不行。别把它拆成"命名" + "通用复制"两半。
    pub copy_prefix: fn(&Path, &str, usize) -> Result<PathBuf, String>,
    /// 没被点名落盘路径时的推导（`register_fork_landing_with_path` 用）。
    ///
    /// `None` = 这个引擎推不出来：宁可让 `file_path` 留空交给扫描器补，也不猜一个
    /// 可能不对的路径——Codex 的 rollout 名里带着落盘时刻的时间戳，事后造不出同名
    /// 文件。
    pub derive_landing: Option<fn(&Path, &str) -> Result<PathBuf, String>>,
    /// 回滚时删掉刚写出的分支产物（参数是 `copy_prefix` 返回的落盘路径）。
    ///
    /// 为什么需要按引擎区分：dsh 的分支是**目录 + 目录里的转录本**
    /// （`session-<uuid>/session.v<N>.jsonl.zstd`）。只删文件会留下一个空目录，
    /// 那个 id 仍然被占着，同 id 复用时会撞上 `copy_prefix` 的"目录已被占用"判定。
    /// 其余两个引擎的分支就是单个文件。
    pub cleanup: fn(&Path),
}

/// 回滚：删掉写出的分支文件。Claude / Codex 的分支产物就是这一个文件。
fn remove_written_file(written: &Path) {
    let _ = std::fs::remove_file(written);
}

/// 能力表：**唯一**的分叉白名单（查不到 = 该引擎暂不支持会话分叉）。
///
/// 前端 `src/features/chat/fork.ts` 的 `FORK_ENGINES` 是这张表的镜像，加引擎时
/// 两处一起改（前端没有别的办法知道后端收了哪些引擎）。
const FORK_SUPPORT: &[ForkSupport] = &[CLAUDE_FORK, CODEX_FORK, super::fork_dsh::DSH_FORK];

/// 按引擎 id 查能力表。两行数据线性查，不为此引入 map。
pub(crate) fn fork_support(engine: &str) -> Option<&'static ForkSupport> {
    FORK_SUPPORT.iter().find(|support| support.engine == engine)
}

/// 未登记能力的引擎一律拒绝；解析与落盘两条入口共用同一句话，免得同一种拒绝
/// 出现两种说法。
fn ensure_fork_supported(engine: &str) -> Result<&'static ForkSupport, String> {
    fork_support(engine).ok_or_else(|| format!("该引擎暂不支持会话分叉: {engine}"))
}

/// Claude：明文 JSONL 转录本，`--resume <新id>` 按文件名 stem 定位转录本。
const CLAUDE_FORK: ForkSupport = ForkSupport {
    engine: "claude",
    source_id_ok: is_uuid,
    target_id: new_bare_uuid,
    keep_count: fork_keep_count,
    copy_prefix: claude_copy_prefix,
    derive_landing: Some(claude_derive_landing),
    cleanup: remove_written_file,
};

/// 分支新 id（Claude / Codex）：**裸 UUIDv4**。
///
/// Claude 的 `--resume` 会把文件名 stem 当 id 校验，多一截前缀直接拒绝；Codex 的文件名
/// 不参与定位，裸 UUID 同样够用。
fn new_bare_uuid() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Codex：明文 JSONL rollout，`thread/resume <新id>` 按内容里的线程 id 定位
/// （文件名不参与，见 `codex_rewrite_identity`）。
const CODEX_FORK: ForkSupport = ForkSupport {
    engine: "codex",
    source_id_ok: is_uuid,
    target_id: new_bare_uuid,
    keep_count: fork_keep_count_codex,
    copy_prefix: codex_copy_prefix,
    derive_landing: None,
    cleanup: remove_written_file,
};

/// dsh：多帧 zstd 转录本，落在 `<源目录>/session-<新id>/session.v<N>.jsonl.zstd`
/// （目录名与 header 的 `id` 必须逐字相等）。切点、编码、身份改写都在
/// `fork_dsh.rs` 里——dsh 的差异不是"路径拼法"而是整条落盘形状，所以按能力表的
/// 规矩单独一个文件。来源 id 是 `session-<uuid>`（也收裸 uuid），**分支新 id 也带
/// `session-` 前缀**（与它的目录名/header/host 投影缓存键同形，见 `target_id`）。
///
/// 这里不另放一个 `const DSH_FORK` 别名：表里直接写 `super::fork_dsh::DSH_FORK`，
/// 别名只会多一处没人读的常量（会触发 `dead_code` 警告）。

/// 解析一次分叉请求：定位源会话、校验形状、算出记录级切点、分配新 id。
///
/// 只做解析与分配；写前缀文件与登记 `sessions` 行由 `fork_session` 接着完成。
///
/// 分叉可搬动的源转录本体积上限（与 `reader.rs` 的 `MAX_REMOTE_SESSION_BYTES`
/// 同口径，设计稿 §5）。超过就明确报错，不做同步大复制。
const MAX_FORK_SOURCE_BYTES: u64 = 64 * 1024 * 1024;

/// 超限就拒绝，且**在读任何内容之前**执行（见 `fork_session` 的调用位置）。
///
/// 明文转录本（Claude / Codex）直接看 `metadata().len()`——基本不碰文件内容，是最
/// 廉价的入口检查；拿不到元信息时不放行也不误拒，报错让人看到问题。
///
/// **压缩转录本（dsh 的 zstd）必须看解码后的字节数**：`metadata()` 给的是压缩后
/// 大小（实测压缩比约 2.7×），拿它比 64 MiB 等于把真实上限放宽到 ~170 MiB，而这条
/// 路径上会把源文件解码好几遍（解析、数锚点、找 `turn/end`、复制前缀）。
/// 这里流式解码到上限即停，代价是一次**有界**读取，不是整份解码。
fn ensure_fork_source_within_limit(
    db: &crate::db::Db,
    engine: &str,
    session_id: &str,
) -> Result<(), String> {
    let source = crate::history::reader::session_meta_by_id(db, engine, session_id)?
        .ok_or_else(|| format!("session not found: {engine}/{session_id}"))?;
    let path = std::path::Path::new(&source.file_path);
    let compressed_bytes = std::fs::metadata(path)
        .map_err(|e| format!("读取源会话大小失败({}): {e}", source.file_path))?
        .len();
    let bytes = if source.file_path.ends_with(".zstd") {
        decompressed_len_bounded(path).unwrap_or(compressed_bytes)
    } else {
        compressed_bytes
    };
    if bytes > MAX_FORK_SOURCE_BYTES {
        return Err(format!(
            "源会话转录本 {} MiB 超过 {} MiB 上限，已拒绝分叉",
            bytes / (1024 * 1024),
            MAX_FORK_SOURCE_BYTES / (1024 * 1024),
        ));
    }
    Ok(())
}

/// 流式解码到上限就停的字节计数（只给压缩转录本用，见调用处）。
///
/// 返回 `None` 表示解码不出来（文件损坏 / 编码器不认识）——调用方退回按压缩后
/// 大小判断，并让真正的解析去报具体错误，而不是在这里武断拒绝。
fn decompressed_len_bounded(path: &std::path::Path) -> Option<u64> {
    let mut reader = crate::history::open_line_reader("dsh", path).ok()?;
    let mut buf = vec![0u8; 64 * 1024];
    let mut total: u64 = 0;
    loop {
        match std::io::Read::read(&mut reader, &mut buf) {
            Ok(0) => return Some(total),
            Ok(n) => {
                total += n as u64;
                if total > MAX_FORK_SOURCE_BYTES {
                    return Some(total);
                }
            }
            Err(_) => return None,
        }
    }
}

/// `at` 为 `None` 表示 tip 分叉（分叉点是来源会话末尾的完整轮次边界）。
///
/// **点击即落盘**：命令返回时分叉会话已经存在（文件写好 + 登记完成），分支页签
/// 立刻能读到继承的上下文。不需要先发一条消息——前缀文件是我们自己写的，
/// 既不花 token 也不多出轮次。不能改成惰性落地（等第一条消息才创建）：分支窗口
/// 在用户点击后会是空的。
#[tauri::command]
pub async fn fork_session(
    state: tauri::State<'_, crate::AppState>,
    engine: String,
    session_id: String,
    at: Option<ForkAnchor>,
) -> Result<ForkPlan, String> {
    // 整条链路都是**阻塞 IO**：最多 64 MiB 的转录本读取、整份解析、写分支文件、
    // SQLite 事务。直接跑在 async 命令里会占住运行时的工作线程（同 crate 的
    // `load_session_page` 也是这个理由包在 `spawn_blocking` 里）。分叉本身只有一次，
    // 但一次就能顶住几百毫秒到数秒。
    let db = std::sync::Arc::clone(&state.db);
    let plan = tauri::async_runtime::spawn_blocking(move || {
        // 白名单**最先**查：能力表不认的引擎，连"会话是否存在"都不该答（否则用户拿到
        // `session not found`，而会话明明就在侧栏里），更不该先去做体积检查。
        ensure_fork_supported(&engine)?;
        // 体积护栏必须**先于任何解析**：`resolve_fork_plan` 会为了定位分叉点把源
        // 转录本整份解析一遍，`materialize_trimmed_fork` 里再查就晚了——几百 MB 的
        // 文件已经被读进来解析过了。放在最前面，超限直接拒绝，一个字节都不读。
        ensure_fork_source_within_limit(&db, &engine, &session_id)?;
        let mut plan = resolve_fork_plan(&db, &engine, &session_id, at.as_ref())?;
        // 标题先算（它不需要分支文件）：算不出来就别写文件，避免留下孤儿文件。
        // 标题由后端按 `<源会话当前名> (fork #N)` 生成：编号要查现有的同级分支名，
        // 只有后端知道它们；而后缀是语言中立的，不需要翻译。
        let branch_title = next_fork_title(&db, &engine, &plan.source_title)?;
        let keep = plan.keep_records.unwrap_or(usize::MAX);
        let written = materialize_trimmed_fork(
            &db,
            &engine,
            &plan.source_session_id,
            &plan.target_session_id,
            keep,
        )?;
        // panic 守卫：文件已经写出来了，之后（解析刚写出的分支文件、stat、事务里
        // 的意外）如果 **panic**，`register_fork_or_rollback` 的回滚分支根本走不到——
        // 那会留下"有文件、没行"的孤儿：重试会再生成一个新 uuid，随后一次扫描给它
        // 补一行没有分支标题的记录。正常返回与 `Err` 仍由登记函数自己回滚，
        // 这个守卫**只在 unwinding 时**兜底，所以不会与它重复删除。
        let _written_guard = WrittenGuard::new(&engine, &written);
        // 登记进应用自己的表：侧栏要能看到这条分支，`load_session_page` 也要求
        // 先有 `sessions` 行，否则分支页签打开时会报 "session not found"。
        //
        // ⚠️ 登记失败**必须把刚写的文件删掉**（设计稿 §4.1 的失败语义：不留半成品）。
        // 否则会留下一个最糟的中间态：磁盘上有一个能用的分支文件，但表里没有对应行
        // ——随后的扫描会**补一行没有标题的记录**，于是分支看起来"能用"、却没有
        // 分支标题，用户与开发者都看不出这里曾经失败过。
        //
        // 点名真实路径：`written` 就在手上，没有理由让登记去"猜"。
        // 传 `None` 时推不出落盘路径的引擎（`ForkSupport::derive_landing` 为 `None`，
        // 如 Codex）行里会留下空的 `file_path` —— 分支页签随后 `open("")` 失败，且
        // 自定义 `codex_home` 下还会被扫描判为"在家目录之外"而**删掉整行**。
        register_fork_or_rollback(
            &db,
            &engine,
            &plan.source_session_id,
            &plan.target_session_id,
            &written,
            &branch_title,
            &mut plan.degraded,
        )?;
        Ok::<ForkPlan, String>(plan)
    })
    .await
    .map_err(|e| format!("会话分叉任务异常结束: {e}"))??;
    // 广播留在 async 侧：它只是一次事件通知，不需要占用阻塞线程池。
    state.sink.emit_sessions_changed();
    Ok(plan)
}

/// `fork_session` 的主体，接收 db 而不是 Tauri state：与 `send_message_inner`
/// 同样的理由，便于集成测试直接驱动。
pub(crate) fn resolve_fork_plan(
    db: &crate::db::Db,
    engine: &str,
    session_id: &str,
    at: Option<&ForkAnchor>,
) -> Result<ForkPlan, String> {
    // 白名单就是能力表：前缀转录本 + 普通续接这套机制的依据只在表里的引擎身上
    // 成立（Claude `--resume <新id>`、Codex `thread/resume <新id>`，设计稿 §5.3）。
    // 原生 fork 设施（`--fork-session` / `thread/fork`）**不参与**落地。
    let support = ensure_fork_supported(engine)?;
    // 来源 id 的形状由引擎自己定（`ForkSupport::source_id_ok`）：Claude 的
    // `--resume` 只收 UUID，dsh 的规范 id 是 `session-<uuid>`，混用一条判据会挡掉一半。
    if !(support.source_id_ok)(session_id) {
        return Err(format!("会话 id 不是合法 UUID: {session_id}"));
    }
    if let Some(anchor) = at {
        // 锚点必须是 64 位十六进制 SHA-256；形状不对就是调用方构造有误，
        // 直接拒绝而不是留到落地时才发现。这里**不分大小写**（十六进制两种写法
        // 都合法），真正比对时统一折成小写——`text_sha256_hex` 只产小写，
        // 不折就只会得到"定位不到该轮"这种指错方向的报错。
        if anchor.user_text_sha256.len() != 64
            || !anchor
                .user_text_sha256
                .bytes()
                .all(|b| b.is_ascii_hexdigit())
        {
            return Err("分叉点锚点不是合法的 SHA-256".into());
        }
    }
    // 源会话必须真实登记过：它的 file_path 决定分叉落地的目录（能力表里的落盘
    // 实现都直接写"源文件所在目录"，从根上绕开路径编码假设）。
    let source = crate::history::reader::session_meta_by_id(db, engine, session_id)?
        .ok_or_else(|| format!("session not found: {engine}/{session_id}"))?;
    // 这里**没有** remote 护栏，是刻意的：`session_meta_by_id` 给 `remote` 恒填
    // `None`（`sessions` 表里没有这一列），远程会话又从不落 `sessions` 行——
    // 它们在上一条查询就已经是 session not found，再加一道护栏永远不触发。
    // 远程会话的入口由前端独立置灰并说明（设计稿 §5），后端不靠这个字段把关。
    // 切点在这里就算出来（以磁盘文件为准重解析 + 定位该轮用户记录）。
    // 定位失败必须明确报错——绝不退化成"从末尾分叉"，那会派生出一个内容不是
    // 用户所点的分支，比报错更糟。
    //
    // 语义：分支要**包含**分叉点那一轮（用户点「请教一个数学题」这一轮，分支里
    // 就该有这一轮 + 之前所有内容）。所以切点取"该轮结束、下一轮开始"处。
    let keep_records = match at {
        // 没有锚点 = 从末尾分叉：整份转录本都搬过去。
        None => usize::MAX,
        Some(anchor) => {
            let path = std::path::Path::new(&source.file_path);
            let (accepted, _) = db.accepted_internal_frames(engine, session_id)?;
            let parsed = crate::history::parse_session_file(engine, path, &accepted)?;
            // 切点**怎么算**是引擎差异，由能力表各自实现（Claude 按会话链的 user
            // 记录切、Codex 切在轮次结束标记之后，见各自函数注释）。
            // 已接受的内部帧与上面这次解析同一份（`accepted`），Claude 侧的切点
            // 行号才与 `parsed` 一一对齐。
            match (support.keep_count)(path, anchor, &parsed.messages, &accepted) {
                Some(count) => count,
                // 两种原因都可能：锚点轮的文本在转录本里找不到，或者该轮**没有落
                // 结束标记**（Codex/dsh 的切点要求轮次完整）。后者更常见，且通常是
                // 进程在轮中被杀（关窗 / 崩溃 / kill）而不是文件被改过——把这两种
                // 情况分开说，否则用户会被引向"数据损坏"这个错误结论。
                None => {
                    return Err(
                        "未能在转录本中定义该轮的分叉点：该轮可能尚未结束（进程被中断时会缺结束标记），或源文件已被外部修改"
                            .into(),
                    );
                }
            }
        }
    };
    Ok(ForkPlan {
        source_session_id: session_id.to_string(),
        source_engine: engine.to_string(),
        // 分支必然落在源会话自己的工作区：Claude 按"源文件所在目录"找转录本，
        // 前端建 tab 也必须用同一个工作区，否则两条事实会分叉。
        workspace_path: source.workspace_path.clone(),
        // 分支 id 的**形态**是引擎差异（Claude/Codex 裸 UUIDv4；dsh 带
        // `session-` 前缀，与它的目录名/header/host 缓存键一致）。形态不一致会让
        // host 用另一种写法另建一份投影，模型就读不到继承的对话。
        target_session_id: (support.target_id)(),
        // 是否落在末尾看**实际切点**：`at` 为 `None` 和"锚点正好是最后一轮"都会
        // 得到 `usize::MAX`（整份文件都搬了），两者语义相同——分支保留了全部内容。
        at_tip: keep_records == usize::MAX,
        // 保留整份时**不发这个数**：`usize::MAX` 过 JSON 会被 JS 读成
        // 18446744073709552000（精度已丢），既不等于 `Number.MAX_SAFE_INTEGER`，
        // 也不能拿去做算术——一个字段同时表示"多少条"和"全部"就是陷阱。
        // 这个状态 `at_tip` 已经表达清楚，所以哨兵值不上线。
        keep_records: (keep_records != usize::MAX).then_some(keep_records),
        source_title: source
            .custom_title
            .filter(|t| !t.trim().is_empty())
            .unwrap_or(source.title),
        // 由 `fork_session` 在登记阶段填（降级只在链路最后一步产生）。
        degraded: Vec::new(),
    })
}

/// 「分支文件已经写出来」这件事的 panic 兜底（见 `fork_session` 里的说明）。
///
/// 只在 **unwinding** 时清理：正常返回与 `Err` 都由 `register_fork_or_rollback`
/// 自己回滚，这里再删一次会变成两条回滚路径抢同一个文件。
struct WrittenGuard<'a> {
    engine: &'a str,
    written: &'a std::path::Path,
}

impl<'a> WrittenGuard<'a> {
    fn new(engine: &'a str, written: &'a std::path::Path) -> Self {
        Self { engine, written }
    }
}

impl Drop for WrittenGuard<'_> {
    fn drop(&mut self) {
        if std::thread::panicking() {
            eprintln!(
                "[fork] 分支落盘后发生 panic，回滚已写出的产物: {}",
                self.written.display()
            );
            cleanup_fork_artifact(self.engine, self.written);
        }
    }
}

#[cfg(test)]
mod tests;
