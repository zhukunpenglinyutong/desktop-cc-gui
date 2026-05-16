import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import Play from "lucide-react/dist/esm/icons/play";
import { TooltipIconButton } from "../../../components/ui/tooltip-icon-button";
import type { LaunchScriptIconId } from "../../../types";
import { LaunchScriptIconPicker } from "./LaunchScriptIconPicker";
import { DEFAULT_LAUNCH_SCRIPT_ICON } from "../utils/launchScriptIcons";

type LaunchScriptButtonProps = {
  launchScript: string | null;
  editorOpen: boolean;
  draftScript: string;
  isSaving: boolean;
  error: string | null;
  onRun: () => void;
  onOpenEditor: () => void;
  onCloseEditor: () => void;
  onDraftChange: (value: string) => void;
  onSave: () => void;
  showNew?: boolean;
  newEditorOpen?: boolean;
  newDraftScript?: string;
  newDraftIcon?: LaunchScriptIconId;
  newDraftLabel?: string;
  newError?: string | null;
  onOpenNew?: () => void;
  onCloseNew?: () => void;
  onNewDraftChange?: (value: string) => void;
  onNewDraftIconChange?: (value: LaunchScriptIconId) => void;
  onNewDraftLabelChange?: (value: string) => void;
  onCreateNew?: () => void;
};

export function LaunchScriptButton({
  launchScript,
  editorOpen,
  draftScript,
  isSaving,
  error,
  onRun,
  onOpenEditor,
  onCloseEditor,
  onDraftChange,
  onSave,
  showNew = false,
  newEditorOpen = false,
  newDraftScript = "",
  newDraftIcon = DEFAULT_LAUNCH_SCRIPT_ICON,
  newDraftLabel = "",
  newError = null,
  onOpenNew,
  onCloseNew,
  onNewDraftChange,
  onNewDraftIconChange,
  onNewDraftLabelChange,
  onCreateNew,
}: LaunchScriptButtonProps) {
  const { t } = useTranslation();
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const hasLaunchScript = Boolean(launchScript?.trim());
  const triggerLabel = hasLaunchScript
    ? t("composer.runLaunchScript")
    : t("composer.setLaunchScript");

  useEffect(() => {
    if (!editorOpen) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const popoverElement = popoverRef.current;
      if (!popoverElement) {
        return;
      }
      if (!(event.target instanceof Node)) {
        return;
      }
      if (popoverElement.contains(event.target)) {
        return;
      }
      onCloseEditor();
      onCloseNew?.();
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [editorOpen, onCloseEditor, onCloseNew]);

  return (
    <div className="launch-script-menu relative" ref={popoverRef}>
      <div className="launch-script-buttons inline-flex items-center gap-0.5">
        <TooltipIconButton
          className="ghost main-header-action launch-script-run p-1.5 rounded-lg inline-flex items-center justify-center"
          onClick={onRun}
          onContextMenu={(event) => {
            event.preventDefault();
            onOpenEditor();
          }}
          data-tauri-drag-region="false"
          label={triggerLabel}
        >
          <Play size={14} aria-hidden />
        </TooltipIconButton>
      </div>
      {editorOpen && (
        <div
          className="launch-script-popover popover-surface absolute right-0 top-[calc(100%+8px)] min-w-60 p-3 rounded-xl z-[5]"
          role="dialog"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="launch-script-title text-xs font-semibold text-(--text-stronger) mb-2">{t("composer.launchScript")}</div>
          <textarea
            className="launch-script-textarea w-full rounded-lg border border-(--border-muted) bg-(--surface-control) text-(--text-strong) p-2 text-xs resize-y min-h-24"
            placeholder="例如 npm run dev"
            value={draftScript}
            onChange={(event) => onDraftChange(event.target.value)}
            rows={6}
            data-tauri-drag-region="false"
          />
          {error ? <div className="launch-script-error mt-2 text-[11px] text-(--text-danger)">{error}</div> : null}
          <div className="launch-script-actions mt-2.5 flex justify-end gap-2">
            <button
              type="button"
              className="ghost"
              onClick={() => {
                onCloseEditor();
                onCloseNew?.();
              }}
              data-tauri-drag-region="false"
            >
              {t("common.cancel")}
            </button>
            {showNew && onOpenNew && (
              <button
                type="button"
                className="ghost"
                onClick={onOpenNew}
                data-tauri-drag-region="false"
              >
                {t("composer.new")}
              </button>
            )}
            <button
              type="button"
              className="primary"
              onClick={onSave}
              disabled={isSaving}
              data-tauri-drag-region="false"
            >
              {isSaving ? t("composer.saving") : t("common.save")}
            </button>
          </div>
          {showNew && newEditorOpen && onNewDraftChange && onNewDraftIconChange && onCreateNew && (
            <div className="launch-script-new mt-3 pt-2.5 border-t border-(--border-muted)">
              <div className="launch-script-title text-xs font-semibold text-(--text-stronger) mb-2">{t("composer.newLaunchScript")}</div>
              <LaunchScriptIconPicker
                value={newDraftIcon}
                onChange={onNewDraftIconChange}
              />
              <input
                className="launch-script-input w-full rounded-lg border border-(--border-muted) bg-(--surface-control) text-(--text-strong) py-1.5 px-2 text-xs mb-2"
                type="text"
                placeholder={t("composer.optionalLabel")}
                value={newDraftLabel}
                onChange={(event) => onNewDraftLabelChange?.(event.target.value)}
                data-tauri-drag-region="false"
              />
              <textarea
                className="launch-script-textarea w-full rounded-lg border border-(--border-muted) bg-(--surface-control) text-(--text-strong) p-2 text-xs resize-y min-h-24"
                placeholder="例如 npm run dev"
                value={newDraftScript}
                onChange={(event) => onNewDraftChange(event.target.value)}
                rows={5}
                data-tauri-drag-region="false"
              />
              {newError ? <div className="launch-script-error mt-2 text-[11px] text-(--text-danger)">{newError}</div> : null}
              <div className="launch-script-actions mt-2.5 flex justify-end gap-2">
                <button
                  type="button"
                  className="ghost"
                  onClick={onCloseNew}
                  data-tauri-drag-region="false"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={onCreateNew}
                  disabled={isSaving}
                  data-tauri-drag-region="false"
                >
                  {isSaving ? t("composer.saving") : t("common.create")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
