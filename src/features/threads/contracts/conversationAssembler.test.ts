import { describe, expect, it } from "vitest";
import type { ConversationItem, TurnPlan } from "../../../types";
import type {
  ConversationState,
  NormalizedHistorySnapshot,
  NormalizedThreadEvent,
} from "./conversationCurtainContracts";
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
        content: "detailed context",
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

  it("normalizes assistant snapshots with duplicated paragraph blocks before rendering", () => {
    let state = createState();
    state = appendEvent(
      state,
      createEvent({
        eventId: "assistant-snapshot-intro",
        operation: "itemUpdated",
        item: {
          id: "assistant-snapshot-dup",
          kind: "message",
          role: "assistant",
          text: "我先按项目工作流只读摸底：确认规范入口、当前任务和文档落点。",
        },
      }),
    );
    state = appendEvent(
      state,
      createEvent({
        eventId: "assistant-snapshot-dup",
        operation: "itemUpdated",
        item: {
          id: "assistant-snapshot-dup",
          kind: "message",
          role: "assistant",
          text: [
            "我先按项目工作流只读摸底：确认规范入口、当前任务和文档落点。",
            "",
            "`wf-thinking` 的项目内相对路径不存在，我改用技能注册里的绝对路径读取，不影响继续推进。",
            "",
            "`wf-thinking` 的项目内相对路径不存在，我改用技能注册里的绝对路径读取，不影响继续推进。",
          ].join("\n"),
        },
      }),
    );

    const message = state.items.find((item) => item.id === "assistant-snapshot-dup");
    expect(message).toEqual(
      expect.objectContaining({
        kind: "message",
        text: [
          "我先按项目工作流只读摸底：确认规范入口、当前任务和文档落点。",
          "",
          "`wf-thinking` 的项目内相对路径不存在，我改用技能注册里的绝对路径读取，不影响继续推进。",
        ].join("\n"),
      }),
    );
  });

  it("normalizes duplicated assistant snapshots with CRLF line endings", () => {
    let state = createState();
    state = appendEvent(
      state,
      createEvent({
        eventId: "assistant-snapshot-crlf",
        operation: "itemUpdated",
        item: {
          id: "assistant-snapshot-crlf",
          kind: "message",
          role: "assistant",
          text: [
            "先确认项目规范入口。",
            "",
            "然后整理当前任务边界。",
            "",
            "然后整理当前任务边界。",
          ].join("\r\n"),
        },
      }),
    );

    const message = state.items.find((item) => item.id === "assistant-snapshot-crlf");
    expect(message).toEqual(
      expect.objectContaining({
        kind: "message",
        text: "先确认项目规范入口。\n\n然后整理当前任务边界。",
      }),
    );
  });

  it("keeps assistant snapshot state stable when the incoming snapshot is equivalent", () => {
    let state = createState();
    state = appendEvent(
      state,
      createEvent({
        eventId: "assistant-snapshot-stable-1",
        operation: "itemUpdated",
        item: {
          id: "assistant-snapshot-stable-1",
          kind: "message",
          role: "assistant",
          text: "最终总结已经成型。",
        },
      }),
    );

    const next = appendEvent(
      state,
      createEvent({
        eventId: "assistant-snapshot-stable-2",
        operation: "itemUpdated",
        item: {
          id: "assistant-snapshot-stable-1",
          kind: "message",
          role: "assistant",
          text: "最终总结已经成型。",
        },
      }),
    );

    expect(next.items).toBe(state.items);
  });

  it("keeps completed assistant text stable when the final payload matches the snapshot", () => {
    let state = createState();
    state = appendEvent(
      state,
      createEvent({
        eventId: "assistant-complete-stable-1",
        operation: "itemUpdated",
        item: {
          id: "assistant-complete-stable-1",
          kind: "message",
          role: "assistant",
          text: "最终结论已经完整。",
        },
      }),
    );

    const next = appendEvent(
      state,
      createEvent({
        eventId: "assistant-complete-stable-2",
        operation: "completeAgentMessage",
        sourceMethod: "item/completed",
        item: {
          id: "assistant-complete-stable-1",
          kind: "message",
          role: "assistant",
          text: "最终结论已经完整。",
        },
      }),
    );

    expect(next.items).toBe(state.items);
  });

  it("collapses duplicated inline-code delta chunks before appending to prior content", () => {
    let state = createState();
    state = appendEvent(
      state,
      createEvent({
        eventId: "msg-inline-prefix-1",
        operation: "appendAgentMessageDelta",
        item: {
          id: "msg-inline-dup",
          kind: "message",
          role: "assistant",
          text: "",
        },
        delta: "我先按 Trellis 流程把上下文收紧。",
      }),
    );
    state = appendEvent(
      state,
      createEvent({
        eventId: "msg-inline-prefix-2",
        operation: "appendAgentMessageDelta",
        item: {
          id: "msg-inline-dup",
          kind: "message",
          role: "assistant",
          text: "",
        },
        delta:
          "`wf-thinking` 这个 skill 路径不在项目内，我改去全局技能目录读。`wf-thinking` 这个 skill 路径不在项目内，我改去全局技能目录读。",
      }),
    );

    const message = state.items.find((item) => item.id === "msg-inline-dup");
    expect(message).toEqual(
      expect.objectContaining({
        kind: "message",
        text:
          "我先按 Trellis 流程把上下文收紧。`wf-thinking` 这个 skill 路径不在项目内，我改去全局技能目录读。",
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

  it("keeps Claude reasoning and assistant items separate when they share the same item id", () => {
    let state = createState();
    state = appendEvent(
      state,
      createEvent({
        engine: "claude",
        threadId: "claude:session-shared-id",
        eventId: "shared-id-reasoning",
        operation: "appendReasoningContentDelta",
        itemKind: "reasoning",
        item: {
          id: "claude-item-shared",
          kind: "reasoning",
          summary: "",
          content: "",
        },
        delta: "我先检查后端结构。",
      }),
    );
    state = appendEvent(
      state,
      createEvent({
        engine: "claude",
        threadId: "claude:session-shared-id",
        eventId: "shared-id-agent",
        operation: "appendAgentMessageDelta",
        itemKind: "message",
        item: {
          id: "claude-item-shared",
          kind: "message",
          role: "assistant",
          text: "",
        },
        delta: "# 分析报告\n\n后端主要使用 FastAPI。",
      }),
    );
    state = appendEvent(
      state,
      createEvent({
        engine: "claude",
        threadId: "claude:session-shared-id",
        eventId: "shared-id-agent-complete",
        operation: "completeAgentMessage",
        itemKind: "message",
        item: {
          id: "claude-item-shared",
          kind: "message",
          role: "assistant",
          text: "# 分析报告\n\n后端主要使用 FastAPI。数据库是 PostgreSQL。",
        },
      }),
    );

    expect(state.items).toHaveLength(2);
    expect(
      state.items.find(
        (item): item is Extract<ConversationItem, { kind: "reasoning" }> =>
          item.kind === "reasoning" && item.id === "claude-item-shared",
      ),
    ).toEqual(
      expect.objectContaining({
        content: "我先检查后端结构。",
      }),
    );
    expect(
      state.items.find(
        (item): item is Extract<ConversationItem, { kind: "message"; role: "assistant" }> =>
          item.kind === "message" &&
          item.role === "assistant" &&
          item.id === "claude-item-shared",
      ),
    ).toEqual(
      expect.objectContaining({
        text: "# 分析报告\n\n后端主要使用 FastAPI。数据库是 PostgreSQL。",
      }),
    );
  });

  it("hydrates history with dedupe and keeps plan/userInput/meta", () => {
    const snapshot: NormalizedHistorySnapshot = {
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

  it("hydrates history without collapsing same-id items across different kinds", () => {
    const snapshot: NormalizedHistorySnapshot = {
      engine: "claude" as const,
      workspaceId: "ws-2",
      threadId: "claude:session-1",
      items: [
        {
          id: "shared-1",
          kind: "reasoning",
          summary: "先探索目录",
          content: "先看 README。",
        },
        {
          id: "shared-1",
          kind: "message",
          role: "assistant",
          text: "# 报告\n\n项目结构如下。",
        },
      ],
      plan: null,
      userInputQueue: [],
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
    expect(state.items).toHaveLength(2);
    expect(
      state.items.find((item) => item.kind === "reasoning" && item.id === "shared-1"),
    ).toBeTruthy();
    expect(
      state.items.find(
        (item) => item.kind === "message" && item.role === "assistant" && item.id === "shared-1",
      ),
    ).toBeTruthy();
  });

  it("hydrates history by collapsing equivalent assistant snapshots with different ids", () => {
    const snapshot: NormalizedHistorySnapshot = {
      engine: "codex" as const,
      workspaceId: "ws-assistant-hydrate",
      threadId: "thread-assistant-hydrate",
      items: [
        {
          id: "assistant-history-alias-1",
          kind: "message",
          role: "assistant",
          text: "我先检查仓库结构。",
        },
        {
          id: "assistant-history-canonical-1",
          kind: "message",
          role: "assistant",
          text: "我先检查仓库结构。 我先检查仓库结构。",
        },
      ],
      plan: null,
      userInputQueue: [],
      meta: {
        workspaceId: "ws-assistant-hydrate",
        threadId: "thread-assistant-hydrate",
        engine: "codex" as const,
        activeTurnId: null,
        isThinking: false,
        heartbeatPulse: null,
        historyRestoredAtMs: 11,
      },
      fallbackWarnings: [],
    };

    const state = hydrateHistory(snapshot);
    expect(state.items).toHaveLength(1);
    expect(state.items[0]).toEqual(
      expect.objectContaining({
        id: "assistant-history-canonical-1",
        kind: "message",
        role: "assistant",
        text: "我先检查仓库结构。",
      }),
    );
  });

  it("hydrates history by collapsing equivalent reasoning snapshots with different ids", () => {
    const snapshot: NormalizedHistorySnapshot = {
      engine: "codex" as const,
      workspaceId: "ws-reasoning-hydrate",
      threadId: "thread-reasoning-hydrate",
      items: [
        {
          id: "reasoning-history-alias-1",
          kind: "reasoning",
          summary: "先读取目录",
          content: "先读取目录",
        },
        {
          id: "reasoning-history-canonical-1",
          kind: "reasoning",
          summary: "先读取目录",
          content: "先读取目录\n再检查入口文件",
        },
      ],
      plan: null,
      userInputQueue: [],
      meta: {
        workspaceId: "ws-reasoning-hydrate",
        threadId: "thread-reasoning-hydrate",
        engine: "codex" as const,
        activeTurnId: null,
        isThinking: false,
        heartbeatPulse: null,
        historyRestoredAtMs: 12,
      },
      fallbackWarnings: [],
    };

    const state = hydrateHistory(snapshot);
    expect(state.items).toHaveLength(1);
    expect(state.items[0]).toEqual(
      expect.objectContaining({
        id: "reasoning-history-canonical-1",
        kind: "reasoning",
        summary: "先读取目录",
        content: "先读取目录\n再检查入口文件",
      }),
    );
  });

  it("hydrates Claude long Markdown replay into one stable assistant row", () => {
    const finalMarkdown = [
      "# 重构方案",
      "",
      "## 目标",
      "",
      "- 收口 normalized observation",
      "- 复用 ConversationAssembler",
      "",
      "```ts",
      "const boundary = \"assembler\";",
      "```",
    ].join("\n");
    const snapshot: NormalizedHistorySnapshot = {
      engine: "claude" as const,
      workspaceId: "ws-claude-markdown",
      threadId: "claude:session-markdown",
      items: [
        {
          id: "assistant-stream-1",
          kind: "message",
          role: "assistant",
          text: finalMarkdown,
        },
        {
          id: "assistant-completed-1",
          kind: "message",
          role: "assistant",
          text: finalMarkdown,
        },
      ],
      plan: null,
      userInputQueue: [],
      meta: {
        workspaceId: "ws-claude-markdown",
        threadId: "claude:session-markdown",
        engine: "claude" as const,
        activeTurnId: null,
        isThinking: false,
        heartbeatPulse: null,
        historyRestoredAtMs: 20,
      },
      fallbackWarnings: [],
    };

    const state = hydrateHistory(snapshot);
    const assistantRows = state.items.filter(
      (item): item is Extract<ConversationItem, { kind: "message" }> =>
        item.kind === "message" && item.role === "assistant",
    );
    expect(assistantRows).toHaveLength(1);
    expect(assistantRows[0]?.text).toBe(finalMarkdown);
  });

  it("hydrates Claude ExitPlanMode and approval replay without duplicate plan or approval rows", () => {
    const planText = "PLAN\n\n- inspect\n- implement";
    const plan: TurnPlan = {
      turnId: "turn-plan-1",
      explanation: planText,
      steps: [
        { step: "inspect", status: "completed" },
        { step: "implement", status: "inProgress" },
      ],
    };
    const snapshot: NormalizedHistorySnapshot = {
      engine: "claude" as const,
      workspaceId: "ws-claude-plan",
      threadId: "claude:session-plan",
      items: [
        {
          id: "exit-plan-1",
          kind: "tool",
          toolType: "ExitPlanMode",
          title: "Claude / ExitPlanMode",
          detail: planText,
          output: planText,
          status: "completed",
        },
        {
          id: "exit-plan-1",
          kind: "tool",
          toolType: "ExitPlanMode",
          title: "Claude / ExitPlanMode",
          detail: planText,
          output: planText,
          status: "completed",
        },
        {
          id: "approval-1",
          kind: "tool",
          toolType: "fileChange",
          title: "Approved file change",
          detail: "Approved and wrote a.ts",
          output: "Approved and wrote a.ts",
          status: "completed",
          changes: [{ path: "a.ts", kind: "add" }],
        },
        {
          id: "approval-1",
          kind: "tool",
          toolType: "fileChange",
          title: "Approved file change",
          detail: "Approved and wrote a.ts",
          output: "Approved and wrote a.ts",
          status: "completed",
          changes: [{ path: "a.ts", kind: "add" }],
        },
      ],
      plan,
      userInputQueue: [],
      meta: {
        workspaceId: "ws-claude-plan",
        threadId: "claude:session-plan",
        engine: "claude" as const,
        activeTurnId: "turn-plan-1",
        isThinking: false,
        heartbeatPulse: null,
        historyRestoredAtMs: 22,
      },
      fallbackWarnings: [],
    };

    const state = hydrateHistory(snapshot);
    const exitPlanRows = state.items.filter(
      (item): item is Extract<ConversationItem, { kind: "tool" }> =>
        item.kind === "tool" && /exitplanmode/i.test(`${item.toolType} ${item.title}`),
    );
    const approvalRows = state.items.filter(
      (item): item is Extract<ConversationItem, { kind: "tool" }> =>
        item.kind === "tool" && item.toolType === "fileChange",
    );

    expect(state.plan).toEqual(plan);
    expect(exitPlanRows).toHaveLength(1);
    expect(approvalRows).toHaveLength(1);
    expect(approvalRows[0]?.changes?.[0]?.path).toBe("a.ts");
  });

  it("hydrates Gemini assistant/reasoning/tool replay with stable cardinality", () => {
    const snapshot = {
      engine: "gemini" as const,
      workspaceId: "ws-gemini-cardinality",
      threadId: "gemini:session-cardinality",
      items: [
        {
          id: "assistant-alias-1",
          kind: "message",
          role: "assistant",
          text: "检查完成。",
        } as const,
        {
          id: "assistant-final-1",
          kind: "message",
          role: "assistant",
          text: "检查完成。",
        } as const,
        {
          id: "reasoning-alias-1",
          kind: "reasoning",
          summary: "先读取目录",
          content: "先读取目录",
        } as const,
        {
          id: "reasoning-final-1",
          kind: "reasoning",
          summary: "先读取目录",
          content: "先读取目录\n再检查测试",
        } as const,
        {
          id: "tool-1",
          kind: "tool",
          toolType: "commandExecution",
          title: "Command",
          detail: "pnpm vitest",
          output: "running...\n",
          status: "started",
        } as const,
        {
          id: "tool-1",
          kind: "tool",
          toolType: "commandExecution",
          title: "Command",
          detail: "pnpm vitest",
          output: "running...\nok",
          status: "completed",
        } as const,
      ],
      plan: null,
      userInputQueue: [],
      meta: {
        workspaceId: "ws-gemini-cardinality",
        threadId: "gemini:session-cardinality",
        engine: "gemini" as const,
        activeTurnId: null,
        isThinking: false,
        heartbeatPulse: null,
        historyRestoredAtMs: 21,
      },
      fallbackWarnings: [],
    };

    const state = hydrateHistory(snapshot);
    expect(state.items.filter((item) => item.kind === "message")).toHaveLength(1);
    expect(state.items.filter((item) => item.kind === "reasoning")).toHaveLength(1);
    expect(state.items.filter((item) => item.kind === "tool")).toHaveLength(1);
    const tool = state.items.find(
      (item): item is Extract<ConversationItem, { kind: "tool" }> =>
        item.kind === "tool",
    );
    expect(tool?.status).toBe("completed");
    expect(tool?.output).toBe("running...\nok");
  });

  it("does not merge assistant replies across a reasoning boundary", () => {
    let state = createState();
    state = appendEvent(
      state,
      createEvent({
        eventId: "assistant-before",
        operation: "completeAgentMessage",
        item: {
          id: "assistant-before",
          kind: "message",
          role: "assistant",
          text: "先给结论。",
        },
      }),
    );
    state = appendEvent(
      state,
      createEvent({
        eventId: "reasoning-between",
        itemKind: "reasoning",
        operation: "itemUpdated",
        item: {
          id: "reasoning-between",
          kind: "reasoning",
          summary: "分析中",
          content: "展开推理过程",
        },
      }),
    );
    state = appendEvent(
      state,
      createEvent({
        eventId: "assistant-after",
        operation: "completeAgentMessage",
        item: {
          id: "assistant-after",
          kind: "message",
          role: "assistant",
          text: "再给一次简短结论。",
        },
      }),
    );

    const assistantTexts = state.items
      .filter(
        (item): item is Extract<ConversationItem, { kind: "message" }> =>
          item.kind === "message",
      )
      .filter((item) => item.role === "assistant")
      .map((item) => item.text);
    expect(assistantTexts).toEqual([
      "先给结论。",
      "再给一次简短结论。",
    ]);
  });

  it("keeps short distinct reasoning snapshots separate when one is only a loose substring", () => {
    let state = createState();
    state = appendEvent(
      state,
      createEvent({
        eventId: "reasoning-short-a",
        itemKind: "reasoning",
        operation: "itemUpdated",
        item: {
          id: "reasoning-short-a",
          kind: "reasoning",
          summary: "",
          content: "检查目录",
        },
      }),
    );
    state = appendEvent(
      state,
      createEvent({
        eventId: "reasoning-short-b",
        itemKind: "reasoning",
        operation: "itemUpdated",
        item: {
          id: "reasoning-short-b",
          kind: "reasoning",
          summary: "",
          content: "先检查目录再跑测试",
        },
      }),
    );

    const reasoningItems = state.items.filter(
      (item): item is Extract<ConversationItem, { kind: "reasoning" }> =>
        item.kind === "reasoning",
    );
    expect(reasoningItems).toHaveLength(2);
    expect(reasoningItems.map((item) => item.id)).toEqual([
      "reasoning-short-a",
      "reasoning-short-b",
    ]);
  });

  it("retargets generated image anchors when normalized realtime replaces an optimistic user id", () => {
    let state = createState();
    state = {
      ...state,
      items: [
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
    };

    state = appendEvent(
      state,
      createEvent({
        eventId: "evt-user-real-1",
        item: {
          id: "real-user-1",
          kind: "message",
          role: "user",
          text: "生成一张图，要美女",
        },
        operation: "itemCompleted",
      }),
    );

    expect(state.items).toEqual([
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
