import { describe, expect, it } from "vitest";
import type { KanbanTask } from "../../kanban/types";
import type { TaskRunRecord } from "../types";
import {
  buildLatestRunSummary,
  hasActiveRunConflict,
  mapExecutionSourceToRunTrigger,
  projectLatestRunSummaryToTasks,
} from "./taskRunProjection";
import { compareTaskRunSurfacePriority, describeTaskRunSurface } from "./taskRunSurface";

function makeTask(id: string): KanbanTask {
  return {
    id,
    workspaceId: "/repo",
    panelId: "panel-1",
    title: "Task",
    description: "",
    status: "todo",
    engineType: "codex",
    modelId: null,
    branchName: "main",
    images: [],
    autoStart: false,
    sortOrder: 1,
    threadId: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

function makeRun(overrides: Partial<TaskRunRecord> = {}): TaskRunRecord {
  return {
    runId: "run-1",
    task: {
      taskId: "task-1",
      source: "kanban",
      workspaceId: "/repo",
      title: "Task",
    },
    engine: "codex",
    status: "running",
    trigger: "manual",
    linkedThreadId: "thread-1",
    latestOutputSummary: "Working",
    blockedReason: null,
    failureReason: null,
    artifacts: [{ kind: "file", label: "src/a.ts" }],
    availableRecoveryActions: ["open_conversation"],
    startedAt: 10,
    updatedAt: 20,
    finishedAt: null,
    ...overrides,
  };
}

describe("taskRunProjection", () => {
  it("builds a bounded latest-run summary for Kanban projection", () => {
    expect(buildLatestRunSummary(makeRun())).toEqual({
      runId: "run-1",
      status: "running",
      trigger: "manual",
      engine: "codex",
      linkedThreadId: "thread-1",
      latestOutputSummary: "Working",
      blockedReason: null,
      failureReason: null,
      artifactCount: 1,
      updatedAt: 20,
      finishedAt: null,
    });
  });

  it("projects only the newest run summary without storing full history in Kanban tasks", () => {
    const [projected] = projectLatestRunSummaryToTasks(
      [makeTask("task-1")],
      [
        makeRun({ runId: "old", updatedAt: 10, latestOutputSummary: "old" }),
        makeRun({ runId: "new", updatedAt: 30, latestOutputSummary: "new" }),
      ],
    );

    expect(projected?.latestRunSummary?.runId).toBe("new");
    expect(projected).not.toHaveProperty("taskRuns");
  });

  it("detects active-run conflicts for duplicate triggers", () => {
    expect(hasActiveRunConflict([makeRun({ status: "waiting_input" })], "task-1")).toBe(
      true,
    );
    expect(hasActiveRunConflict([makeRun({ status: "completed" })], "task-1")).toBe(
      false,
    );
  });

  it("maps existing Kanban execution sources into run triggers", () => {
    expect(mapExecutionSourceToRunTrigger("scheduled")).toBe("scheduled");
    expect(mapExecutionSourceToRunTrigger("chained")).toBe("chained");
    expect(mapExecutionSourceToRunTrigger("manual")).toBe("manual");
    expect(mapExecutionSourceToRunTrigger("autoStart")).toBe("manual");
  });

  it("derives a shared surface descriptor for blocked and active runs", () => {
    expect(
      describeTaskRunSurface(
        makeRun({
          status: "blocked",
          blockedReason: "needs user input",
          availableRecoveryActions: ["open_conversation", "resume"],
        }),
      ),
    ).toMatchObject({
      severity: "danger",
      needsAttention: true,
      hintKey: "taskCenter.nextStep.resume",
      summary: "needs user input",
    });

    expect(
      describeTaskRunSurface(
        makeRun({
          status: "running",
          latestOutputSummary: "still executing",
          availableRecoveryActions: ["cancel"],
        }),
      ),
    ).toMatchObject({
      severity: "active",
      needsAttention: false,
      hintKey: "taskCenter.nextStep.monitor",
      summary: "still executing",
    });
  });

  it("sorts higher-attention surfaces before fresher but lower-priority runs", () => {
    const orderedRuns = [
      makeRun({ runId: "fresh-running", status: "running", updatedAt: 40 }),
      makeRun({ runId: "older-blocked", status: "blocked", updatedAt: 10 }),
    ].sort(compareTaskRunSurfacePriority);

    expect(orderedRuns[0]?.runId).toBe("older-blocked");
  });
});
