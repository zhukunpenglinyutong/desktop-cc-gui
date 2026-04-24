import { useCallback, useEffect, useReducer, useRef } from "react";
import type { CustomPromptOption, DebugEntry, WorkspaceInfo } from "../../../types";
import { useAppServerEvents } from "../../app/hooks/useAppServerEvents";
import { createInitialThreadState, threadReducer } from "./useThreadsReducer";
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
import {
  makeCustomNameKey,
  saveCustomName,
} from "../utils/threadStorage";
import { writeClientStoreValue } from "../../../services/clientStorage";
import {
  loadSidebarSnapshot,
  saveSidebarSnapshotThreads,
} from "../utils/sidebarSnapshot";
import {
  generateThreadTitle,
  listThreadTitles,
  resumeThread,
  setThreadTitle,
  projectMemoryUpdate,
  projectMemoryCreate,
  deleteCodexSessions,
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

const AUTO_TITLE_REQUEST_TIMEOUT_MS = 8_000;
const AUTO_TITLE_MAX_ATTEMPTS = 2;
const AUTO_TITLE_PENDING_STALE_MS = 20_000;
const MEMORY_DEBUG_FLAG_KEY = "ccgui:memory-debug";
const THREAD_ERROR_DUPLICATE_WINDOW_MS = 8_000;
const THREAD_SWITCH_RESUME_DELAY_MS = 24;
const THREAD_SWITCH_LOADED_REFRESH_MS = 20_000;
const CODEX_REALTIME_HISTORY_RECONCILE_DELAY_MS = 1_200;
const CODEX_REALTIME_HISTORY_RECONCILE_RETRY_DELAY_MS = 2_800;
const CLAUDE_REALTIME_HISTORY_RECONCILE_DELAY_MS = 1_200;
const CLAUDE_REALTIME_HISTORY_RECONCILE_RETRY_DELAY_MS = 2_800;
const THREAD_ITEM_CACHE_MAX = 12;
const THREAD_ITEM_CACHE_TRIM_WATERMARK = 2;

function isCodexHistorySelectionThreadId(threadId: string) {
  const normalizedThreadId = threadId.trim().toLowerCase();
  if (!normalizedThreadId || normalizedThreadId.includes("-pending-")) {
    return false;
  }
  return (
    !normalizedThreadId.startsWith("shared:") &&
    !normalizedThreadId.startsWith("claude:") &&
    !normalizedThreadId.startsWith("gemini:") &&
    !normalizedThreadId.startsWith("opencode:")
  );
}

/** 回合级记忆待合并数据（输入侧采集后暂存，等输出侧压缩后融合写入） */
type PendingMemoryCapture = {
  workspaceId: string;
  threadId: string;
  turnId: string;
  inputText: string;
  memoryId: string | null;
  workspaceName: string | null;
  workspacePath: string | null;
  engine: string | null;
  createdAt: number;
};

type PendingAssistantCompletion = {
  workspaceId: string;
  threadId: string;
  itemId: string;
  text: string;
  createdAt: number;
};

const MAX_ASSISTANT_DETAIL_LENGTH = 12000;
// Claude turns can exceed 30s frequently; keep a wider merge window to avoid dropping write-back.
const PENDING_MEMORY_STALE_MS = 10 * 60_000;
const MEMORY_PARAGRAPH_BREAK_SPLIT_REGEX = /\r?\n[^\S\r\n]*\r?\n+/;
const MEMORY_SENTENCE_BOUNDARY_CHARS = new Set([
  "。",
  "！",
  "？",
  ".",
  "!",
  "?",
  "；",
  ";",
  ":",
  "：",
  "\n",
]);

function compactComparableMemoryText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\u3400-\u9FFF]+/gu, "");
}

function splitMemorySentences(value: string) {
  const segments: string[] = [];
  let segmentStart = 0;
  for (let index = 0; index < value.length; index += 1) {
    const currentChar = value[index] ?? "";
    if (!MEMORY_SENTENCE_BOUNDARY_CHARS.has(currentChar)) {
      continue;
    }
    let segmentEnd = index + 1;
    while (segmentEnd < value.length && /\s/.test(value[segmentEnd] ?? "")) {
      segmentEnd += 1;
    }
    const segment = value.slice(segmentStart, segmentEnd);
    if (segment.trim()) {
      segments.push(segment);
    }
    segmentStart = segmentEnd;
  }
  const tailSegment = value.slice(segmentStart);
  if (tailSegment.trim()) {
    segments.push(tailSegment);
  }
  return segments
    .map((entry) => trimTrailingPromptFragment(entry).trim())
    .filter(Boolean);
}

function trimTrailingPromptFragment(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.length <= 16 && /[：:]$/.test(trimmed)) {
    return "";
  }
  const sentenceEndIndex = Math.max(
    trimmed.lastIndexOf("。"),
    trimmed.lastIndexOf("！"),
    trimmed.lastIndexOf("？"),
    trimmed.lastIndexOf("!"),
    trimmed.lastIndexOf("?"),
    trimmed.lastIndexOf(";"),
    trimmed.lastIndexOf("；"),
  );
  if (sentenceEndIndex < 0 || sentenceEndIndex >= trimmed.length - 1) {
    return trimmed;
  }
  const tail = trimmed.slice(sentenceEndIndex + 1).trim();
  if (tail.length > 0 && tail.length <= 16 && /[：:]$/.test(tail)) {
    return trimmed.slice(0, sentenceEndIndex + 1).trim();
  }
  return trimmed;
}

function normalizeAssistantOutputForMemory(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  const directRepeat = trimmed.match(/^([\s\S]{8,}?)(?:\s+\1){1,2}$/);
  if (directRepeat?.[1]) {
    return directRepeat[1].trim();
  }

  const paragraphs = trimmed
    .split(MEMORY_PARAGRAPH_BREAK_SPLIT_REGEX)
    .map((entry) => trimTrailingPromptFragment(entry))
    .filter(Boolean);
  if (paragraphs.length > 1) {
    const deduped: string[] = [];
    for (const paragraph of paragraphs) {
      const previous = deduped[deduped.length - 1];
      if (
        previous &&
        compactComparableMemoryText(previous) === compactComparableMemoryText(paragraph) &&
        compactComparableMemoryText(paragraph).length >= 8
      ) {
        continue;
      }
      deduped.push(paragraph);
    }
    for (const repeatCount of [3, 2]) {
      if (deduped.length < repeatCount || deduped.length % repeatCount !== 0) {
        continue;
      }
      const blockLength = deduped.length / repeatCount;
      if (blockLength < 1) {
        continue;
      }
      const firstBlock = deduped
        .slice(0, blockLength)
        .map((entry) => compactComparableMemoryText(entry));
      if (!firstBlock.some((entry) => entry.length >= 8)) {
        continue;
      }
      let matches = true;
      for (let blockIndex = 1; blockIndex < repeatCount; blockIndex += 1) {
        const start = blockIndex * blockLength;
        const candidate = deduped
          .slice(start, start + blockLength)
          .map((entry) => compactComparableMemoryText(entry));
        if (
          candidate.length !== firstBlock.length ||
          candidate.some((entry, index) => entry !== firstBlock[index])
        ) {
          matches = false;
          break;
        }
      }
      if (matches) {
        return deduped.slice(0, blockLength).join("\n\n");
      }
    }
    return deduped.join("\n\n");
  }

  return trimmed;
}

function normalizeDigestSummaryForMemory(value: string) {
  const normalized = trimTrailingPromptFragment(
    normalizeAssistantOutputForMemory(value),
  );
  const sentences = splitMemorySentences(normalized);
  if (sentences.length <= 1) {
    return normalized.trim();
  }
  const deduped: string[] = [];
  const seenShort = new Set<string>();
  for (const sentence of sentences) {
    const comparable = compactComparableMemoryText(
      trimTrailingPromptFragment(sentence),
    );
    if (!comparable) {
      continue;
    }
    const previous = deduped[deduped.length - 1];
    if (previous && compactComparableMemoryText(previous) === comparable) {
      continue;
    }
    if (comparable.length <= 24 && seenShort.has(comparable)) {
      continue;
    }
    if (comparable.length <= 24) {
      seenShort.add(comparable);
    }
    deduped.push(sentence);
  }
  return deduped.join(" ").trim();
}

function isAssistantOutputRedundant(summary: string, output: string) {
  const compactSummary = compactComparableMemoryText(summary);
  const compactOutput = compactComparableMemoryText(output);
  if (!compactSummary || !compactOutput) {
    return false;
  }
  if (compactSummary === compactOutput) {
    return true;
  }
  const longerLength = Math.max(compactSummary.length, compactOutput.length);
  const shorterLength = Math.min(compactSummary.length, compactOutput.length);
  if (shorterLength < 12) {
    return false;
  }
  if (longerLength <= 0) {
    return false;
  }
  if (shorterLength / longerLength < 0.78) {
    return false;
  }
  return compactSummary.includes(compactOutput) || compactOutput.includes(compactSummary);
}

function extractNovelAssistantOutput(summary: string, output: string) {
  const normalizedSummary = normalizeDigestSummaryForMemory(summary);
  const normalizedOutput = normalizeAssistantOutputForMemory(output);
  if (!normalizedOutput) {
    return "";
  }

  const summarySentences = splitMemorySentences(normalizedSummary);
  const summaryComparables = summarySentences
    .map((entry) => compactComparableMemoryText(entry))
    .filter((entry) => entry.length >= 8);

  if (summaryComparables.length === 0) {
    return normalizedOutput;
  }

  const outputSentences = splitMemorySentences(normalizedOutput);
  const kept: string[] = [];
  for (const sentence of outputSentences) {
    const comparable = compactComparableMemoryText(sentence);
    if (!comparable) {
      continue;
    }
    const overlapsSummary = summaryComparables.some((entry) => {
      if (comparable === entry) {
        return true;
      }
      const minLength = Math.min(comparable.length, entry.length);
      if (minLength < 12) {
        return false;
      }
      return comparable.includes(entry) || entry.includes(comparable);
    });
    if (overlapsSummary) {
      continue;
    }
    const previous = kept[kept.length - 1];
    if (previous && compactComparableMemoryText(previous) === comparable) {
      continue;
    }
    kept.push(sentence);
  }

  const novelOutput = kept.join(" ").trim();
  if (!novelOutput) {
    return "";
  }
  return isAssistantOutputRedundant(normalizedSummary, novelOutput)
    ? ""
    : novelOutput;
}

function isMemoryDebugEnabled(): boolean {
  if (!import.meta.env.DEV) {
    return false;
  }
  if (typeof window === "undefined") {
    return false;
  }
  return window.localStorage.getItem(MEMORY_DEBUG_FLAG_KEY) === "1";
}

function memoryDebugLog(message: string, payload?: Record<string, unknown>) {
  if (!isMemoryDebugEnabled()) {
    return;
  }
  if (payload) {
    console.info(`[project-memory][debug] ${message}`, payload);
    return;
  }
  console.info(`[project-memory][debug] ${message}`);
}

type UseThreadsOptions = {
  activeWorkspace: WorkspaceInfo | null;
  onWorkspaceConnected: (id: string) => void;
  onDebug?: (entry: DebugEntry) => void;
  model?: string | null;
  effort?: string | null;
  collaborationMode?: Record<string, unknown> | null;
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

type PendingResolutionInput = {
  workspaceId: string;
  engine: "claude" | "gemini" | "opencode";
  threadsByWorkspace: Record<string, Array<{ id: string }>>;
  activeThreadIdByWorkspace: Record<string, string | null>;
  threadStatusById: Record<string, { isProcessing?: boolean } | undefined>;
  activeTurnIdByThread: Record<string, string | null | undefined>;
  itemsByThread: Record<string, unknown[] | undefined>;
};

export type ThreadDeleteErrorCode =
  | "WORKSPACE_NOT_CONNECTED"
  | "SESSION_NOT_FOUND"
  | "PERMISSION_DENIED"
  | "IO_ERROR"
  | "ENGINE_UNSUPPORTED"
  | "UNKNOWN";

export type ThreadDeleteResult = {
  threadId: string;
  success: boolean;
  code: ThreadDeleteErrorCode | null;
  message: string | null;
};

function mapDeleteErrorCode(errorMessage: string): ThreadDeleteErrorCode {
  const normalized = errorMessage.toLowerCase();
  if (normalized.includes("[engine_unsupported]")) {
    return "ENGINE_UNSUPPORTED";
  }
  if (
    normalized.includes("[workspace_not_connected]") ||
    normalized.includes("workspace not connected") ||
    normalized.includes("workspace not found")
  ) {
    return "WORKSPACE_NOT_CONNECTED";
  }
  if (
    normalized.includes("[session_not_found]") ||
    normalized.includes("session file not found") ||
    normalized.includes("not found") ||
    normalized.includes("thread not found")
  ) {
    return "SESSION_NOT_FOUND";
  }
  if (normalized.includes("[io_error]")) {
    return "IO_ERROR";
  }
  if (normalized.includes("permission denied")) {
    return "PERMISSION_DENIED";
  }
  if (normalized.includes("io") || normalized.includes("failed to delete session file")) {
    return "IO_ERROR";
  }
  if (normalized.includes("unsupported")) {
    return "ENGINE_UNSUPPORTED";
  }
  return "UNKNOWN";
}

export function resolvePendingThreadIdForSession({
  workspaceId,
  engine,
  threadsByWorkspace,
  activeThreadIdByWorkspace,
  threadStatusById,
  activeTurnIdByThread,
  itemsByThread,
}: PendingResolutionInput): string | null {
  const prefix = `${engine}-pending-`;
  const threads = threadsByWorkspace[workspaceId] ?? [];
  const pendingThreads = threads.filter((thread) => thread.id.startsWith(prefix));
  if (pendingThreads.length === 0) {
    return null;
  }

  const activePendingId = activeThreadIdByWorkspace[workspaceId] ?? null;
  const pickActivePending = (candidates: Array<{ id: string }>): string | null => {
    if (!activePendingId || !activePendingId.startsWith(prefix)) {
      return null;
    }
    return candidates.some((candidate) => candidate.id === activePendingId)
      ? activePendingId
      : null;
  };
  const hasObservedItems = (threadId: string) => (itemsByThread[threadId]?.length ?? 0) > 0;
  const hasPendingAnchor = (threadId: string) => {
    const hasActiveTurn = (activeTurnIdByThread[threadId] ?? null) !== null;
    if (hasActiveTurn) {
      return true;
    }
    const isProcessing = Boolean(threadStatusById[threadId]?.isProcessing);
    return isProcessing && hasObservedItems(threadId);
  };

  // Boundary guard: pending->session reconciliation requires a concrete anchor
  // (active turn or observed items). Processing state alone is not sufficient,
  // otherwise old in-flight streams can be rebound into unrelated new sessions.
  const activePending = pickActivePending(pendingThreads);
  if (activePending && hasPendingAnchor(activePending)) {
    return activePending;
  }

  const turnBoundPending = pendingThreads.filter(
    (thread) => (activeTurnIdByThread[thread.id] ?? null) !== null,
  );
  if (turnBoundPending.length === 1) {
    return turnBoundPending[0]?.id ?? null;
  }
  if (turnBoundPending.length > 1) {
    return pickActivePending(turnBoundPending);
  }

  const contentBoundPending = pendingThreads.filter(
    (thread) =>
      Boolean(threadStatusById[thread.id]?.isProcessing)
      && hasObservedItems(thread.id),
  );
  if (contentBoundPending.length === 1) {
    return contentBoundPending[0]?.id ?? null;
  }
  if (contentBoundPending.length > 1) {
    return pickActivePending(contentBoundPending);
  }

  if (pendingThreads.length === 1) {
    const onlyPendingId = pendingThreads[0]?.id ?? "";
    return hasPendingAnchor(onlyPendingId) ? onlyPendingId : null;
  }

  return null;
}

export function useThreads({
  activeWorkspace,
  onWorkspaceConnected,
  onDebug,
  model,
  effort,
  collaborationMode,
  accessMode,
  steerEnabled = false,
  customPrompts = [],
  onMessageActivity,
  activeEngine = "claude",
  useNormalizedRealtimeAdapters = false,
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
  const loadedThreadLastRefreshAtRef = useRef<Record<string, number>>({});
  const lazyResumeTimerByWorkspaceRef = useRef<
    Record<string, ReturnType<typeof setTimeout> | null>
  >({});
  const historyLoadingThreadByWorkspaceRef = useRef<Record<string, string | null>>({});
  const activeThreadIdByWorkspaceRef = useRef(state.activeThreadIdByWorkspace);
  const replaceOnResumeRef = useRef<Record<string, boolean>>({});
  const pendingInterruptsRef = useRef<Set<string>>(new Set());
  const interruptedThreadsRef = useRef<Set<string>>(new Set());
  const pendingMemoryCaptureRef = useRef<Record<string, PendingMemoryCapture>>({});
  const pendingAssistantCompletionRef = useRef<Record<string, PendingAssistantCompletion>>({});
  const recentThreadErrorsRef = useRef<Record<string, { message: string; at: number }>>({});
  const handledClaudeExitPlanToolIdsRef = useRef<Set<string>>(new Set());
  const codexRealtimeReconciledTurnByThreadRef = useRef<Record<string, string>>({});
  const codexRealtimeReconcileTimerByThreadRef = useRef<
    Record<string, ReturnType<typeof setTimeout> | null>
  >({});
  const claudeRealtimeReconciledTurnByThreadRef = useRef<Record<string, string>>({});
  const claudeRealtimeReconcileTimerByThreadRef = useRef<
    Record<string, ReturnType<typeof setTimeout> | null>
  >({});
  const sharedSessionSyncTimerByThreadRef = useRef<
    Record<string, ReturnType<typeof setTimeout> | null>
  >({});
  const sharedSessionLastSignatureByThreadRef = useRef<Record<string, string>>({});
  const {
    approvalAllowlistRef,
    handleApprovalDecision,
    handleApprovalBatchAccept,
    handleApprovalRemember,
  } = useThreadApprovals({
    dispatch,
    onDebug,
  });
  const { handleUserInputSubmit } = useThreadUserInput({ dispatch });
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
      Object.values(codexRealtimeReconcileTimerByThreadRef.current).forEach((timer) => {
        if (timer) {
          clearTimeout(timer);
        }
      });
      Object.values(claudeRealtimeReconcileTimerByThreadRef.current).forEach((timer) => {
        if (timer) {
          clearTimeout(timer);
        }
      });
      codexRealtimeReconcileTimerByThreadRef.current = {};
      codexRealtimeReconciledTurnByThreadRef.current = {};
      claudeRealtimeReconcileTimerByThreadRef.current = {};
      claudeRealtimeReconciledTurnByThreadRef.current = {};
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
      rememberThreadAlias(oldThreadId, newThreadId);
      const oldCanonicalThreadId = resolveCanonicalThreadId(oldThreadId);
      const newCanonicalThreadId = resolveCanonicalThreadId(newThreadId);
      const pending =
        pendingMemoryCaptureRef.current[oldThreadId] ??
        pendingMemoryCaptureRef.current[oldCanonicalThreadId];
      if (pending) {
        memoryDebugLog("rename pending capture key", {
          oldThreadId,
          newThreadId,
          memoryId: pending.memoryId,
        });
        delete pendingMemoryCaptureRef.current[oldThreadId];
        delete pendingMemoryCaptureRef.current[oldCanonicalThreadId];
        pendingMemoryCaptureRef.current[newCanonicalThreadId] = {
          ...pending,
          threadId: newCanonicalThreadId,
        };
      }
      const completed =
        pendingAssistantCompletionRef.current[oldThreadId] ??
        pendingAssistantCompletionRef.current[oldCanonicalThreadId];
      if (!completed) {
        return;
      }
      memoryDebugLog("rename pending assistant completion key", {
        oldThreadId,
        newThreadId,
        itemId: completed.itemId,
      });
      delete pendingAssistantCompletionRef.current[oldThreadId];
      delete pendingAssistantCompletionRef.current[oldCanonicalThreadId];
      pendingAssistantCompletionRef.current[newCanonicalThreadId] = {
        ...completed,
        threadId: newCanonicalThreadId,
      };
    },
    [rememberThreadAlias, resolveCanonicalThreadId],
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

  const shouldReconcileCodexRealtimeThread = useCallback(
    (workspaceId: string, threadId: string) => {
      const canonicalThreadId = resolveCanonicalThreadId(threadId);
      if (
        canonicalThreadId.startsWith("claude:") ||
        canonicalThreadId.startsWith("claude-pending-") ||
        canonicalThreadId.startsWith("gemini:") ||
        canonicalThreadId.startsWith("gemini-pending-") ||
        canonicalThreadId.startsWith("opencode:") ||
        canonicalThreadId.startsWith("opencode-pending-") ||
        canonicalThreadId.startsWith("shared:")
      ) {
        return false;
      }
      const thread = (state.threadsByWorkspace[workspaceId] ?? []).find(
        (entry) => entry.id === canonicalThreadId,
      );
      if (thread?.threadKind === "shared") {
        return false;
      }
      return !thread?.engineSource || thread.engineSource === "codex";
    },
    [resolveCanonicalThreadId, state.threadsByWorkspace],
  );

  const scheduleCodexRealtimeHistoryReconcile = useCallback(
    (workspaceId: string, threadId: string, turnId: string, attempt = 0) => {
      const canonicalThreadId = resolveCanonicalThreadId(threadId);
      if (!shouldReconcileCodexRealtimeThread(workspaceId, canonicalThreadId)) {
        return;
      }
      const reconciliationThreadKey = `${workspaceId}:${canonicalThreadId}`;
      const reconciliationTurnId = turnId.trim() || "__unknown_turn__";
      if (
        attempt === 0 &&
        codexRealtimeReconciledTurnByThreadRef.current[reconciliationThreadKey] ===
        reconciliationTurnId
      ) {
        return;
      }
      codexRealtimeReconciledTurnByThreadRef.current[reconciliationThreadKey] =
        reconciliationTurnId;
      const previousTimer =
        codexRealtimeReconcileTimerByThreadRef.current[reconciliationThreadKey];
      if (previousTimer) {
        clearTimeout(previousTimer);
      }
      const delay =
        attempt > 0
          ? CODEX_REALTIME_HISTORY_RECONCILE_RETRY_DELAY_MS
          : CODEX_REALTIME_HISTORY_RECONCILE_DELAY_MS;
      codexRealtimeReconcileTimerByThreadRef.current[reconciliationThreadKey] =
        setTimeout(() => {
          delete codexRealtimeReconcileTimerByThreadRef.current[reconciliationThreadKey];
          const status = threadStatusByIdRef.current[canonicalThreadId];
          if (status?.isProcessing && attempt === 0) {
            scheduleCodexRealtimeHistoryReconcile(
              workspaceId,
              canonicalThreadId,
              reconciliationTurnId,
              attempt + 1,
            );
            return;
          }
          onDebug?.({
            id: `${Date.now()}-codex-realtime-history-reconcile`,
            timestamp: Date.now(),
            source: "client",
            label: "codex/realtime history reconcile",
            payload: {
              workspaceId,
              threadId: canonicalThreadId,
              turnId: reconciliationTurnId,
              attempt,
            },
          });
          void refreshThread(workspaceId, canonicalThreadId).catch((error) => {
            onDebug?.({
              id: `${Date.now()}-codex-realtime-history-reconcile-error`,
              timestamp: Date.now(),
              source: "error",
              label: "codex/realtime history reconcile error",
              payload: {
                workspaceId,
                threadId: canonicalThreadId,
                turnId: reconciliationTurnId,
                attempt,
                error: error instanceof Error ? error.message : String(error),
              },
            });
          });
        }, delay);
    },
    [
      onDebug,
      refreshThread,
      resolveCanonicalThreadId,
      shouldReconcileCodexRealtimeThread,
    ],
  );

  const handleCodexTurnCompletedForHistoryReconcile = useCallback(
    (payload: {
      workspaceId: string;
      threadId: string;
      turnId: string;
    }) => {
      scheduleCodexRealtimeHistoryReconcile(
        payload.workspaceId,
        payload.threadId,
        payload.turnId,
      );
    },
    [scheduleCodexRealtimeHistoryReconcile],
  );

  const shouldReconcileClaudeRealtimeThread = useCallback((threadId: string) => {
    const canonicalThreadId = resolveCanonicalThreadId(threadId);
    return canonicalThreadId.startsWith("claude:");
  }, [resolveCanonicalThreadId]);

  const scheduleClaudeRealtimeHistoryReconcile = useCallback(
    (workspaceId: string, threadId: string, turnId: string, attempt = 0) => {
      const canonicalThreadId = resolveCanonicalThreadId(threadId);
      if (!shouldReconcileClaudeRealtimeThread(canonicalThreadId)) {
        return;
      }
      const reconciliationThreadKey = `${workspaceId}:${canonicalThreadId}`;
      const reconciliationTurnId = turnId.trim() || "__unknown_turn__";
      if (
        attempt === 0 &&
        claudeRealtimeReconciledTurnByThreadRef.current[reconciliationThreadKey] ===
        reconciliationTurnId
      ) {
        return;
      }
      claudeRealtimeReconciledTurnByThreadRef.current[reconciliationThreadKey] =
        reconciliationTurnId;
      const previousTimer =
        claudeRealtimeReconcileTimerByThreadRef.current[reconciliationThreadKey];
      if (previousTimer) {
        clearTimeout(previousTimer);
      }
      const delay =
        attempt > 0
          ? CLAUDE_REALTIME_HISTORY_RECONCILE_RETRY_DELAY_MS
          : CLAUDE_REALTIME_HISTORY_RECONCILE_DELAY_MS;
      claudeRealtimeReconcileTimerByThreadRef.current[reconciliationThreadKey] =
        setTimeout(() => {
          delete claudeRealtimeReconcileTimerByThreadRef.current[reconciliationThreadKey];
          const status = threadStatusByIdRef.current[canonicalThreadId];
          if (status?.isProcessing && attempt === 0) {
            scheduleClaudeRealtimeHistoryReconcile(
              workspaceId,
              canonicalThreadId,
              reconciliationTurnId,
              attempt + 1,
            );
            return;
          }
          onDebug?.({
            id: `${Date.now()}-claude-realtime-history-reconcile`,
            timestamp: Date.now(),
            source: "client",
            label: "claude/realtime history reconcile",
            payload: {
              workspaceId,
              threadId: canonicalThreadId,
              turnId: reconciliationTurnId,
              attempt,
            },
          });
          void refreshThread(workspaceId, canonicalThreadId).catch((error) => {
            onDebug?.({
              id: `${Date.now()}-claude-realtime-history-reconcile-error`,
              timestamp: Date.now(),
              source: "error",
              label: "claude/realtime history reconcile error",
              payload: {
                workspaceId,
                threadId: canonicalThreadId,
                turnId: reconciliationTurnId,
                attempt,
                error: error instanceof Error ? error.message : String(error),
              },
            });
          });
        }, delay);
    },
    [onDebug, refreshThread, resolveCanonicalThreadId, shouldReconcileClaudeRealtimeThread],
  );

  const handleClaudeTurnCompletedForHistoryReconcile = useCallback(
    (payload: {
      workspaceId: string;
      threadId: string;
      turnId: string;
    }) => {
      scheduleClaudeRealtimeHistoryReconcile(
        payload.workspaceId,
        payload.threadId,
        payload.turnId,
      );
    },
    [scheduleClaudeRealtimeHistoryReconcile],
  );

  const handleTurnCompletedForHistoryReconcile = useCallback(
    (payload: {
      workspaceId: string;
      threadId: string;
      turnId: string;
    }) => {
      if (payload.threadId.startsWith("claude:")) {
        handleClaudeTurnCompletedForHistoryReconcile(payload);
        return;
      }
      handleCodexTurnCompletedForHistoryReconcile(payload);
    },
    [
      handleClaudeTurnCompletedForHistoryReconcile,
      handleCodexTurnCompletedForHistoryReconcile,
    ],
  );

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
      ).slice(0, MAX_ASSISTANT_DETAIL_LENGTH);
      const digest = buildAssistantOutputDigest(normalizedAssistantOutput);
      if (!digest) {
        memoryDebugLog("assistant completed but digest is empty", {
          threadId: payload.threadId,
          itemId: payload.itemId,
        });
        return;
      }

      const normalizedSummary =
        normalizeDigestSummaryForMemory(digest.summary) || digest.summary;
      const assistantOutputWithoutSummary = extractNovelAssistantOutput(
        normalizedSummary,
        normalizedAssistantOutput,
      );
      const mergedDetailLines = [
        `用户输入：${pending.inputText}`,
        `助手输出摘要：${normalizedSummary}`,
      ];
      if (assistantOutputWithoutSummary) {
        mergedDetailLines.push(`助手输出：${assistantOutputWithoutSummary}`);
      }
      const mergedDetail = mergedDetailLines.join("\n");
      const classifiedKind = classifyMemoryKind(mergedDetail);
      const mergedKind = classifiedKind === "note" ? "conversation" : classifiedKind;
      const mergedImportance = classifyMemoryImportance(mergedDetail);

      const mergeWrite = async () => {
        if (pending.memoryId) {
          try {
            await projectMemoryUpdate(pending.memoryId, pending.workspaceId, {
              kind: mergedKind,
              title: digest.title,
              summary: normalizedSummary,
              detail: mergedDetail,
              importance: mergedImportance,
            });
            memoryDebugLog("merge write updated existing memory", {
              threadId: payload.threadId,
              memoryId: pending.memoryId,
            });
            return;
          } catch (updateErr) {
            if (import.meta.env.DEV) {
              console.warn(
                "[project-memory] merge update failed, falling back to create:",
                { threadId: payload.threadId, memoryId: pending.memoryId, error: updateErr },
              );
            }
            memoryDebugLog("merge update failed", {
              threadId: payload.threadId,
              memoryId: pending.memoryId,
              error: updateErr instanceof Error ? updateErr.message : String(updateErr),
            });
          }
        }

        try {
          await projectMemoryCreate({
            workspaceId: pending.workspaceId,
            kind: mergedKind,
            title: digest.title,
            summary: normalizedSummary,
            detail: mergedDetail,
            importance: mergedImportance,
            threadId: payload.threadId,
            messageId: payload.itemId,
            source: "assistant_output_digest",
            workspaceName: pending.workspaceName,
            workspacePath: pending.workspacePath,
            engine: pending.engine,
          });
          memoryDebugLog("merge write created new memory", {
            threadId: payload.threadId,
            itemId: payload.itemId,
          });
        } catch (createErr) {
          if (import.meta.env.DEV) {
            console.warn("[project-memory] merge create also failed:", {
              threadId: payload.threadId,
              error: createErr,
            });
          }
          memoryDebugLog("merge create failed", {
            threadId: payload.threadId,
            error: createErr instanceof Error ? createErr.message : String(createErr),
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
      pendingMemoryCaptureRef.current[canonicalThreadId] = {
        ...normalizedPayload,
        createdAt: Date.now(),
      };
      if (canonicalThreadId !== payload.threadId) {
        delete pendingMemoryCaptureRef.current[payload.threadId];
      }
      const completedThreadIds = collectRelatedThreadIds(canonicalThreadId);
      const completedEntry = completedThreadIds
        .map((threadId) => ({
          threadId,
          completion: pendingAssistantCompletionRef.current[threadId],
        }))
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
        completedThreadIds.forEach((threadId) => {
          delete pendingAssistantCompletionRef.current[threadId];
          delete pendingMemoryCaptureRef.current[threadId];
        });
        memoryDebugLog("capture resolved after assistant completion, merging now", {
          threadId: canonicalThreadId,
          itemId: completedEntry.completion.itemId,
          memoryId: normalizedPayload.memoryId,
        });
        mergeMemoryFromPendingCapture(normalizedPayload, {
          ...completedEntry.completion,
          threadId: canonicalThreadId,
        });
        return;
      }
      if (completedEntry) {
        delete pendingAssistantCompletionRef.current[completedEntry.threadId];
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
      itemId: string;
      text: string;
    }) => {
      const canonicalThreadId = resolveCanonicalThreadId(payload.threadId);
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
        .map((threadId) => ({
          threadId,
          capture: pendingMemoryCaptureRef.current[threadId],
        }))
        .find((entry) => Boolean(entry.capture));
      if (!pendingEntry?.capture) {
        pendingAssistantCompletionRef.current[canonicalThreadId] = {
          ...payload,
          threadId: canonicalThreadId,
          createdAt: Date.now(),
        };
        if (canonicalThreadId !== payload.threadId) {
          delete pendingAssistantCompletionRef.current[payload.threadId];
        }
        memoryDebugLog("assistant completed but no pending capture", {
          threadId: canonicalThreadId,
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
        delete pendingMemoryCaptureRef.current[pendingEntry.threadId];
        memoryDebugLog("pending capture is stale, skip merge", {
          threadId: pendingEntry.threadId,
          itemId: payload.itemId,
        });
        return;
      }
      // 清理 pending，防止重复写入
      relatedThreadIds.forEach((threadId) => {
        delete pendingMemoryCaptureRef.current[threadId];
        delete pendingAssistantCompletionRef.current[threadId];
      });
      mergeMemoryFromPendingCapture(pendingEntry.capture, {
        ...payload,
        threadId: canonicalThreadId,
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
    interruptTurn,
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
    steerEnabled,
    customPrompts,
    activeEngine,
    threadStatusById: state.threadStatusById,
    itemsByThread: state.itemsByThread,
    activeTurnIdByThread: state.activeTurnIdByThread,
    tokenUsageByThread: state.tokenUsageByThread,
    rateLimitsByWorkspace: state.rateLimitsByWorkspace,
    pendingInterruptsRef,
    interruptedThreadsRef,
    dispatch,
    getCustomName,
    getThreadEngine,
    getThreadKind,
    markProcessing,
    markReviewing,
    setActiveTurnId,
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
          !isLoaded && isCodexHistorySelectionThreadId(canonicalThreadId);
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
            void resumeThreadForWorkspace(targetId, canonicalThreadId).finally(() => {
              clearHistoryLoadingForThread(canonicalThreadId);
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
          void resumeThreadForWorkspace(targetId, canonicalThreadId, true);
        }, THREAD_SWITCH_RESUME_DELAY_MS);
      }
    },
    [
      activeWorkspaceId,
      dispatch,
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
      try {
        await deleteThreadForWorkspace(workspaceId, threadId);
        unpinThread(workspaceId, threadId);
        if (getThreadKind(workspaceId, threadId) === "shared") {
          clearSharedSessionBindingsForSharedThread(workspaceId, threadId);
        }
        dispatch({ type: "removeThread", workspaceId, threadId });
        return {
          threadId,
          success: true,
          code: null,
          message: null,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const code = mapDeleteErrorCode(message);
        if (threadId.startsWith("claude:") && code === "SESSION_NOT_FOUND") {
          loadedThreadsRef.current[threadId] = false;
          unpinThread(workspaceId, threadId);
          dispatch({
            type: "clearUserInputRequestsForThread",
            workspaceId,
            threadId,
          });
          dispatch({ type: "removeThread", workspaceId, threadId });
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
            if (result.deleted) {
              unpinThread(workspaceId, result.sessionId);
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
            const message = (result.error ?? "").trim() || "Failed to delete codex session";
            codexResultByThreadId.set(result.sessionId, {
              threadId: result.sessionId,
              success: false,
              code: mapDeleteErrorCode(message),
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
    onWorkspaceConnected: handleWorkspaceConnected,
    applyCollabThreadLinks,
    approvalAllowlistRef,
    pendingInterruptsRef,
    interruptedThreadsRef,
    renameCustomNameKey,
    renameAutoTitlePendingKey,
    renameThreadTitleMapping,
    resolvePendingThreadForSession,
    getActiveTurnIdForThread: (threadId: string) =>
      state.activeTurnIdByThread[threadId] ?? null,
    renamePendingMemoryCaptureKey,
    onAgentMessageCompletedExternal: handleAgentMessageCompletedForMemory,
    onTurnCompletedExternal: handleTurnCompletedForHistoryReconcile,
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

  return {
    activeThreadId,
    setActiveThreadId,
    activeItems,
    threadItemsByThread: state.itemsByThread,
    approvals: state.approvals,
    userInputRequests: state.userInputRequests,
    threadsByWorkspace: state.threadsByWorkspace,
    threadParentById: state.threadParentById,
    threadStatusById: state.threadStatusById,
    historyLoadingByThreadId,
    threadListLoadingByWorkspace: state.threadListLoadingByWorkspace,
    threadListPagingByWorkspace: state.threadListPagingByWorkspace,
    threadListCursorByWorkspace: state.threadListCursorByWorkspace,
    activeTurnIdByThread: state.activeTurnIdByThread,
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
  };
}
