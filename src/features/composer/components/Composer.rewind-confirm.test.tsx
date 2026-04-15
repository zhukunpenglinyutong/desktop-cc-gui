/** @vitest-environment jsdom */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pushErrorToast } from "../../../services/toasts";
import type { ConversationItem } from "../../../types";
import { Composer } from "./Composer";

vi.mock("../../../services/dragDrop", () => ({
  subscribeWindowDragDrop: vi.fn(() => () => {}),
}));

vi.mock("../../../services/toasts", () => ({
  pushErrorToast: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `tauri://${path}`,
  invoke: vi.fn(async () => null),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: vi.fn(async () => undefined),
}));

vi.mock("../../engine/components/EngineSelector", () => ({
  EngineSelector: () => null,
}));

vi.mock("../../opencode/components/OpenCodeControlPanel", () => ({
  OpenCodeControlPanel: () => null,
}));

vi.mock("../../status-panel/hooks/useStatusPanelData", () => ({
  useStatusPanelData: () => ({
    todoTotal: 0,
    subagentTotal: 0,
    fileChanges: [],
    commandTotal: 0,
  }),
}));

vi.mock("../../threads/hooks/useStreamActivityPhase", () => ({
  useStreamActivityPhase: () => "idle",
}));

vi.mock("./ChatInputBox/ChatInputBoxAdapter", () => ({
  ChatInputBoxAdapter: ({
    onRewind,
    showRewindEntry,
  }: {
    onRewind?: () => void;
    showRewindEntry?: boolean;
  }) =>
    showRewindEntry ? (
      <button
        type="button"
        data-testid="rewind-trigger"
        onClick={() => onRewind?.()}
      >
        rewind
      </button>
    ) : null,
}));

const REWIND_ITEMS: ConversationItem[] = [
  {
    id: "user-1",
    kind: "message",
    role: "user",
    text: "请把主按钮文案改成提交并发布，同时保留原来的颜色方案。",
  },
  {
    id: "assistant-1",
    kind: "message",
    role: "assistant",
    text: "收到，我会先修改按钮文案。",
  },
  {
    id: "tool-1",
    kind: "tool",
    toolType: "fileChange",
    title: "Edit file",
    detail: JSON.stringify({
      input: {
        file_path: "src/components/Button.tsx",
      },
    }),
    changes: [
      {
        path: "src/components/Button.tsx",
        kind: "modified",
        diff: "@@ -1,1 +1,1 @@\n-old\n+new",
      },
    ],
  },
  {
    id: "tool-2",
    kind: "tool",
    toolType: "fileChange",
    title: "Edit file",
    detail: JSON.stringify({
      input: {
        file_path: "src/components/Card.tsx",
      },
    }),
    changes: [
      {
        path: "src/components/Card.tsx",
        kind: "modified",
        diff: "@@ -2,1 +2,1 @@\n-before\n+after",
      },
    ],
  },
];

const REWIND_ITEMS_WITH_USER_MENTION_FALLBACK: ConversationItem[] = [
  {
    id: "user-mention-1",
    kind: "message",
    role: "user",
    text: "@/Users/demo/repo/SPEC_KIT_实战指南.md 删除这个文件",
  },
  {
    id: "assistant-mention-1",
    kind: "message",
    role: "assistant",
    text: "正在处理",
  },
  {
    id: "tool-mention-1",
    kind: "tool",
    toolType: "mcpToolCall",
    title: "Tool: Claude / Delete",
    detail: "{}",
    status: "completed",
    output: "File removed successfully",
  },
];

const REWIND_ITEMS_WITH_BASH_COMMAND_CHANGES: ConversationItem[] = [
  {
    id: "user-bash-1",
    kind: "message",
    role: "user",
    text: "@/Users/demo/repo/.specify目录结构说明.md 删除这个文件，@/Users/demo/repo/pom.xml 加两行注释，新增 abc.txt 内容 100",
  },
  {
    id: "assistant-bash-1",
    kind: "message",
    role: "assistant",
    text: "正在执行",
  },
  {
    id: "tool-bash-delete",
    kind: "tool",
    toolType: "Bash",
    title: "Bash",
    detail: JSON.stringify({
      command: "rm /Users/demo/repo/.specify目录结构说明.md",
      description: "删除文件",
    }),
    status: "completed",
    output: "(Bash completed with no output)",
    changes: [],
  },
  {
    id: "tool-bash-add",
    kind: "tool",
    toolType: "Bash",
    title: "Bash",
    detail: JSON.stringify({
      command: "printf '100' > /Users/demo/repo/abc.txt",
      description: "创建 abc.txt",
    }),
    status: "completed",
    output: "(Bash completed with no output)",
    changes: [],
  },
  {
    id: "tool-bash-edit",
    kind: "tool",
    toolType: "fileChange",
    title: "Edit file",
    detail: JSON.stringify({
      input: {
        file_path: "/Users/demo/repo/pom.xml",
      },
    }),
    status: "completed",
    changes: [
      {
        path: "/Users/demo/repo/pom.xml",
        kind: "modified",
        diff: "@@ -1,1 +1,2 @@\n </properties>\n+<!-- 统一认证与规范驱动开发演示项目依赖 -->",
      },
    ],
  },
];

const REWIND_ITEMS_WITH_WINDOWS_PATH_VARIANTS: ConversationItem[] = [
  {
    id: "user-win-path-1",
    kind: "message",
    role: "user",
    text: "删除并调整同一 Windows 文件路径",
  },
  {
    id: "assistant-win-path-1",
    kind: "message",
    role: "assistant",
    text: "处理中",
  },
  {
    id: "tool-win-path-modified",
    kind: "tool",
    toolType: "fileChange",
    title: "Edit file",
    detail: JSON.stringify({
      input: {
        file_path: "C:\\repo\\demo\\readme.md",
      },
    }),
    status: "completed",
    changes: [
      {
        path: "C:\\repo\\demo\\readme.md",
        kind: "modified",
        diff: "@@ -1,1 +1,1 @@\n-old\n+new",
      },
    ],
  },
  {
    id: "tool-win-path-delete",
    kind: "tool",
    toolType: "fileChange",
    title: "Delete file",
    detail: JSON.stringify({
      input: {
        file_path: "C:/repo/demo/readme.md",
      },
    }),
    status: "completed",
    changes: [
      {
        path: "C:/repo/demo/readme.md",
        kind: "delete",
      },
    ],
  },
];

type ComposerHarnessProps = {
  items?: ConversationItem[];
  onRewind?: (userMessageId: string) => void | Promise<void>;
  onOpenDiffPath?: (path: string) => void;
  activeThreadId?: string | null;
  selectedEngine?: "claude" | "codex" | "gemini";
};

function ComposerHarness({
  items = REWIND_ITEMS,
  onRewind = async () => {},
  onOpenDiffPath,
  activeThreadId = "claude:session-1",
  selectedEngine = "claude",
}: ComposerHarnessProps) {
  const [draftText, setDraftText] = useState("");

  return (
    <Composer
      items={items}
      onSend={() => {}}
      onQueue={() => {}}
      onStop={() => {}}
      canStop={false}
      isProcessing={false}
      steerEnabled={false}
      collaborationModes={[]}
      collaborationModesEnabled={true}
      selectedCollaborationModeId={null}
      onSelectCollaborationMode={() => {}}
      selectedEngine={selectedEngine}
      models={[]}
      selectedModelId={null}
      onSelectModel={() => {}}
      reasoningOptions={[]}
      selectedEffort={null}
      onSelectEffort={() => {}}
      reasoningSupported={false}
      accessMode="current"
      onSelectAccessMode={() => {}}
      skills={[]}
      prompts={[]}
      commands={[]}
      files={[]}
      draftText={draftText}
      onDraftChange={setDraftText}
      dictationEnabled={false}
      activeWorkspaceId="ws-1"
      activeThreadId={activeThreadId}
      onOpenDiffPath={onOpenDiffPath}
      onRewind={onRewind}
    />
  );
}

describe("Composer Claude rewind confirmation", () => {
  afterEach(() => {
    cleanup();
  });

  it("opens the confirmation dialog without immediately rewinding", () => {
    const onRewind = vi.fn(async () => {});

    render(<ComposerHarness onRewind={onRewind} />);

    fireEvent.click(screen.getByTestId("rewind-trigger"));

    expect(screen.getByTestId("claude-rewind-dialog")).not.toBeNull();
    expect(screen.getByTestId("claude-rewind-file-Button.tsx")).not.toBeNull();
    expect(onRewind).not.toHaveBeenCalled();
  });

  it("closes the dialog on cancel without rewinding", () => {
    const onRewind = vi.fn(async () => {});

    render(<ComposerHarness onRewind={onRewind} />);

    fireEvent.click(screen.getByTestId("rewind-trigger"));
    fireEvent.click(screen.getByTestId("claude-rewind-cancel-button"));

    expect(screen.queryByTestId("claude-rewind-dialog")).toBeNull();
    expect(onRewind).not.toHaveBeenCalled();
  });

  it("rewinds only after explicit confirm", async () => {
    const onRewind = vi.fn(async () => {});

    render(<ComposerHarness onRewind={onRewind} />);

    fireEvent.click(screen.getByTestId("rewind-trigger"));
    fireEvent.click(screen.getByTestId("claude-rewind-confirm-button"));

    await waitFor(() => {
      expect(onRewind).toHaveBeenCalledTimes(1);
    });
    expect(onRewind).toHaveBeenCalledWith("user-1");
  });

  it("switches selected file preview and opens standalone diff dialog", () => {
    render(<ComposerHarness />);

    fireEvent.click(screen.getByTestId("rewind-trigger"));
    fireEvent.click(screen.getByTestId("claude-rewind-file-Card.tsx"));

    expect(
      screen.getByTestId("claude-rewind-diff-preview").textContent,
    ).toContain("after");
    expect(screen.getByText("src/components/Card.tsx")).not.toBeNull();
    expect(screen.getAllByText("git.fileModified").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId("claude-rewind-open-diff-button"));

    expect(
      screen.getByTestId("claude-rewind-full-diff-dialog").textContent,
    ).toContain("src/components/Card.tsx");
    expect(
      screen.getByTestId("claude-rewind-full-diff-dialog").textContent,
    ).toContain("before");
    expect(
      screen.getByTestId("claude-rewind-full-diff-dialog").textContent,
    ).toContain("after");
  });

  it("falls back to @path mention when tool payload lacks file path", () => {
    render(<ComposerHarness items={REWIND_ITEMS_WITH_USER_MENTION_FALLBACK} />);

    fireEvent.click(screen.getByTestId("rewind-trigger"));

    expect(screen.getByTestId("claude-rewind-dialog")).not.toBeNull();
    expect(
      screen.getByTestId("claude-rewind-file-SPEC_KIT_实战指南.md"),
    ).not.toBeNull();
    expect(
      screen.getByTestId("claude-rewind-file-SPEC_KIT_实战指南.md").textContent,
    ).toContain("git.fileDeleted");
  });

  it("includes Bash command-created and command-deleted files in rewind preview", () => {
    render(<ComposerHarness items={REWIND_ITEMS_WITH_BASH_COMMAND_CHANGES} />);

    fireEvent.click(screen.getByTestId("rewind-trigger"));

    expect(screen.getByTestId("claude-rewind-dialog")).not.toBeNull();
    expect(
      screen.getByTestId("claude-rewind-file-.specify目录结构说明.md"),
    ).not.toBeNull();
    expect(screen.getByTestId("claude-rewind-file-abc.txt")).not.toBeNull();
    expect(screen.getByTestId("claude-rewind-file-pom.xml")).not.toBeNull();
  });

  it("exports rewind files into default chat diff directory", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      outputPath:
        "/Users/demo/.ccgui/chat-diff/claude/2026-04-13/session-1/user-1",
      filesPath:
        "/Users/demo/.ccgui/chat-diff/claude/2026-04-13/session-1/user-1/files",
      manifestPath:
        "/Users/demo/.ccgui/chat-diff/claude/2026-04-13/session-1/user-1/manifest.json",
      exportId: "user-1",
      fileCount: 2,
    });

    render(<ComposerHarness />);

    fireEvent.click(screen.getByTestId("rewind-trigger"));
    fireEvent.click(screen.getByTestId("claude-rewind-store-button"));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("export_rewind_files", {
        workspaceId: "ws-1",
        engine: "claude",
        sessionId: "session-1",
        targetMessageId: "user-1",
        conversationLabel:
          "请把主按钮文案改成提交并发布，同时保留原来的颜色方案。",
        files: [
          { path: "src/components/Button.tsx", status: "M" },
          { path: "src/components/Card.tsx", status: "M" },
        ],
      });
    });

    expect(
      screen
        .getByTestId("claude-rewind-store-feedback")
        .closest(".claude-rewind-modal-actions"),
    ).not.toBeNull();
    expect(
      screen.getByTestId("claude-rewind-store-feedback").textContent,
    ).toContain("2026-04-13/session-1/user-1");
  });

  it("reveals the stored changes directory from the inline success prompt", async () => {
    const invokeMock = vi.mocked(invoke);
    const revealMock = vi.mocked(revealItemInDir);
    invokeMock.mockResolvedValueOnce({
      outputPath:
        "/Users/demo/.ccgui/chat-diff/claude/2026-04-13/session-1/user-1",
      filesPath:
        "/Users/demo/.ccgui/chat-diff/claude/2026-04-13/session-1/user-1/files",
      manifestPath:
        "/Users/demo/.ccgui/chat-diff/claude/2026-04-13/session-1/user-1/manifest.json",
      exportId: "user-1",
      fileCount: 2,
    });

    render(<ComposerHarness />);

    fireEvent.click(screen.getByTestId("rewind-trigger"));
    fireEvent.click(screen.getByTestId("claude-rewind-store-button"));

    await waitFor(() => {
      expect(
        screen.getByTestId("claude-rewind-reveal-store-button"),
      ).not.toBeNull();
    });

    fireEvent.click(screen.getByTestId("claude-rewind-reveal-store-button"));

    await waitFor(() => {
      expect(revealMock).toHaveBeenCalledWith(
        "/Users/demo/.ccgui/chat-diff/claude/2026-04-13/session-1/user-1",
      );
    });
  });

  it("reuses the same export directory when storing the same rewind target twice", async () => {
    const invokeMock = vi.mocked(invoke);
    const initialCallCount = invokeMock.mock.calls.length;
    invokeMock
      .mockResolvedValueOnce({
        outputPath:
          "/Users/demo/.ccgui/chat-diff/claude/2026-04-13/session-1/user-1",
        filesPath:
          "/Users/demo/.ccgui/chat-diff/claude/2026-04-13/session-1/user-1/files",
        manifestPath:
          "/Users/demo/.ccgui/chat-diff/claude/2026-04-13/session-1/user-1/manifest.json",
        exportId: "user-1",
        fileCount: 2,
      })
      .mockResolvedValueOnce({
        outputPath:
          "/Users/demo/.ccgui/chat-diff/claude/2026-04-13/session-1/user-1",
        filesPath:
          "/Users/demo/.ccgui/chat-diff/claude/2026-04-13/session-1/user-1/files",
        manifestPath:
          "/Users/demo/.ccgui/chat-diff/claude/2026-04-13/session-1/user-1/manifest.json",
        exportId: "user-1",
        fileCount: 2,
      });

    render(<ComposerHarness />);

    fireEvent.click(screen.getByTestId("rewind-trigger"));
    fireEvent.click(screen.getByTestId("claude-rewind-store-button"));
    await waitFor(() => {
      expect(
        screen.getByTestId("claude-rewind-store-feedback").textContent,
      ).toContain("2026-04-13/session-1/user-1");
    });

    fireEvent.click(screen.getByTestId("claude-rewind-store-button"));

    await waitFor(() => {
      expect(invokeMock.mock.calls.length).toBe(initialCallCount + 2);
    });

    const firstCall = invokeMock.mock.calls[initialCallCount]?.[1] as
      | { targetMessageId: string }
      | undefined;
    const secondCall = invokeMock.mock.calls[initialCallCount + 1]?.[1] as
      | { targetMessageId: string }
      | undefined;
    expect(firstCall?.targetMessageId).toBe("user-1");
    expect(secondCall?.targetMessageId).toBe("user-1");
    expect(
      screen.getByTestId("claude-rewind-store-feedback").textContent,
    ).toContain("2026-04-13/session-1/user-1");
  });

  it("shows rewind entry for Codex threads without engine prefix", () => {
    render(
      <ComposerHarness
        selectedEngine="codex"
        activeThreadId="thread-codex-1"
      />,
    );

    expect(screen.queryByTestId("rewind-trigger")).not.toBeNull();
  });

  it("keeps codex rewind dialog open when onRewind callback identity changes", () => {
    const { rerender } = render(
      <ComposerHarness
        selectedEngine="codex"
        activeThreadId="thread-codex-1"
        onRewind={vi.fn(async () => {})}
      />,
    );

    fireEvent.click(screen.getByTestId("rewind-trigger"));
    expect(screen.queryByTestId("claude-rewind-dialog")).not.toBeNull();

    rerender(
      <ComposerHarness
        selectedEngine="codex"
        activeThreadId="thread-codex-1"
        onRewind={vi.fn(async () => {})}
      />,
    );

    expect(screen.queryByTestId("claude-rewind-dialog")).not.toBeNull();
  });

  it("stores rewind files under codex engine using unprefixed thread id as session id", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      outputPath:
        "/Users/demo/.ccgui/chat-diff/codex/2026-04-13/thread-codex-1/user-1",
      filesPath:
        "/Users/demo/.ccgui/chat-diff/codex/2026-04-13/thread-codex-1/user-1/files",
      manifestPath:
        "/Users/demo/.ccgui/chat-diff/codex/2026-04-13/thread-codex-1/user-1/manifest.json",
      exportId: "user-1",
      fileCount: 2,
    });

    render(
      <ComposerHarness
        selectedEngine="codex"
        activeThreadId="thread-codex-1"
      />,
    );

    fireEvent.click(screen.getByTestId("rewind-trigger"));
    fireEvent.click(screen.getByTestId("claude-rewind-store-button"));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("export_rewind_files", {
        workspaceId: "ws-1",
        engine: "codex",
        sessionId: "thread-codex-1",
        targetMessageId: "user-1",
        conversationLabel:
          "请把主按钮文案改成提交并发布，同时保留原来的颜色方案。",
        files: [
          { path: "src/components/Button.tsx", status: "M" },
          { path: "src/components/Card.tsx", status: "M" },
        ],
      });
    });
  });

  it("keeps codex rewind export engine when selected engine is gemini but thread id is unprefixed codex", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      outputPath:
        "/Users/demo/.ccgui/chat-diff/codex/2026-04-13/thread-codex-1/user-1",
      filesPath:
        "/Users/demo/.ccgui/chat-diff/codex/2026-04-13/thread-codex-1/user-1/files",
      manifestPath:
        "/Users/demo/.ccgui/chat-diff/codex/2026-04-13/thread-codex-1/user-1/manifest.json",
      exportId: "user-1",
      fileCount: 2,
    });

    render(
      <ComposerHarness
        selectedEngine="gemini"
        activeThreadId="thread-codex-1"
      />,
    );

    fireEvent.click(screen.getByTestId("rewind-trigger"));
    fireEvent.click(screen.getByTestId("claude-rewind-store-button"));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("export_rewind_files", {
        workspaceId: "ws-1",
        engine: "codex",
        sessionId: "thread-codex-1",
        targetMessageId: "user-1",
        conversationLabel:
          "请把主按钮文案改成提交并发布，同时保留原来的颜色方案。",
        files: [
          { path: "src/components/Button.tsx", status: "M" },
          { path: "src/components/Card.tsx", status: "M" },
        ],
      });
    });
  });

  it("exports rewind files with status metadata for delete/add/modify", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      outputPath:
        "/Users/demo/.ccgui/chat-diff/claude/2026-04-13/session-1/user-bash-1",
      filesPath:
        "/Users/demo/.ccgui/chat-diff/claude/2026-04-13/session-1/user-bash-1/files",
      manifestPath:
        "/Users/demo/.ccgui/chat-diff/claude/2026-04-13/session-1/user-bash-1/manifest.json",
      exportId: "user-bash-1",
      fileCount: 3,
    });

    render(<ComposerHarness items={REWIND_ITEMS_WITH_BASH_COMMAND_CHANGES} />);

    fireEvent.click(screen.getByTestId("rewind-trigger"));
    fireEvent.click(screen.getByTestId("claude-rewind-store-button"));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "export_rewind_files",
        expect.objectContaining({
          workspaceId: "ws-1",
          engine: "claude",
          sessionId: "session-1",
          targetMessageId: "user-bash-1",
          conversationLabel: expect.stringContaining(".specify目录结构说明.md"),
          files: [
            {
              path: "/Users/demo/repo/.specify目录结构说明.md",
              status: "D",
            },
            { path: "/Users/demo/repo/abc.txt", status: "A" },
            { path: "/Users/demo/repo/pom.xml", status: "M" },
          ],
        }),
      );
    });
  });

  it("normalizes windows path separators when storing rewind files", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      outputPath:
        "/Users/demo/.ccgui/chat-diff/claude/2026-04-13/session-1/user-win-path-1",
      filesPath:
        "/Users/demo/.ccgui/chat-diff/claude/2026-04-13/session-1/user-win-path-1/files",
      manifestPath:
        "/Users/demo/.ccgui/chat-diff/claude/2026-04-13/session-1/user-win-path-1/manifest.json",
      exportId: "user-win-path-1",
      fileCount: 1,
    });

    render(<ComposerHarness items={REWIND_ITEMS_WITH_WINDOWS_PATH_VARIANTS} />);

    fireEvent.click(screen.getByTestId("rewind-trigger"));
    fireEvent.click(screen.getByTestId("claude-rewind-store-button"));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "export_rewind_files",
        expect.objectContaining({
          targetMessageId: "user-win-path-1",
          files: [{ path: "C:/repo/demo/readme.md", status: "D" }],
        }),
      );
    });
  });

  it("hides rewind entry for unknown prefixed thread ids", () => {
    render(
      <ComposerHarness
        selectedEngine="codex"
        activeThreadId="custom:session-1"
      />,
    );

    expect(screen.queryByTestId("rewind-trigger")).toBeNull();
  });

  it("hides rewind entry for unsupported engine threads", () => {
    render(
      <ComposerHarness
        selectedEngine="gemini"
        activeThreadId="gemini:session-1"
      />,
    );

    expect(screen.queryByTestId("rewind-trigger")).toBeNull();
  });

  it("keeps rewind dialog hidden when there is no Claude session id", () => {
    const pushErrorToastMock = vi.mocked(pushErrorToast);

    render(<ComposerHarness activeThreadId={null} />);

    expect(screen.queryByTestId("rewind-trigger")).toBeNull();
    expect(pushErrorToastMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("claude-rewind-dialog")).toBeNull();
  });
});
