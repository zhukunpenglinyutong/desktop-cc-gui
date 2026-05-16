import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { CodexProviderConfig, CodexCustomModel } from "../types";

interface CodexProviderDialogProps {
  isOpen: boolean;
  provider: CodexProviderConfig | null;
  onClose: () => void;
  onSave: (provider: CodexProviderConfig) => void;
}

export function CodexProviderDialog({
  isOpen,
  provider,
  onClose,
  onSave,
}: CodexProviderDialogProps) {
  const { t } = useTranslation();
  const isAdding = !provider;

  const [providerName, setProviderName] = useState("");
  const [configToml, setConfigToml] = useState("");
  const [authJson, setAuthJson] = useState("");
  const [customModels, setCustomModels] = useState<CodexCustomModel[]>([]);
  const [newModelId, setNewModelId] = useState("");
  const [newModelLabel, setNewModelLabel] = useState("");

  useEffect(() => {
    if (isOpen) {
      if (provider) {
        setProviderName(provider.name || "");
        setConfigToml(provider.configToml || "");
        setAuthJson(provider.authJson || "");
        setCustomModels(provider.customModels || []);
      } else {
        setProviderName("");
        setConfigToml(`disable_response_storage = true
model = "gpt-5.1-codex"
model_reasoning_effort = "high"
model_provider = "crs"

[model_providers.crs]
base_url = "https://api.example.com/v1"
name = "crs"
requires_openai_auth = true
wire_api = "responses"`);
        setAuthJson(`{
  "OPENAI_API_KEY": ""
}`);
        setCustomModels([]);
      }
      setNewModelId("");
      setNewModelLabel("");
    }
  }, [isOpen, provider]);

  useEffect(() => {
    if (isOpen) {
      const handleEscape = (e: KeyboardEvent) => {
        if (e.key === "Escape") onClose();
      };
      window.addEventListener("keydown", handleEscape);
      return () => window.removeEventListener("keydown", handleEscape);
    }
  }, [isOpen, onClose]);

  const handleAddModel = () => {
    if (!newModelId.trim() || !newModelLabel.trim()) return;
    if (customModels.some((m) => m.id === newModelId.trim())) return;
    setCustomModels([
      ...customModels,
      { id: newModelId.trim(), label: newModelLabel.trim() },
    ]);
    setNewModelId("");
    setNewModelLabel("");
  };

  const handleRemoveModel = (id: string) => {
    setCustomModels(customModels.filter((m) => m.id !== id));
  };

  const handleSave = () => {
    if (!providerName.trim()) return;

    if (authJson.trim()) {
      try {
        JSON.parse(authJson);
      } catch {
        return;
      }
    }

    const providerData: CodexProviderConfig = {
      id: provider?.id || (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString()),
      name: providerName.trim(),
      createdAt: provider?.createdAt,
      configToml: configToml.trim(),
      authJson: authJson.trim(),
      customModels: customModels.length > 0 ? customModels : undefined,
    };

    onSave(providerData);
  };

  if (!isOpen) return null;

  return (
    <div className="vendor-dialog-overlay fixed inset-0 bg-black/60 backdrop-blur-[2px] flex items-center justify-center z-[100]" onClick={onClose}>
      <div
        className="vendor-dialog vendor-dialog-wide w-[min(600px,90vw)] max-h-[86vh] rounded-[14px] bg-[var(--surface-card-strong)] border border-[var(--border-stronger)] shadow-[0_20px_50px_rgba(0,0,0,0.3)] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="vendor-dialog-header flex items-center justify-between px-[18px] py-3.5 border-b border-[var(--border-muted)] [&_h3]:text-[15px] [&_h3]:font-semibold [&_h3]:text-[var(--text-primary)] [&_h3]:m-0">
          <h3>
            {isAdding
              ? t("settings.vendor.codexDialog.addTitle")
              : t("settings.vendor.codexDialog.editTitle")}
          </h3>
          <button type="button" className="vendor-dialog-close bg-transparent border-0 text-[var(--text-secondary)] text-xl cursor-pointer px-1 leading-none hover:text-[var(--text-primary)]" onClick={onClose}>
            &times;
          </button>
        </div>

        <div className="vendor-dialog-body px-[18px] py-4 overflow-y-auto flex-1 flex flex-col gap-4">
          <div className="vendor-form-group flex flex-col gap-[5px] [&>label]:text-xs [&>label]:font-medium [&>label]:text-[var(--text-primary)] [&>label]:inline-flex [&>label]:items-center [&>label]:gap-1.5">
            <label>{t("settings.vendor.dialog.providerName")} *</label>
            <input
              type="text"
              className="vendor-input w-full px-2.5 py-[7px] rounded-md border border-[var(--border-muted)] bg-[var(--surface-card)] text-[var(--text-primary)] text-[13px] outline-none transition-[border-color] duration-150 box-border focus:border-[var(--text-accent)]"
              placeholder={t("settings.vendor.codexDialog.namePlaceholder")}
              value={providerName}
              onChange={(e) => setProviderName(e.target.value)}
            />
          </div>

          <div className="vendor-form-group flex flex-col gap-[5px] [&>label]:text-xs [&>label]:font-medium [&>label]:text-[var(--text-primary)] [&>label]:inline-flex [&>label]:items-center [&>label]:gap-1.5">
            <label>config.toml *</label>
            <textarea
              className="vendor-code-editor w-full px-2.5 py-2 rounded-md border border-[var(--border-muted)] bg-[var(--surface-card)] text-[var(--text-primary)] font-[var(--font-code)] text-xs leading-[1.5] resize-y outline-none box-border focus:border-[var(--text-accent)]"
              value={configToml}
              onChange={(e) => setConfigToml(e.target.value)}
              rows={12}
            />
            <small className="vendor-hint text-[11px] text-[var(--text-secondary)] mt-0.5">
              {t("settings.vendor.codexDialog.configHint")}
            </small>
          </div>

          <div className="vendor-form-group flex flex-col gap-[5px] [&>label]:text-xs [&>label]:font-medium [&>label]:text-[var(--text-primary)] [&>label]:inline-flex [&>label]:items-center [&>label]:gap-1.5">
            <label>auth.json</label>
            <textarea
              className="vendor-code-editor w-full px-2.5 py-2 rounded-md border border-[var(--border-muted)] bg-[var(--surface-card)] text-[var(--text-primary)] font-[var(--font-code)] text-xs leading-[1.5] resize-y outline-none box-border focus:border-[var(--text-accent)]"
              value={authJson}
              onChange={(e) => setAuthJson(e.target.value)}
              rows={5}
            />
            <small className="vendor-hint text-[11px] text-[var(--text-secondary)] mt-0.5">
              {t("settings.vendor.codexDialog.authHint")}
            </small>
          </div>

          <div className="vendor-form-group flex flex-col gap-[5px] [&>label]:text-xs [&>label]:font-medium [&>label]:text-[var(--text-primary)] [&>label]:inline-flex [&>label]:items-center [&>label]:gap-1.5">
            <label>
              {t("settings.vendor.codexDialog.customModels")}{" "}
              <span className="vendor-optional font-normal text-[var(--text-secondary)] text-[11px]">
                ({t("settings.vendor.optional")})
              </span>
            </label>
            <div className="vendor-custom-models">
              {customModels.map((model) => (
                <div key={model.id} className="vendor-model-item">
                  <span className="vendor-model-id">{model.id}</span>
                  <span className="vendor-model-label">{model.label}</span>
                  <button
                    type="button"
                    className="vendor-btn-icon vendor-btn-danger"
                    onClick={() => handleRemoveModel(model.id)}
                  >
                    &times;
                  </button>
                </div>
              ))}
              <div className="vendor-model-add">
                <input
                  type="text"
                  className="vendor-input vendor-input-sm w-full px-2 py-[5px] rounded-md border border-[var(--border-muted)] bg-[var(--surface-card)] text-[var(--text-primary)] text-xs outline-none transition-[border-color] duration-150 box-border focus:border-[var(--text-accent)]"
                  placeholder="Model ID"
                  value={newModelId}
                  onChange={(e) => setNewModelId(e.target.value)}
                />
                <input
                  type="text"
                  className="vendor-input vendor-input-sm w-full px-2 py-[5px] rounded-md border border-[var(--border-muted)] bg-[var(--surface-card)] text-[var(--text-primary)] text-xs outline-none transition-[border-color] duration-150 box-border focus:border-[var(--text-accent)]"
                  placeholder="Label"
                  value={newModelLabel}
                  onChange={(e) => setNewModelLabel(e.target.value)}
                />
                <button
                  type="button"
                  className="vendor-btn-add-sm"
                  onClick={handleAddModel}
                  disabled={!newModelId.trim() || !newModelLabel.trim()}
                >
                  +
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="vendor-dialog-footer flex items-center justify-end gap-2 px-[18px] py-3 border-t border-[var(--border-muted)]">
          <button type="button" className="vendor-btn-cancel px-4 py-1.5 bg-[var(--vendor-button-primary-soft,transparent)] border border-[var(--vendor-button-primary-border,var(--border-muted))] rounded-md text-[var(--vendor-button-primary,var(--text-primary))] text-xs font-semibold cursor-pointer transition-[background,border-color,color] duration-150" onClick={onClose}>
            {t("settings.vendor.cancel")}
          </button>
          <button
            type="button"
            className="vendor-btn-save"
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
