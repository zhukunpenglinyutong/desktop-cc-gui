import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { TooltipIconButton } from "../../../components/ui/tooltip-icon-button";
import type { LaunchScriptEntry, LaunchScriptIconId } from "../../../types";
import { LaunchScriptIconPicker } from "./LaunchScriptIconPicker";
import { getLaunchScriptIcon, getLaunchScriptIconLabel } from "../utils/launchScriptIcons";

type LaunchScriptEntryButtonProps = {
  entry: LaunchScriptEntry;
  editorOpen: boolean;
  draftScript: string;
  draftIcon: LaunchScriptIconId;
  draftLabel: string;
  isSaving: boolean;
  error: string | null;
  onRun: () => void;
  onOpenEditor: () => void;
  onCloseEditor: () => void;
  onDraftChange: (value: string) => void;
  onDraftIconChange: (value: LaunchScriptIconId) => void;
  onDraftLabelChange: (value: string) => void;
  onSave: () => void;
  onDelete: () => void;
};

export function LaunchScriptEntryButton({
  entry,
  editorOpen,
  draftScript,
  draftIcon,
  draftLabel,
  isSaving,
  error,
  onRun,
  onOpenEditor,
  onCloseEditor,
  onDraftChange,
  onDraftIconChange,
  onDraftLabelChange,
  onSave,
  onDelete,
}: LaunchScriptEntryButtonProps) {
  const { t } = useTranslation();
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const Icon = getLaunchScriptIcon(entry.icon);
  const iconLabel = getLaunchScriptIconLabel(entry.icon);

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
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [editorOpen, onCloseEditor]);

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
          label={entry.label?.trim() || iconLabel}
        >
          <Icon size={14} aria-hidden />
        </TooltipIconButton>
      </div>
      {editorOpen && (
        <div
          className="launch-script-popover popover-surface absolute right-0 top-[calc(100%+8px)] min-w-60 p-3 rounded-xl z-[5]"
          role="dialog"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="launch-script-title text-xs font-semibold text-(--text-stronger) mb-2">
            {entry.label?.trim() || t("composer.launchScript")}
          </div>
          <LaunchScriptIconPicker value={draftIcon} onChange={onDraftIconChange} />
          <input
            className="launch-script-input w-full rounded-lg border border-(--border-muted) bg-(--surface-control) text-(--text-strong) py-1.5 px-2 text-xs mb-2"
            type="text"
            placeholder={t("composer.optionalLabel")}
            value={draftLabel}
            onChange={(event) => onDraftLabelChange(event.target.value)}
            data-tauri-drag-region="false"
          />
          <textarea
            className="launch-script-textarea w-full rounded-lg border border-(--border-muted) bg-(--surface-control) text-(--text-strong) p-2 text-xs resize-y min-h-24"
            placeholder="例如 npm run dev"
            value={draftScript}
            onChange={(event) => onDraftChange(event.target.value)}
            rows={6}
            data-tauri-drag-region="false"
          />
          {error && <div className="launch-script-error mt-2 text-[11px] text-(--text-danger)">{error}</div>}
          <div className="launch-script-actions mt-2.5 flex justify-end gap-2">
            <button
              type="button"
              className="ghost"
              onClick={onCloseEditor}
              data-tauri-drag-region="false"
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="ghost launch-script-delete text-(--text-danger)"
              onClick={onDelete}
              data-tauri-drag-region="false"
            >
              {t("common.delete")}
            </button>
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
        </div>
      )}
    </div>
  );
}
