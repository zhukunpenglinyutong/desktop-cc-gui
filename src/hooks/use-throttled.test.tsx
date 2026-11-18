import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCoalescedValue } from "./use-throttled";

const A = [1];
const B = [2];
const C = [3];

function mount(initial: number[]) {
  let latest: number[] = initial;
  const result: { current: number[] } = { current: initial };
  function TestComponent() {
    result.current = useCoalescedValue(latest, 250);
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
    push(value: number[]) {
      latest = value;
      act(() => {
        root.render(<TestComponent />);
      });
    },
    unmount() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe("useCoalescedValue", () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("publishes the newest value at most once per interval", () => {
    const hook = mount(A);
    expect(hook.result.current).toBe(A);

    // First change is the leading edge: visible before paint.
    hook.push(B);
    expect(hook.result.current).toBe(B);

    // Changes inside the window are held, and the newest one wins.
    hook.push(A);
    hook.push(C);
    expect(hook.result.current).toBe(B);

    act(() => vi.advanceTimersByTime(249));
    expect(hook.result.current).toBe(B);
    act(() => vi.advanceTimersByTime(1));
    expect(hook.result.current).toBe(C);

    // The window restarts at the trailing publish, not at the last input.
    hook.push(A);
    expect(hook.result.current).toBe(C);
    act(() => vi.advanceTimersByTime(250));
    expect(hook.result.current).toBe(A);

    hook.unmount();
  });

  it("cancels the pending publish on unmount", () => {
    const hook = mount(A);
    hook.push(B);
    hook.push(C);
    hook.unmount();
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
  });

  it("skips inputs the consumer cannot tell apart", () => {
    const sameLength = (a: number[], b: number[]) => a.length === b.length;
    let latest: number[] = A;
    let result: number[] = A;
    function TestComponent() {
      result = useCoalescedValue(latest, 250, sameLength);
      return null;
    }
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => {
      root.render(<TestComponent />);
    });
    latest = B;
    act(() => {
      root.render(<TestComponent />);
    });
    expect(result).toBe(A);
    act(() => vi.advanceTimersByTime(500));
    expect(result).toBe(A);
    latest = [1, 2];
    act(() => {
      root.render(<TestComponent />);
    });
    expect(result).toEqual([1, 2]);
    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
