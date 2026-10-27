import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { DirEntry } from "@/lib/ipc";
import { DEFAULT_FILE_TREE_FILTER } from "./file-tree-filter";
import { useFilesStore } from "./store";
import { useFileTreeVirtualList } from "./useFileTreeVirtualList";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const dir = (name: string): DirEntry => ({ name, isDir: true, size: 0, mtimeMs: 0 });

function Probe() {
  useFileTreeVirtualList();
  return null;
}

it("恢复展开状态时只按已存在的可见路径逐层读取", () => {
  const ensureDir = vi.fn(async () => {});
  useFilesStore.setState({
    root: "/restore",
    children: { "/restore": [dir("a"), dir(".hidden")] },
    expanded: {
      "/restore": true,
      "/restore/a": true,
      "/restore/a/b": true,
      "/restore/.hidden": true,
      "/restore/missing": true,
    },
    loadingDirs: {},
    dirErrors: {},
    repositories: {},
    fileColors: {},
    filterConfig: DEFAULT_FILE_TREE_FILTER,
    ensureDir,
  });
  const element = document.createElement("div");
  document.body.appendChild(element);
  const root = createRoot(element);
  act(() => root.render(<Probe />));
  expect(ensureDir).toHaveBeenCalledWith("/restore");
  expect(ensureDir).toHaveBeenCalledWith("/restore/a");
  expect(ensureDir).not.toHaveBeenCalledWith("/restore/.hidden");
  expect(ensureDir).not.toHaveBeenCalledWith("/restore/missing");

  ensureDir.mockClear();
  act(() => useFilesStore.setState({
    children: {
      "/restore": [dir("a"), dir(".hidden")],
      "/restore/a": [dir("b")],
    },
    loadingDirs: { "/restore/a": true },
  }));
  expect(ensureDir).toHaveBeenCalledWith("/restore/a/b");
  expect(ensureDir).not.toHaveBeenCalledWith("/restore/.hidden");
  act(() => root.unmount());
  element.remove();
});
