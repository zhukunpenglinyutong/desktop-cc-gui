// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import type { Update } from "@tauri-apps/plugin-updater";
import type { DebugEntry } from "../../../types";
import { useUpdater } from "./useUpdater";

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: vi.fn(() => true),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: vi.fn(),
}));

const checkMock = vi.mocked(check);
const relaunchMock = vi.mocked(relaunch);

type MockUpdate = Update & {
  downloadAndInstall: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

function createMockUpdate(version: string): MockUpdate {
  return {
    version,
    downloadAndInstall: vi.fn(),
    close: vi.fn(),
  } as MockUpdate;
}

describe("useUpdater", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps background update check failures non-blocking", async () => {
    checkMock.mockRejectedValue(new Error("background nope"));
    const onDebug = vi.fn();
    const { result } = renderHook(() => useUpdater({ onDebug }));

    await act(async () => {
      await result.current.checkForUpdates();
    });

    expect(result.current.state.stage).toBe("idle");
    expect(onDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.any(String),
        timestamp: expect.any(Number),
        label: "updater/error",
        source: "error",
        payload: "background nope",
      } satisfies Partial<DebugEntry>),
    );
  });

  it("sets error state when interactive update check fails", async () => {
    checkMock.mockRejectedValue(new Error("nope"));
    const onDebug = vi.fn();
    const { result } = renderHook(() => useUpdater({ onDebug }));

    await act(async () => {
      await result.current.startUpdate();
    });

    expect(result.current.state.stage).toBe("error");
    expect(result.current.state.error).toBe("nope");
    expect(onDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.any(String),
        timestamp: expect.any(Number),
        label: "updater/error",
        source: "error",
        payload: "nope",
      } satisfies Partial<DebugEntry>),
    );
  });

  it("announces when start update finds no update", async () => {
    vi.useFakeTimers();
    checkMock.mockResolvedValue(null);
    const { result } = renderHook(() => useUpdater({}));

    await act(async () => {
      await result.current.startUpdate();
    });

    expect(result.current.state.stage).toBe("latest");

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(result.current.state.stage).toBe("idle");
  });

  it("announces when no update is available for manual checks", async () => {
    vi.useFakeTimers();
    checkMock.mockResolvedValue(null);
    const { result } = renderHook(() => useUpdater({}));

    await act(async () => {
      await result.current.checkForUpdates({ announceNoUpdate: true });
    });

    expect(result.current.state.stage).toBe("latest");

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(result.current.state.stage).toBe("idle");
  });

  it("does not let a stale check failure overwrite a newer latest state", async () => {
    const olderCheck = createDeferred<Update | null>();
    const newerCheck = createDeferred<Update | null>();
    checkMock
      .mockReturnValueOnce(olderCheck.promise)
      .mockReturnValueOnce(newerCheck.promise);
    const onDebug = vi.fn();
    const { result } = renderHook(() => useUpdater({ onDebug }));

    let olderPromise: Promise<void> | undefined;
    let newerPromise: Promise<void> | undefined;
    act(() => {
      olderPromise = result.current.checkForUpdates({
        announceNoUpdate: true,
        interactive: true,
      });
    });
    act(() => {
      newerPromise = result.current.checkForUpdates({
        announceNoUpdate: true,
        interactive: true,
      });
    });

    await act(async () => {
      newerCheck.resolve(null);
      await newerPromise;
    });

    expect(result.current.state.stage).toBe("latest");

    await act(async () => {
      olderCheck.reject(new Error("stale failure"));
      await olderPromise;
    });

    expect(result.current.state.stage).toBe("latest");
    expect(onDebug).not.toHaveBeenCalledWith(
      expect.objectContaining({ payload: "stale failure" }),
    );
  });

  it("does not let a stale no-update result overwrite an available update", async () => {
    const olderCheck = createDeferred<Update | null>();
    const newerCheck = createDeferred<Update | null>();
    const update = createMockUpdate("3.0.0");
    checkMock
      .mockReturnValueOnce(olderCheck.promise)
      .mockReturnValueOnce(newerCheck.promise);
    const { result } = renderHook(() => useUpdater({}));

    let olderPromise: Promise<void> | undefined;
    let newerPromise: Promise<void> | undefined;
    act(() => {
      olderPromise = result.current.checkForUpdates({
        announceNoUpdate: true,
        interactive: true,
      });
    });
    act(() => {
      newerPromise = result.current.checkForUpdates({
        announceNoUpdate: true,
        interactive: true,
      });
    });

    await act(async () => {
      newerCheck.resolve(update);
      await newerPromise;
    });

    expect(result.current.state.stage).toBe("available");
    expect(result.current.state.version).toBe("3.0.0");

    await act(async () => {
      olderCheck.resolve(null);
      await olderPromise;
    });

    expect(result.current.state.stage).toBe("available");
    expect(result.current.state.version).toBe("3.0.0");
    expect(update.close).not.toHaveBeenCalled();
  });

  it("dismisses pending checks without restoring stale state", async () => {
    const pendingCheck = createDeferred<Update | null>();
    checkMock.mockReturnValueOnce(pendingCheck.promise);
    const { result } = renderHook(() => useUpdater({}));

    let pendingPromise: Promise<void> | undefined;
    act(() => {
      pendingPromise = result.current.checkForUpdates({
        announceNoUpdate: true,
        interactive: true,
      });
    });

    await act(async () => {
      await result.current.dismiss();
    });

    await act(async () => {
      pendingCheck.resolve(null);
      await pendingPromise;
    });

    expect(result.current.state.stage).toBe("idle");
  });

  it("closes stale update handles", async () => {
    const pendingCheck = createDeferred<Update | null>();
    const staleUpdate = createMockUpdate("4.0.0");
    checkMock.mockReturnValueOnce(pendingCheck.promise);
    const { result } = renderHook(() => useUpdater({}));

    let pendingPromise: Promise<void> | undefined;
    act(() => {
      pendingPromise = result.current.checkForUpdates({
        announceNoUpdate: true,
        interactive: true,
      });
    });

    await act(async () => {
      await result.current.dismiss();
    });

    await act(async () => {
      pendingCheck.resolve(staleUpdate);
      await pendingPromise;
    });

    expect(result.current.state.stage).toBe("idle");
    expect(staleUpdate.close).toHaveBeenCalledTimes(1);
  });

  it("keeps stale update close failures out of visible updater state", async () => {
    const pendingCheck = createDeferred<Update | null>();
    const staleUpdate = createMockUpdate("4.1.0");
    staleUpdate.close.mockRejectedValue(new Error("close failed"));
    checkMock.mockReturnValueOnce(pendingCheck.promise);
    const onDebug = vi.fn();
    const { result } = renderHook(() => useUpdater({ onDebug }));

    let pendingPromise: Promise<void> | undefined;
    act(() => {
      pendingPromise = result.current.checkForUpdates({
        announceNoUpdate: true,
        interactive: true,
      });
    });

    await act(async () => {
      await result.current.dismiss();
    });

    await act(async () => {
      pendingCheck.resolve(staleUpdate);
      await pendingPromise;
    });

    expect(result.current.state.stage).toBe("idle");
    expect(onDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "updater/close-error",
        payload: "close failed",
      } satisfies Partial<DebugEntry>),
    );
  });

  it("normalizes undefined update check failures without breaking updater state", async () => {
    checkMock.mockRejectedValue(undefined);
    const onDebug = vi.fn();
    const { result } = renderHook(() => useUpdater({ onDebug }));

    await act(async () => {
      await result.current.checkForUpdates({ interactive: true });
    });

    expect(result.current.state).toEqual({
      stage: "error",
      error: "undefined",
    });
    expect(onDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "updater/error",
        payload: "undefined",
      } satisfies Partial<DebugEntry>),
    );
  });

  it("normalizes circular update check failures without throwing from the catch path", async () => {
    const circularError: Record<string, unknown> = {};
    circularError.self = circularError;
    checkMock.mockRejectedValue(circularError);
    const onDebug = vi.fn();
    const { result } = renderHook(() => useUpdater({ onDebug }));

    await act(async () => {
      await result.current.checkForUpdates({ interactive: true });
    });

    expect(result.current.state).toEqual({
      stage: "error",
      error: "[object Object]",
    });
    expect(onDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "updater/error",
        payload: "[object Object]",
      } satisfies Partial<DebugEntry>),
    );
  });

  it("downloads and restarts when update is available", async () => {
    const close = vi.fn();
    const downloadAndInstall = vi.fn(async (onEvent) => {
      onEvent({ event: "Started", data: { contentLength: 100 } });
      onEvent({ event: "Progress", data: { chunkLength: 40 } });
      onEvent({ event: "Progress", data: { chunkLength: 60 } });
      onEvent({ event: "Finished", data: {} });
    });
    checkMock.mockResolvedValue({
      version: "1.2.3",
      downloadAndInstall,
      close,
    } as any);

    const { result } = renderHook(() => useUpdater({}));

    await act(async () => {
      await result.current.startUpdate();
    });

    expect(result.current.state.stage).toBe("available");
    expect(result.current.state.version).toBe("1.2.3");

    await act(async () => {
      await result.current.startUpdate();
    });

    await waitFor(() => expect(result.current.state.stage).toBe("restarting"));
    expect(result.current.state.progress?.totalBytes).toBe(100);
    expect(result.current.state.progress?.downloadedBytes).toBe(100);
    expect(downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(relaunchMock).toHaveBeenCalledTimes(1);
  });

  it("resets to idle and closes update on dismiss", async () => {
    const close = vi.fn();
    checkMock.mockResolvedValue({
      version: "1.0.0",
      downloadAndInstall: vi.fn(),
      close,
    } as any);
    const { result } = renderHook(() => useUpdater({}));

    await act(async () => {
      await result.current.startUpdate();
    });

    await act(async () => {
      await result.current.dismiss();
    });

    expect(result.current.state.stage).toBe("idle");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("surfaces download errors and keeps progress", async () => {
    const close = vi.fn();
    const downloadAndInstall = vi.fn(async (onEvent) => {
      onEvent({ event: "Started", data: { contentLength: 50 } });
      onEvent({ event: "Progress", data: { chunkLength: 20 } });
      throw new Error("download failed");
    });
    checkMock.mockResolvedValue({
      version: "2.0.0",
      downloadAndInstall,
      close,
    } as any);
    const onDebug = vi.fn();
    const { result } = renderHook(() => useUpdater({ onDebug }));

    await act(async () => {
      await result.current.startUpdate();
    });

    await act(async () => {
      await result.current.startUpdate();
    });

    await waitFor(() => expect(result.current.state.stage).toBe("error"));
    expect(result.current.state.error).toBe("download failed");
    expect(result.current.state.progress?.downloadedBytes).toBe(20);
    expect(onDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.any(String),
        timestamp: expect.any(Number),
        label: "updater/error",
        source: "error",
        payload: "download failed",
      } satisfies Partial<DebugEntry>),
    );
  });
});
