import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatStore } from "./store";
import { handleEngineEvents, type EngineEventDeps } from "./store/engine-events";
import { EMPTY_SESSION, runRouting } from "./store/stream";

vi.mock("@/lib/ipc", () => ({
  ipc: {
    loadSessionPage: vi.fn(async () => ({ messages: [], nextBefore: null, subagentHistory: [] })),
    rescanSessions: vi.fn(async () => {}),
  },
}));
vi.mock("@/lib/events", () => ({
  listenEngineEvents: vi.fn(async () => () => {}),
  listenSessionsChanged: vi.fn(async () => () => {}),
  listenComputerUseEscape: vi.fn(async () => () => {}),
}));

const WS = "/tmp/ws";
const KEY = "claude/sess-1";

/** The summed usage a claude result line carries: every request of the turn
 *  added up (verified against live runs — result.usage.input_tokens equals
 *  the sum of the turn's per-request inputs), not the occupancy the meter
 *  shows. The live meter must not settle here; the transcript re-read does. */
const TURN_SUM = {
  input_tokens: 51_755,
  output_tokens: 5_713,
  cache_read_input_tokens: 7_040,
  model_context_window: 1_000_000,
};

function deps(refreshSessionUsage?: (key: string) => Promise<void>): EngineEventDeps {
  return {
    set: useChatStore.setState,
    get: useChatStore.getState,
    drainQueue: () => {},
    markUnseenIfBackground: () => {},
    upsertSessionMeta: () => {},
    refreshSessionUsage,
  };
}

function ev(runId: string, seq: number, data: unknown, engine = "claude") {
  return { runId, sessionId: "sess-1", engine, seq, kind: "done" as const, data };
}

describe("a settled turn re-reads the live occupancy from session history", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    vi.clearAllMocks();
    runRouting.clear();
    const tab = { engine: "claude", sessionId: "sess-1", workspacePath: WS };
    useChatStore.setState({
      openTabs: [tab],
      active: tab,
      activeEngine: "claude",
      unseen: {},
      streamingByKey: {},
      models: {},
      efforts: {},
      bySession: { [KEY]: { ...EMPTY_SESSION } },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("re-reads the latest usage snapshot once a claude turn settles", () => {
    const refresh = vi.fn(async () => {});

    handleEngineEvents([ev("run-1", 3, { usage: { ...TURN_SUM } })], deps(refresh));

    // The re-read waits briefly for the engine to flush the session file.
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(refresh).toHaveBeenCalledWith(KEY);
  });

  it("re-reads the latest usage snapshot once an omp turn settles", () => {
    const refresh = vi.fn(async () => {});
    const ompKey = "omp/sess-omp";
    const ompTab = { engine: "omp", sessionId: "sess-omp", workspacePath: WS };
    useChatStore.setState({
      openTabs: [ompTab],
      active: ompTab,
      activeEngine: "omp",
      bySession: { [ompKey]: { ...EMPTY_SESSION } },
    });

    handleEngineEvents(
      [
        {
          runId: "run-omp-1",
          sessionId: "sess-omp",
          engine: "omp",
          seq: 3,
          kind: "done",
          data: {
            usage: {
              inputTokens: 120_000,
              outputTokens: 4_500,
              totalTokens: 124_500,
              model_context_window: 256_000,
              context_usage: {
                input_tokens: 42_000,
                total_tokens: 42_000,
                model_context_window: 256_000,
              },
            },
          },
        },
      ],
      deps(refresh),
    );

    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(refresh).toHaveBeenCalledWith(ompKey);
  });

  it("does not re-read for other engines' plain turns", () => {
    const refresh = vi.fn(async () => {});

    handleEngineEvents(
      [ev("run-2", 3, { usage: { ...TURN_SUM } }, "codex")],
      deps(refresh),
    );

    vi.advanceTimersByTime(400);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("still re-reads after a /compact turn on any engine", () => {
    const refresh = vi.fn(async () => {});
    useChatStore.setState({
      bySession: {
        [KEY]: {
          ...EMPTY_SESSION,
          messages: [
            { seq: 1, role: "user", text: "/compact", ts: "2026-09-16T00:00:00Z" },
          ],
        },
      },
    });

    handleEngineEvents(
      [ev("run-3", 3, { usage: { ...TURN_SUM } }, "codex")],
      deps(refresh),
    );

    vi.advanceTimersByTime(400);
    expect(refresh).toHaveBeenCalledWith(KEY);
  });
});
