import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, MutableRefObject } from "react";
import { buildConversationItem } from "../../../utils/threadItems";
import { asString } from "../utils/threadNormalize";
import type { DebugEntry } from "../../../types";
import type { ThreadAction } from "./useThreadsReducer";
import { isRealtimeBatchingEnabled } from "../utils/realtimePerfFlags";
import {
  applyPendingClaudeMcpOutputNoticeToAgentCompleted,
  applyPendingClaudeMcpOutputNoticeToAgentDelta,
} from "../utils/claudeMcpRuntimeSnapshot";

const CLAUDE_STREAM_DEBUG_FLAG_KEY = "ccgui.debug.claude.stream";

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

function isClaudeThread(threadId: string) {
  return threadId.startsWith("claude:") || threadId.startsWith("claude-pending-");
}

function isGeminiThread(threadId: string) {
  return threadId.startsWith("gemini:") || threadId.startsWith("gemini-pending-");
}

type ReasoningEngineHint = "gemini" | null;

function isGeminiEventThread(
  threadId: string,
  engineHint?: ReasoningEngineHint,
) {
  return engineHint === "gemini" || isGeminiThread(threadId);
}

function inferItemEngineSource(
  item: Record<string, unknown>,
  threadId: string,
): ReasoningEngineHint {
  const rawEngineSource = asString(item.engineSource ?? item.engine_source ?? "")
    .trim()
    .toLowerCase();
  if (rawEngineSource === "gemini") {
    return "gemini";
  }
  return isGeminiThread(threadId) ? "gemini" : null;
}

function shouldIgnoreInterruptedGeminiThread(
  interruptedThreadsRef: MutableRefObject<Set<string>>,
  threadId: string,
) {
  return isGeminiThread(threadId) && interruptedThreadsRef.current.has(threadId);
}

function isClaudeStreamDebugEnabled() {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    const value = window.localStorage.getItem(CLAUDE_STREAM_DEBUG_FLAG_KEY);
    if (!value) {
      return false;
    }
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "on";
  } catch {
    return false;
  }
}

function createDebugPreview(value: string, maxLength = 160) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength)}...`
    : normalized;
}

type UseThreadItemEventsOptions = {
  activeThreadId: string | null;
  dispatch: Dispatch<ThreadAction>;
  getCustomName: (workspaceId: string, threadId: string) => string | undefined;
  resolveCollaborationUiMode?: (
    threadId: string,
  ) => "plan" | "code" | null;
  markProcessing: (threadId: string, isProcessing: boolean) => void;
  markReviewing: (threadId: string, isReviewing: boolean) => void;
  safeMessageActivity: () => void;
  recordThreadActivity: (
    workspaceId: string,
    threadId: string,
    timestamp?: number,
  ) => void;
  applyCollabThreadLinks: (
    threadId: string,
    item: Record<string, unknown>,
  ) => void;
  interruptedThreadsRef: MutableRefObject<Set<string>>;
  onDebug?: (entry: DebugEntry) => void;
  onAgentMessageCompletedExternal?: (payload: {
    workspaceId: string;
    threadId: string;
    itemId: string;
    text: string;
  }) => void;
};

type RealtimeDeltaOperation =
  | {
      kind: "agentDelta";
      workspaceId: string;
      threadId: string;
      itemId: string;
      delta: string;
    }
  | {
      kind: "reasoningSummaryDelta";
      workspaceId: string;
      threadId: string;
      itemId: string;
      delta: string;
      engineHint?: ReasoningEngineHint;
    }
  | {
      kind: "reasoningSummaryBoundary";
      workspaceId: string;
      threadId: string;
      itemId: string;
      engineHint?: ReasoningEngineHint;
    }
  | {
      kind: "reasoningContentDelta";
      workspaceId: string;
      threadId: string;
      itemId: string;
      delta: string;
      engineHint?: ReasoningEngineHint;
    }
  | {
      kind: "toolOutputDelta";
      workspaceId: string;
      threadId: string;
      itemId: string;
      delta: string;
    };

const REALTIME_DELTA_BATCH_FLUSH_MS = 12;

export function useThreadItemEvents({
  activeThreadId,
  dispatch,
  getCustomName,
  resolveCollaborationUiMode,
  markProcessing,
  markReviewing,
  safeMessageActivity,
  recordThreadActivity,
  applyCollabThreadLinks,
  interruptedThreadsRef,
  onDebug,
  onAgentMessageCompletedExternal,
}: UseThreadItemEventsOptions) {
  const enableRealtimeBatchingRef = useRef(isRealtimeBatchingEnabled());
  const pendingRealtimeDeltaOpsRef = useRef<RealtimeDeltaOperation[]>([]);
  const realtimeFlushTimerRef = useRef<number | null>(null);
  const isFlushingRealtimeDeltaOpsRef = useRef(false);

  const logReasoningRoute = useCallback(
    (
      label: string,
      payload: {
        workspaceId: string;
        threadId: string;
        itemId: string;
        deltaLength?: number;
        skipped?: boolean;
        reason?: string;
      },
    ) => {
      onDebug?.({
        id: `${Date.now()}-thread-reasoning-route`,
        timestamp: Date.now(),
        source: "event",
        label: `thread/session:${label}`,
        payload: {
          ...payload,
          activeThreadId,
        },
      });
    },
    [activeThreadId, onDebug],
  );

  const logClaudeStream = useCallback(
    (
      label: string,
      payload: {
        workspaceId: string;
        threadId: string;
        itemId?: string;
        itemType?: string;
        deltaLength?: number;
        textPreview?: string;
        skipped?: boolean;
        reason?: string;
      },
    ) => {
      if (!onDebug || !isClaudeThread(payload.threadId) || !isClaudeStreamDebugEnabled()) {
        return;
      }
      onDebug({
        id: `${Date.now()}-claude-stream-${label}`,
        timestamp: Date.now(),
        source: "event",
        label: `thread/session:claude-stream:${label}`,
        payload: {
          ...payload,
          activeThreadId,
        },
      });
    },
    [activeThreadId, onDebug],
  );

  const applyRealtimeDeltaOperation = useCallback(
    (
      operation: RealtimeDeltaOperation,
      context?: {
        ensuredThreads?: Set<string>;
        markedProcessingThreads?: Set<string>;
      },
    ) => {
      if (shouldIgnoreInterruptedGeminiThread(interruptedThreadsRef, operation.threadId)) {
        return;
      }
      const ensuredThreads = context?.ensuredThreads;
      const markedProcessingThreads = context?.markedProcessingThreads;
      if (!ensuredThreads || !ensuredThreads.has(operation.threadId)) {
        dispatch({
          type: "ensureThread",
          workspaceId: operation.workspaceId,
          threadId: operation.threadId,
          engine: inferEngineFromThreadId(operation.threadId),
        });
        ensuredThreads?.add(operation.threadId);
      }
      const reasoningEngineHint =
        "engineHint" in operation ? operation.engineHint : undefined;
      const isGeminiReasoningDelta =
        isGeminiEventThread(operation.threadId, reasoningEngineHint) &&
        (operation.kind === "reasoningSummaryDelta" ||
          operation.kind === "reasoningSummaryBoundary" ||
          operation.kind === "reasoningContentDelta");
      if (
        !isGeminiReasoningDelta &&
        (!markedProcessingThreads || !markedProcessingThreads.has(operation.threadId))
      ) {
        markProcessing(operation.threadId, true);
        markedProcessingThreads?.add(operation.threadId);
      }

      if (operation.kind === "agentDelta") {
        dispatch({
          type: "appendAgentDelta",
          workspaceId: operation.workspaceId,
          threadId: operation.threadId,
          itemId: operation.itemId,
          delta: operation.delta,
          hasCustomName: Boolean(getCustomName(operation.workspaceId, operation.threadId)),
        });
        return;
      }
      if (operation.kind === "reasoningSummaryDelta") {
        dispatch({
          type: "appendReasoningSummary",
          threadId: operation.threadId,
          itemId: operation.itemId,
          delta: operation.delta,
        });
        return;
      }
      if (operation.kind === "reasoningSummaryBoundary") {
        dispatch({
          type: "appendReasoningSummaryBoundary",
          threadId: operation.threadId,
          itemId: operation.itemId,
        });
        return;
      }
      if (operation.kind === "reasoningContentDelta") {
        dispatch({
          type: "appendReasoningContent",
          threadId: operation.threadId,
          itemId: operation.itemId,
          delta: operation.delta,
        });
        return;
      }

      dispatch({
        type: "appendToolOutput",
        threadId: operation.threadId,
        itemId: operation.itemId,
        delta: operation.delta,
      });
    },
    [dispatch, getCustomName, interruptedThreadsRef, markProcessing],
  );

  const flushRealtimeDeltaOps = useCallback(() => {
    if (!enableRealtimeBatchingRef.current) {
      return;
    }
    if (isFlushingRealtimeDeltaOpsRef.current) {
      return;
    }
    if (realtimeFlushTimerRef.current !== null) {
      window.clearTimeout(realtimeFlushTimerRef.current);
      realtimeFlushTimerRef.current = null;
    }
    if (pendingRealtimeDeltaOpsRef.current.length === 0) {
      return;
    }
    isFlushingRealtimeDeltaOpsRef.current = true;
    try {
      const bufferedOps = pendingRealtimeDeltaOpsRef.current;
      pendingRealtimeDeltaOpsRef.current = [];
      const ensuredThreads = new Set<string>();
      const markedProcessingThreads = new Set<string>();
      for (const operation of bufferedOps) {
        applyRealtimeDeltaOperation(operation, {
          ensuredThreads,
          markedProcessingThreads,
        });
      }
      safeMessageActivity();
    } finally {
      isFlushingRealtimeDeltaOpsRef.current = false;
    }
  }, [applyRealtimeDeltaOperation, safeMessageActivity]);

  const enqueueRealtimeDeltaOperation = useCallback(
    (operation: RealtimeDeltaOperation) => {
      if (operation.kind === "agentDelta" && isGeminiThread(operation.threadId)) {
        applyRealtimeDeltaOperation(operation);
        safeMessageActivity();
        return;
      }
      if (!enableRealtimeBatchingRef.current) {
        applyRealtimeDeltaOperation(operation);
        safeMessageActivity();
        return;
      }
      pendingRealtimeDeltaOpsRef.current.push(operation);
      if (realtimeFlushTimerRef.current !== null) {
        return;
      }
      realtimeFlushTimerRef.current = window.setTimeout(() => {
        flushRealtimeDeltaOps();
      }, REALTIME_DELTA_BATCH_FLUSH_MS);
    },
    [applyRealtimeDeltaOperation, flushRealtimeDeltaOps, safeMessageActivity],
  );

  useEffect(
    () => () => {
      flushRealtimeDeltaOps();
      if (realtimeFlushTimerRef.current !== null) {
        window.clearTimeout(realtimeFlushTimerRef.current);
        realtimeFlushTimerRef.current = null;
      }
      pendingRealtimeDeltaOpsRef.current = [];
    },
    [],
  );

  const handleItemUpdate = useCallback(
    (
      workspaceId: string,
      threadId: string,
      item: Record<string, unknown>,
      shouldMarkProcessing: boolean,
      shouldIncrementAgentSegment: boolean,
    ) => {
      if (shouldIgnoreInterruptedGeminiThread(interruptedThreadsRef, threadId)) {
        return;
      }
      flushRealtimeDeltaOps();
      dispatch({ type: "ensureThread", workspaceId, threadId, engine: inferEngineFromThreadId(threadId) });
      const itemType = asString(item?.type ?? "");
      const itemId = asString(item?.id ?? "");
      const itemEngineSource = inferItemEngineSource(item, threadId);
      const shouldSuppressGeminiReasoningProcessing =
        itemType === "reasoning" && itemEngineSource === "gemini";
      if (shouldMarkProcessing && !shouldSuppressGeminiReasoningProcessing) {
        markProcessing(threadId, true);
      }
      applyCollabThreadLinks(threadId, item);
      const agentMessageSnapshotText = asString(
        item?.text ?? item?.content ?? item?.output_text ?? item?.outputText ?? "",
      );
      if (
        itemType === "agentMessage" ||
        itemType === "reasoning"
      ) {
        logClaudeStream("item-snapshot", {
          workspaceId,
          threadId,
          itemId,
          itemType,
          deltaLength: agentMessageSnapshotText.length,
          textPreview: createDebugPreview(agentMessageSnapshotText),
        });
      }
      if (itemType === "enteredReviewMode") {
        markReviewing(threadId, true);
      } else if (itemType === "exitedReviewMode") {
        markReviewing(threadId, false);
        markProcessing(threadId, false);
      }

      // 当 tool item 开始时，增加分段计数，确保后续文本创建新的 message
      // 这样可以实现文本和工具调用交替显示
      const isToolItem = [
        "commandExecution",
        "fileChange",
        "mcpToolCall",
        "collabToolCall",
        "collabAgentToolCall",
        "webSearch",
        "imageView",
      ].includes(itemType);
      if (shouldMarkProcessing && shouldIncrementAgentSegment && isToolItem) {
        dispatch({ type: "incrementAgentSegment", threadId });
      }

      if (itemType === "agentMessage") {
        if (agentMessageSnapshotText) {
          dispatch({
            type: "appendAgentDelta",
            workspaceId,
            threadId,
            itemId,
            delta: agentMessageSnapshotText,
            hasCustomName: Boolean(getCustomName(workspaceId, threadId)),
          });
          logClaudeStream("agent-snapshot-routed", {
            workspaceId,
            threadId,
            itemId,
            itemType,
            deltaLength: agentMessageSnapshotText.length,
            textPreview: createDebugPreview(agentMessageSnapshotText),
          });
        }
        safeMessageActivity();
        return;
      }

      const converted = buildConversationItem(item);
      if (converted) {
        const itemEngineSource = asString(
          item.engineSource ?? item.engine_source ?? "",
        )
          .trim()
          .toLowerCase();
        const normalizedConverted =
          itemEngineSource === "claude" ||
          itemEngineSource === "gemini" ||
          itemEngineSource === "opencode" ||
          itemEngineSource === "codex"
            ? {
                ...converted,
                engineSource: itemEngineSource as "claude" | "codex" | "gemini" | "opencode",
              }
            : converted;
        const threadEngine = inferEngineFromThreadId(threadId);
        // Claude reasoning should converge to the persisted history shape.
        // Accept snapshot items so final/live state can be enriched by the
        // server snapshot instead of staying delta-only.
        if (threadEngine === "claude" && normalizedConverted.kind === "reasoning") {
          logReasoningRoute("reasoning-snapshot-accepted", {
            workspaceId,
            threadId,
            itemId: normalizedConverted.id,
            skipped: false,
            reason: "claude-snapshot-enriches-live-state",
          });
          logClaudeStream("reasoning-snapshot-upsert", {
            workspaceId,
            threadId,
            itemId: normalizedConverted.id,
            itemType,
            deltaLength: `${normalizedConverted.summary}${normalizedConverted.content}`.length,
            textPreview: createDebugPreview(
              normalizedConverted.content || normalizedConverted.summary || "",
            ),
          });
        }
        const normalizedItem =
          normalizedConverted.kind === "message" &&
          normalizedConverted.role === "user" &&
          !normalizedConverted.collaborationMode
            ? {
                ...normalizedConverted,
                collaborationMode: resolveCollaborationUiMode?.(threadId) ?? null,
              }
            : normalizedConverted;
        dispatch({
          type: "upsertItem",
          workspaceId,
          threadId,
          item: normalizedItem,
          hasCustomName: Boolean(getCustomName(workspaceId, threadId)),
        });
      }
      safeMessageActivity();
    },
    [
      applyCollabThreadLinks,
      dispatch,
      flushRealtimeDeltaOps,
      getCustomName,
      interruptedThreadsRef,
      logReasoningRoute,
      markProcessing,
      markReviewing,
      resolveCollaborationUiMode,
      safeMessageActivity,
    ],
  );

  const handleToolOutputDelta = useCallback(
    (
      workspaceId: string,
      threadId: string,
      itemId: string,
      delta: string,
    ) => {
      enqueueRealtimeDeltaOperation({
        kind: "toolOutputDelta",
        workspaceId,
        threadId,
        itemId,
        delta,
      });
    },
    [enqueueRealtimeDeltaOperation],
  );

  const handleTerminalInteraction = useCallback(
    (workspaceId: string, threadId: string, itemId: string, stdin: string) => {
      if (!stdin) {
        return;
      }
      const normalized = stdin.replace(/\r\n/g, "\n");
      const suffix = normalized.endsWith("\n") ? "" : "\n";
      handleToolOutputDelta(
        workspaceId,
        threadId,
        itemId,
        `\n[stdin]\n${normalized}${suffix}`,
      );
    },
    [handleToolOutputDelta],
  );

  const onAgentMessageDelta = useCallback(
    ({
      workspaceId,
      threadId,
      itemId,
      delta,
    }: {
      workspaceId: string;
      threadId: string;
      itemId: string;
      delta: string;
    }) => {
      // Skip late-arriving deltas for threads that have been interrupted
      if (interruptedThreadsRef.current.has(threadId)) {
        logClaudeStream("agent-delta-skipped", {
          workspaceId,
          threadId,
          itemId,
          deltaLength: delta.length,
          textPreview: createDebugPreview(delta),
          skipped: true,
          reason: "interrupted-thread",
        });
        return;
      }
      const resolvedDelta = applyPendingClaudeMcpOutputNoticeToAgentDelta(
        workspaceId,
        threadId,
        delta,
      );
      enqueueRealtimeDeltaOperation({
        kind: "agentDelta",
        workspaceId,
        threadId,
        itemId,
        delta: resolvedDelta,
      });
      logClaudeStream("agent-delta", {
        workspaceId,
        threadId,
        itemId,
        deltaLength: resolvedDelta.length,
        textPreview: createDebugPreview(resolvedDelta),
      });
    },
    [enqueueRealtimeDeltaOperation, interruptedThreadsRef, logClaudeStream],
  );

  const onAgentMessageCompleted = useCallback(
    ({
      workspaceId,
      threadId,
      itemId,
      text,
    }: {
      workspaceId: string;
      threadId: string;
      itemId: string;
      text: string;
    }) => {
      if (shouldIgnoreInterruptedGeminiThread(interruptedThreadsRef, threadId)) {
        return;
      }
      const resolvedText = applyPendingClaudeMcpOutputNoticeToAgentCompleted(
        workspaceId,
        threadId,
        text,
      );
      flushRealtimeDeltaOps();
      const timestamp = Date.now();
      dispatch({ type: "ensureThread", workspaceId, threadId, engine: inferEngineFromThreadId(threadId) });
      const hasCustomName = Boolean(getCustomName(workspaceId, threadId));
      dispatch({
        type: "completeAgentMessage",
        workspaceId,
        threadId,
        itemId,
        text: resolvedText,
        hasCustomName,
        timestamp,
      });
      dispatch({
        type: "setThreadTimestamp",
        workspaceId,
        threadId,
        timestamp,
      });
      dispatch({
        type: "setLastAgentMessage",
        threadId,
        text: resolvedText,
        timestamp,
      });
      recordThreadActivity(workspaceId, threadId, timestamp);
      safeMessageActivity();
      if (threadId !== activeThreadId) {
        dispatch({ type: "markUnread", threadId, hasUnread: true });
      }
      onAgentMessageCompletedExternal?.({
        workspaceId,
        threadId,
        itemId,
        text: resolvedText,
      });
      logClaudeStream("agent-completed", {
        workspaceId,
        threadId,
        itemId,
        deltaLength: resolvedText.length,
        textPreview: createDebugPreview(resolvedText),
      });
    },
    [
      activeThreadId,
      dispatch,
      flushRealtimeDeltaOps,
      getCustomName,
      logClaudeStream,
      onAgentMessageCompletedExternal,
      recordThreadActivity,
      safeMessageActivity,
      interruptedThreadsRef,
    ],
  );

  const onItemStarted = useCallback(
    (workspaceId: string, threadId: string, item: Record<string, unknown>) => {
      handleItemUpdate(workspaceId, threadId, item, true, true);
    },
    [handleItemUpdate],
  );

  const onItemUpdated = useCallback(
    (workspaceId: string, threadId: string, item: Record<string, unknown>) => {
      handleItemUpdate(workspaceId, threadId, item, true, false);
    },
    [handleItemUpdate],
  );

  const onItemCompleted = useCallback(
    (workspaceId: string, threadId: string, item: Record<string, unknown>) => {
      handleItemUpdate(workspaceId, threadId, item, false, false);
    },
    [handleItemUpdate],
  );

  const onReasoningSummaryDelta = useCallback(
    (
      workspaceId: string,
      threadId: string,
      itemId: string,
      delta: string,
      engineHint?: ReasoningEngineHint,
    ) => {
      logReasoningRoute("reasoning-summary-delta", {
        workspaceId,
        threadId,
        itemId,
        deltaLength: delta.length,
      });
      if (interruptedThreadsRef.current.has(threadId)) {
        logClaudeStream("reasoning-summary-delta-skipped", {
          workspaceId,
          threadId,
          itemId,
          deltaLength: delta.length,
          textPreview: createDebugPreview(delta),
          skipped: true,
          reason: "interrupted-thread",
        });
        return;
      }
      enqueueRealtimeDeltaOperation({
        kind: "reasoningSummaryDelta",
        workspaceId,
        threadId,
        itemId,
        delta,
        engineHint,
      });
      logClaudeStream("reasoning-summary-delta", {
        workspaceId,
        threadId,
        itemId,
        deltaLength: delta.length,
        textPreview: createDebugPreview(delta),
      });
    },
    [enqueueRealtimeDeltaOperation, interruptedThreadsRef, logClaudeStream, logReasoningRoute],
  );

  const onReasoningSummaryBoundary = useCallback(
    (
      workspaceId: string,
      threadId: string,
      itemId: string,
      engineHint?: ReasoningEngineHint,
    ) => {
      logReasoningRoute("reasoning-summary-boundary", {
        workspaceId,
        threadId,
        itemId,
      });
      if (interruptedThreadsRef.current.has(threadId)) {
        logClaudeStream("reasoning-summary-boundary-skipped", {
          workspaceId,
          threadId,
          itemId,
          skipped: true,
          reason: "interrupted-thread",
        });
        return;
      }
      enqueueRealtimeDeltaOperation({
        kind: "reasoningSummaryBoundary",
        workspaceId,
        threadId,
        itemId,
        engineHint,
      });
      logClaudeStream("reasoning-summary-boundary", {
        workspaceId,
        threadId,
        itemId,
      });
    },
    [enqueueRealtimeDeltaOperation, interruptedThreadsRef, logClaudeStream, logReasoningRoute],
  );

  const onReasoningTextDelta = useCallback(
    (
      workspaceId: string,
      threadId: string,
      itemId: string,
      delta: string,
      engineHint?: ReasoningEngineHint,
    ) => {
      logReasoningRoute("reasoning-text-delta", {
        workspaceId,
        threadId,
        itemId,
        deltaLength: delta.length,
      });
      if (interruptedThreadsRef.current.has(threadId)) {
        logClaudeStream("reasoning-text-delta-skipped", {
          workspaceId,
          threadId,
          itemId,
          deltaLength: delta.length,
          textPreview: createDebugPreview(delta),
          skipped: true,
          reason: "interrupted-thread",
        });
        return;
      }
      enqueueRealtimeDeltaOperation({
        kind: "reasoningContentDelta",
        workspaceId,
        threadId,
        itemId,
        delta,
        engineHint,
      });
      logClaudeStream("reasoning-text-delta", {
        workspaceId,
        threadId,
        itemId,
        deltaLength: delta.length,
        textPreview: createDebugPreview(delta),
      });
    },
    [enqueueRealtimeDeltaOperation, interruptedThreadsRef, logClaudeStream, logReasoningRoute],
  );

  const onCommandOutputDelta = useCallback(
    (workspaceId: string, threadId: string, itemId: string, delta: string) => {
      handleToolOutputDelta(workspaceId, threadId, itemId, delta);
    },
    [handleToolOutputDelta],
  );

  const onTerminalInteraction = useCallback(
    (workspaceId: string, threadId: string, itemId: string, stdin: string) => {
      handleTerminalInteraction(workspaceId, threadId, itemId, stdin);
    },
    [handleTerminalInteraction],
  );

  const onFileChangeOutputDelta = useCallback(
    (workspaceId: string, threadId: string, itemId: string, delta: string) => {
      handleToolOutputDelta(workspaceId, threadId, itemId, delta);
    },
    [handleToolOutputDelta],
  );

  return {
    onAgentMessageDelta,
    onAgentMessageCompleted,
    onItemStarted,
    onItemUpdated,
    onItemCompleted,
    onReasoningSummaryDelta,
    onReasoningSummaryBoundary,
    onReasoningTextDelta,
    onCommandOutputDelta,
    onTerminalInteraction,
    onFileChangeOutputDelta,
  };
}
