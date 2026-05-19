import { memo } from "react";
import { useTranslation } from "react-i18next";
import type { GovernanceEvidence } from "../../governance/evidence";

type GovernanceEvidenceSectionProps = {
  evidence: readonly GovernanceEvidence[];
  isLoading?: boolean;
};

const STATUS_CLASS = {
  pass: "is-pass",
  warn: "is-warn",
  fail: "is-fail",
  unknown: "is-unknown",
} as const;

export const GovernanceEvidenceSection = memo(function GovernanceEvidenceSection({
  evidence,
  isLoading = false,
}: GovernanceEvidenceSectionProps) {
  const { t } = useTranslation();

  if (!isLoading && evidence.length === 0) {
    return (
      <section className="sp-checkpoint-section sp-governance-evidence">
        <div className="sp-checkpoint-inline-heading">
          <span className="sp-checkpoint-section-title">{t("statusPanel.governance.title")}</span>
          <span className="sp-checkpoint-action-hint">{t("statusPanel.governance.empty")}</span>
        </div>
      </section>
    );
  }

  return (
    <section className="sp-checkpoint-section sp-governance-evidence">
      <div className="sp-checkpoint-inline-heading">
        <span className="sp-checkpoint-section-title">{t("statusPanel.governance.title")}</span>
        <span className="sp-checkpoint-action-hint">
          {isLoading
            ? t("statusPanel.governance.loading")
            : t("statusPanel.governance.count", { count: evidence.length })}
        </span>
      </div>
      {evidence.length > 0 ? (
        <ul className="sp-governance-evidence-list">
          {evidence.map((entry) => (
            <li key={entry.id} className="sp-governance-evidence-item">
              <span className={`sp-governance-evidence-status ${STATUS_CLASS[entry.status]}`}>
                {t(`statusPanel.governance.status.${entry.status}`)}
              </span>
              <span className="sp-governance-evidence-copy">
                <span className="sp-governance-evidence-title">{entry.title}</span>
                <span className="sp-governance-evidence-summary">{entry.summary}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
});

