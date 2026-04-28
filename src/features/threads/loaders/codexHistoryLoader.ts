import { buildItemsFromThread, mergeThreadItems } from "../../../utils/threadItems";
import type { ConversationItem } from "../../../types";
import type { HistoryLoader } from "../contracts/conversationCurtainContracts";
import { buildComparableConversationMessageSignature } from "../assembly/conversationNormalization";
import { normalizeHistorySnapshot } from "../contracts/conversationCurtainContracts";
import { parseCodexSessionHistory } from "./codexSessionHistory";
import { asRecord } from "./historyLoaderUtils";
import { extractLatestTurnPlan } from "./historyLoaderUtils";
import { extractUserInputQueueFromThread } from "./historyLoaderUtils";

type CodexHistoryLoaderOptions = {
  workspaceId: string;
  resumeThread: (
    workspaceId: string,
    threadId: string,
  ) => Promise<Record<string, unknown> | null>;
  loadCodexSession?: (workspaceId: string, threadId: string) => Promise<unknown>;
  preferLocalHistory?: boolean;
};

type MessageItem = Extract<ConversationItem, { kind: "message" }>;
type AssistantMessageItem = MessageItem & { role: "assistant" };

function appendUniqueItems(
  target: ConversationItem[],
  seenIds: Set<string>,
  items: ConversationItem[],
) {
  items.forEach((item) => {
    if (seenIds.has(item.id)) {
      return;
    }
    seenIds.add(item.id);
    target.push(item);
  });
}

type AssistantFinalMeta = {
  isFinal: boolean;
  finalCompletedAt?: number;
  finalDurationMs?: number;
};

type TurnFinalMeta = {
  turnIndex: number;
  userAnchor: string;
  meta: AssistantFinalMeta;
};

type RemoteTurnTarget = {
  turnIndex: number;
  userAnchor: string;
  assistantIndex: number;
};

function normalizeTurnAnchorText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function collectComparableMessageSequence(items: ConversationItem[]) {
  return items
    .filter(
      (item): item is Extract<ConversationItem, { kind: "message" }> =>
        item.kind === "message",
    )
    .map(buildComparableConversationMessageSignature);
}

function isComparableMessageSequencePrefix(prefix: string[], target: string[]) {
  if (prefix.length === 0 || prefix.length > target.length) {
    return false;
  }
  return prefix.every((value, index) => value === target[index]);
}

function areComparableMessageSequencesEqual(
  leftItems: ConversationItem[],
  rightItems: ConversationItem[],
) {
  const left = collectComparableMessageSequence(leftItems);
  const right = collectComparableMessageSequence(rightItems);
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

function shouldPreferFallbackMessageHistory(
  historyItems: ConversationItem[],
  fallbackItems: ConversationItem[],
) {
  const historyMessages = collectComparableMessageSequence(historyItems);
  const fallbackMessages = collectComparableMessageSequence(fallbackItems);
  const fallbackHasAssistantMessage = fallbackItems.some(
    (item) => item.kind === "message" && item.role === "assistant",
  );
  if (fallbackMessages.length === 0) {
    return false;
  }
  if (historyMessages.length === 0) {
    return true;
  }
  if (!fallbackHasAssistantMessage) {
    return false;
  }
  return (
    isComparableMessageSequencePrefix(fallbackMessages, historyMessages) ||
    isComparableMessageSequencePrefix(historyMessages, fallbackMessages)
  );
}

function isAssistantMessage(item: ConversationItem): item is AssistantMessageItem {
  return item.kind === "message" && item.role === "assistant";
}

function hasAssistantFinalMeta(
  item: ConversationItem,
): item is AssistantMessageItem {
  return isAssistantMessage(item) && (
    Boolean(item.isFinal) ||
    (typeof item.finalCompletedAt === "number" && item.finalCompletedAt > 0) ||
    (typeof item.finalDurationMs === "number" && item.finalDurationMs >= 0)
  );
}

function mergeAssistantFinalMeta(
  message: AssistantMessageItem,
  meta: AssistantFinalMeta,
): AssistantMessageItem {
  const completedAtCandidates = [
    message.finalCompletedAt,
    meta.finalCompletedAt,
  ].filter((value): value is number => typeof value === "number" && value > 0);
  const finalCompletedAt =
    completedAtCandidates.length > 0 ? Math.max(...completedAtCandidates) : undefined;
  const durationCandidates = [
    message.finalDurationMs,
    meta.finalDurationMs,
  ].filter((value): value is number => typeof value === "number" && value >= 0);
  const finalDurationMs =
    durationCandidates.length > 0 ? Math.max(...durationCandidates) : undefined;

  return {
    ...message,
    isFinal: Boolean(message.isFinal || meta.isFinal),
    ...(typeof finalCompletedAt === "number" ? { finalCompletedAt } : {}),
    ...(typeof finalDurationMs === "number" ? { finalDurationMs } : {}),
  };
}

function collectFallbackTurnMeta(fallbackItems: ConversationItem[]) {
  const byTurn = new Map<number, TurnFinalMeta>();
  let turnIndex = -1;
  let currentUserAnchor = "";

  fallbackItems.forEach((item) => {
    if (item.kind === "message" && item.role === "user") {
      turnIndex += 1;
      currentUserAnchor = normalizeTurnAnchorText(item.text);
      return;
    }
    if (turnIndex < 0 || !hasAssistantFinalMeta(item)) {
      return;
    }
    const existing = byTurn.get(turnIndex);
    const merged: AssistantFinalMeta = {
      isFinal: Boolean(existing?.meta.isFinal || item.isFinal),
      finalCompletedAt:
        Math.max(existing?.meta.finalCompletedAt ?? 0, item.finalCompletedAt ?? 0) || undefined,
      finalDurationMs:
        Math.max(existing?.meta.finalDurationMs ?? -1, item.finalDurationMs ?? -1) >= 0
          ? Math.max(existing?.meta.finalDurationMs ?? -1, item.finalDurationMs ?? -1)
          : undefined,
    };
    byTurn.set(turnIndex, {
      turnIndex,
      userAnchor: existing?.userAnchor || currentUserAnchor,
      meta: merged,
    });
  });

  return [...byTurn.values()].sort((left, right) => left.turnIndex - right.turnIndex);
}

function collectRemoteTurnTargets(historyItems: ConversationItem[]) {
  const turnTargets = new Map<number, RemoteTurnTarget>();
  let turnIndex = -1;
  let currentUserAnchor = "";

  historyItems.forEach((item, index) => {
    if (item.kind === "message" && item.role === "user") {
      turnIndex += 1;
      currentUserAnchor = normalizeTurnAnchorText(item.text);
      return;
    }
    if (turnIndex < 0 || !isAssistantMessage(item)) {
      return;
    }
    turnTargets.set(turnIndex, {
      turnIndex,
      userAnchor: currentUserAnchor,
      assistantIndex: index,
    });
  });

  return [...turnTargets.values()].sort((left, right) => left.turnIndex - right.turnIndex);
}

function mapFallbackTurnsToRemoteTargets(
  fallbackTurnMeta: TurnFinalMeta[],
  remoteTurnTargets: RemoteTurnTarget[],
) {
  const mapping = new Map<number, number>();
  const usedRemoteTurns = new Set<number>();

  const remoteByAnchor = new Map<string, number[]>();
  remoteTurnTargets.forEach((target) => {
    if (!target.userAnchor) {
      return;
    }
    const queue = remoteByAnchor.get(target.userAnchor) ?? [];
    queue.push(target.turnIndex);
    remoteByAnchor.set(target.userAnchor, queue);
  });

  fallbackTurnMeta.forEach((fallback) => {
    if (!fallback.userAnchor) {
      return;
    }
    const queue = remoteByAnchor.get(fallback.userAnchor);
    const remoteTurn = queue?.shift();
    if (typeof remoteTurn !== "number") {
      return;
    }
    mapping.set(fallback.turnIndex, remoteTurn);
    usedRemoteTurns.add(remoteTurn);
  });

  if (fallbackTurnMeta.length === remoteTurnTargets.length) {
    fallbackTurnMeta.forEach((fallback) => {
      if (mapping.has(fallback.turnIndex)) {
        return;
      }
      const remoteByIndex = remoteTurnTargets.find(
        (target) => target.turnIndex === fallback.turnIndex && !usedRemoteTurns.has(target.turnIndex),
      );
      if (!remoteByIndex) {
        return;
      }
      mapping.set(fallback.turnIndex, remoteByIndex.turnIndex);
      usedRemoteTurns.add(remoteByIndex.turnIndex);
    });
  }

  return mapping;
}

function hydrateCodexRemoteFinalMetadataFromFallback(
  historyItems: ConversationItem[],
  fallbackItems: ConversationItem[],
) {
  if (historyItems.length === 0 || fallbackItems.length === 0) {
    return historyItems;
  }

  const fallbackTurnMeta = collectFallbackTurnMeta(fallbackItems);
  if (fallbackTurnMeta.length === 0) {
    return historyItems;
  }

  const remoteTurnTargets = collectRemoteTurnTargets(historyItems);
  if (remoteTurnTargets.length === 0) {
    return historyItems;
  }

  const fallbackToRemoteTurnMap = mapFallbackTurnsToRemoteTargets(
    fallbackTurnMeta,
    remoteTurnTargets,
  );
  if (fallbackToRemoteTurnMap.size === 0) {
    return historyItems;
  }

  const remoteAssistantIndexByTurn = new Map(
    remoteTurnTargets.map((target) => [target.turnIndex, target.assistantIndex]),
  );
  const hydrated = [...historyItems];
  fallbackTurnMeta.forEach((fallback) => {
    const remoteTurnIndex = fallbackToRemoteTurnMap.get(fallback.turnIndex);
    if (typeof remoteTurnIndex !== "number") {
      return;
    }
    const assistantIndex = remoteAssistantIndexByTurn.get(remoteTurnIndex);
    if (typeof assistantIndex !== "number") {
      return;
    }
    const candidate = hydrated[assistantIndex];
    if (!isAssistantMessage(candidate)) {
      return;
    }
    hydrated[assistantIndex] = mergeAssistantFinalMeta(candidate, fallback.meta);
  });

  return hydrated;
}

function mergeCodexHistoryPreservingTurns(
  historyItems: ConversationItem[],
  fallbackItems: ConversationItem[],
) {
  const hydratedHistoryItems = hydrateCodexRemoteFinalMetadataFromFallback(
    historyItems,
    fallbackItems,
  );

  if (!hydratedHistoryItems.length) {
    return fallbackItems;
  }

  const remoteMessageCount = hydratedHistoryItems.filter(
    (item) => item.kind === "message",
  ).length;
  const fallbackUserTurns: ConversationItem[][] = [];
  const leadingStructuredItems: ConversationItem[] = [];
  let currentTurnBucket: ConversationItem[] | null = null;

  fallbackItems.forEach((item) => {
    if (item.kind === "message" && item.role === "user") {
      currentTurnBucket = [];
      fallbackUserTurns.push(currentTurnBucket);
      return;
    }
    if (item.kind === "message") {
      return;
    }
    if (currentTurnBucket) {
      currentTurnBucket.push(item);
      return;
    }
    leadingStructuredItems.push(item);
  });

  if (fallbackUserTurns.length === 0 || remoteMessageCount === 0) {
    return mergeThreadItems(
      hydratedHistoryItems,
      fallbackItems.filter((item) => item.kind !== "message"),
    );
  }

  const merged: ConversationItem[] = [];
  const seenIds = new Set<string>();
  let turnIndex = 0;

  appendUniqueItems(merged, seenIds, leadingStructuredItems);

  hydratedHistoryItems.forEach((item) => {
    appendUniqueItems(merged, seenIds, [item]);
    if (item.kind === "message" && item.role === "user") {
      const bucket = fallbackUserTurns[turnIndex] ?? [];
      appendUniqueItems(merged, seenIds, bucket);
      turnIndex += 1;
    }
  });

  for (; turnIndex < fallbackUserTurns.length; turnIndex += 1) {
    appendUniqueItems(merged, seenIds, fallbackUserTurns[turnIndex] ?? []);
  }

  return mergeThreadItems(
    merged,
    fallbackItems.filter((item) => item.kind !== "message"),
  );
}

export function createCodexHistoryLoader({
  workspaceId,
  resumeThread,
  loadCodexSession,
  preferLocalHistory = false,
}: CodexHistoryLoaderOptions): HistoryLoader {
  return {
    engine: "codex",
    async load(threadId: string) {
      let fallbackItems: ConversationItem[] = [];
      let fallbackHistoryLoaded = false;
      const loadFallbackHistoryItems = async () => {
        if (!loadCodexSession) {
          return [];
        }
        fallbackHistoryLoaded = true;
        try {
          const fallbackHistory = await loadCodexSession(workspaceId, threadId);
          return parseCodexSessionHistory(fallbackHistory);
        } catch (error) {
          console.warn("Failed to load Codex local history fallback", {
            workspaceId,
            threadId,
            error,
          });
          return [];
        }
      };

      if (preferLocalHistory) {
        fallbackItems = await loadFallbackHistoryItems();
        if (fallbackItems.length > 0) {
          return normalizeHistorySnapshot({
            engine: "codex",
            workspaceId,
            threadId,
            items: fallbackItems,
            plan: undefined,
            userInputQueue: [],
            meta: {
              workspaceId,
              threadId,
              engine: "codex",
              activeTurnId: null,
              isThinking: false,
              heartbeatPulse: null,
              historyRestoredAtMs: Date.now(),
            },
          });
        }
      }

      const response = await resumeThread(workspaceId, threadId);
      const result = asRecord(response?.result ?? response);
      const thread = asRecord(result.thread ?? response?.thread);
      const hasThread = Object.keys(thread).length > 0;
      const historyItems = hasThread ? buildItemsFromThread(thread) : [];
      let items = historyItems;

      if (loadCodexSession) {
        if (!fallbackHistoryLoaded) {
          fallbackItems = await loadFallbackHistoryItems();
        }
        if (areComparableMessageSequencesEqual(historyItems, fallbackItems)) {
          items = mergeCodexHistoryPreservingTurns(historyItems, fallbackItems);
        } else if (shouldPreferFallbackMessageHistory(historyItems, fallbackItems)) {
          items = fallbackItems;
        } else {
          items = mergeCodexHistoryPreservingTurns(historyItems, fallbackItems);
        }
      }

      return normalizeHistorySnapshot({
        engine: "codex",
        workspaceId,
        threadId,
        items,
        plan: hasThread ? extractLatestTurnPlan(thread) : undefined,
        userInputQueue: hasThread
          ? extractUserInputQueueFromThread(thread, workspaceId, threadId)
          : [],
        meta: {
          workspaceId,
          threadId,
          engine: "codex",
          activeTurnId: null,
          isThinking: false,
          heartbeatPulse: null,
          historyRestoredAtMs: Date.now(),
        },
      });
    },
  };
}
