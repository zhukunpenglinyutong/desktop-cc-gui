import { describe, expect, it, vi } from "vitest";
import type { ConversationItem } from "../../../types";
import { claudeRealtimeAdapter } from "../adapters/claudeRealtimeAdapter";
import { codexRealtimeAdapter } from "../adapters/codexRealtimeAdapter";
import { geminiRealtimeAdapter } from "../adapters/geminiRealtimeAdapter";
import { opencodeRealtimeAdapter } from "../adapters/opencodeRealtimeAdapter";
import { createClaudeHistoryLoader } from "../loaders/claudeHistoryLoader";
import { createCodexHistoryLoader } from "../loaders/codexHistoryLoader";
import { createGeminiHistoryLoader } from "../loaders/geminiHistoryLoader";
import { createOpenCodeHistoryLoader } from "../loaders/opencodeHistoryLoader";
import { appendEvent, findConversationStateDiffs, hydrateHistory } from "./conversationAssembler";
import {
  createConversationState,
  type ConversationEngine,
  type NormalizedHistorySnapshot,
  type ConversationState,
} from "./conversationCurtainContracts";

type AdapterMethod = {
  method: string;
  params: Record<string, unknown>;
};

function createRealtimeState(
  engine: ConversationEngine,
  workspaceId: string,
  threadId: string,
  methods: AdapterMethod[],
): ConversationState {
  const adapter =
    engine === "claude"
      ? claudeRealtimeAdapter
      : engine === "gemini"
        ? geminiRealtimeAdapter
      : engine === "opencode"
        ? opencodeRealtimeAdapter
        : codexRealtimeAdapter;
  let state = createConversationState({
    workspaceId,
    threadId,
    engine,
    activeTurnId: null,
    isThinking: false,
    heartbeatPulse: null,
    historyRestoredAtMs: null,
  });

  methods.forEach((entry) => {
    const mapped = adapter.mapEvent({
      workspaceId,
      message: {
        method: entry.method,
        params: entry.params,
      },
    });
    if (mapped) {
      state = appendEvent(state, mapped);
    }
  });
  return {
    ...state,
    meta: {
      ...state.meta,
      activeTurnId:
        state.meta.activeTurnId && state.meta.activeTurnId.trim()
          ? state.meta.activeTurnId
          : null,
    },
  };
}

function pickById<T extends ConversationItem>(
  items: ConversationItem[],
  id: string,
  kind: T["kind"],
): T | null {
  const matched = items.find((item) => item.id === id && item.kind === kind);
  return matched ? (matched as T) : null;
}

function projectSemanticItem(item: ConversationItem) {
  if (item.kind === "message") {
    return {
      id: item.id,
      kind: item.kind,
      role: item.role,
      text: item.text,
    };
  }
  if (item.kind === "reasoning") {
    return {
      id: item.id,
      kind: item.kind,
      summary: item.summary,
      content: item.content,
    };
  }
  if (item.kind === "tool") {
    return {
      id: item.id,
      kind: item.kind,
      toolType: item.toolType,
      title: item.title,
      detail: item.detail,
      status: item.status ?? "",
      output: item.output ?? "",
    };
  }
  return item;
}

describe("realtime/history parity", () => {
  it("keeps codex realtime and history semantics aligned for tool/plan/userInput/reasoning", async () => {
    const workspaceId = "ws-codex";
    const threadId = "thread-codex-parity";
    const loader = createCodexHistoryLoader({
      workspaceId,
      resumeThread: vi.fn().mockResolvedValue({
        result: {
          thread: {
            user_input_queue: [
              {
                request_id: "req-1",
                params: {
                  turn_id: "turn-1",
                  item_id: "ask-1",
                  questions: [{ id: "confirm", header: "Confirm", question: "Proceed?" }],
                },
              },
            ],
            turns: [
              {
                id: "turn-1",
                explanation: "Plan summary",
                plan: [{ step: "Inspect", status: "in_progress" }],
                items: [
                  {
                    id: "msg-1",
                    type: "userMessage",
                    content: [{ type: "text", text: "Run checks" }],
                  },
                  {
                    id: "reason-1",
                    type: "reasoning",
                    summary: "Inspect workspace",
                    content: "Inspect workspace\nChecking ts errors",
                  },
                  {
                    id: "tool-1",
                    type: "commandExecution",
                    command: ["pnpm", "vitest"],
                    cwd: "/repo",
                    status: "completed",
                    aggregatedOutput: "running...\nok",
                  },
                ],
              },
            ],
          },
        },
      }),
    });
    const historySnapshot = await loader.load(threadId);
    const historyState = hydrateHistory(historySnapshot);

    const realtimeState = createRealtimeState("codex", workspaceId, threadId, [
      {
        method: "item/started",
        params: {
          threadId,
          item: {
            id: "msg-1",
            type: "userMessage",
            content: [{ type: "text", text: "Run checks" }],
          },
        },
      },
      {
        method: "item/reasoning/summaryTextDelta",
        params: { threadId, itemId: "reason-1", delta: "Inspect workspace" },
      },
      {
        method: "item/reasoning/textDelta",
        params: {
          threadId,
          itemId: "reason-1",
          delta: "Inspect workspace\nChecking ts errors",
        },
      },
      {
        method: "item/started",
        params: {
          threadId,
          item: {
            id: "tool-1",
            type: "commandExecution",
            command: ["pnpm", "vitest"],
            cwd: "/repo",
            status: "started",
          },
        },
      },
      {
        method: "item/commandExecution/outputDelta",
        params: { threadId, itemId: "tool-1", delta: "running...\n" },
      },
      {
        method: "item/completed",
        params: {
          threadId,
          item: {
            id: "tool-1",
            type: "commandExecution",
            command: ["pnpm", "vitest"],
            cwd: "/repo",
            status: "completed",
            aggregatedOutput: "running...\nok",
          },
        },
      },
    ]);

    const alignedRealtime: ConversationState = {
      ...realtimeState,
      plan: historySnapshot.plan,
      userInputQueue: historySnapshot.userInputQueue,
    };
    expect(findConversationStateDiffs(alignedRealtime, historyState)).toEqual([]);

    const realtimeTool = pickById<Extract<ConversationItem, { kind: "tool" }>>(
      alignedRealtime.items,
      "tool-1",
      "tool",
    );
    const historyTool = pickById<Extract<ConversationItem, { kind: "tool" }>>(
      historyState.items,
      "tool-1",
      "tool",
    );
    const realtimeReasoning = pickById<Extract<ConversationItem, { kind: "reasoning" }>>(
      alignedRealtime.items,
      "reason-1",
      "reasoning",
    );
    const historyReasoning = pickById<Extract<ConversationItem, { kind: "reasoning" }>>(
      historyState.items,
      "reason-1",
      "reasoning",
    );

    expect(realtimeTool).toEqual(historyTool);
    expect(realtimeReasoning).toEqual(historyReasoning);
    expect(historyState.plan?.steps).toEqual([
      { step: "Inspect", status: "pending" },
    ]);
    expect(historyState.userInputQueue).toHaveLength(1);
  });

  it("keeps codex realtime assistant snapshots aligned with history snapshot rendering", async () => {
    const workspaceId = "ws-codex-assistant";
    const threadId = "thread-codex-assistant-parity";
    const finalText = [
      "我先按项目工作流只读摸底：确认规范入口、当前任务和文档落点，然后给你一个可执行的 PLAN，你确认后我再改文档。",
      "",
      "我已经确认到项目内有 `.codex`、`CLAUDE.md` 和 Trellis 任务 PRD；`openspec` 不在当前仓库里，所以这次按普通文档补全流程走，不走 OpenSpec。",
    ].join("\n");
    const loader = createCodexHistoryLoader({
      workspaceId,
      resumeThread: vi.fn().mockResolvedValue({
        result: {
          thread: {
            turns: [
              {
                id: "turn-1",
                items: [
                  {
                    id: "user-1",
                    type: "userMessage",
                    content: [{ type: "text", text: "简单 分析一下当前项目,更新一下项目文档" }],
                  },
                  {
                    id: "assistant-1",
                    type: "agentMessage",
                    text: finalText,
                  },
                ],
              },
            ],
          },
        },
      }),
    });
    const historySnapshot = await loader.load(threadId);
    const historyState = hydrateHistory(historySnapshot);

    const realtimeState = createRealtimeState("codex", workspaceId, threadId, [
      {
        method: "item/started",
        params: {
          threadId,
          item: {
            id: "user-1",
            type: "userMessage",
            content: [{ type: "text", text: "简单 分析一下当前项目,更新一下项目文档" }],
          },
        },
      },
      {
        method: "item/updated",
        params: {
          threadId,
          item: {
            id: "assistant-1",
            type: "agentMessage",
            text: "我先按项目工作流只读摸底：确认规范入口、当前任务和文档落点，然后给你一个可执行的 PLAN，你确认后我再改文档。",
          },
        },
      },
      {
        method: "item/updated",
        params: {
          threadId,
          item: {
            id: "assistant-1",
            type: "agentMessage",
            text: finalText,
          },
        },
      },
      {
        method: "item/completed",
        params: {
          threadId,
          item: {
            id: "assistant-1",
            type: "agentMessage",
            text: finalText,
            status: "completed",
          },
        },
      },
    ]);

    const alignedRealtime: ConversationState = {
      ...realtimeState,
      items: realtimeState.items.map((item) =>
        item.kind === "message" && item.role === "assistant"
          ? { ...item, isFinal: true }
          : item,
      ),
    };
    expect(findConversationStateDiffs(alignedRealtime, historyState)).toEqual([]);
    expect(
      alignedRealtime.items.map(projectSemanticItem),
    ).toEqual(historyState.items.map(projectSemanticItem));
  });

  it("normalizes duplicated codex assistant snapshots to match history rendering", async () => {
    const workspaceId = "ws-codex-assistant-duplicate";
    const threadId = "thread-codex-assistant-duplicate";
    const finalText = [
      "我先按项目工作流只读摸底：确认规范入口、当前任务和文档落点。",
      "",
      "`wf-thinking` 的项目内相对路径不存在，我改用技能注册里的绝对路径读取，不影响继续推进。",
    ].join("\n");
    const duplicatedSnapshotText = [
      "我先按项目工作流只读摸底：确认规范入口、当前任务和文档落点。",
      "",
      "`wf-thinking` 的项目内相对路径不存在，我改用技能注册里的绝对路径读取，不影响继续推进。",
      "",
      "`wf-thinking` 的项目内相对路径不存在，我改用技能注册里的绝对路径读取，不影响继续推进。",
    ].join("\n");
    const loader = createCodexHistoryLoader({
      workspaceId,
      resumeThread: vi.fn().mockResolvedValue({
        result: {
          thread: {
            turns: [
              {
                id: "turn-1",
                items: [
                  {
                    id: "user-1",
                    type: "userMessage",
                    content: [{ type: "text", text: "简单 分析一下当前项目,更新一下项目文档" }],
                  },
                  {
                    id: "assistant-1",
                    type: "agentMessage",
                    text: finalText,
                  },
                ],
              },
            ],
          },
        },
      }),
    });

    const historySnapshot = await loader.load(threadId);
    const historyState = hydrateHistory(historySnapshot);
    const realtimeState = createRealtimeState("codex", workspaceId, threadId, [
      {
        method: "item/started",
        params: {
          threadId,
          item: {
            id: "user-1",
            type: "userMessage",
            content: [{ type: "text", text: "简单 分析一下当前项目,更新一下项目文档" }],
          },
        },
      },
      {
        method: "item/updated",
        params: {
          threadId,
          item: {
            id: "assistant-1",
            type: "agentMessage",
            text: duplicatedSnapshotText,
          },
        },
      },
    ]);

    const alignedRealtime: ConversationState = {
      ...realtimeState,
      items: realtimeState.items.map((item) =>
        item.kind === "message" && item.role === "assistant"
          ? { ...item, isFinal: true }
          : item,
      ),
    };

    expect(findConversationStateDiffs(alignedRealtime, historyState)).toEqual([]);
    expect(
      alignedRealtime.items.map(projectSemanticItem),
    ).toEqual(historyState.items.map(projectSemanticItem));
  });

  it("keeps codex realtime and history semantics aligned when resumeThread degrades to message-only", async () => {
    const workspaceId = "ws-codex-fallback";
    const threadId = "thread-codex-fallback";
    const loader = createCodexHistoryLoader({
      workspaceId,
      resumeThread: vi.fn().mockResolvedValue({
        result: {
          thread: {
            turns: [
              {
                id: "turn-1",
                items: [
                  {
                    id: "msg-1",
                    type: "userMessage",
                    content: [{ type: "text", text: "Run checks" }],
                  },
                ],
              },
            ],
          },
        },
      }),
      loadCodexSession: vi.fn().mockResolvedValue({
        entries: [
          {
            type: "response_item",
            payload: {
              type: "reasoning",
              id: "reason-1",
              summary: "Inspect workspace",
              content: "Inspect workspace\nChecking ts errors",
            },
          },
          {
            type: "response_item",
            payload: {
              type: "function_call",
              call_id: "tool-1",
              name: "exec_command",
              arguments: JSON.stringify({
                cmd: "pnpm vitest",
                workdir: "/repo",
              }),
            },
          },
          {
            type: "response_item",
            payload: {
              type: "function_call_output",
              call_id: "tool-1",
              output: "Command finished\nOutput:\nrunning...\nok",
            },
          },
        ],
      }),
    });

    const historySnapshot = await loader.load(threadId);
    const historyState = hydrateHistory(historySnapshot);
    const realtimeState = createRealtimeState("codex", workspaceId, threadId, [
      {
        method: "item/started",
        params: {
          threadId,
          item: {
            id: "msg-1",
            type: "userMessage",
            content: [{ type: "text", text: "Run checks" }],
          },
        },
      },
      {
        method: "item/reasoning/summaryTextDelta",
        params: { threadId, itemId: "reason-1", delta: "Inspect workspace" },
      },
      {
        method: "item/reasoning/textDelta",
        params: {
          threadId,
          itemId: "reason-1",
          delta: "Inspect workspace\nChecking ts errors",
        },
      },
      {
        method: "item/started",
        params: {
          threadId,
          item: {
            id: "tool-1",
            type: "commandExecution",
            command: ["pnpm", "vitest"],
            cwd: "/repo",
            status: "started",
          },
        },
      },
      {
        method: "item/commandExecution/outputDelta",
        params: { threadId, itemId: "tool-1", delta: "running...\n" },
      },
      {
        method: "item/completed",
        params: {
          threadId,
          item: {
            id: "tool-1",
            type: "commandExecution",
            command: ["pnpm", "vitest"],
            cwd: "/repo",
            status: "completed",
            aggregatedOutput: "running...\nok",
          },
        },
      },
    ]);

    expect(findConversationStateDiffs(realtimeState, historyState)).toEqual([]);
    expect(historyState.items.map(projectSemanticItem)).toEqual(
      realtimeState.items.map(projectSemanticItem),
    );
  });

  it("keeps claude realtime and history semantics aligned for tool and reasoning", async () => {
    const workspaceId = "ws-claude";
    const threadId = "claude:session-parity";
    const loader = createClaudeHistoryLoader({
      workspaceId,
      workspacePath: "/tmp/ws-claude",
      loadClaudeSession: vi.fn().mockResolvedValue({
        messages: [
          { kind: "message", id: "msg-1", role: "user", text: "Run checks" },
          {
            kind: "reasoning",
            id: "reason-1",
            text: "Inspect workspace\nChecking ts errors",
          },
          {
            kind: "tool",
            id: "tool-1",
            toolType: "commandExecution",
            title: "Command: npm run test",
            text: "",
          },
          {
            kind: "tool",
            id: "tool-1-result",
            toolType: "result",
            title: "Result",
            text: "ok",
          },
        ],
      }),
    });
    const historySnapshot = await loader.load(threadId);
    const historyState = hydrateHistory(historySnapshot);
    const reasoningText = "Inspect workspace\nChecking ts errors";

    const realtimeState = createRealtimeState("claude", workspaceId, threadId, [
      {
        method: "item/started",
        params: {
          threadId,
          item: {
            id: "msg-1",
            type: "userMessage",
            content: [{ type: "text", text: "Run checks" }],
          },
        },
      },
      {
        method: "item/reasoning/summaryTextDelta",
        params: { threadId, itemId: "reason-1", delta: reasoningText },
      },
      {
        method: "item/reasoning/textDelta",
        params: { threadId, itemId: "reason-1", delta: reasoningText },
      },
      {
        method: "item/started",
        params: {
          threadId,
          item: {
            id: "tool-1",
            type: "commandExecution",
            command: ["npm", "run", "test"],
            cwd: "",
            status: "started",
          },
        },
      },
      {
        method: "item/commandExecution/outputDelta",
        params: { threadId, itemId: "tool-1", delta: "ok" },
      },
      {
        method: "item/completed",
        params: {
          threadId,
          item: {
            id: "tool-1",
            type: "commandExecution",
            command: ["npm", "run", "test"],
            cwd: "",
            status: "completed",
            aggregatedOutput: "ok",
          },
        },
      },
    ]);

    expect(
      realtimeState.items.map(projectSemanticItem),
    ).toEqual(historyState.items.map(projectSemanticItem));
  });

  it("keeps claude realtime and history semantics aligned when reasoning and assistant text reuse one native item id", async () => {
    const workspaceId = "ws-claude-shared-id";
    const threadId = "claude:session-shared-id";
    const historySnapshot: NormalizedHistorySnapshot = {
      engine: "claude",
      workspaceId,
      threadId,
      items: [
        {
          id: "user-1",
          kind: "message",
          role: "user",
          text: "分析一下项目结构",
          collaborationMode: null,
          selectedAgentName: null,
          selectedAgentIcon: null,
        },
        {
          id: "shared-1",
          kind: "reasoning",
          summary: "先梳理目录结构",
          content: "先梳理目录结构",
        },
        {
          id: "shared-1",
          kind: "message",
          role: "assistant",
          text: "# 项目分析\n\n这里是实时正文。",
        },
      ],
      plan: null,
      userInputQueue: [],
      meta: {
        workspaceId,
        threadId,
        engine: "claude",
        activeTurnId: null,
        isThinking: false,
        heartbeatPulse: null,
        historyRestoredAtMs: 1,
      },
      fallbackWarnings: [],
    };
    const historyState = hydrateHistory(historySnapshot);

    const realtimeState = createRealtimeState("claude", workspaceId, threadId, [
      {
        method: "item/started",
        params: {
          threadId,
          item: {
            id: "user-1",
            type: "userMessage",
            content: [{ type: "text", text: "分析一下项目结构" }],
          },
        },
      },
      {
        method: "item/reasoning/summaryTextDelta",
        params: {
          threadId,
          itemId: "shared-1",
          delta: "先梳理目录结构",
        },
      },
      {
        method: "item/reasoning/textDelta",
        params: {
          threadId,
          itemId: "shared-1",
          delta: "先梳理目录结构",
        },
      },
      {
        method: "item/agentMessage/delta",
        params: {
          threadId,
          itemId: "shared-1",
          delta: "# 项目分析\n\n这里是实时正文。",
        },
      },
      {
        method: "item/completed",
        params: {
          threadId,
          item: {
            id: "shared-1",
            type: "agentMessage",
            text: "# 项目分析\n\n这里是实时正文。",
            status: "completed",
          },
        },
      },
    ]);

    expect(findConversationStateDiffs(realtimeState, historyState)).toEqual([]);
    expect(
      realtimeState.items.map(projectSemanticItem),
    ).toEqual(historyState.items.map(projectSemanticItem));
  });

  it("keeps Claude long Markdown realtime completion and history replay to one assistant row", async () => {
    const workspaceId = "ws-claude-markdown-parity";
    const threadId = "claude:session-markdown-parity";
    const markdownText = [
      "# 幕布提案",
      "",
      "## 实施",
      "",
      "- history first",
      "- realtime parity",
      "",
      "```ts",
      "const engine = \"claude\";",
      "```",
    ].join("\n");
    const historySnapshot: NormalizedHistorySnapshot = {
      engine: "claude",
      workspaceId,
      threadId,
      items: [
        {
          id: "assistant-1",
          kind: "message",
          role: "assistant",
          text: markdownText,
        },
        {
          id: "assistant-history-1",
          kind: "message",
          role: "assistant",
          text: markdownText,
        },
      ],
      plan: null,
      userInputQueue: [],
      meta: {
        workspaceId,
        threadId,
        engine: "claude",
        activeTurnId: null,
        isThinking: false,
        heartbeatPulse: null,
        historyRestoredAtMs: 1,
      },
      fallbackWarnings: [],
    };
    const historyState = hydrateHistory(historySnapshot);
    const realtimeState = createRealtimeState("claude", workspaceId, threadId, [
      {
        method: "item/agentMessage/delta",
        params: { threadId, itemId: "assistant-1", delta: markdownText },
      },
      {
        method: "item/completed",
        params: {
          threadId,
          item: {
            id: "assistant-1",
            type: "agentMessage",
            text: markdownText,
            status: "completed",
          },
        },
      },
    ]);

    expect(historyState.items.filter((item) => item.kind === "message")).toHaveLength(1);
    expect(realtimeState.items.filter((item) => item.kind === "message")).toHaveLength(1);
    const realtimeAssistant = realtimeState.items.find(
      (item): item is Extract<ConversationItem, { kind: "message" }> =>
        item.kind === "message" && item.role === "assistant",
    );
    const historyAssistant = historyState.items.find(
      (item): item is Extract<ConversationItem, { kind: "message" }> =>
        item.kind === "message" && item.role === "assistant",
    );
    expect(realtimeAssistant?.text).toBe(markdownText);
    expect(historyAssistant?.text).toBe(markdownText);
  });

  it("keeps Claude approval file changes replay cardinality stable through assembler", async () => {
    const workspaceId = "ws-claude-approval-parity";
    const threadId = "claude:session-approval-parity";
    const loader = createClaudeHistoryLoader({
      workspaceId,
      workspacePath: "/tmp/ws-claude",
      loadClaudeSession: vi.fn().mockResolvedValue({
        messages: [
          {
            kind: "message",
            role: "assistant",
            id: "assistant-approval-marker-1",
            text: [
              '<ccgui-approval-resume>[{"summary":"Approved and wrote a.ts","path":"a.ts","kind":"add","status":"completed"},{"summary":"Approved and updated b.ts","path":"b.ts","kind":"modified","status":"completed"}]</ccgui-approval-resume>',
              "Completed approved operations:",
              "- Approved and wrote ignored.ts",
            ].join("\n"),
          },
        ],
      }),
    });
    const historyState = hydrateHistory(await loader.load(threadId));
    const replayedState = hydrateHistory({
      engine: "claude",
      workspaceId,
      threadId,
      items: historyState.items.flatMap((item) => [item, item]),
      plan: null,
      userInputQueue: [],
      meta: {
        workspaceId,
        threadId,
        engine: "claude",
        activeTurnId: null,
        isThinking: false,
        heartbeatPulse: null,
        historyRestoredAtMs: 1,
      },
      fallbackWarnings: [],
    });
    const fileChanges = replayedState.items.filter(
      (item): item is Extract<ConversationItem, { kind: "tool" }> =>
        item.kind === "tool" && item.toolType === "fileChange",
    );

    expect(fileChanges).toHaveLength(2);
    expect(fileChanges.map((item) => item.changes?.[0]?.path)).toEqual(["a.ts", "b.ts"]);
  });

  it("keeps gemini realtime and history semantics aligned for tool and reasoning", async () => {
    const workspaceId = "ws-gemini";
    const threadId = "gemini:session-parity";
    const loader = createGeminiHistoryLoader({
      workspaceId,
      workspacePath: "/tmp/ws-gemini",
      loadGeminiSession: vi.fn().mockResolvedValue({
        messages: [
          { kind: "message", id: "msg-1", role: "user", text: "Run checks" },
          {
            kind: "reasoning",
            id: "reason-1",
            role: "assistant",
            text: "Inspect workspace\nChecking ts errors",
          },
          {
            kind: "tool",
            id: "tool-1",
            toolType: "commandExecution",
            title: "Command",
            toolInput: { command: ["pnpm", "vitest"], cwd: "/repo" },
          },
          {
            kind: "tool",
            id: "tool-1-result",
            toolType: "result",
            title: "Result",
            text: "running...\nok",
            toolOutput: { output: "running...\nok" },
          },
          { kind: "message", id: "msg-2", role: "assistant", text: "Done." },
        ],
      }),
    });
    const historySnapshot = await loader.load(threadId);
    const historyState = hydrateHistory(historySnapshot);

    const realtimeState = createRealtimeState("gemini", workspaceId, threadId, [
      {
        method: "item/started",
        params: {
          threadId,
          item: {
            id: "msg-1",
            type: "userMessage",
            content: [{ type: "text", text: "Run checks" }],
          },
        },
      },
      {
        method: "item/reasoning/summaryTextDelta",
        params: { threadId, itemId: "reason-1", delta: "Inspect workspace" },
      },
      {
        method: "item/reasoning/textDelta",
        params: {
          threadId,
          itemId: "reason-1",
          delta: "Inspect workspace\nChecking ts errors",
        },
      },
      {
        method: "item/started",
        params: {
          threadId,
          item: {
            id: "tool-1",
            type: "commandExecution",
            command: ["pnpm", "vitest"],
            cwd: "/repo",
            status: "started",
          },
        },
      },
      {
        method: "item/commandExecution/outputDelta",
        params: { threadId, itemId: "tool-1", delta: "running...\n" },
      },
      {
        method: "item/completed",
        params: {
          threadId,
          item: {
            id: "tool-1",
            type: "commandExecution",
            command: ["pnpm", "vitest"],
            cwd: "/repo",
            status: "completed",
            aggregatedOutput: "running...\nok",
          },
        },
      },
      {
        method: "item/completed",
        params: {
          threadId,
          item: {
            id: "msg-2",
            type: "agentMessage",
            text: "Done.",
            status: "completed",
          },
        },
      },
    ]);

    expect(
      realtimeState.items.map(projectSemanticItem),
    ).toEqual(historyState.items.map(projectSemanticItem));
  });

  it("keeps Gemini assistant, reasoning, and tool history replay cardinality stable", async () => {
    const workspaceId = "ws-gemini-replay-cardinality";
    const threadId = "gemini:session-replay-cardinality";
    const loader = createGeminiHistoryLoader({
      workspaceId,
      workspacePath: "/tmp/ws-gemini",
      loadGeminiSession: vi.fn().mockResolvedValue({
        messages: [
          { kind: "message", id: "user-1", role: "user", text: "Run checks" },
          {
            kind: "reasoning",
            id: "reasoning-1",
            role: "assistant",
            text: "先读取目录",
          },
          {
            kind: "reasoning",
            id: "reasoning-2",
            role: "assistant",
            text: "再检查配置",
          },
          {
            kind: "tool",
            id: "tool-1",
            toolType: "commandExecution",
            title: "Command",
            toolInput: { command: ["pnpm", "vitest"], cwd: "/repo" },
          },
          {
            kind: "tool",
            id: "tool-1-result",
            toolType: "result",
            title: "Result",
            text: "ok",
            toolOutput: { output: "ok" },
          },
          { kind: "message", id: "assistant-1", role: "assistant", text: "Done." },
        ],
      }),
    });
    const historyState = hydrateHistory(await loader.load(threadId));
    const replayedState = hydrateHistory({
      engine: "gemini",
      workspaceId,
      threadId,
      items: [...historyState.items, ...historyState.items],
      plan: null,
      userInputQueue: [],
      meta: {
        workspaceId,
        threadId,
        engine: "gemini",
        activeTurnId: null,
        isThinking: false,
        heartbeatPulse: null,
        historyRestoredAtMs: 1,
      },
      fallbackWarnings: [],
    });

    expect(replayedState.items.filter((item) => item.kind === "message")).toHaveLength(2);
    expect(replayedState.items.filter((item) => item.kind === "reasoning")).toHaveLength(1);
    expect(replayedState.items.filter((item) => item.kind === "tool")).toHaveLength(1);
    expect(replayedState.items.map(projectSemanticItem)).toEqual(
      historyState.items.map(projectSemanticItem),
    );
  });

  it("keeps opencode realtime and history semantics aligned for tool/plan/userInput/reasoning", async () => {
    const workspaceId = "ws-opencode";
    const threadId = "opencode:session-parity";
    const loader = createOpenCodeHistoryLoader({
      workspaceId,
      resumeThread: vi.fn().mockResolvedValue({
        result: {
          thread: {
            user_input_queue: [
              {
                request_id: "req-op-1",
                params: {
                  turn_id: "turn-op-1",
                  item_id: "ask-op-1",
                  questions: [{ id: "confirm", header: "Confirm", question: "Proceed?" }],
                },
              },
            ],
            turns: [
              {
                id: "turn-op-1",
                explanation: "Plan summary",
                plan: [{ step: "Inspect", status: "in_progress" }],
                items: [
                  {
                    id: "msg-1",
                    type: "userMessage",
                    content: [{ type: "text", text: "Run checks" }],
                  },
                  {
                    id: "reason-1",
                    type: "reasoning",
                    summary: "Inspect workspace",
                    content: "Inspect workspace\nChecking ts errors",
                  },
                  {
                    id: "tool-1",
                    type: "commandExecution",
                    command: ["pnpm", "vitest"],
                    cwd: "/repo",
                    status: "completed",
                    aggregatedOutput: "running...\nok",
                  },
                ],
              },
            ],
          },
        },
      }),
    });
    const historySnapshot = await loader.load(threadId);
    const historyState = hydrateHistory(historySnapshot);

    const realtimeState = createRealtimeState("opencode", workspaceId, threadId, [
      {
        method: "item/started",
        params: {
          threadId,
          item: {
            id: "msg-1",
            type: "userMessage",
            content: [{ type: "text", text: "Run checks" }],
          },
        },
      },
      {
        method: "item/reasoning/summaryTextDelta",
        params: { threadId, itemId: "reason-1", delta: "Inspect workspace" },
      },
      {
        method: "item/reasoning/textDelta",
        params: {
          threadId,
          itemId: "reason-1",
          delta: "Inspect workspace\nChecking ts errors",
        },
      },
      {
        method: "item/started",
        params: {
          threadId,
          item: {
            id: "tool-1",
            type: "commandExecution",
            command: ["pnpm", "vitest"],
            cwd: "/repo",
            status: "started",
          },
        },
      },
      {
        method: "item/commandExecution/outputDelta",
        params: { threadId, itemId: "tool-1", delta: "running...\n" },
      },
      {
        method: "item/completed",
        params: {
          threadId,
          item: {
            id: "tool-1",
            type: "commandExecution",
            command: ["pnpm", "vitest"],
            cwd: "/repo",
            status: "completed",
            aggregatedOutput: "running...\nok",
          },
        },
      },
    ]);
    const alignedRealtime: ConversationState = {
      ...realtimeState,
      plan: historySnapshot.plan,
      userInputQueue: historySnapshot.userInputQueue,
    };

    expect(findConversationStateDiffs(alignedRealtime, historyState)).toEqual([]);
  });

  it("keeps fileChange realtime and history semantics aligned for codex/opencode", async () => {
    const cases: Array<{
      engine: "codex" | "opencode";
      workspaceId: string;
      threadId: string;
      load: (threadId: string) => Promise<NormalizedHistorySnapshot>;
    }> = [
      {
        engine: "codex",
        workspaceId: "ws-codex-file",
        threadId: "thread-codex-file",
        load: createCodexHistoryLoader({
          workspaceId: "ws-codex-file",
          resumeThread: vi.fn().mockResolvedValue({
            result: {
              thread: {
                turns: [
                  {
                    id: "turn-1",
                    items: [
                      {
                        id: "file-1",
                        type: "fileChange",
                        status: "completed",
                        changes: [
                          {
                            path: "src/App.tsx",
                            kind: "A",
                            diff: "@@ -0,0 +1 @@\n+const x = 1;",
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          }),
        }).load,
      },
      {
        engine: "opencode",
        workspaceId: "ws-opencode-file",
        threadId: "opencode:session-file",
        load: createOpenCodeHistoryLoader({
          workspaceId: "ws-opencode-file",
          resumeThread: vi.fn().mockResolvedValue({
            result: {
              thread: {
                turns: [
                  {
                    id: "turn-1",
                    items: [
                      {
                        id: "file-1",
                        type: "fileChange",
                        status: "completed",
                        changes: [
                          {
                            path: "src/App.tsx",
                            kind: "A",
                            diff: "@@ -0,0 +1 @@\n+const x = 1;",
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          }),
        }).load,
      },
    ];

    for (const entry of cases) {
      const historySnapshot = await entry.load(entry.threadId);
      const historyState = hydrateHistory(historySnapshot);
      const realtimeState = createRealtimeState(entry.engine, entry.workspaceId, entry.threadId, [
        {
          method: "item/started",
          params: {
            threadId: entry.threadId,
            item: {
              id: "file-1",
              type: "fileChange",
              status: "started",
              changes: [
                {
                  path: "src/App.tsx",
                  kind: "A",
                  diff: "@@ -0,0 +1 @@\n+const x = 1;",
                },
              ],
            },
          },
        },
        {
          method: "item/fileChange/outputDelta",
          params: { threadId: entry.threadId, itemId: "file-1", delta: "@@ -0,0 +1 @@\n+const x = 1;\n" },
        },
        {
          method: "item/completed",
          params: {
            threadId: entry.threadId,
            item: {
              id: "file-1",
              type: "fileChange",
              status: "completed",
              changes: [
                {
                  path: "src/App.tsx",
                  kind: "A",
                  diff: "@@ -0,0 +1 @@\n+const x = 1;",
                },
              ],
            },
          },
        },
      ]);

      expect(findConversationStateDiffs(realtimeState, historyState)).toEqual([]);
      const historyTool = pickById<Extract<ConversationItem, { kind: "tool" }>>(
        historyState.items,
        "file-1",
        "tool",
      );
      expect(historyTool?.toolType).toBe("fileChange");
      expect(historyTool?.changes?.[0]?.kind).toBe("add");
    }
  });

  it("reports non-whitelisted realtime/history differences", () => {
    const base = createConversationState({
      workspaceId: "ws-1",
      threadId: "thread-1",
      engine: "codex",
      activeTurnId: null,
      isThinking: false,
      heartbeatPulse: null,
      historyRestoredAtMs: null,
    });
    const realtime: ConversationState = {
      ...base,
      items: [
        {
          id: "tool-1",
          kind: "tool",
          toolType: "commandExecution",
          title: "Command",
          detail: "pnpm test",
          status: "completed",
          output: "ok",
        },
      ],
      meta: {
        ...base.meta,
        heartbeatPulse: 1,
      },
    };
    const history: ConversationState = {
      ...base,
      items: [
        {
          id: "tool-1",
          kind: "tool",
          toolType: "commandExecution",
          title: "Command",
          detail: "pnpm test",
          status: "started",
          output: "",
        },
      ],
      meta: {
        ...base.meta,
        heartbeatPulse: 3,
      },
    };

    expect(findConversationStateDiffs(realtime, history)).toEqual(["items"]);
  });
});
