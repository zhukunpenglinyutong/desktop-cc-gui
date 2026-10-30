import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import { AGENT_STATUS_ROLE, ipc, type Message, type SessionPage } from "@/lib/ipc";
import { deriveAgentTaskSteps } from "../components/agent-task-steps";
import type { LoadHistoryPage } from "./context";
import { createSessionActions } from "./sessions";
import { EMPTY_SESSION } from "./stream";
import type { ChatStore } from "./types";

const KEY = "omp/session-status";
const TAB = { engine: "omp", sessionId: "session-status", workspacePath: "/tmp/workspace" };

function dispatch(seq = 1, names = ["Worker"], ts: string | null = null): Message {
  return {
    seq, role: "tool", text: "task · Dispatching workers", ts,
    args: { tasks: names.map((name) => ({ name, task: `Implement ${name}` })) },
  };
}

function tool(seq: number, args: unknown, result?: unknown, ts: string | null = null): Message {
  return { seq, role: "tool", text: "hub · Waiting for workers", args, result, ts };
}

function status(seq: number, jobs: Array<{ id: string; status: string }>, ts: string | null = null): Message {
  return { seq, role: AGENT_STATUS_ROLE, text: "", ts, result: { details: { jobs } } };
}

function page(messages: Message[], subagentHistory: Message[] = []): SessionPage {
  return { messages, subagentHistory, nextBefore: null };
}


function setup(messages: Message[] = [dispatch()], subagentHistory: Message[] = []) {
  const store = createStore<ChatStore>(() => ({
    bySession: { [KEY]: { ...EMPTY_SESSION, messages, subagentHistory, nextBefore: 77 } },
    openTabs: [TAB], active: TAB, activeEngine: "omp", sessions: [], unseen: {}, providers: {}, models: {},
    restoredSessionKeys: { [KEY]: true }, streamingByKey: {}, retryingByKey: {},
  }) as unknown as ChatStore);
  const loadHistoryPage = vi.fn<LoadHistoryPage>(async () => page([]));
  const actions = createSessionActions({
    set: store.setState,
    get: store.getState,
    loadHistoryPage,
    eventTeardowns: [],
    activateTab: vi.fn(),
    removeTab: vi.fn(),
    forgetClosedTab: vi.fn(),
    drainQueue: vi.fn(),
    markUnseenIfBackground: vi.fn(),
    turnSettled: vi.fn(),
  });
  store.setState(actions);
  return { store, actions, loadHistoryPage };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("refreshSubagentStatus", () => {
  it.each(["no session", "no tab", "streaming", "streaming flag", "no delegation"])(
    "does not read history with %s",
    async (reason) => {
      const { store, actions, loadHistoryPage } = setup();
      const session = store.getState().bySession[KEY];
      if (reason === "no session") store.setState({ bySession: {} });
      if (reason === "no tab") store.setState({ openTabs: [] });
      if (reason === "streaming") store.setState({ bySession: { [KEY]: { ...session, streaming: true } } });
      if (reason === "streaming flag") store.setState({ streamingByKey: { [KEY]: true } });
      if (reason === "no delegation") {
        store.setState({ bySession: { [KEY]: { ...session, messages: [{ seq: 1, role: "assistant", text: "Ordinary reply", ts: null }] } } });
      }

      await actions.refreshSubagentStatus(KEY);

      expect(loadHistoryPage).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("reads the latest page for cached-session selection and preserves history paging", async () => {
    const original: Message[] = [dispatch(), { seq: 2, role: "assistant", text: "I will wait", ts: null }];
    const { store, actions, loadHistoryPage } = setup(original);
    const pending = Promise.withResolvers<SessionPage>();
    loadHistoryPage.mockReturnValueOnce(pending.promise);

    await actions.selectSession(TAB.engine, TAB.sessionId, TAB.workspacePath);
    expect(loadHistoryPage).toHaveBeenCalledWith("omp", "session-status", "/tmp/workspace", 100);
    const refresh = actions.refreshSubagentStatus(KEY);
    pending.resolve(page([
      { seq: 90, role: "assistant", text: "Do not replace the cached reply", ts: null },
      status(91, [{ id: "Worker", status: "completed" }], "2026-10-28T00:00:01Z"),
    ]));
    await refresh;

    const session = store.getState().bySession[KEY];
    expect(loadHistoryPage).toHaveBeenCalledTimes(1);
    expect(session.messages.slice(0, 2)).toEqual(original);
    expect(session.messages[0]).toBe(original[0]);
    expect(session.messages[2]).toMatchObject({ role: AGENT_STATUS_ROLE, seq: 92 });
    expect(session.nextBefore).toBe(77);
    expect(session.loading).toBe(false);
    expect(deriveAgentTaskSteps(session.messages, false, "omp")[0].state).toBe("complete");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(loadHistoryPage).toHaveBeenCalledTimes(1);
  });

  it("refreshes status after loading an uncached session", async () => {
    vi.spyOn(ipc, "listPlanReviews").mockResolvedValue([]);
    const { store, actions, loadHistoryPage } = setup([]);
    const refresh = Promise.withResolvers<SessionPage>();
    loadHistoryPage
      .mockResolvedValueOnce(page([
        dispatch(),
        { seq: 2, role: "assistant", text: "Restored reply", ts: null },
      ]))
      .mockReturnValueOnce(refresh.promise);

    await actions.selectSession(TAB.engine, TAB.sessionId, TAB.workspacePath);
    expect(loadHistoryPage).toHaveBeenCalledTimes(2);
    refresh.resolve(page([
      status(3, [{ id: "Worker", status: "completed" }], "2026-10-28T00:00:03Z"),
    ]));
    await Promise.resolve();

    const messages = store.getState().bySession[KEY].messages;
    expect(messages).toHaveLength(3);
    expect(messages[2]).toMatchObject({ role: AGENT_STATUS_ROLE, ts: "2026-10-28T00:00:03Z" });
    expect(deriveAgentTaskSteps(messages, false, "omp")[0].state).toBe("complete");
  });

  it("uses delegation metadata outside the visible page", async () => {
    const { store, actions, loadHistoryPage } = setup(
      [{ seq: 40, role: "assistant", text: "Latest reply", ts: null }],
      [dispatch()],
    );
    const history = store.getState().bySession[KEY].subagentHistory;
    loadHistoryPage.mockResolvedValueOnce(page([status(41, [{ id: "Worker", status: "idle" }])]));

    await actions.refreshSubagentStatus(KEY);

    const session = store.getState().bySession[KEY];
    expect(loadHistoryPage).toHaveBeenCalledTimes(1);
    expect(session.subagentHistory).toBe(history);
    expect(session.messages).toHaveLength(2);
    expect(deriveAgentTaskSteps([...session.subagentHistory, ...session.messages], false, "omp")[0].state).toBe("complete");
  });

  it("accepts a wait reference as delegation evidence, not as a state assertion", async () => {
    const { store, actions, loadHistoryPage } = setup([tool(1, { op: "wait", ids: ["Worker"] })]);
    loadHistoryPage.mockResolvedValueOnce(page([status(2, [{ id: "Worker", status: "parked" }])]));

    await actions.refreshSubagentStatus(KEY);

    expect(store.getState().bySession[KEY].messages.at(-1)?.role).toBe(AGENT_STATUS_ROLE);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shares concurrent reads for the same session", async () => {
    const { actions, loadHistoryPage } = setup();
    const pending = Promise.withResolvers<SessionPage>();
    loadHistoryPage.mockReturnValueOnce(pending.promise);

    const first = actions.refreshSubagentStatus(KEY);
    const second = actions.refreshSubagentStatus(KEY);

    expect(second).toBe(first);
    expect(loadHistoryPage).toHaveBeenCalledTimes(1);
    pending.resolve(page([status(2, [{ id: "Worker", status: "completed" }])]));
    await Promise.all([first, second]);
  });

  it("serializes a fresh refresh after cancelling an in-flight read", async () => {
    const { store, actions, loadHistoryPage } = setup();
    const stale = Promise.withResolvers<SessionPage>();
    const fresh = Promise.withResolvers<SessionPage>();
    loadHistoryPage.mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise);

    const first = actions.refreshSubagentStatus(KEY);
    actions.cancelSubagentStatusRefresh(KEY);
    const afterCancel = actions.refreshSubagentStatus(KEY);

    expect(loadHistoryPage).toHaveBeenCalledTimes(1);
    stale.resolve(page([status(2, [{ id: "Worker", status: "running" }])]));
    await first;

    expect(loadHistoryPage).toHaveBeenCalledTimes(2);
    expect(store.getState().bySession[KEY].messages).toHaveLength(1);
    fresh.resolve(page([status(3, [{ id: "Worker", status: "completed" }])]));
    await afterCancel;

    const messages = store.getState().bySession[KEY].messages;
    expect(messages).toHaveLength(2);
    expect(messages[1].result).toEqual({
      details: { jobs: [{ id: "Worker", status: "completed" }] },
    });
  });

  it("reads status rows folded into subagent history outside the visible page", async () => {
    const { store, actions, loadHistoryPage } = setup();
    loadHistoryPage.mockResolvedValueOnce(page(
      [{ seq: 101, role: "assistant", text: "Recent turn", ts: null }],
      [dispatch(), status(2, [{ id: "Worker", status: "completed" }], "2026-10-28T00:00:02Z")],
    ));

    await actions.refreshSubagentStatus(KEY);

    const messages = store.getState().bySession[KEY].messages;
    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({ role: AGENT_STATUS_ROLE, ts: "2026-10-28T00:00:02Z" });
    expect(deriveAgentTaskSteps(messages, false, "omp")[0].state).toBe("complete");
  });

  it("does not serialize reads for different sessions", async () => {
    const { store, actions, loadHistoryPage } = setup();
    const otherKey = "omp/other-session";
    store.setState({
      openTabs: [TAB, { ...TAB, sessionId: "other-session" }],
      bySession: { ...store.getState().bySession, [otherKey]: { ...EMPTY_SESSION, messages: [dispatch()] } },
    });
    const firstPage = Promise.withResolvers<SessionPage>();
    const otherPage = Promise.withResolvers<SessionPage>();
    loadHistoryPage.mockReturnValueOnce(firstPage.promise).mockReturnValueOnce(otherPage.promise);

    const first = actions.refreshSubagentStatus(KEY);
    const other = actions.refreshSubagentStatus(otherKey);

    expect(loadHistoryPage).toHaveBeenCalledTimes(2);
    firstPage.resolve(page([status(2, [{ id: "Worker", status: "completed" }])]));
    otherPage.resolve(page([status(2, [{ id: "Worker", status: "failed" }])]));
    await Promise.all([first, other]);
    expect(store.getState().bySession[otherKey].messages).toHaveLength(2);
  });

  it("discards an in-flight page when the messages reference changes", async () => {
    const { store, actions, loadHistoryPage } = setup();
    const pending = Promise.withResolvers<SessionPage>();
    loadHistoryPage.mockReturnValueOnce(pending.promise);
    const request = actions.refreshSubagentStatus(KEY);
    const current = store.getState().bySession[KEY];
    const messages = [...current.messages];
    store.setState({ bySession: { [KEY]: { ...current, messages } } });

    pending.resolve(page([status(2, [{ id: "Worker", status: "completed" }])]));
    await request;

    expect(store.getState().bySession[KEY].messages).toBe(messages);
    expect(messages).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1);
  });

  it.each(["session", "flag"])("discards an in-flight page when the %s starts streaming", async (source) => {
    const { store, actions, loadHistoryPage } = setup();
    const pending = Promise.withResolvers<SessionPage>();
    loadHistoryPage.mockReturnValueOnce(pending.promise);
    const messages = store.getState().bySession[KEY].messages;
    const request = actions.refreshSubagentStatus(KEY);
    if (source === "session") {
      store.setState({ bySession: { [KEY]: { ...store.getState().bySession[KEY], streaming: true } } });
    } else {
      store.setState({ streamingByKey: { [KEY]: true } });
    }

    pending.resolve(page([status(2, [{ id: "Worker", status: "completed" }])]));
    await request;
    await vi.advanceTimersByTimeAsync(60_000);

    expect(store.getState().bySession[KEY].messages).toBe(messages);
    expect(loadHistoryPage).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("discards a response after its tab closes", async () => {
    const { store, actions, loadHistoryPage } = setup();
    const pending = Promise.withResolvers<SessionPage>();
    loadHistoryPage.mockReturnValueOnce(pending.promise);
    const request = actions.refreshSubagentStatus(KEY);
    const messages = store.getState().bySession[KEY].messages;
    store.setState({ openTabs: [] });

    pending.resolve(page([status(2, [{ id: "Worker", status: "completed" }])]));
    await request;

    expect(store.getState().bySession[KEY].messages).toBe(messages);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("serializes a post-cancel refresh behind the in-flight history read", async () => {
    const { store, actions, loadHistoryPage } = setup();
    const first = Promise.withResolvers<SessionPage>();
    const second = Promise.withResolvers<SessionPage>();
    loadHistoryPage
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const initial = actions.refreshSubagentStatus(KEY);
    store.setState({
      bySession: { [KEY]: { ...store.getState().bySession[KEY], streaming: true } },
      streamingByKey: { [KEY]: true },
    });
    actions.cancelSubagentStatusRefresh(KEY);
    store.setState({
      bySession: { [KEY]: { ...store.getState().bySession[KEY], streaming: false } },
      streamingByKey: {},
    });

    const restarted = actions.refreshSubagentStatus(KEY);
    expect(loadHistoryPage).toHaveBeenCalledTimes(1);

    first.resolve(page([status(2, [{ id: "Worker", status: "running" }])]));
    await initial;
    expect(loadHistoryPage).toHaveBeenCalledTimes(2);
    expect(store.getState().bySession[KEY].messages).toEqual([dispatch()]);

    second.resolve(page([status(3, [{ id: "Worker", status: "completed" }])]));
    await restarted;
    expect(loadHistoryPage).toHaveBeenCalledTimes(2);
    expect(deriveAgentTaskSteps(store.getState().bySession[KEY].messages, false, "omp")[0].state)
      .toBe("complete");
  });

  it("deduplicates timestamped rows even when transcript seq or payload changes", async () => {
    const timestamp = "2026-10-28T00:00:01Z";
    const existing = status(3, [{ id: "Worker", status: "completed" }], timestamp);
    const { store, actions, loadHistoryPage } = setup([dispatch(), existing]);
    loadHistoryPage.mockResolvedValue(page([
      status(100, [{ id: "Worker", status: "running" }], timestamp),
      status(101, [{ id: "Worker", status: "completed" }], "2026-10-28T00:00:02Z"),
    ]));

    await actions.refreshSubagentStatus(KEY);
    await actions.refreshSubagentStatus(KEY);

    const rows = store.getState().bySession[KEY].messages;
    expect(rows).toHaveLength(3);
    expect(rows[1]).toBe(existing);
    expect(rows[2]).toMatchObject({ seq: 102, ts: "2026-10-28T00:00:02Z" });
  });

  it("falls back to the original signature after filtering and resequencing a row", async () => {
    const original = status(2, [{ id: "Worker", status: "completed" }, { id: "Other", status: "completed" }]);
    const { store, actions, loadHistoryPage } = setup([dispatch(1, ["Worker", "Other"]), dispatch(3)]);
    loadHistoryPage.mockResolvedValue(page([original]));

    await actions.refreshSubagentStatus(KEY);
    await actions.refreshSubagentStatus(KEY);

    const rows = store.getState().bySession[KEY].messages;
    expect(rows).toHaveLength(3);
    expect(rows[2].result).toEqual({ details: { jobs: [{ id: "Other", status: "completed" }] } });
    expect(rows[2].seq).toBe(4);
  });

  it("does not use synthetic append sequences to supersede newer timestamp-less rows", async () => {
    const { store, actions, loadHistoryPage } = setup();
    loadHistoryPage
      .mockResolvedValueOnce(page([status(2, [{ id: "Worker", status: "running" }])]))
      .mockResolvedValueOnce(page([status(3, [{ id: "Worker", status: "completed" }])]));

    await actions.refreshSubagentStatus(KEY);
    await actions.refreshSubagentStatus(KEY);

    const rows = store.getState().bySession[KEY].messages;
    expect(rows.map((row) => row.seq)).toEqual([1, 3, 4]);
    expect(deriveAgentTaskSteps(rows, false, "omp")[0].state).toBe("complete");
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["jobs", "peers", "progress"])("drops jobs superseded by newer %s state evidence", async (bucket) => {
    const evidence = tool(4, { op: "wait" }, { details: { [bucket]: [{ id: "Worker", status: "running" }] } });
    const { store, actions, loadHistoryPage } = setup([dispatch(1, ["Worker", "Other"]), evidence]);
    loadHistoryPage.mockResolvedValueOnce(page([
      status(3, [{ id: "Worker", status: "completed" }, { id: "Other", status: "completed" }]),
    ]));

    await actions.refreshSubagentStatus(KEY);

    expect(store.getState().bySession[KEY].messages.at(-1)?.result)
      .toEqual({ details: { jobs: [{ id: "Other", status: "completed" }] } });
  });

  it("also checks newer evidence in the fetched transcript without appending ordinary rows", async () => {
    const { store, actions, loadHistoryPage } = setup();
    const evidence = tool(4, { op: "wait" }, { details: { jobs: [{ id: "Worker", status: "running" }] } });
    loadHistoryPage.mockResolvedValueOnce(page([status(3, [{ id: "Worker", status: "completed" }]), evidence]));

    await actions.refreshSubagentStatus(KEY);

    expect(store.getState().bySession[KEY].messages).toEqual([dispatch()]);
  });

  it("drops delivery jobs superseded by a newer dispatch", async () => {
    const { store, actions, loadHistoryPage } = setup([dispatch(1), dispatch(4)]);
    loadHistoryPage.mockResolvedValueOnce(page([status(3, [{ id: "Worker", status: "completed" }])]));

    await actions.refreshSubagentStatus(KEY);

    expect(store.getState().bySession[KEY].messages).toHaveLength(2);
  });

  it.each(["wait ids", "unknown status"])("does not treat %s as newer state evidence", async (kind) => {
    const evidence = kind === "wait ids"
      ? tool(4, { op: "wait", ids: ["Worker"] })
      : tool(4, { op: "wait" }, { details: { jobs: [{ id: "Worker", status: "mystery" }] } });
    const { store, actions, loadHistoryPage } = setup([dispatch(), evidence]);
    loadHistoryPage.mockResolvedValueOnce(page([status(3, [{ id: "Worker", status: "completed" }])]));

    await actions.refreshSubagentStatus(KEY);

    expect(store.getState().bySession[KEY].messages.at(-1)?.role).toBe(AGENT_STATUS_ROLE);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("compares transcript timestamps by instant rather than synthetic seq or lexical offset", async () => {
    const evidence = tool(500, { op: "wait" }, { details: { jobs: [{ id: "Worker", status: "running" }] } }, "2026-10-28T08:00:01+08:00");
    const { store, actions, loadHistoryPage } = setup([dispatch(), evidence]);
    loadHistoryPage.mockResolvedValueOnce(page([
      status(3, [{ id: "Worker", status: "completed" }], "2026-10-28T00:00:02Z"),
    ]));

    await actions.refreshSubagentStatus(KEY);

    expect(store.getState().bySession[KEY].messages.at(-1)).toMatchObject({ role: AGENT_STATUS_ROLE, seq: 501 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("continues polling active agents every 30 seconds after the initial backoff", async () => {
    const { store, actions, loadHistoryPage } = setup();
    await actions.refreshSubagentStatus(KEY);
    expect(loadHistoryPage).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(loadHistoryPage).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(loadHistoryPage).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(loadHistoryPage).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(loadHistoryPage).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1);
    expect(loadHistoryPage).toHaveBeenCalledTimes(5);
    expect(vi.getTimerCount()).toBe(1);

    loadHistoryPage.mockResolvedValueOnce(page([
      status(2, [{ id: "Worker", status: "completed" }], "2026-10-28T00:00:01Z"),
    ]));
    await vi.advanceTimersByTimeAsync(30_000);

    expect(loadHistoryPage).toHaveBeenCalledTimes(6);
    expect(deriveAgentTaskSteps(store.getState().bySession[KEY].messages, false, "omp")[0].state)
      .toBe("complete");
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["completed", "failed", "cancelled", "idle", "parked"])("stops retrying when agents converge to %s", async (state) => {
    const { actions, loadHistoryPage } = setup();
    loadHistoryPage
      .mockResolvedValueOnce(page([status(2, [{ id: "Worker", status: "running" }], "2026-10-28T00:00:01Z")]))
      .mockResolvedValueOnce(page([status(3, [{ id: "Worker", status: state }], "2026-10-28T00:00:02Z")]));

    await actions.refreshSubagentStatus(KEY);
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(120_000);

    expect(loadHistoryPage).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["session", "flag"])("stops a scheduled retry when the %s starts streaming", async (source) => {
    const { store, actions, loadHistoryPage } = setup();
    loadHistoryPage.mockRejectedValueOnce(new Error("Transcript still being flushed"));
    await actions.refreshSubagentStatus(KEY);
    expect(vi.getTimerCount()).toBe(1);
    if (source === "session") {
      store.setState({ bySession: { [KEY]: { ...store.getState().bySession[KEY], streaming: true } } });
    } else {
      store.setState({ streamingByKey: { [KEY]: true } });
    }

    await vi.advanceTimersByTimeAsync(120_000);

    expect(loadHistoryPage).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
