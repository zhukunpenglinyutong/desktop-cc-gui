import { describe, expect, it } from "vitest";
import { resolveThreadScopedCollaborationModeSync } from "./utils";

describe("resolveThreadScopedCollaborationModeSync", () => {
  it("syncs claude selector to the mapped thread mode", () => {
    expect(
      resolveThreadScopedCollaborationModeSync({
        activeEngine: "claude",
        activeThreadId: "thread-1",
        mappedMode: "code",
        selectedCollaborationModeId: "plan",
        lastSyncedThreadId: "thread-1",
      }),
    ).toEqual({
      nextMode: "code",
      nextSyncedThreadId: "thread-1",
      shouldUpdateSelectedMode: true,
    });
  });

  it("falls back to code when a claude thread changes without a mapped mode", () => {
    expect(
      resolveThreadScopedCollaborationModeSync({
        activeEngine: "claude",
        activeThreadId: "thread-2",
        mappedMode: null,
        selectedCollaborationModeId: "plan",
        lastSyncedThreadId: "thread-1",
      }),
    ).toEqual({
      nextMode: "code",
      nextSyncedThreadId: "thread-2",
      shouldUpdateSelectedMode: true,
    });
  });

  it("ignores engines without thread-scoped collaboration mode", () => {
    expect(
      resolveThreadScopedCollaborationModeSync({
        activeEngine: "gemini",
        activeThreadId: "thread-1",
        mappedMode: "plan",
        selectedCollaborationModeId: "code",
        lastSyncedThreadId: null,
      }),
    ).toBeNull();
  });
});
