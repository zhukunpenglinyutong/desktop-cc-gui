import { useTranslation } from "react-i18next";
import type { PolicyDecision } from "../../utils/policies";
import { PolicyEntryRow } from "./PolicyEntryRow";

type PolicyDecisionAuditPanelProps = {
  policyAudit: readonly PolicyDecision[];
};

export function PolicyDecisionAuditPanel({ policyAudit }: PolicyDecisionAuditPanelProps) {
  const { t } = useTranslation();

  if (policyAudit.length === 0) {
    return null;
  }

  return (
    <details className="sp-checkpoint-section sp-checkpoint-section--policy-audit">
      <summary className="sp-checkpoint-inline-heading">
        <span className="sp-checkpoint-section-title">{t("statusPanel.audit.title")}</span>
        <span className="sp-checkpoint-action-hint">
          {t("statusPanel.audit.expandLabel", { count: policyAudit.length })}
        </span>
      </summary>
      <ul className="sp-checkpoint-risk-list">
        {policyAudit.map((entry) => (
          <PolicyEntryRow
            key={`${entry.policyId}:${entry.verdictContribution}:${entry.reasonKey ?? "none"}:${entry.sourceId ?? "none"}`}
            decision={entry}
          />
        ))}
      </ul>
    </details>
  );
}
