import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import Cloud from "lucide-react/dist/esm/icons/cloud";
import KeyRound from "lucide-react/dist/esm/icons/key-round";
import LogIn from "lucide-react/dist/esm/icons/log-in";
import Settings2 from "lucide-react/dist/esm/icons/settings-2";
import type { ComponentType } from "react";
import Eye from "lucide-react/dist/esm/icons/eye";
import EyeOff from "lucide-react/dist/esm/icons/eye-off";
import ExternalLink from "lucide-react/dist/esm/icons/external-link";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import Save from "lucide-react/dist/esm/icons/save";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
} from "@/components/ui/select";
import { GEMINI_AUTH_MODES, type GeminiAuthMode } from "../types";
import { useGeminiVendorManagement } from "../hooks/useGeminiVendorManagement";

function modeLabel(t: (key: string) => string, mode: GeminiAuthMode): string {
  if (mode === "custom") return t("settings.vendor.gemini.mode.custom");
  if (mode === "login_google") return t("settings.vendor.gemini.mode.loginGoogle");
  if (mode === "gemini_api_key") return "Gemini API Key";
  if (mode === "vertex_adc") return "Vertex AI (ADC)";
  if (mode === "vertex_service_account") {
    return t("settings.vendor.gemini.mode.vertexServiceAccount");
  }
  return "Vertex AI API Key";
}

const GEMINI_AUTH_MODE_ICON_MAP = {
  custom: Settings2,
  login_google: LogIn,
  gemini_api_key: KeyRound,
  vertex_adc: Cloud,
  vertex_service_account: Cloud,
  vertex_api_key: Cloud,
} as const satisfies Record<GeminiAuthMode, ComponentType<{ className?: string }>>;

export function GeminiVendorPanel() {
  const { t } = useTranslation();
  const {
    draft,
    preflightChecks,
    preflightLoading,
    savingEnv,
    savingConfig,
    showKey,
    error,
    savedAt,
    setShowKey,
    refreshPreflight,
    handleDraftEnvTextChange,
    handleSaveEnv,
    handleGeminiAuthModeChange,
    handleGeminiFieldChange,
    handleSaveConfig,
  } = useGeminiVendorManagement();

  const isVertexMode =
    draft.authMode === "vertex_adc" ||
    draft.authMode === "vertex_service_account" ||
    draft.authMode === "vertex_api_key";
  const shouldShowApiBaseUrl = draft.authMode === "custom";
  const shouldShowApiKey =
    draft.authMode === "custom" ||
    draft.authMode === "gemini_api_key" ||
    draft.authMode === "vertex_api_key";
  const keyLabel =
    draft.authMode === "vertex_api_key" ? "GOOGLE_API_KEY" : "GEMINI_API_KEY";
  const keyValue =
    draft.authMode === "vertex_api_key" ? draft.googleApiKey : draft.geminiApiKey;
  const SelectedAuthModeIcon = GEMINI_AUTH_MODE_ICON_MAP[draft.authMode];

  return (
    <div className="vendor-gemini-shell">
      <div className="vendor-gemini-primary-grid">
        <section className="vendor-gemini-card vendor-gemini-card-checks">
          <div className="vendor-gemini-section-head">
            <span className="vendor-gemini-section-title">
              {t("settings.vendor.gemini.preflightCount", {
                count: preflightChecks.length,
              })}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={preflightLoading}
              onClick={() => {
                void refreshPreflight();
              }}
            >
              <RefreshCw className={`h-3.5 w-3.5${preflightLoading ? " vendor-spin" : ""}`} />
              {t("common.refresh")}
            </Button>
          </div>
          <div className="vendor-gemini-check-list">
            {preflightChecks.map((check) => (
              <div key={check.id} className="vendor-gemini-check-row" title={check.message}>
                <div className="vendor-gemini-check-copy">
                  <span className="vendor-gemini-check-label">{check.label}</span>
                  <span className="vendor-gemini-check-message">{check.message}</span>
                </div>
                <span
                  className={`vendor-gemini-check-status ${
                    check.status === "pass" ? "is-pass" : "is-fail"
                  }`}
                >
                  {check.status.toUpperCase()}
                </span>
              </div>
            ))}
            {preflightChecks.length === 0 && (
              <div className="vendor-gemini-empty-checks">
                {preflightLoading
                  ? t("settings.vendor.gemini.preflightLoading")
                  : t("settings.vendor.gemini.preflightEmpty")}
              </div>
            )}
          </div>
        </section>

        <section className="vendor-gemini-card vendor-gemini-card-auth">
          <div className="vendor-gemini-auth-header">
            <div>
              <label className="vendor-gemini-section-title">
                {t("settings.vendor.gemini.authConfig")}
              </label>
            </div>
            <div className="vendor-gemini-auth-header-actions">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  openUrl("https://geminicli.com/docs/get-started/authentication/").catch(
                    () => {},
                  );
                }}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {t("settings.vendor.gemini.viewAuthDoc")}
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  void handleSaveConfig();
                }}
                disabled={savingConfig}
              >
                <Save className="h-3.5 w-3.5" />
                {savingConfig
                  ? t("settings.vendor.gemini.saving")
                  : t("settings.vendor.gemini.saveConfig")}
              </Button>
            </div>
          </div>

          <div className="vendor-gemini-auth-grid">
            <div className="vendor-form-group vendor-gemini-auth-field vendor-gemini-auth-field-wide flex flex-col gap-[5px] [&>label]:text-xs [&>label]:font-medium [&>label]:text-[var(--text-primary)] [&>label]:inline-flex [&>label]:items-center [&>label]:gap-1.5">
              <Select
                value={draft.authMode}
                onValueChange={(nextValue) => {
                  const nextMode = nextValue as GeminiAuthMode;
                  if (GEMINI_AUTH_MODES.includes(nextMode)) {
                    handleGeminiAuthModeChange(nextMode);
                  }
                }}
              >
                <SelectTrigger
                  id="gemini-auth-mode"
                  className="vendor-gemini-auth-mode-trigger"
                  aria-label={t("settings.vendor.gemini.authMode")}
                >
                  <span className="vendor-gemini-auth-mode-selected">
                    <SelectedAuthModeIcon className="vendor-gemini-auth-mode-icon" />
                    <span className="vendor-gemini-auth-mode-text">
                      {modeLabel(t, draft.authMode)}
                    </span>
                  </span>
                </SelectTrigger>
                <SelectPopup className="vendor-gemini-auth-mode-popup">
                  {GEMINI_AUTH_MODES.map((mode) => {
                    const ModeIcon = GEMINI_AUTH_MODE_ICON_MAP[mode];
                    return (
                      <SelectItem key={mode} value={mode}>
                        <span className="vendor-gemini-auth-mode-option">
                          <ModeIcon className="vendor-gemini-auth-mode-icon" />
                          <span className="vendor-gemini-auth-mode-text">
                            {modeLabel(t, mode)}
                          </span>
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectPopup>
              </Select>
            </div>

            {shouldShowApiBaseUrl && (
              <div className="vendor-form-group vendor-gemini-auth-field vendor-gemini-auth-field-wide flex flex-col gap-[5px] [&>label]:text-xs [&>label]:font-medium [&>label]:text-[var(--text-primary)] [&>label]:inline-flex [&>label]:items-center [&>label]:gap-1.5">
                <label htmlFor="gemini-api-base-url">GOOGLE_GEMINI_BASE_URL</label>
                <input
                  id="gemini-api-base-url"
                  className="vendor-input w-full px-2.5 py-[7px] rounded-md border border-[var(--border-muted)] bg-[var(--surface-card)] text-[var(--text-primary)] text-[13px] outline-none transition-[border-color] duration-150 box-border focus:border-[var(--text-accent)]"
                  value={draft.apiBaseUrl}
                  placeholder="https://your-gemini-endpoint.example.com"
                  onChange={(event) => {
                    handleGeminiFieldChange("apiBaseUrl", event.target.value);
                  }}
                />
              </div>
            )}

            {shouldShowApiKey && (
              <div className="vendor-form-group vendor-gemini-auth-field vendor-gemini-auth-field-wide flex flex-col gap-[5px] [&>label]:text-xs [&>label]:font-medium [&>label]:text-[var(--text-primary)] [&>label]:inline-flex [&>label]:items-center [&>label]:gap-1.5">
                <label htmlFor="gemini-api-key">{keyLabel}</label>
                <div className="vendor-input-row flex gap-1 items-center [&_.vendor-input]:flex-1">
                  <input
                    id="gemini-api-key"
                    className="vendor-input w-full px-2.5 py-[7px] rounded-md border border-[var(--border-muted)] bg-[var(--surface-card)] text-[var(--text-primary)] text-[13px] outline-none transition-[border-color] duration-150 box-border focus:border-[var(--text-accent)]"
                    type={showKey ? "text" : "password"}
                    value={keyValue}
                    placeholder="AIza..."
                    onChange={(event) => {
                      if (draft.authMode === "vertex_api_key") {
                        handleGeminiFieldChange("googleApiKey", event.target.value);
                      } else {
                        handleGeminiFieldChange("geminiApiKey", event.target.value);
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="vendor-btn-icon"
                    onClick={() => setShowKey((current) => !current)}
                    title={
                      showKey
                        ? t("settings.vendor.gemini.hideKey")
                        : t("settings.vendor.gemini.showKey")
                    }
                  >
                    {showKey ? <EyeOff /> : <Eye />}
                  </button>
                </div>
              </div>
            )}

            {isVertexMode && (
              <div className="vendor-model-grid vendor-gemini-auth-field vendor-gemini-auth-field-wide grid grid-cols-2 gap-2.5 [&_label]:text-[11px] [&_label]:text-[var(--text-secondary)] [&_label]:mb-[3px] [&_label]:block">
                <div>
                  <label htmlFor="gemini-cloud-project">GOOGLE_CLOUD_PROJECT</label>
                  <input
                    id="gemini-cloud-project"
                    className="vendor-input w-full px-2.5 py-[7px] rounded-md border border-[var(--border-muted)] bg-[var(--surface-card)] text-[var(--text-primary)] text-[13px] outline-none transition-[border-color] duration-150 box-border focus:border-[var(--text-accent)]"
                    value={draft.googleCloudProject}
                    placeholder="my-gcp-project-id"
                    onChange={(event) => {
                      handleGeminiFieldChange("googleCloudProject", event.target.value);
                    }}
                  />
                </div>
                <div>
                  <label htmlFor="gemini-cloud-location">GOOGLE_CLOUD_LOCATION</label>
                  <input
                    id="gemini-cloud-location"
                    className="vendor-input w-full px-2.5 py-[7px] rounded-md border border-[var(--border-muted)] bg-[var(--surface-card)] text-[var(--text-primary)] text-[13px] outline-none transition-[border-color] duration-150 box-border focus:border-[var(--text-accent)]"
                    value={draft.googleCloudLocation}
                    placeholder="global / us-central1"
                    onChange={(event) => {
                      handleGeminiFieldChange("googleCloudLocation", event.target.value);
                    }}
                  />
                </div>
              </div>
            )}

            {draft.authMode === "vertex_service_account" && (
              <div className="vendor-form-group vendor-gemini-auth-field vendor-gemini-auth-field-wide flex flex-col gap-[5px] [&>label]:text-xs [&>label]:font-medium [&>label]:text-[var(--text-primary)] [&>label]:inline-flex [&>label]:items-center [&>label]:gap-1.5">
                <label htmlFor="gemini-google-application-credentials">
                  GOOGLE_APPLICATION_CREDENTIALS
                </label>
                <input
                  id="gemini-google-application-credentials"
                  className="vendor-input w-full px-2.5 py-[7px] rounded-md border border-[var(--border-muted)] bg-[var(--surface-card)] text-[var(--text-primary)] text-[13px] outline-none transition-[border-color] duration-150 box-border focus:border-[var(--text-accent)]"
                  value={draft.googleApplicationCredentials}
                  placeholder="<service-account-json-path>"
                  onChange={(event) => {
                    handleGeminiFieldChange(
                      "googleApplicationCredentials",
                      event.target.value,
                    );
                  }}
                />
              </div>
            )}
          </div>
        </section>
      </div>

      <section className="vendor-gemini-card vendor-gemini-card-env">
        <label className="vendor-gemini-section-title">{t("settings.vendor.gemini.envVars")}</label>
        <textarea
          className="vendor-code-editor vendor-gemini-env-editor w-full px-2.5 py-2 rounded-md border border-[var(--border-muted)] bg-[var(--surface-card)] text-[var(--text-primary)] font-[var(--font-code)] text-xs leading-[1.5] resize-y outline-none box-border focus:border-[var(--text-accent)]"
          value={draft.envText}
          onChange={(event) => {
            handleDraftEnvTextChange(event.target.value);
          }}
          placeholder={"GEMINI_API_KEY=...\nGEMINI_MODEL=gemini-3-pro-preview"}
        />
        <div className="vendor-gemini-actions-row">
          <Button
            size="sm"
            onClick={() => {
              void handleSaveEnv();
            }}
            disabled={savingEnv}
          >
            <Save className="h-3.5 w-3.5" />
            {savingEnv
              ? t("settings.vendor.gemini.saving")
              : t("settings.vendor.gemini.saveEnv")}
          </Button>
        </div>
      </section>

      {error && <div className="vendor-json-error text-[#e55] text-[11px] mt-1">{error}</div>}
      {savedAt && (
        <div className="vendor-gemini-saved-hint">
          {t("settings.vendor.gemini.savedAt", {
            time: new Date(savedAt).toLocaleTimeString(),
          })}
        </div>
      )}
    </div>
  );
}
