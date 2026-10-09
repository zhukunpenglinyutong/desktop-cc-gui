import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";
import { useFileTreeVirtualList } from "./useFileTreeVirtualList";
import { useFilesStore } from "./store";
import type { DirEntry } from "@/lib/ipc";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const entry = (name: string, isDir = false): DirEntry => ({ name, isDir, size: 0, mtimeMs: 0 });

const listDir = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ipc", () => ({
  ipc: {
    listDir,
    gitTreeStatus: vi.fn(async () => ({ repositories: [], fileColors: {} })),
  },
}));

let visible: ReturnType<typeof useFileTreeVirtualList>["visible"];

function Harness() {
  visible = useFileTreeVirtualList().visible;
  return null;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  listDir.mockReset();
  listDir.mockImplementation(async (path: string) =>
    path === "/ws/main"
      ? [entry("main-file.txt")]
      : path === "/ws/extra"
        ? [entry("extra-file.txt")]
        : [],
  );
  useFilesStore.setState({
    roots: [],
    children: {},
    expanded: {},
    loadingDirs: {},
    dirErrors: {},
    repositories: {},
    fileColors: {},
    refreshing: false,
    searchRoot: null,
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("文件树多根", () => {
  it("单根时只渲染一个根行,且自动展开", async () => {
    await act(async () => {
      root.render(<Harness />);
      useFilesStore.getState().setRoots(["/ws/main"]);
    });
    const rootRows = visible.filter((n) => n.depth === 0);
    expect(rootRows.map((n) => n.path)).toEqual(["/ws/main"]);
    expect(visible.map((n) => n.path)).toEqual(["/ws/main", "/ws/main/main-file.txt"]);
  });

  it("多根并列:主目录在前、附加根在后,各自展开子树", async () => {
    await act(async () => {
      root.render(<Harness />);
      useFilesStore.getState().setRoots(["/ws/main", "/ws/extra"]);
    });
    // 顶层两个根行,顺序为主目录在前。
    const rootRows = visible.filter((n) => n.depth === 0);
    expect(rootRows.map((n) => n.path)).toEqual(["/ws/main", "/ws/extra"]);
    // 每个根各自的顶层子项都渲染(仍是同一棵树/同一个列表)。
    expect(visible.map((n) => n.path)).toEqual([
      "/ws/main",
      "/ws/main/main-file.txt",
      "/ws/extra",
      "/ws/extra/extra-file.txt",
    ]);
    // 两个根都预取了顶层。
    expect(listDir).toHaveBeenCalledWith("/ws/main");
    expect(listDir).toHaveBeenCalledWith("/ws/extra");
  });

  it("根不可折叠:再次 setRoots 同一组不会把它收起来", async () => {
    await act(async () => {
      root.render(<Harness />);
      useFilesStore.getState().setRoots(["/ws/main", "/ws/extra"]);
    });
    // 根行恒 expanded,点击根只会在 store 里来回 toggle;即使误触收起,
    // 虚拟列表仍把 root 行保留在列表里(不丢入口)。
    act(() => {
      useFilesStore.getState().toggleDir("/ws/extra");
    });
    expect(visible.some((n) => n.path === "/ws/extra" && n.depth === 0)).toBe(true);
  });

  it("根在磁盘上不存在(列表报错)时,其它根照常渲染,不崩溃", async () => {
    listDir.mockImplementation(async (path: string) => {
      if (path === "/ws/gone") throw new Error("not a directory");
      return path === "/ws/main" ? [entry("main-file.txt")] : [];
    });
    await act(async () => {
      root.render(<Harness />);
      useFilesStore.getState().setRoots(["/ws/main", "/ws/gone"]);
    });
    expect(visible.some((n) => n.path === "/ws/main/main-file.txt")).toBe(true);
    expect(useFilesStore.getState().dirErrors["/ws/gone"]).toBeTruthy();
  });
});
