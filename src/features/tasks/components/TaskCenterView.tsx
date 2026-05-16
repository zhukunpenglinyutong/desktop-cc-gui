import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TaskRunRecord, TaskRunStatus } from "../types";
import { hasActiveRunConflict } from "../utils/taskRunProjection";
import {
  compareTaskRunSurfacePriority,
  describeTaskRunSurface,
} from "../utils/taskRunSurface";
import {
  taskCenterBadgeClasses,
  taskCenterDetailClasses,
  taskCenterRunClasses,
} from "../utils/taskCenterClasses";

type TaskCenterViewProps = {
  runs: TaskRunRecord[];
  workspaceId?: string | null;
  onOpenConversation?: (threadId: string) => void;
  onRetryRun?: (run: TaskRunRecord) => void;
  onResumeRun?: (run: TaskRunRecord) => void;
  onCancelRun?: (run: TaskRunRecord) => void;
  onForkRun?: (run: TaskRunRecord) => void;
};

const STATUS_ORDER: TaskRunStatus[] = [
  "queued",
  "planning",
  "running",
  "waiting_input",
  "blocked",
  "failed",
  "completed",
  "canceled",
];

function formatRunTime(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "";
  }
  return new Date(value).toLocaleString();
}

export function TaskCenterView({
  runs,
  workspaceId = null,
  onOpenConversation,
  onRetryRun,
  onResumeRun,
  onCancelRun,
  onForkRun,
}: TaskCenterViewProps) {
  const { t } = useTranslation();
  const [statusFilter, setStatusFilter] = useState<TaskRunStatus | "all">("all");
  const [engineFilter, setEngineFilter] = useState<TaskRunRecord["engine"] | "all">("all");
  const workspaceRuns = useMemo(
    () =>
      runs
        .filter((run) => !workspaceId || run.task.workspaceId === workspaceId)
        .sort(compareTaskRunSurfacePriority),
    [runs, workspaceId],
  );
  const filteredRuns = workspaceRuns.filter(
    (run) =>
      (statusFilter === "all" || run.status === statusFilter) &&
      (engineFilter === "all" || run.engine === engineFilter),
  );
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const selectedRun =
    filteredRuns.find((run) => run.runId === selectedRunId) ?? filteredRuns[0] ?? null;
  const hasDuplicateConflict = selectedRun
    ? hasActiveRunConflict(workspaceRuns, selectedRun.task.taskId, selectedRun.runId)
    : false;
  const availableActions = new Set(selectedRun?.availableRecoveryActions ?? []);
  const canOpenConversation = Boolean(selectedRun?.linkedThreadId && onOpenConversation);
  const canRetry =
    Boolean(selectedRun && onRetryRun && availableActions.has("retry")) && !hasDuplicateConflict;
  const canResume = Boolean(selectedRun && onResumeRun && availableActions.has("resume"));
  const canCancel = Boolean(selectedRun && onCancelRun && availableActions.has("cancel"));
  const canFork =
    Boolean(selectedRun && onForkRun && availableActions.has("fork_new_run")) && !hasDuplicateConflict;
  const selectedRunSurface = selectedRun ? describeTaskRunSurface(selectedRun) : null;
  const highlightedRuns = filteredRuns.filter((run) => describeTaskRunSurface(run).needsAttention).length;

  const detailSeverity = selectedRunSurface?.severity ?? "muted";

  return (
    <section
      className="task-center w-full border border-[color-mix(in_srgb,var(--border-subtle)_88%,transparent)] rounded-[28px] max-md:rounded-[22px] bg-[linear-gradient(135deg,color-mix(in_srgb,#2563eb_8%,var(--surface-card-strong)),color-mix(in_srgb,var(--surface-card)_96%,transparent))] shadow-[0_24px_80px_color-mix(in_srgb,#000000_18%,transparent)] p-[22px] max-md:p-4"
      aria-label={t("taskCenter.title")}
    >
      <header className="task-center__header flex max-md:flex-col items-start justify-between gap-[18px] mb-[18px]">
        <div>
          <p className="task-center__eyebrow m-0 mb-1.5 text-[color-mix(in_srgb,var(--text-accent)_88%,var(--text-strong))] text-[11px] font-[750] tracking-[0.16em] uppercase">
            {t("taskCenter.eyebrow")}
          </p>
          <h2 className="m-0 text-[var(--text-stronger)] tracking-[-0.04em] text-[26px]">{t("taskCenter.title")}</h2>
          <p className="task-center__summary m-0 mt-2.5 text-[var(--text-muted)] text-[13px]">
            {t("taskCenter.summary", {
              total: filteredRuns.length,
              attention: highlightedRuns,
            })}
          </p>
        </div>
        <div className="task-center__filters flex flex-wrap gap-2.5">
          <label className="grid gap-1.5 text-[var(--text-muted)] text-xs font-[650]">
            {t("taskCenter.statusFilter")}
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as TaskRunStatus | "all")}
              className="border border-[color-mix(in_srgb,var(--border-subtle)_82%,transparent)] rounded-full bg-[color-mix(in_srgb,var(--surface-control)_90%,transparent)] text-[var(--text-strong)] font-inherit min-w-[128px] py-2 px-3"
            >
              <option value="all">{t("taskCenter.filterAll")}</option>
              {STATUS_ORDER.map((status) => (
                <option key={status} value={status}>
                  {t(`taskCenter.status.${status}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-[var(--text-muted)] text-xs font-[650]">
            {t("taskCenter.engineFilter")}
            <select
              value={engineFilter}
              onChange={(event) =>
                setEngineFilter(event.target.value as TaskRunRecord["engine"] | "all")
              }
              className="border border-[color-mix(in_srgb,var(--border-subtle)_82%,transparent)] rounded-full bg-[color-mix(in_srgb,var(--surface-control)_90%,transparent)] text-[var(--text-strong)] font-inherit min-w-[128px] py-2 px-3"
            >
              <option value="all">{t("taskCenter.filterAll")}</option>
              <option value="codex">Codex</option>
              <option value="claude">Claude Code</option>
              <option value="gemini">Gemini</option>
            </select>
          </label>
        </div>
      </header>

      <div className="task-center__body grid grid-cols-[minmax(220px,0.8fr)_minmax(0,1.2fr)] max-md:grid-cols-1 gap-4">
        <div className="task-center__list min-w-0 grid content-start gap-2.5">
          {filteredRuns.length === 0 ? (
            <p className="task-center__empty m-0 text-[var(--text-muted)] text-[13px] border border-dashed border-[color-mix(in_srgb,var(--border-subtle)_82%,transparent)] rounded-[18px] p-4">
              {t("taskCenter.empty")}
            </p>
          ) : (
            filteredRuns.map((run) => (
              (() => {
                const surface = describeTaskRunSurface(run);
                const runSummary = surface.summary || t("taskCenter.unavailable");
                const isSelected = selectedRun?.runId === run.runId;
                const baseRunBorder = `border border-[color-mix(in_srgb,var(--border-subtle)_84%,transparent)] bg-[color-mix(in_srgb,var(--surface-card-muted)_90%,transparent)]`;
                const severityClasses = isSelected
                  ? "border-[color-mix(in_srgb,#2563eb_54%,var(--border-subtle))] bg-[color-mix(in_srgb,#2563eb_14%,var(--surface-card-muted))]"
                  : taskCenterRunClasses(surface.severity);
                return (
                  <button
                    key={run.runId}
                    type="button"
                    className={`task-center__run task-center__run--${surface.severity} ${isSelected ? "is-selected" : ""} grid gap-[5px] w-full ${baseRunBorder} ${severityClasses} rounded-[18px] py-3 px-3.5 text-left`}
                    onClick={() => setSelectedRunId(run.runId)}
                  >
                    <span className="task-center__run-topline flex items-start justify-between gap-2.5">
                      <span className="task-center__run-title text-[var(--text-strong)] font-[720]">
                        {run.task.title || run.task.taskId}
                      </span>
                      <span className={`task-center__badge task-center__badge--${surface.severity} rounded-full border py-1.5 px-2.5 text-xs font-bold whitespace-nowrap ${taskCenterBadgeClasses(surface.severity)}`}>
                        {t(`taskCenter.status.${run.status}`)}
                      </span>
                    </span>
                    <span className="task-center__run-meta text-[var(--text-muted)] text-[13px]">
                      {run.engine} · {formatRunTime(run.updatedAt)}
                    </span>
                    <span className="task-center__run-summary text-[var(--text-strong)] text-[13px] leading-[1.45]">
                      {runSummary}
                    </span>
                    <span className="task-center__run-hint text-[var(--text-muted)] text-xs leading-[1.5]">
                      {t(surface.hintKey)}
                    </span>
                  </button>
                );
              })()
            ))
          )}
        </div>

        {selectedRun ? (
          <article
            className={`task-center__detail task-center__detail--${detailSeverity} min-w-0 border rounded-[22px] p-[18px] ${taskCenterDetailClasses(detailSeverity)}`}
          >
            <div className="task-center__detail-head flex max-md:flex-col items-start justify-between gap-3.5 mb-4">
              <div>
                <p className="task-center__eyebrow m-0 mb-1.5 text-[color-mix(in_srgb,var(--text-accent)_88%,var(--text-strong))] text-[11px] font-[750] tracking-[0.16em] uppercase">
                  {selectedRun.runId}
                </p>
                <h3 className="m-0 text-[var(--text-stronger)] tracking-[-0.04em] text-[22px]">
                  {selectedRun.task.title || selectedRun.task.taskId}
                </h3>
                <p className="task-center__detail-hint text-[var(--text-muted)] text-xs leading-[1.5]">
                  {selectedRunSurface ? t(selectedRunSurface.hintKey) : null}
                </p>
              </div>
              <span className={`task-center__badge task-center__badge--${detailSeverity} rounded-full border py-1.5 px-2.5 text-xs font-bold whitespace-nowrap ${taskCenterBadgeClasses(detailSeverity)}`}>
                {t(`taskCenter.status.${selectedRun.status}`)}
              </span>
            </div>
            <dl className="task-center__facts grid grid-cols-2 max-md:grid-cols-1 gap-3 m-0 mb-4">
              <div className="min-w-0">
                <dt className="text-[var(--text-muted)] text-xs font-bold">{t("taskCenter.trigger")}</dt>
                <dd className="mt-1 text-[var(--text-strong)] [overflow-wrap:anywhere]">{selectedRun.trigger}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[var(--text-muted)] text-xs font-bold">{t("taskCenter.updatedAt")}</dt>
                <dd className="mt-1 text-[var(--text-strong)] [overflow-wrap:anywhere]">{formatRunTime(selectedRun.updatedAt)}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[var(--text-muted)] text-xs font-bold">{t("taskCenter.currentStep")}</dt>
                <dd className="mt-1 text-[var(--text-strong)] [overflow-wrap:anywhere]">
                  {selectedRun.currentStep || t("taskCenter.unavailable")}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[var(--text-muted)] text-xs font-bold">{t("taskCenter.latestOutput")}</dt>
                <dd className="mt-1 text-[var(--text-strong)] [overflow-wrap:anywhere]">
                  {selectedRun.latestOutputSummary || t("taskCenter.unavailable")}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[var(--text-muted)] text-xs font-bold">{t("taskCenter.diagnostics")}</dt>
                <dd className="mt-1 text-[var(--text-strong)] [overflow-wrap:anywhere]">
                  {selectedRun.blockedReason ||
                    selectedRun.failureReason ||
                    t("taskCenter.unavailable")}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-[var(--text-muted)] text-xs font-bold">{t("taskCenter.artifacts")}</dt>
                <dd className="mt-1 text-[var(--text-strong)] [overflow-wrap:anywhere]">
                  {selectedRun.artifacts.length > 0
                    ? selectedRun.artifacts.map((artifact) => artifact.label).join(", ")
                    : t("taskCenter.noArtifacts")}
                </dd>
              </div>
            </dl>
            <div className="task-center__actions flex flex-wrap gap-2.5">
              <button
                type="button"
                disabled={!canOpenConversation}
                onClick={() => {
                  if (selectedRun.linkedThreadId) {
                    onOpenConversation?.(selectedRun.linkedThreadId);
                  }
                }}
                className="border border-[color-mix(in_srgb,var(--border-subtle)_82%,transparent)] rounded-full bg-[color-mix(in_srgb,var(--surface-control)_90%,transparent)] text-[var(--text-strong)] font-inherit py-2 px-3 text-[13px] font-bold disabled:cursor-not-allowed disabled:opacity-45"
              >
                {t("taskCenter.action.openConversation")}
              </button>
              <button
                type="button"
                disabled={!canRetry}
                onClick={() => onRetryRun?.(selectedRun)}
                className="border border-[color-mix(in_srgb,var(--border-subtle)_82%,transparent)] rounded-full bg-[color-mix(in_srgb,var(--surface-control)_90%,transparent)] text-[var(--text-strong)] font-inherit py-2 px-3 text-[13px] font-bold disabled:cursor-not-allowed disabled:opacity-45"
              >
                {t("taskCenter.action.retry")}
              </button>
              <button
                type="button"
                disabled={!canResume}
                onClick={() => onResumeRun?.(selectedRun)}
                className="border border-[color-mix(in_srgb,var(--border-subtle)_82%,transparent)] rounded-full bg-[color-mix(in_srgb,var(--surface-control)_90%,transparent)] text-[var(--text-strong)] font-inherit py-2 px-3 text-[13px] font-bold disabled:cursor-not-allowed disabled:opacity-45"
              >
                {t("taskCenter.action.resume")}
              </button>
              <button
                type="button"
                disabled={!canCancel}
                onClick={() => onCancelRun?.(selectedRun)}
                className="border border-[color-mix(in_srgb,var(--border-subtle)_82%,transparent)] rounded-full bg-[color-mix(in_srgb,var(--surface-control)_90%,transparent)] text-[var(--text-strong)] font-inherit py-2 px-3 text-[13px] font-bold disabled:cursor-not-allowed disabled:opacity-45"
              >
                {t("taskCenter.action.cancel")}
              </button>
              <button
                type="button"
                disabled={!canFork}
                onClick={() => onForkRun?.(selectedRun)}
                className="border border-[color-mix(in_srgb,var(--border-subtle)_82%,transparent)] rounded-full bg-[color-mix(in_srgb,var(--surface-control)_90%,transparent)] text-[var(--text-strong)] font-inherit py-2 px-3 text-[13px] font-bold disabled:cursor-not-allowed disabled:opacity-45"
              >
                {t("taskCenter.action.fork")}
              </button>
            </div>
          </article>
        ) : null}
      </div>
    </section>
  );
}
