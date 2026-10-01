import { beforeEach, describe, expect, it, vi } from "vitest";
import { ipc } from "@/lib/ipc";
import { useChatStore } from "./store";
import { handleEngineEvents, type ChatEngineEvent, type EngineEventDeps } from "./store/engine-events";
import { sessionKey } from "./store/persistence";
import { EMPTY_SESSION, runRouting } from "./store/stream";
import { parseUsage } from "./usage";

vi.mock("@/lib/ipc", () => ({
  ipc: {
    usageRecord: vi.fn(async () => {}),
    rescanSessions: vi.fn(async () => {}),
  },
}));
vi.mock("@/lib/events", () => ({
  listenEngineEvents: vi.fn(async () => () => {}),
  listenSessionsChanged: vi.fn(async () => () => {}),
  listenComputerUseEscape: vi.fn(async () => () => {}),
}));

const KEY = sessionKey("codex", "s-1", "/tmp/ws");
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

function event(kind: ChatEngineEvent["kind"], seq: number, data: unknown, engine = "codex"): ChatEngineEvent {
  return { runId, sessionId: "s-1", engine, seq, kind, data };
}

function report(inputTokens: number, outputTokens: number) {
  return { last_token_usage: { input_tokens: inputTokens, output_tokens: outputTokens } };
}

function session() {
  return useChatStore.getState().bySession[KEY]!;
}

describe("usage accounting", () => {
  beforeEach(() => {
    runId = `usage-run-${++runCounter}`;
    localStorage.clear();
    vi.clearAllMocks();
    runRouting.clear();
    runRouting.set(runId, KEY);
    useChatStore.setState({
      openTabs: [],
      active: null,
      bySession: {
        [KEY]: {
          ...EMPTY_SESSION,
          streaming: true,
          messages: [{ seq: 2, role: "assistant", text: "…", live: true, ts: null }],
        },
      },
      streamingByKey: {},
    });
  });

  it("ledgers a mid-turn report as it arrives, and not again when the turn ends", () => {
    // Codex reports each request while the turn runs; the page has to grow
    // with it instead of waiting for the turn to finish.
    handleEngineEvents([event("usage", 2, report(1000, 40))], deps());
    expect(ipc.usageRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        engine: "codex",
        input: 1000,
        output: 40,
        reports: 1,
      }),
    );

    // The turn then settles: its own payload must not add a second row for
    // the same tokens.
    handleEngineEvents([event("done", 9, { usage: null })], deps());
    expect(ipc.usageRecord).toHaveBeenCalledTimes(1);
  });

  it("ledgers a turn that reports once, at the end, exactly once", () => {
    // Claude reports nothing until its result line: that payload is the row.
    handleEngineEvents(
      [event("done", 9, { usage: { input_tokens: 7, output_tokens: 3 } })],
      deps(),
    );
    expect(ipc.usageRecord).toHaveBeenCalledWith(
      expect.objectContaining({ input: 7, output: 3, reports: 1 }),
    );
    expect(ipc.usageRecord).toHaveBeenCalledTimes(1);
  });

  it("sums the reply's reports for the strip and keeps occupancy separate", () => {
    handleEngineEvents([event("usage", 2, report(1000, 40))], deps());
    handleEngineEvents([event("usage", 3, report(500, 10))], deps());
    // The strip counts what this reply spent...
    expect(parseUsage(session().turnUsage)).toMatchObject({ input: 1500, output: 50 });
    // ...while the context meter still reads the newest single report.
    expect(parseUsage(session().usage)).toMatchObject({ input: 500, output: 10 });

    handleEngineEvents([event("done", 9, { usage: report(1500, 50) })], deps());
    // The aggregate in done must not replace the newest context occupancy.
    // The settled row carries the reply's total, and the running counter is
    // gone so the next reply starts from zero.
    const settled = session();
    expect(parseUsage(settled.turnUsage)).toBeNull();
    const assistant = settled.messages.filter((m) => m.role === "assistant").at(-1);
    expect(parseUsage(assistant?.usage)).toMatchObject({ input: 1500, output: 50 });
    expect(parseUsage(settled.usage)).toMatchObject({ input: 500, output: 10 });
  });

  it("records Claude's resolved custom model instead of the selected family alias", () => {
    const tab = { engine: "claude", sessionId: "s-1", workspacePath: "/tmp/ws", model: "haiku" };
    const key = sessionKey(tab.engine, tab.sessionId, tab.workspacePath);
    const model = "gpt-6-astra-cc-format[1m]";
    runRouting.set(runId, key);
    useChatStore.setState({
      active: tab,
      openTabs: [tab],
      models: { claude: "sonnet" },
      bySession: { [key]: { ...EMPTY_SESSION, streaming: true, activeModel: tab.model } },
    });

    handleEngineEvents([
      event("model", 1, model, "claude"),
      event("delta", 2, "Custom model reply", "claude"),
      event("done", 3, { usage: { input_tokens: 7, output_tokens: 3 } }, "claude"),
    ], deps());

    expect(ipc.usageRecord).toHaveBeenCalledWith(expect.objectContaining({
      engine: "claude", model, input: 7, output: 3, reports: 1,
    }));
    expect(ipc.usageRecord).toHaveBeenCalledTimes(1);
    expect(useChatStore.getState().bySession[key]!.messages.at(-1)).toMatchObject({
      role: "assistant", text: "Custom model reply", model, live: false,
    });
    // Keep the selector for the next send: aliases must still follow channel remaps.
    expect(useChatStore.getState().openTabs[0].model).toBe("haiku");
  });

  it("attributes live reports to an observed run even without an open tab", () => {
    useChatStore.setState({ models: { codex: "different-default-model" } });

    handleEngineEvents([
      event("model", 1, "gpt-5.4"),
      event("usage", 2, report(1000, 40)),
      event("done", 3, { usage: null }),
    ], deps());

    expect(ipc.usageRecord).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-5.4", input: 1000, output: 40,
    }));
    expect(ipc.usageRecord).toHaveBeenCalledTimes(1);
  });
});
