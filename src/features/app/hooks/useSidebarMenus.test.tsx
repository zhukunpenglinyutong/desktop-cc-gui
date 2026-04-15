// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorkspaceInfo } from "../../../types";
import { useSidebarMenus } from "./useSidebarMenus";

const mockMenuPopup = vi.fn<
  (items: Array<{ text: string; enabled?: boolean; action?: () => Promise<void> | void }>) => Promise<void>
>();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const dict: Record<string, string> = {
        "threads.rename": "Rename",
        "threads.autoName": "Auto name",
        "threads.autoNaming": "Auto naming",
        "threads.copyId": "Copy ID",
        "threads.size": "Size",
        "threads.syncFromServer": "Sync from server",
        "threads.pin": "Pin",
        "threads.unpin": "Unpin",
        "threads.delete": "Delete",
        "sidebar.sessionActionsGroup": "New session",
        "sidebar.newSharedSession": "Shared Session",
        "sidebar.workspaceActionsGroup": "Workspace actions",
        "workspace.engineClaudeCode": "Claude Code",
        "workspace.engineCodex": "Codex",
        "workspace.engineOpenCode": "OpenCode",
        "workspace.engineGemini": "Gemini",
        "threads.reloadThreads": "Reload threads",
        "sidebar.removeWorkspace": "Remove workspace",
        "sidebar.newWorktreeAgent": "New worktree agent",
        "sidebar.newCloneAgent": "New clone agent",
      };
      return dict[key] ?? key;
    },
  }),
}));

vi.mock("@tauri-apps/api/menu", () => ({
  Menu: {
    new: vi.fn(
      async ({
        items,
      }: {
        items: Array<{ text: string; enabled?: boolean; action?: () => Promise<void> | void }>;
      }) => ({
        popup: vi.fn(async () => {
          await mockMenuPopup(items);
        }),
      }),
    ),
  },
  MenuItem: { new: vi.fn(async (options: Record<string, unknown>) => options) },
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ scaleFactor: () => 1 }),
}));

vi.mock("@tauri-apps/api/dpi", () => ({
  LogicalPosition: class LogicalPosition {
    x: number;
    y: number;
    constructor(x: number, y: number) {
      this.x = x;
      this.y = y;
    }
  },
}));

const workspace: WorkspaceInfo = {
  id: "ws-1",
  name: "mossx",
  path: "/tmp/mossx",
  connected: true,
  kind: "main",
  settings: {
    sidebarCollapsed: false,
    worktreeSetupScript: null,
  },
};

function createHandlers() {
  return {
    onAddAgent: vi.fn(),
    onAddSharedAgent: vi.fn(),
    onDeleteThread: vi.fn(),
    onSyncThread: vi.fn(),
    onPinThread: vi.fn(),
    onUnpinThread: vi.fn(),
    isThreadPinned: vi.fn(() => false),
    isThreadAutoNaming: vi.fn(() => false),
    onRenameThread: vi.fn(),
    onAutoNameThread: vi.fn(),
    onReloadWorkspaceThreads: vi.fn(),
    onDeleteWorkspace: vi.fn(),
    onDeleteWorktree: vi.fn(),
    onAddWorktreeAgent: vi.fn(),
    onAddCloneAgent: vi.fn(),
  };
}

describe("useSidebarMenus", () => {
  it("shows Gemini entry as available in workspace plus menu", () => {
    const handlers = createHandlers();
    const { result } = renderHook(() => useSidebarMenus(handlers));

    act(() => {
      const event = {
        clientX: 160,
        clientY: 120,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as Parameters<typeof result.current.showWorkspaceMenu>[0];
      result.current.showWorkspaceMenu(
        event,
        workspace,
      );
    });

    const groups = result.current.workspaceMenuState?.groups ?? [];
    const geminiAction = groups
      .find((group) => group.id === "new-session")
      ?.actions.find((action) => action.id === "new-session-gemini");

    expect(geminiAction?.label).toBe("Gemini");
    expect(geminiAction?.unavailable).toBeUndefined();
  });

  it("triggers create action when Gemini entry is clicked", () => {
    const handlers = createHandlers();
    const { result } = renderHook(() => useSidebarMenus(handlers));

    act(() => {
      const event = {
        clientX: 200,
        clientY: 200,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as Parameters<typeof result.current.showWorkspaceMenu>[0];
      result.current.showWorkspaceMenu(
        event,
        workspace,
      );
    });

    const geminiAction = result.current.workspaceMenuState?.groups
      .find((group) => group.id === "new-session")
      ?.actions.find((action) => action.id === "new-session-gemini");

    expect(geminiAction).toBeTruthy();
    act(() => {
      result.current.onWorkspaceMenuAction(geminiAction!);
    });

    expect(handlers.onAddAgent).toHaveBeenCalledTimes(1);
    expect(handlers.onAddAgent).toHaveBeenCalledWith(workspace, "gemini");
  });

  it("inserts thread size between Copy ID and Delete in the thread context menu", async () => {
    const handlers = createHandlers();
    const { result } = renderHook(() => useSidebarMenus(handlers));

    await act(async () => {
      const event = {
        clientX: 240,
        clientY: 180,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as Parameters<typeof result.current.showThreadMenu>[0];
      await result.current.showThreadMenu(
        event,
        "ws-1",
        "thread-1",
        true,
        1536,
      );
    });

    expect(mockMenuPopup).toHaveBeenCalledTimes(1);
    const items = mockMenuPopup.mock.calls[0]?.[0] ?? [];
    expect(items.map((item) => item.text)).toEqual([
      "Rename",
      "Auto name",
      "Sync from server",
      "Pin",
      "Copy ID",
      "Size: 1.5 KB",
      "Delete",
    ]);
    expect(items[5]?.enabled).toBe(false);
  });

  it("triggers create action when Shared Session entry is clicked", () => {
    const handlers = createHandlers();
    const { result } = renderHook(() => useSidebarMenus(handlers));

    act(() => {
      const event = {
        clientX: 180,
        clientY: 180,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as Parameters<typeof result.current.showWorkspaceMenu>[0];
      result.current.showWorkspaceMenu(event, workspace);
    });

    const sharedAction = result.current.workspaceMenuState?.groups
      .find((group) => group.id === "new-session")
      ?.actions.find((action) => action.id === "new-session-shared");

    expect(sharedAction).toBeTruthy();
    act(() => {
      result.current.onWorkspaceMenuAction(sharedAction!);
    });

    expect(handlers.onAddSharedAgent).toHaveBeenCalledTimes(1);
    expect(handlers.onAddSharedAgent).toHaveBeenCalledWith(workspace);
  });
});
