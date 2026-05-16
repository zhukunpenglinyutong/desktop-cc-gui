import { useTranslation } from "react-i18next";
import type { TurnPlan } from "../../../types";
import { resolvePlanStepStatusForDisplay } from "../../threads/utils/threadNormalize";

type PlanPanelProps = {
  plan: TurnPlan | null;
  isProcessing: boolean;
  isPlanMode: boolean;
  isCodexEngine?: boolean;
  onClose?: () => void;
};

function formatProgress(plan: TurnPlan) {
  const total = plan.steps.length;
  if (!total) {
    return "";
  }
  const completed = plan.steps.filter((step) => step.status === "completed").length;
  return `${completed}/${total}`;
}

function statusLabel(status: TurnPlan["steps"][number]["status"]) {
  if (status === "completed") {
    return "[x]";
  }
  if (status === "inProgress") {
    return "[>]";
  }
  return "[ ]";
}

export function PlanPanel({
  plan,
  isProcessing,
  isPlanMode,
  isCodexEngine = false,
  onClose,
}: PlanPanelProps) {
  const { t } = useTranslation();
  const progress = plan ? formatProgress(plan) : "";
  const steps = plan?.steps ?? [];
  const showEmpty = !steps.length && !plan?.explanation;
  const noPlanLabel = t("plan.noPlan");
  const emptyLabel = !isPlanMode && !isCodexEngine
    ? t("statusPanel.planSwitchHint")
    : isProcessing
      ? t("statusPanel.planGenerating")
      : noPlanLabel === "plan.noPlan"
        ? t("statusPanel.emptyPlan")
        : noPlanLabel;

  return (
    <aside className="plan-panel bg-transparent border-none rounded-none mx-3 my-0 px-0.5 py-0 flex flex-col gap-3 [-webkit-app-region:no-drag] h-full min-h-0">
      <div className="plan-header flex justify-between items-center text-[13px] font-medium text-(--text-subtle)">
        <span>{t("plan.title")}</span>
        <div className="plan-header-actions inline-flex items-center gap-2.5">
          {progress && (
            <span className="plan-progress text-xs tracking-wide text-(--text-faint) tabular-nums font-mono">
              {progress}
            </span>
          )}
          {onClose && (
            <button
              type="button"
              className="plan-toggle-btn inline-flex items-center justify-start w-[34px] h-5 p-0.5 rounded-full border border-(--border-subtle) bg-transparent text-(--text-faint) cursor-pointer transition-[border-color,background] duration-150 hover:border-(--border-strong) hover:bg-[color-mix(in_srgb,var(--surface-item)_72%,transparent)]"
              onClick={onClose}
              aria-label={t("tools.closePlanPanel")}
              title={t("tools.closePlanPanel")}
            >
              <span
                className="plan-toggle-thumb w-3.5 h-3.5 rounded-full bg-(--surface-card) border border-[color-mix(in_srgb,var(--border-strong)_88%,transparent)] shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
                aria-hidden
              />
            </button>
          )}
        </div>
      </div>
      {plan?.explanation && (
        <div className="plan-explanation text-xs text-(--text-muted) whitespace-pre-wrap">
          {plan.explanation}
        </div>
      )}
      {showEmpty ? (
        <div className="plan-empty text-xs text-(--text-faint)">{emptyLabel}</div>
      ) : (
        <ol className="plan-list flex flex-col gap-2.5 overflow-y-auto min-h-0 pr-0.5 m-0 pl-0 list-none">
          {steps.map((step, index) => {
            const stepStatus = resolvePlanStepStatusForDisplay(step.status, isProcessing);
            const statusColorClass =
              stepStatus === "inProgress"
                ? "text-[#86b7ff]"
                : stepStatus === "completed"
                  ? "text-[#47d488]"
                  : "text-(--text-faint)";
            return (
              <li
                key={`${step.step}-${index}`}
                className={`plan-step ${stepStatus} flex gap-2 items-start text-sm font-medium text-(--text-emphasis)`}
              >
                <span
                  className={`plan-step-status font-mono text-sm leading-[1.3] flex-none ${statusColorClass}`}
                  aria-hidden
                >
                  {statusLabel(stepStatus)}
                </span>
                <span className="plan-step-text flex-1 min-w-0 wrap-break-word">{step.step}</span>
              </li>
            );
          })}
        </ol>
      )}
    </aside>
  );
}
