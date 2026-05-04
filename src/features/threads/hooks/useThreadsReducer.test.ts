import { describe, expect, it, vi } from "vitest";
import type { ConversationItem, ThreadSummary } from "../../../types";
import {
  __getPrepareThreadItemsCallCountForTests,
  __resetPrepareThreadItemsCallCountForTests,
} from "../../../utils/threadItems";
import { initialState, threadReducer } from "./useThreadsReducer";
import type { ThreadState } from "./useThreadsReducer";

describe("threadReducer", () => {
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

  it("ensures thread with default name and active selection", () => {
    const next = threadReducer(initialState, {
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "thread-1",
    });
    const threads = next.threadsByWorkspace["ws-1"] ?? [];
    expect(threads).toHaveLength(1);
    expect(threads[0]?.name).toBe("Agent 1");
    expect(next.activeThreadIdByWorkspace["ws-1"]).toBe("thread-1");
    expect(next.threadStatusById["thread-1"]?.isProcessing).toBe(false);
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
    expect(next.threadsByWorkspace["ws-1"]?.[0]?.name).toBe("Hello ther");
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

  it("reconciles optimistic user bubble when backend payload wraps user input marker", () => {
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

  it("reconciles optimistic user bubble when backend payload appends selected-agent prompt block", () => {
    const base: ThreadState = {
      ...initialState,
      itemsByThread: {
        "thread-1": [
          {
            id: "user-old-1",
            kind: "message",
            role: "user",
            text: "上一轮真实消息",
          },
          {
            id: "optimistic-user-1",
            kind: "message",
            role: "user",
            text: "你好",
            selectedAgentName: "小张",
            selectedAgentIcon: "agent-robot-02",
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
        id: "user-remote-1",
        kind: "message",
        role: "user",
        text:
          "你好\n\n## Agent Role and Instructions\n\nAgent Name: 小张\n\n你是资深助手，回答要精炼。",
      },
      hasCustomName: false,
    });

    const items = next.itemsByThread["thread-1"] ?? [];
    expect(items.map((item) => item.id)).toEqual(["user-old-1", "user-remote-1"]);
    expect(items[1]?.kind).toBe("message");
    if (items[1]?.kind === "message") {
      expect(items[1].role).toBe("user");
      expect(items[1].text).toContain("## Agent Role and Instructions");
    }
  });

  it("does not drop earlier optimistic user bubbles when incoming real user is unmatched", () => {
    const base: ThreadState = {
      ...initialState,
      itemsByThread: {
        "thread-1": [
          {
            id: "optimistic-user-1",
            kind: "message",
            role: "user",
            text: "1 + 1 = ?",
          },
          {
            id: "assistant-1",
            kind: "message",
            role: "assistant",
            text: "等你下一步",
          },
          {
            id: "optimistic-user-2",
            kind: "message",
            role: "user",
            text: "2 + 2 = ?",
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
        id: "user-external-1",
        kind: "message",
        role: "user",
        text: "这是来自历史补帧的另一条消息",
      },
      hasCustomName: false,
    });

    const items = next.itemsByThread["thread-1"] ?? [];
    expect(items.map((item) => item.id)).toEqual([
      "optimistic-user-1",
      "assistant-1",
      "optimistic-user-2",
      "user-external-1",
    ]);
  });

  it("replaces a single unmatched optimistic user bubble when no real user history exists", () => {
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
        id: "user-actual-1",
        kind: "message",
        role: "user",
        text: "Shared session context sync. Continue from these recent turns before answering the new request:\n\nTurn 1\nUser: hi\nclaude: done\n\nCurrent user request:\nhello codex",
      },
      hasCustomName: false,
    });

    const items = next.itemsByThread["thread-1"] ?? [];
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe("user-actual-1");
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

  it("preserves trailing optimistic user bubble when snapshot has no user messages", () => {
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
            text: "共享会话用户输入",
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
        text: "共享会话用户输入",
      },
    ]);
  });

  it("preserves latest optimistic user when snapshot contains only older user history", () => {
    const base: ThreadState = {
      ...initialState,
      itemsByThread: {
        "thread-1": [
          {
            id: "user-older-1",
            kind: "message",
            role: "user",
            text: "hi2",
          },
          {
            id: "assistant-older-1",
            kind: "message",
            role: "assistant",
            text: "你好",
          },
          {
            id: "optimistic-user-1",
            kind: "message",
            role: "user",
            text: "hello2",
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
        },
      },
    };

    const next = threadReducer(base, {
      type: "setThreadItems",
      threadId: "thread-1",
      items: [
        {
          id: "user-older-1",
          kind: "message",
          role: "user",
          text: "hi2",
        },
        {
          id: "assistant-older-1",
          kind: "message",
          role: "assistant",
          text: "你好",
        },
      ],
    });

    expect(next.itemsByThread["thread-1"]).toEqual([
      {
        id: "user-older-1",
        kind: "message",
        role: "user",
        text: "hi2",
      },
      {
        id: "assistant-older-1",
        kind: "message",
        role: "assistant",
        text: "你好",
      },
      {
        id: "optimistic-user-1",
        kind: "message",
        role: "user",
        text: "hello2",
      },
    ]);
  });

  it("preserves optimistic user before assistant when snapshot still has no user messages", () => {
    const base: ThreadState = {
      ...initialState,
      itemsByThread: {
        "thread-1": [
          {
            id: "optimistic-user-1",
            kind: "message",
            role: "user",
            text: "hi",
          },
          {
            id: "assistant-1",
            kind: "message",
            role: "assistant",
            text: "你好",
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
          text: "你好",
        },
      ],
    });

    expect(next.itemsByThread["thread-1"]).toEqual([
      {
        id: "optimistic-user-1",
        kind: "message",
        role: "user",
        text: "hi",
      },
      {
        id: "assistant-1",
        kind: "message",
        role: "assistant",
        text: "你好",
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

  it("drops preserved optimistic user bubble when snapshot user message carries selected-agent injection block", () => {
    const base: ThreadState = {
      ...initialState,
      itemsByThread: {
        "thread-1": [
          {
            id: "optimistic-user-1",
            kind: "message",
            role: "user",
            text: "请分析这个异常",
            selectedAgentName: "后端架构师",
            selectedAgentIcon: "agent-robot-03",
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
          id: "user-remote-1",
          kind: "message",
          role: "user",
          text:
            "请分析这个异常\n\n## Agent Role and Instructions\n\nAgent Name: 后端架构师\n\nAgent Icon: agent-robot-03\n\n优先定位根因并给出最小修复方案。",
        },
      ],
    });

    expect(next.itemsByThread["thread-1"]).toEqual([
      {
        id: "user-remote-1",
        kind: "message",
        role: "user",
        text:
          "请分析这个异常\n\n## Agent Role and Instructions\n\nAgent Name: 后端架构师\n\nAgent Icon: agent-robot-03\n\n优先定位根因并给出最小修复方案。",
        selectedAgentName: "后端架构师",
        selectedAgentIcon: "agent-robot-03",
      },
    ]);
  });

  it("preserves selected agent metadata when snapshot user message lacks it", () => {
    const base: ThreadState = {
      ...initialState,
      itemsByThread: {
        "thread-1": [
          {
            id: "user-local-1",
            kind: "message",
            role: "user",
            text: "你好你是架构师吗",
            selectedAgentName: "java架构师",
            selectedAgentIcon: "agent-robot-02",
          },
        ],
      },
    };

    const next = threadReducer(base, {
      type: "setThreadItems",
      threadId: "thread-1",
      items: [
        {
          id: "user-remote-1",
          kind: "message",
          role: "user",
          text: "你好你是架构师吗",
        },
      ],
    });

    expect(next.itemsByThread["thread-1"]).toEqual([
      {
        id: "user-remote-1",
        kind: "message",
        role: "user",
        text: "你好你是架构师吗",
        selectedAgentName: "java架构师",
        selectedAgentIcon: "agent-robot-02",
      },
    ]);
  });

  it("preserves per-message selected agent metadata order for duplicate user texts", () => {
    const base: ThreadState = {
      ...initialState,
      itemsByThread: {
        "thread-1": [
          {
            id: "user-local-1",
            kind: "message",
            role: "user",
            text: "收到",
            selectedAgentName: "前端专家",
            selectedAgentIcon: "agent-robot-01",
          },
          {
            id: "user-local-2",
            kind: "message",
            role: "user",
            text: "收到",
            selectedAgentName: "后端架构师",
            selectedAgentIcon: "agent-robot-03",
          },
        ],
      },
    };

    const next = threadReducer(base, {
      type: "setThreadItems",
      threadId: "thread-1",
      items: [
        {
          id: "user-remote-1",
          kind: "message",
          role: "user",
          text: "收到",
        },
        {
          id: "user-remote-2",
          kind: "message",
          role: "user",
          text: "收到",
        },
      ],
    });

    expect(next.itemsByThread["thread-1"]).toEqual([
      {
        id: "user-remote-1",
        kind: "message",
        role: "user",
        text: "收到",
        selectedAgentName: "前端专家",
        selectedAgentIcon: "agent-robot-01",
      },
      {
        id: "user-remote-2",
        kind: "message",
        role: "user",
        text: "收到",
        selectedAgentName: "后端架构师",
        selectedAgentIcon: "agent-robot-03",
      },
    ]);
  });

  it("does not hydrate duplicate user metadata when snapshot user sequence drifts", () => {
    const base: ThreadState = {
      ...initialState,
      itemsByThread: {
        "thread-1": [
          {
            id: "user-local-1",
            kind: "message",
            role: "user",
            text: "收到",
            selectedAgentName: "前端专家",
            selectedAgentIcon: "agent-robot-01",
          },
          {
            id: "user-local-2",
            kind: "message",
            role: "user",
            text: "执行",
          },
          {
            id: "user-local-3",
            kind: "message",
            role: "user",
            text: "收到",
            selectedAgentName: "后端架构师",
            selectedAgentIcon: "agent-robot-03",
          },
        ],
      },
    };

    const next = threadReducer(base, {
      type: "setThreadItems",
      threadId: "thread-1",
      items: [
        {
          id: "user-remote-1",
          kind: "message",
          role: "user",
          text: "收到",
        },
        {
          id: "user-remote-2",
          kind: "message",
          role: "user",
          text: "收到",
        },
        {
          id: "user-remote-3",
          kind: "message",
          role: "user",
          text: "执行",
        },
      ],
    });

    expect(next.itemsByThread["thread-1"]).toEqual([
      {
        id: "user-remote-1",
        kind: "message",
        role: "user",
        text: "收到",
      },
      {
        id: "user-remote-2",
        kind: "message",
        role: "user",
        text: "收到",
      },
      {
        id: "user-remote-3",
        kind: "message",
        role: "user",
        text: "执行",
      },
    ]);
  });

  it("preserves local requestUserInputSubmitted record while thread is processing", () => {
    const base: ThreadState = {
      ...initialState,
      itemsByThread: {
        "thread-1": [
          {
            id: "assistant-1",
            kind: "message",
            role: "assistant",
            text: "请先回答一个问题。",
          },
          {
            id: "user-input-answer-req-1",
            kind: "tool",
            toolType: "requestUserInputSubmitted",
            title: "请求输入",
            detail: "{\"schema\":\"requestUserInputSubmitted/v1\"}",
            status: "completed",
            output: "[用户输入已提交]\n问题A\n选项1",
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
          text: "请先回答一个问题。",
        },
      ],
    });

    const items = next.itemsByThread["thread-1"] ?? [];
    expect(items.some((item) => item.id === "user-input-answer-req-1")).toBe(true);
  });

  it("does not preserve local requestUserInputSubmitted record for settled history snapshot", () => {
    const base: ThreadState = {
      ...initialState,
      itemsByThread: {
        "thread-1": [
          {
            id: "assistant-1",
            kind: "message",
            role: "assistant",
            text: "请先回答一个问题。",
          },
          {
            id: "user-input-answer-req-1",
            kind: "tool",
            toolType: "requestUserInputSubmitted",
            title: "请求输入",
            detail: "{\"schema\":\"requestUserInputSubmitted/v1\"}",
            status: "completed",
            output: "[用户输入已提交]\n问题A\n选项1",
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
          text: "请先回答一个问题。",
        },
      ],
    });

    const items = next.itemsByThread["thread-1"] ?? [];
    expect(items.some((item) => item.id === "user-input-answer-req-1")).toBe(false);
  });

  it("marks latest assistant message as final without clearing previous turn finals", () => {
    const base: ThreadState = {
      ...initialState,
      itemsByThread: {
        "thread-1": [
          {
            id: "assistant-turn-1",
            kind: "message",
            role: "assistant",
            text: "第一轮回答",
            isFinal: true,
          },
          {
            id: "user-turn-2",
            kind: "message",
            role: "user",
            text: "继续",
          },
          {
            id: "assistant-turn-2",
            kind: "message",
            role: "assistant",
            text: "第二轮回答",
            isFinal: false,
          },
        ],
      },
    };

    const next = threadReducer(base, {
      type: "markLatestAssistantMessageFinal",
      threadId: "thread-1",
    });

    const items = next.itemsByThread["thread-1"] ?? [];
    const turn1 = items[0];
    const turn2 = items[2];
    expect(turn1?.kind).toBe("message");
    expect(turn2?.kind).toBe("message");
    if (turn1?.kind === "message" && turn2?.kind === "message") {
      expect(turn1.isFinal).toBe(true);
      expect(turn2.isFinal).toBe(true);
      expect(typeof turn2.finalCompletedAt).toBe("number");
    }
  });

  it("keeps state identity when latest assistant is already final", () => {
    const frozenNow = Date.parse("2026-04-01T10:20:30.000Z");
    const base: ThreadState = {
      ...initialState,
      itemsByThread: {
        "thread-1": [
          {
            id: "assistant-1",
            kind: "message",
            role: "assistant",
            text: "done",
            isFinal: true,
            finalCompletedAt: frozenNow,
            finalDurationMs: 2_000,
          },
        ],
      },
    };

    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(frozenNow + 500);
    try {
      const next = threadReducer(base, {
        type: "markLatestAssistantMessageFinal",
        threadId: "thread-1",
      });
      expect(next).toBe(base);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("captures final completion time and duration from thread status", () => {
    const frozenNow = Date.parse("2026-04-01T10:20:30.000Z");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(frozenNow);
    try {
      const base: ThreadState = {
        ...initialState,
        threadStatusById: {
          "thread-1": {
            isProcessing: false,
            hasUnread: false,
            isReviewing: false,
            isContextCompacting: false,
            processingStartedAt: null,
            lastDurationMs: 4_250,
            heartbeatPulse: 0,
          },
        },
        itemsByThread: {
          "thread-1": [
            {
              id: "assistant-1",
              kind: "message",
              role: "assistant",
              text: "done",
              isFinal: false,
            },
          ],
        },
      };

      const next = threadReducer(base, {
        type: "markLatestAssistantMessageFinal",
        threadId: "thread-1",
      });

      const finalMessage = next.itemsByThread["thread-1"]?.[0];
      expect(finalMessage?.kind).toBe("message");
      if (finalMessage?.kind === "message") {
        expect(finalMessage.isFinal).toBe(true);
        expect(finalMessage.finalCompletedAt).toBe(frozenNow);
        expect(finalMessage.finalDurationMs).toBe(4_250);
      }
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("preserves final metadata when a completed snapshot arrives after turn settled", () => {
    const frozenNow = Date.parse("2026-04-01T10:20:30.000Z");
    const base: ThreadState = {
      ...initialState,
      threadStatusById: {
        "thread-1": {
          isProcessing: false,
          hasUnread: false,
          isReviewing: false,
          isContextCompacting: false,
          processingStartedAt: null,
          lastDurationMs: 1_880,
          heartbeatPulse: 0,
        },
      },
      itemsByThread: {
        "thread-1": [
          {
            id: "assistant-1",
            kind: "message",
            role: "assistant",
            text: "done",
            isFinal: true,
            finalCompletedAt: frozenNow,
            finalDurationMs: 1_880,
          },
        ],
      },
    };

    const next = threadReducer(base, {
      type: "completeAgentMessage",
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId: "assistant-1",
      text: "done",
      hasCustomName: false,
    });

    const message = next.itemsByThread["thread-1"]?.[0];
    expect(message?.kind).toBe("message");
    if (message?.kind === "message") {
      expect(message.isFinal).toBe(true);
      expect(message.finalCompletedAt).toBe(frozenNow);
      expect(message.finalDurationMs).toBe(1_880);
    }
  });

  it("clears final metadata when assistant text continues while thread is still processing", () => {
    const frozenNow = Date.parse("2026-04-01T10:20:30.000Z");
    const base: ThreadState = {
      ...initialState,
      threadStatusById: {
        "thread-1": {
          isProcessing: true,
          hasUnread: false,
          isReviewing: false,
          isContextCompacting: false,
          processingStartedAt: frozenNow - 300,
          lastDurationMs: null,
          heartbeatPulse: 1,
        },
      },
      itemsByThread: {
        "thread-1": [
          {
            id: "assistant-1",
            kind: "message",
            role: "assistant",
            text: "done",
            isFinal: true,
            finalCompletedAt: frozenNow,
            finalDurationMs: 1_880,
          },
        ],
      },
    };

    const next = threadReducer(base, {
      type: "appendAgentDelta",
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId: "assistant-1",
      delta: " + more",
      hasCustomName: false,
    });

    const message = next.itemsByThread["thread-1"]?.[0];
    expect(message?.kind).toBe("message");
    if (message?.kind === "message") {
      expect(message.isFinal).toBe(false);
      expect(message.finalCompletedAt).toBeUndefined();
      expect(message.finalDurationMs).toBeUndefined();
      expect(message.text).toBe("done + more");
    }
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

  it("keeps claude live assistant chunks keyed by backend item id", () => {
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
    expect(messages).toHaveLength(2);
    expect(messages[0]?.id).toBe("assistant-chunk-1");
    expect(messages[0]?.text).toBe("高");
    expect(messages[1]?.id).toBe("assistant-chunk-2");
    expect(messages[1]?.text).toBe("高概率这是前端渲染问题。");
  });

  it("does not overwrite previous claude turn output when active turn advances", () => {
    const base: ThreadState = {
      ...initialState,
      activeTurnIdByThread: { "claude:thread-race": "turn-1" },
    };
    const firstDelta = threadReducer(base, {
      type: "appendAgentDelta",
      workspaceId: "ws-1",
      threadId: "claude:thread-race",
      itemId: "assistant-turn-1",
      delta: "第一轮开场",
      hasCustomName: false,
    });
    const switchedTurn = threadReducer(firstDelta, {
      type: "setActiveTurnId",
      threadId: "claude:thread-race",
      turnId: "turn-2",
    });
    const lateFirstCompleted = threadReducer(switchedTurn, {
      type: "completeAgentMessage",
      workspaceId: "ws-1",
      threadId: "claude:thread-race",
      itemId: "assistant-turn-1",
      text: "第一轮完整回复",
      hasCustomName: false,
    });
    const secondDelta = threadReducer(lateFirstCompleted, {
      type: "appendAgentDelta",
      workspaceId: "ws-1",
      threadId: "claude:thread-race",
      itemId: "assistant-turn-2",
      delta: "第二轮开始",
      hasCustomName: false,
    });

    const messages = (secondDelta.itemsByThread["claude:thread-race"] ?? []).filter(
      (item): item is Extract<ConversationItem, { kind: "message" }> =>
        item.kind === "message" && item.role === "assistant",
    );
    expect(messages).toHaveLength(2);
    expect(messages[0]?.id).toBe("assistant-turn-1");
    expect(messages[0]?.text).toContain("第一轮完整回复");
    expect(messages[1]?.id).toBe("assistant-turn-2");
    expect(messages[1]?.text).toBe("第二轮开始");
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

  it("keeps live and restored assistant text aligned for inline code snapshots", () => {
    const itemId = "assistant-inline-code-parity-1";
    const finalText = "命令是 `pnpm\n\nrun\n\nlint`，执行后继续。";
    const withFirstDelta = threadReducer(initialState, {
      type: "appendAgentDelta",
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId,
      delta: "命令是 `pnpm",
      hasCustomName: false,
    });
    const withSecondDelta = threadReducer(withFirstDelta, {
      type: "appendAgentDelta",
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId,
      delta: "\n\nrun",
      hasCustomName: false,
    });
    const withSnapshot = threadReducer(withSecondDelta, {
      type: "appendAgentDelta",
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId,
      delta: finalText,
      hasCustomName: false,
    });

    const liveMessages = (withSnapshot.itemsByThread["thread-1"] ?? []).filter(
      (item): item is Extract<ConversationItem, { kind: "message" }> =>
        item.kind === "message" && item.role === "assistant" && item.id === itemId,
    );
    expect(liveMessages).toHaveLength(1);
    expect(liveMessages[0]?.text).toBe(finalText);

    const completed = threadReducer(withSnapshot, {
      type: "completeAgentMessage",
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId,
      text: finalText,
      hasCustomName: false,
    });
    const restored = threadReducer(completed, {
      type: "upsertItem",
      workspaceId: "ws-1",
      threadId: "thread-1",
      item: {
        id: itemId,
        kind: "message",
        role: "assistant",
        text: finalText,
      },
      hasCustomName: false,
    });

    const messages = (restored.itemsByThread["thread-1"] ?? []).filter(
      (item): item is Extract<ConversationItem, { kind: "message" }> =>
        item.kind === "message" && item.role === "assistant" && item.id === itemId,
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]?.text).toBe(finalText);
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

  it("segments claude reasoning deltas when stream segment advances", () => {
    const threadId = "claude:session-reasoning-seg";
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

    const withFirst = threadReducer(processingState, {
      type: "appendReasoningContent",
      threadId,
      itemId: "reasoning-seg",
      delta: "先读取项目结构",
    });
    const withSegment = threadReducer(withFirst, {
      type: "incrementAgentSegment",
      threadId,
    });
    const withSecond = threadReducer(withSegment, {
      type: "appendReasoningContent",
      threadId,
      itemId: "reasoning-seg",
      delta: "再检查关键配置",
    });

    const reasoningItems = (withSecond.itemsByThread[threadId] ?? []).filter(
      (item): item is Extract<ConversationItem, { kind: "reasoning" }> =>
        item.kind === "reasoning",
    );
    expect(reasoningItems).toHaveLength(2);
    expect(reasoningItems[0]?.id).toBe("reasoning-seg");
    expect(reasoningItems[0]?.content).toContain("先读取项目结构");
    expect(reasoningItems[1]?.id).toBe("reasoning-seg-seg-1");
    expect(reasoningItems[1]?.content).toContain("再检查关键配置");
  });

  it("reconciles legacy text-delta id with later canonical assistant id", () => {
    const first = threadReducer(initialState, {
      type: "appendAgentDelta",
      workspaceId: "ws-1",
      threadId: "claude:session-1",
      itemId: "claude:session-1:text-delta",
      delta: "你好！我看到你列出了三个饮料品牌。",
      hasCustomName: false,
    });
    const second = threadReducer(first, {
      type: "appendAgentDelta",
      workspaceId: "ws-1",
      threadId: "claude:session-1",
      itemId: "assistant-msg-1",
      delta: "你好！我看到你列出了三个饮料品牌。请问你需要什么帮助呢？",
      hasCustomName: false,
    });

    const messages = (second.itemsByThread["claude:session-1"] ?? []).filter(
      (item): item is Extract<ConversationItem, { kind: "message" }> =>
        item.kind === "message" && item.role === "assistant",
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]?.id).toBe("assistant-msg-1");
    expect(messages[0]?.text).toBe(
      "你好！我看到你列出了三个饮料品牌。请问你需要什么帮助呢？",
    );
  });

  it("reconciles legacy text-delta id when completed assistant id arrives", () => {
    const streamed = "你好！我看到你列出了三个饮料品牌。";
    const first = threadReducer(initialState, {
      type: "appendAgentDelta",
      workspaceId: "ws-1",
      threadId: "claude:session-1",
      itemId: "claude:session-1:text-delta",
      delta: streamed,
      hasCustomName: false,
    });
    const completed = threadReducer(first, {
      type: "completeAgentMessage",
      workspaceId: "ws-1",
      threadId: "claude:session-1",
      itemId: "assistant-msg-1",
      text: `${streamed}请问你需要什么帮助呢？`,
      hasCustomName: false,
    });

    const messages = (completed.itemsByThread["claude:session-1"] ?? []).filter(
      (item): item is Extract<ConversationItem, { kind: "message" }> =>
        item.kind === "message" && item.role === "assistant",
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]?.id).toBe("assistant-msg-1");
    expect(messages[0]?.text).toBe("你好！我看到你列出了三个饮料品牌。请问你需要什么帮助呢？");
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

  it("keeps state identity for repeated markProcessing true updates", () => {
    const started = threadReducer(initialState, {
      type: "markProcessing",
      threadId: "thread-1",
      isProcessing: true,
      timestamp: 1000,
    });
    const repeated = threadReducer(started, {
      type: "markProcessing",
      threadId: "thread-1",
      isProcessing: true,
      timestamp: 1200,
    });
    expect(repeated).toBe(started);
  });

  it("keeps state identity when duplicate tool output delta does not change content", () => {
    const baseTool: ConversationItem = {
      id: "cmd-1",
      kind: "tool",
      toolType: "commandExecution",
      title: "Command",
      detail: "",
      status: "running",
      output: "hello",
    };
    const baseState: ThreadState = {
      ...initialState,
      itemsByThread: {
        "thread-1": [baseTool],
      },
    };
    const next = threadReducer(baseState, {
      type: "appendToolOutput",
      threadId: "thread-1",
      itemId: "cmd-1",
      delta: "hello",
    });
    expect(next).toBe(baseState);
  });

  it("uses a fast path for repeated same-item running tool output deltas", () => {
    const baseTool: ConversationItem = {
      id: "cmd-1",
      kind: "tool",
      toolType: "commandExecution",
      title: "Command",
      detail: "",
      status: "running",
      output: "hello",
    };
    const baseState: ThreadState = {
      ...initialState,
      itemsByThread: {
        "thread-1": [baseTool],
      },
    };

    __resetPrepareThreadItemsCallCountForTests();
    const next = threadReducer(baseState, {
      type: "appendToolOutput",
      threadId: "thread-1",
      itemId: "cmd-1",
      delta: " world",
    });

    expect(__getPrepareThreadItemsCallCountForTests()).toBe(0);
    const item = next.itemsByThread["thread-1"]?.[0];
    expect(item?.kind).toBe("tool");
    if (item?.kind === "tool") {
      expect(item.output).toBe("hello world");
      expect(item.status).toBe("running");
    }
  });

  it("keeps canonical derivation when creating a tool output placeholder", () => {
    __resetPrepareThreadItemsCallCountForTests();
    const next = threadReducer(initialState, {
      type: "appendToolOutput",
      threadId: "thread-1",
      itemId: "cmd-1",
      delta: "initial output",
    });

    expect(__getPrepareThreadItemsCallCountForTests()).toBe(1);
    expect(next.itemsByThread["thread-1"]?.[0]?.kind).toBe("tool");
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


});
