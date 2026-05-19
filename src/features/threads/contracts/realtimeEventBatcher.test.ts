import { describe, expect, it } from "vitest";
import type { NormalizedThreadEvent } from "./conversationCurtainContracts";
import { createRealtimeEventBatcher } from "./realtimeEventBatcher";

function textDelta(delta: string, itemId = "msg-1"): NormalizedThreadEvent {
  return {
    engine: "codex",
    workspaceId: "workspace-1",
    threadId: "thread-1",
    eventId: `event-${itemId}-${delta}`,
    turnId: "turn-1",
    sourceMethod: "item/agentMessage/delta",
    timestampMs: 1,
    operation: "appendAgentMessageDelta",
    item: {
      id: itemId,
      kind: "message",
      role: "assistant",
      text: delta,
    },
    itemKind: "message",
    delta,
    rawUsage: null,
  };
}

function completedMessage(): NormalizedThreadEvent {
  return {
    ...textDelta("hello"),
    sourceMethod: "item/completed",
    operation: "completeAgentMessage",
    delta: null,
    item: {
      id: "msg-1",
      kind: "message",
      role: "assistant",
      text: "hello world",
      isFinal: true,
    },
  };
}

describe("realtimeEventBatcher", () => {
  it("flushes first visible assistant delta immediately", () => {
    const batcher = createRealtimeEventBatcher();

    expect(batcher.push(textDelta("hello"))).toEqual([
      {
        reason: "first-token",
        events: [textDelta("hello")],
      },
    ]);
  });

  it("coalesces subsequent deltas without changing final content order", () => {
    const batcher = createRealtimeEventBatcher();
    batcher.push(textDelta("hello"));
    expect(batcher.push(textDelta(" "))).toEqual([]);
    expect(batcher.push(textDelta("world"))).toEqual([]);

    expect(batcher.flush()).toMatchObject({
      reason: "manual",
      events: [
        {
          operation: "appendAgentMessageDelta",
          delta: " world",
        },
      ],
    });
  });

  it("flushes pending deltas before terminal events", () => {
    const batcher = createRealtimeEventBatcher();
    batcher.push(textDelta("hello"));
    batcher.push(textDelta(" "));
    batcher.push(textDelta("world"));

    const flushes = batcher.push(completedMessage());

    expect(flushes.map((entry) => entry.reason)).toEqual(["terminal", "terminal"]);
    expect(flushes[0]?.events[0]?.delta).toBe(" world");
    expect(flushes[1]?.events[0]?.operation).toBe("completeAgentMessage");
  });

  it("keeps coalescing identity scoped to the normalized item key", () => {
    const batcher = createRealtimeEventBatcher();
    batcher.push(textDelta("a", "msg-1"));
    batcher.push(textDelta("b", "msg-1"));
    batcher.push(textDelta("c", "msg-1"));

    expect(batcher.flush()?.events.map((event) => [event.item.id, event.delta])).toEqual([
      ["msg-1", "bc"],
    ]);
  });
});
