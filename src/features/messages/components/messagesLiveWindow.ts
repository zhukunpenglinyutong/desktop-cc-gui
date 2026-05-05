import type { ConversationItem } from "../../../types";
import type { GroupedEntry } from "../utils/groupToolItems";
import { parseAgentTaskNotification } from "../utils/agentTaskNotification";
import type { MessageConversationItem } from "./messageItemPredicates";
import { resolveUserMessagePresentation } from "./messagesUserPresentation";
import { normalizeHistoryStickyHeaderText } from "./messagesRenderUtils";

export function resolveOrdinaryUserStickyText(
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
    resolveOrdinaryUserStickyText(item, enableCollaborationBadge).length > 0
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

export function buildHistoryStickyCandidates(
  items: ConversationItem[],
  enableCollaborationBadge: boolean,
) {
  const candidates: Array<{ id: string; text: string }> = [];
  for (const item of items) {
    if (!isOrdinaryUserQuestionItem(item, enableCollaborationBadge)) {
      continue;
    }
    const text = normalizeHistoryStickyHeaderText(
      resolveOrdinaryUserStickyText(item, enableCollaborationBadge),
    );
    if (!text) {
      continue;
    }
    candidates.push({
      id: item.id,
      text,
    });
  }
  return candidates;
}

export function resolveActiveStickyHeaderCandidate(
  candidates: Array<{ id: string; text: string }>,
  activeStickyMessageId: string | null,
  liveItems: ConversationItem[],
  enableCollaborationBadge: boolean,
) {
  if (!activeStickyMessageId) {
    return null;
  }
  const stableCandidate = candidates.find((candidate) => candidate.id === activeStickyMessageId);
  if (!stableCandidate) {
    return null;
  }
  const liveItem = liveItems.find((item) => item.id === activeStickyMessageId);
  if (!isOrdinaryUserQuestionItem(liveItem, enableCollaborationBadge)) {
    return stableCandidate;
  }
  const liveText = normalizeHistoryStickyHeaderText(
    resolveOrdinaryUserStickyText(liveItem, enableCollaborationBadge),
  );
  if (!liveText || liveText === stableCandidate.text) {
    return stableCandidate;
  }
  return {
    id: stableCandidate.id,
    text: liveText,
  };
}

function findLatestOrdinaryUserQuestionIndex(
  items: ConversationItem[],
  options?: { enableCollaborationBadge?: boolean },
) {
  const enableCollaborationBadge = options?.enableCollaborationBadge ?? false;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (isOrdinaryUserQuestionItem(item, enableCollaborationBadge)) {
      return index;
    }
  }
  return -1;
}

export function suppressCompletedExploreItemsBetweenLatestUserTurns(
  items: ConversationItem[],
  options?: { enableCollaborationBadge?: boolean },
) {
  const latestUserIndex = findLatestOrdinaryUserQuestionIndex(items, options);
  if (latestUserIndex <= 0) {
    return items;
  }
  const previousUserIndex = findLatestOrdinaryUserQuestionIndex(
    items.slice(0, latestUserIndex),
    options,
  );
  if (previousUserIndex < 0) {
    return items;
  }
  let changed = false;
  const filteredItems = items.filter((item, index) => {
    if (index <= previousUserIndex || index >= latestUserIndex) {
      return true;
    }
    const shouldSuppress =
      item.kind === "explore" && item.status === "explored";
    if (shouldSuppress) {
      changed = true;
      return false;
    }
    return true;
  });
  return changed ? filteredItems : items;
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

export function resolveStreamingPresentationItems(
  deferredItems: ConversationItem[],
  currentItems: ConversationItem[],
  shouldStabilize: boolean,
) {
  if (!shouldStabilize) {
    return currentItems;
  }
  if (deferredItems.length === 0) {
    return currentItems;
  }
  // Preserve the deferred history snapshot for parent-level timeline work, but
  // append truly new live ids so the active tail can still appear immediately.
  const deferredItemIds = new Set(deferredItems.map((item) => item.id));
  const appendedCurrentItems = currentItems.filter((item) => !deferredItemIds.has(item.id));
  return appendedCurrentItems.length > 0
    ? [...deferredItems, ...appendedCurrentItems]
    : deferredItems;
}

export function buildAssistantFinalBoundarySet(items: ConversationItem[]) {
  const ids = new Set<string>();
  let lastFinalAssistantIdInTurn: string | null = null;
  items.forEach((entry) => {
    if (entry.kind === "message" && entry.role === "user") {
      if (lastFinalAssistantIdInTurn) {
        ids.add(lastFinalAssistantIdInTurn);
      }
      lastFinalAssistantIdInTurn = null;
      return;
    }
    if (
      entry.kind === "message" &&
      entry.role === "assistant" &&
      entry.isFinal === true
    ) {
      lastFinalAssistantIdInTurn = entry.id;
    }
  });
  if (lastFinalAssistantIdInTurn) {
    ids.add(lastFinalAssistantIdInTurn);
  }
  return ids;
}

export function buildAssistantFinalWithVisibleProcessSet(
  items: ConversationItem[],
  assistantFinalBoundarySet: Set<string>,
) {
  const ids = new Set<string>();
  let hasVisibleProcessItemsInTurn = false;
  let lastFinalAssistantIdInTurn: string | null = null;
  let lastFinalAssistantHasProcessInTurn = false;
  const flushTurn = () => {
    if (
      lastFinalAssistantIdInTurn &&
      lastFinalAssistantHasProcessInTurn &&
      assistantFinalBoundarySet.has(lastFinalAssistantIdInTurn)
    ) {
      ids.add(lastFinalAssistantIdInTurn);
    }
    lastFinalAssistantIdInTurn = null;
    lastFinalAssistantHasProcessInTurn = false;
  };
  items.forEach((entry) => {
    if (entry.kind === "message" && entry.role === "user") {
      flushTurn();
      hasVisibleProcessItemsInTurn = false;
      return;
    }
    if (entry.kind === "reasoning" || entry.kind === "tool") {
      hasVisibleProcessItemsInTurn = true;
      return;
    }
    if (
      entry.kind === "message" &&
      entry.role === "assistant" &&
      entry.isFinal === true
    ) {
      lastFinalAssistantIdInTurn = entry.id;
      lastFinalAssistantHasProcessInTurn = hasVisibleProcessItemsInTurn;
    }
  });
  flushTurn();
  return ids;
}

export function buildLiveTailWorkingSet(
  items: ConversationItem[],
  options: {
    isThinking: boolean;
    showAllHistoryItems: boolean;
    visibleWindow: number;
    enableCollaborationBadge?: boolean;
  },
) {
  const { isThinking, showAllHistoryItems, visibleWindow } = options;
  if (!isThinking || showAllHistoryItems || visibleWindow <= 0) {
    return {
      items,
      omittedBeforeWorkingSetCount: 0,
      stickyUserMessageId: null,
    };
  }

  const maxWorkingSetItems = Math.max(visibleWindow, visibleWindow * 2);
  if (items.length <= maxWorkingSetItems) {
    return {
      items,
      omittedBeforeWorkingSetCount: 0,
      stickyUserMessageId: findLatestOrdinaryUserQuestionId(items, {
        enableCollaborationBadge: options.enableCollaborationBadge,
      }),
    };
  }

  const tailStartIndex = Math.max(0, items.length - maxWorkingSetItems);
  const tailItems = items.slice(tailStartIndex);
  const stickyUserMessageId = findLatestOrdinaryUserQuestionId(items, {
    enableCollaborationBadge: options.enableCollaborationBadge,
  });
  if (!stickyUserMessageId || tailItems.some((item) => item.id === stickyUserMessageId)) {
    return {
      items: tailItems,
      omittedBeforeWorkingSetCount: tailStartIndex,
      stickyUserMessageId,
    };
  }

  const stickyUserMessageIndex = items.findIndex((item) => item.id === stickyUserMessageId);
  const stickyUserMessage = items[stickyUserMessageIndex];
  if (!stickyUserMessage || stickyUserMessageIndex >= tailStartIndex) {
    return {
      items: tailItems,
      omittedBeforeWorkingSetCount: tailStartIndex,
      stickyUserMessageId,
    };
  }

  return {
    items: [stickyUserMessage, ...tailItems],
    omittedBeforeWorkingSetCount: Math.max(0, tailStartIndex - 1),
    stickyUserMessageId,
  };
}
