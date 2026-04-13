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

type ComposerHarnessProps = {
  items?: ConversationItem[];
  onRewind?: (userMessageId: string) => void | Promise<void>;
  onOpenDiffPath?: (path: string) => void;
  activeThreadId?: string | null;
};

function ComposerHarness({
  items = REWIND_ITEMS,
  onRewind = async () => {},
  onOpenDiffPath,
  activeThreadId = "claude:session-1",
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
      selectedEngine="claude"
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
          { path: "src/components/Button.tsx" },
          { path: "src/components/Card.tsx" },
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

  it("hides rewind entry for non-Claude threads", () => {
    render(<ComposerHarness activeThreadId="thread-codex-1" />);

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
