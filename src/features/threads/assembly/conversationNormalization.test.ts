import { describe, expect, it } from "vitest";
import {
  areEquivalentAssistantMessageTexts,
  areEquivalentReasoningTexts,
  buildComparableConversationMessageSignature,
  buildComparableUserMessageKey,
  isEquivalentUserObservation,
  normalizeComparableUserText,
} from "./conversationNormalization";

describe("conversationNormalization", () => {
  it("normalizes injected user wrappers into one comparable text", () => {
    expect(
      normalizeComparableUserText("[Spec Root Priority] ... [User Input] hello codex"),
    ).toBe("hello codex");
  });

  it("treats selected-agent injected user text as equivalent", () => {
    expect(
      isEquivalentUserObservation(
        {
          text: "你好",
          images: ["local://image-1"],
        },
        {
          text:
            "你好\n\n## Agent Role and Instructions\n\nAgent Name: 小张\n\n你是资深助手，回答要精炼。",
          images: ["local://image-1"],
        },
      ),
    ).toBe(true);
  });

  it("keeps user message key stable across wrappers", () => {
    expect(
      buildComparableUserMessageKey({
        text: "hello codex",
      }),
    ).toBe(
      buildComparableUserMessageKey({
        text: "[Spec Root Priority] ... [User Input] hello codex",
      }),
    );
  });

  it("treats note-card injected user text and note attachments as the same user intent", () => {
    const injectedText = [
      "请按这个执行",
      "",
      "<note-card-context>",
      '<note-card title="发布清单" archived="false">',
      "先构建，再发布",
      "",
      "Images:",
      "- deploy.png | /tmp/ws/.ccgui/note_card/ws/assets/note-1/deploy.png",
      "</note-card>",
      "</note-card-context>",
    ].join("\n");

    expect(
      isEquivalentUserObservation(
        {
          text: "请按这个执行",
          images: [],
        },
        {
          text: injectedText,
          images: [
            "asset://localhost/tmp/ws/.ccgui/note_card/ws/assets/note-1/deploy.png",
          ],
        },
      ),
    ).toBe(true);
  });

  it("does not treat note body bullet lines as injected note attachments", () => {
    const injectedText = [
      "请按这个执行",
      "",
      "<note-card-context>",
      '<note-card title="发布清单" archived="false">',
      "下面这行只是正文，不是图片附件：",
      "- deploy.png | /tmp/ws/.ccgui/note_card/ws/assets/note-1/deploy.png",
      "</note-card>",
      "</note-card-context>",
    ].join("\n");

    expect(
      isEquivalentUserObservation(
        {
          text: "请按这个执行",
          images: [],
        },
        {
          text: injectedText,
          images: [
            "asset://localhost/tmp/ws/.ccgui/note_card/ws/assets/note-1/deploy.png",
          ],
        },
      ),
    ).toBe(false);
  });

  it("builds message signature with role-aware normalization", () => {
    expect(
      buildComparableConversationMessageSignature({
        id: "user-1",
        kind: "message",
        role: "user",
        text: "[User Input] hello codex",
      }),
    ).toContain("hello codex");
  });

  it("keeps user message signature stable when note-card attachments only differ in image transport form", () => {
    const injectedText = [
      "请按这个执行",
      "",
      "<note-card-context>",
      '<note-card title="发布清单" archived="false">',
      "先构建，再发布",
      "",
      "Images:",
      "- deploy.png | /tmp/ws/.ccgui/note_card/ws/assets/note-1/deploy.png",
      "</note-card>",
      "</note-card-context>",
    ].join("\n");

    expect(
      buildComparableConversationMessageSignature({
        id: "user-1",
        kind: "message",
        role: "user",
        text: injectedText,
        images: [
          "asset://localhost/tmp/ws/.ccgui/note_card/ws/assets/note-1/deploy.png",
        ],
      }),
    ).toBe(
      buildComparableConversationMessageSignature({
        id: "user-2",
        kind: "message",
        role: "user",
        text: injectedText,
      }),
    );
  });

  it("treats near-duplicate assistant payloads as equivalent", () => {
    const first = [
      "Computer Use 还没真正拉起来。",
      "",
      "请先确认权限。",
    ].join("\n");
    const second = [
      "Computer Use还没真正拉起来。",
      "",
      "请先确认权限。",
    ].join("\n");

    expect(areEquivalentAssistantMessageTexts(first, second)).toBe(true);
  });

  it("treats reasoning snapshots with shared canonical content as equivalent", () => {
    expect(
      areEquivalentReasoningTexts(
        "先检查 runtime 状态，再看历史恢复链路。",
        "先检查 runtime 状态，再看历史恢复链路",
      ),
    ).toBe(true);
  });
});
