import { describe, expect, it } from "vitest";
import {
  combineRootEntries,
  namespaceRelative,
  rootDisplayTokens,
  rootPrefix,
  scopeEntries,
  scopeToPrimaryRoot,
  searchEntries,
  searchRowLabel,
  workspaceRelativePrefix,
} from "./file-search";
import type { MentionEntry } from "@/components/application/ai-chat/mention-files";

/**
 * The folder scope is the one place this overlay can silently search the
 * wrong subtree: `src` must not sweep in `src-extra/`, and the same trap
 * exists one level up when the workspace itself sits beside a
 * same-prefixed sibling. Every prefix assertion here fails on a bare
 * `startsWith(prefix)` — that is the regression this file exists for.
 *
 * `entry()` mirrors `buildEntries` in mention-files.ts (key is
 * LOWER-CASED; the matcher compares against a lower-cased query, so a
 * mixed-case key makes every match silently miss).
 */
const WS = "S:/AIWorker/proj";

function entry(rel: string): MentionEntry {
  const name = rel.split("/").pop() ?? rel;
  return {
    rel,
    name,
    isDir: rel.endsWith("/"),
    depth: rel.split("/").length - 1,
    key: rel.toLowerCase(),
    nameStart: rel.length - name.length,
  } as MentionEntry;
}

const INDEX = [
  entry("src/features/files/store.ts"),
  entry("src/features/files/deep/nested/FileSearchOverlay.tsx"),
  entry("src-extra/sibling.ts"),
  entry("docs/readme.md"),
  entry("README.md"),
];

describe("workspaceRelativePrefix", () => {
  it("returns '' when the target IS the root", () => {
    expect(workspaceRelativePrefix(WS, WS)).toBe("");
  });

  it("returns the child prefix with '/' separators", () => {
    expect(workspaceRelativePrefix(WS, `${WS}/src/features`)).toBe("src/features");
  });

  it("normalizes Windows backslashes to '/' before comparing", () => {
    expect(workspaceRelativePrefix("S:\\AIWorker\\proj", "S:/AIWorker/proj/src")).toBe("src");
    expect(workspaceRelativePrefix(WS, `${WS}\\src`)).toBe("src");
  });

  it("tolerates a trailing separator on either side", () => {
    expect(workspaceRelativePrefix(`${WS}/`, `${WS}/src/`)).toBe("src");
  });

  it("returns null for a path outside the workspace", () => {
    expect(workspaceRelativePrefix(WS, "S:/AIWorker/other")).toBeNull();
    // Prefix-of-a-sibling WITHOUT a separator must not count as inside.
    expect(workspaceRelativePrefix("S:/AIWorker/proj", "S:/AIWorker/proj-extra")).toBeNull();
  });
});

describe("scopeEntries", () => {
  it("passes every entry through when the scope is the workspace root", () => {
    expect(scopeEntries(INDEX, WS, WS).map((e) => e.rel)).toEqual(INDEX.map((e) => e.rel));
  });

  it("keeps only the entries inside the scoped folder", () => {
    const out = scopeEntries(INDEX, WS, `${WS}/src/features`);
    expect(out.map((e) => e.rel)).toEqual([
      "src/features/files/store.ts",
      "src/features/files/deep/nested/FileSearchOverlay.tsx",
    ]);
  });

  it("does not leak a sibling whose name shares the prefix (src vs src-extra)", () => {
    const out = scopeEntries(INDEX, WS, `${WS}/src`);
    const rels = out.map((e) => e.rel);
    expect(rels).not.toContain("src-extra/sibling.ts");
    expect(rels).toContain("src/features/files/store.ts");
  });

  it("returns [] when the scope is outside the workspace", () => {
    expect(scopeEntries(INDEX, WS, "S:/AIWorker/other")).toEqual([]);
  });
});

describe("searchEntries", () => {
  it("shows nothing for an empty or whitespace-only query", () => {
    expect(searchEntries(INDEX, WS, WS, "")).toEqual([]);
    expect(searchEntries(INDEX, WS, WS, "   ")).toEqual([]);
  });

  it("finds a file nested two levels inside the scoped folder", () => {
    const out = searchEntries(INDEX, WS, `${WS}/src/features`, "overlay");
    expect(out.map((e) => e.rel)).toEqual([
      "src/features/files/deep/nested/FileSearchOverlay.tsx",
    ]);
  });

  it("never returns a match outside the scope", () => {
    // "sibling" only exists under src-extra, which the src scope excludes.
    expect(searchEntries(INDEX, WS, `${WS}/src`, "sibling")).toEqual([]);
  });

  it("returns [] for a query with no matches", () => {
    expect(searchEntries(INDEX, WS, WS, "zzz-no-such-file")).toEqual([]);
  });
});

/**
 * The search box ranks by NAME match quality, not by the @-mention picker's
 * whole-path score. The difference is observable: a workspace folder whose
 * name contains the query's letters used to outrank the files the user was
 * actually typing towards (`open-reverselab` matching `re…` beat `README.md`),
 * and a folder-only subsequence match could beat a real name match.
 */
describe("searchEntries ranking", () => {
  const RN = "S:/AIWorker/open-reverselab";
  const RINDEX = [
    "open-reverselab/DISCLAIMER.md",
    "open-reverselab/DISCLAIMER.zh.md",
    "open-reverselab/README.md",
    "open-reverselab/README.zh.md",
    "open-reverselab/kb/README.md",
    "open-reverselab/gui/README.md",
    "open-reverselab/IdolLive!Underichigo -read me-.txt",
  ].map(entry);

  it("puts a name match above a folder-path match", () => {
    const rels = searchEntries(RINDEX, RN, RN, "readme").map((e) => e.rel);
    expect(rels[0]).toBe("open-reverselab/README.md");
    // DISCLAIMER only matches through the folder path (`…reverselab…`), so it
    // must sit below every real README row.
    expect(rels.indexOf("open-reverselab/DISCLAIMER.md")).toBeGreaterThan(
      rels.indexOf("open-reverselab/kb/README.md"),
    );
  });

  it("orders same-tier matches by shallower path", () => {
    const rels = searchEntries(RINDEX, RN, RN, "readme").map((e) => e.rel);
    expect(rels.indexOf("open-reverselab/README.md")).toBeLessThan(
      rels.indexOf("open-reverselab/kb/README.md"),
    );
  });

  it("puts an exact file name first", () => {
    const rels = searchEntries(RINDEX, RN, RN, "README.md").map((e) => e.rel);
    expect(rels[0]).toBe("open-reverselab/README.md");
  });

  it("ranks a name subsequence above a folder-only match", () => {
    const rels = searchEntries(RINDEX, RN, RN, "readme").map((e) => e.rel);
    expect(rels.indexOf("open-reverselab/IdolLive!Underichigo -read me-.txt")).toBeLessThan(
      rels.indexOf("open-reverselab/DISCLAIMER.md"),
    );
  });

  it("matches case-insensitively", () => {
    expect(searchEntries(RINDEX, RN, RN, "ReAdMe.Md")[0]?.rel).toBe(
      "open-reverselab/README.md",
    );
  });
});

/**
 * 跨根搜索:附加根(与主目录并列的兄弟目录)的索引并入主目录命名空间后,
 * 一条 query 同时命中所有根;作用域(文件树右键的目录)也要能落在任一根的
 * 子目录上。这里覆盖合并、重定基与作用域映射三条纯函数。
 */
describe("跨根搜索", () => {
  const PRIMARY = "S:/AIWorker/proj";
  const EXTRA = "S:/AIWorker/lib";

  const PINDEX = [entry("README.md"), entry("src/a.ts")];
  const EINDEX = [entry("README.md"), entry("docs/readme.md")];

  it("namespaceRelative 表达兄弟目录(允许 .. 段)", () => {
    expect(namespaceRelative(PRIMARY, EXTRA)).toBe("../lib");
    expect(namespaceRelative(PRIMARY, `${PRIMARY}/src`)).toBe("src");
    expect(namespaceRelative(PRIMARY, PRIMARY)).toBe("");
    // 不同盘符(Windows)无法表达相对路径。
    expect(namespaceRelative("C:/a/b", "D:/a/b")).toBeNull();
  });

  it("把附加根的条目重定基到主目录命名空间,避免 rel 冲突", () => {
    const combined = combineRootEntries([PRIMARY, EXTRA], [PINDEX, EINDEX]);
    const rels = combined.map((e) => e.rel);
    // 两个根各有一条 README.md,重定基后 rel 不同,不互相覆盖。
    expect(rels).toContain("README.md");
    expect(rels).toContain("../lib/README.md");
    const extra = combined.find((e) => e.rel === "../lib/README.md");
    expect(extra?.root).toBe(EXTRA);
    // depth/key 依新 rel 重算。
    expect(extra?.depth).toBe(2);
    expect(extra?.key).toBe("../lib/readme.md");
  });

  it("搜索命中所有根内的文件", () => {
    const combined = combineRootEntries([PRIMARY, EXTRA], [PINDEX, EINDEX]);
    const hits = searchEntries(combined, PRIMARY, PRIMARY, "readme");
    const roots = hits.map((e) => e.root);
    expect(roots).toContain(PRIMARY);
    expect(roots).toContain(EXTRA);
    // 两个根里的 README.md 都出现(rel 区分)。
    expect(hits.some((e) => e.rel === "README.md")).toBe(true);
    expect(hits.some((e) => e.rel === "../lib/README.md")).toBe(true);
  });

  it("作用域可以落在附加根的子目录上", () => {
    const scope = scopeToPrimaryRoot([PRIMARY, EXTRA], `${EXTRA}/docs`);
    expect(scope).toBe(`${PRIMARY}/../lib/docs`);
    const combined = combineRootEntries([PRIMARY, EXTRA], [PINDEX, EINDEX]);
    const hits = searchEntries(combined, PRIMARY, scope!, "readme");
    expect(hits.map((e) => e.rel)).toEqual(["../lib/docs/readme.md"]);
  });

  it("作用域不在任何根内时返回 null 且不搜索", () => {
    expect(scopeToPrimaryRoot([PRIMARY, EXTRA], "S:/AIWorker/other")).toBeNull();
  });

  it("单根时与旧行为一致(直接作用域、无重定基)", () => {
    const combined = combineRootEntries([PRIMARY], [PINDEX]);
    expect(combined.map((e) => e.rel)).toEqual(["README.md", "src/a.ts"]);
    expect(scopeToPrimaryRoot([PRIMARY], `${PRIMARY}/src`)).toBe(`${PRIMARY}/src`);
    expect(searchEntries(combined, PRIMARY, PRIMARY, "a.ts").map((e) => e.rel)).toEqual([
      "src/a.ts",
    ]);
  });
});

/**
 * 跨盘符(不同卷)的根:没有相对路径可表达,改用该根的绝对路径作命名空间前缀
 * 并入同一列表,不再跳过。合并、重定基、作用域映射与激活的 innerRel 四条链路
 * 都要在跨卷时仍然成立。
 */
describe("跨盘符根搜索", () => {
  const PRIMARY = "S:/AIWorker/proj";
  const CROSS = "C:/vendor/lib";

  const PINDEX = [entry("README.md"), entry("src/a.ts")];
  const CINDEX = [entry("README.md"), entry("docs/readme.md")];

  it("rootPrefix 跨盘符回退为绝对路径,同卷仍为相对路径", () => {
    expect(rootPrefix(PRIMARY, "S:/AIWorker/lib")).toBe("../lib");
    expect(rootPrefix(PRIMARY, PRIMARY)).toBe("");
    // 不同盘符:相对路径不存在,回退到该根的绝对路径。
    expect(rootPrefix(PRIMARY, CROSS)).toBe("C:/vendor/lib");
    expect(rootPrefix("", CROSS)).toBeNull();
  });

  it("跨盘符根的条目并进同一列表,rel 用绝对路径不冲突", () => {
    const combined = combineRootEntries([PRIMARY, CROSS], [PINDEX, CINDEX]);
    const rels = combined.map((e) => e.rel);
    expect(rels).toContain("README.md");
    expect(rels).toContain("C:/vendor/lib/README.md");
    const cross = combined.find((e) => e.rel === "C:/vendor/lib/README.md");
    expect(cross?.root).toBe(CROSS);
    // innerRel 保留重定基前的根内相对路径(激活时拼回绝对路径用)。
    expect(cross?.innerRel).toBe("README.md");
    expect(cross?.key).toBe("c:/vendor/lib/readme.md");
  });

  it("跨盘符根的条目参与检索,一条 query 命中所有根", () => {
    const combined = combineRootEntries([PRIMARY, CROSS], [PINDEX, CINDEX]);
    const hits = searchEntries(combined, PRIMARY, PRIMARY, "readme");
    const roots = hits.map((e) => e.root);
    expect(roots).toContain(PRIMARY);
    expect(roots).toContain(CROSS);
  });

  it("作用域可以落在跨盘符根的子目录上", () => {
    const scope = scopeToPrimaryRoot([PRIMARY, CROSS], `${CROSS}/docs`);
    expect(scope).toBe(`${PRIMARY}/C:/vendor/lib/docs`);
    const combined = combineRootEntries([PRIMARY, CROSS], [PINDEX, CINDEX]);
    const hits = searchEntries(combined, PRIMARY, scope!, "readme");
    expect(hits.map((e) => e.innerRel)).toEqual(["docs/readme.md"]);
    expect(hits[0]?.root).toBe(CROSS);
  });
});

/**
 * 结果行的灰色目录标签:多根时 = 条目所属根令牌 + 根内相对目录;根目录末级名
 * 重名时该根令牌改用绝对路径;单根保持旧的根内相对目录形态(不加根名前缀)。
 */
describe("结果行目录标签", () => {
  const PRIMARY = "S:/AIWorker/proj";
  const SIBLING = "S:/AIWorker/lib";
  const CROSS = "C:/vendor/lib";

  it("多根:标签为 根名/根内相对目录", () => {
    const roots = [PRIMARY, SIBLING];
    const combined = combineRootEntries(roots, [
      [entry("kb/README.md")],
      [entry("docs/readme.md")],
    ]);
    expect(searchRowLabel(roots, combined.find((e) => e.root === PRIMARY)!)).toBe(
      "proj/kb/",
    );
    expect(searchRowLabel(roots, combined.find((e) => e.root === SIBLING)!)).toBe(
      "lib/docs/",
    );
  });

  it("根目录末级名相同时改显绝对路径", () => {
    const roots = [PRIMARY, SIBLING, CROSS]; // SIBLING 与 CROSS 的末级名都是 lib
    const combined = combineRootEntries(roots, [
      [entry("README.md")],
      [entry("README.md")],
      [entry("README.md")],
    ]);
    // proj 唯一 → 末级名;两个 lib 重名 → 各自绝对路径。
    expect(searchRowLabel(roots, combined.find((e) => e.root === PRIMARY)!)).toBe("proj");
    expect(searchRowLabel(roots, combined.find((e) => e.root === SIBLING)!)).toBe(
      "S:/AIWorker/lib",
    );
    expect(searchRowLabel(roots, combined.find((e) => e.root === CROSS)!)).toBe(
      "C:/vendor/lib",
    );
  });

  it("根内目录条目(无子目录)的标签即为根令牌", () => {
    const roots = [PRIMARY, SIBLING];
    const combined = combineRootEntries(roots, [[entry("README.md")], []]);
    expect(searchRowLabel(roots, combined[0])).toBe("proj");
  });

  it("单根:保持旧的根内相对目录,不加根名前缀", () => {
    const roots = [PRIMARY];
    const combined = combineRootEntries(roots, [[entry("src/features/store.ts")]]);
    expect(searchRowLabel(roots, combined[0])).toBe("src/features/");
  });

  it("rootDisplayTokens:重名根用绝对路径,唯一根用末级名", () => {
    const tokens = rootDisplayTokens([PRIMARY, SIBLING, CROSS]);
    expect(tokens.get(PRIMARY)).toBe("proj");
    expect(tokens.get(SIBLING)).toBe("S:/AIWorker/lib");
    expect(tokens.get(CROSS)).toBe("C:/vendor/lib");
  });
});
