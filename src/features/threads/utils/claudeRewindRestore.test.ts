import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationItem } from "../../../types";
import {
  createWorkspaceDirectory,
  getGitStatus,
  readWorkspaceFile,
  revertGitFile,
  trashWorkspaceItem,
  writeWorkspaceFile,
} from "../../../services/tauri";
import {
  applyClaudeRewindWorkspaceRestore,
  collectClaudeRewindRestorePlan,
  restoreClaudeRewindWorkspaceSnapshots,
  reverseApplyUnifiedDiff,
} from "./claudeRewindRestore";

vi.mock("../../../services/tauri", () => ({
  readWorkspaceFile: vi.fn(),
  writeWorkspaceFile: vi.fn(),
  createWorkspaceDirectory: vi.fn(),
  trashWorkspaceItem: vi.fn(),
  getGitStatus: vi.fn(),
  revertGitFile: vi.fn(),
}));

function fileToolItem(
  id: string,
  overrides: Partial<Extract<ConversationItem, { kind: "tool" }>>,
): Extract<ConversationItem, { kind: "tool" }> {
  return {
    id,
    kind: "tool",
    toolType: "fileChange",
    title: "File changes",
    detail: "{}",
    status: "completed",
    changes: [],
    ...overrides,
  };
}

describe("claudeRewindRestore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createWorkspaceDirectory).mockResolvedValue(undefined);
    vi.mocked(writeWorkspaceFile).mockResolvedValue(undefined);
    vi.mocked(trashWorkspaceItem).mockResolvedValue(undefined);
    vi.mocked(getGitStatus).mockRejectedValue(new Error("git status unavailable"));
    vi.mocked(revertGitFile).mockResolvedValue(undefined);
  });

  it("collects rename restore plan entries with Windows workspace paths", () => {
    const impactedItems: ConversationItem[] = [
      fileToolItem("tool-rename", {
        changes: [
          {
            path: "C:\\Repo\\src\\new-name.ts",
            kind: "rename",
            diff: [
              "*** Begin Patch",
              "*** Update File: src/old-name.ts",
              "*** Move to: src/new-name.ts",
              "@@ -1 +1 @@",
              "-const oldName = true;",
              "+const newName = true;",
              "*** End Patch",
            ].join("\n"),
          },
        ],
      }),
    ];

    expect(
      collectClaudeRewindRestorePlan("C:/Repo", impactedItems),
    ).toEqual([
      {
        path: "src/new-name.ts",
        kind: "rename",
        previousPath: "src/old-name.ts",
        diff: [
          "*** Begin Patch",
          "*** Update File: src/old-name.ts",
          "*** Move to: src/new-name.ts",
          "@@ -1 +1 @@",
          "-const oldName = true;",
          "+const newName = true;",
          "*** End Patch",
        ].join("\n"),
        sourceItemId: "tool-rename",
      },
    ]);
  });

  it("reverse-applies unified diffs back to the previous content", () => {
    const reverted = reverseApplyUnifiedDiff(
      "line-1\nline-new\nline-3",
      "@@ -1,3 +1,3 @@\n line-1\n-line-old\n+line-new\n line-3",
    );

    expect(reverted).toBe("line-1\nline-old\nline-3");
  });

  it("throws when unified diff has edits but no parseable hunk header", () => {
    expect(() =>
      reverseApplyUnifiedDiff(
        "line-new\n",
        "@@\n-line-old\n+line-new",
      ),
    ).toThrow("Claude rewind patch has no parseable hunk.");
  });

  it("removes files that were added after the rewind target", async () => {
    vi.mocked(readWorkspaceFile).mockResolvedValue({
      content: "export const created = true;\n",
      truncated: false,
    });

    const impactedItems: ConversationItem[] = [
      fileToolItem("tool-add", {
        changes: [
          {
            path: "src/new.ts",
            kind: "added",
            diff: "@@ -0,0 +1,1 @@\n+export const created = true;",
          },
        ],
      }),
    ];

    const result = await applyClaudeRewindWorkspaceRestore({
      workspaceId: "ws-1",
      workspacePath: "/repo",
      impactedItems,
    });

    expect(result?.touchedPaths).toEqual(["src/new.ts"]);
    expect(trashWorkspaceItem).toHaveBeenCalledWith("ws-1", "src/new.ts");
    expect(writeWorkspaceFile).not.toHaveBeenCalled();
  });

  it("removes added files even when the tool entry does not include inline diff", async () => {
    vi.mocked(readWorkspaceFile).mockResolvedValue({
      content: "export const created = true;\n",
      truncated: false,
    });

    const impactedItems: ConversationItem[] = [
      fileToolItem("tool-add-no-diff", {
        changes: [
          {
            path: "src/LoginAttempt.java",
            kind: "added",
          },
        ],
      }),
    ];

    await applyClaudeRewindWorkspaceRestore({
      workspaceId: "ws-1",
      workspacePath: "/repo",
      impactedItems,
    });

    expect(trashWorkspaceItem).toHaveBeenCalledWith(
      "ws-1",
      "src/LoginAttempt.java",
    );
  });

  it("recreates files that were deleted after the rewind target", async () => {
    vi.mocked(readWorkspaceFile).mockRejectedValue(
      new Error("Failed to open file: No such file or directory"),
    );

    const impactedItems: ConversationItem[] = [
      fileToolItem("tool-delete", {
        changes: [
          {
            path: "src/removed.ts",
            kind: "deleted",
            diff: "@@ -1,2 +0,0 @@\n-const before = 1;\n-export default before;",
          },
        ],
      }),
    ];

    await applyClaudeRewindWorkspaceRestore({
      workspaceId: "ws-1",
      workspacePath: "/repo",
      impactedItems,
    });

    expect(writeWorkspaceFile).toHaveBeenCalledWith(
      "ws-1",
      "src/removed.ts",
      "const before = 1;\nexport default before;",
    );
  });

  it("falls back to git revert for deleted files without inline diff", async () => {
    vi.mocked(readWorkspaceFile).mockRejectedValue(
      new Error("Failed to open file: No such file or directory"),
    );

    const impactedItems: ConversationItem[] = [
      fileToolItem("tool-delete-no-diff", {
        changes: [
          {
            path: "src/deleted-no-diff.ts",
            kind: "deleted",
          },
        ],
      }),
    ];

    await applyClaudeRewindWorkspaceRestore({
      workspaceId: "ws-1",
      workspacePath: "/repo",
      impactedItems,
    });

    expect(revertGitFile).toHaveBeenCalledWith(
      "ws-1",
      "src/deleted-no-diff.ts",
    );
    expect(writeWorkspaceFile).not.toHaveBeenCalled();
  });

  it("falls back to git revert for deleted files with header-only diff", async () => {
    vi.mocked(readWorkspaceFile).mockRejectedValue(
      new Error("Failed to open file: No such file or directory"),
    );

    const impactedItems: ConversationItem[] = [
      fileToolItem("tool-delete-header-only-diff", {
        changes: [
          {
            path: "README.md",
            kind: "deleted",
            diff: "@@ -1,178 +0,0 @@",
          },
        ],
      }),
    ];

    const result = await applyClaudeRewindWorkspaceRestore({
      workspaceId: "ws-1",
      workspacePath: "/repo",
      impactedItems,
    });

    expect(result?.skippedPaths).toEqual([]);
    expect(revertGitFile).toHaveBeenCalledWith("ws-1", "README.md");
    expect(writeWorkspaceFile).not.toHaveBeenCalled();
    expect(trashWorkspaceItem).not.toHaveBeenCalled();
  });

  it("treats apply_patch delete headers as delete and falls back to git revert", async () => {
    vi.mocked(readWorkspaceFile).mockRejectedValue(
      new Error("Failed to open file: No such file or directory"),
    );

    const impactedItems: ConversationItem[] = [
      fileToolItem("tool-delete-apply-patch-header", {
        changes: [
          {
            path: "SPEC_KIT_实战指南.md",
            kind: "modified",
            diff: [
              "*** Begin Patch",
              "*** Delete File: SPEC_KIT_实战指南.md",
              "*** End Patch",
            ].join("\n"),
          },
        ],
      }),
    ];

    const result = await applyClaudeRewindWorkspaceRestore({
      workspaceId: "ws-1",
      workspacePath: "/repo",
      impactedItems,
    });

    expect(result?.skippedPaths).toEqual([]);
    expect(revertGitFile).toHaveBeenCalledWith("ws-1", "SPEC_KIT_实战指南.md");
    expect(writeWorkspaceFile).not.toHaveBeenCalled();
    expect(trashWorkspaceItem).not.toHaveBeenCalled();
  });

  it("falls back to git revert for skipped git commandExecution file restores", async () => {
    vi.mocked(readWorkspaceFile).mockResolvedValue({
      content: "const now = 'after';\n",
      truncated: false,
    });

    const impactedItems: ConversationItem[] = [
      fileToolItem("tool-git-status", {
        toolType: "commandExecution",
        title: "Command: git status --short",
        detail: "{\"command\":\"git status --short\"}",
        output: " M src/git-command-only.ts",
        changes: [],
      }),
    ];

    const result = await applyClaudeRewindWorkspaceRestore({
      workspaceId: "ws-1",
      workspacePath: "/repo",
      impactedItems,
    });

    expect(result?.touchedPaths).toEqual(["src/git-command-only.ts"]);
    expect(result?.skippedPaths).toEqual([]);
    expect(revertGitFile).toHaveBeenCalledWith("ws-1", "src/git-command-only.ts");
    expect(writeWorkspaceFile).not.toHaveBeenCalled();
    expect(trashWorkspaceItem).not.toHaveBeenCalled();
  });

  it("falls back to git revert for deleted files inferred from commandExecution detail command", async () => {
    vi.mocked(readWorkspaceFile).mockRejectedValue(
      new Error("Failed to open file: No such file or directory"),
    );

    const impactedItems: ConversationItem[] = [
      fileToolItem("tool-command-detail-delete", {
        toolType: "commandExecution",
        title: "Command: 删除文件",
        detail: JSON.stringify({
          command: 'rm "/repo/SPEC_KIT_实战指南.md"',
          description: "删除 SPEC_KIT_实战指南.md",
        }),
        output: "",
        changes: [],
      }),
    ];

    const result = await applyClaudeRewindWorkspaceRestore({
      workspaceId: "ws-1",
      workspacePath: "/repo",
      impactedItems,
    });

    expect(result?.touchedPaths).toEqual(["SPEC_KIT_实战指南.md"]);
    expect(result?.skippedPaths).toEqual([]);
    expect(revertGitFile).toHaveBeenCalledWith("ws-1", "SPEC_KIT_实战指南.md");
    expect(writeWorkspaceFile).not.toHaveBeenCalled();
    expect(trashWorkspaceItem).not.toHaveBeenCalled();
  });

  it("falls back to git revert for deleted files inferred from Bash detail command", async () => {
    vi.mocked(readWorkspaceFile).mockRejectedValue(
      new Error("Failed to open file: No such file or directory"),
    );

    const impactedItems: ConversationItem[] = [
      fileToolItem("tool-bash-detail-delete", {
        toolType: "Bash",
        title: "Bash",
        detail: JSON.stringify({
          command: "rm /repo/.specify目录结构说明.md",
          description: "删除文件",
        }),
        output: "",
        changes: [],
      }),
    ];

    const result = await applyClaudeRewindWorkspaceRestore({
      workspaceId: "ws-1",
      workspacePath: "/repo",
      impactedItems,
    });

    expect(result?.touchedPaths).toEqual([".specify目录结构说明.md"]);
    expect(result?.skippedPaths).toEqual([]);
    expect(revertGitFile).toHaveBeenCalledWith(
      "ws-1",
      ".specify目录结构说明.md",
    );
    expect(writeWorkspaceFile).not.toHaveBeenCalled();
    expect(trashWorkspaceItem).not.toHaveBeenCalled();
  });

  it("removes files inferred as added from Bash redirection command", async () => {
    vi.mocked(readWorkspaceFile).mockResolvedValue({
      content: "100",
      truncated: false,
    });

    const impactedItems: ConversationItem[] = [
      fileToolItem("tool-bash-detail-add", {
        toolType: "Bash",
        title: "Bash",
        detail: JSON.stringify({
          command: "printf '100' > /repo/abc.txt",
          description: "创建 abc.txt",
        }),
        output: "",
        changes: [],
      }),
    ];

    const result = await applyClaudeRewindWorkspaceRestore({
      workspaceId: "ws-1",
      workspacePath: "/repo",
      impactedItems,
    });

    expect(result?.touchedPaths).toEqual(["abc.txt"]);
    expect(result?.skippedPaths).toEqual([]);
    expect(trashWorkspaceItem).toHaveBeenCalledWith("ws-1", "abc.txt");
    expect(writeWorkspaceFile).not.toHaveBeenCalled();
  });

  it("falls back to git revert for @path delete intent when tool payload misses file path", async () => {
    vi.mocked(readWorkspaceFile).mockRejectedValue(
      new Error("Failed to open file: No such file or directory"),
    );

    const impactedItems: ConversationItem[] = [
      {
        id: "user-delete-mention",
        kind: "message",
        role: "user",
        text: "@/repo/SPEC_KIT_实战指南.md 删除这个文件",
      },
      fileToolItem("tool-delete-path-missing", {
        toolType: "mcpToolCall",
        title: "Tool: Claude / Delete",
        detail: "{}",
        output: "File removed successfully",
        changes: [],
      }),
    ];

    const result = await applyClaudeRewindWorkspaceRestore({
      workspaceId: "ws-1",
      workspacePath: "/repo",
      impactedItems,
    });

    expect(result?.skippedPaths).toEqual([]);
    expect(revertGitFile).toHaveBeenCalledWith(
      "ws-1",
      "SPEC_KIT_实战指南.md",
    );
    expect(writeWorkspaceFile).not.toHaveBeenCalled();
    expect(trashWorkspaceItem).not.toHaveBeenCalled();
  });

  it("prefers structured old/new replacement when diff context no longer matches", async () => {
    vi.mocked(readWorkspaceFile).mockResolvedValue({
      content: [
        "package demo;",
        "",
        "prefix from another thread",
        "const value = 'after';",
        "suffix from another thread",
        "",
      ].join("\n"),
      truncated: false,
    });

    const impactedItems: ConversationItem[] = [
      fileToolItem("tool-structured-replace", {
        detail: JSON.stringify({
          input: {
            file_path: "src/App.tsx",
            old_string: "const value = 'before';",
            new_string: "const value = 'after';",
          },
        }),
        changes: [
          {
            path: "src/App.tsx",
            kind: "modified",
            diff: "@@ -10,1 +10,1 @@\n-context that no longer exists\n-const value = 'before';\n+const value = 'after';",
          },
        ],
      }),
    ];

    await applyClaudeRewindWorkspaceRestore({
      workspaceId: "ws-1",
      workspacePath: "/repo",
      impactedItems,
    });

    expect(writeWorkspaceFile).toHaveBeenCalledWith(
      "ws-1",
      "src/App.tsx",
      [
        "package demo;",
        "",
        "prefix from another thread",
        "const value = 'before';",
        "suffix from another thread",
        "",
      ].join("\n"),
    );
  });

  it("falls back to git revert when file entries are unrecoverable from rewind diff", async () => {
    vi.mocked(readWorkspaceFile).mockResolvedValue({
      content: "public class ApiResponse {}\n",
      truncated: false,
    });

    const impactedItems: ConversationItem[] = [
      fileToolItem("tool-missing-diff", {
        changes: [
          {
            path: "src/main/java/com/example/demo/dto/response/ApiResponse.java",
            kind: "modified",
          },
        ],
      }),
    ];

    const result = await applyClaudeRewindWorkspaceRestore({
      workspaceId: "ws-1",
      workspacePath: "/repo",
      impactedItems,
    });

    expect(result?.skippedPaths).toEqual([]);
    expect(revertGitFile).toHaveBeenCalledWith(
      "ws-1",
      "src/main/java/com/example/demo/dto/response/ApiResponse.java",
    );
    expect(writeWorkspaceFile).not.toHaveBeenCalled();
    expect(trashWorkspaceItem).not.toHaveBeenCalled();
  });

  it("falls back to git revert when apply_patch modified diff omits line-number hunks", async () => {
    vi.mocked(readWorkspaceFile).mockResolvedValue({
      content: "line-new\n",
      truncated: false,
    });

    const impactedItems: ConversationItem[] = [
      fileToolItem("tool-apply-patch-modified-no-hunk", {
        changes: [
          {
            path: "src/main/java/com/example/demo/security/SecurityConfig.java",
            kind: "modified",
            diff: [
              "*** Begin Patch",
              "*** Update File: src/main/java/com/example/demo/security/SecurityConfig.java",
              "@@",
              "-line-old",
              "+line-new",
              "*** End Patch",
            ].join("\n"),
          },
        ],
      }),
    ];

    const result = await applyClaudeRewindWorkspaceRestore({
      workspaceId: "ws-1",
      workspacePath: "/repo",
      impactedItems,
    });

    expect(result?.skippedPaths).toEqual([]);
    expect(revertGitFile).toHaveBeenCalledWith(
      "ws-1",
      "src/main/java/com/example/demo/security/SecurityConfig.java",
    );
    expect(writeWorkspaceFile).not.toHaveBeenCalled();
  });

  it("keeps skipped path when git revert fallback fails", async () => {
    vi.mocked(readWorkspaceFile).mockResolvedValue({
      content: "public class ApiResponse {}\n",
      truncated: false,
    });
    vi.mocked(revertGitFile).mockRejectedValueOnce(new Error("git revert failed"));

    const impactedItems: ConversationItem[] = [
      fileToolItem("tool-missing-diff-with-fallback-error", {
        changes: [
          {
            path: "src/main/java/com/example/demo/dto/response/ApiResponse.java",
            kind: "modified",
          },
        ],
      }),
    ];

    const result = await applyClaudeRewindWorkspaceRestore({
      workspaceId: "ws-1",
      workspacePath: "/repo",
      impactedItems,
    });

    expect(result?.skippedPaths).toEqual([
      "src/main/java/com/example/demo/dto/response/ApiResponse.java",
    ]);
    expect(revertGitFile).toHaveBeenCalledWith(
      "ws-1",
      "src/main/java/com/example/demo/dto/response/ApiResponse.java",
    );
    expect(writeWorkspaceFile).not.toHaveBeenCalled();
  });

  it("uses structured old/new fields to restore modified files even when diff is missing", async () => {
    vi.mocked(readWorkspaceFile).mockResolvedValue({
      content: "const value = 'after';\n",
      truncated: false,
    });

    const impactedItems: ConversationItem[] = [
      fileToolItem("tool-structured-missing-diff", {
        detail: JSON.stringify({
          input: {
            file_path: "src/no-diff-structured.ts",
            old_string: "const value = 'before';\n",
            new_string: "const value = 'after';\n",
          },
        }),
        changes: [
          {
            path: "src/no-diff-structured.ts",
            kind: "modified",
          },
        ],
      }),
    ];

    await applyClaudeRewindWorkspaceRestore({
      workspaceId: "ws-1",
      workspacePath: "/repo",
      impactedItems,
    });

    expect(writeWorkspaceFile).toHaveBeenCalledWith(
      "ws-1",
      "src/no-diff-structured.ts",
      "const value = 'before';\n",
    );
  });

  it("ignores committed clean files during rewind restore", async () => {
    vi.mocked(getGitStatus).mockResolvedValue({
      branchName: "main",
      files: [],
      stagedFiles: [],
      unstagedFiles: [],
      totalAdditions: 0,
      totalDeletions: 0,
    });

    const impactedItems: ConversationItem[] = [
      fileToolItem("tool-committed-clean", {
        changes: [
          {
            path: "src/already-committed.ts",
            kind: "modified",
            diff: "@@ -1,1 +1,1 @@\n-const value = 'before';\n+const value = 'after';",
          },
        ],
      }),
    ];

    const result = await applyClaudeRewindWorkspaceRestore({
      workspaceId: "ws-1",
      workspacePath: "/repo",
      impactedItems,
    });

    expect(result?.ignoredCommittedPaths).toEqual(["src/already-committed.ts"]);
    expect(result?.touchedPaths).toEqual([]);
    expect(readWorkspaceFile).not.toHaveBeenCalled();
    expect(writeWorkspaceFile).not.toHaveBeenCalled();
    expect(trashWorkspaceItem).not.toHaveBeenCalled();
  });

  it("treats git dirty path with repo prefix as matching workspace-relative rewind path", async () => {
    vi.mocked(readWorkspaceFile).mockResolvedValue({
      content: "export const created = true;\n",
      truncated: false,
    });
    vi.mocked(getGitStatus).mockResolvedValue({
      branchName: "main",
      files: [{ path: "springboot-demo/src/new.ts", status: "??", additions: 1, deletions: 0 }],
      stagedFiles: [],
      unstagedFiles: [],
      totalAdditions: 1,
      totalDeletions: 0,
    });

    const impactedItems: ConversationItem[] = [
      fileToolItem("tool-prefixed-dirty-path", {
        changes: [
          {
            path: "src/new.ts",
            kind: "added",
            diff: "@@ -0,0 +1,1 @@\n+export const created = true;",
          },
        ],
      }),
    ];

    const result = await applyClaudeRewindWorkspaceRestore({
      workspaceId: "ws-1",
      workspacePath: "/Users/chenxiangning/code/AI/springboot-demo",
      impactedItems,
    });

    expect(result?.ignoredCommittedPaths).toEqual([]);
    expect(trashWorkspaceItem).toHaveBeenCalledWith("ws-1", "src/new.ts");
  });

  it("matches git dirty paths case-insensitively for Windows/macOS default file systems", async () => {
    vi.mocked(readWorkspaceFile).mockResolvedValue({
      content: "export const created = true;\n",
      truncated: false,
    });
    vi.mocked(getGitStatus).mockResolvedValue({
      branchName: "main",
      files: [{ path: "SRC/New.ts", status: "??", additions: 1, deletions: 0 }],
      stagedFiles: [],
      unstagedFiles: [],
      totalAdditions: 1,
      totalDeletions: 0,
    });

    const impactedItems: ConversationItem[] = [
      fileToolItem("tool-case-insensitive-dirty-path", {
        changes: [
          {
            path: "src/new.ts",
            kind: "added",
            diff: "@@ -0,0 +1,1 @@\n+export const created = true;",
          },
        ],
      }),
    ];

    const result = await applyClaudeRewindWorkspaceRestore({
      workspaceId: "ws-1",
      workspacePath: "/repo",
      impactedItems,
    });

    expect(result?.ignoredCommittedPaths).toEqual([]);
    expect(trashWorkspaceItem).toHaveBeenCalledWith("ws-1", "src/new.ts");
  });

  it("treats modified entries with empty old text as add changes and deletes the file on rewind", async () => {
    vi.mocked(readWorkspaceFile).mockResolvedValue({
      content: "export const created = true;\n",
      truncated: false,
    });

    const impactedItems: ConversationItem[] = [
      fileToolItem("tool-structured-add-like", {
        detail: JSON.stringify({
          input: {
            file_path: "src/structured-add-like.ts",
            old_string: "",
            new_string: "export const created = true;\n",
          },
        }),
        changes: [
          {
            path: "src/structured-add-like.ts",
            kind: "modified",
          },
        ],
      }),
    ];

    await applyClaudeRewindWorkspaceRestore({
      workspaceId: "ws-1",
      workspacePath: "/repo",
      impactedItems,
    });

    expect(trashWorkspaceItem).toHaveBeenCalledWith(
      "ws-1",
      "src/structured-add-like.ts",
    );
    expect(writeWorkspaceFile).not.toHaveBeenCalledWith(
      "ws-1",
      "src/structured-add-like.ts",
      "",
    );
  });

  it("restores original snapshots when rewind rollback is needed", async () => {
    await restoreClaudeRewindWorkspaceSnapshots("ws-1", [
      {
        path: "src/App.tsx",
        exists: true,
        content: "const value = 1;\n",
        newline: "\n",
      },
      {
        path: "src/new.ts",
        exists: false,
        content: "",
        newline: "\n",
      },
    ]);

    expect(writeWorkspaceFile).toHaveBeenCalledWith(
      "ws-1",
      "src/App.tsx",
      "const value = 1;\n",
    );
    expect(trashWorkspaceItem).toHaveBeenCalledWith("ws-1", "src/new.ts");
  });
});
