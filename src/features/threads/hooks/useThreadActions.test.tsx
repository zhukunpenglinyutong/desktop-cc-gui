// @vitest-environment jsdom
import { act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationItem } from "../../../types";
import {
  archiveThread,
  deleteCodexSession,
  deleteClaudeSession,
  deleteGeminiSession,
  deleteOpenCodeSession,
  connectWorkspace,
  getOpenCodeSessionList,
  listWorkspaceSessions,
  listClaudeSessions,
  listGeminiSessions,
  loadGeminiSession,
  loadCodexSession,
  listThreadTitles,
  renameThreadTitleKey,
  setThreadTitle,
  listThreads,
  resumeThread,
  readWorkspaceFile,
  trashWorkspaceItem,
  writeWorkspaceFile,
} from "../../../services/tauri";
import {
  buildItemsFromThread,
  getThreadTimestamp,
  isReviewingFromThread,
  mergeThreadItems,
  previewThreadName,
} from "../../../utils/threadItems";
import { loadSidebarSnapshot } from "../utils/sidebarSnapshot";
import { saveThreadActivity } from "../utils/threadStorage";
import {
  expectSetThreadsDispatched,
  renderActions,
  workspace,
} from "./useThreadActions.test-utils";

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
  const actual = await vi.importActual<typeof import("../../../services/globalRuntimeNotices")>(
    "../../../services/globalRuntimeNotices",
  );
  return actual;
});

describe("useThreadActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.mocked(listThreadTitles).mockResolvedValue({});
    vi.mocked(listClaudeSessions).mockResolvedValue([]);
    vi.mocked(listGeminiSessions).mockResolvedValue([]);
    vi.mocked(getOpenCodeSessionList).mockResolvedValue([]);
    vi.mocked(listWorkspaceSessions).mockResolvedValue({
      data: [],
      nextCursor: null,
      partialSource: null,
    });
    vi.mocked(renameThreadTitleKey).mockResolvedValue(undefined);
    vi.mocked(setThreadTitle).mockResolvedValue("title");
    vi.mocked(connectWorkspace).mockResolvedValue(undefined);
    vi.mocked(previewThreadName).mockImplementation((text: string, fallback: string) => {
      const trimmed = text.trim();
      return trimmed || fallback;
    });
    vi.mocked(deleteClaudeSession).mockResolvedValue(undefined);
    vi.mocked(deleteGeminiSession).mockResolvedValue(undefined);
    vi.mocked(deleteOpenCodeSession).mockResolvedValue({
      deleted: true,
      method: "filesystem",
    });
    vi.mocked(deleteCodexSession).mockResolvedValue({
      deleted: true,
      deletedCount: 1,
      method: "filesystem",
      archivedBeforeDelete: true,
    });
    vi.mocked(loadGeminiSession).mockResolvedValue({ messages: [] });
    vi.mocked(readWorkspaceFile).mockResolvedValue({
      content: "",
      truncated: false,
    });
    vi.mocked(trashWorkspaceItem).mockResolvedValue(undefined);
    vi.mocked(writeWorkspaceFile).mockResolvedValue(undefined);
    vi.mocked(loadSidebarSnapshot).mockReturnValue(null);
    vi.mocked(mergeThreadItems).mockImplementation(
      (primaryItems: ConversationItem[]) => primaryItems,
    );
  });

  it("skips resume when already loaded", async () => {
    const loadedThreadsRef = { current: { "thread-1": true } };
    const { result } = renderActions({ loadedThreadsRef });

    let threadId: string | null = null;
    await act(async () => {
      threadId = await result.current.resumeThreadForWorkspace("ws-1", "thread-1");
    });

    expect(threadId).toBe("thread-1");
    expect(resumeThread).not.toHaveBeenCalled();
  });

  it("skips resume while processing unless forced", async () => {
    const options = {
      loadedThreadsRef: { current: { "thread-1": true } },
      threadStatusById: {
        "thread-1": {
          isProcessing: true,
          hasUnread: false,
          isReviewing: false,
          processingStartedAt: 123,
          lastDurationMs: null,
        },
      },
    };
    const { result: skipResult } = renderActions(options);

    await act(async () => {
      await skipResult.current.resumeThreadForWorkspace("ws-1", "thread-1");
    });

    expect(resumeThread).not.toHaveBeenCalled();

    vi.mocked(resumeThread).mockResolvedValue({
      result: { thread: { id: "thread-1", updated_at: 1 } },
    });

    const { result: forceResult } = renderActions(options);

    await act(async () => {
      await forceResult.current.resumeThreadForWorkspace("ws-1", "thread-1", true);
    });

    expect(resumeThread).toHaveBeenCalledWith("ws-1", "thread-1");
  });

  it("resumes thread, sets items, status, name, and last message", async () => {
    const assistantItem: ConversationItem = {
      id: "assistant-1",
      kind: "message",
      role: "assistant",
      text: "Hello!",
    };

    vi.mocked(resumeThread).mockResolvedValue({
      result: {
        thread: { id: "thread-2", preview: "preview", updated_at: 555 },
      },
    });
    vi.mocked(buildItemsFromThread).mockReturnValue([assistantItem]);
    vi.mocked(isReviewingFromThread).mockReturnValue(true);
    vi.mocked(previewThreadName).mockReturnValue("Preview Name");
    vi.mocked(getThreadTimestamp).mockReturnValue(999);
    vi.mocked(mergeThreadItems).mockReturnValue([assistantItem]);

    const { result, dispatch, applyCollabThreadLinksFromThread } = renderActions();

    await act(async () => {
      await result.current.resumeThreadForWorkspace("ws-1", "thread-2");
    });

    expect(resumeThread).toHaveBeenCalledWith("ws-1", "thread-2");
    expect(applyCollabThreadLinksFromThread).toHaveBeenCalledWith(
      "thread-2",
      expect.objectContaining({ id: "thread-2" }),
    );
    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "thread-2",
      engine: "codex",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "setThreadItems",
      threadId: "thread-2",
      items: [assistantItem],
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "markReviewing",
      threadId: "thread-2",
      isReviewing: true,
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "setThreadName",
      workspaceId: "ws-1",
      threadId: "thread-2",
      name: "Preview Name",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "setLastAgentMessage",
      threadId: "thread-2",
      text: "Hello!",
      timestamp: 999,
    });
  });

  it("uses unified history loader path for codex threads when enabled", async () => {
    const assistantItem: ConversationItem = {
      id: "assistant-unified-1",
      kind: "message",
      role: "assistant",
      text: "Unified loader response",
    };
    vi.mocked(resumeThread).mockResolvedValue({
      result: {
        thread: {
          turns: [
            {
              id: "turn-1",
              explanation: "Plan first",
              plan: [{ step: "Inspect", status: "in_progress" }],
            },
          ],
        },
      },
    });
    vi.mocked(loadCodexSession).mockResolvedValue({ entries: [] });
    vi.mocked(buildItemsFromThread).mockReturnValue([assistantItem]);

    const { result, dispatch } = renderActions({
      useUnifiedHistoryLoader: true,
    });

    await act(async () => {
      await result.current.resumeThreadForWorkspace("ws-1", "thread-unified");
    });

    expect(resumeThread).toHaveBeenCalledWith("ws-1", "thread-unified");
    expect(loadCodexSession).toHaveBeenCalledWith("ws-1", "thread-unified");
    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "thread-unified",
      engine: "codex",
    });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "setThreadItems",
        threadId: "thread-unified",
      }),
    );
    expect(dispatch).toHaveBeenCalledWith({
      type: "setThreadPlan",
      threadId: "thread-unified",
      plan: {
        turnId: "turn-1",
        explanation: "Plan first",
        steps: [{ step: "Inspect", status: "pending" }],
      },
    });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "setThreadHistoryRestoredAt",
        threadId: "thread-unified",
      }),
    );
  });

  it("hydrates unified codex history through assembler before dispatching thread items", async () => {
    vi.mocked(resumeThread).mockResolvedValue({
      result: {
        thread: {
          turns: [
            {
              id: "turn-assembler-1",
              items: [],
            },
          ],
        },
      },
    });
    vi.mocked(loadCodexSession).mockResolvedValue({ entries: [] });
    vi.mocked(buildItemsFromThread).mockReturnValue([
      {
        id: "assistant-history-alias-1",
        kind: "message",
        role: "assistant",
        text: "我先检查仓库结构。",
      },
      {
        id: "assistant-history-canonical-1",
        kind: "message",
        role: "assistant",
        text: "我先检查仓库结构。 我先检查仓库结构。",
      },
    ] satisfies ConversationItem[]);

    const { result, dispatch } = renderActions({
      useUnifiedHistoryLoader: true,
    });

    await act(async () => {
      await result.current.resumeThreadForWorkspace("ws-1", "thread-assembler");
    });

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "setThreadItems",
        threadId: "thread-assembler",
        items: [
          expect.objectContaining({
            id: "assistant-history-canonical-1",
            kind: "message",
            role: "assistant",
            text: "我先检查仓库结构。",
          }),
        ],
      }),
    );
  });

  it("reports unified history loader fallback warnings through debug channel", async () => {
    vi.mocked(resumeThread).mockResolvedValue(null);
    const onDebug = vi.fn();
    const { result, dispatch } = renderActions({
      useUnifiedHistoryLoader: true,
      onDebug,
    });

    await act(async () => {
      await result.current.resumeThreadForWorkspace("ws-1", "thread-empty");
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "thread-empty",
      engine: "codex",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "setThreadPlan",
      threadId: "thread-empty",
      plan: null,
    });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "setThreadHistoryRestoredAt",
        threadId: "thread-empty",
      }),
    );
    expect(onDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "thread/history fallback",
      }),
    );
  });

  it("recovers stale unified codex thread ids without breaking current workspace state", async () => {
    vi.mocked(resumeThread).mockImplementation(
      async (_workspaceId: string, threadId: string) => {
        if (threadId === "thread-stale") {
          throw new Error("thread not found: thread-stale");
        }
        return {
          result: {
            thread: {
              id: "thread-recovered",
              turns: [{ id: "turn-recovered", items: [] }],
            },
          },
        };
      },
    );
    vi.mocked(listThreads).mockResolvedValue({
      result: {
        data: [
          {
            id: "thread-recovered",
            preview: "Recovered preview",
            updated_at: 999,
            cwd: "/tmp/codex",
          },
          {
            id: "thread-other",
            preview: "Other preview",
            updated_at: 100,
            cwd: "/tmp/codex",
          },
        ],
        nextCursor: null,
      },
    });
    vi.mocked(loadCodexSession).mockResolvedValue({ entries: [] });
    vi.mocked(buildItemsFromThread).mockReturnValue([
      {
        id: "assistant-recovered",
        kind: "message",
        role: "assistant",
        text: "Recovered",
      },
    ]);
    const rememberThreadAlias = vi.fn();

    const { result, dispatch, loadedThreadsRef } = renderActions({
      useUnifiedHistoryLoader: true,
      rememberThreadAlias,
      userInputRequests: [
        {
          workspace_id: "ws-1",
          request_id: "stale-request-1",
          params: {
            thread_id: "thread-stale",
            turn_id: "turn-stale",
            item_id: "item-stale",
            questions: [],
          },
        },
      ],
      threadsByWorkspace: {
        "ws-1": [
          {
            id: "thread-stale",
            name: "Recovered preview",
            updatedAt: 10,
            engineSource: "codex",
            threadKind: "native",
          },
        ],
      },
      activeThreadIdByWorkspace: {
        "ws-1": "thread-stale",
      },
    });

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace, { preserveState: true });
    });
    dispatch.mockClear();

    let resumed: string | null = null;
    await act(async () => {
      resumed = await result.current.resumeThreadForWorkspace("ws-1", "thread-stale");
    });

    expect(resumed).toBe("thread-recovered");
    expect(rememberThreadAlias).toHaveBeenCalledWith("thread-stale", "thread-recovered");
    expect(dispatch).toHaveBeenCalledWith({
      type: "setActiveThreadId",
      workspaceId: "ws-1",
      threadId: "thread-recovered",
    });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "setThreadItems",
        threadId: "thread-recovered",
      }),
    );
    expect(dispatch).toHaveBeenCalledWith({
      type: "clearUserInputRequestsForThread",
      workspaceId: "ws-1",
      threadId: "thread-stale",
    });
    expect(loadedThreadsRef.current["thread-recovered"]).toBe(true);
    expect(loadedThreadsRef.current["thread-stale"]).toBe(false);
  });

  it("recovers stale unified codex thread ids from later recovery pages", async () => {
    vi.mocked(resumeThread).mockImplementation(
      async (_workspaceId: string, threadId: string) => {
        if (threadId === "thread-stale") {
          throw new Error("thread not found: thread-stale");
        }
        return {
          result: {
            thread: {
              id: "thread-page-2",
              turns: [{ id: "turn-page-2", items: [] }],
            },
          },
        };
      },
    );
    vi.mocked(listThreads)
      .mockResolvedValueOnce({
        result: {
          data: [],
          nextCursor: null,
        },
      })
      .mockResolvedValueOnce({
        result: {
          data: [
            {
              id: "thread-page-1-a",
              preview: "Different page 1 A",
              updated_at: 500,
              cwd: "/tmp/codex",
            },
            {
              id: "thread-page-1-b",
              preview: "Different page 1 B",
              updated_at: 400,
              cwd: "/tmp/codex",
            },
          ],
          nextCursor: "cursor-2",
        },
      })
      .mockResolvedValueOnce({
        result: {
          data: [
            {
              id: "thread-page-2",
              preview: "Recovered later page",
              updated_at: 999,
              cwd: "/tmp/codex",
            },
          ],
          nextCursor: null,
        },
      });
    vi.mocked(loadCodexSession).mockResolvedValue({ entries: [] });
    vi.mocked(buildItemsFromThread).mockReturnValue([
      {
        id: "assistant-page-2",
        kind: "message",
        role: "assistant",
        text: "Recovered from page 2",
      },
    ]);

    const { result } = renderActions({
      useUnifiedHistoryLoader: true,
      threadsByWorkspace: {
        "ws-1": [
          {
            id: "thread-stale",
            name: "Recovered later page",
            updatedAt: 10,
            engineSource: "codex",
            threadKind: "native",
          },
        ],
      },
      activeThreadIdByWorkspace: {
        "ws-1": "thread-stale",
      },
    });

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace, { preserveState: true });
    });

    let resumed: string | null = null;
    await act(async () => {
      resumed = await result.current.resumeThreadForWorkspace("ws-1", "thread-stale");
    });

    expect(resumed).toBe("thread-page-2");
    expect(listThreads).toHaveBeenCalledTimes(3);
    expect(listThreads).toHaveBeenNthCalledWith(2, "ws-1", null, 50);
    expect(listThreads).toHaveBeenNthCalledWith(3, "ws-1", "cursor-2", 50);
  });

  it("keeps legacy failure behavior when stale unified thread recovery has no safe replacement", async () => {
    vi.mocked(resumeThread).mockRejectedValue(new Error("thread not found: thread-stale"));
    vi.mocked(listThreads).mockResolvedValue({
      result: {
        data: [
          {
            id: "thread-a",
            preview: "Thread A",
            updated_at: 100,
            cwd: "/tmp/codex",
          },
          {
            id: "thread-b",
            preview: "Thread B",
            updated_at: 99,
            cwd: "/tmp/codex",
          },
        ],
        nextCursor: null,
      },
    });
    const rememberThreadAlias = vi.fn();

    const { result, dispatch } = renderActions({
      useUnifiedHistoryLoader: true,
      rememberThreadAlias,
      threadsByWorkspace: {
        "ws-1": [
          {
            id: "thread-stale",
            name: "Unknown stale thread",
            updatedAt: 10,
            engineSource: "codex",
            threadKind: "native",
          },
        ],
      },
      activeThreadIdByWorkspace: {
        "ws-1": "thread-stale",
      },
    });

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace, { preserveState: true });
    });
    dispatch.mockClear();

    await act(async () => {
      await result.current.resumeThreadForWorkspace("ws-1", "thread-stale");
    });

    expect(rememberThreadAlias).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "setActiveThreadId",
        workspaceId: "ws-1",
        threadId: "thread-a",
      }),
    );
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "setActiveThreadId",
        workspaceId: "ws-1",
        threadId: "thread-b",
      }),
    );
  });

  it("recovers stale unified codex threads by message history when generic titles are ambiguous", async () => {
    vi.mocked(resumeThread).mockImplementation(
      async (_workspaceId: string, threadId: string) => {
        if (threadId === "thread-stale") {
          throw new Error("thread not found: thread-stale");
        }
        return {
          result: {
            thread: {
              id: threadId,
              turns: [{ id: `turn-${threadId}`, items: [] }],
            },
          },
        };
      },
    );
    vi.mocked(listThreads).mockResolvedValue({
      result: {
        data: [
          {
            id: "thread-a",
            preview: "hi",
            updated_at: 100,
            cwd: "/tmp/codex",
          },
          {
            id: "thread-b",
            preview: "hi",
            updated_at: 99,
            cwd: "/tmp/codex",
          },
        ],
        nextCursor: null,
      },
    });
    vi.mocked(loadCodexSession).mockResolvedValue({ entries: [] });
    vi.mocked(mergeThreadItems).mockImplementation(
      (remoteItems: ConversationItem[]) => remoteItems,
    );
    vi.mocked(buildItemsFromThread).mockImplementation((thread) => {
      const id = (thread as { id?: string }).id;
      if (id === "thread-a") {
        return [
          {
            id: "user-a",
            kind: "message",
            role: "user",
            text: "hi",
          },
          {
            id: "assistant-a",
            kind: "message",
            role: "assistant",
            text: "alpha",
          },
        ];
      }
      if (id === "thread-b") {
        return [
          {
            id: "user-b",
            kind: "message",
            role: "user",
            text: "hi",
          },
          {
            id: "assistant-b",
            kind: "message",
            role: "assistant",
            text: "beta",
          },
        ];
      }
      return [];
    });
    const rememberThreadAlias = vi.fn();

    const { result, dispatch } = renderActions({
      useUnifiedHistoryLoader: true,
      rememberThreadAlias,
      itemsByThread: {
        "thread-stale": [
          {
            id: "user-stale",
            kind: "message",
            role: "user",
            text: "hi",
          },
          {
            id: "assistant-stale",
            kind: "message",
            role: "assistant",
            text: "alpha",
          },
          {
            id: "assistant-error",
            kind: "message",
            role: "assistant",
            text: "会话启动失败： thread not found: thread-stale",
          },
        ],
      },
      threadsByWorkspace: {
        "ws-1": [
          {
            id: "thread-stale",
            name: "hi",
            updatedAt: 10,
            engineSource: "codex",
            threadKind: "native",
          },
        ],
      },
      activeThreadIdByWorkspace: {
        "ws-1": "thread-stale",
      },
    });

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace, { preserveState: true });
    });
    dispatch.mockClear();

    let resumed: string | null = null;
    await act(async () => {
      resumed = await result.current.resumeThreadForWorkspace("ws-1", "thread-stale");
    });

    expect(resumed).toBe("thread-a");
    expect(rememberThreadAlias).toHaveBeenCalledWith("thread-stale", "thread-a");
    expect(dispatch).toHaveBeenCalledWith({
      type: "setActiveThreadId",
      workspaceId: "ws-1",
      threadId: "thread-a",
    });
  });

  it("recovers stale unified codex threads by a sole newly discovered replacement thread when local history is insufficient", async () => {
    vi.mocked(resumeThread).mockImplementation(
      async (_workspaceId: string, threadId: string) => {
        if (threadId === "thread-stale") {
          throw new Error("thread not found: thread-stale");
        }
        return {
          result: {
            thread: {
              id: threadId,
              turns: [{ id: `turn-${threadId}`, items: [] }],
            },
          },
        };
      },
    );
    vi.mocked(listThreads).mockResolvedValue({
      result: {
        data: [
          {
            id: "thread-recovered",
            preview: "1",
            updatedAt: 105,
            updated_at: 105,
            cwd: "/tmp/codex",
          },
          {
            id: "thread-known",
            preview: "1",
            updatedAt: 90,
            updated_at: 90,
            cwd: "/tmp/codex",
          },
        ],
        nextCursor: null,
      },
    });
    vi.mocked(loadCodexSession).mockResolvedValue({ entries: [] });
    vi.mocked(buildItemsFromThread).mockImplementation((thread) => {
      const id = (thread as { id?: string }).id;
      if (id === "thread-recovered") {
        return [
          {
            id: "assistant-recovered",
            kind: "message",
            role: "assistant",
            text: "Recovered",
          },
        ];
      }
      return [];
    });
    const rememberThreadAlias = vi.fn();

    const { result, dispatch } = renderActions({
      useUnifiedHistoryLoader: true,
      rememberThreadAlias,
      threadActivityRef: {
        current: {
          "ws-1": {
            "thread-stale": 100,
          },
        },
      },
      itemsByThread: {
        "thread-stale": [
          {
            id: "assistant-error",
            kind: "message",
            role: "assistant",
            text: "会话启动失败： thread not found: thread-stale",
          },
        ],
      },
      threadsByWorkspace: {
        "ws-1": [
          {
            id: "thread-stale",
            name: "1",
            updatedAt: 100,
            engineSource: "codex",
            threadKind: "native",
          },
          {
            id: "thread-known",
            name: "1",
            updatedAt: 90,
            engineSource: "codex",
            threadKind: "native",
          },
        ],
      },
      activeThreadIdByWorkspace: {
        "ws-1": "thread-stale",
      },
    });

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace, { preserveState: true });
    });
    dispatch.mockClear();

    let resumed: string | null = null;
    await act(async () => {
      resumed = await result.current.resumeThreadForWorkspace("ws-1", "thread-stale");
    });

    expect(resumed).toBe("thread-recovered");
    expect(rememberThreadAlias).toHaveBeenCalledWith("thread-stale", "thread-recovered");
    expect(dispatch).toHaveBeenCalledWith({
      type: "setActiveThreadId",
      workspaceId: "ws-1",
      threadId: "thread-recovered",
    });
  });

  it("ends loading when live thread list times out during a non-preserved refresh", async () => {
    vi.useFakeTimers();
    vi.mocked(listThreads).mockImplementation(
      () => new Promise(() => undefined),
    );

    const { result, dispatch } = renderActions();

    const refreshPromise = result.current.listThreadsForWorkspace(workspace);
    const onSettled = vi.fn();
    void refreshPromise.then(onSettled);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(onSettled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(31_000);
    await refreshPromise;

    expect(dispatch).toHaveBeenCalledWith({
      type: "setThreadListLoading",
      workspaceId: "ws-1",
      isLoading: true,
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "setThreadListLoading",
      workspaceId: "ws-1",
      isLoading: false,
    });
  });

  it("ends loading when native session providers hang for an empty workspace", async () => {
    vi.useFakeTimers();
    vi.mocked(listThreads).mockResolvedValue({
      data: [],
      nextCursor: null,
    });
    vi.mocked(listClaudeSessions).mockImplementation(
      () => new Promise(() => undefined),
    );
    vi.mocked(getOpenCodeSessionList).mockImplementation(
      () => new Promise(() => undefined),
    );

    const { result, dispatch } = renderActions();

    const refreshPromise = result.current.listThreadsForWorkspace(workspace);
    const onSettled = vi.fn();
    void refreshPromise.then(onSettled);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(onSettled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(31_000);
    await refreshPromise;

    expect(dispatch).toHaveBeenCalledWith({
      type: "setThreadListLoading",
      workspaceId: "ws-1",
      isLoading: true,
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "setThreadListLoading",
      workspaceId: "ws-1",
      isLoading: false,
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "setThreads",
      workspaceId: "ws-1",
      threads: [],
    });
  });

  it("ignores stale thread list responses that finish after a newer refresh", async () => {
    type ThreadListResponse = Awaited<ReturnType<typeof listThreads>>;
    const createDeferred = <T,>() => {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((nextResolve) => {
        resolve = nextResolve;
      });
      return { promise, resolve };
    };

    const firstResponse = createDeferred<ThreadListResponse>();
    const secondResponse = createDeferred<ThreadListResponse>();
    vi.mocked(listThreads)
      .mockImplementationOnce(() => firstResponse.promise)
      .mockImplementationOnce(() => secondResponse.promise);
    vi.mocked(listClaudeSessions).mockResolvedValue([]);
    vi.mocked(getOpenCodeSessionList).mockResolvedValue([]);
    vi.mocked(getThreadTimestamp).mockImplementation((thread) => {
      const updatedAt = (thread as { updated_at?: number; updatedAt?: number }).updated_at
        ?? (thread as { updated_at?: number; updatedAt?: number }).updatedAt
        ?? 0;
      return updatedAt;
    });

    const { result, dispatch } = renderActions();

    const firstRefresh = result.current.listThreadsForWorkspace(workspace);
    const secondRefresh = result.current.listThreadsForWorkspace(workspace);

    await act(async () => {
      secondResponse.resolve({
        result: {
          data: [{ id: "thread-new", cwd: "/tmp/codex", preview: "new", updated_at: 200 }],
          nextCursor: null,
        },
      });
      await Promise.resolve();
    });

    await act(async () => {
      firstResponse.resolve({
        result: {
          data: [{ id: "thread-old", cwd: "/tmp/codex", preview: "old", updated_at: 100 }],
          nextCursor: null,
        },
      });
      await Promise.resolve();
    });

    await act(async () => {
      await Promise.all([firstRefresh, secondRefresh]);
    });

    const setThreadsCalls = dispatch.mock.calls
      .map(([action]) => action)
      .filter((action) => action?.type === "setThreads");

    expect(setThreadsCalls).toHaveLength(1);
    expect(setThreadsCalls[0]).toEqual({
      type: "setThreads",
      workspaceId: "ws-1",
      threads: [
        expect.objectContaining({
          id: "thread-new",
          name: "new",
          updatedAt: 200,
        }),
      ],
    });
  });

  it("recovers stale unified OpenCode thread ids from refreshed native sessions", async () => {
    vi.mocked(resumeThread).mockImplementation(
      async (_workspaceId: string, threadId: string) => {
        if (threadId === "opencode:stale") {
          throw new Error("[session_not_found] session file not found");
        }
        return {
          result: {
            thread: {
              id: "opencode:session-2",
              turns: [{ id: "turn-2", items: [] }],
            },
          },
        };
      },
    );
    vi.mocked(getOpenCodeSessionList).mockResolvedValue([
      {
        sessionId: "session-2",
        title: "OpenCode Session",
        updatedLabel: "just now",
        updatedAt: 200,
      },
    ]);
    vi.mocked(buildItemsFromThread).mockReturnValue([
      {
        id: "assistant-opencode",
        kind: "message",
        role: "assistant",
        text: "Recovered OpenCode",
      },
    ]);
    const rememberThreadAlias = vi.fn();

    const { result, dispatch } = renderActions({
      useUnifiedHistoryLoader: true,
      rememberThreadAlias,
      threadsByWorkspace: {
        "ws-1": [
          {
            id: "opencode:stale",
            name: "OpenCode Session",
            updatedAt: 10,
            engineSource: "opencode",
            threadKind: "native",
          },
        ],
      },
      activeThreadIdByWorkspace: {
        "ws-1": "opencode:stale",
      },
    });

    let resumed: string | null = null;
    await act(async () => {
      resumed = await result.current.resumeThreadForWorkspace("ws-1", "opencode:stale");
    });

    expect(resumed).toBe("opencode:session-2");
    expect(rememberThreadAlias).toHaveBeenCalledWith(
      "opencode:stale",
      "opencode:session-2",
    );
    expect(dispatch).toHaveBeenCalledWith({
      type: "setActiveThreadId",
      workspaceId: "ws-1",
      threadId: "opencode:session-2",
    });
  });

  it("hydrates user input queue from unified history snapshots", async () => {
    const assistantItem: ConversationItem = {
      id: "assistant-unified-user-input",
      kind: "message",
      role: "assistant",
      text: "Need confirmation",
    };
    vi.mocked(buildItemsFromThread).mockReturnValue([assistantItem]);
    vi.mocked(resumeThread).mockResolvedValue({
      result: {
        thread: {
          user_input_queue: [
            {
              request_id: "req-9",
              params: {
                turn_id: "turn-9",
                item_id: "tool-9",
                questions: [
                  {
                    id: "confirm",
                    header: "Confirm",
                    question: "Proceed?",
                    options: [{ label: "Yes", description: "Continue." }],
                  },
                ],
              },
            },
          ],
          turns: [
            {
              id: "turn-9",
              explanation: "Plan",
              plan: [{ step: "Verify", status: "in_progress" }],
            },
          ],
        },
      },
    });

    const { result, dispatch } = renderActions({
      useUnifiedHistoryLoader: true,
    });

    await act(async () => {
      await result.current.resumeThreadForWorkspace("ws-1", "thread-user-input");
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "clearUserInputRequestsForThread",
      workspaceId: "ws-1",
      threadId: "thread-user-input",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "addUserInputRequest",
      request: {
        workspace_id: "ws-1",
        request_id: "req-9",
        params: {
          thread_id: "thread-user-input",
          turn_id: "turn-9",
          item_id: "tool-9",
          questions: [
            {
              id: "confirm",
              header: "Confirm",
              question: "Proceed?",
              isOther: false,
              isSecret: false,
              options: [{ label: "Yes", description: "Continue." }],
            },
          ],
        },
      },
    });
  });

  it("keeps local pending user input queue when unified snapshot has pending ask tool but empty queue", async () => {
    vi.mocked(buildItemsFromThread).mockImplementation(() => [
      {
        id: "ask-tool-1",
        kind: "tool",
        toolType: "askuserquestion",
        title: "Tool: askuserquestion",
        detail: "",
        status: "started",
      },
      {
        id: "assistant-after-ask",
        kind: "message",
        role: "assistant",
        text: "请先选择一个选项。",
      },
    ]);
    vi.mocked(loadCodexSession).mockResolvedValue(null);
    vi.mocked(mergeThreadItems).mockImplementation(
      (baseItems) => baseItems as ConversationItem[],
    );
    vi.mocked(resumeThread).mockResolvedValue({
      result: {
        thread: {
          user_input_queue: [],
          turns: [{ id: "turn-ask", items: [] }],
        },
      },
    });

    const { result, dispatch } = renderActions({
      useUnifiedHistoryLoader: true,
      itemsByThread: {
        "thread-ask-pending": [
          {
            id: "ask-tool-local",
            kind: "tool",
            toolType: "askuserquestion",
            title: "Tool: askuserquestion",
            detail: "",
            status: "started",
          },
        ],
      },
      userInputRequests: [
        {
          workspace_id: "ws-1",
          request_id: "req-local-pending-1",
          params: {
            thread_id: "thread-ask-pending",
            turn_id: "turn-local",
            item_id: "ask-tool-local",
            questions: [
              {
                id: "q-1",
                header: "技术兴趣",
                question: "你对哪些技术领域感兴趣？",
                isOther: false,
                isSecret: false,
                multiSelect: true,
                options: [{ label: "前端开发", description: "React/Vue" }],
              },
            ],
          },
        },
      ],
    });

    await act(async () => {
      await result.current.resumeThreadForWorkspace("ws-1", "thread-ask-pending");
    });

    const dispatchedTypes = dispatch.mock.calls.map((entry) => entry[0]?.type);
    expect(dispatchedTypes).not.toContain("clearUserInputRequestsForThread");
    expect(dispatchedTypes).not.toContain("addUserInputRequest");
  });

  it("restores collab parent links from unified codex history snapshots", async () => {
    vi.mocked(resumeThread).mockResolvedValue({
      result: {
        thread: {
          turns: [
            {
              id: "turn-1",
              items: [],
            },
          ],
        },
      },
    });
    vi.mocked(loadCodexSession).mockResolvedValue(null);
    vi.mocked(buildItemsFromThread).mockReturnValue([
      {
        id: "collab-1",
        kind: "tool",
        toolType: "collabToolCall",
        title: "Collab: spawn_agent",
        detail: "From thread-unified-links → agent-7",
        status: "completed",
        output: "run in parallel",
      },
    ]);
    vi.mocked(mergeThreadItems).mockImplementation(
      (baseItems) => baseItems as ConversationItem[],
    );

    const { result, updateThreadParent } = renderActions({
      useUnifiedHistoryLoader: true,
    });

    await act(async () => {
      await result.current.resumeThreadForWorkspace("ws-1", "thread-unified-links");
    });

    expect(updateThreadParent).toHaveBeenCalledWith("thread-unified-links", ["agent-7"]);
  });

  it("hydrates related child threads from unified collab history snapshot", async () => {
    vi.mocked(resumeThread).mockImplementation(
      async (_workspaceId: string, threadId: string) => {
        if (threadId === "thread-root") {
          return {
            result: {
              thread: {
                turns: [{ id: "turn-root", items: [{ type: "collabToolCall" }] }],
              },
            },
          };
        }
        if (threadId === "child-1") {
          return {
            result: {
              thread: {
                turns: [{ id: "turn-child", items: [{ type: "commandExecution" }] }],
              },
            },
          };
        }
        return null;
      },
    );
    vi.mocked(loadCodexSession).mockResolvedValue(null);
    vi.mocked(buildItemsFromThread).mockImplementation((thread) => {
      const firstItemType = (thread as { turns?: Array<{ items?: Array<{ type?: string }> }> })
        .turns?.[0]?.items?.[0]?.type;
      if (firstItemType === "collabToolCall") {
        return [
          {
            id: "collab-root-1",
            kind: "tool",
            toolType: "collabToolCall",
            title: "Collab: spawn_agent",
            detail: "From thread-root → child-1",
            status: "completed",
            output: "",
          },
        ] satisfies ConversationItem[];
      }
      if (firstItemType === "commandExecution") {
        return [
          {
            id: "cmd-child-1",
            kind: "tool",
            toolType: "commandExecution",
            title: "Command",
            detail: "pwd",
            status: "completed",
            output: "/repo",
          },
        ] satisfies ConversationItem[];
      }
      return [];
    });

    const { result, dispatch } = renderActions({
      useUnifiedHistoryLoader: true,
    });

    await act(async () => {
      await result.current.resumeThreadForWorkspace("ws-1", "thread-root");
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "child-1",
      engine: "codex",
    });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "setThreadItems",
        threadId: "child-1",
      }),
    );
  });

  it("lists threads for a workspace and persists activity", async () => {
    vi.mocked(listThreads).mockResolvedValue({
      result: {
        data: [
          {
            id: "thread-1",
            cwd: "/tmp/codex",
            preview: "Remote preview",
            updated_at: 5000,
            size_bytes: 4096,
          },
          {
            id: "thread-2",
            cwd: "/other",
            preview: "Ignore",
            updated_at: 7000,
          },
        ],
        nextCursor: "cursor-1",
      },
    });
    vi.mocked(getThreadTimestamp).mockImplementation((thread) => {
      const value = (thread as Record<string, unknown>).updated_at as number;
      return value ?? 0;
    });

    const { result, dispatch, threadActivityRef } = renderActions({
      getCustomName: (workspaceId, threadId) =>
        workspaceId === "ws-1" && threadId === "thread-1" ? "Custom" : undefined,
      threadActivityRef: { current: {} },
    });

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace);
    });

    expect(listThreads).toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith({
      type: "setThreadListLoading",
      workspaceId: "ws-1",
      isLoading: true,
    });
    expectSetThreadsDispatched(dispatch, "ws-1", [
      {
        id: "thread-1",
        name: "Custom",
        updatedAt: 5000,
        sizeBytes: 4096,
        engineSource: "codex",
      },
    ]);
    expect(dispatch).toHaveBeenCalledWith({
      type: "setThreadListCursor",
      workspaceId: "ws-1",
      cursor: "runtime::cursor-1",
    });
    expect(saveThreadActivity).toHaveBeenCalledWith({
      "ws-1": { "thread-1": 5000 },
    });
    expect(threadActivityRef.current).toEqual({
      "ws-1": { "thread-1": 5000 },
    });
  });

  it("filters archived and Codex helper thread entries while keeping vscode sessions", async () => {
    vi.mocked(listThreads).mockResolvedValue({
      result: {
        data: [
          {
            id: "thread-valid",
            cwd: "/tmp/codex",
            preview: "Visible thread",
            updated_at: 6200,
            source: "cli",
          },
          {
            id: "thread-archived",
            cwd: "/tmp/codex",
            preview: "Should hide archived",
            updated_at: 6100,
            archived: true,
            source: "cli",
          },
          {
            id: "thread-vscode",
            cwd: "/tmp/codex",
            preview: "Should keep vscode",
            updated_at: 6000,
            source: "vscode",
          },
          {
            id: "thread-helper-title",
            cwd: "/tmp/codex",
            preview:
              "Generate a concise title for a coding chat thread from the first user message. Return only title text.",
            updated_at: 5900,
            source: "cli",
          },
          {
            id: "thread-helper-project-info",
            cwd: "/tmp/codex",
            preview:
              "You are generating OpenSpec project context. Return ONLY valid JSON with keys:",
            updated_at: 5800,
            source: "cli",
          },
          {
            id: "thread-memory-writing",
            cwd: "/tmp/codex",
            preview:
              "## Memory Writing Agent: Phase 2 (Consolidation)\n\nConsolidate raw memories.",
            updated_at: 5750,
            source: "cli",
          },
          {
            id: "thread-commit-message",
            cwd: "/tmp/codex",
            preview: "Generate a concise git commit message for the following changes.",
            updated_at: 5700,
            source: "cli",
          },
        ],
        nextCursor: null,
      },
    });
    vi.mocked(getThreadTimestamp).mockImplementation((thread) => {
      const value = (thread as Record<string, unknown>).updated_at as number;
      return value ?? 0;
    });

    const { result, dispatch } = renderActions();

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace);
    });

    expectSetThreadsDispatched(dispatch, "ws-1", [
      {
        id: "thread-valid",
        name: "Visible thread",
        updatedAt: 6200,
        engineSource: "codex",
        source: "cli",
        provider: undefined,
        sourceLabel: "cli",
      },
      {
        id: "thread-vscode",
        name: "Should keep vscode",
        updatedAt: 6000,
        engineSource: "codex",
        source: "vscode",
        provider: undefined,
        sourceLabel: "vscode",
      },
      {
        id: "thread-commit-message",
        name: "Generate a concise git commit message for the following changes.",
        updatedAt: 5700,
        engineSource: "codex",
        source: "cli",
        provider: undefined,
        sourceLabel: "cli",
      },
    ]);
  });

  it("filters sessions archived in the workspace catalog", async () => {
    vi.mocked(listThreads).mockResolvedValue({
      result: {
        data: [
          {
            id: "thread-visible",
            cwd: "/tmp/codex",
            preview: "Visible thread",
            updated_at: 6200,
            source: "cli",
          },
          {
            id: "thread-catalog-archived",
            cwd: "/tmp/codex",
            preview: "Should hide from catalog",
            updated_at: 6100,
            source: "cli",
          },
        ],
        nextCursor: null,
      },
    });
    vi.mocked(listWorkspaceSessions).mockResolvedValue({
      data: [
        {
          sessionId: "thread-catalog-archived",
          workspaceId: "ws-1",
          engine: "codex",
          title: "Should hide from catalog",
          updatedAt: 6100,
          archivedAt: 1710000000000,
          threadKind: "native",
          sourceLabel: "cli/codex",
        },
      ],
      nextCursor: null,
      partialSource: null,
    });
    vi.mocked(getThreadTimestamp).mockImplementation((thread) => {
      const value = (thread as Record<string, unknown>).updated_at as number;
      return value ?? 0;
    });

    const { result, dispatch } = renderActions();

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace);
    });

    expect(listWorkspaceSessions).toHaveBeenCalledWith("ws-1", {
      query: { status: "all" },
      cursor: null,
      limit: 200,
    });
    expectSetThreadsDispatched(dispatch, "ws-1", [
      {
        id: "thread-visible",
        name: "Visible thread",
        updatedAt: 6200,
        engineSource: "codex",
      },
    ]);
  });

  it("hydrates first-page active project catalog sessions across engines and preserves older cursor", async () => {
    vi.mocked(listThreads).mockResolvedValue({
      result: {
        data: [
          {
            id: "thread-window",
            cwd: "/tmp/codex",
            preview: "Visible live window",
            updated_at: 8000,
            source: "cli",
          },
        ],
        nextCursor: "offset:50",
      },
    });
    vi.mocked(listClaudeSessions).mockResolvedValue([]);
    vi.mocked(listWorkspaceSessions).mockImplementation(async (_workspaceId, options) => {
      if (options?.query?.status === "all") {
        return {
          data: [],
          nextCursor: null,
          partialSource: null,
        };
      }
      expect(options?.cursor).not.toBe("offset:200");
      return {
        data: [
          {
            sessionId: "claude:project-old",
            workspaceId: "ws-1",
            engine: "claude",
            title: "Claude older active",
            updatedAt: 7000,
            archivedAt: null,
            threadKind: "native",
            folderId: "folder-a",
          },
          {
            sessionId: "codex:project-old",
            workspaceId: "ws-1",
            engine: "codex",
            title: "Codex older active",
            updatedAt: 6900,
            archivedAt: null,
            threadKind: "native",
          },
        ],
        nextCursor: "offset:200",
        partialSource: null,
      };
    });
    vi.mocked(getThreadTimestamp).mockImplementation((thread) => {
      const value = (thread as Record<string, unknown>).updated_at as number;
      return value ?? 0;
    });

    const { result, dispatch } = renderActions();

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace);
    });

    expect(listWorkspaceSessions).toHaveBeenCalledWith("ws-1", {
      query: { status: "active" },
      cursor: null,
      limit: 200,
    });
    expectSetThreadsDispatched(dispatch, "ws-1", [
      {
        id: "thread-window",
        name: "Visible live window",
        updatedAt: 8000,
        engineSource: "codex",
      },
      {
        id: "claude:project-old",
        name: "Claude older active",
        updatedAt: 7000,
        engineSource: "claude",
        folderId: "folder-a",
      },
      {
        id: "codex:project-old",
        name: "Codex older active",
        updatedAt: 6900,
        engineSource: "codex",
        folderId: null,
      },
    ]);
    expect(dispatch).toHaveBeenCalledWith({
      type: "setThreadListCursor",
      workspaceId: "ws-1",
      cursor: "catalog::offset:200",
    });
  });

  it("uses project visible root count as the Claude native list window", async () => {
    vi.mocked(listThreads).mockResolvedValue({
      result: {
        data: [],
        nextCursor: null,
      },
    });
    vi.mocked(listClaudeSessions).mockResolvedValue([
      {
        sessionId: "claude-visible-200",
        firstMessage: "Claude session inside configured window",
        updatedAt: 7000,
      },
    ]);
    vi.mocked(listWorkspaceSessions).mockResolvedValue({
      data: [],
      nextCursor: null,
      partialSource: null,
    });

    const { result, dispatch } = renderActions();

    await act(async () => {
      await result.current.listThreadsForWorkspace({
        ...workspace,
        settings: {
          ...workspace.settings,
          visibleThreadRootCount: 200,
        },
      });
    });

    expect(listClaudeSessions).toHaveBeenCalledWith("/tmp/codex", 200);
    expectSetThreadsDispatched(dispatch, "ws-1", [
      {
        id: "claude:claude-visible-200",
        name: "Claude session inside configured window",
        updatedAt: 7000,
        engineSource: "claude",
      },
    ]);
  });

  it("keeps startup first-page hydration out of native and project session catalogs", async () => {
    vi.mocked(listThreads).mockResolvedValue({
      result: {
        data: [
          {
            id: "thread-window",
            cwd: "/tmp/codex",
            preview: "Visible live window",
            updated_at: 8000,
            source: "cli",
          },
        ],
        nextCursor: "offset:50",
      },
    });
    vi.mocked(listClaudeSessions).mockResolvedValue([
      {
        sessionId: "claude-slow",
        firstMessage: "Slow Claude session",
        updatedAt: 7000,
      },
    ]);
    vi.mocked(getOpenCodeSessionList).mockResolvedValue([
      {
        sessionId: "opencode-slow",
        title: "Slow OpenCode session",
        updatedLabel: "1m ago",
        updatedAt: 6900,
      },
    ]);
    vi.mocked(listWorkspaceSessions).mockResolvedValue({
      data: [
        {
          sessionId: "codex:catalog-slow",
          workspaceId: "ws-1",
          engine: "codex",
          title: "Catalog slow",
          updatedAt: 6800,
          archivedAt: null,
          threadKind: "native",
        },
      ],
      nextCursor: "offset:200",
      partialSource: null,
    });
    vi.mocked(getThreadTimestamp).mockImplementation((thread) => {
      const value = (thread as Record<string, unknown>).updated_at as number;
      return value ?? 0;
    });

    const { result, dispatch } = renderActions();

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace, {
        startupHydrationMode: "first-page",
      });
    });

    expect(listThreads).toHaveBeenCalledTimes(1);
    expect(listClaudeSessions).not.toHaveBeenCalled();
    expect(getOpenCodeSessionList).not.toHaveBeenCalled();
    expect(listGeminiSessions).not.toHaveBeenCalled();
    expect(listWorkspaceSessions).not.toHaveBeenCalled();
    expectSetThreadsDispatched(dispatch, "ws-1", [
      {
        id: "thread-window",
        name: "Visible live window",
        updatedAt: 8000,
        engineSource: "codex",
      },
    ]);
    expect(dispatch).toHaveBeenCalledWith({
      type: "setThreadListCursor",
      workspaceId: "ws-1",
      cursor: "runtime::offset:50",
    });
    vi.mocked(listClaudeSessions).mockResolvedValue([]);
    vi.mocked(getOpenCodeSessionList).mockResolvedValue([]);
    vi.mocked(listWorkspaceSessions).mockResolvedValue({
      data: [],
      nextCursor: null,
      partialSource: null,
    });
  });

  it("preserves last-good Claude rows during startup first-page hydration", async () => {
    vi.mocked(listThreads).mockResolvedValue({
      result: {
        data: [
          {
            id: "thread-window",
            cwd: "/tmp/codex",
            preview: "Visible live window",
            updated_at: 8000,
          },
        ],
        nextCursor: "offset:50",
      },
    });
    vi.mocked(getThreadTimestamp).mockImplementation((thread) => {
      const value = (thread as Record<string, unknown>).updated_at as number;
      return value ?? 0;
    });

    const { result, dispatch } = renderActions({
      threadsByWorkspace: {
        "ws-1": [
          {
            id: "claude:parent-session",
            name: "父会话",
            updatedAt: 7600,
            engineSource: "claude",
            threadKind: "native",
          },
          {
            id: "claude:child-session",
            name: "子会话",
            updatedAt: 7500,
            engineSource: "claude",
            threadKind: "native",
            parentThreadId: "claude:parent-session",
          },
        ],
      },
    });

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace, {
        startupHydrationMode: "first-page",
      });
    });

    expect(listClaudeSessions).not.toHaveBeenCalled();
    expectSetThreadsDispatched(dispatch, "ws-1", [
      {
        id: "thread-window",
        name: "Visible live window",
        updatedAt: 8000,
        engineSource: "codex",
      },
      {
        id: "claude:parent-session",
        name: "父会话",
        updatedAt: 7600,
        engineSource: "claude",
      },
      {
        id: "claude:child-session",
        name: "子会话",
        updatedAt: 7500,
        engineSource: "claude",
        parentThreadId: "claude:parent-session",
      },
    ]);
  });

  it("keeps known codex threads when local session scan is unavailable and cwd is missing", async () => {
    vi.mocked(listThreads).mockResolvedValue({
      result: {
        data: [
          {
            id: "thread-known",
            preview: "Known recovered",
            updated_at: 7200,
          },
          {
            id: "thread-unknown",
            preview: "Unknown dropped",
            updated_at: 7100,
          },
        ],
        nextCursor: null,
        partialSource: "local-session-scan-unavailable",
      },
    });
    vi.mocked(getThreadTimestamp).mockImplementation((thread) => {
      const value = (thread as Record<string, unknown>).updated_at as number;
      return value ?? 0;
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
      await result.current.listThreadsForWorkspace(workspace);
    });

    expectSetThreadsDispatched(dispatch, "ws-1", [
      {
        id: "thread-known",
        name: "Known recovered",
        updatedAt: 7200,
        engineSource: "codex",
      },
    ]);
  });

  it("marks thread list with Claude-specific partial source when Claude history listing fails", async () => {
    vi.mocked(listThreads).mockResolvedValue({
      result: {
        data: [
          {
            id: "thread-known",
            preview: "Known recovered",
            updated_at: 7200,
          },
        ],
        nextCursor: null,
      },
    });
    vi.mocked(listClaudeSessions).mockRejectedValue(
      new Error("large payload scan failed"),
    );
    vi.mocked(getThreadTimestamp).mockImplementation((thread) => {
      const value = (thread as Record<string, unknown>).updated_at as number;
      return value ?? 0;
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
      await result.current.listThreadsForWorkspace(workspace);
    });

    expectSetThreadsDispatched(dispatch, "ws-1", [
      {
        id: "thread-known",
        name: "Known old",
        updatedAt: 7000,
        engineSource: "codex",
        partialSource: "claude-session-error",
        isDegraded: true,
        degradedReason: "last-good-fallback",
      },
    ]);
  });

  it("keeps last-good Claude rows and relationships when Claude native listing fails", async () => {
    vi.mocked(listThreads).mockResolvedValue({
      result: {
        data: [
          {
            id: "thread-known",
            cwd: "/tmp/codex",
            preview: "Known recovered",
            updated_at: 7200,
          },
        ],
        nextCursor: null,
      },
    });
    vi.mocked(listClaudeSessions).mockRejectedValue(new Error("native scan failed"));
    vi.mocked(getThreadTimestamp).mockImplementation((thread) => {
      const value = (thread as Record<string, unknown>).updated_at as number;
      return value ?? 0;
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
          {
            id: "claude:parent-session",
            name: "稳定父会话",
            updatedAt: 6900,
            engineSource: "claude",
            threadKind: "native",
          },
          {
            id: "claude:child-session",
            name: "稳定子会话",
            updatedAt: 6800,
            engineSource: "claude",
            threadKind: "native",
            parentThreadId: "claude:parent-session",
          },
        ],
      },
      activeThreadIdByWorkspace: {
        "ws-1": "thread-known",
      },
    });

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace);
    });

    expectSetThreadsDispatched(dispatch, "ws-1", [
      {
        id: "thread-known",
        name: "Known recovered",
        updatedAt: 7200,
        engineSource: "codex",
        partialSource: "claude-session-error",
        isDegraded: true,
      },
      {
        id: "claude:parent-session",
        name: "稳定父会话",
        updatedAt: 6900,
        engineSource: "claude",
        partialSource: "claude-session-error",
        isDegraded: true,
      },
      {
        id: "claude:child-session",
        name: "稳定子会话",
        updatedAt: 6800,
        engineSource: "claude",
        parentThreadId: "claude:parent-session",
        partialSource: "claude-session-error",
        isDegraded: true,
      },
    ]);
  });

  it("falls back to last-good summaries when providers return an unexpected empty list", async () => {
    vi.mocked(listThreads).mockResolvedValue({
      result: {
        data: [],
        nextCursor: null,
      },
    });
    const onDebug = vi.fn();

    const { result, dispatch } = renderActions({
      onDebug,
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
    });

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace);
    });

    expectSetThreadsDispatched(dispatch, "ws-1", [
      {
        id: "thread-known",
        name: "Known old",
        updatedAt: 7000,
        engineSource: "codex",
        isDegraded: true,
        degradedReason: "last-good-fallback",
        partialSource: "empty-thread-list",
      },
    ]);
    const fallbackEntry = onDebug.mock.calls
      .map(([entry]) => entry as { label: string; payload?: Record<string, unknown> })
      .find((entry) => entry.label === "thread/list fallback");
    expect(fallbackEntry?.payload).toMatchObject({
      workspaceId: "ws-1",
      engine: "multi",
      action: "thread-list-fallback",
      recoveryState: "degraded",
      partialSource: "empty-thread-list",
    });
  });

  it("falls back to last-good thread summaries when thread list loading fails", async () => {
    vi.mocked(listThreads).mockRejectedValue(new Error("runtime unavailable"));
    const onDebug = vi.fn();

    const { result, dispatch } = renderActions({
      onDebug,
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
    });

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace);
    });

    expectSetThreadsDispatched(dispatch, "ws-1", [
      {
        id: "thread-known",
        name: "Known old",
        updatedAt: 7000,
        engineSource: "codex",
        isDegraded: true,
        degradedReason: "last-good-fallback",
        partialSource: "runtime unavailable",
      },
    ]);
    const fallbackEntry = onDebug.mock.calls
      .map(([entry]) => entry as { label: string; payload?: Record<string, unknown> })
      .find((entry) => entry.label === "thread/list error fallback");
    expect(fallbackEntry?.payload).toMatchObject({
      workspaceId: "ws-1",
      engine: "multi",
      action: "thread-list-error-fallback",
      recoveryState: "degraded",
      diagnosticCategory: "partial_history",
    });
  });

  it("stops scanning after capped empty pages when known activity exists", async () => {
    let calls = 0;
    vi.mocked(listThreads).mockImplementation(async () => {
      calls += 1;
      return {
        result: {
          data: [
            {
              id: `thread-${calls}`,
              cwd: "/other-workspace",
              preview: "No match",
              updated_at: calls,
            },
          ],
          nextCursor: calls >= 100 ? null : `cursor-${calls}`,
        },
      } as any;
    });

    const { result } = renderActions({
      threadActivityRef: {
        current: {
          "ws-1": {
            "known-thread": 123,
          },
        },
      },
    });

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace);
    });

    expect(listThreads).toHaveBeenCalledTimes(20);
  });

  it("merges opencode sessions into thread list", async () => {
    vi.mocked(listThreads).mockResolvedValue({
      result: {
        data: [],
        nextCursor: null,
      },
    });
    vi.mocked(listClaudeSessions).mockResolvedValue([]);
    vi.mocked(getOpenCodeSessionList).mockResolvedValue([
      {
        sessionId: "ses_opc_1",
        title: "OpenCode Hello",
        updatedLabel: "3m ago",
        updatedAt: 1_730_000_000_000,
      },
    ]);

    const { result, dispatch } = renderActions();

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace);
    });

    expectSetThreadsDispatched(dispatch, "ws-1", [
      {
        id: "opencode:ses_opc_1",
        name: "OpenCode Hello",
        updatedAt: 1_730_000_000_000,
        engineSource: "opencode",
      },
    ]);
  });

  it("can skip opencode probing while keeping existing opencode threads", async () => {
    vi.mocked(listThreads).mockResolvedValue({
      result: {
        data: [],
        nextCursor: null,
      },
    });
    vi.mocked(listClaudeSessions).mockResolvedValue([]);
    vi.mocked(getOpenCodeSessionList).mockResolvedValue([
      {
        sessionId: "ses_should_not_fetch",
        title: "Should not fetch",
        updatedLabel: "1m ago",
        updatedAt: 1_740_000_000_000,
      },
    ]);

    const { result, dispatch } = renderActions({
      threadsByWorkspace: {
        "ws-1": [
          {
            id: "opencode:ses_cached_1",
            name: "Cached OpenCode",
            updatedAt: 1_730_500_000_000,
            engineSource: "opencode",
            threadKind: "native",
          },
        ],
      },
    });

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace, {
        preserveState: true,
        includeOpenCodeSessions: false,
      });
    });

    expect(getOpenCodeSessionList).not.toHaveBeenCalled();
    expectSetThreadsDispatched(dispatch, "ws-1", [
      {
        id: "opencode:ses_cached_1",
        name: "Cached OpenCode",
        updatedAt: 1_730_500_000_000,
        engineSource: "opencode",
      },
    ]);
  });

  it("reconnects workspace and retries list when backend reports not connected", async () => {
    vi.mocked(listThreads)
      .mockRejectedValueOnce(new Error("workspace not connected"))
      .mockResolvedValueOnce({
        result: {
          data: [
            {
              id: "thread-1",
              cwd: "/tmp/codex",
              preview: "Recovered",
              updated_at: 1000,
            },
          ],
          nextCursor: null,
        },
      } as any);
    vi.mocked(listClaudeSessions).mockResolvedValue([]);
    vi.mocked(getOpenCodeSessionList).mockResolvedValue([]);
    vi.mocked(getThreadTimestamp).mockImplementation((thread) => {
      const value = (thread as Record<string, unknown>).updated_at as number;
      return value ?? 0;
    });

    const { result, dispatch } = renderActions();

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace);
    });

    expect(connectWorkspace).toHaveBeenCalledWith("ws-1", "thread-list-live");
    expect(listThreads).toHaveBeenCalledTimes(2);
    expectSetThreadsDispatched(dispatch, "ws-1", [
      {
        id: "thread-1",
        name: "Recovered",
        updatedAt: 1000,
        engineSource: "codex",
      },
    ]);
  });

  it("archives threads and reports errors", async () => {
    vi.mocked(archiveThread).mockRejectedValue(new Error("nope"));
    const onDebug = vi.fn();
    const { result } = renderActions({ onDebug });

    await expect(
      act(async () => {
        await result.current.archiveThread("ws-1", "thread-9");
      }),
    ).rejects.toThrow("nope");

    expect(archiveThread).toHaveBeenCalledWith("ws-1", "thread-9");
    expect(onDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "error",
        label: "thread/archive error",
        payload: "nope",
      }),
    );
  });

  it("renames persisted thread-title mapping keys", async () => {
    const onRenameThreadTitleMapping = vi.fn();
    const { result } = renderActions({
      onRenameThreadTitleMapping,
      getCustomName: (workspaceId, threadId) =>
        workspaceId === "ws-1" && threadId === "old-thread" ? "Title" : undefined,
    });

    await act(async () => {
      await result.current.renameThreadTitleMapping(
        "ws-1",
        "old-thread",
        "new-thread",
      );
    });

    expect(renameThreadTitleKey).toHaveBeenCalledWith(
      "ws-1",
      "old-thread",
      "new-thread",
    );
    expect(onRenameThreadTitleMapping).toHaveBeenCalledWith(
      "ws-1",
      "old-thread",
      "new-thread",
    );
  });

});
