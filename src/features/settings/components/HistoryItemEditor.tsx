/**
 * Dialog for adding or editing a history completion item.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import Minus from "lucide-react/dist/esm/icons/minus";
import Plus from "lucide-react/dist/esm/icons/plus";
import X from "lucide-react/dist/esm/icons/x";
import Info from "lucide-react/dist/esm/icons/info";

interface HistoryItemEditorProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (text: string, importance: number) => void;
  mode: "add" | "edit";
  initialText?: string;
  initialImportance?: number;
}

export function HistoryItemEditor({
  isOpen,
  onClose,
  onSave,
  mode,
  initialText = "",
  initialImportance = 1,
}: HistoryItemEditorProps) {
  const { t } = useTranslation();
  const [text, setText] = useState(initialText);
  const [importance, setImportance] = useState(initialImportance);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen) {
      setText(initialText);
      setImportance(initialImportance);
      setTimeout(() => {
        textareaRef.current?.focus();
      }, 100);
    }
  }, [isOpen, initialText, initialImportance]);

  const handleSave = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSave(trimmed, importance);
    onClose();
  }, [text, importance, onSave, onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        handleSave();
      }
    },
    [onClose, handleSave],
  );

  if (!isOpen) return null;

  const title =
    mode === "add"
      ? t("settings.historyEditorAddTitle")
      : t("settings.historyEditorEditTitle");

  return (
    <div className="history-editor-overlay fixed inset-0 flex items-center justify-center z-50 bg-black/50 backdrop-blur-[2px]" onClick={onClose}>
      <div
        className="history-editor-dialog bg-(--surface-elevated) border border-(--border-muted) rounded-xl p-5 min-w-90 max-w-120 w-9/10 shadow-[0_8px_32px_rgba(0,0,0,0.3)]"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="history-editor-header flex items-center justify-between mb-4">
          <h4 className="history-editor-title text-[15px] font-semibold text-(--text-default) m-0">{title}</h4>
          <button
            type="button"
            className="history-editor-close inline-flex items-center justify-center w-7 h-7 border-none bg-none rounded-md cursor-pointer text-(--text-muted)"
            onClick={onClose}
            title={t("common.close")}
          >
            <X size={14} />
          </button>
        </div>

        <div>
          <div className="history-editor-field mb-3">
            <label className="history-editor-label block text-[13px] font-medium text-(--text-default) mb-1">
              {t("settings.historyEditorContent")}
            </label>
            <textarea
              ref={textareaRef}
              className="history-editor-textarea w-full min-h-18 p-2 border border-(--border-muted) rounded-md bg-(--surface-messages) text-(--text-default) text-[13px] leading-normal resize-y outline-none font-inherit"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t("settings.historyEditorContentPlaceholder")}
              rows={3}
            />
          </div>

          <div className="history-editor-field mb-3">
            <label className="history-editor-label block text-[13px] font-medium text-(--text-default) mb-1">
              {t("settings.historyEditorImportance")}
            </label>
            <div className="history-editor-importance flex items-center gap-2">
              <button
                type="button"
                className="history-editor-importance-btn inline-flex items-center justify-center w-7 h-7 border border-(--border-muted) bg-none rounded-md cursor-pointer text-(--text-muted) disabled:opacity-40 disabled:cursor-not-allowed"
                onClick={() => setImportance((prev) => Math.max(1, prev - 1))}
                disabled={importance <= 1}
              >
                <Minus size={14} />
              </button>
              <input
                type="number"
                className="history-editor-importance-input w-14 text-center p-1 border border-(--border-muted) rounded-md bg-(--surface-messages) text-(--text-default) text-sm outline-none"
                value={importance}
                onChange={(e) => {
                  const value = parseInt(e.target.value, 10);
                  if (!isNaN(value) && value >= 1) {
                    setImportance(value);
                  }
                }}
                min={1}
              />
              <button
                type="button"
                className="history-editor-importance-btn inline-flex items-center justify-center w-7 h-7 border border-(--border-muted) bg-none rounded-md cursor-pointer text-(--text-muted)"
                onClick={() => setImportance((prev) => prev + 1)}
              >
                <Plus size={14} />
              </button>
            </div>
            <div className="history-editor-hint flex items-center gap-1 text-xs text-(--text-muted) mt-1">
              <Info size={12} />
              <span>{t("settings.historyEditorImportanceHint")}</span>
            </div>
          </div>
        </div>

        <div className="history-editor-footer flex items-center justify-end gap-2 mt-4">
          <button
            type="button"
            className="history-editor-btn px-4 py-1.5 rounded-md text-[13px] cursor-pointer border border-(--border-muted) bg-none text-(--text-default)"
            onClick={onClose}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="history-editor-btn history-editor-btn--primary px-4 py-1.5 rounded-md text-[13px] cursor-pointer border border-(--text-accent) bg-(--text-accent) text-white disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleSave}
            disabled={!text.trim()}
          >
            {t("common.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
