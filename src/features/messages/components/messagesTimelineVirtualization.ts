import type { TimelineProjectionRow } from "./messagesTimelineProjection";

export const TIMELINE_VIRTUALIZATION_MIN_ROWS = 200;

export function shouldVirtualizeTimelineRows(input: {
  isThinking: boolean;
  rowCount: number;
}) {
  return input.rowCount >= TIMELINE_VIRTUALIZATION_MIN_ROWS && !input.isThinking;
}

export function estimateTimelineProjectionRowSize(row: TimelineProjectionRow) {
  switch (row.kind) {
    case "entry":
      return row.entry.kind === "item" ? 112 : 168;
    case "dockedReasoning":
      return 96;
    case "tailUserInput":
      return 132;
    case "liveMiddleCollapsed":
      return 44;
    case "workingIndicator":
      return 52;
    case "emptyState":
      return 160;
    case "approval":
      return 132;
    case "bottomAnchor":
      return 1;
  }
}
