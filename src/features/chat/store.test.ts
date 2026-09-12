import { beforeEach, describe, expect, it, vi } from "vitest";
import { ipc } from "@/lib/ipc";
import { useChatStore } from "./store";
import { OPEN_TABS_KEY } from "./store/persistence";
import { EMPTY_SESSION } from "./store/stream";

vi.mock("@/lib/ipc", () => ({
  ipc: {
    sendMessage: vi.fn(async () => ({ runId: "run-1", sessionId: null })),
    interruptSession: vi.fn(async () => true),
    rememberSessionModel: vi.fn(async () => {}),
    loadSessionPage: vi.fn(async () => ({ messages: [], nextBefore: null })),
    getAppSettings: vi.fn(async () => ({})),
    updateAppSettings: vi.fn(async () => {}),
    rescanSessions: vi.fn(async () => {}),
  },
}));
vi.mock("@/lib/events", () => ({
  listenEngineEvents: vi.fn(async () => () => {}),
  listenSessionsChanged: vi.fn(async () => () => {}),
}));

const WS = "/tmp/ws";

function resetStore() {
  localStorage.clear();
  vi.mocked(ipc.sendMessage).mockClear();
  vi.mocked(ipc.interruptSession).mockClear();
  useChatStore.setState({
    openTabs: [],
    active: null,
    activeEngine: "claude",
    models: { omp: "kimi-k3" },
    efforts: {},
    bySession: {},
    streamingByKey: {},
    unseen: {},
    drafts: {},
  });
}

describe("per-session composer selection", () => {
  beforeEach(resetStore);

  it("switching to an existing session retargets the picker to its engine", async () => {
    useChatStore.setState({ activeEngine: "omp" });
    await useChatStore.getState().selectSession("claude", "s-1", WS);
    expect(useChatStore.getState().activeEngine).toBe("claude");
  });

  it("setModel/setEffort stamp the active tab and persist with it", async () => {
    useChatStore.setState({ activeEngine: "omp" });
    useChatStore.getState().startNewChat(WS); // pending omp tab
    await useChatStore.getState().setModel("omp", "fufei/kimi-k3");
    await useChatStore.getState().setEffort("omp", "max");

    const s = useChatStore.getState();
    expect(s.active?.model).toBe("fufei/kimi-k3");
    expect(s.active?.effort).toBe("max");
    // Overrides persist with the tab list (survive restart).
    const persisted = JSON.parse(localStorage.getItem(OPEN_TABS_KEY) ?? "[]");
    expect(persisted[0]).toMatchObject({
      model: "fufei/kimi-k3",
      effort: "max",
    });
  });

  it("re-selecting a session keeps its stamped overrides", async () => {
    useChatStore.setState({ activeEngine: "omp" });
    useChatStore.getState().startNewChat(WS);
    await useChatStore.getState().setModel("omp", "fufei/kimi-k3");
    // Simulate the tab gaining a native session id after the first turn.
    const stamped = { ...useChatStore.getState().active!, sessionId: "s-9" };
    useChatStore.setState({ openTabs: [stamped], active: null });

    await useChatStore.getState().selectSession("omp", "s-9", WS);
    expect(useChatStore.getState().active).toMatchObject({
      model: "fufei/kimi-k3",
    });
  });

  it("send uses the tab override over the engine default", async () => {
    useChatStore.setState({ activeEngine: "omp", models: { omp: "kimi-k3" } });
    useChatStore.getState().startNewChat(WS);
    await useChatStore.getState().setModel("omp", "fufei/kimi-k3");
    await useChatStore.getState().setEffort("omp", "low");

    await useChatStore.getState().send("hi", []);
    expect(vi.mocked(ipc.sendMessage)).toHaveBeenCalledWith(
      expect.objectContaining({
        engine: "omp",
        model: "fufei/kimi-k3",
        effort: "low",
      }),
    );
  });

  it("a tab without overrides sends with the engine default", async () => {
    useChatStore.setState({ activeEngine: "omp", models: { omp: "kimi-k3" } });
    useChatStore.getState().startNewChat(WS);

    await useChatStore.getState().send("hi", []);
    expect(vi.mocked(ipc.sendMessage)).toHaveBeenCalledWith(
      expect.objectContaining({ model: "kimi-k3", effort: null }),
    );
  });

  it("retargeting a pending tab to another engine drops the old overrides", async () => {
    useChatStore.setState({ activeEngine: "omp" });
    useChatStore.getState().startNewChat(WS);
    await useChatStore.getState().setModel("omp", "fufei/kimi-k3");
    await useChatStore.getState().setEffort("omp", "max");

    useChatStore.getState().setActiveEngine("claude");
    const s = useChatStore.getState();
    expect(s.active?.engine).toBe("claude");
    expect(s.active?.model).toBeUndefined();
    expect(s.active?.effort).toBeUndefined();
  });
});

describe("stop during an in-flight send", () => {
  beforeEach(resetStore);

  it("kills the run when Stop is pressed before sendMessage resolves", async () => {
    // Existing resumed session: the tab already carries a native id, so the
    // send takes the run-routing branch (no id adoption).
    const tab = { engine: "omp", sessionId: "sess-42", workspacePath: WS };
    useChatStore.setState({ activeEngine: "omp", openTabs: [tab], active: tab });

    // Hold sendMessage open so Stop lands while the invoke is still pending —
    // exactly the window where runRouting has no entry for this run yet.
    const { promise, resolve: resolveSend } = Promise.withResolvers<{
      runId: string;
      sessionId: string | null;
    }>();
    vi.mocked(ipc.sendMessage).mockReturnValueOnce(promise);

    const sending = useChatStore.getState().send("hello", []);
    // User presses Stop mid-flight.
    await useChatStore.getState().interrupt();
    expect(useChatStore.getState().bySession["omp/sess-42"]?.interrupted).toBe(
      true,
    );
    // The stop could not have killed anything yet: no run id existed.
    expect(vi.mocked(ipc.interruptSession)).not.toHaveBeenCalledWith("run-9");

    resolveSend({ runId: "run-9", sessionId: null });
    await sending;

    // sendPrompt saw the interrupted flag once the ids materialized and
    // killed the run that Stop could not reach.
    expect(vi.mocked(ipc.interruptSession)).toHaveBeenCalledWith("run-9");
  });
});

describe("compactContext and refreshSessionUsage", () => {
  beforeEach(resetStore);

  it("refreshSessionUsage updates session usage from session history", async () => {
    const tab = { engine: "claude", sessionId: "sess-compact", workspacePath: WS };
    const key = "claude/sess-compact";
    useChatStore.setState({
      activeEngine: "claude",
      openTabs: [tab],
      active: tab,
      bySession: {
        [key]: {
          messages: [],
          queue: [],
          error: null,
          streaming: false,
          turnStartedAt: null,
          usage: null,
          turnUsage: null,
          interrupted: false,
          activeModel: null,
          activeEffort: null,
          nextBefore: null,
          loading: false,
        },
      },
    });

    const mockUsage = { inputTokens: 1200, outputTokens: 300, totalTokens: 1500 };
    vi.mocked(ipc.loadSessionPage).mockResolvedValueOnce({
      messages: [
        {
          seq: 1,
          role: "assistant",
          text: "hello",
          ts: "2026-09-10T12:00:00Z",
          usage: mockUsage,
        },
      ] as any,
      nextBefore: null,
    });

    await useChatStore.getState().refreshSessionUsage(key);

    expect(ipc.loadSessionPage).toHaveBeenCalledWith("claude", "sess-compact", 100);
    expect(useChatStore.getState().bySession[key]?.usage).toEqual(mockUsage);
  });

  it("compactContext sends /compact and invokes refreshSessionUsage after compaction finishes", async () => {
    const tab = { engine: "claude", sessionId: "sess-compact", workspacePath: WS };
    const key = "claude/sess-compact";
    useChatStore.setState({
      activeEngine: "claude",
      openTabs: [tab],
      active: tab,
      bySession: {
        [key]: {
          messages: [],
          queue: [],
          error: null,
          streaming: false,
          turnStartedAt: null,
          usage: { inputTokens: 50000, outputTokens: 5000 },
          turnUsage: null,
          interrupted: false,
          activeModel: null,
          activeEffort: null,
          nextBefore: null,
          loading: false,
        },
      },
      streamingByKey: {},
    });

    const newUsage = { inputTokens: 10000, outputTokens: 1000 };
    vi.mocked(ipc.loadSessionPage).mockResolvedValueOnce({
      messages: [
        {
          seq: 2,
          role: "assistant",
          text: "compacted",
          ts: "2026-09-10T12:00:00Z",
          usage: newUsage,
        },
      ] as any,
      nextBefore: null,
    });

    const compactPromise = useChatStore.getState().compactContext(key);

    // Verify /compact message was sent
    expect(ipc.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "/compact" }),
    );

    // Simulate completion by clearing streamingByKey
    useChatStore.setState({
      streamingByKey: {},
      bySession: {
        ...useChatStore.getState().bySession,
        [key]: {
          ...useChatStore.getState().bySession[key]!,
          streaming: false,
        },
      },
    });

    await compactPromise;

    expect(ipc.loadSessionPage).toHaveBeenCalledWith("claude", "sess-compact", 100);
    expect(useChatStore.getState().bySession[key]?.usage).toEqual(newUsage);
  });
});

describe("model selection is per session", () => {
  beforeEach(resetStore);

  const sess = (id: string) => ({
    engine: "omp",
    sessionId: id,
    workspacePath: WS,
  });

  it("picking a model inside a session leaves the engine default alone", async () => {
    // Two sessions of the SAME CLI: the complaint is that choosing a model in
    // one changed the other, because the pick was written as the engine-wide
    // default.
    const a = sess("s-a");
    const b = sess("s-b");
    useChatStore.setState({ activeEngine: "omp", openTabs: [a, b], active: a });

    await useChatStore.getState().setModel("omp", "deepseek-v4-flash");

    expect(useChatStore.getState().models.omp).toBe("kimi-k3");
    const tabA = useChatStore.getState().openTabs.find((t) => t.sessionId === "s-a");
    const tabB = useChatStore.getState().openTabs.find((t) => t.sessionId === "s-b");
    expect(tabA?.model).toBe("deepseek-v4-flash");
    expect(tabB?.model).toBeUndefined();
  });

  it("a pending new chat still edits the engine default", async () => {
    // The starting choice for future conversations is made on a new-chat tab.
    useChatStore.setState({ activeEngine: "omp", openTabs: [], active: null });
    useChatStore.getState().startNewChat(WS);
    await useChatStore.getState().setModel("omp", "glm-5.3-flash");

    expect(useChatStore.getState().models.omp).toBe("glm-5.3-flash");
    // and the pending tab carries it too
    expect(useChatStore.getState().active?.model).toBe("glm-5.3-flash");
  });

  it("continues a session on the model that session actually ran", async () => {
    const a = sess("s-a");
    useChatStore.setState({
      activeEngine: "omp",
      openTabs: [a],
      active: a,
      models: { omp: "kimi-k3" },
      bySession: {
        "omp/s-a": {
          ...EMPTY_SESSION,
          messages: [
            { seq: 1, role: "assistant", text: "hi", ts: null, model: "glm-5.3-flash" },
          ],
        },
      },
    });

    await useChatStore.getState().send("next", []);

    // Not the engine default: the conversation keeps its own model.
    expect(vi.mocked(ipc.sendMessage)).toHaveBeenCalledWith(
      expect.objectContaining({ model: "glm-5.3-flash" }),
    );
  });

  it("prefers the session's reported model over its history", async () => {
    const a = sess("s-a");
    useChatStore.setState({
      activeEngine: "omp",
      openTabs: [a],
      active: a,
      models: { omp: "kimi-k3" },
      bySession: {
        "omp/s-a": {
          ...EMPTY_SESSION,
          activeModel: "gpt-5.6-luna",
          messages: [
            { seq: 1, role: "assistant", text: "hi", ts: null, model: "glm-5.3-flash" },
          ],
        },
      },
    });

    await useChatStore.getState().send("next", []);
    expect(vi.mocked(ipc.sendMessage)).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-5.6-luna" }),
    );
  });

  it("an explicit per-session pick wins over the reported model", async () => {
    const a = sess("s-a");
    useChatStore.setState({
      activeEngine: "omp",
      openTabs: [{ ...a, model: "claude-opus-5" }],
      active: { ...a, model: "claude-opus-5" },
      models: { omp: "kimi-k3" },
      bySession: {
        "omp/s-a": { ...EMPTY_SESSION, activeModel: "gpt-5.6-luna" },
      },
    });

    await useChatStore.getState().send("next", []);
    expect(vi.mocked(ipc.sendMessage)).toHaveBeenCalledWith(
      expect.objectContaining({ model: "claude-opus-5" }),
    );
  });
});
