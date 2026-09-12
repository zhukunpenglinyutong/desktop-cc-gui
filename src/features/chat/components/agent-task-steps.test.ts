import { describe, expect, it } from "vitest";
import type { Message } from "@/lib/ipc";
import { deriveAgentTaskSteps, subagentRefsFromArgs } from "./agent-task-steps";

function tool(seq: number, text: string, args?: unknown, result?: unknown): Message {
  return { seq, role: "tool", text, ts: null, args, result } as Message;
}

/** The shapes omp actually writes into the session transcript. */
const DISPATCH = tool(2, "task · Dispatching parallel agents", {
  context: "# Goal ...",
  tasks: [
    { agent: "task", name: "CoreInvokeFilterParse", task: "# Target\n只改一个文件…" },
    { agent: "task", name: "IdolLiveDemosaic", task: "# Target\nIdolLive 复验…" },
    { agent: "task", name: "IdolLiveTranslate", task: "# Target\n翻译复验…" },
  ],
});
const WAIT = tool(3, "hub · Waiting for the four concurrent subagents", { i: "…", op: "wait", timeoutMs: 600000 });
const WAIT_BY_ID = tool(4, "hub · Waiting for CoreInvokeFilterParse", { i: "…", ids: ["CoreInvokeFilterParse"], op: "wait" });
/** A wait that also covers a background job id the dispatch did not name. */
const WAIT_EXTRA = tool(5, "hub · Waiting on the queue", { i: "…", ids: ["bg_4"], op: "wait" });

describe("subagent counting", () => {
  it("counts the agents a call names, not the call", () => {
    const steps = deriveAgentTaskSteps([DISPATCH], true, "omp");
    expect(steps.map((s) => s.label)).toEqual([
      "CoreInvokeFilterParse",
      "IdolLiveDemosaic",
      "IdolLiveTranslate",
    ]);
    expect(steps.every((s) => s.state === "active")).toBe(true);
  });

  it("keeps the pill in step with a turn that reports four running", () => {
    // The reported bug: a dispatch of three plus a wait on one more job is
    // four in flight, while a per-call count showed two.
    const steps = deriveAgentTaskSteps([DISPATCH, WAIT_EXTRA], true, "omp");
    expect(steps.map((s) => s.key)).toEqual([
      "2:CoreInvokeFilterParse",
      "2:IdolLiveDemosaic",
      "2:IdolLiveTranslate",
      "5:bg_4",
    ]);
  });

  it("does not double count a wait on ids a dispatch already named", () => {
    const steps = deriveAgentTaskSteps([DISPATCH, WAIT_BY_ID], true, "omp");
    expect(steps).toHaveLength(3);

    const settled = deriveAgentTaskSteps([DISPATCH, WAIT_BY_ID], false, "omp");
    expect(settled.filter((s) => s.state === "complete")).toHaveLength(3);
  });

  it("ignores a call that names no subagent", () => {
    // Roster checks (`hub jobs`) and prose-only waits must not inflate the
    // count — they say nothing about how many agents are out there.
    expect(deriveAgentTaskSteps([WAIT], true, "omp")).toHaveLength(0);
    expect(deriveAgentTaskSteps([tool(2, "hub · Checking background job roster", { op: "jobs" })], true, "omp")).toHaveLength(0);
  });

  it("reads ids off both spellings", () => {
    expect(subagentRefsFromArgs({ ids: ["bg_1", "bg_2"] }).map((r) => r.id)).toEqual(["bg_1", "bg_2"]);
    expect(subagentRefsFromArgs({ tasks: [{ id: "alpha" }] })[0]).toMatchObject({ id: "alpha", label: "alpha" });
    expect(subagentRefsFromArgs({ op: "jobs" })).toEqual([]);
  });
});
