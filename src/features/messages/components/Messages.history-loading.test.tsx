// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestUserInputRequest } from "../../../types";
import { Messages } from "./Messages";

describe("Messages history loading", () => {
  beforeAll(() => {
    if (!HTMLElement.prototype.scrollIntoView) {
      HTMLElement.prototype.scrollIntoView = vi.fn();
    }
    if (!HTMLElement.prototype.scrollTo) {
      HTMLElement.prototype.scrollTo = vi.fn();
    }
  });

  beforeEach(() => {
    window.localStorage.setItem("ccgui.claude.hideReasoningModule", "0");
    window.localStorage.removeItem("ccgui.messages.live.autoFollow");
    window.localStorage.removeItem("ccgui.messages.live.collapseMiddleSteps");
  });

  afterEach(() => {
    cleanup();
  });

  it("shows history loading state instead of the empty thread placeholder", () => {
    render(
      <Messages
        items={[]}
        threadId="thread-codex-history-loading"
        workspaceId="ws-1"
        isThinking={false}
        isHistoryLoading
        activeEngine="codex"
        onUserInputSubmit={vi.fn()}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByText("messages.restoringHistory")).toBeTruthy();
    expect(screen.getByText("messages.restoringHistoryHint")).toBeTruthy();
    expect(screen.queryByText("messages.emptyThread")).toBeNull();
  });

  it("keeps the empty thread placeholder when history is not loading", () => {
    render(
      <Messages
        items={[]}
        threadId="thread-empty"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="codex"
        onUserInputSubmit={vi.fn()}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(screen.getByText("messages.emptyThread")).toBeTruthy();
    expect(screen.queryByText("messages.restoringHistory")).toBeNull();
  });

  it("prefers request_user_input UI over history loading when the active thread has a pending request", () => {
    const request: RequestUserInputRequest = {
      request_id: "request-1",
      workspace_id: "ws-1",
      params: {
        thread_id: "thread-with-request",
        turn_id: "turn-1",
        item_id: "item-1",
        questions: [
          {
            id: "mode",
            question: "Choose one",
            header: "Mode",
            options: [
              { label: "Quick", description: "Fast path" },
            ],
          },
        ],
      },
    };

    render(
      <Messages
        items={[]}
        threadId="thread-with-request"
        workspaceId="ws-1"
        isThinking={false}
        isHistoryLoading
        activeEngine="codex"
        userInputRequests={[request]}
        onUserInputSubmit={vi.fn()}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(screen.getByText("Choose one")).toBeTruthy();
    expect(screen.queryByText("messages.restoringHistory")).toBeNull();
    expect(screen.queryByText("messages.emptyThread")).toBeNull();
  });
});
