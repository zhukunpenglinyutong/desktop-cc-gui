import type { SharedSessionSupportedEngine } from "../utils/sharedSessionEngines";
import type { ThreadSummary } from "../../../types";
import { normalizeSharedSessionEngine } from "../utils/sharedSessionEngines";

const NATIVE_OTHER_ENGINE_PREFIXES = [
  "gemini:",
  "gemini-pending-",
  "opencode:",
  "opencode-pending-",
] as const;

type SharedSessionSummary = {
  id: string;
  threadId: string;
  title: string;
  updatedAt: number;
  selectedEngine: SharedSessionSupportedEngine;
  nativeThreadIds: string[];
};

function asString(value: unknown) {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function shouldKeepSharedNativeThreadId(value: unknown) {
  const threadId = asString(value).trim();
  if (!threadId) {
    return false;
  }
  const normalized = threadId.toLowerCase();
  return !NATIVE_OTHER_ENGINE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function normalizeSharedSessionSummary(value: unknown): SharedSessionSummary | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const threadId = asString(record.threadId ?? record.thread_id).trim();
  if (!threadId || !threadId.startsWith("shared:")) {
    return null;
  }
  const selectedEngine = asString(record.selectedEngine ?? record.selected_engine)
    .trim()
    .toLowerCase();
  const normalizedSelectedEngine = normalizeSharedSessionEngine(
    selectedEngine === "codex" || selectedEngine === "claude"
      ? selectedEngine
      : undefined,
  );
  return {
    id: asString(record.id).trim() || threadId,
    threadId,
    title: asString(record.title).trim() || "Shared Session",
    updatedAt: Math.max(0, asNumber(record.updatedAt ?? record.updated_at)),
    selectedEngine: normalizedSelectedEngine,
    nativeThreadIds: Array.isArray(record.nativeThreadIds ?? record.native_thread_ids)
      ? ((record.nativeThreadIds ?? record.native_thread_ids) as unknown[])
          .map((entry: unknown) => asString(entry).trim())
          .filter(shouldKeepSharedNativeThreadId)
      : [],
  };
}

export function normalizeSharedSessionSummaries(value: unknown): SharedSessionSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const summaries: SharedSessionSummary[] = [];
  value.forEach((entry) => {
    const summary = normalizeSharedSessionSummary(entry);
    if (summary) {
      summaries.push(summary);
    }
  });
  return summaries;
}

export function toSharedThreadSummary(summary: SharedSessionSummary): ThreadSummary {
  return {
    id: summary.threadId,
    name: summary.title,
    updatedAt: summary.updatedAt,
    engineSource: summary.selectedEngine,
    threadKind: "shared",
    selectedEngine: summary.selectedEngine,
    nativeThreadIds: summary.nativeThreadIds,
  };
}
