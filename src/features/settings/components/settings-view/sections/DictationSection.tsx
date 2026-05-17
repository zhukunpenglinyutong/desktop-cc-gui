import { useMemo } from "react";
import type { TFunction } from "i18next";
import { Switch } from "@/components/ui/switch";
import type { AppSettings, DictationModelStatus } from "@/types";
import { formatDownloadSize } from "@/utils/formatting";
import { DICTATION_MODELS } from "../settingsViewConstants";

type DictationSectionProps = {
  active: boolean;
  t: TFunction;
  appSettings: AppSettings;
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
  dictationModelStatus?: DictationModelStatus | null;
  onDownloadDictationModel?: () => void;
  onCancelDictationDownload?: () => void;
  onRemoveDictationModel?: () => void;
};

export function DictationSection({
  active,
  t,
  appSettings,
  onUpdateAppSettings,
  dictationModelStatus,
  onDownloadDictationModel,
  onCancelDictationDownload,
  onRemoveDictationModel,
}: DictationSectionProps) {
  const dictationModels = useMemo(() => DICTATION_MODELS(t), [t]);
  const selectedDictationModel = useMemo(
    () =>
      dictationModels.find((model) => model.id === appSettings.dictationModelId) ??
      dictationModels[1],
    [appSettings.dictationModelId, dictationModels],
  );
  const dictationReady = dictationModelStatus?.state === "ready";
  const dictationProgress = dictationModelStatus?.progress ?? null;

  if (!active) {
    return null;
  }

  return (
    <section className="settings-section w-full max-w-[980px]">
      <div className="settings-section-title text-[15px] font-semibold text-(--text-strong) mb-1">{t("settings.dictationTitle")}</div>
      <div className="settings-section-subtitle text-xs text-(--text-subtle) mb-4">
        {t("settings.dictationDescription")}
      </div>
      <div className="settings-toggle-row">
        <div>
          <div className="settings-toggle-title">{t("settings.enableDictation")}</div>
          <div className="settings-toggle-subtitle">
            {t("settings.enableDictationDesc")}
          </div>
        </div>
        <Switch
          checked={appSettings.dictationEnabled}
          onCheckedChange={(checked) => {
            void onUpdateAppSettings({
              ...appSettings,
              dictationEnabled: checked,
            });
            if (
              !checked &&
              dictationModelStatus?.state === "downloading" &&
              onCancelDictationDownload
            ) {
              onCancelDictationDownload();
            }
            if (
              checked &&
              dictationModelStatus?.state === "missing" &&
              onDownloadDictationModel
            ) {
              onDownloadDictationModel();
            }
          }}
        />
      </div>
      <div className="settings-field">
        <label className="settings-field-label" htmlFor="dictation-model">
          {t("settings.dictationModel")}
        </label>
        <select
          id="dictation-model"
          className="settings-select"
          value={appSettings.dictationModelId}
          onChange={(event) =>
            void onUpdateAppSettings({
              ...appSettings,
              dictationModelId: event.target.value,
            })
          }
        >
          {dictationModels.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label} ({model.size})
            </option>
          ))}
        </select>
        <div className="settings-help">
          {selectedDictationModel.note} {t("settings.downloadSize")}{" "}
          {selectedDictationModel.size}.
        </div>
      </div>
      <div className="settings-field">
        <label className="settings-field-label" htmlFor="dictation-language">
          {t("settings.preferredDictationLanguage")}
        </label>
        <select
          id="dictation-language"
          className="settings-select"
          value={appSettings.dictationPreferredLanguage ?? ""}
          onChange={(event) =>
            void onUpdateAppSettings({
              ...appSettings,
              dictationPreferredLanguage: event.target.value || null,
            })
          }
        >
          <option value="">{t("settings.autoDetectOnly")}</option>
          <option value="en">{t("settings.languageEnglish")}</option>
          <option value="es">{t("settings.languageSpanish")}</option>
          <option value="fr">{t("settings.languageFrench")}</option>
          <option value="de">{t("settings.languageGerman")}</option>
          <option value="it">{t("settings.languageItalian")}</option>
          <option value="pt">{t("settings.languagePortuguese")}</option>
          <option value="nl">{t("settings.languageDutch")}</option>
          <option value="sv">{t("settings.languageSwedish")}</option>
          <option value="no">{t("settings.languageNorwegian")}</option>
          <option value="da">{t("settings.languageDanish")}</option>
          <option value="fi">{t("settings.languageFinnish")}</option>
          <option value="pl">{t("settings.languagePolish")}</option>
          <option value="tr">{t("settings.languageTurkish")}</option>
          <option value="ru">{t("settings.languageRussian")}</option>
          <option value="uk">{t("settings.languageUkrainian")}</option>
          <option value="ja">{t("settings.languageJapanese")}</option>
          <option value="ko">{t("settings.languageKorean")}</option>
          <option value="zh">{t("settings.languageChinese")}</option>
        </select>
        <div className="settings-help">
          {t("settings.languageDetectionDesc")}
        </div>
      </div>
      <div className="settings-field">
        <label className="settings-field-label" htmlFor="dictation-hold-key">
          {t("settings.holdToDictateKey")}
        </label>
        <select
          id="dictation-hold-key"
          className="settings-select"
          value={appSettings.dictationHoldKey ?? ""}
          onChange={(event) =>
            void onUpdateAppSettings({
              ...appSettings,
              dictationHoldKey: event.target.value,
            })
          }
        >
          <option value="">{t("settings.holdToDictateOff")}</option>
          <option value="alt">{t("settings.holdToDictateOption")}</option>
          <option value="shift">{t("settings.holdToDictateShift")}</option>
          <option value="control">{t("settings.holdToDictateControl")}</option>
          <option value="meta">{t("settings.holdToDictateCommand")}</option>
        </select>
        <div className="settings-help">
          {t("settings.holdToDictateDesc")}
        </div>
      </div>
      {dictationModelStatus && (
        <div className="settings-field">
          <div className="settings-field-label">
            {t("settings.modelStatus")} ({selectedDictationModel.label})
          </div>
          <div className="settings-help">
            {dictationModelStatus.state === "ready" && t("settings.modelReady")}
            {dictationModelStatus.state === "missing" &&
              t("settings.modelNotDownloaded")}
            {dictationModelStatus.state === "downloading" &&
              t("settings.modelDownloading")}
            {dictationModelStatus.state === "error" &&
              (dictationModelStatus.error ?? t("settings.modelDownloadError"))}
          </div>
          {dictationProgress && (
            <div className="settings-download-progress flex flex-col gap-1.5">
              <div className="settings-download-bar h-1.5 rounded-full bg-(--surface-control) border border-(--border-muted) overflow-hidden">
                <div
                  className="settings-download-fill h-full bg-linear-to-r from-[#4a8caa] to-[#58b888]"
                  style={{
                    width: dictationProgress.totalBytes
                      ? `${Math.min(
                          100,
                          (dictationProgress.downloadedBytes /
                            dictationProgress.totalBytes) *
                            100,
                        )}%`
                      : "0%",
                  }}
                />
              </div>
              <div className="settings-download-meta text-[11px] text-(--text-subtle)">
                {formatDownloadSize(dictationProgress.downloadedBytes)}
              </div>
            </div>
          )}
          <div className="settings-field-actions">
            {dictationModelStatus.state === "missing" && (
              <button
                type="button"
                className="primary"
                onClick={onDownloadDictationModel}
                disabled={!onDownloadDictationModel}
              >
                {t("settings.downloadModel")}
              </button>
            )}
            {dictationModelStatus.state === "downloading" && (
              <button
                type="button"
                className="ghost settings-button-compact"
                onClick={onCancelDictationDownload}
                disabled={!onCancelDictationDownload}
              >
                {t("settings.cancelDownload")}
              </button>
            )}
            {dictationReady && (
              <button
                type="button"
                className="ghost settings-button-compact"
                onClick={onRemoveDictationModel}
                disabled={!onRemoveDictationModel}
              >
                {t("settings.removeModel")}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
