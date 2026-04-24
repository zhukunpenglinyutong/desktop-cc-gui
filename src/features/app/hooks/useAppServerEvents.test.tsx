// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppServerEvent } from "../../../types";
import { subscribeAppServerEvents } from "../../../services/events";
import {
  clearSharedSessionBindingsForSharedThread,
  registerSharedSessionNativeBinding,
} from "../../shared-session/runtime/sharedSessionBridge";
import { updateSharedSessionNativeBinding as updateSharedSessionNativeBindingService } from "../../shared-session/services/sharedSessions";
import { useAppServerEvents } from "./useAppServerEvents";

vi.mock("../../../services/events", () => ({
  subscribeAppServerEvents: vi.fn(),
}));

vi.mock("../../shared-session/services/sharedSessions", () => ({
  updateSharedSessionNativeBinding: vi.fn(() => Promise.resolve(null)),
}));

type Handlers = Parameters<typeof useAppServerEvents>[0];
type HookOptions = Parameters<typeof useAppServerEvents>[1];

function TestHarness({
  handlers,
  options,
}: {
  handlers: Handlers;
  options?: HookOptions;
}) {
  useAppServerEvents(handlers, options);
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

async function mount(handlers: Handlers, options?: HookOptions) {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(<TestHarness handlers={handlers} options={options} />);
  });
  return { root };
}

describe("useAppServerEvents", () => {
  it("normalizes request user input questions and options", async () => {
    const handlers: Handlers = {
      onRequestUserInput: vi.fn(),
    };
    const { root } = await mount(handlers);

    act(() => {
      listener?.({
        workspace_id: "ws-9",
        message: {
          method: "item/tool/requestUserInput",
          id: 55,
          params: {
            threadId: "thread-9",
            turnId: "turn-9",
            itemId: "item-9",
            questions: [
              {
                id: "",
                header: "",
                question: "",
                options: [
                  { label: "", description: "" },
                  { label: "  ", description: " " },
                ],
              },
              {
                id: "q-1",
                header: "",
                question: "Choose",
                options: [
                  { label: "", description: "" },
                  { label: "Yes", description: "" },
                  { label: "", description: "No label" },
                ],
              },
            ],
          },
        },
      });
    });

    expect(handlers.onRequestUserInput).toHaveBeenCalledWith({
      workspace_id: "ws-9",
      request_id: 55,
      params: {
        thread_id: "thread-9",
        turn_id: "turn-9",
        item_id: "item-9",
        questions: [
          {
            id: "q-1",
            header: "",
            question: "Choose",
            isOther: false,
            isSecret: false,
            options: [
              { label: "Yes", description: "" },
              { label: "", description: "No label" },
            ],
          },
        ],
      },
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("routes runtime ended payloads and tears down shared thread processing", async () => {
    const handlers: Handlers = {
      onRuntimeEnded: vi.fn(),
      onTurnError: vi.fn(),
    };
    registerSharedSessionNativeBinding({
      workspaceId: "ws-runtime-ended",
      sharedThreadId: "shared-thread-1",
      nativeThreadId: "native-thread-1",
      engine: "codex",
    });
    const { root } = await mount(handlers);

    act(() => {
      listener?.({
        workspace_id: "ws-runtime-ended",
        message: {
          method: "runtime/ended",
          params: {
            reasonCode: "process_exit",
            message: "Managed runtime process exited unexpectedly.",
            affectedThreadIds: ["native-thread-1"],
            affectedTurnIds: ["turn-77"],
            pendingRequestCount: 2,
            hadActiveLease: true,
          },
        },
      });
    });

    expect(handlers.onRuntimeEnded).toHaveBeenCalledWith("ws-runtime-ended", {
      reasonCode: "process_exit",
      message: "Managed runtime process exited unexpectedly.",
      affectedThreadIds: ["native-thread-1"],
      affectedTurnIds: ["turn-77"],
      pendingRequestCount: 2,
      hadActiveLease: true,
    });
    expect(handlers.onTurnError).toHaveBeenCalledWith(
      "ws-runtime-ended",
      "shared-thread-1",
      "turn-77",
      {
        message: "[RUNTIME_ENDED] Managed runtime process exited unexpectedly.",
        willRetry: false,
      },
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("skips turn teardown for manual shutdown runtime ended events", async () => {
    const handlers: Handlers = {
      onRuntimeEnded: vi.fn(),
      onTurnError: vi.fn(),
    };
    const { root } = await mount(handlers);

    act(() => {
      listener?.({
        workspace_id: "ws-runtime-ended-manual",
        message: {
          method: "runtime/ended",
          params: {
            reasonCode: "manual_shutdown",
            message: "Managed runtime stopped after manual shutdown.",
            affectedThreadIds: ["thread-1"],
            affectedTurnIds: ["turn-1"],
            pendingRequestCount: 0,
            hadActiveLease: false,
          },
        },
      });
    });

    expect(handlers.onRuntimeEnded).toHaveBeenCalledWith(
      "ws-runtime-ended-manual",
      expect.objectContaining({
        reasonCode: "manual_shutdown",
      }),
    );
    expect(handlers.onTurnError).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("preserves multiSelect flag for request user input questions", async () => {
    const handlers: Handlers = {
      onRequestUserInput: vi.fn(),
    };
    const { root } = await mount(handlers);

    act(() => {
      listener?.({
        workspace_id: "ws-multi",
        message: {
          method: "item/tool/requestUserInput",
          id: "req-multi-1",
          params: {
            threadId: "thread-multi",
            turnId: "turn-multi",
            itemId: "item-multi",
            questions: [
              {
                id: "q-1",
                header: "Focus",
                question: "Choose multiple",
                multiSelect: true,
                options: [{ label: "A", description: "" }],
              },
            ],
          },
        },
      });
    });

    expect(handlers.onRequestUserInput).toHaveBeenCalledWith({
      workspace_id: "ws-multi",
      request_id: "req-multi-1",
      params: {
        thread_id: "thread-multi",
        turn_id: "turn-multi",
        item_id: "item-multi",
        questions: [
          {
            id: "q-1",
            header: "Focus",
            question: "Choose multiple",
            isOther: false,
            isSecret: false,
            multiSelect: true,
            options: [{ label: "A", description: "" }],
          },
        ],
      },
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("prefers params.request_id over transport-level message.id for requestUserInput", async () => {
    const handlers: Handlers = {
      onRequestUserInput: vi.fn(),
    };
    const { root } = await mount(handlers);

    act(() => {
      listener?.({
        workspace_id: "ws-req-id",
        message: {
          method: "item/tool/requestUserInput",
          id: 999,
          params: {
            request_id: "ask-real-1",
            threadId: "thread-real",
            turnId: "turn-real",
            itemId: "item-real",
            questions: [{ id: "q-1", header: "", question: "Choose one" }],
          },
        },
      });
    });

    expect(handlers.onRequestUserInput).toHaveBeenCalledWith({
      workspace_id: "ws-req-id",
      request_id: "ask-real-1",
      params: {
        thread_id: "thread-real",
        turn_id: "turn-real",
        item_id: "item-real",
        questions: [
          {
            id: "q-1",
            header: "",
            question: "Choose one",
            isOther: false,
            isSecret: false,
            options: undefined,
          },
        ],
      },
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("falls back to active codex thread for reasoning events without threadId", async () => {
    const handlers: Handlers = {
      onAppServerEvent: vi.fn(),
      onReasoningSummaryDelta: vi.fn(),
      onReasoningTextDelta: vi.fn(),
      onReasoningSummaryBoundary: vi.fn(),
      getActiveCodexThreadId: vi.fn(() => "codex:active-thread"),
    };
    const { root } = await mount(handlers);

    act(() => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "response.reasoning_summary_text.delta",
          params: {
            item: { id: "reasoning-1" },
            delta: "checking sibling specs",
          },
        },
      });
    });
    expect(handlers.onReasoningSummaryDelta).toHaveBeenCalledWith(
      "ws-1",
      "codex:active-thread",
      "reasoning-1",
      "checking sibling specs",
    );

    act(() => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "response.reasoning_summary_part.added",
          params: {
            part: { item_id: "reasoning-2" },
          },
        },
      });
    });
    expect(handlers.onReasoningSummaryBoundary).toHaveBeenCalledWith(
      "ws-1",
      "codex:active-thread",
      "reasoning-2",
    );

    act(() => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "response.reasoning_text.delta",
          params: {
            item_id: "reasoning-3",
            text: "I am verifying sibling spec directories.",
          },
        },
      });
    });
    expect(handlers.onReasoningTextDelta).toHaveBeenCalledWith(
      "ws-1",
      "codex:active-thread",
      "reasoning-3",
      "I am verifying sibling spec directories.",
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("routes agent delta when threadId is nested in turn and payload uses text field", async () => {
    const handlers: Handlers = {
      onAgentMessageDelta: vi.fn(),
    };
    const { root } = await mount(handlers);

    act(() => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "item/agentMessage/delta",
          params: {
            turn: { threadId: "claude:session-1", id: "turn-1" },
            itemId: "item-1",
            text: "chunk-from-text-field",
          },
        },
      });
    });

    expect(handlers.onAgentMessageDelta).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      threadId: "claude:session-1",
      itemId: "item-1",
      delta: "chunk-from-text-field",
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("routes item and tool-delta events when threadId is nested in turn", async () => {
    const handlers: Handlers = {
      onItemStarted: vi.fn(),
      onCommandOutputDelta: vi.fn(),
      onReasoningSummaryDelta: vi.fn(),
    };
    const { root } = await mount(handlers);

    act(() => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "item/started",
          params: {
            turn: { threadId: "claude:session-1" },
            item: { id: "tool-1", type: "commandExecution", status: "started" },
          },
        },
      });
    });

    act(() => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "item/commandExecution/outputDelta",
          params: {
            turn: { threadId: "claude:session-1", itemId: "tool-1" },
            delta: "partial output",
          },
        },
      });
    });

    act(() => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "item/reasoning/summaryTextDelta",
          params: {
            turn: { threadId: "claude:session-1", itemId: "reasoning-1" },
            delta: "thinking...",
          },
        },
      });
    });

    expect(handlers.onItemStarted).toHaveBeenCalledWith("ws-1", "claude:session-1", {
      id: "tool-1",
      type: "commandExecution",
      status: "started",
    });
    expect(handlers.onCommandOutputDelta).toHaveBeenCalledWith(
      "ws-1",
      "claude:session-1",
      "tool-1",
      "partial output",
    );
    expect(handlers.onReasoningSummaryDelta).toHaveBeenCalledWith(
      "ws-1",
      "claude:session-1",
      "reasoning-1",
      "thinking...",
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("routes item/agentMessage/textDelta alias in legacy event path", async () => {
    const handlers: Handlers = {
      onAgentMessageDelta: vi.fn(),
    };
    const { root } = await mount(handlers);

    act(() => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "item/agentMessage/textDelta",
          params: {
            threadId: "claude:session-2",
            itemId: "item-2",
            delta: "alias-delta",
          },
        },
      });
    });

    expect(handlers.onAgentMessageDelta).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      threadId: "claude:session-2",
      itemId: "item-2",
      delta: "alias-delta",
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("normalizes secret input field from snake_case", async () => {
    const handlers: Handlers = {
      onRequestUserInput: vi.fn(),
    };
    const { root } = await mount(handlers);

    act(() => {
      listener?.({
        workspace_id: "ws-secret",
        message: {
          method: "item/tool/requestUserInput",
          id: 87,
          params: {
            thread_id: "thread-secret",
            turn_id: "turn-secret",
            item_id: "item-secret",
            questions: [
              {
                id: "token",
                header: "Credential",
                question: "Paste token",
                is_secret: true,
              },
            ],
          },
        },
      });
    });

    expect(handlers.onRequestUserInput).toHaveBeenCalledWith({
      workspace_id: "ws-secret",
      request_id: 87,
      params: {
        thread_id: "thread-secret",
        turn_id: "turn-secret",
        item_id: "item-secret",
        questions: [
          {
            id: "token",
            header: "Credential",
            question: "Paste token",
            isOther: false,
            isSecret: true,
            options: undefined,
          },
        ],
      },
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("falls back to turn.threadId and active codex thread for user input request", async () => {
    const handlers: Handlers = {
      onRequestUserInput: vi.fn(),
      getActiveCodexThreadId: vi.fn(() => "codex-active-thread"),
    };
    const { root } = await mount(handlers);

    act(() => {
      listener?.({
        workspace_id: "ws-nested",
        message: {
          method: "item/tool/requestUserInput",
          id: "req-nested-1",
          params: {
            turn: {
              id: "turn-nested-1",
              threadId: "thread-from-turn",
            },
            questions: [{ id: "q1", header: "", question: "Proceed?" }],
          },
        },
      });
    });

    expect(handlers.onRequestUserInput).toHaveBeenLastCalledWith({
      workspace_id: "ws-nested",
      request_id: "req-nested-1",
      params: {
        thread_id: "thread-from-turn",
        turn_id: "turn-nested-1",
        item_id: "",
        questions: [
          {
            id: "q1",
            header: "",
            question: "Proceed?",
            isOther: false,
            isSecret: false,
            options: undefined,
          },
        ],
      },
    });

    act(() => {
      listener?.({
        workspace_id: "ws-nested",
        message: {
          method: "item/tool/requestUserInput",
          id: "req-nested-2",
          params: {
            turnId: "turn-no-thread",
            questions: [{ id: "q2", header: "", question: "Continue?" }],
          },
        },
      });
    });

    expect(handlers.onRequestUserInput).toHaveBeenLastCalledWith({
      workspace_id: "ws-nested",
      request_id: "req-nested-2",
      params: {
        thread_id: "codex-active-thread",
        turn_id: "turn-no-thread",
        item_id: "",
        questions: [
          {
            id: "q2",
            header: "",
            question: "Continue?",
            isOther: false,
            isSecret: false,
            options: undefined,
          },
        ],
      },
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("marks requestUserInput as completed when payload indicates completion", async () => {
    const handlers: Handlers = {
      onRequestUserInput: vi.fn(),
    };
    const { root } = await mount(handlers);

    act(() => {
      listener?.({
        workspace_id: "ws-completed",
        message: {
          method: "item/tool/requestUserInput",
          id: "req-completed-1",
          params: {
            threadId: "thread-completed",
            turnId: "turn-completed",
            itemId: "item-completed",
            completed: true,
            questions: [{ id: "q1", header: "", question: "Done?" }],
          },
        },
      });
    });

    expect(handlers.onRequestUserInput).toHaveBeenCalledWith({
      workspace_id: "ws-completed",
      request_id: "req-completed-1",
      params: {
        thread_id: "thread-completed",
        turn_id: "turn-completed",
        item_id: "item-completed",
        completed: true,
        questions: [
          {
            id: "q1",
            header: "",
            question: "Done?",
            isOther: false,
            isSecret: false,
            options: undefined,
          },
        ],
      },
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("ignores delta events missing required fields", async () => {
    const handlers: Handlers = {
      onAgentMessageDelta: vi.fn(),
    };
    const { root } = await mount(handlers);

    act(() => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "item/agentMessage/delta",
          params: { threadId: "", itemId: "item-1", delta: "Hello" },
        },
      });
    });
    act(() => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "item/agentMessage/delta",
          params: { threadId: "thread-1", itemId: "", delta: "Hello" },
        },
      });
    });
    act(() => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "item/agentMessage/delta",
          params: { threadId: "thread-1", itemId: "item-1", delta: "" },
        },
      });
    });

    expect(handlers.onAgentMessageDelta).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("passes engine hint when thread session id is updated", async () => {
    const handlers: Handlers = {
      onThreadSessionIdUpdated: vi.fn(),
    };
    const { root } = await mount(handlers);

    act(() => {
      listener?.({
        workspace_id: "ws-opencode",
        message: {
          method: "thread/started",
          params: {
            threadId: "opencode-pending-1",
            sessionId: "ses_1",
            engine: "opencode",
          },
        },
      });
    });

    expect(handlers.onThreadSessionIdUpdated).toHaveBeenCalledWith(
      "ws-opencode",
      "opencode-pending-1",
      "ses_1",
      "opencode",
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps codex shared-session native binding unchanged on thread/started", async () => {
    const handlers: Handlers = {
      onTurnCompleted: vi.fn(),
    };
    registerSharedSessionNativeBinding({
      workspaceId: "ws-shared-codex",
      sharedThreadId: "shared:thread-codex",
      nativeThreadId: "codex-native-thread-1",
      engine: "codex",
    });
    const { root } = await mount(handlers);

    act(() => {
      listener?.({
        workspace_id: "ws-shared-codex",
        message: {
          method: "thread/started",
          params: {
            threadId: "codex-native-thread-1",
            sessionId: "codex-native-thread-1",
            engine: "codex",
          },
        },
      });
      listener?.({
        workspace_id: "ws-shared-codex",
        message: {
          method: "turn/completed",
          params: {
            threadId: "codex-native-thread-1",
            turnId: "turn-codex-1",
          },
        },
      });
    });

    expect(updateSharedSessionNativeBindingService).not.toHaveBeenCalled();
    expect(handlers.onTurnCompleted).toHaveBeenCalledWith(
      "ws-shared-codex",
      "shared:thread-codex",
      "turn-codex-1",
    );

    clearSharedSessionBindingsForSharedThread("ws-shared-codex", "shared:thread-codex");
    await act(async () => {
      root.unmount();
    });
  });

  it("rebinds pending codex shared-session native ids on first thread/started", async () => {
    const handlers: Handlers = {
      onThreadStarted: vi.fn(),
      onTurnCompleted: vi.fn(),
    };
    registerSharedSessionNativeBinding({
      workspaceId: "ws-shared-codex-pending",
      sharedThreadId: "shared:thread-codex-pending",
      nativeThreadId: "codex-pending-shared-1",
      engine: "codex",
    });
    const { root } = await mount(handlers);

    act(() => {
      listener?.({
        workspace_id: "ws-shared-codex-pending",
        message: {
          method: "thread/started",
          params: {
            threadId: "550e8400-e29b-41d4-a716-446655440000",
            sessionId: "550e8400-e29b-41d4-a716-446655440000",
            engine: "codex",
          },
        },
      });
      listener?.({
        workspace_id: "ws-shared-codex-pending",
        message: {
          method: "turn/completed",
          params: {
            threadId: "550e8400-e29b-41d4-a716-446655440000",
            turnId: "turn-codex-pending-1",
          },
        },
      });
    });

    expect(handlers.onThreadStarted).not.toHaveBeenCalled();
    expect(updateSharedSessionNativeBindingService).toHaveBeenCalledWith(
      "ws-shared-codex-pending",
      "shared:thread-codex-pending",
      "codex",
      "codex-pending-shared-1",
      "550e8400-e29b-41d4-a716-446655440000",
    );
    expect(handlers.onTurnCompleted).toHaveBeenCalledWith(
      "ws-shared-codex-pending",
      "shared:thread-codex-pending",
      "turn-codex-pending-1",
    );

    clearSharedSessionBindingsForSharedThread(
      "ws-shared-codex-pending",
      "shared:thread-codex-pending",
    );
    await act(async () => {
      root.unmount();
    });
  });

  it("rebinds non-codex shared-session native thread ids on thread/started", async () => {
    const handlers: Handlers = {
      onTurnCompleted: vi.fn(),
    };
    registerSharedSessionNativeBinding({
      workspaceId: "ws-shared-claude",
      sharedThreadId: "shared:thread-claude",
      nativeThreadId: "claude-pending-shared-1",
      engine: "claude",
    });
    const { root } = await mount(handlers);

    act(() => {
      listener?.({
        workspace_id: "ws-shared-claude",
        message: {
          method: "thread/started",
          params: {
            threadId: "claude-pending-shared-1",
            sessionId: "ses_123",
            engine: "claude",
          },
        },
      });
      listener?.({
        workspace_id: "ws-shared-claude",
        message: {
          method: "turn/completed",
          params: {
            threadId: "claude:ses_123",
            turnId: "turn-claude-1",
          },
        },
      });
    });

    expect(updateSharedSessionNativeBindingService).toHaveBeenCalledWith(
      "ws-shared-claude",
      "shared:thread-claude",
      "claude",
      "claude-pending-shared-1",
      "claude:ses_123",
    );
    expect(handlers.onTurnCompleted).toHaveBeenCalledWith(
      "ws-shared-claude",
      "shared:thread-claude",
      "turn-claude-1",
    );

    clearSharedSessionBindingsForSharedThread("ws-shared-claude", "shared:thread-claude");
    await act(async () => {
      root.unmount();
    });
  });

  it("emits fallback assistant completion from turn/completed result text when no delta arrived", async () => {
    const handlers: Handlers = {
      onAgentMessageCompleted: vi.fn(),
      onTurnCompleted: vi.fn(),
    };
    const { root } = await mount(handlers);

    act(() => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "turn/completed",
          params: {
            threadId: "thread-1",
            turnId: "turn-1",
            result: { text: "final response from result" },
          },
        },
      });
    });

    expect(handlers.onAgentMessageCompleted).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId: "turn-1",
      text: "final response from result",
    });
    expect(handlers.onTurnCompleted).toHaveBeenCalledWith("ws-1", "thread-1", "turn-1");

    await act(async () => {
      root.unmount();
    });
  });

  it("does not emit fallback assistant completion when delta already arrived", async () => {
    const handlers: Handlers = {
      onAgentMessageDelta: vi.fn(),
      onAgentMessageCompleted: vi.fn(),
      onTurnCompleted: vi.fn(),
    };
    const { root } = await mount(handlers);

    act(() => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "item/agentMessage/delta",
          params: { threadId: "thread-1", itemId: "item-1", delta: "streaming..." },
        },
      });
    });

    act(() => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "turn/completed",
          params: {
            threadId: "thread-1",
            turnId: "turn-1",
            result: { text: "final response from result" },
          },
        },
      });
    });

    expect(handlers.onAgentMessageCompleted).not.toHaveBeenCalled();
    expect(handlers.onTurnCompleted).toHaveBeenCalledWith("ws-1", "thread-1", "turn-1");

    await act(async () => {
      root.unmount();
    });
  });

  it("does not emit duplicated completion when item/completed already delivered agent text", async () => {
    const handlers: Handlers = {
      onAgentMessageCompleted: vi.fn(),
      onTurnCompleted: vi.fn(),
      onItemCompleted: vi.fn(),
    };
    const { root } = await mount(handlers);

    act(() => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "item/completed",
          params: {
            threadId: "thread-1",
            item: { type: "agentMessage", id: "item-1", text: "final response" },
          },
        },
      });
    });

    act(() => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "turn/completed",
          params: {
            threadId: "thread-1",
            turnId: "turn-1",
            result: { text: "final response" },
          },
        },
      });
    });

    expect(handlers.onAgentMessageCompleted).toHaveBeenCalledTimes(1);
    expect(handlers.onTurnCompleted).toHaveBeenCalledWith("ws-1", "thread-1", "turn-1");

    await act(async () => {
      root.unmount();
    });
  });

  it("does not emit fallback completion when agentMessage snapshot already arrived via item/updated", async () => {
    const handlers: Handlers = {
      onAgentMessageCompleted: vi.fn(),
      onTurnCompleted: vi.fn(),
      onItemUpdated: vi.fn(),
    };
    const { root } = await mount(handlers);

    act(() => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "item/updated",
          params: {
            threadId: "codex:thread-1",
            item: { type: "agentMessage", id: "item-1", text: "final response" },
          },
        },
      });
    });

    act(() => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "turn/completed",
          params: {
            threadId: "codex:thread-1",
            turnId: "turn-1",
            result: { text: "final response" },
          },
        },
      });
    });

    expect(handlers.onItemUpdated).toHaveBeenCalledTimes(1);
    expect(handlers.onAgentMessageCompleted).not.toHaveBeenCalled();
    expect(handlers.onTurnCompleted).toHaveBeenCalledWith(
      "ws-1",
      "codex:thread-1",
      "turn-1",
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps turn/completed fallback when agentMessage snapshot text is empty", async () => {
    const handlers: Handlers = {
      onAgentMessageCompleted: vi.fn(),
      onTurnCompleted: vi.fn(),
      onItemUpdated: vi.fn(),
    };
    const { root } = await mount(handlers);

    act(() => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "item/updated",
          params: {
            threadId: "codex:thread-1",
            item: { type: "agentMessage", id: "item-empty", text: "" },
          },
        },
      });
    });

    act(() => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "turn/completed",
          params: {
            threadId: "codex:thread-1",
            turnId: "turn-2",
            result: { text: "final response from result" },
          },
        },
      });
    });

    expect(handlers.onItemUpdated).toHaveBeenCalledTimes(1);
    expect(handlers.onAgentMessageCompleted).toHaveBeenCalledTimes(1);
    expect(handlers.onAgentMessageCompleted).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      threadId: "codex:thread-1",
      itemId: "turn-2",
      text: "final response from result",
    });
    expect(handlers.onTurnCompleted).toHaveBeenCalledWith(
      "ws-1",
      "codex:thread-1",
      "turn-2",
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("does not emit fallback completion in shared session when agentMessage snapshot already has text", async () => {
    const handlers: Handlers = {
      onAgentMessageCompleted: vi.fn(),
      onTurnCompleted: vi.fn(),
      onItemUpdated: vi.fn(),
    };
    registerSharedSessionNativeBinding({
      workspaceId: "ws-shared-codex-turn",
      sharedThreadId: "shared:thread-codex-turn",
      nativeThreadId: "codex-native-thread-turn",
      engine: "codex",
    });
    const { root } = await mount(handlers);

    act(() => {
      listener?.({
        workspace_id: "ws-shared-codex-turn",
        message: {
          method: "item/updated",
          params: {
            threadId: "codex-native-thread-turn",
            item: { type: "agentMessage", id: "item-1", text: "shared final response" },
          },
        },
      });
      listener?.({
        workspace_id: "ws-shared-codex-turn",
        message: {
          method: "turn/completed",
          params: {
            threadId: "codex-native-thread-turn",
            turnId: "turn-shared-1",
            result: { text: "shared final response" },
          },
        },
      });
    });

    expect(handlers.onItemUpdated).toHaveBeenCalledWith(
      "ws-shared-codex-turn",
      "shared:thread-codex-turn",
      expect.objectContaining({
        type: "agentMessage",
        id: "item-1",
        text: "shared final response",
      }),
    );
    expect(handlers.onAgentMessageCompleted).not.toHaveBeenCalled();
    expect(handlers.onTurnCompleted).toHaveBeenCalledWith(
      "ws-shared-codex-turn",
      "shared:thread-codex-turn",
      "turn-shared-1",
    );

    clearSharedSessionBindingsForSharedThread(
      "ws-shared-codex-turn",
      "shared:thread-codex-turn",
    );
    await act(async () => {
      root.unmount();
    });
  });

  it("keeps shared-session turn/completed fallback when snapshot text is empty", async () => {
    const handlers: Handlers = {
      onAgentMessageCompleted: vi.fn(),
      onTurnCompleted: vi.fn(),
      onItemUpdated: vi.fn(),
    };
    registerSharedSessionNativeBinding({
      workspaceId: "ws-shared-codex-empty",
      sharedThreadId: "shared:thread-codex-empty",
      nativeThreadId: "codex-native-thread-empty",
      engine: "codex",
    });
    const { root } = await mount(handlers);

    act(() => {
      listener?.({
        workspace_id: "ws-shared-codex-empty",
        message: {
          method: "item/updated",
          params: {
            threadId: "codex-native-thread-empty",
            item: { type: "agentMessage", id: "item-empty", text: "" },
          },
        },
      });
      listener?.({
        workspace_id: "ws-shared-codex-empty",
        message: {
          method: "turn/completed",
          params: {
            threadId: "codex-native-thread-empty",
            turnId: "turn-shared-empty-1",
            result: { text: "shared fallback response" },
          },
        },
      });
    });

    expect(handlers.onItemUpdated).toHaveBeenCalledWith(
      "ws-shared-codex-empty",
      "shared:thread-codex-empty",
      expect.objectContaining({
        type: "agentMessage",
        id: "item-empty",
      }),
    );
    expect(handlers.onAgentMessageCompleted).toHaveBeenCalledTimes(1);
    expect(handlers.onAgentMessageCompleted).toHaveBeenCalledWith({
      workspaceId: "ws-shared-codex-empty",
      threadId: "shared:thread-codex-empty",
      itemId: "turn-shared-empty-1",
      text: "shared fallback response",
    });
    expect(handlers.onTurnCompleted).toHaveBeenCalledWith(
      "ws-shared-codex-empty",
      "shared:thread-codex-empty",
      "turn-shared-empty-1",
    );

    clearSharedSessionBindingsForSharedThread(
      "ws-shared-codex-empty",
      "shared:thread-codex-empty",
    );
    await act(async () => {
      root.unmount();
    });
  });

  it("keeps multiple agent completions in the same thread when item ids differ", async () => {
    const handlers: Handlers = {
      onAgentMessageCompleted: vi.fn(),
      onItemCompleted: vi.fn(),
    };
    const { root } = await mount(handlers);

    act(() => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "item/completed",
          params: {
            threadId: "thread-1",
            item: { type: "agentMessage", id: "item-1", text: "first short paragraph" },
          },
        },
      });
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "item/completed",
          params: {
            threadId: "thread-1",
            item: { type: "agentMessage", id: "item-2", text: "second short paragraph" },
          },
        },
      });
    });

    expect(handlers.onAgentMessageCompleted).toHaveBeenCalledTimes(2);
    expect(handlers.onAgentMessageCompleted).toHaveBeenNthCalledWith(1, {
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId: "item-1",
      text: "first short paragraph",
    });
    expect(handlers.onAgentMessageCompleted).toHaveBeenNthCalledWith(2, {
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId: "item-2",
      text: "second short paragraph",
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("dedupes repeated item/completed snapshots for the same agent item id", async () => {
    const handlers: Handlers = {
      onAgentMessageCompleted: vi.fn(),
      onItemCompleted: vi.fn(),
    };
    const { root } = await mount(handlers);

    act(() => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "item/completed",
          params: {
            threadId: "thread-1",
            item: { type: "agentMessage", id: "item-dup-1", text: "same completion text" },
          },
        },
      });
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "item/completed",
          params: {
            threadId: "thread-1",
            item: { type: "agentMessage", id: "item-dup-1", text: "same completion text" },
          },
        },
      });
    });

    expect(handlers.onAgentMessageCompleted).toHaveBeenCalledTimes(1);
    expect(handlers.onAgentMessageCompleted).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId: "item-dup-1",
      text: "same completion text",
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("routes processing heartbeat events", async () => {
    const handlers: Handlers = {
      onProcessingHeartbeat: vi.fn(),
    };
    const { root } = await mount(handlers);

    act(() => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "processing/heartbeat",
          params: { threadId: "thread-1", pulse: 3 },
        },
      });
    });

    expect(handlers.onProcessingHeartbeat).toHaveBeenCalledWith(
      "ws-1",
      "thread-1",
      3,
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("routes thread/compacted even when turnId is missing", async () => {
    const handlers: Handlers = {
      onContextCompacted: vi.fn(),
    };
    const { root } = await mount(handlers);

    act(() => {
      listener?.({
        workspace_id: "ws-2",
        message: {
          method: "thread/compacted",
          params: { threadId: "thread-2" },
        },
      });
    });

    expect(handlers.onContextCompacted).toHaveBeenCalledWith(
      "ws-2",
      "thread-2",
      "",
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("routes opencode text:delta through normalized realtime adapters when enabled", async () => {
    const handlers: Handlers = {
      onAgentMessageDelta: vi.fn(),
    };
    const { root } = await mount(handlers, {
      useNormalizedRealtimeAdapters: true,
    });

    act(() => {
      listener?.({
        workspace_id: "ws-opencode",
        message: {
          method: "text:delta",
          params: {
            threadId: "opencode:ses_99",
            itemId: "assistant-1",
            delta: "streaming text",
          },
        },
      });
    });

    expect(handlers.onAgentMessageDelta).toHaveBeenCalledWith({
      workspaceId: "ws-opencode",
      threadId: "opencode:ses_99",
      itemId: "assistant-1",
      delta: "streaming text",
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("routes claude item/updated agentMessage snapshot in normalized realtime routing", async () => {
    const handlers: Handlers = {
      onAgentMessageDelta: vi.fn(),
      onItemUpdated: vi.fn(),
    };
    const { root } = await mount(handlers, {
      useNormalizedRealtimeAdapters: true,
    });

    act(() => {
      listener?.({
        workspace_id: "ws-claude",
        message: {
          method: "item/updated",
          params: {
            threadId: "claude:session-100",
            item: {
              id: "assistant-100",
              type: "agentMessage",
              text: "snapshot text",
            },
          },
        },
      });
    });

    expect(handlers.onAgentMessageDelta).toHaveBeenCalledTimes(1);
    expect(handlers.onAgentMessageDelta).toHaveBeenCalledWith({
      workspaceId: "ws-claude",
      threadId: "claude:session-100",
      itemId: "assistant-100",
      delta: "snapshot text",
    });
    expect(handlers.onItemUpdated).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("routes claude growing assistant snapshots in normalized mode when delta and snapshot coexist", async () => {
    const handlers: Handlers = {
      onAgentMessageDelta: vi.fn(),
      onAgentMessageCompleted: vi.fn(),
      onItemUpdated: vi.fn(),
      onItemStarted: vi.fn(),
    };
    const { root } = await mount(handlers, {
      useNormalizedRealtimeAdapters: true,
    });

    act(() => {
      listener?.({
        workspace_id: "ws-claude",
        message: {
          method: "turn/started",
          params: {
            threadId: "claude:session-seq-1",
            turnId: "turn-1",
          },
        },
      });
      listener?.({
        workspace_id: "ws-claude",
        message: {
          method: "item/agentMessage/delta",
          params: {
            threadId: "claude:session-seq-1",
            itemId: "assistant-seq-1",
            delta: "第一段",
          },
        },
      });
      listener?.({
        workspace_id: "ws-claude",
        message: {
          method: "item/started",
          params: {
            threadId: "claude:session-seq-1",
            item: {
              id: "assistant-seq-1",
              type: "agentMessage",
              text: "第一段",
            },
          },
        },
      });
      listener?.({
        workspace_id: "ws-claude",
        message: {
          method: "item/updated",
          params: {
            threadId: "claude:session-seq-1",
            item: {
              id: "assistant-seq-1",
              type: "agentMessage",
              text: "第一段第二段",
            },
          },
        },
      });
      listener?.({
        workspace_id: "ws-claude",
        message: {
          method: "item/agentMessage/delta",
          params: {
            threadId: "claude:session-seq-1",
            itemId: "assistant-seq-1",
            delta: "第二段",
          },
        },
      });
      listener?.({
        workspace_id: "ws-claude",
        message: {
          method: "item/completed",
          params: {
            threadId: "claude:session-seq-1",
            item: {
              id: "assistant-seq-1",
              type: "agentMessage",
              text: "第一段第二段",
            },
          },
        },
      });
      listener?.({
        workspace_id: "ws-claude",
        message: {
          method: "turn/completed",
          params: {
            threadId: "claude:session-seq-1",
            turnId: "turn-1",
            result: {
              text: "第一段第二段",
            },
          },
        },
      });
    });

    expect(handlers.onAgentMessageDelta).toHaveBeenCalledTimes(3);
    expect(handlers.onAgentMessageDelta).toHaveBeenNthCalledWith(1, {
      workspaceId: "ws-claude",
      threadId: "claude:session-seq-1",
      itemId: "assistant-seq-1",
      delta: "第一段",
    });
    expect(handlers.onAgentMessageDelta).toHaveBeenNthCalledWith(2, {
      workspaceId: "ws-claude",
      threadId: "claude:session-seq-1",
      itemId: "assistant-seq-1",
      delta: "第一段第二段",
    });
    expect(handlers.onAgentMessageDelta).toHaveBeenNthCalledWith(3, {
      workspaceId: "ws-claude",
      threadId: "claude:session-seq-1",
      itemId: "assistant-seq-1",
      delta: "第二段",
    });
    expect(handlers.onItemStarted).not.toHaveBeenCalled();
    expect(handlers.onItemUpdated).not.toHaveBeenCalled();
    expect(handlers.onAgentMessageCompleted).toHaveBeenCalledTimes(1);
    expect(handlers.onAgentMessageCompleted).toHaveBeenCalledWith({
      workspaceId: "ws-claude",
      threadId: "claude:session-seq-1",
      itemId: "assistant-seq-1",
      text: "第一段第二段",
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps claude agent completion when only snapshot and completed arrive in normalized mode", async () => {
    const handlers: Handlers = {
      onAgentMessageDelta: vi.fn(),
      onAgentMessageCompleted: vi.fn(),
      onItemUpdated: vi.fn(),
    };
    const { root } = await mount(handlers, {
      useNormalizedRealtimeAdapters: true,
    });

    act(() => {
      listener?.({
        workspace_id: "ws-claude",
        message: {
          method: "item/updated",
          params: {
            threadId: "claude:session-snapshot-only-1",
            item: {
              id: "assistant-snapshot-only-1",
              type: "agentMessage",
              text: "snapshot-only-text",
            },
          },
        },
      });
      listener?.({
        workspace_id: "ws-claude",
        message: {
          method: "item/completed",
          params: {
            threadId: "claude:session-snapshot-only-1",
            item: {
              id: "assistant-snapshot-only-1",
              type: "agentMessage",
              text: "snapshot-only-text",
            },
          },
        },
      });
    });

    expect(handlers.onAgentMessageDelta).toHaveBeenCalledTimes(1);
    expect(handlers.onAgentMessageDelta).toHaveBeenCalledWith({
      workspaceId: "ws-claude",
      threadId: "claude:session-snapshot-only-1",
      itemId: "assistant-snapshot-only-1",
      delta: "snapshot-only-text",
    });
    expect(handlers.onItemUpdated).not.toHaveBeenCalled();
    expect(handlers.onAgentMessageCompleted).toHaveBeenCalledTimes(1);
    expect(handlers.onAgentMessageCompleted).toHaveBeenCalledWith({
      workspaceId: "ws-claude",
      threadId: "claude:session-snapshot-only-1",
      itemId: "assistant-snapshot-only-1",
      text: "snapshot-only-text",
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("routes claude text:delta through normalized adapters with thread-scoped fallback id when itemId is missing", async () => {
    const handlers: Handlers = {
      onAgentMessageDelta: vi.fn(),
    };
    const { root } = await mount(handlers, {
      useNormalizedRealtimeAdapters: true,
    });

    act(() => {
      listener?.({
        workspace_id: "ws-claude",
        message: {
          method: "text:delta",
          params: {
            threadId: "claude:session-77",
            turnId: "turn-77",
            delta: "streaming text",
          },
        },
      });
    });

    expect(handlers.onAgentMessageDelta).toHaveBeenCalledWith({
      workspaceId: "ws-claude",
      threadId: "claude:session-77",
      itemId: "claude:session-77:text-delta",
      delta: "streaming text",
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("routes gemini text:delta through legacy fallback when normalized adapters are disabled", async () => {
    const handlers: Handlers = {
      onAgentMessageDelta: vi.fn(),
    };
    const { root } = await mount(handlers);

    act(() => {
      listener?.({
        workspace_id: "ws-gemini",
        message: {
          method: "text:delta",
          params: {
            threadId: "gemini:session-88",
            itemId: "assistant-88",
            delta: "短正文片段",
          },
        },
      });
    });

    expect(handlers.onAgentMessageDelta).toHaveBeenCalledWith({
      workspaceId: "ws-gemini",
      threadId: "gemini:session-88",
      itemId: "assistant-88",
      delta: "短正文片段",
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("does not route opencode text:delta when normalized realtime adapters are disabled", async () => {
    const handlers: Handlers = {
      onAgentMessageDelta: vi.fn(),
    };
    const { root } = await mount(handlers);

    act(() => {
      listener?.({
        workspace_id: "ws-opencode",
        message: {
          method: "text:delta",
          params: {
            threadId: "opencode:ses_99",
            itemId: "assistant-1",
            delta: "streaming text",
          },
        },
      });
    });

    expect(handlers.onAgentMessageDelta).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("routes claude item/updated agentMessage snapshot in legacy routing", async () => {
    const handlers: Handlers = {
      onAgentMessageDelta: vi.fn(),
      onItemUpdated: vi.fn(),
    };
    const { root } = await mount(handlers);

    act(() => {
      listener?.({
        workspace_id: "ws-claude",
        message: {
          method: "item/updated",
          params: {
            threadId: "claude:session-101",
            item: {
              id: "assistant-101",
              type: "agentMessage",
              text: "snapshot text",
            },
          },
        },
      });
    });

    expect(handlers.onAgentMessageDelta).not.toHaveBeenCalled();
    expect(handlers.onItemUpdated).toHaveBeenCalledTimes(1);
    expect(handlers.onItemUpdated).toHaveBeenCalledWith(
      "ws-claude",
      "claude:session-101",
      expect.objectContaining({
        id: "assistant-101",
        type: "agentMessage",
        text: "snapshot text",
      }),
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("ignores codex item/updated agentMessage snapshot after streaming delta in legacy routing", async () => {
    const handlers: Handlers = {
      onAgentMessageDelta: vi.fn(),
      onItemUpdated: vi.fn(),
    };
    const { root } = await mount(handlers);

    act(() => {
      listener?.({
        workspace_id: "ws-codex",
        message: {
          method: "item/agentMessage/delta",
          params: {
            threadId: "thread-codex-legacy-1",
            itemId: "assistant-codex-legacy-1",
            delta: "codex stream",
          },
        },
      });
    });

    act(() => {
      listener?.({
        workspace_id: "ws-codex",
        message: {
          method: "item/updated",
          params: {
            threadId: "thread-codex-legacy-1",
            item: {
              id: "assistant-codex-legacy-1",
              type: "agentMessage",
              text: "codex snapshot",
            },
          },
        },
      });
    });

    expect(handlers.onAgentMessageDelta).toHaveBeenCalledTimes(1);
    expect(handlers.onAgentMessageDelta).toHaveBeenCalledWith({
      workspaceId: "ws-codex",
      threadId: "thread-codex-legacy-1",
      itemId: "assistant-codex-legacy-1",
      delta: "codex stream",
    });
    expect(handlers.onItemUpdated).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps claude snapshot updates flowing through legacy mode when delta and snapshot coexist", async () => {
    const handlers: Handlers = {
      onAgentMessageDelta: vi.fn(),
      onAgentMessageCompleted: vi.fn(),
      onItemUpdated: vi.fn(),
      onItemStarted: vi.fn(),
    };
    const { root } = await mount(handlers);

    act(() => {
      listener?.({
        workspace_id: "ws-claude",
        message: {
          method: "turn/started",
          params: {
            threadId: "claude:session-seq-2",
            turnId: "turn-2",
          },
        },
      });
      listener?.({
        workspace_id: "ws-claude",
        message: {
          method: "item/agentMessage/delta",
          params: {
            threadId: "claude:session-seq-2",
            itemId: "assistant-seq-2",
            delta: "第一段",
          },
        },
      });
      listener?.({
        workspace_id: "ws-claude",
        message: {
          method: "item/started",
          params: {
            threadId: "claude:session-seq-2",
            item: {
              id: "assistant-seq-2",
              type: "agentMessage",
              text: "第一段",
            },
          },
        },
      });
      listener?.({
        workspace_id: "ws-claude",
        message: {
          method: "item/updated",
          params: {
            threadId: "claude:session-seq-2",
            item: {
              id: "assistant-seq-2",
              type: "agentMessage",
              text: "第一段第二段",
            },
          },
        },
      });
      listener?.({
        workspace_id: "ws-claude",
        message: {
          method: "item/agentMessage/delta",
          params: {
            threadId: "claude:session-seq-2",
            itemId: "assistant-seq-2",
            delta: "第二段",
          },
        },
      });
      listener?.({
        workspace_id: "ws-claude",
        message: {
          method: "item/completed",
          params: {
            threadId: "claude:session-seq-2",
            item: {
              id: "assistant-seq-2",
              type: "agentMessage",
              text: "第一段第二段",
            },
          },
        },
      });
      listener?.({
        workspace_id: "ws-claude",
        message: {
          method: "turn/completed",
          params: {
            threadId: "claude:session-seq-2",
            turnId: "turn-2",
            result: {
              text: "第一段第二段",
            },
          },
        },
      });
    });

    expect(handlers.onAgentMessageDelta).toHaveBeenCalledTimes(2);
    expect(handlers.onAgentMessageDelta).toHaveBeenNthCalledWith(1, {
      workspaceId: "ws-claude",
      threadId: "claude:session-seq-2",
      itemId: "assistant-seq-2",
      delta: "第一段",
    });
    expect(handlers.onAgentMessageDelta).toHaveBeenNthCalledWith(2, {
      workspaceId: "ws-claude",
      threadId: "claude:session-seq-2",
      itemId: "assistant-seq-2",
      delta: "第二段",
    });
    expect(handlers.onItemStarted).not.toHaveBeenCalled();
    expect(handlers.onItemUpdated).toHaveBeenCalledTimes(1);
    expect(handlers.onItemUpdated).toHaveBeenCalledWith(
      "ws-claude",
      "claude:session-seq-2",
      expect.objectContaining({
        id: "assistant-seq-2",
        type: "agentMessage",
        text: "第一段第二段",
      }),
    );
    expect(handlers.onAgentMessageCompleted).toHaveBeenCalledTimes(1);
    expect(handlers.onAgentMessageCompleted).toHaveBeenCalledWith({
      workspaceId: "ws-claude",
      threadId: "claude:session-seq-2",
      itemId: "assistant-seq-2",
      text: "第一段第二段",
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps claude agent completion when only snapshot and completed arrive in legacy mode", async () => {
    const handlers: Handlers = {
      onAgentMessageDelta: vi.fn(),
      onAgentMessageCompleted: vi.fn(),
      onItemUpdated: vi.fn(),
    };
    const { root } = await mount(handlers);

    act(() => {
      listener?.({
        workspace_id: "ws-claude",
        message: {
          method: "item/updated",
          params: {
            threadId: "claude:session-snapshot-only-2",
            item: {
              id: "assistant-snapshot-only-2",
              type: "agentMessage",
              text: "snapshot-only-text",
            },
          },
        },
      });
      listener?.({
        workspace_id: "ws-claude",
        message: {
          method: "item/completed",
          params: {
            threadId: "claude:session-snapshot-only-2",
            item: {
              id: "assistant-snapshot-only-2",
              type: "agentMessage",
              text: "snapshot-only-text",
            },
          },
        },
      });
    });

    expect(handlers.onAgentMessageDelta).not.toHaveBeenCalled();
    expect(handlers.onItemUpdated).toHaveBeenCalledTimes(1);
    expect(handlers.onItemUpdated).toHaveBeenCalledWith(
      "ws-claude",
      "claude:session-snapshot-only-2",
      expect.objectContaining({
        id: "assistant-snapshot-only-2",
        type: "agentMessage",
        text: "snapshot-only-text",
      }),
    );
    expect(handlers.onAgentMessageCompleted).toHaveBeenCalledTimes(1);
    expect(handlers.onAgentMessageCompleted).toHaveBeenCalledWith({
      workspaceId: "ws-claude",
      threadId: "claude:session-snapshot-only-2",
      itemId: "assistant-snapshot-only-2",
      text: "snapshot-only-text",
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps codex agentMessage snapshot routing when no streaming delta was seen in normalized mode", async () => {
    const handlers: Handlers = {
      onAgentMessageDelta: vi.fn(),
    };
    const { root } = await mount(handlers, {
      useNormalizedRealtimeAdapters: true,
    });

    act(() => {
      listener?.({
        workspace_id: "ws-codex",
        message: {
          method: "item/updated",
          params: {
            threadId: "thread-codex-1",
            item: {
              id: "assistant-codex-1",
              type: "agentMessage",
              text: "codex snapshot",
            },
          },
        },
      });
    });

    expect(handlers.onAgentMessageDelta).toHaveBeenCalledTimes(1);
    expect(handlers.onAgentMessageDelta).toHaveBeenCalledWith({
      workspaceId: "ws-codex",
      threadId: "thread-codex-1",
      itemId: "assistant-codex-1",
      delta: "codex snapshot",
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("ignores codex agentMessage snapshot after streaming delta in normalized mode", async () => {
    const handlers: Handlers = {
      onAgentMessageDelta: vi.fn(),
      onItemUpdated: vi.fn(),
    };
    const { root } = await mount(handlers, {
      useNormalizedRealtimeAdapters: true,
    });

    act(() => {
      listener?.({
        workspace_id: "ws-codex",
        message: {
          method: "item/agentMessage/delta",
          params: {
            threadId: "thread-codex-2",
            itemId: "assistant-codex-2",
            delta: "codex stream",
          },
        },
      });
    });

    act(() => {
      listener?.({
        workspace_id: "ws-codex",
        message: {
          method: "item/updated",
          params: {
            threadId: "thread-codex-2",
            item: {
              id: "assistant-codex-2",
              type: "agentMessage",
              text: "codex snapshot",
            },
          },
        },
      });
    });

    expect(handlers.onAgentMessageDelta).toHaveBeenCalledTimes(1);
    expect(handlers.onAgentMessageDelta).toHaveBeenCalledWith({
      workspaceId: "ws-codex",
      threadId: "thread-codex-2",
      itemId: "assistant-codex-2",
      delta: "codex stream",
    });
    expect(handlers.onItemUpdated).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("routes claude text:delta through legacy fallback when normalized adapters are disabled", async () => {
    const handlers: Handlers = {
      onAgentMessageDelta: vi.fn(),
    };
    const { root } = await mount(handlers);

    act(() => {
      listener?.({
        workspace_id: "ws-claude",
        message: {
          method: "text:delta",
          params: {
            threadId: "claude:session-99",
            delta: "streaming text",
          },
        },
      });
    });

    expect(handlers.onAgentMessageDelta).toHaveBeenCalledWith({
      workspaceId: "ws-claude",
      threadId: "claude:session-99",
      itemId: "claude:session-99:text-delta",
      delta: "streaming text",
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("ignores turnId as assistant item id for legacy claude text:delta fallback", async () => {
    const handlers: Handlers = {
      onAgentMessageDelta: vi.fn(),
    };
    const { root } = await mount(handlers);

    act(() => {
      listener?.({
        workspace_id: "ws-claude",
        message: {
          method: "text:delta",
          params: {
            threadId: "claude:session-98",
            turnId: "turn-98",
            delta: "streaming text",
          },
        },
      });
    });

    expect(handlers.onAgentMessageDelta).toHaveBeenCalledWith({
      workspaceId: "ws-claude",
      threadId: "claude:session-98",
      itemId: "claude:session-98:text-delta",
      delta: "streaming text",
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("hydrates tool output from params in legacy item/completed routing", async () => {
    const handlers: Handlers = {
      onItemCompleted: vi.fn(),
    };
    const { root } = await mount(handlers);

    act(() => {
      listener?.({
        workspace_id: "ws-claude",
        message: {
          method: "item/completed",
          params: {
            threadId: "claude:session-42",
            output: "stdout-line-1\nstdout-line-2",
            item: {
              id: "cmd-1",
              type: "commandExecution",
              command: "ls -la",
              status: "completed",
            },
          },
        },
      });
    });

    expect(handlers.onItemCompleted).toHaveBeenCalledWith(
      "ws-claude",
      "claude:session-42",
      expect.objectContaining({
        id: "cmd-1",
        type: "commandExecution",
        aggregatedOutput: "stdout-line-1\nstdout-line-2",
        output: "stdout-line-1\nstdout-line-2",
      }),
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps token usage updates when normalized realtime adapters handle item/completed", async () => {
    const handlers: Handlers = {
      onThreadTokenUsageUpdated: vi.fn(),
      onAgentMessageCompleted: vi.fn(),
    };
    const { root } = await mount(handlers, {
      useNormalizedRealtimeAdapters: true,
    });

    act(() => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "item/completed",
          params: {
            threadId: "thread-1",
            item: { type: "agentMessage", id: "item-1", text: "Done" },
            usage: {
              input_tokens: 10,
              output_tokens: 5,
              cached_input_tokens: 2,
              model_context_window: 128000,
            },
          },
        },
      });
    });

    expect(handlers.onAgentMessageCompleted).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId: "item-1",
      text: "Done",
    });
    expect(handlers.onThreadTokenUsageUpdated).toHaveBeenCalledWith(
      "ws-1",
      "thread-1",
      {
        total: {
          inputTokens: 10,
          outputTokens: 5,
          cachedInputTokens: 2,
          totalTokens: 15,
        },
        last: {
          inputTokens: 10,
          outputTokens: 5,
          cachedInputTokens: 2,
          totalTokens: 15,
        },
        modelContextWindow: 128000,
      },
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("prefers token_count last snapshot while keeping total snapshot", async () => {
    const handlers: Handlers = {
      onThreadTokenUsageUpdated: vi.fn(),
      getActiveCodexThreadId: vi.fn(() => "thread-codex-1"),
    };
    const { root } = await mount(handlers);

    act(() => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "token_count",
          params: {
            info: {
              total_token_usage: {
                input_tokens: 180000,
                cached_input_tokens: 0,
                model_context_window: 200000,
              },
              last_token_usage: {
                input_tokens: 20000,
                cached_input_tokens: 0,
                model_context_window: 200000,
              },
            },
          },
        },
      });
    });

    expect(handlers.onThreadTokenUsageUpdated).toHaveBeenCalledWith(
      "ws-1",
      "thread-codex-1",
      {
        total: {
          inputTokens: 180000,
          outputTokens: 0,
          cachedInputTokens: 0,
          totalTokens: 180000,
        },
        last: {
          inputTokens: 20000,
          outputTokens: 0,
          cachedInputTokens: 0,
          totalTokens: 20000,
        },
        modelContextWindow: 200000,
      },
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps token_count last usage as zero when only total snapshot exists", async () => {
    const handlers: Handlers = {
      onThreadTokenUsageUpdated: vi.fn(),
      getActiveCodexThreadId: vi.fn(() => "thread-codex-2"),
    };
    const { root } = await mount(handlers);

    act(() => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "token_count",
          params: {
            info: {
              total_token_usage: {
                input_tokens: 120000,
                cached_input_tokens: 10000,
                model_context_window: 200000,
              },
            },
          },
        },
      });
    });

    expect(handlers.onThreadTokenUsageUpdated).toHaveBeenCalledWith(
      "ws-1",
      "thread-codex-2",
      {
        total: {
          inputTokens: 120000,
          outputTokens: 0,
          cachedInputTokens: 10000,
          totalTokens: 120000,
        },
        last: {
          inputTokens: 0,
          outputTokens: 0,
          cachedInputTokens: 0,
          totalTokens: 0,
        },
        modelContextWindow: 200000,
      },
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("emits item/completed token usage updates when cached tokens are present", async () => {
    const handlers: Handlers = {
      onThreadTokenUsageUpdated: vi.fn(),
      onItemCompleted: vi.fn(),
    };
    const { root } = await mount(handlers);

    act(() => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "item/completed",
          params: {
            threadId: "thread-1",
            item: { id: "tool-1", type: "command", status: "completed" },
            usage: {
              input_tokens: 0,
              output_tokens: 0,
              cached_input_tokens: 12,
              model_context_window: 200000,
            },
          },
        },
      });
    });

    expect(handlers.onThreadTokenUsageUpdated).toHaveBeenCalledWith(
      "ws-1",
      "thread-1",
      {
        total: {
          inputTokens: 0,
          outputTokens: 0,
          cachedInputTokens: 12,
          totalTokens: 0,
        },
        last: {
          inputTokens: 0,
          outputTokens: 0,
          cachedInputTokens: 12,
          totalTokens: 0,
        },
        modelContextWindow: 200000,
      },
    );

    await act(async () => {
      root.unmount();
    });
  });
});
