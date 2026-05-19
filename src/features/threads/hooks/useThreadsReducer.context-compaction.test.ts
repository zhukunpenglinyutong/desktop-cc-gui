import { describe, expect, it } from "vitest";
import type { ConversationItem } from "../../../types";
import { initialState, threadReducer } from "./useThreadsReducer";
import type { ThreadState } from "./useThreadsReducer";

describe("threadReducer context compaction lifecycle", () => {
  const sampleTokenUsage = {
    total: {
      inputTokens: 10,
      outputTokens: 0,
      cachedInputTokens: 0,
      totalTokens: 10,
      reasoningOutputTokens: 0,
    },
    last: {
      inputTokens: 10,
      outputTokens: 0,
      cachedInputTokens: 0,
      totalTokens: 10,
      reasoningOutputTokens: 0,
    },
    modelContextWindow: 200_000,
  } as const;

  it("appends a deduped context compacted message", () => {
    const withCompacted = threadReducer(initialState, {
      type: "appendContextCompacted",
      threadId: "thread-1",
      turnId: "turn-1",
    });
    const withDuplicate = threadReducer(withCompacted, {
      type: "appendContextCompacted",
      threadId: "thread-1",
      turnId: "turn-1",
    });

    const items = withDuplicate.itemsByThread["thread-1"] ?? [];
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("message");
    if (items[0]?.kind === "message") {
      expect(items[0].text).toBe("Context compacted.");
      expect(items[0].id).toBe("context-compacted-turn-1");
    }
  });

  it("tracks compaction timing for context compaction status", () => {
    const compacting = threadReducer(initialState, {
      type: "markContextCompacting",
      threadId: "thread-1",
      isCompacting: true,
      timestamp: 1_000,
    });
    const settled = threadReducer(compacting, {
      type: "markContextCompacting",
      threadId: "thread-1",
      isCompacting: false,
      timestamp: 2_500,
    });

    expect(compacting.threadStatusById["thread-1"]?.isContextCompacting).toBe(true);
    expect(compacting.threadStatusById["thread-1"]?.processingStartedAt).toBe(1_000);
    expect(settled.threadStatusById["thread-1"]?.isContextCompacting).toBe(false);
    expect(settled.threadStatusById["thread-1"]?.processingStartedAt).toBeNull();
    expect(settled.threadStatusById["thread-1"]?.lastDurationMs).toBe(1_500);
  });

  it("preserves compaction source through completion and clears completed lifecycle after token refresh", () => {
    const compacting = threadReducer(initialState, {
      type: "markContextCompacting",
      threadId: "thread-1",
      isCompacting: true,
      timestamp: 1_000,
      source: "auto",
    });
    const completed = threadReducer(compacting, {
      type: "markContextCompacting",
      threadId: "thread-1",
      isCompacting: false,
      timestamp: 1_500,
      completionStatus: "completed",
    });
    const refreshed = threadReducer(completed, {
      type: "setThreadTokenUsage",
      threadId: "thread-1",
      tokenUsage: sampleTokenUsage,
    });

    expect(compacting.threadStatusById["thread-1"]?.codexCompactionSource).toBe("auto");
    expect(
      completed.threadStatusById["thread-1"]?.codexCompactionLifecycleState,
    ).toBe("completed");
    expect(completed.threadStatusById["thread-1"]?.codexCompactionSource).toBe("auto");
    expect(refreshed.threadStatusById["thread-1"]?.codexCompactionLifecycleState).toBe("idle");
    expect(refreshed.threadStatusById["thread-1"]?.codexCompactionSource).toBeNull();
  });

  it("does not carry the previous compaction source into a new lifecycle start when source flags are absent", () => {
    const completed = threadReducer(initialState, {
      type: "markContextCompacting",
      threadId: "thread-1",
      isCompacting: false,
      timestamp: 1_500,
      completionStatus: "completed",
      source: "auto",
    });

    const restarted = threadReducer(completed, {
      type: "markContextCompacting",
      threadId: "thread-1",
      isCompacting: true,
      timestamp: 2_000,
    });

    expect(restarted.threadStatusById["thread-1"]?.codexCompactionLifecycleState).toBe(
      "compacting",
    );
    expect(restarted.threadStatusById["thread-1"]?.codexCompactionSource).toBeNull();
  });

  it("preserves the previous compaction source only when a completion event omits flags", () => {
    const compacting = threadReducer(initialState, {
      type: "markContextCompacting",
      threadId: "thread-1",
      isCompacting: true,
      timestamp: 1_000,
      source: "manual",
    });

    const completed = threadReducer(compacting, {
      type: "markContextCompacting",
      threadId: "thread-1",
      isCompacting: false,
      timestamp: 1_500,
      completionStatus: "completed",
    });
    const repeatedCompleted = threadReducer(completed, {
      type: "markContextCompacting",
      threadId: "thread-1",
      isCompacting: false,
      timestamp: 1_600,
      completionStatus: "completed",
    });

    expect(completed.threadStatusById["thread-1"]?.codexCompactionLifecycleState).toBe(
      "completed",
    );
    expect(completed.threadStatusById["thread-1"]?.codexCompactionSource).toBe(
      "manual",
    );
    expect(repeatedCompleted.threadStatusById["thread-1"]?.codexCompactionSource).toBe(
      "manual",
    );
  });

  it("keeps completed compaction lifecycle visible across generic turn settlement until usage refresh arrives", () => {
    const completed = threadReducer(initialState, {
      type: "markContextCompacting",
      threadId: "thread-1",
      isCompacting: false,
      timestamp: 1_500,
      completionStatus: "completed",
      source: "auto",
    });

    const settledTurn = threadReducer(completed, {
      type: "markContextCompacting",
      threadId: "thread-1",
      isCompacting: false,
      timestamp: 1_800,
    });

    expect(settledTurn.threadStatusById["thread-1"]?.codexCompactionLifecycleState).toBe(
      "completed",
    );
    expect(settledTurn.threadStatusById["thread-1"]?.codexCompactionSource).toBe(
      "auto",
    );
  });

  it("applies compaction metadata updates even when the compacting flag itself is unchanged", () => {
    const completed = threadReducer(initialState, {
      type: "markContextCompacting",
      threadId: "thread-1",
      isCompacting: false,
      timestamp: 1_500,
      completionStatus: "completed",
      source: "auto",
    });

    expect(completed.threadStatusById["thread-1"]?.isContextCompacting).toBe(false);
    expect(
      completed.threadStatusById["thread-1"]?.codexCompactionLifecycleState,
    ).toBe("completed");
    expect(completed.threadStatusById["thread-1"]?.codexCompactionSource).toBe("auto");

    const sourcePatched = threadReducer(
      {
        ...initialState,
        threadStatusById: {
          "thread-2": {
            isProcessing: false,
            hasUnread: false,
            isReviewing: false,
            isContextCompacting: true,
            processingStartedAt: 1_000,
            lastDurationMs: null,
            heartbeatPulse: 0,
            continuationPulse: 0,
            terminalPulse: 0,
            codexCompactionSource: null,
            codexCompactionLifecycleState: "compacting",
            codexCompactionCompletedAt: null,
            lastTokenUsageUpdatedAt: null,
          },
        },
      },
      {
        type: "markContextCompacting",
        threadId: "thread-2",
        isCompacting: true,
        timestamp: 1_100,
        source: "manual",
      },
    );

    expect(sourcePatched.threadStatusById["thread-2"]?.codexCompactionSource).toBe(
      "manual",
    );
    expect(
      sourcePatched.threadStatusById["thread-2"]?.codexCompactionLifecycleState,
    ).toBe("compacting");
  });

  it("keeps completed lifecycle visible when token usage refresh repeats the previous snapshot", () => {
    const base: ThreadState = {
      ...initialState,
      tokenUsageByThread: {
        "thread-1": sampleTokenUsage,
      },
      threadStatusById: {
        "thread-1": {
          isProcessing: false,
          hasUnread: false,
          isReviewing: false,
          isContextCompacting: false,
          processingStartedAt: null,
          lastDurationMs: null,
          heartbeatPulse: 0,
          continuationPulse: 0,
          terminalPulse: 0,
          codexCompactionSource: "auto",
          codexCompactionLifecycleState: "completed",
          codexCompactionCompletedAt: 2_000,
          lastTokenUsageUpdatedAt: 1_000,
        },
      },
    };

    const next = threadReducer(base, {
      type: "setThreadTokenUsage",
      threadId: "thread-1",
      tokenUsage: {
        ...sampleTokenUsage,
        total: { ...sampleTokenUsage.total },
        last: { ...sampleTokenUsage.last },
      },
    });

    expect(next).toBe(base);
    expect(next.threadStatusById["thread-1"]?.codexCompactionLifecycleState).toBe(
      "completed",
    );
    expect(next.threadStatusById["thread-1"]?.lastTokenUsageUpdatedAt).toBe(1_000);
  });

  it("preserves only the latest local Codex compaction message while compaction lifecycle is still active", () => {
    const base: ThreadState = {
      ...initialState,
      itemsByThread: {
        "thread-1": [
          {
            id: "context-compacted-codex-compact-thread-1-old",
            kind: "message",
            role: "assistant",
            text: "old compaction",
            engineSource: "codex",
          },
          {
            id: "context-compacted-codex-compact-thread-1-latest",
            kind: "message",
            role: "assistant",
            text: "latest compaction",
            engineSource: "codex",
          },
        ],
      },
      threadStatusById: {
        "thread-1": {
          isProcessing: false,
          hasUnread: false,
          isReviewing: false,
          isContextCompacting: false,
          processingStartedAt: null,
          lastDurationMs: null,
          heartbeatPulse: 0,
          continuationPulse: 0,
          terminalPulse: 0,
          codexCompactionSource: "auto",
          codexCompactionLifecycleState: "completed",
          codexCompactionCompletedAt: 2_000,
          lastTokenUsageUpdatedAt: 1_000,
        },
      },
    };

    const next = threadReducer(base, {
      type: "setThreadItems",
      threadId: "thread-1",
      items: [
        {
          id: "assistant-history-1",
          kind: "message",
          role: "assistant",
          text: "history body",
        },
      ],
    });

    expect(next.itemsByThread["thread-1"]).toEqual([
      {
        id: "context-compacted-codex-compact-thread-1-latest",
        kind: "message",
        role: "assistant",
        text: "latest compaction",
        engineSource: "codex",
      },
      {
        id: "assistant-history-1",
        kind: "message",
        role: "assistant",
        text: "history body",
      },
    ]);
  });

  it("drops local Codex compaction messages from history reconcile once the lifecycle has returned to idle", () => {
    const base: ThreadState = {
      ...initialState,
      itemsByThread: {
        "thread-1": [
          {
            id: "context-compacted-codex-compact-thread-1-latest",
            kind: "message",
            role: "assistant",
            text: "latest compaction",
            engineSource: "codex",
          },
        ],
      },
      threadStatusById: {
        "thread-1": {
          isProcessing: false,
          hasUnread: false,
          isReviewing: false,
          isContextCompacting: false,
          processingStartedAt: null,
          lastDurationMs: null,
          heartbeatPulse: 0,
          continuationPulse: 0,
          terminalPulse: 0,
          codexCompactionSource: null,
          codexCompactionLifecycleState: "idle",
          codexCompactionCompletedAt: null,
          lastTokenUsageUpdatedAt: 2_500,
        },
      },
    };

    const next = threadReducer(base, {
      type: "setThreadItems",
      threadId: "thread-1",
      items: [
        {
          id: "assistant-history-1",
          kind: "message",
          role: "assistant",
          text: "history body",
        },
      ],
    });

    expect(next.itemsByThread["thread-1"]).toEqual([
      {
        id: "assistant-history-1",
        kind: "message",
        role: "assistant",
        text: "history body",
      },
    ]);
  });

  it("ignores tool output deltas when the item is not a tool", () => {
    const message: ConversationItem = {
      id: "tool-1",
      kind: "message",
      role: "assistant",
      text: "Hi",
    };
    const base: ThreadState = {
      ...initialState,
      itemsByThread: { "thread-1": [message] },
    };
    const next = threadReducer(base, {
      type: "appendToolOutput",
      threadId: "thread-1",
      itemId: "tool-1",
      delta: "delta",
    });
    expect(next).toBe(base);
  });
});
