import { useEffect, useMemo } from "react";
import type { ConversationItem, ThreadSummary, WorkspaceInfo } from "../../../types";
import { resolveLockLivePreview } from "../../../app-shell-parts/utils";
import { getClientStoreSync, writeClientStoreValue } from "../../../services/clientStorage";

const DEFAULT_RUNNING_LIMIT = 12;
const DEFAULT_RECENT_LIMIT = Number.POSITIVE_INFINITY;
const RADAR_STORE_NAME = "leida";
const SESSION_RADAR_RECENT_STORAGE_KEY = "sessionRadar.recentCompleted";
const SESSION_RADAR_READ_STATE_KEY = "sessionRadar.readStateById";

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

function buildRecentCompletionId(workspaceId: string, threadId: string) {
  return `${workspaceId}:${threadId}`;
}

function resolveLatestUserMessage(items: ConversationItem[] | undefined) {
  if (!Array.isArray(items) || items.length === 0) {
    return "";
  }
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const candidate = items[index];
    if (candidate?.kind === "message" && candidate.role === "user") {
      const text = candidate.text?.trim();
      if (text) {
        return text;
      }
    }
  }
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
  const seenRecentIds = new Set<string>();

  for (const workspace of workspaces) {
    const threads = threadsByWorkspace[workspace.id] ?? [];
    for (const thread of threads) {
      const status = threadStatusById[thread.id];
      const isProcessing = Boolean(status?.isProcessing);
      const lastAgent = lastAgentMessageByThread[thread.id];
      const updatedAt = resolveEntryTimestamp(thread, status, lastAgent);
      const entry: SessionRadarEntry = {
        id: `${workspace.id}:${thread.id}`,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        threadId: thread.id,
        threadName: thread.name?.trim() || "Untitled Thread",
        engine: (thread.engineSource || "codex").toUpperCase(),
        preview:
          resolveLatestUserMessage(threadItemsByThread[thread.id]) ||
          resolveLockLivePreview(threadItemsByThread[thread.id], lastAgent?.text),
        updatedAt,
        isProcessing,
        startedAt: null,
        completedAt: null,
        durationMs: null,
      };

      if (isProcessing) {
        const startedAt = status?.processingStartedAt ?? null;
        entry.startedAt = startedAt;
        entry.durationMs = startedAt ? Math.max(0, now - startedAt) : null;
        if (!seenRunningIds.has(entry.id)) {
          seenRunningIds.add(entry.id);
          runningSessions.push(entry);
        }
        runningCountByWorkspaceId[workspace.id] = (runningCountByWorkspaceId[workspace.id] ?? 0) + 1;
        continue;
      }

      const hasCompletionSignal = status?.lastDurationMs != null;
      if (!hasCompletionSignal) {
        continue;
      }
      const durationMs = clampDurationMs(status?.lastDurationMs);
      entry.durationMs = durationMs;
      entry.completedAt = updatedAt;
      entry.startedAt = durationMs != null ? Math.max(0, updatedAt - durationMs) : null;
      entry.id = buildRecentCompletionId(workspace.id, thread.id);
      if (seenRecentIds.has(entry.id)) {
        continue;
      }
      seenRecentIds.add(entry.id);
      recentCompletedSessions.push(entry);
      recentCountByWorkspaceId[workspace.id] = (recentCountByWorkspaceId[workspace.id] ?? 0) + 1;
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
  } = input;
  const resolvedRecentLimit = recentLimit ?? DEFAULT_RECENT_LIMIT;

  const liveFeed = useMemo(
    () =>
      buildSessionRadarFeed({
        workspaces,
        threadsByWorkspace,
        threadStatusById,
        threadItemsByThread,
        lastAgentMessageByThread,
        runningLimit,
        recentLimit: resolvedRecentLimit,
      }),
    [
      lastAgentMessageByThread,
      resolvedRecentLimit,
      runningLimit,
      threadItemsByThread,
      threadStatusById,
      threadsByWorkspace,
      workspaces,
    ],
  );

  const mergedRecentFeed = useMemo(() => {
    const persistedRecent = readPersistedRecentSessions();
    const mergedRecent = mergeRecentSessions(
      liveFeed.recentCompletedSessions,
      persistedRecent,
      workspaces,
      threadsByWorkspace,
      threadItemsByThread,
      lastAgentMessageByThread,
      resolvedRecentLimit,
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
