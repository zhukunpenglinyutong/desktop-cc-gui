import { describe, expect, it } from "vitest";
import type { ConversationItem } from "../../../types";
import type { ConversationState, NormalizedThreadEvent } from "./conversationCurtainContracts";
import {
  appendEvent,
  findConversationStateDiffs,
  hydrateHistory,
} from "./conversationAssembler";

function createState(): ConversationState {
  return {
    items: [],
    plan: null,
    userInputQueue: [],
    meta: {
      workspaceId: "ws-1",
      threadId: "thread-1",
      engine: "codex",
      activeTurnId: null,
      isThinking: false,
      heartbeatPulse: null,
      historyRestoredAtMs: null,
    },
  };
}

function createEvent(partial: Partial<NormalizedThreadEvent>): NormalizedThreadEvent {
  return {
    engine: "codex",
    workspaceId: "ws-1",
    threadId: "thread-1",
    eventId: "evt-1",
    itemKind: "message",
    timestampMs: 1,
    item: {
      id: "item-1",
      kind: "message",
      role: "assistant",
      text: "",
    },
    operation: "itemUpdated",
    sourceMethod: "item/updated",
    ...partial,
  };
}

describe("conversationAssembler", () => {
  it("keeps tool ordering stable and converges status across started/delta/completed", () => {
    let state = createState();
    state = appendEvent(
      state,
      createEvent({
        itemKind: "tool",
        operation: "itemStarted",
        item: {
          id: "tool-1",
          kind: "tool",
          toolType: "commandExecution",
          title: "Command",
          detail: "npm run test",
          status: "started",
        },
      }),
    );
    state = appendEvent(
      state,
      createEvent({
        itemKind: "tool",
        operation: "appendToolOutputDelta",
        item: {
          id: "tool-1",
          kind: "tool",
          toolType: "commandExecution",
          title: "Command",
          detail: "",
          output: "",
          status: "started",
        },
        delta: "running...",
      }),
    );
    state = appendEvent(
      state,
      createEvent({
        itemKind: "tool",
        operation: "itemCompleted",
        item: {
          id: "tool-1",
          kind: "tool",
          toolType: "commandExecution",
          title: "Command",
          detail: "npm run test",
          output: "running...",
          status: "completed",
        },
      }),
    );

    expect(state.items).toHaveLength(1);
    const onlyItem = state.items[0];
    expect(onlyItem?.kind).toBe("tool");
    if (onlyItem?.kind === "tool") {
      expect(onlyItem.status).toBe("completed");
      expect(onlyItem.output).toContain("running...");
    }
  });

  it("preserves command output when tool snapshots omit output fields", () => {
    let state = createState();
    state = appendEvent(
      state,
      createEvent({
        itemKind: "tool",
        operation: "itemStarted",
        item: {
          id: "tool-output-1",
          kind: "tool",
          toolType: "commandExecution",
          title: "Command",
          detail: "ls -la",
          status: "started",
        },
      }),
    );
    state = appendEvent(
      state,
      createEvent({
        itemKind: "tool",
        operation: "appendToolOutputDelta",
        item: {
          id: "tool-output-1",
          kind: "tool",
          toolType: "commandExecution",
          title: "Command",
          detail: "",
          output: "",
          status: "started",
        },
        delta: "line 1\n",
      }),
    );
    state = appendEvent(
      state,
      createEvent({
        itemKind: "tool",
        operation: "itemUpdated",
        item: {
          id: "tool-output-1",
          kind: "tool",
          toolType: "commandExecution",
          title: "Command",
          detail: "ls -la",
          output: "",
          status: "running",
        },
      }),
    );
    state = appendEvent(
      state,
      createEvent({
        itemKind: "tool",
        operation: "itemCompleted",
        item: {
          id: "tool-output-1",
          kind: "tool",
          toolType: "commandExecution",
          title: "Command",
          detail: "ls -la",
          output: "",
          status: "completed",
        },
      }),
    );

    const tool = state.items.find(
      (item): item is Extract<ConversationItem, { kind: "tool" }> =>
        item.kind === "tool" && item.id === "tool-output-1",
    );
    expect(tool?.status).toBe("completed");
    expect(tool?.output).toBe("line 1\n");
  });

  it("appends message/reasoning deltas and updates active turn id", () => {
    let state = createState();
    state = appendEvent(
      state,
      createEvent({
        eventId: "msg-1-delta-1",
        operation: "appendAgentMessageDelta",
        turnId: "turn-1",
        item: {
          id: "msg-1",
          kind: "message",
          role: "assistant",
          text: "",
        },
        delta: "Hello ",
      }),
    );
    state = appendEvent(
      state,
      createEvent({
        eventId: "msg-1-delta-2",
        operation: "appendAgentMessageDelta",
        turnId: "turn-1",
        item: {
          id: "msg-1",
          kind: "message",
          role: "assistant",
          text: "",
        },
        delta: "world",
      }),
    );
    state = appendEvent(
      state,
      createEvent({
        eventId: "reasoning-1-summary",
        operation: "appendReasoningSummaryDelta",
        itemKind: "reasoning",
        item: {
          id: "reasoning-1",
          kind: "reasoning",
          summary: "",
          content: "",
        },
        delta: "Analyzing",
      }),
    );
    state = appendEvent(
      state,
      createEvent({
        eventId: "reasoning-1-content",
        operation: "appendReasoningContentDelta",
        itemKind: "reasoning",
        item: {
          id: "reasoning-1",
          kind: "reasoning",
          summary: "",
          content: "",
        },
        delta: " detailed context",
      }),
    );

    const message = state.items.find((item) => item.id === "msg-1");
    expect(message).toEqual(
      expect.objectContaining({
        kind: "message",
        text: "Hello world",
      }),
    );
    const reasoning = state.items.find((item) => item.id === "reasoning-1");
    expect(reasoning).toEqual(
      expect.objectContaining({
        kind: "reasoning",
        summary: "Analyzing",
        content: " detailed context",
      }),
    );
    expect(state.meta.activeTurnId).toBe("turn-1");
  });

  it("keeps claude reasoning snapshots append-only instead of replacing previous content", () => {
    let state = createState();
    state = appendEvent(
      state,
      createEvent({
        engine: "claude",
        threadId: "claude:session-append-only",
        eventId: "reasoning-snapshot-1",
        operation: "itemUpdated",
        itemKind: "reasoning",
        item: {
          id: "reasoning-append-only-1",
          kind: "reasoning",
          summary: "先读取项目结构",
          content: "先读取 README 和 docs 目录",
        },
      }),
    );
    state = appendEvent(
      state,
      createEvent({
        engine: "claude",
        threadId: "claude:session-append-only",
        eventId: "reasoning-snapshot-2",
        operation: "itemUpdated",
        itemKind: "reasoning",
        item: {
          id: "reasoning-append-only-1",
          kind: "reasoning",
          summary: "再检查关键配置",
          content: "再检查 package.json 和脚本入口",
        },
      }),
    );

    const reasoning = state.items.find((item) => item.id === "reasoning-append-only-1");
    expect(reasoning?.kind).toBe("reasoning");
    if (reasoning?.kind === "reasoning") {
      expect(reasoning.summary).toContain("先读取项目结构");
      expect(reasoning.summary).toContain("再检查关键配置");
      expect(reasoning.content).toContain("先读取 README 和 docs 目录");
      expect(reasoning.content).toContain("再检查 package.json 和脚本入口");
      expect(reasoning.content).not.toBe("再检查 package.json 和脚本入口");
    }
  });

  it("merges assistant delta snapshots without duplicate concatenation", () => {
    let state = createState();
    state = appendEvent(
      state,
      createEvent({
        eventId: "msg-dup-delta-1",
        operation: "appendAgentMessageDelta",
        item: {
          id: "msg-dup",
          kind: "message",
          role: "assistant",
          text: "",
        },
        delta: "你好，我在。",
      }),
    );
    state = appendEvent(
      state,
      createEvent({
        eventId: "msg-dup-delta-2",
        operation: "appendAgentMessageDelta",
        item: {
          id: "msg-dup",
          kind: "message",
          role: "assistant",
          text: "",
        },
        delta: "你好，我在。 要我先帮你做哪件事？",
      }),
    );

    const message = state.items.find((item) => item.id === "msg-dup");
    expect(message).toEqual(
      expect.objectContaining({
        kind: "message",
        text: "你好，我在。 要我先帮你做哪件事？",
      }),
    );
  });

  it("dedupes repeated completed assistant text", () => {
    let state = createState();
    state = appendEvent(
      state,
      createEvent({
        eventId: "msg-complete-delta-1",
        operation: "appendAgentMessageDelta",
        item: {
          id: "msg-complete",
          kind: "message",
          role: "assistant",
          text: "",
        },
        delta: "你好，我在。要我先帮你做哪件事？",
      }),
    );
    state = appendEvent(
      state,
      createEvent({
        eventId: "msg-complete-final",
        operation: "completeAgentMessage",
        item: {
          id: "msg-complete",
          kind: "message",
          role: "assistant",
          text: "你好，我在。要我先帮你做哪件事？ 你好，我在。要我先帮你做哪件事？",
        },
      }),
    );

    const message = state.items.find((item) => item.id === "msg-complete");
    expect(message).toEqual(
      expect.objectContaining({
        kind: "message",
        text: "你好，我在。要我先帮你做哪件事？",
      }),
    );
  });

  it("hydrates history with dedupe and keeps plan/userInput/meta", () => {
    const snapshot = {
      engine: "claude" as const,
      workspaceId: "ws-2",
      threadId: "claude:session-1",
      items: [
        { id: "msg-1", kind: "message", role: "assistant", text: "old" } as const,
        { id: "msg-1", kind: "message", role: "assistant", text: "new" } as const,
      ],
      plan: {
        turnId: "turn-2",
        explanation: "Plan",
        steps: [{ step: "Inspect", status: "inProgress" as const }],
      },
      userInputQueue: [
        {
          workspace_id: "ws-2",
          request_id: 1,
          params: {
            thread_id: "claude:session-1",
            turn_id: "turn-2",
            item_id: "item-2",
            questions: [],
          },
        },
      ],
      meta: {
        workspaceId: "ws-2",
        threadId: "claude:session-1",
        engine: "claude" as const,
        activeTurnId: "turn-2",
        isThinking: false,
        heartbeatPulse: null,
        historyRestoredAtMs: 10,
      },
      fallbackWarnings: [],
    };

    const state = hydrateHistory(snapshot);
    expect(state.items).toHaveLength(1);
    expect(state.items[0]).toEqual(
      expect.objectContaining({
        id: "msg-1",
        text: "new",
      }),
    );
    expect(state.plan?.turnId).toBe("turn-2");
    expect(state.userInputQueue).toHaveLength(1);
    expect(state.meta.threadId).toBe("claude:session-1");
  });

  it("uses whitelist to ignore acceptable realtime/history meta differences", () => {
    const base = createState();
    const realtime: ConversationState = {
      ...base,
      meta: {
        ...base.meta,
        heartbeatPulse: 1,
        historyRestoredAtMs: 100,
      },
    };
    const history: ConversationState = {
      ...base,
      meta: {
        ...base.meta,
        heartbeatPulse: 3,
        historyRestoredAtMs: 200,
      },
    };
    expect(findConversationStateDiffs(realtime, history)).toEqual([]);

    const withPlanMismatch: ConversationState = {
      ...history,
      plan: {
        turnId: "turn-1",
        explanation: "Different plan",
        steps: [{ step: "Only history", status: "inProgress" }],
      },
    };
    expect(findConversationStateDiffs(realtime, withPlanMismatch)).toEqual([
      "plan",
    ]);
  });
});
