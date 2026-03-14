// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConversationItem, ThreadSummary } from "../../../types";
import { useWorkspaceSessionActivity } from "./useWorkspaceSessionActivity";

function toolItem(
  id: string,
  status: string = "started",
): Extract<ConversationItem, { kind: "tool" }> {
  return {
    id,
    kind: "tool",
    toolType: "commandExecution",
    title: "Command: echo hi",
    detail: '{"command":"echo hi"}',
    status,
  };
}

describe("useWorkspaceSessionActivity", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("assigns occurredAt when event first appears and keeps previous timestamps stable", () => {
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(1000);

    const threads: ThreadSummary[] = [{ id: "root", name: "Root", updatedAt: 1 }];
    const threadStatusById = { root: { isProcessing: true } };
    const threadParentById = {};

    const initialItemsByThread = {
      root: [toolItem("cmd-1", "started")],
    };

    const { result, rerender } = renderHook(
      (props: { itemsByThread: Record<string, ConversationItem[]> }) =>
        useWorkspaceSessionActivity({
          activeThreadId: "root",
          threads,
          itemsByThread: props.itemsByThread,
          threadParentById,
          threadStatusById,
        }),
      {
        initialProps: {
          itemsByThread: initialItemsByThread,
        },
      },
    );

    const firstEventId = result.current.timeline[0]?.eventId;
    const firstOccurredAt = result.current.timeline[0]?.occurredAt;
    expect(firstEventId).toBe("command:cmd-1");
    expect(firstOccurredAt).toBe(1000);

    nowSpy.mockReturnValue(2000);
    const nextItemsByThread = {
      root: [toolItem("cmd-1", "completed"), toolItem("cmd-2", "started")],
    };
    rerender({ itemsByThread: nextItemsByThread });

    const byEventId = new Map(
      result.current.timeline.map((event) => [event.eventId, event.occurredAt]),
    );

    const cmd1OccurredAt = byEventId.get("command:cmd-1");
    const cmd2OccurredAt = byEventId.get("command:cmd-2");
    expect(cmd1OccurredAt).toBe(1000);
    expect(cmd2OccurredAt).toBeGreaterThan(1000);
    expect(result.current.timeline[0]?.eventId).toBe("command:cmd-2");
  });

  it("preserves adapter timeline order when first hydrating a batch", () => {
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(5000);

    const threads: ThreadSummary[] = [{ id: "root", name: "Root", updatedAt: 1 }];

    const { result } = renderHook(() =>
      useWorkspaceSessionActivity({
        activeThreadId: "root",
        threads,
        itemsByThread: {
          root: [
            toolItem("cmd-1", "completed"),
            toolItem("cmd-2", "completed"),
            toolItem("cmd-3", "completed"),
          ],
        },
        threadParentById: {},
        threadStatusById: { root: { isProcessing: false } },
      }),
    );

    expect(result.current.timeline.map((event) => event.eventId)).toEqual([
      "command:cmd-3",
      "command:cmd-2",
      "command:cmd-1",
    ]);
  });

  it("keeps second-level timestamp separation on initial hydration", () => {
    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValue(1_700_000_010_000);

    const threads: ThreadSummary[] = [
      { id: "root", name: "Root", updatedAt: 1_700_000_000_000 },
    ];

    const { result } = renderHook(() =>
      useWorkspaceSessionActivity({
        activeThreadId: "root",
        threads,
        itemsByThread: {
          root: [
            toolItem("cmd-1", "completed"),
            toolItem("cmd-2", "completed"),
            toolItem("cmd-3", "completed"),
          ],
        },
        threadParentById: {},
        threadStatusById: { root: { isProcessing: false } },
      }),
    );

    const occurredAt = result.current.timeline.map((event) => event.occurredAt);
    expect(occurredAt[0]).toBeGreaterThan(0);
    expect(occurredAt[1]).toBeGreaterThan(0);
    expect(occurredAt[2]).toBeGreaterThan(0);
    expect(Math.abs((occurredAt[0] ?? 0) - (occurredAt[1] ?? 0))).toBeGreaterThanOrEqual(1000);
    expect(Math.abs((occurredAt[1] ?? 0) - (occurredAt[2] ?? 0))).toBeGreaterThanOrEqual(1000);
  });
});
