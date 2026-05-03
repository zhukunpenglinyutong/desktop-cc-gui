// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConversationItem, TurnPlan } from "../../../types";
import { StatusPanel } from "./StatusPanel";

const editToolItem: Extract<ConversationItem, { kind: "tool" }> = {
  id: "tool-edit-1",
  kind: "tool",
  toolType: "edit",
  title: "Edit file",
  detail: '{"path":"README.md"}',
  status: "completed",
  changes: [
    { path: "README.md", kind: "modify" },
    { path: "docs/EXECUTION_PLAN.md", kind: "modify" },
  ],
};

const taskToolItem: Extract<ConversationItem, { kind: "tool" }> = {
  id: "tool-task-1",
  kind: "tool",
  toolType: "task",
  title: "Tool: task",
  detail: '{"description":"review plan"}',
  status: "completed",
  output: "done",
};

const claudeAgentToolItem: Extract<ConversationItem, { kind: "tool" }> = {
  id: "call_fa8bd06e774141c4a7f29a79",
  kind: "tool",
  toolType: "agent",
  title: "Tool: Agent",
  detail: '{"description":"Bug诊断与性能安全审查","subagent_type":"java-performance-engineer","taskId":"af452b1b615f93a9e"}',
  status: "completed",
  output: "done",
};

const collabSpawnToolItem: Extract<ConversationItem, { kind: "tool" }> = {
  id: "spawn-1",
  kind: "tool",
  toolType: "collabToolCall",
  title: "Collab: spawn_agent",
  detail: "From thread-root → agent-7",
  status: "completed",
  output: "Audit current panel",
  receiverThreadIds: ["agent-7"],
};

const collabWaitToolItem: Extract<ConversationItem, { kind: "tool" }> = {
  id: "wait-1",
  kind: "tool",
  toolType: "collabToolCall",
  title: "Collab: wait",
  detail: "From thread-root → agent-7",
  status: "completed",
  output: "Audit current panel\n\nagent-7: completed",
  receiverThreadIds: ["agent-7"],
  agentStatus: {
    "agent-7": { status: "completed" },
  },
};

const planSample: TurnPlan = {
  turnId: "turn-1",
  explanation: "plan",
  steps: [
    { step: "step 1", status: "completed" },
    { step: "step 2", status: "pending" },
  ],
};

const inProgressPlan: TurnPlan = {
  turnId: "turn-2",
  explanation: "plan",
  steps: [{ step: "step in progress", status: "inProgress" }],
};

const latestUserMessageItems: ConversationItem[] = [
  {
    id: "u1",
    kind: "message",
    role: "user",
    text: "第一条消息\n第二行\n第三行\n第四行\n第五行",
    images: ["diagram.png", "bug.png"],
  },
  {
    id: "a1",
    kind: "message",
    role: "assistant",
    text: "assistant",
  },
  {
    id: "u2",
    kind: "message",
    role: "user",
    text: "第二条用户消息",
  },
];

describe("StatusPanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("opens diff when clicking file in edits popover and closes popover", () => {
    const onOpenDiffPath = vi.fn();
    render(
      <StatusPanel
        items={[editToolItem]}
        isProcessing={false}
        onOpenDiffPath={onOpenDiffPath}
      />,
    );

    fireEvent.click(screen.getByText("statusPanel.tabEdits"));
    fireEvent.click(screen.getByText("README.md"));

    expect(onOpenDiffPath).toHaveBeenCalledWith("README.md");
    expect(screen.queryByText("docs/EXECUTION_PLAN.md")).toBeNull();
  });

  it("shows plan tab with progress summary", () => {
    render(
      <StatusPanel
        items={[editToolItem]}
        isProcessing={false}
        plan={planSample}
        isPlanMode
      />,
    );

    expect(screen.getByText("Plan")).toBeTruthy();
    expect(screen.getByText("1/2")).toBeTruthy();
  });

  it("closes opened popover by Escape key", () => {
    render(
      <StatusPanel
        items={[editToolItem]}
        isProcessing={false}
      />,
    );

    fireEvent.click(screen.getByText("statusPanel.tabEdits"));
    expect(screen.getByText("README.md")).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("README.md")).toBeNull();
  });

  it("does not render when expanded is false", () => {
    const { container } = render(
      <StatusPanel
        items={[editToolItem]}
        isProcessing={false}
        expanded={false}
      />,
    );
    expect(container.querySelector(".sp-root")).toBeNull();
  });

  it("shows legacy tabs when expanded even without status data", () => {
    render(
      <StatusPanel
        items={[]}
        isProcessing={false}
      />,
    );
    expect(screen.getByText("statusPanel.tabTodos")).toBeTruthy();
    expect(screen.getByText("statusPanel.tabSubagents")).toBeTruthy();
    expect(screen.getByText("statusPanel.tabEdits")).toBeTruthy();
  });

  it("shows legacy tabs and plan together without half split", () => {
    render(
      <StatusPanel
        items={[editToolItem]}
        isProcessing={false}
        plan={planSample}
        isPlanMode
      />,
    );
    expect(screen.getByText("statusPanel.tabTodos")).toBeTruthy();
    expect(screen.getByText("statusPanel.tabSubagents")).toBeTruthy();
    const editTab = screen.getByText("statusPanel.tabEdits").closest("button");
    const planTab = screen.getByText("Plan").closest("button");
    expect(editTab?.className).not.toContain("sp-tab-half");
    expect(planTab?.className).not.toContain("sp-tab-half");

    fireEvent.click(screen.getByText("statusPanel.tabEdits"));
    expect(screen.getByText("README.md")).toBeTruthy();
    fireEvent.click(screen.getByText("statusPanel.tabEdits"));
    expect(screen.queryByText("README.md")).toBeNull();
  });

  it("shows codex activity tabs without inline plan tab", () => {
    render(
      <StatusPanel
        items={[editToolItem, taskToolItem]}
        isProcessing={false}
        plan={planSample}
        isPlanMode
        isCodexEngine
      />,
    );

    expect(screen.getByText("statusPanel.tabTodos")).toBeTruthy();
    expect(screen.getByText("1/2")).toBeTruthy();
    expect(screen.getByText("statusPanel.tabAgents")).toBeTruthy();
    expect(screen.getByText("statusPanel.tabEdits")).toBeTruthy();
    expect(screen.queryByText("Plan")).toBeNull();
    const allTabs = document.querySelectorAll(".sp-tab-half");
    expect(allTabs.length).toBe(0);
  });

  it("renders dock variant with plan tab selected by default", () => {
    render(
      <StatusPanel
        items={[editToolItem]}
        isProcessing={false}
        plan={planSample}
        isPlanMode
        variant="dock"
      />,
    );

    const dockRoot = document.querySelector(".sp-root--dock");
    expect(dockRoot).toBeTruthy();
    expect(screen.getByText("Plan")).toBeTruthy();
    expect(screen.getByText("plan")).toBeTruthy();
    expect(screen.getByText("step 1")).toBeTruthy();
  });

  it("shows latest user message tab only in dock variant", () => {
    const { rerender } = render(
      <StatusPanel
        items={latestUserMessageItems}
        isProcessing={false}
        variant="dock"
      />,
    );

    expect(screen.getByText("User Conversation")).toBeTruthy();

    rerender(
      <StatusPanel
        items={latestUserMessageItems}
        isProcessing={false}
      />,
    );

    expect(screen.queryByText("User Conversation")).toBeNull();
  });

  it("renders latest user message tab for codex dock threads without selecting it by default", () => {
    render(
      <StatusPanel
        items={latestUserMessageItems}
        isProcessing={false}
        variant="dock"
        isCodexEngine
      />,
    );

    expect(screen.getByText("User Conversation")).toBeTruthy();
    expect(screen.queryByText("Images: 2")).toBeNull();
  });

  it("keeps latest user message tab after edits for both codex and non-codex dock layouts", () => {
    const { rerender } = render(
      <StatusPanel
        items={latestUserMessageItems}
        isProcessing={false}
        variant="dock"
      />,
    );

    let labels = Array.from(document.querySelectorAll(".sp-tabs--dock .sp-tab-label")).map(
      (node) => node.textContent,
    );
    expect(labels).toEqual([
      "statusPanel.tabTodos",
      "statusPanel.tabSubagents",
      "statusPanel.tabEdits",
      "User Conversation",
    ]);

    rerender(
      <StatusPanel
        items={latestUserMessageItems}
        isProcessing={false}
        variant="dock"
        isCodexEngine
      />,
    );

    labels = Array.from(document.querySelectorAll(".sp-tabs--dock .sp-tab-label")).map(
      (node) => node.textContent,
    );
    expect(labels).toEqual([
      "statusPanel.tabTodos",
      "statusPanel.tabAgents",
      "statusPanel.tabEdits",
      "User Conversation",
    ]);
  });

  it("removes hidden dock tabs without clearing available panel data", () => {
    render(
      <StatusPanel
        items={[...latestUserMessageItems, editToolItem]}
        isProcessing={false}
        variant="dock"
        visibleDockTabs={{
          subagent: false,
          files: false,
          latestUserMessage: false,
        }}
      />,
    );

    const labels = Array.from(document.querySelectorAll(".sp-tabs--dock .sp-tab-label")).map(
      (node) => node.textContent,
    );
    expect(labels).toEqual(["statusPanel.tabTodos"]);
    expect(screen.queryByText("statusPanel.tabEdits")).toBeNull();
    expect(screen.queryByText("User Conversation")).toBeNull();
  });

  it("shows user conversation timeline in reverse chronological order with image summary", () => {
    render(
      <StatusPanel
        items={latestUserMessageItems}
        isProcessing={false}
        variant="dock"
      />,
    );

    fireEvent.click(screen.getByText("User Conversation"));

    const renderedMessages = screen.getAllByText(/用户消息|第一条消息/).map((node) => node.textContent);
    expect(renderedMessages[0]).toContain("第二条用户消息");
    expect(renderedMessages[1]).toContain("第一条消息");
    expect(screen.getByText("Images: 2")).toBeTruthy();
    expect(screen.getByText("Newest to oldest 1/2")).toBeTruthy();
    expect(screen.getByText("Original order #2")).toBeTruthy();
    expect(screen.getByText("Expand")).toBeTruthy();
  });

  it("keeps the current dock tab active when a new user message arrives", () => {
    const { rerender } = render(
      <StatusPanel
        items={latestUserMessageItems}
        isProcessing={false}
        variant="dock"
      />,
    );

    fireEvent.click(screen.getByText("statusPanel.tabEdits"));
    expect(screen.getByText("statusPanel.tabEdits").closest("button")?.className).toContain(
      "sp-tab-active",
    );

    rerender(
      <StatusPanel
        items={[
          ...latestUserMessageItems,
          {
            id: "u3",
            kind: "message",
            role: "user",
            text: "新的问题",
          },
        ]}
        isProcessing={false}
        variant="dock"
      />,
    );

    expect(screen.getByText("statusPanel.tabEdits").closest("button")?.className).toContain(
      "sp-tab-active",
    );
    expect(screen.queryByText("新的问题")).toBeNull();
  });

  it("updates latest user message preview when thread items change", () => {
    const { rerender } = render(
      <StatusPanel
        items={latestUserMessageItems}
        isProcessing={false}
        variant="dock"
      />,
    );

    fireEvent.click(screen.getByText("User Conversation"));
    expect(screen.getByText(/第一条消息/)).toBeTruthy();
    expect(screen.getByText("第二条用户消息")).toBeTruthy();

    rerender(
      <StatusPanel
        items={[
          {
            id: "u-thread-2",
            kind: "message",
            role: "user",
            text: "thread 2 latest",
          },
        ]}
        isProcessing={false}
        variant="dock"
      />,
    );

    expect(screen.getByText("thread 2 latest")).toBeTruthy();
    expect(screen.queryByText(/第一条消息/)).toBeNull();
  });

  it("emits message jump when clicking a user conversation timeline item action", () => {
    const onJumpToConversationMessage = vi.fn();

    render(
      <StatusPanel
        items={latestUserMessageItems}
        isProcessing={false}
        variant="dock"
        onJumpToConversationMessage={onJumpToConversationMessage}
      />,
    );

    fireEvent.click(screen.getByText("User Conversation"));
    fireEvent.click(screen.getAllByText("Jump to message")[0]);

    expect(onJumpToConversationMessage).toHaveBeenCalledWith("u2");
  });

  it("keeps dock tab content visible when clicking the active tab again", () => {
    render(
      <StatusPanel
        items={[editToolItem]}
        isProcessing={false}
        plan={planSample}
        isPlanMode
        variant="dock"
      />,
    );

    fireEvent.click(screen.getByText("statusPanel.tabEdits"));
    expect(screen.getByText("README.md")).toBeTruthy();
    fireEvent.click(screen.getByText("statusPanel.tabEdits"));
    expect(screen.getByText("README.md")).toBeTruthy();
  });

  it("hides dock plan tab for codex threads and keeps plan steps in todo", () => {
    render(
      <StatusPanel
        items={[taskToolItem]}
        isProcessing={false}
        plan={planSample}
        isPlanMode
        isCodexEngine
        variant="dock"
      />,
    );

    expect(screen.queryByText("Plan")).toBeNull();
    expect(screen.getByText("statusPanel.tabTodos")).toBeTruthy();
    expect(screen.getByText("step 1")).toBeTruthy();
    expect(screen.getByText("step 2")).toBeTruthy();
  });

  it("keeps codex status panel visible even when only plan data exists", () => {
    render(
      <StatusPanel
        items={[]}
        isProcessing={false}
        plan={planSample}
        isPlanMode={false}
        isCodexEngine
      />,
    );

    expect(screen.getByText("statusPanel.tabTodos")).toBeTruthy();
    expect(screen.getByText("statusPanel.tabAgents")).toBeTruthy();
    expect(screen.getByText("statusPanel.tabEdits")).toBeTruthy();
    expect(screen.queryByText("Plan")).toBeNull();
  });

  it("renders plan steps inside codex todo tab", () => {
    render(
      <StatusPanel
        items={[]}
        isProcessing={false}
        plan={planSample}
        isPlanMode={false}
        isCodexEngine
      />,
    );

    fireEvent.click(screen.getByText("statusPanel.tabTodos"));
    expect(screen.getByText("step 1")).toBeTruthy();
    expect(screen.getByText("step 2")).toBeTruthy();
  });

  it("shows zero-state codex tabs when there is no status data", () => {
    render(
      <StatusPanel
        items={[]}
        isProcessing={false}
        isCodexEngine
      />,
    );

    expect(screen.getByText("statusPanel.tabTodos")).toBeTruthy();
    expect(screen.getAllByText("0/0").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("statusPanel.tabAgents")).toBeTruthy();
    expect(screen.getByText("statusPanel.tabEdits")).toBeTruthy();
  });

  it("aggregates collab agents from the current root subtree", () => {
    render(
      <StatusPanel
        items={[]}
        isProcessing={true}
        isCodexEngine
        activeThreadId="agent-7"
        itemsByThread={{
          "thread-root": [collabSpawnToolItem],
          "agent-7": [],
        }}
        threadParentById={{ "agent-7": "thread-root" }}
        threadStatusById={{ "agent-7": { isProcessing: true } }}
      />,
    );

    expect(screen.getByText("0/1")).toBeTruthy();
    fireEvent.click(screen.getByText("statusPanel.tabAgents"));
    expect(screen.getByText("agent-7")).toBeTruthy();
    expect(screen.getByText("Audit current panel")).toBeTruthy();
  });

  it("does not mark idle child threads as completed without wait facts", () => {
    const { container } = render(
      <StatusPanel
        items={[]}
        isProcessing={false}
        isCodexEngine
        activeThreadId="thread-root"
        itemsByThread={{
          "thread-root": [collabSpawnToolItem],
          "agent-7": [],
        }}
        threadParentById={{ "agent-7": "thread-root" }}
        threadStatusById={{ "agent-7": { isProcessing: false } }}
      />,
    );

    expect(screen.getByText("0/1")).toBeTruthy();
    fireEvent.click(screen.getByText("statusPanel.tabAgents"));
    expect(screen.getByText("agent-7")).toBeTruthy();
    expect(container.querySelector(".sp-subagent-running")).toBeTruthy();
  });

  it("settles idle child threads with historical assistant output as completed", () => {
    const { container } = render(
      <StatusPanel
        items={[]}
        isProcessing={false}
        isCodexEngine
        activeThreadId="thread-root"
        itemsByThread={{
          "thread-root": [collabSpawnToolItem],
          "agent-7": [
            {
              id: "agent-7-final",
              kind: "message",
              role: "assistant",
              text: "分析完成，已整理结论。",
              isFinal: true,
            },
          ],
        }}
        threadParentById={{ "agent-7": "thread-root" }}
        threadStatusById={{ "agent-7": { isProcessing: false } }}
      />,
    );

    expect(screen.getByText("1/1")).toBeTruthy();
    fireEvent.click(screen.getByText("statusPanel.tabAgents"));
    expect(screen.getByText("agent-7")).toBeTruthy();
    expect(container.querySelector(".sp-subagent-completed")).toBeTruthy();
  });

  it("uses collab wait facts to mark agent completion", () => {
    const { container } = render(
      <StatusPanel
        items={[collabSpawnToolItem, collabWaitToolItem]}
        isProcessing={false}
        isCodexEngine
        activeThreadId="thread-root"
        itemsByThread={{
          "thread-root": [collabSpawnToolItem, collabWaitToolItem],
          "agent-7": [],
        }}
        threadParentById={{ "agent-7": "thread-root" }}
      />,
    );

    expect(screen.getByText("1/1")).toBeTruthy();
    fireEvent.click(screen.getByText("statusPanel.tabAgents"));
    expect(screen.getByText("agent-7")).toBeTruthy();
    expect(container.querySelector(".sp-subagent-completed")).toBeTruthy();
  });

  it("parses verbose text statuses without leaking them into descriptions", () => {
    const verboseWaitToolItem: Extract<ConversationItem, { kind: "tool" }> = {
      ...collabWaitToolItem,
      id: "wait-verbose-1",
      agentStatus: undefined,
      output: "Audit current panel\n\nagent-7: completed (cached after wait)",
    };

    const { container } = render(
      <StatusPanel
        items={[collabSpawnToolItem, verboseWaitToolItem]}
        isProcessing={false}
        isCodexEngine
        activeThreadId="thread-root"
        itemsByThread={{
          "thread-root": [collabSpawnToolItem, verboseWaitToolItem],
          "agent-7": [],
        }}
        threadParentById={{ "agent-7": "thread-root" }}
      />,
    );

    expect(screen.getByText("1/1")).toBeTruthy();
    fireEvent.click(screen.getByText("statusPanel.tabAgents"));
    expect(screen.getByText("Audit current panel")).toBeTruthy();
    expect(screen.queryByText("agent-7: completed (cached after wait)")).toBeNull();
    expect(container.querySelector(".sp-subagent-completed")).toBeTruthy();
  });

  it("downgrades codex in-progress plan steps when thread is idle", () => {
    const { container } = render(
      <StatusPanel
        items={[]}
        isProcessing={false}
        plan={inProgressPlan}
        isPlanMode={false}
        isCodexEngine
      />,
    );

    fireEvent.click(screen.getByText("statusPanel.tabTodos"));
    expect(screen.getByText("step in progress")).toBeTruthy();
    expect(container.querySelector(".sp-todo-in_progress")).toBeNull();
    expect(container.querySelector(".sp-todo-pending")).toBeTruthy();
  });

  it("emits codex thread navigation targets when clicking subagents", () => {
    const onSelectSubagent = vi.fn();

    render(
      <StatusPanel
        items={[collabSpawnToolItem, collabWaitToolItem]}
        isProcessing={false}
        isCodexEngine
        activeThreadId="thread-root"
        itemsByThread={{
          "thread-root": [collabSpawnToolItem, collabWaitToolItem],
          "agent-7": [],
        }}
        threadParentById={{ "agent-7": "thread-root" }}
        onSelectSubagent={onSelectSubagent}
      />,
    );

    fireEvent.click(screen.getByText("statusPanel.tabAgents"));
    fireEvent.click(screen.getByText("Audit current panel"));

    expect(onSelectSubagent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "agent-7",
        navigationTarget: {
          kind: "thread",
          threadId: "agent-7",
        },
      }),
    );
  });

  it("emits claude task navigation targets when clicking subagents", () => {
    const onSelectSubagent = vi.fn();

    render(
      <StatusPanel
        items={[claudeAgentToolItem]}
        isProcessing={false}
        onSelectSubagent={onSelectSubagent}
      />,
    );

    fireEvent.click(screen.getByText("statusPanel.tabSubagents"));
    fireEvent.click(screen.getByText("Bug诊断与性能安全审查"));

    expect(onSelectSubagent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "call_fa8bd06e774141c4a7f29a79",
        navigationTarget: {
          kind: "claude-task",
          taskId: "af452b1b615f93a9e",
          toolUseId: "call_fa8bd06e774141c4a7f29a79",
        },
      }),
    );
  });
});
