// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ConversationItem, RequestUserInputRequest } from "../../../types";
import { hydrateHistory } from "../../threads/contracts/conversationAssembler";
import { normalizeHistorySnapshot } from "../../threads/contracts/conversationCurtainContracts";
import { Messages } from "./Messages";

function createEditTool(id: string, path: string): Extract<ConversationItem, { kind: "tool" }> {
  return {
    id,
    kind: "tool",
    toolType: "edit",
    title: "Tool: edit",
    detail: JSON.stringify({
      file_path: path,
      old_string: "before",
      new_string: "after",
    }),
    status: "completed",
  };
}

function createAskUserQuestionTool(
  id: string,
): Extract<ConversationItem, { kind: "tool" }> {
  return {
    id,
    kind: "tool",
    toolType: "toolCall",
    title: "Tool: askuserquestion",
    detail: JSON.stringify({
      question: "Need confirmation",
    }),
    status: "completed",
  };
}

describe("chat canvas smoke", () => {
  beforeAll(() => {
    if (!HTMLElement.prototype.scrollIntoView) {
      HTMLElement.prototype.scrollIntoView = vi.fn();
    }
  });

  afterEach(() => {
    cleanup();
  });

  it("covers message + tool group + request user input without inline plan quick view", async () => {
    const request: RequestUserInputRequest = {
      workspace_id: "ws-1",
      request_id: "req-1",
      params: {
        thread_id: "thread-1",
        turn_id: "turn-1",
        item_id: "item-1",
        questions: [
          {
            id: "q1",
            header: "Confirm",
            question: "Proceed with apply?",
          },
        ],
      },
    };
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <Messages
        items={[]}
        threadId="thread-legacy"
        workspaceId="ws-legacy"
        isThinking={false}
        onUserInputSubmit={onSubmit}
        conversationState={{
          items: [
            {
              id: "msg-1",
              kind: "message",
              role: "user",
              text: "请继续",
            },
            createEditTool("edit-1", "src/a.ts"),
            createEditTool("edit-2", "src/b.ts"),
          ],
          plan: {
            turnId: "turn-1",
            explanation: "Smoke plan",
            steps: [{ step: "Apply patch", status: "inProgress" }],
          },
          userInputQueue: [request],
          meta: {
            workspaceId: "ws-1",
            threadId: "thread-1",
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

    expect(screen.getByText("请继续")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Plan" })).toBeNull();
    expect(screen.queryByText("Apply patch")).toBeNull();
    expect(screen.getByText("Proceed with apply?")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "approval.submit" }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(request, {
        answers: {
          q1: {
            answers: [],
          },
        },
      });
    });
  });

  it("renders hydrated history snapshot and queued question without inline plan quick view", () => {
    const snapshot = normalizeHistorySnapshot({
      engine: "codex",
      workspaceId: "ws-history",
      threadId: "thread-history",
      items: [
        {
          id: "msg-h-1",
          kind: "message",
          role: "assistant",
          text: "History restored",
        },
        createEditTool("edit-h-1", "src/history-a.ts"),
        createEditTool("edit-h-2", "src/history-b.ts"),
      ],
      plan: {
        turnId: "turn-history",
        explanation: "History plan",
        steps: [{ step: "Compare parity", status: "completed" }],
      },
      userInputQueue: [
        {
          workspace_id: "ws-history",
          request_id: "req-history",
          params: {
            thread_id: "thread-history",
            turn_id: "turn-history",
            item_id: "ask-history",
            questions: [
              {
                id: "history-confirm",
                header: "History",
                question: "Replay this step?",
              },
            ],
          },
        },
      ],
      meta: {
        workspaceId: "ws-history",
        threadId: "thread-history",
        engine: "codex",
        activeTurnId: null,
        isThinking: false,
        heartbeatPulse: null,
        historyRestoredAtMs: Date.now(),
      },
    });
    const state = hydrateHistory(snapshot);

    render(
      <Messages
        items={[]}
        threadId={null}
        workspaceId={null}
        isThinking={false}
        onUserInputSubmit={vi.fn()}
        conversationState={state}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(screen.getByText("History restored")).toBeTruthy();
    expect(screen.getByText("Replay this step?")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Plan" })).toBeNull();
    expect(screen.queryByText("Compare parity")).toBeNull();
  });

  it("keeps claude askuserquestion tool row as trace without plan-mode hint when pending request exists", () => {
    const request: RequestUserInputRequest = {
      workspace_id: "ws-claude",
      request_id: "req-claude-1",
      params: {
        thread_id: "claude:thread-1",
        turn_id: "turn-claude-1",
        item_id: "tool-ask-1",
        questions: [
          {
            id: "q-claude-1",
            header: "Confirm",
            question: "Continue on claude?",
          },
        ],
      },
    };

    render(
      <Messages
        items={[createAskUserQuestionTool("tool-ask-1")]}
        threadId="claude:thread-1"
        workspaceId="ws-claude"
        isThinking={false}
        activeEngine="claude"
        activeCollaborationModeId="code"
        onUserInputSubmit={vi.fn()}
        userInputRequests={[request]}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(screen.getByText("Continue on claude?")).toBeTruthy();
    expect(screen.queryByText("This feature requires Plan mode")).toBeNull();
  });

  it("anchors queued request input at the matching transcript item instead of the bottom", () => {
    const request: RequestUserInputRequest = {
      workspace_id: "ws-anchor",
      request_id: "req-anchor-1",
      params: {
        thread_id: "thread-anchor",
        turn_id: "turn-anchor-1",
        item_id: "ask-anchor-1",
        questions: [
          {
            id: "q-anchor-1",
            header: "Anchor",
            question: "Anchored question",
          },
        ],
      },
    };

    const { container } = render(
      <Messages
        items={[
          createAskUserQuestionTool("ask-anchor-1"),
          {
            id: "assistant-after-anchor",
            kind: "message",
            role: "assistant",
            text: "Later assistant output",
          },
        ]}
        threadId="thread-anchor"
        workspaceId="ws-anchor"
        isThinking={false}
        activeEngine="claude"
        onUserInputSubmit={vi.fn()}
        userInputRequests={[request]}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const toolNode = container.querySelector(".message-tool-block-shell");
    const inputSlot = container.querySelector(".messages-inline-user-input-slot");
    const laterMessage = screen.getByText("Later assistant output").closest("[data-message-anchor-id]");

    expect(toolNode).toBeTruthy();
    expect(inputSlot).toBeTruthy();
    expect(laterMessage).toBeTruthy();
    if (!toolNode || !inputSlot || !laterMessage) {
      throw new Error("Expected anchored request input nodes to exist");
    }
    expect(toolNode.compareDocumentPosition(inputSlot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(inputSlot.compareDocumentPosition(laterMessage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("dismisses queued request input without submitting a stale answer", () => {
    const request: RequestUserInputRequest = {
      workspace_id: "ws-close",
      request_id: "req-close-1",
      params: {
        thread_id: "thread-close",
        turn_id: "turn-close-1",
        item_id: "ask-close-1",
        questions: [
          {
            id: "q-close-1",
            header: "Closed",
            question: "This stale request should disappear",
          },
        ],
      },
    };
    const onSubmit = vi.fn();
    const onDismiss = vi.fn();
    const { rerender } = render(
      <Messages
        items={[]}
        threadId="thread-close"
        workspaceId="ws-close"
        isThinking={false}
        activeEngine="codex"
        onUserInputSubmit={onSubmit}
        onUserInputDismiss={onDismiss}
        userInputRequests={[request]}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(screen.getByText("This stale request should disappear")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close this input request card" }));

    expect(onDismiss).toHaveBeenCalledWith(request);
    expect(onSubmit).not.toHaveBeenCalled();

    rerender(
      <Messages
        items={[]}
        threadId="thread-close"
        workspaceId="ws-close"
        isThinking={false}
        activeEngine="codex"
        onUserInputSubmit={onSubmit}
        onUserInputDismiss={onDismiss}
        userInputRequests={[]}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );
    expect(screen.queryByText("This stale request should disappear")).toBeNull();
  });
});
