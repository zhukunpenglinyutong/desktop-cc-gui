import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import "@/lib/i18n";
import { fileTreeWorkspaceKey, useFilesStore } from "./store";
import { DEFAULT_FILE_TREE_FILTER } from "./file-tree-filter";
import { FileTree } from "./FileTree";

vi.mock("./useFileTreeVirtualList", () => ({
  useFileTreeVirtualList: () => ({ parentRef: { current: null }, virtualizer: {}, visible: [] }),
}));
vi.mock("./useFileTreeOperations", () => ({
  useFileTreeOperations: () => ({ openContextMenu: vi.fn() }),
}));
vi.mock("./FileTreeBody", () => ({ FileTreeBody: () => <button>树节点</button> }));
vi.mock("./FileTreeOverlays", () => ({ FileTreeOverlays: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const expandLoadedDirs = vi.fn();
const collapseAllDirs = vi.fn();

beforeEach(() => {
  expandLoadedDirs.mockClear();
  collapseAllDirs.mockClear();
  useFilesStore.setState({ root: "/repo", expandLoadedDirs, collapseAllDirs, filterConfig: DEFAULT_FILE_TREE_FILTER });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<FileTree />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

it("工具条按钮和文件树内快捷键执行同一操作", () => {
  const buttons = container.querySelectorAll<HTMLButtonElement>("button[aria-keyshortcuts]");
  expect(buttons).toHaveLength(2);
  act(() => {
    buttons[0].click();
    buttons[1].click();
    container.querySelector("button:not([aria-keyshortcuts])")!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", altKey: true, shiftKey: true, bubbles: true }),
    );
    container.querySelector("button:not([aria-keyshortcuts])")!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", altKey: true, shiftKey: true, bubbles: true }),
    );
  });
  expect(expandLoadedDirs).toHaveBeenCalledTimes(2);
  expect(collapseAllDirs).toHaveBeenCalledTimes(2);
});

it("过滤面板保存白名单和自定义忽略规则", () => {
  const filterButton = [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.getAttribute("aria-label") === "文件树过滤规则")!;
  act(() => filterButton.click());
  const fields = container.querySelectorAll<HTMLTextAreaElement>("textarea");
  expect(fields[0].value).toContain(".github");
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => {
    setValue.call(fields[1], "*.log\nsrc/generated/");
    fields[1].dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => {
    [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "保存")!.click();
  });
  expect(useFilesStore.getState().filterConfig.ignorePatterns).toEqual(["*.log", "src/generated/"]);
  expect(JSON.parse(localStorage.getItem(fileTreeWorkspaceKey("/repo"))!).filterConfig).toEqual({
    ignorePatterns: ["*.log", "src/generated/"],
    dotWhitelist: [".github", ".claude"],
  });
  expect(container.querySelector("textarea")).toBeNull();
});
