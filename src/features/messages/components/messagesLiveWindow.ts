import type { ConversationItem } from "../../../types";
import type { GroupedEntry } from "../utils/groupToolItems";
import { parseAgentTaskNotification } from "../utils/agentTaskNotification";
import type { MessageConversationItem } from "./messageItemPredicates";
import { resolveUserMessagePresentation } from "./messagesUserPresentation";

function resolveStickyCandidateUserText(
  item: MessageConversationItem,
  enableCollaborationBadge: boolean,
) {
  return resolveUserMessagePresentation({
    text: item.text,
    selectedAgentName: item.selectedAgentName,
    selectedAgentIcon: item.selectedAgentIcon,
    enableCollaborationBadge,
  }).stickyCandidateText.trim();
}

export function isOrdinaryUserQuestionItem(
  item: ConversationItem | undefined,
  enableCollaborationBadge: boolean,
): item is MessageConversationItem & { role: "user" } {
  if (item?.kind !== "message" || item.role !== "user") {
    return false;
  }
  return (
    !parseAgentTaskNotification(item.text) &&
    resolveStickyCandidateUserText(item, enableCollaborationBadge).length > 0
  );
}

export function resolveLiveAutoExpandedExploreId(
  entries: GroupedEntry[],
  isThinking: boolean,
) {
  if (!isThinking || entries.length === 0) {
    return null;
  }
  const latestEntry = entries[entries.length - 1];
  if (latestEntry?.kind !== "item" || latestEntry.item.kind !== "explore") {
    return null;
  }
  return latestEntry.item.status === "explored" ? latestEntry.item.id : null;
}

export function collapseExpandedExploreItems(
  expandedItemIds: Set<string>,
  items: ConversationItem[],
) {
  if (expandedItemIds.size === 0) {
    return expandedItemIds;
  }
  const nextExpandedItemIds = new Set(expandedItemIds);
  let changed = false;
  for (const item of items) {
    if (item.kind !== "explore") {
      continue;
    }
    if (nextExpandedItemIds.delete(item.id)) {
      changed = true;
    }
  }
  return changed ? nextExpandedItemIds : expandedItemIds;
}

export function findLatestOrdinaryUserQuestionId(
  items: ConversationItem[],
  options?: { enableCollaborationBadge?: boolean },
) {
  const enableCollaborationBadge = options?.enableCollaborationBadge ?? false;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (isOrdinaryUserQuestionItem(item, enableCollaborationBadge)) {
      return item.id;
    }
  }
  return null;
}

export function buildRenderedItemsWindow(
  timelineItems: ConversationItem[],
  collapsedHistoryItemCount: number,
  stickyUserMessageId: string | null,
) {
  const windowedItems =
    collapsedHistoryItemCount > 0
      ? timelineItems.slice(collapsedHistoryItemCount)
      : timelineItems;
  if (!stickyUserMessageId || collapsedHistoryItemCount === 0) {
    return {
      renderedItems: windowedItems,
      visibleCollapsedHistoryItemCount: collapsedHistoryItemCount,
    };
  }
  if (windowedItems.some((item) => item.id === stickyUserMessageId)) {
    return {
      renderedItems: windowedItems,
      visibleCollapsedHistoryItemCount: collapsedHistoryItemCount,
    };
  }
  const stickyUserMessage = timelineItems.find((item) => item.id === stickyUserMessageId);
  if (!stickyUserMessage) {
    return {
      renderedItems: windowedItems,
      visibleCollapsedHistoryItemCount: collapsedHistoryItemCount,
    };
  }
  return {
    renderedItems: [stickyUserMessage, ...windowedItems],
    visibleCollapsedHistoryItemCount: Math.max(0, collapsedHistoryItemCount - 1),
  };
}
