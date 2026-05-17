import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

interface CommitSectionProps {
  commitPrompt: string;
  onCommitPromptChange: (prompt: string) => void;
  onSaveCommitPrompt: () => Promise<void>;
}

export function CommitSection({
  commitPrompt,
  onCommitPromptChange,
  onSaveCommitPrompt,
}: CommitSectionProps) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await onSaveCommitPrompt();
    } finally {
      setSaving(false);
    }
  }, [onSaveCommitPrompt]);

  return (
    <section className="settings-section">
      <div className="settings-section-title">
        {t("settings.commit.title")}
      </div>
      <div className="settings-section-subtitle">
        {t("settings.commit.description")}
      </div>

      <div className="settings-subsection-title">
        <span className="codicon codicon-edit" style={{ marginRight: 6 }} />
        {t("settings.commit.promptLabel")}
      </div>
      <div className="settings-commit-prompt-wrapper flex flex-col gap-2 mb-2">
        <textarea
          className="settings-commit-textarea w-full min-h-[120px] px-3 py-2.5 text-[13px] leading-normal text-(--text-strong) bg-[var(--surface-input,var(--background))] border border-(--border-muted) rounded-md resize-y font-inherit focus:border-(--primary) focus:outline-none"
          placeholder={t("settings.commit.promptPlaceholder")}
          value={commitPrompt}
          onChange={(e) => onCommitPromptChange(e.target.value)}
          rows={6}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleSave()}
          disabled={saving}
        >
          {saving && (
            <span className="codicon codicon-loading codicon-modifier-spin" style={{ marginRight: 4 }} />
          )}
          {t("common.save")}
        </Button>
      </div>
      <div className="settings-help">
        <span className="codicon codicon-info" style={{ marginRight: 4 }} />
        {t("settings.commit.promptHint")}
      </div>

      <div className="settings-commit-preview mt-6 relative">
        <div className="settings-coming-soon-badge inline-flex items-center gap-1 px-2.5 py-[2px] text-[11px] font-semibold text-(--primary) rounded-xl mb-3" style={{ background: "color-mix(in srgb, var(--primary) 12%, transparent)" }}>
          <span className="codicon codicon-sparkle" style={{ marginRight: 4 }} />
          {t("settings.placeholder.comingSoon")}
        </div>
        <div className="settings-subsection-title">
          <span className="codicon codicon-code" style={{ marginRight: 6 }} />
          {t("settings.commit.codeReviewLabel")}
        </div>
        <div className="settings-commit-prompt-wrapper flex flex-col gap-2 mb-2">
          <textarea
            className="settings-commit-textarea settings-commit-textarea--disabled w-full min-h-[120px] px-3 py-2.5 text-[13px] leading-normal text-(--text-strong) bg-[var(--surface-input,var(--background))] border border-(--border-muted) rounded-md resize-y font-inherit focus:border-(--primary) focus:outline-none opacity-50 cursor-not-allowed"
            placeholder={t("settings.commit.codeReviewPlaceholder")}
            disabled
            rows={4}
          />
          <Button variant="outline" size="sm" disabled>
            {t("common.save")}
          </Button>
        </div>
        <div className="settings-help">
          <span className="codicon codicon-info" style={{ marginRight: 4 }} />
          {t("settings.commit.codeReviewHint")}
        </div>
      </div>
    </section>
  );
}
