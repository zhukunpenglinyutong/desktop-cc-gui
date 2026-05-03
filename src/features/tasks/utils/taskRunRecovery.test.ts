import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KanbanTask } from "../../kanban/types";

vi.mock("./taskRunStorage", async () => {
  const actual = await vi.importActual<typeof import("./taskRunStorage")>("./taskRunStorage");
  return {
    ...actual,
    loadTaskRunStore: vi.fn(),
    saveTaskRunStore: vi.fn(),
  };
});

import { beginTaskRunRecovery, cancelTaskRunRecovery } from "./taskRunRecovery";
import {
  createTaskRunRecord,
  loadTaskRunStore,
  saveTaskRunStore,
} from "./taskRunStorage";

const mockedLoadTaskRunStore = vi.mocked(loadTaskRunStore);
const mockedSaveTaskRunStore = vi.mocked(saveTaskRunStore);

function makeTask(overrides: Partial<KanbanTask> = {}): KanbanTask {
  return {
    id: "task-1",
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
    threadId: "codex:thread-1",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("taskRunRecovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedLoadTaskRunStore.mockReturnValue({ version: 1, runs: [] });
  });

  it("creates a retry successor run with parent lineage", () => {
    const parentRun = createTaskRunRecord({
      taskId: "task-1",
      workspaceId: "/repo",
      taskTitle: "Task",
      engine: "codex",
      trigger: "manual",
      now: 10,
    });
    parentRun.status = "failed";

    const result = beginTaskRunRecovery({
      task: makeTask(),
      trigger: "retry",
      parentRun,
      now: 20,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.run.trigger).toBe("retry");
      expect(result.run.parentRunId).toBe(parentRun.runId);
    }
    expect(mockedSaveTaskRunStore).toHaveBeenCalledOnce();
  });

  it("marks a run as canceled in the persisted store", () => {
    const run = createTaskRunRecord({
      taskId: "task-1",
      workspaceId: "/repo",
      taskTitle: "Task",
      engine: "codex",
      trigger: "manual",
      now: 10,
    });
    mockedLoadTaskRunStore.mockReturnValue({ version: 1, runs: [run] });

    const result = cancelTaskRunRecovery({
      runId: run.runId,
      now: 33,
    });

    expect(result.run).toMatchObject({
      runId: run.runId,
      status: "canceled",
      finishedAt: 33,
    });
    expect(mockedSaveTaskRunStore).toHaveBeenCalledOnce();
  });
});
