import { beforeEach, describe, expect, it } from "vitest";
import type { Message } from "@/lib/ipc";
import {
  appendToolMessage,
  applyStreamParts,
  findActiveRunForKey,
  routeRun,
  runRouting,
  settleLiveRows,
  untrackRun,
  EMPTY_SESSION,
  type BySessionSlice,
} from "./stream";

function harness() {
  let state: BySessionSlice = { bySession: { k: { ...EMPTY_SESSION, messages: [] } } };
  const set = (fn: (s: BySessionSlice) => Partial<BySessionSlice>) => {
    state = { ...state, ...fn(state) };
  };
  return {
    set,
    messages: () => state.bySession.k.messages,
  };
}

describe("appendToolMessage", () => {
  it("stores args on a new tool row", () => {
    const h = harness();
    appendToolMessage(h.set, "k", "Read", null, "src/a.ts", null, { file_path: "src/a.ts" });
    expect(h.messages()).toHaveLength(1);
    expect(h.messages()[0]).toMatchObject({
      role: "tool",
      text: "Read",
      path: "src/a.ts",
      args: { file_path: "src/a.ts" },
    });
  });

  it("patches the oldest args-less tool row of the same name", () => {
    const h = harness();
    appendToolMessage(h.set, "k", "Read", null);
    appendToolMessage(h.set, "k", "Read", null);
    appendToolMessage(h.set, "k", "Read", null, "src/a.ts", null, { file_path: "src/a.ts" }, true);
    expect(h.messages()).toHaveLength(2);
    expect(h.messages()[0].args).toEqual({ file_path: "src/a.ts" });
    expect(h.messages()[0].path).toBe("src/a.ts");
    expect(h.messages()[1].args).toBeUndefined();
  });

  it("drops a patch when no matching args-less row exists", () => {
    const h = harness();
    appendToolMessage(h.set, "k", "Read", null, "src/a.ts", null, { file_path: "src/a.ts" });
    appendToolMessage(h.set, "k", "Read", null, "src/b.ts", null, { file_path: "src/b.ts" }, true);
    expect(h.messages()).toHaveLength(1);
    expect(h.messages()[0].path).toBe("src/a.ts");
  });

  it("stamps model and effort on assistant stream messages", () => {
    const out = applyStreamParts([], [{ kind: "delta", text: "hello" }], "gemini-3.8-flash", "high");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      role: "assistant",
      text: "hello",
      model: "gemini-3.8-flash",
      effort: "high",
    });
  });
});

describe("applyStreamParts / settleLiveRows contract", () => {
  it("preserves immutable history, sequence and mixed-role order", () => {
    const original: Message[] = [
      Object.freeze({ seq: 1, role: "user", text: "question", ts: null }),
      Object.freeze({ seq: 2, role: "assistant", text: "start", live: true, ts: null }),
    ];
    Object.freeze(original);
    const result = applyStreamParts(original, [
      { kind: "delta", text: " one" },
      { kind: "thinking", text: "reason" },
      { kind: "thinking", text: " more" },
      { kind: "delta", text: "answer" },
    ], "model");
    // omp interleaves the channels within ONE assistant message, so the
    // trailing delta folds back into the earlier live assistant row,
    // skipping the live thinking row — text stays one continuous document.
    expect(result.map((m) => [m.seq, m.role, m.text])).toEqual([
      [1, "user", "question"],
      [2, "assistant", "start oneanswer"],
      [3, "thinking", "reason more"],
    ]);
    expect(original[1].text).toBe("start");
    expect(result[0]).toBe(original[0]);
  });

  it("returns the original array for empty or textless parts", () => {
    const original: Message[] = [Object.freeze({ seq: 1, role: "user", text: "question", ts: null })];
    expect(applyStreamParts(original, [], null)).toBe(original);
    expect(applyStreamParts(original, [{ kind: "delta", text: "" }], null)).toBe(original);
  });

  it("settleLiveRows clears every live flag", () => {
    const result = applyStreamParts([], [{ kind: "delta", text: "hello" }], null);
    expect(settleLiveRows(result).every((m) => !m.live)).toBe(true);
  });
});

describe("findActiveRunForKey", () => {
  beforeEach(() => {
    for (const runId of [...runRouting.keys()]) {
      runRouting.delete(runId);
      untrackRun(runId);
    }
  });

  it("resolves the live run id routed to a session key", () => {
    routeRun("run-a", "omp/s1");
    expect(findActiveRunForKey("omp/s1")).toBe("run-a");
  });

  it("returns null for a key with no routed run", () => {
    routeRun("run-a", "omp/s1");
    expect(findActiveRunForKey("omp/s2")).toBeNull();
    expect(findActiveRunForKey("")).toBeNull();
  });

  it("returns null when the key is ambiguous so a control frame cannot pick wrong", () => {
    // One session must own at most one live chat run. Two routed runs mean
    // the host cannot prove which one owns the turn, and compacting the
    // wrong run would hit an unrelated task.
    routeRun("run-a", "omp/s1");
    routeRun("run-b", "omp/s1");
    expect(findActiveRunForKey("omp/s1")).toBeNull();
  });
});
