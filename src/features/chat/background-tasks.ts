import type { AgentTaskStep } from "./components/agent-task-steps";
import type { BackgroundTask } from "./store/stream";

/** The task's display label: the workflow's own name first, then the task
 *  brief (description), then the subagent type — a bare type like
 *  "general-purpose" cannot tell two same-type subagents apart, the brief
 *  can — and finally the bare type. `translateType` localizes that type
 *  fallback (`chat.tasks.type.*`); without it the raw type name shows.
 *  Shared by the tasks panel and the run-status pill so both name the same
 *  task the same way. */
export function taskLabel(
  task: BackgroundTask,
  translateType: (taskType: string) => string = (taskType) => taskType,
): string {
  return (
    task.workflowName || task.description || task.subagentType || translateType(task.taskType)
  );
}

/** Tasks grouped under their run (turn), running groups first, then newest. */
export function groupTasksByRun(
  tasks: BackgroundTask[],
): { runId: string; startedAt: number; tasks: BackgroundTask[] }[] {
  const groups = new Map<string, { runId: string; startedAt: number; tasks: BackgroundTask[] }>();
  for (const task of tasks) {
    const group = groups.get(task.runId) ?? { runId: task.runId, startedAt: task.startedAt, tasks: [] };
    group.startedAt = Math.min(group.startedAt, task.startedAt);
    group.tasks.push(task);
    groups.set(task.runId, group);
  }
  return [...groups.values()].sort((a, b) => {
    const aRunning = a.tasks.some((t) => t.status === "running") ? 1 : 0;
    const bRunning = b.tasks.some((t) => t.status === "running") ? 1 : 0;
    return bRunning - aRunning || b.startedAt - a.startedAt;
  });
}

/** Running tasks that count for a TURN (the tail indicator's count). Ambient
 *  (session-scoped) tasks never do: they outlive every turn, so counting one
 *  would keep the session reading as "background running" forever. The Rust
 *  side draws the same line (`pending_tasks` drops ambient frames). The panel
 *  lists ambient rows as usual. */
export function runningTaskCount(tasks: BackgroundTask[]): number {
  return tasks.filter((t) => t.status === "running" && !t.ambient).length;
}

/** Real task data → the run-status strip's subagent steps (claude engine).
 *
 *  Turn-level surface, so the same two rules as the tail indicator:
 *  - ambient tasks never show (session housekeeping, not this turn's work);
 *  - with a live run (`currentRunId`), only that run's tasks do — plus
 *    anything still running, which the reader is owed while it works.
 *
 *  A new run's id lands (optimistic write on send) BEFORE its first task
 *  frame: scoping to it would read empty and the pill would blink away,
 *  collapsing a panel the user opened. So when the scope filters everything
 *  out but settled history exists, freeze on the whole non-ambient table
 *  until the new run reports its first task — the strip's "counts freeze
 *  until a newer turn contributes fresh data" contract. A session without a
 *  claimed run keeps the whole non-ambient table outright. */
export function stepsFromTasks(
  tasks: BackgroundTask[],
  currentRunId: string | null,
  translateType?: (taskType: string) => string,
): AgentTaskStep[] {
  const nonAmbient = tasks.filter((t) => !t.ambient);
  let scoped =
    currentRunId === null
      ? nonAmbient
      : nonAmbient.filter((t) => t.runId === currentRunId || t.status === "running");
  if (currentRunId !== null && scoped.length === 0 && nonAmbient.length > 0) {
    scoped = nonAmbient;
  }
  return scoped.map((t) => ({
    key: t.id,
    label: taskLabel(t, translateType),
    state:
      t.status === "running"
        ? "active"
        : t.status === "completed"
          ? "complete"
          : t.status === "failed"
            ? "failed"
            : t.status, // "stopped" | "interrupted" keep their own name
    subagentType: t.subagentType,
    detail: t.description || undefined,
  }));
}
