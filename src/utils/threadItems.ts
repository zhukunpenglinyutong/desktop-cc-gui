import type { ConversationItem } from "../types";
import { normalizeAgentIcon } from "./agentIcons";
import {
  formatCollabAgentStates,
  normalizeCollabAgentStatusMap,
} from "./collabToolParsing";
import { summarizeExploration } from "./threadItemsExploreSummary";
import {
  inferFileChangesFromCommandExecutionArtifacts,
  inferFileChangesFromPayload,
  mergeToolChanges,
  normalizeFileChangeKind,
  shouldPreferExplicitFileChangeOutput,
} from "./threadItemsFileChanges";

const MAX_ITEM_TEXT = 20000;
const TOOL_OUTPUT_RECENT_ITEMS = 12;
const NO_TRUNCATE_TOOL_OUTPUT_RECENT_ITEMS = 4;
const NO_TRUNCATE_TOOL_TYPES = new Set(["fileChange", "commandExecution"]);
const MAX_DEFAULT_THREAD_TITLE_CHARS = 10;
const USER_INPUT_BLOCK_MARKER_REGEX = /\[User Input\]\s*/g;
const AGENT_PROMPT_BLOCK_AT_TAIL_REGEX =
  /(?:\r?\n){2}##\s*Agent Role and Instructions\s*(?:\r?\n){2}([\s\S]*)$/;
const AGENT_PROMPT_NAME_LINE_REGEX =
  /^(?:agent\s*name|selected\s*agent|智能体(?:名称|标题)?|agent)\s*[:：]\s*(.+)$/i;
const AGENT_PROMPT_ICON_LINE_REGEX =
  /^(?:agent\s*icon|selected\s*agent\s*icon|智能体图标|agent\s*icon\s*id)\s*[:：]\s*(.+)$/i;
const TITLE_INJECTED_LINE_PREFIX_REGEX =
  /^\[(?:System|Session Spec Link|Spec Root Priority|Skill Prompt|Commons Prompt)\][^\n]*(?:\r?\n|$)/i;
const EDIT_TOOL_TYPE_HINTS = new Set([
  "edit",
  "edit_file",
  "editfile",
  "multiedit",
  "write",
  "write_file",
  "writefile",
  "write_to_file",
  "replace_string",
  "file_edit",
  "file_write",
  "notebookedit",
  "create_file",
]);
const PROJECT_MEMORY_BLOCK_REGEX = /^<project-memory\b[\s\S]*?<\/project-memory>\s*/i;
const PROJECT_MEMORY_LINE_PREFIX_REGEX =
  /^\[(?:已知问题|技术决策|项目上下文|对话记录|笔记|记忆)\]\s+/;
const MODE_FALLBACK_PREFIX_REGEX =
  /^(?:collaboration mode:\s*code\.|execution policy \(default mode\):|execution policy \(plan mode\):)/i;
const MODE_FALLBACK_MARKER_REGEX = /User request\s*:\s*/i;
const SHARED_SESSION_SYNC_PREFIX_REGEX =
  /^Shared session context sync\.\s*Continue from these recent turns before answering the new request:\s*/i;
const SHARED_SESSION_CURRENT_REQUEST_MARKER_REGEX =
  /(?:\r?\n){1,2}Current user request:\s*(?:\r?\n)?/i;
const MAX_INJECTED_MEMORY_LINES = 12;
const MESSAGE_PARAGRAPH_BREAK_SPLIT_REGEX = /\r?\n[^\S\r\n]*\r?\n+/;
const ASSISTANT_FRAGMENT_MIN_RUN = 5;
const ASSISTANT_FRAGMENT_MAX_LENGTH = 14;
const ASSISTANT_FRAGMENT_MIN_TOTAL_CHARS = 12;
const ASSISTANT_LINE_FRAGMENT_MIN_RUN = 6;
const ASSISTANT_LINE_FRAGMENT_MAX_LENGTH = 10;
const ASSISTANT_LINE_FRAGMENT_MIN_TOTAL_CHARS = 12;
const ASSISTANT_TEXT_CACHE_MAX = 320;
const ASSISTANT_NO_CONTENT_PLACEHOLDER_SET = new Set(["(no content)", "no content"]);
const assistantNormalizedTextCache = new Map<string, string>();
const assistantReadabilityScoreCache = new Map<
  string,
  { normalized: string; score: number }
>();

function asString(value: unknown) {
  return typeof value === "string" ? value : value ? String(value) : "";
}

function normalizeCollaborationMode(value: unknown): "plan" | "code" | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "default") {
    return "code";
  }
  return normalized === "plan" || normalized === "code"
    ? normalized
    : null;
}

function parseCollaborationModeValue(value: unknown): "plan" | "code" | null {
  const direct = normalizeCollaborationMode(value);
  if (direct) {
    return direct;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  return (
    normalizeCollaborationMode(record.mode) ??
    normalizeCollaborationMode(record.id) ??
    normalizeCollaborationMode(record.name) ??
    null
  );
}

function extractModeFallbackMode(text: string): "plan" | "code" | null {
  const trimmed = text.trimStart();
  if (!MODE_FALLBACK_PREFIX_REGEX.test(trimmed)) {
    return null;
  }
  return /^execution policy \(plan mode\):/i.test(trimmed) ? "plan" : "code";
}

function extractCollaborationModeFromUserMessageItem(
  item: Record<string, unknown>,
  fallbackMode: "plan" | "code" | null,
): "plan" | "code" | null {
  const metadata =
    item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata)
      ? (item.metadata as Record<string, unknown>)
      : null;
  const candidates: unknown[] = [
    item.collaborationMode,
    item.collaboration_mode,
    item.selectedUiMode,
    item.selected_ui_mode,
    item.effectiveUiMode,
    item.effective_ui_mode,
    item.mode,
    metadata?.collaborationMode,
    metadata?.collaboration_mode,
    metadata?.mode,
  ];
  for (const candidate of candidates) {
    const mode = parseCollaborationModeValue(candidate);
    if (mode) {
      return mode;
    }
  }
  return fallbackMode;
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value === 1 ? true : value === 0 ? false : null;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "no") {
      return false;
    }
  }
  return null;
}

function formatPlanSteps(value: unknown) {
  if (!Array.isArray(value)) {
    return "";
  }
  const lines = value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return "";
      }
      const record = entry as Record<string, unknown>;
      const step = asString(record.step ?? record.title ?? record.text ?? "").trim();
      if (!step) {
        return "";
      }
      const status = asString(record.status ?? "").trim();
      return status ? `- [${status}] ${step}` : `- ${step}`;
    })
    .filter(Boolean);
  return lines.join("\n");
}

function extractImplementPlanActionId(item: Record<string, unknown>) {
  const direct = asString(item.actionId ?? item.action_id ?? "").trim();
  if (direct) {
    return direct;
  }
  const action =
    item.action && typeof item.action === "object" && !Array.isArray(item.action)
      ? (item.action as Record<string, unknown>)
      : null;
  const fromAction = asString(action?.id ?? action?.actionId ?? action?.action_id ?? "").trim();
  if (fromAction) {
    return fromAction;
  }
  const actions = Array.isArray(item.actions) ? item.actions : [];
  for (const entry of actions) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const id = asString(record.id ?? record.actionId ?? record.action_id ?? "").trim();
    if (id) {
      return id;
    }
  }
  return "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeCommandValue(value: unknown) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (!Array.isArray(value)) {
    return "";
  }
  const parts = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return parts.join(" ").trim();
}

function getFirstStringField(source: Record<string, unknown> | null, keys: string[]) {
  if (!source) {
    return "";
  }
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function getFirstCommandField(source: Record<string, unknown> | null, keys: string[]) {
  if (!source) {
    return "";
  }
  for (const key of keys) {
    const normalized = normalizeCommandValue(source[key]);
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function joinReasoningFragments(parts: string[]) {
  const fragments = parts.filter((entry) => entry.length > 0);
  if (fragments.length === 0) {
    return "";
  }
  const firstFragment = fragments[0] ?? "";
  if (fragments.length === 1) {
    return firstFragment;
  }
  return fragments.slice(1).reduce((combined, fragment) => {
    const previousChar = combined[combined.length - 1] ?? "";
    const nextChar = fragment[0] ?? "";
    const shouldInsertSpace =
      /[A-Za-z0-9]/.test(previousChar) &&
      /[A-Za-z0-9]/.test(nextChar);
    return shouldInsertSpace ? `${combined} ${fragment}` : `${combined}${fragment}`;
  }, firstFragment);
}

function extractReasoningText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return joinReasoningFragments(
      value
        .map((entry) => extractReasoningText(entry))
        .filter(Boolean),
    );
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const direct =
      extractReasoningText(record.text) ||
      extractReasoningText(record.value) ||
      extractReasoningText(record.content) ||
      extractReasoningText(record.parts) ||
      extractReasoningText(record.summary) ||
      extractReasoningText(record.reasoning);
    return direct;
  }
  return "";
}

function hasVisibleReasoningText(summary: string, content: string): boolean {
  return summary.trim().length > 0 || content.trim().length > 0;
}

function compactComparableReasoningSnapshotText(value: string) {
  return value
    .replace(/\s+/g, "")
    .replace(/[！!]/g, "!")
    .replace(/[？?]/g, "?")
    .replace(/[，,]/g, ",")
    .replace(/[。．.]/g, ".");
}

function isReasoningSnapshotDuplicate(previous: string, incoming: string) {
  const previousCompact = compactComparableReasoningSnapshotText(previous);
  const incomingCompact = compactComparableReasoningSnapshotText(incoming);
  if (!previousCompact || !incomingCompact) {
    return false;
  }
  if (previousCompact === incomingCompact) {
    return true;
  }
  if (previousCompact.length >= 8 && incomingCompact.includes(previousCompact)) {
    return true;
  }
  if (incomingCompact.length >= 8 && previousCompact.includes(incomingCompact)) {
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
  if (sharedPrefix >= 8 && sharedPrefix >= Math.floor(max * 0.72)) {
    return true;
  }
  return false;
}

function findDuplicateReasoningSnapshotIndex(
  list: ConversationItem[],
  incoming: Extract<ConversationItem, { kind: "reasoning" }>,
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
    if (isReasoningSnapshotDuplicate(candidateText, incomingText)) {
      return index;
    }
  }
  return -1;
}

function mergeReasoningSnapshot(
  existing: Extract<ConversationItem, { kind: "reasoning" }>,
  incoming: Extract<ConversationItem, { kind: "reasoning" }>,
): Extract<ConversationItem, { kind: "reasoning" }> {
  const existingSummary = existing.summary.trim();
  const incomingSummary = incoming.summary.trim();
  const existingContent = existing.content.trim();
  const incomingContent = incoming.content.trim();
  return {
    ...existing,
    summary: incomingSummary.length >= existingSummary.length ? incomingSummary : existingSummary,
    content: incomingContent.length >= existingContent.length ? incomingContent : existingContent,
  };
}

function truncateText(text: string, maxLength = MAX_ITEM_TEXT) {
  if (text.length <= maxLength) {
    return text;
  }
  const sliceLength = Math.max(0, maxLength - 3);
  return `${text.slice(0, sliceLength)}...`;
}

type AskUserQuestionOption = {
  label: string;
  description: string;
};

type AskUserQuestionTemplate = {
  id: string;
  header: string;
  question: string;
  options?: AskUserQuestionOption[];
};

type AskUserQuestionAnswer = {
  selectedOptions: string[];
  note: string;
};

type AskUserQuestionAnswerParseResult = {
  rawSelectionText: string;
  answers: AskUserQuestionAnswer[];
};

function parseJsonRecordFromText(value: string): Record<string, unknown> | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed);
    return asRecord(parsed);
  } catch {
    return null;
  }
}

function isAskUserQuestionToolItem(item: Extract<ConversationItem, { kind: "tool" }>) {
  const toolType = asString(item.toolType).trim().toLowerCase();
  if (toolType === "askuserquestion" || toolType === "ask_user_question") {
    return true;
  }
  const title = asString(item.title).toLowerCase();
  if (title.includes("askuserquestion") || title.includes("ask_user_question")) {
    return true;
  }
  if (toolType === "mcptoolcall") {
    return title.includes("askuserquestion") || title.includes("ask_user_question");
  }
  return false;
}

function parseAskUserQuestionTemplatesFromDetail(detail: string): AskUserQuestionTemplate[] {
  const record = parseJsonRecordFromText(detail);
  if (!record) {
    return [];
  }
  const hasSingleQuestionShape =
    "question" in record ||
    "prompt" in record ||
    "header" in record ||
    "title" in record ||
    "options" in record;
  const rawQuestions = Array.isArray(record.questions)
    ? record.questions
    : hasSingleQuestionShape
      ? [record]
      : [];
  const templates: AskUserQuestionTemplate[] = [];
  rawQuestions.forEach((entry, index) => {
    const question = asRecord(entry);
    if (!question) {
      return;
    }
    const id = asString(question.id ?? `q-${index}`).trim() || `q-${index}`;
    const header = asString(question.header ?? question.title ?? "").trim();
    const questionText = asString(question.question ?? question.prompt ?? "").trim();
    const rawOptions = Array.isArray(question.options) ? question.options : [];
    const options = rawOptions
      .map((rawOption) => {
        const option = asRecord(rawOption);
        if (!option) {
          return null;
        }
        const label = asString(option.label ?? "").trim();
        const description = asString(option.description ?? "").trim();
        if (!label && !description) {
          return null;
        }
        return { label, description };
      })
      .filter((option): option is AskUserQuestionOption => option !== null);
    if (!questionText && options.length === 0) {
      return;
    }
    templates.push({
      id,
      header,
      question: questionText,
      options: options.length > 0 ? options : undefined,
    });
  });
  return templates;
}

function parseAskUserAnswerParts(raw: string): AskUserQuestionAnswer {
  const segments = raw
    .split(/[,，、]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const selectedOptions: string[] = [];
  let note = "";
  for (const segment of segments) {
    if (/^user_note\s*:/i.test(segment)) {
      const parsedNote = segment.replace(/^user_note\s*:/i, "").trim();
      if (parsedNote) {
        note = parsedNote;
      }
      continue;
    }
    selectedOptions.push(segment);
  }
  return { selectedOptions, note };
}

function parseAskUserQuestionAnswerText(text: string): AskUserQuestionAnswerParseResult | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  if (/^The user dismissed the question without selecting an option\.?$/i.test(trimmed)) {
    return {
      rawSelectionText: "",
      answers: [{ selectedOptions: [], note: "" }],
    };
  }
  const answeredMatch = trimmed.match(
    /^The user answered the AskUserQuestion[:：]\s*([\s\S]*?)(?:[。.]?\s*Please continue based on this selection\.?)$/i,
  );
  if (!answeredMatch) {
    return null;
  }
  const rawSelectionText = asString(answeredMatch[1] ?? "").trim();
  if (!rawSelectionText) {
    return null;
  }
  const baseSegments = rawSelectionText
    .split(/[;；]/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (baseSegments.length === 0) {
    return null;
  }
  return {
    rawSelectionText,
    answers: baseSegments.map((segment) => parseAskUserAnswerParts(segment)),
  };
}

function buildRequestUserInputSubmittedDetail(
  templates: AskUserQuestionTemplate[],
  parsedAnswer: AskUserQuestionAnswerParseResult,
) {
  const payload = {
    schema: "requestUserInputSubmitted/v1",
    submittedAt: Date.now(),
    questions: templates.map((template, index) => ({
      id: template.id || `q-${index}`,
      header: template.header,
      question: template.question,
      options: template.options,
      selectedOptions: parsedAnswer.answers[index]?.selectedOptions ?? [],
      note: parsedAnswer.answers[index]?.note ?? "",
    })),
  };
  return JSON.stringify(payload);
}

function normalizeAskUserQuestionHistoryItems(items: ConversationItem[]) {
  if (items.length === 0) {
    return items;
  }
  const normalized: ConversationItem[] = [];
  const askToolOrder: string[] = [];
  const askTemplatesByToolId = new Map<string, AskUserQuestionTemplate[]>();
  const askToolIndexById = new Map<string, number>();
  const existingSubmittedToolIds = new Set<string>();

  for (const item of items) {
    if (item.kind === "tool" && item.toolType === "requestUserInputSubmitted") {
      const submittedId = item.id;
      const prefix = "request-user-input-submitted-";
      if (submittedId.startsWith(prefix) && submittedId.length > prefix.length) {
        existingSubmittedToolIds.add(submittedId.slice(prefix.length));
      }
    }
  }

  const consumeAskToolId = () => {
    while (askToolOrder.length > 0) {
      const candidate = askToolOrder.shift() ?? "";
      if (!candidate) {
        continue;
      }
      return candidate;
    }
    return "";
  };

  for (const item of items) {
    if (item.kind === "tool" && isAskUserQuestionToolItem(item)) {
      askToolOrder.push(item.id);
      askTemplatesByToolId.set(item.id, parseAskUserQuestionTemplatesFromDetail(item.detail));
      askToolIndexById.set(item.id, normalized.length);
      normalized.push(item);
      continue;
    }

    if (item.kind === "message" && item.role === "user") {
      const parsedAnswer = parseAskUserQuestionAnswerText(item.text);
      if (parsedAnswer) {
        const matchedToolId = consumeAskToolId();
        if (matchedToolId) {
          const askToolIndex = askToolIndexById.get(matchedToolId);
          if (askToolIndex !== undefined) {
            const askItem = normalized[askToolIndex];
            if (askItem?.kind === "tool") {
              normalized[askToolIndex] = {
                ...askItem,
                status: "completed",
                output: parsedAnswer.rawSelectionText || askItem.output,
              };
            }
          }
          if (!existingSubmittedToolIds.has(matchedToolId)) {
            const templates = askTemplatesByToolId.get(matchedToolId) ?? [];
            normalized.push({
              id: `request-user-input-submitted-${matchedToolId}`,
              kind: "tool",
              toolType: "requestUserInputSubmitted",
              title: "请求输入",
              detail: buildRequestUserInputSubmittedDetail(templates, parsedAnswer),
              status: "completed",
              output: parsedAnswer.rawSelectionText,
            });
          }
          continue;
        }
      }
    }

    normalized.push(item);
  }

  return normalized;
}

function normalizeToolHint(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9_]/g, "");
}

function hasStructuredEditDetail(detail: string) {
  const normalized = detail.toLowerCase();
  return (
    normalized.includes("\"old_string\"") ||
    normalized.includes("\"oldstring\"") ||
    normalized.includes("\"new_string\"") ||
    normalized.includes("\"newstring\"") ||
    normalized.includes("\"file_path\"") ||
    normalized.includes("\"filepath\"") ||
    normalized.includes("\"replace_all\"")
  );
}

function hasStructuredJsonDetail(detail: string) {
  const trimmed = detail.trim();
  if (!trimmed) {
    return false;
  }
  const startsLikeJsonObject = trimmed.startsWith("{") && trimmed.endsWith("}");
  const startsLikeJsonArray = trimmed.startsWith("[") && trimmed.endsWith("]");
  if (!startsLikeJsonObject && !startsLikeJsonArray) {
    return false;
  }
  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed === "object" && parsed !== null;
  } catch {
    return false;
  }
}

function shouldPreserveToolDetail(item: Extract<ConversationItem, { kind: "tool" }>) {
  if (NO_TRUNCATE_TOOL_TYPES.has(item.toolType)) {
    return true;
  }
  if (hasStructuredJsonDetail(item.detail)) {
    return true;
  }
  const toolTypeHint = normalizeToolHint(item.toolType);
  if (EDIT_TOOL_TYPE_HINTS.has(toolTypeHint)) {
    return true;
  }
  const titleHint = normalizeToolHint(item.title.replace(/^Tool:\s*/i, ""));
  if (EDIT_TOOL_TYPE_HINTS.has(titleHint)) {
    return true;
  }
  if (item.detail.length > 2000 && hasStructuredEditDetail(item.detail)) {
    return true;
  }
  return false;
}

function compactMessageText(value: string) {
  return value.replace(/\s+/g, "");
}

function compactComparableMessageText(value: string) {
  return compactMessageText(value)
    .replace(/[！!]/g, "!")
    .replace(/[？?]/g, "?")
    .replace(/[，,]/g, ",")
    .replace(/[。．.]/g, ".");
}

function rememberCacheEntry<T>(
  cache: Map<string, T>,
  key: string,
  value: T,
) {
  cache.set(key, value);
  if (cache.size > ASSISTANT_TEXT_CACHE_MAX) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) {
      cache.delete(oldestKey);
    }
  }
  return value;
}

function startsWithMarkdownBlockSyntax(value: string) {
  const trimmed = value.trimStart();
  return (
    /^[-*+]\s/.test(trimmed) ||
    /^\d+\.\s/.test(trimmed) ||
    /^>\s?/.test(trimmed) ||
    /^#{1,6}\s/.test(trimmed) ||
    /^```/.test(trimmed) ||
    /^\|/.test(trimmed)
  );
}

function shouldMergeAssistantFragment(value: string) {
  const trimmed = value.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= ASSISTANT_FRAGMENT_MAX_LENGTH &&
    !startsWithMarkdownBlockSyntax(trimmed)
  );
}

function normalizeAssistantFragmentedParagraphs(value: string) {
  if (!MESSAGE_PARAGRAPH_BREAK_SPLIT_REGEX.test(value)) {
    return value;
  }
  const paragraphs = value.split(MESSAGE_PARAGRAPH_BREAK_SPLIT_REGEX);
  if (paragraphs.length < ASSISTANT_FRAGMENT_MIN_RUN) {
    return value;
  }
  let changed = false;
  const normalized: string[] = [];
  let index = 0;
  while (index < paragraphs.length) {
    const current = paragraphs[index] ?? "";
    if (!shouldMergeAssistantFragment(current)) {
      normalized.push(current);
      index += 1;
      continue;
    }
    let cursor = index;
    const run: string[] = [];
    let totalChars = 0;
    while (cursor < paragraphs.length) {
      const candidate = paragraphs[cursor] ?? "";
      if (!shouldMergeAssistantFragment(candidate)) {
        break;
      }
      const trimmed = candidate.trim();
      run.push(trimmed);
      totalChars += trimmed.length;
      cursor += 1;
    }
    if (
      run.length >= ASSISTANT_FRAGMENT_MIN_RUN &&
      totalChars >= ASSISTANT_FRAGMENT_MIN_TOTAL_CHARS
    ) {
      normalized.push(joinReasoningFragments(run));
      changed = true;
    } else {
      normalized.push(...paragraphs.slice(index, cursor));
    }
    index = cursor;
  }
  return changed ? normalized.join("\n\n") : value;
}

function shouldMergeAssistantLine(value: string) {
  const trimmed = value.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= ASSISTANT_LINE_FRAGMENT_MAX_LENGTH &&
    !startsWithMarkdownBlockSyntax(trimmed)
  );
}

function normalizeAssistantFragmentedLines(value: string) {
  if (!value.includes("\n")) {
    return value;
  }
  const blocks = value.split(MESSAGE_PARAGRAPH_BREAK_SPLIT_REGEX);
  let changed = false;
  const normalizedBlocks = blocks.map((block) => {
    const lines = block.split(/\r?\n/);
    const normalizedLines: string[] = [];
    let index = 0;
    while (index < lines.length) {
      const current = lines[index] ?? "";
      if (!shouldMergeAssistantLine(current)) {
        normalizedLines.push(current);
        index += 1;
        continue;
      }
      let cursor = index;
      const run: string[] = [];
      let totalChars = 0;
      while (cursor < lines.length) {
        const candidate = lines[cursor] ?? "";
        if (!shouldMergeAssistantLine(candidate)) {
          break;
        }
        const trimmed = candidate.trim();
        run.push(trimmed);
        totalChars += trimmed.length;
        cursor += 1;
      }
      const runCompact = run.join("");
      const nonSpaceLength = runCompact.replace(/\s+/g, "").length;
      const cjkCount = (runCompact.match(/[\u4e00-\u9fff]/g) ?? []).length;
      const isCjkDominant =
        cjkCount >= Math.max(2, Math.floor(nonSpaceLength * 0.35));
      if (
        run.length >= ASSISTANT_LINE_FRAGMENT_MIN_RUN &&
        totalChars >= ASSISTANT_LINE_FRAGMENT_MIN_TOTAL_CHARS &&
        isCjkDominant
      ) {
        normalizedLines.push(joinReasoningFragments(run));
        changed = true;
      } else {
        normalizedLines.push(...lines.slice(index, cursor));
      }
      index = cursor;
    }
    return normalizedLines.join("\n");
  });
  return changed ? normalizedBlocks.join("\n\n") : value;
}

function dedupeAdjacentAssistantParagraphs(value: string) {
  const paragraphs = value
    .split(MESSAGE_PARAGRAPH_BREAK_SPLIT_REGEX)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (paragraphs.length <= 1) {
    return value.trim();
  }
  const deduped: string[] = [];
  for (const paragraph of paragraphs) {
    const previous = deduped[deduped.length - 1];
    if (
      previous &&
      compactComparableMessageText(previous) === compactComparableMessageText(paragraph) &&
      compactComparableMessageText(paragraph).length >= 6
    ) {
      continue;
    }
    deduped.push(paragraph);
  }
  return deduped.join("\n\n");
}

function collapseRepeatedAssistantParagraphBlocks(value: string) {
  const paragraphs = value
    .split(MESSAGE_PARAGRAPH_BREAK_SPLIT_REGEX)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (paragraphs.length < 2) {
    return value;
  }
  for (const repeatCount of [3, 2]) {
    if (paragraphs.length % repeatCount !== 0) {
      continue;
    }
    const blockLength = paragraphs.length / repeatCount;
    if (blockLength < 1) {
      continue;
    }
    const firstBlock = paragraphs
      .slice(0, blockLength)
      .map((entry) => compactComparableMessageText(entry));
    if (!firstBlock.some((entry) => entry.length >= 6)) {
      continue;
    }
    let matches = true;
    for (let blockIndex = 1; blockIndex < repeatCount; blockIndex += 1) {
      const start = blockIndex * blockLength;
      const candidate = paragraphs
        .slice(start, start + blockLength)
        .map((entry) => compactComparableMessageText(entry));
      if (
        candidate.length !== firstBlock.length ||
        candidate.some((entry, index) => entry !== firstBlock[index])
      ) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return paragraphs.slice(0, blockLength).join("\n\n");
    }
  }
  return value;
}

function collapseRepeatedAssistantFullText(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }
  const directRepeat = trimmed.match(/^([\s\S]{6,}?)(?:\s+\1){1,2}$/);
  if (directRepeat?.[1]) {
    return directRepeat[1].trim();
  }
  const compact = compactMessageText(trimmed);
  for (const repeatCount of [3, 2]) {
    if (compact.length < 12 || compact.length % repeatCount !== 0) {
      continue;
    }
    const chunkLength = compact.length / repeatCount;
    const chunk = compact.slice(0, chunkLength);
    if (chunk.length < 6 || chunk.repeat(repeatCount) !== compact) {
      continue;
    }
    let nonSpaceCount = 0;
    for (let index = 0; index < trimmed.length; index += 1) {
      const currentChar = trimmed[index];
      if (currentChar && !/\s/.test(currentChar)) {
        nonSpaceCount += 1;
      }
      if (nonSpaceCount >= chunkLength) {
        return trimmed.slice(0, index + 1).trim();
      }
    }
  }
  return trimmed;
}

function sharedComparablePrefixLength(left: string, right: string) {
  const max = Math.min(left.length, right.length);
  let index = 0;
  while (index < max && left[index] === right[index]) {
    index += 1;
  }
  return index;
}

function sharedComparableSuffixLength(left: string, right: string) {
  const max = Math.min(left.length, right.length);
  let index = 0;
  while (
    index < max &&
    left[left.length - 1 - index] === right[right.length - 1 - index]
  ) {
    index += 1;
  }
  return index;
}

function isNearDuplicateAssistantSentence(left: string, right: string) {
  const leftCompact = compactComparableMessageText(left.trim());
  const rightCompact = compactComparableMessageText(right.trim());
  if (!leftCompact || !rightCompact) {
    return false;
  }
  if (leftCompact === rightCompact) {
    return true;
  }
  if (leftCompact.length < 6 || rightCompact.length < 6) {
    return false;
  }
  if (leftCompact.includes(rightCompact) || rightCompact.includes(leftCompact)) {
    return true;
  }
  const minLength = Math.min(leftCompact.length, rightCompact.length);
  const sharedPrefix = sharedComparablePrefixLength(leftCompact, rightCompact);
  if (sharedPrefix >= Math.floor(minLength * 0.72)) {
    return true;
  }
  const sharedSuffix = sharedComparableSuffixLength(leftCompact, rightCompact);
  if (sharedSuffix >= Math.floor(minLength * 0.72)) {
    return true;
  }
  return sharedPrefix + sharedSuffix >= Math.floor(minLength * 0.92);
}

function scoreAssistantSentenceBlock(sentences: string[]) {
  const joined = sentences.join("").trim();
  const compactLength = compactMessageText(joined).length;
  const punctuationCount = (joined.match(/[。！？!?]/g) ?? []).length;
  const lineBreakPenalty = (joined.match(/\r?\n/g) ?? []).length;
  return compactLength + punctuationCount * 2 - lineBreakPenalty;
}

function collapseNearDuplicateAssistantSentenceBlocks(value: string) {
  const trimmed = value.trim();
  if (!trimmed || /```/.test(trimmed) || hasRichAssistantMarkdownStructure(trimmed)) {
    return value;
  }
  const sentenceMatches = trimmed.match(/[^。！？!?]+[。！？!?]?/g);
  if (!sentenceMatches || sentenceMatches.length < 4) {
    return value;
  }
  for (const repeatCount of [3, 2]) {
    if (sentenceMatches.length % repeatCount !== 0) {
      continue;
    }
    const blockLength = sentenceMatches.length / repeatCount;
    if (blockLength < 1) {
      continue;
    }
    const blocks = Array.from({ length: repeatCount }, (_, blockIndex) =>
      sentenceMatches.slice(blockIndex * blockLength, (blockIndex + 1) * blockLength),
    );
    const baseBlock = blocks[0] ?? [];
    if (baseBlock.length === 0) {
      continue;
    }
    let comparablePairs = 0;
    let hasStrongPair = false;
    let matches = true;
    for (let blockIndex = 1; blockIndex < blocks.length; blockIndex += 1) {
      const candidateBlock = blocks[blockIndex] ?? [];
      if (candidateBlock.length !== baseBlock.length) {
        matches = false;
        break;
      }
      for (let sentenceIndex = 0; sentenceIndex < baseBlock.length; sentenceIndex += 1) {
        const left = baseBlock[sentenceIndex] ?? "";
        const right = candidateBlock[sentenceIndex] ?? "";
        if (!isNearDuplicateAssistantSentence(left, right)) {
          matches = false;
          break;
        }
        const pairLength = Math.max(
          compactMessageText(left).length,
          compactMessageText(right).length,
        );
        if (pairLength >= 8) {
          comparablePairs += 1;
          hasStrongPair = true;
        }
      }
      if (!matches) {
        break;
      }
    }
    if (!matches || !hasStrongPair || comparablePairs < Math.max(1, blockLength - 1)) {
      continue;
    }
    let selectedIndex = 0;
    let selectedScore = Number.NEGATIVE_INFINITY;
    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
      const score = scoreAssistantSentenceBlock(blocks[blockIndex] ?? []);
      if (score > selectedScore || (score === selectedScore && blockIndex > selectedIndex)) {
        selectedScore = score;
        selectedIndex = blockIndex;
      }
    }
    return (blocks[selectedIndex] ?? []).join("").trim();
  }
  return value;
}

function dedupeRepeatedAssistantSentences(value: string) {
  const dedupeSentences = (paragraph: string) => {
    const trimmed = paragraph.trim();
    if (!trimmed) {
      return trimmed;
    }
    const sentences = trimmed.match(/[^。！？!?]+[。！？!?]/g);
    if (!sentences || sentences.length < 2) {
      return trimmed;
    }
    let collapsedSentences = sentences.map((sentence) => sentence.trim());
    for (const repeatCount of [3, 2]) {
      if (collapsedSentences.length % repeatCount !== 0) {
        continue;
      }
      const blockLength = collapsedSentences.length / repeatCount;
      if (blockLength < 1) {
        continue;
      }
      const firstBlock = collapsedSentences
        .slice(0, blockLength)
        .map((entry) => compactComparableMessageText(entry));
      if (!firstBlock.some((entry) => entry.length >= 6)) {
        continue;
      }
      let matches = true;
      for (let blockIndex = 1; blockIndex < repeatCount; blockIndex += 1) {
        const start = blockIndex * blockLength;
        const candidate = collapsedSentences
          .slice(start, start + blockLength)
          .map((entry) => compactComparableMessageText(entry));
        if (
          candidate.length !== firstBlock.length ||
          candidate.some((entry, index) => entry !== firstBlock[index])
        ) {
          matches = false;
          break;
        }
      }
      if (matches) {
        collapsedSentences = collapsedSentences.slice(0, blockLength);
        break;
      }
    }

    const deduped: string[] = [];
    for (const sentence of collapsedSentences) {
      const current = sentence.trim();
      const previous = deduped[deduped.length - 1];
      if (
        previous &&
        compactComparableMessageText(previous) === compactComparableMessageText(current) &&
        compactComparableMessageText(current).length >= 6
      ) {
        continue;
      }
      deduped.push(current);
    }
    const consumed = sentences.join("");
    const remainder = trimmed.slice(consumed.length);
    return `${deduped.join("")}${remainder}`.trim();
  };

  if (!MESSAGE_PARAGRAPH_BREAK_SPLIT_REGEX.test(value)) {
    return dedupeSentences(value);
  }
  return value
    .split(MESSAGE_PARAGRAPH_BREAK_SPLIT_REGEX)
    .map((entry) => dedupeSentences(entry))
    .filter(Boolean)
    .join("\n\n");
}

function normalizeAssistantMessageText(text: string) {
  if (!text) {
    return text;
  }
  let normalized = text;
  normalized = collapseRepeatedAssistantParagraphBlocks(normalized);
  normalized = collapseRepeatedAssistantFullText(normalized);
  if (isLikelyFragmentedAssistantText(normalized)) {
    normalized = normalizeAssistantFragmentedParagraphs(normalized);
    normalized = normalizeAssistantFragmentedLines(normalized);
  }
  normalized = dedupeRepeatedAssistantSentences(normalized);
  normalized = collapseNearDuplicateAssistantSentenceBlocks(normalized);
  normalized = dedupeAdjacentAssistantParagraphs(normalized);
  normalized = collapseRepeatedAssistantParagraphBlocks(normalized);
  normalized = collapseRepeatedAssistantFullText(normalized);
  return normalized.trim();
}

function hasRepeatedAssistantTextPattern(text: string) {
  if (!text) {
    return false;
  }
  const compact = compactComparableMessageText(text);
  if (compact.length < 24) {
    return false;
  }
  for (const repeatCount of [3, 2]) {
    if (compact.length % repeatCount !== 0) {
      continue;
    }
    const chunkLength = compact.length / repeatCount;
    const chunk = compact.slice(0, chunkLength);
    if (chunk.length >= 6 && chunk.repeat(repeatCount) === compact) {
      return true;
    }
  }
  const anchorLength = Math.max(6, Math.floor(compact.length / 4));
  const anchor = compact.slice(0, anchorLength);
  return anchor.length >= 6 && compact.indexOf(anchor, anchor.length) >= 0;
}

function hasDenseMarkdownStructure(text: string) {
  const lines = text.split(/\r?\n/);
  if (lines.length < 4) {
    return false;
  }
  const markdownStructureLines = lines.filter((line) => {
    const trimmed = line.trimStart();
    return (
      /^[-*+]\s/.test(trimmed) ||
      /^\d+\.\s/.test(trimmed) ||
      /^>\s?/.test(trimmed) ||
      /^#{1,6}\s/.test(trimmed) ||
      /^\|/.test(trimmed)
    );
  }).length;
  if (markdownStructureLines >= 3) {
    return true;
  }
  const fenceCount = (text.match(/```|~~~/g) ?? []).length;
  return fenceCount >= 2;
}

function hasRichAssistantMarkdownStructure(text: string) {
  if (!text.includes("\n")) {
    return false;
  }
  if (hasDenseMarkdownStructure(text)) {
    return true;
  }
  const lines = text.split(/\r?\n/);
  let tableSeparatorCount = 0;
  let indentedCodeCount = 0;
  for (const line of lines) {
    if (
      /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line)
    ) {
      tableSeparatorCount += 1;
    }
    if (/^( {4}|\t)\S+/.test(line)) {
      indentedCodeCount += 1;
    }
    if (tableSeparatorCount >= 1 || indentedCodeCount >= 3) {
      return true;
    }
  }
  return false;
}

function isLikelyFragmentedAssistantText(text: string) {
  if (!text.includes("\n") || hasRichAssistantMarkdownStructure(text)) {
    return false;
  }
  const paragraphs = text
    .split(MESSAGE_PARAGRAPH_BREAK_SPLIT_REGEX)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (paragraphs.length >= ASSISTANT_FRAGMENT_MIN_RUN) {
    const shortParagraphs = paragraphs.filter(
      (entry) =>
        entry.length > 0 &&
        entry.length <= ASSISTANT_FRAGMENT_MAX_LENGTH &&
        !startsWithMarkdownBlockSyntax(entry),
    ).length;
    if (shortParagraphs >= ASSISTANT_FRAGMENT_MIN_RUN && shortParagraphs / paragraphs.length >= 0.6) {
      return true;
    }
  }

  const lines = text
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (lines.length >= ASSISTANT_LINE_FRAGMENT_MIN_RUN) {
    const shortLines = lines.filter(
      (entry) =>
        entry.length > 0 &&
        entry.length <= ASSISTANT_LINE_FRAGMENT_MAX_LENGTH &&
        !startsWithMarkdownBlockSyntax(entry),
    );
    if (shortLines.length >= ASSISTANT_LINE_FRAGMENT_MIN_RUN) {
      const cjkChars = (shortLines.join("").match(/[\u4e00-\u9fff]/g) ?? []).length;
      const totalChars = shortLines.join("").replace(/\s+/g, "").length;
      if (totalChars >= ASSISTANT_LINE_FRAGMENT_MIN_TOTAL_CHARS && cjkChars >= Math.max(2, Math.floor(totalChars * 0.35))) {
        return true;
      }
    }
  }
  return false;
}

function shouldNormalizeAssistantText(text: string) {
  if (!text) {
    return false;
  }
  const hasRepeatedPattern = hasRepeatedAssistantTextPattern(text);
  if (hasRepeatedPattern) {
    return true;
  }
  const collapsedNearDuplicate = collapseNearDuplicateAssistantSentenceBlocks(text);
  if (collapsedNearDuplicate.trim() !== text.trim()) {
    return true;
  }
  if (hasRichAssistantMarkdownStructure(text)) {
    return false;
  }
  return isLikelyFragmentedAssistantText(text);
}

function getNormalizedAssistantMessageText(text: string) {
  const cached = assistantNormalizedTextCache.get(text);
  if (cached !== undefined) {
    return cached;
  }
  const normalized = normalizeAssistantMessageText(text);
  return rememberCacheEntry(assistantNormalizedTextCache, text, normalized);
}

function scoreAssistantMessageReadability(text: string) {
  const cached = assistantReadabilityScoreCache.get(text);
  if (cached) {
    return cached;
  }
  const normalized = shouldNormalizeAssistantText(text)
    ? getNormalizedAssistantMessageText(text)
    : text;
  const paragraphs = normalized
    .split(MESSAGE_PARAGRAPH_BREAK_SPLIT_REGEX)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const shortParagraphCount = paragraphs.filter((entry) => entry.length <= 8).length;
  const compactOriginal = compactMessageText(text);
  const compactNormalized = compactMessageText(normalized);
  let score = shortParagraphCount * 3 + paragraphs.length;
  if (
    compactOriginal.length > compactNormalized.length &&
    compactNormalized.length >= 6
  ) {
    score += Math.min(12, Math.floor((compactOriginal.length - compactNormalized.length) / 3));
  }
  return rememberCacheEntry(assistantReadabilityScoreCache, text, { normalized, score });
}

function normalizeAssistantPlaceholderText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replaceAll("（", "(")
    .replaceAll("）", ")");
}

function isAssistantNoContentPlaceholder(value: string) {
  if (!value) {
    return false;
  }
  return ASSISTANT_NO_CONTENT_PLACEHOLDER_SET.has(
    normalizeAssistantPlaceholderText(value),
  );
}

function normalizeStringList(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((entry) => asString(entry)).filter(Boolean);
  }
  const single = asString(value);
  return single ? [single] : [];
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function extractWebSearchQuery(item: Record<string, unknown>): string {
  const directCandidates = [
    item.query,
    item.q,
    item.searchQuery,
    item.search_query,
    item.prompt,
    item.text,
  ];
  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  const queryPayload = item.search_query ?? item.searchQuery;
  if (Array.isArray(queryPayload)) {
    const queries = queryPayload
      .map((entry) => {
        if (typeof entry === "string") {
          return entry.trim();
        }
        if (!entry || typeof entry !== "object") {
          return "";
        }
        const record = entry as Record<string, unknown>;
        return asString(record.q ?? record.query ?? record.url ?? "").trim();
      })
      .filter(Boolean);
    if (queries.length > 0) {
      return queries.join(" | ");
    }
  }

  if (queryPayload && typeof queryPayload === "object") {
    const record = queryPayload as Record<string, unknown>;
    const nested = asString(record.q ?? record.query ?? record.url ?? "").trim();
    if (nested) {
      return nested;
    }
  }

  return "";
}

function isSuccessfulCommandExecution(status: string): boolean {
  const normalized = status.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return ["completed", "success", "succeeded", "ok"].includes(normalized);
}

function isApplyPatchCommand(command: string): boolean {
  const normalized = command.toLowerCase();
  return /(?:^|[\s;&|])apply_patch(?:\s|$)/.test(normalized);
}

function hasApplyPatchSuccessSignal(output: string): boolean {
  return /success\.\s*updated the following files:/i.test(output);
}

export function normalizeItem(item: ConversationItem): ConversationItem {
  if (item.kind === "message") {
    let normalizedText =
      item.role === "assistant"
        ? shouldNormalizeAssistantText(item.text)
          ? getNormalizedAssistantMessageText(item.text)
          : item.text
        : item.text;
    if (item.role === "assistant" && isAssistantNoContentPlaceholder(normalizedText)) {
      normalizedText = "";
    }
    return { ...item, text: truncateText(normalizedText) };
  }
  if (item.kind === "explore") {
    return item;
  }
  if (item.kind === "reasoning") {
    return {
      ...item,
      summary: truncateText(item.summary),
      content: truncateText(item.content),
    };
  }
  if (item.kind === "diff") {
    return { ...item, diff: truncateText(item.diff) };
  }
  if (item.kind === "tool") {
    const shouldKeepDetail = shouldPreserveToolDetail(item);
    const isNoTruncateTool = NO_TRUNCATE_TOOL_TYPES.has(item.toolType);
    return {
      ...item,
      title: truncateText(item.title, 200),
      detail: shouldKeepDetail ? item.detail : truncateText(item.detail, 2000),
      output: isNoTruncateTool
        ? item.output
        : item.output
          ? truncateText(item.output)
          : item.output,
      changes: item.changes
        ? item.changes.map((change) => ({
            ...change,
            diff:
              isNoTruncateTool || !change.diff
                ? change.diff
                : truncateText(change.diff),
          }))
        : item.changes,
    };
  }
  return item;
}

function mergeToolItemPreservingSnapshot(
  existing: Extract<ConversationItem, { kind: "tool" }>,
  incoming: Extract<ConversationItem, { kind: "tool" }>,
): Extract<ConversationItem, { kind: "tool" }> {
  const hasTitle = incoming.title.trim().length > 0;
  const hasDetail = incoming.detail.trim().length > 0;
  const hasOutput =
    typeof incoming.output === "string" && incoming.output.trim().length > 0;
  const hasChanges = Array.isArray(incoming.changes) && incoming.changes.length > 0;
  return {
    ...existing,
    ...incoming,
    title: hasTitle ? incoming.title : existing.title,
    detail: hasDetail ? incoming.detail : existing.detail,
    output: hasOutput ? incoming.output : existing.output,
    changes: hasChanges ? incoming.changes : existing.changes,
  };
}

function mergeSameKindItem(existing: ConversationItem, incoming: ConversationItem) {
  if (existing.kind === "tool" && incoming.kind === "tool") {
    return mergeToolItemPreservingSnapshot(existing, incoming);
  }
  return { ...existing, ...incoming };
}

export function prepareThreadItems(items: ConversationItem[]) {
  const coalesced: ConversationItem[] = [];
  const coalescedIndexByKey = new Map<string, number>();
  for (const rawItem of items) {
    const item = normalizeItem(rawItem);
    const key = `${item.kind}\u0000${item.id}`;
    const index = coalescedIndexByKey.get(key);
    if (index === undefined) {
      coalescedIndexByKey.set(key, coalesced.length);
      coalesced.push(item);
      continue;
    }
    const existing = coalesced[index];
    if (!existing) {
      coalescedIndexByKey.set(key, coalesced.length);
      coalesced.push(item);
      continue;
    }
    coalesced[index] = mergeSameKindItem(existing, item);
  }
  const filtered: ConversationItem[] = [];
  for (const item of coalesced) {
    if (
      item.kind === "message" &&
      item.role === "assistant" &&
      item.text.trim().length === 0 &&
      (!item.images || item.images.length === 0)
    ) {
      continue;
    }
    const last = filtered[filtered.length - 1];
    if (
      item.kind === "message" &&
      item.role === "assistant" &&
      last?.kind === "review" &&
      last.state === "completed" &&
      item.text.trim() === last.text.trim()
    ) {
      continue;
    }
    filtered.push(item);
  }
  const normalizedAskUserItems = normalizeAskUserQuestionHistoryItems(filtered);
  const summarized = summarizeExploration(normalizedAskUserItems);
  const cutoff = Math.max(0, summarized.length - TOOL_OUTPUT_RECENT_ITEMS);
  const noTruncateCutoff = Math.max(
    0,
    summarized.length - NO_TRUNCATE_TOOL_OUTPUT_RECENT_ITEMS,
  );
  return summarized.map((item, index) => {
    if (item.kind !== "tool") {
      return item;
    }
    const isOlderToolItem = index < cutoff;
    const allowNoTruncate =
      NO_TRUNCATE_TOOL_TYPES.has(item.toolType) && index >= noTruncateCutoff;
    if (!isOlderToolItem || allowNoTruncate) {
      return item;
    }
    const output = item.output ? truncateText(item.output) : item.output;
    const changes = item.changes
      ? item.changes.map((change) => ({
          ...change,
          diff: change.diff ? truncateText(change.diff) : change.diff,
        }))
      : item.changes;
    if (output === item.output && changes === item.changes) {
      return item;
    }
    return { ...item, output, changes };
  });
}

export function upsertItem(list: ConversationItem[], item: ConversationItem) {
  const index = list.findIndex(
    (entry) => entry.id === item.id && entry.kind === item.kind,
  );
  if (index === -1) {
    return [...list, item];
  }
  const next = [...list];
  const existing = next[index];
  if (!existing) {
    return [...list, item];
  }
  next[index] = mergeSameKindItem(existing, item);
  return next;
}

export function getThreadTimestamp(thread: Record<string, unknown>) {
  const raw =
    (thread.updatedAt ?? thread.updated_at ?? thread.createdAt ?? thread.created_at) ??
    0;
  let numeric: number;
  if (typeof raw === "string") {
    const asNumber = Number(raw);
    if (Number.isFinite(asNumber)) {
      numeric = asNumber;
    } else {
      const parsed = Date.parse(raw);
      if (!Number.isFinite(parsed)) {
        return 0;
      }
      numeric = parsed;
    }
  } else {
    numeric = Number(raw);
  }
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }
  return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
}

export function previewThreadName(text: string, fallback: string) {
  const strippedAgentPrompt = stripAgentPromptBlockFromTail(text);
  const strippedModeFallback = stripModeFallbackBlock(strippedAgentPrompt);
  const strippedMemory = stripInjectedProjectMemoryBlock(strippedModeFallback);
  const strippedSharedSync = stripSharedSessionContextSyncBlock(strippedMemory);
  const extractedUserInput = extractLatestUserInputTextPreserveFormatting(strippedSharedSync);
  const strippedInjectedPrefix = stripInjectedPrefixLines(extractedUserInput);
  const collapsed = strippedInjectedPrefix.replace(/\s+/g, " ").trim();
  if (!collapsed) {
    return fallback;
  }
  const clipped = clipByChars(collapsed, MAX_DEFAULT_THREAD_TITLE_CHARS).trim();
  return clipped || fallback;
}

function extractAssistantFinalFlag(item: Record<string, unknown>): boolean | undefined {
  const candidates: unknown[] = [
    item.isFinal,
    item.is_final,
    item.final,
    item.isFinalMessage,
    item.is_final_message,
  ];
  const metadata =
    item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata)
      ? (item.metadata as Record<string, unknown>)
      : null;
  if (metadata) {
    candidates.push(
      metadata.isFinal,
      metadata.is_final,
      metadata.final,
      metadata.isFinalMessage,
      metadata.is_final_message,
    );
  }
  for (const candidate of candidates) {
    const parsed = asBoolean(candidate);
    if (parsed !== null) {
      return parsed;
    }
  }
  return undefined;
}

function parseTimestampLikeMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  const numeric = Number(normalized);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
  }
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

function extractFinalCompletedAtMs(item: Record<string, unknown>): number | undefined {
  const metadata =
    item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata)
      ? (item.metadata as Record<string, unknown>)
      : null;
  const candidates: unknown[] = [
    item.finalCompletedAt,
    item.final_completed_at,
    item.completedAt,
    item.completed_at,
  ];
  if (metadata) {
    candidates.push(
      metadata.finalCompletedAt,
      metadata.final_completed_at,
      metadata.completedAt,
      metadata.completed_at,
    );
  }
  for (const candidate of candidates) {
    const parsed = parseTimestampLikeMs(candidate);
    if (typeof parsed === "number") {
      return parsed;
    }
  }
  return undefined;
}

function extractFinalDurationMs(item: Record<string, unknown>): number | undefined {
  const metadata =
    item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata)
      ? (item.metadata as Record<string, unknown>)
      : null;
  const candidates: unknown[] = [
    item.finalDurationMs,
    item.final_duration_ms,
    item.durationMs,
    item.duration_ms,
  ];
  if (metadata) {
    candidates.push(
      metadata.finalDurationMs,
      metadata.final_duration_ms,
      metadata.durationMs,
      metadata.duration_ms,
    );
  }
  for (const candidate of candidates) {
    const parsed = asNumber(candidate);
    if (parsed !== null && parsed >= 0) {
      return parsed;
    }
  }
  return undefined;
}

function extractHistoryItemTimestampMs(item: Record<string, unknown>): number | undefined {
  const metadata =
    item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata)
      ? (item.metadata as Record<string, unknown>)
      : null;
  const candidates: unknown[] = [
    item.timestamp,
    item.timestamp_ms,
    item.timestampMs,
    item.createdAt,
    item.created_at,
    item.updatedAt,
    item.updated_at,
  ];
  if (metadata) {
    candidates.push(
      metadata.timestamp,
      metadata.timestamp_ms,
      metadata.timestampMs,
      metadata.createdAt,
      metadata.created_at,
      metadata.updatedAt,
      metadata.updated_at,
    );
  }
  for (const candidate of candidates) {
    const parsed = parseTimestampLikeMs(candidate);
    if (typeof parsed === "number") {
      return parsed;
    }
  }
  return undefined;
}

export function buildConversationItem(
  item: Record<string, unknown>,
): ConversationItem | null {
  const type = asString(item.type);
  const id = asString(item.id);
  if (!id || !type) {
    return null;
  }
  if (type === "agentMessage") {
    return null;
  }
  if (type === "userMessage") {
    const content = Array.isArray(item.content) ? item.content : [];
    const {
      text,
      images,
      collaborationMode: fallbackCollaborationMode,
    } = parseUserInputs(content);
    const fallbackPayload = extractFallbackUserMessagePayload(item);
    const resolvedText = text || fallbackPayload.text;
    const resolvedImages = images.length > 0 ? images : fallbackPayload.images;
    const collaborationMode = extractCollaborationModeFromUserMessageItem(
      item,
      fallbackCollaborationMode ?? fallbackPayload.collaborationMode,
    );
    const selectedAgentName = extractSelectedAgentNameFromUserMessageItem(
      item,
      resolvedText,
    );
    const selectedAgentIcon = extractSelectedAgentIconFromUserMessageItem(
      item,
      resolvedText,
    );
    return {
      id,
      kind: "message",
      role: "user",
      text: resolvedText,
      images: resolvedImages.length > 0 ? resolvedImages : undefined,
      collaborationMode,
      selectedAgentName,
      selectedAgentIcon,
    };
  }
  if (type === "reasoning") {
    const summary = extractReasoningText(item.summary ?? "");
    const contentFromItem = extractReasoningText(item.content ?? "");
    const content = contentFromItem || asString(item.text ?? "");
    const encryptedContent = asString(
      item.encrypted_content ?? item.encryptedContent ?? "",
    );
    if (!hasVisibleReasoningText(summary, content)) {
      if (!encryptedContent) {
        return null;
      }
      // Newer Codex Responses can return encrypted reasoning only.
      // Keep a visible placeholder so activity counters don't drop to zero.
      return { id, kind: "reasoning", summary: "Encrypted reasoning", content: "" };
    }
    return { id, kind: "reasoning", summary, content };
  }
  if (type === "plan" || type === "planImplementation") {
    const toolType = type === "plan" ? "proposed-plan" : "plan-implementation";
    const actionId = extractImplementPlanActionId(item);
    const planText = formatPlanSteps(item.steps ?? item.plan);
    const fallbackOutput =
      asString(item.content ?? item.text ?? item.summary ?? item.explanation ?? "");
    return {
      id,
      kind: "tool",
      toolType,
      title: type === "plan" ? "Proposed Plan" : "Plan Implementation",
      detail: actionId || "",
      status: asString(item.status ?? ""),
      output: planText || fallbackOutput,
    };
  }
  if (type === "commandExecution") {
    const input = asRecord(item.input);
    const nestedArgs = asRecord(item.arguments);
    const commandKeys = [
      "command",
      "cmd",
      "script",
      "shell_command",
      "bash",
      "argv",
    ];
    const descriptionKeys = [
      "description",
      "summary",
      "label",
      "title",
      "task",
    ];
    const cwdKeys = ["cwd", "workdir", "working_directory", "workingDirectory"];
    const command =
      getFirstCommandField(item, commandKeys) ||
      getFirstCommandField(input, commandKeys) ||
      getFirstCommandField(nestedArgs, commandKeys);
    const description =
      getFirstStringField(item, descriptionKeys) ||
      getFirstStringField(input, descriptionKeys) ||
      getFirstStringField(nestedArgs, descriptionKeys);
    const cwd =
      getFirstStringField(item, cwdKeys) ||
      getFirstStringField(input, cwdKeys) ||
      getFirstStringField(nestedArgs, cwdKeys) ||
      asString(item.cwd ?? "");
    const detailPayload = description
      ? JSON.stringify(
          {
            command: command || undefined,
            description,
            cwd: cwd || undefined,
          },
        )
      : "";
    const status = asString(item.status ?? "");
    const output = stringifyUnknown(
      item.aggregatedOutput ??
        item.output ??
        item.result ??
        item.stdout ??
        item.stderr ??
        item.text ??
        item.error ??
        "",
    );
    const durationMs = asNumber(item.durationMs ?? item.duration_ms);
    const shouldTreatAsApplyPatchFileChange =
      command &&
      isApplyPatchCommand(command) &&
      (isSuccessfulCommandExecution(status) || hasApplyPatchSuccessSignal(output));
    if (shouldTreatAsApplyPatchFileChange) {
      const normalizedChanges = inferFileChangesFromCommandExecutionArtifacts(command, output);
      if (normalizedChanges.length > 0) {
        const formattedChanges = normalizedChanges
          .map((change) => {
            const prefix =
              change.kind === "add"
                ? "A"
                : change.kind === "delete"
                  ? "D"
                  : change.kind === "rename"
                    ? "R"
                    : change.kind
                      ? "M"
                      : "";
            return [prefix, change.path].filter(Boolean).join(" ");
          })
          .filter(Boolean);
        return {
          id,
          kind: "tool",
          toolType: "fileChange",
          title: "File changes",
          detail: formattedChanges.join(", ") || "Pending changes",
          status,
          output,
          changes: normalizedChanges,
        };
      }
    }
    const titleText = description || command;
    return {
      id,
      kind: "tool",
      toolType: type,
      title: titleText ? `Command: ${titleText}` : "Command",
      detail: detailPayload || cwd,
      status,
      output,
      durationMs,
    };
  }
  if (type === "fileChange") {
    const changes = Array.isArray(item.changes)
      ? item.changes
      : Array.isArray(item.files)
        ? item.files
        : [];
    const inferredChanges =
      changes.length > 0
        ? inferFileChangesFromPayload(item.input ?? item.arguments ?? null)
        : inferFileChangesFromPayload(item.input ?? item.arguments ?? item);
    const inferredChangeByPath = new Map(
      inferredChanges.map((change) => [change.path, change]),
    );
    const normalizedChanges = (changes.length > 0 ? changes : inferredChanges)
      .map((change) => {
        const path = asString(
          change?.path ??
            change?.file_path ??
            change?.filePath ??
            change?.filename ??
            "",
        );
        const inferredChange = path ? inferredChangeByPath.get(path) : undefined;
        const kind = change?.kind as Record<string, unknown> | string | undefined;
        const rawKind =
          typeof kind === "string"
            ? kind
            : typeof kind === "object" && kind
              ? asString(
                  (kind as Record<string, unknown>).type ??
                    (kind as Record<string, unknown>).status ??
                    "",
                )
              : asString(
                  change?.status ?? change?.type ?? inferredChange?.kind ?? "",
                );
        const normalizedKind = normalizeFileChangeKind(rawKind);
        const diff = asString(
          change?.diff ??
            change?.patch ??
            change?.unifiedDiff ??
            change?.unified_diff ??
            inferredChange?.diff ??
            change?.output ??
            "",
        );
        return { path, kind: normalizedKind || undefined, diff: diff || undefined };
      })
      .filter((change) => change.path);
    const formattedChanges = normalizedChanges
      .map((change) => {
        const prefix =
          change.kind === "add"
            ? "A"
            : change.kind === "delete"
              ? "D"
              : change.kind === "rename"
                ? "R"
              : change.kind
                ? "M"
                : "";
        return [prefix, change.path].filter(Boolean).join(" ");
      })
      .filter(Boolean);
    const paths = formattedChanges.join(", ");
    const diffOutput = normalizedChanges
      .map((change) => change.diff ?? "")
      .filter(Boolean)
      .join("\n\n");
    const explicitOutput = asString(item.aggregatedOutput ?? item.output ?? item.text ?? "");
    const preferExplicitOutput = shouldPreferExplicitFileChangeOutput(explicitOutput);
    return {
      id,
      kind: "tool",
      toolType: type,
      title: "File changes",
      detail: paths || "Pending changes",
      status: asString(item.status ?? ""),
      output: preferExplicitOutput ? explicitOutput : diffOutput || explicitOutput,
      changes: normalizedChanges,
    };
  }
  if (type === "mcpToolCall") {
    const server = asString(item.server ?? "");
    const tool = asString(item.tool ?? "");
    const args = item.arguments ? JSON.stringify(item.arguments, null, 2) : "";
    const output = asString(
      item.result ??
        item.output ??
        item.aggregatedOutput ??
        item.stdout ??
        item.stderr ??
        item.text ??
        item.error ??
        "",
    );
    return {
      id,
      kind: "tool",
      toolType: type,
      title: `Tool: ${server}${tool ? ` / ${tool}` : ""}`,
      detail: args,
      status: asString(item.status ?? ""),
      output,
    };
  }
  if (type === "collabToolCall" || type === "collabAgentToolCall") {
    const tool = asString(item.tool ?? "");
    const status = asString(item.status ?? "");
    const sender = asString(item.senderThreadId ?? item.sender_thread_id ?? "");
    const receivers = [
      ...normalizeStringList(item.receiverThreadId ?? item.receiver_thread_id),
      ...normalizeStringList(item.receiverThreadIds ?? item.receiver_thread_ids),
      ...normalizeStringList(item.newThreadId ?? item.new_thread_id),
    ];
    const prompt = asString(item.prompt ?? "");
    const normalizedAgentStatus = normalizeCollabAgentStatusMap(
      item.agentStatus ?? item.agentsStates ?? item.agents_states,
    );
    const agentsState = formatCollabAgentStates(normalizedAgentStatus);
    const detailParts = [sender ? `From ${sender}` : ""]
      .concat(receivers.length > 0 ? `→ ${receivers.join(", ")}` : "")
      .filter(Boolean);
    const outputParts = [prompt, agentsState].filter(Boolean);
    return {
      id,
      kind: "tool",
      toolType: "collabToolCall",
      title: tool ? `Collab: ${tool}` : "Collab tool call",
      detail: detailParts.join(" "),
      status,
      output: outputParts.join("\n\n"),
      senderThreadId: sender || undefined,
      receiverThreadIds: receivers,
      ...(normalizedAgentStatus ? { agentStatus: normalizedAgentStatus } : {}),
    };
  }
  if (type === "webSearch") {
    const query = extractWebSearchQuery(item);
    const detail = query ? JSON.stringify({ query }) : asString(item.query ?? "");
    const output = stringifyUnknown(
      item.result ??
        item.output ??
        item.response ??
        item.results ??
        item.text ??
        item.error ??
        "",
    );
    return {
      id,
      kind: "tool",
      toolType: type,
      title: "Web search",
      detail,
      status: asString(item.status ?? ""),
      output,
    };
  }
  if (type === "imageView") {
    return {
      id,
      kind: "tool",
      toolType: type,
      title: "Image view",
      detail: asString(item.path ?? ""),
      status: "",
      output: "",
    };
  }
  if (type === "enteredReviewMode" || type === "exitedReviewMode") {
    return {
      id,
      kind: "review",
      state: type === "enteredReviewMode" ? "started" : "completed",
      text: asString(item.review ?? ""),
    };
  }
  return null;
}

function extractImageInputValue(input: Record<string, unknown>) {
  const value =
    asString(input.url ?? "") ||
    asString(input.path ?? "") ||
    asString(input.value ?? "") ||
    asString(input.data ?? "") ||
    asString(input.source ?? "");
  return value.trim();
}

function stripInjectedProjectMemoryBlock(text: string) {
  if (!text) {
    return "";
  }
  let normalized = text;
  let changed = false;
  let trimmedLeading = normalized.trimStart();
  while (PROJECT_MEMORY_BLOCK_REGEX.test(trimmedLeading)) {
    normalized = trimmedLeading.replace(PROJECT_MEMORY_BLOCK_REGEX, "");
    changed = true;
    trimmedLeading = normalized.trimStart();
  }

  const blocks = normalized.trimStart().split(MESSAGE_PARAGRAPH_BREAK_SPLIT_REGEX);
  if (blocks.length >= 2) {
    const firstBlock = blocks[0] ?? "";
    const firstBlockLines = firstBlock
      .split(/\r?\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
    const looksLikeInjectedMemoryLines =
      firstBlockLines.length > 0 &&
      firstBlockLines.length <= MAX_INJECTED_MEMORY_LINES &&
      firstBlockLines.every((line) => PROJECT_MEMORY_LINE_PREFIX_REGEX.test(line));
    if (looksLikeInjectedMemoryLines) {
      normalized = blocks.slice(1).join("\n\n");
      changed = true;
    }
  }
  if (!changed) {
    return text;
  }
  return normalized.trimStart();
}

function stripModeFallbackBlock(text: string) {
  if (!extractModeFallbackMode(text)) {
    return text;
  }
  const marker = MODE_FALLBACK_MARKER_REGEX.exec(text);
  if (!marker || marker.index < 0) {
    return text;
  }
  const extracted = text.slice(marker.index + marker[0].length).trim();
  return extracted || text;
}

function stripSharedSessionContextSyncBlock(text: string) {
  if (!SHARED_SESSION_SYNC_PREFIX_REGEX.test(text.trimStart())) {
    return text;
  }
  const marker = SHARED_SESSION_CURRENT_REQUEST_MARKER_REGEX.exec(text);
  if (!marker || marker.index < 0) {
    return text;
  }
  const extractedRaw = text.slice(marker.index + marker[0].length);
  const extracted = extractedRaw.replace(/^\r?\n/, "").replace(/^ /, "");
  return extracted.trim().length > 0 ? extracted : text;
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
  const markerLength = lastMatch[0]?.length ?? 0;
  const extractedRaw = text.slice(markerIndex + markerLength);
  const extracted = extractedRaw.replace(/^\r?\n/, "").replace(/^ /, "");
  return extracted.trim().length > 0 ? extracted : text;
}

function stripAgentPromptBlockFromTail(text: string): string {
  const match = AGENT_PROMPT_BLOCK_AT_TAIL_REGEX.exec(text);
  if (!match || typeof match.index !== "number" || match.index < 0) {
    return text;
  }
  const baseText = text.slice(0, match.index).replace(/\s+$/, "");
  return baseText || text;
}

function normalizeSelectedAgentName(value: unknown): string | null {
  const text = asString(value).trim();
  if (!text) {
    return null;
  }
  const normalized = text.replace(/^#+\s*/, "").trim();
  return normalized || null;
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
  return null;
}

function extractSelectedAgentNameFromPromptText(text: string): string | null {
  const match = AGENT_PROMPT_BLOCK_AT_TAIL_REGEX.exec(text);
  if (!match) {
    return null;
  }
  const tailText = match[1] ?? "";
  if (!tailText.trim()) {
    return null;
  }
  const firstLine =
    tailText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? null;
  return extractAgentNameFromPromptLine(firstLine);
}

function extractSelectedAgentIconFromPromptText(text: string): string | null {
  const match = AGENT_PROMPT_BLOCK_AT_TAIL_REGEX.exec(text);
  if (!match) {
    return null;
  }
  const tailText = match[1] ?? "";
  if (!tailText.trim()) {
    return null;
  }
  for (const line of tailText.split(/\r?\n/)) {
    const trimmedLine = line.trim();
    if (!trimmedLine) {
      continue;
    }
    const iconMatch = AGENT_PROMPT_ICON_LINE_REGEX.exec(trimmedLine);
    if (!iconMatch?.[1]) {
      continue;
    }
    const normalized = normalizeAgentIcon(iconMatch[1]);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function extractRawUserMessageTextCandidates(item: Record<string, unknown>): string[] {
  const candidates: string[] = [];
  const directText = asString(item.text);
  if (directText.trim()) {
    candidates.push(directText);
  }
  const content = Array.isArray(item.content) ? item.content : [];
  for (const entry of content) {
    const record = asRecord(entry);
    if (!record) {
      continue;
    }
    const text = asString(record.text ?? record.value ?? record.content ?? "");
    if (text.trim()) {
      candidates.push(text);
    }
  }
  return candidates;
}

function extractSelectedAgentNameFromUserMessageItem(
  item: Record<string, unknown>,
  text: string,
): string | null {
  const metadata = asRecord(item.metadata);
  const explicitNameCandidates: unknown[] = [
    item.selectedAgentName,
    item.selected_agent_name,
    item.agentName,
    item.agent_name,
    asRecord(item.selectedAgent)?.name,
    asRecord(item.selected_agent)?.name,
    metadata?.selectedAgentName,
    metadata?.selected_agent_name,
    metadata?.agentName,
    metadata?.agent_name,
  ];
  for (const candidate of explicitNameCandidates) {
    const normalized = normalizeSelectedAgentName(candidate);
    if (normalized) {
      return normalized;
    }
  }
  const promptTextCandidates = [text, ...extractRawUserMessageTextCandidates(item)];
  for (const candidate of promptTextCandidates) {
    const extracted = extractSelectedAgentNameFromPromptText(candidate);
    if (extracted) {
      return extracted;
    }
  }
  return null;
}

function extractSelectedAgentIconFromUserMessageItem(
  item: Record<string, unknown>,
  text: string,
): string | null {
  const metadata = asRecord(item.metadata);
  const explicitIconCandidates: unknown[] = [
    item.selectedAgentIcon,
    item.selected_agent_icon,
    item.agentIcon,
    item.agent_icon,
    asRecord(item.selectedAgent)?.icon,
    asRecord(item.selected_agent)?.icon,
    metadata?.selectedAgentIcon,
    metadata?.selected_agent_icon,
    metadata?.agentIcon,
    metadata?.agent_icon,
  ];
  for (const candidate of explicitIconCandidates) {
    const normalized = normalizeAgentIcon(candidate);
    if (normalized) {
      return normalized;
    }
  }
  const promptTextCandidates = [text, ...extractRawUserMessageTextCandidates(item)];
  for (const candidate of promptTextCandidates) {
    const extracted = extractSelectedAgentIconFromPromptText(candidate);
    if (extracted) {
      return extracted;
    }
  }
  return null;
}

function stripInjectedPrefixLines(text: string): string {
  let normalized = text.trimStart();
  while (TITLE_INJECTED_LINE_PREFIX_REGEX.test(normalized)) {
    normalized = normalized.replace(TITLE_INJECTED_LINE_PREFIX_REGEX, "").trimStart();
  }
  return normalized;
}

function clipByChars(text: string, maxChars: number): string {
  return Array.from(text).slice(0, maxChars).join("");
}

function normalizeUserMessageText(text: string): string {
  return stripSharedSessionContextSyncBlock(
    stripModeFallbackBlock(stripInjectedProjectMemoryBlock(text)),
  );
}

function collectUserMessageFallbackImages(item: Record<string, unknown>): string[] {
  const collect = (value: unknown): string[] => {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((entry) => {
        if (typeof entry === "string") {
          return entry.trim();
        }
        const record = asRecord(entry);
        if (!record) {
          return "";
        }
        return asString(
          record.url ??
            record.path ??
            record.src ??
            record.image ??
            record.imageUrl ??
            "",
        ).trim();
      })
      .filter(Boolean);
  };

  const direct = collect(item.images);
  if (direct.length > 0) {
    return direct;
  }
  const urlStyle = collect(item.imageUrls);
  if (urlStyle.length > 0) {
    return urlStyle;
  }
  return collect(item.image_urls);
}

function extractFallbackUserMessagePayload(item: Record<string, unknown>): {
  text: string;
  collaborationMode: "plan" | "code" | null;
  images: string[];
} {
  const contentRecord = asRecord(item.content);
  const rawTextCandidates: unknown[] = [
    item.text,
    item.inputText,
    item.input_text,
    item.prompt,
    item.message,
    typeof item.content === "string" ? item.content : null,
    contentRecord?.text,
    contentRecord?.value,
    contentRecord?.content,
  ];
  const fallbackImages = collectUserMessageFallbackImages(item);
  for (const candidate of rawTextCandidates) {
    if (typeof candidate !== "string") {
      continue;
    }
    const normalizedText = normalizeUserMessageText(candidate).trim();
    if (!normalizedText) {
      continue;
    }
    return {
      text: normalizedText,
      collaborationMode: extractModeFallbackMode(candidate),
      images: fallbackImages,
    };
  }
  return { text: "", collaborationMode: null, images: fallbackImages };
}

function parseUserInputs(inputs: Array<Record<string, unknown>>) {
  const textParts: string[] = [];
  const images: string[] = [];
  let collaborationMode: "plan" | "code" | null = null;

  const needsSeparatorBetween = (previous: string, next: string) => {
    if (!previous || !next) {
      return false;
    }
    if (/\s$/.test(previous) || /^\s/.test(next)) {
      return false;
    }
    if (/\$[^\s]+$/.test(previous.trimEnd())) {
      return true;
    }
    const previousChar = previous[previous.length - 1] ?? "";
    const nextChar = next[0] ?? "";
    return /[A-Za-z0-9]/.test(previousChar) && /[A-Za-z0-9]/.test(nextChar);
  };

  const appendTextPart = (value: string) => {
    if (!value) {
      return;
    }
    const previous = textParts[textParts.length - 1] ?? "";
    if (needsSeparatorBetween(previous, value)) {
      textParts.push(` ${value}`);
      return;
    }
    textParts.push(value);
  };

  const appendSkillPart = (name: string) => {
    if (!name) {
      return;
    }
    const token = `$${name}`;
    const previous = textParts[textParts.length - 1] ?? "";
    if (!previous) {
      textParts.push(token);
      return;
    }
    if (/\s$/.test(previous)) {
      textParts.push(token);
      return;
    }
    textParts.push(` ${token}`);
  };

  inputs.forEach((input) => {
    const type = asString(input.type);
    if (type === "text") {
      const text = asString(input.text);
      if (text) {
        collaborationMode = collaborationMode ?? extractModeFallbackMode(text);
        appendTextPart(normalizeUserMessageText(text));
      }
      return;
    }
    if (type === "skill") {
      const name = asString(input.name);
      appendSkillPart(name);
      return;
    }
    if (type === "image" || type === "localImage") {
      const value = extractImageInputValue(input);
      if (value) {
        images.push(value);
      }
    }
  });
  return {
    text: textParts.join("").trim(),
    images,
    collaborationMode,
  };
}

export function buildConversationItemFromThreadItem(
  item: Record<string, unknown>,
): ConversationItem | null {
  const type = asString(item.type);
  const id = asString(item.id);
  if (!id || !type) {
    return null;
  }
  if (type === "userMessage") {
    const content = Array.isArray(item.content) ? item.content : [];
    const {
      text,
      images,
      collaborationMode: fallbackCollaborationMode,
    } = parseUserInputs(content);
    const fallbackPayload = extractFallbackUserMessagePayload(item);
    const resolvedText = text || fallbackPayload.text;
    const resolvedImages = images.length > 0 ? images : fallbackPayload.images;
    const collaborationMode = extractCollaborationModeFromUserMessageItem(
      item,
      fallbackCollaborationMode ?? fallbackPayload.collaborationMode,
    );
    const selectedAgentName = extractSelectedAgentNameFromUserMessageItem(
      item,
      resolvedText,
    );
    const selectedAgentIcon = extractSelectedAgentIconFromUserMessageItem(
      item,
      resolvedText,
    );
    return {
      id,
      kind: "message",
      role: "user",
      text: resolvedText,
      images: resolvedImages.length > 0 ? resolvedImages : undefined,
      collaborationMode,
      selectedAgentName,
      selectedAgentIcon,
    };
  }
  if (type === "agentMessage") {
    const isFinal = extractAssistantFinalFlag(item);
    const finalCompletedAt = extractFinalCompletedAtMs(item);
    const finalDurationMs = extractFinalDurationMs(item);
    return {
      id,
      kind: "message",
      role: "assistant",
      text: asString(item.text),
      ...(typeof isFinal === "boolean" ? { isFinal } : {}),
      ...(typeof finalCompletedAt === "number" ? { finalCompletedAt } : {}),
      ...(typeof finalDurationMs === "number" ? { finalDurationMs } : {}),
    };
  }
  if (type === "reasoning") {
    const summary = extractReasoningText(item.summary ?? "");
    const contentFromItem = extractReasoningText(item.content ?? "");
    const content = contentFromItem || asString(item.text ?? "");
    const encryptedContent = asString(
      item.encrypted_content ?? item.encryptedContent ?? "",
    );
    if (!hasVisibleReasoningText(summary, content)) {
      if (!encryptedContent) {
        return null;
      }
      return { id, kind: "reasoning", summary: "Encrypted reasoning", content: "" };
    }
    return { id, kind: "reasoning", summary, content };
  }
  return buildConversationItem(item);
}

export function buildItemsFromThread(thread: Record<string, unknown>) {
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  const items: ConversationItem[] = [];
  turns.forEach((turn) => {
    const turnRecord = turn as Record<string, unknown>;
    const turnCompletedAtMs =
      parseTimestampLikeMs(
        turnRecord.completedAt ??
          turnRecord.completed_at ??
          turnRecord.updatedAt ??
          turnRecord.updated_at ??
          turnRecord.createdAt ??
          turnRecord.created_at ??
          null,
      );
    const turnDurationMsRaw = asNumber(
      turnRecord.durationMs ??
        turnRecord.duration_ms ??
        turnRecord.duration ??
        null,
    );
    const turnDurationMs = turnDurationMsRaw !== null && turnDurationMsRaw >= 0
      ? turnDurationMsRaw
      : undefined;
    const turnItems = Array.isArray(turnRecord.items)
      ? (turnRecord.items as Record<string, unknown>[])
      : [];
    let lastAssistantMessageIndexInTurn = -1;
    let finalAssistantMessageIndexInTurn = -1;
    let hasExplicitFinalAssistantInTurn = false;
    let turnStartedAtMs: number | undefined;
    const assistantTimestampByIndex = new Map<number, number>();
    turnItems.forEach((item) => {
      const itemRecord = item as Record<string, unknown>;
      const converted = buildConversationItemFromThreadItem(itemRecord);
      if (converted) {
        const convertedIndex = items.length;
        const itemTimestampMs = extractHistoryItemTimestampMs(itemRecord);
        if (
          converted.kind === "message" &&
          converted.role === "user" &&
          typeof itemTimestampMs === "number"
        ) {
          turnStartedAtMs = itemTimestampMs;
        }
        if (converted.kind === "message" && converted.role === "assistant") {
          if (converted.isFinal === true) {
            hasExplicitFinalAssistantInTurn = true;
            finalAssistantMessageIndexInTurn = convertedIndex;
          }
          lastAssistantMessageIndexInTurn = convertedIndex;
          if (typeof itemTimestampMs === "number") {
            assistantTimestampByIndex.set(convertedIndex, itemTimestampMs);
          }
        }
        if (converted.kind === "reasoning") {
          const duplicateIndex = findDuplicateReasoningSnapshotIndex(items, converted);
          if (duplicateIndex >= 0 && items[duplicateIndex]?.kind === "reasoning") {
            items[duplicateIndex] = mergeReasoningSnapshot(
              items[duplicateIndex] as Extract<ConversationItem, { kind: "reasoning" }>,
              converted,
            );
            return;
          }
        }
        items.push(converted);
      }
    });
    if (!hasExplicitFinalAssistantInTurn && lastAssistantMessageIndexInTurn >= 0) {
      const lastAssistant = items[lastAssistantMessageIndexInTurn];
      if (
        lastAssistant &&
        lastAssistant.kind === "message" &&
        lastAssistant.role === "assistant" &&
        lastAssistant.isFinal !== true
      ) {
        items[lastAssistantMessageIndexInTurn] = {
          ...lastAssistant,
          isFinal: true,
        };
        finalAssistantMessageIndexInTurn = lastAssistantMessageIndexInTurn;
      }
    }
    if (finalAssistantMessageIndexInTurn >= 0) {
      const finalAssistant = items[finalAssistantMessageIndexInTurn];
      if (finalAssistant && finalAssistant.kind === "message" && finalAssistant.role === "assistant") {
        const completedAtCandidates = [
          finalAssistant.finalCompletedAt,
          assistantTimestampByIndex.get(finalAssistantMessageIndexInTurn),
          turnCompletedAtMs,
        ].filter((value): value is number => typeof value === "number" && value > 0);
        const completedAt =
          completedAtCandidates.length > 0 ? Math.max(...completedAtCandidates) : undefined;
        const durationCandidates = [
          finalAssistant.finalDurationMs,
          turnDurationMs,
          typeof completedAt === "number" && typeof turnStartedAtMs === "number"
            ? Math.max(0, completedAt - turnStartedAtMs)
            : undefined,
        ].filter((value): value is number => typeof value === "number" && value >= 0);
        const durationMs =
          durationCandidates.length > 0 ? Math.max(...durationCandidates) : undefined;
        if (
          completedAt !== finalAssistant.finalCompletedAt ||
          durationMs !== finalAssistant.finalDurationMs
        ) {
          items[finalAssistantMessageIndexInTurn] = {
            ...finalAssistant,
            ...(typeof completedAt === "number" ? { finalCompletedAt: completedAt } : {}),
            ...(typeof durationMs === "number" ? { finalDurationMs: durationMs } : {}),
          };
        }
      }
    }
  });
  return items;
}

export function isReviewingFromThread(thread: Record<string, unknown>) {
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  let reviewing = false;
  turns.forEach((turn) => {
    const turnRecord = turn as Record<string, unknown>;
    const turnItems = Array.isArray(turnRecord.items)
      ? (turnRecord.items as Record<string, unknown>[])
      : [];
    turnItems.forEach((item) => {
      const type = asString(item?.type ?? "");
      if (type === "enteredReviewMode") {
        reviewing = true;
      } else if (type === "exitedReviewMode") {
        reviewing = false;
      }
    });
  });
  return reviewing;
}

function chooseRicherItem(remote: ConversationItem, local: ConversationItem) {
  if (remote.kind !== local.kind) {
    return remote;
  }
  if (remote.kind === "message" && local.kind === "message") {
    if (remote.role !== local.role) {
      return remote;
    }
    const withFinalFlag = (
      candidate: Extract<ConversationItem, { kind: "message" }>,
    ): Extract<ConversationItem, { kind: "message" }> => {
      if (candidate.role !== "assistant") {
        return candidate;
      }
      const isFinal = Boolean(candidate.isFinal || remote.isFinal || local.isFinal);
      const completedAtCandidates = [
        candidate.finalCompletedAt,
        remote.finalCompletedAt,
        local.finalCompletedAt,
      ].filter((value): value is number => typeof value === "number" && value > 0);
      const mergedCompletedAt =
        completedAtCandidates.length > 0 ? Math.max(...completedAtCandidates) : undefined;
      const durationCandidates = [
        candidate.finalDurationMs,
        remote.finalDurationMs,
        local.finalDurationMs,
      ].filter((value): value is number => typeof value === "number" && value >= 0);
      const mergedDurationMs =
        durationCandidates.length > 0 ? Math.max(...durationCandidates) : undefined;
      if (
        (candidate.isFinal ?? false) === isFinal &&
        candidate.finalCompletedAt === mergedCompletedAt &&
        candidate.finalDurationMs === mergedDurationMs
      ) {
        return candidate;
      }
      return {
        ...candidate,
        isFinal,
        ...(mergedCompletedAt !== undefined ? { finalCompletedAt: mergedCompletedAt } : {}),
        ...(mergedDurationMs !== undefined ? { finalDurationMs: mergedDurationMs } : {}),
      };
    };
    if (remote.role !== "assistant") {
      return local.text.length > remote.text.length ? local : remote;
    }
    const remoteScored = scoreAssistantMessageReadability(remote.text);
    const localScored = scoreAssistantMessageReadability(local.text);
    if (localScored.score < remoteScored.score) {
      return withFinalFlag({ ...local, text: localScored.normalized });
    }
    if (remoteScored.score < localScored.score) {
      return withFinalFlag({ ...remote, text: remoteScored.normalized });
    }
    if (
      compactMessageText(remoteScored.normalized) ===
      compactMessageText(localScored.normalized)
    ) {
      return localScored.normalized.length >= remoteScored.normalized.length
        ? withFinalFlag({ ...local, text: localScored.normalized })
        : withFinalFlag({ ...remote, text: remoteScored.normalized });
    }
    return localScored.normalized.length > remoteScored.normalized.length
      ? withFinalFlag({ ...local, text: localScored.normalized })
      : withFinalFlag({ ...remote, text: remoteScored.normalized });
  }
  if (remote.kind === "reasoning" && local.kind === "reasoning") {
    const remoteLength = remote.summary.length + remote.content.length;
    const localLength = local.summary.length + local.content.length;
    return localLength > remoteLength ? local : remote;
  }
  if (remote.kind === "tool" && local.kind === "tool") {
    const remoteLength = (remote.output ?? "").length;
    const localLength = (local.output ?? "").length;
    const base = localLength > remoteLength ? local : remote;
    return {
      ...base,
      status: remote.status ?? local.status,
      output: localLength > remoteLength ? local.output : remote.output,
      changes: mergeToolChanges(remote.changes, local.changes),
    };
  }
  if (remote.kind === "diff" && local.kind === "diff") {
    const useLocal = local.diff.length > remote.diff.length;
    return {
      ...remote,
      diff: useLocal ? local.diff : remote.diff,
      status: remote.status ?? local.status,
    };
  }
  return remote;
}

export function mergeThreadItems(
  remoteItems: ConversationItem[],
  localItems: ConversationItem[],
) {
  if (!localItems.length) {
    return remoteItems;
  }
  const remoteIds = new Set(remoteItems.map((item) => item.id));
  const localById = new Map(localItems.map((item) => [item.id, item]));
  const merged = remoteItems.map((item) => {
    const local = localById.get(item.id);
    return local ? chooseRicherItem(item, local) : item;
  });
  localItems.forEach((item) => {
    if (!remoteIds.has(item.id)) {
      merged.push(item);
    }
  });
  return merged;
}
