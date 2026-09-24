import { beforeEach, describe, expect, it, vi } from "vitest";
import { ipc } from "@/lib/ipc";
import { useChatStore } from "./store";
import { handleEngineEvents, type EngineEventDeps } from "./store/engine-events";
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

function event(kind: "usage" | "done", seq: number, data: unknown) {
  return { runId, sessionId: "s-1", engine: "codex", seq, kind, data };
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

  /** A reply that ends with background tasks still running is booked the
   *  moment its own segment ends: the process can die in the background phase
   *  (no completion turn ever arrives), and the turn's tokens must not be lost
   *  with it. The completion turn's done then skips the booking. */
  it("books a reply ending on background tasks, once, at its own done", () => {
    handleEngineEvents(
      [event("done", 9, { usage: { input_tokens: 7, output_tokens: 3 }, backgroundTasks: 1 })],
      deps(),
    );
    expect(ipc.usageRecord).toHaveBeenCalledTimes(1);
    expect(ipc.usageRecord).toHaveBeenCalledWith(
      expect.objectContaining({ input: 7, output: 3, reports: 1 }),
    );

    // The completion turn's result line belongs to the same run: booking it
    // too would count the reply's tokens twice.
    handleEngineEvents(
      [event("done", 10, { usage: { input_tokens: 1200, output_tokens: 8 } })],
      deps(),
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
});
