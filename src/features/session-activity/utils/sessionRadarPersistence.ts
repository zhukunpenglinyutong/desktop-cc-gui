export const RADAR_STORE_NAME = "leida" as const;
export const SESSION_RADAR_RECENT_STORAGE_KEY = "sessionRadar.recentCompleted" as const;
export const SESSION_RADAR_READ_STATE_KEY = "sessionRadar.readStateById" as const;
export const SESSION_RADAR_COLLAPSED_DATE_GROUPS_KEY = "sessionRadar.collapsedDateGroups" as const;
export const SESSION_RADAR_DISMISSED_COMPLETED_AT_BY_ID_KEY =
  "sessionRadar.dismissedCompletedAtById" as const;
export const SESSION_RADAR_HISTORY_UPDATED_EVENT = "session-radar-history-updated" as const;

export type PersistedRadarRecentEntry = {
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

export function buildRadarCompletionId(workspaceId: string, threadId: string) {
  return `${workspaceId}:${threadId}`;
}

export function resolveLatestUserMessage(items: unknown): string {
  if (!Array.isArray(items) || items.length === 0) {
    return "";
  }
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const candidate = items[index] as { kind?: unknown; role?: unknown; text?: unknown };
    if (candidate?.kind === "message" && candidate.role === "user") {
      const text = typeof candidate.text === "string" ? candidate.text.trim() : "";
      if (text) {
        return text;
      }
    }
  }
  return "";
}

export function parsePersistedRadarRecentEntry(raw: unknown): PersistedRadarRecentEntry | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const entry = raw as Partial<PersistedRadarRecentEntry>;
  if (
    typeof entry.id !== "string" ||
    typeof entry.workspaceId !== "string" ||
    typeof entry.threadId !== "string" ||
    typeof entry.completedAt !== "number"
  ) {
    return null;
  }
  return {
    id: buildRadarCompletionId(entry.workspaceId, entry.threadId),
    workspaceId: entry.workspaceId,
    workspaceName: typeof entry.workspaceName === "string" ? entry.workspaceName : undefined,
    threadId: entry.threadId,
    threadName: typeof entry.threadName === "string" ? entry.threadName : undefined,
    engine: typeof entry.engine === "string" ? entry.engine : undefined,
    preview: typeof entry.preview === "string" ? entry.preview : undefined,
    updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : undefined,
    startedAt: typeof entry.startedAt === "number" ? entry.startedAt : null,
    completedAt: entry.completedAt,
    durationMs: typeof entry.durationMs === "number" ? Math.max(0, entry.durationMs) : null,
  };
}

export function mergePersistedRadarRecentEntries(
  rawPersistedRecent: unknown,
  completedEntries: PersistedRadarRecentEntry[],
): PersistedRadarRecentEntry[] {
  const persistedRecentList = Array.isArray(rawPersistedRecent)
    ? rawPersistedRecent
        .map(parsePersistedRadarRecentEntry)
        .filter((entry): entry is PersistedRadarRecentEntry => Boolean(entry))
    : [];

  const mergedById = new Map<string, PersistedRadarRecentEntry>();
  for (const entry of persistedRecentList) {
    mergedById.set(entry.id, entry);
  }
  for (const entry of completedEntries) {
    const previous = mergedById.get(entry.id);
    if (!previous || previous.completedAt <= entry.completedAt) {
      mergedById.set(entry.id, entry);
    }
  }
  return Array.from(mergedById.values()).sort((left, right) => right.completedAt - left.completedAt);
}

export function dispatchSessionRadarHistoryUpdatedEvent() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SESSION_RADAR_HISTORY_UPDATED_EVENT));
  }
}
