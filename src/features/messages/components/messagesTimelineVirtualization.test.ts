import { describe, expect, it } from "vitest";
import {
  estimateTimelineProjectionRowSize,
  shouldVirtualizeTimelineRows,
  TIMELINE_VIRTUALIZATION_MIN_ROWS,
} from "./messagesTimelineVirtualization";
import type { TimelineProjectionRow } from "./messagesTimelineProjection";

describe("messagesTimelineVirtualization", () => {
  it("enables virtualization only for long stable timelines", () => {
    expect(shouldVirtualizeTimelineRows({
      isThinking: false,
      rowCount: TIMELINE_VIRTUALIZATION_MIN_ROWS,
    })).toBe(true);
    expect(shouldVirtualizeTimelineRows({
      isThinking: false,
      rowCount: TIMELINE_VIRTUALIZATION_MIN_ROWS - 1,
    })).toBe(false);
  });

  it("keeps active streaming timelines out of virtualization", () => {
    expect(shouldVirtualizeTimelineRows({
      isThinking: true,
      rowCount: 1_000,
    })).toBe(false);
  });

  it("estimates grouped rows higher than a single item row", () => {
    const singleRow: TimelineProjectionRow = {
      kind: "entry",
      key: "item:message:1",
      entry: {
        kind: "item",
        item: { id: "message-1", kind: "message", role: "assistant", text: "hello" },
      },
      itemIds: ["message-1"],
      hasActiveUserInputAnchor: false,
    };
    const groupRow: TimelineProjectionRow = {
      kind: "entry",
      key: "readGroup:1:2:2",
      entry: {
        kind: "readGroup",
        items: [
          {
            id: "tool-1",
            kind: "tool",
            toolType: "Read",
            title: "Read",
            detail: "a.ts",
            status: "completed",
          },
          {
            id: "tool-2",
            kind: "tool",
            toolType: "Read",
            title: "Read",
            detail: "b.ts",
            status: "completed",
          },
        ],
      },
      itemIds: ["tool-1", "tool-2"],
      hasActiveUserInputAnchor: false,
    };

    expect(estimateTimelineProjectionRowSize(groupRow)).toBeGreaterThan(
      estimateTimelineProjectionRowSize(singleRow),
    );
  });
});
