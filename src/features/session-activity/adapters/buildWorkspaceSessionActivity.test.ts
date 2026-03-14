import { describe, expect, it } from "vitest";
import type { ConversationItem, ThreadSummary } from "../../../types";
import { buildWorkspaceSessionActivity } from "./buildWorkspaceSessionActivity";

function toolItem(
  id: string,
  overrides: Partial<Extract<ConversationItem, { kind: "tool" }>>,
): Extract<ConversationItem, { kind: "tool" }> {
  return {
    id,
    kind: "tool",
    toolType: "commandExecution",
    title: "Command: pnpm test",
    detail: "",
    ...overrides,
  };
}

describe("buildWorkspaceSessionActivity", () => {
  it("aggregates root subtree events and excludes unrelated threads", () => {
    const threads: ThreadSummary[] = [
      { id: "root", name: "Root", updatedAt: 1000 },
      { id: "child", name: "Child", updatedAt: 2000 },
      { id: "other", name: "Other", updatedAt: 3000 },
    ];
    const itemsByThread = {
      root: [
        toolItem("cmd-1", {
          toolType: "commandExecution",
          title: "Command: pnpm test",
          status: "completed",
          output: "done",
        }),
      ],
      child: [
        toolItem("task-1", {
          toolType: "taskTool",
          title: "Tool: task",
          detail: JSON.stringify({ description: "Audit current panel" }),
          status: "running",
        }),
        toolItem("file-1", {
          toolType: "fileChange",
          title: "File changes",
          detail: "M src/App.tsx",
          status: "completed",
          changes: [{ path: "src/App.tsx", diff: "@@ -1 +1 @@\n-old\n+new" }],
        }),
      ],
      other: [
        toolItem("cmd-2", {
          toolType: "commandExecution",
          title: "Command: rm -rf tmp",
          status: "completed",
        }),
      ],
    };

    const result = buildWorkspaceSessionActivity({
      activeThreadId: "child",
      threads,
      itemsByThread,
      threadParentById: { child: "root" },
      threadStatusById: {
        root: { isProcessing: false },
        child: { isProcessing: true },
        other: { isProcessing: false },
      },
    });

    expect(result.rootThreadId).toBe("root");
    expect(result.relevantThreadIds).toEqual(["root", "child"]);
    expect(result.timeline.map((event) => event.kind)).toEqual([
      "fileChange",
      "task",
      "command",
    ]);
    expect(result.timeline[0]?.jumpTarget).toEqual({
      type: "file",
      path: "src/App.tsx",
      line: 1,
      markers: {
        added: [],
        modified: [1],
      },
    });
    expect(result.timeline.every((event) => event.threadId !== "other")).toBe(true);
    expect(result.isProcessing).toBe(true);
  });

  it("uses fallback linking when direct parent is missing and marks provenance", () => {
    const threads: ThreadSummary[] = [
      { id: "root", name: "Root", updatedAt: 1000 },
      { id: "child", name: "Child", updatedAt: 1100 },
    ];
    const itemsByThread = {
      root: [
        toolItem("link-1", {
          toolType: "collabToolCall",
          title: "Collab: task",
          detail: "From root → child",
          status: "completed",
        }),
      ],
      child: [
        toolItem("cmd-1", {
          toolType: "commandExecution",
          title: "Command: pnpm lint",
          status: "running",
          output: "checking",
        }),
      ],
    };

    const result = buildWorkspaceSessionActivity({
      activeThreadId: "child",
      threads,
      itemsByThread,
      threadParentById: {},
      threadStatusById: {
        child: { isProcessing: true },
      },
    });

    expect(result.rootThreadId).toBe("root");
    expect(result.relevantThreadIds).toEqual(["root", "child"]);
    expect(result.timeline[0]?.relationshipSource).toBe("fallbackLinking");
  });

  it("shows reasoning events as a dedicated timeline category", () => {
    const threads: ThreadSummary[] = [{ id: "root", name: "Root", updatedAt: 1000 }];
    const itemsByThread = {
      root: [
        { id: "reason-1", kind: "reasoning", summary: "thinking", content: "..." } satisfies ConversationItem,
        toolItem("cmd-1", {
          toolType: "commandExecution",
          title: "Command: pnpm test",
          status: "completed",
        }),
      ],
    };

    const result = buildWorkspaceSessionActivity({
      activeThreadId: "root",
      threads,
      itemsByThread,
      threadParentById: {},
      threadStatusById: {},
    });

    expect(result.timeline).toHaveLength(2);
    expect(result.timeline.map((event) => event.kind)).toEqual(["command", "reasoning"]);
    expect(result.timeline[1]?.summary).toBe("Thinking · ...");
  });

  it("normalizes claude multiline reasoning summary into a single activity event", () => {
    const threads: ThreadSummary[] = [{ id: "claude-pending-1", name: "Claude", updatedAt: 1000 }];
    const itemsByThread = {
      "claude-pending-1": [
        {
          id: "reason-claude-1",
          kind: "reasoning" as const,
          summary: "step 1\nstep 2\nstep 3",
          content: "detailed reasoning preview",
        } satisfies ConversationItem,
      ],
    };

    const result = buildWorkspaceSessionActivity({
      activeThreadId: "claude-pending-1",
      threads,
      itemsByThread,
      threadParentById: {},
      threadStatusById: { "claude-pending-1": { isProcessing: true } },
    });

    expect(result.timeline).toHaveLength(1);
    expect(result.timeline[0]?.summary).toBe("Thinking · step 1");
    expect(result.timeline[0]?.status).toBe("running");
    expect(result.timeline[0]?.eventId).toBe("reasoning:reason-claude-1");
  });

  it("keeps claude reasoning timeline append-only when snapshots rewrite same position", () => {
    const threadId = "claude:session-append-only";
    const threads: ThreadSummary[] = [{ id: threadId, name: "Claude", updatedAt: 1000 }];
    const itemsByThread = {
      [threadId]: [
        {
          id: "reason-claude-append-1",
          kind: "reasoning" as const,
          summary: "先读取项目结构",
          content: "先读取 README 和 docs 目录",
        } satisfies ConversationItem,
        {
          id: "reason-claude-append-2",
          kind: "reasoning" as const,
          summary: "再检查关键配置",
          content: "再检查 package.json 和脚本入口",
        } satisfies ConversationItem,
      ],
    };

    const result = buildWorkspaceSessionActivity({
      activeThreadId: threadId,
      threads,
      itemsByThread,
      threadParentById: {},
      threadStatusById: { [threadId]: { isProcessing: true } },
    });

    const reasoningEvents = result.timeline.filter((event) => event.kind === "reasoning");
    expect(reasoningEvents).toHaveLength(1);
    const latestReasoning = reasoningEvents[0];
    expect(latestReasoning?.summary).toContain("先读取项目结构");
    expect(latestReasoning?.reasoningPreview).toContain("先读取 README 和 docs 目录");
    expect(latestReasoning?.reasoningPreview).toContain("再检查 package.json 和脚本入口");
  });

  it("merges claude reasoning nodes into the first timeline node per turn", () => {
    const threadId = "claude:session-merge-first-node";
    const threads: ThreadSummary[] = [{ id: threadId, name: "Claude", updatedAt: 1000 }];
    const itemsByThread = {
      [threadId]: [
        {
          id: "reason-claude-first-node-1",
          kind: "reasoning" as const,
          summary: "先看项目结构",
          content: "先读取 README 和 docs 目录",
        } satisfies ConversationItem,
        toolItem("cmd-claude-first-node-1", {
          toolType: "commandExecution",
          title: "Command: ls -la",
          status: "completed",
          output: "total 8",
        }),
        {
          id: "reason-claude-first-node-2",
          kind: "reasoning" as const,
          summary: "再看配置",
          content: "再检查 package.json 和脚本入口",
        } satisfies ConversationItem,
        {
          id: "reason-claude-first-node-3",
          kind: "reasoning" as const,
          summary: "最后看源码",
          content: "最后阅读关键 Python 文件",
        } satisfies ConversationItem,
      ],
    };

    const result = buildWorkspaceSessionActivity({
      activeThreadId: threadId,
      threads,
      itemsByThread,
      threadParentById: {},
      threadStatusById: { [threadId]: { isProcessing: true } },
    });

    const reasoningEvents = result.timeline.filter((event) => event.kind === "reasoning");
    expect(reasoningEvents).toHaveLength(1);
    const mergedReasoning = reasoningEvents[0];
    expect(mergedReasoning?.eventId).toBe("reasoning:reason-claude-first-node-1");
    expect(mergedReasoning?.reasoningPreview).toContain("先读取 README 和 docs 目录");
    expect(mergedReasoning?.reasoningPreview).toContain("再检查 package.json 和脚本入口");
    expect(mergedReasoning?.reasoningPreview).toContain("最后阅读关键 Python 文件");

    const commandEvents = result.timeline.filter((event) => event.kind === "command");
    expect(commandEvents).toHaveLength(1);
  });

  it("keeps non-claude multiline reasoning summary as a single activity event", () => {
    const threads: ThreadSummary[] = [{ id: "root", name: "Root", updatedAt: 1000 }];
    const itemsByThread = {
      root: [
        {
          id: "reason-generic-1",
          kind: "reasoning" as const,
          summary: "step 1\nstep 2\nstep 3",
          content: "detailed reasoning preview",
        } satisfies ConversationItem,
      ],
    };

    const result = buildWorkspaceSessionActivity({
      activeThreadId: "root",
      threads,
      itemsByThread,
      threadParentById: {},
      threadStatusById: { root: { isProcessing: true } },
    });

    expect(result.timeline).toHaveLength(1);
    expect(result.timeline[0]?.eventId).toBe("reasoning:reason-generic-1");
    expect(result.timeline[0]?.summary).toBe("Thinking · step 1");
    expect(result.timeline[0]?.status).toBe("running");
  });

  it("collapses consecutive opencode reasoning items like the messages view", () => {
    const threads: ThreadSummary[] = [{ id: "opencode:session-1", name: "OpenCode", updatedAt: 1000 }];
    const itemsByThread = {
      "opencode:session-1": [
        {
          id: "reason-opencode-1",
          kind: "reasoning" as const,
          summary: "thinking",
          content: "先读取项目规范文件。",
        } satisfies ConversationItem,
        {
          id: "reason-opencode-2",
          kind: "reasoning" as const,
          summary: "thinking",
          content: "先读取项目规范文件。\n然后检查 src 目录结构。",
        } satisfies ConversationItem,
      ],
    };

    const result = buildWorkspaceSessionActivity({
      activeThreadId: "opencode:session-1",
      threads,
      itemsByThread,
      threadParentById: {},
      threadStatusById: { "opencode:session-1": { isProcessing: true } },
    });

    expect(result.timeline).toHaveLength(1);
    expect(result.timeline[0]?.eventId).toBe("reasoning:reason-opencode-2");
    expect(result.timeline[0]?.summary).toBe("Thinking · 先读取项目规范文件。");
    expect(result.timeline[0]?.reasoningPreview).toContain("然后检查 src 目录结构。");
  });

  it("keeps interleaved reasoning snapshots as separate activity events like the messages view", () => {
    const threads: ThreadSummary[] = [{ id: "opencode:session-2", name: "OpenCode", updatedAt: 1000 }];
    const itemsByThread = {
      "opencode:session-2": [
        {
          id: "user-1",
          kind: "message" as const,
          role: "user" as const,
          text: "重构日志模块",
        } satisfies ConversationItem,
        {
          id: "reason-opencode-3",
          kind: "reasoning" as const,
          summary: "现在我了解当前日志模块代码。让我分析一下可以重构的地方：",
          content: "现在我了解当前日志模块代码。让我分析一下可以重构的地方：",
        } satisfies ConversationItem,
        toolItem("cmd-opencode-1", {
          toolType: "commandExecution",
          title: "Command: mvn test",
          status: "completed",
          output: "ok",
        }),
        {
          id: "reason-opencode-4",
          kind: "reasoning" as const,
          summary: "现在重构 LogService，添加分页和筛选功能。",
          content:
            "现在我了解当前日志模块代码。让我分析一下可以重构的地方：\n\n现在重构 LogService，添加分页和筛选功能。",
        } satisfies ConversationItem,
      ],
    };

    const result = buildWorkspaceSessionActivity({
      activeThreadId: "opencode:session-2",
      threads,
      itemsByThread,
      threadParentById: {},
      threadStatusById: { "opencode:session-2": { isProcessing: false } },
    });

    const reasoningEvents = result.timeline.filter((event) => event.kind === "reasoning");
    expect(reasoningEvents).toHaveLength(2);
    expect(reasoningEvents.map((event) => event.eventId)).toEqual([
      "reasoning:reason-opencode-4",
      "reasoning:reason-opencode-3",
    ]);
    expect(reasoningEvents[0]?.reasoningPreview).toContain("现在重构 LogService");
    expect(reasoningEvents[1]?.reasoningPreview).toContain("让我分析一下可以重构的地方");
    expect(result.timeline.filter((event) => event.kind === "command")).toHaveLength(1);
  });

  it("extracts structured command detail for inline expansion", () => {
    const threads: ThreadSummary[] = [{ id: "root", name: "Root", updatedAt: 1000 }];
    const itemsByThread = {
      root: [
        toolItem("cmd-1", {
          toolType: "commandExecution",
          title: "Command",
          detail: JSON.stringify({
            command: "ls -la",
            description: "列出当前目录内容",
            cwd: "/workspace/demo",
          }),
          status: "running",
        }),
      ],
    };

    const result = buildWorkspaceSessionActivity({
      activeThreadId: "root",
      threads,
      itemsByThread,
      threadParentById: {},
      threadStatusById: { root: { isProcessing: true } },
    });

    expect(result.timeline[0]?.summary).toBe("ls -la");
    expect(result.timeline[0]?.commandText).toBe("ls -la");
    expect(result.timeline[0]?.commandDescription).toBe("列出当前目录内容");
    expect(result.timeline[0]?.commandWorkingDirectory).toBe("/workspace/demo");
  });

  it("extracts command metadata from argv-style Claude tool payload", () => {
    const threads: ThreadSummary[] = [{ id: "claude:session-1", name: "Claude", updatedAt: 1000 }];
    const itemsByThread = {
      "claude:session-1": [
        toolItem("cmd-argv-1", {
          toolType: "bash",
          title: "bash",
          detail: JSON.stringify({
            argv: ["zsh", "-lc", "pnpm vitest"],
            cwd: "/workspace/project",
            description: "run tests",
          }),
          status: "running",
        }),
      ],
    };

    const result = buildWorkspaceSessionActivity({
      activeThreadId: "claude:session-1",
      threads,
      itemsByThread,
      threadParentById: {},
      threadStatusById: { "claude:session-1": { isProcessing: true } },
    });

    expect(result.timeline).toHaveLength(1);
    expect(result.timeline[0]?.kind).toBe("command");
    expect(result.timeline[0]?.summary).toBe("zsh -lc pnpm vitest");
    expect(result.timeline[0]?.commandText).toBe("zsh -lc pnpm vitest");
    expect(result.timeline[0]?.commandDescription).toBe("run tests");
    expect(result.timeline[0]?.commandWorkingDirectory).toBe("/workspace/project");
  });

  it("settles stale running events once the thread is no longer processing", () => {
    const threads: ThreadSummary[] = [{ id: "root", name: "Root", updatedAt: 1000 }];
    const itemsByThread = {
      root: [
        toolItem("cmd-1", {
          toolType: "commandExecution",
          title: "Command: find . -maxdepth 2",
          status: "running",
        }),
      ],
    };

    const result = buildWorkspaceSessionActivity({
      activeThreadId: "root",
      threads,
      itemsByThread,
      threadParentById: {},
      threadStatusById: { root: { isProcessing: false } },
    });

    expect(result.isProcessing).toBe(false);
    expect(result.timeline[0]?.status).toBe("completed");
    expect(result.emptyState).toBe("completed");
  });

  it("shows Claude inspection tools in realtime activity even without commandExecution items", () => {
    const threads: ThreadSummary[] = [
      { id: "claude-pending-1", name: "Claude session", updatedAt: 1000 },
    ];
    const itemsByThread = {
      "claude-pending-1": [
        toolItem("tool-read", {
          toolType: "mcpToolCall",
          title: "Tool: read",
          detail: JSON.stringify({ filePath: "/workspace/package.json" }),
          status: "started",
        }),
        toolItem("tool-glob", {
          toolType: "mcpToolCall",
          title: "Tool: glob",
          detail: JSON.stringify({ pattern: "**/*.py" }),
          status: "started",
        }),
      ],
    };

    const result = buildWorkspaceSessionActivity({
      activeThreadId: "claude-pending-1",
      threads,
      itemsByThread,
      threadParentById: {},
      threadStatusById: { "claude-pending-1": { isProcessing: true } },
    });

    expect(result.timeline).toHaveLength(2);
    expect(result.timeline.map((event) => event.kind)).toEqual(["task", "task"]);
    expect(result.timeline[0]?.summary).toBe("Search · **/*.py");
    expect(result.timeline[1]?.summary).toBe("Read · package.json");
    expect(result.timeline[1]?.jumpTarget).toEqual({
      type: "file",
      path: "/workspace/package.json",
    });
    expect(result.emptyState).toBe("running");
  });

  it("extracts read target from snake_case nested arguments", () => {
    const threads: ThreadSummary[] = [{ id: "claude-pending-1", name: "Claude", updatedAt: 1000 }];
    const itemsByThread = {
      "claude-pending-1": [
        toolItem("tool-read", {
          toolType: "mcpToolCall",
          title: "Tool: mcp__filesystem__read_file",
          detail: JSON.stringify({
            input: { file_path: "/workspace/README.md" },
          }),
          status: "started",
        }),
      ],
    };

    const result = buildWorkspaceSessionActivity({
      activeThreadId: "claude-pending-1",
      threads,
      itemsByThread,
      threadParentById: {},
      threadStatusById: { "claude-pending-1": { isProcessing: true } },
    });

    expect(result.timeline).toHaveLength(1);
    expect(result.timeline[0]?.kind).toBe("task");
    expect(result.timeline[0]?.summary).toBe("Read · README.md");
    expect(result.timeline[0]?.jumpTarget).toEqual({
      type: "file",
      path: "/workspace/README.md",
    });
  });

  it("joins cwd with basename-only read path so file card can open correctly", () => {
    const threads: ThreadSummary[] = [{ id: "root", name: "Root", updatedAt: 1000 }];
    const itemsByThread = {
      root: [
        toolItem("tool-read", {
          toolType: "mcpToolCall",
          title: "Tool: read",
          detail: JSON.stringify({
            path: "retrieve_memory.py",
            cwd: "dify/mem0-plugin-src/modified/tools",
          }),
          status: "started",
        }),
      ],
    };

    const result = buildWorkspaceSessionActivity({
      activeThreadId: "root",
      threads,
      itemsByThread,
      threadParentById: {},
      threadStatusById: { root: { isProcessing: true } },
    });

    expect(result.timeline).toHaveLength(1);
    expect(result.timeline[0]?.summary).toBe("Read · retrieve_memory.py");
    expect(result.timeline[0]?.jumpTarget).toEqual({
      type: "file",
      path: "dify/mem0-plugin-src/modified/tools/retrieve_memory.py",
    });
  });

  it("joins cwd with relative read path that includes subdirectories", () => {
    const threads: ThreadSummary[] = [{ id: "root", name: "Root", updatedAt: 1000 }];
    const itemsByThread = {
      root: [
        toolItem("tool-read", {
          toolType: "mcpToolCall",
          title: "Tool: read",
          detail: JSON.stringify({
            path: "tools/retrieve_memory.py",
            cwd: "dify/mem0-plugin-src/modified",
          }),
          status: "started",
        }),
      ],
    };

    const result = buildWorkspaceSessionActivity({
      activeThreadId: "root",
      threads,
      itemsByThread,
      threadParentById: {},
      threadStatusById: { root: { isProcessing: true } },
    });

    expect(result.timeline).toHaveLength(1);
    expect(result.timeline[0]?.summary).toBe("Read · retrieve_memory.py");
    expect(result.timeline[0]?.jumpTarget).toEqual({
      type: "file",
      path: "dify/mem0-plugin-src/modified/tools/retrieve_memory.py",
    });
  });

  it("does not join cwd for windows absolute path", () => {
    const threads: ThreadSummary[] = [{ id: "root", name: "Root", updatedAt: 1000 }];
    const itemsByThread = {
      root: [
        toolItem("tool-read", {
          toolType: "mcpToolCall",
          title: "Tool: read",
          detail: JSON.stringify({
            path: "C:\\workspace\\repo\\retrieve_memory.py",
            cwd: "dify/mem0-plugin-src/modified",
          }),
          status: "started",
        }),
      ],
    };

    const result = buildWorkspaceSessionActivity({
      activeThreadId: "root",
      threads,
      itemsByThread,
      threadParentById: {},
      threadStatusById: { root: { isProcessing: true } },
    });

    expect(result.timeline).toHaveLength(1);
    expect(result.timeline[0]?.summary).toBe("Read · retrieve_memory.py");
    expect(result.timeline[0]?.jumpTarget).toEqual({
      type: "file",
      path: "C:\\workspace\\repo\\retrieve_memory.py",
    });
  });

  it("treats namespaced exec_command tool as command event", () => {
    const threads: ThreadSummary[] = [{ id: "claude-pending-1", name: "Claude", updatedAt: 1000 }];
    const itemsByThread = {
      "claude-pending-1": [
        toolItem("tool-cmd", {
          toolType: "mcpToolCall",
          title: "Tool: mcp__codex__exec_command",
          detail: JSON.stringify({
            cmd: "ls -la",
            cwd: "/workspace",
          }),
          status: "running",
          output: "README.md\nsrc\n",
        }),
      ],
    };

    const result = buildWorkspaceSessionActivity({
      activeThreadId: "claude-pending-1",
      threads,
      itemsByThread,
      threadParentById: {},
      threadStatusById: { "claude-pending-1": { isProcessing: true } },
    });

    expect(result.timeline).toHaveLength(1);
    expect(result.timeline[0]?.kind).toBe("command");
    expect(result.timeline[0]?.summary).toBe("ls -la");
    expect(result.timeline[0]?.commandWorkingDirectory).toBe("/workspace");
  });

  it("expands explore snapshots into session activity events", () => {
    const threads: ThreadSummary[] = [{ id: "root", name: "Root", updatedAt: 1000 }];
    const itemsByThread = {
      root: [
        {
          id: "explore-1",
          kind: "explore" as const,
          status: "explored" as const,
          entries: [
            { kind: "list" as const, label: "/workspace" },
            { kind: "search" as const, label: "*.md" },
            { kind: "read" as const, label: "/workspace/README.md" },
            { kind: "run" as const, label: "wc -l README.md", detail: "统计代码行数" },
          ],
        } satisfies ConversationItem,
      ],
    };

    const result = buildWorkspaceSessionActivity({
      activeThreadId: "root",
      threads,
      itemsByThread,
      threadParentById: {},
      threadStatusById: { root: { isProcessing: true } },
    });

    expect(result.timeline).toHaveLength(4);
    expect(result.timeline.map((event) => event.kind)).toEqual([
      "explore",
      "explore",
      "explore",
      "explore",
    ]);
    expect(result.timeline[0]?.summary).toBe("wc -l README.md");
    expect(result.timeline[1]?.summary).toBe("Read · README.md");
    expect(result.timeline[1]?.jumpTarget).toEqual({
      type: "file",
      path: "/workspace/README.md",
    });
    expect(result.timeline[2]?.summary).toBe("Search · *.md");
    expect(result.timeline[3]?.summary).toBe("List · /workspace");
  });

  it("uses explore read detail path for jump target when label is basename", () => {
    const threads: ThreadSummary[] = [{ id: "root", name: "Root", updatedAt: 1000 }];
    const itemsByThread = {
      root: [
        {
          id: "explore-read-detail-1",
          kind: "explore" as const,
          status: "explored" as const,
          entries: [
            { kind: "read" as const, label: "README.md", detail: "/workspace/README.md" },
          ],
        } satisfies ConversationItem,
      ],
    };

    const result = buildWorkspaceSessionActivity({
      activeThreadId: "root",
      threads,
      itemsByThread,
      threadParentById: {},
      threadStatusById: { root: { isProcessing: false } },
    });

    expect(result.timeline).toHaveLength(1);
    expect(result.timeline[0]?.summary).toBe("Read · README.md");
    expect(result.timeline[0]?.jumpTarget).toEqual({
      type: "file",
      path: "/workspace/README.md",
    });
  });

  it("does not treat semantic explore read labels as file paths", () => {
    const threads: ThreadSummary[] = [{ id: "root", name: "Root", updatedAt: 1000 }];
    const itemsByThread = {
      root: [
        {
          id: "explore-read-semantic-1",
          kind: "explore" as const,
          status: "explored" as const,
          entries: [{ kind: "read" as const, label: "读取策略", detail: "优先读取该目录" }],
        } satisfies ConversationItem,
      ],
    };

    const result = buildWorkspaceSessionActivity({
      activeThreadId: "root",
      threads,
      itemsByThread,
      threadParentById: {},
      threadStatusById: { root: { isProcessing: false } },
    });

    expect(result.timeline).toHaveLength(1);
    expect(result.timeline[0]?.summary).toBe("Read · 读取策略");
    expect(result.timeline[0]?.jumpTarget).toEqual({
      type: "thread",
      threadId: "root",
    });
  });

  it("splits activity events by user conversation turns", () => {
    const threads: ThreadSummary[] = [{ id: "root", name: "Root", updatedAt: 1000 }];
    const itemsByThread = {
      root: [
        {
          id: "user-1",
          kind: "message" as const,
          role: "user" as const,
          text: "先看看项目结构",
        } satisfies ConversationItem,
        toolItem("task-1", {
          toolType: "mcpToolCall",
          title: "Tool: glob",
          detail: JSON.stringify({ pattern: "**/*.md" }),
          status: "completed",
        }),
        toolItem("task-2", {
          toolType: "mcpToolCall",
          title: "Tool: read",
          detail: JSON.stringify({ filePath: "/workspace/README.md" }),
          status: "completed",
        }),
        {
          id: "user-2",
          kind: "message" as const,
          role: "user" as const,
          text: "再检查 Python 文件",
        } satisfies ConversationItem,
        toolItem("task-3", {
          toolType: "mcpToolCall",
          title: "Tool: glob",
          detail: JSON.stringify({ pattern: "**/*.py" }),
          status: "running",
        }),
      ],
    };

    const result = buildWorkspaceSessionActivity({
      activeThreadId: "root",
      threads,
      itemsByThread,
      threadParentById: {},
      threadStatusById: { root: { isProcessing: true } },
    });

    expect(result.timeline).toHaveLength(3);
    expect(result.timeline.map((event) => event.turnIndex)).toEqual([2, 1, 1]);
    expect(new Set(result.timeline.map((event) => event.turnId)).size).toBe(2);
  });

  it("marks only latest-turn reasoning as running while older turn reasoning is completed", () => {
    const threads: ThreadSummary[] = [{ id: "root", name: "Root", updatedAt: 1000 }];
    const itemsByThread = {
      root: [
        {
          id: "user-1",
          kind: "message" as const,
          role: "user" as const,
          text: "你好",
        } satisfies ConversationItem,
        {
          id: "reason-1",
          kind: "reasoning" as const,
          summary: "old turn thinking",
          content: "old turn detail",
        } satisfies ConversationItem,
        {
          id: "user-2",
          kind: "message" as const,
          role: "user" as const,
          text: "继续",
        } satisfies ConversationItem,
        {
          id: "reason-2",
          kind: "reasoning" as const,
          summary: "latest turn thinking",
          content: "latest turn detail",
        } satisfies ConversationItem,
      ],
    };

    const result = buildWorkspaceSessionActivity({
      activeThreadId: "root",
      threads,
      itemsByThread,
      threadParentById: {},
      threadStatusById: { root: { isProcessing: true } },
    });

    const latestReasoning = result.timeline.find((event) => event.eventId === "reasoning:reason-2");
    const olderReasoning = result.timeline.find((event) => event.eventId === "reasoning:reason-1");
    expect(latestReasoning?.status).toBe("running");
    expect(olderReasoning?.status).toBe("completed");
  });

  it("assigns distinct fallback timestamps for consecutive thread events", () => {
    const threads: ThreadSummary[] = [{ id: "root", name: "Root", updatedAt: 1_000_000 }];
    const itemsByThread = {
      root: [
        toolItem("cmd-1", { status: "completed" }),
        toolItem("cmd-2", { status: "completed" }),
        toolItem("cmd-3", { status: "completed" }),
      ],
    };

    const result = buildWorkspaceSessionActivity({
      activeThreadId: "root",
      threads,
      itemsByThread,
      threadParentById: {},
      threadStatusById: { root: { isProcessing: false } },
    });

    expect(result.timeline).toHaveLength(3);
    const occurredAt = result.timeline.map((event) => event.occurredAt);
    expect(occurredAt[0] - occurredAt[1]).toBeGreaterThanOrEqual(1000);
    expect(occurredAt[1] - occurredAt[2]).toBeGreaterThanOrEqual(1000);
  });
});
