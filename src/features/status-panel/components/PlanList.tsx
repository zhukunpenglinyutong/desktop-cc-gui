import { memo } from "react";
import { useTranslation } from "react-i18next";
import type { TurnPlan } from "../../../types";
import { resolvePlanStepStatusForDisplay } from "../../threads/utils/threadNormalize";

interface PlanListProps {
  plan: TurnPlan | null;
  isPlanMode: boolean;
  isProcessing: boolean;
  isCodexEngine?: boolean;
}

const STATUS_COLOR_CLASS = {
  completed: "text-[#89d185]",
  inProgress: "text-[#61afef]",
  pending: "text-(--text-muted)",
} as const;

export const PlanList = memo(function PlanList({
  plan,
  isPlanMode,
  isProcessing,
  isCodexEngine = false,
}: PlanListProps) {
  const { t } = useTranslation();
  const steps = plan?.steps ?? [];

  if (!isPlanMode && !isCodexEngine) {
    return (
      <div className="sp-empty p-4 text-center text-(--text-faint) text-xs">
        {t("statusPanel.planSwitchHint")}
      </div>
    );
  }
  if (isProcessing && steps.length === 0) {
    return (
      <div className="sp-empty p-4 text-center text-(--text-faint) text-xs">
        {t("statusPanel.planGenerating")}
      </div>
    );
  }
  if (steps.length === 0) {
    return (
      <div className="sp-empty p-4 text-center text-(--text-faint) text-xs">
        {t("statusPanel.emptyPlan")}
      </div>
    );
  }

  return (
    <div className="sp-plan-panel flex flex-col gap-2.5">
      {plan?.explanation ? (
        <div className="sp-plan-explanation text-xs leading-snug text-(--text-muted) whitespace-pre-wrap">
          {plan.explanation}
        </div>
      ) : null}
      <ol className="sp-plan-list flex flex-col gap-1.5 m-0 p-0 list-none">
        {steps.map((step, index) => {
          const statusForDisplay = resolvePlanStepStatusForDisplay(step.status, isProcessing);
          const statusColor =
            STATUS_COLOR_CLASS[statusForDisplay as keyof typeof STATUS_COLOR_CLASS] ??
            "text-(--text-muted)";
          return (
            <li
              key={`${step.step}-${index}`}
              className={`sp-plan-item sp-plan-${statusForDisplay} flex items-start gap-2 px-2 py-1.5 rounded-lg hover:bg-(--surface-hover)`}
            >
              <span
                className={`sp-plan-status w-4 shrink-0 font-mono ${statusColor}`}
                aria-hidden
              >
                {statusForDisplay === "completed" ? "✓" : statusForDisplay === "inProgress" ? "…" : "○"}
              </span>
              <span className="sp-plan-text text-xs leading-snug text-(--text-strong) break-words">
                {step.step}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
});
