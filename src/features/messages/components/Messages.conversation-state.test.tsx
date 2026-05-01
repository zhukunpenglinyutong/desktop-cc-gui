// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationItem, RequestUserInputRequest } from "../../../types";
import { Messages } from "./Messages";

describe("Messages conversationState routing", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    window.localStorage.setItem("ccgui.claude.hideReasoningModule", "0");
    window.localStorage.removeItem("ccgui.messages.live.autoFollow");
    window.localStorage.removeItem("ccgui.messages.live.collapseMiddleSteps");
  });

  beforeAll(() => {
    if (!HTMLElement.prototype.scrollIntoView) {
      HTMLElement.prototype.scrollIntoView = vi.fn();
    }
    if (!HTMLElement.prototype.scrollTo) {
      HTMLElement.prototype.scrollTo = vi.fn();
    }
  });

  it("uses conversationState as single source for thread-scoped user input queue", () => {
    const request: RequestUserInputRequest = {
      workspace_id: "ws-state",
      request_id: 7,
      params: {
        thread_id: "thread-from-state",
        turn_id: "turn-1",
        item_id: "item-1",
        questions: [
          {
            id: "q1",
            header: "Confirm",
            question: "Proceed with profile?",
            options: [{ label: "Yes", description: "Continue." }],
          },
        ],
      },
    };

    render(
      <Messages
        items={[]}
        threadId="legacy-thread"
        workspaceId="legacy-ws"
        isThinking={false}
        userInputRequests={[]}
        onUserInputSubmit={vi.fn()}
        conversationState={{
          items: [],
          plan: null,
          userInputQueue: [request],
          meta: {
            workspaceId: "ws-state",
            threadId: "thread-from-state",
            engine: "codex",
            activeTurnId: null,
            isThinking: false,
            heartbeatPulse: null,
            historyRestoredAtMs: null,
          },
        }}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(screen.getByText("Proceed with profile?")).toBeTruthy();
  });

  it("keeps user-input request inline disabled for non-codex/non-claude engines", () => {
    const request: RequestUserInputRequest = {
      workspace_id: "ws-state",
      request_id: 9,
      params: {
        thread_id: "thread-from-state",
        turn_id: "turn-9",
        item_id: "item-9",
        questions: [
          {
            id: "q9",
            header: "Confirm",
            question: "Should stay hidden on opencode",
            options: [{ label: "Yes", description: "Continue." }],
          },
        ],
      },
    };

    render(
      <Messages
        items={[]}
        threadId="thread-from-state"
        workspaceId="ws-state"
        isThinking={false}
        userInputRequests={[request]}
        onUserInputSubmit={vi.fn()}
        activeEngine="opencode"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(screen.queryByText("Should stay hidden on opencode")).toBeNull();
  });

  it("renders user-input request inline for claude engine", () => {
    const request: RequestUserInputRequest = {
      workspace_id: "ws-state",
      request_id: 10,
      params: {
        thread_id: "thread-from-state",
        turn_id: "turn-10",
        item_id: "item-10",
        questions: [
          {
            id: "q10",
            header: "Confirm",
            question: "Should render on claude",
            options: [{ label: "Yes", description: "Continue." }],
          },
        ],
      },
    };

    render(
      <Messages
        items={[]}
        threadId="thread-from-state"
        workspaceId="ws-state"
        isThinking={false}
        userInputRequests={[request]}
        onUserInputSubmit={vi.fn()}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(screen.getByText("Should render on claude")).toBeTruthy();
  });

  it("uses conversationState items when rendering grouped edit tools", () => {
    const legacyPlan = {
      turnId: "turn-legacy",
      explanation: "Legacy plan",
      steps: [{ step: "Legacy step", status: "pending" as const }],
    };
    const statePlan = {
      turnId: "turn-state",
      explanation: "State plan",
      steps: [{ step: "State step", status: "inProgress" as const }],
    };
    const stateItems: ConversationItem[] = [
      {
        id: "edit-1",
        kind: "tool",
        toolType: "edit",
        title: "Tool: edit",
        detail: JSON.stringify({
          file_path: "src/a.ts",
          old_string: "a",
          new_string: "b",
        }),
        status: "completed",
      },
      {
        id: "edit-2",
        kind: "tool",
        toolType: "edit",
        title: "Tool: edit",
        detail: JSON.stringify({
          file_path: "src/b.ts",
          old_string: "c",
          new_string: "d",
        }),
        status: "completed",
      },
    ];

    render(
      <Messages
        items={[]}
        threadId="legacy-thread"
        workspaceId="legacy-ws"
        isThinking={false}
        plan={legacyPlan}
        conversationState={{
          items: stateItems,
          plan: statePlan,
          userInputQueue: [],
          meta: {
            workspaceId: "ws-state",
            threadId: "thread-state",
            engine: "codex",
            activeTurnId: null,
            isThinking: false,
            heartbeatPulse: null,
            historyRestoredAtMs: null,
          },
        }}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(screen.getByText("a.ts")).toBeTruthy();
    expect(screen.getByText("b.ts")).toBeTruthy();
    expect(screen.queryByText("Legacy step")).toBeNull();
  });

  it("does not render plan quick view in chat canvas even when plan data exists", () => {
    render(
      <Messages
        items={[]}
        threadId="thread-plan"
        workspaceId="ws-plan"
        isThinking={false}
        conversationState={{
          items: [],
          plan: {
            turnId: "turn-plan",
            explanation: "Panel plan",
            steps: [{ step: "Open panel", status: "pending" }],
          },
          userInputQueue: [],
          meta: {
            workspaceId: "ws-plan",
            threadId: "thread-plan",
            engine: "codex",
            activeTurnId: null,
            isThinking: false,
            heartbeatPulse: null,
            historyRestoredAtMs: null,
          },
        }}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(screen.queryByRole("button", { name: "Plan" })).toBeNull();
    expect(screen.queryByText("Open panel")).toBeNull();
  });

  it("prefers conversationState items for codex when state and legacy point to the same thread", () => {
    const legacyItems: ConversationItem[] = [
      {
        id: "assistant-legacy-codex-1",
        kind: "message",
        role: "assistant",
        text: "LEGACY-CODEX",
      },
    ];
    const stateItems: ConversationItem[] = [
      {
        id: "assistant-state-codex-1",
        kind: "message",
        role: "assistant",
        text: "STATE-CODEX",
      },
    ];

    render(
      <Messages
        items={legacyItems}
        threadId="codex:thread-1"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="codex"
        conversationState={{
          items: stateItems,
          plan: null,
          userInputQueue: [],
          meta: {
            workspaceId: "ws-1",
            threadId: "codex:thread-1",
            engine: "codex",
            activeTurnId: null,
            isThinking: false,
            heartbeatPulse: null,
            historyRestoredAtMs: null,
          },
        }}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(screen.getByText("STATE-CODEX")).toBeTruthy();
    expect(screen.queryByText("LEGACY-CODEX")).toBeNull();
  });

  it("prefers conversationState items for claude when state and legacy point to the same thread", () => {
    const legacyItems: ConversationItem[] = [
      {
        id: "assistant-legacy-claude-1",
        kind: "message",
        role: "assistant",
        text: "LEGACY-CLAUDE",
      },
    ];
    const stateItems: ConversationItem[] = [
      {
        id: "assistant-state-claude-1",
        kind: "message",
        role: "assistant",
        text: "STATE-CLAUDE",
      },
    ];

    render(
      <Messages
        items={legacyItems}
        threadId="claude:thread-1"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="claude"
        conversationState={{
          items: stateItems,
          plan: null,
          userInputQueue: [],
          meta: {
            workspaceId: "ws-1",
            threadId: "claude:thread-1",
            engine: "claude",
            activeTurnId: null,
            isThinking: false,
            heartbeatPulse: null,
            historyRestoredAtMs: null,
          },
        }}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(screen.getByText("STATE-CLAUDE")).toBeTruthy();
    expect(screen.queryByText("LEGACY-CLAUDE")).toBeNull();
  });

  it("uses conversationState engine as routing source when activeEngine prop is omitted", () => {
    const legacyItems: ConversationItem[] = [
      {
        id: "assistant-legacy-codex-2",
        kind: "message",
        role: "assistant",
        text: "LEGACY-CODEX-DEFAULT",
      },
    ];
    const stateItems: ConversationItem[] = [
      {
        id: "assistant-state-codex-2",
        kind: "message",
        role: "assistant",
        text: "STATE-CODEX-DEFAULT",
      },
    ];

    render(
      <Messages
        items={legacyItems}
        threadId="codex:thread-2"
        workspaceId="ws-1"
        isThinking={false}
        conversationState={{
          items: stateItems,
          plan: null,
          userInputQueue: [],
          meta: {
            workspaceId: "ws-1",
            threadId: "codex:thread-2",
            engine: "codex",
            activeTurnId: null,
            isThinking: false,
            heartbeatPulse: null,
            historyRestoredAtMs: null,
          },
        }}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(screen.getByText("STATE-CODEX-DEFAULT")).toBeTruthy();
    expect(screen.queryByText("LEGACY-CODEX-DEFAULT")).toBeNull();
  });

  it("respects gemini routing from conversationState when activeEngine prop is omitted", () => {
    const legacyItems: ConversationItem[] = [
      {
        id: "assistant-legacy-gemini-1",
        kind: "message",
        role: "assistant",
        text: "LEGACY-GEMINI-DEFAULT",
      },
    ];
    const stateItems: ConversationItem[] = [
      {
        id: "assistant-state-gemini-1",
        kind: "message",
        role: "assistant",
        text: "PLAN\n\nSTATE-GEMINI-DEFAULT",
      },
    ];

    const { container } = render(
      <Messages
        items={legacyItems}
        threadId="gemini:thread-1"
        workspaceId="ws-1"
        isThinking={false}
        conversationState={{
          items: stateItems,
          plan: null,
          userInputQueue: [],
          meta: {
            workspaceId: "ws-1",
            threadId: "gemini:thread-1",
            engine: "gemini",
            activeTurnId: null,
            isThinking: false,
            heartbeatPulse: null,
            historyRestoredAtMs: null,
          },
        }}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.textContent ?? "").toContain("STATE-GEMINI-DEFAULT");
    expect(container.textContent ?? "").not.toContain("LEGACY-GEMINI-DEFAULT");
    expect(container.querySelector(".markdown-codex-canvas")).toBeNull();
  });
});
