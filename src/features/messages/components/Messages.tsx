import { memo, useCallback, useEffect, useMemo, useRef, useState, startTransition } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { convertFileSrc } from "@tauri-apps/api/core";
import Check from "lucide-react/dist/esm/icons/check";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronUp from "lucide-react/dist/esm/icons/chevron-up";
import Copy from "lucide-react/dist/esm/icons/copy";
import Terminal from "lucide-react/dist/esm/icons/terminal";
import X from "lucide-react/dist/esm/icons/x";
import { ProxyStatusBadge } from "../../../components/ProxyStatusBadge";
import type {
  ConversationItem,
  OpenAppTarget,
  RequestUserInputRequest,
  RequestUserInputResponse,
  TurnPlan,
} from "../../../types";
import type {
  ConversationEngine,
  ConversationState,
} from "../../threads/contracts/conversationCurtainContracts";
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
import { extractCommandMessageDisplayText } from "../utils/commandMessageTags";
import {
  ToolBlockRenderer,
  ReadToolGroupBlock,
  EditToolGroupBlock,
  BashToolGroupBlock,
  SearchToolGroupBlock,
} from "./toolBlocks";
import { buildCommandSummary } from "./toolBlocks/toolConstants";
import { MEMORY_CONTEXT_SUMMARY_PREFIX } from "../../project-memory/utils/memoryMarkers";
import type { PresentationProfile } from "../presentation/presentationProfile";
import { RequestUserInputMessage } from "../../app/components/RequestUserInputMessage";


type MessagesProps = {
  items: ConversationItem[];
  threadId: string | null;
  workspaceId?: string | null;
  isThinking: boolean;
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
  onUserInputSubmit?: (
    request: RequestUserInputRequest,
    response: RequestUserInputResponse,
  ) => Promise<void> | void;
  activeEngine?: "claude" | "codex" | "gemini" | "opencode";
  activeCollaborationModeId?: string | null;
  plan?: TurnPlan | null;
  isPlanMode?: boolean;
  isPlanProcessing?: boolean;
  onOpenDiffPath?: (path: string) => void;
  onOpenPlanPanel?: () => void;
  conversationState?: ConversationState | null;
  presentationProfile?: PresentationProfile | null;
  onOpenWorkspaceFile?: (path: string) => void;
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
};

type MessageRowProps = {
  item: Extract<ConversationItem, { kind: "message" }>;
  isStreaming?: boolean;
  activeEngine?: "claude" | "codex" | "gemini" | "opencode";
  activeCollaborationModeId?: string | null;
  enableCollaborationBadge?: boolean;
  presentationProfile?: PresentationProfile | null;
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

type MessageImage = {
  src: string;
  label: string;
};

type MemoryContextSummary = {
  preview: string;
  lines: string[];
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
    previous.isStreaming === next.isStreaming &&
    previous.activeEngine === next.activeEngine &&
    previous.enableCollaborationBadge === next.enableCollaborationBadge &&
    previous.presentationProfile === next.presentationProfile &&
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
const PARAGRAPH_BREAK_SPLIT_REGEX = /\r?\n[^\S\r\n]*\r?\n+/;
const PROJECT_MEMORY_KIND_LINE_REGEX =
  /^\[(?:已知问题|技术决策|项目上下文|对话记录|笔记|记忆)\]\s*/;
const LEGACY_MEMORY_RECORD_HINT_REGEX =
  /(?:用户输入[:：]|助手输出摘要[:：]|助手输出[:：])/;
const PROJECT_MEMORY_XML_PREFIX_REGEX =
  /^<project-memory\b[^>]*>([\s\S]*?)<\/project-memory>\s*/i;
const MODE_FALLBACK_MARKER_REGEX = /User request\s*:\s*/i;
const MODE_FALLBACK_PREFIX_REGEX =
  /^(?:collaboration mode:\s*code\.|execution policy \(default mode\):|execution policy \(plan mode\):)/i;
const MESSAGES_PERF_DEBUG_FLAG_KEY = "mossx.debug.messages.perf";
const CLAUDE_HIDE_REASONING_MODULE_FLAG_KEY = "mossx.claude.hideReasoningModule";
const CLAUDE_RENDER_DEBUG_FLAG_KEY = "mossx.debug.claude.render";
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

function extractModeFallbackUserInput(
  text: string,
): { text: string; mode: "code" | "plan" | null } {
  const trimmed = text.trimStart();
  if (!MODE_FALLBACK_PREFIX_REGEX.test(trimmed)) {
    return { text, mode: null };
  }
  const mode: "code" | "plan" = /^execution policy \(plan mode\):/i.test(trimmed)
    ? "plan"
    : "code";
  const markerMatch = MODE_FALLBACK_MARKER_REGEX.exec(text);
  if (!markerMatch || markerMatch.index < 0) {
    return { text, mode };
  }
  const extracted = text
    .slice(markerMatch.index + markerMatch[0].length)
    .trim();
  return { text: extracted || text, mode };
}

function toConversationEngine(
  engine: "claude" | "codex" | "gemini" | "opencode",
): ConversationEngine {
  if (engine === "claude" || engine === "opencode") {
    return engine;
  }
  return "codex";
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

function sanitizeReasoningTitle(title: string) {
  return title
    .replace(/[`*_~]/g, "")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .trim();
}

function compactReasoningText(value: string) {
  return value.replace(/\s+/g, "");
}

function compactComparableReasoningText(value: string) {
  return compactReasoningText(value)
    .replace(/[！!]/g, "!")
    .replace(/[？?]/g, "?")
    .replace(/[，,]/g, ",")
    .replace(/[。．.]/g, ".");
}

function sliceByComparableLength(text: string, targetLength: number) {
  if (targetLength <= 0) {
    return text;
  }
  let compactLength = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (!/\s/.test(text[index])) {
      compactLength += 1;
    }
    if (compactLength >= targetLength) {
      return text.slice(index + 1);
    }
  }
  return "";
}

function stripLeadingReasoningTitleOverlap(
  content: string,
  candidates: string[],
) {
  const trimmedContent = content.trim();
  if (!trimmedContent) {
    return trimmedContent;
  }
  const normalizedCandidates = candidates
    .map((entry) => entry.trim())
    .filter((entry) => entry.length >= 8);
  if (normalizedCandidates.length === 0) {
    return trimmedContent;
  }

  for (const candidate of normalizedCandidates) {
    if (trimmedContent.startsWith(candidate)) {
      return trimmedContent
        .slice(candidate.length)
        .replace(/^[\s，。！？!?:：;；、-]+/, "")
        .trim();
    }
  }

  const compactContent = compactComparableReasoningText(trimmedContent);
  for (const candidate of normalizedCandidates) {
    const compactCandidate = compactComparableReasoningText(candidate);
    if (!compactCandidate || compactCandidate.length < 8) {
      continue;
    }
    if (compactContent === compactCandidate) {
      return "";
    }
    if (compactContent.startsWith(compactCandidate)) {
      const sliced = sliceByComparableLength(trimmedContent, compactCandidate.length);
      return sliced.replace(/^[\s，。！？!?:：;；、-]+/, "").trim();
    }
  }

  return trimmedContent;
}

function splitComparableReasoningClauses(value: string) {
  return value
    .split(/[。！？!?；;\n]+/)
    .map((entry) => compactComparableReasoningText(entry.trim()))
    .filter((entry) => entry.length >= 6);
}

function hasSharedReasoningClauseSuffix(left: string, right: string) {
  const leftClauses = splitComparableReasoningClauses(left);
  const rightClauses = splitComparableReasoningClauses(right);
  if (leftClauses.length < 3 || rightClauses.length < 3) {
    return false;
  }
  const max = Math.min(leftClauses.length, rightClauses.length);
  let shared = 0;
  for (let offset = 1; offset <= max; offset += 1) {
    if (leftClauses[leftClauses.length - offset] !== rightClauses[rightClauses.length - offset]) {
      break;
    }
    shared += 1;
  }
  return shared >= 2;
}

function dedupeAdjacentReasoningParagraphs(value: string) {
  const collapseRepeatedParagraph = (paragraph: string) => {
    const trimmed = paragraph.trim();
    if (trimmed.length < 12) {
      return trimmed;
    }
    const directRepeat = trimmed.match(/^([\s\S]{6,}?)\s+\1$/);
    if (directRepeat?.[1]) {
      return directRepeat[1].trim();
    }
    const compact = compactReasoningText(trimmed);
    if (compact.length >= 12 && compact.length % 2 === 0) {
      const half = compact.slice(0, compact.length / 2);
      if (`${half}${half}` === compact) {
        let compactLength = 0;
        for (let index = 0; index < trimmed.length; index += 1) {
          if (!/\s/.test(trimmed[index])) {
            compactLength += 1;
          }
          if (compactLength >= half.length) {
            return trimmed.slice(0, index + 1).trim();
          }
        }
      }
    }
    const sentenceMatches = trimmed.match(/[^。！？!?]+[。！？!?]/g);
    if (sentenceMatches && sentenceMatches.length >= 4 && sentenceMatches.length % 2 === 0) {
      const mid = sentenceMatches.length / 2;
      const left = compactReasoningText(sentenceMatches.slice(0, mid).join(""));
      const right = compactReasoningText(sentenceMatches.slice(mid).join(""));
      if (left.length >= 6 && left === right) {
        return sentenceMatches.slice(0, mid).join("").trim();
      }
    }
    return trimmed;
  };

  const paragraphs = value
    .split(PARAGRAPH_BREAK_SPLIT_REGEX)
    .map((line) => collapseRepeatedParagraph(line))
    .filter(Boolean);
  if (paragraphs.length <= 1) {
    return paragraphs[0] ?? value.trim();
  }
  const deduped: string[] = [];
  for (const paragraph of paragraphs) {
    const previous = deduped[deduped.length - 1];
    if (
      previous &&
      compactReasoningText(previous) === compactReasoningText(paragraph) &&
      compactReasoningText(paragraph).length >= 8
    ) {
      continue;
    }
    deduped.push(paragraph);
  }
  return deduped.join("\n\n");
}

function scoreReasoningTextQuality(value: string) {
  const paragraphs = value
    .split(PARAGRAPH_BREAK_SPLIT_REGEX)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (paragraphs.length <= 1) {
    return 0;
  }
  const shortParagraphs = paragraphs.filter((entry) => entry.length <= 8).length;
  return shortParagraphs * 3 + paragraphs.length;
}

function chooseBetterReasoningText(left: string, right: string) {
  const leftScore = scoreReasoningTextQuality(left);
  const rightScore = scoreReasoningTextQuality(right);
  if (leftScore < rightScore) {
    return left;
  }
  if (rightScore < leftScore) {
    return right;
  }
  const leftLength = compactComparableReasoningText(left).length;
  const rightLength = compactComparableReasoningText(right).length;
  return rightLength >= leftLength ? right : left;
}

function isGenericReasoningTitle(title: string) {
  const normalized = title
    .trim()
    .toLowerCase()
    .replace(/[.:：。!！]+$/g, "");
  return (
    normalized === "reasoning" ||
    normalized === "thinking" ||
    normalized === "planning" ||
    normalized === "思考中" ||
    normalized === "正在思考" ||
    normalized === "正在规划"
  );
}

function parseReasoning(item: Extract<ConversationItem, { kind: "reasoning" }>) {
  const summary = item.summary ?? "";
  const content = item.content ?? "";
  const hasSummary = summary.trim().length > 0 && !isGenericReasoningTitle(summary);
  const titleSource = hasSummary ? summary : content;
  const titleLines = titleSource.split("\n");
  const trimmedLines = titleLines.map((line) => line.trim());
  const titleLineIndex = trimmedLines.findIndex(Boolean);
  const rawTitle = titleLineIndex >= 0 ? trimmedLines[titleLineIndex] : "";
  const cleanTitle = sanitizeReasoningTitle(rawTitle);
  const summaryTitle = cleanTitle
    ? cleanTitle.length > 80
      ? `${cleanTitle.slice(0, 80)}…`
      : cleanTitle
    : "Reasoning";
  const summaryLines = summary.split("\n");
  const contentLines = content.split("\n");
  const summaryBody =
    hasSummary && titleLineIndex >= 0
      ? summaryLines
          .filter((_, index) => index !== titleLineIndex)
          .join("\n")
          .trim()
      : "";
  let contentBody = hasSummary
    ? content.trim()
    : titleLineIndex >= 0
      ? contentLines
          .filter((_, index) => index !== titleLineIndex)
          .join("\n")
          .trim()
      : content.trim();
  if (!hasSummary && !contentBody && content.trim()) {
    // Preserve single-line reasoning so Codex rows don't collapse to title-only.
    contentBody = content.trim();
  }
  const normalizedSummaryBody = summaryBody.trim();
  const normalizedContentBody = stripLeadingReasoningTitleOverlap(
    contentBody,
    [rawTitle, cleanTitle, normalizedSummaryBody],
  ).trim();
  const compactSummaryBody = compactReasoningText(normalizedSummaryBody);
  const compactContentBody = compactReasoningText(normalizedContentBody);
  let bodyParts: string[] = [];
  if (normalizedSummaryBody && normalizedContentBody) {
    if (compactSummaryBody === compactContentBody) {
      bodyParts = [normalizedContentBody];
    } else if (compactContentBody.startsWith(compactSummaryBody)) {
      bodyParts = [normalizedContentBody];
    } else if (compactSummaryBody.startsWith(compactContentBody)) {
      bodyParts = [normalizedSummaryBody];
    } else if (hasSharedReasoningClauseSuffix(normalizedSummaryBody, normalizedContentBody)) {
      bodyParts = [chooseBetterReasoningText(normalizedSummaryBody, normalizedContentBody)];
    } else {
      bodyParts = [normalizedSummaryBody, normalizedContentBody];
    }
  } else {
    bodyParts = [normalizedSummaryBody, normalizedContentBody].filter(Boolean);
  }
  const bodyText = dedupeAdjacentReasoningParagraphs(bodyParts.join("\n\n")).trim();
  const hasBody = bodyText.length > 0;
  const hasAnyText = titleSource.trim().length > 0;
  const workingLabel = hasAnyText ? summaryTitle : null;
  return {
    summaryTitle,
    bodyText,
    hasBody,
    workingLabel,
  };
}

function isReasoningDuplicate(
  previous: ReturnType<typeof parseReasoning>,
  next: ReturnType<typeof parseReasoning>,
) {
  const previousBody = compactComparableReasoningText(previous.bodyText || "");
  const nextBody = compactComparableReasoningText(next.bodyText || "");
  if (previousBody && nextBody) {
    if (previousBody === nextBody) {
      return true;
    }
    if (previousBody.length >= 16 && nextBody.includes(previousBody)) {
      return true;
    }
    if (nextBody.length >= 16 && previousBody.includes(nextBody)) {
      return true;
    }
    return false;
  }

  const previousTitle = compactComparableReasoningText(
    previous.summaryTitle || previous.workingLabel || "",
  );
  const nextTitle = compactComparableReasoningText(
    next.summaryTitle || next.workingLabel || "",
  );

  if (!previousBody && !nextBody) {
    if (
      previousTitle &&
      nextTitle &&
      previousTitle.length >= 8 &&
      nextTitle.length >= 8
    ) {
      return previousTitle === nextTitle;
    }
    return false;
  }

  if (
    previousTitle &&
    nextTitle &&
    previousTitle.length >= 6 &&
    nextTitle.length >= 6 &&
    previousTitle !== nextTitle
  ) {
    return false;
  }

  return false;
}

function dedupeAdjacentReasoningItems(
  list: ConversationItem[],
  reasoningMetaById: Map<string, ReturnType<typeof parseReasoning>>,
  appendOnly = false,
) {
  const deduped: ConversationItem[] = [];
  for (const item of list) {
    const previous = deduped[deduped.length - 1];
    if (item.kind !== "reasoning" || previous?.kind !== "reasoning") {
      deduped.push(item);
      continue;
    }
    const previousMeta =
      reasoningMetaById.get(previous.id) ?? parseReasoning(previous);
    const nextMeta = reasoningMetaById.get(item.id) ?? parseReasoning(item);
    if (!isReasoningDuplicate(previousMeta, nextMeta)) {
      deduped.push(item);
      continue;
    }
    deduped[deduped.length - 1] = {
      ...item,
      summary: appendOnly
        ? appendReasoningRunText(previous.summary, item.summary)
        : chooseBetterReasoningText(previous.summary, item.summary),
      content: appendOnly
        ? appendReasoningRunText(previous.content, item.content)
        : chooseBetterReasoningText(previous.content, item.content),
    };
  }
  return deduped;
}

function collapseConsecutiveReasoningRuns(
  list: ConversationItem[],
  enabled: boolean,
  appendOnly = false,
) {
  if (!enabled || list.length <= 1) {
    return list;
  }
  const collapsed: ConversationItem[] = [];
  let index = 0;
  while (index < list.length) {
    const item = list[index];
    if (item.kind !== "reasoning") {
      collapsed.push(item);
      index += 1;
      continue;
    }

    let end = index + 1;
    while (end < list.length && list[end].kind === "reasoning") {
      end += 1;
    }

    if (end - index === 1) {
      collapsed.push(item);
      index = end;
      continue;
    }

    const run = list.slice(index, end) as Array<Extract<ConversationItem, { kind: "reasoning" }>>;
    const latest = run[run.length - 1];
    let mergedSummary = run[0].summary;
    let mergedContent = run[0].content;
    for (let runIndex = 1; runIndex < run.length; runIndex += 1) {
      const candidate = run[runIndex];
      mergedSummary = mergeReasoningRunText(
        mergedSummary,
        candidate.summary,
        appendOnly,
      );
      mergedContent = mergeReasoningRunText(
        mergedContent,
        candidate.content,
        appendOnly,
      );
    }
    collapsed.push({
      ...latest,
      summary: mergedSummary,
      content: mergedContent,
    });
    index = end;
  }
  return collapsed;
}

function appendReasoningRunText(existing: string, incoming: string) {
  if (!existing) {
    return incoming;
  }
  if (!incoming) {
    return existing;
  }
  const normalizedExisting = existing.trim();
  const normalizedIncoming = incoming.trim();
  const compactExisting = compactComparableReasoningText(normalizedExisting);
  const compactIncoming = compactComparableReasoningText(normalizedIncoming);
  if (!compactExisting) {
    return normalizedIncoming;
  }
  if (!compactIncoming) {
    return normalizedExisting;
  }
  if (compactExisting === compactIncoming) {
    return chooseBetterReasoningText(normalizedExisting, normalizedIncoming);
  }
  const maxOverlap = Math.min(compactExisting.length, compactIncoming.length);
  for (let overlapLength = maxOverlap; overlapLength > 0; overlapLength -= 1) {
    if (!compactExisting.endsWith(compactIncoming.slice(0, overlapLength))) {
      continue;
    }
    const suffix = sliceByComparableLength(normalizedIncoming, overlapLength).trimStart();
    return suffix ? `${normalizedExisting}${suffix}` : normalizedExisting;
  }
  return `${normalizedExisting}\n\n${normalizedIncoming}`;
}

function mergeReasoningRunText(
  existing: string,
  incoming: string,
  appendOnly = false,
) {
  if (appendOnly) {
    return appendReasoningRunText(existing, incoming);
  }
  if (!existing) {
    return incoming;
  }
  if (!incoming) {
    return existing;
  }
  const normalizedExisting = existing.trim();
  const normalizedIncoming = incoming.trim();
  const compactExisting = compactComparableReasoningText(normalizedExisting);
  const compactIncoming = compactComparableReasoningText(normalizedIncoming);
  if (!compactExisting) {
    return normalizedIncoming;
  }
  if (!compactIncoming) {
    return normalizedExisting;
  }
  if (compactExisting === compactIncoming) {
    return chooseBetterReasoningText(normalizedExisting, normalizedIncoming);
  }
  if (compactIncoming.includes(compactExisting)) {
    return normalizedIncoming;
  }
  if (compactExisting.includes(compactIncoming)) {
    return normalizedExisting;
  }
  return `${normalizedExisting}\n\n${normalizedIncoming}`;
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

function parseMemoryContextSummary(text: string): MemoryContextSummary | null {
  const normalized = text.trim();
  if (!normalized.startsWith(MEMORY_CONTEXT_SUMMARY_PREFIX)) {
    return null;
  }
  const preview = normalized.slice(MEMORY_CONTEXT_SUMMARY_PREFIX.length).trim();
  if (!preview) {
    return null;
  }
  const lines = preview
    .split(/[；\n]+/)
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    preview,
    lines: lines.length > 0 ? lines : [preview],
  };
}

function buildMemorySummary(preview: string): MemoryContextSummary | null {
  const normalizedPreview = preview.trim();
  if (!normalizedPreview) {
    return null;
  }
  const lines = normalizedPreview
    .split(/[；\n]+/)
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    preview: normalizedPreview,
    lines: lines.length > 0 ? lines : [normalizedPreview],
  };
}

function parseInjectedMemoryPrefixFromUser(
  text: string,
): { memorySummary: MemoryContextSummary; remainingText: string } | null {
  const normalized = text.trimStart();
  if (!normalized) {
    return null;
  }

  const xmlMatch = normalized.match(PROJECT_MEMORY_XML_PREFIX_REGEX);
  if (xmlMatch) {
    const blockBody = (xmlMatch[1] ?? "").trim();
    const memoryLines = blockBody
      .split(/\r?\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => PROJECT_MEMORY_KIND_LINE_REGEX.test(line));
    const previewText = memoryLines.length > 0 ? memoryLines.join("；") : blockBody;
    const memorySummary = buildMemorySummary(previewText);
    if (!memorySummary) {
      return null;
    }
    const remainingText = normalized.slice(xmlMatch[0].length).trimStart();
    return { memorySummary, remainingText };
  }

  if (!PROJECT_MEMORY_KIND_LINE_REGEX.test(normalized)) {
    return null;
  }
  if (!LEGACY_MEMORY_RECORD_HINT_REGEX.test(normalized)) {
    return null;
  }

  const paragraphBlocks = normalized.split(PARAGRAPH_BREAK_SPLIT_REGEX);
  if (paragraphBlocks.length >= 2) {
    const firstBlock = (paragraphBlocks[0] ?? "").trim();
    if (
      PROJECT_MEMORY_KIND_LINE_REGEX.test(firstBlock) &&
      LEGACY_MEMORY_RECORD_HINT_REGEX.test(firstBlock)
    ) {
      const memorySummary = buildMemorySummary(firstBlock);
      if (!memorySummary) {
        return null;
      }
      return {
        memorySummary,
        remainingText: paragraphBlocks.slice(1).join("\n\n").trimStart(),
      };
    }
  }

  const lines = normalized.split(/\r?\n/);
  if (lines.length >= 2) {
    const firstLine = (lines[0] ?? "").trim();
    if (
      PROJECT_MEMORY_KIND_LINE_REGEX.test(firstLine) &&
      LEGACY_MEMORY_RECORD_HINT_REGEX.test(firstLine)
    ) {
      const memorySummary = buildMemorySummary(firstLine);
      if (!memorySummary) {
        return null;
      }
      return {
        memorySummary,
        remainingText: lines.slice(1).join("\n").trimStart(),
      };
    }
  }

  return null;
}

const MessageImageGrid = memo(function MessageImageGrid({
  images,
  onOpen,
  hasText,
}: {
  images: MessageImage[];
  onOpen: (index: number) => void;
  hasText: boolean;
}) {
  return (
    <div
      className={`message-image-grid${hasText ? " message-image-grid--with-text" : ""}`}
      role="list"
    >
      {images.map((image, index) => (
        <button
          key={`${image.src}-${index}`}
          type="button"
          className="message-image-thumb"
          onClick={() => onOpen(index)}
          aria-label={`Open image ${index + 1}`}
        >
          <img src={image.src} alt={image.label} loading="lazy" />
        </button>
      ))}
    </div>
  );
});

const ImageLightbox = memo(function ImageLightbox({
  images,
  activeIndex,
  onClose,
}: {
  images: MessageImage[];
  activeIndex: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const activeImage = images[activeIndex];

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  if (!activeImage) {
    return null;
  }

  return createPortal(
    <div
      className="message-image-lightbox"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="message-image-lightbox-content"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="message-image-lightbox-close"
          onClick={onClose}
          aria-label={t("messages.closeImagePreview")}
        >
          <X size={16} aria-hidden />
        </button>
        <img src={activeImage.src} alt={activeImage.label} />
      </div>
    </div>,
    document.body,
  );
});

function formatDurationMs(durationMs: number) {
  const durationSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const durationMinutes = Math.floor(durationSeconds / 60);
  const durationRemainder = durationSeconds % 60;
  return `${durationMinutes}:${String(durationRemainder).padStart(2, "0")}`;
}

function scrollKeyForItems(items: ConversationItem[]) {
  if (!items.length) {
    return "empty";
  }
  const last = items[items.length - 1];
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
    if (item.kind === "message" && item.role === "user") {
      return index;
    }
  }
  return -1;
}

function findLastAssistantMessageIndex(items: ConversationItem[]) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.kind === "message" && item.role === "assistant") {
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
        <div className="working">
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
          <span className="working-text">{reasoningLabel || t("messages.generatingResponse")}</span>
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
  isStreaming = false,
  activeEngine = "claude",
  enableCollaborationBadge = false,
  presentationProfile = null,
  isCopied,
  onCopy,
  codeBlockCopyUseModifier,
  onOpenFileLink,
  onOpenFileLinkMenu,
}: MessageRowProps) {
  const { t } = useTranslation();
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [memorySummaryExpanded, setMemorySummaryExpanded] = useState(false);
  const legacyUserMemory = useMemo(
    () =>
      item.role === "user" ? parseInjectedMemoryPrefixFromUser(item.text) : null,
    [item.role, item.text],
  );
  const memorySummary = useMemo(
    () =>
      item.role === "assistant"
        ? parseMemoryContextSummary(item.text)
        : legacyUserMemory?.memorySummary ?? null,
    [item.role, item.text, legacyUserMemory],
  );
  const displayText = useMemo(() => {
    const originalText = item.role === "user" ? legacyUserMemory?.remainingText ?? item.text : item.text;
    if (item.role !== "user") {
      return memorySummary ? "" : originalText;
    }
    const safeText = enableCollaborationBadge
      ? extractModeFallbackUserInput(originalText).text
      : originalText;
    const filteredCommandText = extractCommandMessageDisplayText(safeText);
    const userInputMatches = [...filteredCommandText.matchAll(/\[User Input\]\s*/g)];
    if (userInputMatches.length === 0) {
      return filteredCommandText;
    }
    const lastMatch = userInputMatches[userInputMatches.length - 1];
    const markerIndex = lastMatch.index ?? -1;
    if (markerIndex < 0) {
      return filteredCommandText;
    }
    const markerLength = lastMatch[0]?.length ?? 0;
    const extracted = filteredCommandText.slice(markerIndex + markerLength).trim();
    return extracted.length > 0 ? extracted : filteredCommandText;
  }, [enableCollaborationBadge, item.role, item.text, memorySummary]);
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

  return (
    <div className={`message ${item.role}`}>
      <div className="bubble message-bubble">
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
        {hasText && (
          item.role === "user" ? (
            <CollapsibleUserTextBlock content={displayText} />
          ) : (
            <Markdown
              value={displayText}
              className={resolvedMarkdownClassName}
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
    </div>
  );
}, areMessageRowPropsEqual);

const ReasoningRow = memo(function ReasoningRow({
  item,
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
  return kind[0].toUpperCase() + kind.slice(1);
}

const ExploreRow = memo(function ExploreRow({ item, isExpanded, onToggle }: ExploreRowProps) {
  const { t } = useTranslation();
  const title = item.title ?? (item.status === "exploring" ? "Exploring" : "Explored");
  const isCollapsible = item.collapsible === true;
  const listCollapsed = isCollapsible && !isExpanded;
  const handleToggle = () => {
    if (!isCollapsible) {
      return;
    }
    onToggle(item.id);
  };
  return (
    <div className={`tool-inline explore-inline${isCollapsible ? " is-collapsible" : ""}`}>
      <button
        type="button"
        className="tool-inline-bar-toggle"
        onClick={handleToggle}
        aria-expanded={isCollapsible ? isExpanded : undefined}
        aria-label={isCollapsible ? t("messages.toggleDetails") : undefined}
        disabled={!isCollapsible}
      />
      <div className="tool-inline-content">
        <div className="explore-inline-header">
          <Terminal
            className={`tool-inline-icon ${
              item.status === "exploring" ? "processing" : "completed"
            }`}
            size={14}
            aria-hidden
          />
          <span className="explore-inline-title">{title}</span>
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
  onUserInputSubmit: legacyOnUserInputSubmit,
  activeEngine: legacyActiveEngine = "claude",
  activeCollaborationModeId = null,
  plan: legacyPlan = null,
  isPlanMode: _isPlanMode = false,
  isPlanProcessing: _isPlanProcessing = false,
  onOpenDiffPath,
  conversationState = null,
  presentationProfile = null,
  onOpenWorkspaceFile,
}: MessagesProps) {
  const { t } = useTranslation();
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
        isThinking: legacyIsThinking,
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
      legacyIsThinking,
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
  const activeEngine =
    effectiveState.meta.engine === "claude"
      ? "claude"
      : effectiveState.meta.engine === "opencode"
        ? "opencode"
        : legacyActiveEngine === "gemini"
          ? "gemini"
          : "codex";
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
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [activeAnchorId, setActiveAnchorId] = useState<string | null>(null);
  const [showAllHistoryItems, setShowAllHistoryItems] = useState(false);
  const hideClaudeReasoning = activeEngine === "claude" && shouldHideClaudeReasoningModule();
  const [isSelectionFrozen, setIsSelectionFrozen] = useState(false);
  const copyTimeoutRef = useRef<number | null>(null);
  const planPanelFocusRafRef = useRef<number | null>(null);
  const planPanelFocusTimeoutRef = useRef<number | null>(null);
  const planPanelFocusNodeRef = useRef<HTMLElement | null>(null);
  const frozenItemsRef = useRef<ConversationItem[] | null>(null);
  const latestItemsRef = useRef(items);
  latestItemsRef.current = items;
  const effectiveItems = isSelectionFrozen
    ? frozenItemsRef.current ?? items
    : items;
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
    if (!bottomRef.current) {
      return;
    }
    const container = containerRef.current;
    const shouldScroll =
      autoScrollRef.current || (container ? isNearBottom(container) : true);
    if (!shouldScroll) {
      return;
    }
    // Always use instant for programmatic scroll requests to avoid blocking input
    bottomRef.current.scrollIntoView({ behavior: "instant", block: "end" });
  }, [isNearBottom]);

  useEffect(() => {
    autoScrollRef.current = true;
    setExpandedItems(new Set());
    setIsSelectionFrozen(false);
    frozenItemsRef.current = null;
  }, [threadId]);
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

    const lastReasoningId = reasoningIds[reasoningIds.length - 1];

    if (lastReasoningId !== lastAutoExpandedIdRef.current) {
      setExpandedItems((prev) => {
        const next = new Set<string>();
        // Only expand the latest reasoning block, collapse all others
        next.add(lastReasoningId);
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
      if (item.kind !== "reasoning") {
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
      if (item.kind === "reasoning") {
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
      if (item.kind !== "reasoning") {
        continue;
      }
      const parsed = reasoningMetaById.get(item.id) ?? parseReasoning(item);
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
      if (item.kind !== "reasoning") {
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
      if (item.kind === "message" && item.role === "user") {
        lastUserIndex = index;
        break;
      }
    }
    if (lastUserIndex < 0) {
      return null;
    }
    for (let index = effectiveItems.length - 1; index > lastUserIndex; index -= 1) {
      const item = effectiveItems[index];
      if (item.kind === "message" && item.role === "assistant") {
        break;
      }
      const label = resolveWorkingActivityLabel(item, activeEngine, presentationProfile);
      if (label) {
        return label;
      }
    }
    return null;
  }, [activeEngine, effectiveItems, presentationProfile]);

  const latestAssistantMessageId = useMemo(() => {
    for (let index = effectiveItems.length - 1; index > lastUserMessageIndex; index -= 1) {
      const item = effectiveItems[index];
      if (item.kind === "message" && item.role === "assistant") {
        return item.id;
      }
    }
    return null;
  }, [effectiveItems, lastUserMessageIndex]);

  const waitingForFirstChunk = useMemo(() => {
    if (!isThinking || effectiveItems.length === 0) {
      return false;
    }
    let lastUserIndex = -1;
    for (let index = effectiveItems.length - 1; index >= 0; index -= 1) {
      const item = effectiveItems[index];
      if (item.kind === "message" && item.role === "user") {
        lastUserIndex = index;
        break;
      }
    }
    if (lastUserIndex < 0) {
      return false;
    }
    for (let index = lastUserIndex + 1; index < effectiveItems.length; index += 1) {
      const item = effectiveItems[index];
      if (item.kind === "message" && item.role === "assistant") {
        return false;
      }
    }
    return true;
  }, [isThinking, effectiveItems]);

  const visibleItems = useMemo(() => {
    const filtered = effectiveItems.filter((item) => {
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
    const appendReasoningRuns = activeEngine === "claude";
    const deduped = dedupeAdjacentReasoningItems(
      filtered,
      reasoningMetaById,
      appendReasoningRuns,
    );
    const collapseReasoningRuns = activeEngine !== "codex" && activeEngine !== "gemini";
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
    !showAllHistoryItems && visibleItems.length > VISIBLE_MESSAGE_WINDOW;
  const collapsedHistoryItemCount = shouldCollapseHistoryItems
    ? visibleItems.length - VISIBLE_MESSAGE_WINDOW
    : 0;
  const renderedItems = useMemo(
    () =>
      shouldCollapseHistoryItems
        ? visibleItems.slice(collapsedHistoryItemCount)
        : visibleItems,
    [collapsedHistoryItemCount, shouldCollapseHistoryItems, visibleItems],
  );
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
    if (!containerRef.current) {
      return;
    }
    autoScrollRef.current = isNearBottom(containerRef.current);
    scheduleAnchorUpdate("scroll");
  }, [isNearBottom, scheduleAnchorUpdate]);

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
    return () => {
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
      if (anchorUpdateRafRef.current !== null) {
        window.cancelAnimationFrame(anchorUpdateRafRef.current);
        anchorUpdateRafRef.current = null;
      }
      if (planPanelFocusRafRef.current !== null) {
        window.cancelAnimationFrame(planPanelFocusRafRef.current);
      }
      if (planPanelFocusTimeoutRef.current !== null) {
        window.clearTimeout(planPanelFocusTimeoutRef.current);
      }
      if (planPanelFocusNodeRef.current) {
        planPanelFocusNodeRef.current.classList.remove("plan-panel-focus-ring");
        planPanelFocusNodeRef.current = null;
      }
    };
  }, []);

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
    const container = containerRef.current;
    const shouldScroll =
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
  }, [scrollKey, isThinking, isNearBottom]);

  const groupedEntries = useMemo(() => groupToolItems(renderedItems), [renderedItems]);

  const userInputNode =
    activeEngine === "codex" && legacyOnUserInputSubmit
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
      const bindMessageNode = (node: HTMLDivElement | null) => {
        if (item.role === "user" && node) {
          messageNodeByIdRef.current.set(item.id, node);
          return;
        }
        messageNodeByIdRef.current.delete(item.id);
      };
      return (
        <div key={itemRenderKey} ref={bindMessageNode} data-message-anchor-id={item.id}>
          <MessageRow
            item={item}
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
            isCopied={isCopied}
            onCopy={handleCopyMessage}
            codeBlockCopyUseModifier={codeBlockCopyUseModifier}
            onOpenFileLink={openFileLink}
            onOpenFileLinkMenu={showFileLinkMenu}
          />
        </div>
      );
    }
    if (item.kind === "reasoning") {
      const itemRenderKey = `reasoning:${item.id}`;
      const isExpanded = expandedItems.has(item.id);
      const parsed = parseReasoning(item);
      const isLiveReasoning =
        isThinking && latestReasoningId === item.id;
      return (
        <ReasoningRow
          key={itemRenderKey}
          item={item}
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
          onOpenFileLink={openFileLink}
          onOpenFileLinkMenu={showFileLinkMenu}
        />
      );
    }
    if (item.kind === "diff") {
      return <DiffRow key={`diff:${item.id}`} item={item} />;
    }
    if (item.kind === "tool") {
      const isExpanded = expandedItems.has(item.id);
      return (
        <ToolBlockRenderer
          key={`tool:${item.id}`}
          item={item}
          isExpanded={isExpanded}
          onToggle={toggleExpanded}
          onRequestAutoScroll={requestAutoScroll}
          activeCollaborationModeId={activeCollaborationModeId}
          onOpenDiffPath={onOpenDiffPath}
        />
      );
    }
    if (item.kind === "explore") {
      const isExpanded = expandedItems.has(item.id);
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
      return <ReadToolGroupBlock key={`rg-${entry.items[0].id}`} items={entry.items} />;
    }
    if (entry.kind === "editGroup") {
      return (
        <EditToolGroupBlock
          key={`eg-${entry.items[0].id}`}
          items={entry.items}
          onOpenDiffPath={onOpenDiffPath}
        />
      );
    }
    if (entry.kind === "bashGroup") {
      return (
        <BashToolGroupBlock
          key={`bg-${entry.items[0].id}`}
          items={entry.items}
          onRequestAutoScroll={requestAutoScroll}
        />
      );
    }
    if (entry.kind === "searchGroup") {
      return <SearchToolGroupBlock key={`sg-${entry.items[0].id}`} items={entry.items} />;
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
          {shouldCollapseHistoryItems && (
            <div
              className="messages-collapsed-indicator"
              data-collapsed-count={collapsedHistoryItemCount}
              onClick={() => setShowAllHistoryItems(true)}
            >
              {t("messages.showEarlierMessages", { count: collapsedHistoryItemCount })}
            </div>
          )}
          {groupedEntries.map(renderEntry)}
          {claudeDockedReasoningItems.map(({ item, parsed }) => (
            <ReasoningRow
              key={`claude-live-${item.id}`}
              item={item}
              parsed={parsed}
              isExpanded={isThinking && latestReasoningId === item.id ? true : expandedItems.has(item.id)}
              isLive={isThinking && latestReasoningId === item.id}
              onToggle={toggleExpanded}
              onOpenFileLink={openFileLink}
              onOpenFileLinkMenu={showFileLinkMenu}
            />
          ))}
          {userInputNode}
          <WorkingIndicator
            isThinking={isThinking}
            proxyEnabled={proxyEnabled}
            proxyUrl={proxyUrl}
            processingStartedAt={processingStartedAt}
            lastDurationMs={lastDurationMs}
            heartbeatPulse={heartbeatPulse}
            hasItems={effectiveItems.length > 0}
            reasoningLabel={latestReasoningLabel}
            activityLabel={latestWorkingActivityLabel}
            activeEngine={activeEngine}
            waitingForFirstChunk={waitingForFirstChunk}
            presentationProfile={presentationProfile}
          />
          {!effectiveItems.length && !userInputNode && (
            <div className="empty messages-empty">
              {t("messages.emptyThread")}
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
});
