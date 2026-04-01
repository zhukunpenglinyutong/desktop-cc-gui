// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadCustomNames,
  loadPinnedThreads,
  loadThreadActivity,
  savePinnedThreads,
  saveThreadActivity,
} from "../utils/threadStorage";
import { useThreadStorage } from "./useThreadStorage";

vi.mock("../utils/threadStorage", () => ({
  MAX_PINS_SOFT_LIMIT: 2,
  loadCustomNames: vi.fn(),
  loadPinnedThreads: vi.fn(),
  loadThreadActivity: vi.fn(),
  makeCustomNameKey: (workspaceId: string, threadId: string) =>
    `${workspaceId}:${threadId}`,
  makePinKey: (workspaceId: string, threadId: string) =>
    `${workspaceId}:${threadId}`,
  savePinnedThreads: vi.fn(),
  saveThreadActivity: vi.fn(),
}));

describe("useThreadStorage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads initial data and custom names from store", async () => {
    vi.mocked(loadThreadActivity).mockReturnValue({
      "ws-1": { "thread-1": 101 },
    });
    vi.mocked(loadPinnedThreads).mockReturnValue({ "ws-1:thread-1": 202 });
    vi.mocked(loadCustomNames).mockReturnValue({ "ws-1:thread-1": "Custom" });

    const { result } = renderHook(() => useThreadStorage());

    expect(result.current.threadActivityRef.current).toEqual({
      "ws-1": { "thread-1": 101 },
    });
    expect(result.current.pinnedThreadsRef.current).toEqual({
      "ws-1:thread-1": 202,
    });
    expect(result.current.pinnedThreadsVersion).toBe(1);

    await waitFor(() => {
      expect(result.current.getCustomName("ws-1", "thread-1")).toBe("Custom");
    });
  });

  it("records thread activity and persists updates", () => {
    vi.mocked(loadThreadActivity).mockReturnValue({});
    vi.mocked(loadPinnedThreads).mockReturnValue({});
    vi.mocked(loadCustomNames).mockReturnValue({});

    const { result } = renderHook(() => useThreadStorage());

    act(() => {
      result.current.recordThreadActivity("ws-2", "thread-9", 999);
    });

    expect(result.current.threadActivityRef.current).toEqual({
      "ws-2": { "thread-9": 999 },
    });
    expect(saveThreadActivity).toHaveBeenCalledWith({
      "ws-2": { "thread-9": 999 },
    });
  });

  it("pins and unpins threads while updating persistence", () => {
    vi.mocked(loadThreadActivity).mockReturnValue({});
    vi.mocked(loadPinnedThreads).mockReturnValue({});
    vi.mocked(loadCustomNames).mockReturnValue({});

    const { result } = renderHook(() => useThreadStorage());

    let pinResult = false;
    const beforePinGetTimestamp = result.current.getPinTimestamp;
    act(() => {
      pinResult = result.current.pinThread("ws-1", "thread-1");
    });

    expect(pinResult).toBe(true);
    expect(result.current.getPinTimestamp).not.toBe(beforePinGetTimestamp);
    expect(result.current.isThreadPinned("ws-1", "thread-1")).toBe(true);
    expect(savePinnedThreads).toHaveBeenCalledWith({
      "ws-1:thread-1": expect.any(Number),
    });

    const versionAfterPin = result.current.pinnedThreadsVersion;

    const beforeUnpinGetTimestamp = result.current.getPinTimestamp;
    act(() => {
      result.current.unpinThread("ws-1", "thread-1");
    });

    expect(result.current.getPinTimestamp).not.toBe(beforeUnpinGetTimestamp);
    expect(result.current.isThreadPinned("ws-1", "thread-1")).toBe(false);
    expect(savePinnedThreads).toHaveBeenCalledWith({});
    expect(result.current.pinnedThreadsVersion).toBe(versionAfterPin + 1);
  });

  it("ignores duplicate pins", () => {
    vi.mocked(loadThreadActivity).mockReturnValue({});
    vi.mocked(loadPinnedThreads).mockReturnValue({ "ws-1:thread-1": 123 });
    vi.mocked(loadCustomNames).mockReturnValue({});

    const { result } = renderHook(() => useThreadStorage());

    let pinResult = true;
    act(() => {
      pinResult = result.current.pinThread("ws-1", "thread-1");
    });

    expect(pinResult).toBe(false);
    expect(savePinnedThreads).not.toHaveBeenCalled();
  });

  it("tracks auto-title pending keys in-memory", () => {
    vi.mocked(loadThreadActivity).mockReturnValue({});
    vi.mocked(loadPinnedThreads).mockReturnValue({});
    vi.mocked(loadCustomNames).mockReturnValue({});

    const { result } = renderHook(() => useThreadStorage());

    act(() => {
      result.current.markAutoTitlePending("ws-1", "thread-1");
    });
    expect(result.current.isAutoTitlePending("ws-1", "thread-1")).toBe(true);
    expect(
      result.current.getAutoTitlePendingStartedAt("ws-1", "thread-1"),
    ).toEqual(expect.any(Number));

    act(() => {
      result.current.renameAutoTitlePendingKey("ws-1", "thread-1", "thread-2");
    });
    expect(result.current.isAutoTitlePending("ws-1", "thread-1")).toBe(false);
    expect(result.current.isAutoTitlePending("ws-1", "thread-2")).toBe(true);
    expect(
      result.current.getAutoTitlePendingStartedAt("ws-1", "thread-2"),
    ).toEqual(expect.any(Number));

    act(() => {
      result.current.clearAutoTitlePending("ws-1", "thread-2");
    });
    expect(result.current.isAutoTitlePending("ws-1", "thread-2")).toBe(false);
    expect(result.current.getAutoTitlePendingStartedAt("ws-1", "thread-2")).toBeNull();
  });
});
