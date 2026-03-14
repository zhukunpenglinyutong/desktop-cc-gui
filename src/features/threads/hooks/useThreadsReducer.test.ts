import { describe, expect, it } from "vitest";
import type { ConversationItem, ThreadSummary } from "../../../types";
import { initialState, threadReducer } from "./useThreadsReducer";
import type { ThreadState } from "./useThreadsReducer";

describe("threadReducer", () => {
  it("ensures thread with default name and active selection", () => {
    const next = threadReducer(initialState, {
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "thread-1",
    });
    const threads = next.threadsByWorkspace["ws-1"] ?? [];
    expect(threads).toHaveLength(1);
    expect(threads[0].name).toBe("Agent 1");
    expect(next.activeThreadIdByWorkspace["ws-1"]).toBe("thread-1");
    expect(next.threadStatusById["thread-1"]?.isProcessing).toBe(false);
  });

  it("resolves raw session id to existing prefixed engine thread", () => {
    const next = threadReducer(
      {
        ...initialState,
        threadsByWorkspace: {
          "ws-1": [
            {
              id: "opencode:session-xyz",
              name: "Agent 1",
              updatedAt: 1,
              engineSource: "opencode",
            },
          ],
        },
      },
      {
        type: "ensureThread",
        workspaceId: "ws-1",
        threadId: "session-xyz",
      },
    );

    expect(next.threadsByWorkspace["ws-1"]).toHaveLength(1);
    expect(next.threadsByWorkspace["ws-1"]?.[0]?.id).toBe("opencode:session-xyz");
    expect(next.threadStatusById["session-xyz"]).toBeUndefined();
  });

  it("updates thread engine source when requested", () => {
    const threads: ThreadSummary[] = [
      { id: "thread-1", name: "Agent 1", updatedAt: 1, engineSource: "codex" },
    ];
    const next = threadReducer(
      {
        ...initialState,
        threadsByWorkspace: { "ws-1": threads },
      },
      {
        type: "setThreadEngine",
        workspaceId: "ws-1",
        threadId: "thread-1",
        engine: "claude",
      },
    );
    expect(next.threadsByWorkspace["ws-1"]?.[0]?.engineSource).toBe("claude");
  });

  it("renames auto-generated thread on first user message", () => {
    const threads: ThreadSummary[] = [
      { id: "thread-1", name: "Agent 1", updatedAt: 1 },
    ];
    const next = threadReducer(
      {
        ...initialState,
        threadsByWorkspace: { "ws-1": threads },
      },
      {
        type: "upsertItem",
        workspaceId: "ws-1",
        threadId: "thread-1",
        item: {
          id: "user-1",
          kind: "message",
          role: "user",
          text: "Hello there",
        },
        hasCustomName: false,
      },
    );
    expect(next.threadsByWorkspace["ws-1"]?.[0]?.name).toBe("Hello there");
    const items = next.itemsByThread["thread-1"] ?? [];
    expect(items).toHaveLength(1);
    if (items[0]?.kind === "message") {
      expect(items[0].id).toBe("user-1");
      expect(items[0].text).toBe("Hello there");
    }
  });

  it("reconciles optimistic user bubble when backend user message arrives", () => {
    const base: ThreadState = {
      ...initialState,
      itemsByThread: {
        "thread-1": [
          {
            id: "optimistic-user-1",
            kind: "message",
            role: "user",
            text: "hello codex",
          },
        ],
      },
      threadsByWorkspace: {
        "ws-1": [{ id: "thread-1", name: "Agent 1", updatedAt: 1 }],
      },
    };

    const next = threadReducer(base, {
      type: "upsertItem",
      workspaceId: "ws-1",
      threadId: "thread-1",
      item: {
        id: "user-1",
        kind: "message",
        role: "user",
        text: "hello codex",
      },
      hasCustomName: false,
    });

    const items = next.itemsByThread["thread-1"] ?? [];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "user-1",
      kind: "message",
      role: "user",
      text: "hello codex",
    });
  });

  it("drops oldest optimistic user bubble when backend payload text differs", () => {
    const base: ThreadState = {
      ...initialState,
      itemsByThread: {
        "thread-1": [
          {
            id: "optimistic-user-1",
            kind: "message",
            role: "user",
            text: "hello codex",
          },
        ],
      },
      threadsByWorkspace: {
        "ws-1": [{ id: "thread-1", name: "Agent 1", updatedAt: 1 }],
      },
    };

    const next = threadReducer(base, {
      type: "upsertItem",
      workspaceId: "ws-1",
      threadId: "thread-1",
      item: {
        id: "user-2",
        kind: "message",
        role: "user",
        text: "[Spec Root Priority] ... [User Input] hello codex",
      },
      hasCustomName: false,
    });

    const items = next.itemsByThread["thread-1"] ?? [];
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe("user-2");
    expect(items[0]?.kind).toBe("message");
    if (items[0]?.kind === "message") {
      expect(items[0].role).toBe("user");
    }
  });

  it("preserves trailing optimistic user bubble when processing snapshot has not caught up", () => {
    const base: ThreadState = {
      ...initialState,
      itemsByThread: {
        "thread-1": [
          {
            id: "assistant-1",
            kind: "message",
            role: "assistant",
            text: "旧回复",
          },
          {
            id: "optimistic-user-1",
            kind: "message",
            role: "user",
            text: "新增日志 CRUD",
          },
        ],
      },
      threadStatusById: {
        "thread-1": {
          isProcessing: true,
          hasUnread: false,
          isReviewing: false,
          isContextCompacting: false,
          processingStartedAt: Date.now(),
          lastDurationMs: null,
          heartbeatPulse: 1,
        },
      },
    };

    const next = threadReducer(base, {
      type: "setThreadItems",
      threadId: "thread-1",
      items: [
        {
          id: "assistant-1",
          kind: "message",
          role: "assistant",
          text: "旧回复",
        },
      ],
    });

    expect(next.itemsByThread["thread-1"]).toEqual([
      {
        id: "assistant-1",
        kind: "message",
        role: "assistant",
        text: "旧回复",
      },
      {
        id: "optimistic-user-1",
        kind: "message",
        role: "user",
        text: "新增日志 CRUD",
      },
    ]);
  });

  it("drops preserved optimistic user bubble once snapshot includes the real user message", () => {
    const base: ThreadState = {
      ...initialState,
      itemsByThread: {
        "thread-1": [
          {
            id: "optimistic-user-1",
            kind: "message",
            role: "user",
            text: "新增日志 CRUD",
          },
        ],
      },
      threadStatusById: {
        "thread-1": {
          isProcessing: true,
          hasUnread: false,
          isReviewing: false,
          isContextCompacting: false,
          processingStartedAt: Date.now(),
          lastDurationMs: null,
          heartbeatPulse: 1,
        },
      },
    };

    const next = threadReducer(base, {
      type: "setThreadItems",
      threadId: "thread-1",
      items: [
        {
          id: "user-1",
          kind: "message",
          role: "user",
          text: "新增日志 CRUD",
        },
      ],
    });

    expect(next.itemsByThread["thread-1"]).toEqual([
      {
        id: "user-1",
        kind: "message",
        role: "user",
        text: "新增日志 CRUD",
      },
    ]);
  });

  it("renames auto-generated thread from assistant output when no user message", () => {
    const threads: ThreadSummary[] = [
      { id: "thread-1", name: "Agent 1", updatedAt: 1 },
    ];
    const next = threadReducer(
      {
        ...initialState,
        threadsByWorkspace: { "ws-1": threads },
        itemsByThread: { "thread-1": [] },
      },
      {
        type: "appendAgentDelta",
        workspaceId: "ws-1",
        threadId: "thread-1",
        itemId: "assistant-1",
        delta: "Assistant note",
        hasCustomName: false,
      },
    );
    expect(next.threadsByWorkspace["ws-1"]?.[0]?.name).toBe("Assistant note");
  });

  it("merges claude live assistant chunks into one row even when item ids change mid-turn", () => {
    const base: ThreadState = {
      ...initialState,
      activeTurnIdByThread: { "claude:thread-1": "turn-1" },
    };
    const first = threadReducer(base, {
      type: "appendAgentDelta",
      workspaceId: "ws-1",
      threadId: "claude:thread-1",
      itemId: "assistant-chunk-1",
      delta: "高",
      hasCustomName: false,
    });
    const second = threadReducer(first, {
      type: "appendAgentDelta",
      workspaceId: "ws-1",
      threadId: "claude:thread-1",
      itemId: "assistant-chunk-2",
      delta: "高概率这是前端渲染问题。",
      hasCustomName: false,
    });

    const messages = (second.itemsByThread["claude:thread-1"] ?? []).filter(
      (item): item is Extract<ConversationItem, { kind: "message" }> =>
        item.kind === "message" && item.role === "assistant",
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]?.id).toBe("assistant-live:turn-1");
    expect(messages[0]?.text).toBe("高概率这是前端渲染问题。");
  });

  it("prefers cumulative snapshot delta when it matches compact text", () => {
    const first = threadReducer(initialState, {
      type: "appendAgentDelta",
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId: "assistant-merge-1",
      delta: "根\n\n据项目记忆，这\n\n是关\n\n于 **\n\nOpenSpec",
      hasCustomName: false,
    });
    const second = threadReducer(first, {
      type: "appendAgentDelta",
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId: "assistant-merge-1",
      delta: "根据项目记忆，这是关于 **OpenSpec",
      hasCustomName: false,
    });

    const messages = (second.itemsByThread["thread-1"] ?? []).filter(
      (item): item is Extract<ConversationItem, { kind: "message" }> =>
        item.kind === "message" && item.role === "assistant",
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]?.text).toBe("根据项目记忆，这是关于 **OpenSpec");
  });

  it("avoids duplicating assistant text when delta echoes full content again", () => {
    const clean = "你好！我是你的 AI 联合架构师。有什么可以帮你的吗？";
    const first = threadReducer(initialState, {
      type: "appendAgentDelta",
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId: "assistant-echo-1",
      delta: clean,
      hasCustomName: false,
    });
    const second = threadReducer(first, {
      type: "appendAgentDelta",
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId: "assistant-echo-1",
      delta: `${clean}${clean}`,
      hasCustomName: false,
    });

    const messages = (second.itemsByThread["thread-1"] ?? []).filter(
      (item): item is Extract<ConversationItem, { kind: "message" }> =>
        item.kind === "message" && item.role === "assistant",
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]?.text).toBe(clean);
  });

  it("keeps latest cumulative snapshot when stream rewrites middle content", () => {
    const firstSnapshot = [
      "你好！我是你的 AI 联合架构师。",
      "",
      "我可以帮你：",
      "- 代码开发",
      "- 架构设计",
    ].join("\n");
    const secondSnapshot = [
      "你好！我是你的 AI 联合架构师。有什么可以帮你的吗？",
      "",
      "我可以帮你：",
      "- 代码开发",
      "- 架构设计",
      "- 问题排查",
    ].join("\n");
    const first = threadReducer(initialState, {
      type: "appendAgentDelta",
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId: "assistant-snapshot-1",
      delta: firstSnapshot,
      hasCustomName: false,
    });
    const second = threadReducer(first, {
      type: "appendAgentDelta",
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId: "assistant-snapshot-1",
      delta: secondSnapshot,
      hasCustomName: false,
    });

    const messages = (second.itemsByThread["thread-1"] ?? []).filter(
      (item): item is Extract<ConversationItem, { kind: "message" }> =>
        item.kind === "message" && item.role === "assistant",
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]?.text).toBe(secondSnapshot);
  });

  it("strips duplicated leading snapshot while preserving tail", () => {
    const snapshot = "你好！我是你的 AI 联合架构师。有什么可以帮你的吗？";
    const withEchoAndTail = `${snapshot}\n\n${snapshot}\n\n我还可以帮你排查线上问题。`;
    const first = threadReducer(initialState, {
      type: "appendAgentDelta",
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId: "assistant-snapshot-echo-1",
      delta: snapshot,
      hasCustomName: false,
    });
    const second = threadReducer(first, {
      type: "appendAgentDelta",
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId: "assistant-snapshot-echo-1",
      delta: withEchoAndTail,
      hasCustomName: false,
    });

    const messages = (second.itemsByThread["thread-1"] ?? []).filter(
      (item): item is Extract<ConversationItem, { kind: "message" }> =>
        item.kind === "message" && item.role === "assistant",
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]?.text).toBe(`${snapshot}\n\n我还可以帮你排查线上问题。`);
  });

  it("avoids appending duplicated body when cumulative snapshot restarts from the middle", () => {
    const intro = "奶奶您好，您这学习劲头太让人佩服了，我一定认真给您讲清楚，不糊弄您。💪";
    const firstBody = [
      "现在就差一步：您还没把“具体问题/全文内容”发给我。",
      "请您把要讲的内容发我（文字粘贴、截图都行），我马上按这个方式给您讲：",
      "中英文对照原文（一句中文 + 一句英文）",
      "每一句的大白话解释（像聊天一样）",
      "关键词单独解释（这个词到底啥意思）",
      "举生活例子（让您一听就懂）",
      "最后总结 + 小复习（帮您彻底记住）",
      "",
      "您发来内容后，我就开始。放心，我会讲到您“彻底看懂”为止。",
    ].join("\n");
    const shiftedSnapshot = [
      "现在就差一步：您还没把“具体问题/全文内容”发给我。",
      "请您把要讲的内容发我（文字粘贴、截图都行），我马上按这个方式给您讲：",
      "中英文对照原文（一句中文 + 一句英文）",
      "每一句的大白话解释（像聊天一样）",
      "关键词单独解释（这个词到底啥意思）",
      "举生活例子（让您一听就懂）",
      "最后总结 + 小复习（帮您彻底记住）",
      "",
      "您发来内容后，我就开始。奶奶放心，我会讲到您“彻底看懂”为止。",
    ].join("\n");
    const fullSnapshot = `${intro}\n\n${firstBody}`;
    const expectedMerged = `${intro}\n\n${shiftedSnapshot}`;
    const first = threadReducer(initialState, {
      type: "appendAgentDelta",
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId: "assistant-shifted-1",
      delta: fullSnapshot,
      hasCustomName: false,
    });
    const second = threadReducer(first, {
      type: "appendAgentDelta",
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId: "assistant-shifted-1",
      delta: shiftedSnapshot,
      hasCustomName: false,
    });

    const messages = (second.itemsByThread["thread-1"] ?? []).filter(
      (item): item is Extract<ConversationItem, { kind: "message" }> =>
        item.kind === "message" && item.role === "assistant",
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]?.text).toBe(expectedMerged);
  });

  it("removes artificial leading paragraph breaks on tiny cjk fragments", () => {
    const first = threadReducer(initialState, {
      type: "appendAgentDelta",
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId: "assistant-merge-2",
      delta: "根据项目记忆，",
      hasCustomName: false,
    });
    const second = threadReducer(first, {
      type: "appendAgentDelta",
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId: "assistant-merge-2",
      delta: "\n\n这",
      hasCustomName: false,
    });

    const messages = (second.itemsByThread["thread-1"] ?? []).filter(
      (item): item is Extract<ConversationItem, { kind: "message" }> =>
        item.kind === "message" && item.role === "assistant",
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]?.text).toBe("根据项目记忆，这");
  });

  it("keeps markdown block breaks when delta starts with list syntax", () => {
    const first = threadReducer(initialState, {
      type: "appendAgentDelta",
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId: "assistant-merge-3",
      delta: "下面是结果：",
      hasCustomName: false,
    });
    const second = threadReducer(first, {
      type: "appendAgentDelta",
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId: "assistant-merge-3",
      delta: "\n\n- 第一项",
      hasCustomName: false,
    });

    const messages = (second.itemsByThread["thread-1"] ?? []).filter(
      (item): item is Extract<ConversationItem, { kind: "message" }> =>
        item.kind === "message" && item.role === "assistant",
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]?.text).toBe("下面是结果：\n\n- 第一项");
  });

  it("completes existing assistant message when segment advanced without new delta", () => {
    const withDelta = threadReducer(initialState, {
      type: "appendAgentDelta",
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId: "assistant-1",
      delta: "好\n\n的，让\n\n我先读",
      hasCustomName: false,
    });
    const withSegment = threadReducer(withDelta, {
      type: "incrementAgentSegment",
      threadId: "thread-1",
    });
    const completed = threadReducer(withSegment, {
      type: "completeAgentMessage",
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId: "assistant-1",
      text: "好的，让我先读取项目关键文件回忆一下项目状态。",
      hasCustomName: false,
    });

    const messages = (completed.itemsByThread["thread-1"] ?? []).filter(
      (item): item is Extract<ConversationItem, { kind: "message" }> =>
        item.kind === "message" && item.role === "assistant",
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]?.id).toBe("assistant-1");
    expect(messages[0]?.text).toBe("好的，让我先读取项目关键文件回忆一下项目状态。");
  });

  it("keeps readable assistant text when completed payload repeats fragmented prefix", () => {
    const fragmented = "好\n\n的，让\n\n我\n\n帮你\n\n回\n\n顾一下当前项\n\n目的状态和\n\n最\n\n近的\n\nGit 操\n\n作。";
    const readable = "好的，让我帮你回顾一下当前项目的状态和最近的 Git 操作。";
    const withFragment = threadReducer(initialState, {
      type: "appendAgentDelta",
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId: "assistant-complete-1",
      delta: fragmented,
      hasCustomName: false,
    });
    const withReadable = threadReducer(withFragment, {
      type: "appendAgentDelta",
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId: "assistant-complete-1",
      delta: readable,
      hasCustomName: false,
    });
    const completed = threadReducer(withReadable, {
      type: "completeAgentMessage",
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId: "assistant-complete-1",
      text: `${fragmented}\n\n${readable}`,
      hasCustomName: false,
    });

    const messages = (completed.itemsByThread["thread-1"] ?? []).filter(
      (item): item is Extract<ConversationItem, { kind: "message" }> =>
        item.kind === "message" && item.role === "assistant",
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]?.text).toBe(readable);
  });

  it("dedupes repeated completed snapshot even when the streamed prefix is slightly different", () => {
    const fragmented = "你好，我在。要我先帮看代码，排查问题，还是推进某个 OpenSpec 变更？";
    const readable = "你好，我在。要我先帮你看代码，排查问题，还是推进某个 OpenSpec 变更？";
    const withFragment = threadReducer(initialState, {
      type: "appendAgentDelta",
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId: "assistant-complete-2",
      delta: fragmented,
      hasCustomName: false,
    });
    const completed = threadReducer(withFragment, {
      type: "completeAgentMessage",
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId: "assistant-complete-2",
      text: `${readable} ${readable}`,
      hasCustomName: false,
    });

    const messages = (completed.itemsByThread["thread-1"] ?? []).filter(
      (item): item is Extract<ConversationItem, { kind: "message" }> =>
        item.kind === "message" && item.role === "assistant",
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]?.text).toBe(readable);
  });

  it("dedupes five manual QA greeting snapshots and keeps one readable answer", () => {
    const scenarios = [
      {
        id: "manual-greeting-1",
        delta: "你好，我在。",
        completed:
          "你好，我在。想让我先帮你做什么？ 你好，我在。想让我先帮你做什么？",
        expected: "你好，我在。想让我先帮你做什么？",
      },
      {
        id: "manual-greeting-2",
        delta: "你好，湘宁。",
        completed: "我在这，随时可以开始。直接说你现在要做的任务。",
        expected: "我在这，随时可以开始。直接说你现在要做的任务。",
      },
      {
        id: "manual-greeting-3",
        delta: "你好，我在。",
        completed:
          "你好，我在。想让我先帮你做什么？ 你好，我在。想让我先帮你做什么？",
        expected: "你好，我在。想让我先帮你做什么？",
      },
      {
        id: "manual-greeting-4",
        delta: "你好，在线。",
        completed:
          "你好，在线。说下现在想做什么，我直接开始。 你好，在线。说下你现在想做什么，我直接开始。",
        expected: "你好，在线。说下你现在想做什么，我直接开始。",
      },
      {
        id: "manual-greeting-5",
        delta: "你好！在的。",
        completed:
          "你好！在的。要我先帮你处理哪件事？ 你好！在的。要我先帮你处理哪件事？",
        expected: "你好！在的。要我先帮你处理哪件事？",
      },
    ] as const;

    for (const scenario of scenarios) {
      const withDelta = threadReducer(initialState, {
        type: "appendAgentDelta",
        workspaceId: "ws-1",
        threadId: "thread-1",
        itemId: scenario.id,
        delta: scenario.delta,
        hasCustomName: false,
      });
      const completed = threadReducer(withDelta, {
        type: "completeAgentMessage",
        workspaceId: "ws-1",
        threadId: "thread-1",
        itemId: scenario.id,
        text: scenario.completed,
        hasCustomName: false,
      });
      const finalized = threadReducer(completed, {
        type: "upsertItem",
        workspaceId: "ws-1",
        threadId: "thread-1",
        item: {
          id: scenario.id,
          kind: "message",
          role: "assistant",
          text: scenario.completed,
        },
        hasCustomName: false,
      });

      const messages = (finalized.itemsByThread["thread-1"] ?? []).filter(
        (item): item is Extract<ConversationItem, { kind: "message" }> =>
          item.kind === "message" && item.role === "assistant" && item.id === scenario.id,
      );
      expect(messages).toHaveLength(1);
      expect(messages[0]?.text).toBe(scenario.expected);
    }
  });

  it("completes the latest segmented assistant message when it exists", () => {
    const withFirstDelta = threadReducer(initialState, {
      type: "appendAgentDelta",
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId: "assistant-2",
      delta: "第一段",
      hasCustomName: false,
    });
    const withSegment = threadReducer(withFirstDelta, {
      type: "incrementAgentSegment",
      threadId: "thread-1",
    });
    const withSecondDelta = threadReducer(withSegment, {
      type: "appendAgentDelta",
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId: "assistant-2",
      delta: "第二段",
      hasCustomName: false,
    });
    const completed = threadReducer(withSecondDelta, {
      type: "completeAgentMessage",
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId: "assistant-2",
      text: "第二段（完整）",
      hasCustomName: false,
    });

    const messages = (completed.itemsByThread["thread-1"] ?? []).filter(
      (item): item is Extract<ConversationItem, { kind: "message" }> =>
        item.kind === "message" && item.role === "assistant",
    );
    expect(messages).toHaveLength(2);
    expect(messages[0]?.id).toBe("assistant-2");
    expect(messages[0]?.text).toBe("第一段");
    expect(messages[1]?.id).toBe("assistant-2-seg-1");
    expect(messages[1]?.text).toBe("第二段（完整）");
  });

  it("updates thread timestamp when newer activity arrives", () => {
    const threads: ThreadSummary[] = [
      { id: "thread-1", name: "Agent 1", updatedAt: 1000 },
    ];
    const next = threadReducer(
      {
        ...initialState,
        threadsByWorkspace: { "ws-1": threads },
      },
      {
        type: "setThreadTimestamp",
        workspaceId: "ws-1",
        threadId: "thread-1",
        timestamp: 1500,
      },
    );
    expect(next.threadsByWorkspace["ws-1"]?.[0]?.updatedAt).toBe(1500);
  });

  it("tracks processing durations", () => {
    const started = threadReducer(
      {
        ...initialState,
        threadStatusById: {
          "thread-1": {
            isProcessing: false,
            hasUnread: false,
            isReviewing: false,
            processingStartedAt: null,
            lastDurationMs: null,
          },
        },
      },
      {
        type: "markProcessing",
        threadId: "thread-1",
        isProcessing: true,
        timestamp: 1000,
      },
    );
    const stopped = threadReducer(started, {
      type: "markProcessing",
      threadId: "thread-1",
      isProcessing: false,
      timestamp: 1600,
    });
    expect(stopped.threadStatusById["thread-1"]?.lastDurationMs).toBe(600);
  });

  it("tracks heartbeat pulses only while processing", () => {
    const started = threadReducer(initialState, {
      type: "markProcessing",
      threadId: "thread-1",
      isProcessing: true,
      timestamp: 1000,
    });
    const pulsed = threadReducer(started, {
      type: "markHeartbeat",
      threadId: "thread-1",
      pulse: 2,
    });
    expect(pulsed.threadStatusById["thread-1"]?.heartbeatPulse).toBe(2);

    const stalePulse = threadReducer(pulsed, {
      type: "markHeartbeat",
      threadId: "thread-1",
      pulse: 1,
    });
    expect(stalePulse.threadStatusById["thread-1"]?.heartbeatPulse).toBe(2);

    const stopped = threadReducer(pulsed, {
      type: "markProcessing",
      threadId: "thread-1",
      isProcessing: false,
      timestamp: 1500,
    });
    expect(stopped.threadStatusById["thread-1"]?.heartbeatPulse ?? 0).toBe(0);
  });

  it("tracks request user input queue", () => {
    const request = {
      workspace_id: "ws-1",
      request_id: 99,
      params: {
        thread_id: "thread-1",
        turn_id: "turn-1",
        item_id: "call-1",
        questions: [{ id: "q1", header: "Confirm", question: "Proceed?" }],
      },
    };
    const added = threadReducer(initialState, {
      type: "addUserInputRequest",
      request,
    });
    expect(added.userInputRequests).toHaveLength(1);
    expect(added.userInputRequests[0]).toEqual(request);

    const removed = threadReducer(added, {
      type: "removeUserInputRequest",
      requestId: 99,
      workspaceId: "ws-1",
    });
    expect(removed.userInputRequests).toHaveLength(0);
  });

  it("drops local review-start items when server review starts", () => {
    const localReview: ConversationItem = {
      id: "review-start-1",
      kind: "review",
      state: "started",
      text: "",
    };
    const incomingReview: ConversationItem = {
      id: "remote-review-1",
      kind: "review",
      state: "started",
      text: "",
    };
    const next = threadReducer(
      {
        ...initialState,
        itemsByThread: { "thread-1": [localReview] },
      },
      {
        type: "upsertItem",
        workspaceId: "ws-1",
        threadId: "thread-1",
        item: incomingReview,
      },
    );
    const items = next.itemsByThread["thread-1"] ?? [];
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe("remote-review-1");
  });

  it("appends review items when ids repeat", () => {
    const firstReview: ConversationItem = {
      id: "review-mode",
      kind: "review",
      state: "started",
      text: "Reviewing changes",
    };
    const next = threadReducer(
      {
        ...initialState,
        itemsByThread: { "thread-1": [firstReview] },
      },
      {
        type: "upsertItem",
        workspaceId: "ws-1",
        threadId: "thread-1",
        item: {
          id: "review-mode",
          kind: "review",
          state: "completed",
          text: "Reviewing changes",
        },
      },
    );
    const items = next.itemsByThread["thread-1"] ?? [];
    expect(items).toHaveLength(2);
    expect(items[0]?.id).toBe("review-mode");
    expect(items[1]?.id).toBe("review-mode-1");
  });

  it("ignores duplicate review items with identical id, state, and text", () => {
    const firstReview: ConversationItem = {
      id: "review-mode",
      kind: "review",
      state: "started",
      text: "Reviewing changes",
    };
    const next = threadReducer(
      {
        ...initialState,
        itemsByThread: { "thread-1": [firstReview] },
      },
      {
        type: "upsertItem",
        workspaceId: "ws-1",
        threadId: "thread-1",
        item: {
          id: "review-mode",
          kind: "review",
          state: "started",
          text: "Reviewing changes",
        },
      },
    );
    const items = next.itemsByThread["thread-1"] ?? [];
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe("review-mode");
  });

  it("dedupes review items with identical content", () => {
    const firstReview: ConversationItem = {
      id: "review-mode",
      kind: "review",
      state: "completed",
      text: "Reviewing changes",
    };
    const next = threadReducer(
      {
        ...initialState,
        itemsByThread: { "thread-1": [firstReview] },
      },
      {
        type: "upsertItem",
        workspaceId: "ws-1",
        threadId: "thread-1",
        item: {
          id: "review-mode-duplicate",
          kind: "review",
          state: "completed",
          text: "Reviewing changes",
        },
      },
    );
    const items = next.itemsByThread["thread-1"] ?? [];
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe("review-mode");
  });

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

  it("adds and removes user input requests by workspace and id", () => {
    const requestA = {
      workspace_id: "ws-1",
      request_id: 1,
      params: {
        thread_id: "thread-1",
        turn_id: "turn-1",
        item_id: "item-1",
        questions: [],
      },
    };
    const requestB = {
      workspace_id: "ws-2",
      request_id: 1,
      params: {
        thread_id: "thread-2",
        turn_id: "turn-2",
        item_id: "item-2",
        questions: [],
      },
    };

    const added = threadReducer(initialState, {
      type: "addUserInputRequest",
      request: requestA,
    });
    expect(added.userInputRequests).toEqual([requestA]);

    const deduped = threadReducer(added, {
      type: "addUserInputRequest",
      request: requestA,
    });
    expect(deduped.userInputRequests).toHaveLength(1);

    const withSecond = threadReducer(added, {
      type: "addUserInputRequest",
      request: requestB,
    });
    expect(withSecond.userInputRequests).toHaveLength(2);

    const removed = threadReducer(withSecond, {
      type: "removeUserInputRequest",
      requestId: 1,
      workspaceId: "ws-1",
    });
    expect(removed.userInputRequests).toEqual([requestB]);
  });

  it("clears user input requests by thread while preserving other threads", () => {
    const requestThreadOne = {
      workspace_id: "ws-1",
      request_id: "req-1",
      params: {
        thread_id: "thread-1",
        turn_id: "turn-1",
        item_id: "item-1",
        questions: [],
      },
    };
    const requestThreadTwo = {
      workspace_id: "ws-1",
      request_id: "req-2",
      params: {
        thread_id: "thread-2",
        turn_id: "turn-2",
        item_id: "item-2",
        questions: [],
      },
    };

    const stateWithRequests = threadReducer(initialState, {
      type: "addUserInputRequest",
      request: requestThreadOne,
    });
    const withSecond = threadReducer(stateWithRequests, {
      type: "addUserInputRequest",
      request: requestThreadTwo,
    });

    const cleared = threadReducer(withSecond, {
      type: "clearUserInputRequestsForThread",
      workspaceId: "ws-1",
      threadId: "thread-1",
    });
    expect(cleared.userInputRequests).toEqual([requestThreadTwo]);
  });

  it("hides background threads and keeps them hidden on future syncs", () => {
    const withThread = threadReducer(initialState, {
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "thread-bg",
    });
    expect(withThread.threadsByWorkspace["ws-1"]?.some((t) => t.id === "thread-bg")).toBe(true);

    const hidden = threadReducer(withThread, {
      type: "hideThread",
      workspaceId: "ws-1",
      threadId: "thread-bg",
    });
    expect(hidden.threadsByWorkspace["ws-1"]?.some((t) => t.id === "thread-bg")).toBe(false);

    const synced = threadReducer(hidden, {
      type: "setThreads",
      workspaceId: "ws-1",
      threads: [
        { id: "thread-bg", name: "Agent 1", updatedAt: Date.now() },
        { id: "thread-visible", name: "Agent 2", updatedAt: Date.now() },
      ],
    });
    const ids = synced.threadsByWorkspace["ws-1"]?.map((t) => t.id) ?? [];
    expect(ids).toContain("thread-visible");
    expect(ids).not.toContain("thread-bg");
  });

  it("does not force-rename when multiple Claude pending threads remain ambiguous", () => {
    const base: ThreadState = {
      ...initialState,
      activeThreadIdByWorkspace: { "ws-1": "claude-pending-a" },
      threadsByWorkspace: {
        "ws-1": [
          {
            id: "claude-pending-a",
            name: "Agent 1",
            updatedAt: 1,
            engineSource: "claude",
          },
          {
            id: "claude-pending-b",
            name: "Agent 2",
            updatedAt: 2,
            engineSource: "claude",
          },
        ],
      },
      threadStatusById: {
        "claude-pending-a": {
          isProcessing: true,
          hasUnread: false,
          isReviewing: false,
          processingStartedAt: 100,
          lastDurationMs: null,
        },
        "claude-pending-b": {
          isProcessing: true,
          hasUnread: false,
          isReviewing: false,
          processingStartedAt: 120,
          lastDurationMs: null,
        },
      },
    };

    const next = threadReducer(base, {
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "claude:session-1",
      engine: "claude",
    });

    const ids = next.threadsByWorkspace["ws-1"]?.map((thread) => thread.id) ?? [];
    expect(ids).toContain("claude-pending-a");
    expect(ids).toContain("claude-pending-b");
    expect(ids).toContain("claude:session-1");
    expect(next.threadStatusById["claude-pending-a"]?.isProcessing).toBe(true);
    expect(next.threadStatusById["claude-pending-b"]?.isProcessing).toBe(true);
    expect(next.threadStatusById["claude:session-1"]?.isProcessing).toBe(false);
    expect(next.activeThreadIdByWorkspace["ws-1"]).toBe("claude-pending-a");
  });

  it("does not auto-rename when multiple pending Claude threads exist even if active has activity", () => {
    const base: ThreadState = {
      ...initialState,
      activeThreadIdByWorkspace: { "ws-1": "claude-pending-new" },
      threadsByWorkspace: {
        "ws-1": [
          {
            id: "claude-pending-old",
            name: "Agent 1",
            updatedAt: 1,
            engineSource: "claude",
          },
          {
            id: "claude-pending-new",
            name: "Agent 2",
            updatedAt: 2,
            engineSource: "claude",
          },
        ],
      },
      threadStatusById: {
        "claude-pending-old": {
          isProcessing: true,
          hasUnread: false,
          isReviewing: false,
          processingStartedAt: 100,
          lastDurationMs: null,
        },
        "claude-pending-new": {
          isProcessing: false,
          hasUnread: false,
          isReviewing: false,
          processingStartedAt: null,
          lastDurationMs: null,
        },
      },
      itemsByThread: {
        "claude-pending-old": [
          { id: "reasoning-old", kind: "reasoning", summary: "old", content: "old stream" },
        ],
        "claude-pending-new": [
          { id: "user-new", kind: "message", role: "user", text: "new prompt" },
        ],
      },
    };

    const next = threadReducer(base, {
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "claude:session-2",
      engine: "claude",
    });

    const ids = next.threadsByWorkspace["ws-1"]?.map((thread) => thread.id) ?? [];
    expect(ids).toContain("claude-pending-old");
    expect(ids).toContain("claude-pending-new");
    expect(ids).toContain("claude:session-2");
    expect(next.itemsByThread["claude:session-2"] ?? []).toHaveLength(0);
    expect(next.itemsByThread["claude-pending-new"]?.map((item) => item.id)).toContain(
      "user-new",
    );
    expect(next.itemsByThread["claude-pending-old"]?.map((item) => item.id)).toContain(
      "reasoning-old",
    );
    expect(next.activeThreadIdByWorkspace["ws-1"]).toBe("claude-pending-new");
  });

  it("does not force-rename a single idle pending thread to unrelated session id", () => {
    const base: ThreadState = {
      ...initialState,
      activeThreadIdByWorkspace: { "ws-1": "claude-pending-idle" },
      threadsByWorkspace: {
        "ws-1": [
          {
            id: "claude-pending-idle",
            name: "Agent 1",
            updatedAt: 1,
            engineSource: "claude",
          },
        ],
      },
      threadStatusById: {
        "claude-pending-idle": {
          isProcessing: false,
          hasUnread: false,
          isReviewing: false,
          processingStartedAt: null,
          lastDurationMs: null,
        },
      },
      itemsByThread: {
        "claude-pending-idle": [],
      },
      activeTurnIdByThread: {
        "claude-pending-idle": null,
      },
    };

    const next = threadReducer(base, {
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "claude:historical-session",
      engine: "claude",
    });

    const ids = next.threadsByWorkspace["ws-1"]?.map((thread) => thread.id) ?? [];
    expect(ids).toContain("claude-pending-idle");
    expect(ids).toContain("claude:historical-session");
    expect(next.itemsByThread["claude-pending-idle"]).toEqual([]);
    expect(next.activeThreadIdByWorkspace["ws-1"]).toBe("claude-pending-idle");
  });

  it("finalizes pending tool statuses to completed", () => {
    const base: ThreadState = {
      ...initialState,
      itemsByThread: {
        "thread-1": [
          {
            id: "tool-1",
            kind: "tool",
            toolType: "mcpToolCall",
            title: "Tool: Read",
            detail: "{}",
            status: "started",
          },
          {
            id: "tool-2",
            kind: "tool",
            toolType: "mcpToolCall",
            title: "Tool: Bash",
            detail: "{}",
            status: "running",
          },
          {
            id: "tool-3",
            kind: "tool",
            toolType: "mcpToolCall",
            title: "Tool: Search",
            detail: "{}",
            status: "completed",
          },
          {
            id: "tool-4",
            kind: "tool",
            toolType: "mcpToolCall",
            title: "Tool: Edit",
            detail: "{}",
            status: "failed",
          },
        ],
      },
    };

    const next = threadReducer(base, {
      type: "finalizePendingToolStatuses",
      threadId: "thread-1",
      status: "completed",
    });

    const tools = (next.itemsByThread["thread-1"] ?? []).filter(
      (item): item is Extract<ConversationItem, { kind: "tool" }> =>
        item.kind === "tool",
    );

    expect(tools.find((item) => item.id === "tool-1")?.status).toBe("completed");
    expect(tools.find((item) => item.id === "tool-2")?.status).toBe("completed");
    expect(tools.find((item) => item.id === "tool-3")?.status).toBe("completed");
    expect(tools.find((item) => item.id === "tool-4")?.status).toBe("failed");
  });

  it("creates a placeholder tool when output delta arrives before the tool snapshot", () => {
    const base: ThreadState = {
      ...initialState,
      itemsByThread: {
        "thread-1": [],
      },
    };

    const next = threadReducer(base, {
      type: "appendToolOutput",
      threadId: "thread-1",
      itemId: "tool-1",
      delta: "partial output",
    });

    const tool = (next.itemsByThread["thread-1"] ?? []).find(
      (item): item is Extract<ConversationItem, { kind: "tool" }> =>
        item.kind === "tool" && item.id === "tool-1",
    );

    expect(tool).toMatchObject({
      id: "tool-1",
      toolType: "commandExecution",
      title: "Command",
      status: "running",
      output: "partial output",
    });
  });

  it("finalizes pending tool statuses to failed", () => {
    const base: ThreadState = {
      ...initialState,
      itemsByThread: {
        "thread-1": [
          {
            id: "tool-1",
            kind: "tool",
            toolType: "mcpToolCall",
            title: "Tool: Read",
            detail: "{}",
            status: "started",
          },
          {
            id: "tool-2",
            kind: "tool",
            toolType: "mcpToolCall",
            title: "Tool: Search",
            detail: "{}",
            status: "in_progress",
          },
        ],
      },
    };

    const next = threadReducer(base, {
      type: "finalizePendingToolStatuses",
      threadId: "thread-1",
      status: "failed",
    });

    const tools = (next.itemsByThread["thread-1"] ?? []).filter(
      (item): item is Extract<ConversationItem, { kind: "tool" }> =>
        item.kind === "tool",
    );

    expect(tools.find((item) => item.id === "tool-1")?.status).toBe("failed");
    expect(tools.find((item) => item.id === "tool-2")?.status).toBe("failed");
  });

  it("merges pending thread into real session thread on rename collision", () => {
    const base: ThreadState = {
      ...initialState,
      activeThreadIdByWorkspace: { "ws-1": "opencode-pending-1" },
      itemsByThread: {
        "opencode-pending-1": [
          { id: "u1", kind: "message", role: "user", text: "你好" },
        ],
        "opencode:ses-1": [
          { id: "a1", kind: "message", role: "assistant", text: "已收到" },
        ],
      },
      threadsByWorkspace: {
        "ws-1": [
          { id: "opencode-pending-1", name: "你好", updatedAt: 100, engineSource: "opencode" },
          { id: "opencode:ses-1", name: "Agent 2", updatedAt: 200, engineSource: "opencode" },
        ],
      },
      threadStatusById: {
        "opencode-pending-1": {
          isProcessing: true,
          hasUnread: false,
          isReviewing: false,
          processingStartedAt: 100,
          lastDurationMs: null,
        },
        "opencode:ses-1": {
          isProcessing: false,
          hasUnread: true,
          isReviewing: false,
          processingStartedAt: null,
          lastDurationMs: 80,
        },
      },
    };

    const next = threadReducer(base, {
      type: "renameThreadId",
      workspaceId: "ws-1",
      oldThreadId: "opencode-pending-1",
      newThreadId: "opencode:ses-1",
    });

    expect(next.activeThreadIdByWorkspace["ws-1"]).toBe("opencode:ses-1");
    expect(next.itemsByThread["opencode-pending-1"]).toBeUndefined();
    expect(next.itemsByThread["opencode:ses-1"]?.map((item) => item.id)).toEqual([
      "u1",
      "a1",
    ]);
    expect(next.threadsByWorkspace["ws-1"]?.filter((t) => t.id === "opencode:ses-1")).toHaveLength(1);
    expect(next.threadStatusById["opencode:ses-1"]?.isProcessing).toBe(true);
    expect(next.threadStatusById["opencode:ses-1"]?.hasUnread).toBe(true);
  });

  it("keeps latest pending user message when merging into long existing history", () => {
    const existingItems: ConversationItem[] = Array.from({ length: 200 }, (_, index) => ({
      id: `existing-${index}`,
      kind: "message",
      role: index % 2 === 0 ? "user" : "assistant",
      text: `msg-${index}`,
    }));
    const pendingItem: ConversationItem = {
      id: "pending-user",
      kind: "message",
      role: "user",
      text: "最新问题",
    };
    const base: ThreadState = {
      ...initialState,
      itemsByThread: {
        "opencode-pending-1": [pendingItem],
        "opencode:ses-1": existingItems,
      },
      threadsByWorkspace: {
        "ws-1": [
          { id: "opencode-pending-1", name: "最新问题", updatedAt: 300, engineSource: "opencode" },
          { id: "opencode:ses-1", name: "历史会话", updatedAt: 200, engineSource: "opencode" },
        ],
      },
    };

    const next = threadReducer(base, {
      type: "renameThreadId",
      workspaceId: "ws-1",
      oldThreadId: "opencode-pending-1",
      newThreadId: "opencode:ses-1",
    });

    const merged = next.itemsByThread["opencode:ses-1"] ?? [];
    expect(merged.some((item) => item.id === "pending-user")).toBe(true);
    expect(merged[merged.length - 1]?.id).toBe("pending-user");
  });

  it("renames pending userInputRequest thread id together with thread rename", () => {
    const pendingRequest = {
      workspace_id: "ws-1",
      request_id: "req-1",
      params: {
        thread_id: "codex-pending-1",
        turn_id: "turn-1",
        item_id: "item-1",
        questions: [{ id: "q1", header: "", question: "继续?" }],
      },
    };
    const base: ThreadState = {
      ...initialState,
      userInputRequests: [pendingRequest],
      threadsByWorkspace: {
        "ws-1": [
          { id: "codex-pending-1", name: "Agent 1", updatedAt: 1, engineSource: "codex" },
        ],
      },
    };

    const next = threadReducer(base, {
      type: "renameThreadId",
      workspaceId: "ws-1",
      oldThreadId: "codex-pending-1",
      newThreadId: "codex:session-1",
    });

    expect(next.userInputRequests).toHaveLength(1);
    expect(next.userInputRequests[0]?.params.thread_id).toBe("codex:session-1");
  });

  it("stores plan state per thread and replaces stale plan for same thread", () => {
    const base: ThreadState = {
      ...initialState,
      planByThread: {
        "thread-1": {
          turnId: "turn-1",
          explanation: "old",
          steps: [{ step: "old-step", status: "pending" }],
        },
      },
    };

    const updatedThreadOne = threadReducer(base, {
      type: "setThreadPlan",
      threadId: "thread-1",
      plan: {
        turnId: "turn-2",
        explanation: "new",
        steps: [{ step: "new-step", status: "completed" }],
      },
    });

    const withThreadTwo = threadReducer(updatedThreadOne, {
      type: "setThreadPlan",
      threadId: "thread-2",
      plan: {
        turnId: "turn-3",
        explanation: "other",
        steps: [{ step: "other-step", status: "inProgress" }],
      },
    });

    expect(withThreadTwo.planByThread["thread-1"]).toEqual({
      turnId: "turn-2",
      explanation: "new",
      steps: [{ step: "new-step", status: "completed" }],
    });
    expect(withThreadTwo.planByThread["thread-2"]).toEqual({
      turnId: "turn-3",
      explanation: "other",
      steps: [{ step: "other-step", status: "inProgress" }],
    });
  });

  it("settles in-progress plan steps without changing other statuses", () => {
    const base: ThreadState = {
      ...initialState,
      planByThread: {
        "thread-1": {
          turnId: "turn-9",
          explanation: "plan",
          steps: [
            { step: "step-a", status: "completed" },
            { step: "step-b", status: "inProgress" },
            { step: "step-c", status: "pending" },
          ],
        },
      },
    };

    const settledPending = threadReducer(base, {
      type: "settleThreadPlanInProgress",
      threadId: "thread-1",
      targetStatus: "pending",
    });
    expect(settledPending.planByThread["thread-1"]).toEqual({
      turnId: "turn-9",
      explanation: "plan",
      steps: [
        { step: "step-a", status: "completed" },
        { step: "step-b", status: "pending" },
        { step: "step-c", status: "pending" },
      ],
    });

    const settledCompleted = threadReducer(base, {
      type: "settleThreadPlanInProgress",
      threadId: "thread-1",
      targetStatus: "completed",
    });
    expect(settledCompleted.planByThread["thread-1"]).toEqual({
      turnId: "turn-9",
      explanation: "plan",
      steps: [
        { step: "step-a", status: "completed" },
        { step: "step-b", status: "completed" },
        { step: "step-c", status: "pending" },
      ],
    });
  });
});
