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
  listMcpServerStatus as listMcpServerStatusService,
  engineSendMessage as engineSendMessageService,
  engineInterrupt as engineInterruptService,
  exportOpenCodeSession as exportOpenCodeSessionService,
  getOpenCodeLspDiagnostics as getOpenCodeLspDiagnosticsService,
  getOpenCodeLspDocumentSymbols as getOpenCodeLspDocumentSymbolsService,
  getOpenCodeLspSymbols as getOpenCodeLspSymbolsService,
  getOpenCodeMcpStatus as getOpenCodeMcpStatusService,
  getOpenCodeStats as getOpenCodeStatsService,
  importOpenCodeSession as importOpenCodeSessionService,
  listGeminiSessions as listGeminiSessionsService,
  shareOpenCodeSession as shareOpenCodeSessionService,
  projectMemoryCaptureAuto as projectMemoryCaptureAutoService,
} from "../../../services/tauri";
import { sendSharedSessionTurn } from "../../shared-session/runtime/sendSharedSessionTurn";
import { projectMemoryFacade } from "../../project-memory/services/projectMemoryFacade";
import {
  injectSelectedMemoriesContext,
  type InjectionResult,
} from "../../project-memory/utils/memoryContextInjection";
import { MEMORY_CONTEXT_SUMMARY_PREFIX } from "../../project-memory/utils/memoryMarkers";
import { writeClientStoreValue } from "../../../services/clientStorage";
import { expandCustomPromptText } from "../../../utils/customPrompts";
import {
  asString,
  extractRpcErrorMessage,
  parseReviewTarget,
} from "../utils/threadNormalize";
import type { ThreadAction, ThreadState } from "./useThreadsReducer";
import { useReviewPrompt } from "./useReviewPrompt";
import { formatRelativeTime } from "../../../utils/time";
import { pushErrorToast } from "../../../services/toasts";
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
  buildDefaultSpecRootPath,
  isAbsoluteHostPath,
  normalizeExtendedWindowsPath,
  probeSessionSpecLink,
  probeSessionSpecLinkWithTimeout,
  resolveWorkspaceSpecRoot,
  shouldProbeSessionSpecForEngine,
  toFileUriFromAbsolutePath,
  type SessionSpecLinkContext,
  type SessionSpecLinkSource,
} from "./threadMessagingSpecRoot";
import {
  buildReviewCommandText,
  extractSessionIdFromEngineSendResponse,
  isInvalidReviewThreadIdError,
  isLikelyForeignModelForGemini,
  isUnknownEngineInterruptTurnMethodError,
  isValidClaudeModelForPassthrough,
  mapNetworkErrorToUserMessage,
  normalizeAccessMode,
  pickLikelyGeminiSessionId,
  resolveCollaborationModeIdFromPayload,
  resolveRecoverableCodexFirstPacketTimeout,
} from "./threadMessagingHelpers";

type SendMessageOptions = {
  skipPromptExpansion?: boolean;
  skipOptimisticUserBubble?: boolean;
  suppressUserMessageRender?: boolean;
  model?: string | null;
  effort?: string | null;
  collaborationMode?: Record<string, unknown> | null;
  accessMode?: AccessMode;
  selectedMemoryIds?: string[];
  selectedMemoryInjectionMode?: MemoryContextInjectionMode;
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

const AGENT_PROMPT_HEADER = "## Agent Role and Instructions";
const AGENT_PROMPT_NAME_PREFIX = "Agent Name:";
const AGENT_PROMPT_ICON_PREFIX = "Agent Icon:";

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
  tokenUsageByThread: Record<string, ThreadTokenUsage>;
  rateLimitsByWorkspace: Record<string, RateLimitSnapshot | null>;
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
  tokenUsageByThread,
  rateLimitsByWorkspace,
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
}: UseThreadMessagingOptions) {
  const { t, i18n } = useTranslation();
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
      let injectionResult: InjectionResult = {
        finalText,
        injectedCount: 0,
        injectedChars: 0,
        retrievalMs: 0,
        previewText: null,
        disabledReason: null,
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
        resolvedEngine === "claude" &&
        resolvedModel &&
        !isValidClaudeModelForPassthrough(resolvedModel)
          ? null
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
      if (resolvedEngine === "claude" && resolvedModel && !sanitizedModel) {
        onDebug?.({
          id: `${Date.now()}-client-model-sanitize`,
          timestamp: Date.now(),
          source: "client",
          label: "model/sanitize",
          payload: {
            reason: "invalid-claude-model",
            model: resolvedModel,
          },
        });
        if (import.meta.env.DEV) {
          console.warn("[model/sanitize]", {
            reason: "invalid-claude-model",
            model: resolvedModel,
          });
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
      if (import.meta.env.DEV) {
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
      if (shouldAddOptimisticUserBubble) {
        const optimisticText = visibleUserText;
        if (optimisticText || images.length > 0) {
          optimisticUserItem = {
            id: `optimistic-user-${Date.now()}-${Math.random()
              .toString(36)
              .slice(2, 8)}`,
            kind: "message",
            role: "user",
            text: optimisticText,
            images: images.length > 0 ? images : undefined,
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
        }
      }
      const timestamp = Date.now();
      const effectiveResolvedEngine = resolvedEngine;
      recordThreadActivity(workspace.id, threadId, timestamp);
      dispatch({
        type: "setThreadTimestamp",
        workspaceId: workspace.id,
        threadId,
        timestamp,
      });
      if (pendingInterruptsRef.current.has(threadId)) {
        pendingInterruptsRef.current.delete(threadId);
      }
      if (interruptedThreadsRef.current.has(threadId)) {
        interruptedThreadsRef.current.delete(threadId);
      }
      markProcessing(threadId, true);
      safeMessageActivity();
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
          images,
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
      if (import.meta.env.DEV) {
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
          hasImages: images.length > 0,
        });
      }
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
              images,
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
            images: images.length > 0 ? images : null,
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
                images,
                preferredLanguage,
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
          if (
            resolvedEngine === "codex" &&
            !options?.codexInvalidThreadRetryAttempted &&
            isInvalidReviewThreadIdError(rpcError)
          ) {
            const reboundThreadId = await refreshThread(workspace.id, threadId);
            if (reboundThreadId) {
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
                  reason: rpcError,
                },
              });
              if (reboundThreadId !== threadId) {
                dispatch({
                  type: "setActiveThreadId",
                  workspaceId: workspace.id,
                  threadId: reboundThreadId,
                });
                if (optimisticUserItem) {
                  dispatch({
                    type: "setThreadItems",
                    threadId,
                    items: (itemsByThread[threadId] ?? []).filter(
                      (item) => item.id !== optimisticUserItem?.id,
                    ),
                  });
                  dispatch({
                    type: "upsertItem",
                    workspaceId: workspace.id,
                    threadId: reboundThreadId,
                    item: optimisticUserItem,
                    hasCustomName: Boolean(getCustomName(workspace.id, reboundThreadId)),
                  });
                }
              }
              markProcessing(threadId, false);
              setActiveTurnId(threadId, null);
              safeMessageActivity();
              await sendMessageToThread(workspace, reboundThreadId, finalText, images, {
                skipPromptExpansion: true,
                skipOptimisticUserBubble: true,
                model: modelForSend,
                effort: resolvedEffort,
                collaborationMode: sanitizedCollaborationMode,
                accessMode: resolvedAccessMode,
                codexInvalidThreadRetryAttempted: true,
              });
              return;
            }
          }
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
            if (import.meta.env.DEV) {
              console.warn("[project-memory] auto capture failed:", err);
            }
          });
        }
      } catch (error) {
        const rawMessage = error instanceof Error ? error.message : String(error);
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
          payload: rawMessage,
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
      dispatch,
      effort,
      getCustomName,
      markProcessing,
      model,
      onDebug,
      itemsByThread,
      pushThreadErrorMessage,
      recordThreadActivity,
      resolveThreadEngine,
      resolveOpenCodeAgent,
      resolveOpenCodeVariant,
      refreshThread,
      safeMessageActivity,
      setActiveTurnId,
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
          const newThreadId = await startThreadForWorkspace(activeWorkspace.id, {
            activate: true,
            engine: currentEngine,
          });
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
      const threadId = await ensureThreadForActiveWorkspace();
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
      resolveThreadEngine,
      safeMessageActivity,
      sendMessageToThread,
      startThreadForWorkspace,
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

  const interruptTurn = useCallback(async (options?: InterruptTurnOptions) => {
    if (!activeWorkspace || !activeThreadId) {
      return;
    }
    const reason = options?.reason ?? "user-stop";
    const activeTurnId = activeTurnIdByThread[activeThreadId] ?? null;
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

  const startContext = useCallback(
    async (_text: string) => {
      if (!activeWorkspace) {
        return;
      }
      const threadId = await ensureThreadForActiveWorkspace();
      if (!threadId) {
        return;
      }

      const usage = tokenUsageByThread[threadId] ?? null;
      const formatTokenCount = (value: number) =>
        Math.max(0, Math.round(value)).toLocaleString("en-US");

      const noUsageLines = [
        "Context Usage",
        "",
        "No context usage telemetry yet for this thread.",
        "Send at least one turn, then run /context again.",
      ];

      if (!usage) {
        const timestamp = Date.now();
        recordThreadActivity(activeWorkspace.id, threadId, timestamp);
        dispatch({
          type: "addAssistantMessage",
          threadId,
          text: ["```text", ...noUsageLines, "```"].join("\n"),
        });
        safeMessageActivity();
        return;
      }

      const inputTokens = usage.last.inputTokens ?? 0;
      const cachedInputTokens = usage.last.cachedInputTokens ?? 0;
      const outputTokens = usage.last.outputTokens ?? 0;
      const reasoningOutputTokens = usage.last.reasoningOutputTokens ?? 0;
      const usedTokens = inputTokens + cachedInputTokens;
      const contextWindow = usage.modelContextWindow ?? null;
      const usedPercent = contextWindow && contextWindow > 0
        ? Math.min(Math.max((usedTokens / contextWindow) * 100, 0), 100)
        : null;
      const remainingPercent =
        usedPercent === null ? null : Math.max(0, 100 - usedPercent);

      const lines = [
        "Context Usage",
        "",
        `Thread:             ${threadId}`,
        `Used:               ${formatTokenCount(usedTokens)} tokens`,
        contextWindow && contextWindow > 0
          ? `Context window:     ${formatTokenCount(contextWindow)} tokens`
          : "Context window:     n/a",
        usedPercent === null
          ? "Used percent:       n/a"
          : `Used percent:       ${usedPercent.toFixed(1)}%`,
        remainingPercent === null
          ? "Remaining:          n/a"
          : `Remaining:          ${remainingPercent.toFixed(1)}%`,
        "",
        "Last turn breakdown:",
        `- Input:            ${formatTokenCount(inputTokens)}`,
        `- Cached input:     ${formatTokenCount(cachedInputTokens)}`,
        `- Output:           ${formatTokenCount(outputTokens)}`,
        `- Reasoning output: ${formatTokenCount(reasoningOutputTokens)}`,
        "",
        "Session totals:",
        `- Total tokens:     ${formatTokenCount(usage.total.totalTokens ?? 0)}`,
        `- Input tokens:     ${formatTokenCount(usage.total.inputTokens ?? 0)}`,
        `- Cached input:     ${formatTokenCount(usage.total.cachedInputTokens ?? 0)}`,
        `- Output tokens:    ${formatTokenCount(usage.total.outputTokens ?? 0)}`,
      ];

      const timestamp = Date.now();
      recordThreadActivity(activeWorkspace.id, threadId, timestamp);
      dispatch({
        type: "addAssistantMessage",
        threadId,
        text: ["```text", ...lines, "```"].join("\n"),
      });
      safeMessageActivity();
    },
    [
      activeWorkspace,
      dispatch,
      ensureThreadForActiveWorkspace,
      recordThreadActivity,
      safeMessageActivity,
      tokenUsageByThread,
    ],
  );

  const startStatus = useCallback(
    async (text: string) => {
      if (!activeWorkspace) {
        return;
      }
      const threadId = await ensureThreadForActiveWorkspace();
      if (!threadId) {
        return;
      }
      const resolvedThreadEngine = resolveThreadEngine(activeWorkspace.id, threadId);
      if (resolvedThreadEngine === "opencode") {
        try {
          const match = text.trim().match(/^\/status(?:\s+(\d+))?/i);
          const days = match?.[1] ? Number(match[1]) : null;
          const stats = await getOpenCodeStatsService(
            activeWorkspace.id,
            Number.isFinite(days as number) ? (days as number) : null,
          );
          const timestamp = Date.now();
          recordThreadActivity(activeWorkspace.id, threadId, timestamp);
          dispatch({
            type: "addAssistantMessage",
            threadId,
            text: `OpenCode stats:\n\n${stats}`,
          });
          safeMessageActivity();
        } catch (error) {
          pushThreadErrorMessage(
            threadId,
            error instanceof Error ? error.message : String(error),
          );
          safeMessageActivity();
        }
        return;
      }

      const rateLimits = rateLimitsByWorkspace[activeWorkspace.id] ?? null;
      const primaryUsed = rateLimits?.primary?.usedPercent;
      const secondaryUsed = rateLimits?.secondary?.usedPercent;
      const primaryReset = rateLimits?.primary?.resetsAt;
      const secondaryReset = rateLimits?.secondary?.resetsAt;
      const credits = rateLimits?.credits ?? null;

      const normalizeReset = (value?: number | null) => {
        if (typeof value !== "number" || !Number.isFinite(value)) {
          return null;
        }
        return value > 1_000_000_000_000 ? value : value * 1000;
      };

      const resetLabel = (value?: number | null) => {
        const resetAt = normalizeReset(value);
        return resetAt ? formatRelativeTime(resetAt) : null;
      };

      const collaborationModeId = resolveCollaborationModeIdFromPayload(
        collaborationMode,
      );

      const formatLimitLine = (
        label: string,
        usedPercent: number | null | undefined,
        resetAt: number | null | undefined,
      ): string[] => {
        if (typeof usedPercent !== "number" || Number.isNaN(usedPercent)) {
          return [`${label}: n/a`];
        }
        const clampedUsed = Math.max(0, Math.min(100, Math.round(usedPercent)));
        const remaining = Math.max(0, 100 - clampedUsed);
        const reset = resetLabel(resetAt);
        if (!reset) {
          return [`${label}: ${remaining}% left`];
        }
        return [`${label}: ${remaining}% left`, `  (resets ${reset})`];
      };

      const modelLabel = model ?? "gpt-5.3-codex";
      const effortLabel = effort ?? "medium";
      const permissionLabel =
        accessMode === "read-only"
          ? "Read Only"
          : accessMode === "full-access"
            ? "Full Access"
            : "Default";
      const collaborationLabel =
        collaborationModeId === "plan" ? "Plan Mode" : "Default";
      const sessionLabel = threadId.startsWith("opencode:")
        ? threadId.slice("opencode:".length)
        : threadId;

      const lines = [
        "OpenAI Codex",
        "",
        "Visit https://chatgpt.com/codex/settings/usage for up-to-date",
        "information on rate limits and credits",
        "",
        `Model:              ${modelLabel} (reasoning ${effortLabel})`,
        `Directory:          ${activeWorkspace.path || "~"}`,
        `Permissions:        ${permissionLabel}`,
        "Agents.md:          <none>",
        "Account:            <unknown>",
        `Collaboration mode: ${collaborationLabel}`,
        `Session:            ${sessionLabel}`,
        "",
        ...formatLimitLine("5h limit", primaryUsed, primaryReset),
        ...formatLimitLine("Weekly limit", secondaryUsed, secondaryReset),
      ];

      if (credits?.hasCredits) {
        if (credits.unlimited) {
          lines.push("Credits:            unlimited");
        } else if (credits.balance) {
          lines.push(`Credits:            ${credits.balance}`);
        }
      }

      const timestamp = Date.now();
      recordThreadActivity(activeWorkspace.id, threadId, timestamp);
      dispatch({
        type: "addAssistantMessage",
        threadId,
        text: ["```text", ...lines, "```"].join("\n"),
      });
      safeMessageActivity();
    },
    [
      accessMode,
      activeWorkspace,
      collaborationMode,
      dispatch,
      effort,
      ensureThreadForActiveWorkspace,
      model,
      pushThreadErrorMessage,
      rateLimitsByWorkspace,
      recordThreadActivity,
      resolveThreadEngine,
      safeMessageActivity,
    ],
  );

  const startMode = useCallback(
    async (_text: string) => {
      if (!activeWorkspace) {
        return;
      }
      const threadId = await ensureThreadForActiveWorkspace();
      if (!threadId) {
        return;
      }
      const selectedMode = resolveCollaborationModeIdFromPayload(
        collaborationMode,
      );
      const uiMode: "plan" | "default" =
        selectedMode === "plan" ? "plan" : "default";
      const runtimeMode =
        resolveCollaborationRuntimeMode?.(threadId) ??
        (selectedMode === "plan" ? "plan" : "code");
      const normalizedRuntimeMode: "plan" | "code" =
        runtimeMode === "plan" ? "plan" : "code";
      const uiModeLabel = uiMode === "plan" ? "Plan Mode（计划模式）" : "Default（默认模式）";
      const timestamp = Date.now();
      recordThreadActivity(activeWorkspace.id, threadId, timestamp);
      dispatch({
        type: "addAssistantMessage",
        threadId,
        text: [
          "```text",
          `当前产品模式: ${uiModeLabel}`,
          `运行时模式: ${normalizedRuntimeMode}`,
          `线程: ${threadId}`,
          "",
          "说明:",
          "- 这里的模式仅表示 Codex 产品能力（Plan/Default）。",
          "- AGENTS.md / PlanFirst 规则仍会照常读取，不会被该开关切换或关闭。",
          "```",
        ].join("\n"),
      });
      safeMessageActivity();
    },
    [
      activeWorkspace,
      collaborationMode,
      dispatch,
      ensureThreadForActiveWorkspace,
      recordThreadActivity,
      resolveCollaborationRuntimeMode,
      safeMessageActivity,
    ],
  );

  const startFast = useCallback(
    async (text: string) => {
      if (!activeWorkspace) {
        return;
      }
      const threadId = await ensureThreadForActiveWorkspace();
      if (!threadId) {
        return;
      }

      const match = text.trim().match(/^\/fast(?:\s+(on|off))?/i);
      const mode = match?.[1]?.toLowerCase();
      const normalizedCommand = mode === "on" || mode === "off" ? `/fast ${mode}` : "/fast";

      await sendMessageToThread(activeWorkspace, threadId, normalizedCommand, [], {
        skipPromptExpansion: true,
      });
    },
    [
      activeWorkspace,
      ensureThreadForActiveWorkspace,
      sendMessageToThread,
    ],
  );

  const startSpecRoot = useCallback(
    async (text: string) => {
      if (!activeWorkspace) {
        return;
      }
      const threadId = await ensureThreadForActiveWorkspace();
      if (!threadId) {
        return;
      }

      const actionRaw = text.trim().replace(/^\/spec-root\b/i, "").trim().toLowerCase();
      const action: "check" | "rebind" | "default" = actionRaw.startsWith("default")
        ? "default"
        : actionRaw.startsWith("rebind")
          ? "rebind"
          : "check";
      const specRootStorageKey = `specHub.specRoot.${activeWorkspace.id}`;
      const latestCustomSpecRoot = resolveWorkspaceSpecRoot(activeWorkspace.id);
      const resolvedCustomSpecRoot = action === "default" ? null : latestCustomSpecRoot;
      if (action === "default") {
        writeClientStoreValue("app", specRootStorageKey, null);
      }

      const source: SessionSpecLinkSource = resolvedCustomSpecRoot ? "custom" : "default";
      const rootPath = resolvedCustomSpecRoot ?? buildDefaultSpecRootPath(activeWorkspace.path);
      const probe = await probeSessionSpecLink(activeWorkspace.id, activeWorkspace.path, source, rootPath);
      sessionSpecLinkByThreadRef.current.set(`${activeWorkspace.id}:${threadId}`, probe);

      const entries: { kind: "read" | "search" | "list" | "run"; label: string; detail?: string }[] = [
        {
          kind: "list",
          label: t("threads.specRootContext.activeRoot"),
          detail: probe.rootPath,
        },
        {
          kind: "list",
          label: "Probe status",
          detail: probe.status,
        },
        {
          kind: "read",
          label: t("threads.specRootContext.priorityLabel"),
          detail:
            probe.status === "visible"
              ? t("threads.specRootContext.priorityDetail")
              : "Linked root is not usable. Resolve link before relying on fallback inference.",
        },
      ];
      if (probe.reason) {
        entries.push({
          kind: "read",
          label: "Failure reason",
          detail: probe.reason,
        });
      }
      if (probe.status !== "visible") {
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
        workspaceId: activeWorkspace.id,
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
        hasCustomName: Boolean(getCustomName(activeWorkspace.id, threadId)),
      });

      const lines = [
        "Spec root probe",
        `Action: ${action}`,
        `Source: ${probe.source}`,
        `Path: ${probe.rootPath}`,
        `Status: ${probe.status}`,
      ];
      if (probe.reason) {
        lines.push(`Reason: ${probe.reason}`);
      }
      if (probe.status !== "visible") {
        lines.push("Repair: /spec-root rebind | /spec-root default");
      }
      dispatch({
        type: "addAssistantMessage",
        threadId,
        text: ["```text", ...lines, "```"].join("\n"),
      });
      safeMessageActivity();
    },
    [activeWorkspace, dispatch, ensureThreadForActiveWorkspace, getCustomName, safeMessageActivity, t],
  );

  const resolveOpenCodeSessionId = useCallback((threadId: string, text: string): string | null => {
    if (threadId.startsWith("opencode:")) {
      return threadId.slice("opencode:".length);
    }
    const args = text.trim().split(/\s+/).slice(1);
    return args[0] ?? null;
  }, []);

  const normalizeCommandArg = useCallback((value: string) => {
    const trimmed = value.trim();
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      return trimmed.slice(1, -1).trim();
    }
    return trimmed;
  }, []);

  const resolveFileUri = useCallback(
    (rawPath: string) => {
      const cleaned = normalizeCommandArg(rawPath);
      if (cleaned.startsWith("file://")) {
        return cleaned;
      }
      if (!activeWorkspace) {
        return cleaned;
      }
      const normalizedInput = normalizeExtendedWindowsPath(cleaned).replace(/\\/g, "/");
      if (isAbsoluteHostPath(cleaned)) {
        return toFileUriFromAbsolutePath(normalizedInput);
      }
      const workspacePath = activeWorkspace.path.replace(/\\/g, "/").replace(/\/+$/, "");
      if (!workspacePath) {
        return cleaned;
      }
      const absolutePath = `${workspacePath}/${normalizedInput.replace(/^\/+/, "")}`;
      return toFileUriFromAbsolutePath(absolutePath);
    },
    [activeWorkspace, normalizeCommandArg],
  );

  const startExport = useCallback(
    async (text: string) => {
      if (!activeWorkspace) {
        return;
      }
      const threadId = await ensureThreadForActiveWorkspace();
      if (!threadId) {
        return;
      }
      const sessionId = resolveOpenCodeSessionId(threadId, text);
      if (!sessionId) {
        pushThreadErrorMessage(
          threadId,
          "OpenCode export requires an opencode session. Open an OpenCode thread first.",
        );
        safeMessageActivity();
        return;
      }
      try {
        const pathArg = text.trim().split(/\s+/).slice(2).join(" ").trim();
        const outputPath = pathArg.length > 0 ? pathArg : null;
        const result = await exportOpenCodeSessionService(
          activeWorkspace.id,
          sessionId,
          outputPath,
        );
        const timestamp = Date.now();
        recordThreadActivity(activeWorkspace.id, threadId, timestamp);
        dispatch({
          type: "addAssistantMessage",
          threadId,
          text: `Session exported:\n- session: ${result.sessionId}\n- file: ${result.filePath}`,
        });
        safeMessageActivity();
      } catch (error) {
        pushThreadErrorMessage(
          threadId,
          error instanceof Error ? error.message : String(error),
        );
        safeMessageActivity();
      }
    },
    [
      activeWorkspace,
      dispatch,
      ensureThreadForActiveWorkspace,
      pushThreadErrorMessage,
      recordThreadActivity,
      resolveOpenCodeSessionId,
      safeMessageActivity,
    ],
  );

  const startShare = useCallback(
    async (text: string) => {
      if (!activeWorkspace) {
        return;
      }
      const threadId = await ensureThreadForActiveWorkspace();
      if (!threadId) {
        return;
      }
      const sessionId = resolveOpenCodeSessionId(threadId, text);
      if (!sessionId) {
        pushThreadErrorMessage(
          threadId,
          "OpenCode share requires an opencode session. Open an OpenCode thread first.",
        );
        safeMessageActivity();
        return;
      }
      try {
        const result = await shareOpenCodeSessionService(activeWorkspace.id, sessionId);
        const timestamp = Date.now();
        recordThreadActivity(activeWorkspace.id, threadId, timestamp);
        dispatch({
          type: "addAssistantMessage",
          threadId,
          text: `Shared session link:\n${result.url}`,
        });
        safeMessageActivity();
      } catch (error) {
        pushThreadErrorMessage(
          threadId,
          error instanceof Error ? error.message : String(error),
        );
        safeMessageActivity();
      }
    },
    [
      activeWorkspace,
      dispatch,
      ensureThreadForActiveWorkspace,
      pushThreadErrorMessage,
      recordThreadActivity,
      resolveOpenCodeSessionId,
      safeMessageActivity,
    ],
  );

  const startImport = useCallback(
    async (text: string) => {
      if (!activeWorkspace) {
        return;
      }
      const threadId = await ensureThreadForActiveWorkspace();
      if (!threadId) {
        return;
      }
      const source = normalizeCommandArg(
        text.trim().split(/\s+/).slice(1).join(" ").trim(),
      );
      if (!source) {
        pushThreadErrorMessage(
          threadId,
          "Usage: /import <path-or-url>",
        );
        safeMessageActivity();
        return;
      }
      try {
        const result = await importOpenCodeSessionService(activeWorkspace.id, source);
        const importedSessionId =
          typeof result.sessionId === "string" ? result.sessionId : null;
        const importedThreadId = importedSessionId
          ? `opencode:${importedSessionId}`
          : null;
        const timestamp = Date.now();
        recordThreadActivity(activeWorkspace.id, threadId, timestamp);
        if (importedThreadId) {
          dispatch({
            type: "ensureThread",
            workspaceId: activeWorkspace.id,
            threadId: importedThreadId,
            engine: "opencode",
          });
          dispatch({
            type: "setThreadEngine",
            workspaceId: activeWorkspace.id,
            threadId: importedThreadId,
            engine: "opencode",
          });
          dispatch({
            type: "setThreadTimestamp",
            workspaceId: activeWorkspace.id,
            threadId: importedThreadId,
            timestamp,
          });
          dispatch({
            type: "addAssistantMessage",
            threadId: importedThreadId,
            text: `Imported from ${source}`,
          });
        }
        dispatch({
          type: "addAssistantMessage",
          threadId,
          text: importedSessionId
            ? `Session imported:\n- session: ${importedSessionId}\n- source: ${source}`
            : `Session import completed:\n- source: ${source}\n- output: ${result.output}`,
        });
      } catch (error) {
        pushThreadErrorMessage(
          threadId,
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        safeMessageActivity();
      }
    },
    [
      activeWorkspace,
      dispatch,
      ensureThreadForActiveWorkspace,
      normalizeCommandArg,
      pushThreadErrorMessage,
      recordThreadActivity,
      safeMessageActivity,
    ],
  );

  const startMcp = useCallback(
    async (_text: string) => {
      if (!activeWorkspace) {
        return;
      }
      const threadId = await ensureThreadForActiveWorkspace();
      if (!threadId) {
        return;
      }

      try {
        const resolvedThreadEngine = resolveThreadEngine(activeWorkspace.id, threadId);
        if (resolvedThreadEngine === "opencode") {
          const response = await getOpenCodeMcpStatusService(activeWorkspace.id);
          const text = (response.text ?? "").trim();
          const timestamp = Date.now();
          recordThreadActivity(activeWorkspace.id, threadId, timestamp);
          dispatch({
            type: "addAssistantMessage",
            threadId,
            text: text
              ? `OpenCode MCP status:\n${text}`
              : "OpenCode MCP status: no output.",
          });
          return;
        }

        const response = (await listMcpServerStatusService(
          activeWorkspace.id,
          null,
          null,
        )) as Record<string, unknown> | null;
        const result = (response?.result ?? response) as
          | Record<string, unknown>
          | null;
        const data = Array.isArray(result?.data)
          ? (result?.data as Array<Record<string, unknown>>)
          : [];

        const lines: string[] = ["MCP tools:"];
        if (data.length === 0) {
          lines.push("- No MCP servers configured.");
        } else {
          const servers = [...data].sort((a, b) =>
            String(a.name ?? "").localeCompare(String(b.name ?? "")),
          );
          for (const server of servers) {
            const name = String(server.name ?? "unknown");
            const authStatus = server.authStatus ?? server.auth_status ?? null;
            const authLabel =
              typeof authStatus === "string"
                ? authStatus
                : authStatus &&
                    typeof authStatus === "object" &&
                    "status" in authStatus
                  ? String((authStatus as { status?: unknown }).status ?? "")
                  : "";
            lines.push(`- ${name}${authLabel ? ` (auth: ${authLabel})` : ""}`);

            const toolsRecord =
              server.tools && typeof server.tools === "object"
                ? (server.tools as Record<string, unknown>)
                : {};
            const prefix = `mcp__${name}__`;
            const toolNames = Object.keys(toolsRecord)
              .map((toolName) =>
                toolName.startsWith(prefix)
                  ? toolName.slice(prefix.length)
                  : toolName,
              )
              .sort((a, b) => a.localeCompare(b));
            lines.push(
              toolNames.length > 0
                ? `  tools: ${toolNames.join(", ")}`
                : "  tools: none",
            );

            const resources = Array.isArray(server.resources)
              ? server.resources.length
              : 0;
            const templates = Array.isArray(server.resourceTemplates)
              ? server.resourceTemplates.length
              : Array.isArray(server.resource_templates)
                ? server.resource_templates.length
                : 0;
            if (resources > 0 || templates > 0) {
              lines.push(`  resources: ${resources}, templates: ${templates}`);
            }
          }
        }

        const timestamp = Date.now();
        recordThreadActivity(activeWorkspace.id, threadId, timestamp);
        dispatch({
          type: "addAssistantMessage",
          threadId,
          text: lines.join("\n"),
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to load MCP status.";
        dispatch({
          type: "addAssistantMessage",
          threadId,
          text: `MCP tools:\n- ${message}`,
        });
      } finally {
        safeMessageActivity();
      }
    },
    [
      activeWorkspace,
      dispatch,
      ensureThreadForActiveWorkspace,
      recordThreadActivity,
      resolveThreadEngine,
      safeMessageActivity,
    ],
  );

  const startLsp = useCallback(
    async (text: string) => {
      if (!activeWorkspace) {
        return;
      }
      const threadId = await ensureThreadForActiveWorkspace();
      if (!threadId) {
        return;
      }
      const resolvedThreadEngine = resolveThreadEngine(activeWorkspace.id, threadId);
      if (resolvedThreadEngine !== "opencode") {
        dispatch({
          type: "addAssistantMessage",
          threadId,
          text: "LSP command is currently supported only for OpenCode.",
        });
        safeMessageActivity();
        return;
      }

      const rest = text.trim().replace(/^\/lsp\b/i, "").trim();
      const [sub, ...parts] = rest.split(/\s+/);
      const arg = normalizeCommandArg(parts.join(" ").trim());
      if (!sub) {
        dispatch({
          type: "addAssistantMessage",
          threadId,
          text: "Usage: /lsp <diagnostics|symbols|document-symbols> <arg>",
        });
        safeMessageActivity();
        return;
      }

      try {
        let payload: unknown;
        let heading = "";
        if (sub === "diagnostics") {
          if (!arg) {
            throw new Error("Usage: /lsp diagnostics <file-path>");
          }
          const response = await getOpenCodeLspDiagnosticsService(
            activeWorkspace.id,
            arg,
          );
          heading = `LSP diagnostics (${arg})`;
          payload = response.result;
        } else if (sub === "symbols") {
          if (!arg) {
            throw new Error("Usage: /lsp symbols <query>");
          }
          const response = await getOpenCodeLspSymbolsService(
            activeWorkspace.id,
            arg,
          );
          heading = `LSP symbols (${arg})`;
          payload = response.result;
        } else if (sub === "document-symbols") {
          if (!arg) {
            throw new Error("Usage: /lsp document-symbols <file-path-or-file-uri>");
          }
          const fileUri = resolveFileUri(arg);
          const response = await getOpenCodeLspDocumentSymbolsService(
            activeWorkspace.id,
            fileUri,
          );
          heading = `LSP document symbols (${fileUri})`;
          payload = response.result;
        } else {
          throw new Error(
            "Unknown LSP command. Use diagnostics, symbols, or document-symbols.",
          );
        }

        const rendered =
          typeof payload === "string"
            ? payload
            : JSON.stringify(payload ?? null, null, 2);
        const timestamp = Date.now();
        recordThreadActivity(activeWorkspace.id, threadId, timestamp);
        dispatch({
          type: "addAssistantMessage",
          threadId,
          text: `${heading}:\n${rendered}`,
        });
      } catch (error) {
        pushThreadErrorMessage(
          threadId,
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        safeMessageActivity();
      }
    },
    [
      activeWorkspace,
      dispatch,
      ensureThreadForActiveWorkspace,
      normalizeCommandArg,
      pushThreadErrorMessage,
      recordThreadActivity,
      resolveFileUri,
      resolveThreadEngine,
      safeMessageActivity,
    ],
  );

  const startFork = useCallback(
    async (text: string) => {
      if (!activeWorkspace || !activeThreadId) {
        return;
      }
      const trimmed = text.trim();
      const rest = trimmed.replace(/^\/fork\b/i, "").trim();
      const threadId = await forkThreadForWorkspace(activeWorkspace.id, activeThreadId);
      if (!threadId) {
        return;
      }
      updateThreadParent(activeThreadId, [threadId]);
      if (rest) {
        await sendMessageToThread(activeWorkspace, threadId, rest, []);
      }
    },
    [
      activeThreadId,
      activeWorkspace,
      forkThreadForWorkspace,
      sendMessageToThread,
      updateThreadParent,
    ],
  );

  const startResume = useCallback(
    async (text: string) => {
      if (!activeWorkspace) {
        return;
      }
      if (activeThreadId && threadStatusById[activeThreadId]?.isProcessing) {
        return;
      }
      const resumeTargetRaw = text.trim().replace(/^\/resume\b/i, "").trim();
      let threadId: string | null = null;
      if (resumeTargetRaw.length > 0) {
        const sessionId = resumeTargetRaw.split(/\s+/)[0] ?? "";
        if (sessionId) {
          const targetThreadId = sessionId.startsWith("opencode:")
            ? sessionId
            : `opencode:${sessionId}`;
          const timestamp = Date.now();
          dispatch({
            type: "ensureThread",
            workspaceId: activeWorkspace.id,
            threadId: targetThreadId,
            engine: "opencode",
          });
          dispatch({
            type: "setThreadEngine",
            workspaceId: activeWorkspace.id,
            threadId: targetThreadId,
            engine: "opencode",
          });
          dispatch({
            type: "setThreadTimestamp",
            workspaceId: activeWorkspace.id,
            threadId: targetThreadId,
            timestamp,
          });
          dispatch({
            type: "setActiveThreadId",
            workspaceId: activeWorkspace.id,
            threadId: targetThreadId,
          });
          threadId = targetThreadId;
        }
      }
      if (!threadId) {
        threadId = activeThreadId ?? (await ensureThreadForActiveWorkspace());
      }
      if (!threadId) {
        return;
      }
      await refreshThread(activeWorkspace.id, threadId);
      safeMessageActivity();
    },
    [
      activeThreadId,
      activeWorkspace,
      dispatch,
      ensureThreadForActiveWorkspace,
      refreshThread,
      safeMessageActivity,
      threadStatusById,
    ],
  );

  return {
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
