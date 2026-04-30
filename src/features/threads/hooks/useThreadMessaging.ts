import { useCallback, useRef } from "react";
import type { Dispatch, MutableRefObject } from "react";
import { useTranslation } from "react-i18next";
import type {
  AccessMode,
  ConversationItem,
  MemoryContextInjectionMode,
  RateLimitSnapshot,
  ThreadTokenUsage,
  CustomPromptOption,
  DebugEntry,
  ReviewTarget,
  WorkspaceInfo,
} from "../../../types";
import {
  sendUserMessage as sendUserMessageService,
  startReview as startReviewService,
  interruptTurn as interruptTurnService,
  engineInterruptTurn as engineInterruptTurnService,
  engineSendMessage as engineSendMessageService,
  engineInterrupt as engineInterruptService,
  listGeminiSessions as listGeminiSessionsService,
  projectMemoryCaptureAuto as projectMemoryCaptureAutoService,
} from "../../../services/tauri";
import { sendSharedSessionTurn } from "../../shared-session/runtime/sendSharedSessionTurn";
import { projectMemoryFacade } from "../../project-memory/services/projectMemoryFacade";
import {
  injectSelectedMemoriesContext,
  type InjectionResult,
} from "../../project-memory/utils/memoryContextInjection";
import { noteCardsFacade } from "../../note-cards/services/noteCardsFacade";
import {
  injectSelectedNoteCardsContext,
  NOTE_CARD_CONTEXT_SUMMARY_PREFIX,
  type NoteCardInjectionResult,
} from "../../note-cards/utils/noteCardContextInjection";
import { MEMORY_CONTEXT_SUMMARY_PREFIX } from "../../project-memory/utils/memoryMarkers";
import { expandCustomPromptText } from "../../../utils/customPrompts";
import {
  asString,
  extractRpcErrorMessage,
  parseReviewTarget,
} from "../utils/threadNormalize";
import type { ThreadAction, ThreadState } from "./useThreadsReducer";
import { useReviewPrompt } from "./useReviewPrompt";
import { pushErrorToast } from "../../../services/toasts";
import { pushThreadFailureRuntimeNotice } from "../../../services/globalRuntimeNotices";
import { resolveAgentIconForAgent } from "../../../utils/agentIcons";
import { normalizeSharedSessionEngine } from "../../shared-session/utils/sharedSessionEngines";
import {
  clearPendingClaudeMcpOutputNotice,
  getClaudeMcpRuntimeSnapshot,
  setPendingClaudeMcpOutputNotice,
  rewriteClaudePlaywrightAlias,
} from "../utils/claudeMcpRuntimeSnapshot";
import {
  buildCodexTextWithSpecRootPriority,
  probeSessionSpecLinkWithTimeout,
  resolveWorkspaceSpecRoot,
  shouldProbeSessionSpecForEngine,
  type SessionSpecLinkContext,
} from "./threadMessagingSpecRoot";
import {
  buildReviewCommandText,
  extractSessionIdFromEngineSendResponse,
  isInvalidReviewThreadIdError,
  isLikelyForeignModelForGemini,
  isRecoverableCodexThreadBindingError,
  isCodexMissingThreadBindingError,
  isUnknownEngineInterruptTurnMethodError,
  mapNetworkErrorToUserMessage,
  normalizeAccessMode,
  pickLikelyGeminiSessionId,
  primeThreadStreamLatencyForSend,
  resolveCollaborationModeIdFromPayload,
  resolveRecoverableCodexFirstPacketTimeout,
} from "./threadMessagingHelpers";
import { resolveThreadStabilityDiagnostic } from "../utils/stabilityDiagnostics";
import { useThreadMessagingSessionTooling } from "./useThreadMessagingSessionTooling";
import {
  createOptimisticGeneratedImageProcessingItem,
  extractOptimisticGeneratedImagePrompt,
} from "../utils/generatedImagePlaceholder";
import {
  buildCodexLivenessDiagnostic,
  canUseLocalFirstSendCodexDraftReplacement,
  resolveCodexAcceptedTurnFact,
  shouldDeferCodexActivityUntilTurnAccepted,
} from "../utils/codexConversationLiveness";

type SendMessageOptions = {
  skipPromptExpansion?: boolean;
  skipOptimisticUserBubble?: boolean;
  suppressUserMessageRender?: boolean;
  model?: string | null;
  effort?: string | null;
  collaborationMode?: Record<string, unknown> | null;
  accessMode?: AccessMode;
  resumeSource?: "queue-fusion-cutover" | null;
  resumeTurnId?: string | null;
  selectedMemoryIds?: string[];
  selectedMemoryInjectionMode?: MemoryContextInjectionMode;
  selectedNoteCardIds?: string[];
  selectedAgent?: {
    id: string;
    name: string;
    prompt?: string | null;
    icon?: string | null;
  } | null;
  codexInvalidThreadRetryAttempted?: boolean;
};

type InterruptTurnOptions = {
  reason?: "user-stop" | "queue-fusion" | "plan-handoff";
};

type HandleFusionStalledOptions = {
  message?: string | null;
};

type RunWithCreateSessionLoading = <T>(
  params: {
    workspace: WorkspaceInfo;
    engine: "claude" | "codex" | "gemini" | "opencode";
  },
  action: () => Promise<T>,
) => Promise<T>;

const AGENT_PROMPT_HEADER = "## Agent Role and Instructions";
const AGENT_PROMPT_NAME_PREFIX = "Agent Name:";
const AGENT_PROMPT_ICON_PREFIX = "Agent Icon:";
const isThreadMessagingTestMode = (() => {
  try {
    return import.meta.env.MODE === "test";
  } catch {
    return false;
  }
})();
const shouldEmitThreadMessagingDevLogs = (() => {
  try {
    return import.meta.env.DEV && !isThreadMessagingTestMode;
  } catch {
    return false;
  }
})();

type UseThreadMessagingOptions = {
  activeWorkspace: WorkspaceInfo | null;
  activeThreadId: string | null;
  accessMode?: "default" | "read-only" | "current" | "full-access";
  model?: string | null;
  effort?: string | null;
  collaborationMode?: Record<string, unknown> | null;
  steerEnabled: boolean;
  customPrompts: CustomPromptOption[];
  activeEngine?: "claude" | "codex" | "gemini" | "opencode";
  threadStatusById: ThreadState["threadStatusById"];
  itemsByThread: ThreadState["itemsByThread"];
  activeTurnIdByThread: ThreadState["activeTurnIdByThread"];
  codexAcceptedTurnByThread: ThreadState["codexAcceptedTurnByThread"];
  tokenUsageByThread: Record<string, ThreadTokenUsage>;
  rateLimitsByWorkspace: Record<string, RateLimitSnapshot | null>;
  codexCompactionInFlightByThreadRef?: MutableRefObject<Record<string, boolean>>;
  pendingInterruptsRef: MutableRefObject<Set<string>>;
  interruptedThreadsRef: MutableRefObject<Set<string>>;
  dispatch: Dispatch<ThreadAction>;
  getCustomName: (workspaceId: string, threadId: string) => string | undefined;
  getThreadEngine: (
    workspaceId: string,
    threadId: string,
  ) => "claude" | "codex" | "gemini" | "opencode" | undefined;
  getThreadKind?: (
    workspaceId: string,
    threadId: string,
  ) => "native" | "shared";
  markProcessing: (threadId: string, isProcessing: boolean) => void;
  markReviewing: (threadId: string, isReviewing: boolean) => void;
  setActiveTurnId: (threadId: string, turnId: string | null) => void;
  recordThreadActivity: (
    workspaceId: string,
    threadId: string,
    timestamp?: number,
  ) => void;
  safeMessageActivity: () => void;
  onDebug?: (entry: DebugEntry) => void;
  pushThreadErrorMessage: (threadId: string, message: string) => void;
  ensureThreadForActiveWorkspace: () => Promise<string | null>;
  ensureThreadForWorkspace: (workspaceId: string) => Promise<string | null>;
  refreshThread: (workspaceId: string, threadId: string) => Promise<string | null>;
  forkThreadForWorkspace: (
    workspaceId: string,
    threadId: string,
    options?: { activate?: boolean },
  ) => Promise<string | null>;
  updateThreadParent: (parentId: string, childIds: string[]) => void;
  startThreadForWorkspace: (
    workspaceId: string,
    options?: { activate?: boolean; engine?: "claude" | "codex" | "gemini" | "opencode" },
  ) => Promise<string | null>;
  resolveOpenCodeAgent?: (threadId: string | null) => string | null;
  resolveOpenCodeVariant?: (threadId: string | null) => string | null;
  onInputMemoryCaptured?: (payload: {
    workspaceId: string;
    threadId: string;
    turnId: string;
    inputText: string;
    memoryId: string | null;
    workspaceName: string | null;
    workspacePath: string | null;
    engine: string | null;
  }) => void;
  resolveCollaborationRuntimeMode?: (
    threadId: string,
  ) => "plan" | "code" | null;
  runWithCreateSessionLoading?: RunWithCreateSessionLoading;
};

export function useThreadMessaging({
  activeWorkspace,
  activeThreadId,
  accessMode,
  model,
  effort,
  collaborationMode,
  steerEnabled,
  customPrompts,
  activeEngine = "claude",
  threadStatusById,
  itemsByThread,
  activeTurnIdByThread,
  codexAcceptedTurnByThread,
  tokenUsageByThread,
  rateLimitsByWorkspace,
  codexCompactionInFlightByThreadRef,
  pendingInterruptsRef,
  interruptedThreadsRef,
  dispatch,
  getCustomName,
  getThreadEngine,
  getThreadKind,
  markProcessing,
  markReviewing,
  setActiveTurnId,
  recordThreadActivity,
  safeMessageActivity,
  onDebug,
  pushThreadErrorMessage,
  ensureThreadForActiveWorkspace,
  ensureThreadForWorkspace,
  refreshThread,
  forkThreadForWorkspace,
  updateThreadParent,
  startThreadForWorkspace,
  resolveOpenCodeAgent,
  resolveOpenCodeVariant,
  onInputMemoryCaptured,
  resolveCollaborationRuntimeMode,
  runWithCreateSessionLoading,
}: UseThreadMessagingOptions) {
  const { t, i18n } = useTranslation();
  const internalCodexCompactionInFlightByThreadRef = useRef<Record<string, boolean>>({});
  const effectiveCodexCompactionInFlightByThreadRef =
    codexCompactionInFlightByThreadRef ?? internalCodexCompactionInFlightByThreadRef;
  const lastOpenCodeModelByThreadRef = useRef<Map<string, string>>(new Map());
  const claudeSessionIdByPendingThreadRef = useRef<Map<string, string>>(new Map());
  const geminiSessionIdByPendingThreadRef = useRef<Map<string, string>>(new Map());
  const sessionSpecLinkByThreadRef = useRef<Map<string, SessionSpecLinkContext>>(new Map());
  const normalizeEngineSelection = useCallback(
    (
      engine: "claude" | "codex" | "gemini" | "opencode" | undefined,
    ): "claude" | "codex" | "gemini" | "opencode" =>
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
    (
      workspaceId: string,
      threadId: string,
    ): "claude" | "codex" | "gemini" | "opencode" => {
      const persistedEngine = getThreadEngine(workspaceId, threadId);
      if (persistedEngine) {
        return persistedEngine;
      }
      if (threadId.startsWith("claude:") || threadId.startsWith("claude-pending-")) {
        return "claude";
      }
      if (threadId.startsWith("gemini:") || threadId.startsWith("gemini-pending-")) {
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
    (
      engine: "claude" | "codex" | "gemini" | "opencode",
      threadId: string,
    ): boolean => {
      if (engine === "claude") {
        return (
          threadId.startsWith("claude:") ||
          threadId.startsWith("claude-pending-")
        );
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
        !threadId.startsWith("claude:")
        && !threadId.startsWith("claude-pending-")
        && !threadId.startsWith("gemini:")
        && !threadId.startsWith("gemini-pending-")
        && !threadId.startsWith("opencode:")
        && !threadId.startsWith("opencode-pending-")
      );
    },
    [],
  );

  const startThreadForMessageSend = useCallback(
    async (
      workspace: WorkspaceInfo,
      engine: "claude" | "codex" | "gemini" | "opencode",
    ) => {
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

  const sendMessageToThread = useCallback(
    async (
      workspace: WorkspaceInfo,
      threadId: string,
      text: string,
      images: string[] = [],
      options?: SendMessageOptions,
    ) => {
      const messageText = text.trim();
      if (!messageText && images.length === 0) {
        return;
      }
      const threadKind = resolveThreadKind(workspace.id, threadId);
      const resolvedThreadEngine = resolveThreadEngine(workspace.id, threadId);
      const resolvedEngine =
        threadKind === "shared"
          ? normalizeSharedSessionEngine(activeEngine)
          : resolvedThreadEngine;
      dispatch({
        type: "ensureThread",
        workspaceId: workspace.id,
        threadId,
        engine: resolvedEngine,
      });
      dispatch({
        type: "setThreadEngine",
        workspaceId: workspace.id,
        threadId,
        engine: resolvedEngine,
      });
      let finalText = messageText;
      if (!options?.skipPromptExpansion) {
        const promptExpansion = expandCustomPromptText(messageText, customPrompts);
        if (promptExpansion && "error" in promptExpansion) {
          pushThreadErrorMessage(threadId, promptExpansion.error);
          safeMessageActivity();
          return;
        }
        finalText = promptExpansion?.expanded ?? messageText;
      }
      const visibleUserText = finalText;
      const selectedMemoryIds = Array.from(
        new Set(
          (options?.selectedMemoryIds ?? [])
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0),
        ),
      );
      const selectedNoteCardIds = Array.from(
        new Set(
          (options?.selectedNoteCardIds ?? [])
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0),
        ),
      );
      let injectionResult: InjectionResult = {
        finalText,
        injectedCount: 0,
        injectedChars: 0,
        retrievalMs: 0,
        previewText: null,
        disabledReason: null,
      };
      let noteInjectionResult: NoteCardInjectionResult = {
        finalText,
        injectedCount: 0,
        injectedChars: 0,
        imagePaths: [],
        previewText: null,
      };
      if (selectedMemoryIds.length > 0) {
        const retrievalStart = Date.now();
        const selectedMemoryInjectionMode =
          options?.selectedMemoryInjectionMode === "summary" ? "summary" : "detail";
        const selectedMemories = (
          await Promise.all(
            selectedMemoryIds.map((memoryId) =>
              projectMemoryFacade.get(memoryId, workspace.id).catch(() => null),
            ),
          )
        ).filter((entry): entry is NonNullable<typeof entry> => entry !== null);
        injectionResult = injectSelectedMemoriesContext({
          userText: finalText,
          memories: selectedMemories,
          mode: selectedMemoryInjectionMode,
          retrievalMs: Date.now() - retrievalStart,
        });
      }
      finalText = injectionResult.finalText;
      let finalImages = [...images];
      if (selectedNoteCardIds.length > 0) {
        const selectedNotes = (
          await Promise.all(
            selectedNoteCardIds.map((noteId) =>
              noteCardsFacade
                .get({
                  noteId,
                  workspaceId: workspace.id,
                  workspaceName: workspace.name,
                  workspacePath: workspace.path,
                })
                .catch(() => null),
            ),
          )
        ).filter((entry): entry is NonNullable<typeof entry> => entry !== null);
        noteInjectionResult = injectSelectedNoteCardsContext({
          userText: finalText,
          noteCards: selectedNotes,
        });
        finalText = noteInjectionResult.finalText;
        finalImages = Array.from(
          new Set([...finalImages, ...noteInjectionResult.imagePaths]),
        );
      }
      const resolvedSelectedAgent =
        resolvedEngine !== "opencode" ? options?.selectedAgent ?? null : null;
      const selectedAgentName =
        resolvedEngine !== "opencode"
          ? resolvedSelectedAgent?.name?.trim() || null
          : null;
      const selectedAgentIcon =
        resolvedEngine !== "opencode" && resolvedSelectedAgent
          ? resolveAgentIconForAgent(resolvedSelectedAgent, "codicon-hubot")
          : null;
      const selectedAgentPrompt = resolvedSelectedAgent?.prompt?.trim() || "";
      const selectedAgentPromptSections: string[] = [];
      if (selectedAgentName) {
        selectedAgentPromptSections.push(`${AGENT_PROMPT_NAME_PREFIX} ${selectedAgentName}`);
      }
      if (selectedAgentIcon) {
        selectedAgentPromptSections.push(`${AGENT_PROMPT_ICON_PREFIX} ${selectedAgentIcon}`);
      }
      if (selectedAgentPrompt) {
        selectedAgentPromptSections.push(selectedAgentPrompt);
      }
      const selectedAgentPromptBlock = selectedAgentPromptSections.join("\n\n").trim();
      if (selectedAgentPromptBlock) {
        if (!finalText.includes(AGENT_PROMPT_HEADER)) {
          finalText = `${finalText}\n\n${AGENT_PROMPT_HEADER}\n\n${selectedAgentPromptBlock}`;
        }
      }
      let claudeMcpDiagnostics: string[] = [];
      let claudeMcpOutputNotice: string | null = null;
      const claudeMcpSnapshot =
        resolvedEngine === "claude"
          ? getClaudeMcpRuntimeSnapshot(workspace.id)
          : null;
      if (resolvedEngine === "claude") {
        const rewriteResult = rewriteClaudePlaywrightAlias(workspace.id, finalText);
        finalText = rewriteResult.text;
        claudeMcpDiagnostics = rewriteResult.diagnostics;
        if (rewriteResult.aliasMentioned) {
          onDebug?.({
            id: `${Date.now()}-claude-mcp-routing`,
            timestamp: Date.now(),
            source: "client",
            label: "claude/mcp-routing",
            payload: {
              workspaceId: workspace.id,
              threadId,
              applied: rewriteResult.applied,
              fromServer: rewriteResult.fromServer,
              toServer: rewriteResult.toServer,
              diagnostics: rewriteResult.diagnostics,
            },
          });
          claudeMcpOutputNotice = rewriteResult.applied
            ? "MCP 路由提示：检测到 `playwright-mcp`，当前会话已自动映射为 `chrome-devtools`。"
            : `MCP 路由提示：检测到 \`playwright-mcp\`，但当前会话未确认可见该工具。`;
        }
      }
      if (resolvedEngine === "claude") {
        setPendingClaudeMcpOutputNotice(workspace.id, threadId, claudeMcpOutputNotice);
      } else {
        clearPendingClaudeMcpOutputNotice(workspace.id, threadId);
      }
      if (injectionResult.injectedCount > 0 && injectionResult.previewText) {
        dispatch({
          type: "upsertItem",
          workspaceId: workspace.id,
          threadId,
          item: {
            id: `memory-context-${Date.now()}-${Math.random()
              .toString(36)
              .slice(2, 8)}`,
            kind: "message",
            role: "assistant",
            text: `${MEMORY_CONTEXT_SUMMARY_PREFIX}\n${injectionResult.previewText}`,
          },
          hasCustomName: Boolean(getCustomName(workspace.id, threadId)),
        });
      }
      if (noteInjectionResult.injectedCount > 0 && noteInjectionResult.previewText) {
        dispatch({
          type: "upsertItem",
          workspaceId: workspace.id,
          threadId,
          item: {
            id: `note-card-context-${Date.now()}-${Math.random()
              .toString(36)
              .slice(2, 8)}`,
            kind: "message",
            role: "assistant",
            text: `${NOTE_CARD_CONTEXT_SUMMARY_PREFIX}\n${noteInjectionResult.previewText}`,
          },
          hasCustomName: Boolean(getCustomName(workspace.id, threadId)),
        });
      }
      if (injectionResult.injectedCount > 0) {
        onDebug?.({
          id: `${Date.now()}-memory-context-injected`,
          timestamp: Date.now(),
          source: "client",
          label: "memory/context-injected",
          payload: {
            injectedCount: injectionResult.injectedCount,
            injectedChars: injectionResult.injectedChars,
            retrievalMs: injectionResult.retrievalMs,
          },
        });
      } else if (injectionResult.disabledReason) {
        onDebug?.({
          id: `${Date.now()}-memory-context-skipped`,
          timestamp: Date.now(),
          source: "client",
          label: "memory/context-skipped",
          payload: {
            reason: injectionResult.disabledReason,
            retrievalMs: injectionResult.retrievalMs,
          },
        });
      }
      const modelFromOptions =
        options?.model !== undefined ? options.model : undefined;
      const modelFromHook = model;
      const resolvedModel =
        modelFromOptions !== undefined ? modelFromOptions : modelFromHook;
      const resolvedEffort =
        options?.effort !== undefined ? options.effort : effort;
      const resolvedCollaborationMode =
        options?.collaborationMode !== undefined
          ? options.collaborationMode
          : collaborationMode;
      const sanitizedCollaborationMode =
        resolvedCollaborationMode &&
        typeof resolvedCollaborationMode === "object" &&
        "settings" in resolvedCollaborationMode
          ? resolvedCollaborationMode
          : null;
      const resolvedCollaborationModeIdForSend =
        resolveCollaborationModeIdFromPayload(sanitizedCollaborationMode);
      const userCollaborationMode =
        resolvedEngine === "codex"
          ? resolvedCollaborationModeIdForSend
          : null;
      const accessModeForSend =
        resolvedEngine === "claude" && resolvedCollaborationModeIdForSend === "plan"
          ? "read-only"
          : options?.accessMode !== undefined ? options.accessMode : accessMode;
      const resolvedAccessMode = normalizeAccessMode(
        accessModeForSend,
        resolvedEngine,
      );
      const resolvedOpenCodeAgent =
        resolvedEngine === "opencode" ? (resolveOpenCodeAgent?.(threadId) ?? null) : null;
      const resolvedOpenCodeVariant =
        resolvedEngine === "opencode" ? (resolveOpenCodeVariant?.(threadId) ?? null) : null;
      const sanitizeOpenCodeModel = (candidate: string | null | undefined) => {
        if (!candidate) {
          return null;
        }
        const trimmed = candidate.trim();
        if (!trimmed) {
          return null;
        }
        // Guard against cross-engine leakage like "claude-sonnet-*".
        if (trimmed.startsWith("claude-")) {
          return null;
        }
        return trimmed;
      };
      const sanitizedModel =
        resolvedEngine === "claude" && resolvedModel
          ? (resolvedModel.trim() || null)
          : resolvedEngine === "codex" &&
              resolvedModel &&
              resolvedModel.startsWith("claude-")
            ? null
            : resolvedEngine === "gemini" &&
                resolvedModel &&
                isLikelyForeignModelForGemini(resolvedModel)
              ? null
            : resolvedModel;
      const sanitizedOpenCodeModel =
        resolvedEngine === "opencode"
          ? sanitizeOpenCodeModel(sanitizedModel)
          : sanitizedModel;
      const modelForSend =
        resolvedEngine === "opencode"
          ? (sanitizedOpenCodeModel ?? "openai/gpt-5.3-codex")
          : sanitizedOpenCodeModel;
      if (resolvedEngine === "opencode") {
        const normalizedModel = (modelForSend ?? "").trim().toLowerCase();
        const prevModel = lastOpenCodeModelByThreadRef.current.get(threadId);
        const isSessionThread = threadId.startsWith("opencode:");
        if (
          isSessionThread &&
          prevModel &&
          normalizedModel &&
          prevModel !== normalizedModel
        ) {
          pushErrorToast({
            title: t("messages.opencodeModelSwitchTitle"),
            message: t("messages.opencodeModelSwitchMessage"),
            durationMs: 3200,
          });
        }
        if (normalizedModel) {
          lastOpenCodeModelByThreadRef.current.set(threadId, normalizedModel);
        }
      }
      if (
        resolvedEngine === "opencode" &&
        resolvedModel &&
        !sanitizedOpenCodeModel
      ) {
        onDebug?.({
          id: `${Date.now()}-client-opencode-model-sanitize`,
          timestamp: Date.now(),
          source: "client",
          label: "model/sanitize",
          payload: {
            reason: "invalid-opencode-model",
            model: resolvedModel,
            fallback: "openai/gpt-5.3-codex",
          },
        });
      }
      onDebug?.({
        id: `${Date.now()}-client-model-resolve`,
        timestamp: Date.now(),
        source: "client",
        label: "model/resolve",
        payload: {
          threadId,
          engine: resolvedEngine,
          modelFromOptions: modelFromOptions ?? null,
          modelFromHook: modelFromHook ?? null,
          resolvedModel: resolvedModel ?? null,
          sanitizedModel: sanitizedModel ?? null,
          modelForSend: modelForSend ?? null,
        },
      });
      if (shouldEmitThreadMessagingDevLogs) {
        console.info("[model/resolve/send]", {
          threadId,
          engine: resolvedEngine,
          modelFromOptions: modelFromOptions ?? null,
          modelFromHook: modelFromHook ?? null,
          resolvedModel: resolvedModel ?? null,
          sanitizedModel: sanitizedModel ?? null,
          modelForSend: modelForSend ?? null,
        });
      }

      const wasProcessing =
        (threadStatusById[threadId]?.isProcessing ?? false) && steerEnabled;
      const shouldAddOptimisticUserBubble =
        !options?.suppressUserMessageRender &&
        !options?.skipOptimisticUserBubble &&
        (resolvedEngine === "codex" || wasProcessing || threadKind === "shared");
      let optimisticUserItem: Extract<ConversationItem, { kind: "message" }> | null = null;
      let optimisticGeneratedImageItem: Extract<
        ConversationItem,
        { kind: "generatedImage" }
      > | null = null;
      if (shouldAddOptimisticUserBubble) {
        const optimisticDisplayText = visibleUserText;
        const optimisticText = finalText;
        const optimisticImages = finalImages;
        if (optimisticDisplayText || optimisticImages.length > 0) {
          optimisticUserItem = {
            id: `optimistic-user-${Date.now()}-${Math.random()
              .toString(36)
              .slice(2, 8)}`,
            kind: "message",
            role: "user",
            text: optimisticText,
            images: optimisticImages.length > 0 ? optimisticImages : undefined,
            collaborationMode: userCollaborationMode,
            selectedAgentName,
            selectedAgentIcon,
          };
          dispatch({
            type: "upsertItem",
            workspaceId: workspace.id,
            threadId,
            item: optimisticUserItem,
            hasCustomName: Boolean(getCustomName(workspace.id, threadId)),
          });
          const optimisticGeneratedImagePrompt =
            resolvedEngine === "codex"
              ? extractOptimisticGeneratedImagePrompt(optimisticDisplayText)
              : null;
          if (optimisticGeneratedImagePrompt) {
            optimisticGeneratedImageItem = createOptimisticGeneratedImageProcessingItem({
              threadId,
              userMessageId: optimisticUserItem.id,
              promptText: optimisticGeneratedImagePrompt,
            });
            dispatch({
              type: "upsertItem",
              workspaceId: workspace.id,
              threadId,
              item: optimisticGeneratedImageItem,
              hasCustomName: Boolean(getCustomName(workspace.id, threadId)),
            });
          }
        }
      }
      const timestamp = Date.now();
      const effectiveResolvedEngine = resolvedEngine;
      const codexPreSendAcceptedTurnResolution =
        effectiveResolvedEngine === "codex"
          ? resolveCodexAcceptedTurnFact({
              record: codexAcceptedTurnByThread[threadId] ?? null,
              items: itemsByThread[threadId] ?? [],
            })
          : null;
      const shouldDeferCodexDraftActivity =
        codexPreSendAcceptedTurnResolution
          ? shouldDeferCodexActivityUntilTurnAccepted(codexPreSendAcceptedTurnResolution)
          : false;
      if (!shouldDeferCodexDraftActivity) {
        recordThreadActivity(workspace.id, threadId, timestamp);
        dispatch({
          type: "setThreadTimestamp",
          workspaceId: workspace.id,
          threadId,
          timestamp,
        });
      }
      if (pendingInterruptsRef.current.has(threadId)) {
        pendingInterruptsRef.current.delete(threadId);
      }
      if (interruptedThreadsRef.current.has(threadId)) {
        interruptedThreadsRef.current.delete(threadId);
      }
      markProcessing(threadId, true);
      safeMessageActivity();
      primeThreadStreamLatencyForSend(workspace.id, threadId, effectiveResolvedEngine, modelForSend);
      onDebug?.({
        id: `${Date.now()}-client-turn-start`,
        timestamp: Date.now(),
        source: "client",
        label: "turn/start",
        payload: {
          workspaceId: workspace.id,
          threadId,
          engine: effectiveResolvedEngine,
          selectedEngine: activeEngine,
          text: finalText,
          images: finalImages,
          model: modelForSend,
          effort: resolvedEffort,
          collaborationMode: sanitizedCollaborationMode,
          accessMode: resolvedAccessMode ?? null,
          agent: resolvedOpenCodeAgent,
          variant: resolvedOpenCodeVariant,
          claudeMcpSnapshot:
            resolvedEngine === "claude"
              ? {
                  capturedAt: claudeMcpSnapshot?.capturedAt ?? null,
                  sessionId: claudeMcpSnapshot?.sessionId ?? null,
                  toolsCount: claudeMcpSnapshot?.tools.length ?? 0,
                  servers: claudeMcpSnapshot?.mcpServers ?? [],
                }
              : null,
        },
      });
      if (shouldEmitThreadMessagingDevLogs) {
        console.info("[turn/start]", {
          workspaceId: workspace.id,
          threadId,
          engine: effectiveResolvedEngine,
          selectedEngine: activeEngine,
          model: modelForSend,
          effort: resolvedEffort,
          accessMode: resolvedAccessMode ?? null,
          agent: resolvedOpenCodeAgent,
          variant: resolvedOpenCodeVariant,
          textLength: finalText.length,
          hasImages: finalImages.length > 0,
        });
      }
      const retryCodexSendAfterThreadRefresh = async (errorMessage: string) => {
        if (
          resolvedEngine !== "codex" ||
          options?.codexInvalidThreadRetryAttempted ||
          !isRecoverableCodexThreadBindingError(errorMessage)
        ) {
          return false;
        }
        const reboundThreadId = await refreshThread(workspace.id, threadId);
        const acceptedTurnResolution =
          codexPreSendAcceptedTurnResolution ??
          resolveCodexAcceptedTurnFact({
            record: codexAcceptedTurnByThread[threadId] ?? null,
            items: itemsByThread[threadId] ?? [],
          });
        const moveOptimisticUserIntentToThread = (targetThreadId: string) => {
          if (targetThreadId === threadId || !optimisticUserItem) {
            return;
          }
          dispatch({
            type: "setThreadItems",
            threadId,
            items: (itemsByThread[threadId] ?? []).filter(
              (item) =>
                item.id !== optimisticUserItem.id &&
                item.id !== optimisticGeneratedImageItem?.id,
            ),
          });
          dispatch({
            type: "upsertItem",
            workspaceId: workspace.id,
            threadId: targetThreadId,
            item: optimisticUserItem,
            hasCustomName: Boolean(getCustomName(workspace.id, targetThreadId)),
          });
          if (optimisticGeneratedImageItem) {
            dispatch({
              type: "upsertItem",
              workspaceId: workspace.id,
              threadId: targetThreadId,
              item: {
                ...optimisticGeneratedImageItem,
                id: `optimistic-generated-image:${targetThreadId}:${optimisticUserItem.id}`,
              },
              hasCustomName: Boolean(getCustomName(workspace.id, targetThreadId)),
            });
          }
        };
        const retrySendOnThread = async (targetThreadId: string) => {
          markProcessing(threadId, false);
          setActiveTurnId(threadId, null);
          safeMessageActivity();
          await sendMessageToThread(workspace, targetThreadId, finalText, finalImages, {
            skipPromptExpansion: true,
            skipOptimisticUserBubble: true,
            model: modelForSend,
            effort: resolvedEffort,
            collaborationMode: sanitizedCollaborationMode,
            accessMode: resolvedAccessMode,
            resumeSource: options?.resumeSource,
            resumeTurnId: options?.resumeTurnId,
            codexInvalidThreadRetryAttempted: true,
          });
        };
        if (!reboundThreadId) {
          const canUseFreshDraftReplacement =
            isCodexMissingThreadBindingError(errorMessage) &&
            canUseLocalFirstSendCodexDraftReplacement({
              resolution: acceptedTurnResolution,
              hasLocalUserIntent: Boolean(optimisticUserItem),
            });
          if (!canUseFreshDraftReplacement) {
            return false;
          }
          const freshThreadId = await startThreadForMessageSend(workspace, "codex");
          if (!freshThreadId) {
            return false;
          }
          onDebug?.({
            id: `${Date.now()}-client-turn-start-draft-fresh-fallback`,
            timestamp: Date.now(),
            source: "client",
            label: "turn/start draft fresh fallback",
            payload: buildCodexLivenessDiagnostic({
              workspaceId: workspace.id,
              threadId,
              stage: "fresh-continuation",
              outcome: "fresh",
              acceptedTurnFact: acceptedTurnResolution.fact,
              source: acceptedTurnResolution.source,
              reason: errorMessage,
            }),
          });
          dispatch({
            type: "setActiveThreadId",
            workspaceId: workspace.id,
            threadId: freshThreadId,
          });
          moveOptimisticUserIntentToThread(freshThreadId);
          await retrySendOnThread(freshThreadId);
          return true;
        }
        onDebug?.({
          id: `${Date.now()}-client-turn-start-thread-retry`,
          timestamp: Date.now(),
          source: "client",
          label: "turn/start thread rebind retry",
          payload: {
            workspaceId: workspace.id,
            originalThreadId: threadId,
            reboundThreadId,
            reboundChanged: reboundThreadId !== threadId,
            reason: errorMessage,
          },
        });
        if (reboundThreadId !== threadId) {
          dispatch({
            type: "setActiveThreadId",
            workspaceId: workspace.id,
            threadId: reboundThreadId,
          });
          moveOptimisticUserIntentToThread(reboundThreadId);
        }
        await retrySendOnThread(reboundThreadId);
        return true;
      };
      try {
        let response: Record<string, unknown>;
        if (threadKind === "shared") {
          const sharedResolvedEngine = normalizeSharedSessionEngine(resolvedEngine);
          dispatch({
            type: "setThreadEngine",
            workspaceId: workspace.id,
            threadId,
            engine: sharedResolvedEngine,
          });
          response =
            (await sendSharedSessionTurn({
              workspaceId: workspace.id,
              threadId,
              engine: sharedResolvedEngine,
              text: finalText,
              model: modelForSend ?? null,
              effort: resolvedEffort ?? null,
              collaborationMode: sanitizedCollaborationMode,
              accessMode: resolvedAccessMode,
              images: finalImages,
              preferredLanguage: i18n.language.toLowerCase().startsWith("zh")
                ? "zh"
                : "en",
              customSpecRoot: resolveWorkspaceSpecRoot(workspace.id),
            })) as Record<string, unknown>;
          const sharedNativeThreadId = asString(response?.nativeThreadId ?? "").trim();
          if (sharedNativeThreadId && !sharedNativeThreadId.startsWith("shared:")) {
            dispatch({
              type: "hideThread",
              workspaceId: workspace.id,
              threadId: sharedNativeThreadId,
            });
          }

          onDebug?.({
            id: `${Date.now()}-server-shared-turn-start`,
            timestamp: Date.now(),
            source: "server",
            label: "shared-session/turn/start response",
            payload: response,
          });
        } else {

        const isClaudeSession = threadId.startsWith("claude:");
        const isOpenCodeSession = threadId.startsWith("opencode:");
        const cliEngine = resolvedEngine === "codex" ? null : resolvedEngine;
        const threadItems = itemsByThread[threadId] ?? [];
        const sessionSpecKey = `${workspace.id}:${threadId}`;
        const customSpecRoot = resolveWorkspaceSpecRoot(workspace.id);
        let sessionSpecLink = sessionSpecLinkByThreadRef.current.get(sessionSpecKey) ?? null;
        const shouldProbeSessionSpecLink =
          shouldProbeSessionSpecForEngine(resolvedEngine) &&
          Boolean(customSpecRoot) &&
          (threadItems.length === 0 || !sessionSpecLink);
        if (shouldProbeSessionSpecLink && customSpecRoot) {
          const probeStartAt = Date.now();
          sessionSpecLink = await probeSessionSpecLinkWithTimeout(
            workspace.id,
            workspace.path,
            "custom",
            customSpecRoot,
          );
          const probeDurationMs = Date.now() - probeStartAt;
          sessionSpecLinkByThreadRef.current.set(sessionSpecKey, sessionSpecLink);
          onDebug?.({
            id: `${Date.now()}-spec-root-probe`,
            timestamp: Date.now(),
            source: "client",
            label: "specRoot/probe",
            payload: {
              workspaceId: workspace.id,
              threadId,
              engine: resolvedEngine,
              source: "custom",
              rootPath: customSpecRoot,
              status: sessionSpecLink.status,
              reason: sessionSpecLink.reason,
              durationMs: probeDurationMs,
            },
          });
        }
        const shouldInjectSpecRootHintInPrompt =
          resolvedEngine === "codex" &&
          Boolean(sessionSpecLink) &&
          threadItems.length === 0;
        const codexEffectiveText =
          shouldInjectSpecRootHintInPrompt && sessionSpecLink
            ? buildCodexTextWithSpecRootPriority(finalText, sessionSpecLink)
            : finalText;
        const shouldInjectSpecRootCard =
          resolvedEngine === "codex" &&
          Boolean(sessionSpecLink) &&
          threadItems.length === 0;
        if (shouldInjectSpecRootCard && sessionSpecLink) {
          const statusLabel = sessionSpecLink.status;
          const priorityDetail =
            sessionSpecLink.status === "visible"
              ? t("threads.specRootContext.priorityDetail")
              : "Linked root is not usable. Resolve link before relying on fallback inference.";
          const entries: { kind: "read" | "search" | "list" | "run"; label: string; detail?: string }[] = [
            {
              kind: "list",
              label: t("threads.specRootContext.activeRoot"),
              detail: sessionSpecLink.rootPath,
            },
            {
              kind: "list",
              label: "Probe status",
              detail: statusLabel,
            },
            {
              kind: "read",
              label: t("threads.specRootContext.priorityLabel"),
              detail: priorityDetail,
            },
          ];
          if (sessionSpecLink.reason) {
            entries.push({
              kind: "read",
              label: "Failure reason",
              detail: sessionSpecLink.reason,
            });
          }
          if (sessionSpecLink.status !== "visible") {
            entries.push(
              {
                kind: "run",
                label: "/spec-root rebind",
                detail: "Rebind to latest Spec Hub path and re-probe.",
              },
              {
                kind: "run",
                label: "/spec-root default",
                detail: "Restore workspace default openspec path and re-probe.",
              },
            );
          }
          dispatch({
            type: "upsertItem",
            workspaceId: workspace.id,
            threadId,
            item: {
              id: `spec-root-context-${threadId}`,
              kind: "explore",
              status: "explored",
              title: t("threads.specRootContext.title"),
              collapsible: true,
              mergeKey: "spec-root-context",
              entries,
            },
            hasCustomName: Boolean(getCustomName(workspace.id, threadId)),
          });
        }
        const realSessionId =
          resolvedEngine === "claude" && isClaudeSession
            ? threadId.slice("claude:".length)
            : resolvedEngine === "claude" && threadId.startsWith("claude-pending-")
              ? (claudeSessionIdByPendingThreadRef.current.get(threadId) ?? null)
            : resolvedEngine === "gemini" && threadId.startsWith("gemini:")
              ? threadId.slice("gemini:".length)
            : resolvedEngine === "gemini" && threadId.startsWith("gemini-pending-")
              ? (geminiSessionIdByPendingThreadRef.current.get(threadId) ?? null)
            : resolvedEngine === "opencode" && isOpenCodeSession
              ? threadId.slice("opencode:".length)
              : null;
        const shouldAttachCliSpecRootHint = realSessionId === null && Boolean(customSpecRoot);

        if (cliEngine) {
          // Claude/OpenCode: backend only streams assistant/tool events, so add user item locally.
          if (!options?.suppressUserMessageRender) {
            const userMessageId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            dispatch({
              type: "upsertItem",
              workspaceId: workspace.id,
              threadId,
              item: {
                id: userMessageId,
                kind: "message",
                role: "user",
                text: visibleUserText,
                images: images.length > 0 ? images : undefined,
                collaborationMode: userCollaborationMode,
                selectedAgentName,
                selectedAgentIcon,
              },
              hasCustomName: Boolean(getCustomName(workspace.id, threadId)),
            });
          }

          const sendRequestedAt = Date.now();
          response = await engineSendMessageService(workspace.id, {
            text: finalText,
            engine: resolvedEngine,
            model: modelForSend,
            effort: resolvedEffort,
            images: finalImages.length > 0 ? finalImages : null,
            accessMode: resolvedAccessMode,
            continueSession: realSessionId !== null,
            sessionId: realSessionId,
            threadId: threadId,
            agent: resolvedOpenCodeAgent,
            variant: resolvedOpenCodeVariant,
            ...(customSpecRoot && shouldAttachCliSpecRootHint ? { customSpecRoot } : {}),
          });

          onDebug?.({
            id: `${Date.now()}-server-turn-start`,
            timestamp: Date.now(),
            source: "server",
            label: `turn/start response (${cliEngine})`,
            payload: response,
          });

        const rpcError = extractRpcErrorMessage(response);
        if (rpcError) {
          const stabilityDiagnostic = resolveThreadStabilityDiagnostic(rpcError);
          const normalized = mapNetworkErrorToUserMessage(rpcError, t);
          const claudeMcpHint =
            resolvedEngine === "claude" &&
            !normalized.isNetwork &&
              claudeMcpDiagnostics.length > 0
                ? `\n\n${claudeMcpDiagnostics.join("\n")}`
                : "";
            markProcessing(threadId, false);
            setActiveTurnId(threadId, null);
          pushThreadErrorMessage(
            threadId,
            normalized.isNetwork
              ? normalized.message
              : `${t("threads.turnFailedWithMessage", { message: normalized.message })}${claudeMcpHint}`,
          );
          pushThreadFailureRuntimeNotice({
            workspaceId: workspace.id,
            threadId,
            engine: resolvedEngine,
            message: normalized.message,
          });
          if (stabilityDiagnostic) {
            onDebug?.({
              id: `${Date.now()}-client-turn-start-stability-diagnostic`,
              timestamp: Date.now(),
              source: "client",
              label: "turn/start stability diagnostic",
              payload: {
                workspaceId: workspace.id,
                threadId,
                category: stabilityDiagnostic.category,
                rawMessage: stabilityDiagnostic.rawMessage,
                recoveryReason: stabilityDiagnostic.reconnectReason ?? null,
                stage: "rpc-error",
              },
            });
          }
          if (normalized.isNetwork) {
            pushErrorToast({
              title: t("common.error"),
                message: normalized.message,
                durationMs: 4800,
              });
            }
            safeMessageActivity();
            return;
          }

          if (resolvedEngine === "claude" && threadId.startsWith("claude-pending-")) {
            const responseSessionId = extractSessionIdFromEngineSendResponse(response);
            if (responseSessionId) {
              claudeSessionIdByPendingThreadRef.current.set(threadId, responseSessionId);
              onDebug?.({
                id: `${Date.now()}-client-claude-session-cache`,
                timestamp: Date.now(),
                source: "client",
                label: "thread/session cached",
                payload: {
                  workspaceId: workspace.id,
                  threadId,
                  sessionId: responseSessionId,
                  source: "engineSendMessageResponse",
                },
              });
            }
          }
          if (resolvedEngine === "gemini" && threadId.startsWith("gemini-pending-")) {
            let responseSessionId = extractSessionIdFromEngineSendResponse(response);
            if (!responseSessionId) {
              const workspacePath = workspace.path?.trim();
              if (workspacePath) {
                try {
                  const sessions = await listGeminiSessionsService(workspacePath, 6);
                  responseSessionId = pickLikelyGeminiSessionId(
                    sessions,
                    sendRequestedAt - 120_000,
                  );
                } catch {
                  responseSessionId = null;
                }
              }
            }
            if (responseSessionId) {
              geminiSessionIdByPendingThreadRef.current.set(threadId, responseSessionId);
              onDebug?.({
                id: `${Date.now()}-client-gemini-session-cache`,
                timestamp: Date.now(),
                source: "client",
                label: "thread/session cached",
                payload: {
                  workspaceId: workspace.id,
                  threadId,
                  sessionId: responseSessionId,
                  source: "geminiSessionListFallback",
                },
              });
            }
          }

          // Extract turn ID - streaming events will handle the rest
          const result = (response?.result ?? response) as Record<string, unknown>;
          const turn = (result?.turn ?? response?.turn ?? null) as
            | Record<string, unknown>
            | null;
          const turnId = asString(turn?.id ?? "");

          if (!turnId) {
            markProcessing(threadId, false);
            setActiveTurnId(threadId, null);
            pushThreadErrorMessage(threadId, t("threads.turnFailedToStart"));
            safeMessageActivity();
            return;
          }

          // Set active turn ID - useAppServerEvents will handle streaming deltas
          // and mark processing complete when turn/completed event arrives
          setActiveTurnId(threadId, turnId);

        } else {
          // Codex assistant/tool events are event-driven from backend.
          // User message bubble is inserted optimistically on send for instant feedback.
          const preferredLanguage = i18n.language.toLowerCase().startsWith("zh")
            ? "zh"
            : "en";
          response =
            (await sendUserMessageService(
              workspace.id,
              threadId,
              codexEffectiveText,
              {
                model: modelForSend,
                effort: resolvedEffort,
                collaborationMode: sanitizedCollaborationMode,
                accessMode: resolvedAccessMode,
                images: finalImages,
                preferredLanguage,
                resumeSource: options?.resumeSource,
                resumeTurnId: options?.resumeTurnId,
                ...(customSpecRoot ? { customSpecRoot } : {}),
              },
            )) as Record<string, unknown>;
        }

        onDebug?.({
          id: `${Date.now()}-server-turn-start`,
          timestamp: Date.now(),
          source: "server",
          label: "turn/start response",
          payload: response,
        });
        const rpcError = extractRpcErrorMessage(response);
        if (rpcError) {
          if (await retryCodexSendAfterThreadRefresh(rpcError)) {
            return;
          }
          const stabilityDiagnostic = resolveThreadStabilityDiagnostic(rpcError);
          const firstPacketTimeoutSeconds =
            resolveRecoverableCodexFirstPacketTimeout(resolvedEngine, rpcError);
          if (firstPacketTimeoutSeconds) {
            const warningMessage = t("threads.firstPacketTimeout", {
              seconds: firstPacketTimeoutSeconds,
            });
            onDebug?.({
              id: `${Date.now()}-client-turn-start-timeout-warning`,
              timestamp: Date.now(),
              source: "client",
              label: "turn/start delayed",
              payload: {
                threadId,
                engine: resolvedEngine,
                timeoutSeconds: firstPacketTimeoutSeconds,
              },
            });
            pushErrorToast({
              title: t("common.warning"),
              message: warningMessage,
              durationMs: 4800,
            });
            pushThreadErrorMessage(threadId, warningMessage);
            markProcessing(threadId, false);
            setActiveTurnId(threadId, null);
            safeMessageActivity();
            return;
          }
          const normalized = mapNetworkErrorToUserMessage(rpcError, t);
          markProcessing(threadId, false);
          setActiveTurnId(threadId, null);
          pushThreadErrorMessage(
            threadId,
            normalized.isNetwork
              ? normalized.message
              : t("threads.turnFailedToStartWithMessage", { message: normalized.message }),
          );
          pushThreadFailureRuntimeNotice({
            workspaceId: workspace.id,
            threadId,
            engine: resolvedEngine,
            message: normalized.message,
          });
          if (stabilityDiagnostic) {
            onDebug?.({
              id: `${Date.now()}-client-turn-start-stability-diagnostic`,
              timestamp: Date.now(),
              source: "client",
              label: "turn/start stability diagnostic",
              payload: {
                workspaceId: workspace.id,
                threadId,
                category: stabilityDiagnostic.category,
                rawMessage: stabilityDiagnostic.rawMessage,
                recoveryReason: stabilityDiagnostic.reconnectReason ?? null,
                stage: "rpc-error",
              },
            });
          }
          if (normalized.isNetwork) {
            pushErrorToast({
              title: t("common.error"),
              message: normalized.message,
              durationMs: 4800,
            });
          }
          safeMessageActivity();
          return;
        }
        const result = (response?.result ?? response) as Record<string, unknown>;
        const turn = (result?.turn ?? response?.turn ?? null) as
          | Record<string, unknown>
          | null;
        const turnId = asString(turn?.id ?? "");
        if (!turnId) {
          markProcessing(threadId, false);
          setActiveTurnId(threadId, null);
          pushThreadErrorMessage(threadId, t("threads.turnFailedToStart"));
          safeMessageActivity();
          return;
        }
        setActiveTurnId(threadId, turnId);
        if (resolvedEngine === "codex") {
          dispatch({
            type: "markCodexAcceptedTurn",
            threadId,
            fact: "accepted",
            source: "turn-start-response",
            timestamp: Date.now(),
          });
          if (shouldDeferCodexDraftActivity) {
            const acceptedTimestamp = Date.now();
            recordThreadActivity(workspace.id, threadId, acceptedTimestamp);
            dispatch({
              type: "setThreadTimestamp",
              workspaceId: workspace.id,
              threadId,
              timestamp: acceptedTimestamp,
            });
          }
        }

        void projectMemoryCaptureAutoService({
          workspaceId: workspace.id,
          text: visibleUserText,
          threadId,
          messageId: turnId,
          source: "composer_send",
          workspaceName: workspace.name ?? null,
          workspacePath: workspace.path ?? null,
          engine: resolvedEngine,
        })
          .then((captured) => {
            onInputMemoryCaptured?.({
              workspaceId: workspace.id,
              threadId,
              turnId,
              inputText: visibleUserText,
              memoryId: captured?.id ?? null,
              workspaceName: workspace.name ?? null,
              workspacePath: workspace.path ?? null,
              engine: resolvedEngine,
            });
          })
          .catch((err) => {
            if (shouldEmitThreadMessagingDevLogs) {
              console.warn("[project-memory] auto capture failed:", err);
            }
          });
        }
      } catch (error) {
        const rawMessage = error instanceof Error ? error.message : String(error);
        if (await retryCodexSendAfterThreadRefresh(rawMessage)) {
          return;
        }
        const stabilityDiagnostic = resolveThreadStabilityDiagnostic(rawMessage);
        const firstPacketTimeoutSeconds =
          resolveRecoverableCodexFirstPacketTimeout(resolvedEngine, rawMessage);
        if (firstPacketTimeoutSeconds) {
          const warningMessage = t("threads.firstPacketTimeout", {
            seconds: firstPacketTimeoutSeconds,
          });
          onDebug?.({
            id: `${Date.now()}-client-turn-start-timeout-warning`,
            timestamp: Date.now(),
            source: "client",
            label: "turn/start delayed",
            payload: {
              threadId,
              engine: resolvedEngine,
              timeoutSeconds: firstPacketTimeoutSeconds,
            },
          });
          pushErrorToast({
            title: t("common.warning"),
            message: warningMessage,
            durationMs: 4800,
          });
          pushThreadErrorMessage(threadId, warningMessage);
          markProcessing(threadId, false);
          setActiveTurnId(threadId, null);
          safeMessageActivity();
          return;
        }
        const normalized = mapNetworkErrorToUserMessage(rawMessage, t);
        markProcessing(threadId, false);
        setActiveTurnId(threadId, null);
        onDebug?.({
          id: `${Date.now()}-client-turn-start-error`,
          timestamp: Date.now(),
          source: "error",
          label: "turn/start error",
          payload: {
            rawMessage,
            category: stabilityDiagnostic?.category ?? null,
            recoveryReason: stabilityDiagnostic?.reconnectReason ?? null,
          },
        });
        pushThreadErrorMessage(threadId, normalized.message);
        if (normalized.isNetwork) {
          pushErrorToast({
            title: t("common.error"),
            message: normalized.message,
            durationMs: 4800,
          });
        }
        safeMessageActivity();
      }
    },
    [
      accessMode,
      activeEngine,
      collaborationMode,
      customPrompts,
      codexAcceptedTurnByThread,
      dispatch,
      effort,
      getCustomName,
      markProcessing,
      model,
      onDebug,
      onInputMemoryCaptured,
      itemsByThread,
      interruptedThreadsRef,
      pendingInterruptsRef,
      pushThreadErrorMessage,
      recordThreadActivity,
      resolveThreadKind,
      resolveThreadEngine,
      resolveOpenCodeAgent,
      resolveOpenCodeVariant,
      refreshThread,
      safeMessageActivity,
      setActiveTurnId,
      startThreadForMessageSend,
      i18n,
      steerEnabled,
      t,
      threadStatusById,
    ],
  );

  const sendUserMessage = useCallback(
    async (text: string, images: string[] = [], options?: SendMessageOptions) => {
      if (!activeWorkspace) {
        return;
      }
      const messageText = text.trim();
      if (!messageText && images.length === 0) {
        return;
      }
      const promptExpansion = expandCustomPromptText(messageText, customPrompts);
      if (promptExpansion && "error" in promptExpansion) {
        if (activeThreadId) {
          pushThreadErrorMessage(activeThreadId, promptExpansion.error);
          safeMessageActivity();
        } else {
          onDebug?.({
            id: `${Date.now()}-client-prompt-expand-error`,
            timestamp: Date.now(),
            source: "error",
            label: "prompt/expand error",
            payload: promptExpansion.error,
          });
        }
        return;
      }
      const finalText = promptExpansion?.expanded ?? messageText;

      // Detect engine switch from the selected engine to thread ownership.
      const currentEngine = normalizeEngineSelection(activeEngine);
      if (activeThreadId) {
        const storedThreadEngine = getThreadEngine(activeWorkspace.id, activeThreadId);
        const threadKind = resolveThreadKind(activeWorkspace.id, activeThreadId);
        const threadEngine = resolveThreadEngine(activeWorkspace.id, activeThreadId);
        const threadIdCompatible = isThreadIdCompatibleWithEngine(
          currentEngine,
          activeThreadId,
        );
        if (threadKind === "shared") {
          await sendMessageToThread(activeWorkspace, activeThreadId, finalText, images, {
            ...options,
            skipPromptExpansion: true,
          });
          return;
        }
        // If current thread differs from current selection, or threadId prefix is incompatible, create a new thread.
        if (threadEngine !== currentEngine || !threadIdCompatible) {
          onDebug?.({
            id: `${Date.now()}-client-engine-switch`,
            timestamp: Date.now(),
            source: "client",
            label: "engine/switch",
            payload: {
              workspaceId: activeWorkspace.id,
              oldThreadId: activeThreadId,
              oldEngineFromStore: storedThreadEngine ?? null,
              oldEngine: threadEngine,
              newEngine: currentEngine,
              threadIdCompatible,
            },
          });
          // Create a new thread with the current engine
          const newThreadId = await startThreadForMessageSend(
            activeWorkspace,
            currentEngine,
          );
          if (!newThreadId) {
            return;
          }
          // Send message to the new thread
          await sendMessageToThread(activeWorkspace, newThreadId, finalText, images, {
            ...options,
            skipPromptExpansion: true,
          });
          return;
        }
      }

      // No engine switch, proceed normally
      const threadId = activeThreadId
        ? await ensureThreadForActiveWorkspace()
        : await startThreadForMessageSend(activeWorkspace, currentEngine);
      if (!threadId) {
        return;
      }
      await sendMessageToThread(activeWorkspace, threadId, finalText, images, {
        ...options,
        skipPromptExpansion: true,
      });
    },
    [
      activeEngine,
      activeThreadId,
      activeWorkspace,
      customPrompts,
      ensureThreadForActiveWorkspace,
      isThreadIdCompatibleWithEngine,
      normalizeEngineSelection,
      onDebug,
      pushThreadErrorMessage,
      getThreadEngine,
      resolveThreadKind,
      resolveThreadEngine,
      safeMessageActivity,
      sendMessageToThread,
      startThreadForMessageSend,
    ],
  );

  const sendUserMessageToThread = useCallback(
    async (
      workspace: WorkspaceInfo,
      threadId: string,
      text: string,
      images: string[] = [],
      options?: SendMessageOptions,
    ) => {
      await sendMessageToThread(workspace, threadId, text, images, options);
    },
    [sendMessageToThread],
  );

  const handleFusionStalled = useCallback(
    (threadId: string, options?: HandleFusionStalledOptions) => {
      if (!activeWorkspace || !threadId) {
        return;
      }
      dispatch({
        type: "settleThreadPlanInProgress",
        threadId,
        targetStatus: "pending",
      });
      dispatch({
        type: "markContextCompacting",
        threadId,
        isCompacting: false,
        timestamp: Date.now(),
      });
      markProcessing(threadId, false);
      markReviewing(threadId, false);
      setActiveTurnId(threadId, null);
      pushThreadErrorMessage(
        threadId,
        options?.message?.trim() || t("threads.fusionTurnStalled"),
      );
      safeMessageActivity();
    },
    [
      activeWorkspace,
      dispatch,
      markProcessing,
      markReviewing,
      pushThreadErrorMessage,
      safeMessageActivity,
      setActiveTurnId,
      t,
    ],
  );

  const interruptTurn = useCallback(async (options?: InterruptTurnOptions) => {
    if (!activeWorkspace || !activeThreadId) {
      return;
    }
    const reason = options?.reason ?? "user-stop";
    const activeTurnId = activeTurnIdByThread[activeThreadId] ?? null;
    const activeThreadIsProcessing =
      threadStatusById[activeThreadId]?.isProcessing ?? false;
    if (!activeTurnId && !activeThreadIsProcessing) {
      onDebug?.({
        id: `${Date.now()}-client-turn-interrupt-skipped`,
        timestamp: Date.now(),
        source: "client",
        label: "turn/interrupt skipped",
        payload: {
          workspaceId: activeWorkspace.id,
          threadId: activeThreadId,
          reason,
          cause: "no-active-or-processing-turn",
        },
      });
      return;
    }
    const turnId = activeTurnId ?? "pending";
    // Mark this thread as interrupted so late-arriving delta events are ignored
    interruptedThreadsRef.current.add(activeThreadId);
    markProcessing(activeThreadId, false);
    setActiveTurnId(activeThreadId, null);
    const interruptNotice =
      reason === "queue-fusion"
        ? t("threads.sessionStoppedForFusion")
        : reason === "plan-handoff"
          ? null
          : t("threads.sessionStopped");
    if (interruptNotice) {
      dispatch({
        type: "addAssistantMessage",
        threadId: activeThreadId,
        text: interruptNotice,
      });
    }
    if (!activeTurnId) {
      pendingInterruptsRef.current.add(activeThreadId);
    }

    // Determine whether this thread is backed by a local CLI session.
    const resolvedThreadEngine = resolveThreadEngine(activeWorkspace.id, activeThreadId);
    const isCliManagedEngine = resolvedThreadEngine !== "codex";

    onDebug?.({
      id: `${Date.now()}-client-turn-interrupt`,
      timestamp: Date.now(),
      source: "client",
      label: "turn/interrupt",
      payload: {
        workspaceId: activeWorkspace.id,
        threadId: activeThreadId,
        turnId,
        queued: !activeTurnId,
        engine: resolvedThreadEngine,
        reason,
      },
    });
    try {
      if (isCliManagedEngine) {
        // Claude/OpenCode/Gemini: target only the current turn process.
        // If turn id is not known yet, keep pending interrupt and let onTurnStarted
        // execute a precise kill once the backend emits the real turn id.
        if (activeTurnId) {
          try {
            await engineInterruptTurnService(
              activeWorkspace.id,
              activeTurnId,
              resolvedThreadEngine,
            );
          } catch (error) {
            if (isUnknownEngineInterruptTurnMethodError(error)) {
              // Compatibility fallback for stale daemon/runtime that doesn't
              // implement engine_interrupt_turn yet.
              await engineInterruptService(activeWorkspace.id);
            } else {
              throw error;
            }
          }
        }
      } else {
        // Codex: notify daemon via turn_interrupt RPC, plus engine_interrupt fallback.
        await Promise.allSettled([
          interruptTurnService(
            activeWorkspace.id,
            activeThreadId,
            turnId,
          ),
          engineInterruptService(activeWorkspace.id),
        ]);
      }
      onDebug?.({
        id: `${Date.now()}-server-turn-interrupt`,
        timestamp: Date.now(),
        source: "server",
        label: "turn/interrupt response",
        payload: { success: true },
      });
    } catch (error) {
      onDebug?.({
        id: `${Date.now()}-client-turn-interrupt-error`,
        timestamp: Date.now(),
        source: "error",
        label: "turn/interrupt error",
        payload: error instanceof Error ? error.message : String(error),
      });
    }
  }, [
    activeThreadId,
    activeTurnIdByThread,
    activeWorkspace,
    dispatch,
    interruptedThreadsRef,
    markProcessing,
    onDebug,
    pendingInterruptsRef,
    resolveThreadEngine,
    setActiveTurnId,
    t,
    threadStatusById,
  ]);

  const startReviewTarget = useCallback(
    async (target: ReviewTarget, workspaceIdOverride?: string): Promise<boolean> => {
      const workspaceId = workspaceIdOverride ?? activeWorkspace?.id ?? null;
      if (!workspaceId) {
        return false;
      }
      let threadId = workspaceIdOverride
        ? await ensureThreadForWorkspace(workspaceId)
        : await ensureThreadForActiveWorkspace();
      if (!threadId) {
        return false;
      }
      const reviewExecutionEngine: "claude" | "codex" =
        activeEngine === "claude" ? "claude" : "codex";
      const threadEngine = resolveThreadEngine(workspaceId, threadId);
      const threadIdCompatible = isThreadIdCompatibleWithEngine(
        reviewExecutionEngine,
        threadId,
      );
      if (threadEngine !== reviewExecutionEngine || !threadIdCompatible) {
        onDebug?.({
          id: `${Date.now()}-client-review-thread-rebind`,
          timestamp: Date.now(),
          source: "client",
          label: "review/thread rebind",
          payload: {
            workspaceId,
            originalThreadId: threadId,
            originalThreadEngine: threadEngine,
            threadIdCompatible,
            targetEngine: reviewExecutionEngine,
          },
        });
        const reviewThreadId = await startThreadForWorkspace(workspaceId, {
          activate: workspaceId === activeWorkspace?.id,
          engine: reviewExecutionEngine,
        });
        if (!reviewThreadId) {
          return false;
        }
        threadId = reviewThreadId;
      }

      if (reviewExecutionEngine === "claude") {
        const reviewWorkspace =
          activeWorkspace && activeWorkspace.id === workspaceId ? activeWorkspace : null;
        if (!reviewWorkspace) {
          return false;
        }
        const reviewCommand = buildReviewCommandText(target);
        onDebug?.({
          id: `${Date.now()}-client-review-start`,
          timestamp: Date.now(),
          source: "client",
          label: "review/start (cli command)",
          payload: {
            workspaceId,
            threadId,
            target,
            command: reviewCommand,
            engine: "claude",
          },
        });
        await sendMessageToThread(reviewWorkspace, threadId, reviewCommand, [], {
          skipPromptExpansion: true,
        });
        return true;
      }

      markProcessing(threadId, true);
      markReviewing(threadId, true);
      safeMessageActivity();
      let reviewThreadId = threadId;
      onDebug?.({
        id: `${Date.now()}-client-review-start`,
        timestamp: Date.now(),
        source: "client",
        label: "review/start",
        payload: {
          workspaceId,
          threadId,
          target,
        },
      });
      try {
        const runStartReview = async (
          targetThreadId: string,
          label: "review/start response" | "review/start retry response" = "review/start response",
        ) => {
          const response = await startReviewService(
            workspaceId,
            targetThreadId,
            target,
            "inline",
          );
          onDebug?.({
            id: `${Date.now()}-server-review-start`,
            timestamp: Date.now(),
            source: "server",
            label,
            payload: response,
          });
          return response;
        };

        let response = await runStartReview(reviewThreadId);
        let rpcError = extractRpcErrorMessage(response);

        if (rpcError && isInvalidReviewThreadIdError(rpcError)) {
          const fallbackThreadId = await startThreadForWorkspace(workspaceId, {
            activate: workspaceId === activeWorkspace?.id,
            engine: "codex",
          });
          if (fallbackThreadId && fallbackThreadId !== reviewThreadId) {
            onDebug?.({
              id: `${Date.now()}-client-review-thread-retry`,
              timestamp: Date.now(),
              source: "client",
              label: "review/thread retry",
              payload: {
                workspaceId,
                originalThreadId: reviewThreadId,
                fallbackThreadId,
                reason: rpcError,
              },
            });
            markProcessing(reviewThreadId, false);
            markReviewing(reviewThreadId, false);
            reviewThreadId = fallbackThreadId;
            markProcessing(reviewThreadId, true);
            markReviewing(reviewThreadId, true);
            response = await runStartReview(reviewThreadId, "review/start retry response");
            rpcError = extractRpcErrorMessage(response);
          }
        }
        if (rpcError) {
          markProcessing(reviewThreadId, false);
          markReviewing(reviewThreadId, false);
          setActiveTurnId(reviewThreadId, null);
          pushThreadErrorMessage(reviewThreadId, `Review failed to start: ${rpcError}`);
          safeMessageActivity();
          return false;
        }
        return true;
      } catch (error) {
        markProcessing(reviewThreadId, false);
        markReviewing(reviewThreadId, false);
        onDebug?.({
          id: `${Date.now()}-client-review-start-error`,
          timestamp: Date.now(),
          source: "error",
          label: "review/start error",
          payload: error instanceof Error ? error.message : String(error),
        });
        pushThreadErrorMessage(
          reviewThreadId,
          error instanceof Error ? error.message : String(error),
        );
        safeMessageActivity();
        return false;
      }
    },
    [
      activeEngine,
      activeWorkspace,
      ensureThreadForActiveWorkspace,
      ensureThreadForWorkspace,
      isThreadIdCompatibleWithEngine,
      markProcessing,
      markReviewing,
      onDebug,
      pushThreadErrorMessage,
      resolveThreadEngine,
      safeMessageActivity,
      sendMessageToThread,
      setActiveTurnId,
      startThreadForWorkspace,
    ],
  );

  const {
    reviewPrompt,
    openReviewPrompt,
    closeReviewPrompt,
    showPresetStep,
    choosePreset,
    highlightedPresetIndex,
    setHighlightedPresetIndex,
    highlightedBranchIndex,
    setHighlightedBranchIndex,
    highlightedCommitIndex,
    setHighlightedCommitIndex,
    handleReviewPromptKeyDown,
    confirmBranch,
    selectBranch,
    selectBranchAtIndex,
    selectCommit,
    selectCommitAtIndex,
    confirmCommit,
    updateCustomInstructions,
    confirmCustom,
  } = useReviewPrompt({
    activeWorkspace,
    activeThreadId,
    onDebug,
    startReviewTarget,
  });

  const startReview = useCallback(
    async (text: string) => {
      if (!activeWorkspace || !text.trim()) {
        return;
      }
      const trimmed = text.trim();
      if (!trimmed.startsWith("/")) {
        return;
      }
      const commandToken = trimmed.slice(1).split(/\s+/, 1)[0]?.toLowerCase() ?? "";
      if (commandToken !== "review") {
        return;
      }
      const rest = trimmed.slice(commandToken.length + 1).trim();
      if (!rest) {
        openReviewPrompt();
        return;
      }

      const target = parseReviewTarget(trimmed);
      await startReviewTarget(target);
    },
    [
      activeWorkspace,
      openReviewPrompt,
      startReviewTarget,
    ],
  );

  const {
    startCompact,
    startContext,
    startExport,
    startFast,
    startFork,
    startImport,
    startLsp,
    startMcp,
    startMode,
    startResume,
    startShare,
    startSpecRoot,
    startStatus,
  } = useThreadMessagingSessionTooling({
    activeThreadId,
    activeWorkspace,
    accessMode,
    collaborationMode,
    dispatch,
    effort,
    ensureThreadForActiveWorkspace,
    forkThreadForWorkspace,
    getCustomName,
    isThreadIdCompatibleWithEngine,
    model,
    onDebug,
    pushThreadErrorMessage,
    rateLimitsByWorkspace,
    recordThreadActivity,
    refreshThread,
    resolveCollaborationRuntimeMode,
    resolveThreadEngine,
    safeMessageActivity,
    sendMessageToThread,
    sessionSpecLinkByThreadRef,
    t,
    threadStatusById,
    codexCompactionInFlightByThreadRef: effectiveCodexCompactionInFlightByThreadRef,
    tokenUsageByThread,
    updateThreadParent,
  });

  return {
    handleFusionStalled,
    interruptTurn,
    sendUserMessage,
    sendUserMessageToThread,
    startFork,
    startReview,
    startResume,
    startMcp,
    startSpecRoot,
    startStatus,
    startContext,
    startCompact,
    startFast,
    startMode,
    startExport,
    startImport,
    startLsp,
    startShare,
    reviewPrompt,
    openReviewPrompt,
    closeReviewPrompt,
    showPresetStep,
    choosePreset,
    highlightedPresetIndex,
    setHighlightedPresetIndex,
    highlightedBranchIndex,
    setHighlightedBranchIndex,
    highlightedCommitIndex,
    setHighlightedCommitIndex,
    handleReviewPromptKeyDown,
    confirmBranch,
    selectBranch,
    selectBranchAtIndex,
    selectCommit,
    selectCommitAtIndex,
    confirmCommit,
    updateCustomInstructions,
    confirmCustom,
  };
}
