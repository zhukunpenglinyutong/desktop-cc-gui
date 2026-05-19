import { useCallback, useEffect, useMemo, useRef } from "react";
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
import { parseFirstPacketTimeoutSeconds, stripBackendErrorPrefix } from "../utils/networkErrors";
import { captureClaudeMcpRuntimeSnapshotFromRaw } from "../utils/claudeMcpRuntimeSnapshot";
import { buildThreadDebugCorrelation } from "../utils/threadDebugCorrelation";
import type { ThreadAction } from "./useThreadsReducer";
import type {
  ConversationEngine,
  NormalizedThreadEvent,
} from "../contracts/conversationCurtainContracts";
import {
  buildThreadStreamCorrelationDimensions,
  completeThreadStreamTurn,
  noteThreadDeltaReceived,
  noteThreadTextIngressReceived,
  noteThreadTurnStarted,
  reportThreadUpstreamPending,
  type StreamIngressSource,
} from "../utils/streamLatencyDiagnostics";
import {
  buildCodexLivenessDiagnostic,
} from "../utils/codexConversationLiveness";
import {
  TURN_FIRST_DELTA_WARNING_MS,
  TURN_STALL_WARNING_MS,
  applyActiveExecutionItemEvent,
  asString,
  buildAssistantSnapshotIngressKey,
  buildCodexTurnIdentityKey,
  createThreadLifecycleSnapshot,
  createTurnDiagnosticState,
  extractTurnIdFromRawItem,
  getCodexNoProgressTimeoutMs,
  inferRawItemEngine,
  inferThreadEngine,
  isExecutionItemType,
  isRequestUserInputModeBlocked,
  isThreadSessionMirrorEnabled,
  isTurnDiagnosticVerboseEnabled,
  listActiveExecutionItemTypes,
  listDeferredCompletionBlockers,
  resolveAgentMessageSnapshotText,
  shouldEmitServerDebugEntry,
  type CodexQuarantinedTurn,
  type DeferredCompletionFlushSource,
  type ThreadLifecycleSnapshot,
  type TurnDiagnosticState,
} from "./threadEventDiagnostics";

export {
  CODEX_EXECUTION_ACTIVE_NO_PROGRESS_STALL_MS,
  CODEX_TURN_NO_PROGRESS_STALL_MS,
} from "./threadEventDiagnostics";

type ThreadEventHandlersOptions = {
  activeThreadId: string | null;
  dispatch: Dispatch<ThreadAction>;
  getCustomName: (workspaceId: string, threadId: string) => string | undefined;
  resolveCanonicalThreadId?: (threadId: string) => string;
  resolveCollaborationUiMode?: (
    threadId: string,
  ) => "plan" | "code" | null;
  isAutoTitlePending: (workspaceId: string, threadId: string) => boolean;
  isThreadHidden: (workspaceId: string, threadId: string) => boolean;
  markProcessing: (threadId: string, isProcessing: boolean) => void;
  markReviewing: (threadId: string, isReviewing: boolean) => void;
  setActiveTurnId: (threadId: string, turnId: string | null) => void;
  codexCompactionInFlightByThreadRef: MutableRefObject<Record<string, boolean>>;
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
  resolveClaudeContinuationThreadId?: (
    workspaceId: string,
    threadId: string,
    turnId?: string | null,
  ) => string | null;
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
  onAgentMessageCompletedExternal?: (payload: {
    workspaceId: string;
    threadId: string;
    turnId?: string | null;
    itemId: string;
    text: string;
  }) => void;
  onTurnCompletedExternal?: (payload: {
    workspaceId: string;
    threadId: string;
    turnId: string;
  }) => void;
  onTurnTerminalExternal?: (payload: {
    workspaceId: string;
    threadId: string;
    turnId: string;
    status: "completed" | "error" | "stalled";
  }) => void;
  onCollaborationModeResolved?: (
    event: CollaborationModeResolvedRequest,
  ) => void;
  onExitPlanModeToolCompleted?: (payload: {
    workspaceId: string;
    threadId: string;
    itemId: string;
  }) => void;
};

export function useThreadEventHandlers({
  activeThreadId,
  dispatch,
  getCustomName,
  resolveCanonicalThreadId,
  resolveCollaborationUiMode,
  isAutoTitlePending,
  isThreadHidden,
  markProcessing,
  markReviewing,
  setActiveTurnId,
  codexCompactionInFlightByThreadRef,
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
  resolveClaudeContinuationThreadId,
  resolvePendingThreadForSession,
  resolvePendingThreadForTurn,
  getActiveTurnIdForThread,
  renamePendingMemoryCaptureKey,
  onAgentMessageCompletedExternal,
  onTurnCompletedExternal,
  onTurnTerminalExternal,
  onCollaborationModeResolved,
  onExitPlanModeToolCompleted,
}: ThreadEventHandlersOptions) {
  const threadLifecycleSnapshotRef = useRef<Map<string, ThreadLifecycleSnapshot>>(new Map());
  const turnDiagnosticsRef = useRef<Map<string, TurnDiagnosticState>>(new Map());
  const turnFirstDeltaTimerRef = useRef<Map<string, number>>(new Map());
  const turnStallTimerRef = useRef<Map<string, number>>(new Map());
  const codexNoProgressTimerRef = useRef<Map<string, number>>(new Map());
  const flushDeferredTurnCompletionRef = useRef<
    ((threadId: string, source: DeferredCompletionFlushSource) => void) | null
  >(null);
  const assistantSnapshotIngressLengthRef = useRef<Map<string, number>>(new Map());
  const quarantinedCodexTurnsRef = useRef<Map<string, CodexQuarantinedTurn>>(new Map());

  const getThreadLifecycleSnapshot = useCallback((threadId: string) => {
    return (
      threadLifecycleSnapshotRef.current.get(threadId) ?? createThreadLifecycleSnapshot()
    );
  }, []);

  const emitTurnDiagnostic = useCallback(
    (
      label: string,
      payload: Record<string, unknown>,
      options?: { force?: boolean },
    ) => {
      if (!options?.force && !isTurnDiagnosticVerboseEnabled()) {
        return;
      }
      onDebug?.({
        id: `${Date.now()}-turn-diagnostic-${label}`,
        timestamp: Date.now(),
        source: "event",
        label: `thread/session:turn-diagnostic:${label}`,
        payload: buildThreadDebugCorrelation(
          {
            workspaceId:
              typeof payload.workspaceId === "string" ? payload.workspaceId : null,
            threadId:
              typeof payload.threadId === "string" ? payload.threadId : null,
            action: `turn-diagnostic:${label}`,
            diagnosticCategory:
              typeof payload.diagnosticCategory === "string"
                ? payload.diagnosticCategory
                : null,
          },
          payload,
        ),
      });
    },
    [onDebug],
  );

  const clearFirstDeltaTimer = useCallback((threadId: string) => {
    const timerId = turnFirstDeltaTimerRef.current.get(threadId);
    if (timerId === undefined) {
      return;
    }
    window.clearTimeout(timerId);
    turnFirstDeltaTimerRef.current.delete(threadId);
  }, []);

  const clearTurnStallTimer = useCallback((threadId: string) => {
    const timerId = turnStallTimerRef.current.get(threadId);
    if (timerId === undefined) {
      return;
    }
    window.clearTimeout(timerId);
    turnStallTimerRef.current.delete(threadId);
  }, []);

  const clearCodexNoProgressTimer = useCallback((threadId: string) => {
    const timerId = codexNoProgressTimerRef.current.get(threadId);
    if (timerId === undefined) {
      return;
    }
    window.clearTimeout(timerId);
    codexNoProgressTimerRef.current.delete(threadId);
  }, []);

  const markCodexNoProgressSuspected = useCallback(
    (threadId: string, diagnostic: TurnDiagnosticState, elapsedSinceProgressMs: number) => {
      if (diagnostic.noProgressSuspectedAt !== null) {
        return;
      }
      const now = Date.now();
      const timeoutMs = getCodexNoProgressTimeoutMs(diagnostic);
      const activeExecutionItemTypes = listActiveExecutionItemTypes(diagnostic);
      const lifecycle = getThreadLifecycleSnapshot(threadId);
      diagnostic.noProgressSuspectedAt = now;
      diagnostic.noProgressSuspectedSource = "frontend-no-progress-suspected";
      dispatch({
        type: "markCodexSilentSuspected",
        threadId,
        timestamp: now,
        source: "frontend-no-progress-suspected",
      });
      emitTurnDiagnostic("codex-no-progress-suspected", {
        ...buildCodexLivenessDiagnostic({
          workspaceId: diagnostic.workspaceId,
          threadId,
          stage: "suspected-silent",
          outcome: "recoverable",
          source: "frontend-no-progress-suspected",
          reason: "frontend observed no Codex progress before the watchdog window",
          turnId: diagnostic.turnId,
          lastEventAgeMs: elapsedSinceProgressMs,
        }),
        turnId: diagnostic.turnId,
        elapsedMs: Math.max(0, now - diagnostic.startedAt),
        elapsedSinceProgressMs,
        timeoutMs,
        lastProgressSource: diagnostic.lastProgressSource,
        progressSequence: diagnostic.progressSequence,
        activeExecutionItemCount: diagnostic.activeExecutionItems.size,
        activeExecutionItemTypes,
        isProcessing: lifecycle.isProcessing,
        activeTurnId: lifecycle.activeTurnId,
        diagnosticCategory: "codex-no-progress",
        terminal: false,
        quarantine: false,
        ...buildThreadStreamCorrelationDimensions(threadId),
      }, { force: true });
    },
    [dispatch, emitTurnDiagnostic, getThreadLifecycleSnapshot],
  );

  const scheduleCodexNoProgressTimer = useCallback(
    (threadId: string) => {
      if (typeof window === "undefined" || inferThreadEngine(threadId) !== "codex") {
        return;
      }
      const diagnostic = turnDiagnosticsRef.current.get(threadId);
      if (!diagnostic) {
        return;
      }
      clearCodexNoProgressTimer(threadId);
      const now = Date.now();
      const timeoutMs = getCodexNoProgressTimeoutMs(diagnostic);
      const elapsedSinceProgressMs = Math.max(0, now - diagnostic.lastProgressAt);
      const delayMs = Math.max(0, timeoutMs - elapsedSinceProgressMs);
      const timerId = window.setTimeout(() => {
        const latestDiagnostic = turnDiagnosticsRef.current.get(threadId);
        if (
          !latestDiagnostic ||
          latestDiagnostic.completedAt !== null ||
          latestDiagnostic.errorAt !== null ||
          interruptedThreadsRef.current.has(threadId)
        ) {
          return;
        }
        const lifecycle = getThreadLifecycleSnapshot(threadId);
        if (
          !lifecycle.isProcessing ||
          (lifecycle.activeTurnId !== null && lifecycle.activeTurnId !== latestDiagnostic.turnId)
        ) {
          return;
        }
        const now = Date.now();
        const elapsedSinceProgressMs = Math.max(0, now - latestDiagnostic.lastProgressAt);
        const timeoutMs = getCodexNoProgressTimeoutMs(latestDiagnostic);
        if (elapsedSinceProgressMs < timeoutMs) {
          return;
        }
        markCodexNoProgressSuspected(
          threadId,
          latestDiagnostic,
          elapsedSinceProgressMs,
        );
      }, delayMs);
      codexNoProgressTimerRef.current.set(threadId, timerId);
    },
    [
      clearCodexNoProgressTimer,
      getThreadLifecycleSnapshot,
      interruptedThreadsRef,
      markCodexNoProgressSuspected,
    ],
  );

  const noteCodexTurnProgressEvidence = useCallback(
    (threadId: string, source: string) => {
      if (inferThreadEngine(threadId) !== "codex" || interruptedThreadsRef.current.has(threadId)) {
        return;
      }
      const diagnostic = turnDiagnosticsRef.current.get(threadId);
      if (!diagnostic) {
        return;
      }
      const wasSuspected = diagnostic.noProgressSuspectedAt !== null;
      const suspectedDurationMs =
        diagnostic.noProgressSuspectedAt === null
          ? null
          : Math.max(0, Date.now() - diagnostic.noProgressSuspectedAt);
      diagnostic.lastProgressAt = Date.now();
      diagnostic.lastProgressSource = source;
      diagnostic.progressSequence += 1;
      diagnostic.noProgressSuspectedAt = null;
      diagnostic.noProgressSuspectedSource = null;
      if (wasSuspected) {
        dispatch({ type: "clearCodexSilentSuspected", threadId });
        const lifecycle = getThreadLifecycleSnapshot(threadId);
        emitTurnDiagnostic("codex-no-progress-recovered", {
          ...buildCodexLivenessDiagnostic({
            workspaceId: diagnostic.workspaceId,
            threadId,
            stage: "active",
            outcome: "recovered",
            source,
            reason: "matching Codex progress arrived after frontend no-progress suspicion",
            turnId: diagnostic.turnId,
          }),
          turnId: diagnostic.turnId,
          progressSource: source,
          suspectedDurationMs,
          progressSequence: diagnostic.progressSequence,
          isProcessing: lifecycle.isProcessing,
          activeTurnId: lifecycle.activeTurnId,
          diagnosticCategory: "codex-no-progress",
          ...buildThreadStreamCorrelationDimensions(threadId),
        }, { force: true });
      }
      scheduleCodexNoProgressTimer(threadId);
    },
    [
      emitTurnDiagnostic,
      dispatch,
      getThreadLifecycleSnapshot,
      interruptedThreadsRef,
      scheduleCodexNoProgressTimer,
    ],
  );

  const scheduleFirstDeltaTimer = useCallback(
    (threadId: string) => {
      if (typeof window === "undefined") {
        return;
      }
      clearFirstDeltaTimer(threadId);
      const timerId = window.setTimeout(() => {
        if (interruptedThreadsRef.current.has(threadId)) {
          return;
        }
        const diagnostic = turnDiagnosticsRef.current.get(threadId);
        if (!diagnostic || diagnostic.firstDeltaAt !== null) {
          return;
        }
        const lifecycle = getThreadLifecycleSnapshot(threadId);
        const now = Date.now();
        const elapsedMs = Math.max(0, now - diagnostic.startedAt);
        reportThreadUpstreamPending(threadId, {
          elapsedMs,
          diagnosticCategory: "first-token-delay",
          reason: "waiting-for-first-delta",
        });
        emitTurnDiagnostic("waiting-for-first-delta", {
          workspaceId: diagnostic.workspaceId,
          threadId: diagnostic.threadId,
          turnId: diagnostic.turnId,
          elapsedMs,
          isProcessing: lifecycle.isProcessing,
          activeTurnId: lifecycle.activeTurnId,
          diagnosticCategory: "first-token-delay",
          ...buildThreadStreamCorrelationDimensions(threadId),
        }, { force: true });
      }, TURN_FIRST_DELTA_WARNING_MS);
      turnFirstDeltaTimerRef.current.set(threadId, timerId);
    },
    [clearFirstDeltaTimer, emitTurnDiagnostic, getThreadLifecycleSnapshot, interruptedThreadsRef],
  );

  const scheduleTurnStallTimer = useCallback(
    (threadId: string) => {
      if (typeof window === "undefined") {
        return;
      }
      clearTurnStallTimer(threadId);
      const timerId = window.setTimeout(() => {
        const diagnostic = turnDiagnosticsRef.current.get(threadId);
        if (!diagnostic || diagnostic.stallReported || diagnostic.firstExecutionAt !== null) {
          return;
        }
        const lifecycle = getThreadLifecycleSnapshot(threadId);
        const now = Date.now();
        diagnostic.stallReported = true;
        emitTurnDiagnostic("stalled-after-first-delta", {
          workspaceId: diagnostic.workspaceId,
          threadId: diagnostic.threadId,
          turnId: diagnostic.turnId,
          elapsedMs: Math.max(0, now - diagnostic.startedAt),
          deltaSinceMs:
            diagnostic.firstDeltaAt === null ? null : Math.max(0, now - diagnostic.firstDeltaAt),
          itemEventCount: diagnostic.itemEventCount,
          firstItemEventKind: diagnostic.firstItemEventKind,
          firstItemType: diagnostic.firstItemType,
          hasExecutionItem: false,
          isProcessing: lifecycle.isProcessing,
          activeTurnId: lifecycle.activeTurnId,
          ...buildThreadStreamCorrelationDimensions(threadId),
        }, { force: true });
      }, TURN_STALL_WARNING_MS);
      turnStallTimerRef.current.set(threadId, timerId);
    },
    [clearTurnStallTimer, emitTurnDiagnostic, getThreadLifecycleSnapshot],
  );

  const clearAssistantSnapshotIngressForThread = useCallback((threadId: string) => {
    const prefix = `${threadId}\u0000`;
    assistantSnapshotIngressLengthRef.current.forEach((_value, key) => {
      if (key.startsWith(prefix)) {
        assistantSnapshotIngressLengthRef.current.delete(key);
      }
    });
  }, []);

  const quarantineCodexTurn = useCallback(
    (
      workspaceId: string,
      threadId: string,
      turnId: string,
      reason: string,
      source: string,
      engineHint?: ConversationEngine | null,
    ) => {
      const normalizedTurnId = turnId.trim();
      const engine = engineHint ?? inferThreadEngine(threadId);
      if (engine !== "codex" || !normalizedTurnId) {
        return;
      }
      const key = buildCodexTurnIdentityKey(threadId, normalizedTurnId);
      if (quarantinedCodexTurnsRef.current.has(key)) {
        return;
      }
      quarantinedCodexTurnsRef.current.set(key, {
        workspaceId,
        threadId,
        turnId: normalizedTurnId,
        settledAt: Date.now(),
        reason,
        source,
      });
    },
    [],
  );

  const shouldSkipCodexTurnEvent = useCallback(
    (input: {
      engine: "claude" | "codex" | "gemini" | "opencode";
      workspaceId: string;
      threadId: string;
      turnId: string;
      operation: string;
      sourceMethod: string;
    }) => {
      if (input.engine !== "codex") {
        return false;
      }
      const eventTurnId = input.turnId.trim();
      if (!eventTurnId) {
        return false;
      }
      const quarantineKey = buildCodexTurnIdentityKey(input.threadId, eventTurnId);
      const quarantinedTurn = quarantinedCodexTurnsRef.current.get(quarantineKey);
      if (quarantinedTurn) {
        emitTurnDiagnostic("quarantined-codex-event-skipped", {
          ...buildCodexLivenessDiagnostic({
            workspaceId: input.workspaceId,
            threadId: input.threadId,
            stage: "abandoned",
            outcome: "abandoned",
            source: input.sourceMethod,
            reason: "event belongs to a quarantined Codex turn",
            turnId: eventTurnId,
          }),
          eventTurnId,
          quarantinedAtMs: quarantinedTurn.settledAt,
          quarantineReason: quarantinedTurn.reason,
          quarantineSource: quarantinedTurn.source,
          operation: input.operation,
          sourceMethod: input.sourceMethod,
          diagnosticCategory: "quarantined-codex-event",
        }, { force: true });
        return true;
      }
      const diagnosticTurnId = turnDiagnosticsRef.current.get(input.threadId)?.turnId ?? null;
      const activeTurnId = getThreadLifecycleSnapshot(input.threadId).activeTurnId;
      const expectedTurnId = diagnosticTurnId ?? activeTurnId;
      if (!expectedTurnId || expectedTurnId === eventTurnId) {
        return false;
      }
      emitTurnDiagnostic("late-codex-event-skipped", {
        ...buildCodexLivenessDiagnostic({
          workspaceId: input.workspaceId,
          threadId: input.threadId,
          stage: "abandoned",
          outcome: "abandoned",
          source: input.sourceMethod,
          reason: "event turn id does not match active Codex turn",
          turnId: eventTurnId,
        }),
        eventTurnId,
        activeTurnId,
        expectedTurnId,
        operation: input.operation,
        sourceMethod: input.sourceMethod,
        diagnosticCategory: "late-codex-event",
      }, { force: true });
      return true;
    },
    [emitTurnDiagnostic, getThreadLifecycleSnapshot],
  );

  const markProcessingTracked = useCallback(
    (threadId: string, isProcessing: boolean) => {
      const previous =
        threadLifecycleSnapshotRef.current.get(threadId) ?? createThreadLifecycleSnapshot();
      threadLifecycleSnapshotRef.current.set(threadId, {
        ...previous,
        isProcessing,
      });
      markProcessing(threadId, isProcessing);
    },
    [markProcessing],
  );

  const setActiveTurnIdTracked = useCallback(
    (threadId: string, turnId: string | null) => {
      const previous =
        threadLifecycleSnapshotRef.current.get(threadId) ?? createThreadLifecycleSnapshot();
      threadLifecycleSnapshotRef.current.set(threadId, {
        ...previous,
        activeTurnId: turnId,
      });
      setActiveTurnId(threadId, turnId);
    },
    [setActiveTurnId],
  );

  const captureTurnItemDiagnostic = useCallback(
    (
      threadId: string,
      kind: "started" | "updated" | "completed",
      item: Record<string, unknown>,
    ) => {
      const diagnostic = turnDiagnosticsRef.current.get(threadId);
      if (!diagnostic) {
        return;
      }
      diagnostic.itemEventCount += 1;
      const itemType = asString(item.type).trim() || null;
      const itemId = asString(item.id).trim() || null;
      const now = Date.now();
      if (diagnostic.firstItemEventAt === null) {
        diagnostic.firstItemEventAt = now;
        diagnostic.firstItemEventKind = kind;
        diagnostic.firstItemType = itemType;
        const lifecycle = getThreadLifecycleSnapshot(threadId);
        emitTurnDiagnostic("first-item", {
          workspaceId: diagnostic.workspaceId,
          threadId,
          turnId: diagnostic.turnId,
          itemEventKind: kind,
          itemType,
          itemId,
          elapsedMs: Math.max(0, now - diagnostic.startedAt),
          deltaSeen: diagnostic.firstDeltaAt !== null,
          isProcessing: lifecycle.isProcessing,
          activeTurnId: lifecycle.activeTurnId,
          ...buildThreadStreamCorrelationDimensions(threadId),
        });
      }
      if (isExecutionItemType(itemType) && diagnostic.firstExecutionAt === null) {
        diagnostic.firstExecutionAt = now;
        diagnostic.firstExecutionEventKind = kind;
        diagnostic.firstExecutionItemType = itemType;
        diagnostic.firstExecutionItemId = itemId;
        clearTurnStallTimer(threadId);
        const lifecycle = getThreadLifecycleSnapshot(threadId);
        emitTurnDiagnostic("first-execution-item", {
          workspaceId: diagnostic.workspaceId,
          threadId,
          turnId: diagnostic.turnId,
          itemEventKind: kind,
          itemType,
          itemId,
          elapsedMs: Math.max(0, now - diagnostic.startedAt),
          deltaSinceMs:
            diagnostic.firstDeltaAt === null ? null : Math.max(0, now - diagnostic.firstDeltaAt),
          isProcessing: lifecycle.isProcessing,
          activeTurnId: lifecycle.activeTurnId,
          ...buildThreadStreamCorrelationDimensions(threadId),
        });
      }
      if (applyActiveExecutionItemEvent(diagnostic, kind, itemType, itemId, item, now)) {
        scheduleCodexNoProgressTimer(threadId);
      }
    },
    [
      clearTurnStallTimer,
      emitTurnDiagnostic,
      getThreadLifecycleSnapshot,
      scheduleCodexNoProgressTimer,
    ],
  );

  const recordAssistantCompletionEvidence = useCallback(
    (threadId: string, itemId: string) => {
      const diagnostic = turnDiagnosticsRef.current.get(threadId);
      if (!diagnostic) {
        return;
      }
      diagnostic.assistantCompletedAt = Date.now();
      diagnostic.assistantCompletedItemId = itemId || null;
    },
    [],
  );

  const recordAssistantStreamIngress = useCallback(
    (payload: {
      workspaceId: string;
      threadId: string;
      itemId: string;
      textLength: number;
      source: StreamIngressSource;
    }) => {
      if (interruptedThreadsRef.current.has(payload.threadId)) {
        return;
      }
      const diagnostic = turnDiagnosticsRef.current.get(payload.threadId);
      if (!diagnostic) {
        return;
      }
      const deltaTimestamp = Date.now();
      const source = payload.source;
      const isDeltaIngress = source === "delta" || source === "snapshot";
      if (isDeltaIngress) {
        noteThreadDeltaReceived(payload.threadId, deltaTimestamp, {
          source,
          itemId: payload.itemId,
          textLength: payload.textLength,
        });
        diagnostic.deltaCount += 1;
      } else {
        noteThreadTextIngressReceived(payload.threadId, {
          source: payload.source,
          itemId: payload.itemId,
          textLength: payload.textLength,
          timestamp: deltaTimestamp,
        });
      }
      if (!isDeltaIngress) {
        return;
      }
      if (diagnostic.firstDeltaAt !== null) {
        return;
      }
      diagnostic.firstDeltaAt = deltaTimestamp;
      clearFirstDeltaTimer(payload.threadId);
      scheduleTurnStallTimer(payload.threadId);
      const lifecycle = getThreadLifecycleSnapshot(payload.threadId);
      emitTurnDiagnostic("first-delta", {
        workspaceId: payload.workspaceId,
        threadId: payload.threadId,
        turnId: diagnostic.turnId,
        itemId: payload.itemId,
        deltaLength: payload.textLength,
        ingressSource: payload.source,
        elapsedMs: Math.max(0, diagnostic.firstDeltaAt - diagnostic.startedAt),
        isProcessing: lifecycle.isProcessing,
        activeTurnId: lifecycle.activeTurnId,
        ...buildThreadStreamCorrelationDimensions(payload.threadId),
      });
    },
    [
      clearFirstDeltaTimer,
      emitTurnDiagnostic,
      getThreadLifecycleSnapshot,
      interruptedThreadsRef,
      scheduleTurnStallTimer,
    ],
  );

  const maybeRecordAgentMessageSnapshotIngress = useCallback(
    (workspaceId: string, threadId: string, item: Record<string, unknown>) => {
      const itemType = asString(item.type).trim();
      if (itemType !== "agentMessage") {
        return;
      }
      const text = resolveAgentMessageSnapshotText(item);
      if (!text.trim()) {
        return;
      }
      const itemId = asString(item.id).trim();
      const ingressKey = buildAssistantSnapshotIngressKey(threadId, itemId);
      const previousLength =
        assistantSnapshotIngressLengthRef.current.get(ingressKey) ?? 0;
      const nextLength = text.length;
      if (nextLength <= previousLength) {
        return;
      }
      assistantSnapshotIngressLengthRef.current.set(ingressKey, nextLength);
      recordAssistantStreamIngress({
        workspaceId,
        threadId,
        itemId,
        textLength: nextLength,
        source: "snapshot",
      });
    },
    [recordAssistantStreamIngress],
  );

  useEffect(() => {
    const firstDeltaTimers = turnFirstDeltaTimerRef.current;
    const stallTimers = turnStallTimerRef.current;
    const codexNoProgressTimers = codexNoProgressTimerRef.current;
    const assistantSnapshotIngressLength = assistantSnapshotIngressLengthRef.current;
    const quarantinedCodexTurns = quarantinedCodexTurnsRef.current;
    return () => {
      firstDeltaTimers.forEach((timerId) => {
        window.clearTimeout(timerId);
      });
      firstDeltaTimers.clear();
      stallTimers.forEach((timerId) => {
        window.clearTimeout(timerId);
      });
      stallTimers.clear();
      codexNoProgressTimers.forEach((timerId) => {
        window.clearTimeout(timerId);
      });
      codexNoProgressTimers.clear();
      assistantSnapshotIngressLength.clear();
      quarantinedCodexTurns.clear();
    };
  }, []);

  const isReasoningRawDebugEnabled = () => {
    if (import.meta.env?.DEV) {
      try {
        const value = window.localStorage.getItem("ccgui.debug.reasoning.raw");
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
      const value = window.localStorage.getItem("ccgui.debug.reasoning.raw");
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
    markProcessing: markProcessingTracked,
    setActiveTurnId: setActiveTurnIdTracked,
    resolveClaudeContinuationThreadId,
  });
  const enqueueUserInputRequest = useThreadUserInputEvents({
    dispatch,
    resolveClaudeContinuationThreadId,
  });
  const settleThreadWaitingForUserChoice = useCallback(
    (threadId: string) => {
      if (!threadId) {
        return;
      }
      // User-choice gates are no longer normal foreground processing.
      markProcessingTracked(threadId, false);
      setActiveTurnIdTracked(threadId, null);
      dispatch({
        type: "settleThreadPlanInProgress",
        threadId,
        targetStatus: "pending",
      });
    },
    [dispatch, markProcessingTracked, setActiveTurnIdTracked],
  );
  const onRequestUserInput = useCallback(
    (request: RequestUserInputRequest) => {
      enqueueUserInputRequest(request);
      const threadId =
        resolveClaudeContinuationThreadId?.(
          request.workspace_id,
          request.params.thread_id,
          request.params.turn_id,
        ) ?? request.params.thread_id;
      if (!threadId) {
        return;
      }
      settleThreadWaitingForUserChoice(threadId);
    },
    [
      enqueueUserInputRequest,
      resolveClaudeContinuationThreadId,
      settleThreadWaitingForUserChoice,
    ],
  );
  const onModeBlocked = useCallback(
    (event: CollaborationModeBlockedRequest) => {
      const rawThreadId = event.params.thread_id;
      const threadId =
        resolveClaudeContinuationThreadId?.(event.workspace_id, rawThreadId) ?? rawThreadId;
      if (!threadId) {
        return;
      }
      const requestUserInputBlocked = isRequestUserInputModeBlocked(event);
      const requestId = event.params.request_id;
      if (requestId !== null && requestId !== undefined) {
        dispatch({
          type: "removeUserInputRequest",
          requestId,
          workspaceId: event.workspace_id,
        });
      }
      if (requestUserInputBlocked) {
        settleThreadWaitingForUserChoice(threadId);
      }
      const reason =
        event.params.reason.trim() ||
        "This request is blocked while effective mode is code.";
      const suggestion =
        (event.params.suggestion ?? "").trim() ||
        "Switch to Plan mode and retry if user input is required.";
      const blockedMethod = asString(event.params.blocked_method).trim();
      const blockedDetail = blockedMethod || (
        requestUserInputBlocked ? "item/tool/requestUserInput" : "modeBlocked"
      );
      const blockedTitle = requestUserInputBlocked
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
          detail: blockedDetail,
          status: "completed",
          output: `${reason}\n\n${suggestion}`,
        },
        hasCustomName: Boolean(getCustomName(event.workspace_id, threadId)),
      });
    },
    [dispatch, getCustomName, resolveClaudeContinuationThreadId, settleThreadWaitingForUserChoice],
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
    onNormalizedRealtimeEvent,
    onReasoningSummaryDelta,
    onReasoningSummaryBoundary,
    onReasoningTextDelta,
    onCommandOutputDelta,
    onTerminalInteraction,
    onFileChangeOutputDelta,
    flushPendingRealtimeEvents,
    isRealtimeTurnTerminalExact,
    noteRealtimeTurnStarted,
    markRealtimeTurnTerminal,
  } = useThreadItemEvents({
    activeThreadId,
    dispatch,
    getCustomName,
    resolveCollaborationUiMode,
    markProcessing: markProcessingTracked,
    markReviewing,
    safeMessageActivity,
    recordThreadActivity,
    applyCollabThreadLinks,
    interruptedThreadsRef,
    onDebug,
    onAgentMessageCompletedExternal,
    onExitPlanModeToolCompleted,
  });

  const {
    onThreadStarted,
    onTurnStarted,
    onTurnCompleted,
    onTurnPlanUpdated,
    onThreadTokenUsageUpdated: onThreadTokenUsageUpdatedBase,
    onAccountRateLimitsUpdated,
    onTurnError,
    onTurnStalled,
    onContextCompacting,
    onContextCompacted,
    onContextCompactionFailed,
    onThreadSessionIdUpdated,
  } = useThreadTurnEvents({
    activeThreadId,
    dispatch,
    getCustomName,
    resolveCanonicalThreadId,
    isAutoTitlePending,
    isThreadHidden,
    markProcessing: markProcessingTracked,
    markReviewing,
    setActiveTurnId: setActiveTurnIdTracked,
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
  });

  const onThreadTokenUsageUpdatedTracked = useCallback(
    (workspaceId: string, threadId: string, tokenUsage: Record<string, unknown>) => {
      onThreadTokenUsageUpdatedBase(workspaceId, threadId, tokenUsage);
      noteCodexTurnProgressEvidence(threadId, "thread-token-usage");
    },
    [noteCodexTurnProgressEvidence, onThreadTokenUsageUpdatedBase],
  );

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
      dispatch({ type: "markContinuationEvidence", threadId });
      noteCodexTurnProgressEvidence(threadId, "processing-heartbeat");
      safeMessageActivity();
    },
    [dispatch, noteCodexTurnProgressEvidence, safeMessageActivity],
  );

  const onTurnStartedTracked = useCallback(
    (workspaceId: string, threadId: string, turnId: string) => {
      const startedAt = Date.now();
      noteRealtimeTurnStarted(threadId, turnId);
      clearAssistantSnapshotIngressForThread(threadId);
      noteThreadTurnStarted({
        workspaceId,
        threadId,
        turnId,
        startedAt,
      });
      clearTurnStallTimer(threadId);
      clearFirstDeltaTimer(threadId);
      turnDiagnosticsRef.current.set(
        threadId,
        createTurnDiagnosticState(workspaceId, threadId, turnId, startedAt),
      );
      dispatch({ type: "clearCodexSilentSuspected", threadId });
      scheduleFirstDeltaTimer(threadId);
      scheduleCodexNoProgressTimer(threadId);
      onTurnStarted(workspaceId, threadId, turnId);
      dispatch({ type: "markContinuationEvidence", threadId });
      const lifecycle = getThreadLifecycleSnapshot(threadId);
      emitTurnDiagnostic("started", {
        workspaceId,
        threadId,
        turnId,
        isProcessing: lifecycle.isProcessing,
        activeTurnId: lifecycle.activeTurnId,
        ...buildThreadStreamCorrelationDimensions(threadId),
      });
    },
    [
      clearFirstDeltaTimer,
      clearTurnStallTimer,
      dispatch,
      emitTurnDiagnostic,
      getThreadLifecycleSnapshot,
      onTurnStarted,
      noteRealtimeTurnStarted,
      scheduleCodexNoProgressTimer,
      scheduleFirstDeltaTimer,
      clearAssistantSnapshotIngressForThread,
    ],
  );

  const onAgentMessageDeltaTracked = useCallback(
    (payload: {
      workspaceId: string;
      threadId: string;
      itemId: string;
      delta: string;
      turnId?: string | null;
    }) => {
      const eventTurnId = asString(payload.turnId).trim();
      if (
        eventTurnId &&
        isRealtimeTurnTerminalExact(payload.threadId, eventTurnId)
      ) {
        return;
      }
      if (
        eventTurnId &&
        shouldSkipCodexTurnEvent({
          engine: inferThreadEngine(payload.threadId),
          workspaceId: payload.workspaceId,
          threadId: payload.threadId,
          turnId: eventTurnId,
          operation: "appendAgentMessageDelta",
          sourceMethod: "item/agentMessage/delta",
        })
      ) {
        return;
      }
      onAgentMessageDelta(payload);
      dispatch({ type: "markContinuationEvidence", threadId: payload.threadId });
      if (interruptedThreadsRef.current.has(payload.threadId)) {
        return;
      }
      noteCodexTurnProgressEvidence(payload.threadId, "agent-message-delta");
      recordAssistantStreamIngress({
        workspaceId: payload.workspaceId,
        threadId: payload.threadId,
        itemId: payload.itemId,
        textLength: payload.delta.length,
        source: "delta",
      });
    },
    [
      dispatch,
      interruptedThreadsRef,
      isRealtimeTurnTerminalExact,
      noteCodexTurnProgressEvidence,
      onAgentMessageDelta,
      recordAssistantStreamIngress,
      shouldSkipCodexTurnEvent,
    ],
  );

  const onAgentMessageCompletedTracked = useCallback(
    (payload: {
      workspaceId: string;
      threadId: string;
      itemId: string;
      text: string;
      turnId?: string | null;
    }) => {
      const eventTurnId = asString(payload.turnId).trim();
      if (eventTurnId && isRealtimeTurnTerminalExact(payload.threadId, eventTurnId)) {
        return;
      }
      onAgentMessageCompleted(payload);
      if (interruptedThreadsRef.current.has(payload.threadId) || payload.text.length === 0) {
        return;
      }
      recordAssistantCompletionEvidence(payload.threadId, payload.itemId);
      recordAssistantStreamIngress({
        workspaceId: payload.workspaceId,
        threadId: payload.threadId,
        itemId: payload.itemId,
        textLength: payload.text.length,
        source: "completion",
      });
      flushDeferredTurnCompletionRef.current?.(
        payload.threadId,
        "assistant-completed",
      );
    },
    [
      interruptedThreadsRef,
      isRealtimeTurnTerminalExact,
      onAgentMessageCompleted,
      recordAssistantCompletionEvidence,
      recordAssistantStreamIngress,
    ],
  );

  const onItemStartedTracked = useCallback(
    (workspaceId: string, threadId: string, item: Record<string, unknown>) => {
      const eventTurnId = extractTurnIdFromRawItem(item);
      if (eventTurnId && isRealtimeTurnTerminalExact(threadId, eventTurnId)) {
        return;
      }
      if (
        shouldSkipCodexTurnEvent({
          engine: inferRawItemEngine(threadId, item),
          workspaceId,
          threadId,
          turnId: eventTurnId,
          operation: "itemStarted",
          sourceMethod: "item/started",
        })
      ) {
        return;
      }
      onItemStarted(workspaceId, threadId, item);
      dispatch({ type: "markContinuationEvidence", threadId });
      noteCodexTurnProgressEvidence(threadId, "item-started");
      maybeRecordAgentMessageSnapshotIngress(workspaceId, threadId, item);
      captureTurnItemDiagnostic(threadId, "started", item);
    },
    [
      captureTurnItemDiagnostic,
      dispatch,
      isRealtimeTurnTerminalExact,
      maybeRecordAgentMessageSnapshotIngress,
      noteCodexTurnProgressEvidence,
      onItemStarted,
      shouldSkipCodexTurnEvent,
    ],
  );

  const onItemUpdatedTracked = useCallback(
    (workspaceId: string, threadId: string, item: Record<string, unknown>) => {
      const eventTurnId = extractTurnIdFromRawItem(item);
      if (eventTurnId && isRealtimeTurnTerminalExact(threadId, eventTurnId)) {
        return;
      }
      if (
        shouldSkipCodexTurnEvent({
          engine: inferRawItemEngine(threadId, item),
          workspaceId,
          threadId,
          turnId: eventTurnId,
          operation: "itemUpdated",
          sourceMethod: "item/updated",
        })
      ) {
        return;
      }
      onItemUpdated(workspaceId, threadId, item);
      dispatch({ type: "markContinuationEvidence", threadId });
      noteCodexTurnProgressEvidence(threadId, "item-updated");
      maybeRecordAgentMessageSnapshotIngress(workspaceId, threadId, item);
      captureTurnItemDiagnostic(threadId, "updated", item);
      flushDeferredTurnCompletionRef.current?.(threadId, "item-terminal");
    },
    [
      captureTurnItemDiagnostic,
      dispatch,
      isRealtimeTurnTerminalExact,
      maybeRecordAgentMessageSnapshotIngress,
      noteCodexTurnProgressEvidence,
      onItemUpdated,
      shouldSkipCodexTurnEvent,
    ],
  );

  const onItemCompletedTracked = useCallback(
    (workspaceId: string, threadId: string, item: Record<string, unknown>) => {
      const eventTurnId = extractTurnIdFromRawItem(item);
      if (eventTurnId && isRealtimeTurnTerminalExact(threadId, eventTurnId)) {
        return;
      }
      if (
        shouldSkipCodexTurnEvent({
          engine: inferRawItemEngine(threadId, item),
          workspaceId,
          threadId,
          turnId: eventTurnId,
          operation: "itemCompleted",
          sourceMethod: "item/completed",
        })
      ) {
        return;
      }
      onItemCompleted(workspaceId, threadId, item);
      dispatch({ type: "markContinuationEvidence", threadId });
      noteCodexTurnProgressEvidence(threadId, "item-completed");
      captureTurnItemDiagnostic(threadId, "completed", item);
      flushDeferredTurnCompletionRef.current?.(threadId, "item-terminal");
    },
    [
      captureTurnItemDiagnostic,
      dispatch,
      isRealtimeTurnTerminalExact,
      noteCodexTurnProgressEvidence,
      onItemCompleted,
      shouldSkipCodexTurnEvent,
    ],
  );

  const shouldSkipLateCodexNormalizedEvent = useCallback(
    (event: NormalizedThreadEvent) => {
      return shouldSkipCodexTurnEvent({
        engine: event.engine,
        workspaceId: event.workspaceId,
        threadId: event.threadId,
        turnId: asString(event.turnId).trim(),
        operation: event.operation,
        sourceMethod: event.sourceMethod,
      });
    },
    [shouldSkipCodexTurnEvent],
  );

  const onNormalizedRealtimeEventTracked = useCallback(
    (event: NormalizedThreadEvent) => {
      if (
        event.turnId &&
        isRealtimeTurnTerminalExact(event.threadId, event.turnId)
      ) {
        return;
      }
      if (shouldSkipLateCodexNormalizedEvent(event)) {
        return;
      }
      onNormalizedRealtimeEvent(event);
      dispatch({ type: "markContinuationEvidence", threadId: event.threadId });
      noteCodexTurnProgressEvidence(event.threadId, `normalized:${event.operation}`);
      if (event.operation === "appendAgentMessageDelta") {
        const textLength =
          event.delta?.length ??
          (event.item.kind === "message" ? event.item.text.length : 0);
        if (textLength > 0 && event.item.kind === "message") {
          recordAssistantStreamIngress({
            workspaceId: event.workspaceId,
            threadId: event.threadId,
            itemId: event.item.id,
            textLength,
            source:
              event.sourceMethod === "item/started" ||
              event.sourceMethod === "item/updated"
                ? "snapshot"
                : "delta",
          });
        }
      }
      if (
        event.operation === "completeAgentMessage" &&
        event.item.kind === "message" &&
        event.item.role === "assistant" &&
        event.item.text.length > 0
      ) {
        recordAssistantStreamIngress({
          workspaceId: event.workspaceId,
          threadId: event.threadId,
          itemId: event.item.id,
          textLength: event.item.text.length,
          source: "completion",
        });
        recordAssistantCompletionEvidence(event.threadId, event.item.id);
        flushDeferredTurnCompletionRef.current?.(
          event.threadId,
          "assistant-completed",
        );
      }
      if (!event.rawItem) {
        return;
      }
      if (event.operation === "itemStarted" || event.operation === "itemUpdated") {
        maybeRecordAgentMessageSnapshotIngress(
          event.workspaceId,
          event.threadId,
          event.rawItem,
        );
      }
      if (event.operation === "itemStarted") {
        captureTurnItemDiagnostic(event.threadId, "started", event.rawItem);
        return;
      }
      if (event.operation === "itemUpdated") {
        captureTurnItemDiagnostic(event.threadId, "updated", event.rawItem);
        flushDeferredTurnCompletionRef.current?.(event.threadId, "item-terminal");
        return;
      }
      if (event.operation === "itemCompleted") {
        captureTurnItemDiagnostic(event.threadId, "completed", event.rawItem);
        flushDeferredTurnCompletionRef.current?.(event.threadId, "item-terminal");
      }
    },
    [
      captureTurnItemDiagnostic,
      dispatch,
      isRealtimeTurnTerminalExact,
      maybeRecordAgentMessageSnapshotIngress,
      noteCodexTurnProgressEvidence,
      onNormalizedRealtimeEvent,
      recordAssistantCompletionEvidence,
      recordAssistantStreamIngress,
      shouldSkipLateCodexNormalizedEvent,
    ],
  );

  const finalizeTurnDiagnostic = useCallback(
    (
      threadId: string,
      finalState: "completed" | "error",
      payload?: Record<string, unknown>,
    ) => {
      const diagnostic = turnDiagnosticsRef.current.get(threadId);
      clearFirstDeltaTimer(threadId);
      clearTurnStallTimer(threadId);
      clearCodexNoProgressTimer(threadId);
      if (!diagnostic) {
        return;
      }
      const now = Date.now();
      if (finalState === "completed") {
        diagnostic.completedAt = now;
      } else {
        diagnostic.errorAt = now;
      }
      const rawMessage =
        typeof payload?.message === "string" ? payload.message : null;
      const firstPacketTimeoutSeconds =
        rawMessage ? parseFirstPacketTimeoutSeconds(rawMessage) : null;
      if (diagnostic.firstDeltaAt === null && finalState === "error") {
        reportThreadUpstreamPending(threadId, {
          elapsedMs: Math.max(0, now - diagnostic.startedAt),
          diagnosticCategory:
            firstPacketTimeoutSeconds !== null
              ? "first-packet-timeout"
              : "first-token-delay",
          reason: firstPacketTimeoutSeconds !== null ? "first-packet-timeout" : "turn-error",
          firstPacketTimeoutSeconds,
          message: rawMessage,
        });
      }
      const lifecycle = getThreadLifecycleSnapshot(threadId);
      emitTurnDiagnostic(finalState, {
        workspaceId: diagnostic.workspaceId,
        threadId,
        turnId: diagnostic.turnId,
        elapsedMs: Math.max(0, now - diagnostic.startedAt),
        firstDeltaAtMs:
          diagnostic.firstDeltaAt === null
            ? null
            : Math.max(0, diagnostic.firstDeltaAt - diagnostic.startedAt),
        firstItemAtMs:
          diagnostic.firstItemEventAt === null
            ? null
            : Math.max(0, diagnostic.firstItemEventAt - diagnostic.startedAt),
        firstItemEventKind: diagnostic.firstItemEventKind,
        firstItemType: diagnostic.firstItemType,
        firstExecutionAtMs:
          diagnostic.firstExecutionAt === null
            ? null
            : Math.max(0, diagnostic.firstExecutionAt - diagnostic.startedAt),
        firstExecutionEventKind: diagnostic.firstExecutionEventKind,
        firstExecutionItemType: diagnostic.firstExecutionItemType,
        firstExecutionItemId: diagnostic.firstExecutionItemId,
        deltaCount: diagnostic.deltaCount,
        itemEventCount: diagnostic.itemEventCount,
        stalledAfterFirstDelta: diagnostic.stallReported,
        isProcessing: lifecycle.isProcessing,
        activeTurnId: lifecycle.activeTurnId,
        firstPacketTimeoutSeconds,
        ...buildThreadStreamCorrelationDimensions(threadId),
        ...payload,
      }, { force: finalState === "error" || diagnostic.stallReported });
      turnDiagnosticsRef.current.delete(threadId);
      clearAssistantSnapshotIngressForThread(threadId);
      completeThreadStreamTurn(threadId);
    },
    [
      clearAssistantSnapshotIngressForThread,
      clearFirstDeltaTimer,
      clearTurnStallTimer,
      clearCodexNoProgressTimer,
      emitTurnDiagnostic,
      getThreadLifecycleSnapshot,
    ],
  );

  const settleCompletedTurn = useCallback(
    (workspaceId: string, threadId: string, normalizedTurnId: string) => {
      markRealtimeTurnTerminal(threadId, normalizedTurnId);
      const handled = onTurnCompleted(workspaceId, threadId, normalizedTurnId);
      let fallbackApplied = false;
      if (handled) {
        onTurnCompletedExternal?.({ workspaceId, threadId, turnId: normalizedTurnId });
        onTurnTerminalExternal?.({
          workspaceId,
          threadId,
          turnId: normalizedTurnId,
          status: "completed",
        });
      }
      const diagnostic = turnDiagnosticsRef.current.get(threadId);
      if (!handled && diagnostic && diagnostic.assistantCompletedAt !== null) {
        const lifecycle = getThreadLifecycleSnapshot(threadId);
        const canFallbackSettle =
          !normalizedTurnId ||
          lifecycle.activeTurnId === null ||
          lifecycle.activeTurnId === normalizedTurnId;
        if (canFallbackSettle) {
          dispatch({
            type: "clearProcessingGeneratedImages",
            threadId,
          });
          dispatch({ type: "markTerminalSettlement", threadId });
          dispatch({
            type: "finalizePendingToolStatuses",
            threadId,
            status: "completed",
          });
          dispatch({
            type: "markContextCompacting",
            threadId,
            isCompacting: false,
            timestamp: Date.now(),
          });
          dispatch({
            type: "settleThreadPlanInProgress",
            threadId,
            targetStatus: "completed",
          });
          markProcessingTracked(threadId, false);
          setActiveTurnIdTracked(threadId, null);
          pendingInterruptsRef.current.delete(threadId);
          interruptedThreadsRef.current.delete(threadId);
          dispatch({ type: "resetAgentSegment", threadId });
          dispatch({ type: "markLatestAssistantMessageFinal", threadId });
          onTurnCompletedExternal?.({
            workspaceId,
            threadId,
            turnId: normalizedTurnId,
          });
          onTurnTerminalExternal?.({
            workspaceId,
            threadId,
            turnId: normalizedTurnId,
            status: "completed",
          });
          fallbackApplied = true;
          emitTurnDiagnostic("terminal-settlement-fallback-applied", {
            workspaceId,
            threadId,
            turnId: normalizedTurnId,
            elapsedMs: Math.max(0, Date.now() - diagnostic.startedAt),
            assistantCompletedAtMs:
              diagnostic.assistantCompletedAt === null
                ? null
                : Math.max(0, diagnostic.assistantCompletedAt - diagnostic.startedAt),
            assistantCompletedItemId: diagnostic.assistantCompletedItemId,
            isProcessing: lifecycle.isProcessing,
            activeTurnId: lifecycle.activeTurnId,
            diagnosticCategory: "frontend-terminal-settlement",
            reason: "turn-completed-settlement-fallback-applied",
            ...buildThreadStreamCorrelationDimensions(threadId),
          }, { force: true });
        } else {
          emitTurnDiagnostic("terminal-settlement-rejected", {
            workspaceId,
            threadId,
            turnId: normalizedTurnId,
            elapsedMs: Math.max(0, Date.now() - diagnostic.startedAt),
            assistantCompletedAtMs:
              diagnostic.assistantCompletedAt === null
                ? null
                : Math.max(0, diagnostic.assistantCompletedAt - diagnostic.startedAt),
            assistantCompletedItemId: diagnostic.assistantCompletedItemId,
            isProcessing: lifecycle.isProcessing,
            activeTurnId: lifecycle.activeTurnId,
            diagnosticCategory: "frontend-terminal-settlement",
            reason: "turn-completed-settlement-rejected",
            ...buildThreadStreamCorrelationDimensions(threadId),
          }, { force: true });
        }
      }
      if (diagnostic && diagnostic.turnId !== normalizedTurnId) {
        return handled || fallbackApplied;
      }
      finalizeTurnDiagnostic(threadId, "completed");
      return handled || fallbackApplied;
    },
    [
      dispatch,
      emitTurnDiagnostic,
      finalizeTurnDiagnostic,
      getThreadLifecycleSnapshot,
      interruptedThreadsRef,
      markRealtimeTurnTerminal,
      markProcessingTracked,
      onTurnCompleted,
      onTurnCompletedExternal,
      onTurnTerminalExternal,
      pendingInterruptsRef,
      setActiveTurnIdTracked,
    ],
  );

  const deferCodexTurnCompletionIfBlocked = useCallback(
    (workspaceId: string, threadId: string, normalizedTurnId: string) => {
      const diagnostic = turnDiagnosticsRef.current.get(threadId);
      if (
        inferThreadEngine(threadId) !== "codex" ||
        !diagnostic ||
        !normalizedTurnId ||
        diagnostic.turnId !== normalizedTurnId
      ) {
        return false;
      }
      const blockers = listDeferredCompletionBlockers(diagnostic);
      if (blockers.length === 0) {
        return false;
      }
      const now = Date.now();
      const assistantCompletedAt = diagnostic.assistantCompletedAt;
      if (assistantCompletedAt !== null) {
        const lifecycle = getThreadLifecycleSnapshot(threadId);
        emitTurnDiagnostic("turn-completed-deferred-bypassed", {
          workspaceId,
          threadId,
          turnId: normalizedTurnId,
          elapsedMs: Math.max(0, now - diagnostic.startedAt),
          assistantCompletedAtMs: Math.max(
            0,
            assistantCompletedAt - diagnostic.startedAt,
          ),
          assistantCompletedItemId: diagnostic.assistantCompletedItemId,
          blockerCount: blockers.length,
          remainingBlockers: blockers,
          isProcessing: lifecycle.isProcessing,
          activeTurnId: lifecycle.activeTurnId,
          diagnosticCategory: "codex-collab-terminal-order",
          reason:
            "turn/completed arrived after final assistant text with remaining Codex collaboration blockers",
          ...buildThreadStreamCorrelationDimensions(threadId),
        }, { force: true });
        return false;
      }
      diagnostic.deferredCompletion = diagnostic.deferredCompletion ?? {
        workspaceId,
        threadId,
        turnId: normalizedTurnId,
        deferredAt: now,
      };
      const lifecycle = getThreadLifecycleSnapshot(threadId);
      emitTurnDiagnostic("turn-completed-deferred", {
        workspaceId,
        threadId,
        turnId: normalizedTurnId,
        elapsedMs: Math.max(0, now - diagnostic.startedAt),
        blockerCount: blockers.length,
        blockers,
        isProcessing: lifecycle.isProcessing,
        activeTurnId: lifecycle.activeTurnId,
        diagnosticCategory: "codex-collab-terminal-order",
        reason: "turn/completed arrived while Codex collaboration child agents were still active",
        ...buildThreadStreamCorrelationDimensions(threadId),
      }, { force: true });
      return true;
    },
    [emitTurnDiagnostic, getThreadLifecycleSnapshot],
  );

  const flushDeferredTurnCompletionIfReady = useCallback(
    (threadId: string, source: DeferredCompletionFlushSource) => {
      const diagnostic = turnDiagnosticsRef.current.get(threadId);
      const completion = diagnostic?.deferredCompletion ?? null;
      if (!diagnostic || !completion) {
        return;
      }
      const blockers = listDeferredCompletionBlockers(diagnostic);
      const forcedByAssistantCompletion =
        source === "assistant-completed" && blockers.length > 0;
      if (blockers.length > 0 && !forcedByAssistantCompletion) {
        return;
      }
      diagnostic.deferredCompletion = null;
      const now = Date.now();
      emitTurnDiagnostic("turn-completed-deferred-flushed", {
        workspaceId: completion.workspaceId,
        threadId: completion.threadId,
        turnId: completion.turnId,
        deferredMs: Math.max(0, now - completion.deferredAt),
        elapsedMs: Math.max(0, now - diagnostic.startedAt),
        source,
        forcedByAssistantCompletion,
        remainingBlockers: forcedByAssistantCompletion ? blockers : [],
        diagnosticCategory: "codex-collab-terminal-order",
        ...buildThreadStreamCorrelationDimensions(threadId),
      }, { force: true });
      settleCompletedTurn(completion.workspaceId, completion.threadId, completion.turnId);
    },
    [emitTurnDiagnostic, settleCompletedTurn],
  );
  flushDeferredTurnCompletionRef.current = flushDeferredTurnCompletionIfReady;

  const onTurnCompletedTracked = useCallback(
    (workspaceId: string, threadId: string, turnId: string) => {
      const normalizedTurnId = turnId.trim();
      flushPendingRealtimeEvents();
      if (deferCodexTurnCompletionIfBlocked(workspaceId, threadId, normalizedTurnId)) {
        return;
      }
      settleCompletedTurn(workspaceId, threadId, normalizedTurnId);
    },
    [deferCodexTurnCompletionIfBlocked, flushPendingRealtimeEvents, settleCompletedTurn],
  );

  const onTurnErrorTracked = useCallback(
    (
      workspaceId: string,
      threadId: string,
      turnId: string,
      payload: {
        message: string;
        willRetry: boolean;
        engine?: ConversationEngine | null;
      },
    ) => {
      const normalizedTurnId = turnId.trim();
      flushPendingRealtimeEvents();
      markRealtimeTurnTerminal(threadId, normalizedTurnId);
      onTurnError(workspaceId, threadId, normalizedTurnId, payload);
      if (payload.willRetry) {
        return;
      }
      quarantineCodexTurn(
        workspaceId,
        threadId,
        normalizedTurnId,
        "turn-error",
        "turn/error",
        payload.engine,
      );
      onTurnTerminalExternal?.({
        workspaceId,
        threadId,
        turnId: normalizedTurnId,
        status: "error",
      });
      const diagnostic = turnDiagnosticsRef.current.get(threadId);
      if (diagnostic && diagnostic.turnId !== normalizedTurnId) {
        return;
      }
      finalizeTurnDiagnostic(threadId, "error", {
        message: payload.message,
        willRetry: payload.willRetry,
      });
    },
    [
      finalizeTurnDiagnostic,
      flushPendingRealtimeEvents,
      markRealtimeTurnTerminal,
      onTurnError,
      onTurnTerminalExternal,
      quarantineCodexTurn,
    ],
  );

  const onTurnStalledTracked = useCallback(
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
        engine?: ConversationEngine | null;
      },
    ) => {
      const normalizedTurnId = turnId.trim();
      flushPendingRealtimeEvents();
      markRealtimeTurnTerminal(threadId, normalizedTurnId);
      onTurnStalled(workspaceId, threadId, normalizedTurnId, payload);
      quarantineCodexTurn(
        workspaceId,
        threadId,
        normalizedTurnId,
        payload.reasonCode || "turn-stalled",
        payload.source || "turn/stalled",
        payload.engine,
      );
      onTurnTerminalExternal?.({
        workspaceId,
        threadId,
        turnId: normalizedTurnId,
        status: "stalled",
      });
      const diagnostic = turnDiagnosticsRef.current.get(threadId);
      if (diagnostic && diagnostic.turnId !== normalizedTurnId) {
        return;
      }
      finalizeTurnDiagnostic(threadId, "error", {
        message: payload.message,
        diagnosticCategory: "resume_stalled",
        reasonCode: payload.reasonCode,
        stage: payload.stage,
        source: payload.source,
        startedAtMs: payload.startedAtMs,
        timeoutMs: payload.timeoutMs,
      });
    },
    [
      finalizeTurnDiagnostic,
      flushPendingRealtimeEvents,
      markRealtimeTurnTerminal,
      onTurnStalled,
      onTurnTerminalExternal,
      quarantineCodexTurn,
    ],
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

      if (
        method === "thread/status/changed" ||
        method === "runtime/status/changed" ||
        method === "thread/status"
      ) {
        const threadId = asString(params.threadId ?? params.thread_id).trim();
        const eventTurnId = asString(params.turnId ?? params.turn_id).trim();
        const status = asString(params.status ?? params.state ?? params.phase)
          .trim()
          .toLowerCase();
        const diagnosticTurnId = turnDiagnosticsRef.current.get(threadId)?.turnId ?? null;
        const activeTurnId = getThreadLifecycleSnapshot(threadId).activeTurnId;
        const expectedTurnId = diagnosticTurnId ?? activeTurnId;
        if (
          threadId &&
          eventTurnId &&
          expectedTurnId === eventTurnId &&
          (
            status === "active" ||
            status === "running" ||
            status === "processing" ||
            status === "alive"
          )
        ) {
          noteCodexTurnProgressEvidence(threadId, `status:${status}`);
        }
      }

      if (method === "claude/raw") {
        const snapshot = captureClaudeMcpRuntimeSnapshotFromRaw(
          event.workspace_id,
          params,
        );
        if (snapshot && onDebug) {
          onDebug({
            id: `${Date.now()}-claude-mcp-snapshot`,
            timestamp: Date.now(),
            source: "event",
            label: "claude/mcp-runtime-snapshot",
            payload: {
              workspaceId: snapshot.workspaceId,
              sessionId: snapshot.sessionId,
              capturedAt: snapshot.capturedAt,
              toolsCount: snapshot.tools.length,
              servers: snapshot.mcpServers,
            },
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
      getThreadLifecycleSnapshot,
      onDebug,
      noteCodexTurnProgressEvidence,
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
      onAgentMessageDelta: onAgentMessageDeltaTracked,
      onAgentMessageCompleted: onAgentMessageCompletedTracked,
      onNormalizedRealtimeEvent: onNormalizedRealtimeEventTracked,
      onItemStarted: onItemStartedTracked,
      onItemUpdated: onItemUpdatedTracked,
      onItemCompleted: onItemCompletedTracked,
      onReasoningSummaryDelta,
      onReasoningSummaryBoundary,
      onReasoningTextDelta,
      onCommandOutputDelta,
      onTerminalInteraction,
      onFileChangeOutputDelta,
      onThreadStarted,
      onTurnStarted: onTurnStartedTracked,
      onTurnCompleted: onTurnCompletedTracked,
      onProcessingHeartbeat,
      onTurnPlanUpdated,
      onThreadTokenUsageUpdated: onThreadTokenUsageUpdatedTracked,
      onAccountRateLimitsUpdated,
      onTurnError: onTurnErrorTracked,
      onTurnStalled: onTurnStalledTracked,
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
      onAgentMessageDeltaTracked,
      onAgentMessageCompletedTracked,
      onNormalizedRealtimeEventTracked,
      onItemStartedTracked,
      onItemUpdatedTracked,
      onItemCompletedTracked,
      onReasoningSummaryDelta,
      onReasoningSummaryBoundary,
      onReasoningTextDelta,
      onCommandOutputDelta,
      onTerminalInteraction,
      onFileChangeOutputDelta,
      onThreadStarted,
      onTurnStartedTracked,
      onTurnCompletedTracked,
      onProcessingHeartbeat,
      onTurnPlanUpdated,
      onThreadTokenUsageUpdatedTracked,
      onAccountRateLimitsUpdated,
      onTurnErrorTracked,
      onTurnStalledTracked,
      onContextCompacting,
      onContextCompacted,
      onContextCompactionFailed,
      onThreadSessionIdUpdated,
    ],
  );

  return handlers;
}
