import { useCallback, useMemo } from "react";
import type { Dispatch, MutableRefObject } from "react";
import type {
  AppServerEvent,
  CollaborationModeBlockedRequest,
  CollaborationModeResolvedRequest,
  DebugEntry,
  RequestUserInputRequest,
} from "../../../types";
import { useThreadApprovalEvents } from "./useThreadApprovalEvents";
import { useThreadItemEvents } from "./useThreadItemEvents";
import { useThreadTurnEvents } from "./useThreadTurnEvents";
import { useThreadUserInputEvents } from "./useThreadUserInputEvents";
import { stripBackendErrorPrefix } from "../utils/networkErrors";
import type { ThreadAction } from "./useThreadsReducer";
import { isDebugLightPathEnabled } from "../utils/realtimePerfFlags";

type ThreadEventHandlersOptions = {
  activeThreadId: string | null;
  dispatch: Dispatch<ThreadAction>;
  getCustomName: (workspaceId: string, threadId: string) => string | undefined;
  resolveCollaborationUiMode?: (
    threadId: string,
  ) => "plan" | "code" | null;
  isAutoTitlePending: (workspaceId: string, threadId: string) => boolean;
  isThreadHidden: (workspaceId: string, threadId: string) => boolean;
  markProcessing: (threadId: string, isProcessing: boolean) => void;
  markReviewing: (threadId: string, isReviewing: boolean) => void;
  setActiveTurnId: (threadId: string, turnId: string | null) => void;
  safeMessageActivity: () => void;
  recordThreadActivity: (
    workspaceId: string,
    threadId: string,
    timestamp?: number,
  ) => void;
  pushThreadErrorMessage: (threadId: string, message: string) => void;
  onDebug?: (entry: DebugEntry) => void;
  onWorkspaceConnected: (workspaceId: string) => void;
  applyCollabThreadLinks: (
    threadId: string,
    item: Record<string, unknown>,
  ) => void;
  approvalAllowlistRef: MutableRefObject<Record<string, string[][]>>;
  pendingInterruptsRef: MutableRefObject<Set<string>>;
  interruptedThreadsRef: MutableRefObject<Set<string>>;
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
  onAgentMessageCompletedExternal?: (payload: {
    workspaceId: string;
    threadId: string;
    itemId: string;
    text: string;
  }) => void;
  onCollaborationModeResolved?: (
    event: CollaborationModeResolvedRequest,
  ) => void;
};

function isThreadSessionMirrorEnabled() {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    const value = window.localStorage.getItem("mossx.debug.threadSessionMirror");
    if (!value) {
      return false;
    }
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "on";
  } catch {
    return false;
  }
}

function shouldEmitServerDebugEntry(method: string) {
  if (!isDebugLightPathEnabled()) {
    return true;
  }
  return (
    method === "error" ||
    method === "turn/error" ||
    method === "codex/stderr" ||
    method === "turn/started" ||
    method === "turn/completed" ||
    method === "thread/started" ||
    method === "thread/compacting" ||
    method === "thread/compacted" ||
    method === "thread/compactionFailed" ||
    method.includes("warn") ||
    method.includes("warning")
  );
}

export function useThreadEventHandlers({
  activeThreadId,
  dispatch,
  getCustomName,
  resolveCollaborationUiMode,
  isAutoTitlePending,
  isThreadHidden,
  markProcessing,
  markReviewing,
  setActiveTurnId,
  safeMessageActivity,
  recordThreadActivity,
  pushThreadErrorMessage,
  onDebug,
  onWorkspaceConnected,
  applyCollabThreadLinks,
  approvalAllowlistRef,
  pendingInterruptsRef,
  interruptedThreadsRef,
  renameCustomNameKey,
  renameAutoTitlePendingKey,
  renameThreadTitleMapping,
  resolvePendingThreadForSession,
  renamePendingMemoryCaptureKey,
  onAgentMessageCompletedExternal,
  onCollaborationModeResolved,
}: ThreadEventHandlersOptions) {
  const isReasoningRawDebugEnabled = () => {
    if (import.meta.env?.DEV) {
      try {
        const value = window.localStorage.getItem("mossx.debug.reasoning.raw");
        if (!value) {
          return true;
        }
        const normalized = value.trim().toLowerCase();
        return !(normalized === "0" || normalized === "false" || normalized === "off");
      } catch {
        return true;
      }
    }
    if (typeof window === "undefined") {
      return false;
    }
    try {
      const value = window.localStorage.getItem("mossx.debug.reasoning.raw");
      if (!value) {
        return false;
      }
      const normalized = value.trim().toLowerCase();
      return normalized === "1" || normalized === "true" || normalized === "on";
    } catch {
      return false;
    }
  };

  const onApprovalRequest = useThreadApprovalEvents({
    dispatch,
    approvalAllowlistRef,
  });
  const enqueueUserInputRequest = useThreadUserInputEvents({ dispatch });
  const onRequestUserInput = useCallback(
    (request: RequestUserInputRequest) => {
      enqueueUserInputRequest(request);
      const threadId = request.params.thread_id;
      if (!threadId) {
        return;
      }
      // requestUserInput means the turn is now waiting for user choice,
      // so we should stop the spinning "processing" state immediately.
      markProcessing(threadId, false);
      setActiveTurnId(threadId, null);
      dispatch({
        type: "settleThreadPlanInProgress",
        threadId,
        targetStatus: "pending",
      });
    },
    [dispatch, enqueueUserInputRequest, markProcessing, setActiveTurnId],
  );
  const onModeBlocked = useCallback(
    (event: CollaborationModeBlockedRequest) => {
      const threadId = event.params.thread_id;
      if (!threadId) {
        return;
      }
      const requestId = event.params.request_id;
      if (requestId !== null && requestId !== undefined) {
        dispatch({
          type: "removeUserInputRequest",
          requestId,
          workspaceId: event.workspace_id,
        });
      }
      const reason =
        event.params.reason.trim() ||
        "This request is blocked while effective mode is code.";
      const suggestion =
        (event.params.suggestion ?? "").trim() ||
        "Switch to Plan mode and retry if user input is required.";
      const blockedMethod = event.params.blocked_method || "item/tool/requestUserInput";
      const blockedTitle = blockedMethod.includes("requestUserInput")
        ? "Tool: askuserquestion"
        : "Tool: mode policy";
      const eventId = requestId !== null && requestId !== undefined
        ? String(requestId)
        : `${Date.now()}`;
      dispatch({
        type: "upsertItem",
        workspaceId: event.workspace_id,
        threadId,
        item: {
          id: `mode-blocked-${threadId}-${eventId}`,
          kind: "tool",
          toolType: "modeBlocked",
          title: blockedTitle,
          detail: blockedMethod,
          status: "completed",
          output: `${reason}\n\n${suggestion}`,
        },
        hasCustomName: Boolean(getCustomName(event.workspace_id, threadId)),
      });
    },
    [dispatch, getCustomName],
  );

  const onModeResolved = useCallback(
    (event: CollaborationModeResolvedRequest) => {
      onCollaborationModeResolved?.(event);
    },
    [onCollaborationModeResolved],
  );

  const {
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
  } = useThreadItemEvents({
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
  });

  const {
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
  } = useThreadTurnEvents({
    activeThreadId,
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
  });

  const onBackgroundThreadAction = useCallback(
    (workspaceId: string, threadId: string, action: string) => {
      if (action !== "hide") {
        return;
      }
      dispatch({ type: "hideThread", workspaceId, threadId });
    },
    [dispatch],
  );

  const onProcessingHeartbeat = useCallback(
    (_workspaceId: string, threadId: string, pulse: number) => {
      if (!threadId || pulse <= 0) {
        return;
      }
      dispatch({ type: "markHeartbeat", threadId, pulse });
      safeMessageActivity();
    },
    [dispatch, safeMessageActivity],
  );

  const onAppServerEvent = useCallback(
    (event: AppServerEvent) => {
      const method = String(event.message?.method ?? "");
      const params = (event.message?.params as Record<string, unknown> | undefined) ?? {};
      const inferredSource = method === "codex/stderr" ? "stderr" : "event";
      const mirrorEnabled = isThreadSessionMirrorEnabled();
      if (onDebug && (mirrorEnabled || shouldEmitServerDebugEntry(method))) {
        onDebug({
          id: `${Date.now()}-server-event`,
          timestamp: Date.now(),
          source: inferredSource,
          label: method || "event",
          payload: mirrorEnabled
            ? event
            : {
                workspaceId: event.workspace_id,
                method: method || "event",
                threadId: String(params.threadId ?? params.thread_id ?? ""),
                turnId: String(params.turnId ?? params.turn_id ?? ""),
              },
        });
      }

      if (method === "codex/stderr") {
        const rawMessage = String(params.message ?? "").trim();
        if (onDebug && isReasoningRawDebugEnabled() && rawMessage) {
          onDebug({
            id: `${Date.now()}-stderr-raw`,
            timestamp: Date.now(),
            source: "stderr",
            label: "stderr/raw",
            payload: stripBackendErrorPrefix(rawMessage),
          });
        }
      }

      if (!onDebug || !isReasoningRawDebugEnabled()) {
        return;
      }

      if (
        method !== "item/started" &&
        method !== "item/updated" &&
        method !== "item/completed" &&
        method !== "item/reasoning/summaryTextDelta" &&
        method !== "item/reasoning/summaryPartAdded" &&
        method !== "item/reasoning/textDelta" &&
        method !== "item/reasoning/delta" &&
        method !== "response.reasoning_summary_text.delta" &&
        method !== "response.reasoning_summary_text.done" &&
        method !== "response.reasoning_summary.delta" &&
        method !== "response.reasoning_summary.done" &&
        method !== "response.reasoning_summary_part.added" &&
        method !== "response.reasoning_summary_part.done" &&
        method !== "response.reasoning_text.delta" &&
        method !== "response.reasoning_text.done"
      ) {
        return;
      }

      if (
        method === "item/reasoning/summaryTextDelta" ||
        method === "item/reasoning/summaryPartAdded" ||
        method === "item/reasoning/textDelta" ||
        method === "item/reasoning/delta" ||
        method === "response.reasoning_summary_text.delta" ||
        method === "response.reasoning_summary_text.done" ||
        method === "response.reasoning_summary.delta" ||
        method === "response.reasoning_summary.done" ||
        method === "response.reasoning_summary_part.added" ||
        method === "response.reasoning_summary_part.done" ||
        method === "response.reasoning_text.delta" ||
        method === "response.reasoning_text.done"
      ) {
        onDebug({
          id: `${Date.now()}-reasoning-raw`,
          timestamp: Date.now(),
          source: "event",
          label: `reasoning/raw:${method}`,
          payload: {
            workspaceId: event.workspace_id,
            threadId: String(params.threadId ?? params.thread_id ?? ""),
            itemId: String(params.itemId ?? params.item_id ?? ""),
            delta: params.delta ?? null,
            summaryIndex: params.summaryIndex ?? params.summary_index ?? null,
            params,
          },
        });
        return;
      }
      const item = (params.item as Record<string, unknown> | undefined) ?? {};
      if (String(item.type ?? "") !== "reasoning") {
        return;
      }

      onDebug({
        id: `${Date.now()}-reasoning-raw`,
        timestamp: Date.now(),
        source: "event",
        label: `reasoning/raw:${method}`,
        payload: {
          workspaceId: event.workspace_id,
          threadId: String(params.threadId ?? params.thread_id ?? ""),
          itemId: String(item.id ?? ""),
          summary: item.summary ?? null,
          content: item.content ?? null,
          text: item.text ?? null,
          rawItem: item,
        },
      });
    },
    [
      onDebug,
    ],
  );

  const handlers = useMemo(
    () => ({
      onWorkspaceConnected,
      onApprovalRequest,
      onRequestUserInput,
      onModeBlocked,
      onModeResolved,
      onBackgroundThreadAction,
      onAppServerEvent,
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
      onThreadStarted,
      onTurnStarted,
      onTurnCompleted,
      onProcessingHeartbeat,
      onTurnPlanUpdated,
      onThreadTokenUsageUpdated,
      onAccountRateLimitsUpdated,
      onTurnError,
      onContextCompacting,
      onContextCompacted,
      onContextCompactionFailed,
      onThreadSessionIdUpdated,
    }),
    [
      onWorkspaceConnected,
      onApprovalRequest,
      onRequestUserInput,
      onModeBlocked,
      onModeResolved,
      onBackgroundThreadAction,
      onAppServerEvent,
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
      onThreadStarted,
      onTurnStarted,
      onTurnCompleted,
      onProcessingHeartbeat,
      onTurnPlanUpdated,
      onThreadTokenUsageUpdated,
      onAccountRateLimitsUpdated,
      onTurnError,
      onContextCompacting,
      onContextCompacted,
      onContextCompactionFailed,
      onThreadSessionIdUpdated,
      onCollaborationModeResolved,
    ],
  );

  return handlers;
}
