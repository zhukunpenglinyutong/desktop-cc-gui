import type {
  ConversationState,
  NormalizedHistorySnapshot,
  NormalizedThreadEvent,
} from "./conversationCurtainContracts";
import type { ConversationItem } from "../../../types";
import { normalizeItem } from "../../../utils/threadItems";

export const CONVERSATION_STATE_DIFF_WHITELIST = [
  "meta.heartbeatPulse",
  "meta.historyRestoredAtMs",
] as const;

function upsertItem(items: ConversationItem[], next: ConversationItem): ConversationItem[] {
  const normalizedNext = normalizeItem(next);
  const index = items.findIndex((item) => item.id === next.id);
  if (index < 0) {
    return [...items, normalizedNext];
  }
  const copy = [...items];
  copy[index] = normalizedNext;
  return copy;
}

function mergeToolSnapshot(
  existing: Extract<ConversationItem, { kind: "tool" }>,
  incoming: Extract<ConversationItem, { kind: "tool" }>,
): Extract<ConversationItem, { kind: "tool" }> {
  const incomingOutput = incoming.output ?? "";
  const incomingDetail = incoming.detail ?? "";
  const incomingTitle = incoming.title ?? "";
  const incomingChanges = incoming.changes ?? [];
  return {
    ...existing,
    ...incoming,
    title: incomingTitle || existing.title,
    detail: incomingDetail || existing.detail,
    output: incomingOutput || existing.output,
    changes: incomingChanges.length > 0 ? incomingChanges : existing.changes,
  };
}

function compactComparableReasoningText(value: string): string {
  return value
    .replace(/\s+/g, "")
    .replace(/[！!]/g, "!")
    .replace(/[？?]/g, "?")
    .replace(/[，,]/g, ",")
    .replace(/[。．.]/g, ".");
}

function sliceByComparableLength(text: string, targetLength: number): string {
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

function appendReasoningSnapshotText(existing: string, incoming: string): string {
  if (!incoming) {
    return existing;
  }
  if (!existing) {
    return incoming;
  }
  const comparableExisting = compactComparableReasoningText(existing);
  const comparableIncoming = compactComparableReasoningText(incoming);
  if (!comparableExisting || !comparableIncoming) {
    return `${existing}${incoming}`;
  }
  if (comparableExisting === comparableIncoming) {
    return existing;
  }
  const maxOverlap = Math.min(comparableExisting.length, comparableIncoming.length);
  for (let overlapLength = maxOverlap; overlapLength > 0; overlapLength -= 1) {
    if (!comparableExisting.endsWith(comparableIncoming.slice(0, overlapLength))) {
      continue;
    }
    const suffix = sliceByComparableLength(incoming, overlapLength);
    return suffix ? `${existing}${suffix}` : existing;
  }
  return `${existing}\n\n${incoming}`;
}

function mergeReasoningSnapshotForClaude(
  existing: Extract<ConversationItem, { kind: "reasoning" }>,
  incoming: Extract<ConversationItem, { kind: "reasoning" }>,
): Extract<ConversationItem, { kind: "reasoning" }> {
  return {
    ...existing,
    ...incoming,
    summary: appendReasoningSnapshotText(existing.summary, incoming.summary),
    content: appendReasoningSnapshotText(existing.content, incoming.content),
  };
}

function upsertSnapshotItem(
  items: ConversationItem[],
  next: ConversationItem,
  event: NormalizedThreadEvent,
): ConversationItem[] {
  const existing = items.find((item) => item.id === next.id);
  if (!existing || existing.kind !== "tool" || next.kind !== "tool") {
    if (
      existing &&
      existing.kind === "reasoning" &&
      next.kind === "reasoning" &&
      event.engine === "claude"
    ) {
      return upsertItem(items, mergeReasoningSnapshotForClaude(existing, next));
    }
    return upsertItem(items, next);
  }
  return upsertItem(items, mergeToolSnapshot(existing, next));
}

function compactComparableAssistantText(value: string): string {
  return value
    .replace(/\s+/g, "")
    .replace(/[！!]/g, "!")
    .replace(/[？?]/g, "?")
    .replace(/[，,]/g, ",")
    .replace(/[。．.]/g, ".");
}

function mergeAssistantDeltaText(existing: string, delta: string): string {
  if (!delta) {
    return existing;
  }
  if (!existing) {
    return delta;
  }
  if (delta === existing) {
    return existing;
  }
  if (delta.startsWith(existing) && delta.length >= existing.length) {
    return delta;
  }
  if (existing.startsWith(delta) && existing.length >= delta.length) {
    return existing;
  }
  const comparableExisting = compactComparableAssistantText(existing);
  const comparableDelta = compactComparableAssistantText(delta);
  if (!comparableExisting || !comparableDelta) {
    return `${existing}${delta}`;
  }
  if (comparableDelta === comparableExisting) {
    return existing.length >= delta.length ? existing : delta;
  }
  if (comparableDelta.startsWith(comparableExisting)) {
    return delta;
  }
  if (comparableExisting.startsWith(comparableDelta)) {
    return existing;
  }
  return `${existing}${delta}`;
}

function mergeAssistantCompletedText(existing: string, completed: string): string {
  if (!completed) {
    return existing;
  }
  if (!existing) {
    return completed;
  }
  if (completed === existing) {
    return existing;
  }
  const comparableExisting = compactComparableAssistantText(existing);
  const comparableCompleted = compactComparableAssistantText(completed);
  if (!comparableExisting || !comparableCompleted) {
    return completed;
  }
  if (comparableCompleted === comparableExisting) {
    return completed.length >= existing.length ? completed : existing;
  }
  if (comparableCompleted.startsWith(comparableExisting)) {
    return completed;
  }
  if (comparableExisting.startsWith(comparableCompleted)) {
    return existing;
  }
  return completed;
}

function appendMessageDelta(
  items: ConversationItem[],
  event: NormalizedThreadEvent,
): ConversationItem[] {
  const delta = event.delta ?? (event.item.kind === "message" ? event.item.text : "");
  if (!delta) {
    return items;
  }
  const existing = items.find((item) => item.id === event.item.id);
  if (!existing || existing.kind !== "message") {
    return upsertItem(items, {
      id: event.item.id,
      kind: "message",
      role: "assistant",
      text: delta,
    });
  }
  return upsertItem(items, {
    ...existing,
    text: mergeAssistantDeltaText(existing.text, delta),
  });
}

function appendReasoningSummaryDelta(
  items: ConversationItem[],
  event: NormalizedThreadEvent,
): ConversationItem[] {
  const delta = event.delta ?? "";
  if (!delta) {
    return items;
  }
  const existing = items.find((item) => item.id === event.item.id);
  if (!existing || existing.kind !== "reasoning") {
    return upsertItem(items, {
      id: event.item.id,
      kind: "reasoning",
      summary: delta,
      content: "",
    });
  }
  return upsertItem(items, {
    ...existing,
    summary: `${existing.summary}${delta}`,
  });
}

function appendReasoningContentDelta(
  items: ConversationItem[],
  event: NormalizedThreadEvent,
): ConversationItem[] {
  const delta = event.delta ?? "";
  if (!delta) {
    return items;
  }
  const existing = items.find((item) => item.id === event.item.id);
  if (!existing || existing.kind !== "reasoning") {
    return upsertItem(items, {
      id: event.item.id,
      kind: "reasoning",
      summary: "",
      content: delta,
    });
  }
  return upsertItem(items, {
    ...existing,
    content: `${existing.content}${delta}`,
  });
}

function appendToolOutputDelta(
  items: ConversationItem[],
  event: NormalizedThreadEvent,
): ConversationItem[] {
  if (event.item.kind !== "tool") {
    return items;
  }
  const delta = event.delta ?? "";
  if (!delta) {
    return items;
  }
  const existing = items.find((item) => item.id === event.item.id);
  if (!existing || existing.kind !== "tool") {
    return upsertItem(items, {
      ...event.item,
      output: delta,
      status: event.item.status ?? "started",
    });
  }
  return upsertItem(items, {
    ...existing,
    output: `${existing.output ?? ""}${delta}`,
  });
}

function completeAssistantMessage(
  items: ConversationItem[],
  event: NormalizedThreadEvent,
): ConversationItem[] {
  if (event.item.kind !== "message") {
    return items;
  }
  const existing = items.find((item) => item.id === event.item.id);
  if (!existing || existing.kind !== "message") {
    return upsertItem(items, event.item);
  }
  const nextText = mergeAssistantCompletedText(existing.text, event.item.text);
  return upsertItem(items, {
    ...existing,
    text: nextText,
  });
}

export function appendEvent(
  state: ConversationState,
  event: NormalizedThreadEvent,
): ConversationState {
  let items = state.items;
  switch (event.operation) {
    case "itemStarted":
    case "itemUpdated":
    case "itemCompleted":
      items = upsertSnapshotItem(items, event.item, event);
      break;
    case "appendAgentMessageDelta":
      items = appendMessageDelta(items, event);
      break;
    case "completeAgentMessage":
      items = completeAssistantMessage(items, event);
      break;
    case "appendReasoningSummaryDelta":
      items = appendReasoningSummaryDelta(items, event);
      break;
    case "appendReasoningSummaryBoundary":
      break;
    case "appendReasoningContentDelta":
      items = appendReasoningContentDelta(items, event);
      break;
    case "appendToolOutputDelta":
      items = appendToolOutputDelta(items, event);
      break;
    default:
      break;
  }
  return {
    ...state,
    items,
    meta: {
      ...state.meta,
      activeTurnId: event.turnId ?? state.meta.activeTurnId,
    },
  };
}

export function hydrateHistory(snapshot: NormalizedHistorySnapshot): ConversationState {
  const indexByItemId = new Map<string, number>();
  const deduped: ConversationItem[] = [];
  for (const item of snapshot.items) {
    const normalized = normalizeItem(item);
    const index = indexByItemId.get(item.id);
    if (typeof index === "number") {
      deduped[index] = normalized;
      continue;
    }
    indexByItemId.set(item.id, deduped.length);
    deduped.push(normalized);
  }
  return {
    items: deduped,
    plan: snapshot.plan,
    userInputQueue: [...snapshot.userInputQueue],
    meta: snapshot.meta,
  };
}

function flattenComparablePaths(
  prefix: string,
  value: unknown,
  output: Map<string, string>,
): void {
  if (Array.isArray(value)) {
    output.set(prefix, JSON.stringify(value));
    return;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      output.set(prefix, "{}");
      return;
    }
    for (const [key, nested] of entries) {
      const path = prefix ? `${prefix}.${key}` : key;
      flattenComparablePaths(path, nested, output);
    }
    return;
  }
  output.set(prefix, JSON.stringify(value));
}

export function findConversationStateDiffs(
  realtime: ConversationState,
  history: ConversationState,
): string[] {
  const realtimePaths = new Map<string, string>();
  const historyPaths = new Map<string, string>();
  flattenComparablePaths("", realtime, realtimePaths);
  flattenComparablePaths("", history, historyPaths);
  const allPaths = new Set([...realtimePaths.keys(), ...historyPaths.keys()]);
  const whitelist = new Set<string>(CONVERSATION_STATE_DIFF_WHITELIST);
  const diffs = new Set<string>();
  for (const path of allPaths) {
    const left = realtimePaths.get(path);
    const right = historyPaths.get(path);
    if (left === right) {
      continue;
    }
    if (whitelist.has(path)) {
      continue;
    }
    const semanticPath = path.includes(".") ? path.slice(0, path.indexOf(".")) : path;
    if (semanticPath && semanticPath !== "meta") {
      diffs.add(semanticPath);
    } else if (path && !whitelist.has(path)) {
      diffs.add(path);
    }
  }
  return Array.from(diffs).sort();
}
