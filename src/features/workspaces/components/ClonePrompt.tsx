import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

type ClonePromptProps = {
  workspaceName: string;
  copyName: string;
  copiesFolder: string;
  suggestedCopiesFolder?: string | null;
  error?: string | null;
  onCopyNameChange: (value: string) => void;
  onChooseCopiesFolder: () => void;
  onUseSuggestedCopiesFolder: () => void;
  onClearCopiesFolder: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  isBusy?: boolean;
};

export function ClonePrompt({
  workspaceName,
  copyName,
  copiesFolder,
  suggestedCopiesFolder = null,
  error = null,
  onCopyNameChange,
  onChooseCopiesFolder,
  onUseSuggestedCopiesFolder,
  onClearCopiesFolder,
  onCancel,
  onConfirm,
  isBusy = false,
}: ClonePromptProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const canCreate = copyName.trim().length > 0 && copiesFolder.trim().length > 0;
  const showSuggested =
    Boolean(suggestedCopiesFolder) && copiesFolder.trim().length === 0;

  return (
    <div className="clone-modal fixed inset-0 z-40" role="dialog" aria-modal="true">
      <div
        className="clone-modal-backdrop absolute inset-0 bg-[rgba(8,12,20,0.64)] backdrop-blur-[6px] [.app.reduced-transparency_&]:backdrop-filter-none [:root[data-theme=light]_&]:bg-[rgba(8,12,20,0.45)] [@media(prefers-color-scheme:light){:root:not([data-theme])_&}]:bg-[rgba(8,12,20,0.45)]"
        onClick={() => {
          if (!isBusy) {
            onCancel();
          }
        }}
      />
      <div className="clone-modal-card absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(520px,calc(100vw-48px))] max-h-[calc(100vh-48px)] overflow-y-auto bg-[color-mix(in_srgb,var(--surface-popover),transparent_2%)] text-(--text-primary) border border-[color-mix(in_srgb,var(--border-stronger),transparent_20%)] rounded-2xl py-[18px] px-5 flex flex-col gap-3 shadow-[0_18px_40px_rgba(0,0,0,0.3)]">
        <div className="clone-modal-title text-base font-semibold text-(--text-strong)">
          {t("workspace.newCloneAgent")}
        </div>
        <div className="clone-modal-subtitle text-[13px] text-(--text-subtle)">
          {t("workspace.createWorkingCopyOf", { name: workspaceName })}
        </div>
        <label
          className="clone-modal-label text-xs text-(--text-faint)"
          htmlFor="clone-copy-name"
        >
          {t("workspace.copyName")}
        </label>
        <input
          id="clone-copy-name"
          ref={inputRef}
          className="clone-modal-input rounded-[10px] border border-(--border-subtle) bg-(--surface-card-strong) text-(--text-strong) py-2.5 px-3 text-[13px] w-full placeholder:text-(--text-faint) focus:outline-2 focus:outline-[color-mix(in_srgb,var(--border-accent),#2563eb_28%)] focus:[outline-offset:1px]"
          value={copyName}
          onChange={(event) => onCopyNameChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              if (!isBusy) {
                onCancel();
              }
            }
            if (event.key === "Enter" && canCreate && !isBusy) {
              event.preventDefault();
              onConfirm();
            }
          }}
        />
        <label
          className="clone-modal-label text-xs text-(--text-faint)"
          htmlFor="clone-copies-folder"
        >
          {t("workspace.copiesFolder")}
        </label>
        <div className="clone-modal-folder-row flex gap-2 items-center">
          <textarea
            id="clone-copies-folder"
            className="clone-modal-input clone-modal-input--path rounded-[10px] border border-(--border-subtle) bg-(--surface-card-strong) text-(--text-strong) py-2.5 px-3 text-[13px] w-full placeholder:text-(--text-faint) focus:outline-2 focus:outline-[color-mix(in_srgb,var(--border-accent),#2563eb_28%)] focus:[outline-offset:1px] resize-none overflow-x-auto overflow-y-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:w-0 [&::-webkit-scrollbar]:h-0"
            value={copiesFolder}
            placeholder={t("settings.notSet")}
            readOnly
            rows={1}
            wrap="off"
            onFocus={(event) => {
              const value = event.currentTarget.value;
              event.currentTarget.setSelectionRange(value.length, value.length);
              requestAnimationFrame(() => {
                event.currentTarget.scrollLeft = event.currentTarget.scrollWidth;
              });
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                if (!isBusy) {
                  onCancel();
                }
              }
              if (event.key === "Enter" && canCreate && !isBusy) {
                event.preventDefault();
                onConfirm();
              }
            }}
          ></textarea>
          <button
            type="button"
            className="ghost clone-modal-button py-1.5 px-3 rounded-[10px] whitespace-nowrap"
            onClick={onChooseCopiesFolder}
            disabled={isBusy}
          >
            {t("settings.chooseEllipsis")}
          </button>
          <button
            type="button"
            className="ghost clone-modal-button py-1.5 px-3 rounded-[10px] whitespace-nowrap"
            onClick={onClearCopiesFolder}
            disabled={isBusy || copiesFolder.trim().length === 0}
          >
            {t("common.clear")}
          </button>
        </div>
        {showSuggested && (
          <div className="clone-modal-suggested flex flex-col gap-1.5">
            <div className="clone-modal-suggested-label text-[11px] text-(--text-faint)">
              {t("workspace.suggested")}
            </div>
            <div className="clone-modal-suggested-row flex gap-2 items-center">
              <textarea
                className="clone-modal-suggested-path clone-modal-input--path flex-1 min-w-0 py-2.5 px-3 rounded-[10px] border border-(--border-subtle) bg-(--surface-card-muted) text-(--text-subtle) text-xs resize-none overflow-x-auto overflow-y-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:w-0 [&::-webkit-scrollbar]:h-0"
                value={suggestedCopiesFolder ?? ""}
                readOnly
                rows={1}
                wrap="off"
                aria-label={t("workspace.suggested")}
                title={suggestedCopiesFolder ?? ""}
                onFocus={(event) => {
                  const value = event.currentTarget.value;
                  event.currentTarget.setSelectionRange(value.length, value.length);
                  requestAnimationFrame(() => {
                    event.currentTarget.scrollLeft = event.currentTarget.scrollWidth;
                  });
                }}
              ></textarea>
              <button
                type="button"
                className="ghost clone-modal-button py-1.5 px-3 rounded-[10px] whitespace-nowrap"
                onClick={async () => {
                  if (!suggestedCopiesFolder) {
                    return;
                  }
                  try {
                    await navigator.clipboard.writeText(suggestedCopiesFolder);
                  } catch {
                    // Ignore clipboard failures (e.g. permission denied).
                  }
                }}
                disabled={isBusy || !suggestedCopiesFolder}
              >
                {t("debug.copy")}
              </button>
              <button
                type="button"
                className="ghost clone-modal-button py-1.5 px-3 rounded-[10px] whitespace-nowrap"
                onClick={onUseSuggestedCopiesFolder}
                disabled={isBusy}
              >
                {t("workspace.useSuggested")}
              </button>
            </div>
          </div>
        )}
        {error && (
          <div className="clone-modal-error text-xs text-[color-mix(in_srgb,var(--status-error),var(--text-strong)_28%)] bg-[color-mix(in_srgb,var(--status-error),transparent_86%)] border border-[color-mix(in_srgb,var(--status-error),transparent_56%)] py-2 px-2.5 rounded-[10px]">
            {error}
          </div>
        )}
        <div className="clone-modal-actions flex justify-end gap-2 mt-1">
          <button
            className="ghost clone-modal-button py-1.5 px-3 rounded-[10px] whitespace-nowrap"
            onClick={onCancel}
            type="button"
            disabled={isBusy}
          >
            {t("common.cancel")}
          </button>
          <button
            className="primary clone-modal-button py-1.5 px-3 rounded-[10px] whitespace-nowrap"
            onClick={onConfirm}
            type="button"
            disabled={isBusy || !canCreate}
          >
            {t("common.create")}
          </button>
        </div>
      </div>
    </div>
  );
}
