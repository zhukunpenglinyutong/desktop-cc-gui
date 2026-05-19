import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../services/clientStorage", () => ({
  getClientStoreSync: vi.fn(),
  writeClientStoreValue: vi.fn(),
}));

import { getClientStoreSync, writeClientStoreValue } from "../../../services/clientStorage";
import {
  createTaskRunRecord,
  findActiveRunForTask,
  loadTaskRunStore,
  normalizeTaskRunStore,
  patchTaskRun,
  saveTaskRunStore,
  upsertTaskRun,
} from "./taskRunStorage";

describe("taskRunStorage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads valid run records and drops malformed persisted entries", () => {
    vi.mocked(getClientStoreSync).mockReturnValue({
      version: 1,
      runs: [
        {
          runId: "run-1",
          task: {
            taskId: "task-1",
            workspaceId: "/repo",
            title: "Build",
          },
          engine: "codex",
          status: "running",
          trigger: "manual",
          artifacts: [{ kind: "file", label: "src/a.ts", ref: "src/a.ts" }],
          availableRecoveryActions: ["open_conversation", "cancel", "cancel"],
          updatedAt: 20,
        },
        {
          runId: "",
          task: {},
          engine: "opencode",
          status: "running",
          trigger: "manual",
          updatedAt: 10,
        },
      ],
    });

    const store = loadTaskRunStore();

    expect(store.runs).toHaveLength(1);
    expect(store.runs[0]?.runId).toBe("run-1");
    expect(store.runs[0]?.availableRecoveryActions).toEqual([
      "open_conversation",
      "cancel",
    ]);
  });

  it("uses capability matrix semantics for codex task center support", () => {
    const run = createTaskRunRecord({
      taskId: "task-1",
      workspaceId: "/repo",
      engine: "codex",
      trigger: "manual",
      now: 100,
    });

    expect(run.engine).toBe("codex");
  });

  it("persists task runs under an independent app-store key", () => {
    const run = createTaskRunRecord({
      taskId: "task-1",
      workspaceId: "/repo",
      taskTitle: "Build",
      engine: "claude",
      trigger: "scheduled",
      now: 100,
    });

    saveTaskRunStore({ version: 1, runs: [run] });

    expect(writeClientStoreValue).toHaveBeenCalledWith(
      "app",
      "taskCenter.taskRuns",
      { version: 1, runs: [run] },
      { immediate: true },
    );
  });

  it("keeps parent and upstream lineage when records reload", () => {
    const normalized = normalizeTaskRunStore({
      version: 1,
      runs: [
        {
          runId: "run-child",
          task: { taskId: "task-2", workspaceId: "/repo" },
          engine: "gemini",
          status: "queued",
          trigger: "chained",
          parentRunId: "run-parent",
          upstreamRunId: "run-upstream",
          artifacts: [],
          availableRecoveryActions: [],
          updatedAt: 300,
        },
      ],
    });

    expect(normalized.runs[0]?.parentRunId).toBe("run-parent");
    expect(normalized.runs[0]?.upstreamRunId).toBe("run-upstream");
  });

  it("finds the newest active run deterministically", () => {
    const older = createTaskRunRecord({
      taskId: "task-1",
      workspaceId: "/repo",
      engine: "codex",
      trigger: "manual",
      now: 10,
    });
    const newer = {
      ...older,
      runId: "run-newer",
      status: "blocked" as const,
      updatedAt: 20,
    };
    const completed = {
      ...older,
      runId: "run-completed",
      status: "completed" as const,
      updatedAt: 30,
    };

    expect(findActiveRunForTask([older, newer, completed], "task-1")?.runId).toBe(
      "run-newer",
    );
  });

  it("patches run diagnostics without losing immutable identity fields", () => {
    const run = createTaskRunRecord({
      taskId: "task-1",
      workspaceId: "/repo",
      engine: "codex",
      trigger: "manual",
      now: 100,
    });
    const patched = patchTaskRun(upsertTaskRun({ version: 1, runs: [] }, run), run.runId, {
      status: "failed",
      failureReason: "boom",
      now: 200,
    });

    expect(patched.runs[0]).toMatchObject({
      runId: run.runId,
      task: run.task,
      engine: "codex",
      trigger: "manual",
      status: "failed",
      failureReason: "boom",
      updatedAt: 200,
    });
  });
});
