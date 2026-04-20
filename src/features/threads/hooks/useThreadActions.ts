import { useCallback, useRef } from "react";
import type { Dispatch, MutableRefObject } from "react";
import type {
  ConversationItem,
  DebugEntry,
  ThreadSummary,
  WorkspaceInfo,
} from "../../../types";
import {
  archiveThread as archiveThreadService,
  deleteCodexSession as deleteCodexSessionService,
  deleteClaudeSession as deleteClaudeSessionService,
  deleteGeminiSession as deleteGeminiSessionService,
  deleteOpenCodeSession as deleteOpenCodeSessionService,
  connectWorkspace as connectWorkspaceService,
  forkClaudeSession as forkClaudeSessionService,
  forkClaudeSessionFromMessage as forkClaudeSessionFromMessageService,
  forkThread as forkThreadService,
  rewindCodexThread as rewindCodexThreadService,
  listThreadTitles as listThreadTitlesService,
  listThreads as listThreadsService,
  listClaudeSessions as listClaudeSessionsService,
  listGeminiSessions as listGeminiSessionsService,
  getOpenCodeSessionList as getOpenCodeSessionListService,
  loadClaudeSession as loadClaudeSessionService,
  loadGeminiSession as loadGeminiSessionService,
  loadCodexSession as loadCodexSessionService,
  renameThreadTitleKey as renameThreadTitleKeyService,
  setThreadTitle as setThreadTitleService,
  resumeThread as resumeThreadService,
  startThread as startThreadService,
} from "../../../services/tauri";
import * as tauriServices from "../../../services/tauri";
import {
  buildItemsFromThread,
  getThreadTimestamp,
  isReviewingFromThread,
  mergeThreadItems,
  previewThreadName,
} from "../../../utils/threadItems";
import {
  createClaudeHistoryLoader,
  parseClaudeHistoryMessages,
} from "../loaders/claudeHistoryLoader";
import { createCodexHistoryLoader } from "../loaders/codexHistoryLoader";
import { createGeminiHistoryLoader } from "../loaders/geminiHistoryLoader";
import { parseGeminiHistoryMessages } from "../loaders/geminiHistoryParser";
import { createOpenCodeHistoryLoader } from "../loaders/opencodeHistoryLoader";
import { createSharedHistoryLoader } from "../loaders/sharedHistoryLoader";
import {
  deleteSharedSession as deleteSharedSessionService,
  listSharedSessions as listSharedSessionsService,
  loadSharedSession as loadSharedSessionService,
  startSharedSession as startSharedSessionService,
} from "../../shared-session/services/sharedSessions";
import {
  normalizeSharedSessionSummaries,
  toSharedThreadSummary,
} from "../../shared-session/runtime/sharedSessionSummaries";
import { normalizeSharedSessionEngine } from "../../shared-session/utils/sharedSessionEngines";
import { asString, asNumber } from "../utils/threadNormalize";
import {
  saveThreadActivity,
} from "../utils/threadStorage";
import {
  applyClaudeRewindWorkspaceRestore,
  findImpactedClaudeRewindItems,
  restoreClaudeRewindWorkspaceSnapshots,
} from "../utils/claudeRewindRestore";
import {
  collectKnownCodexThreadIds,
  normalizeComparableWorkspacePath,
} from "./useThreadActions.workspacePath";
import {
  collectRelatedThreadIdsFromSnapshot,
  extractThreadSizeBytes,
  findFirstHistoryUserMessageId,
  findLastUserMessageIndexById,
  findLatestHistoryUserMessageId,
  inferThreadEngineSource,
  isUserConversationMessage,
  isAskUserQuestionToolItem,
  isLocalSessionScanUnavailable,
  isTerminalToolStatus,
  isThreadResumeNotFoundError,
  isWorkspaceNotConnectedError,
  mapWithConcurrency,
  mergeCodexCatalogSessionSummaries,
  mergeGeminiSessionSummaries,
  mergeRecoveredThreadSummaries,
  normalizeGeminiSessionSummaries,
  normalizeComparableRewindText,
  resolveClaudeRewindMessageIdFromHistory,
  resolveRewindSupportedEngine,
  resolveThreadSourceMeta,
  restoreThreadParentLinksFromSnapshot,
  listReplacementThreadCandidates,
  selectReplacementThreadByMessageHistory,
  selectReplacementThreadSummary,
  shouldIncludeWorkspaceThreadEntry,
  shouldReplaceUserInputQueueFromSnapshot,
  withTimeout,
  type GeminiSessionSummary,
} from "./useThreadActions.helpers";
import {
  normalizeRewindMode,
  shouldRestoreWorkspaceFiles,
  shouldRewindMessages,
  type RewindMode,
} from "../utils/rewindMode";
import type { ThreadAction, ThreadState } from "./useThreadsReducer";

type UseThreadActionsOptions = {
  dispatch: Dispatch<ThreadAction>;
  itemsByThread: ThreadState["itemsByThread"];
  userInputRequests: ThreadState["userInputRequests"];
  threadsByWorkspace: ThreadState["threadsByWorkspace"];
  activeThreadIdByWorkspace: ThreadState["activeThreadIdByWorkspace"];
  threadListCursorByWorkspace: ThreadState["threadListCursorByWorkspace"];
  threadStatusById: ThreadState["threadStatusById"];
  onDebug?: (entry: DebugEntry) => void;
  getCustomName: (workspaceId: string, threadId: string) => string | undefined;
  threadActivityRef: MutableRefObject<Record<string, Record<string, number>>>;
  loadedThreadsRef: MutableRefObject<Record<string, boolean>>;
  replaceOnResumeRef: MutableRefObject<Record<string, boolean>>;
  applyCollabThreadLinksFromThread: (
    threadId: string,
    thread: Record<string, unknown>,
  ) => void;
  updateThreadParent?: (parentId: string, childIds: string[]) => void;
  onThreadTitleMappingsLoaded?: (
    workspaceId: string,
    titles: Record<string, string>,
  ) => void;
  onRenameThreadTitleMapping?: (
    workspaceId: string,
    oldThreadId: string,
    newThreadId: string,
  ) => void;
  rememberThreadAlias?: (oldThreadId: string, newThreadId: string) => void;
  useUnifiedHistoryLoader?: boolean;
};

const THREAD_LIST_TARGET_COUNT = 50;
const THREAD_LIST_PAGE_SIZE = 50;
const THREAD_LIST_MAX_EMPTY_PAGES = 5;
const THREAD_LIST_MAX_EMPTY_PAGES_WITH_ACTIVITY = 20;
const THREAD_LIST_MAX_TOTAL_PAGES = 40;
const THREAD_LIST_MAX_EMPTY_PAGES_LOAD_OLDER = 10;
const SIDEBAR_THREAD_LIST_TIMEOUT_MS = 30_000;
const THREAD_LIST_MAX_FETCH_DURATION_MS = SIDEBAR_THREAD_LIST_TIMEOUT_MS;
const THREAD_LIST_LIVE_REQUEST_TIMEOUT_MS = SIDEBAR_THREAD_LIST_TIMEOUT_MS;
const THREAD_RECOVERY_MAX_PAGES = 3;
const THREAD_RECOVERY_MAX_FETCH_DURATION_MS = SIDEBAR_THREAD_LIST_TIMEOUT_MS;
const THREAD_RECOVERY_HISTORY_MATCH_CANDIDATES = 8;
const RELATED_THREAD_LOAD_CONCURRENCY = 2;
const DEFAULT_CLAUDE_CONTEXT_WINDOW = 200_000;
const GEMINI_SESSION_CACHE_TTL_MS = 60_000;
const GEMINI_SESSION_FETCH_TIMEOUT_MS = SIDEBAR_THREAD_LIST_TIMEOUT_MS;
const NATIVE_SESSION_LIST_FETCH_TIMEOUT_MS = SIDEBAR_THREAD_LIST_TIMEOUT_MS;
const CODEX_SESSION_CATALOG_FETCH_TIMEOUT_MS = SIDEBAR_THREAD_LIST_TIMEOUT_MS;
const SESSION_CATALOG_PAGE_SIZE = 200;
const SESSION_CATALOG_MAX_PAGES = 20;
type RewindFromMessageOptions = {
  activate?: boolean;
  mode?: RewindMode;
};

export function useThreadActions({
  dispatch,
  itemsByThread,
  userInputRequests,
  threadsByWorkspace,
  activeThreadIdByWorkspace,
  threadListCursorByWorkspace,
  threadStatusById,
  onDebug,
  getCustomName,
  threadActivityRef,
  loadedThreadsRef,
  replaceOnResumeRef,
  applyCollabThreadLinksFromThread,
  updateThreadParent,
  onThreadTitleMappingsLoaded,
  onRenameThreadTitleMapping,
  rememberThreadAlias,
  useUnifiedHistoryLoader = false,
}: UseThreadActionsOptions) {
  // Map workspaceId → filesystem path, populated in listThreadsForWorkspace
  const workspacePathsByIdRef = useRef<Record<string, string>>({});
  const geminiSessionCacheRef = useRef<
    Record<string, { fetchedAt: number; sessions: GeminiSessionSummary[] }>
  >({});
  const geminiRefreshAttemptedRef = useRef<Record<string, boolean>>({});
  const threadListRequestSeqRef = useRef<Record<string, number>>({});
  const claudeRewindInFlightByThreadRef = useRef<Record<string, boolean>>({});
  const latestThreadsByWorkspaceRef = useRef(threadsByWorkspace);
  latestThreadsByWorkspaceRef.current = threadsByWorkspace;
  const listWorkspaceSessionsService = Object.prototype.hasOwnProperty.call(
    tauriServices,
    "listWorkspaceSessions",
  )
    ? tauriServices.listWorkspaceSessions
    : null;
  const canListWorkspaceSessions = typeof listWorkspaceSessionsService === "function";

  const loadArchivedSessionMap = useCallback(
    async (workspaceId: string): Promise<Map<string, number> | null> => {
      if (!canListWorkspaceSessions) {
        return null;
      }
      try {
        const archivedAtBySessionId = new Map<string, number>();
        let cursor: string | null = null;
        let pagesFetched = 0;
        do {
          const response = await listWorkspaceSessionsService(workspaceId, {
            query: { status: "all" },
            cursor,
            limit: SESSION_CATALOG_PAGE_SIZE,
          });
          response.data.forEach((entry) => {
            const archivedAt =
              typeof entry.archivedAt === "number" && Number.isFinite(entry.archivedAt)
                ? Math.max(0, entry.archivedAt)
                : 0;
            if (archivedAt > 0) {
              archivedAtBySessionId.set(entry.sessionId, archivedAt);
            }
          });
          cursor = response.nextCursor ?? null;
          pagesFetched += 1;
        } while (cursor && pagesFetched < SESSION_CATALOG_MAX_PAGES);
        return archivedAtBySessionId;
      } catch {
        return null;
      }
    },
    [canListWorkspaceSessions],
  );

  const applySessionArchiveState = useCallback(
    (
      summaries: ThreadSummary[],
      archivedAtBySessionId: Map<string, number> | null,
    ): ThreadSummary[] => {
      if (!archivedAtBySessionId) {
        return summaries;
      }
      const nextSummaries = summaries.map((summary) => {
        const archivedAt = archivedAtBySessionId.get(summary.id) ?? 0;
        if (archivedAt <= 0) {
          return { ...summary, archivedAt: undefined };
        }
        return { ...summary, archivedAt };
      });
      return nextSummaries.filter((summary) => !summary.archivedAt || summary.archivedAt <= 0);
    },
    [],
  );

  const extractThreadId = useCallback(
    (response: Record<string, unknown> | null | undefined) => {
      if (!response || typeof response !== "object") {
        return "";
      }
      const responseRecord = response as Record<string, unknown>;
      const result =
        responseRecord.result && typeof responseRecord.result === "object"
          ? (responseRecord.result as Record<string, unknown>)
          : null;
      const resultThread =
        result?.thread && typeof result.thread === "object"
          ? (result.thread as Record<string, unknown>)
          : null;
      const rootThread =
        responseRecord.thread && typeof responseRecord.thread === "object"
          ? (responseRecord.thread as Record<string, unknown>)
          : null;

      const candidates = [
        resultThread?.id,
        result?.threadId,
        result?.thread_id,
        rootThread?.id,
        responseRecord.threadId,
        responseRecord.thread_id,
      ];
      for (const candidate of candidates) {
        if (typeof candidate === "string" || typeof candidate === "number") {
          const normalized = String(candidate).trim();
          if (normalized) {
            return normalized;
          }
        }
      }
      return "";
    },
    [],
  );

  const startThreadForWorkspace = useCallback(
    async (workspaceId: string, options?: { activate?: boolean; engine?: "claude" | "codex" | "gemini" | "opencode" }) => {
      const shouldActivate = options?.activate !== false;
      const engine = options?.engine;
      const resolveStartedThread = (
        response: Record<string, unknown> | null | undefined,
      ) => {
        const threadId = extractThreadId(response);
        if (threadId) {
          dispatch({ type: "ensureThread", workspaceId, threadId, engine: "codex" });
          if (shouldActivate) {
            dispatch({ type: "setActiveThreadId", workspaceId, threadId });
          }
          loadedThreadsRef.current[threadId] = true;
          return threadId;
        }
        return null;
      };

      // For local CLI engines (Claude/Gemini/OpenCode), generate a local pending thread ID.
      if (engine === "claude" || engine === "gemini" || engine === "opencode") {
        const prefix = engine;
        const threadId = `${prefix}-pending-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`;
        onDebug?.({
          id: `${Date.now()}-client-thread-start`,
          timestamp: Date.now(),
          source: "client",
          label: `thread/start (${engine})`,
          payload: { workspaceId, threadId, engine },
        });
        dispatch({ type: "ensureThread", workspaceId, threadId, engine });
        if (shouldActivate) {
          dispatch({ type: "setActiveThreadId", workspaceId, threadId });
        }
        loadedThreadsRef.current[threadId] = true;
        return threadId;
      }

      // For Codex and other engines, use the standard start_thread RPC
      onDebug?.({
        id: `${Date.now()}-client-thread-start`,
        timestamp: Date.now(),
        source: "client",
        label: "thread/start",
        payload: { workspaceId },
      });
      try {
        const response = await startThreadService(workspaceId);
        onDebug?.({
          id: `${Date.now()}-server-thread-start`,
          timestamp: Date.now(),
          source: "server",
          label: "thread/start response",
          payload: response,
        });
        return resolveStartedThread(response);
      } catch (error) {
        if (isWorkspaceNotConnectedError(error)) {
          onDebug?.({
            id: `${Date.now()}-client-workspace-reconnect-before-thread-start`,
            timestamp: Date.now(),
            source: "client",
            label: "workspace/reconnect before thread start",
            payload: { workspaceId },
          });
          try {
            await connectWorkspaceService(workspaceId);
            const retryResponse = await startThreadService(workspaceId);
            onDebug?.({
              id: `${Date.now()}-server-thread-start-retry`,
              timestamp: Date.now(),
              source: "server",
              label: "thread/start retry response",
              payload: retryResponse,
            });
            return resolveStartedThread(retryResponse);
          } catch (retryError) {
            onDebug?.({
              id: `${Date.now()}-client-thread-start-error`,
              timestamp: Date.now(),
              source: "error",
              label: "thread/start error",
              payload: retryError instanceof Error ? retryError.message : String(retryError),
            });
            throw retryError;
          }
        }
        onDebug?.({
          id: `${Date.now()}-client-thread-start-error`,
          timestamp: Date.now(),
          source: "error",
          label: "thread/start error",
          payload: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
    [dispatch, extractThreadId, loadedThreadsRef, onDebug],
  );

  const startSharedSessionForWorkspace = useCallback(
    async (
      workspaceId: string,
      options?: { activate?: boolean; initialEngine?: "claude" | "codex" | "gemini" | "opencode" },
    ) => {
      const shouldActivate = options?.activate !== false;
      const initialEngine = normalizeSharedSessionEngine(options?.initialEngine);
      onDebug?.({
        id: `${Date.now()}-client-shared-thread-start`,
        timestamp: Date.now(),
        source: "client",
        label: "shared-session/start",
        payload: { workspaceId, initialEngine },
      });
      const response = await startSharedSessionService(workspaceId, initialEngine);
      const threadId = extractThreadId(response);
      if (!threadId) {
        return null;
      }
      const result =
        response?.result && typeof response.result === "object"
          ? (response.result as Record<string, unknown>)
          : response;
      const thread =
        result?.thread && typeof result.thread === "object"
          ? (result.thread as Record<string, unknown>)
          : null;
      const summary: ThreadSummary = {
        id: threadId,
        name: asString(thread?.name).trim() || "Shared Session",
        updatedAt: asNumber(thread?.updatedAt ?? thread?.updated_at) || Date.now(),
        engineSource: initialEngine,
        threadKind: "shared",
        selectedEngine: initialEngine,
        nativeThreadIds: [],
      };
      dispatch({
        type: "setThreads",
        workspaceId,
        threads: [summary, ...(threadsByWorkspace[workspaceId] ?? [])],
      });
      if (shouldActivate) {
        dispatch({ type: "setActiveThreadId", workspaceId, threadId });
      }
      loadedThreadsRef.current[threadId] = true;
      return threadId;
    },
    [dispatch, extractThreadId, loadedThreadsRef, onDebug, threadsByWorkspace],
  );

  const resumeThreadForWorkspace = useCallback(
    async (
      workspaceId: string,
      threadId: string,
      force = false,
      replaceLocal = false,
    ) => {
      if (!threadId) {
        return null;
      }
      const localItems = itemsByThread[threadId] ?? [];
      const status = threadStatusById[threadId];
      if (!force && status?.isProcessing && localItems.length > 0) {
        onDebug?.({
          id: `${Date.now()}-client-thread-resume-skipped`,
          timestamp: Date.now(),
          source: "client",
          label: "thread/resume skipped",
          payload: { workspaceId, threadId, reason: "active-turn" },
        });
        return threadId;
      }
      const shouldPreserveLocalClaudeRealtimeItems =
        !force &&
        threadId.startsWith("claude:") &&
        localItems.length > 0 &&
        !replaceLocal &&
        replaceOnResumeRef.current[threadId] !== true;
      if (shouldPreserveLocalClaudeRealtimeItems) {
        onDebug?.({
          id: `${Date.now()}-client-thread-resume-skipped`,
          timestamp: Date.now(),
          source: "client",
          label: "thread/resume skipped",
          payload: { workspaceId, threadId, reason: "local-claude-realtime-items" },
        });
        loadedThreadsRef.current[threadId] = true;
        return threadId;
      }
      if (useUnifiedHistoryLoader) {
        const createHistoryLoader = (targetThreadId: string) =>
          targetThreadId.startsWith("shared:")
            ? createSharedHistoryLoader({
                workspaceId,
                loadSharedSession: loadSharedSessionService,
              })
            : targetThreadId.startsWith("claude:")
            ? createClaudeHistoryLoader({
                workspaceId,
                workspacePath: workspacePathsByIdRef.current[workspaceId] ?? null,
                loadClaudeSession: loadClaudeSessionService,
              })
            : targetThreadId.startsWith("gemini:")
              ? createGeminiHistoryLoader({
                  workspaceId,
                  workspacePath: workspacePathsByIdRef.current[workspaceId] ?? null,
                  loadGeminiSession: loadGeminiSessionService,
                })
            : targetThreadId.startsWith("opencode:")
              ? createOpenCodeHistoryLoader({
                  workspaceId,
                  resumeThread: resumeThreadService,
                })
              : createCodexHistoryLoader({
                  workspaceId,
                  resumeThread: resumeThreadService,
                  loadCodexSession: loadCodexSessionService,
                });
        const hydrateHistorySnapshot = async (
          effectiveThreadId: string,
          snapshot: Awaited<ReturnType<ReturnType<typeof createHistoryLoader>["load"]>>,
        ) => {
          const snapshotItems = snapshot.items;
          dispatch({
            type: "ensureThread",
            workspaceId,
            threadId: effectiveThreadId,
            engine: snapshot.engine,
          });
          if (snapshotItems.length > 0) {
            dispatch({
              type: "setThreadItems",
              threadId: effectiveThreadId,
              items: snapshotItems,
            });
          }
          dispatch({
            type: "setThreadPlan",
            threadId: effectiveThreadId,
            plan: snapshot.plan,
          });
          const effectiveLocalItems =
            effectiveThreadId === threadId
              ? localItems
              : (itemsByThread[effectiveThreadId] ?? []);
          const hasLocalPendingQueue = userInputRequests.some(
            (request) =>
              request.workspace_id === workspaceId &&
              request.params.thread_id === effectiveThreadId,
          );
          const hasLocalPendingAskTool = effectiveLocalItems.some(
            (item) =>
              isAskUserQuestionToolItem(item) &&
              !isTerminalToolStatus(item.status),
          );
          if (
            shouldReplaceUserInputQueueFromSnapshot(
              snapshotItems,
              snapshot.userInputQueue.length,
              hasLocalPendingQueue || hasLocalPendingAskTool,
            )
          ) {
            dispatch({
              type: "clearUserInputRequestsForThread",
              workspaceId,
              threadId: effectiveThreadId,
            });
          }
          restoreThreadParentLinksFromSnapshot(
            effectiveThreadId,
            snapshotItems,
            updateThreadParent,
          );
          const relatedThreadIds = collectRelatedThreadIdsFromSnapshot(
            effectiveThreadId,
            snapshotItems,
          );
          relatedThreadIds.forEach((relatedThreadId) => {
            dispatch({
              type: "ensureThread",
              workspaceId,
              threadId: relatedThreadId,
              engine: "codex",
            });
          });
          const pendingRelatedThreadIds = relatedThreadIds.filter(
            (relatedThreadId) =>
              Boolean(relatedThreadId) &&
              relatedThreadId !== effectiveThreadId &&
              !loadedThreadsRef.current[relatedThreadId],
          );
          await mapWithConcurrency(
            pendingRelatedThreadIds,
            RELATED_THREAD_LOAD_CONCURRENCY,
            async (relatedThreadId) => {
              try {
                const relatedSnapshot = await createHistoryLoader(relatedThreadId).load(
                  relatedThreadId,
                );
                const relatedSnapshotItems = relatedSnapshot.items;
                if (relatedSnapshotItems.length > 0) {
                  dispatch({
                    type: "setThreadItems",
                    threadId: relatedThreadId,
                    items: relatedSnapshotItems,
                  });
                }
                dispatch({
                  type: "setThreadPlan",
                  threadId: relatedThreadId,
                  plan: relatedSnapshot.plan,
                });
                restoreThreadParentLinksFromSnapshot(
                  relatedThreadId,
                  relatedSnapshotItems,
                  updateThreadParent,
                );
                loadedThreadsRef.current[relatedThreadId] = true;
              } catch (error) {
                onDebug?.({
                  id: `${Date.now()}-history-loader-related-error`,
                  timestamp: Date.now(),
                  source: "error",
                  label: "thread/history related loader error",
                  payload: {
                    workspaceId,
                    threadId: effectiveThreadId,
                    relatedThreadId,
                    error: error instanceof Error ? error.message : String(error),
                  },
                });
              }
              return relatedThreadId;
            },
          );
          snapshot.userInputQueue.forEach((request) => {
            dispatch({ type: "addUserInputRequest", request });
          });
          if (snapshot.fallbackWarnings.length > 0) {
            onDebug?.({
              id: `${Date.now()}-history-loader-fallback`,
              timestamp: Date.now(),
              source: "client",
              label: "thread/history fallback",
              payload: {
                workspaceId,
                threadId: effectiveThreadId,
                warnings: snapshot.fallbackWarnings,
              },
            });
          }
          loadedThreadsRef.current[effectiveThreadId] = true;
        };
        const recoverReplacementThread = async (): Promise<{
          threadId: string;
          snapshot?: Awaited<ReturnType<ReturnType<typeof createHistoryLoader>["load"]>>;
        } | null> => {
          const existingSummaries =
            latestThreadsByWorkspaceRef.current[workspaceId] ??
            threadsByWorkspace[workspaceId] ??
            [];
          const staleSummary =
            existingSummaries.find((entry) => entry.id === threadId) ??
            (threadsByWorkspace[workspaceId] ?? []).find(
              (entry) => entry.id === threadId,
            );
          const engineSource = inferThreadEngineSource(threadId, staleSummary);
          let nextSummaries = existingSummaries;
          if (engineSource === "codex") {
            const workspacePath = normalizeComparableWorkspacePath(
              workspacePathsByIdRef.current[workspaceId] ?? "",
            );
            if (workspacePath) {
              const activeThreadId = activeThreadIdByWorkspace[workspaceId] ?? "";
              const knownCodexThreadIds = collectKnownCodexThreadIds(
                existingSummaries,
                activeThreadId,
              );
              const matchingThreads: Record<string, unknown>[] = [];
              const recoveryStartedAt = Date.now();
              let pagesFetched = 0;
              let cursor: string | null = null;
              do {
                pagesFetched += 1;
                const response = (await listThreadsService(
                  workspaceId,
                  cursor,
                  THREAD_LIST_PAGE_SIZE,
                )) as Record<string, unknown>;
                const result = (response.result ?? response) as Record<string, unknown>;
                const data = Array.isArray(result.data)
                  ? (result.data as Record<string, unknown>[])
                  : [];
                const allowKnownCodexWithoutCwd = isLocalSessionScanUnavailable(result);
                matchingThreads.push(
                  ...data.filter((entry) =>
                    shouldIncludeWorkspaceThreadEntry(
                      entry,
                      workspacePath,
                      knownCodexThreadIds,
                      allowKnownCodexWithoutCwd,
                    ),
                  ),
                );
                cursor =
                  (result.nextCursor ?? result.next_cursor ?? null) as string | null;
                const replacementCandidate = selectReplacementThreadSummary({
                  staleThreadId: threadId,
                  staleSummary,
                  summaries: mergeRecoveredThreadSummaries(
                    existingSummaries,
                    matchingThreads
                      .map((entry, index) => {
                        const id = asString(entry.id).trim();
                        const preview = asString(entry.preview).trim();
                        const customName = getCustomName(workspaceId, id);
                        const fallbackName = `Agent ${index + 1}`;
                        return {
                          id,
                          name: customName
                            ? customName
                            : preview.length > 0
                              ? previewThreadName(preview, fallbackName)
                              : fallbackName,
                          updatedAt: getThreadTimestamp(entry),
                          sizeBytes: extractThreadSizeBytes(entry),
                          engineSource: "codex" as const,
                          threadKind: "native" as const,
                          ...resolveThreadSourceMeta(entry),
                        } satisfies ThreadSummary;
                      })
                      .filter((entry) => entry.id),
                    "codex",
                  ),
                });
                if (replacementCandidate) {
                  break;
                }
                if (pagesFetched >= THREAD_RECOVERY_MAX_PAGES) {
                  break;
                }
                if (Date.now() - recoveryStartedAt >= THREAD_RECOVERY_MAX_FETCH_DURATION_MS) {
                  break;
                }
              } while (cursor);
              const refreshedCodexSummaries = matchingThreads
                .map((entry, index) => {
                  const id = asString(entry.id).trim();
                  const preview = asString(entry.preview).trim();
                  const customName = getCustomName(workspaceId, id);
                  const fallbackName = `Agent ${index + 1}`;
                  return {
                    id,
                    name: customName
                      ? customName
                      : preview.length > 0
                        ? previewThreadName(preview, fallbackName)
                        : fallbackName,
                    updatedAt: getThreadTimestamp(entry),
                    sizeBytes: extractThreadSizeBytes(entry),
                    engineSource: "codex" as const,
                    threadKind: "native" as const,
                    ...resolveThreadSourceMeta(entry),
                  } satisfies ThreadSummary;
                })
                .filter((entry) => entry.id);
              nextSummaries = mergeRecoveredThreadSummaries(
                existingSummaries,
                refreshedCodexSummaries,
                "codex",
              );
            }
          } else if (engineSource === "opencode") {
            const sessions = await getOpenCodeSessionListService(workspaceId).catch(
              () => [],
            );
            const refreshedOpenCodeSummaries = (Array.isArray(sessions) ? sessions : [])
              .map((session) => {
                const sessionUpdatedAt =
                  typeof session.updatedAt === "number" && Number.isFinite(session.updatedAt)
                    ? Math.max(0, session.updatedAt)
                    : 0;
                const id = `opencode:${session.sessionId}`;
                return {
                  id,
                  name:
                    getCustomName(workspaceId, id) ||
                    previewThreadName(session.title, "OpenCode Session"),
                  updatedAt: sessionUpdatedAt,
                  sizeBytes: extractThreadSizeBytes(session as Record<string, unknown>),
                  engineSource: "opencode" as const,
                  threadKind: "native" as const,
                } satisfies ThreadSummary;
              })
              .filter((entry) => entry.id);
            nextSummaries = mergeRecoveredThreadSummaries(
              existingSummaries,
              refreshedOpenCodeSummaries,
              "opencode",
            );
          }
          if (nextSummaries !== existingSummaries) {
            dispatch({
              type: "setThreads",
              workspaceId,
              threads: nextSummaries,
            });
            latestThreadsByWorkspaceRef.current = {
              ...latestThreadsByWorkspaceRef.current,
              [workspaceId]: nextSummaries,
            };
          }
          const summaryMatch = selectReplacementThreadSummary({
            staleThreadId: threadId,
            summaries: nextSummaries,
            staleSummary,
          });
          if (summaryMatch) {
            return { threadId: summaryMatch.id };
          }

          const staleItems = itemsByThread[threadId] ?? [];
          if (staleItems.length === 0) {
            return null;
          }

          const historyCandidates = listReplacementThreadCandidates({
            staleThreadId: threadId,
            summaries: nextSummaries,
            staleSummary,
          })
            .sort((left, right) => right.updatedAt - left.updatedAt)
            .slice(0, THREAD_RECOVERY_HISTORY_MATCH_CANDIDATES);
          if (historyCandidates.length === 0) {
            return null;
          }
          const historyCandidateById = new Map(
            historyCandidates.map((summary) => [summary.id, summary] as const),
          );

          const candidateSnapshots = await mapWithConcurrency(
            historyCandidates.map((summary) => summary.id),
            RELATED_THREAD_LOAD_CONCURRENCY,
            async (candidateThreadId) => {
              const summary = historyCandidateById.get(candidateThreadId);
              if (!summary) {
                return null;
              }
              try {
                const snapshot = await createHistoryLoader(summary.id).load(summary.id);
                return { summary, snapshot };
              } catch (candidateError) {
                onDebug?.({
                  id: `${Date.now()}-history-loader-recovery-candidate-error`,
                  timestamp: Date.now(),
                  source: "error",
                  label: "thread/history recovery candidate error",
                  payload: {
                    workspaceId,
                    staleThreadId: threadId,
                    candidateThreadId: summary.id,
                    error:
                      candidateError instanceof Error
                        ? candidateError.message
                        : String(candidateError),
                  },
                });
                return null;
              }
            },
          );
          const historyMatch = selectReplacementThreadByMessageHistory({
            staleItems,
            candidates: candidateSnapshots
              .filter(
                (
                  candidate,
                ): candidate is {
                  summary: typeof historyCandidates[number];
                  snapshot: Awaited<
                    ReturnType<ReturnType<typeof createHistoryLoader>["load"]>
                  >;
                } => candidate !== null,
              )
              .map(({ summary, snapshot }) => ({
                summary,
                items: snapshot.items,
              })),
          });
          if (!historyMatch) {
            return null;
          }
          const matchedSnapshot = candidateSnapshots.find(
            (candidate) => candidate?.summary.id === historyMatch.id,
          )?.snapshot;
          return {
            threadId: historyMatch.id,
            ...(matchedSnapshot ? { snapshot: matchedSnapshot } : {}),
          };
        };
        try {
          const snapshot = await createHistoryLoader(threadId).load(threadId);
          await hydrateHistorySnapshot(threadId, snapshot);
          return threadId;
        } catch (error) {
          if (isThreadResumeNotFoundError(error)) {
            try {
              const recoveredThread = await recoverReplacementThread();
              if (recoveredThread) {
                const replacementThreadId = recoveredThread.threadId;
                const replacementSnapshot =
                  recoveredThread.snapshot ??
                  (await createHistoryLoader(replacementThreadId).load(
                    replacementThreadId,
                  ));
                await hydrateHistorySnapshot(replacementThreadId, replacementSnapshot);
                dispatch({
                  type: "clearUserInputRequestsForThread",
                  workspaceId,
                  threadId,
                });
                loadedThreadsRef.current[threadId] = false;
                rememberThreadAlias?.(threadId, replacementThreadId);
                dispatch({
                  type: "setActiveThreadId",
                  workspaceId,
                  threadId: replacementThreadId,
                });
                onDebug?.({
                  id: `${Date.now()}-history-loader-recovered-thread-alias`,
                  timestamp: Date.now(),
                  source: "client",
                  label: "thread/history recovered stale thread",
                  payload: {
                    workspaceId,
                    staleThreadId: threadId,
                    replacementThreadId,
                  },
                });
                return replacementThreadId;
              }
            } catch (recoveryError) {
              onDebug?.({
                id: `${Date.now()}-history-loader-recovery-error`,
                timestamp: Date.now(),
                source: "error",
                label: "thread/history recovery error",
                payload:
                  recoveryError instanceof Error
                    ? recoveryError.message
                    : String(recoveryError),
              });
            }
          }
          onDebug?.({
            id: `${Date.now()}-history-loader-error`,
            timestamp: Date.now(),
            source: "error",
            label: "thread/history loader error",
            payload: error instanceof Error ? error.message : String(error),
          });
          // Fallback to legacy path to preserve recovery.
        }
      }
      // Claude sessions don't use Codex thread/resume RPC —
      // load message history from JSONL and populate the thread
      const workspacePath = workspacePathsByIdRef.current[workspaceId];
      if (threadId.startsWith("claude:")) {
        dispatch({ type: "ensureThread", workspaceId, threadId, engine: "claude" });
        if (workspacePath && !loadedThreadsRef.current[threadId]) {
          const realSessionId = threadId.slice("claude:".length);
          try {
            const result = await loadClaudeSessionService(
              workspacePath,
              realSessionId,
            );
            // Handle both new format { messages, usage } and old format (array)
            const messagesData = (result as { messages?: unknown }).messages ?? result;
            const usageData = (result as { usage?: unknown }).usage as {
              inputTokens?: number;
              outputTokens?: number;
              cacheCreationInputTokens?: number;
              cacheReadInputTokens?: number;
            } | undefined;

            const items = parseClaudeHistoryMessages(messagesData);
            if (items.length > 0) {
              dispatch({ type: "setThreadItems", threadId, items });
            }

            // Dispatch usage data if available
            if (usageData && (usageData.inputTokens || usageData.outputTokens)) {
              const cachedTokens = (usageData.cacheCreationInputTokens ?? 0) + (usageData.cacheReadInputTokens ?? 0);
              dispatch({
                type: "setThreadTokenUsage",
                threadId,
                tokenUsage: {
                  total: {
                    inputTokens: usageData.inputTokens ?? 0,
                    outputTokens: usageData.outputTokens ?? 0,
                    cachedInputTokens: cachedTokens,
                    totalTokens: (usageData.inputTokens ?? 0) + (usageData.outputTokens ?? 0),
                    reasoningOutputTokens: 0,
                  },
                  last: {
                    inputTokens: usageData.inputTokens ?? 0,
                    outputTokens: usageData.outputTokens ?? 0,
                    cachedInputTokens: cachedTokens,
                    totalTokens: (usageData.inputTokens ?? 0) + (usageData.outputTokens ?? 0),
                    reasoningOutputTokens: 0,
                  },
                  modelContextWindow: DEFAULT_CLAUDE_CONTEXT_WINDOW,
                },
              });
            }
          } catch {
            // Failed to load Claude session history — not fatal
          }
        }
        loadedThreadsRef.current[threadId] = true;
        return threadId;
      }
      if (threadId.startsWith("opencode:")) {
        dispatch({ type: "ensureThread", workspaceId, threadId, engine: "opencode" });
        loadedThreadsRef.current[threadId] = true;
        return threadId;
      }
      if (threadId.startsWith("gemini:")) {
        dispatch({ type: "ensureThread", workspaceId, threadId, engine: "gemini" });
        if (workspacePath && !loadedThreadsRef.current[threadId]) {
          const realSessionId = threadId.slice("gemini:".length);
          try {
            const result = await loadGeminiSessionService(
              workspacePath,
              realSessionId,
            );
            const messagesData = (result as { messages?: unknown }).messages ?? result;
            const items = parseGeminiHistoryMessages(messagesData);
            if (items.length > 0) {
              dispatch({ type: "setThreadItems", threadId, items });
            }
          } catch {
            // Failed to load Gemini session history — not fatal
          }
        }
        loadedThreadsRef.current[threadId] = true;
        return threadId;
      }
      if (!force && loadedThreadsRef.current[threadId]) {
        return threadId;
      }
      if (status?.isProcessing && loadedThreadsRef.current[threadId] && !force) {
        onDebug?.({
          id: `${Date.now()}-client-thread-resume-skipped`,
          timestamp: Date.now(),
          source: "client",
          label: "thread/resume skipped",
          payload: { workspaceId, threadId, reason: "active-turn" },
        });
        return threadId;
      }
      onDebug?.({
        id: `${Date.now()}-client-thread-resume`,
        timestamp: Date.now(),
        source: "client",
        label: "thread/resume",
        payload: { workspaceId, threadId },
      });
      try {
        const response =
          (await resumeThreadService(workspaceId, threadId)) as
            | Record<string, unknown>
            | null;
        onDebug?.({
          id: `${Date.now()}-server-thread-resume`,
          timestamp: Date.now(),
          source: "server",
          label: "thread/resume response",
          payload: response,
        });
        const result = (response?.result ?? response) as
          | Record<string, unknown>
          | null;
        const thread = (result?.thread ?? response?.thread ?? null) as
          | Record<string, unknown>
          | null;
        if (thread) {
          dispatch({ type: "ensureThread", workspaceId, threadId, engine: "codex" });
          applyCollabThreadLinksFromThread(threadId, thread);
          const items = buildItemsFromThread(thread);
          const localItems = itemsByThread[threadId] ?? [];
          const shouldReplace =
            replaceLocal || replaceOnResumeRef.current[threadId] === true;
          if (shouldReplace) {
            replaceOnResumeRef.current[threadId] = false;
          }
          if (localItems.length > 0 && !shouldReplace) {
            loadedThreadsRef.current[threadId] = true;
            return threadId;
          }
          const hasOverlap =
            items.length > 0 &&
            localItems.length > 0 &&
            items.some((item) => localItems.some((local) => local.id === item.id));
          const mergedItems =
            items.length > 0
              ? shouldReplace
                ? items
                : localItems.length > 0 && !hasOverlap
                  ? localItems
                  : mergeThreadItems(items, localItems)
              : localItems;
          if (mergedItems.length > 0) {
            dispatch({
              type: "setThreadItems",
              threadId,
              items: mergedItems,
            });
          }
          dispatch({
            type: "markReviewing",
            threadId,
            isReviewing: isReviewingFromThread(thread),
          });
          const preview = asString(thread?.preview ?? "");
          const customName = getCustomName(workspaceId, threadId);
          if (!customName && preview) {
            dispatch({
              type: "setThreadName",
              workspaceId,
              threadId,
              name: previewThreadName(preview, `Agent ${threadId.slice(0, 4)}`),
            });
          }
          const lastAgentMessage = [...mergedItems]
            .reverse()
            .find(
              (item) => item.kind === "message" && item.role === "assistant",
            ) as ConversationItem | undefined;
          const lastText =
            lastAgentMessage && lastAgentMessage.kind === "message"
              ? lastAgentMessage.text
              : preview;
          if (lastText) {
            dispatch({
              type: "setLastAgentMessage",
              threadId,
              text: lastText,
              timestamp: getThreadTimestamp(thread),
            });
          }
        }
        loadedThreadsRef.current[threadId] = true;
        return threadId;
      } catch (error) {
        onDebug?.({
          id: `${Date.now()}-client-thread-resume-error`,
          timestamp: Date.now(),
          source: "error",
          label: "thread/resume error",
          payload: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    },
    [
      activeThreadIdByWorkspace,
      applyCollabThreadLinksFromThread,
      updateThreadParent,
      dispatch,
      getCustomName,
      itemsByThread,
      loadedThreadsRef,
      onDebug,
      rememberThreadAlias,
      replaceOnResumeRef,
      threadStatusById,
      threadsByWorkspace,
      userInputRequests,
      useUnifiedHistoryLoader,
    ],
  );

  const forkThreadForWorkspace = useCallback(
    async (
      workspaceId: string,
      threadId: string,
      options?: { activate?: boolean },
    ) => {
      if (!threadId) {
        return null;
      }
      const shouldActivate = options?.activate !== false;
      onDebug?.({
        id: `${Date.now()}-client-thread-fork`,
        timestamp: Date.now(),
        source: "client",
        label: "thread/fork",
        payload: { workspaceId, threadId },
      });
      try {
        let response: Record<string, unknown> | null | undefined;
        if (threadId.startsWith("claude:")) {
          const workspacePath = workspacePathsByIdRef.current[workspaceId];
          if (!workspacePath) {
            return null;
          }
          const sessionId = threadId.slice("claude:".length).trim();
          if (!sessionId) {
            return null;
          }
          response = await forkClaudeSessionService(workspacePath, sessionId);
        } else if (threadId.startsWith("claude-pending-")) {
          return null;
        } else if (threadId.startsWith("gemini:") || threadId.startsWith("gemini-pending-")) {
          return null;
        } else {
          response = await forkThreadService(workspaceId, threadId);
        }
        onDebug?.({
          id: `${Date.now()}-server-thread-fork`,
          timestamp: Date.now(),
          source: "server",
          label: "thread/fork response",
          payload: response,
        });
        const forkedThreadId = extractThreadId(response);
        if (!forkedThreadId) {
          return null;
        }
        const forkedEngine = forkedThreadId.startsWith("claude:")
          ? "claude"
          : forkedThreadId.startsWith("gemini:")
            ? "gemini"
            : "codex";
        dispatch({
          type: "ensureThread",
          workspaceId,
          threadId: forkedThreadId,
          engine: forkedEngine,
        });
        if (shouldActivate) {
          dispatch({
            type: "setActiveThreadId",
            workspaceId,
            threadId: forkedThreadId,
          });
        }
        loadedThreadsRef.current[forkedThreadId] = false;
        await resumeThreadForWorkspace(workspaceId, forkedThreadId, true, true);
        return forkedThreadId;
      } catch (error) {
        onDebug?.({
          id: `${Date.now()}-client-thread-fork-error`,
          timestamp: Date.now(),
          source: "error",
          label: "thread/fork error",
          payload: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    },
    [dispatch, extractThreadId, loadedThreadsRef, onDebug, resumeThreadForWorkspace],
  );

  const forkClaudeSessionFromMessageForWorkspace = useCallback(
    async (
      workspaceId: string,
      threadId: string,
      messageId: string,
      options?: RewindFromMessageOptions,
    ) => {
      if (!threadId.startsWith("claude:")) {
        return null;
      }
      const normalizedMessageId = messageId.trim();
      if (!normalizedMessageId) {
        return null;
      }
      const workspacePath = workspacePathsByIdRef.current[workspaceId];
      if (!workspacePath) {
        return null;
      }
      const sessionId = threadId.slice("claude:".length).trim();
      if (!sessionId) {
        return null;
      }
      const shouldActivate = options?.activate !== false;
      const rewindMode = normalizeRewindMode(options?.mode);
      const shouldRestoreFiles = shouldRestoreWorkspaceFiles(rewindMode);
      const shouldRewindSession = shouldRewindMessages(rewindMode);
      const rewindLockKey = `${workspaceId}:${threadId}`;
      if (claudeRewindInFlightByThreadRef.current[rewindLockKey]) {
        return null;
      }
      claudeRewindInFlightByThreadRef.current[rewindLockKey] = true;
      onDebug?.({
        id: `${Date.now()}-client-thread-fork-from-message`,
        timestamp: Date.now(),
        source: "client",
        label: "thread/fork from message",
        payload: { workspaceId, threadId, messageId: normalizedMessageId },
      });
      let rewindRestoreState:
        | Awaited<ReturnType<typeof applyClaudeRewindWorkspaceRestore>>
        | null = null;
      try {
        const threadItems = itemsByThread[threadId] ?? [];
        const historyResponse = await loadClaudeSessionService(
          workspacePath,
          sessionId,
        );
        const historyRecord =
          historyResponse && typeof historyResponse === "object"
            ? (historyResponse as Record<string, unknown>)
            : {};
        const historyItems = parseClaudeHistoryMessages(historyRecord.messages);
        const firstHistoryMessageId = findFirstHistoryUserMessageId(historyItems);
        const latestHistoryMessageId = findLatestHistoryUserMessageId(historyItems);
        if (!latestHistoryMessageId) {
          return null;
        }
        const requestedHistoryMessageId = resolveClaudeRewindMessageIdFromHistory({
          requestedMessageId: normalizedMessageId,
          threadItems,
          historyItems,
        });
        const resolvedMessageId = requestedHistoryMessageId.trim();
        if (!resolvedMessageId) {
          return null;
        }
        const impactedItems = findImpactedClaudeRewindItems(
          threadItems,
          normalizedMessageId,
        );
        onDebug?.({
          id: `${Date.now()}-client-thread-fork-from-message-resolved`,
          timestamp: Date.now(),
          source: "client",
          label: "thread/fork from message resolved",
          payload: {
            workspaceId,
            threadId,
            requestedMessageId: normalizedMessageId,
            resolvedMessageId,
            firstHistoryMessageId,
            latestHistoryMessageId,
          },
        });
        if (shouldRestoreFiles) {
          rewindRestoreState = await applyClaudeRewindWorkspaceRestore({
            workspaceId,
            workspacePath,
            impactedItems,
          });
          if ((rewindRestoreState?.ignoredCommittedPaths?.length ?? 0) > 0) {
            onDebug?.({
              id: `${Date.now()}-client-thread-fork-from-message-restore-committed-ignored`,
              timestamp: Date.now(),
              source: "client",
              label: "thread/fork from message restore committed ignored",
              payload: {
                workspaceId,
                threadId,
                ignoredCommittedPaths:
                  rewindRestoreState?.ignoredCommittedPaths ?? [],
              },
            });
          }
          if ((rewindRestoreState?.skippedPaths?.length ?? 0) > 0) {
            onDebug?.({
              id: `${Date.now()}-client-thread-fork-from-message-restore-skipped`,
              timestamp: Date.now(),
              source: "error",
              label: "thread/fork from message restore skipped",
              payload: {
                workspaceId,
                threadId,
                skippedPaths: rewindRestoreState?.skippedPaths ?? [],
              },
            });
          }
        }
        if (!shouldRewindSession) {
          return threadId;
        }
        if (
          firstHistoryMessageId &&
          resolvedMessageId === firstHistoryMessageId
        ) {
          await deleteClaudeSessionService(workspacePath, sessionId);
          delete loadedThreadsRef.current[threadId];
          dispatch({
            type: "removeThread",
            workspaceId,
            threadId,
          });
          return threadId;
        }
        const response = await forkClaudeSessionFromMessageService(
          workspacePath,
          sessionId,
          resolvedMessageId,
        );
        onDebug?.({
          id: `${Date.now()}-server-thread-fork-from-message`,
          timestamp: Date.now(),
          source: "server",
          label: "thread/fork from message response",
          payload: response,
        });
        const forkedThreadId = extractThreadId(response);
        if (!forkedThreadId) {
          if (
            shouldRestoreFiles &&
            rewindRestoreState?.originalSnapshots?.length
          ) {
            await restoreClaudeRewindWorkspaceSnapshots(
              workspaceId,
              rewindRestoreState.originalSnapshots,
            );
          }
          return null;
        }
        dispatch({
          type: "renameThreadId",
          workspaceId,
          oldThreadId: threadId,
          newThreadId: forkedThreadId,
        });
        dispatch({
          type: "hideThread",
          workspaceId,
          threadId,
        });
        try {
          await renameThreadTitleKeyService(workspaceId, threadId, forkedThreadId);
          onRenameThreadTitleMapping?.(workspaceId, threadId, forkedThreadId);
        } catch {
          const previousName = getCustomName(workspaceId, threadId);
          if (previousName) {
            try {
              await setThreadTitleService(workspaceId, forkedThreadId, previousName);
              onRenameThreadTitleMapping?.(workspaceId, threadId, forkedThreadId);
            } catch {
              // Best-effort persistence; keep local rename even if title migration fails.
            }
          }
        }
        if (
          shouldActivate &&
          !activeThreadIdByWorkspace[workspaceId]
        ) {
          dispatch({
            type: "setActiveThreadId",
            workspaceId,
            threadId: forkedThreadId,
          });
        }
        delete loadedThreadsRef.current[threadId];
        loadedThreadsRef.current[forkedThreadId] = false;
        await resumeThreadForWorkspace(workspaceId, forkedThreadId, true, true);
        try {
          await deleteClaudeSessionService(workspacePath, sessionId);
        } catch (error) {
          onDebug?.({
            id: `${Date.now()}-client-thread-fork-from-message-delete-source-error`,
            timestamp: Date.now(),
            source: "error",
            label: "thread/fork from message delete source error",
            payload: error instanceof Error ? error.message : String(error),
          });
        }
        return forkedThreadId;
      } catch (error) {
        try {
          if (
            shouldRestoreFiles &&
            rewindRestoreState?.originalSnapshots?.length
          ) {
            await restoreClaudeRewindWorkspaceSnapshots(
              workspaceId,
              rewindRestoreState.originalSnapshots,
            );
          }
        } catch {
          // Best effort rollback is handled in the main rewind path below.
        }
        onDebug?.({
          id: `${Date.now()}-client-thread-fork-from-message-error`,
          timestamp: Date.now(),
          source: "error",
          label: "thread/fork from message error",
          payload: error instanceof Error ? error.message : String(error),
        });
        return null;
      } finally {
        delete claudeRewindInFlightByThreadRef.current[rewindLockKey];
      }
    },
    [
      dispatch,
      extractThreadId,
      activeThreadIdByWorkspace,
      getCustomName,
      itemsByThread,
      loadedThreadsRef,
      onDebug,
      onRenameThreadTitleMapping,
      resumeThreadForWorkspace,
    ],
  );

  const forkSessionFromMessageForWorkspace = useCallback(
    async (
      workspaceId: string,
      threadId: string,
      messageId: string,
      options?: RewindFromMessageOptions,
    ) => {
      const canonicalThreadId = threadId.trim();
      const rewindEngine = resolveRewindSupportedEngine(canonicalThreadId);
      if (!rewindEngine) {
        return null;
      }
      if (rewindEngine === "claude") {
        const claudeThreadId = canonicalThreadId.replace(/^claude:/i, "claude:");
        return forkClaudeSessionFromMessageForWorkspace(
          workspaceId,
          claudeThreadId,
          messageId,
          options,
        );
      }

      const normalizedMessageId = messageId.trim();
      if (!normalizedMessageId) {
        return null;
      }
      const workspacePath = workspacePathsByIdRef.current[workspaceId];
      if (!workspacePath) {
        return null;
      }
      const shouldActivate = options?.activate !== false;
      const rewindMode = normalizeRewindMode(options?.mode);
      const shouldRestoreFiles = shouldRestoreWorkspaceFiles(rewindMode);
      const shouldRewindSession = shouldRewindMessages(rewindMode);
      const rewindLockKey = `${workspaceId}:${canonicalThreadId}`;
      if (claudeRewindInFlightByThreadRef.current[rewindLockKey]) {
        return null;
      }
      claudeRewindInFlightByThreadRef.current[rewindLockKey] = true;
      onDebug?.({
        id: `${Date.now()}-client-thread-codex-fork-from-message`,
        timestamp: Date.now(),
        source: "client",
        label: "codex/thread/fork from message",
        payload: {
          workspaceId,
          threadId: canonicalThreadId,
          messageId: normalizedMessageId,
        },
      });
      let rewindRestoreState:
        | Awaited<ReturnType<typeof applyClaudeRewindWorkspaceRestore>>
        | null = null;
      try {
        const threadItems = itemsByThread[canonicalThreadId] ?? [];
        const userThreadItems = threadItems.filter(isUserConversationMessage);
        const targetUserTurnIndex = findLastUserMessageIndexById(
          userThreadItems,
          normalizedMessageId,
        );
        if (targetUserTurnIndex < 0) {
          return null;
        }
        const targetUserMessageText = normalizeComparableRewindText(
          userThreadItems[targetUserTurnIndex]?.text ?? "",
        );
        const targetUserMessageOccurrence = targetUserMessageText
          ? userThreadItems.reduce((count, item, index) => {
              if (index > targetUserTurnIndex) {
                return count;
              }
              return normalizeComparableRewindText(item.text) === targetUserMessageText
                ? count + 1
                : count;
            }, 0) || 1
          : undefined;
        const impactedItems = findImpactedClaudeRewindItems(
          threadItems,
          normalizedMessageId,
        );
        if (shouldRestoreFiles) {
          rewindRestoreState = await applyClaudeRewindWorkspaceRestore({
            workspaceId,
            workspacePath,
            impactedItems,
          });
          if ((rewindRestoreState?.ignoredCommittedPaths?.length ?? 0) > 0) {
            onDebug?.({
              id: `${Date.now()}-client-thread-codex-fork-from-message-restore-committed-ignored`,
              timestamp: Date.now(),
              source: "client",
              label: "codex/thread/fork from message restore committed ignored",
              payload: {
                workspaceId,
                threadId: canonicalThreadId,
                ignoredCommittedPaths:
                  rewindRestoreState?.ignoredCommittedPaths ?? [],
              },
            });
          }
          if ((rewindRestoreState?.skippedPaths?.length ?? 0) > 0) {
            onDebug?.({
              id: `${Date.now()}-client-thread-codex-fork-from-message-restore-skipped`,
              timestamp: Date.now(),
              source: "error",
              label: "codex/thread/fork from message restore skipped",
              payload: {
                workspaceId,
                threadId: canonicalThreadId,
                skippedPaths: rewindRestoreState?.skippedPaths ?? [],
              },
            });
          }
        }
        if (!shouldRewindSession) {
          return canonicalThreadId;
        }

        if (targetUserTurnIndex === 0) {
          await deleteCodexSessionService(workspaceId, canonicalThreadId);
          delete loadedThreadsRef.current[canonicalThreadId];
          dispatch({
            type: "removeThread",
            workspaceId,
            threadId: canonicalThreadId,
          });
          return canonicalThreadId;
        }

        const hardRewindResponse = await rewindCodexThreadService(
          workspaceId,
          canonicalThreadId,
          targetUserTurnIndex,
          normalizedMessageId,
          {
            targetUserMessageText:
              targetUserMessageText.length > 0 ? targetUserMessageText : undefined,
            targetUserMessageOccurrence,
            localUserMessageCount: userThreadItems.length,
          },
        );
        onDebug?.({
          id: `${Date.now()}-server-thread-codex-fork-from-message`,
          timestamp: Date.now(),
          source: "server",
          label: "codex/thread/fork from message response",
          payload: hardRewindResponse,
        });
        const forkedThreadId = extractThreadId(hardRewindResponse);
        if (!forkedThreadId) {
          if (
            shouldRestoreFiles &&
            rewindRestoreState?.originalSnapshots?.length
          ) {
            await restoreClaudeRewindWorkspaceSnapshots(
              workspaceId,
              rewindRestoreState.originalSnapshots,
            );
          }
          return null;
        }
        dispatch({
          type: "renameThreadId",
          workspaceId,
          oldThreadId: canonicalThreadId,
          newThreadId: forkedThreadId,
        });
        dispatch({
          type: "hideThread",
          workspaceId,
          threadId: canonicalThreadId,
        });
        try {
          await renameThreadTitleKeyService(
            workspaceId,
            canonicalThreadId,
            forkedThreadId,
          );
          onRenameThreadTitleMapping?.(
            workspaceId,
            canonicalThreadId,
            forkedThreadId,
          );
        } catch {
          const previousName = getCustomName(workspaceId, canonicalThreadId);
          if (previousName) {
            try {
              await setThreadTitleService(workspaceId, forkedThreadId, previousName);
              onRenameThreadTitleMapping?.(
                workspaceId,
                canonicalThreadId,
                forkedThreadId,
              );
            } catch {
              // Best-effort persistence; keep local rename even if title migration fails.
            }
          }
        }
        if (
          shouldActivate &&
          !activeThreadIdByWorkspace[workspaceId]
        ) {
          dispatch({
            type: "setActiveThreadId",
            workspaceId,
            threadId: forkedThreadId,
          });
        }
        delete loadedThreadsRef.current[canonicalThreadId];
        loadedThreadsRef.current[forkedThreadId] = false;
        await resumeThreadForWorkspace(workspaceId, forkedThreadId, true, true);
        return forkedThreadId;
      } catch (error) {
        try {
          if (
            shouldRestoreFiles &&
            rewindRestoreState?.originalSnapshots?.length
          ) {
            await restoreClaudeRewindWorkspaceSnapshots(
              workspaceId,
              rewindRestoreState.originalSnapshots,
            );
          }
        } catch {
          // Best effort rollback is handled in the main rewind path below.
        }
        onDebug?.({
          id: `${Date.now()}-client-thread-codex-fork-from-message-error`,
          timestamp: Date.now(),
          source: "error",
          label: "codex/thread/fork from message error",
          payload: error instanceof Error ? error.message : String(error),
        });
        return null;
      } finally {
        delete claudeRewindInFlightByThreadRef.current[rewindLockKey];
      }
    },
    [
      dispatch,
      extractThreadId,
      activeThreadIdByWorkspace,
      forkClaudeSessionFromMessageForWorkspace,
      getCustomName,
      itemsByThread,
      loadedThreadsRef,
      onDebug,
      onRenameThreadTitleMapping,
      resumeThreadForWorkspace,
    ],
  );

  const refreshThread = useCallback(
    async (workspaceId: string, threadId: string) => {
      if (!threadId) {
        return null;
      }
      replaceOnResumeRef.current[threadId] = true;
      return resumeThreadForWorkspace(workspaceId, threadId, true, true);
    },
    [replaceOnResumeRef, resumeThreadForWorkspace],
  );

  const resetWorkspaceThreads = useCallback(
    (workspaceId: string) => {
      const threadIds = new Set<string>();
      const list = threadsByWorkspace[workspaceId] ?? [];
      list.forEach((thread) => threadIds.add(thread.id));
      const activeThread = activeThreadIdByWorkspace[workspaceId];
      if (activeThread) {
        threadIds.add(activeThread);
      }
      threadIds.forEach((threadId) => {
        loadedThreadsRef.current[threadId] = false;
      });
    },
    [activeThreadIdByWorkspace, loadedThreadsRef, threadsByWorkspace],
  );

  const listThreadsForWorkspace = useCallback(
    async (
      workspace: WorkspaceInfo,
      options?: {
        preserveState?: boolean;
        includeOpenCodeSessions?: boolean;
      },
    ) => {
      // Store workspace path for Claude session loading
      workspacePathsByIdRef.current[workspace.id] = workspace.path;
      const requestSeq = (threadListRequestSeqRef.current[workspace.id] ?? 0) + 1;
      threadListRequestSeqRef.current[workspace.id] = requestSeq;
      const isLatestThreadListRequest = () =>
        threadListRequestSeqRef.current[workspace.id] === requestSeq;
      const preserveState = options?.preserveState ?? false;
      const includeOpenCodeSessions = options?.includeOpenCodeSessions ?? true;
      const workspacePath = normalizeComparableWorkspacePath(workspace.path);
      if (!preserveState) {
        dispatch({
          type: "setThreadListLoading",
          workspaceId: workspace.id,
          isLoading: true,
        });
        dispatch({
          type: "setThreadListCursor",
          workspaceId: workspace.id,
          cursor: null,
        });
      }
      onDebug?.({
        id: `${Date.now()}-client-thread-list`,
        timestamp: Date.now(),
        source: "client",
        label: "thread/list",
        payload: { workspaceId: workspace.id, path: workspace.path },
      });
      try {
        let mappedTitles: Record<string, string> = {};
        const archivedSessionMapPromise = loadArchivedSessionMap(workspace.id);
        try {
          mappedTitles = await listThreadTitlesService(workspace.id);
          onThreadTitleMappingsLoaded?.(workspace.id, mappedTitles);
        } catch {
          mappedTitles = {};
        }
        const sharedSessions = normalizeSharedSessionSummaries(
          await listSharedSessionsService(workspace.id).catch(() => []),
        );
        const hiddenSharedBindingIds = new Set(
          sharedSessions.flatMap((session) => session.nativeThreadIds),
        );
        const existingThreads = threadsByWorkspace[workspace.id] ?? [];
        const activeThreadId = activeThreadIdByWorkspace[workspace.id] ?? "";
        const knownCodexThreadIds = collectKnownCodexThreadIds(
          existingThreads,
          activeThreadId,
        );
        const engineById = new Map(
          existingThreads.map((thread) => [thread.id, thread.engineSource]),
        );
        const hasGeminiSignal =
          existingThreads.some(
            (thread) =>
              thread.engineSource === "gemini" ||
              thread.id.startsWith("gemini:") ||
              thread.id.startsWith("gemini-pending-"),
          ) ||
          activeThreadId.startsWith("gemini:") ||
          activeThreadId.startsWith("gemini-pending-") ||
          Object.keys(mappedTitles).some((id) => id.startsWith("gemini:"));
        const cachedGemini = geminiSessionCacheRef.current[workspace.id];
        const hasFreshGeminiCache =
          !!cachedGemini &&
          Date.now() - cachedGemini.fetchedAt <= GEMINI_SESSION_CACHE_TTL_MS;
        const knownActivityByThread = threadActivityRef.current[workspace.id] ?? {};
        const hasKnownActivity = Object.keys(knownActivityByThread).length > 0;
        const matchingThreads: Record<string, unknown>[] = [];
        const targetCount = THREAD_LIST_TARGET_COUNT;
        const pageSize = THREAD_LIST_PAGE_SIZE;
        const maxPagesWithoutMatch = hasKnownActivity
          ? THREAD_LIST_MAX_EMPTY_PAGES_WITH_ACTIVITY
          : THREAD_LIST_MAX_EMPTY_PAGES;
        let pagesFetched = 0;
        const fetchStartedAt = Date.now();
        let cursor: string | null = null;
        do {
          pagesFetched += 1;
          let response: Record<string, unknown>;
          try {
            const liveResponse = await withTimeout((async () => {
              try {
                return await listThreadsService(workspace.id, cursor, pageSize);
              } catch (error) {
                if (!isWorkspaceNotConnectedError(error)) {
                  throw error;
                }
                onDebug?.({
                  id: `${Date.now()}-client-workspace-reconnect-before-thread-list`,
                  timestamp: Date.now(),
                  source: "client",
                  label: "workspace/reconnect before thread list",
                  payload: { workspaceId: workspace.id },
                });
                await connectWorkspaceService(workspace.id);
                return await listThreadsService(workspace.id, cursor, pageSize);
              }
            })(), THREAD_LIST_LIVE_REQUEST_TIMEOUT_MS);
            if (liveResponse === null) {
              onDebug?.({
                id: `${Date.now()}-client-thread-list-live-timeout`,
                timestamp: Date.now(),
                source: "error",
                label: "thread/list live timeout",
                payload: {
                  workspaceId: workspace.id,
                  cursor,
                  timeoutMs: THREAD_LIST_LIVE_REQUEST_TIMEOUT_MS,
                },
              });
              break;
            }
            response = liveResponse as Record<string, unknown>;
          } catch (error) {
            if (!isWorkspaceNotConnectedError(error)) {
              throw error;
            }
            onDebug?.({
              id: `${Date.now()}-client-thread-list-codex-unavailable`,
              timestamp: Date.now(),
              source: "client",
              label: "thread/list codex unavailable",
              payload: {
                workspaceId: workspace.id,
                reason: error instanceof Error ? error.message : String(error),
              },
            });
            break;
          }
          onDebug?.({
            id: `${Date.now()}-server-thread-list`,
            timestamp: Date.now(),
            source: "server",
            label: "thread/list response",
            payload: response,
          });
          const result = (response.result ?? response) as Record<string, unknown>;
          const data = Array.isArray(result?.data)
            ? (result.data as Record<string, unknown>[])
            : [];
          const allowKnownCodexWithoutCwd = isLocalSessionScanUnavailable(result);
          const nextCursor =
            (result?.nextCursor ?? result?.next_cursor ?? null) as string | null;
          matchingThreads.push(
            ...data.filter(
              (thread) =>
                shouldIncludeWorkspaceThreadEntry(
                  thread,
                  workspacePath,
                  knownCodexThreadIds,
                  allowKnownCodexWithoutCwd,
                ),
            ),
          );
          cursor = nextCursor;
          if (matchingThreads.length === 0 && pagesFetched >= maxPagesWithoutMatch) {
            onDebug?.({
              id: `${Date.now()}-client-thread-list-stop-empty-pages`,
              timestamp: Date.now(),
              source: "client",
              label: "thread/list stop",
              payload: {
                workspaceId: workspace.id,
                reason: "too-many-empty-pages",
                pagesFetched,
                maxPagesWithoutMatch,
              },
            });
            break;
          }
          if (pagesFetched >= THREAD_LIST_MAX_TOTAL_PAGES) {
            onDebug?.({
              id: `${Date.now()}-client-thread-list-stop-page-cap`,
              timestamp: Date.now(),
              source: "client",
              label: "thread/list stop",
              payload: {
                workspaceId: workspace.id,
                reason: "page-cap",
                pagesFetched,
                pageCap: THREAD_LIST_MAX_TOTAL_PAGES,
              },
            });
            break;
          }
          if (Date.now() - fetchStartedAt >= THREAD_LIST_MAX_FETCH_DURATION_MS) {
            onDebug?.({
              id: `${Date.now()}-client-thread-list-stop-time-budget`,
              timestamp: Date.now(),
              source: "client",
              label: "thread/list stop",
              payload: {
                workspaceId: workspace.id,
                reason: "time-budget",
                pagesFetched,
                budgetMs: THREAD_LIST_MAX_FETCH_DURATION_MS,
              },
            });
            break;
          }
        } while (cursor && matchingThreads.length < targetCount);

        const uniqueById = new Map<string, Record<string, unknown>>();
        matchingThreads.forEach((thread) => {
          const id = String(thread?.id ?? "");
          if (id && !uniqueById.has(id)) {
            uniqueById.set(id, thread);
          }
        });
        const uniqueThreads = Array.from(uniqueById.values());
        const activityByThread = threadActivityRef.current[workspace.id] ?? {};
        const nextActivityByThread = { ...activityByThread };
        let didChangeActivity = false;
        uniqueThreads.forEach((thread) => {
          const threadId = String(thread?.id ?? "");
          if (!threadId) {
            return;
          }
          const timestamp = getThreadTimestamp(thread);
          if (timestamp > (nextActivityByThread[threadId] ?? 0)) {
            nextActivityByThread[threadId] = timestamp;
            didChangeActivity = true;
          }
        });
        uniqueThreads.sort((a, b) => {
          const aId = String(a?.id ?? "");
          const bId = String(b?.id ?? "");
          const aCreated = getThreadTimestamp(a);
          const bCreated = getThreadTimestamp(b);
          const aActivity = Math.max(nextActivityByThread[aId] ?? 0, aCreated);
          const bActivity = Math.max(nextActivityByThread[bId] ?? 0, bCreated);
          return bActivity - aActivity;
        });
        const summaries = uniqueThreads
          .slice(0, targetCount)
          .map((thread, index) => {
            const id = String(thread?.id ?? "");
            const preview = asString(thread?.preview ?? "").trim();
            const mappedTitle = mappedTitles[id];
            const customName = mappedTitle || getCustomName(workspace.id, id);
            const fallbackName = `Agent ${index + 1}`;
            const name = customName
              ? customName
              : preview.length > 0
                ? previewThreadName(preview, fallbackName)
                : fallbackName;
            const engineSource = engineById.get(id) ?? ("codex" as const);
            const sourceMeta = resolveThreadSourceMeta(thread);
            return {
              id,
              name,
              updatedAt: getThreadTimestamp(thread),
              sizeBytes: extractThreadSizeBytes(thread),
              engineSource,
              threadKind: "native" as const,
              ...sourceMeta,
            };
          })
          .filter((entry) => entry.id && !hiddenSharedBindingIds.has(entry.id));

        // Fetch Claude/OpenCode sessions in the critical path.
        // Gemini history is merged from cache first, then refreshed in background,
        // so codex/claude thread list latency stays isolated from Gemini I/O scans.
        let allSummaries: ThreadSummary[] = summaries;
        const mergedById = new Map<string, ThreadSummary>();
        allSummaries.forEach((entry) => mergedById.set(entry.id, entry));
        const opencodeSessionsPromise = includeOpenCodeSessions
          ? withTimeout(
              getOpenCodeSessionListService(workspace.id),
              NATIVE_SESSION_LIST_FETCH_TIMEOUT_MS,
            )
          : Promise.resolve([] as Awaited<ReturnType<typeof getOpenCodeSessionListService>>);
        const codexCatalogSessionsPromise = canListWorkspaceSessions
          ? withTimeout(
              listWorkspaceSessionsService(workspace.id, {
                query: { status: "active", engine: "codex" },
                limit: SESSION_CATALOG_PAGE_SIZE,
              }),
              CODEX_SESSION_CATALOG_FETCH_TIMEOUT_MS,
            )
          : Promise.resolve(null);
        const [claudeResult, opencodeResult, codexCatalogResult] = await Promise.allSettled([
          withTimeout(
            listClaudeSessionsService(workspace.path, 50),
            NATIVE_SESSION_LIST_FETCH_TIMEOUT_MS,
          ),
          opencodeSessionsPromise,
          codexCatalogSessionsPromise,
        ]);
        if (claudeResult.status === "fulfilled") {
          if (claudeResult.value === null) {
            onDebug?.({
              id: `${Date.now()}-client-claude-session-timeout`,
              timestamp: Date.now(),
              source: "client",
              label: "thread/list claude timeout",
              payload: {
                workspaceId: workspace.id,
                timeoutMs: NATIVE_SESSION_LIST_FETCH_TIMEOUT_MS,
              },
            });
          }
          const claudeSessions = Array.isArray(claudeResult.value)
            ? claudeResult.value
            : [];
          claudeSessions.forEach(
            (session: {
              sessionId: string;
              firstMessage: string;
              updatedAt: number;
              fileSizeBytes?: number;
            }) => {
              const id = `claude:${session.sessionId}`;
              if (hiddenSharedBindingIds.has(id)) {
                return;
              }
              const prev = mergedById.get(id);
              const updatedAt = session.updatedAt;
              const next: ThreadSummary = {
                id,
                name:
                  mappedTitles[id] ||
                  getCustomName(workspace.id, id) ||
                  previewThreadName(session.firstMessage, "Claude Session"),
                updatedAt,
                sizeBytes: extractThreadSizeBytes(session as Record<string, unknown>),
                engineSource: "claude",
                threadKind: "native",
              };
              if (!prev || next.updatedAt >= prev.updatedAt) {
                mergedById.set(id, next);
              }
            },
          );
        }
        if (opencodeResult.status === "fulfilled") {
          if (opencodeResult.value === null) {
            onDebug?.({
              id: `${Date.now()}-client-opencode-session-timeout`,
              timestamp: Date.now(),
              source: "client",
              label: "thread/list opencode timeout",
              payload: {
                workspaceId: workspace.id,
                timeoutMs: NATIVE_SESSION_LIST_FETCH_TIMEOUT_MS,
              },
            });
          }
          const opencodeSessions = Array.isArray(opencodeResult.value)
            ? opencodeResult.value
            : [];
          opencodeSessions.forEach((session) => {
            const id = `opencode:${session.sessionId}`;
            if (hiddenSharedBindingIds.has(id)) {
              return;
            }
            const prev = mergedById.get(id);
            const sessionUpdatedAt =
              typeof session.updatedAt === "number" && Number.isFinite(session.updatedAt)
                ? Math.max(0, session.updatedAt)
                : 0;
            const updatedAt =
              sessionUpdatedAt ||
              nextActivityByThread[id] ||
              prev?.updatedAt ||
              0;
            if (updatedAt > (nextActivityByThread[id] ?? 0)) {
              nextActivityByThread[id] = updatedAt;
              didChangeActivity = true;
            }
            const next: ThreadSummary = {
              id,
              name:
                mappedTitles[id] ||
                getCustomName(workspace.id, id) ||
                previewThreadName(session.title, "OpenCode Session"),
              updatedAt,
              sizeBytes: extractThreadSizeBytes(session as Record<string, unknown>),
              engineSource: "opencode",
              threadKind: "native",
            };
            if (!prev || next.updatedAt >= prev.updatedAt) {
              mergedById.set(id, next);
            }
          });
        }
        if (codexCatalogResult.status === "fulfilled") {
          if (codexCatalogResult.value === null) {
            onDebug?.({
              id: `${Date.now()}-client-codex-catalog-timeout`,
              timestamp: Date.now(),
              source: "client",
              label: "thread/list codex catalog timeout",
              payload: {
                workspaceId: workspace.id,
                timeoutMs: NATIVE_SESSION_LIST_FETCH_TIMEOUT_MS,
              },
            });
          }
          const codexCatalogPage =
            codexCatalogResult.value && typeof codexCatalogResult.value === "object"
              ? codexCatalogResult.value
              : null;
          const codexCatalogSessions = Array.isArray(codexCatalogPage?.data)
            ? codexCatalogPage.data
                .filter(
                  (entry) =>
                    entry &&
                    typeof entry === "object" &&
                    !hiddenSharedBindingIds.has(
                      String((entry as { sessionId?: unknown }).sessionId ?? ""),
                    ),
                )
                .map((entry) => {
                  const session = entry as {
                    sessionId?: unknown;
                    title?: unknown;
                    updatedAt?: unknown;
                    sizeBytes?: unknown;
                    source?: unknown;
                    provider?: unknown;
                    sourceLabel?: unknown;
                  };
                  return {
                    sessionId: String(session.sessionId ?? "").trim(),
                    title: String(session.title ?? "").trim(),
                    updatedAt:
                      typeof session.updatedAt === "number" && Number.isFinite(session.updatedAt)
                        ? session.updatedAt
                        : 0,
                    sizeBytes:
                      typeof session.sizeBytes === "number" && Number.isFinite(session.sizeBytes)
                        ? session.sizeBytes
                        : undefined,
                    source:
                      typeof session.source === "string" || session.source == null
                        ? session.source ?? null
                        : null,
                    provider:
                      typeof session.provider === "string" || session.provider == null
                        ? session.provider ?? null
                        : null,
                    sourceLabel:
                      typeof session.sourceLabel === "string" || session.sourceLabel == null
                        ? session.sourceLabel ?? null
                        : null,
                  };
                })
                .filter((entry) => entry.sessionId.length > 0)
            : [];
          allSummaries = mergeCodexCatalogSessionSummaries(
            Array.from(mergedById.values()).sort((a, b) => b.updatedAt - a.updatedAt),
            codexCatalogSessions,
            workspace.id,
            mappedTitles,
            getCustomName,
          );
          mergedById.clear();
          allSummaries.forEach((entry) => mergedById.set(entry.id, entry));
        }
        if (!includeOpenCodeSessions) {
          existingThreads.forEach((thread) => {
            if (thread.threadKind === "shared" || hiddenSharedBindingIds.has(thread.id)) {
              return;
            }
            const isOpenCodeThread =
              thread.engineSource === "opencode"
              || thread.id.startsWith("opencode:")
              || thread.id.startsWith("opencode-pending-");
            if (!isOpenCodeThread) {
              return;
            }
            const prev = mergedById.get(thread.id);
            const threadUpdatedAt = Number.isFinite(thread.updatedAt)
              ? Math.max(0, thread.updatedAt)
              : 0;
            const updatedAt =
              threadUpdatedAt ||
              nextActivityByThread[thread.id] ||
              prev?.updatedAt ||
              0;
            if (updatedAt > (nextActivityByThread[thread.id] ?? 0)) {
              nextActivityByThread[thread.id] = updatedAt;
              didChangeActivity = true;
            }
            const next: ThreadSummary = {
              ...thread,
              updatedAt,
              engineSource: "opencode",
              threadKind: thread.threadKind ?? "native",
            };
            if (!prev || next.updatedAt >= prev.updatedAt) {
              mergedById.set(thread.id, next);
            }
          });
        }
        allSummaries = Array.from(mergedById.values()).sort(
          (a, b) => b.updatedAt - a.updatedAt,
        );
        if (hasFreshGeminiCache && cachedGemini.sessions.length > 0) {
          allSummaries = mergeGeminiSessionSummaries(
            allSummaries,
            cachedGemini.sessions.filter(
              (session) => !hiddenSharedBindingIds.has(`gemini:${session.sessionId}`),
            ),
            workspace.id,
            mappedTitles,
            getCustomName,
          );
        }
        if (sharedSessions.length > 0) {
          const sharedSummaries = sharedSessions.map(toSharedThreadSummary);
          const merged = new Map<string, ThreadSummary>();
          [...sharedSummaries, ...allSummaries].forEach((entry) => {
            const previous = merged.get(entry.id);
            if (!previous || entry.updatedAt >= previous.updatedAt) {
              merged.set(entry.id, entry);
            }
          });
          allSummaries = Array.from(merged.values()).sort(
            (a, b) => b.updatedAt - a.updatedAt,
          );
        }
        allSummaries = applySessionArchiveState(
          allSummaries,
          await archivedSessionMapPromise,
        );
        if (didChangeActivity) {
          const next = {
            ...threadActivityRef.current,
            [workspace.id]: nextActivityByThread,
          };
          threadActivityRef.current = next;
          saveThreadActivity(next);
        }

        if (!isLatestThreadListRequest()) {
          return;
        }

        dispatch({
          type: "setThreads",
          workspaceId: workspace.id,
          threads: allSummaries,
        });
        latestThreadsByWorkspaceRef.current = {
          ...latestThreadsByWorkspaceRef.current,
          [workspace.id]: allSummaries,
        };
        dispatch({
          type: "setThreadListCursor",
          workspaceId: workspace.id,
          cursor,
        });
        uniqueThreads.forEach((thread) => {
          const threadId = String(thread?.id ?? "");
          const preview = asString(thread?.preview ?? "").trim();
          if (!threadId || !preview) {
            return;
          }
          dispatch({
            type: "setLastAgentMessage",
            threadId,
            text: preview,
            timestamp: getThreadTimestamp(thread),
          });
        });

        const hasAttemptedGeminiRefresh =
          geminiRefreshAttemptedRef.current[workspace.id] === true;
        const shouldRefreshGeminiSessions =
          hasGeminiSignal || !!cachedGemini || !hasAttemptedGeminiRefresh;
        if (shouldRefreshGeminiSessions) {
          void (async () => {
            geminiRefreshAttemptedRef.current[workspace.id] = true;
            const geminiResult = await withTimeout(
              listGeminiSessionsService(workspace.path, 50),
              GEMINI_SESSION_FETCH_TIMEOUT_MS,
            );
            if (threadListRequestSeqRef.current[workspace.id] !== requestSeq) {
              return;
            }
            if (geminiResult === null) {
              onDebug?.({
                id: `${Date.now()}-client-gemini-session-timeout`,
                timestamp: Date.now(),
                source: "client",
                label: "thread/list gemini timeout",
                payload: {
                  workspaceId: workspace.id,
                  timeoutMs: GEMINI_SESSION_FETCH_TIMEOUT_MS,
                },
              });
              return;
            }
            const normalizedGeminiSessions = normalizeGeminiSessionSummaries(geminiResult);
            geminiSessionCacheRef.current[workspace.id] = {
              fetchedAt: Date.now(),
              sessions: normalizedGeminiSessions,
            };
            const currentSnapshot =
              latestThreadsByWorkspaceRef.current[workspace.id] ?? [];
            const baselineSummaries =
              currentSnapshot.length > 0 ? currentSnapshot : allSummaries;
            const nextSummaries = mergeGeminiSessionSummaries(
              baselineSummaries,
              normalizedGeminiSessions.filter(
                (session) => !hiddenSharedBindingIds.has(`gemini:${session.sessionId}`),
              ),
              workspace.id,
              mappedTitles,
              getCustomName,
            );
            const visibleNextSummaries = applySessionArchiveState(
              nextSummaries,
              await archivedSessionMapPromise,
            );
            const unchanged =
              visibleNextSummaries.length === baselineSummaries.length &&
              visibleNextSummaries.every((entry, index) => {
                const prev = baselineSummaries[index];
                return (
                  !!prev &&
                  prev.id === entry.id &&
                  prev.name === entry.name &&
                  prev.updatedAt === entry.updatedAt &&
                  prev.engineSource === entry.engineSource &&
                  prev.threadKind === entry.threadKind
                );
              });
            if (!unchanged) {
              dispatch({
                type: "setThreads",
                workspaceId: workspace.id,
                threads: visibleNextSummaries,
              });
              latestThreadsByWorkspaceRef.current = {
                ...latestThreadsByWorkspaceRef.current,
                [workspace.id]: visibleNextSummaries,
              };
            }
          })();
        }
      } catch (error) {
        onDebug?.({
          id: `${Date.now()}-client-thread-list-error`,
          timestamp: Date.now(),
          source: "error",
          label: "thread/list error",
          payload: error instanceof Error ? error.message : String(error),
        });
      } finally {
        if (!preserveState && isLatestThreadListRequest()) {
          dispatch({
            type: "setThreadListLoading",
            workspaceId: workspace.id,
            isLoading: false,
          });
        }
      }
    },
    [
      applySessionArchiveState,
      canListWorkspaceSessions,
      dispatch,
      getCustomName,
      loadArchivedSessionMap,
      onDebug,
      onThreadTitleMappingsLoaded,
      activeThreadIdByWorkspace,
      threadActivityRef,
      threadsByWorkspace,
    ],
  );

  const loadOlderThreadsForWorkspace = useCallback(
    async (workspace: WorkspaceInfo) => {
      workspacePathsByIdRef.current[workspace.id] = workspace.path;
      const nextCursor = threadListCursorByWorkspace[workspace.id] ?? null;
      if (!nextCursor) {
        return;
      }
      const workspacePath = normalizeComparableWorkspacePath(workspace.path);
      const existing = threadsByWorkspace[workspace.id] ?? [];
      const activeThreadId = activeThreadIdByWorkspace[workspace.id] ?? "";
      const knownCodexThreadIds = collectKnownCodexThreadIds(existing, activeThreadId);
      dispatch({
        type: "setThreadListPaging",
        workspaceId: workspace.id,
        isLoading: true,
      });
      onDebug?.({
        id: `${Date.now()}-client-thread-list-older`,
        timestamp: Date.now(),
        source: "client",
        label: "thread/list older",
        payload: { workspaceId: workspace.id, cursor: nextCursor },
      });
      try {
        let mappedTitles: Record<string, string> = {};
        const archivedSessionMapPromise = loadArchivedSessionMap(workspace.id);
        try {
          mappedTitles = await listThreadTitlesService(workspace.id);
          onThreadTitleMappingsLoaded?.(workspace.id, mappedTitles);
        } catch {
          mappedTitles = {};
        }
        const matchingThreads: Record<string, unknown>[] = [];
        const targetCount = THREAD_LIST_TARGET_COUNT;
        const pageSize = THREAD_LIST_PAGE_SIZE;
        const maxPagesWithoutMatch = THREAD_LIST_MAX_EMPTY_PAGES_LOAD_OLDER;
        let pagesFetched = 0;
        const fetchStartedAt = Date.now();
        let cursor: string | null = nextCursor;
        do {
          pagesFetched += 1;
          const response =
            (await listThreadsService(
              workspace.id,
              cursor,
              pageSize,
            )) as Record<string, unknown>;
          onDebug?.({
            id: `${Date.now()}-server-thread-list-older`,
            timestamp: Date.now(),
            source: "server",
            label: "thread/list older response",
            payload: response,
          });
          const result = (response.result ?? response) as Record<string, unknown>;
          const data = Array.isArray(result?.data)
            ? (result.data as Record<string, unknown>[])
            : [];
          const allowKnownCodexWithoutCwd = isLocalSessionScanUnavailable(result);
          const next =
            (result?.nextCursor ?? result?.next_cursor ?? null) as string | null;
          matchingThreads.push(
            ...data.filter(
              (thread) =>
                shouldIncludeWorkspaceThreadEntry(
                  thread,
                  workspacePath,
                  knownCodexThreadIds,
                  allowKnownCodexWithoutCwd,
                ),
            ),
          );
          cursor = next;
          if (matchingThreads.length === 0 && pagesFetched >= maxPagesWithoutMatch) {
            break;
          }
          if (pagesFetched >= THREAD_LIST_MAX_TOTAL_PAGES) {
            break;
          }
          if (Date.now() - fetchStartedAt >= THREAD_LIST_MAX_FETCH_DURATION_MS) {
            break;
          }
        } while (cursor && matchingThreads.length < targetCount);

        const existingIds = new Set(existing.map((thread) => thread.id));
        const additions: ThreadSummary[] = [];
        matchingThreads.forEach((thread) => {
          const id = String(thread?.id ?? "");
          if (!id || existingIds.has(id)) {
            return;
          }
          const preview = asString(thread?.preview ?? "").trim();
          const mappedTitle = mappedTitles[id];
          const customName = mappedTitle || getCustomName(workspace.id, id);
          const fallbackName = `Agent ${existing.length + additions.length + 1}`;
          const name = customName
            ? customName
            : preview.length > 0
              ? previewThreadName(preview, fallbackName)
              : fallbackName;
          additions.push({
            id,
            name,
            updatedAt: getThreadTimestamp(thread),
            sizeBytes: extractThreadSizeBytes(thread),
            ...resolveThreadSourceMeta(thread),
          });
          existingIds.add(id);
        });

        const visibleAdditions = applySessionArchiveState(
          additions,
          await archivedSessionMapPromise,
        );

        if (visibleAdditions.length > 0) {
          dispatch({
            type: "setThreads",
            workspaceId: workspace.id,
            threads: [...existing, ...visibleAdditions],
          });
        }
        dispatch({
          type: "setThreadListCursor",
          workspaceId: workspace.id,
          cursor,
        });
        matchingThreads.forEach((thread) => {
          const threadId = String(thread?.id ?? "");
          const preview = asString(thread?.preview ?? "").trim();
          if (!threadId || !preview) {
            return;
          }
          dispatch({
            type: "setLastAgentMessage",
            threadId,
            text: preview,
            timestamp: getThreadTimestamp(thread),
          });
        });
      } catch (error) {
        onDebug?.({
          id: `${Date.now()}-client-thread-list-older-error`,
          timestamp: Date.now(),
          source: "error",
          label: "thread/list older error",
          payload: error instanceof Error ? error.message : String(error),
        });
      } finally {
        dispatch({
          type: "setThreadListPaging",
          workspaceId: workspace.id,
          isLoading: false,
        });
      }
    },
    [
      applySessionArchiveState,
      dispatch,
      getCustomName,
      loadArchivedSessionMap,
      onDebug,
      onThreadTitleMappingsLoaded,
      activeThreadIdByWorkspace,
      threadListCursorByWorkspace,
      threadsByWorkspace,
    ],
  );

  const archiveThread = useCallback(
    async (workspaceId: string, threadId: string) => {
      try {
        await archiveThreadService(workspaceId, threadId);
      } catch (error) {
        onDebug?.({
          id: `${Date.now()}-client-thread-archive-error`,
          timestamp: Date.now(),
          source: "error",
          label: "thread/archive error",
          payload: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
    [onDebug],
  );

  const archiveClaudeThread = useCallback(
    async (workspaceId: string, threadId: string) => {
      const sessionId = threadId.startsWith("claude:")
        ? threadId.slice("claude:".length)
        : threadId;
      const workspacePath = workspacePathsByIdRef.current[workspaceId];
      if (!workspacePath) {
        throw new Error("workspace not connected");
      }
      try {
        await deleteClaudeSessionService(workspacePath, sessionId);
      } catch (error) {
        onDebug?.({
          id: `${Date.now()}-client-claude-archive-error`,
          timestamp: Date.now(),
          source: "error",
          label: "claude/archive error",
          payload: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
    [onDebug],
  );

  const deleteThreadForWorkspace = useCallback(
    async (workspaceId: string, threadId: string) => {
      if (threadId.includes("-pending-")) {
        return;
      }
      const thread = (threadsByWorkspace[workspaceId] ?? []).find((entry) => entry.id === threadId);
      if (thread?.threadKind === "shared" || threadId.startsWith("shared:")) {
        await deleteSharedSessionService(workspaceId, threadId);
        return;
      }
      if (threadId.startsWith("claude:")) {
        await archiveClaudeThread(workspaceId, threadId);
        return;
      }
      if (threadId.startsWith("opencode:")) {
        const sessionId = threadId.slice("opencode:".length);
        await deleteOpenCodeSessionService(workspaceId, sessionId);
        return;
      }
      if (threadId.startsWith("gemini:")) {
        const sessionId = threadId.slice("gemini:".length);
        const workspacePath = workspacePathsByIdRef.current[workspaceId];
        if (!workspacePath) {
          throw new Error("workspace not connected");
        }
        await deleteGeminiSessionService(workspacePath, sessionId);
        return;
      }
      await deleteCodexSessionService(workspaceId, threadId);
    },
    [archiveClaudeThread, threadsByWorkspace],
  );

  const renameThreadTitleMapping = useCallback(
    async (workspaceId: string, oldThreadId: string, newThreadId: string) => {
      try {
        await renameThreadTitleKeyService(workspaceId, oldThreadId, newThreadId);
        onRenameThreadTitleMapping?.(workspaceId, oldThreadId, newThreadId);
      } catch {
        const previousName = getCustomName(workspaceId, oldThreadId);
        if (!previousName) {
          return;
        }
        try {
          await setThreadTitleService(workspaceId, newThreadId, previousName);
          onRenameThreadTitleMapping?.(workspaceId, oldThreadId, newThreadId);
        } catch {
          // Best-effort persistence; ignore mapping failures.
        }
      }
    },
    [getCustomName, onRenameThreadTitleMapping],
  );

  return {
    startThreadForWorkspace,
    startSharedSessionForWorkspace,
    forkThreadForWorkspace,
    forkSessionFromMessageForWorkspace,
    forkClaudeSessionFromMessageForWorkspace,
    resumeThreadForWorkspace,
    refreshThread,
    resetWorkspaceThreads,
    listThreadsForWorkspace,
    loadOlderThreadsForWorkspace,
    archiveThread,
    archiveClaudeThread,
    deleteThreadForWorkspace,
    renameThreadTitleMapping,
  };
}
