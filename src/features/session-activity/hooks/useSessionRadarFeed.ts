import { useEffect, useMemo, useRef, useState } from "react";
import type { ConversationItem, ThreadSummary, WorkspaceInfo } from "../../../types";
import { resolveLockLivePreview } from "../../../app-shell-parts/utils";
import { getClientStoreSync, writeClientStoreValue } from "../../../services/clientStorage";
import { isIncrementalDerivationEnabled } from "../../threads/utils/realtimePerfFlags";
import {
  SESSION_RADAR_DISMISSED_COMPLETED_AT_BY_ID_KEY,
  SESSION_RADAR_HISTORY_UPDATED_EVENT,
  SESSION_RADAR_READ_STATE_KEY,
  SESSION_RADAR_RECENT_STORAGE_KEY,
} from "../utils/sessionRadarPersistence";
import {
  resolveSessionRadarTickMs,
  shouldPauseSessionRadarTick,
} from "../utils/performanceCompatibility";

const DEFAULT_RUNNING_LIMIT = 12;
const DEFAULT_RECENT_LIMIT = Number.POSITIVE_INFINITY;
const RADAR_STORE_NAME = "leida";

type ThreadStatusSnapshot = {
  isProcessing?: boolean;
  processingStartedAt?: number | null;
  lastDurationMs?: number | null;
};

type LastAgentSnapshot = {
  text: string;
  timestamp: number;
};

export type SessionRadarEntry = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  threadId: string;
  threadName: string;
  engine: string;
  preview: string;
  updatedAt: number;
  isProcessing: boolean;
  startedAt: number | null;
  completedAt: number | null;
  durationMs: number | null;
};

type BuildSessionRadarFeedInput = {
  workspaces: WorkspaceInfo[];
  threadsByWorkspace: Record<string, ThreadSummary[]>;
  threadStatusById: Record<string, ThreadStatusSnapshot | undefined>;
  threadItemsByThread: Record<string, ConversationItem[]>;
  lastAgentMessageByThread: Record<string, LastAgentSnapshot | undefined>;
  now?: number;
  runningLimit?: number;
  recentLimit?: number;
};

type SessionRadarFeed = {
  runningSessions: SessionRadarEntry[];
  recentCompletedSessions: SessionRadarEntry[];
  runningCountByWorkspaceId: Record<string, number>;
  recentCountByWorkspaceId: Record<string, number>;
};

type PersistedRecentSessionRef = {
  id: string;
  workspaceId: string;
  workspaceName?: string;
  threadId: string;
  threadName?: string;
  engine?: string;
  preview?: string;
  updatedAt?: number;
  startedAt: number | null;
  completedAt: number;
  durationMs: number | null;
};

type CachedLiveThreadEntry = {
  signature: string;
  entry: SessionRadarEntry;
};

type RecentHistorySnapshot = {
  dismissedCompletedAtById: Record<string, number>;
  persistedRecent: PersistedRecentSessionRef[];
};

const latestUserMessageByItemsRef = new WeakMap<ConversationItem[], string>();

function buildRecentCompletionId(workspaceId: string, threadId: string) {
  return `${workspaceId}:${threadId}`;
}

function resolveLatestUserMessage(items: ConversationItem[] | undefined) {
  if (!Array.isArray(items) || items.length === 0) {
    return "";
  }
  if (latestUserMessageByItemsRef.has(items)) {
    return latestUserMessageByItemsRef.get(items) ?? "";
  }
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const candidate = items[index];
    if (candidate?.kind === "message" && candidate.role === "user") {
      const text = candidate.text?.trim();
      if (text) {
        latestUserMessageByItemsRef.set(items, text);
        return text;
      }
    }
  }
  latestUserMessageByItemsRef.set(items, "");
  return "";
}

function resolveEntryTimestamp(
  thread: ThreadSummary,
  status: ThreadStatusSnapshot | undefined,
  lastAgent: LastAgentSnapshot | undefined,
) {
  return Math.max(
    thread.updatedAt ?? 0,
    lastAgent?.timestamp ?? 0,
    status?.processingStartedAt ?? 0,
  );
}

function clampDurationMs(durationMs: number | null | undefined) {
  if (durationMs == null || Number.isNaN(durationMs)) {
    return null;
  }
  return Math.max(0, durationMs);
}

function fingerprintConversationItem(item: ConversationItem | undefined) {
  if (!item) {
    return "";
  }
  if (item.kind === "tool") {
    return [
      item.id,
      item.kind,
      item.toolType,
      item.status ?? "",
      item.title ?? "",
      item.output?.length ?? 0,
      item.changes?.length ?? 0,
    ].join(":");
  }
  if (item.kind === "reasoning") {
    return [item.id, item.kind, item.summary.length, item.content.length].join(":");
  }
  if (item.kind === "explore") {
    return [item.id, item.kind, item.status ?? "", item.entries?.length ?? 0].join(":");
  }
  if (item.kind === "message") {
    return [item.id, item.kind, item.role, item.text.length].join(":");
  }
  return [item.id, item.kind].join(":");
}

function buildLiveThreadSignature(
  workspaceId: string,
  thread: ThreadSummary,
  status: ThreadStatusSnapshot | undefined,
  items: ConversationItem[] | undefined,
  lastAgent: LastAgentSnapshot | undefined,
) {
  const resolvedItems = items ?? [];
  const lastItem = resolvedItems[resolvedItems.length - 1];
  const previousItem = resolvedItems[resolvedItems.length - 2];
  return [
    workspaceId,
    thread.id,
    thread.name ?? "",
    String(thread.updatedAt ?? 0),
    String(Boolean(status?.isProcessing)),
    String(status?.processingStartedAt ?? 0),
    String(status?.lastDurationMs ?? 0),
    String(lastAgent?.timestamp ?? 0),
    lastAgent?.text ?? "",
    String(resolvedItems.length),
    fingerprintConversationItem(resolvedItems[0]),
    fingerprintConversationItem(previousItem),
    fingerprintConversationItem(lastItem),
  ].join("|");
}

function buildLiveSessionRadarEntry(input: {
  workspace: WorkspaceInfo;
  thread: ThreadSummary;
  status: ThreadStatusSnapshot | undefined;
  items: ConversationItem[] | undefined;
  lastAgent: LastAgentSnapshot | undefined;
  now: number;
}): SessionRadarEntry {
  const { workspace, thread, status, items, lastAgent, now } = input;
  const isProcessing = Boolean(status?.isProcessing);
  const updatedAt = resolveEntryTimestamp(thread, status, lastAgent);
  const preview =
    resolveLatestUserMessage(items) ||
    resolveLockLivePreview(items, lastAgent?.text);

  const entry: SessionRadarEntry = {
    id: `${workspace.id}:${thread.id}`,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    threadId: thread.id,
    threadName: thread.name?.trim() || "Untitled Thread",
    engine: (thread.engineSource || "codex").toUpperCase(),
    preview,
    updatedAt,
    isProcessing,
    startedAt: null,
    completedAt: null,
    durationMs: null,
  };

  if (!isProcessing) {
    return entry;
  }

  const startedAt = status?.processingStartedAt ?? null;
  entry.startedAt = startedAt;
  entry.durationMs = startedAt ? Math.max(0, now - startedAt) : null;
  return entry;
}

function buildRecentCountByWorkspace(entries: SessionRadarEntry[]) {
  const countByWorkspaceId: Record<string, number> = {};
  for (const entry of entries) {
    countByWorkspaceId[entry.workspaceId] = (countByWorkspaceId[entry.workspaceId] ?? 0) + 1;
  }
  return countByWorkspaceId;
}

function parsePersistedRecentSessionRef(raw: unknown): PersistedRecentSessionRef | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const entry = raw as Partial<PersistedRecentSessionRef>;
  if (
    typeof entry.id !== "string" ||
    typeof entry.workspaceId !== "string" ||
    typeof entry.threadId !== "string" ||
    typeof entry.completedAt !== "number"
  ) {
    return null;
  }
  return {
    id: buildRecentCompletionId(entry.workspaceId, entry.threadId),
    workspaceId: entry.workspaceId,
    workspaceName: typeof entry.workspaceName === "string" ? entry.workspaceName : undefined,
    threadId: entry.threadId,
    threadName: typeof entry.threadName === "string" ? entry.threadName : undefined,
    engine: typeof entry.engine === "string" ? entry.engine : undefined,
    preview: typeof entry.preview === "string" ? entry.preview : undefined,
    updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : undefined,
    startedAt: typeof entry.startedAt === "number" ? entry.startedAt : null,
    completedAt: entry.completedAt,
    durationMs: clampDurationMs(entry.durationMs),
  };
}

function readDismissedCompletedAtById() {
  const raw = getClientStoreSync<unknown>(
    RADAR_STORE_NAME,
    SESSION_RADAR_DISMISSED_COMPLETED_AT_BY_ID_KEY,
  );
  if (!raw || typeof raw !== "object") {
    return {} as Record<string, number>;
  }
  const entries = Object.entries(raw as Record<string, unknown>).filter(
    ([entryId, value]) =>
      typeof entryId === "string" &&
      typeof value === "number" &&
      Number.isFinite(value) &&
      value > 0,
  );
  return Object.fromEntries(entries) as Record<string, number>;
}

function isRecentEntryDismissed(
  entryId: string,
  completedAt: number | null | undefined,
  dismissedCompletedAtById: Record<string, number>,
) {
  const dismissedCompletedAt = dismissedCompletedAtById[entryId];
  if (typeof dismissedCompletedAt !== "number" || !Number.isFinite(dismissedCompletedAt)) {
    return false;
  }
  const resolvedCompletedAt =
    typeof completedAt === "number" && Number.isFinite(completedAt) ? completedAt : 0;
  return resolvedCompletedAt > 0 && dismissedCompletedAt >= resolvedCompletedAt;
}

function readPersistedRecentSessions(): PersistedRecentSessionRef[] {
  const raw = getClientStoreSync<unknown>(RADAR_STORE_NAME, SESSION_RADAR_RECENT_STORAGE_KEY);
  if (!Array.isArray(raw) || raw.length === 0) {
    return [];
  }
  const dedupedById = new Map<string, PersistedRecentSessionRef>();
  for (const item of raw.map(parsePersistedRecentSessionRef)) {
    if (!item) {
      continue;
    }
    const previous = dedupedById.get(item.id);
    if (!previous || previous.completedAt < item.completedAt) {
      dedupedById.set(item.id, item);
    }
  }
  return Array.from(dedupedById.values())
    .filter((item): item is PersistedRecentSessionRef => Boolean(item))
    .sort((a, b) => b.completedAt - a.completedAt);
}

function readRecentHistorySnapshot(): RecentHistorySnapshot {
  return {
    dismissedCompletedAtById: readDismissedCompletedAtById(),
    persistedRecent: readPersistedRecentSessions(),
  };
}

function mergeRecentSessions(
  liveRecent: SessionRadarEntry[],
  persistedRecent: PersistedRecentSessionRef[],
  workspaces: WorkspaceInfo[],
  threadsByWorkspace: Record<string, ThreadSummary[]>,
  threadItemsByThread: Record<string, ConversationItem[]>,
  lastAgentMessageByThread: Record<string, LastAgentSnapshot | undefined>,
  recentLimit: number,
) {
  const mergedById = new Map<string, SessionRadarEntry>();
  for (const entry of liveRecent) {
    mergedById.set(entry.id, entry);
  }

  const workspaceById = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
  const threadByWorkspaceAndId = new Map<string, ThreadSummary>();
  for (const workspace of workspaces) {
    const threads = threadsByWorkspace[workspace.id] ?? [];
    for (const thread of threads) {
      threadByWorkspaceAndId.set(`${workspace.id}:${thread.id}`, thread);
    }
  }

  for (const persistedEntry of persistedRecent) {
    const normalizedId = buildRecentCompletionId(persistedEntry.workspaceId, persistedEntry.threadId);
    const workspace = workspaceById.get(persistedEntry.workspaceId);
    const thread = threadByWorkspaceAndId.get(
      `${persistedEntry.workspaceId}:${persistedEntry.threadId}`,
    );
    const lastAgent = thread ? lastAgentMessageByThread[thread.id] : undefined;
    const mergedEntry: SessionRadarEntry = {
      id: normalizedId,
      workspaceId: persistedEntry.workspaceId,
      workspaceName: workspace?.name || persistedEntry.workspaceName || persistedEntry.workspaceId,
      threadId: persistedEntry.threadId,
      threadName: thread?.name?.trim() || persistedEntry.threadName || "Untitled Thread",
      engine:
        (thread?.engineSource || persistedEntry.engine || "codex")
          .toString()
          .toUpperCase(),
      preview:
        resolveLatestUserMessage(thread ? threadItemsByThread[thread.id] : undefined) ||
        (thread ? resolveLockLivePreview(threadItemsByThread[thread.id], lastAgent?.text) : "") ||
        (persistedEntry.preview ?? ""),
      updatedAt: persistedEntry.updatedAt ?? persistedEntry.completedAt,
      isProcessing: false,
      startedAt: persistedEntry.startedAt,
      completedAt: persistedEntry.completedAt,
      durationMs: persistedEntry.durationMs,
    };
    const previous = mergedById.get(normalizedId);
    if (!previous || previous.updatedAt <= mergedEntry.updatedAt) {
      mergedById.set(normalizedId, mergedEntry);
    }
  }
  return Array.from(mergedById.values())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, recentLimit);
}

export function buildSessionRadarFeed(input: BuildSessionRadarFeedInput): SessionRadarFeed {
  const {
    workspaces,
    threadsByWorkspace,
    threadStatusById,
    threadItemsByThread,
    lastAgentMessageByThread,
    now = Date.now(),
    runningLimit = DEFAULT_RUNNING_LIMIT,
    recentLimit = DEFAULT_RECENT_LIMIT,
  } = input;
  const runningSessions: SessionRadarEntry[] = [];
  const recentCompletedSessions: SessionRadarEntry[] = [];
  const runningCountByWorkspaceId: Record<string, number> = {};
  const recentCountByWorkspaceId: Record<string, number> = {};
  const seenRunningIds = new Set<string>();

  for (const workspace of workspaces) {
    const threads = threadsByWorkspace[workspace.id] ?? [];
    for (const thread of threads) {
      const status = threadStatusById[thread.id];
      const lastAgent = lastAgentMessageByThread[thread.id];
      const entry = buildLiveSessionRadarEntry({
        workspace,
        thread,
        status,
        items: threadItemsByThread[thread.id],
        lastAgent,
        now,
      });

      if (entry.isProcessing) {
        if (!seenRunningIds.has(entry.id)) {
          seenRunningIds.add(entry.id);
          runningSessions.push(entry);
        }
        runningCountByWorkspaceId[workspace.id] = (runningCountByWorkspaceId[workspace.id] ?? 0) + 1;
        continue;
      }

      // Completed sessions are sourced from persisted completion entries only.
      // Using thread.updatedAt here would make deleted history entries reappear
      // after unrelated thread updates or app restarts.
    }
  }

  runningSessions.sort((a, b) => b.updatedAt - a.updatedAt);
  recentCompletedSessions.sort((a, b) => b.updatedAt - a.updatedAt);

  return {
    runningSessions: runningSessions.slice(0, runningLimit),
    recentCompletedSessions: recentCompletedSessions.slice(0, recentLimit),
    runningCountByWorkspaceId,
    recentCountByWorkspaceId,
  };
}

type UseSessionRadarFeedInput = Omit<BuildSessionRadarFeedInput, "now"> & {
  runningLimit?: number;
  recentLimit?: number;
  performanceCompatibilityModeEnabled?: boolean;
};

export function useSessionRadarFeed(input: UseSessionRadarFeedInput): SessionRadarFeed {
  const {
    workspaces,
    threadsByWorkspace,
    threadStatusById,
    threadItemsByThread,
    lastAgentMessageByThread,
    runningLimit,
    recentLimit,
    performanceCompatibilityModeEnabled = false,
  } = input;
  const resolvedRecentLimit = recentLimit ?? DEFAULT_RECENT_LIMIT;
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [recentHistorySnapshot, setRecentHistorySnapshot] = useState<RecentHistorySnapshot>(() =>
    readRecentHistorySnapshot(),
  );
  const cachedLiveThreadEntriesRef = useRef<Record<string, CachedLiveThreadEntry>>({});
  const hasRunningThread = useMemo(
    () => Object.values(threadStatusById).some((status) => Boolean(status?.isProcessing)),
    [threadStatusById],
  );

  useEffect(() => {
    if (!hasRunningThread) {
      return;
    }

    const tickMs = resolveSessionRadarTickMs(performanceCompatibilityModeEnabled);
    const updateClockIfVisible = () => {
      if (
        typeof document !== "undefined" &&
        shouldPauseSessionRadarTick(
          performanceCompatibilityModeEnabled,
          document.visibilityState,
        )
      ) {
        return;
      }
      setClockNow(Date.now());
    };
    const handleVisibilityChange = () => {
      updateClockIfVisible();
    };

    setClockNow(Date.now());
    const timerId = window.setInterval(() => {
      updateClockIfVisible();
    }, tickMs);
    if (performanceCompatibilityModeEnabled && typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }
    return () => {
      window.clearInterval(timerId);
      if (performanceCompatibilityModeEnabled && typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
    };
  }, [hasRunningThread, performanceCompatibilityModeEnabled]);

  const liveFeed = useMemo(
    () => {
      if (!isIncrementalDerivationEnabled()) {
        cachedLiveThreadEntriesRef.current = {};
        return buildSessionRadarFeed({
          workspaces,
          threadsByWorkspace,
          threadStatusById,
          threadItemsByThread,
          lastAgentMessageByThread,
          runningLimit,
          recentLimit: resolvedRecentLimit,
        });
      }

      const now = Math.max(clockNow, Date.now());
      const runningSessions: SessionRadarEntry[] = [];
      const runningCountByWorkspaceId: Record<string, number> = {};
      const recentCountByWorkspaceId: Record<string, number> = {};
      const seenRunningIds = new Set<string>();
      const nextCachedEntries: Record<string, CachedLiveThreadEntry> = {};

      for (const workspace of workspaces) {
        const threads = threadsByWorkspace[workspace.id] ?? [];
        for (const thread of threads) {
          const threadId = thread.id;
          const entryId = `${workspace.id}:${threadId}`;
          const status = threadStatusById[threadId];
          const items = threadItemsByThread[threadId];
          const lastAgent = lastAgentMessageByThread[threadId];
          const signature = buildLiveThreadSignature(
            workspace.id,
            thread,
            status,
            items,
            lastAgent,
          );
          const cachedEntry = cachedLiveThreadEntriesRef.current[entryId];
          const entry =
            cachedEntry && cachedEntry.signature === signature
              ? (() => {
                  const preserved = cachedEntry.entry;
                  if (!preserved.isProcessing || preserved.startedAt == null) {
                    return preserved;
                  }
                  const nextDurationMs = Math.max(0, now - preserved.startedAt);
                  const previousSeconds = Math.floor((preserved.durationMs ?? 0) / 1000);
                  const nextSeconds = Math.floor(nextDurationMs / 1000);
                  if (previousSeconds === nextSeconds) {
                    return preserved;
                  }
                  return {
                    ...preserved,
                    durationMs: nextDurationMs,
                  };
                })()
              : buildLiveSessionRadarEntry({
                  workspace,
                  thread,
                  status,
                  items,
                  lastAgent,
                  now,
                });
          nextCachedEntries[entryId] = {
            signature,
            entry,
          };
          if (!entry.isProcessing) {
            continue;
          }
          if (!seenRunningIds.has(entry.id)) {
            seenRunningIds.add(entry.id);
            runningSessions.push(entry);
          }
          runningCountByWorkspaceId[workspace.id] =
            (runningCountByWorkspaceId[workspace.id] ?? 0) + 1;
        }
      }

      cachedLiveThreadEntriesRef.current = nextCachedEntries;
      runningSessions.sort((a, b) => b.updatedAt - a.updatedAt);

      return {
        runningSessions: runningSessions.slice(0, runningLimit ?? DEFAULT_RUNNING_LIMIT),
        recentCompletedSessions: [],
        runningCountByWorkspaceId,
        recentCountByWorkspaceId,
      };
    },
    [
      lastAgentMessageByThread,
      resolvedRecentLimit,
      runningLimit,
      threadItemsByThread,
      threadStatusById,
      threadsByWorkspace,
      workspaces,
      clockNow,
    ],
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handleRadarHistoryUpdated = () => {
      setRecentHistorySnapshot(readRecentHistorySnapshot());
    };
    window.addEventListener(SESSION_RADAR_HISTORY_UPDATED_EVENT, handleRadarHistoryUpdated);
    return () => {
      window.removeEventListener(SESSION_RADAR_HISTORY_UPDATED_EVENT, handleRadarHistoryUpdated);
    };
  }, []);

  const mergedRecentFeed = useMemo(() => {
    const mergedRecent = mergeRecentSessions(
      liveFeed.recentCompletedSessions,
      recentHistorySnapshot.persistedRecent,
      workspaces,
      threadsByWorkspace,
      threadItemsByThread,
      lastAgentMessageByThread,
      resolvedRecentLimit,
    ).filter(
      (entry) =>
        !isRecentEntryDismissed(
          entry.id,
          entry.completedAt,
          recentHistorySnapshot.dismissedCompletedAtById,
        ),
    );
    return {
      ...liveFeed,
      recentCompletedSessions: mergedRecent,
      recentCountByWorkspaceId: buildRecentCountByWorkspace(mergedRecent),
    };
  }, [
    lastAgentMessageByThread,
    liveFeed,
    resolvedRecentLimit,
    recentHistorySnapshot,
    threadItemsByThread,
    threadsByWorkspace,
    workspaces,
  ]);

  useEffect(() => {
    const persistedRecentRefs: PersistedRecentSessionRef[] =
      mergedRecentFeed.recentCompletedSessions.map((entry) => ({
        id: entry.id,
        workspaceId: entry.workspaceId,
        workspaceName: entry.workspaceName,
        threadId: entry.threadId,
        threadName: entry.threadName,
        engine: entry.engine,
        preview: entry.preview,
        updatedAt: entry.updatedAt,
        startedAt: entry.startedAt,
        completedAt: entry.completedAt ?? entry.updatedAt,
        durationMs: entry.durationMs,
      }));
    writeClientStoreValue(RADAR_STORE_NAME, SESSION_RADAR_RECENT_STORAGE_KEY, persistedRecentRefs, {
      immediate: true,
    });

    const existingReadState =
      getClientStoreSync<Record<string, number>>(RADAR_STORE_NAME, SESSION_RADAR_READ_STATE_KEY) ??
      {};
    const activeIds = new Set(persistedRecentRefs.map((entry) => entry.id));
    const prunedReadState = Object.fromEntries(
      Object.entries(existingReadState).filter(([entryId]) => activeIds.has(entryId)),
    );
    writeClientStoreValue(RADAR_STORE_NAME, SESSION_RADAR_READ_STATE_KEY, prunedReadState, {
      immediate: true,
    });
  }, [mergedRecentFeed.recentCompletedSessions]);

  return mergedRecentFeed;
}
