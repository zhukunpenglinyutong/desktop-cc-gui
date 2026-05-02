import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from "react";
import { useComposerInsert } from "../features/app/hooks/useComposerInsert";
import { loadHistoryWithImportance } from "../features/composer/hooks/useInputHistoryStore";
import type { HistoryItem } from "../features/composer/hooks/useInputHistoryStore";
import type { KanbanTask } from "../features/kanban/types";
import { useUnifiedSearch } from "../features/search/hooks/useUnifiedSearch";
import type { SearchContentFilter, SearchScope } from "../features/search/types";
import { useWorkspaceSessionActivity } from "../features/session-activity/hooks/useWorkspaceSessionActivity";
import { useSessionRadarFeed } from "../features/session-activity/hooks/useSessionRadarFeed";
import { isPerformanceCompatibilityModeEnabled } from "../features/session-activity/utils/performanceCompatibility";
import {
  RADAR_STORE_NAME,
  SESSION_RADAR_RECENT_STORAGE_KEY,
  buildRadarCompletionId,
  dispatchSessionRadarHistoryUpdatedEvent,
  mergePersistedRadarRecentEntries,
  type PersistedRadarRecentEntry,
  resolveLatestUserMessage,
} from "../features/session-activity/utils/sessionRadarPersistence";
import { useWorkspaceSessionProjectionSummary } from "../features/workspaces/hooks/useWorkspaceSessionProjectionSummary";
import { getClientStoreSync, writeClientStoreValue } from "../services/clientStorage";
import { sendSystemNotification } from "../services/systemNotification";
import { getWorkspaceFiles } from "../services/tauri";
import type {
  AppSettings,
  ConversationItem,
  CustomCommandOption,
  SkillOption,
  ThreadSummary,
  WorkspaceInfo,
} from "../types";
import { useWorkspaceThreadListHydration } from "./useWorkspaceThreadListHydration";
import {
  LOCK_LIVE_SESSION_LIMIT,
  isJankDebugEnabled,
  resolveLockLivePreview,
} from "./utils";

const INVISIBLE_SEARCH_QUERY_CHARS_REGEX = /[\u200B-\u200D\uFEFF]/g;
const RECENT_THREAD_LIMIT = 8;

type FilePanelMode =
  | "git"
  | "files"
  | "search"
  | "prompts"
  | "memory"
  | "activity"
  | "radar";

type Translator = (key: string) => string;

type ThreadStatusSnapshot = {
  isProcessing?: boolean;
  isReviewing?: boolean;
  lastDurationMs?: number | null;
};

type LastAgentMessageSnapshot = {
  text: string;
  timestamp: number;
};

type CompletionTrackerSnapshot = {
  isProcessing: boolean;
  lastDurationMs: number | null;
  lastAgentTimestamp: number;
};

type ListThreadsForWorkspace = (
  workspace: WorkspaceInfo,
  options?: {
    preserveState?: boolean;
    includeOpenCodeSessions?: boolean;
  },
) => Promise<void>;

type UseAppShellSearchRadarSectionOptions = {
  activeDraft: string;
  activeItems: ConversationItem[];
  activeThreadId: string | null;
  activeWorkspace: WorkspaceInfo | null;
  activeWorkspaceId: string | null;
  appSettings: AppSettings;
  commands: CustomCommandOption[];
  composerInputRef: RefObject<HTMLTextAreaElement | null>;
  completionTrackerBySessionRef: MutableRefObject<Record<string, CompletionTrackerSnapshot>>;
  completionTrackerReadyRef: MutableRefObject<boolean>;
  directories: string[];
  filePanelMode: FilePanelMode;
  files: string[];
  globalSearchFilesByWorkspace: Record<string, string[]>;
  handleDraftChange: (next: string) => void;
  isCompact: boolean;
  isFilesLoading: boolean;
  isProcessing: boolean;
  isSearchPaletteOpen: boolean;
  kanbanTasks: KanbanTask[];
  lastAgentMessageByThread: Record<string, LastAgentMessageSnapshot | undefined>;
  listThreadsForWorkspace: ListThreadsForWorkspace;
  rightPanelCollapsed: boolean;
  searchContentFilters: SearchContentFilter[];
  searchPaletteQuery: string;
  searchScope: SearchScope;
  setGlobalSearchFilesByWorkspace: Dispatch<SetStateAction<Record<string, string[]>>>;
  skills: SkillOption[];
  t: Translator;
  threadItemsByThread: Record<string, ConversationItem[]>;
  threadListLoadingByWorkspace: Record<string, boolean>;
  threadParentById: Record<string, string>;
  threadStatusById: Record<string, ThreadStatusSnapshot | undefined>;
  threadsByWorkspace: Record<string, ThreadSummary[]>;
  workspaces: WorkspaceInfo[];
  workspacesById: Map<string, WorkspaceInfo>;
};

export function useAppShellSearchRadarSection({
  activeDraft,
  activeItems,
  activeThreadId,
  activeWorkspace,
  activeWorkspaceId,
  appSettings,
  commands,
  composerInputRef,
  completionTrackerBySessionRef,
  completionTrackerReadyRef,
  directories,
  filePanelMode,
  files,
  globalSearchFilesByWorkspace,
  handleDraftChange,
  isCompact,
  isFilesLoading,
  isProcessing,
  isSearchPaletteOpen,
  kanbanTasks,
  lastAgentMessageByThread,
  listThreadsForWorkspace,
  rightPanelCollapsed,
  searchContentFilters,
  searchPaletteQuery,
  searchScope,
  setGlobalSearchFilesByWorkspace,
  skills,
  t,
  threadItemsByThread,
  threadListLoadingByWorkspace,
  threadParentById,
  threadStatusById,
  threadsByWorkspace,
  workspaces,
  workspacesById,
}: UseAppShellSearchRadarSectionOptions) {
  const handleInsertComposerText = useComposerInsert({
    activeThreadId,
    draftText: activeDraft,
    onDraftChange: handleDraftChange,
    textareaRef: composerInputRef,
  });

  const perfSnapshotRef = useRef({
    activeThreadId: null as string | null,
    isProcessing: false,
    activeItems: 0,
    filesLoading: false,
    files: 0,
    directories: 0,
    filePanelMode: "git" as FilePanelMode,
    rightPanelCollapsed: false,
    isCompact: false,
    draftLength: 0,
  });

  useEffect(() => {
    perfSnapshotRef.current = {
      activeThreadId,
      isProcessing,
      activeItems: activeItems.length,
      filesLoading: isFilesLoading,
      files: files.length,
      directories: directories.length,
      filePanelMode,
      rightPanelCollapsed,
      isCompact,
      draftLength: activeDraft.length,
    };
  }, [
    activeDraft.length,
    activeItems.length,
    activeThreadId,
    directories.length,
    filePanelMode,
    files.length,
    isCompact,
    isFilesLoading,
    isProcessing,
    rightPanelCollapsed,
  ]);

  useEffect(() => {
    if (!import.meta.env.DEV || !isJankDebugEnabled() || typeof window === "undefined") {
      return;
    }
    let rafId = 0;
    let lastFrameAt = performance.now();
    const monitor = (timestamp: number) => {
      const delta = timestamp - lastFrameAt;
      if (delta >= 120) {
        const snapshot = perfSnapshotRef.current;
        console.warn("[perf][jank]", {
          frameGapMs: Number(delta.toFixed(2)),
          ...snapshot,
        });
      }
      lastFrameAt = timestamp;
      rafId = window.requestAnimationFrame(monitor);
    };
    rafId = window.requestAnimationFrame(monitor);
    return () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, []);

  const activePath = activeWorkspace?.path ?? null;
  const activeWorkspaceKanbanTasks = useMemo(
    () => (activePath ? kanbanTasks.filter((task) => task.workspaceId === activePath) : []),
    [activePath, kanbanTasks],
  );

  const activeProjectionSummaryQuery = useMemo(
    () => ({ status: "active" as const }),
    [],
  );
  const { summary: activeWorkspaceProjectionSummary } = useWorkspaceSessionProjectionSummary({
    workspaceId: activeWorkspaceId,
    query: activeProjectionSummaryQuery,
    enabled: Boolean(activeWorkspaceId),
  });
  const activeWorkspaceProjectionOwnerIds = useMemo(() => {
    if (!activeWorkspaceId) {
      return [] as string[];
    }
    const ownerWorkspaceIds = activeWorkspaceProjectionSummary?.ownerWorkspaceIds ?? [];
    if (ownerWorkspaceIds.length === 0) {
      return [activeWorkspaceId];
    }
    return ownerWorkspaceIds;
  }, [activeWorkspaceId, activeWorkspaceProjectionSummary?.ownerWorkspaceIds]);

  const {
    ensureWorkspaceThreadListLoaded,
    hydratedThreadListWorkspaceIdsRef,
    listThreadsForWorkspaceTracked,
  } = useWorkspaceThreadListHydration({
    activeWorkspaceId,
    activeWorkspaceProjectionOwnerIds,
    listThreadsForWorkspace,
    threadListLoadingByWorkspace,
    workspaces,
    workspacesById,
  });

  const handleEnsureWorkspaceThreadsForSettings = useCallback(
    (workspaceId: string) => {
      ensureWorkspaceThreadListLoaded(workspaceId, {
        preserveState: false,
        force: true,
      });
    },
    [ensureWorkspaceThreadListLoaded],
  );

  const activeWorkspaceThreads = useMemo(
    () =>
      activeWorkspaceProjectionOwnerIds.flatMap((workspaceId) => threadsByWorkspace[workspaceId] ?? []),
    [activeWorkspaceProjectionOwnerIds, threadsByWorkspace],
  );

  const workspaceActivity = useWorkspaceSessionActivity({
    activeThreadId,
    threads: activeWorkspaceThreads,
    itemsByThread: threadItemsByThread,
    threadParentById,
    threadStatusById,
  });

  const recentThreads = useMemo(() => {
    if (!activeWorkspaceId || activeWorkspaceProjectionOwnerIds.length === 0) {
      return [];
    }
    const threads = activeWorkspaceProjectionOwnerIds.flatMap((workspaceId) =>
      (threadsByWorkspace[workspaceId] ?? []).map((thread) => ({
        thread,
        ownerWorkspaceId: workspaceId,
      })),
    );
    if (threads.length === 0) {
      return [];
    }
    return [...threads]
      .sort((left, right) => right.thread.updatedAt - left.thread.updatedAt)
      .slice(0, RECENT_THREAD_LIMIT)
      .map(({ thread, ownerWorkspaceId }) => {
        const status = threadStatusById[thread.id];
        return {
          id: thread.id,
          workspaceId: ownerWorkspaceId,
          threadId: thread.id,
          title: thread.name?.trim() || t("threads.untitledThread"),
          updatedAt: thread.updatedAt,
          isProcessing: status?.isProcessing ?? false,
          isReviewing: status?.isReviewing ?? false,
        };
      });
  }, [activeWorkspaceId, activeWorkspaceProjectionOwnerIds, threadStatusById, threadsByWorkspace, t]);

  useEffect(() => {
    if (!activeWorkspaceId) {
      return;
    }
    setGlobalSearchFilesByWorkspace((prev) => {
      const nextFiles = files;
      const previousFiles = prev[activeWorkspaceId];
      if (previousFiles === nextFiles) {
        return prev;
      }
      return {
        ...prev,
        [activeWorkspaceId]: nextFiles,
      };
    });
  }, [activeWorkspaceId, files, setGlobalSearchFilesByWorkspace]);

  useEffect(() => {
    if (!isSearchPaletteOpen || searchScope !== "global") {
      return;
    }
    const targetWorkspaceIds = workspaces.map((workspace) => workspace.id);
    const uncachedWorkspaceIds = targetWorkspaceIds.filter(
      (workspaceId) => !(workspaceId in globalSearchFilesByWorkspace),
    );
    if (uncachedWorkspaceIds.length === 0) {
      return;
    }
    let cancelled = false;
    void Promise.all(
      uncachedWorkspaceIds.map(async (workspaceId) => {
        try {
          const response = await getWorkspaceFiles(workspaceId);
          return [
            workspaceId,
            Array.isArray(response.files) ? response.files : ([] as string[]),
          ] as const;
        } catch {
          return [workspaceId, [] as string[]] as const;
        }
      }),
    ).then((entries) => {
      if (cancelled || entries.length === 0) {
        return;
      }
      setGlobalSearchFilesByWorkspace((prev) => {
        const next = { ...prev };
        for (const [workspaceId, workspaceFiles] of entries) {
          next[workspaceId] = workspaceFiles;
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [
    globalSearchFilesByWorkspace,
    isSearchPaletteOpen,
    searchScope,
    setGlobalSearchFilesByWorkspace,
    workspaces,
  ]);

  const workspaceSearchSources = useMemo(() => {
    if (searchScope === "global") {
      return workspaces.map((workspace) => ({
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        files: globalSearchFilesByWorkspace[workspace.id] ?? [],
        threads: threadsByWorkspace[workspace.id] ?? [],
      }));
    }
    if (!activeWorkspaceId || !activeWorkspace) {
      return [];
    }
    return [
      {
        workspaceId: activeWorkspaceId,
        workspaceName: activeWorkspace.name,
        files,
        threads: activeWorkspaceThreads,
      },
    ];
  }, [
    activeWorkspace,
    activeWorkspaceId,
    activeWorkspaceThreads,
    files,
    globalSearchFilesByWorkspace,
    searchScope,
    threadsByWorkspace,
    workspaces,
  ]);

  const scopedKanbanTasks = useMemo(
    () => (searchScope === "global" ? kanbanTasks : activeWorkspaceKanbanTasks),
    [activeWorkspaceKanbanTasks, kanbanTasks, searchScope],
  );
  const historySearchItems = useMemo<HistoryItem[]>(
    () => (isSearchPaletteOpen ? loadHistoryWithImportance() : []),
    [isSearchPaletteOpen],
  );
  const workspaceNameByPath = useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.path, workspace.name])),
    [workspaces],
  );
  const rawSearchResults = useUnifiedSearch({
    query: searchPaletteQuery,
    contentFilters: searchContentFilters,
    workspaceSources: workspaceSearchSources,
    kanbanTasks: scopedKanbanTasks,
    threadItemsByThread,
    historyItems: historySearchItems,
    skills,
    commands,
    activeWorkspaceId,
    workspaceNameByPath,
  });
  const normalizedSearchPaletteQuery = searchPaletteQuery
    .replace(INVISIBLE_SEARCH_QUERY_CHARS_REGEX, "")
    .trim();
  const searchResults = useMemo(
    () => (normalizedSearchPaletteQuery ? rawSearchResults : []),
    [normalizedSearchPaletteQuery, rawSearchResults],
  );

  const sessionRadarFeed = useSessionRadarFeed({
    workspaces,
    threadsByWorkspace,
    threadStatusById,
    threadItemsByThread,
    lastAgentMessageByThread,
    runningLimit: LOCK_LIVE_SESSION_LIMIT,
    performanceCompatibilityModeEnabled:
      isPerformanceCompatibilityModeEnabled(appSettings),
  });
  const lockLiveSessions = sessionRadarFeed.runningSessions;

  useEffect(() => {
    const previous = completionTrackerBySessionRef.current;
    const next: Record<string, CompletionTrackerSnapshot> = {};
    const completed: PersistedRadarRecentEntry[] = [];

    for (const workspace of workspaces) {
      const threads = threadsByWorkspace[workspace.id] ?? [];
      for (const thread of threads) {
        const key = `${workspace.id}:${thread.id}`;
        const status = threadStatusById[thread.id];
        const isProcessingNow = status?.isProcessing ?? false;
        const lastDurationMs = status?.lastDurationMs ?? null;
        const lastAgentTimestamp = lastAgentMessageByThread[thread.id]?.timestamp ?? 0;
        const previousTracker = previous[key];
        const wasProcessing = previousTracker?.isProcessing ?? false;
        const previousDurationMs = previousTracker?.lastDurationMs ?? null;
        const previousAgentTimestamp = previousTracker?.lastAgentTimestamp ?? 0;
        const finishedByDuration =
          !isProcessingNow &&
          lastDurationMs !== null &&
          lastDurationMs !== previousDurationMs;
        const finishedByAgentUpdate =
          !isProcessingNow &&
          lastAgentTimestamp > previousAgentTimestamp &&
          (wasProcessing || previousDurationMs !== null);

        if ((wasProcessing && !isProcessingNow) || finishedByDuration || finishedByAgentUpdate) {
          const lastAgent = lastAgentMessageByThread[thread.id];
          const completedAt = Math.max(
            thread.updatedAt ?? 0,
            lastAgent?.timestamp ?? 0,
            Date.now(),
          );
          const durationMs = typeof lastDurationMs === "number" ? Math.max(0, lastDurationMs) : null;
          const startedAt =
            durationMs != null
              ? Math.max(0, completedAt - durationMs)
              : (previousTracker?.isProcessing && previousTracker?.lastDurationMs
                  ? Math.max(0, completedAt - previousTracker.lastDurationMs)
                  : null);
          const latestUserMessage = resolveLatestUserMessage(threadItemsByThread[thread.id]);
          completed.push({
            id: buildRadarCompletionId(workspace.id, thread.id),
            workspaceId: workspace.id,
            workspaceName: workspace.name,
            threadId: thread.id,
            threadName: thread.name?.trim() || t("threads.untitledThread"),
            engine: (thread.engineSource || "codex").toUpperCase(),
            preview:
              latestUserMessage ||
              resolveLockLivePreview(threadItemsByThread[thread.id], lastAgent?.text) ||
              thread.name?.trim() ||
              t("threads.untitledThread"),
            updatedAt: completedAt,
            startedAt,
            completedAt,
            durationMs,
          });
        }

        next[key] = {
          isProcessing: isProcessingNow,
          lastDurationMs,
          lastAgentTimestamp,
        };
      }
    }

    if (!completionTrackerReadyRef.current) {
      completionTrackerReadyRef.current = true;
      completionTrackerBySessionRef.current = next;
      return;
    }

    completionTrackerBySessionRef.current = next;
    if (completed.length === 0) {
      return;
    }

    const nextPersistedRecent = mergePersistedRadarRecentEntries(
      getClientStoreSync( RADAR_STORE_NAME, SESSION_RADAR_RECENT_STORAGE_KEY),
      completed,
    );
    writeClientStoreValue(
      RADAR_STORE_NAME,
      SESSION_RADAR_RECENT_STORAGE_KEY,
      nextPersistedRecent,
      { immediate: true },
    );
    dispatchSessionRadarHistoryUpdatedEvent();

    if (appSettings.systemNotificationEnabled) {
      for (const entry of completed) {
        void sendSystemNotification({
          title: t("threadCompletion.title"),
          body: `${t("threadCompletion.project")}: ${entry.workspaceName}\n${t("threadCompletion.session")}: ${entry.threadName}`,
          extra: {
            workspaceId: entry.workspaceId,
            threadId: entry.threadId,
          },
        });
      }
    }
  }, [
    appSettings.systemNotificationEnabled,
    completionTrackerBySessionRef,
    completionTrackerReadyRef,
    lastAgentMessageByThread,
    t,
    threadItemsByThread,
    threadStatusById,
    threadsByWorkspace,
    workspaces,
  ]);

  return {
    activePath,
    activeWorkspaceKanbanTasks,
    activeWorkspaceThreads,
    ensureWorkspaceThreadListLoaded,
    handleEnsureWorkspaceThreadsForSettings,
    handleInsertComposerText,
    historySearchItems,
    hydratedThreadListWorkspaceIdsRef,
    listThreadsForWorkspaceTracked,
    lockLiveSessions,
    perfSnapshotRef,
    RECENT_THREAD_LIMIT,
    recentThreads,
    scopedKanbanTasks,
    searchResults,
    sessionRadarFeed,
    workspaceActivity,
    workspaceNameByPath,
    workspaceSearchSources,
  };
}
