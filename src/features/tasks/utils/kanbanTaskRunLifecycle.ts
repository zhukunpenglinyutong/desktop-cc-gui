import type { KanbanTask, KanbanTaskExecutionSource } from "../../kanban/types";
import type { TaskRunRecord, TaskRunStoreData } from "../types";
import { beginTaskRun } from "./taskRunCoordinator";
import { buildLatestRunSummary } from "./taskRunProjection";
import {
  loadTaskRunStore,
  patchTaskRun,
  saveTaskRunStore,
} from "./taskRunStorage";

export type KanbanTaskRunLifecycleResult =
  | {
      ok: true;
      run: TaskRunRecord;
      store: TaskRunStoreData;
      latestRunSummary: KanbanTask["latestRunSummary"];
    }
  | {
      ok: false;
      reason: "active_run_exists" | "unsupported_engine" | "parent_not_settled";
      activeRun?: TaskRunRecord;
      store: TaskRunStoreData;
      latestRunSummary: KanbanTask["latestRunSummary"];
    };

type PatchRunInput = {
  runId: string | null | undefined;
  status?: TaskRunRecord["status"];
  linkedThreadId?: string | null;
  currentStep?: string | null;
  latestOutputSummary?: string | null;
  blockedReason?: string | null;
  failureReason?: string | null;
  startedAt?: number | null;
  finishedAt?: number | null;
  now?: number;
};

function assignIfDefined<T extends Record<string, unknown>, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | undefined,
): void {
  if (value !== undefined) {
    target[key] = value;
  }
}

function buildResultFromRun(
  store: TaskRunStoreData,
  run: TaskRunRecord,
): Extract<KanbanTaskRunLifecycleResult, { ok: true }> {
  return {
    ok: true,
    run,
    store,
    latestRunSummary: buildLatestRunSummary(run),
  };
}

export function beginKanbanTaskRunLifecycle(params: {
  task: KanbanTask;
  source: KanbanTaskExecutionSource;
  now?: number;
  store?: TaskRunStoreData;
}): KanbanTaskRunLifecycleResult {
  const store = params.store ?? loadTaskRunStore();
  const result = beginTaskRun({
    store,
    task: params.task,
    source: params.source,
    now: params.now,
  });
  if (!result.ok) {
    return {
      ...result,
      latestRunSummary: buildLatestRunSummary(result.activeRun),
    };
  }
  saveTaskRunStore(result.store);
  return buildResultFromRun(result.store, result.run);
}

export function patchKanbanTaskRunLifecycle(
  input: PatchRunInput,
): Extract<KanbanTaskRunLifecycleResult, { ok: true }> | null {
  if (!input.runId) {
    return null;
  }
  const currentStore = loadTaskRunStore();
  const patch: Parameters<typeof patchTaskRun>[2] = {};
  assignIfDefined(patch, "status", input.status);
  assignIfDefined(patch, "linkedThreadId", input.linkedThreadId);
  assignIfDefined(patch, "currentStep", input.currentStep);
  assignIfDefined(patch, "latestOutputSummary", input.latestOutputSummary);
  assignIfDefined(patch, "blockedReason", input.blockedReason);
  assignIfDefined(patch, "failureReason", input.failureReason);
  assignIfDefined(patch, "startedAt", input.startedAt);
  assignIfDefined(patch, "finishedAt", input.finishedAt);
  assignIfDefined(patch, "now", input.now);
  if (input.status) {
    patch.availableRecoveryActions =
      input.status === "blocked" || input.status === "failed"
        ? ["open_conversation", "retry", "resume"]
        : input.status === "completed" || input.status === "canceled"
          ? ["open_conversation", "fork_new_run"]
          : ["open_conversation", "cancel"];
  }
  const nextStore = patchTaskRun(currentStore, input.runId, {
    ...patch,
  });
  saveTaskRunStore(nextStore);
  const run = nextStore.runs.find((entry) => entry.runId === input.runId);
  return run ? buildResultFromRun(nextStore, run) : null;
}
