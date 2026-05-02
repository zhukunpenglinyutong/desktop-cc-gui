// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationItem, ThreadSummary, WorkspaceInfo } from "../../../types";
import { __resetRealtimePerfFlagCacheForTests } from "../../threads/utils/realtimePerfFlags";
import {
  SESSION_RADAR_HISTORY_UPDATED_EVENT,
  SESSION_RADAR_RECENT_STORAGE_KEY,
} from "../utils/sessionRadarPersistence";
import { useSessionRadarFeed } from "./useSessionRadarFeed";

const clientStoreCache = new Map<string, unknown>();

vi.mock("../../../services/clientStorage", () => ({
  getClientStoreSync: vi.fn((store: string, key: string) => clientStoreCache.get(`${store}:${key}`)),
  writeClientStoreValue: vi.fn((store: string, key: string, value: unknown) => {
    clientStoreCache.set(`${store}:${key}`, value);
  }),
}));

function createWorkspace(id: string, name: string): WorkspaceInfo {
  return {
    id,
    name,
    path: `/tmp/${id}`,
    settings: { sidebarCollapsed: true },
    connected: true,
    kind: "main",
  } as unknown as WorkspaceInfo;
}

function createThread(id: string, name: string, updatedAt: number): ThreadSummary {
  return {
    id,
    name,
    updatedAt,
    engineSource: "codex",
  };
}

function userMessage(id: string, text: string): ConversationItem {
  return {
    id,
    kind: "message",
    role: "user",
    text,
  };
}

describe("useSessionRadarFeed incremental refresh", () => {
  beforeEach(() => {
    clientStoreCache.clear();
    window.localStorage.setItem("ccgui.perf.incrementalDerivation", "1");
    __resetRealtimePerfFlagCacheForTests();
  });

  it("reuses unchanged running entries and only rebuilds changed thread entries", () => {
    const workspace = createWorkspace("ws-main", "Workspace Main");
    const baseThreadsByWorkspace = {
      [workspace.id]: [
        createThread("thread-1", "Thread 1", 1_000),
        createThread("thread-2", "Thread 2", 2_000),
      ],
    };

    const { result, rerender } = renderHook(
      (props: {
        threadsByWorkspace: Record<string, ThreadSummary[]>;
        threadItemsByThread: Record<string, ConversationItem[]>;
      }) =>
        useSessionRadarFeed({
          workspaces: [workspace],
          threadsByWorkspace: props.threadsByWorkspace,
          threadStatusById: {
            "thread-1": { isProcessing: true, processingStartedAt: 10_000 },
            "thread-2": { isProcessing: true, processingStartedAt: 20_000 },
          },
          threadItemsByThread: props.threadItemsByThread,
          lastAgentMessageByThread: {
            "thread-1": { text: "agent-1", timestamp: 30_000 },
            "thread-2": { text: "agent-2", timestamp: 40_000 },
          },
        }),
      {
        initialProps: {
          threadsByWorkspace: baseThreadsByWorkspace,
          threadItemsByThread: {
            "thread-1": [userMessage("user-1", "hello 1")],
            "thread-2": [userMessage("user-2", "hello 2")],
          },
        },
      },
    );

    const firstByThreadId = new Map(
      result.current.runningSessions.map((entry) => [entry.threadId, entry]),
    );

    rerender({
      threadsByWorkspace: {
        [workspace.id]: [
          createThread("thread-1", "Thread 1", 1_000),
          createThread("thread-2", "Thread 2", 2_500),
        ],
      },
      threadItemsByThread: {
        "thread-1": [userMessage("user-1", "hello 1")],
        "thread-2": [userMessage("user-2", "hello 2"), userMessage("user-3", "hello 2 updated")],
      },
    });

    const secondByThreadId = new Map(
      result.current.runningSessions.map((entry) => [entry.threadId, entry]),
    );

    expect(secondByThreadId.get("thread-1")).toBe(firstByThreadId.get("thread-1"));
    expect(secondByThreadId.get("thread-2")).not.toBe(firstByThreadId.get("thread-2"));
    const runningIds = result.current.runningSessions.map((entry) => entry.id);
    expect(new Set(runningIds).size).toBe(runningIds.length);
  });

  it("refreshes running duration on cache-hit rerender when only time changes", () => {
    vi.useFakeTimers();
    const now = 100_000;
    vi.setSystemTime(now);

    const workspace = createWorkspace("ws-main", "Workspace Main");
    const threadsByWorkspace = {
      [workspace.id]: [createThread("thread-1", "Thread 1", now - 1000)],
    };
    const threadItemsByThread = {
      "thread-1": [userMessage("user-1", "hello 1")],
    };

    const { result, rerender } = renderHook(() =>
      useSessionRadarFeed({
        workspaces: [workspace],
        threadsByWorkspace,
        threadStatusById: {
          "thread-1": { isProcessing: true, processingStartedAt: now - 5_000 },
        },
        threadItemsByThread,
        lastAgentMessageByThread: {
          "thread-1": { text: "agent-1", timestamp: now - 3_000 },
        },
      }),
    );

    const firstEntry = result.current.runningSessions[0];
    expect(firstEntry?.durationMs).toBe(5_000);

    vi.setSystemTime(now + 2_000);
    rerender();

    const secondEntry = result.current.runningSessions[0];
    expect(secondEntry).not.toBe(firstEntry);
    expect(secondEntry?.durationMs).toBe(7_000);

    vi.useRealTimers();
  });

  it("updates running duration every second even without external rerender", () => {
    vi.useFakeTimers();
    const now = 100_000;
    vi.setSystemTime(now);

    const workspace = createWorkspace("ws-main", "Workspace Main");
    const threadsByWorkspace = {
      [workspace.id]: [createThread("thread-1", "Thread 1", now - 1000)],
    };
    const threadItemsByThread = {
      "thread-1": [userMessage("user-1", "hello 1")],
    };

    const { result } = renderHook(() =>
      useSessionRadarFeed({
        workspaces: [workspace],
        threadsByWorkspace,
        threadStatusById: {
          "thread-1": { isProcessing: true, processingStartedAt: now - 5_000 },
        },
        threadItemsByThread,
        lastAgentMessageByThread: {
          "thread-1": { text: "agent-1", timestamp: now - 3_000 },
        },
      }),
    );

    const firstEntry = result.current.runningSessions[0];
    expect(firstEntry?.durationMs).toBe(5_000);

    act(() => {
      vi.advanceTimersByTime(2_000);
    });

    const secondEntry = result.current.runningSessions[0];
    expect(secondEntry).not.toBe(firstEntry);
    expect(secondEntry?.durationMs).toBe(7_000);

    vi.useRealTimers();
  });

  it("uses a slower visible tick when compatibility mode is enabled", () => {
    vi.useFakeTimers();
    const now = 100_000;
    vi.setSystemTime(now);

    const workspace = createWorkspace("ws-main", "Workspace Main");
    const threadsByWorkspace = {
      [workspace.id]: [createThread("thread-1", "Thread 1", now - 1000)],
    };
    const threadItemsByThread = {
      "thread-1": [userMessage("user-1", "hello 1")],
    };

    const { result } = renderHook(() =>
      useSessionRadarFeed({
        workspaces: [workspace],
        threadsByWorkspace,
        threadStatusById: {
          "thread-1": { isProcessing: true, processingStartedAt: now - 5_000 },
        },
        threadItemsByThread,
        lastAgentMessageByThread: {
          "thread-1": { text: "agent-1", timestamp: now - 3_000 },
        },
        performanceCompatibilityModeEnabled: true,
      }),
    );

    const firstEntry = result.current.runningSessions[0];
    expect(firstEntry?.durationMs).toBe(5_000);

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(result.current.runningSessions[0]).toBe(firstEntry);

    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(result.current.runningSessions[0]).not.toBe(firstEntry);
    expect(result.current.runningSessions[0]?.durationMs).toBe(10_000);

    vi.useRealTimers();
  });

  it("pauses compatibility ticks while the document is hidden and resumes when visible", () => {
    vi.useFakeTimers();
    const now = 100_000;
    vi.setSystemTime(now);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });

    const workspace = createWorkspace("ws-main", "Workspace Main");
    const threadsByWorkspace = {
      [workspace.id]: [createThread("thread-1", "Thread 1", now - 1000)],
    };
    const threadItemsByThread = {
      "thread-1": [userMessage("user-1", "hello 1")],
    };

    const { result } = renderHook(() =>
      useSessionRadarFeed({
        workspaces: [workspace],
        threadsByWorkspace,
        threadStatusById: {
          "thread-1": { isProcessing: true, processingStartedAt: now - 5_000 },
        },
        threadItemsByThread,
        lastAgentMessageByThread: {
          "thread-1": { text: "agent-1", timestamp: now - 3_000 },
        },
        performanceCompatibilityModeEnabled: true,
      }),
    );

    const firstEntry = result.current.runningSessions[0];
    act(() => {
      vi.advanceTimersByTime(6_000);
    });
    expect(result.current.runningSessions[0]).toBe(firstEntry);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(result.current.runningSessions[0]).not.toBe(firstEntry);
    expect(result.current.runningSessions[0]?.durationMs).toBe(11_000);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    vi.useRealTimers();
  });

  it("refreshes persisted recent history after radar history events", () => {
    const workspace = createWorkspace("ws-main", "Workspace Main");

    const { result } = renderHook(() =>
      useSessionRadarFeed({
        workspaces: [workspace],
        threadsByWorkspace: {},
        threadStatusById: {},
        threadItemsByThread: {},
        lastAgentMessageByThread: {},
      }),
    );

    expect(result.current.recentCompletedSessions).toHaveLength(0);

    act(() => {
      clientStoreCache.set(`leida:${SESSION_RADAR_RECENT_STORAGE_KEY}`, [
        {
          id: "ws-main:thread-archived",
          workspaceId: "ws-main",
          workspaceName: "Workspace Main",
          threadId: "thread-archived",
          threadName: "Archived Thread",
          preview: "persisted preview",
          completedAt: 50_000,
          updatedAt: 50_000,
          startedAt: 48_000,
          durationMs: 2_000,
        },
      ]);
      window.dispatchEvent(new Event(SESSION_RADAR_HISTORY_UPDATED_EVENT));
    });

    expect(result.current.recentCompletedSessions).toHaveLength(1);
    expect(result.current.recentCompletedSessions[0]?.threadId).toBe("thread-archived");
    expect(result.current.recentCompletedSessions[0]?.preview).toBe("persisted preview");
  });
});
