import type { ConversationItem } from "../../../types";
import type { StreamMitigationProfile } from "../../threads/utils/streamLatencyDiagnostics";
import type { PresentationProfile } from "../presentation/presentationProfile";
import type { MessagesEngine } from "./messagesRenderUtils";

export const LIVE_ASSISTANT_MARKDOWN_THROTTLE_MS = 48;

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

export type StreamingMarkdownComplexity = {
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

export const EMPTY_STREAMING_MARKDOWN_COMPLEXITY: StreamingMarkdownComplexity = {
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

export function analyzeStreamingMarkdownComplexity(
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

export function resolveAssistantMessageStreamingThrottleMs(
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

export function resolveReasoningStreamingThrottleMs(
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
