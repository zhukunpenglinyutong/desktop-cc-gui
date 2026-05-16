import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import X from "lucide-react/dist/esm/icons/x";
import type { ModelMapping } from "../../models/constants";
import {
  getModelMapping,
  saveModelMapping,
} from "../../models/constants";

interface ModelMappingSettingsProps {
  reduceTransparency: boolean;
}

export function ModelMappingSettings({
  // reduceTransparency - reserved for future use
  reduceTransparency: _reduceTransparency,
}: ModelMappingSettingsProps) {
  const { t } = useTranslation();
  const [mapping, setMapping] = useState<ModelMapping>({});
  const [draftValues, setDraftValues] = useState<ModelMapping>({});

  // Load initial mapping
  useEffect(() => {
    setMapping(getModelMapping());
    setDraftValues(getModelMapping());
  }, []);

  const handleSave = useCallback(() => {
    const filtered: ModelMapping = {};
    if (draftValues.sonnet?.trim()) {
      filtered.sonnet = draftValues.sonnet.trim();
    }
    if (draftValues.opus?.trim()) {
      filtered.opus = draftValues.opus.trim();
    }
    if (draftValues.haiku?.trim()) {
      filtered.haiku = draftValues.haiku.trim();
    }
    saveModelMapping(filtered);
    setMapping(filtered);
  }, [draftValues]);

  const handleReset = useCallback(() => {
    const current = getModelMapping();
    setDraftValues(current);
  }, []);

  const handleClear = useCallback(() => {
    const empty: ModelMapping = {};
    saveModelMapping(empty);
    setMapping(empty);
    setDraftValues(empty);
  }, []);

  const hasChanges =
    (draftValues.sonnet ?? "") !== (mapping.sonnet ?? "") ||
    (draftValues.opus ?? "") !== (mapping.opus ?? "") ||
    (draftValues.haiku ?? "") !== (mapping.haiku ?? "");

  const hasAnyMapping =
    (mapping.sonnet ?? "") !== "" ||
    (mapping.opus ?? "") !== "" ||
    (mapping.haiku ?? "") !== "";

  return (
    <div className="settings-card model-mapping-card p-4 rounded-xl border border-[var(--border-muted)] bg-[var(--surface-card)]">
      <div className="settings-card-header mb-3">
        <div className="settings-card-title-row flex items-center justify-between gap-3">
          <h3 className="settings-card-title text-[13px] font-semibold text-[var(--text-strong)] m-0">
            {t("settings.modelMappingTitle")}
          </h3>
          {hasAnyMapping && (
            <button
              type="button"
              className="settings-card-badge model-mapping-badge inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[var(--border-muted)] bg-[var(--surface-control)] text-[var(--text-muted)] text-[11px] cursor-pointer transition-all duration-150 hover:border-[var(--border-strong)] hover:text-[var(--text-error)] [&_svg]:w-3 [&_svg]:h-3"
              onClick={handleClear}
              title={t("settings.modelMappingClear")}
            >
              <X size={14} />
              {t("settings.clear")}
            </button>
          )}
        </div>
        <p className="settings-card-description text-[11px] text-[var(--text-subtle)] mt-1 mb-0">
          {t("settings.modelMappingDescription")}
        </p>
      </div>

      <div className="model-mapping-fields flex flex-col gap-2.5 mb-3">
        <div className="model-mapping-field flex flex-col gap-1">
          <label htmlFor="model-mapping-sonnet" className="model-mapping-label flex flex-col gap-0.5 text-xs font-medium text-[var(--text-strong)]">
            {t("settings.modelMappingSonnet")}
            <span className="model-mapping-default text-[10px] text-[var(--text-faint)] font-[var(--font-code,'SF_Mono','Fira_Code',monospace)]">
              {t("settings.modelMappingDefault", { model: "sonnet" })}
            </span>
          </label>
          <input
            id="model-mapping-sonnet"
            type="text"
            className="model-mapping-input px-2.5 py-2 rounded-lg border border-[var(--border-muted)] bg-[var(--surface-control)] text-[var(--text-strong)] text-xs font-[var(--font-code,'SF_Mono','Fira_Code',monospace)] outline-none transition-[border-color] duration-150 focus:border-[var(--border-accent)] placeholder:text-[var(--text-faint)]"
            placeholder={t("settings.modelMappingPlaceholder")}
            value={draftValues.sonnet ?? ""}
            onChange={(e) =>
              setDraftValues((prev) => ({ ...prev, sonnet: e.target.value }))
            }
          />
        </div>

        <div className="model-mapping-field flex flex-col gap-1">
          <label htmlFor="model-mapping-opus" className="model-mapping-label flex flex-col gap-0.5 text-xs font-medium text-[var(--text-strong)]">
            {t("settings.modelMappingOpus")}
            <span className="model-mapping-default text-[10px] text-[var(--text-faint)] font-[var(--font-code,'SF_Mono','Fira_Code',monospace)]">
              {t("settings.modelMappingDefault", { model: "opus" })}
            </span>
          </label>
          <input
            id="model-mapping-opus"
            type="text"
            className="model-mapping-input px-2.5 py-2 rounded-lg border border-[var(--border-muted)] bg-[var(--surface-control)] text-[var(--text-strong)] text-xs font-[var(--font-code,'SF_Mono','Fira_Code',monospace)] outline-none transition-[border-color] duration-150 focus:border-[var(--border-accent)] placeholder:text-[var(--text-faint)]"
            placeholder={t("settings.modelMappingPlaceholder")}
            value={draftValues.opus ?? ""}
            onChange={(e) =>
              setDraftValues((prev) => ({ ...prev, opus: e.target.value }))
            }
          />
        </div>

        <div className="model-mapping-field flex flex-col gap-1">
          <label htmlFor="model-mapping-haiku" className="model-mapping-label flex flex-col gap-0.5 text-xs font-medium text-[var(--text-strong)]">
            {t("settings.modelMappingHaiku")}
            <span className="model-mapping-default text-[10px] text-[var(--text-faint)] font-[var(--font-code,'SF_Mono','Fira_Code',monospace)]">
              {t("settings.modelMappingDefault", { model: "haiku" })}
            </span>
          </label>
          <input
            id="model-mapping-haiku"
            type="text"
            className="model-mapping-input px-2.5 py-2 rounded-lg border border-[var(--border-muted)] bg-[var(--surface-control)] text-[var(--text-strong)] text-xs font-[var(--font-code,'SF_Mono','Fira_Code',monospace)] outline-none transition-[border-color] duration-150 focus:border-[var(--border-accent)] placeholder:text-[var(--text-faint)]"
            placeholder={t("settings.modelMappingPlaceholder")}
            value={draftValues.haiku ?? ""}
            onChange={(e) =>
              setDraftValues((prev) => ({ ...prev, haiku: e.target.value }))
            }
          />
        </div>
      </div>

      <div className="model-mapping-actions flex gap-2 justify-end">
        {hasChanges && (
          <>
            <button
              type="button"
              className="model-mapping-button model-mapping-button-secondary px-3.5 py-1.5 rounded-md text-xs cursor-pointer transition-all duration-150 bg-transparent border border-[var(--border-muted)] text-[var(--text-muted)] hover:border-[var(--border-strong)] hover:text-[var(--text-strong)]"
              onClick={handleReset}
            >
              {t("settings.modelMappingReset")}
            </button>
            <button
              type="button"
              className="model-mapping-button model-mapping-button-primary px-3.5 py-1.5 rounded-md text-xs cursor-pointer transition-all duration-150 bg-[var(--text-accent,#3b82f6)] border border-[var(--text-accent,#3b82f6)] text-white hover:opacity-90"
              onClick={handleSave}
            >
              {t("settings.modelMappingSave")}
            </button>
          </>
        )}
      </div>

      <div className="model-mapping-note mt-2.5 px-2.5 py-2 rounded-md bg-[var(--surface-sidebar)] text-[11px] text-[var(--text-subtle)]">
        {t("settings.modelMappingNote")}
      </div>
    </div>
  );
}
