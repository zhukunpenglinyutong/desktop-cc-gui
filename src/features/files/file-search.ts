/**
 * FileSearchOverlay 的纯检索逻辑(与组件分离,便于单测):作用域前缀、
 * 目录作用域过滤、名称优先的分级匹配排序。原实现自 FileSearchOverlay.tsx
 * 原样迁出,行为零变化。
 */
import {
  MENTION_MENU_LIMIT,
  type MentionEntry,
} from "@/components/application/ai-chat/mention-files";

/**
 * Workspace-relative prefix of `absolute` inside `root`: `""` when `absolute`
 * IS the root, `null` when it is not inside the workspace (nothing to search).
 * Separators are normalized so Windows `\` and POSIX `/` roots compare equal.
 */
export function workspaceRelativePrefix(root: string, absolute: string): string | null {
  const base = root.replace(/\\/g, "/").replace(/\/+$/, "");
  const target = absolute.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!base) return null;
  if (target === base) return "";
  if (!target.startsWith(base + "/")) return null;
  return target.slice(base.length + 1);
}

/**
 * Index entries that live inside the search root. The prefix test is
 * separator-aware on purpose: a bare `startsWith` would scope `src` to
 * `src-extra/` too.
 */
export function scopeEntries<T extends MentionEntry>(
  entries: T[],
  root: string,
  searchRoot: string,
): T[] {
  const prefix = workspaceRelativePrefix(root, searchRoot);
  if (prefix === null) return [];
  if (prefix === "") return entries;
  return entries.filter(
    (entry) => entry.rel === prefix || entry.rel.startsWith(prefix + "/"),
  );
}

/**
 * A search hit that carries its source root. Ranking runs in the primary
 * root's namespace (see `combineRootEntries`), so `root` is the absolute
 * directory the entry actually belongs to — what the overlay opens. `innerRel`
 * is the entry's own root-relative path (before any namespace rebasing); the
 * overlay rejoins it to `root` to open the file, and the row label reads from it.
 */
export interface ScopedSearchEntry extends MentionEntry {
  root: string;
  innerRel: string;
}

/** "/"-normalized absolute path with trailing separators removed. */
function normAbs(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

/**
 * `to`'s path relative to `from`, using "/" and allowing ".." segments; null
 * when the two live on different volumes (Windows drives) and no relative
 * path exists. Both are absolute directories. Unlike `workspaceRelativePrefix`
 * this also expresses siblings (`from=D:/ws/a`, `to=D:/ws/b` → `../b`), which
 * is what lets additional roots rank in the primary root's namespace.
 */
export function namespaceRelative(from: string, to: string): string | null {
  const a = normAbs(from);
  const b = normAbs(to);
  if (!a || !b) return null;
  if (a.toLowerCase() === b.toLowerCase()) return "";
  const as = a.split("/");
  const bs = b.split("/");
  if (as[0].toLowerCase() !== bs[0].toLowerCase()) return null;
  let i = 0;
  while (i < as.length && i < bs.length && as[i].toLowerCase() === bs[i].toLowerCase()) i++;
  const up = as.length - i;
  const down = bs.slice(i);
  return [...Array<string>(up).fill(".."), ...down].join("/");
}

/**
 * Namespace prefix that rebases `root` under the primary root, or null when
 * `primary` is empty. Sibling roots on the same volume get a relative prefix
 * (`../lib`); a root on a different volume — where no relative path exists —
 * falls back to its own absolute path (`C:/lib`), so cross-drive roots still
 * merge instead of being dropped.
 */
export function rootPrefix(primary: string, root: string): string | null {
  if (!normAbs(primary)) return null;
  return namespaceRelative(primary, root) ?? normAbs(root);
}

/** True when `child` lives inside `parent` (or IS it). */
function isInside(parent: string, child: string): boolean {
  const rel = namespaceRelative(parent, child);
  return rel !== null && rel !== ".." && !rel.startsWith("../");
}

/** 重定基一条索引条目:把 rel 从附加根命名空间搬到主目录命名空间(前缀为
 *  主目录到该附加根的相对路径)。basename 不变,key/depth/nameStart 依新 rel
 *  重算。 */
function rebaseEntry(entry: MentionEntry, prefix: string): MentionEntry {
  if (prefix === "") return entry;
  const rel = `${prefix}/${entry.rel}`;
  return {
    ...entry,
    rel,
    depth: rel.split("/").length - 1,
    key: rel.toLowerCase(),
    nameStart: rel.length - entry.name.length,
  };
}

/**
 * Merge every root's index into one list, primary root first. Additional
 * roots are rebased under their namespace prefix from `rootPrefix`: siblings
 * on the same volume become `../<name>/…`, and a root on a different volume
 * becomes its absolute path (`C:/lib/…`) — so entries from different roots
 * never collide in `rel` and all of them rank in a single namespace, whatever
 * volume they live on.
 */
export function combineRootEntries(
  roots: string[],
  entriesByRoot: Array<MentionEntry[] | undefined>,
): ScopedSearchEntry[] {
  const primary = roots[0];
  if (!primary) return [];
  const out: ScopedSearchEntry[] = [];
  roots.forEach((root, i) => {
    const entries = entriesByRoot[i];
    if (!entries) return;
    const prefix = rootPrefix(primary, root);
    if (prefix === null) return;
    for (const entry of entries) {
      out.push({ ...rebaseEntry(entry, prefix), root, innerRel: entry.rel });
    }
  });
  return out;
}

/**
 * 把搜索作用域 `searchRoot`(绝对目录,通常来自文件树右键)映射到主目录命名
 * 空间下的合成绝对路径,供 `searchEntries` 使用。`searchRoot` 不属于任何根时
 * 返回 null(无可搜索结果)。合成路径为 `primary + "/" + <命名空间前缀>[ + "/" + 根内相对目录]`,
 * 与 `combineRootEntries` 的重定基前缀(同卷相对、跨盘符绝对)严格同构,过滤因此能对齐。
 */
export function scopeToPrimaryRoot(roots: string[], searchRoot: string): string | null {
  const primary = roots[0];
  if (!primary) return null;
  const joinRel = (rel: string) =>
    rel === "" ? primary : `${normAbs(primary)}/${rel}`;
  const direct = namespaceRelative(primary, searchRoot);
  if (direct !== null && isInside(primary, searchRoot)) return joinRel(direct);
  for (let i = 1; i < roots.length; i++) {
    if (!isInside(roots[i], searchRoot)) continue;
    const inner = namespaceRelative(roots[i], searchRoot);
    const prefix = rootPrefix(primary, roots[i]);
    if (inner === null || prefix === null) return null;
    return joinRel(inner === "" ? prefix : `${prefix}/${inner}`);
  }
  return null;
}

/** 根目录末级名称:规范化后取最后一段(如 `C:/vendor/lib` → `lib`)。 */
function rootBaseName(root: string): string {
  const norm = normAbs(root);
  const slash = norm.lastIndexOf("/");
  return slash >= 0 ? norm.slice(slash + 1) : norm;
}

/**
 * 每个根在主目录命名空间下的展示令牌:默认是根目录末级名(`lib`),但当多个
 * 根的末级名重名时,该根的令牌改为其绝对路径(去歧义)。
 */
export function rootDisplayTokens(roots: string[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const root of roots) {
    const name = rootBaseName(root).toLowerCase();
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const tokens = new Map<string, string>();
  for (const root of roots) {
    const name = rootBaseName(root);
    tokens.set(
      root,
      (counts.get(name.toLowerCase()) ?? 0) > 1 ? normAbs(root) : name,
    );
  }
  return tokens;
}

/**
 * 结果行的灰色目录标签:条目所属根令牌 + 根内相对目录(如 `lib/docs`)。同卷
 * 与跨盘符根一视同仁(跨盘符根的令牌即其绝对路径)。单根时保持旧形态 —— 只
 * 给根内相对目录,不加根名前缀(单根无归属歧义)。
 */
export function searchRowLabel(roots: string[], entry: ScopedSearchEntry): string {
  const dir = entry.innerRel.slice(0, entry.innerRel.length - entry.name.length);
  if (roots.length <= 1) return dir;
  const token = rootDisplayTokens(roots).get(entry.root) ?? rootBaseName(entry.root);
  return dir ? `${token}/${dir}` : token;
}

/** Match quality of one query against one entry; lower wins. */
const TIER = {
  /** The name IS the query (`readme` → `readme`). */
  NameExact: 0,
  /** The name starts with the query (`readme` → `readme.md`). */
  NamePrefix: 1,
  /** The query sits inside the name (`readme` → `my-readme.md`). */
  NameSubstring: 2,
  /** The query is a subsequence of the name (`rdm` → `readme.md`). */
  NameSubsequence: 3,
  /** Only the folder path matches — a weak result, ranked last. */
  PathSubsequence: 4,
} as const;
type MatchTier = (typeof TIER)[keyof typeof TIER];

interface RankedRow<T extends MentionEntry> {
  entry: T;
  tier: MatchTier;
  /** Where the match starts (in the name, or the path for the last tier). */
  offset: number;
}

/** Leftmost index of `needle` as a subsequence of `haystack`, or null. */
function subsequenceAt(haystack: string, needle: string): number | null {
  let qi = 0;
  let first = -1;
  for (let i = 0; i < haystack.length && qi < needle.length; i++) {
    if (haystack[i] !== needle[qi]) continue;
    if (qi === 0) first = i;
    qi++;
  }
  return qi === needle.length ? first : null;
}

function rankEntry<T extends MentionEntry>(entry: T, q: string): RankedRow<T> | null {
  const name = entry.name.toLowerCase();
  if (name === q) return { entry, tier: TIER.NameExact, offset: 0 };
  if (name.startsWith(q)) return { entry, tier: TIER.NamePrefix, offset: 0 };
  const inName = name.indexOf(q);
  if (inName >= 0) return { entry, tier: TIER.NameSubstring, offset: inName };
  const inNameSub = subsequenceAt(name, q);
  if (inNameSub !== null) {
    return { entry, tier: TIER.NameSubsequence, offset: inNameSub };
  }
  // `entry.key` is the lower-cased relative path (mention-files buildEntries).
  const inPath = subsequenceAt(entry.key, q);
  if (inPath !== null) return { entry, tier: TIER.PathSubsequence, offset: inPath };
  return null;
}

/**
 * Rows the overlay shows for a query, best match first.
 *
 * Ranking is name-first: exact name, name prefix, query inside the name,
 * subsequence of the name, and only then a subsequence of the folder path.
 * Reusing the @-mention picker's scorer here was wrong — it scores the WHOLE
 * relative path, so for `readme` the workspace segment `open-reverselab`
 * matches `re…` and collects its own bonuses, which pushed the actual
 * `README.md` files below `DISCLAIMER.md`.
 *
 * Within a tier: earlier match first, then the shallower path, then
 * alphabetical. An empty query shows nothing rather than the first N scoped
 * entries — an arbitrary slice of a subtree reads as "these are the files";
 * browsing is the tree's job, this surface is search only.
 */
export function searchEntries<T extends MentionEntry>(
  entries: T[],
  root: string,
  searchRoot: string,
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const ranked: RankedRow<T>[] = [];
  for (const entry of scopeEntries(entries, root, searchRoot)) {
    const row = rankEntry(entry, q);
    if (row) ranked.push(row);
  }
  ranked.sort(
    (a, b) =>
      a.tier - b.tier ||
      a.offset - b.offset ||
      a.entry.rel.length - b.entry.rel.length ||
      (a.entry.rel < b.entry.rel ? -1 : a.entry.rel > b.entry.rel ? 1 : 0),
  );
  return ranked.slice(0, MENTION_MENU_LIMIT).map((row) => row.entry);
}
