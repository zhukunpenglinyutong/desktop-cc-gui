import { describe, expect, it, vi } from "vitest";
import { parseClaudeHistoryMessages } from "./claudeHistoryLoader";
import { createCodexHistoryLoader } from "./codexHistoryLoader";
import { createOpenCodeHistoryLoader } from "./opencodeHistoryLoader";

describe("history loaders fallback and tool reconstruction", () => {
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
