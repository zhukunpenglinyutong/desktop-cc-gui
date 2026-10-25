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

/** Directory link whose target resolves (junction / symlink). */
const linkNode: VisibleNode = {
  ...rootNode,
  name: "coding-workflow",
  path: "/ws/desktop-cc-gui/.claude/skills/coding-workflow",
  depth: 2,
  expanded: false,
  isLink: true,
  linkBroken: false,
  linkTarget: "D:\\AI\\my-skills\\skills\\coding-workflow",
};

/** Dangling link: target gone, so it can neither be opened nor expanded. */
const brokenLinkNode: VisibleNode = {
  ...linkNode,
  name: "dangling",
  path: "/ws/desktop-cc-gui/.claude/skills/dangling",
  linkBroken: true,
  linkTarget: null,
};

describe("TreeRow tree refresh", () => {
  let container: HTMLDivElement;
  let root: Root;
  const refreshTree = vi.fn(async () => {});
  const onToggleDir = vi.fn();
  const onMention = vi.fn();

  beforeEach(() => {
    refreshTree.mockClear();
    onToggleDir.mockClear();
    onMention.mockClear();
    onOpenFile.mockClear();
    onSelectDir.mockClear();
    useFilesStore.setState({ refreshTree });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const onOpenFile = vi.fn();
  const onSelectDir = vi.fn();

  function render(node: VisibleNode, isRoot: boolean) {
    act(() => {
      root.render(
        <TreeRow
          node={node}
          selected={false}
          isRoot={isRoot}
          onToggleDir={onToggleDir}
          onOpenFile={onOpenFile}
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

  it("a directory link renders a badge whose title is the resolved target", () => {
    render(linkNode, false);
    // A backslash path cannot go through a CSS attribute selector (it would
    // be read as an escape), so compare the title attribute directly.
    const badge = [...container.querySelectorAll("[title]")].find(
      (el) => el.getAttribute("title") === linkNode.linkTarget,
    );
    expect(badge).not.toBeNull();
    // Resolved link: opens/expands normally, so it is still clickable.
    act(() => {
      container.querySelector<HTMLButtonElement>("button")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(onToggleDir).toHaveBeenCalledWith(linkNode.path);
  });

  it("a dangling link is inert: dead-target badge, click does nothing", () => {
    render(brokenLinkNode, false);
    // The badge explains why: "target missing" (zh) in warning color.
    expect(container.textContent).toContain("目标不存在");
    act(() => {
      container.querySelector<HTMLButtonElement>("button")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(onToggleDir).not.toHaveBeenCalled();
    expect(onOpenFile).not.toHaveBeenCalled();
    expect(onSelectDir).not.toHaveBeenCalled();
  });
});
