import { useCallback, useMemo, useRef } from "react";
import type { Dispatch, MutableRefObject } from "react";

import type { DebugEntry } from "../../../types";
import {
  connectWorkspace as connectWorkspaceService,
  deleteClaudeSession as deleteClaudeSessionService,
  deleteCodexSession as deleteCodexSessionService,
  forkClaudeSession as forkClaudeSessionService,
  forkClaudeSessionFromMessage as forkClaudeSessionFromMessageService,
  forkThread as forkThreadService,
  loadClaudeSession as loadClaudeSessionService,
  rewindCodexThread as rewindCodexThreadService,
  startThread as startThreadService,
} from "../../../services/tauri";
import { parseClaudeHistoryMessages } from "../loaders/claudeHistoryLoader";
import {
  applyClaudeRewindWorkspaceRestore,
  findImpactedClaudeRewindItems,
  restoreClaudeRewindWorkspaceSnapshots,
} from "../utils/claudeRewindRestore";
import {
  findFirstHistoryUserMessageId,
  findLastUserMessageIndexById,
  findLatestHistoryUserMessageId,
  isUserConversationMessage,
  isWorkspaceNotConnectedError,
  normalizeComparableRewindText,
  resolveClaudeRewindMessageIdFromHistory,
  resolveRewindSupportedEngine,
} from "./useThreadActions.helpers";
import {
  createStartSharedSessionForWorkspace,
} from "./useThreadActions.sessionActions";
import type { ThreadAction, ThreadState } from "./useThreadsReducer";
import {
  normalizeRewindMode,
  shouldRestoreWorkspaceFiles,
  shouldRewindMessages,
  type RewindMode,
} from "../utils/rewindMode";

type OnDebug = (entry: DebugEntry) => void;

type ResumeThreadForWorkspace = (
  workspaceId: string,
  threadId: string,
  force?: boolean,
  replaceLocal?: boolean,
  options?: { preferLocalCodexHistory?: boolean },
) => Promise<string | null>;

type RewindFromMessageOptions = {
  activate?: boolean;
  mode?: RewindMode;
};

type UseThreadActionsSessionRuntimeOptions = {
  activeThreadIdByWorkspace: ThreadState["activeThreadIdByWorkspace"];
  dispatch: Dispatch<ThreadAction>;
  itemsByThread: ThreadState["itemsByThread"];
  loadedThreadsRef: MutableRefObject<Record<string, boolean>>;
  onDebug?: OnDebug;
  renameThreadTitleMapping: (
    workspaceId: string,
    oldThreadId: string,
    newThreadId: string,
  ) => Promise<void>;
  resumeThreadForWorkspace: ResumeThreadForWorkspace;
  threadsByWorkspace: ThreadState["threadsByWorkspace"];
  workspacePathsByIdRef: MutableRefObject<Record<string, string>>;
};

function extractThreadId(response: Record<string, unknown> | null | undefined) {
  if (!response || typeof response !== "object") {
    return "";
  }
  const responseRecord = response as Record<string, unknown>;
  const result =
    responseRecord.result && typeof responseRecord.result === "object"
      ? (responseRecord.result as Record<string, unknown>)
      : null;
  const resultThread =
    result?.thread && typeof result.thread === "object"
      ? (result.thread as Record<string, unknown>)
      : null;
  const rootThread =
    responseRecord.thread && typeof responseRecord.thread === "object"
      ? (responseRecord.thread as Record<string, unknown>)
      : null;

  const candidates = [
    resultThread?.id,
    result?.threadId,
    result?.thread_id,
    rootThread?.id,
    responseRecord.threadId,
    responseRecord.thread_id,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" || typeof candidate === "number") {
      const normalized = String(candidate).trim();
      if (normalized) {
        return normalized;
      }
    }
  }
  return "";
}

export function useThreadActionsSessionRuntime({
  activeThreadIdByWorkspace,
  dispatch,
  itemsByThread,
  loadedThreadsRef,
  onDebug,
  renameThreadTitleMapping,
  resumeThreadForWorkspace,
  threadsByWorkspace,
  workspacePathsByIdRef,
}: UseThreadActionsSessionRuntimeOptions) {
  const claudeRewindInFlightByThreadRef = useRef<Record<string, boolean>>({});

  const startThreadForWorkspace = useCallback(
    async (
      workspaceId: string,
      options?: {
        activate?: boolean;
        engine?: "claude" | "codex" | "gemini" | "opencode";
      },
    ) => {
      const shouldActivate = options?.activate !== false;
      const engine = options?.engine;
      const resolveStartedThread = (
        response: Record<string, unknown> | null | undefined,
      ) => {
        const threadId = extractThreadId(response);
        if (threadId) {
          dispatch({ type: "ensureThread", workspaceId, threadId, engine: "codex" });
          dispatch({
            type: "markCodexAcceptedTurn",
            threadId,
            fact: "empty-draft",
            source: "thread-start",
            timestamp: Date.now(),
          });
          if (shouldActivate) {
            dispatch({ type: "setActiveThreadId", workspaceId, threadId });
          }
          loadedThreadsRef.current[threadId] = true;
          return threadId;
        }
        return null;
      };

      if (engine === "claude" || engine === "gemini" || engine === "opencode") {
        const prefix = engine;
        const threadId = `${prefix}-pending-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`;
        onDebug?.({
          id: `${Date.now()}-client-thread-start`,
          timestamp: Date.now(),
          source: "client",
          label: `thread/start (${engine})`,
          payload: { workspaceId, threadId, engine },
        });
        dispatch({ type: "ensureThread", workspaceId, threadId, engine });
        if (shouldActivate) {
          dispatch({ type: "setActiveThreadId", workspaceId, threadId });
        }
        loadedThreadsRef.current[threadId] = true;
        return threadId;
      }

      onDebug?.({
        id: `${Date.now()}-client-thread-start`,
        timestamp: Date.now(),
        source: "client",
        label: "thread/start",
        payload: { workspaceId },
      });
      try {
        const response = await startThreadService(workspaceId);
        onDebug?.({
          id: `${Date.now()}-server-thread-start`,
          timestamp: Date.now(),
          source: "server",
          label: "thread/start response",
          payload: response,
        });
        return resolveStartedThread(response);
      } catch (error) {
        if (isWorkspaceNotConnectedError(error)) {
          onDebug?.({
            id: `${Date.now()}-client-workspace-reconnect-before-thread-start`,
            timestamp: Date.now(),
            source: "client",
            label: "workspace/reconnect before thread start",
            payload: { workspaceId },
          });
          try {
            await connectWorkspaceService(workspaceId);
            const retryResponse = await startThreadService(workspaceId);
            onDebug?.({
              id: `${Date.now()}-server-thread-start-retry`,
              timestamp: Date.now(),
              source: "server",
              label: "thread/start retry response",
              payload: retryResponse,
            });
            return resolveStartedThread(retryResponse);
          } catch (retryError) {
            onDebug?.({
              id: `${Date.now()}-client-thread-start-error`,
              timestamp: Date.now(),
              source: "error",
              label: "thread/start error",
              payload: retryError instanceof Error ? retryError.message : String(retryError),
            });
            throw retryError;
          }
        }
        onDebug?.({
          id: `${Date.now()}-client-thread-start-error`,
          timestamp: Date.now(),
          source: "error",
          label: "thread/start error",
          payload: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
    [dispatch, loadedThreadsRef, onDebug],
  );

  const startSharedSessionForWorkspace = useMemo(
    () => createStartSharedSessionForWorkspace({
      dispatch,
      extractThreadId,
      loadedThreadsRef,
      onDebug,
      threadsByWorkspace,
    }),
    [dispatch, loadedThreadsRef, onDebug, threadsByWorkspace],
  );

  const forkThreadForWorkspace = useCallback(
    async (
      workspaceId: string,
      threadId: string,
      options?: { activate?: boolean },
    ) => {
      if (!threadId) {
        return null;
      }
      const shouldActivate = options?.activate !== false;
      onDebug?.({
        id: `${Date.now()}-client-thread-fork`,
        timestamp: Date.now(),
        source: "client",
        label: "thread/fork",
        payload: { workspaceId, threadId },
      });
      try {
        let response: Record<string, unknown> | null | undefined;
        if (threadId.startsWith("claude:")) {
          const workspacePath = workspacePathsByIdRef.current[workspaceId];
          if (!workspacePath) {
            return null;
          }
          const sessionId = threadId.slice("claude:".length).trim();
          if (!sessionId) {
            return null;
          }
          response = await forkClaudeSessionService(workspacePath, sessionId);
        } else if (threadId.startsWith("claude-pending-")) {
          return null;
        } else if (
          threadId.startsWith("gemini:") ||
          threadId.startsWith("gemini-pending-")
        ) {
          return null;
        } else {
          response = await forkThreadService(workspaceId, threadId);
        }
        onDebug?.({
          id: `${Date.now()}-server-thread-fork`,
          timestamp: Date.now(),
          source: "server",
          label: "thread/fork response",
          payload: response,
        });
        const forkedThreadId = extractThreadId(response);
        if (!forkedThreadId) {
          return null;
        }
        const forkedEngine = forkedThreadId.startsWith("claude:")
          ? "claude"
          : forkedThreadId.startsWith("gemini:")
            ? "gemini"
            : "codex";
        dispatch({
          type: "ensureThread",
          workspaceId,
          threadId: forkedThreadId,
          engine: forkedEngine,
        });
        if (shouldActivate) {
          dispatch({
            type: "setActiveThreadId",
            workspaceId,
            threadId: forkedThreadId,
          });
        }
        loadedThreadsRef.current[forkedThreadId] = false;
        await resumeThreadForWorkspace(workspaceId, forkedThreadId, true, true);
        return forkedThreadId;
      } catch (error) {
        onDebug?.({
          id: `${Date.now()}-client-thread-fork-error`,
          timestamp: Date.now(),
          source: "error",
          label: "thread/fork error",
          payload: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    },
    [dispatch, loadedThreadsRef, onDebug, resumeThreadForWorkspace, workspacePathsByIdRef],
  );

  const forkClaudeSessionFromMessageForWorkspace = useCallback(
    async (
      workspaceId: string,
      threadId: string,
      messageId: string,
      options?: RewindFromMessageOptions,
    ) => {
      if (!threadId.startsWith("claude:")) {
        return null;
      }
      const normalizedMessageId = messageId.trim();
      if (!normalizedMessageId) {
        return null;
      }
      const workspacePath = workspacePathsByIdRef.current[workspaceId];
      if (!workspacePath) {
        return null;
      }
      const sessionId = threadId.slice("claude:".length).trim();
      if (!sessionId) {
        return null;
      }
      const shouldActivate = options?.activate !== false;
      const rewindMode = normalizeRewindMode(options?.mode);
      const shouldRestoreFiles = shouldRestoreWorkspaceFiles(rewindMode);
      const shouldRewindSession = shouldRewindMessages(rewindMode);
      const rewindLockKey = `${workspaceId}:${threadId}`;
      if (claudeRewindInFlightByThreadRef.current[rewindLockKey]) {
        return null;
      }
      claudeRewindInFlightByThreadRef.current[rewindLockKey] = true;
      onDebug?.({
        id: `${Date.now()}-client-thread-fork-from-message`,
        timestamp: Date.now(),
        source: "client",
        label: "thread/fork from message",
        payload: { workspaceId, threadId, messageId: normalizedMessageId },
      });
      let rewindRestoreState:
        | Awaited<ReturnType<typeof applyClaudeRewindWorkspaceRestore>>
        | null = null;
      try {
        const threadItems = itemsByThread[threadId] ?? [];
        const historyResponse = await loadClaudeSessionService(
          workspacePath,
          sessionId,
        );
        const historyRecord =
          historyResponse && typeof historyResponse === "object"
            ? (historyResponse as Record<string, unknown>)
            : {};
        const historyItems = parseClaudeHistoryMessages(historyRecord.messages);
        const firstHistoryMessageId = findFirstHistoryUserMessageId(historyItems);
        const latestHistoryMessageId = findLatestHistoryUserMessageId(historyItems);
        if (!latestHistoryMessageId) {
          return null;
        }
        const requestedHistoryMessageId = resolveClaudeRewindMessageIdFromHistory({
          requestedMessageId: normalizedMessageId,
          threadItems,
          historyItems,
        });
        const resolvedMessageId = requestedHistoryMessageId.trim();
        if (!resolvedMessageId) {
          return null;
        }
        const impactedItems = findImpactedClaudeRewindItems(
          threadItems,
          normalizedMessageId,
        );
        onDebug?.({
          id: `${Date.now()}-client-thread-fork-from-message-resolved`,
          timestamp: Date.now(),
          source: "client",
          label: "thread/fork from message resolved",
          payload: {
            workspaceId,
            threadId,
            requestedMessageId: normalizedMessageId,
            resolvedMessageId,
            firstHistoryMessageId,
            latestHistoryMessageId,
          },
        });
        if (shouldRestoreFiles) {
          rewindRestoreState = await applyClaudeRewindWorkspaceRestore({
            workspaceId,
            workspacePath,
            impactedItems,
          });
          if ((rewindRestoreState?.ignoredCommittedPaths?.length ?? 0) > 0) {
            onDebug?.({
              id: `${Date.now()}-client-thread-fork-from-message-restore-committed-ignored`,
              timestamp: Date.now(),
              source: "client",
              label: "thread/fork from message restore committed ignored",
              payload: {
                workspaceId,
                threadId,
                ignoredCommittedPaths:
                  rewindRestoreState?.ignoredCommittedPaths ?? [],
              },
            });
          }
          if ((rewindRestoreState?.skippedPaths?.length ?? 0) > 0) {
            onDebug?.({
              id: `${Date.now()}-client-thread-fork-from-message-restore-skipped`,
              timestamp: Date.now(),
              source: "error",
              label: "thread/fork from message restore skipped",
              payload: {
                workspaceId,
                threadId,
                skippedPaths: rewindRestoreState?.skippedPaths ?? [],
              },
            });
          }
        }
        if (!shouldRewindSession) {
          return threadId;
        }
        if (firstHistoryMessageId && resolvedMessageId === firstHistoryMessageId) {
          await deleteClaudeSessionService(workspacePath, sessionId);
          delete loadedThreadsRef.current[threadId];
          dispatch({
            type: "removeThread",
            workspaceId,
            threadId,
          });
          return threadId;
        }
        const response = await forkClaudeSessionFromMessageService(
          workspacePath,
          sessionId,
          resolvedMessageId,
        );
        onDebug?.({
          id: `${Date.now()}-server-thread-fork-from-message`,
          timestamp: Date.now(),
          source: "server",
          label: "thread/fork from message response",
          payload: response,
        });
        const forkedThreadId = extractThreadId(response);
        if (!forkedThreadId) {
          if (shouldRestoreFiles && rewindRestoreState?.originalSnapshots?.length) {
            await restoreClaudeRewindWorkspaceSnapshots(
              workspaceId,
              rewindRestoreState.originalSnapshots,
            );
          }
          return null;
        }
        dispatch({
          type: "renameThreadId",
          workspaceId,
          oldThreadId: threadId,
          newThreadId: forkedThreadId,
        });
        dispatch({
          type: "hideThread",
          workspaceId,
          threadId,
        });
        await renameThreadTitleMapping(workspaceId, threadId, forkedThreadId);
        if (shouldActivate && !activeThreadIdByWorkspace[workspaceId]) {
          dispatch({
            type: "setActiveThreadId",
            workspaceId,
            threadId: forkedThreadId,
          });
        }
        delete loadedThreadsRef.current[threadId];
        loadedThreadsRef.current[forkedThreadId] = false;
        await resumeThreadForWorkspace(workspaceId, forkedThreadId, true, true);
        try {
          await deleteClaudeSessionService(workspacePath, sessionId);
        } catch (error) {
          onDebug?.({
            id: `${Date.now()}-client-thread-fork-from-message-delete-source-error`,
            timestamp: Date.now(),
            source: "error",
            label: "thread/fork from message delete source error",
            payload: error instanceof Error ? error.message : String(error),
          });
        }
        return forkedThreadId;
      } catch (error) {
        try {
          if (shouldRestoreFiles && rewindRestoreState?.originalSnapshots?.length) {
            await restoreClaudeRewindWorkspaceSnapshots(
              workspaceId,
              rewindRestoreState.originalSnapshots,
            );
          }
        } catch {
          // Best effort rollback is handled in the main rewind path below.
        }
        onDebug?.({
          id: `${Date.now()}-client-thread-fork-from-message-error`,
          timestamp: Date.now(),
          source: "error",
          label: "thread/fork from message error",
          payload: error instanceof Error ? error.message : String(error),
        });
        return null;
      } finally {
        delete claudeRewindInFlightByThreadRef.current[rewindLockKey];
      }
    },
    [
      activeThreadIdByWorkspace,
      dispatch,
      itemsByThread,
      loadedThreadsRef,
      onDebug,
      renameThreadTitleMapping,
      resumeThreadForWorkspace,
      workspacePathsByIdRef,
    ],
  );

  const forkSessionFromMessageForWorkspace = useCallback(
    async (
      workspaceId: string,
      threadId: string,
      messageId: string,
      options?: RewindFromMessageOptions,
    ) => {
      const canonicalThreadId = threadId.trim();
      const rewindEngine = resolveRewindSupportedEngine(canonicalThreadId);
      if (!rewindEngine) {
        return null;
      }
      if (rewindEngine === "claude") {
        const claudeThreadId = canonicalThreadId.replace(/^claude:/i, "claude:");
        return forkClaudeSessionFromMessageForWorkspace(
          workspaceId,
          claudeThreadId,
          messageId,
          options,
        );
      }

      const normalizedMessageId = messageId.trim();
      if (!normalizedMessageId) {
        return null;
      }
      const workspacePath = workspacePathsByIdRef.current[workspaceId];
      if (!workspacePath) {
        return null;
      }
      const shouldActivate = options?.activate !== false;
      const rewindMode = normalizeRewindMode(options?.mode);
      const shouldRestoreFiles = shouldRestoreWorkspaceFiles(rewindMode);
      const shouldRewindSession = shouldRewindMessages(rewindMode);
      const rewindLockKey = `${workspaceId}:${canonicalThreadId}`;
      if (claudeRewindInFlightByThreadRef.current[rewindLockKey]) {
        return null;
      }
      claudeRewindInFlightByThreadRef.current[rewindLockKey] = true;
      onDebug?.({
        id: `${Date.now()}-client-thread-codex-fork-from-message`,
        timestamp: Date.now(),
        source: "client",
        label: "codex/thread/fork from message",
        payload: {
          workspaceId,
          threadId: canonicalThreadId,
          messageId: normalizedMessageId,
        },
      });
      let rewindRestoreState:
        | Awaited<ReturnType<typeof applyClaudeRewindWorkspaceRestore>>
        | null = null;
      try {
        const threadItems = itemsByThread[canonicalThreadId] ?? [];
        const userThreadItems = threadItems.filter(isUserConversationMessage);
        const targetUserTurnIndex = findLastUserMessageIndexById(
          userThreadItems,
          normalizedMessageId,
        );
        if (targetUserTurnIndex < 0) {
          return null;
        }
        const targetUserMessageText = normalizeComparableRewindText(
          userThreadItems[targetUserTurnIndex]?.text ?? "",
        );
        const targetUserMessageOccurrence = targetUserMessageText
          ? userThreadItems.reduce((count, item, index) => {
              if (index > targetUserTurnIndex) {
                return count;
              }
              return normalizeComparableRewindText(item.text) === targetUserMessageText
                ? count + 1
                : count;
            }, 0) || 1
          : undefined;
        const impactedItems = findImpactedClaudeRewindItems(
          threadItems,
          normalizedMessageId,
        );
        if (shouldRestoreFiles) {
          rewindRestoreState = await applyClaudeRewindWorkspaceRestore({
            workspaceId,
            workspacePath,
            impactedItems,
          });
          if ((rewindRestoreState?.ignoredCommittedPaths?.length ?? 0) > 0) {
            onDebug?.({
              id: `${Date.now()}-client-thread-codex-fork-from-message-restore-committed-ignored`,
              timestamp: Date.now(),
              source: "client",
              label: "codex/thread/fork from message restore committed ignored",
              payload: {
                workspaceId,
                threadId: canonicalThreadId,
                ignoredCommittedPaths:
                  rewindRestoreState?.ignoredCommittedPaths ?? [],
              },
            });
          }
          if ((rewindRestoreState?.skippedPaths?.length ?? 0) > 0) {
            onDebug?.({
              id: `${Date.now()}-client-thread-codex-fork-from-message-restore-skipped`,
              timestamp: Date.now(),
              source: "error",
              label: "codex/thread/fork from message restore skipped",
              payload: {
                workspaceId,
                threadId: canonicalThreadId,
                skippedPaths: rewindRestoreState?.skippedPaths ?? [],
              },
            });
          }
        }
        if (!shouldRewindSession) {
          return canonicalThreadId;
        }

        if (targetUserTurnIndex === 0) {
          await deleteCodexSessionService(workspaceId, canonicalThreadId);
          delete loadedThreadsRef.current[canonicalThreadId];
          dispatch({
            type: "removeThread",
            workspaceId,
            threadId: canonicalThreadId,
          });
          return canonicalThreadId;
        }

        const hardRewindResponse = await rewindCodexThreadService(
          workspaceId,
          canonicalThreadId,
          targetUserTurnIndex,
          normalizedMessageId,
          {
            targetUserMessageText:
              targetUserMessageText.length > 0 ? targetUserMessageText : undefined,
            targetUserMessageOccurrence,
            localUserMessageCount: userThreadItems.length,
          },
        );
        onDebug?.({
          id: `${Date.now()}-server-thread-codex-fork-from-message`,
          timestamp: Date.now(),
          source: "server",
          label: "codex/thread/fork from message response",
          payload: hardRewindResponse,
        });
        const forkedThreadId = extractThreadId(hardRewindResponse);
        if (!forkedThreadId) {
          if (shouldRestoreFiles && rewindRestoreState?.originalSnapshots?.length) {
            await restoreClaudeRewindWorkspaceSnapshots(
              workspaceId,
              rewindRestoreState.originalSnapshots,
            );
          }
          return null;
        }
        dispatch({
          type: "renameThreadId",
          workspaceId,
          oldThreadId: canonicalThreadId,
          newThreadId: forkedThreadId,
        });
        dispatch({
          type: "hideThread",
          workspaceId,
          threadId: canonicalThreadId,
        });
        await renameThreadTitleMapping(
          workspaceId,
          canonicalThreadId,
          forkedThreadId,
        );
        if (shouldActivate && !activeThreadIdByWorkspace[workspaceId]) {
          dispatch({
            type: "setActiveThreadId",
            workspaceId,
            threadId: forkedThreadId,
          });
        }
        delete loadedThreadsRef.current[canonicalThreadId];
        loadedThreadsRef.current[forkedThreadId] = false;
        await resumeThreadForWorkspace(workspaceId, forkedThreadId, true, true);
        return forkedThreadId;
      } catch (error) {
        try {
          if (shouldRestoreFiles && rewindRestoreState?.originalSnapshots?.length) {
            await restoreClaudeRewindWorkspaceSnapshots(
              workspaceId,
              rewindRestoreState.originalSnapshots,
            );
          }
        } catch {
          // Best effort rollback is handled in the main rewind path below.
        }
        onDebug?.({
          id: `${Date.now()}-client-thread-codex-fork-from-message-error`,
          timestamp: Date.now(),
          source: "error",
          label: "codex/thread/fork from message error",
          payload: error instanceof Error ? error.message : String(error),
        });
        return null;
      } finally {
        delete claudeRewindInFlightByThreadRef.current[rewindLockKey];
      }
    },
    [
      activeThreadIdByWorkspace,
      dispatch,
      forkClaudeSessionFromMessageForWorkspace,
      itemsByThread,
      loadedThreadsRef,
      onDebug,
      renameThreadTitleMapping,
      resumeThreadForWorkspace,
      workspacePathsByIdRef,
    ],
  );

  return {
    startThreadForWorkspace,
    startSharedSessionForWorkspace,
    forkThreadForWorkspace,
    forkClaudeSessionFromMessageForWorkspace,
    forkSessionFromMessageForWorkspace,
  };
}
