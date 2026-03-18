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
  deleteClaudeSession as deleteClaudeSessionService,
  deleteOpenCodeSession as deleteOpenCodeSessionService,
  forkClaudeSession as forkClaudeSessionService,
  forkThread as forkThreadService,
  listThreadTitles as listThreadTitlesService,
  listThreads as listThreadsService,
  listClaudeSessions as listClaudeSessionsService,
  getOpenCodeSessionList as getOpenCodeSessionListService,
  loadClaudeSession as loadClaudeSessionService,
  loadCodexSession as loadCodexSessionService,
  renameThreadTitleKey as renameThreadTitleKeyService,
  setThreadTitle as setThreadTitleService,
  resumeThread as resumeThreadService,
  startThread as startThreadService,
} from "../../../services/tauri";
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
import { createOpenCodeHistoryLoader } from "../loaders/opencodeHistoryLoader";
import {
  asString,
  asNumber,
  normalizeRootPath,
} from "../utils/threadNormalize";
import { saveThreadActivity } from "../utils/threadStorage";
import type { ThreadAction, ThreadState } from "./useThreadsReducer";

type UseThreadActionsOptions = {
  dispatch: Dispatch<ThreadAction>;
  itemsByThread: ThreadState["itemsByThread"];
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
  useUnifiedHistoryLoader?: boolean;
};

const THREAD_LIST_TARGET_COUNT = 50;
const THREAD_LIST_PAGE_SIZE = 50;
const THREAD_LIST_MAX_EMPTY_PAGES = 5;
const THREAD_LIST_MAX_EMPTY_PAGES_WITH_ACTIVITY = 20;
const THREAD_LIST_MAX_TOTAL_PAGES = 40;
const THREAD_LIST_MAX_EMPTY_PAGES_LOAD_OLDER = 10;
const THREAD_LIST_MAX_FETCH_DURATION_MS = 1_500;
const DEFAULT_CLAUDE_CONTEXT_WINDOW = 200_000;
const CODEX_BACKGROUND_HELPER_PROMPT_PREFIXES = [
  "Generate a concise title for a coding chat thread from the first user message.",
  "You create concise run metadata for a coding task.",
  "You are generating OpenSpec project context.",
  "Generate a concise git commit message for the following changes.",
] as const;

function normalizeComparableWorkspacePath(path: string): string {
  return normalizeWindowsPathForComparison(normalizeRootPath(path).trim());
}

function normalizeWindowsPathForComparison(path: string): string {
  if (!path) {
    return path;
  }
  if (path.startsWith("//?/UNC/")) {
    return `//${path.slice("//?/UNC/".length)}`;
  }
  if (path.startsWith("//?/")) {
    return path.slice("//?/".length);
  }
  return path;
}

function buildWorkspacePathVariants(path: string): Set<string> {
  const normalized = normalizeComparableWorkspacePath(path);
  const variants = new Set<string>();
  if (!normalized) {
    return variants;
  }
  variants.add(normalized);
  if (normalized.startsWith("/private/")) {
    variants.add(normalized.slice("/private".length));
  } else if (normalized.startsWith("/")) {
    variants.add(`/private${normalized}`);
  }
  if (/^[A-Za-z]:/.test(normalized)) {
    variants.add(`${normalized[0].toLowerCase()}${normalized.slice(1)}`);
    variants.add(normalized.toLowerCase());
  }
  if (normalized.startsWith("//")) {
    variants.add(normalized.toLowerCase());
  }
  return variants;
}

function matchesWorkspacePath(threadCwd: string, workspacePath: string): boolean {
  const workspaceVariants = buildWorkspacePathVariants(workspacePath);
  if (workspaceVariants.size === 0) {
    return false;
  }
  const threadVariants = buildWorkspacePathVariants(threadCwd);
  for (const candidate of threadVariants) {
    for (const workspaceCandidate of workspaceVariants) {
      if (candidate === workspaceCandidate) {
        return true;
      }
      if (
        candidate.startsWith(workspaceCandidate) &&
        candidate.charAt(workspaceCandidate.length) === "/"
      ) {
        return true;
      }
    }
  }
  return false;
}

function toBooleanFlag(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes";
  }
  return false;
}

function isArchivedThread(thread: Record<string, unknown>): boolean {
  const archivedFlag = toBooleanFlag(thread.archived ?? thread.isArchived);
  if (archivedFlag) {
    return true;
  }
  return asNumber(thread.archivedAt ?? thread.archived_at) > 0;
}

function shouldIncludeThreadEntry(thread: Record<string, unknown>): boolean {
  if (isArchivedThread(thread)) {
    return false;
  }
  const previewCandidates = [
    asString(thread.preview).trim(),
    asString(thread.title).trim(),
    asString(thread.name).trim(),
  ].filter(Boolean);
  const isCodexHelperThread = previewCandidates.some((preview) =>
    CODEX_BACKGROUND_HELPER_PROMPT_PREFIXES.some((prefix) =>
      preview.startsWith(prefix),
    ),
  );
  if (isCodexHelperThread) {
    return false;
  }
  return true;
}

function parseCollabLinkDetail(detail: string, fallbackParentId: string) {
  const trimmed = detail.trim();
  if (!trimmed) {
    return null;
  }
  const hasUnicodeArrow = trimmed.includes("→");
  const hasAsciiArrow = !hasUnicodeArrow && trimmed.includes("->");
  if (!hasUnicodeArrow && !hasAsciiArrow) {
    return null;
  }
  const [leftSideRaw, rightSideRaw] = hasUnicodeArrow
    ? trimmed.split("→", 2)
    : trimmed.split("->", 2);
  const leftSide = (leftSideRaw ?? "").trim();
  const rightSide = (rightSideRaw ?? "").trim();
  const parentMatch = leftSide.match(/^From\s+(.+)$/i);
  const parentId = (parentMatch?.[1]?.trim() || fallbackParentId).trim();
  const childIds = rightSide
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!parentId || childIds.length === 0) {
    return null;
  }
  return { parentId, childIds };
}

function restoreThreadParentLinksFromSnapshot(
  threadId: string,
  items: ConversationItem[],
  updateThreadParent?: (parentId: string, childIds: string[]) => void,
) {
  if (!updateThreadParent) {
    return;
  }
  items.forEach((item) => {
    if (item.kind !== "tool" || item.toolType !== "collabToolCall") {
      return;
    }
    const parsedLink = parseCollabLinkDetail(item.detail, threadId);
    if (!parsedLink) {
      return;
    }
    updateThreadParent(parsedLink.parentId, parsedLink.childIds);
  });
}

function collectRelatedThreadIdsFromSnapshot(threadId: string, items: ConversationItem[]) {
  const relatedThreadIds = new Set<string>();
  items.forEach((item) => {
    if (item.kind !== "tool" || item.toolType !== "collabToolCall") {
      return;
    }
    const parsedLink = parseCollabLinkDetail(item.detail, threadId);
    if (!parsedLink) {
      return;
    }
    parsedLink.childIds.forEach((childId) => {
      if (!childId || childId === threadId) {
        return;
      }
      relatedThreadIds.add(childId);
    });
  });
  return Array.from(relatedThreadIds);
}

export function useThreadActions({
  dispatch,
  itemsByThread,
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
  useUnifiedHistoryLoader = false,
}: UseThreadActionsOptions) {
  // Map workspaceId → filesystem path, populated in listThreadsForWorkspace
  const workspacePathsByIdRef = useRef<Record<string, string>>({});

  const extractThreadId = useCallback((response: Record<string, any>) => {
    const candidates = [
      response.result?.thread?.id,
      response.result?.threadId,
      response.result?.thread_id,
      response.thread?.id,
      response.threadId,
      response.thread_id,
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
  }, []);

  const startThreadForWorkspace = useCallback(
    async (workspaceId: string, options?: { activate?: boolean; engine?: "claude" | "codex" | "gemini" | "opencode" }) => {
      const shouldActivate = options?.activate !== false;
      const engine = options?.engine;

      // For local CLI engines (Claude/OpenCode), generate a local pending thread ID.
      if (engine === "claude" || engine === "opencode") {
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
      } catch (error) {
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
      if (useUnifiedHistoryLoader) {
        try {
          const workspacePath = workspacePathsByIdRef.current[workspaceId] ?? null;
          const createHistoryLoader = (targetThreadId: string) =>
            targetThreadId.startsWith("claude:")
              ? createClaudeHistoryLoader({
                  workspaceId,
                  workspacePath,
                  loadClaudeSession: loadClaudeSessionService,
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
          const loader = createHistoryLoader(threadId);
          const snapshot = await loader.load(threadId);
          dispatch({
            type: "ensureThread",
            workspaceId,
            threadId,
            engine: snapshot.engine,
          });
          if (snapshot.items.length > 0) {
            dispatch({ type: "setThreadItems", threadId, items: snapshot.items });
          }
          dispatch({ type: "setThreadPlan", threadId, plan: snapshot.plan });
          dispatch({
            type: "clearUserInputRequestsForThread",
            workspaceId,
            threadId,
          });
          restoreThreadParentLinksFromSnapshot(
            threadId,
            snapshot.items,
            updateThreadParent,
          );
          const relatedThreadIds = collectRelatedThreadIdsFromSnapshot(
            threadId,
            snapshot.items,
          );
          relatedThreadIds.forEach((relatedThreadId) => {
            dispatch({
              type: "ensureThread",
              workspaceId,
              threadId: relatedThreadId,
              engine: "codex",
            });
          });
          for (const relatedThreadId of relatedThreadIds) {
            if (
              !relatedThreadId ||
              relatedThreadId === threadId ||
              loadedThreadsRef.current[relatedThreadId]
            ) {
              continue;
            }
            try {
              const relatedSnapshot = await createHistoryLoader(relatedThreadId).load(
                relatedThreadId,
              );
              if (relatedSnapshot.items.length > 0) {
                dispatch({
                  type: "setThreadItems",
                  threadId: relatedThreadId,
                  items: relatedSnapshot.items,
                });
              }
              dispatch({
                type: "setThreadPlan",
                threadId: relatedThreadId,
                plan: relatedSnapshot.plan,
              });
              restoreThreadParentLinksFromSnapshot(
                relatedThreadId,
                relatedSnapshot.items,
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
                  threadId,
                  relatedThreadId,
                  error: error instanceof Error ? error.message : String(error),
                },
              });
            }
          }
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
                threadId,
                warnings: snapshot.fallbackWarnings,
              },
            });
          }
          loadedThreadsRef.current[threadId] = true;
          return threadId;
        } catch (error) {
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
      if (threadId.startsWith("claude:")) {
        dispatch({ type: "ensureThread", workspaceId, threadId, engine: "claude" });
        const workspacePath = workspacePathsByIdRef.current[workspaceId];
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
            dispatch({ type: "setThreadItems", threadId, items: mergedItems });
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
      applyCollabThreadLinksFromThread,
      updateThreadParent,
      dispatch,
      getCustomName,
      itemsByThread,
      loadedThreadsRef,
      onDebug,
      replaceOnResumeRef,
      threadStatusById,
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
        let response: Record<string, unknown>;
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
        const forkedEngine = forkedThreadId.startsWith("claude:") ? "claude" : "codex";
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
      },
    ) => {
      // Store workspace path for Claude session loading
      workspacePathsByIdRef.current[workspace.id] = workspace.path;
      const preserveState = options?.preserveState ?? false;
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
        try {
          mappedTitles = await listThreadTitlesService(workspace.id);
          onThreadTitleMappingsLoaded?.(workspace.id, mappedTitles);
        } catch {
          mappedTitles = {};
        }
        const existingThreads = threadsByWorkspace[workspace.id] ?? [];
        const engineById = new Map(
          existingThreads.map((thread) => [thread.id, thread.engineSource]),
        );
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
          const response =
            (await listThreadsService(
              workspace.id,
              cursor,
              pageSize,
            )) as Record<string, unknown>;
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
          const nextCursor =
            (result?.nextCursor ?? result?.next_cursor ?? null) as string | null;
          matchingThreads.push(
            ...data.filter(
              (thread) =>
                matchesWorkspacePath(String(thread?.cwd ?? ""), workspacePath) &&
                shouldIncludeThreadEntry(thread),
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
                ? preview
                : fallbackName;
            const engineSource = engineById.get(id) ?? ("codex" as const);
            return {
              id,
              name,
              updatedAt: getThreadTimestamp(thread),
              engineSource,
            };
          })
          .filter((entry) => entry.id);

        // Also fetch Claude/OpenCode sessions and merge them into one timeline.
        let allSummaries: ThreadSummary[] = summaries;
        const mergedById = new Map<string, ThreadSummary>();
        summaries.forEach((entry) => mergedById.set(entry.id, entry));
        const [claudeResult, opencodeResult] = await Promise.allSettled([
          listClaudeSessionsService(workspace.path, 50),
          getOpenCodeSessionListService(workspace.id),
        ]);
        if (claudeResult.status === "fulfilled") {
          const claudeSessions = Array.isArray(claudeResult.value)
            ? claudeResult.value
            : [];
          claudeSessions.forEach(
            (session: {
              sessionId: string;
              firstMessage: string;
              updatedAt: number;
            }) => {
              const id = `claude:${session.sessionId}`;
              const prev = mergedById.get(id);
              const updatedAt = session.updatedAt;
              const next: ThreadSummary = {
                id,
                name:
                  mappedTitles[id] ||
                  getCustomName(workspace.id, id) ||
                  session.firstMessage ||
                  "Claude Session",
                updatedAt,
                engineSource: "claude",
              };
              if (!prev || next.updatedAt >= prev.updatedAt) {
                mergedById.set(id, next);
              }
            },
          );
        }
        if (opencodeResult.status === "fulfilled") {
          const opencodeSessions = Array.isArray(opencodeResult.value)
            ? opencodeResult.value
            : [];
          opencodeSessions.forEach((session) => {
            const id = `opencode:${session.sessionId}`;
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
                session.title ||
                "OpenCode Session",
              updatedAt,
              engineSource: "opencode",
            };
            if (!prev || next.updatedAt >= prev.updatedAt) {
              mergedById.set(id, next);
            }
          });
        }
        allSummaries = Array.from(mergedById.values()).sort(
          (a, b) => b.updatedAt - a.updatedAt,
        );
        if (didChangeActivity) {
          const next = {
            ...threadActivityRef.current,
            [workspace.id]: nextActivityByThread,
          };
          threadActivityRef.current = next;
          saveThreadActivity(next);
        }

        dispatch({
          type: "setThreads",
          workspaceId: workspace.id,
          threads: allSummaries,
        });
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
      } catch (error) {
        onDebug?.({
          id: `${Date.now()}-client-thread-list-error`,
          timestamp: Date.now(),
          source: "error",
          label: "thread/list error",
          payload: error instanceof Error ? error.message : String(error),
        });
      } finally {
        if (!preserveState) {
          dispatch({
            type: "setThreadListLoading",
            workspaceId: workspace.id,
            isLoading: false,
          });
        }
      }
    },
    [
      dispatch,
      getCustomName,
      onDebug,
      onThreadTitleMappingsLoaded,
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
          const next =
            (result?.nextCursor ?? result?.next_cursor ?? null) as string | null;
          matchingThreads.push(
            ...data.filter(
              (thread) =>
                matchesWorkspacePath(String(thread?.cwd ?? ""), workspacePath) &&
                shouldIncludeThreadEntry(thread),
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
              ? preview
              : fallbackName;
          additions.push({ id, name, updatedAt: getThreadTimestamp(thread) });
          existingIds.add(id);
        });

        if (additions.length > 0) {
          dispatch({
            type: "setThreads",
            workspaceId: workspace.id,
            threads: [...existing, ...additions],
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
      dispatch,
      getCustomName,
      onDebug,
      onThreadTitleMappingsLoaded,
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
      if (threadId.startsWith("claude:")) {
        await archiveClaudeThread(workspaceId, threadId);
        return;
      }
      if (threadId.startsWith("opencode:")) {
        const sessionId = threadId.slice("opencode:".length);
        await deleteOpenCodeSessionService(workspaceId, sessionId);
        return;
      }
      await archiveThread(workspaceId, threadId);
    },
    [archiveClaudeThread, archiveThread],
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
    forkThreadForWorkspace,
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
