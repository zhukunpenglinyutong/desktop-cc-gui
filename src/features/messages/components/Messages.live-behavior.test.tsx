// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
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
  });

  it("keeps only the latest title-only reasoning row for non-codex engines", () => {
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
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 1_000}
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

  it("pins only the latest ordinary user question during realtime processing", () => {
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

    const stickyNodes = container.querySelectorAll(".messages-live-sticky-user-message");
    expect(stickyNodes).toHaveLength(1);
    expect(container.querySelectorAll(".messages-history-sticky-user-message")).toHaveLength(0);
    expect(stickyNodes[0]?.getAttribute("data-message-anchor-id")).toBe(
      "user-live-sticky-latest",
    );
    expect(
      container
        .querySelector('[data-message-anchor-id="user-live-sticky-old"]')
        ?.classList.contains("messages-live-sticky-user-message"),
    ).toBe(false);
  });

  it("keeps the latest sticky user question rendered when realtime windowing trims the list", () => {
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

    const stickyNode = container.querySelector(".messages-live-sticky-user-message");
    expect(stickyNode?.getAttribute("data-message-anchor-id")).toBe(
      "user-live-sticky-windowed",
    );
    expect(container.textContent ?? "").toContain("这个问题必须常驻");
  });

  it("does not keep a phantom collapsed-history indicator when the sticky question is the only trimmed item", () => {
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

    expect(container.querySelector(".messages-live-sticky-user-message")).toBeTruthy();
    expect(container.querySelector(".messages-collapsed-indicator")).toBeNull();
  });

  it("restores normal user bubble scrolling when realtime processing ends", () => {
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

    expect(container.querySelector(".messages-live-sticky-user-message")).toBeTruthy();

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

    expect(container.querySelector(".messages-live-sticky-user-message")).toBeNull();
  });

  it("pins ordinary user questions as section headers during non-realtime history browsing", () => {
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

    const stickyNodes = container.querySelectorAll(".messages-history-sticky-user-message");
    expect(stickyNodes).toHaveLength(2);
    expect(container.querySelectorAll(".messages-live-sticky-user-message")).toHaveLength(0);
    expect(
      Array.from(stickyNodes).map((node) => node.getAttribute("data-message-anchor-id")),
    ).toEqual(["user-history-sticky-1", "user-history-sticky-2"]);
  });

  it("uses history sticky headers for restored history snapshots instead of live sticky", () => {
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
    expect(
      container
        .querySelector(".messages-history-sticky-user-message")
        ?.getAttribute("data-message-anchor-id"),
    ).toBe("user-history-sticky-restored");
  });

  it("does not pin memory-only injected user payloads as the latest live question", () => {
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

    expect(container.querySelector(".messages-live-sticky-user-message")).toBeTruthy();
    expect(
      container
        .querySelector(".messages-live-sticky-user-message")
        ?.getAttribute("data-message-anchor-id"),
    ).toBe("user-live-real-question");
  });

  it("excludes pseudo-user rows from history sticky headers", () => {
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

    const stickyNodes = container.querySelectorAll(".messages-history-sticky-user-message");
    expect(stickyNodes).toHaveLength(1);
    expect(stickyNodes[0]?.getAttribute("data-message-anchor-id")).toBe(
      "user-history-real-question",
    );
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

    expect(container.querySelector(".messages-history-sticky-user-message")).toBeNull();
    expect(container.querySelector(".messages-collapsed-indicator")).toBeTruthy();
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
