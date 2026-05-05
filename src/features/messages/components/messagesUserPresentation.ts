import { normalizeAgentIcon } from "../../../utils/agentIcons";
import type { MessageConversationItem } from "./messageItemPredicates";
import {
  parseInjectedMemoryPrefixFromUser,
  type MemoryContextSummary,
} from "./messagesMemoryContext";
import {
  parseInjectedNoteCardContextFromUser,
  type NoteCardContextSummary,
} from "./messagesNoteCardContext";
import { extractCommandMessageDisplayText } from "../utils/commandMessageTags";

const MODE_FALLBACK_MARKER_REGEX = /User request\s*:\s*/i;
const MODE_FALLBACK_PREFIX_REGEX =
  /^(?:collaboration mode:\s*code\.|execution policy \(default mode\):|execution policy \(plan mode\):)/i;
const SHARED_SESSION_SYNC_PREFIX_REGEX =
  /^Shared session context sync\.\s*Continue from these recent turns before answering the new request:\s*/i;
const SHARED_SESSION_CURRENT_REQUEST_MARKER_REGEX =
  /(?:\r?\n){1,2}Current user request:\s*(?:\r?\n)?/i;
const AGENT_PROMPT_BLOCK_AT_TAIL_REGEX =
  /(?:\r?\n){2}##\s*Agent Role and Instructions\s*(?:\r?\n){2}([\s\S]*)$/;
const AGENT_PROMPT_NAME_LINE_REGEX =
  /^(?:agent\s*name|selected\s*agent|智能体(?:名称|标题)?|agent)\s*[:：]\s*(.+)$/i;
const AGENT_PROMPT_ICON_LINE_REGEX =
  /^(?:agent\s*icon|selected\s*agent\s*icon|智能体图标|agent\s*icon\s*id)\s*[:：]\s*(.+)$/i;

type AgentPromptParseResult = {
  text: string;
  selectedAgentName: string | null;
  selectedAgentIcon: string | null;
  hasInjectedAgentPromptBlock: boolean;
};

export type UserMessagePresentation = {
  displayText: string;
  stickyCandidateText: string;
  selectedAgentName: string | null;
  selectedAgentIcon: string | null;
  hasInjectedAgentPromptBlock: boolean;
  memorySummary: MemoryContextSummary | null;
  noteCardSummary: NoteCardContextSummary | null;
};

export type UserConversationSummary = {
  previewText: string;
  stickyCandidateText: string;
  imageCount: number;
  hasRenderableConversationContent: boolean;
};

type ResolveUserMessagePresentationParams = Pick<
  MessageConversationItem,
  "text" | "selectedAgentName" | "selectedAgentIcon"
> & {
  enableCollaborationBadge: boolean;
};

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
  const extractedRaw = text.slice(markerMatch.index + markerMatch[0].length);
  const extracted = extractedRaw.replace(/^\r?\n/, "").replace(/^ /, "");
  return { text: extracted.trim().length > 0 ? extracted : text, mode };
}

function stripSharedSessionContextSyncWrapper(text: string): string {
  if (!SHARED_SESSION_SYNC_PREFIX_REGEX.test(text.trimStart())) {
    return text;
  }
  const markerMatch = SHARED_SESSION_CURRENT_REQUEST_MARKER_REGEX.exec(text);
  if (!markerMatch || markerMatch.index < 0) {
    return text;
  }
  const extractedRaw = text.slice(markerMatch.index + markerMatch[0].length);
  const extracted = extractedRaw.replace(/^\r?\n/, "").replace(/^ /, "");
  return extracted.trim().length > 0 ? extracted : text;
}

function extractLatestUserInputTextPreserveFormatting(text: string): string {
  const userInputMatches = [...text.matchAll(/\[User Input\]\s*/g)];
  if (userInputMatches.length === 0) {
    return text;
  }
  const lastMatch = userInputMatches[userInputMatches.length - 1];
  if (!lastMatch) {
    return text;
  }
  const markerIndex = lastMatch.index ?? -1;
  if (markerIndex < 0) {
    return text;
  }
  const markerLength = lastMatch[0]?.length ?? 0;
  const extractedRaw = text.slice(markerIndex + markerLength);
  const extracted = extractedRaw.replace(/^\r?\n/, "").replace(/^ /, "");
  return extracted.trim().length > 0 ? extracted : text;
}

function normalizeSelectedAgentName(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return null;
  }
  const normalized = trimmed.replace(/^#+\s*/, "").trim();
  return normalized || null;
}

function normalizeSelectedAgentIcon(value: string | null | undefined): string | null {
  return normalizeAgentIcon(value);
}

function isLikelyAgentDisplayName(value: string | null): boolean {
  if (!value) {
    return false;
  }
  if (value.length > 24) {
    return false;
  }
  return !/[。！？!?]/.test(value) && !/[,:，；;：]/.test(value);
}

function extractAgentNameFromPromptLine(value: string | null): string | null {
  const normalized = normalizeSelectedAgentName(value);
  if (!normalized) {
    return null;
  }
  const namedMatch = AGENT_PROMPT_NAME_LINE_REGEX.exec(normalized);
  if (namedMatch?.[1]) {
    return normalizeSelectedAgentName(namedMatch[1]);
  }
  const firstClause = normalized.split(/[,:，；;：。！？!?]/)[0]?.trim() ?? "";
  if (firstClause && firstClause.length <= 24) {
    return firstClause;
  }
  return isLikelyAgentDisplayName(normalized) ? normalized : null;
}

function extractAgentIconFromPromptLine(value: string | null): string | null {
  const normalized = normalizeSelectedAgentName(value);
  if (!normalized) {
    return null;
  }
  const iconMatch = AGENT_PROMPT_ICON_LINE_REGEX.exec(normalized);
  if (!iconMatch?.[1]) {
    return null;
  }
  return normalizeSelectedAgentIcon(iconMatch[1]);
}

function stripAgentPromptBlockFromUserText(
  text: string,
  fallbackAgentName: string | null,
  fallbackAgentIcon: string | null,
): AgentPromptParseResult {
  const match = AGENT_PROMPT_BLOCK_AT_TAIL_REGEX.exec(text);
  if (!match || typeof match.index !== "number" || match.index < 0) {
    return {
      text,
      selectedAgentName: null,
      selectedAgentIcon: null,
      hasInjectedAgentPromptBlock: false,
    };
  }
  const tailText = match[1] ?? "";
  if (!tailText.trim()) {
    return {
      text,
      selectedAgentName: null,
      selectedAgentIcon: null,
      hasInjectedAgentPromptBlock: false,
    };
  }
  const promptLines = tailText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const inferredAgentName = extractAgentNameFromPromptLine(promptLines[0] ?? null);
  const inferredAgentIcon = promptLines
    .map((line) => extractAgentIconFromPromptLine(line))
    .find((icon) => Boolean(icon)) ?? null;
  const agentName = fallbackAgentName ?? inferredAgentName;
  const agentIcon = fallbackAgentIcon ?? inferredAgentIcon;
  const baseText = text.slice(0, match.index).replace(/\s+$/, "");
  if (!baseText) {
    return {
      text,
      selectedAgentName: null,
      selectedAgentIcon: null,
      hasInjectedAgentPromptBlock: false,
    };
  }
  return {
    text: baseText,
    selectedAgentName: agentName,
    selectedAgentIcon: agentIcon,
    hasInjectedAgentPromptBlock: true,
  };
}

function resolvePreferredUserText(
  text: string,
  enableCollaborationBadge: boolean,
): { displayText: string; stickyCandidateText: string } {
  const safeText = enableCollaborationBadge
    ? extractModeFallbackUserInput(text).text
    : text;
  const strippedSharedSync = stripSharedSessionContextSyncWrapper(safeText);
  const filteredCommandText = extractCommandMessageDisplayText(strippedSharedSync);
  const extractedUserInput =
    extractLatestUserInputTextPreserveFormatting(filteredCommandText);
  const stickyCandidateText =
    extractedUserInput.trim().length > 0
      ? extractedUserInput
      : filteredCommandText.trim().length > 0
        ? filteredCommandText
        : safeText.trim().length > 0
          ? safeText
          : text.trim().length > 0
            ? text
            : "";
  return {
    displayText: stickyCandidateText.trim().length > 0 ? stickyCandidateText : "",
    stickyCandidateText,
  };
}

export function resolveUserMessagePresentation({
  text,
  selectedAgentName,
  selectedAgentIcon,
  enableCollaborationBadge,
}: ResolveUserMessagePresentationParams): UserMessagePresentation {
  const legacyUserMemory = parseInjectedMemoryPrefixFromUser(text);
  const afterMemoryText = legacyUserMemory?.remainingText ?? text;
  const legacyUserNoteCard = parseInjectedNoteCardContextFromUser(afterMemoryText);
  const originalText = legacyUserNoteCard?.remainingText ?? afterMemoryText;
  const normalizedSelectedAgentName = normalizeSelectedAgentName(selectedAgentName);
  const normalizedSelectedAgentIcon = normalizeSelectedAgentIcon(selectedAgentIcon);
  const strippedAgentPrompt = stripAgentPromptBlockFromUserText(
    originalText,
    normalizedSelectedAgentName,
    normalizedSelectedAgentIcon,
  );
  const preferredText = resolvePreferredUserText(
    strippedAgentPrompt.text,
    enableCollaborationBadge,
  );
  const displayText =
    preferredText.displayText.trim().length > 0
      ? preferredText.displayText
      : text || originalText;
  return {
    displayText,
    stickyCandidateText: preferredText.stickyCandidateText,
    selectedAgentName:
      strippedAgentPrompt.selectedAgentName ?? normalizedSelectedAgentName,
    selectedAgentIcon:
      strippedAgentPrompt.selectedAgentIcon ?? normalizedSelectedAgentIcon,
    hasInjectedAgentPromptBlock: strippedAgentPrompt.hasInjectedAgentPromptBlock,
    memorySummary: legacyUserMemory?.memorySummary ?? null,
    noteCardSummary: legacyUserNoteCard?.noteCardSummary ?? null,
  };
}

export function resolveUserConversationSummary({
  text,
  images,
  selectedAgentName,
  selectedAgentIcon,
  enableCollaborationBadge,
}: Pick<MessageConversationItem, "text" | "images" | "selectedAgentName" | "selectedAgentIcon"> & {
  enableCollaborationBadge: boolean;
}): UserConversationSummary {
  const presentation = resolveUserMessagePresentation({
    text,
    selectedAgentName,
    selectedAgentIcon,
    enableCollaborationBadge,
  });
  const previewText = presentation.stickyCandidateText.trim();
  const imageCount = Array.isArray(images) ? images.length : 0;
  return {
    previewText,
    stickyCandidateText: presentation.stickyCandidateText,
    imageCount,
    hasRenderableConversationContent: previewText.length > 0 || imageCount > 0,
  };
}
