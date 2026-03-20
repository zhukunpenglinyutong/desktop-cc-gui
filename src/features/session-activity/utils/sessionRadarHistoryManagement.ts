import { getClientStoreSync, writeClientStoreValue } from "../../../services/clientStorage";
import {
  RADAR_STORE_NAME,
  SESSION_RADAR_READ_STATE_KEY,
  SESSION_RADAR_DISMISSED_COMPLETED_AT_BY_ID_KEY,
  SESSION_RADAR_HISTORY_UPDATED_EVENT,
  SESSION_RADAR_RECENT_STORAGE_KEY,
  parsePersistedRadarRecentEntry,
} from "./sessionRadarPersistence";

export type SessionRadarHistoryDeleteFailure = {
  id: string;
  code: "INVALID_ID" | "NOT_FOUND";
  message: string;
};

export type SessionRadarHistoryDeleteTarget = {
  id: string;
  completedAt: number;
};

export type SessionRadarHistoryDeleteResult = {
  succeededEntryIds: string[];
  failed: SessionRadarHistoryDeleteFailure[];
};

function readDismissedCompletedAtById() {
  const raw = getClientStoreSync<unknown>(
    RADAR_STORE_NAME,
    SESSION_RADAR_DISMISSED_COMPLETED_AT_BY_ID_KEY,
  );
  if (!raw || typeof raw !== "object") {
    return {} as Record<string, number>;
  }
  const entries = Object.entries(raw as Record<string, unknown>).filter(
    ([id, value]) => typeof id === "string" && typeof value === "number" && Number.isFinite(value),
  );
  return Object.fromEntries(entries) as Record<string, number>;
}

export function deleteSessionRadarHistoryEntries(
  targets: SessionRadarHistoryDeleteTarget[],
): SessionRadarHistoryDeleteResult {
  if (!Array.isArray(targets) || targets.length === 0) {
    return { succeededEntryIds: [], failed: [] };
  }

  const rawRecent = getClientStoreSync<unknown>(RADAR_STORE_NAME, SESSION_RADAR_RECENT_STORAGE_KEY);
  const persistedRecent = Array.isArray(rawRecent)
    ? rawRecent
        .map(parsePersistedRadarRecentEntry)
        .filter((entry): entry is NonNullable<ReturnType<typeof parsePersistedRadarRecentEntry>> =>
          Boolean(entry),
        )
    : [];

  const recentById = new Map(persistedRecent.map((entry) => [entry.id, entry]));
  const nextDismissedById = { ...readDismissedCompletedAtById() };
  const succeededEntryIds: string[] = [];
  const failed: SessionRadarHistoryDeleteFailure[] = [];

  for (const target of targets) {
    const normalizedId = typeof target?.id === "string" ? target.id.trim() : "";
    if (!normalizedId) {
      failed.push({
        id: "",
        code: "INVALID_ID",
        message: "Invalid radar history id",
      });
      continue;
    }
    const persisted = recentById.get(normalizedId);
    const targetCompletedAt = Number.isFinite(target.completedAt) ? target.completedAt : 0;
    const cutoff = Math.max(persisted?.completedAt ?? 0, targetCompletedAt, nextDismissedById[normalizedId] ?? 0);
    if (cutoff <= 0) {
      failed.push({
        id: normalizedId,
        code: "NOT_FOUND",
        message: "Radar history entry not found",
      });
      continue;
    }

    recentById.delete(normalizedId);
    nextDismissedById[normalizedId] = cutoff;
    succeededEntryIds.push(normalizedId);
  }

  const nextRecent = Array.from(recentById.values()).sort((a, b) => b.completedAt - a.completedAt);
  const activeIds = new Set(nextRecent.map((entry) => entry.id));
  writeClientStoreValue(RADAR_STORE_NAME, SESSION_RADAR_RECENT_STORAGE_KEY, nextRecent, {
    immediate: true,
  });
  const currentReadState =
    getClientStoreSync<Record<string, number>>(RADAR_STORE_NAME, SESSION_RADAR_READ_STATE_KEY) ?? {};
  const nextReadState = Object.fromEntries(
    Object.entries(currentReadState).filter(
      ([entryId]) => activeIds.has(entryId) && !succeededEntryIds.includes(entryId),
    ),
  );
  writeClientStoreValue(RADAR_STORE_NAME, SESSION_RADAR_READ_STATE_KEY, nextReadState, {
    immediate: true,
  });
  writeClientStoreValue(
    RADAR_STORE_NAME,
    SESSION_RADAR_DISMISSED_COMPLETED_AT_BY_ID_KEY,
    nextDismissedById,
    { immediate: true },
  );

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SESSION_RADAR_HISTORY_UPDATED_EVENT));
  }

  return {
    succeededEntryIds,
    failed,
  };
}
