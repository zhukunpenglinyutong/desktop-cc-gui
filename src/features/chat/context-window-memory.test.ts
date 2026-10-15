import { beforeEach, describe, expect, it, vi } from "vitest";
import { ASSUMED_CONTEXT_WINDOW } from "./usage";
import {
  recallContextWindow,
  rememberContextWindow,
  resolveContextMax,
} from "./context-window-memory";

describe("context window memory", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("remembers a reported window per engine and model slot", () => {
    rememberContextWindow("claude", "default", 1_000_000);

    expect(recallContextWindow("claude", "default")).toBe(1_000_000);
    // Another slot (or engine) has its own memory.
    expect(recallContextWindow("claude", "sonnet")).toBeUndefined();
    expect(recallContextWindow("codex", "default")).toBeUndefined();
  });

  it("returns undefined for unknown slots and ignores non-positive windows", () => {
    expect(recallContextWindow("claude", "default")).toBeUndefined();

    rememberContextWindow("claude", "default", 0);

    expect(recallContextWindow("claude", "default")).toBeUndefined();
  });

  it("treats a broken storage as a cache miss instead of crashing", () => {
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota exceeded");
      });

    expect(() =>
      rememberContextWindow("claude", "default", 1_000_000),
    ).not.toThrow();

    setItem.mockRestore();
    expect(recallContextWindow("claude", "default")).toBeUndefined();
  });

  it("starts a fresh session at the remembered window instead of the 200k guess", () => {
    rememberContextWindow("claude", "default", 1_000_000);

    expect(
      resolveContextMax({
        usage: undefined,
        engine: "claude",
        model: "default",
      }),
    ).toBe(1_000_000);
  });

  it("uses runtime metadata even before a token report arrives", () => {
    rememberContextWindow("claude", "default", 200_000);
    expect(resolveContextMax({ usage: { contextWindow: 1_000_000 }, engine: "claude", model: "default", catalogWindow: 500_000 })).toBe(1_000_000);
  });

  it("prefers a live report, then memory, then the catalog, then the guess", () => {
    rememberContextWindow("claude", "default", 500_000);

    // A live report (the engine's own window) wins over memory and catalog.
    expect(
      resolveContextMax({
        usage: {
          input_tokens: 10,
          total_tokens: 10,
          model_context_window: 1_000_000,
        },
        engine: "claude",
        model: "default",
        catalogWindow: 200_000,
      }),
    ).toBe(1_000_000);

    // No live window: memory wins over the catalog.
    expect(
      resolveContextMax({
        usage: { input_tokens: 10, total_tokens: 10 },
        engine: "claude",
        model: "default",
        catalogWindow: 200_000,
      }),
    ).toBe(500_000);

    // No memory for this slot: the catalog wins.
    expect(
      resolveContextMax({
        usage: undefined,
        engine: "claude",
        model: "sonnet",
        catalogWindow: 200_000,
      }),
    ).toBe(200_000);

    // Nothing anywhere: the shared guess.
    expect(
      resolveContextMax({ usage: undefined, engine: "pi", model: "x" }),
    ).toBe(ASSUMED_CONTEXT_WINDOW);
  });
});
