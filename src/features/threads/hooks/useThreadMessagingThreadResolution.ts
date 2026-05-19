import { useCallback, useRef } from "react";
import type { Dispatch } from "react";
import type { ConversationItem, DebugEntry, WorkspaceInfo } from "../../../types";
import {
  isClaudeRuntimeThreadId,
} from "../utils/claudeForkThread";
import { loadClaudeSession as loadClaudeSessionService } from "../../../services/tauri";
import { parseClaudeHistoryMessages } from "../loaders/claudeHistoryLoader";
import type { ThreadAction } from "./useThreadsReducer";

type ThreadEngine = "claude" | "codex" | "gemini" | "opencode";

type RunWithCreateSessionLoading = <T>(
  params: {
    workspace: WorkspaceInfo;
    engine: ThreadEngine;
  },
  action: () => Promise<T>,
) => Promise<T>;

type UseThreadMessagingThreadResolutionOptions = {
  activeEngine: ThreadEngine;
  dispatch: Dispatch<ThreadAction>;
  getThreadEngine: (
    workspaceId: string,
    threadId: string,
  ) => ThreadEngine | undefined;
  getThreadKind?: (
    workspaceId: string,
    threadId: string,
  ) => "native" | "shared";
  onDebug?: (entry: DebugEntry) => void;
  runWithCreateSessionLoading?: RunWithCreateSessionLoading;
  startThreadForWorkspace: (
    workspaceId: string,
    options?: {
      activate?: boolean;
      engine?: ThreadEngine;
      folderId?: string | null;
    },
  ) => Promise<string | null>;
};

type ClaudePendingNativeSessionState = {
  hasActiveTurn: boolean;
  hasAwaitingMarker: boolean;
  hasLocalItems: boolean;
  isProcessing: boolean;
};

function hasClaudeTranscriptRebindEvidence(items: ConversationItem[]): boolean {
  return items.some((item) => {
    if (item.kind === "message") {
      return item.role === "assistant";
    }
    return item.kind === "tool" || item.kind === "reasoning";
  });
}

function isClaudePendingThreadAwaitingNativeSession(
  threadId: string,
  params: ClaudePendingNativeSessionState,
) {
  return (
    threadId.startsWith("claude-pending-") &&
    (params.hasAwaitingMarker ||
      params.hasLocalItems ||
      params.hasActiveTurn ||
      params.isProcessing)
  );
}

export function useThreadMessagingThreadResolution({
  activeEngine,
  dispatch,
  getThreadEngine,
  getThreadKind,
  onDebug,
  runWithCreateSessionLoading,
  startThreadForWorkspace,
}: UseThreadMessagingThreadResolutionOptions) {
  const claudePendingThreadAwaitingNativeSessionRef = useRef<Set<string>>(
    new Set(),
  );
  const claudeCandidateSessionIdByPendingThreadRef = useRef<
    Map<string, string>
  >(new Map());
  const geminiSessionIdByPendingThreadRef = useRef<Map<string, string>>(
    new Map(),
  );

  const normalizeEngineSelection = useCallback(
    (engine: ThreadEngine | undefined): ThreadEngine =>
      engine === "claude"
        ? "claude"
        : engine === "opencode"
          ? "opencode"
          : engine === "gemini"
            ? "gemini"
            : "codex",
    [],
  );

  const resolveThreadEngine = useCallback(
    (workspaceId: string, threadId: string): ThreadEngine => {
      const persistedEngine = getThreadEngine(workspaceId, threadId);
      if (persistedEngine) {
        return persistedEngine;
      }
      if (isClaudeRuntimeThreadId(threadId)) {
        return "claude";
      }
      if (
        threadId.startsWith("gemini:") ||
        threadId.startsWith("gemini-pending-")
      ) {
        return "gemini";
      }
      if (
        threadId.startsWith("opencode:") ||
        threadId.startsWith("opencode-pending-")
      ) {
        return "opencode";
      }
      return normalizeEngineSelection(activeEngine);
    },
    [activeEngine, getThreadEngine, normalizeEngineSelection],
  );

  const resolveThreadKind = useCallback(
    (workspaceId: string, threadId: string): "native" | "shared" =>
      getThreadKind?.(workspaceId, threadId) ?? "native",
    [getThreadKind],
  );

  const isThreadIdCompatibleWithEngine = useCallback(
    (engine: ThreadEngine, threadId: string): boolean => {
      if (engine === "claude") {
        return isClaudeRuntimeThreadId(threadId);
      }
      if (engine === "gemini") {
        return (
          threadId.startsWith("gemini:") ||
          threadId.startsWith("gemini-pending-")
        );
      }
      if (engine === "opencode") {
        return (
          threadId.startsWith("opencode:") ||
          threadId.startsWith("opencode-pending-")
        );
      }
      return (
        !threadId.startsWith("claude:") &&
        !threadId.startsWith("claude-pending-") &&
        !threadId.startsWith("gemini:") &&
        !threadId.startsWith("gemini-pending-") &&
        !threadId.startsWith("opencode:") &&
        !threadId.startsWith("opencode-pending-")
      );
    },
    [],
  );

  const startThreadForMessageSend = useCallback(
    async (workspace: WorkspaceInfo, engine: ThreadEngine) => {
      const createThread = () =>
        startThreadForWorkspace(workspace.id, {
          activate: true,
          engine,
        });
      if (!runWithCreateSessionLoading) {
        return createThread();
      }
      return runWithCreateSessionLoading({ workspace, engine }, createThread);
    },
    [runWithCreateSessionLoading, startThreadForWorkspace],
  );

  const reconcileClaudePendingThreadFromCandidate = useCallback(
    async (
      workspace: WorkspaceInfo,
      pendingThreadId: string,
    ): Promise<string | null> => {
      const candidateSessionId =
        claudeCandidateSessionIdByPendingThreadRef.current.get(
          pendingThreadId,
        ) ?? null;
      if (!candidateSessionId) {
        return null;
      }
      const workspacePath =
        typeof workspace.path === "string" ? workspace.path : "";
      if (!workspacePath.trim()) {
        return null;
      }
      const finalizedThreadId = `claude:${candidateSessionId}`;
      try {
        const result = await loadClaudeSessionService(
          workspacePath,
          candidateSessionId,
        );
        const record =
          result && typeof result === "object"
            ? (result as Record<string, unknown>)
            : {};
        const messagesData = record.messages ?? result;
        const parsedItems = parseClaudeHistoryMessages(
          messagesData,
          workspacePath,
        );
        if (!hasClaudeTranscriptRebindEvidence(parsedItems)) {
          onDebug?.({
            id: `${Date.now()}-client-claude-candidate-reconcile-empty`,
            timestamp: Date.now(),
            source: "client",
            label: "thread/session candidate transcript lacks rebind evidence",
            payload: {
              workspaceId: workspace.id,
              threadId: pendingThreadId,
              sessionId: candidateSessionId,
              itemCount: parsedItems.length,
            },
          });
          return null;
        }
        dispatch({
          type: "renameThreadId",
          workspaceId: workspace.id,
          oldThreadId: pendingThreadId,
          newThreadId: finalizedThreadId,
        });
        claudePendingThreadAwaitingNativeSessionRef.current.delete(
          pendingThreadId,
        );
        claudeCandidateSessionIdByPendingThreadRef.current.delete(
          pendingThreadId,
        );
        onDebug?.({
          id: `${Date.now()}-client-claude-candidate-reconcile`,
          timestamp: Date.now(),
          source: "client",
          label: "thread/session reconciled from candidate transcript",
          payload: {
            workspaceId: workspace.id,
            oldThreadId: pendingThreadId,
            newThreadId: finalizedThreadId,
            sessionId: candidateSessionId,
            itemCount: parsedItems.length,
          },
        });
        return finalizedThreadId;
      } catch (error) {
        onDebug?.({
          id: `${Date.now()}-client-claude-candidate-reconcile-error`,
          timestamp: Date.now(),
          source: "client",
          label: "thread/session candidate transcript load failed",
          payload: {
            workspaceId: workspace.id,
            threadId: pendingThreadId,
            sessionId: candidateSessionId,
            error: error instanceof Error ? error.message : String(error),
          },
        });
        return null;
      }
    },
    [dispatch, onDebug],
  );

  return {
    claudeCandidateSessionIdByPendingThreadRef,
    claudePendingThreadAwaitingNativeSessionRef,
    geminiSessionIdByPendingThreadRef,
    isClaudePendingThreadAwaitingNativeSession,
    isThreadIdCompatibleWithEngine,
    normalizeEngineSelection,
    reconcileClaudePendingThreadFromCandidate,
    resolveThreadEngine,
    resolveThreadKind,
    startThreadForMessageSend,
  };
}
