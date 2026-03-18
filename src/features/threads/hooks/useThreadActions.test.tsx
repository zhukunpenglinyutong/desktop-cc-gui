// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationItem, WorkspaceInfo } from "../../../types";
import {
  archiveThread,
  deleteClaudeSession,
  deleteOpenCodeSession,
  forkClaudeSession,
  forkThread,
  getOpenCodeSessionList,
  listClaudeSessions,
  loadClaudeSession,
  loadCodexSession,
  listThreadTitles,
  renameThreadTitleKey,
  setThreadTitle,
  listThreads,
  resumeThread,
  startThread,
} from "../../../services/tauri";
import {
  buildItemsFromThread,
  getThreadTimestamp,
  isReviewingFromThread,
  mergeThreadItems,
  previewThreadName,
} from "../../../utils/threadItems";
import { saveThreadActivity } from "../utils/threadStorage";
import { useThreadActions } from "./useThreadActions";

vi.mock("../../../services/tauri", () => ({
  startThread: vi.fn(),
  forkClaudeSession: vi.fn(),
  forkThread: vi.fn(),
  listClaudeSessions: vi.fn(),
  getOpenCodeSessionList: vi.fn(),
  loadClaudeSession: vi.fn(),
  loadCodexSession: vi.fn(),
  listThreadTitles: vi.fn(),
  renameThreadTitleKey: vi.fn(),
  setThreadTitle: vi.fn(),
  resumeThread: vi.fn(),
  listThreads: vi.fn(),
  archiveThread: vi.fn(),
  deleteClaudeSession: vi.fn(),
  deleteOpenCodeSession: vi.fn(),
}));

vi.mock("../../../utils/threadItems", () => ({
  buildItemsFromThread: vi.fn(),
  getThreadTimestamp: vi.fn(),
  isReviewingFromThread: vi.fn(),
  mergeThreadItems: vi.fn(),
  previewThreadName: vi.fn(),
}));

vi.mock("../utils/threadStorage", () => ({
  saveThreadActivity: vi.fn(),
}));

describe("useThreadActions", () => {
  const workspace: WorkspaceInfo = {
    id: "ws-1",
    name: "MossX",
    path: "/tmp/codex",
    connected: true,
    settings: { sidebarCollapsed: false },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listThreadTitles).mockResolvedValue({});
    vi.mocked(getOpenCodeSessionList).mockResolvedValue([]);
    vi.mocked(renameThreadTitleKey).mockResolvedValue(undefined);
    vi.mocked(setThreadTitle).mockResolvedValue("title");
    vi.mocked(deleteClaudeSession).mockResolvedValue(undefined);
    vi.mocked(deleteOpenCodeSession).mockResolvedValue({
      deleted: true,
      method: "filesystem",
    });
  });

  function renderActions(
    overrides?: Partial<Parameters<typeof useThreadActions>[0]>,
  ) {
    const dispatch = vi.fn();
    const loadedThreadsRef = { current: {} as Record<string, boolean> };
    const replaceOnResumeRef = { current: {} as Record<string, boolean> };
    const threadActivityRef = {
      current: {} as Record<string, Record<string, number>>,
    };
    const applyCollabThreadLinksFromThread = vi.fn();
    const updateThreadParent = vi.fn();

    const args: Parameters<typeof useThreadActions>[0] = {
      dispatch,
      itemsByThread: {},
      threadsByWorkspace: {},
      activeThreadIdByWorkspace: {},
      threadListCursorByWorkspace: {},
      threadStatusById: {},
      getCustomName: () => undefined,
      threadActivityRef,
      loadedThreadsRef,
      replaceOnResumeRef,
      applyCollabThreadLinksFromThread,
      updateThreadParent,
      onThreadTitleMappingsLoaded: vi.fn(),
      onRenameThreadTitleMapping: vi.fn(),
      ...overrides,
    };

    const utils = renderHook(() => useThreadActions(args));

    return {
      dispatch,
      loadedThreadsRef: args.loadedThreadsRef,
      replaceOnResumeRef: args.replaceOnResumeRef,
      threadActivityRef: args.threadActivityRef,
      applyCollabThreadLinksFromThread: args.applyCollabThreadLinksFromThread,
      updateThreadParent: args.updateThreadParent,
      ...utils,
    };
  }

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
      type: "setActiveThreadId",
      workspaceId: "ws-1",
      threadId: "thread-1",
    });
    expect(loadedThreadsRef.current["thread-1"]).toBe(true);
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
      threadId = await result.current.forkThreadForWorkspace("ws-1", "thread-1");
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

    const { result, dispatch } = renderActions();

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

  it("forks a Claude session and keeps engine as claude", async () => {
    vi.mocked(listThreads).mockResolvedValue({
      result: {
        data: [],
        nextCursor: null,
      },
    } as any);
    vi.mocked(listClaudeSessions).mockResolvedValue([]);
    vi.mocked(forkClaudeSession).mockResolvedValue({
      thread: { id: "claude:forked-session-1" },
      sessionId: "forked-session-1",
    });
    vi.mocked(loadClaudeSession).mockResolvedValue({ messages: [] } as any);

    const { result, dispatch, loadedThreadsRef } = renderActions();

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace, { preserveState: true });
    });

    let threadId: string | null = null;
    await act(async () => {
      threadId = await result.current.forkThreadForWorkspace("ws-1", "claude:session-1");
    });

    expect(threadId).toBe("claude:forked-session-1");
    expect(forkClaudeSession).toHaveBeenCalledWith("/tmp/codex", "session-1");
    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "claude:forked-session-1",
      engine: "claude",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "setActiveThreadId",
      workspaceId: "ws-1",
      threadId: "claude:forked-session-1",
    });
    expect(loadedThreadsRef.current["claude:forked-session-1"]).toBe(true);
  });

  it("starts a thread without activating when requested", async () => {
    vi.mocked(startThread).mockResolvedValue({
      result: { thread: { id: "thread-2" } },
    });

    const { result, dispatch } = renderActions();

    await act(async () => {
      await result.current.startThreadForWorkspace("ws-1", { activate: false });
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
    expect(onDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "thread/history fallback",
      }),
    );
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
    vi.mocked(loadCodexSession).mockResolvedValue(undefined);
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
    vi.mocked(loadCodexSession).mockResolvedValue(undefined);
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
    expect(dispatch).toHaveBeenCalledWith({
      type: "setThreads",
      workspaceId: "ws-1",
      threads: [
        {
          id: "thread-1",
          name: "Custom",
          updatedAt: 5000,
          engineSource: "codex",
        },
      ],
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "setThreadListCursor",
      workspaceId: "ws-1",
      cursor: "cursor-1",
    });
    expect(saveThreadActivity).toHaveBeenCalledWith({
      "ws-1": { "thread-1": 5000 },
    });
    expect(threadActivityRef.current).toEqual({
      "ws-1": { "thread-1": 5000 },
    });
  });

  it("matches workspace path when thread cwd contains /private prefix", async () => {
    vi.mocked(listThreads).mockResolvedValue({
      result: {
        data: [
          {
            id: "thread-private-1",
            cwd: "/private/tmp/codex",
            preview: "Private prefix path",
            updated_at: 6100,
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

    expect(dispatch).toHaveBeenCalledWith({
      type: "setThreads",
      workspaceId: "ws-1",
      threads: [
        {
          id: "thread-private-1",
          name: "Private prefix path",
          updatedAt: 6100,
          engineSource: "codex",
        },
      ],
    });
  });

  it("matches Windows workspace path when thread cwd uses extended-length prefix", async () => {
    const windowsWorkspace: WorkspaceInfo = {
      ...workspace,
      id: "ws-win",
      path: "C:\\Users\\Chen\\project",
    };
    vi.mocked(listThreads).mockResolvedValue({
      result: {
        data: [
          {
            id: "thread-win-1",
            cwd: "\\\\?\\C:\\Users\\Chen\\project\\src",
            preview: "Windows extended path",
            updated_at: 6200,
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
      await result.current.listThreadsForWorkspace(windowsWorkspace);
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "setThreads",
      workspaceId: "ws-win",
      threads: [
        {
          id: "thread-win-1",
          name: "Windows extended path",
          updatedAt: 6200,
          engineSource: "codex",
        },
      ],
    });
  });

  it("matches Windows UNC workspace path when thread cwd uses \\?\\UNC prefix", async () => {
    const uncWorkspace: WorkspaceInfo = {
      ...workspace,
      id: "ws-unc",
      path: "\\\\SERVER\\Share\\project",
    };
    vi.mocked(listThreads).mockResolvedValue({
      result: {
        data: [
          {
            id: "thread-unc-1",
            cwd: "\\\\?\\UNC\\server\\share\\project\\src",
            preview: "UNC extended path",
            updated_at: 6300,
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
      await result.current.listThreadsForWorkspace(uncWorkspace);
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "setThreads",
      workspaceId: "ws-unc",
      threads: [
        {
          id: "thread-unc-1",
          name: "UNC extended path",
          updatedAt: 6300,
          engineSource: "codex",
        },
      ],
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

    expect(dispatch).toHaveBeenCalledWith({
      type: "setThreads",
      workspaceId: "ws-1",
      threads: [
        {
          id: "thread-valid",
          name: "Visible thread",
          updatedAt: 6200,
          engineSource: "codex",
        },
        {
          id: "thread-vscode",
          name: "Should keep vscode",
          updatedAt: 6000,
          engineSource: "codex",
        },
      ],
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

    expect(dispatch).toHaveBeenCalledWith({
      type: "setThreads",
      workspaceId: "ws-1",
      threads: [
        {
          id: "opencode:ses_opc_1",
          name: "OpenCode Hello",
          updatedAt: 1_730_000_000_000,
          engineSource: "opencode",
        },
      ],
    });
  });

  it("routes opencode hard delete to backend adapter", async () => {
    const { result } = renderActions();

    await act(async () => {
      await result.current.deleteThreadForWorkspace("ws-1", "opencode:ses_opc_1");
    });

    expect(archiveThread).not.toHaveBeenCalled();
    expect(deleteOpenCodeSession).toHaveBeenCalledWith("ws-1", "ses_opc_1");
  });

  it("keeps deleted claude sessions absent after reload", async () => {
    vi.mocked(listThreads).mockResolvedValue({
      result: {
        data: [],
        nextCursor: null,
      },
    });
    vi.mocked(getOpenCodeSessionList).mockResolvedValue([]);
    vi.mocked(listClaudeSessions)
      .mockResolvedValueOnce([
        {
          sessionId: "session-delete-me",
          firstMessage: "Delete me",
          updatedAt: 1_730_000_000_000,
        },
      ])
      .mockResolvedValueOnce([]);

    const { result, dispatch } = renderActions();

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace, { preserveState: true });
    });

    await act(async () => {
      await result.current.deleteThreadForWorkspace("ws-1", "claude:session-delete-me");
    });

    expect(deleteClaudeSession).toHaveBeenCalledWith("/tmp/codex", "session-delete-me");

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace, { preserveState: true });
    });

    const setThreadsActions = dispatch.mock.calls
      .map(([action]) => action)
      .filter((action) => action.type === "setThreads");
    expect(setThreadsActions.length).toBeGreaterThanOrEqual(2);
    expect(setThreadsActions[0]).toEqual({
      type: "setThreads",
      workspaceId: "ws-1",
      threads: [
        {
          id: "claude:session-delete-me",
          name: "Delete me",
          updatedAt: 1_730_000_000_000,
          engineSource: "claude",
        },
      ],
    });
    expect(setThreadsActions[setThreadsActions.length - 1]).toEqual({
      type: "setThreads",
      workspaceId: "ws-1",
      threads: [],
    });
  });

  it("preserves list state when requested", async () => {
    vi.mocked(listThreads).mockResolvedValue({
      result: {
        data: [],
        nextCursor: null,
      },
    });

    const { result, dispatch } = renderActions();

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace, {
        preserveState: true,
      });
    });

    expect(dispatch).not.toHaveBeenCalledWith({
      type: "setThreadListLoading",
      workspaceId: "ws-1",
      isLoading: true,
    });
  });

  it("loads older threads when a cursor is available", async () => {
    vi.mocked(listThreads).mockResolvedValue({
      result: {
        data: [
          {
            id: "thread-2",
            cwd: "/tmp/codex",
            preview: "Older preview",
            updated_at: 4000,
          },
        ],
        nextCursor: null,
      },
    });
    vi.mocked(getThreadTimestamp).mockImplementation((thread) => {
      const value = (thread as Record<string, unknown>).updated_at as number;
      return value ?? 0;
    });

    const { result, dispatch } = renderActions({
      threadsByWorkspace: {
        "ws-1": [{ id: "thread-1", name: "Agent 1", updatedAt: 6000 }],
      },
      threadListCursorByWorkspace: { "ws-1": "cursor-1" },
    });

    await act(async () => {
      await result.current.loadOlderThreadsForWorkspace(workspace);
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "setThreadListPaging",
      workspaceId: "ws-1",
      isLoading: true,
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "setThreads",
      workspaceId: "ws-1",
      threads: [
        { id: "thread-1", name: "Agent 1", updatedAt: 6000 },
        { id: "thread-2", name: "Older preview", updatedAt: 4000 },
      ],
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "setThreadListCursor",
      workspaceId: "ws-1",
      cursor: null,
    });
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

  it("skips claude history reload while turn is processing and local items exist", async () => {
    const { result } = renderActions({
      itemsByThread: {
        "claude:session-1": [
          {
            id: "reasoning-live-1",
            kind: "reasoning",
            summary: "正在分析",
            content: "正在分析",
          },
        ],
      },
      threadStatusById: {
        "claude:session-1": {
          isProcessing: true,
          hasUnread: false,
          isReviewing: false,
          processingStartedAt: Date.now(),
          lastDurationMs: null,
          heartbeatPulse: 1,
        },
      },
    });

    let resumed: string | null = null;
    await act(async () => {
      resumed = await result.current.resumeThreadForWorkspace(
        "ws-1",
        "claude:session-1",
      );
    });

    expect(resumed).toBe("claude:session-1");
    expect(loadClaudeSession).not.toHaveBeenCalled();
    expect(resumeThread).not.toHaveBeenCalled();
  });

  it("maps Claude tool_result to terminal status", async () => {
    vi.mocked(listThreads).mockResolvedValue({
      result: { data: [], nextCursor: null },
    });
    vi.mocked(listClaudeSessions).mockResolvedValue([]);
    vi.mocked(loadClaudeSession).mockResolvedValue({
      messages: [
        {
          id: "tool-1",
          kind: "tool",
          toolType: "Read",
          title: "Read",
          text: '{"file_path":"README.md"}',
        },
        {
          id: "tool-1-result",
          kind: "tool",
          toolType: "result",
          title: "Result",
          text: "",
        },
        {
          id: "tool-2",
          kind: "tool",
          toolType: "Bash",
          title: "Bash",
          text: '{"command":"echo ok"}',
        },
        {
          id: "tool-2-result",
          kind: "tool",
          toolType: "error",
          title: "Error",
          text: "permission denied",
        },
      ],
    });

    const { result, dispatch } = renderActions();

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace, {
        preserveState: true,
      });
    });

    dispatch.mockClear();

    await act(async () => {
      await result.current.resumeThreadForWorkspace("ws-1", "claude:session-1");
    });

    expect(loadClaudeSession).toHaveBeenCalledWith("/tmp/codex", "session-1");

    const setThreadItemsCall = dispatch.mock.calls.find(
      ([action]) =>
        action.type === "setThreadItems" && action.threadId === "claude:session-1",
    );
    expect(setThreadItemsCall).toBeTruthy();

    const action = setThreadItemsCall?.[0] as
      | { items?: ConversationItem[] }
      | undefined;
    const toolItems = (action?.items ?? []).filter(
      (item): item is Extract<ConversationItem, { kind: "tool" }> =>
        item.kind === "tool",
    );

    expect(toolItems).toHaveLength(2);
    expect(toolItems[0]).toEqual(
      expect.objectContaining({
        id: "tool-1",
        status: "completed",
      }),
    );
    expect(toolItems[1]).toEqual(
      expect.objectContaining({
        id: "tool-2",
        status: "failed",
        output: "permission denied",
      }),
    );
  });
});
