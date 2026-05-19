// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationItem, ThreadSummary } from "../../../types";
import {
  connectWorkspace,
  createWorkspaceDirectory,
  getOpenCodeSessionList,
  listClaudeSessions,
  listGeminiSessions,
  listThreadTitles,
  listThreads,
  listWorkspaceSessions,
  renameThreadTitleKey,
  setThreadTitle,
} from "../../../services/tauri";
import { listSharedSessions } from "../../shared-session/services/sharedSessions";
import {
  getThreadTimestamp,
  mergeThreadItems,
  previewThreadName,
} from "../../../utils/threadItems";
import { clearGlobalRuntimeNotices } from "../../../services/globalRuntimeNotices";
import { loadSidebarSnapshot } from "../utils/sidebarSnapshot";
import { useThreadActions } from "./useThreadActions";
import { renderActions, workspace } from "./useThreadActions.test-utils";

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

vi.mock("../../shared-session/services/sharedSessions", () => ({
  listSharedSessions: vi.fn(async () => []),
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

const NEVER_RESOLVES = () => new Promise<never>(() => {});

function makeCachedClaudeSummary(idSuffix: string, updatedAt: number) {
  return {
    id: `claude:cl-${idSuffix}`,
    name: `Cached Claude ${idSuffix}`,
    updatedAt,
    engineSource: "claude" as const,
    threadKind: "native" as const,
    sizeBytes: 1024,
  };
}

function getLatestSetThreadsDispatch(dispatch: ReturnType<typeof vi.fn>) {
  for (let i = dispatch.mock.calls.length - 1; i >= 0; i -= 1) {
    const arg = dispatch.mock.calls[i][0];
    if (arg && arg.type === "setThreads") {
      return arg;
    }
  }
  return null;
}

function renderActionsWithMutableThreadState(
  threadsByWorkspace: Record<string, ThreadSummary[]>,
) {
  const dispatch = vi.fn();
  const loadedThreadsRef = { current: {} as Record<string, boolean> };
  const replaceOnResumeRef = { current: {} as Record<string, boolean> };
  const threadActivityRef = {
    current: {} as Record<string, Record<string, number>>,
  };
  let currentThreadsByWorkspace = threadsByWorkspace;
  const baseArgs: Parameters<typeof useThreadActions>[0] = {
    dispatch,
    itemsByThread: {},
    userInputRequests: [],
    threadsByWorkspace: currentThreadsByWorkspace,
    activeThreadIdByWorkspace: {},
    threadListCursorByWorkspace: {},
    threadStatusById: {},
    getCustomName: () => undefined,
    threadActivityRef,
    loadedThreadsRef,
    replaceOnResumeRef,
    applyCollabThreadLinksFromThread: vi.fn(),
    updateThreadParent: vi.fn(),
    onThreadTitleMappingsLoaded: vi.fn(),
    onRenameThreadTitleMapping: vi.fn(),
  };

  const hook = renderHook(() =>
    useThreadActions({
      ...baseArgs,
      threadsByWorkspace: currentThreadsByWorkspace,
    }),
  );

  return {
    ...hook,
    dispatch,
    rerenderWithThreadState(
      nextThreadsByWorkspace: Record<string, ThreadSummary[]>,
    ) {
      currentThreadsByWorkspace = nextThreadsByWorkspace;
      hook.rerender();
    },
  };
}

describe("useThreadActions sidebar listing timeout fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.mocked(listThreadTitles).mockResolvedValue({});
    vi.mocked(listSharedSessions).mockResolvedValue([]);
    vi.mocked(listClaudeSessions).mockResolvedValue([]);
    vi.mocked(listGeminiSessions).mockResolvedValue([]);
    vi.mocked(getOpenCodeSessionList).mockResolvedValue([]);
    vi.mocked(listWorkspaceSessions).mockResolvedValue({
      data: [],
      nextCursor: null,
      partialSource: null,
    });
    vi.mocked(listThreads).mockResolvedValue({
      result: { data: [], nextCursor: null },
    } as any);
    vi.mocked(renameThreadTitleKey).mockResolvedValue(undefined);
    vi.mocked(setThreadTitle).mockResolvedValue("title");
    vi.mocked(connectWorkspace).mockResolvedValue(undefined);
    vi.mocked(createWorkspaceDirectory).mockResolvedValue(undefined);
    vi.mocked(previewThreadName).mockImplementation(
      (text: string, fallback: string) => {
        const trimmed = (text ?? "").trim();
        return trimmed || fallback;
      },
    );
    vi.mocked(getThreadTimestamp).mockImplementation((thread) => {
      const value = (thread as Record<string, unknown>).updated_at as
        | number
        | undefined;
      return value ?? 0;
    });
    vi.mocked(loadSidebarSnapshot).mockReturnValue(null);
    vi.mocked(mergeThreadItems).mockImplementation(
      (primaryItems: ConversationItem[]) => primaryItems,
    );
    clearGlobalRuntimeNotices();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("case 1: claude listing timeout still keeps last-good claude entries when codex returns a session", async () => {
    vi.mocked(listClaudeSessions).mockImplementation(NEVER_RESOLVES);
    vi.mocked(listWorkspaceSessions).mockResolvedValue({
      data: [
        {
          sessionId: "codex-1",
          workspaceId: "ws-1",
          title: "Codex Active",
          engine: "codex",
          updatedAt: 5000,
          sizeBytes: 2048,
          folderId: null,
          parentSessionId: null,
          source: null,
          provider: null,
          sourceLabel: null,
        },
      ],
      nextCursor: null,
      partialSource: null,
    } as any);

    const debugEvents: Array<{ label?: string; payload?: any }> = [];
    const { result, dispatch } = renderActions({
      threadsByWorkspace: {
        "ws-1": [
          makeCachedClaudeSummary("a", 9000),
          makeCachedClaudeSummary("b", 8500),
        ],
      },
      onDebug: (event: any) => {
        debugEvents.push({ label: event?.label, payload: event?.payload });
      },
    });

    vi.useFakeTimers();
    const promise = result.current.listThreadsForWorkspace(workspace, {
      preserveState: true,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_001);
    });
    vi.useRealTimers();
    await act(async () => {
      await promise;
    });

    const dispatched = getLatestSetThreadsDispatch(dispatch);
    expect(dispatched).not.toBeNull();
    expect(debugEvents).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "thread/list error fallback",
        }),
      ]),
    );
    const ids = dispatched!.threads.map((t: any) => t.id);
    expect(ids).toContain("claude:cl-a");
    expect(ids).toContain("claude:cl-b");
    expect(ids).toContain("codex-1");
  }, 20_000);

  it("case 2: consecutive claude timeouts do not progressively drop more claude sessions", async () => {
    vi.mocked(listClaudeSessions).mockImplementation(NEVER_RESOLVES);
    vi.mocked(listWorkspaceSessions).mockResolvedValue({
      data: [
        {
          sessionId: "codex-1",
          workspaceId: "ws-1",
          title: "Codex Active",
          engine: "codex",
          updatedAt: 5000,
          sizeBytes: 2048,
          folderId: null,
          parentSessionId: null,
          source: null,
          provider: null,
          sourceLabel: null,
        },
      ],
      nextCursor: null,
      partialSource: null,
    } as any);

    const initialThreadsByWorkspace = {
      "ws-1": [
        makeCachedClaudeSummary("a", 9000),
        makeCachedClaudeSummary("b", 8500),
        makeCachedClaudeSummary("c", 8000),
      ],
    };
    const { result, dispatch, rerenderWithThreadState } =
      renderActionsWithMutableThreadState(initialThreadsByWorkspace);

    vi.useFakeTimers();
    const firstRun = result.current.listThreadsForWorkspace(workspace, {
      preserveState: true,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_001);
    });
    vi.useRealTimers();
    await act(async () => {
      await firstRun;
    });

    const firstDispatch = getLatestSetThreadsDispatch(dispatch);
    expect(firstDispatch).not.toBeNull();
    const firstClaudeIds = firstDispatch!.threads
      .filter((t: any) => t.engineSource === "claude")
      .map((t: any) => t.id);
    expect(firstClaudeIds).toEqual(
      expect.arrayContaining(["claude:cl-a", "claude:cl-b", "claude:cl-c"]),
    );

    dispatch.mockClear();
    rerenderWithThreadState({
      "ws-1": firstDispatch!.threads.map((thread: any) => ({
        ...thread,
        isDegraded: true,
        partialSource: "claude-session-timeout",
        degradedReason: "partial-thread-list",
      })),
    });

    vi.useFakeTimers();
    const secondRun = result.current.listThreadsForWorkspace(workspace, {
      preserveState: true,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_001);
    });
    vi.useRealTimers();
    await act(async () => {
      await secondRun;
    });

    const secondDispatch = getLatestSetThreadsDispatch(dispatch);
    expect(secondDispatch).not.toBeNull();
    const secondClaudeIds = secondDispatch!.threads
      .filter((t: any) => t.engineSource === "claude")
      .map((t: any) => t.id);
    expect(secondClaudeIds.length).toBeGreaterThanOrEqual(
      firstClaudeIds.length,
    );
    expect(secondClaudeIds).toEqual(
      expect.arrayContaining(["claude:cl-a", "claude:cl-b", "claude:cl-c"]),
    );
  }, 20_000);

  it("case 3: partial-source diagnostic remains observable after timeout-driven fallback", async () => {
    vi.mocked(listClaudeSessions).mockImplementation(NEVER_RESOLVES);

    const debugEvents: Array<{ label?: string; payload?: any }> = [];
    const { result } = renderActions({
      threadsByWorkspace: {
        "ws-1": [makeCachedClaudeSummary("a", 9000)],
      },
      onDebug: (event: any) => {
        debugEvents.push({ label: event?.label, payload: event?.payload });
      },
    });

    vi.useFakeTimers();
    const run = result.current.listThreadsForWorkspace(workspace, {
      preserveState: true,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_001);
    });
    vi.useRealTimers();
    await act(async () => {
      await run;
    });

    const labels = debugEvents.map((e) => e.label ?? "");
    expect(labels).toEqual(
      expect.arrayContaining([expect.stringMatching(/claude.*timeout/i)]),
    );
  }, 20_000);

  it("keeps last-good claude entries when claude rejects and codex catalog is empty", async () => {
    vi.mocked(listClaudeSessions).mockRejectedValue(
      new Error("claude history unavailable"),
    );
    vi.mocked(listWorkspaceSessions).mockResolvedValue({
      data: [],
      nextCursor: null,
      partialSource: null,
    } as any);

    const debugEvents: Array<{ label?: string; payload?: any }> = [];
    const { result, dispatch } = renderActions({
      threadsByWorkspace: {
        "ws-1": [makeCachedClaudeSummary("a", 9000)],
      },
      onDebug: (event: any) => {
        debugEvents.push({ label: event?.label, payload: event?.payload });
      },
    });

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace, {
        preserveState: true,
      });
    });

    const dispatched = getLatestSetThreadsDispatch(dispatch);
    expect(dispatched).not.toBeNull();
    expect(
      dispatched!.threads.map((thread: ThreadSummary) => thread.id),
    ).toContain("claude:cl-a");
    expect(
      dispatched!.threads.every(
        (thread: ThreadSummary) =>
          thread.isDegraded &&
          thread.partialSource === "claude-session-error",
      ),
    ).toBe(true);
    expect(debugEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "thread/list claude error",
          payload: expect.objectContaining({
            workspaceId: "ws-1",
          }),
        }),
      ]),
    );
  }, 20_000);

  it("skips mixed-engine degraded current state and falls back to the clean previous snapshot", async () => {
    vi.mocked(listClaudeSessions).mockImplementation(NEVER_RESOLVES);
    vi.mocked(listWorkspaceSessions).mockResolvedValue({
      data: [],
      nextCursor: null,
      partialSource: null,
    } as any);

    const initialThreadsByWorkspace = {
      "ws-1": [
        makeCachedClaudeSummary("a", 9000),
        {
          id: "codex-previous",
          name: "Previous Codex",
          updatedAt: 8000,
          engineSource: "codex" as const,
          threadKind: "native" as const,
        },
      ],
    };
    const { result, dispatch, rerenderWithThreadState } =
      renderActionsWithMutableThreadState(initialThreadsByWorkspace);

    rerenderWithThreadState({
      "ws-1": [
        {
          id: "codex-degraded",
          name: "Degraded Codex",
          updatedAt: 8500,
          engineSource: "codex",
          threadKind: "native",
          isDegraded: true,
          partialSource: "codex-catalog-timeout",
          degradedReason: "partial-thread-list",
        },
      ],
    });

    vi.useFakeTimers();
    const run = result.current.listThreadsForWorkspace(workspace, {
      preserveState: true,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_001);
    });
    vi.useRealTimers();
    await act(async () => {
      await run;
    });

    const dispatched = getLatestSetThreadsDispatch(dispatch);
    expect(dispatched).not.toBeNull();
    expect(
      dispatched!.threads.map((thread: ThreadSummary) => thread.id),
    ).toContain("claude:cl-a");
  }, 20_000);

  it("filters child-owned catalog entries out of parent workspace thread hydration", async () => {
    vi.mocked(listWorkspaceSessions).mockResolvedValue({
      data: [
        {
          sessionId: "claude:child-session",
          workspaceId: "child-ws",
          matchedWorkspaceId: "child-ws",
          title: "Child owned Claude",
          engine: "claude",
          updatedAt: 7000,
          sizeBytes: 2048,
          folderId: null,
          parentSessionId: null,
          source: null,
          provider: null,
          sourceLabel: null,
        },
        {
          sessionId: "claude:parent-session",
          workspaceId: "ws-1",
          matchedWorkspaceId: "ws-1",
          title: "Parent owned Claude",
          engine: "claude",
          updatedAt: 6000,
          sizeBytes: 1024,
          folderId: null,
          parentSessionId: null,
          source: null,
          provider: null,
          sourceLabel: null,
        },
      ],
      nextCursor: null,
      partialSource: null,
    } as any);

    const { result, dispatch } = renderActions();

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace, {
        preserveState: true,
      });
    });

    const dispatched = getLatestSetThreadsDispatch(dispatch);
    expect(dispatched).not.toBeNull();
    const ids = dispatched!.threads.map((thread: ThreadSummary) => thread.id);
    expect(ids).not.toContain("claude:child-session");
    expect(ids).toContain("claude:parent-session");
  });

  it("keeps last-good claude entries when native listing succeeds empty but catalog is partial", async () => {
    vi.mocked(listClaudeSessions).mockResolvedValue([]);
    vi.mocked(listWorkspaceSessions).mockResolvedValue({
      data: [
        {
          sessionId: "codex-1",
          workspaceId: "ws-1",
          title: "Codex Active",
          engine: "codex",
          updatedAt: 5000,
          sizeBytes: 2048,
          folderId: null,
          parentSessionId: null,
          source: null,
          provider: null,
          sourceLabel: null,
        },
      ],
      nextCursor: null,
      partialSource: "claude-history-unavailable",
    } as any);

    const { result, dispatch } = renderActions({
      threadsByWorkspace: {
        "ws-1": [
          makeCachedClaudeSummary("a", 9000),
          makeCachedClaudeSummary("b", 8500),
        ],
      },
      onDebug: (event: any) => {
        debugEvents.push({ label: event?.label, payload: event?.payload });
      },
    });
    const debugEvents: Array<{ label?: string; payload?: any }> = [];

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace, {
        preserveState: true,
      });
    });

    const dispatched = getLatestSetThreadsDispatch(dispatch);
    expect(dispatched).not.toBeNull();
    const ids = dispatched!.threads.map((thread: ThreadSummary) => thread.id);
    expect(ids).toContain("claude:cl-a");
    expect(ids).toContain("claude:cl-b");
    expect(ids).toContain("codex-1");
    expect(
      dispatched!.threads.every((thread: ThreadSummary) => thread.isDegraded),
    ).toBe(true);
    expect(debugEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "thread/list claude successful empty degraded",
          payload: expect.objectContaining({
            workspaceId: "ws-1",
            partialSource: "claude-history-unavailable",
            lastGoodCount: 2,
          }),
        }),
      ]),
    );
  });

  it("case 4: archived last-good claude entries are not resurrected by seed", async () => {
    vi.mocked(listClaudeSessions).mockImplementation(NEVER_RESOLVES);
    vi.mocked(listWorkspaceSessions).mockResolvedValue({
      data: [
        {
          sessionId: "codex-1",
          workspaceId: "ws-1",
          title: "Codex Active",
          engine: "codex",
          updatedAt: 5000,
          sizeBytes: 2048,
          folderId: null,
          parentSessionId: null,
          source: null,
          provider: null,
          sourceLabel: null,
        },
      ],
      nextCursor: null,
      partialSource: null,
    } as any);

    const archivedSummary = {
      ...makeCachedClaudeSummary("archived", 9500),
      archivedAt: 9000,
    };
    const liveSummary = makeCachedClaudeSummary("live", 9200);

    const { result, dispatch } = renderActions({
      threadsByWorkspace: {
        "ws-1": [archivedSummary, liveSummary],
      },
    });

    vi.useFakeTimers();
    const run = result.current.listThreadsForWorkspace(workspace, {
      preserveState: true,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_001);
    });
    vi.useRealTimers();
    await act(async () => {
      await run;
    });

    const dispatched = getLatestSetThreadsDispatch(dispatch);
    expect(dispatched).not.toBeNull();
    const ids = dispatched!.threads.map((t: any) => t.id);
    expect(ids).toContain("claude:cl-live");
    expect(ids).not.toContain("claude:cl-archived");
  }, 20_000);
});
