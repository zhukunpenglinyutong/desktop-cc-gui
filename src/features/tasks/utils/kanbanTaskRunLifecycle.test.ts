import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KanbanTask } from "../../kanban/types";
import type { TaskRunStoreData } from "../types";

vi.mock("./taskRunStorage", async () => {
  const actual = await vi.importActual<typeof import("./taskRunStorage")>(
    "./taskRunStorage",
  );
  return {
    ...actual,
    loadTaskRunStore: vi.fn(),
    saveTaskRunStore: vi.fn(),
  };
});

import {
  beginKanbanTaskRunLifecycle,
  patchKanbanTaskRunLifecycle,
} from "./kanbanTaskRunLifecycle";
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
    threadId: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("kanbanTaskRunLifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedLoadTaskRunStore.mockReturnValue({ version: 1, runs: [] });
  });

  it("begins a task run and returns a Kanban latest-run summary", () => {
    const result = beginKanbanTaskRunLifecycle({
      task: makeTask({ threadId: "codex:thread-1" }),
      source: "scheduled",
      now: 100,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.run.trigger).toBe("scheduled");
      expect(result.run.status).toBe("queued");
      expect(result.latestRunSummary).toMatchObject({
        runId: result.run.runId,
        status: "queued",
        trigger: "scheduled",
        linkedThreadId: "codex:thread-1",
      });
    }
    expect(mockedSaveTaskRunStore).toHaveBeenCalledOnce();
  });

  it("returns active-run conflict without creating a duplicate run", () => {
    const activeRun = createTaskRunRecord({
      taskId: "task-1",
      workspaceId: "/repo",
      taskTitle: "Task",
      engine: "codex",
      trigger: "manual",
      now: 100,
    });
    const store: TaskRunStoreData = { version: 1, runs: [activeRun] };
    mockedLoadTaskRunStore.mockReturnValue(store);

    const result = beginKanbanTaskRunLifecycle({
      task: makeTask(),
      source: "manual",
      now: 200,
    });

    expect(result).toMatchObject({
      ok: false,
      reason: "active_run_exists",
      activeRun,
      latestRunSummary: {
        runId: activeRun.runId,
        status: "queued",
      },
    });
    expect(mockedSaveTaskRunStore).not.toHaveBeenCalled();
  });

  it("patches a run as running with linked thread id", () => {
    const run = createTaskRunRecord({
      taskId: "task-1",
      workspaceId: "/repo",
      engine: "codex",
      trigger: "manual",
      now: 100,
    });
    mockedLoadTaskRunStore.mockReturnValue({ version: 1, runs: [run] });

    const result = patchKanbanTaskRunLifecycle({
      runId: run.runId,
      status: "running",
      linkedThreadId: "codex:thread-1",
      startedAt: 200,
      now: 200,
    });

    expect(result?.run).toMatchObject({
      runId: run.runId,
      status: "running",
      linkedThreadId: "codex:thread-1",
      startedAt: 200,
    });
    expect(result?.latestRunSummary).toMatchObject({
      runId: run.runId,
      status: "running",
      linkedThreadId: "codex:thread-1",
    });
    expect(mockedSaveTaskRunStore).toHaveBeenCalledOnce();
  });

  it("patches blocked and failed diagnostics into recovery-ready summaries", () => {
    const run = createTaskRunRecord({
      taskId: "task-1",
      workspaceId: "/repo",
      engine: "codex",
      trigger: "manual",
      now: 100,
    });
    mockedLoadTaskRunStore.mockReturnValue({ version: 1, runs: [run] });

    const blocked = patchKanbanTaskRunLifecycle({
      runId: run.runId,
      status: "blocked",
      blockedReason: "non_reentrant_trigger_blocked",
      now: 150,
    });

    expect(blocked?.run.availableRecoveryActions).toEqual([
      "open_conversation",
      "retry",
      "resume",
    ]);
    expect(blocked?.latestRunSummary?.blockedReason).toBe(
      "non_reentrant_trigger_blocked",
    );

    mockedLoadTaskRunStore.mockReturnValue({ version: 1, runs: [blocked!.run] });
    const failed = patchKanbanTaskRunLifecycle({
      runId: run.runId,
      status: "failed",
      failureReason: "thread_create_failed",
      finishedAt: 180,
      now: 180,
    });

    expect(failed?.run.status).toBe("failed");
    expect(failed?.latestRunSummary?.failureReason).toBe("thread_create_failed");
  });
});
