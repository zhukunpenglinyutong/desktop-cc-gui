import { describe, expect, it } from "vitest";
import type { Message } from "@/lib/ipc";
import { deriveAgentTaskSteps, deriveTodoList, subagentRefsFromArgs } from "./agent-task-steps";

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

  it("does not promote background jobs to subagents", () => {
    const steps = deriveAgentTaskSteps([DISPATCH, WAIT_EXTRA], true, "omp");
    expect(steps.map((s) => s.key)).toEqual([
      "2:CoreInvokeFilterParse",
      "2:IdolLiveDemosaic",
      "2:IdolLiveTranslate",
    ]);
  });

  it("does not double count a wait on ids a dispatch already named", () => {
    const steps = deriveAgentTaskSteps([DISPATCH, WAIT_BY_ID], true, "omp");
    expect(steps).toHaveLength(3);

    // 父 assistant 暂停流式（streaming=false）不该把刚派出去的 subagent
    // 标 complete；只有显式 hub roster / jobs snapshot 才会推动状态。
    const settled = deriveAgentTaskSteps([DISPATCH, WAIT_BY_ID], false, "omp");
    expect(settled.every((s) => s.state === "active")).toBe(true);
  });

  it("ignores a call that names no subagent", () => {
    // Roster checks (`hub jobs`) and prose-only waits must not inflate the
    // count — they say nothing about how many agents are out there.
    expect(deriveAgentTaskSteps([WAIT], true, "omp")).toHaveLength(0);
    expect(deriveAgentTaskSteps([tool(2, "hub · Checking background job roster", { op: "jobs" })], true, "omp")).toHaveLength(0);
  });

  it("keeps agents named by a running hub snapshot active even when the host is not streaming", () => {
    const snapshot = tool(6, "hub · Waiting for workers", { op: "wait" }, {
      details: {
        op: "wait",
        jobs: [
          { id: "CoreInvokeFilterParse", type: "task", status: "running" },
          { id: "IdolLiveTranslate", type: "task", status: "running" },
        ],
      },
    });
    const steps = deriveAgentTaskSteps([DISPATCH, snapshot], false, "omp");
    expect(steps.map(({ label, state }) => ({ label, state }))).toEqual([
      { label: "CoreInvokeFilterParse", state: "active" },
      // IdolLiveDemosaic was dispatched but not mentioned in the running hub
      // snapshot. Settling the parent turn must NOT force it to "complete" —
      // the agent is still in flight and only an explicit hub status (or a
      // complete jobs roster) should settle it.
      { label: "IdolLiveDemosaic", state: "active" },
      { label: "IdolLiveTranslate", state: "active" },
    ]);
  });

  it("retains the complete delegated task as its clickable detail", () => {
    const dispatch = tool(2, "task · Dispatching worker", {
      tasks: [{
        agent: "task",
        name: "Worker",
        task: "# Target\nOwn relay.rs only.\n# Acceptance\nOutages recover without toggling.",
      }],
    });
    expect(deriveAgentTaskSteps([dispatch], true, "omp")[0].detail).toBe(
      "# Target\nOwn relay.rs only.\n# Acceptance\nOutages recover without toggling.",
    );
  });

  it("tags every row: the agent kind when the harness names one, else the tool", () => {
    // The harness writes `agent` only for some dispatches (scout batches carry
    // it, task batches do not); a row without a tag loses the only hint of
    // where it came from.
    const kindless = tool(2, "task · Dispatching workers", {
      tasks: [{ name: "RelayWorker", task: "# Target\nOwn relay.rs." }],
    });
    const kinded = tool(3, "task · Dispatching scouts", {
      tasks: [{ agent: "scout", name: "RepoMap", task: "# Target\nMap the repo." }],
    });
    expect(deriveAgentTaskSteps([kindless, kinded], true, "omp").map((s) => s.subagentType)).toEqual([
      "task",
      "scout",
    ]);
  });

  it("normalizes stringified task arrays before later hub references", () => {
    const encodedDispatch = tool(2, "task · Marking dual-arch regression done", {
      tasks: JSON.stringify([
        { name: "IdolLiveBackstage", task: "# Target\nVerify IdolLive." },
        { name: "AfterstoryCgScene", task: "# Target\nVerify Afterstory." },
      ]),
    });
    const wait = tool(3, "hub · Waiting for live demosaic subagents", {
      ids: ["IdolLiveBackstage", "AfterstoryCgScene"],
      op: "wait",
    });

    expect(
      deriveAgentTaskSteps([encodedDispatch, wait], true, "omp").map(
        ({ label, subagentType }) => ({ label, subagentType }),
      ),
    ).toEqual([
      { label: "IdolLiveBackstage", subagentType: "task" },
      { label: "AfterstoryCgScene", subagentType: "task" },
    ]);
  });

  it("ignores malformed task arrays instead of rendering the dispatch as an agent", () => {
    const malformed = tool(2, "task · Dispatching demosaic evidence tasks", {
      tasks: '[{"name":"IdolLiveSceneDemosaic","task":"unterminated}]',
    });
    const retry = tool(3, "task · Dispatching demosaic evidence tasks", {
      tasks: [
        { name: "IdolLiveSceneDemosaic", task: "# Target\nVerify IdolLive." },
        { name: "AfterstoryMosaicScene", task: "# Target\nVerify Afterstory." },
      ],
    });

    expect(
      deriveAgentTaskSteps([malformed, retry], true, "omp").map(
        ({ label, subagentType }) => ({ label, subagentType }),
      ),
    ).toEqual([
      { label: "IdolLiveSceneDemosaic", subagentType: "task" },
      { label: "AfterstoryMosaicScene", subagentType: "task" },
    ]);
  });

  it("keeps pending and queued dispatch progress active", () => {
    const dispatch = tool(2, "task · Dispatching workers", {
      tasks: [
        { name: "PendingWorker", task: "# Target\nWait for a worker slot." },
        { name: "QueuedWorker", task: "# Target\nWait behind PendingWorker." },
      ],
    }, {
      details: {
        progress: [
          { id: "PendingWorker", status: "pending" },
          { id: "QueuedWorker", status: "queued" },
        ],
      },
    });

    expect(deriveAgentTaskSteps([dispatch], false, "omp").map((step) => step.state)).toEqual([
      "active",
      "active",
    ]);
  });

  it("settles running agents omitted by a later complete jobs roster", () => {
    const running = tool(3, "hub · Waiting for workers", { op: "wait" }, {
      details: {
        op: "wait",
        jobs: [{ id: "CoreInvokeFilterParse", status: "running" }],
      },
    });
    const emptyRoster = tool(4, "hub · Checking background jobs", { op: "jobs" }, {
      details: { op: "jobs", jobs: [] },
    });

    const steps = deriveAgentTaskSteps([DISPATCH, running, emptyRoster], false, "omp");
    expect(steps.every((step) => step.state === "complete")).toBe(true);
  });

  it("does not settle agents from malformed or unknown roster entries", () => {
    const running = tool(3, "hub", { op: "wait" }, {
      details: { jobs: [{ id: "CoreInvokeFilterParse", status: "running" }] },
    });
    const malformed = tool(4, "hub", { op: "jobs" }, {
      details: { op: "jobs", jobs: null },
    });
    const unknown = tool(5, "hub", { op: "jobs" }, {
      details: { op: "jobs", jobs: [{ id: "CoreInvokeFilterParse", status: "unknown" }] },
    });
    expect(deriveAgentTaskSteps([DISPATCH, running, malformed], false, "omp")[0].state).toBe("active");
    expect(deriveAgentTaskSteps([DISPATCH, running, unknown], false, "omp")[0].state).toBe("active");
  });

  it("does not settle agents from a filtered (partial) jobs roster", () => {
    const running = tool(3, "hub", { op: "wait" }, {
      details: { jobs: [{ id: "CoreInvokeFilterParse", status: "running" }] },
    });
    const filtered = tool(4, "hub", { op: "jobs", status: "running" }, {
      details: { op: "jobs", jobs: [] },
    });
    expect(deriveAgentTaskSteps([DISPATCH, running, filtered], false, "omp")[0].state).toBe("active");
  });

  it("does not mark dispatched subagents complete just because the parent stops streaming", () => {
    // 回归用例：父 assistant 派完 subagent 后停一拍等工具结果（streaming
    // 变 false），不该让刚派出去的 agent 瞬间变 complete。RunStatusStrip
    // 之前会因此把所有子代理渲染成"已完成"，但 hub roster 此时还没回来。
    const dispatch = tool(2, "task · Dispatching workers", {
      tasks: [
        { agent: "task", name: "WorkerA", task: "# Target\nOwn relay.rs." },
        { agent: "task", name: "WorkerB", task: "# Target\nOwn web relay." },
      ],
    });
    const stoppedStreaming = deriveAgentTaskSteps([dispatch], false, "omp");
    expect(stoppedStreaming.every((s) => s.state === "active")).toBe(true);

    // 后续 hub jobs snapshot 显式推进到 running → 仍 active
    const runningSnapshot = tool(3, "hub · Waiting for workers", { op: "wait" }, {
      details: {
        op: "wait",
        jobs: [
          { id: "WorkerA", type: "task", status: "running" },
          { id: "WorkerB", type: "task", status: "running" },
        ],
      },
    });
    const withSnapshot = deriveAgentTaskSteps([dispatch, runningSnapshot], false, "omp");
    expect(withSnapshot.every((s) => s.state === "active")).toBe(true);

    // hub jobs snapshot 显式报 complete → 才标 complete
    const doneSnapshot = tool(3, "hub · Waiting for workers", { op: "wait" }, {
      details: {
        op: "wait",
        jobs: [
          { id: "WorkerA", type: "task", status: "complete" },
          { id: "WorkerB", type: "task", status: "complete" },
        ],
      },
    });
    const allDone = deriveAgentTaskSteps([dispatch, doneSnapshot], false, "omp");
    expect(allDone.every((s) => s.state === "complete")).toBe(true);
  });

  it("reads named agents but ignores background-job ids", () => {
    expect(subagentRefsFromArgs({ ids: ["bg_1", "bg_2"] })).toEqual([]);
    expect(subagentRefsFromArgs({ ids: ["CoreInvokeFilterParse"] })).toEqual([
      { id: "CoreInvokeFilterParse" },
    ]);
    expect(subagentRefsFromArgs({ tasks: [{ id: "alpha" }] })[0]).toMatchObject({ id: "alpha", label: "alpha" });
    expect(subagentRefsFromArgs({ op: "jobs" })).toEqual([]);
  });

  it("resolves a re-spawn's suffixed id back to the dispatch that named it", () => {
    // The reported bug: two review agents, one shown as `reviewer` with its
    // assignment and the other as a bare `hub` with no detail, because the
    // runtime reported it back under a disambiguated id the dispatch's
    // `tasks[]` never spelled out.
    const dispatch = tool(2, "task · Dispatching reviewers", {
      tasks: [
        { agent: "reviewer", name: "HostLifecycleReview", task: "# Target\nReview host lifecycle." },
        { agent: "reviewer", name: "PluginReview", task: "# Target\nReview the plugin surface." },
      ],
    });
    const wait = tool(3, "hub · Waiting for the reviewers", {
      ids: ["HostLifecycleReview", "PluginReview-2"],
      op: "wait",
    });

    expect(
      deriveAgentTaskSteps([dispatch, wait], true, "omp").map(
        ({ label, subagentType, detail }) => ({ label, subagentType, detail }),
      ),
    ).toEqual([
      {
        label: "HostLifecycleReview",
        subagentType: "reviewer",
        detail: "# Target\nReview host lifecycle.",
      },
      // The row keeps the id the runtime reported, and inherits nothing but
      // the kind and the assignment.
      {
        label: "PluginReview-2",
        subagentType: "reviewer",
        detail: "# Target\nReview the plugin surface.",
      },
    ]);
  });

  it("keeps a base name and its suffixed sibling apart when both are live", () => {
    // A suffix only means "same agent, re-spawned" when the base name is gone.
    // Here the wait names both, so two agents really are out there: they stay
    // two rows, and the re-spawn still inherits the kind and assignment of the
    // dispatch its name derives from.
    const dispatch = tool(2, "task · Dispatching a reviewer", {
      tasks: [{ agent: "reviewer", name: "PluginReview", task: "# Target\nReview the plugin surface." }],
    });
    const wait = tool(3, "hub · Waiting for the reviewers", {
      ids: ["PluginReview", "PluginReview-2"],
      op: "wait",
    });

    expect(
      deriveAgentTaskSteps([dispatch, wait], true, "omp").map(
        ({ label, subagentType, detail }) => ({ label, subagentType, detail }),
      ),
    ).toEqual([
      {
        label: "PluginReview",
        subagentType: "reviewer",
        detail: "# Target\nReview the plugin surface.",
      },
      {
        label: "PluginReview-2",
        subagentType: "reviewer",
        detail: "# Target\nReview the plugin surface.",
      },
    ]);
  });

  it("does not let unrelated names inherit each other's assignment", () => {
    // Only a trailing `-<digits>` is a disambiguation suffix. Anything looser
    // would hand one agent's kind and task text to a different agent.
    const dispatch = tool(2, "task · Dispatching a reviewer", {
      tasks: [{ agent: "reviewer", name: "PluginReview", task: "# Target\nReview the plugin surface." }],
    });
    const wait = tool(3, "hub · Waiting for the worker", { ids: ["PluginReviewWorker"], op: "wait" });

    const steps = deriveAgentTaskSteps([dispatch, wait], true, "omp");
    expect(steps.map((s) => s.label)).toEqual(["PluginReview", "PluginReviewWorker"]);
    expect(steps[1].subagentType).toBeUndefined();
    expect(steps[1].detail).toBeUndefined();
  });

  it("leaves a row untagged rather than tagging it with the coordination tool", () => {
    // `hub` is how the host waits on agents, never a kind of agent, so an id
    // no dispatch ever named gets no tag at all.
    const wait = tool(2, "hub · Waiting for a stray worker", { ids: ["StrayWorker"], op: "wait" });
    const steps = deriveAgentTaskSteps([wait], true, "omp");
    expect(steps.map(({ label, subagentType }) => ({ label, subagentType }))).toEqual([
      { label: "StrayWorker", subagentType: undefined },
    ]);
  });

  it("folds authoritative todo snapshot from message.result details.phases", () => {
    const messages: Message[] = [
      tool(1, "todo", { op: "init" }, undefined),
      tool(2, "todo", { op: "done", phase: "verify" }, {
        details: {
          phases: [
            {
              name: "impl",
              tasks: [
                { content: "实现功能", status: "completed" },
              ],
            },
          ],
        },
      }),
    ];
    const items = deriveTodoList(messages);
    expect(items).toEqual([{ content: "实现功能", status: "complete", phase: "impl", reason: undefined, detail: undefined }]);
  });
});
