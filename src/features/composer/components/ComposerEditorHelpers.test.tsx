/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ComposerEditorSettings } from "../../../types";
import { Composer } from "./Composer";

vi.mock("../../../services/dragDrop", () => ({
  subscribeWindowDragDrop: vi.fn(() => () => {}),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `tauri://${path}`,
  invoke: vi.fn(async () => null),
}));

vi.mock("../../engine/components/EngineSelector", () => ({
  EngineSelector: () => null,
}));

vi.mock("../../opencode/components/OpenCodeControlPanel", () => ({
  OpenCodeControlPanel: ({ visible }: { visible: boolean }) =>
    visible ? <div data-testid="opencode-control-panel" /> : null,
}));

vi.mock("./ChatInputBox/ChatInputBoxAdapter", () => ({
  ChatInputBoxAdapter: ({
    text,
    onTextChange,
    onSend,
  }: {
    text: string;
    onTextChange: (next: string, cursor: number | null) => void;
    onSend: (submittedText?: string, submittedImages?: string[]) => void;
  }) => (
    <>
      <textarea
        value={text}
        onChange={(event) =>
          onTextChange(event.currentTarget.value, event.currentTarget.value.length)
        }
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            onSend(text);
          }
        }}
      />
      <button
        type="button"
        data-testid="submit-snapshot"
        onClick={() => onSend("fresh child snapshot")}
      >
        Submit snapshot
      </button>
      <button
        type="button"
        data-testid="submit-snapshot-with-image"
        onClick={() => onSend("fresh child snapshot", ["child-image.png"])}
      >
        Submit snapshot with image
      </button>
      <button
        type="button"
        data-testid="submit-next-command"
        onClick={() => onSend("/next")}
      >
        Submit /next
      </button>
    </>
  ),
}));

type HarnessProps = {
  initialText?: string;
  selectedEngine?: "claude" | "codex" | "gemini" | "opencode";
  commands?: { name: string; path: string; content: string }[];
  attachedImages?: string[];
  onSend?: (
    text: string,
    images: string[],
    options?: { selectedMemoryIds?: string[] },
  ) => void | Promise<void>;
};

function ComposerHarness({
  initialText = "",
  selectedEngine = "claude",
  commands = [],
  attachedImages = [],
  onSend = () => {},
}: HarnessProps) {
  const editorSettings: ComposerEditorSettings = {
    preset: "smart",
    expandFenceOnSpace: true,
    expandFenceOnEnter: false,
    fenceLanguageTags: true,
    fenceWrapSelection: true,
    autoWrapPasteMultiline: true,
    autoWrapPasteCodeLike: true,
    continueListOnShiftEnter: true,
  };

  return (
    <Composer
      onSend={onSend}
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
      commands={commands}
      files={[]}
      draftText={initialText}
      onDraftChange={() => {}}
      attachedImages={attachedImages}
      dictationEnabled={false}
      editorSettings={editorSettings}
      activeWorkspaceId="ws-1"
      activeThreadId="thread-1"
    />
  );
}

type RenderedHarness = {
  container: HTMLDivElement;
  unmount: () => void;
};

function renderComposerHarness(props: HarnessProps): RenderedHarness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(<ComposerHarness {...props} />);
  });

  return {
    container,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

function getTextarea(container: HTMLElement) {
  const textarea = container.querySelector("textarea");
  if (!textarea) {
    throw new Error("Textarea not found");
  }
  return textarea;
}

describe("Composer editor helpers", () => {
  it("sends selected opencode direct command chip on Enter without chat text", async () => {
    const onSend = vi.fn();
    const harness = renderComposerHarness({
      initialText: "/export",
      selectedEngine: "opencode",
      commands: [{ name: "export", path: "", content: "" }],
      onSend,
    });
    const textarea = getTextarea(harness.container);

    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });

    expect(onSend).toHaveBeenCalledWith("/export", []);
    harness.unmount();
  });

  it("prefers submitted child snapshot over stale composer text state", async () => {
    const onSend = vi.fn();
    const harness = renderComposerHarness({ onSend });
    const button = harness.container.querySelector(
      '[data-testid="submit-snapshot"]',
    ) as HTMLButtonElement | null;
    if (!button) {
      throw new Error("Submit snapshot button not found");
    }

    await act(async () => {
      button.click();
    });

    expect(onSend).toHaveBeenCalledWith("fresh child snapshot", [], undefined);
    harness.unmount();
  });

  it("uses the latest keyboard-enter snapshot from the child input", async () => {
    const onSend = vi.fn();
    const harness = renderComposerHarness({ onSend });
    const textarea = getTextarea(harness.container);

    await act(async () => {
      fireEvent.change(textarea, { target: { value: "latest enter snapshot" } });
      fireEvent.keyDown(textarea, { key: "Enter" });
    });

    expect(onSend).toHaveBeenCalledWith("latest enter snapshot", [], undefined);
    harness.unmount();
  });

  it("merges composer images with submitted child snapshot images", async () => {
    const onSend = vi.fn();
    const harness = renderComposerHarness({
      onSend,
      attachedImages: ["persisted-image.png"],
    });
    const button = harness.container.querySelector(
      '[data-testid="submit-snapshot-with-image"]',
    ) as HTMLButtonElement | null;
    if (!button) {
      throw new Error("Submit snapshot with image button not found");
    }

    await act(async () => {
      button.click();
    });

    expect(onSend).toHaveBeenCalledWith(
      "fresh child snapshot",
      ["persisted-image.png", "child-image.png"],
      undefined,
    );
    harness.unmount();
  });

  it("does not reuse a submitted custom slash command as a later common prefix", async () => {
    const onSend = vi.fn();
    const harness = renderComposerHarness({
      initialText: "/next",
      commands: [{ name: "next", path: "/repo/.claude/commands/next.md", content: "next" }],
      onSend,
    });
    const submitCommand = harness.container.querySelector(
      '[data-testid="submit-next-command"]',
    ) as HTMLButtonElement | null;
    if (!submitCommand) {
      throw new Error("Submit command button not found");
    }
    const textarea = getTextarea(harness.container);

    await act(async () => {
      submitCommand.click();
    });

    await act(async () => {
      fireEvent.change(textarea, { target: { value: "follow up" } });
      fireEvent.keyDown(textarea, { key: "Enter" });
    });

    expect(onSend).toHaveBeenNthCalledWith(1, "/next", [], undefined);
    expect(onSend).toHaveBeenNthCalledWith(2, "follow up", [], undefined);
    harness.unmount();
  });

  it("clears selected custom slash commands before a pending send settles", async () => {
    let resolveFirstSend: (() => void) | null = null;
    const onSend = vi
      .fn<(text: string, images: string[], options?: { selectedMemoryIds?: string[] }) => void | Promise<void>>()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirstSend = resolve;
          }),
      )
      .mockImplementation(() => undefined);
    const harness = renderComposerHarness({
      initialText: "/next",
      commands: [{ name: "next", path: "/repo/.claude/commands/next.md", content: "next" }],
      onSend,
    });
    const submitCommand = harness.container.querySelector(
      '[data-testid="submit-next-command"]',
    ) as HTMLButtonElement | null;
    if (!submitCommand) {
      throw new Error("Submit command button not found");
    }
    const textarea = getTextarea(harness.container);

    await act(async () => {
      submitCommand.click();
    });

    await act(async () => {
      fireEvent.change(textarea, { target: { value: "follow up" } });
      fireEvent.keyDown(textarea, { key: "Enter" });
    });

    expect(onSend).toHaveBeenNthCalledWith(1, "/next", [], undefined);
    expect(onSend).toHaveBeenNthCalledWith(2, "follow up", [], undefined);

    await act(async () => {
      resolveFirstSend?.();
    });
    harness.unmount();
  });

});
