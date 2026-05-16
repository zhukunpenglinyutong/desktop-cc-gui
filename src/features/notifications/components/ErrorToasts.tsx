import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ErrorToast } from "../../../services/toasts";

type ErrorToastsProps = {
  toasts: ErrorToast[];
  onDismiss: (id: string) => void;
};

export function ErrorToasts({ toasts, onDismiss }: ErrorToastsProps) {
  const { t } = useTranslation();
  const runningActionKeysRef = useRef(new Set<string>());
  const [runningActionKeys, setRunningActionKeys] = useState<Record<string, true>>(
    {},
  );
  const [actionErrorByToastInstanceKey, setActionErrorByToastInstanceKey] = useState<
    Record<string, string>
  >({});

  const getToastInstanceKey = useCallback(
    (toast: ErrorToast) => toast.instanceId ?? toast.id,
    [],
  );

  const normalizeActionError = useCallback((error: unknown) => {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === "string") {
      return error;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }, []);

  const handleActionClick = useCallback(
    async (toast: ErrorToast, actionIndex: number) => {
      const action = toast.actions?.[actionIndex];
      if (!action) {
        return;
      }
      const toastInstanceKey = getToastInstanceKey(toast);
      const actionKey = `${toastInstanceKey}:${actionIndex}`;
      if (runningActionKeysRef.current.has(actionKey)) {
        return;
      }
      runningActionKeysRef.current.add(actionKey);
      setRunningActionKeys((previous) => ({
        ...previous,
        [actionKey]: true,
      }));
      setActionErrorByToastInstanceKey((previous) => {
        const next = { ...previous };
        delete next[toastInstanceKey];
        return next;
      });
      try {
        await action.run();
        if (action.dismissOnSuccess ?? true) {
          onDismiss(toast.id);
        }
      } catch (error) {
        setActionErrorByToastInstanceKey((previous) => ({
          ...previous,
          [toastInstanceKey]: normalizeActionError(error),
        }));
      } finally {
        runningActionKeysRef.current.delete(actionKey);
        setRunningActionKeys((previous) => {
          const next = { ...previous };
          delete next[actionKey];
          return next;
        });
      }
    },
    [getToastInstanceKey, normalizeActionError, onDismiss],
  );

  useEffect(() => {
    const activeInstanceKeys = new Set(toasts.map((toast) => getToastInstanceKey(toast)));

    setActionErrorByToastInstanceKey((previous) => {
      let changed = false;
      const next: Record<string, string> = {};
      for (const [instanceKey, message] of Object.entries(previous)) {
        if (activeInstanceKeys.has(instanceKey)) {
          next[instanceKey] = message;
        } else {
          changed = true;
        }
      }
      return changed ? next : previous;
    });

    if (runningActionKeysRef.current.size === 0) {
      return;
    }

    const nextRunningKeys = new Set<string>();
    for (const actionKey of runningActionKeysRef.current) {
      const separatorIndex = actionKey.lastIndexOf(":");
      const instanceKey =
        separatorIndex >= 0 ? actionKey.slice(0, separatorIndex) : actionKey;
      if (activeInstanceKeys.has(instanceKey)) {
        nextRunningKeys.add(actionKey);
      }
    }

    if (nextRunningKeys.size === runningActionKeysRef.current.size) {
      return;
    }

    runningActionKeysRef.current = nextRunningKeys;
    setRunningActionKeys((previous) => {
      const next: Record<string, true> = {};
      for (const actionKey of Object.keys(previous)) {
        if (nextRunningKeys.has(actionKey)) {
          next[actionKey] = true;
        }
      }
      return next;
    });
  }, [getToastInstanceKey, toasts]);

  if (!toasts.length) {
    return null;
  }

  return (
    <div
      className="error-toasts fixed top-4 left-1/2 -translate-x-1/2 z-[60] flex flex-col gap-2 pointer-events-none"
      role="region"
      aria-live="assertive"
    >
      {toasts.map((toast) => {
        const variant = toast.variant ?? "error";
        const variantBgClass =
          variant === "info"
            ? "bg-[color-mix(in_srgb,var(--surface-popover)_93%,#38bdf8_7%)] border-[color-mix(in_srgb,#38bdf8_42%,transparent)]"
            : variant === "success"
              ? "bg-[color-mix(in_srgb,var(--surface-popover)_93%,#22c55e_7%)] border-[color-mix(in_srgb,#22c55e_42%,transparent)]"
              : "bg-[color-mix(in_srgb,var(--surface-popover)_92%,#ff4d4f_8%)] border-[color-mix(in_srgb,#ff4d4f_40%,transparent)]";
        const variantTitleClass =
          variant === "info"
            ? "text-[color:color-mix(in_srgb,#38bdf8_68%,var(--text-strong)_32%)]"
            : variant === "success"
              ? "text-[color:color-mix(in_srgb,#22c55e_68%,var(--text-strong)_32%)]"
              : "text-[color:var(--text-strong)]";
        return (
          <div
            key={getToastInstanceKey(toast)}
            className={`error-toast error-toast-${variant} min-w-[320px] max-w-[min(560px,calc(100vw-32px))] border rounded-[10px] py-2.5 px-3 shadow-[0_12px_28px_rgba(0,0,0,0.28)] pointer-events-auto animate-[error-toast-in_0.18s_ease-out] text-[color:var(--text-strong)] ${variantBgClass}`}
            role={toast.variant === "error" || !toast.variant ? "alert" : "status"}
          >
            <div className="error-toast-header flex items-center justify-between gap-3">
              <div className={`error-toast-title font-semibold text-[13px] ${variantTitleClass}`}>{toast.title}</div>
              <button
                type="button"
                className="ghost error-toast-dismiss text-lg leading-none px-1 text-[color:var(--text-muted)]"
                onClick={() => onDismiss(toast.id)}
                aria-label={t("errors.dismissError")}
                title={t("common.dismiss")}
              >
                ×
              </button>
            </div>
            <div className="error-toast-body mt-1 text-xs text-[color:var(--text-muted)] break-words">{toast.message}</div>
            {toast.actions?.length ? (
              <div className="error-toast-actions flex flex-wrap gap-2 mt-2.5">
                {toast.actions.map((action, index) => {
                  const actionKey = `${getToastInstanceKey(toast)}:${index}`;
                  const isRunning = Boolean(runningActionKeys[actionKey]);
                  const isPrimary = action.variant !== "secondary";
                  return (
                    <button
                      key={actionKey}
                      type="button"
                      className={`error-toast-action${
                        isPrimary ? " is-primary" : ""
                      } border rounded-lg py-1.5 px-2.5 text-xs font-semibold cursor-pointer transition-[background-color,border-color,opacity] duration-150 disabled:opacity-[0.68] disabled:cursor-wait ${
                        isPrimary
                          ? "border-[color-mix(in_srgb,#2563eb_55%,transparent)] bg-[color-mix(in_srgb,#2563eb_14%,var(--surface-popover)_86%)] text-[color:color-mix(in_srgb,#2563eb_78%,var(--text-strong)_22%)] enabled:hover:bg-[color-mix(in_srgb,#2563eb_20%,var(--surface-popover)_80%)]"
                          : "border-[color-mix(in_srgb,var(--border-strong)_55%,transparent)] bg-transparent text-[color:var(--text-strong)] enabled:hover:bg-[color-mix(in_srgb,var(--surface-popover)_78%,#ffffff_22%)]"
                      }`}
                      onClick={() => {
                        void handleActionClick(toast, index);
                      }}
                      disabled={isRunning}
                    >
                      {isRunning ? (action.pendingLabel ?? action.label) : action.label}
                    </button>
                  );
                })}
              </div>
            ) : null}
            {actionErrorByToastInstanceKey[getToastInstanceKey(toast)] ? (
              <div className="error-toast-action-error mt-2 text-xs text-[#fecaca] break-words" aria-live="polite">
                {actionErrorByToastInstanceKey[getToastInstanceKey(toast)]}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
