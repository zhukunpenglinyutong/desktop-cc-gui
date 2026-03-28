import { useCallback } from "react";
import type { Dispatch, MutableRefObject } from "react";
import type { DebugEntry } from "../../../types";
import { useTranslation } from "react-i18next";
import {
  engineInterrupt as engineInterruptService,
  interruptTurn as interruptTurnService,
} from "../../../services/tauri";
import { getThreadTimestamp } from "../../../utils/threadItems";
import {
  asString,
  normalizePlanUpdate,
  normalizeRateLimits,
  normalizeTokenUsage,
} from "../utils/threadNormalize";
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

const CODEX_BACKGROUND_HELPER_PREVIEW_PREFIXES = [
  "Generate a concise title for a coding chat thread from the first user message.",
  "You create concise run metadata for a coding task.",
  "You are generating OpenSpec project context.",
  "Generate a concise git commit message for the following changes.",
] as const;

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
  return previewCandidates.some((preview) =>
    CODEX_BACKGROUND_HELPER_PREVIEW_PREFIXES.some((prefix) =>
      preview.startsWith(prefix),
    ),
  );
}

type UseThreadTurnEventsOptions = {
  activeThreadId?: string | null;
  dispatch: Dispatch<ThreadAction>;
  getCustomName: (workspaceId: string, threadId: string) => string | undefined;
  isAutoTitlePending: (workspaceId: string, threadId: string) => boolean;
  isThreadHidden: (workspaceId: string, threadId: string) => boolean;
  markProcessing: (threadId: string, isProcessing: boolean) => void;
  markReviewing: (threadId: string, isReviewing: boolean) => void;
  setActiveTurnId: (threadId: string, turnId: string | null) => void;
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
  isAutoTitlePending,
  isThreadHidden,
  markProcessing,
  markReviewing,
  setActiveTurnId,
  pendingInterruptsRef,
  interruptedThreadsRef,
  pushThreadErrorMessage,
  safeMessageActivity,
  recordThreadActivity,
  renameCustomNameKey,
  renameAutoTitlePendingKey,
  renameThreadTitleMapping,
  resolvePendingThreadForSession,
  renamePendingMemoryCaptureKey,
  onDebug,
}: UseThreadTurnEventsOptions) {
  const { t } = useTranslation();
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
  const resolvePendingAliasThread = useCallback(
    (
      workspaceId: string,
      threadId: string,
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
      if (!pending || pending === threadId) {
        return null;
      }
      return pending;
    },
    [resolvePendingThreadForSession],
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
          const name = preview;
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
      dispatch({ type: "markContextCompacting", threadId, isCompacting: false });
      if (pendingInterruptsRef.current.has(threadId)) {
        pendingInterruptsRef.current.delete(threadId);
        const engine = inferEngineFromThreadId(threadId);
        if (engine === "gemini") {
          void engineInterruptService(workspaceId).catch(() => {});
        } else if (turnId) {
          void interruptTurnService(workspaceId, threadId, turnId).catch(() => {});
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
    (workspaceId: string, threadId: string, _turnId: string) => {
      const aliasThreadId = resolvePendingAliasThread(workspaceId, threadId);
      const targetThreadIds = aliasThreadId
        ? [threadId, aliasThreadId]
        : [threadId];
      targetThreadIds.forEach((targetThreadId) => {
        dispatch({
          type: "finalizePendingToolStatuses",
          threadId: targetThreadId,
          status: "completed",
        });
        dispatch({
          type: "markContextCompacting",
          threadId: targetThreadId,
          isCompacting: false,
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
      });
    },
    [
      dispatch,
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
      _turnId: string,
      payload: { message: string; willRetry: boolean },
    ) => {
      if (payload.willRetry) {
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
        type: "finalizePendingToolStatuses",
        threadId,
        status: "failed",
      });
      dispatch({
        type: "settleThreadPlanInProgress",
        threadId,
        targetStatus: "pending",
      });
      dispatch({ type: "markContextCompacting", threadId, isCompacting: false });
      markProcessing(threadId, false);
      markReviewing(threadId, false);
      setActiveTurnId(threadId, null);
      const aliasThreadId = resolvePendingAliasThread(workspaceId, threadId);
      if (aliasThreadId) {
        dispatch({
          type: "finalizePendingToolStatuses",
          threadId: aliasThreadId,
          status: "failed",
        });
        dispatch({
          type: "markContextCompacting",
          threadId: aliasThreadId,
          isCompacting: false,
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
        const message = payload.message
          ? t("threads.turnFailedWithMessage", { message: payload.message })
          : t("threads.turnFailed");
        pushThreadErrorMessage(threadId, message);
      }
      safeMessageActivity();
    },
    [
      dispatch,
      interruptedThreadsRef,
      markProcessing,
      markReviewing,
      pendingInterruptsRef,
      pushThreadErrorMessage,
      resolvePendingAliasThread,
      safeMessageActivity,
      setActiveTurnId,
      t,
    ],
  );

  const onContextCompacted = useCallback(
    (workspaceId: string, threadId: string, turnId: string) => {
      dispatch({ type: "ensureThread", workspaceId, threadId, engine: inferEngineFromThreadId(threadId) });
      dispatch({ type: "markContextCompacting", threadId, isCompacting: false });
      const timestamp = Date.now();
      const resolvedTurnId = turnId || `auto-${timestamp}`;
      dispatch({ type: "appendContextCompacted", threadId, turnId: resolvedTurnId });
      recordThreadActivity(workspaceId, threadId, timestamp);
      safeMessageActivity();
    },
    [dispatch, recordThreadActivity, safeMessageActivity],
  );

  const onContextCompacting = useCallback(
    (
      workspaceId: string,
      threadId: string,
      _payload: {
        usagePercent: number | null;
        thresholdPercent: number | null;
        targetPercent: number | null;
      },
    ) => {
      dispatch({ type: "ensureThread", workspaceId, threadId, engine: inferEngineFromThreadId(threadId) });
      dispatch({ type: "markContextCompacting", threadId, isCompacting: true });
      safeMessageActivity();
    },
    [dispatch, safeMessageActivity],
  );

  const onContextCompactionFailed = useCallback(
    (workspaceId: string, threadId: string, reason: string) => {
      dispatch({ type: "ensureThread", workspaceId, threadId, engine: inferEngineFromThreadId(threadId) });
      dispatch({ type: "markContextCompacting", threadId, isCompacting: false });
      const message = reason
        ? t("threads.contextCompactionFailedWithMessage", { message: reason })
        : t("threads.contextCompactionFailed");
      pushThreadErrorMessage(threadId, message);
      safeMessageActivity();
    },
    [dispatch, pushThreadErrorMessage, safeMessageActivity, t],
  );

  const onThreadSessionIdUpdated = useCallback(
    (
      workspaceId: string,
      threadId: string,
      sessionId: string,
      engineHint?: "claude" | "opencode" | "codex" | "gemini" | null,
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
          : pendingClaude && !pendingOpenCode
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
      // Guard boundary: if backend already reports the finalized thread id,
      // never remap a pending thread onto it.
      if (threadId === newThreadId) {
        logSessionTrace("skip:already-finalized", {
          workspaceId,
          threadId,
          newThreadId,
          enginePrefix,
        });
        return;
      }

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
      if (threadId.startsWith(sameEnginePendingPrefix)) {
        sourceThreadId = threadId;
      } else if (shouldRebindActiveFinalizedThread) {
        sourceThreadId = threadId;
      } else if (!hasAnyEnginePrefix && !hasForeignEnginePrefix) {
        const pendingThreadId = enginePrefix === "opencode"
          ? pendingOpenCode
          : enginePrefix === "gemini"
            ? pendingGemini
          : pendingClaude;
        if (pendingThreadId?.startsWith(sameEnginePendingPrefix)) {
          sourceThreadId = pendingThreadId;
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
        });
        return;
      }

      logSessionTrace("rename", {
        workspaceId,
        oldThreadId: sourceThreadId,
        newThreadId,
        enginePrefix,
        eventThreadId: threadId,
      });
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
    onContextCompacting,
    onContextCompacted,
    onContextCompactionFailed,
    onThreadSessionIdUpdated,
  };
}
