import { describe, expect, it, vi } from "vitest";
import type { ConversationItem } from "../../../types";
import { initialState, threadReducer } from "./useThreadsReducer";
import type { ThreadState } from "./useThreadsReducer";

describe("threadReducer normalized realtime", () => {
  it("reconciles first-turn image request user across generated image placeholder", () => {
    const base: ThreadState = {
      ...initialState,
      itemsByThread: {
        "thread-1": [
          {
            id: "optimistic-user-1",
            kind: "message",
            role: "user",
            text: "生成一张图，要美女",
          },
          {
            id: "optimistic-generated-image:thread-1:optimistic-user-1",
            kind: "generatedImage",
            status: "processing",
            sourceToolName: "image_generation_call",
            promptText: "生成一张图，要美女",
            anchorUserMessageId: "optimistic-user-1",
            images: [],
          },
        ],
      },
    };

    const next = threadReducer(base, {
      type: "applyNormalizedRealtimeEvent",
      workspaceId: "ws-1",
      threadId: "thread-1",
      hasCustomName: false,
      event: {
        engine: "codex",
        workspaceId: "ws-1",
        threadId: "thread-1",
        eventId: "evt-user-real-1",
        itemKind: "message",
        timestampMs: 1000,
        operation: "itemCompleted",
        sourceMethod: "item/completed",
        item: {
          id: "real-user-1",
          kind: "message",
          role: "user",
          text: "生成一张图，要美女",
        },
      },
    });

    expect(next.itemsByThread["thread-1"]).toEqual([
      {
        id: "real-user-1",
        kind: "message",
        role: "user",
        text: "生成一张图，要美女",
      },
      {
        id: "optimistic-generated-image:thread-1:optimistic-user-1",
        kind: "generatedImage",
        status: "processing",
        sourceToolName: "image_generation_call",
        promptText: "生成一张图，要美女",
        anchorUserMessageId: "real-user-1",
        images: [],
      },
    ]);
  });

  it("replaces first-turn optimistic user when normalized realtime includes injected note-card context", () => {
    const base: ThreadState = {
      ...initialState,
      itemsByThread: {
        "thread-1": [
          {
            id: "optimistic-user-1",
            kind: "message",
            role: "user",
            text: "请结合这条便签分析一下",
          },
        ],
      },
    };

    const next = threadReducer(base, {
      type: "applyNormalizedRealtimeEvent",
      workspaceId: "ws-1",
      threadId: "thread-1",
      hasCustomName: false,
      event: {
        engine: "codex",
        workspaceId: "ws-1",
        threadId: "thread-1",
        eventId: "evt-user-note-card-1",
        itemKind: "message",
        timestampMs: 1000,
        operation: "itemCompleted",
        sourceMethod: "item/completed",
        item: {
          id: "real-user-note-card-1",
          kind: "message",
          role: "user",
          text: [
            "请结合这条便签分析一下",
            "",
            "<note-card-context>",
            '<note-card title="发布清单" archived="false">',
            "先构建，再发布",
            "",
            "Images:",
            "- deploy.png | /tmp/ws/.ccgui/note_card/ws/assets/note-1/deploy.png",
            "</note-card>",
            "</note-card-context>",
          ].join("\n"),
          images: ["/tmp/ws/.ccgui/note_card/ws/assets/note-1/deploy.png"],
        },
      },
    });

    expect(next.itemsByThread["thread-1"]).toEqual([
      {
        id: "real-user-note-card-1",
        kind: "message",
        role: "user",
        text: [
          "请结合这条便签分析一下",
          "",
          "<note-card-context>",
          '<note-card title="发布清单" archived="false">',
          "先构建，再发布",
          "",
          "Images:",
          "- deploy.png | /tmp/ws/.ccgui/note_card/ws/assets/note-1/deploy.png",
          "</note-card>",
          "</note-card-context>",
        ].join("\n"),
        images: ["/tmp/ws/.ccgui/note_card/ws/assets/note-1/deploy.png"],
      },
    ]);
  });

  it("replaces first-turn optimistic user when normalized realtime includes attributed project-memory wrapper", () => {
    const base: ThreadState = {
      ...initialState,
      itemsByThread: {
        "thread-1": [
          {
            id: "optimistic-user-1",
            kind: "message",
            role: "user",
            text: "请基于这些记忆继续分析",
          },
        ],
      },
    };

    const next = threadReducer(base, {
      type: "applyNormalizedRealtimeEvent",
      workspaceId: "ws-1",
      threadId: "thread-1",
      hasCustomName: false,
      event: {
        engine: "codex",
        workspaceId: "ws-1",
        threadId: "thread-1",
        eventId: "evt-user-memory-1",
        itemKind: "message",
        timestampMs: 1000,
        operation: "itemCompleted",
        sourceMethod: "item/completed",
        item: {
          id: "real-user-memory-1",
          kind: "message",
          role: "user",
          text: [
            '<project-memory source="manual-selection" count="2" truncated="false">',
            "[对话记录] 第一条",
            "[项目上下文] 第二条",
            "</project-memory>",
            "",
            "请基于这些记忆继续分析",
          ].join("\n"),
        },
      },
    });

    expect(next.itemsByThread["thread-1"]).toEqual([
      {
        id: "real-user-memory-1",
        kind: "message",
        role: "user",
        text: [
          '<project-memory source="manual-selection" count="2" truncated="false">',
          "[对话记录] 第一条",
          "[项目上下文] 第二条",
          "</project-memory>",
          "",
          "请基于这些记忆继续分析",
        ].join("\n"),
      },
    ]);
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
      itemId: "assistant-snapshot-shifted-1",
      delta: fullSnapshot,
      hasCustomName: false,
    });
    const second = threadReducer(first, {
      type: "appendAgentDelta",
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId: "assistant-snapshot-shifted-1",
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

  it("applies normalized codex completed messages with final metadata", () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(3000);
    const base: ThreadState = {
      ...initialState,
      threadStatusById: {
        "thread-1": {
          isProcessing: true,
          hasUnread: false,
          isReviewing: false,
          processingStartedAt: 1000,
          lastDurationMs: null,
        },
      },
    };

    const next = threadReducer(base, {
      type: "applyNormalizedRealtimeEvent",
      workspaceId: "ws-1",
      threadId: "thread-1",
      hasCustomName: false,
      event: {
        engine: "codex",
        workspaceId: "ws-1",
        threadId: "thread-1",
        eventId: "evt-complete-1",
        itemKind: "message",
        timestampMs: 3000,
        operation: "completeAgentMessage",
        sourceMethod: "item/completed",
        item: {
          id: "assistant-complete-1",
          kind: "message",
          role: "assistant",
          text: "最终结论",
        },
      },
    });

    const item = next.itemsByThread["thread-1"]?.find(
      (entry) => entry.kind === "message" && entry.id === "assistant-complete-1",
    );
    expect(item?.kind).toBe("message");
    if (item?.kind === "message") {
      expect(item.role).toBe("assistant");
      expect(item.text).toBe("最终结论");
      expect(item.isFinal).toBe(true);
      expect(item.finalCompletedAt).toBe(3000);
      expect(item.finalDurationMs).toBe(2000);
    }

    nowSpy.mockRestore();
  });

  it("returns the same reducer state for equivalent codex assistant snapshots", () => {
    const first = threadReducer(initialState, {
      type: "applyNormalizedRealtimeEvent",
      workspaceId: "ws-1",
      threadId: "thread-1",
      hasCustomName: false,
      event: {
        engine: "codex",
        workspaceId: "ws-1",
        threadId: "thread-1",
        eventId: "evt-snapshot-stable-1",
        itemKind: "message",
        timestampMs: 1000,
        operation: "itemUpdated",
        sourceMethod: "item/updated",
        item: {
          id: "assistant-snapshot-stable-1",
          kind: "message",
          role: "assistant",
          text: "等价 snapshot 不应该重放整段。",
        },
      },
    });

    const second = threadReducer(first, {
      type: "applyNormalizedRealtimeEvent",
      workspaceId: "ws-1",
      threadId: "thread-1",
      hasCustomName: false,
      event: {
        engine: "codex",
        workspaceId: "ws-1",
        threadId: "thread-1",
        eventId: "evt-snapshot-stable-2",
        itemKind: "message",
        timestampMs: 1001,
        operation: "itemUpdated",
        sourceMethod: "item/updated",
        item: {
          id: "assistant-snapshot-stable-1",
          kind: "message",
          role: "assistant",
          text: "等价 snapshot 不应该重放整段。",
        },
      },
    });

    expect(second).toBe(first);
  });
});
