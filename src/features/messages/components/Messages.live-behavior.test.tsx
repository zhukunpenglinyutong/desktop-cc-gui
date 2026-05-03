// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationItem } from "../../../types";
import type { ConversationState } from "../../threads/contracts/conversationCurtainContracts";
import { Messages } from "./Messages";

describe("Messages live behavior", () => {
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

  const getMessagesScroller = (container: HTMLElement) => {
    const scroller = container.querySelector(".messages");
    expect(scroller).toBeTruthy();
    return scroller as HTMLDivElement;
  };

  const setScrollerMetrics = (
    scroller: HTMLDivElement,
    scrollTop: number,
    scrollHeight: number | (() => number) = 2400,
  ) => {
    let currentScrollTop = scrollTop;
    Object.defineProperty(scroller, "scrollTop", {
      configurable: true,
      get: () => currentScrollTop,
      set: (value: number) => {
        currentScrollTop = value;
      },
    });
    Object.defineProperty(scroller, "clientHeight", {
      configurable: true,
      value: 720,
    });
    Object.defineProperty(scroller, "scrollHeight", {
      configurable: true,
      get: () => (typeof scrollHeight === "function" ? scrollHeight() : scrollHeight),
    });
  };

  const setMessageOffsetTop = (
    container: HTMLElement,
    messageId: string,
    offsetTop: number,
  ) => {
    const node = container.querySelector(`[data-message-anchor-id="${messageId}"]`);
    expect(node).toBeTruthy();
    Object.defineProperty(node as HTMLDivElement, "offsetTop", {
      configurable: true,
      get: () => offsetTop,
    });
  };

  const scrollMessages = async (scroller: HTMLDivElement, scrollTop: number) => {
    act(() => {
      setScrollerMetrics(scroller, scrollTop);
      fireEvent.scroll(scroller);
    });
    await waitFor(() => {
      expect(scroller.scrollTop).toBe(scrollTop);
    });
  };

  it("scrolls the messages container when receiving a jump-to-message event", () => {
    const items: ConversationItem[] = [
      {
        id: "u1",
        kind: "message",
        role: "user",
        text: "older",
      },
      {
        id: "u2",
        kind: "message",
        role: "user",
        text: "latest",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-jump"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const scroller = getMessagesScroller(container);
    const scrollToSpy = vi.spyOn(scroller, "scrollTo");
    Object.defineProperty(scroller, "clientHeight", {
      configurable: true,
      value: 720,
    });
    Object.defineProperty(scroller, "scrollTop", {
      configurable: true,
      value: 240,
      writable: true,
    });
    Object.defineProperty(scroller, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ top: 120 }),
    });

    const targetNode = container.querySelector('[data-message-anchor-id="u2"]');
    expect(targetNode).toBeTruthy();
    Object.defineProperty(targetNode as HTMLDivElement, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ top: 480 }),
    });

    act(() => {
      document.dispatchEvent(
        new CustomEvent<string>("mossx:jump-to-message", {
          detail: "u2",
        }),
      );
    });

    expect(scrollToSpy).toHaveBeenCalledWith({
      top: Math.max(0, 240 + (480 - 120) - 720 * 0.28),
      behavior: "smooth",
    });
  });

  it("expands collapsed history before jumping to an older message", async () => {
    const items: ConversationItem[] = Array.from({ length: 35 }, (_, index) => ({
      id: `u${index + 1}`,
      kind: "message" as const,
      role: "user" as const,
      text: `message ${index + 1}`,
    }));

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-jump-collapsed"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.querySelector('[data-message-anchor-id="u1"]')).toBeNull();
    const showEarlierButton = container.querySelector(".messages-collapsed-indicator");
    expect(showEarlierButton).toBeTruthy();
    expect(showEarlierButton?.getAttribute("data-collapsed-count")).toBe("5");

    const scroller = getMessagesScroller(container);
    const scrollToSpy = vi.spyOn(scroller, "scrollTo");
    Object.defineProperty(scroller, "clientHeight", {
      configurable: true,
      value: 720,
    });
    Object.defineProperty(scroller, "scrollTop", {
      configurable: true,
      value: 180,
      writable: true,
    });
    Object.defineProperty(scroller, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ top: 120 }),
    });

    act(() => {
      document.dispatchEvent(
        new CustomEvent<string>("mossx:jump-to-message", {
          detail: "u1",
        }),
      );
    });

    await waitFor(() => {
      expect(container.querySelector('[data-message-anchor-id="u1"]')).toBeTruthy();
    });

    await waitFor(() => {
      expect(scrollToSpy).toHaveBeenCalled();
    });
    expect(scrollToSpy.mock.calls.at(-1)?.[0]).toMatchObject({
      behavior: "smooth",
    });
  });

  it("keeps only the latest title-only reasoning row for gemini and mirrors it in the working indicator", () => {
    const items: ConversationItem[] = [
      {
        id: "reasoning-title-only-old",
        kind: "reasoning",
        summary: "Planning old step",
        content: "",
      },
      {
        id: "reasoning-title-only",
        kind: "reasoning",
        summary: "Indexing workspace",
        content: "",
      },
      {
        id: "tool-after-reasoning",
        kind: "tool",
        title: "Command: rg --files",
        detail: "/tmp",
        toolType: "commandExecution",
        output: "",
        status: "running",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="gemini:thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 1_000}
        activeEngine="gemini"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const workingText = container.querySelector(".working-text");
    expect(workingText?.textContent ?? "").toContain("Indexing workspace");
    const reasoningRows = container.querySelectorAll(".thinking-block");
    expect(reasoningRows.length).toBe(1);
    expect(container.querySelector(".thinking-title")).toBeTruthy();
  });

  it("keeps the latest Claude title-only reasoning row on the curtain before the first assistant chunk", () => {
    const items: ConversationItem[] = [
      {
        id: "user-claude-reasoning-visible",
        kind: "message",
        role: "user",
        text: "帮我分析一下项目结构",
      },
      {
        id: "reasoning-claude-old",
        kind: "reasoning",
        summary: "先定位仓库入口",
        content: "",
      },
      {
        id: "reasoning-claude-latest",
        kind: "reasoning",
        summary: "这是一个包含多个子项目的目录。让我探索一下项目结构。",
        content: "",
      },
      {
        id: "tool-claude-read-old",
        kind: "tool",
        title: "批量读取文件 (2)",
        detail: "package.json pyproject.toml",
        toolType: "read",
        output: "",
        status: "completed",
      },
      {
        id: "tool-claude-read-latest",
        kind: "tool",
        title: "批量读取文件 (4)",
        detail: "AGENTS.md next.config.ts README.md",
        toolType: "read",
        output: "",
        status: "running",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="claude:thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 1_000}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const reasoningRows = container.querySelectorAll(".thinking-block");
    expect(reasoningRows.length).toBe(1);
    const reasoningTitle = container.querySelector(".thinking-title");
    expect(reasoningTitle?.textContent ?? "").toBeTruthy();
    expect(container.querySelector(".working-text")?.textContent ?? "").not.toContain(
      "这是一个包含多个子项目的目录。让我探索一下项目结构。",
    );
    expect(container.querySelector(".working-activity")?.textContent ?? "").toContain(
      "批量读取文件 (4)",
    );
  });

  it("renders Claude reasoning and assistant message together when conversation state reuses the same item id", () => {
    const conversationState: ConversationState = {
      items: [
        {
          id: "user-shared-id",
          kind: "message",
          role: "user",
          text: "分析一下这个项目",
        },
        {
          id: "claude-live-shared",
          kind: "reasoning",
          summary: "我先梳理目录结构。",
          content: "我先梳理目录结构。",
        },
        {
          id: "claude-live-shared",
          kind: "message",
          role: "assistant",
          text: "# 项目分析\n\n这里是实时正文。",
        },
      ],
      plan: null,
      userInputQueue: [],
      meta: {
        workspaceId: "ws-1",
        threadId: "claude:thread-shared-id",
        engine: "claude",
        activeTurnId: "turn-1",
        isThinking: true,
        heartbeatPulse: null,
        historyRestoredAtMs: null,
      },
    };

    const { container } = render(
      <Messages
        items={[]}
        threadId="claude:thread-shared-id"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 1_000}
        activeEngine="claude"
        conversationState={conversationState}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.querySelectorAll(".thinking-block").length).toBe(1);
    expect(container.textContent ?? "").toContain("这里是实时正文。");
  });

  it("hides command cards in codex canvas while keeping non-command tool cards", () => {
    const items: ConversationItem[] = [
      {
        id: "tool-codex-command-1",
        kind: "tool",
        title: "Command: pwd && ls -la",
        detail: "/tmp",
        toolType: "commandExecution",
        output: "done",
        status: "completed",
      },
      {
        id: "tool-codex-command-2",
        kind: "tool",
        title: "Command: echo done",
        detail: "/tmp",
        toolType: "commandExecution",
        output: "done",
        status: "completed",
      },
      {
        id: "tool-codex-edit-1",
        kind: "tool",
        title: "Tool: edit",
        detail: JSON.stringify({
          file_path: "src/keep.ts",
          old_string: "before",
          new_string: "after",
        }),
        toolType: "edit",
        status: "completed",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="codex"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.querySelector(".bash-group-container")).toBeNull();
    expect(container.textContent ?? "").not.toContain("pwd && ls -la");
    expect(container.textContent ?? "").not.toContain("echo done");
    expect(container.textContent ?? "").toContain("keep.ts");
  });

  it("hides command cards in claude canvas", () => {
    const items: ConversationItem[] = [
      {
        id: "tool-claude-command-1",
        kind: "tool",
        title: "Command: pwd && ls -la",
        detail: "/tmp",
        toolType: "commandExecution",
        output: "done",
        status: "completed",
      },
      {
        id: "tool-claude-command-2",
        kind: "tool",
        title: "Command: echo done",
        detail: "/tmp",
        toolType: "commandExecution",
        output: "done",
        status: "completed",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.querySelector(".bash-group-container")).toBeNull();
    expect(container.textContent ?? "").not.toContain("pwd && ls -la");
    expect(container.textContent ?? "").not.toContain("echo done");
  });

  it.each(["codex", "claude", "gemini"] as const)(
    "switches %s working spinner between waiting and ingress phases",
    (activeEngine) => {
      vi.useFakeTimers();
      try {
        const baseItems: ConversationItem[] = [
          {
            id: "user-stream-phase",
            kind: "message",
            role: "user",
            text: "继续输出",
          },
          {
            id: "assistant-stream-phase",
            kind: "message",
            role: "assistant",
            text: "",
          },
        ];

        const { container, rerender } = render(
          <Messages
            items={baseItems}
            threadId="thread-1"
            workspaceId="ws-1"
            isThinking
            processingStartedAt={Date.now() - 1_000}
            activeEngine={activeEngine}
            openTargets={[]}
            selectedOpenAppId=""
          />,
        );

        const waitingNode = container.querySelector(".working");
        expect(waitingNode?.className ?? "").toContain("is-waiting");

        rerender(
          <Messages
            items={[
              baseItems[0]!,
              {
                id: "assistant-stream-phase",
                kind: "message",
                role: "assistant",
                text: "增量片段",
              },
            ]}
            threadId="thread-1"
            workspaceId="ws-1"
            isThinking
            processingStartedAt={Date.now() - 1_000}
            activeEngine={activeEngine}
            openTargets={[]}
            selectedOpenAppId=""
          />,
        );

        const ingressNode = container.querySelector(".working");
        expect(ingressNode?.className ?? "").toContain("is-ingress");

        act(() => {
          vi.advanceTimersByTime(1_200);
        });

        const backToWaitingNode = container.querySelector(".working");
        expect(backToWaitingNode?.className ?? "").toContain("is-waiting");
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("shows a working indicator while context compaction is in progress", () => {
    const { container } = render(
      <Messages
        items={[
          {
            id: "assistant-before-compaction",
            kind: "message",
            role: "assistant",
            text: "已有上下文",
          },
        ]}
        threadId="claude:thread-compact-1"
        workspaceId="ws-1"
        isThinking={false}
        isContextCompacting={true}
        activeEngine="claude"
        processingStartedAt={Date.now() - 1_000}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const workingNode = container.querySelector(".working");
    const workingText = container.querySelector(".working-text");
    expect(workingNode).toBeTruthy();
    expect(workingText?.textContent ?? "").toContain("Compacting context");
  });

  it("shows approval resume status as the primary working label for Claude file approvals", () => {
    const { container } = render(
      <Messages
        items={[
          {
            id: "user-approval-resume",
            kind: "message",
            role: "user",
            text: "创建 3 个文件",
          },
          {
            id: "assistant-before-approval",
            kind: "message",
            role: "assistant",
            text: "我会先创建文件。",
            isFinal: true,
          },
          {
            id: "file-approval-running",
            kind: "tool",
            toolType: "fileChange",
            title: "Applying approved file change",
            detail: "{\"file_path\":\"aaa.txt\"}",
            status: "running",
            output: "Approved. Applying the change locally and resuming Claude...",
          },
        ]}
        threadId="claude:thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 800}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.querySelector(".working-text")?.textContent ?? "").toContain(
      "resuming Claude",
    );
    expect(container.querySelector(".working-activity")?.textContent ?? "").toContain(
      "Applying approved file change",
    );
  });

  it.each(["codex", "claude", "gemini"] as const)(
    "detects ingress for %s even when chunk length is unchanged",
    (activeEngine) => {
      vi.useFakeTimers();
      try {
        const { container, rerender } = render(
          <Messages
            items={[
              {
                id: "user-stream-same-length",
                kind: "message",
                role: "user",
                text: "继续输出",
              },
              {
                id: "assistant-stream-same-length",
                kind: "message",
                role: "assistant",
                text: "aaaa",
              },
            ]}
            threadId="thread-1"
            workspaceId="ws-1"
            isThinking
            processingStartedAt={Date.now() - 1_000}
            activeEngine={activeEngine}
            openTargets={[]}
            selectedOpenAppId=""
          />,
        );

        const baselineNode = container.querySelector(".working");
        expect(baselineNode?.className ?? "").toContain("is-waiting");

        rerender(
          <Messages
            items={[
              {
                id: "user-stream-same-length",
                kind: "message",
                role: "user",
                text: "继续输出",
              },
              {
                id: "assistant-stream-same-length",
                kind: "message",
                role: "assistant",
                text: "bbbb",
              },
            ]}
            threadId="thread-1"
            workspaceId="ws-1"
            isThinking
            processingStartedAt={Date.now() - 1_000}
            activeEngine={activeEngine}
            openTargets={[]}
            selectedOpenAppId=""
          />,
        );

        const ingressNode = container.querySelector(".working");
        expect(ingressNode?.className ?? "").toContain("is-ingress");
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("disables auto-follow scrolling when live auto-follow toggle is off", () => {
    window.localStorage.setItem("ccgui.messages.live.autoFollow", "0");
    const scrollSpy = vi
      .spyOn(HTMLElement.prototype, "scrollIntoView")
      .mockImplementation(() => {});
    const { rerender } = render(
      <Messages
        items={[
          {
            id: "assistant-live-scroll-1",
            kind: "message",
            role: "assistant",
            text: "first chunk",
          },
        ]}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 1_000}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    rerender(
      <Messages
        items={[
          {
            id: "assistant-live-scroll-1",
            kind: "message",
            role: "assistant",
            text: "first chunk",
          },
          {
            id: "assistant-live-scroll-2",
            kind: "message",
            role: "assistant",
            text: "second chunk",
          },
        ]}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 1_000}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(scrollSpy).not.toHaveBeenCalled();
    scrollSpy.mockRestore();
  });

  it("keeps auto-follow working after manual scroll when enabled", async () => {
    window.localStorage.setItem("ccgui.messages.live.autoFollow", "1");
    const scrollSpy = vi
      .spyOn(HTMLElement.prototype, "scrollIntoView")
      .mockImplementation(() => {});
    const { container, rerender } = render(
      <Messages
        items={[
          {
            id: "assistant-live-follow-1",
            kind: "message",
            role: "assistant",
            text: "first chunk",
          },
        ]}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 1_000}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const scroller = container.querySelector(".messages") as HTMLDivElement | null;
    expect(scroller).toBeTruthy();
    if (!scroller) {
      throw new Error("expected messages scroller");
    }
    Object.defineProperty(scroller, "scrollHeight", { value: 2000, configurable: true });
    Object.defineProperty(scroller, "clientHeight", { value: 500, configurable: true });
    Object.defineProperty(scroller, "scrollTop", { value: 400, writable: true, configurable: true });
    fireEvent.scroll(scroller);

    const baselineCalls = scrollSpy.mock.calls.length;

    rerender(
      <Messages
        items={[
          {
            id: "assistant-live-follow-1",
            kind: "message",
            role: "assistant",
            text: "first chunk",
          },
          {
            id: "assistant-live-follow-2",
            kind: "message",
            role: "assistant",
            text: "second chunk",
          },
        ]}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 1_000}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    await waitFor(() => {
      expect(scrollSpy.mock.calls.length).toBeGreaterThan(baselineCalls);
    });
    scrollSpy.mockRestore();
  });

  it("uses the shared condensed sticky header for the latest ordinary user question during realtime processing", async () => {
    const items: ConversationItem[] = [
      {
        id: "user-live-sticky-old",
        kind: "message",
        role: "user",
        text: "第一个问题",
      },
      {
        id: "assistant-live-sticky-old",
        kind: "message",
        role: "assistant",
        text: "第一轮答案",
      },
      {
        id: "user-live-sticky-latest",
        kind: "message",
        role: "user",
        text: "当前实时问题",
      },
      {
        id: "reasoning-live-sticky",
        kind: "reasoning",
        summary: "分析中",
        content: "",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 1_000}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.querySelector(".messages-live-sticky-user-message")).toBeNull();
    const scroller = getMessagesScroller(container);
    setMessageOffsetTop(container, "user-live-sticky-old", 12);
    setMessageOffsetTop(container, "user-live-sticky-latest", 24);

    await scrollMessages(scroller, 24);
    await waitFor(() => {
      const stickyHeader = container.querySelector(".messages-history-sticky-header");
      expect(stickyHeader?.getAttribute("data-history-sticky-message-id")).toBe(
        "user-live-sticky-latest",
      );
      expect(stickyHeader?.textContent ?? "").toContain("当前实时问题");
    });
  });

  it("can hide the sticky user bubble without removing the user message from the canvas", async () => {
    const items: ConversationItem[] = [
      {
        id: "user-sticky-hidden",
        kind: "message",
        role: "user",
        text: "这个问题仍然在幕布里",
      },
      {
        id: "assistant-sticky-hidden",
        kind: "message",
        role: "assistant",
        text: "回答仍然正常显示",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-sticky-hidden"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
        showStickyUserBubble={false}
      />,
    );

    const scroller = getMessagesScroller(container);
    setMessageOffsetTop(container, "user-sticky-hidden", 20);

    await scrollMessages(scroller, 20);

    expect(
      container.querySelector('[data-message-anchor-id="user-sticky-hidden"]'),
    ).toBeTruthy();
    expect(container.querySelector(".messages-history-sticky-header")).toBeNull();
  });

  it("can collapse the sticky header into a right-side peek tab and expand it again", async () => {
    const items: ConversationItem[] = [
      {
        id: "user-sticky-toggle",
        kind: "message",
        role: "user",
        text: "这是一个可以收起的悬浮问题条",
      },
      {
        id: "assistant-sticky-toggle",
        kind: "message",
        role: "assistant",
        text: "这是回答",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-sticky-toggle"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const scroller = getMessagesScroller(container);
    setMessageOffsetTop(container, "user-sticky-toggle", 20);

    await scrollMessages(scroller, 20);

    const stickyHeader = await waitFor(() => {
      const node = container.querySelector(".messages-history-sticky-header");
      expect(node).toBeTruthy();
      return node as HTMLElement;
    });

    expect(stickyHeader.getAttribute("data-history-sticky-collapsed")).toBe("false");

    const collapseButton = container.querySelector(
      '[data-history-sticky-toggle="collapse"]',
    ) as HTMLButtonElement | null;
    expect(collapseButton).toBeTruthy();

    fireEvent.click(collapseButton!);

    await waitFor(() => {
      expect(stickyHeader.getAttribute("data-history-sticky-collapsed")).toBe("true");
    });

    expect(
      container.querySelector('[data-history-sticky-toggle="collapse"]'),
    ).toBeNull();

    const expandButton = container.querySelector(
      '[data-history-sticky-toggle="expand"]',
    ) as HTMLButtonElement | null;
    expect(expandButton).toBeTruthy();

    fireEvent.click(expandButton!);

    await waitFor(() => {
      expect(stickyHeader.getAttribute("data-history-sticky-collapsed")).toBe("false");
    });

    expect(
      container.querySelector('[data-history-sticky-toggle="expand"]'),
    ).toBeNull();
  });

  it("resets sticky header collapse state when switching threads", async () => {
    const items: ConversationItem[] = [
      {
        id: "user-sticky-thread-a",
        kind: "message",
        role: "user",
        text: "线程 A 的问题",
      },
      {
        id: "assistant-sticky-thread-a",
        kind: "message",
        role: "assistant",
        text: "线程 A 的回答",
      },
    ];

    const { container, rerender } = render(
      <Messages
        items={items}
        threadId="thread-sticky-a"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const scroller = getMessagesScroller(container);
    setMessageOffsetTop(container, "user-sticky-thread-a", 18);
    await scrollMessages(scroller, 18);

    const collapseButton = await waitFor(() => {
      const node = container.querySelector(
        '[data-history-sticky-toggle="collapse"]',
      ) as HTMLButtonElement | null;
      expect(node).toBeTruthy();
      return node as HTMLButtonElement;
    });

    fireEvent.click(collapseButton);

    await waitFor(() => {
      expect(
        container
          .querySelector(".messages-history-sticky-header")
          ?.getAttribute("data-history-sticky-collapsed"),
      ).toBe("true");
    });

    rerender(
      <Messages
        items={[
          {
            id: "user-sticky-thread-b",
            kind: "message",
            role: "user",
            text: "线程 B 的问题",
          },
          {
            id: "assistant-sticky-thread-b",
            kind: "message",
            role: "assistant",
            text: "线程 B 的回答",
          },
        ]}
        threadId="thread-sticky-b"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    setMessageOffsetTop(container, "user-sticky-thread-b", 18);
    await scrollMessages(scroller, 18);

    await waitFor(() => {
      expect(
        container
          .querySelector(".messages-history-sticky-header")
          ?.getAttribute("data-history-sticky-collapsed"),
      ).toBe("false");
    });
  });

  it("uses history-style sticky handoff when scrolling back to earlier sections during realtime processing", async () => {
    const items: ConversationItem[] = [
      {
        id: "user-live-handoff-earlier",
        kind: "message",
        role: "user",
        text: "更早的问题",
      },
      {
        id: "assistant-live-handoff-earlier",
        kind: "message",
        role: "assistant",
        text: "更早的回答",
      },
      {
        id: "user-live-handoff-latest",
        kind: "message",
        role: "user",
        text: "最新的问题",
      },
      {
        id: "reasoning-live-handoff",
        kind: "reasoning",
        summary: "分析中",
        content: "",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 1_000}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const scroller = getMessagesScroller(container);
    setMessageOffsetTop(container, "user-live-handoff-earlier", 18);
    setMessageOffsetTop(container, "user-live-handoff-latest", 260);

    await scrollMessages(scroller, 18);
    await waitFor(() => {
      expect(
        container
          .querySelector(".messages-history-sticky-header")
          ?.getAttribute("data-history-sticky-message-id"),
      ).toBe("user-live-handoff-earlier");
    });

    await scrollMessages(scroller, 260);
    await waitFor(() => {
      expect(
        container
          .querySelector(".messages-history-sticky-header")
          ?.getAttribute("data-history-sticky-message-id"),
      ).toBe("user-live-handoff-latest");
    });
  });

  it("keeps the latest sticky user question renderable when realtime windowing trims the list", async () => {
    const overflowingRealtimeItems: ConversationItem[] = [
      {
        id: "user-live-sticky-windowed",
        kind: "message",
        role: "user",
        text: "这个问题必须常驻",
      },
      ...Array.from({ length: 35 }, (_, index): ConversationItem => ({
        id: `assistant-live-sticky-windowed-${index}`,
        kind: "message",
        role: "assistant",
        text: `实时响应片段 ${index + 1}`,
      })),
    ];

    const { container } = render(
      <Messages
        items={overflowingRealtimeItems}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 1_000}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.querySelector(".messages-live-sticky-user-message")).toBeNull();
    expect(container.textContent ?? "").toContain("这个问题必须常驻");
    const scroller = getMessagesScroller(container);
    setMessageOffsetTop(container, "user-live-sticky-windowed", 30);

    await scrollMessages(scroller, 30);
    await waitFor(() => {
      expect(
        container
          .querySelector(".messages-history-sticky-header")
          ?.getAttribute("data-history-sticky-message-id"),
      ).toBe("user-live-sticky-windowed");
    });
  });

  it("does not keep a phantom collapsed-history indicator when the sticky question is the only trimmed item", async () => {
    const items: ConversationItem[] = [
      {
        id: "user-live-sticky-only-hidden",
        kind: "message",
        role: "user",
        text: "唯一被裁掉的问题",
      },
      ...Array.from({ length: 30 }, (_, index): ConversationItem => ({
        id: `assistant-live-sticky-only-hidden-${index}`,
        kind: "message",
        role: "assistant",
        text: `实时响应片段 ${index + 1}`,
      })),
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 1_000}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.querySelector(".messages-live-sticky-user-message")).toBeNull();
    expect(container.querySelector(".messages-collapsed-indicator")).toBeNull();
    const scroller = getMessagesScroller(container);
    setMessageOffsetTop(container, "user-live-sticky-only-hidden", 18);

    await scrollMessages(scroller, 18);
    await waitFor(() => {
      expect(
        container
          .querySelector(".messages-history-sticky-header")
          ?.getAttribute("data-history-sticky-message-id"),
      ).toBe("user-live-sticky-only-hidden");
    });
  });

  it("hands off from realtime sticky semantics to history sticky semantics when processing ends", async () => {
    const items: ConversationItem[] = [
      {
        id: "user-live-sticky-recover",
        kind: "message",
        role: "user",
        text: "当前实时问题",
      },
      {
        id: "reasoning-live-sticky-recover",
        kind: "reasoning",
        summary: "分析中",
        content: "",
      },
    ];

    const { container, rerender } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 1_000}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const scroller = getMessagesScroller(container);
    setMessageOffsetTop(container, "user-live-sticky-recover", 20);
    await scrollMessages(scroller, 20);
    await waitFor(() => {
      expect(
        container
          .querySelector(".messages-history-sticky-header")
          ?.getAttribute("data-history-sticky-message-id"),
      ).toBe("user-live-sticky-recover");
    });

    rerender(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(
      container
        .querySelector(".messages-history-sticky-header")
        ?.getAttribute("data-history-sticky-message-id"),
    ).toBe("user-live-sticky-recover");
  });

  it("uses a compact history sticky header that follows scroll position without early switching", async () => {
    const items: ConversationItem[] = [
      {
        id: "user-history-sticky-1",
        kind: "message",
        role: "user",
        text: "第一个历史问题",
      },
      {
        id: "assistant-history-sticky-1",
        kind: "message",
        role: "assistant",
        text: "第一轮历史回答",
      },
      {
        id: "user-history-sticky-2",
        kind: "message",
        role: "user",
        text: "第二个历史问题",
      },
      {
        id: "assistant-history-sticky-2",
        kind: "message",
        role: "assistant",
        text: "第二轮历史回答",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.querySelectorAll(".messages-live-sticky-user-message")).toHaveLength(0);
    const scroller = getMessagesScroller(container);
    setMessageOffsetTop(container, "user-history-sticky-1", 18);
    setMessageOffsetTop(container, "user-history-sticky-2", 260);

    await scrollMessages(scroller, 18);
    await waitFor(() => {
      const stickyHeader = container.querySelector(".messages-history-sticky-header");
      expect(stickyHeader?.getAttribute("data-history-sticky-message-id")).toBe(
        "user-history-sticky-1",
      );
      expect(stickyHeader?.textContent ?? "").toContain("第一个历史问题");
    });

    await scrollMessages(scroller, 240);
    await waitFor(() => {
      expect(
        container
          .querySelector(".messages-history-sticky-header")
          ?.getAttribute("data-history-sticky-message-id"),
      ).toBe("user-history-sticky-1");
    });

    await scrollMessages(scroller, 260);
    await waitFor(() => {
      const stickyHeader = container.querySelector(".messages-history-sticky-header");
      expect(stickyHeader?.getAttribute("data-history-sticky-message-id")).toBe(
        "user-history-sticky-2",
      );
      expect(stickyHeader?.textContent ?? "").toContain("第二个历史问题");
    });

    await scrollMessages(scroller, 120);
    await waitFor(() => {
      expect(
        container
          .querySelector(".messages-history-sticky-header")
          ?.getAttribute("data-history-sticky-message-id"),
      ).toBe("user-history-sticky-1");
    });
  });

  it("uses history sticky headers for restored history snapshots instead of live sticky", async () => {
    const restoredItems: ConversationItem[] = [
      {
        id: "user-history-sticky-restored",
        kind: "message",
        role: "user",
        text: "历史问题",
      },
      {
        id: "assistant-history-sticky-disabled",
        kind: "message",
        role: "assistant",
        text: "历史答案",
      },
    ];
    const conversationState: ConversationState = {
      items: restoredItems,
      plan: null,
      userInputQueue: [],
      meta: {
        workspaceId: "ws-1",
        threadId: "thread-1",
        engine: "codex",
        activeTurnId: null,
        isThinking: true,
        heartbeatPulse: null,
        historyRestoredAtMs: Date.now(),
      },
    };

    const { container } = render(
      <Messages
        items={[]}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        conversationState={conversationState}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.querySelector(".messages-live-sticky-user-message")).toBeNull();
    const scroller = getMessagesScroller(container);
    setMessageOffsetTop(container, "user-history-sticky-restored", 24);

    await scrollMessages(scroller, 24);
    await waitFor(() => {
      expect(
        container
          .querySelector(".messages-history-sticky-header")
          ?.getAttribute("data-history-sticky-message-id"),
      ).toBe("user-history-sticky-restored");
    });
  });

  it("keeps the latest restored user question renderable even when live sticky is disabled", () => {
    const conversationState: ConversationState = {
      items: [
        {
          id: "user-restored-windowed",
          kind: "message",
          role: "user",
          text: "恢复态里这条问题不能被裁掉",
        },
        ...Array.from({ length: 65 }, (_, index): ConversationItem => ({
          id: `assistant-restored-windowed-${index}`,
          kind: "message",
          role: "assistant",
          text: `恢复态响应 ${index + 1}`,
        })),
      ],
      plan: null,
      userInputQueue: [],
      meta: {
        workspaceId: "ws-1",
        threadId: "thread-restored-windowed",
        engine: "codex",
        activeTurnId: null,
        isThinking: true,
        heartbeatPulse: null,
        historyRestoredAtMs: Date.now(),
      },
    };

    const { container } = render(
      <Messages
        items={[]}
        threadId="thread-restored-windowed"
        workspaceId="ws-1"
        isThinking
        conversationState={conversationState}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.querySelector(".messages-live-sticky-user-message")).toBeNull();
    expect(container.textContent ?? "").toContain("恢复态里这条问题不能被裁掉");
  });

  it("does not pin memory-only injected user payloads as the latest live question", async () => {
    const items: ConversationItem[] = [
      {
        id: "user-live-real-question",
        kind: "message",
        role: "user",
        text: "真正的问题在这里",
      },
      {
        id: "user-live-memory-only",
        kind: "message",
        role: "user",
        text: "<project-memory>\n[项目上下文] 已记录会话摘要\n</project-memory>\n",
      },
      {
        id: "reasoning-live-after-memory-only",
        kind: "reasoning",
        summary: "分析中",
        content: "",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 1_000}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.querySelector(".messages-live-sticky-user-message")).toBeNull();
    const scroller = getMessagesScroller(container);
    setMessageOffsetTop(container, "user-live-real-question", 22);

    await scrollMessages(scroller, 22);
    await waitFor(() => {
      expect(
        container
          .querySelector(".messages-history-sticky-header")
          ?.getAttribute("data-history-sticky-message-id"),
      ).toBe("user-live-real-question");
    });
  });

  it("excludes pseudo-user rows from history sticky headers", async () => {
    const items: ConversationItem[] = [
      {
        id: "user-history-real-question",
        kind: "message",
        role: "user",
        text: "真正的历史问题",
      },
      {
        id: "assistant-history-real-answer",
        kind: "message",
        role: "assistant",
        text: "真实回答",
      },
      {
        id: "user-history-agent-task",
        kind: "message",
        role: "user",
        text: `
<task-notification>
  <task-id>task-42</task-id>
  <summary>Agent "Builder"</summary>
  <result>done</result>
</task-notification>`,
      },
      {
        id: "user-history-memory-only",
        kind: "message",
        role: "user",
        text: "<project-memory>\n[项目上下文] 已记录会话摘要\n</project-memory>\n",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const scroller = getMessagesScroller(container);
    setMessageOffsetTop(container, "user-history-real-question", 20);

    await scrollMessages(scroller, 20);
    await waitFor(() => {
      const stickyHeader = container.querySelector(".messages-history-sticky-header");
      expect(stickyHeader?.getAttribute("data-history-sticky-message-id")).toBe(
        "user-history-real-question",
      );
      expect(stickyHeader?.textContent ?? "").toContain("真正的历史问题");
    });
  });

  it("does not create phantom history sticky headers for collapsed hidden user questions", () => {
    const items: ConversationItem[] = [
      {
        id: "user-history-hidden-only",
        kind: "message",
        role: "user",
        text: "被窗口裁掉的历史问题",
      },
      ...Array.from({ length: 30 }, (_, index): ConversationItem => ({
        id: `assistant-history-hidden-only-${index}`,
        kind: "message",
        role: "assistant",
        text: `历史回答片段 ${index + 1}`,
      })),
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.querySelector(".messages-history-sticky-header")).toBeNull();
    expect(container.querySelector(".messages-collapsed-indicator")).toBeTruthy();
  });

  it("preserves the current viewport position when revealing collapsed history", async () => {
    const items: ConversationItem[] = Array.from({ length: 32 }, (_, index) => ({
      id: `history-reveal-${index + 1}`,
      kind: "message",
      role: index % 2 === 0 ? "user" : "assistant",
      text: `history reveal message ${index + 1}`,
    }));

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-history-reveal"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const scroller = getMessagesScroller(container);
    setScrollerMetrics(
      scroller,
      420,
      () => (container.querySelector(".messages-collapsed-indicator") ? 2400 : 2560),
    );

    const indicator = container.querySelector(".messages-collapsed-indicator");
    expect(indicator).toBeTruthy();
    if (!indicator) {
      return;
    }

    fireEvent.click(indicator);

    await waitFor(() => {
      expect(container.querySelector(".messages-collapsed-indicator")).toBeNull();
      expect(screen.getByText("history reveal message 1")).toBeTruthy();
      expect(scroller.scrollTop).toBe(580);
    });
  });

  it("skips scroll restoration when scroller metrics are non-finite", async () => {
    const items: ConversationItem[] = Array.from({ length: 32 }, (_, index) => ({
      id: `history-reveal-invalid-${index + 1}`,
      kind: "message",
      role: index % 2 === 0 ? "user" : "assistant",
      text: `history reveal invalid message ${index + 1}`,
    }));

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-history-reveal-invalid"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const scroller = getMessagesScroller(container);
    setScrollerMetrics(scroller, 420, Number.NaN);

    const indicator = container.querySelector(".messages-collapsed-indicator");
    expect(indicator).toBeTruthy();
    if (!indicator) {
      return;
    }

    fireEvent.click(indicator);

    await waitFor(() => {
      expect(container.querySelector(".messages-collapsed-indicator")).toBeNull();
      expect(screen.getByText("history reveal invalid message 1")).toBeTruthy();
      expect(scroller.scrollTop).toBe(420);
    });
  });

  it("collapses live middle steps when enabled", () => {
    window.localStorage.setItem("ccgui.messages.live.collapseMiddleSteps", "1");
    const items: ConversationItem[] = [
      {
        id: "user-live-collapse",
        kind: "message",
        role: "user",
        text: "请继续",
      },
      {
        id: "reasoning-live-collapse",
        kind: "reasoning",
        summary: "分析中",
        content: "",
      },
      {
        id: "tool-live-collapse",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: rg --files",
        detail: "/tmp",
        status: "running",
        output: "",
      },
      {
        id: "assistant-live-collapse",
        kind: "message",
        role: "assistant",
        text: "最终输出",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 1_000}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.querySelector(".messages-live-middle-collapsed-indicator")).toBeTruthy();
    expect(container.querySelector(".thinking-block")).toBeNull();
    expect(container.textContent ?? "").toContain("最终输出");
    expect(container.textContent ?? "").not.toContain("Command: rg --files");
  });

  it("excludes hidden commands and batch commands from the live collapsed count", () => {
    window.localStorage.setItem("ccgui.messages.live.collapseMiddleSteps", "1");
    const items: ConversationItem[] = [
      {
        id: "user-live-collapse-count",
        kind: "message",
        role: "user",
        text: "请继续",
      },
      {
        id: "reasoning-live-collapse-count",
        kind: "reasoning",
        summary: "分析中",
        content: "",
      },
      {
        id: "tool-live-collapse-count-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: rg --files",
        detail: "/tmp",
        status: "running",
        output: "",
      },
      {
        id: "tool-live-collapse-count-2",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: ls -la",
        detail: "/tmp",
        status: "running",
        output: "",
      },
      {
        id: "assistant-live-collapse-count",
        kind: "message",
        role: "assistant",
        text: "最终输出",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 1_000}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const indicator = container.querySelector(".messages-live-middle-collapsed-indicator");
    expect(indicator?.textContent ?? "").toContain("已折叠 1 条中间步骤（实时中）");
    expect(container.textContent ?? "").not.toContain("Command: rg --files");
    expect(container.textContent ?? "").not.toContain("Command: ls -la");
  });

  it("does not show a live collapsed indicator when only hidden commands were skipped", () => {
    window.localStorage.setItem("ccgui.messages.live.collapseMiddleSteps", "1");
    const items: ConversationItem[] = [
      {
        id: "user-live-collapse-commands-only",
        kind: "message",
        role: "user",
        text: "请继续",
      },
      {
        id: "tool-live-collapse-commands-only-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: rg --files",
        detail: "/tmp",
        status: "running",
        output: "",
      },
      {
        id: "tool-live-collapse-commands-only-2",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: ls -la",
        detail: "/tmp",
        status: "running",
        output: "",
      },
      {
        id: "assistant-live-collapse-commands-only",
        kind: "message",
        role: "assistant",
        text: "最终输出",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 1_000}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.querySelector(".messages-live-middle-collapsed-indicator")).toBeNull();
    expect(container.textContent ?? "").toContain("最终输出");
  });

  it("collapses middle steps in history mode when enabled", () => {
    window.localStorage.setItem("ccgui.messages.live.collapseMiddleSteps", "1");
    const items: ConversationItem[] = [
      {
        id: "user-history-collapse",
        kind: "message",
        role: "user",
        text: "请继续",
      },
      {
        id: "reasoning-history-collapse",
        kind: "reasoning",
        summary: "分析中",
        content: "",
      },
      {
        id: "tool-history-collapse",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: rg --files",
        detail: "/tmp",
        status: "completed",
        output: "",
      },
      {
        id: "assistant-history-collapse",
        kind: "message",
        role: "assistant",
        text: "历史最终输出",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.querySelector(".thinking-block")).toBeNull();
    expect(container.textContent ?? "").toContain("历史最终输出");
    expect(container.textContent ?? "").not.toContain("Command: rg --files");
  });

  it("collapses middle steps for all previous turns in history mode", () => {
    window.localStorage.setItem("ccgui.messages.live.collapseMiddleSteps", "1");
    const items: ConversationItem[] = [
      {
        id: "user-history-turn-1",
        kind: "message",
        role: "user",
        text: "第一个问题",
      },
      {
        id: "reasoning-history-turn-1",
        kind: "reasoning",
        summary: "第一轮分析",
        content: "",
      },
      {
        id: "tool-history-turn-1",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: ls",
        detail: "/tmp",
        status: "completed",
        output: "",
      },
      {
        id: "assistant-history-turn-1",
        kind: "message",
        role: "assistant",
        text: "第一轮答案",
      },
      {
        id: "user-history-turn-2",
        kind: "message",
        role: "user",
        text: "第二个问题",
      },
      {
        id: "reasoning-history-turn-2",
        kind: "reasoning",
        summary: "第二轮分析",
        content: "",
      },
      {
        id: "tool-history-turn-2",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: rg --files",
        detail: "/tmp",
        status: "completed",
        output: "",
      },
      {
        id: "assistant-history-turn-2",
        kind: "message",
        role: "assistant",
        text: "第二轮答案",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.textContent ?? "").toContain("第一轮答案");
    expect(container.textContent ?? "").toContain("第二轮答案");
    expect(container.textContent ?? "").not.toContain("Command: ls");
    expect(container.textContent ?? "").not.toContain("Command: rg --files");
    expect(container.querySelector(".thinking-block")).toBeNull();
  });
});
