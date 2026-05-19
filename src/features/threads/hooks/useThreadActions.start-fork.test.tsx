// @vitest-environment jsdom
import { act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationItem } from "../../../types";
import {
  connectWorkspace,
  createWorkspaceDirectory,
  forkThread,
  startThread,
} from "../../../services/tauri";
import { previewThreadName } from "../../../utils/threadItems";
import {
  clearGlobalRuntimeNotices,
  getGlobalRuntimeNoticesSnapshot,
} from "../../../services/globalRuntimeNotices";
import { renderActions } from "./useThreadActions.test-utils";

vi.mock("../../../services/tauri", () => ({
  startThread: vi.fn(),
  connectWorkspace: vi.fn(),
  createWorkspaceDirectory: vi.fn(),
  forkClaudeSession: vi.fn(),
  forkClaudeSessionFromMessage: vi.fn(),
  forkThread: vi.fn(),
  rewindCodexThread: vi.fn(),
  listClaudeSessions: vi.fn(),
  listGeminiSessions: vi.fn(),
  getOpenCodeSessionList: vi.fn(),
  listWorkspaceSessions: vi.fn(),
  loadClaudeSession: vi.fn(),
  loadGeminiSession: vi.fn(),
  loadCodexSession: vi.fn(),
  listThreadTitles: vi.fn(),
  readWorkspaceFile: vi.fn(),
  renameThreadTitleKey: vi.fn(),
  setThreadTitle: vi.fn(),
  resumeThread: vi.fn(),
  listThreads: vi.fn(),
  archiveThread: vi.fn(),
  deleteCodexSession: vi.fn(),
  deleteClaudeSession: vi.fn(),
  deleteGeminiSession: vi.fn(),
  deleteOpenCodeSession: vi.fn(),
  trashWorkspaceItem: vi.fn(),
  writeWorkspaceFile: vi.fn(),
}));

vi.mock("../../../utils/threadItems", () => ({
  buildItemsFromThread: vi.fn(),
  extractClaudeApprovalResumeEntries: vi.fn(() => []),
  getThreadTimestamp: vi.fn(),
  isReviewingFromThread: vi.fn(),
  mergeThreadItems: vi.fn(),
  normalizeItem: vi.fn((item: ConversationItem) => item),
  previewThreadName: vi.fn(),
  stripClaudeApprovalResumeArtifacts: vi.fn((text: string) => text),
}));

vi.mock("../utils/threadStorage", () => ({
  makeCustomNameKey: (workspaceId: string, threadId: string) =>
    `${workspaceId}:${threadId}`,
  saveThreadActivity: vi.fn(),
}));

vi.mock("../utils/sidebarSnapshot", () => ({
  loadSidebarSnapshot: vi.fn(() => null),
}));

vi.mock("../../../services/globalRuntimeNotices", async () => {
  const actual = await vi.importActual<
    typeof import("../../../services/globalRuntimeNotices")
  >("../../../services/globalRuntimeNotices");
  return actual;
});

describe("useThreadActions start/fork", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.mocked(connectWorkspace).mockResolvedValue(undefined);
    vi.mocked(createWorkspaceDirectory).mockResolvedValue(undefined);
    vi.mocked(previewThreadName).mockImplementation(
      (text: string, fallback: string) => {
        const trimmed = text.trim();
        return trimmed || fallback;
      },
    );
    clearGlobalRuntimeNotices();
  });

  it("starts a thread and activates it by default", async () => {
    vi.mocked(startThread).mockResolvedValue({
      result: { thread: { id: "thread-1" } },
    });

    const { result, dispatch, loadedThreadsRef } = renderActions();

    let threadId: string | null = null;
    await act(async () => {
      threadId = await result.current.startThreadForWorkspace("ws-1");
    });

    expect(threadId).toBe("thread-1");
    expect(startThread).toHaveBeenCalledWith("ws-1");
    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "thread-1",
      engine: "codex",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "markCodexAcceptedTurn",
      threadId: "thread-1",
      fact: "empty-draft",
      source: "thread-start",
      timestamp: expect.any(Number),
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "setActiveThreadId",
      workspaceId: "ws-1",
      threadId: "thread-1",
    });
    expect(loadedThreadsRef.current["thread-1"]).toBe(true);
  });

  it("reuses one in-flight codex start for concurrent callers", async () => {
    let resolveStart:
      | ((value: { result: { thread: { id: string } } }) => void)
      | null = null;
    vi.mocked(startThread).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStart = resolve;
        }),
    );

    const { result, dispatch, loadedThreadsRef } = renderActions();

    let firstStart: Promise<string | null>;
    let secondStart: Promise<string | null>;
    await act(async () => {
      firstStart = result.current.startThreadForWorkspace("ws-1", {
        activate: false,
      });
      secondStart = result.current.startThreadForWorkspace("ws-1", {
        activate: true,
      });
    });

    expect(startThread).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveStart?.({ result: { thread: { id: "thread-shared" } } });
    });

    await expect(firstStart!).resolves.toBe("thread-shared");
    await expect(secondStart!).resolves.toBe("thread-shared");
    expect(startThread).toHaveBeenCalledTimes(1);
    expect(
      dispatch.mock.calls.filter(([action]) => action.type === "ensureThread"),
    ).toHaveLength(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "thread-shared",
      engine: "codex",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "markCodexAcceptedTurn",
      threadId: "thread-shared",
      fact: "empty-draft",
      source: "thread-start",
      timestamp: expect.any(Number),
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "setActiveThreadId",
      workspaceId: "ws-1",
      threadId: "thread-shared",
    });
    expect(loadedThreadsRef.current["thread-shared"]).toBe(true);
  });

  it("reconnects workspace and retries when codex start thread reports not connected", async () => {
    vi.mocked(startThread)
      .mockRejectedValueOnce(new Error("workspace not connected"))
      .mockResolvedValueOnce({
        result: { thread: { id: "thread-retry" } },
      });

    const { result, dispatch, loadedThreadsRef } = renderActions();

    let threadId: string | null = null;
    await act(async () => {
      threadId = await result.current.startThreadForWorkspace("ws-1");
    });

    expect(threadId).toBe("thread-retry");
    expect(connectWorkspace).toHaveBeenCalledWith("ws-1");
    expect(startThread).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "thread-retry",
      engine: "codex",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "setActiveThreadId",
      workspaceId: "ws-1",
      threadId: "thread-retry",
    });
    expect(loadedThreadsRef.current["thread-retry"]).toBe(true);
  });

  it("starts a thread when start_thread returns result.threadId", async () => {
    vi.mocked(startThread).mockResolvedValue({
      result: { threadId: "thread-1" },
    });

    const { result, dispatch, loadedThreadsRef } = renderActions();

    let threadId: string | null = null;
    await act(async () => {
      threadId = await result.current.startThreadForWorkspace("ws-1");
    });

    expect(threadId).toBe("thread-1");
    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "thread-1",
      engine: "codex",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "setActiveThreadId",
      workspaceId: "ws-1",
      threadId: "thread-1",
    });
    expect(loadedThreadsRef.current["thread-1"]).toBe(true);
  });

  it("shows a runtime warning when codex hook-safe fallback creates the thread", async () => {
    vi.mocked(startThread).mockResolvedValue({
      result: { thread: { id: "thread-fallback" } },
      ccguiHookSafeFallback: {
        mode: "session-hooks-disabled",
        reason: "invalid_thread_start_response",
        primaryFailureSummary: "invalid_thread_start_response: root_keys=[]",
      },
    });

    const { result, dispatch } = renderActions({
      threadsByWorkspace: {
        "ws-1": [
          {
            id: "thread-known",
            name: "Known old",
            updatedAt: 7000,
            engineSource: "codex",
          },
        ],
      },
      activeThreadIdByWorkspace: {
        "ws-1": "thread-known",
      },
    });

    let threadId: string | null = null;
    await act(async () => {
      threadId = await result.current.startThreadForWorkspace("ws-1");
    });

    expect(threadId).toBe("thread-fallback");
    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "thread-fallback",
      engine: "codex",
    });
    expect(getGlobalRuntimeNoticesSnapshot()).toEqual([
      expect.objectContaining({
        severity: "warning",
        category: "runtime",
        messageKey: "runtimeNotice.runtime.codexSessionStartHookSkipped",
        messageParams: expect.objectContaining({
          reason: "invalid_thread_start_response",
        }),
      }),
    ]);
  });

  it("starts an opencode pending thread locally", async () => {
    const { result, dispatch, loadedThreadsRef } = renderActions();

    let threadId: string | null = null;
    await act(async () => {
      threadId = await result.current.startThreadForWorkspace("ws-1", {
        engine: "opencode",
      });
    });

    expect(threadId).toMatch(/^opencode-pending-/);
    expect(startThread).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId,
      engine: "opencode",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "setActiveThreadId",
      workspaceId: "ws-1",
      threadId,
    });
    expect(threadId ? loadedThreadsRef.current[threadId] : false).toBe(true);
  });

  it("forks a thread and activates the fork", async () => {
    vi.mocked(forkThread).mockResolvedValue({
      result: { thread: { id: "thread-fork-1" } },
    });

    const { result, dispatch, loadedThreadsRef } = renderActions();

    let threadId: string | null = null;
    await act(async () => {
      threadId = await result.current.forkThreadForWorkspace(
        "ws-1",
        "thread-1",
      );
    });

    expect(threadId).toBe("thread-fork-1");
    expect(forkThread).toHaveBeenCalledWith("ws-1", "thread-1");
    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "thread-fork-1",
      engine: "codex",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "setActiveThreadId",
      workspaceId: "ws-1",
      threadId: "thread-fork-1",
    });
    expect(loadedThreadsRef.current["thread-fork-1"]).toBe(true);
  });

  it("forks a thread without activating when requested", async () => {
    vi.mocked(forkThread).mockResolvedValue({
      result: { thread: { id: "thread-fork-2" } },
    });

    const { result, dispatch } = renderActions({
      threadsByWorkspace: {
        "ws-1": [
          {
            id: "thread-known",
            name: "Known old",
            updatedAt: 7000,
            engineSource: "codex",
          },
        ],
      },
      activeThreadIdByWorkspace: {
        "ws-1": "thread-known",
      },
    });

    await act(async () => {
      await result.current.forkThreadForWorkspace("ws-1", "thread-1", {
        activate: false,
      });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "thread-fork-2",
      engine: "codex",
    });
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "setActiveThreadId",
        threadId: "thread-fork-2",
      }),
    );
  });

  it("starts a thread without activating when requested", async () => {
    vi.mocked(startThread).mockResolvedValue({
      result: { thread: { id: "thread-2" } },
    });

    const { result, dispatch } = renderActions();

    await act(async () => {
      await result.current.startThreadForWorkspace("ws-1", {
        activate: false,
      });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "thread-2",
      engine: "codex",
    });
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "setActiveThreadId" }),
    );
  });
});
