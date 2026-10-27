import { describe, expect, it } from "vitest";
import type { DirEntry } from "@/lib/ipc";
import {
  createFileTreeFilter,
  DEFAULT_FILE_TREE_FILTER,
  parseFilterLines,
} from "./file-tree-filter";

const entry = (name: string, isDir = false): DirEntry => ({ name, isDir, size: 0, mtimeMs: 0 });

describe("文件树隐藏规则", () => {
  it("默认隐藏点项和内置忽略项，但显示默认白名单", () => {
    const visible = createFileTreeFilter("/repo", DEFAULT_FILE_TREE_FILTER);
    expect(visible("/repo", entry(".env"))).toBe(false);
    expect(visible("/repo", entry(".hidden", true))).toBe(false);
    expect(visible("/repo", entry(".github", true))).toBe(true);
    expect(visible("/repo", entry(".claude", true))).toBe(true);
    for (const name of ["node_modules", ".git", "dist", "build", "target"]) {
      expect(visible("/repo", entry(name, true))).toBe(false);
    }
    expect(visible("/repo", entry("src", true))).toBe(true);
  });

  it("自定义名称与相对路径通配符生效，且优先于白名单", () => {
    const visible = createFileTreeFilter("/repo", {
      ignorePatterns: ["*.log", "src/generated/", "**/cache-?", ".github"],
      dotWhitelist: [".github", ".env"],
    });
    expect(visible("/repo", entry("debug.log"))).toBe(false);
    expect(visible("/repo/src", entry("generated", true))).toBe(false);
    expect(visible("/repo/lib", entry("generated", true))).toBe(true);
    expect(visible("/repo/lib", entry("cache-a", true))).toBe(false);
    expect(visible("/repo", entry(".github", true))).toBe(false);
    expect(visible("/repo", entry(".env"))).toBe(true);
  });

  it("按行去重并保留用户输入的规则顺序", () => {
    expect(parseFilterLines(" dist/ \n*.log\n\n*.log\r\n"))
      .toEqual(["dist/", "*.log"]);
  });
});
