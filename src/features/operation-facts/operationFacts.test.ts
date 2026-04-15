import { describe, expect, it } from "vitest";
import type { ConversationItem } from "../../types";
import {
  extractCommandSummaries,
  extractFileChangeSummaries,
  summarizeFileChangeItem,
} from "./operationFacts";

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

describe("operationFacts", () => {
  it("extracts command summaries with stable status mapping", () => {
    const items: ConversationItem[] = [
      toolItem("cmd-1", {
        toolType: "commandExecution",
        title: "Command: pnpm lint",
        status: "completed",
        output: "ok",
      }),
      toolItem("cmd-2", {
        toolType: "commandExecution",
        title: "Command: pnpm test",
        status: "running",
      }),
    ];

    expect(extractCommandSummaries(items)).toEqual([
      { id: "cmd-1", command: "pnpm lint", status: "completed" },
      { id: "cmd-2", command: "pnpm test", status: "running" },
    ]);
  });

  it("extracts aggregated file change summaries and item-level event summary from the same facts", () => {
    const fileItem = toolItem("file-1", {
      toolType: "fileChange",
      title: "File changes",
      detail: "{}",
      status: "completed",
      changes: [
        { path: "src/App.tsx", kind: "modified", diff: "@@ -1 +1 @@\n-old\n+new" },
        { path: "src/App.tsx", kind: "modified", diff: "@@ -2 +2 @@\n-older\n+newer" },
        { path: "src/New.tsx", kind: "added", diff: "@@ -0,0 +1 @@\n+const x = 1;" },
      ],
    });

    expect(extractFileChangeSummaries([fileItem])).toEqual([
      {
        filePath: "src/App.tsx",
        fileName: "App.tsx",
        status: "M",
        additions: 2,
        deletions: 2,
        diff: "@@ -2 +2 @@\n-older\n+newer",
      },
      {
        filePath: "src/New.tsx",
        fileName: "New.tsx",
        status: "A",
        additions: 1,
        deletions: 0,
        diff: "@@ -0,0 +1 @@\n+const x = 1;",
      },
    ]);

    expect(summarizeFileChangeItem(fileItem)).toEqual({
      summary: "File change · App.tsx +2",
      filePath: "src/App.tsx",
      fileCount: 3,
      additions: 3,
      deletions: 2,
      statusLetter: "M",
    });
  });

  it("preserves delete status for file change event summaries", () => {
    const fileItem = toolItem("file-2", {
      toolType: "fileChange",
      title: "File changes",
      detail: "{}",
      status: "completed",
      changes: [
        { path: "src/Old.tsx", kind: "deleted", diff: "@@ -1 +0,0 @@\n-old" },
      ],
    });

    expect(summarizeFileChangeItem(fileItem)).toEqual({
      summary: "File change · Old.tsx",
      filePath: "src/Old.tsx",
      fileCount: 1,
      additions: 0,
      deletions: 1,
      statusLetter: "D",
    });
  });

  it("infers delete file from tool hint and file_path args when changes are missing", () => {
    const deleteTool = toolItem("file-delete-inferred", {
      toolType: "Delete",
      title: "Delete",
      detail: JSON.stringify({
        input: {
          file_path: "SPEC_KIT_实战指南.md",
        },
      }),
      status: "completed",
    });

    expect(summarizeFileChangeItem(deleteTool)).toEqual({
      summary: "File change · SPEC_KIT_实战指南.md",
      filePath: "SPEC_KIT_实战指南.md",
      fileCount: 1,
      additions: 0,
      deletions: 0,
      statusLetter: "D",
    });

    expect(extractFileChangeSummaries([deleteTool])).toEqual([
      {
        filePath: "SPEC_KIT_实战指南.md",
        fileName: "SPEC_KIT_实战指南.md",
        status: "D",
        additions: 0,
        deletions: 0,
      },
    ]);
  });

  it("infers delete file from nested path args when changes are missing", () => {
    const deleteTool = toolItem("file-delete-nested", {
      toolType: "mcpToolCall",
      title: "Tool: codex / Delete",
      detail: JSON.stringify({
        input: {
          target: {
            file_path: "docs/SPEC_KIT_实战指南.md",
          },
        },
      }),
      status: "completed",
    });

    expect(summarizeFileChangeItem(deleteTool)).toEqual({
      summary: "File change · SPEC_KIT_实战指南.md",
      filePath: "docs/SPEC_KIT_实战指南.md",
      fileCount: 1,
      additions: 0,
      deletions: 0,
      statusLetter: "D",
    });

    expect(extractFileChangeSummaries([deleteTool])).toEqual([
      {
        filePath: "docs/SPEC_KIT_实战指南.md",
        fileName: "SPEC_KIT_实战指南.md",
        status: "D",
        additions: 0,
        deletions: 0,
      },
    ]);
  });

  it("recovers file list from status-detail lines when fileChange entries are missing", () => {
    const fileItem = toolItem("file-2-detail-only", {
      toolType: "fileChange",
      title: "File changes",
      detail: "D SPEC_KIT_实战指南.md",
      status: "completed",
      changes: [],
    });

    expect(extractFileChangeSummaries([fileItem])).toEqual([
      {
        filePath: "SPEC_KIT_实战指南.md",
        fileName: "SPEC_KIT_实战指南.md",
        status: "D",
        additions: 0,
        deletions: 0,
      },
    ]);
  });

  it("falls back to tool output diff when file change entries do not include inline diff", () => {
    const fileItem = toolItem("file-2-output-only", {
      toolType: "fileChange",
      title: "File changes",
      detail: "M src/App.tsx",
      status: "completed",
      output: "@@ -1 +1 @@\n-old\n+new",
      changes: [{ path: "src/App.tsx", kind: "modified" }],
    });

    expect(extractFileChangeSummaries([fileItem])).toEqual([
      {
        filePath: "src/App.tsx",
        fileName: "App.tsx",
        status: "M",
        additions: 1,
        deletions: 1,
      },
    ]);

    expect(summarizeFileChangeItem(fileItem)).toEqual({
      summary: "File change · App.tsx",
      filePath: "src/App.tsx",
      fileCount: 1,
      additions: 1,
      deletions: 1,
      statusLetter: "M",
    });
  });

  it("infers delete file from commandExecution rm command when structured changes are missing", () => {
    const commandItem = toolItem("cmd-delete-inferred", {
      toolType: "commandExecution",
      title: "Command: 删除文件",
      detail: JSON.stringify({
        command: 'rm "/Users/demo/repo/SPEC_KIT_实战指南.md"',
        description: "删除 SPEC_KIT_实战指南.md 文件",
      }),
      status: "completed",
      output: "",
      changes: [],
    });

    expect(extractFileChangeSummaries([commandItem])).toEqual([
      {
        filePath: "/Users/demo/repo/SPEC_KIT_实战指南.md",
        fileName: "SPEC_KIT_实战指南.md",
        status: "D",
        additions: 0,
        deletions: 0,
      },
    ]);
  });

  it("infers delete and add files from Bash tool entries when structured changes are missing", () => {
    const bashDeleteItem = toolItem("cmd-bash-delete-inferred", {
      toolType: "Bash",
      title: "Bash",
      detail: JSON.stringify({
        command: "rm /Users/demo/repo/.specify目录结构说明.md",
        description: "删除文件",
      }),
      status: "completed",
      output: "",
      changes: [],
    });
    const bashAddItem = toolItem("cmd-bash-add-inferred", {
      toolType: "Bash",
      title: "Bash",
      detail: JSON.stringify({
        command: "printf '100' > /Users/demo/repo/abc.txt",
        description: "新增文件",
      }),
      status: "completed",
      output: "",
      changes: [],
    });

    expect(extractFileChangeSummaries([bashDeleteItem, bashAddItem])).toEqual([
      {
        filePath: "/Users/demo/repo/.specify目录结构说明.md",
        fileName: ".specify目录结构说明.md",
        status: "D",
        additions: 0,
        deletions: 0,
      },
      {
        filePath: "/Users/demo/repo/abc.txt",
        fileName: "abc.txt",
        status: "A",
        additions: 0,
        deletions: 0,
      },
    ]);
  });

  it("matches absolute/relative path hints when inferring single-change fallback stats", () => {
    const fileItem = toolItem("file-2-pathhint-compat", {
      toolType: "fileChange",
      title: "File changes",
      detail: JSON.stringify({
        input: {
          file_path: "/repo/src/App.tsx",
          old_string: "const oldValue = 1;",
          new_string: "const newValue = 1;",
        },
      }),
      status: "completed",
      changes: [{ path: "src/App.tsx", kind: "modified" }],
    });

    expect(extractFileChangeSummaries([fileItem])).toEqual([
      {
        filePath: "src/App.tsx",
        fileName: "App.tsx",
        status: "M",
        additions: 1,
        deletions: 1,
      },
    ]);

    expect(summarizeFileChangeItem(fileItem)).toEqual({
      summary: "File change · App.tsx",
      filePath: "src/App.tsx",
      fileCount: 1,
      additions: 1,
      deletions: 1,
      statusLetter: "M",
    });
  });

  it("infers replace-like mcp tools as file changes for activity summary", () => {
    const fileItem = toolItem("file-3", {
      toolType: "mcpToolCall",
      title: "Tool: Claude / replace-1774440197988-0 README.md",
      detail: JSON.stringify({
        instruction: "update README quickstart",
        old_string: "curl http://localhost:8080/api/customers",
        new_string: "curl http://localhost:8080/api/products",
      }),
      status: "started",
    });

    expect(summarizeFileChangeItem(fileItem)).toEqual({
      summary: "File change · README.md",
      filePath: "README.md",
      fileCount: 1,
      additions: 1,
      deletions: 1,
      statusLetter: "M",
    });
  });

  it("handles empty-string replace boundaries without fake deletions", () => {
    const fileItem = toolItem("file-4", {
      toolType: "mcpToolCall",
      title: "Tool: Gemini / replace-1774440197988-0 README.md",
      detail: JSON.stringify({
        old_string: "",
        new_string: "one line",
      }),
      status: "started",
    });

    expect(summarizeFileChangeItem(fileItem)).toEqual({
      summary: "File change · README.md",
      filePath: "README.md",
      fileCount: 1,
      additions: 1,
      deletions: 0,
      statusLetter: "M",
    });
  });

  it("does not misclassify generic replace tools without file hints", () => {
    const nonFileTool = toolItem("tool-replace-generic", {
      toolType: "mcpToolCall",
      title: "Tool: replace variables in prompt",
      detail: JSON.stringify({
        variables: ["A", "B"],
      }),
      status: "started",
    });

    expect(summarizeFileChangeItem(nonFileTool)).toBeNull();
  });
});
