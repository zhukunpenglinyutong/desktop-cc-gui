import { describe, expect, it, vi } from "vitest";
import { createInputQueue } from "./input-queue";

const isSessionGone = (error: unknown) => String(error).includes("Terminal session not found");

describe("createInputQueue", () => {
  it("writes the first chunk immediately and coalesces the rest in order", async () => {
    const gate = Promise.withResolvers<void>();
    const write = vi.fn(() => gate.promise);
    const queue = createInputQueue({ write, reopen: vi.fn(async () => {}), isSessionGone });

    const done = queue.send("a");
    void queue.send("bc");
    void queue.send("d");
    expect(write.mock.calls).toEqual([["a"]]);

    gate.resolve();
    await done;
    expect(write.mock.calls).toEqual([["a"], ["bcd"]]);
  });

  it("never starts a write while the previous one is in flight", async () => {
    const first = Promise.withResolvers<void>();
    const second = Promise.withResolvers<void>();
    const inFlight: string[] = [];
    const write = vi.fn((data: string) => {
      inFlight.push(data);
      return inFlight.length === 1 ? first.promise : second.promise;
    });
    const queue = createInputQueue({ write, reopen: vi.fn(async () => {}), isSessionGone });

    const done = queue.send("a");
    void queue.send("b");
    expect(inFlight).toEqual(["a"]);

    first.resolve();
    await first.promise;
    expect(inFlight).toEqual(["a", "b"]);
    second.resolve();
    await done;
  });

  it("reopens the session and resends the same chunk when the shell is gone", async () => {
    const write = vi
      .fn<(data: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("Terminal session not found"))
      .mockResolvedValue(undefined);
    const reopen = vi.fn(async () => {});
    const queue = createInputQueue({
      write: write as unknown as (data: string) => Promise<void>,
      reopen,
      isSessionGone,
    });

    await queue.send("x");

    expect(reopen).toHaveBeenCalledOnce();
    expect(write.mock.calls).toEqual([["x"], ["x"]]);
  });

  it("drops a chunk on an unrelated write failure and keeps accepting input", async () => {
    const write = vi
      .fn<(data: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(undefined);
    const reopen = vi.fn(async () => {});
    const queue = createInputQueue({
      write: write as unknown as (data: string) => Promise<void>,
      reopen,
      isSessionGone,
    });

    await queue.send("a");
    await queue.send("b");

    expect(reopen).not.toHaveBeenCalled();
    expect(write.mock.calls).toEqual([["a"], ["b"]]);
  });
});
