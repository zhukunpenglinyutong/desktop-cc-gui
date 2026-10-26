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

/// 中间分叉的分叉点：以「该轮的用户消息」定位。
///
/// 为什么不用被点击消息自身的文本：一条 assistant 记录在 `fold_rows` 里会被
/// `claude_flush_text` 拆成多行（遇 thinking / tool_use 先把累积文本单独
/// flush），前端存的那一段文本与后端那一行的文本**不保证全等**。而用户轮
/// 没有这些块，一条 `user` 记录严格对应一行、文本全等。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForkAnchor {
    /// 该轮用户消息**原始存储文本**的 SHA-256 十六进制（store 里的
    /// `message.text`，不是显示层 strip 过的文本）。
    pub user_text_sha256: String,
    /// 该轮用户消息的 seq；仅在文本命中多处时作就近消歧，不参与权威判定。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seq_hint: Option<i64>,
}

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
///   标记），Codex 必须切在锚点轮的 `task_complete` 之后。锚点没命中时的不对称
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
/// `std::fs::metadata` 基本不碰文件内容，所以这是最廉价的入口检查；拿不到
/// 元信息时不放行也不误拒——报错让人看到问题，而不是当成 0 字节悄悄通过。
fn ensure_fork_source_within_limit(
    db: &crate::db::Db,
    engine: &str,
    session_id: &str,
) -> Result<(), String> {
    let source = crate::history::reader::session_meta_by_id(db, engine, session_id)?
        .ok_or_else(|| format!("session not found: {engine}/{session_id}"))?;
    let path = std::path::Path::new(&source.file_path);
    let bytes = std::fs::metadata(path)
        .map_err(|e| format!("读取源会话大小失败({}): {e}", source.file_path))?
        .len();
    if bytes > MAX_FORK_SOURCE_BYTES {
        return Err(format!(
            "源会话转录本 {} MiB 超过 {} MiB 上限，已拒绝分叉",
            bytes / (1024 * 1024),
            MAX_FORK_SOURCE_BYTES / (1024 * 1024),
        ));
    }
    Ok(())
}

/// 分支编号后缀。**语言中立**（用户定的规则）：`(fork #1)` 不翻译，所以它不需要
/// 走 `src/i18n`，后端可以直接拼——这也顺带解决了"英文界面出现中文后缀"的问题。
///
/// 这里的拼接与 `fork_sibling_number` 的解析必须严格互逆，两处共用这一组常量。
const FORK_MARK: &str = " (fork #";
const FORK_MARK_END: char = ')';

/// 后缀段之间的分隔符，也就是根名与后缀链之间的那个空格。
const FORK_SUFFIX_SEP: char = ' ';

/// 省略标记：夹在**根名与后缀链之间**（`A … (fork #4) (fork #5)`），表示"更早的
/// 分支段已经不在名字里了"。没有它，被省略过的名字看起来就像本来就那么短。
const FORK_ELISION_MARK: char = '…';

/// 一条分支标题的字符上限（产品定）。
///
/// 按**字符**而不是字节：标题基本是中文，按字节截会把一个字切成两半
/// （`history::truncate_chars` 里是同一条理由）。
const MAX_FORK_TITLE_CHARS: usize = 80;

/// 后缀链最多保留的段数（产品定）：更深的分叉只留**最新**的几段，更早的丢掉。
/// 段数有上限，`MAX_FORK_TITLE_CHARS` 才有一个固定的下限留给根名。
const MAX_FORK_SUFFIX_SEGMENTS: usize = 5;

/// 分支标题：`<源会话当前名> (fork #N)`，N = 1 + 当前**同级分支**里最大的编号。
///
/// 四条规则都是产品定的，别在后续重构里"顺手"改回最小空闲编号或去掉上限：
/// - **从源会话的当前名追加，不从中剥离任何东西**：分叉一个分支得到的名字是
///   `A (fork #1) (fork #1)`——世系由此在名字里可见。名字不会因此无限增长：
///   段数上限、80 字符预算与省略标记的插法全在 `capped_fork_title` 里。
/// - **`max+1` 而不是最小空闲**：同级是 {#1, #3} 时下一个是 **#4**，缺掉的 #2
///   故意不复用——用户记住的编号不能被悄悄回收。
/// - 同级集合**跟着当前名字走**（改名只动 `custom_title`）：某个编号被改掉之后，
///   它就不再是同级，编号空间会随之收缩，这是"取当前集合最大值"的自然结果。
/// - 同级判据拿**存下来的完整父名**去比（含上限留下的 `…`），不做任何"清洗"：
///   编号必须与侧栏里显示的那个名字一一对应。
///
/// 每次分叉都重算而不缓存：编号的正确性只取决于此刻表里的名字，缓存等于引入
/// 第二个事实来源。
fn next_fork_title(
    db: &crate::db::Db,
    engine: &str,
    source_title: &str,
) -> Result<String, String> {
    // 空名兜底：`title` 列允许为空字符串（扫描器补行时就是空），而 `" (fork #1)"`
    // 这种以空格开头的名字在侧栏里看不出是什么。
    let parent = match source_title.trim() {
        "" => "会话",
        name => name,
    };
    let taken = taken_titles(db, engine)?;
    // ⚠️ 同级判据用的是**完整存下来的父名**（`parent` 原样，含可能的 `…`），不是
    // 拆出根名后"洗干净"的版本：`fork_sibling_number` 要求整串相等，父名换成另一个
    // 形状，同级集合就跟着换，编号与侧栏里真正显示的那个名字会分家——同一个东西
    // 不能有两套判据。
    let sibling_max = taken
        .iter()
        .filter_map(|name| fork_sibling_number(parent, name))
        .max()
        .unwrap_or(0);
    // 从 `max+1` 起步：正常情况下第一次就返回。继续往后找只为两种极端情况留路，
    // 它们都是"两个会话同名、侧栏里分不清谁是谁"：
    //   1. 某个会话的**有效名**恰好等于我们要发的名字（典型是用户第一条消息就打
    //      成 `A (fork #1)` 的会话，它的推导标题正是这个名字）；
    //   2. **上限把两个不同的父名压成了同一串**（根名被截到同一个前缀，或后缀链
    //      被省略成同样 5 段）——那时只有一个候选串，只能靠编号把它让开。
    // 这**不是**"最小空闲编号"那条规则的回归：起点永远是同级最大值 + 1。
    for n in (sibling_max + 1)..=9999u32 {
        let candidate = capped_fork_title(parent, n);
        if !taken.contains(&candidate) {
            return Ok(candidate);
        }
    }
    // 9999 只是防御性的上界：真到那一步说明标题空间出了问题，明确报错而不是死循环。
    Err("分支编号空间已用尽".into())
}

/// 一个后缀段的文本（**不含**分隔空格）：`(fork #N)`。
///
/// 从 `FORK_MARK` 去掉前导空格拼出来：拼接与 `fork_sibling_number` 的解析共用同一
/// 组常量，两处各写一份字面量迟早会漂移（两者必须严格互逆）。
fn fork_suffix_segment(number: u32) -> String {
    format!("{}{number}{FORK_MARK_END}", FORK_MARK.trim_start())
}

/// 父名 → `(根名, 结尾的 (fork #k) 后缀链)`，链从旧到新。
///
/// 判据只有 `fork_sibling_number` 一份，这里只**猜**切点（最后一个 `" (fork #"`），
/// 认不认它由那个函数决定：`(fork #x)`、`(fork #)` 这类形状它返回 `None`，链就到
/// 此为止——那一段留在根名里（`A (fork #x) (fork #1)` 的根名是 `A (fork #x)`），
/// 而不是被当成一个段丢掉。第二个"什么算后缀"的判据不能有：同一个东西两套判据
/// 必然把同一个后缀判成两种结果。
fn split_fork_suffixes(parent: &str) -> (&str, Vec<&str>) {
    let mut segments = Vec::new();
    let mut rest = parent;
    while let Some(start) = rest.rfind(FORK_MARK) {
        let head = &rest[..start];
        if fork_sibling_number(head, rest).is_none() {
            break;
        }
        // `start` 落在 `FORK_MARK` 的前导空格上（1 字节），+1 就是 `(`。
        segments.push(&rest[start + 1..]);
        rest = head;
    }
    segments.reverse();
    (rest, segments)
}

/// 剥掉根名**结尾**的省略标记，返回 `(根名, 本来就带标记吗)`。
///
/// 只认结尾的 `…`：标记只会由本模块插在根名与后缀链之间。剥掉是为了幂等——分叉
/// 一个已经被省略过的分支时不会拼出 `A … … (fork #…)`；而"本来有没有标记"必须
/// 带回去，否则继续分叉会把"更早的段已被丢掉"这件事从名字里悄悄抹掉。
fn strip_elision_marker(root: &str) -> (&str, bool) {
    let trimmed = root.trim_end();
    match trimmed.strip_suffix(FORK_ELISION_MARK) {
        Some(rest) => (rest.trim_end(), true),
        None => (trimmed, false),
    }
}

/// 按上限拼一个候选标题：`<根名> [ … ] <后缀链> (fork #N)`。
///
/// 两条产品规则都在这里（`next_fork_title` 只负责挑 N）：
/// - **段数上限**：把新段接上去之后，后缀链超过 5 段就只留**最新**的 5 段，更早的
///   丢掉，并在根名后插一个 `…` 让省略可见。段数有上限，`MAX_FORK_TITLE_CHARS`
///   才有一个固定的下限留给根名。
/// - **字符预算**：整个标题最多 80 个字符（含省略标记与整条后缀链），超出时由
///   **根名**吸收。后缀链在段数上限下最多 5 段（每段约 11 字符），永远放得下，
///   所以能截的只有根名；`…` 与后缀链属于**固定尾部**，截断只动根名——标记被截掉
///   就白插了。
///
/// **根名被截断时必须留下看得见的 `…`**（与 `git.rs` 截 diff 时插显式截断标记是
/// 同一条约定：凡是截断都要留痕）。`history::truncate_chars` 自己是静默的
/// （`chars().take(max)`，不留任何提示），只调它会把 `数学题大全（上册）` 截成
/// `数学题大全`——读起来就是一个完整标题，用户看不出这里被切过。
///
/// 但尾部**已经**带 `…`（更早的段被丢过）时**不能**再补一个：一条标题里出现两个
/// 省略号，反而说不清省掉的是哪一段。这种时候也**不预留**那 1 个字符——预留却不
/// 插标记，整串会正好比预算短 1 个字符（80 的预算只用到 79），预算与实际长度就
/// 对不上了。所以预留与否只看 `add_marker`：真要插才扣。
///
/// 按**字符**截断（复用 `history::truncate_chars`），不是字节：标题基本是中文，
/// 按字节切会把一个字切成两半。
fn capped_fork_title(parent: &str, number: u32) -> String {
    // 拆段与插段都在**完整父名**上做，与同级判据（`next_fork_title`）看的是同一个
    // 字符串；这里只是决定"拼出来的候选长什么样"。
    let (root, mut segments) = split_fork_suffixes(parent);
    let (root, had_marker) = strip_elision_marker(root);
    let new_segment = fork_suffix_segment(number);
    segments.push(new_segment.as_str());
    let elided = segments.len() > MAX_FORK_SUFFIX_SEGMENTS;
    if elided {
        // 丢掉的是**最老**的那几段（`drain` 从头开始），新段永远留着。
        segments.drain(..segments.len() - MAX_FORK_SUFFIX_SEGMENTS);
    }
    // 插不插标记：本次丢过段，或上一次已经丢过（父名的根名里带着 `…`）。两者都
    // 表示"更早的分支段不在名字里了"；没有这种情况就不插，名字里不会凭空多个点。
    let marker = elided || had_marker;
    // 尾部 = 省略标记 + 整条后缀链。先把它**拼出来**再量长度：字符预算扣掉尾部，
    // 剩下的全给根名（`saturating_sub` 只是防御，段数上限下尾部最多约 62 字符）。
    let mut tail = String::new();
    if marker {
        tail.push(FORK_SUFFIX_SEP);
        tail.push(FORK_ELISION_MARK);
    }
    for segment in segments.iter().copied() {
        tail.push(FORK_SUFFIX_SEP);
        tail.push_str(segment);
    }
    let budget = MAX_FORK_TITLE_CHARS.saturating_sub(tail.chars().count());
    // 根名会不会被预算切掉：`truncate_chars` 先 trim 再比长度，这里按**同一个口径**
    // 量（它自己不给任何提示，切没切只能由调用方自己判断）。注意这一步只跟预算有关，
    // 与"要不要插标记"是两件事——插不插还要看尾部有没有标记。
    let root_cut = root.trim().chars().count() > budget;
    // 根名自己的 `…` 只在"真的切了根名、且尾部还没有标记"时插（尾部已有标记还要再插
    // 一个，一条标题里就有两个省略号，看不出省掉的是哪一段）。**预留的 1 个字符跟着
    // 它走**：预留却不插，整串会正好短 1 个字符（80 的预算只用到 79）。
    let add_marker = root_cut && !marker;
    let root_budget = budget.saturating_sub(usize::from(add_marker));
    let root = crate::history::truncate_chars(root, root_budget);
    let root = root.trim_end();
    // 根名被预算压到空（只可能出现在用户自造的超长编号上）时，上面的拼接会留下一个
    // 前导空格——那种名字在侧栏里看不出是什么，与空名兜底是同一条理由。
    if root.is_empty() {
        return tail.trim_start().to_string();
    }
    if add_marker {
        return format!("{root}{FORK_ELISION_MARK}{tail}");
    }
    format!("{root}{tail}")
}

/// 名字 `name` 相对源会话当前名 `source_name` 的分支编号：`name` 必须**整串等于**
/// `<source_name> (fork #k)` 才算同级，否则返回 `None`。
///
/// ⚠️ **绝不能改成前缀判据**（`name.starts_with("<源名> (fork #")`）。孙分支
/// `A (fork #1) (fork #1)` 同样以 `A (fork #` 开头，前缀判据会把孙分支数成
/// `A` 的同级，于是 `A` 的下一个分支拿到 `(fork #3)` 而不是 `(fork #2)`。同类
/// "同一个东西有两套判据"的偏差，所以这条由测试钉死
/// （`fork_numbers_do_not_count_grandchildren_as_siblings`）。
fn fork_sibling_number(source_name: &str, name: &str) -> Option<u32> {
    let digits = name
        .strip_prefix(source_name)?
        .strip_prefix(FORK_MARK)?
        .strip_suffix(FORK_MARK_END)?;
    // 空串、带符号、非 ASCII 数字一律不算：`from_str` 本身只收数字，但会接受
    // 前导 `+`（`"+1".parse::<u32>()` 成功），而 `+1` 不是我们自己拼出来的形状。
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    digits.parse().ok()
}

/// 该引擎下所有会话的**有效名**（`custom_title` 非空则用它，否则用推导标题；
/// 一个会话最多贡献一个值）。
///
/// 编号规则只消费这个集合：名字是会话当前的**身份**，所以两列要先按同一条判据
/// （`resolve_fork_plan` 取来源名的那条）折成一个名字。两列各插一次会让同一个会话
/// 在集合里占两个名字，`title` 里残留的分支编号还会替用户占号
/// （表现为 `#1 → #3 → #4`）。
fn taken_titles(
    db: &crate::db::Db,
    engine: &str,
) -> Result<std::collections::HashSet<String>, String> {
    let conn = db.0.lock();
    let mut stmt = conn
        .prepare("SELECT custom_title, title FROM sessions WHERE engine = ?1")
        .map_err(|e| format!("读取会话标题失败: {e}"))?;
    let rows = stmt
        .query_map([engine], |row| {
            Ok((
                row.get::<_, Option<String>>(0)?,
                row.get::<_, Option<String>>(1)?,
            ))
        })
        .map_err(|e| format!("读取会话标题失败: {e}"))?;
    let mut out = std::collections::HashSet::new();
    for row in rows {
        let (custom, derived) = row.map_err(|e| format!("读取会话标题失败: {e}"))?;
        // 每行只贡献**一个**有效名，判据与 `resolve_fork_plan` 取来源名时完全一致
        // （空/纯空白的 `custom_title` 不算改名）。
        let name = custom
            .filter(|t| !t.trim().is_empty())
            .or(derived)
            .unwrap_or_default();
        out.insert(name);
    }
    Ok(out)
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
    // 体积护栏必须**先于任何解析**：`resolve_fork_plan` 会为了定位分叉点把源
    // 转录本整份解析一遍，`materialize_trimmed_fork` 里再查就晚了——几百 MB 的
    // 文件已经被读进来解析过了。放在最前面，超限直接拒绝，一个字节都不读。
    ensure_fork_source_within_limit(&state.db, &engine, &session_id)?;
    let plan = resolve_fork_plan(&state.db, &engine, &session_id, at.as_ref())?;
    // 标题先算（它不需要分支文件）：算不出来就别写文件，避免留下孤儿文件。
    // 标题由后端按 `<源会话当前名> (fork #N)` 生成：编号要查现有的同级分支名，
    // 只有后端知道它们；而后缀是语言中立的，不需要翻译。
    let branch_title = next_fork_title(&state.db, &engine, &plan.source_title)?;
    let keep = plan.keep_records.unwrap_or(usize::MAX);
    let written = materialize_trimmed_fork(
        &state.db,
        &engine,
        &plan.source_session_id,
        &plan.target_session_id,
        keep,
    )?;
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
        &state.db,
        &engine,
        &plan.source_session_id,
        &plan.target_session_id,
        &written,
        &branch_title,
    )?;
    state.sink.emit_sessions_changed();
    Ok(plan)
}

/// 登记分支，并把两条失败路径都收口成"连文件一起回滚"的 `Err`。
///
/// `register_fork_landing_with_path` 的 `Ok(false)`（文件不在、拒绝登记）**不是
/// 成功**：命令会返回一个看起来"已经落地"的 `ForkPlan`，而 `sessions` 行并不
/// 存在——分支页签打开就是 `session not found`，正是设计稿 §4.1 禁止的半状态。
/// 所以 `false` 与 `Err` 同等对待，都由这里删掉刚写的文件再报错。
fn register_fork_or_rollback(
    db: &crate::db::Db,
    engine: &str,
    source_session_id: &str,
    target_session_id: &str,
    written: &Path,
    title: &str,
) -> Result<(), String> {
    let registered = register_fork_landing_with_path(
        db,
        engine,
        source_session_id,
        target_session_id,
        Some(&written.to_string_lossy()),
        Some(title),
    );
    match registered {
        Ok(true) => Ok(()),
        Ok(false) => {
            // 文件在写完与登记之间消失（外部删除、杀软隔离）：登记拒绝写一行指向
            // 不存在文件的记录，这里也没什么可回滚的，但绝不能报成功。
            let _ = std::fs::remove_file(written);
            Err(format!(
                "分支转录本未被登记（文件不存在）: {}",
                written.display()
            ))
        }
        Err(error) => {
            let _ = std::fs::remove_file(written);
            Err(error)
        }
    }
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
            // 记录切、Codex 切在 task_complete 之间，见各自函数注释）。
            // 已接受的内部帧与上面这次解析同一份（`accepted`），Claude 侧的切点
            // 行号才与 `parsed` 一一对齐。
            match (support.keep_count)(path, anchor, &parsed.messages, &accepted) {
                Some(count) => count,
                None => {
                    return Err("未能在转录本中定位该轮消息，文件可能已被外部修改".into());
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
    })
}

/// Codex rollout 文件名里的时间戳段：`rollout-<YYYY-MM-DDTHH-MM-SS>-<id>.jsonl`，
/// 与 `codex` 自己以及 `scanner.rs` 测试里的既有命名同形。
///
/// 只用于**命名**、不参与身份判定，所以直接按 UTC 手算，不引入日期库。
fn timestamp_slug() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    timestamp_slug_from_unix(secs)
}

/// 纯函数（便于测试）：Unix 秒 → `YYYY-MM-DDTHH-MM-SS`（UTC，前推格里历）。
/// 算法是 Howard Hinnant 的 `civil_from_days`，避免为一行格式化引入依赖。
fn timestamp_slug_from_unix(secs: i64) -> String {
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
fn source_dir(source_path: &Path) -> Result<&Path, String> {
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
fn copy_plain_jsonl_prefix(
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
    let reader = std::io::BufReader::new(file);
    use std::io::{BufRead, Write};
    let mut out = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(dest)
        .map_err(|e| format!("创建分支转录本失败: {e}"))?;

    let write_result = (|| -> Result<(), String> {
        for (index, line) in reader.lines().enumerate() {
            if index >= keep_records {
                break;
            }
            let line = line.map_err(|e| format!("读取源转录本失败: {e}"))?;
            if line.trim().is_empty() {
                continue;
            }
            let rewritten = match serde_json::from_str::<serde_json::Value>(&line) {
                Ok(mut value) => {
                    if rewrite_identity(&mut value) {
                        serde_json::to_string(&value)
                            .map_err(|e| format!("序列化记录失败: {e}"))?
                    } else {
                        line
                    }
                }
                // 坏行（CLI 容忍）原样搬过去，不因为一行坏数据让整个分叉失败。
                Err(_) => line,
            };
            out.write_all(rewritten.as_bytes())
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
fn claude_derive_landing(source_path: &Path, target_session_id: &str) -> Result<PathBuf, String> {
    Ok(source_dir(source_path)?.join(format!("{target_session_id}.jsonl")))
}

/// Claude 的身份改写：**逐行**改顶层 `sessionId`（文件名 stem 与行内 id 必须一致，
/// CLI 按 stem 定位）。没有这个键的记录（辅助记录、坏行）原样搬。
fn claude_rewrite_identity(value: &mut serde_json::Value, target_session_id: &str) -> bool {
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
fn claude_copy_prefix(
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
fn codex_copy_prefix(
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
fn codex_rewrite_identity(value: &mut serde_json::Value, target_session_id: &str) -> bool {
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
fn copy_accepted_frames(
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
    let mut degraded: Vec<String> = Vec::new();
    if let Some(model) = source.model.as_deref().filter(|m| !m.trim().is_empty()) {
        if let Err(e) = db.remember_session_model(engine, target_session_id, model, now) {
            degraded.push(format!("model: {e}"));
        }
    }
    if let Some(effort) = source.effort.as_deref().filter(|e| !e.trim().is_empty()) {
        if let Err(e) = db.remember_session_effort(engine, target_session_id, effort, now) {
            degraded.push(format!("effort: {e}"));
        }
    }
    if let Some(provider) = source.provider.as_deref().filter(|p| !p.trim().is_empty()) {
        if let Err(e) = db.remember_session_provider(engine, target_session_id, provider, now) {
            degraded.push(format!("provider: {e}"));
        }
    }
    for item in &degraded {
        eprintln!("[fork] 分支 {target_session_id} 未能继承会话记忆（{item}）");
    }
    Ok(true)
}

/// 文本的 SHA-256 十六进制小写。必须与前端 `src/lib/sha256.ts` 逐字节一致：
/// 前端算的是 store 里那条用户消息的**原始文本**，后端要拿同一个摘要去
/// 转录本里定位它。两侧各有一份实现（前端不能依赖 `crypto.subtle`——局域网
/// HTTP 是非安全上下文），所以有一条测试把中文文本的期望值钉死。
pub fn text_sha256_hex(text: &str) -> String {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(text.as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// 锚点命中在 `parsed` 里的下标：role 为 user 且文本摘要相同；多处命中时用
/// `seq_hint` 就近取，没有提示则取最后一条（最近的一轮）。
///
/// 两个引擎共用：切点算法**故意不同**（Claude 切下一条 user 行、Codex 切轮边界），
/// 但"锚点是哪一条消息"这件事必须只有一套判据；轮号由 `anchor_turn` 从这里派生，
/// 两个切点函数都只消费那个轮号。
///
/// 距离用 `abs_diff` 而不是 `(a - b).abs()`：`seq_hint` 来自前端、且 Web bridge
/// 也能送到，取值不受约束——`i64::MIN` 这种极端值做 `i64 - i64` 会溢出，dev/test
/// 直接 panic，release 回绕后选到错误的重复轮次。
///
/// 摘要一律折成小写比对：形状检查允许大写十六进制，而 `text_sha256_hex` 只产
/// 小写，不折就会以"未能在转录本中定位该轮消息"收场——把调用方的写法问题报成
/// 转录本问题。
fn anchor_hit_index(parsed: &[crate::history::Message], anchor: &ForkAnchor) -> Option<usize> {
    let wanted = anchor.user_text_sha256.to_ascii_lowercase();
    let matches: Vec<usize> = parsed
        .iter()
        .enumerate()
        .filter(|(_, m)| m.role == "user" && text_sha256_hex(&m.text) == wanted)
        .map(|(i, _)| i)
        .collect();
    match matches.as_slice() {
        [] => None,
        [only] => Some(*only),
        many => match anchor.seq_hint {
            // `min_by_key` 取**第一个**最小值：等距时留下更早的那条（解析顺序），
            // 与"就近消歧"一致，也让同一份输入的切点稳定可复现。
            Some(hint) => Some(
                many.iter()
                    .copied()
                    .min_by_key(|i| parsed[*i].seq.abs_diff(hint))
                    .unwrap_or(many[many.len() - 1]),
            ),
            None => Some(many[many.len() - 1]),
        },
    }
}

/// 锚点轮**从 0 起的序号**：命中消息之前有几条 user 消息。
///
/// 两个引擎的切点函数都从这里起步（命中判据见 `anchor_hit_index`），差别只在
/// "拿到这个序号之后怎么求切点"——Claude 取第 `n+1` 条 user 记录的行号，Codex 数到
/// 第 `n+1` 个 `task_complete`。这段"锚点是哪一轮"的推理只写一遍：抄成两份
/// 时，任何一处改动都会让两个引擎对"同一轮"的理解分家。
/// 对 `engine` 内其他模块可见（`fork_dsh` 复用它定位锚点轮），对外仍私有：
/// "锚点是哪一轮"的判据只应有这一份。
pub(super) fn anchor_turn(parsed: &[crate::history::Message], anchor: &ForkAnchor) -> Option<usize> {
    let hit = anchor_hit_index(parsed, anchor)?;
    Some(parsed.iter().take(hit).filter(|m| m.role == "user").count())
}

/// 中间分叉的**记录级切点**：保留源文件的前 N 条记录。
///
/// 语义（设计稿 §3.3 / §3.4）：切点 = **锚点轮之后**第一条 user
/// 记录的起始行，也就是"该轮结束、下一轮开始"处——分支**包含**用户点的那一轮
/// （点「请教一个数学题」→ 分支里有这一轮 + 之前全部内容），且不含它之后的任何
/// 东西。切在"下一条 user 行"上，所以它必然落在完整轮次边界：锚点轮之后的
/// 第一条 user 记录就是下一轮的起点。
///
/// 返回 `None` 表示锚点没命中（文件被外部改过、或文本对不上）——调用方必须
/// 明确报错，绝不退化成"取最后一条"。
///
/// 切点**只能**从提取器那条流水线上取（`history::user_row_lines`：行号与
/// user 消息同源、同一次遍历）。另起一个"第几条 user 记录"的判据必然与提取器
/// 分家：它在本地命令窗口的 stdout、skill 命令信封、纯图片轮三处都与提取器的
/// 可见口径不一致，于是切点整体错位 N 轮——极端情况下落进 CLI chrome，分支里
/// 一轮对话都没有。不要再挂回第二份判据。
fn fork_keep_count(
    path: &Path,
    anchor: &ForkAnchor,
    parsed: &[crate::history::Message],
    accepted_frames: &std::collections::HashSet<String>,
) -> Option<usize> {
    // 锚点轮是第几条 user 消息（判据见 `anchor_turn`）。
    let user_ordinal = anchor_turn(parsed, anchor)?;

    let file = std::fs::File::open(path).ok()?;
    let lines = crate::history::user_row_lines(std::io::BufReader::new(file), accepted_frames);
    // 切在**锚点轮之后**那条用户记录的行上：分支**包含**用户点的那一轮
    // （"请教一个数学题"这一轮 + 之前所有内容），而不是把它排除在外。
    // `user_row_lines` 自带末尾哨兵，锚点轮是最后一轮时这里拿到的是整份文件。
    lines.get(user_ordinal + 1).copied()
}

/// Codex 的记录级切点。与 Claude 不同，Codex 必须切在**完整轮次**边界上：
/// 它的轮次是 `event_msg` 的 `task_started` … `task_complete` 包起来的，而
/// 非会话记录（`turn_context` / `token_count`）散落在轮内。直接用"第 n 条
/// user 记录的行号"会切进某一轮中间，留下没有 `task_complete` 的残轮。
///
/// 做法：先选中锚点所在的**轮**（第 `n` 轮，从 1 起），再取第 `n-1` 轮结束
/// 那条 `task_complete` 的**后一行**——分支就正好"从第 n 轮开始"。
fn fork_keep_count_codex(
    path: &Path,
    anchor: &ForkAnchor,
    parsed: &[crate::history::Message],
    // Codex 的切点靠轮标记（`task_complete`）求，不需要"哪条原始记录算用户消息"
    // 的口径，所以这里用不到已接受的内部帧集合。签名与能力表保持一致，是为了让
    // 表里两行同型——将来加引擎时不必区分"要不要这个参数"。
    _accepted_frames: &std::collections::HashSet<String>,
) -> Option<usize> {
    // 定位与 Claude 完全同源（`anchor_turn`）：它给出"锚点是第几条**可见 user 消息**"，
    // 命中判据只有这一份。但**不能**把这个序号直接当轮号——codex 的一轮由
    // `task_started` … `task_complete` 包起来，里面可以有多条 user 消息，两者在
    // 1:1 时才相等。序号被当成轮号时，锚点落在某轮的第二条消息上会让切点落到
    // **更晚一轮**的 `task_complete`，分支静默多带一轮内容。
    //
    // 所以判据是"累计可见 user 消息数越过锚点序号之后的**第一个** `task_complete`"：
    // 它既是锚点那条消息所在轮结束的位置，又不需要轮起始标记——`task_started` 在本
    // 仓库里从未被读取过（`payload.turn` 也是），拿它当判据等于把切点建在没验证的形状上。
    let anchor_user_ordinal = anchor_turn(parsed, anchor)?;

    let file = std::fs::File::open(path).ok()?;
    let reader = std::io::BufReader::new(file);
    use std::io::BufRead;
    let mut users_seen = 0usize;
    for (index, line) in reader.lines().enumerate() {
        let Ok(line) = line else { continue };
        let Some(value) = parse_json_line(&line) else {
            continue;
        };
        if crate::history::codex_line_is_visible_user(&value) {
            users_seen += 1;
            continue;
        }
        let is_complete = value.get("type").and_then(serde_json::Value::as_str) == Some("event_msg")
            && value
                .get("payload")
                .and_then(|p| p.get("type"))
                .and_then(serde_json::Value::as_str)
                == Some("task_complete");
        if is_complete && users_seen > anchor_user_ordinal {
            // 保留到锚点轮的 task_complete 为止（含）——分支包含用户点的那一轮。
            return Some(index + 1);
        }
    }
    // 锚点轮还不是完整轮（没有 task_complete），或转录本被截过：不猜，报定位失败。
    // 界面只在已定稿的行上给分叉入口，所以正常情况下不会走到这里。
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Claude 转录本的一行标准 user 记录。
    fn claude_user_line(session_id: &str, text: &str, is_meta: bool, ts: &str) -> String {
        serde_json::json!({
            "type": "user",
            "uuid": uuid::Uuid::new_v4().to_string(),
            "parentUuid": serde_json::Value::Null,
            "sessionId": session_id,
            "timestamp": ts,
            "isMeta": is_meta,
            "message": { "role": "user", "content": [{ "type": "text", "text": text }] }
        })
        .to_string()
    }

    /// Claude 转录本的一行标准 assistant 记录。
    fn claude_assistant_line(session_id: &str, text: &str, ts: &str) -> String {
        serde_json::json!({
            "type": "assistant",
            "uuid": uuid::Uuid::new_v4().to_string(),
            "parentUuid": serde_json::Value::Null,
            "sessionId": session_id,
            "timestamp": ts,
            "message": { "role": "assistant", "content": [{ "type": "text", "text": text }] }
        })
        .to_string()
    }

    /// 按切点复制前缀（`materialize_trimmed_fork` 同一条规则：取前 `keep` 行）。
    fn copy_first_lines(bytes: &str, keep: usize) -> String {
        bytes
            .lines()
            .take(keep)
            .map(|line| format!("{line}\n"))
            .collect()
    }

    /// 把前 `keep` 行写成一份真实的分支文件，再按普通解析读回来——分支里
    /// 究竟有哪几条消息，只有这么看才算数（切点是个行数，不是消息条数）。
    fn parse_first_lines(bytes: &str, keep: usize) -> Vec<crate::history::Message> {
        let dir = std::env::temp_dir().join(format!("ccgui-fork-copy-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("branch.jsonl");
        let body = copy_first_lines(bytes, keep);
        std::fs::write(&path, body).unwrap();
        let parsed =
            crate::history::parse_session_file("claude", &path, &std::collections::HashSet::new())
                .unwrap();
        let _ = std::fs::remove_dir_all(&dir);
        parsed.messages
    }

    #[test]
    fn claude_fork_cut_keeps_exactly_the_anchored_turn() {
        // 锚点轮的**结束位置**必须由提取器自己算。第二份"第几条 user 记录"的
        // 判据与提取器的可见口径必然不一致：`<local-command-stdout>` 会被它照数
        // （提取器丢弃），skill 命令信封和纯图片轮又被它跳过（提取器都保留）。
        // 偏差还会互相抵消，净效果是切点整体错位：锚定 0 号轮时切进 CLI chrome
        // 里（分支一条消息都没有），锚定"你能干啥"时连 5 条都数不满、直接判定
        // 定位失败。三种形状各放一条，任何一方口径再漂都会立刻红。
        let session_id = "11111111-1111-4111-8111-111111111111";
        let caveat = "<local-command-caveat>Caveat: The messages below were generated by the user while running local commands.</local-command-caveat>";
        let model = "<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args></command-args>";
        let stdout = "<local-command-stdout>Set model to `Opus 5.5` and saved as your default for new sessions</local-command-stdout>";
        let skill = "<command-message>aimax:code-review</command-message>\n<command-name>/aimax:code-review</command-name>\n<command-args>审查1772</command-args>";
        let lines = vec![
            // 0 caveat：开一个本地命令窗口，提取器整段丢弃。
            claude_user_line(session_id, caveat, true, "2026-10-22T11:00:00.000Z"),
            // 1 窗内的 /model 信封：提取器丢弃（窗口会把信封一起吞掉）。
            claude_user_line(session_id, model, false, "2026-10-22T11:00:01.000Z"),
            // 2 stdout：提取器丢弃；把它数成一条 user 记录就会错位（分歧一）。
            claude_user_line(session_id, stdout, false, "2026-10-22T11:00:02.000Z"),
            // 3 第一条真实提问：关掉命令窗口。0 号锚点轮。
            claude_user_line(session_id, "先看一眼仓库结构", false, "2026-10-22T11:00:03.000Z"),
            claude_assistant_line(session_id, "仓库不大", "2026-10-22T11:00:04.000Z"),
            // 5 skill 信封（窗口已关、没有 caveat）：提取器保留成 `命令 参数`，
            // 也就是一条可见 user 行；按信封判据跳过它就会错位（分歧二）。
            claude_user_line(session_id, skill, false, "2026-10-22T11:00:05.000Z"),
            claude_assistant_line(session_id, "看过了", "2026-10-22T11:00:06.000Z"),
            // 7 纯图片轮：文本为空但 images 非空，提取器保留成一条空文本的 user
            // 行——它同样是合法的切点位置；按 image 块跳过它就会错位（分歧三）。
            claude_image_only_line(session_id, "2026-10-22T11:00:07.000Z"),
            // 8
            claude_user_line(session_id, "你能干啥", false, "2026-10-22T11:00:08.000Z"),
            claude_assistant_line(session_id, "啥都能干", "2026-10-22T11:00:09.000Z"),
            // 10 最后一轮
            claude_user_line(session_id, "那再来一个", false, "2026-10-22T11:00:10.000Z"),
            claude_assistant_line(session_id, "好", "2026-10-22T11:00:11.000Z"),
        ];
        let bytes = lines.join("\n") + "\n";
        let dir = std::env::temp_dir().join(format!("ccgui-fork-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(format!("{session_id}.jsonl"));
        std::fs::write(&path, &bytes).unwrap();

        let frames = std::collections::HashSet::new();
        let parsed = crate::history::parse_session_file("claude", &path, &frames).unwrap();
        assert_eq!(
            parsed
                .messages
                .iter()
                .map(|m| m.text.as_str())
                .collect::<Vec<_>>(),
            [
                "先看一眼仓库结构",
                "仓库不大",
                // skill 信封：提取器把它显示成 `命令 参数`
                "/aimax:code-review 审查1772",
                "看过了",
                "", // 纯图片轮：提取器保留成一条空文本的 user 行
                "你能干啥",
                "啥都能干",
                "那再来一个",
                "好",
            ],
            "夹具前提：提取器的可见口径（若这里变了，切点预期也要一起改）"
        );

        // 0 号轮（第一条真实提问）：结束位置 = 1 号轮（skill 信封）那行。
        // 连第 2 行的 stdout 也数的话，切点会落到第 3 行——分支里只有 CLI
        // chrome，一条消息都没有，而且不报错。
        let anchor0 = ForkAnchor {
            user_text_sha256: text_sha256_hex("先看一眼仓库结构"),
            seq_hint: Some(1),
        };
        let cut0 = fork_keep_count(&path, &anchor0, &parsed.messages, &frames).unwrap();
        assert_eq!(cut0, 5, "0 号轮的结束位置 = 1 号轮（skill 信封）所在行");
        assert_eq!(
            parse_first_lines(&bytes, cut0)
                .iter()
                .map(|m| m.text.as_str())
                .collect::<Vec<_>>(),
            ["先看一眼仓库结构", "仓库不大"],
            "第 0 轮的分支不能拖上后面任何一轮"
        );

        // 1 号轮 = skill 信封轮：它是提取器认下的一条可见 user 行。跳过它，
        // 切点会往后挪、把图片轮一起拖进分支（切点整体错位一格）。
        let anchor1 = ForkAnchor {
            user_text_sha256: text_sha256_hex("/aimax:code-review 审查1772"),
            seq_hint: Some(3),
        };
        let cut1 = fork_keep_count(&path, &anchor1, &parsed.messages, &frames).unwrap();
        assert_eq!(cut1, 7, "1 号轮的结束位置 = 2 号轮（纯图片轮）所在行");
        assert_eq!(
            parse_first_lines(&bytes, cut1)
                .iter()
                .map(|m| m.text.as_str())
                .collect::<Vec<_>>(),
            [
                "先看一眼仓库结构",
                "仓库不大",
                "/aimax:code-review 审查1772",
                "看过了",
            ],
            "skill 轮之后的内容一条都不能进来"
        );

        // 2 号轮 = 纯图片轮：文本为空，但它是提取器认下的一条可见 user 行，
        // 所以也是一个合法的切点。
        let anchor2 = ForkAnchor {
            user_text_sha256: text_sha256_hex(""),
            seq_hint: Some(5),
        };
        let cut2 = fork_keep_count(&path, &anchor2, &parsed.messages, &frames).unwrap();
        assert_eq!(cut2, 8, "2 号轮的结束位置 = 3 号轮（你能干啥）所在行");
        assert_eq!(
            parse_first_lines(&bytes, cut2)
                .iter()
                .map(|m| m.text.as_str())
                .collect::<Vec<_>>(),
            [
                "先看一眼仓库结构",
                "仓库不大",
                "/aimax:code-review 审查1772",
                "看过了",
                "",
            ],
            "图片轮本身要留在分支里（含它那条空文本行）"
        );

        // 3 号轮（"你能干啥"）：切在 4 号轮那行，分支保留 0..9 行。
        let anchor = ForkAnchor {
            user_text_sha256: text_sha256_hex("你能干啥"),
            seq_hint: Some(6),
        };
        let cut = fork_keep_count(&path, &anchor, &parsed.messages, &frames)
            .expect("锚点必须命中：文本与转录本逐字一致");
        assert_eq!(
            cut, 10,
            "切点 = 下一轮用户记录的行号（0 起第 10 行 = `那再来一个`），不含它"
        );

        // 语义断言：复制出来的前缀恰好是"0..2 号轮 + 锚点轮"，一条不多一条不少。
        assert_eq!(
            parse_first_lines(&bytes, cut)
                .iter()
                .map(|m| m.text.as_str())
                .collect::<Vec<_>>(),
            [
                "先看一眼仓库结构",
                "仓库不大",
                "/aimax:code-review 审查1772",
                "看过了",
                "",
                "你能干啥",
                "啥都能干",
            ],
            "分支必须包含锚点那一轮（含它之前的全部轮次），且不含之后的任何内容"
        );

        // 文本对不上 → None（调用方据此明确报错，绝不退化成"从末尾分叉"）。
        let missing = ForkAnchor {
            user_text_sha256: text_sha256_hex("转录本里没有这句话"),
            seq_hint: None,
        };
        assert_eq!(
            fork_keep_count(&path, &missing, &parsed.messages, &frames),
            None
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn claude_fork_cut_keeps_the_whole_file_at_the_last_turn() {
        // 锚点轮是最后一轮：它之后没有 user 记录，切点就是 `user_row_lines` 的
        // 末尾哨兵（`usize::MAX` = 保留整个文件），**包含**用户点的那一轮。
        // 哨兵不能让调用方再去数一遍总行数——那等于把"整份文件"变成第二个事实
        // 来源，所以这里断言的是"用这个返回值复制出来的东西 == 源文件"。
        let session_id = "22222222-2222-4222-8222-222222222222";
        let caveat = "<local-command-caveat>Caveat: local command.</local-command-caveat>";
        let model = "<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args></command-args>";
        let lines = vec![
            claude_user_line(session_id, caveat, true, "2026-10-22T12:00:00.000Z"),
            claude_user_line(session_id, model, false, "2026-10-22T12:00:01.000Z"),
            // 2 唯一一轮
            claude_user_line(session_id, "你好", false, "2026-10-22T12:00:02.000Z"),
            claude_assistant_line(session_id, "你好", "2026-10-22T12:00:03.000Z"),
            // 末尾还有一条 stdout：它不产生 user 消息，但确实占一行——"整份
            // 文件"必须把它一起带上。
            claude_user_line(
                session_id,
                "<local-command-stdout>Set model to Opus</local-command-stdout>",
                false,
                "2026-10-22T12:00:04.000Z",
            ),
        ];
        let bytes = lines.join("\n") + "\n";
        let dir = std::env::temp_dir().join(format!("ccgui-fork-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(format!("{session_id}.jsonl"));
        std::fs::write(&path, &bytes).unwrap();

        let frames = std::collections::HashSet::new();
        let parsed = crate::history::parse_session_file("claude", &path, &frames).unwrap();
        assert_eq!(
            parsed
                .messages
                .iter()
                .map(|m| m.text.as_str())
                .collect::<Vec<_>>(),
            ["你好", "你好"],
            "夹具前提：caveat 与窗内信封都不产出 user 行，唯一一轮在第 2 行"
        );

        let anchor = ForkAnchor {
            user_text_sha256: text_sha256_hex("你好"),
            seq_hint: Some(1),
        };
        let cut = fork_keep_count(&path, &anchor, &parsed.messages, &frames)
            .expect("锚点必须命中：文本与转录本逐字一致");
        assert_eq!(
            cut,
            usize::MAX,
            "最后一轮的切点 = 整份文件（末尾哨兵，不是某个会截掉尾巴的行号）"
        );
        // 用返回值真复制一遍：分支文件必须与源文件逐字节相同（末尾那条 stdout
        // 也在里面）。
        assert_eq!(
            copy_first_lines(&bytes, cut),
            bytes,
            "哨兵必须复制整份文件（全部 {} 行）",
            lines.len()
        );
        assert_eq!(
            parse_first_lines(&bytes, cut)
                .iter()
                .map(|m| m.text.as_str())
                .collect::<Vec<_>>(),
            ["你好", "你好"],
            "分支包含锚点轮本身"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 纯图片轮：文本为空，但提取器仍产出一条可见 user 消息（`ImageMode::Collect`
    /// 下图片会被收进来；扫描器的 SkipDataUrls 模式才会让它掉出计数）。
    fn claude_image_only_line(session_id: &str, ts: &str) -> String {
        serde_json::json!({
            "type": "user",
            "uuid": uuid::Uuid::new_v4().to_string(),
            "parentUuid": serde_json::Value::Null,
            "sessionId": session_id,
            "timestamp": ts,
            "message": {
                "role": "user",
                "content": [
                    { "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "aGk=" } }
                ]
            }
        })
        .to_string()
    }

    #[test]
    fn uuid_shape_is_enforced() {
        assert!(is_uuid("3f7a1c2e-9b44-4d18-8a55-6c0d2e7b91af"));
        assert!(!is_uuid("fork-test-123"));
        assert!(!is_uuid(""));
        // A session *title* is free text; it must never reach argv.
        assert!(!is_uuid("我的分叉会话"));
    }

    #[test]
    fn sha256_matches_the_frontend_implementation() {
        // 与 `src/lib/sha256.ts` 逐字节一致是硬要求：前端算的是它手里那条用户
        // 消息的摘要，后端拿它去转录本里定位。四个向量来自前端实现的输出，
        // 中文与 emoji 覆盖多字节 UTF-8 与代理对。
        assert_eq!(
            text_sha256_hex(""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            text_sha256_hex("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(
            text_sha256_hex("你好，你是谁"),
            "c8602108e6785150c66dea21774d99aaa0cfbce1f0b3105356a0e96e2bb4651e"
        );
        assert_eq!(
            text_sha256_hex("🀄️ fork"),
            "cc1500f9cff7d754ce685d941a75d321e9582eb7ef8cb00d5e09d3d15a3d2253"
        );
    }

    #[test]
    fn bad_lines_are_skipped_not_fatal() {
        assert!(parse_json_line("{not json").is_none());
        assert!(parse_json_line("   ").is_none());
        assert!(parse_json_line(r#"{"type":"user"}"#).is_some());
    }

    /// 锚点落在**同一轮里的第二条** user 消息上时，codex 的切点必须仍在那一轮。
    ///
    /// 与 dsh 那条同一类问题：`anchor_turn` 数的是**可见 user 消息**条数，而 codex 的
    /// 轮由 `task_started` … `task_complete` 包起来，一轮里可以有多条 user 消息（用户在
    /// 一轮进行中补充说明就会这样落盘）。把消息序号直接当轮号，锚点点在某轮第二条上会
    /// 让切点落到**下一轮**的 `task_complete`，分支静默多带一整轮内容。
    #[test]
    fn codex_anchoring_the_second_user_message_of_a_turn_still_cuts_that_turn() {
        let lines = [
            r#"{"type":"session_meta","payload":{"id":"src"}}"#, // 0
            r#"{"type":"event_msg","payload":{"type":"task_started"}}"#, // 1 轮1开始
            r#"{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"第一轮提问"}]}}"#, // 2
            r#"{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"第一轮追问"}]}}"#, // 3 同一轮里的第二条
            r#"{"type":"event_msg","payload":{"type":"task_complete"}}"#, // 4 轮1结束
            r#"{"type":"event_msg","payload":{"type":"task_started"}}"#, // 5 轮2开始
            r#"{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"第二轮提问"}]}}"#, // 6
            r#"{"type":"event_msg","payload":{"type":"task_complete"}}"#, // 7 轮2结束
        ];
        let dir = std::env::temp_dir().join(format!("ccgui-fork-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("rollout-src.jsonl");
        std::fs::write(&path, lines.join("\n") + "\n").unwrap();
        let parsed =
            crate::history::parse_session_file("codex", &path, &std::collections::HashSet::new())
                .unwrap()
                .messages;

        let anchor = ForkAnchor {
            user_text_sha256: text_sha256_hex("第一轮追问"),
            seq_hint: Some(2),
        };
        // 轮 1 的 `task_complete` 在第 4 行（含端点）⇒ 切点 5。
        // 把消息序号当轮号会算成"轮 2"，落到第 7 行的 `task_complete` ⇒ 8（多带一轮）。
        assert_eq!(
            fork_keep_count_codex(&path, &anchor, &parsed, &std::collections::HashSet::new()),
            Some(5),
            "锚点是第 1 轮的第二条 user 消息，切点必须仍在第 1 轮末尾"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn codex_cut_lands_between_complete_turns() {
        // 一份合成的 Codex rollout：两轮，每轮 task_started … task_complete，
        // 轮内夹着非会话记录（turn_context / token_count）。
        //
        // 两条 `response_item` 必须带 `role` 与 `content`：切点会**在文件里**数可见
        // user 消息（`codex_line_is_visible_user`，与提取器同一个判据），只有 payload.type
        // 的空壳在真实日志里不存在，也数不出任何 user 消息。
        let lines = [
            r#"{"type":"session_meta","payload":{"id":"src"}}"#,          // 0
            r#"{"type":"event_msg","payload":{"type":"task_started"}}"#,  // 1 轮1开始
            r#"{"type":"turn_context","payload":{}}"#,                    // 2
            r#"{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"第一轮提问"}]}}"#, // 3
            r#"{"type":"event_msg","payload":{"type":"token_count"}}"#,   // 4
            r#"{"type":"event_msg","payload":{"type":"task_complete"}}"#, // 5 轮1结束
            r#"{"type":"event_msg","payload":{"type":"task_started"}}"#,  // 6 轮2开始
            r#"{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"第二轮提问"}]}}"#, // 7
            r#"{"type":"event_msg","payload":{"type":"task_complete"}}"#, // 8 轮2结束
        ];
        let dir = std::env::temp_dir().join(format!("ccgui-fork-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("rollout-src.jsonl");
        std::fs::write(&path, lines.join("\n") + "\n").unwrap();

        // 解析出的消息：两条 user 提问（第 1、2 轮）。
        let parsed = vec![
            crate::history::Message {
                seq: 1,
                role: "user".into(),
                text: "第一轮提问".into(),
                ts: None,
                path: None,
                args: None,
                result: None,
                todos: None,
                usage: None,
                model: None,
                effort: None,
                duration_ms: None,
                images: Vec::new(),
            },
            crate::history::Message {
                seq: 2,
                role: "user".into(),
                text: "第二轮提问".into(),
                ts: None,
                path: None,
                args: None,
                result: None,
                todos: None,
                usage: None,
                model: None,
                effort: None,
                duration_ms: None,
                images: Vec::new(),
            },
        ];

        // 锚点 = 第二轮 → 分支**包含**第二轮，切在轮2的 task_complete 之后（第 9 行，EOF）。
        let anchor = ForkAnchor {
            user_text_sha256: text_sha256_hex("第二轮提问"),
            seq_hint: Some(2),
        };
        assert_eq!(fork_keep_count_codex(&path, &anchor, &parsed, &std::collections::HashSet::new()), Some(9));

        // 锚点 = 第一轮 → 包含第一轮，切在轮1的 task_complete 之后（第 6 行）。
        let anchor = ForkAnchor {
            user_text_sha256: text_sha256_hex("第一轮提问"),
            seq_hint: Some(1),
        };
        assert_eq!(fork_keep_count_codex(&path, &anchor, &parsed, &std::collections::HashSet::new()), Some(6));

        // 文本对不上 → None（调用方据此明确报错，绝不退化成"从末尾分叉"）。
        let anchor = ForkAnchor {
            user_text_sha256: text_sha256_hex("不存在的提问"),
            seq_hint: None,
        };
        assert_eq!(fork_keep_count_codex(&path, &anchor, &parsed, &std::collections::HashSet::new()), None);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn fork_sibling_number_needs_an_exact_whole_name_match() {
        // 同级判据必须是"整串相等"：`<源名> (fork #k)` 才算同级，不剥任何后缀。
        assert_eq!(fork_sibling_number("数学", "数学 (fork #1)"), Some(1));
        assert_eq!(fork_sibling_number("数学", "数学 (fork #12)"), Some(12));
        // 源名自己（未生成过任何分支）不算同级。
        assert_eq!(fork_sibling_number("数学", "数学"), None);
        // 孙分支：源名 `数学` 与它**不**整串相等（多了一截 ` (fork #1)`），不是同级。
        // 前缀判据会在这里返回 Some(1)，正是要避免的错。
        assert_eq!(
            fork_sibling_number("数学", "数学 (fork #1) (fork #1)"),
            None
        );
        // 同一个源名下，父分支才是同级——新规则下它就是"源会话当前名"。
        assert_eq!(
            fork_sibling_number("数学 (fork #1)", "数学 (fork #1) (fork #1)"),
            Some(1),
            "分叉分支时，父分支才是同级"
        );
        assert_eq!(
            fork_sibling_number("数学 (fork #1)", "数学 (fork #1) (fork #12)"),
            Some(12)
        );
        // 形状不对的一律不算（用户自己起的名字不能被动）。
        assert_eq!(fork_sibling_number("数学", "数学 (fork #)"), None);
        assert_eq!(fork_sibling_number("数学", "数学 (fork #x)"), None);
        assert_eq!(fork_sibling_number("数学", "数学 (fork #+1)"), None);
        assert_eq!(fork_sibling_number("数学", "数学 (分支)"), None);
        assert_eq!(fork_sibling_number("数学", "数学 (fork #1) 续"), None);
        assert_eq!(fork_sibling_number("数学", "数学 (fork #1) (fork #2)"), None);
        // 名字前半段相同也不行：整串相等是硬要求。
        assert_eq!(fork_sibling_number("数学", "数学课 (fork #1)"), None);
    }

    /// 往 `sessions` 插一行只用来定名字的会话：`custom_title` 为 `None` 时该行
    /// 的有效名就是推导标题 `title`（`taken_titles` 的折法）。
    fn insert_named_session(
        db: &crate::db::Db,
        engine: &str,
        session_id: &str,
        custom_title: Option<&str>,
        title: &str,
    ) {
        db.0.lock()
            .execute(
                "INSERT INTO sessions(engine, session_id, workspace_path, file_path,
                     file_size, file_mtime_ms, title, custom_title, preview, message_count)
                 VALUES(?1, ?2, '/ws', '/ws/x.jsonl', 0, 0, ?3, ?4, '', 1)",
                rusqlite::params![engine, session_id, title, custom_title],
            )
            .unwrap();
    }

    /// 造一个只用于起名的临时库（无需真转录本：`next_fork_title` 只看表）。
    fn naming_db(prefix: &str) -> (PathBuf, crate::db::Db) {
        let dir = std::env::temp_dir().join(format!("{prefix}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let db = crate::db::Db::open_at(&dir.join("app.db")).unwrap();
        (dir, db)
    }

    #[test]
    fn fork_numbers_do_not_count_grandchildren_as_siblings() {
        // ⚠️ 这条钉的是最容易写错的那一步：同级判据必须是**整串相等**。
        // 改成前缀判据（`name.starts_with("A (fork #")`）后，下面的孙分支
        // `A (fork #1) (fork #1)` 会被数成 `A` 的同级，于是 `A` 的新分支拿到
        // `A (fork #3)`——而正确答案是 #2。
        let (dir, db) = naming_db("ccgui-fork-name-trap");
        let custom = |db: &crate::db::Db, id: &str, name: &str| {
            insert_named_session(db, "claude", id, Some(name), "转录本推导标题");
        };
        custom(&db, "00000000-0000-4000-8000-000000000001", "A");
        custom(&db, "00000000-0000-4000-8000-000000000002", "A (fork #1)");
        custom(
            &db,
            "00000000-0000-4000-8000-000000000003",
            "A (fork #1) (fork #1)",
        );

        assert_eq!(
            next_fork_title(&db, "claude", "A").unwrap(),
            "A (fork #2)",
            "孙分支不是 A 的同级：前缀判据会在这里给出 #3"
        );
        // 反向也钉一遍：分叉那个分支（它的当前名就是 `A (fork #1)`）时，孙分支
        // 才是它的同级，所以下一个是 `(fork #2)`。
        assert_eq!(
            next_fork_title(&db, "claude", "A (fork #1)").unwrap(),
            "A (fork #1) (fork #2)"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn forking_a_branch_appends_and_keeps_the_lineage() {
        // 命名规则的核心行为：从源会话的**当前名**追加，不剥任何后缀，所以世系在名字
        // 里可见——`A (fork #1) (fork #1)`。剥掉结尾的 `(fork #N)` 会得到
        // `A (fork #2)`，世系看不见。
        let (dir, db) = naming_db("ccgui-fork-name-lineage");
        insert_named_session(&db, "claude", "00000000-0000-4000-8000-000000000001", None, "A");
        let name = |db: &crate::db::Db, id: &str| -> String {
            db.0.lock()
                .query_row(
                    "SELECT COALESCE(custom_title, title) FROM sessions
                      WHERE engine='claude' AND session_id=?1",
                    [id],
                    |r| r.get(0),
                )
                .unwrap()
        };

        // 第一次分叉：源名 `A` 下没有任何同级 → #1。
        assert_eq!(next_fork_title(&db, "claude", "A").unwrap(), "A (fork #1)");
        insert_named_session(
            &db,
            "claude",
            "00000000-0000-4000-8000-000000000002",
            Some("A (fork #1)"),
            "转录本推导标题",
        );
        // 分叉那个分支：它的当前名就是 `A (fork #1)`，追加得到 `(fork #1)`。
        assert_eq!(
            next_fork_title(&db, "claude", &name(&db, "00000000-0000-4000-8000-000000000002"))
                .unwrap(),
            "A (fork #1) (fork #1)",
            "从分支再分叉要看得见世系"
        );
        insert_named_session(
            &db,
            "claude",
            "00000000-0000-4000-8000-000000000003",
            Some("A (fork #1) (fork #1)"),
            "转录本推导标题",
        );
        // 再分叉源会话：同级仍只有 `A (fork #1)`——孙分支不是它的同级（见上一条
        // 测试），所以是 #2，不是 #3。
        assert_eq!(next_fork_title(&db, "claude", "A").unwrap(), "A (fork #2)");
        // 源会话自己的名字没被任何一次分叉改过（未改名时反复分叉仍是 1、2、…）。
        assert_eq!(name(&db, "00000000-0000-4000-8000-000000000001"), "A");
        // 反过来源名也能直接取自表里的**当前名**：`resolve_fork_plan` 就是这么取的。
        assert_eq!(name(&db, "00000000-0000-4000-8000-000000000002"), "A (fork #1)");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn fork_numbers_use_max_plus_one_and_never_reuse_a_gap() {
        // 同级 {#1, #3}：下一个必须是 **#4**，缺掉的 #2 不复用（产品定的规则：
        // 用户记住的编号不能被悄悄回收）。取最小空闲编号会给出 #2，是错的。
        let (dir, db) = naming_db("ccgui-fork-name-gap");
        insert_named_session(&db, "claude", "00000000-0000-4000-8000-000000000001", None, "A");
        insert_named_session(
            &db,
            "claude",
            "00000000-0000-4000-8000-000000000002",
            Some("A (fork #1)"),
            "转录本推导标题",
        );
        insert_named_session(
            &db,
            "claude",
            "00000000-0000-4000-8000-000000000003",
            Some("A (fork #3)"),
            "转录本推导标题",
        );
        assert_eq!(
            next_fork_title(&db, "claude", "A").unwrap(),
            "A (fork #4)",
            "空出来的 #2 是故意不复用的"
        );

        // 编号跨位数也按大小比，不按字符串比：{#2, #10} 的下一个是 #11。
        insert_named_session(
            &db,
            "claude",
            "00000000-0000-4000-8000-000000000004",
            Some("B (fork #2)"),
            "转录本推导标题",
        );
        insert_named_session(
            &db,
            "claude",
            "00000000-0000-4000-8000-000000000005",
            Some("B (fork #10)"),
            "转录本推导标题",
        );
        assert_eq!(next_fork_title(&db, "claude", "B").unwrap(), "B (fork #11)");

        // 同级集合按**引擎**取：别的引擎下同名会话不参与编号。
        insert_named_session(
            &db,
            "codex",
            "00000000-0000-4000-8000-000000000006",
            Some("C (fork #7)"),
            "转录本推导标题",
        );
        assert_eq!(
            next_fork_title(&db, "claude", "C").unwrap(),
            "C (fork #1)",
            "编号只看同一引擎下的同级"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn fork_title_still_skips_a_name_taken_by_a_transcript_derived_title() {
        // `max+1` 起步之后仍保留一次查重：某个会话的**推导标题**恰好等于我们要发的
        // 名字时，两个会话同名、侧栏分不清谁是谁，所以跳过它。这不是"最小空闲编号"
        // 的回归——起点永远是同级最大值 + 1。
        let (dir, db) = naming_db("ccgui-fork-name-collision");
        insert_named_session(&db, "claude", "00000000-0000-4000-8000-000000000001", None, "A");
        insert_named_session(
            &db,
            "claude",
            "00000000-0000-4000-8000-000000000002",
            None,
            "A (fork #1)",
        );

        assert_eq!(
            next_fork_title(&db, "claude", "A").unwrap(),
            "A (fork #2)",
            "推导标题已经占住 A (fork #1) 时不能再发同一个名字"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn deep_fork_nesting_elides_to_five_segments_behind_an_ellipsis() {
        // 深度嵌套：没有上限时一路分叉下去名字会无限长。上限是后缀链最多 5 段
        // + 整串最多 80 字符，更早的段用 `…` 表示省略。
        let (dir, db) = naming_db("ccgui-fork-name-depth");
        let mut parent = "A".to_string();
        let mut produced = Vec::new();
        for level in 0..7 {
            let title = next_fork_title(&db, "claude", &parent).unwrap();
            // 每一层都真的登记进表里：编号只看表，不插进去下一层就不是真实场景
            // （`title` 与 `custom_title` 的折法会影响同级集合）。
            insert_named_session(
                &db,
                "claude",
                &format!("00000000-0000-4000-8000-{level:012}"),
                Some(&title),
                "转录本推导标题",
            );
            produced.push(title.clone());
            parent = title;
        }

        // 第 1..5 层仍是老样子：每分叉一次加一段，不省略。
        assert_eq!(produced[0], "A (fork #1)");
        assert_eq!(
            produced[4],
            "A (fork #1) (fork #1) (fork #1) (fork #1) (fork #1)"
        );
        // 第 6 层：接上新段就是 6 段 → 只留最新 5 段，根名后插一个 `…`。
        assert_eq!(
            produced[5],
            "A … (fork #1) (fork #1) (fork #1) (fork #1) (fork #1)"
        );
        assert!(produced[5].contains(FORK_ELISION_MARK), "省略必须看得见");
        // 第 7 层：候选恰好与第 6 层同名（父名已带 `…`，`#1` 又是从完整父名算出来的
        // 起点），查重把编号顶到 `#2`。这条就是"上限压出同名"那条路。
        assert_eq!(
            produced[6],
            "A … (fork #1) (fork #1) (fork #1) (fork #1) (fork #2)"
        );
        // 每一层都不越界：段数 ≤ 5、整串 ≤ 80 字符。
        for title in &produced {
            assert!(
                title.matches(FORK_MARK).count() <= MAX_FORK_SUFFIX_SEGMENTS,
                "后缀链超过段数上限: {title}"
            );
            assert!(
                title.chars().count() <= MAX_FORK_TITLE_CHARS,
                "标题超过字符预算: {title}"
            );
        }

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_long_fork_title_truncates_the_root_and_keeps_the_suffix_chain() {
        // 字符预算：整串超过 80 时**只能**截根名——后缀链在段数上限下最多 5 段，
        // 永远放得下；`…` 与后缀链是固定尾部，不能被截掉。
        let (dir, db) = naming_db("ccgui-fork-name-budget");
        // 100 个汉字 = 300 字节：按字节截会 panic 或切出半个字，按字符截才对。
        let root = "题".repeat(100);
        let parent = format!("{root} (fork #2) (fork #3) (fork #4) (fork #5) (fork #6)");
        let title = next_fork_title(&db, "claude", &parent).unwrap();

        // 尾部 = ` …`（2）+ 5 段（`(fork #k)` 9 字符 + 分隔空格 = 每段 10）= 52，
        // 所以根名分到 80 - 52 = 28 个字符。尾部**已经**带 `…`（段数上限丢过段），
        // 根名被切也不再补第二个——一条标题里两个省略号说不清省掉的是哪一段；那 1 个
        // 字符同样不预留，所以根名照样吃满 28 个字符。
        assert_eq!(
            title.chars().count(),
            MAX_FORK_TITLE_CHARS,
            "超出预算时要把预算正好用满: {title}"
        );
        assert!(title.starts_with(&"题".repeat(28)), "根名按字符截到预算: {title}");
        assert!(title.contains(FORK_ELISION_MARK), "省略标记不能被截掉: {title}");
        assert_eq!(
            title.matches(FORK_ELISION_MARK).count(),
            1,
            "尾部已有 `…` 时根名不能再补一个: {title}"
        );
        assert!(
            title.ends_with("(fork #3) (fork #4) (fork #5) (fork #6) (fork #1)"),
            "整条后缀链必须原样保留（最老的 #2 是被段数上限丢掉的）: {title}"
        );
        assert!(!title.contains("(fork #2)"), "最老的段已被省略: {title}");

        // 没有后缀链时也一样：预算全给根名（80 - ` (fork #1)` 的 10 个字符 = 70），
        // 但根名被截断时最后 1 个字符必须留给 `…`——`history::truncate_chars` 是静默
        // 的，不补标记的话 `题×100` 会被截成看起来完整的 `题×70`，用户看不出被切过。
        let plain = next_fork_title(&db, "claude", &root).unwrap();
        assert_eq!(plain.chars().count(), MAX_FORK_TITLE_CHARS);
        assert_eq!(
            plain.strip_suffix(" (fork #1)"),
            Some(format!("{}…", "题".repeat(69)).as_str()),
            "单段的情况下根名分到 70 个字符，最后 1 个是省略标记: {plain}"
        );
        assert_eq!(
            plain.trim_end_matches(" (fork #1)").chars().last(),
            Some(FORK_ELISION_MARK),
            "被截断的根名必须以 `…` 收尾: {plain}"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_root_cut_by_the_budget_ends_with_a_visible_ellipsis() {
        // 根名这一侧的截断也必须留痕（与 `git.rs` 截 diff 时插显式截断标记同一条
        // 约定）：`history::truncate_chars` 只做 `chars().take(max)`，不留任何提示，
        // 所以补 `…` 是这里的事——并且要从预算里**真的扣掉那 1 个字符**：只补不扣会
        // 超预算，只扣不补会让整串短 1 个字符（80 的预算只用到 79）。
        let (dir, db) = naming_db("ccgui-fork-name-root-marker");

        // 根名正好吃满预算（80 - ` (fork #1)` 的 10 个字符 = 70）：没被截，就不该
        // 凭空多出一个 `…`。
        let title = next_fork_title(&db, "claude", &"题".repeat(70)).unwrap();
        assert_eq!(title, format!("{} (fork #1)", "题".repeat(70)));
        assert!(
            !title.contains(FORK_ELISION_MARK),
            "没被截断的根名不能补省略标记: {title}"
        );

        // 只超 1 个字符也算被截：根名 69 个字符 + `…` = 预算的 70 个字符，整串正好
        // 80——预留的那 1 个字符必须真的被 `…` 用掉。
        let title = next_fork_title(&db, "claude", &"题".repeat(71)).unwrap();
        assert_eq!(
            title.chars().count(),
            MAX_FORK_TITLE_CHARS,
            "被截断时也要正好用满预算: {title}"
        );
        assert_eq!(
            title.strip_suffix(" (fork #1)"),
            Some(format!("{}…", "题".repeat(69)).as_str()),
            "被截断的根名要以 `…` 收尾: {title}"
        );

        // 尾部**已经**带 `…`（父名里带着省略标记，段数上限留下的）时：根名被截也
        // 不再补第二个，那 1 个字符同样不预留——无条件预留会得到 79 个字符
        // （80 的预算用不满）。
        let parent = format!("{} … (fork #1) (fork #3)", "题".repeat(100));
        let title = next_fork_title(&db, "claude", &parent).unwrap();
        assert_eq!(
            title.chars().count(),
            MAX_FORK_TITLE_CHARS,
            "尾部已有标记时也必须正好用满预算（预留却不插会短 1 个字符）: {title}"
        );
        assert_eq!(
            title.matches(FORK_ELISION_MARK).count(),
            1,
            "一条标题里不能出现两个省略号: {title}"
        );
        assert_eq!(
            title,
            format!("{} … (fork #1) (fork #3) (fork #1)", "题".repeat(48)),
            "尾部 32 个字符（` …` + 3 段各 10 个）扣掉后根名分到 48 个字符"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 从一个"被预算截断过的分支"再分叉，绝不会发出与父名**相同的**标题。
    ///
    /// 这个场景值得单钉一条：`strip_elision_marker` 只能报告"这里有过一个 `…`"，分不清
    /// 它是**段被省略**还是**根名被预算截断**，于是 `add_marker` 可能被压成 false、
    /// 根名不再补标记，父子名塌成同一串，连 `taken_titles` 都救不了（`HashSet` 里
    /// 两个相同串本来就分不开）。
    ///
    /// 按算术不成立：子名永远比父名**多一段**后缀，根名因此少约 11 个字符，两串不可能
    /// 相同。这里把两种根名长度都钉住——恰好用满预算（不截）与超出 1 个字（截出
    /// `…`）——并同时走一遍 `next_fork_title` 的真实查重路径。
    #[test]
    fn forking_a_budget_truncated_branch_never_reuses_the_parent_title() {
        // 单段尾 ` (fork #1)` 占 10 个字符 ⇒ 根名预算 70。
        for root_len in [70usize, 71] {
            let root = "题".repeat(root_len);
            let first = capped_fork_title(&root, 1);
            let second = capped_fork_title(&first, 1);

            assert!(
                first.chars().count() <= MAX_FORK_TITLE_CHARS,
                "第一层就不该超预算（{root_len} 字根名）：{first:?}"
            );
            assert!(
                second.chars().count() <= MAX_FORK_TITLE_CHARS,
                "第二层也不该超预算（{root_len} 字根名）：{second:?}"
            );
            assert_ne!(
                first, root,
                "分支标题必须带上新段，不能等于父名（{root_len} 字根名）"
            );
            assert_ne!(
                second, first,
                "从被截断的分支再分叉，绝不能发出与父名相同的标题（{root_len} 字根名）"
            );
        }

        // 真实路径：第一层分叉的结果会立刻登记进表（写 `custom_title`），第二层分叉
        // 因此看得见它。两者必须不同名。
        let (dir, db) = naming_db("ccgui-fork-truncated-branch-chain");
        for (n, root_len) in [70usize, 71].into_iter().enumerate() {
            let root = "题".repeat(root_len);
            let a = next_fork_title(&db, "claude", &root).unwrap();
            // 每轮用不同 id：`sessions` 上 (engine, session_id) 是唯一键。
            insert_named_session(
                &db,
                "claude",
                &format!("00000000-0000-4000-8000-{n:012}"),
                Some(&a),
                "转录本推导标题",
            );
            let b = next_fork_title(&db, "claude", &a).unwrap();
            assert_ne!(b, a, "沿被截断的分支继续分叉，父子不能同名（{root_len} 字根名）");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn collapsed_fork_titles_still_get_a_free_number() {
        // 上限会把**不同**的父名压成同一个串（根名撞到同一个前缀，或后缀链被省略成
        // 同样的 5 段）。那时 `taken_titles` 的查重必须把编号顶开，否则两个会话同名、
        // 侧栏里分不清谁是谁。
        let (dir, db) = naming_db("ccgui-fork-name-collapse");

        // (1) 根名被截断后撞车：两个父名只在第 101 个字上不同，截到预算（根名 69 个
        // 字符 + `…`）之后完全一样。截断自己会留下 `…`，所以"被占住的那个候选"也是
        // 带标记的形状（不带标记的 `题×70 + " (fork #1)"` 已经不是本模块会产出的名字）。
        let root_a = format!("{}甲", "题".repeat(100));
        let root_b = format!("{}乙", "题".repeat(100));
        let collapsed = format!("{}… (fork #1)", "题".repeat(69));
        insert_named_session(
            &db,
            "claude",
            "00000000-0000-4000-8000-000000000001",
            None,
            &collapsed,
        );
        let a = next_fork_title(&db, "claude", &root_a).unwrap();
        assert_eq!(
            a,
            format!("{}… (fork #2)", "题".repeat(69)),
            "候选 #1 与已占住的名字同形，查重必须把编号顶开"
        );
        assert_ne!(a, collapsed, "被占住的候选绝不能原样发出去");

        // 两个不同的父名压成同一个根名之后必须**不同名**：真实流程里分叉结果会立刻
        // 登记进表（`register_fork_landing_with_path` 写 `custom_title`），所以第二次
        // 分叉一定看得见第一个分支已经占了那个候选串，编号要接着让开。
        insert_named_session(
            &db,
            "claude",
            "00000000-0000-4000-8000-000000000003",
            Some(&a),
            "转录本推导标题",
        );
        let b = next_fork_title(&db, "claude", &root_b).unwrap();
        assert_eq!(b, format!("{}… (fork #3)", "题".repeat(69)));
        assert_ne!(b, a, "两个父名压成同一串时，两个分支绝不能同名");

        // (2) 后缀链被省略后撞车：两个父名的新老段都不同，但接上新段后**最新的 5 段**
        // 相同（第 6 段与第 1 段都被丢掉），拼出来的候选又是同一个串。
        let parent_long = "A (fork #1) (fork #2) (fork #3) (fork #4) (fork #5) (fork #6)";
        // 被省略过的分支就是"根名带 `…` + 5 段"这个形状（上限自己产出来的样子）。
        let parent_elided = "A … (fork #9) (fork #3) (fork #4) (fork #5) (fork #6)";
        insert_named_session(
            &db,
            "claude",
            "00000000-0000-4000-8000-000000000002",
            Some("A … (fork #3) (fork #4) (fork #5) (fork #6) (fork #1)"),
            "转录本推导标题",
        );
        let c = next_fork_title(&db, "claude", parent_long).unwrap();
        let d = next_fork_title(&db, "claude", parent_elided).unwrap();
        assert_eq!(c, "A … (fork #3) (fork #4) (fork #5) (fork #6) (fork #2)");
        assert_eq!(d, c, "省略出来的同名候选同样要让开编号");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn fork_sibling_numbering_uses_the_stored_ellipsis_bearing_parent() {
        // 省略标记是**存下来的父名的一部分**：同级判据必须拿完整父名去比（含 `…`），
        // 不能先"洗干净"——同一个东西两套判据必然分家。
        let (dir, db) = naming_db("ccgui-fork-name-ellipsis");
        insert_named_session(
            &db,
            "claude",
            "00000000-0000-4000-8000-000000000001",
            Some("A … (fork #1) (fork #3)"),
            "转录本推导标题",
        );
        assert_eq!(
            next_fork_title(&db, "claude", "A … (fork #1)").unwrap(),
            "A … (fork #1) (fork #4)",
            "编号必须接着完整父名下的最大同级 #3 往下走，且根名里的 `…` 保留"
        );
        // 洗干净的父名不是同一个东西：`fork_sibling_number` 只认**结尾**的段、且要求
        // 整串相等，去掉 `…` 之后那个同级就数不到了。
        assert_eq!(
            fork_sibling_number("A … (fork #1)", "A … (fork #1) (fork #3)"),
            Some(3)
        );
        assert_eq!(
            fork_sibling_number("A (fork #1)", "A … (fork #1) (fork #3)"),
            None
        );
        // 根名里带 `…`（不在结尾）也不会让拆段跑偏：只剥结尾的 `(fork #k)`。
        assert_eq!(
            split_fork_suffixes("A … B (fork #1) (fork #2)"),
            ("A … B", vec!["(fork #1)", "(fork #2)"])
        );
        // 形状不对的段留在根名里（判据只有 `fork_sibling_number` 一份，不另写一个）。
        assert_eq!(
            split_fork_suffixes("A (fork #x) (fork #1)"),
            ("A (fork #x)", vec!["(fork #1)"])
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn next_fork_title_uses_the_source_row_current_name() {
        // 命名规则的起点：源会话**当前名** = `custom_title` 非空则用它，否则用它
        // 推导的 `title`；分支标题只在这个名字后面追加。
        let source_id = "11111111-1111-4111-8111-111111111111";
        let body = [
            claude_user_line(source_id, "你好你是谁", false, "2026-10-22T11:00:00.000Z"),
            claude_assistant_line(source_id, "我是 Claude", "2026-10-22T11:00:05.000Z"),
        ]
        .join("\n")
            + "\n";
        let (dir, db, _source_path) = fork_source_fixture("claude", source_id, "C:/repo", &body);
        // 夹具给源行写的是**固定标题**（与 body 无关），而这条测试验证的正是
        // "当前名取自源行"，所以先把源行的推导标题对齐成 body 的实际首条消息，
        // 否则断言比对的是夹具的常量，而不是本测试关心的规则。
        db.0.lock()
            .execute(
                "UPDATE sessions SET title='你好你是谁' WHERE engine='claude' AND session_id=?1",
                [source_id],
            )
            .unwrap();

        // 没改过名：当前名就是推导标题。
        let plan = resolve_fork_plan(&db, "claude", source_id, None).unwrap();
        assert_eq!(plan.source_title, "你好你是谁");
        assert_eq!(
            next_fork_title(&db, "claude", &plan.source_title).unwrap(),
            "你好你是谁 (fork #1)"
        );

        // 用户改过名：当前名换成 `custom_title`，编号也跟着换到新名字下。
        db.0.lock()
            .execute(
                "UPDATE sessions SET custom_title='数学题' WHERE engine='claude' AND session_id=?1",
                [source_id],
            )
            .unwrap();
        let plan = resolve_fork_plan(&db, "claude", source_id, None).unwrap();
        assert_eq!(plan.source_title, "数学题");
        assert_eq!(
            next_fork_title(&db, "claude", &plan.source_title).unwrap(),
            "数学题 (fork #1)"
        );

        // 纯空白的 `custom_title` 不算改名（与 `taken_titles` 的折法同一条判据）。
        db.0.lock()
            .execute(
                "UPDATE sessions SET custom_title='   ' WHERE engine='claude' AND session_id=?1",
                [source_id],
            )
            .unwrap();
        let plan = resolve_fork_plan(&db, "claude", source_id, None).unwrap();
        assert_eq!(plan.source_title, "你好你是谁");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn registration_writes_the_numbered_branch_title() {
        // 端到端跑一遍"点击即落盘"的注册链路（真 Db + 真转录本文件），断言
        // `custom_title` 真的被写成 `<源会话当前名> (fork #N)`——这一列是分支编号的
        // 唯一来源，标题没写进去，侧栏就看不出这是分支。
        let dir = std::env::temp_dir().join(format!("ccgui-fork-title-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let db = crate::db::Db::open_at(&dir.join("app.db")).unwrap();

        let src_id = "11111111-1111-4111-8111-111111111111";
        let src_path = dir.join(format!("{src_id}.jsonl"));
        let rec = |uuid: &str, parent: Option<&str>, role: &str, text: &str, ts: &str| {
            format!(
                r#"{{"type":"{role}","uuid":"{uuid}","parentUuid":{},"sessionId":"{src_id}","timestamp":"{ts}","message":{{"role":"{role}","content":[{{"type":"text","text":"{text}"}}]}}}}"#,
                match parent {
                    Some(p) => format!("\"{p}\""),
                    None => "null".to_string(),
                }
            )
        };
        let body = [
            rec("u1", None, "user", "你好你是谁", "2026-10-22T11:00:00.000Z"),
            rec("a1", Some("u1"), "assistant", "我是 Claude", "2026-10-22T11:00:05.000Z"),
        ]
        .join("\n");
        std::fs::write(&src_path, body + "\n").unwrap();

        // 源会话行（扫描器或更早的登记留下的）
        {
            let conn = db.0.lock();
            conn.execute(
                "INSERT INTO sessions(engine, session_id, workspace_path, file_path,
                     file_size, file_mtime_ms, title, preview, message_count)
                 VALUES('claude', ?1, ?2, ?3, 0, 0, '你好你是谁', '', 5)",
                rusqlite::params![src_id, dir.to_string_lossy(), src_path.to_string_lossy()],
            )
            .unwrap();
        }

        let target = "22222222-2222-4222-8222-222222222222";
        materialize_trimmed_fork(&db, "claude", src_id, target, usize::MAX).unwrap();
        let title = next_fork_title(&db, "claude", "你好你是谁").unwrap();
        assert_eq!(title, "你好你是谁 (fork #1)");
        assert!(
            register_fork_landing_with_path(&db, "claude", src_id, target, None, Some(&title))
                .unwrap(),
            "登记必须成功（文件已由 materialize 写好）"
        );

        let stored: Option<String> = {
            let conn = db.0.lock();
            conn.query_row(
                "SELECT custom_title FROM sessions WHERE engine='claude' AND session_id=?1",
                [target],
                |r| r.get(0),
            )
            .unwrap()
        };
        assert_eq!(
            stored.as_deref(),
            Some("你好你是谁 (fork #1)"),
            "custom_title 必须被写成带编号的分支标题"
        );

        // 第二个分支要拿到 #2，不重名。
        let target2 = "33333333-3333-4333-8333-333333333333";
        materialize_trimmed_fork(&db, "claude", src_id, target2, usize::MAX).unwrap();
        let title2 = next_fork_title(&db, "claude", "你好你是谁").unwrap();
        assert_eq!(title2, "你好你是谁 (fork #2)");

        // `title` 列必须是**转录本推导**出来的标题，绝不能带 `(fork #N)`。
        // 这一列是**未改名会话的有效名**：它一旦沾上分支标题，分支自己就会被数成
        // 源会话的同级（下一个分支于是拿到 `#3` 而不是 `#2`），且要等下一次重扫把
        // `title` 覆盖掉才恢复——同一个操作因中间是否发生重扫而拿到不同编号。
        // 这里钉住"两列职责不同"。
        let derived: Option<String> = {
            let conn = db.0.lock();
            conn.query_row(
                "SELECT title FROM sessions WHERE engine='claude' AND session_id=?1",
                [target],
                |r| r.get(0),
            )
            .unwrap()
        };
        assert_eq!(
            derived.as_deref(),
            Some("你好你是谁"),
            "title 列必须是转录本推导标题，不能写成分支标题"
        );

        // 改名只动 `custom_title`：改完之后这一行的有效名不再是 `<源名> (fork #1)`，
        // 于是它**退出同级集合**，编号空间随之收缩（`max+1` 取的是当前集合，
        // "#1 被释放"与"最大值回到 0"是同一件事）。
        {
            let conn = db.0.lock();
            conn.execute(
                "UPDATE sessions SET custom_title='改名了' WHERE engine='claude' AND session_id=?1",
                [target],
            )
            .unwrap();
        }
        assert_eq!(
            next_fork_title(&db, "claude", "你好你是谁").unwrap(),
            "你好你是谁 (fork #1)",
            "改名后释放出的编号必须立刻可复用（同级集合跟着当前名字走）"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn codex_cut_never_lands_inside_a_turn() {
        // 只有一轮且**没有** task_complete（未完成轮）：锚点指向它时无法"包含
        // 这一轮"（它还不是完整轮），返回 None 让调用方明确报错——绝不切在轮中间。
        // 界面只在已定稿的行上给分叉入口，所以正常操作不会走到这里。
        let lines = [
            r#"{"type":"session_meta","payload":{"id":"src"}}"#,
            r#"{"type":"event_msg","payload":{"type":"task_started"}}"#,
            r#"{"type":"response_item","payload":{"type":"message"}}"#,
        ];
        let dir = std::env::temp_dir().join(format!("ccgui-fork-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("rollout-src.jsonl");
        std::fs::write(&path, lines.join("\n") + "\n").unwrap();
        let parsed = vec![crate::history::Message {
            seq: 1,
            role: "user".into(),
            text: "唯一一轮".into(),
            ts: None,
            path: None,
            args: None,
            result: None,
            todos: None,
            usage: None,
            model: None,
            effort: None,
            duration_ms: None,
            images: Vec::new(),
        }];
        let anchor = ForkAnchor {
            user_text_sha256: text_sha256_hex("唯一一轮"),
            seq_hint: Some(1),
        };
        assert_eq!(fork_keep_count_codex(&path, &anchor, &parsed, &std::collections::HashSet::new()), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// 一条解析后的 user 消息（seq 由调用方指定：就近消歧的期望值必须能钉死）。
    fn user_message(seq: i64, text: &str) -> crate::history::Message {
        crate::history::Message {
            seq,
            role: "user".into(),
            text: text.into(),
            ts: None,
            path: None,
            args: None,
            result: None,
            todos: None,
            usage: None,
            model: None,
            effort: None,
            duration_ms: None,
            images: Vec::new(),
        }
    }

    /// 一个临时 home：源转录本文件 + 已登记的源会话行（分叉链路的起点）。
    /// 返回 `(目录, 库, 源文件路径)`；目录由调用方自己删。
    fn fork_source_fixture(
        engine: &str,
        source_id: &str,
        workspace_path: &str,
        body: &str,
    ) -> (PathBuf, crate::db::Db, PathBuf) {
        let dir = std::env::temp_dir().join(format!("ccgui-fork-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let db = crate::db::Db::open_at(&dir.join("app.db")).unwrap();
        let source_path = dir.join(format!("{source_id}.jsonl"));
        std::fs::write(&source_path, body).unwrap();
        {
            let conn = db.0.lock();
            conn.execute(
                "INSERT INTO sessions(engine, session_id, workspace_path, file_path,
                     file_size, file_mtime_ms, title, preview, message_count)
                 VALUES(?1, ?2, ?3, ?4, 0, 0, '重复提问', '', 6)",
                rusqlite::params![
                    engine,
                    source_id,
                    workspace_path,
                    source_path.to_string_lossy().into_owned()
                ],
            )
            .unwrap();
        }
        (dir, db, source_path)
    }

    fn session_row_count(db: &crate::db::Db, engine: &str, session_id: &str) -> i64 {
        db.0.lock()
            .query_row(
                "SELECT COUNT(*) FROM sessions WHERE engine=?1 AND session_id=?2",
                rusqlite::params![engine, session_id],
                |r| r.get(0),
            )
            .unwrap()
    }

    fn frame_row_count(db: &crate::db::Db, engine: &str, session_id: &str) -> i64 {
        db.0.lock()
            .query_row(
                "SELECT COUNT(*) FROM accepted_internal_frames WHERE engine=?1 AND session_id=?2",
                rusqlite::params![engine, session_id],
                |r| r.get(0),
            )
            .unwrap()
    }

    #[test]
    fn anchor_locating_survives_extreme_seq_hints() {
        // `seq_hint` 由前端给、Web bridge 也能送到，取值不受约束。
        // `(parsed[i].seq - hint).abs()` 在 `i64::MIN` / `i64::MAX` 上会溢出
        // ——dev/test 直接 panic，release 回绕后选到错误的重复轮次。
        let text = "重复提问";
        let parsed = vec![
            user_message(1, text),
            user_message(3, text),
            user_message(5, text),
        ];
        let anchor = |hint: Option<i64>| ForkAnchor {
            user_text_sha256: text_sha256_hex(text),
            seq_hint: hint,
        };

        // 极值不 panic，且按真实距离选：最近的那条。
        assert_eq!(anchor_hit_index(&parsed, &anchor(Some(i64::MIN))), Some(0));
        assert_eq!(anchor_hit_index(&parsed, &anchor(Some(i64::MAX))), Some(2));
        // 等距（1 与 3 到 2 都是 1）：取更早的那条，切点因此稳定可复现。
        assert_eq!(anchor_hit_index(&parsed, &anchor(Some(2))), Some(0));
        // 没有提示：取最后一条（最近的一轮）。
        assert_eq!(anchor_hit_index(&parsed, &anchor(None)), Some(2));
        // 摘要大小写不敏感：形状检查本来就收大写十六进制。
        let upper = ForkAnchor {
            user_text_sha256: text_sha256_hex(text).to_ascii_uppercase(),
            seq_hint: Some(3),
        };
        assert_eq!(anchor_hit_index(&parsed, &upper), Some(1));
        // 文本对不上：None（调用方据此明确报错，绝不退化成"从末尾分叉"）。
        let missing = ForkAnchor {
            user_text_sha256: text_sha256_hex("转录本里没有这句话"),
            seq_hint: Some(i64::MIN),
        };
        assert_eq!(anchor_hit_index(&parsed, &missing), None);
    }

    #[test]
    fn resolve_fork_plan_carries_the_source_workspace_and_honest_tip_flag() {
        // 都是"命令返回给前端的那份 plan"的形状。
        // 重复提问出现的两轮（0 号与 2 号）用来复核锚点定位走完整条命令路径。
        let source_id = "11111111-1111-4111-8111-111111111111";
        let workspace = "C:/repo/source-ws";
        let dup = "重复提问";
        let mid = "中间那轮";
        let body = [
            claude_user_line(source_id, dup, false, "2026-10-22T11:00:00.000Z"),
            claude_assistant_line(source_id, "A1", "2026-10-22T11:00:01.000Z"),
            claude_user_line(source_id, mid, false, "2026-10-22T11:00:02.000Z"),
            claude_assistant_line(source_id, "A2", "2026-10-22T11:00:03.000Z"),
            claude_user_line(source_id, dup, false, "2026-10-22T11:00:04.000Z"),
            claude_assistant_line(source_id, "A3", "2026-10-22T11:00:05.000Z"),
        ]
        .join("\n")
            + "\n";
        let (dir, db, _source_path) = fork_source_fixture("claude", source_id, workspace, &body);
        let anchor = |text: &str, hint: Option<i64>| ForkAnchor {
            user_text_sha256: text_sha256_hex(text),
            seq_hint: hint,
        };

        // tip 分叉：整份文件都搬，工作区必须来自**源会话行**而不是调用方当前所在
        // 的那个（前端拿它建 tab，否则分支会在另一个 cwd 里 spawn）。
        let tip = resolve_fork_plan(&db, "claude", source_id, None).unwrap();
        assert!(tip.at_tip);
        // 保留整份时**不发条数**：`usize::MAX` 过 JSON 会被 JS 读成
        // 18446744073709552000（精度已丢），一个字段同时表示"多少条"和"全部"
        // 就是陷阱。这个状态由 `at_tip` 表达，哨兵值不上线。
        assert_eq!(
            tip.keep_records, None,
            "整份保留时不能把 usize::MAX 发到线上（JS 会丢精度）"
        );
        assert_eq!(tip.workspace_path, workspace, "plan 必须带上来源工作区");
        assert_eq!(tip.source_title, "重复提问");
        assert!(is_uuid(&tip.target_session_id));

        // 单处命中：切点是它后面那一轮所在的行（user 行号表 [0,2,4,MAX]）。
        let middle =
            resolve_fork_plan(&db, "claude", source_id, Some(&anchor(mid, Some(2)))).unwrap();
        assert_eq!(middle.keep_records, Some(4));
        assert!(!middle.at_tip);

        // 大写摘要必须与小写等价：形状检查收大写十六进制，而 `text_sha256_hex`
        // 只产小写，不折就会以"未能在转录本中定位该轮消息"收场。
        let mut upper = anchor(mid, Some(2));
        upper.user_text_sha256 = upper.user_text_sha256.to_ascii_uppercase();
        let upper_plan = resolve_fork_plan(&db, "claude", source_id, Some(&upper)).unwrap();
        assert_eq!(upper_plan.keep_records, Some(4), "大写摘要必须命中同一轮");

        // 极端 seq_hint：不 panic，且按真实距离选中重复轮里的那一条。
        let first =
            resolve_fork_plan(&db, "claude", source_id, Some(&anchor(dup, Some(i64::MIN))))
                .unwrap();
        assert_eq!(first.keep_records, Some(2), "i64::MIN 选中最靠前的那条重复轮");
        assert!(!first.at_tip);
        let last = resolve_fork_plan(&db, "claude", source_id, Some(&anchor(dup, Some(i64::MAX))))
            .unwrap();
        assert_eq!(
            last.keep_records,
            None,
            "i64::MAX 选中最靠后的那条重复轮（= 最后一轮 → 整份保留，哨兵值不上线）"
        );
        // 锚点正好是最后一轮时切点也是 usize::MAX（整份文件都搬了）：只看
        // `at.is_none()` 会在同一种"保留全部内容"上报 false。
        assert!(last.at_tip, "落在末尾要看实际切点，不是有没有锚点");

        // 文本对不上 → 明确报错（绝不退化成"从末尾分叉"）。
        let missing = resolve_fork_plan(
            &db,
            "claude",
            source_id,
            Some(&anchor("转录本里没有这句话", Some(i64::MIN))),
        );
        assert!(missing.unwrap_err().contains("未能在转录本中定位"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_existing_destination_file_is_never_adopted() {
        // 目标名带的是**本次调用刚生成**的 UUIDv4，重试也只会拿到新 id
        // ——撞上同名文件说明那是别人的东西。`dest.exists() → Ok(dest)`
        // 会把一个无关转录本当成"已经落地过"，随后原样登记成分支。
        let source_id = "11111111-1111-4111-8111-111111111111";
        let body = claude_user_line(source_id, "你好", false, "2026-10-22T11:00:00.000Z") + "\n";
        let (dir, db, _source_path) = fork_source_fixture("claude", source_id, "C:/repo", &body);
        let target = "22222222-2222-4222-8222-222222222222";
        let foreign = dir.join(format!("{target}.jsonl"));
        std::fs::write(&foreign, "别人的转录本\n").unwrap();

        let error = materialize_trimmed_fork(&db, "claude", source_id, target, usize::MAX)
            .expect_err("目标文件已存在时必须报错，绝不能复用它");
        assert!(error.contains("已被占用"), "报错要说清是路径冲突: {error}");
        assert_eq!(
            std::fs::read_to_string(&foreign).unwrap(),
            "别人的转录本\n",
            "无关文件必须原样保留（不改写、不登记）"
        );
        assert_eq!(
            session_row_count(&db, "claude", target),
            0,
            "落盘失败发生在登记之前，不能留下 half-state"
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn registration_is_one_transaction_and_rolls_the_file_back() {
        // INSERT 成功而 `custom_title` 的 UPDATE 失败时，只删文件不够：
        // `sessions` 行会活下来（无标题、无路径）。这里用一条只拦 UPDATE 的
        // TEMP 触发器把第二条语句打红，断言整批写入（含帧身份）一起回滚。
        let source_id = "11111111-1111-4111-8111-111111111111";
        let body = [
            claude_user_line(source_id, "你好", false, "2026-10-22T11:00:00.000Z"),
            claude_assistant_line(source_id, "在", "2026-10-22T11:00:01.000Z"),
        ]
        .join("\n")
            + "\n";
        let (dir, db, _source_path) = fork_source_fixture("claude", source_id, "C:/repo", &body);
        // 源会话有两条内部帧身份：它们也必须随同一个事务回滚。
        for hash in ["a".repeat(64), "b".repeat(64)] {
            db.record_accepted_internal_frame_hash("claude", source_id, &hash, "C:/repo")
                .unwrap();
        }
        let target = "22222222-2222-4222-8222-222222222222";
        let written =
            materialize_trimmed_fork(&db, "claude", source_id, target, usize::MAX).unwrap();
        {
            let conn = db.0.lock();
            conn.execute_batch(
                "CREATE TEMP TRIGGER fork_test_block_title
                   BEFORE UPDATE OF custom_title ON sessions
                 BEGIN SELECT RAISE(ABORT, 'fork test: custom_title blocked'); END;",
            )
            .unwrap();
        }

        let error =
            register_fork_or_rollback(&db, "claude", source_id, target, &written, "标题 (fork #1)")
                .expect_err("标题写不进去就是登记失败");
        assert!(
            error.contains("设置分支标题失败"),
            "报错要指向真正失败的那一步: {error}"
        );
        assert_eq!(
            session_row_count(&db, "claude", target),
            0,
            "sessions 行必须随事务回滚"
        );
        assert_eq!(
            frame_row_count(&db, "claude", target),
            0,
            "帧身份也必须一起回滚（否则留下一个没有会话的记录集）"
        );
        assert!(!written.exists(), "登记失败必须把刚写的文件删掉（§4.1）");

        // 触发器撤掉后重来一次：同一条链路必须能成功，帧身份真的整份复制过来。
        {
            let conn = db.0.lock();
            conn.execute_batch("DROP TRIGGER fork_test_block_title;")
                .unwrap();
        }
        let written =
            materialize_trimmed_fork(&db, "claude", source_id, target, usize::MAX).unwrap();
        register_fork_or_rollback(&db, "claude", source_id, target, &written, "标题 (fork #1)")
            .unwrap();
        assert_eq!(session_row_count(&db, "claude", target), 1);
        assert_eq!(
            frame_row_count(&db, "claude", target),
            2,
            "源会话的帧身份要整份复制给分支"
        );
        let title: Option<String> = {
            let conn = db.0.lock();
            conn.query_row(
                "SELECT custom_title FROM sessions WHERE engine='claude' AND session_id=?1",
                [target],
                |r| r.get(0),
            )
            .unwrap()
        };
        assert_eq!(title.as_deref(), Some("标题 (fork #1)"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_missing_transcript_is_a_failure_not_a_silent_success() {
        // `register_fork_landing_with_path` 对"文件不在"返回 `Ok(false)`：调用方
        // 只匹配 `Err` 就会命令报成功而 `sessions` 行并不存在——分支页签
        // 打开就是 `session not found`，正是设计稿 §4.1 禁止的半状态。
        let source_id = "11111111-1111-4111-8111-111111111111";
        let body = claude_user_line(source_id, "你好", false, "2026-10-22T11:00:00.000Z") + "\n";
        let (dir, db, _source_path) = fork_source_fixture("claude", source_id, "C:/repo", &body);
        let target = "22222222-2222-4222-8222-222222222222";
        let missing = dir.join(format!("{target}.jsonl"));

        // 登记层维持自己的契约：文件不在就 `Ok(false)`，不写指向不存在文件的行。
        assert!(!register_fork_landing_with_path(
            &db,
            "claude",
            source_id,
            target,
            Some(&missing.to_string_lossy()),
            Some("标题"),
        )
        .unwrap());
        // 调用层必须把它当失败，而不是"没报错就算成功"。
        let error = register_fork_or_rollback(&db, "claude", source_id, target, &missing, "标题")
            .expect_err("Ok(false) 不是成功");
        assert!(error.contains("未被登记"), "{error}");
        assert_eq!(session_row_count(&db, "claude", target), 0);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn copied_frames_are_bounded_by_the_same_caps_as_live_recording() {
        // 复制 `accepted_internal_frames` 走一条 `INSERT ... SELECT`，上限必须与
        // IPC 那条路径（每会话 5 000 / 全局 100 000）同口径：
        // `record_accepted_internal_frame_hash` **没有任何上限**（它的 `Ok(false)`
        // 只表示"这条身份已经存在"），逐条调用等于把上限换成猜谜。
        let source_id = "11111111-1111-4111-8111-111111111111";
        let target = "22222222-2222-4222-8222-222222222222";
        let body = claude_user_line(source_id, "你好", false, "2026-10-22T11:00:00.000Z") + "\n";
        let (dir, db, _source_path) = fork_source_fixture("claude", source_id, "C:/repo", &body);
        db.record_accepted_internal_frame_hash("claude", source_id, &"a".repeat(64), "C:/repo")
            .unwrap();
        db.record_accepted_internal_frame_hash("claude", source_id, &"b".repeat(64), "C:/repo")
            .unwrap();

        // 先把分支这一行的单会话配额占满（递归 CTE 一条语句写满 5 000 条）。
        {
            let conn = db.0.lock();
            conn.execute(
                "WITH RECURSIVE c(x) AS (SELECT 0 UNION ALL SELECT x+1 FROM c WHERE x < ?2 - 1)
                 INSERT INTO accepted_internal_frames(engine, session_id, frame_hash, workspace_path)
                 SELECT 'claude', ?1, printf('pre%06d', x), '/ws' FROM c",
                rusqlite::params![target, MAX_RECORDED_FRAMES_PER_SESSION],
            )
            .unwrap();
        }
        assert_eq!(
            frame_row_count(&db, "claude", target),
            MAX_RECORDED_FRAMES_PER_SESSION
        );
        {
            let conn = db.0.lock();
            let error = copy_accepted_frames(&conn, "claude", source_id, target, "/ws", 2)
                .expect_err("配额已满必须报错，而不是静默少复制几条");
            assert!(error.contains("上限"), "{error}");
        }

        // 空目标上复制整份集合：内容一一对应，并清掉 FTS 标记——标记只认文件
        // stat + INDEX_VERSION，不清就会让搬过来的内部帧文本永久可搜。
        let target2 = "33333333-3333-4333-8333-333333333333";
        {
            let conn = db.0.lock();
            // `fts_state` 有指向 `sessions` 的外键（`PRAGMA foreign_keys=ON`），
            // 先给分支补一行会话，标记才有地方挂。
            conn.execute(
                "INSERT INTO sessions(engine, session_id, workspace_path, file_path, file_size, file_mtime_ms)
                 VALUES('claude', ?1, '/ws', '/ws/x.jsonl', 0, 0)",
                rusqlite::params![target2],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO fts_state(engine, session_id, file_size, file_mtime_ms, version, indexed_at)
                 VALUES('claude', ?1, 1, 1, '1', 1)",
                rusqlite::params![target2],
            )
            .unwrap();
            copy_accepted_frames(&conn, "claude", source_id, target2, "/ws", 2).unwrap();
            let copied: Vec<String> = {
                let mut stmt = conn
                    .prepare(
                        "SELECT frame_hash FROM accepted_internal_frames
                          WHERE engine='claude' AND session_id=?1 ORDER BY frame_hash",
                    )
                    .unwrap();
                let rows = stmt
                    .query_map(rusqlite::params![target2], |r| r.get::<_, String>(0))
                    .unwrap();
                rows.map(|r| r.unwrap()).collect()
            };
            assert_eq!(copied, vec!["a".repeat(64), "b".repeat(64)]);
            let stamped: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM fts_state WHERE engine='claude' AND session_id=?1",
                    rusqlite::params![target2],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(stamped, 0, "复制后必须让索引按新身份集合重新派生");
        }

        let _ = std::fs::remove_dir_all(&dir);
    }
}