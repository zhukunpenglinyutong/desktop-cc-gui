import { describe, expect, it, vi } from "vitest";
import { initialState, threadReducer } from "./useThreadsReducer";

describe("threadReducer compaction lifecycle", () => {
  it("appends a fresh Codex compaction message for a new trigger and deduplicates adjacent repeats", () => {
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy
      .mockReturnValueOnce(1_111)
      .mockReturnValueOnce(2_222);
    const compacting = threadReducer(initialState, {
      type: "appendCodexCompactionMessage",
      threadId: "thread-1",
      text: "Codex 正在压缩背景信息",
    });
    const duplicate = threadReducer(compacting, {
      type: "appendCodexCompactionMessage",
      threadId: "thread-1",
      text: "Codex 正在压缩背景信息",
    });
    const interveningMessage = threadReducer(duplicate, {
      type: "appendContextCompacted",
      threadId: "thread-1",
      turnId: "turn-1",
    });
    const secondTrigger = threadReducer(interveningMessage, {
      type: "appendCodexCompactionMessage",
      threadId: "thread-1",
      text: "Codex 正在压缩背景信息",
    });

    const items = secondTrigger.itemsByThread["thread-1"] ?? [];
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      id: "context-compacted-codex-compact-thread-1-1111",
      kind: "message",
      role: "assistant",
      text: "Codex 正在压缩背景信息",
      engineSource: "codex",
    });
    expect(items[2]).toMatchObject({
      id: "context-compacted-codex-compact-thread-1-2222",
      kind: "message",
      role: "assistant",
      text: "Codex 正在压缩背景信息",
      engineSource: "codex",
    });

    nowSpy.mockRestore();
  });

  it("settles the latest Codex compaction message in place", () => {
    const compacting = threadReducer(initialState, {
      type: "appendCodexCompactionMessage",
      threadId: "thread-1",
      text: "Codex 正在压缩背景信息",
    });
    const compacted = threadReducer(compacting, {
      type: "settleCodexCompactionMessage",
      threadId: "thread-1",
      text: "Codex 已压缩背景信息",
    });
    const duplicate = threadReducer(compacted, {
      type: "settleCodexCompactionMessage",
      threadId: "thread-1",
      text: "Codex 已压缩背景信息",
    });

    const items = duplicate.itemsByThread["thread-1"] ?? [];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "message",
      role: "assistant",
      text: "Codex 已压缩背景信息",
      engineSource: "codex",
    });
    expect(items[0]?.id).toMatch(/^context-compacted-codex-compact-thread-1-/);
  });

  it("appends one completed fallback per completion-only Codex lifecycle", () => {
    const firstCompleted = threadReducer(initialState, {
      type: "settleCodexCompactionMessage",
      threadId: "thread-1",
      text: "Codex 已压缩背景信息",
      fallbackMessageId: "context-compacted-codex-compact-thread-1-completed-turn-1",
      appendIfAlreadyCompleted: true,
    });
    const duplicateFirstCompleted = threadReducer(firstCompleted, {
      type: "settleCodexCompactionMessage",
      threadId: "thread-1",
      text: "Codex 已压缩背景信息",
      fallbackMessageId: "context-compacted-codex-compact-thread-1-completed-turn-1",
      appendIfAlreadyCompleted: true,
    });
    const secondCompleted = threadReducer(duplicateFirstCompleted, {
      type: "settleCodexCompactionMessage",
      threadId: "thread-1",
      text: "Codex 已压缩背景信息",
      fallbackMessageId: "context-compacted-codex-compact-thread-1-completed-turn-2",
      appendIfAlreadyCompleted: true,
    });

    expect(secondCompleted.itemsByThread["thread-1"]).toEqual([
      {
        id: "context-compacted-codex-compact-thread-1-completed-turn-1",
        kind: "message",
        role: "assistant",
        text: "Codex 已压缩背景信息",
        engineSource: "codex",
      },
      {
        id: "context-compacted-codex-compact-thread-1-completed-turn-2",
        kind: "message",
        role: "assistant",
        text: "Codex 已压缩背景信息",
        engineSource: "codex",
      },
    ]);
  });

  it("does not settle an older started message when a completion-only fallback arrives", () => {
    const withStarted = threadReducer(initialState, {
      type: "appendCodexCompactionMessage",
      threadId: "thread-1",
      text: "Codex 正在压缩背景信息",
    });
    const withCompletionFallback = threadReducer(withStarted, {
      type: "settleCodexCompactionMessage",
      threadId: "thread-1",
      text: "Codex 已压缩背景信息",
      fallbackMessageId: "context-compacted-codex-compact-thread-1-completed-turn-2",
      appendIfAlreadyCompleted: true,
    });

    expect(withCompletionFallback.itemsByThread["thread-1"]).toEqual([
      expect.objectContaining({
        kind: "message",
        role: "assistant",
        text: "Codex 正在压缩背景信息",
        engineSource: "codex",
      }),
      {
        id: "context-compacted-codex-compact-thread-1-completed-turn-2",
        kind: "message",
        role: "assistant",
        text: "Codex 已压缩背景信息",
        engineSource: "codex",
      },
    ]);
  });

  it("discards the latest started Codex compaction message on rollback", () => {
    const withStarted = threadReducer(initialState, {
      type: "appendCodexCompactionMessage",
      threadId: "thread-1",
      text: "Codex 正在压缩背景信息",
    });
    const rolledBack = threadReducer(withStarted, {
      type: "discardLatestCodexCompactionMessage",
      threadId: "thread-1",
      text: "Codex 正在压缩背景信息",
    });

    expect(rolledBack.itemsByThread["thread-1"]).toEqual([]);
  });
});
