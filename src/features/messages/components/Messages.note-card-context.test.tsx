// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ConversationItem } from "../../../types";
import { Messages } from "./Messages";
import { buildSuppressedUserNoteCardContextMessageIdSet } from "./messagesNoteCardContext";

describe("Messages note-card context", () => {
  afterEach(() => {
    cleanup();
  });

  beforeAll(() => {
    if (!HTMLElement.prototype.scrollIntoView) {
      HTMLElement.prototype.scrollIntoView = vi.fn();
    }
    if (!HTMLElement.prototype.scrollTo) {
      HTMLElement.prototype.scrollTo = vi.fn();
    }
  });

  it("renders note-card context summary as a separate half-collapsed card by default", () => {
    const items: ConversationItem[] = [
      {
        id: "note-card-summary-1",
        kind: "message",
        role: "assistant",
        text:
          '【便签上下文】\n<note-card-context>\n<note-card title="发布清单" archived="false">\n先构建，再发布\n第二步执行部署脚本\n\nImages:\n- deploy.png | /tmp/ws/.ccgui/note_card/ws/assets/note-1/deploy.png\n- rollback.png | /tmp/ws/.ccgui/note_card/ws/assets/note-1/rollback.png\n</note-card>\n</note-card-context>',
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-note-card-summary"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const summaryCard = container.querySelector(".note-card-context-summary-card");
    const toggle = container.querySelector<HTMLButtonElement>(".note-card-context-summary-toggle");
    expect(summaryCard?.textContent ?? "").toContain("发布清单");
    expect(summaryCard?.textContent ?? "").toContain("第二步执行部署脚本");
    expect(container.querySelectorAll(".note-card-context-summary-image")).toHaveLength(1);
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".note-card-context-summary-preview")).toBeTruthy();
    expect(container.querySelector(".note-card-context-summary-markdown")).toBeNull();
    if (!toggle) {
      throw new Error("expected note-card summary toggle");
    }

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector(".note-card-context-summary-markdown")).toBeTruthy();
    expect(container.querySelectorAll(".note-card-context-summary-image")).toHaveLength(2);
  });

  it("strips legacy user note-card suffix into a separate card and keeps user bubble clean", () => {
    const normalImageDataUrl =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIW2P8//8/AwAI/AL+X0MyoQAAAABJRU5ErkJggg==";
    const noteCardImagePath = "/tmp/ws/.ccgui/note_card/ws/assets/note-1/deploy.png";
    const items: ConversationItem[] = [
      {
        id: "legacy-user-note-card-1",
        kind: "message",
        role: "user",
        text:
          '请按这个执行\n\n<note-card-context>\n<note-card title="发布清单" archived="false">\n先构建，再发布\n\nImages:\n- deploy.png | /tmp/ws/.ccgui/note_card/ws/assets/note-1/deploy.png\n</note-card>\n</note-card-context>',
        images: [normalImageDataUrl, noteCardImagePath],
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-legacy-note-card"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const userBubble = container.querySelector(".message.user .bubble");
    expect(userBubble?.textContent ?? "").toContain("请按这个执行");
    expect(userBubble?.textContent ?? "").not.toContain("发布清单");

    const summaryCard = container.querySelector(".note-card-context-summary-card");
    expect(summaryCard?.textContent ?? "").toContain("发布清单");
    expect(summaryCard?.textContent ?? "").toContain("先构建，再发布");
    expect(container.querySelectorAll(".message-image-thumb")).toHaveLength(1);
    expect(container.querySelectorAll(".note-card-context-summary-image")).toHaveLength(1);
  });

  it("dedupes note-card images when the message image uses asset localhost form", () => {
    const noteCardImagePath = "/tmp/ws/.ccgui/note_card/ws/assets/note-1/deploy.png";
    const items: ConversationItem[] = [
      {
        id: "legacy-user-note-card-asset-image-1",
        kind: "message",
        role: "user",
        text:
          '请按这个执行\n\n<note-card-context>\n<note-card title="发布清单" archived="false">\n先构建，再发布\n\nImages:\n- deploy.png | /tmp/ws/.ccgui/note_card/ws/assets/note-1/deploy.png\n</note-card>\n</note-card-context>',
        images: [`asset://localhost${noteCardImagePath}`],
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-legacy-note-card-asset-image"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.querySelectorAll(".message-image-thumb")).toHaveLength(0);
    expect(container.querySelectorAll(".note-card-context-summary-image")).toHaveLength(1);
  });

  it("dedupes note-card images when the message image uses a Windows UNC file URI", () => {
    const items: ConversationItem[] = [
      {
        id: "legacy-user-note-card-unc-image-1",
        kind: "message",
        role: "user",
        text:
          '请按这个执行\n\n<note-card-context>\n<note-card title="发布清单" archived="false">\n先构建，再发布\n\nImages:\n- deploy.png | \\\\server\\share\\deploy.png\n</note-card>\n</note-card-context>',
        images: ["file://server/share/deploy.png"],
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-legacy-note-card-unc-image"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.querySelectorAll(".message-image-thumb")).toHaveLength(0);
    expect(container.querySelectorAll(".note-card-context-summary-image")).toHaveLength(1);
  });

  it("dedupes assistant note-card summary cards against legacy user suffix in the same turn", () => {
    const items: ConversationItem[] = [
      {
        id: "assistant-note-card-summary-1",
        kind: "message",
        role: "assistant",
        text:
          '【便签上下文】\n<note-card-context>\n<note-card title="发布清单" archived="false">\n先构建，再发布\n\nImages:\n- deploy.png | /tmp/ws/.ccgui/note_card/ws/assets/note-1/deploy.png\n</note-card>\n</note-card-context>',
      },
      {
        id: "legacy-user-note-card-duplicate-1",
        kind: "message",
        role: "user",
        text:
          '请按这个执行\n\n<note-card-context>\n<note-card title="发布清单" archived="false">\n先构建，再发布\n\nImages:\n- deploy.png | /tmp/ws/.ccgui/note_card/ws/assets/note-1/deploy.png\n</note-card>\n</note-card-context>',
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-note-card-dedupe"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.querySelectorAll(".note-card-context-summary-card")).toHaveLength(1);
    const userBubble = container.querySelector(".message.user .bubble");
    expect(userBubble?.textContent ?? "").toContain("请按这个执行");
    expect(userBubble?.textContent ?? "").not.toContain("发布清单");
  });

  it("still filters note-card attachment images from a suppressed live user bubble", () => {
    const noteCardImagePath = "/tmp/ws/.ccgui/note_card/ws/assets/note-1/deploy.png";
    const items: ConversationItem[] = [
      {
        id: "assistant-note-card-summary-live",
        kind: "message",
        role: "assistant",
        text:
          '【便签上下文】\n<note-card-context>\n<note-card title="发布清单" archived="false">\n先构建，再发布\n\nImages:\n- deploy.png | /tmp/ws/.ccgui/note_card/ws/assets/note-1/deploy.png\n</note-card>\n</note-card-context>',
      },
      {
        id: "optimistic-user-live",
        kind: "message",
        role: "user",
        text:
          '请按这个执行\n\n<note-card-context>\n<note-card title="发布清单" archived="false">\n先构建，再发布\n\nImages:\n- deploy.png | /tmp/ws/.ccgui/note_card/ws/assets/note-1/deploy.png\n</note-card>\n</note-card-context>',
        images: [noteCardImagePath],
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-note-card-live-dedupe"
        workspaceId="ws-1"
        isThinking
        activeEngine="codex"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.querySelectorAll(".note-card-context-summary-card")).toHaveLength(1);
    expect(container.querySelectorAll(".message-image-thumb")).toHaveLength(0);
  });

  it("keeps ordinary user screenshots when suppressing the duplicated note-card summary card", () => {
    const ordinaryScreenshot =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVQImWNgYGD4z8DAwMDEAAUABJ8BB6cJteUAAAAASUVORK5CYII=";
    const noteCardImagePath = "/tmp/ws/.ccgui/note_card/ws/assets/note-1/deploy.png";
    const items: ConversationItem[] = [
      {
        id: "assistant-note-card-summary-history",
        kind: "message",
        role: "assistant",
        text:
          '【便签上下文】\n<note-card-context>\n<note-card title="发布清单" archived="false">\n先构建，再发布\n\nImages:\n- deploy.png | /tmp/ws/.ccgui/note_card/ws/assets/note-1/deploy.png\n</note-card>\n</note-card-context>',
      },
      {
        id: "real-user-note-card-history",
        kind: "message",
        role: "user",
        text:
          '请同时参考便签和这张截图\n\n<note-card-context>\n<note-card title="发布清单" archived="false">\n先构建，再发布\n\nImages:\n- deploy.png | /tmp/ws/.ccgui/note_card/ws/assets/note-1/deploy.png\n</note-card>\n</note-card-context>',
        images: [ordinaryScreenshot, noteCardImagePath],
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-note-card-history-screenshot"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="codex"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.querySelectorAll(".note-card-context-summary-card")).toHaveLength(1);
    expect(container.querySelectorAll(".message-image-thumb")).toHaveLength(1);
    expect(container.querySelectorAll(".note-card-context-summary-image")).toHaveLength(1);
  });

  it("does not suppress a later user note-card card when the matching summary belongs to an earlier turn", () => {
    const items: ConversationItem[] = [
      {
        id: "assistant-note-card-summary-old",
        kind: "message",
        role: "assistant",
        text:
          '【便签上下文】\n<note-card-context>\n<note-card title="发布清单" archived="false">\n先构建，再发布\n</note-card>\n</note-card-context>',
      },
      {
        id: "user-old",
        kind: "message",
        role: "user",
        text: "上一轮普通消息",
      },
      {
        id: "assistant-old",
        kind: "message",
        role: "assistant",
        text: "上一轮回复",
      },
      {
        id: "legacy-user-note-card-later",
        kind: "message",
        role: "user",
        text:
          '请按这个执行\n\n<note-card-context>\n<note-card title="发布清单" archived="false">\n先构建，再发布\n</note-card>\n</note-card-context>',
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-note-card-dedupe-boundary"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.querySelectorAll(".note-card-context-summary-card")).toHaveLength(2);
  });

  it("suppresses duplicated user note-card cards even when pending user bubbles sit between summary and real user", () => {
    const suppressedIds = buildSuppressedUserNoteCardContextMessageIdSet([
      {
        id: "assistant-note-card-summary-1",
        kind: "message",
        role: "assistant",
        text:
          '【便签上下文】\n<note-card-context>\n<note-card title="发布清单" archived="false">\n先构建，再发布\n</note-card>\n</note-card-context>',
      },
      {
        id: "optimistic-user-1",
        kind: "message",
        role: "user",
        text: "请按这个执行",
      },
      {
        id: "queued-handoff-1",
        kind: "message",
        role: "user",
        text: "请按这个执行",
      },
      {
        id: "real-user-1",
        kind: "message",
        role: "user",
        text:
          '请按这个执行\n\n<note-card-context>\n<note-card title="发布清单" archived="false">\n先构建，再发布\n</note-card>\n</note-card-context>',
      },
    ]);

    expect(Array.from(suppressedIds)).toEqual(["real-user-1"]);
  });

  it("does not suppress a real user note-card card across an unrelated pending user bubble", () => {
    const suppressedIds = buildSuppressedUserNoteCardContextMessageIdSet([
      {
        id: "assistant-note-card-summary-1",
        kind: "message",
        role: "assistant",
        text:
          '【便签上下文】\n<note-card-context>\n<note-card title="发布清单" archived="false">\n先构建，再发布\n</note-card>\n</note-card-context>',
      },
      {
        id: "queued-handoff-previous-turn",
        kind: "message",
        role: "user",
        text: "先帮我看上一轮的问题",
      },
      {
        id: "real-user-1",
        kind: "message",
        role: "user",
        text:
          '请按这个执行\n\n<note-card-context>\n<note-card title="发布清单" archived="false">\n先构建，再发布\n</note-card>\n</note-card-context>',
      },
    ]);

    expect(Array.from(suppressedIds)).toEqual([]);
  });
});
