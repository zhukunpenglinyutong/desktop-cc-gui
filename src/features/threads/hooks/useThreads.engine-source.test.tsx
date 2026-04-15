// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceInfo } from "../../../types";
import { listThreads, resumeThread } from "../../../services/tauri";
import type { useAppServerEvents } from "../../app/hooks/useAppServerEvents";
import {
  listSharedSessions,
  setSharedSessionSelectedEngine,
  startSharedSession,
  syncSharedSessionSnapshot,
} from "../../shared-session/services/sharedSessions";
import { useThreads } from "./useThreads";

type AppServerHandlers = Parameters<typeof useAppServerEvents>[0];

let handlers: AppServerHandlers | null = null;

vi.mock("../../app/hooks/useAppServerEvents", () => ({
  useAppServerEvents: (incoming: AppServerHandlers) => {
    handlers = incoming;
  },
}));

vi.mock("./useThreadMessaging", () => ({
  useThreadMessaging: () => ({
    interruptTurn: vi.fn(),
    sendUserMessage: vi.fn(),
    sendUserMessageToThread: vi.fn(),
    startFork: vi.fn(),
    startReview: vi.fn(),
    startResume: vi.fn(),
    startMcp: vi.fn(),
    startSpecRoot: vi.fn(),
    startStatus: vi.fn(),
    startFast: vi.fn(),
    startMode: vi.fn(),
    startExport: vi.fn(),
    startImport: vi.fn(),
    startLsp: vi.fn(),
    startShare: vi.fn(),
    reviewPrompt: null,
    openReviewPrompt: vi.fn(),
    closeReviewPrompt: vi.fn(),
    showPresetStep: false,
    choosePreset: vi.fn(),
    highlightedPresetIndex: -1,
    setHighlightedPresetIndex: vi.fn(),
    highlightedBranchIndex: -1,
    setHighlightedBranchIndex: vi.fn(),
    highlightedCommitIndex: -1,
    setHighlightedCommitIndex: vi.fn(),
    handleReviewPromptKeyDown: vi.fn(),
    confirmBranch: vi.fn(),
    selectBranch: vi.fn(),
    selectBranchAtIndex: vi.fn(),
    selectCommit: vi.fn(),
    selectCommitAtIndex: vi.fn(),
    confirmCommit: vi.fn(),
    updateCustomInstructions: vi.fn(),
    confirmCustom: vi.fn(),
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
  getAccountRateLimits: vi.fn(),
  getAccountInfo: vi.fn(),
  interruptTurn: vi.fn(),
  projectMemoryUpdate: vi.fn(),
  projectMemoryCreate: vi.fn(),
}));

vi.mock("../../shared-session/services/sharedSessions", () => ({
  startSharedSession: vi.fn(),
  sendSharedSessionMessage: vi.fn(),
  listSharedSessions: vi.fn(async () => []),
  loadSharedSession: vi.fn(async () => null),
  setSharedSessionSelectedEngine: vi.fn(async () => ({})),
  updateSharedSessionNativeBinding: vi.fn(async () => ({})),
  syncSharedSessionSnapshot: vi.fn(async () => ({})),
  deleteSharedSession: vi.fn(async () => ({})),
}));

const workspace: WorkspaceInfo = {
  id: "ws-1",
  name: "ccgui",
  path: "/tmp/codemoss",
  connected: true,
  settings: { sidebarCollapsed: false },
};

describe("useThreads engine source", () => {
  beforeEach(() => {
    handlers = null;
    vi.clearAllMocks();
    vi.mocked(startSharedSession).mockResolvedValue({
      result: {
        thread: {
          id: "shared:session-1",
          name: "Shared Session",
          updatedAt: 1_730_000_000_000,
          threadKind: "shared",
          selectedEngine: "claude",
          engineSource: "claude",
          nativeThreadIds: [],
        },
      },
    });
    vi.mocked(setSharedSessionSelectedEngine).mockResolvedValue({});
  });

  it("keeps thread engine source when selecting an unloaded thread", async () => {
    const { result } = renderHook(() =>
      useThreads({
        activeWorkspace: workspace,
        activeEngine: "codex",
        onWorkspaceConnected: vi.fn(),
      }),
    );

    expect(handlers).not.toBeNull();

    act(() => {
      handlers?.onThreadStarted?.("ws-1", {
        id: "claude:session-1",
        preview: "Claude thread",
        updatedAt: 1_700_000_000_000,
      });
    });

    expect(
      result.current.threadsByWorkspace["ws-1"]?.find(
        (thread) => thread.id === "claude:session-1",
      )?.engineSource,
    ).toBe("claude");

    act(() => {
      result.current.setActiveThreadId("claude:session-1");
    });

    await waitFor(() => {
      expect(result.current.activeThreadId).toBe("claude:session-1");
    });

    expect(
      result.current.threadsByWorkspace["ws-1"]?.find(
        (thread) => thread.id === "claude:session-1",
      )?.engineSource,
    ).toBe("claude");
  });

  it("refreshes loaded thread only after switch refresh window", async () => {
    vi.useFakeTimers();
    vi.mocked(resumeThread).mockResolvedValue({
      result: {
        thread: {
          id: "thread-1",
          preview: "Thread 1",
          turns: [],
        },
      },
    });
    try {
      const { result } = renderHook(() =>
        useThreads({
          activeWorkspace: workspace,
          activeEngine: "codex",
          onWorkspaceConnected: vi.fn(),
        }),
      );

      act(() => {
        result.current.setActiveThreadId("thread-1");
      });
      await act(async () => {
        vi.advanceTimersByTime(100);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(vi.mocked(resumeThread)).toHaveBeenCalledTimes(1);

      act(() => {
        result.current.setActiveThreadId("thread-1");
      });
      await act(async () => {
        vi.advanceTimersByTime(100);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(vi.mocked(resumeThread)).toHaveBeenCalledTimes(1);

      act(() => {
        vi.advanceTimersByTime(20_001);
        result.current.setActiveThreadId("thread-1");
      });
      await act(async () => {
        vi.advanceTimersByTime(100);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(vi.mocked(resumeThread)).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("persists shared session engine selection through shared command", async () => {
    const { result } = renderHook(() =>
      useThreads({
        activeWorkspace: workspace,
        activeEngine: "claude",
        onWorkspaceConnected: vi.fn(),
      }),
    );

    let sharedThreadId: string | null = null;
    await act(async () => {
      sharedThreadId = await result.current.startSharedSessionForWorkspace("ws-1", {
        activate: true,
        initialEngine: "claude",
      });
    });

    expect(sharedThreadId).toBe("shared:session-1");

    act(() => {
      result.current.updateSharedSessionEngineSelection(
        "ws-1",
        sharedThreadId!,
        "codex",
      );
    });

    await waitFor(() => {
      expect(vi.mocked(setSharedSessionSelectedEngine)).toHaveBeenCalledWith(
        "ws-1",
        "shared:session-1",
        "codex",
      );
    });
  });

  it("does not sync shared snapshot for unloaded historical shared sessions", async () => {
    vi.mocked(listThreads).mockResolvedValue({
      result: {
        data: [],
        nextCursor: null,
      },
    });
    vi.mocked(listSharedSessions).mockResolvedValue([
      {
        id: "shared-session-historical-1",
        threadId: "shared:shared-session-historical-1",
        title: "Historical Shared Session",
        updatedAt: 1_730_000_370_000,
        selectedEngine: "claude",
        nativeThreadIds: [],
      },
    ]);
    vi.mocked(syncSharedSessionSnapshot).mockResolvedValue({});

    const { result, unmount } = renderHook(() =>
      useThreads({
        activeWorkspace: null,
        activeEngine: "claude",
        onWorkspaceConnected: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace);
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
    });

    const historicalSyncCalls = vi
      .mocked(syncSharedSessionSnapshot)
      .mock.calls.filter((call) => call[1] === "shared:shared-session-historical-1");
    expect(historicalSyncCalls).toHaveLength(0);
    unmount();
  });
});
