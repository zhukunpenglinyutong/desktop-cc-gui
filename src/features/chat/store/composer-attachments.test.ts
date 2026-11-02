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
    listPlanReviews: vi.fn(async () => []),
    archiveSession: vi.fn(async () => {}),
    listWorkspaces: vi.fn(async () => []),
    removeWorkspace: vi.fn(async () => {}),
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

const { useChatStore } = await import("../store");
const { ipc } = await import("@/lib/ipc");
const { NO_ATTACHMENT_MOVES, resolveAttachmentKey } = await import("./attachments");
const { handleEngineEvents } = await import("./engine-events");
type EngineEventDeps = import("./engine-events").EngineEventDeps;
const { sessionKey } = await import("./persistence");
const { EMPTY_SESSION, routeRun, runRouting } = await import("./stream");

const WS = "/tmp/ws";
const PENDING = sessionKey("claude", null, WS);
const NATIVE = sessionKey("claude", "s-1", WS);

let runId: string;
let runCounter = 0;

function deps(): EngineEventDeps {
  return {
    set: useChatStore.setState,
    get: useChatStore.getState,
    drainQueue: () => {},
    markUnseenIfBackground: () => {},
    upsertSessionMeta: () => {},
  };
}

function sessionEvent(): EngineEventPayload {
  return {
    runId,
    sessionId: "s-1",
    engine: "claude",
    seq: 1,
    kind: "session",
    data: "s-1",
  };
}

function attachments(paths: string[]) {
  return {
    images: paths,
    previews: Object.fromEntries(
      paths.map((p) => [p, { url: "data:image/png;base64,AA==", name: p }]),
    ),
    error: null,
  };
}

describe("composer attachments follow their session key", () => {
  beforeEach(() => {
    runId = `attachments-${++runCounter}`;
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
      composerAttachments: {},
      composerAttachmentMoves: NO_ATTACHMENT_MOVES,
    });
  });

  /** Where a picture whose save started at `since` under `key` lands now. */
  function landing(key: string, since: number) {
    return resolveAttachmentKey(
      useChatStore.getState().composerAttachmentMoves,
      key,
      since,
    );
  }

  it("carries a pending chat's pictures onto the adopted native key", () => {
    const tab = { engine: "claude", sessionId: null, workspacePath: WS };
    routeRun(runId, PENDING);
    useChatStore.setState({
      openTabs: [tab],
      active: tab,
      bySession: { [PENDING]: { ...EMPTY_SESSION, streaming: true } },
      streamingByKey: { [PENDING]: true },
      composerAttachments: { [PENDING]: attachments(["/sandbox/a.png"]) },
    });

    handleEngineEvents([sessionEvent()], deps());

    const state = useChatStore.getState();
    expect(state.composerAttachments[NATIVE]?.images).toEqual(["/sandbox/a.png"]);
    expect(state.composerAttachments[PENDING]).toBeUndefined();
  });

  it("carries the pictures when the picker retargets a pending chat", () => {
    const tab = { engine: "claude", sessionId: null, workspacePath: WS };
    useChatStore.setState({
      openTabs: [tab],
      active: tab,
      composerAttachments: { [PENDING]: attachments(["/sandbox/b.png"]) },
    });

    useChatStore.getState().setActiveEngine("codex");

    const target = sessionKey("codex", null, WS);
    const state = useChatStore.getState();
    expect(state.composerAttachments[target]?.images).toEqual(["/sandbox/b.png"]);
    expect(state.composerAttachments[PENDING]).toBeUndefined();
    expect(landing(PENDING, 0)).toBe(target);
  });

  it("forwards a picture still being saved when the pending chat adopts its id", () => {
    const tab = { engine: "claude", sessionId: null, workspacePath: WS };
    routeRun(runId, PENDING);
    useChatStore.setState({
      openTabs: [tab],
      active: tab,
      bySession: { [PENDING]: { ...EMPTY_SESSION, streaming: true } },
      streamingByKey: { [PENDING]: true },
    });
    const since = useChatStore.getState().composerAttachmentMoves.seq;

    handleEngineEvents([sessionEvent()], deps());

    expect(landing(PENDING, since)).toBe(NATIVE);
  });

  it("forwards it when the send receipt carries the id as well", async () => {
    useChatStore.getState().startNewChat(WS);
    const since = useChatStore.getState().composerAttachmentMoves.seq;
    vi.mocked(ipc.sendMessage).mockResolvedValueOnce({
      runId: "run-receipt",
      sessionId: "s-7",
    });

    await useChatStore.getState().send("hi", []);

    expect(useChatStore.getState().active?.sessionId).toBe("s-7");
    expect(landing(PENDING, since)).toBe(sessionKey("claude", "s-7", WS));
  });

  it("records the adoption once when the session event beats the send receipt", async () => {
    useChatStore.getState().startNewChat(WS);
    let reply: (value: { runId: string; sessionId: string }) => void = () => {};
    vi.mocked(ipc.sendMessage).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          reply = resolve;
        }),
    );
    const sending = useChatStore.getState().send("hi", []);
    await vi.waitFor(() => expect(ipc.sendMessage).toHaveBeenCalled());
    const requested = vi.mocked(ipc.sendMessage).mock.calls[0][0].runId as string;

    handleEngineEvents(
      [{ runId: requested, sessionId: "s-1", engine: "claude", seq: 1, kind: "session", data: "s-1" }],
      deps(),
    );
    // The next new chat in this workspace reuses the pending key; a picture
    // pasted there now must not be pulled into s-1 by the late receipt.
    const since = useChatStore.getState().composerAttachmentMoves.seq;
    reply({ runId: requested, sessionId: "s-1" });
    await sending;

    expect(landing(PENDING, since)).toBe(PENDING);
  });

  it("hands pictures pasted with no tab open to the first new chat", () => {
    useChatStore.setState({
      composerAttachments: { "": attachments(["/sandbox/u.png"]) },
    });

    useChatStore.getState().startNewChat(WS);

    const state = useChatStore.getState();
    expect(state.composerAttachments[PENDING]?.images).toEqual(["/sandbox/u.png"]);
    expect(state.composerAttachments[""]).toBeUndefined();
  });

  it("merges them into a new chat that already holds pictures", () => {
    useChatStore.setState({
      composerAttachments: {
        "": attachments(["/sandbox/u.png"]),
        [PENDING]: attachments(["/sandbox/p.png"]),
      },
    });

    useChatStore.getState().startNewChat(WS);

    expect(useChatStore.getState().composerAttachments[PENDING]?.images).toEqual([
      "/sandbox/p.png",
      "/sandbox/u.png",
    ]);
  });

  it("forwards a no-tab paste still being saved only into the chat it opened", () => {
    const since = useChatStore.getState().composerAttachmentMoves.seq;
    useChatStore.getState().startNewChat(WS);
    expect(landing("", since)).toBe(PENDING);

    // With a tab already on screen the no-tab composer was not showing, so
    // a later ⌘N must not pull anything out of the unbound key.
    const other = "/tmp/other";
    const later = useChatStore.getState().composerAttachmentMoves.seq;
    useChatStore.getState().startNewChat(other);
    expect(landing("", later)).toBe("");
  });

  it("drops a pending chat's pictures with its workspace, even without a draft", async () => {
    const tab = { engine: "claude", sessionId: null, workspacePath: WS };
    useChatStore.setState({
      openTabs: [tab],
      active: tab,
      workspaces: [{ id: "w1", path: WS } as never],
      composerAttachments: { [PENDING]: attachments(["/sandbox/x.png"]) },
    });

    await useChatStore.getState().removeWorkspace("w1");

    expect(useChatStore.getState().composerAttachments[PENDING]).toBeUndefined();
  });

  it("keeps each session's own pictures apart", () => {
    const tabA = { engine: "claude", sessionId: "s-1", workspacePath: WS };
    const tabB = { engine: "claude", sessionId: "s-2", workspacePath: WS };
    const keyB = sessionKey("claude", "s-2", WS);
    useChatStore.setState({
      openTabs: [tabA, tabB],
      active: tabA,
      composerAttachments: {
        [NATIVE]: attachments(["/sandbox/a.png"]),
        [keyB]: attachments(["/sandbox/b.png"]),
      },
    });

    // Switching the active tab must not move, merge or clear anything.
    useChatStore.getState().focusTab("claude", "s-2", WS);

    const state = useChatStore.getState();
    expect(state.active?.sessionId).toBe("s-2");
    expect(state.composerAttachments[NATIVE]?.images).toEqual(["/sandbox/a.png"]);
    expect(state.composerAttachments[keyB]?.images).toEqual(["/sandbox/b.png"]);
  });

  it("drops attachments when the session is archived", async () => {
    const tab = { engine: "claude", sessionId: "s-1", workspacePath: WS };
    useChatStore.setState({
      openTabs: [tab],
      active: tab,
      sessions: [],
      bySession: { [NATIVE]: { ...EMPTY_SESSION } },
      composerAttachments: { [NATIVE]: attachments(["/sandbox/a.png"]) },
    });
    await useChatStore.getState().archiveSession({
      engine: "claude",
      sessionId: "s-1",
      workspacePath: WS,
    } as never);

    expect(useChatStore.getState().composerAttachments[NATIVE]).toBeUndefined();
  });
});
