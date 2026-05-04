import type { ConversationItem, RequestUserInputRequest } from "../../../types";
import {
  extractClaudeApprovalResumeEntries,
  stripClaudeApprovalResumeArtifacts,
} from "../../../utils/threadItems";
import type { HistoryLoader } from "../contracts/conversationCurtainContracts";
import { normalizeHistorySnapshot } from "../contracts/conversationCurtainContracts";
import {
  areEquivalentReasoningTexts,
  compactComparableConversationText,
} from "../assembly/conversationNormalization";
import { computeDiff } from "../../messages/utils/diffUtils";
import { asString } from "./historyLoaderUtils";

type ClaudeHistoryLoaderOptions = {
  workspaceId: string;
  workspacePath: string | null;
  loadClaudeSession: (
    workspacePath: string,
    sessionId: string,
  ) => Promise<unknown>;
};

type AskUserQuestionOption = {
  label: string;
  description: string;
};

type AskUserQuestionTemplate = {
  id: string;
  header: string;
  question: string;
  isOther: boolean;
  multiSelect: boolean;
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

type RequestUserInputSubmittedPayload = {
  schema: "requestUserInputSubmitted/v1";
  submittedAt: number;
  questions: Array<{
    id: string;
    header: string;
    question: string;
    options?: AskUserQuestionOption[];
    selectedOptions: string[];
    note: string;
  }>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function isReasoningSnapshotDuplicate(previous: string, incoming: string) {
  return areEquivalentReasoningTexts(previous, incoming);
}

function preferLongerReasoningText(previous: string, incoming: string) {
  const previousCompactLength = compactComparableConversationText(previous).length;
  const incomingCompactLength = compactComparableConversationText(incoming).length;
  return incomingCompactLength >= previousCompactLength ? incoming : previous;
}

function getClaudeToolName(message: Record<string, unknown>) {
  return asString(message.tool_name ?? message.toolName ?? message.title ?? "Tool");
}

function getClaudeToolInputText(message: Record<string, unknown>) {
  const toolInput = getClaudeToolInputRecord(message);
  if (toolInput && Object.keys(toolInput).length > 0) {
    return JSON.stringify(toolInput);
  }
  return "";
}

function getClaudeToolOutputText(message: Record<string, unknown>) {
  const toolOutput = getClaudeToolOutputRecord(message);
  return asString(
    toolOutput?.output ??
      toolOutput?.stdout ??
      toolOutput?.stderr ??
      message.text ??
      "",
  );
}

function extractImageList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const images: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const normalized = asString(entry).trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    images.push(normalized);
  }
  return images;
}

function parseToolRecordCandidate(value: unknown): Record<string, unknown> | null {
  const direct = asRecord(value);
  if (direct) {
    return direct;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return asRecord(parsed);
  } catch {
    return null;
  }
}

function getClaudeSourceToolId(message: Record<string, unknown>) {
  const directCandidates = [
    message.source_tool_id,
    message.sourceToolId,
    message.source_tool_call_id,
    message.sourceToolCallId,
    message.tool_use_id,
    message.toolUseId,
    message.call_id,
    message.callId,
    message.parent_tool_id,
    message.parentToolId,
    message.parent_id,
    message.parentId,
  ];
  for (const candidate of directCandidates) {
    const resolved = asString(candidate).trim();
    if (resolved) {
      return resolved;
    }
  }

  const nestedSources = [
    message.tool_output,
    message.output,
    message.result,
    message.meta,
    message.metadata,
  ];
  for (const source of nestedSources) {
    if (!source || typeof source !== "object") {
      continue;
    }
    const record = source as Record<string, unknown>;
    const nestedCandidates = [
      record.source_tool_id,
      record.sourceToolId,
      record.source_tool_call_id,
      record.sourceToolCallId,
      record.tool_use_id,
      record.toolUseId,
      record.call_id,
      record.callId,
      record.parent_tool_id,
      record.parentToolId,
      record.parent_id,
      record.parentId,
    ];
    for (const candidate of nestedCandidates) {
      const resolved = asString(candidate).trim();
      if (resolved) {
        return resolved;
      }
    }
  }

  const toolId = asString(message.id ?? "").trim();
  if (!toolId) {
    return "";
  }

  const suffixes = ["-result", ":result", "_result", ".result", "/result"];
  for (const suffix of suffixes) {
    if (toolId.endsWith(suffix) && toolId.length > suffix.length) {
      return toolId.slice(0, -suffix.length);
    }
  }
  return "";
}

function getClaudeToolInputRecord(message: Record<string, unknown>) {
  const candidates = [
    message.toolInput,
    message.tool_input,
    message.input,
    message.arguments,
    message.params,
    asRecord(message.meta)?.input,
    asRecord(message.metadata)?.input,
  ];
  for (const candidate of candidates) {
    const record = parseToolRecordCandidate(candidate);
    if (record && Object.keys(record).length > 0) {
      return record;
    }
  }
  return null;
}

function getClaudeToolOutputRecord(message: Record<string, unknown>) {
  const candidates = [
    message.toolOutput,
    message.tool_output,
    message.output,
    message.result,
    asRecord(message.meta)?.output,
    asRecord(message.metadata)?.output,
  ];
  for (const candidate of candidates) {
    const record = parseToolRecordCandidate(candidate);
    if (record && Object.keys(record).length > 0) {
      return record;
    }
  }
  return null;
}

function parseAskUserQuestionTemplates(
  toolInput: Record<string, unknown> | null,
): AskUserQuestionTemplate[] {
  if (!toolInput) {
    return [];
  }
  const hasSingleQuestionShape =
    "question" in toolInput ||
    "prompt" in toolInput ||
    "header" in toolInput ||
    "title" in toolInput ||
    "options" in toolInput;
  const rawQuestions = Array.isArray(toolInput.questions)
    ? toolInput.questions
    : hasSingleQuestionShape
      ? [toolInput]
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
    const isOther =
      question.isOther === undefined && question.is_other === undefined
        ? true
        : Boolean(question.isOther ?? question.is_other);
    const multiSelect = Boolean(question.multiSelect ?? question.multi_select);
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
      isOther,
      multiSelect,
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

function parseAskUserQuestionAnswerText(
  text: string,
  questionCount: number,
): AskUserQuestionAnswerParseResult | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const dismissedRegex =
    /^The user dismissed the question without selecting an option\.?$/i;
  if (dismissedRegex.test(trimmed)) {
    return {
      rawSelectionText: "",
      answers: Array.from({ length: Math.max(questionCount, 1) }, () => ({
        selectedOptions: [],
        note: "",
      })),
    };
  }

  const answeredMatch = trimmed.match(
    /^The user answered the AskUserQuestion:\s*([\s\S]*?)(?:[。.]?\s*Please continue based on this selection\.?)$/i,
  );
  if (!answeredMatch) {
    return null;
  }
  const rawSelectionText = (answeredMatch[1] ?? "").trim();
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
  if (questionCount <= 1) {
    return {
      rawSelectionText,
      answers: [parseAskUserAnswerParts(rawSelectionText)],
    };
  }

  const normalizedSegments = [...baseSegments];
  if (normalizedSegments.length > questionCount) {
    const remaining = normalizedSegments
      .splice(questionCount - 1)
      .join("; ")
      .trim();
    normalizedSegments.push(remaining);
  }
  while (normalizedSegments.length < questionCount) {
    normalizedSegments.push("");
  }

  return {
    rawSelectionText,
    answers: normalizedSegments.map((segment) => parseAskUserAnswerParts(segment)),
  };
}

function buildRequestUserInputSubmittedPayload(
  templates: AskUserQuestionTemplate[],
  answers: AskUserQuestionAnswer[],
): RequestUserInputSubmittedPayload {
  return {
    schema: "requestUserInputSubmitted/v1",
    submittedAt: Date.now(),
    questions: templates.map((template, index) => ({
      id: template.id || `q-${index}`,
      header: template.header,
      question: template.question,
      options: template.options,
      selectedOptions: answers[index]?.selectedOptions ?? [],
      note: answers[index]?.note ?? "",
    })),
  };
}

function normalizeClaudeToolName(toolName: string) {
  return toolName.trim().toLowerCase();
}

const CLAUDE_FILE_PATH_KEYS = [
  "file_path",
  "filePath",
  "filepath",
  "path",
  "target_file",
  "targetFile",
  "filename",
  "file",
  "notebook_path",
  "notebookPath",
];

function getFirstStringFieldFromRecords(
  records: Array<Record<string, unknown> | null>,
  keys: string[],
) {
  for (const record of records) {
    if (!record) {
      continue;
    }
    for (const key of keys) {
      const value = asString(record[key]).trim();
      if (value) {
        return value;
      }
    }
  }
  return "";
}

function buildUnifiedDiff(oldText: string, newText: string) {
  const diff = computeDiff(oldText, newText);
  const oldLines = oldText ? oldText.split("\n").length : 0;
  const newLines = newText ? newText.split("\n").length : 0;
  const header = `@@ -1,${oldLines} +1,${newLines} @@`;
  const body = diff.lines
    .map((line) => {
      if (line.type === "added") {
        return `+${line.content}`;
      }
      if (line.type === "deleted") {
        return `-${line.content}`;
      }
      return ` ${line.content}`;
    })
    .join("\n");
  return body ? `${header}\n${body}` : header;
}

function inferClaudeFileChange(
  toolName: string,
  message: Record<string, unknown>,
): { toolType: string; changes: NonNullable<Extract<ConversationItem, { kind: "tool" }>["changes"]> } | null {
  const normalizedToolName = normalizeClaudeToolName(toolName);
  const isWriteLike =
    normalizedToolName === "write" || normalizedToolName === "write_file";
  const isEditLike =
    normalizedToolName === "edit" || normalizedToolName === "edit_file";
  const isDeleteLike =
    normalizedToolName === "delete" ||
    normalizedToolName === "delete_file" ||
    normalizedToolName === "remove" ||
    normalizedToolName === "remove_file" ||
    normalizedToolName === "unlink";
  if (!isWriteLike && !isEditLike && !isDeleteLike) {
    return null;
  }

  const toolInput = getClaudeToolInputRecord(message);
  const toolOutput = getClaudeToolOutputRecord(message);
  const filePath = getFirstStringFieldFromRecords(
    [toolOutput, toolInput],
    CLAUDE_FILE_PATH_KEYS,
  );
  if (!filePath) {
    return null;
  }

  if (isWriteLike) {
    const content = asString(toolOutput?.content ?? toolInput?.content ?? "");
    const diff = content ? buildUnifiedDiff("", content) : "";
    return {
      toolType: "fileChange",
      changes: [{ path: filePath, kind: "add", diff }],
    };
  }

  if (isDeleteLike) {
    const oldText = asString(
      toolOutput?.oldString ??
        toolOutput?.old_string ??
        toolOutput?.originalFile ??
        toolOutput?.content ??
        toolInput?.old_string ??
        "",
    );
    const diff = oldText ? buildUnifiedDiff(oldText, "") : "";
    return {
      toolType: "fileChange",
      changes: [{ path: filePath, kind: "delete", diff }],
    };
  }

  const oldText = asString(
    toolOutput?.oldString ?? toolOutput?.originalFile ?? toolInput?.old_string ?? "",
  );
  const newText = asString(toolOutput?.newString ?? toolInput?.new_string ?? "");
  const diff = oldText || newText ? buildUnifiedDiff(oldText, newText) : "";
  return {
    toolType: "fileChange",
    changes: [{ path: filePath, kind: "modified", diff }],
  };
}

function findLatestPendingToolIndex(items: ConversationItem[]) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const entry = items[index];
    if (entry?.kind !== "tool") {
      continue;
    }
    if (entry.status === "completed" || entry.status === "failed") {
      continue;
    }
    return index;
  }
  return -1;
}

function mergeReasoningSnapshot(
  items: ConversationItem[],
  id: string,
  text: string,
) {
  const normalizedText = text.trim();
  if (!normalizedText) {
    return;
  }
  const byIdIndex = items.findIndex(
    (item) => item.kind === "reasoning" && item.id === id,
  );
  if (byIdIndex >= 0) {
    const existing = items[byIdIndex];
    if (existing?.kind === "reasoning") {
      const nextText = preferLongerReasoningText(existing.content, normalizedText);
      items[byIdIndex] = {
        ...existing,
        summary: nextText.slice(0, 100),
        content: nextText,
      };
    }
    return;
  }
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const candidate = items[index];
    if (candidate?.kind === "message" && candidate.role === "user") {
      break;
    }
    if (candidate?.kind !== "reasoning") {
      continue;
    }
    if (!isReasoningSnapshotDuplicate(candidate.content, normalizedText)) {
      continue;
    }
    const nextText = preferLongerReasoningText(candidate.content, normalizedText);
    items[index] = {
      ...candidate,
      summary: nextText.slice(0, 100),
      content: nextText,
    };
    return;
  }
  items.push({
    id,
    kind: "reasoning",
    summary: normalizedText.slice(0, 100),
    content: normalizedText,
  });
}

function asBooleanFlag(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
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
  return undefined;
}

function parseHistoryTimestampMs(value: unknown): number | undefined {
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

function extractClaudeAssistantFinalFlag(message: Record<string, unknown>): boolean | undefined {
  const metadata =
    message.metadata && typeof message.metadata === "object" && !Array.isArray(message.metadata)
      ? (message.metadata as Record<string, unknown>)
      : null;
  const candidates: unknown[] = [
    message.isFinal,
    message.is_final,
    message.final,
    message.isFinalMessage,
    message.is_final_message,
  ];
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
    const parsed = asBooleanFlag(candidate);
    if (typeof parsed === "boolean") {
      return parsed;
    }
  }
  return undefined;
}

function markClaudeAssistantFinalMessages(items: ConversationItem[]) {
  let lastAssistantIndexInTurn = -1;
  let hasExplicitFinalAssistantInTurn = false;
  const finalizeCurrentTurn = () => {
    if (hasExplicitFinalAssistantInTurn || lastAssistantIndexInTurn < 0) {
      return;
    }
    const lastAssistant = items[lastAssistantIndexInTurn];
    if (!lastAssistant || lastAssistant.kind !== "message" || lastAssistant.role !== "assistant") {
      return;
    }
    if (lastAssistant.isFinal === true) {
      return;
    }
    items[lastAssistantIndexInTurn] = {
      ...lastAssistant,
      isFinal: true,
    };
  };

  items.forEach((item, index) => {
    if (item.kind === "message" && item.role === "user") {
      finalizeCurrentTurn();
      lastAssistantIndexInTurn = -1;
      hasExplicitFinalAssistantInTurn = false;
      return;
    }
    if (item.kind === "message" && item.role === "assistant") {
      if (item.isFinal === true) {
        hasExplicitFinalAssistantInTurn = true;
      }
      lastAssistantIndexInTurn = index;
    }
  });

  finalizeCurrentTurn();
}

function hydrateClaudeAssistantFinalTiming(
  items: ConversationItem[],
  messageTimestampById: Map<string, number>,
) {
  let turnStartedAtMs: number | undefined;
  items.forEach((item, index) => {
    if (item.kind !== "message") {
      return;
    }
    if (item.role === "user") {
      turnStartedAtMs = messageTimestampById.get(item.id);
      return;
    }
    if (item.isFinal !== true) {
      return;
    }
    const completedAtMs = messageTimestampById.get(item.id);
    const durationMs =
      typeof completedAtMs === "number" && typeof turnStartedAtMs === "number"
        ? Math.max(0, completedAtMs - turnStartedAtMs)
        : undefined;
    if (typeof completedAtMs !== "number" && typeof durationMs !== "number") {
      return;
    }
    items[index] = {
      ...item,
      ...(typeof completedAtMs === "number"
        ? { finalCompletedAt: completedAtMs }
        : {}),
      ...(typeof durationMs === "number" ? { finalDurationMs: durationMs } : {}),
    };
  });
}

function inferSyntheticApprovalChangeKind(summary: string) {
  const normalized = summary.trim().toLowerCase();
  if (normalized.includes("deleted ") || normalized.includes("removed ")) {
    return "delete" as const;
  }
  if (
    normalized.includes("created ") ||
    normalized.includes("added ") ||
    normalized.includes("wrote ")
  ) {
    return "add" as const;
  }
  return "modified" as const;
}

function parseSyntheticApprovalResumeItems(
  text: string,
  itemIdPrefix: string,
): ConversationItem[] {
  const structuredEntries = extractClaudeApprovalResumeEntries(text);
  if (structuredEntries.length > 0) {
    return structuredEntries.map((entry, index) => ({
      id: `${itemIdPrefix}-approval-${index + 1}`,
      kind: "tool",
      toolType: "fileChange",
      title: "Approved file change",
      detail: entry.summary,
      status:
        entry.status === "failed"
          ? "failed"
          : entry.status === "pending"
            ? "pending"
            : "completed",
      output: entry.summary,
      changes: entry.path
        ? [
            {
              path: entry.path,
              kind:
                entry.kind === "add" ||
                entry.kind === "modified" ||
                entry.kind === "delete"
                  ? entry.kind
                  : "modified",
            },
          ]
        : undefined,
    }));
  }
  const trimmed = text.trim();
  if (!trimmed.startsWith("Completed approved operations:")) {
    return [];
  }
  const summaryLines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "));
  if (summaryLines.length === 0) {
    return [];
  }
  return summaryLines.map((line, index) => {
    const summary = line.slice(2).trim();
    const pathMatch = summary.match(
      /(?:wrote|created|updated|modified|deleted|removed|renamed)\s+(.+)$/i,
    );
    const filePath = (pathMatch?.[1] ?? "").trim();
    return {
      id: `${itemIdPrefix}-approval-${index + 1}`,
      kind: "tool",
      toolType: "fileChange",
      title: "Approved file change",
      detail: summary,
      status: "completed",
      output: summary,
      changes: filePath
        ? [{ path: filePath, kind: inferSyntheticApprovalChangeKind(summary) }]
        : undefined,
    } satisfies Extract<ConversationItem, { kind: "tool" }>;
  });
}

function shouldSkipSyntheticApprovalResumePrompt(
  role: "user" | "assistant",
  text: string,
) {
  if (role !== "user") {
    return false;
  }
  if (extractClaudeApprovalResumeEntries(text).length > 0) {
    return true;
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  if (
    /Please continue from the current workspace state and finish the original task\.\s*$/i.test(
      trimmed,
    ) &&
    (trimmed.startsWith("Completed approved operations:") ||
      /^Approved and (?:wrote|updated|created|deleted|removed)\b/i.test(trimmed))
  ) {
    return true;
  }
  return false;
}

export function parseClaudeHistoryMessages(messagesData: unknown): ConversationItem[] {
  const items: ConversationItem[] = [];
  const messageTimestampById = new Map<string, number>();
  const toolIndexById = new Map<string, number>();
  const pendingAskToolIds: string[] = [];
  const askTemplatesByToolId = new Map<string, AskUserQuestionTemplate[]>();

  const appendSubmittedAskUserInput = (
    toolId: string,
    parseResult: AskUserQuestionAnswerParseResult,
  ) => {
    const templates = askTemplatesByToolId.get(toolId) ?? [];
    if (templates.length === 0) {
      return;
    }
    const detail = JSON.stringify(
      buildRequestUserInputSubmittedPayload(templates, parseResult.answers),
    );
    const submittedItemId = `request-user-input-submitted-${toolId}`;
    if (items.some((item) => item.id === submittedItemId)) {
      return;
    }
    items.push({
      id: submittedItemId,
      kind: "tool",
      toolType: "requestUserInputSubmitted",
      title: "请求输入",
      detail,
      status: "completed",
      output: parseResult.rawSelectionText,
    });
  };

  const markAskToolCompleted = (toolId: string, output?: string) => {
    const index = toolIndexById.get(toolId);
    if (index === undefined) {
      return;
    }
    const existing = items[index];
    if (!existing || existing.kind !== "tool") {
      return;
    }
    items[index] = {
      ...existing,
      status: "completed",
      output: output || existing.output,
    };
  };

  const removePendingAskTool = (toolId: string) => {
    if (!toolId) {
      return;
    }
    const index = pendingAskToolIds.findIndex((candidate) => candidate === toolId);
    if (index >= 0) {
      pendingAskToolIds.splice(index, 1);
    }
  };

  const peekPendingAskTool = () => {
    while (pendingAskToolIds.length > 0) {
      const toolId = pendingAskToolIds[0] ?? "";
      if (!toolId || !askTemplatesByToolId.has(toolId)) {
        pendingAskToolIds.shift();
        continue;
      }
      return toolId;
    }
    return "";
  };

  const messages = Array.isArray(messagesData)
    ? (messagesData as Array<Record<string, unknown>>)
    : [];
  for (const message of messages) {
    const kind = asString(message.kind ?? "");
    if (kind === "message") {
      const role = asString(message.role) === "user" ? "user" : "assistant";
      const text = asString(message.text ?? "");
      if (shouldSkipSyntheticApprovalResumePrompt(role, text)) {
        continue;
      }
      const images = extractImageList(message.images);
      const itemId = asString(message.id ?? `claude-message-${items.length + 1}`);
      const timestampMs = parseHistoryTimestampMs(message.timestamp);
      if (role === "user") {
        const pendingAskToolId = peekPendingAskTool();
        if (pendingAskToolId) {
          const templates = askTemplatesByToolId.get(pendingAskToolId) ?? [];
          const parsedAnswer = parseAskUserQuestionAnswerText(text, templates.length);
          if (parsedAnswer) {
            pendingAskToolIds.shift();
            markAskToolCompleted(pendingAskToolId, parsedAnswer.rawSelectionText);
            appendSubmittedAskUserInput(pendingAskToolId, parsedAnswer);
            continue;
          }
        }
      }
      const assistantFinalFlag =
        role === "assistant"
          ? extractClaudeAssistantFinalFlag(message)
          : undefined;
      if (role === "assistant") {
        const syntheticApprovalItems = parseSyntheticApprovalResumeItems(text, itemId);
        if (syntheticApprovalItems.length > 0) {
          items.push(...syntheticApprovalItems);
          continue;
        }
      }
      const normalizedMessageText =
        role === "assistant" ? stripClaudeApprovalResumeArtifacts(text) : text;
      if (role === "assistant" && !normalizedMessageText && images.length === 0) {
        continue;
      }
      if (typeof timestampMs === "number") {
        messageTimestampById.set(itemId, timestampMs);
      }
      items.push({
        id: itemId,
        kind: "message",
        role,
        text: normalizedMessageText,
        images: images.length > 0 ? images : undefined,
        ...(typeof assistantFinalFlag === "boolean"
          ? { isFinal: assistantFinalFlag }
          : {}),
      });
      continue;
    }
    if (kind === "reasoning") {
      const text = asString(message.text ?? "");
      mergeReasoningSnapshot(
        items,
        asString(message.id ?? `claude-reasoning-${items.length + 1}`),
        text,
      );
      continue;
    }
    if (kind !== "tool") {
      continue;
    }

    const toolId = asString(message.id ?? "");
    const toolType = asString(message.toolType ?? message.tool_name ?? "unknown");
    const isToolResult = toolType === "result" || toolType === "error";
    const status = toolType === "error" ? "failed" : "completed";
    if (isToolResult) {
      const sourceToolId = getClaudeSourceToolId(message);
      const sourceIndex = sourceToolId
        ? toolIndexById.get(sourceToolId)
        : toolId
          ? toolIndexById.get(toolId)
          : undefined;
      const outputText = getClaudeToolOutputText(message);
      if (sourceIndex !== undefined) {
        const existing = items[sourceIndex];
        if (existing?.kind === "tool") {
          items[sourceIndex] = {
            ...existing,
            status,
            output: outputText || existing.output,
          };
          const sourceToolType = normalizeClaudeToolName(existing.toolType);
          if (sourceToolType === "askuserquestion" || sourceToolType === "ask_user_question") {
            removePendingAskTool(existing.id);
            const templates = askTemplatesByToolId.get(existing.id) ?? [];
            const parsedAnswer = parseAskUserQuestionAnswerText(outputText, templates.length);
            if (parsedAnswer) {
              appendSubmittedAskUserInput(existing.id, parsedAnswer);
            }
          }
        }
        continue;
      }
      const pendingToolIndex = findLatestPendingToolIndex(items);
      if (pendingToolIndex >= 0) {
        const existing = items[pendingToolIndex];
        if (existing?.kind === "tool") {
          items[pendingToolIndex] = {
            ...existing,
            status,
            output: outputText || existing.output,
          };
          continue;
        }
      }
      const fallbackId = sourceToolId || toolId || `claude-tool-${items.length + 1}`;
      items.push({
        id: fallbackId,
        kind: "tool",
        toolType,
        title: getClaudeToolName(message),
        detail: "",
        status,
        output: outputText,
      });
      continue;
    }

    const toolName = getClaudeToolName(message);
    const normalizedToolName = normalizeClaudeToolName(toolName);
    const normalizedToolType = normalizeClaudeToolName(toolType);
    const isAskUserQuestion =
      normalizedToolName === "askuserquestion" ||
      normalizedToolType === "askuserquestion" ||
      normalizedToolType === "ask_user_question";
    const resolvedToolId = toolId || `claude-tool-${items.length + 1}`;
    const parsedFileChange = inferClaudeFileChange(toolName, message);
    items.push({
      id: resolvedToolId,
      kind: "tool",
      toolType: parsedFileChange?.toolType ?? toolType,
      title: toolName,
      detail: getClaudeToolInputText(message) || asString(message.text ?? ""),
      status: "started",
      changes: parsedFileChange?.changes,
    });
    if (resolvedToolId) {
      toolIndexById.set(resolvedToolId, items.length - 1);
    }
    if (isAskUserQuestion) {
      pendingAskToolIds.push(resolvedToolId);
      askTemplatesByToolId.set(
        resolvedToolId,
        parseAskUserQuestionTemplates(getClaudeToolInputRecord(message)),
      );
    }
  }

  for (const pendingToolId of pendingAskToolIds) {
    const index = toolIndexById.get(pendingToolId);
    if (index === undefined || index >= items.length - 1) {
      continue;
    }
    const existing = items[index];
    if (!existing || existing.kind !== "tool") {
      continue;
    }
    if (existing.status === "completed" || existing.status === "failed") {
      continue;
    }
    items[index] = {
      ...existing,
      status: "completed",
    };
  }

  markClaudeAssistantFinalMessages(items);
  hydrateClaudeAssistantFinalTiming(items, messageTimestampById);

  return items;
}

function extractPendingUserInputQueueFromClaudeItems(
  items: ConversationItem[],
  workspaceId: string,
  threadId: string,
): RequestUserInputRequest[] {
  const queue: RequestUserInputRequest[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    if (item.kind !== "tool") {
      continue;
    }
    const normalizedToolType = normalizeClaudeToolName(item.toolType);
    if (
      normalizedToolType !== "askuserquestion" &&
      normalizedToolType !== "ask_user_question"
    ) {
      continue;
    }
    if (item.status === "completed" || item.status === "failed") {
      continue;
    }
    const templates = parseAskUserQuestionTemplates(parseToolRecordCandidate(item.detail));
    if (templates.length === 0) {
      continue;
    }
    const requestId = item.id.trim() || `claude-ask-${queue.length + 1}`;
    const dedupeKey = `${workspaceId}:${requestId}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    queue.push({
      workspace_id: workspaceId,
      request_id: requestId,
      params: {
        thread_id: threadId,
        turn_id: "",
        item_id: item.id.trim() || `request-${requestId}`,
        questions: templates.map((template, index) => ({
          id: template.id || `q-${index}`,
          header: template.header,
          question: template.question,
          isOther: template.isOther,
          isSecret: false,
          ...(template.multiSelect ? { multiSelect: true } : {}),
          options: template.options,
        })),
      },
    });
  }

  return queue;
}

export function createClaudeHistoryLoader({
  workspaceId,
  workspacePath,
  loadClaudeSession,
}: ClaudeHistoryLoaderOptions): HistoryLoader {
  return {
    engine: "claude",
    async load(threadId: string) {
      const sessionId = threadId.startsWith("claude:")
        ? threadId.slice("claude:".length)
        : threadId;
      if (!workspacePath) {
        return normalizeHistorySnapshot({
          engine: "claude",
          workspaceId,
          threadId,
          meta: {
            workspaceId,
            threadId,
            engine: "claude",
            activeTurnId: null,
            isThinking: false,
            heartbeatPulse: null,
            historyRestoredAtMs: Date.now(),
          },
        });
      }
      const result = await loadClaudeSession(workspacePath, sessionId);
      const record = result as { messages?: unknown };
      const messagesData = record.messages ?? result;
      const parsedItems = parseClaudeHistoryMessages(messagesData);
      const userInputQueue = extractPendingUserInputQueueFromClaudeItems(
        parsedItems,
        workspaceId,
        threadId,
      );
      return normalizeHistorySnapshot({
        engine: "claude",
        workspaceId,
        threadId,
        items: parsedItems,
        plan: null,
        userInputQueue,
        meta: {
          workspaceId,
          threadId,
          engine: "claude",
          activeTurnId: null,
          isThinking: false,
          heartbeatPulse: null,
          historyRestoredAtMs: Date.now(),
        },
      });
    },
  };
}
