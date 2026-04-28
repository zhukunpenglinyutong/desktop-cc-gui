import type { ConversationItem, ThreadSummary } from "../../../types";
import { previewThreadName } from "../../../utils/threadItems";
import { asNumber, asString } from "../utils/threadNormalize";
import { hasCodexBackgroundHelperPreview } from "../utils/codexBackgroundHelpers";
import { matchesWorkspacePath } from "./useThreadActions.workspacePath";

const CLAUDE_HISTORY_MESSAGE_ID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type MessageConversationItem = Extract<ConversationItem, { kind: "message" }>;
type UserConversationMessage = MessageConversationItem & { role: "user" };
type RewindSupportedEngine = "claude" | "codex";

export type GeminiSessionSummary = {
  sessionId: string;
  firstMessage: string;
  updatedAt: number;
  fileSizeBytes?: number;
};

export type CodexCatalogSessionSummary = {
  sessionId: string;
  title: string;
  updatedAt: number;
  sizeBytes?: number;
  source?: string | null;
  provider?: string | null;
  sourceLabel?: string | null;
};

export function normalizeThreadListPartialSource(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function hasHealthyThreadSummaries(
  threads: ThreadSummary[] | undefined,
): threads is ThreadSummary[] {
  return (
    Array.isArray(threads) &&
    threads.length > 0 &&
    !threads.some((thread) => thread.isDegraded)
  );
}

export function markThreadSummariesDegraded(
  threads: ThreadSummary[],
  partialSource: string,
  degradedReason: string,
): ThreadSummary[] {
  return threads.map((thread) => ({
    ...thread,
    isDegraded: true,
    partialSource,
    degradedReason,
  }));
}

export function isWorkspaceNotConnectedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("workspace not connected");
}

function normalizeThreadResumeErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).trim().toLowerCase();
}

export function isThreadResumeNotFoundError(error: unknown): boolean {
  const message = normalizeThreadResumeErrorMessage(error);
  return (
    message.includes("thread not found") ||
    message.includes("[session_not_found]") ||
    message.includes("session not found") ||
    message.includes("session file not found")
  );
}

export function inferThreadEngineSource(
  threadId: string,
  summary?: ThreadSummary,
): ThreadSummary["engineSource"] {
  if (summary?.engineSource) {
    return summary.engineSource;
  }
  const normalized = threadId.trim().toLowerCase();
  if (normalized.startsWith("claude:") || normalized.startsWith("claude-pending-")) {
    return "claude";
  }
  if (normalized.startsWith("gemini:") || normalized.startsWith("gemini-pending-")) {
    return "gemini";
  }
  if (normalized.startsWith("opencode:") || normalized.startsWith("opencode-pending-")) {
    return "opencode";
  }
  return "codex";
}

function isPendingThreadId(threadId: string): boolean {
  const normalized = threadId.trim().toLowerCase();
  return (
    normalized.startsWith("claude-pending-") ||
    normalized.startsWith("gemini-pending-") ||
    normalized.startsWith("opencode-pending-") ||
    normalized.startsWith("codex-pending-")
  );
}

export function selectReplacementThreadSummary(params: {
  staleThreadId: string;
  summaries: ThreadSummary[];
  staleSummary?: ThreadSummary;
}): ThreadSummary | null {
  const candidates = listReplacementThreadCandidates(params);
  if (candidates.length === 0) {
    return null;
  }
  const scored = scoreReplacementThreadCandidates(params)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return right.entry.updatedAt - left.entry.updatedAt;
    });
  const best = scored[0];
  const next = scored[1];
  if (!best) {
    return null;
  }
  if (best.score > 0 && (!next || next.score < best.score)) {
    return best.entry;
  }
  if (candidates.length === 1) {
    return candidates[0] ?? null;
  }
  return null;
}

export function selectRecoveredNewThreadSummary(params: {
  staleThreadId: string;
  previousSummaries: ThreadSummary[];
  summaries: ThreadSummary[];
  staleSummary?: ThreadSummary;
}): ThreadSummary | null {
  const candidates = listReplacementThreadCandidates(params);
  if (candidates.length === 0) {
    return null;
  }

  const previousIds = new Set(
    params.previousSummaries
      .map((entry) => entry.id.trim())
      .filter(Boolean),
  );
  const newlyDiscoveredCandidates = candidates.filter(
    (entry) => !previousIds.has(entry.id.trim()),
  );
  if (newlyDiscoveredCandidates.length === 1) {
    return newlyDiscoveredCandidates[0] ?? null;
  }

  const staleUpdatedAt =
    typeof params.staleSummary?.updatedAt === "number" &&
    Number.isFinite(params.staleSummary.updatedAt)
      ? params.staleSummary.updatedAt
      : 0;
  if (staleUpdatedAt > 0) {
    const strictlyNewerCandidates = candidates.filter(
      (entry) =>
        typeof entry.updatedAt === "number" &&
        Number.isFinite(entry.updatedAt) &&
        entry.updatedAt > staleUpdatedAt,
    );
    if (strictlyNewerCandidates.length === 1) {
      return strictlyNewerCandidates[0] ?? null;
    }
  }

  return null;
}

function scoreReplacementThreadCandidate(
  entry: ThreadSummary,
  staleSummary?: ThreadSummary,
): number {
  const staleName = staleSummary?.name?.trim() ?? "";
  let score = 0;
  if (staleName && entry.name.trim() === staleName) {
    score += 100;
  }
  if (staleSummary?.source && entry.source && staleSummary.source === entry.source) {
    score += 20;
  }
  if (
    staleSummary?.provider &&
    entry.provider &&
    staleSummary.provider === entry.provider
  ) {
    score += 20;
  }
  if (
    staleSummary?.sourceLabel &&
    entry.sourceLabel &&
    staleSummary.sourceLabel === entry.sourceLabel
  ) {
    score += 20;
  }
  return score;
}

export function listReplacementThreadCandidates(params: {
  staleThreadId: string;
  summaries: ThreadSummary[];
  staleSummary?: ThreadSummary;
}): ThreadSummary[] {
  const { staleThreadId, summaries } = params;
  const staleSummary =
    params.staleSummary ?? summaries.find((entry) => entry.id === staleThreadId);
  const staleEngine = inferThreadEngineSource(staleThreadId, staleSummary);
  return summaries.filter((entry) => {
    if (!entry.id || entry.id === staleThreadId) {
      return false;
    }
    if (entry.threadKind === "shared" || isPendingThreadId(entry.id)) {
      return false;
    }
    return inferThreadEngineSource(entry.id, entry) === staleEngine;
  });
}

export function scoreReplacementThreadCandidates(params: {
  staleThreadId: string;
  summaries: ThreadSummary[];
  staleSummary?: ThreadSummary;
}): Array<{ entry: ThreadSummary; score: number }> {
  const staleSummary =
    params.staleSummary ??
    params.summaries.find((entry) => entry.id === params.staleThreadId);
  return listReplacementThreadCandidates(params).map((entry) => ({
    entry,
    score: scoreReplacementThreadCandidate(entry, staleSummary),
  }));
}

const THREAD_RECOVERY_PATTERNS = [
  "thread not found",
  "[session_not_found]",
  "session not found",
  "session file not found",
] as const;

const THREAD_RECOVERY_ERROR_PREFIXES = [
  "会话启动失败",
  "thread not found",
  "session not found",
  "session file not found",
  "[session_not_found]",
  "failed to start",
  "turn failed to start",
  "session failed to start",
  "error: thread not found",
  "error: session not found",
] as const;

const RUNTIME_PIPE_DISCONNECT_PATTERNS = [
  "broken pipe",
  "the pipe is being closed",
  "the pipe has been ended",
  "os error 32",
  "os error 109",
  "os error 232",
] as const;

function lineLooksLikeThreadRecoveryError(line: string): boolean {
  const lowered = line.toLowerCase();
  if (!THREAD_RECOVERY_PATTERNS.some((pattern) => lowered.includes(pattern))) {
    return false;
  }
  return THREAD_RECOVERY_ERROR_PREFIXES.some((prefix) => lowered.startsWith(prefix));
}

function lineLooksLikeRuntimeReconnectError(line: string): boolean {
  const lowered = line.toLowerCase();
  return (
    RUNTIME_PIPE_DISCONNECT_PATTERNS.some((pattern) => lowered.includes(pattern)) ||
    lowered.includes("workspace not connected") ||
    lineLooksLikeThreadRecoveryError(line)
  );
}

function getRuntimeReconnectCandidate(text: string): string | null {
  const normalized = text.trim();
  if (!normalized) {
    return null;
  }
  const lines = normalized
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return null;
  }
  if (lines.length === 1) {
    return lineLooksLikeRuntimeReconnectError(lines[0] ?? "") ? (lines[0] ?? null) : null;
  }
  if (!lines.every((line) => lineLooksLikeRuntimeReconnectError(line))) {
    return null;
  }
  return lines[0] ?? null;
}

function isTransientReconnectAssistantMessage(item: ConversationItem): boolean {
  if (item.kind !== "message" || item.role !== "assistant") {
    return false;
  }
  return getRuntimeReconnectCandidate(item.text) !== null;
}

function normalizeComparableRecoveryMessageText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function buildComparableRecoveryMessageSignature(
  item: Extract<ConversationItem, { kind: "message" }>,
): string {
  const images = Array.isArray(item.images) ? item.images.join("\u0001") : "";
  return [
    item.role,
    normalizeComparableRecoveryMessageText(item.text),
    images,
  ].join("\u0000");
}

function collectComparableRecoveryMessageSequence(items: ConversationItem[]): string[] {
  return items
    .filter(
      (
        item,
      ): item is Extract<ConversationItem, { kind: "message" }> =>
        item.kind === "message" && !isTransientReconnectAssistantMessage(item),
    )
    .map(buildComparableRecoveryMessageSignature)
    .filter(Boolean);
}

function isComparableMessageSequencePrefix(prefix: string[], target: string[]): boolean {
  if (prefix.length === 0 || prefix.length > target.length) {
    return false;
  }
  return prefix.every((value, index) => value === target[index]);
}

function countComparableMessageSuffixOverlap(left: string[], right: string[]): number {
  const maxLength = Math.min(left.length, right.length);
  let overlap = 0;
  while (overlap < maxLength) {
    const leftIndex = left.length - 1 - overlap;
    const rightIndex = right.length - 1 - overlap;
    if (left[leftIndex] !== right[rightIndex]) {
      break;
    }
    overlap += 1;
  }
  return overlap;
}

function extractComparableRecoveryUserSequence(sequence: string[]): string[] {
  return sequence.filter((signature) => signature.startsWith("user\u0000"));
}

function scoreThreadRecoveryCandidateByMessages(
  staleItems: ConversationItem[],
  candidateItems: ConversationItem[],
): number {
  const staleSequence = collectComparableRecoveryMessageSequence(staleItems);
  const candidateSequence = collectComparableRecoveryMessageSequence(candidateItems);
  if (staleSequence.length === 0 || candidateSequence.length === 0) {
    return 0;
  }
  if (
    staleSequence.length === candidateSequence.length &&
    staleSequence.every((value, index) => value === candidateSequence[index])
  ) {
    return 4_000 + staleSequence.length;
  }
  if (isComparableMessageSequencePrefix(staleSequence, candidateSequence)) {
    return 3_000 + staleSequence.length;
  }
  if (isComparableMessageSequencePrefix(candidateSequence, staleSequence)) {
    return 2_500 + candidateSequence.length;
  }
  const messageSuffixOverlap = countComparableMessageSuffixOverlap(
    staleSequence,
    candidateSequence,
  );
  if (messageSuffixOverlap >= 2) {
    return 2_000 + messageSuffixOverlap;
  }
  const staleUserSequence = extractComparableRecoveryUserSequence(staleSequence);
  const candidateUserSequence = extractComparableRecoveryUserSequence(candidateSequence);
  if (
    staleUserSequence.length > 0 &&
    staleUserSequence.length === candidateUserSequence.length &&
    staleUserSequence.every((value, index) => value === candidateUserSequence[index])
  ) {
    return 1_500 + staleUserSequence.length;
  }
  if (isComparableMessageSequencePrefix(staleUserSequence, candidateUserSequence)) {
    return 1_000 + staleUserSequence.length;
  }
  const userSuffixOverlap = countComparableMessageSuffixOverlap(
    staleUserSequence,
    candidateUserSequence,
  );
  if (userSuffixOverlap >= 1) {
    return 500 + userSuffixOverlap;
  }
  return 0;
}

export function selectReplacementThreadByMessageHistory(params: {
  staleItems: ConversationItem[];
  candidates: Array<{
    summary: ThreadSummary;
    items: ConversationItem[];
  }>;
}): ThreadSummary | null {
  const scored = params.candidates
    .map(({ summary, items }) => ({
      entry: summary,
      score: scoreThreadRecoveryCandidateByMessages(params.staleItems, items),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return right.entry.updatedAt - left.entry.updatedAt;
    });
  const best = scored[0];
  const next = scored[1];
  if (!best) {
    return null;
  }
  if (!next || next.score < best.score) {
    return best.entry;
  }
  return null;
}

export function mergeRecoveredThreadSummaries(
  existingSummaries: ThreadSummary[],
  refreshedSummaries: ThreadSummary[],
  engineSource: ThreadSummary["engineSource"],
): ThreadSummary[] {
  const mergedById = new Map<string, ThreadSummary>();
  existingSummaries.forEach((entry) => {
    if (inferThreadEngineSource(entry.id, entry) !== engineSource) {
      mergedById.set(entry.id, entry);
    }
  });
  refreshedSummaries.forEach((entry) => {
    const previous = mergedById.get(entry.id);
    if (!previous || entry.updatedAt >= previous.updatedAt) {
      mergedById.set(entry.id, entry);
    }
  });
  return Array.from(mergedById.values()).sort((left, right) => right.updatedAt - left.updatedAt);
}

export function isUserConversationMessage(
  item: ConversationItem | undefined,
): item is UserConversationMessage {
  return item?.kind === "message" && item.role === "user";
}

export function normalizeComparableRewindText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function findLastUserMessageIndexById(
  items: UserConversationMessage[],
  messageId: string,
): number {
  const normalizedMessageId = messageId.trim();
  if (!normalizedMessageId) {
    return -1;
  }
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!item) {
      continue;
    }
    if (item.id.trim() === normalizedMessageId) {
      return index;
    }
  }
  return -1;
}

export function resolveClaudeRewindMessageIdFromHistory(params: {
  requestedMessageId: string;
  threadItems: ConversationItem[];
  historyItems: ConversationItem[];
}): string {
  const requestedMessageId = params.requestedMessageId.trim();
  if (!requestedMessageId) {
    return "";
  }
  if (CLAUDE_HISTORY_MESSAGE_ID_REGEX.test(requestedMessageId)) {
    return requestedMessageId;
  }

  const localUserItems = params.threadItems.filter(isUserConversationMessage);
  const targetLocalIndex = localUserItems.findIndex(
    (item) => item.id.trim() === requestedMessageId,
  );
  if (targetLocalIndex < 0) {
    return requestedMessageId;
  }
  const targetLocalItem = localUserItems[targetLocalIndex];
  if (!targetLocalItem) {
    return requestedMessageId;
  }

  const historyUserItems = params.historyItems
    .filter(isUserConversationMessage)
    .map((item) => ({
      id: item.id.trim(),
      text: normalizeComparableRewindText(item.text),
    }))
    .filter((item) => item.id.length > 0);
  if (historyUserItems.length < 1) {
    return requestedMessageId;
  }
  if (historyUserItems.some((item) => item.id === requestedMessageId)) {
    return requestedMessageId;
  }

  const targetText = normalizeComparableRewindText(targetLocalItem.text);
  if (targetText) {
    const targetOccurrenceByText =
      localUserItems.reduce((count, item, index) => {
        if (index > targetLocalIndex) {
          return count;
        }
        return normalizeComparableRewindText(item.text) === targetText
          ? count + 1
          : count;
      }, 0) || 1;
    const historyMatches = historyUserItems.filter(
      (item) => item.text === targetText,
    );
    if (historyMatches.length >= targetOccurrenceByText) {
      return historyMatches[targetOccurrenceByText - 1]?.id ?? requestedMessageId;
    }
    if (historyMatches.length > 0) {
      return historyMatches[historyMatches.length - 1]?.id ?? requestedMessageId;
    }
  }

  const positionFromLatest = localUserItems.length - 1 - targetLocalIndex;
  const fallbackIndex = historyUserItems.length - 1 - positionFromLatest;
  if (fallbackIndex >= 0 && fallbackIndex < historyUserItems.length) {
    return historyUserItems[fallbackIndex]?.id ?? requestedMessageId;
  }
  return historyUserItems[historyUserItems.length - 1]?.id ?? requestedMessageId;
}

export function findLatestHistoryUserMessageId(items: ConversationItem[]): string {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!isUserConversationMessage(item)) {
      continue;
    }
    const id = item.id.trim();
    if (!id) {
      continue;
    }
    return id;
  }
  return "";
}

export function findFirstHistoryUserMessageId(items: ConversationItem[]): string {
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!isUserConversationMessage(item)) {
      continue;
    }
    const id = item.id.trim();
    if (!id) {
      continue;
    }
    return id;
  }
  return "";
}

function normalizeThreadSizeBytes(value: unknown) {
  const sizeBytes = asNumber(value);
  return sizeBytes > 0 ? Math.round(sizeBytes) : undefined;
}

export function extractThreadSizeBytes(record: Record<string, unknown>) {
  return normalizeThreadSizeBytes(
    record.sizeBytes ??
      record.size_bytes ??
      record.fileSizeBytes ??
      record.file_size_bytes ??
      record.byteSize ??
      record.byte_size ??
      record.bytes,
  );
}

function normalizeGeminiSessionSummary(value: unknown): GeminiSessionSummary | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const sessionId = asString(record.sessionId ?? record.session_id).trim();
  if (!sessionId) {
    return null;
  }
  const fileSizeBytes = extractThreadSizeBytes(record);
  return {
    sessionId,
    firstMessage: asString(record.firstMessage ?? record.first_message).trim(),
    updatedAt: asNumber(record.updatedAt ?? record.updated_at),
    ...(fileSizeBytes !== undefined ? { fileSizeBytes } : {}),
  };
}

export function normalizeGeminiSessionSummaries(value: unknown): GeminiSessionSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const summaries: GeminiSessionSummary[] = [];
  value.forEach((entry) => {
    const summary = normalizeGeminiSessionSummary(entry);
    if (summary) {
      summaries.push(summary);
    }
  });
  return summaries;
}

export function mergeGeminiSessionSummaries(
  baseSummaries: ThreadSummary[],
  geminiSessions: GeminiSessionSummary[],
  workspaceId: string,
  mappedTitles: Record<string, string>,
  getCustomName: (workspaceId: string, threadId: string) => string | undefined,
): ThreadSummary[] {
  if (geminiSessions.length === 0) {
    return baseSummaries;
  }
  const mergedById = new Map<string, ThreadSummary>();
  baseSummaries.forEach((entry) => mergedById.set(entry.id, entry));
  geminiSessions.forEach((session) => {
    const id = `gemini:${session.sessionId}`;
    const prev = mergedById.get(id);
    const updatedAt = Number.isFinite(session.updatedAt)
      ? Math.max(0, session.updatedAt)
      : 0;
    const next: ThreadSummary = {
      id,
      name:
        mappedTitles[id] ||
        getCustomName(workspaceId, id) ||
        previewThreadName(session.firstMessage, "Gemini Session"),
      updatedAt,
      sizeBytes: session.fileSizeBytes,
      engineSource: "gemini",
    };
    if (!prev || next.updatedAt >= prev.updatedAt) {
      mergedById.set(id, next);
    }
  });
  return Array.from(mergedById.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function mergeCodexCatalogSessionSummaries(
  baseSummaries: ThreadSummary[],
  codexSessions: CodexCatalogSessionSummary[],
  workspaceId: string,
  mappedTitles: Record<string, string>,
  getCustomName: (workspaceId: string, threadId: string) => string | undefined,
): ThreadSummary[] {
  if (codexSessions.length === 0) {
    return baseSummaries;
  }
  const mergedById = new Map<string, ThreadSummary>();
  baseSummaries.forEach((entry) => mergedById.set(entry.id, entry));
  codexSessions.forEach((session) => {
    const title = session.title.trim();
    if (!title || hasCodexBackgroundHelperPreview([title])) {
      return;
    }
    const prev = mergedById.get(session.sessionId);
    const updatedAt = Number.isFinite(session.updatedAt)
      ? Math.max(0, session.updatedAt)
      : 0;
    const next: ThreadSummary = {
      id: session.sessionId,
      name:
        mappedTitles[session.sessionId] ||
        getCustomName(workspaceId, session.sessionId) ||
        previewThreadName(title, "Codex Session"),
      updatedAt,
      sizeBytes: session.sizeBytes,
      engineSource: "codex",
      threadKind: "native",
      source: session.source ?? undefined,
      provider: session.provider ?? undefined,
      sourceLabel: session.sourceLabel ?? undefined,
    };
    if (!prev || next.updatedAt >= prev.updatedAt) {
      mergedById.set(session.sessionId, next);
    }
  });
  return Array.from(mergedById.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

function isPendingCodexThreadId(threadId: string): boolean {
  return threadId.trim().toLowerCase().startsWith("codex-pending-");
}

function isRetainableCodexContinuitySummary(summary: ThreadSummary): boolean {
  if (inferThreadEngineSource(summary.id, summary) !== "codex") {
    return false;
  }
  if (summary.threadKind === "shared") {
    return false;
  }
  if (isPendingCodexThreadId(summary.id)) {
    return false;
  }
  if ((summary.archivedAt ?? 0) > 0) {
    return false;
  }
  return true;
}

export function shouldApplyCodexSidebarContinuity(partialSource: string | null): boolean {
  if (!partialSource) {
    return false;
  }
  const normalized = partialSource.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized.includes("thread-list")
    || normalized.includes("codex")
    || normalized.includes("workspace-not-connected")
    || normalized.includes("runtime unavailable")
    || normalized.includes("guarded-recovery")
    || normalized.includes("local-session-scan")
  );
}

export function mergeDegradedCodexContinuitySummaries(
  baseSummaries: ThreadSummary[],
  fallbackSummaries: ThreadSummary[],
): ThreadSummary[] {
  if (fallbackSummaries.length === 0) {
    return baseSummaries;
  }
  const mergedById = new Map<string, ThreadSummary>();
  baseSummaries.forEach((entry) => mergedById.set(entry.id, entry));
  fallbackSummaries.forEach((entry) => {
    if (!isRetainableCodexContinuitySummary(entry) || mergedById.has(entry.id)) {
      return;
    }
    mergedById.set(entry.id, entry);
  });
  return Array.from(mergedById.values()).sort((left, right) => right.updatedAt - left.updatedAt);
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export async function mapWithConcurrency<T>(
  items: string[],
  concurrency: number,
  worker: (item: string) => Promise<T>,
): Promise<T[]> {
  if (items.length === 0) {
    return [];
  }
  const normalizedConcurrency = Math.max(1, Math.floor(concurrency));
  const results: T[] = [];
  let cursor = 0;
  const runWorker = async () => {
    while (cursor < items.length) {
      const currentIndex = cursor;
      cursor += 1;
      const item = items[currentIndex];
      if (!item) {
        continue;
      }
      const result = await worker(item);
      results.push(result);
    }
  };
  const workers = Array.from(
    { length: Math.min(normalizedConcurrency, items.length) },
    () => runWorker(),
  );
  await Promise.all(workers);
  return results;
}

export function resolveRewindSupportedEngine(
  threadId: string,
): RewindSupportedEngine | null {
  const normalized = threadId.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized.startsWith("claude:")) {
    return "claude";
  }
  if (normalized.startsWith("codex:")) {
    return "codex";
  }
  if (
    normalized.startsWith("claude-pending-") ||
    normalized.startsWith("codex-pending-") ||
    normalized.startsWith("gemini:") ||
    normalized.startsWith("gemini-pending-") ||
    normalized.startsWith("opencode:") ||
    normalized.startsWith("opencode-pending-")
  ) {
    return null;
  }
  if (normalized.includes(":")) {
    return null;
  }
  return "codex";
}

export function isLocalSessionScanUnavailable(result: Record<string, unknown>): boolean {
  const marker = asString(result.partialSource ?? result.partial_source)
    .trim()
    .toLowerCase();
  return marker === "local-session-scan-unavailable";
}

export function shouldIncludeWorkspaceThreadEntry(
  thread: Record<string, unknown>,
  workspacePath: string,
  knownCodexThreadIds: Set<string>,
  allowKnownCodexWithoutCwd: boolean,
): boolean {
  const threadCwd = asString(thread.cwd).trim();
  if (matchesWorkspacePath(threadCwd, workspacePath)) {
    return shouldIncludeThreadEntry(thread);
  }
  if (!allowKnownCodexWithoutCwd || threadCwd.length > 0) {
    return false;
  }
  const threadId = asString(thread.id).trim();
  if (!threadId || !knownCodexThreadIds.has(threadId)) {
    return false;
  }
  return shouldIncludeThreadEntry(thread);
}

function toBooleanFlag(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes";
  }
  return false;
}

function isArchivedThread(thread: Record<string, unknown>): boolean {
  const archivedFlag = toBooleanFlag(thread.archived ?? thread.isArchived);
  if (archivedFlag) {
    return true;
  }
  return asNumber(thread.archivedAt ?? thread.archived_at) > 0;
}

function normalizeThreadMetaValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function resolveThreadSourceMeta(thread: Record<string, unknown>): Pick<
  ThreadSummary,
  "source" | "provider" | "sourceLabel"
> {
  const source =
    normalizeThreadMetaValue(thread.source) ??
    normalizeThreadMetaValue(thread.sessionSource);
  const provider =
    normalizeThreadMetaValue(thread.provider) ??
    normalizeThreadMetaValue(thread.providerId) ??
    normalizeThreadMetaValue(thread.sessionProvider);
  const sourceLabel =
    normalizeThreadMetaValue(thread.sourceLabel) ??
    (source && provider ? `${source}/${provider}` : source ?? provider);
  return {
    source,
    provider,
    sourceLabel,
  };
}

function shouldIncludeThreadEntry(thread: Record<string, unknown>): boolean {
  if (isArchivedThread(thread)) {
    return false;
  }
  const previewCandidates = [
    asString(thread.preview).trim(),
    asString(thread.title).trim(),
    asString(thread.name).trim(),
  ].filter(Boolean);
  const isCodexHelperThread = hasCodexBackgroundHelperPreview(previewCandidates);
  if (isCodexHelperThread) {
    return false;
  }
  return true;
}

function parseCollabLinkDetail(detail: string, fallbackParentId: string) {
  const trimmed = detail.trim();
  if (!trimmed) {
    return null;
  }
  const hasUnicodeArrow = trimmed.includes("→");
  const hasAsciiArrow = !hasUnicodeArrow && trimmed.includes("->");
  if (!hasUnicodeArrow && !hasAsciiArrow) {
    return null;
  }
  const [leftSideRaw, rightSideRaw] = hasUnicodeArrow
    ? trimmed.split("→", 2)
    : trimmed.split("->", 2);
  const leftSide = (leftSideRaw ?? "").trim();
  const rightSide = (rightSideRaw ?? "").trim();
  const parentMatch = leftSide.match(/^From\s+(.+)$/i);
  const parentId = (parentMatch?.[1]?.trim() || fallbackParentId).trim();
  const childIds = rightSide
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!parentId || childIds.length === 0) {
    return null;
  }
  return { parentId, childIds };
}

export function restoreThreadParentLinksFromSnapshot(
  threadId: string,
  items: ConversationItem[],
  updateThreadParent?: (parentId: string, childIds: string[]) => void,
) {
  if (!updateThreadParent) {
    return;
  }
  items.forEach((item) => {
    if (item.kind !== "tool" || item.toolType !== "collabToolCall") {
      return;
    }
    const parsedLink = parseCollabLinkDetail(item.detail, threadId);
    if (!parsedLink) {
      return;
    }
    updateThreadParent(parsedLink.parentId, parsedLink.childIds);
  });
}

export function collectRelatedThreadIdsFromSnapshot(threadId: string, items: ConversationItem[]) {
  const relatedThreadIds = new Set<string>();
  items.forEach((item) => {
    if (item.kind !== "tool" || item.toolType !== "collabToolCall") {
      return;
    }
    const parsedLink = parseCollabLinkDetail(item.detail, threadId);
    if (!parsedLink) {
      return;
    }
    parsedLink.childIds.forEach((childId) => {
      if (!childId || childId === threadId) {
        return;
      }
      relatedThreadIds.add(childId);
    });
  });
  return Array.from(relatedThreadIds);
}

export function isAskUserQuestionToolItem(
  item: ConversationItem,
): item is Extract<ConversationItem, { kind: "tool" }> {
  if (item.kind !== "tool") {
    return false;
  }
  const normalizedToolType = item.toolType.trim().toLowerCase();
  if (
    normalizedToolType === "askuserquestion" ||
    normalizedToolType === "ask_user_question"
  ) {
    return true;
  }
  const normalizedTitle = item.title.trim().toLowerCase();
  return (
    normalizedTitle.includes("askuserquestion") ||
    normalizedTitle.includes("ask_user_question")
  );
}

export function isTerminalToolStatus(status?: string) {
  if (!status) {
    return false;
  }
  const normalized = status.trim().toLowerCase();
  return /(complete|completed|success|succeed(?:ed)?|done|finish(?:ed)?|fail|error|cancel(?:led)?|abort|timeout|timed[_ -]?out)/.test(
    normalized,
  );
}

export function shouldReplaceUserInputQueueFromSnapshot(
  items: ConversationItem[],
  queueLength: number,
  hasLocalPendingQueue: boolean,
) {
  if (queueLength > 0) {
    return true;
  }
  const hasSubmittedRecord = items.some(
    (item) => item.kind === "tool" && item.toolType === "requestUserInputSubmitted",
  );
  if (hasSubmittedRecord) {
    return true;
  }
  if (hasLocalPendingQueue) {
    return false;
  }
  return true;
}
