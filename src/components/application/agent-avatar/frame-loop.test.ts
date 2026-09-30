/**
 * The shared avatar frame loop: every animated avatar hangs off one browser
 * callback, and the loop only lives while it has subscribers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { subscribeFrame } from "./frame-loop";

let scheduled: Array<{ id: number; cb: FrameRequestCallback }> = [];
let cancelled: number[] = [];
let nextId = 1;

/** Runs the queued browser frame; returns how many frames it scheduled next. */
function flush(now = 16) {
  const queued = scheduled;
  scheduled = [];
  for (const { cb } of queued) cb(now);
  return scheduled.length;
}

beforeEach(() => {
  scheduled = [];
  cancelled = [];
  nextId = 1;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    const id = nextId++;
    scheduled.push({ id, cb });
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    cancelled.push(id);
    scheduled = scheduled.filter((frame) => frame.id !== id);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("subscribeFrame", () => {
  it("drives every subscriber from one scheduled frame", () => {
    const calls: Array<[string, number]> = [];
    const stopA = subscribeFrame((now) => calls.push(["a", now]));
    const stopB = subscribeFrame((now) => calls.push(["b", now]));

    expect(scheduled).toHaveLength(1);
    expect(flush(16)).toBe(1);
    // Both ran on the same wake-up, and the loop armed exactly one successor.
    expect(calls).toEqual([["a", 16], ["b", 16]]);

    stopA();
    stopB();
    expect(cancelled).toHaveLength(1);
    expect(scheduled).toHaveLength(0);
  });

  it("keeps the loop while one of several subscribers leaves", () => {
    const seen: string[] = [];
    const stopA = subscribeFrame(() => seen.push("a"));
    const stopB = subscribeFrame(() => seen.push("b"));

    stopA();
    expect(cancelled).toHaveLength(0);
    expect(flush()).toBe(1);
    expect(seen).toEqual(["b"]);

    stopB();
    expect(cancelled).toHaveLength(1);
  });

  it("does not arm a second loop for a subscriber that arrives mid-frame", () => {
    const seen: string[] = [];
    const late: { stop?: () => void } = {};
    const stopFirst = subscribeFrame(() => {
      seen.push("first");
      late.stop ??= subscribeFrame(() => seen.push("late"));
    });

    expect(flush()).toBe(1);
    expect(seen).toEqual(["first"]);
    // The late subscriber was not called in the pass it joined...
    expect(flush()).toBe(1);
    expect(seen).toEqual(["first", "first", "late"]);

    stopFirst();
    late.stop?.();
  });
});
