import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Terminal from "lucide-react/dist/esm/icons/terminal";
import { Button } from "../../../components/ui/button";
import { ensureRuntimeReady } from "../../../services/tauri";
import type { QueuedMessage } from "../../../types";
import {
  normalizeRuntimeReconnectErrorMessage,
  type RuntimeReconnectHint,
} from "./runtimeReconnect";

type RuntimeReconnectCardProps = {
  hint: RuntimeReconnectHint;
  workspaceId?: string | null;
  threadId?: string | null;
  onRecoverThreadRuntime?: (
    workspaceId: string,
    threadId: string,
  ) => Promise<string | null | void> | string | null | void;
  retryMessage?: Pick<QueuedMessage, "text" | "images"> | null;
  onRecoverThreadRuntimeAndResend?: (
    workspaceId: string,
    threadId: string,
    message: Pick<QueuedMessage, "text" | "images">,
  ) => Promise<string | null | void> | string | null | void;
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
  const [reconnectStatus, setReconnectStatus] = useState<"idle" | "error">("idle");
  const [lastAction, setLastAction] = useState<"reconnect" | "resend">("reconnect");
  const [reconnectErrorDetail, setReconnectErrorDetail] = useState<string | null>(null);
  const requiresThreadRecovery = hint.reason === "thread-not-found";
  const retryMessageUnavailable =
    !retryMessage ||
    (!retryMessage.text.trim() && (retryMessage.images?.length ?? 0) === 0);
  const reconnectUnavailable = requiresThreadRecovery
    ? !workspaceId || !threadId || !onRecoverThreadRuntimeAndResend
    : !workspaceId;
  const resendUnavailable = requiresThreadRecovery
    ? reconnectUnavailable || retryMessageUnavailable
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
          if (resentThreadId === null) {
            setReconnectStatus("error");
            setReconnectErrorDetail(t("messages.threadRecoveryRecoverFailed"));
            return;
          }
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
        if (recoveredThreadId === null) {
          setReconnectStatus("error");
          setReconnectErrorDetail(t("messages.threadRecoveryRecoverFailed"));
          return;
        }
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
        if (resentThreadId === null) {
          setReconnectStatus("error");
          setReconnectErrorDetail(t("messages.runtimeReconnectRecoverFailed"));
          return;
        }
        return;
      }
      if (threadId && onRecoverThreadRuntime) {
        const recoveredThreadId = await onRecoverThreadRuntime(workspaceId, threadId);
        if (recoveredThreadId === null) {
          setReconnectStatus("error");
          setReconnectErrorDetail(t("messages.runtimeReconnectRecoverFailed"));
          return;
        }
      }
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
  const unavailableLabel = requiresThreadRecovery
    ? t("messages.threadRecoveryUnavailable")
    : t("messages.runtimeReconnectUnavailable");
  const failedLabel = requiresThreadRecovery
    ? t("messages.threadRecoveryFailed")
    : t("messages.runtimeReconnectFailed");

  return (
    <div className="message-runtime-recovery-card" role="group" aria-label={title}>
      <div className="message-runtime-recovery-header">
        <Terminal className="message-runtime-recovery-icon" size={15} aria-hidden />
        <div className="message-runtime-recovery-copy">
          <div className="message-runtime-recovery-title">{title}</div>
          <div className="message-runtime-recovery-description">{description}</div>
        </div>
        <div className="message-runtime-recovery-actions">
          {!requiresThreadRecovery ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="message-runtime-recovery-button"
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
            className="message-runtime-recovery-button"
            onClick={() => {
              void handleReconnectRuntime("resend");
            }}
            disabled={resendUnavailable || isReconnectRunning}
          >
            {resendActionLabel}
          </Button>
        </div>
      </div>
      <div className="message-runtime-recovery-detail">{hint.rawMessage}</div>
      {reconnectUnavailable ? (
        <div className="message-runtime-recovery-status is-error" aria-live="polite">
          {unavailableLabel}
        </div>
      ) : null}
      {!reconnectUnavailable && resendUnavailable ? (
        <div className="message-runtime-recovery-detail" aria-live="polite">
          {requiresThreadRecovery
            ? t("messages.threadRecoveryResendUnavailable")
            : t("messages.runtimeReconnectResendUnavailable")}
        </div>
      ) : null}
      {reconnectStatus === "error" ? (
        <>
          <div className="message-runtime-recovery-status is-error" aria-live="polite">{failedLabel}</div>
          {reconnectErrorDetail ? (
            <div className="message-runtime-recovery-detail">{reconnectErrorDetail}</div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
