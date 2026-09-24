import { describe, expect, it } from "vitest";
import { groupTasksByRun, runningTaskCount, stepsFromTasks } from "./background-tasks";
import type { BackgroundTask } from "./store/stream";

const task = (over: Partial<BackgroundTask>): BackgroundTask => ({
  id: "t", runId: "r1", taskType: "local_agent", description: "d",
  status: "running", startedAt: 1, updatedAt: 1, ...over,
});

describe("background task helpers", () => {
  it("groups by run with running groups first", () => {
    const groups = groupTasksByRun([
      task({ id: "a", runId: "old", status: "completed", startedAt: 1 }),
      task({ id: "b", runId: "new", startedAt: 2 }),
    ]);
    expect(groups.map((g) => g.runId)).toEqual(["new", "old"]);
    expect(groups[0].tasks[0].id).toBe("b");
  });

  it("counts only running tasks", () => {
    expect(runningTaskCount([task({}), task({ id: "x", status: "completed" })])).toBe(1);
  });

  /** Ambient tasks are session-scoped housekeeping: they run for the life of
   *  the session, so counting them would pin the tail indicator on "running"
   *  forever. The panel still lists them. */
  it("keeps ambient tasks out of the running count", () => {
    expect(
      runningTaskCount([
        task({ id: "t", ambient: true }),
        task({ id: "x", status: "completed" }),
      ]),
    ).toBe(0);
    expect(runningTaskCount([task({ id: "t", ambient: true }), task({ id: "r" })])).toBe(1);
  });

  it("maps tasks onto the subagent pill steps", () => {
    const steps = stepsFromTasks([
      task({ id: "w", taskType: "local_workflow", workflowName: "ccgui-full-parse" }),
      task({ id: "a", status: "completed", subagentType: "general-purpose", description: "读文档" }),
      task({ id: "f", status: "failed", description: "挂了" }),
    ], null);
    expect(steps).toEqual([
      { key: "w", label: "ccgui-full-parse", state: "active", subagentType: undefined, detail: "d" },
      { key: "a", label: "读文档", state: "complete", subagentType: "general-purpose", detail: "读文档" },
      { key: "f", label: "挂了", state: "failed", subagentType: undefined, detail: "挂了" },
    ]);
  });

  /** The brief (description) names a task better than its bare type: two
   *  general-purpose subagents stay distinguishable. The type chip still
   *  gets subagentType, and the detail overlay the brief. */
  it("labels a step by its brief before its type, localizing the bare-type fallback", () => {
    const steps = stepsFromTasks([
      task({ id: "brief", description: "读文档", subagentType: "general-purpose" }),
      task({ id: "typed", description: "", subagentType: "code-reviewer" }),
      task({ id: "bare", taskType: "local_bash", description: "" }),
    ], null, (type) => (type === "local_bash" ? "后台命令" : type));
    expect(steps.map((s) => [s.label, s.subagentType, s.detail])).toEqual([
      ["读文档", "general-purpose", "读文档"],
      ["code-reviewer", "code-reviewer", undefined],
      ["后台命令", undefined, undefined],
    ]);
  });

  /** stopped/interrupted are NOT "completed": the pill must not show a green
   *  已完成 where the panel shows 已停止/已中断. */
  it("keeps stopped and interrupted distinct from completed", () => {
    const steps = stepsFromTasks([
      task({ id: "s", status: "stopped" }),
      task({ id: "i", status: "interrupted" }),
      task({ id: "c", status: "completed" }),
    ], null);
    expect(steps.map((s) => s.state)).toEqual(["stopped", "interrupted", "complete"]);
  });

  /** A fresh run's id is written optimistically on send, BEFORE its first
   *  task frame: scoping to it would empty the pill mid-gap (blinking it
   *  away and collapsing an open panel). Freeze on the settled table until
   *  the new run actually reports a task. */
  it("freezes on the settled table while a fresh run has reported no tasks", () => {
    const history = [
      task({ id: "old-1", runId: "r1", status: "completed" }),
      task({ id: "old-2", runId: "r1", status: "failed" }),
      task({ id: "amb", runId: "r1", ambient: true }),
    ];
    const frozen = stepsFromTasks(history, "r2");
    expect(frozen.map((s) => s.key)).toEqual(["old-1", "old-2"]);
    // The new run's first task frame switches the pill to the new turn.
    const live = stepsFromTasks([...history, task({ id: "new-1", runId: "r2" })], "r2");
    expect(live.map((s) => s.key)).toEqual(["new-1"]);
  });

  it("shows nothing for a fresh run when history holds only ambient tasks", () => {
    expect(stepsFromTasks([task({ id: "amb", ambient: true })], "r2")).toEqual([]);
  });

  /** The pill is a turn-level surface: ambient housekeeping never belongs to
   *  it, and with a live run only that run's tasks (plus anything still
   *  running) are the turn's story. */
  it("scopes the pill steps to the current run and never to ambient tasks", () => {
    const steps = stepsFromTasks([
      task({ id: "old-done", runId: "old", status: "completed" }),
      task({ id: "old-running", runId: "old" }),
      task({ id: "ambient", runId: "old", ambient: true }),
      task({ id: "now-done", runId: "now", status: "completed" }),
      task({ id: "now-run", runId: "now" }),
    ], "now");
    expect(steps.map((s) => s.key)).toEqual(["old-running", "now-done", "now-run"]);
  });
});
