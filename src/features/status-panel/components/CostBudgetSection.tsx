import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { EngineType, ThreadTokenUsage } from "../../../types";
import type { SessionBudgetConfig } from "../../context-ledger/cost-budget";
import {
  aggregateWorkspaceCost,
  projectCostRecord,
  resolveBudgetThresholdSignal,
} from "../../context-ledger/cost-budget";

type CostBudgetSectionProps = {
  engine: EngineType | null | undefined;
  model: string | null | undefined;
  usage: ThreadTokenUsage | null | undefined;
  sessionId: string | null | undefined;
  budget?: SessionBudgetConfig | null;
  compact?: boolean;
};

function formatUsd(value: number | null) {
  if (value == null) {
    return "—";
  }
  if (value < 0.01) {
    return `$${value.toFixed(4)}`;
  }
  return `$${value.toFixed(2)}`;
}

export const CostBudgetSection = memo(function CostBudgetSection({
  budget = null,
  compact = false,
  engine,
  model,
  sessionId,
  usage,
}: CostBudgetSectionProps) {
  const { t } = useTranslation();
  const projection = useMemo(() => {
    if (!engine) {
      return null;
    }
    const sessionRecord = projectCostRecord({
      engine,
      model,
      usage,
      scope: "session",
    });
    return aggregateWorkspaceCost([sessionRecord]);
  }, [engine, model, usage]);
  const budgetSignal = useMemo(
    () =>
      resolveBudgetThresholdSignal({
        sessionId: sessionId ?? "",
        amountUsd: projection?.amountUsd ?? null,
        budget,
      }),
    [budget, projection?.amountUsd, sessionId],
  );

  if (!engine || !usage || !projection) {
    return null;
  }

  const primaryRecord = projection.records[0] ?? null;
  return (
    <section className={`sp-checkpoint-section sp-cost-budget${compact ? " is-compact" : ""}`}>
      <div className="sp-checkpoint-inline-heading">
        <span className="sp-checkpoint-section-title">{t("statusPanel.cost.title")}</span>
        <span className="sp-checkpoint-action-hint">
          {projection.partial ? t("statusPanel.cost.partial") : t("statusPanel.cost.known")}
        </span>
      </div>
      <div className="sp-checkpoint-evidence-summary-badges">
        <span className="sp-checkpoint-evidence-badge">
          {t("statusPanel.cost.session")}: {formatUsd(projection.amountUsd)}
        </span>
        <span className="sp-checkpoint-evidence-badge">
          {t("statusPanel.cost.engine")}: {engine}
        </span>
        <span className="sp-checkpoint-evidence-badge">
          {t("statusPanel.cost.model")}: {model || t("statusPanel.cost.unknownModel")}
        </span>
      </div>
      {primaryRecord?.degraded ? (
        <div className="sp-checkpoint-validation-guide">
          <span className="sp-checkpoint-validation-guide-label">
            {t(`statusPanel.cost.degraded.${primaryRecord.degradationReason ?? "unknown"}`)}
          </span>
        </div>
      ) : null}
      {budgetSignal ? (
        <div className={`sp-checkpoint-validation-guide is-${budgetSignal.severity}`}>
          <span className="sp-checkpoint-validation-guide-label">
            {t(`statusPanel.budget.threshold.${budgetSignal.tier}`, {
              amount: formatUsd(budgetSignal.amountUsd),
              threshold: formatUsd(budgetSignal.thresholdUsd),
            })}
          </span>
        </div>
      ) : null}
    </section>
  );
});
