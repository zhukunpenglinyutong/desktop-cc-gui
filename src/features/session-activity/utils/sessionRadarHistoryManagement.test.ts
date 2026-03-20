import { describe, expect, it } from "vitest";
import { getClientStoreSync, writeClientStoreValue } from "../../../services/clientStorage";
import {
  RADAR_STORE_NAME,
  SESSION_RADAR_DISMISSED_COMPLETED_AT_BY_ID_KEY,
  SESSION_RADAR_READ_STATE_KEY,
  SESSION_RADAR_RECENT_STORAGE_KEY,
} from "./sessionRadarPersistence";
import { deleteSessionRadarHistoryEntries } from "./sessionRadarHistoryManagement";

describe("deleteSessionRadarHistoryEntries", () => {
  it("removes selected entries and records dismissed cutoff", () => {
    writeClientStoreValue(
      RADAR_STORE_NAME,
      SESSION_RADAR_RECENT_STORAGE_KEY,
      [
        {
          id: "ws-a:t-1",
          workspaceId: "ws-a",
          threadId: "t-1",
          completedAt: 1000,
          startedAt: 900,
          durationMs: 100,
        },
        {
          id: "ws-a:t-2",
          workspaceId: "ws-a",
          threadId: "t-2",
          completedAt: 900,
          startedAt: 800,
          durationMs: 100,
        },
      ],
      { immediate: true },
    );
    writeClientStoreValue(
      RADAR_STORE_NAME,
      SESSION_RADAR_DISMISSED_COMPLETED_AT_BY_ID_KEY,
      {},
      { immediate: true },
    );
    writeClientStoreValue(
      RADAR_STORE_NAME,
      SESSION_RADAR_READ_STATE_KEY,
      {
        "ws-a:t-1": 1000,
        "ws-a:t-2": 900,
      },
      { immediate: true },
    );

    const result = deleteSessionRadarHistoryEntries([{ id: "ws-a:t-1", completedAt: 1000 }]);
    expect(result.failed).toEqual([]);
    expect(result.succeededEntryIds).toEqual(["ws-a:t-1"]);

    const nextRecent = getClientStoreSync<Array<{ id: string }>>(
      RADAR_STORE_NAME,
      SESSION_RADAR_RECENT_STORAGE_KEY,
    );
    expect(nextRecent?.map((entry) => entry.id)).toEqual(["ws-a:t-2"]);

    const dismissedById = getClientStoreSync<Record<string, number>>(
      RADAR_STORE_NAME,
      SESSION_RADAR_DISMISSED_COMPLETED_AT_BY_ID_KEY,
    );
    expect(dismissedById).toMatchObject({
      "ws-a:t-1": 1000,
    });

    const readStateById = getClientStoreSync<Record<string, number>>(
      RADAR_STORE_NAME,
      SESSION_RADAR_READ_STATE_KEY,
    );
    expect(readStateById).toEqual({
      "ws-a:t-2": 900,
    });
  });

  it("returns NOT_FOUND when entry does not exist", () => {
    writeClientStoreValue(RADAR_STORE_NAME, SESSION_RADAR_RECENT_STORAGE_KEY, [], { immediate: true });
    const result = deleteSessionRadarHistoryEntries([{ id: "missing:id", completedAt: 0 }]);
    expect(result.succeededEntryIds).toEqual([]);
    expect(result.failed).toEqual([
      {
        id: "missing:id",
        code: "NOT_FOUND",
        message: "Radar history entry not found",
      },
    ]);
  });
});
