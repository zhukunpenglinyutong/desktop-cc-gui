import { buildConversationItem } from "../../../utils/threadItems";
import { isGeneratedImageToolName } from "../../../utils/generatedImageArtifacts";
import { hydrateToolSnapshotWithEventParams } from "./toolSnapshotHydration";
import type { ConversationItem } from "../../../types";
import type {
  ConversationEngine,
  NormalizedThreadEvent,
  RealtimeAdapter,
} from "../contracts/conversationCurtainContracts";

type RawRealtimeAdapterInput = {
  workspaceId: string;
  message: Record<string, unknown>;
};

type CommonMapOptions = {
  allowTextDeltaAlias?: boolean;
  agentMessageSnapshotMode?: "delta" | "snapshot";
};

const REASONING_SUMMARY_METHODS = new Set([
  "item/reasoning/summaryTextDelta",
  "response.reasoning_summary_text.delta",
  "response.reasoning_summary_text.done",
  "response.reasoning_summary.delta",
  "response.reasoning_summary.done",
]);

const REASONING_SUMMARY_BOUNDARY_METHODS = new Set([
  "item/reasoning/summaryPartAdded",
  "response.reasoning_summary_part.added",
]);

const REASONING_SUMMARY_PART_DONE_METHODS = new Set([
  "response.reasoning_summary_part.done",
]);

const REASONING_CONTENT_METHODS = new Set([
  "item/reasoning/textDelta",
  "item/reasoning/delta",
  "response.reasoning_text.delta",
  "response.reasoning_text.done",
]);

const MAX_PENDING_CODEX_IMAGEGEN_TOOL_CALLS = 200;
const pendingCodexImagegenToolCalls = new Map<
  string,
  {
    argumentsPayload: unknown;
    toolName: string;
  }
>();

function buildPendingCodexImagegenToolCallKey(
  workspaceId: string,
  threadId: string,
  resolvedId: string,
) {
  return `${workspaceId}:${threadId}:${resolvedId}`;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : value ? String(value) : "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value == null) {
    return "";
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeToolIdentifier(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function buildGenericToolCallItem(
  rawItem: Record<string, unknown>,
  itemId: string,
): Extract<ConversationItem, { kind: "tool" }> | null {
  const rawToolType = asString(
    rawItem.toolType ??
      rawItem.tool_type ??
      rawItem.name ??
      rawItem.tool ??
      rawItem.title ??
      rawItem.type ??
      "",
  ).trim();
  const rawTitle = asString(rawItem.title ?? rawItem.name ?? rawItem.tool ?? rawToolType).trim();
  const normalizedToolIdentity = normalizeToolIdentifier(`${rawToolType} ${rawTitle}`);
  if (
    normalizeToolIdentifier(asString(rawItem.type ?? "")) !== "toolcall" &&
    !normalizedToolIdentity.includes("exitplanmode")
  ) {
    return null;
  }
  const detail = asString(
    rawItem.detail ??
      rawItem.input ??
      rawItem.arguments ??
      rawItem.parameters ??
      "",
  );
  const output = asString(
    rawItem.output ??
      rawItem.result ??
      rawItem.aggregatedOutput ??
      rawItem.text ??
      rawItem.content ??
      "",
  );
  return {
    id: itemId,
    kind: "tool",
    toolType: rawToolType || "toolCall",
    title: rawTitle || "Tool call",
    detail,
    status: asString(rawItem.status ?? ""),
    output,
  };
}

function parseJsonLikeRecord(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return {};
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

function resolveThreadId(params: Record<string, unknown>): string {
  const turn = asRecord(params.turn);
  return asString(
    params.threadId ??
      params.thread_id ??
      turn.threadId ??
      turn.thread_id ??
      "",
  );
}

function resolveTimestamp(params: Record<string, unknown>): number {
  const raw = params.timestampMs ?? params.timestamp_ms ?? params.timestamp ?? params.ts;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === "string" && raw.trim()) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return Date.now();
}

function resolveReasoningItemId(params: Record<string, unknown>): string {
  const turn = asRecord(params.turn);
  const part = asRecord(params.part);
  const item = asRecord(params.item);
  const content = asRecord(params.content);
  return asString(
    params.itemId ??
      params.item_id ??
      part.itemId ??
      part.item_id ??
      item.id ??
      item.itemId ??
      item.item_id ??
      content.itemId ??
      content.item_id ??
      turn.itemId ??
      turn.item_id ??
      "",
  );
}

function resolveReasoningDelta(params: Record<string, unknown>): string {
  const part = asRecord(params.part);
  const item = asRecord(params.item);
  const content = asRecord(params.content);
  return asString(
    params.delta ??
      params.text ??
      params.summary ??
      part.delta ??
      part.text ??
      part.summary ??
      item.delta ??
      item.text ??
      item.summary ??
      content.delta ??
      content.text ??
      content.summary ??
      "",
  );
}

function createEvent({
  engine,
  workspaceId,
  threadId,
  eventId,
  item,
  operation,
  sourceMethod,
  delta = null,
  rawItem = null,
  rawUsage = null,
  turnId = null,
  timestampMs,
}: {
  engine: ConversationEngine;
  workspaceId: string;
  threadId: string;
  eventId: string;
  item: ConversationItem;
  operation: NormalizedThreadEvent["operation"];
  sourceMethod: string;
  delta?: string | null;
  rawItem?: Record<string, unknown> | null;
  rawUsage?: Record<string, unknown> | null;
  turnId?: string | null;
  timestampMs: number;
}): NormalizedThreadEvent {
  return {
    engine,
    workspaceId,
    threadId,
    eventId,
    itemKind: item.kind,
    timestampMs,
    item,
    operation,
    sourceMethod,
    delta,
    rawItem,
    rawUsage,
    turnId,
  };
}

function normalizeRawCodexEntryType(value: string): "event_msg" | "response_item" | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === "event_msg" || normalized === "response_item") {
    return normalized;
  }
  return null;
}

function buildRawGeneratedImageSnapshot(
  workspaceId: string,
  threadId: string,
  payload: Record<string, unknown>,
): { phase: "started" | "completed" | "native"; item: Record<string, unknown> } {
  const payloadType = asString(payload.type ?? "").trim();
  const resolvedId = asString(
    payload.id ?? payload.call_id ?? payload.callId ?? payload.item_id ?? payload.itemId ?? "",
  ).trim();
  if (payloadType === "function_call") {
    const toolName = asString(payload.name ?? payload.tool ?? "").trim();
    if (!resolvedId || !isGeneratedImageToolName(toolName)) {
      return { phase: "native", item: resolvedId ? { ...payload, id: resolvedId } : payload };
    }
    const argumentsPayload = parseJsonLikeRecord(payload.arguments ?? payload.input ?? {});
    const pendingKey = buildPendingCodexImagegenToolCallKey(
      workspaceId,
      threadId,
      resolvedId,
    );
    pendingCodexImagegenToolCalls.set(pendingKey, {
      argumentsPayload,
      toolName,
    });
    if (pendingCodexImagegenToolCalls.size > MAX_PENDING_CODEX_IMAGEGEN_TOOL_CALLS) {
      const oldestKey = pendingCodexImagegenToolCalls.keys().next().value;
      if (oldestKey) {
        pendingCodexImagegenToolCalls.delete(oldestKey);
      }
    }
    return {
      phase: "started",
      item: {
        type: "mcpToolCall",
        id: resolvedId,
        server: "codex",
        tool: toolName,
        arguments: argumentsPayload,
        status: "in_progress",
      },
    };
  }
  if (payloadType === "function_call_output") {
    const pendingKey = buildPendingCodexImagegenToolCallKey(
      workspaceId,
      threadId,
      resolvedId,
    );
    const pendingCall = pendingCodexImagegenToolCalls.get(pendingKey);
    if (!resolvedId || !pendingCall) {
      return { phase: "native", item: resolvedId ? { ...payload, id: resolvedId } : payload };
    }
    pendingCodexImagegenToolCalls.delete(pendingKey);
    return {
      phase: "completed",
      item: {
        type: "mcpToolCall",
        id: resolvedId,
        server: "codex",
        tool: pendingCall.toolName,
        arguments: pendingCall.argumentsPayload,
        status: "completed",
        output: stringifyUnknown(payload.output ?? payload.result ?? payload.content ?? ""),
      },
    };
  }
  return {
    phase: "native",
    item: resolvedId ? { ...payload, id: resolvedId } : payload,
  };
}

function mapCodexRawGeneratedImageEvent({
  engine,
  workspaceId,
  threadId,
  method,
  params,
  turnId,
  timestampMs,
}: {
  engine: ConversationEngine;
  workspaceId: string;
  threadId: string;
  method: string;
  params: Record<string, unknown>;
  turnId: string;
  timestampMs: number;
}): NormalizedThreadEvent | null {
  if (engine !== "codex" || method !== "codex/raw") {
    return null;
  }
  const rawEntryType = normalizeRawCodexEntryType(asString(params.type ?? ""));
  if (!rawEntryType) {
    return null;
  }
  const rawPayload = asRecord(params.payload);
  if (Object.keys(rawPayload).length === 0) {
    return null;
  }
  const rawSnapshot = buildRawGeneratedImageSnapshot(
    workspaceId,
    threadId,
    rawPayload,
  );
  const rawItem = rawSnapshot.item;
  const converted = buildConversationItem(rawItem);
  if (!converted || converted.kind !== "generatedImage") {
    return null;
  }
  const operation =
    rawSnapshot.phase === "started"
      ? "itemStarted"
      : rawSnapshot.phase === "completed"
        ? "itemCompleted"
        : rawEntryType === "event_msg"
      ? converted.status === "processing"
        ? "itemStarted"
        : "itemUpdated"
      : converted.status === "processing"
        ? "itemUpdated"
        : "itemCompleted";
  return createEvent({
    engine,
    workspaceId,
    threadId,
    eventId: `${converted.id}:${rawEntryType}:${rawSnapshot.phase}:${converted.status}`,
    item: converted,
    operation,
    sourceMethod: method,
    rawItem,
    turnId,
    timestampMs,
  });
}

export function inferEngineFromThreadId(
  threadId: string,
): ConversationEngine {
  if (threadId.startsWith("claude:") || threadId.startsWith("claude-pending-")) {
    return "claude";
  }
  if (threadId.startsWith("gemini:") || threadId.startsWith("gemini-pending-")) {
    return "gemini";
  }
  if (threadId.startsWith("opencode:") || threadId.startsWith("opencode-pending-")) {
    return "opencode";
  }
  return "codex";
}

export function mapCommonRealtimeEvent(
  engine: ConversationEngine,
  input: unknown,
  options: CommonMapOptions = {},
): NormalizedThreadEvent | null {
  const payload = asRecord(input);
  const workspaceId = asString(payload.workspaceId ?? "");
  const message = asRecord(payload.message);
  const method = asString(message.method ?? "");
  if (!workspaceId || !method) {
    return null;
  }
  const params = asRecord(message.params);
  const threadId = resolveThreadId(params);
  const turn = asRecord(params.turn);
  const turnId = asString(params.turnId ?? params.turn_id ?? turn.id ?? "");
  const timestampMs = resolveTimestamp(params);
  if (!threadId) {
    return null;
  }

  const codexRawGeneratedImageEvent = mapCodexRawGeneratedImageEvent({
    engine,
    workspaceId,
    threadId,
    method,
    params,
    turnId,
    timestampMs,
  });
  if (codexRawGeneratedImageEvent) {
    return codexRawGeneratedImageEvent;
  }

  if (method === "processing/heartbeat") {
    // OpenCode heartbeat is presentation-only and MUST NOT become a conversation item.
    return null;
  }

  if (method === "item/agentMessage/delta") {
    const itemId = asString(params.itemId ?? params.item_id ?? "");
    const delta = asString(params.delta ?? "");
    if (!itemId || !delta) {
      return null;
    }
    return createEvent({
      engine,
      workspaceId,
      threadId,
      eventId: `${itemId}:delta`,
      item: {
        id: itemId,
        kind: "message",
        role: "assistant",
        text: delta,
      },
      operation: "appendAgentMessageDelta",
      sourceMethod: method,
      delta,
      turnId,
      timestampMs,
    });
  }

  if (options.allowTextDeltaAlias && (method === "text:delta" || method === "text/delta")) {
    const delta = asString(params.delta ?? params.text ?? "");
    if (!delta) {
      return null;
    }
    const itemId = asString(
      params.itemId ?? params.item_id ?? turn.itemId ?? turn.item_id ?? "",
    );
    const resolvedItemId = itemId || `${threadId}:text-delta`;
    return createEvent({
      engine,
      workspaceId,
      threadId,
      eventId: `${resolvedItemId}:delta`,
      item: {
        id: resolvedItemId,
        kind: "message",
        role: "assistant",
        text: delta,
      },
      operation: "appendAgentMessageDelta",
      sourceMethod: method,
      delta,
      turnId,
      timestampMs,
    });
  }

  if (
    REASONING_SUMMARY_METHODS.has(method) ||
    REASONING_SUMMARY_BOUNDARY_METHODS.has(method) ||
    REASONING_SUMMARY_PART_DONE_METHODS.has(method) ||
    REASONING_CONTENT_METHODS.has(method)
  ) {
    const itemId = resolveReasoningItemId(params);
    if (!itemId) {
      return null;
    }
    if (REASONING_SUMMARY_BOUNDARY_METHODS.has(method)) {
      return createEvent({
        engine,
        workspaceId,
        threadId,
        eventId: `${itemId}:summary-boundary`,
        item: {
          id: itemId,
          kind: "reasoning",
          summary: "",
          content: "",
        },
        operation: "appendReasoningSummaryBoundary",
        sourceMethod: method,
        turnId,
        timestampMs,
      });
    }
    const delta = resolveReasoningDelta(params);
    if (!delta) {
      return null;
    }
    const isSummary =
      REASONING_SUMMARY_METHODS.has(method) ||
      REASONING_SUMMARY_PART_DONE_METHODS.has(method);
    return createEvent({
      engine,
      workspaceId,
      threadId,
      eventId: `${itemId}:${isSummary ? "summary" : "content"}:delta`,
      item: {
        id: itemId,
        kind: "reasoning",
        summary: isSummary ? delta : "",
        content: isSummary ? "" : delta,
      },
      operation: isSummary
        ? "appendReasoningSummaryDelta"
        : "appendReasoningContentDelta",
      sourceMethod: method,
      delta,
      turnId,
      timestampMs,
    });
  }

  if (
    method === "item/commandExecution/outputDelta" ||
    method === "item/fileChange/outputDelta"
  ) {
    const itemId = asString(params.itemId ?? params.item_id ?? "");
    const delta = asString(params.delta ?? "");
    if (!itemId || !delta) {
      return null;
    }
    const toolType = method.includes("fileChange") ? "fileChange" : "commandExecution";
    return createEvent({
      engine,
      workspaceId,
      threadId,
      eventId: `${itemId}:output:delta`,
      item: {
        id: itemId,
        kind: "tool",
        toolType,
        title: toolType === "fileChange" ? "File changes" : "Command",
        detail: "",
        output: delta,
      },
      operation: "appendToolOutputDelta",
      sourceMethod: method,
      delta,
      turnId,
      timestampMs,
    });
  }

  if (method === "item/started" || method === "item/updated" || method === "item/completed") {
    const rawItem = hydrateToolSnapshotWithEventParams(asRecord(params.item), params);
    const rawUsage = asRecord(params.usage);
    const itemType = asString(rawItem.type ?? "");
    const itemId = asString(rawItem.id ?? rawItem.call_id ?? rawItem.callId ?? "");
    if (!itemType || !itemId) {
      return null;
    }
    if (method === "item/completed" && itemType === "agentMessage") {
      const text = asString(rawItem.text ?? "");
      return createEvent({
        engine,
        workspaceId,
        threadId,
        eventId: `${itemId}:completed`,
        item: {
          id: itemId,
          kind: "message",
          role: "assistant",
          text,
        },
        operation: "completeAgentMessage",
        sourceMethod: method,
        rawItem,
        rawUsage: Object.keys(rawUsage).length > 0 ? rawUsage : null,
        turnId,
        timestampMs,
      });
    }
    if (
      (method === "item/started" || method === "item/updated") &&
      itemType === "agentMessage"
    ) {
      const text = asString(
        rawItem.text ?? rawItem.content ?? rawItem.output_text ?? rawItem.outputText ?? "",
      );
      if (!text) {
        return null;
      }
      if (options.agentMessageSnapshotMode === "snapshot") {
        return createEvent({
          engine,
          workspaceId,
          threadId,
          eventId: `${itemId}:${method.split("/")[1]}`,
          item: {
            id: itemId,
            kind: "message",
            role: "assistant",
            text,
          },
          operation: method === "item/started" ? "itemStarted" : "itemUpdated",
          sourceMethod: method,
          rawItem,
          rawUsage: Object.keys(rawUsage).length > 0 ? rawUsage : null,
          turnId,
          timestampMs,
        });
      }
      return createEvent({
        engine,
        workspaceId,
        threadId,
        eventId: `${itemId}:${method.split("/")[1]}`,
        item: {
          id: itemId,
          kind: "message",
          role: "assistant",
          text,
        },
        operation: "appendAgentMessageDelta",
        sourceMethod: method,
        delta: text,
        rawItem,
        rawUsage: Object.keys(rawUsage).length > 0 ? rawUsage : null,
        turnId,
        timestampMs,
      });
    }
    const converted = buildConversationItem(rawItem) ?? buildGenericToolCallItem(rawItem, itemId);
    if (!converted) {
      return null;
    }
    return createEvent({
      engine,
      workspaceId,
      threadId,
      eventId: `${converted.id}:${method.split("/")[1]}`,
      item: converted,
      operation:
        method === "item/started"
          ? "itemStarted"
          : method === "item/updated"
            ? "itemUpdated"
            : "itemCompleted",
      sourceMethod: method,
      rawItem,
      rawUsage: Object.keys(rawUsage).length > 0 ? rawUsage : null,
      turnId,
      timestampMs,
    });
  }

  return null;
}

export type EngineRealtimeAdapter = RealtimeAdapter;
export type { RawRealtimeAdapterInput };
