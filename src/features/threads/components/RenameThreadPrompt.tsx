import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

type RenameThreadPromptProps = {
  currentName: string;
  name: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
};

export function RenameThreadPrompt({
  currentName,
  name,
  onChange,
  onCancel,
  onConfirm,
}: RenameThreadPromptProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div className="worktree-modal fixed inset-0 z-40" role="dialog" aria-modal="true">
      <div className="worktree-modal-backdrop absolute inset-0 bg-black/[.64] backdrop-blur-sm" onClick={onCancel} />
      <div className="worktree-modal-card absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(980px,calc(100vw-28px))] max-h-[calc(100vh-24px)] overflow-hidden rounded-[18px] border border-(--border-stronger)/[.64] shadow-[0_24px_56px_rgba(0,0,0,0.3)] bg-card p-3 box-border grid grid-cols-[minmax(280px,320px)_minmax(0,1fr)] gap-[10px] max-[980px]:w-[min(760px,calc(100vw-16px))] max-[980px]:grid-cols-1 max-[640px]:w-[calc(100vw-12px)] max-[640px]:p-2">
        <div className="worktree-modal-title m-0 text-[24px] font-extrabold tracking-[-0.018em] text-(--text-strong) leading-[1.08]">{t("threads.renameThread")}</div>
        <div className="worktree-modal-subtitle mt-[5px] text-(--text-subtle) text-[13px] leading-[1.34]">
          {t("threads.currentName")} "{currentName}"
        </div>
        <label className="worktree-modal-label text-[11px] font-bold tracking-[0.06em] uppercase text-(--text-faint)" htmlFor="thread-rename">
          {t("threads.newName")}
        </label>
        <input
          id="thread-rename"
          ref={inputRef}
          className="worktree-modal-input w-full rounded-[10px] border border-(--border-subtle)/[.90] bg-(--surface-card)/[.92] text-(--text-strong) box-border h-[38px] px-[10px] text-[14px] font-[family-name:var(--code-font-family,_JetBrains_Mono,_monospace)] leading-none focus:outline-2 focus:outline-blue-600 focus:outline-offset-1"
          value={name}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onCancel();
            }
            if (event.key === "Enter") {
              event.preventDefault();
              onConfirm();
            }
          }}
        />
        <div className="worktree-modal-actions flex justify-end gap-2 pt-[2px]">
          <button
            className="ghost worktree-modal-button rounded-[10px] min-w-[72px] h-[33px] px-3 text-[13px] font-bold border border-(--border-subtle)/[.95] bg-(--surface-card)/[.78]"
            onClick={onCancel}
            type="button"
          >
            {t("common.cancel")}
          </button>
          <button
            className="primary worktree-modal-button rounded-[10px] min-w-[72px] h-[33px] px-3 text-[13px] font-bold border border-blue-600/[.82] bg-gradient-to-b from-blue-600 to-blue-700 text-blue-50"
            onClick={onConfirm}
            type="button"
            disabled={name.trim().length === 0}
          >
            {t("threads.rename")}
          </button>
        </div>
      </div>
    </div>
  );
}
