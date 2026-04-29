import { useCallback } from "react";
import type { Dispatch, MutableRefObject } from "react";
import type { DebugEntry } from "../../../types";
import { useTranslation } from "react-i18next";
import {
  engineInterrupt as engineInterruptService,
  engineInterruptTurn as engineInterruptTurnService,
  interruptTurn as interruptTurnService,
} from "../../../services/tauri";
import { pushThreadFailureRuntimeNotice } from "../../../services/globalRuntimeNotices";
import { getThreadTimestamp } from "../../../utils/threadItems";
import {
  asString,
  normalizePlanUpdate,
  normalizeRateLimits,
  normalizeTokenUsage,
} from "../utils/threadNormalize";
import { previewThreadName } from "../../../utils/threadItems";
import { resolveThreadStabilityDiagnostic } from "../utils/stabilityDiagnostics";
import { hasCodexBackgroundHelperPreview } from "../utils/codexBackgroundHelpers";
import type { ThreadAction } from "./useThreadsReducer";

/**
 * Infer engine type from thread ID.
 * Claude/Gemini/OpenCode threads use "<engine>:" or "<engine>-pending-" prefixes.
 */
function inferEngineFromThreadId(threadId: string): "claude" | "codex" | "gemini" | "opencode" {
  if (threadId.startsWith("claude:") || threadId.startsWith("claude-pending-")) {
    return "claude";
  }
  if (threadId.startsWith("gemini:") || threadId.startsWith("gemini-pending-")) {
    return "gemini";
  }
  if (threadId.startsWith("opencode:") || threadId.startsWith("opencode-pending-")) {
    return "opencode";
  }
  return "codex";
}

type ContextCompactionSourcePayload = {
  auto?: boolean | null;
  manual?: boolean | null;
};

function isCodexContextCompaction(threadId: string): boolean {
  if (inferEngineFromThreadId(threadId) !== "codex") {
    return false;
  }
  return true;
}

function buildCodexCompactionCompletionFallbackId(threadId: string, turnId: string) {
  return `context-compacted-codex-compact-${threadId}-completed-${turnId}`;
}

function isCodexBackgroundHelperThread(
  threadId: string,
  thread: Record<string, unknown>,
): boolean {
  if (inferEngineFromThreadId(threadId) !== "codex") {
    return false;
  }
  const previewCandidates = [
    asString(thread.preview).trim(),
    asString(thread.title).trim(),
  ].filter(Boolean);
  return hasCodexBackgroundHelperPreview(previewCandidates);
}

type UseThreadTurnEventsOptions = {
  activeThreadId?: string | null;
  dispatch: Dispatch<ThreadAction>;
  getCustomName: (workspaceId: string, threadId: string) => string | undefined;
  resolveCanonicalThreadId?: (threadId: string) => string;
  isAutoTitlePending: (workspaceId: string, threadId: string) => boolean;
  isThreadHidden: (workspaceId: string, threadId: string) => boolean;
  markProcessing: (threadId: string, isProcessing: boolean) => void;
  markReviewing: (threadId: string, isReviewing: boolean) => void;
  setActiveTurnId: (threadId: string, turnId: string | null) => void;
  codexCompactionInFlightByThreadRef: MutableRefObject<Record<string, boolean>>;
  pendingInterruptsRef: MutableRefObject<Set<string>>;
  interruptedThreadsRef: MutableRefObject<Set<string>>;
  pushThreadErrorMessage: (threadId: string, message: string) => void;
  safeMessageActivity: () => void;
  recordThreadActivity: (workspaceId: string, threadId: string, timestamp?: number) => void;
  renameCustomNameKey: (
    workspaceId: string,
    oldThreadId: string,
    newThreadId: string,
  ) => void;
  renameAutoTitlePendingKey: (
    workspaceId: string,
    oldThreadId: string,
    newThreadId: string,
  ) => void;
  renameThreadTitleMapping: (
    workspaceId: string,
    oldThreadId: string,
    newThreadId: string,
  ) => Promise<void>;
  resolvePendingThreadForSession?: (
    workspaceId: string,
    engine: "claude" | "gemini" | "opencode",
  ) => string | null;
  resolvePendingThreadForTurn?: (
    workspaceId: string,
    engine: "claude" | "gemini" | "opencode",
    turnId: string | null | undefined,
  ) => string | null;
  getActiveTurnIdForThread?: (threadId: string) => string | null;
  renamePendingMemoryCaptureKey: (
    oldThreadId: string,
    newThreadId: string,
  ) => void;
  onDebug?: (entry: DebugEntry) => void;
};

export function useThreadTurnEvents({
  activeThreadId = null,
  dispatch,
  getCustomName,
  resolveCanonicalThreadId,
  isAutoTitlePending,
  isThreadHidden,
  markProcessing,
  markReviewing,
  setActiveTurnId,
  codexCompactionInFlightByThreadRef,
  pendingInterruptsRef,
  interruptedThreadsRef,
  pushThreadErrorMessage,
  safeMessageActivity,
  recordThreadActivity,
  renameCustomNameKey,
  renameAutoTitlePendingKey,
  renameThreadTitleMapping,
  resolvePendingThreadForSession,
  resolvePendingThreadForTurn,
  getActiveTurnIdForThread,
  renamePendingMemoryCaptureKey,
  onDebug,
}: UseThreadTurnEventsOptions) {
  const { t } = useTranslation();
  const collectCompactionTargetThreadIds = useCallback(
    (threadId: string) => {
      const normalizedThreadId = threadId.trim();
      if (!normalizedThreadId) {
        return [] as string[];
      }
      const canonicalThreadId = resolveCanonicalThreadId?.(normalizedThreadId) ?? normalizedThreadId;
      return Array.from(new Set([normalizedThreadId, canonicalThreadId].filter(Boolean)));
    },
    [resolveCanonicalThreadId],
  );
  const logSessionTrace = useCallback(
    (label: string, payload: Record<string, unknown>) => {
      onDebug?.({
        id: `${Date.now()}-thread-session-trace`,
        timestamp: Date.now(),
        source: "event",
        label: `thread/session:${label}`,
        payload,
      });
    },
    [onDebug],
  );
  const migrateThreadInterruptGuards = useCallback(
    (oldThreadId: string, newThreadId: string) => {
      const result = {
        movedPendingInterrupt: false,
        movedInterruptedThread: false,
      };
      if (!oldThreadId || !newThreadId || oldThreadId === newThreadId) {
        return result;
      }
      if (pendingInterruptsRef.current.delete(oldThreadId)) {
        pendingInterruptsRef.current.add(newThreadId);
        result.movedPendingInterrupt = true;
      }
      if (interruptedThreadsRef.current.delete(oldThreadId)) {
        interruptedThreadsRef.current.add(newThreadId);
        result.movedInterruptedThread = true;
      }
      return result;
    },
    [interruptedThreadsRef, pendingInterruptsRef],
  );
  const resolvePendingAliasThread = useCallback(
    (
      workspaceId: string,
      threadId: string,
      turnId: string,
    ): string | null => {
      const engine = threadId.startsWith("opencode:")
        ? "opencode"
        : threadId.startsWith("gemini:")
          ? "gemini"
        : threadId.startsWith("claude:")
          ? "claude"
          : null;
      if (!engine) {
        return null;
      }
      const pending = resolvePendingThreadForSession?.(workspaceId, engine) ?? null;
      if (!pending || pending === threadId || !turnId || !getActiveTurnIdForThread) {
        return null;
      }
      const activePendingTurnId = getActiveTurnIdForThread(pending);
      if (!activePendingTurnId || activePendingTurnId !== turnId) {
        return null;
      }
      return pending;
    },
    [getActiveTurnIdForThread, resolvePendingThreadForSession],
  );

  const onThreadStarted = useCallback(
    (workspaceId: string, thread: Record<string, unknown>) => {
      const threadId = asString(thread.id);
      if (!threadId) {
        return;
      }
      if (isCodexBackgroundHelperThread(threadId, thread)) {
        dispatch({ type: "hideThread", workspaceId, threadId });
        return;
      }
      if (isThreadHidden(workspaceId, threadId)) {
        return;
      }
      dispatch({ type: "ensureThread", workspaceId, threadId, engine: inferEngineFromThreadId(threadId) });
      const timestamp = getThreadTimestamp(thread);
      const activityTimestamp = timestamp > 0 ? timestamp : Date.now();
      recordThreadActivity(workspaceId, threadId, activityTimestamp);
      dispatch({
        type: "setThreadTimestamp",
        workspaceId,
        threadId,
        timestamp: activityTimestamp,
      });

      const customName = getCustomName(workspaceId, threadId);
      if (!customName && !isAutoTitlePending(workspaceId, threadId)) {
        const preview = asString(thread.preview).trim();
        if (preview) {
          const name = previewThreadName(preview, `Agent ${threadId.slice(0, 4)}`);
          dispatch({ type: "setThreadName", workspaceId, threadId, name });
        }
      }
      safeMessageActivity();
    },
    [dispatch, getCustomName, isAutoTitlePending, isThreadHidden, recordThreadActivity, safeMessageActivity],
  );

  const onTurnStarted = useCallback(
    (workspaceId: string, threadId: string, turnId: string) => {
      dispatch({
        type: "ensureThread",
        workspaceId,
        threadId,
        engine: inferEngineFromThreadId(threadId),
      });
      dispatch({
        type: "setThreadHistoryRestoredAt",
        threadId,
        timestamp: null,
      });
      dispatch({ type: "markContextCompacting", threadId, isCompacting: false });
      if (pendingInterruptsRef.current.has(threadId)) {
        pendingInterruptsRef.current.delete(threadId);
        const engine = inferEngineFromThreadId(threadId);
        if (engine === "codex" && turnId) {
          void interruptTurnService(workspaceId, threadId, turnId).catch(() => {});
        } else if (turnId) {
          void engineInterruptTurnService(workspaceId, turnId, engine).catch(() => {
            // Fallback for older runtimes missing turn-scoped interrupt.
            void engineInterruptService(workspaceId).catch(() => {});
          });
        }
        return;
      }
      markProcessing(threadId, true);
      if (turnId) {
        setActiveTurnId(threadId, turnId);
      }
    },
    [dispatch, markProcessing, pendingInterruptsRef, setActiveTurnId],
  );

  const onTurnCompleted = useCallback(
    (workspaceId: string, threadId: string, turnId: string) => {
      const aliasThreadId = resolvePendingAliasThread(workspaceId, threadId, turnId);
      const activeTurnId = getActiveTurnIdForThread?.(threadId) ?? null;
      const activeAliasTurnId = aliasThreadId
        ? (getActiveTurnIdForThread?.(aliasThreadId) ?? null)
        : null;
      const matchesActiveTurn =
        !turnId ||
        activeTurnId === null ||
        activeTurnId === turnId ||
        activeAliasTurnId === turnId;
      if (!matchesActiveTurn) {
        return false;
      }
      const targetThreadIds = aliasThreadId
        ? [threadId, aliasThreadId]
        : [threadId];
      targetThreadIds.forEach((targetThreadId) => {
        dispatch({
          type: "clearProcessingGeneratedImages",
          threadId: targetThreadId,
        });
        dispatch({ type: "markTerminalSettlement", threadId: targetThreadId });
        dispatch({
          type: "finalizePendingToolStatuses",
          threadId: targetThreadId,
          status: "completed",
        });
        dispatch({
          type: "markContextCompacting",
          threadId: targetThreadId,
          isCompacting: false,
          timestamp: Date.now(),
        });
        dispatch({
          type: "settleThreadPlanInProgress",
          threadId: targetThreadId,
          targetStatus: "completed",
        });
        markProcessing(targetThreadId, false);
        setActiveTurnId(targetThreadId, null);
        pendingInterruptsRef.current.delete(targetThreadId);
        interruptedThreadsRef.current.delete(targetThreadId);
        // 重置分段计数，为下一个 turn 做准备
        dispatch({ type: "resetAgentSegment", threadId: targetThreadId });
        dispatch({ type: "markLatestAssistantMessageFinal", threadId: targetThreadId });
      });
      return true;
    },
    [
      dispatch,
      getActiveTurnIdForThread,
      interruptedThreadsRef,
      markProcessing,
      pendingInterruptsRef,
      resolvePendingAliasThread,
      setActiveTurnId,
    ],
  );

  const onTurnPlanUpdated = useCallback(
    (
      workspaceId: string,
      threadId: string,
      turnId: string,
      payload: { explanation: unknown; plan: unknown },
    ) => {
      dispatch({ type: "ensureThread", workspaceId, threadId, engine: inferEngineFromThreadId(threadId) });
      const normalized = normalizePlanUpdate(
        turnId,
        payload.explanation,
        payload.plan,
      );
      dispatch({ type: "setThreadPlan", threadId, plan: normalized });
    },
    [dispatch],
  );

  const onThreadTokenUsageUpdated = useCallback(
    (workspaceId: string, threadId: string, tokenUsage: Record<string, unknown>) => {
      dispatch({ type: "ensureThread", workspaceId, threadId, engine: inferEngineFromThreadId(threadId) });
      dispatch({
        type: "setThreadTokenUsage",
        threadId,
        tokenUsage: normalizeTokenUsage(tokenUsage),
      });
    },
    [dispatch],
  );

  const onAccountRateLimitsUpdated = useCallback(
    (workspaceId: string, rateLimits: Record<string, unknown>) => {
      dispatch({
        type: "setRateLimits",
        workspaceId,
        rateLimits: normalizeRateLimits(rateLimits),
      });
    },
    [dispatch],
  );

  const onTurnError = useCallback(
    (
      workspaceId: string,
      threadId: string,
      turnId: string,
      payload: { message: string; willRetry: boolean },
    ) => {
      if (payload.willRetry) {
        return;
      }
      const aliasThreadId = resolvePendingAliasThread(workspaceId, threadId, turnId);
      const activeTurnId = getActiveTurnIdForThread?.(threadId) ?? null;
      const activeAliasTurnId = aliasThreadId
        ? (getActiveTurnIdForThread?.(aliasThreadId) ?? null)
        : null;
      const matchesActiveTurn =
        !turnId ||
        activeTurnId === null ||
        activeTurnId === turnId ||
        activeAliasTurnId === turnId;
      if (!matchesActiveTurn) {
        return;
      }

      // If this thread was interrupted by user, the error is expected
      // (e.g. "Session stopped."). Clean up the interrupted flag and
      // suppress the redundant error message since interruptTurn already
      // displayed "Session stopped." to the user.
      const wasInterrupted = interruptedThreadsRef.current.has(threadId);
      const shouldKeepInterruptedGuard =
        wasInterrupted && inferEngineFromThreadId(threadId) === "gemini";
      if (!shouldKeepInterruptedGuard) {
        interruptedThreadsRef.current.delete(threadId);
      }

      dispatch({ type: "ensureThread", workspaceId, threadId, engine: inferEngineFromThreadId(threadId) });
      dispatch({
        type: "clearProcessingGeneratedImages",
        threadId,
      });
      dispatch({ type: "markTerminalSettlement", threadId });
      dispatch({
        type: "finalizePendingToolStatuses",
        threadId,
        status: "failed",
      });
      dispatch({
        type: "settleThreadPlanInProgress",
        threadId,
        targetStatus: "pending",
      });
      dispatch({
        type: "markContextCompacting",
        threadId,
        isCompacting: false,
        timestamp: Date.now(),
      });
      markProcessing(threadId, false);
      markReviewing(threadId, false);
      setActiveTurnId(threadId, null);
      if (aliasThreadId) {
        dispatch({
          type: "clearProcessingGeneratedImages",
          threadId: aliasThreadId,
        });
        dispatch({
          type: "markTerminalSettlement",
          threadId: aliasThreadId,
        });
        dispatch({
          type: "finalizePendingToolStatuses",
          threadId: aliasThreadId,
          status: "failed",
        });
        dispatch({
          type: "markContextCompacting",
          threadId: aliasThreadId,
          isCompacting: false,
          timestamp: Date.now(),
        });
        dispatch({
          type: "settleThreadPlanInProgress",
          threadId: aliasThreadId,
          targetStatus: "pending",
        });
        markProcessing(aliasThreadId, false);
        markReviewing(aliasThreadId, false);
        setActiveTurnId(aliasThreadId, null);
        pendingInterruptsRef.current.delete(aliasThreadId);
        interruptedThreadsRef.current.delete(aliasThreadId);
      }

      if (!wasInterrupted) {
        const stabilityDiagnostic = payload.message
          ? resolveThreadStabilityDiagnostic(payload.message)
          : null;
        if (stabilityDiagnostic) {
          onDebug?.({
            id: `${Date.now()}-thread-stability-diagnostic`,
            timestamp: Date.now(),
            source: "event",
            label: "thread/stability diagnostic",
            payload: {
              workspaceId,
              threadId,
              turnId,
              category: stabilityDiagnostic.category,
              rawMessage: stabilityDiagnostic.rawMessage,
              recoveryReason: stabilityDiagnostic.reconnectReason ?? null,
            },
          });
        }
        const message = payload.message
          ? t("threads.turnFailedWithMessage", { message: payload.message })
          : t("threads.turnFailed");
        pushThreadErrorMessage(threadId, message);
        pushThreadFailureRuntimeNotice({
          workspaceId,
          threadId,
          turnId,
          engine: inferEngineFromThreadId(threadId),
          message: payload.message || message,
        });
      }
      safeMessageActivity();
    },
    [
      dispatch,
      getActiveTurnIdForThread,
      interruptedThreadsRef,
      markProcessing,
      markReviewing,
      onDebug,
      pendingInterruptsRef,
      pushThreadErrorMessage,
      resolvePendingAliasThread,
      safeMessageActivity,
      setActiveTurnId,
      t,
    ],
  );

  const onTurnStalled = useCallback(
    (
      workspaceId: string,
      threadId: string,
      turnId: string,
      payload: {
        message: string;
        reasonCode: string;
        stage: string;
        source: string;
        startedAtMs: number | null;
        timeoutMs: number | null;
      },
    ) => {
      const aliasThreadId = resolvePendingAliasThread(workspaceId, threadId, turnId);
      const activeTurnId = getActiveTurnIdForThread?.(threadId) ?? null;
      const activeAliasTurnId = aliasThreadId
        ? (getActiveTurnIdForThread?.(aliasThreadId) ?? null)
        : null;
      const matchesActiveTurn =
        !turnId ||
        activeTurnId === null ||
        activeTurnId === turnId ||
        activeAliasTurnId === turnId;
      if (!matchesActiveTurn) {
        return;
      }

      dispatch({ type: "ensureThread", workspaceId, threadId, engine: inferEngineFromThreadId(threadId) });
      dispatch({
        type: "clearProcessingGeneratedImages",
        threadId,
      });
      dispatch({ type: "markTerminalSettlement", threadId });
      dispatch({
        type: "settleThreadPlanInProgress",
        threadId,
        targetStatus: "pending",
      });
      dispatch({
        type: "markContextCompacting",
        threadId,
        isCompacting: false,
        timestamp: Date.now(),
      });
      markProcessing(threadId, false);
      markReviewing(threadId, false);
      setActiveTurnId(threadId, null);
      if (aliasThreadId) {
        dispatch({
          type: "clearProcessingGeneratedImages",
          threadId: aliasThreadId,
        });
        dispatch({
          type: "markTerminalSettlement",
          threadId: aliasThreadId,
        });
        dispatch({
          type: "settleThreadPlanInProgress",
          threadId: aliasThreadId,
          targetStatus: "pending",
        });
        dispatch({
          type: "markContextCompacting",
          threadId: aliasThreadId,
          isCompacting: false,
          timestamp: Date.now(),
        });
        markProcessing(aliasThreadId, false);
        markReviewing(aliasThreadId, false);
        setActiveTurnId(aliasThreadId, null);
      }
      onDebug?.({
        id: `${Date.now()}-thread-stability-diagnostic`,
        timestamp: Date.now(),
        source: "event",
        label: "thread/stability diagnostic",
        payload: {
          workspaceId,
          threadId,
          turnId,
          category: "resume_stalled",
          rawMessage: payload.message,
          reasonCode: payload.reasonCode,
          stage: payload.stage,
          source: payload.source,
          startedAtMs: payload.startedAtMs,
          timeoutMs: payload.timeoutMs,
        },
      });
      const isFusionStalled = payload.source === "queue-fusion-cutover";
      const message = payload.message
        ? t(
            isFusionStalled
              ? "threads.fusionTurnStalledWithMessage"
              : "threads.turnStalledWithMessage",
            { message: payload.message },
          )
        : t(isFusionStalled ? "threads.fusionTurnStalled" : "threads.turnStalled");
      pushThreadErrorMessage(threadId, message);
      pushThreadFailureRuntimeNotice({
        workspaceId,
        threadId,
        turnId,
        engine: inferEngineFromThreadId(threadId),
        message: payload.message || message,
      });
      safeMessageActivity();
    },
    [
      dispatch,
      getActiveTurnIdForThread,
      markProcessing,
      markReviewing,
      onDebug,
      pushThreadErrorMessage,
      resolvePendingAliasThread,
      safeMessageActivity,
      setActiveTurnId,
      t,
    ],
  );

  const onContextCompacted = useCallback(
    (
      workspaceId: string,
      threadId: string,
      turnId: string,
      payload?: ContextCompactionSourcePayload,
    ) => {
      const timestamp = Date.now();
      const targetThreadIds = collectCompactionTargetThreadIds(threadId);
      const wasCodexCompacting = targetThreadIds.some(
        (targetThreadId) => codexCompactionInFlightByThreadRef.current[targetThreadId] ?? false,
      );
      const isCodexCompaction = payload
        ? targetThreadIds.some((targetThreadId) => isCodexContextCompaction(targetThreadId))
        : wasCodexCompacting;
      targetThreadIds.forEach((targetThreadId) => {
        delete codexCompactionInFlightByThreadRef.current[targetThreadId];
        dispatch({
          type: "ensureThread",
          workspaceId,
          threadId: targetThreadId,
          engine: inferEngineFromThreadId(targetThreadId),
        });
        dispatch({
          type: "markContextCompacting",
          threadId: targetThreadId,
          isCompacting: false,
          timestamp,
        });
      });
      const resolvedTurnId = turnId || `auto-${timestamp}`;
      if (isCodexCompaction) {
        const shouldAppendCompletedFallback = Boolean(payload) && !wasCodexCompacting;
        targetThreadIds.forEach((targetThreadId) => {
          dispatch({
            type: "settleCodexCompactionMessage",
            threadId: targetThreadId,
            text: t("threads.codexCompactionCompleted"),
            fallbackMessageId: buildCodexCompactionCompletionFallbackId(
              targetThreadId,
              resolvedTurnId,
            ),
            appendIfAlreadyCompleted: shouldAppendCompletedFallback,
          });
        });
      } else {
        targetThreadIds.forEach((targetThreadId) => {
          dispatch({
            type: "appendContextCompacted",
            threadId: targetThreadId,
            turnId: resolvedTurnId,
          });
        });
      }
      targetThreadIds.forEach((targetThreadId) => {
        recordThreadActivity(workspaceId, targetThreadId, timestamp);
      });
      safeMessageActivity();
    },
    [collectCompactionTargetThreadIds, dispatch, recordThreadActivity, safeMessageActivity, t],
  );

  const onContextCompacting = useCallback(
    (
      workspaceId: string,
      threadId: string,
      _payload: {
        usagePercent: number | null;
        thresholdPercent: number | null;
        targetPercent: number | null;
        auto?: boolean | null;
        manual?: boolean | null;
      },
    ) => {
      const targetThreadIds = collectCompactionTargetThreadIds(threadId);
      const isCodexCompaction = targetThreadIds.some((targetThreadId) =>
        isCodexContextCompaction(targetThreadId),
      );
      if (isCodexCompaction) {
        targetThreadIds.forEach((targetThreadId) => {
          codexCompactionInFlightByThreadRef.current[targetThreadId] = true;
        });
      } else {
        targetThreadIds.forEach((targetThreadId) => {
          delete codexCompactionInFlightByThreadRef.current[targetThreadId];
        });
      }
      const timestamp = Date.now();
      targetThreadIds.forEach((targetThreadId) => {
        dispatch({
          type: "ensureThread",
          workspaceId,
          threadId: targetThreadId,
          engine: inferEngineFromThreadId(targetThreadId),
        });
        dispatch({
          type: "markContextCompacting",
          threadId: targetThreadId,
          isCompacting: true,
          timestamp,
        });
      });
      if (isCodexCompaction) {
        targetThreadIds.forEach((targetThreadId) => {
          dispatch({
            type: "appendCodexCompactionMessage",
            threadId: targetThreadId,
            text: t("threads.codexCompactionStarted"),
          });
        });
      }
      targetThreadIds.forEach((targetThreadId) => {
        recordThreadActivity(workspaceId, targetThreadId, timestamp);
      });
      safeMessageActivity();
    },
    [collectCompactionTargetThreadIds, dispatch, recordThreadActivity, safeMessageActivity, t],
  );

  const onContextCompactionFailed = useCallback(
    (workspaceId: string, threadId: string, reason: string) => {
      const timestamp = Date.now();
      const targetThreadIds = collectCompactionTargetThreadIds(threadId);
      targetThreadIds.forEach((targetThreadId) => {
        delete codexCompactionInFlightByThreadRef.current[targetThreadId];
        dispatch({
          type: "ensureThread",
          workspaceId,
          threadId: targetThreadId,
          engine: inferEngineFromThreadId(targetThreadId),
        });
        dispatch({
          type: "markContextCompacting",
          threadId: targetThreadId,
          isCompacting: false,
          timestamp,
        });
      });
      const message = reason
        ? t("threads.contextCompactionFailedWithMessage", { message: reason })
        : t("threads.contextCompactionFailed");
      const stabilityDiagnostic = reason
        ? resolveThreadStabilityDiagnostic(reason)
        : null;
      if (stabilityDiagnostic) {
        onDebug?.({
          id: `${Date.now()}-thread-stability-diagnostic`,
          timestamp: Date.now(),
          source: "event",
          label: "thread/stability diagnostic",
          payload: {
            workspaceId,
            threadId: targetThreadIds[0] ?? threadId,
            category: stabilityDiagnostic.category,
            rawMessage: stabilityDiagnostic.rawMessage,
            recoveryReason: stabilityDiagnostic.reconnectReason ?? null,
            stage: "context-compaction",
          },
        });
      }
      targetThreadIds.forEach((targetThreadId) => {
        pushThreadErrorMessage(targetThreadId, message);
      });
      pushThreadFailureRuntimeNotice({
        workspaceId,
        threadId: targetThreadIds[0] ?? threadId,
        engine: inferEngineFromThreadId(targetThreadIds[0] ?? threadId),
        message: reason || message,
      });
      safeMessageActivity();
    },
    [collectCompactionTargetThreadIds, dispatch, onDebug, pushThreadErrorMessage, safeMessageActivity, t],
  );

  const onThreadSessionIdUpdated = useCallback(
    (
      workspaceId: string,
      threadId: string,
      sessionId: string,
      engineHint?: "claude" | "opencode" | "codex" | "gemini" | null,
      turnId?: string | null,
    ) => {
      const explicitEnginePrefix = threadId.startsWith("claude:")
        || threadId.startsWith("claude-pending-")
        ? "claude"
        : threadId.startsWith("gemini:")
          || threadId.startsWith("gemini-pending-")
          ? "gemini"
        : threadId.startsWith("opencode:")
          || threadId.startsWith("opencode-pending-")
          ? "opencode"
          : null;
      const hintedEngine =
        engineHint === "claude" || engineHint === "gemini" || engineHint === "opencode"
          ? engineHint
          : null;
      const pendingOpenCode = resolvePendingThreadForSession?.(workspaceId, "opencode") ?? null;
      const pendingGemini = resolvePendingThreadForSession?.(workspaceId, "gemini") ?? null;
      const pendingClaude = resolvePendingThreadForSession?.(workspaceId, "claude") ?? null;
      logSessionTrace("event", {
        workspaceId,
        threadId,
        sessionId,
        engineHint: engineHint ?? null,
        turnId: turnId ?? null,
        explicitEnginePrefix,
        pendingOpenCode,
        pendingGemini,
        pendingClaude,
      });

      const enginePrefix =
        explicitEnginePrefix
        ?? hintedEngine
        ?? (pendingOpenCode && !pendingGemini && !pendingClaude
          ? "opencode"
          : pendingGemini && !pendingOpenCode && !pendingClaude
            ? "gemini"
          : pendingClaude && !pendingOpenCode && !pendingGemini
            ? "claude"
            : null);
      if (!enginePrefix) {
        logSessionTrace("skip:no-engine-prefix", {
          workspaceId,
          threadId,
          sessionId,
          engineHint: engineHint ?? null,
          pendingOpenCode,
          pendingGemini,
          pendingClaude,
        });
        return;
      }

      const newThreadId = `${enginePrefix}:${sessionId}`;
      const turnBoundPendingThreadId =
        resolvePendingThreadForTurn?.(workspaceId, enginePrefix, turnId) ?? null;

      const sameEnginePendingPrefix = `${enginePrefix}-pending-`;
      const sameEngineFinalizedPrefix = `${enginePrefix}:`;
      const hasAnyEnginePrefix =
        threadId.startsWith("claude:")
        || threadId.startsWith("claude-pending-")
        || threadId.startsWith("gemini:")
        || threadId.startsWith("gemini-pending-")
        || threadId.startsWith("opencode:")
        || threadId.startsWith("opencode-pending-");
      const hasForeignEnginePrefix = (
        (enginePrefix !== "claude" && (threadId.startsWith("claude:") || threadId.startsWith("claude-pending-")))
        || (enginePrefix !== "gemini" && (threadId.startsWith("gemini:") || threadId.startsWith("gemini-pending-")))
        || (enginePrefix !== "opencode" && (threadId.startsWith("opencode:") || threadId.startsWith("opencode-pending-")))
      );

      const shouldRebindActiveFinalizedThread =
        threadId.startsWith(sameEngineFinalizedPrefix)
        && threadId !== newThreadId
        && activeThreadId === threadId;
      if (
        threadId.startsWith(sameEngineFinalizedPrefix)
        && threadId !== newThreadId
        && !shouldRebindActiveFinalizedThread
      ) {
        logSessionTrace("skip:finalized-mismatch", {
          workspaceId,
          threadId,
          newThreadId,
          enginePrefix,
          activeThreadId,
        });
        return;
      }

      let sourceThreadId: string | null = null;
      if (threadId === newThreadId) {
        // Some runtimes emit session-id updates with finalized thread ids only.
        // Rebind conservatively: prefer an exact turn-bound pending match, and
        // otherwise only fall back to the active pending thread for the engine.
        const pendingThreadId = enginePrefix === "opencode"
          ? pendingOpenCode
          : enginePrefix === "gemini"
            ? pendingGemini
            : pendingClaude;
        if (
          turnBoundPendingThreadId?.startsWith(sameEnginePendingPrefix)
        ) {
          sourceThreadId = turnBoundPendingThreadId;
        } else if (
          pendingThreadId?.startsWith(sameEnginePendingPrefix)
          && (
            pendingThreadId === activeThreadId ||
            activeThreadId === newThreadId
          )
        ) {
          sourceThreadId = pendingThreadId;
        } else {
          logSessionTrace("skip:already-finalized", {
            workspaceId,
            threadId,
            newThreadId,
            enginePrefix,
            activeThreadId,
            pendingThreadId: pendingThreadId ?? null,
            turnBoundPendingThreadId,
            turnId: turnId ?? null,
          });
          return;
        }
      } else if (threadId.startsWith(sameEnginePendingPrefix)) {
        sourceThreadId = threadId;
      } else if (shouldRebindActiveFinalizedThread) {
        sourceThreadId = threadId;
      } else if (!hasAnyEnginePrefix && !hasForeignEnginePrefix) {
        const pendingThreadId = enginePrefix === "opencode"
          ? pendingOpenCode
          : enginePrefix === "gemini"
            ? pendingGemini
          : pendingClaude;
        // Safety boundary: for non-prefixed thread ids, only bind to the
        // currently active pending thread unless a turn-bound mapping exists.
        // Turn-bound matches are safe to rebind even when the user has already
        // switched selection, because the turn identity is more precise than
        // workspace-level active-thread heuristics.
        if (
          turnBoundPendingThreadId?.startsWith(sameEnginePendingPrefix)
        ) {
          sourceThreadId = turnBoundPendingThreadId;
        } else if (
          pendingThreadId?.startsWith(sameEnginePendingPrefix)
          && (
            pendingThreadId === activeThreadId ||
            activeThreadId === newThreadId
          )
        ) {
          sourceThreadId = pendingThreadId;
        } else {
          logSessionTrace("skip:non-prefixed-not-active", {
            workspaceId,
            threadId,
            newThreadId,
            enginePrefix,
            pendingThreadId: pendingThreadId ?? null,
            turnBoundPendingThreadId,
            activeThreadId,
            turnId: turnId ?? null,
          });
        }
      }

      if (!sourceThreadId || sourceThreadId === newThreadId) {
        logSessionTrace("skip:no-pending-source", {
          workspaceId,
          threadId,
          newThreadId,
          sourceThreadId,
          hasForeignEnginePrefix,
          enginePrefix,
          shouldRebindActiveFinalizedThread,
          turnBoundPendingThreadId,
          turnId: turnId ?? null,
        });
        return;
      }

      logSessionTrace("rename", {
        workspaceId,
        oldThreadId: sourceThreadId,
        newThreadId,
        enginePrefix,
        eventThreadId: threadId,
        turnBoundPendingThreadId,
        turnId: turnId ?? null,
      });
      const { movedPendingInterrupt } = migrateThreadInterruptGuards(
        sourceThreadId,
        newThreadId,
      );
      // If the user interrupted during pending->finalized rebind and the target
      // thread already has an active turn id, execute interrupt immediately.
      if (movedPendingInterrupt) {
        const activeTurnId = getActiveTurnIdForThread?.(newThreadId) ?? null;
        if (activeTurnId) {
          pendingInterruptsRef.current.delete(newThreadId);
          void engineInterruptTurnService(
            workspaceId,
            activeTurnId,
            enginePrefix,
          ).catch(() => {
            void engineInterruptService(workspaceId).catch(() => {});
          });
        }
      }
      // Rename the thread from claude-pending-* to claude:{sessionId}
      dispatch({
        type: "renameThreadId",
        workspaceId,
        oldThreadId: sourceThreadId,
        newThreadId,
      });
      renameCustomNameKey(workspaceId, sourceThreadId, newThreadId);
      renameAutoTitlePendingKey(workspaceId, sourceThreadId, newThreadId);
      renamePendingMemoryCaptureKey(sourceThreadId, newThreadId);
      void renameThreadTitleMapping(workspaceId, sourceThreadId, newThreadId);
    },
    [
      dispatch,
      logSessionTrace,
      renameAutoTitlePendingKey,
      renameCustomNameKey,
      renamePendingMemoryCaptureKey,
      renameThreadTitleMapping,
      resolvePendingThreadForSession,
      resolvePendingThreadForTurn,
      migrateThreadInterruptGuards,
      getActiveTurnIdForThread,
      pendingInterruptsRef,
      activeThreadId,
    ],
  );

  return {
    onThreadStarted,
    onTurnStarted,
    onTurnCompleted,
    onTurnPlanUpdated,
    onThreadTokenUsageUpdated,
    onAccountRateLimitsUpdated,
    onTurnError,
    onTurnStalled,
    onContextCompacting,
    onContextCompacted,
    onContextCompactionFailed,
    onThreadSessionIdUpdated,
  };
}
