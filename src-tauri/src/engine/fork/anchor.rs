//! 分叉锚点：定位「用户点的是哪一轮」，以及那一条消息的源行号。
//!
//! 锚点身份是**用户消息**的文本摘要——助手行会被 `claude_flush_text` 拆段，
//! 前端存的文本与后端那一行的文本不保证全等。

use super::*;
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
    ///
    /// ⚠️ 它是**前端本地累加**的编号，与后端解析顺序重新编号的 seq 不同源：前端把
    /// 计划审批 / 问答卡片当成本地消息插进 `messages` 并占一个 seq，而解析器对这类
    /// 记录不产出消息。连发多个相同文本时，一两个单位的漂移就足以把「中间那条」
    /// 判成后一条。所以消歧**优先**用下面的 `tail_occurrence`，这里只作退化兜底。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seq_hint: Option<i64>,
    /// 这条用户消息之后还有几条**文本完全相同**的用户消息（从尾部数的序号，0 =
    /// 就是最后一条）。
    ///
    /// 为什么它比 `seq_hint` 可靠：它只依赖「同文本出现的先后顺序」，与任何编号
    /// 无关，因此不受两边 seq 数值漂移影响。而且前端的消息窗口**总是转录本的尾部**
    /// （历史分页是往前插页，`load-earlier` 只会 prepend），所以「之后还有几条」
    /// 在两侧一致——即使只加载了最近若干页也成立。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tail_occurrence: Option<u32>,
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
pub(super) fn anchor_hit_index(parsed: &[crate::history::Message], anchor: &ForkAnchor) -> Option<usize> {
    let wanted = anchor.user_text_sha256.to_ascii_lowercase();
    let matches: Vec<usize> = parsed
        .iter()
        .enumerate()
        .filter(|(_, m)| m.role == "user" && text_sha256_hex(&m.text) == wanted)
        .map(|(i, _)| i)
        .collect();
    let hit = match matches.as_slice() {
        [] => None,
        [only] => Some(*only),
        many => {
            // **首选**：从尾部数的同文本序号（0 = 最后一条）。只依赖"同文本出现顺序"，
            // 与两侧的 seq 编号无关，因此不受前端 seq 漂移影响——连发多个「继续」
            // 时，点中间那条不会再被判成最后一条。前端窗口总是转录本尾部（历史分页
            // 是往前插页），所以这个序号两边一致。
            let by_tail = anchor
                .tail_occurrence
                .map(|tail| tail as usize)
                .filter(|tail| *tail < many.len())
                .map(|tail| many[many.len() - 1 - tail]);
            // 退化：老前端没有 tail_occurrence 时按 seq 就近（等距取更早那条）。
            by_tail.or_else(|| match anchor.seq_hint {
                // `min_by_key` 取**第一个**最小值：等距时留下更早的那条（解析顺序），
                // 与"就近消歧"一致，也让同一份输入的切点稳定可复现。
                Some(hint) => Some(
                    many.iter()
                        .copied()
                        .min_by_key(|i| parsed[*i].seq.abs_diff(hint))
                        .unwrap_or(many[many.len() - 1]),
                ),
                None => Some(many[many.len() - 1]),
            })
        }
    };
    log_anchor_drift(parsed, anchor, hit, &matches);
    hit
}

/// 「就近消歧」的可观测性探针：**每次分叉**打一行，用来实测前端 seq 与后端解析 seq
/// 之间的漂移。
///
/// 为什么需要它：`seq_hint` 是前端**本地累加**出来的（`session-utils.ts` 的
/// `seq: lastSeq + 1 + i`），而后端这里是按解析顺序**重新编号**的。两者只在加载历史
/// 那一刻对齐（历史走 `reader.rs` 带回后端的 seq），之后就各自演进：前端会把计划审批 /
/// 问答卡片当成本地消息插进 `messages` 并占一个 seq，而解析器对这类记录不产出消息。
///
/// **怎么读这行日志**（重要：`drift` 是相对**被选中**那条算的，不是真实漂移）：
///
/// 设两条同文本在后端的 seq 是 `P1 < P2`，间隔 `G = P2-P1`，真实漂移 `d = hint - P_intended`
/// （`P_intended` 是用户**点的那条**）。选择规则是「距离最小、等距取更早」，于是：
///
/// | 用户点的是 | 会误选另一条的条件 | 日志显示 |
/// |---|---|---|
/// | `P1`（较早） | `d > G/2`（前端偏大把它推过了中点） | `drift = d - G`（**负**，`\\|drift\\| < G/2`） |
/// | `P2`（较晚） | `d < -G/2`（前端偏小把它拉过了中点） | `drift = d + G`（**正**，`< G/2`） |
///
/// 也就是说：**两个方向都能切错**，而且切错时 `|drift|` 一定小于 `G/2`——所以
/// 「drift 很小」**不代表安全**，恰好是可能切错时的样子。可靠判据是看 `hint` 落在
/// `seqs=[...]` 的哪个位置：
///   - `hint` 紧挨着某个候选（`|drift| ≪ G`）→ 基本选对；
///   - `|drift|` 接近 `G/2`（尤其 `hint` 正好落在两个候选中间）→ **可能是硬币翻面**，
///     这一条样本要人工复核（把 `hint` 与 `seqs` 一起看，并对照用户在界面上点的是哪一轮）。
///   - `hits=1` 时没有歧义参与，`drift` 就是**真实漂移**的干净样本（最该收集的数据）：
///     它直接等于「前端比后端多算了几个 seq」。
///
/// 只打数字与候选 seq，**不含任何用户文本**。
fn log_anchor_drift(
    parsed: &[crate::history::Message],
    anchor: &ForkAnchor,
    hit: Option<usize>,
    matches: &[usize],
) {
    // 候选 seq 取**命中项附近**的窗口：重复短提示在长会话里可能命中六次以上，只打
    // 最早的几个会让 `parsed_seq` 落在打印出来的 `seqs` 之外，判读所需的间隔就丢了。
    let seqs = {
        const WINDOW: usize = 6;
        let window: &[usize] = if matches.len() <= WINDOW {
            matches
        } else {
            let pos = hit
                .and_then(|h| matches.iter().position(|i| *i == h))
                .unwrap_or(matches.len() - 1);
            let start = pos.saturating_sub(WINDOW / 2).min(matches.len() - WINDOW);
            &matches[start..start + WINDOW]
        };
        window
            .iter()
            .map(|i| parsed[*i].seq.to_string())
            .collect::<Vec<_>>()
            .join(",")
    };
    let hits = matches.len();
    match (hit, anchor.seq_hint) {
        (Some(index), Some(hint)) => {
            let parsed_seq = parsed[index].seq;
            if hits > 1 {
                eprintln!(
                    "[fork][anchor] hits={hits} picked_by={} tail={:?} hint={hint} parsed_seq={parsed_seq} drift={} seqs=[{seqs}]",
                    if anchor.tail_occurrence.is_some() { "tail" } else { "seq" },
                    anchor.tail_occurrence,
                    hint.saturating_sub(parsed_seq)
                );
            } else {
                eprintln!(
                    "[fork][anchor] hits={hits} hint={hint} parsed_seq={parsed_seq} drift={}",
                    hint.saturating_sub(parsed_seq)
                );
            }
        }
        (Some(index), None) => eprintln!(
            "[fork][anchor] hits={hits} hint=- parsed_seq={} drift=-",
            parsed[index].seq
        ),
        (None, hint) => {
            eprintln!("[fork][anchor] hits={hits} hint={hint:?} hit=none")
        }
    }
}


/// 锚点轮**从 0 起的序号**：命中消息之前有几条 user 消息。
///
/// 三个引擎的切点函数都从这里起步（命中判据见 `anchor_hit_index`），差别只在
/// "拿到这个序号之后怎么求切点"——Claude 取第 `n+1` 条 user 记录的**源行号**，
/// Codex 从锚点行往后找第一个轮次结束标记（`task_complete` / `turn_aborted`），
/// dsh 往后找第一个 `turn/end`。这段"锚点是哪一轮"的推理只写一遍：抄成两份
/// 时，任何一处改动都会让引擎之间对"同一轮"的理解分家。
/// 可见性：`pub(crate)` 是为了让同层的 `fork_dsh` 能复用（重导出走 `mod.rs`）；
/// 范围仍应保持在 `engine` 内——**不要**在别处另起第二套"锚点是哪一轮"的判据。
pub(crate) fn anchor_turn(parsed: &[crate::history::Message], anchor: &ForkAnchor) -> Option<usize> {
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
pub(super) fn fork_keep_count(
    path: &Path,
    anchor: &ForkAnchor,
    parsed: &[crate::history::Message],
    accepted_frames: &std::collections::HashSet<String>,
) -> Option<usize> {
    // 锚点轮是第几条 user 消息（判据见 `anchor_turn`）。
    let user_ordinal = anchor_turn(parsed, anchor)?;

    let file = std::fs::File::open(path).ok()?;
    let lines =
        crate::history::user_row_lines("claude", std::io::BufReader::new(file), accepted_frames);
    // 切在**锚点轮之后**那条用户记录的行上：分支**包含**用户点的那一轮
    // （"请教一个数学题"这一轮 + 之前所有内容），而不是把它排除在外。
    // `user_row_lines` 自带末尾哨兵，锚点轮是最后一轮时这里拿到的是整份文件。
    lines.get(user_ordinal + 1).copied()
}


/// Codex 的记录级切点。与 Claude 不同，Codex 必须切在**完整轮次**边界上：
/// 它的轮次是 `event_msg` 的 `task_started` … `task_complete` 包起来的，而
/// 非会话记录（`turn_context` / `token_count`）散落在轮内。直接用"第 n 条
/// user 记录的行号"会切进某一轮中间，留下没有结束标记的残轮。
///
/// 做法分两步，两步都只认**一份**判据：
/// 1. 锚点那条 user 消息落在**第几行**——来自 `user_row_lines("codex", …)`，与
///    `parse_session_file` 走同一条提取器 + `normalize_extracted_row` 流水线。
///    ⚠️ 不能改用 `codex_line_is_visible_user` 直接数原始行：它只判"有没有文本或
///    图片"，不经过规范化，于是 `# AGENTS.md instructions` / `<environment_context>` /
///    `<skill>` 这类会被提取器丢弃的注入行仍被计数，`users_seen` 比锚点序号大，
///    切点提前一轮——分支静默丢掉用户点的那一轮（已有回归用例
///    `hidden_context_rows_must_not_shift_the_cut`）。
/// 2. 从锚点那一行往后，找**本轮结束标记**：`task_complete`，或用户中断写入的
///    `turn_aborted`。只看 `task_complete` 会让被中断的轮一直往后找到下一轮的
///    标记，分支多带一轮（回归用例
///    `an_aborted_anchor_turn_must_not_pull_in_the_next_turn`）。
pub(super) fn fork_keep_count_codex(
    path: &Path,
    anchor: &ForkAnchor,
    parsed: &[crate::history::Message],
    accepted_frames: &std::collections::HashSet<String>,
) -> Option<usize> {
    // 锚点是"第几条**可见 user 消息**"（0 起）——命中判据只有 `anchor_turn` 这一份，
    // 它的可见口径就是解析器口径，与下面第 1 步的行号同源。
    let anchor_user_ordinal = anchor_turn(parsed, anchor)?;

    let file = std::fs::File::open(path).ok()?;
    let user_lines =
        crate::history::user_row_lines("codex", std::io::BufReader::new(file), accepted_frames);
    // 锚点那条消息的源行号。哨兵 `usize::MAX` 只有在锚点序号超出可见 user 条数时才
    // 会被取到，而 `anchor_turn` 的序号一定落在范围内，所以这里不会拿到它。
    let anchor_line = *user_lines.get(anchor_user_ordinal)?;
    if anchor_line == usize::MAX {
        return None;
    }

    // 第二轮只找轮次结束标记：从锚点那行开始扫（锚点之前的标记属于更早的轮）。
    let file = std::fs::File::open(path).ok()?;
    use std::io::BufRead;
    for (index, line) in std::io::BufReader::new(file).lines().enumerate() {
        if index < anchor_line {
            continue;
        }
        let Ok(line) = line else { continue };
        let Some(value) = parse_json_line(&line) else {
            continue;
        };
        if codex_line_ends_turn(&value) {
            let cut = index + 1;
            // 锚点就是最后一轮时整份文件都会被搬过去——与 Claude 那侧对齐成
            // `usize::MAX`（即 `at_tip`）。否则同一个"从最后一轮分叉"在不同引擎上
            // 返回不同的 plan：文件一字不差，`at_tip` 却是 false、还多带一个
            // `keepRecords`，任何后续消费者都会得出互相矛盾的结论。
            let has_later_user = user_lines
                .iter()
                .any(|line| *line != usize::MAX && *line > index);
            return Some(if has_later_user { cut } else { usize::MAX });
        }
    }
    // 锚点轮还没有结束标记（仍在跑），或转录本被截过：不猜，报定位失败。
    // 界面只在已定稿的行上给分叉入口，所以正常情况下不会走到这里。
    None
}


/// Codex 的一行是否标记**一轮结束**。
///
/// 两个来源，缺一不可：
/// - `event_msg/task_complete`：正常完成。
/// - `event_msg/turn_aborted`：用户中断（Esc）。被中断的轮**同样是完整轮次**——
///   它已经落盘、界面上可见、用户可能就想从这一轮分叉。只认 `task_complete`
///   时，锚点在中断轮上会一路找到下一轮的标记，分支多带一轮内容。
pub(super) fn codex_line_ends_turn(value: &serde_json::Value) -> bool {
    if value.get("type").and_then(serde_json::Value::as_str) != Some("event_msg") {
        return false;
    }
    matches!(
        value
            .get("payload")
            .and_then(|p| p.get("type"))
            .and_then(serde_json::Value::as_str),
        Some("task_complete") | Some("turn_aborted")
    )
}


/// Codex 切点的回归用例。
///
/// 两条都对应真实缺陷（代码评审时用临时测试复现过）：
/// - 注入行（`# AGENTS.md instructions` / `<environment_context>` / `<skill>`）会被
///   提取器的规范化丢弃，但它们**确实**是 `role=user` 的 `response_item`。按"原始行
///   是不是 user"计数时它们被算进轮次，`users_seen` 比锚点序号大，切点提前一轮，
///   用户点的那一轮本身消失。
/// - `turn_aborted`（用户按 Esc 中断）同样是轮次终点。只认 `task_complete` 时，
///   锚点落在中断轮上会一路找到**下一轮**的结束标记，分支多带一整轮。
///
/// 断言写的是"分支重新解析后有哪些消息"，不是中间量：用户能看到的才作数。
#[cfg(test)]
mod codex_cut_tests {
    use super::*;
    use std::collections::HashSet;

    const META: &str = r#"{"type":"session_meta","payload":{"id":"src"}}"#;
    const AGENTS: &str = r##"{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"# AGENTS.md instructions for /tmp/ws\n\n<INSTRUCTIONS>rules</INSTRUCTIONS>"}]}}"##;
    const ENV: &str = r#"{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"<environment_context>\n  <cwd>/tmp/ws</cwd>\n</environment_context>"}]}}"#;
    const START: &str = r#"{"type":"event_msg","payload":{"type":"task_started"}}"#;
    const DONE: &str = r#"{"type":"event_msg","payload":{"type":"task_complete"}}"#;
    const ABORT: &str = r#"{"type":"event_msg","payload":{"type":"turn_aborted"}}"#;

    fn msg(role: &str, kind: &str, text: &str) -> String {
        format!(
            r#"{{"type":"response_item","payload":{{"type":"message","role":"{role}","content":[{{"type":"{kind}","text":"{text}"}}]}}}}"#
        )
    }

    /// 按 `fork_keep_count_codex` 的切点截出前缀，再用**普通解析**读回来。
    fn branch_messages(lines: &[&str], anchor_text: &str) -> Vec<String> {
        let dir = std::env::temp_dir().join(format!("ccgui-codex-cut-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let source = dir.join("rollout-src.jsonl");
        std::fs::write(&source, lines.join("\n") + "\n").unwrap();
        let parsed =
            crate::history::parse_session_file("codex", &source, &HashSet::new()).unwrap().messages;
        let anchor = ForkAnchor {
            user_text_sha256: text_sha256_hex(anchor_text),
            seq_hint: None,
            tail_occurrence: None,
        };
        let keep = fork_keep_count_codex(&source, &anchor, &parsed, &HashSet::new())
            .expect("应能定位到锚点轮");
        let branch = dir.join("rollout-branch.jsonl");
        let body: String = lines.iter().take(keep).map(|line| format!("{line}\n")).collect();
        std::fs::write(&branch, body).unwrap();
        let out = crate::history::parse_session_file("codex", &branch, &HashSet::new())
            .unwrap()
            .messages
            .iter()
            .map(|m| format!("{}:{}", m.role, m.text))
            .collect();
        let _ = std::fs::remove_dir_all(&dir);
        out
    }

    /// 注入行不能改变"锚点是第几条可见 user 消息"的计数。
    #[test]
    fn hidden_context_rows_do_not_shift_the_cut() {
        let (q1, a1) = (msg("user", "input_text", "Q1"), msg("assistant", "output_text", "A1"));
        let (q2, a2) = (msg("user", "input_text", "Q2"), msg("assistant", "output_text", "A2"));
        let (q3, a3) = (msg("user", "input_text", "Q3"), msg("assistant", "output_text", "A3"));
        let lines = [
            META, AGENTS, ENV, START, &q1, &a1, DONE, START, &q2, &a2, DONE, START, &q3, &a3, DONE,
        ];
        // 缺陷表现：分支只有 ["user:Q1","assistant:A1"]，用户点的 Q2 那一轮整个丢失。
        assert_eq!(
            branch_messages(&lines, "Q2"),
            ["user:Q1", "assistant:A1", "user:Q2", "assistant:A2"]
        );
    }

    /// 被中断的轮是完整轮次：切点必须停在它的 `turn_aborted` 上，不能越过它。
    #[test]
    fn an_aborted_anchor_turn_does_not_pull_in_the_next_turn() {
        let q1 = msg("user", "input_text", "Q1");
        let (q2, a2) = (msg("user", "input_text", "Q2"), msg("assistant", "output_text", "A2"));
        let lines = [META, START, &q1, ABORT, START, &q2, &a2, DONE];
        let branch = branch_messages(&lines, "Q1");
        assert_eq!(branch, ["user:Q1"]);
    }

    /// 锚点就是最后一轮、且该轮被中断：这是合法的切点（= 整份文件），
    /// 不能因为"找不到 `task_complete`"就报定位失败。
    #[test]
    fn an_aborted_last_turn_is_a_valid_cut() {
        let q1 = msg("user", "input_text", "Q1");
        let lines = [META, START, &q1, ABORT];
        assert_eq!(branch_messages(&lines, "Q1"), ["user:Q1"]);
    }
}

