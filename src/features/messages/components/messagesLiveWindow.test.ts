import { describe, expect, it } from "vitest";
import type { ConversationItem } from "../../../types";
import {
  buildAssistantFinalBoundarySet,
  buildAssistantFinalWithVisibleProcessSet,
  buildHistoryStickyCandidates,
  buildLiveTailWorkingSet,
  buildRenderedItemsWindow,
  resolveActiveStickyHeaderCandidate,
  resolveStreamingPresentationItems,
} from "./messagesLiveWindow";

function userMessage(id: string, text = id): Extract<ConversationItem, { kind: "message" }> {
  return {
    id,
    kind: "message",
    role: "user",
    text,
  };
}

function assistantMessage(id: string, text = id): Extract<ConversationItem, { kind: "message" }> {
  return {
    id,
    kind: "message",
    role: "assistant",
    text,
  };
}

describe("messages live window", () => {
  it("builds a bounded live tail working set and preserves the sticky user", () => {
    const items: ConversationItem[] = [
      userMessage("user-old", "早期问题"),
      ...Array.from({ length: 68 }, (_, index) =>
        assistantMessage(`assistant-${index}`, `回复 ${index}`),
      ),
      userMessage("user-latest", "最新问题"),
      assistantMessage("assistant-live", "正在回答"),
    ];

    const workingSet = buildLiveTailWorkingSet(items, {
      isThinking: true,
      showAllHistoryItems: false,
      visibleWindow: 30,
    });

    expect(workingSet.items.length).toBeLessThan(items.length);
    expect(workingSet.items.some((item) => item.id === "user-latest")).toBe(true);
    expect(workingSet.items.at(-1)?.id).toBe("assistant-live");
    expect(workingSet.stickyUserMessageId).toBe("user-latest");
    expect(workingSet.omittedBeforeWorkingSetCount).toBeGreaterThan(0);
  });

  it("keeps full history when show all is enabled", () => {
    const items = Array.from({ length: 80 }, (_, index) =>
      assistantMessage(`assistant-${index}`, `回复 ${index}`),
    );

    const workingSet = buildLiveTailWorkingSet(items, {
      isThinking: true,
      showAllHistoryItems: true,
      visibleWindow: 30,
    });

    expect(workingSet.items).toBe(items);
    expect(workingSet.omittedBeforeWorkingSetCount).toBe(0);
  });

  it("adds omitted prefix count to rendered collapsed history count", () => {
    const items = [
      userMessage("user-latest", "最新问题"),
      ...Array.from({ length: 60 }, (_, index) =>
        assistantMessage(`assistant-${index}`, `回复 ${index}`),
      ),
    ];
    const workingSet = buildLiveTailWorkingSet(items, {
      isThinking: true,
      showAllHistoryItems: false,
      visibleWindow: 30,
    });
    const localCollapsedCount = Math.max(0, workingSet.items.length - 30);
    const renderedWindow = buildRenderedItemsWindow(
      workingSet.items,
      localCollapsedCount,
      workingSet.stickyUserMessageId,
    );

    expect(
      renderedWindow.visibleCollapsedHistoryItemCount
        + workingSet.omittedBeforeWorkingSetCount,
    ).toBe(items.length - renderedWindow.renderedItems.length);
    expect(renderedWindow.renderedItems.some((item) => item.id === "user-latest")).toBe(true);
  });

  it("keeps a deferred presentation snapshot stable while appending newly inserted live items", () => {
    const deferredItems = [
      userMessage("user-1", "问题"),
      assistantMessage("assistant-1", "第一版输出"),
    ];
    const currentItems = [
      userMessage("user-1", "问题"),
      assistantMessage("assistant-1", "第一版输出后续增量"),
      assistantMessage("assistant-2", "新的 live 尾项"),
    ];

    const resolvedItems = resolveStreamingPresentationItems(
      deferredItems,
      currentItems,
      true,
    );

    expect(resolvedItems).toEqual([
      deferredItems[0],
      deferredItems[1],
      currentItems[2],
    ]);
  });

  it("reuses the deferred presentation snapshot reference when streaming only updates existing ids", () => {
    const deferredItems = [
      userMessage("user-1", "问题"),
      assistantMessage("assistant-1", "第一版输出"),
    ];
    const currentItems = [
      userMessage("user-1", "问题"),
      assistantMessage("assistant-1", "第一版输出后续增量"),
    ];

    const resolvedItems = resolveStreamingPresentationItems(
      deferredItems,
      currentItems,
      true,
    );

    expect(resolvedItems).toBe(deferredItems);
  });

  it("keeps history sticky ids stable while refreshing the active sticky text from the live snapshot", () => {
    const stableCandidates = buildHistoryStickyCandidates(
      [userMessage("user-1", "旧文案")],
      false,
    );

    const resolvedCandidate = resolveActiveStickyHeaderCandidate(
      stableCandidates,
      "user-1",
      [userMessage("user-1", "新文案")],
      false,
    );

    expect(resolvedCandidate).toEqual({
      id: "user-1",
      text: "新文案",
    });
  });

  it("keeps only the latest final assistant in each user turn as a final boundary", () => {
    const boundarySet = buildAssistantFinalBoundarySet([
      userMessage("user-1", "问题 1"),
      assistantMessage("assistant-1a", "阶段一"),
      {
        ...assistantMessage("assistant-1b", "最终回答 1"),
        isFinal: true,
      },
      userMessage("user-2", "问题 2"),
      {
        ...assistantMessage("assistant-2a", "最终回答 2-a"),
        isFinal: true,
      },
      assistantMessage("assistant-2b", "处理中"),
      {
        ...assistantMessage("assistant-2c", "最终回答 2-c"),
        isFinal: true,
      },
    ]);

    expect(Array.from(boundarySet)).toEqual(["assistant-1b", "assistant-2c"]);
  });

  it("marks only final assistant boundaries that have visible process items in the turn", () => {
    const items: ConversationItem[] = [
      userMessage("user-1", "问题 1"),
      {
        id: "reasoning-1",
        kind: "reasoning",
        summary: "分析中",
        content: "",
      },
      {
        ...assistantMessage("assistant-1", "最终回答 1"),
        isFinal: true,
      },
      userMessage("user-2", "问题 2"),
      {
        ...assistantMessage("assistant-2", "最终回答 2"),
        isFinal: true,
      },
    ];

    const boundarySet = buildAssistantFinalBoundarySet(items);
    const processSet = buildAssistantFinalWithVisibleProcessSet(items, boundarySet);

    expect(Array.from(processSet)).toEqual(["assistant-1"]);
  });
});
