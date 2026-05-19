import { useCallback, useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import type { ConversationItem, DebugEntry, ThreadSummary } from "../../../types";
import { hasPendingOptimisticUserBubble } from "../utils/queuedHandoffBubble";
import type { ThreadState } from "./useThreadsReducer";

const CODEX_REALTIME_HISTORY_RECONCILE_DELAY_MS = 1_200;
const CODEX_REALTIME_HISTORY_RECONCILE_RETRY_DELAY_MS = 2_800;
const CLAUDE_REALTIME_HISTORY_RECONCILE_DELAY_MS = 1_200;
const CLAUDE_REALTIME_HISTORY_RECONCILE_RETRY_DELAY_MS = 2_800;

type TurnCompletedPayload = {
  workspaceId: string;
  threadId: string;
  turnId: string;
};

type UseThreadRealtimeHistoryReconcileOptions = {
  itemsByThreadRef: MutableRefObject<Record<string, ConversationItem[]>>;
  onDebug?: (entry: DebugEntry) => void;
  refreshThread: (workspaceId: string, threadId: string) => Promise<unknown>;
  resolveCanonicalThreadId: (threadId: string) => string;
  threadStatusByIdRef: MutableRefObject<ThreadState["threadStatusById"]>;
  threadsByWorkspace: ThreadState["threadsByWorkspace"];
};

export function useThreadRealtimeHistoryReconcile({
  itemsByThreadRef,
  onDebug,
  refreshThread,
  resolveCanonicalThreadId,
  threadStatusByIdRef,
  threadsByWorkspace,
}: UseThreadRealtimeHistoryReconcileOptions) {
  const codexRealtimeReconciledTurnByThreadRef = useRef<Record<string, string>>(
    {},
  );
  const codexRealtimeReconcileTimerByThreadRef = useRef<
    Record<string, ReturnType<typeof setTimeout> | null>
  >({});
  const claudeRealtimeReconciledTurnByThreadRef = useRef<Record<string, string>>(
    {},
  );
  const claudeRealtimeReconcileTimerByThreadRef = useRef<
    Record<string, ReturnType<typeof setTimeout> | null>
  >({});

  useEffect(() => {
    return () => {
      Object.values(codexRealtimeReconcileTimerByThreadRef.current).forEach(
        (timer) => {
          if (timer) {
            clearTimeout(timer);
          }
        },
      );
      Object.values(claudeRealtimeReconcileTimerByThreadRef.current).forEach(
        (timer) => {
          if (timer) {
            clearTimeout(timer);
          }
        },
      );
      codexRealtimeReconcileTimerByThreadRef.current = {};
      codexRealtimeReconciledTurnByThreadRef.current = {};
      claudeRealtimeReconcileTimerByThreadRef.current = {};
      claudeRealtimeReconciledTurnByThreadRef.current = {};
    };
  }, []);

  const shouldReconcileCodexRealtimeThread = useCallback(
    (workspaceId: string, threadId: string) => {
      const canonicalThreadId = resolveCanonicalThreadId(threadId);
      if (
        canonicalThreadId.startsWith("claude:") ||
        canonicalThreadId.startsWith("claude-pending-") ||
        canonicalThreadId.startsWith("gemini:") ||
        canonicalThreadId.startsWith("gemini-pending-") ||
        canonicalThreadId.startsWith("opencode:") ||
        canonicalThreadId.startsWith("opencode-pending-") ||
        canonicalThreadId.startsWith("shared:")
      ) {
        return false;
      }
      const thread = (threadsByWorkspace[workspaceId] ?? []).find(
        (entry: ThreadSummary) => entry.id === canonicalThreadId,
      );
      if (thread?.threadKind === "shared") {
        return false;
      }
      return !thread?.engineSource || thread.engineSource === "codex";
    },
    [resolveCanonicalThreadId, threadsByWorkspace],
  );

  const scheduleCodexRealtimeHistoryReconcile = useCallback(
    (workspaceId: string, threadId: string, turnId: string, attempt = 0) => {
      const canonicalThreadId = resolveCanonicalThreadId(threadId);
      if (!shouldReconcileCodexRealtimeThread(workspaceId, canonicalThreadId)) {
        return;
      }
      const reconciliationThreadKey = `${workspaceId}:${canonicalThreadId}`;
      const reconciliationTurnId = turnId.trim() || "__unknown_turn__";
      if (
        attempt === 0 &&
        codexRealtimeReconciledTurnByThreadRef.current[
          reconciliationThreadKey
        ] === reconciliationTurnId
      ) {
        return;
      }
      codexRealtimeReconciledTurnByThreadRef.current[reconciliationThreadKey] =
        reconciliationTurnId;
      const previousTimer =
        codexRealtimeReconcileTimerByThreadRef.current[reconciliationThreadKey];
      if (previousTimer) {
        clearTimeout(previousTimer);
      }
      const delay =
        attempt > 0
          ? CODEX_REALTIME_HISTORY_RECONCILE_RETRY_DELAY_MS
          : CODEX_REALTIME_HISTORY_RECONCILE_DELAY_MS;
      codexRealtimeReconcileTimerByThreadRef.current[reconciliationThreadKey] =
        setTimeout(() => {
          delete codexRealtimeReconcileTimerByThreadRef.current[
            reconciliationThreadKey
          ];
          const status = threadStatusByIdRef.current[canonicalThreadId];
          if (status?.isProcessing && attempt === 0) {
            scheduleCodexRealtimeHistoryReconcile(
              workspaceId,
              canonicalThreadId,
              reconciliationTurnId,
              attempt + 1,
            );
            return;
          }
          if (
            attempt === 0 &&
            hasPendingOptimisticUserBubble(
              itemsByThreadRef.current[canonicalThreadId] ?? [],
            )
          ) {
            scheduleCodexRealtimeHistoryReconcile(
              workspaceId,
              canonicalThreadId,
              reconciliationTurnId,
              attempt + 1,
            );
            return;
          }
          onDebug?.({
            id: `${Date.now()}-codex-realtime-history-reconcile`,
            timestamp: Date.now(),
            source: "client",
            label: "codex/realtime history reconcile",
            payload: {
              workspaceId,
              threadId: canonicalThreadId,
              turnId: reconciliationTurnId,
              attempt,
            },
          });
          void refreshThread(workspaceId, canonicalThreadId).catch((error) => {
            onDebug?.({
              id: `${Date.now()}-codex-realtime-history-reconcile-error`,
              timestamp: Date.now(),
              source: "error",
              label: "codex/realtime history reconcile error",
              payload: {
                workspaceId,
                threadId: canonicalThreadId,
                turnId: reconciliationTurnId,
                attempt,
                error: error instanceof Error ? error.message : String(error),
              },
            });
          });
        }, delay);
    },
    [
      itemsByThreadRef,
      onDebug,
      refreshThread,
      resolveCanonicalThreadId,
      shouldReconcileCodexRealtimeThread,
      threadStatusByIdRef,
    ],
  );

  const shouldReconcileClaudeRealtimeThread = useCallback(
    (threadId: string) => {
      const canonicalThreadId = resolveCanonicalThreadId(threadId);
      return canonicalThreadId.startsWith("claude:");
    },
    [resolveCanonicalThreadId],
  );

  const scheduleClaudeRealtimeHistoryReconcile = useCallback(
    (workspaceId: string, threadId: string, turnId: string, attempt = 0) => {
      const canonicalThreadId = resolveCanonicalThreadId(threadId);
      if (!shouldReconcileClaudeRealtimeThread(canonicalThreadId)) {
        return;
      }
      const reconciliationThreadKey = `${workspaceId}:${canonicalThreadId}`;
      const reconciliationTurnId = turnId.trim() || "__unknown_turn__";
      if (
        attempt === 0 &&
        claudeRealtimeReconciledTurnByThreadRef.current[
          reconciliationThreadKey
        ] === reconciliationTurnId
      ) {
        return;
      }
      claudeRealtimeReconciledTurnByThreadRef.current[reconciliationThreadKey] =
        reconciliationTurnId;
      const previousTimer =
        claudeRealtimeReconcileTimerByThreadRef.current[
          reconciliationThreadKey
        ];
      if (previousTimer) {
        clearTimeout(previousTimer);
      }
      const delay =
        attempt > 0
          ? CLAUDE_REALTIME_HISTORY_RECONCILE_RETRY_DELAY_MS
          : CLAUDE_REALTIME_HISTORY_RECONCILE_DELAY_MS;
      claudeRealtimeReconcileTimerByThreadRef.current[reconciliationThreadKey] =
        setTimeout(() => {
          delete claudeRealtimeReconcileTimerByThreadRef.current[
            reconciliationThreadKey
          ];
          const status = threadStatusByIdRef.current[canonicalThreadId];
          if (status?.isProcessing && attempt === 0) {
            scheduleClaudeRealtimeHistoryReconcile(
              workspaceId,
              canonicalThreadId,
              reconciliationTurnId,
              attempt + 1,
            );
            return;
          }
          onDebug?.({
            id: `${Date.now()}-claude-realtime-history-reconcile`,
            timestamp: Date.now(),
            source: "client",
            label: "claude/realtime history reconcile",
            payload: {
              workspaceId,
              threadId: canonicalThreadId,
              turnId: reconciliationTurnId,
              attempt,
            },
          });
          void refreshThread(workspaceId, canonicalThreadId).catch((error) => {
            onDebug?.({
              id: `${Date.now()}-claude-realtime-history-reconcile-error`,
              timestamp: Date.now(),
              source: "error",
              label: "claude/realtime history reconcile error",
              payload: {
                workspaceId,
                threadId: canonicalThreadId,
                turnId: reconciliationTurnId,
                attempt,
                error: error instanceof Error ? error.message : String(error),
              },
            });
          });
        }, delay);
    },
    [
      onDebug,
      refreshThread,
      resolveCanonicalThreadId,
      shouldReconcileClaudeRealtimeThread,
      threadStatusByIdRef,
    ],
  );

  const handleTurnCompletedForHistoryReconcile = useCallback(
    (payload: TurnCompletedPayload) => {
      if (payload.threadId.startsWith("claude:")) {
        scheduleClaudeRealtimeHistoryReconcile(
          payload.workspaceId,
          payload.threadId,
          payload.turnId,
        );
        return;
      }
      scheduleCodexRealtimeHistoryReconcile(
        payload.workspaceId,
        payload.threadId,
        payload.turnId,
      );
    },
    [
      scheduleClaudeRealtimeHistoryReconcile,
      scheduleCodexRealtimeHistoryReconcile,
    ],
  );

  return {
    handleTurnCompletedForHistoryReconcile,
  };
}
