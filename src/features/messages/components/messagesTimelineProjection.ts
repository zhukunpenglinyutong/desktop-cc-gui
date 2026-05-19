import type { GroupedEntry } from "../utils/groupToolItems";
import { parseAgentTaskNotification } from "../utils/agentTaskNotification";

export type TimelineProjectionRow =
  | {
      kind: "entry";
      key: string;
      entry: GroupedEntry;
      itemIds: readonly string[];
      hasActiveUserInputAnchor: boolean;
    }
  | {
      kind: "dockedReasoning";
      key: string;
      itemId: string;
    }
  | {
      kind: "tailUserInput";
      key: string;
    }
  | {
      kind: "liveMiddleCollapsed";
      key: string;
      count: number;
    }
  | {
      kind: "workingIndicator";
      key: string;
    }
  | {
      kind: "emptyState";
      key: string;
      state: "historyLoading" | "hiddenReasoning" | "empty";
    }
  | {
      kind: "approval";
      key: string;
    }
  | {
      kind: "bottomAnchor";
      key: string;
    };

export function getGroupedEntryItemIds(entry: GroupedEntry): string[] {
  if (entry.kind === "item") {
    return [entry.item.id];
  }
  return entry.items.map((item) => item.id);
}

export function groupedEntryContainsItemId(entry: GroupedEntry, itemId: string): boolean {
  return getGroupedEntryItemIds(entry).includes(itemId);
}

export function getGroupedEntryProjectionKey(entry: GroupedEntry): string {
  if (entry.kind === "item") {
    const task = entry.item.kind === "message" ? parseAgentTaskNotification(entry.item.text) : null;
    return `${entry.kind}:${entry.item.kind}:${entry.item.id}:${task?.taskId ?? task?.toolUseId ?? ""}`;
  }
  const firstId = entry.items[0]?.id ?? "empty";
  const lastId = entry.items.at(-1)?.id ?? firstId;
  return `${entry.kind}:${firstId}:${lastId}:${entry.items.length}`;
}

export function buildTimelineProjectionRows(input: {
  activeUserInputAnchorItemId: string | null;
  approvalVisible: boolean;
  claudeDockedReasoningItemIds: readonly string[];
  collapsedMiddleStepCount: number;
  collapseLiveMiddleStepsEnabled: boolean;
  effectiveItemsCount: number;
  groupedEntries: readonly GroupedEntry[];
  hasVisibleUserInputRequest: boolean;
  hiddenClaudeReasoningOnly: boolean;
  isHistoryLoading: boolean;
  isThinking: boolean;
  shouldRenderUserInputAtTail: boolean;
}): TimelineProjectionRow[] {
  const rows: TimelineProjectionRow[] = input.groupedEntries.map((entry) => ({
    kind: "entry",
    key: getGroupedEntryProjectionKey(entry),
    entry,
    itemIds: getGroupedEntryItemIds(entry),
    hasActiveUserInputAnchor: Boolean(
      input.activeUserInputAnchorItemId &&
        groupedEntryContainsItemId(entry, input.activeUserInputAnchorItemId),
    ),
  }));

  for (const itemId of input.claudeDockedReasoningItemIds) {
    rows.push({
      kind: "dockedReasoning",
      key: `claude-live:${itemId}`,
      itemId,
    });
  }

  if (input.shouldRenderUserInputAtTail) {
    rows.push({ kind: "tailUserInput", key: "user-input-tail" });
  }

  if (
    input.isThinking &&
    input.collapseLiveMiddleStepsEnabled &&
    input.collapsedMiddleStepCount > 0
  ) {
    rows.push({
      kind: "liveMiddleCollapsed",
      key: "live-middle-collapsed",
      count: input.collapsedMiddleStepCount,
    });
  }

  rows.push({ kind: "workingIndicator", key: "working-indicator" });

  if (!input.effectiveItemsCount && !input.hasVisibleUserInputRequest) {
    rows.push({
      kind: "emptyState",
      key: "empty-state",
      state: input.isHistoryLoading
        ? "historyLoading"
        : input.hiddenClaudeReasoningOnly
          ? "hiddenReasoning"
          : "empty",
    });
  }

  if (input.approvalVisible) {
    rows.push({ kind: "approval", key: "approval" });
  }

  rows.push({ kind: "bottomAnchor", key: "bottom-anchor" });
  return rows;
}
