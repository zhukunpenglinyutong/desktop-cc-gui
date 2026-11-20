import { describe, expect, it } from "vitest";
import {
  deriveRunPhase,
  isRunSilenceSuspicious,
  pickLatestRun,
  RUN_SILENCE_WARN_MS,
  runSilenceMs,
  type RunActivitySnapshot,
} from "./run-activity";

function snap(over: Partial<RunActivitySnapshot> = {}): RunActivitySnapshot {
  return {
    runId: "r1",
    engine: "claude",
    startedAtMs: 1_000,
    responseHasOutput: false,
    tools: [],
    retries: [],
    retrying: false,
    awaitingUser: false,
    backgroundTasks: 0,
    nowMs: 10_000,
    ...over,
  };
}

describe("deriveRunPhase", () => {
  it("is waiting on the model before any response stream opens", () => {
    expect(deriveRunPhase(snap())).toEqual({ kind: "waiting_model", sinceMs: 1_000 });
    // After a tool result the next request is in flight.
    expect(
      deriveRunPhase(snap({ lastEvent: "tool_result", lastEventAtMs: 5_000 })),
    ).toEqual({ kind: "waiting_model", sinceMs: 5_000 });
  });

  it("separates an open response with no output from a thinking model", () => {
    expect(deriveRunPhase(snap({ responseSinceMs: 4_000 }))).toEqual({
      kind: "model_first_output",
      sinceMs: 4_000,
    });
    expect(
      deriveRunPhase(
        snap({ responseSinceMs: 4_000, responseHasOutput: true, block: "thinking", blockSinceMs: 4_500 }),
      ),
    ).toEqual({ kind: "model_thinking", sinceMs: 4_500 });
    expect(
      deriveRunPhase(snap({ responseSinceMs: 4_000, responseHasOutput: true, block: "tool_input", blockSinceMs: 6_000 })).kind,
    ).toBe("model_tool_input");
    expect(
      deriveRunPhase(snap({ responseSinceMs: 4_000, responseHasOutput: true, block: "text", blockSinceMs: 6_000 })).kind,
    ).toBe("model_writing");
  });

  it("reports running tools from the oldest call, and subagents by name", () => {
    const tools = [
      { name: "Bash", sinceMs: 3_000, detail: "pnpm build" },
      { name: "Read", sinceMs: 2_000 },
    ];
    expect(deriveRunPhase(snap({ tools }))).toEqual({ kind: "tools", sinceMs: 2_000 });
    expect(deriveRunPhase(snap({ tools: [{ name: "Task", sinceMs: 2_500 }] })).kind).toBe("subagents");
  });

  it("lets a retry, compaction or question outrank everything else", () => {
    const busy = { tools: [{ name: "Bash", sinceMs: 2_000 }], responseSinceMs: 3_000 };
    const retry = { atMs: 7_000, attempt: 2, max: 10, status: 529, category: "overloaded" as const, message: "" };
    expect(deriveRunPhase(snap({ ...busy, retrying: true, retries: [retry] }))).toEqual({
      kind: "retrying",
      sinceMs: 7_000,
    });
    expect(deriveRunPhase(snap({ ...busy, compactingSinceMs: 8_000 })).kind).toBe("compacting");
    expect(deriveRunPhase(snap({ ...busy, awaitingUser: true })).kind).toBe("awaiting_user");
  });

  it("falls back to the last delta for engines without response markers", () => {
    expect(deriveRunPhase(snap({ lastEvent: "thinking", lastEventAtMs: 9_000 })).kind).toBe("model_thinking");
    expect(deriveRunPhase(snap({ lastEvent: "text", lastEventAtMs: 9_000 })).kind).toBe("model_writing");
  });
});

describe("silence", () => {
  it("measures from the latest of raw output and parsed events", () => {
    expect(runSilenceMs(snap({ lastOutputAtMs: 8_000, lastEventAtMs: 6_000 }))).toBe(2_000);
    expect(runSilenceMs(snap())).toBe(9_000);
  });

  it("flags long silence only where output is expected", () => {
    const now = 1_000 + RUN_SILENCE_WARN_MS + 1;
    expect(isRunSilenceSuspicious(snap({ nowMs: now }))).toBe(true);
    expect(isRunSilenceSuspicious(snap({ nowMs: 50_000 }))).toBe(false);
    // A long build or hidden reasoning is silent by nature.
    expect(isRunSilenceSuspicious(snap({ nowMs: now, tools: [{ name: "Bash", sinceMs: 1_000 }] }))).toBe(false);
    expect(
      isRunSilenceSuspicious(
        snap({ nowMs: now, responseSinceMs: 1_000, responseHasOutput: true, block: "thinking", blockSinceMs: 1_000 }),
      ),
    ).toBe(false);
  });
});

describe("pickLatestRun", () => {
  it("prefers the newest run routed to the session", () => {
    expect(pickLatestRun([])).toBeNull();
    const a = snap({ runId: "a", startedAtMs: 1 });
    const b = snap({ runId: "b", startedAtMs: 2 });
    expect(pickLatestRun([a, b])?.runId).toBe("b");
    expect(pickLatestRun([b, a])?.runId).toBe("b");
  });
});
