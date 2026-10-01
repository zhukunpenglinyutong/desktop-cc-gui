import { beforeEach, describe, expect, it, vi } from "vitest";
import { ipc, type SessionMeta } from "@/lib/ipc";
import { useChatStore } from "./store";
import { handleEngineEvents, type EngineEventDeps } from "./store/engine-events";
import { sessionKey } from "./store/persistence";
import { EMPTY_SESSION, resolveSessionModel, resolveSessionEffort, runRouting } from "./store/stream";

vi.mock("@/lib/ipc", () => ({
  ipc: {
    sendMessage: vi.fn(async () => ({ runId: "run-1", sessionId: null })),
    loadSessionPage: vi.fn(async () => ({ messages: [], nextBefore: null, subagentHistory: [] })),
    rememberSessionModel: vi.fn(async () => {}),
    rememberSessionEffort: vi.fn(async () => {}),
    listSessions: vi.fn(async () => []),
    listArchivedSessions: vi.fn(async () => []),
    listPlanReviews: vi.fn(async () => []),
    rescanSessions: vi.fn(async () => {}),
    usageRecord: vi.fn(async () => {}),
  },
}));
vi.mock("@/lib/events", () => ({
  listenEngineEvents: vi.fn(async () => () => {}),
  listenSessionsChanged: vi.fn(async () => () => {}),
  listenComputerUseEscape: vi.fn(async () => () => {}),
}));

const WS = "S:\\AIWorker\\demo";
const SID = "01a08ac1-a5b3-4a3f-9a4a-1ac1a08ac1a5";
const KEY = sessionKey("omp", SID, WS);
/** What the picker itself sent: the provider is part of the id. */
const SENT = "agentrouter qunyou/deepseek-v4-flash";

function meta(model?: string, effort?: string): SessionMeta {
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
    effort: effort ?? null,
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

  it("tracks the effort the run actually reports, ignoring blanks and repeats", () => {
    useChatStore.setState({
      bySession: { [KEY]: { ...EMPTY_SESSION, activeEffort: "medium" } },
    });

    // The engine's own report wins over the launch-time value.
    handleEngineEvents(
      [{ runId: "run-2", sessionId: SID, engine: "omp", seq: 1, kind: "effort", data: "high" }],
      deps(),
    );
    expect(useChatStore.getState().bySession[KEY]!.activeEffort).toBe("high");

    // A repeat of the same level is a no-op: the store object is untouched.
    const before = useChatStore.getState().bySession;
    handleEngineEvents(
      [{ runId: "run-2", sessionId: SID, engine: "omp", seq: 2, kind: "effort", data: "high" }],
      deps(),
    );
    expect(useChatStore.getState().bySession).toBe(before);

    // Blank payloads never clear the known level.
    handleEngineEvents(
      [{ runId: "run-2", sessionId: SID, engine: "omp", seq: 3, kind: "effort", data: "  " }],
      deps(),
    );
    expect(useChatStore.getState().bySession[KEY]!.activeEffort).toBe("high");
  });

  it("adopts the reasoning level this session ran when it is opened", async () => {
    useChatStore.setState({ sessions: [meta(SENT, "xhigh")] });

    await useChatStore.getState().selectSession("omp", SID, WS);

    // The reported gap: reopening showed (and sent) the engine default.
    expect(useChatStore.getState().bySession[KEY]!.activeEffort).toBe("xhigh");
  });

  it("sends the session's level, not the engine default, and remembers it", async () => {
    const tab = { engine: "omp", sessionId: SID, workspacePath: WS };
    useChatStore.setState({
      active: tab,
      openTabs: [tab],
      bySession: { [KEY]: { ...EMPTY_SESSION, activeEffort: "xhigh" } },
      efforts: { omp: "medium" },
    });

    await useChatStore.getState().send("继续", []);

    expect(vi.mocked(ipc.sendMessage)).toHaveBeenCalledWith(
      expect.objectContaining({ effort: "xhigh" }),
    );
    expect(vi.mocked(ipc.rememberSessionEffort)).toHaveBeenCalledWith("omp", SID, "xhigh");
    expect(
      resolveSessionEffort(tab, useChatStore.getState().bySession[KEY], "medium"),
    ).toBe("xhigh");
  });

  it("uses a refreshed session effort after another client changes it", async () => {
    const tab = { engine: "omp", sessionId: SID, workspacePath: WS };
    useChatStore.setState({
      active: tab,
      openTabs: [tab],
      sessions: [meta(SENT, "xhigh")],
      engines: [],
      bySession: { [KEY]: { ...EMPTY_SESSION, activeEffort: "xhigh" } },
      efforts: { omp: "medium" },
    });
    vi.mocked(ipc.listSessions).mockResolvedValueOnce([meta(SENT, "low")]);

    await useChatStore.getState().refreshSessions();
    await useChatStore.getState().send("继续", []);

    expect(vi.mocked(ipc.sendMessage)).toHaveBeenCalledWith(
      expect.objectContaining({ effort: "low" }),
    );
  });

  it("keeps a running Claude model when session refresh returns its saved alias", async () => {
    const tab = { engine: "claude", sessionId: SID, workspacePath: WS, model: "haiku" };
    const key = sessionKey(tab.engine, SID, WS);
    const model = "gpt-6-astra-cc-format[1m]";
    useChatStore.setState({
      active: tab,
      openTabs: [tab],
      engines: [],
      bySession: { [key]: { ...EMPTY_SESSION, activeModel: model, streaming: true } },
    });
    vi.mocked(ipc.listSessions).mockResolvedValueOnce([{ ...meta("haiku"), engine: "claude" }]);

    await useChatStore.getState().refreshSessions();

    expect(useChatStore.getState().bySession[key]!.activeModel).toBe(model);
    expect(useChatStore.getState().openTabs[0].model).toBe("haiku");
  });

  it("falls back to the engine default when the session never recorded a level", async () => {
    const tab = { engine: "omp", sessionId: SID, workspacePath: WS };
    useChatStore.setState({
      active: tab,
      openTabs: [tab],
      bySession: { [KEY]: { ...EMPTY_SESSION } },
      efforts: { omp: "medium" },
    });

    await useChatStore.getState().send("继续", []);

    expect(vi.mocked(ipc.sendMessage)).toHaveBeenCalledWith(
      expect.objectContaining({ effort: "medium" }),
    );
  });

  it("files a brand-new session's level once the engine names it", async () => {
    const tab = { engine: "omp", sessionId: null, workspacePath: WS, effort: "high" as const };
    useChatStore.setState({ active: tab, openTabs: [tab], efforts: {} });

    await useChatStore.getState().send("继续", []);
    // No id yet: nothing to file the level under.
    expect(vi.mocked(ipc.rememberSessionEffort)).not.toHaveBeenCalled();

    handleEngineEvents(
      [{ runId: "run-1", sessionId: null, engine: "omp", seq: 1, kind: "session", data: SID }],
      deps(),
    );

    expect(vi.mocked(ipc.rememberSessionEffort)).toHaveBeenCalledWith("omp", SID, "high");
  });
});
