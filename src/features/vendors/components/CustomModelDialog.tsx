import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import type { CodexCustomModel } from "../types";
import { isValidModelId } from "../types";

interface CustomModelDialogProps {
  isOpen: boolean;
  models: CodexCustomModel[];
  onModelsChange: (models: CodexCustomModel[]) => void;
  onClose: () => void;
  initialAddMode?: boolean;
}

function sanitizeInput(value: string): string {
  const filtered = Array.from(value)
    .filter((char) => {
      const code = char.charCodeAt(0);
      if (code === 9 || code === 10 || code === 13) {
        return true;
      }
      return code >= 32 && code !== 127;
    })
    .join("");
  return filtered.replace(/\s+/g, " ");
}

export function CustomModelDialog({
  isOpen,
  models,
  onModelsChange,
  onClose,
  initialAddMode = false,
}: CustomModelDialogProps) {
  const { t } = useTranslation();
  const [isAdding, setIsAdding] = useState(false);
  const [editingModel, setEditingModel] = useState<CodexCustomModel | null>(
    null,
  );
  const [modelId, setModelId] = useState("");
  const [modelLabel, setModelLabel] = useState("");
  const [modelDescription, setModelDescription] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && initialAddMode) {
      setIsAdding(true);
      setEditingModel(null);
      setModelId("");
      setModelLabel("");
      setModelDescription("");
      setValidationError(null);
    }
  }, [initialAddMode, isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setIsAdding(false);
      setEditingModel(null);
      setModelId("");
      setModelLabel("");
      setModelDescription("");
      setValidationError(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [isOpen, onClose]);

  const modelIds = useMemo(() => new Set(models.map((item) => item.id)), [models]);

  const validateModelId = useCallback(
    (value: string): string | null => {
      const normalized = value.trim();
      if (!normalized) {
        return t("settings.vendor.modelManager.modelIdRequired");
      }
      if (!isValidModelId(normalized)) {
        return t("settings.vendor.modelManager.modelIdInvalid");
      }

      if (editingModel && editingModel.id === normalized) {
        return null;
      }
      if (modelIds.has(normalized)) {
        return t("settings.vendor.modelManager.modelIdDuplicate");
      }
      return null;
    },
    [editingModel, modelIds, t],
  );

  const resetEditor = useCallback(() => {
    setIsAdding(false);
    setEditingModel(null);
    setModelId("");
    setModelLabel("");
    setModelDescription("");
    setValidationError(null);
  }, []);

  const handleStartAdd = useCallback(() => {
    setIsAdding(true);
    setEditingModel(null);
    setModelId("");
    setModelLabel("");
    setModelDescription("");
    setValidationError(null);
  }, []);

  const handleStartEdit = useCallback((model: CodexCustomModel) => {
    setIsAdding(true);
    setEditingModel(model);
    setModelId(model.id);
    setModelLabel(model.label);
    setModelDescription(model.description ?? "");
    setValidationError(null);
  }, []);

  const handleDelete = useCallback(
    (id: string) => {
      onModelsChange(models.filter((model) => model.id !== id));
    },
    [models, onModelsChange],
  );

  const handleSave = useCallback(() => {
    const error = validateModelId(modelId);
    if (error) {
      setValidationError(error);
      return;
    }

    const normalizedId = sanitizeInput(modelId).trim();
    const normalizedLabel = sanitizeInput(modelLabel).trim() || normalizedId;
    const normalizedDescription = sanitizeInput(modelDescription).trim();

    const nextModel: CodexCustomModel = {
      id: normalizedId,
      label: normalizedLabel,
      description: normalizedDescription || undefined,
    };

    if (editingModel) {
      onModelsChange(
        models.map((model) => (model.id === editingModel.id ? nextModel : model)),
      );
    } else {
      onModelsChange([...models, nextModel]);
    }
    resetEditor();
  }, [
    editingModel,
    modelDescription,
    modelId,
    modelLabel,
    models,
    onModelsChange,
    resetEditor,
    validateModelId,
  ]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="vendor-dialog-overlay fixed inset-0 bg-black/60 backdrop-blur-[2px] flex items-center justify-center z-[100]" onClick={onClose}>
      <div
        className="vendor-dialog vendor-dialog-wide vendor-model-manager-dialog !w-[min(640px,90vw)] max-h-[86vh] rounded-[14px] bg-[var(--surface-card-strong)] border border-[var(--border-stronger)] shadow-[0_20px_50px_rgba(0,0,0,0.3)] flex flex-col overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="vendor-dialog-header flex items-center justify-between px-[18px] py-3.5 border-b border-[var(--border-muted)] [&_h3]:text-[15px] [&_h3]:font-semibold [&_h3]:text-[var(--text-primary)] [&_h3]:m-0">
          <h3>{t("settings.vendor.modelManager.title")}</h3>
          <button
            type="button"
            className="vendor-dialog-close bg-transparent border-0 text-[var(--text-secondary)] text-xl cursor-pointer px-1 leading-none hover:text-[var(--text-primary)]"
            onClick={onClose}
            aria-label={t("common.close")}
          >
            ×
          </button>
        </div>

        <div className="vendor-dialog-body px-[18px] py-4 overflow-y-auto flex-1 flex flex-col gap-4">
          <div className="vendor-hint text-[11px] text-[var(--text-secondary)] mt-0.5">{t("settings.vendor.modelManager.description")}</div>

          <div className="vendor-model-manager-list flex flex-col gap-2" role="list">
            {models.length === 0 && !isAdding ? (
              <div className="vendor-empty text-center px-5 py-[30px] text-[var(--text-secondary)] text-[13px] border border-dashed border-[var(--border-muted)] rounded-lg bg-[var(--surface-card)]">{t("settings.vendor.modelManager.empty")}</div>
            ) : (
              models.map((model) => (
                <div key={model.id} className="vendor-model-manager-item flex items-start gap-2.5 px-2.5 py-2 rounded-lg border border-[var(--border-muted)] bg-[var(--surface-card)]" role="listitem">
                  <div className="vendor-model-manager-main flex-1 min-w-0 flex flex-col gap-0.5">
                    <div className="vendor-model-manager-id font-[var(--font-code)] text-xs font-semibold text-[var(--text-primary)] break-all">{model.id}</div>
                    {model.label !== model.id && (
                      <div className="vendor-model-manager-label text-xs text-[var(--text-secondary)]">{model.label}</div>
                    )}
                    {model.description && (
                      <div className="vendor-model-manager-desc text-[11px] text-[var(--text-muted)] break-words">{model.description}</div>
                    )}
                  </div>
                  <div className="vendor-model-manager-actions flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      className="vendor-btn-icon w-[26px] h-[26px] flex items-center justify-center bg-transparent border-0 rounded-[5px] text-[var(--text-secondary)] cursor-pointer text-[13px] transition-all duration-150 [&_svg]:w-3.5 [&_svg]:h-3.5 [&_svg]:shrink-0 hover:bg-[var(--surface-card-strong)] hover:text-[var(--text-primary)]"
                      onClick={() => handleStartEdit(model)}
                      title={t("settings.vendor.edit")}
                    >
                      <Pencil aria-hidden />
                    </button>
                    <button
                      type="button"
                      className="vendor-btn-icon vendor-btn-danger w-[26px] h-[26px] flex items-center justify-center bg-transparent border-0 rounded-[5px] text-[#e55] cursor-pointer text-[13px] transition-all duration-150 [&_svg]:w-3.5 [&_svg]:h-3.5 [&_svg]:shrink-0 hover:bg-[var(--surface-card-strong)] hover:text-[#d44]"
                      onClick={() => handleDelete(model.id)}
                      title={t("settings.vendor.delete")}
                    >
                      <Trash2 aria-hidden />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {isAdding ? (
            <div className="vendor-model-manager-form border border-[var(--border-muted)] rounded-lg bg-[var(--surface-card)] p-2.5 flex flex-col gap-2">
              <div className="vendor-model-add flex gap-1.5 items-center [&_.vendor-input]:flex-1">
                <input
                  type="text"
                  className="vendor-input vendor-input-sm w-full px-2 py-[5px] rounded-md border border-[var(--border-muted)] bg-[var(--surface-card)] text-[var(--text-primary)] text-xs outline-none transition-[border-color] duration-150 box-border focus:border-[var(--text-accent)]"
                  value={modelId}
                  onChange={(event) => {
                    setModelId(event.target.value);
                    if (validationError) {
                      setValidationError(null);
                    }
                  }}
                  placeholder={t("settings.vendor.modelManager.modelIdPlaceholder")}
                  autoFocus
                />
                <input
                  type="text"
                  className="vendor-input vendor-input-sm w-full px-2 py-[5px] rounded-md border border-[var(--border-muted)] bg-[var(--surface-card)] text-[var(--text-primary)] text-xs outline-none transition-[border-color] duration-150 box-border focus:border-[var(--text-accent)]"
                  value={modelLabel}
                  onChange={(event) => setModelLabel(event.target.value)}
                  placeholder={t("settings.vendor.modelManager.modelLabelPlaceholder")}
                />
              </div>
              <input
                type="text"
                className="vendor-input vendor-input-sm w-full px-2 py-[5px] rounded-md border border-[var(--border-muted)] bg-[var(--surface-card)] text-[var(--text-primary)] text-xs outline-none transition-[border-color] duration-150 box-border focus:border-[var(--text-accent)]"
                value={modelDescription}
                onChange={(event) => setModelDescription(event.target.value)}
                placeholder={t(
                  "settings.vendor.modelManager.modelDescriptionPlaceholder",
                )}
              />
              {validationError && (
                <div className="vendor-json-error text-[#e55] text-[11px] mt-1">{validationError}</div>
              )}
              <div className="vendor-model-manager-form-actions flex justify-end gap-2">
                <button
                  type="button"
                  className="vendor-btn-cancel px-4 py-1.5 bg-[var(--vendor-button-primary-soft,transparent)] border border-[var(--vendor-button-primary-border,var(--border-muted))] rounded-md text-[var(--vendor-button-primary,var(--text-primary))] text-xs font-semibold cursor-pointer transition-[background,border-color,color] duration-150 hover:border-[var(--vendor-button-primary,var(--text-accent))] hover:bg-[var(--vendor-button-primary,var(--text-accent))] hover:text-white"
                  onClick={resetEditor}
                >
                  {t("settings.vendor.cancel")}
                </button>
                <button
                  type="button"
                  className="vendor-btn-save px-4 py-1.5 bg-[var(--vendor-button-primary,var(--text-accent))] border border-[var(--vendor-button-primary,var(--text-accent))] rounded-md text-white text-xs font-semibold cursor-pointer transition-[background,border-color] duration-150 hover:bg-[var(--vendor-button-primary-hover,var(--text-accent))] hover:border-[var(--vendor-button-primary-hover,var(--text-accent))] disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={handleSave}
                  disabled={!modelId.trim()}
                >
                  {editingModel
                    ? t("settings.vendor.dialog.saveChanges")
                    : t("settings.vendor.modelManager.addModel")}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="vendor-btn-save vendor-model-manager-add-btn px-4 py-1.5 bg-[var(--vendor-button-primary,var(--text-accent))] border border-[var(--vendor-button-primary,var(--text-accent))] rounded-md text-white text-xs font-semibold cursor-pointer transition-[background,border-color] duration-150 hover:bg-[var(--vendor-button-primary-hover,var(--text-accent))] hover:border-[var(--vendor-button-primary-hover,var(--text-accent))] disabled:opacity-50 disabled:cursor-not-allowed self-start"
              onClick={handleStartAdd}
            >
              + {t("settings.vendor.modelManager.addModel")}
            </button>
          )}
        </div>

        <div className="vendor-dialog-footer flex items-center justify-end gap-2 px-[18px] py-3 border-t border-[var(--border-muted)]">
          <button type="button" className="vendor-btn-save px-4 py-1.5 bg-[var(--vendor-button-primary,var(--text-accent))] border border-[var(--vendor-button-primary,var(--text-accent))] rounded-md text-white text-xs font-semibold cursor-pointer transition-[background,border-color] duration-150 hover:bg-[var(--vendor-button-primary-hover,var(--text-accent))] hover:border-[var(--vendor-button-primary-hover,var(--text-accent))] disabled:opacity-50 disabled:cursor-not-allowed" onClick={onClose}>
            {t("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
