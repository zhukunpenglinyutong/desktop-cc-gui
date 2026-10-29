//! 分支标题：`<来源会话当前名> (fork #N)` 的编号、堆叠与长度上限。

/// 分支编号后缀。**语言中立**（用户定的规则）：`(fork #1)` 不翻译，所以它不需要
/// 走 `src/i18n`，后端可以直接拼——这也顺带解决了"英文界面出现中文后缀"的问题。
///
/// 这里的拼接与 `fork_sibling_number` 的解析必须严格互逆，两处共用这一组常量。
pub(super) const FORK_MARK: &str = " (fork #";

pub(super) const FORK_MARK_END: char = ')';


/// 后缀段之间的分隔符，也就是根名与后缀链之间的那个空格。
pub(super) const FORK_SUFFIX_SEP: char = ' ';


/// 省略标记：夹在**根名与后缀链之间**（`A … (fork #4) (fork #5)`），表示"更早的
/// 分支段已经不在名字里了"。没有它，被省略过的名字看起来就像本来就那么短。
pub(super) const FORK_ELISION_MARK: char = '…';


/// 一条分支标题的字符上限（产品定）。
///
/// 按**字符**而不是字节：标题基本是中文，按字节截会把一个字切成两半
/// （`history::truncate_chars` 里是同一条理由）。
pub(super) const MAX_FORK_TITLE_CHARS: usize = 80;


/// 后缀链最多保留的段数（产品定）：更深的分叉只留**最新**的几段，更早的丢掉。
/// 段数有上限，`MAX_FORK_TITLE_CHARS` 才有一个固定的下限留给根名。
pub(super) const MAX_FORK_SUFFIX_SEGMENTS: usize = 5;


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
pub(super) fn next_fork_title(
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
pub(super) fn fork_suffix_segment(number: u32) -> String {
    format!("{}{number}{FORK_MARK_END}", FORK_MARK.trim_start())
}


/// 父名 → `(根名, 结尾的 (fork #k) 后缀链)`，链从旧到新。
///
/// 判据只有 `fork_sibling_number` 一份，这里只**猜**切点（最后一个 `" (fork #"`），
/// 认不认它由那个函数决定：`(fork #x)`、`(fork #)` 这类形状它返回 `None`，链就到
/// 此为止——那一段留在根名里（`A (fork #x) (fork #1)` 的根名是 `A (fork #x)`），
/// 而不是被当成一个段丢掉。第二个"什么算后缀"的判据不能有：同一个东西两套判据
/// 必然把同一个后缀判成两种结果。
pub(super) fn split_fork_suffixes(parent: &str) -> (&str, Vec<&str>) {
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
pub(super) fn strip_elision_marker(root: &str) -> (&str, bool) {
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
pub(super) fn capped_fork_title(parent: &str, number: u32) -> String {
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
pub(super) fn fork_sibling_number(source_name: &str, name: &str) -> Option<u32> {
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
pub(super) fn taken_titles(
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

