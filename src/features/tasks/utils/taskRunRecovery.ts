import type { KanbanTask } from "../../kanban/types";
import type { TaskRunRecord, TaskRunStoreData, TaskRunTrigger } from "../types";
import { beginTaskRunWithTrigger } from "./taskRunCoordinator";
import { buildLatestRunSummary } from "./taskRunProjection";
import {
  isTaskRunSettled,
  loadTaskRunStore,
  patchTaskRun,
  saveTaskRunStore,
} from "./taskRunStorage";

export type BeginTaskRunRecoveryResult =
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

export function beginTaskRunRecovery(params: {
  task: KanbanTask;
  trigger: Extract<TaskRunTrigger, "retry" | "forked">;
  parentRun?: TaskRunRecord | null;
  now?: number;
  store?: TaskRunStoreData;
}): BeginTaskRunRecoveryResult {
  const store = params.store ?? loadTaskRunStore();
  const result = beginTaskRunWithTrigger({
    store,
    task: params.task,
    trigger: params.trigger,
    now: params.now,
    parentRun: params.parentRun ?? null,
  });
  if (!result.ok) {
    return {
      ...result,
      latestRunSummary: buildLatestRunSummary(result.activeRun),
    };
  }
  saveTaskRunStore(result.store);
  return {
    ok: true,
    run: result.run,
    store: result.store,
    latestRunSummary: buildLatestRunSummary(result.run),
  };
}

export function cancelTaskRunRecovery(params: {
  runId: string;
  now?: number;
}): { run: TaskRunRecord | null; store: TaskRunStoreData } {
  const store = loadTaskRunStore();
  const nextStore = patchTaskRun(store, params.runId, {
    status: "canceled",
    blockedReason: null,
    failureReason: null,
    finishedAt: params.now ?? Date.now(),
    now: params.now ?? Date.now(),
  });
  saveTaskRunStore(nextStore);
  return {
    run: nextStore.runs.find((entry) => entry.runId === params.runId) ?? null,
    store: nextStore,
  };
}

export function canRetryTaskRun(run: TaskRunRecord): boolean {
  return isTaskRunSettled(run.status);
}
