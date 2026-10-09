import { beforeEach, describe, expect, it, vi } from "vitest";
import { ipc, type SessionMeta } from "@/lib/ipc";
import {
  pluginBus,
  resetPluginBusForTests,
  SESSION_ACTIVATED_TOPIC,
} from "@/features/plugins/runtime/events";
import { setPluginSessionEffort, useChatStore } from "./store";
import { OPEN_TABS_KEY } from "./store/persistence";
import { EMPTY_SESSION, flushPendingStreams, routeRun, runRouting, untrackRun } from "./store/stream";
import { handleEngineEvents, settledRuns, type ChatEngineEvent, type EngineEventDeps } from "./store/engine-events";
import { registerSessionHooks, registerTurnHooks } from "@/features/plugins/runtime/hooks";
import { getConversationModeState } from "@/features/plugins/conversation/state";
import { getAutoCompactSettings, setAutoCompactEnabled, setAutoCompactThreshold } from "./auto-compact-context";
import { rememberContextWindow } from "./context-window-memory";

vi.mock("@/lib/ipc", () => ({
  ipc: {
    sendMessage: vi.fn(async () => ({ runId: "run-1", sessionId: null })),
    interruptSession: vi.fn(async () => true),
    compactActiveRun: vi.fn(async () => {}),
    rememberSessionModel: vi.fn(async () => {}),
    listEngineModels: vi.fn(async () => ({ models: [], authoritative: false })),
    rememberSessionEffort: vi.fn(async () => {}),
    listSessions: vi.fn(async () => []),
    listArchivedSessions: vi.fn(async () => []),
    listPlanReviews: vi.fn(async () => []),
    archiveSession: vi.fn(async () => {}),
    restoreSession: vi.fn(async () => {}),
    loadSessionPage: vi.fn(async () => ({ messages: [], nextBefore: null, subagentHistory: [] })),
    loadRemoteSessionPage: vi.fn(async () => ({ messages: [], nextBefore: null, subagentHistory: [] })),
    deleteSession: vi.fn(async () => {}),
    deleteRemoteSession: vi.fn(async () => {}),
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

const WS = "/tmp/ws";

function resetStore() {
  localStorage.clear();
  window.dispatchEvent(new Event("storage"));
  settledRuns.clear();
  vi.mocked(ipc.listEngineModels).mockReset().mockResolvedValue({ models: [], authoritative: false });
  resetPluginBusForTests();
  vi.mocked(ipc.sendMessage).mockClear();
  vi.mocked(ipc.compactActiveRun).mockClear();
  for (const runId of [...runRouting.keys()]) {
    runRouting.delete(runId);
    untrackRun(runId);
  }
  vi.mocked(ipc.interruptSession).mockClear();
  vi.mocked(ipc.archiveSession).mockClear();
  vi.mocked(ipc.listArchivedSessions).mockResolvedValue([]);
  useChatStore.setState({
    openTabs: [],
    active: null,
    activeEngine: "claude",
    models: { omp: "kimi-k3" },
    efforts: {},
    archivedSessionKeys: {},
    bySession: {},
    streamingByKey: {},
    retryingByKey: {},
    unseen: {},
    drafts: {},
    restoredSessionKeys: {},
    createdSessionKeys: {},
    sessionContributions: {},
    pendingRuntimeSwitch: null,
  });
}

function engineDeps(): EngineEventDeps {
  return {
    set: (fn) => useChatStore.setState(fn),
    get: () => useChatStore.getState(),
    drainQueue: () => {},
    markUnseenIfBackground: () => {},
    upsertSessionMeta: () => {},
  };
}

describe("native assistant message boundaries", () => {
  beforeEach(resetStore);

  const tab = { engine: "omp", sessionId: "message-boundaries", workspacePath: WS };
  const key = "omp/message-boundaries";
  const runId = "run-message-boundaries";
  const history = [
    { seq: 1, role: "user", text: "压缩后继续任务", ts: null },
    { seq: 2, role: "assistant", text: "准备完成。", ts: null },
    { seq: 3, role: "tool", text: "读取资料", ts: null },
  ];

  function prepare() {
    useChatStore.setState({
      active: tab,
      openTabs: [tab],
      bySession: { [key]: { ...EMPTY_SESSION, messages: history, streaming: true } },
      streamingByKey: { [key]: true },
    });
    routeRun(runId, key);
  }

  function emit(kind: ChatEngineEvent["kind"], data: unknown = null) {
    handleEngineEvents([{ engine: "omp", sessionId: tab.sessionId, runId, seq: 1, kind, data }], engineDeps());
  }

  it.each([false, true])("replaces an unfinished native message across compaction (already painted: %s)", (painted) => {
    prepare();
    emit("assistant_message_start");
    emit("thinking", "尚未写完的思考");
    emit("delta", "压缩前未完成的半句");
    if (painted) flushPendingStreams(useChatStore.setState);

    // Manual OMP compaction disconnects before aborting: no message_end
    // arrives for the old text. The resumed model opens a new message.
    emit("assistant_message_start");
    emit("thinking", "重新生成的思考");
    const answer = "**新的正文**🙂\n\n```ts\nconst n = 1;\n```";
    emit("delta", answer);
    emit("assistant_message_end");
    emit("done", { usage: null });

    const session = useChatStore.getState().bySession[key];
    expect(session.messages.filter((m) => m.role === "assistant").map((m) => m.text)).toEqual(["准备完成。", answer]);
    expect(session.messages.filter((m) => m.role === "thinking").map((m) => m.text)).toEqual(["重新生成的思考"]);
    expect(session.messages.slice(0, history.length)).toEqual(history);
    expect(session.streaming).toBe(false);
  });

  it("keeps consecutive committed assistant messages separate", () => {
    prepare();
    emit("assistant_message_start");
    emit("delta", "第一条已完成正文。");
    emit("assistant_message_end");
    emit("assistant_message_start");
    emit("delta", "第二条已完成正文。");
    emit("assistant_message_end");
    emit("done", { usage: null });
    expect(useChatStore.getState().bySession[key].messages.filter((m) => m.role === "assistant").map((m) => m.text))
      .toEqual(["准备完成。", "第一条已完成正文。", "第二条已完成正文。"]);
  });

  it("keeps user-stopped partial output and ignores a late restart", async () => {
    prepare();
    emit("assistant_message_start");
    emit("delta", "用户主动停止时已经看到的内容");
    await useChatStore.getState().interrupt(tab);
    emit("assistant_message_start");
    emit("delta", "迟到的旧回合内容");
    const session = useChatStore.getState().bySession[key];
    expect(session.messages.filter((m) => m.role === "assistant").map((m) => m.text))
      .toEqual(["准备完成。", "用户主动停止时已经看到的内容"]);
    expect(session.streaming).toBe(false);
  });

  it("commits interleaved channels before a same-batch restart without settling the run", () => {
    prepare();
    const compaction = { automatic: false, startedAt: 1, runId };
    const usage = { input_tokens: 100 };
    useChatStore.setState((s) => ({
      bySession: { ...s.bySession, [key]: { ...s.bySession[key], compaction, usage, turnUsage: usage, liveCompactRunId: runId } },
    }));
    const deps = { ...engineDeps(), drainQueue: vi.fn(), markUnseenIfBackground: vi.fn() };
    const events: Array<[ChatEngineEvent["kind"], unknown]> = [
      ["assistant_message_start", null],
      ["delta", "first "],
      ["thinking", "reason "],
      ["delta", "answer"],
      ["thinking", "complete"],
      ["assistant_message_end", null],
      ["assistant_message_start", null],
      ["delta", "second answer"],
      ["assistant_message_end", null],
    ];
    handleEngineEvents(events.map(([kind, data], seq) => ({ engine: "omp", sessionId: tab.sessionId, runId, seq, kind, data })), deps);

    const session = useChatStore.getState().bySession[key];
    expect(session.messages.slice(history.length)).toEqual([
      expect.objectContaining({ role: "assistant", text: "first answer", live: false }),
      expect.objectContaining({ role: "thinking", text: "reason complete", live: false }),
      expect.objectContaining({ role: "assistant", text: "second answer", live: false }),
    ]);
    expect(session.streaming).toBe(true);
    expect(useChatStore.getState().streamingByKey[key]).toBe(true);
    expect(session.compaction).toBe(compaction);
    expect(session.usage).toBe(usage);
    expect(session.turnUsage).toBe(usage);
    expect(session.liveCompactRunId).toBe(runId);
    expect(runRouting.get(runId)).toBe(key);
    expect(deps.drainQueue).not.toHaveBeenCalled();
    expect(deps.markUnseenIfBackground).not.toHaveBeenCalled();
  });

  it("discards a failed attempt's painted and pending tails but retains tools and other sessions", () => {
    prepare();
    emit("assistant_message_start");
    emit("delta", "committed before tool");
    emit("assistant_message_end");
    emit("message", { role: "tool", text: "read", args: { path: "notes.txt" } });
    emit("message", { role: "tool_result", text: "read", patch: true, result: { content: "kept" } });
    const committed = useChatStore.getState().bySession[key].messages;
    emit("assistant_message_start");
    emit("delta", "failed partial");
    emit("thinking", "failed reasoning");
    flushPendingStreams(useChatStore.setState);
    emit("delta", " not painted");
    emit("retry", { attempt: 1, max: 3, message: "temporary failure" });
    const otherKey = "omp/other-boundary-session";
    routeRun("other-boundary-run", otherKey);
    useChatStore.setState((s) => ({ bySession: { ...s.bySession, [otherKey]: { ...EMPTY_SESSION, streaming: true } } }));
    handleEngineEvents([{ engine: "omp", sessionId: "other-boundary-session", runId: "other-boundary-run", seq: 1, kind: "delta", data: "other pending text" }], engineDeps());

    emit("assistant_message_start");
    expect(useChatStore.getState().bySession[key].retry?.attempt).toBe(1);
    emit("thinking", "fresh reasoning");
    emit("delta", "recovered answer");
    emit("assistant_message_end");
    flushPendingStreams(useChatStore.setState);

    const session = useChatStore.getState().bySession[key];
    committed.forEach((message, index) => expect(session.messages[index]).toBe(message));
    expect(session.messages.slice(committed.length).map((m) => [m.role, m.text, m.live])).toEqual([
      ["thinking", "fresh reasoning", false],
      ["assistant", "recovered answer", false],
    ]);
    expect(session.retry).toBeNull();
    expect(useChatStore.getState().bySession[otherKey].messages[0].text).toBe("other pending text");
    expect(useChatStore.getState().bySession[otherKey].streaming).toBe(true);
  });

  it.each([false, true])("replaces unfinished content after native session rekey (already painted: %s)", (painted) => {
    prepare();
    emit("assistant_message_start");
    emit("delta", "old session prefix");
    if (painted) flushPendingStreams(useChatStore.setState);
    emit("session", "rekeyed-boundary-session");
    const newKey = "omp/rekeyed-boundary-session";
    expect(runRouting.get(runId)).toBe(newKey);
    emit("assistant_message_start");
    emit("delta", "fresh native answer");
    emit("assistant_message_end");
    flushPendingStreams(useChatStore.setState);

    expect(useChatStore.getState().bySession[key]).toBeUndefined();
    expect(useChatStore.getState().bySession[newKey].messages.map((m) => m.text)).toEqual([
      ...history.map((m) => m.text), "fresh native answer",
    ]);
  });

  it("keeps row and session identities for empty boundaries", () => {
    prepare();
    const before = useChatStore.getState().bySession[key];
    emit("assistant_message_start");
    emit("assistant_message_end");
    expect(useChatStore.getState().bySession[key]).toBe(before);
    expect(useChatStore.getState().bySession[key].messages).toBe(history);
  });

  it("ignores late boundaries from a stopped run while a newer run is streaming", async () => {
    prepare();
    emit("assistant_message_start");
    emit("delta", "stopped partial");
    await useChatStore.getState().interrupt(tab);
    const nextRunId = "boundary-next-run";
    routeRun(nextRunId, key);
    handleEngineEvents([
      { engine: "omp", sessionId: tab.sessionId, runId: nextRunId, seq: 1, kind: "assistant_message_start", data: null },
      { engine: "omp", sessionId: tab.sessionId, runId: nextRunId, seq: 2, kind: "delta", data: "new pending text" },
    ], engineDeps());
    emit("assistant_message_end");
    emit("assistant_message_start");
    flushPendingStreams(useChatStore.setState);

    const session = useChatStore.getState().bySession[key];
    expect(session.messages.filter((m) => m.role === "assistant").map((m) => [m.text, m.live])).toEqual([
      ["准备完成。", undefined], ["stopped partial", false], ["new pending text", true],
    ]);
    expect(session.streaming).toBe(true);
    expect(runRouting.get(nextRunId)).toBe(key);
  });
});

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

  it("announces the picker switch to plugins only when the tab actually retargets", () => {
    const seen: unknown[] = [];
    const dispose = pluginBus.on(SESSION_ACTIVATED_TOPIC, (data) => seen.push(data));
    try {
      useChatStore.setState({ activeEngine: "omp" });
      useChatStore.getState().startNewChat(WS);

      useChatStore.getState().setActiveEngine("claude");
      expect(seen.at(-1)).toEqual({ engine: "claude", sessionId: null });

      // 已经是该引擎：不重复广播（避免插件被无意义的重复事件打扰）
      const afterRetarget = seen.length;
      useChatStore.getState().setActiveEngine("claude");
      expect(seen.length).toBe(afterRetarget);
    } finally {
      dispose();
    }
  });

  it("keeps the session lifecycle open while its conversation mode blocks closing", async () => {
    const tab = { engine: "claude", sessionId: "mode-locked", workspacePath: WS };
    const key = "claude/mode-locked";
    const contributions = { [key]: { remembered: {}, resets: {}, overflowed: false } };
    useChatStore.setState({ active: tab, openTabs: [tab], sessionContributions: contributions });
    const modes = getConversationModeState();
    const identity = modes.identity(key, WS, false);
    modes.setExitBlocked(identity, "test.mode", true);
    const closed = vi.fn();
    const dispose = registerSessionHooks("test.mode-close", { onClosed: closed });
    try {
      useChatStore.getState().closeTab(tab.engine, tab.sessionId, WS);
      await Promise.resolve();
      expect(useChatStore.getState().openTabs).toEqual([tab]);
      expect(useChatStore.getState().sessionContributions).toEqual(contributions);
      expect(closed).not.toHaveBeenCalled();

      modes.setExitBlocked(identity, "test.mode", false);
      useChatStore.getState().closeTab(tab.engine, tab.sessionId, WS);
      await Promise.resolve();
      expect(useChatStore.getState().openTabs).toEqual([]);
      expect(useChatStore.getState().sessionContributions).toEqual({});
      expect(closed).toHaveBeenCalledTimes(1);
      expect(closed).toHaveBeenCalledWith(expect.objectContaining({ engine: tab.engine, sessionId: tab.sessionId }));
    } finally {
      modes.setExitBlocked(identity, "test.mode", false);
      modes.exit(identity);
      dispose();
    }
  });
});

describe("stop during an in-flight send", () => {
  beforeEach(resetStore);

  it("kills the run when Stop is pressed before sendMessage resolves", async () => {
    // Existing resumed session: the tab already carries a native id, so the
    // send takes the run-routing branch (no id adoption).
    const tab = { engine: "omp", sessionId: "sess-42", workspacePath: WS };
    useChatStore.setState({ activeEngine: "omp", openTabs: [tab], active: tab });

    // Hold the actual launch open so Stop precedes its acknowledgement.
    const { promise, resolve: resolveSend } = Promise.withResolvers<{
      runId: string;
      sessionId: string | null;
    }>();
    vi.mocked(ipc.sendMessage).mockReturnValueOnce(promise);

    const sending = useChatStore.getState().send("hello", []);
    await vi.waitFor(() => expect(ipc.sendMessage).toHaveBeenCalledTimes(1));
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

  it("does not launch a stopped before-turn generation after a replacement starts", async () => {
    const tab = { engine: "omp", sessionId: "preparing-42", workspacePath: WS };
    useChatStore.setState({ activeEngine: "omp", openTabs: [tab], active: tab });
    const preparation = Promise.withResolvers<void>();
    const beforeTurns: string[] = [];
    const started: string[] = [];
    const finished: string[] = [];
    const dispose = registerTurnHooks("test.stop-preparation", {
      beforeTurn: (event) => {
        beforeTurns.push(event.turnId);
        if (beforeTurns.length === 1) return preparation.promise;
      },
      onTurnStarted: (event) => { started.push(event.turnId); },
      afterTurn: (event) => { finished.push(event.turnId); },
    });
    const first = useChatStore.getState().send("stopped", []);
    try {
      await vi.waitFor(() => expect(beforeTurns).toHaveLength(1));
      await useChatStore.getState().interrupt();
      expect(ipc.sendMessage).not.toHaveBeenCalled();
      expect(started).toEqual([]);
      vi.mocked(ipc.sendMessage).mockResolvedValueOnce({ runId: "run-replacement", sessionId: "preparing-42" });
      await useChatStore.getState().send("replacement", []);
      preparation.resolve();
      await first;
      expect(ipc.sendMessage).toHaveBeenCalledTimes(1);
      expect(started).toEqual([beforeTurns[1]]);
      handleEngineEvents([
        { runId: "run-replacement", sessionId: "preparing-42", engine: "omp", seq: 1, kind: "done", data: { usage: null } },
      ], engineDeps());
      await Promise.resolve();
      expect(finished).toEqual(started);
    } finally {
      preparation.resolve();
      await first;
      dispose();
    }
  });

  it("cancels only the old run when its acknowledgement follows a replacement launch", async () => {
    const tab = { engine: "omp", sessionId: "overlap-session", workspacePath: WS };
    const key = "omp/overlap-session";
    useChatStore.setState({ activeEngine: "omp", openTabs: [tab], active: tab });
    const oldLaunch = Promise.withResolvers<{ runId: string; sessionId: string | null; liveCompact?: boolean }>();
    vi.mocked(ipc.sendMessage).mockReturnValueOnce(oldLaunch.promise);
    const started: string[] = [];
    const finished: Array<{ turnId: string; status: string }> = [];
    const dispose = registerTurnHooks("test.overlapping-launches", {
      onTurnStarted: (event) => { started.push(event.turnId); },
      afterTurn: (event) => { finished.push({ turnId: event.turnId, status: event.status }); },
    });
    const oldSending = useChatStore.getState().send("first", []);
    try {
      await vi.waitFor(() => expect(ipc.sendMessage).toHaveBeenCalledTimes(1));
      await useChatStore.getState().interrupt();
      vi.mocked(ipc.sendMessage).mockResolvedValueOnce({ runId: "run-overlap-b", sessionId: tab.sessionId, liveCompact: true });
      await useChatStore.getState().send("replacement", []);
      const replacementTurnId = started[1];
      vi.mocked(ipc.interruptSession).mockClear();
      oldLaunch.resolve({ runId: "run-overlap-a", sessionId: tab.sessionId, liveCompact: true });
      await oldSending;
      expect(ipc.interruptSession).toHaveBeenCalledWith("run-overlap-a");
      expect(ipc.interruptSession).not.toHaveBeenCalledWith(tab.sessionId);
      expect(ipc.interruptSession).not.toHaveBeenCalledWith("run-overlap-b");
      expect(useChatStore.getState().streamingByKey[key]).toBe(true);
      expect(useChatStore.getState().bySession[key]?.liveCompactRunId).toBe("run-overlap-b");
      expect(finished).toEqual([{ turnId: started[0], status: "cancelled" }]);
      handleEngineEvents([
        { runId: "run-overlap-b", sessionId: tab.sessionId, engine: "omp", seq: 1, kind: "done", data: { usage: null } },
      ], engineDeps());
      await Promise.resolve();
      expect(finished).toEqual([
        { turnId: started[0], status: "cancelled" },
        { turnId: replacementTurnId, status: "completed" },
      ]);
    } finally {
      oldLaunch.resolve({ runId: "run-overlap-a", sessionId: tab.sessionId });
      await oldSending;
      dispose();
    }
  });
});

describe("native auto threshold sends and live capability ACKs", () => {
  beforeEach(resetStore);

  it.each([
    { usage: { input_tokens: 1, contextWindow: 1_000_000 }, remembered: 500_000, catalog: 300_000, expected: 500_000 },
    { usage: null, remembered: 500_000, catalog: 300_000, expected: 250_000 },
    { usage: null, remembered: 0, catalog: 300_000, expected: 150_000 },
    { usage: null, remembered: 0, catalog: 0, expected: 100_000 },
  ])("uses the gauge window priority for a background send ($expected tokens)", async ({ usage, remembered, catalog, expected }) => {
    const tab = { engine: "claude", sessionId: "native-threshold", workspacePath: "/background", model: "chosen" };
    const key = "claude/native-threshold";
    const other = { engine: "codex", sessionId: "foreground", workspacePath: "/foreground" };
    useChatStore.setState({ active: other, openTabs: [tab, other], bySession: { [key]: { ...EMPTY_SESSION, usage } } });
    setAutoCompactEnabled(key, true);
    setAutoCompactThreshold(key, 50);
    if (remembered) rememberContextWindow("claude", "chosen", remembered);
    vi.mocked(ipc.listEngineModels).mockResolvedValueOnce({ models: catalog ? [{ id: "chosen", provider: "test", contextWindow: catalog }] : [], authoritative: false });
    await useChatStore.getState().send("continue", [], {}, tab);
    expect(ipc.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ autoCompactThresholdTokens: expected }));
    expect(useChatStore.getState().active).toBe(other);
    expect(useChatStore.getState().bySession[key]?.streaming).toBe(true);
    if (!usage && !remembered) expect(ipc.listEngineModels).toHaveBeenCalledWith("claude", "/background");
  });

  it("rejects invalid enabled Claude thresholds visibly and sends normally when disabled", async () => {
    const tab = { engine: "claude", sessionId: "invalid-threshold", workspacePath: WS };
    const key = "claude/invalid-threshold";
    useChatStore.setState({ active: tab, openTabs: [tab], bySession: { [key]: { ...EMPTY_SESSION, usage: { input_tokens: 1, contextWindow: 200_000 } } } });
    setAutoCompactThreshold(key, 5);
    setAutoCompactEnabled(key, true);
    await useChatStore.getState().send("first", []);
    expect(ipc.sendMessage).not.toHaveBeenCalled();
    expect(useChatStore.getState().bySession[key]?.error).toContain("100,000");
    expect(useChatStore.getState().bySession[key]?.streaming).toBe(false);
    setAutoCompactEnabled(key, false);
    await useChatStore.getState().send("second", []);
    expect(vi.mocked(ipc.sendMessage).mock.calls[0][0]).not.toHaveProperty("autoCompactThresholdTokens");
    expect(useChatStore.getState().bySession[key]?.error).toBeNull();
  });

  it("migrates settings on a send-result-only native adoption and retains the confirmed immutable run", async () => {
    const tab = { engine: "omp", sessionId: null, workspacePath: WS };
    const pendingKey = `new:omp:${WS}`;
    useChatStore.setState({ active: tab, openTabs: [tab] });
    setAutoCompactEnabled(pendingKey, true);
    setAutoCompactThreshold(pendingKey, 35);
    vi.mocked(ipc.sendMessage).mockImplementationOnce(async ({ runId }) => ({ runId: runId!, sessionId: "adopted", liveCompact: true }));
    await useChatStore.getState().send("first", []);
    const session = useChatStore.getState().bySession["omp/adopted"];
    expect(useChatStore.getState().bySession[pendingKey]).toBeUndefined();
    expect(getAutoCompactSettings("omp/adopted")).toEqual({ enabled: true, threshold: 35 });
    expect(session?.liveCompactRunId).toBe(vi.mocked(ipc.sendMessage).mock.calls[0][0].runId);
    await useChatStore.getState().compactContext("omp/adopted");
    expect(session?.streaming).toBe(true);
    expect(useChatStore.getState().bySession["omp/adopted"]?.compaction?.runId).toBe(session?.liveCompactRunId);
  });

  it("does not restore a capability when Done outruns the send ACK", async () => {
    const tab = { engine: "omp", sessionId: "early-done", workspacePath: WS };
    const key = "omp/early-done";
    useChatStore.setState({ active: tab, openTabs: [tab] });
    vi.mocked(ipc.sendMessage).mockImplementationOnce(async ({ runId }) => {
      handleEngineEvents([{ seq: 1, engine: "omp", runId: runId!, sessionId: tab.sessionId, kind: "done", data: { usage: null } }], engineDeps());
      return { runId: runId!, sessionId: tab.sessionId, liveCompact: true };
    });
    await useChatStore.getState().send("quick", []);
    expect(useChatStore.getState().bySession[key]?.streaming).toBe(false);
    expect(useChatStore.getState().bySession[key]?.liveCompactRunId).toBeNull();
  });
  it("preserves native readiness that arrives before a false send ACK", async () => {
    const tab = { engine: "omp", sessionId: "ready-before-ack", workspacePath: WS };
    const key = "omp/ready-before-ack";
    useChatStore.setState({ active: tab, openTabs: [tab] });
    vi.mocked(ipc.sendMessage).mockImplementationOnce(async ({ runId }) => {
      handleEngineEvents([{ seq: 1, engine: "omp", runId: runId!, sessionId: tab.sessionId, kind: "live_compact_ready", data: { active: true } }], engineDeps());
      return { runId: runId!, sessionId: tab.sessionId, liveCompact: false };
    });
    await useChatStore.getState().send("first", []);
    const runId = vi.mocked(ipc.sendMessage).mock.calls[0][0].runId;
    expect(useChatStore.getState().bySession[key]?.liveCompactRunId).toBe(runId);
    handleEngineEvents([{ seq: 2, engine: "omp", runId: "unrelated-ready", sessionId: tab.sessionId, kind: "live_compact_ready", data: { active: false } }], engineDeps());
    expect(useChatStore.getState().bySession[key]?.liveCompactRunId).toBe(runId);
    handleEngineEvents([{ seq: 3, engine: "omp", runId: runId!, sessionId: tab.sessionId, kind: "live_compact_ready", data: { active: false } }], engineDeps());
    expect(useChatStore.getState().bySession[key]?.liveCompactRunId).toBeNull();
    expect(useChatStore.getState().bySession[key]?.streaming).toBe(true);
  });

  it("does not let readiness events revive a locally stopped run", () => {
    const key = "omp/stopped-readiness";
    useChatStore.setState({ bySession: { [key]: { ...EMPTY_SESSION, interrupted: true } }, streamingByKey: {} });
    routeRun("stopped-readiness", key);
    handleEngineEvents([{ seq: 1, engine: "omp", runId: "stopped-readiness", sessionId: "stopped-readiness", kind: "live_compact_ready", data: { active: true } }], engineDeps());
    expect(useChatStore.getState().bySession[key]?.liveCompactRunId).toBeNull();
    expect(useChatStore.getState().bySession[key]?.streaming).toBe(false);
    expect(useChatStore.getState().streamingByKey[key]).toBeUndefined();
  });
});

describe("compactContext and refreshSessionUsage", () => {
  beforeEach(resetStore);

  it("retries a successful but unchanged history read until the final usage is persisted", async () => {
    const key = "codex/delayed-write";
    const previous = { input_tokens: 1000, model_context_window: 200000 };
    const latest = { input_tokens: 90000, model_context_window: 1000000 };
    useChatStore.setState({ bySession: { [key]: { ...EMPTY_SESSION, usage: previous } } });
    vi.mocked(ipc.loadSessionPage)
      .mockResolvedValueOnce({ messages: [{ usage: previous }] } as any)
      .mockResolvedValueOnce({ messages: [{ usage: latest }] } as any);
    await useChatStore.getState().refreshSessionUsage(key);
    expect(useChatStore.getState().bySession[key].usage).toEqual(latest);
  });

  it("refreshes an existing session before sending without waiting for history", async () => {
    const tab = { engine: "codex", sessionId: "before-send", workspacePath: WS };
    const key = "codex/before-send";
    useChatStore.setState({ active: tab, openTabs: [tab], bySession: { [key]: { ...EMPTY_SESSION } } });
    const history = Promise.withResolvers<any>();
    vi.mocked(ipc.loadSessionPage).mockReturnValueOnce(history.promise);
    await useChatStore.getState().send("hello", []);
    expect(ipc.loadSessionPage).toHaveBeenLastCalledWith("codex", "before-send", 100);
    expect(ipc.sendMessage).toHaveBeenCalled();
    history.resolve({ messages: [], nextBefore: null, subagentHistory: [] });
  });

  it("refreshes again when a send fails before any engine event", async () => {
    const tab = { engine: "codex", sessionId: "failed-send", workspacePath: WS };
    const key = "codex/failed-send";
    useChatStore.setState({ active: tab, openTabs: [tab], bySession: { [key]: { ...EMPTY_SESSION } } });
    vi.mocked(ipc.loadSessionPage).mockClear();
    vi.mocked(ipc.sendMessage).mockRejectedValueOnce(new Error("spawn failed"));
    await useChatStore.getState().send("hello", []);
    expect(ipc.loadSessionPage).toHaveBeenCalledTimes(2);
    expect(useChatStore.getState().bySession[key].streaming).toBe(false);
  });

  it("refreshing a closed background session reads its own id, not the active tab", async () => {
    const active = { engine: "claude", sessionId: "foreground", workspacePath: WS };
    const key = "codex/background";
    useChatStore.setState({ active, openTabs: [active], bySession: { [key]: { ...EMPTY_SESSION } } });
    await useChatStore.getState().refreshSessionUsage(key);
    expect(ipc.loadSessionPage).toHaveBeenLastCalledWith("codex", "background", 100);
  });

  it("a slow refresh cannot overwrite newer live usage or lose a 1M window", async () => {
    const key = "codex/refresh-race";
    const oldUsage = { input_tokens: 1000, model_context_window: 1_000_000 };
    useChatStore.setState({ bySession: { [key]: { ...EMPTY_SESSION, usage: oldUsage } } });
    const history = Promise.withResolvers<any>();
    vi.mocked(ipc.loadSessionPage).mockReturnValueOnce(history.promise);
    const refreshing = useChatStore.getState().refreshSessionUsage(key);
    const latestUsage = { input_tokens: 90000, model_context_window: 1_000_000 };
    useChatStore.setState({ bySession: { [key]: { ...EMPTY_SESSION, usage: latestUsage } } });
    history.resolve({ messages: [{ usage: { input_tokens: 2000 } }] });
    await refreshing;
    expect(useChatStore.getState().bySession[key].usage).toBe(latestUsage);
    vi.mocked(ipc.loadSessionPage).mockResolvedValueOnce({ messages: [{ usage: { input_tokens: 91000 } }] } as any);
    await useChatStore.getState().refreshSessionUsage(key);
    expect(useChatStore.getState().bySession[key].usage).toEqual({ input_tokens: 91000, model_context_window: 1_000_000 });
  });

  it("a claude turn-sum settles down to the smaller occupancy the file holds", async () => {
    const key = "claude/turn-sum";
    // What a claude result line carries: every request of the turn added up
    // (billing), which is far past the window the meter measures against. The
    // transcript keeps the last request's prompt — the real occupancy.
    const turnSum = {
      input_tokens: 51_755,
      output_tokens: 5_713,
      cache_read_input_tokens: 4_900_000,
      model_context_window: 1_000_000,
    };
    useChatStore.setState({ bySession: { [key]: { ...EMPTY_SESSION, usage: turnSum } } });
    const occupancy = {
      input_tokens: 600,
      output_tokens: 927,
      cache_read_input_tokens: 162_176,
    };
    vi.mocked(ipc.loadSessionPage).mockResolvedValueOnce({
      messages: [{ seq: 1, role: "assistant", text: "hi", ts: "2026-09-18T00:00:00Z", usage: occupancy }],
    } as any);
    await useChatStore.getState().refreshSessionUsage(key);
    // The decrease must land — a re-read is newer than a turn sum, not staler —
    // while the window only the live report knew survives the swap.
    expect(useChatStore.getState().bySession[key]?.usage).toEqual({
      ...occupancy,
      model_context_window: 1_000_000,
    });
  });

  it("refreshSessionUsage updates session usage from session history", async () => {
    const tab = { engine: "claude", sessionId: "sess-compact", workspacePath: WS };
    const key = "claude/sess-compact";
    useChatStore.setState({
      activeEngine: "claude",
      openTabs: [tab],
      active: tab,
      bySession: {
        [key]: { ...EMPTY_SESSION },
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
      subagentHistory: [],
    });

    await useChatStore.getState().refreshSessionUsage(key);

    expect(ipc.loadSessionPage).toHaveBeenCalledWith("claude", "sess-compact", 100);
    expect(useChatStore.getState().bySession[key]?.usage).toEqual(mockUsage);
  });

  it("loadHistoryPage routes remote metas through loadRemoteSessionPage", async () => {
    useChatStore.setState({
      sessions: [
        {
          engine: "codex",
          sessionId: "remote-1",
          workspacePath: WS,
          filePath: "",
          fileSize: 0,
          fileMtimeMs: 0,
          title: "remote",
          preview: "",
          createdAt: null,
          updatedAt: null,
          messageCount: 0,
          pinned: false,
          customTitle: null,
          remote: true,
          remotePath: "/home/u/x.jsonl",
        } as any,
      ],
    });
    await useChatStore.getState().selectSession("codex", "remote-1", WS);
    expect(ipc.loadRemoteSessionPage).toHaveBeenCalledWith(WS, "codex", "remote-1", "/home/u/x.jsonl", 100, undefined);
    expect(ipc.loadSessionPage).not.toHaveBeenCalledWith("codex", "remote-1", 100);
  });

  it("deleteSession routes remote metas through deleteRemoteSession", async () => {
    const remoteMeta: SessionMeta = {
      engine: "dsh",
      sessionId: "remote-1",
      workspacePath: WS,
      filePath: "",
      fileSize: 0,
      fileMtimeMs: 0,
      title: "remote",
      preview: "",
      createdAt: null,
      updatedAt: null,
      messageCount: 0,
      pinned: false,
      customTitle: null,
      remote: true,
      remotePath: "/home/u/.dsh/sessions/-tmp-ws/s-1/session.jsonl.zstd",
    };
    const localMeta: SessionMeta = { ...remoteMeta, engine: "omp", sessionId: "local-1", remote: false, remotePath: undefined };
    useChatStore.setState({ sessions: [remoteMeta, localMeta] });

    await useChatStore.getState().deleteSession("dsh", "remote-1");
    expect(ipc.deleteRemoteSession).toHaveBeenCalledWith(
      WS,
      "dsh",
      "remote-1",
      "/home/u/.dsh/sessions/-tmp-ws/s-1/session.jsonl.zstd",
    );
    expect(ipc.deleteSession).not.toHaveBeenCalled();
    expect(useChatStore.getState().sessions.map((s) => s.sessionId)).toEqual(["local-1"]);

    await useChatStore.getState().deleteSession("omp", "local-1");
    expect(ipc.deleteSession).toHaveBeenCalledWith("omp", "local-1");
    expect(useChatStore.getState().sessions).toEqual([]);
  });

  it("archiveSession hides the row, closes its tab, and remembers the key", async () => {
    const meta: SessionMeta = {
      engine: "codex",
      sessionId: "archive-1",
      workspacePath: WS,
      filePath: "/tmp/archive-1.jsonl",
      fileSize: 1,
      fileMtimeMs: 1,
      title: "archive me",
      preview: "",
      createdAt: 1,
      updatedAt: 2,
      messageCount: 1,
      pinned: false,
      customTitle: null,
    };
    const tab = { engine: meta.engine, sessionId: meta.sessionId, workspacePath: WS };
    useChatStore.setState({
      sessions: [meta],
      openTabs: [tab],
      active: tab,
      bySession: { "codex/archive-1": { ...EMPTY_SESSION } },
    });

    await useChatStore.getState().archiveSession(meta);

    expect(ipc.archiveSession).toHaveBeenCalledWith(meta);
    expect(useChatStore.getState().sessions).toEqual([]);
    expect(useChatStore.getState().openTabs).toEqual([]);
    expect(useChatStore.getState().active).toBeNull();
    expect(useChatStore.getState().archivedSessionKeys["codex/archive-1"]).toBe(true);
    expect(useChatStore.getState().bySession["codex/archive-1"]).toBeUndefined();
  });

  it("pinModels(updates, false) 只更新内存 models,不触碰 persisted 默认", async () => {
    vi.mocked(ipc.updateAppSettings).mockClear();
    await useChatStore.getState().pinModels({ omp: "remote-only-model" }, false);
    expect(useChatStore.getState().models.omp).toBe("remote-only-model");
    expect(ipc.updateAppSettings).not.toHaveBeenCalled();
  });

  it("pinModels 默认 persist:写 settings.defaultModels", async () => {
    vi.mocked(ipc.updateAppSettings).mockClear();
    await useChatStore.getState().pinModels({ omp: "m1" });
    expect(useChatStore.getState().models.omp).toBe("m1");
    expect(ipc.updateAppSettings).toHaveBeenCalledWith(
      expect.objectContaining({ defaultModels: expect.objectContaining({ omp: "m1" }) }),
    );
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
          ...EMPTY_SESSION,
          usage: { inputTokens: 50000, outputTokens: 5000 },
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
      subagentHistory: [],
    });

    const compactPromise = useChatStore.getState().compactContext(key, { trigger: "threshold" });
    expect(useChatStore.getState().bySession[key]?.compaction).toMatchObject({
      automatic: false,
      trigger: "threshold",
    });

    // Verify /compact message was sent
    await vi.waitFor(() => expect(ipc.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "/compact" }),
    ));

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
    expect(useChatStore.getState().bySession[key]?.compaction).toBeNull();
  });

  it("compacts a streaming OMP run in place through its own stdin", async () => {
    // The bug: a turn that never settles (long tool loop) kept the host
    // from compacting at all — the action returned early on `streaming`.
    const tab = { engine: "omp", sessionId: "sess-live", workspacePath: WS };
    const key = "omp/sess-live";
    useChatStore.setState({
      activeEngine: "omp",
      openTabs: [tab],
      active: tab,
      bySession: { [key]: { ...EMPTY_SESSION, streaming: true, liveCompactRunId: "run-live" } },
      streamingByKey: { [key]: true },
    });
    routeRun("run-live", key);

    await useChatStore.getState().compactContext(key, { trigger: "threshold" });

    expect(ipc.compactActiveRun).toHaveBeenCalledWith("run-live");
    // No second turn: no /compact prompt, no 「继续」 nudge.
    expect(ipc.sendMessage).not.toHaveBeenCalled();
    expect(useChatStore.getState().bySession[key]?.compaction).toMatchObject({
      automatic: false,
      trigger: "threshold",
    });
    await useChatStore.getState().compactContext(key);
    expect(ipc.compactActiveRun).toHaveBeenCalledTimes(1);
    handleEngineEvents([{ seq: 1, engine: "omp", runId: "run-live", sessionId: "sess-live", kind: "compaction", data: { active: false, reason: "auto" } }], engineDeps());
    expect(useChatStore.getState().bySession[key]?.compaction).not.toBeNull();
    handleEngineEvents([{ seq: 2, engine: "omp", runId: "run-live", sessionId: "sess-live", kind: "compaction", data: { active: false, reason: "ccgui-live-compact:1" } }], engineDeps());
    expect(useChatStore.getState().bySession[key]?.compaction).toBeNull();
    expect(useChatStore.getState().bySession[key]?.streaming).toBe(true);
    expect(useChatStore.getState().bySession[key]?.liveCompactRunId).toBeNull();
    await useChatStore.getState().compactContext(key);
    expect(ipc.compactActiveRun).toHaveBeenCalledTimes(1);
    handleEngineEvents([{ seq: 3, engine: "omp", runId: "run-live", sessionId: "sess-live", kind: "live_compact_ready", data: { active: true } }], engineDeps());
    expect(useChatStore.getState().bySession[key]?.liveCompactRunId).toBe("run-live");
  });

  it("leaves a streaming non-OMP run alone: it has no resume-safe compact", async () => {
    const tab = { engine: "claude", sessionId: "sess-busy", workspacePath: WS };
    const key = "claude/sess-busy";
    useChatStore.setState({
      activeEngine: "claude",
      openTabs: [tab],
      active: tab,
      bySession: { [key]: { ...EMPTY_SESSION, streaming: true } },
      streamingByKey: { [key]: true },
    });
    routeRun("run-claude", key);

    await useChatStore.getState().compactContext(key, { trigger: "threshold" });

    expect(ipc.compactActiveRun).not.toHaveBeenCalled();
    expect(ipc.sendMessage).not.toHaveBeenCalled();
  });

  it("clears compaction state when the live compact request fails", async () => {
    const tab = { engine: "omp", sessionId: "sess-fail", workspacePath: WS };
    const key = "omp/sess-fail";
    useChatStore.setState({
      activeEngine: "omp",
      openTabs: [tab],
      active: tab,
      bySession: { [key]: { ...EMPTY_SESSION, streaming: true, liveCompactRunId: "run-dead" } },
      streamingByKey: { [key]: true },
    });
    routeRun("run-dead", key);
    vi.mocked(ipc.compactActiveRun).mockRejectedValueOnce(new Error("run is gone"));

    await expect(
      useChatStore.getState().compactContext(key, { trigger: "manual" }),
    ).rejects.toThrow("run is gone");
    expect(useChatStore.getState().bySession[key]?.compaction).toBeNull();
  });
  it("does not compact an unrelated active tab when the requested tab is absent", async () => {
    const tab = { engine: "omp", sessionId: "active", workspacePath: WS };
    useChatStore.setState({ active: tab, openTabs: [tab], bySession: { "omp/active": { ...EMPTY_SESSION } } });
    await useChatStore.getState().compactContext("omp/closed");
    expect(ipc.sendMessage).not.toHaveBeenCalled();
    expect(useChatStore.getState().bySession["omp/closed"]).toBeUndefined();
  });

  it("requires a backend-confirmed capability and blocks native maintenance", async () => {
    const tab = { engine: "omp", sessionId: "capability", workspacePath: WS };
    const key = "omp/capability";
    useChatStore.setState({ active: tab, openTabs: [tab], bySession: { [key]: { ...EMPTY_SESSION, streaming: true } }, streamingByKey: { [key]: true } });
    routeRun("run-capability", key);
    await useChatStore.getState().compactContext(key);
    expect(useChatStore.getState().bySession[key]?.compaction).toBeNull();
    useChatStore.setState({ bySession: { [key]: { ...useChatStore.getState().bySession[key], liveCompactRunId: "run-capability", compaction: { automatic: true, startedAt: 1 } } } });
    await useChatStore.getState().compactContext(key);
    expect(ipc.compactActiveRun).not.toHaveBeenCalled();
    expect(useChatStore.getState().bySession[key]?.compaction?.automatic).toBe(true);
  });

  it("keeps a replacement compaction when an earlier delivery fails after Stop", async () => {
    const tab = { engine: "omp", sessionId: "replacement", workspacePath: WS };
    const key = "omp/replacement";
    useChatStore.setState({ active: tab, openTabs: [tab], bySession: { [key]: { ...EMPTY_SESSION, streaming: true, liveCompactRunId: "run-old" } }, streamingByKey: { [key]: true } });
    routeRun("run-old", key);
    const delivery = Promise.withResolvers<void>();
    vi.mocked(ipc.compactActiveRun).mockReturnValueOnce(delivery.promise);
    const compact = useChatStore.getState().compactContext(key);
    await useChatStore.getState().interrupt(tab);
    expect(useChatStore.getState().bySession[key]?.liveCompactRunId).toBeNull();
    expect(useChatStore.getState().bySession[key]?.compaction).toBeNull();
    const replacement = { automatic: false, startedAt: 2, runId: "run-new" };
    useChatStore.setState({ bySession: { [key]: { ...useChatStore.getState().bySession[key], compaction: replacement, liveCompactRunId: "run-new" } } });
    delivery.reject(new Error("old delivery failed"));
    await expect(compact).rejects.toThrow("old delivery failed");
    expect(useChatStore.getState().bySession[key]?.compaction).toBe(replacement);
  });
  it("follows a pending session rekey without writing a delivery error to the active tab", async () => {
    const tab = { engine: "omp", sessionId: null, workspacePath: WS };
    const key = `new:omp:${WS}`;
    const other = { engine: "claude", sessionId: "unrelated", workspacePath: "/other" };
    useChatStore.setState({ active: tab, openTabs: [tab, other], bySession: {
      [key]: { ...EMPTY_SESSION, streaming: true, liveCompactRunId: "rekey-live" },
      "claude/unrelated": { ...EMPTY_SESSION },
    }, streamingByKey: { [key]: true } });
    routeRun("rekey-live", key);
    const delivery = Promise.withResolvers<void>();
    vi.mocked(ipc.compactActiveRun).mockReturnValueOnce(delivery.promise);
    const compact = useChatStore.getState().compactContext(key);
    handleEngineEvents([{ seq: 1, engine: "omp", runId: "rekey-live", sessionId: "rekeyed", kind: "session", data: "rekeyed" }], engineDeps());
    useChatStore.setState({ active: other });
    expect(useChatStore.getState().bySession[key]).toBeUndefined();
    expect(useChatStore.getState().bySession["omp/rekeyed"]?.compaction?.runId).toBe("rekey-live");
    delivery.reject(new Error("rekey delivery failed"));
    await expect(compact).rejects.toThrow("rekey delivery failed");
    expect(useChatStore.getState().bySession["omp/rekeyed"]?.compaction).toBeNull();
    expect(useChatStore.getState().bySession["omp/rekeyed"]?.error).toBe("rekey delivery failed");
    expect(useChatStore.getState().bySession["claude/unrelated"]?.error).toBeNull();
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
  it("keeps an existing session's effort out of the engine default and sibling sessions", async () => {
    const a = sess("s-a");
    const b = sess("s-b");
    useChatStore.setState({
      activeEngine: "omp",
      openTabs: [a, b],
      active: a,
      efforts: { omp: "medium" },
    });

    await useChatStore.getState().setEffort("omp", "max");

    expect(useChatStore.getState().efforts.omp).toBe("medium");
    expect(vi.mocked(ipc.rememberSessionEffort)).toHaveBeenCalledWith(
      "omp",
      "s-a",
      "max",
    );
    useChatStore.setState({ active: b });
    await useChatStore.getState().send("next", []);
    expect(vi.mocked(ipc.sendMessage)).toHaveBeenLastCalledWith(
      expect.objectContaining({ effort: "medium" }),
    );
  });

  it("ignores a stale persisted tab effort for a native session", async () => {
    const stale = { ...sess("s-a"), effort: "max" as const };
    useChatStore.setState({
      activeEngine: "omp",
      openTabs: [stale],
      active: stale,
      efforts: { omp: "medium" },
      bySession: {
        "omp/s-a": { ...EMPTY_SESSION, activeEffort: "low" },
      },
    });

    await useChatStore.getState().send("next", []);

    expect(vi.mocked(ipc.sendMessage)).toHaveBeenCalledWith(
      expect.objectContaining({ effort: "low" }),
    );
  });
});

describe("refreshSessions and the not-yet-scanned session", () => {
  beforeEach(() => {
    resetStore();
    useChatStore.setState({ sessions: [], engines: [], workspaces: [] });
    vi.mocked(ipc.listSessions).mockResolvedValue([]);
  });

  const meta = (sessionId: string, title = "新会话"): SessionMeta => ({
    engine: "omp",
    sessionId,
    workspacePath: WS,
    filePath: "",
    fileSize: 0,
    fileMtimeMs: 0,
    title,
    preview: "",
    createdAt: 1,
    updatedAt: 2,
    messageCount: 1,
    pinned: false,
    customTitle: null,
  });

  it("keeps the new chat's row when a refresh lands before the scanner ingests its file", async () => {
    // The reported bug: the engine announces the session id and the sidebar
    // row is upserted optimistically, but adopting the id also files the
    // model (remember_session_model → sessions_changed) and the refresh it
    // triggers replaced the list with a scan that has not seen the new file
    // yet — the row vanished until a manual sync.
    useChatStore.setState({
      sessions: [meta("s-new")],
      bySession: { "omp/s-new": { ...EMPTY_SESSION, streaming: true } },
    });

    await useChatStore.getState().refreshSessions();

    expect(
      useChatStore.getState().sessions.map((s) => s.sessionId),
    ).toContain("s-new");
  });

  it("still drops rows with no local state (external delete cleanup)", async () => {
    useChatStore.setState({ sessions: [meta("s-gone")] });

    await useChatStore.getState().refreshSessions();

    expect(useChatStore.getState().sessions).toEqual([]);
  });

  it("lets the scanned row win once the scanner ingests the file", async () => {
    useChatStore.setState({
      sessions: [meta("s-new")],
      bySession: { "omp/s-new": { ...EMPTY_SESSION, streaming: true } },
    });
    vi.mocked(ipc.listSessions).mockResolvedValue([
      { ...meta("s-new", "VPN 一直超时"), filePath: "s.jsonl" },
    ]);

    await useChatStore.getState().refreshSessions();

    const sessions = useChatStore.getState().sessions;
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId: "s-new",
      title: "VPN 一直超时",
      filePath: "s.jsonl",
    });
  });

  it("does not preserve an archived live row and closes its open tab", async () => {
    const archived = meta("s-archived");
    const tab = { engine: "omp", sessionId: "s-archived", workspacePath: WS };
    useChatStore.setState({
      sessions: [archived],
      openTabs: [tab],
      active: tab,
      bySession: { "omp/s-archived": { ...EMPTY_SESSION } },
    });
    vi.mocked(ipc.listArchivedSessions).mockResolvedValue([archived]);

    await useChatStore.getState().refreshSessions();

    expect(useChatStore.getState().sessions).toEqual([]);
    expect(useChatStore.getState().openTabs).toEqual([]);
    expect(useChatStore.getState().active).toBeNull();
    expect(useChatStore.getState().bySession["omp/s-archived"]).toBeUndefined();
  });
});

describe("setPluginSessionEffort (ctx.sessions.setEffort backend)", () => {
  beforeEach(resetStore);

  it("patches an existing session, persists it, and clears the tab stamp", () => {
    const tab = {
      engine: "codex",
      sessionId: "s-effort",
      workspacePath: WS,
      effort: "low" as const,
    };
    const key = "codex/s-effort";
    useChatStore.setState({
      active: tab,
      openTabs: [tab],
      bySession: { [key]: { ...EMPTY_SESSION } },
    });
    vi.mocked(ipc.rememberSessionEffort).mockClear();

    setPluginSessionEffort("codex", "s-effort", WS, "high");

    expect(useChatStore.getState().bySession[key].activeEffort).toBe("high");
    expect(ipc.rememberSessionEffort).toHaveBeenCalledWith("codex", "s-effort", "high");
    // Stamps cleared so refreshSessions cannot resurrect the old level.
    expect(useChatStore.getState().openTabs[0].effort).toBeUndefined();
    expect(useChatStore.getState().active?.effort).toBeUndefined();
    const persisted = JSON.parse(localStorage.getItem(OPEN_TABS_KEY) ?? "[]");
    expect(persisted[0].effort).toBeUndefined();
  });

  it("rejects unknown sessions instead of minting a ghost entry", () => {
    vi.mocked(ipc.rememberSessionEffort).mockClear();
    expect(() => setPluginSessionEffort("codex", "nope", WS, "high")).toThrow(
      "unknown session",
    );
    expect(useChatStore.getState().bySession["codex/nope"]).toBeUndefined();
    expect(ipc.rememberSessionEffort).not.toHaveBeenCalled();
  });

  it("rejects an empty effort and missing ids", () => {
    const key = "codex/s-effort";
    useChatStore.setState({ bySession: { [key]: { ...EMPTY_SESSION } } });
    expect(() => setPluginSessionEffort("codex", "s-effort", WS, "  ")).toThrow(
      "non-empty",
    );
    expect(() => setPluginSessionEffort("", "s-effort", WS, "high")).toThrow(
      "required",
    );
  });
});
