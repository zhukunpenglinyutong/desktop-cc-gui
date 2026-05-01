import type { ConversationItem } from "../../../types";
import { mergeNearDuplicateParagraphVariants } from "../../../utils/assistantDuplicateParagraphs";

type MessageConversationItem = Extract<ConversationItem, { kind: "message" }>;
type UserConversationMessage = MessageConversationItem & { role: "user" };
type ReasoningConversationItem = Extract<ConversationItem, { kind: "reasoning" }>;

const USER_INPUT_BLOCK_MARKER_REGEX = /\[User Input\]\s*/gi;
const PROJECT_MEMORY_BLOCK_REGEX = /^<project-memory\b[\s\S]*?<\/project-memory>\s*/i;
const MODE_FALLBACK_PREFIX_REGEX =
  /^(?:collaboration mode:\s*code\.|execution policy \(default mode\):|execution policy \(plan mode\):)/i;
const MODE_FALLBACK_MARKER_REGEX = /User request\s*:\s*/i;
const AGENT_PROMPT_HEADER = "## Agent Role and Instructions";
const AGENT_PROMPT_NAME_PREFIX_REGEX = /^Agent Name:\s*\S+/i;
const AGENT_PROMPT_ICON_PREFIX_REGEX = /^Agent Icon:\s*\S+/i;
const SHARED_SESSION_SYNC_PREFIX_REGEX =
  /^Shared session context sync\.\s*Continue from these recent turns before answering the new request:\s*/i;
const SHARED_SESSION_CURRENT_REQUEST_MARKER_REGEX =
  /(?:\r?\n){1,2}Current user request:\s*(?:\r?\n)?/i;
const NOTE_CARD_CONTEXT_SUFFIX_REGEX =
  /(?:\r?\n){1,2}(<note-card-context>[\s\S]*<\/note-card-context>)\s*$/i;
const NOTE_CARD_ATTACHMENT_LINE_REGEX = /^\s*-\s*(.+?)\s*\|\s*(.+?)\s*$/;

function stripInjectedProjectMemoryBlock(text: string): string {
  const match = PROJECT_MEMORY_BLOCK_REGEX.exec(text.trimStart());
  if (!match || match.index !== 0) {
    return text;
  }
  const stripped = text.replace(PROJECT_MEMORY_BLOCK_REGEX, "");
  return stripped.trim().length > 0 ? stripped : text;
}

function stripModeFallbackBlock(text: string): string {
  if (!MODE_FALLBACK_PREFIX_REGEX.test(text.trimStart())) {
    return text;
  }
  const marker = MODE_FALLBACK_MARKER_REGEX.exec(text);
  if (!marker || marker.index < 0) {
    return text;
  }
  const extractedRaw = text.slice(marker.index + marker[0].length);
  const extracted = extractedRaw.replace(/^\r?\n/, "").replace(/^ /, "");
  return extracted.trim().length > 0 ? extracted : text;
}

function stripSelectedAgentPromptBlock(text: string): string {
  const headerIndex = text.lastIndexOf(AGENT_PROMPT_HEADER);
  if (headerIndex < 0) {
    return text;
  }
  const prefix = text.slice(0, headerIndex);
  const suffix = text
    .slice(headerIndex + AGENT_PROMPT_HEADER.length)
    .replace(/^\s+/, "");
  if (!suffix) {
    return text;
  }
  const looksInjectedAgentBlock =
    AGENT_PROMPT_NAME_PREFIX_REGEX.test(suffix) ||
    AGENT_PROMPT_ICON_PREFIX_REGEX.test(suffix);
  if (!looksInjectedAgentBlock) {
    return text;
  }
  return prefix.replace(/\s+$/, "");
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

function normalizeComparableImageIdentity(value: string) {
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

function splitInjectedNoteCardContext(text: string) {
  const normalized = text.trimEnd();
  const contextMatch = normalized.match(NOTE_CARD_CONTEXT_SUFFIX_REGEX);
  if (!contextMatch?.[1] || contextMatch.index === undefined) {
    return {
      text,
      attachmentPaths: [] as string[],
    };
  }
  const lines = contextMatch[1].split(/\r?\n/);
  const attachmentPaths: string[] = [];
  let isInsideImagesSection = false;
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (trimmedLine === "Images:") {
      isInsideImagesSection = true;
      continue;
    }
    if (!isInsideImagesSection) {
      continue;
    }
    const matchedAttachment = NOTE_CARD_ATTACHMENT_LINE_REGEX.exec(line)?.[2]?.trim() ?? "";
    if (matchedAttachment) {
      attachmentPaths.push(matchedAttachment);
      continue;
    }
    isInsideImagesSection = false;
  }
  return {
    text: normalized.slice(0, contextMatch.index).replace(/\s+$/, ""),
    attachmentPaths,
  };
}

function extractLatestUserInputTextPreserveFormatting(text: string): string {
  const userInputMatches = [...text.matchAll(USER_INPUT_BLOCK_MARKER_REGEX)];
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
  return text.slice(markerIndex + lastMatch[0].length);
}

export function normalizeComparableUserText(text: string): string {
  const latestUserInput = extractLatestUserInputTextPreserveFormatting(text);
  const normalized = stripSharedSessionContextSyncWrapper(
    stripSelectedAgentPromptBlock(
      stripModeFallbackBlock(stripInjectedProjectMemoryBlock(latestUserInput)),
    ),
  );
  return splitInjectedNoteCardContext(normalized).text.replace(/\s+/g, " ").trim();
}

export function normalizeUserImages(
  images: string[] | undefined,
  text?: string,
): string[] {
  const normalizedImages = Array.isArray(images) ? images : [];
  if (!text) {
    return normalizedImages;
  }
  const { attachmentPaths } = splitInjectedNoteCardContext(text);
  if (attachmentPaths.length === 0) {
    return normalizedImages;
  }
  const injectedImageIdentitySet = new Set(
    attachmentPaths.map((path) => normalizeComparableImageIdentity(path)).filter(Boolean),
  );
  if (injectedImageIdentitySet.size === 0) {
    return normalizedImages;
  }
  return normalizedImages.filter(
    (image) => !injectedImageIdentitySet.has(normalizeComparableImageIdentity(image)),
  );
}

export function areSameUserImages(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((image, index) => image === right[index]);
}

export function buildComparableUserMessageKey(input: {
  text: string;
  images?: string[] | undefined;
}) {
  return `${normalizeComparableUserText(input.text)}\u0000${normalizeUserImages(
    input.images,
    input.text,
  ).join("\u0001")}`;
}

export function isEquivalentUserObservation(
  left: Pick<UserConversationMessage, "text" | "images">,
  right: Pick<UserConversationMessage, "text" | "images">,
) {
  return (
    normalizeComparableUserText(left.text) === normalizeComparableUserText(right.text) &&
    areSameUserImages(
      normalizeUserImages(left.images, left.text),
      normalizeUserImages(right.images, right.text),
    )
  );
}

export function compactComparableConversationText(value: string) {
  return value
    .replace(/\s+/g, "")
    .replace(/[！!]/g, "!")
    .replace(/[？?]/g, "?")
    .replace(/[，,]/g, ",")
    .replace(/[。．.]/g, ".")
    .trim();
}

export function normalizeComparableMessageTextByRole(
  role: MessageConversationItem["role"],
  text: string,
) {
  if (role === "user") {
    return normalizeComparableUserText(text);
  }
  return text.replace(/\s+/g, " ").trim();
}

export function buildComparableConversationMessageSignature(
  item: MessageConversationItem,
) {
  const normalizedImages = (
    item.role === "user"
      ? normalizeUserImages(item.images, item.text)
      : (Array.isArray(item.images) ? item.images : [])
  ).join("\u0001");
  return [
    item.role,
    normalizeComparableMessageTextByRole(item.role, item.text),
    normalizedImages,
  ].join("\u0000");
}

export function areEquivalentReasoningTexts(previous: string, incoming: string) {
  const previousCompact = compactComparableConversationText(previous);
  const incomingCompact = compactComparableConversationText(incoming);
  if (!previousCompact || !incomingCompact) {
    return false;
  }
  if (previousCompact === incomingCompact) {
    return true;
  }
  if (previousCompact.length >= 16 && incomingCompact.includes(previousCompact)) {
    return true;
  }
  if (incomingCompact.length >= 16 && previousCompact.includes(incomingCompact)) {
    return true;
  }
  const max = Math.min(previousCompact.length, incomingCompact.length);
  let sharedPrefix = 0;
  while (
    sharedPrefix < max &&
    previousCompact[sharedPrefix] === incomingCompact[sharedPrefix]
  ) {
    sharedPrefix += 1;
  }
  return sharedPrefix >= 8 && sharedPrefix >= Math.floor(max * 0.72);
}

export function findEquivalentReasoningObservationIndex(
  list: ConversationItem[],
  incoming: Pick<ReasoningConversationItem, "summary" | "content">,
) {
  const incomingText = (incoming.content || incoming.summary || "").trim();
  if (!incomingText) {
    return -1;
  }
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const candidate = list[index];
    if (!candidate) {
      continue;
    }
    if (candidate.kind === "message" && candidate.role === "user") {
      break;
    }
    if (candidate.kind !== "reasoning") {
      continue;
    }
    const candidateText = (candidate.content || candidate.summary || "").trim();
    if (!candidateText) {
      continue;
    }
    if (areEquivalentReasoningTexts(candidateText, incomingText)) {
      return index;
    }
  }
  return -1;
}

type AssistantTextMergeFn = (existing: string, incoming: string) => string;

export function areEquivalentAssistantMessageTexts(
  existingText: string,
  incomingText: string,
  mergeText?: AssistantTextMergeFn,
) {
  const existing = compactComparableConversationText(existingText);
  const incoming = compactComparableConversationText(incomingText);
  if (!existing || !incoming) {
    return false;
  }
  if (existing === incoming) {
    return true;
  }
  if (existing.startsWith(incoming) || incoming.startsWith(existing)) {
    return Math.min(existing.length, incoming.length) >= 8;
  }
  if (
    existing.length >= 24 &&
    incoming.length >= 24 &&
    (existing.includes(incoming) || incoming.includes(existing))
  ) {
    return true;
  }
  if (
    existing.length >= 48 &&
    incoming.length >= 48 &&
    mergeNearDuplicateParagraphVariants(existingText, incomingText)
  ) {
    return true;
  }
  if (mergeText && existing.length >= 48 && incoming.length >= 48) {
    const merged = compactComparableConversationText(
      mergeText(existingText, incomingText),
    );
    const largestInputLength = Math.max(existing.length, incoming.length);
    const combinedInputLength = existing.length + incoming.length;
    if (
      merged.length < Math.floor(combinedInputLength * 0.72) &&
      merged.length <= Math.floor(largestInputLength * 1.28)
    ) {
      return true;
    }
  }
  return false;
}
