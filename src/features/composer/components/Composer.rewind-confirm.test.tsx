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

const REWIND_ITEMS_WITH_INLINE_TOKEN_FALLBACK: ConversationItem[] = [
  {
    id: "user-inline-token-1",
    kind: "message",
    role: "user",
    text:
      "📄 config.ts `/Users/demo/repo/config.ts` 删除这个文件，📄 app.ts `/Users/demo/repo/app.ts` 更新注释",
  },
  {
    id: "assistant-inline-token-1",
    kind: "message",
    role: "assistant",
    text: "正在处理",
  },
  {
    id: "tool-inline-token-1",
    kind: "tool",
    toolType: "mcpToolCall",
    title: "Tool: Codex / Noop",
    detail: "{}",
    status: "completed",
    output: "ok",
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

const REWIND_ITEMS_WITH_MISSING_DELETE_TOOL_CHANGE: ConversationItem[] = [
  {
    id: "user-codex-delete-fallback-1",
    kind: "message",
    role: "user",
    text: "@/Users/demo/repo/.specify目录结构说明.md 删除这个文件，@/Users/demo/repo/pom.xml 加两行注释，@/Users/demo/repo/abc.txt 内容改成 100",
  },
  {
    id: "assistant-codex-delete-fallback-1",
    kind: "message",
    role: "assistant",
    text: "处理中",
  },
  {
    id: "tool-codex-edit-pom",
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
        diff: "@@ -1,1 +1,2 @@\n </properties>\n+<!-- 注释 -->",
      },
    ],
  },
  {
    id: "tool-codex-create-abc",
    kind: "tool",
    toolType: "fileChange",
    title: "Create file",
    detail: JSON.stringify({
      input: {
        file_path: "/Users/demo/repo/abc.txt",
      },
    }),
    status: "completed",
    changes: [
      {
        path: "/Users/demo/repo/abc.txt",
        kind: "added",
        diff: "@@ -0,0 +1,1 @@\n+100",
      },
    ],
  },
];

const REWIND_ITEMS_WITH_TOOL_MODIFY_AND_MENTION_DELETE_SAME_PATH: ConversationItem[] =
  [
    {
      id: "user-codex-delete-override-1",
      kind: "message",
      role: "user",
      text: "@/Users/demo/repo/abc.txt 删除这个文件",
    },
    {
      id: "assistant-codex-delete-override-1",
      kind: "message",
      role: "assistant",
      text: "处理中",
    },
    {
      id: "tool-codex-modify-abc-only",
      kind: "tool",
      toolType: "fileChange",
      title: "Edit file",
      detail: JSON.stringify({
        input: {
          file_path: "/Users/demo/repo/abc.txt",
        },
      }),
      status: "completed",
      changes: [
        {
          path: "/Users/demo/repo/abc.txt",
          kind: "modified",
          diff: "@@ -1,1 +1,1 @@\n-before\n+after",
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

const REWIND_ITEMS_WITH_WINDOWS_UNC_CASE_VARIANTS: ConversationItem[] = [
  {
    id: "user-win-unc-1",
    kind: "message",
    role: "user",
    text: "处理同一个 UNC 路径的大小写变体",
  },
  {
    id: "assistant-win-unc-1",
    kind: "message",
    role: "assistant",
    text: "处理中",
  },
  {
    id: "tool-win-unc-modified",
    kind: "tool",
    toolType: "fileChange",
    title: "Edit file",
    detail: JSON.stringify({
      input: {
        file_path: "\\\\SERVER\\Share\\docs\\README.md",
      },
    }),
    status: "completed",
    changes: [
      {
        path: "\\\\SERVER\\Share\\docs\\README.md",
        kind: "modified",
        diff: "@@ -1,1 +1,1 @@\n-old\n+new",
      },
    ],
  },
  {
    id: "tool-win-unc-delete",
    kind: "tool",
    toolType: "fileChange",
    title: "Delete file",
    detail: JSON.stringify({
      input: {
        file_path: "//server/share/docs/README.md",
      },
    }),
    status: "completed",
    changes: [
      {
        path: "//server/share/docs/README.md",
        kind: "delete",
      },
    ],
  },
];

const REWIND_ITEMS_WITH_CASE_SENSITIVE_UNIX_PATHS: ConversationItem[] = [
  {
    id: "user-case-unix-1",
    kind: "message",
    role: "user",
    text: "同时修改两个仅大小写不同的文件",
  },
  {
    id: "assistant-case-unix-1",
    kind: "message",
    role: "assistant",
    text: "处理中",
  },
  {
    id: "tool-case-unix-upper",
    kind: "tool",
    toolType: "fileChange",
    title: "Edit file",
    detail: JSON.stringify({
      input: {
        file_path: "/Users/demo/repo/Readme.md",
      },
    }),
    status: "completed",
    changes: [
      {
        path: "/Users/demo/repo/Readme.md",
        kind: "modified",
        diff: "@@ -1,1 +1,1 @@\n-old-upper\n+new-upper",
      },
    ],
  },
  {
    id: "tool-case-unix-lower",
    kind: "tool",
    toolType: "fileChange",
    title: "Edit file",
    detail: JSON.stringify({
      input: {
        file_path: "/Users/demo/repo/readme.md",
      },
    }),
    status: "completed",
    changes: [
      {
        path: "/Users/demo/repo/readme.md",
        kind: "modified",
        diff: "@@ -1,1 +1,1 @@\n-old-lower\n+new-lower",
      },
    ],
  },
];

const REWIND_ITEMS_WITH_WINDOWS_DRIVE_CASE_VARIANTS: ConversationItem[] = [
  {
    id: "user-win-case-1",
    kind: "message",
    role: "user",
    text: "同一路径大小写变体",
  },
  {
    id: "assistant-win-case-1",
    kind: "message",
    role: "assistant",
    text: "处理中",
  },
  {
    id: "tool-win-case-modified",
    kind: "tool",
    toolType: "fileChange",
    title: "Edit file",
    detail: JSON.stringify({
      input: {
        file_path: "C:\\repo\\demo\\README.md",
      },
    }),
    status: "completed",
    changes: [
      {
        path: "C:\\repo\\demo\\README.md",
        kind: "modified",
        diff: "@@ -1,1 +1,1 @@\n-old\n+new",
      },
    ],
  },
  {
    id: "tool-win-case-delete",
    kind: "tool",
    toolType: "fileChange",
    title: "Delete file",
    detail: JSON.stringify({
      input: {
        file_path: "c:/repo/demo/README.md",
      },
    }),
    status: "completed",
    changes: [
      {
        path: "c:/repo/demo/README.md",
        kind: "delete",
      },
    ],
  },
];

const REWIND_ITEMS_WITH_CASE_SENSITIVE_MENTION_PATHS: ConversationItem[] = [
  {
    id: "user-case-mention-1",
    kind: "message",
    role: "user",
    text: "@/Users/demo/repo/Readme.md 和 @/Users/demo/repo/readme.md 都追加注释",
  },
  {
    id: "assistant-case-mention-1",
    kind: "message",
    role: "assistant",
    text: "处理中",
  },
  {
    id: "tool-case-mention-1",
    kind: "tool",
    toolType: "mcpToolCall",
    title: "Tool: Claude / Edit",
    detail: "{}",
    status: "completed",
    output: "Updated notes",
  },
];

const REWIND_ITEMS_WITH_DISPLAY_DUPLICATED_FILES: ConversationItem[] = [
  {
    id: "user-display-duplicate-1",
    kind: "message",
    role: "user",
    text: "@/Users/demo/repo/.specify目录结构说明.md 删除这个文件",
  },
  {
    id: "assistant-display-duplicate-1",
    kind: "message",
    role: "assistant",
    text: "处理中",
  },
  {
    id: "tool-display-duplicate-absolute",
    kind: "tool",
    toolType: "Bash",
    title: "Bash",
    detail: JSON.stringify({
      command: "rm /Users/demo/repo/.specify目录结构说明.md",
      description: "删除绝对路径文件",
    }),
    status: "completed",
    output: "",
    changes: [],
  },
  {
    id: "tool-display-duplicate-relative",
    kind: "tool",
    toolType: "fileChange",
    title: "Delete file",
    detail: JSON.stringify({
      input: {
        file_path: ".specify目录结构说明.md",
      },
    }),
    status: "completed",
    changes: [
      {
        path: ".specify目录结构说明.md",
        kind: "delete",
      },
    ],
  },
];

const REWIND_ITEMS_WITH_PREVIOUS_READ_CONTEXT: ConversationItem[] = [
  {
    id: "user-old-context",
    kind: "message",
    role: "user",
    text: "先看看 src/legacy/Old.tsx",
  },
  {
    id: "tool-old-read",
    kind: "tool",
    toolType: "readFile",
    title: "Read file",
    detail: JSON.stringify({
      input: {
        file_path: "src/legacy/Old.tsx",
      },
    }),
    status: "completed",
    output: "legacy content",
  },
  {
    id: "user-target-rewind",
    kind: "message",
    role: "user",
    text: "把按钮改成提交",
  },
  {
    id: "assistant-target-rewind",
    kind: "message",
    role: "assistant",
    text: "正在修改",
  },
  {
    id: "tool-target-edit",
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
];

const REWIND_ITEMS_WITH_READ_ONLY_TOOLS_AFTER_ANCHOR: ConversationItem[] = [
  {
    id: "user-read-only-after-anchor-1",
    kind: "message",
    role: "user",
    text:
      "先读取 @/Users/demo/repo/README.md，再修改 @/Users/demo/repo/src/app.ts",
  },
  {
    id: "assistant-read-only-after-anchor-1",
    kind: "message",
    role: "assistant",
    text: "处理中",
  },
  {
    id: "tool-read-only-after-anchor-read",
    kind: "tool",
    toolType: "readFile",
    title: "Read file",
    detail: JSON.stringify({
      input: {
        file_path: "/Users/demo/repo/README.md",
      },
    }),
    status: "completed",
    output: "readme content",
  },
  {
    id: "tool-read-only-after-anchor-batch-read",
    kind: "tool",
    toolType: "batchReadFiles",
    title: "Batch read files",
    detail: JSON.stringify({
      input: {
        paths: ["/Users/demo/repo/README.md"],
      },
    }),
    status: "completed",
    output: "batch read content",
  },
  {
    id: "tool-read-only-after-anchor-edit",
    kind: "tool",
    toolType: "fileChange",
    title: "Edit file",
    detail: JSON.stringify({
      input: {
        file_path: "/Users/demo/repo/src/app.ts",
      },
    }),
    status: "completed",
    changes: [
      {
        path: "/Users/demo/repo/src/app.ts",
        kind: "modified",
        diff: "@@ -1,1 +1,1 @@\n-old\n+new",
      },
    ],
  },
];

const REWIND_ITEMS_WITH_SAME_PATH_READ_THEN_EDIT: ConversationItem[] = [
  {
    id: "user-same-path-read-then-edit-1",
    kind: "message",
    role: "user",
    text: "先读取 @/Users/demo/repo/src/app.ts，再修改 @/Users/demo/repo/src/app.ts",
  },
  {
    id: "assistant-same-path-read-then-edit-1",
    kind: "message",
    role: "assistant",
    text: "处理中",
  },
  {
    id: "tool-same-path-read",
    kind: "tool",
    toolType: "readFile",
    title: "Read file",
    detail: JSON.stringify({
      input: {
        file_path: "/Users/demo/repo/src/app.ts",
      },
    }),
    status: "completed",
    output: "old app content",
  },
  {
    id: "tool-same-path-edit",
    kind: "tool",
    toolType: "fileChange",
    title: "Edit file",
    detail: JSON.stringify({
      input: {
        file_path: "/Users/demo/repo/src/app.ts",
      },
    }),
    status: "completed",
    changes: [
      {
        path: "/Users/demo/repo/src/app.ts",
        kind: "modified",
        diff: "@@ -1,1 +1,1 @@\n-before\n+after",
      },
    ],
  },
];

type ComposerHarnessProps = {
  items?: ConversationItem[];
  onRewind?: (
    userMessageId: string,
    options?: { mode?: "messages-and-files" | "messages-only" | "files-only" },
  ) => void | Promise<void>;
  onOpenDiffPath?: (path: string) => void;
  activeThreadId?: string | null;
  selectedEngine?: "claude" | "codex" | "gemini";
  rewindWorkspaceGitState?: {
    isGitRepository: boolean;
    hasDetectedChanges: boolean;
  } | null;
};

function ComposerHarness({
  items = REWIND_ITEMS,
  onRewind = async () => {},
  onOpenDiffPath,
  activeThreadId = "claude:session-1",
  selectedEngine = "claude",
  rewindWorkspaceGitState = null,
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
      rewindWorkspaceGitState={rewindWorkspaceGitState}
      activeThreadId={activeThreadId}
      onOpenDiffPath={onOpenDiffPath}
      onRewind={onRewind}
    />
  );
}

describe("Composer Claude rewind confirmation", () => {
  afterEach(() => {
    vi.clearAllMocks();
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
    expect(onRewind).toHaveBeenCalledWith("user-1", {
      mode: "messages-and-files",
    });
  });

  it("defaults rewind mode to messages and files when opening dialog", () => {
    render(<ComposerHarness />);

    fireEvent.click(screen.getByTestId("rewind-trigger"));

    expect(
      (screen.getByTestId(
        "claude-rewind-mode-messages-and-files",
      ) as HTMLInputElement)
        .checked,
    ).toBe(true);
  });

  it("passes messages-only mode to rewind callback", async () => {
    const onRewind = vi.fn(async () => {});

    render(<ComposerHarness onRewind={onRewind} />);

    fireEvent.click(screen.getByTestId("rewind-trigger"));
    fireEvent.click(screen.getByTestId("claude-rewind-mode-messages-only"));
    fireEvent.click(screen.getByTestId("claude-rewind-confirm-button"));

    await waitFor(() => {
      expect(onRewind).toHaveBeenCalledTimes(1);
    });
    expect(onRewind).toHaveBeenCalledWith("user-1", {
      mode: "messages-only",
    });
  });

  it("passes files-only mode to rewind callback", async () => {
    const onRewind = vi.fn(async () => {});

    render(<ComposerHarness onRewind={onRewind} />);

    fireEvent.click(screen.getByTestId("rewind-trigger"));
    fireEvent.click(screen.getByTestId("claude-rewind-mode-files-only"));
    fireEvent.click(screen.getByTestId("claude-rewind-confirm-button"));

    await waitFor(() => {
      expect(onRewind).toHaveBeenCalledTimes(1);
    });
    expect(onRewind).toHaveBeenCalledWith("user-1", {
      mode: "files-only",
    });
  });

  it("hides file review when messages-only mode is selected", () => {
    render(<ComposerHarness />);

    fireEvent.click(screen.getByTestId("rewind-trigger"));
    fireEvent.click(screen.getByTestId("claude-rewind-mode-messages-only"));

    expect(
      screen.getByTestId("claude-rewind-message-impact-section"),
    ).not.toBeNull();
    expect(
      screen.queryByTestId("claude-rewind-file-review-section"),
    ).toBeNull();
    expect(screen.queryByTestId("claude-rewind-file-Button.tsx")).toBeNull();
  });

  it("hides message impact when files-only mode is selected", () => {
    render(<ComposerHarness />);

    fireEvent.click(screen.getByTestId("rewind-trigger"));
    fireEvent.click(screen.getByTestId("claude-rewind-mode-files-only"));

    expect(
      screen.queryByTestId("claude-rewind-message-impact-section"),
    ).toBeNull();
    expect(screen.getByTestId("claude-rewind-file-review-section")).not.toBeNull();
    expect(screen.getByTestId("claude-rewind-file-Button.tsx")).not.toBeNull();
  });

  it("hides affected file UI when current workspace is a clean git repository", () => {
    render(
      <ComposerHarness
        rewindWorkspaceGitState={{
          isGitRepository: true,
          hasDetectedChanges: false,
        }}
      />,
    );

    fireEvent.click(screen.getByTestId("rewind-trigger"));

    expect(screen.queryByTestId("claude-rewind-file-review-section")).toBeNull();
    expect(screen.queryByTestId("claude-rewind-file-Button.tsx")).toBeNull();
    expect(screen.queryByText("rewind.impactFiles")).toBeNull();
    expect(screen.getByTestId("claude-rewind-message-impact-section")).not.toBeNull();
  });

  it("keeps affected file UI for non-git workspaces", () => {
    render(
      <ComposerHarness
        rewindWorkspaceGitState={{
          isGitRepository: false,
          hasDetectedChanges: false,
        }}
      />,
    );

    fireEvent.click(screen.getByTestId("rewind-trigger"));

    expect(screen.getByTestId("claude-rewind-file-review-section")).not.toBeNull();
    expect(screen.getByTestId("claude-rewind-file-Button.tsx")).not.toBeNull();
  });

  it("resets rewind mode to messages and files on dialog reopen", () => {
    render(<ComposerHarness />);

    fireEvent.click(screen.getByTestId("rewind-trigger"));
    fireEvent.click(screen.getByTestId("claude-rewind-mode-files-only"));
    fireEvent.click(screen.getByTestId("claude-rewind-cancel-button"));

    fireEvent.click(screen.getByTestId("rewind-trigger"));

    expect(
      (screen.getByTestId(
        "claude-rewind-mode-messages-and-files",
      ) as HTMLInputElement)
        .checked,
    ).toBe(true);
  });

  it("does not include files read before the target user message", () => {
    render(<ComposerHarness items={REWIND_ITEMS_WITH_PREVIOUS_READ_CONTEXT} />);

    fireEvent.click(screen.getByTestId("rewind-trigger"));

    expect(screen.getByTestId("claude-rewind-file-Button.tsx")).not.toBeNull();
    expect(screen.queryByTestId("claude-rewind-file-Old.tsx")).toBeNull();
  });

  it("does not include read or batch read files after the target user message", () => {
    render(
      <ComposerHarness items={REWIND_ITEMS_WITH_READ_ONLY_TOOLS_AFTER_ANCHOR} />,
    );

    fireEvent.click(screen.getByTestId("rewind-trigger"));

    expect(screen.getByTestId("claude-rewind-file-app.ts")).not.toBeNull();
    expect(screen.queryByTestId("claude-rewind-file-README.md")).toBeNull();
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

  it("parses inline file reference tokens when tool payload lacks file path", () => {
    render(<ComposerHarness items={REWIND_ITEMS_WITH_INLINE_TOKEN_FALLBACK} />);

    fireEvent.click(screen.getByTestId("rewind-trigger"));

    expect(screen.getByTestId("claude-rewind-dialog")).not.toBeNull();
    expect(screen.getByTestId("claude-rewind-file-config.ts")).not.toBeNull();
    expect(screen.getByTestId("claude-rewind-file-app.ts")).not.toBeNull();
    expect(screen.getByTestId("claude-rewind-file-config.ts").textContent).toContain(
      "git.fileDeleted",
    );
    expect(screen.getByTestId("claude-rewind-file-app.ts").textContent).toContain(
      "git.fileModified",
    );
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

  it("keeps a single mutation entry when the same path is read and then edited", () => {
    render(<ComposerHarness items={REWIND_ITEMS_WITH_SAME_PATH_READ_THEN_EDIT} />);

    fireEvent.click(screen.getByTestId("rewind-trigger"));

    expect(screen.getAllByTestId("claude-rewind-file-app.ts")).toHaveLength(1);
    expect(screen.getByTestId("claude-rewind-file-app.ts").textContent).toContain(
      "git.fileModified",
    );
  });

  it("deduplicates file list entries when the same file appears as absolute and relative paths", () => {
    render(
      <ComposerHarness items={REWIND_ITEMS_WITH_DISPLAY_DUPLICATED_FILES} />,
    );

    fireEvent.click(screen.getByTestId("rewind-trigger"));

    expect(
      screen.getAllByTestId("claude-rewind-file-.specify目录结构说明.md"),
    ).toHaveLength(1);
  });

  it("preserves stronger delete status and richer diff details when duplicate display entries are merged", () => {
    render(
      <ComposerHarness
        items={[
          {
            id: "user-duplicate-merge-1",
            kind: "message",
            role: "user",
            text: "删除 docs/spec.md",
          },
          {
            id: "assistant-duplicate-merge-1",
            kind: "message",
            role: "assistant",
            text: "处理中",
          },
          {
            id: "tool-duplicate-merge-absolute",
            kind: "tool",
            toolType: "fileChange",
            title: "Delete file",
            detail: JSON.stringify({
              input: {
                file_path: "/Users/demo/repo/docs/spec.md",
              },
            }),
            status: "completed",
            changes: [
              {
                path: "/Users/demo/repo/docs/spec.md",
                kind: "deleted",
                diff: "@@ -1,2 +0,0 @@\n-old line 1\n-old line 2",
              },
            ],
          },
          {
            id: "tool-duplicate-merge-relative",
            kind: "tool",
            toolType: "fileChange",
            title: "Edit file",
            detail: JSON.stringify({
              input: {
                file_path: "docs/spec.md",
              },
            }),
            status: "completed",
            changes: [
              {
                path: "docs/spec.md",
                kind: "modified",
                diff: "@@ -1,1 +1,1 @@\n-old\n+new",
              },
            ],
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByTestId("rewind-trigger"));

    const mergedEntry = screen.getByTestId("claude-rewind-file-spec.md");
    expect(screen.getAllByTestId("claude-rewind-file-spec.md")).toHaveLength(1);
    expect(mergedEntry.textContent).toContain("git.fileDeleted");

    fireEvent.click(mergedEntry);

    expect(
      screen.getByText((content) => content.includes("old line 2")),
    ).not.toBeNull();
  });

  it("exports the same mutation-only file set shown in preview", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      outputPath:
        "/Users/demo/.ccgui/chat-diff/claude/2026-04-17/session-1/user-read-only-after-anchor-1",
      filesPath:
        "/Users/demo/.ccgui/chat-diff/claude/2026-04-17/session-1/user-read-only-after-anchor-1/files",
      manifestPath:
        "/Users/demo/.ccgui/chat-diff/claude/2026-04-17/session-1/user-read-only-after-anchor-1/manifest.json",
      exportId: "user-read-only-after-anchor-1",
      fileCount: 1,
    });

    render(
      <ComposerHarness items={REWIND_ITEMS_WITH_READ_ONLY_TOOLS_AFTER_ANCHOR} />,
    );

    fireEvent.click(screen.getByTestId("rewind-trigger"));
    expect(screen.getByTestId("claude-rewind-file-app.ts")).not.toBeNull();
    expect(screen.queryByTestId("claude-rewind-file-README.md")).toBeNull();

    fireEvent.click(screen.getByTestId("claude-rewind-store-button"));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "export_rewind_files",
        expect.objectContaining({
          targetMessageId: "user-read-only-after-anchor-1",
          files: [{ path: "/Users/demo/repo/src/app.ts", status: "M" }],
        }),
      );
    });
  });

  it("supplements missing delete files from @mention paths for codex rewind preview", async () => {
    const invokeMock = vi.mocked(invoke);
    const initialCallCount = invokeMock.mock.calls.length;
    invokeMock.mockResolvedValueOnce({
      outputPath:
        "/Users/demo/.ccgui/chat-diff/codex/2026-04-16/thread-codex-1/user-codex-delete-fallback-1",
      filesPath:
        "/Users/demo/.ccgui/chat-diff/codex/2026-04-16/thread-codex-1/user-codex-delete-fallback-1/files",
      manifestPath:
        "/Users/demo/.ccgui/chat-diff/codex/2026-04-16/thread-codex-1/user-codex-delete-fallback-1/manifest.json",
      exportId: "user-codex-delete-fallback-1",
      fileCount: 3,
    });

    render(
      <ComposerHarness
        items={REWIND_ITEMS_WITH_MISSING_DELETE_TOOL_CHANGE}
        selectedEngine="codex"
        activeThreadId="thread-codex-1"
      />,
    );

    fireEvent.click(screen.getByTestId("rewind-trigger"));
    expect(
      screen.getByTestId("claude-rewind-file-.specify目录结构说明.md"),
    ).not.toBeNull();
    fireEvent.click(screen.getByTestId("claude-rewind-store-button"));

    await waitFor(() => {
      const args = invokeMock.mock.calls[initialCallCount]?.[1] as
        | { engine: string; targetMessageId: string; files: Array<{ path: string; status: string }> }
        | undefined;
      expect(args).toBeDefined();
      expect(args?.engine).toBe("codex");
      expect(args?.targetMessageId).toBe("user-codex-delete-fallback-1");
      expect(args?.files).toHaveLength(3);
      expect(args?.files).toEqual(
        expect.arrayContaining([
          {
            path: "/Users/demo/repo/.specify目录结构说明.md",
            status: "D",
          },
          { path: "/Users/demo/repo/abc.txt", status: "A" },
          { path: "/Users/demo/repo/pom.xml", status: "M" },
        ]),
      );
    });
  });

  it("upgrades tool-modified file to delete when @mention intent indicates deletion", async () => {
    const invokeMock = vi.mocked(invoke);
    const initialCallCount = invokeMock.mock.calls.length;
    invokeMock.mockResolvedValueOnce({
      outputPath:
        "/Users/demo/.ccgui/chat-diff/codex/2026-04-16/thread-codex-1/user-codex-delete-override-1",
      filesPath:
        "/Users/demo/.ccgui/chat-diff/codex/2026-04-16/thread-codex-1/user-codex-delete-override-1/files",
      manifestPath:
        "/Users/demo/.ccgui/chat-diff/codex/2026-04-16/thread-codex-1/user-codex-delete-override-1/manifest.json",
      exportId: "user-codex-delete-override-1",
      fileCount: 1,
    });

    render(
      <ComposerHarness
        items={REWIND_ITEMS_WITH_TOOL_MODIFY_AND_MENTION_DELETE_SAME_PATH}
        selectedEngine="codex"
        activeThreadId="thread-codex-1"
      />,
    );

    fireEvent.click(screen.getByTestId("rewind-trigger"));
    fireEvent.click(screen.getByTestId("claude-rewind-store-button"));

    await waitFor(() => {
      const args = invokeMock.mock.calls[initialCallCount]?.[1] as
        | { files: Array<{ path: string; status: string }> }
        | undefined;
      expect(args).toBeDefined();
      expect(args?.files).toEqual([
        { path: "/Users/demo/repo/abc.txt", status: "D" },
      ]);
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

  it("keeps case-distinct unix paths as separate entries when storing rewind files", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      outputPath:
        "/Users/demo/.ccgui/chat-diff/claude/2026-04-13/session-1/user-case-unix-1",
      filesPath:
        "/Users/demo/.ccgui/chat-diff/claude/2026-04-13/session-1/user-case-unix-1/files",
      manifestPath:
        "/Users/demo/.ccgui/chat-diff/claude/2026-04-13/session-1/user-case-unix-1/manifest.json",
      exportId: "user-case-unix-1",
      fileCount: 2,
    });

    render(<ComposerHarness items={REWIND_ITEMS_WITH_CASE_SENSITIVE_UNIX_PATHS} />);

    fireEvent.click(screen.getByTestId("rewind-trigger"));
    fireEvent.click(screen.getByTestId("claude-rewind-store-button"));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "export_rewind_files",
        expect.objectContaining({
          targetMessageId: "user-case-unix-1",
          files: [
            { path: "/Users/demo/repo/Readme.md", status: "M" },
            { path: "/Users/demo/repo/readme.md", status: "M" },
          ],
        }),
      );
    });
  });

  it("deduplicates windows drive-letter case variants when storing rewind files", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      outputPath:
        "/Users/demo/.ccgui/chat-diff/claude/2026-04-13/session-1/user-win-case-1",
      filesPath:
        "/Users/demo/.ccgui/chat-diff/claude/2026-04-13/session-1/user-win-case-1/files",
      manifestPath:
        "/Users/demo/.ccgui/chat-diff/claude/2026-04-13/session-1/user-win-case-1/manifest.json",
      exportId: "user-win-case-1",
      fileCount: 1,
    });

    render(<ComposerHarness items={REWIND_ITEMS_WITH_WINDOWS_DRIVE_CASE_VARIANTS} />);

    fireEvent.click(screen.getByTestId("rewind-trigger"));
    fireEvent.click(screen.getByTestId("claude-rewind-store-button"));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "export_rewind_files",
        expect.objectContaining({
          targetMessageId: "user-win-case-1",
          files: [{ path: "C:/repo/demo/README.md", status: "D" }],
        }),
      );
    });
  });

  it("deduplicates windows UNC case variants when storing rewind files", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      outputPath:
        "/Users/demo/.ccgui/chat-diff/claude/2026-04-13/session-1/user-win-unc-1",
      filesPath:
        "/Users/demo/.ccgui/chat-diff/claude/2026-04-13/session-1/user-win-unc-1/files",
      manifestPath:
        "/Users/demo/.ccgui/chat-diff/claude/2026-04-13/session-1/user-win-unc-1/manifest.json",
      exportId: "user-win-unc-1",
      fileCount: 1,
    });

    render(<ComposerHarness items={REWIND_ITEMS_WITH_WINDOWS_UNC_CASE_VARIANTS} />);

    fireEvent.click(screen.getByTestId("rewind-trigger"));
    fireEvent.click(screen.getByTestId("claude-rewind-store-button"));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "export_rewind_files",
        expect.objectContaining({
          targetMessageId: "user-win-unc-1",
          files: [{ path: "//SERVER/Share/docs/README.md", status: "D" }],
        }),
      );
    });
  });

  it("keeps case-distinct unix @mention paths as separate entries when storing rewind files", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      outputPath:
        "/Users/demo/.ccgui/chat-diff/claude/2026-04-13/session-1/user-case-mention-1",
      filesPath:
        "/Users/demo/.ccgui/chat-diff/claude/2026-04-13/session-1/user-case-mention-1/files",
      manifestPath:
        "/Users/demo/.ccgui/chat-diff/claude/2026-04-13/session-1/user-case-mention-1/manifest.json",
      exportId: "user-case-mention-1",
      fileCount: 2,
    });

    render(<ComposerHarness items={REWIND_ITEMS_WITH_CASE_SENSITIVE_MENTION_PATHS} />);

    fireEvent.click(screen.getByTestId("rewind-trigger"));
    fireEvent.click(screen.getByTestId("claude-rewind-store-button"));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        "export_rewind_files",
        expect.objectContaining({
          targetMessageId: "user-case-mention-1",
          files: [
            { path: "/Users/demo/repo/Readme.md", status: "M" },
            { path: "/Users/demo/repo/readme.md", status: "M" },
          ],
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
