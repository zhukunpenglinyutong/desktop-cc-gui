// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationItem, WorkspaceInfo } from "../../../types";
import {
  connectWorkspace,
  createWorkspaceDirectory,
  deleteCodexSession,
  deleteClaudeSession,
  deleteGeminiSession,
  deleteOpenCodeSession,
  forkThread,
  rewindCodexThread,
  getOpenCodeSessionList,
  listClaudeSessions,
  listGeminiSessions,
  listThreadTitles,
  listThreads,
  loadGeminiSession,
  readWorkspaceFile,
  renameThreadTitleKey,
  resumeThread,
  setThreadTitle,
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
import { useThreadActions } from "./useThreadActions";

vi.mock("../../../services/tauri", () => ({
  connectWorkspace: vi.fn(),
  createWorkspaceDirectory: vi.fn(),
  deleteCodexSession: vi.fn(),
  deleteClaudeSession: vi.fn(),
  deleteGeminiSession: vi.fn(),
  deleteOpenCodeSession: vi.fn(),
  forkThread: vi.fn(),
  rewindCodexThread: vi.fn(),
  getOpenCodeSessionList: vi.fn(),
  listClaudeSessions: vi.fn(),
  listGeminiSessions: vi.fn(),
  listThreadTitles: vi.fn(),
  listThreads: vi.fn(),
  loadGeminiSession: vi.fn(),
  readWorkspaceFile: vi.fn(),
  renameThreadTitleKey: vi.fn(),
  resumeThread: vi.fn(),
  setThreadTitle: vi.fn(),
  trashWorkspaceItem: vi.fn(),
  writeWorkspaceFile: vi.fn(),
}));

vi.mock("../../../utils/threadItems", () => ({
  buildItemsFromThread: vi.fn(),
  getThreadTimestamp: vi.fn(),
  isReviewingFromThread: vi.fn(),
  mergeThreadItems: vi.fn(),
  previewThreadName: vi.fn(),
}));

vi.mock("../utils/threadStorage", () => ({
  makeCustomNameKey: (workspaceId: string, threadId: string) =>
    `${workspaceId}:${threadId}`,
  saveThreadActivity: vi.fn(),
}));

describe("useThreadActions codex rewind", () => {
  const workspace: WorkspaceInfo = {
    id: "ws-1",
    name: "ccgui",
    path: "/tmp/codex",
    connected: true,
    settings: { sidebarCollapsed: false },
  };

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
      userInputRequests: [],
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
      ...utils,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listThreadTitles).mockResolvedValue({});
    vi.mocked(listGeminiSessions).mockResolvedValue([]);
    vi.mocked(getOpenCodeSessionList).mockResolvedValue([]);
    vi.mocked(renameThreadTitleKey).mockResolvedValue(undefined);
    vi.mocked(setThreadTitle).mockResolvedValue("title");
    vi.mocked(connectWorkspace).mockResolvedValue(undefined);
    vi.mocked(createWorkspaceDirectory).mockResolvedValue(undefined);
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
    vi.mocked(rewindCodexThread).mockResolvedValue({
      thread: { id: "thread-codex-rewind-1" },
      truncated: true,
      deletedCount: 1,
      archivedBeforeDelete: true,
    } as any);
    vi.mocked(loadGeminiSession).mockResolvedValue({ messages: [] });
    vi.mocked(readWorkspaceFile).mockResolvedValue({
      content: "",
      truncated: false,
    });
    vi.mocked(trashWorkspaceItem).mockResolvedValue(undefined);
    vi.mocked(writeWorkspaceFile).mockResolvedValue(undefined);
  });

  it("forks a Codex thread from message id and applies workspace rewind restore", async () => {
    vi.mocked(listThreads).mockResolvedValue({
      result: {
        data: [],
        nextCursor: null,
      },
    } as any);
    vi.mocked(listClaudeSessions).mockResolvedValue([]);
    vi.mocked(readWorkspaceFile).mockResolvedValue({
      content: "const value = 'after';\n",
      truncated: false,
    });
    vi.mocked(resumeThread).mockResolvedValue({
      result: {
        thread: {
          preview: "rewound",
          turns: [{ id: "turn-1", items: [] }],
        },
      },
    } as any);
    vi.mocked(buildItemsFromThread).mockReturnValue([
      {
        id: "server-user-prev",
        kind: "message",
        role: "user",
        text: "更早一条",
      },
      {
        id: "server-assistant-prev",
        kind: "message",
        role: "assistant",
        text: "历史回复",
      },
    ]);
    const { result, dispatch } = renderActions({
      itemsByThread: {
        "thread-codex-1": [
          {
            id: "user-local-prev",
            kind: "message",
            role: "user",
            text: "更早一条",
          },
          {
            id: "user-local-target",
            kind: "message",
            role: "user",
            text: "回溯目标",
          },
          {
            id: "tool-local-1",
            kind: "tool",
            toolType: "fileChange",
            title: "File changes",
            detail: "{}",
            changes: [
              {
                path: "src/App.tsx",
                kind: "modified",
                diff: "@@ -1,1 +1,1 @@\n-const value = 'before';\n+const value = 'after';",
              },
            ],
          },
        ],
      },
    });

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace, { preserveState: true });
    });

    let output: string | null = null;
    await act(async () => {
      output = await result.current.forkSessionFromMessageForWorkspace(
        "ws-1",
        "thread-codex-1",
        "user-local-target",
      );
    });

    expect(output).toBe("thread-codex-rewind-1");
    expect(rewindCodexThread).toHaveBeenCalledWith(
      "ws-1",
      "thread-codex-1",
      1,
      "user-local-target",
      {
        targetUserMessageText: "回溯目标",
        targetUserMessageOccurrence: 1,
        localUserMessageCount: 2,
      },
    );
    expect(writeWorkspaceFile).toHaveBeenCalledWith(
      "ws-1",
      "src/App.tsx",
      "const value = 'before';\n",
    );
    expect(dispatch).toHaveBeenCalledWith({
      type: "renameThreadId",
      workspaceId: "ws-1",
      oldThreadId: "thread-codex-1",
      newThreadId: "thread-codex-rewind-1",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "hideThread",
      workspaceId: "ws-1",
      threadId: "thread-codex-1",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "setThreadItems",
      threadId: "thread-codex-rewind-1",
      items: [
        {
          id: "server-user-prev",
          kind: "message",
          role: "user",
          text: "更早一条",
        },
        {
          id: "server-assistant-prev",
          kind: "message",
          role: "assistant",
          text: "历史回复",
        },
      ],
    });
    expect(deleteCodexSession).not.toHaveBeenCalled();
  });

  it("uses the latest matching local user message when duplicate ids exist", async () => {
    vi.mocked(listThreads).mockResolvedValue({
      result: {
        data: [],
        nextCursor: null,
      },
    } as any);
    vi.mocked(listClaudeSessions).mockResolvedValue([]);
    vi.mocked(resumeThread).mockResolvedValue({
      result: {
        thread: {
          turns: [{ id: "turn-1", items: [] }],
        },
      },
    } as any);
    vi.mocked(buildItemsFromThread).mockReturnValue([]);
    vi.mocked(rewindCodexThread).mockResolvedValue({
      thread: { id: "thread-codex-rewind-dup-id" },
    } as any);

    const { result } = renderActions({
      itemsByThread: {
        "thread-codex-1": [
          {
            id: "user-dup-id",
            kind: "message",
            role: "user",
            text: "更早一条",
          },
          {
            id: "assistant-dup-id",
            kind: "message",
            role: "assistant",
            text: "历史回复",
          },
          {
            id: "user-dup-id",
            kind: "message",
            role: "user",
            text: "最新一条",
          },
        ],
      },
    });

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace, { preserveState: true });
    });

    await act(async () => {
      await result.current.forkSessionFromMessageForWorkspace(
        "ws-1",
        "thread-codex-1",
        "user-dup-id",
      );
    });

    expect(rewindCodexThread).toHaveBeenCalledWith(
      "ws-1",
      "thread-codex-1",
      1,
      "user-dup-id",
      {
        targetUserMessageText: "最新一条",
        targetUserMessageOccurrence: 1,
        localUserMessageCount: 2,
      },
    );
  });

  it("skips workspace restore when Codex rewind toggle is disabled", async () => {
    vi.mocked(listThreads).mockResolvedValue({
      result: {
        data: [],
        nextCursor: null,
      },
    } as any);
    vi.mocked(listClaudeSessions).mockResolvedValue([]);
    vi.mocked(resumeThread).mockResolvedValue({
      result: {
        thread: {
          turns: [{ id: "turn-1", items: [] }],
        },
      },
    } as any);
    vi.mocked(buildItemsFromThread).mockReturnValue([]);
    vi.mocked(rewindCodexThread).mockResolvedValue({
      thread: { id: "thread-codex-rewind-no-restore" },
    } as any);

    const { result } = renderActions({
      itemsByThread: {
        "thread-codex-1": [
          {
            id: "user-local-prev",
            kind: "message",
            role: "user",
            text: "更早一条",
          },
          {
            id: "user-local-target",
            kind: "message",
            role: "user",
            text: "回溯目标",
          },
          {
            id: "tool-local-no-restore",
            kind: "tool",
            toolType: "fileChange",
            title: "File changes",
            detail: "{}",
            changes: [
              {
                path: "src/App.tsx",
                kind: "modified",
                diff: "@@ -1,1 +1,1 @@\n-const value = 'before';\n+const value = 'after';",
              },
            ],
          },
        ],
      },
    });

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace, { preserveState: true });
    });

    await act(async () => {
      await result.current.forkSessionFromMessageForWorkspace(
        "ws-1",
        "thread-codex-1",
        "user-local-target",
        { mode: "messages-only" },
      );
    });

    expect(rewindCodexThread).toHaveBeenCalledWith(
      "ws-1",
      "thread-codex-1",
      1,
      "user-local-target",
      {
        targetUserMessageText: "回溯目标",
        targetUserMessageOccurrence: 1,
        localUserMessageCount: 2,
      },
    );
    expect(writeWorkspaceFile).not.toHaveBeenCalled();
  });

  it("rejects rewind for unknown prefixed thread ids", async () => {
    vi.mocked(listThreads).mockResolvedValue({
      result: {
        data: [],
        nextCursor: null,
      },
    } as any);
    vi.mocked(listClaudeSessions).mockResolvedValue([]);

    const { result } = renderActions({
      itemsByThread: {
        "custom:thread-1": [
          {
            id: "user-local-target",
            kind: "message",
            role: "user",
            text: "回溯目标",
          },
        ],
      },
    });

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace, { preserveState: true });
    });

    let output: string | null = null;
    await act(async () => {
      output = await result.current.forkSessionFromMessageForWorkspace(
        "ws-1",
        "custom:thread-1",
        "user-local-target",
      );
    });

    expect(output).toBeNull();
    expect(forkThread).not.toHaveBeenCalled();
    expect(deleteCodexSession).not.toHaveBeenCalled();
  });

  it("does not force-activate forked Codex thread when user switched to another thread", async () => {
    vi.mocked(listThreads).mockResolvedValue({
      result: {
        data: [],
        nextCursor: null,
      },
    } as any);
    vi.mocked(listClaudeSessions).mockResolvedValue([]);
    vi.mocked(readWorkspaceFile).mockResolvedValue({
      content: "const value = 'after';\n",
      truncated: false,
    });
    vi.mocked(resumeThread).mockResolvedValue({
      result: {
        thread: {
          turns: [{ id: "turn-1", items: [] }],
        },
      },
    } as any);
    vi.mocked(buildItemsFromThread).mockReturnValue([]);
    vi.mocked(rewindCodexThread).mockResolvedValue({
      thread: { id: "thread-codex-rewind-1" },
    } as any);

    const { result, dispatch } = renderActions({
      activeThreadIdByWorkspace: {
        "ws-1": "thread-other",
      },
      itemsByThread: {
        "thread-codex-1": [
          {
            id: "user-local-prev",
            kind: "message",
            role: "user",
            text: "更早一条",
          },
          {
            id: "user-local-target",
            kind: "message",
            role: "user",
            text: "回溯目标",
          },
          {
            id: "tool-local-1",
            kind: "tool",
            toolType: "fileChange",
            title: "File changes",
            detail: "{}",
            changes: [
              {
                path: "src/App.tsx",
                kind: "modified",
                diff: "@@ -1,1 +1,1 @@\n-const value = 'before';\n+const value = 'after';",
              },
            ],
          },
        ],
      },
    });

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace, { preserveState: true });
    });

    await act(async () => {
      await result.current.forkSessionFromMessageForWorkspace(
        "ws-1",
        "thread-codex-1",
        "user-local-target",
      );
    });

    expect(dispatch).not.toHaveBeenCalledWith({
      type: "setActiveThreadId",
      workspaceId: "ws-1",
      threadId: "thread-codex-rewind-1",
    });
  });

  it("deletes the current Codex thread when rewinding from first user message", async () => {
    vi.mocked(listThreads).mockResolvedValue({
      result: {
        data: [],
        nextCursor: null,
      },
    } as any);
    vi.mocked(listClaudeSessions).mockResolvedValue([]);

    const { result, dispatch, loadedThreadsRef } = renderActions({
      threadsByWorkspace: {
        "ws-1": [
          {
            id: "thread-codex-1",
            name: "你好在不在",
            updatedAt: 1,
            engineSource: "codex",
          },
        ],
      },
      activeThreadIdByWorkspace: {
        "ws-1": "thread-codex-1",
      },
      itemsByThread: {
        "thread-codex-1": [
          {
            id: "user-local-first",
            kind: "message",
            role: "user",
            text: "你好在不在",
          },
          {
            id: "assistant-local-first",
            kind: "message",
            role: "assistant",
            text: "我在。",
          },
        ],
      },
    });

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace, { preserveState: true });
    });

    dispatch.mockClear();

    let output: string | null = null;
    await act(async () => {
      output = await result.current.forkSessionFromMessageForWorkspace(
        "ws-1",
        "thread-codex-1",
        "user-local-first",
      );
    });

    expect(output).toBe("thread-codex-1");
    expect(forkThread).not.toHaveBeenCalled();
    expect(deleteCodexSession).toHaveBeenCalledWith("ws-1", "thread-codex-1");
    expect(dispatch).toHaveBeenCalledWith({
      type: "removeThread",
      workspaceId: "ws-1",
      threadId: "thread-codex-1",
    });
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "renameThreadId" }),
    );
    expect(loadedThreadsRef.current["thread-codex-1"]).toBeUndefined();
  });

  it("rolls workspace files back when Codex rewind fork fails", async () => {
    vi.mocked(listThreads).mockResolvedValue({
      result: {
        data: [],
        nextCursor: null,
      },
    } as any);
    vi.mocked(listClaudeSessions).mockResolvedValue([]);
    vi.mocked(readWorkspaceFile).mockResolvedValue({
      content: "const value = 'after';\n",
      truncated: false,
    });
    vi.mocked(rewindCodexThread).mockRejectedValue(new Error("fork failed"));

    const { result } = renderActions({
      itemsByThread: {
        "thread-codex-1": [
          {
            id: "user-local-prev",
            kind: "message",
            role: "user",
            text: "更早一条",
          },
          {
            id: "user-local-target",
            kind: "message",
            role: "user",
            text: "回溯目标",
          },
          {
            id: "tool-local-2",
            kind: "tool",
            toolType: "fileChange",
            title: "File changes",
            detail: "{}",
            changes: [
              {
                path: "src/App.tsx",
                kind: "modified",
                diff: "@@ -1,1 +1,1 @@\n-const value = 'before';\n+const value = 'after';",
              },
            ],
          },
        ],
      },
    });

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace, { preserveState: true });
    });

    await act(async () => {
      await result.current.forkSessionFromMessageForWorkspace(
        "ws-1",
        "thread-codex-1",
        "user-local-target",
      );
    });

    expect(writeWorkspaceFile).toHaveBeenNthCalledWith(
      1,
      "ws-1",
      "src/App.tsx",
      "const value = 'before';\n",
    );
    expect(writeWorkspaceFile).toHaveBeenNthCalledWith(
      2,
      "ws-1",
      "src/App.tsx",
      "const value = 'after';\n",
    );
  });

  it("does not roll workspace files back when Codex rewind fork fails and toggle is disabled", async () => {
    vi.mocked(listThreads).mockResolvedValue({
      result: {
        data: [],
        nextCursor: null,
      },
    } as any);
    vi.mocked(listClaudeSessions).mockResolvedValue([]);
    vi.mocked(rewindCodexThread).mockRejectedValue(new Error("fork failed"));

    const { result } = renderActions({
      itemsByThread: {
        "thread-codex-1": [
          {
            id: "user-local-prev",
            kind: "message",
            role: "user",
            text: "更早一条",
          },
          {
            id: "user-local-target",
            kind: "message",
            role: "user",
            text: "回溯目标",
          },
          {
            id: "tool-local-disable-rollback",
            kind: "tool",
            toolType: "fileChange",
            title: "File changes",
            detail: "{}",
            changes: [
              {
                path: "src/App.tsx",
                kind: "modified",
                diff: "@@ -1,1 +1,1 @@\n-const value = 'before';\n+const value = 'after';",
              },
            ],
          },
        ],
      },
    });

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace, { preserveState: true });
    });

    await act(async () => {
      await result.current.forkSessionFromMessageForWorkspace(
        "ws-1",
        "thread-codex-1",
        "user-local-target",
        { mode: "messages-only" },
      );
    });

    expect(writeWorkspaceFile).not.toHaveBeenCalled();
  });

  it("restores workspace files without rewinding Codex messages in files-only mode", async () => {
    vi.mocked(listThreads).mockResolvedValue({
      result: {
        data: [],
        nextCursor: null,
      },
    } as any);
    vi.mocked(listClaudeSessions).mockResolvedValue([]);
    vi.mocked(readWorkspaceFile).mockResolvedValue({
      content: "const value = 'after';\n",
      truncated: false,
    });

    const { result } = renderActions({
      itemsByThread: {
        "thread-codex-1": [
          {
            id: "user-local-target",
            kind: "message",
            role: "user",
            text: "回溯目标",
          },
          {
            id: "tool-local-files-only",
            kind: "tool",
            toolType: "fileChange",
            title: "File changes",
            detail: "{}",
            changes: [
              {
                path: "src/App.tsx",
                kind: "modified",
                diff: "@@ -1,1 +1,1 @@\n-const value = 'before';\n+const value = 'after';",
              },
            ],
          },
        ],
      },
    });

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace, { preserveState: true });
    });

    let output: string | null = null;
    await act(async () => {
      output = await result.current.forkSessionFromMessageForWorkspace(
        "ws-1",
        "thread-codex-1",
        "user-local-target",
        { mode: "files-only" },
      );
    });

    expect(output).toBe("thread-codex-1");
    expect(writeWorkspaceFile).toHaveBeenCalledWith(
      "ws-1",
      "src/App.tsx",
      "const value = 'before';\n",
    );
    expect(rewindCodexThread).not.toHaveBeenCalled();
    expect(deleteCodexSession).not.toHaveBeenCalled();
  });

  it("resumes Codex thread without applying persisted hidden-item filtering", async () => {
    vi.mocked(resumeThread).mockResolvedValue({
      result: {
        thread: { id: "thread-2", preview: "preview", updated_at: 555 },
      },
    });
    const rawItems: ConversationItem[] = [
      {
        id: "user-visible",
        kind: "message",
        role: "user",
        text: "保留用户消息",
      },
      {
        id: "user-hidden",
        kind: "message",
        role: "user",
        text: "应被隐藏",
      },
      {
        id: "assistant-hidden",
        kind: "message",
        role: "assistant",
        text: "应被隐藏助手消息",
      },
      {
        id: "assistant-visible",
        kind: "message",
        role: "assistant",
        text: "保留的助手消息",
      },
    ];
    vi.mocked(buildItemsFromThread).mockReturnValue(rawItems);
    vi.mocked(mergeThreadItems).mockReturnValue(rawItems);
    vi.mocked(isReviewingFromThread).mockReturnValue(false);
    vi.mocked(previewThreadName).mockReturnValue("Preview Name");
    vi.mocked(getThreadTimestamp).mockReturnValue(123);

    const { result, dispatch } = renderActions();

    await act(async () => {
      await result.current.resumeThreadForWorkspace("ws-1", "thread-2");
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "setThreadItems",
      threadId: "thread-2",
      items: [
        {
          id: "user-visible",
          kind: "message",
          role: "user",
          text: "保留用户消息",
        },
        {
          id: "user-hidden",
          kind: "message",
          role: "user",
          text: "应被隐藏",
        },
        {
          id: "assistant-hidden",
          kind: "message",
          role: "assistant",
          text: "应被隐藏助手消息",
        },
        {
          id: "assistant-visible",
          kind: "message",
          role: "assistant",
          text: "保留的助手消息",
        },
      ],
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "setLastAgentMessage",
      threadId: "thread-2",
      text: "保留的助手消息",
      timestamp: 123,
    });
  });
});
