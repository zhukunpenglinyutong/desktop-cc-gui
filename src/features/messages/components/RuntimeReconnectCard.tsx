import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Terminal from "lucide-react/dist/esm/icons/terminal";
import { Button } from "../../../components/ui/button";
import { ensureRuntimeReady } from "../../../services/tauri";
import type { QueuedMessage } from "../../../types";
import {
  normalizeRuntimeReconnectRecoveryResult,
  normalizeRuntimeReconnectErrorMessage,
  type RuntimeReconnectRecoveryCallbackResult,
  type RuntimeReconnectHint,
} from "./runtimeReconnect";

type RuntimeReconnectCardProps = {
  hint: RuntimeReconnectHint;
  workspaceId?: string | null;
  threadId?: string | null;
  onRecoverThreadRuntime?: (
    workspaceId: string,
    threadId: string,
  ) => Promise<RuntimeReconnectRecoveryCallbackResult> | RuntimeReconnectRecoveryCallbackResult;
  retryMessage?: Pick<QueuedMessage, "text" | "images"> | null;
  onRecoverThreadRuntimeAndResend?: (
    workspaceId: string,
    threadId: string,
    message: Pick<QueuedMessage, "text" | "images">,
  ) => Promise<RuntimeReconnectRecoveryCallbackResult> | RuntimeReconnectRecoveryCallbackResult;
};

export function RuntimeReconnectCard({
  hint,
  workspaceId = null,
  threadId = null,
  onRecoverThreadRuntime,
  retryMessage = null,
  onRecoverThreadRuntimeAndResend,
}: RuntimeReconnectCardProps) {
  const { t } = useTranslation();
  const [isReconnectRunning, setIsReconnectRunning] = useState(false);
  const [reconnectStatus, setReconnectStatus] = useState<
    "idle" | "error" | "restored" | "fresh"
  >("idle");
  const [lastAction, setLastAction] = useState<"reconnect" | "resend">("reconnect");
  const [reconnectErrorDetail, setReconnectErrorDetail] = useState<string | null>(null);
  const requiresThreadRecovery =
    hint.reason === "thread-not-found" || hint.reason === "session-not-found";
  const retryMessageUnavailable =
    !retryMessage ||
    (!retryMessage.text.trim() && (retryMessage.images?.length ?? 0) === 0);
  const reconnectUnavailable = requiresThreadRecovery
    ? !workspaceId || !threadId || !onRecoverThreadRuntime
    : !workspaceId;
  const resendUnavailable = requiresThreadRecovery
    ? !workspaceId || !threadId || !onRecoverThreadRuntimeAndResend || retryMessageUnavailable
    : reconnectUnavailable ||
      retryMessageUnavailable ||
      !threadId ||
      !onRecoverThreadRuntimeAndResend;

  useEffect(() => {
    setIsReconnectRunning(false);
    setReconnectStatus("idle");
    setLastAction("reconnect");
    setReconnectErrorDetail(null);
  }, [hint.rawMessage, retryMessage, threadId, workspaceId]);

  const handleReconnectRuntime = useCallback(async (mode: "reconnect" | "resend") => {
    if (!workspaceId || isReconnectRunning) {
      return;
    }
    if (mode === "resend" && (resendUnavailable || !retryMessage || !threadId)) {
      return;
    }
    setIsReconnectRunning(true);
    setReconnectStatus("idle");
    setLastAction(mode);
    setReconnectErrorDetail(null);
    try {
      if (requiresThreadRecovery) {
        if (!threadId) {
          setReconnectStatus("error");
          setReconnectErrorDetail(
            t("messages.threadRecoveryUnavailable"),
          );
          return;
        }
        await ensureRuntimeReady(workspaceId);
        if (mode === "resend") {
          if (!onRecoverThreadRuntimeAndResend || !retryMessage) {
            setReconnectStatus("error");
            setReconnectErrorDetail(t("messages.threadRecoveryResendUnavailable"));
            return;
          }
          const resentThreadId = await onRecoverThreadRuntimeAndResend(
            workspaceId,
            threadId,
            retryMessage,
          );
          const resentResult = normalizeRuntimeReconnectRecoveryResult(resentThreadId);
          if (resentResult.kind === "failed") {
            setReconnectStatus("error");
            setReconnectErrorDetail(t("messages.threadRecoveryRecoverFailed"));
            return;
          }
          if (resentResult.kind === "fresh") {
            setReconnectStatus("fresh");
            setReconnectErrorDetail(t("messages.threadRecoveryFreshResent"));
            return;
          }
          setReconnectStatus("restored");
          setReconnectErrorDetail(t("messages.threadRecoveryRestoredAndResent"));
          return;
        }
        if (!onRecoverThreadRuntime) {
          setReconnectStatus("error");
          setReconnectErrorDetail(
            t("messages.threadRecoveryUnavailable"),
          );
          return;
        }
        const recoveredThreadId = await onRecoverThreadRuntime(workspaceId, threadId);
        const recoveredResult = normalizeRuntimeReconnectRecoveryResult(recoveredThreadId);
        if (recoveredResult.kind === "failed") {
          setReconnectStatus("error");
          setReconnectErrorDetail(t("messages.threadRecoveryRecoverFailed"));
          return;
        }
        if (recoveredResult.kind === "fresh") {
          setReconnectStatus("fresh");
          setReconnectErrorDetail(t("messages.threadRecoveryFreshFallbackRequired"));
          return;
        }
        setReconnectStatus("restored");
        setReconnectErrorDetail(t("messages.threadRecoveryRestoredDetail"));
        return;
      }
      await ensureRuntimeReady(workspaceId);
      if (mode === "resend") {
        if (!threadId || !retryMessage || !onRecoverThreadRuntimeAndResend) {
          setReconnectStatus("error");
          setReconnectErrorDetail(t("messages.runtimeReconnectResendUnavailable"));
          return;
        }
        const resentThreadId = await onRecoverThreadRuntimeAndResend(
          workspaceId,
          threadId,
          retryMessage,
        );
        const resentResult = normalizeRuntimeReconnectRecoveryResult(resentThreadId);
        if (resentResult.kind === "failed") {
          setReconnectStatus("error");
          setReconnectErrorDetail(t("messages.runtimeReconnectRecoverFailed"));
          return;
        }
        if (resentResult.kind === "fresh") {
          setReconnectStatus("fresh");
          setReconnectErrorDetail(t("messages.runtimeReconnectFreshResent"));
          return;
        }
        setReconnectStatus("restored");
        setReconnectErrorDetail(t("messages.runtimeReconnectRestoredAndResent"));
        return;
      }
      if (threadId && onRecoverThreadRuntime) {
        const recoveredThreadId = await onRecoverThreadRuntime(workspaceId, threadId);
        const recoveredResult = normalizeRuntimeReconnectRecoveryResult(recoveredThreadId);
        if (recoveredResult.kind === "failed") {
          setReconnectStatus("error");
          setReconnectErrorDetail(t("messages.runtimeReconnectRecoverFailed"));
          return;
        }
        if (recoveredResult.kind === "fresh") {
          setReconnectStatus("fresh");
          setReconnectErrorDetail(t("messages.runtimeReconnectFreshContinuation"));
          return;
        }
      }
      setReconnectStatus("restored");
      setReconnectErrorDetail(t("messages.runtimeReconnectRestoredDetail"));
    } catch (error) {
      setReconnectStatus("error");
      setReconnectErrorDetail(normalizeRuntimeReconnectErrorMessage(error));
    } finally {
      setIsReconnectRunning(false);
    }
  }, [
    isReconnectRunning,
    onRecoverThreadRuntime,
    onRecoverThreadRuntimeAndResend,
    requiresThreadRecovery,
    resendUnavailable,
    retryMessage,
    t,
    threadId,
    workspaceId,
  ]);

  const description = requiresThreadRecovery
    ? t("messages.threadRecoveryThreadNotFound")
    : hint.reason === "recovery-quarantined"
      ? t("messages.runtimeReconnectQuarantined")
    : hint.reason === "runtime-ended"
      ? t("messages.runtimeReconnectEnded")
    : hint.reason === "broken-pipe"
      ? t("messages.runtimeReconnectBrokenPipe")
      : t("messages.runtimeReconnectWorkspaceNotConnected");
  const title = requiresThreadRecovery
    ? t("messages.threadRecoveryTitle")
    : t("messages.runtimeReconnectTitle");
  const reconnectActionLabel = isReconnectRunning && lastAction === "reconnect"
    ? requiresThreadRecovery
      ? t("messages.threadRecoveryRunning")
      : t("messages.runtimeReconnectRunning")
    : requiresThreadRecovery
      ? t("messages.threadRecoveryAction")
      : t("messages.runtimeReconnectAction");
  const resendActionLabel = isReconnectRunning && lastAction === "resend"
    ? requiresThreadRecovery
      ? t("messages.threadRecoveryResendRunning")
      : t("messages.runtimeReconnectResendRunning")
    : requiresThreadRecovery
      ? t("messages.threadRecoveryResendAction")
      : t("messages.runtimeReconnectResendAction");
  const showReconnectAction =
    !requiresThreadRecovery || (Boolean(onRecoverThreadRuntime) && resendUnavailable);
  const showReconnectUnavailable = showReconnectAction && reconnectUnavailable;
  const unavailableLabel = requiresThreadRecovery
    ? t("messages.threadRecoveryUnavailable")
    : t("messages.runtimeReconnectUnavailable");
  const failedLabel = requiresThreadRecovery
    ? t("messages.threadRecoveryFailed")
    : t("messages.runtimeReconnectFailed");

  return (
    <div
      className="message-runtime-recovery-card grid gap-2.5 px-3.5 py-3 my-0.5 mb-2.5 rounded-2xl border border-[color-mix(in_srgb,var(--border-strong)_78%,#2563eb_22%)] [background:linear-gradient(180deg,color-mix(in_srgb,var(--surface-card)_90%,#2563eb_10%)_0%,color-mix(in_srgb,var(--surface-card)_96%,transparent)_100%)] [box-shadow:0_14px_32px_color-mix(in_srgb,#020617_14%,transparent),inset_0_1px_0_color-mix(in_srgb,#ffffff_6%,transparent)]"
      role="group"
      aria-label={title}
    >
      <div className="message-runtime-recovery-header grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2.5">
        <Terminal className="message-runtime-recovery-icon mt-0.5 text-[color-mix(in_srgb,#60a5fa_72%,var(--text-primary))]" size={15} aria-hidden />
        <div className="message-runtime-recovery-copy min-w-0 grid gap-[3px]">
          <div className="message-runtime-recovery-title text-[13px] leading-tight font-bold text-(--text-primary)">{title}</div>
          <div className="message-runtime-recovery-description text-xs leading-normal text-(--text-secondary)">{description}</div>
        </div>
        <div className="message-runtime-recovery-actions flex flex-wrap justify-end items-center gap-2">
          {showReconnectAction ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="message-runtime-recovery-button min-w-[118px] self-center"
              onClick={() => {
                void handleReconnectRuntime("reconnect");
              }}
              disabled={reconnectUnavailable || isReconnectRunning}
            >
              {reconnectActionLabel}
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            className="message-runtime-recovery-button min-w-[118px] self-center"
            onClick={() => {
              void handleReconnectRuntime("resend");
            }}
            disabled={resendUnavailable || isReconnectRunning}
          >
            {resendActionLabel}
          </Button>
        </div>
      </div>
      <div className="message-runtime-recovery-detail text-xs leading-normal text-(--text-muted) whitespace-pre-wrap break-words">{hint.rawMessage}</div>
      {showReconnectUnavailable ? (
        <div className="message-runtime-recovery-status is-error text-xs leading-tight font-semibold" aria-live="polite">
          {unavailableLabel}
        </div>
      ) : null}
      {!reconnectUnavailable && resendUnavailable ? (
        <div className="message-runtime-recovery-detail text-xs leading-normal text-(--text-muted) whitespace-pre-wrap break-words" aria-live="polite">
          {requiresThreadRecovery
            ? t("messages.threadRecoveryResendUnavailable")
            : t("messages.runtimeReconnectResendUnavailable")}
        </div>
      ) : null}
      {reconnectStatus === "error" ? (
        <>
          <div className="message-runtime-recovery-status is-error text-xs leading-tight font-semibold" aria-live="polite">{failedLabel}</div>
          {reconnectErrorDetail ? (
            <div className="message-runtime-recovery-detail text-xs leading-normal text-(--text-muted) whitespace-pre-wrap break-words">{reconnectErrorDetail}</div>
          ) : null}
        </>
      ) : null}
      {reconnectStatus === "restored" && reconnectErrorDetail ? (
        <>
          <div className="message-runtime-recovery-status is-success text-xs leading-tight font-semibold" aria-live="polite">
            {requiresThreadRecovery
              ? t("messages.threadRecoveryRestored")
              : t("messages.runtimeReconnectRestored")}
          </div>
          <div className="message-runtime-recovery-detail text-xs leading-normal text-(--text-muted) whitespace-pre-wrap break-words">{reconnectErrorDetail}</div>
        </>
      ) : null}
      {reconnectStatus === "fresh" && reconnectErrorDetail ? (
        <div className="message-runtime-recovery-detail text-xs leading-normal text-(--text-muted) whitespace-pre-wrap break-words" aria-live="polite">
          {reconnectErrorDetail}
        </div>
      ) : null}
    </div>
  );
}
