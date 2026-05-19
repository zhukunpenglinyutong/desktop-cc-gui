import type { NormalizedThreadEvent } from "./conversationCurtainContracts";

export type RealtimeBatcherFlushReason =
  | "first-token"
  | "terminal"
  | "manual";

export type RealtimeBatcherFlush = {
  reason: RealtimeBatcherFlushReason;
  events: readonly NormalizedThreadEvent[];
};

const COALESCIBLE_OPERATIONS = new Set<NormalizedThreadEvent["operation"]>([
  "appendAgentMessageDelta",
  "appendReasoningContentDelta",
  "appendReasoningSummaryDelta",
  "appendToolOutputDelta",
]);

const TERMINAL_OPERATIONS = new Set<NormalizedThreadEvent["operation"]>([
  "completeAgentMessage",
  "itemCompleted",
]);

function eventKey(event: NormalizedThreadEvent) {
  return `${event.workspaceId}:${event.threadId}:${event.turnId ?? ""}:${event.item.id}:${event.operation}`;
}

function isAssistantFirstTokenCandidate(event: NormalizedThreadEvent) {
  return event.operation === "appendAgentMessageDelta" && event.item.kind === "message";
}

function isCoalescible(event: NormalizedThreadEvent) {
  return COALESCIBLE_OPERATIONS.has(event.operation);
}

function isTerminal(event: NormalizedThreadEvent) {
  return TERMINAL_OPERATIONS.has(event.operation);
}

export function createRealtimeEventBatcher() {
  const pending = new Map<string, NormalizedThreadEvent>();
  const deliveredAssistantKeys = new Set<string>();

  function flushPending(reason: RealtimeBatcherFlushReason): RealtimeBatcherFlush | null {
    if (pending.size === 0) {
      return null;
    }
    const events = Array.from(pending.values());
    pending.clear();
    return {
      reason,
      events,
    };
  }

  return {
    push(event: NormalizedThreadEvent): RealtimeBatcherFlush[] {
      const output: RealtimeBatcherFlush[] = [];
      const key = eventKey(event);

      if (isTerminal(event)) {
        const terminalFlush = flushPending("terminal");
        if (terminalFlush) {
          output.push(terminalFlush);
        }
        output.push({
          reason: "terminal",
          events: [event],
        });
        return output;
      }

      if (!isCoalescible(event)) {
        output.push({
          reason: "manual",
          events: [event],
        });
        return output;
      }

      if (isAssistantFirstTokenCandidate(event) && !deliveredAssistantKeys.has(key)) {
        deliveredAssistantKeys.add(key);
        output.push({
          reason: "first-token",
          events: [event],
        });
        return output;
      }

      const previous = pending.get(key);
      if (!previous) {
        pending.set(key, event);
        return output;
      }

      pending.set(key, {
        ...event,
        delta: `${previous.delta ?? ""}${event.delta ?? ""}`,
      });
      return output;
    },
    flush(): RealtimeBatcherFlush | null {
      return flushPending("manual");
    },
  };
}
