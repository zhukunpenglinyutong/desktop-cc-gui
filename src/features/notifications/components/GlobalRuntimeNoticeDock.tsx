import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { GlobalRuntimeNotice } from "../../../services/globalRuntimeNotices";
import type {
  GlobalRuntimeNoticeDockStatus,
  GlobalRuntimeNoticeDockVisibility,
} from "../hooks/useGlobalRuntimeNoticeDock";

type GlobalRuntimeNoticeDockProps = {
  notices: readonly GlobalRuntimeNotice[];
  visibility: GlobalRuntimeNoticeDockVisibility;
  status: GlobalRuntimeNoticeDockStatus;
  onExpand: () => void;
  onMinimize: () => void;
  onClear: () => void;
};

type MinimizedIndicatorState = "idle" | "has-notice" | "has-error";

function formatNoticeTimestamp(timestampMs: number) {
  const date = new Date(timestampMs);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function resolveStatusLabel(
  t: (key: string) => string,
  status: GlobalRuntimeNoticeDockStatus,
) {
  switch (status) {
    case "has-error":
      return t("runtimeNotice.statusError");
    case "streaming":
      return t("runtimeNotice.statusStreaming");
    case "idle":
    default:
      return t("runtimeNotice.statusIdle");
  }
}

function resolveSeverityLabel(
  t: (key: string) => string,
  severity: GlobalRuntimeNotice["severity"],
) {
  switch (severity) {
    case "warning":
      return t("runtimeNotice.severityWarning");
    case "error":
      return t("runtimeNotice.severityError");
    case "info":
    default:
      return t("runtimeNotice.severityInfo");
  }
}

function resolveMinimizedIndicatorState(
  status: GlobalRuntimeNoticeDockStatus,
): MinimizedIndicatorState {
  if (status === "has-error") {
    return "has-error";
  }
  if (status === "streaming") {
    return "has-notice";
  }
  return "idle";
}

export function GlobalRuntimeNoticeDock({
  notices,
  visibility,
  status,
  onExpand,
  onMinimize,
  onClear,
}: GlobalRuntimeNoticeDockProps) {
  const { t } = useTranslation();
  const statusLabel = resolveStatusLabel(t, status);
  const isMinimized = visibility === "minimized";
  const hasNoticeItems = notices.length > 0;
  const minimizedIndicatorState = resolveMinimizedIndicatorState(status);

  const renderedRows = useMemo(
    () =>
      notices.map((notice) => {
        const translatedMessage = t(notice.messageKey, notice.messageParams);
        const severityLabel = resolveSeverityLabel(t, notice.severity);
        const timestampLabel = formatNoticeTimestamp(notice.timestampMs);
        const messageLabel =
          notice.repeatCount > 1 ? `${translatedMessage} ×${notice.repeatCount}` : translatedMessage;
        return {
          id: notice.id,
          severity: notice.severity,
          messageLabel,
          timestampLabel,
          ariaLabel: `${severityLabel} ${messageLabel} ${timestampLabel}`,
        };
      }),
    [notices, t],
  );

  const bubbleStateClasses: Record<MinimizedIndicatorState, string> = {
    idle:
      "is-idle border-[rgba(74,222,128,0.4)] shadow-[0_8px_18px_rgba(15,23,42,0.18),0_0_0_1px_rgba(74,222,128,0.14),0_0_8px_rgba(74,222,128,0.14)] [:root[data-theme=light]_&]:shadow-[0_6px_14px_rgba(74,222,128,0.1),0_0_0_1px_rgba(74,222,128,0.14)] [@media(prefers-color-scheme:light){:root[data-theme=system]_&,:root:not([data-theme])_&}]:shadow-[0_6px_14px_rgba(74,222,128,0.1),0_0_0_1px_rgba(74,222,128,0.14)]",
    "has-notice":
      "is-has-notice border-[rgba(56,189,248,0.42)] shadow-[0_8px_18px_rgba(15,23,42,0.22),0_0_0_1px_rgba(56,189,248,0.18),0_0_10px_rgba(56,189,248,0.16)] [:root[data-theme=light]_&]:shadow-[0_6px_14px_rgba(56,189,248,0.12),0_0_0_1px_rgba(56,189,248,0.16)] [@media(prefers-color-scheme:light){:root[data-theme=system]_&,:root:not([data-theme])_&}]:shadow-[0_6px_14px_rgba(56,189,248,0.12),0_0_0_1px_rgba(56,189,248,0.16)]",
    "has-error":
      "is-has-error border-[rgba(248,113,113,0.45)] shadow-[0_8px_18px_rgba(15,23,42,0.22),0_0_0_1px_rgba(248,113,113,0.2),0_0_10px_rgba(248,113,113,0.18)] [:root[data-theme=light]_&]:shadow-[0_6px_14px_rgba(248,113,113,0.12),0_0_0_1px_rgba(248,113,113,0.16)] [@media(prefers-color-scheme:light){:root[data-theme=system]_&,:root:not([data-theme])_&}]:shadow-[0_6px_14px_rgba(248,113,113,0.12),0_0_0_1px_rgba(248,113,113,0.16)]",
  };

  const statusStateClasses: Record<GlobalRuntimeNoticeDockStatus, string> = {
    idle: "",
    streaming:
      "is-streaming bg-[rgba(56,189,248,0.14)] text-[#7dd3fc] [:root[data-theme=light]_&]:bg-[rgba(56,189,248,0.14)] [:root[data-theme=light]_&]:text-[#0f5ec7] [@media(prefers-color-scheme:light){:root[data-theme=system]_&,:root:not([data-theme])_&}]:bg-[rgba(56,189,248,0.14)] [@media(prefers-color-scheme:light){:root[data-theme=system]_&,:root:not([data-theme])_&}]:text-[#0f5ec7]",
    "has-error":
      "is-has-error bg-[rgba(248,113,113,0.16)] text-[#fda4af] [:root[data-theme=light]_&]:bg-[rgba(248,113,113,0.14)] [:root[data-theme=light]_&]:text-[#b91c1c] [@media(prefers-color-scheme:light){:root[data-theme=system]_&,:root:not([data-theme])_&}]:bg-[rgba(248,113,113,0.14)] [@media(prefers-color-scheme:light){:root[data-theme=system]_&,:root:not([data-theme])_&}]:text-[#b91c1c]",
  };

  const severityDotClasses: Record<GlobalRuntimeNotice["severity"], string> = {
    info: "bg-[#38bdf8]",
    warning: "is-warning bg-[#f59e0b]",
    error: "is-error bg-[#f87171]",
  };

  return (
    <div className="global-runtime-notice-dock-shell fixed right-1 bottom-[max(4px,calc(env(safe-area-inset-bottom,0px)+4px))] z-[42] max-[960px]:right-3 max-[960px]:bottom-[max(78px,calc(env(safe-area-inset-bottom,0px)+78px))]">
      {isMinimized ? (
        <button
          type="button"
          className={`global-runtime-notice-dock-bubble inline-flex items-center justify-center w-5 h-5 p-0 border border-[rgba(148,163,184,0.28)] rounded-full bg-[linear-gradient(135deg,rgba(15,23,42,0.92),rgba(30,41,59,0.86))] shadow-[0_8px_18px_rgba(15,23,42,0.22),inset_0_1px_0_rgba(255,255,255,0.08)] text-[#e2e8f0] cursor-pointer backdrop-blur-[16px] [:root[data-theme=light]_&]:border-[rgba(148,163,184,0.4)] [:root[data-theme=light]_&]:bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(241,245,249,0.94))] [:root[data-theme=light]_&]:shadow-[0_6px_14px_rgba(15,23,42,0.12),inset_0_1px_0_rgba(255,255,255,0.88)] [:root[data-theme=light]_&]:text-[#334155] [@media(prefers-color-scheme:light){:root[data-theme=system]_&,:root:not([data-theme])_&}]:border-[rgba(148,163,184,0.4)] [@media(prefers-color-scheme:light){:root[data-theme=system]_&,:root:not([data-theme])_&}]:bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(241,245,249,0.94))] [@media(prefers-color-scheme:light){:root[data-theme=system]_&,:root:not([data-theme])_&}]:shadow-[0_6px_14px_rgba(15,23,42,0.12),inset_0_1px_0_rgba(255,255,255,0.88)] [@media(prefers-color-scheme:light){:root[data-theme=system]_&,:root:not([data-theme])_&}]:text-[#334155] ${bubbleStateClasses[minimizedIndicatorState]}`}
          onClick={onExpand}
          aria-label={t("runtimeNotice.open")}
          title={t("runtimeNotice.open")}
        >
          {minimizedIndicatorState === "idle" ? (
            <span
              className="global-runtime-notice-dock-indicator-dot w-[7px] h-[7px] rounded-full bg-[#4ade80] shadow-[0_0_0_2px_rgba(74,222,128,0.16)]"
              aria-hidden="true"
            />
          ) : (
            <span
              className={`global-runtime-notice-dock-indicator-mark text-[#f8fafc] text-[11px] font-extrabold leading-none translate-y-[-0.5px] [:root[data-theme=light]_&]:text-[#334155] [@media(prefers-color-scheme:light){:root[data-theme=system]_&,:root:not([data-theme])_&}]:text-[#334155] ${
                minimizedIndicatorState === "has-error"
                  ? "text-[#fecaca] [:root[data-theme=light]_&]:text-[#dc2626] [@media(prefers-color-scheme:light){:root[data-theme=system]_&,:root:not([data-theme])_&}]:text-[#dc2626]"
                  : ""
              }`}
              aria-hidden="true"
            >
              !
            </span>
          )}
        </button>
      ) : (
        <section
          className="global-runtime-notice-dock w-[min(720px,calc(100vw-24px))] max-h-[min(360px,calc(100vh-120px))] flex flex-col border border-[rgba(148,163,184,0.24)] rounded-[18px] bg-[linear-gradient(180deg,rgba(15,23,42,0.96),rgba(15,23,42,0.9))] shadow-[0_28px_56px_rgba(15,23,42,0.34),inset_0_1px_0_rgba(255,255,255,0.08)] text-[#e2e8f0] overflow-hidden backdrop-blur-[18px] max-[960px]:w-[min(680px,calc(100vw-16px))] max-[960px]:max-h-[min(320px,calc(100vh-150px))] [:root[data-theme=light]_&]:border-[rgba(15,23,36,0.08)] [:root[data-theme=light]_&]:bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.96))] [:root[data-theme=light]_&]:shadow-[0_18px_36px_rgba(15,23,42,0.12),inset_0_1px_0_rgba(255,255,255,0.92)] [:root[data-theme=light]_&]:text-[#1f2937] [@media(prefers-color-scheme:light){:root[data-theme=system]_&,:root:not([data-theme])_&}]:border-[rgba(15,23,36,0.08)] [@media(prefers-color-scheme:light){:root[data-theme=system]_&,:root:not([data-theme])_&}]:bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(248,250,252,0.96))] [@media(prefers-color-scheme:light){:root[data-theme=system]_&,:root:not([data-theme])_&}]:shadow-[0_18px_36px_rgba(15,23,42,0.12),inset_0_1px_0_rgba(255,255,255,0.92)] [@media(prefers-color-scheme:light){:root[data-theme=system]_&,:root:not([data-theme])_&}]:text-[#1f2937]"
          role="region"
          aria-label={t("runtimeNotice.title")}
        >
          <header className="global-runtime-notice-dock-header flex items-center justify-between gap-3 py-[14px] px-4 border-b border-[rgba(148,163,184,0.12)] [:root[data-theme=light]_&]:border-b-[rgba(15,23,36,0.08)] [@media(prefers-color-scheme:light){:root[data-theme=system]_&,:root:not([data-theme])_&}]:border-b-[rgba(15,23,36,0.08)]">
            <div className="global-runtime-notice-dock-title-wrap flex items-center gap-2.5 min-w-0">
              <span className="global-runtime-notice-dock-title text-sm font-bold tracking-[0.01em] [:root[data-theme=light]_&]:text-[#0f172a] [@media(prefers-color-scheme:light){:root[data-theme=system]_&,:root:not([data-theme])_&}]:text-[#0f172a]">
                {t("runtimeNotice.title")}
              </span>
              <span
                className={`global-runtime-notice-dock-status inline-flex items-center min-h-[22px] px-2 rounded-full text-[11px] font-bold tracking-[0.02em] bg-[rgba(148,163,184,0.16)] text-[#cbd5e1] [:root[data-theme=light]_&]:bg-[rgba(15,23,36,0.08)] [:root[data-theme=light]_&]:text-[#475569] [@media(prefers-color-scheme:light){:root[data-theme=system]_&,:root:not([data-theme])_&}]:bg-[rgba(15,23,36,0.08)] [@media(prefers-color-scheme:light){:root[data-theme=system]_&,:root:not([data-theme])_&}]:text-[#475569] is-${status} ${statusStateClasses[status]}`}
              >
                {statusLabel}
              </span>
            </div>
            <div className="global-runtime-notice-dock-actions inline-flex items-center gap-2">
              <button
                type="button"
                className="global-runtime-notice-dock-action p-0 border-0 bg-transparent text-[#cbd5e1] text-xs font-semibold cursor-pointer hover:text-[#f8fafc] [:root[data-theme=light]_&]:text-[#475569] [:root[data-theme=light]_&]:hover:text-[#0f172a] [@media(prefers-color-scheme:light){:root[data-theme=system]_&,:root:not([data-theme])_&}]:text-[#475569] [@media(prefers-color-scheme:light){:root[data-theme=system]_&,:root:not([data-theme])_&}]:hover:text-[#0f172a]"
                onClick={onClear}
              >
                {t("runtimeNotice.clear")}
              </button>
              <button
                type="button"
                className="global-runtime-notice-dock-action p-0 border-0 bg-transparent text-[#cbd5e1] text-xs font-semibold cursor-pointer hover:text-[#f8fafc] [:root[data-theme=light]_&]:text-[#475569] [:root[data-theme=light]_&]:hover:text-[#0f172a] [@media(prefers-color-scheme:light){:root[data-theme=system]_&,:root:not([data-theme])_&}]:text-[#475569] [@media(prefers-color-scheme:light){:root[data-theme=system]_&,:root:not([data-theme])_&}]:hover:text-[#0f172a]"
                onClick={onMinimize}
              >
                {t("runtimeNotice.minimize")}
              </button>
            </div>
          </header>
          {hasNoticeItems ? (
            <ol className="global-runtime-notice-dock-list m-0 pt-2.5 px-3 pb-3 list-none overflow-auto">
              {renderedRows.map((row) => (
                <li
                  key={row.id}
                  className={`global-runtime-notice-dock-row grid grid-cols-[8px_minmax(0,1fr)_auto] gap-2.5 items-center min-h-[34px] py-1.5 px-1 rounded-[10px] [&+&]:mt-0.5 hover:bg-[rgba(148,163,184,0.06)] [:root[data-theme=light]_&]:hover:bg-[rgba(15,23,36,0.04)] [@media(prefers-color-scheme:light){:root[data-theme=system]_&,:root:not([data-theme])_&}]:hover:bg-[rgba(15,23,36,0.04)] is-${row.severity}`}
                  aria-label={row.ariaLabel}
                >
                  <span
                    className={`global-runtime-notice-dock-severity w-2 h-2 rounded-full ${severityDotClasses[row.severity]}`}
                    aria-hidden="true"
                  />
                  <span
                    className="global-runtime-notice-dock-message min-w-0 overflow-hidden whitespace-nowrap text-ellipsis text-[#e2e8f0] text-[13px] leading-[1.4] [:root[data-theme=light]_&]:text-[#1f2937] [@media(prefers-color-scheme:light){:root[data-theme=system]_&,:root:not([data-theme])_&}]:text-[#1f2937]"
                    title={row.messageLabel}
                  >
                    {row.messageLabel}
                  </span>
                  <time className="global-runtime-notice-dock-time text-[#94a3b8] text-[11px] [font-variant-numeric:tabular-nums] tracking-[0.02em] [:root[data-theme=light]_&]:text-[#64748b] [@media(prefers-color-scheme:light){:root[data-theme=system]_&,:root:not([data-theme])_&}]:text-[#64748b]">
                    {row.timestampLabel}
                  </time>
                </li>
              ))}
            </ol>
          ) : (
            <div className="global-runtime-notice-dock-empty py-5 px-4 pb-[22px]">
              <div className="global-runtime-notice-dock-empty-title text-[#f8fafc] text-[13px] font-bold [:root[data-theme=light]_&]:text-[#0f172a] [@media(prefers-color-scheme:light){:root[data-theme=system]_&,:root:not([data-theme])_&}]:text-[#0f172a]">
                {t("runtimeNotice.emptyTitle")}
              </div>
              <div className="global-runtime-notice-dock-empty-description mt-1.5 text-[#94a3b8] text-xs leading-[1.5] [:root[data-theme=light]_&]:text-[#64748b] [@media(prefers-color-scheme:light){:root[data-theme=system]_&,:root:not([data-theme])_&}]:text-[#64748b]">
                {t("runtimeNotice.emptyDescription")}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
