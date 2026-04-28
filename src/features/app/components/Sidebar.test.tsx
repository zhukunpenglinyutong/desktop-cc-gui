// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
        "sidebar.sessionActionsGroup": "New Session",
        "sidebar.toggleSearch": "Toggle search",
        "sidebar.searchProjects": "Search projects",
        "sidebar.activateWorkspace": "Open in main panel",
        "sidebar.emptyWorkspaceSessions": "No sessions yet.",
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

  it("marks the macOS sidebar titlebar placeholder as a drag region", () => {
    const { container } = render(<Sidebar {...baseProps} />);

    const placeholder = container.querySelector(".sidebar-topbar-placeholder");
    expect(placeholder?.hasAttribute("data-tauri-drag-region")).toBe(true);
  });

  it("keeps the sidebar topbar shell draggable around injected controls", () => {
    const { container } = render(
      <Sidebar
        {...baseProps}
        topbarNode={
          <div data-testid="sidebar-topbar-interactive" data-tauri-drag-region="false">
            toggle
          </div>
        }
      />,
    );

    const placeholder = container.querySelector(".sidebar-topbar-placeholder");
    const content = container.querySelector(".sidebar-topbar-content");
    expect(placeholder?.hasAttribute("data-tauri-drag-region")).toBe(true);
    expect(content?.hasAttribute("data-tauri-drag-region")).toBe(true);
    expect(
      screen.getByTestId("sidebar-topbar-interactive").getAttribute("data-tauri-drag-region"),
    ).toBe("false");
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

  it("does not render an automation badge in the primary nav", () => {
    const { container } = render(<Sidebar {...baseProps} />);
    const automationButton = screen.getByRole("button", { name: "Automation" });

    expect(within(automationButton).queryByText("new task!")).toBeNull();
    expect(container.querySelector(".sidebar-primary-nav-badge")).toBeNull();
  });

  it("keeps Windows quick nav shortcuts in sync with configured settings while hiding J", () => {
    const originalPlatform = window.navigator.platform;
    Object.defineProperty(window.navigator, "platform", {
      value: "Win32",
      configurable: true,
    });
    try {
      const { container } = render(<Sidebar {...baseProps} />);
      expect(screen.queryByText("Ctrl+J")).toBeNull();
      expect(screen.getByText("Ctrl+K")).toBeTruthy();
      expect(screen.getByText("Ctrl+O")).toBeTruthy();
      expect(container.querySelectorAll(".sidebar-primary-nav .sidebar-primary-nav-shortcut")).toHaveLength(2);
      expect(screen.getByRole("button", { name: "Home" }).getAttribute("title")).toContain("Ctrl+J");
      expect(screen.getByRole("button", { name: "Automation" }).getAttribute("title")).toContain("Ctrl+K");
      expect(screen.getByRole("button", { name: "Search" }).getAttribute("title")).toContain("Ctrl+O");
    } finally {
      Object.defineProperty(window.navigator, "platform", {
        value: originalPlatform,
        configurable: true,
      });
    }
  });

  it("reflects cleared quick mode shortcuts in button hints", () => {
    const { container } = render(
      <Sidebar
        {...baseProps}
        openChatShortcut={null}
        openKanbanShortcut={null}
        globalSearchShortcut={null}
      />,
    );

    expect(screen.getByRole("button", { name: "Home" }).getAttribute("title")).toContain("Not set");
    const automationButton = screen.getByRole("button", { name: "Automation" });
    expect(automationButton.getAttribute("title")).toContain("Not set");
    expect(
      container.querySelector(".sidebar-primary-nav-mode-item .sidebar-primary-nav-shortcut")?.textContent,
    ).toBe("Not set");
    expect(screen.getByRole("button", { name: "Search" }).getAttribute("title")).toContain("Not set");
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

    expect(menu.queryByRole("menuitem", { name: "Home" })).toBeNull();
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

  it("keeps pinned and workspace thread rows aligned with thread summary titles", () => {
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
    const pinnedThread = {
      id: "thread-pinned",
      name: "项目分析",
      updatedAt: 500,
      engineSource: "codex" as const,
      isDegraded: true,
      partialSource: "local-session-scan-unavailable",
      degradedReason: "partial-thread-list",
    };
    const regularThread = {
      id: "thread-regular",
      name: "给我生成一张图",
      updatedAt: 400,
      engineSource: "codex" as const,
    };

    const { container } = render(
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
        threadsByWorkspace={{ "ws-1": [pinnedThread, regularThread] }}
        getPinTimestamp={(workspaceId, threadId) =>
          workspaceId === "ws-1" && threadId === "thread-pinned" ? 111 : null
        }
        isThreadPinned={(workspaceId, threadId) =>
          workspaceId === "ws-1" && threadId === "thread-pinned"
        }
        pinnedThreadsVersion={1}
      />,
    );

    const pinnedSection = container.querySelector(".sidebar-pinned-section");
    expect(pinnedSection).toBeTruthy();
    expect(within(pinnedSection as HTMLElement).getByText("项目分析")).toBeTruthy();

    const workspaceList = container.querySelector(".workspace-list");
    expect(workspaceList).toBeTruthy();
    expect(within(workspaceList as HTMLElement).getByText("给我生成一张图")).toBeTruthy();
    expect(screen.queryByText("Agent 20")).toBeNull();
    expect(screen.queryByText("Codex Session")).toBeNull();
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

  it("shows an empty session message instead of a loading skeleton for empty workspaces", () => {
    const workspace = {
      id: "ws-empty",
      name: "empty-workspace",
      path: "/tmp/empty-workspace",
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
        hydratedThreadListWorkspaceIds={new Set(["ws-empty"])}
        threadListLoadingByWorkspace={{ "ws-empty": true }}
      />,
    );

    expect(screen.getByText("No sessions yet.")).toBeTruthy();
    expect(screen.queryByLabelText("Loading agents")).toBeNull();
  });

  it("does not show the empty session message before the workspace thread list hydrates", () => {
    const workspace = {
      id: "ws-loading",
      name: "loading-workspace",
      path: "/tmp/loading-workspace",
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
        threadListLoadingByWorkspace={{ "ws-loading": true }}
      />,
    );

    expect(screen.queryByText("No sessions yet.")).toBeNull();
  });

  it("does not render workspace or worktree session count badges", () => {
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
        branch: "feature/countless",
      },
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
        runningSessionCountByWorkspaceId={{
          "ws-root": 13,
          "ws-worktree": 2,
        }}
        recentSessionCountByWorkspaceId={{
          "ws-root": 5,
          "ws-worktree": 3,
        }}
      />,
    );

    expect(container.querySelector(".workspace-session-signal")).toBeNull();
    expect(container.querySelector(".worktree-session-signal")).toBeNull();
  });

  it("renders a refresh icon on the workspace row when the thread list is incomplete", () => {
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
          "ws-root": [
            {
              id: "thread-1",
              name: "Alpha",
              updatedAt: 1000,
              isDegraded: true,
            },
          ],
        }}
      />,
    );

    expect(screen.getByRole("button", { name: "Refresh incomplete thread list" })).toBeTruthy();
  });

  it("bubbles worktree incomplete state up to the parent workspace row", () => {
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
        branch: "feature/incomplete",
      },
    };

    render(
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
        threadsByWorkspace={{
          "ws-worktree": [
            {
              id: "thread-1",
              name: "Alpha",
              updatedAt: 1000,
              partialSource: "local-session-scan-unavailable",
            },
          ],
        }}
      />,
    );

    expect(screen.getAllByRole("button", { name: "Refresh incomplete thread list" }).length).toBe(
      2,
    );
  });

  it("refreshes the degraded workspace directly from the refresh icon", () => {
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
    const onQuickReloadWorkspaceThreads = vi.fn();

    render(
      <Sidebar
        {...baseProps}
        onQuickReloadWorkspaceThreads={onQuickReloadWorkspaceThreads}
        workspaces={[workspace]}
        groupedWorkspaces={[
          {
            id: null,
            name: "Ungrouped",
            workspaces: [workspace],
          },
        ]}
        threadsByWorkspace={{
          "ws-root": [
            {
              id: "thread-1",
              name: "Alpha",
              updatedAt: 1000,
              isDegraded: true,
            },
          ],
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Refresh incomplete thread list" }));
    expect(onQuickReloadWorkspaceThreads).toHaveBeenCalledWith("ws-root");
  });

  it("shows a spinning refresh icon while degraded threads are reloading", () => {
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

    const { container } = render(
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
        threadListLoadingByWorkspace={{ "ws-root": true }}
        threadsByWorkspace={{
          "ws-root": [
            {
              id: "thread-1",
              name: "Alpha",
              updatedAt: 1000,
              isDegraded: true,
            },
          ],
        }}
      />,
    );

    expect(container.querySelector(".sidebar-refresh-icon.is-spinning")).toBeTruthy();
  });

  it("hides the degraded refresh action when no quick reload handler is available", () => {
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

    render(
      <Sidebar
        {...baseProps}
        onQuickReloadWorkspaceThreads={undefined}
        workspaces={[workspace]}
        groupedWorkspaces={[
          {
            id: null,
            name: "Ungrouped",
            workspaces: [workspace],
          },
        ]}
        threadsByWorkspace={{
          "ws-root": [
            {
              id: "thread-1",
              name: "Alpha",
              updatedAt: 1000,
              isDegraded: true,
            },
          ],
        }}
      />,
    );

    expect(screen.queryByRole("button", { name: "Refresh incomplete thread list" })).toBeNull();
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

  it("renders ungrouped projects without showing an ungrouped section header", () => {
    const ungroupedWorkspace = {
      id: "ws-ungrouped",
      name: "codeg",
      path: "/tmp/codeg",
      connected: true,
      kind: "main" as const,
      settings: {
        sidebarCollapsed: false,
        worktreeSetupScript: null,
      },
    };
    const groupedWorkspace = {
      id: "ws-grouped",
      name: "springboot-demo",
      path: "/tmp/springboot-demo",
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
        workspaces={[ungroupedWorkspace, groupedWorkspace]}
        groupedWorkspaces={[
          {
            id: "group-visible",
            name: "RCD",
            workspaces: [groupedWorkspace],
          },
          {
            id: null,
            name: "Ungrouped",
            workspaces: [ungroupedWorkspace],
          },
        ]}
      />,
    );

    expect(screen.getByText("codeg")).toBeTruthy();
    expect(screen.getByText("springboot-demo")).toBeTruthy();
    expect(screen.getByText("RCD")).toBeTruthy();
    expect(screen.queryByText("Ungrouped")).toBeNull();
  });

  it("toggles workspace collapse on single click without selecting the workspace", () => {
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
    expect(onToggleWorkspaceCollapse).toHaveBeenCalledWith("ws-1", false);
    expect(onSelectWorkspace).not.toHaveBeenCalled();
  });

  it("does not toggle the workspace when opening workspace actions", () => {
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

    fireEvent.click(screen.getByRole("button", { name: "New Session" }));

    expect(onToggleWorkspaceCollapse).not.toHaveBeenCalled();
    expect(onSelectWorkspace).not.toHaveBeenCalled();
  });

  it("triggers workspace engine refresh from the menu refresh button", async () => {
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
    const onRefreshEngineOptions = vi.fn(async () => ({
      activeEngine: "claude" as const,
      availableEngines: [
        {
          type: "claude" as const,
          displayName: "Claude Code",
          shortName: "Claude Code",
          installed: true,
          version: "1.0.0",
          error: null,
          availabilityState: "ready" as const,
          availabilityLabelKey: null,
        },
      ],
    }));

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
        engineOptions={[]}
        onRefreshEngineOptions={onRefreshEngineOptions}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "New Session" }));
      await Promise.resolve();
    });

    const refreshButtons = screen.getAllByRole("button", { name: "Refresh" });
    await act(async () => {
      fireEvent.mouseDown(refreshButtons[0]!);
      fireEvent.click(refreshButtons[0]!);
      await Promise.resolve();
    });

    expect(onRefreshEngineOptions).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("activates the workspace from the explicit main-panel action without toggling collapse", () => {
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

    fireEvent.click(screen.getByRole("button", { name: "Open in main panel" }));

    expect(onSelectWorkspace).toHaveBeenCalledWith("ws-1");
    expect(onToggleWorkspaceCollapse).not.toHaveBeenCalled();
  });

  it("shows tooltips for the add workspace and workspace actions icons", async () => {
    vi.useFakeTimers();
    try {
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
        />,
      );

      await act(async () => {
        fireEvent.mouseEnter(screen.getByRole("button", { name: "Add workspace" }));
        await vi.advanceTimersByTimeAsync(250);
      });
      let tooltips = screen.getAllByRole("tooltip");
      expect(tooltips[tooltips.length - 1]?.textContent).toContain("Add workspace");

      await act(async () => {
        fireEvent.mouseLeave(screen.getByRole("button", { name: "Add workspace" }));
        fireEvent.mouseEnter(screen.getByRole("button", { name: "New Session" }));
        await vi.advanceTimersByTimeAsync(250);
      });
      tooltips = screen.getAllByRole("tooltip");
      expect(tooltips[tooltips.length - 1]?.textContent).toContain("New Session");
    } finally {
      vi.useRealTimers();
    }
  });
});
