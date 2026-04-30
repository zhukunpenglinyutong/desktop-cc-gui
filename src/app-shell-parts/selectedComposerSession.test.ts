import { describe, expect, it } from "vitest";
import {
  getThreadComposerSelectionStorageKey,
  shouldApplyDraftComposerSelectionToThread,
  shouldMigrateComposerSelectionBetweenThreadIds,
  type ComposerSessionSelection,
} from "./selectedComposerSession";

describe("selectedComposerSession", () => {
  const identity = (threadId: string) => threadId;
  const draftSelection: ComposerSessionSelection = {
    modelId: "gpt-5.4",
    effort: "high",
  };

  it("builds a workspace-scoped session key for each thread", () => {
    expect(getThreadComposerSelectionStorageKey("ws-a", "codex:session-1")).toBe(
      "selectedModelByThread.ws-a:codex:session-1",
    );
    expect(getThreadComposerSelectionStorageKey("ws-b", "codex:session-1")).toBe(
      "selectedModelByThread.ws-b:codex:session-1",
    );
  });

  it("applies a draft selection to the first pending thread", () => {
    expect(
      shouldApplyDraftComposerSelectionToThread({
        candidate: null,
        shouldApplyDraftToNextThread: true,
        draftComposerSelection: draftSelection,
        activeThreadId: "codex-pending-1",
      }),
    ).toBe(true);
  });

  it("does not apply a draft selection to a finalized thread", () => {
    expect(
      shouldApplyDraftComposerSelectionToThread({
        candidate: null,
        shouldApplyDraftToNextThread: true,
        draftComposerSelection: draftSelection,
        activeThreadId: "codex:session-1",
      }),
    ).toBe(false);
  });

  it("migrates a persisted selection from pending to finalized thread ids", () => {
    expect(
      shouldMigrateComposerSelectionBetweenThreadIds({
        previousThreadId: "codex-pending-1",
        activeThreadId: "codex:session-1",
        previousSessionKey: "selectedModelByThread.ws-a:codex-pending-1",
        activeSessionKey: "selectedModelByThread.ws-a:codex:session-1",
        hasSourceSelection: true,
        hasTargetSelection: false,
        resolveCanonicalThreadId: identity,
      }),
    ).toBe(true);
  });

  it("does not migrate across unrelated threads or engines", () => {
    expect(
      shouldMigrateComposerSelectionBetweenThreadIds({
        previousThreadId: "codex:session-1",
        activeThreadId: "claude:session-2",
        previousSessionKey: "selectedModelByThread.ws-a:codex:session-1",
        activeSessionKey: "selectedModelByThread.ws-a:claude:session-2",
        hasSourceSelection: true,
        hasTargetSelection: false,
        resolveCanonicalThreadId: identity,
      }),
    ).toBe(false);
  });
});
