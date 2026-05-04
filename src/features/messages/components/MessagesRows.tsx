import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Check from "lucide-react/dist/esm/icons/check";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronUp from "lucide-react/dist/esm/icons/chevron-up";
import Copy from "lucide-react/dist/esm/icons/copy";
import Terminal from "lucide-react/dist/esm/icons/terminal";
import { AgentIcon } from "../../../components/AgentIcon";
import { ImagePreviewOverlay } from "../../../components/common/ImagePreviewOverlay";
import type { ConversationItem, QueuedMessage } from "../../../types";
import { DiffBlock } from "../../git/components/DiffBlock";
import type { StreamActivityPhase } from "../../threads/hooks/useStreamActivityPhase";
import type { StreamMitigationProfile } from "../../threads/utils/streamLatencyDiagnostics";
import { ProxyStatusBadge } from "../../../components/ProxyStatusBadge";
import { languageFromPath } from "../../../utils/syntax";
import type { PresentationProfile } from "../presentation/presentationProfile";
import { parseAgentTaskNotification } from "../utils/agentTaskNotification";
import { CollapsibleUserTextBlock } from "./CollapsibleUserTextBlock";
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
const CODEX_MEDIUM_STREAMING_THROTTLE_MS = 120;
const CODEX_LARGE_STREAMING_THROTTLE_MS = 220;
const CODEX_MEDIUM_STREAMING_MIN_LENGTH = 260;
const CODEX_MEDIUM_STREAMING_MIN_LINES = 6;
const CODEX_LARGE_STREAMING_MIN_LENGTH = 700;
const CODEX_LARGE_STREAMING_MIN_LINES = 12;

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
  displayText: string,
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
  const trimmedText = displayText.trim();
  if (!trimmedText) {
    return baselineThrottleMs;
  }
  const lineCount = trimmedText.split(/\r?\n/).length;
  if (
    trimmedText.length >= CODEX_LARGE_STREAMING_MIN_LENGTH ||
    lineCount >= CODEX_LARGE_STREAMING_MIN_LINES
  ) {
    return CODEX_LARGE_STREAMING_THROTTLE_MS;
  }
  if (
    trimmedText.length >= CODEX_MEDIUM_STREAMING_MIN_LENGTH ||
    lineCount >= CODEX_MEDIUM_STREAMING_MIN_LINES
  ) {
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
  mitigationProfile: StreamMitigationProfile | null | undefined,
) {
  return (
    item.role === "assistant" &&
    isStreaming &&
    mitigationProfile?.renderPlainTextWhileStreaming === true
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
      <div className="note-card-context-summary-card">
        <div className="note-card-context-summary-head">
          <div className="note-card-context-summary-head-copy">
            <span className="note-card-context-summary-title">
              {t("messages.noteCardContextSummary")}
            </span>
            <span className="note-card-context-summary-count">
              {t("messages.noteCardContextSummaryCount", {
                count: summary.notes.length,
              })}
            </span>
          </div>
          <button
            type="button"
            className="note-card-context-summary-toggle"
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
            <span className="note-card-context-summary-toggle-label">
              {isExpanded
                ? t("messages.noteCardContextCollapse")
                : t("messages.noteCardContextExpand")}
            </span>
            <span className="note-card-context-summary-toggle-icon" aria-hidden>
              {isExpanded ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
            </span>
          </button>
        </div>
        <div className="note-card-context-summary-list">
          {summary.notes.map((note, index) => {
            const noteTitle = note.title.trim() || t("noteCards.untitled");
            const bodyPreview = buildNoteCardBodyPreview(note.bodyMarkdown);
            const visibleAttachments = isExpanded
              ? note.attachments
              : note.attachments.slice(0, COLLAPSED_NOTE_CARD_IMAGE_PREVIEW_COUNT);
            return (
              <article
                key={`${noteTitle}-${index}`}
                className={`note-card-context-summary-note${isExpanded ? " is-expanded" : " is-collapsed"}`}
              >
                <div className="note-card-context-summary-note-head">
                  <strong>{noteTitle}</strong>
                  <span className="note-card-context-summary-note-meta">
                    {note.archived ? (
                      <span className="note-card-context-summary-note-badge">
                        {t("composer.noteCardArchivedBadge")}
                      </span>
                    ) : null}
                    {note.attachments.length > 0 ? (
                      <span className="note-card-context-summary-note-badge">
                        {t("noteCards.imageCount", { count: note.attachments.length })}
                      </span>
                    ) : null}
                  </span>
                </div>
                {isExpanded ? (
                  note.bodyMarkdown ? (
                    <Markdown
                      value={note.bodyMarkdown}
                      className="markdown note-card-context-summary-markdown"
                      workspaceId={workspaceId}
                      codeBlockStyle="message"
                      codeBlockCopyUseModifier={codeBlockCopyUseModifier}
                      onOpenFileLink={onOpenFileLink}
                      onOpenFileLinkMenu={onOpenFileLinkMenu}
                    />
                  ) : null
                ) : bodyPreview ? (
                  <p className="note-card-context-summary-preview">{bodyPreview}</p>
                ) : null}
                {visibleAttachments.length > 0 ? (
                  <div className="note-card-context-summary-images" role="list">
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
                          className="note-card-context-summary-image"
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
  const noteCardSummary = useMemo(
    () =>
      item.role === "assistant"
        ? parseNoteCardContextSummary(item.text)
        : userMessagePresentation?.noteCardSummary ?? null,
    [item.role, item.text, userMessagePresentation?.noteCardSummary],
  );
  const resolvedMemorySummary = suppressMemorySummaryCard ? null : memorySummary;
  const resolvedNoteCardSummary = suppressNoteCardSummaryCard ? null : noteCardSummary;
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
  const hideCopyButton = (
    !hasText
    && imageItems.length === 0
    && !resolvedMemorySummary
  ) || (
    item.role === "assistant"
    && (Boolean(resolvedMemorySummary) || Boolean(resolvedNoteCardSummary))
    && !hasText
    && imageItems.length === 0
  );
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
  const usePlainTextStreamingSurface = shouldUsePlainTextStreamingSurface(
    item,
    isStreaming,
    streamMitigationProfile,
  );
  const livePlainTextClassName = `${resolvedMarkdownClassName} markdown-live-plain-text`;
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
      {resolvedMemorySummary ? (
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
            <div className="memory-context-summary-content">
              {resolvedMemorySummary.lines.map((line, index) => (
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
              displayText,
            )}
            onOpenFileLink={onOpenFileLink}
            onOpenFileLinkMenu={onOpenFileLinkMenu}
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
    || Boolean(resolvedMemorySummary)
    || (Boolean(runtimeReconnectHint) && showRuntimeReconnectCard)
    || hasText
    || !hideCopyButton;
  if (!noteCardSummaryNode && !shouldRenderBubble) {
    return null;
  }
  const stackedContent = noteCardSummaryNode ? (
    <div className={`message-context-stack${item.role === "user" ? " is-user" : ""}`}>
      {noteCardSummaryNode}
      {shouldRenderBubble ? bubbleNode : null}
    </div>
  ) : bubbleNode;

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
  const generatedImageTitle =
    t("messages.generatedImageTitle") === "messages.generatedImageTitle"
      ? "生成图片"
      : t("messages.generatedImageTitle");
  const generatedImageProcessingLabel =
    t("messages.generatedImageProcessing") === "messages.generatedImageProcessing"
      ? "制作中"
      : t("messages.generatedImageProcessing");
  const generatedImageCompletedLabel =
    t("messages.generatedImageCompleted") === "messages.generatedImageCompleted"
      ? "已完成"
      : t("messages.generatedImageCompleted");
  const generatedImageDegradedLabel =
    t("messages.generatedImageDegraded") === "messages.generatedImageDegraded"
      ? "已完成"
      : t("messages.generatedImageDegraded");
  const generatedImageProcessingHint =
    t("messages.generatedImageProcessingHint") === "messages.generatedImageProcessingHint"
      ? "这张图片仍在生成中，稍后会自动展示预览。"
      : t("messages.generatedImageProcessingHint");
  const generatedImageDegradedHint =
    t("messages.generatedImageDegradedHint") === "messages.generatedImageDegradedHint"
      ? "图片已生成完成，但当前预览恢复失败。"
      : t("messages.generatedImageDegradedHint");
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const imageItems = useMemo(
    () =>
      item.images.map((image, index) => ({
        src: image.src,
        label:
          t("messages.generatedImagePreviewLabel", {
            index: index + 1,
          }) === "messages.generatedImagePreviewLabel"
            ? `打开生成图片 ${index + 1}`
            : t("messages.generatedImagePreviewLabel", {
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
      className="message-generated-image-card"
      data-generated-image-anchor={item.anchorUserMessageId ?? undefined}
    >
      <div className="message-generated-image-header">
        <div className="message-generated-image-title-group">
          <span className="message-generated-image-eyebrow">
            {generatedImageTitle}
          </span>
          {item.promptText ? (
            <div className="message-generated-image-prompt">{item.promptText}</div>
          ) : null}
        </div>
        <span className={`message-generated-image-status ${statusClassName}`}>
          {statusLabel}
        </span>
      </div>
      {item.status === "processing" ? (
        <div className="message-generated-image-hint">
          {generatedImageProcessingHint}
        </div>
      ) : null}
      {imageItems.length > 0 ? (
        <div className="message-generated-image-grid" role="list">
          {imageItems.map((image, index) => (
            <button
              key={`${item.id}-${index}`}
              type="button"
              className="message-generated-image-thumb"
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
        <div className="message-generated-image-hint">
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
