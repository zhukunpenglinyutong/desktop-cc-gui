import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import Check from "lucide-react/dist/esm/icons/check";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronUp from "lucide-react/dist/esm/icons/chevron-up";
import Copy from "lucide-react/dist/esm/icons/copy";
import Terminal from "lucide-react/dist/esm/icons/terminal";
import { AgentIcon } from "../../../components/AgentIcon";
import { ImagePreviewOverlay } from "../../../components/common/ImagePreviewOverlay";
import { hydrateClaudeDeferredImage } from "../../../services/tauri";
import type { ConversationItem, QueuedMessage } from "../../../types";
import { DiffBlock } from "../../git/components/DiffBlock";
import type { StreamActivityPhase } from "../../threads/hooks/useStreamActivityPhase";
import type { StreamMitigationProfile } from "../../threads/utils/streamLatencyDiagnostics";
import { ProxyStatusBadge } from "../../../components/ProxyStatusBadge";
import { languageFromPath } from "../../../utils/syntax";
import type { PresentationProfile } from "../presentation/presentationProfile";
import { parseAgentTaskNotification } from "../utils/agentTaskNotification";
import {
  CollapsibleUserTextBlock,
  parseUserTextContent,
  UserCodeAnnotationContextBlock,
} from "./CollapsibleUserTextBlock";
import { ImageLightbox, MessageImageGrid, type MessageImage } from "./MessageMediaBlocks";
import { LocalImage } from "./LocalImage";
import { Markdown } from "./Markdown";
import { parseMemoryContextSummary } from "./messagesMemoryContext";
import {
  parseNoteCardContextSummary,
  type NoteCardContextSummary,
} from "./messagesNoteCardContext";
import { parseReasoning } from "./messagesReasoning";
import { resolveUserMessagePresentation } from "./messagesUserPresentation";
import { RuntimeReconnectCard } from "./RuntimeReconnectCard";
import {
  resolveAssistantRuntimeReconnectHint,
  type RuntimeReconnectRecoveryCallbackResult,
} from "./runtimeReconnect";
import {
  basenameFromPath,
  formatDurationMs,
  MessagesEngine,
  normalizeAgentTaskStatus,
  normalizeMessageImageSrc,
  OPENCODE_NON_STREAMING_HINT_DELAY_MS,
  resolveAgentTaskDisplaySummary,
  resolveProvenanceEngineLabel,
  shouldDisplayWorkingActivityLabel,
} from "./messagesRenderUtils";

/**
 * Inline styles previously defined in `src/styles/messages.status-shell.css`
 * (the working/turn-complete cluster). Migrated to inline `style` props so
 * the CSS file can shrink — the original class names are retained as no-op
 * markers for QA / spec-hub selectors. Animation keyframes (`working-spin`,
 * `working-shimmer`, etc.) remain in CSS because they are referenced by
 * `animation` shorthand below and by the still-CSS `.working-spinner` rule
 * (which is kept in CSS because it is test-pinned by
 * layout-swapped-platform-guard).
 */
const WORKING_BASE_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: "10px",
  padding: 0,
  margin: "4px 24px 12px 0",
  color: "var(--text-fainter)",
  fontSize: "12px",
  letterSpacing: "0.02em",
};
const WORKING_PROXY_BADGE_STYLE: CSSProperties = {
  marginRight: 0,
  marginLeft: "1px",
};
const WORKING_TIMER_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
  fontVariantNumeric: "tabular-nums",
  color: "var(--text-stronger)",
};
const WORKING_TEXT_STYLE: CSSProperties = {
  position: "relative",
  color: "transparent",
  background:
    "linear-gradient(90deg, rgba(255, 255, 255, 0.3), rgba(255, 255, 255, 0.95), rgba(255, 255, 255, 0.3))",
  backgroundSize: "200% 100%",
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  animation: "working-shimmer 2.2s ease-in-out infinite",
};
const WORKING_HINT_STYLE: CSSProperties = {
  marginLeft: "8px",
  color: "var(--text-faint)",
  fontSize: "11px",
};
const WORKING_ACTIVITY_STYLE: CSSProperties = {
  color: "var(--text-faint)",
  fontSize: "11px",
  maxWidth: "min(62ch, 54vw)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const TURN_COMPLETE_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
  margin: "6px 24px 12px 24px",
  color: "var(--text-faint)",
  fontSize: "11px",
  textTransform: "uppercase",
  letterSpacing: "0.12em",
};
const TURN_COMPLETE_LINE_STYLE: CSSProperties = {
  flex: "1",
  height: "1px",
  background: "linear-gradient(90deg, transparent, #3a3a44)",
};
const TURN_COMPLETE_LABEL_STYLE: CSSProperties = {
  whiteSpace: "nowrap",
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
  activeEngine?: MessagesEngine;
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
  activeEngine?: MessagesEngine;
  activeCollaborationModeId?: string | null;
  enableCollaborationBadge?: boolean;
  presentationProfile?: PresentationProfile | null;
  showRuntimeReconnectCard?: boolean;
  onRecoverThreadRuntime?: (
    workspaceId: string,
    threadId: string,
  ) => Promise<RuntimeReconnectRecoveryCallbackResult> | RuntimeReconnectRecoveryCallbackResult;
  onRecoverThreadRuntimeAndResend?: (
    workspaceId: string,
    threadId: string,
    message: Pick<QueuedMessage, "text" | "images">,
  ) => Promise<RuntimeReconnectRecoveryCallbackResult> | RuntimeReconnectRecoveryCallbackResult;
  retryMessage?: Pick<QueuedMessage, "text" | "images"> | null;
  isCopied: boolean;
  onCopy: (
    item: Extract<ConversationItem, { kind: "message" }>,
    copyText?: string,
  ) => void;
  codeBlockCopyUseModifier?: boolean;
  onOpenFileLink?: (path: string) => void;
  onOpenFileLinkMenu?: (event: React.MouseEvent, path: string) => void;
  streamMitigationProfile?: StreamMitigationProfile | null;
  onAssistantVisibleTextRender?: (payload: {
    itemId: string;
    visibleText: string;
  }) => void;
  suppressMemorySummaryCard?: boolean;
  suppressNoteCardSummaryCard?: boolean;
};

type DeferredImageState = {
  status: "idle" | "loading" | "loaded" | "error";
  src?: string;
  error?: string;
};

function deferredImageKey(
  image: NonNullable<Extract<ConversationItem, { kind: "message" }>["deferredImages"]>[number],
) {
  const locator = image.locator;
  return [
    locator.sessionId,
    locator.lineIndex,
    locator.blockIndex,
    locator.messageId ?? "",
    locator.mediaType,
  ].join(":");
}

function formatDeferredImageSize(byteSize: number) {
  if (!Number.isFinite(byteSize) || byteSize <= 0) {
    return "unknown size";
  }
  if (byteSize >= 1024 * 1024) {
    return `${(byteSize / 1024 / 1024).toFixed(1)} MB`;
  }
  if (byteSize >= 1024) {
    return `${Math.round(byteSize / 1024)} KB`;
  }
  return `${Math.round(byteSize)} B`;
}

type ReasoningRowProps = {
  item: Extract<ConversationItem, { kind: "reasoning" }>;
  workspaceId?: string | null;
  parsed: ReturnType<typeof parseReasoning>;
  isExpanded: boolean;
  isLive: boolean;
  activeEngine?: MessagesEngine;
  onToggle: (id: string) => void;
  onOpenFileLink?: (path: string) => void;
  onOpenFileLinkMenu?: (event: React.MouseEvent, path: string) => void;
  presentationProfile?: PresentationProfile | null;
  streamMitigationProfile?: StreamMitigationProfile | null;
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

type GeneratedImageRowProps = {
  item: Extract<ConversationItem, { kind: "generatedImage" }>;
  workspaceId?: string | null;
};

const LIVE_ASSISTANT_MARKDOWN_THROTTLE_MS = 48;
const CODEX_MEDIUM_STREAMING_THROTTLE_MS = 80;
const CODEX_LARGE_STREAMING_THROTTLE_MS = 120;
const CODEX_STRUCTURED_STREAMING_THROTTLE_MS = 160;
const CODEX_HUGE_STREAMING_THROTTLE_MS = 220;
const CODEX_MEDIUM_STREAMING_MIN_LENGTH = 260;
const CODEX_MEDIUM_STREAMING_MIN_LINES = 6;
const CODEX_LARGE_STREAMING_MIN_LENGTH = 700;
const CODEX_LARGE_STREAMING_MIN_LINES = 12;
const CODEX_STRUCTURED_STREAMING_MIN_HEADINGS = 3;
const CODEX_STRUCTURED_STREAMING_MIN_LIST_ITEMS = 6;
const CODEX_STRUCTURED_STREAMING_MIN_CODE_LINES = 8;
const CODEX_HUGE_STREAMING_MIN_LENGTH = 1_600;
const CODEX_HUGE_STREAMING_MIN_LINES = 36;

type MemoryPayloadPackView = {
  source: string;
  count: number;
  cleanedContext: string;
  rawPayload: string;
};

type StreamingMarkdownComplexity = {
  trimmedText: string;
  lineCount: number;
  headingCount: number;
  listItemCount: number;
  fencedCodeBlockCount: number;
  fencedCodeLineCount: number;
  structuredBlockCount: number;
  isMedium: boolean;
  isLarge: boolean;
  isHuge: boolean;
  isStructuredHeavy: boolean;
};

const EMPTY_STREAMING_MARKDOWN_COMPLEXITY: StreamingMarkdownComplexity = {
  trimmedText: "",
  lineCount: 0,
  headingCount: 0,
  listItemCount: 0,
  fencedCodeBlockCount: 0,
  fencedCodeLineCount: 0,
  structuredBlockCount: 0,
  isMedium: false,
  isLarge: false,
  isHuge: false,
  isStructuredHeavy: false,
};

function analyzeStreamingMarkdownComplexity(
  displayText: string,
): StreamingMarkdownComplexity {
  const trimmedText = displayText.trim();
  if (!trimmedText) {
    return EMPTY_STREAMING_MARKDOWN_COMPLEXITY;
  }

  const lines = trimmedText.split(/\r?\n/);
  const lineCount = lines.length;
  let headingCount = 0;
  let listItemCount = 0;
  let fencedCodeBlockCount = 0;
  let fencedCodeLineCount = 0;
  let insideCodeFence = false;

  for (const line of lines) {
    const normalizedLine = line.trim();
    if (!normalizedLine) {
      continue;
    }
    if (normalizedLine.startsWith("```")) {
      fencedCodeBlockCount += insideCodeFence ? 0 : 1;
      insideCodeFence = !insideCodeFence;
      continue;
    }
    if (insideCodeFence) {
      fencedCodeLineCount += 1;
      continue;
    }
    if (/^#{1,6}\s+/.test(normalizedLine)) {
      headingCount += 1;
      continue;
    }
    if (/^(?:[-*+]|\d+[.)])\s+/.test(normalizedLine)) {
      listItemCount += 1;
    }
  }

  const isMedium =
    trimmedText.length >= CODEX_MEDIUM_STREAMING_MIN_LENGTH ||
    lineCount >= CODEX_MEDIUM_STREAMING_MIN_LINES;
  const isLarge =
    trimmedText.length >= CODEX_LARGE_STREAMING_MIN_LENGTH ||
    lineCount >= CODEX_LARGE_STREAMING_MIN_LINES;
  const isHuge =
    trimmedText.length >= CODEX_HUGE_STREAMING_MIN_LENGTH ||
    lineCount >= CODEX_HUGE_STREAMING_MIN_LINES;
  const structuredBlockCount =
    headingCount + listItemCount + fencedCodeBlockCount + fencedCodeLineCount;
  const isStructuredHeavy =
    headingCount >= CODEX_STRUCTURED_STREAMING_MIN_HEADINGS ||
    listItemCount >= CODEX_STRUCTURED_STREAMING_MIN_LIST_ITEMS ||
    fencedCodeLineCount >= CODEX_STRUCTURED_STREAMING_MIN_CODE_LINES ||
    (fencedCodeBlockCount > 0 && structuredBlockCount >= CODEX_MEDIUM_STREAMING_MIN_LINES);

  return {
    trimmedText,
    lineCount,
    headingCount,
    listItemCount,
    fencedCodeBlockCount,
    fencedCodeLineCount,
    structuredBlockCount,
    isMedium,
    isLarge,
    isHuge,
    isStructuredHeavy,
  };
}

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
    previous.onOpenFileLinkMenu === next.onOpenFileLinkMenu &&
    previous.streamMitigationProfile === next.streamMitigationProfile &&
    previous.onAssistantVisibleTextRender === next.onAssistantVisibleTextRender &&
    previous.suppressMemorySummaryCard === next.suppressMemorySummaryCard &&
    previous.suppressNoteCardSummaryCard === next.suppressNoteCardSummaryCard
  );
}

function resolveAssistantMessageStreamingThrottleMs(
  item: Extract<ConversationItem, { kind: "message" }>,
  isStreaming: boolean,
  activeEngine: MessagesEngine,
  mitigationProfile: StreamMitigationProfile | null | undefined,
  presentationProfile: PresentationProfile | null | undefined,
  complexity: StreamingMarkdownComplexity,
) {
  if (!isStreaming) {
    return 80;
  }
  if (mitigationProfile?.messageStreamingThrottleMs) {
    return mitigationProfile.messageStreamingThrottleMs;
  }
  const baselineThrottleMs =
    presentationProfile?.assistantMarkdownStreamingThrottleMs ??
    LIVE_ASSISTANT_MARKDOWN_THROTTLE_MS;
  const useStagedMarkdownThrottle =
    presentationProfile?.useCodexStagedMarkdownThrottle ?? activeEngine === "codex";
  if (item.role !== "assistant" || !useStagedMarkdownThrottle) {
    return baselineThrottleMs;
  }
  if (!complexity.trimmedText) {
    return baselineThrottleMs;
  }
  if (complexity.isHuge) {
    return CODEX_HUGE_STREAMING_THROTTLE_MS;
  }
  if (complexity.isStructuredHeavy && complexity.isLarge) {
    return CODEX_STRUCTURED_STREAMING_THROTTLE_MS;
  }
  if (complexity.isLarge) {
    return CODEX_LARGE_STREAMING_THROTTLE_MS;
  }
  if (complexity.isStructuredHeavy || complexity.isMedium) {
    return CODEX_MEDIUM_STREAMING_THROTTLE_MS;
  }
  return baselineThrottleMs;
}

function resolveReasoningStreamingThrottleMs(
  isLive: boolean,
  mitigationProfile: StreamMitigationProfile | null | undefined,
  presentationProfile: PresentationProfile | null | undefined,
) {
  if (!isLive) {
    return 80;
  }
  return (
    mitigationProfile?.reasoningStreamingThrottleMs ??
    presentationProfile?.reasoningStreamingThrottleMs ??
    180
  );
}

function shouldUsePlainTextStreamingSurface(
  item: Extract<ConversationItem, { kind: "message" }>,
  isStreaming: boolean,
  activeEngine: MessagesEngine,
  mitigationProfile: StreamMitigationProfile | null | undefined,
) {
  return (
    item.role === "assistant" &&
    isStreaming &&
    activeEngine !== "codex" &&
    mitigationProfile?.renderPlainTextWhileStreaming === true
  );
}

function shouldUseLightweightStreamingMarkdown(
  item: Extract<ConversationItem, { kind: "message" }>,
  isStreaming: boolean,
  activeEngine: MessagesEngine,
  presentationProfile: PresentationProfile | null | undefined,
  complexity: StreamingMarkdownComplexity,
) {
  if (item.role !== "assistant" || !isStreaming) {
    return false;
  }
  const useStagedMarkdownThrottle =
    presentationProfile?.useCodexStagedMarkdownThrottle ?? activeEngine === "codex";
  if (!useStagedMarkdownThrottle) {
    return false;
  }
  if (!complexity.trimmedText) {
    return false;
  }
  return (
    complexity.isStructuredHeavy ||
    complexity.isMedium
  );
}

function areGeneratedImageItemsEqual(
  previous: Extract<ConversationItem, { kind: "generatedImage" }>,
  next: Extract<ConversationItem, { kind: "generatedImage" }>,
) {
  if (previous === next) {
    return true;
  }
  if (
    previous.id !== next.id ||
    previous.status !== next.status ||
    previous.promptText !== next.promptText ||
    previous.fallbackText !== next.fallbackText ||
    previous.anchorUserMessageId !== next.anchorUserMessageId ||
    previous.images.length !== next.images.length
  ) {
    return false;
  }
  return previous.images.every((image, index) => {
    const nextImage = next.images[index];
    return (
      nextImage?.src === image.src &&
      nextImage.localPath === image.localPath
    );
  });
}

function normalizeNoteCardImageIdentity(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const hasWindowsDrivePrefix = (candidate: string) => /^[A-Za-z][:|][\\/]/.test(candidate);
  const hasWindowsDriveHost = (candidate: string) => /^[A-Za-z][:|]/.test(candidate);
  const decodePath = (candidate: string) => {
    try {
      return decodeURIComponent(candidate);
    } catch {
      return candidate;
    }
  };

  let withoutFileScheme = trimmed;
  const lowerCased = trimmed.toLowerCase();
  if (lowerCased.startsWith("asset://localhost")) {
    withoutFileScheme = trimmed.slice("asset://localhost".length);
    if (!withoutFileScheme.startsWith("/")) {
      withoutFileScheme = `/${withoutFileScheme}`;
    }
    if (withoutFileScheme.startsWith("//")) {
      withoutFileScheme = withoutFileScheme.slice(1);
    }
    withoutFileScheme = decodePath(withoutFileScheme);
  } else if (lowerCased.startsWith("file://")) {
    const remainder = trimmed.slice("file://".length).trim();
    if (!remainder) {
      return "";
    }
    if (/^localhost\//i.test(remainder)) {
      withoutFileScheme = decodePath(remainder.replace(/^localhost\//i, ""));
    } else if (
      !remainder.startsWith("/")
      && !hasWindowsDrivePrefix(remainder)
      && !hasWindowsDriveHost(remainder)
    ) {
      const slashIndex = remainder.indexOf("/");
      if (slashIndex === -1) {
        withoutFileScheme = `//${remainder}`;
      } else {
        const host = remainder.slice(0, slashIndex);
        const tail = remainder.slice(slashIndex);
        withoutFileScheme = `//${host}${decodePath(tail)}`;
      }
    } else {
      withoutFileScheme = decodePath(remainder.replace(/\|/g, ":"));
    }
    if (
      !withoutFileScheme.startsWith("/")
      && !hasWindowsDrivePrefix(withoutFileScheme)
      && !hasWindowsDriveHost(withoutFileScheme)
    ) {
      withoutFileScheme = `/${withoutFileScheme}`;
    }
  }
  const normalized = withoutFileScheme.replace(/\\/g, "/");
  if (/^\/[A-Za-z]:\//.test(normalized)) {
    return normalized.slice(1).toLowerCase();
  }
  if (/^[A-Za-z]:\//.test(normalized)) {
    return normalized.toLowerCase();
  }
  return normalized;
}

const COLLAPSED_NOTE_CARD_IMAGE_PREVIEW_COUNT = 1;
const COLLAPSED_NOTE_CARD_BODY_PREVIEW_MAX_CHARS = 96;

function buildNoteCardBodyPreview(bodyMarkdown: string) {
  const normalized = bodyMarkdown
    .replace(/```[\s\S]*?```/g, "[code]")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^[>\-*\d.\s#]+/gm, "")
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return "";
  }
  return normalized.length > COLLAPSED_NOTE_CARD_BODY_PREVIEW_MAX_CHARS
    ? `${normalized.slice(0, COLLAPSED_NOTE_CARD_BODY_PREVIEW_MAX_CHARS).trimEnd()}...`
    : normalized;
}

const NoteCardContextSummaryCard = memo(function NoteCardContextSummaryCard({
  summary,
  workspaceId = null,
  codeBlockCopyUseModifier,
  onOpenFileLink,
  onOpenFileLinkMenu,
}: {
  summary: NoteCardContextSummary;
  workspaceId?: string | null;
  codeBlockCopyUseModifier?: boolean;
  onOpenFileLink?: (path: string) => void;
  onOpenFileLinkMenu?: (event: React.MouseEvent, path: string) => void;
}) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const [imagePreview, setImagePreview] = useState<{
    src: string;
    localPath: string;
    alt: string;
  } | null>(null);
  const summarySignature = useMemo(
    () =>
      summary.notes
        .map((note) =>
          [
            note.title,
            note.archived ? "1" : "0",
            note.bodyMarkdown,
            note.attachments.map((attachment) => attachment.absolutePath).join("|"),
          ].join("::"),
        )
        .join("###"),
    [summary.notes],
  );

  useEffect(() => {
    setIsExpanded(false);
  }, [summarySignature]);

  return (
    <>
      <div className="note-card-context-summary-card w-[min(720px,100%)] grid gap-2 px-3.5 py-3 rounded-2xl border border-[color-mix(in_srgb,var(--border-strong)_82%,transparent)] [background:linear-gradient(180deg,color-mix(in_srgb,var(--surface-card)_95%,var(--accent-primary,var(--accent,#2563eb))_5%),color-mix(in_srgb,var(--surface-card)_98%,var(--surface-panel,transparent)_2%))]">
        <div className="note-card-context-summary-head flex items-center gap-2.5">
          <div className="note-card-context-summary-head-copy min-w-0 inline-flex items-center gap-2.5">
            <span className="note-card-context-summary-title text-xs font-bold tracking-[0.08em] uppercase text-[color-mix(in_srgb,var(--text-muted)_72%,var(--accent-primary,var(--accent,#2563eb))_28%)]">
              {t("messages.noteCardContextSummary")}
            </span>
            <span className="note-card-context-summary-count text-[11px] text-(--text-faint)">
              {t("messages.noteCardContextSummaryCount", {
                count: summary.notes.length,
              })}
            </span>
          </div>
          <button
            type="button"
            className="note-card-context-summary-toggle ml-auto min-h-[30px] inline-flex items-center justify-center gap-1.5 pr-1.5 pl-2.5 border border-[color-mix(in_srgb,var(--border-subtle)_82%,transparent)] rounded-full [background:color-mix(in_srgb,var(--surface-item)_82%,var(--surface-card))] text-(--text-strong) cursor-pointer [transition:background-color_0.18s_ease,border-color_0.18s_ease,color_0.18s_ease,transform_0.18s_ease] hover:[background:color-mix(in_srgb,var(--surface-active)_76%,var(--surface-card))] hover:border-[color-mix(in_srgb,var(--accent-primary,var(--accent,#2563eb))_48%,var(--border-strong))] hover:[transform:translateY(-1px)]"
            onClick={() => setIsExpanded((current) => !current)}
            aria-expanded={isExpanded}
            aria-label={
              isExpanded
                ? t("messages.noteCardContextCollapse")
                : t("messages.noteCardContextExpand")
            }
            title={
              isExpanded
                ? t("messages.noteCardContextCollapse")
                : t("messages.noteCardContextExpand")
            }
          >
            <span className="note-card-context-summary-toggle-label text-[11px] leading-none whitespace-nowrap">
              {isExpanded
                ? t("messages.noteCardContextCollapse")
                : t("messages.noteCardContextExpand")}
            </span>
            <span className="note-card-context-summary-toggle-icon w-5 h-5 inline-flex items-center justify-center rounded-full [background:color-mix(in_srgb,var(--accent-primary,var(--accent,#2563eb))_16%,transparent)] text-[color-mix(in_srgb,var(--accent-primary,var(--accent,#2563eb))_80%,var(--text-strong)_20%)] [&_svg]:w-3.5 [&_svg]:h-3.5 [&_svg]:block [&_svg]:stroke-current [&_svg]:[stroke-width:2.4px] [&_svg]:fill-none" aria-hidden>
              {isExpanded ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
            </span>
          </button>
        </div>
        <div className="note-card-context-summary-list grid gap-0">
          {summary.notes.map((note, index) => {
            const noteTitle = note.title.trim() || t("noteCards.untitled");
            const bodyPreview = buildNoteCardBodyPreview(note.bodyMarkdown);
            const visibleAttachments = isExpanded
              ? note.attachments
              : note.attachments.slice(0, COLLAPSED_NOTE_CARD_IMAGE_PREVIEW_COUNT);
            return (
              <article
                key={`${noteTitle}-${index}`}
                className={`note-card-context-summary-note grid gap-1.5 pt-2.5 pb-0 px-0 border-t border-[color-mix(in_srgb,var(--border-subtle)_68%,transparent)] bg-transparent first:pt-0 first:border-t-0${isExpanded ? " is-expanded" : " is-collapsed"}`}
              >
                <div className="note-card-context-summary-note-head flex items-start justify-between gap-3 [&>strong]:block [&>strong]:min-w-0 [&>strong]:flex-1 [&>strong]:overflow-hidden [&>strong]:text-ellipsis [&>strong]:whitespace-nowrap [&>strong]:text-[13px] [&>strong]:text-(--text-strong)">
                  <strong>{noteTitle}</strong>
                  <span className="note-card-context-summary-note-meta inline-flex items-center gap-1.5 flex-wrap">
                    {note.archived ? (
                      <span className="note-card-context-summary-note-badge inline-flex items-center min-h-5 px-2 rounded-full border border-[color-mix(in_srgb,var(--border-subtle)_80%,transparent)] [background:color-mix(in_srgb,var(--surface-card)_80%,transparent)] text-[10px] text-(--text-muted)">
                        {t("composer.noteCardArchivedBadge")}
                      </span>
                    ) : null}
                    {note.attachments.length > 0 ? (
                      <span className="note-card-context-summary-note-badge inline-flex items-center min-h-5 px-2 rounded-full border border-[color-mix(in_srgb,var(--border-subtle)_80%,transparent)] [background:color-mix(in_srgb,var(--surface-card)_80%,transparent)] text-[10px] text-(--text-muted)">
                        {t("noteCards.imageCount", { count: note.attachments.length })}
                      </span>
                    ) : null}
                  </span>
                </div>
                {isExpanded ? (
                  note.bodyMarkdown ? (
                    <Markdown
                      value={note.bodyMarkdown}
                      className="markdown note-card-context-summary-markdown text-[13px] text-(--text-secondary)"
                      workspaceId={workspaceId}
                      codeBlockStyle="message"
                      codeBlockCopyUseModifier={codeBlockCopyUseModifier}
                      onOpenFileLink={onOpenFileLink}
                      onOpenFileLinkMenu={onOpenFileLinkMenu}
                    />
                  ) : null
                ) : bodyPreview ? (
                  <p className="note-card-context-summary-preview m-0 text-xs leading-normal text-(--text-secondary) [display:-webkit-box] [-webkit-line-clamp:1] [-webkit-box-orient:vertical] overflow-hidden">{bodyPreview}</p>
                ) : null}
                {visibleAttachments.length > 0 ? (
                  <div className="note-card-context-summary-images grid grid-cols-[repeat(auto-fit,minmax(48px,52px))] gap-1.5" role="list">
                    {visibleAttachments.map((attachment, attachmentIndex) => {
                      const src =
                        normalizeMessageImageSrc(attachment.absolutePath)
                        || attachment.absolutePath;
                      const alt =
                        attachment.fileName || `${noteTitle} image ${attachmentIndex + 1}`;
                      return (
                        <button
                          key={`${noteTitle}-${attachment.absolutePath}-${attachmentIndex}`}
                          type="button"
                          className="note-card-context-summary-image w-[52px] h-[52px] border border-[color-mix(in_srgb,var(--border-subtle)_72%,transparent)] p-0 rounded-[10px] overflow-hidden aspect-square [background:color-mix(in_srgb,var(--surface-item)_86%,transparent)] cursor-zoom-in [&_img]:block [&_img]:w-full [&_img]:h-full [&_img]:object-cover"
                          role="listitem"
                          onClick={() =>
                            setImagePreview({
                              src,
                              localPath: attachment.absolutePath,
                              alt,
                            })
                          }
                          aria-label={alt}
                          title={alt}
                        >
                          <LocalImage
                            src={src}
                            localPath={attachment.absolutePath}
                            workspaceId={workspaceId}
                            alt={alt}
                            loading="lazy"
                          />
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </div>
      {imagePreview ? (
        <ImagePreviewOverlay
          src={imagePreview.src}
          localPath={imagePreview.localPath}
          workspaceId={workspaceId}
          alt={imagePreview.alt}
          onClose={() => setImagePreview(null)}
        />
      ) : null}
    </>
  );
});

export const WorkingIndicator = memo(function WorkingIndicator({
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
        <div className={`working${streamPhaseClass}`} style={WORKING_BASE_STYLE}>
          {proxyEnabled && (
            <ProxyStatusBadge
              proxyUrl={proxyUrl}
              label={t("messages.proxyBadge")}
              variant="prominent"
              animated
              className="working-proxy-badge"
              style={WORKING_PROXY_BADGE_STYLE}
            />
          )}
          <span className="working-spinner" aria-hidden />
          <div className="working-timer" style={WORKING_TIMER_STYLE}>
            <span className="working-timer-clock">{formatDurationMs(elapsedMs)}</span>
          </div>
          <span className="working-text" style={WORKING_TEXT_STYLE}>
            {primaryLabel || reasoningLabel || t("messages.generatingResponse")}
          </span>
          {showActivityLabel && (
            <span className="working-activity" style={WORKING_ACTIVITY_STYLE}>
              {activityLabel}
            </span>
          )}
          {showNonStreamingHint && (
            <span className="working-hint" style={WORKING_HINT_STYLE}>
              {heartbeatHintText || resolvedNonStreamingHint}
            </span>
          )}
        </div>
      )}
      {!isThinking && lastDurationMs !== null && hasItems && (
        <div
          className="turn-complete"
          aria-live="polite"
          style={TURN_COMPLETE_STYLE}
        >
          <span
            className="turn-complete-line"
            aria-hidden
            style={TURN_COMPLETE_LINE_STYLE}
          />
          <span className="turn-complete-label" style={TURN_COMPLETE_LABEL_STYLE}>
            {t("messages.doneIn", { duration: formatDurationMs(lastDurationMs) })}
          </span>
          <span
            className="turn-complete-line"
            aria-hidden
            style={TURN_COMPLETE_LINE_STYLE}
          />
        </div>
      )}
    </>
  );
});

export const MessageRow = memo(function MessageRow({
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
  streamMitigationProfile = null,
  onAssistantVisibleTextRender,
  suppressMemorySummaryCard = false,
  suppressNoteCardSummaryCard = false,
}: MessageRowProps) {
  const { t } = useTranslation();
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [deferredImageStates, setDeferredImageStates] = useState<Record<string, DeferredImageState>>({});
  const [memorySummaryExpanded, setMemorySummaryExpanded] = useState(false);
  const [memoryPayloadDialogOpen, setMemoryPayloadDialogOpen] = useState(false);
  const [isAgentBadgeExpanded, setIsAgentBadgeExpanded] = useState(false);
  useEffect(() => {
    if (!memoryPayloadDialogOpen) {
      return undefined;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMemoryPayloadDialogOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [memoryPayloadDialogOpen]);
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
  const noteCardSummary = useMemo(
    () =>
      item.role === "assistant"
        ? parseNoteCardContextSummary(item.text)
        : userMessagePresentation?.noteCardSummary ?? null,
    [item.role, item.text, userMessagePresentation?.noteCardSummary],
  );
  const resolvedMemorySummary = suppressMemorySummaryCard ? null : memorySummary;
  const resolvedNoteCardSummary = suppressNoteCardSummaryCard ? null : noteCardSummary;
  const memorySummaryRecords = resolvedMemorySummary?.records ?? [];
  const memorySummaryRawPayload = resolvedMemorySummary?.rawPayload?.trim() ?? "";
  const memoryPayloadPacks: MemoryPayloadPackView[] =
    resolvedMemorySummary?.memoryPacks ?? [];
  const agentTaskNotification = useMemo(
    () => parseAgentTaskNotification(item.text),
    [item.text],
  );
  const shouldHideSuppressedInjectedContextText =
    item.role === "user" &&
    !agentTaskNotification &&
    (
      (
        suppressMemorySummaryCard &&
        Boolean(userMessagePresentation?.memorySummary) &&
        (userMessagePresentation?.stickyCandidateText ?? "").trim().length === 0
      ) ||
      (
        suppressNoteCardSummaryCard &&
        Boolean(userMessagePresentation?.noteCardSummary) &&
        (userMessagePresentation?.stickyCandidateText ?? "").trim().length === 0
      )
    );
  const displayText = agentTaskNotification
    ? agentTaskNotification.resultText
    : item.role === "user"
      ? (
          shouldHideSuppressedInjectedContextText
            ? ""
            : (userMessagePresentation?.displayText ?? item.text)
        )
      : resolvedMemorySummary || resolvedNoteCardSummary
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
  const parsedUserTextContent = useMemo(
    () => (
      item.role === "user" && !agentTaskNotification && hasText
        ? parseUserTextContent(displayText)
        : null
    ),
    [agentTaskNotification, displayText, hasText, item.role],
  );
  const noteCardImagePathSet = useMemo(
    () =>
      new Set(
        (noteCardSummary?.imagePaths ?? []).map((path) =>
          normalizeNoteCardImageIdentity(path),
        ),
      ),
    [noteCardSummary?.imagePaths],
  );
  const imageItems = useMemo(() => {
    if (!item.images || item.images.length === 0) {
      return [];
    }
    return item.images
      .filter((image) => !noteCardImagePathSet.has(normalizeNoteCardImageIdentity(image)))
      .map((image, index) => {
        const src = normalizeMessageImageSrc(image);
        if (!src) {
          return null;
        }
        return { src, label: `Image ${index + 1}` };
      })
      .filter(Boolean) as MessageImage[];
  }, [item.images, noteCardImagePathSet]);
  const deferredImageItems = item.deferredImages ?? [];
  const handleLoadDeferredImage = useCallback(
    async (
      image: NonNullable<Extract<ConversationItem, { kind: "message" }>["deferredImages"]>[number],
    ) => {
      const key = deferredImageKey(image);
      if (!image.workspacePath) {
        setDeferredImageStates((current) => ({
          ...current,
          [key]: {
            status: "error",
            error: "Missing workspace path for this Claude image.",
          },
        }));
        return;
      }
      setDeferredImageStates((current) => ({
        ...current,
        [key]: { status: "loading" },
      }));
      try {
        const hydrated = await hydrateClaudeDeferredImage(
          image.workspacePath,
          image.locator,
        );
        setDeferredImageStates((current) => ({
          ...current,
          [key]: {
            status: "loaded",
            src: hydrated.src,
          },
        }));
      } catch (error) {
        setDeferredImageStates((current) => ({
          ...current,
          [key]: {
            status: "error",
            error: error instanceof Error ? error.message : String(error),
          },
        }));
      }
    },
    [],
  );
  const hideCopyButton = (
    !hasText
    && imageItems.length === 0
    && deferredImageItems.length === 0
  ) || (
    item.role === "assistant"
    && (Boolean(resolvedMemorySummary) || Boolean(resolvedNoteCardSummary))
    && !hasText
    && imageItems.length === 0
    && deferredImageItems.length === 0
  );
  const useCodexCanvasMarkdown = presentationProfile
    ? presentationProfile.codexCanvasMarkdown
    : activeEngine === "codex";
  const useStagedMarkdownThrottle =
    presentationProfile?.useCodexStagedMarkdownThrottle ?? activeEngine === "codex";
  const markdownClassName =
    item.role === "assistant" && useCodexCanvasMarkdown
      ? "markdown markdown-codex-canvas"
      : "markdown";
  const resolvedMarkdownClassName = isStreaming
    ? `${markdownClassName} markdown-live-streaming break-words [overflow-wrap:anywhere]`
    : markdownClassName;
  const streamingMarkdownComplexityCacheRef = useRef<{
    value: string;
    complexity: StreamingMarkdownComplexity;
  } | null>(null);
  const streamingMarkdownComplexity = useMemo(
    () => {
      if (
        item.role !== "assistant" ||
        !isStreaming ||
        !useStagedMarkdownThrottle
      ) {
        streamingMarkdownComplexityCacheRef.current = null;
        return EMPTY_STREAMING_MARKDOWN_COMPLEXITY;
      }
      const previousCache = streamingMarkdownComplexityCacheRef.current;
      if (
        previousCache &&
        previousCache.complexity.isHuge &&
        displayText.startsWith(previousCache.value)
      ) {
        return previousCache.complexity;
      }
      const nextComplexity = analyzeStreamingMarkdownComplexity(displayText);
      streamingMarkdownComplexityCacheRef.current = {
        value: displayText,
        complexity: nextComplexity,
      };
      return nextComplexity;
    },
    [displayText, isStreaming, item.role, useStagedMarkdownThrottle],
  );
  const usePlainTextStreamingSurface = shouldUsePlainTextStreamingSurface(
    item,
    isStreaming,
    activeEngine,
    streamMitigationProfile,
  );
  const useLightweightStreamingMarkdown = !usePlainTextStreamingSurface && shouldUseLightweightStreamingMarkdown(
    item,
    isStreaming,
    activeEngine,
    presentationProfile,
    streamingMarkdownComplexity,
  );
  const livePlainTextClassName = `${resolvedMarkdownClassName} markdown-live-plain-text whitespace-pre-wrap`;
  const handleRenderedAssistantValue = useCallback(
    (visibleText: string) => {
      if (item.role !== "assistant" || !isStreaming) {
        return;
      }
      onAssistantVisibleTextRender?.({
        itemId: item.id,
        visibleText,
      });
    },
    [isStreaming, item.id, item.role, onAssistantVisibleTextRender],
  );
  useEffect(() => {
    if (!usePlainTextStreamingSurface) {
      return;
    }
    handleRenderedAssistantValue(displayText);
  }, [displayText, handleRenderedAssistantValue, usePlainTextStreamingSurface]);
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
        <div className="message-agent-task-card grid gap-2.5 px-4 pt-3.5 pb-3 mb-2.5 rounded-[18px] border border-[color-mix(in_srgb,var(--border-strong)_84%,#2563eb_16%)] [background:linear-gradient(180deg,color-mix(in_srgb,var(--surface-card)_88%,#2563eb_12%)_0%,color-mix(in_srgb,var(--surface-card)_95%,transparent)_100%)] [box-shadow:0_16px_36px_color-mix(in_srgb,#020617_18%,transparent),inset_0_1px_0_color-mix(in_srgb,#ffffff_8%,transparent)]">
          <div className="message-agent-task-header grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
            <div className="message-agent-task-avatar w-[34px] h-[34px] rounded-xl inline-flex items-center justify-center bg-[color-mix(in_srgb,#2563eb_18%,var(--surface-card))] text-[color-mix(in_srgb,#2563eb_64%,var(--text-primary))] border border-[color-mix(in_srgb,#2563eb_22%,var(--border-strong))]" aria-hidden>
              <AgentIcon
                seed={agentTaskDisplay.title || agentTaskNotification.taskId || item.id}
                fallback="codicon-hubot"
                className="message-agent-task-avatar-icon inline-flex"
                size={18}
              />
            </div>
            <div className="message-agent-task-heading min-w-0 grid gap-0.5">
              <span className="message-agent-task-eyebrow text-[11px] leading-none font-bold tracking-[0.08em] uppercase text-[color-mix(in_srgb,var(--text-muted)_84%,#2563eb_16%)]">Agent session</span>
              <strong className="message-agent-task-title min-w-0 text-[15px] leading-tight font-bold text-(--text-primary)">{agentTaskDisplay.title}</strong>
              {agentTaskDisplay.subtitle ? (
                <span className="message-agent-task-subtitle min-w-0 text-xs leading-tight text-(--text-secondary)">{agentTaskDisplay.subtitle}</span>
              ) : null}
            </div>
            <span className={`message-agent-task-status is-${agentTaskDisplay.status.tone} inline-flex items-center justify-center min-h-6 px-2.5 rounded-full border border-(--border-strong) bg-[color-mix(in_srgb,var(--surface-card)_88%,transparent)] text-[11px] font-bold tracking-[0.04em] uppercase text-(--text-secondary)`}>
              {agentTaskDisplay.status.label}
            </span>
          </div>
          <div className="message-agent-task-meta flex flex-wrap gap-2">
            {agentTaskNotification.taskId ? (
              <span className="message-agent-task-chip inline-flex items-center min-h-[22px] px-2.25 rounded-full bg-[color-mix(in_srgb,var(--surface-card)_92%,transparent)] border border-[color-mix(in_srgb,var(--border-strong)_92%,transparent)] text-(--text-secondary) text-[11px] leading-none whitespace-nowrap">task {agentTaskNotification.taskId}</span>
            ) : null}
            {agentTaskNotification.toolUseId ? (
              <span className="message-agent-task-chip inline-flex items-center min-h-[22px] px-2.25 rounded-full bg-[color-mix(in_srgb,var(--surface-card)_92%,transparent)] border border-[color-mix(in_srgb,var(--border-strong)_92%,transparent)] text-(--text-secondary) text-[11px] leading-none whitespace-nowrap">tool {agentTaskNotification.toolUseId}</span>
            ) : null}
            {agentTaskDisplay.outputFileName ? (
              <span className="message-agent-task-chip inline-flex items-center min-h-[22px] px-2.25 rounded-full bg-[color-mix(in_srgb,var(--surface-card)_92%,transparent)] border border-[color-mix(in_srgb,var(--border-strong)_92%,transparent)] text-(--text-secondary) text-[11px] leading-none whitespace-nowrap">{agentTaskDisplay.outputFileName}</span>
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
      {deferredImageItems.length > 0 ? (
        <div className="message-deferred-image-list grid gap-2 mb-2" role="list">
          {deferredImageItems.map((image, index) => {
            const key = deferredImageKey(image);
            const state = deferredImageStates[key] ?? { status: "idle" };
            return (
              <div
                key={key}
                className={`message-deferred-image is-${state.status} flex items-center justify-between gap-3 py-2.5 px-3 border border-dashed border-[color-mix(in_srgb,var(--border-strong)_72%,transparent)] rounded-2xl bg-[color-mix(in_srgb,var(--surface-item)_86%,transparent)]`}
                role="listitem"
              >
                {state.status === "loaded" && state.src ? (
                  <div
                    className="message-deferred-image-preview w-40 max-w-full rounded-xl overflow-hidden bg-[color-mix(in_srgb,var(--surface-item)_92%,transparent)] [&_img]:block [&_img]:w-full [&_img]:h-auto"
                  >
                    <img src={state.src} alt={`Deferred Claude image ${index + 1}`} loading="lazy" />
                  </div>
                ) : (
                  <>
                    <div className="message-deferred-image-copy grid gap-0.75 min-w-0">
                      <span className="message-deferred-image-title text-xs font-[650] text-(--text-primary)">
                        Claude history image available on demand
                      </span>
                      <span className="message-deferred-image-meta text-[11px] text-(--text-secondary)">
                        {image.mediaType} · {formatDeferredImageSize(image.estimatedByteSize)}
                      </span>
                      {state.status === "error" && state.error ? (
                        <span className="message-deferred-image-error text-[11px] text-(--danger)">{state.error}</span>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="message-deferred-image-action flex-none border border-(--border-accent) rounded-full py-1.5 px-2.5 bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-(--text-primary) text-xs font-[650] disabled:cursor-wait disabled:opacity-65"
                      onClick={() => void handleLoadDeferredImage(image)}
                      disabled={state.status === "loading"}
                    >
                      {state.status === "loading" ? "Loading..." : "Load image"}
                    </button>
                  </>
                )}
              </div>
            );
          })}
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
          <CollapsibleUserTextBlock
            content={displayText}
            parsedContent={parsedUserTextContent ?? undefined}
          />
        ) : runtimeReconnectHint && showRuntimeReconnectCard ? null : usePlainTextStreamingSurface ? (
          <div className={livePlainTextClassName}>
            {displayText}
          </div>
        ) : (
          <Markdown
            value={displayText}
            className={resolvedMarkdownClassName}
            workspaceId={workspaceId}
            codeBlockStyle="message"
            codeBlockCopyUseModifier={codeBlockCopyUseModifier}
            streamingThrottleMs={resolveAssistantMessageStreamingThrottleMs(
              item,
              isStreaming,
              activeEngine,
              streamMitigationProfile,
              presentationProfile,
              streamingMarkdownComplexity,
            )}
            onOpenFileLink={onOpenFileLink}
            onOpenFileLinkMenu={onOpenFileLinkMenu}
            liveRenderMode={useLightweightStreamingMarkdown ? "lightweight" : "full"}
            progressiveReveal={useLightweightStreamingMarkdown}
            onRenderedValueChange={handleRenderedAssistantValue}
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
  const codeAnnotationContextNode =
    parsedUserTextContent && parsedUserTextContent.codeAnnotations.length > 0 ? (
      <UserCodeAnnotationContextBlock annotations={parsedUserTextContent.codeAnnotations} />
    ) : null;
  const noteCardSummaryNode = resolvedNoteCardSummary ? (
    <NoteCardContextSummaryCard
      summary={resolvedNoteCardSummary}
      workspaceId={workspaceId}
      codeBlockCopyUseModifier={codeBlockCopyUseModifier}
      onOpenFileLink={onOpenFileLink}
      onOpenFileLinkMenu={onOpenFileLinkMenu}
    />
  ) : null;
  const shouldRenderBubble =
    agentTaskNotification
    || imageItems.length > 0
    || deferredImageItems.length > 0
    || (Boolean(runtimeReconnectHint) && showRuntimeReconnectCard)
    || hasText
    || !hideCopyButton;
  const memoryPayloadDialogNode =
    memoryPayloadDialogOpen && memorySummaryRawPayload && typeof document !== "undefined"
      ? createPortal(
        <div
          className="memory-context-payload-dialog-overlay fixed inset-0 z-[2000] grid place-items-center p-6 bg-black/40"
          role="presentation"
          onClick={() => setMemoryPayloadDialogOpen(false)}
        >
          <div
            className="memory-context-payload-dialog w-[min(860px,calc(100vw-48px))] max-h-[min(720px,calc(100vh-48px))] grid grid-rows-[auto_minmax(0,1fr)] border border-(--border-subtle) rounded-[14px] bg-(--surface-card) [box-shadow:0_24px_80px_rgba(0,0,0,0.35)] overflow-hidden"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${item.id}-memory-payload-title`}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="memory-context-payload-dialog-header flex items-start justify-between gap-4 px-4 py-3.5 border-b border-(--border-subtle) [&_h3]:m-0 [&_h3]:text-(--text-primary) [&_h3]:text-sm [&_h3]:font-bold [&_p]:mt-1 [&_p]:mr-0 [&_p]:mb-0 [&_p]:ml-0 [&_p]:text-(--text-muted) [&_p]:text-xs [&_p]:leading-normal">
              <div>
                <h3 id={`${item.id}-memory-payload-title`}>
                  {t("messages.memoryContextSentDetailsTitle")}
                </h3>
                <p>{t("messages.memoryContextSentDetailsHint")}</p>
              </div>
              <button
                type="button"
                className="memory-context-payload-dialog-close w-7 h-7 inline-flex items-center justify-center border border-(--border-subtle) rounded-full bg-transparent text-(--text-muted) cursor-pointer flex-none text-[22px] font-medium leading-none hover:text-(--text-primary) hover:[background:var(--surface-elevated,transparent)] [&_span]:block [&_span]:[transform:translateY(-1px)]"
                aria-label={t("messages.memoryContextCloseDetails")}
                onClick={() => setMemoryPayloadDialogOpen(false)}
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
            <div className="memory-context-payload-dialog-body min-h-0 overflow-auto px-4 pt-3.5 pb-4.5 grid gap-3.5">
              {memoryPayloadPacks.length > 0 ? (
                <div className="memory-context-payload-pack-list grid gap-3">
                  {memoryPayloadPacks.map((pack, packIndex) => (
                    <section
                      key={`${item.id}-memory-payload-pack-${packIndex}`}
                      className="memory-context-payload-pack grid gap-2.5 border border-(--border-subtle) rounded-xl [background:var(--surface-elevated,rgba(255,255,255,0.03))] p-3"
                    >
                      <div className="memory-context-payload-pack-header flex items-baseline justify-between gap-3">
                        <span className="memory-context-payload-pack-title text-(--text-primary) text-[13px] font-bold">
                          {t("messages.memoryContextPayloadPackTitle", {
                            index: packIndex + 1,
                          })}
                        </span>
                        <span className="memory-context-payload-pack-meta text-(--text-faint) text-[11px] whitespace-nowrap">
                          {t("messages.memoryContextPayloadPackMeta", {
                            source: pack.source || t("messages.memoryContextSourceUnknown"),
                            count: Number(pack.count),
                          })}
                        </span>
                      </div>
                      <div className="memory-context-payload-section-label text-(--text-muted) text-[11px] font-bold tracking-[0.04em] uppercase">
                        {t("messages.memoryContextPayloadCleanedContext")}
                      </div>
                      <Markdown
                        value={pack.cleanedContext}
                        className="markdown memory-context-payload-markdown text-(--text-muted) text-xs leading-[1.55]"
                        workspaceId={workspaceId}
                        codeBlockStyle="message"
                        codeBlockCopyUseModifier={codeBlockCopyUseModifier}
                        onOpenFileLink={onOpenFileLink}
                        onOpenFileLinkMenu={onOpenFileLinkMenu}
                      />
                    </section>
                  ))}
                </div>
              ) : (
                <Markdown
                  value={memorySummaryRawPayload}
                  className="markdown memory-context-payload-markdown text-(--text-muted) text-xs leading-[1.55]"
                  workspaceId={workspaceId}
                  codeBlockStyle="message"
                  codeBlockCopyUseModifier={codeBlockCopyUseModifier}
                  onOpenFileLink={onOpenFileLink}
                  onOpenFileLinkMenu={onOpenFileLinkMenu}
                />
              )}
              <details className="memory-context-payload-raw border border-(--border-subtle) rounded-[10px] [background:var(--surface-sunken,rgba(0,0,0,0.16))] overflow-hidden [&>summary]:cursor-pointer [&>summary]:py-2.25 [&>summary]:px-2.75 [&>summary]:text-(--text-muted) [&>summary]:text-xs [&>summary]:font-bold">
                <summary>{t("messages.memoryContextPayloadRaw")}</summary>
                <pre className="memory-context-payload-dialog-code m-0 p-3 overflow-auto text-(--text-muted) border-t border-(--border-subtle) bg-black/20 [font-family:var(--font-mono,'SFMono-Regular','Consolas',monospace)] text-[11px] leading-normal whitespace-pre-wrap break-words">
                  <code>{memorySummaryRawPayload}</code>
                </pre>
              </details>
            </div>
          </div>
        </div>,
        document.body,
      )
      : null;
  const memorySummaryNode = resolvedMemorySummary ? (
    <>
      <div className="memory-context-summary-card border border-(--border-subtle) rounded-[10px] bg-(--surface-card) max-w-[860px]">
        <button
          type="button"
          className="memory-context-summary-toggle w-full border-0 bg-transparent text-inherit flex items-center gap-2 px-2.5 py-2 text-left cursor-pointer"
          onClick={() => setMemorySummaryExpanded((current) => !current)}
          aria-expanded={memorySummaryExpanded}
        >
          <span className="memory-context-summary-title text-xs font-semibold tracking-[0.01em]">
            {t("messages.memoryContextSummary")}
          </span>
          <span className="memory-context-summary-count ml-auto text-[11px] text-(--text-faint)">
            {t("messages.memoryContextSummaryCount", {
              count: resolvedMemorySummary.lines.length,
            })}
          </span>
          {memorySummaryExpanded ? (
            <ChevronUp size={14} aria-hidden />
          ) : (
            <ChevronDown size={14} aria-hidden />
          )}
        </button>
        {memorySummaryExpanded && (
          <div className="memory-context-summary-content border-t border-(--border-subtle) px-2.5 pt-2 pb-2.25 flex flex-col gap-1.5 [&_p]:m-0 [&_p]:text-xs [&_p]:leading-normal [&_p]:text-(--text-muted)">
            {memorySummaryRecords.length > 0 ? (
              <div className="memory-context-summary-record-list grid gap-1.5">
                {memorySummaryRecords.map((record) => {
                  const sourceLabel = record.source === "manual-selection"
                    ? t("messages.memoryContextSourceManual")
                    : record.source === "memory-scout"
                      ? t("messages.memoryContextSourceMemoryReference")
                      : (record.source || t("messages.memoryContextSourceUnknown"));
                  return (
                    <div
                      key={`${item.id}-${record.displayIndex}-${record.index}-${record.memoryId}`}
                      className="memory-context-summary-record grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 min-w-0 py-1.5 px-2 border border-(--border-subtle) rounded-lg [background:var(--surface-elevated,var(--surface-card))]"
                    >
                      <span className="memory-context-summary-record-index text-[11px] font-bold [color:var(--text-accent,var(--accent-500,var(--text-muted)))] whitespace-nowrap">
                        {record.displayIndex}
                      </span>
                      <span className="memory-context-summary-record-copy min-w-0 grid gap-0.5">
                        <span className="memory-context-summary-record-title min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-(--text-muted)">
                          {record.title || record.memoryId}
                        </span>
                        <span className="memory-context-summary-record-meta min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[10px] text-(--text-faint)">
                          {t("messages.memoryContextRecordMeta", {
                            source: sourceLabel,
                            index: record.index,
                          })}
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <Markdown
                value={resolvedMemorySummary.markdown ?? resolvedMemorySummary.lines.join("\n\n")}
                className="markdown memory-context-summary-markdown text-xs leading-[1.5] text-(--text-muted)"
                workspaceId={workspaceId}
                codeBlockStyle="message"
                codeBlockCopyUseModifier={codeBlockCopyUseModifier}
                onOpenFileLink={onOpenFileLink}
                onOpenFileLinkMenu={onOpenFileLinkMenu}
              />
            )}
            {memorySummaryRawPayload ? (
              <button
                type="button"
                className="memory-context-summary-detail-button self-start border border-(--border-subtle) rounded-full [background:var(--surface-elevated,var(--surface-card))] text-(--text-muted) cursor-pointer text-[11px] font-semibold px-2.5 py-1.25 hover:text-(--text-primary) hover:border-[var(--border-strong,var(--border-subtle))]"
                onClick={() => setMemoryPayloadDialogOpen(true)}
              >
                {t("messages.memoryContextViewSentDetails")}
              </button>
            ) : null}
          </div>
        )}
      </div>
      {memoryPayloadDialogNode}
    </>
  ) : null;
  if (!memorySummaryNode && !noteCardSummaryNode && !codeAnnotationContextNode && !shouldRenderBubble) {
    return null;
  }
  const stackedContent = memorySummaryNode || noteCardSummaryNode || codeAnnotationContextNode ? (
    <div className={`message-context-stack grid gap-2 w-[min(860px,100%)]${item.role === "user" ? " is-user justify-items-end" : ""}`}>
      {memorySummaryNode}
      {codeAnnotationContextNode}
      {noteCardSummaryNode}
      {shouldRenderBubble ? bubbleNode : null}
    </div>
  ) : bubbleNode;

  const agentBadgeNode = hasExternalAgentBadge ? (
    <div className={`message-user-agent-rail inline-flex items-center gap-1.5 pt-1 flex-none${isAgentBadgeExpanded ? " is-open" : ""}`}>
      <button
        type="button"
        className="message-agent-icon-button w-9 h-9 border-0 rounded-[10px] bg-transparent text-[color-mix(in_srgb,var(--color-message-user-bg,var(--surface-bubble-user))_78%,#ffffff_22%)] inline-flex items-center justify-center p-0 cursor-pointer [transition:transform_160ms_ease,opacity_160ms_ease] hover:[transform:translateY(-1px)] hover:opacity-100 focus-visible:outline-none focus-visible:rounded-lg focus-visible:[box-shadow:0_0_0_2px_color-mix(in_srgb,var(--accent)_42%,transparent)]"
        onClick={handleToggleAgentBadge}
        aria-expanded={isAgentBadgeExpanded}
        aria-label={
          selectedAgentName
            ? t("messages.agentBadgeWithNameAriaLabel", { name: selectedAgentName })
            : t("messages.agentBadgeAriaLabel")
        }
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
        <div className="message-agent-reveal is-visible inline-flex items-center max-w-[200px] py-0.5 px-1.5 rounded-full border-0 bg-transparent text-[color-mix(in_srgb,var(--color-message-user-bg,var(--surface-bubble-user))_90%,#ffffff_10%)] opacity-100 [transform:none] pointer-events-auto [transition:none]" role="status">
          <span className="message-agent-tag-text min-w-0 max-w-[180px] overflow-hidden text-ellipsis whitespace-nowrap text-[11px] font-semibold tracking-[0.01em]">{selectedAgentName}</span>
        </div>
      )}
    </div>
  ) : null;

  return (
    <div className={`message ${item.role}${agentTaskNotification ? " message-agent-task" : ""}`}>
      {hasExternalAgentBadge ? (
        <div className="message-user-layout flex items-start justify-between gap-3 w-full max-w-full">
          {agentBadgeNode}
          {stackedContent}
        </div>
      ) : stackedContent}
    </div>
  );
}, areMessageRowPropsEqual);

export const ReasoningRow = memo(function ReasoningRow({
  item,
  workspaceId = null,
  parsed,
  isExpanded,
  isLive,
  activeEngine,
  onToggle,
  onOpenFileLink,
  onOpenFileLinkMenu,
  presentationProfile = null,
  streamMitigationProfile = null,
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
  if (activeEngine === "codex" && thinkingText.trim() === "Encrypted reasoning") {
    return null;
  }
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
              className={`markdown reasoning-markdown${isLive ? " markdown-live-streaming break-words [overflow-wrap:anywhere]" : ""}`}
              workspaceId={workspaceId}
              codeBlockStyle="message"
              streamingThrottleMs={resolveReasoningStreamingThrottleMs(
                isLive,
                streamMitigationProfile,
                presentationProfile,
              )}
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

export const GeneratedImageRow = memo(function GeneratedImageRow({
  item,
  workspaceId = null,
}: GeneratedImageRowProps) {
  const { t } = useTranslation();
  const generatedImageTitle = t("messages.generatedImageTitle");
  const generatedImageProcessingLabel = t("messages.generatedImageProcessing");
  const generatedImageCompletedLabel = t("messages.generatedImageCompleted");
  const generatedImageDegradedLabel = t("messages.generatedImageDegraded");
  const generatedImageProcessingHint = t("messages.generatedImageProcessingHint");
  const generatedImageDegradedHint = t("messages.generatedImageDegradedHint");
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const imageItems = useMemo(
    () =>
      item.images.map((image, index) => ({
        src: image.src,
        label: t("messages.generatedImagePreviewLabel", {
          index: index + 1,
        }),
        localPath: image.localPath ?? null,
      })),
    [item.images, t],
  );
  const statusLabel =
    item.status === "processing"
      ? generatedImageProcessingLabel
      : item.status === "completed"
        ? generatedImageCompletedLabel
        : generatedImageDegradedLabel;
  const statusClassName =
    item.status === "processing"
      ? "is-processing"
      : item.status === "completed"
        ? "is-completed"
        : "is-degraded";

  return (
    <div
      className="message-generated-image-card w-[min(760px,100%)] my-2.5 mb-3.5 ml-auto p-3.5 rounded-[18px] border border-[color-mix(in_srgb,var(--border-strong)_82%,transparent)] [background:linear-gradient(180deg,color-mix(in_srgb,var(--surface-card)_96%,#2563eb_4%),var(--surface-card))] [box-shadow:0_12px_28px_rgba(15,23,42,0.08)] grid gap-3"
      data-generated-image-anchor={item.anchorUserMessageId ?? undefined}
    >
      <div className="message-generated-image-header flex items-start justify-between gap-3">
        <div className="message-generated-image-title-group min-w-0 grid gap-1.5">
          <span className="message-generated-image-eyebrow text-[11px] leading-none font-bold tracking-[0.08em] uppercase text-[color-mix(in_srgb,var(--text-muted)_74%,#2563eb_26%)]">
            {generatedImageTitle}
          </span>
          {item.promptText ? (
            <div className="message-generated-image-prompt text-sm leading-normal text-(--text-primary) break-words">{item.promptText}</div>
          ) : null}
        </div>
        <span className={`message-generated-image-status ${statusClassName} inline-flex items-center min-h-[26px] px-2.5 rounded-full border border-(--border-strong) text-[11px] font-bold tracking-[0.04em] uppercase whitespace-nowrap`}>
          {statusLabel}
        </span>
      </div>
      {item.status === "processing" ? (
        <div className="message-generated-image-hint text-xs leading-normal text-(--text-secondary) break-words">
          {generatedImageProcessingHint}
        </div>
      ) : null}
      {imageItems.length > 0 ? (
        <div className="message-generated-image-grid grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3" role="list">
          {imageItems.map((image, index) => (
            <button
              key={`${item.id}-${index}`}
              type="button"
              className="message-generated-image-thumb border-0 p-0 bg-transparent rounded-2xl overflow-hidden aspect-square cursor-zoom-in [box-shadow:none!important] [&_img]:block [&_img]:w-full [&_img]:h-full [&_img]:object-cover [&_img]:[background:color-mix(in_srgb,var(--surface-card)_92%,#0f172a_8%)]"
              onClick={() => setLightboxIndex(index)}
              aria-label={image.label}
            >
              <LocalImage
                src={image.src}
                localPath={image.localPath}
                workspaceId={workspaceId}
                alt={image.label}
                loading="lazy"
              />
            </button>
          ))}
        </div>
      ) : null}
      {item.status === "degraded" ? (
        <div className="message-generated-image-hint text-xs leading-normal text-(--text-secondary) break-words">
          {item.fallbackText || generatedImageDegradedHint}
        </div>
      ) : null}
      {lightboxIndex !== null && imageItems.length > 0 ? (
        <ImageLightbox
          images={imageItems.map(({ src, label }) => ({ src, label }))}
          activeIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      ) : null}
    </div>
  );
}, (previous, next) => (
  previous.workspaceId === next.workspaceId
  && areGeneratedImageItemsEqual(previous.item, next.item)
));

export const ReviewRow = memo(function ReviewRow({
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

export const DiffRow = memo(function DiffRow({ item }: DiffRowProps) {
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

function buildInlineExploreTitle(
  title: string,
  entry: ExploreRowProps["item"]["entries"][number] | undefined,
) {
  if (!entry) {
    return title;
  }
  const detail = entry.detail && entry.detail !== entry.label ? entry.detail : "";
  return [title, "·", exploreKindLabel(entry.kind), entry.label, detail]
    .filter(Boolean)
    .join(" ");
}

export const ExploreRow = memo(function ExploreRow({
  item,
  isExpanded,
  onToggle,
}: ExploreRowProps) {
  const { t } = useTranslation();
  const title = item.title ?? (item.status === "exploring" ? "Exploring" : "Explored");
  const isCollapsible =
    item.collapsible ?? (item.status === "explored" && item.entries.length > 0);
  const listCollapsed = isCollapsible && !isExpanded;
  const inlineSummary = listCollapsed;
  const rowClassName = `tool-inline explore-inline${isCollapsible ? " is-collapsible" : ""}${
    listCollapsed ? " is-collapsed" : ""
  }${inlineSummary ? " is-inline-summary" : ""}`;
  const displayTitle = inlineSummary
    ? buildInlineExploreTitle(title, item.entries[0])
    : title;
  const handleToggle = () => {
    if (!isCollapsible) {
      return;
    }
    onToggle(item.id);
  };
  return (
    <div className={rowClassName}>
      <div className="tool-inline-content">
        <div className="explore-inline-header">
          {isCollapsible ? (
            <button
              type="button"
              className="explore-inline-header-toggle"
              onClick={handleToggle}
              aria-expanded={isExpanded}
              aria-label={`${displayTitle} · ${t("messages.toggleDetails")}`}
            >
              <Terminal
                className={`tool-inline-icon explore-inline-toggle-icon${
                  isExpanded ? " is-expanded" : ""
                } ${item.status === "exploring" ? "processing" : "completed"}`}
                size={14}
                aria-hidden
              />
              <span className="explore-inline-title" title={displayTitle}>
                {displayTitle}
              </span>
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
              <span className="explore-inline-title" title={displayTitle}>
                {displayTitle}
              </span>
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
