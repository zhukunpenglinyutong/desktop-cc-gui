// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings, WorkspaceInfo } from "../types";
import { useAppShellSearchRadarSection } from "./useAppShellSearchRadarSection";

vi.mock("../features/app/hooks/useComposerInsert", () => ({
  useComposerInsert: vi.fn(() => vi.fn()),
}));

vi.mock("../features/composer/hooks/useInputHistoryStore", () => ({
  loadHistoryWithImportance: vi.fn(() => []),
}));

vi.mock("../features/search/hooks/useUnifiedSearch", () => ({
  useUnifiedSearch: vi.fn(() => []),
}));

vi.mock("../features/session-activity/hooks/useWorkspaceSessionActivity", () => ({
  useWorkspaceSessionActivity: vi.fn(() => ({ sections: [] })),
}));

vi.mock("../features/session-activity/hooks/useSessionRadarFeed", () => ({
  useSessionRadarFeed: vi.fn(() => ({
    runningSessions: [],
    recentCompletedSessions: [],
    runningCountByWorkspaceId: {},
    recentCountByWorkspaceId: {},
  })),
}));

vi.mock("../features/session-activity/utils/performanceCompatibility", () => ({
  isPerformanceCompatibilityModeEnabled: vi.fn((settings) =>
    settings?.performanceCompatibilityModeEnabled === true
  ),
}));

vi.mock("../features/workspaces/hooks/useWorkspaceSessionProjectionSummary", () => ({
  useWorkspaceSessionProjectionSummary: vi.fn(() => ({
    summary: { ownerWorkspaceIds: ["ws-1"] },
  })),
}));

vi.mock("./useWorkspaceThreadListHydration", () => ({
  useWorkspaceThreadListHydration: vi.fn(() => ({
    ensureWorkspaceThreadListLoaded: vi.fn(),
    hydratedThreadListWorkspaceIdsRef: { current: {} },
    listThreadsForWorkspaceTracked: vi.fn(),
  })),
}));

vi.mock("../services/clientStorage", () => ({
  getClientStoreSync: vi.fn(() => null),
  writeClientStoreValue: vi.fn(),
}));

vi.mock("../services/systemNotification", () => ({
  sendSystemNotification: vi.fn(),
}));

vi.mock("../services/tauri", () => ({
  getWorkspaceFiles: vi.fn(async () => ({ files: [] })),
}));

function createWorkspace(id: string, name: string): WorkspaceInfo {
  return {
    id,
    name,
    path: `/tmp/${id}`,
    settings: { sidebarCollapsed: false },
    connected: true,
    kind: "main",
  } as unknown as WorkspaceInfo;
}

describe("useAppShellSearchRadarSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps recent thread titles aligned with sidebar thread summaries", () => {
    const workspace = createWorkspace("ws-1", "Workspace 1");
    const appSettings = {
      systemNotificationEnabled: false,
    } as AppSettings;

    const { result } = renderHook(() =>
      useAppShellSearchRadarSection({
        activeDraft: "",
        activeItems: [],
        activeThreadId: null,
        activeWorkspace: workspace,
        activeWorkspaceId: "ws-1",
        appSettings,
        commands: [],
        composerInputRef: { current: null },
        completionTrackerBySessionRef: { current: {} },
        completionTrackerReadyRef: { current: false },
        directories: [],
        filePanelMode: "radar",
        files: [],
        globalSearchFilesByWorkspace: {},
        handleDraftChange: vi.fn(),
        isCompact: false,
        isFilesLoading: false,
        isProcessing: false,
        isSearchPaletteOpen: false,
        kanbanTasks: [],
        lastAgentMessageByThread: {},
        listThreadsForWorkspace: vi.fn(async () => {}),
        rightPanelCollapsed: false,
        searchContentFilters: [],
        searchPaletteQuery: "",
        searchScope: "active-workspace",
        setGlobalSearchFilesByWorkspace: vi.fn(),
        skills: [],
        t: (key: string) => key,
        threadItemsByThread: {},
        threadListLoadingByWorkspace: {},
        threadParentById: {},
        threadStatusById: {},
        threadsByWorkspace: {
          "ws-1": [
            {
              id: "codex-agent-1",
              name: "项目分析",
              updatedAt: 2_000,
              engineSource: "codex",
              isDegraded: true,
              partialSource: "local-session-scan-unavailable",
              degradedReason: "partial-thread-list",
            },
            {
              id: "codex-agent-2",
              name: "Agent 20",
              updatedAt: 1_000,
              engineSource: "codex",
            },
          ],
        },
        workspaces: [workspace],
        workspacesById: new Map([[workspace.id, workspace]]),
      }),
    );

    expect(result.current.recentThreads).toEqual([
      expect.objectContaining({
        id: "codex-agent-1",
        threadId: "codex-agent-1",
        title: "项目分析",
        updatedAt: 2_000,
      }),
      expect.objectContaining({
        id: "codex-agent-2",
        threadId: "codex-agent-2",
        title: "Agent 20",
        updatedAt: 1_000,
      }),
    ]);
  });
});
