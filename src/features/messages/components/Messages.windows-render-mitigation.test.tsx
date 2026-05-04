// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationItem } from "../../../types";
import type { ConversationState } from "../../threads/contracts/conversationCurtainContracts";

const mocks = vi.hoisted(() => ({
  isMacPlatform: vi.fn(),
  isWindowsPlatform: vi.fn(),
  noteThreadVisibleRender: vi.fn(),
  noteThreadVisibleTextRendered: vi.fn(),
  resolveActiveThreadStreamMitigation: vi.fn(),
  useThreadStreamLatencySnapshot: vi.fn(),
}));

vi.mock("../../../utils/platform", () => ({
  isMacPlatform: mocks.isMacPlatform,
  isWindowsPlatform: mocks.isWindowsPlatform,
}));

vi.mock("../../threads/utils/streamLatencyDiagnostics", () => ({
  noteThreadVisibleRender: mocks.noteThreadVisibleRender,
  noteThreadVisibleTextRendered: mocks.noteThreadVisibleTextRendered,
  resolveActiveThreadStreamMitigation: mocks.resolveActiveThreadStreamMitigation,
  useThreadStreamLatencySnapshot: mocks.useThreadStreamLatencySnapshot,
}));

import { Messages } from "./Messages";

function renderMessages(options?: {
  items?: ConversationItem[];
  isThinking?: boolean;
  activeEngine?: "claude" | "codex" | "gemini" | "opencode";
  conversationState?: ConversationState | null;
}) {
  const items: ConversationItem[] = options?.items ?? [
    {
      id: "user-msg",
      kind: "message",
      role: "user",
      text: "继续",
    },
    {
      id: "assistant-msg",
      kind: "message",
      role: "assistant",
      text: "正在处理",
    },
  ];
  return render(
    <Messages
      items={items}
      threadId="thread-1"
      workspaceId="ws-1"
      isThinking={options?.isThinking ?? true}
      activeEngine={options?.activeEngine ?? "claude"}
      conversationState={options?.conversationState ?? null}
      openTargets={[]}
      selectedOpenAppId=""
    />,
  );
}

describe("Messages desktop render-safe mode", () => {
  beforeAll(() => {
    if (!HTMLElement.prototype.scrollIntoView) {
      HTMLElement.prototype.scrollIntoView = vi.fn();
    }
  });

  beforeEach(() => {
    mocks.isMacPlatform.mockReset();
    mocks.isWindowsPlatform.mockReset();
    mocks.noteThreadVisibleRender.mockReset();
    mocks.noteThreadVisibleTextRendered.mockReset();
    mocks.resolveActiveThreadStreamMitigation.mockReset();
    mocks.useThreadStreamLatencySnapshot.mockReset();
    mocks.isMacPlatform.mockReturnValue(false);
    mocks.isWindowsPlatform.mockReturnValue(false);
    mocks.useThreadStreamLatencySnapshot.mockReturnValue(null);
    mocks.resolveActiveThreadStreamMitigation.mockImplementation((snapshot) => {
      const mitigationProfile =
        snapshot && typeof snapshot === "object" && "mitigationProfile" in snapshot
          ? snapshot.mitigationProfile
          : null;
      if (!mitigationProfile) {
        return null;
      }
      return {
        id: mitigationProfile,
        messageStreamingThrottleMs: 48,
        reasoningStreamingThrottleMs: 180,
        renderPlainTextWhileStreaming: true,
      };
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("adds render-safe class for Windows Claude live conversations", () => {
    mocks.isWindowsPlatform.mockReturnValue(true);

    const { container } = renderMessages();

    expect(container.firstElementChild?.className).toContain("claude-render-safe");
  });

  it("adds render-safe class for macOS Claude live conversations", () => {
    mocks.isMacPlatform.mockReturnValue(true);

    const { container } = renderMessages();

    expect(container.firstElementChild?.className).toContain("claude-render-safe");
  });

  it("does not add render-safe class outside supported desktop surfaces", () => {
    const { container } = renderMessages();

    expect(container.firstElementChild?.className).not.toContain("claude-render-safe");
  });

  it("records visible render diagnostics for Gemini live conversations", async () => {
    renderMessages({
      activeEngine: "gemini",
      items: [
        {
          id: "user-gemini",
          kind: "message",
          role: "user",
          text: "继续",
        },
        {
          id: "assistant-gemini",
          kind: "message",
          role: "assistant",
          text: "Gemini 正在输出",
        },
      ],
    });

    expect(mocks.noteThreadVisibleRender).toHaveBeenCalledWith("thread-1", {
      visibleItemCount: expect.any(Number),
    });
    expect(mocks.noteThreadVisibleTextRendered).toHaveBeenCalledWith("thread-1", {
      itemId: "assistant-gemini",
      visibleTextLength: "Gemini 正在输出".length,
    });
  });

  it("uses normalized conversation state when prop thinking flag is stale", () => {
    mocks.isMacPlatform.mockReturnValue(true);

    const conversationState: ConversationState = {
      items: [],
      plan: null,
      userInputQueue: [],
      meta: {
        workspaceId: "ws-1",
        threadId: "thread-1",
        engine: "claude",
        activeTurnId: null,
        isThinking: true,
        heartbeatPulse: null,
        historyRestoredAtMs: null,
      },
    };

    const { container } = renderMessages({
      isThinking: false,
      conversationState,
    });

    expect(container.firstElementChild?.className).toContain("claude-render-safe");
  });

  it("removes render-safe class when normalized conversation state stops processing", () => {
    mocks.isWindowsPlatform.mockReturnValue(true);

    const activeConversationState: ConversationState = {
      items: [],
      plan: null,
      userInputQueue: [],
      meta: {
        workspaceId: "ws-1",
        threadId: "thread-1",
        engine: "claude",
        activeTurnId: null,
        isThinking: true,
        heartbeatPulse: null,
        historyRestoredAtMs: null,
      },
    };

    const idleConversationState: ConversationState = {
      ...activeConversationState,
      meta: {
        ...activeConversationState.meta,
        isThinking: false,
      },
    };

    const { container, rerender } = renderMessages({
      isThinking: true,
      conversationState: activeConversationState,
    });

    expect(container.firstElementChild?.className).toContain("claude-render-safe");

    rerender(
      <Messages
        items={[
          {
            id: "user-msg",
            kind: "message",
            role: "user",
            text: "继续",
          },
          {
            id: "assistant-msg",
            kind: "message",
            role: "assistant",
            text: "正在处理",
          },
        ]}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        activeEngine="claude"
        conversationState={idleConversationState}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.firstElementChild?.className).not.toContain("claude-render-safe");
  });

  it("does not add render-safe class for non-Claude engines on desktop", () => {
    mocks.isWindowsPlatform.mockReturnValue(true);

    const { container } = renderMessages({
      activeEngine: "codex",
    });

    expect(container.firstElementChild?.className).not.toContain("claude-render-safe");
  });

  it("preserves the last readable curtain when Claude enters repeat-turn blanking", () => {
    mocks.useThreadStreamLatencySnapshot.mockReturnValue({
      latencyCategory: "repeat-turn-blanking",
      mitigationProfile: "claude-markdown-stream-recovery",
    });

    const { rerender } = renderMessages();

    expect(screen.queryAllByText("继续").length).toBeGreaterThan(0);
    expect(screen.getByText("正在处理")).toBeTruthy();

    rerender(
      <Messages
        items={[]}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        activeEngine="claude"
        conversationState={null}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(screen.queryAllByText("继续").length).toBeGreaterThan(0);
    expect(screen.getByText("正在处理")).toBeTruthy();

    rerender(
      <Messages
        items={[]}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="claude"
        conversationState={null}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(screen.queryAllByText("继续")).toHaveLength(0);
    expect(screen.queryByText("正在处理")).toBeNull();
  });

  it("preserves the last readable same-turn assistant surface when visible stall regresses to a short stub", () => {
    mocks.useThreadStreamLatencySnapshot.mockReturnValue(null);

    const fullerTurnItems: ConversationItem[] = [
      {
        id: "user-stall",
        kind: "message",
        role: "user",
        text: "帮我分析这个项目",
      },
      {
        id: "assistant-stall",
        kind: "message",
        role: "assistant",
        text: "The user is asking for a project analysis. I should explore the codebase to understand the project structure.",
      },
    ];

    const degradedTurnItems: ConversationItem[] = [
      {
        id: "user-stall",
        kind: "message",
        role: "user",
        text: "帮我分析这个项目",
      },
      {
        id: "assistant-stall",
        kind: "message",
        role: "assistant",
        text: "The user",
      },
    ];

    const activeConversationState: ConversationState = {
      items: fullerTurnItems,
      plan: null,
      userInputQueue: [],
      meta: {
        workspaceId: "ws-1",
        threadId: "thread-1",
        engine: "claude",
        activeTurnId: "turn-visible-stall",
        isThinking: true,
        heartbeatPulse: null,
        historyRestoredAtMs: null,
      },
    };

    const { rerender } = renderMessages({
      items: fullerTurnItems,
      conversationState: activeConversationState,
    });

    expect(screen.getByText(/The user is asking for a project analysis\./)).toBeTruthy();

    mocks.useThreadStreamLatencySnapshot.mockReturnValue({
      latencyCategory: "visible-output-stall-after-first-delta",
      mitigationProfile: "claude-windows-visible-stream",
    });

    rerender(
      <Messages
        items={degradedTurnItems}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        activeEngine="claude"
        conversationState={{
          ...activeConversationState,
          items: degradedTurnItems,
        }}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(screen.getByText(/The user is asking for a project analysis\./)).toBeTruthy();
    expect(screen.getByText("帮我分析这个项目")).toBeTruthy();
  });
});
