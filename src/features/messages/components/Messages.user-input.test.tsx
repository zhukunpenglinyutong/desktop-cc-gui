// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationItem } from "../../../types";
import { Messages } from "./Messages";

describe("Messages user input parsing", () => {
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

  it("shows only user input for assembled prompt payload in user bubble", () => {
    const items: ConversationItem[] = [
      {
        id: "msg-assembled-1",
        kind: "message",
        role: "user",
        text:
          "[System] 你是 ccgui 内的 Claude Code Agent。 [Skill Prompt] # Skill: tr-zh-en-jp 技能说明... [Commons Prompt] 规范... [User Input] 你好啊",
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

    const userText = container.querySelector(".user-collapsible-text-content");
    expect(userText?.textContent ?? "").toBe("你好啊");
  });

  it("shows only current request when shared-session sync wrapper is present", () => {
    const items: ConversationItem[] = [
      {
        id: "msg-shared-sync-1",
        kind: "message",
        role: "user",
        text:
          "Shared session context sync. Continue from these recent turns before answering the new request:\n\n" +
          "Turn 1\nUser: hello\ncodex: world\n\n" +
          "Current user request:\n继续分析共享会话的上下文问题",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="shared:thread-1"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const userText = container.querySelector(".user-collapsible-text-content");
    expect(userText?.textContent ?? "").toBe("继续分析共享会话的上下文问题");
  });

  it("keeps user bubble visible when memory-prefix parsing leaves empty remaining text", () => {
    const items: ConversationItem[] = [
      {
        id: "msg-memory-prefix-only-1",
        kind: "message",
        role: "user",
        text:
          "<project-memory>\n[记忆] 用户输入：共享上下文修复；助手输出摘要：已更新。\n</project-memory>",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="shared:thread-2"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const userText = container.querySelector(".user-collapsible-text-content");
    expect((userText?.textContent ?? "").trim().length).toBeGreaterThan(0);
  });

  it("hides agent prompt block in history user bubble and shows selected agent tag", () => {
    const items: ConversationItem[] = [
      {
        id: "msg-agent-header-1",
        kind: "message",
        role: "user",
        text:
          "请帮我优化这段 UI。\n\n## Agent Role and Instructions\n\n前端专家\n你是一个专注前端体验的专家。",
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

    const userText = container.querySelector(".user-collapsible-text-content");
    const userBubble = container.querySelector(".message.user .bubble");
    const agentTagInBubble = userBubble?.querySelector(".message-agent-reveal");
    const agentIconButton = container.querySelector(".message-agent-icon-button");
    expect(userText?.textContent ?? "").toBe("请帮我优化这段 UI。");
    expect(container.querySelector(".message-agent-tag-text")).toBeNull();
    expect(agentIconButton).toBeTruthy();
    if (agentIconButton) {
      fireEvent.click(agentIconButton);
    }
    expect(container.querySelector(".message-agent-tag-text")?.textContent ?? "").toBe("前端专家");
    expect(agentTagInBubble).toBeNull();
    expect(container.textContent ?? "").not.toContain("Agent Role and Instructions");
    expect(container.textContent ?? "").not.toContain("你是一个专注前端体验的专家");
  });

  it("strips injected agent prompt block even when fallback metadata is missing", () => {
    const items: ConversationItem[] = [
      {
        id: "msg-agent-header-user-authored",
        kind: "message",
        role: "user",
        text:
          "这是一段用户原始内容。\n\n## Agent Role and Instructions\n\n擅长前后端桌面全局架构和编码,具备谨慎和创造性",
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

    const userText = container.querySelector(".user-collapsible-text-content");
    expect(userText?.textContent ?? "").toBe("这是一段用户原始内容。");
    const agentIconButton = container.querySelector(".message-agent-icon-button");
    expect(agentIconButton).toBeTruthy();
    expect(container.querySelector(".message-agent-tag-text")).toBeNull();
  });

  it("reads agent name from explicit Agent Name line in injected prompt block", () => {
    const items: ConversationItem[] = [
      {
        id: "msg-agent-header-with-name-line",
        kind: "message",
        role: "user",
        text:
          "请继续。\n\n## Agent Role and Instructions\n\nAgent Name: 后端架构师\nAgent Icon: agent-robot-04\n\n你是一位资深后端架构师，擅长服务治理和高并发设计。",
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

    const userText = container.querySelector(".user-collapsible-text-content");
    expect(userText?.textContent ?? "").toBe("请继续。");
    const agentIconButton = container.querySelector(".message-agent-icon-button");
    expect(agentIconButton).toBeTruthy();
    if (agentIconButton) {
      fireEvent.click(agentIconButton);
    }
    expect(container.querySelector(".message-agent-tag-text")?.textContent ?? "").toBe("后端架构师");
    expect(agentIconButton?.querySelector(".agent-icon-svg")?.innerHTML ?? "").toContain("<svg");
  });

  it("shows selected agent tag for realtime/local user message metadata", () => {
    const items: ConversationItem[] = [
      {
        id: "msg-agent-meta-1",
        kind: "message",
        role: "user",
        text: "继续执行",
        selectedAgentName: "后端架构师",
        selectedAgentIcon: "agent-robot-03",
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

    const userText = container.querySelector(".user-collapsible-text-content");
    const agentIconButton = container.querySelector(".message-agent-icon-button");
    expect(userText?.textContent ?? "").toBe("继续执行");
    expect(container.querySelector(".message-agent-tag-text")).toBeNull();
    expect(agentIconButton).toBeTruthy();
    if (agentIconButton) {
      fireEvent.click(agentIconButton);
    }
    expect(container.querySelector(".message-agent-tag-text")?.textContent ?? "").toBe("后端架构师");
    expect(agentIconButton?.querySelector(".agent-icon-svg")).toBeTruthy();
  });

  it("derives stable icon from agent name when legacy metadata has no icon", () => {
    const items: ConversationItem[] = [
      {
        id: "msg-agent-legacy-1",
        kind: "message",
        role: "user",
        text: "你好你是架构师吗",
        selectedAgentName: "java架构师",
      },
      {
        id: "msg-agent-legacy-2",
        kind: "message",
        role: "user",
        text: "收到",
        selectedAgentName: "前端专家",
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

    const iconButtons = Array.from(
      container.querySelectorAll(".message-agent-icon-button"),
    ) as HTMLButtonElement[];
    expect(iconButtons).toHaveLength(2);
    const firstMarkup = iconButtons[0]?.querySelector(".agent-icon-svg")?.innerHTML ?? "";
    const secondMarkup = iconButtons[1]?.querySelector(".agent-icon-svg")?.innerHTML ?? "";
    expect(firstMarkup.length).toBeGreaterThan(0);
    expect(secondMarkup.length).toBeGreaterThan(0);
    expect(firstMarkup).not.toBe(secondMarkup);
  });

  it("preserves multiline formatting when extracting [User Input] content", () => {
    const multilineInput = "整理内容为：\n1. 宏观观点\n2. 宏观观点\n\n3. 商品观点";
    const items: ConversationItem[] = [
      {
        id: "msg-assembled-multiline-1",
        kind: "message",
        role: "user",
        text: `[System] spec hints [User Input] ${multilineInput}`,
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

    const userText = container.querySelector(".user-collapsible-text-content");
    expect(userText?.textContent ?? "").toBe(multilineInput);
  });

  it("keeps user multiline input when skill/common/system blocks are present before [User Input]", () => {
    const multilineInput = "你好\n我是陈湘宁!!";
    const items: ConversationItem[] = [
      {
        id: "msg-assembled-skill-common-multiline-1",
        kind: "message",
        role: "user",
        text:
          "[System] 你是 ccgui 内的 Claude Code Agent。\n" +
          "[Skill Prompt] # Skill: tr-zh-en-jp\n" +
          "[Commons Prompt] 规范...\n" +
          `[User Input] ${multilineInput}`,
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

    const userText = container.querySelector(".user-collapsible-text-content");
    expect(userText?.textContent ?? "").toBe(multilineInput);
  });

  it("keeps license block line structure when extracting [User Input] content", () => {
    const licenseInput = [
      "-----BEGIN LICENSE-----",
      "TEAM HCiSO",
      "Unlimited User License",
      "EA7E-2000959661",
      "5C5E565261BC9146AAAC8783289A74F5",
      "-----END LICENSE-----",
    ].join("\n");
    const items: ConversationItem[] = [
      {
        id: "msg-assembled-license-1",
        kind: "message",
        role: "user",
        text: `[System] spec hints [User Input] ${licenseInput}`,
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

    const userText = container.querySelector(".user-collapsible-text-content");
    expect(userText?.textContent ?? "").toBe(licenseInput);
  });

  it("copies extracted user input without collapsing multiline formatting", async () => {
    const writeTextMock = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextMock },
      configurable: true,
    });
    const multilineInput = "整理内容为：\n1. 宏观观点\n2. 商品观点\n\n3. 技术观点";
    const items: ConversationItem[] = [
      {
        id: "msg-copy-multiline-1",
        kind: "message",
        role: "user",
        text: `[System] spec hints [User Input] ${multilineInput}`,
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

    const copyButton = container.querySelector(".message-copy-button");
    expect(copyButton).toBeTruthy();
    if (copyButton) {
      fireEvent.click(copyButton);
    }
    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith(multilineInput);
    });
  });

  it("hides code fallback prefix and keeps only actual user request", () => {
    const items: ConversationItem[] = [
      {
        id: "msg-code-fallback-1",
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
        activeEngine="codex"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const userText = container.querySelector(".user-collapsible-text-content");
    expect(userText?.textContent ?? "").toBe("你好");
    expect(container.querySelector(".message-mode-badge")).toBeNull();
  });

  it("hides plan fallback prefix and keeps only actual user request", () => {
    const items: ConversationItem[] = [
      {
        id: "msg-plan-fallback-1",
        kind: "message",
        role: "user",
        text:
          "Execution policy (plan mode): planning-only. If blocker appears, call requestUserInput.\n\nUser request: 先给我计划",
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

    const userText = container.querySelector(".user-collapsible-text-content");
    expect(userText?.textContent ?? "").toBe("先给我计划");
    expect(container.querySelector(".message-mode-badge")).toBeNull();
  });

  it("does not show plan badge for user message when message mode is plan", () => {
    const items: ConversationItem[] = [
      {
        id: "msg-plan-1",
        kind: "message",
        role: "user",
        text: "请先规划步骤",
        collaborationMode: "plan",
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

    expect(container.querySelector(".message-mode-badge")).toBeNull();
  });

  it("extracts non-image @path references into standalone card in user bubble", () => {
    const items: ConversationItem[] = [
      {
        id: "msg-file-ref-1",
        kind: "message",
        role: "user",
        text:
          "@/Users/demo/repo/.specify目录结构说明.md @/Users/demo/repo/docs/ 看一下",
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

    const refs = container.querySelectorAll(".user-reference-card-item");
    const userText = container.querySelector(".user-collapsible-text-content");
    expect(refs).toHaveLength(2);
    expect(userText?.textContent ?? "").toContain("看一下");
    expect(userText?.textContent ?? "").not.toContain("@/Users/demo/repo/docs/");
  });

  it("extracts quoted @path references into standalone card in user bubble", () => {
    const items: ConversationItem[] = [
      {
        id: "msg-file-ref-quoted-1",
        kind: "message",
        role: "user",
        text: '@"/Users/demo/repo/My File.md" 看一下',
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

    const refs = container.querySelectorAll(".user-reference-card-item");
    const userText = container.querySelector(".user-collapsible-text-content");
    expect(refs).toHaveLength(1);
    expect(userText?.textContent ?? "").toContain("看一下");
    expect(userText?.textContent ?? "").not.toContain("/Users/demo/repo/My File.md");
  });


});
