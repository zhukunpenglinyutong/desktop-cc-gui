import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle";

type LoadingProgressDialogProps = {
  title: string;
  message?: string | null;
  onClose: () => void;
};

export function LoadingProgressDialog({
  title,
  message = null,
  onClose,
}: LoadingProgressDialogProps) {
  const { t } = useTranslation();
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
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

  return (
    <div
      className="loading-progress-modal fixed inset-0 z-[44]"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="loading-progress-modal-backdrop absolute inset-0 bg-black/52 backdrop-blur-[8px] [.app.reduced-transparency_&]:backdrop-blur-none" />
      <div
        className="loading-progress-modal-card absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(380px,calc(100vw-28px))] rounded-lg border border-[color-mix(in_srgb,var(--border-stronger),transparent_28%)] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--surface-card-strong),#0f172a_5%)_0%,color-mix(in_srgb,var(--surface-card),#0b1320_4%)_100%)] shadow-[0_20px_48px_rgba(0,0,0,0.28)] p-4 box-border max-sm:w-[min(360px,calc(100vw-20px))] max-sm:p-3.5"
      >
        <header className="loading-progress-modal-header flex items-start justify-between gap-3">
          <div className="loading-progress-modal-copy min-w-0 flex-1 flex items-start gap-3">
            <div className="loading-progress-modal-spinner-wrap inline-flex items-center justify-center w-[34px] h-[34px] rounded-lg border border-[color-mix(in_srgb,var(--border-accent),transparent_34%)] bg-[color-mix(in_srgb,var(--surface-active),transparent_40%)] text-[#93c5fd] shrink-0" aria-hidden>
              <LoaderCircle className="loading-progress-modal-spinner animate-spin" size={18} />
            </div>
            <div className="loading-progress-modal-text min-w-0">
              <h3 className="m-0 text-[color:var(--text-strong)] text-base leading-tight font-bold">{title}</h3>
              {message ? (
                <p className="mt-1.5 mb-0 text-[color:var(--text-subtle)] text-[13px] leading-snug" aria-live="polite">{message}</p>
              ) : null}
            </div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="ghost loading-progress-modal-close inline-flex items-center justify-center min-w-[84px] min-h-8 px-2.5 rounded-md shrink-0 text-xs leading-none whitespace-nowrap"
            onClick={onClose}
            aria-label={t("workspace.loadingProgressRunInBackground")}
            title={t("workspace.loadingProgressRunInBackground")}
          >
            {t("workspace.loadingProgressRunInBackground")}
          </button>
        </header>
      </div>
    </div>
  );
}
