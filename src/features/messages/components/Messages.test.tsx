// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationItem } from "../../../types";
import { Messages } from "./Messages";

describe("Messages", () => {
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

  const exitPlanToolItem: ConversationItem = {
    id: "exit-plan-tool",
    kind: "tool",
    toolType: "toolCall",
    title: "Tool: ExitPlanMode",
    detail: "PLAN\n# Plan\n\n- implement feature\n\nPLANFILEPATH\n/Users/demo/.claude/plans/plan.md",
    status: "completed",
  };

  const exitPlanCommandToolItem: ConversationItem = {
    id: "exit-plan-command-tool",
    kind: "tool",
    toolType: "commandExecution",
    title: "Claude / exitplanmode",
    detail: "",
    output: "Exit plan mode?",
    status: "completed",
  };

  it("renders Claude reasoning inline by default when no legacy dock flag is set", () => {
    window.localStorage.removeItem("ccgui.claude.hideReasoningModule");

    const items: ConversationItem[] = [
      {
        id: "msg-user-inline",
        kind: "message",
        role: "user",
        text: "先分析",
      },
      {
        id: "reasoning-inline",
        kind: "reasoning",
        summary: "思考",
        content: "先检查 Controller 和 Service。",
      },
      {
        id: "msg-assistant-inline",
        kind: "message",
        role: "assistant",
        text: "我已经分析完了。",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-claude-inline"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const reasoningBlock = container.querySelector(".thinking-block");
    const assistantMessage = container.querySelector(".message.assistant");
    expect(reasoningBlock).toBeTruthy();
    expect(assistantMessage).toBeTruthy();
    if (!reasoningBlock || !assistantMessage) {
      throw new Error("expected reasoning block and assistant message");
    }
    expect(
      reasoningBlock.compareDocumentPosition(assistantMessage) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("routes exit plan execution buttons through the message tool chain", async () => {
    const onExitPlanModeExecute = vi.fn();
    render(
      <Messages
        items={[exitPlanToolItem]}
        threadId="thread-exit-plan"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
        onExitPlanModeExecute={onExitPlanModeExecute}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Execution Plan ReadyExit Plan mode" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Switch to default approval mode and run" }),
    );

    expect(onExitPlanModeExecute).toHaveBeenCalledWith("default");
    expect(
      screen.getByRole("button", { name: "Switch to default approval mode and run · 已选" }),
    ).toBeTruthy();
  });

  it("renders ExitPlanMode cards collapsed by default", () => {
    render(
      <Messages
        items={[exitPlanToolItem]}
        threadId="thread-exit-plan-collapsed"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
        onExitPlanModeExecute={vi.fn()}
      />,
    );

    const headerButton = screen.getByRole("button", {
      name: "Execution Plan ReadyExit Plan mode",
    });
    expect(headerButton.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Execution handoff")).toBeNull();
  });

  it("keeps ExitPlanMode card expanded during same-thread streaming updates", () => {
    const view = render(
      <Messages
        items={[exitPlanToolItem]}
        threadId="thread-exit-plan-streaming-stable"
        workspaceId="ws-1"
        isThinking={true}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
        onExitPlanModeExecute={vi.fn()}
      />,
    );

    const headerButton = screen.getByRole("button", {
      name: "Execution Plan ReadyExit Plan mode",
    });
    fireEvent.click(headerButton);
    expect(headerButton.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Execution handoff")).toBeTruthy();

    view.rerender(
      <Messages
        items={[
          exitPlanToolItem,
          {
            id: "msg-streaming-followup",
            kind: "message",
            role: "assistant",
            text: "继续执行中",
          },
        ]}
        threadId="thread-exit-plan-streaming-stable"
        workspaceId="ws-1"
        isThinking={true}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
        onExitPlanModeExecute={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Execution Plan ReadyExit Plan mode" }).getAttribute("aria-expanded"),
    ).toBe("true");
    expect(screen.getByText("Execution handoff")).toBeTruthy();
  });

  it("dedupes repeated ExitPlanMode cards and keeps the first one", () => {
    const duplicateExitPlanToolItem: ConversationItem = {
      ...exitPlanToolItem,
      id: "exit-plan-tool-duplicate",
    };

    render(
      <Messages
        items={[exitPlanToolItem, duplicateExitPlanToolItem]}
        threadId="thread-exit-plan-dedupe"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
        onExitPlanModeExecute={vi.fn()}
      />,
    );

    expect(screen.getAllByText("Execution Plan Ready")).toHaveLength(1);
  });

  it("dedupes mixed ExitPlanMode runtime variants and keeps the first card", () => {
    const duplicateRuntimeVariant: ConversationItem = {
      id: "exit-plan-tool-runtime-duplicate",
      kind: "tool",
      toolType: "commandExecution",
      title: "Claude / exitplanmode",
      detail: "",
      output: "Exit plan mode?",
      status: "completed",
    };

    render(
      <Messages
        items={[exitPlanToolItem, duplicateRuntimeVariant]}
        threadId="thread-exit-plan-runtime-dedupe"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
        onExitPlanModeExecute={vi.fn()}
      />,
    );

    expect(screen.getAllByText("Execution Plan Ready")).toHaveLength(1);
  });

  it("keeps command-like ExitPlanMode items on the dedicated handoff card", () => {
    render(
      <Messages
        items={[exitPlanCommandToolItem]}
        threadId="thread-exit-plan-command"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
        onExitPlanModeExecute={vi.fn()}
      />,
    );

    expect(screen.getByText("Execution Plan Ready")).toBeTruthy();
    expect(screen.queryByText("Claude / exitplanmode")).toBeNull();
  });

  it("keeps Claude reasoning title stable while streaming", () => {
    window.localStorage.removeItem("ccgui.claude.hideReasoningModule");

    const items: ConversationItem[] = [
      {
        id: "msg-user-streaming",
        kind: "message",
        role: "user",
        text: "继续分析",
      },
      {
        id: "reasoning-streaming",
        kind: "reasoning",
        summary: "检查日志模块",
        content: "先核对 Controller，再核对 Service。",
      },
    ];

    render(
      <Messages
        items={items}
        threadId="claude:session-streaming"
        workspaceId="ws-1"
        isThinking={true}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(screen.getByText("messages.thinkingLabel")).toBeTruthy();
    expect(screen.queryByText("messages.thinkingProcess")).toBeNull();
  });

  it("keeps legacy Claude docked reasoning mode when the flag is explicitly enabled", () => {
    window.localStorage.setItem("ccgui.claude.hideReasoningModule", "1");

    const items: ConversationItem[] = [
      {
        id: "msg-user-docked",
        kind: "message",
        role: "user",
        text: "先分析",
      },
      {
        id: "reasoning-docked",
        kind: "reasoning",
        summary: "思考",
        content: "先检查 Controller 和 Service。",
      },
      {
        id: "msg-assistant-docked",
        kind: "message",
        role: "assistant",
        text: "我已经分析完了。",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-claude-docked"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const reasoningBlock = container.querySelector(".thinking-block");
    const assistantMessage = container.querySelector(".message.assistant");
    expect(reasoningBlock).toBeTruthy();
    expect(assistantMessage).toBeTruthy();
    if (!reasoningBlock || !assistantMessage) {
      throw new Error("expected reasoning block and assistant message");
    }
    expect(
      assistantMessage.compareDocumentPosition(reasoningBlock) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("does not backfill historical user message badge from active mode", () => {
    const items: ConversationItem[] = [
      {
        id: "msg-no-mode-1",
        kind: "message",
        role: "user",
        text: "这条消息本身没有模式元数据",
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
        activeCollaborationModeId="plan"
      />,
    );

    expect(container.querySelector(".message-mode-badge")).toBeNull();
  });

  it("does not show collaboration badge for non-codex engines", () => {
    const items: ConversationItem[] = [
      {
        id: "msg-claude-1",
        kind: "message",
        role: "user",
        text:
          "Collaboration mode: code. Do not ask the user follow-up questions.\n\nUser request: 你好",
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
        activeEngine="claude"
        activeCollaborationModeId="code"
      />,
    );

    expect(container.querySelector(".message-mode-badge")).toBeNull();
    expect(container.textContent ?? "").toContain(
      "Collaboration mode: code. Do not ask the user follow-up questions.",
    );
  });

  it("enhances lead keywords only on codex assistant markdown", () => {
    const items: ConversationItem[] = [
      {
        id: "assistant-lead-1",
        kind: "message",
        role: "assistant",
        text: "PLAN\n\n执行内容",
      },
    ];

    const { container, rerender } = render(
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

    expect(container.querySelector(".markdown-lead-paragraph")).toBeTruthy();
    expect(container.querySelector(".markdown-codex-canvas")).toBeTruthy();

    rerender(
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

    expect(container.querySelector(".markdown-lead-paragraph")).toBeNull();
  });

  it("applies codex markdown visual style through presentation profile", () => {
    const items: ConversationItem[] = [
      {
        id: "assistant-profile-1",
        kind: "message",
        role: "assistant",
        text: "PLAN\n\n执行内容",
      },
    ];
    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="claude"
        presentationProfile={{
          engine: "codex",
          preferCommandSummary: true,
          codexCanvasMarkdown: true,
          showReasoningLiveDot: true,
          heartbeatWaitingHint: false,
          assistantMarkdownStreamingThrottleMs: 80,
          reasoningStreamingThrottleMs: 180,
          useCodexStagedMarkdownThrottle: true,
        }}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.querySelector(".markdown-codex-canvas")).toBeTruthy();
  });

  it("hides TodoWrite tool blocks from chat stream", () => {
    const items: ConversationItem[] = [
      {
        id: "tool-read-1",
        kind: "tool",
        toolType: "toolCall",
        title: "Tool: read",
        detail: JSON.stringify({ file_path: "src/keep-a.ts" }),
        status: "completed",
        output: "content",
      },
      {
        id: "tool-todo-1",
        kind: "tool",
        toolType: "toolCall",
        title: "Tool: TodoWrite",
        detail: JSON.stringify({ todos: [{ content: "step1" }] }),
        status: "completed",
        output: "todo updated",
      },
      {
        id: "tool-edit-1",
        kind: "tool",
        toolType: "toolCall",
        title: "Tool: edit",
        detail: JSON.stringify({
          file_path: "src/keep-b.ts",
          old_string: "a",
          new_string: "b",
        }),
        status: "completed",
      },
    ];

    render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(screen.getByText("keep-a.ts")).toBeTruthy();
    expect(screen.getByText("keep-b.ts")).toBeTruthy();
    expect(screen.queryByText("待办列表")).toBeNull();
  });

  it("collapses duplicate reasoning snapshots separated only by hidden TodoWrite tools", () => {
    const repeated =
      "用户要求进行项目分析，这是一个比较宽泛的请求。我需要先读取项目规范并查看项目结构。";
    const items: ConversationItem[] = [
      {
        id: "reasoning-hidden-sep-1",
        kind: "reasoning",
        summary: repeated,
        content: repeated,
      },
      {
        id: "tool-hidden-todo-1",
        kind: "tool",
        toolType: "toolCall",
        title: "Tool: TodoWrite",
        detail: JSON.stringify({ todos: [{ content: "step 1" }] }),
        status: "completed",
        output: "todo updated",
      },
      {
        id: "reasoning-hidden-sep-2",
        kind: "reasoning",
        summary: `${repeated} 现在我继续读取 README.md。`,
        content: `${repeated} 现在我继续读取 README.md。`,
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.querySelectorAll(".thinking-block").length).toBe(1);
    expect(container.textContent ?? "").toContain("现在我继续读取 README.md");
  });

  it("matches extended lead keywords with semantic icons", () => {
    const items: ConversationItem[] = [
      {
        id: "assistant-lead-next-1",
        kind: "message",
        role: "assistant",
        text: "下一步建议\n\n继续补齐验收。",
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

    expect(container.querySelector(".markdown-lead-next")).toBeTruthy();
    expect(container.querySelector(".markdown-lead-icon")?.textContent ?? "").toContain("🚀");
  });

  it("collapses pathological fragmented paragraphs in assistant markdown", () => {
    const fragmented = [
      "湘宁大兄弟",
      "你好！",
      "这段记录",
      "说",
      "的是：",
      "记",
      "录内容分",
      "析",
      "这是一个**",
      "对",
      "话开场片",
      "段**",
    ].join("\n\n");
    const items: ConversationItem[] = [
      {
        id: "assistant-fragmented-1",
        kind: "message",
        role: "assistant",
        text: `这段记录看起来是：\n\n${fragmented}\n\n总结完毕。`,
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

    const paragraphs = container.querySelectorAll(".markdown p");
    expect(paragraphs.length).toBeGreaterThanOrEqual(1);
    expect(paragraphs.length).toBeLessThanOrEqual(3);
    const markdownText = container.querySelector(".markdown")?.textContent ?? "";
    expect(markdownText).toContain("湘宁大兄弟你好！");
    expect(markdownText).toContain("这段记录说的是：");
    expect(markdownText).toContain("这是一个对话开场片段");
  });

  it("collapses pathological fragmented blockquote paragraphs in assistant markdown", () => {
    const fragmentedQuote = [
      "湘宁大兄弟",
      "你好！",
      "这段记录",
      "说",
      "的是：",
      "记",
      "录内容分",
      "析",
      "这是一个**",
      "对",
      "话开场片",
      "段**",
    ]
      .map((line) => `> ${line}`)
      .join("\n\n");

    const items: ConversationItem[] = [
      {
        id: "assistant-fragmented-quote-1",
        kind: "message",
        role: "assistant",
        text: `这段记录看起来是：\n\n${fragmentedQuote}\n\n总结完毕。`,
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

    const quoteParagraphs = container.querySelectorAll(".markdown blockquote p");
    expect(quoteParagraphs.length).toBeGreaterThanOrEqual(1);
    expect(quoteParagraphs.length).toBeLessThanOrEqual(3);
    const markdownText = container.querySelector(".markdown")?.textContent ?? "";
    expect(markdownText).toContain("湘宁大兄弟你好！");
    expect(markdownText).toContain("这段记录说的是：");
    expect(markdownText).toContain("这是一个对话开场片段");
  });

  it("collapses fragmented paragraphs when blank lines contain spaces", () => {
    const fragmented = [
      "你好",
      "！",
      "有什么",
      "我可以",
      "帮",
      "你的",
      "吗",
      "？",
    ].join("\n \n");
    const items: ConversationItem[] = [
      {
        id: "assistant-fragmented-spaces-1",
        kind: "message",
        role: "assistant",
        text: `先回应：\n \n${fragmented}`,
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

    const markdownText = container.querySelector(".markdown")?.textContent ?? "";
    expect(markdownText).toContain("你好！有什么我可以帮你的吗？");
  });

  it("collapses single-line fragmented cjk runs in assistant markdown", () => {
    const fragmented = [
      "你",
      "好",
      "！",
      "我",
      "是",
      "你",
      "的",
      "AI",
      "联",
      "合",
      "架",
      "构",
      "师",
      "。",
    ].join("\n");
    const items: ConversationItem[] = [
      {
        id: "assistant-single-line-fragmented-1",
        kind: "message",
        role: "assistant",
        text: fragmented,
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

    const markdownText = container.querySelector(".markdown")?.textContent ?? "";
    expect(markdownText).toContain("你好！我是你的AI联合架构师。");
  });

  it("renders memory context summary as a separate collapsible card", async () => {
    const items: ConversationItem[] = [
      {
        id: "memory-summary-1",
        kind: "message",
        role: "assistant",
        text: "【记忆上下文摘要】\n[对话记录] 第一条；[项目上下文] 第二条",
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

    expect(container.querySelector(".memory-context-summary-card")).toBeTruthy();
    expect(container.querySelector(".markdown")).toBeNull();
    const toggle = container.querySelector(".memory-context-summary-toggle");
    expect(toggle).toBeTruthy();
    if (!toggle) {
      return;
    }
    fireEvent.click(toggle);
    await waitFor(() => {
      const content = container.querySelector(".memory-context-summary-content");
      expect(content?.textContent ?? "").toContain("第一条");
      expect(content?.textContent ?? "").toContain("第二条");
    });
  });

  it("renders legacy user-injected memory prefix as summary card and keeps user input text", async () => {
    const items: ConversationItem[] = [
      {
        id: "legacy-user-memory-1",
        kind: "message",
        role: "user",
        text:
          "[对话记录] 用户输入：你知道苹果手机吗。 我刚买了一个16pro 助手输出摘要：知道的！ iPhone 16 Pro 是苹果 2024 年发布的旗舰机型。 助手输出：知道的！\n\n我的手机是什么牌子的",
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

    expect(container.querySelector(".memory-context-summary-card")).toBeTruthy();
    const userText = container.querySelector(".user-collapsible-text-content");
    expect(userText?.textContent ?? "").toBe("我的手机是什么牌子的");
    expect(userText?.textContent ?? "").not.toContain("用户输入：你知道苹果手机吗");
    const toggle = container.querySelector(".memory-context-summary-toggle");
    expect(toggle).toBeTruthy();
    if (!toggle) {
      return;
    }
    fireEvent.click(toggle);
    await waitFor(() => {
      const content = container.querySelector(".memory-context-summary-content");
      expect(content?.textContent ?? "").toContain("[对话记录]");
      expect(content?.textContent ?? "").toContain("助手输出摘要");
    });
  });

  it("dedupes assistant memory summary cards against attributed user memory wrapper in the same turn", () => {
    const items: ConversationItem[] = [
      {
        id: "assistant-memory-summary-1",
        kind: "message",
        role: "assistant",
        text: "【记忆上下文摘要】\n[对话记录] 第一条；[项目上下文] 第二条...",
      },
      {
        id: "real-user-memory-1",
        kind: "message",
        role: "user",
        text: [
          '<project-memory source="manual-selection" count="3" truncated="true">',
          "[对话记录] 第一条",
          "[项目上下文] 第二条",
          "[已知问题] 第三条",
          "</project-memory>",
          "",
          "请基于这些记忆继续分析",
        ].join("\n"),
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-memory-dedupe"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="codex"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.querySelectorAll(".memory-context-summary-card")).toHaveLength(1);
    const userText = container.querySelector(".user-collapsible-text-content");
    expect(userText?.textContent ?? "").toBe("请基于这些记忆继续分析");
    expect(container.textContent ?? "").not.toContain("[对话记录] 第一条");
  });

  it("does not leak project-memory xml when a same-turn assistant summary suppresses a memory-only user row", () => {
    const items: ConversationItem[] = [
      {
        id: "assistant-memory-summary-only",
        kind: "message",
        role: "assistant",
        text: "【记忆上下文摘要】\n[对话记录] 第一条；[项目上下文] 第二条",
      },
      {
        id: "real-user-memory-only",
        kind: "message",
        role: "user",
        text: [
          '<project-memory source="manual-selection" count="2" truncated="false">',
          "[对话记录] 第一条",
          "[项目上下文] 第二条",
          "</project-memory>",
          "",
        ].join("\n"),
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-memory-only-dedupe"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="codex"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.querySelectorAll(".memory-context-summary-card")).toHaveLength(1);
    expect(container.querySelector(".message.user .bubble")).toBeNull();
    expect(container.textContent ?? "").not.toContain("<project-memory");
  });

  it("shows collapsible user input toggle when content overflows and expands on click", () => {
    const originalScrollHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollHeight",
    );
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get() {
        return this.classList.contains("user-collapsible-content") ? 280 : 0;
      },
    });

    try {
      const items: ConversationItem[] = [
        {
          id: "user-collapse-1",
          kind: "message",
          role: "user",
          text: Array.from({ length: 24 }, (_, index) => `Line ${index + 1}`).join("\n"),
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

      const toggle = container.querySelector(".user-collapsible-toggle") as HTMLButtonElement | null;
      const content = container.querySelector(".user-collapsible-content") as HTMLDivElement | null;
      expect(toggle).toBeTruthy();
      expect(content).toBeTruthy();
      expect(content?.style.maxHeight).toBe("160px");

      if (toggle) {
        fireEvent.click(toggle);
      }

      expect(toggle?.getAttribute("aria-expanded")).toBe("true");
      expect(content?.style.maxHeight).toBe("none");
    } finally {
      if (originalScrollHeight) {
        Object.defineProperty(HTMLElement.prototype, "scrollHeight", originalScrollHeight);
      } else {
        delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
      }
    }
  });

  it("renders user-only anchors and scrolls on click", () => {
    const scrollToMock = vi.fn();
    HTMLElement.prototype.scrollTo = scrollToMock;

    const items: ConversationItem[] = [
      {
        id: "anchor-u1",
        kind: "message",
        role: "user",
        text: "first",
      },
      {
        id: "anchor-a1",
        kind: "message",
        role: "assistant",
        text: "second",
      },
      {
        id: "anchor-u2",
        kind: "message",
        role: "user",
        text: "third",
      },
    ];

    render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const rail = screen.getByRole("navigation", { name: "messages.anchorNavigation" });
    expect(rail).toBeTruthy();
    const anchorButtons = screen.getAllByRole("button", {
      name: "messages.anchorJumpToUser",
    });
    expect(anchorButtons.length).toBe(2);
    const firstAnchorButton = anchorButtons[0];
    if (!firstAnchorButton) {
      throw new Error("Anchor button not found");
    }
    fireEvent.click(firstAnchorButton);
    expect(scrollToMock).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: "smooth" }),
    );
  });

  it("collapses earlier items and reveals them on demand", () => {
    const items: ConversationItem[] = Array.from({ length: 32 }, (_, index) => ({
      id: `history-item-${index + 1}`,
      kind: "message",
      role: index % 2 === 0 ? "user" : "assistant",
      text: `history message ${index + 1}`,
    }));

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-history-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(screen.queryByText("history message 1")).toBeNull();
    expect(screen.getByText("history message 3")).toBeTruthy();
    expect(screen.getByText("history message 17")).toBeTruthy();

    const indicator = container.querySelector(".messages-collapsed-indicator");
    expect(indicator).toBeTruthy();
    expect(indicator?.getAttribute("data-collapsed-count")).toBe("2");
    if (!indicator) {
      return;
    }
    fireEvent.click(indicator);

    expect(screen.getByText("history message 1")).toBeTruthy();
    expect(container.querySelector(".messages-collapsed-indicator")).toBeNull();
  });

  it("resets collapsed state when conversation head changes", () => {
    const firstBatch: ConversationItem[] = Array.from({ length: 32 }, (_, index) => ({
      id: `session-a-${index + 1}`,
      kind: "message",
      role: index % 2 === 0 ? "user" : "assistant",
      text: `session A message ${index + 1}`,
    }));
    const secondBatch: ConversationItem[] = Array.from({ length: 32 }, (_, index) => ({
      id: `session-b-${index + 1}`,
      kind: "message",
      role: index % 2 === 0 ? "user" : "assistant",
      text: `session B message ${index + 1}`,
    }));

    const { container, rerender } = render(
      <Messages
        items={firstBatch}
        threadId="thread-history-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const firstIndicator = container.querySelector(".messages-collapsed-indicator");
    expect(firstIndicator).toBeTruthy();
    if (firstIndicator) {
      fireEvent.click(firstIndicator);
    }
    expect(screen.getByText("session A message 1")).toBeTruthy();

    rerender(
      <Messages
        items={secondBatch}
        threadId="thread-history-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(screen.queryByText("session B message 1")).toBeNull();
    const secondIndicator = container.querySelector(".messages-collapsed-indicator");
    expect(secondIndicator).toBeTruthy();
    expect(secondIndicator?.getAttribute("data-collapsed-count")).toBe("2");
  });

  it("uses reasoning title for the working indicator and keeps title-only reasoning rows visible", () => {
    const items: ConversationItem[] = [
      {
        id: "reasoning-1",
        kind: "reasoning",
        summary: "Scanning repository",
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

    const workingText = container.querySelector(".working-text");
    expect(workingText?.textContent ?? "").toContain("Scanning repository");
    expect(container.querySelector(".thinking-block")).toBeTruthy();
    expect(container.querySelector(".thinking-title")).toBeTruthy();
  });

  it("shows title-only reasoning rows in codex canvas for real-time visibility", () => {
    const items: ConversationItem[] = [
      {
        id: "reasoning-codex-live-1",
        kind: "reasoning",
        summary: "Scanning repository",
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
        activeEngine="codex"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.querySelector(".thinking-block")).toBeTruthy();
    expect(container.querySelector(".thinking-title")).toBeTruthy();
  });

  it("shows a prominent proxy badge in the working indicator when proxy is enabled", () => {
    const { container } = render(
      <Messages
        items={[]}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        proxyEnabled
        proxyUrl="http://127.0.0.1:7890"
        processingStartedAt={Date.now() - 1_000}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const badge = container.querySelector(".working .working-proxy-badge");
    expect(badge).toBeTruthy();
    expect(badge?.textContent ?? "").toBe("");
    expect(badge?.classList.contains("proxy-status-badge--animated")).toBe(true);
    expect(badge?.getAttribute("aria-label") ?? "").toContain("127.0.0.1:7890");
  });

  it("updates codex reasoning row when streamed body arrives", async () => {
    const initialItems: ConversationItem[] = [
      {
        id: "reasoning-codex-stream-1",
        kind: "reasoning",
        summary: "Preparing plan",
        content: "",
      },
    ];

    const { container, rerender } = render(
      <Messages
        items={initialItems}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 1_000}
        activeEngine="codex"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.querySelector(".thinking-block")).toBeTruthy();

    const streamedItems: ConversationItem[] = [
      {
        id: "reasoning-codex-stream-1",
        kind: "reasoning",
        summary: "Preparing plan\nStep 1 complete",
        content: "",
      },
    ];

    rerender(
      <Messages
        items={streamedItems}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 1_000}
        activeEngine="codex"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    await waitFor(() => {
      expect(container.querySelector(".thinking-content")?.textContent ?? "").toContain(
        "Step 1 complete",
      );
    });
  });

  it("renders the latest claude assistant row as markdown while streaming", () => {
    const items: ConversationItem[] = [
      {
        id: "user-claude-live-1",
        kind: "message",
        role: "user",
        text: "帮我分析这个问题",
      },
      {
        id: "assistant-live:turn-1",
        kind: "message",
        role: "assistant",
        text: "高概率这是前端渲染问题，正文流已经到了。",
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

    const markdownParagraph = container.querySelector(".message.assistant .markdown p");
    expect(markdownParagraph?.textContent ?? "").toContain("高概率这是前端渲染问题");
    expect(container.querySelector(".message.assistant .markdown-live-streaming")).toBeTruthy();
  });

  it("renders the latest gemini assistant row as live markdown while streaming", () => {
    const items: ConversationItem[] = [
      {
        id: "user-gemini-live-1",
        kind: "message",
        role: "user",
        text: "总结这次检查",
      },
      {
        id: "assistant-gemini-live-1",
        kind: "message",
        role: "assistant",
        text: "Gemini 正在流式输出结论。",
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

    const markdownParagraph = container.querySelector(".message.assistant .markdown p");
    expect(markdownParagraph?.textContent ?? "").toContain("Gemini 正在流式输出结论");
    expect(container.querySelector(".message.assistant .markdown-live-streaming")).toBeTruthy();
  });

  it("keeps the latest assistant row on the live markdown surface briefly after streaming stops", () => {
    vi.useFakeTimers();
    try {
      const items: ConversationItem[] = [
        {
          id: "user-finalizing-live-1",
          kind: "message",
          role: "user",
          text: "帮我给出最后总结",
        },
        {
          id: "assistant-finalizing-live-1",
          kind: "message",
          role: "assistant",
          text: "总结如下：\n- 第一条\n- 第二条",
          isFinal: true,
        },
      ];

      const { container, rerender } = render(
        <Messages
          items={items}
          threadId="codex:finalizing-live-1"
          workspaceId="ws-1"
          isThinking
          processingStartedAt={Date.now() - 1_000}
          activeEngine="codex"
          openTargets={[]}
          selectedOpenAppId=""
        />,
      );

      expect(container.querySelector(".message.assistant .markdown-live-streaming")).toBeTruthy();

      rerender(
        <Messages
          items={items}
          threadId="codex:finalizing-live-1"
          workspaceId="ws-1"
          isThinking={false}
          activeEngine="codex"
          openTargets={[]}
          selectedOpenAppId=""
        />,
      );

      expect(container.querySelector(".message.assistant .markdown-live-streaming")).toBeTruthy();
      expect(container.querySelector(".messages-final-boundary")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the completion frame on the live markdown surface before passive effects flush", () => {
    const items: ConversationItem[] = [
      {
        id: "user-finalizing-commit-frame-1",
        kind: "message",
        role: "user",
        text: "最后总结",
      },
      {
        id: "assistant-finalizing-commit-frame-1",
        kind: "message",
        role: "assistant",
        text: "最终总结：\n- A\n- B",
        isFinal: true,
      },
    ];
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      act(() => {
        flushSync(() => {
          root.render(
            <Messages
              items={items}
              threadId="codex:finalizing-commit-frame-1"
              workspaceId="ws-1"
              isThinking
              activeEngine="codex"
              openTargets={[]}
              selectedOpenAppId=""
            />,
          );
        });
      });

      act(() => {
        flushSync(() => {
          root.render(
            <Messages
              items={items}
              threadId="codex:finalizing-commit-frame-1"
              workspaceId="ws-1"
              isThinking={false}
              activeEngine="codex"
              openTargets={[]}
              selectedOpenAppId=""
            />,
          );
        });
        expect(container.querySelector(".message.assistant .markdown-live-streaming")).toBeTruthy();
        expect(container.querySelector(".messages-final-boundary")).toBeNull();
      });
    } finally {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  });

  it("restores final boundary after the finalizing live window elapses", () => {
    vi.useFakeTimers();
    try {
      const items: ConversationItem[] = [
        {
          id: "user-finalizing-boundary-1",
          kind: "message",
          role: "user",
          text: "继续",
        },
        {
          id: "assistant-finalizing-boundary-1",
          kind: "message",
          role: "assistant",
          text: "最终整理如下",
          isFinal: true,
        },
      ];

      const { container, rerender } = render(
        <Messages
          items={items}
          threadId="codex:finalizing-boundary-1"
          workspaceId="ws-1"
          isThinking
          activeEngine="codex"
          openTargets={[]}
          selectedOpenAppId=""
        />,
      );

      rerender(
        <Messages
          items={items}
          threadId="codex:finalizing-boundary-1"
          workspaceId="ws-1"
          isThinking={false}
          activeEngine="codex"
          openTargets={[]}
          selectedOpenAppId=""
        />,
      );

      act(() => {
        vi.advanceTimersByTime(321);
      });

      expect(container.querySelector(".messages-final-boundary")).toBeTruthy();
      expect(container.querySelector(".message.assistant .markdown-live-streaming")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stabilizes live inline code rendering behind a bounded markdown throttle", () => {
    vi.useFakeTimers();
    try {
      const firstItems: ConversationItem[] = [
        {
          id: "user-live-inline-code-1",
          kind: "message",
          role: "user",
          text: "继续",
        },
        {
          id: "assistant-live-inline-code-1",
          kind: "message",
          role: "assistant",
          text: "命令是 `pnpm",
        },
      ];

      const { container, rerender } = render(
        <Messages
          items={firstItems}
          threadId="claude:thread-live-inline-code"
          workspaceId="ws-1"
          isThinking
          processingStartedAt={Date.now() - 1_000}
          activeEngine="claude"
          openTargets={[]}
          selectedOpenAppId=""
        />,
      );

      rerender(
        <Messages
          items={[
            firstItems[0]!,
            {
              id: "assistant-live-inline-code-1",
              kind: "message",
              role: "assistant",
              text: "命令是 `pnpm\nrun\nlint`，执行后继续。",
            },
          ]}
          threadId="claude:thread-live-inline-code"
          workspaceId="ws-1"
          isThinking
          processingStartedAt={Date.now() - 1_000}
          activeEngine="claude"
          openTargets={[]}
          selectedOpenAppId=""
        />,
      );

      expect(container.querySelector(".message.assistant code")).toBeNull();

      act(() => {
        vi.advanceTimersByTime(60);
      });

      const code = container.querySelector(".message.assistant code");
      expect(code?.textContent ?? "").toBe("pnpm run lint");
      expect(container.querySelector(".message.assistant .markdown")?.textContent ?? "").not.toContain(
        "pnpmrunlint",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("freezes assistant content updates while text is selected", () => {
    const initialItems: ConversationItem[] = [
      {
        id: "assistant-selection-1",
        kind: "message",
        role: "assistant",
        text: "这是用于复制稳定性的测试文本。",
      },
    ];

    const { container, rerender } = render(
      <Messages
        items={initialItems}
        threadId="thread-selection-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const initialParagraph = container.querySelector(".message.assistant .markdown p");
    const initialTextNode = initialParagraph?.firstChild;
    expect(initialTextNode?.textContent).toBe("这是用于复制稳定性的测试文本。");

    const selection = window.getSelection();
    selection?.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(initialTextNode as Node);
    selection?.addRange(range);
    act(() => {
      document.dispatchEvent(new Event("selectionchange"));
    });
    expect(selection?.toString()).toBe("这是用于复制稳定性的测试文本。");

    rerender(
      <Messages
        items={[{ ...initialItems[0], text: "新的流式内容不应打断当前复制。" } as ConversationItem]}
        threadId="thread-selection-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
        userInputRequests={[]}
        conversationState={{
          items: [{ ...initialItems[0], text: "新的流式内容不应打断当前复制。" } as ConversationItem],
          plan: null,
          userInputQueue: [],
          meta: {
            workspaceId: "ws-1",
            threadId: "thread-selection-1",
            engine: "codex",
            activeTurnId: null,
            isThinking: false,
            heartbeatPulse: 3,
            historyRestoredAtMs: null,
          },
        }}
      />,
    );

    const rerenderedParagraph = container.querySelector(".message.assistant .markdown p");
    expect(rerenderedParagraph?.textContent).toBe("这是用于复制稳定性的测试文本。");

  });

  it("keeps a single codex reasoning row stable under rapid stream updates", async () => {
    const { container, rerender } = render(
      <Messages
        items={[
          {
            id: "reasoning-codex-rapid-1",
            kind: "reasoning",
            summary: "Drafting response",
            content: "",
          },
        ]}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 1_000}
        activeEngine="codex"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    for (let index = 1; index <= 8; index += 1) {
      rerender(
        <Messages
          items={[
            {
              id: "reasoning-codex-rapid-1",
              kind: "reasoning",
              summary: `Drafting response\nchunk ${index}`,
              content: "",
            },
          ]}
          threadId="thread-1"
          workspaceId="ws-1"
          isThinking
          processingStartedAt={Date.now() - 1_000}
          activeEngine="codex"
          openTargets={[]}
          selectedOpenAppId=""
        />,
      );
    }

    expect(container.querySelectorAll(".thinking-block").length).toBe(1);
    await waitFor(() => {
      expect(container.querySelector(".thinking-content")?.textContent ?? "").toContain(
        "chunk 8",
      );
    });
  });

  it("renders reasoning rows when there is reasoning body content", () => {
    const items: ConversationItem[] = [
      {
        id: "reasoning-2",
        kind: "reasoning",
        summary: "Scanning repository\nLooking for entry points",
        content: "",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 2_000}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.querySelector(".thinking-block")).toBeTruthy();
    expect(container.querySelector(".reasoning-markdown-surface")).toBeTruthy();
    expect(container.querySelector(".reasoning-markdown")).toBeTruthy();
    const reasoningDetail = container.querySelector(".thinking-content");
    expect(reasoningDetail?.textContent ?? "").toContain("Looking for entry points");
    const workingText = container.querySelector(".working-text");
    expect(workingText?.textContent ?? "").toContain("Scanning repository");
  });

  it("collapses fragmented blockquote text in reasoning detail", () => {
    const fragmentedQuote = [
      "好",
      "的，让",
      "我",
      "帮你",
      "回",
      "顾一下当前项",
      "目的状态和",
      "最",
      "近的",
      "Git 操",
      "作。",
    ]
      .map((line) => `> ${line}`)
      .join("\n\n");

    const items: ConversationItem[] = [
      {
        id: "reasoning-fragmented-quote",
        kind: "reasoning",
        summary: "检查项目记忆",
        content: `从项目记忆里可以看到：\n\n${fragmentedQuote}`,
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 2_000}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const reasoningDetail = container.querySelector(".thinking-content");
    expect(reasoningDetail).toBeTruthy();
    const quoteParagraphs = container.querySelectorAll(
      ".thinking-content blockquote p",
    );
    expect(quoteParagraphs.length).toBeGreaterThanOrEqual(1);
    expect(quoteParagraphs.length).toBeLessThanOrEqual(3);
    const text = reasoningDetail?.textContent ?? "";
    expect(text).toContain("好的，让我帮你回顾一下当前项目的状态和最近的Git 操作。");
  });

  it("dedupes overlapping reasoning summary and content text", () => {
    const items: ConversationItem[] = [
      {
        id: "reasoning-overlap-1",
        kind: "reasoning",
        summary: "你好！有什么我可以帮你的吗？",
        content: "你好！有什么我可以帮你的吗？ 你好！有什么我可以帮你的吗？",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 2_000}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const reasoningDetail = container.querySelector(".thinking-content");
    expect(reasoningDetail).toBeTruthy();
    const text = (reasoningDetail?.textContent ?? "").replace(/\s+/g, "");
    const matches = text.match(/你好！有什么我可以帮你的吗？/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("dedupes reasoning summary and content when they share suffix clauses", () => {
    const items: ConversationItem[] = [
      {
        id: "reasoning-overlap-suffix-1",
        kind: "reasoning",
        summary:
          "让我继续读取项目内规范文件和项目结构。现在我有了项目的概览信息。现在我对项目有了比较全面的了解。让我整理分析报告。",
        content:
          "ccgui 是一个基于 Tauri + React 的桌面应用，是 Cursor 的开源替代品，集成了多个 AI 编程引擎。现在我对项目有了比较全面的了解。让我整理分析报告。",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 2_000}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const reasoningDetail = container.querySelector(".thinking-content");
    expect(reasoningDetail).toBeTruthy();
    const text = (reasoningDetail?.textContent ?? "").replace(/\s+/g, "");
    const matches = text.match(/让我整理分析报告/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("strips duplicated reasoning title prefix from content body", () => {
    const title =
      "用户只是说“你好”，这是一个简单的问候。根据我的指导原则：1. 这是一个简单的交互，不需要使用工具。";
    const items: ConversationItem[] = [
      {
        id: "reasoning-title-prefix-1",
        kind: "reasoning",
        summary: title,
        content: `${title} 2. 我应该简洁友好地回应，并询问如何帮助。`,
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 2_000}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const reasoningDetail = container.querySelector(".thinking-content");
    expect(reasoningDetail).toBeTruthy();
    const detailText = reasoningDetail?.textContent ?? "";
    const titleMatches = detailText.match(/用户只是说“你好”/g) ?? [];
    expect(titleMatches.length).toBe(0);
    expect(detailText).toContain("我应该简洁友好地回应，并询问如何帮助。");
  });

  it("preserves reasoning detail when summary is only a history preview prefix", () => {
    const fullText =
      "先检查项目目录结构和入口模块，再确认核心路由和状态来源，然后核对实时事件与历史回放链路，最后比对幕布渲染差异，确认是哪一步开始丢失思考正文。";
    const items: ConversationItem[] = [
      {
        id: "reasoning-history-preview-1",
        kind: "reasoning",
        summary: fullText.slice(0, 36),
        content: fullText,
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 2_000}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const reasoningDetail = container.querySelector(".thinking-content");
    expect(reasoningDetail).toBeTruthy();
    expect((reasoningDetail?.textContent ?? "").replace(/\s+/g, "")).toContain(
      fullText.replace(/\s+/g, ""),
    );
  });

  it("preserves multiline reasoning detail when summary is only a preview prefix", () => {
    const fullText = [
      "先检查项目目录结构和入口模块，再确认核心路由和状态来源，",
      "然后核对实时事件与历史回放链路，",
      "最后比对幕布渲染差异，确认是哪一步开始丢失思考正文。",
    ].join("\n");
    const items: ConversationItem[] = [
      {
        id: "reasoning-history-preview-multiline-1",
        kind: "reasoning",
        summary: "先检查项目目录结构和入口模块，再确认核心路由和状态来源，",
        content: fullText,
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 2_000}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const reasoningDetail = container.querySelector(".thinking-content");
    expect(reasoningDetail).toBeTruthy();
    expect((reasoningDetail?.textContent ?? "").replace(/\s+/g, "")).toContain(
      fullText.replace(/\s+/g, ""),
    );
  });

  it("dedupes adjacent duplicate reasoning blocks in history view", () => {
    const repeated =
      "用户问“你好你是 codex 吗”，这是一个简单的身份确认问题。根据系统提示，我需要：首先确认已读取规则。";
    const items: ConversationItem[] = [
      {
        id: "reasoning-history-1",
        kind: "reasoning",
        summary: repeated,
        content: repeated,
      },
      {
        id: "reasoning-history-2",
        kind: "reasoning",
        summary: repeated,
        content: repeated,
      },
      {
        id: "assistant-history-1",
        kind: "message",
        role: "assistant",
        text: "你好！",
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

    expect(container.querySelectorAll(".thinking-block").length).toBe(1);
  });

  it("dedupes incremental claude reasoning snapshots even when titles evolve", () => {
    const step1 =
      "用户发送了“项目分析”这个简短请求。我需要先了解当前项目的上下文。";
    const step2 = `${step1}这是一个 worktree 目录。让我读取 package.json 和项目结构。`;
    const step3 = `${step2}现在我对项目有了完整的了解。`;
    const items: ConversationItem[] = [
      {
        id: "reasoning-snapshot-1",
        kind: "reasoning",
        summary: step1,
        content: step1,
      },
      {
        id: "reasoning-snapshot-2",
        kind: "reasoning",
        summary: step2,
        content: step2,
      },
      {
        id: "reasoning-snapshot-3",
        kind: "reasoning",
        summary: step3,
        content: step3,
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 2_000}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.querySelectorAll(".thinking-block").length).toBe(1);
    expect(container.textContent ?? "").toContain("现在我对项目有了完整的了解");
  });

  it("collapses consecutive claude reasoning runs into a single visible block", () => {
    const items: ConversationItem[] = [
      {
        id: "reasoning-run-1",
        kind: "reasoning",
        summary: "先读取 README 并识别技术栈",
        content: "先读取 README 并识别技术栈",
      },
      {
        id: "reasoning-run-2",
        kind: "reasoning",
        summary: "继续读取 CLAUDE.md 并整理结论",
        content: "继续读取 CLAUDE.md 并整理结论",
      },
      {
        id: "reasoning-run-3",
        kind: "reasoning",
        summary: "输出最终分析报告",
        content: "输出最终分析报告",
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

    expect(container.querySelectorAll(".thinking-block").length).toBe(1);
    expect(container.textContent ?? "").toContain("先读取 README 并识别技术栈");
    expect(container.textContent ?? "").toContain("继续读取 CLAUDE.md 并整理结论");
    expect(container.textContent ?? "").toContain("输出最终分析报告");
  });

  it("collapses consecutive gemini reasoning runs into a single visible block", () => {
    const items: ConversationItem[] = [
      {
        id: "gemini-reasoning-run-1",
        kind: "reasoning",
        summary: "先读取 README 并识别技术栈",
        content: "先读取 README 并识别技术栈",
      },
      {
        id: "gemini-reasoning-run-2",
        kind: "reasoning",
        summary: "继续读取 CLAUDE.md 并整理结论",
        content: "继续读取 CLAUDE.md 并整理结论",
      },
      {
        id: "gemini-reasoning-run-3",
        kind: "reasoning",
        summary: "输出最终分析报告",
        content: "输出最终分析报告",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="gemini:thread-1"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="gemini"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.querySelectorAll(".thinking-block").length).toBe(1);
    expect(container.textContent ?? "").toContain("输出最终分析报告");
  });

  it("keeps segmented gemini reasoning slices visible during realtime rendering", () => {
    const items: ConversationItem[] = [
      {
        id: "gemini-reasoning-seg-1",
        kind: "reasoning",
        summary: "创建 operationlog 目录",
        content: "创建 operationlog 目录",
      },
      {
        id: "gemini-reasoning-seg-2",
        kind: "reasoning",
        summary: "编写 OperationLog.java",
        content: "编写 OperationLog.java",
      },
      {
        id: "gemini-reasoning-seg-3",
        kind: "reasoning",
        summary: "编写 OperationLogRequest.java",
        content: "编写 OperationLogRequest.java",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="gemini:thread-1"
        workspaceId="ws-1"
        isThinking
        activeEngine="gemini"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.querySelectorAll(".thinking-block").length).toBe(3);
    expect(container.textContent ?? "").toContain("创建 operationlog 目录");
    expect(container.textContent ?? "").toContain("编写 OperationLog.java");
    expect(container.textContent ?? "").toContain("编写 OperationLogRequest.java");
  });

  it("collapses consecutive placeholder gemini segmented reasoning slices", () => {
    const items: ConversationItem[] = [
      {
        id: "gemini-placeholder-seg-1",
        kind: "reasoning",
        summary: "思考",
        content: "思考",
      },
      {
        id: "gemini-placeholder-seg-2",
        kind: "reasoning",
        summary: "思考",
        content: "思考",
      },
      {
        id: "gemini-placeholder-seg-3",
        kind: "reasoning",
        summary: "思考",
        content: "思考",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="gemini:thread-1"
        workspaceId="ws-1"
        isThinking
        activeEngine="gemini"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.querySelectorAll(".thinking-block").length).toBe(1);
  });

  it("keeps consecutive claude live reasoning runs segmented while streaming", () => {
    const items: ConversationItem[] = [
      {
        id: "reasoning-live-run",
        kind: "reasoning",
        summary: "先读取 README 并识别技术栈",
        content: "先读取 README 并识别技术栈",
      },
      {
        id: "reasoning-live-run-seg-1",
        kind: "reasoning",
        summary: "继续读取 CLAUDE.md 并整理结论",
        content: "继续读取 CLAUDE.md 并整理结论",
      },
      {
        id: "reasoning-live-run-seg-2",
        kind: "reasoning",
        summary: "输出最终分析报告",
        content: "输出最终分析报告",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.querySelectorAll(".thinking-block").length).toBe(3);
    expect(container.textContent ?? "").toContain("先读取 README 并识别技术栈");
    expect(container.textContent ?? "").toContain("继续读取 CLAUDE.md 并整理结论");
    expect(container.textContent ?? "").toContain("输出最终分析报告");
  });

  it("keeps first multiline claude reasoning content after collapsing runs", () => {
    const items: ConversationItem[] = [
      {
        id: "reasoning-run-multiline-1",
        kind: "reasoning",
        summary: "分析计划\n先读取 README",
        content: "分析计划\n先读取 README",
      },
      {
        id: "reasoning-run-multiline-2",
        kind: "reasoning",
        summary: "继续分析\n再检查配置",
        content: "继续分析\n再检查配置",
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

    expect(container.querySelectorAll(".thinking-block").length).toBe(1);
    const reasoningDetailText = container.querySelector(".thinking-content")?.textContent ?? "";
    expect(reasoningDetailText).toContain("先读取 README");
    expect(reasoningDetailText).toContain("再检查配置");
  });

  it("renders claude live reasoning at the bottom when dock mode is enabled", () => {
    window.localStorage.setItem("ccgui.claude.hideReasoningModule", "1");
    try {
      const items: ConversationItem[] = [
        {
          id: "claude-user-1",
          kind: "message",
          role: "user",
          text: "分析项目",
        },
        {
          id: "claude-live-reasoning-1",
          kind: "reasoning",
          summary: "正在分析",
          content: "先读取目录，再检查关键文件",
        },
      ];

      const { container } = render(
        <Messages
          items={items}
          threadId="claude:session-1"
          workspaceId="ws-1"
          isThinking
          activeEngine="claude"
          openTargets={[]}
          selectedOpenAppId=""
        />,
      );

      const thinkingBlock = container.querySelector(".thinking-block");
      expect(thinkingBlock).toBeTruthy();
      expect(thinkingBlock?.textContent ?? "").toContain("先读取目录，再检查关键文件");
      expect(thinkingBlock?.nextElementSibling?.className ?? "").toContain("working");
    } finally {
      window.localStorage.removeItem("ccgui.claude.hideReasoningModule");
    }
  });

  it("keeps docked claude reasoning after turn completes and collapses it by default", () => {
    window.localStorage.setItem("ccgui.claude.hideReasoningModule", "1");
    try {
      const items: ConversationItem[] = [
        {
          id: "claude-user-2",
          kind: "message",
          role: "user",
          text: "继续分析项目",
        },
        {
          id: "claude-live-reasoning-2",
          kind: "reasoning",
          summary: "继续分析",
          content: "读取配置，再检查事件链路",
        },
        {
          id: "claude-live-reasoning-3",
          kind: "reasoning",
          summary: "补充分析",
          content: "定位线程事件顺序，核对状态同步",
        },
      ];

      const { container, rerender } = render(
        <Messages
          items={items}
          threadId="claude:session-2"
          workspaceId="ws-1"
          isThinking
          activeEngine="claude"
          openTargets={[]}
          selectedOpenAppId=""
        />,
      );

      expect(container.querySelectorAll(".thinking-block")).toHaveLength(2);
      const liveReasoningContents = container.querySelectorAll(".thinking-content");
      expect(liveReasoningContents[0]?.getAttribute("style") ?? "").toContain("display: none");
      expect(liveReasoningContents[1]?.getAttribute("style") ?? "").toContain("display: block");

      rerender(
        <Messages
          items={items}
          threadId="claude:session-2"
          workspaceId="ws-1"
          isThinking={false}
          activeEngine="claude"
          openTargets={[]}
          selectedOpenAppId=""
        />,
      );

      const thinkingBlocks = container.querySelectorAll(".thinking-block");
      const reasoningDetails = container.querySelectorAll(".thinking-content");
      expect(thinkingBlocks).toHaveLength(2);
      expect(reasoningDetails[0]?.textContent ?? "").toContain("读取配置，再检查事件链路");
      expect(reasoningDetails[1]?.textContent ?? "").toContain("定位线程事件顺序，核对状态同步");
      expect(reasoningDetails[0]?.getAttribute("style") ?? "").toContain("display: none");
      expect(reasoningDetails[1]?.getAttribute("style") ?? "").toContain("display: none");
    } finally {
      window.localStorage.removeItem("ccgui.claude.hideReasoningModule");
    }
  });

  it("uses content for the reasoning title when summary is empty", () => {
    const items: ConversationItem[] = [
      {
        id: "reasoning-content-title",
        kind: "reasoning",
        summary: "",
        content: "Plan from content\nMore detail here",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 1_500}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const workingText = container.querySelector(".working-text");
    expect(workingText?.textContent ?? "").toContain("Plan from content");
    const reasoningDetail = container.querySelector(".thinking-content");
    expect(reasoningDetail?.textContent ?? "").toContain("More detail here");
    expect(reasoningDetail?.textContent ?? "").not.toContain("Plan from content");
  });

  it("does not show a stale reasoning label from a previous turn", () => {
    const items: ConversationItem[] = [
      {
        id: "reasoning-old",
        kind: "reasoning",
        summary: "Old reasoning title",
        content: "",
      },
      {
        id: "assistant-msg",
        kind: "message",
        role: "assistant",
        text: "Previous assistant response",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 800}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const workingText = container.querySelector(".working-text");
    const label = workingText?.textContent ?? "";
    expect(label).toBeTruthy();
    expect(label).not.toContain("Old reasoning title");
    expect(label).toMatch(/Working|Generating response|messages\.generatingResponse/);
  });

  it("uses merged codex command summary for live activity and hides cwd-only detail", () => {
    const items: ConversationItem[] = [
      {
        id: "user-codex-command",
        kind: "message",
        role: "user",
        text: "检查状态",
      },
      {
        id: "tool-codex-command",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: git status --short",
        detail: "/Users/chenxiangning/code/AI/reach/ai-reach",
        status: "in_progress",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 800}
        activeEngine="codex"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const activity = container.querySelector(".working-activity");
    expect(activity?.textContent ?? "").toContain("git status --short");
    expect(activity?.textContent ?? "").not.toContain("/Users/chenxiangning/code/AI/reach/ai-reach");
  });

  it("shows non-streaming hint for opencode when waiting long for first chunk", () => {
    vi.useFakeTimers();
    try {
      const items: ConversationItem[] = [
        {
          id: "user-latest",
          kind: "message",
          role: "user",
          text: "请解释一下",
        },
      ];

      const { container } = render(
        <Messages
          items={items}
          threadId="thread-1"
          workspaceId="ws-1"
          isThinking
          processingStartedAt={Date.now() - 13_000}
          heartbeatPulse={1}
          activeEngine="opencode"
          openTargets={[]}
          selectedOpenAppId=""
        />,
      );

      const hint = container.querySelector(".working-hint");
      expect(hint).toBeTruthy();
      const hintText = (hint?.textContent ?? "").trim();
      expect(hintText.length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("updates opencode waiting hint only when heartbeat pulse changes", () => {
    const randomSpy = vi
      .spyOn(Math, "random")
      .mockReturnValueOnce(0.05)
      .mockReturnValueOnce(0.85);
    try {
      const items: ConversationItem[] = [
        {
          id: "user-heartbeat",
          kind: "message",
          role: "user",
          text: "继续",
        },
      ];
      const { container, rerender } = render(
        <Messages
          items={items}
          threadId="thread-1"
          workspaceId="ws-1"
          isThinking
          processingStartedAt={Date.now() - 13_000}
          heartbeatPulse={1}
          activeEngine="opencode"
          openTargets={[]}
          selectedOpenAppId=""
        />,
      );

      const hint1 = container.querySelector(".working-hint")?.textContent ?? "";
      expect(hint1).toMatch(/(心跳|Heartbeat)\s*1/);

      rerender(
        <Messages
          items={items}
          threadId="thread-1"
          workspaceId="ws-1"
          isThinking
          processingStartedAt={Date.now() - 13_000}
          heartbeatPulse={1}
          activeEngine="opencode"
          openTargets={[]}
          selectedOpenAppId=""
        />,
      );
      const hintStable = container.querySelector(".working-hint")?.textContent ?? "";
      expect(hintStable).toBe(hint1);

      rerender(
        <Messages
          items={items}
          threadId="thread-1"
          workspaceId="ws-1"
          isThinking
          processingStartedAt={Date.now() - 13_000}
          heartbeatPulse={2}
          activeEngine="opencode"
          openTargets={[]}
          selectedOpenAppId=""
        />,
      );
      const hint2 = container.querySelector(".working-hint")?.textContent ?? "";
      expect(hint2).toMatch(/(心跳|Heartbeat)\s*2/);
      expect(hint2).not.toBe(hint1);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("shows latest backend activity while thinking", () => {
    const items: ConversationItem[] = [
      {
        id: "user-latest-activity",
        kind: "message",
        role: "user",
        text: "帮我检查项目",
      },
      {
        id: "tool-running-activity",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: rg -n TODO src",
        detail: "/repo",
        status: "running",
        output: "",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 3_000}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const activity = container.querySelector(".working-activity");
    expect(activity?.textContent ?? "").toContain("Command: rg -n TODO src @ /repo");
  });

  it("hides duplicated working activity when it mirrors reasoning label", () => {
    const items: ConversationItem[] = [
      {
        id: "user-reasoning-dup-1",
        kind: "message",
        role: "user",
        text: "继续执行",
      },
      {
        id: "reasoning-reasoning-dup-1",
        kind: "reasoning",
        summary: "用户回复了 \"A\"，表示选择了偏保守重构",
        content: "",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 3_000}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const workingText = container.querySelector(".working-text");
    expect(workingText?.textContent ?? "").toContain("用户回复了");
    expect(container.querySelector(".working-activity")).toBeNull();
  });

  it("does not show stale backend activity from previous turns", () => {
    const items: ConversationItem[] = [
      {
        id: "user-old",
        kind: "message",
        role: "user",
        text: "上一轮",
      },
      {
        id: "tool-old",
        kind: "tool",
        toolType: "commandExecution",
        title: "Command: ls -la",
        detail: "/old",
        status: "completed",
        output: "",
      },
      {
        id: "assistant-old",
        kind: "message",
        role: "assistant",
        text: "上一轮结果",
      },
      {
        id: "user-new",
        kind: "message",
        role: "user",
        text: "新一轮问题",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 2_000}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.querySelector(".working-activity")).toBeNull();
  });

  it("renders final boundary without reasoning boundary when no process items exist", () => {
    const items: ConversationItem[] = [
      {
        id: "user-1",
        kind: "message",
        role: "user",
        text: "Q1",
      },
      {
        id: "assistant-final-1",
        kind: "message",
        role: "assistant",
        text: "A1",
        isFinal: true,
      },
      {
        id: "user-2",
        kind: "message",
        role: "user",
        text: "Q2",
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

    const finalMessageNode = container.querySelector(
      "[data-message-anchor-id='assistant-final-1']",
    );
    const reasoningBoundaryNode = container.querySelector(".messages-reasoning-boundary");
    const boundaryNode = container.querySelector(".messages-final-boundary");
    const boundaryMetaNode = container.querySelector(
      ".messages-final-boundary .messages-turn-boundary-meta",
    );
    expect(finalMessageNode).toBeTruthy();
    expect(reasoningBoundaryNode).toBeNull();
    expect(boundaryNode).toBeTruthy();
    expect(boundaryMetaNode).toBeNull();
    if (finalMessageNode && boundaryNode) {
      expect(
        finalMessageNode.compareDocumentPosition(boundaryNode) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it("shows reasoning boundary when visible process items exist before final message", () => {
    const completedAt = new Date(2026, 3, 10, 14, 41, 42).getTime();
    const items: ConversationItem[] = [
      {
        id: "user-process-1",
        kind: "message",
        role: "user",
        text: "Q1",
      },
      {
        id: "reasoning-process-1",
        kind: "reasoning",
        summary: "先分析",
        content: "检查变更范围",
      },
      {
        id: "assistant-process-final-1",
        kind: "message",
        role: "assistant",
        text: "A1",
        isFinal: true,
        finalCompletedAt: completedAt,
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

    const finalMessageNode = container.querySelector(
      "[data-message-anchor-id='assistant-process-final-1']",
    );
    const reasoningBoundaryNode = container.querySelector(".messages-reasoning-boundary");
    const reasoningBoundaryMetaNode = container.querySelector(
      ".messages-reasoning-boundary .messages-turn-boundary-meta",
    );
    const finalBoundaryMetaNode = container.querySelector(
      ".messages-final-boundary .messages-turn-boundary-meta",
    );
    expect(finalMessageNode).toBeTruthy();
    expect(reasoningBoundaryNode).toBeTruthy();
    expect(reasoningBoundaryMetaNode?.textContent ?? "").toContain("04-10 14:41:42");
    expect(reasoningBoundaryMetaNode?.getAttribute("aria-hidden")).toBe("true");
    expect(reasoningBoundaryMetaNode?.textContent).toBe(finalBoundaryMetaNode?.textContent);
    if (finalMessageNode && reasoningBoundaryNode) {
      expect(
        reasoningBoundaryNode.compareDocumentPosition(finalMessageNode) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

});
