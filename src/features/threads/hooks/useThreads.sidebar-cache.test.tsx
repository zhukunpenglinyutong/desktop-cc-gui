// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceInfo } from "../../../types";
import { deleteCodexSessions, listThreads, resumeThread } from "../../../services/tauri";
import { writeClientStoreData, writeClientStoreValue } from "../../../services/clientStorage";
import type { useAppServerEvents } from "../../app/hooks/useAppServerEvents";
import { useThreads } from "./useThreads";
import { loadSidebarSnapshot } from "../utils/sidebarSnapshot";

type AppServerHandlers = Parameters<typeof useAppServerEvents>[0];

vi.mock("../../app/hooks/useAppServerEvents", () => ({
  useAppServerEvents: (_incoming: AppServerHandlers) => {},
}));

vi.mock("./useThreadRateLimits", () => ({
  useThreadRateLimits: () => ({
    refreshAccountRateLimits: vi.fn(),
  }),
}));

vi.mock("./useThreadAccountInfo", () => ({
  useThreadAccountInfo: () => ({
    refreshAccountInfo: vi.fn(),
  }),
}));

vi.mock("../../../services/tauri", () => ({
  respondToServerRequest: vi.fn(),
  respondToUserInputRequest: vi.fn(),
  listThreadTitles: vi.fn(),
  setThreadTitle: vi.fn(),
  renameThreadTitleKey: vi.fn(),
  generateThreadTitle: vi.fn(),
  rememberApprovalRule: vi.fn(),
  sendUserMessage: vi.fn(),
  startReview: vi.fn(),
  startThread: vi.fn(),
  listThreads: vi.fn(),
  resumeThread: vi.fn(),
  archiveThread: vi.fn(),
  deleteCodexSessions: vi.fn(),
  deleteOpenCodeSession: vi.fn(),
  getAccountRateLimits: vi.fn(),
  getAccountInfo: vi.fn(),
  interruptTurn: vi.fn(),
  approveToolCall: vi.fn(),
  denyToolCall: vi.fn(),
  executeSlashCommand: vi.fn(),
  branchWorkspace: vi.fn(),
  startMcpSession: vi.fn(),
  startSpecRootSession: vi.fn(),
  startStatusSession: vi.fn(),
  startContextSession: vi.fn(),
  startFastSession: vi.fn(),
  startModeSession: vi.fn(),
  startExportSession: vi.fn(),
  startImportSession: vi.fn(),
  startLspSession: vi.fn(),
  startShareSession: vi.fn(),
  listWorkspaceSessions: vi.fn().mockResolvedValue({
    data: [],
    nextCursor: null,
    partialSource: null,
  }),
  listWorkspacePlugins: vi.fn(),
  addWorkspacePlugin: vi.fn(),
  removeWorkspacePlugin: vi.fn(),
  listWorkspaceProviderProfiles: vi.fn(),
  saveWorkspaceProviderProfile: vi.fn(),
  removeWorkspaceProviderProfile: vi.fn(),
  saveWorkspaceProviderSelection: vi.fn(),
  listWorkspaceOpenCodeAgents: vi.fn(),
  projectMemoryUpdate: vi.fn(),
  projectMemoryCreate: vi.fn(),
  connectWorkspace: vi.fn(),
  listGeminiSessions: vi.fn().mockResolvedValue([]),
  listClaudeSessions: vi.fn().mockResolvedValue([]),
  getOpenCodeSessionList: vi.fn().mockResolvedValue([]),
}));

const workspace: WorkspaceInfo = {
  id: "ws-1",
  name: "ccgui",
  path: "/tmp/codex",
  connected: true,
  settings: { sidebarCollapsed: false },
};

describe("useThreads sidebar cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeClientStoreData("threads", {});
  });

  it("hydrates cached thread summaries before live thread list resolves", () => {
    writeClientStoreValue("threads", "sidebarSnapshot", {
      version: 1,
      updatedAt: 123,
      workspaces: [workspace],
      threadsByWorkspace: {
        "ws-1": [{ id: "thread-1", name: "Cached chat", updatedAt: 123 }],
      },
    });

    const { result } = renderHook(() =>
      useThreads({
        activeWorkspace: workspace,
        onWorkspaceConnected: vi.fn(),
      }),
    );

    expect(result.current.threadsByWorkspace["ws-1"]).toEqual([
      expect.objectContaining({ id: "thread-1", name: "Cached chat" }),
    ]);
  });

  it("rewrites cached thread summaries after a successful live list", async () => {
    vi.mocked(listThreads).mockResolvedValue({
      result: {
        data: [
          {
            id: "thread-2",
            cwd: workspace.path,
            preview: "Fresh chat",
            updated_at: 456,
          },
        ],
        nextCursor: null,
      },
    } as never);

    const { result } = renderHook(() =>
      useThreads({
        activeWorkspace: workspace,
        onWorkspaceConnected: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace);
    });

    await waitFor(() => {
      expect(loadSidebarSnapshot()?.threadsByWorkspace["ws-1"]).toEqual([
        expect.objectContaining({ id: "thread-2" }),
      ]);
    });
  });

  it("tracks Codex history loading while selecting an unloaded thread", async () => {
    vi.useFakeTimers();
    let resolveResume:
      | ((value: {
          result: {
            thread: {
              id: string;
              preview: string;
              updated_at: number;
              turns: unknown[];
            };
          };
        }) => void)
      | null = null;
    vi.mocked(resumeThread).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveResume = resolve;
        }) as never,
    );

    try {
      const { result } = renderHook(() =>
        useThreads({
          activeWorkspace: workspace,
          onWorkspaceConnected: vi.fn(),
        }),
      );

      act(() => {
        result.current.setActiveThreadId("thread-history");
      });

      expect(result.current.historyLoadingByThreadId["thread-history"]).toBe(true);

      await act(async () => {
        vi.advanceTimersByTime(50);
      });

      expect(vi.mocked(resumeThread)).toHaveBeenCalledWith("ws-1", "thread-history");
      expect(result.current.historyLoadingByThreadId["thread-history"]).toBe(true);

      await act(async () => {
        resolveResume?.({
          result: {
            thread: {
              id: "thread-history",
              preview: "Loaded thread",
              updated_at: 456,
              turns: [],
            },
          },
        });
        await Promise.resolve();
      });

      expect(result.current.historyLoadingByThreadId["thread-history"]).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not mark pending Codex threads as history loading", () => {
    vi.useFakeTimers();

    try {
      const { result } = renderHook(() =>
        useThreads({
          activeWorkspace: workspace,
          onWorkspaceConnected: vi.fn(),
        }),
      );

      act(() => {
        result.current.setActiveThreadId("codex-pending-1");
      });

      expect(result.current.historyLoadingByThreadId["codex-pending-1"]).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears Codex history loading after resume failure", async () => {
    vi.useFakeTimers();
    vi.mocked(resumeThread).mockRejectedValue(new Error("resume failed"));

    try {
      const { result } = renderHook(() =>
        useThreads({
          activeWorkspace: workspace,
          onWorkspaceConnected: vi.fn(),
        }),
      );

      act(() => {
        result.current.setActiveThreadId("thread-history-error");
      });

      expect(result.current.historyLoadingByThreadId["thread-history-error"]).toBe(true);

      await act(async () => {
        vi.advanceTimersByTime(50);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(
        result.current.historyLoadingByThreadId["thread-history-error"],
      ).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("batch deletes codex sessions through the settings fast path", async () => {
    vi.mocked(listThreads).mockResolvedValue({
      result: {
        data: [
          {
            id: "thread-1",
            cwd: workspace.path,
            preview: "Fresh chat 1",
            updated_at: 456,
          },
          {
            id: "thread-2",
            cwd: workspace.path,
            preview: "Fresh chat 2",
            updated_at: 455,
          },
        ],
        nextCursor: null,
      },
    } as never);
    vi.mocked(deleteCodexSessions).mockResolvedValue({
      results: [
        {
          sessionId: "thread-1",
          deleted: true,
          deletedCount: 1,
          method: "filesystem",
        },
        {
          sessionId: "thread-2",
          deleted: true,
          deletedCount: 1,
          method: "filesystem",
        },
      ],
    });

    const { result } = renderHook(() =>
      useThreads({
        activeWorkspace: workspace,
        onWorkspaceConnected: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace);
    });

    await act(async () => {
      const deleted = await result.current.removeThreads("ws-1", ["thread-1", "thread-2"]);
      expect(deleted).toEqual([
        { threadId: "thread-1", success: true, code: null, message: null },
        { threadId: "thread-2", success: true, code: null, message: null },
      ]);
    });

    expect(deleteCodexSessions).toHaveBeenCalledWith("ws-1", ["thread-1", "thread-2"]);
    expect(result.current.threadsByWorkspace["ws-1"]).toEqual([]);
  });
});
