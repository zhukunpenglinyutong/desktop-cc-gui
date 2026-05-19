// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { afterEach } from "vitest";
import {
  getClientStoreSync,
  writeClientStoreData,
} from "../../../services/clientStorage";
import {
  assignWorkspaceSessionFolder,
  createWorkspaceSessionFolder,
  deleteWorkspaceSessionFolder,
  listWorkspaceSessionFolders,
  renameWorkspaceSessionFolder,
} from "../../../services/tauri";
import { pushErrorToast } from "../../../services/toasts";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        "sidebar.addWorkspace": "Add workspace",
        "common.cancel": "Cancel",
        "common.delete": "Delete",
        "sidebar.sessionActionsGroup": "New Session",
        "sidebar.newSessionInFolder": "New session in project",
        "sidebar.toggleSearch": "Toggle search",
        "sidebar.searchProjects": "Search projects",
        "sidebar.activateWorkspace": "Open in main panel",
        "sidebar.setWorkspaceAlias": "Set alias",
        "sidebar.workspaceAliasPrompt": "Alias prompt",
        "sidebar.workspaceAliasBadge": "A",
        "sidebar.workspaceAliasBadgeTitle": "Workspace alias. Original name: service",
        "sidebar.emptyWorkspaceSessions": "No sessions yet.",
        "sidebar.newSessionFolder": "New folder",
        "sidebar.newSessionFolderIn": "New folder in project",
        "sidebar.renameSessionFolder": "Rename folder",
        "sidebar.deleteSessionFolder": "Delete folder",
        "sidebar.sessionFolderActions": "Folder actions",
        "sidebar.collapseSessionFolder": "Collapse folder",
        "sidebar.expandSessionFolder": "Expand folder",
        "sidebar.sessionFolderContextMenuPrompt": "Type an action",
        "sidebar.sessionFolderNamePrompt": "Folder name",
        "sidebar.sessionFolderRenamePrompt": "Rename folder",
        "sidebar.sessionFolderDeleteTitle": "Delete folder",
        "sidebar.sessionFolderDeleteMessage": "Delete folder message",
        "sidebar.sessionFolderDeleteHint": "Clear non-empty folders first.",
        "sidebar.sessionFolderCreateFailed": "Could not create folder",
        "sidebar.sessionFolderRenameFailed": "Could not rename folder",
        "sidebar.sessionFolderDeleteFailed": "Could not delete folder",
        "sidebar.sessionFolderMoveFailed": "Could not move session",
        "sidebar.sessionFolderCrossProjectBlocked": "Sessions cannot be moved across projects.",
        "sidebar.sessionFolderCount": "session count",
        "sidebar.sessionFolderLoadFailed": "Session folders unavailable.",
        "sidebar.quickNewThread": "Home",
        "sidebar.quickAutomation": "Automation",
        "sidebar.quickSearch": "Search",
        "sidebar.quickSkills": "Skills",
        "lockScreen.lock": "Lock",
        "sidebar.projects": "Projects",
        "sidebar.mcpSkillsMarket": "MCP & Skills Market",
        "sidebar.longTermMemory": "Long-term Memory",
        "sidebar.pluginMarket": "Plugin Market",
        "sidebar.specHub": "Spec Hub",
        "sidebar.openHome": "Open home",
        "panels.memory": "Project Memory",
        "common.terminal": "Terminal",
        "common.refresh": "Refresh",
        "common.toggleTerminalPanel": "Toggle terminal panel",
        "git.logMode": "Git",
        "sidebar.releaseNotes": "Release Notes",
        "sidebar.comingSoon": "Coming soon",
        "sidebar.comingSoonMessage": "This feature is coming soon",
        "sidebar.threadsSection": "Threads",
        "threads.degradedWorkspaceRefreshAriaLabel": "Refresh incomplete thread list",
        "threads.degradedWorkspaceRefreshTooltip":
          "This project's thread list is not fully refreshed yet and may be missing some conversations. Click to refresh it again.",
        "threads.hideExitedSessions": "Hide exited sessions",
        "threads.showExitedSessions": "Show exited sessions",
        "threads.exitedSessionsHidden": "{{count}} exited hidden",
        "threads.subagentTreeExpanded": "Subagent tree expanded",
        "threads.subagentTreeExpand": "Expand subagent tree",
        "threads.subagentTreeCollapse": "Collapse subagent tree",
        "threads.moveToFolder": "Move to folder",
        "threads.moveToProjectRoot": "Project root",
        "threads.searchFolderTargets": "Search folders...",
        "threads.more": "More...",
        "threads.loading": "Loading...",
        "threads.searchOlder": "Search older...",
        "threads.loadOlder": "Load older...",
        "workspace.engineClaudeCode": "Claude Code",
        "workspace.engineCodex": "Codex",
        "workspace.engineOpenCode": "OpenCode",
        "workspace.engineGemini": "Gemini",
        "sidebar.cliNotInstalled": "CLI not installed",
        "settings.title": "Settings",
        "tabbar.primaryNavigation": "Primary navigation",
      };
      return translations[key] ?? key;
    },
    i18n: {
      language: "en",
      changeLanguage: vi.fn(),
    },
  }),
}));

vi.mock("../../../services/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../services/tauri")>();
  return {
    ...actual,
    assignWorkspaceSessionFolder: vi.fn(),
    createWorkspaceSessionFolder: vi.fn(),
    deleteWorkspaceSessionFolder: vi.fn(),
    listWorkspaceSessionFolders: vi.fn(),
    renameWorkspaceSessionFolder: vi.fn(),
  };
});

vi.mock("../../../services/toasts", () => ({
  pushErrorToast: vi.fn(),
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

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({
    children,
    viewportRef,
    onViewportScroll,
    className,
  }: {
    children: React.ReactNode;
    viewportRef?: React.Ref<HTMLDivElement>;
    onViewportScroll?: React.UIEventHandler<HTMLDivElement>;
    className?: string;
  }) => (
    <div className={className} onScroll={onViewportScroll} ref={viewportRef}>
      {children}
    </div>
  ),
  ScrollBar: () => null,
}));

import { Sidebar } from "./Sidebar";

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
  writeClientStoreData("threads", {});
  writeClientStoreData("layout", {});
  vi.mocked(listWorkspaceSessionFolders).mockResolvedValue({
    workspaceId: "default",
    folders: [],
  });
  vi.mocked(assignWorkspaceSessionFolder).mockResolvedValue({
    sessionId: "default-session",
    folderId: null,
  });
  vi.mocked(createWorkspaceSessionFolder).mockResolvedValue({
    folder: {
      id: "created-folder",
      workspaceId: "default",
      parentId: null,
      name: "Created",
      createdAt: 1,
      updatedAt: 1,
    },
  });
  vi.mocked(renameWorkspaceSessionFolder).mockResolvedValue({
    folder: {
      id: "renamed-folder",
      workspaceId: "default",
      parentId: null,
      name: "Renamed",
      createdAt: 1,
      updatedAt: 2,
    },
  });
  vi.mocked(deleteWorkspaceSessionFolder).mockResolvedValue(undefined);
});

const baseProps = {
  workspaces: [],
  groupedWorkspaces: [],
  hasWorkspaceGroups: false,
  deletingWorktreeIds: new Set<string>(),
  threadsByWorkspace: {},
  activeItems: [],
  threadParentById: {},
  threadStatusById: {},
  hydratedThreadListWorkspaceIds: new Set<string>(),
  threadListLoadingByWorkspace: {},
  threadListPagingByWorkspace: {},
  threadListCursorByWorkspace: {},
  activeWorkspaceId: null,
  activeThreadId: null,
  accountRateLimits: null,
  usageShowRemaining: false,
  accountInfo: null,
  onSwitchAccount: vi.fn(),
  onCancelSwitchAccount: vi.fn(),
  accountSwitching: false,
  onOpenSettings: vi.fn(),
  onOpenDebug: vi.fn(),
  showDebugButton: false,
  onAddWorkspace: vi.fn(),
  onSelectHome: vi.fn(),
  onSelectWorkspace: vi.fn(),
  onConnectWorkspace: vi.fn(),
  onAddAgent: vi.fn(),
  onAddWorktreeAgent: vi.fn(),
  onAddCloneAgent: vi.fn(),
  onToggleWorkspaceCollapse: vi.fn(),
  onSelectThread: vi.fn(),
  onDeleteThread: vi.fn(),
  onArchiveThread: vi.fn(),
  onSyncThread: vi.fn(),
  pinThread: vi.fn(() => false),
  unpinThread: vi.fn(),
  isThreadPinned: vi.fn(() => false),
  isThreadAutoNaming: vi.fn(() => false),
  getPinTimestamp: vi.fn(() => null),
  pinnedThreadsVersion: 0,
  onRenameThread: vi.fn(),
  onAutoNameThread: vi.fn(),
  onDeleteWorkspace: vi.fn(),
  onDeleteWorktree: vi.fn(),
  onRenameWorkspaceAlias: vi.fn(),
  onLoadOlderThreads: vi.fn(),
  onReloadWorkspaceThreads: vi.fn(),
  onQuickReloadWorkspaceThreads: vi.fn(),
  workspaceDropTargetRef: createRef<HTMLElement>(),
  isWorkspaceDropActive: false,
  workspaceDropText: "Drop Project Here",
  onWorkspaceDragOver: vi.fn(),
  onWorkspaceDragEnter: vi.fn(),
  onWorkspaceDragLeave: vi.fn(),
  onWorkspaceDrop: vi.fn(),
  appMode: "chat" as const,
  onAppModeChange: vi.fn(),
  onOpenHomeChat: vi.fn(),
  onOpenMemory: vi.fn(),
  onLockPanel: vi.fn(),
  onOpenProjectMemory: vi.fn(),
  onOpenReleaseNotes: vi.fn(),
  onOpenGlobalSearch: vi.fn(),
  globalSearchShortcut: "cmd+o",
  openChatShortcut: "cmd+j",
  openKanbanShortcut: "cmd+k",
  onOpenSpecHub: vi.fn(),
  onOpenWorkspaceHome: vi.fn(),
};

describe("Sidebar workspace session folders", () => {
  it("creates a root workspace session folder with an inline draft input", async () => {
    vi.mocked(listWorkspaceSessionFolders)
      .mockResolvedValueOnce({
        workspaceId: "ws-1",
        folders: [],
      })
      .mockResolvedValueOnce({
        workspaceId: "ws-1",
        folders: [
          {
            id: "folder-root",
            workspaceId: "ws-1",
            parentId: null,
            name: "Inbox",
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      });
    vi.mocked(renameWorkspaceSessionFolder).mockResolvedValueOnce({
      folder: {
        id: "folder-parent",
        workspaceId: "ws-1",
        parentId: null,
        name: "Roadmap",
        createdAt: 1,
        updatedAt: 2,
      },
    });
    const workspace = {
      id: "ws-1",
      name: "codemoss",
      path: "/tmp/codemoss",
      connected: true,
      kind: "main" as const,
      settings: {
        sidebarCollapsed: false,
        worktreeSetupScript: null,
      },
    };

    render(
      <Sidebar
        {...baseProps}
        workspaces={[workspace]}
        groupedWorkspaces={[
          {
            id: null,
            name: "Ungrouped",
            workspaces: [workspace],
          },
        ]}
        threadsByWorkspace={{
          "ws-1": [{ id: "root-session", name: "Root session", updatedAt: 3 }],
        }}
        hydratedThreadListWorkspaceIds={new Set(["ws-1"])}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "New folder" }));
    const draftInput = screen.getByLabelText("Folder name");
    fireEvent.change(draftInput, { target: { value: " Inbox " } });
    fireEvent.keyDown(draftInput, { key: "Enter" });

    expect(createWorkspaceSessionFolder).toHaveBeenCalledWith("ws-1", "Inbox", null);
    expect(await screen.findByText("Inbox")).toBeTruthy();
  });

  it("opens child folder creation from the folder row keyboard action", async () => {
    vi.mocked(listWorkspaceSessionFolders)
      .mockResolvedValueOnce({
        workspaceId: "ws-1",
        folders: [
          {
            id: "folder-parent",
            workspaceId: "ws-1",
            parentId: null,
            name: "Planning",
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      })
      .mockResolvedValueOnce({
        workspaceId: "ws-1",
        folders: [
          {
            id: "folder-parent",
            workspaceId: "ws-1",
            parentId: null,
            name: "Planning",
            createdAt: 1,
            updatedAt: 1,
          },
          {
            id: "folder-child",
            workspaceId: "ws-1",
            parentId: "folder-parent",
            name: "Keyboard child",
            createdAt: 2,
            updatedAt: 2,
          },
        ],
      });
    const workspace = {
      id: "ws-1",
      name: "codemoss",
      path: "/tmp/codemoss",
      connected: true,
      kind: "main" as const,
      settings: {
        sidebarCollapsed: false,
        worktreeSetupScript: null,
      },
    };

    render(
      <Sidebar
        {...baseProps}
        workspaces={[workspace]}
        groupedWorkspaces={[
          {
            id: null,
            name: "Ungrouped",
            workspaces: [workspace],
          },
        ]}
        threadsByWorkspace={{
          "ws-1": [{ id: "root-session", name: "Root session", updatedAt: 3 }],
        }}
        hydratedThreadListWorkspaceIds={new Set(["ws-1"])}
      />,
    );

    const folderRow = await screen.findByRole("treeitem", { name: "Planning" });
    fireEvent.keyDown(folderRow, { key: "Enter" });
    fireEvent.change(screen.getByLabelText("Folder name"), {
      target: { value: "Keyboard child" },
    });
    fireEvent.keyDown(screen.getByLabelText("Folder name"), { key: "Enter" });

    expect(createWorkspaceSessionFolder).toHaveBeenCalledWith(
      "ws-1",
      "Keyboard child",
      "folder-parent",
    );
    expect(await screen.findByText("Keyboard child")).toBeTruthy();
  });

  it("supports collapsing folders and right-click rename/delete actions", async () => {
    vi.mocked(listWorkspaceSessionFolders)
      .mockResolvedValueOnce({
        workspaceId: "ws-1",
        folders: [
          {
            id: "folder-parent",
            workspaceId: "ws-1",
            parentId: null,
            name: "Planning",
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      })
      .mockResolvedValueOnce({
        workspaceId: "ws-1",
        folders: [
          {
            id: "folder-parent",
            workspaceId: "ws-1",
            parentId: null,
            name: "撒大大",
            createdAt: 1,
            updatedAt: 2,
          },
        ],
      });
    vi.mocked(renameWorkspaceSessionFolder).mockResolvedValueOnce({
      folder: {
        id: "folder-parent",
        workspaceId: "ws-1",
        parentId: null,
        name: "撒大大",
        createdAt: 1,
        updatedAt: 2,
      },
    });
    const workspace = {
      id: "ws-1",
      name: "codemoss",
      path: "/tmp/codemoss",
      connected: true,
      kind: "main" as const,
      settings: {
        sidebarCollapsed: false,
        worktreeSetupScript: null,
      },
    };
    render(
      <Sidebar
        {...baseProps}
        workspaces={[workspace]}
        groupedWorkspaces={[
          {
            id: null,
            name: "Ungrouped",
            workspaces: [workspace],
          },
        ]}
        threadsByWorkspace={{
          "ws-1": [
            {
              id: "folder-session",
              name: "Folder session",
              updatedAt: 2,
              folderId: "folder-parent",
            },
          ],
        }}
        hydratedThreadListWorkspaceIds={new Set(["ws-1"])}
      />,
    );

    const folderRow = await screen.findByRole("treeitem", { name: "Planning" });
    expect(screen.getByText("Folder session")).toBeTruthy();
    fireEvent.click(folderRow);
    expect(screen.queryByText("Folder session")).toBeNull();
    fireEvent.click(folderRow);
    expect(screen.getByText("Folder session")).toBeTruthy();
    fireEvent.click(within(folderRow).getByRole("button", { name: "Collapse folder" }));
    expect(screen.queryByText("Folder session")).toBeNull();
    fireEvent.click(within(folderRow).getByRole("button", { name: "Expand folder" }));
    expect(screen.getByText("Folder session")).toBeTruthy();

    fireEvent.contextMenu(folderRow);
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename folder" }));
    const renameInput = screen.getByDisplayValue("Planning");
    fireEvent.change(renameInput, { target: { value: " 撒大大 " } });
    fireEvent.keyDown(renameInput, { key: "Enter" });

    expect(renameWorkspaceSessionFolder).toHaveBeenCalledWith(
      "ws-1",
      "folder-parent",
      "撒大大",
    );
    const renamedFolder = await screen.findByRole("treeitem", { name: "撒大大" });
    const renamedFolderGroup = renamedFolder.closest(".workspace-session-folder-group");
    expect(renamedFolderGroup).toBeTruthy();
    expect(within(renamedFolderGroup as HTMLElement).getByText("Folder session")).toBeTruthy();
  });

  it("restores persisted folder collapse state and drops deleted folder ids", async () => {
    writeClientStoreData("layout", {
      "workspaceSessionFolders.collapsedByWorkspaceId": {
        "ws-1": ["folder-parent", "deleted-folder"],
      },
    });
    vi.mocked(listWorkspaceSessionFolders).mockResolvedValueOnce({
      workspaceId: "ws-1",
      folders: [
        {
          id: "folder-parent",
          workspaceId: "ws-1",
          parentId: null,
          name: "Planning",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    const workspace = {
      id: "ws-1",
      name: "codemoss",
      path: "/tmp/codemoss",
      connected: true,
      kind: "main" as const,
      settings: {
        sidebarCollapsed: false,
        worktreeSetupScript: null,
      },
    };

    render(
      <Sidebar
        {...baseProps}
        workspaces={[workspace]}
        groupedWorkspaces={[
          {
            id: null,
            name: "Ungrouped",
            workspaces: [workspace],
          },
        ]}
        threadsByWorkspace={{
          "ws-1": [
            {
              id: "folder-session",
              name: "Folder session",
              updatedAt: 2,
              folderId: "folder-parent",
            },
          ],
        }}
        hydratedThreadListWorkspaceIds={new Set(["ws-1"])}
      />,
    );

    const folderRow = await screen.findByRole("treeitem", { name: "Planning" });
    expect(screen.queryByText("Folder session")).toBeNull();
    expect(
      getClientStoreSync("layout", "workspaceSessionFolders.collapsedByWorkspaceId"),
    ).toEqual({
      "ws-1": ["folder-parent"],
    });

    fireEvent.click(within(folderRow).getByRole("button", { name: "Expand folder" }));
    expect(screen.getByText("Folder session")).toBeTruthy();
    expect(
      getClientStoreSync("layout", "workspaceSessionFolders.collapsedByWorkspaceId"),
    ).toEqual({});
  });

  it("filters large folder move targets in a current-project picker while keeping root reachable", async () => {
    const folders = Array.from({ length: 13 }, (_, index) => ({
      id: `folder-${index + 1}`,
      workspaceId: "ws-1",
      parentId: null,
      name: index === 11 ? "Needle" : `Current ${index + 1}`,
      createdAt: index + 1,
      updatedAt: index + 1,
    }));
    vi.mocked(listWorkspaceSessionFolders).mockResolvedValueOnce({
      workspaceId: "ws-1",
      folders,
    });
    vi.mocked(assignWorkspaceSessionFolder).mockResolvedValueOnce({
      sessionId: "thread-1",
      folderId: "folder-12",
    });
    const workspace = {
      id: "ws-1",
      name: "codemoss",
      path: "/tmp/codemoss",
      connected: true,
      kind: "main" as const,
      settings: {
        sidebarCollapsed: false,
        worktreeSetupScript: null,
      },
    };

    render(
      <Sidebar
        {...baseProps}
        workspaces={[workspace]}
        groupedWorkspaces={[
          {
            id: null,
            name: "Ungrouped",
            workspaces: [workspace],
          },
        ]}
        threadsByWorkspace={{
          "ws-1": [
            {
              id: "thread-1",
              name: "Thread one",
              updatedAt: 30,
              folderId: "folder-1",
            },
          ],
        }}
        hydratedThreadListWorkspaceIds={new Set(["ws-1"])}
      />,
    );

    expect(await screen.findByText("Needle")).toBeTruthy();
    const threadRow = await screen.findByText("Thread one");
    fireEvent.contextMenu(threadRow.closest(".thread-row") as HTMLElement);
    const threadMenu = await screen.findByRole("menu", { name: "threads.threadActions" });
    const searchFoldersItem = within(threadMenu).getByRole("menuitem", {
      name: "Search folders...",
    });
    await act(async () => {
      fireEvent.click(searchFoldersItem);
    });

    const picker = screen.getByRole("dialog", { name: "Move to folder" });
    expect(within(picker).getByRole("option", { name: "Project root" })).toBeTruthy();
    expect(within(picker).queryByText("Other project")).toBeNull();

    await act(async () => {
      fireEvent.change(within(picker).getByLabelText("Search folders..."), {
        target: { value: "needle" },
      });
    });

    expect(within(picker).getByRole("option", { name: "Project root" })).toBeTruthy();
    expect(within(picker).getByRole("option", { name: "Needle" })).toBeTruthy();
    expect(within(picker).queryByRole("option", { name: "Current 2" })).toBeNull();

    await act(async () => {
      fireEvent.click(within(picker).getByRole("option", { name: "Needle" }));
    });
    expect(assignWorkspaceSessionFolder).toHaveBeenCalledWith("ws-1", "thread-1", "folder-12");
  });

  it("keeps non-empty workspace session folders visible when backend blocks deletion", async () => {
    vi.mocked(listWorkspaceSessionFolders).mockResolvedValueOnce({
      workspaceId: "ws-1",
      folders: [
        {
          id: "folder-parent",
          workspaceId: "ws-1",
          parentId: null,
          name: "Planning",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    vi.mocked(deleteWorkspaceSessionFolder).mockRejectedValueOnce(
      new Error("folder is not empty; move or clear its contents first"),
    );
    const confirmSpy = vi.spyOn(window, "confirm");
    const workspace = {
      id: "ws-1",
      name: "codemoss",
      path: "/tmp/codemoss",
      connected: true,
      kind: "main" as const,
      settings: {
        sidebarCollapsed: false,
        worktreeSetupScript: null,
      },
    };

    render(
      <Sidebar
        {...baseProps}
        workspaces={[workspace]}
        groupedWorkspaces={[
          {
            id: null,
            name: "Ungrouped",
            workspaces: [workspace],
          },
        ]}
        threadsByWorkspace={{
          "ws-1": [
            {
              id: "folder-session",
              name: "Folder session",
              updatedAt: 2,
              folderId: "folder-parent",
            },
          ],
        }}
        hydratedThreadListWorkspaceIds={new Set(["ws-1"])}
      />,
    );

    expect(await screen.findByText("Planning")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete folder" }));

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(deleteWorkspaceSessionFolder).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Delete folder" })).toBeTruthy();
    expect(screen.getByText("Delete folder message")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(deleteWorkspaceSessionFolder).toHaveBeenCalledWith("ws-1", "folder-parent");
    expect(await screen.findByText("Planning")).toBeTruthy();
    expect(pushErrorToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Could not delete folder",
        message: "folder is not empty; move or clear its contents first",
      }),
    );
    confirmSpy.mockRestore();
  });

  it("keeps load older visible when workspace sessions are grouped by folders", async () => {
    vi.mocked(listWorkspaceSessionFolders).mockResolvedValueOnce({
      workspaceId: "ws-1",
      folders: [
        {
          id: "folder-target",
          workspaceId: "ws-1",
          parentId: null,
          name: "Planning",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    const workspace = {
      id: "ws-1",
      name: "codemoss",
      path: "/tmp/codemoss",
      connected: true,
      kind: "main" as const,
      settings: {
        sidebarCollapsed: false,
        worktreeSetupScript: null,
      },
    };
    const onLoadOlderThreads = vi.fn();

    render(
      <Sidebar
        {...baseProps}
        workspaces={[workspace]}
        groupedWorkspaces={[
          {
            id: null,
            name: "Ungrouped",
            workspaces: [workspace],
          },
        ]}
        threadsByWorkspace={{
          "ws-1": [{ id: "root-session", name: "Root session", updatedAt: 3 }],
        }}
        threadListCursorByWorkspace={{ "ws-1": "offset:200" }}
        hydratedThreadListWorkspaceIds={new Set(["ws-1"])}
        onLoadOlderThreads={onLoadOlderThreads}
      />,
    );

    expect(await screen.findByText("Planning")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Load older..." })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Load older..." }));

    expect(onLoadOlderThreads).toHaveBeenCalledWith("ws-1");
  });

  it("uses the workspace-specific root visibility count for the more button", async () => {
    const workspace = {
      id: "ws-1",
      name: "codemoss",
      path: "/tmp/codemoss",
      connected: true,
      kind: "main" as const,
      settings: {
        sidebarCollapsed: false,
        visibleThreadRootCount: 1,
      },
    };

    render(
      <Sidebar
        {...baseProps}
        workspaces={[workspace]}
        groupedWorkspaces={[
          {
            id: null,
            name: "Ungrouped",
            workspaces: [workspace],
          },
        ]}
        threadsByWorkspace={{
          "ws-1": [
            { id: "root-session-1", name: "Root session 1", updatedAt: 3 },
            { id: "root-session-2", name: "Root session 2", updatedAt: 2 },
          ],
        }}
        hydratedThreadListWorkspaceIds={new Set(["ws-1"])}
      />,
    );

    expect(await screen.findByText("Root session 1")).toBeTruthy();
    expect(screen.getByRole("button", { name: "More..." })).toBeTruthy();
  });
});
