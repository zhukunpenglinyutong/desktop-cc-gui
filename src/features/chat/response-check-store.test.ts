import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChatStore } from "./store";
import {
  handleEngineEvents,
  type EngineEventDeps,
} from "./store/engine-events";
import { sessionKey } from "./store/persistence";
import { EMPTY_SESSION, runRouting } from "./store/stream";

vi.mock("@/lib/ipc", () => ({
  ipc: {
    rescanSessions: vi.fn(async () => {}),
    usageRecord: vi.fn(async () => {}),
  },
}));
vi.mock("@/lib/events", () => ({
  listenEngineEvents: vi.fn(async () => () => {}),
  listenSessionsChanged: vi.fn(async () => () => {}),
  listenComputerUseEscape: vi.fn(async () => () => {}),
}));

const KEY = sessionKey("omp", "s-1", "/tmp/ws");
let runId = "response-check-run-0";
let runCounter = 0;

function deps(): EngineEventDeps {
  return {
    set: useChatStore.setState,
    get: useChatStore.getState,
    drainQueue: () => {},
    markUnseenIfBackground: () => {},
    upsertSessionMeta: () => {},
  };
}

function ev(
  kind: "launch" | "served" | "model" | "effort" | "done",
  seq: number,
  data: unknown,
) {
  return { runId, sessionId: "s-1", engine: "omp", seq, kind, data };
}

const session = () => useChatStore.getState().bySession[KEY]!;

describe("the response check's engine wiring", () => {
  beforeEach(() => {
    runId = `response-check-run-${++runCounter}`;
    localStorage.clear();
    vi.clearAllMocks();
    runRouting.clear();
    useChatStore.setState({
      openTabs: [],
      active: null,
      unseen: {},
      bySession: { [KEY]: { ...EMPTY_SESSION } },
      streamingByKey: {},
    });
  });

  it("a launch opens the request side and seeds the display", () => {
    handleEngineEvents(
      [
        ev("launch", 1, {
          model: "百倍baibei/claude-opus-5-5",
          effort: "xhigh",
        }),
      ],
      deps(),
    );

    expect(session().responseCheck).toEqual({
      requested: { model: "百倍baibei/claude-opus-5-5", effort: "xhigh" },
      served: { model: null, effort: null },
    });
    expect(session().activeModel).toBe("百倍baibei/claude-opus-5-5");
    expect(session().activeEffort).toBe("xhigh");
  });

  it("preserves the adapter's resolved and explicitly unresolved model through settlement", () => {
    for (const comparisonModel of ["claude-opus-5-5", null]) {
      useChatStore.setState({
        bySession: {
          [KEY]: {
            ...EMPTY_SESSION,
            streaming: true,
            messages: [
              { seq: 1, role: "assistant", text: "ok", ts: null, live: true },
            ],
          },
        },
      });
      handleEngineEvents(
        [ev("launch", 1, { model: "opus", comparisonModel, effort: "high" })],
        deps(),
      );
      handleEngineEvents(
        [ev("served", 2, { model: "claude-opus-5-5" })],
        deps(),
      );
      expect(session().responseCheck?.requested).toEqual({
        model: "opus",
        comparisonModel,
        effort: "high",
      });
      handleEngineEvents([ev("done", 3, { code: 0 })], deps());
      expect(
        session().messages.at(-1)?.responseCheck?.requested.comparisonModel,
      ).toBe(comparisonModel);
      runId = `response-check-run-${++runCounter}`;
    }
  });

  it("a served report fills only the response side", () => {
    handleEngineEvents(
      [ev("launch", 1, { model: "claude-opus-5-5", effort: "xhigh" })],
      deps(),
    );
    handleEngineEvents([ev("served", 2, { model: "gpt-5.6-luna" })], deps());

    expect(session().responseCheck).toEqual({
      requested: { model: "claude-opus-5-5", effort: "xhigh" },
      served: { model: "gpt-5.6-luna", effort: null },
    });
  });

  it("the next run's launch drops the previous response side", () => {
    handleEngineEvents(
      [ev("launch", 1, { model: "claude-opus-5-5", effort: "xhigh" })],
      deps(),
    );
    handleEngineEvents([ev("served", 2, { model: "claude-opus-5-5" })], deps());

    runId = `${runId}-next`;
    handleEngineEvents(
      [ev("launch", 1, { model: "claude-opus-5-5", effort: "low" })],
      deps(),
    );

    expect(session().responseCheck).toEqual({
      requested: { model: "claude-opus-5-5", effort: "low" },
      served: { model: null, effort: null },
    });
  });

  it("model/effort reports steer the display, never the check", () => {
    handleEngineEvents(
      [ev("launch", 1, { model: "claude-opus-5-5", effort: "xhigh" })],
      deps(),
    );
    handleEngineEvents(
      [ev("model", 2, "glm-5.3"), ev("effort", 3, "low")],
      deps(),
    );

    expect(session().activeModel).toBe("glm-5.3");
    expect(session().activeEffort).toBe("low");
    expect(session().responseCheck).toEqual({
      requested: { model: "claude-opus-5-5", effort: "xhigh" },
      served: { model: null, effort: null },
    });
  });

  it("a served report from an observed run keeps the request side open", () => {
    handleEngineEvents([ev("served", 1, { model: "claude-opus-5-5" })], deps());

    expect(session().responseCheck).toEqual({
      requested: { model: null, effort: null },
      served: { model: "claude-opus-5-5", effort: null },
    });
  });

  it("a settled turn keeps the check on its last assistant message", () => {
    useChatStore.setState({
      bySession: {
        [KEY]: {
          ...EMPTY_SESSION,
          streaming: true,
          turnStartedAt: Date.now() - 5000,
          messages: [
            { seq: 1, role: "user", text: "go", ts: null },
            { seq: 2, role: "assistant", text: "ok", ts: null, live: true },
          ],
        },
      },
    });
    handleEngineEvents(
      [ev("launch", 1, { model: "gpt-6-astra", effort: "max" })],
      deps(),
    );
    handleEngineEvents(
      [ev("served", 2, { model: "gpt-5.6-luna", effort: "low" })],
      deps(),
    );
    handleEngineEvents([ev("done", 3, {})], deps());

    const assistant = session().messages.filter((m) => m.role === "assistant");
    expect(assistant).toHaveLength(1);
    expect(assistant[0].responseCheck).toEqual({
      requested: { model: "gpt-6-astra", effort: "max" },
      served: { model: "gpt-5.6-luna", effort: "low" },
    });
  });
});
