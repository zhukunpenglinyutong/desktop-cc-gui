// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearGlobalRuntimeNotices } from "../../../services/globalRuntimeNotices";
import {
  resolveGlobalRuntimeNoticeDockStatus,
  sanitizeGlobalRuntimeNoticeDockVisibility,
  useGlobalRuntimeNoticeDock,
} from "./useGlobalRuntimeNoticeDock";

const clientStorageMocks = vi.hoisted(() => ({
  getClientStoreSync: vi.fn(),
  writeClientStoreValue: vi.fn(),
}));

const tauriMocks = vi.hoisted(() => ({
  getRuntimePoolSnapshot: vi.fn(),
}));

vi.mock("../../../services/clientStorage", () => ({
  getClientStoreSync: clientStorageMocks.getClientStoreSync,
  writeClientStoreValue: clientStorageMocks.writeClientStoreValue,
}));

vi.mock("../../../services/tauri", () => ({
  getRuntimePoolSnapshot: tauriMocks.getRuntimePoolSnapshot,
}));

function createEmptyRuntimePoolSnapshot() {
  return {
    rows: [],
    summary: {
      totalRuntimes: 0,
      acquiredRuntimes: 0,
      streamingRuntimes: 0,
      gracefulIdleRuntimes: 0,
      evictableRuntimes: 0,
      activeWorkProtectedRuntimes: 0,
      pinnedRuntimes: 0,
      codexRuntimes: 0,
      claudeRuntimes: 0,
    },
    budgets: {
      maxHotCodex: 0,
      maxWarmCodex: 0,
      warmTtlSeconds: 0,
      restoreThreadsOnlyOnLaunch: false,
      forceCleanupOnExit: false,
      orphanSweepOnLaunch: false,
    },
    diagnostics: {
      orphanEntriesFound: 0,
      orphanEntriesCleaned: 0,
      orphanEntriesFailed: 0,
      forceKillCount: 0,
      leaseBlockedEvictionCount: 0,
      coordinatorAbortCount: 0,
      startupManagedNodeProcesses: 0,
      startupResumeHelperNodeProcesses: 0,
      startupOrphanResidueProcesses: 0,
      lastOrphanSweepAtMs: null,
      lastShutdownAtMs: null,
    },
    engineObservability: [],
  };
}

describe("useGlobalRuntimeNoticeDock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-22T09:00:00"));
    clearGlobalRuntimeNotices();
    clientStorageMocks.getClientStoreSync.mockReset();
    clientStorageMocks.writeClientStoreValue.mockReset();
    tauriMocks.getRuntimePoolSnapshot.mockReset();
    clientStorageMocks.getClientStoreSync.mockReturnValue(undefined);
    tauriMocks.getRuntimePoolSnapshot.mockResolvedValue(createEmptyRuntimePoolSnapshot());
  });

  afterEach(() => {
    clearGlobalRuntimeNotices();
    vi.useRealTimers();
  });

  it("sanitizes invalid persisted visibility values", () => {
    expect(sanitizeGlobalRuntimeNoticeDockVisibility("expanded")).toBe("expanded");
    expect(sanitizeGlobalRuntimeNoticeDockVisibility("broken")).toBe("minimized");
    expect(sanitizeGlobalRuntimeNoticeDockVisibility(null)).toBe("minimized");
  });

  it("persists visibility changes through client storage", async () => {
    clientStorageMocks.getClientStoreSync.mockReturnValue("broken-value");

    const { result } = renderHook(() => useGlobalRuntimeNoticeDock());
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.visibility).toBe("minimized");

    act(() => {
      result.current.expand();
    });

    expect(clientStorageMocks.writeClientStoreValue).toHaveBeenLastCalledWith(
      "app",
      "globalRuntimeNoticeDock.visibility",
      "expanded",
    );

    act(() => {
      result.current.minimize();
    });

    expect(clientStorageMocks.writeClientStoreValue).toHaveBeenLastCalledWith(
      "app",
      "globalRuntimeNoticeDock.visibility",
      "minimized",
    );
  });

  it("maps runtime pool transitions into notices and lets streaming status decay to idle", async () => {
    const initialSnapshot = {
      ...createEmptyRuntimePoolSnapshot(),
      rows: [
        {
          workspaceId: "ws-1",
          workspaceName: "Repo A",
          workspacePath: "/tmp/repo-a",
          engine: "codex",
          state: "streaming",
          pid: null,
          wrapperKind: null,
          resolvedBin: null,
          startedAtMs: null,
          lastUsedAtMs: 0,
          pinned: false,
          turnLeaseCount: 0,
          streamLeaseCount: 0,
          leaseSources: [],
          activeWorkProtected: false,
          evictCandidate: false,
          evictionReason: null,
          error: null,
          foregroundWorkState: "resume-pending",
          startupState: "suspect-stale",
        },
      ],
    };
    tauriMocks.getRuntimePoolSnapshot.mockResolvedValue(initialSnapshot);

    const { result } = renderHook(() => useGlobalRuntimeNoticeDock());
    const initialLoadPromise = tauriMocks.getRuntimePoolSnapshot.mock.results[0]?.value;

    await act(async () => {
      await initialLoadPromise;
    });

    expect(result.current.notices[0]).toEqual(
      expect.objectContaining({
        messageKey: "runtimeNotice.runtime.resumePending",
        messageParams: {
          workspace: "Repo A",
          engine: "Codex",
        },
      }),
    );
    expect(result.current.status).toBe("streaming");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8100);
    });

    expect(result.current.status).toBe("idle");
    expect(resolveGlobalRuntimeNoticeDockStatus(result.current.notices, Date.now())).toBe("idle");
  });

  it("writes back initial ready runtime snapshots with engine-aware copy and stable path fallback", async () => {
    const initialSnapshot = {
      ...createEmptyRuntimePoolSnapshot(),
      rows: [
        {
          workspaceId: "ws-ready",
          workspaceName: "   ",
          workspacePath: "C:\\Users\\me\\Workspace Ready\\",
          engine: "claude",
          state: "graceful-idle",
          pid: null,
          wrapperKind: null,
          resolvedBin: null,
          startedAtMs: null,
          lastUsedAtMs: 0,
          pinned: false,
          turnLeaseCount: 0,
          streamLeaseCount: 0,
          leaseSources: [],
          activeWorkProtected: false,
          evictCandidate: false,
          evictionReason: null,
          error: null,
          foregroundWorkState: null,
          startupState: "ready",
        },
        {
          workspaceId: "ws-empty",
          workspaceName: "   ",
          workspacePath: "   ",
          engine: "codex",
          state: "graceful-idle",
          pid: null,
          wrapperKind: null,
          resolvedBin: null,
          startedAtMs: null,
          lastUsedAtMs: 0,
          pinned: false,
          turnLeaseCount: 0,
          streamLeaseCount: 0,
          leaseSources: [],
          activeWorkProtected: false,
          evictCandidate: false,
          evictionReason: null,
          error: null,
          foregroundWorkState: null,
          startupState: "ready",
        },
      ],
    };
    tauriMocks.getRuntimePoolSnapshot.mockResolvedValue(initialSnapshot);

    const { result } = renderHook(() => useGlobalRuntimeNoticeDock());
    const initialLoadPromise = tauriMocks.getRuntimePoolSnapshot.mock.results[0]?.value;

    await act(async () => {
      await initialLoadPromise;
    });

    expect(result.current.notices).toHaveLength(2);
    expect(result.current.notices[0]).toEqual(
      expect.objectContaining({
        messageKey: "runtimeNotice.runtime.ready",
        messageParams: {
          workspace: "Workspace Ready",
          engine: "Claude Code",
        },
      }),
    );
    expect(result.current.notices[1]).toEqual(
      expect.objectContaining({
        messageKey: "runtimeNotice.runtime.ready",
        messageParams: {
          workspace: "ws-empty",
          engine: "Codex",
        },
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
      const nextLoadPromise = tauriMocks.getRuntimePoolSnapshot.mock.results[1]?.value;
      await nextLoadPromise;
    });

    expect(result.current.notices).toHaveLength(2);
  });
});
