import { useEffect } from "react";
import { useTranslation } from "react-i18next";

interface DeleteConfirmDialogProps {
  isOpen: boolean;
  providerName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DeleteConfirmDialog({
  isOpen,
  providerName,
  onConfirm,
  onCancel,
}: DeleteConfirmDialogProps) {
  const { t } = useTranslation();

  useEffect(() => {
    if (isOpen) {
      const handleEscape = (e: KeyboardEvent) => {
        if (e.key === "Escape") onCancel();
      };
      window.addEventListener("keydown", handleEscape);
      return () => window.removeEventListener("keydown", handleEscape);
    }
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div className="vendor-dialog-overlay fixed inset-0 bg-black/60 backdrop-blur-[2px] flex items-center justify-center z-[100]" onClick={onCancel}>
      <div
        className="vendor-dialog vendor-dialog-sm w-[min(400px,90vw)] max-h-[86vh] rounded-[14px] bg-[var(--surface-card-strong)] border border-[var(--border-stronger)] shadow-[0_20px_50px_rgba(0,0,0,0.3)] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="vendor-dialog-header flex items-center justify-between px-[18px] py-3.5 border-b border-[var(--border-muted)] [&_h3]:text-[15px] [&_h3]:font-semibold [&_h3]:text-[var(--text-primary)] [&_h3]:m-0">
          <h3>{t("settings.vendor.deleteConfirm.title")}</h3>
        </div>
        <div className="vendor-dialog-body px-[18px] py-4 overflow-y-auto flex-1 flex flex-col gap-4">
          <p>
            {t("settings.vendor.deleteConfirm.message", {
              name: providerName,
            })}
          </p>
        </div>
        <div className="vendor-dialog-footer flex items-center justify-end gap-2 px-[18px] py-3 border-t border-[var(--border-muted)]">
          <button type="button" className="vendor-btn-cancel px-4 py-1.5 bg-[var(--vendor-button-primary-soft,transparent)] border border-[var(--vendor-button-primary-border,var(--border-muted))] rounded-md text-[var(--vendor-button-primary,var(--text-primary))] text-xs font-semibold cursor-pointer transition-[background,border-color,color] duration-150" onClick={onCancel}>
            {t("settings.vendor.cancel")}
          </button>
          <button
            type="button"
            className="vendor-btn-danger-solid"
            onClick={onConfirm}
          >
            {t("settings.vendor.deleteConfirm.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
