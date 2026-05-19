import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type { CustomPromptOption, DebugEntry, WorkspaceInfo } from "../../../types";
import { useAppServerEvents } from "../../app/hooks/useAppServerEvents";
import { subscribeWebServiceReconnect } from "../../../services/events";
import { createInitialThreadState, threadReducer } from "./useThreadsReducer";
import {
  type PendingAssistantCompletion,
  type PendingMemoryCapture,
  buildMemoryTurnKey,
  joinPendingAssistantCompletionText,
  memoryDebugLog,
  normalizeAssistantOutputForMemory,
  normalizeDigestSummaryForMemory,
  PENDING_MEMORY_STALE_MS,
  upsertPendingAssistantCompletionSegment,
} from "./threadMemoryCaptureHelpers";
import { useThreadStorage } from "./useThreadStorage";
import { useThreadLinking } from "./useThreadLinking";
import { useThreadEventHandlers } from "./useThreadEventHandlers";
import { useThreadActions } from "./useThreadActions";
import { useThreadMessaging } from "./useThreadMessaging";
import { useThreadApprovals } from "./useThreadApprovals";
import { useThreadAccountInfo } from "./useThreadAccountInfo";
import { useThreadRateLimits } from "./useThreadRateLimits";
import { useThreadSelectors } from "./useThreadSelectors";
import { useThreadStatus } from "./useThreadStatus";
import { useThreadUserInput } from "./useThreadUserInput";
import { useThreadCompletionEmail } from "./useThreadCompletionEmail";
import { useThreadRealtimeHistoryReconcile } from "./useThreadRealtimeHistoryReconcile";
import {
  resolveClaudeContinuationThreadId as resolveClaudeContinuationThreadIdFromState,
  shouldShowHistoryLoadingForSelectionThread,
} from "../utils/claudeThreadContinuity";
import {
  resolvePendingThreadIdForSession,
  resolvePendingThreadIdForTurn,
} from "../utils/threadPendingResolution";
export {
  resolvePendingThreadIdForSession,
  resolvePendingThreadIdForTurn,
} from "../utils/threadPendingResolution";
import {
  mapDeleteErrorCode,
  shouldSettleDeleteAsSuccess,
  type ThreadDeleteErrorCode,
} from "../utils/threadDelete";
import {
  makeCustomNameKey,
  saveCustomName,
} from "../utils/threadStorage";
import { writeClientStoreValue } from "../../../services/clientStorage";
import { isWebServiceRuntime } from "../../../services/tauri/runtimeMode";
import {
  loadSidebarSnapshot,
  saveSidebarSnapshotThreads,
} from "../utils/sidebarSnapshot";
import {
  generateThreadTitle,
  listThreadTitles,
  resumeThread,
  setThreadTitle,
  projectMemoryCompleteTurn,
  deleteCodexSessions,
  noteWebServiceReconnected,
} from "../../../services/tauri";
import { buildAssistantOutputDigest } from "../../project-memory/utils/outputDigest";
import {
  classifyMemoryImportance,
  classifyMemoryKind,
} from "../../project-memory/utils/memoryKindClassifier";
import {
  shouldMergeOnAssistantCompleted,
  shouldMergeOnInputCapture,
} from "../utils/memoryCaptureRace";
import { buildItemsFromThread } from "../../../utils/threadItems";
import i18n from "../../../i18n";
import { clearSharedSessionBindingsForSharedThread } from "../../shared-session/runtime/sharedSessionBridge";
import {
  setSharedSessionSelectedEngine as setSharedSessionSelectedEngineService,
  syncSharedSessionSnapshot as syncSharedSessionSnapshotService,
} from "../../shared-session/services/sharedSessions";
import { normalizeSharedSessionEngine } from "../../shared-session/utils/sharedSessionEngines";
import { type ConversationCompletionEmailMetadata } from "../utils/conversationCompletionEmail";
import { buildThreadBackgroundActivityProjection } from "../utils/threadBackgroundActivityProjection";

const AUTO_TITLE_REQUEST_TIMEOUT_MS = 8_000;
const AUTO_TITLE_MAX_ATTEMPTS = 2;
const AUTO_TITLE_PENDING_STALE_MS = 20_000;
const THREAD_ERROR_DUPLICATE_WINDOW_MS = 8_000;
const THREAD_SWITCH_RESUME_DELAY_MS = 24;
const THREAD_SWITCH_LOADED_REFRESH_MS = 20_000;
const THREAD_ITEM_CACHE_MAX = 12;
const THREAD_ITEM_CACHE_TRIM_WATERMARK = 2;

function normalizeMemoryTurnId(turnId: string | null | undefined) {
  return turnId?.trim() || "__unknown_turn__";
}

function isSameMemoryTurn(
  leftTurnId: string | null | undefined,
  rightTurnId: string | null | undefined,
) {
  return normalizeMemoryTurnId(leftTurnId) === normalizeMemoryTurnId(rightTurnId);
}

function shouldKeepPendingCaptureForAdditionalAssistantSegments(
  pending: Pick<PendingMemoryCapture, "engine" | "threadId">,
) {
  return pending.engine === "codex" || !pending.threadId.includes(":");
}

type UseThreadsOptions = {
  activeWorkspace: WorkspaceInfo | null;
  onWorkspaceConnected: (id: string) => void;
  onDebug?: (entry: DebugEntry) => void;
  model?: string | null;
  effort?: string | null;
  collaborationMode?: Record<string, unknown> | null;
  resolveComposerSelection?: () => {
    id?: string | null;
    model: string | null;
    source?: string | null;
    effort: string | null;
    collaborationMode: Record<string, unknown> | null;
  };
  claudeThinkingVisible?: boolean;
  accessMode?: "default" | "read-only" | "current" | "full-access";
  steerEnabled?: boolean;
  customPrompts?: CustomPromptOption[];
  onMessageActivity?: () => void;
  activeEngine?: "claude" | "codex" | "gemini" | "opencode";
  useNormalizedRealtimeAdapters?: boolean;
  useUnifiedHistoryLoader?: boolean;
  resolveOpenCodeAgent?: (threadId: string | null) => string | null;
  resolveOpenCodeVariant?: (threadId: string | null) => string | null;
  resolveCollaborationUiMode?: (
    threadId: string,
  ) => "plan" | "code" | null;
  resolveCollaborationRuntimeMode?: (
    threadId: string,
  ) => "plan" | "code" | null;
  onCollaborationModeResolved?: (payload: {
    workspaceId: string;
    threadId: string;
    selectedUiMode: "plan" | "default";
    effectiveRuntimeMode: "plan" | "code";
    effectiveUiMode: "plan" | "default";
    fallbackReason: string | null;
  }) => void;
  runWithCreateSessionLoading?: <T>(
    params: {
      workspace: WorkspaceInfo;
      engine: "claude" | "codex" | "gemini" | "opencode";
    },
    action: () => Promise<T>,
  ) => Promise<T>;
};

export type { ThreadDeleteErrorCode } from "../utils/threadDelete";

export type ThreadDeleteResult = {
  threadId: string;
  success: boolean;
  code: ThreadDeleteErrorCode | null;
  message: string | null;
};

export function useThreads({
  activeWorkspace,
  onWorkspaceConnected,
  onDebug,
  model,
  effort,
  collaborationMode,
  resolveComposerSelection,
  claudeThinkingVisible,
  accessMode,
  steerEnabled = false,
  customPrompts = [],
  onMessageActivity,
  activeEngine = "claude",
  useNormalizedRealtimeAdapters = true,
  useUnifiedHistoryLoader = false,
  resolveOpenCodeAgent,
  resolveOpenCodeVariant,
  resolveCollaborationUiMode,
  resolveCollaborationRuntimeMode,
  onCollaborationModeResolved,
  runWithCreateSessionLoading,
}: UseThreadsOptions) {
  const [state, dispatch] = useReducer(
    threadReducer,
    loadSidebarSnapshot(),
    createInitialThreadState,
  );
  const loadedThreadsRef = useRef<Record<string, boolean>>({});
  const threadStatusByIdRef = useRef(state.threadStatusById);
  const itemsByThreadRef = useRef(state.itemsByThread);
  const activeTurnIdByThreadRef = useRef(state.activeTurnIdByThread);
  const threadsByWorkspaceRef = useRef(state.threadsByWorkspace);
  const activeWorkspaceRef = useRef(activeWorkspace);
  const activeThreadIdRef = useRef<string | null>(null);
  const loadedThreadLastRefreshAtRef = useRef<Record<string, number>>({});
  const lazyResumeTimerByWorkspaceRef = useRef<
    Record<string, ReturnType<typeof setTimeout> | null>
  >({});
  const historyLoadingThreadByWorkspaceRef = useRef<Record<string, string | null>>({});
  const activeThreadIdByWorkspaceRef = useRef(state.activeThreadIdByWorkspace);
  const replaceOnResumeRef = useRef<Record<string, boolean>>({});
  const pendingInterruptsRef = useRef<Set<string>>(new Set());
  const interruptedThreadsRef = useRef<Set<string>>(new Set());
  const codexCompactionInFlightByThreadRef = useRef<Record<string, boolean>>({});
  const pendingMemoryCaptureRef = useRef<Record<string, PendingMemoryCapture>>({});
  const pendingAssistantCompletionRef = useRef<Record<string, PendingAssistantCompletion>>({});
  const recentThreadErrorsRef = useRef<Record<string, { message: string; at: number }>>({});
  const handledClaudeExitPlanToolIdsRef = useRef<Set<string>>(new Set());
  const sharedSessionSyncTimerByThreadRef = useRef<
    Record<string, ReturnType<typeof setTimeout> | null>
  >({});
  const sharedSessionLastSignatureByThreadRef = useRef<Record<string, string>>({});
  const {
    customNamesRef,
    threadActivityRef,
    threadAliasesRef,
    pinnedThreadsVersion,
    getCustomName,
    resolveCanonicalThreadId,
    rememberThreadAlias,
    recordThreadActivity,
    pinThread,
    unpinThread,
    isThreadPinned,
    getPinTimestamp,
    markAutoTitlePending,
    clearAutoTitlePending,
    isAutoTitlePending,
    getAutoTitlePendingStartedAt,
    renameAutoTitlePendingKey,
    autoTitlePendingVersion: _autoTitlePendingVersion,
  } = useThreadStorage();

  const activeWorkspaceId = activeWorkspace?.id ?? null;
  const { activeThreadId, activeItems } = useThreadSelectors({
    activeWorkspaceId,
    activeThreadIdByWorkspace: state.activeThreadIdByWorkspace,
    itemsByThread: state.itemsByThread,
  });

  useEffect(() => {
    activeWorkspaceRef.current = activeWorkspace;
  }, [activeWorkspace]);

  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  const { refreshAccountRateLimits } = useThreadRateLimits({
    activeWorkspaceId,
    activeWorkspaceConnected: activeWorkspace?.connected,
    dispatch,
    onDebug,
  });
  const { refreshAccountInfo } = useThreadAccountInfo({
    activeWorkspaceId,
    activeWorkspaceConnected: activeWorkspace?.connected,
    dispatch,
    onDebug,
  });

  const { markProcessing, markReviewing, setActiveTurnId } = useThreadStatus({
    dispatch,
  });

  const pushThreadErrorMessage = useCallback(
    (threadId: string, message: string) => {
      const normalized = message.trim();
      if (normalized) {
        const now = Date.now();
        const recent = recentThreadErrorsRef.current[threadId];
        if (
          recent
          && recent.message === normalized
          && now - recent.at < THREAD_ERROR_DUPLICATE_WINDOW_MS
        ) {
          return;
        }
        recentThreadErrorsRef.current[threadId] = { message: normalized, at: now };
      }
      dispatch({
        type: "addAssistantMessage",
        threadId,
        text: message,
      });
      if (threadId !== activeThreadId) {
        dispatch({ type: "markUnread", threadId, hasUnread: true });
      }
    },
    [activeThreadId, dispatch],
  );

  const safeMessageActivity = useCallback(() => {
    try {
      void onMessageActivity?.();
    } catch {
      // Ignore refresh errors to avoid breaking the UI.
    }
  }, [onMessageActivity]);

  const getCompletionEmailMetadata = useCallback(
    (
      workspaceId: string,
      threadId: string,
      turnId: string,
    ): ConversationCompletionEmailMetadata => {
      const threadSummary =
        (threadsByWorkspaceRef.current[workspaceId] ?? []).find(
          (thread) => thread.id === threadId,
        ) ?? null;
      return {
        workspaceId,
        workspaceName:
          activeWorkspace?.id === workspaceId ? activeWorkspace.name : null,
        workspacePath:
          activeWorkspace?.id === workspaceId ? activeWorkspace.path : null,
        threadId,
        threadName: threadSummary?.name ?? null,
        turnId,
        engine: threadSummary?.engineSource ?? activeEngine ?? null,
      };
    },
    [activeEngine, activeWorkspace],
  );
  const {
    completionEmailIntentByThread,
    clearCompletionEmailIntent,
    toggleCompletionEmailIntent,
    setActiveTurnIdWithCompletionEmail,
    renameCompletionEmailIntentThread,
    settleCompletionEmailIntent,
  } = useThreadCompletionEmail({
    activeThreadId,
    activeTurnIdByThreadRef,
    itemsByThreadRef,
    resolveCanonicalThreadId,
    setActiveTurnId,
    getCompletionEmailMetadata,
    onDebug,
  });

  useEffect(() => {
    activeThreadIdByWorkspaceRef.current = state.activeThreadIdByWorkspace;
  }, [state.activeThreadIdByWorkspace]);

  useEffect(() => {
    Object.entries(state.threadsByWorkspace).forEach(([workspaceId, threads]) => {
      saveSidebarSnapshotThreads(workspaceId, threads);
    });
  }, [state.threadsByWorkspace]);

  useEffect(() => {
    threadStatusByIdRef.current = state.threadStatusById;
  }, [state.threadStatusById]);

  useEffect(() => {
    itemsByThreadRef.current = state.itemsByThread;
  }, [state.itemsByThread]);

  useEffect(() => {
    activeTurnIdByThreadRef.current = state.activeTurnIdByThread;
  }, [state.activeTurnIdByThread]);

  useEffect(() => {
    threadsByWorkspaceRef.current = state.threadsByWorkspace;
  }, [state.threadsByWorkspace]);

  useEffect(() => {
    return () => {
      Object.values(lazyResumeTimerByWorkspaceRef.current).forEach((timer) => {
        if (timer) {
          clearTimeout(timer);
        }
      });
      lazyResumeTimerByWorkspaceRef.current = {};
      historyLoadingThreadByWorkspaceRef.current = {};
      Object.values(sharedSessionSyncTimerByThreadRef.current).forEach((timer) => {
        if (timer) {
          clearTimeout(timer);
        }
      });
      sharedSessionSyncTimerByThreadRef.current = {};
    };
  }, []);
  const { applyCollabThreadLinks, applyCollabThreadLinksFromThread, updateThreadParent } =
    useThreadLinking({
      dispatch,
      threadParentById: state.threadParentById,
    });

  const handleWorkspaceConnected = useCallback(
    (workspaceId: string) => {
      onWorkspaceConnected(workspaceId);
      void refreshAccountRateLimits(workspaceId);
      void refreshAccountInfo(workspaceId);
    },
    [onWorkspaceConnected, refreshAccountRateLimits, refreshAccountInfo],
  );

  const isThreadHidden = useCallback(
    (workspaceId: string, threadId: string) =>
      Boolean(state.hiddenThreadIdsByWorkspace[workspaceId]?.[threadId]),
    [state.hiddenThreadIdsByWorkspace],
  );

  const getThreadEngine = useCallback(
    (workspaceId: string, threadId: string): "claude" | "codex" | "gemini" | "opencode" | undefined => {
      const threads = state.threadsByWorkspace[workspaceId] ?? [];
      const thread = threads.find((t) => t.id === threadId);
      return thread?.engineSource;
    },
    [state.threadsByWorkspace],
  );

  const getThreadKind = useCallback(
    (workspaceId: string, threadId: string): "native" | "shared" => {
      const threads = state.threadsByWorkspace[workspaceId] ?? [];
      const thread = threads.find((t) => t.id === threadId);
      return thread?.threadKind === "shared" ? "shared" : "native";
    },
    [state.threadsByWorkspace],
  );

  const updateSharedSessionEngineSelection = useCallback(
    (
      workspaceId: string,
      threadId: string,
      engine: "claude" | "codex" | "gemini" | "opencode",
    ) => {
      const sharedEngine = normalizeSharedSessionEngine(engine);
      dispatch({
        type: "setThreadEngine",
        workspaceId,
        threadId,
        engine: sharedEngine,
      });
      if (!threadId.startsWith("shared:")) {
        return;
      }
      void setSharedSessionSelectedEngineService(
        workspaceId,
        threadId,
        sharedEngine,
      ).catch((error) => {
        onDebug?.({
          id: `${Date.now()}-shared-session-select-engine-error`,
          timestamp: Date.now(),
          source: "error",
          label: "shared-session/select-engine error",
          payload: error instanceof Error ? error.message : String(error),
        });
      });
    },
    [dispatch, onDebug],
  );

  const resolvePendingThreadForSession = useCallback(
    (
      workspaceId: string,
      engine: "claude" | "gemini" | "opencode",
    ): string | null => {
      const resolved = resolvePendingThreadIdForSession({
        workspaceId,
        engine,
        threadsByWorkspace: state.threadsByWorkspace,
        activeThreadIdByWorkspace: state.activeThreadIdByWorkspace,
        threadStatusById: state.threadStatusById,
        activeTurnIdByThread: state.activeTurnIdByThread,
        itemsByThread: state.itemsByThread,
      });
      const pendingPrefix = `${engine}-pending-`;
      const pendingCandidates = (state.threadsByWorkspace[workspaceId] ?? [])
        .map((thread) => thread.id)
        .filter((threadId) => threadId.startsWith(pendingPrefix));
      onDebug?.({
        id: `${Date.now()}-thread-session-resolve`,
        timestamp: Date.now(),
        source: "client",
        label: "thread/session:resolve-pending",
        payload: {
          workspaceId,
          engine,
          activeThreadId: state.activeThreadIdByWorkspace[workspaceId] ?? null,
          pendingCandidates,
          resolved,
          anchors: pendingCandidates.map((threadId) => ({
            threadId,
            hasTurn: (state.activeTurnIdByThread[threadId] ?? null) !== null,
            itemCount: state.itemsByThread[threadId]?.length ?? 0,
            isProcessing: Boolean(state.threadStatusById[threadId]?.isProcessing),
          })),
        },
      });
      return resolved;
    },
    [
      onDebug,
      state.activeThreadIdByWorkspace,
      state.activeTurnIdByThread,
      state.itemsByThread,
      state.threadStatusById,
      state.threadsByWorkspace,
    ],
  );

  const resolvePendingThreadForTurn = useCallback(
    (
      workspaceId: string,
      engine: "claude" | "gemini" | "opencode",
      turnId: string | null | undefined,
    ): string | null =>
      resolvePendingThreadIdForTurn({
        workspaceId,
        engine,
        turnId,
        threadsByWorkspace: state.threadsByWorkspace,
        activeThreadIdByWorkspace: state.activeThreadIdByWorkspace,
        activeTurnIdByThread: state.activeTurnIdByThread,
      }),
    [
      state.activeThreadIdByWorkspace,
      state.activeTurnIdByThread,
      state.threadsByWorkspace,
    ],
  );

  const resolveClaudeContinuationThreadId = useCallback(
    (
      workspaceId: string,
      threadId: string,
      turnId?: string | null,
    ) =>
      resolveClaudeContinuationThreadIdFromState({
        workspaceId,
        threadId,
        turnId,
        resolveCanonicalThreadId,
        resolvePendingThreadForSession,
        getActiveTurnIdForThread: (candidateThreadId) =>
          state.activeTurnIdByThread[candidateThreadId] ?? null,
      }),
    [resolveCanonicalThreadId, resolvePendingThreadForSession, state.activeTurnIdByThread],
  );

  const {
    approvalAllowlistRef,
    handleApprovalDecision,
    handleApprovalBatchAccept,
    handleApprovalRemember,
  } = useThreadApprovals({
    dispatch,
    onDebug,
    resolveClaudeContinuationThreadId,
  });
  const { handleUserInputSubmit, handleUserInputDismiss } = useThreadUserInput({
    dispatch,
    resolveClaudeContinuationThreadId,
  });

  const renameCustomNameKey = useCallback(
    (workspaceId: string, oldThreadId: string, newThreadId: string) => {
      const fromKey = makeCustomNameKey(workspaceId, oldThreadId);
      const value = customNamesRef.current[fromKey];
      if (!value) {
        return;
      }
      const toKey = makeCustomNameKey(workspaceId, newThreadId);
      const next = { ...customNamesRef.current };
      delete next[fromKey];
      next[toKey] = value;
      customNamesRef.current = next;
      writeClientStoreValue("threads", "customNames", next);
    },
    [customNamesRef],
  );

  const collectRelatedThreadIds = useCallback(
    (threadId: string): string[] => {
      const canonicalThreadId = resolveCanonicalThreadId(threadId);
      const related = new Set<string>([threadId, canonicalThreadId]);
      Object.entries(threadAliasesRef.current).forEach(([sourceThreadId, targetThreadId]) => {
        if (resolveCanonicalThreadId(sourceThreadId) !== canonicalThreadId) {
          return;
        }
        related.add(sourceThreadId);
        related.add(targetThreadId);
      });
      return Array.from(related);
    },
    [resolveCanonicalThreadId, threadAliasesRef],
  );

  const renamePendingMemoryCaptureKey = useCallback(
    (oldThreadId: string, newThreadId: string) => {
      renameCompletionEmailIntentThread(oldThreadId, newThreadId);
      rememberThreadAlias(oldThreadId, newThreadId);
      const oldCanonicalThreadId = resolveCanonicalThreadId(oldThreadId);
      const newCanonicalThreadId = resolveCanonicalThreadId(newThreadId);
      const pendingEntries = Object.entries(pendingMemoryCaptureRef.current).filter(
        ([, entry]) =>
          entry.threadId === oldThreadId || entry.threadId === oldCanonicalThreadId,
      );
      if (pendingEntries.length > 0) {
        memoryDebugLog("rename pending capture key", {
          oldThreadId,
          newThreadId,
          count: pendingEntries.length,
        });
        pendingEntries.forEach(([key, pending]) => {
          delete pendingMemoryCaptureRef.current[key];
          pendingMemoryCaptureRef.current[
            buildMemoryTurnKey(newCanonicalThreadId, pending.turnId)
          ] = {
            ...pending,
            threadId: newCanonicalThreadId,
          };
        });
      }
      const completedEntries = Object.entries(pendingAssistantCompletionRef.current).filter(
        ([, entry]) =>
          entry.threadId === oldThreadId || entry.threadId === oldCanonicalThreadId,
      );
      if (completedEntries.length === 0) {
        return;
      }
      memoryDebugLog("rename pending assistant completion key", {
        oldThreadId,
        newThreadId,
        count: completedEntries.length,
      });
      completedEntries.forEach(([key, completed]) => {
        delete pendingAssistantCompletionRef.current[key];
        pendingAssistantCompletionRef.current[
          buildMemoryTurnKey(newCanonicalThreadId, completed.turnId)
        ] = {
          ...completed,
          threadId: newCanonicalThreadId,
        };
      });
    },
    [rememberThreadAlias, renameCompletionEmailIntentThread, resolveCanonicalThreadId],
  );

  const {
    startThreadForWorkspace,
    startSharedSessionForWorkspace,
    forkThreadForWorkspace,
    forkSessionFromMessageForWorkspace,
    forkClaudeSessionFromMessageForWorkspace,
    resumeThreadForWorkspace,
    refreshThread: rawRefreshThread,
    resetWorkspaceThreads,
    listThreadsForWorkspace,
    loadOlderThreadsForWorkspace,
    deleteThreadForWorkspace,
    renameThreadTitleMapping,
    setThreadHistoryLoading,
    historyLoadingByThreadId,
  } = useThreadActions({
    dispatch,
    itemsByThread: state.itemsByThread,
    userInputRequests: state.userInputRequests,
    threadsByWorkspace: state.threadsByWorkspace,
    activeThreadIdByWorkspace: state.activeThreadIdByWorkspace,
    threadListCursorByWorkspace: state.threadListCursorByWorkspace,
    threadStatusById: state.threadStatusById,
    onDebug,
    getCustomName,
    threadActivityRef,
    loadedThreadsRef,
    replaceOnResumeRef,
    applyCollabThreadLinksFromThread,
    updateThreadParent,
    rememberThreadAlias,
    onThreadTitleMappingsLoaded: (workspaceId, titles) => {
      Object.entries(titles).forEach(([threadId, title]) => {
        if (!threadId.trim() || !title.trim()) {
          return;
        }
        saveCustomName(workspaceId, threadId, title);
        const key = makeCustomNameKey(workspaceId, threadId);
        customNamesRef.current[key] = title;
        dispatch({ type: "setThreadName", workspaceId, threadId, name: title });
      });
    },
    onRenameThreadTitleMapping: (workspaceId, oldThreadId, _newThreadId) => {
      clearAutoTitlePending(workspaceId, oldThreadId);
    },
    useUnifiedHistoryLoader,
  });

  const refreshThread = useCallback(
    async (workspaceId: string, threadId: string) => {
      const canonicalThreadId = resolveCanonicalThreadId(threadId);
      if (threadId !== canonicalThreadId) {
        dispatch({
          type: "setActiveThreadId",
          workspaceId,
          threadId: canonicalThreadId,
        });
      }
      return rawRefreshThread(workspaceId, canonicalThreadId);
    },
    [dispatch, rawRefreshThread, resolveCanonicalThreadId],
  );

  const { handleTurnCompletedForHistoryReconcile } =
    useThreadRealtimeHistoryReconcile({
      itemsByThreadRef,
      onDebug,
      refreshThread,
      resolveCanonicalThreadId,
      threadStatusByIdRef,
      threadsByWorkspace: state.threadsByWorkspace,
    });

  useEffect(() => {
    if (!isWebServiceRuntime()) {
      return undefined;
    }
    return subscribeWebServiceReconnect(() => {
      const workspace = activeWorkspaceRef.current;
      if (!workspace) {
        return;
      }
      onDebug?.({
        id: `${Date.now()}-web-service-reconnect-refresh`,
        timestamp: Date.now(),
        source: "client",
        label: "web-service/reconnect refresh",
        payload: {
          workspaceId: workspace.id,
        },
      });
      void noteWebServiceReconnected(workspace.id).catch((error) => {
        onDebug?.({
          id: `${Date.now()}-web-service-reconnect-runtime-evidence-error`,
          timestamp: Date.now(),
          source: "error",
          label: "web-service/reconnect runtime evidence error",
          payload: {
            workspaceId: workspace.id,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      });
      void listThreadsForWorkspace(workspace, {
        preserveState: true,
        recoverySource: "web-service-reconnected",
      }).catch((error) => {
        onDebug?.({
          id: `${Date.now()}-web-service-reconnect-refresh-error`,
          timestamp: Date.now(),
          source: "error",
          label: "web-service/reconnect refresh error",
          payload: {
            workspaceId: workspace.id,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      });

      const activeThreadIdForWorkspace = activeThreadIdRef.current;
      if (
        !activeThreadIdForWorkspace ||
        !threadStatusByIdRef.current[activeThreadIdForWorkspace]?.isProcessing
      ) {
        return;
      }
      void refreshThread(workspace.id, activeThreadIdForWorkspace).catch((error) => {
        onDebug?.({
          id: `${Date.now()}-web-service-reconnect-thread-refresh-error`,
          timestamp: Date.now(),
          source: "error",
          label: "web-service/reconnect thread refresh error",
          payload: {
            workspaceId: workspace.id,
            threadId: activeThreadIdForWorkspace,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      });
    });
  }, [listThreadsForWorkspace, onDebug, refreshThread]);

  const startThread = useCallback(async () => {
    if (!activeWorkspaceId) {
      return null;
    }
    return startThreadForWorkspace(activeWorkspaceId, { engine: activeEngine });
  }, [activeWorkspaceId, activeEngine, startThreadForWorkspace]);

  const ensureThreadForActiveWorkspace = useCallback(async () => {
    if (!activeWorkspace) {
      return null;
    }
    const canonicalActiveThreadId = activeThreadId
      ? resolveCanonicalThreadId(activeThreadId)
      : activeThreadId;
    if (activeThreadId && canonicalActiveThreadId !== activeThreadId) {
      dispatch({
        type: "setActiveThreadId",
        workspaceId: activeWorkspace.id,
        threadId: canonicalActiveThreadId,
      });
    }
    let threadId = canonicalActiveThreadId;
    if (!threadId) {
      threadId = await startThreadForWorkspace(activeWorkspace.id, { engine: activeEngine });
      if (!threadId) {
        return null;
      }
    } else if (!loadedThreadsRef.current[threadId]) {
      threadId = await resumeThreadForWorkspace(activeWorkspace.id, threadId);
    }
    return threadId;
  }, [
    activeWorkspace,
    activeThreadId,
    activeEngine,
    dispatch,
    resolveCanonicalThreadId,
    resumeThreadForWorkspace,
    startThreadForWorkspace,
  ]);

  const ensureThreadForWorkspace = useCallback(
    async (workspaceId: string) => {
      const currentActiveThreadId = state.activeThreadIdByWorkspace[workspaceId] ?? null;
      const shouldActivate = workspaceId === activeWorkspaceId;
      const canonicalActiveThreadId = currentActiveThreadId
        ? resolveCanonicalThreadId(currentActiveThreadId)
        : currentActiveThreadId;
      let threadId = canonicalActiveThreadId;
      if (!threadId) {
        threadId = await startThreadForWorkspace(workspaceId, {
          activate: shouldActivate,
          engine: activeEngine,
        });
        if (!threadId) {
          return null;
        }
      } else if (!loadedThreadsRef.current[threadId]) {
        threadId = await resumeThreadForWorkspace(workspaceId, threadId);
      }
      if (currentActiveThreadId && canonicalActiveThreadId !== currentActiveThreadId) {
        dispatch({ type: "setActiveThreadId", workspaceId, threadId: canonicalActiveThreadId });
      }
      if (shouldActivate && currentActiveThreadId !== threadId) {
        dispatch({ type: "setActiveThreadId", workspaceId, threadId });
      }
      return threadId;
    },
    [
      activeWorkspaceId,
      activeEngine,
      dispatch,
      loadedThreadsRef,
      resolveCanonicalThreadId,
      resumeThreadForWorkspace,
      startThreadForWorkspace,
      state.activeThreadIdByWorkspace,
    ],
  );

  useEffect(() => {
    Object.entries(state.activeThreadIdByWorkspace).forEach(([workspaceId, threadId]) => {
      if (!threadId) {
        return;
      }
      const canonicalThreadId = resolveCanonicalThreadId(threadId);
      if (canonicalThreadId === threadId) {
        return;
      }
      dispatch({
        type: "setActiveThreadId",
        workspaceId,
        threadId: canonicalThreadId,
      });
    });
  }, [dispatch, resolveCanonicalThreadId, state.activeThreadIdByWorkspace]);

  const autoNameThread = useCallback(
    async (
      workspaceId: string,
      threadId: string,
      sourceText: string,
      options?: { force?: boolean; clearPendingOnSkip?: boolean },
    ): Promise<string | null> => {
      const key = makeCustomNameKey(workspaceId, threadId);
      const hasCustomName = Boolean(customNamesRef.current[key]);
      if (hasCustomName && !options?.force) {
        onDebug?.({
          id: `${Date.now()}-thread-title-skip-custom`,
          timestamp: Date.now(),
          source: "client",
          label: "thread/title skipped",
          payload: { workspaceId, threadId, reason: "has-custom-name" },
        });
        if (options?.clearPendingOnSkip) {
          clearAutoTitlePending(workspaceId, threadId);
        }
        return null;
      }

      const message = sourceText.trim();
      if (!message) {
        onDebug?.({
          id: `${Date.now()}-thread-title-skip-empty`,
          timestamp: Date.now(),
          source: "client",
          label: "thread/title skipped",
          payload: { workspaceId, threadId, reason: "empty-source-text" },
        });
        if (options?.clearPendingOnSkip) {
          clearAutoTitlePending(workspaceId, threadId);
        }
        return null;
      }

      const pendingStartedAt = getAutoTitlePendingStartedAt(workspaceId, threadId);
      if (pendingStartedAt) {
        const pendingAgeMs = Date.now() - pendingStartedAt;
        if (pendingAgeMs >= AUTO_TITLE_PENDING_STALE_MS) {
          onDebug?.({
            id: `${Date.now()}-thread-title-pending-timeout-reset`,
            timestamp: Date.now(),
            source: "client",
            label: "thread/title pending reset",
            payload: {
              workspaceId,
              threadId,
              pendingStartedAt,
              pendingAgeMs,
              reason: "timeout",
            },
          });
          clearAutoTitlePending(workspaceId, threadId);
        } else {
          onDebug?.({
            id: `${Date.now()}-thread-title-skip-pending`,
            timestamp: Date.now(),
            source: "client",
            label: "thread/title skipped",
            payload: {
              workspaceId,
              threadId,
              reason: "already-pending",
              pendingStartedAt,
              pendingAgeMs,
            },
          });
          return null;
        }
      }

      if (isAutoTitlePending(workspaceId, threadId)) {
        onDebug?.({
          id: `${Date.now()}-thread-title-skip-pending-after-reset`,
          timestamp: Date.now(),
          source: "client",
          label: "thread/title skipped",
          payload: { workspaceId, threadId, reason: "already-pending-after-reset" },
        });
        return null;
      }

      markAutoTitlePending(workspaceId, threadId);
      const markAt = getAutoTitlePendingStartedAt(workspaceId, threadId);
      onDebug?.({
        id: `${Date.now()}-thread-title-generate-start`,
        timestamp: Date.now(),
        source: "client",
        label: "thread/title generate",
        payload: {
          workspaceId,
          threadId,
          force: Boolean(options?.force),
          pendingStartedAt: markAt,
        },
      });

      try {
        const applyGeneratedTitle = (title: string, source: "generated" | "recovered") => {
          saveCustomName(workspaceId, threadId, title);
          const nextKey = makeCustomNameKey(workspaceId, threadId);
          customNamesRef.current[nextKey] = title;
          dispatch({ type: "setThreadName", workspaceId, threadId, name: title });
          onDebug?.({
            id: `${Date.now()}-thread-title-${source}-success`,
            timestamp: Date.now(),
            source: "server",
            label: source === "generated" ? "thread/title generated" : "thread/title recovered",
            payload: { workspaceId, threadId, title, source },
          });
          return title;
        };

        const generateWithTimeout = async (
          preferredLanguage: "zh" | "en",
        ): Promise<string> =>
          await new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
              reject(new Error("auto-title-timeout"));
            }, AUTO_TITLE_REQUEST_TIMEOUT_MS);

            void generateThreadTitle(
              workspaceId,
              threadId,
              message,
              preferredLanguage,
            ).then(
              (value) => {
                clearTimeout(timeoutId);
                resolve(value);
              },
              (error) => {
                clearTimeout(timeoutId);
                reject(error);
              },
            );
          });

        const language = i18n.language.toLowerCase().startsWith("zh")
          ? "zh"
          : "en";
        for (let attempt = 1; attempt <= AUTO_TITLE_MAX_ATTEMPTS; attempt += 1) {
          const attemptStartedAt = Date.now();
          try {
            onDebug?.({
              id: `${Date.now()}-thread-title-attempt-start`,
              timestamp: Date.now(),
              source: "client",
              label: "thread/title attempt",
              payload: {
                workspaceId,
                threadId,
                attempt,
                maxAttempts: AUTO_TITLE_MAX_ATTEMPTS,
                timeoutMs: AUTO_TITLE_REQUEST_TIMEOUT_MS,
                language,
              },
            });

            const generated = await generateWithTimeout(language);
            const title = generated.trim();
            if (!title) {
              throw new Error("empty-generated-title");
            }
            return applyGeneratedTitle(title, "generated");
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const isTimeout = errorMessage.includes("auto-title-timeout");
            const elapsedMs = Date.now() - attemptStartedAt;

            onDebug?.({
              id: `${Date.now()}-thread-title-attempt-failed`,
              timestamp: Date.now(),
              source: isTimeout ? "client" : "error",
              label: "thread/title attempt failed",
              payload: {
                workspaceId,
                threadId,
                attempt,
                maxAttempts: AUTO_TITLE_MAX_ATTEMPTS,
                isTimeout,
                elapsedMs,
                error: errorMessage,
              },
            });

            if (isTimeout) {
              await new Promise((resolve) => setTimeout(resolve, 1200));
            }

            try {
              const mappedTitles = await listThreadTitles(workspaceId);
              const recovered = mappedTitles[threadId]?.trim();
              if (recovered) {
                return applyGeneratedTitle(recovered, "recovered");
              }
            } catch (recoveryError) {
              onDebug?.({
                id: `${Date.now()}-thread-title-recovery-check-error`,
                timestamp: Date.now(),
                source: "error",
                label: "thread/title recovery error",
                payload:
                  recoveryError instanceof Error
                    ? recoveryError.message
                    : String(recoveryError),
              });
            }

            if (attempt < AUTO_TITLE_MAX_ATTEMPTS) {
              onDebug?.({
                id: `${Date.now()}-thread-title-retry`,
                timestamp: Date.now(),
                source: "client",
                label: "thread/title retry",
                payload: {
                  workspaceId,
                  threadId,
                  nextAttempt: attempt + 1,
                  maxAttempts: AUTO_TITLE_MAX_ATTEMPTS,
                },
              });
              continue;
            }

            onDebug?.({
              id: `${Date.now()}-thread-title-generate-error`,
              timestamp: Date.now(),
              source: "error",
              label: "thread/title generate error",
              payload: {
                workspaceId,
                threadId,
                attempt,
                maxAttempts: AUTO_TITLE_MAX_ATTEMPTS,
                error: errorMessage,
              },
            });
            return null;
          }
        }

        return null;
      } catch (error) {
        onDebug?.({
          id: `${Date.now()}-thread-title-generate-error`,
          timestamp: Date.now(),
          source: "error",
          label: "thread/title generate error",
          payload: {
            workspaceId,
            threadId,
            error: error instanceof Error ? error.message : String(error),
          },
        });
        return null;
      } finally {
        clearAutoTitlePending(workspaceId, threadId);
      }
    },
    [
      clearAutoTitlePending,
      customNamesRef,
      dispatch,
      getAutoTitlePendingStartedAt,
      isAutoTitlePending,
      markAutoTitlePending,
      onDebug,
    ],
  );

  const mergeMemoryFromPendingCapture = useCallback(
    (
      pending: Omit<PendingMemoryCapture, "createdAt">,
      payload: { threadId: string; itemId: string; text: string },
    ) => {
      const normalizedAssistantOutput = normalizeAssistantOutputForMemory(
        payload.text,
      );
      const digest = buildAssistantOutputDigest(normalizedAssistantOutput);
      const normalizedSummary =
        digest ? normalizeDigestSummaryForMemory(digest.summary) || digest.summary : "";
      const mergedDetail = [
        `用户输入：\n${pending.inputText}`,
        `AI 回复：\n${normalizedAssistantOutput}`,
      ].join("\n\n");
      const classifiedKind = classifyMemoryKind(mergedDetail);
      const mergedKind = classifiedKind === "note" ? "conversation" : classifiedKind;
      const mergedImportance = classifyMemoryImportance(mergedDetail);

      const mergeWrite = async () => {
        try {
          await projectMemoryCompleteTurn({
            workspaceId: pending.workspaceId,
            threadId: payload.threadId,
            turnId: pending.turnId,
            memoryId: pending.memoryId,
            kind: mergedKind,
            userInput: pending.inputText,
            assistantResponse: normalizedAssistantOutput,
            assistantMessageId: payload.itemId,
            title: digest?.title ?? "",
            summary: normalizedSummary,
            importance: mergedImportance,
            workspaceName: pending.workspaceName,
            workspacePath: pending.workspacePath,
            engine: pending.engine,
          });
          memoryDebugLog("merge write completed turn memory", {
            threadId: payload.threadId,
            turnId: pending.turnId,
            itemId: payload.itemId,
            assistantResponseLength: normalizedAssistantOutput.length,
          });
        } catch (completeErr) {
          if (import.meta.env.DEV) {
            console.warn("[project-memory] merge complete failed:", {
              threadId: payload.threadId,
              error: completeErr,
            });
          }
          memoryDebugLog("merge complete failed", {
            threadId: payload.threadId,
            error: completeErr instanceof Error ? completeErr.message : String(completeErr),
          });
        }
      };

      void mergeWrite();
    },
    [],
  );

  /** 输入侧采集成功后，将 pending 数据存入 ref（仅保留该 thread 最新一条） */
  const handleInputMemoryCaptured = useCallback(
    (payload: {
      workspaceId: string;
      threadId: string;
      turnId: string;
      inputText: string;
      memoryId: string | null;
      workspaceName: string | null;
      workspacePath: string | null;
      engine: string | null;
    }) => {
      const canonicalThreadId = resolveCanonicalThreadId(payload.threadId);
      const normalizedPayload = {
        ...payload,
        threadId: canonicalThreadId,
      };
      const captureKey = buildMemoryTurnKey(canonicalThreadId, payload.turnId);
      pendingMemoryCaptureRef.current[captureKey] = {
        ...normalizedPayload,
        createdAt: Date.now(),
      };
      const completedThreadIds = collectRelatedThreadIds(canonicalThreadId);
      const completedEntry = completedThreadIds
        .flatMap((threadId) =>
          Object.entries(pendingAssistantCompletionRef.current)
            .filter(([, completion]) => {
              if (completion.threadId !== threadId) {
                return false;
              }
              if (!completion.turnId || !payload.turnId) {
                return true;
              }
              return completion.turnId === payload.turnId;
            })
            .map(([key, completion]) => ({ key, threadId, completion })),
        )
        .find((entry) => Boolean(entry.completion));
      const nowMs = Date.now();
      if (
        completedEntry?.completion &&
        shouldMergeOnInputCapture(
          completedEntry.completion.createdAt,
          nowMs,
          PENDING_MEMORY_STALE_MS,
        )
      ) {
        const keepPendingCapture =
          shouldKeepPendingCaptureForAdditionalAssistantSegments(normalizedPayload);
        completedThreadIds.forEach((threadId) => {
          Object.entries(pendingAssistantCompletionRef.current).forEach(([key, entry]) => {
            if (
              entry.threadId === threadId &&
              isSameMemoryTurn(entry.turnId, payload.turnId)
            ) {
              if (!keepPendingCapture) {
                delete pendingAssistantCompletionRef.current[key];
              }
            }
          });
          Object.entries(pendingMemoryCaptureRef.current).forEach(([key, entry]) => {
            if (
              entry.threadId === threadId &&
              isSameMemoryTurn(entry.turnId, payload.turnId)
            ) {
              const isSameCanonicalEntry = key === captureKey;
              if (!keepPendingCapture || !isSameCanonicalEntry) {
                delete pendingMemoryCaptureRef.current[key];
              }
            }
          });
        });
        memoryDebugLog("capture resolved after assistant completion, merging now", {
          threadId: canonicalThreadId,
          itemId: completedEntry.completion.itemId,
          memoryId: normalizedPayload.memoryId,
        });
        mergeMemoryFromPendingCapture(normalizedPayload, {
          ...completedEntry.completion,
          threadId: canonicalThreadId,
          text: joinPendingAssistantCompletionText(completedEntry.completion),
        });
        return;
      }
      if (completedEntry) {
        delete pendingAssistantCompletionRef.current[completedEntry.key];
      }
      memoryDebugLog("input captured", {
        threadId: canonicalThreadId,
        turnId: payload.turnId,
        memoryId: payload.memoryId,
      });
    },
    [collectRelatedThreadIds, mergeMemoryFromPendingCapture, resolveCanonicalThreadId],
  );

  /**
   * 回合融合写入 —— assistant 输出完成后，与 pending 输入采集合并写入。
   * 优先 update（若输入侧已产生 memoryId），失败则回退 create。
   */
  const handleAgentMessageCompletedForMemory = useCallback(
    (payload: {
      workspaceId: string;
      threadId: string;
      turnId?: string | null;
      itemId: string;
      text: string;
    }) => {
      const canonicalThreadId = resolveCanonicalThreadId(payload.threadId);
      const completionTurnId = payload.turnId?.trim() || null;
      const sharedThread = (state.threadsByWorkspace[payload.workspaceId] ?? []).find(
        (thread) => thread.id === canonicalThreadId,
      );
      if (sharedThread?.threadKind === "shared" && sharedThread.engineSource) {
        dispatch({
          type: "upsertItem",
          workspaceId: payload.workspaceId,
          threadId: canonicalThreadId,
          item: {
            id: payload.itemId,
            kind: "message",
            role: "assistant",
            text: payload.text,
            engineSource: sharedThread.engineSource,
            isFinal: true,
          },
          hasCustomName: Boolean(getCustomName(payload.workspaceId, canonicalThreadId)),
        });
      }
      const relatedThreadIds = collectRelatedThreadIds(canonicalThreadId);
      const pendingEntry = relatedThreadIds
        .flatMap((threadId) =>
          Object.entries(pendingMemoryCaptureRef.current)
            .filter(([, capture]) => {
              if (capture.threadId !== threadId) {
                return false;
              }
              if (!completionTurnId || !capture.turnId) {
                return true;
              }
              return capture.turnId === completionTurnId;
            })
            .map(([key, capture]) => ({ key, threadId, capture })),
        )
        .find((entry) => Boolean(entry.capture));
      if (!pendingEntry?.capture) {
        const completionKey = buildMemoryTurnKey(canonicalThreadId, completionTurnId);
        pendingAssistantCompletionRef.current[completionKey] =
          upsertPendingAssistantCompletionSegment(
            pendingAssistantCompletionRef.current[completionKey],
            {
              ...payload,
              threadId: canonicalThreadId,
              turnId: completionTurnId,
            },
            Date.now(),
          );
        memoryDebugLog("assistant completed but no pending capture", {
          threadId: canonicalThreadId,
          turnId: completionTurnId,
          itemId: payload.itemId,
        });
        return;
      }
      if (
        !shouldMergeOnAssistantCompleted(
          pendingEntry.capture.createdAt,
          Date.now(),
          PENDING_MEMORY_STALE_MS,
        )
      ) {
        delete pendingMemoryCaptureRef.current[pendingEntry.key];
        memoryDebugLog("pending capture is stale, skip merge", {
          threadId: pendingEntry.threadId,
          turnId: pendingEntry.capture.turnId,
          itemId: payload.itemId,
        });
        return;
      }
      const completionKey = buildMemoryTurnKey(canonicalThreadId, pendingEntry.capture.turnId);
      const previousCompletion = pendingAssistantCompletionRef.current[completionKey];
      const previousAssistantText = previousCompletion
        ? joinPendingAssistantCompletionText(previousCompletion)
        : "";
      const nextCompletion = upsertPendingAssistantCompletionSegment(
        previousCompletion,
        {
          ...payload,
          threadId: canonicalThreadId,
          turnId: pendingEntry.capture.turnId,
        },
        Date.now(),
      );
      pendingAssistantCompletionRef.current[completionKey] = nextCompletion;
      const mergedAssistantText = joinPendingAssistantCompletionText(nextCompletion);
      if (previousAssistantText === mergedAssistantText) {
        memoryDebugLog("assistant completed text unchanged, skip memory rewrite", {
          threadId: canonicalThreadId,
          turnId: pendingEntry.capture.turnId,
          itemId: payload.itemId,
        });
        return;
      }
      const keepPendingCapture =
        shouldKeepPendingCaptureForAdditionalAssistantSegments(pendingEntry.capture);
      relatedThreadIds.forEach((threadId) => {
        Object.entries(pendingMemoryCaptureRef.current).forEach(([key, entry]) => {
          if (
            entry.threadId === threadId &&
            isSameMemoryTurn(entry.turnId, pendingEntry.capture.turnId)
          ) {
            const isSameCanonicalEntry = key === pendingEntry.key;
            if (!keepPendingCapture || !isSameCanonicalEntry) {
              delete pendingMemoryCaptureRef.current[key];
            }
          }
        });
        Object.entries(pendingAssistantCompletionRef.current).forEach(([key, entry]) => {
          if (
            entry.threadId === threadId &&
              isSameMemoryTurn(entry.turnId, pendingEntry.capture.turnId)
          ) {
            if (keepPendingCapture) {
              pendingAssistantCompletionRef.current[key] = nextCompletion;
            } else {
              delete pendingAssistantCompletionRef.current[key];
            }
          }
        });
      });
      mergeMemoryFromPendingCapture(pendingEntry.capture, {
        ...payload,
        threadId: canonicalThreadId,
        text: mergedAssistantText,
      });
    },
    [
      collectRelatedThreadIds,
      dispatch,
      getCustomName,
      mergeMemoryFromPendingCapture,
      resolveCanonicalThreadId,
      state.threadsByWorkspace,
    ],
  );

  const {
    handleFusionStalled,
    interruptTurn: rawInterruptTurn,
    sendUserMessage,
    sendUserMessageToThread,
    startFork,
    startReview,
    startResume,
    startMcp,
    startSpecRoot,
    startStatus,
    startContext,
    startCompact,
    startFast,
    startMode,
    startExport,
    startImport,
    startLsp,
    startShare,
    reviewPrompt,
    openReviewPrompt,
    closeReviewPrompt,
    showPresetStep,
    choosePreset,
    highlightedPresetIndex,
    setHighlightedPresetIndex,
    highlightedBranchIndex,
    setHighlightedBranchIndex,
    highlightedCommitIndex,
    setHighlightedCommitIndex,
    handleReviewPromptKeyDown,
    confirmBranch,
    selectBranch,
    selectBranchAtIndex,
    selectCommit,
    selectCommitAtIndex,
    confirmCommit,
    updateCustomInstructions,
    confirmCustom,
  } = useThreadMessaging({
    activeWorkspace,
    activeThreadId,
    accessMode,
    model,
    effort,
    collaborationMode,
    resolveComposerSelection,
    claudeThinkingVisible,
    steerEnabled,
    customPrompts,
    activeEngine,
    threadStatusById: state.threadStatusById,
    itemsByThread: state.itemsByThread,
    activeTurnIdByThread: state.activeTurnIdByThread,
    codexAcceptedTurnByThread: state.codexAcceptedTurnByThread,
    tokenUsageByThread: state.tokenUsageByThread,
    rateLimitsByWorkspace: state.rateLimitsByWorkspace,
    codexCompactionInFlightByThreadRef,
    pendingInterruptsRef,
    interruptedThreadsRef,
    dispatch,
    getCustomName,
    getThreadEngine,
    getThreadKind,
    markProcessing,
    markReviewing,
    setActiveTurnId: setActiveTurnIdWithCompletionEmail,
    recordThreadActivity,
    safeMessageActivity,
    onDebug,
    pushThreadErrorMessage,
    ensureThreadForActiveWorkspace,
    ensureThreadForWorkspace,
    refreshThread,
    forkThreadForWorkspace,
    updateThreadParent,
    startThreadForWorkspace,
    resolveOpenCodeAgent,
    resolveOpenCodeVariant,
    onInputMemoryCaptured: handleInputMemoryCaptured,
    resolveCollaborationRuntimeMode,
    runWithCreateSessionLoading,
  });

  const interruptTurn = useCallback(
    async (options?: { reason?: "user-stop" | "queue-fusion" | "plan-handoff" }) => {
      const interruptedThreadId = activeThreadId;
      const interruptedTurnId = interruptedThreadId
        ? activeTurnIdByThreadRef.current[interruptedThreadId] ?? null
        : null;
      try {
        await rawInterruptTurn(options);
      } finally {
        if (interruptedThreadId) {
          clearCompletionEmailIntent(interruptedThreadId, interruptedTurnId);
        }
      }
    },
    [activeThreadId, clearCompletionEmailIntent, rawInterruptTurn],
  );

  const setActiveThreadId = useCallback(
    (threadId: string | null, workspaceId?: string) => {
      const targetId = workspaceId ?? activeWorkspaceId;
      if (!targetId) {
        return;
      }
      const clearHistoryLoadingForThread = (targetThreadId: string | null) => {
        if (!targetThreadId) {
          return;
        }
        setThreadHistoryLoading(targetThreadId, false);
        if (historyLoadingThreadByWorkspaceRef.current[targetId] === targetThreadId) {
          historyLoadingThreadByWorkspaceRef.current[targetId] = null;
        }
      };
      const canonicalThreadId = threadId ? resolveCanonicalThreadId(threadId) : null;
      dispatch({ type: "setActiveThreadId", workspaceId: targetId, threadId: canonicalThreadId });
      const previousTimer = lazyResumeTimerByWorkspaceRef.current[targetId];
      if (previousTimer) {
        clearTimeout(previousTimer);
        lazyResumeTimerByWorkspaceRef.current[targetId] = null;
      }
      const previousHistoryLoadingThreadId =
        historyLoadingThreadByWorkspaceRef.current[targetId] ?? null;
      if (
        previousHistoryLoadingThreadId &&
        previousHistoryLoadingThreadId !== canonicalThreadId
      ) {
        clearHistoryLoadingForThread(previousHistoryLoadingThreadId);
      }
      if (!canonicalThreadId) {
        return;
      }
      if (canonicalThreadId) {
        const now = Date.now();
        const isLoaded = Boolean(loadedThreadsRef.current[canonicalThreadId]);
        const isProcessing = Boolean(threadStatusByIdRef.current[canonicalThreadId]?.isProcessing);
        let lastRefreshAt = loadedThreadLastRefreshAtRef.current[canonicalThreadId] ?? 0;
        if (isLoaded && lastRefreshAt <= 0) {
          lastRefreshAt = now;
          loadedThreadLastRefreshAtRef.current[canonicalThreadId] = now;
        }
        const shouldRefreshLoaded =
          isLoaded && !isProcessing && now - lastRefreshAt >= THREAD_SWITCH_LOADED_REFRESH_MS;
        const shouldScheduleResume = !isLoaded || shouldRefreshLoaded;
        if (!shouldScheduleResume) {
          clearHistoryLoadingForThread(canonicalThreadId);
          return;
        }
        const shouldShowHistoryLoading =
          !isLoaded &&
          shouldShowHistoryLoadingForSelectionThread(canonicalThreadId);
        if (shouldShowHistoryLoading) {
          setThreadHistoryLoading(canonicalThreadId, true);
          historyLoadingThreadByWorkspaceRef.current[targetId] = canonicalThreadId;
        } else {
          clearHistoryLoadingForThread(canonicalThreadId);
        }
        lazyResumeTimerByWorkspaceRef.current[targetId] = setTimeout(() => {
          lazyResumeTimerByWorkspaceRef.current[targetId] = null;
          const activeThreadIdForWorkspace =
            activeThreadIdByWorkspaceRef.current[targetId] ?? null;
          if (activeThreadIdForWorkspace !== canonicalThreadId) {
            clearHistoryLoadingForThread(canonicalThreadId);
            return;
          }
          const loadedAtCallback = Boolean(loadedThreadsRef.current[canonicalThreadId]);
          if (!loadedAtCallback) {
            loadedThreadLastRefreshAtRef.current[canonicalThreadId] = Date.now();
            let resumeLoadingThreadId = canonicalThreadId;
            void resumeThreadForWorkspace(targetId, canonicalThreadId, false, false, {
              preferLocalCodexHistory: true,
            })
              .then((recoveredThreadId) => {
                const recoveredCanonicalThreadId = recoveredThreadId
                  ? resolveCanonicalThreadId(recoveredThreadId)
                  : null;
                if (
                  shouldShowHistoryLoading &&
                  recoveredCanonicalThreadId &&
                  recoveredCanonicalThreadId !== canonicalThreadId
                ) {
                  clearHistoryLoadingForThread(canonicalThreadId);
                  setThreadHistoryLoading(recoveredCanonicalThreadId, true);
                  historyLoadingThreadByWorkspaceRef.current[targetId] =
                    recoveredCanonicalThreadId;
                  resumeLoadingThreadId = recoveredCanonicalThreadId;
                }
                if (
                  recoveredCanonicalThreadId &&
                  recoveredCanonicalThreadId !== canonicalThreadId &&
                  activeThreadIdByWorkspaceRef.current[targetId] === canonicalThreadId
                ) {
                  onDebug?.({
                    id: `${Date.now()}-thread-selection-recovered-canonical`,
                    timestamp: Date.now(),
                    source: "client",
                    label: "thread/selection recovered canonical",
                    payload: {
                      workspaceId: targetId,
                      staleThreadId: canonicalThreadId,
                      recoveredThreadId: recoveredCanonicalThreadId,
                    },
                  });
                  dispatch({
                    type: "setActiveThreadId",
                    workspaceId: targetId,
                    threadId: recoveredCanonicalThreadId,
                  });
                }
              })
              .finally(() => {
                const currentLoadingThreadId =
                  historyLoadingThreadByWorkspaceRef.current[targetId] ?? null;
                if (currentLoadingThreadId === resumeLoadingThreadId) {
                  clearHistoryLoadingForThread(resumeLoadingThreadId);
                  return;
                }
                setThreadHistoryLoading(canonicalThreadId, false);
              });
            return;
          }
          clearHistoryLoadingForThread(canonicalThreadId);
          const processingAtCallback = Boolean(
            threadStatusByIdRef.current[canonicalThreadId]?.isProcessing,
          );
          if (processingAtCallback) {
            return;
          }
          const callbackLastRefreshAt =
            loadedThreadLastRefreshAtRef.current[canonicalThreadId] ?? 0;
          if (Date.now() - callbackLastRefreshAt < THREAD_SWITCH_LOADED_REFRESH_MS) {
            return;
          }
          loadedThreadLastRefreshAtRef.current[canonicalThreadId] = Date.now();
          void resumeThreadForWorkspace(targetId, canonicalThreadId, true, false, {
            preferLocalCodexHistory: true,
          }).then(
            (recoveredThreadId) => {
              const recoveredCanonicalThreadId = recoveredThreadId
                ? resolveCanonicalThreadId(recoveredThreadId)
                : null;
              if (
                recoveredCanonicalThreadId &&
                recoveredCanonicalThreadId !== canonicalThreadId &&
                activeThreadIdByWorkspaceRef.current[targetId] === canonicalThreadId
              ) {
                onDebug?.({
                  id: `${Date.now()}-thread-selection-recovered-canonical-refresh`,
                  timestamp: Date.now(),
                  source: "client",
                  label: "thread/selection recovered canonical",
                  payload: {
                    workspaceId: targetId,
                    staleThreadId: canonicalThreadId,
                    recoveredThreadId: recoveredCanonicalThreadId,
                    trigger: "refresh",
                  },
                });
                dispatch({
                  type: "setActiveThreadId",
                  workspaceId: targetId,
                  threadId: recoveredCanonicalThreadId,
                });
              }
            },
          );
        }, THREAD_SWITCH_RESUME_DELAY_MS);
      }
    },
    [
      activeWorkspaceId,
      dispatch,
      onDebug,
      resolveCanonicalThreadId,
      resumeThreadForWorkspace,
      setThreadHistoryLoading,
    ],
  );

  useEffect(() => {
    const loadedThreadIds = Object.entries(loadedThreadsRef.current)
      .filter(([, isLoaded]) => isLoaded)
      .map(([threadId]) => threadId);
    if (loadedThreadIds.length <= THREAD_ITEM_CACHE_MAX + THREAD_ITEM_CACHE_TRIM_WATERMARK) {
      return;
    }

    const threadWorkspaceMap = new Map<string, string>();
    Object.entries(state.threadsByWorkspace).forEach(([workspaceId, threads]) => {
      threads.forEach((thread) => {
        threadWorkspaceMap.set(thread.id, workspaceId);
      });
    });

    const protectedThreadIds = new Set<string>();
    Object.values(state.activeThreadIdByWorkspace).forEach((threadId) => {
      if (threadId) {
        protectedThreadIds.add(threadId);
      }
    });
    Object.entries(state.threadStatusById).forEach(([threadId, status]) => {
      if (status?.isProcessing) {
        protectedThreadIds.add(threadId);
      }
    });
    state.userInputRequests.forEach((request) => {
      const requestThreadId = request.params.thread_id;
      if (requestThreadId) {
        protectedThreadIds.add(requestThreadId);
      }
    });

    const protectedLoadedCount = loadedThreadIds.filter((threadId) => {
      if (protectedThreadIds.has(threadId)) {
        return true;
      }
      const workspaceId = threadWorkspaceMap.get(threadId);
      return workspaceId ? isThreadPinned(workspaceId, threadId) : false;
    }).length;
    const keepableSlots = Math.max(0, THREAD_ITEM_CACHE_MAX - protectedLoadedCount);

    const evictableCandidates = loadedThreadIds
      .filter((threadId) => {
        if (protectedThreadIds.has(threadId)) {
          return false;
        }
        const workspaceId = threadWorkspaceMap.get(threadId);
        if (workspaceId && isThreadPinned(workspaceId, threadId)) {
          return false;
        }
        return (state.itemsByThread[threadId]?.length ?? 0) > 0;
      })
      .map((threadId) => {
        const workspaceId = threadWorkspaceMap.get(threadId) ?? "";
        const activityTimestamp =
          threadActivityRef.current[workspaceId]?.[threadId] ??
          state.lastAgentMessageByThread[threadId]?.timestamp ??
          0;
        return { threadId, activityTimestamp };
      })
      .sort((left, right) => right.activityTimestamp - left.activityTimestamp);

    const evictedThreadIds = evictableCandidates
      .slice(keepableSlots)
      .map((entry) => entry.threadId);
    if (evictedThreadIds.length === 0) {
      return;
    }

    evictedThreadIds.forEach((threadId) => {
      loadedThreadsRef.current[threadId] = false;
    });
    dispatch({ type: "evictThreadItems", threadIds: evictedThreadIds });
  }, [
    isThreadPinned,
    pinnedThreadsVersion,
    state.activeThreadIdByWorkspace,
    state.itemsByThread,
    state.lastAgentMessageByThread,
    state.threadStatusById,
    state.threadsByWorkspace,
    state.userInputRequests,
    threadActivityRef,
  ]);

  useEffect(() => {
    Object.entries(state.threadsByWorkspace).forEach(([workspaceId, threads]) => {
      threads.forEach((thread) => {
        if (thread.threadKind !== "shared") {
          return;
        }
        if (!loadedThreadsRef.current[thread.id]) {
          const existingTimer = sharedSessionSyncTimerByThreadRef.current[thread.id];
          if (existingTimer) {
            clearTimeout(existingTimer);
            sharedSessionSyncTimerByThreadRef.current[thread.id] = null;
          }
          return;
        }
        const selectedEngine = normalizeSharedSessionEngine(
          thread.selectedEngine ?? thread.engineSource ?? "claude",
        );
        const items = state.itemsByThread[thread.id] ?? [];
        const signature = JSON.stringify({
          selectedEngine,
          items,
        });
        if (sharedSessionLastSignatureByThreadRef.current[thread.id] === signature) {
          return;
        }
        sharedSessionLastSignatureByThreadRef.current[thread.id] = signature;
        const existingTimer = sharedSessionSyncTimerByThreadRef.current[thread.id];
        if (existingTimer) {
          clearTimeout(existingTimer);
        }
        sharedSessionSyncTimerByThreadRef.current[thread.id] = setTimeout(() => {
          void syncSharedSessionSnapshotService(
            workspaceId,
            thread.id,
            items,
            selectedEngine,
          ).catch((error) => {
            onDebug?.({
              id: `${Date.now()}-shared-session-sync-error`,
              timestamp: Date.now(),
              source: "error",
              label: "shared-session/sync error",
              payload: error instanceof Error ? error.message : String(error),
            });
          });
        }, 320);
      });
    });
  }, [onDebug, state.itemsByThread, state.threadsByWorkspace]);

  const removeThread = useCallback(
    async (workspaceId: string, threadId: string): Promise<ThreadDeleteResult> => {
      const settleThreadDeletionLocally = (
        result: Omit<ThreadDeleteResult, "threadId">,
      ): ThreadDeleteResult => {
        loadedThreadsRef.current[threadId] = false;
        unpinThread(workspaceId, threadId);
        if (getThreadKind(workspaceId, threadId) === "shared") {
          clearSharedSessionBindingsForSharedThread(workspaceId, threadId);
        }
        dispatch({
          type: "clearUserInputRequestsForThread",
          workspaceId,
          threadId,
        });
        dispatch({ type: "removeThread", workspaceId, threadId });
        return {
          threadId,
          ...result,
        };
      };

      try {
        await deleteThreadForWorkspace(workspaceId, threadId);
        return settleThreadDeletionLocally({
          success: true,
          code: null,
          message: null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const code = mapDeleteErrorCode(message);
        if (shouldSettleDeleteAsSuccess(message)) {
          return settleThreadDeletionLocally({
            success: true,
            code: null,
            message: null,
          });
        }
        return {
          threadId,
          success: false,
          code,
          message,
        };
      }
    },
    [deleteThreadForWorkspace, dispatch, getThreadKind, loadedThreadsRef, unpinThread],
  );

  const removeThreads = useCallback(
    async (workspaceId: string, threadIds: string[]): Promise<ThreadDeleteResult[]> => {
      if (!workspaceId || threadIds.length === 0) {
        return [];
      }

      const workspaceThreads = state.threadsByWorkspace[workspaceId] ?? [];
      const codexThreadIds = threadIds.filter((threadId) => {
        const thread = workspaceThreads.find((entry) => entry.id === threadId);
        if (thread?.threadKind === "shared") {
          return false;
        }
        if (threadId.includes("-pending-") || threadId.includes(":")) {
          return false;
        }
        return thread?.engineSource !== "claude" &&
          thread?.engineSource !== "gemini" &&
          thread?.engineSource !== "opencode";
      });

      const codexResultByThreadId = new Map<string, ThreadDeleteResult>();
      if (codexThreadIds.length > 1) {
        try {
          const response = await deleteCodexSessions(workspaceId, codexThreadIds);
          response.results.forEach((result) => {
            const message = (result.error ?? "").trim() || "Failed to delete codex session";
            const code = mapDeleteErrorCode(message);
            if (result.deleted || shouldSettleDeleteAsSuccess(message)) {
              loadedThreadsRef.current[result.sessionId] = false;
              unpinThread(workspaceId, result.sessionId);
              dispatch({
                type: "clearUserInputRequestsForThread",
                workspaceId,
                threadId: result.sessionId,
              });
              dispatch({
                type: "removeThread",
                workspaceId,
                threadId: result.sessionId,
              });
              codexResultByThreadId.set(result.sessionId, {
                threadId: result.sessionId,
                success: true,
                code: null,
                message: null,
              });
              return;
            }
            codexResultByThreadId.set(result.sessionId, {
              threadId: result.sessionId,
              success: false,
              code,
              message,
            });
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          codexThreadIds.forEach((threadId) => {
            codexResultByThreadId.set(threadId, {
              threadId,
              success: false,
              code: mapDeleteErrorCode(message),
              message,
            });
          });
        }
      }

      const results: ThreadDeleteResult[] = [];
      for (const threadId of threadIds) {
        const fastPathResult = codexResultByThreadId.get(threadId);
        if (fastPathResult) {
          results.push(fastPathResult);
          continue;
        }
        results.push(await removeThread(workspaceId, threadId));
      }
      return results;
    },
    [dispatch, removeThread, state.threadsByWorkspace, unpinThread],
  );

  const renameThread = useCallback(
    (workspaceId: string, threadId: string, newName: string) => {
      saveCustomName(workspaceId, threadId, newName);
      void setThreadTitle(workspaceId, threadId, newName).catch(() => {
        // Keep local rename even if file persistence fails.
      });
      const key = makeCustomNameKey(workspaceId, threadId);
      customNamesRef.current[key] = newName;
      dispatch({ type: "setThreadName", workspaceId, threadId, name: newName });
      clearAutoTitlePending(workspaceId, threadId);
    },
    [clearAutoTitlePending, customNamesRef, dispatch],
  );

  const triggerAutoThreadTitle = useCallback(
    async (workspaceId: string, threadId: string, options?: { force?: boolean }) => {
      const items = state.itemsByThread[threadId] ?? [];
      const userMessage = items.find(
        (item) => item.kind === "message" && item.role === "user",
      );
      let text =
        userMessage && userMessage.kind === "message" ? userMessage.text : "";

      if (!text.trim() && !threadId.startsWith("claude:")) {
        try {
          const response = (await resumeThread(workspaceId, threadId)) as
            | Record<string, unknown>
            | null;
          const result = (response?.result ?? response) as
            | Record<string, unknown>
            | null;
          const thread = (result?.thread ?? response?.thread ?? null) as
            | Record<string, unknown>
            | null;
          if (thread) {
            const loadedItems = buildItemsFromThread(thread);
            const loadedFirstUserMessage = loadedItems.find(
              (item) => item.kind === "message" && item.role === "user",
            );
            if (
              loadedFirstUserMessage &&
              loadedFirstUserMessage.kind === "message" &&
              loadedFirstUserMessage.text.trim()
            ) {
              text = loadedFirstUserMessage.text;
              onDebug?.({
                id: `${Date.now()}-thread-title-manual-source-resume`,
                timestamp: Date.now(),
                source: "client",
                label: "thread/title manual source",
                payload: { workspaceId, threadId, source: "thread/resume" },
              });
            }
          }
        } catch (error) {
          onDebug?.({
            id: `${Date.now()}-thread-title-manual-source-resume-error`,
            timestamp: Date.now(),
            source: "error",
            label: "thread/title manual source error",
            payload: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (!text.trim()) {
        const fallbackName =
          state.threadsByWorkspace[workspaceId]
            ?.find((thread) => thread.id === threadId)
            ?.name?.trim() ?? "";
        if (fallbackName && !/^agent\s+\d+$/i.test(fallbackName)) {
          text = fallbackName;
          onDebug?.({
            id: `${Date.now()}-thread-title-manual-source-name`,
            timestamp: Date.now(),
            source: "client",
            label: "thread/title manual source",
            payload: { workspaceId, threadId, source: "thread/name" },
          });
        }
      }

      if (!text.trim()) {
        onDebug?.({
          id: `${Date.now()}-thread-title-manual-missing-source`,
          timestamp: Date.now(),
          source: "client",
          label: "thread/title manual skipped",
          payload: { workspaceId, threadId, reason: "no-user-message-found" },
        });
      }
      const generated = await autoNameThread(workspaceId, threadId, text, {
        force: options?.force ?? true,
        clearPendingOnSkip: true,
      });
      return generated;
    },
    [autoNameThread, onDebug, state.itemsByThread, state.threadsByWorkspace],
  );

  const isThreadAutoNaming = useCallback(
    (workspaceId: string, threadId: string) =>
      isAutoTitlePending(workspaceId, threadId),
    [isAutoTitlePending],
  );

  const handlers = useThreadEventHandlers({
    activeThreadId,
    dispatch,
    getCustomName,
    resolveCanonicalThreadId,
    resolveCollaborationUiMode,
    isAutoTitlePending,
    isThreadHidden,
    markProcessing,
    markReviewing,
    setActiveTurnId: setActiveTurnIdWithCompletionEmail,
    codexCompactionInFlightByThreadRef,
    safeMessageActivity,
    recordThreadActivity,
    pushThreadErrorMessage,
    onDebug,
    onWorkspaceConnected: handleWorkspaceConnected,
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
    getActiveTurnIdForThread: (threadId: string) =>
      state.activeTurnIdByThread[threadId] ?? null,
    renamePendingMemoryCaptureKey,
    onAgentMessageCompletedExternal: handleAgentMessageCompletedForMemory,
    onTurnCompletedExternal: (payload) => {
      handleTurnCompletedForHistoryReconcile(payload);
    },
    onTurnTerminalExternal: ({ workspaceId, threadId, turnId, status }) => {
      settleCompletionEmailIntent(workspaceId, threadId, turnId, status);
    },
    onCollaborationModeResolved: onCollaborationModeResolved
      ? (event) => {
          onCollaborationModeResolved({
            workspaceId: event.workspace_id,
            threadId: event.params.thread_id,
            selectedUiMode: event.params.selected_ui_mode,
            effectiveRuntimeMode: event.params.effective_runtime_mode,
            effectiveUiMode: event.params.effective_ui_mode,
            fallbackReason: event.params.fallback_reason ?? null,
          });
        }
      : undefined,
    onExitPlanModeToolCompleted: ({ threadId, itemId }) => {
      if (threadId !== activeThreadId) {
        return;
      }
      if (activeEngine !== "claude" || accessMode !== "read-only") {
        return;
      }
      const handoffKey = `${threadId}:${itemId}`;
      if (handledClaudeExitPlanToolIdsRef.current.has(handoffKey)) {
        return;
      }
      handledClaudeExitPlanToolIdsRef.current.add(handoffKey);
      void interruptTurn({ reason: "plan-handoff" });
    },
  });

  useAppServerEvents(handlers, {
    useNormalizedRealtimeAdapters,
  });

  const backgroundActivityByThread = useMemo(
    () =>
      Object.fromEntries(
        Object.keys(state.threadStatusById).map((threadId) => [
          threadId,
          buildThreadBackgroundActivityProjection({
            threadId,
            status: state.threadStatusById[threadId],
            approvals: state.approvals,
          }),
        ]),
      ),
    [state.approvals, state.threadStatusById],
  );

  return {
    activeThreadId,
    setActiveThreadId,
    activeItems,
    threadItemsByThread: state.itemsByThread,
    historyRestoredAtMsByThread: state.historyRestoredAtMsByThread,
    approvals: state.approvals,
    userInputRequests: state.userInputRequests,
    threadsByWorkspace: state.threadsByWorkspace,
    threadParentById: state.threadParentById,
    threadStatusById: state.threadStatusById,
    backgroundActivityByThread,
    historyLoadingByThreadId,
    threadListLoadingByWorkspace: state.threadListLoadingByWorkspace,
    threadListPagingByWorkspace: state.threadListPagingByWorkspace,
    threadListCursorByWorkspace: state.threadListCursorByWorkspace,
    activeTurnIdByThread: state.activeTurnIdByThread,
    completionEmailIntentByThread,
    toggleCompletionEmailIntent,
    tokenUsageByThread: state.tokenUsageByThread,
    rateLimitsByWorkspace: state.rateLimitsByWorkspace,
    accountByWorkspace: state.accountByWorkspace,
    planByThread: state.planByThread,
    lastAgentMessageByThread: state.lastAgentMessageByThread,
    refreshAccountRateLimits,
    refreshAccountInfo,
    interruptTurn,
    removeThread,
    removeThreads,
    pinThread,
    unpinThread,
    isThreadPinned,
    getPinTimestamp,
    pinnedThreadsVersion,
    renameThread,
    autoNameThread,
    triggerAutoThreadTitle,
    isThreadAutoNaming,
    startThread,
    startThreadForWorkspace,
    startSharedSessionForWorkspace,
    forkThreadForWorkspace,
    forkSessionFromMessageForWorkspace,
    forkClaudeSessionFromMessageForWorkspace,
    listThreadsForWorkspace,
    refreshThread,
    resetWorkspaceThreads,
    loadOlderThreadsForWorkspace,
    sendUserMessage,
    sendUserMessageToThread,
    handleFusionStalled,
    startFork,
    startReview,
    startResume,
    startMcp,
    startSpecRoot,
    startStatus,
    startContext,
    startCompact,
    startFast,
    startMode,
    startExport,
    startImport,
    startLsp,
    startShare,
    getThreadKind,
    updateSharedSessionEngineSelection,
    resolveCanonicalThreadId,
    reviewPrompt,
    openReviewPrompt,
    closeReviewPrompt,
    showPresetStep,
    choosePreset,
    highlightedPresetIndex,
    setHighlightedPresetIndex,
    highlightedBranchIndex,
    setHighlightedBranchIndex,
    highlightedCommitIndex,
    setHighlightedCommitIndex,
    handleReviewPromptKeyDown,
    confirmBranch,
    selectBranch,
    selectBranchAtIndex,
    selectCommit,
    selectCommitAtIndex,
    confirmCommit,
    updateCustomInstructions,
    confirmCustom,
    handleApprovalDecision,
    handleApprovalBatchAccept,
    handleApprovalRemember,
    handleUserInputSubmit,
    handleUserInputDismiss,
  };
}
