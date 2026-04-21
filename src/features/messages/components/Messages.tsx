import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, startTransition } from "react";
import { useTranslation } from "react-i18next";
import { convertFileSrc } from "@tauri-apps/api/core";
import Bell from "lucide-react/dist/esm/icons/bell";
import Check from "lucide-react/dist/esm/icons/check";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronUp from "lucide-react/dist/esm/icons/chevron-up";
import Copy from "lucide-react/dist/esm/icons/copy";
import Flag from "lucide-react/dist/esm/icons/flag";
import Terminal from "lucide-react/dist/esm/icons/terminal";
import { AgentIcon } from "../../../components/AgentIcon";
import { ProxyStatusBadge } from "../../../components/ProxyStatusBadge";
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
import type { ConversationEngine, ConversationState } from "../../threads/contracts/conversationCurtainContracts";
import type { AgentTaskScrollRequest } from "../types";
import { Markdown } from "./Markdown";
import { CollapsibleUserTextBlock } from "./CollapsibleUserTextBlock";
import { DiffBlock } from "../../git/components/DiffBlock";
import { languageFromPath } from "../../../utils/syntax";
import { useFileLinkOpener } from "../hooks/useFileLinkOpener";
import {
  groupToolItems,
  shouldHideToolItemForRender,
  type GroupedEntry,
} from "../utils/groupToolItems";
import {
  ToolBlockRenderer,
  ReadToolGroupBlock,
  EditToolGroupBlock,
  BashToolGroupBlock,
  SearchToolGroupBlock,
} from "./toolBlocks";
import { buildCommandSummary, extractToolName, isBashTool } from "./toolBlocks/toolConstants";
import type { PresentationProfile } from "../presentation/presentationProfile";
import { ApprovalToasts } from "../../app/components/ApprovalToasts";
import { RequestUserInputMessage } from "../../app/components/RequestUserInputMessage";
import { ImageLightbox, MessageImageGrid, type MessageImage } from "./MessageMediaBlocks";
import {
  MESSAGES_LIVE_AUTO_FOLLOW_FLAG_KEY,
  MESSAGES_LIVE_COLLAPSE_MIDDLE_STEPS_FLAG_KEY,
  MESSAGES_LIVE_CONTROLS_UPDATED_EVENT,
  readLocalBooleanFlag,
  writeLocalBooleanFlag,
} from "../constants/liveCanvasControls";
import { parseMemoryContextSummary } from "./messagesMemoryContext";
import { useStreamActivityPhase, type StreamActivityPhase } from "../../threads/hooks/useStreamActivityPhase";
import {
  collapseConsecutiveReasoningRuns,
  compactComparableReasoningText,
  dedupeAdjacentReasoningItems,
  isExplicitReasoningSegmentId,
  parseReasoning,
} from "./messagesReasoning";
import {
  buildRenderedItemsWindow,
  collapseExpandedExploreItems,
  findLatestOrdinaryUserQuestionId,
  isOrdinaryUserQuestionItem,
  resolveLiveAutoExpandedExploreId,
} from "./messagesLiveWindow";
import {
  isAssistantMessageConversationItem,
  isMessageConversationItem,
  isReasoningConversationItem,
  isUserMessageConversationItem,
} from "./messageItemPredicates";
import { resolveUserMessagePresentation } from "./messagesUserPresentation";
import { parseAgentTaskNotification } from "../utils/agentTaskNotification";
import { dedupeExitPlanItemsKeepFirst } from "./messagesExitPlan";
import { RuntimeReconnectCard } from "./RuntimeReconnectCard";
import { resolveAssistantRuntimeReconnectHint, resolveRetryMessageForReconnectItem } from "./runtimeReconnect";

type MessagesProps = {
  items: ConversationItem[];
  threadId: string | null;
  workspaceId?: string | null;
  isThinking: boolean;
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
    decision: "accept" | "decline",
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
  ) => Promise<string | null | void> | string | null | void;
  onRecoverThreadRuntimeAndResend?: (
    workspaceId: string,
    threadId: string,
    message: Pick<QueuedMessage, "text" | "images">,
  ) => Promise<string | null | void> | string | null | void;
};

type WorkingIndicatorProps = {
  isThinking: boolean;
  proxyEnabled?: boolean;
  proxyUrl?: string | null;
  processingStartedAt?: number | null;
  lastDurationMs?: number | null;
  heartbeatPulse?: number;
  hasItems: boolean;
  reasoningLabel?: string | null;
  activityLabel?: string | null;
  activeEngine?: "claude" | "codex" | "gemini" | "opencode";
  waitingForFirstChunk?: boolean;
  presentationProfile?: PresentationProfile | null;
  streamActivityPhase?: StreamActivityPhase;
  primaryLabel?: string | null;
};

type MessageRowProps = {
  item: Extract<ConversationItem, { kind: "message" }>;
  workspaceId?: string | null;
  threadId?: string | null;
  isStreaming?: boolean;
  activeEngine?: "claude" | "codex" | "gemini" | "opencode";
  activeCollaborationModeId?: string | null;
  enableCollaborationBadge?: boolean;
  presentationProfile?: PresentationProfile | null;
  showRuntimeReconnectCard?: boolean;
  onRecoverThreadRuntime?: (
    workspaceId: string,
    threadId: string,
  ) => Promise<string | null | void> | string | null | void;
  onRecoverThreadRuntimeAndResend?: (
    workspaceId: string,
    threadId: string,
    message: Pick<QueuedMessage, "text" | "images">,
  ) => Promise<string | null | void> | string | null | void;
  retryMessage?: Pick<QueuedMessage, "text" | "images"> | null;
  isCopied: boolean;
  onCopy: (
    item: Extract<ConversationItem, { kind: "message" }>,
    copyText?: string,
  ) => void;
  codeBlockCopyUseModifier?: boolean;
  onOpenFileLink?: (path: string) => void;
  onOpenFileLinkMenu?: (event: React.MouseEvent, path: string) => void;
};

type ReasoningRowProps = {
  item: Extract<ConversationItem, { kind: "reasoning" }>;
  workspaceId?: string | null;
  parsed: ReturnType<typeof parseReasoning>;
  isExpanded: boolean;
  isLive: boolean;
  activeEngine?: "claude" | "codex" | "gemini" | "opencode";
  onToggle: (id: string) => void;
  onOpenFileLink?: (path: string) => void;
  onOpenFileLinkMenu?: (event: React.MouseEvent, path: string) => void;
};

type ReviewRowProps = {
  item: Extract<ConversationItem, { kind: "review" }>;
  workspaceId?: string | null;
  onOpenFileLink?: (path: string) => void;
  onOpenFileLinkMenu?: (event: React.MouseEvent, path: string) => void;
};

type DiffRowProps = {
  item: Extract<ConversationItem, { kind: "diff" }>;
};

type ExploreRowProps = {
  item: Extract<ConversationItem, { kind: "explore" }>;
  isExpanded: boolean;
  onToggle: (id: string) => void;
};

function areMessageImagesEqual(
  previous: Extract<ConversationItem, { kind: "message" }>["images"],
  next: Extract<ConversationItem, { kind: "message" }>["images"],
) {
  if (previous === next) {
    return true;
  }
  if (!previous?.length && !next?.length) {
    return true;
  }
  if (!previous || !next || previous.length !== next.length) {
    return false;
  }
  return previous.every((image, index) => image === next[index]);
}

function areMessageItemsEqual(
  previous: Extract<ConversationItem, { kind: "message" }>,
  next: Extract<ConversationItem, { kind: "message" }>,
) {
  return (
    previous === next ||
    (
      previous.id === next.id &&
      previous.role === next.role &&
      previous.text === next.text &&
      previous.engineSource === next.engineSource &&
      previous.isFinal === next.isFinal &&
      previous.finalCompletedAt === next.finalCompletedAt &&
      previous.finalDurationMs === next.finalDurationMs &&
      previous.selectedAgentName === next.selectedAgentName &&
      previous.selectedAgentIcon === next.selectedAgentIcon &&
      areMessageImagesEqual(previous.images, next.images)
    )
  );
}

function areMessageRowPropsEqual(
  previous: MessageRowProps,
  next: MessageRowProps,
) {
  return (
    areMessageItemsEqual(previous.item, next.item) &&
    previous.workspaceId === next.workspaceId &&
    previous.threadId === next.threadId &&
    previous.isStreaming === next.isStreaming &&
    previous.activeEngine === next.activeEngine &&
    previous.enableCollaborationBadge === next.enableCollaborationBadge &&
    previous.presentationProfile === next.presentationProfile &&
    previous.showRuntimeReconnectCard === next.showRuntimeReconnectCard &&
    previous.onRecoverThreadRuntime === next.onRecoverThreadRuntime &&
    previous.onRecoverThreadRuntimeAndResend === next.onRecoverThreadRuntimeAndResend &&
    previous.retryMessage?.text === next.retryMessage?.text &&
    areMessageImagesEqual(previous.retryMessage?.images, next.retryMessage?.images) &&
    previous.isCopied === next.isCopied &&
    previous.onCopy === next.onCopy &&
    previous.codeBlockCopyUseModifier === next.codeBlockCopyUseModifier &&
    previous.onOpenFileLink === next.onOpenFileLink &&
    previous.onOpenFileLinkMenu === next.onOpenFileLinkMenu
  );
}

function isSelectionInsideNode(selection: Selection | null, node: HTMLElement | null) {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !node) {
    return false;
  }
  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index);
    if (node.contains(range.commonAncestorContainer)) {
      return true;
    }
  }
  return false;
}

const SCROLL_THRESHOLD_PX = 120;
const OPENCODE_NON_STREAMING_HINT_DELAY_MS = 12_000;
const MESSAGES_PERF_DEBUG_FLAG_KEY = "ccgui.debug.messages.perf";
const CLAUDE_HIDE_REASONING_MODULE_FLAG_KEY = "ccgui.claude.hideReasoningModule";
const CLAUDE_RENDER_DEBUG_FLAG_KEY = "ccgui.debug.claude.render";

const MESSAGES_SLOW_RENDER_WARN_MS = 18;
const MESSAGES_SLOW_ANCHOR_WARN_MS = 8;
const VISIBLE_MESSAGE_WINDOW = 30;

function isMessagesPerfDebugEnabled(): boolean {
  if (!import.meta.env.DEV) {
    return false;
  }
  if (typeof window === "undefined") {
    return false;
  }
  return window.localStorage.getItem(MESSAGES_PERF_DEBUG_FLAG_KEY) === "1";
}

function shouldHideClaudeReasoningModule(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    const value = window.localStorage.getItem(CLAUDE_HIDE_REASONING_MODULE_FLAG_KEY);
    if (!value) {
      return false;
    }
    const normalized = value.trim().toLowerCase();
    return !(normalized === "0" || normalized === "false" || normalized === "off");
  } catch {
    return false;
  }
}

function isClaudeRenderDebugEnabled(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    const value = window.localStorage.getItem(CLAUDE_RENDER_DEBUG_FLAG_KEY);
    if (!value) {
      return false;
    }
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "on";
  } catch {
    return false;
  }
}

function logClaudeRender(label: string, payload: Record<string, unknown>) {
  if (!isClaudeRenderDebugEnabled()) {
    return;
  }
  console.info(`[messages][claude-render] ${label}`, payload);
}

function logMessagesPerf(label: string, payload: Record<string, unknown>): void {
  if (!isMessagesPerfDebugEnabled()) {
    return;
  }
  console.info(`[messages][perf] ${label}`, payload);
}

function normalizeAgentTaskStatus(value: string | null | undefined) {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized) {
    return { label: "agent", tone: "neutral" as const };
  }
  if (/(fail|error|cancel(?:led)?|abort|timeout|timed[_ -]?out)/.test(normalized)) {
    return { label: value?.trim() ?? "error", tone: "error" as const };
  }
  if (/(complete|completed|success|done|finish(?:ed)?)/.test(normalized)) {
    return { label: value?.trim() ?? "completed", tone: "completed" as const };
  }
  if (/(running|processing|started|in[_ -]?progress|queued|pending)/.test(normalized)) {
    return { label: value?.trim() ?? "running", tone: "running" as const };
  }
  return { label: value?.trim() ?? normalized, tone: "neutral" as const };
}

function basenameFromPath(value: string | null | undefined) {
  const normalized = (value ?? "").trim();
  if (!normalized) {
    return null;
  }
  const segments = normalized.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? normalized;
}

function resolveAgentTaskDisplaySummary(summary: string | null | undefined) {
  const normalized = (summary ?? "").trim();
  if (!normalized) {
    return {
      title: "Agent result",
      subtitle: null as string | null,
    };
  }
  const match =
    /Agent\s+["“]?([^"”]+)["”]?/i.exec(normalized)
    ?? /智能体\s*["“]?([^"”]+)["”]?/i.exec(normalized);
  const title = match?.[1]?.trim() || normalized;
  return {
    title,
    subtitle: title === normalized ? null : normalized,
  };
}

function toConversationEngine(
  engine: "claude" | "codex" | "gemini" | "opencode",
): ConversationEngine {
  if (engine === "claude" || engine === "gemini" || engine === "opencode") {
    return engine;
  }
  return "codex";
}

function resolveProvenanceEngineLabel(
  engineSource: string | null | undefined,
): string | null {
  const normalized = (engineSource ?? "").trim().toLowerCase();
  if (normalized === "claude") {
    return "Claude";
  }
  if (normalized === "gemini") {
    return "Gemini";
  }
  if (normalized === "opencode") {
    return "OpenCode";
  }
  if (normalized === "codex") {
    return "Codex";
  }
  return null;
}

function resolveRenderableItems({
  legacyItems,
  legacyThreadId: _legacyThreadId,
  legacyWorkspaceId: _legacyWorkspaceId,
  conversationState,
}: {
  legacyItems: ConversationItem[];
  legacyThreadId: string | null;
  legacyWorkspaceId: string | null;
  conversationState: ConversationState | null;
}) {
  if (!conversationState) {
    return legacyItems;
  }
  return conversationState.items;
}

function normalizeMessageImageSrc(path: string) {
  if (!path) {
    return "";
  }
  if (path.startsWith("data:") || path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  if (path.startsWith("file://")) {
    return path;
  }
  try {
    return convertFileSrc(path);
  } catch {
    return "";
  }
}

function formatDurationMs(durationMs: number) {
  const durationSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const durationHours = Math.floor(durationSeconds / 3600);
  const durationMinutes = Math.floor(durationSeconds / 60);
  const durationRemainder = durationSeconds % 60;
  if (durationHours > 0) {
    const remainderMinutes = durationMinutes % 60;
    return `${durationHours}:${String(remainderMinutes).padStart(2, "0")}:${String(durationRemainder).padStart(2, "0")}`;
  }
  return `${durationMinutes}:${String(durationRemainder).padStart(2, "0")}`;
}

function formatCompletedTimeMs(timestampMs: number) {
  const date = new Date(timestampMs);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function scrollKeyForItems(items: ConversationItem[]) {
  if (!items.length) {
    return "empty";
  }
  const last = items[items.length - 1];
  if (!last) {
    return "empty";
  }
  switch (last.kind) {
    case "message":
      return `${last.id}-${last.text.length}`;
    case "reasoning":
      return `${last.id}-${last.summary.length}-${last.content.length}`;
    case "explore":
      return `${last.id}-${last.status}-${last.entries.length}`;
    case "tool":
      return `${last.id}-${last.status ?? ""}-${last.output?.length ?? 0}`;
    case "diff":
      return `${last.id}-${last.status ?? ""}-${last.diff.length}`;
    case "review":
      return `${last.id}-${last.state}-${last.text.length}`;
    default: {
      const _exhaustive: never = last;
      return _exhaustive;
    }
  }
}

function resolveCodexCommandActivityLabel(item: Extract<ConversationItem, { kind: "tool" }>) {
  return buildCommandSummary(item, { includeDetail: false });
}

function shouldHideCodexCanvasCommandCard(
  item: Extract<ConversationItem, { kind: "tool" }>,
  activeEngine: "claude" | "codex" | "gemini" | "opencode",
) {
  if (activeEngine !== "codex" && activeEngine !== "claude") {
    return false;
  }
  const normalizedToolName = extractToolName(item.title)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (
    normalizedToolName === "exitplanmode" ||
    normalizedToolName.endsWith("exitplanmode")
  ) {
    return false;
  }
  if (item.toolType === "commandExecution") {
    return true;
  }
  return isBashTool(extractToolName(item.title).toLowerCase());
}

function countRenderableCollapsedEntries(
  items: ConversationItem[],
  activeEngine: "claude" | "codex" | "gemini" | "opencode",
) {
  if (items.length === 0) {
    return 0;
  }
  return groupToolItems(items).reduce((count, entry) => {
    if (entry.kind === "bashGroup") {
      return activeEngine === "codex" || activeEngine === "claude" ? count : count + 1;
    }
    if (
      entry.kind === "item" &&
      entry.item.kind === "tool" &&
      shouldHideCodexCanvasCommandCard(entry.item, activeEngine)
    ) {
      return count;
    }
    return count + 1;
  }, 0);
}

function resolveWorkingActivityLabel(
  item: ConversationItem,
  activeEngine: "claude" | "codex" | "gemini" | "opencode" = "claude",
  presentationProfile: PresentationProfile | null = null,
) {
  if (item.kind === "reasoning") {
    const parsed = parseReasoning(item);
    return parsed.workingLabel;
  }
  if (item.kind === "explore") {
    const lastEntry = item.entries[item.entries.length - 1];
    if (!lastEntry) {
      return item.status === "exploring" ? "Exploring..." : "Explored";
    }
    return lastEntry.detail ? `${lastEntry.label} (${lastEntry.detail})` : lastEntry.label;
  }
  if (item.kind === "tool") {
    const title = item.title?.trim();
    const detail = item.detail?.trim();
    const preferCommandSummary = presentationProfile
      ? presentationProfile.preferCommandSummary
      : activeEngine === "codex";
    if (preferCommandSummary) {
      const codexCommand = resolveCodexCommandActivityLabel(item);
      if (codexCommand) {
        return codexCommand;
      }
    }
    if (!title) {
      return null;
    }
    if (detail && item.toolType === "commandExecution") {
      return `${title} @ ${detail}`;
    }
    return title;
  }
  if (item.kind === "diff") {
    return item.title?.trim() || null;
  }
  if (item.kind === "review") {
    return item.state === "started" ? "Review started" : "Review completed";
  }
  return null;
}

function findLastUserMessageIndex(items: ConversationItem[]) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (isUserMessageConversationItem(item)) {
      return index;
    }
  }
  return -1;
}

function findLastAssistantMessageIndex(items: ConversationItem[]) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (isAssistantMessageConversationItem(item)) {
      return index;
    }
  }
  return -1;
}

function shouldDisplayWorkingActivityLabel(
  reasoningLabel: string | null,
  activityLabel: string | null,
) {
  if (!activityLabel) {
    return false;
  }
  if (!reasoningLabel) {
    return true;
  }
  const compactReasoning = compactComparableReasoningText(reasoningLabel);
  const compactActivity = compactComparableReasoningText(activityLabel);
  if (!compactReasoning || !compactActivity) {
    return true;
  }
  if (compactReasoning === compactActivity) {
    return false;
  }
  if (compactReasoning.length >= 12 && compactActivity.includes(compactReasoning)) {
    return false;
  }
  if (compactActivity.length >= 12 && compactReasoning.includes(compactActivity)) {
    return false;
  }
  return true;
}

const WorkingIndicator = memo(function WorkingIndicator({
  isThinking,
  proxyEnabled = false,
  proxyUrl = null,
  processingStartedAt = null,
  lastDurationMs = null,
  heartbeatPulse = 0,
  hasItems,
  reasoningLabel = null,
  activityLabel = null,
  activeEngine = "claude",
  waitingForFirstChunk = false,
  presentationProfile = null,
  streamActivityPhase = "idle",
  primaryLabel = null,
}: WorkingIndicatorProps) {
  const { t } = useTranslation();
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    if (!isThinking || !processingStartedAt) {
      setElapsedMs(0);
      return undefined;
    }
    setElapsedMs(Date.now() - processingStartedAt);
    const interval = window.setInterval(() => {
      setElapsedMs(Date.now() - processingStartedAt);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [isThinking, processingStartedAt]);

  const showNonStreamingHint =
    (presentationProfile?.heartbeatWaitingHint ?? activeEngine === "opencode") &&
    isThinking &&
    waitingForFirstChunk &&
    elapsedMs >= OPENCODE_NON_STREAMING_HINT_DELAY_MS;
  const showActivityLabel = shouldDisplayWorkingActivityLabel(
    reasoningLabel,
    activityLabel,
  );
  const supportsStreamActivityPhaseFx =
    activeEngine === "codex" || activeEngine === "claude" || activeEngine === "gemini";
  const streamPhaseClass =
    supportsStreamActivityPhaseFx && streamActivityPhase !== "idle"
      ? ` is-${streamActivityPhase}`
      : "";
  const nonStreamingHintText = t("messages.nonStreamingHint");
  const resolvedNonStreamingHint =
    nonStreamingHintText === "messages.nonStreamingHint"
      ? "This model may return non-streaming output, or the network may be unreachable. Please wait..."
      : nonStreamingHintText;
  const heartbeatHints = useMemo(() => {
    const keys = [
      "messages.opencodeHeartbeatHint1",
      "messages.opencodeHeartbeatHint2",
      "messages.opencodeHeartbeatHint3",
      "messages.opencodeHeartbeatHint4",
      "messages.opencodeHeartbeatHint5",
    ];
    const translated = keys
      .map((key) => t(key))
      .filter((value, index) => value !== keys[index]);
    if (translated.length > 0) {
      return translated;
    }
    return [resolvedNonStreamingHint];
  }, [resolvedNonStreamingHint, t]);
  const [heartbeatHintText, setHeartbeatHintText] = useState("");
  const heartbeatStateRef = useRef<{ lastPulse: number; lastIndex: number }>({
    lastPulse: 0,
    lastIndex: -1,
  });

  useEffect(() => {
    if (!showNonStreamingHint) {
      heartbeatStateRef.current = { lastPulse: 0, lastIndex: -1 };
      setHeartbeatHintText("");
      return;
    }
    if (heartbeatPulse <= 0 || heartbeatPulse === heartbeatStateRef.current.lastPulse) {
      return;
    }
    heartbeatStateRef.current.lastPulse = heartbeatPulse;
    let randomIndex = Math.floor(Math.random() * heartbeatHints.length);
    if (heartbeatHints.length > 1 && randomIndex === heartbeatStateRef.current.lastIndex) {
      randomIndex = (randomIndex + 1) % heartbeatHints.length;
    }
    heartbeatStateRef.current.lastIndex = randomIndex;
    const pulseText = t("messages.opencodeHeartbeatPulse", {
      pulse: heartbeatPulse,
      hint: heartbeatHints[randomIndex],
    });
    setHeartbeatHintText(
      pulseText === "messages.opencodeHeartbeatPulse"
        ? `Heartbeat ${heartbeatPulse}: ${heartbeatHints[randomIndex]}`
        : pulseText,
    );
  }, [heartbeatHints, heartbeatPulse, showNonStreamingHint, t]);

  return (
    <>
      {isThinking && (
        <div className={`working${streamPhaseClass}`}>
          {proxyEnabled && (
            <ProxyStatusBadge
              proxyUrl={proxyUrl}
              label={t("messages.proxyBadge")}
              variant="prominent"
              animated
              className="working-proxy-badge"
            />
          )}
          <span className="working-spinner" aria-hidden />
          <div className="working-timer">
            <span className="working-timer-clock">{formatDurationMs(elapsedMs)}</span>
          </div>
          <span className="working-text">
            {primaryLabel || reasoningLabel || t("messages.generatingResponse")}
          </span>
          {showActivityLabel && <span className="working-activity">{activityLabel}</span>}
          {showNonStreamingHint && (
            <span className="working-hint">
              {heartbeatHintText || resolvedNonStreamingHint}
            </span>
          )}
        </div>
      )}
      {!isThinking && lastDurationMs !== null && hasItems && (
        <div className="turn-complete" aria-live="polite">
          <span className="turn-complete-line" aria-hidden />
          <span className="turn-complete-label">
            {t("messages.doneIn", { duration: formatDurationMs(lastDurationMs) })}
          </span>
          <span className="turn-complete-line" aria-hidden />
        </div>
      )}
    </>
  );
});

const MessageRow = memo(function MessageRow({
  item,
  workspaceId = null,
  threadId = null,
  isStreaming = false,
  activeEngine = "claude",
  enableCollaborationBadge = false,
  presentationProfile = null,
  showRuntimeReconnectCard = false,
  onRecoverThreadRuntime,
  onRecoverThreadRuntimeAndResend,
  retryMessage = null,
  isCopied,
  onCopy,
  codeBlockCopyUseModifier,
  onOpenFileLink,
  onOpenFileLinkMenu,
}: MessageRowProps) {
  const { t } = useTranslation();
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [memorySummaryExpanded, setMemorySummaryExpanded] = useState(false);
  const [isAgentBadgeExpanded, setIsAgentBadgeExpanded] = useState(false);
  const userMessagePresentation = useMemo(
    () => (
      item.role === "user"
        ? resolveUserMessagePresentation({
            text: item.text,
            selectedAgentName: item.selectedAgentName,
            selectedAgentIcon: item.selectedAgentIcon,
            enableCollaborationBadge,
          })
        : null
    ),
    [
      enableCollaborationBadge,
      item.role,
      item.selectedAgentIcon,
      item.selectedAgentName,
      item.text,
    ],
  );
  const memorySummary = useMemo(
    () =>
      item.role === "assistant"
        ? parseMemoryContextSummary(item.text)
        : userMessagePresentation?.memorySummary ?? null,
    [item.role, item.text, userMessagePresentation?.memorySummary],
  );
  const agentTaskNotification = useMemo(
    () => parseAgentTaskNotification(item.text),
    [item.text],
  );
  const displayText = agentTaskNotification
    ? agentTaskNotification.resultText
    : item.role === "user"
      ? (userMessagePresentation?.displayText ?? item.text)
      : memorySummary
        ? ""
        : item.text;
  const selectedAgentName = userMessagePresentation?.selectedAgentName ?? null;
  const selectedAgentIcon = userMessagePresentation?.selectedAgentIcon ?? null;
  const hasInjectedAgentPromptBlock =
    userMessagePresentation?.hasInjectedAgentPromptBlock ?? false;
  const hasExternalAgentBadge =
    item.role === "user"
    && !agentTaskNotification
    && (Boolean(selectedAgentName) || hasInjectedAgentPromptBlock);
  const agentTaskDisplay = useMemo(() => {
    if (!agentTaskNotification) {
      return null;
    }
    return {
      ...resolveAgentTaskDisplaySummary(agentTaskNotification.summary),
      status: normalizeAgentTaskStatus(agentTaskNotification.status),
      outputFileName: basenameFromPath(agentTaskNotification.outputFile),
    };
  }, [agentTaskNotification]);
  useEffect(() => {
    setIsAgentBadgeExpanded(false);
  }, [item.id, selectedAgentIcon, selectedAgentName]);
  const handleToggleAgentBadge = useCallback(() => {
    setIsAgentBadgeExpanded((current) => !current);
  }, []);
  const hasText = displayText.trim().length > 0;
  const hideCopyButton = item.role === "assistant" && Boolean(memorySummary) && !hasText;
  const useCodexCanvasMarkdown = presentationProfile
    ? presentationProfile.codexCanvasMarkdown
    : activeEngine === "codex";
  const markdownClassName =
    item.role === "assistant" && useCodexCanvasMarkdown
      ? "markdown markdown-codex-canvas"
      : "markdown";
  const resolvedMarkdownClassName = isStreaming
    ? `${markdownClassName} markdown-live-streaming`
    : markdownClassName;
  const imageItems = useMemo(() => {
    if (!item.images || item.images.length === 0) {
      return [];
    }
    return item.images
      .map((image, index) => {
        const src = normalizeMessageImageSrc(image);
        if (!src) {
          return null;
        }
        return { src, label: `Image ${index + 1}` };
      })
      .filter(Boolean) as MessageImage[];
  }, [item.images]);
  const provenanceLabel = resolveProvenanceEngineLabel(item.engineSource);
  const runtimeReconnectHint = useMemo(
    () => (
      item.role === "assistant"
        ? resolveAssistantRuntimeReconnectHint(item, Boolean(agentTaskNotification))
        : null
    ),
    [agentTaskNotification, item],
  );

  const bubbleNode = (
    <div className={`bubble message-bubble${agentTaskNotification ? " message-bubble-agent-task" : ""}`}>
      {item.role === "assistant" && provenanceLabel ? (
        <div className="message-provenance-row">
          <span className="message-provenance-badge">{provenanceLabel}</span>
        </div>
      ) : null}
      {agentTaskNotification && agentTaskDisplay ? (
        <div className="message-agent-task-card">
          <div className="message-agent-task-header">
            <div className="message-agent-task-avatar" aria-hidden>
              <AgentIcon
                seed={agentTaskDisplay.title || agentTaskNotification.taskId || item.id}
                fallback="codicon-hubot"
                className="message-agent-task-avatar-icon"
                size={18}
              />
            </div>
            <div className="message-agent-task-heading">
              <span className="message-agent-task-eyebrow">Agent session</span>
              <strong className="message-agent-task-title">{agentTaskDisplay.title}</strong>
              {agentTaskDisplay.subtitle ? (
                <span className="message-agent-task-subtitle">{agentTaskDisplay.subtitle}</span>
              ) : null}
            </div>
            <span className={`message-agent-task-status is-${agentTaskDisplay.status.tone}`}>
              {agentTaskDisplay.status.label}
            </span>
          </div>
          <div className="message-agent-task-meta">
            {agentTaskNotification.taskId ? (
              <span className="message-agent-task-chip">task {agentTaskNotification.taskId}</span>
            ) : null}
            {agentTaskNotification.toolUseId ? (
              <span className="message-agent-task-chip">tool {agentTaskNotification.toolUseId}</span>
            ) : null}
            {agentTaskDisplay.outputFileName ? (
              <span className="message-agent-task-chip">{agentTaskDisplay.outputFileName}</span>
            ) : null}
          </div>
        </div>
      ) : null}
      {imageItems.length > 0 && (
        <MessageImageGrid
          images={imageItems}
          onOpen={setLightboxIndex}
          hasText={hasText}
        />
      )}
      {memorySummary ? (
        <div className="memory-context-summary-card">
          <button
            type="button"
            className="memory-context-summary-toggle"
            onClick={() => setMemorySummaryExpanded((current) => !current)}
            aria-expanded={memorySummaryExpanded}
          >
            <span className="memory-context-summary-title">
              {t("messages.memoryContextSummary")}
            </span>
            <span className="memory-context-summary-count">
              {t("messages.memoryContextSummaryCount", {
                count: memorySummary.lines.length,
              })}
            </span>
            {memorySummaryExpanded ? (
              <ChevronUp size={14} aria-hidden />
            ) : (
              <ChevronDown size={14} aria-hidden />
            )}
          </button>
          {memorySummaryExpanded && (
            <div className="memory-context-summary-content">
              {memorySummary.lines.map((line, index) => (
                <p key={`${item.id}-line-${index}`}>{line}</p>
              ))}
            </div>
          )}
        </div>
      ) : null}
      {runtimeReconnectHint && showRuntimeReconnectCard ? (
        <RuntimeReconnectCard
          hint={runtimeReconnectHint}
          workspaceId={workspaceId}
          threadId={threadId}
          onRecoverThreadRuntime={onRecoverThreadRuntime}
          retryMessage={retryMessage}
          onRecoverThreadRuntimeAndResend={onRecoverThreadRuntimeAndResend}
        />
      ) : null}
      {hasText && (
        item.role === "user" && !agentTaskNotification ? (
          <CollapsibleUserTextBlock content={displayText} />
        ) : runtimeReconnectHint && showRuntimeReconnectCard ? null : (
          <Markdown
            value={displayText}
            className={resolvedMarkdownClassName}
            workspaceId={workspaceId}
            codeBlockStyle="message"
            codeBlockCopyUseModifier={codeBlockCopyUseModifier}
            streamingThrottleMs={isStreaming ? 0 : 80}
            onOpenFileLink={onOpenFileLink}
            onOpenFileLinkMenu={onOpenFileLinkMenu}
          />
        )
      )}
      {lightboxIndex !== null && imageItems.length > 0 && (
        <ImageLightbox
          images={imageItems}
          activeIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
      {!hideCopyButton && (
        <button
          type="button"
          className={`ghost message-copy-button${isCopied ? " is-copied" : ""}`}
          onClick={() => onCopy(item, displayText || item.text)}
          aria-label={t("messages.copyMessage")}
          title={t("messages.copyMessage")}
        >
          <span className="message-copy-icon" aria-hidden>
            <Copy className="message-copy-icon-copy" size={14} />
            <Check className="message-copy-icon-check" size={14} />
          </span>
        </button>
      )}
    </div>
  );

  const agentBadgeNode = hasExternalAgentBadge ? (
    <div className={`message-user-agent-rail${isAgentBadgeExpanded ? " is-open" : ""}`}>
      <button
        type="button"
        className="message-agent-icon-button"
        onClick={handleToggleAgentBadge}
        aria-expanded={isAgentBadgeExpanded}
        aria-label={selectedAgentName ? `显示智能体标签：${selectedAgentName}` : "显示智能体标记"}
        title={selectedAgentName ?? undefined}
      >
        <AgentIcon
          icon={selectedAgentIcon}
          seed={selectedAgentName ?? item.id}
          fallback="codicon-hubot"
          className="message-agent-icon-glyph"
          size={30}
        />
      </button>
      {isAgentBadgeExpanded && selectedAgentName && (
        <div className="message-agent-reveal is-visible" role="status">
          <span className="message-agent-tag-text">{selectedAgentName}</span>
        </div>
      )}
    </div>
  ) : null;

  return (
    <div className={`message ${item.role}${agentTaskNotification ? " message-agent-task" : ""}`}>
      {hasExternalAgentBadge ? (
        <div className="message-user-layout">
          {agentBadgeNode}
          {bubbleNode}
        </div>
      ) : bubbleNode}
    </div>
  );
}, areMessageRowPropsEqual);

const ReasoningRow = memo(function ReasoningRow({
  item,
  workspaceId = null,
  parsed,
  isExpanded,
  isLive,
  activeEngine,
  onToggle,
  onOpenFileLink,
  onOpenFileLinkMenu,
}: ReasoningRowProps) {
  const { t } = useTranslation();
  const { bodyText } = parsed;
  const shouldPreferRawClaudeContent =
    activeEngine === "claude" &&
    item.summary.trim().length > 0 &&
    item.content.trim().length > 0 &&
    item.summary.trim() === item.content.trim() &&
    item.content.includes("\n");
  const thinkingText = shouldPreferRawClaudeContent
    ? item.content
    : bodyText || item.content || item.summary || "";
  const title = activeEngine === "claude"
    ? t("messages.thinkingLabel")
    : isLive
    ? t("messages.thinkingProcess")
    : t("messages.thinkingLabel");
  const provenanceLabel = resolveProvenanceEngineLabel(item.engineSource);
  return (
    <div className={`thinking-block${isExpanded ? " is-expanded" : ""}${isLive ? " is-live" : ""}`}>
      <button
        type="button"
        className="thinking-header"
        onClick={() => onToggle(item.id)}
      >
        <span className="thinking-header-copy">
          <span className="codicon codicon-thinking thinking-glyph" aria-hidden />
          <span className="thinking-title">{title}</span>
          {provenanceLabel ? (
            <span className="message-provenance-badge thinking-provenance-badge">
              {provenanceLabel}
            </span>
          ) : null}
        </span>
        <span
          className={`codicon thinking-icon ${isExpanded ? "codicon-chevron-down" : "codicon-chevron-right"}`}
          aria-hidden
        />
      </button>
      <div
        className="thinking-content"
        style={{ display: isExpanded ? "block" : "none" }}
      >
        {thinkingText ? (
          <div className="reasoning-markdown-surface">
            <Markdown
              value={thinkingText}
              className={`markdown reasoning-markdown${isLive ? " markdown-live-streaming" : ""}`}
              workspaceId={workspaceId}
              codeBlockStyle="message"
              streamingThrottleMs={isLive ? 180 : 80}
              onOpenFileLink={onOpenFileLink}
              onOpenFileLinkMenu={onOpenFileLinkMenu}
            />
          </div>
        ) : (
          <span>{t("messages.noThinkingContent")}</span>
        )}
      </div>
    </div>
  );
});

const ReviewRow = memo(function ReviewRow({
  item,
  workspaceId = null,
  onOpenFileLink,
  onOpenFileLinkMenu,
}: ReviewRowProps) {
  const title = item.state === "started" ? "Review started" : "Review completed";
  return (
    <div className="item-card review">
      <div className="review-header">
        <span className="review-title">{title}</span>
        <span
          className={`review-badge ${item.state === "started" ? "active" : "done"}`}
        >
          Review
        </span>
      </div>
      {item.text && (
        <Markdown
          value={item.text}
          className="item-text markdown"
          workspaceId={workspaceId}
          onOpenFileLink={onOpenFileLink}
          onOpenFileLinkMenu={onOpenFileLinkMenu}
        />
      )}
    </div>
  );
});

const DiffRow = memo(function DiffRow({ item }: DiffRowProps) {
  return (
    <div className="item-card diff">
      <div className="diff-header">
        <span className="diff-title">{item.title}</span>
        {item.status && <span className="item-status">{item.status}</span>}
      </div>
      <div className="diff-viewer-output">
        <DiffBlock diff={item.diff} language={languageFromPath(item.title)} />
      </div>
    </div>
  );
});

function exploreKindLabel(kind: ExploreRowProps["item"]["entries"][number]["kind"]) {
  return (kind[0] ?? "").toUpperCase() + kind.slice(1);
}

const ExploreRow = memo(function ExploreRow({ item, isExpanded, onToggle }: ExploreRowProps) {
  const { t } = useTranslation();
  const title = item.title ?? (item.status === "exploring" ? "Exploring" : "Explored");
  const isCollapsible =
    item.collapsible ?? (item.status === "explored" && item.entries.length > 1);
  const listCollapsed = isCollapsible && !isExpanded;
  const handleToggle = () => {
    if (!isCollapsible) {
      return;
    }
    onToggle(item.id);
  };
  return (
    <div className={`tool-inline explore-inline${isCollapsible ? " is-collapsible" : ""}`}>
      <div className="tool-inline-content">
        <div className="explore-inline-header">
          {isCollapsible ? (
            <button
              type="button"
              className="explore-inline-header-toggle"
              onClick={handleToggle}
              aria-expanded={isExpanded}
              aria-label={t("messages.toggleDetails")}
            >
              <Terminal
                className={`tool-inline-icon explore-inline-toggle-icon${
                  isExpanded ? " is-expanded" : ""
                } ${item.status === "exploring" ? "processing" : "completed"}`}
                size={14}
                aria-hidden
              />
              <span className="explore-inline-title">{title}</span>
            </button>
          ) : (
            <>
              <Terminal
                className={`tool-inline-icon ${
                  item.status === "exploring" ? "processing" : "completed"
                }`}
                size={14}
                aria-hidden
              />
              <span className="explore-inline-title">{title}</span>
            </>
          )}
        </div>
        <div className={`explore-inline-list${listCollapsed ? " is-collapsed" : ""}`}>
          {item.entries.map((entry, index) => (
            <div key={`${entry.kind}-${entry.label}-${index}`} className="explore-inline-item">
              <span className="explore-inline-kind">{exploreKindLabel(entry.kind)}</span>
              <span className="explore-inline-label">{entry.label}</span>
              {entry.detail && entry.detail !== entry.label && (
                <span className="explore-inline-detail">{entry.detail}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

export const Messages = memo(function Messages({
  items: legacyItems,
  threadId: legacyThreadId,
  workspaceId: legacyWorkspaceId = null,
  isThinking: legacyIsThinking,
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
  const isWorking = legacyIsThinking || isContextCompacting;
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
        isThinking: isWorking,
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
      isWorking,
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
  const activeEngine = toConversationEngine(effectiveState.meta.engine);
  const isThinking = conversationState
    ? effectiveState.meta.isThinking
    : legacyIsThinking;
  const heartbeatPulse = conversationState
    ? (effectiveState.meta.heartbeatPulse ?? legacyHeartbeatPulse ?? 0)
    : legacyHeartbeatPulse ?? 0;
  const renderStartedAt =
    typeof performance === "undefined" ? 0 : performance.now();
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const messageNodeByIdRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const agentTaskNodeByTaskIdRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const agentTaskNodeByToolUseIdRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const autoScrollRef = useRef(true);
  const anchorUpdateRafRef = useRef<number | null>(null);
  const lastRenderSnapshotRef = useRef<{
    items: ConversationItem[];
    userInputRequests: RequestUserInputRequest[];
    conversationState: ConversationState | null;
    presentationProfile: PresentationProfile | null;
    isThinking: boolean;
    heartbeatPulse: number;
    threadId: string | null;
  } | null>(null);
  const [expandedItems, setExpandedItems] = useState<Set<string>>(() => new Set());
  const [selectedExitPlanExecutionByItemKey, setSelectedExitPlanExecutionByItemKey] = useState<
    Record<string, Extract<AccessMode, "default" | "full-access">>
  >({});
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [activeAnchorId, setActiveAnchorId] = useState<string | null>(null);
  const [showAllHistoryItems, setShowAllHistoryItems] = useState(false);
  const [liveAutoFollowEnabled, setLiveAutoFollowEnabled] = useState(() =>
    readLocalBooleanFlag(MESSAGES_LIVE_AUTO_FOLLOW_FLAG_KEY, true),
  );
  const [collapseLiveMiddleStepsEnabled, setCollapseLiveMiddleStepsEnabled] = useState(() =>
    readLocalBooleanFlag(MESSAGES_LIVE_COLLAPSE_MIDDLE_STEPS_FLAG_KEY, false),
  );
  const hideClaudeReasoning = activeEngine === "claude" && shouldHideClaudeReasoningModule();
  const [isSelectionFrozen, setIsSelectionFrozen] = useState(false);
  const copyTimeoutRef = useRef<number | null>(null);
  const planPanelFocusRafRef = useRef<number | null>(null);
  const planPanelFocusTimeoutRef = useRef<number | null>(null);
  const planPanelFocusNodeRef = useRef<HTMLElement | null>(null);
  const frozenItemsRef = useRef<ConversationItem[] | null>(null);
  const latestItemsRef = useRef(items);
  latestItemsRef.current = items;
  const effectiveItems = useMemo(() => {
    const baseItems = isSelectionFrozen
      ? frozenItemsRef.current ?? items
      : items;
    return dedupeExitPlanItemsKeepFirst(baseItems);
  }, [isSelectionFrozen, items]);
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
    for (const item of effectiveItems) {
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
  }, [effectiveItems, isThinking]);
  const reasoningMetaById = useMemo(() => {
    const meta = new Map<string, ReturnType<typeof parseReasoning>>();
    effectiveItems.forEach((item) => {
      if (item.kind === "reasoning") {
        meta.set(item.id, parseReasoning(item));
      }
    });
    return meta;
  }, [effectiveItems]);

  const lastUserMessageIndex = useMemo(
    () => findLastUserMessageIndex(effectiveItems),
    [effectiveItems],
  );
  const reasoningWindowStartIndex = useMemo(() => {
    if (lastUserMessageIndex >= 0) {
      return lastUserMessageIndex;
    }
    return findLastAssistantMessageIndex(effectiveItems);
  }, [effectiveItems, lastUserMessageIndex]);

  const latestReasoningLabel = useMemo(() => {
    if (hideClaudeReasoning) {
      return null;
    }
    for (let index = effectiveItems.length - 1; index > reasoningWindowStartIndex; index -= 1) {
      const item = effectiveItems[index];
      if (!isReasoningConversationItem(item)) {
        continue;
      }
      const parsed = reasoningMetaById.get(item.id);
      if (parsed?.workingLabel) {
        return parsed.workingLabel;
      }
    }
    return null;
  }, [effectiveItems, hideClaudeReasoning, reasoningMetaById, reasoningWindowStartIndex]);

  const latestReasoningId = useMemo(() => {
    for (let index = effectiveItems.length - 1; index > reasoningWindowStartIndex; index -= 1) {
      const item = effectiveItems[index];
      if (isReasoningConversationItem(item)) {
        return item.id;
      }
    }
    return null;
  }, [effectiveItems, reasoningWindowStartIndex]);
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
    for (let index = reasoningWindowStartIndex + 1; index < effectiveItems.length; index += 1) {
      const item = effectiveItems[index];
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
  }, [effectiveItems, hideClaudeReasoning, reasoningMetaById, reasoningWindowStartIndex]);
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
    for (let index = effectiveItems.length - 1; index >= 0; index -= 1) {
      const item = effectiveItems[index];
      if (!isReasoningConversationItem(item)) {
        continue;
      }
      const parsed = reasoningMetaById.get(item.id);
      if (parsed?.workingLabel && !parsed.hasBody) {
        return item.id;
      }
    }
    return null;
  }, [effectiveItems, reasoningMetaById]);

  const latestWorkingActivityLabel = useMemo(() => {
    let lastUserIndex = -1;
    for (let index = effectiveItems.length - 1; index >= 0; index -= 1) {
      const item = effectiveItems[index];
      if (isUserMessageConversationItem(item)) {
        lastUserIndex = index;
        break;
      }
    }
    if (lastUserIndex < 0) {
      return null;
    }
    for (let index = effectiveItems.length - 1; index > lastUserIndex; index -= 1) {
      const item = effectiveItems[index];
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
  }, [activeEngine, effectiveItems, presentationProfile]);
  const approvalResumeWorkingLabel = useMemo(() => {
    if (!isThinking || lastUserMessageIndex < 0) {
      return null;
    }
    const resumeText = t("approval.resumingAfterApproval");
    for (let index = effectiveItems.length - 1; index > lastUserMessageIndex; index -= 1) {
      const item = effectiveItems[index];
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
  }, [effectiveItems, isThinking, lastUserMessageIndex, t]);

  const latestAssistantMessageId = useMemo(() => {
    for (let index = effectiveItems.length - 1; index > lastUserMessageIndex; index -= 1) {
      const item = effectiveItems[index];
      if (isAssistantMessageConversationItem(item)) {
        return item.id;
      }
    }
    return null;
  }, [effectiveItems, lastUserMessageIndex]);

  const waitingForFirstChunk = useMemo(() => {
    if (!legacyIsThinking || effectiveItems.length === 0) {
      return false;
    }
    let lastUserIndex = -1;
    for (let index = effectiveItems.length - 1; index >= 0; index -= 1) {
      const item = effectiveItems[index];
      if (isUserMessageConversationItem(item)) {
        lastUserIndex = index;
        break;
      }
    }
    if (lastUserIndex < 0) {
      return false;
    }
    for (let index = lastUserIndex + 1; index < effectiveItems.length; index += 1) {
      const item = effectiveItems[index];
      if (isAssistantMessageConversationItem(item)) {
        return false;
      }
    }
    return true;
  }, [legacyIsThinking, effectiveItems]);
  const streamActivityPhase = useStreamActivityPhase({
    isProcessing:
      legacyIsThinking &&
      (activeEngine === "codex" || activeEngine === "claude" || activeEngine === "gemini"),
    items: effectiveItems,
  });
  const primaryWorkingLabel = isContextCompacting
    ? t("chat.contextDualViewCompacting")
    : approvalResumeWorkingLabel;

  const visibleItems = useMemo(() => {
    const filtered = effectiveItems.filter((item) => {
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
    effectiveItems,
    hideClaudeReasoning,
    latestTitleOnlyReasoningId,
    presentationProfile,
    reasoningMetaById,
  ]);
  const { timelineItems, collapsedMiddleStepCount } = useMemo(() => {
    if (!collapseLiveMiddleStepsEnabled || visibleItems.length <= 2) {
      return { timelineItems: visibleItems, collapsedMiddleStepCount: 0 };
    }
    if (!isThinking) {
      const firstUserIndex = visibleItems.findIndex(
        (item) => item.kind === "message" && item.role === "user",
      );
      if (firstUserIndex < 0) {
        return { timelineItems: visibleItems, collapsedMiddleStepCount: 0 };
      }
      let lastMessageIndex = -1;
      for (let index = visibleItems.length - 1; index >= 0; index -= 1) {
        if (visibleItems[index]?.kind === "message") {
          lastMessageIndex = index;
          break;
        }
      }
      if (lastMessageIndex <= firstUserIndex) {
        return { timelineItems: visibleItems, collapsedMiddleStepCount: 0 };
      }
      const nextTimelineItems: ConversationItem[] = [];
      const hiddenItems: ConversationItem[] = [];
      for (let index = 0; index < visibleItems.length; index += 1) {
        const item = visibleItems[index];
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
        : { timelineItems: visibleItems, collapsedMiddleStepCount: 0 };
    }
    let lastUserIndex = -1;
    for (let index = visibleItems.length - 1; index >= 0; index -= 1) {
      const candidate = visibleItems[index];
      if (isUserMessageConversationItem(candidate)) {
        lastUserIndex = index;
        break;
      }
    }
    if (lastUserIndex < 0 || lastUserIndex >= visibleItems.length - 2) {
      return { timelineItems: visibleItems, collapsedMiddleStepCount: 0 };
    }
    const lastIndex = visibleItems.length - 1;
    const nextTimelineItems: ConversationItem[] = [];
    const hiddenItems: ConversationItem[] = [];
    for (let index = 0; index < visibleItems.length; index += 1) {
      const item = visibleItems[index];
      if (!item) {
        continue;
      }
      if (index <= lastUserIndex || index === lastIndex) {
        nextTimelineItems.push(item);
        continue;
      }
      if (isMessageConversationItem(item)) {
        nextTimelineItems.push(item);
        continue;
      }
      hiddenItems.push(item);
    }
    const collapsedEntryCount = countRenderableCollapsedEntries(hiddenItems, activeEngine);
    return hiddenItems.length > 0
      ? { timelineItems: nextTimelineItems, collapsedMiddleStepCount: collapsedEntryCount }
      : { timelineItems: visibleItems, collapsedMiddleStepCount: 0 };
  }, [activeEngine, collapseLiveMiddleStepsEnabled, isThinking, visibleItems]);
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
  const shouldCollapseHistoryItems =
    !showAllHistoryItems && timelineItems.length > VISIBLE_MESSAGE_WINDOW;
  const collapsedHistoryItemCount = shouldCollapseHistoryItems
    ? timelineItems.length - VISIBLE_MESSAGE_WINDOW
    : 0;
  const enableCollaborationBadge = activeEngine === "codex";
  const historyStickyEnabled =
    !isThinking || Boolean(conversationState?.meta.historyRestoredAtMs);
  const latestLiveStickyUserMessageId = useMemo(
    () =>
      isThinking && !conversationState?.meta.historyRestoredAtMs
        ? findLatestOrdinaryUserQuestionId(timelineItems, {
            enableCollaborationBadge,
          })
        : null,
    [conversationState?.meta.historyRestoredAtMs, enableCollaborationBadge, isThinking, timelineItems],
  );
  const { renderedItems, visibleCollapsedHistoryItemCount } = useMemo(
    () =>
      buildRenderedItemsWindow(
        timelineItems,
        collapsedHistoryItemCount,
        latestLiveStickyUserMessageId,
      ),
    [
      collapsedHistoryItemCount,
      latestLiveStickyUserMessageId,
      timelineItems,
    ],
  );
  const historyStickyUserMessageIds = useMemo(() => {
    if (!historyStickyEnabled) {
      return new Set<string>();
    }
    const stickyIds = new Set<string>();
    for (const item of renderedItems) {
      if (isOrdinaryUserQuestionItem(item, enableCollaborationBadge)) {
        stickyIds.add(item.id);
      }
    }
    return stickyIds;
  }, [enableCollaborationBadge, historyStickyEnabled, renderedItems]);
  const messageAnchors = useMemo(() => {
    const messageItems = renderedItems.filter(
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
  }, [renderedItems]);
  const hasAnchorRail = showMessageAnchors && messageAnchors.length > 1;
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
  const updateAutoScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const nearBottom = isNearBottom(container);
    autoScrollRef.current = liveAutoFollowEnabled ? true : nearBottom;
    scheduleAnchorUpdate("scroll");
  }, [isNearBottom, liveAutoFollowEnabled, scheduleAnchorUpdate]);
  const clearTransientUiState = useCallback(() => {
    if (copyTimeoutRef.current) {
      window.clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = null;
    }
    if (anchorUpdateRafRef.current !== null) {
      window.cancelAnimationFrame(anchorUpdateRafRef.current);
      anchorUpdateRafRef.current = null;
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
    const scrollBehavior = isThinking ? "instant" as const : "smooth" as const;
    raf = window.requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: scrollBehavior, block: "end" });
    });
    return () => {
      if (raf) {
        window.cancelAnimationFrame(raf);
      }
    };
  }, [scrollKey, isThinking, isNearBottom, liveAutoFollowEnabled]);

  const groupedEntries = useMemo(() => groupToolItems(renderedItems), [renderedItems]);
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
    renderedItems.forEach((entry) => {
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
  }, [renderedItems]);
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
    renderedItems.forEach((entry) => {
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
  }, [assistantFinalBoundarySet, renderedItems]);
  const assistantLiveTurnFinalBoundarySuppressedSet = useMemo(() => {
    const ids = new Set<string>();
    if (!isThinking) {
      return ids;
    }
    let lastUserIndex = -1;
    for (let index = renderedItems.length - 1; index >= 0; index -= 1) {
      const entry = renderedItems[index];
      if (entry?.kind === "message" && entry.role === "user") {
        lastUserIndex = index;
        break;
      }
    }
    if (lastUserIndex < 0) {
      return ids;
    }
    for (let index = lastUserIndex + 1; index < renderedItems.length; index += 1) {
      const entry = renderedItems[index];
      if (
        entry?.kind === "message" &&
        entry.role === "assistant" &&
        entry.isFinal === true &&
        assistantFinalBoundarySet.has(entry.id)
      ) {
        ids.add(entry.id);
      }
    }
    return ids;
  }, [assistantFinalBoundarySet, isThinking, renderedItems]);

  const shouldRenderUserInputNode =
    (activeEngine === "codex" || activeEngine === "claude") &&
    Boolean(legacyOnUserInputSubmit);
  const visibleApprovals = useMemo(() => {
    if (!approvals.length) {
      return [];
    }

    return approvals.filter((approval) =>
      !workspaceId || approval.workspace_id === workspaceId,
    );
  }, [approvals, workspaceId]);
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

  const renderSingleItem = (item: ConversationItem) => {
    if (item.kind === "message") {
      const itemRenderKey = `message:${item.id}`;
      const isCopied = copiedMessageId === item.id;
      const agentTaskNotification = parseAgentTaskNotification(item.text);
      const shouldRenderFinalBoundary =
        item.role === "assistant" &&
        item.isFinal === true &&
        assistantFinalBoundarySet.has(item.id) &&
        !assistantLiveTurnFinalBoundarySuppressedSet.has(item.id);
      const shouldRenderReasoningBoundary =
        shouldRenderFinalBoundary && assistantFinalWithVisibleProcessSet.has(item.id);
      const finalMetaParts: string[] = [];
      if (typeof item.finalCompletedAt === "number" && item.finalCompletedAt > 0) {
        finalMetaParts.push(formatCompletedTimeMs(item.finalCompletedAt));
      }
      const finalMetaText = finalMetaParts.join(" · ");
      const bindMessageNode = (node: HTMLDivElement | null) => {
        if (item.role === "user" && node) {
          messageNodeByIdRef.current.set(item.id, node);
        } else {
          messageNodeByIdRef.current.delete(item.id);
        }
        if (agentTaskNotification?.taskId && node) {
          agentTaskNodeByTaskIdRef.current.set(agentTaskNotification.taskId, node);
        } else if (agentTaskNotification?.taskId) {
          agentTaskNodeByTaskIdRef.current.delete(agentTaskNotification.taskId);
        }
        if (agentTaskNotification?.toolUseId && node) {
          agentTaskNodeByToolUseIdRef.current.set(agentTaskNotification.toolUseId, node);
        } else if (agentTaskNotification?.toolUseId) {
          agentTaskNodeByToolUseIdRef.current.delete(agentTaskNotification.toolUseId);
        }
      };
      return (
        <Fragment key={itemRenderKey}>
          {shouldRenderReasoningBoundary && (
            <div className="messages-turn-boundary messages-reasoning-boundary" role="separator">
              <span className="messages-turn-boundary-label">
                <span className="messages-turn-boundary-label-content">
                  <Bell className="messages-turn-boundary-icon" size={13} aria-hidden />
                  <span>推理过程</span>
                </span>
              </span>
              {finalMetaText && (
                <span
                  className="messages-turn-boundary-meta messages-turn-boundary-meta-placeholder"
                  aria-hidden="true"
                >
                  {finalMetaText}
                </span>
              )}
            </div>
          )}
          <div
            ref={bindMessageNode}
            className={[
              item.id === latestLiveStickyUserMessageId
                ? "messages-live-sticky-user-message"
                : "",
              historyStickyUserMessageIds.has(item.id)
                ? "messages-history-sticky-user-message"
                : "",
            ]
              .filter(Boolean)
              .join(" ") || undefined}
            data-message-anchor-id={item.id}
            data-agent-task-id={agentTaskNotification?.taskId ?? undefined}
            data-agent-tool-use-id={agentTaskNotification?.toolUseId ?? undefined}
          >
            <MessageRow
              item={item}
              workspaceId={workspaceId}
              threadId={threadId}
              isStreaming={
                activeEngine === "claude" &&
                isThinking &&
                item.role === "assistant" &&
                item.id === latestAssistantMessageId
              }
              activeEngine={activeEngine}
              activeCollaborationModeId={activeCollaborationModeId}
              enableCollaborationBadge={activeEngine === "codex"}
              presentationProfile={presentationProfile}
              showRuntimeReconnectCard={item.id === latestRuntimeReconnectItemId}
              onRecoverThreadRuntime={onRecoverThreadRuntime}
              onRecoverThreadRuntimeAndResend={onRecoverThreadRuntimeAndResend}
              retryMessage={
                item.id === latestRuntimeReconnectItemId
                  ? latestRetryMessage
                  : null
              }
              isCopied={isCopied}
              onCopy={handleCopyMessage}
              codeBlockCopyUseModifier={codeBlockCopyUseModifier}
              onOpenFileLink={openFileLink}
              onOpenFileLinkMenu={showFileLinkMenu}
            />
          </div>
          {shouldRenderFinalBoundary && (
            <div className="messages-turn-boundary messages-final-boundary" role="separator">
              <span className="messages-turn-boundary-label">
                <span className="messages-turn-boundary-label-content">
                  <Flag className="messages-turn-boundary-icon" size={13} aria-hidden />
                  <span>最终消息</span>
                </span>
              </span>
              {finalMetaText && (
                <span className="messages-turn-boundary-meta">{finalMetaText}</span>
              )}
            </div>
          )}
        </Fragment>
      );
    }
    if (item.kind === "reasoning") {
      const itemRenderKey = `reasoning:${item.id}`;
      const isExpanded = expandedItems.has(item.id);
      const parsed = reasoningMetaById.get(item.id) ?? parseReasoning(item);
      const isLiveReasoning =
        isThinking && latestReasoningId === item.id;
      return (
        <ReasoningRow
          key={itemRenderKey}
          item={item}
          workspaceId={workspaceId}
          parsed={parsed}
          isExpanded={isExpanded}
          isLive={isLiveReasoning}
          activeEngine={activeEngine}
          onToggle={toggleExpanded}
          onOpenFileLink={openFileLink}
          onOpenFileLinkMenu={showFileLinkMenu}
        />
      );
    }
    if (item.kind === "review") {
      return (
        <ReviewRow
          key={`review:${item.id}`}
          item={item}
          workspaceId={workspaceId}
          onOpenFileLink={openFileLink}
          onOpenFileLinkMenu={showFileLinkMenu}
        />
      );
    }
    if (item.kind === "diff") {
      return <DiffRow key={`diff:${item.id}`} item={item} />;
    }
    if (item.kind === "tool") {
      if (shouldHideCodexCanvasCommandCard(item, activeEngine)) {
        return null;
      }
      const isExpanded = expandedItems.has(item.id);
      const selectedExitPlanExecutionMode =
        selectedExitPlanExecutionByItemKey[`${threadId ?? "no-thread"}:${item.id}`] ?? null;
      const provenanceLabel = resolveProvenanceEngineLabel(item.engineSource);
      return (
        <div key={`tool:${item.id}`} className="message-tool-block-shell">
          {provenanceLabel ? (
            <div className="message-provenance-row">
              <span className="message-provenance-badge">{provenanceLabel}</span>
            </div>
          ) : null}
          <ToolBlockRenderer
            item={item}
            workspaceId={workspaceId}
            isExpanded={isExpanded}
            onToggle={toggleExpanded}
            onRequestAutoScroll={requestAutoScroll}
            activeCollaborationModeId={activeCollaborationModeId}
            activeEngine={activeEngine}
            hasPendingUserInputRequest={activeUserInputRequestId !== null}
            onOpenDiffPath={onOpenDiffPath}
            selectedExitPlanExecutionMode={selectedExitPlanExecutionMode}
            onExitPlanModeExecute={handleExitPlanModeExecuteForItem}
          />
        </div>
      );
    }
    if (item.kind === "explore") {
      const isExpanded = liveAutoExpandedExploreId === item.id || expandedItems.has(item.id);
      return (
        <ExploreRow
          key={`explore:${item.id}`}
          item={item}
          isExpanded={isExpanded}
          onToggle={toggleExpanded}
        />
      );
    }
    return null;
  };

  const renderEntry = (entry: GroupedEntry, _index: number) => {
    if (entry.kind === "readGroup") {
      const firstItem = entry.items[0];
      return <ReadToolGroupBlock key={`rg-${firstItem?.id ?? "read-group"}`} items={entry.items} />;
    }
    if (entry.kind === "editGroup") {
      const firstItem = entry.items[0];
      return (
        <EditToolGroupBlock
          key={`eg-${firstItem?.id ?? "edit-group"}`}
          items={entry.items}
          onOpenDiffPath={onOpenDiffPath}
        />
      );
    }
    if (entry.kind === "bashGroup") {
      if (activeEngine === "codex" || activeEngine === "claude") {
        return null;
      }
      const firstItem = entry.items[0];
      return (
        <BashToolGroupBlock
          key={`bg-${firstItem?.id ?? "bash-group"}`}
          items={entry.items}
          onRequestAutoScroll={requestAutoScroll}
        />
      );
    }
    if (entry.kind === "searchGroup") {
      const firstItem = entry.items[0];
      return <SearchToolGroupBlock key={`sg-${firstItem?.id ?? "search-group"}`} items={entry.items} />;
    }
    return renderSingleItem(entry.item);
  };

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

  return (
    <div className={`messages-shell${hasAnchorRail ? " has-anchor-rail" : ""}`}>
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
        <div className="messages-full">
          {visibleCollapsedHistoryItemCount > 0 && (
            <div
              className="messages-collapsed-indicator"
              data-collapsed-count={visibleCollapsedHistoryItemCount}
              onClick={() => setShowAllHistoryItems(true)}
            >
              {t("messages.showEarlierMessages", { count: visibleCollapsedHistoryItemCount })}
            </div>
          )}
          {groupedEntries.map(renderEntry)}
          {claudeDockedReasoningItems.map(({ item, parsed }) => (
            <ReasoningRow
              key={`claude-live-${item.id}`}
              item={item}
              workspaceId={workspaceId}
              parsed={parsed}
              isExpanded={isThinking && latestReasoningId === item.id ? true : expandedItems.has(item.id)}
              isLive={isThinking && latestReasoningId === item.id}
              onToggle={toggleExpanded}
              onOpenFileLink={openFileLink}
              onOpenFileLinkMenu={showFileLinkMenu}
            />
          ))}
          {userInputNode}
          {isThinking && collapseLiveMiddleStepsEnabled && collapsedMiddleStepCount > 0 && (
            <div className="messages-live-middle-collapsed-indicator" role="status">
              {t("messages.middleStepsCollapsedHint", { count: collapsedMiddleStepCount })}
            </div>
          )}
          <WorkingIndicator
            isThinking={isWorking}
            proxyEnabled={proxyEnabled}
            proxyUrl={proxyUrl}
            processingStartedAt={processingStartedAt}
            lastDurationMs={lastDurationMs}
            heartbeatPulse={heartbeatPulse}
            hasItems={effectiveItems.length > 0}
            reasoningLabel={latestReasoningLabel}
            activityLabel={latestWorkingActivityLabel}
            primaryLabel={primaryWorkingLabel}
            activeEngine={activeEngine}
            waitingForFirstChunk={waitingForFirstChunk}
            presentationProfile={presentationProfile}
            streamActivityPhase={streamActivityPhase}
          />
          {!effectiveItems.length && !userInputNode && (
            <div className="empty messages-empty">
              {t("messages.emptyThread")}
            </div>
          )}
          {approvalNode}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
});
