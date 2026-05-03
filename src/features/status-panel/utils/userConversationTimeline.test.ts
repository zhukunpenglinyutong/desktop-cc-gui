import { describe, expect, it } from "vitest";
import type { ConversationItem } from "../../../types";
import { resolveUserConversationTimeline } from "./userConversationTimeline";

describe("resolveUserConversationTimeline", () => {
  it("returns empty state when there is no user message", () => {
    const timeline = resolveUserConversationTimeline([
      { id: "a1", kind: "message", role: "assistant", text: "done" },
    ]);

    expect(timeline).toEqual({
      items: [],
      hasMessage: false,
    });
  });

  it("returns user messages in reverse chronological order", () => {
    const items: ConversationItem[] = [
      { id: "u1", kind: "message", role: "user", text: "older" },
      { id: "a1", kind: "message", role: "assistant", text: "done" },
      { id: "u2", kind: "message", role: "user", text: " latest question " },
    ];

    const timeline = resolveUserConversationTimeline(items);

    expect(timeline).toEqual({
      items: [
        { id: "u2", text: "latest question", imageCount: 0, chronologicalIndex: 2 },
        { id: "u1", text: "older", imageCount: 0, chronologicalIndex: 1 },
      ],
      hasMessage: true,
    });
  });

  it("keeps image-only user messages as meaningful timeline items", () => {
    const items: ConversationItem[] = [
      {
        id: "u1",
        kind: "message",
        role: "user",
        text: "   ",
        images: ["a.png", "b.png"],
      },
    ];

    const timeline = resolveUserConversationTimeline(items);

    expect(timeline).toEqual({
      items: [{ id: "u1", text: "", imageCount: 2, chronologicalIndex: 1 }],
      hasMessage: true,
    });
  });

  it("keeps text and image count together for mixed messages", () => {
    const items: ConversationItem[] = [
      {
        id: "u1",
        kind: "message",
        role: "user",
        text: "Please check",
        images: ["a.png"],
      },
    ];

    const timeline = resolveUserConversationTimeline(items);

    expect(timeline).toEqual({
      items: [{ id: "u1", text: "Please check", imageCount: 1, chronologicalIndex: 1 }],
      hasMessage: true,
    });
  });
});
