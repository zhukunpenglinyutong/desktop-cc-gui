import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { workspaceMenuRegistry, type Disposer } from "@ccgui/plugin-sdk";
import i18n from "@/lib/i18n";
import { useChatStore } from "@/features/chat/store";
import { WorkspaceContextMenu } from "./workspace-context-menu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Registered workspace-menu entries are foreign code rendered inside the
 *  host's sidebar menu. These cover the isolation contract: a crashing entry
 *  must not take the builtin actions down with it, the status parenthetical
 *  must stay token-driven, and an extension-only menu must not outlive its
 *  last owner. */
describe("workspace menu plugin isolation", () => {
  let container: HTMLDivElement;
  let root: Root;
  let disposers: Disposer[];
  const menu = { x: 10, y: 10, workspaceId: "menu-workspace", archived: false };

  beforeEach(() => {
    disposers = [];
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    for (const dispose of disposers) dispose();
    vi.restoreAllMocks();
  });

  function menuItems(): HTMLButtonElement[] {
    return [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
  }

  it("keeps the workspace alias action usable when a plugin icon crashes", () => {
    const BrokenIcon = () => {
      throw new Error("plugin icon failed");
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    disposers.push(
      workspaceMenuRegistry.register({
        id: "plugin:workspace-icon-test:broken",
        label: () => "Plugin action",
        icon: BrokenIcon,
        onSelect: () => {},
      }),
    );
    let renamed = false;
    act(() =>
      root.render(
        <WorkspaceContextMenu
          menu={menu}
          onClose={() => {}}
          onSetAlias={() => {
            renamed = true;
          }}
        />,
      ),
    );

    const alias = menuItems().find(
      (button) => button.textContent === i18n.t("chat.setWorkspaceAlias"),
    );
    expect(alias).toBeDefined();
    act(() => alias!.click());
    expect(renamed).toBe(true);
    // The crashing icon falls back to the generic glyph instead of unmounting
    // the row, so the plugin entry is still selectable.
    expect(menuItems().some((button) => button.textContent === "Plugin action")).toBe(true);
  });

  it("drops only the entry whose label throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    disposers.push(
      workspaceMenuRegistry.register({
        id: "plugin:workspace-label-test:broken",
        label: () => {
          throw new Error("label failed");
        },
        onSelect: () => {},
      }),
      workspaceMenuRegistry.register({
        id: "plugin:workspace-label-test:healthy",
        label: () => "Healthy action",
        onSelect: () => {},
      }),
    );
    act(() => root.render(<WorkspaceContextMenu menu={menu} onClose={() => {}} />));

    expect(menuItems().map((button) => button.textContent)).toEqual(["Healthy action"]);
  });

  it("renders the workspace status in a colored parenthetical", () => {
    disposers.push(
      workspaceMenuRegistry.register({
        id: "plugin:workspace-status-test:action",
        label: () => ({ text: "CCB", status: { text: "已启用", tone: "success" } }),
        onSelect: () => {},
      }),
    );
    act(() => root.render(<WorkspaceContextMenu menu={menu} onClose={() => {}} />));

    const item = menuItems().find((button) => button.textContent === "CCB (已启用)");
    expect(item).toBeDefined();
    const status = item!.querySelector("[data-workspace-menu-status]");
    expect(status?.textContent).toBe("(已启用)");
    expect(status?.className).toContain("text-notification-success-foreground");
  });

  it("passes the right-clicked workspace to onSelect, not the active one", () => {
    const targets: unknown[] = [];
    disposers.push(
      workspaceMenuRegistry.register({
        id: "plugin:workspace-target-test:action",
        label: () => "Plugin action",
        onSelect: (target) => targets.push(target),
      }),
    );
    act(() =>
      root.render(
        <WorkspaceContextMenu
          menu={{ x: 4, y: 4, workspaceId: "right-clicked", archived: true }}
          onClose={() => {}}
        />,
      ),
    );

    act(() => menuItems()[0]!.click());
    expect(targets).toEqual([{ workspaceId: "right-clicked", archived: true }]);
  });

  it("removes an open plugin-only menu when its last owner unloads", () => {
    const dispose = workspaceMenuRegistry.register({
      id: "plugin:workspace-unload-test:action",
      label: () => "Plugin action",
      onSelect: () => {},
    });
    disposers.push(dispose);
    let closed = false;
    act(() =>
      root.render(
        <WorkspaceContextMenu
          menu={menu}
          onClose={() => {
            closed = true;
          }}
        />,
      ),
    );
    expect(document.querySelector('[role="menu"]')).not.toBeNull();

    act(() => dispose());

    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(closed).toBe(true);
  });
});

/** 工作区多目录:右键菜单的「添加目录…」/「移除目录…」。移除入口只在确有
 *  附加根时出现——主目录恒不可移除,不给用户留点了报错的空入口。 */
describe("workspace menu multi-root entries", () => {
  const menu = { x: 10, y: 10, workspaceId: "menu-workspace", archived: false };
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    useChatStore.setState({ workspaces: [] });
  });

  function setWorkspace(roots: string[]) {
    useChatStore.setState({
      workspaces: [
        {
          id: "menu-workspace",
          path: "/ws/main",
          name: "main",
          lastOpenedAt: null,
          sortOrder: 0,
          groupId: null,
          roots,
        } as never,
      ],
    });
  }

  function menuItems(): HTMLButtonElement[] {
    return [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
  }
  function item(label: string) {
    return menuItems().find((b) => b.textContent === label);
  }

  it("有附加根时同时提供「添加目录…」与「移除目录…」", () => {
    setWorkspace(["/ws/extra"]);
    const onAddRoot = vi.fn();
    const onRemoveRoot = vi.fn();
    act(() =>
      root.render(
        <WorkspaceContextMenu
          menu={menu}
          onClose={() => {}}
          onAddRoot={onAddRoot}
          onRemoveRoot={onRemoveRoot}
        />,
      ),
    );
    const add = item(i18n.t("chat.addWorkspaceRoot"));
    const remove = item(i18n.t("chat.removeWorkspaceRoot"));
    expect(add).toBeDefined();
    expect(remove).toBeDefined();
    act(() => add!.click());
    expect(onAddRoot).toHaveBeenCalledWith("menu-workspace");
    act(() => remove!.click());
    expect(onRemoveRoot).toHaveBeenCalledWith("menu-workspace");
  });

  it("单目录工作区只有「添加目录…」,没有可移除项", () => {
    setWorkspace([]);
    act(() =>
      root.render(
        <WorkspaceContextMenu
          menu={menu}
          onClose={() => {}}
          onAddRoot={() => {}}
          onRemoveRoot={() => {}}
        />,
      ),
    );
    expect(item(i18n.t("chat.addWorkspaceRoot"))).toBeDefined();
    expect(item(i18n.t("chat.removeWorkspaceRoot"))).toBeUndefined();
  });

  it("归档行不提供附加根增删入口(仅取消归档)", () => {
    setWorkspace(["/ws/extra"]);
    act(() =>
      root.render(
        <WorkspaceContextMenu
          menu={{ ...menu, archived: true }}
          onClose={() => {}}
          onAddRoot={() => {}}
          onRemoveRoot={() => {}}
        />,
      ),
    );
    expect(item(i18n.t("chat.addWorkspaceRoot"))).toBeUndefined();
    expect(item(i18n.t("chat.removeWorkspaceRoot"))).toBeUndefined();
  });
});
