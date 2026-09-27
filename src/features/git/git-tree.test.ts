import { describe, expect, it } from "vitest";
import { buildGitTree, flattenGitTree, type GitTreeDirNode } from "./git-tree";
import type { GitFileEntry } from "@/lib/ipc";

describe("buildGitTree", () => {
  it("returns empty array for empty entries", () => {
    expect(buildGitTree([])).toEqual([]);
  });

  it("handles flat files in the root", () => {
    const entries: GitFileEntry[] = [
      { path: "README.md", status: "M" },
      { path: "package.json", status: "M" },
    ];
    const tree = buildGitTree(entries);
    expect(tree).toHaveLength(2);
    expect(tree[0].type).toBe("file");
    expect(tree[0].name).toBe("README.md");
    expect(tree[1].name).toBe("package.json");
  });

  it("compacts single-child directories without intermediate files", () => {
    const entries: GitFileEntry[] = [
      { path: "src/features/git/ChangesPanel.tsx", status: "M" },
      { path: "src/features/git/store.ts", status: "M" },
      { path: "docs/readme.md", status: "??" },
    ];
    const tree = buildGitTree(entries);

    // Two root directories: docs and src/features/git
    expect(tree).toHaveLength(2);
    expect(tree[0].type).toBe("dir");
    expect(tree[0].name).toBe("docs");
    expect((tree[0] as GitTreeDirNode).allPaths).toEqual(["docs/readme.md"]);

    expect(tree[1].type).toBe("dir");
    expect(tree[1].name).toBe("src/features/git");
    expect((tree[1] as GitTreeDirNode).children).toHaveLength(2);
    expect((tree[1] as GitTreeDirNode).allPaths).toEqual([
      "src/features/git/ChangesPanel.tsx",
      "src/features/git/store.ts",
    ]);
  });

  it("flattens tree while respecting collapsed directories", () => {
    const entries: GitFileEntry[] = [
      { path: "src/features/git/ChangesPanel.tsx", status: "M" },
      { path: "src/features/git/store.ts", status: "M" },
    ];
    const tree = buildGitTree(entries);
    expect(tree).toHaveLength(1);
    const dirNode = tree[0] as GitTreeDirNode;

    // Fully expanded
    const expanded = flattenGitTree(tree, new Set());
    expect(expanded).toHaveLength(3); // 1 dir + 2 files
    expect(expanded.map((x) => x.name)).toEqual([
      "src/features/git",
      "ChangesPanel.tsx",
      "store.ts",
    ]);

    // Collapsed dir
    const collapsed = flattenGitTree(tree, new Set([dirNode.id]));
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0].name).toBe("src/features/git");
  });
});
