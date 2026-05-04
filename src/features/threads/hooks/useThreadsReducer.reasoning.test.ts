import { describe, expect, it } from "vitest";
import {
  __getPrepareThreadItemsCallCountForTests,
  __resetPrepareThreadItemsCallCountForTests,
} from "../../../utils/threadItems";
import { initialState, threadReducer } from "./useThreadsReducer";
import type { ThreadState } from "./useThreadsReducer";

describe("threadReducer reasoning", () => {
  it("appends reasoning summary and content when missing", () => {
    const withSummary = threadReducer(initialState, {
      type: "appendReasoningSummary",
      threadId: "thread-1",
      itemId: "reasoning-1",
      delta: "Short plan",
    });
    const summaryItem = withSummary.itemsByThread["thread-1"]?.[0];
    expect(summaryItem?.kind).toBe("reasoning");
    if (summaryItem?.kind === "reasoning") {
      expect(summaryItem.summary).toBe("Short plan");
      expect(summaryItem.content).toBe("");
    }

    const withContent = threadReducer(withSummary, {
      type: "appendReasoningContent",
      threadId: "thread-1",
      itemId: "reasoning-1",
      delta: "More detail",
    });
    const contentItem = withContent.itemsByThread["thread-1"]?.[0];
    expect(contentItem?.kind).toBe("reasoning");
    if (contentItem?.kind === "reasoning") {
      expect(contentItem.summary).toBe("Short plan");
      expect(contentItem.content).toBe("More detail");
    }
  });

  it("keeps assistant message when reasoning deltas reuse the same item id", () => {
    const withAssistant = threadReducer(initialState, {
      type: "appendAgentDelta",
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId: "shared-1",
      delta: "正文起始",
      hasCustomName: false,
    });
    const withReasoning = threadReducer(withAssistant, {
      type: "appendReasoningContent",
      threadId: "thread-1",
      itemId: "shared-1",
      delta: "思考片段",
    });
    const withAssistantContinue = threadReducer(withReasoning, {
      type: "appendAgentDelta",
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId: "shared-1",
      delta: "继续输出",
      hasCustomName: false,
    });

    const items = withAssistantContinue.itemsByThread["thread-1"] ?? [];
    const assistant = items.find(
      (item) => item.kind === "message" && item.id === "shared-1",
    );
    const reasoning = items.find(
      (item) => item.kind === "reasoning" && item.id === "shared-1",
    );

    expect(assistant?.kind).toBe("message");
    if (assistant?.kind === "message") {
      expect(assistant.text).toBe("正文起始继续输出");
    }
    expect(reasoning?.kind).toBe("reasoning");
    if (reasoning?.kind === "reasoning") {
      expect(reasoning.content).toBe("思考片段");
    }
    expect(items.filter((item) => item.id === "shared-1")).toHaveLength(2);
  });

  it("ignores claude reasoning deltas when the thread has no active turn", () => {
    const next = threadReducer(initialState, {
      type: "appendReasoningContent",
      threadId: "claude:session-a",
      itemId: "reasoning-ignored-1",
      delta: "stale delta",
    });
    expect(next.itemsByThread["claude:session-a"]).toBeUndefined();
  });

  it("accepts gemini reasoning deltas even after processing settles", () => {
    const settledState: ThreadState = {
      ...initialState,
      threadStatusById: {
        "gemini:session-a": {
          isProcessing: false,
          hasUnread: false,
          isReviewing: false,
          isContextCompacting: false,
          processingStartedAt: null,
          lastDurationMs: null,
          heartbeatPulse: 0,
        },
      },
      activeTurnIdByThread: {
        "gemini:session-a": null,
      },
    };

    const next = threadReducer(settledState, {
      type: "appendReasoningContent",
      threadId: "gemini:session-a",
      itemId: "reasoning-late-1",
      delta: "late reasoning from fallback",
    });

    const item = next.itemsByThread["gemini:session-a"]?.[0];
    expect(item?.kind).toBe("reasoning");
    if (item?.kind === "reasoning") {
      expect(item.id).toBe("reasoning-late-1");
      expect(item.content).toBe("late reasoning from fallback");
    }
  });

  it("inserts late gemini reasoning before the latest assistant answer", () => {
    const settledState: ThreadState = {
      ...initialState,
      itemsByThread: {
        "gemini:session-order": [
          {
            id: "user-1",
            kind: "message",
            role: "user",
            text: "这个网站是什么",
          },
          {
            id: "assistant-1",
            kind: "message",
            role: "assistant",
            text: "这是一个本地项目目录。",
          },
        ],
      },
      threadStatusById: {
        "gemini:session-order": {
          isProcessing: false,
          hasUnread: false,
          isReviewing: false,
          isContextCompacting: false,
          processingStartedAt: null,
          lastDurationMs: 980,
          heartbeatPulse: 0,
        },
      },
      activeTurnIdByThread: {
        "gemini:session-order": null,
      },
    };

    const next = threadReducer(settledState, {
      type: "appendReasoningContent",
      threadId: "gemini:session-order",
      itemId: "reasoning-late-order-1",
      delta: "先确认目录结构，再给出解释。",
    });

    const items = next.itemsByThread["gemini:session-order"] ?? [];
    expect(items).toHaveLength(3);
    expect(items[0]?.id).toBe("user-1");
    expect(items[1]?.kind).toBe("reasoning");
    if (items[1]?.kind === "reasoning") {
      expect(items[1].id).toBe("reasoning-late-order-1");
      expect(items[1].content).toBe("先确认目录结构，再给出解释。");
    }
    expect(items[2]?.kind).toBe("message");
    if (items[2]?.kind === "message") {
      expect(items[2].role).toBe("assistant");
      expect(items[2].id).toBe("assistant-1");
    }
  });

  it("keeps gemini reasoning in arrival order while the turn is still active", () => {
    const liveState: ThreadState = {
      ...initialState,
      itemsByThread: {
        "gemini:session-live-order": [
          {
            id: "user-1",
            kind: "message",
            role: "user",
            text: "继续",
          },
          {
            id: "assistant-1",
            kind: "message",
            role: "assistant",
            text: "先看目录",
          },
        ],
      },
      threadStatusById: {
        "gemini:session-live-order": {
          isProcessing: false,
          hasUnread: false,
          isReviewing: false,
          isContextCompacting: false,
          processingStartedAt: null,
          lastDurationMs: null,
          heartbeatPulse: 1,
        },
      },
      activeTurnIdByThread: {
        "gemini:session-live-order": "gemini-turn-live-1",
      },
    };

    const next = threadReducer(liveState, {
      type: "appendReasoningContent",
      threadId: "gemini:session-live-order",
      itemId: "reasoning-live-order-1",
      delta: "先确认项目结构，再继续回复。",
    });

    const items = next.itemsByThread["gemini:session-live-order"] ?? [];
    expect(items).toHaveLength(3);
    expect(items[0]?.id).toBe("user-1");
    expect(items[1]?.id).toBe("assistant-1");
    expect(items[2]?.kind).toBe("reasoning");
    if (items[2]?.kind === "reasoning") {
      expect(items[2].id).toBe("reasoning-live-order-1");
      expect(items[2].content).toBe("先确认项目结构，再继续回复。");
    }
  });

  it("treats gemini reasoning updates as snapshots to avoid cumulative duplicate walls", () => {
    const threadId = "gemini:session-snapshot-merge";
    const liveState: ThreadState = {
      ...initialState,
      threadStatusById: {
        [threadId]: {
          isProcessing: true,
          hasUnread: false,
          isReviewing: false,
          isContextCompacting: false,
          processingStartedAt: Date.now(),
          lastDurationMs: null,
          heartbeatPulse: 1,
        },
      },
      activeTurnIdByThread: {
        [threadId]: "gemini-turn-snapshot-1",
      },
    };
    const snapshot1 = "Investigating composer conditions for Gemini.";
    const snapshot2 = `${snapshot1} Verifying status panel and live controls visibility.`;

    const withFirst = threadReducer(liveState, {
      type: "appendReasoningContent",
      threadId,
      itemId: "reasoning-gemini-snapshot-1",
      delta: snapshot1,
    });
    const withSecond = threadReducer(withFirst, {
      type: "appendReasoningContent",
      threadId,
      itemId: "reasoning-gemini-snapshot-1",
      delta: snapshot2,
    });

    const item = withSecond.itemsByThread[threadId]?.find(
      (entry) => entry.kind === "reasoning",
    );
    expect(item?.kind).toBe("reasoning");
    if (item?.kind === "reasoning") {
      expect(item.content).toBe(snapshot2);
      expect(item.content).not.toBe(`${snapshot1}${snapshot2}`);
    }
  });

  it("keeps gemini incremental reasoning deltas append-only when not snapshot-like", () => {
    const threadId = "gemini:session-incremental-merge";
    const liveState: ThreadState = {
      ...initialState,
      threadStatusById: {
        [threadId]: {
          isProcessing: true,
          hasUnread: false,
          isReviewing: false,
          isContextCompacting: false,
          processingStartedAt: Date.now(),
          lastDurationMs: null,
          heartbeatPulse: 1,
        },
      },
      activeTurnIdByThread: {
        [threadId]: "gemini-turn-incremental-1",
      },
    };

    const withFirst = threadReducer(liveState, {
      type: "appendReasoningContent",
      threadId,
      itemId: "reasoning-gemini-incremental-1",
      delta: "先读取目录",
    });
    const withSecond = threadReducer(withFirst, {
      type: "appendReasoningContent",
      threadId,
      itemId: "reasoning-gemini-incremental-1",
      delta: "，再检查配置。",
    });

    const item = withSecond.itemsByThread[threadId]?.find(
      (entry) => entry.kind === "reasoning",
    );
    expect(item?.kind).toBe("reasoning");
    if (item?.kind === "reasoning") {
      expect(item.content).toBe("先读取目录，再检查配置。");
      expect(item.content).not.toContain("\n\n");
    }
  });

  it("uses a fast path for repeated same-item reasoning content deltas", () => {
    const threadId = "gemini:session-reasoning-fast-path";
    const liveState: ThreadState = {
      ...initialState,
      itemsByThread: {
        [threadId]: [
          {
            id: "reasoning-fast-1",
            kind: "reasoning",
            summary: "",
            content: "先读取目录",
          },
        ],
      },
      threadStatusById: {
        [threadId]: {
          isProcessing: true,
          hasUnread: false,
          isReviewing: false,
          isContextCompacting: false,
          processingStartedAt: Date.now(),
          lastDurationMs: null,
          heartbeatPulse: 1,
        },
      },
      activeTurnIdByThread: {
        [threadId]: "gemini-turn-fast-path",
      },
    };

    __resetPrepareThreadItemsCallCountForTests();
    const next = threadReducer(liveState, {
      type: "appendReasoningContent",
      threadId,
      itemId: "reasoning-fast-1",
      delta: "，再检查配置。",
    });

    expect(__getPrepareThreadItemsCallCountForTests()).toBe(0);
    const items = next.itemsByThread[threadId] ?? [];
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("reasoning");
    if (items[0]?.kind === "reasoning") {
      expect(items[0].content).toBe("先读取目录，再检查配置。");
    }
  });

  it("keeps canonical derivation for new reasoning item insertion", () => {
    const threadId = "gemini:session-reasoning-insert-canonical";
    const liveState: ThreadState = {
      ...initialState,
      threadStatusById: {
        [threadId]: {
          isProcessing: true,
          hasUnread: false,
          isReviewing: false,
          isContextCompacting: false,
          processingStartedAt: Date.now(),
          lastDurationMs: null,
          heartbeatPulse: 1,
        },
      },
      activeTurnIdByThread: {
        [threadId]: "gemini-turn-insert-canonical",
      },
    };

    __resetPrepareThreadItemsCallCountForTests();
    const next = threadReducer(liveState, {
      type: "appendReasoningContent",
      threadId,
      itemId: "reasoning-new-1",
      delta: "新 reasoning 仍需 canonical normalize",
    });

    expect(__getPrepareThreadItemsCallCountForTests()).toBe(1);
    expect(next.itemsByThread[threadId]?.[0]?.kind).toBe("reasoning");
  });

  it("accepts claude reasoning deltas while processing", () => {
    const processingState: ThreadState = {
      ...initialState,
      threadStatusById: {
        "claude:session-b": {
          isProcessing: true,
          hasUnread: false,
          isReviewing: false,
          isContextCompacting: false,
          processingStartedAt: Date.now(),
          lastDurationMs: null,
          heartbeatPulse: 0,
        },
      },
    };
    const next = threadReducer(processingState, {
      type: "appendReasoningContent",
      threadId: "claude:session-b",
      itemId: "reasoning-live-1",
      delta: "live delta",
    });
    const item = next.itemsByThread["claude:session-b"]?.[0];
    expect(item?.kind).toBe("reasoning");
  });

  it("appends claude reasoning deltas without replacing same-position content", () => {
    const threadId = "claude:session-append-only";
    const processingState: ThreadState = {
      ...initialState,
      threadStatusById: {
        [threadId]: {
          isProcessing: true,
          hasUnread: false,
          isReviewing: false,
          isContextCompacting: false,
          processingStartedAt: Date.now(),
          lastDurationMs: null,
          heartbeatPulse: 0,
        },
      },
    };
    const firstDelta = "Inspect workspace and read README before checking hooks.";
    const secondDelta = "Inspect workspace and read README before checking tests.";

    const withFirst = threadReducer(processingState, {
      type: "appendReasoningContent",
      threadId,
      itemId: "reasoning-append-only-1",
      delta: firstDelta,
    });
    const withSecond = threadReducer(withFirst, {
      type: "appendReasoningContent",
      threadId,
      itemId: "reasoning-append-only-1",
      delta: secondDelta,
    });

    const item = withSecond.itemsByThread[threadId]?.[0];
    expect(item?.kind).toBe("reasoning");
    if (item?.kind === "reasoning") {
      expect(item.content.startsWith(firstDelta)).toBe(true);
      expect(item.content).toContain(secondDelta);
      expect(item.content).not.toBe(secondDelta);
    }
  });

  it("drops reasoning items explicitly for transient claude rendering", () => {
    const withReasoning = threadReducer(initialState, {
      type: "appendReasoningContent",
      threadId: "thread-1",
      itemId: "reasoning-drop-1",
      delta: "to be dropped",
    });
    const dropped = threadReducer(withReasoning, {
      type: "dropReasoningItems",
      threadId: "thread-1",
    });
    expect(dropped.itemsByThread["thread-1"] ?? []).toHaveLength(0);
  });

  it("folds duplicate reasoning snapshots with different ids into one item", () => {
    const base: ThreadState = {
      ...initialState,
      itemsByThread: {
        "thread-1": [
          {
            id: "reasoning-a",
            kind: "reasoning",
            summary: "项目分析中...",
            content:
              "用户要求项目简单分析。我先梳理当前工作目录与项目结构，然后读取关键文件。",
          },
        ],
      },
    };

    const next = threadReducer(base, {
      type: "upsertItem",
      workspaceId: "ws-1",
      threadId: "thread-1",
      item: {
        id: "reasoning-b",
        kind: "reasoning",
        summary: "项目分析中...",
        content:
          "用户要求项目简单分析。我先梳理当前工作目录与项目结构，然后读取关键文件。",
      },
      hasCustomName: false,
    });

    const items = next.itemsByThread["thread-1"] ?? [];
    const reasoningItems = items.filter((item) => item.kind === "reasoning");
    expect(reasoningItems).toHaveLength(1);
    expect(reasoningItems[0]?.id).toBe("reasoning-a");
  });

  it("inserts a reasoning summary boundary between sections", () => {
    const withSummary = threadReducer(initialState, {
      type: "appendReasoningSummary",
      threadId: "thread-1",
      itemId: "reasoning-1",
      delta: "Exploring files",
    });
    const withBoundary = threadReducer(withSummary, {
      type: "appendReasoningSummaryBoundary",
      threadId: "thread-1",
      itemId: "reasoning-1",
    });
    const withSecondSummary = threadReducer(withBoundary, {
      type: "appendReasoningSummary",
      threadId: "thread-1",
      itemId: "reasoning-1",
      delta: "Searching for routes",
    });

    const item = withSecondSummary.itemsByThread["thread-1"]?.[0];
    expect(item?.kind).toBe("reasoning");
    if (item?.kind === "reasoning") {
      expect(item.summary).toBe("Exploring files\n\nSearching for routes");
    }
  });

  it("ignores reasoning boundary for tiny trailing fragments", () => {
    const withSummary = threadReducer(initialState, {
      type: "appendReasoningSummary",
      threadId: "thread-1",
      itemId: "reasoning-compact-1",
      delta: "我",
    });
    const withBoundary = threadReducer(withSummary, {
      type: "appendReasoningSummaryBoundary",
      threadId: "thread-1",
      itemId: "reasoning-compact-1",
    });
    const withNextSummary = threadReducer(withBoundary, {
      type: "appendReasoningSummary",
      threadId: "thread-1",
      itemId: "reasoning-compact-1",
      delta: "来",
    });

    const item = withNextSummary.itemsByThread["thread-1"]?.[0];
    expect(item?.kind).toBe("reasoning");
    if (item?.kind === "reasoning") {
      expect(item.summary).toBe("我来");
    }
  });

  it("merges reasoning content snapshot over fragmented deltas", () => {
    const first = threadReducer(initialState, {
      type: "appendReasoningContent",
      threadId: "thread-1",
      itemId: "reasoning-compact-2",
      delta: "我\n\n来检查",
    });
    const second = threadReducer(first, {
      type: "appendReasoningContent",
      threadId: "thread-1",
      itemId: "reasoning-compact-2",
      delta: "我来检查",
    });

    const item = second.itemsByThread["thread-1"]?.[0];
    expect(item?.kind).toBe("reasoning");
    if (item?.kind === "reasoning") {
      expect(item.content).toBe("我来检查");
    }
  });

  it("compacts pathological reasoning content fragmentation in plain paragraphs", () => {
    const first = threadReducer(initialState, {
      type: "appendReasoningContent",
      threadId: "thread-1",
      itemId: "reasoning-compact-plain-1",
      delta:
        "你好\n\n！\n\n我是\n\n陈\n\n湘\n\n宁\n\n的\n\nAI\n\n联合\n\n架构\n\n师\n\n。\n\n有什么\n\n可以\n\n帮\n\n你\n\n吗\n\n？",
    });

    const item = first.itemsByThread["thread-1"]?.[0];
    expect(item?.kind).toBe("reasoning");
    if (item?.kind === "reasoning") {
      expect(item.content).toContain("你好！我是陈湘宁的AI联合架构师。有什么可以帮你吗？");
      expect(item.content).not.toContain("\n\n陈\n\n湘");
    }
  });

  it("compacts pathological reasoning content when blank lines include spaces", () => {
    const first = threadReducer(initialState, {
      type: "appendReasoningContent",
      threadId: "thread-1",
      itemId: "reasoning-compact-plain-space-1",
      delta: "你好\n \n！\n \n有什么\n \n我可以\n \n帮\n \n你的\n \n吗\n \n？",
    });

    const item = first.itemsByThread["thread-1"]?.[0];
    expect(item?.kind).toBe("reasoning");
    if (item?.kind === "reasoning") {
      expect(item.content).toContain("你好！有什么我可以帮你的吗？");
      expect(item.content).not.toContain("\n \n帮\n \n你的");
    }
  });

  it("compacts tokenized reasoning content across incremental deltas", () => {
    const deltas = [
      "你好\n\n",
      "！\n\n",
      "我是\n\n",
      "陈\n\n",
      "湘\n\n",
      "宁\n\n",
      "的\n\n",
      "AI\n\n",
      "联合\n\n",
      "架构\n\n",
      "师\n\n",
      "。\n\n",
    ];
    const finalState = deltas.reduce(
      (state, delta) =>
        threadReducer(state, {
          type: "appendReasoningContent",
          threadId: "thread-1",
          itemId: "reasoning-compact-plain-2",
          delta,
        }),
      initialState,
    );

    const item = finalState.itemsByThread["thread-1"]?.[0];
    expect(item?.kind).toBe("reasoning");
    if (item?.kind === "reasoning") {
      expect(item.content).toContain("你好！我是陈湘宁的AI联合");
      expect(item.content).not.toContain("\n\n陈\n\n湘");
      const segments = item.content.split(/\n{2,}/).filter(Boolean);
      expect(segments.length).toBeLessThanOrEqual(4);
    }
  });

  it("compacts pathological reasoning content fragmentation in blockquote paragraphs", () => {
    const first = threadReducer(initialState, {
      type: "appendReasoningContent",
      threadId: "thread-1",
      itemId: "reasoning-compact-quote-1",
      delta:
        "> 好\n\n> 的，让\n\n> 我\n\n> 帮你\n\n> 回\n\n> 顾一下当前项\n\n> 目的状态和\n\n> 最\n\n> 近的\n\n> Git 操\n\n> 作。",
    });

    const item = first.itemsByThread["thread-1"]?.[0];
    expect(item?.kind).toBe("reasoning");
    if (item?.kind === "reasoning") {
      expect(item.content).toContain("> 好的，让我帮你回顾一下当前项目的状态和最近的Git 操作。");
      expect(item.content).not.toContain("> 回\n\n> 顾一下当前项");
    }
  });

  it("normalizes reasoning snapshot on upsert to avoid duplicate repeated output", () => {
    const withReadableDelta = threadReducer(initialState, {
      type: "appendReasoningContent",
      threadId: "thread-1",
      itemId: "reasoning-upsert-1",
      delta: "你好！有什么我可以帮你的吗？",
    });
    const withUpsertSnapshot = threadReducer(withReadableDelta, {
      type: "upsertItem",
      workspaceId: "ws-1",
      threadId: "thread-1",
      item: {
        id: "reasoning-upsert-1",
        kind: "reasoning",
        summary: "",
        content: "你好！有什么我可以帮你的吗？ 你好！有什么我可以帮你的吗？",
      },
    });

    const item = withUpsertSnapshot.itemsByThread["thread-1"]?.[0];
    expect(item?.kind).toBe("reasoning");
    if (item?.kind === "reasoning") {
      expect(item.content).toBe("你好！有什么我可以帮你的吗？");
    }
  });

  it("keeps readable reasoning text when upsert snapshot is fragmented", () => {
    const withReadableDelta = threadReducer(initialState, {
      type: "appendReasoningContent",
      threadId: "thread-1",
      itemId: "reasoning-upsert-2",
      delta: "你好！有什么我可以帮你的吗？",
    });
    const withUpsertSnapshot = threadReducer(withReadableDelta, {
      type: "upsertItem",
      workspaceId: "ws-1",
      threadId: "thread-1",
      item: {
        id: "reasoning-upsert-2",
        kind: "reasoning",
        summary: "",
        content: "你好\n\n！\n\n有什么\n\n我可以\n\n帮\n\n你的\n\n吗\n\n？",
      },
    });

    const item = withUpsertSnapshot.itemsByThread["thread-1"]?.[0];
    expect(item?.kind).toBe("reasoning");
    if (item?.kind === "reasoning") {
      expect(item.content).toContain("你好！有什么我可以帮你的吗？");
      expect(item.content).not.toContain("\n\n帮\n\n你的");
    }
  });

  it("appends non-overlapping reasoning snapshots for the same item id", () => {
    const withFirstSnapshot = threadReducer(initialState, {
      type: "upsertItem",
      workspaceId: "ws-1",
      threadId: "thread-1",
      item: {
        id: "reasoning-upsert-append-1",
        kind: "reasoning",
        summary: "先读取项目结构",
        content: "先读取 README",
      },
    });
    const withSecondSnapshot = threadReducer(withFirstSnapshot, {
      type: "upsertItem",
      workspaceId: "ws-1",
      threadId: "thread-1",
      item: {
        id: "reasoning-upsert-append-1",
        kind: "reasoning",
        summary: "再检查 Controller",
        content: "再检查 service 边界条件",
      },
    });

    const item = withSecondSnapshot.itemsByThread["thread-1"]?.find(
      (entry) => entry.kind === "reasoning" && entry.id === "reasoning-upsert-append-1",
    );
    expect(item?.kind).toBe("reasoning");
    if (item?.kind === "reasoning") {
      expect(item.summary).toContain("先读取项目结构");
      expect(item.summary).toContain("再检查 Controller");
      expect(item.content).toContain("先读取 README");
      expect(item.content).toContain("再检查 service 边界条件");
    }
  });


  it("keeps reasoning markdown block breaks for list content", () => {
    const first = threadReducer(initialState, {
      type: "appendReasoningContent",
      threadId: "thread-1",
      itemId: "reasoning-compact-3",
      delta: "结论：",
    });
    const second = threadReducer(first, {
      type: "appendReasoningContent",
      threadId: "thread-1",
      itemId: "reasoning-compact-3",
      delta: "\n\n- 第一项",
    });

    const item = second.itemsByThread["thread-1"]?.[0];
    expect(item?.kind).toBe("reasoning");
    if (item?.kind === "reasoning") {
      expect(item.content).toBe("结论：\n\n- 第一项");
    }
  });
});
