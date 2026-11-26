import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChatStore } from "./store";
import { handleEngineEvents, type ChatEngineEvent, type EngineEventDeps } from "./store/engine-events";
import { sessionKey } from "./store/persistence";
import { EMPTY_SESSION, runRouting } from "./store/stream";
import { parseUsage } from "./usage";

vi.mock("@/lib/ipc", () => ({
  ipc: {
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

  it("stamps Claude's resolved custom model instead of the selected family alias", () => {
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

    expect(useChatStore.getState().bySession[key]!.messages.at(-1)).toMatchObject({
      role: "assistant", text: "Custom model reply", model, live: false,
    });
    // Keep the selector for the next send: aliases must still follow channel remaps.
    expect(useChatStore.getState().openTabs[0].model).toBe("haiku");
  });

  it("keeps OMP ACP context occupancy separate from multi-step billed turn totals", () => {
    const ompKey = sessionKey("omp", "s-omp", "/tmp/ws");
    const ompRun = `usage-run-${++runCounter}`;
    runRouting.set(ompRun, ompKey);
    useChatStore.setState({
      bySession: {
        [ompKey]: {
          ...EMPTY_SESSION,
          streaming: true,
          messages: [{ seq: 2, role: "assistant", text: "done", live: true, ts: null }],
        },
      },
    });
    const acpUsage = {
      inputTokens: 120_000,
      outputTokens: 4_500,
      cacheRead: 180_000,
      cacheWrite: 15_000,
      totalTokens: 319_500,
      model_context_window: 256_000,
      context_usage: {
        input_tokens: 42_000,
        total_tokens: 42_000,
        model_context_window: 256_000,
      },
    };
    const ompEvent = (kind: ChatEngineEvent["kind"], seq: number, data: unknown): ChatEngineEvent => ({
      runId: ompRun,
      sessionId: "s-omp",
      engine: "omp",
      seq,
      kind,
      data,
    });

    handleEngineEvents(
      [
        ompEvent("usage", 2, acpUsage),
        ompEvent("done", 3, { usage: acpUsage }),
      ],
      deps(),
    );

    const settled = useChatStore.getState().bySession[ompKey]!;
    // Context meter reads real window occupancy (42k / 256k), not the 319.5k multi-step sum.
    expect(parseUsage(settled.usage)).toMatchObject({
      total: 42_000,
      contextWindow: 256_000,
    });
    // Assistant message row keeps the multi-step billed breakdown.
    const assistant = settled.messages.filter((m) => m.role === "assistant").at(-1);
    expect(parseUsage(assistant?.usage)).toMatchObject({
      input: 120_000,
      output: 4_500,
      cacheRead: 180_000,
      cacheWrite: 15_000,
      total: 319_500,
      contextWindow: 256_000,
    });
  });

  it("keeps OMP ACP occupancy separate when only done carries the combined usage", () => {
    const ompKey = sessionKey("omp", "s-omp-done-only", "/tmp/ws");
    const ompRun = `usage-run-${++runCounter}`;
    runRouting.set(ompRun, ompKey);
    useChatStore.setState({
      bySession: {
        [ompKey]: {
          ...EMPTY_SESSION,
          streaming: true,
          messages: [{ seq: 2, role: "assistant", text: "done", live: true, ts: null }],
        },
      },
    });
    const acpUsage = {
      inputTokens: 120_000,
      outputTokens: 4_500,
      cacheRead: 180_000,
      cacheWrite: 15_000,
      totalTokens: 319_500,
      model_context_window: 256_000,
      context_usage: {
        input_tokens: 42_000,
        total_tokens: 42_000,
        model_context_window: 256_000,
      },
    };
    handleEngineEvents(
      [{ runId: ompRun, sessionId: "s-omp-done-only", engine: "omp", seq: 2, kind: "done", data: { usage: acpUsage } }],
      deps(),
    );

    const settled = useChatStore.getState().bySession[ompKey]!;
    expect(parseUsage(settled.usage)).toMatchObject({ total: 42_000, contextWindow: 256_000 });
    const assistant = settled.messages.filter((m) => m.role === "assistant").at(-1);
    expect(parseUsage(assistant?.usage)).toMatchObject({
      input: 120_000,
      output: 4_500,
      cacheRead: 180_000,
      cacheWrite: 15_000,
      total: 319_500,
      contextWindow: 256_000,
    });
  });

});
