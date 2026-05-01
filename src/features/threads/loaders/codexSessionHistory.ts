import type { ConversationItem } from "../../../types";
import { findEquivalentReasoningObservationIndex } from "../assembly/conversationNormalization";
import { normalizeCollabAgentStatusMap } from "../../../utils/collabToolParsing";
import { buildConversationItemFromThreadItem } from "../../../utils/threadItems";
import { asRecord, asString } from "./historyLoaderUtils";

type CodexSessionEntry = Record<string, unknown>;
type PendingCommandExecution = {
  callId: string;
  command: string;
  cwd: string;
  description: string;
};
type PendingApplyPatch = {
  callId: string;
  input: string;
  status: string;
};
type PendingCollabToolCall = {
  callId: string;
  tool: string;
  senderThreadId: string;
  receiverThreadIds: string[];
  prompt: string;
  status: string;
  agentStatus?: Record<string, { status?: string }>;
};
type PendingGenericToolCall = {
  callId: string;
  tool: string;
  arguments: unknown;
  status: string;
};

const COLLAB_TOOL_CALL_NAMES = new Set([
  "spawn_agent",
  "send_input",
  "wait",
  "wait_agent",
  "resume_agent",
  "close_agent",
]);
const SKIP_GENERIC_TOOL_CALL_NAMES = new Set([
  "exec_command",
  "write_stdin",
  "update_plan",
  "request_user_input",
]);

function findDuplicateReasoningIndex(
  items: ConversationItem[],
  incoming: Extract<ConversationItem, { kind: "reasoning" }>,
) {
  return findEquivalentReasoningObservationIndex(items, incoming);
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
    id: incoming.id,
    summary: incomingSummary.length >= existingSummary.length ? incomingSummary : existingSummary,
    content: incomingContent.length >= existingContent.length ? incomingContent : existingContent,
  };
}

function normalizeComparableMessageText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeComparableCodexMirrorMathText(value: string) {
  return value
    .replace(/\\+\(\s*([\s\S]*?)\s*\\+\)/g, (_match, inner: string) => `$${inner.trim()}$`)
    .replace(/\\+\[\s*([\s\S]*?)\s*\\+\]/g, (_match, inner: string) => `$$${inner.trim()}$$`)
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeComparableMessageImages(item: Extract<ConversationItem, { kind: "message" }>) {
  if (!Array.isArray(item.images) || item.images.length === 0) {
    return "";
  }
  return item.images.join("\u0001");
}

function isKnownCodexAssistantMirrorEventPair(
  existing: Extract<ConversationItem, { kind: "message" }>,
  incoming: Extract<ConversationItem, { kind: "message" }>,
) {
  if (existing.role !== "assistant" || incoming.role !== "assistant") {
    return false;
  }
  const isExistingResponseItem = existing.id.startsWith("codex-assistant-");
  const isExistingEventMsg = existing.id.startsWith("codex-agent-message-");
  const isIncomingResponseItem = incoming.id.startsWith("codex-assistant-");
  const isIncomingEventMsg = incoming.id.startsWith("codex-agent-message-");
  return (
    (isExistingResponseItem && isIncomingEventMsg) ||
    (isExistingEventMsg && isIncomingResponseItem)
  );
}

function isAdjacentDuplicateMessage(
  existing: ConversationItem | undefined,
  incoming: Extract<ConversationItem, { kind: "message" }>,
) {
  if (!existing || existing.kind !== "message") {
    return false;
  }
  if (existing.role !== incoming.role) {
    return false;
  }
  const existingText = normalizeComparableMessageText(existing.text);
  const incomingText = normalizeComparableMessageText(incoming.text);
  if (!existingText || !incomingText) {
    return false;
  }
  if (!isKnownCodexAssistantMirrorEventPair(existing, incoming)) {
    return false;
  }
  if (existingText !== incomingText) {
    const normalizedExistingMath = normalizeComparableCodexMirrorMathText(existingText);
    const normalizedIncomingMath = normalizeComparableCodexMirrorMathText(incomingText);
    if (
      !normalizedExistingMath ||
      !normalizedIncomingMath ||
      normalizedExistingMath !== normalizedIncomingMath
    ) {
      return false;
    }
  }
  return (
    normalizeComparableMessageImages(existing) ===
    normalizeComparableMessageImages(incoming)
  );
}

function shouldPreferIncomingCodexMirrorMessage(
  existing: Extract<ConversationItem, { kind: "message" }>,
  incoming: Extract<ConversationItem, { kind: "message" }>,
) {
  const isExistingResponseItem = existing.id.startsWith("codex-assistant-");
  const isIncomingResponseItem = incoming.id.startsWith("codex-assistant-");
  return !isExistingResponseItem && isIncomingResponseItem;
}

function appendCodexHistoryItem(items: ConversationItem[], item: ConversationItem) {
  if (item.kind === "message") {
    const previous = items[items.length - 1];
    if (
      previous?.kind === "message" &&
      isAdjacentDuplicateMessage(previous, item)
    ) {
      if (shouldPreferIncomingCodexMirrorMessage(previous, item)) {
        items[items.length - 1] = item;
      }
      return;
    }
    items.push(item);
    return;
  }
  if (item.kind !== "reasoning") {
    items.push(item);
    return;
  }
  const duplicateIndex = findDuplicateReasoningIndex(items, item);
  if (duplicateIndex < 0 || items[duplicateIndex]?.kind !== "reasoning") {
    items.push(item);
    return;
  }
  items[duplicateIndex] = mergeReasoningSnapshot(
    items[duplicateIndex] as Extract<ConversationItem, { kind: "reasoning" }>,
    item,
  );
}

function toEntryList(input: unknown): CodexSessionEntry[] {
  if (Array.isArray(input)) {
    return input.map(asRecord).filter((entry) => Object.keys(entry).length > 0);
  }
  const record = asRecord(input);
  const entries = Array.isArray(record.entries) ? record.entries : [];
  return entries.map(asRecord).filter((entry) => Object.keys(entry).length > 0);
}

function hasCodexEventUserMessage(entries: CodexSessionEntry[]) {
  return entries.some((entry) => {
    if (asString(entry.type).trim() !== "event_msg") {
      return false;
    }
    const payload = asRecord(entry.payload);
    const payloadType = asString(payload.type).trim();
    return payloadType === "user_message" || payloadType === "userMessage";
  });
}

function parseJsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") {
    return asRecord(value);
  }
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return {};
  }
}

function parseJsonUnknown(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function parseTimestampLikeMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value <= 0) {
      return null;
    }
    return value < 1_000_000_000_000 ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  const numeric = Number(normalized);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric < 1_000_000_000_000 ? Math.round(numeric * 1000) : Math.round(numeric);
  }
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function extractEntryTimestampMs(entry: CodexSessionEntry): number | null {
  const payload = asRecord(entry.payload);
  const candidates: unknown[] = [
    entry.timestamp,
    entry.timestamp_ms,
    entry.timestampMs,
    entry.created_at,
    entry.createdAt,
    payload.timestamp,
    payload.timestamp_ms,
    payload.timestampMs,
    payload.created_at,
    payload.createdAt,
  ];
  for (const candidate of candidates) {
    const parsed = parseTimestampLikeMs(candidate);
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
}

function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => asString(entry).trim())
      .filter(Boolean);
  }
  const normalized = asString(value).trim();
  if (!normalized) {
    return [];
  }
  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    const parsed = parseJsonUnknown(normalized);
    if (Array.isArray(parsed)) {
      return parsed
        .map((entry) => asString(entry).trim())
        .filter(Boolean);
    }
  }
  if (normalized.includes(",")) {
    return normalized
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [normalized];
}

function uniqueStringList(values: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  values.forEach((value) => {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    deduped.push(normalized);
  });
  return deduped;
}

function normalizeCollabToolName(name: string) {
  return name.trim().toLowerCase();
}

function isCollabToolCall(name: string) {
  return COLLAB_TOOL_CALL_NAMES.has(normalizeCollabToolName(name));
}

function extractCollabPrompt(argumentsRecord: Record<string, unknown>) {
  return asString(
    argumentsRecord.message ??
      argumentsRecord.prompt ??
      argumentsRecord.instructions ??
      argumentsRecord.instruction ??
      "",
  ).trim();
}

function extractThreadIdsFromRecord(record: Record<string, unknown>): string[] {
  const ids = [
    ...toStringList(
      record.receiverThreadIds ??
        record.receiver_thread_ids ??
        record.newThreadIds ??
        record.new_thread_ids ??
        record.targets ??
        record.threadIds ??
        record.thread_ids ??
        record.agentIds ??
        record.agent_ids ??
        record.ids,
    ),
    ...toStringList(
      record.receiverThreadId ??
        record.receiver_thread_id ??
        record.newThreadId ??
        record.new_thread_id ??
        record.target ??
        record.threadId ??
        record.thread_id ??
        record.agentId ??
        record.agent_id ??
        record.id,
    ),
  ];
  return uniqueStringList(ids);
}

function extractThreadIdsFromStatusValue(value: unknown): string[] {
  const normalizedStatuses = normalizeCollabAgentStatusMap(value);
  if (!normalizedStatuses) {
    return [];
  }
  return Object.keys(normalizedStatuses);
}

function mergeAgentStatuses(
  ...candidates: Array<Record<string, { status?: string }> | undefined>
) {
  const merged: Record<string, { status?: string }> = {};
  candidates.forEach((candidate) => {
    if (!candidate) {
      return;
    }
    Object.entries(candidate).forEach(([id, state]) => {
      const normalizedId = id.trim();
      if (!normalizedId) {
        return;
      }
      const status = asString(state?.status ?? "").trim();
      if (!status) {
        return;
      }
      merged[normalizedId] = { status };
    });
  });
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function extractAgentStatusesFromRecord(value: unknown) {
  const directStatuses = normalizeCollabAgentStatusMap(value);
  if (directStatuses) {
    return directStatuses;
  }

  const record = asRecord(value);
  if (Object.keys(record).length === 0) {
    return undefined;
  }
  const nestedStatuses = mergeAgentStatuses(
    extractAgentStatusesFromRecord(record.statuses),
    extractAgentStatusesFromRecord(record.results),
    extractAgentStatusesFromRecord(record.agent),
    extractAgentStatusesFromRecord(record.agents),
  );
  return nestedStatuses;
}

function extractMessageText(payload: Record<string, unknown>) {
  const directContent =
    typeof payload.content === "string" ? payload.content.trim() : "";
  if (directContent) {
    return directContent;
  }
  const content = Array.isArray(payload.content) ? payload.content : [];
  const parts = content
    .map((entry) => {
      const record = asRecord(entry);
      return asString(record.text ?? record.value ?? record.content ?? "").trim();
    })
    .filter(Boolean);
  if (parts.length > 0) {
    return parts.join("\n\n").trim();
  }
  return asString(payload.text ?? payload.message ?? "").trim();
}

function unwrapToolOutputEnvelope(value: string) {
  const marker = "\nOutput:\n";
  const index = value.indexOf(marker);
  if (index < 0) {
    return value.trim();
  }
  return value.slice(index + marker.length).trim();
}

function buildConversationItem(item: Record<string, unknown>): ConversationItem | null {
  return buildConversationItemFromThreadItem(item);
}

function buildReasoningItem(payload: Record<string, unknown>, fallbackId: string) {
  return buildConversationItem({
    id: asString(payload.id ?? fallbackId).trim() || fallbackId,
    type: "reasoning",
    summary: payload.summary ?? "",
    content: payload.content ?? "",
    encrypted_content: payload.encrypted_content ?? payload.encryptedContent ?? "",
  });
}

function buildAssistantMessageItem(payload: Record<string, unknown>, fallbackId: string) {
  const text = extractMessageText(payload);
  if (!text) {
    return null;
  }
  return buildConversationItem({
    id: fallbackId,
    type: "agentMessage",
    text,
  });
}

function extractCodexMessageId(
  payload: Record<string, unknown>,
  fallbackId: string,
) {
  for (const candidate of [
    payload.id,
    payload.uuid,
    payload.message_id,
    payload.messageId,
  ]) {
    const normalized = asString(candidate).trim();
    if (normalized) {
      return normalized;
    }
  }
  return fallbackId;
}

function buildUserMessageItem(payload: Record<string, unknown>, fallbackId: string) {
  const text = extractMessageText(payload);
  const content = Array.isArray(payload.content) ? payload.content : [];
  const hasUserImages =
    Array.isArray(payload.images) ||
    Array.isArray(payload.imageUrls) ||
    Array.isArray(payload.image_urls) ||
    content.some((entry) => {
      const type = asString(asRecord(entry).type).trim().toLowerCase();
      return type === "image" || type === "localimage" || type === "local_image" || type === "input_image";
    });
  if (!text && !hasUserImages) {
    return null;
  }
  const selectedAgentName = asString(
    payload.selectedAgentName ?? payload.selected_agent_name ?? "",
  ).trim();
  const selectedAgentIcon = asString(
    payload.selectedAgentIcon ?? payload.selected_agent_icon ?? "",
  ).trim();
  return buildConversationItem({
    id: extractCodexMessageId(payload, fallbackId),
    type: "userMessage",
    ...(content.length > 0 ? { content } : { content: [{ type: "text", text }] }),
    ...(text ? { text } : {}),
    ...(Array.isArray(payload.images) ? { images: payload.images } : {}),
    ...(Array.isArray(payload.imageUrls) ? { imageUrls: payload.imageUrls } : {}),
    ...(Array.isArray(payload.image_urls) ? { image_urls: payload.image_urls } : {}),
    ...(selectedAgentName ? { selectedAgentName } : {}),
    ...(selectedAgentIcon ? { selectedAgentIcon } : {}),
  });
}

function buildCommandExecutionItem(
  pending: PendingCommandExecution,
  payload: Record<string, unknown>,
) {
  return buildConversationItem({
    id: pending.callId,
    type: "commandExecution",
    command: pending.command,
    cwd: pending.cwd,
    description: pending.description,
    status: "completed",
    aggregatedOutput: unwrapToolOutputEnvelope(asString(payload.output ?? "")),
  });
}

function buildApplyPatchItem({
  callId,
  patch,
  status,
  output,
}: {
  callId: string;
  patch: string;
  status?: string;
  output?: string;
}) {
  if (!callId || !patch) {
    return null;
  }
  return buildConversationItem({
    id: callId.trim(),
    type: "fileChange",
    status: asString(status ?? "completed"),
    input: patch.trim(),
    output: unwrapToolOutputEnvelope(asString(output ?? "")),
  });
}

function buildGeneratedImageHistoryItem(
  payload: Record<string, unknown>,
  fallbackId: string,
) {
  const resolvedId =
    asString(payload.id ?? payload.call_id ?? payload.callId ?? "").trim() || fallbackId;
  const resolvedType = asString(payload.type ?? "").trim();
  return buildConversationItem({
    ...payload,
    id: resolvedId,
    type:
      resolvedType === "image_generation_end"
        ? "image_generation_end"
        : "image_generation_call",
  });
}

function buildCollabToolCallItem(pending: PendingCollabToolCall) {
  if (!pending.callId.trim() || !pending.tool.trim()) {
    return null;
  }
  return buildConversationItem({
    id: pending.callId,
    type: "collabToolCall",
    tool: pending.tool,
    status: pending.status,
    senderThreadId: pending.senderThreadId,
    receiverThreadIds: pending.receiverThreadIds,
    prompt: pending.prompt,
    ...(pending.agentStatus ? { agentStatus: pending.agentStatus } : {}),
  });
}

function stageApplyPatchCall(
  payload: Record<string, unknown>,
  pendingApplyPatches: Map<string, PendingApplyPatch>,
) {
  if (asString(payload.name).trim() !== "apply_patch") {
    return;
  }
  const callId = asString(payload.call_id ?? payload.callId ?? "").trim();
  const input = asString(payload.input ?? "").trim();
  if (!callId || !input) {
    return;
  }
  pendingApplyPatches.set(callId, {
    callId,
    input,
    status: asString(payload.status ?? "completed").trim() || "completed",
  });
}

function flushApplyPatchOutput(
  payload: Record<string, unknown>,
  pendingApplyPatches: Map<string, PendingApplyPatch>,
) {
  const callId = asString(payload.call_id ?? payload.callId ?? "").trim();
  if (!callId) {
    return null;
  }
  const pending = pendingApplyPatches.get(callId);
  if (!pending) {
    return null;
  }
  pendingApplyPatches.delete(callId);
  return buildApplyPatchItem({
    callId,
    patch: pending.input,
    status: pending.status,
    output: asString(payload.output ?? ""),
  });
}

function stageCollabToolCall(
  payload: Record<string, unknown>,
  pendingCollabToolCalls: Map<string, PendingCollabToolCall>,
) {
  const tool = normalizeCollabToolName(asString(payload.name));
  if (!isCollabToolCall(tool)) {
    return false;
  }
  const callId = asString(payload.call_id ?? payload.callId ?? "").trim();
  if (!callId) {
    return true;
  }
  const argumentsRecord = parseJsonRecord(payload.arguments);
  pendingCollabToolCalls.set(callId, {
    callId,
    tool,
    senderThreadId: asString(
      argumentsRecord.senderThreadId ??
        argumentsRecord.sender_thread_id ??
        argumentsRecord.parentThreadId ??
        argumentsRecord.parent_thread_id ??
        "",
    ).trim(),
    receiverThreadIds: extractThreadIdsFromRecord(argumentsRecord),
    prompt: extractCollabPrompt(argumentsRecord),
    status: asString(payload.status ?? "completed").trim() || "completed",
  });
  return true;
}

function extractCollabOutputRecord(payload: Record<string, unknown>) {
  const parsedOutput = parseJsonUnknown(payload.output ?? payload.result ?? payload.response);
  const outputRecord = asRecord(parsedOutput);
  if (Object.keys(outputRecord).length > 0) {
    return outputRecord;
  }
  return parseJsonRecord(payload.data);
}

function flushCollabToolCallOutput(
  payload: Record<string, unknown>,
  pendingCollabToolCalls: Map<string, PendingCollabToolCall>,
) {
  const callId = asString(payload.call_id ?? payload.callId ?? "").trim();
  if (!callId) {
    return null;
  }
  const pending = pendingCollabToolCalls.get(callId);
  if (!pending) {
    return null;
  }
  pendingCollabToolCalls.delete(callId);
  const outputRecord = extractCollabOutputRecord(payload);
  const mergedReceiverThreadIds = uniqueStringList([
    ...pending.receiverThreadIds,
    ...extractThreadIdsFromRecord(outputRecord),
    ...extractThreadIdsFromStatusValue(outputRecord.statuses),
    ...extractThreadIdsFromStatusValue(outputRecord.results),
    ...extractThreadIdsFromStatusValue(outputRecord.agent),
    ...extractThreadIdsFromStatusValue(outputRecord.agents),
  ]);
  const mergedAgentStatus = mergeAgentStatuses(
    pending.agentStatus,
    extractAgentStatusesFromRecord(outputRecord.statuses),
    extractAgentStatusesFromRecord(outputRecord.results),
    extractAgentStatusesFromRecord(outputRecord.agent),
    extractAgentStatusesFromRecord(outputRecord.agents),
  );
  return buildCollabToolCallItem({
    ...pending,
    status: asString(payload.status ?? pending.status ?? "completed").trim() || "completed",
    receiverThreadIds: mergedReceiverThreadIds,
    ...(mergedAgentStatus ? { agentStatus: mergedAgentStatus } : {}),
  });
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

function shouldRecoverAsGenericToolCall(name: string) {
  const normalized = name.trim();
  if (!normalized) {
    return false;
  }
  if (isCollabToolCall(normalized)) {
    return false;
  }
  if (SKIP_GENERIC_TOOL_CALL_NAMES.has(normalized)) {
    return false;
  }
  return true;
}

function stageGenericToolCall(
  payload: Record<string, unknown>,
  pendingGenericToolCalls: Map<string, PendingGenericToolCall>,
) {
  const tool = asString(payload.name).trim();
  if (!shouldRecoverAsGenericToolCall(tool)) {
    return false;
  }
  const callId = asString(payload.call_id ?? payload.callId ?? "").trim();
  if (!callId) {
    return true;
  }
  pendingGenericToolCalls.set(callId, {
    callId,
    tool,
    arguments: parseJsonUnknown(payload.arguments),
    status: asString(payload.status ?? "completed").trim() || "completed",
  });
  return true;
}

function buildGenericToolCallItem({
  callId,
  tool,
  status,
  output,
  argumentsPayload,
}: {
  callId: string;
  tool: string;
  status: string;
  output: string;
  argumentsPayload: unknown;
}) {
  if (!callId.trim() || !tool.trim()) {
    return null;
  }
  return buildConversationItem({
    id: callId,
    type: "mcpToolCall",
    server: "codex",
    tool,
    status,
    arguments: argumentsPayload,
    output,
  });
}

function flushGenericToolCallOutput(
  payload: Record<string, unknown>,
  pendingGenericToolCalls: Map<string, PendingGenericToolCall>,
) {
  const callId = asString(payload.call_id ?? payload.callId ?? "").trim();
  if (!callId) {
    return null;
  }
  const pending = pendingGenericToolCalls.get(callId);
  if (!pending) {
    return null;
  }
  pendingGenericToolCalls.delete(callId);
  const outputValue =
    payload.output ??
    payload.result ??
    payload.response ??
    payload.data ??
    "";
  const output = unwrapToolOutputEnvelope(stringifyUnknown(parseJsonUnknown(outputValue)));
  return buildGenericToolCallItem({
    callId,
    tool: pending.tool,
    status: asString(payload.status ?? pending.status ?? "completed").trim() || "completed",
    output,
    argumentsPayload: pending.arguments,
  });
}

function normalizeWebSearchToolName(actionType: string) {
  const normalized = actionType.trim().toLowerCase();
  if (
    normalized === "search" ||
    normalized === "web_search" ||
    normalized === "search_query" ||
    normalized === "open_page" ||
    normalized === "open_url" ||
    normalized === "open_link" ||
    normalized === "open" ||
    normalized === "find_in_page" ||
    normalized === "find" ||
    normalized === "click" ||
    normalized === "click_link" ||
    normalized === "follow_link"
  ) {
    return "search_query";
  }
  return normalized || "search_query";
}

function resolveWebSearchQueryHint(action: Record<string, unknown>) {
  const actionType = asString(action.type ?? "").trim().toLowerCase();
  const query = asString(action.query ?? "").trim();
  if (query) {
    return query;
  }
  const url = asString(action.url ?? action.page_url ?? action.pageUrl ?? "").trim();
  const pattern = asString(action.pattern ?? action.selector ?? "").trim();
  if (actionType === "find_in_page") {
    if (pattern && url) {
      return `'${pattern}' in ${url}`;
    }
    if (pattern) {
      return pattern;
    }
  }
  if (url) {
    return url;
  }
  return pattern;
}

function normalizeWebSearchArguments(action: Record<string, unknown>) {
  const normalized: Record<string, unknown> = { ...action };
  const queries = Array.isArray(action.queries)
    ? action.queries
        .map((entry) => asString(entry).trim())
        .filter(Boolean)
    : [];
  if (
    queries.length > 0 &&
    !Array.isArray(normalized.search_query) &&
    !Array.isArray(normalized.searchQuery)
  ) {
    normalized.search_query = queries.map((query) => ({ q: query }));
  }
  const queryHint = resolveWebSearchQueryHint(action);
  if (queryHint) {
    if (!asString(normalized.q).trim()) {
      normalized.q = queryHint;
    }
    if (!asString(normalized.query).trim()) {
      normalized.query = queryHint;
    }
  }
  return normalized;
}

function buildWebSearchCallItem(payload: Record<string, unknown>, fallbackId: string) {
  const actionRecord = parseJsonRecord(payload.action);
  if (Object.keys(actionRecord).length === 0) {
    return null;
  }
  const actionType = asString(
    actionRecord.type ?? payload.action_type ?? payload.actionType ?? "",
  ).trim();
  const tool = normalizeWebSearchToolName(actionType);
  const callId =
    asString(payload.call_id ?? payload.callId ?? payload.id ?? "").trim() ||
    fallbackId;
  const outputValue =
    payload.output ??
    payload.result ??
    payload.response ??
    payload.data ??
    "";
  const explicitOutput = unwrapToolOutputEnvelope(
    stringifyUnknown(parseJsonUnknown(outputValue)),
  );
  const output = explicitOutput || stringifyUnknown(actionRecord).trim();
  return buildGenericToolCallItem({
    callId,
    tool,
    status: asString(payload.status ?? "completed").trim() || "completed",
    output,
    argumentsPayload: normalizeWebSearchArguments(actionRecord),
  });
}

function annotateCodexFinalMessageMetadata(
  items: ConversationItem[],
  messageTimestampById: Map<string, number>,
) {
  type TurnMessageWindow = {
    userStartedAt: number | null;
    assistantIndexes: number[];
  };

  const turnWindows: TurnMessageWindow[] = [];
  let activeTurnIndex = -1;

  items.forEach((item, index) => {
    if (item.kind !== "message") {
      return;
    }
    if (item.role === "user") {
      activeTurnIndex += 1;
      turnWindows[activeTurnIndex] = {
        userStartedAt: messageTimestampById.get(item.id) ?? null,
        assistantIndexes: [],
      };
      return;
    }
    if (item.role !== "assistant") {
      return;
    }
    if (activeTurnIndex < 0) {
      activeTurnIndex = 0;
      if (!turnWindows[0]) {
        turnWindows[0] = {
          userStartedAt: null,
          assistantIndexes: [],
        };
      }
    }
    turnWindows[activeTurnIndex]?.assistantIndexes.push(index);
  });

  turnWindows.forEach((window) => {
    const finalAssistantIndex = window.assistantIndexes[window.assistantIndexes.length - 1];
    if (typeof finalAssistantIndex !== "number") {
      return;
    }
    const candidate = items[finalAssistantIndex];
    if (!candidate || candidate.kind !== "message" || candidate.role !== "assistant") {
      return;
    }
    const completedAt =
      typeof candidate.finalCompletedAt === "number" && candidate.finalCompletedAt > 0
        ? candidate.finalCompletedAt
        : messageTimestampById.get(candidate.id) ?? null;
    if (typeof completedAt !== "number" || completedAt <= 0) {
      return;
    }
    const derivedDuration =
      typeof window.userStartedAt === "number" &&
      window.userStartedAt > 0 &&
      completedAt >= window.userStartedAt
        ? completedAt - window.userStartedAt
        : null;
    const durationMs =
      typeof candidate.finalDurationMs === "number" && candidate.finalDurationMs >= 0
        ? candidate.finalDurationMs
        : derivedDuration;
    items[finalAssistantIndex] = {
      ...candidate,
      isFinal: true,
      finalCompletedAt: completedAt,
      ...(typeof durationMs === "number" && durationMs >= 0
        ? { finalDurationMs: durationMs }
        : {}),
    };
  });
}

export function parseCodexSessionHistory(input: unknown): ConversationItem[] {
  const entries = toEntryList(input);
  const preferEventUserMessages = hasCodexEventUserMessage(entries);
  const items: ConversationItem[] = [];
  const pendingCommands = new Map<string, PendingCommandExecution>();
  const pendingApplyPatches = new Map<string, PendingApplyPatch>();
  const pendingCollabToolCalls = new Map<string, PendingCollabToolCall>();
  const pendingGenericToolCalls = new Map<string, PendingGenericToolCall>();
  const messageTimestampById = new Map<string, number>();

  entries.forEach((entry, index) => {
    const entryType = asString(entry.type).trim();
    const payload = asRecord(entry.payload);
    const entryTimestampMs = extractEntryTimestampMs(entry);
    if (Object.keys(payload).length === 0) {
      return;
    }

    if (entryType === "response_item") {
      const payloadType = asString(payload.type).trim();
      if (payloadType === "reasoning") {
        const reasoning = buildReasoningItem(payload, `codex-reasoning-${index + 1}`);
        if (reasoning) {
          appendCodexHistoryItem(items, reasoning);
        }
        return;
      }

      if (
        payloadType === "image_generation_call" ||
        payloadType === "image_generation_end"
      ) {
        const generatedImage = buildGeneratedImageHistoryItem(
          payload,
          `codex-generated-image-${index + 1}`,
        );
        if (generatedImage) {
          appendCodexHistoryItem(items, generatedImage);
        }
        return;
      }

      if (payloadType === "function_call") {
        const functionName = asString(payload.name).trim();
        if (functionName === "exec_command") {
          const callId = asString(payload.call_id ?? payload.callId ?? "").trim();
          if (!callId) {
            return;
          }
          const argumentsRecord = parseJsonRecord(payload.arguments);
          pendingCommands.set(callId, {
            callId,
            command: asString(
              argumentsRecord.cmd ?? argumentsRecord.command ?? argumentsRecord.argv ?? "",
            ).trim(),
            cwd: asString(
              argumentsRecord.workdir ??
                argumentsRecord.cwd ??
                argumentsRecord.working_directory ??
                "",
            ).trim(),
            description: asString(
              argumentsRecord.justification ?? argumentsRecord.description ?? "",
            ).trim(),
          });
          return;
        }
        if (stageCollabToolCall(payload, pendingCollabToolCalls)) {
          return;
        }
        if (stageGenericToolCall(payload, pendingGenericToolCalls)) {
          return;
        }
      }

      if (payloadType === "function_call_output") {
        const callId = asString(payload.call_id ?? payload.callId ?? "").trim();
        const pending = pendingCommands.get(callId);
        if (pending) {
          const command = buildCommandExecutionItem(pending, payload);
          pendingCommands.delete(callId);
          if (command) {
            items.push(command);
          }
          return;
        }
        const collabToolCall = flushCollabToolCallOutput(payload, pendingCollabToolCalls);
        if (collabToolCall) {
          items.push(collabToolCall);
          return;
        }
        const genericToolCall = flushGenericToolCallOutput(payload, pendingGenericToolCalls);
        if (genericToolCall) {
          items.push(genericToolCall);
        }
        return;
      }

      if (payloadType === "custom_tool_call") {
        stageApplyPatchCall(payload, pendingApplyPatches);
        return;
      }

      if (payloadType === "custom_tool_call_output") {
        const fileChange = flushApplyPatchOutput(payload, pendingApplyPatches);
        if (fileChange) {
          items.push(fileChange);
        }
        return;
      }

      if (payloadType === "web_search_call") {
        const webSearchToolCall = buildWebSearchCallItem(
          payload,
          `codex-web-search-${index + 1}`,
        );
        if (webSearchToolCall) {
          items.push(webSearchToolCall);
        }
        return;
      }

      if (payloadType === "message") {
        const role = asString(payload.role).trim();
        if (role === "user" && preferEventUserMessages) {
          return;
        }
        const message =
          role === "user"
            ? buildUserMessageItem(payload, `codex-user-message-${index + 1}`)
            : role === "assistant"
              ? buildAssistantMessageItem(payload, `codex-assistant-${index + 1}`)
              : null;
        if (!message) {
          return;
        }
        if (entryTimestampMs !== null) {
          messageTimestampById.set(message.id, entryTimestampMs);
        }
        appendCodexHistoryItem(items, message);
      }
      return;
    }

    if (entryType === "event_msg") {
      const payloadType = asString(payload.type).trim();
      if (payloadType === "user_message" || payloadType === "userMessage") {
        const message = buildUserMessageItem(payload, `codex-user-message-${index + 1}`);
        if (message) {
          if (entryTimestampMs !== null) {
            messageTimestampById.set(message.id, entryTimestampMs);
          }
          appendCodexHistoryItem(items, message);
        }
        return;
      }
      if (
        payloadType === "image_generation_end" ||
        payloadType === "image_generation_call"
      ) {
        const generatedImage = buildGeneratedImageHistoryItem(
          payload,
          `codex-generated-image-${index + 1}`,
        );
        if (generatedImage) {
          appendCodexHistoryItem(items, generatedImage);
        }
        return;
      }
      if (payloadType === "agent_message") {
        const message = buildConversationItem({
          id: `codex-agent-message-${index + 1}`,
          type: "agentMessage",
          text: asString(payload.message ?? "").trim(),
        });
        if (message) {
          if (entryTimestampMs !== null) {
            messageTimestampById.set(message.id, entryTimestampMs);
          }
          appendCodexHistoryItem(items, message);
        }
      }
      return;
    }

    if (entryType === "custom_tool_call" && asString(payload.name).trim() === "apply_patch") {
      stageApplyPatchCall(payload, pendingApplyPatches);
      const fileChange = buildApplyPatchItem({
        callId: asString(payload.call_id ?? payload.callId ?? "").trim(),
        patch: asString(payload.input ?? "").trim(),
        status: asString(payload.status ?? "completed"),
        output: asString(payload.output ?? ""),
      });
      if (fileChange) {
        pendingApplyPatches.delete(asString(payload.call_id ?? payload.callId ?? "").trim());
        items.push(fileChange);
      }
    }
  });

  pendingCommands.forEach((pending) => {
    const command = buildConversationItem({
      id: pending.callId,
      type: "commandExecution",
      command: pending.command,
      cwd: pending.cwd,
      description: pending.description,
      status: "started",
      aggregatedOutput: "",
    });
    if (command) {
      items.push(command);
    }
  });

  pendingApplyPatches.forEach((pending) => {
    const fileChange = buildApplyPatchItem({
      callId: pending.callId,
      patch: pending.input,
      status: pending.status,
      output: "",
    });
    if (fileChange) {
      items.push(fileChange);
    }
  });

  pendingCollabToolCalls.forEach((pending) => {
    const collabToolCall = buildCollabToolCallItem({
      ...pending,
      status: pending.status || "started",
    });
    if (collabToolCall) {
      items.push(collabToolCall);
    }
  });

  pendingGenericToolCalls.forEach((pending) => {
    const genericToolCall = buildGenericToolCallItem({
      callId: pending.callId,
      tool: pending.tool,
      status: pending.status || "started",
      output: "",
      argumentsPayload: pending.arguments,
    });
    if (genericToolCall) {
      items.push(genericToolCall);
    }
  });

  annotateCodexFinalMessageMetadata(items, messageTimestampById);
  return items;
}
