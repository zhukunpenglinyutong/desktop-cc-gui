import { useCallback } from "react";
import type { Dispatch, MutableRefObject } from "react";
import { buildConversationItem } from "../../../utils/threadItems";
import { asString } from "../utils/threadNormalize";
import type { DebugEntry } from "../../../types";
import type { ThreadAction } from "./useThreadsReducer";

const CLAUDE_STREAM_DEBUG_FLAG_KEY = "mossx.debug.claude.stream";

/**
 * Infer engine type from thread ID.
 * Claude/OpenCode threads use "<engine>:" or "<engine>-pending-" prefixes.
 */
function inferEngineFromThreadId(threadId: string): "claude" | "codex" | "opencode" {
  if (threadId.startsWith("claude:") || threadId.startsWith("claude-pending-")) {
    return "claude";
  }
  if (threadId.startsWith("opencode:") || threadId.startsWith("opencode-pending-")) {
    return "opencode";
  }
  return "codex";
}

function isClaudeThread(threadId: string) {
  return threadId.startsWith("claude:") || threadId.startsWith("claude-pending-");
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

  const handleItemUpdate = useCallback(
    (
      workspaceId: string,
      threadId: string,
      item: Record<string, unknown>,
      shouldMarkProcessing: boolean,
      shouldIncrementAgentSegment: boolean,
    ) => {
      dispatch({ type: "ensureThread", workspaceId, threadId, engine: inferEngineFromThreadId(threadId) });
      if (shouldMarkProcessing) {
        markProcessing(threadId, true);
      }
      applyCollabThreadLinks(threadId, item);
      const itemType = asString(item?.type ?? "");
      const itemId = asString(item?.id ?? "");
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
        const threadEngine = inferEngineFromThreadId(threadId);
        // Claude reasoning should converge to the persisted history shape.
        // Accept snapshot items so final/live state can be enriched by the
        // server snapshot instead of staying delta-only.
        if (threadEngine === "claude" && converted.kind === "reasoning") {
          logReasoningRoute("reasoning-snapshot-accepted", {
            workspaceId,
            threadId,
            itemId: converted.id,
            skipped: false,
            reason: "claude-snapshot-enriches-live-state",
          });
          logClaudeStream("reasoning-snapshot-upsert", {
            workspaceId,
            threadId,
            itemId: converted.id,
            itemType,
            deltaLength: `${converted.summary}${converted.content}`.length,
            textPreview: createDebugPreview(
              converted.content || converted.summary || "",
            ),
          });
        }
        const normalizedItem =
          converted.kind === "message" &&
          converted.role === "user" &&
          !converted.collaborationMode
            ? {
                ...converted,
                collaborationMode: resolveCollaborationUiMode?.(threadId) ?? null,
              }
            : converted;
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
      getCustomName,
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
      dispatch({
        type: "ensureThread",
        workspaceId,
        threadId,
        engine: inferEngineFromThreadId(threadId),
      });
      markProcessing(threadId, true);
      dispatch({ type: "appendToolOutput", threadId, itemId, delta });
      safeMessageActivity();
    },
    [dispatch, markProcessing, safeMessageActivity],
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
      dispatch({ type: "ensureThread", workspaceId, threadId, engine: inferEngineFromThreadId(threadId) });
      markProcessing(threadId, true);
      const hasCustomName = Boolean(getCustomName(workspaceId, threadId));
      dispatch({
        type: "appendAgentDelta",
        workspaceId,
        threadId,
        itemId,
        delta,
        hasCustomName,
      });
      logClaudeStream("agent-delta", {
        workspaceId,
        threadId,
        itemId,
        deltaLength: delta.length,
        textPreview: createDebugPreview(delta),
      });
      safeMessageActivity();
    },
    [dispatch, getCustomName, interruptedThreadsRef, logClaudeStream, markProcessing, safeMessageActivity],
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
      const timestamp = Date.now();
      dispatch({ type: "ensureThread", workspaceId, threadId, engine: inferEngineFromThreadId(threadId) });
      const hasCustomName = Boolean(getCustomName(workspaceId, threadId));
      dispatch({
        type: "completeAgentMessage",
        workspaceId,
        threadId,
        itemId,
        text,
        hasCustomName,
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
        text,
        timestamp,
      });
      recordThreadActivity(workspaceId, threadId, timestamp);
      safeMessageActivity();
      if (threadId !== activeThreadId) {
        dispatch({ type: "markUnread", threadId, hasUnread: true });
      }
      onAgentMessageCompletedExternal?.({ workspaceId, threadId, itemId, text });
      logClaudeStream("agent-completed", {
        workspaceId,
        threadId,
        itemId,
        deltaLength: text.length,
        textPreview: createDebugPreview(text),
      });
    },
    [
      activeThreadId,
      dispatch,
      getCustomName,
      logClaudeStream,
      onAgentMessageCompletedExternal,
      recordThreadActivity,
      safeMessageActivity,
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
    (workspaceId: string, threadId: string, itemId: string, delta: string) => {
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
      dispatch({ type: "ensureThread", workspaceId, threadId, engine: inferEngineFromThreadId(threadId) });
      markProcessing(threadId, true);
      dispatch({ type: "appendReasoningSummary", threadId, itemId, delta });
      logClaudeStream("reasoning-summary-delta", {
        workspaceId,
        threadId,
        itemId,
        deltaLength: delta.length,
        textPreview: createDebugPreview(delta),
      });
      safeMessageActivity();
    },
    [dispatch, interruptedThreadsRef, logClaudeStream, logReasoningRoute, markProcessing, safeMessageActivity],
  );

  const onReasoningSummaryBoundary = useCallback(
    (workspaceId: string, threadId: string, itemId: string) => {
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
      dispatch({ type: "ensureThread", workspaceId, threadId, engine: inferEngineFromThreadId(threadId) });
      markProcessing(threadId, true);
      dispatch({ type: "appendReasoningSummaryBoundary", threadId, itemId });
      logClaudeStream("reasoning-summary-boundary", {
        workspaceId,
        threadId,
        itemId,
      });
      safeMessageActivity();
    },
    [dispatch, interruptedThreadsRef, logClaudeStream, logReasoningRoute, markProcessing, safeMessageActivity],
  );

  const onReasoningTextDelta = useCallback(
    (workspaceId: string, threadId: string, itemId: string, delta: string) => {
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
      dispatch({ type: "ensureThread", workspaceId, threadId, engine: inferEngineFromThreadId(threadId) });
      markProcessing(threadId, true);
      dispatch({ type: "appendReasoningContent", threadId, itemId, delta });
      logClaudeStream("reasoning-text-delta", {
        workspaceId,
        threadId,
        itemId,
        deltaLength: delta.length,
        textPreview: createDebugPreview(delta),
      });
      safeMessageActivity();
    },
    [dispatch, interruptedThreadsRef, logClaudeStream, logReasoningRoute, markProcessing, safeMessageActivity],
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
