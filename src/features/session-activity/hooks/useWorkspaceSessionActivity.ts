import { useMemo, useRef } from "react";
import type { ConversationItem, ThreadSummary } from "../../../types";
import { buildWorkspaceSessionActivity } from "../adapters/buildWorkspaceSessionActivity";

type ThreadStatusSnapshot = {
  isProcessing?: boolean;
};

type UseWorkspaceSessionActivityOptions = {
  activeThreadId: string | null;
  threads: ThreadSummary[];
  itemsByThread: Record<string, ConversationItem[]>;
  threadParentById: Record<string, string>;
  threadStatusById: Record<string, ThreadStatusSnapshot | undefined>;
};

export function useWorkspaceSessionActivity({
  activeThreadId,
  threads,
  itemsByThread,
  threadParentById,
  threadStatusById,
}: UseWorkspaceSessionActivityOptions) {
  const eventOccurredAtRef = useRef<Record<string, number>>({});
  const eventSequenceRef = useRef(0);

  return useMemo(
    () => {
      const nextViewModel = buildWorkspaceSessionActivity({
        activeThreadId,
        threads,
        itemsByThread,
        threadParentById,
        threadStatusById,
      });

      const previousOccurredAtByEventId = eventOccurredAtRef.current;
      const nextOccurredAtByEventId: Record<string, number> = {};
      const occupiedSeconds = new Set<number>();
      const nowBase = Date.now();
      let eventSequence = eventSequenceRef.current;

      // Reserve second buckets for still-visible historical events first,
      // so newly appeared events don't collapse into the same HH:mm:ss slot.
      for (const event of nextViewModel.timeline) {
        const previousOccurredAt = previousOccurredAtByEventId[event.eventId];
        if (typeof previousOccurredAt === "number" && Number.isFinite(previousOccurredAt) && previousOccurredAt > 0) {
          occupiedSeconds.add(Math.floor(previousOccurredAt / 1000));
        }
      }

      const reserveDistinctSecond = (timestamp: number) => {
        let nextTimestamp = timestamp;
        let secondBucket = Math.floor(nextTimestamp / 1000);
        while (occupiedSeconds.has(secondBucket)) {
          nextTimestamp += 1000;
          secondBucket = Math.floor(nextTimestamp / 1000);
        }
        occupiedSeconds.add(secondBucket);
        return nextTimestamp;
      };

      const timeline = nextViewModel.timeline
        .map((event) => {
          const previousOccurredAt = previousOccurredAtByEventId[event.eventId];
          if (typeof previousOccurredAt === "number" && previousOccurredAt > 0) {
            nextOccurredAtByEventId[event.eventId] = previousOccurredAt;
            if (previousOccurredAt === event.occurredAt) {
              return event;
            }
            return {
              ...event,
              occurredAt: previousOccurredAt,
            };
          }

          const fromAdapter =
            typeof event.occurredAt === "number" && Number.isFinite(event.occurredAt)
              ? event.occurredAt
              : null;
          const fallbackTimestamp = nowBase - eventSequence * 1000;
          if (!fromAdapter) {
            eventSequence += 1;
          }
          const occurredAt = reserveDistinctSecond(fromAdapter ?? fallbackTimestamp);
          nextOccurredAtByEventId[event.eventId] = occurredAt;
          if (occurredAt === event.occurredAt) {
            return event;
          }
          return {
            ...event,
            occurredAt,
          };
        })
        .sort((left, right) => right.occurredAt - left.occurredAt);

      eventOccurredAtRef.current = nextOccurredAtByEventId;
      eventSequenceRef.current = eventSequence;

      return {
        ...nextViewModel,
        timeline,
      };
    },
    [activeThreadId, itemsByThread, threadParentById, threadStatusById, threads],
  );
}
