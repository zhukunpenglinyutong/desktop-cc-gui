import { useCallback, useMemo, useRef, useState } from "react";
import type { Dispatch, MutableRefObject } from "react";
import type {
  ConversationItem,
  DebugEntry,
  ThreadSummary,
  WorkspaceInfo,
} from "../../../types";
import {
  connectWorkspace as connectWorkspaceService,
  listThreadTitles as listThreadTitlesService,
  listThreads as listThreadsService,
  listClaudeSessions as listClaudeSessionsService,
  listGeminiSessions as listGeminiSessionsService,
  getOpenCodeSessionList as getOpenCodeSessionListService,
  loadClaudeSession as loadClaudeSessionService,
  loadGeminiSession as loadGeminiSessionService,
  loadCodexSession as loadCodexSessionService,
  resumeThread as resumeThreadService,
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
import { hydrateHistory } from "../assembly/conversationAssembler";
import {
  listSharedSessions as listSharedSessionsService,
  loadSharedSession as loadSharedSessionService,
} from "../../shared-session/services/sharedSessions";
import {
  normalizeSharedSessionSummaries,
  toSharedThreadSummary,
} from "../../shared-session/runtime/sharedSessionSummaries";
import { asString } from "../utils/threadNormalize";
import { saveThreadActivity } from "../utils/threadStorage";
import {
  collectKnownCodexThreadIds,
  normalizeComparableWorkspacePath,
} from "./useThreadActions.workspacePath";
import { useAutomaticRuntimeRecovery, type AutomaticRuntimeRecoverySource } from "./useAutomaticRuntimeRecovery";
import {
  createArchiveClaudeThreadAction,
  createArchiveThreadAction,
  createDeleteThreadForWorkspaceAction,
  createRenameThreadTitleMappingAction,
} from "./useThreadActions.sessionActions";
import {
  collectRelatedThreadIdsFromSnapshot,
  extractThreadSizeBytes,
  hasHealthyThreadSummaries,
  inferThreadEngineSource,
  isAskUserQuestionToolItem,
  isLocalSessionScanUnavailable,
  isTerminalToolStatus,
  isThreadResumeNotFoundError,
  isWorkspaceNotConnectedError,
  mapWithConcurrency,
  markThreadSummariesDegraded,
  mergeCodexCatalogSessionSummaries,
  mergeDegradedCodexContinuitySummaries,
  mergeGeminiSessionSummaries,
  mergeRecoveredThreadSummaries,
  normalizeGeminiSessionSummaries,
  normalizeThreadListPartialSource,
  resolveThreadSourceMeta,
  restoreThreadParentLinksFromSnapshot,
  listReplacementThreadCandidates,
  selectRecoveredNewThreadSummary,
  selectReplacementThreadByMessageHistory,
  selectReplacementThreadSummary,
  shouldApplyCodexSidebarContinuity,
  shouldIncludeWorkspaceThreadEntry,
  shouldReplaceUserInputQueueFromSnapshot,
  withTimeout,
  type GeminiSessionSummary,
} from "./useThreadActions.helpers";
import { buildPartialHistoryDiagnostic, resolveThreadStabilityDiagnostic } from "../utils/stabilityDiagnostics";
import { loadSidebarSnapshot } from "../utils/sidebarSnapshot";
import { buildThreadDebugCorrelation } from "../utils/threadDebugCorrelation";
import { useThreadActionsSessionRuntime } from "./useThreadActionsSessionRuntime";
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

type ResumeThreadForWorkspaceOptions = {
  preferLocalCodexHistory?: boolean;
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
  const [historyLoadingByThreadId, setHistoryLoadingByThreadId] = useState<
    Record<string, boolean>
  >({});
  // Map workspaceId → filesystem path, populated in listThreadsForWorkspace
  const workspacePathsByIdRef = useRef<Record<string, string>>({});
  const geminiSessionCacheRef = useRef<
    Record<string, { fetchedAt: number; sessions: GeminiSessionSummary[] }>
  >({});
  const geminiRefreshAttemptedRef = useRef<Record<string, boolean>>({});
  const threadListRequestSeqRef = useRef<Record<string, number>>({});
  const previousThreadsByWorkspaceRef = useRef(threadsByWorkspace);
  const latestThreadsByWorkspaceRef = useRef(threadsByWorkspace);
  if (latestThreadsByWorkspaceRef.current !== threadsByWorkspace) {
    previousThreadsByWorkspaceRef.current = latestThreadsByWorkspaceRef.current;
  }
  latestThreadsByWorkspaceRef.current = threadsByWorkspace;
  const listWorkspaceSessionsService = Object.prototype.hasOwnProperty.call(
    tauriServices,
    "listWorkspaceSessions",
  )
    ? tauriServices.listWorkspaceSessions
    : null;
  const canListWorkspaceSessions = typeof listWorkspaceSessionsService === "function";
  const {
    beginAutomaticRuntimeRecovery,
    getAutomaticRuntimeRecoveryPartialSource,
  } = useAutomaticRuntimeRecovery(connectWorkspaceService);

  const getLastGoodThreadSummaries = useCallback(
    (workspaceId: string): ThreadSummary[] => {
      const currentThreads = latestThreadsByWorkspaceRef.current[workspaceId];
      if (hasHealthyThreadSummaries(currentThreads)) {
        return currentThreads;
      }
      const stateThreads = threadsByWorkspace[workspaceId];
      if (hasHealthyThreadSummaries(stateThreads)) {
        return stateThreads;
      }
      const snapshotThreads = loadSidebarSnapshot()?.threadsByWorkspace[workspaceId];
      if (hasHealthyThreadSummaries(snapshotThreads)) {
        return snapshotThreads;
      }
      return [];
    },
    [threadsByWorkspace],
  );

  const removeThreadFromCachedSummaries = useCallback(
    (workspaceId: string, threadId: string) => {
      const filterOutThread = (
        source: Record<string, ThreadSummary[] | undefined>,
      ): ThreadSummary[] => {
        const current = source[workspaceId] ?? [];
        return current.filter((entry) => entry.id !== threadId);
      };
      latestThreadsByWorkspaceRef.current = {
        ...latestThreadsByWorkspaceRef.current,
        [workspaceId]: filterOutThread(latestThreadsByWorkspaceRef.current),
      };
      previousThreadsByWorkspaceRef.current = {
        ...previousThreadsByWorkspaceRef.current,
        [workspaceId]: filterOutThread(previousThreadsByWorkspaceRef.current),
      };
    },
    [],
  );

  const setThreadHistoryLoading = useCallback(
    (threadId: string, isLoading: boolean) => {
      if (!threadId) {
        return;
      }
      setHistoryLoadingByThreadId((current) => {
        const alreadyLoading = current[threadId] === true;
        if (isLoading) {
          if (alreadyLoading) {
            return current;
          }
          return { ...current, [threadId]: true };
        }
        if (!alreadyLoading) {
          return current;
        }
        const { [threadId]: _removed, ...rest } = current;
        return rest;
      });
    },
    [],
  );

  const reconcileMissingClaudeThread = useCallback(
    (workspaceId: string, threadId: string) => {
      loadedThreadsRef.current[threadId] = false;
      dispatch({
        type: "clearUserInputRequestsForThread",
        workspaceId,
        threadId,
      });
      const isSelectedThread =
        activeThreadIdByWorkspace[workspaceId] === threadId;
      const hasReadableItems = (itemsByThread[threadId]?.length ?? 0) > 0;
      if (isSelectedThread && hasReadableItems) {
        onDebug?.({
          id: `${Date.now()}-claude-history-preserve-readable-surface`,
          timestamp: Date.now(),
          source: "client",
          label: "thread/claude history preserve readable surface",
          payload: {
            workspaceId,
            threadId,
            reason: "selected-readable-surface",
          },
        });
        return true;
      }
      removeThreadFromCachedSummaries(workspaceId, threadId);
      dispatch({ type: "removeThread", workspaceId, threadId });
      return false;
    },
    [
      activeThreadIdByWorkspace,
      dispatch,
      itemsByThread,
      loadedThreadsRef,
      onDebug,
      removeThreadFromCachedSummaries,
    ],
  );

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
    [canListWorkspaceSessions, listWorkspaceSessionsService],
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

  const renameThreadTitleMapping = useMemo(
    () => createRenameThreadTitleMappingAction({
      getCustomName,
      onRenameThreadTitleMapping,
    }),
    [getCustomName, onRenameThreadTitleMapping],
  );

  const resumeThreadForWorkspace = useCallback(
    async (
      workspaceId: string,
      threadId: string,
      force = false,
      replaceLocal = false,
      options?: ResumeThreadForWorkspaceOptions,
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
                        preferLocalHistory: options?.preferLocalCodexHistory === true,
                      });
          const hydrateHistorySnapshot = async (
            effectiveThreadId: string,
            snapshot: Awaited<ReturnType<ReturnType<typeof createHistoryLoader>["load"]>>,
          ) => {
            const assembledSnapshot = hydrateHistory(snapshot);
            const snapshotItems = assembledSnapshot.items;
            dispatch({
              type: "ensureThread",
              workspaceId,
              threadId: effectiveThreadId,
              engine: assembledSnapshot.meta.engine,
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
              plan: assembledSnapshot.plan,
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
                assembledSnapshot.userInputQueue.length,
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
                  const relatedAssembledSnapshot = hydrateHistory(relatedSnapshot);
                  const relatedSnapshotItems = relatedAssembledSnapshot.items;
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
                    plan: relatedAssembledSnapshot.plan,
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
            assembledSnapshot.userInputQueue.forEach((request) => {
              dispatch({ type: "addUserInputRequest", request });
            });
            if (snapshot.fallbackWarnings.length > 0) {
              const partialHistoryDiagnostic = buildPartialHistoryDiagnostic(
                snapshot.fallbackWarnings
                  .map((entry) => String(entry.code ?? "unknown"))
                  .join(", "),
              );
              onDebug?.({
                id: `${Date.now()}-history-loader-fallback`,
                timestamp: Date.now(),
                source: "client",
                label: "thread/history fallback",
                payload: {
                  workspaceId,
                  threadId: effectiveThreadId,
                  warnings: snapshot.fallbackWarnings,
                  diagnosticCategory: partialHistoryDiagnostic.category,
                  diagnosticMessage: partialHistoryDiagnostic.rawMessage,
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
          const recoveryBaselineSummaries =
            previousThreadsByWorkspaceRef.current[workspaceId] ??
            threadsByWorkspace[workspaceId] ??
            [];
          const staleSummary =
            existingSummaries.find((entry) => entry.id === threadId) ??
            (threadsByWorkspace[workspaceId] ?? []).find(
              (entry) => entry.id === threadId,
            );
          const engineSource = inferThreadEngineSource(threadId, staleSummary);
          const fallbackStaleActivityAt =
            (threadActivityRef.current[workspaceId] ?? {})[threadId] ?? 0;
          const effectiveStaleSummary =
            staleSummary ??
            (fallbackStaleActivityAt > 0
              ? {
                  id: threadId,
                  name: getCustomName(workspaceId, threadId) ?? "",
                  updatedAt: fallbackStaleActivityAt,
                  engineSource,
                  threadKind: "native",
                }
              : undefined);
          let nextSummaries = existingSummaries;
          let directRecoveredSummaryMatch: ThreadSummary | null = null;
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
                  staleSummary: effectiveStaleSummary,
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
              directRecoveredSummaryMatch = selectRecoveredNewThreadSummary({
                staleThreadId: threadId,
                previousSummaries: recoveryBaselineSummaries,
                summaries: refreshedCodexSummaries,
                staleSummary: effectiveStaleSummary,
              });
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
            staleSummary: effectiveStaleSummary,
          });
          if (summaryMatch) {
            return { threadId: summaryMatch.id };
          }
          const newlyRecoveredMatch = selectRecoveredNewThreadSummary({
            staleThreadId: threadId,
            previousSummaries: recoveryBaselineSummaries,
            summaries: nextSummaries,
            staleSummary: effectiveStaleSummary,
          });
          if (newlyRecoveredMatch) {
            return { threadId: newlyRecoveredMatch.id };
          }
          if (directRecoveredSummaryMatch) {
            return { threadId: directRecoveredSummaryMatch.id };
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
                const diagnostic = buildPartialHistoryDiagnostic(
                  candidateError instanceof Error
                    ? candidateError.message
                    : String(candidateError),
                );
                onDebug?.({
                  id: `${Date.now()}-history-loader-recovery-candidate-error`,
                  timestamp: Date.now(),
                  source: "error",
                  label: "thread/history recovery candidate error",
                  payload: {
                    workspaceId,
                    staleThreadId: threadId,
                    candidateThreadId: summary.id,
                    diagnosticCategory: diagnostic.category,
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
                const diagnostic = buildPartialHistoryDiagnostic(
                  recoveryError instanceof Error
                    ? recoveryError.message
                    : String(recoveryError),
                );
                onDebug?.({
                  id: `${Date.now()}-history-loader-recovery-error`,
                  timestamp: Date.now(),
                  source: "error",
                  label: "thread/history recovery error",
                  payload: {
                    diagnosticCategory: diagnostic.category,
                    error:
                      recoveryError instanceof Error
                        ? recoveryError.message
                        : String(recoveryError),
                  },
                });
              }
            }
            const stabilityDiagnostic =
              error instanceof Error
                ? resolveThreadStabilityDiagnostic(error.message)
                : resolveThreadStabilityDiagnostic(String(error));
            onDebug?.({
              id: `${Date.now()}-history-loader-error`,
              timestamp: Date.now(),
              source: "error",
              label: "thread/history loader error",
              payload: {
                error: error instanceof Error ? error.message : String(error),
                diagnosticCategory:
                  stabilityDiagnostic?.category ?? "partial_history",
                recoveryReason: stabilityDiagnostic?.reconnectReason ?? null,
              },
            });
            // Fallback to legacy path to preserve recovery.
          }
          }
      // Claude sessions don't use Codex thread/resume RPC —
      // load message history from JSONL and populate the thread
      const workspacePath = workspacePathsByIdRef.current[workspaceId];
      if (threadId.startsWith("claude:")) {
        dispatch({ type: "ensureThread", workspaceId, threadId, engine: "claude" });
        if (!workspacePath) {
          loadedThreadsRef.current[threadId] = false;
          return threadId;
        }
        if (force || !loadedThreadsRef.current[threadId]) {
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
          } catch (error) {
            loadedThreadsRef.current[threadId] = false;
            const diagnostic =
              error instanceof Error
                ? resolveThreadStabilityDiagnostic(error.message)
                : resolveThreadStabilityDiagnostic(String(error));
            onDebug?.({
              id: `${Date.now()}-claude-history-load-error`,
              timestamp: Date.now(),
              source: "error",
              label: "thread/claude history load error",
              payload: {
                workspaceId,
                threadId,
                error: error instanceof Error ? error.message : String(error),
                diagnosticCategory: diagnostic?.category ?? "partial_history",
              },
            });
            if (isThreadResumeNotFoundError(error)) {
              const preservedReadableSurface = reconcileMissingClaudeThread(
                workspaceId,
                threadId,
              );
              return preservedReadableSurface ? threadId : null;
            }
            return threadId;
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
      reconcileMissingClaudeThread,
      threadActivityRef,
      threadStatusById,
      threadsByWorkspace,
      userInputRequests,
      useUnifiedHistoryLoader,
    ],
  );

  const {
    startThreadForWorkspace,
    startSharedSessionForWorkspace,
    forkThreadForWorkspace,
    forkClaudeSessionFromMessageForWorkspace,
    forkSessionFromMessageForWorkspace,
  } = useThreadActionsSessionRuntime({
    activeThreadIdByWorkspace,
    dispatch,
    itemsByThread,
    loadedThreadsRef,
    onDebug,
    renameThreadTitleMapping,
    resumeThreadForWorkspace,
    threadsByWorkspace,
    workspacePathsByIdRef,
  });

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
        recoverySource?: AutomaticRuntimeRecoverySource;
        allowRuntimeReconnect?: boolean;
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
      const recoverySource = options?.recoverySource ?? "thread-list-live";
      const allowRuntimeReconnect = options?.allowRuntimeReconnect ?? true;
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
        payload: buildThreadDebugCorrelation(
          {
            workspaceId: workspace.id,
            action: "thread-list-refresh",
            engine: "multi",
          },
          { path: workspace.path },
        ),
      });
      const archivedSessionMapPromise = loadArchivedSessionMap(workspace.id);
      try {
        let degradedPartialSource: string | null = null;
        const rememberPartialSource = (value: unknown) => {
          const normalized = normalizeThreadListPartialSource(value);
          if (normalized && !degradedPartialSource) {
            degradedPartialSource = normalized;
          }
        };
        let mappedTitles: Record<string, string> = {};
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
                if (!isWorkspaceNotConnectedError(error) || !allowRuntimeReconnect) {
                  throw error;
                }
                const recovery = beginAutomaticRuntimeRecovery(workspace.id, recoverySource);
                if (recovery.kind === "waiter") {
                  rememberPartialSource("guarded-recovery-waiter");
                  onDebug?.({
                    id: `${Date.now()}-client-workspace-recovery-waiter`,
                    timestamp: Date.now(),
                    source: "client",
                    label: "workspace/recovery waiter before thread list",
                    payload: buildThreadDebugCorrelation(
                      {
                        workspaceId: workspace.id,
                        action: "thread-list-refresh",
                        engine: "codex",
                        recoveryState: "degraded",
                      },
                      { recoverySource },
                    ),
                  });
                  throw error;
                }
                if (recovery.kind === "cooldown") {
                  rememberPartialSource("automatic-recovery-cooldown");
                  onDebug?.({
                    id: `${Date.now()}-client-workspace-recovery-cooldown`,
                    timestamp: Date.now(),
                    source: "client",
                    label: "workspace/recovery cooldown before thread list",
                    payload: buildThreadDebugCorrelation(
                      {
                        workspaceId: workspace.id,
                        action: "thread-list-refresh",
                        engine: "codex",
                        recoveryState: "degraded",
                      },
                      { recoverySource },
                    ),
                  });
                  throw error;
                }
                onDebug?.({
                  id: `${Date.now()}-client-workspace-reconnect-before-thread-list`,
                  timestamp: Date.now(),
                  source: "client",
                  label: "workspace/reconnect before thread list",
                  payload: buildThreadDebugCorrelation(
                    {
                      workspaceId: workspace.id,
                      action: "thread-list-refresh",
                      engine: "codex",
                      recoveryState: "recovering",
                    },
                    { recoverySource },
                  ),
                });
                await recovery.promise;
                return await listThreadsService(workspace.id, cursor, pageSize);
              }
            })(), THREAD_LIST_LIVE_REQUEST_TIMEOUT_MS);
            if (liveResponse === null) {
              rememberPartialSource(
                getAutomaticRuntimeRecoveryPartialSource(workspace.id)
                ?? "thread-list-live-timeout",
              );
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
            rememberPartialSource("workspace-not-connected");
            onDebug?.({
              id: `${Date.now()}-client-thread-list-codex-unavailable`,
              timestamp: Date.now(),
              source: "client",
              label: "thread/list codex unavailable",
              payload: buildThreadDebugCorrelation(
                {
                  workspaceId: workspace.id,
                  action: "thread-list-codex-unavailable",
                  engine: "codex",
                  recoveryState: "recovering",
                },
                {
                  reason: error instanceof Error ? error.message : String(error),
                },
              ),
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
          rememberPartialSource(result.partialSource ?? result.partial_source);
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
            rememberPartialSource("claude-session-timeout");
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
            rememberPartialSource("opencode-session-timeout");
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
            rememberPartialSource("codex-catalog-timeout");
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
          rememberPartialSource(codexCatalogPage?.partialSource);
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
        const archivedSessionMap = await archivedSessionMapPromise;
        allSummaries = applySessionArchiveState(
          allSummaries,
          archivedSessionMap,
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

        let visibleSummaries = allSummaries;
        if (visibleSummaries.length === 0 && degradedPartialSource) {
          const fallbackThreads = getLastGoodThreadSummaries(workspace.id);
          if (fallbackThreads.length > 0) {
            visibleSummaries = markThreadSummariesDegraded(
              fallbackThreads,
              degradedPartialSource,
              "last-good-fallback",
            );
            const diagnostic = buildPartialHistoryDiagnostic(
              `thread list fallback: ${degradedPartialSource}`,
            );
            onDebug?.({
              id: `${Date.now()}-client-thread-list-fallback`,
              timestamp: Date.now(),
              source: "client",
              label: "thread/list fallback",
              payload: buildThreadDebugCorrelation(
                {
                  workspaceId: workspace.id,
                  action: "thread-list-fallback",
                  engine: "multi",
                  diagnosticCategory: diagnostic.category,
                  recoveryState: "degraded",
                },
                {
                  partialSource: degradedPartialSource,
                  fallbackCount: visibleSummaries.length,
                  diagnosticMessage: diagnostic.rawMessage,
                },
              ),
            });
          }
        } else if (degradedPartialSource) {
          if (shouldApplyCodexSidebarContinuity(degradedPartialSource)) {
            visibleSummaries = mergeDegradedCodexContinuitySummaries(
              visibleSummaries,
              getLastGoodThreadSummaries(workspace.id),
            );
          }
          visibleSummaries = markThreadSummariesDegraded(
            visibleSummaries,
            degradedPartialSource,
            "partial-thread-list",
          );
        }
        visibleSummaries = applySessionArchiveState(visibleSummaries, archivedSessionMap);

        dispatch({
          type: "setThreads",
          workspaceId: workspace.id,
          threads: visibleSummaries,
        });
        latestThreadsByWorkspaceRef.current = {
          ...latestThreadsByWorkspaceRef.current,
          [workspace.id]: visibleSummaries,
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
        const fallbackThreads = getLastGoodThreadSummaries(workspace.id);
        if (isLatestThreadListRequest() && fallbackThreads.length > 0) {
          const fallbackMessage = error instanceof Error ? error.message : String(error);
          const archivedSessionMap = await archivedSessionMapPromise.catch(() => null);
          const degradedThreads = markThreadSummariesDegraded(
            applySessionArchiveState(fallbackThreads, archivedSessionMap),
            fallbackMessage,
            "last-good-fallback",
          );
          dispatch({
            type: "setThreads",
            workspaceId: workspace.id,
            threads: degradedThreads,
          });
          latestThreadsByWorkspaceRef.current = {
            ...latestThreadsByWorkspaceRef.current,
            [workspace.id]: degradedThreads,
          };
          const diagnostic = buildPartialHistoryDiagnostic(
            `thread list error fallback: ${fallbackMessage}`,
          );
              onDebug?.({
                id: `${Date.now()}-client-thread-list-error-fallback`,
                timestamp: Date.now(),
                source: "client",
                label: "thread/list error fallback",
                payload: buildThreadDebugCorrelation(
                  {
                    workspaceId: workspace.id,
                    action: "thread-list-error-fallback",
                    engine: "multi",
                    diagnosticCategory: diagnostic.category,
                    recoveryState: "degraded",
                  },
                  {
                    fallbackCount: degradedThreads.length,
                    diagnosticMessage: diagnostic.rawMessage,
                  },
                ),
              });
        }
        onDebug?.({
          id: `${Date.now()}-client-thread-list-error`,
          timestamp: Date.now(),
          source: "error",
          label: "thread/list error",
          payload: buildThreadDebugCorrelation(
            {
              workspaceId: workspace.id,
              action: "thread-list-error",
              engine: "multi",
              recoveryState: "recovering",
            },
            {
              error: error instanceof Error ? error.message : String(error),
            },
          ),
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
      beginAutomaticRuntimeRecovery,
      canListWorkspaceSessions,
      dispatch,
      getCustomName,
      getAutomaticRuntimeRecoveryPartialSource,
      getLastGoodThreadSummaries,
      loadArchivedSessionMap,
      listWorkspaceSessionsService,
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

  const archiveThread = useMemo(
    () => createArchiveThreadAction({ onDebug }),
    [onDebug],
  );

  const archiveClaudeThread = useMemo(
    () => createArchiveClaudeThreadAction({ onDebug, workspacePathsByIdRef }),
    [onDebug, workspacePathsByIdRef],
  );

  const deleteThreadForWorkspace = useMemo(
    () => createDeleteThreadForWorkspaceAction({
      archiveClaudeThread,
      threadsByWorkspace,
      workspacePathsByIdRef,
    }),
    [archiveClaudeThread, threadsByWorkspace, workspacePathsByIdRef],
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
    setThreadHistoryLoading,
    historyLoadingByThreadId,
  };
}
