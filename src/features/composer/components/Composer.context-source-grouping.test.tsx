/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComposerEditorSettings, CustomCommandOption, SkillOption } from "../../../types";
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
  OpenCodeControlPanel: () => null,
}));

vi.mock("./ChatInputBox/ChatInputBoxAdapter", () => ({
  ChatInputBoxAdapter: ({
    text,
    onTextChange,
    onSend,
  }: {
    text: string;
    onTextChange: (next: string, cursor: number | null) => void;
    onSend: () => void;
  }) => (
    <textarea
      value={text}
      onChange={(event) =>
        onTextChange(event.currentTarget.value, event.currentTarget.value.length)
      }
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          onSend();
        }
      }}
    />
  ),
}));

type HarnessProps = {
  skills?: SkillOption[];
  commands?: CustomCommandOption[];
  onSend?: (text: string, images: string[]) => void;
  activeThreadId?: string;
};

function ComposerHarness({
  skills = [],
  commands = [],
  onSend = () => {},
  activeThreadId = "thread-1",
}: HarnessProps) {
  const [draftText, setDraftText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const editorSettings: ComposerEditorSettings = {
    preset: "default",
    expandFenceOnSpace: false,
    expandFenceOnEnter: false,
    fenceLanguageTags: false,
    fenceWrapSelection: false,
    autoWrapPasteMultiline: false,
    autoWrapPasteCodeLike: false,
    continueListOnShiftEnter: false,
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
      skills={skills}
      prompts={[]}
      commands={commands}
      files={[]}
      draftText={draftText}
      onDraftChange={setDraftText}
      textareaRef={textareaRef}
      dictationEnabled={false}
      editorSettings={editorSettings}
      activeWorkspaceId="ws-1"
      activeThreadId={activeThreadId}
    />
  );
}

function getTextarea(container: HTMLElement) {
  const textarea = container.querySelector("textarea");
  if (!textarea) {
    throw new Error("Textarea not found");
  }
  return textarea as HTMLTextAreaElement;
}

describe("Composer context source grouping", () => {
  afterEach(() => {
    cleanup();
  });

  it("avoids duplicated slash skill tokens when same skill name exists in multiple sources", async () => {
    const onSend = vi.fn();
    const view = render(
      <ComposerHarness
        onSend={onSend}
        skills={[
          {
            name: "doc-backup",
            path: "/repo/.claude/skills/doc-backup/SKILL.md",
            source: "global_claude",
            description: "claude",
          },
          {
            name: "doc-backup",
            path: "/repo/.codex/skills/doc-backup/SKILL.md",
            source: "global_codex",
            description: "codex",
          },
          {
            name: "doc-backup",
            path: "/repo/.agents/skills/doc-backup/SKILL.md",
            source: "global_agents",
            description: "agents",
          },
        ]}
      />,
    );

    const textarea = getTextarea(view.container);
    const value = "/doc-backup 帮我整理";
    await act(async () => {
      fireEvent.change(textarea, {
        target: {
          value,
          selectionStart: value.length,
        },
      });
      fireEvent.keyDown(textarea, { key: "Enter", bubbles: true });
    });

    const sentText = onSend.mock.calls[0]?.[0];
    expect(sentText).toBe("/doc-backup 帮我整理");
  });

  it("keeps slash token assembly clean without leaking source metadata", async () => {
    const onSend = vi.fn();
    const view = render(
      <ComposerHarness
        onSend={onSend}
        skills={[
          {
            name: "build-review",
            path: "/repo/.claude/skills/build-review/SKILL.md",
            source: "project_claude",
            description: "skill",
          },
        ]}
        commands={[
          {
            name: "team-lint",
            path: "/repo/.claude/commands/team/lint.md",
            source: "project_claude",
            description: "command",
            content: "body",
          },
        ]}
      />,
    );

    const textarea = getTextarea(view.container);
    const value = "/build-review /team-lint 检查一下";
    await act(async () => {
      fireEvent.change(textarea, {
        target: {
          value,
          selectionStart: value.length,
        },
      });
      fireEvent.keyDown(textarea, { key: "Enter", bubbles: true });
    });

    const sentText = onSend.mock.calls[0]?.[0];
    expect(sentText).toBe("/build-review /team-lint 检查一下");
    expect(sentText).not.toContain("project_claude");
    expect(sentText).not.toContain("User .claude");
  });

  it("clears selected skill chips when switching threads before sending", async () => {
    const onSend = vi.fn();
    const skill: SkillOption = {
      name: "review-code",
      path: "/repo/.claude/skills/review-code/SKILL.md",
      source: "project_claude",
      description: "review",
    };
    const view = render(
      <ComposerHarness
        onSend={onSend}
        skills={[skill]}
        activeThreadId="thread-1"
      />,
    );

    const textarea = getTextarea(view.container);
    const value = "/review-code 帮我看一下";
    await act(async () => {
      fireEvent.change(textarea, {
        target: {
          value,
          selectionStart: value.length,
        },
      });
    });

    view.rerender(
      <ComposerHarness
        onSend={onSend}
        skills={[skill]}
        activeThreadId="thread-2"
      />,
    );

    const switchedTextarea = getTextarea(view.container);
    await act(async () => {
      fireEvent.keyDown(switchedTextarea, { key: "Enter", bubbles: true });
    });

    expect(onSend.mock.calls[0]?.[0]).toBe("帮我看一下");
  });
});
