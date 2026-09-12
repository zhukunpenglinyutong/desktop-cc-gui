import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChatStore } from "./store";
import { handleEngineEvents, type EngineEventDeps } from "./store/engine-events";
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
function observed(kind: "delta" | "session" | "done", seq: number, data: unknown) {
  return { runId: "run-7", sessionId: "s-1", engine: "codex", seq, kind, data };
}

describe("a turn this client did not start", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    runRouting.clear();
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
});
