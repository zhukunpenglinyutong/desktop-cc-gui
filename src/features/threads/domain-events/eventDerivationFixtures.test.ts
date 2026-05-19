import { describe, expect, it } from "vitest";
import type { ThreadState } from "../hooks/threadReducerTypes";
import { initialState } from "../hooks/useThreadsReducer";
import {
  deriveDomainEventFromStateDiff,
  makeDomainEventUsageFixture,
  type DomainEventDerivationContext,
} from "./eventDerivationFixtures";
import { DOMAIN_EVENT_TYPES } from "./eventTypes";

const context: DomainEventDerivationContext = {
  workspaceId: "workspace-1",
  sessionId: "thread-1",
  engine: "codex",
  occurredAt: "2026-05-19T10:00:00.000Z",
};

function state(patch: Partial<ThreadState>): ThreadState {
  return {
    ...initialState,
    ...patch,
  };
}

describe("domain event derivation fixtures", () => {
  it("derives one fixture for every documented domain event type", () => {
    const cases: Record<(typeof DOMAIN_EVENT_TYPES)[number], [ThreadState, ThreadState]> = {
      "session.started": [
        state({ threadsByWorkspace: { "workspace-1": [] } }),
        state({
          threadsByWorkspace: {
            "workspace-1": [
              {
                id: "thread-1",
                name: "Thread 1",
                updatedAt: 1,
              },
            ],
          },
        }),
      ],
      "session.ended": [
        state({ threadStatusById: { "thread-1": { isProcessing: true, hasUnread: false, isReviewing: false, processingStartedAt: 1, lastDurationMs: null } } }),
        state({ threadStatusById: { "thread-1": { isProcessing: false, hasUnread: false, isReviewing: false, processingStartedAt: null, lastDurationMs: 10 } } }),
      ],
      "turn.started": [
        state({ activeTurnIdByThread: { "thread-1": null } }),
        state({ activeTurnIdByThread: { "thread-1": "turn-1" } }),
      ],
      "turn.completed": [
        state({ activeTurnIdByThread: { "thread-1": "turn-1" } }),
        state({
          activeTurnIdByThread: { "thread-1": null },
          threadStatusById: { "thread-1": { isProcessing: false, hasUnread: false, isReviewing: false, processingStartedAt: null, lastDurationMs: 20 } },
        }),
      ],
      "turn.failed": [
        state({ itemsByThread: { "thread-1": [{ id: "tool-1", kind: "tool", toolType: "shell", title: "Shell", detail: "", status: "running" }] } }),
        state({ itemsByThread: { "thread-1": [{ id: "tool-1", kind: "tool", toolType: "shell", title: "Shell", detail: "", status: "failed", output: "boom" }] } }),
      ],
      "message.delta.appended": [
        state({ itemsByThread: { "thread-1": [{ id: "msg-1", kind: "message", role: "assistant", text: "hello" }] } }),
        state({ itemsByThread: { "thread-1": [{ id: "msg-1", kind: "message", role: "assistant", text: "hello world" }] } }),
      ],
      "message.completed": [
        state({ itemsByThread: { "thread-1": [{ id: "msg-1", kind: "message", role: "assistant", text: "done" }] } }),
        state({ itemsByThread: { "thread-1": [{ id: "msg-1", kind: "message", role: "assistant", text: "done", isFinal: true }] } }),
      ],
      "tool.started": [
        state({ itemsByThread: { "thread-1": [] } }),
        state({ itemsByThread: { "thread-1": [{ id: "tool-1", kind: "tool", toolType: "shell", title: "Shell", detail: "", status: "running" }] } }),
      ],
      "tool.completed": [
        state({ itemsByThread: { "thread-1": [{ id: "tool-1", kind: "tool", toolType: "shell", title: "Shell", detail: "", status: "running" }] } }),
        state({ itemsByThread: { "thread-1": [{ id: "tool-1", kind: "tool", toolType: "shell", title: "Shell", detail: "", status: "completed" }] } }),
      ],
      "usage.updated": [
        state({ tokenUsageByThread: {} }),
        state({ tokenUsageByThread: { "thread-1": makeDomainEventUsageFixture() } }),
      ],
    };

    for (const eventType of DOMAIN_EVENT_TYPES) {
      const [prev, next] = cases[eventType];
      expect(deriveDomainEventFromStateDiff(eventType, prev, next, context)?.type).toBe(eventType);
    }
  });
});
