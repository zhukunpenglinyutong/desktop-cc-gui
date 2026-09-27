import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ipc } from "@/lib/ipc";
import { collectBeforeTurnContributions, registerTurnHooks } from "@/features/plugins/runtime/hooks";
import { routeRun } from "./stream";
import {
  bindRunLifecycle,
  finishRunLifecycle,
  filterInternalFrameDelta,
  flushInternalFrameDelta,
  handleEngineEvents,
  registerPendingRunLifecycle,
  replayBufferedEngineEvents,
  unregisterRunLifecycle,
} from "./engine-events";

vi.mock("@/lib/ipc", () => ({
  ipc: {
    recordAcceptedInternalFrame: vi.fn(async () => undefined),
    rescanSessions: vi.fn(async () => undefined),
    usageRecord: vi.fn(async () => undefined),
  },
}));

const workspace = { id: "workspace-1", path: "/tmp/workspace" };
const fixtureDisposers: Array<() => void> = [];

/** Deps for events that resolve no session key: the loop must not touch the
 * store for a run it cannot route. */
function fakeDeps() {
  return {
    set: vi.fn(),
    get: () => ({ bySession: {}, streamingByKey: {}, retryingByKey: {} }) as never,
    drainQueue: vi.fn(),
    markUnseenIfBackground: vi.fn(),
    upsertSessionMeta: vi.fn(),
  };
}

/** Register a live run: pre-register under a placeholder, then bind the real
 * run id (the path the store now takes for every send). */
async function startRun(
  runId: string,
  pluginId: string,
  capture: { channel: string; nonce?: string; maxBytes: number; validate?: (payload: unknown) => boolean },
) {
  const placeholder = `pending:${runId}`;
  fixtureDisposers.push(registerTurnHooks(pluginId, { beforeTurn: () => ({ internalMessageCapture: capture }) }));
  const collected = await collectBeforeTurnContributions({ runId: placeholder, turnId: "turn-1", engine: "claude", sessionId: null, workspace, occurredAt: "2026-09-17T00:00:00Z" });
  const settleLaunch = registerPendingRunLifecycle(placeholder, {
    turnId: "turn-1",
    engine: "claude",
    sessionId: null,
    workspace,
    captures: collected.internalMessageCaptures,
  });
  bindRunLifecycle(placeholder, runId);
  settleLaunch();
}

async function begin(runId: string, nonce = "abc123") {
  return await startRun(runId, "test.capture", { channel: "facts", nonce, maxBytes: 1024 });
}

beforeEach(() => vi.mocked(ipc.recordAcceptedInternalFrame).mockClear());
afterEach(() => {
  unregisterRunLifecycle("run-1");
  while (fixtureDisposers.length) fixtureDisposers.pop()?.();
});

describe("incremental internal frame routing", () => {
  it("releases a buffered frame when its originating result retires", async () => {
    let current = true;
    const validate = vi.fn(() => true);
    const delivered = vi.fn();
    const dispose = registerTurnHooks("test.retired-capture", {
      beforeTurn: () => ({
        internalMessageCapture: { channel: "facts", nonce: "retired", maxBytes: 1024, validate },
        isCurrent: () => current,
      }),
      onInternalMessage: delivered,
    });
    try {
      const collected = await collectBeforeTurnContributions({ runId: "run-1", turnId: "turn-1", engine: "claude", sessionId: "session-1", workspace, occurredAt: "2026-09-17T00:00:00Z" });
      registerPendingRunLifecycle("run-1", { turnId: "turn-1", engine: "claude", sessionId: "session-1", workspace, captures: collected.internalMessageCaptures });
      expect(filterInternalFrameDelta("run-1", 'visible<CCGUI_INTERNAL_retired>{"ok":')).toBe("visible");
      current = false;
      expect(filterInternalFrameDelta("run-1", "true}</CCGUI_INTERNAL_retired>tail"))
        .toBe('<CCGUI_INTERNAL_retired>{"ok":true}</CCGUI_INTERNAL_retired>tail');
      await Promise.resolve();
      expect(validate).not.toHaveBeenCalled();
      expect(delivered).not.toHaveBeenCalled();
      expect(ipc.recordAcceptedInternalFrame).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it("does not route an old capture to replacement hooks with the same plugin id", async () => {
    const previous = vi.fn();
    const replacement = vi.fn();
    const disposeOld = registerTurnHooks("test.replaced-capture", {
      beforeTurn: () => ({ internalMessageCapture: { channel: "facts", nonce: "replaced", maxBytes: 1024 } }),
      onInternalMessage: previous,
    });
    let disposeNew = () => {};
    try {
      const collected = await collectBeforeTurnContributions({ runId: "run-1", turnId: "turn-1", engine: "claude", sessionId: "session-1", workspace, occurredAt: "2026-09-17T00:00:00Z" });
      registerPendingRunLifecycle("run-1", { turnId: "turn-1", engine: "claude", sessionId: "session-1", workspace, captures: collected.internalMessageCaptures });
      disposeOld();
      disposeNew = registerTurnHooks("test.replaced-capture", { onInternalMessage: replacement });
      const frame = '<CCGUI_INTERNAL_replaced>{"ok":true}</CCGUI_INTERNAL_replaced>';
      expect(filterInternalFrameDelta("run-1", frame)).toBe(frame);
      await Promise.resolve();
      expect(previous).not.toHaveBeenCalled();
      expect(replacement).not.toHaveBeenCalled();
      expect(ipc.recordAcceptedInternalFrame).not.toHaveBeenCalled();
    } finally {
      disposeOld();
      disposeNew();
    }
  });

  it("rechecks the result lifetime before queued internal delivery", async () => {
    let current = true;
    const delivered = vi.fn();
    const dispose = registerTurnHooks("test.queued-capture", {
      beforeTurn: () => ({
        internalMessageCapture: { channel: "facts", nonce: "queued", maxBytes: 1024 },
        isCurrent: () => current,
      }),
      onInternalMessage: delivered,
    });
    try {
      const collected = await collectBeforeTurnContributions({ runId: "run-1", turnId: "turn-1", engine: "claude", sessionId: "session-1", workspace, occurredAt: "2026-09-17T00:00:00Z" });
      registerPendingRunLifecycle("run-1", { turnId: "turn-1", engine: "claude", sessionId: "session-1", workspace, captures: collected.internalMessageCaptures });
      expect(filterInternalFrameDelta("run-1", '<CCGUI_INTERNAL_queued>{"ok":true}</CCGUI_INTERNAL_queued>')).toBe("");
      current = false;
      await Promise.resolve();
      expect(delivered).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it("removes a valid frame split across chunk boundaries and routes it only to its owner", async () => {
    const owned = vi.fn();
    const other = vi.fn();
    const disposeOwned = registerTurnHooks("test.capture", { onInternalMessage: owned });
    const disposeOther = registerTurnHooks("test.other", { onInternalMessage: other });
    await begin("run-1");

    const visible = [
      filterInternalFrameDelta("run-1", "answer<CCGUI_INTER"),
      filterInternalFrameDelta("run-1", 'NAL_abc123>{"ok":'),
      filterInternalFrameDelta("run-1", "true}</CCGUI_INTERNAL_abc123>tail"),
      flushInternalFrameDelta("run-1"),
    ].join("");
    await Promise.resolve();
    disposeOwned();
    disposeOther();

    expect(visible).toBe("answertail");
    expect(owned).toHaveBeenCalledWith(expect.objectContaining({
      channel: "facts",
      nonce: "abc123",
      payload: { ok: true },
    }));
    expect(other).not.toHaveBeenCalled();
  });

  it("retains an opening tag split inside its nonce", async () => {
    const owned = vi.fn();
    const dispose = registerTurnHooks("test.capture", { onInternalMessage: owned });
    await begin("run-1");

    const visible = [
      filterInternalFrameDelta("run-1", "answer<CCGUI_INTERNAL_ab"),
      filterInternalFrameDelta(
        "run-1",
        'c123>{"ok":true}</CCGUI_INTERNAL_abc123>tail',
      ),
      flushInternalFrameDelta("run-1"),
    ].join("");
    await Promise.resolve();
    dispose();

    expect(visible).toBe("answertail");
    expect(owned).toHaveBeenCalledWith(
      expect.objectContaining({ nonce: "abc123", payload: { ok: true } }),
    );
  });

  it("passes deltas straight through when the run registered no capture", () => {
    // Default configuration (no plugin asked for internal messages): nothing
    // can ever be a hidden frame, so every chunk must reach the transcript.
    registerPendingRunLifecycle("pending:run-1", {
      turnId: "turn-1",
      engine: "claude",
      sessionId: null,
      workspace,
      captures: [],
    });
    bindRunLifecycle("pending:run-1", "run-1");

    expect(filterInternalFrameDelta("run-1", "Hello ")).toBe("Hello ");
    expect(filterInternalFrameDelta("run-1", "world")).toBe("world");
    // The marker that would start a frame is ordinary text here too.
    expect(filterInternalFrameDelta("run-1", "<CCGUI_INTERNAL_zzz>")).toBe(
      "<CCGUI_INTERNAL_zzz>",
    );
    expect(flushInternalFrameDelta("run-1")).toBe("");
  });

  it("keeps invalid and incomplete frames visible", async () => {
    await begin("run-1");
    const invalid = "<CCGUI_INTERNAL_abc123>{bad}</CCGUI_INTERNAL_abc123>";
    expect(filterInternalFrameDelta("run-1", invalid)).toBe(invalid);
    expect(filterInternalFrameDelta("run-1", "start<CCGUI_INTERNAL_abc123>{\"ok\":"))
      .toBe("start");
    expect(flushInternalFrameDelta("run-1")).toBe(
      '<CCGUI_INTERNAL_abc123>{"ok":',
    );
  });

  it("keeps a JSON-valid frame visible when the capture's validator rejects it", async () => {
    const owned = vi.fn();
    const dispose = registerTurnHooks("test.validated", { onInternalMessage: owned });
    await startRun("run-1", "test.validated", {
      channel: "facts",
      nonce: "abc123",
      maxBytes: 1024,
      validate: (payload: unknown) => {
        if (typeof payload !== "object" || payload === null) return false;
        return "ok" in payload && payload.ok === true;
      },
    });

    const rejected = '<CCGUI_INTERNAL_abc123>{"ok":false}</CCGUI_INTERNAL_abc123>';
    expect(filterInternalFrameDelta("run-1", rejected)).toBe(rejected);
    expect(filterInternalFrameDelta("run-1", '<CCGUI_INTERNAL_abc123>{"ok":true}</CCGUI_INTERNAL_abc123>')).toBe("");
    await Promise.resolve();
    dispose();

    expect(owned).not.toHaveBeenCalledWith(expect.objectContaining({ payload: { ok: false } }));
    expect(owned).toHaveBeenCalledTimes(1);
    expect(owned).toHaveBeenCalledWith(expect.objectContaining({ payload: { ok: true } }));
  });

  it("persists only a validator-accepted frame after the native session is known", async () => {
    const accepted = '<CCGUI_INTERNAL_abc123>{"ok":true}</CCGUI_INTERNAL_abc123>';
    const rejected = '<CCGUI_INTERNAL_abc123>{"ok":false}</CCGUI_INTERNAL_abc123>';
    await startRun("run-1", "test.capture", {
      channel: "facts",
      nonce: "abc123",
      maxBytes: 1024,
      validate: (payload) => {
        if (typeof payload !== "object" || payload === null || !("ok" in payload)) return false;
        return payload.ok === true;
      },
    });

    expect(filterInternalFrameDelta("run-1", rejected)).toBe(rejected);
    expect(filterInternalFrameDelta("run-1", accepted)).toBe("");
    expect(ipc.recordAcceptedInternalFrame).not.toHaveBeenCalled();

    bindRunLifecycle("pending:run-1", "run-1", "session-1");
    await vi.waitFor(() =>
      expect(ipc.recordAcceptedInternalFrame).toHaveBeenCalledWith(
        "claude",
        "session-1",
        accepted,
        workspace.path,
      ),
    );
    expect(ipc.recordAcceptedInternalFrame).toHaveBeenCalledTimes(1);
  });

  it("releases an opening tag whose payload outgrew the capture budget", async () => {
    await startRun("run-1", "test.capture", { channel: "facts", nonce: "abc123", maxBytes: 8 });
    const open = "<CCGUI_INTERNAL_abc123>";

    // The tag alone is retained: this frame could still complete within budget.
    expect(filterInternalFrameDelta("run-1", `head${open}`)).toBe("head");
    // Payload that no longer fits the budget can never be accepted, so the host
    // releases it instead of buffering the rest of the turn behind one tag.
    const overflow = "x".repeat(64);
    expect(filterInternalFrameDelta("run-1", overflow)).toBe(`${open}${overflow}`);
    expect(flushInternalFrameDelta("run-1")).toBe("");
  });

  it("retries a frame identity the host failed to record", async () => {
    const accepted = '<CCGUI_INTERNAL_abc123>{"ok":true}</CCGUI_INTERNAL_abc123>';
    const record = vi.mocked(ipc.recordAcceptedInternalFrame);
    record.mockReset();
    record.mockRejectedValueOnce(new Error("db busy")).mockResolvedValue(undefined);
    vi.useFakeTimers();
    try {
      await startRun("run-1", "test.capture", { channel: "facts", nonce: "abc123", maxBytes: 1024 });
      bindRunLifecycle("pending:run-1", "run-1", "session-1");

      expect(filterInternalFrameDelta("run-1", accepted)).toBe("");
      await Promise.resolve();
      // A dropped identity silently unhides the frame in reloaded history, so
      // the failed record is retried instead of abandoned.
      await vi.advanceTimersByTimeAsync(1000);

      expect(record.mock.calls).toEqual([
        ["claude", "session-1", accepted, workspace.path],
        ["claude", "session-1", accepted, workspace.path],
      ]);
    } finally {
      vi.useRealTimers();
      record.mockReset();
      record.mockResolvedValue(undefined);
    }
  });
});

describe("assistant message snapshots", () => {
  function snapshotDeps() {
    const key = "claude/session-1";
    const state = {
      bySession: {
        [key]: {
          messages: [
            { seq: 1, role: "assistant", text: "prior delta", ts: null, live: true },
          ],
          turnStartedAt: null,
        },
      },
      openTabs: [],
      models: { claude: "claude-test" },
      efforts: {},
      streamingByKey: {},
      retryingByKey: {},
    };
    return {
      key,
      state,
      deps: {
        set: (update: (current: typeof state) => Partial<typeof state>) => {
          Object.assign(state, update(state));
        },
        get: () => state,
        drainQueue: vi.fn(),
        markUnseenIfBackground: vi.fn(),
        upsertSessionMeta: vi.fn(),
      },
    };
  }

  function snapshot(text: string) {
    return {
      runId: "run-1",
      sessionId: "session-1",
      engine: "claude",
      seq: 1,
      kind: "message" as const,
      data: { role: "assistant", text },
    };
  }

  it("accepts a short nonce, dispatches its complete frame, and hides it while settling live rows", async () => {
    const owned = vi.fn();
    const dispose = registerTurnHooks("test.capture", { onInternalMessage: owned });
    await begin("run-1", "n-1");
    const { state, deps } = snapshotDeps();

    handleEngineEvents(
      [snapshot('visible<CCGUI_INTERNAL_n-1>{"ok":true}</CCGUI_INTERNAL_n-1>tail')],
      deps as never,
    );
    await Promise.resolve();
    dispose();

    expect(state.bySession["claude/session-1"].messages).toEqual([
      expect.objectContaining({ text: "prior delta", live: false }),
      expect.objectContaining({ role: "assistant", text: "visibletail" }),
    ]);
    expect(owned).toHaveBeenCalledWith(
      expect.objectContaining({ nonce: "n-1", payload: { ok: true } }),
    );
  });

  it("keeps rejected and incomplete snapshot frames visible", async () => {
    await begin("run-1", "n-1");
    const { state, deps } = snapshotDeps();
    const rejected = "<CCGUI_INTERNAL_n-1>{bad}</CCGUI_INTERNAL_n-1>";
    const incomplete = '<CCGUI_INTERNAL_n-1>{"ok":';

    handleEngineEvents([snapshot(rejected), snapshot(incomplete)], deps as never);

    expect(state.bySession["claude/session-1"].messages.slice(1).map((row) => row.text))
      .toEqual([rejected, incomplete]);
  });
});

describe("binding a run that outran the send result", () => {
  beforeEach(() => {
    fixtureDisposers.push(registerTurnHooks("test.capture", {
      beforeTurn: () => ({ internalMessageCapture: { channel: "facts", nonce: "abc123", maxBytes: 1024 } }),
    }));
  });

  async function pending(placeholder: string, engine = "claude") {
    const collected = await collectBeforeTurnContributions({ runId: placeholder, turnId: "turn-1", engine, sessionId: null, workspace, occurredAt: "2026-09-17T00:00:00Z" });
    return registerPendingRunLifecycle(placeholder, {
      turnId: "turn-1",
      engine,
      sessionId: null,
      workspace,
      captures: collected.internalMessageCaptures,
    });
  }

  afterEach(() => {
    unregisterRunLifecycle("run-early");
    unregisterRunLifecycle("run-late");
    unregisterRunLifecycle("run-x");
    unregisterRunLifecycle("run-y");
    unregisterRunLifecycle("placeholder-1");
    unregisterRunLifecycle("placeholder-2");
    unregisterRunLifecycle("placeholder-a");
    unregisterRunLifecycle("placeholder-b");
  });

  it("rekeys a pre-registered lifecycle onto the send result's run id", async () => {
    await pending("placeholder-1");
    bindRunLifecycle("placeholder-1", "run-early", "sess-1");
    // The capture buffer moved with the lifecycle.
    expect(filterInternalFrameDelta("run-early", '<CCGUI_INTERNAL_abc123>{"ok":true}</CCGUI_INTERNAL_abc123>')).toBe("");
    // The store's later bind is a no-op.
    bindRunLifecycle("placeholder-1", "run-early");
    expect(filterInternalFrameDelta("run-early", "")).toBe("");
  });

  it("binds an event that arrives before the send result to the unique pending run", async () => {
    await pending("placeholder-2");
    handleEngineEvents(
      [{ runId: "run-late", sessionId: null, engine: "claude", seq: 1, kind: "delta", data: "" }],
      fakeDeps(),
    );

    // Bound to the real run id: its frame is now filtered and routed.
    expect(filterInternalFrameDelta("run-late", '<CCGUI_INTERNAL_abc123>{"ok":true}</CCGUI_INTERNAL_abc123>')).toBe("");
  });

  it("leaves an event unbound when two runs of the same engine are pending", async () => {
    await pending("placeholder-a");
    await pending("placeholder-b");
    const frame = '<CCGUI_INTERNAL_abc123>{"ok":true}</CCGUI_INTERNAL_abc123>';
    handleEngineEvents(
      [{ runId: "run-x", sessionId: null, engine: "claude", seq: 1, kind: "delta", data: "" }],
      fakeDeps(),
    );

    // No lifecycle under the real id, so the frame stays visible.
    expect(filterInternalFrameDelta("run-x", frame)).toBe(frame);
  });

  it("replays an ambiguous early event after its send result identifies the owner", async () => {
    const afterTurn = vi.fn();
    const dispose = registerTurnHooks("test.ambiguous-early", { afterTurn });
    const settleLaunch = await pending("placeholder-a");
    await pending("placeholder-b");
    const key = "new:claude:/tmp/workspace";
    const state = {
      bySession: {
        [key]: {
          messages: [],
          queue: [],
          streaming: true,
          interrupted: false,
          error: null,
          turnStartedAt: null,
          activeModel: null,
          activeEffort: null,
          usage: null,
          turnUsage: null,
          nextBefore: null,
          loading: false,
        },
      },
      openTabs: [{ engine: "claude", sessionId: null, workspacePath: workspace.path }],
      active: { engine: "claude", sessionId: null, workspacePath: workspace.path },
      models: {},
      efforts: {},
      streamingByKey: { [key]: true },
      retryingByKey: {},
    };
    const deps = {
      set: (update: (current: typeof state) => Partial<typeof state>) => Object.assign(state, update(state)),
      get: () => state,
      drainQueue: vi.fn(),
      markUnseenIfBackground: vi.fn(),
      upsertSessionMeta: vi.fn(),
    };
    handleEngineEvents(
      [{ runId: "run-x", sessionId: null, engine: "claude", seq: 1, kind: "done", data: { usage: null } }],
      deps as never,
    );
    expect(afterTurn).not.toHaveBeenCalled();

    bindRunLifecycle("placeholder-a", "run-x");
    settleLaunch();
    routeRun("run-x", key);
    replayBufferedEngineEvents("run-x", deps as never);
    await Promise.resolve();
    dispose();

    expect(afterTurn).toHaveBeenCalledTimes(1);
    expect(state.bySession[key].streaming).toBe(false);
  });

  it("drains the buffered prefix when ownership resolves before the send result", async () => {
    await pending("placeholder-a");
    await pending("placeholder-b");
    const key = "new:claude:/tmp/workspace";
    const state = {
      bySession: {
        [key]: {
          messages: [] as Array<{ role: string; text: string }>,
          queue: [],
          streaming: true,
          interrupted: false,
          error: null,
          turnStartedAt: null,
          activeModel: null,
          activeEffort: null,
          usage: null,
          turnUsage: null,
          nextBefore: null,
          loading: false,
        },
      },
      openTabs: [{ engine: "claude", sessionId: null, workspacePath: workspace.path }],
      active: { engine: "claude", sessionId: null, workspacePath: workspace.path },
      models: {},
      efforts: {},
      streamingByKey: { [key]: true },
      retryingByKey: {},
    };
    const deps = {
      set: (update: (current: typeof state) => Partial<typeof state>) =>
        Object.assign(state, update(state)),
      get: () => state,
      drainQueue: vi.fn(),
      markUnseenIfBackground: vi.fn(),
      upsertSessionMeta: vi.fn(),
    };
    const snapshot = (seq: number, text: string) => ({
      runId: "run-y",
      sessionId: null,
      engine: "claude",
      seq,
      kind: "message" as const,
      data: { role: "assistant", text },
    });

    // Two same-engine sends make the first snapshot ambiguous: it is buffered.
    handleEngineEvents([snapshot(1, "first")], deps as never);
    // The other send resolves, leaving exactly one owner candidate.
    bindRunLifecycle("placeholder-b", "run-late");
    // The next snapshot identifies the owner by itself and must not leapfrog
    // the buffered prefix.
    handleEngineEvents([snapshot(2, "second")], deps as never);
    // A terminal event settles the turn and cleans the run's lifecycle; the
    // buffered prefix must already be part of the transcript.
    handleEngineEvents(
      [{ runId: "run-y", sessionId: null, engine: "claude", seq: 3, kind: "done", data: { usage: null } }],
      deps as never,
    );
    await Promise.resolve();
    unregisterRunLifecycle("run-y");

    expect(state.bySession[key].messages.map((row) => row.text)).toEqual(["first", "second"]);
  });
});

describe("terminal turn lifecycle", () => {
  it("dispatches cancellation exactly once", async () => {
    const afterTurn = vi.fn();
    const dispose = registerTurnHooks("test.terminal", { afterTurn });
    await begin("run-1");

    finishRunLifecycle("run-1", "cancelled");
    finishRunLifecycle("run-1", "cancelled");
    await Promise.resolve();
    dispose();

    expect(afterTurn).toHaveBeenCalledTimes(1);
    expect(afterTurn).toHaveBeenCalledWith(expect.objectContaining({ status: "cancelled" }));
  });
});
