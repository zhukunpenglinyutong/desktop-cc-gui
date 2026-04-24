// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppServerEvent } from "../../../types";
import { subscribeAppServerEvents } from "../../../services/events";
import { useAppServerEvents } from "./useAppServerEvents";

vi.mock("../../../services/events", () => ({
  subscribeAppServerEvents: vi.fn(),
}));

type Handlers = Parameters<typeof useAppServerEvents>[0];

function TestHarness({ handlers }: { handlers: Handlers }) {
  useAppServerEvents(handlers);
  return null;
}

let listener: ((event: AppServerEvent) => void) | null = null;
const unlisten = vi.fn();

beforeEach(() => {
  listener = null;
  unlisten.mockReset();
  vi.mocked(subscribeAppServerEvents).mockImplementation((cb) => {
    listener = cb;
    return unlisten;
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

async function mount(handlers: Handlers) {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(<TestHarness handlers={handlers} />);
  });
  return { root };
}

describe("useAppServerEvents routing", () => {
  it("routes app-server events to handlers", async () => {
    const handlers: Handlers = {
      onAppServerEvent: vi.fn(),
      onWorkspaceConnected: vi.fn(),
      onThreadStarted: vi.fn(),
      onBackgroundThreadAction: vi.fn(),
      onAgentMessageDelta: vi.fn(),
      onReasoningSummaryDelta: vi.fn(),
      onReasoningTextDelta: vi.fn(),
      onReasoningSummaryBoundary: vi.fn(),
      onContextCompacting: vi.fn(),
      onContextCompacted: vi.fn(),
      onContextCompactionFailed: vi.fn(),
      onApprovalRequest: vi.fn(),
      onRequestUserInput: vi.fn(),
      onModeBlocked: vi.fn(),
      onModeResolved: vi.fn(),
      onItemUpdated: vi.fn(),
      onItemCompleted: vi.fn(),
      onAgentMessageCompleted: vi.fn(),
      onTurnError: vi.fn(),
    };
    const { root } = await mount(handlers);

    expect(listener).toBeTypeOf("function");

    act(() => {
      listener?.({ workspace_id: "ws-1", message: { method: "codex/connected" } });
    });
    expect(handlers.onWorkspaceConnected).toHaveBeenCalledWith("ws-1");

    act(() => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "item/agentMessage/delta",
          params: { threadId: "thread-1", itemId: "item-1", delta: "Hello" },
        },
      });
    });
    expect(handlers.onAgentMessageDelta).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId: "item-1",
      delta: "Hello",
    });

    act(() => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "item/reasoning/summaryPartAdded",
          params: { threadId: "thread-1", itemId: "reasoning-1", summaryIndex: 1 },
        },
      });
    });
    expect(handlers.onReasoningSummaryBoundary).toHaveBeenCalledWith(
      "ws-1",
      "thread-1",
      "reasoning-1",
    );

    act(() => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "response.reasoning_summary_text.done",
          params: {
            threadId: "thread-1",
            item: { id: "reasoning-1" },
            text: "summary complete",
          },
        },
      });
    });
    expect(handlers.onReasoningSummaryDelta).toHaveBeenCalledWith(
      "ws-1",
      "thread-1",
      "reasoning-1",
      "summary complete",
    );

    act(() => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "response.reasoning_summary.delta",
          params: {
            threadId: "thread-1",
            item: { id: "reasoning-1" },
            delta: "summary delta alias",
          },
        },
      });
    });
    expect(handlers.onReasoningSummaryDelta).toHaveBeenCalledWith(
      "ws-1",
      "thread-1",
      "reasoning-1",
      "summary delta alias",
    );

    act(() => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "response.reasoning_summary.done",
          params: {
            threadId: "thread-1",
            item: { id: "reasoning-1" },
            text: "summary done alias",
          },
        },
      });
    });
    expect(handlers.onReasoningSummaryDelta).toHaveBeenCalledWith(
      "ws-1",
      "thread-1",
      "reasoning-1",
      "summary done alias",
    );

    act(() => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "item/reasoning/delta",
          params: { threadId: "thread-1", itemId: "reasoning-1", delta: "checking..." },
        },
      });
    });
    expect(handlers.onReasoningTextDelta).toHaveBeenCalledWith(
      "ws-1",
      "thread-1",
      "reasoning-1",
      "checking...",
    );

    act(() => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "response.reasoning_summary_part.added",
          params: {
            threadId: "thread-1",
            part: { item_id: "reasoning-2" },
          },
        },
      });
    });
    expect(handlers.onReasoningSummaryBoundary).toHaveBeenCalledWith(
      "ws-1",
      "thread-1",
      "reasoning-2",
    );

    act(() => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "response.reasoning_summary_part.done",
          params: {
            threadId: "thread-1",
            item_id: "reasoning-2",
            part: { type: "summary_text", text: "finished part" },
          },
        },
      });
    });
    expect(handlers.onReasoningSummaryDelta).toHaveBeenCalledWith(
      "ws-1",
      "thread-1",
      "reasoning-2",
      "finished part",
    );

    act(() => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "thread/compacted",
          params: { threadId: "thread-1", turnId: "turn-7" },
        },
      });
    });
    expect(handlers.onContextCompacted).toHaveBeenCalledWith(
      "ws-1",
      "thread-1",
      "turn-7",
    );

    act(() => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "thread/compacting",
          params: {
            threadId: "thread-1",
            usagePercent: 96,
            thresholdPercent: 92,
            targetPercent: 70,
          },
        },
      });
    });
    expect(handlers.onContextCompacting).toHaveBeenCalledWith(
      "ws-1",
      "thread-1",
      {
        usagePercent: 96,
        thresholdPercent: 92,
        targetPercent: 70,
      },
    );

    act(() => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "thread/compactionFailed",
          params: { threadId: "thread-1", reason: "rpc failed" },
        },
      });
    });
    expect(handlers.onContextCompactionFailed).toHaveBeenCalledWith(
      "ws-1",
      "thread-1",
      "rpc failed",
    );

    act(() => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "thread/started",
          params: { thread: { id: "thread-2", preview: "New thread" } },
        },
      });
    });
    expect(handlers.onThreadStarted).toHaveBeenCalledWith("ws-1", {
      id: "thread-2",
      preview: "New thread",
    });

    act(() => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "item/updated",
          params: { threadId: "thread-2", item: { id: "item-42", type: "reasoning", text: "..." } },
        },
      });
    });
    expect(handlers.onItemUpdated).toHaveBeenCalledWith("ws-1", "thread-2", {
      id: "item-42",
      type: "reasoning",
      text: "...",
    });

    act(() => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "turn/error",
          params: { threadId: "thread-2", turnId: "turn-2", error: "Resume failed" },
        },
      });
    });
    expect(handlers.onTurnError).toHaveBeenCalledWith("ws-1", "thread-2", "turn-2", {
      message: "Resume failed",
      willRetry: false,
    });

    act(() => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "turn/error",
          params: {
            threadId: "thread-2",
            turnId: null,
            error: { message: "Late start failed", lateResponse: true },
          },
        },
      });
    });
    expect(handlers.onTurnError).toHaveBeenCalledWith("ws-1", "thread-2", "", {
      message: "Late start failed",
      willRetry: false,
    });

    act(() => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "codex/parseError",
          params: {
            threadId: "thread-2",
            error: "EOF while parsing value",
            raw: "{\"id\":1,\"method\":\"turn/completed\"",
          },
        },
      });
    });
    expect(handlers.onTurnError).toHaveBeenCalledWith("ws-1", "thread-2", "", {
      message:
        "Codex stream parse error: EOF while parsing value\n{\"id\":1,\"method\":\"turn/completed\"",
      willRetry: false,
    });

    act(() => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "codex/backgroundThread",
          params: { threadId: "thread-2", action: "hide" },
        },
      });
    });
    expect(handlers.onBackgroundThreadAction).toHaveBeenCalledWith(
      "ws-1",
      "thread-2",
      "hide",
    );

    act(() => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "workspace/requestApproval",
          id: 7,
          params: { mode: "full" },
        },
      });
    });
    expect(handlers.onApprovalRequest).toHaveBeenCalledWith({
      workspace_id: "ws-1",
      request_id: 7,
      method: "workspace/requestApproval",
      params: { mode: "full" },
    });

    act(() => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "approval/request",
          params: {
            request_id: 912,
            scope: "workspace",
          },
        },
      });
    });
    expect(handlers.onApprovalRequest).toHaveBeenCalledWith({
      workspace_id: "ws-1",
      request_id: 912,
      method: "approval/request",
      params: {
        request_id: 912,
        scope: "workspace",
      },
    });

    act(() => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "collaboration/modeBlocked",
          params: {
            threadId: "thread-1",
            blockedMethod: "item/tool/requestUserInput",
            effectiveMode: "code",
            reason: "request blocked",
            suggestion: "Switch to Plan mode",
            requestId: 92,
          },
        },
      });
    });
    expect(handlers.onModeBlocked).toHaveBeenCalledWith({
      workspace_id: "ws-1",
      params: {
        thread_id: "thread-1",
        blocked_method: "item/tool/requestUserInput",
        effective_mode: "code",
        reason: "request blocked",
        suggestion: "Switch to Plan mode",
        request_id: 92,
      },
    });

    act(() => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "collaboration/modeResolved",
          params: {
            threadId: "thread-1",
            selectedUiMode: "default",
            effectiveRuntimeMode: "code",
            effectiveUiMode: "default",
            fallbackReason: null,
          },
        },
      });
    });
    expect(handlers.onModeResolved).toHaveBeenCalledWith({
      workspace_id: "ws-1",
      params: {
        thread_id: "thread-1",
        selected_ui_mode: "default",
        effective_runtime_mode: "code",
        effective_ui_mode: "default",
        fallback_reason: null,
      },
    });

    act(() => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "item/tool/requestUserInput",
          id: 11,
          params: {
            thread_id: "thread-1",
            turn_id: "turn-1",
            item_id: "call-1",
            questions: [
              {
                id: "confirm_path",
                header: "Confirm",
                question: "Proceed?",
                options: [
                  { label: "Yes", description: "Continue." },
                  { label: "No", description: "Stop." },
                ],
              },
            ],
          },
        },
      });
    });
    expect(handlers.onRequestUserInput).toHaveBeenCalledWith({
      workspace_id: "ws-1",
      request_id: 11,
      params: {
        thread_id: "thread-1",
        turn_id: "turn-1",
        item_id: "call-1",
        questions: [
          {
            id: "confirm_path",
            header: "Confirm",
            question: "Proceed?",
            isOther: false,
            isSecret: false,
            options: [
              { label: "Yes", description: "Continue." },
              { label: "No", description: "Stop." },
            ],
          },
        ],
      },
    });

    act(() => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "item/completed",
          params: {
            threadId: "thread-1",
            item: { type: "agentMessage", id: "item-2", text: "Done" },
          },
        },
      });
    });
    expect(handlers.onItemCompleted).toHaveBeenCalledWith("ws-1", "thread-1", {
      type: "agentMessage",
      id: "item-2",
      text: "Done",
    });
    expect(handlers.onAgentMessageCompleted).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId: "item-2",
      text: "Done",
    });

    await act(async () => {
      root.unmount();
    });
    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
