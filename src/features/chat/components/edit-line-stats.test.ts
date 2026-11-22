import { describe, expect, it, vi } from "vitest";
import type { Message } from "@/lib/ipc";
import {
  computeDiffLines,
  countEditLines,
  createEditLineStatsBuilder,
  deriveEditLineStats,
  parsePatchLines,
  previewContentLines,
  previewDiffLines,
  previewPatchLines,
} from "./edit-line-stats";

function editRow(seq: number, path: string, args: unknown, text = "edit · Applying"): Message {
  return { seq, role: "tool", text, ts: null, path, args } as Message;
}

describe("countEditLines", () => {
  it("counts +/- rows of a unified patch", () => {
    const stat = countEditLines({
      file_path: "src/a.ts",
      patch: "@@ -1,4 +1,5 @@\n ctx\n-gone\n-also gone\n+fresh\n+more\n+tail\n ctx2",
    });
    expect(stat).toEqual({ additions: 3, deletions: 2 });
  });

  it("counts the changed span of an old/new string pair, ignoring common context", () => {
    const stat = countEditLines({
      old_string: "keep\nold one\nold two\ntail",
      new_string: "keep\nnew one\ntail",
    });
    expect(stat).toEqual({ additions: 1, deletions: 2 });
  });

  it("counts a whole-file content write as pure additions", () => {
    expect(countEditLines({ path: "src/new.ts", content: "a\nb\nc" })).toEqual({
      additions: 3,
      deletions: 0,
    });
  });

  it("prefers the patch over the string pair, matching the diff viewer", () => {
    const stat = countEditLines({
      patch: "@@ -1 +1 @@\n-x\n+y",
      old_string: "1\n2\n3\n4\n5",
      new_string: "",
    });
    expect(stat).toEqual({ additions: 1, deletions: 1 });
  });

  it("returns null when the args carry no edit payload", () => {
    expect(countEditLines({ file_path: "src/a.ts", offset: 10 })).toBeNull();
    expect(countEditLines(undefined)).toBeNull();
    expect(countEditLines("edit src/a.ts")).toBeNull();
  });
});

describe("deriveEditLineStats", () => {
  it("reuses unchanged tool statistics and aggregate identity during streaming", () => {
    const build = createEditLineStatsBuilder();
    const readContent = vi.fn(() => "a\nb");
    const tool = editRow(1, "src/a.ts", { get content() { return readContent(); } });
    const first = build([tool]);
    const reads = readContent.mock.calls.length;
    expect(reads).toBeGreaterThan(0);
    expect(build([tool, { seq: 2, role: "assistant", text: "growing" } as Message])).toBe(first);
    expect(readContent).toHaveBeenCalledTimes(reads);
    expect(build([tool, editRow(3, "src/a.ts", { content: "c" })]).get("src/a.ts"))
      .toEqual({ additions: 3, deletions: 0 });
    expect(readContent).toHaveBeenCalledTimes(reads);
    expect(first.get("src/a.ts")).toEqual({ additions: 2, deletions: 0 });
  });

  it("invalidates replaced messages, prepended history and removed tools without sharing sessions", () => {
    const build = createEditLineStatsBuilder();
    const tool = editRow(1, "a.ts", { content: "a" });
    const first = build([tool]);
    expect(build([{ ...tool, args: { content: "a\nb" } }]).get("a.ts")?.additions).toBe(2);
    expect(build([editRow(0, "b.ts", { content: "old" }), tool]).size).toBe(2);
    expect(build([]).size).toBe(0);
    expect(createEditLineStatsBuilder()([editRow(1, "a.ts", { content: "other\nsession" })])
      .get("a.ts")?.additions).toBe(2);
    expect(first.get("a.ts")?.additions).toBe(1);
  });
  it("counts gitignored paths git status never reports", () => {
    const stats = deriveEditLineStats([
      editRow(1, ".omp/docs/x.md", { old_string: "one\ntwo", new_string: "uno" }),
    ]);
    expect(stats.get(".omp/docs/x.md")).toEqual({ additions: 1, deletions: 2 });
  });

  it("accumulates repeated edits of one path instead of the last winning", () => {
    const stats = deriveEditLineStats([
      editRow(1, "src/a.ts", { content: "a\nb" }),
      editRow(2, "src/a.ts", { old_string: "x\ny\nz", new_string: "" }),
      editRow(3, "src/a.ts", { patch: "@@ -1 +1,2 @@\n+p\n+q" }),
    ]);
    expect(stats.get("src/a.ts")).toEqual({ additions: 4, deletions: 3 });
  });

  it("ignores non-file targets carrying a URI scheme", () => {
    const stats = deriveEditLineStats([
      editRow(1, "xd://ast_edit", { content: "a\nb\nc" }),
      editRow(2, "src/a.ts", { content: "a" }),
    ]);
    expect([...stats.keys()]).toEqual(["src/a.ts"]);
  });

  it("skips rows that are not edit-class tools", () => {
    const stats = deriveEditLineStats([
      editRow(1, "src/a.ts", { content: "a\nb" }, "read · Reading the file"),
      { seq: 2, role: "assistant", text: "write", ts: null } as Message,
    ]);
    expect(stats.size).toBe(0);
  });
});

describe("large edit payloads", () => {
  it("keeps suffix order without quadratic array prepends", () => {
    const suffix = Array.from({ length: 2000 }, (_, index) => `line ${index}`).join("\n");
    const prepend = vi.spyOn(Array.prototype, "unshift");
    let lines: ReturnType<typeof computeDiffLines>;
    let prepends: number;
    try {
      lines = computeDiffLines(`old\n${suffix}`, `new\n${suffix}`);
      prepends = prepend.mock.calls.length;
    } finally {
      prepend.mockRestore();
    }
    expect(prepends).toBe(0);
    expect(lines!.slice(0, 3)).toEqual([
      { type: "del", text: "old", oldLineNo: 1 },
      { type: "add", text: "new", newLineNo: 1 },
      { type: "ctx", text: "line 0", oldLineNo: 2, newLineNo: 2 },
    ]);
    expect(lines!.at(-1)).toEqual({ type: "ctx", text: "line 1999", oldLineNo: 2001, newLineNo: 2001 });
  });

  it("matches the displayed diff counts for empty, Unicode, prefix and suffix cases", () => {
    const inputs = [undefined, "", "中文🙂", "a\n", "a\nb", "x\na\nb", "a\nb\nx"];
    for (const oldString of inputs) {
      for (const newString of inputs) {
        if (!oldString && !newString) continue;
        const lines = computeDiffLines(oldString, newString);
        expect(countEditLines({ old_string: oldString, new_string: newString })).toEqual({
          additions: lines.filter(line => line.type === "add").length,
          deletions: lines.filter(line => line.type === "del").length,
        });
      }
    }
  });

  it("bounds the rendered window while keeping whole-diff counts exact", () => {
    const inputs = [undefined, "", "中文🙂", "a\n", "a\nb", "x\na\nb", "a\nb\nx"];
    for (const oldString of inputs) {
      for (const newString of inputs) {
        if (!oldString && !newString) continue;
        const full = computeDiffLines(oldString, newString);
        for (const limit of [0, 1, 2, 400]) {
          const preview = previewDiffLines(oldString, newString, limit);
          expect(preview.lines).toEqual(full.slice(0, limit));
          expect(preview.total).toBe(full.length);
          expect(preview.addCount).toBe(full.filter((line) => line.type === "add").length);
          expect(preview.delCount).toBe(full.filter((line) => line.type === "del").length);
        }
      }
    }
  });

  it("never materializes a whole-file write", () => {
    const content = Array.from({ length: 20_000 }, (_, index) => `line ${index}`).join("\n");
    const preview = previewContentLines(content, 400);
    expect(preview.lines).toHaveLength(400);
    expect(preview.lines.at(-1)).toEqual({ type: "add", text: "line 399", newLineNo: 400 });
    expect(preview).toMatchObject({ total: 20_000, addCount: 20_000, delCount: 0 });
    expect(countEditLines({ path: "src/big.ts", content })).toEqual({
      additions: 20_000,
      deletions: 0,
    });
  });

  it("bounds a unified patch and keeps its hunk numbering", () => {
    const patch = [
      "@@ -1,2 +1,2 @@",
      " ctx",
      "-old",
      "+new",
      ...Array.from({ length: 500 }, (_, index) => `+added ${index}`),
    ].join("\n");
    const full = parsePatchLines(patch);
    const preview = previewPatchLines(patch, 3);
    expect(preview.lines).toEqual(full.slice(0, 3));
    expect(preview.total).toBe(full.length);
    expect(preview.addCount).toBe(full.filter((line) => line.type === "add").length);
    expect(preview.delCount).toBe(full.filter((line) => line.type === "del").length);
  });
});
