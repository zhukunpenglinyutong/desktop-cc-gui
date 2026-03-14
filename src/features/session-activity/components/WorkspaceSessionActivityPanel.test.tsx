// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach as afterEachTest, describe, expect, it, vi } from "vitest";
import type { WorkspaceSessionActivityViewModel } from "../types";
import { WorkspaceSessionActivityPanel } from "./WorkspaceSessionActivityPanel";

function getEventNode(container: HTMLElement, kind: string) {
  return container.querySelector(`.session-activity-event-${kind}`) as HTMLElement | null;
}

function getPreviewTextForKind(container: HTMLElement, kind: string) {
  return getEventNode(container, kind)?.querySelector(".session-activity-preview-text");
}

function getPreviewToggleForKind(container: HTMLElement, kind: string) {
  return getEventNode(container, kind)?.querySelector(".session-activity-preview-toggle");
}

function getTurnGroup(container: HTMLElement, index: number) {
  return container.querySelectorAll(".session-activity-turn-group")[index] as HTMLElement | undefined;
}

function createViewModel(): WorkspaceSessionActivityViewModel {
  return {
    rootThreadId: "root-thread",
    rootThreadName: "Root session",
    relevantThreadIds: ["root-thread", "child-thread"],
    isProcessing: true,
    emptyState: "running",
    sessionSummaries: [
      {
        threadId: "root-thread",
        threadName: "Root session",
        sessionRole: "root",
        relationshipSource: "directParent",
        eventCount: 2,
        isProcessing: true,
      },
      {
        threadId: "child-thread",
        threadName: "Child session",
        sessionRole: "child",
        relationshipSource: "fallbackLinking",
        eventCount: 1,
        isProcessing: false,
      },
    ],
    timeline: [
      {
        eventId: "file:file-1",
        turnId: "turn-2",
        turnIndex: 2,
        threadId: "child-thread",
        threadName: "Child session",
        sessionRole: "child",
        relationshipSource: "fallbackLinking",
        kind: "fileChange",
        occurredAt: 30,
        summary: "File change · src/App.tsx",
        status: "completed",
        jumpTarget: {
          type: "file",
          path: "src/App.tsx",
          line: 9,
          markers: { added: [9], modified: [10] },
        },
        additions: 3,
        deletions: 1,
      },
      {
        eventId: "task:task-1",
        turnId: "turn-2",
        turnIndex: 2,
        threadId: "child-thread",
        threadName: "Child session",
        sessionRole: "child",
        relationshipSource: "directParent",
        kind: "task",
        occurredAt: 20,
        summary: "Task · Audit current panel",
        status: "running",
        jumpTarget: { type: "thread", threadId: "child-thread" },
      },
      {
        eventId: "command:cmd-1",
        turnId: "turn-2",
        turnIndex: 2,
        threadId: "root-thread",
        threadName: "Root session",
        sessionRole: "root",
        relationshipSource: "directParent",
        kind: "command",
        occurredAt: 10,
        summary: "pnpm vitest",
        status: "running",
        commandText: "pnpm vitest --runInBand",
        commandDescription: "Run focused test suite",
        commandWorkingDirectory: "/workspace/project",
        commandPreview: "stderr line\nstdout tail",
      },
      {
        eventId: "explore:explore-1",
        turnId: "turn-2",
        turnIndex: 2,
        threadId: "root-thread",
        threadName: "Root session",
        sessionRole: "root",
        relationshipSource: "directParent",
        kind: "explore",
        occurredAt: 5,
        summary: "Search · activity panel",
        status: "completed",
      },
      {
        eventId: "reasoning:reason-1",
        turnId: "turn-2",
        turnIndex: 2,
        threadId: "root-thread",
        threadName: "Root session",
        sessionRole: "root",
        relationshipSource: "directParent",
        kind: "reasoning",
        occurredAt: 4,
        summary: "Thinking · compare recent panel states",
        status: "running",
        jumpTarget: { type: "thread", threadId: "root-thread" },
        reasoningPreview:
          "用户想要在备忘录中添加分类功能。\n我需要：1. 修改 Memo 实体；2. 修改 MemoRequest；3. 调整 controller。",
      },
    ],
  };
}

describe("WorkspaceSessionActivityPanel", () => {
  afterEachTest(() => {
    cleanup();
  });

  it("routes file cards to the correct jump target", () => {
    const onOpenDiffPath = vi.fn();

    render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={createViewModel()}
        onOpenDiffPath={onOpenDiffPath}
        onSelectThread={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /File change · src\/App\.tsx/i }));

    expect(onOpenDiffPath).toHaveBeenCalledWith(
      "src/App.tsx",
      { line: 9, column: 1 },
      { highlightMarkers: { added: [9], modified: [10] } },
    );
  });

  it("routes read activity cards to file opening when jumpTarget is file", () => {
    const onOpenDiffPath = vi.fn();
    const viewModel = createViewModel();
    viewModel.timeline = [
      {
        eventId: "task:read-1",
        turnId: "turn-2",
        turnIndex: 2,
        threadId: "root-thread",
        threadName: "Root session",
        sessionRole: "root",
        relationshipSource: "directParent",
        kind: "task",
        occurredAt: 40,
        summary: "Read · README.md",
        status: "completed",
        jumpTarget: { type: "file", path: "/workspace/README.md" },
      },
    ];

    render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={viewModel}
        onOpenDiffPath={onOpenDiffPath}
        onSelectThread={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Read · README\.md/i }));

    expect(onOpenDiffPath).toHaveBeenCalledWith("/workspace/README.md", undefined, undefined);
  });

  it("collapses older turn groups and only expands the latest one by default", () => {
    const viewModel = createViewModel();
    viewModel.timeline = [
      ...viewModel.timeline,
      {
        eventId: "command:cmd-older",
        turnId: "turn-1",
        turnIndex: 1,
        threadId: "root-thread",
        threadName: "Root session",
        sessionRole: "root",
        relationshipSource: "directParent",
        kind: "command",
        occurredAt: 1,
        summary: "Older command",
        status: "completed",
        commandDescription: "Older command",
        commandPreview: "older output",
      },
    ];

    const { container } = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={viewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    const latestGroup = getTurnGroup(container, 0);
    const olderGroup = getTurnGroup(container, 1);
    expect(latestGroup?.querySelector(".session-activity-turn-group-events")).toBeTruthy();
    expect(olderGroup?.querySelector(".session-activity-turn-group-events")).toBeNull();
    expect(screen.queryByRole("button", { name: /Older command/i })).toBeNull();
  });

  it("allows expanding a collapsed older turn group", () => {
    const viewModel = createViewModel();
    viewModel.timeline = [
      ...viewModel.timeline,
      {
        eventId: "command:cmd-older",
        turnId: "turn-1",
        turnIndex: 1,
        threadId: "root-thread",
        threadName: "Root session",
        sessionRole: "root",
        relationshipSource: "directParent",
        kind: "command",
        occurredAt: 1,
        summary: "Older command",
        status: "completed",
        commandDescription: "Older command",
        commandPreview: "older output",
      },
    ];

    const { container } = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={viewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    const olderGroup = getTurnGroup(container, 1);
    const olderToggle = olderGroup?.querySelector(
      ".session-activity-turn-group-header",
    ) as HTMLButtonElement | null;
    expect(olderToggle?.getAttribute("aria-expanded")).toBe("false");
    if (!olderToggle) {
      return;
    }
    fireEvent.click(olderToggle);
    expect(screen.getByRole("button", { name: /Older command/i })).toBeTruthy();
    expect(getTurnGroup(container, 1)?.querySelector(".session-activity-turn-group-events")).toBeTruthy();
  });

  it("auto-expands a newly arrived latest turn group while older groups stay collapsed", () => {
    const baseViewModel = createViewModel();
    baseViewModel.timeline = [
      {
        eventId: "command:cmd-initial",
        turnId: "turn-1",
        turnIndex: 1,
        threadId: "root-thread",
        threadName: "Root session",
        sessionRole: "root",
        relationshipSource: "directParent",
        kind: "command",
        occurredAt: 1,
        summary: "Initial command",
        status: "completed",
        commandDescription: "Initial command",
        commandPreview: "done",
      },
    ];
    baseViewModel.isProcessing = false;
    baseViewModel.emptyState = "completed";
    baseViewModel.sessionSummaries = [
      {
        threadId: "root-thread",
        threadName: "Root session",
        sessionRole: "root",
        relationshipSource: "directParent",
        eventCount: 1,
        isProcessing: false,
      },
    ];

    const { container, rerender } = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={baseViewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    expect(getTurnGroup(container, 0)?.querySelector(".session-activity-turn-group-events")).toBeTruthy();

    const updatedViewModel = createViewModel();
    updatedViewModel.timeline = [
      ...baseViewModel.timeline,
      {
        eventId: "command:cmd-latest",
        turnId: "turn-2",
        turnIndex: 2,
        threadId: "root-thread",
        threadName: "Root session",
        sessionRole: "root",
        relationshipSource: "directParent",
        kind: "command",
        occurredAt: 20,
        summary: "Latest command",
        status: "running",
        commandDescription: "Latest command",
        commandPreview: "running",
      },
    ];
    updatedViewModel.isProcessing = true;
    updatedViewModel.emptyState = "running";
    updatedViewModel.sessionSummaries = [
      {
        threadId: "root-thread",
        threadName: "Root session",
        sessionRole: "root",
        relationshipSource: "directParent",
        eventCount: 2,
        isProcessing: true,
      },
    ];

    rerender(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={updatedViewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    expect(getTurnGroup(container, 0)?.querySelector(".session-activity-turn-group-events")).toBeTruthy();
    expect(getTurnGroup(container, 1)?.querySelector(".session-activity-turn-group-events")).toBeNull();
    expect(screen.getByRole("button", { name: /Latest command/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Initial command/i })).toBeNull();
  });

  it("collapses the previous turn when a new running reasoning turn arrives", () => {
    const initialViewModel = createViewModel();
    initialViewModel.timeline = [
      {
        eventId: "reasoning:reason-initial",
        turnId: "turn-1",
        turnIndex: 1,
        threadId: "root-thread",
        threadName: "Root session",
        sessionRole: "root",
        relationshipSource: "directParent",
        kind: "reasoning",
        occurredAt: 1,
        summary: "Thinking · initial reasoning",
        status: "running",
        reasoningPreview: "initial reasoning preview",
      },
    ];
    initialViewModel.sessionSummaries = [
      {
        threadId: "root-thread",
        threadName: "Root session",
        sessionRole: "root",
        relationshipSource: "directParent",
        eventCount: 1,
        isProcessing: true,
      },
    ];

    const { container, rerender } = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={initialViewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    expect(getTurnGroup(container, 0)?.querySelector(".session-activity-turn-group-events")).toBeTruthy();

    const updatedViewModel = createViewModel();
    updatedViewModel.timeline = [
      {
        eventId: "reasoning:reason-latest",
        turnId: "turn-2",
        turnIndex: 2,
        threadId: "root-thread",
        threadName: "Root session",
        sessionRole: "root",
        relationshipSource: "directParent",
        kind: "reasoning",
        occurredAt: 20,
        summary: "Thinking · latest reasoning",
        status: "running",
        reasoningPreview: "latest reasoning preview",
      },
      {
        eventId: "reasoning:reason-initial",
        turnId: "turn-1",
        turnIndex: 1,
        threadId: "root-thread",
        threadName: "Root session",
        sessionRole: "root",
        relationshipSource: "directParent",
        kind: "reasoning",
        occurredAt: 1,
        summary: "Thinking · initial reasoning",
        status: "completed",
        reasoningPreview: "initial reasoning preview",
      },
    ];
    updatedViewModel.sessionSummaries = [
      {
        threadId: "root-thread",
        threadName: "Root session",
        sessionRole: "root",
        relationshipSource: "directParent",
        eventCount: 2,
        isProcessing: true,
      },
    ];

    rerender(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={updatedViewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    expect(getTurnGroup(container, 0)?.querySelector(".session-activity-turn-group-events")).toBeTruthy();
    expect(getTurnGroup(container, 1)?.querySelector(".session-activity-turn-group-events")).toBeNull();
    expect(screen.getByRole("button", { name: /Thinking · latest reasoning/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Thinking · initial reasoning/i })).toBeNull();
  });

  it("does not pass empty highlight markers when a file card has no parsed line ranges", () => {
    const onOpenDiffPath = vi.fn();
    const viewModel = createViewModel();
    viewModel.timeline = viewModel.timeline.map((event) =>
      event.kind === "fileChange"
        ? {
            ...event,
            jumpTarget:
              event.jumpTarget?.type === "file"
                ? {
                    ...event.jumpTarget,
                    line: undefined,
                    markers: { added: [], modified: [] },
                  }
                : event.jumpTarget,
          }
        : event,
    );

    render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={viewModel}
        onOpenDiffPath={onOpenDiffPath}
        onSelectThread={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /File change · src\/App\.tsx/i }));

    expect(onOpenDiffPath).toHaveBeenCalledWith("src/App.tsx", undefined, undefined);
  });

  it("shows and filters the explore category independently", () => {
    render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={createViewModel()}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    expect(screen.getByRole("tab", { name: /activityPanel\.tabs\.explore1/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /activityPanel\.tabs\.explore1/i }));

    expect(screen.getByRole("button", { name: /Search · activity panel/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Run focused test suite/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Task · Audit current panel/i })).toBeNull();
  });

  it("keeps completed explore run entries collapsed even when they carry command metadata", () => {
    const viewModel = createViewModel();
    viewModel.timeline = [
      {
        eventId: "explore:run:collapsed",
        threadId: "root-thread",
        threadName: "Root session",
        sessionRole: "root",
        relationshipSource: "directParent",
        kind: "explore",
        occurredAt: 40,
        summary: "List · NO .codex",
        status: "completed",
        commandText: "List · NO .codex",
        commandDescription: "/Users/demo/.codex not found",
        jumpTarget: { type: "thread", threadId: "root-thread" },
      },
    ];
    viewModel.isProcessing = false;
    viewModel.emptyState = "completed";
    viewModel.sessionSummaries = [
      {
        threadId: "root-thread",
        threadName: "Root session",
        sessionRole: "root",
        relationshipSource: "directParent",
        eventCount: 1,
        isProcessing: false,
      },
    ];

    const view = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={viewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    const eventNode = view.container.querySelector(".session-activity-event-explore");
    expect(eventNode?.classList.contains("is-expanded")).toBe(false);
    expect(view.container.querySelector(".session-activity-preview-toggle")).toBeNull();
    expect(view.container.querySelector(".session-activity-preview-text")).toBeNull();
  });

  it("shows and filters the reasoning category independently", () => {
    render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={createViewModel()}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    expect(screen.getByRole("tab", { name: /activityPanel\.tabs\.reasoning1/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /activityPanel\.tabs\.reasoning1/i }));

    expect(
      screen.getByRole("button", { name: /Thinking · compare recent panel states/i }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Search · activity panel/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Run focused test suite/i })).toBeNull();
  });

  it("pins reasoning to the top of the turn group in summary view", () => {
    const viewModel = createViewModel();

    render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={viewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    const latestGroup = getTurnGroup(document.body as unknown as HTMLElement, 0);
    const eventTitles = Array.from(
      latestGroup?.querySelectorAll(".session-activity-card-title") ?? [],
    ).map((node) => node.textContent?.trim() ?? "");

    expect(eventTitles[0]).toBe("messages.thinkingLabel");
  });

  it("keeps reasoning items in chronological order within the reasoning block", () => {
    const viewModel = createViewModel();
    viewModel.timeline = [
      {
        eventId: "reasoning:reason-older",
        turnId: "turn-2",
        turnIndex: 2,
        threadId: "root-thread",
        threadName: "Root session",
        sessionRole: "root",
        relationshipSource: "directParent",
        kind: "reasoning",
        occurredAt: 2,
        summary: "Thinking · first step",
        status: "completed",
        reasoningPreview: "first step preview",
      },
      {
        eventId: "reasoning:reason-newer",
        turnId: "turn-2",
        turnIndex: 2,
        threadId: "root-thread",
        threadName: "Root session",
        sessionRole: "root",
        relationshipSource: "directParent",
        kind: "reasoning",
        occurredAt: 4,
        summary: "Thinking · second step",
        status: "completed",
        reasoningPreview: "second step preview",
      },
      ...createViewModel().timeline.filter((event) => event.kind !== "reasoning"),
    ];

    render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={viewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    const latestGroup = getTurnGroup(document.body as unknown as HTMLElement, 0);
    const reasoningButtons = Array.from(
      latestGroup?.querySelectorAll(
        ".session-activity-event-reasoning .session-activity-card-main",
      ) ?? [],
    );
    const reasoningAriaLabels = reasoningButtons.map((node) =>
      node.getAttribute("aria-label") ?? "",
    );

    expect(reasoningAriaLabels[0]).toContain("first step");
    expect(reasoningAriaLabels[1]).toContain("second step");
  });

  it("supports expanding explore events when detail preview exists", () => {
    const viewModel = createViewModel();
    viewModel.timeline = [
      {
        eventId: "explore-read-preview-1",
        turnId: "turn-1",
        turnIndex: 1,
        threadId: "root-thread",
        threadName: "Root session",
        sessionRole: "root",
        relationshipSource: "directParent",
        kind: "explore",
        occurredAt: 40,
        summary: "Read · 读取策略",
        status: "completed",
        explorePreview: "优先读取该目录，再回退到工作区默认 openspec。",
        jumpTarget: { type: "thread", threadId: "root-thread" },
      },
    ];

    const view = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={viewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    const previewToggle = view.container.querySelector(".session-activity-preview-toggle");
    expect(previewToggle).toBeTruthy();
    fireEvent.click(previewToggle as HTMLElement);
    expect(view.container.querySelector(".session-activity-preview-text")?.textContent).toContain(
      "优先读取该目录",
    );
  });

  it("does not expand read explore events when the preview is a file path and opens the file instead", () => {
    const onOpenDiffPath = vi.fn();
    const viewModel = createViewModel();
    viewModel.timeline = [
      {
        eventId: "explore-read-path-1",
        turnId: "turn-1",
        turnIndex: 1,
        threadId: "root-thread",
        threadName: "Root session",
        sessionRole: "root",
        relationshipSource: "directParent",
        kind: "explore",
        occurredAt: 40,
        summary: "Read · Cargo.toml",
        status: "completed",
        explorePreview: "src-tauri/Cargo.toml",
        jumpTarget: { type: "file", path: "src-tauri/Cargo.toml" },
      },
    ];

    const view = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={viewModel}
        onOpenDiffPath={onOpenDiffPath}
        onSelectThread={vi.fn()}
      />,
    );

    expect(view.container.querySelector(".session-activity-preview-toggle")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Read · Cargo\.toml/i }));

    expect(onOpenDiffPath).toHaveBeenCalledWith("src-tauri/Cargo.toml", undefined, undefined);
    expect(view.container.querySelector(".session-activity-preview-text")).toBeNull();
  });

  it("auto-expands reasoning while running and allows manual collapse/expand", () => {
    const view = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={createViewModel()}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /activityPanel\.tabs\.reasoning1/i }));
    expect(view.container.querySelector(".session-activity-event-reasoning.is-expanded")).toBeTruthy();
    expect(view.container.querySelector(".session-activity-preview-text")?.textContent).toContain(
      "Memo 实体",
    );

    const previewToggle = getPreviewToggleForKind(view.container, "reasoning");
    expect(previewToggle).toBeTruthy();
    if (!previewToggle) {
      return;
    }
    fireEvent.click(previewToggle);
    expect(view.container.querySelector(".session-activity-event-reasoning.is-expanded")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Thinking · compare recent panel states/i }));
    expect(view.container.querySelector(".session-activity-event-reasoning.is-expanded")).toBeTruthy();
  });

  it("renders running reasoning preview with markdown formatting", () => {
    const viewModel = createViewModel();
    viewModel.timeline = viewModel.timeline.map((event) =>
      event.kind === "reasoning"
        ? {
            ...event,
            reasoningPreview:
              "当前问题：\n1. **异常处理不规范**\n2. `LogEntry` 设计混用\n\n重构计划：\n1. 新建 DTO\n2. 完善测试",
          }
        : event,
    );

    const view = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={viewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /activityPanel\.tabs\.reasoning1/i }));

    expect(view.container.querySelector(".session-activity-preview-markdown.markdown-live-streaming")).toBeTruthy();
    expect(view.container.querySelector(".session-activity-reasoning-surface")).toBeTruthy();
    expect(view.container.querySelector(".session-activity-preview-markdown strong")?.textContent).toBe(
      "异常处理不规范",
    );
    expect(view.container.querySelector(".session-activity-preview-markdown code")?.textContent).toBe(
      "LogEntry",
    );
    expect(view.container.querySelectorAll(".session-activity-preview-markdown ol li")).toHaveLength(4);
  });

  it("preserves soft line breaks in running reasoning preview", () => {
    const viewModel = createViewModel();
    viewModel.timeline = viewModel.timeline.map((event) =>
      event.kind === "reasoning"
        ? {
            ...event,
            reasoningPreview: "第一行\n第二行\n第三行",
          }
        : event,
    );

    const view = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={viewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /activityPanel\.tabs\.reasoning1/i }));

    expect(view.container.querySelectorAll(".session-activity-preview-markdown br").length).toBe(2);
  });

  it("pins running reasoning preview to the bottom while streaming updates", () => {
    const initialViewModel = createViewModel();
    initialViewModel.timeline = initialViewModel.timeline.map((event) =>
      event.kind === "reasoning"
        ? {
            ...event,
            reasoningPreview: "第一段\n第二段",
          }
        : event,
    );

    const view = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={initialViewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /activityPanel\.tabs\.reasoning1/i }));

    const preview = view.container.querySelector(
      ".session-activity-event-reasoning .session-activity-preview-text.is-markdown",
    ) as HTMLDivElement | null;
    expect(preview).toBeTruthy();
    if (!preview) {
      return;
    }

    let mockedScrollHeight = 360;
    Object.defineProperty(preview, "scrollHeight", {
      configurable: true,
      get: () => mockedScrollHeight,
    });
    const scrollToSpy = vi.fn();
    Object.defineProperty(preview, "scrollTo", {
      configurable: true,
      value: scrollToSpy,
    });

    mockedScrollHeight = 720;
    const updatedViewModel = createViewModel();
    updatedViewModel.timeline = updatedViewModel.timeline.map((event) =>
      event.kind === "reasoning"
        ? {
            ...event,
            reasoningPreview: "第一段\n第二段\n第三段\n第四段",
          }
        : event,
    );

    view.rerender(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={updatedViewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    expect(scrollToSpy).toHaveBeenCalledWith({ top: 720, behavior: "auto" });
  });

  it("only auto-expands the latest running reasoning item", () => {
    const viewModel = createViewModel();
    viewModel.timeline.push({
      eventId: "reasoning:reason-older",
      turnId: "turn-2",
      turnIndex: 2,
      threadId: "root-thread",
      threadName: "Root session",
      sessionRole: "root",
      relationshipSource: "directParent",
      kind: "reasoning",
      occurredAt: 3,
      summary: "Thinking · older reasoning should stay collapsed",
      status: "running",
      reasoningPreview: "older reasoning",
    });

    render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={viewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /activityPanel\.tabs\.reasoning2/i }));

    const latestReasoningCard = screen
      .getByRole("button", { name: /Thinking · compare recent panel states/i })
      .closest(".session-activity-event-reasoning");
    const olderReasoningCard = screen
      .getByRole("button", { name: /Thinking · older reasoning should stay collapsed/i })
      .closest(".session-activity-event-reasoning");

    expect(latestReasoningCard?.classList.contains("is-expanded")).toBe(true);
    expect(olderReasoningCard?.classList.contains("is-expanded")).toBe(false);
  });

  it("auto-collapses reasoning 1s after completion", () => {
    vi.useFakeTimers();
    const { container, rerender } = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={createViewModel()}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    expect(container.querySelector(".session-activity-event-reasoning.is-expanded")).toBeTruthy();

    const completedViewModel = createViewModel();
    completedViewModel.isProcessing = false;
    completedViewModel.emptyState = "completed";
    completedViewModel.timeline = completedViewModel.timeline.map((event) =>
      event.kind === "reasoning"
        ? {
            ...event,
            status: "completed" as const,
            reasoningPreview: `${event.reasoningPreview}\nDone`,
          }
        : event,
    );

    rerender(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={completedViewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    expect(container.querySelector(".session-activity-event-reasoning.is-expanded")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(container.querySelector(".session-activity-event-reasoning.is-expanded")).toBeNull();
    vi.useRealTimers();
  });

  it("uses command card click to expand and collapse inline output", () => {
    const view = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={createViewModel()}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    expect(getPreviewTextForKind(view.container, "command")?.textContent).toBe(
      "stderr line\nstdout tail",
    );
    expect(
      getEventNode(view.container, "command")?.querySelector(".session-activity-card-title")
        ?.textContent,
    ).toBe(
      "Run focused test suite",
    );
    expect(view.container.querySelector(".session-activity-command-value")?.textContent).toContain(
      "pnpm vitest --runInBand",
    );
    expect(view.container.querySelector(".session-activity-command-copy")).toBeNull();
    const expandedHeaderCopy = view.container.querySelector(
      ".session-activity-event-command.is-expanded .session-activity-card-copy",
    );
    expect(expandedHeaderCopy).toBeTruthy();
    expect(expandedHeaderCopy?.textContent).toContain("Run focused test suite");
    expect(expandedHeaderCopy?.textContent).toContain("activityPanel.status.running");
    expect(screen.queryByText("activityPanel.hideOutput")).toBeNull();
    expect(screen.queryByText("activityPanel.showOutput")).toBeNull();

    const previewToggle = getPreviewToggleForKind(view.container, "command");
    expect(previewToggle).toBeTruthy();
    if (!previewToggle) {
      return;
    }
    fireEvent.click(previewToggle);
    expect(getPreviewTextForKind(view.container, "command")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Run focused test suite/i }));
    const previewText = getPreviewTextForKind(view.container, "command");
    expect(previewText?.textContent).toBe("stderr line\nstdout tail");

    fireEvent.click(screen.getByRole("button", { name: /Run focused test suite/i }));
    expect(getPreviewTextForKind(view.container, "command")).toBeNull();
  });

  it("falls back to command text when command description is missing", () => {
    const viewModel = createViewModel();
    viewModel.timeline = viewModel.timeline.map((event) =>
      event.kind === "command"
        ? {
            ...event,
            commandDescription: "",
          }
        : event,
    );

    const view = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={viewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    expect(
      getEventNode(view.container, "command")?.querySelector(".session-activity-card-title")
        ?.textContent,
    ).toBe("activityPanel.commandCategories.test · pnpm vitest --runInBand");
  });

  it("normalizes wrapped shell command and adds category in collapsed command title", () => {
    const viewModel = createViewModel();
    viewModel.timeline = viewModel.timeline.map((event) =>
      event.kind === "command"
        ? {
            ...event,
            commandDescription: "",
            commandText:
              "/bin/zsh -lc \"zsh -lc 'source ~/.zshrc && rg -n \\\"TODO\\\" src'\"",
          }
        : event,
    );

    const view = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={viewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    expect(
      getEventNode(view.container, "command")?.querySelector(".session-activity-card-title")
        ?.textContent,
    ).toBe("activityPanel.commandCategories.search · rg -n \\\"TODO\\\" src");
  });

  it("auto-collapses running commands 1s after completion", () => {
    vi.useFakeTimers();
    const { container, rerender } = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={createViewModel()}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    expect(container.querySelector(".session-activity-event-command.is-expanded")).toBeTruthy();

    const completedViewModel = createViewModel();
    completedViewModel.isProcessing = false;
    completedViewModel.emptyState = "completed";
    completedViewModel.timeline = completedViewModel.timeline.map((event) =>
      event.kind === "command"
        ? {
            ...event,
            status: "completed" as const,
            commandPreview: "stderr line\nstdout tail\nDone",
          }
        : event,
    );

    rerender(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={completedViewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    expect(container.querySelector(".session-activity-event-command.is-expanded")).toBeTruthy();
    expect(getPreviewTextForKind(container, "command")?.textContent).toBe(
      "stderr line\nstdout tail\nDone",
    );

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(container.querySelector(".session-activity-event-command.is-expanded")).toBeNull();
    expect(getPreviewTextForKind(container, "command")).toBeNull();
    vi.useRealTimers();
  });

  it("allows manually expanding a completed command after auto-collapse", () => {
    const completedViewModel = createViewModel();
    completedViewModel.isProcessing = false;
    completedViewModel.emptyState = "completed";
    completedViewModel.timeline = completedViewModel.timeline.map((event) =>
      event.kind === "command"
        ? {
            ...event,
            status: "completed" as const,
            commandPreview: "stderr line\nstdout tail\nDone",
          }
        : event,
    );

    const { container } = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={completedViewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    expect(container.querySelector(".session-activity-event-command.is-expanded")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Run focused test suite/i }));

    expect(container.querySelector(".session-activity-event-command.is-expanded")).toBeTruthy();
    expect(getPreviewTextForKind(container, "command")?.textContent).toBe(
      "stderr line\nstdout tail\nDone",
    );
  });

  it("keeps expanded running commands live even before output arrives", () => {
    const waitingViewModel = createViewModel();
    waitingViewModel.timeline = waitingViewModel.timeline.map((event) =>
      event.kind === "command"
        ? {
            ...event,
            commandPreview: "",
            commandText: "",
            commandDescription: "",
            commandWorkingDirectory: "",
          }
        : event,
    );

    const view = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={waitingViewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    expect(getPreviewTextForKind(view.container, "command")?.textContent).toContain(
      "activityPanel.waitingForOutput",
    );
    expect(
      getEventNode(view.container, "command")?.querySelector(".session-activity-card-title")
        ?.textContent,
    ).toBe(
      "activityPanel.commandPendingSummary",
    );

    const updatedViewModel = createViewModel();
    updatedViewModel.timeline = updatedViewModel.timeline.map((event) =>
      event.kind === "command"
        ? {
            ...event,
            commandPreview: "line 1\nline 2",
            commandText: "",
            commandDescription: "",
            commandWorkingDirectory: "",
          }
        : event,
    );

    view.rerender(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={updatedViewModel}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    expect(getPreviewTextForKind(view.container, "command")?.textContent).toBe(
      "line 1\nline 2",
    );
  });

  it("uses session pills to jump directly to a related thread", () => {
    const onSelectThread = vi.fn();

    const view = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={createViewModel()}
        onOpenDiffPath={vi.fn()}
        onSelectThread={onSelectThread}
      />,
    );

    const sessionPills = view.container.querySelectorAll(".session-activity-session-pill");
    expect(sessionPills).toHaveLength(1);
    expect(sessionPills[0]?.textContent).toContain("Child session");
    expect(sessionPills[0]?.textContent).toContain("activityPanel.fallbackLinking");
    fireEvent.click(sessionPills[0] as HTMLButtonElement);
    expect(onSelectThread).toHaveBeenCalledWith("workspace-1", "child-thread");
  });

  it("renders a time label for each activity item", () => {
    const view = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={createViewModel()}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    const timeLabels = view.container.querySelectorAll(".session-activity-card-time");
    expect(timeLabels).toHaveLength(5);
    for (const label of timeLabels) {
      expect(label.textContent).toMatch(/\d{2}:\d{2}:\d{2}/);
    }
  });

  it("filters activity list by tab kind", () => {
    const view = render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={createViewModel()}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
      />,
    );

    expect(view.container.querySelectorAll(".session-activity-event")).toHaveLength(5);
    fireEvent.click(screen.getByRole("tab", { name: /activityPanel\.tabs\.file/i }));
    expect(view.container.querySelectorAll(".session-activity-event")).toHaveLength(1);
    expect(view.container.querySelector(".session-activity-event-fileChange")).toBeTruthy();
    expect(view.container.querySelector(".session-activity-event-command")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /activityPanel\.tabs\.explore/i }));
    expect(view.container.querySelectorAll(".session-activity-event")).toHaveLength(1);
    expect(view.container.querySelector(".session-activity-event-explore")).toBeTruthy();
    expect(view.container.querySelector(".session-activity-event-task")).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: /activityPanel\.tabs\.reasoning/i }));
    expect(view.container.querySelectorAll(".session-activity-event")).toHaveLength(1);
    expect(view.container.querySelector(".session-activity-event-reasoning")).toBeTruthy();
  });

  it("renders an explicit live edit preview toggle when provided", () => {
    const onToggleLiveEditPreview = vi.fn();

    render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={createViewModel()}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
        liveEditPreviewEnabled
        onToggleLiveEditPreview={onToggleLiveEditPreview}
      />,
    );

    const toggle = screen.getByRole("button", { name: "activityPanel.liveEditPreview" });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(toggle.className).toContain("session-activity-live-edit-toggle");
    expect(toggle.className).toContain("is-active");
    expect(toggle.getAttribute("title")).toBe("activityPanel.disableLiveEditPreview");
    fireEvent.click(toggle);
    expect(onToggleLiveEditPreview).toHaveBeenCalledTimes(1);
  });

  it("keeps live edit preview toggle in inactive state by default", () => {
    const onToggleLiveEditPreview = vi.fn();

    render(
      <WorkspaceSessionActivityPanel
        workspaceId="workspace-1"
        viewModel={createViewModel()}
        onOpenDiffPath={vi.fn()}
        onSelectThread={vi.fn()}
        liveEditPreviewEnabled={false}
        onToggleLiveEditPreview={onToggleLiveEditPreview}
      />,
    );

    const toggle = screen.getByRole("button", { name: "activityPanel.liveEditPreview" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(toggle.className).toContain("session-activity-live-edit-toggle");
    expect(toggle.className).not.toContain("is-active");
    expect(toggle.getAttribute("title")).toBe("activityPanel.enableLiveEditPreview");
    fireEvent.click(toggle);
    expect(onToggleLiveEditPreview).toHaveBeenCalledTimes(1);
  });
});
