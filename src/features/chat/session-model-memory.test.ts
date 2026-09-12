import { beforeEach, describe, expect, it, vi } from "vitest";
import { ipc, type SessionMeta } from "@/lib/ipc";
import { useChatStore } from "./store";
import { handleEngineEvents, type EngineEventDeps } from "./store/engine-events";
import { sessionKey } from "./store/persistence";
import { EMPTY_SESSION, resolveSessionModel, runRouting } from "./store/stream";

vi.mock("@/lib/ipc", () => ({
  ipc: {
    sendMessage: vi.fn(async () => ({ runId: "run-1", sessionId: null })),
    loadSessionPage: vi.fn(async () => ({ messages: [], nextBefore: null })),
    rememberSessionModel: vi.fn(async () => {}),
    rescanSessions: vi.fn(async () => {}),
    usageRecord: vi.fn(async () => {}),
  },
}));
vi.mock("@/lib/events", () => ({
  listenEngineEvents: vi.fn(async () => () => {}),
  listenSessionsChanged: vi.fn(async () => () => {}),
}));

const WS = "S:\\AIWorker\\demo";
const SID = "01a08ac1-a5b3-4a3f-9a4a-1ac1a08ac1a5";
const KEY = sessionKey("omp", SID, WS);
/** What the picker itself sent: the provider is part of the id. */
const SENT = "agentrouter qunyou/deepseek-v4-flash";

function meta(model?: string): SessionMeta {
  return {
    engine: "omp",
    sessionId: SID,
    workspacePath: WS,
    filePath: "s.jsonl",
    fileSize: 1,
    fileMtimeMs: 1,
    title: "继续任务",
    preview: "",
    createdAt: 1,
    updatedAt: 2,
    messageCount: 2,
    pinned: false,
    customTitle: null,
    model: model ?? null,
  };
}

function deps(): EngineEventDeps {
  return {
    set: useChatStore.setState,
    get: useChatStore.getState,
    drainQueue: () => {},
    markUnseenIfBackground: () => {},
    upsertSessionMeta: () => {},
  };
}

describe("a session's provider and model memory", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    runRouting.clear();
    useChatStore.setState({
      openTabs: [],
      active: null,
      unseen: {},
      sessions: [],
      models: { omp: "千刀哥-cc/claude-opus-5" },
      bySession: {},
      streamingByKey: {},
    });
  });

  it("adopts the model we remembered when the session is opened", async () => {
    useChatStore.setState({ sessions: [meta(SENT)] });

    await useChatStore.getState().selectSession("omp", SID, WS);

    const session = useChatStore.getState().bySession[KEY]!;
    // The engine's transcript only carries the bare name; without this the
    // chip showed the engine default and the next send ran that instead.
    expect(session.activeModel).toBe(SENT);
  });

  it("falls back to the engine default for a session we never sent to", async () => {
    useChatStore.setState({ sessions: [meta()] });

    await useChatStore.getState().selectSession("omp", SID, WS);

    expect(useChatStore.getState().bySession[KEY]!.activeModel ?? null).toBeNull();
  });

  it("remembers the resolved model on a send into an existing session", async () => {
    const tab = { engine: "omp", sessionId: SID, workspacePath: WS };
    useChatStore.setState({
      sessions: [meta(SENT)],
      active: tab,
      openTabs: [tab],
      bySession: { [KEY]: { ...EMPTY_SESSION, activeModel: SENT } },
    });

    await useChatStore.getState().send("继续", []);

    expect(vi.mocked(ipc.rememberSessionModel)).toHaveBeenCalledWith("omp", SID, SENT);
    expect(resolveSessionModel(tab, useChatStore.getState().bySession[KEY], "default/x")).toBe(SENT);
  });

  it("remembers a brand-new session's model once the engine names it", async () => {
    const tab = { engine: "omp", sessionId: null, workspacePath: WS };
    useChatStore.setState({ active: tab, openTabs: [tab] });

    await useChatStore.getState().send("继续", []);
    // No id yet: nothing to file the model under.
    expect(vi.mocked(ipc.rememberSessionModel)).not.toHaveBeenCalled();

    handleEngineEvents(
      [{ runId: "run-1", sessionId: null, engine: "omp", seq: 1, kind: "session", data: SID }],
      deps(),
    );

    expect(vi.mocked(ipc.rememberSessionModel)).toHaveBeenCalledWith(
      "omp",
      SID,
      useChatStore.getState().models.omp,
    );
  });

  it("keeps the qualified model when the engine reports the bare name", () => {
    useChatStore.setState({
      bySession: { [KEY]: { ...EMPTY_SESSION, activeModel: SENT } },
    });

    handleEngineEvents(
      [{ runId: "run-2", sessionId: SID, engine: "omp", seq: 1, kind: "model", data: "deepseek-v4-flash" }],
      deps(),
    );
    expect(useChatStore.getState().bySession[KEY]!.activeModel).toBe(SENT);

    // A genuinely different model still lands.
    handleEngineEvents(
      [{ runId: "run-2", sessionId: SID, engine: "omp", seq: 2, kind: "model", data: "glm-5.3" }],
      deps(),
    );
    expect(useChatStore.getState().bySession[KEY]!.activeModel).toBe("glm-5.3");
  });
});
