import type {
  KanbanLatestRunSummary,
  TaskRunRecord,
  TaskRunRecoveryAction,
  TaskRunStatus,
} from "../types";

export type TaskRunSurfaceSeverity =
  | "active"
  | "attention"
  | "danger"
  | "success"
  | "muted";

export type TaskRunSurfaceDescriptor = {
  severity: TaskRunSurfaceSeverity;
  priority: number;
  needsAttention: boolean;
  summary: string | null;
  hintKey:
    | "taskCenter.nextStep.monitor"
    | "taskCenter.nextStep.openConversation"
    | "taskCenter.nextStep.resume"
    | "taskCenter.nextStep.retry"
    | "taskCenter.nextStep.wait"
    | "taskCenter.nextStep.review"
    | "taskCenter.nextStep.fork";
};

type TaskRunSurfaceSource = Pick<
  TaskRunRecord,
  | "status"
  | "currentStep"
  | "latestOutputSummary"
  | "blockedReason"
  | "failureReason"
  | "availableRecoveryActions"
  | "linkedThreadId"
  | "updatedAt"
> &
  Partial<Pick<TaskRunRecord, "finishedAt">>;

type TaskRunSurfaceSummarySource = Pick<
  KanbanLatestRunSummary,
  | "status"
  | "latestOutputSummary"
  | "blockedReason"
  | "failureReason"
  | "linkedThreadId"
  | "updatedAt"
> &
  Partial<Pick<KanbanLatestRunSummary, "finishedAt">>;

function isFullTaskRunSurfaceSource(
  run: TaskRunSurfaceSource | TaskRunSurfaceSummarySource,
): run is TaskRunSurfaceSource {
  return "availableRecoveryActions" in run;
}

const STATUS_PRIORITY: Record<TaskRunStatus, number> = {
  blocked: 100,
  failed: 95,
  waiting_input: 90,
  running: 80,
  planning: 70,
  queued: 60,
  completed: 40,
  canceled: 30,
};

function normalizeSummaryText(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function hasRecoveryAction(
  actions: TaskRunRecoveryAction[] | null | undefined,
  action: TaskRunRecoveryAction,
): boolean {
  return Array.isArray(actions) && actions.includes(action);
}

export function describeTaskRunSurface(
  run: TaskRunSurfaceSource | TaskRunSurfaceSummarySource,
): TaskRunSurfaceDescriptor {
  const status = run.status;
  const recoveryActions = isFullTaskRunSurfaceSource(run) ? run.availableRecoveryActions : [];
  const summary =
    status === "blocked"
      ? normalizeSummaryText(run.blockedReason) ??
        normalizeSummaryText(run.latestOutputSummary) ??
        ("currentStep" in run ? normalizeSummaryText(run.currentStep) : null)
      : status === "failed"
        ? normalizeSummaryText(run.failureReason) ??
          normalizeSummaryText(run.latestOutputSummary) ??
          ("currentStep" in run ? normalizeSummaryText(run.currentStep) : null)
        : normalizeSummaryText(run.latestOutputSummary) ??
          ("currentStep" in run ? normalizeSummaryText(run.currentStep) : null) ??
          normalizeSummaryText(run.blockedReason) ??
          normalizeSummaryText(run.failureReason);

  if (status === "blocked") {
    return {
      severity: "danger",
      priority: STATUS_PRIORITY[status],
      needsAttention: true,
      summary,
      hintKey: hasRecoveryAction(recoveryActions, "resume")
        ? "taskCenter.nextStep.resume"
        : run.linkedThreadId
          ? "taskCenter.nextStep.openConversation"
          : "taskCenter.nextStep.review",
    };
  }

  if (status === "failed") {
    return {
      severity: "danger",
      priority: STATUS_PRIORITY[status],
      needsAttention: true,
      summary,
      hintKey: hasRecoveryAction(recoveryActions, "retry")
        ? "taskCenter.nextStep.retry"
        : run.linkedThreadId
          ? "taskCenter.nextStep.openConversation"
          : hasRecoveryAction(recoveryActions, "fork_new_run")
            ? "taskCenter.nextStep.fork"
            : "taskCenter.nextStep.review",
    };
  }

  if (status === "waiting_input") {
    return {
      severity: "attention",
      priority: STATUS_PRIORITY[status],
      needsAttention: true,
      summary,
      hintKey: run.linkedThreadId
        ? "taskCenter.nextStep.openConversation"
        : "taskCenter.nextStep.review",
    };
  }

  if (status === "running" || status === "planning" || status === "queued") {
    return {
      severity: "active",
      priority: STATUS_PRIORITY[status],
      needsAttention: false,
      summary,
      hintKey: hasRecoveryAction(recoveryActions, "cancel")
        ? "taskCenter.nextStep.monitor"
        : "taskCenter.nextStep.wait",
    };
  }

  if (status === "completed") {
    return {
      severity: "success",
      priority: STATUS_PRIORITY[status],
      needsAttention: false,
      summary,
      hintKey: run.linkedThreadId
        ? "taskCenter.nextStep.openConversation"
        : "taskCenter.nextStep.review",
    };
  }

  return {
    severity: "muted",
    priority: STATUS_PRIORITY[status],
    needsAttention: false,
    summary,
    hintKey: hasRecoveryAction(recoveryActions, "fork_new_run")
      ? "taskCenter.nextStep.fork"
      : "taskCenter.nextStep.review",
  };
}

export function compareTaskRunSurfacePriority(
  left: TaskRunSurfaceSource | TaskRunSurfaceSummarySource,
  right: TaskRunSurfaceSource | TaskRunSurfaceSummarySource,
): number {
  const priorityDelta =
    describeTaskRunSurface(right).priority - describeTaskRunSurface(left).priority;
  if (priorityDelta !== 0) {
    return priorityDelta;
  }
  return right.updatedAt - left.updatedAt;
}
