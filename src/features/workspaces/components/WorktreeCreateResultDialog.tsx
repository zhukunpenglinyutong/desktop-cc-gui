import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Check from "lucide-react/dist/esm/icons/check";
import CheckCircle2 from "lucide-react/dist/esm/icons/check-circle-2";
import AlertTriangle from "lucide-react/dist/esm/icons/triangle-alert";
import Copy from "lucide-react/dist/esm/icons/copy";

type WorktreeCreateResultDialogProps = {
  result: {
    kind: "info" | "warning";
    createdMessage: string;
    statusMessage: string | null;
    errorMessage: string | null;
    retryCommand: string | null;
  };
  onClose: () => void;
};

export function WorktreeCreateResultDialog({
  result,
  onClose,
}: WorktreeCreateResultDialogProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<number | null>(null);
  const isWarning = result.kind === "warning";

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current != null) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const handleCopy = async () => {
    if (!result.retryCommand) {
      return;
    }
    try {
      await navigator.clipboard.writeText(result.retryCommand);
      setCopied(true);
      if (copyTimeoutRef.current != null) {
        window.clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = window.setTimeout(() => {
        setCopied(false);
      }, 1800);
    } catch {
      // Ignore clipboard failures.
    }
  };

  return (
    <div className="worktree-result-modal fixed inset-0 z-[44]" role="dialog" aria-modal="true">
      <div className="worktree-result-modal-backdrop absolute inset-0 bg-black/[.66] backdrop-blur-[6px]" onClick={onClose} />
      <div className="worktree-result-modal-card absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(560px,calc(100vw-24px))] rounded-[20px] border border-(--border-stronger)/[.74] shadow-[0_22px_56px_rgba(0,0,0,0.36)] bg-card p-4 flex flex-col gap-3 max-[640px]:w-[calc(100vw-14px)] max-[640px]:rounded-[16px] max-[640px]:p-3 max-[640px]:gap-[10px]">
        <header className="worktree-result-modal-header flex items-start gap-[10px]">
          <div className={`worktree-result-modal-icon w-[34px] h-[34px] rounded-[10px] inline-flex items-center justify-center flex-none${isWarning ? " is-warning text-red-400 border border-red-400/[.74] bg-gradient-to-b from-red-400/[.24] to-red-400/[.12]" : " is-success text-green-400 border border-green-400/[.72] bg-gradient-to-b from-green-400/[.20] to-green-400/[.10]"}`}>
            {isWarning ? <AlertTriangle size={18} aria-hidden /> : <CheckCircle2 size={18} aria-hidden />}
          </div>
          <div className="worktree-result-modal-header-main min-w-0">
            <h3 className="m-0 text-[24px] font-extrabold leading-[1.08] text-(--text-strong) max-[640px]:text-[20px]">{t("workspace.worktreeCreateResultTitle")}</h3>
            <p className="m-[5px_0_0] text-[13px] leading-[1.4] text-(--text-subtle)">{isWarning ? t("workspace.worktreeResultWarningSubtitle") : t("workspace.worktreeResultSuccessSubtitle")}</p>
          </div>
        </header>

        <div className="worktree-result-modal-success rounded-[12px] border border-green-500/[.54] bg-gradient-to-b from-green-500/[.16] to-green-500/[.08] text-(--text-strong) p-[10px_11px] flex items-start gap-[7px] text-[13px] font-bold leading-[1.4]">
          <CheckCircle2 size={16} aria-hidden />
          <span>{result.createdMessage}</span>
        </div>

        {result.errorMessage && (
          <section className="worktree-result-modal-warning rounded-[12px] border border-red-400/[.72] bg-gradient-to-b from-red-400/[.24] to-red-400/[.14] text-(--text-strong) p-[11px] flex flex-col gap-[7px]">
            <div className="worktree-result-modal-warning-title inline-flex items-center gap-[6px] text-[13px] font-extrabold tracking-[0.02em]">
              <AlertTriangle size={15} aria-hidden />
              <span>{t("workspace.worktreeResultErrorTitle")}</span>
            </div>
            <p className="m-0 text-[13px] leading-[1.45]">{result.errorMessage}</p>
          </section>
        )}

        {result.statusMessage && <p className="worktree-result-modal-status m-0 rounded-[11px] border border-(--border-subtle)/[.84] bg-(--surface-card)/[.86] text-(--text-strong) text-[13px] leading-[1.45] p-[10px_11px]">{result.statusMessage}</p>}

        {result.retryCommand && (
          <section className="worktree-result-modal-retry rounded-[12px] border border-(--border-accent)/[.66] bg-(--surface-card)/[.86] p-[10px_11px] flex flex-col gap-2">
            <div className="worktree-result-modal-retry-head flex items-center justify-between gap-2 max-[640px]:flex-col max-[640px]:items-stretch">
              <span className="text-[12px] font-bold text-(--text-subtle)">{t("workspace.worktreePublishRetryCommandLabel")}</span>
              <button
                type="button"
                className={`ghost worktree-result-copy-button h-[28px] px-[10px] rounded-[9px] inline-flex items-center gap-[5px]${copied ? " is-copied border-green-500/[.62] text-green-400" : ""} max-[640px]:w-full max-[640px]:justify-center`}
                onClick={() => {
                  void handleCopy();
                }}
              >
                {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
                <span>{copied ? t("messages.copied") : t("workspace.copyCommand")}</span>
              </button>
            </div>
            <code className="rounded-[10px] border border-(--border-subtle)/[.86] bg-(--surface-card)/[.96] p-[9px_10px] text-[12px] leading-[1.4] text-(--text-strong) font-[family-name:var(--code-font-family,_Menlo,_Monaco,_monospace)] break-all">{result.retryCommand}</code>
          </section>
        )}

        <footer className="worktree-result-modal-actions flex justify-end">
          <button type="button" className="primary worktree-result-ok-button min-w-[110px] h-[36px] rounded-[11px] w-full max-[640px]:w-full" onClick={onClose}>
            {t("common.ok")}
          </button>
        </footer>
      </div>
    </div>
  );
}
