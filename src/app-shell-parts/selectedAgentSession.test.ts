import { describe, expect, it } from "vitest";
import {
  getThreadAgentSelectionStorageKey,
  normalizeSelectedAgentOption,
  parseStoredThreadAgentSelectionEntry,
  shouldApplyDraftAgentToThread,
  shouldMigrateSelectedAgentBetweenThreadIds,
} from "./selectedAgentSession";

describe("shouldApplyDraftAgentToThread", () => {
  const draftAgent = { id: "backend", name: "后端架构师", prompt: "focus backend" };

  it("returns true for first-send pending thread with draft agent", () => {
    expect(
      shouldApplyDraftAgentToThread({
        candidate: null,
        shouldApplyDraftToNextThread: true,
        draftSelectedAgent: draftAgent,
        activeThreadId: "claude-pending-123",
      }),
    ).toBe(true);
  });

  it("returns false when active thread is finalized", () => {
    expect(
      shouldApplyDraftAgentToThread({
        candidate: null,
        shouldApplyDraftToNextThread: true,
        draftSelectedAgent: draftAgent,
        activeThreadId: "claude:session-123",
      }),
    ).toBe(false);
  });

  it("returns false when candidate already exists", () => {
    expect(
      shouldApplyDraftAgentToThread({
        candidate: draftAgent,
        shouldApplyDraftToNextThread: true,
        draftSelectedAgent: draftAgent,
        activeThreadId: "claude-pending-123",
      }),
    ).toBe(false);
  });
});

describe("agent session persistence helpers", () => {
  it("normalizes stored agent options and resolves blank prompt to null", () => {
    expect(
      normalizeSelectedAgentOption({
        id: " backend ",
        name: " 后端架构师 ",
        prompt: "   ",
      }),
    ).toEqual({
      id: "backend",
      name: "后端架构师",
      prompt: null,
      icon: "agent-robot-02",
    });
  });

  it("parses missing and invalid stored entries safely", () => {
    expect(parseStoredThreadAgentSelectionEntry(undefined)).toEqual({
      exists: false,
      value: null,
    });
    expect(parseStoredThreadAgentSelectionEntry({ broken: true })).toEqual({
      exists: true,
      value: null,
    });
  });

  it("builds workspace-scoped agent selection storage keys", () => {
    expect(getThreadAgentSelectionStorageKey("ws-1", "claude:thread-1")).toBe(
      "composer.selectedAgentByThread.ws-1:claude:thread-1",
    );
    expect(getThreadAgentSelectionStorageKey(null, "claude:thread-1")).toBe(
      "composer.selectedAgentByThread.__workspace__unknown__:claude:thread-1",
    );
  });
});

describe("shouldMigrateSelectedAgentBetweenThreadIds", () => {
  const identity = (threadId: string) => threadId;

  it("migrates for pending to finalized rename", () => {
    expect(
      shouldMigrateSelectedAgentBetweenThreadIds({
        previousThreadId: "claude-pending-1",
        activeThreadId: "claude:session-1",
        previousSessionKey: "ws:claude-pending-1",
        activeSessionKey: "ws:claude:session-1",
        hasSourceSelection: true,
        hasTargetSelection: false,
        resolveCanonicalThreadId: identity,
      }),
    ).toBe(true);
  });

  it("does not migrate when target session key already has selection", () => {
    expect(
      shouldMigrateSelectedAgentBetweenThreadIds({
        previousThreadId: "claude-pending-1",
        activeThreadId: "claude:session-1",
        previousSessionKey: "ws:claude-pending-1",
        activeSessionKey: "ws:claude:session-1",
        hasSourceSelection: true,
        hasTargetSelection: true,
        resolveCanonicalThreadId: identity,
      }),
    ).toBe(false);
  });

  it("migrates when canonical ids match even without pending marker", () => {
    expect(
      shouldMigrateSelectedAgentBetweenThreadIds({
        previousThreadId: "claude:session-alias",
        activeThreadId: "claude:session-final",
        previousSessionKey: "ws:claude:session-alias",
        activeSessionKey: "ws:claude:session-final",
        hasSourceSelection: true,
        hasTargetSelection: false,
        resolveCanonicalThreadId: (threadId) =>
          threadId === "claude:session-alias" ? "claude:session-final" : threadId,
      }),
    ).toBe(true);
  });

  it("does not migrate when threads are unrelated", () => {
    expect(
      shouldMigrateSelectedAgentBetweenThreadIds({
        previousThreadId: "claude:session-1",
        activeThreadId: "gemini:session-2",
        previousSessionKey: "ws:claude:session-1",
        activeSessionKey: "ws:gemini:session-2",
        hasSourceSelection: true,
        hasTargetSelection: false,
        resolveCanonicalThreadId: identity,
      }),
    ).toBe(false);
  });

  it("does not migrate between two different pending threads of same engine", () => {
    expect(
      shouldMigrateSelectedAgentBetweenThreadIds({
        previousThreadId: "claude-pending-1",
        activeThreadId: "claude-pending-2",
        previousSessionKey: "ws:claude-pending-1",
        activeSessionKey: "ws:claude-pending-2",
        hasSourceSelection: true,
        hasTargetSelection: false,
        resolveCanonicalThreadId: identity,
      }),
    ).toBe(false);
  });

  it("does not migrate from finalized thread to unrelated pending thread", () => {
    expect(
      shouldMigrateSelectedAgentBetweenThreadIds({
        previousThreadId: "claude:session-1",
        activeThreadId: "claude-pending-new",
        previousSessionKey: "ws:claude:session-1",
        activeSessionKey: "ws:claude-pending-new",
        hasSourceSelection: true,
        hasTargetSelection: false,
        resolveCanonicalThreadId: identity,
      }),
    ).toBe(false);
  });

  it("does not migrate when previous session key is missing (workspace mismatch safety)", () => {
    expect(
      shouldMigrateSelectedAgentBetweenThreadIds({
        previousThreadId: "claude-pending-1",
        activeThreadId: "claude:session-1",
        previousSessionKey: "ws-b:claude-pending-1",
        activeSessionKey: "ws-b:claude:session-1",
        hasSourceSelection: false,
        hasTargetSelection: false,
        resolveCanonicalThreadId: identity,
      }),
    ).toBe(false);
  });

  it("migrates when source exists only in persisted storage (not yet in memory map)", () => {
    expect(
      shouldMigrateSelectedAgentBetweenThreadIds({
        previousThreadId: "claude-pending-1",
        activeThreadId: "claude:session-1",
        previousSessionKey: "ws:claude-pending-1",
        activeSessionKey: "ws:claude:session-1",
        hasSourceSelection: true,
        hasTargetSelection: false,
        resolveCanonicalThreadId: identity,
      }),
    ).toBe(true);
  });
});
