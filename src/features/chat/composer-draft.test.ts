import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineEventPayload } from "@/lib/events";

vi.mock("@/lib/ipc", () => ({
  ipc: {
    sendMessage: vi.fn(async () => ({ runId: "r", sessionId: null })),
    interruptSession: vi.fn(async () => true),
    loadSessionPage: vi.fn(async () => ({ messages: [], nextBefore: null })),
    getAppSettings: vi.fn(async () => ({})),
    updateAppSettings: vi.fn(async () => {}),
    rescanSessions: vi.fn(async () => {}),
  },
}));
vi.mock("@/lib/events", () => ({
  listenEngineEvents: vi.fn(async () => () => {}),
  listenSessionsChanged: vi.fn(async () => () => {}),
  listenComputerUseEscape: vi.fn(async () => () => {}),
}));

// Node ships a built-in `localStorage` that stays undefined unless the process
// was started with --localstorage-file, and it shadows the jsdom one. The store
// reads localStorage at import time, so shim it when it is missing.
if (!globalThis.localStorage) {
  const memory = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => void memory.set(k, String(v)),
      removeItem: (k: string) => void memory.delete(k),
      clear: () => memory.clear(),
    },
  });
}

const { ipc } = await import("@/lib/ipc");
const { useChatStore } = await import("./store");
const { handleEngineEvents } = await import("./store/engine-events");
type EngineEventDeps = import("./store/engine-events").EngineEventDeps;
const { sessionKey } = await import("./store/persistence");
const { EMPTY_SESSION, runRouting, routeRun } = await import("./store/stream");

const WS = "/tmp/ws";
const PENDING = sessionKey("claude", null, WS);
const NATIVE = sessionKey("claude", "s-1", WS);

let runCounter = 0;
let runId: string;

function deps(): EngineEventDeps {
  return {
    set: useChatStore.setState,
    get: useChatStore.getState,
    drainQueue: () => {},
    markUnseenIfBackground: () => {},
    upsertSessionMeta: () => {},
  };
}

function ev(seq: number, sessionId: string | null = "s-1"): EngineEventPayload {
  return { runId, sessionId, engine: "claude", seq, kind: "session", data: "s-1" };
}

function resetStore() {
  runId = `composer-draft-${++runCounter}`;
  localStorage.clear();
  vi.clearAllMocks();
  runRouting.clear();
  useChatStore.setState({
    openTabs: [],
    active: null,
    activeEngine: "claude",
    models: {},
    efforts: {},
    bySession: {},
    streamingByKey: {},
    unseen: {},
    drafts: {},
  });
}

describe("composer draft survives engine events", () => {
  beforeEach(resetStore);

  it("keeps the text typed for the next turn when a running turn re-announces its session id", () => {
    // Existing session, turn in flight: the user is already typing the next
    // message while the CLI's `system/init` announcement is still on its way.
    const tab = { engine: "claude", sessionId: "s-1", workspacePath: WS };
    routeRun(runId, NATIVE);
    useChatStore.setState({
      openTabs: [tab],
      active: tab,
      bySession: { [NATIVE]: { ...EMPTY_SESSION, streaming: true } },
      streamingByKey: { [NATIVE]: true },
      drafts: { [NATIVE]: "下一条消息还没发" },
    });

    handleEngineEvents([ev(1)], deps());

    expect(useChatStore.getState().drafts[NATIVE]).toBe("下一条消息还没发");
  });

  it("does not merge an unrelated stale pending chat into the running session", () => {
    const tab = { engine: "claude", sessionId: "s-1", workspacePath: WS };
    routeRun(runId, NATIVE);
    useChatStore.setState({
      openTabs: [tab],
      active: tab,
      bySession: {
        // An aborted new chat in the same workspace that never adopted an id.
        [PENDING]: {
          ...EMPTY_SESSION,
          messages: [{ role: "user", text: "aborted", ts: "t", seq: 1 }],
          interrupted: true,
        },
        [NATIVE]: {
          ...EMPTY_SESSION,
          messages: [{ role: "user", text: "hello", ts: "t", seq: 1 }],
          streaming: true,
        },
      },
      streamingByKey: { [NATIVE]: true },
      drafts: { [PENDING]: "stale", [NATIVE]: "current" },
    });

    handleEngineEvents([ev(1)], deps());

    const state = useChatStore.getState();
    expect(state.bySession[NATIVE]?.messages.map((m) => m.text)).toEqual(["hello"]);
    expect(state.drafts[NATIVE]).toBe("current");
  });

  it("keeps text typed while a preassigned session id is being adopted", async () => {
    useChatStore.getState().startNewChat(WS);
    const response = Promise.withResolvers<{ runId: string; sessionId: string }>();
    vi.mocked(ipc.sendMessage).mockReturnValueOnce(response.promise);
    const sending = useChatStore.getState().send("hello", []);
    await vi.waitFor(() => expect(ipc.sendMessage).toHaveBeenCalledTimes(1));
    const runId = vi.mocked(ipc.sendMessage).mock.calls.at(-1)![0].runId!;
    // The user starts typing the next message while the CLI is still starting.
    useChatStore.getState().setDraft(PENDING, "next");
    response.resolve({ runId, sessionId: "s-1" });
    await sending;
    expect(useChatStore.getState().drafts[NATIVE]).toBe("next");
  });

  it("carries a pending-chat draft onto the adopted native key", () => {
    // Brand-new chat: the draft typed before the first send must follow the
    // session to its native key instead of being stranded on `new:`.
    const tab = { engine: "claude", sessionId: null, workspacePath: WS };
    routeRun(runId, PENDING);
    useChatStore.setState({
      openTabs: [tab],
      active: tab,
      bySession: { [PENDING]: { ...EMPTY_SESSION, streaming: true } },
      streamingByKey: { [PENDING]: true },
      drafts: { [PENDING]: "草稿" },
    });

    handleEngineEvents([ev(1)], deps());

    const state = useChatStore.getState();
    expect(state.drafts[NATIVE]).toBe("草稿");
    expect(state.drafts[PENDING]).toBeUndefined();
  });
});
