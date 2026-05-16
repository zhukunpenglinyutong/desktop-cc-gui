import { useTranslation } from "react-i18next";
import type { UpdateState } from "../hooks/useUpdater";

type UpdateToastProps = {
  state: UpdateState;
  onUpdate: () => void;
  onDismiss: () => void;
};

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

export function UpdateToast({ state, onUpdate, onDismiss }: UpdateToastProps) {
  const { t } = useTranslation();

  if (state.stage === "idle") {
    return null;
  }

  const totalBytes = state.progress?.totalBytes;
  const downloadedBytes = state.progress?.downloadedBytes ?? 0;
  const percent =
    totalBytes && totalBytes > 0
      ? Math.min(100, (downloadedBytes / totalBytes) * 100)
      : null;

  return (
    <div
      className="update-toasts absolute bottom-9 right-5 w-[min(360px,calc(100vw-40px))] grid gap-3 z-[5] pointer-events-none [-webkit-app-region:no-drag]"
      role="region"
      aria-live="polite"
    >
      <div
        className="update-toast bg-[color:var(--surface-context-core)] rounded-xl border border-[color:var(--border-subtle)] p-3 shadow-[0_16px_32px_rgba(0,0,0,0.25)] pointer-events-auto animate-[update-toast-in_0.2s_ease-out] max-w-full"
        role="status"
      >
        <div className="update-toast-header flex justify-between gap-2 mb-1.5">
          <div className="update-toast-title text-xs tracking-[0.08em] uppercase text-[color:var(--text-subtle)]">{t("update.title")}</div>
          {state.version ? (
            <div className="update-toast-version text-xs text-[color:var(--text-faint)]">v{state.version}</div>
          ) : null}
        </div>
        {state.stage === "checking" && (
          <div className="update-toast-body text-[13px] text-[color:var(--text)] mb-2.5">{t("update.checkingForUpdates")}</div>
        )}
        {state.stage === "available" && (
          <>
            <div className="update-toast-body text-[13px] text-[color:var(--text)] mb-2.5">
              {t("update.updateAvailable")}
            </div>
            <div className="update-toast-actions flex gap-2 justify-end">
              <button className="secondary" onClick={onDismiss}>
                {t("common.later")}
              </button>
              <button className="primary" onClick={onUpdate}>
                {t("update.title")}
              </button>
            </div>
          </>
        )}
        {state.stage === "latest" && (
          <div className="update-toast-inline flex items-center justify-between gap-3">
            <div className="update-toast-body update-toast-body-inline text-[13px] text-[color:var(--text)] mb-0">
              {t("update.upToDate")}
            </div>
            <button className="secondary" onClick={onDismiss}>
              {t("common.dismiss")}
            </button>
          </div>
        )}
        {state.stage === "downloading" && (
          <>
            <div className="update-toast-body text-[13px] text-[color:var(--text)] mb-2.5">
              {t("update.downloading")}
            </div>
            <div className="update-toast-progress grid gap-1.5 mb-1">
              <div className="update-toast-progress-bar h-1.5 rounded-full bg-[color:var(--surface-card-muted)] overflow-hidden">
                <span
                  className="update-toast-progress-fill block h-full bg-[linear-gradient(90deg,#4fb8ff,#3be082)]"
                  style={{ width: percent ? `${percent}%` : "24%" }}
                />
              </div>
              <div className="update-toast-progress-meta text-[11px] text-[color:var(--text-muted)]">
                {totalBytes
                  ? `${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)}`
                  : `${formatBytes(downloadedBytes)} ${t("update.downloaded")}`}
              </div>
            </div>
          </>
        )}
        {state.stage === "installing" && (
          <div className="update-toast-body text-[13px] text-[color:var(--text)] mb-2.5">{t("update.installing")}</div>
        )}
        {state.stage === "restarting" && (
          <div className="update-toast-body text-[13px] text-[color:var(--text)] mb-2.5">{t("update.restarting")}</div>
        )}
        {state.stage === "error" && (
          <>
            <div className="update-toast-body text-[13px] text-[color:var(--text)] mb-2.5">{t("update.failed")}</div>
            {state.error ? (
              <div className="update-toast-error font-mono text-[11px] text-[color:var(--text-muted)] whitespace-pre-wrap max-h-[120px] overflow-auto rounded-lg bg-[color:var(--surface-card-muted)] p-2 mb-2.5 [overflow-wrap:break-word] break-words">{state.error}</div>
            ) : null}
            <div className="update-toast-actions flex gap-2 justify-end">
              <button className="secondary" onClick={onDismiss}>
                {t("common.dismiss")}
              </button>
              <button className="primary" onClick={onUpdate}>
                {t("common.retry")}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
