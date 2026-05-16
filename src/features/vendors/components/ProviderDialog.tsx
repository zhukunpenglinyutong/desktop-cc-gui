import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Eye from "lucide-react/dist/esm/icons/eye";
import EyeOff from "lucide-react/dist/esm/icons/eye-off";
import Shield from "lucide-react/dist/esm/icons/shield";
import type { ProviderConfig } from "../types";
import { CLAUDE_PROVIDER_PRESETS } from "../types";

interface ProviderDialogProps {
  isOpen: boolean;
  provider: ProviderConfig | null;
  onClose: () => void;
  onSave: (data: {
    providerName: string;
    remark: string;
    apiKey: string;
    apiUrl: string;
    jsonConfig: string;
  }) => void;
}

function defaultConfigJson() {
  return JSON.stringify(
    {
      env: {
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_BASE_URL: "",
        ANTHROPIC_MODEL: "",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "",
      },
    },
    null,
    2,
  );
}

export function ProviderDialog({
  isOpen,
  provider,
  onClose,
  onSave,
}: ProviderDialogProps) {
  const { t } = useTranslation();
  const isAdding = !provider;

  const [providerName, setProviderName] = useState("");
  const [remark, setRemark] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiUrl, setApiUrl] = useState("");
  const [haikuModel, setHaikuModel] = useState("");
  const [sonnetModel, setSonnetModel] = useState("");
  const [opusModel, setOpusModel] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [jsonConfig, setJsonConfig] = useState("");
  const [jsonError, setJsonError] = useState("");
  const [activePreset, setActivePreset] = useState("custom");

  const updateEnvField = (key: string, value: string) => {
    try {
      const parsed = jsonConfig ? JSON.parse(jsonConfig) : {};
      const prevEnv = (parsed.env || {}) as Record<string, unknown>;
      const trimmed = value.trim();

      let nextEnv: Record<string, unknown>;
      if (!trimmed) {
        nextEnv = { ...prevEnv };
        delete nextEnv[key];
      } else {
        nextEnv = { ...prevEnv, [key]: value };
      }

      const nextConfig = Object.keys(nextEnv).length > 0
        ? { ...parsed, env: nextEnv }
        : Object.fromEntries(Object.entries(parsed).filter(([configKey]) => configKey !== "env"));

      setJsonConfig(JSON.stringify(nextConfig, null, 2));
      setJsonError("");
    } catch {
      // ignore
    }
  };

  const detectMatchingPreset = (env: Record<string, string | undefined>) => {
    for (const preset of CLAUDE_PROVIDER_PRESETS) {
      if (preset.id === "custom") continue;
      const baseUrl = env.ANTHROPIC_BASE_URL || "";
      const presetBaseUrl = preset.env.ANTHROPIC_BASE_URL || "";
      if (baseUrl && presetBaseUrl && baseUrl === presetBaseUrl) {
        return preset.id;
      }
    }
    return "custom";
  };

  const handlePresetClick = (presetId: string) => {
    const preset = CLAUDE_PROVIDER_PRESETS.find((item) => item.id === presetId);
    if (!preset) {
      return;
    }
    setActivePreset(presetId);

    if (presetId === "custom") {
      setApiKey("");
      setApiUrl("");
      setHaikuModel("");
      setSonnetModel("");
      setOpusModel("");
      setJsonConfig(defaultConfigJson());
      setJsonError("");
      return;
    }

    const config = { env: { ...preset.env } };
    setJsonConfig(JSON.stringify(config, null, 2));
    setApiUrl(preset.env.ANTHROPIC_BASE_URL || "");
    setApiKey(preset.env.ANTHROPIC_AUTH_TOKEN || "");
    setHaikuModel(preset.env.ANTHROPIC_DEFAULT_HAIKU_MODEL || "");
    setSonnetModel(preset.env.ANTHROPIC_DEFAULT_SONNET_MODEL || "");
    setOpusModel(preset.env.ANTHROPIC_DEFAULT_OPUS_MODEL || "");
    setJsonError("");
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    if (provider) {
      setProviderName(provider.name || "");
      setRemark(provider.remark || provider.websiteUrl || "");
      setApiKey(
        provider.settingsConfig?.env?.ANTHROPIC_AUTH_TOKEN ||
          provider.settingsConfig?.env?.ANTHROPIC_API_KEY ||
          "",
      );
      setApiUrl(provider.settingsConfig?.env?.ANTHROPIC_BASE_URL || "");
      const env = provider.settingsConfig?.env || {};
      setHaikuModel(env.ANTHROPIC_DEFAULT_HAIKU_MODEL || "");
      setSonnetModel(env.ANTHROPIC_DEFAULT_SONNET_MODEL || "");
      setOpusModel(env.ANTHROPIC_DEFAULT_OPUS_MODEL || "");
      setActivePreset(detectMatchingPreset(env));
      setJsonConfig(JSON.stringify(provider.settingsConfig || { env: {} }, null, 2));
    } else {
      setProviderName("");
      setRemark("");
      setApiKey("");
      setApiUrl("");
      setHaikuModel("");
      setSonnetModel("");
      setOpusModel("");
      setActivePreset("custom");
      setJsonConfig(defaultConfigJson());
    }
    setShowApiKey(false);
    setJsonError("");
  }, [isOpen, provider]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  const handleJsonChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newJson = event.target.value;
    setJsonConfig(newJson);
    try {
      const parsed = JSON.parse(newJson);
      const env = parsed.env || {};
      setApiKey(env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY || "");
      setApiUrl(env.ANTHROPIC_BASE_URL || "");
      setHaikuModel(env.ANTHROPIC_DEFAULT_HAIKU_MODEL || "");
      setSonnetModel(env.ANTHROPIC_DEFAULT_SONNET_MODEL || "");
      setOpusModel(env.ANTHROPIC_DEFAULT_OPUS_MODEL || "");
      setActivePreset(detectMatchingPreset(env));
      setJsonError("");
    } catch {
      setJsonError(t("settings.vendor.dialog.jsonError"));
    }
  };

  const handleFormatJson = () => {
    try {
      const parsed = JSON.parse(jsonConfig);
      setJsonConfig(JSON.stringify(parsed, null, 2));
      setJsonError("");
    } catch {
      setJsonError(t("settings.vendor.dialog.jsonError"));
    }
  };

  const handleSave = () => {
    onSave({ providerName, remark, apiKey, apiUrl, jsonConfig });
  };

  if (!isOpen) return null;

  return (
    <div className="vendor-dialog-overlay fixed inset-0 bg-black/60 backdrop-blur-[2px] flex items-center justify-center z-[100]" onClick={onClose}>
      <div
        className="vendor-dialog w-[min(760px,90vw)] max-h-[86vh] rounded-[14px] bg-[var(--surface-card-strong)] border border-[var(--border-stronger)] shadow-[0_20px_50px_rgba(0,0,0,0.3)] flex flex-col overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="vendor-dialog-header flex items-center justify-between px-[18px] py-3.5 border-b border-[var(--border-muted)] [&_h3]:text-[15px] [&_h3]:font-semibold [&_h3]:text-[var(--text-primary)] [&_h3]:m-0">
          <h3>
            {isAdding
              ? t("settings.vendor.dialog.addTitle")
              : t("settings.vendor.dialog.editTitle")}
          </h3>
          <button type="button" className="vendor-dialog-close bg-transparent border-0 text-[var(--text-secondary)] text-xl cursor-pointer px-1 leading-none hover:text-[var(--text-primary)]" onClick={onClose}>
            &times;
          </button>
        </div>

        <div className="vendor-dialog-body px-[18px] py-4 overflow-y-auto flex-1 flex flex-col gap-4">
          <p className="vendor-dialog-description m-0 text-[13px] text-[var(--text-secondary)] leading-[1.5]">
            {isAdding
              ? t("settings.vendor.dialog.addDescription")
              : t("settings.vendor.dialog.editDescription")}
          </p>

          <div className="vendor-security-notice flex items-center gap-2 px-3.5 py-3 rounded-lg border border-[color-mix(in_srgb,var(--text-accent)_42%,transparent)] bg-[color-mix(in_srgb,var(--text-accent)_14%,var(--surface-card-strong))] text-[var(--text-primary)] text-[13px] font-medium [&_svg]:text-[color-mix(in_srgb,var(--text-accent)_82%,var(--text-primary)_18%)] [&_svg]:shrink-0">
            <Shield size={14} />
            <span>{t("settings.vendor.dialog.securityNotice")}</span>
          </div>

          <div className="vendor-preset-group flex flex-col gap-2.5">
            <div className="vendor-preset-title text-xs font-semibold text-[var(--text-secondary)]">
              {t("settings.vendor.dialog.presetGroup")}
            </div>
            <div className="vendor-preset-buttons flex flex-wrap gap-2 p-2.5 border border-[var(--border-muted)] rounded-lg bg-[var(--surface-card)]">
              {CLAUDE_PROVIDER_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className={`vendor-preset-btn border border-[var(--vendor-button-primary-border,var(--border-muted))] bg-[var(--vendor-button-primary-soft,var(--surface-card-strong))] text-[var(--vendor-button-primary,var(--text-primary))] rounded-lg px-3 py-[7px] text-[13px] font-semibold cursor-pointer transition-[border-color,background,color] duration-150 hover:border-[var(--vendor-button-primary,var(--border-stronger))] hover:bg-[var(--vendor-button-primary,var(--surface-card-strong))] hover:text-white ${
                    activePreset === preset.id ? "active !border-[var(--vendor-button-primary,var(--text-accent))] !bg-[var(--vendor-button-primary,var(--text-accent))] !text-white" : ""
                  }`}
                  onClick={() => handlePresetClick(preset.id)}
                >
                  {t(preset.nameKey)}
                </button>
              ))}
            </div>
          </div>

          <div className="vendor-form-group flex flex-col gap-[5px] [&>label]:text-xs [&>label]:font-medium [&>label]:text-[var(--text-primary)] [&>label]:inline-flex [&>label]:items-center [&>label]:gap-1.5">
            <label>
              {t("settings.vendor.dialog.providerName")}
              <span className="vendor-required text-[#ff6b6b] text-xs leading-none">
                {t("settings.vendor.dialog.required")}
              </span>
            </label>
            <input
              type="text"
              className="vendor-input w-full px-2.5 py-[7px] rounded-md border border-[var(--border-muted)] bg-[var(--surface-card)] text-[var(--text-primary)] text-[13px] outline-none transition-[border-color] duration-150 box-border focus:border-[var(--text-accent)]"
              placeholder={t("settings.vendor.dialog.providerNamePlaceholder")}
              value={providerName}
              onChange={(event) => setProviderName(event.target.value)}
            />
          </div>

          <div className="vendor-form-group flex flex-col gap-[5px] [&>label]:text-xs [&>label]:font-medium [&>label]:text-[var(--text-primary)] [&>label]:inline-flex [&>label]:items-center [&>label]:gap-1.5">
            <label>{t("settings.vendor.dialog.remark")}</label>
            <input
              type="text"
              className="vendor-input w-full px-2.5 py-[7px] rounded-md border border-[var(--border-muted)] bg-[var(--surface-card)] text-[var(--text-primary)] text-[13px] outline-none transition-[border-color] duration-150 box-border focus:border-[var(--text-accent)]"
              placeholder={t("settings.vendor.dialog.remarkPlaceholder")}
              value={remark}
              onChange={(event) => setRemark(event.target.value)}
            />
          </div>

          <div className="vendor-form-group flex flex-col gap-[5px] [&>label]:text-xs [&>label]:font-medium [&>label]:text-[var(--text-primary)] [&>label]:inline-flex [&>label]:items-center [&>label]:gap-1.5">
            <label>
              {t("settings.vendor.dialog.apiKey")}
              <span className="vendor-required text-[#ff6b6b] text-xs leading-none">
                {t("settings.vendor.dialog.required")}
              </span>
            </label>
            <div className="vendor-input-row flex gap-1 items-center [&_.vendor-input]:flex-1">
              <input
                type={showApiKey ? "text" : "password"}
                className="vendor-input w-full px-2.5 py-[7px] rounded-md border border-[var(--border-muted)] bg-[var(--surface-card)] text-[var(--text-primary)] text-[13px] outline-none transition-[border-color] duration-150 box-border focus:border-[var(--text-accent)]"
                placeholder={t("settings.vendor.dialog.apiKeyPlaceholder")}
                value={apiKey}
                onChange={(event) => {
                  setApiKey(event.target.value);
                  updateEnvField("ANTHROPIC_AUTH_TOKEN", event.target.value);
                }}
              />
              <button
                type="button"
                className="vendor-btn-icon w-[26px] h-[26px] flex items-center justify-center bg-transparent border-0 rounded-[5px] text-[var(--text-secondary)] cursor-pointer text-[13px] transition-all duration-150 [&_svg]:w-3.5 [&_svg]:h-3.5 [&_svg]:shrink-0 hover:bg-[var(--surface-card-strong)] hover:text-[var(--text-primary)]"
                onClick={() => setShowApiKey((current) => !current)}
                title={showApiKey ? t("settings.vendor.hide") : t("settings.vendor.show")}
              >
                {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <small className="vendor-hint text-[11px] text-[var(--text-secondary)] mt-0.5">
              {t("settings.vendor.dialog.apiKeyHint")}
            </small>
          </div>

          <div className="vendor-form-group flex flex-col gap-[5px] [&>label]:text-xs [&>label]:font-medium [&>label]:text-[var(--text-primary)] [&>label]:inline-flex [&>label]:items-center [&>label]:gap-1.5">
            <label>
              {t("settings.vendor.dialog.apiUrl")}
              <span className="vendor-required text-[#ff6b6b] text-xs leading-none">
                {t("settings.vendor.dialog.required")}
              </span>
            </label>
            <input
              type="text"
              className="vendor-input w-full px-2.5 py-[7px] rounded-md border border-[var(--border-muted)] bg-[var(--surface-card)] text-[var(--text-primary)] text-[13px] outline-none transition-[border-color] duration-150 box-border focus:border-[var(--text-accent)]"
              placeholder={t("settings.vendor.dialog.apiUrlPlaceholder")}
              value={apiUrl}
              onChange={(event) => {
                setApiUrl(event.target.value);
                updateEnvField("ANTHROPIC_BASE_URL", event.target.value);
              }}
            />
            <small className="vendor-hint text-[11px] text-[var(--text-secondary)] mt-0.5">
              {t("settings.vendor.dialog.apiUrlHint")}
            </small>
          </div>

          <div className="vendor-form-group flex flex-col gap-[5px] [&>label]:text-xs [&>label]:font-medium [&>label]:text-[var(--text-primary)] [&>label]:inline-flex [&>label]:items-center [&>label]:gap-1.5">
            <label>{t("settings.vendor.dialog.modelMapping")}</label>
            <div className="vendor-model-grid grid grid-cols-2 gap-2.5 [&_label]:text-[11px] [&_label]:text-[var(--text-secondary)] [&_label]:mb-[3px] [&_label]:block">
              <div>
                <label>{t("settings.vendor.dialog.sonnetModel")}</label>
                <input
                  type="text"
                  className="vendor-input w-full px-2.5 py-[7px] rounded-md border border-[var(--border-muted)] bg-[var(--surface-card)] text-[var(--text-primary)] text-[13px] outline-none transition-[border-color] duration-150 box-border focus:border-[var(--text-accent)]"
                  placeholder={t("settings.vendor.dialog.sonnetModelPlaceholder")}
                  value={sonnetModel}
                  onChange={(event) => {
                    setSonnetModel(event.target.value);
                    updateEnvField(
                      "ANTHROPIC_DEFAULT_SONNET_MODEL",
                      event.target.value,
                    );
                  }}
                />
              </div>
              <div>
                <label>{t("settings.vendor.dialog.opusModel")}</label>
                <input
                  type="text"
                  className="vendor-input w-full px-2.5 py-[7px] rounded-md border border-[var(--border-muted)] bg-[var(--surface-card)] text-[var(--text-primary)] text-[13px] outline-none transition-[border-color] duration-150 box-border focus:border-[var(--text-accent)]"
                  placeholder={t("settings.vendor.dialog.opusModelPlaceholder")}
                  value={opusModel}
                  onChange={(event) => {
                    setOpusModel(event.target.value);
                    updateEnvField(
                      "ANTHROPIC_DEFAULT_OPUS_MODEL",
                      event.target.value,
                    );
                  }}
                />
              </div>
              <div>
                <label>{t("settings.vendor.dialog.haikuModel")}</label>
                <input
                  type="text"
                  className="vendor-input w-full px-2.5 py-[7px] rounded-md border border-[var(--border-muted)] bg-[var(--surface-card)] text-[var(--text-primary)] text-[13px] outline-none transition-[border-color] duration-150 box-border focus:border-[var(--text-accent)]"
                  placeholder={t("settings.vendor.dialog.haikuModelPlaceholder")}
                  value={haikuModel}
                  onChange={(event) => {
                    setHaikuModel(event.target.value);
                    updateEnvField(
                      "ANTHROPIC_DEFAULT_HAIKU_MODEL",
                      event.target.value,
                    );
                  }}
                />
              </div>
            </div>
            <small className="vendor-hint text-[11px] text-[var(--text-secondary)] mt-0.5">
              {t("settings.vendor.dialog.modelMappingHint")}
            </small>
          </div>

          <details className="vendor-advanced border border-[var(--border-muted)] rounded-lg p-0 [&>summary]:px-3 [&>summary]:py-2 [&>summary]:text-xs [&>summary]:font-medium [&>summary]:text-[var(--text-secondary)] [&>summary]:cursor-pointer hover:[&>summary]:text-[var(--text-primary)]" open>
            <summary>{t("settings.vendor.dialog.jsonConfig")}</summary>
            <div className="vendor-json-section px-3 pb-3">
              <p className="vendor-hint vendor-json-description text-[11px] text-[var(--text-secondary)] mt-0.5 mb-2">
                {t("settings.vendor.dialog.jsonConfigDescription")}
              </p>
              <div className="vendor-json-toolbar flex justify-end mb-1.5 [&_button]:px-2.5 [&_button]:py-[3px] [&_button]:bg-transparent [&_button]:border [&_button]:border-[var(--border-muted)] [&_button]:rounded [&_button]:text-[var(--text-secondary)] [&_button]:text-[11px] [&_button]:cursor-pointer hover:[&_button]:text-[var(--text-primary)] hover:[&_button]:border-[var(--border-stronger)]">
                <button type="button" onClick={handleFormatJson}>
                  {t("settings.vendor.dialog.formatJson")}
                </button>
              </div>
              <textarea
                className="vendor-json-editor w-full px-2.5 py-2 rounded-md border border-[var(--border-muted)] bg-[var(--surface-card)] text-[var(--text-primary)] font-[var(--font-code)] text-xs leading-[1.5] resize-y outline-none box-border focus:border-[var(--text-accent)]"
                value={jsonConfig}
                onChange={handleJsonChange}
                rows={12}
              />
              {jsonError && (
                <div className="vendor-json-error text-[#e55] text-[11px] mt-1">{jsonError}</div>
              )}
            </div>
          </details>
        </div>

        <div className="vendor-dialog-footer flex items-center justify-end gap-2 px-[18px] py-3 border-t border-[var(--border-muted)]">
          <button type="button" className="vendor-btn-cancel px-4 py-1.5 bg-[var(--vendor-button-primary-soft,transparent)] border border-[var(--vendor-button-primary-border,var(--border-muted))] rounded-md text-[var(--vendor-button-primary,var(--text-primary))] text-xs font-semibold cursor-pointer transition-[background,border-color,color] duration-150 hover:border-[var(--vendor-button-primary,var(--text-accent))] hover:bg-[var(--vendor-button-primary,var(--text-accent))] hover:text-white" onClick={onClose}>
            {t("settings.vendor.cancel")}
          </button>
          <button
            type="button"
            className="vendor-btn-save px-4 py-1.5 bg-[var(--vendor-button-primary,var(--text-accent))] border border-[var(--vendor-button-primary,var(--text-accent))] rounded-md text-white text-xs font-semibold cursor-pointer transition-[background,border-color] duration-150 hover:bg-[var(--vendor-button-primary-hover,var(--text-accent))] hover:border-[var(--vendor-button-primary-hover,var(--text-accent))] disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleSave}
            disabled={!providerName.trim()}
          >
            {isAdding
              ? t("settings.vendor.dialog.confirmAdd")
              : t("settings.vendor.dialog.saveChanges")}
          </button>
        </div>
      </div>
    </div>
  );
}
