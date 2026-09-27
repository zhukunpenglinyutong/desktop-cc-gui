import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  BeforeTurnEvent,
  PromptContribution,
  RuntimeSwitchEvent,
  SessionCreatedEvent,
} from "@ccgui/plugin-sdk";
import {
  collectBeforeTurnContributions,
  confirmPromptContributions,
  dispatchAfterTurn,
  dispatchRuntimeEvent,
  dispatchSessionCreated,
  dispatchTurnStarted,
  registerRuntimeSwitchHooks,
  registerSessionHooks,
  registerTurnHooks,
  runBeforeSwitch,
} from "./hooks";
const disposers: Array<() => void> = [];

afterEach(() => {
  while (disposers.length > 0) disposers.pop()?.();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function contribution(id: string, content = id): PromptContribution {
  return {
    id,
    content,
    placement: "request-tail",
    visibility: "internal",
    persistence: "turn",
  };
}

const beforeTurnEvent = { turnId: "turn-1" } as BeforeTurnEvent;
const switchEvent = {
  switchId: "switch-1",
  sourceEngine: "claude",
  targetEngine: "codex",
  sourceSessionId: null,
  targetSessionId: null,
  workspace: { id: "workspace-1", path: "/work" },
  occurredAt: "2026-09-13T00:00:00.000Z",
} satisfies RuntimeSwitchEvent;

describe("plugin hook runtime", () => {
  it("collects prompt contributions in registration order and honors disposers", async () => {
    disposers.push(
      registerTurnHooks("first", {
        beforeTurn: () => ({ promptContributions: [contribution("first")] }),
      }),
    );
    const disposeSecond = registerTurnHooks("second", {
      beforeTurn: () => ({ promptContributions: [contribution("second")] }),
    });
    disposeSecond();
    disposers.push(
      registerTurnHooks("third", {
        beforeTurn: () => ({ promptContributions: [contribution("third-a"), contribution("third-b")] }),
      }),
    );

    const result = await collectBeforeTurnContributions(beforeTurnEvent);

    expect(result).toEqual({
      promptContributions: [contribution("first"), contribution("third-a"), contribution("third-b")],
      internalMessageCaptures: [],
    });
  });

  it("makes registration disposers idempotent", async () => {
    const dispose = registerTurnHooks("plugin", {
      beforeTurn: () => ({ promptContributions: [contribution("disposed")] }),
    });

    dispose();
    dispose();

    await expect(collectBeforeTurnContributions(beforeTurnEvent)).resolves.toEqual({
      promptContributions: [],
      internalMessageCaptures: [],
    });
  });

  it("does not deliver queued events after the owning registration is disposed", async () => {
    const onTurnStarted = vi.fn();
    const afterTurn = vi.fn();
    const dispose = registerTurnHooks("retired-owner", { onTurnStarted, afterTurn });
    dispatchTurnStarted(beforeTurnEvent);
    dispatchAfterTurn({ ...beforeTurnEvent, status: "completed" });
    dispose();
    await Promise.resolve();
    expect(onTurnStarted).not.toHaveBeenCalled();
    expect(afterTurn).not.toHaveBeenCalled();
  });

  it("discards a before-turn result that resolves after its owner is disposed", async () => {
    const pending = Promise.withResolvers<{
      promptContributions: PromptContribution[];
      internalMessageCapture: { channel: string; nonce: string; maxBytes: number };
    }>();
    const dispose = registerTurnHooks("retired-owner", { beforeTurn: () => pending.promise });
    const collecting = collectBeforeTurnContributions(beforeTurnEvent);
    dispose();
    pending.resolve({
      promptContributions: [contribution("obsolete")],
      internalMessageCapture: { channel: "facts", nonce: "retired", maxBytes: 256 },
    });
    expect(await collecting).toEqual({ promptContributions: [], internalMessageCaptures: [] });
  });

  it("revokes a workspace result while another plugin hook is still pending", async () => {
    const gate = Promise.withResolvers<void>();
    let current = true;
    disposers.push(registerTurnHooks("workspace-owner", {
      beforeTurn: () => ({
        isCurrent: () => current,
        promptContributions: [contribution("obsolete")],
        internalMessageCapture: { channel: "facts", nonce: "retired", maxBytes: 256 },
      }),
    }));
    disposers.push(registerTurnHooks("pending-owner", {
      beforeTurn: async () => { await gate.promise; return { promptContributions: [contribution("still-active")] }; },
    }));
    const pending = collectBeforeTurnContributions(beforeTurnEvent);
    await Promise.resolve();
    current = false;
    gate.resolve();
    expect(await pending).toEqual({ promptContributions: [contribution("still-active")], internalMessageCaptures: [] });
  });

  it("does not commit a collected contribution whose workspace lifetime has expired", async () => {
    let current = true;
    const onAccepted = vi.fn();
    disposers.push(registerTurnHooks("workspace-owner", {
      beforeTurn: () => ({ isCurrent: () => current, promptContributions: [{ ...contribution("obsolete"), onAccepted }] }),
    }));
    const result = await collectBeforeTurnContributions(beforeTurnEvent);
    current = false;
    confirmPromptContributions(result.promptContributions);
    expect(onAccepted).not.toHaveBeenCalled();
  });

  it("does not confirm a contribution after its registration has been disposed", async () => {
    const onAccepted = vi.fn();
    const dispose = registerTurnHooks("retired-owner", {
      beforeTurn: () => ({ promptContributions: [{ ...contribution("obsolete"), onAccepted }] }),
    });
    const result = await collectBeforeTurnContributions(beforeTurnEvent);
    dispose();
    confirmPromptContributions(result.promptContributions);
    expect(onAccepted).not.toHaveBeenCalled();
  });

  it("clamps a plugin's declared capture budget to what the host can record", async () => {
    disposers.push(
      registerTurnHooks("greedy", {
        beforeTurn: () => ({
          internalMessageCapture: {
            channel: "facts",
            nonce: "n-2",
            maxBytes: Number.MAX_SAFE_INTEGER,
          },
        }),
      }),
    );
    disposers.push(
      registerTurnHooks("broken", {
        beforeTurn: () => ({
          internalMessageCapture: { channel: "facts", nonce: "n-3", maxBytes: Number.NaN },
        }),
      }),
    );

    const result = await collectBeforeTurnContributions(beforeTurnEvent);
    const budgets = new Map(
      result.internalMessageCaptures.map((r) => [r.pluginId, r.capture.maxBytes]),
    );

    // A budget past the host's own recording ceiling would hide a frame live
    // that reload shows again; a non-numeric budget hides nothing.
    expect(budgets.get("greedy")).toBe(64 * 1024);
    expect(budgets.get("broken")).toBe(0);
  });

  it("isolates session hook errors and continues in registration order", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const seen: string[] = [];
    disposers.push(
      registerSessionHooks("throws", {
        onCreated: () => {
          seen.push("throws");
          throw new Error("broken session hook");
        },
      }),
      registerSessionHooks("runs", {
        onCreated: () => {
          seen.push("runs");
        },
      }),
    );

    dispatchSessionCreated({ sessionId: null } as SessionCreatedEvent);
    expect(seen).toEqual([]);
    await Promise.resolve();
    expect(seen).toEqual(["throws", "runs"]);
  });

  it("isolates plugin failures and applies the byte guard deterministically", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    disposers.push(
      registerTurnHooks("throws", {
        beforeTurn: () => {
          throw new Error("broken plugin");
        },
      }),
      registerTurnHooks("fits", {
        beforeTurn: () => ({ promptContributions: [contribution("fits", "1234")] }),
      }),
      registerTurnHooks("overflow", {
        beforeTurn: () => ({ promptContributions: [contribution("overflow", "56789")] }),
      }),
    );

    const result = await collectBeforeTurnContributions(beforeTurnEvent, { maxBytes: 8 });

    expect(result).toEqual({
      promptContributions: [contribution("fits", "1234")],
      internalMessageCaptures: [],
    });
  });

  it("confirms admitted contributions only when the caller commits the launch", async () => {
    const accepted = vi.fn();
    const overflow = vi.fn();
    const fits = { ...contribution("fits", "1234"), onAccepted: accepted };
    const skipped = { ...contribution("overflow", "5"), onAccepted: overflow };
    disposers.push(
      registerTurnHooks("plugin", {
        beforeTurn: () => ({ promptContributions: [fits, skipped] }),
      }),
    );

    const result = await collectBeforeTurnContributions(beforeTurnEvent, { maxBytes: 4 });

    expect(result.promptContributions).toEqual([fits]);
    expect(accepted).not.toHaveBeenCalled();
    expect(overflow).not.toHaveBeenCalled();
    confirmPromptContributions(result.promptContributions);
    confirmPromptContributions(result.promptContributions);
    const repeated = await collectBeforeTurnContributions(beforeTurnEvent, { maxBytes: 4 });
    confirmPromptContributions(repeated.promptContributions);
    expect(accepted).toHaveBeenCalledTimes(1);
    expect(overflow).not.toHaveBeenCalled();
  });

  it("keeps confirmed contributions and continues when onAccepted throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const throws = vi.fn(() => {
      throw new Error("broken acceptance callback");
    });
    const continues = vi.fn();
    const first = { ...contribution("first"), onAccepted: throws };
    const second = { ...contribution("second"), onAccepted: continues };
    disposers.push(
      registerTurnHooks("plugin", {
        beforeTurn: () => ({ promptContributions: [first, second] }),
      }),
    );

    const result = await collectBeforeTurnContributions(beforeTurnEvent);
    confirmPromptContributions(result.promptContributions);

    expect(result.promptContributions).toEqual([first, second]);
    expect(throws).toHaveBeenCalledTimes(1);
    expect(continues).toHaveBeenCalledTimes(1);
  });

  it("times out before-turn hooks and ignores their late results", async () => {
    vi.useFakeTimers();
    const late = Promise.withResolvers<{ promptContributions: PromptContribution[] }>();
    disposers.push(
      registerTurnHooks("slow", {
        beforeTurn: () => late.promise,
      }),
    );

    const pending = collectBeforeTurnContributions(beforeTurnEvent, { timeoutMs: 20 });
    await vi.advanceTimersByTimeAsync(20);
    await expect(pending).resolves.toEqual({
      promptContributions: [],
      internalMessageCaptures: [],
    });

    late.resolve({ promptContributions: [contribution("too-late")] });
    await Promise.resolve();
    await expect(pending).resolves.toEqual({
      promptContributions: [],
      internalMessageCaptures: [],
    });
  });

  it("invalidates an older before-turn generation when a newer collection starts", async () => {
    let invocation = 0;
    const first = Promise.withResolvers<{ promptContributions: PromptContribution[] }>();
    disposers.push(
      registerTurnHooks("plugin", {
        beforeTurn: () => {
          invocation += 1;
          if (invocation === 1) return first.promise;
          return { promptContributions: [contribution("new")] };
        },
      }),
    );

    const stale = collectBeforeTurnContributions(beforeTurnEvent, { timeoutMs: 100 });
    const current = collectBeforeTurnContributions(beforeTurnEvent, { timeoutMs: 100 });
    first.resolve({ promptContributions: [contribution("stale")] });

    await expect(current).resolves.toEqual({
      promptContributions: [contribution("new")],
      internalMessageCaptures: [],
    });
    await expect(stale).resolves.toEqual({
      promptContributions: [],
      internalMessageCaptures: [],
    });
  });

  it("keeps concurrent before-turn collections for different runs independent", async () => {
    const runA = Promise.withResolvers<{ promptContributions: PromptContribution[] }>();
    const runB = Promise.withResolvers<{ promptContributions: PromptContribution[] }>();
    disposers.push(
      registerTurnHooks("plugin", {
        beforeTurn: (event) =>
          event.runId === "run-a"
            ? runA.promise
            : event.runId === "run-b"
              ? runB.promise
              : { promptContributions: [contribution("unexpected")] },
      }),
    );

    const a = collectBeforeTurnContributions(
      { runId: "run-a", turnId: "turn-a" } as BeforeTurnEvent,
      { timeoutMs: 100 },
    );
    const b = collectBeforeTurnContributions(
      { runId: "run-b", turnId: "turn-b" } as BeforeTurnEvent,
      { timeoutMs: 100 },
    );

    runA.resolve({ promptContributions: [contribution("a")] });
    await expect(a).resolves.toEqual({
      promptContributions: [contribution("a")],
      internalMessageCaptures: [],
    });

    runB.resolve({ promptContributions: [contribution("b")] });
    await expect(b).resolves.toEqual({
      promptContributions: [contribution("b")],
      internalMessageCaptures: [],
    });
  });

  it("keeps concurrent before-switch runs for different targets independent", async () => {
    const slow = Promise.withResolvers<void>();
    disposers.push(
      registerRuntimeSwitchHooks("plugin", {
        beforeSwitch: (event) =>
          event.workspace.id === "workspace-1" ? slow.promise : undefined,
      }),
    );

    const first = runBeforeSwitch(switchEvent, { timeoutMs: 100 });
    let firstSettled = false;
    void first.then(() => {
      firstSettled = true;
    });
    const second = runBeforeSwitch(
      { ...switchEvent, targetEngine: "claude", workspace: { id: "workspace-2", path: "/other" } },
      { timeoutMs: 100 },
    );

    await expect(second).resolves.toBeUndefined();
    await Promise.resolve();
    expect(firstSettled).toBe(false);

    slow.resolve();
    await expect(first).resolves.toBeUndefined();
  });
  it("keeps same-target switches independent by switchId", async () => {
    const slow = Promise.withResolvers<void>();
    disposers.push(registerRuntimeSwitchHooks("plugin", {
      beforeSwitch: (event) => event.switchId === "switch-slow" ? slow.promise : undefined,
    }));
    const first = runBeforeSwitch({ ...switchEvent, switchId: "switch-slow" }, { timeoutMs: 100 });
    const second = runBeforeSwitch({ ...switchEvent, switchId: "switch-fast" }, { timeoutMs: 100 });
    await expect(second).resolves.toBeUndefined();
    slow.resolve();
    await expect(first).resolves.toBeUndefined();
  });

  it("caps before-switch waiting and fails open when a plugin rejects", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const reached: string[] = [];
    disposers.push(
      registerRuntimeSwitchHooks("rejects", {
        beforeSwitch: async () => {
          throw new Error("nope");
        },
      }),
      registerRuntimeSwitchHooks("slow", {
        beforeSwitch: () => Promise.withResolvers<void>().promise,
      }),
      registerRuntimeSwitchHooks("runs", {
        beforeSwitch: () => {
          reached.push("runs");
        },
      }),
    );

    const pending = runBeforeSwitch(switchEvent, { timeoutMs: 20 });
    await vi.advanceTimersByTimeAsync(20);
    await expect(pending).resolves.toBeUndefined();
    expect(reached).toEqual(["runs"]);
  });

  it("schedules turn observers in order without blocking their callers, isolating failures", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const seen: string[] = [];
    const pending = Promise.withResolvers<void>();
    disposers.push(
      registerTurnHooks("throws", {
        onTurnStarted: () => {
          throw new Error("broken start observer");
        },
      }),
      registerTurnHooks("rejects", {
        onTurnStarted: async () => {
          throw new Error("rejected start observer");
        },
      }),
      registerTurnHooks("plugin", {
        onTurnStarted: async () => {
          seen.push("started");
          await pending.promise;
        },
        onRuntimeEvent: () => {
          seen.push("runtime");
        },
        afterTurn: () => {
          seen.push("after");
        },
      }),
    );

    expect(dispatchTurnStarted(beforeTurnEvent)).toBeUndefined();
    expect(dispatchRuntimeEvent({ kind: "assistant-completed" } as never)).toBeUndefined();
    expect(dispatchAfterTurn({ ...beforeTurnEvent, status: "completed" })).toBeUndefined();
    expect(seen).toEqual([]);
    await Promise.resolve();
    // A throwing/rejecting observer must not stop the later registration.
    expect(seen).toEqual(["started", "runtime", "after"]);
    pending.resolve();
    await Promise.resolve();
    expect(console.error).toHaveBeenCalledTimes(2);
  });
});
