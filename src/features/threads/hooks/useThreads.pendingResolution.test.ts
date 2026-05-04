import { describe, expect, it } from "vitest";
import {
  resolvePendingThreadIdForSession,
  resolvePendingThreadIdForTurn,
} from "../utils/threadPendingResolution";

describe("resolvePendingThreadIdForSession", () => {
  const workspaceId = "ws-1";

  it("prefers active pending thread when only active thread can disambiguate", () => {
    const resolved = resolvePendingThreadIdForSession({
      workspaceId,
      engine: "opencode",
      threadsByWorkspace: {
        "ws-1": [{ id: "opencode-pending-a" }, { id: "opencode-pending-b" }],
      },
      activeThreadIdByWorkspace: { "ws-1": "opencode-pending-b" },
      threadStatusById: {
        "opencode-pending-b": { isProcessing: true },
      },
      activeTurnIdByThread: {},
      itemsByThread: {
        "opencode-pending-b": [{ id: "local-1" }],
      },
    });

    expect(resolved).toBe("opencode-pending-b");
  });

  it("does not resolve by processing state alone without turn/content anchor", () => {
    const resolved = resolvePendingThreadIdForSession({
      workspaceId,
      engine: "opencode",
      threadsByWorkspace: {
        "ws-1": [{ id: "opencode-pending-a" }, { id: "opencode-pending-b" }],
      },
      activeThreadIdByWorkspace: { "ws-1": "thread-neutral" },
      threadStatusById: {
        "opencode-pending-b": { isProcessing: true },
      },
      activeTurnIdByThread: {},
      itemsByThread: {},
    });

    expect(resolved).toBeNull();
  });

  it("prefers active pending thread with activity over another processing pending thread", () => {
    const resolved = resolvePendingThreadIdForSession({
      workspaceId,
      engine: "claude",
      threadsByWorkspace: {
        "ws-1": [{ id: "claude-pending-old" }, { id: "claude-pending-new" }],
      },
      activeThreadIdByWorkspace: { "ws-1": "claude-pending-new" },
      threadStatusById: {
        "claude-pending-old": { isProcessing: true },
        "claude-pending-new": { isProcessing: true },
      },
      activeTurnIdByThread: {},
      itemsByThread: {
        "claude-pending-new": [{ id: "user-1" }],
      },
    });

    expect(resolved).toBe("claude-pending-new");
  });

  it("falls back to single turn-bound pending thread", () => {
    const resolved = resolvePendingThreadIdForSession({
      workspaceId,
      engine: "opencode",
      threadsByWorkspace: {
        "ws-1": [{ id: "opencode-pending-a" }, { id: "opencode-pending-b" }],
      },
      activeThreadIdByWorkspace: { "ws-1": "thread-neutral" },
      threadStatusById: {},
      activeTurnIdByThread: {
        "opencode-pending-a": "turn-1",
      },
      itemsByThread: {},
    });

    expect(resolved).toBe("opencode-pending-a");
  });

  it("returns single pending thread with observed content", () => {
    const resolved = resolvePendingThreadIdForSession({
      workspaceId,
      engine: "claude",
      threadsByWorkspace: {
        "ws-1": [{ id: "claude-pending-a" }],
      },
      activeThreadIdByWorkspace: { "ws-1": "thread-neutral" },
      threadStatusById: {
        "claude-pending-a": { isProcessing: true },
      },
      activeTurnIdByThread: {},
      itemsByThread: {
        "claude-pending-a": [{ id: "assistant-1" }],
      },
    });

    expect(resolved).toBe("claude-pending-a");
  });

  it("does not resolve stale pending thread from historical reasoning-only content", () => {
    const resolved = resolvePendingThreadIdForSession({
      workspaceId,
      engine: "claude",
      threadsByWorkspace: {
        "ws-1": [{ id: "claude-pending-stale" }],
      },
      activeThreadIdByWorkspace: { "ws-1": "thread-neutral" },
      threadStatusById: {
        "claude-pending-stale": { isProcessing: false },
      },
      activeTurnIdByThread: {},
      itemsByThread: {
        "claude-pending-stale": [
          { id: "reasoning-1", kind: "reasoning", summary: "old", content: "old" },
        ],
      },
    });

    expect(resolved).toBeNull();
  });

  it("does not resolve single idle pending thread without any activity", () => {
    const resolved = resolvePendingThreadIdForSession({
      workspaceId,
      engine: "claude",
      threadsByWorkspace: {
        "ws-1": [{ id: "claude-pending-a" }],
      },
      activeThreadIdByWorkspace: { "ws-1": "claude-pending-a" },
      threadStatusById: {},
      activeTurnIdByThread: {},
      itemsByThread: {},
    });

    expect(resolved).toBeNull();
  });

  it("does not treat a blank active turn id as a pending anchor", () => {
    const resolved = resolvePendingThreadIdForSession({
      workspaceId,
      engine: "claude",
      threadsByWorkspace: {
        "ws-1": [{ id: "claude-pending-a" }],
      },
      activeThreadIdByWorkspace: { "ws-1": "claude-pending-a" },
      threadStatusById: {},
      activeTurnIdByThread: {
        "claude-pending-a": "   ",
      },
      itemsByThread: {},
    });

    expect(resolved).toBeNull();
  });

  it("returns null for ambiguous pending candidates without active/timestamp hints", () => {
    const resolved = resolvePendingThreadIdForSession({
      workspaceId,
      engine: "opencode",
      threadsByWorkspace: {
        "ws-1": [{ id: "opencode-pending-a" }, { id: "opencode-pending-b" }],
      },
      activeThreadIdByWorkspace: { "ws-1": "thread-neutral" },
      threadStatusById: {},
      activeTurnIdByThread: {},
      itemsByThread: {},
    });

    expect(resolved).toBeNull();
  });

  it("does not guess latest pending timestamp when ambiguous and idle", () => {
    const resolved = resolvePendingThreadIdForSession({
      workspaceId,
      engine: "opencode",
      threadsByWorkspace: {
        "ws-1": [
          { id: "opencode-pending-1700000000001-aaaaaa" },
          { id: "opencode-pending-1700000000002-bbbbbb" },
        ],
      },
      activeThreadIdByWorkspace: { "ws-1": "thread-neutral" },
      threadStatusById: {},
      activeTurnIdByThread: {},
      itemsByThread: {},
    });

    expect(resolved).toBeNull();
  });
});

describe("resolvePendingThreadIdForTurn", () => {
  const workspaceId = "ws-1";

  it("returns the exact pending thread whose active turn matches", () => {
    const resolved = resolvePendingThreadIdForTurn({
      workspaceId,
      engine: "claude",
      turnId: "turn-target",
      threadsByWorkspace: {
        "ws-1": [{ id: "claude-pending-a" }, { id: "claude-pending-b" }],
      },
      activeThreadIdByWorkspace: { "ws-1": "claude-pending-b" },
      activeTurnIdByThread: {
        "claude-pending-a": "turn-target",
        "claude-pending-b": "turn-other",
      },
    });

    expect(resolved).toBe("claude-pending-a");
  });

  it("falls back to active pending thread when multiple pending threads share the same turn", () => {
    const resolved = resolvePendingThreadIdForTurn({
      workspaceId,
      engine: "claude",
      turnId: "turn-shared",
      threadsByWorkspace: {
        "ws-1": [{ id: "claude-pending-a" }, { id: "claude-pending-b" }],
      },
      activeThreadIdByWorkspace: { "ws-1": "claude-pending-b" },
      activeTurnIdByThread: {
        "claude-pending-a": "turn-shared",
        "claude-pending-b": "turn-shared",
      },
    });

    expect(resolved).toBe("claude-pending-b");
  });

  it("returns null when turn id is missing", () => {
    const resolved = resolvePendingThreadIdForTurn({
      workspaceId,
      engine: "claude",
      turnId: null,
      threadsByWorkspace: {
        "ws-1": [{ id: "claude-pending-a" }],
      },
      activeThreadIdByWorkspace: { "ws-1": "claude-pending-a" },
      activeTurnIdByThread: {
        "claude-pending-a": "turn-1",
      },
    });

    expect(resolved).toBeNull();
  });

  it("normalizes stored active turn ids before matching", () => {
    const resolved = resolvePendingThreadIdForTurn({
      workspaceId,
      engine: "claude",
      turnId: "turn-target",
      threadsByWorkspace: {
        "ws-1": [{ id: "claude-pending-a" }],
      },
      activeThreadIdByWorkspace: { "ws-1": "claude-pending-a" },
      activeTurnIdByThread: {
        "claude-pending-a": "  turn-target  ",
      },
    });

    expect(resolved).toBe("claude-pending-a");
  });
});
