import { describe, expect, it } from "vitest";
import { groupToolItems } from "../utils/groupToolItems";
import { buildLongListFixture } from "../../../test-fixtures/perf/longListFixtureFactory";
import {
  buildTimelineProjectionRows,
  getGroupedEntryProjectionKey,
} from "./messagesTimelineProjection";

describe("messagesTimelineProjection", () => {
  it("preserves grouped entry identity and order for long lists", () => {
    const entries = groupToolItems(buildLongListFixture(1000));
    const rows = buildTimelineProjectionRows({
      activeUserInputAnchorItemId: null,
      approvalVisible: false,
      claudeDockedReasoningItemIds: [],
      collapsedMiddleStepCount: 0,
      collapseLiveMiddleStepsEnabled: false,
      effectiveItemsCount: 1000,
      groupedEntries: entries,
      hasVisibleUserInputRequest: false,
      hiddenClaudeReasoningOnly: false,
      isHistoryLoading: false,
      isThinking: false,
      shouldRenderUserInputAtTail: false,
    });

    expect(rows.filter((row) => row.kind === "entry").map((row) => row.key)).toEqual(
      entries.map(getGroupedEntryProjectionKey),
    );
    expect(rows.at(-1)?.kind).toBe("bottomAnchor");
  });

  it("marks active user input anchor without moving the owning entry", () => {
    const entries = groupToolItems(buildLongListFixture(9));
    const rows = buildTimelineProjectionRows({
      activeUserInputAnchorItemId: "message-6",
      approvalVisible: true,
      claudeDockedReasoningItemIds: ["reasoning-live"],
      collapsedMiddleStepCount: 2,
      collapseLiveMiddleStepsEnabled: true,
      effectiveItemsCount: 9,
      groupedEntries: entries,
      hasVisibleUserInputRequest: false,
      hiddenClaudeReasoningOnly: false,
      isHistoryLoading: false,
      isThinking: true,
      shouldRenderUserInputAtTail: false,
    });

    expect(
      rows.find((row) => row.kind === "entry" && row.hasActiveUserInputAnchor),
    ).toMatchObject({
      kind: "entry",
      itemIds: expect.arrayContaining(["message-6"]),
    });
    expect(rows.map((row) => row.kind)).toContain("dockedReasoning");
    expect(rows.map((row) => row.kind)).toContain("liveMiddleCollapsed");
    expect(rows.map((row) => row.kind)).toContain("approval");
  });
});
