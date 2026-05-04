import {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import type {
  AccessMode,
  ApprovalRequest,
  ConversationItem,
  OpenAppTarget,
  QueuedMessage,
  RequestUserInputRequest,
  RequestUserInputResponse,
  TurnPlan,
  WorkspaceInfo,
} from "../../../types";
import { isMacPlatform, isWindowsPlatform } from "../../../utils/platform";
import type { ConversationState } from "../../threads/contracts/conversationCurtainContracts";
import { ApprovalToasts } from "../../app/components/ApprovalToasts";
import { RequestUserInputMessage } from "../../app/components/RequestUserInputMessage";
import { useStreamActivityPhase } from "../../threads/hooks/useStreamActivityPhase";
import {
  noteThreadVisibleTextRendered,
  noteThreadVisibleRender,
  resolveActiveThreadStreamMitigation,
  useThreadStreamLatencySnapshot,
} from "../../threads/utils/streamLatencyDiagnostics";
import type { AgentTaskScrollRequest } from "../types";
import type { PresentationProfile } from "../presentation/presentationProfile";
import { getVisibleApprovalsForThread } from "../../../utils/approvalBatching";
import {
  MESSAGES_LIVE_AUTO_FOLLOW_FLAG_KEY,
  MESSAGES_LIVE_COLLAPSE_MIDDLE_STEPS_FLAG_KEY,
  MESSAGES_LIVE_CONTROLS_UPDATED_EVENT,
  readLocalBooleanFlag,
  writeLocalBooleanFlag,
} from "../constants/liveCanvasControls";
import { useFileLinkOpener } from "../hooks/useFileLinkOpener";
import {
  groupToolItems,
  shouldHideToolItemForRender,
} from "../utils/groupToolItems";
import { MessagesTimeline } from "./MessagesTimeline";
import {
  collapseConsecutiveReasoningRuns,
  dedupeAdjacentReasoningItems,
  isExplicitReasoningSegmentId,
  parseReasoning,
} from "./messagesReasoning";
import {
  buildLiveTailWorkingSet,
  buildRenderedItemsWindow,
  collapseExpandedExploreItems,
  isOrdinaryUserQuestionItem,
  resolveOrdinaryUserStickyText,
  resolveLiveAutoExpandedExploreId,
  suppressCompletedExploreItemsBetweenLatestUserTurns,
} from "./messagesLiveWindow";
import {
  isAssistantMessageConversationItem,
  isMessageConversationItem,
  isReasoningConversationItem,
  isUserMessageConversationItem,
} from "./messageItemPredicates";
import { parseAgentTaskNotification } from "../utils/agentTaskNotification";
import { dedupeExitPlanItemsKeepFirst } from "./messagesExitPlan";
import { buildSuppressedUserMemoryContextMessageIdSet } from "./messagesMemoryContext";
import { buildSuppressedUserNoteCardContextMessageIdSet } from "./messagesNoteCardContext";
import {
  countRenderableCollapsedEntries,
  findLastAssistantMessageIndex,
  findLastUserMessageIndex,
  HistoryStickyCandidate,
  isMessagesPerfDebugEnabled,
  isSelectionInsideNode,
  logClaudeRender,
  logMessagesPerf,
  MESSAGES_SLOW_ANCHOR_WARN_MS,
  MESSAGES_SLOW_RENDER_WARN_MS,
  normalizeHistoryStickyHeaderText,
  resolveRenderableItems,
  resolveWorkingActivityLabel,
  SCROLL_THRESHOLD_PX,
  scrollKeyForItems,
  shouldDisplayWorkingActivityLabel,
  shouldHideClaudeReasoningModule,
  toConversationEngine,
  VISIBLE_MESSAGE_WINDOW,
} from "./messagesRenderUtils";
import {
  resolveAssistantRuntimeReconnectHint,
  resolveRetryMessageForReconnectItem,
  type RuntimeReconnectRecoveryCallbackResult,
} from "./runtimeReconnect";

const MESSAGE_JUMP_EVENT_NAME = "ccgui:jump-to-message";
const ASSISTANT_FINALIZING_LIVE_WINDOW_MS = 320;
const CODEX_FINALIZING_LIVE_WINDOW_MS = 6_000;

type MessagesProps = {
  items: ConversationItem[];
  threadId: string | null;
  workspaceId?: string | null;
  isThinking: boolean;
  isHistoryLoading?: boolean;
  isContextCompacting?: boolean;
  proxyEnabled?: boolean;
  proxyUrl?: string | null;
  processingStartedAt?: number | null;
  lastDurationMs?: number | null;
  heartbeatPulse?: number;
  workspacePath?: string | null;
  openTargets: OpenAppTarget[];
  selectedOpenAppId: string;
  showMessageAnchors?: boolean;
  showStickyUserBubble?: boolean;
  codeBlockCopyUseModifier?: boolean;
  userInputRequests?: RequestUserInputRequest[];
  approvals?: ApprovalRequest[];
  workspaces?: WorkspaceInfo[];
  onUserInputSubmit?: (
    request: RequestUserInputRequest,
    response: RequestUserInputResponse,
  ) => Promise<void> | void;
  onApprovalDecision?: (
    request: ApprovalRequest,
    decision: "accept" | "decline" | "dismiss",
  ) => void;
  onApprovalBatchAccept?: (requests: ApprovalRequest[]) => void;
  onApprovalRemember?: (request: ApprovalRequest, command: string[]) => void;
  activeEngine?: "claude" | "codex" | "gemini" | "opencode";
  activeCollaborationModeId?: string | null;
  plan?: TurnPlan | null;
  isPlanMode?: boolean;
  isPlanProcessing?: boolean;
  onOpenDiffPath?: (path: string) => void;
  onOpenPlanPanel?: () => void;
  onExitPlanModeExecute?: (
    mode: Extract<AccessMode, "default" | "full-access">,
  ) => Promise<void> | void;
  conversationState?: ConversationState | null;
  presentationProfile?: PresentationProfile | null;
  onOpenWorkspaceFile?: (path: string) => void;
  agentTaskScrollRequest?: AgentTaskScrollRequest | null;
  onRecoverThreadRuntime?: (
    workspaceId: string,
    threadId: string,
  ) => Promise<RuntimeReconnectRecoveryCallbackResult> | RuntimeReconnectRecoveryCallbackResult;
  onRecoverThreadRuntimeAndResend?: (
    workspaceId: string,
    threadId: string,
    message: Pick<QueuedMessage, "text" | "images">,
  ) => Promise<RuntimeReconnectRecoveryCallbackResult> | RuntimeReconnectRecoveryCallbackResult;
};

type HistoryExpansionScrollSnapshot = {
  scrollHeight: number;
  scrollTop: number;
};

type PreservedReadableWindow = {
  threadId: string | null;
  turnId: string | null;
  renderedItems: ConversationItem[];
  visibleCollapsedHistoryItemCount: number;
};

function readHistoryExpansionScrollSnapshot(
  container: HTMLDivElement | null,
): HistoryExpansionScrollSnapshot | null {
  if (!container) {
    return null;
  }
  const { scrollHeight, scrollTop } = container;
  if (!Number.isFinite(scrollHeight) || !Number.isFinite(scrollTop)) {
    return null;
  }
  return { scrollHeight, scrollTop };
}

function restoreHistoryExpansionScrollPosition(
  container: HTMLDivElement,
  snapshot: HistoryExpansionScrollSnapshot,
) {
  const currentScrollHeight = container.scrollHeight;
  if (!Number.isFinite(currentScrollHeight)) {
    return false;
  }
  const scrollHeightDelta = currentScrollHeight - snapshot.scrollHeight;
  const nextScrollTop = snapshot.scrollTop + scrollHeightDelta;
  if (!Number.isFinite(nextScrollTop)) {
    return false;
  }
  container.scrollTop = Math.max(0, nextScrollTop);
  return true;
}

function findLatestAssistantTextLength(items: ConversationItem[]) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!item || item.kind !== "message" || item.role !== "assistant") {
      continue;
    }
    return item.text.length;
  }
  return 0;
}

function mergeReadableRecoveryItems(
  preservedItems: ConversationItem[],
  currentItems: ConversationItem[],
) {
  if (currentItems.length === 0) {
    return preservedItems;
  }
  const preservedItemIds = new Set(preservedItems.map((item) => item.id));
  const appendedCurrentItems = currentItems.filter((item) => !preservedItemIds.has(item.id));
  return appendedCurrentItems.length > 0
    ? [...preservedItems, ...appendedCurrentItems]
    : preservedItems;
}

export const Messages = memo(function Messages({
  items: legacyItems,
  threadId: legacyThreadId,
  workspaceId: legacyWorkspaceId = null,
  isThinking: legacyIsThinking,
  isHistoryLoading = false,
  isContextCompacting = false,
  proxyEnabled = false,
  proxyUrl = null,
  processingStartedAt = null,
  lastDurationMs = null,
  heartbeatPulse: legacyHeartbeatPulse = 0,
  workspacePath = null,
  openTargets,
  selectedOpenAppId,
  showMessageAnchors = true,
  showStickyUserBubble = true,
  codeBlockCopyUseModifier = false,
  userInputRequests: legacyUserInputRequests = [],
  approvals = [],
  workspaces = [],
  onUserInputSubmit: legacyOnUserInputSubmit,
  onApprovalDecision,
  onApprovalBatchAccept,
  onApprovalRemember,
  activeEngine: legacyActiveEngine = "claude",
  activeCollaborationModeId = null,
  plan: legacyPlan = null,
  isPlanMode: _isPlanMode = false,
  isPlanProcessing: _isPlanProcessing = false,
  onOpenDiffPath,
  conversationState = null,
  presentationProfile = null,
  onOpenWorkspaceFile,
  onExitPlanModeExecute,
  agentTaskScrollRequest = null,
  onRecoverThreadRuntime,
  onRecoverThreadRuntimeAndResend,
}: MessagesProps) {
  const { t } = useTranslation();
  const isWindowsDesktop = useMemo(() => isWindowsPlatform(), []);
  const isMacDesktop = useMemo(() => isMacPlatform(), []);
  const legacyIsWorking = legacyIsThinking || isContextCompacting;
  const fallbackConversationState = useMemo<ConversationState>(
    () => ({
      items: legacyItems,
      plan: legacyPlan,
      userInputQueue: legacyUserInputRequests,
      meta: {
        workspaceId: legacyWorkspaceId ?? "",
        threadId: legacyThreadId ?? "",
        engine: toConversationEngine(legacyActiveEngine),
        activeTurnId: null,
        isThinking: legacyIsWorking,
        heartbeatPulse: legacyHeartbeatPulse,
        historyRestoredAtMs: null,
      },
    }),
    [
      legacyItems,
      legacyPlan,
      legacyUserInputRequests,
      legacyWorkspaceId,
      legacyThreadId,
      legacyActiveEngine,
      legacyIsWorking,
      legacyHeartbeatPulse,
    ],
  );
  const effectiveState = conversationState ?? fallbackConversationState;
  const items = useMemo(
    () =>
      resolveRenderableItems({
        legacyItems,
        legacyThreadId,
        legacyWorkspaceId,
        conversationState,
      }),
    [conversationState, legacyItems, legacyThreadId, legacyWorkspaceId],
  );
  const userInputRequests = effectiveState.userInputQueue;
  const workspaceId = effectiveState.meta.workspaceId || legacyWorkspaceId;
  const threadId = effectiveState.meta.threadId || legacyThreadId;
  const activeTurnId = effectiveState.meta.activeTurnId ?? null;
  const activeEngine = toConversationEngine(effectiveState.meta.engine);
  const isThinking = conversationState
    ? effectiveState.meta.isThinking
    : legacyIsThinking;
  const isWorking = isThinking || isContextCompacting;
  const heartbeatPulse = conversationState
    ? (effectiveState.meta.heartbeatPulse ?? legacyHeartbeatPulse ?? 0)
    : legacyHeartbeatPulse ?? 0;
  const threadStreamLatencySnapshot = useThreadStreamLatencySnapshot(threadId);
  const activeStreamMitigation = useMemo(
    () => resolveActiveThreadStreamMitigation(threadStreamLatencySnapshot),
    [threadStreamLatencySnapshot],
  );
  const blankingRecoveryActive =
    activeEngine === "claude" &&
    isThinking &&
    threadStreamLatencySnapshot?.latencyCategory === "repeat-turn-blanking";
  const visibleStallRecoveryActive =
    activeEngine === "claude" &&
    isThinking &&
    threadStreamLatencySnapshot?.latencyCategory === "visible-output-stall-after-first-delta";
  const readableWindowRecoveryActive =
    blankingRecoveryActive || visibleStallRecoveryActive;
  const latestRuntimeReconnectItemId = useMemo(() => {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      if (!item || item.kind !== "message" || item.role !== "assistant") {
        continue;
      }
      if (
        resolveAssistantRuntimeReconnectHint(
          item,
          Boolean(parseAgentTaskNotification(item.text)),
        )
      ) {
        return item.id;
      }
    }
    return null;
  }, [items]);
  const latestRetryMessage = useMemo(
    () => resolveRetryMessageForReconnectItem(items, latestRuntimeReconnectItemId),
    [items, latestRuntimeReconnectItemId],
  );
  const renderStartedAt =
    typeof performance === "undefined" ? 0 : performance.now();
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pendingHistoryExpansionScrollSnapshotRef =
    useRef<HistoryExpansionScrollSnapshot | null>(null);
  const messageNodeByIdRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const agentTaskNodeByTaskIdRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const agentTaskNodeByToolUseIdRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const autoScrollRef = useRef(true);
  const anchorUpdateRafRef = useRef<number | null>(null);
  const historyStickyUpdateRafRef = useRef<number | null>(null);
  const lastRenderSnapshotRef = useRef<{
    items: ConversationItem[];
    userInputRequests: RequestUserInputRequest[];
    conversationState: ConversationState | null;
    presentationProfile: PresentationProfile | null;
    isThinking: boolean;
    heartbeatPulse: number;
    threadId: string | null;
  } | null>(null);
  const preservedReadableWindowRef = useRef<PreservedReadableWindow>({
    threadId: null,
    turnId: null,
    renderedItems: [],
    visibleCollapsedHistoryItemCount: 0,
  });
  const [expandedItems, setExpandedItems] = useState<Set<string>>(() => new Set());
  const [selectedExitPlanExecutionByItemKey, setSelectedExitPlanExecutionByItemKey] = useState<
    Record<string, Extract<AccessMode, "default" | "full-access">>
  >({});
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [activeAnchorId, setActiveAnchorId] = useState<string | null>(null);
  const [activeStickyMessageId, setActiveStickyMessageId] = useState<string | null>(null);
  const [showAllHistoryItems, setShowAllHistoryItems] = useState(false);
  const [pendingJumpMessageId, setPendingJumpMessageId] = useState<string | null>(null);
  const [liveAutoFollowEnabled, setLiveAutoFollowEnabled] = useState(() =>
    readLocalBooleanFlag(MESSAGES_LIVE_AUTO_FOLLOW_FLAG_KEY, true),
  );
  const [collapseLiveMiddleStepsEnabled, setCollapseLiveMiddleStepsEnabled] = useState(() =>
    readLocalBooleanFlag(MESSAGES_LIVE_COLLAPSE_MIDDLE_STEPS_FLAG_KEY, false),
  );
  const hideClaudeReasoning = activeEngine === "claude" && shouldHideClaudeReasoningModule();
  const [isSelectionFrozen, setIsSelectionFrozen] = useState(false);
  const enableCollaborationBadge = activeEngine === "codex";
  const copyTimeoutRef = useRef<number | null>(null);
  const planPanelFocusRafRef = useRef<number | null>(null);
  const planPanelFocusTimeoutRef = useRef<number | null>(null);
  const planPanelFocusNodeRef = useRef<HTMLElement | null>(null);
  const assistantFinalizingTimerRef = useRef<number | null>(null);
  const previousAssistantThinkingRef = useRef(isThinking);
  const previousAssistantThreadIdRef = useRef(threadId);
  const frozenItemsRef = useRef<ConversationItem[] | null>(null);
  const latestItemsRef = useRef(items);
  latestItemsRef.current = items;
  const [finalizingAssistantMessageId, setFinalizingAssistantMessageId] = useState<string | null>(null);
  const effectiveItems = useMemo(() => {
    const baseItems = isSelectionFrozen
      ? frozenItemsRef.current ?? items
      : items;
    return dedupeExitPlanItemsKeepFirst(baseItems);
  }, [isSelectionFrozen, items]);
  const liveTailWorkingSet = useMemo(
    () =>
      buildLiveTailWorkingSet(effectiveItems, {
        isThinking,
        showAllHistoryItems,
        visibleWindow: VISIBLE_MESSAGE_WINDOW,
        enableCollaborationBadge,
      }),
    [effectiveItems, enableCollaborationBadge, isThinking, showAllHistoryItems],
  );
  const renderSourceItems = liveTailWorkingSet.items;
  const firstItemIdRef = useRef<string | null>(items[0]?.id ?? null);
  const activeUserInputRequestId =
    threadId && userInputRequests.length
      ? (userInputRequests.find(
          (request) =>
            request.params.thread_id === threadId &&
            (!workspaceId || request.workspace_id === workspaceId),
        )?.request_id ?? null)
      : null;
  const rawScrollKey = `${scrollKeyForItems(effectiveItems)}-${activeUserInputRequestId ?? "no-input"}`;
  // Throttle scrollKey during streaming to avoid flooding the main thread
  // with smooth-scroll animations that block keyboard input.
  const [scrollKey, setScrollKey] = useState(rawScrollKey);
  const scrollThrottleRef = useRef<number>(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  useEffect(() => {
    if (scrollThrottleRef.current) {
      window.clearTimeout(scrollThrottleRef.current);
    }
    scrollThrottleRef.current = window.setTimeout(() => {
      if (!mountedRef.current || typeof window === "undefined") {
        return;
      }
      startTransition(() => {
        setScrollKey(rawScrollKey);
      });
    }, isThinking ? 120 : 0);
    return () => {
      if (scrollThrottleRef.current) {
        window.clearTimeout(scrollThrottleRef.current);
      }
    };
  }, [rawScrollKey, isThinking]);
  const { openFileLink, showFileLinkMenu } = useFileLinkOpener(
    workspacePath,
    openTargets,
    selectedOpenAppId,
    onOpenWorkspaceFile,
  );

  const isNearBottom = useCallback(
    (node: HTMLDivElement) =>
      node.scrollHeight - node.scrollTop - node.clientHeight <= SCROLL_THRESHOLD_PX,
    [],
  );

  const computeActiveAnchor = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      return null;
    }
    const viewportAnchorY =
      container.scrollTop + Math.min(96, container.clientHeight * 0.32);
    let bestId: string | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const [messageId, node] of messageNodeByIdRef.current) {
      const distance = Math.abs(node.offsetTop - viewportAnchorY);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestId = messageId;
      }
    }
    return bestId;
  }, []);

  const requestAutoScroll = useCallback(() => {
    if (!liveAutoFollowEnabled) {
      return;
    }
    if (!bottomRef.current) {
      return;
    }
    // Always use instant for programmatic scroll requests to avoid blocking input
    bottomRef.current.scrollIntoView({ behavior: "instant", block: "end" });
  }, [liveAutoFollowEnabled]);

  const scrollToAgentTaskCard = useCallback((request: AgentTaskScrollRequest | null) => {
    if (!request) {
      return;
    }
    const container = containerRef.current;
    const node =
      (request.taskId
        ? agentTaskNodeByTaskIdRef.current.get(request.taskId)
        : null) ??
      (request.toolUseId
        ? agentTaskNodeByToolUseIdRef.current.get(request.toolUseId)
        : null);
    if (!node || !container) {
      return;
    }
    const containerRect = container.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    const targetTop =
      container.scrollTop + (nodeRect.top - containerRect.top) - container.clientHeight * 0.22;
    autoScrollRef.current = false;
    container.scrollTo({
      top: Math.max(0, targetTop),
      behavior: "smooth",
    });
  }, []);

  useEffect(() => {
    autoScrollRef.current = true;
    setExpandedItems(new Set());
    setIsSelectionFrozen(false);
    frozenItemsRef.current = null;
    pendingHistoryExpansionScrollSnapshotRef.current = null;
    if (assistantFinalizingTimerRef.current !== null) {
      window.clearTimeout(assistantFinalizingTimerRef.current);
      assistantFinalizingTimerRef.current = null;
    }
    setFinalizingAssistantMessageId(null);
    previousAssistantThinkingRef.current = false;
    previousAssistantThreadIdRef.current = threadId;
  }, [threadId]);
  useEffect(() => {
    scrollToAgentTaskCard(agentTaskScrollRequest);
  }, [agentTaskScrollRequest, scrollToAgentTaskCard]);
  useEffect(() => {
    const handleSelectionChange = () => {
      const nextFrozen = isSelectionInsideNode(window.getSelection(), containerRef.current);
      if (nextFrozen) {
        frozenItemsRef.current = frozenItemsRef.current ?? latestItemsRef.current;
      } else {
        frozenItemsRef.current = null;
      }
      setIsSelectionFrozen((previous) => (previous === nextFrozen ? previous : nextFrozen));
    };
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, []);
  useEffect(() => {
    if (!isSelectionFrozen) {
      frozenItemsRef.current = null;
    }
  }, [isSelectionFrozen, items]);

  useEffect(() => {
    writeLocalBooleanFlag(MESSAGES_LIVE_AUTO_FOLLOW_FLAG_KEY, liveAutoFollowEnabled);
  }, [liveAutoFollowEnabled]);

  useEffect(() => {
    writeLocalBooleanFlag(
      MESSAGES_LIVE_COLLAPSE_MIDDLE_STEPS_FLAG_KEY,
      collapseLiveMiddleStepsEnabled,
    );
  }, [collapseLiveMiddleStepsEnabled]);
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handleLiveControlsUpdated = (
      event: Event,
    ) => {
      const customEvent = event as CustomEvent<{
        liveAutoFollowEnabled?: boolean;
        collapseLiveMiddleStepsEnabled?: boolean;
      }>;
      const detail = customEvent.detail;
      if (!detail) {
        return;
      }
      if (typeof detail.liveAutoFollowEnabled === "boolean") {
        setLiveAutoFollowEnabled(detail.liveAutoFollowEnabled);
      }
      if (typeof detail.collapseLiveMiddleStepsEnabled === "boolean") {
        setCollapseLiveMiddleStepsEnabled(detail.collapseLiveMiddleStepsEnabled);
      }
    };
    const handleStorage = (event: StorageEvent) => {
      if (!event.key) {
        return;
      }
      if (event.key === MESSAGES_LIVE_AUTO_FOLLOW_FLAG_KEY) {
        setLiveAutoFollowEnabled(readLocalBooleanFlag(MESSAGES_LIVE_AUTO_FOLLOW_FLAG_KEY, true));
        return;
      }
      if (event.key === MESSAGES_LIVE_COLLAPSE_MIDDLE_STEPS_FLAG_KEY) {
        setCollapseLiveMiddleStepsEnabled(
          readLocalBooleanFlag(MESSAGES_LIVE_COLLAPSE_MIDDLE_STEPS_FLAG_KEY, false),
        );
      }
    };
    window.addEventListener(
      MESSAGES_LIVE_CONTROLS_UPDATED_EVENT,
      handleLiveControlsUpdated as EventListener,
    );
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(
        MESSAGES_LIVE_CONTROLS_UPDATED_EVENT,
        handleLiveControlsUpdated as EventListener,
      );
      window.removeEventListener("storage", handleStorage);
    };
  }, []);
  useEffect(() => {
    if (!liveAutoFollowEnabled) {
      return;
    }
    autoScrollRef.current = true;
    requestAutoScroll();
  }, [liveAutoFollowEnabled, requestAutoScroll]);
  useEffect(() => {
    const currentFirstId = effectiveItems[0]?.id ?? null;
    if (currentFirstId !== firstItemIdRef.current) {
      setShowAllHistoryItems(false);
      pendingHistoryExpansionScrollSnapshotRef.current = null;
    }
    firstItemIdRef.current = currentFirstId;
  }, [effectiveItems]);
  const toggleExpanded = useCallback((id: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);
  const handleExitPlanModeExecuteForItem = useCallback(
    async (
      itemId: string,
      mode: Extract<AccessMode, "default" | "full-access">,
    ) => {
      const selectionKey = `${threadId ?? "no-thread"}:${itemId}`;
      setSelectedExitPlanExecutionByItemKey((prev) => {
        if (prev[selectionKey] === mode) {
          return prev;
        }
        return {
          ...prev,
          [selectionKey]: mode,
        };
      });
      await onExitPlanModeExecute?.(mode);
    },
    [onExitPlanModeExecute, threadId],
  );
  useEffect(() => {
    if (isThinking) {
      return;
    }
    setExpandedItems((prev) => collapseExpandedExploreItems(prev, effectiveItems));
  }, [effectiveItems, isThinking]);

  // Auto-expand the latest reasoning block during streaming (synced with idea-claude-code-gui)
  const lastAutoExpandedIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isThinking) {
      lastAutoExpandedIdRef.current = null;
      return;
    }

    const reasoningIds: string[] = [];
    for (const item of renderSourceItems) {
      if (item.kind === "reasoning") {
        reasoningIds.push(item.id);
      }
    }

    if (reasoningIds.length === 0) return;

    const lastReasoningId = reasoningIds[reasoningIds.length - 1] ?? null;

    if (lastReasoningId !== lastAutoExpandedIdRef.current) {
      setExpandedItems((prev) => {
        const next = new Set<string>();
        // Only expand the latest reasoning block, collapse all others
        if (lastReasoningId) {
          next.add(lastReasoningId);
        }
        // Preserve non-reasoning expanded items
        for (const id of prev) {
          const isReasoning = reasoningIds.includes(id);
          if (!isReasoning) {
            next.add(id);
          }
        }
        return next;
      });
      lastAutoExpandedIdRef.current = lastReasoningId;
    }
  }, [isThinking, renderSourceItems]);
  const reasoningMetaById = useMemo(() => {
    const meta = new Map<string, ReturnType<typeof parseReasoning>>();
    renderSourceItems.forEach((item) => {
      if (item.kind === "reasoning") {
        meta.set(item.id, parseReasoning(item));
      }
    });
    return meta;
  }, [renderSourceItems]);

  const lastUserMessageIndex = useMemo(
    () => findLastUserMessageIndex(renderSourceItems),
    [renderSourceItems],
  );
  const reasoningWindowStartIndex = useMemo(() => {
    if (lastUserMessageIndex >= 0) {
      return lastUserMessageIndex;
    }
    return findLastAssistantMessageIndex(renderSourceItems);
  }, [lastUserMessageIndex, renderSourceItems]);

  const latestReasoningLabel = useMemo(() => {
    if (hideClaudeReasoning) {
      return null;
    }
    for (let index = renderSourceItems.length - 1; index > reasoningWindowStartIndex; index -= 1) {
      const item = renderSourceItems[index];
      if (!isReasoningConversationItem(item)) {
        continue;
      }
      const parsed = reasoningMetaById.get(item.id);
      if (parsed?.workingLabel) {
        return parsed.workingLabel;
      }
    }
    return null;
  }, [hideClaudeReasoning, reasoningMetaById, reasoningWindowStartIndex, renderSourceItems]);

  const latestReasoningId = useMemo(() => {
    for (let index = renderSourceItems.length - 1; index > reasoningWindowStartIndex; index -= 1) {
      const item = renderSourceItems[index];
      if (isReasoningConversationItem(item)) {
        return item.id;
      }
    }
    return null;
  }, [reasoningWindowStartIndex, renderSourceItems]);
  const claudeDockedReasoningItems = useMemo(() => {
    if (!hideClaudeReasoning) {
      return [] as Array<{
        item: Extract<ConversationItem, { kind: "reasoning" }>;
        parsed: ReturnType<typeof parseReasoning>;
      }>;
    }
    const list: Array<{
      item: Extract<ConversationItem, { kind: "reasoning" }>;
      parsed: ReturnType<typeof parseReasoning>;
    }> = [];
    for (let index = reasoningWindowStartIndex + 1; index < renderSourceItems.length; index += 1) {
      const item = renderSourceItems[index];
      if (!isReasoningConversationItem(item)) {
        continue;
      }
      const parsed = reasoningMetaById.get(item.id);
      if (!parsed) {
        continue;
      }
      const hasText =
        Boolean(parsed.bodyText?.trim()) ||
        Boolean(item.content?.trim()) ||
        Boolean(item.summary?.trim());
      if (!hasText) {
        continue;
      }
      list.push({ item, parsed });
    }
    return list;
  }, [hideClaudeReasoning, reasoningMetaById, reasoningWindowStartIndex, renderSourceItems]);
  const previousIsThinkingRef = useRef(isThinking);
  useEffect(() => {
    if (previousIsThinkingRef.current && !isThinking && claudeDockedReasoningItems.length > 0) {
      setExpandedItems((prev) => {
        const reasoningIds = new Set(claudeDockedReasoningItems.map((entry) => entry.item.id));
        let changed = false;
        const next = new Set(prev);
        for (const id of reasoningIds) {
          if (next.delete(id)) {
            changed = true;
          }
        }
        if (!changed) {
          return prev;
        }
        return next;
      });
    }
    previousIsThinkingRef.current = isThinking;
  }, [claudeDockedReasoningItems, isThinking]);

  const latestTitleOnlyReasoningId = useMemo(() => {
    for (let index = renderSourceItems.length - 1; index >= 0; index -= 1) {
      const item = renderSourceItems[index];
      if (!isReasoningConversationItem(item)) {
        continue;
      }
      const parsed = reasoningMetaById.get(item.id);
      if (parsed?.workingLabel && !parsed.hasBody) {
        return item.id;
      }
    }
    return null;
  }, [reasoningMetaById, renderSourceItems]);

  const latestWorkingActivityLabel = useMemo(() => {
    let lastUserIndex = -1;
    for (let index = renderSourceItems.length - 1; index >= 0; index -= 1) {
      const item = renderSourceItems[index];
      if (isUserMessageConversationItem(item)) {
        lastUserIndex = index;
        break;
      }
    }
    if (lastUserIndex < 0) {
      return null;
    }
    for (let index = renderSourceItems.length - 1; index > lastUserIndex; index -= 1) {
      const item = renderSourceItems[index];
      if (!item) {
        continue;
      }
      if (isAssistantMessageConversationItem(item)) {
        break;
      }
      const label = resolveWorkingActivityLabel(item, activeEngine, presentationProfile);
      if (label) {
        return label;
      }
    }
    return null;
  }, [activeEngine, presentationProfile, renderSourceItems]);
  const approvalResumeWorkingLabel = useMemo(() => {
    if (!isThinking || lastUserMessageIndex < 0) {
      return null;
    }
    const resumeText = t("approval.resumingAfterApproval");
    for (let index = renderSourceItems.length - 1; index > lastUserMessageIndex; index -= 1) {
      const item = renderSourceItems[index];
      if (!item) {
        continue;
      }
      if (isAssistantMessageConversationItem(item)) {
        break;
      }
      if (
        item.kind === "tool" &&
        item.toolType === "fileChange" &&
        item.status === "running"
      ) {
        return item.output?.trim() || resumeText;
      }
    }
    return null;
  }, [isThinking, lastUserMessageIndex, renderSourceItems, t]);

  const latestAssistantMessageId = useMemo(() => {
    for (let index = renderSourceItems.length - 1; index > lastUserMessageIndex; index -= 1) {
      const item = renderSourceItems[index];
      if (isAssistantMessageConversationItem(item)) {
        return item.id;
      }
    }
    return null;
  }, [lastUserMessageIndex, renderSourceItems]);
  const supportsAssistantFinalizingWindow =
    activeEngine === "claude" || activeEngine === "codex";
  const isAssistantCompletionFrame =
    supportsAssistantFinalizingWindow &&
    previousAssistantThreadIdRef.current === threadId &&
    previousAssistantThinkingRef.current &&
    !isThinking &&
    latestAssistantMessageId !== null;
  const liveAssistantMessageId = isThinking
    ? latestAssistantMessageId
    : finalizingAssistantMessageId ?? (
        isAssistantCompletionFrame ? latestAssistantMessageId : null
      );
  const isAssistantFinalizing =
    !isThinking &&
    liveAssistantMessageId !== null;
  useEffect(() => {
    const previouslyThinking = previousAssistantThinkingRef.current;
    previousAssistantThreadIdRef.current = threadId;
    previousAssistantThinkingRef.current = isThinking;
    if (!supportsAssistantFinalizingWindow) {
      if (assistantFinalizingTimerRef.current !== null) {
        window.clearTimeout(assistantFinalizingTimerRef.current);
        assistantFinalizingTimerRef.current = null;
      }
      if (finalizingAssistantMessageId !== null) {
        setFinalizingAssistantMessageId(null);
      }
      return;
    }
    if (isThinking) {
      if (assistantFinalizingTimerRef.current !== null) {
        window.clearTimeout(assistantFinalizingTimerRef.current);
        assistantFinalizingTimerRef.current = null;
      }
      if (finalizingAssistantMessageId !== null) {
        setFinalizingAssistantMessageId(null);
      }
      return;
    }
    if (!previouslyThinking || !latestAssistantMessageId) {
      return;
    }
    setFinalizingAssistantMessageId(latestAssistantMessageId);
    if (assistantFinalizingTimerRef.current !== null) {
      window.clearTimeout(assistantFinalizingTimerRef.current);
    }
    const finalizingWindowMs =
      activeEngine === "codex"
        ? CODEX_FINALIZING_LIVE_WINDOW_MS
        : ASSISTANT_FINALIZING_LIVE_WINDOW_MS;
    assistantFinalizingTimerRef.current = window.setTimeout(() => {
      assistantFinalizingTimerRef.current = null;
      setFinalizingAssistantMessageId((current) =>
        current === latestAssistantMessageId ? null : current,
      );
    }, finalizingWindowMs);
  }, [
    activeEngine,
    finalizingAssistantMessageId,
    isThinking,
    latestAssistantMessageId,
    supportsAssistantFinalizingWindow,
    threadId,
  ]);
  useEffect(() => () => {
    if (assistantFinalizingTimerRef.current !== null) {
      window.clearTimeout(assistantFinalizingTimerRef.current);
      assistantFinalizingTimerRef.current = null;
    }
  }, []);

  const waitingForFirstChunk = useMemo(() => {
    if (!isThinking || renderSourceItems.length === 0) {
      return false;
    }
    let lastUserIndex = -1;
    for (let index = renderSourceItems.length - 1; index >= 0; index -= 1) {
      const item = renderSourceItems[index];
      if (isUserMessageConversationItem(item)) {
        lastUserIndex = index;
        break;
      }
    }
    if (lastUserIndex < 0) {
      return false;
    }
    for (let index = lastUserIndex + 1; index < renderSourceItems.length; index += 1) {
      const item = renderSourceItems[index];
      if (isAssistantMessageConversationItem(item)) {
        return false;
      }
    }
    return true;
  }, [isThinking, renderSourceItems]);
  const streamActivityPhase = useStreamActivityPhase({
    isProcessing:
      isThinking &&
      (activeEngine === "codex" || activeEngine === "claude" || activeEngine === "gemini"),
    items: renderSourceItems,
  });
  const primaryWorkingLabel = isContextCompacting
    ? t("chat.contextDualViewCompacting")
    : approvalResumeWorkingLabel;
  const enableClaudeRenderSafeMode =
    (isWindowsDesktop || isMacDesktop) &&
    activeEngine === "claude" &&
    isThinking;

  const visibleItems = useMemo(() => {
    const filtered = renderSourceItems.filter((item) => {
      if (
        (activeEngine === "codex" || activeEngine === "claude") &&
        item.kind === "explore" &&
        item.status === "exploring"
      ) {
        return false;
      }
      if (hideClaudeReasoning && item.kind === "reasoning") {
        return false;
      }
      if (item.kind === "tool" && shouldHideToolItemForRender(item)) {
        return false;
      }
      if (item.kind !== "reasoning") {
        return true;
      }
      const parsed = reasoningMetaById.get(item.id);
      const hasBody = parsed?.hasBody ?? false;
      if (hasBody) {
        return true;
      }
      if (!parsed?.workingLabel) {
        return false;
      }
      // Gemini realtime segmented reasoning must stay visible as independent
      // timeline slices instead of being reduced to only the latest title-only row.
      if (activeEngine === "gemini" && isExplicitReasoningSegmentId(item.id)) {
        return true;
      }
      if (activeEngine === "claude") {
        return true;
      }
      // Keep title-only reasoning visible for Codex canvas and retain the
      // latest title-only reasoning row for other engines to avoid the
      // "thinking module disappears" regression in real-time conversations.
      const keepTitleOnlyReasoning = presentationProfile
        ? presentationProfile.showReasoningLiveDot
        : activeEngine === "codex";
      return keepTitleOnlyReasoning || item.id === latestTitleOnlyReasoningId;
    });
    const appendReasoningRuns = activeEngine === "claude" || activeEngine === "gemini";
    const deduped = dedupeAdjacentReasoningItems(
      filtered,
      reasoningMetaById,
      appendReasoningRuns,
      toConversationEngine(activeEngine),
    );
    const collapseReasoningRuns = activeEngine !== "codex";
    return collapseConsecutiveReasoningRuns(
      deduped,
      collapseReasoningRuns,
      appendReasoningRuns,
    );
  }, [
    activeEngine,
    hideClaudeReasoning,
    latestTitleOnlyReasoningId,
    presentationProfile,
    reasoningMetaById,
    renderSourceItems,
  ]);
  const timelineSourceItems = useMemo(() => {
    if (activeEngine !== "codex" || !isThinking) {
      return visibleItems;
    }
    return suppressCompletedExploreItemsBetweenLatestUserTurns(visibleItems, {
      enableCollaborationBadge,
    });
  }, [activeEngine, enableCollaborationBadge, isThinking, visibleItems]);
  const { timelineItems, collapsedMiddleStepCount } = useMemo(() => {
    if (!collapseLiveMiddleStepsEnabled || timelineSourceItems.length <= 2) {
      return { timelineItems: timelineSourceItems, collapsedMiddleStepCount: 0 };
    }
    if (!isThinking) {
      const firstUserIndex = timelineSourceItems.findIndex(
        (item) => item.kind === "message" && item.role === "user",
      );
      if (firstUserIndex < 0) {
        return { timelineItems: timelineSourceItems, collapsedMiddleStepCount: 0 };
      }
      let lastMessageIndex = -1;
      for (let index = timelineSourceItems.length - 1; index >= 0; index -= 1) {
        if (timelineSourceItems[index]?.kind === "message") {
          lastMessageIndex = index;
          break;
        }
      }
      if (lastMessageIndex <= firstUserIndex) {
        return { timelineItems: timelineSourceItems, collapsedMiddleStepCount: 0 };
      }
      const nextTimelineItems: ConversationItem[] = [];
      const hiddenItems: ConversationItem[] = [];
      for (let index = 0; index < timelineSourceItems.length; index += 1) {
        const item = timelineSourceItems[index];
        if (!item) {
          continue;
        }
        if (index < firstUserIndex || index > lastMessageIndex || isMessageConversationItem(item)) {
          nextTimelineItems.push(item);
          continue;
        }
        hiddenItems.push(item);
      }
      const collapsedEntryCount = countRenderableCollapsedEntries(hiddenItems, activeEngine);
      return hiddenItems.length > 0
        ? { timelineItems: nextTimelineItems, collapsedMiddleStepCount: collapsedEntryCount }
        : { timelineItems: timelineSourceItems, collapsedMiddleStepCount: 0 };
    }
    let lastUserIndex = -1;
    for (let index = timelineSourceItems.length - 1; index >= 0; index -= 1) {
      const candidate = timelineSourceItems[index];
      if (isUserMessageConversationItem(candidate)) {
        lastUserIndex = index;
        break;
      }
    }
    if (lastUserIndex < 0 || lastUserIndex >= timelineSourceItems.length - 2) {
      return { timelineItems: timelineSourceItems, collapsedMiddleStepCount: 0 };
    }
    const lastIndex = timelineSourceItems.length - 1;
    const nextTimelineItems: ConversationItem[] = [];
    const hiddenItems: ConversationItem[] = [];
    for (let index = 0; index < timelineSourceItems.length; index += 1) {
      const item = timelineSourceItems[index];
      if (!item) {
        continue;
      }
      const shouldKeepLatestClaudeReasoningVisible =
        activeEngine === "claude"
        && latestAssistantMessageId === null
        && latestReasoningId !== null
        && item.kind === "reasoning"
        && item.id === latestReasoningId;
      if (index <= lastUserIndex || index === lastIndex) {
        nextTimelineItems.push(item);
        continue;
      }
      if (isMessageConversationItem(item)) {
        nextTimelineItems.push(item);
        continue;
      }
      if (shouldKeepLatestClaudeReasoningVisible) {
        nextTimelineItems.push(item);
        continue;
      }
      hiddenItems.push(item);
    }
    const collapsedEntryCount = countRenderableCollapsedEntries(hiddenItems, activeEngine);
    return hiddenItems.length > 0
      ? { timelineItems: nextTimelineItems, collapsedMiddleStepCount: collapsedEntryCount }
      : { timelineItems: timelineSourceItems, collapsedMiddleStepCount: 0 };
  }, [
    activeEngine,
    collapseLiveMiddleStepsEnabled,
    isThinking,
    latestAssistantMessageId,
    latestReasoningId,
    timelineSourceItems,
  ]);
  const latestReasoningVisibleInTimeline = useMemo(() => {
    if (!latestReasoningId) {
      return false;
    }
    return timelineItems.some((item) => item.kind === "reasoning" && item.id === latestReasoningId);
  }, [latestReasoningId, timelineItems]);
  const workingIndicatorShowsActivityLabel = shouldDisplayWorkingActivityLabel(
    latestReasoningLabel,
    latestWorkingActivityLabel,
  );
  const workingIndicatorReasoningLabel =
    activeEngine === "claude"
    && latestAssistantMessageId === null
    && workingIndicatorShowsActivityLabel
    && latestReasoningVisibleInTimeline
      ? null
      : latestReasoningLabel;
  useEffect(() => {
    if (activeEngine !== "claude") {
      return;
    }
    logClaudeRender("visible-items", {
      threadId,
      effectiveCount: effectiveItems.length,
      visibleCount: visibleItems.length,
      reasoningIds: visibleItems
        .filter((item) => item.kind === "reasoning")
        .map((item) => item.id),
      assistantIds: visibleItems
        .filter(
          (item): item is Extract<ConversationItem, { kind: "message" }> =>
            item.kind === "message" && item.role === "assistant",
        )
        .map((item) => item.id),
      latestReasoningId,
      latestAssistantMessageId,
      isThinking,
    });
  }, [
    activeEngine,
    effectiveItems.length,
    isThinking,
    latestAssistantMessageId,
    latestReasoningId,
    threadId,
    visibleItems,
  ]);
  const timelineCollapsedHistoryItemCount =
    !showAllHistoryItems && timelineItems.length > VISIBLE_MESSAGE_WINDOW
      ? timelineItems.length - VISIBLE_MESSAGE_WINDOW
      : 0;
  const collapsedHistoryItemCount =
    liveTailWorkingSet.omittedBeforeWorkingSetCount + timelineCollapsedHistoryItemCount;
  const renderedItemsWindow = useMemo(
    () =>
      buildRenderedItemsWindow(
        timelineItems,
        timelineCollapsedHistoryItemCount,
        liveTailWorkingSet.stickyUserMessageId,
      ),
    [
      liveTailWorkingSet.stickyUserMessageId,
      timelineCollapsedHistoryItemCount,
      timelineItems,
    ],
  );
  const renderedItems = renderedItemsWindow.renderedItems;
  const visibleCollapsedHistoryItemCount = collapsedHistoryItemCount > 0
    ? renderedItemsWindow.visibleCollapsedHistoryItemCount
      + liveTailWorkingSet.omittedBeforeWorkingSetCount
    : 0;
  const currentLatestAssistantTextLength = useMemo(
    () => findLatestAssistantTextLength(renderedItems),
    [renderedItems],
  );
  useEffect(() => {
    const currentThreadId = threadId ?? null;
    const currentTurnId = activeTurnId;
    if (
      preservedReadableWindowRef.current.threadId !== currentThreadId ||
      preservedReadableWindowRef.current.turnId !== currentTurnId
    ) {
      preservedReadableWindowRef.current = {
        threadId: currentThreadId,
        turnId: currentTurnId,
        renderedItems: renderedItems.length > 0 ? renderedItems : [],
        visibleCollapsedHistoryItemCount:
          renderedItems.length > 0 ? visibleCollapsedHistoryItemCount : 0,
      };
      return;
    }
    if (renderedItems.length > 0) {
      if (readableWindowRecoveryActive) {
        return;
      }
      preservedReadableWindowRef.current = {
        threadId: currentThreadId,
        turnId: currentTurnId,
        renderedItems,
        visibleCollapsedHistoryItemCount,
      };
      return;
    }
    if (!isThinking) {
      preservedReadableWindowRef.current = {
        threadId: currentThreadId,
        turnId: null,
        renderedItems: [],
        visibleCollapsedHistoryItemCount: 0,
      };
    }
  }, [
    activeTurnId,
    isThinking,
    readableWindowRecoveryActive,
    renderedItems,
    threadId,
    visibleCollapsedHistoryItemCount,
  ]);
  const preservedLatestAssistantTextLength = findLatestAssistantTextLength(
    preservedReadableWindowRef.current.renderedItems,
  );
  const recoveredReadableWindow = useMemo(() => {
    if (
      !readableWindowRecoveryActive ||
      preservedReadableWindowRef.current.threadId !== (threadId ?? null) ||
      preservedReadableWindowRef.current.turnId !== activeTurnId ||
      preservedReadableWindowRef.current.renderedItems.length === 0
    ) {
      return null;
    }
    return {
      renderedItems: mergeReadableRecoveryItems(
        preservedReadableWindowRef.current.renderedItems,
        renderedItems,
      ),
      visibleCollapsedHistoryItemCount:
        preservedReadableWindowRef.current.visibleCollapsedHistoryItemCount,
    };
  }, [activeTurnId, readableWindowRecoveryActive, renderedItems, threadId]);
  const shouldUseReadableWindowRecovery =
    recoveredReadableWindow !== null &&
    (
      (blankingRecoveryActive && renderedItems.length === 0) ||
      (
        visibleStallRecoveryActive &&
        currentLatestAssistantTextLength > 0 &&
        currentLatestAssistantTextLength < preservedLatestAssistantTextLength
      )
    );
  const presentationRenderedItems = shouldUseReadableWindowRecovery
    ? recoveredReadableWindow.renderedItems
    : renderedItems;
  const presentationCollapsedHistoryItemCount = shouldUseReadableWindowRecovery
    ? recoveredReadableWindow.visibleCollapsedHistoryItemCount
    : visibleCollapsedHistoryItemCount;
  const historyStickyCandidates = useMemo(() => {
    const candidates: HistoryStickyCandidate[] = [];
    for (const item of presentationRenderedItems) {
      if (!isOrdinaryUserQuestionItem(item, enableCollaborationBadge)) {
        continue;
      }
      const text = normalizeHistoryStickyHeaderText(
        resolveOrdinaryUserStickyText(item, enableCollaborationBadge),
      );
      if (!text) {
        continue;
      }
      candidates.push({
        id: item.id,
        text,
      });
    }
    return candidates;
  }, [enableCollaborationBadge, presentationRenderedItems]);
  const stickyCandidateById = useMemo(
    () => new Map(historyStickyCandidates.map((candidate) => [candidate.id, candidate])),
    [historyStickyCandidates],
  );
  const activeStickyHeaderCandidate = useMemo(
    () =>
      showStickyUserBubble && activeStickyMessageId
        ? stickyCandidateById.get(activeStickyMessageId) ?? null
        : null,
    [activeStickyMessageId, showStickyUserBubble, stickyCandidateById],
  );
  const messageAnchors = useMemo(() => {
    const messageItems = presentationRenderedItems.filter(
      (item): item is Extract<ConversationItem, { kind: "message" }> =>
        item.kind === "message" && item.role === "user",
    );
    if (!messageItems.length) {
      return [];
    }
    return messageItems.map((item, index) => {
      const position =
        messageItems.length === 1 ? 0.5 : 0.04 + (index / (messageItems.length - 1)) * 0.92;
      return {
        id: item.id,
        role: item.role,
        position,
      };
    });
  }, [presentationRenderedItems]);
  const suppressedUserNoteCardContextMessageIds = useMemo(
    () => buildSuppressedUserNoteCardContextMessageIdSet(presentationRenderedItems),
    [presentationRenderedItems],
  );
  const suppressedUserMemoryContextMessageIds = useMemo(
    () => buildSuppressedUserMemoryContextMessageIdSet(presentationRenderedItems),
    [presentationRenderedItems],
  );
  const hasAnchorRail = showMessageAnchors && messageAnchors.length > 1;
  const computeActiveStickyMessageId = useCallback(
    (candidates: HistoryStickyCandidate[]) => {
      const container = containerRef.current;
      if (!container || candidates.length === 0) {
        return null;
      }
      const topBoundaryY = container.scrollTop;
      let nextStickyId: string | null = null;
      for (const candidate of candidates) {
        const node = messageNodeByIdRef.current.get(candidate.id);
        if (!node) {
          continue;
        }
        if (node.offsetTop <= topBoundaryY) {
          nextStickyId = candidate.id;
        }
      }
      return nextStickyId;
    },
    [],
  );
  const scheduleAnchorUpdate = useCallback(
    (reason: "scroll" | "sync") => {
      if (!hasAnchorRail) {
        return;
      }
      if (anchorUpdateRafRef.current !== null) {
        return;
      }
      anchorUpdateRafRef.current = window.requestAnimationFrame(() => {
        anchorUpdateRafRef.current = null;
        const anchorStartedAt =
          typeof performance === "undefined" ? 0 : performance.now();
        const nextActiveAnchor =
          computeActiveAnchor() ?? messageAnchors[messageAnchors.length - 1]?.id ?? null;
        const elapsedMs =
          typeof performance === "undefined"
            ? 0
            : performance.now() - anchorStartedAt;
        if (elapsedMs >= MESSAGES_SLOW_ANCHOR_WARN_MS) {
          logMessagesPerf("anchor.compute", {
            ms: Number(elapsedMs.toFixed(2)),
            reason,
            anchorCount: messageAnchors.length,
            threadId,
          });
        }
        setActiveAnchorId((previous) =>
          previous === nextActiveAnchor ? previous : nextActiveAnchor,
        );
      });
    },
    [computeActiveAnchor, hasAnchorRail, messageAnchors, threadId],
  );
  const scheduleStickyHeaderUpdate = useCallback(
    (reason: "scroll" | "sync") => {
      if (!showStickyUserBubble || historyStickyCandidates.length === 0) {
        return;
      }
      if (historyStickyUpdateRafRef.current !== null) {
        return;
      }
      historyStickyUpdateRafRef.current = window.requestAnimationFrame(() => {
        historyStickyUpdateRafRef.current = null;
        const stickyStartedAt =
          typeof performance === "undefined" ? 0 : performance.now();
        const nextStickyId = computeActiveStickyMessageId(historyStickyCandidates);
        const elapsedMs =
          typeof performance === "undefined"
            ? 0
            : performance.now() - stickyStartedAt;
        if (elapsedMs >= MESSAGES_SLOW_ANCHOR_WARN_MS) {
          logMessagesPerf("sticky-header.compute", {
            ms: Number(elapsedMs.toFixed(2)),
            reason,
            candidateCount: historyStickyCandidates.length,
            threadId,
          });
        }
        setActiveStickyMessageId((previous) =>
          previous === nextStickyId ? previous : nextStickyId,
        );
      });
    },
    [
      computeActiveStickyMessageId,
      historyStickyCandidates,
      showStickyUserBubble,
      threadId,
    ],
  );
  const handleShowAllHistoryItems = useCallback(() => {
    pendingHistoryExpansionScrollSnapshotRef.current =
      collapsedHistoryItemCount > 0
        ? readHistoryExpansionScrollSnapshot(containerRef.current)
        : null;
    setShowAllHistoryItems(true);
  }, [collapsedHistoryItemCount]);
  useLayoutEffect(() => {
    if (!showAllHistoryItems) {
      pendingHistoryExpansionScrollSnapshotRef.current = null;
      return;
    }
    const pendingSnapshot = pendingHistoryExpansionScrollSnapshotRef.current;
    const container = containerRef.current;
    if (!pendingSnapshot || !container) {
      return;
    }
    pendingHistoryExpansionScrollSnapshotRef.current = null;
    if (!restoreHistoryExpansionScrollPosition(container, pendingSnapshot)) {
      return;
    }
    scheduleAnchorUpdate("sync");
    scheduleStickyHeaderUpdate("sync");
  }, [
    presentationRenderedItems,
    scheduleAnchorUpdate,
    scheduleStickyHeaderUpdate,
    showAllHistoryItems,
  ]);
  const updateAutoScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const nearBottom = isNearBottom(container);
    autoScrollRef.current = liveAutoFollowEnabled ? true : nearBottom;
    scheduleAnchorUpdate("scroll");
    scheduleStickyHeaderUpdate("scroll");
  }, [
    isNearBottom,
    liveAutoFollowEnabled,
    scheduleAnchorUpdate,
    scheduleStickyHeaderUpdate,
  ]);
  const clearTransientUiState = useCallback(() => {
    if (copyTimeoutRef.current) {
      window.clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = null;
    }
    if (anchorUpdateRafRef.current !== null) {
      window.cancelAnimationFrame(anchorUpdateRafRef.current);
      anchorUpdateRafRef.current = null;
    }
    if (historyStickyUpdateRafRef.current !== null) {
      window.cancelAnimationFrame(historyStickyUpdateRafRef.current);
      historyStickyUpdateRafRef.current = null;
    }
    if (planPanelFocusRafRef.current !== null) {
      window.cancelAnimationFrame(planPanelFocusRafRef.current);
      planPanelFocusRafRef.current = null;
    }
    if (planPanelFocusTimeoutRef.current !== null) {
      window.clearTimeout(planPanelFocusTimeoutRef.current);
      planPanelFocusTimeoutRef.current = null;
    }
    if (planPanelFocusNodeRef.current) {
      planPanelFocusNodeRef.current.classList.remove("plan-panel-focus-ring");
      planPanelFocusNodeRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!isMessagesPerfDebugEnabled()) {
      return;
    }
    const renderCostMs =
      typeof performance === "undefined"
        ? 0
        : performance.now() - renderStartedAt;
    const previous = lastRenderSnapshotRef.current;
    const changedKeys: string[] = [];
    if (previous) {
      if (previous.items !== effectiveItems) {
        changedKeys.push("items");
      }
      if (previous.userInputRequests !== userInputRequests) {
        changedKeys.push("userInputRequests");
      }
      if (previous.conversationState !== conversationState) {
        changedKeys.push("conversationState");
      }
      if (previous.presentationProfile !== presentationProfile) {
        changedKeys.push("presentationProfile");
      }
      if (previous.isThinking !== isThinking) {
        changedKeys.push("isThinking");
      }
      if (previous.heartbeatPulse !== heartbeatPulse) {
        changedKeys.push("heartbeatPulse");
      }
      if (previous.threadId !== threadId) {
        changedKeys.push("threadId");
      }
    }
    if (
      renderCostMs >= MESSAGES_SLOW_RENDER_WARN_MS ||
      changedKeys.includes("conversationState") ||
      changedKeys.includes("presentationProfile")
    ) {
      logMessagesPerf("render", {
        ms: Number(renderCostMs.toFixed(2)),
        items: effectiveItems.length,
        visibleItems: renderedItems.length,
        anchors: messageAnchors.length,
        threadId,
        changed: changedKeys,
      });
    }
    lastRenderSnapshotRef.current = {
      items: effectiveItems,
      userInputRequests,
      conversationState,
      presentationProfile,
      isThinking,
      heartbeatPulse,
      threadId,
    };
  });

  useEffect(() => {
    if (
      (activeEngine !== "claude" && activeEngine !== "codex" && activeEngine !== "gemini") ||
      (!isThinking && !isAssistantFinalizing) ||
      !threadId
    ) {
      return;
    }
    noteThreadVisibleRender(threadId, {
      visibleItemCount: renderedItems.length,
    });
  }, [activeEngine, isAssistantFinalizing, isThinking, renderedItems.length, threadId]);

  const handleAssistantVisibleTextRender = useCallback(
    (payload: { itemId: string; visibleText: string }) => {
      if (
        (activeEngine !== "claude" && activeEngine !== "codex" && activeEngine !== "gemini") ||
        (!isThinking && !isAssistantFinalizing) ||
        !threadId
      ) {
        return;
      }
      noteThreadVisibleTextRendered(threadId, {
        itemId: payload.itemId,
        visibleTextLength: payload.visibleText.length,
      });
      if (
        activeEngine === "codex" &&
        isAssistantFinalizing &&
        payload.itemId === finalizingAssistantMessageId
      ) {
        const targetItem = renderSourceItems.find(
          (item) =>
            isAssistantMessageConversationItem(item) &&
            item.id === payload.itemId,
        );
        const targetTextLength =
          targetItem && isAssistantMessageConversationItem(targetItem)
            ? targetItem.text.length
            : 0;
        if (targetTextLength > 0 && payload.visibleText.length >= targetTextLength) {
          if (assistantFinalizingTimerRef.current !== null) {
            window.clearTimeout(assistantFinalizingTimerRef.current);
            assistantFinalizingTimerRef.current = null;
          }
          setFinalizingAssistantMessageId(null);
        }
      }
    },
    [
      activeEngine,
      finalizingAssistantMessageId,
      isAssistantFinalizing,
      isThinking,
      renderSourceItems,
      threadId,
    ],
  );

  useEffect(() => clearTransientUiState, [clearTransientUiState]);

  useEffect(() => {
    if (!hasAnchorRail) {
      if (anchorUpdateRafRef.current !== null) {
        window.cancelAnimationFrame(anchorUpdateRafRef.current);
        anchorUpdateRafRef.current = null;
      }
      setActiveAnchorId(null);
      return;
    }
    scheduleAnchorUpdate("sync");
  }, [hasAnchorRail, messageAnchors, scheduleAnchorUpdate, scrollKey, threadId]);

  useEffect(() => {
    if (!showStickyUserBubble || historyStickyCandidates.length === 0) {
      if (historyStickyUpdateRafRef.current !== null) {
        window.cancelAnimationFrame(historyStickyUpdateRafRef.current);
        historyStickyUpdateRafRef.current = null;
      }
      setActiveStickyMessageId(null);
      return;
    }
    scheduleStickyHeaderUpdate("sync");
  }, [
    historyStickyCandidates,
    scheduleStickyHeaderUpdate,
    showStickyUserBubble,
    scrollKey,
    threadId,
  ]);

  const handleCopyMessage = useCallback(
    async (
      item: Extract<ConversationItem, { kind: "message" }>,
      copyText?: string,
    ) => {
      try {
        await navigator.clipboard.writeText(copyText ?? item.text);
        setCopiedMessageId(item.id);
        if (copyTimeoutRef.current) {
          window.clearTimeout(copyTimeoutRef.current);
        }
        copyTimeoutRef.current = window.setTimeout(() => {
          setCopiedMessageId(null);
        }, 1200);
      } catch {
        // No-op: clipboard errors can occur in restricted contexts.
      }
    },
    [],
  );

  useEffect(() => {
    if (!bottomRef.current) {
      return undefined;
    }
    if (!liveAutoFollowEnabled) {
      return undefined;
    }
    const container = containerRef.current;
    const shouldScroll =
      liveAutoFollowEnabled ||
      autoScrollRef.current ||
      (container ? isNearBottom(container) : true);
    if (!shouldScroll) {
      return undefined;
    }
    let raf = 0;
    const target = bottomRef.current;
    // Use instant scroll during streaming to avoid blocking the main thread
    // with smooth-scroll animations that compete with keyboard input events.
    const scrollBehavior =
      isThinking || isAssistantFinalizing ? "instant" as const : "smooth" as const;
    raf = window.requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: scrollBehavior, block: "end" });
    });
    return () => {
      if (raf) {
        window.cancelAnimationFrame(raf);
      }
    };
  }, [isAssistantFinalizing, scrollKey, isThinking, isNearBottom, liveAutoFollowEnabled]);

  const groupedEntries = useMemo(
    () => groupToolItems(presentationRenderedItems),
    [presentationRenderedItems],
  );
  const liveAutoExpandedExploreId = useMemo(
    () => resolveLiveAutoExpandedExploreId(groupedEntries, isThinking),
    [groupedEntries, isThinking],
  );
  useEffect(() => {
    if (!isThinking || liveAutoExpandedExploreId !== null) {
      return;
    }
    setExpandedItems((prev) => collapseExpandedExploreItems(prev, effectiveItems));
  }, [effectiveItems, isThinking, liveAutoExpandedExploreId]);
  const assistantFinalBoundarySet = useMemo(() => {
    const ids = new Set<string>();
    let lastFinalAssistantIdInTurn: string | null = null;
    presentationRenderedItems.forEach((entry) => {
      if (entry.kind === "message" && entry.role === "user") {
        if (lastFinalAssistantIdInTurn) {
          ids.add(lastFinalAssistantIdInTurn);
        }
        lastFinalAssistantIdInTurn = null;
        return;
      }
      if (
        entry.kind === "message" &&
        entry.role === "assistant" &&
        entry.isFinal === true
      ) {
        lastFinalAssistantIdInTurn = entry.id;
      }
    });
    if (lastFinalAssistantIdInTurn) {
      ids.add(lastFinalAssistantIdInTurn);
    }
    return ids;
  }, [presentationRenderedItems]);
  const assistantFinalWithVisibleProcessSet = useMemo(() => {
    const ids = new Set<string>();
    let hasVisibleProcessItemsInTurn = false;
    let lastFinalAssistantIdInTurn: string | null = null;
    let lastFinalAssistantHasProcessInTurn = false;
    const flushTurn = () => {
      if (
        lastFinalAssistantIdInTurn &&
        lastFinalAssistantHasProcessInTurn &&
        assistantFinalBoundarySet.has(lastFinalAssistantIdInTurn)
      ) {
        ids.add(lastFinalAssistantIdInTurn);
      }
      lastFinalAssistantIdInTurn = null;
      lastFinalAssistantHasProcessInTurn = false;
    };
    presentationRenderedItems.forEach((entry) => {
      if (entry.kind === "message" && entry.role === "user") {
        flushTurn();
        hasVisibleProcessItemsInTurn = false;
        return;
      }
      if (entry.kind === "reasoning" || entry.kind === "tool") {
        hasVisibleProcessItemsInTurn = true;
        return;
      }
      if (
        entry.kind === "message" &&
        entry.role === "assistant" &&
        entry.isFinal === true
      ) {
        lastFinalAssistantIdInTurn = entry.id;
        lastFinalAssistantHasProcessInTurn = hasVisibleProcessItemsInTurn;
      }
    });
    flushTurn();
    return ids;
  }, [assistantFinalBoundarySet, presentationRenderedItems]);
  const assistantLiveTurnFinalBoundarySuppressedSet = useMemo(() => {
    const ids = new Set<string>();
    if (!liveAssistantMessageId) {
      return ids;
    }
    let lastUserIndex = -1;
    for (let index = presentationRenderedItems.length - 1; index >= 0; index -= 1) {
      const entry = presentationRenderedItems[index];
      if (entry?.kind === "message" && entry.role === "user") {
        lastUserIndex = index;
        break;
      }
    }
    if (lastUserIndex < 0) {
      return ids;
    }
    for (
      let index = lastUserIndex + 1;
      index < presentationRenderedItems.length;
      index += 1
    ) {
      const entry = presentationRenderedItems[index];
      if (
        entry?.kind === "message" &&
        entry.role === "assistant" &&
        entry.isFinal === true &&
        assistantFinalBoundarySet.has(entry.id) &&
        (isThinking || entry.id === liveAssistantMessageId)
      ) {
        ids.add(entry.id);
      }
    }
    return ids;
  }, [assistantFinalBoundarySet, isThinking, liveAssistantMessageId, presentationRenderedItems]);

  const shouldRenderUserInputNode =
    (activeEngine === "codex" || activeEngine === "claude") &&
    Boolean(legacyOnUserInputSubmit);
  const visibleApprovals = useMemo(() => {
    return getVisibleApprovalsForThread(approvals, workspaceId, threadId);
  }, [approvals, threadId, workspaceId]);
  const approvalNode =
    visibleApprovals.length > 0 && onApprovalDecision
      ? (
        <div className="messages-inline-approval-slot">
          <ApprovalToasts
            approvals={visibleApprovals}
            workspaces={workspaces}
            onDecision={onApprovalDecision}
            onApproveBatch={onApprovalBatchAccept}
            onRemember={onApprovalRemember}
            variant="inline"
          />
        </div>
      )
      : null;
  const userInputNode =
    shouldRenderUserInputNode && legacyOnUserInputSubmit
      ? (
        <RequestUserInputMessage
          requests={userInputRequests}
          activeThreadId={threadId ?? null}
          activeWorkspaceId={workspaceId ?? null}
          onSubmit={legacyOnUserInputSubmit}
        />
      )
      : null;
  const hasVisibleUserInputRequest =
    shouldRenderUserInputNode &&
    Boolean(legacyOnUserInputSubmit) &&
    activeUserInputRequestId !== null;

  const scrollToAnchor = useCallback((messageId: string) => {
    const node = messageNodeByIdRef.current.get(messageId);
    const container = containerRef.current;
    if (!node || !container) {
      return;
    }
    const containerRect = container.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    const targetTop =
      container.scrollTop + (nodeRect.top - containerRect.top) - container.clientHeight * 0.28;
    autoScrollRef.current = false;
    container.scrollTo({
      top: Math.max(0, targetTop),
      behavior: "smooth",
    });
    setActiveAnchorId((previous) => (previous === messageId ? previous : messageId));
  }, []);

  useEffect(() => {
    if (!pendingJumpMessageId) {
      return;
    }
    const targetNode = messageNodeByIdRef.current.get(pendingJumpMessageId);
    if (!targetNode) {
      return;
    }
    scrollToAnchor(pendingJumpMessageId);
    setPendingJumpMessageId(null);
  }, [pendingJumpMessageId, presentationRenderedItems, scrollToAnchor]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }
    const handleJumpToMessage = (event: Event) => {
      const messageId =
        event instanceof CustomEvent && typeof event.detail === "string" ? event.detail : "";
      if (!messageId) {
        return;
      }
      if (!messageNodeByIdRef.current.get(messageId) && !showAllHistoryItems) {
        setPendingJumpMessageId(messageId);
        handleShowAllHistoryItems();
        return;
      }
      scrollToAnchor(messageId);
    };
    document.addEventListener(MESSAGE_JUMP_EVENT_NAME, handleJumpToMessage);
    return () => {
      document.removeEventListener(MESSAGE_JUMP_EVENT_NAME, handleJumpToMessage);
    };
  }, [handleShowAllHistoryItems, scrollToAnchor, showAllHistoryItems]);

  return (
    <div
      className={`messages-shell${hasAnchorRail ? " has-anchor-rail" : ""}${enableClaudeRenderSafeMode ? " claude-render-safe" : ""}`}
    >
      {hasAnchorRail && (
        <div
          className="messages-anchor-rail"
          role="navigation"
          aria-label={t("messages.anchorNavigation")}
        >
          <div className="messages-anchor-track" aria-hidden />
          {messageAnchors.map((anchor, index) => {
            const isActive = activeAnchorId === anchor.id;
            return (
              <div
                key={anchor.id}
                role="button"
                tabIndex={0}
                className={`messages-anchor-dot${isActive ? " is-active" : ""}`}
                style={{ top: `${anchor.position * 100}%` }}
                onClick={() => scrollToAnchor(anchor.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    scrollToAnchor(anchor.id);
                  }
                }}
                aria-label={t("messages.anchorJumpToUser", { index: index + 1 })}
                title={t("messages.anchorUserTitle", { index: index + 1 })}
              />
            );
          })}
        </div>
      )}
      <div
        className="messages"
        ref={containerRef}
        onScroll={updateAutoScroll}
      >
        <MessagesTimeline
          activeCollaborationModeId={activeCollaborationModeId}
          activeEngine={activeEngine}
          activeStickyHeaderCandidate={activeStickyHeaderCandidate}
          activeUserInputRequestId={activeUserInputRequestId}
          agentTaskNodeByTaskIdRef={agentTaskNodeByTaskIdRef}
          agentTaskNodeByToolUseIdRef={agentTaskNodeByToolUseIdRef}
          approvalNode={approvalNode}
          assistantFinalBoundarySet={assistantFinalBoundarySet}
          assistantFinalWithVisibleProcessSet={assistantFinalWithVisibleProcessSet}
          assistantLiveTurnFinalBoundarySuppressedSet={assistantLiveTurnFinalBoundarySuppressedSet}
          bottomRef={bottomRef}
          claudeDockedReasoningItems={claudeDockedReasoningItems}
          collapseLiveMiddleStepsEnabled={collapseLiveMiddleStepsEnabled}
          collapsedMiddleStepCount={collapsedMiddleStepCount}
          codeBlockCopyUseModifier={codeBlockCopyUseModifier}
          copiedMessageId={copiedMessageId}
          effectiveItemsCount={presentationRenderedItems.length}
          expandedItems={expandedItems}
          groupedEntries={groupedEntries}
          handleCopyMessage={handleCopyMessage}
          handleExitPlanModeExecuteForItem={handleExitPlanModeExecuteForItem}
          heartbeatPulse={heartbeatPulse}
          isHistoryLoading={isHistoryLoading}
          isThinking={isThinking}
          isWorking={isWorking}
          lastDurationMs={lastDurationMs}
          liveAssistantMessageId={liveAssistantMessageId}
          latestReasoningLabel={workingIndicatorReasoningLabel}
          latestReasoningId={latestReasoningId}
          latestRetryMessage={latestRetryMessage}
          latestRuntimeReconnectItemId={latestRuntimeReconnectItemId}
          latestWorkingActivityLabel={latestWorkingActivityLabel}
          liveAutoExpandedExploreId={liveAutoExpandedExploreId}
          messageNodeByIdRef={messageNodeByIdRef}
          onOpenDiffPath={onOpenDiffPath}
          onRecoverThreadRuntime={onRecoverThreadRuntime}
          onRecoverThreadRuntimeAndResend={onRecoverThreadRuntimeAndResend}
          onAssistantVisibleTextRender={handleAssistantVisibleTextRender}
          onShowAllHistoryItems={handleShowAllHistoryItems}
          openFileLink={openFileLink}
          presentationProfile={presentationProfile}
          primaryWorkingLabel={primaryWorkingLabel}
          processingStartedAt={processingStartedAt}
          proxyEnabled={proxyEnabled}
          proxyUrl={proxyUrl}
          reasoningMetaById={reasoningMetaById}
          requestAutoScroll={requestAutoScroll}
          selectedExitPlanExecutionByItemKey={selectedExitPlanExecutionByItemKey}
          showFileLinkMenu={showFileLinkMenu}
          streamMitigationProfile={activeStreamMitigation}
          streamActivityPhase={streamActivityPhase}
          suppressedUserMemoryContextMessageIds={suppressedUserMemoryContextMessageIds}
          threadId={threadId}
          toggleExpanded={toggleExpanded}
          suppressedUserNoteCardContextMessageIds={suppressedUserNoteCardContextMessageIds}
          hasVisibleUserInputRequest={hasVisibleUserInputRequest}
          userInputNode={userInputNode}
          visibleCollapsedHistoryItemCount={presentationCollapsedHistoryItemCount}
          waitingForFirstChunk={waitingForFirstChunk}
          workspaceId={workspaceId}
        />
      </div>
    </div>
  );
});
