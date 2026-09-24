import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import type { EngineEventPayload } from "@/lib/events";
import type { Message } from "@/lib/ipc";
import type { ChatStore } from "../store";
import { handleEngineEvents, settledRuns, type EngineEventDeps } from "./engine-events";
import { appendToolMessage, drainPending, EMPTY_SESSION, flushPendingStreams, runRouting } from "./stream";

vi.mock("@/lib/ipc", () => ({ ipc: { rescanSessions: vi.fn(async () => {}) } }));

const KEY = "codex/first";
const OTHER = "codex/second";

function setup(messages: Message[] = []) {
  const store = createStore<ChatStore>(() => ({
    bySession: {
      // Pre-claimed by their runs, as any real active turn is (sendPrompt or
      // the observed-run adoption claims on the first content frame): these
      // tests measure batch-commit work, not the adoption path, and an
      // unclaimed fixture would let the first message pay a claim write.
      [KEY]: { ...EMPTY_SESSION, streaming: true, currentRunId: "run-first", messages },
      [OTHER]: { ...EMPTY_SESSION, streaming: true, currentRunId: "run-second" },
    },
    streamingByKey: { [KEY]: true, [OTHER]: true },
    retryingByKey: {},
    models: {},
    efforts: {},
    openTabs: [{ engine: "codex", sessionId: "first", workspacePath: "/tmp/ws" }],
    active: null,
    drafts: {},
    archivedSessionKeys: {},
  }) as unknown as ChatStore);
  const set = vi.fn<EngineEventDeps["set"]>((update) => store.setState(update));
  const changed = vi.fn();
  store.subscribe(changed);
  const deps: EngineEventDeps = {
    set,
    get: store.getState,
    drainQueue: vi.fn(),
    markUnseenIfBackground: vi.fn(),
    upsertSessionMeta: vi.fn(),
  };
  runRouting.set("run-first", KEY);
  runRouting.set("run-second", OTHER);
  return { store, deps, set, changed };
}

function event(kind: EngineEventPayload["kind"], data: unknown, second = false): EngineEventPayload {
  return { kind, data, engine: "codex", sessionId: second ? "second" : "first", runId: second ? "run-second" : "run-first", seq: 1 };
}

function tool(text: string, extra: Record<string, unknown> = {}, second = false) {
  return event("message", { role: "tool", text, ...extra }, second);
}

beforeEach(() => {
  vi.useFakeTimers();
  runRouting.clear();
  settledRuns.clear();
  drainPending(KEY);
  drainPending(OTHER);
});

afterEach(() => {
  vi.runAllTimers();
  vi.useRealTimers();
});

describe("ordered tool batches", () => {
  it("commits 128 starts, args and results once with bounded history work", () => {
    let reads = 0;
    const history = Array.from({ length: 256 }, (_, index): Message => new Proxy({
      seq: index + 1, role: "user", text: "history", ts: null,
    }, { get(target, property, receiver) { reads++; return Reflect.get(target, property, receiver); } }));
    const { store, deps, set, changed } = setup(history);
    const events = Array.from({ length: 128 }, () => tool("Read"));
    events.push(...Array.from({ length: 128 }, (_, index) => tool("Read", { patch: true, args: { index }, path: `/tmp/${index}` })));
    events.push(...Array.from({ length: 128 }, () => tool("Read", { patch: true, result: "ok" })));
    let copiedRows = 0;
    const isMessage = (value: unknown) => value !== null && typeof value === "object" && "role" in value && "seq" in value;
    const slice = Array.prototype.slice;
    const iterate = Array.prototype[Symbol.iterator];
    const sliceSpy = vi.spyOn(Array.prototype, "slice").mockImplementation(function (this: unknown[], start, end) {
      const result = slice.call(this, start, end);
      if (isMessage(result[0])) copiedRows += result.length;
      return result;
    });
    const iteratorSpy = vi.spyOn(Array.prototype, Symbol.iterator).mockImplementation(function (this: unknown[]) {
      const iterator = iterate.call(this);
      const next = iterator.next.bind(iterator);
      iterator.next = () => {
        const step = next();
        if (!step.done && isMessage(step.value)) copiedRows++;
        return step;
      };
      return iterator;
    });
    try {
      handleEngineEvents(events, deps);
    } finally {
      sliceSpy.mockRestore();
      iteratorSpy.mockRestore();
    }
    const work = reads;
    const messages = store.getState().bySession[KEY].messages;
    expect(messages).toHaveLength(384);
    history.forEach((message, index) => expect(messages[index]).toBe(message));
    expect(messages.slice(256).map((message) => message.args)).toEqual(Array.from({ length: 128 }, (_, index) => ({ index })));
    expect(messages[383].result).toBe("ok");
    expect(messages[382].result).toBeUndefined();
    expect.soft(set).toHaveBeenCalledTimes(1);
    expect.soft(changed).toHaveBeenCalledTimes(1);
    expect(work).toBeLessThanOrEqual(history.length * 8);
    expect(copiedRows).toBeLessThanOrEqual(history.length * 2);
  });

  it("does not notify or replace references for duplicate results and unmatched args", () => {
    const row: Message = { seq: 1, role: "tool", text: "Read", ts: null, args: {}, result: "ok" };
    const { store, deps, changed } = setup([row]);
    const before = store.getState();
    appendToolMessage(deps.set, KEY, "Read", null, null, null, undefined, true, "ok");
    appendToolMessage(deps.set, KEY, "Missing", null, null, null, {}, true);
    appendToolMessage(deps.set, KEY, "Missing", null, null, null, undefined, true, "absent");
    expect(store.getState()).toBe(before);
    expect(changed).not.toHaveBeenCalled();
  });

  it("deduplicates independently decoded results without hiding nested changes", () => {
    const result = { content: [{ type: "text", text: "ok" }], isError: false };
    const row: Message = { seq: 1, role: "tool", text: "Read", ts: null, args: {}, result };
    const { store, deps, changed } = setup([row]);
    const before = store.getState();
    handleEngineEvents([tool("Read", { patch: true, result: structuredClone(result) })], deps);
    expect(store.getState()).toBe(before);
    expect(changed).not.toHaveBeenCalled();
    handleEngineEvents([tool("Read", { patch: true, result: { ...result, content: [{ type: "text", text: "changed" }] } })], deps);
    expect(store.getState().bySession[KEY].messages[0].result).toEqual({ content: [{ type: "text", text: "changed" }], isError: false });
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("keeps a 128-event no-op batch reference stable with bounded tool-history reads", () => {
    let reads = 0;
    const messages = Array.from({ length: 128 }, (_, index): Message => new Proxy({
      seq: index + 1, role: "tool", text: "Read", ts: null, args: {}, result: "ok",
    }, { get(target, property, receiver) { reads++; return Reflect.get(target, property, receiver); } }));
    const { store, deps, set, changed } = setup(messages);
    const before = store.getState();
    handleEngineEvents(Array.from({ length: 128 }, (_, index) => index % 2
      ? tool("Missing", { patch: true, args: {} })
      : tool("Read", { patch: true, result: "ok" })), deps);
    expect(store.getState()).toBe(before);
    expect(set).toHaveBeenCalledTimes(1);
    expect(changed).not.toHaveBeenCalled();
    expect(reads).toBeLessThanOrEqual(messages.length * 10);
  });

  it("adopts an observed run once before a 128-tool batch", () => {
    const { store, deps, set } = setup();
    runRouting.delete("run-first");
    store.setState((state) => ({ bySession: { ...state.bySession, [KEY]: { ...EMPTY_SESSION } }, streamingByKey: {} }));
    handleEngineEvents(Array.from({ length: 128 }, () => tool("Read")), deps);
    expect(store.getState().bySession[KEY].messages).toHaveLength(128);
    expect(store.getState().bySession[KEY].streaming).toBe(true);
    expect(store.getState().streamingByKey[KEY]).toBe(true);
    expect(runRouting.get("run-first")).toBe(KEY);
    expect(set).toHaveBeenCalledTimes(3);
  });

  it("preserves oldest empty args and latest substring result matching", () => {
    const { store, deps } = setup();
    handleEngineEvents([
      tool("Read"), tool("Read"), tool("ReadFile"),
      tool("Read", { patch: true, args: { first: true } }),
      tool("Read", { patch: true, args: { second: true } }),
      tool("Read", { patch: true, args: { ignored: true } }),
      tool("Read", { patch: true, result: "substring" }),
      tool("", { patch: true, result: "latest" }),
    ], deps);
    expect(store.getState().bySession[KEY].messages).toMatchObject([
      { text: "Read", args: { first: true } },
      { text: "Read", args: { second: true } },
      { text: "ReadFile", result: "latest" },
    ]);
  });

  it("refreshes cached result targets only when a later matching tool arrives", () => {
    const { store, deps } = setup();
    handleEngineEvents([
      tool("Read", { patch: true, result: "unmatched" }),
      tool("Read"), tool("Read", { patch: true, result: "first" }),
      tool("Write"), tool("Read", { patch: true, result: "updated first" }),
      tool("ReadFile"), tool("Read", { patch: true, result: "last" }),
      event("message", { role: "tool_result", text: "", patch: true, result: null }),
    ], deps);
    expect(store.getState().bySession[KEY].messages).toMatchObject([
      { text: "Read", result: "updated first" }, { text: "Write" }, { text: "ReadFile", result: null },
    ]);
  });

  it("preserves path, todos and unchanged rows while applying meaningful patches", () => {
    const result = { output: "ok" };
    const todos = { items: [], replace: true };
    const stable: Message = Object.freeze({ seq: 1, role: "tool", text: "Write", ts: null, args: {}, result });
    const read: Message = Object.freeze({ seq: 2, role: "tool", text: "Read", ts: null, path: "original", result });
    const original = [stable, read];
    Object.freeze(original);
    const { store, deps } = setup(original);
    handleEngineEvents([
      tool("Write", { patch: true, result }),
      tool("Read", { patch: true, args: null, path: "updated" }),
      tool("Read", { patch: true, args: { file: "updated" }, path: null }),
      tool("Read", { patch: true, result, todos }),
    ], deps);
    const messages = store.getState().bySession[KEY].messages;
    expect(messages[0]).toBe(stable);
    expect(messages[1]).toMatchObject({ path: "updated", args: { file: "updated" }, result, todos });
    expect(original[1].path).toBe("original");
    expect(store.getState().bySession[OTHER].messages).toBe(EMPTY_SESSION.messages);
  });

  it.each(["done", "error"] as const)("flushes mixed channels before %s and rejects late tools", (terminal) => {
    const { store, deps } = setup();
    handleEngineEvents([
      event("thinking", "reason"), event("delta", "before"),
      tool("Read"), tool("Read", { patch: true, args: { path: "file" } }),
      event("delta", "between"), tool("Read", { patch: true, result: "ok" }),
      event("delta", "after"), event(terminal, terminal === "done" ? { usage: null } : "failure"),
      tool("Late"), event("delta", "late"),
    ], deps);
    flushPendingStreams(deps.set);
    const session = store.getState().bySession[KEY];
    expect(session.messages.map(({ role, text }) => [role, text])).toEqual([
      ["thinking", "reason"], ["assistant", "before"], ["tool", "Read"], ["assistant", "between"], ["assistant", "after"],
    ]);
    expect(session.messages.every((message) => !message.live)).toBe(true);
    expect(session.messages[2]).toMatchObject({ args: { path: "file" }, result: "ok" });
    expect(session.streaming).toBe(false);
    expect(session.error).toBe(terminal === "error" ? "failure" : null);
    expect(runRouting.has("run-first")).toBe(false);
    expect(deps.drainQueue).toHaveBeenCalledTimes(1);
  });

  it("keeps interleaved sessions isolated and publishes before queue draining", () => {
    const { store, deps } = setup();
    const snapshots: string[][] = [];
    deps.drainQueue = () => snapshots.push(store.getState().bySession[KEY].messages.map((message) => message.text));
    handleEngineEvents([
      tool("Read"), tool("Write", {}, true),
      tool("Read", { patch: true, args: { first: true } }),
      event("done", { usage: null }), tool("Write", { patch: true, result: "second" }, true),
    ], deps);
    expect(snapshots).toEqual([["Read"]]);
    expect(store.getState().bySession[KEY].messages).toMatchObject([{ text: "Read", args: { first: true } }]);
    expect(store.getState().bySession[OTHER].messages).toMatchObject([{ text: "Write", result: "second" }]);
    expect(store.getState().bySession[OTHER].streaming).toBe(true);
  });

  it.each(["done", "error"] as const)("keeps an interrupted queue parked at %s", (terminal) => {
    const { store, deps } = setup();
    const queue = [{ id: "queued", text: "next", images: [], queuedAt: 1 }];
    store.setState((state) => ({ bySession: { ...state.bySession, [KEY]: { ...state.bySession[KEY], interrupted: true, queue } } }));
    handleEngineEvents([tool("Read"), event(terminal, terminal === "done" ? { usage: null } : "stopped"), tool("Late")], deps);
    expect(store.getState().bySession[KEY].messages.map((message) => message.text)).toEqual(["Read"]);
    expect(store.getState().bySession[KEY].queue).toBe(queue);
    expect(deps.drainQueue).not.toHaveBeenCalled();
  });

  it("flushes before retry, model changes and assistant snapshots", () => {
    const { store, deps } = setup();
    handleEngineEvents([
      tool("Read"), event("retry", { attempt: 1, max: 3, message: "retrying" }),
      tool("Write"), event("model", "new-model"), event("delta", "new text"),
      tool("Read"), event("message", { role: "assistant", text: "snapshot" }),
      tool("Write"),
    ], deps);
    const session = store.getState().bySession[KEY];
    expect(session.retry).toBeNull();
    expect(session.messages.map((message) => message.text)).toEqual(["Read", "Write", "new text", "Read", "snapshot", "Write"]);
    expect(session.messages[2].model).toBe("new-model");
    expect(session.messages[4].model).toBe("new-model");
  });

  it("flushes tools before pending-session migration and routes subsequent patches", () => {
    const { store, deps } = setup();
    const pendingKey = "new:codex:/tmp/ws";
    store.setState({
      bySession: { [pendingKey]: { ...EMPTY_SESSION, streaming: true } },
      openTabs: [{ engine: "codex", sessionId: null, workspacePath: "/tmp/ws" }],
      streamingByKey: { [pendingKey]: true },
    });
    runRouting.set("run-first", pendingKey);
    handleEngineEvents([
      { ...tool("Read"), sessionId: null }, event("session", "first"),
      tool("Read", { patch: true, args: { migrated: true } }),
    ], deps);
    expect(store.getState().bySession[pendingKey]).toBeUndefined();
    expect(store.getState().bySession[KEY].messages).toMatchObject([{ text: "Read", args: { migrated: true } }]);
    expect(runRouting.get("run-first")).toBe(KEY);
  });

  it("keeps late events from a settled run out of a newer run in the same session", () => {
    const { store, deps } = setup();
    handleEngineEvents([
      tool("Read"), event("done", { usage: null }),
      { ...tool("Write"), runId: "new-run" }, tool("Read", { patch: true, result: "late" }),
      { ...tool("Write", { patch: true, result: "new" }), runId: "new-run" },
    ], deps);
    const session = store.getState().bySession[KEY];
    expect(session.messages).toMatchObject([{ text: "Read" }, { text: "Write", result: "new" }]);
    expect(session.messages[0].result).toBeUndefined();
    expect(session.streaming).toBe(true);
    expect(runRouting.get("new-run")).toBe(KEY);
  });

  it("still drains pending text and settles live rows for an unmatched patch", () => {
    const { store, deps } = setup();
    handleEngineEvents([event("delta", "visible"), tool("Missing", { patch: true, args: {} })], deps);
    expect(store.getState().bySession[KEY].messages).toMatchObject([{ role: "assistant", text: "visible", live: false }]);
    expect(drainPending(KEY)).toBeNull();
  });
});
