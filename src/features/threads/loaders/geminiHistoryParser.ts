import type { ConversationItem } from "../../../types";
import { buildConversationItemFromThreadItem } from "../../../utils/threadItems";
import {
  areEquivalentReasoningTexts,
  compactComparableConversationText,
} from "../assembly/conversationNormalization";
import { asRecord, asString } from "./historyLoaderUtils";
import { parseClaudeHistoryMessages } from "./claudeHistoryLoader";

const RESULT_TOOL_SUFFIXES = ["-result", ":result", "_result", ".result", "/result"];
const COMMAND_TOOL_KEYWORDS = [
  "exec",
  "bash",
  "shell",
  "terminal",
  "command",
  "stdin",
];
const FILE_CHANGE_TOOL_KEYWORDS = ["apply", "patch", "write", "edit"];
const GEMINI_OUTPUT_LANGUAGE_HINT_PATTERN =
  /^Output language:[^\r\n]*(?:\r?\n)+Prefer this language for reasoning and final answer unless the user explicitly requests another language\.(?:\r?\n){1,2}/i;

function mergeAdjacentReasoningText(existing: string, incoming: string): string {
  const normalizedExisting = existing.trim();
  const normalizedIncoming = incoming.trim();
  if (!normalizedExisting) {
    return normalizedIncoming;
  }
  if (!normalizedIncoming) {
    return normalizedExisting;
  }

  const compactExisting = compactComparableConversationText(normalizedExisting);
  const compactIncoming = compactComparableConversationText(normalizedIncoming);
  if (!compactExisting) {
    return normalizedIncoming;
  }
  if (!compactIncoming) {
    return normalizedExisting;
  }
  if (areEquivalentReasoningTexts(normalizedExisting, normalizedIncoming)) {
    return normalizedExisting.length >= normalizedIncoming.length
      ? normalizedExisting
      : normalizedIncoming;
  }
  return `${normalizedExisting}\n\n${normalizedIncoming}`;
}

function stripGeminiOutputLanguageHint(text: string): string {
  const matchedPrefix = text.match(GEMINI_OUTPUT_LANGUAGE_HINT_PATTERN)?.[0];
  if (!matchedPrefix) {
    return text;
  }
  return text.slice(matchedPrefix.length);
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

function extractGeminiAssistantFinalFlag(message: Record<string, unknown>): boolean | undefined {
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

function markGeminiAssistantFinalMessages(items: ConversationItem[]) {
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

function hydrateGeminiAssistantFinalTiming(
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
      ...(typeof completedAtMs === "number" ? { finalCompletedAt: completedAtMs } : {}),
      ...(typeof durationMs === "number" ? { finalDurationMs: durationMs } : {}),
    };
  });
}

function stringifyValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return "";
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function resolveToolOutputText(text: string, toolOutput: unknown): string {
  const normalizedText = text.trim();
  if (normalizedText) {
    return normalizedText;
  }

  if (typeof toolOutput === "string") {
    return toolOutput.trim();
  }

  const outputRecord = asRecord(toolOutput);
  if (Object.keys(outputRecord).length > 0) {
    const preferred = [
      outputRecord.aggregatedOutput,
      outputRecord.output,
      outputRecord.result,
      outputRecord.stdout,
      outputRecord.stderr,
      outputRecord.text,
      outputRecord.error,
    ];
    for (const candidate of preferred) {
      const candidateText = stringifyValue(candidate).trim();
      if (candidateText) {
        return candidateText;
      }
    }
  }

  return stringifyValue(toolOutput).trim();
}

function normalizeGeminiToolSnapshotType(rawToolType: string): string {
  const normalized = rawToolType.trim().toLowerCase();
  if (!normalized) {
    return rawToolType;
  }
  if (normalized === "commandexecution") {
    return "commandExecution";
  }
  if (normalized === "filechange") {
    return "fileChange";
  }
  if (normalized === "mcptoolcall") {
    return "mcpToolCall";
  }
  if (COMMAND_TOOL_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return "commandExecution";
  }
  if (
    FILE_CHANGE_TOOL_KEYWORDS.some((keyword) => normalized.includes(keyword)) ||
    normalized.startsWith("replace-") ||
    normalized.includes("replace-")
  ) {
    return "fileChange";
  }
  return rawToolType;
}

function normalizeGeminiToolStartItem(
  message: Record<string, unknown>,
  itemId: string,
  rawToolType: string,
  text: string,
): Extract<ConversationItem, { kind: "tool" }> | null {
  const normalizedToolType = normalizeGeminiToolSnapshotType(rawToolType);
  const inputRecord = asRecord(message.toolInput ?? message.tool_input ?? null);
  const status = asString(message.status ?? "").trim() || "started";
  const passthroughKeys = [
    "command",
    "cmd",
    "script",
    "shell_command",
    "bash",
    "argv",
    "cwd",
    "workdir",
    "working_directory",
    "workingDirectory",
    "description",
    "summary",
    "label",
    "task",
    "changes",
    "files",
    "output",
    "result",
    "stdout",
    "stderr",
    "error",
    "aggregatedOutput",
  ] as const;
  const synthetic: Record<string, unknown> = {
    id: itemId,
    type: normalizedToolType,
    status,
    input: inputRecord,
    arguments: inputRecord,
    text,
  };

  for (const key of passthroughKeys) {
    if (message[key] !== undefined) {
      synthetic[key] = message[key];
    }
  }

  for (const [key, value] of Object.entries(inputRecord)) {
    if (synthetic[key] === undefined) {
      synthetic[key] = value;
    }
  }

  const converted = buildConversationItemFromThreadItem(synthetic);
  if (converted?.kind === "tool") {
    return converted;
  }
  return null;
}

function isLikelyResultToolType(toolType: string): boolean {
  const normalized = toolType.trim().toLowerCase();
  return (
    normalized === "result" ||
    normalized === "error" ||
    normalized === "failed" ||
    normalized === "failure" ||
    normalized === "tool_result" ||
    normalized === "tool-result"
  );
}

function isLikelyFailedToolType(toolType: string): boolean {
  const normalized = toolType.trim().toLowerCase();
  return normalized.includes("error") || normalized.includes("fail");
}

function resolveSourceToolId(message: Record<string, unknown>, itemId: string): string {
  const explicit = asString(
    message.sourceToolId ??
      message.source_tool_id ??
      message.sourceToolCallId ??
      message.source_tool_call_id ??
      message.toolUseId ??
      message.tool_use_id ??
      message.callId ??
      message.call_id ??
      message.parentId ??
      message.parent_id ??
      "",
  ).trim();
  if (explicit) {
    return explicit;
  }
  for (const suffix of RESULT_TOOL_SUFFIXES) {
    if (itemId.endsWith(suffix) && itemId.length > suffix.length) {
      return itemId.slice(0, -suffix.length);
    }
  }
  return itemId;
}

function appendReasoningItem(
  items: ConversationItem[],
  itemId: string,
  text: string,
) {
  const normalizedText = text.trim();
  if (!normalizedText) {
    return;
  }
  const previous = items[items.length - 1];
  if (previous?.kind === "reasoning") {
    const mergedContent = mergeAdjacentReasoningText(previous.content, normalizedText);
    const summary = previous.summary.trim()
      ? previous.summary
      : (mergedContent.split(/\r?\n/, 1)[0] ?? mergedContent).slice(0, 100);
    items[items.length - 1] = {
      ...previous,
      summary,
      content: mergedContent,
    };
    return;
  }
  const firstLine = normalizedText.split(/\r?\n/, 1)[0] ?? normalizedText;
  items.push({
    id: itemId,
    kind: "reasoning",
    summary: firstLine.slice(0, 100),
    content: normalizedText,
  });
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

export function parseGeminiHistoryMessages(messagesData: unknown): ConversationItem[] {
  if (!Array.isArray(messagesData)) {
    return [];
  }

  const items: ConversationItem[] = [];
  const messageTimestampById = new Map<string, number>();
  const toolIndexById = new Map<string, number>();

  for (const entry of messagesData) {
    const message = asRecord(entry);
    if (Object.keys(message).length === 0) {
      continue;
    }

    const kind = asString(message.kind ?? "").trim().toLowerCase();
    const itemId =
      asString(message.id ?? "").trim() || `gemini-history-item-${items.length + 1}`;

    if (kind === "message") {
      const role = asString(message.role ?? "").trim().toLowerCase() === "user"
        ? "user"
        : "assistant";
      const rawText = asString(message.text ?? "");
      const text =
        role === "user" ? stripGeminiOutputLanguageHint(rawText) : rawText;
      const images = extractImageList(message.images);
      const timestampMs = parseHistoryTimestampMs(
        message.timestamp ?? message.createdAt ?? message.created_at ?? null,
      );
      const assistantFinalFlag =
        role === "assistant"
          ? extractGeminiAssistantFinalFlag(message)
          : undefined;
      if (!text.trim() && images.length === 0) {
        continue;
      }
      if (typeof timestampMs === "number") {
        messageTimestampById.set(itemId, timestampMs);
      }
      items.push({
        id: itemId,
        kind: "message",
        role,
        text,
        images: images.length > 0 ? images : undefined,
        ...(typeof assistantFinalFlag === "boolean"
          ? { isFinal: assistantFinalFlag }
          : {}),
      });
      continue;
    }

    if (kind === "reasoning") {
      appendReasoningItem(items, itemId, asString(message.text ?? ""));
      continue;
    }

    if (kind !== "tool") {
      continue;
    }

    const rawToolType = asString(message.toolType ?? message.tool_type ?? "").trim();
    const normalizedToolType = normalizeGeminiToolSnapshotType(rawToolType);
    const toolInput = message.toolInput ?? message.tool_input ?? null;
    const toolOutput = message.toolOutput ?? message.tool_output ?? null;
    const text = asString(message.text ?? "");
    const title = asString(message.title ?? "").trim() || rawToolType || "Tool";
    const detailText = stringifyValue(toolInput).trim();
    const outputText = resolveToolOutputText(text, toolOutput);

    const sourceToolId = resolveSourceToolId(message, itemId);
    const sourceToolIndex = toolIndexById.get(sourceToolId);
    const treatAsCompletion =
      isLikelyResultToolType(rawToolType) ||
      (sourceToolIndex !== undefined && toolOutput !== null && toolOutput !== undefined);

    if (treatAsCompletion) {
      const status = isLikelyFailedToolType(rawToolType) ? "failed" : "completed";
      if (sourceToolIndex !== undefined) {
        const existing = items[sourceToolIndex];
        if (existing && existing.kind === "tool") {
          items[sourceToolIndex] = {
            ...existing,
            status,
            output: outputText || existing.output,
          };
          continue;
        }
      }
      items.push({
        id: sourceToolId || itemId,
        kind: "tool",
        toolType: normalizedToolType || rawToolType || "tool",
        title,
        detail: detailText,
        status,
        output: outputText,
      });
      continue;
    }

    const normalizedStartItem = normalizeGeminiToolStartItem(
      message,
      itemId,
      rawToolType,
      text,
    );
    if (normalizedStartItem) {
      items.push(normalizedStartItem);
      toolIndexById.set(itemId, items.length - 1);
      continue;
    }

    items.push({
      id: itemId,
      kind: "tool",
      toolType: normalizedToolType || rawToolType || "tool",
      title,
      detail: detailText || text,
      status: "started",
    });
    toolIndexById.set(itemId, items.length - 1);
  }

  // Graceful fallback for legacy/non-normalized payloads.
  if (items.length === 0 && messagesData.length > 0) {
    return parseClaudeHistoryMessages(messagesData);
  }

  markGeminiAssistantFinalMessages(items);
  hydrateGeminiAssistantFinalTiming(items, messageTimestampById);

  return items;
}
