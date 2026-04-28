import { describe, expect, it, vi } from "vitest";
import {
  createClaudeHistoryLoader,
  parseClaudeHistoryMessages,
} from "./claudeHistoryLoader";
import { buildWorkspaceSessionActivity } from "../../session-activity/adapters/buildWorkspaceSessionActivity";
import { createCodexHistoryLoader } from "./codexHistoryLoader";
import { parseCodexSessionHistory } from "./codexSessionHistory";
import { createGeminiHistoryLoader } from "./geminiHistoryLoader";
import { parseGeminiHistoryMessages } from "./geminiHistoryParser";
import { createOpenCodeHistoryLoader } from "./opencodeHistoryLoader";

describe("history loaders", () => {
  it("loads codex history into normalized snapshot", async () => {
    const loader = createCodexHistoryLoader({
      workspaceId: "ws-1",
      resumeThread: vi.fn().mockResolvedValue({
        result: {
          thread: {
            user_input_queue: [
              {
                request_id: "req-1",
                params: {
                  turn_id: "turn-1",
                  item_id: "ask-1",
                  questions: [
                    {
                      id: "confirm",
                      header: "Confirm",
                      question: "Proceed?",
                      options: [{ label: "Yes", description: "Continue" }],
                    },
                  ],
                },
              },
            ],
            turns: [
              {
                id: "turn-1",
                explanation: "Plan first",
                plan: [{ step: "Inspect files", status: "in_progress" }],
                items: [
                  {
                    id: "msg-user-1",
                    type: "userMessage",
                    content: [{ type: "text", text: "hello" }],
                  },
                  {
                    id: "msg-assistant-1",
                    type: "agentMessage",
                    text: "hi there",
                  },
                ],
              },
            ],
          },
        },
      }),
    });

    const snapshot = await loader.load("thread-1");
    expect(snapshot.engine).toBe("codex");
    expect(snapshot.items).toHaveLength(2);
    expect(snapshot.items[0]?.kind).toBe("message");
    expect(snapshot.plan?.steps).toEqual([
      { step: "Inspect files", status: "pending" },
    ]);
    expect(snapshot.userInputQueue).toEqual([
      {
        workspace_id: "ws-1",
        request_id: "req-1",
        params: {
          thread_id: "thread-1",
          turn_id: "turn-1",
          item_id: "ask-1",
          questions: [
            {
              id: "confirm",
              header: "Confirm",
              question: "Proceed?",
              isOther: false,
              isSecret: false,
              options: [{ label: "Yes", description: "Continue" }],
            },
          ],
        },
      },
    ]);
  });

  it("loads passive Codex local history without resuming runtime when local items exist", async () => {
    const resumeThread = vi.fn().mockResolvedValue({
      result: {
        thread: {
          turns: [],
        },
      },
    });
    const loader = createCodexHistoryLoader({
      workspaceId: "ws-local-codex",
      resumeThread,
      preferLocalHistory: true,
      loadCodexSession: vi.fn().mockResolvedValue({
        entries: [
          {
            type: "response_item",
            timestamp: "2026-04-28T10:00:00.000Z",
            payload: {
              type: "message",
              role: "user",
              content: [{ type: "input_text", text: "local history prompt" }],
            },
          },
          {
            type: "response_item",
            timestamp: "2026-04-28T10:00:01.000Z",
            payload: {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "local history answer" }],
            },
          },
        ],
      }),
    });

    const snapshot = await loader.load("thread-local-history");

    expect(resumeThread).not.toHaveBeenCalled();
    expect(snapshot.items).toEqual([
      expect.objectContaining({
        kind: "message",
        role: "user",
        text: "local history prompt",
      }),
      expect.objectContaining({
        kind: "message",
        role: "assistant",
        text: "local history answer",
      }),
    ]);
  });

  it("does not retry a failed Codex local history fallback in the same load", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const loadCodexSession = vi.fn().mockRejectedValue(new Error("local history unavailable"));
    const resumeThread = vi.fn().mockResolvedValue({
      result: {
        thread: {
          turns: [],
        },
      },
    });
    const loader = createCodexHistoryLoader({
      workspaceId: "ws-local-codex",
      resumeThread,
      preferLocalHistory: true,
      loadCodexSession,
    });

    try {
      await loader.load("thread-local-history");
      expect(loadCodexSession).toHaveBeenCalledTimes(1);
      expect(consoleWarn).toHaveBeenCalledTimes(1);
      expect(resumeThread).toHaveBeenCalledWith("ws-local-codex", "thread-local-history");
    } finally {
      consoleWarn.mockRestore();
    }
  });

  it("parses Codex response_item message string content", () => {
    const items = parseCodexSessionHistory({
      entries: [
        {
          type: "response_item",
          timestamp: "2026-04-28T10:00:00.000Z",
          payload: {
            type: "message",
            role: "user",
            content: "string content prompt",
          },
        },
        {
          type: "response_item",
          timestamp: "2026-04-28T10:00:01.000Z",
          payload: {
            type: "message",
            role: "assistant",
            content: "string content answer",
          },
        },
      ],
    });

    expect(items).toEqual([
      expect.objectContaining({
        kind: "message",
        role: "user",
        text: "string content prompt",
      }),
      expect.objectContaining({
        kind: "message",
        role: "assistant",
        text: "string content answer",
      }),
    ]);
  });

  it("hydrates codex final completion time and duration from turn item timestamps", async () => {
    const startedAt = "2026-04-01T08:00:00.000Z";
    const completedAt = "2026-04-01T08:00:07.000Z";
    const loader = createCodexHistoryLoader({
      workspaceId: "ws-codex-timing",
      resumeThread: vi.fn().mockResolvedValue({
        result: {
          thread: {
            turns: [
              {
                id: "turn-timing-1",
                items: [
                  {
                    id: "msg-user-timing-1",
                    type: "userMessage",
                    content: [{ type: "text", text: "hello" }],
                    timestamp: startedAt,
                  },
                  {
                    id: "msg-assistant-timing-1",
                    type: "agentMessage",
                    text: "hi there",
                    timestamp: completedAt,
                  },
                ],
              },
            ],
          },
        },
      }),
    });

    const snapshot = await loader.load("thread-codex-timing");
    const assistant = snapshot.items.find(
      (item) => item.kind === "message" && item.role === "assistant",
    );
    expect(assistant).toEqual(
      expect.objectContaining({
        isFinal: true,
        finalCompletedAt: Date.parse(completedAt),
        finalDurationMs: 7_000,
      }),
    );
  });

  it("loads gemini history into normalized snapshot", async () => {
    const loader = createGeminiHistoryLoader({
      workspaceId: "ws-gemini",
      workspacePath: "/tmp/workspace",
      loadGeminiSession: vi.fn().mockResolvedValue({
        messages: [
          {
            id: "gemini-user-1",
            kind: "message",
            role: "user",
            text: "hello",
            images: ["/tmp/demo.png"],
          },
          {
            id: "gemini-assistant-1",
            kind: "message",
            role: "assistant",
            text: "hi",
          },
        ],
      }),
    });

    const snapshot = await loader.load("gemini:session-1");
    expect(snapshot.engine).toBe("gemini");
    expect(snapshot.threadId).toBe("gemini:session-1");
    expect(snapshot.items).toHaveLength(2);
    expect(snapshot.items[0]).toEqual(
      expect.objectContaining({
        kind: "message",
        role: "user",
        images: ["/tmp/demo.png"],
      }),
    );
    expect(snapshot.items[1]).toEqual(
      expect.objectContaining({
        kind: "message",
        role: "assistant",
      }),
    );
  });

  it("hydrates gemini final completion time and duration from message timestamps", () => {
    const startedAt = "2026-04-01T09:00:00.000Z";
    const completedAt = "2026-04-01T09:00:12.000Z";
    const items = parseGeminiHistoryMessages([
      {
        id: "gemini-user-timing-1",
        kind: "message",
        role: "user",
        text: "hello",
        timestamp: startedAt,
      },
      {
        id: "gemini-assistant-timing-1",
        kind: "message",
        role: "assistant",
        text: "done",
        timestamp: completedAt,
      },
    ]);

    const assistant = items.find(
      (item) => item.kind === "message" && item.role === "assistant",
    );
    expect(assistant).toEqual(
      expect.objectContaining({
        isFinal: true,
        finalCompletedAt: Date.parse(completedAt),
        finalDurationMs: 12_000,
      }),
    );
  });

  it("keeps gemini user image-only history rows", () => {
    const items = parseGeminiHistoryMessages([
      {
        id: "gemini-user-image-only",
        kind: "message",
        role: "user",
        text: "",
        images: ["/tmp/image-only.png"],
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toEqual(
      expect.objectContaining({
        id: "gemini-user-image-only",
        kind: "message",
        role: "user",
        images: ["/tmp/image-only.png"],
      }),
    );
  });

  it("strips gemini output language hint from restored user history text", () => {
    const items = parseGeminiHistoryMessages([
      {
        id: "gemini-user-language-hint",
        kind: "message",
        role: "user",
        text:
          "Output language: Simplified Chinese.\n" +
          "Prefer this language for reasoning and final answer unless the user explicitly requests another language.\n\n" +
          "你好啊还能用吗",
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toEqual(
      expect.objectContaining({
        id: "gemini-user-language-hint",
        kind: "message",
        role: "user",
        text: "你好啊还能用吗",
      }),
    );
  });

  it("merges gemini tool start/result rows into a completed tool item", () => {
    const items = parseGeminiHistoryMessages([
      {
        id: "gemini-tool-1",
        kind: "tool",
        toolType: "write_file",
        title: "write_file",
        toolInput: {
          path: "src/a.ts",
          content: "const a = 1;",
        },
      },
      {
        id: "gemini-tool-1-result",
        kind: "tool",
        toolType: "result",
        title: "Result",
        text: "done",
        toolOutput: {
          ok: true,
        },
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toEqual(
      expect.objectContaining({
        id: "gemini-tool-1",
        kind: "tool",
        toolType: "fileChange",
        status: "completed",
        output: "done",
      }),
    );
    expect(items[0]?.kind).toBe("tool");
    if (items[0]?.kind === "tool") {
      expect(items[0].changes).toEqual([
        expect.objectContaining({
          path: "src/a.ts",
          kind: "modified",
        }),
      ]);
    }
  });

  it("normalizes gemini EditFile history rows to fileChange cards", () => {
    const items = parseGeminiHistoryMessages([
      {
        id: "gemini-edit-1",
        kind: "tool",
        toolType: "EditFile",
        title: "EditFile",
        toolInput: {
          path: "src/App.tsx",
          old_string: "const before = true;",
          new_string: "const after = true;",
        },
      },
      {
        id: "gemini-edit-1-result",
        kind: "tool",
        toolType: "result",
        title: "Result",
        text: "updated",
      },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]).toEqual(
      expect.objectContaining({
        id: "gemini-edit-1",
        kind: "tool",
        toolType: "fileChange",
        status: "completed",
      }),
    );
    expect(items[0]?.kind).toBe("tool");
    if (items[0]?.kind === "tool") {
      expect(items[0].changes).toEqual([
        expect.objectContaining({
          path: "src/App.tsx",
          kind: "modified",
        }),
      ]);
    }
  });

  it("merges adjacent gemini reasoning rows while preserving tool boundaries", () => {
    const items = parseGeminiHistoryMessages([
      {
        id: "gemini-reasoning-1",
        kind: "reasoning",
        text: "先读取目录",
      },
      {
        id: "gemini-reasoning-2",
        kind: "reasoning",
        text: "再检查配置",
      },
      {
        id: "gemini-tool-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command",
        toolInput: { command: ["ls"] },
      },
      {
        id: "gemini-reasoning-3",
        kind: "reasoning",
        text: "整理最终结论",
      },
    ]);

    expect(items).toHaveLength(3);
    expect(items[0]).toEqual(
      expect.objectContaining({
        kind: "reasoning",
      }),
    );
    if (items[0]?.kind === "reasoning") {
      expect(items[0].content).toContain("先读取目录");
      expect(items[0].content).toContain("再检查配置");
    }
    expect(items[1]).toEqual(
      expect.objectContaining({
        id: "gemini-tool-1",
        kind: "tool",
      }),
    );
    expect(items[2]).toEqual(
      expect.objectContaining({
        kind: "reasoning",
      }),
    );
    if (items[2]?.kind === "reasoning") {
      expect(items[2].content).toContain("整理最终结论");
    }
  });

  it("reconstructs codex local session history into structured activity items", () => {
    const items = parseCodexSessionHistory({
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
            call_id: "cmd-1",
            name: "exec_command",
            arguments: JSON.stringify({
              cmd: "pnpm vitest",
              workdir: "/repo",
              justification: "Run tests",
            }),
          },
        },
        {
          type: "response_item",
          payload: {
            type: "function_call_output",
            call_id: "cmd-1",
            output: "Command finished\nOutput:\nrunning...\nok",
          },
        },
        {
          type: "custom_tool_call",
          payload: {
            call_id: "patch-1",
            name: "apply_patch",
            status: "completed",
            input:
              "*** Begin Patch\n*** Update File: src/App.tsx\n@@\n-const before = true;\n+const after = true;\n*** End Patch\n",
            output: "Patch applied\nOutput:\nSuccess",
          },
        },
        {
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "Run checks",
          },
        },
        {
          type: "event_msg",
          payload: {
            type: "agent_message",
            message: "Done",
          },
        },
      ],
    });

    expect(items).toHaveLength(5);
    expect(items[0]).toEqual(
      expect.objectContaining({
        id: "reason-1",
        kind: "reasoning",
        summary: "Inspect workspace",
      }),
    );
    expect(items[1]).toEqual(
      expect.objectContaining({
        id: "cmd-1",
        kind: "tool",
        toolType: "commandExecution",
        status: "completed",
        output: "running...\nok",
      }),
    );
    expect(items[2]).toEqual(
      expect.objectContaining({
        id: "patch-1",
        kind: "tool",
        toolType: "fileChange",
        status: "completed",
        changes: [
          expect.objectContaining({
            path: "src/App.tsx",
            kind: "modified",
            diff: expect.stringContaining("+const after = true;"),
          }),
        ],
      }),
    );
    expect(items[3]).toEqual(
      expect.objectContaining({
        kind: "message",
        role: "user",
        text: "Run checks",
      }),
    );
    expect(items[4]).toEqual(
      expect.objectContaining({
        kind: "message",
        role: "assistant",
        text: "Done",
      }),
    );
  });

  it("preserves real codex user message ids from local session payloads", () => {
    const items = parseCodexSessionHistory({
      entries: [
        {
          type: "event_msg",
          payload: {
            type: "user_message",
            id: "real-user-message-1",
            message: "你好1",
          },
        },
        {
          type: "event_msg",
          payload: {
            type: "user_message",
            messageId: "real-user-message-2",
            message: "你好2",
          },
        },
      ],
    });

    expect(items[0]).toEqual(
      expect.objectContaining({
        kind: "message",
        role: "user",
        id: "real-user-message-1",
        text: "你好1",
      }),
    );
    expect(items[1]).toEqual(
      expect.objectContaining({
        kind: "message",
        role: "user",
        id: "real-user-message-2",
        text: "你好2",
      }),
    );
  });

  it("hydrates codex local assistant final metadata from entry timestamps", () => {
    const startedAt = "2026-04-01T16:31:34.000Z";
    const completedAt = "2026-04-01T16:31:37.000Z";
    const items = parseCodexSessionHistory({
      entries: [
        {
          timestamp: startedAt,
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "在吗",
          },
        },
        {
          timestamp: completedAt,
          type: "event_msg",
          payload: {
            type: "agent_message",
            message: "在这儿，等你派活。",
          },
        },
      ],
    });

  expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "message",
          role: "assistant",
          text: "在这儿，等你派活。",
          isFinal: true,
          finalCompletedAt: Date.parse(completedAt),
          finalDurationMs: 3_000,
        }),
      ]),
    );
  });

  it("reconstructs codex collab tool calls from local function history", () => {
    const items = parseCodexSessionHistory({
      entries: [
        {
          type: "response_item",
          payload: {
            type: "function_call",
            call_id: "spawn-1",
            name: "spawn_agent",
            arguments: JSON.stringify({
              message: "统计技术文件数量",
            }),
          },
        },
        {
          type: "response_item",
          payload: {
            type: "function_call_output",
            call_id: "spawn-1",
            output: JSON.stringify({
              id: "agent-7",
            }),
          },
        },
        {
          type: "response_item",
          payload: {
            type: "function_call",
            call_id: "send-1",
            name: "send_input",
            arguments: JSON.stringify({
              id: "agent-7",
              message: "继续执行",
            }),
          },
        },
        {
          type: "response_item",
          payload: {
            type: "function_call_output",
            call_id: "send-1",
            output: JSON.stringify({
              ok: true,
            }),
          },
        },
        {
          type: "response_item",
          payload: {
            type: "function_call",
            call_id: "wait-1",
            name: "wait",
            arguments: JSON.stringify({
              ids: ["agent-7", "agent-8"],
            }),
          },
        },
        {
          type: "response_item",
          payload: {
            type: "function_call_output",
            call_id: "wait-1",
            output: JSON.stringify({
              statuses: [{ id: "agent-7", status: "completed" }],
            }),
          },
        },
      ],
    });

    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "spawn-1",
          kind: "tool",
          toolType: "collabToolCall",
          title: "Collab: spawn_agent",
          detail: expect.stringContaining("agent-7"),
          output: "统计技术文件数量",
        }),
        expect.objectContaining({
          id: "send-1",
          kind: "tool",
          toolType: "collabToolCall",
          title: "Collab: send_input",
          detail: expect.stringContaining("agent-7"),
          output: "继续执行",
        }),
        expect.objectContaining({
          id: "wait-1",
          kind: "tool",
          toolType: "collabToolCall",
          title: "Collab: wait",
          detail: expect.stringContaining("agent-7"),
          agentStatus: {
            "agent-7": { status: "completed" },
          },
        }),
      ]),
    );
  });

  it("reconstructs codex wait results when statuses are returned as an object map", () => {
    const items = parseCodexSessionHistory({
      entries: [
        {
          type: "response_item",
          payload: {
            type: "function_call",
            call_id: "wait-map-1",
            name: "wait",
            arguments: JSON.stringify({
              ids: ["agent-9"],
            }),
          },
        },
        {
          type: "response_item",
          payload: {
            type: "function_call_output",
            call_id: "wait-map-1",
            output: JSON.stringify({
              statuses: {
                "agent-9": { status: "completed" },
              },
            }),
          },
        },
      ],
    });

    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "wait-map-1",
          kind: "tool",
          toolType: "collabToolCall",
          title: "Collab: wait",
          detail: expect.stringContaining("agent-9"),
          receiverThreadIds: ["agent-9"],
          agentStatus: {
            "agent-9": { status: "completed" },
          },
        }),
      ]),
    );
  });

  it("reconstructs codex agent results from direct id-status records without fake keys", () => {
    const items = parseCodexSessionHistory({
      entries: [
        {
          type: "response_item",
          payload: {
            type: "function_call",
            call_id: "wait-agent-1",
            name: "wait",
            arguments: JSON.stringify({
              ids: ["agent-10"],
            }),
          },
        },
        {
          type: "response_item",
          payload: {
            type: "function_call_output",
            call_id: "wait-agent-1",
            output: JSON.stringify({
              agent: { id: "agent-10", status: "completed" },
            }),
          },
        },
      ],
    });

    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "wait-agent-1",
          kind: "tool",
          toolType: "collabToolCall",
          title: "Collab: wait",
          receiverThreadIds: ["agent-10"],
          agentStatus: {
            "agent-10": { status: "completed" },
          },
        }),
      ]),
    );
    expect(items).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agentStatus: expect.objectContaining({
            status: expect.anything(),
          }),
        }),
      ]),
    );
  });

  it("reconstructs current codex collab tool schema target fields", () => {
    const items = parseCodexSessionHistory({
      entries: [
        {
          type: "response_item",
          payload: {
            type: "function_call",
            call_id: "send-current-1",
            name: "send_input",
            arguments: JSON.stringify({
              target: "agent-current-1",
              message: "继续看跨平台边界",
            }),
          },
        },
        {
          type: "response_item",
          payload: {
            type: "function_call_output",
            call_id: "send-current-1",
            output: JSON.stringify({ ok: true }),
          },
        },
        {
          type: "response_item",
          payload: {
            type: "function_call",
            call_id: "wait-current-1",
            name: "wait_agent",
            arguments: JSON.stringify({
              targets: ["agent-current-1", "agent-current-2"],
            }),
          },
        },
        {
          type: "response_item",
          payload: {
            type: "function_call_output",
            call_id: "wait-current-1",
            output: JSON.stringify({
              statuses: {
                "agent-current-1": { status: "completed" },
              },
            }),
          },
        },
      ],
    });

    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "send-current-1",
          kind: "tool",
          toolType: "collabToolCall",
          title: "Collab: send_input",
          receiverThreadIds: ["agent-current-1"],
          output: "继续看跨平台边界",
        }),
        expect.objectContaining({
          id: "wait-current-1",
          kind: "tool",
          toolType: "collabToolCall",
          title: "Collab: wait_agent",
          receiverThreadIds: ["agent-current-1", "agent-current-2"],
          agentStatus: {
            "agent-current-1": { status: "completed" },
          },
        }),
      ]),
    );
  });

  it("reconstructs codex generic search tool calls from local function history", () => {
    const items = parseCodexSessionHistory({
      entries: [
        {
          type: "response_item",
          payload: {
            type: "function_call",
            call_id: "search-1",
            name: "search_query",
            arguments: JSON.stringify({
              search_query: [{ q: "site:developers.openai.com Codex AGENTS.md" }],
            }),
          },
        },
        {
          type: "response_item",
          payload: {
            type: "function_call_output",
            call_id: "search-1",
            output: JSON.stringify({
              items: [
                {
                  title: "OpenAI Codex AGENTS.md",
                  url: "https://developers.openai.com/codex/guides/agents-md",
                },
              ],
            }),
          },
        },
      ],
    });

    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "search-1",
          kind: "tool",
          toolType: "mcpToolCall",
          title: "Tool: codex / search_query",
          detail: expect.stringContaining("site:developers.openai.com Codex AGENTS.md"),
          output: expect.stringContaining("agents-md"),
        }),
      ]),
    );
  });

  it("reconstructs codex generated image artifacts from local function history", () => {
    const items = parseCodexSessionHistory({
      entries: [
        {
          type: "response_item",
          payload: {
            type: "function_call",
            call_id: "imagegen-1",
            name: "imagegen",
            arguments: JSON.stringify({
              prompt: "真人风格女主播，直播间氛围",
            }),
          },
        },
        {
          type: "response_item",
          payload: {
            type: "function_call_output",
            call_id: "imagegen-1",
            output: "/Users/demo/.codex/generated_images/ig_generated.png",
          },
        },
      ],
    });

    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "imagegen-1",
          kind: "generatedImage",
          status: "completed",
          promptText: expect.stringContaining("直播间氛围"),
          images: [
            expect.objectContaining({
              localPath: "/Users/demo/.codex/generated_images/ig_generated.png",
            }),
          ],
        }),
      ]),
    );
  });

  it("keeps in-progress codex generated image artifacts during local history replay", () => {
    const items = parseCodexSessionHistory({
      entries: [
        {
          type: "response_item",
          payload: {
            type: "function_call",
            call_id: "imagegen-2",
            name: "image_gen",
            status: "in_progress",
            arguments: JSON.stringify({
              prompt: "夏日主播写真",
            }),
          },
        },
      ],
    });

    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "imagegen-2",
          kind: "generatedImage",
          status: "processing",
          promptText: "夏日主播写真",
          images: [],
        }),
      ]),
    );
  });

  it("reconstructs native codex image_generation_call entries from local session history", () => {
    const items = parseCodexSessionHistory({
      entries: [
        {
          type: "response_item",
          payload: {
            type: "image_generation_call",
            id: "ig-native-call-1",
            status: "generating",
            revised_prompt: "国风书生深夜苦读，油灯与竹简",
            result: "QUJD".repeat(32),
          },
        },
      ],
    });

    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "ig-native-call-1",
          kind: "generatedImage",
          status: "completed",
          promptText: expect.stringContaining("国风书生"),
          images: [
            expect.objectContaining({
              src: expect.stringMatching(/^data:image\/png;base64,/),
            }),
          ],
        }),
      ]),
    );
  });

  it("reconstructs native codex image_generation_end events with saved_path fallback", () => {
    const items = parseCodexSessionHistory({
      entries: [
        {
          type: "event_msg",
          payload: {
            type: "image_generation_end",
            call_id: "ig-native-end-1",
            status: "completed",
            revised_prompt: "窗外夜色深沉的古风书房插画",
            saved_path: "/Users/demo/.codex/generated_images/ig_native_end.png",
          },
        },
      ],
    });

    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "ig-native-end-1",
          kind: "generatedImage",
          status: "completed",
          promptText: expect.stringContaining("古风书房"),
          images: [
            expect.objectContaining({
              localPath: "/Users/demo/.codex/generated_images/ig_native_end.png",
            }),
          ],
        }),
      ]),
    );
  });

  it("reconstructs codex web_search_call entries from local session history", () => {
    const items = parseCodexSessionHistory({
      entries: [
        {
          type: "response_item",
          payload: {
            type: "web_search_call",
            status: "completed",
            action: {
              type: "search",
              query: "OpenAI Codex CLI AGENTS.md default instructions file",
              queries: [
                "OpenAI Codex CLI AGENTS.md default instructions file",
                "developers.openai.com/codex/guides/agents-md",
              ],
            },
          },
        },
        {
          type: "response_item",
          payload: {
            type: "web_search_call",
            status: "completed",
            action: {
              type: "find_in_page",
              url: "https://developers.openai.com/codex/guides/agents-md",
              pattern: "searches for AGENTS.md",
            },
          },
        },
      ],
    });

    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "codex-web-search-1",
          kind: "tool",
          toolType: "mcpToolCall",
          title: "Tool: codex / search_query",
          detail: expect.stringContaining("OpenAI Codex CLI AGENTS.md"),
          output: expect.stringContaining("\"queries\""),
        }),
        expect.objectContaining({
          id: "codex-web-search-2",
          kind: "tool",
          toolType: "mcpToolCall",
          title: "Tool: codex / search_query",
          detail: expect.stringContaining("searches for AGENTS.md"),
          output: expect.stringContaining("find_in_page"),
        }),
      ]),
    );
  });

  it("reconstructs nested response_item apply_patch history entries", () => {
    const items = parseCodexSessionHistory({
      entries: [
        {
          type: "response_item",
          payload: {
            type: "custom_tool_call",
            call_id: "patch-nested-1",
            name: "apply_patch",
            status: "completed",
            input:
              "*** Begin Patch\n*** Update File: src/routes.ts\n@@\n-const route = \"/old\";\n+const route = \"/new\";\n*** End Patch\n",
          },
        },
        {
          type: "response_item",
          payload: {
            type: "custom_tool_call_output",
            call_id: "patch-nested-1",
            output: "Patch applied\nOutput:\nSuccess",
          },
        },
      ],
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toEqual(
      expect.objectContaining({
        id: "patch-nested-1",
        kind: "tool",
        toolType: "fileChange",
        status: "completed",
        output: "Success",
        changes: [
          expect.objectContaining({
            path: "src/routes.ts",
            kind: "modified",
            diff: expect.stringContaining("+const route = \"/new\";"),
          }),
        ],
      }),
    );
  });

  it("prefers richer local fileChange diffs when remote history only has path-level snapshots", async () => {
    const loader = createCodexHistoryLoader({
      workspaceId: "ws-codex-file-diff-merge",
      resumeThread: vi.fn().mockResolvedValue({
        result: {
          thread: {
            turns: [
              {
                id: "turn-1",
                items: [
                  {
                    id: "patch-1",
                    type: "fileChange",
                    status: "completed",
                    changes: [
                      {
                        path: "src/App.tsx",
                        kind: "M",
                      },
                    ],
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
              type: "custom_tool_call",
              call_id: "patch-1",
              name: "apply_patch",
              status: "completed",
              input:
                "*** Begin Patch\n*** Update File: src/App.tsx\n@@\n-const before = true;\n+const after = true;\n*** End Patch\n",
            },
          },
          {
            type: "response_item",
            payload: {
              type: "custom_tool_call_output",
              call_id: "patch-1",
              output: "Patch applied\nOutput:\nSuccess",
            },
          },
        ],
      }),
    });

    const snapshot = await loader.load("thread-codex-file-diff-merge");
    const patchItem = snapshot.items.find((item) => item.id === "patch-1");
    expect(patchItem).toBeTruthy();
    expect(patchItem).toEqual(
      expect.objectContaining({
        kind: "tool",
        toolType: "fileChange",
        changes: [
          expect.objectContaining({
            path: "src/App.tsx",
            kind: "modified",
            diff: expect.stringContaining("+const after = true;"),
          }),
        ],
      }),
    );
  });

  it("dedupes repeated codex reasoning snapshots in local history", () => {
    const items = parseCodexSessionHistory({
      entries: [
        {
          type: "response_item",
          payload: {
            type: "reasoning",
            id: "reason-1",
            encrypted_content: "encrypted-a",
          },
        },
        {
          type: "response_item",
          payload: {
            type: "reasoning",
            id: "reason-2",
            encrypted_content: "encrypted-b",
          },
        },
        {
          type: "response_item",
          payload: {
            type: "reasoning",
            id: "reason-3",
            summary: "Inspect workspace state",
            content: "Inspect workspace state\nCheck recent fixes",
          },
        },
        {
          type: "response_item",
          payload: {
            type: "reasoning",
            id: "reason-4",
            summary: "Inspect workspace state",
            content: "Inspect workspace state\nCheck recent fixes and confirm history loader path",
          },
        },
      ],
    });

    const reasoningItems = items.filter(
      (item): item is Extract<(typeof items)[number], { kind: "reasoning" }> =>
        item.kind === "reasoning",
    );
    expect(reasoningItems).toHaveLength(2);
    expect(reasoningItems[0]).toEqual(
      expect.objectContaining({
        id: "reason-2",
        summary: "Encrypted reasoning",
      }),
    );
    expect(reasoningItems[1]).toEqual(
      expect.objectContaining({
        id: "reason-4",
        summary: "Inspect workspace state",
        content: "Inspect workspace state\nCheck recent fixes and confirm history loader path",
      }),
    );
  });

  it("dedupes adjacent codex assistant messages emitted by both response_item and event_msg", () => {
    const items = parseCodexSessionHistory({
      entries: [
        {
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "同一条 assistant 文本" }],
          },
        },
        {
          type: "event_msg",
          payload: {
            type: "agent_message",
            message: "同一条 assistant 文本",
          },
        },
      ],
    });

    const assistantMessages = items.filter(
      (item): item is Extract<(typeof items)[number], { kind: "message" }> =>
        item.kind === "message" && item.role === "assistant",
    );
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]?.text).toBe("同一条 assistant 文本");
  });

  it("prefers response_item assistant message when mirror event_msg appears first", () => {
    const items = parseCodexSessionHistory({
      entries: [
        {
          type: "event_msg",
          payload: {
            type: "agent_message",
            message: "同一条 assistant 文本",
          },
        },
        {
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "同一条 assistant 文本" }],
          },
        },
      ],
    });

    const assistantMessages = items.filter(
      (item): item is Extract<(typeof items)[number], { kind: "message" }> =>
        item.kind === "message" && item.role === "assistant",
    );
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]?.id).toBe("codex-assistant-2");
    expect(assistantMessages[0]?.text).toBe("同一条 assistant 文本");
  });

  it("dedupes codex mirror messages with equivalent \\(...\\) and $...$ delimiters", () => {
    const items = parseCodexSessionHistory({
      entries: [
        {
          type: "event_msg",
          payload: {
            type: "agent_message",
            message: String.raw`逻辑函数：\\( \sigma(z)=\frac{1}{1+e^{-z}} \\)`,
          },
        },
        {
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [
              { type: "output_text", text: "逻辑函数：$\\sigma(z)=\\frac{1}{1+e^{-z}}$" },
            ],
          },
        },
      ],
    });

    const assistantMessages = items.filter(
      (item): item is Extract<(typeof items)[number], { kind: "message" }> =>
        item.kind === "message" && item.role === "assistant",
    );
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]?.id).toBe("codex-assistant-2");
    expect(assistantMessages[0]?.text).toContain("$\\sigma(z)=\\frac{1}{1+e^{-z}}$");
  });

  it("keeps repeated assistant messages when they come from separate response_item events", () => {
    const items = parseCodexSessionHistory({
      entries: [
        {
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "OK" }],
          },
        },
        {
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "OK" }],
          },
        },
      ],
    });

    const assistantMessages = items.filter(
      (item): item is Extract<(typeof items)[number], { kind: "message" }> =>
        item.kind === "message" && item.role === "assistant",
    );
    expect(assistantMessages).toHaveLength(2);
  });

  it("hydrates codex remote final metadata from local session timestamps", async () => {
    const startedAt = "2026-04-01T16:45:07.000Z";
    const completedAt = "2026-04-01T16:45:17.000Z";
    const loader = createCodexHistoryLoader({
      workspaceId: "ws-codex-final-meta-merge",
      resumeThread: vi.fn().mockResolvedValue({
        result: {
          thread: {
            turns: [
              {
                id: "turn-1",
                items: [
                  {
                    id: "remote-user-1",
                    type: "userMessage",
                    content: [{ type: "text", text: "你好" }],
                  },
                  {
                    id: "remote-assistant-1",
                    type: "agentMessage",
                    text: "你好。要我现在帮你处理什么？",
                    isFinal: true,
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
            timestamp: startedAt,
            type: "event_msg",
            payload: {
              type: "user_message",
              message: "你好",
            },
          },
          {
            timestamp: completedAt,
            type: "event_msg",
            payload: {
              type: "agent_message",
              message: "你好。要我现在帮你处理什么？",
            },
          },
        ],
      }),
    });

    const snapshot = await loader.load("thread-codex-final-meta-merge");
    const assistant = snapshot.items.find(
      (item) =>
        item.kind === "message" &&
        item.role === "assistant" &&
        item.id === "remote-assistant-1",
    );

    expect(assistant).toEqual(
      expect.objectContaining({
        isFinal: true,
        finalCompletedAt: Date.parse(completedAt),
        finalDurationMs: 10_000,
      }),
    );
  });

  it("merges codex local structured fallback when resumeThread only restores messages", async () => {
    const loader = createCodexHistoryLoader({
      workspaceId: "ws-codex-fallback",
      resumeThread: vi.fn().mockResolvedValue({
        result: {
          thread: {
            turns: [
              {
                id: "turn-1",
                items: [
                  {
                    id: "msg-user-1",
                    type: "userMessage",
                    content: [{ type: "text", text: "Run checks" }],
                  },
                  {
                    id: "msg-assistant-1",
                    type: "agentMessage",
                    text: "Working on it",
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
            type: "event_msg",
            payload: {
              type: "user_message",
              message: "Run checks",
            },
          },
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
              call_id: "cmd-1",
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
              call_id: "cmd-1",
              output: "Command finished\nOutput:\nrunning...\nok",
            },
          },
          {
            type: "response_item",
            payload: {
              type: "custom_tool_call",
              call_id: "patch-1",
              name: "apply_patch",
              status: "completed",
              input:
                "*** Begin Patch\n*** Update File: src/App.tsx\n@@\n-const before = true;\n+const after = true;\n*** End Patch\n",
            },
          },
          {
            type: "response_item",
            payload: {
              type: "custom_tool_call_output",
              call_id: "patch-1",
              output: "Patch applied\nOutput:\nSuccess",
            },
          },
          {
            type: "event_msg",
            payload: {
              type: "agent_message",
              message: "This fallback message should not duplicate remote history",
            },
          },
        ],
      }),
    });

    const snapshot = await loader.load("thread-codex-fallback");

    expect(snapshot.items.filter((item) => item.kind === "message")).toHaveLength(2);
    expect(snapshot.items.map((item) => item.id)).toEqual([
      "msg-user-1",
      "reason-1",
      "cmd-1",
      "patch-1",
      "msg-assistant-1",
    ]);
    expect(snapshot.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "reason-1",
          kind: "reasoning",
        }),
        expect.objectContaining({
          id: "cmd-1",
          kind: "tool",
          toolType: "commandExecution",
          output: "running...\nok",
        }),
        expect.objectContaining({
          id: "patch-1",
          kind: "tool",
          toolType: "fileChange",
        }),
      ]),
    );
  });

  it("preserves codex fallback activity under the correct historical turn groups", async () => {
    const loader = createCodexHistoryLoader({
      workspaceId: "ws-codex-multi-turn",
      resumeThread: vi.fn().mockResolvedValue({
        result: {
          thread: {
            turns: [
              {
                id: "turn-1",
                items: [
                  {
                    id: "remote-user-1",
                    type: "userMessage",
                    content: [{ type: "text", text: "First request" }],
                  },
                  {
                    id: "remote-assistant-1",
                    type: "agentMessage",
                    text: "First reply",
                  },
                ],
              },
              {
                id: "turn-2",
                items: [
                  {
                    id: "remote-user-2",
                    type: "userMessage",
                    content: [{ type: "text", text: "Second request" }],
                  },
                  {
                    id: "remote-assistant-2",
                    type: "agentMessage",
                    text: "Second reply",
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
            type: "event_msg",
            payload: {
              type: "user_message",
              message: "First request",
            },
          },
          {
            type: "response_item",
            payload: {
              type: "reasoning",
              id: "reason-turn-1",
              summary: "Inspect first turn",
              content: "Inspect first turn details",
            },
          },
          {
            type: "event_msg",
            payload: {
              type: "user_message",
              message: "Second request",
            },
          },
          {
            type: "response_item",
            payload: {
              type: "reasoning",
              id: "reason-turn-2",
              summary: "Inspect second turn",
              content: "Inspect second turn details",
            },
          },
        ],
      }),
    });

    const snapshot = await loader.load("thread-codex-multi-turn");
    const viewModel = buildWorkspaceSessionActivity({
      activeThreadId: "thread-codex-multi-turn",
      threads: [
        {
          id: "thread-codex-multi-turn",
          name: "Codex",
          updatedAt: 1_000,
        },
      ],
      itemsByThread: {
        "thread-codex-multi-turn": snapshot.items,
      },
      threadParentById: {},
      threadStatusById: {},
    });

    const reasoningEvents = viewModel.timeline.filter((event) => event.kind === "reasoning");
    expect(reasoningEvents).toHaveLength(2);
    expect(reasoningEvents[0]?.turnIndex).toBe(2);
    expect(reasoningEvents[0]?.turnId).toBe("thread-codex-multi-turn:turn:remote-user-2");
    expect(reasoningEvents[1]?.turnIndex).toBe(1);
    expect(reasoningEvents[1]?.turnId).toBe("thread-codex-multi-turn:turn:remote-user-1");
  });

  it("falls back to legacy merge when codex local history has no user turn anchors", async () => {
    const loader = createCodexHistoryLoader({
      workspaceId: "ws-codex-no-user-anchor",
      resumeThread: vi.fn().mockResolvedValue({
        result: {
          thread: {
            turns: [
              {
                id: "turn-1",
                items: [
                  {
                    id: "remote-user-1",
                    type: "userMessage",
                    content: [{ type: "text", text: "Run checks" }],
                  },
                  {
                    id: "remote-assistant-1",
                    type: "agentMessage",
                    text: "Done",
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
              call_id: "cmd-1",
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
              call_id: "cmd-1",
              output: "Command finished\nOutput:\nrunning...\nok",
            },
          },
        ],
      }),
    });

    const snapshot = await loader.load("thread-codex-no-user-anchor");

    expect(snapshot.items.map((item) => item.id)).toEqual([
      "remote-user-1",
      "remote-assistant-1",
      "reason-1",
      "cmd-1",
    ]);
  });

  it("keeps fallback events on the earliest matching turns when local history misses later turn anchors", async () => {
    const threadId = "thread-codex-missing-later-anchor";
    const loader = createCodexHistoryLoader({
      workspaceId: "ws-codex-missing-later-anchor",
      resumeThread: vi.fn().mockResolvedValue({
        result: {
          thread: {
            turns: [
              {
                id: "turn-1",
                items: [
                  {
                    id: "remote-user-1",
                    type: "userMessage",
                    content: [{ type: "text", text: "First request" }],
                  },
                  {
                    id: "remote-assistant-1",
                    type: "agentMessage",
                    text: "First reply",
                  },
                ],
              },
              {
                id: "turn-2",
                items: [
                  {
                    id: "remote-user-2",
                    type: "userMessage",
                    content: [{ type: "text", text: "Second request" }],
                  },
                  {
                    id: "remote-assistant-2",
                    type: "agentMessage",
                    text: "Second reply",
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
            type: "event_msg",
            payload: {
              type: "user_message",
              message: "First request",
            },
          },
          {
            type: "response_item",
            payload: {
              type: "reasoning",
              id: "reason-turn-1",
              summary: "Inspect first turn",
              content: "Inspect first turn details",
            },
          },
          {
            type: "response_item",
            payload: {
              type: "function_call",
              call_id: "cmd-turn-1",
              name: "exec_command",
              arguments: JSON.stringify({
                cmd: "pnpm test",
                workdir: "/repo",
              }),
            },
          },
          {
            type: "response_item",
            payload: {
              type: "function_call_output",
              call_id: "cmd-turn-1",
              output: "Command finished\nOutput:\npass",
            },
          },
        ],
      }),
    });

    const snapshot = await loader.load(threadId);
    const viewModel = buildWorkspaceSessionActivity({
      activeThreadId: threadId,
      threads: [
        {
          id: threadId,
          name: "Codex",
          updatedAt: 1_000,
        },
      ],
      itemsByThread: {
        [threadId]: snapshot.items,
      },
      threadParentById: {},
      threadStatusById: {},
    });

    const firstTurnEvents = viewModel.timeline.filter(
      (event) => event.turnId === `${threadId}:turn:remote-user-1`,
    );
    const secondTurnEvents = viewModel.timeline.filter(
      (event) => event.turnId === `${threadId}:turn:remote-user-2`,
    );

    expect(firstTurnEvents.map((event) => event.kind)).toEqual(["command", "reasoning"]);
    expect(secondTurnEvents).toHaveLength(0);
  });

  it("loads claude jsonl messages and merges tool result into tool call", async () => {
    const loader = createClaudeHistoryLoader({
      workspaceId: "ws-2",
      workspacePath: "/tmp/ws-2",
      loadClaudeSession: vi.fn().mockResolvedValue({
        messages: [
          {
            kind: "message",
            id: "user-1",
            role: "user",
            text: "run test",
            images: ["/tmp/claude-shot.png"],
          },
          {
            kind: "tool",
            id: "tool-1",
            toolType: "commandExecution",
            title: "Command",
            text: "npm run test",
          },
          {
            kind: "tool",
            id: "tool-1-result",
            toolType: "result",
            title: "Command",
            text: "ok",
          },
        ],
      }),
    });

    const snapshot = await loader.load("claude:session-1");
    expect(snapshot.engine).toBe("claude");
    expect(snapshot.items).toHaveLength(2);
    expect(snapshot.items[0]).toEqual(
      expect.objectContaining({
        kind: "message",
        role: "user",
        images: ["/tmp/claude-shot.png"],
      }),
    );
    const tool = snapshot.items[1];
    expect(tool?.kind).toBe("tool");
    if (tool?.kind === "tool") {
      expect(tool.status).toBe("completed");
      expect(tool.output).toBe("ok");
    }
  });

  it("hydrates claude pending askuserquestion into snapshot userInputQueue", async () => {
    const loader = createClaudeHistoryLoader({
      workspaceId: "ws-claude-ask",
      workspacePath: "/tmp/ws-claude-ask",
      loadClaudeSession: vi.fn().mockResolvedValue({
        messages: [
          {
            kind: "tool",
            id: "tool-ask-pending-1",
            tool_name: "AskUserQuestion",
            tool_input: {
              questions: [
                {
                  id: "project-type",
                  header: "项目类型",
                  question: "请选择项目类型",
                  multiSelect: false,
                  options: [
                    { label: "Web应用", description: "前端应用" },
                    { label: "服务端", description: "后端服务" },
                  ],
                },
              ],
            },
          },
        ],
      }),
    });

    const snapshot = await loader.load("claude:session-ask-pending");
    expect(snapshot.engine).toBe("claude");
    expect(snapshot.userInputQueue).toEqual([
      {
        workspace_id: "ws-claude-ask",
        request_id: "tool-ask-pending-1",
        params: {
          thread_id: "claude:session-ask-pending",
          turn_id: "",
          item_id: "tool-ask-pending-1",
          questions: [
            {
              id: "project-type",
              header: "项目类型",
              question: "请选择项目类型",
              isOther: true,
              isSecret: false,
              options: [
                { label: "Web应用", description: "前端应用" },
                { label: "服务端", description: "后端服务" },
              ],
            },
          ],
        },
      },
    ]);
  });

  it("merges Claude tool result by tool_use_id and avoids duplicate tool rows", () => {
    const items = parseClaudeHistoryMessages([
      {
        id: "toolu_123",
        kind: "tool",
        tool_name: "read",
        text: '{"file_path":"README.md"}',
      },
      {
        id: "result_456",
        kind: "tool",
        toolType: "result",
        tool_use_id: "toolu_123",
        text: "ok",
      },
    ]);

    const toolItems = items.filter(
      (item): item is Extract<(typeof items)[number], { kind: "tool" }> =>
        item.kind === "tool",
    );
    expect(toolItems).toHaveLength(1);
    expect(toolItems[0]).toEqual(
      expect.objectContaining({
        id: "toolu_123",
        status: "completed",
        output: "ok",
      }),
    );
  });

  it("reconstructs Claude Write/Edit history entries as file changes", () => {
    const items = parseClaudeHistoryMessages([
      {
        id: "write-1",
        kind: "tool",
        tool_name: "Write",
        toolInput: {
          file_path: "src/NewFile.ts",
          content: "export const value = 1;",
        },
      },
      {
        id: "write-1-result",
        kind: "tool",
        toolType: "result",
        tool_use_id: "write-1",
        text: "File created successfully",
        toolOutput: {
          type: "create",
          filePath: "src/NewFile.ts",
          content: "export const value = 1;",
        },
      },
      {
        id: "edit-1",
        kind: "tool",
        tool_name: "Edit",
        toolInput: {
          file_path: "src/App.tsx",
          old_string: "const before = true;",
          new_string: "const after = true;",
        },
      },
      {
        id: "edit-1-result",
        kind: "tool",
        toolType: "result",
        tool_use_id: "edit-1",
        text: "The file has been updated successfully.",
        toolOutput: {
          filePath: "src/App.tsx",
          oldString: "const before = true;",
          newString: "const after = true;",
        },
      },
    ]);

    const toolItems = items.filter(
      (item): item is Extract<(typeof items)[number], { kind: "tool" }> =>
        item.kind === "tool",
    );
    expect(toolItems).toHaveLength(2);
    expect(toolItems[0]).toEqual(
      expect.objectContaining({
        id: "write-1",
        toolType: "fileChange",
        status: "completed",
        changes: [
          expect.objectContaining({
            path: "src/NewFile.ts",
            kind: "add",
          }),
        ],
      }),
    );
    expect(toolItems[0]?.changes?.[0]?.diff).toContain("+export const value = 1;");
    expect(toolItems[1]).toEqual(
      expect.objectContaining({
        id: "edit-1",
        toolType: "fileChange",
        status: "completed",
        changes: [
          expect.objectContaining({
            path: "src/App.tsx",
            kind: "modified",
          }),
        ],
      }),
    );
    expect(toolItems[1]?.changes?.[0]?.diff).toContain("-const before = true;");
    expect(toolItems[1]?.changes?.[0]?.diff).toContain("+const after = true;");
  });

  it("reconstructs Claude Delete history entries as delete file changes", () => {
    const items = parseClaudeHistoryMessages([
      {
        id: "delete-1",
        kind: "tool",
        tool_name: "Delete",
        toolInput: {
          file_path: "docs/SPEC_KIT_实战指南.md",
        },
      },
      {
        id: "delete-1-result",
        kind: "tool",
        toolType: "result",
        tool_use_id: "delete-1",
        text: "File removed successfully",
      },
    ]);

    const toolItems = items.filter(
      (item): item is Extract<(typeof items)[number], { kind: "tool" }> =>
        item.kind === "tool",
    );
    expect(toolItems).toHaveLength(1);
    expect(toolItems[0]).toEqual(
      expect.objectContaining({
        id: "delete-1",
        toolType: "fileChange",
        status: "completed",
        changes: [
          expect.objectContaining({
            path: "docs/SPEC_KIT_实战指南.md",
            kind: "delete",
          }),
        ],
      }),
    );
  });

  it("collapses repeated claude reasoning snapshots with different ids", () => {
    const items = parseClaudeHistoryMessages([
      {
        kind: "reasoning",
        id: "reason-1",
        text: "先检查项目目录结构和入口模块，再确认核心路由",
      },
      {
        kind: "reasoning",
        id: "reason-2",
        text: "先检查项目目录结构和入口模块，再确认核心路由并定位状态来源",
      },
      {
        kind: "reasoning",
        id: "reason-3",
        text: "先检查项目目录结构和入口模块，再确认核心路由并定位状态来源",
      },
    ]);

    const reasoning = items.filter(
      (item): item is Extract<(typeof items)[number], { kind: "reasoning" }> =>
        item.kind === "reasoning",
    );
    expect(reasoning).toHaveLength(1);
    expect(reasoning[0]?.content).toBe(
      "先检查项目目录结构和入口模块，再确认核心路由并定位状态来源",
    );
  });

  it("emits fallback warnings for claude loader when workspace path is unavailable", async () => {
    const loader = createClaudeHistoryLoader({
      workspaceId: "ws-3",
      workspacePath: null,
      loadClaudeSession: vi.fn(),
    });

    const snapshot = await loader.load("claude:session-missing");
    expect(snapshot.items).toEqual([]);
    expect(snapshot.fallbackWarnings.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        "missing_items",
        "missing_plan",
        "missing_user_input_queue",
      ]),
    );
  });

  it("emits fallback warnings for opencode loader when thread payload is missing", async () => {
    const loader = createOpenCodeHistoryLoader({
      workspaceId: "ws-4",
      resumeThread: vi.fn().mockResolvedValue(null),
    });

    const snapshot = await loader.load("opencode:ses_missing");
    expect(snapshot.items).toEqual([]);
    expect(snapshot.fallbackWarnings.map((entry) => entry.code)).toContain(
      "missing_items",
    );
  });

  it("prefers truncated codex local message history when remote resume drops the prior assistant turn", async () => {
    const loader = createCodexHistoryLoader({
      workspaceId: "ws-codex-rewind-local-truth",
      resumeThread: vi.fn().mockResolvedValue({
        result: {
          thread: {
            turns: [
              {
                id: "turn-1",
                items: [
                  {
                    id: "remote-user-1",
                    type: "userMessage",
                    content: [{ type: "text", text: "First request" }],
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
            type: "event_msg",
            payload: {
              type: "user_message",
              message: "First request",
            },
          },
          {
            type: "event_msg",
            payload: {
              type: "agent_message",
              message: "First reply",
            },
          },
        ],
      }),
    });

    const snapshot = await loader.load("thread-codex-rewind-local-truth");
    expect(
      snapshot.items.filter(
        (item) => item.kind === "message" && item.role === "assistant",
      ),
    ).toEqual([
      expect.objectContaining({
        kind: "message",
        role: "assistant",
        text: "First reply",
      }),
    ]);
  });

  it("prefers truncated codex local message history when remote resume still contains rewound tail messages", async () => {
    const loader = createCodexHistoryLoader({
      workspaceId: "ws-codex-rewind-tail-truncation",
      resumeThread: vi.fn().mockResolvedValue({
        result: {
          thread: {
            turns: [
              {
                id: "turn-1",
                items: [
                  {
                    id: "remote-user-1",
                    type: "userMessage",
                    content: [{ type: "text", text: "First request" }],
                  },
                  {
                    id: "remote-assistant-1",
                    type: "agentMessage",
                    text: "First reply",
                  },
                ],
              },
              {
                id: "turn-2",
                items: [
                  {
                    id: "remote-user-2",
                    type: "userMessage",
                    content: [{ type: "text", text: "Second request" }],
                  },
                  {
                    id: "remote-assistant-2",
                    type: "agentMessage",
                    text: "Second reply",
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
            type: "event_msg",
            payload: {
              type: "user_message",
              message: "First request",
            },
          },
          {
            type: "event_msg",
            payload: {
              type: "agent_message",
              message: "First reply",
            },
          },
        ],
      }),
    });

    const snapshot = await loader.load("thread-codex-rewind-tail-truncation");
    expect(
      snapshot.items.filter((item) => item.kind === "message").map((item) => item.text),
    ).toEqual(["First request", "First reply"]);
  });
});
