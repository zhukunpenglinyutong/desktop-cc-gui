import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCopied } from "./use-copied";

function renderHook<T>(hook: () => T) {
  const result: { current: T } = {} as { current: T };
  function TestComponent() {
    result.current = hook();
    return null;
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<TestComponent />);
  });
  return {
    result,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe("useCopied", () => {
  const originalClipboard = navigator.clipboard;
  const originalExecCommand = document.execCommand;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(navigator, "clipboard", {
      value: originalClipboard,
      configurable: true,
      writable: true,
    });
    document.execCommand = originalExecCommand;
  });

  it("sets copied to true on success and resets after resetMs", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextMock },
      configurable: true,
      writable: true,
    });

    const { result, unmount } = renderHook(() => useCopied(1000));
    expect(result.current.copied).toBe(false);

    await act(async () => {
      result.current.copy("test string");
    });

    expect(result.current.copied).toBe(true);
    expect(writeTextMock).toHaveBeenCalledWith("test string");

    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(result.current.copied).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.copied).toBe(false);

    unmount();
  });

  it("falls back to execCommand and sets copied=true in insecure HTTP context", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
      writable: true,
    });

    document.execCommand = vi.fn().mockReturnValue(true);

    const { result, unmount } = renderHook(() => useCopied(1000));
    expect(result.current.copied).toBe(false);

    await act(async () => {
      result.current.copy("insecure text");
    });

    expect(result.current.copied).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.copied).toBe(false);

    unmount();
  });

  it("does not set copied to true and does not throw if copy fails completely", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
      writable: true,
    });

    document.execCommand = vi.fn().mockReturnValue(false);

    const { result, unmount } = renderHook(() => useCopied(1000));
    expect(result.current.copied).toBe(false);

    await act(async () => {
      result.current.copy("failed text");
    });

    expect(result.current.copied).toBe(false);

    unmount();
  });

  it("cleans up timer on unmount and prevents state update", async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextMock },
      configurable: true,
      writable: true,
    });

    const { result, unmount } = renderHook(() => useCopied(1000));

    await act(async () => {
      result.current.copy("unmount test");
    });
    expect(result.current.copied).toBe(true);

    unmount();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
  });
});
