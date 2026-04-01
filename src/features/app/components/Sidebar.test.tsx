// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { afterEach } from "vitest";

// Mock react-i18next
vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        "sidebar.addWorkspace": "Add workspace",
        "sidebar.toggleSearch": "Toggle search",
        "sidebar.searchProjects": "Search projects",
        "sidebar.quickNewThread": "New Thread",
        "sidebar.quickAutomation": "Automation",
        "sidebar.quickAutomationBadge": "new task!",
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
        "common.toggleTerminalPanel": "Toggle terminal panel",
        "git.logMode": "Git",
        "sidebar.releaseNotes": "Release Notes",
        "sidebar.comingSoon": "Coming soon",
        "sidebar.comingSoonMessage": "This feature is coming soon",
        "sidebar.threadsSection": "Threads",
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

import { Sidebar } from "./Sidebar";

afterEach(() => {
  cleanup();
});

const baseProps = {
  workspaces: [],
  groupedWorkspaces: [],
  hasWorkspaceGroups: false,
  deletingWorktreeIds: new Set<string>(),
  threadsByWorkspace: {},
  threadParentById: {},
  threadStatusById: {},
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
  onLoadOlderThreads: vi.fn(),
  onReloadWorkspaceThreads: vi.fn(),
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
  onOpenSpecHub: vi.fn(),
  onOpenWorkspaceHome: vi.fn(),
};

describe("Sidebar", () => {
  it("keeps search input hidden when search toggle is not present", () => {
    render(<Sidebar {...baseProps} />);

    expect(screen.queryByRole("button", { name: "Toggle search" })).toBeNull();
    expect(screen.queryByLabelText("Search projects")).toBeNull();
  });

  it("hides quick skills entry", () => {
    render(<Sidebar {...baseProps} />);
    expect(screen.queryByRole("button", { name: "Skills" })).toBeNull();
  });

  it("renders quick nav and workspace list containers", () => {
    const { container } = render(<Sidebar {...baseProps} />);

    expect(container.querySelector(".sidebar-primary-nav")).toBeTruthy();
    expect(container.querySelector(".sidebar-quick-icon-strip")).toBeNull();
    expect(container.querySelector(".sidebar-content-column")).toBeTruthy();
    expect(container.querySelector(".workspace-list")).toBeTruthy();
    expect(container.querySelector(".sidebar-section-title-icon-image")).toBeNull();
  });

  it("shows search entry and triggers callback", () => {
    const onOpenGlobalSearch = vi.fn();
    render(
      <Sidebar
        {...baseProps}
        onOpenGlobalSearch={onOpenGlobalSearch}
      />,
    );

    const searchButton = screen.getByRole("button", { name: "Search" });
    fireEvent.click(searchButton);

    expect(onOpenGlobalSearch).toHaveBeenCalledTimes(1);
  });

  it("shows Windows-friendly shortcut label for quick search", () => {
    const originalPlatform = window.navigator.platform;
    Object.defineProperty(window.navigator, "platform", {
      value: "Win32",
      configurable: true,
    });
    try {
      render(<Sidebar {...baseProps} />);
      expect(screen.getByText("Ctrl+F")).toBeTruthy();
    } finally {
      Object.defineProperty(window.navigator, "platform", {
        value: originalPlatform,
        configurable: true,
      });
    }
  });

  it("hides chat/automation/open-home entries in settings dropdown", () => {
    const onToggleTerminal = vi.fn();
    const { container } = render(
      <Sidebar
        {...baseProps}
        showTerminalButton
        isTerminalOpen={false}
        onToggleTerminal={onToggleTerminal}
      />,
    );

    const settingsToggle = container.querySelector(".sidebar-primary-nav-item-bottom");
    expect(settingsToggle).toBeTruthy();
    fireEvent.click(settingsToggle as Element);

    const dropdown = container.querySelector(".sidebar-settings-dropdown");
    expect(dropdown).toBeTruthy();
    const menu = within(dropdown as HTMLElement);

    expect(menu.queryByRole("menuitem", { name: "New Thread" })).toBeNull();
    expect(menu.queryByRole("menuitem", { name: "Automation" })).toBeNull();
    const skillsEntry = menu.getByRole("menuitem", { name: "Skills" });
    expect((skillsEntry as HTMLButtonElement).disabled).toBe(true);
    expect(menu.getByRole("menuitem", { name: "Lock" })).toBeTruthy();
    expect(menu.getByRole("menuitem", { name: "Long-term Memory" })).toBeTruthy();
    expect(menu.getByRole("menuitem", { name: "Spec Hub" })).toBeTruthy();
    expect(menu.getByRole("menuitem", { name: "Project Memory" })).toBeTruthy();
    expect(menu.getByRole("menuitem", { name: "Release Notes" })).toBeTruthy();
    expect(menu.queryByRole("menuitem", { name: "Terminal" })).toBeNull();
    expect(menu.getByRole("menuitem", { name: "Git" })).toBeTruthy();
    expect(menu.queryByRole("menuitem", { name: "Open home" })).toBeNull();
  });

  it("shows pinned threads even when pinned version is zero", () => {
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
    const thread = {
      id: "thread-1",
      name: "Pinned Restored",
      updatedAt: 123,
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
        threadsByWorkspace={{ "ws-1": [thread] }}
        getPinTimestamp={(workspaceId, threadId) =>
          workspaceId === "ws-1" && threadId === "thread-1" ? 111 : null
        }
        isThreadPinned={(workspaceId, threadId) =>
          workspaceId === "ws-1" && threadId === "thread-1"
        }
      />,
    );

    expect(screen.getByText("Pinned Restored")).toBeTruthy();
  });

  it("removes newly pinned thread from project list immediately", () => {
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
    const thread = {
      id: "thread-1",
      name: "Pin Me",
      updatedAt: 123,
    };
    let isPinned = false;
    const getPinTimestamp = (workspaceId: string, threadId: string) =>
      workspaceId === "ws-1" && threadId === "thread-1" && isPinned ? 111 : null;
    const isThreadPinned = (workspaceId: string, threadId: string) =>
      workspaceId === "ws-1" && threadId === "thread-1" && isPinned;

    const { rerender } = render(
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
        threadsByWorkspace={{ "ws-1": [thread] }}
        getPinTimestamp={getPinTimestamp}
        isThreadPinned={isThreadPinned}
        pinnedThreadsVersion={0}
      />,
    );

    expect(screen.getAllByText("Pin Me")).toHaveLength(1);

    isPinned = true;
    rerender(
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
        threadsByWorkspace={{ "ws-1": [thread] }}
        getPinTimestamp={getPinTimestamp}
        isThreadPinned={isThreadPinned}
        pinnedThreadsVersion={1}
      />,
    );

    expect(screen.getAllByText("Pin Me")).toHaveLength(1);
  });

  it("adds running animation class to project icon when any session is processing", () => {
    const workspace = {
      id: "ws-root",
      name: "codemoss",
      path: "/tmp/codemoss",
      connected: true,
      kind: "main" as const,
      settings: {
        sidebarCollapsed: false,
        worktreeSetupScript: null,
      },
    };
    const worktree = {
      id: "ws-worktree",
      name: "codemoss/worktree",
      path: "/tmp/codemoss-worktree",
      connected: true,
      parentId: "ws-root",
      kind: "worktree" as const,
      settings: {
        sidebarCollapsed: false,
        worktreeSetupScript: null,
      },
      worktree: {
        branch: "feature/running",
      },
    };
    const runningThread = {
      id: "thread-running",
      name: "Running thread",
      updatedAt: 123,
    };

    const { container } = render(
      <Sidebar
        {...baseProps}
        workspaces={[workspace, worktree]}
        groupedWorkspaces={[
          {
            id: null,
            name: "Ungrouped",
            workspaces: [workspace],
          },
        ]}
        threadsByWorkspace={{ "ws-worktree": [runningThread] }}
        threadStatusById={{
          "thread-running": { isProcessing: true, hasUnread: false, isReviewing: false },
        }}
      />,
    );

    const rootWorkspaceCard = container.querySelector(".workspace-card");
    const projectIcon = rootWorkspaceCard?.querySelector(".workspace-folder-btn");
    expect(projectIcon?.classList.contains("is-session-running")).toBe(true);
    const worktreeIcon = container.querySelector(".worktree-node-icon");
    expect(worktreeIcon?.classList.contains("is-session-running")).toBe(true);
  });

  it("keeps group collapse on double click only", () => {
    const workspace = {
      id: "ws-1",
      name: "codemoss",
      path: "/tmp/codemoss",
      connected: true,
      kind: "main" as const,
      settings: {
        sidebarCollapsed: true,
        worktreeSetupScript: null,
      },
    };

    const { container } = render(
      <Sidebar
        {...baseProps}
        workspaces={[workspace]}
        groupedWorkspaces={[
          {
            id: "group-1",
            name: "Group One",
            workspaces: [workspace],
          },
        ]}
      />,
    );

    const groupHeader = container.querySelector(".workspace-group-header") as HTMLElement | null;
    expect(groupHeader).toBeTruthy();
    if (!groupHeader) {
      throw new Error("Expected workspace group header");
    }
    expect(screen.getByText("codemoss")).toBeTruthy();

    fireEvent.click(groupHeader);
    expect(screen.getByText("codemoss")).toBeTruthy();

    fireEvent.doubleClick(groupHeader);
    expect(screen.queryByText("codemoss")).toBeNull();
  });

  it("selects workspace on single click and toggles collapse on double click", () => {
    const workspace = {
      id: "ws-1",
      name: "codemoss",
      path: "/tmp/codemoss",
      connected: true,
      kind: "main" as const,
      settings: {
        sidebarCollapsed: true,
        worktreeSetupScript: null,
      },
    };
    const onSelectWorkspace = vi.fn();
    const onToggleWorkspaceCollapse = vi.fn();

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
        onSelectWorkspace={onSelectWorkspace}
        onToggleWorkspaceCollapse={onToggleWorkspaceCollapse}
      />,
    );

    const workspaceLabel = screen.getByText("codemoss");

    fireEvent.click(workspaceLabel);
    expect(onSelectWorkspace).toHaveBeenCalledWith("ws-1");
    expect(onToggleWorkspaceCollapse).not.toHaveBeenCalled();

    fireEvent.doubleClick(workspaceLabel);
    expect(onToggleWorkspaceCollapse).toHaveBeenCalledWith("ws-1", false);
  });
});
