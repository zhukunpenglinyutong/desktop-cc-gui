import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChatStore } from "./store";
import { handleEngineEvents, settledRuns, type EngineEventDeps } from "./store/engine-events";
import { sessionKey } from "./store/persistence";
import { EMPTY_SESSION, runRouting } from "./store/stream";

vi.mock("@/lib/ipc", () => ({
  ipc: {
    rescanSessions: vi.fn(async () => {}),
    usageRecord: vi.fn(async () => {}),
  },
}));
vi.mock("@/lib/events", () => ({
  listenEngineEvents: vi.fn(async () => () => {}),
  listenSessionsChanged: vi.fn(async () => () => {}),
  listenComputerUseEscape: vi.fn(async () => () => {}),
}));

const KEY = sessionKey("codex", "s-1", "/tmp/ws");

function deps(): EngineEventDeps {
  return {
    set: useChatStore.setState,
    get: useChatStore.getState,
    drainQueue: () => {},
    markUnseenIfBackground: () => {},
    upsertSessionMeta: () => {},
  };
}

/** An event from a run this client never sent — the phone watching the
 *  desktop's turn, or the desktop watching the phone's. */
function observed(kind: "delta" | "session" | "done" | "error" | "usage" | "warn", seq: number, data: unknown) {
  return { runId: "run-7", sessionId: "s-1", engine: "codex", seq, kind, data };
}

describe("a turn this client did not start", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    runRouting.clear();
    settledRuns.clear();
    // Opened from history: no send happened here, so nothing is flagged and
    // no run routes to it.
    useChatStore.setState({
      openTabs: [],
      active: null,
      unseen: {},
      bySession: {
        [KEY]: {
          ...EMPTY_SESSION,
          messages: [{ seq: 1, role: "user", text: "run the tests", ts: null }],
        },
      },
      streamingByKey: {},
    });
  });

  it("reads as running once its events arrive", () => {
    expect(useChatStore.getState().bySession[KEY]!.streaming).toBe(false);

    handleEngineEvents([observed("delta", 2, "wo")], deps());

    // The composer turns into Stop and the sidebar dot lights up: both read
    // these two flags, and neither is written by the send path on this client.
    expect(useChatStore.getState().bySession[KEY]!.streaming).toBe(true);
    expect(useChatStore.getState().streamingByKey[KEY]).toBe(true);
    expect(useChatStore.getState().bySession[KEY]!.turnStartedAt).toBeTypeOf("number");
  });

  it("lights the sidebar dot for a session this client never opened", () => {
    useChatStore.setState({ bySession: {}, streamingByKey: {} });

    handleEngineEvents([observed("session", 1, "s-1")], deps());

    expect(useChatStore.getState().streamingByKey[KEY]).toBe(true);
  });

  it("routes the observed run, so Stop reaches it", () => {
    handleEngineEvents([observed("delta", 2, "wo")], deps());

    expect(runRouting.get("run-7")).toBe(KEY);
  });

  it("keeps the turn's own start time once running", () => {
    handleEngineEvents([observed("delta", 2, "wo")], deps());
    const started = useChatStore.getState().bySession[KEY]!.turnStartedAt;

    handleEngineEvents([observed("delta", 3, "rld")], deps());

    expect(useChatStore.getState().bySession[KEY]!.turnStartedAt).toBe(started);
  });

  it("settles when the run reports done", () => {
    handleEngineEvents([observed("delta", 2, "wo")], deps());

    handleEngineEvents([observed("done", 3, { usage: null })], deps());

    expect(useChatStore.getState().bySession[KEY]!.streaming).toBe(false);
    // Clearing drops the map entry rather than storing a false (see
    // setStreamingFlag): no dot, no key.
    expect(useChatStore.getState().streamingByKey[KEY]).toBeUndefined();
  });

  it.each(["done", "error"] as const)("does not revive a %s run when its final usage arrives", (kind) => {
    const d = { ...deps(), refreshSessionUsage: vi.fn(async () => {}) };
    handleEngineEvents([observed("delta", 1, "finished")], d);
    handleEngineEvents([observed(kind, 2, kind === "done" ? { usage: null } : "failed")], d);
    handleEngineEvents([
      observed("usage", 3, { input_tokens: 89400, output_tokens: 409 }),
      observed("warn", 4, "late process warning"),
    ], d);
    expect(useChatStore.getState().bySession[KEY]!.streaming).toBe(false);
    expect(useChatStore.getState().streamingByKey[KEY]).toBeUndefined();
    expect(runRouting.has("run-7")).toBe(false);
    expect(d.refreshSessionUsage).toHaveBeenCalledWith(KEY);
  });

  it("routes a task frame without letting it claim the turn", () => {
    // Session restored mid-turn: streaming, but no run owns it yet.
    useChatStore.setState({
      bySession: {
        [KEY]: {
          ...EMPTY_SESSION,
          streaming: true,
          currentRunId: null,
          messages: [{ seq: 1, role: "user", text: "go", ts: null }],
        },
      },
      streamingByKey: { [KEY]: true },
    });

    handleEngineEvents(
      [{ runId: "run-9", sessionId: "s-1", engine: "codex", seq: 2, kind: "task_started" as const,
        data: { taskId: "w1", taskType: "local_agent", description: "a" } }],
      deps(),
    );
    const mid = useChatStore.getState().bySession[KEY]!;
    // Task frames are panel state: routed, but no claim and no flag changes.
    expect(runRouting.get("run-9")).toBe(KEY);
    expect(mid.currentRunId).toBeNull();
    expect(mid.streaming).toBe(true);
    expect(mid.tasks).toHaveLength(1);

    // The run's first content frame is what claims the turn.
    handleEngineEvents(
      [{ runId: "run-9", sessionId: "s-1", engine: "codex", seq: 3, kind: "delta" as const, data: "正文" }],
      deps(),
    );
    expect(useChatStore.getState().bySession[KEY]!.currentRunId).toBe("run-9");
  });

  it("claims a streaming unclaimed session only on a content frame", () => {
    useChatStore.setState({
      bySession: {
        [KEY]: {
          ...EMPTY_SESSION,
          streaming: true,
          currentRunId: null,
          messages: [{ seq: 1, role: "user", text: "go", ts: null }],
        },
      },
      streamingByKey: { [KEY]: true },
    });

    // Bookkeeping frames (usage/model/...) route and apply, but only content
    // proves the run owns the reply — no claim yet.
    handleEngineEvents(
      [observed("usage", 2, { input_tokens: 100, output_tokens: 5 })],
      deps(),
    );
    expect(useChatStore.getState().bySession[KEY]!.currentRunId).toBeNull();
    expect(runRouting.get("run-7")).toBe(KEY);

    handleEngineEvents([observed("delta", 3, "正文")], deps());
    expect(useChatStore.getState().bySession[KEY]!.currentRunId).toBe("run-7");
  });

  it("does not light an idle session up for a bare task frame", () => {
    handleEngineEvents(
      [{ runId: "run-9", sessionId: "s-1", engine: "codex", seq: 2, kind: "tasks" as const,
        data: { tasks: [{ taskId: "w1", taskType: "local_agent", description: "a" }] } }],
      deps(),
    );
    const s = useChatStore.getState().bySession[KEY]!;
    expect(s.streaming).toBe(false);
    expect(s.currentRunId).toBeNull();
    expect(useChatStore.getState().streamingByKey[KEY]).toBeUndefined();
    // Still routed (Stop and the sweep reach it) and the row still lands.
    expect(runRouting.get("run-9")).toBe(KEY);
    expect(s.tasks).toHaveLength(1);
  });

  it("ignores an old completion after the next run has started", () => {
    handleEngineEvents([observed("done", 2, { usage: null })], deps());
    handleEngineEvents([{ ...observed("delta", 1, "next"), runId: "run-next" }], deps());
    handleEngineEvents([observed("done", 2, { usage: null })], deps());
    expect(useChatStore.getState().bySession[KEY]!.streaming).toBe(true);
    expect(runRouting.get("run-next")).toBe(KEY);
  });
});
