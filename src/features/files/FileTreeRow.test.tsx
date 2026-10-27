import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";
import { TreeRow, type VisibleNode } from "./FileTreeRow";
import { useFilesStore } from "./store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Workspace-root row of the tree (synthetic depth-0 row). */
const rootNode: VisibleNode = {
  name: "desktop-cc-gui",
  isDir: true,
  size: 0,
  mtimeMs: 0,
  path: "/ws/desktop-cc-gui",
  depth: 0,
  expanded: true,
  loading: false,
};

const childNode: VisibleNode = {
  ...rootNode,
  name: "src",
  path: "/ws/desktop-cc-gui/src",
  depth: 1,
};

describe("TreeRow tree refresh", () => {
  let container: HTMLDivElement;
  let root: Root;
  const refreshTree = vi.fn(async () => {});
  const onToggleDir = vi.fn();
  const onSelectDir = vi.fn();
  const onMention = vi.fn();

  beforeEach(() => {
    refreshTree.mockClear();
    onToggleDir.mockClear();
    onSelectDir.mockClear();
    onMention.mockClear();
    useFilesStore.setState({ refreshTree });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(node: VisibleNode, isRoot: boolean) {
    act(() => {
      root.render(
        <TreeRow
          node={node}
          selected={false}
          isRoot={isRoot}
          onToggleDir={onToggleDir}
          onOpenFile={() => {}}
          onSelectDir={onSelectDir}
          onContextMenu={() => {}}
          onMention={onMention}
          mentionLabel="添加到聊天"
        />,
      );
    });
  }

  function refreshButton(): HTMLButtonElement | null {
    return container.querySelector<HTMLButtonElement>('button[aria-label="刷新"]');
  }

  it("only the workspace-root row carries the refresh, revealed on hover", () => {
    render(childNode, false);
    expect(refreshButton()).toBeNull();
    render(rootNode, true);
    const button = refreshButton();
    expect(button).not.toBeNull();
    // Hover-revealed exactly like the row's mention "+": hidden until the
    // row's group hover (or keyboard focus) shows it.
    expect(button?.className).toContain("hidden");
    expect(button?.className).toContain("group-hover:flex");
    expect(button?.className).toContain("focus-visible:flex");
  });

  it("clicking it reloads the tree without toggling the row", () => {
    render(rootNode, true);
    act(() => {
      refreshButton()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(refreshTree).toHaveBeenCalledTimes(1);
    expect(onToggleDir).not.toHaveBeenCalled();
  });

  it("合并目录行展开整条路径，选择与路径操作指向末级目录", () => {
    render({
      ...childNode,
      name: "src/features/files",
      path: "/ws/desktop-cc-gui/src/features/files",
      compactPaths: [
        "/ws/desktop-cc-gui/src",
        "/ws/desktop-cc-gui/src/features",
        "/ws/desktop-cc-gui/src/features/files",
      ],
    }, false);
    act(() => container.querySelector<HTMLButtonElement>("button")?.click());
    expect(onSelectDir).toHaveBeenCalledWith("/ws/desktop-cc-gui/src/features/files");
    expect(onToggleDir).toHaveBeenCalledWith([
      "/ws/desktop-cc-gui/src",
      "/ws/desktop-cc-gui/src/features",
      "/ws/desktop-cc-gui/src/features/files",
    ]);
  });
});
