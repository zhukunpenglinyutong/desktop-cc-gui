import { describe, expect, it } from "vitest";
import type { DirEntry } from "@/lib/ipc";
import { compactFolder } from "./useFileTreeVirtualList";
import { createFileTreeFilter, DEFAULT_FILE_TREE_FILTER } from "./file-tree-filter";

const dir = (name: string): DirEntry => ({ name, isDir: true, size: 0, mtimeMs: 0 });
const file = (name: string): DirEntry => ({ name, isDir: false, size: 0, mtimeMs: 0 });

describe("单链目录显示", () => {
  it("只合并已加载的单子目录链，并保留每一级真实路径", () => {
    const children = {
      "/repo/a": [dir("b")],
      "/repo/a/b": [dir("c")],
    };
    expect(compactFolder("/repo", dir("a"), children, {}, {}, {})).toEqual({
      name: "a/b/c",
      path: "/repo/a/b/c",
      paths: ["/repo/a", "/repo/a/b", "/repo/a/b/c"],
    });
  });

  it("遇到文件、分叉或仓库标记时停止合并", () => {
    expect(compactFolder("/repo", dir("a"), { "/repo/a": [file("x")] }, {}, {}, {}).name).toBe("a");
    expect(compactFolder("/repo", dir("a"), { "/repo/a": [dir("b"), dir("c")] }, {}, {}, {}).name).toBe("a");
    expect(compactFolder("/repo", dir("a"), { "/repo/a": [dir("b")] }, {
      "/repo/a": { path: "/repo/a", branch: "main", changed: 0, untracked: 0 },
    }, {}, {}).name).toBe("a");
  });

  it("过滤隐藏项后按剩余可见目录合并", () => {
    const children = { "/repo/a": [dir("b"), file(".secret")] };
    const visible = createFileTreeFilter("/repo", DEFAULT_FILE_TREE_FILTER);
    expect(compactFolder("/repo", dir("a"), children, {}, {}, {}, visible).name).toBe("a/b");
  });
});
