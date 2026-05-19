import type { ConversationItem, EngineType, ThreadTokenUsage } from "../../../types";
import type { ThreadState } from "../hooks/threadReducerTypes";
import { domainEventFactories } from "./eventFactories";
import type { DomainEvent } from "./eventTypes";

export type DomainEventDerivationContext = {
  workspaceId: string;
  sessionId: string;
  engine: EngineType;
  occurredAt: string;
};

function getItems(state: ThreadState, threadId: string) {
  return state.itemsByThread[threadId] ?? [];
}

function getStatus(state: ThreadState, threadId: string) {
  return state.threadStatusById[threadId] ?? null;
}

function findItemByKind<T extends ConversationItem["kind"]>(
  items: readonly ConversationItem[],
  kind: T,
) {
  return items.find((item): item is Extract<ConversationItem, { kind: T }> => item.kind === kind);
}

function common(context: DomainEventDerivationContext) {
  return {
    workspaceId: context.workspaceId,
    sessionId: context.sessionId,
    engine: context.engine,
    occurredAt: context.occurredAt,
  };
}

export const domainEventDerivationFixtures = {
  "session.started"(prev: ThreadState, next: ThreadState, context: DomainEventDerivationContext): DomainEvent | null {
    const prevThreads = prev.threadsByWorkspace[context.workspaceId] ?? [];
    const nextThreads = next.threadsByWorkspace[context.workspaceId] ?? [];
    const created = nextThreads.find(
      (thread) => thread.id === context.sessionId && !prevThreads.some((entry) => entry.id === thread.id),
    );
    return created
      ? domainEventFactories.sessionStarted({
          ...common(context),
          threadId: created.id,
        })
      : null;
  },
  "session.ended"(prev: ThreadState, next: ThreadState, context: DomainEventDerivationContext): DomainEvent | null {
    const prevStatus = getStatus(prev, context.sessionId);
    const nextStatus = getStatus(next, context.sessionId);
    if (prevStatus?.isProcessing && nextStatus && !nextStatus.isProcessing) {
      return domainEventFactories.sessionEnded({
        ...common(context),
        threadId: context.sessionId,
        reason: "completed",
      });
    }
    return null;
  },
  "turn.started"(prev: ThreadState, next: ThreadState, context: DomainEventDerivationContext): DomainEvent | null {
    const prevTurnId = prev.activeTurnIdByThread[context.sessionId] ?? null;
    const nextTurnId = next.activeTurnIdByThread[context.sessionId] ?? null;
    return !prevTurnId && nextTurnId
      ? domainEventFactories.turnStarted({
          ...common(context),
          turnId: nextTurnId,
        })
      : null;
  },
  "turn.completed"(prev: ThreadState, next: ThreadState, context: DomainEventDerivationContext): DomainEvent | null {
    const prevTurnId = prev.activeTurnIdByThread[context.sessionId] ?? null;
    const nextTurnId = next.activeTurnIdByThread[context.sessionId] ?? null;
    if (prevTurnId && !nextTurnId) {
      return domainEventFactories.turnCompleted({
        ...common(context),
        turnId: prevTurnId,
        durationMs: next.threadStatusById[context.sessionId]?.lastDurationMs ?? null,
      });
    }
    return null;
  },
  "turn.failed"(prev: ThreadState, next: ThreadState, context: DomainEventDerivationContext): DomainEvent | null {
    const failedTool = findItemByKind(getItems(next, context.sessionId), "tool");
    const prevFailedTool = findItemByKind(getItems(prev, context.sessionId), "tool");
    if (failedTool?.status === "failed" && prevFailedTool?.status !== "failed") {
      return domainEventFactories.turnFailed({
        ...common(context),
        turnId: failedTool.turnId ?? context.sessionId,
        errorMessage: failedTool.output ?? failedTool.title,
      });
    }
    return null;
  },
  "message.delta.appended"(prev: ThreadState, next: ThreadState, context: DomainEventDerivationContext): DomainEvent | null {
    const prevMessage = findItemByKind(getItems(prev, context.sessionId), "message");
    const nextMessage = findItemByKind(getItems(next, context.sessionId), "message");
    if (prevMessage && nextMessage && nextMessage.text.startsWith(prevMessage.text)) {
      const delta = nextMessage.text.slice(prevMessage.text.length);
      if (delta) {
        return domainEventFactories.messageDeltaAppended({
          ...common(context),
          messageId: nextMessage.id,
          role: nextMessage.role,
          delta,
        });
      }
    }
    return null;
  },
  "message.completed"(prev: ThreadState, next: ThreadState, context: DomainEventDerivationContext): DomainEvent | null {
    const prevMessage = findItemByKind(getItems(prev, context.sessionId), "message");
    const nextMessage = findItemByKind(getItems(next, context.sessionId), "message");
    if (nextMessage?.isFinal && !prevMessage?.isFinal) {
      return domainEventFactories.messageCompleted({
        ...common(context),
        messageId: nextMessage.id,
        role: nextMessage.role,
        text: nextMessage.text,
      });
    }
    return null;
  },
  "tool.started"(prev: ThreadState, next: ThreadState, context: DomainEventDerivationContext): DomainEvent | null {
    const prevTool = findItemByKind(getItems(prev, context.sessionId), "tool");
    const nextTool = findItemByKind(getItems(next, context.sessionId), "tool");
    if (nextTool && !prevTool) {
      return domainEventFactories.toolStarted({
        ...common(context),
        toolCallId: nextTool.id,
        toolType: nextTool.toolType,
        title: nextTool.title,
      });
    }
    return null;
  },
  "tool.completed"(prev: ThreadState, next: ThreadState, context: DomainEventDerivationContext): DomainEvent | null {
    const prevTool = findItemByKind(getItems(prev, context.sessionId), "tool");
    const nextTool = findItemByKind(getItems(next, context.sessionId), "tool");
    if (nextTool && nextTool.status === "completed" && prevTool?.status !== "completed") {
      return domainEventFactories.toolCompleted({
        ...common(context),
        toolCallId: nextTool.id,
        toolType: nextTool.toolType,
        status: nextTool.status,
      });
    }
    return null;
  },
  "usage.updated"(prev: ThreadState, next: ThreadState, context: DomainEventDerivationContext): DomainEvent | null {
    const prevUsage = prev.tokenUsageByThread[context.sessionId];
    const nextUsage = next.tokenUsageByThread[context.sessionId];
    if (nextUsage && nextUsage !== prevUsage) {
      return domainEventFactories.usageUpdated({
        ...common(context),
        usage: nextUsage,
      });
    }
    return null;
  },
} as const;

export function deriveDomainEventFromStateDiff(
  type: keyof typeof domainEventDerivationFixtures,
  prev: ThreadState,
  next: ThreadState,
  context: DomainEventDerivationContext,
) {
  return domainEventDerivationFixtures[type](prev, next, context);
}

export function makeDomainEventUsageFixture(): ThreadTokenUsage {
  return {
    total: {
      totalTokens: 10,
      inputTokens: 6,
      cachedInputTokens: 1,
      outputTokens: 4,
      reasoningOutputTokens: 0,
    },
    last: {
      totalTokens: 10,
      inputTokens: 6,
      cachedInputTokens: 1,
      outputTokens: 4,
      reasoningOutputTokens: 0,
    },
    modelContextWindow: 200_000,
  };
}
