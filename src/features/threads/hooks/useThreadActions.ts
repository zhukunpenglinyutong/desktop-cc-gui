import { useCallback, useRef } from "react";
import type { Dispatch, MutableRefObject } from "react";
import type {
  ConversationItem,
  DebugEntry,
  ThreadSummary,
  WorkspaceInfo,
} from "../../../types";
import {
  archiveThread as archiveThreadService,
  deleteCodexSession as deleteCodexSessionService,
  deleteClaudeSession as deleteClaudeSessionService,
  deleteGeminiSession as deleteGeminiSessionService,
  deleteOpenCodeSession as deleteOpenCodeSessionService,
  connectWorkspace as connectWorkspaceService,
  forkClaudeSession as forkClaudeSessionService,
  forkClaudeSessionFromMessage as forkClaudeSessionFromMessageService,
  forkThread as forkThreadService,
  rewindCodexThread as rewindCodexThreadService,
  listThreadTitles as listThreadTitlesService,
  listThreads as listThreadsService,
  listClaudeSessions as listClaudeSessionsService,
  listGeminiSessions as listGeminiSessionsService,
  getOpenCodeSessionList as getOpenCodeSessionListService,
  loadClaudeSession as loadClaudeSessionService,
  loadGeminiSession as loadGeminiSessionService,
  loadCodexSession as loadCodexSessionService,
  renameThreadTitleKey as renameThreadTitleKeyService,
  setThreadTitle as setThreadTitleService,
  resumeThread as resumeThreadService,
  startThread as startThreadService,
} from "../../../services/tauri";
import {
  buildItemsFromThread,
  getThreadTimestamp,
  isReviewingFromThread,
  mergeThreadItems,
  previewThreadName,
} from "../../../utils/threadItems";
import {
  createClaudeHistoryLoader,
  parseClaudeHistoryMessages,
} from "../loaders/claudeHistoryLoader";
import { createCodexHistoryLoader } from "../loaders/codexHistoryLoader";
import { createGeminiHistoryLoader } from "../loaders/geminiHistoryLoader";
import { parseGeminiHistoryMessages } from "../loaders/geminiHistoryParser";
import { createOpenCodeHistoryLoader } from "../loaders/opencodeHistoryLoader";
import { createSharedHistoryLoader } from "../loaders/sharedHistoryLoader";
import {
  deleteSharedSession as deleteSharedSessionService,
  listSharedSessions as listSharedSessionsService,
  loadSharedSession as loadSharedSessionService,
  startSharedSession as startSharedSessionService,
} from "../../shared-session/services/sharedSessions";
import {
  normalizeSharedSessionSummaries,
  toSharedThreadSummary,
} from "../../shared-session/runtime/sharedSessionSummaries";
import { normalizeSharedSessionEngine } from "../../shared-session/utils/sharedSessionEngines";
import {
  asString,
  asNumber,
} from "../utils/threadNormalize";
import {
  saveThreadActivity,
} from "../utils/threadStorage";
import {
  applyClaudeRewindWorkspaceRestore,
  findImpactedClaudeRewindItems,
  restoreClaudeRewindWorkspaceSnapshots,
} from "../utils/claudeRewindRestore";
import {
  collectKnownCodexThreadIds,
  matchesWorkspacePath,
  normalizeComparableWorkspacePath,
} from "./useThreadActions.workspacePath";
import {
  normalizeRewindMode,
  shouldRestoreWorkspaceFiles,
  shouldRewindMessages,
  type RewindMode,
} from "../utils/rewindMode";
import type { ThreadAction, ThreadState } from "./useThreadsReducer";

type UseThreadActionsOptions = {
  dispatch: Dispatch<ThreadAction>;
  itemsByThread: ThreadState["itemsByThread"];
  userInputRequests: ThreadState["userInputRequests"];
  threadsByWorkspace: ThreadState["threadsByWorkspace"];
  activeThreadIdByWorkspace: ThreadState["activeThreadIdByWorkspace"];
  threadListCursorByWorkspace: ThreadState["threadListCursorByWorkspace"];
  threadStatusById: ThreadState["threadStatusById"];
  onDebug?: (entry: DebugEntry) => void;
  getCustomName: (workspaceId: string, threadId: string) => string | undefined;
  threadActivityRef: MutableRefObject<Record<string, Record<string, number>>>;
  loadedThreadsRef: MutableRefObject<Record<string, boolean>>;
  replaceOnResumeRef: MutableRefObject<Record<string, boolean>>;
  applyCollabThreadLinksFromThread: (
    threadId: string,
    thread: Record<string, unknown>,
  ) => void;
  updateThreadParent?: (parentId: string, childIds: string[]) => void;
  onThreadTitleMappingsLoaded?: (
    workspaceId: string,
    titles: Record<string, string>,
  ) => void;
  onRenameThreadTitleMapping?: (
    workspaceId: string,
    oldThreadId: string,
    newThreadId: string,
  ) => void;
  useUnifiedHistoryLoader?: boolean;
};

const THREAD_LIST_TARGET_COUNT = 50;
const THREAD_LIST_PAGE_SIZE = 50;
const THREAD_LIST_MAX_EMPTY_PAGES = 5;
const THREAD_LIST_MAX_EMPTY_PAGES_WITH_ACTIVITY = 20;
const THREAD_LIST_MAX_TOTAL_PAGES = 40;
const THREAD_LIST_MAX_EMPTY_PAGES_LOAD_OLDER = 10;
const THREAD_LIST_MAX_FETCH_DURATION_MS = 1_500;
const RELATED_THREAD_LOAD_CONCURRENCY = 2;
const DEFAULT_CLAUDE_CONTEXT_WINDOW = 200_000;
const GEMINI_SESSION_CACHE_TTL_MS = 60_000;
const GEMINI_SESSION_FETCH_TIMEOUT_MS = 800;
const CLAUDE_HISTORY_MESSAGE_ID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type MessageConversationItem = Extract<ConversationItem, { kind: "message" }>;
type UserConversationMessage = MessageConversationItem & { role: "user" };
const CODEX_BACKGROUND_HELPER_PROMPT_PREFIXES = [
  "Generate a concise title for a coding chat thread from the first user message.",
  "You create concise run metadata for a coding task.",
  "You are generating OpenSpec project context.",
  "请生成一次提交（commit）信息，提交信息需遵循 Conventional Commits 规范，并且全部使用中文。",
  "Please generate a commit message. The commit message must follow the Conventional Commits specification and be written entirely in English.",
  "Generate a concise git commit message for the following changes.",
] as const;

function isWorkspaceNotConnectedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("workspace not connected");
}

function isUserConversationMessage(
  item: ConversationItem | undefined,
): item is UserConversationMessage {
  return item?.kind === "message" && item.role === "user";
}

function normalizeComparableRewindText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function findLastUserMessageIndexById(
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

function resolveClaudeRewindMessageIdFromHistory(params: {
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

function findLatestHistoryUserMessageId(items: ConversationItem[]): string {
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

function findFirstHistoryUserMessageId(items: ConversationItem[]): string {
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

type GeminiSessionSummary = {
  sessionId: string;
  firstMessage: string;
  updatedAt: number;
  fileSizeBytes?: number;
};


function normalizeThreadSizeBytes(value: unknown) {
  const sizeBytes = asNumber(value);
  return sizeBytes > 0 ? Math.round(sizeBytes) : undefined;
}

function extractThreadSizeBytes(record: Record<string, unknown>) {
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

function normalizeGeminiSessionSummaries(value: unknown): GeminiSessionSummary[] {
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


function mergeGeminiSessionSummaries(
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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
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

async function mapWithConcurrency<T>(
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

type RewindSupportedEngine = "claude" | "codex";
type RewindFromMessageOptions = {
  activate?: boolean;
  mode?: RewindMode;
};

function resolveRewindSupportedEngine(
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

function isLocalSessionScanUnavailable(result: Record<string, unknown>): boolean {
  const marker = asString(result.partialSource ?? result.partial_source)
    .trim()
    .toLowerCase();
  return marker === "local-session-scan-unavailable";
}

function shouldIncludeWorkspaceThreadEntry(
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

function resolveThreadSourceMeta(thread: Record<string, unknown>): Pick<
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
  const isCodexHelperThread = previewCandidates.some((preview) =>
    CODEX_BACKGROUND_HELPER_PROMPT_PREFIXES.some((prefix) =>
      preview.startsWith(prefix),
    ),
  );
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

function restoreThreadParentLinksFromSnapshot(
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

function collectRelatedThreadIdsFromSnapshot(threadId: string, items: ConversationItem[]) {
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

function isAskUserQuestionToolItem(
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

function isTerminalToolStatus(status?: string) {
  if (!status) {
    return false;
  }
  const normalized = status.trim().toLowerCase();
  return /(complete|completed|success|succeed(?:ed)?|done|finish(?:ed)?|fail|error|cancel(?:led)?|abort|timeout|timed[_ -]?out)/.test(
    normalized,
  );
}

function shouldReplaceUserInputQueueFromSnapshot(
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

export function useThreadActions({
  dispatch,
  itemsByThread,
  userInputRequests,
  threadsByWorkspace,
  activeThreadIdByWorkspace,
  threadListCursorByWorkspace,
  threadStatusById,
  onDebug,
  getCustomName,
  threadActivityRef,
  loadedThreadsRef,
  replaceOnResumeRef,
  applyCollabThreadLinksFromThread,
  updateThreadParent,
  onThreadTitleMappingsLoaded,
  onRenameThreadTitleMapping,
  useUnifiedHistoryLoader = false,
}: UseThreadActionsOptions) {
  // Map workspaceId → filesystem path, populated in listThreadsForWorkspace
  const workspacePathsByIdRef = useRef<Record<string, string>>({});
  const geminiSessionCacheRef = useRef<
    Record<string, { fetchedAt: number; sessions: GeminiSessionSummary[] }>
  >({});
  const geminiRefreshAttemptedRef = useRef<Record<string, boolean>>({});
  const threadListRequestSeqRef = useRef<Record<string, number>>({});
  const claudeRewindInFlightByThreadRef = useRef<Record<string, boolean>>({});
  const latestThreadsByWorkspaceRef = useRef(threadsByWorkspace);
  latestThreadsByWorkspaceRef.current = threadsByWorkspace;

  const extractThreadId = useCallback(
    (response: Record<string, unknown> | null | undefined) => {
      if (!response || typeof response !== "object") {
        return "";
      }
      const responseRecord = response as Record<string, unknown>;
      const result =
        responseRecord.result && typeof responseRecord.result === "object"
          ? (responseRecord.result as Record<string, unknown>)
          : null;
      const resultThread =
        result?.thread && typeof result.thread === "object"
          ? (result.thread as Record<string, unknown>)
          : null;
      const rootThread =
        responseRecord.thread && typeof responseRecord.thread === "object"
          ? (responseRecord.thread as Record<string, unknown>)
          : null;

      const candidates = [
        resultThread?.id,
        result?.threadId,
        result?.thread_id,
        rootThread?.id,
        responseRecord.threadId,
        responseRecord.thread_id,
      ];
      for (const candidate of candidates) {
        if (typeof candidate === "string" || typeof candidate === "number") {
          const normalized = String(candidate).trim();
          if (normalized) {
            return normalized;
          }
        }
      }
      return "";
    },
    [],
  );

  const startThreadForWorkspace = useCallback(
    async (workspaceId: string, options?: { activate?: boolean; engine?: "claude" | "codex" | "gemini" | "opencode" }) => {
      const shouldActivate = options?.activate !== false;
      const engine = options?.engine;
      const resolveStartedThread = (
        response: Record<string, unknown> | null | undefined,
      ) => {
        const threadId = extractThreadId(response);
        if (threadId) {
          dispatch({ type: "ensureThread", workspaceId, threadId, engine: "codex" });
          if (shouldActivate) {
            dispatch({ type: "setActiveThreadId", workspaceId, threadId });
          }
          loadedThreadsRef.current[threadId] = true;
          return threadId;
        }
        return null;
      };

      // For local CLI engines (Claude/Gemini/OpenCode), generate a local pending thread ID.
      if (engine === "claude" || engine === "gemini" || engine === "opencode") {
        const prefix = engine;
        const threadId = `${prefix}-pending-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`;
        onDebug?.({
          id: `${Date.now()}-client-thread-start`,
          timestamp: Date.now(),
          source: "client",
          label: `thread/start (${engine})`,
          payload: { workspaceId, threadId, engine },
        });
        dispatch({ type: "ensureThread", workspaceId, threadId, engine });
        if (shouldActivate) {
          dispatch({ type: "setActiveThreadId", workspaceId, threadId });
        }
        loadedThreadsRef.current[threadId] = true;
        return threadId;
      }

      // For Codex and other engines, use the standard start_thread RPC
      onDebug?.({
        id: `${Date.now()}-client-thread-start`,
        timestamp: Date.now(),
        source: "client",
        label: "thread/start",
        payload: { workspaceId },
      });
      try {
        const response = await startThreadService(workspaceId);
        onDebug?.({
          id: `${Date.now()}-server-thread-start`,
          timestamp: Date.now(),
          source: "server",
          label: "thread/start response",
          payload: response,
        });
        return resolveStartedThread(response);
      } catch (error) {
        if (isWorkspaceNotConnectedError(error)) {
          onDebug?.({
            id: `${Date.now()}-client-workspace-reconnect-before-thread-start`,
            timestamp: Date.now(),
            source: "client",
            label: "workspace/reconnect before thread start",
            payload: { workspaceId },
          });
          try {
            await connectWorkspaceService(workspaceId);
            const retryResponse = await startThreadService(workspaceId);
            onDebug?.({
              id: `${Date.now()}-server-thread-start-retry`,
              timestamp: Date.now(),
              source: "server",
              label: "thread/start retry response",
              payload: retryResponse,
            });
            return resolveStartedThread(retryResponse);
          } catch (retryError) {
            onDebug?.({
              id: `${Date.now()}-client-thread-start-error`,
              timestamp: Date.now(),
              source: "error",
              label: "thread/start error",
              payload: retryError instanceof Error ? retryError.message : String(retryError),
            });
            throw retryError;
          }
        }
        onDebug?.({
          id: `${Date.now()}-client-thread-start-error`,
          timestamp: Date.now(),
          source: "error",
          label: "thread/start error",
          payload: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
    [dispatch, extractThreadId, loadedThreadsRef, onDebug],
  );

  const startSharedSessionForWorkspace = useCallback(
    async (
      workspaceId: string,
      options?: { activate?: boolean; initialEngine?: "claude" | "codex" | "gemini" | "opencode" },
    ) => {
      const shouldActivate = options?.activate !== false;
      const initialEngine = normalizeSharedSessionEngine(options?.initialEngine);
      onDebug?.({
        id: `${Date.now()}-client-shared-thread-start`,
        timestamp: Date.now(),
        source: "client",
        label: "shared-session/start",
        payload: { workspaceId, initialEngine },
      });
      const response = await startSharedSessionService(workspaceId, initialEngine);
      const threadId = extractThreadId(response);
      if (!threadId) {
        return null;
      }
      const result =
        response?.result && typeof response.result === "object"
          ? (response.result as Record<string, unknown>)
          : response;
      const thread =
        result?.thread && typeof result.thread === "object"
          ? (result.thread as Record<string, unknown>)
          : null;
      const summary: ThreadSummary = {
        id: threadId,
        name: asString(thread?.name).trim() || "Shared Session",
        updatedAt: asNumber(thread?.updatedAt ?? thread?.updated_at) || Date.now(),
        engineSource: initialEngine,
        threadKind: "shared",
        selectedEngine: initialEngine,
        nativeThreadIds: [],
      };
      dispatch({
        type: "setThreads",
        workspaceId,
        threads: [summary, ...(threadsByWorkspace[workspaceId] ?? [])],
      });
      if (shouldActivate) {
        dispatch({ type: "setActiveThreadId", workspaceId, threadId });
      }
      loadedThreadsRef.current[threadId] = true;
      return threadId;
    },
    [dispatch, extractThreadId, loadedThreadsRef, onDebug, threadsByWorkspace],
  );

  const resumeThreadForWorkspace = useCallback(
    async (
      workspaceId: string,
      threadId: string,
      force = false,
      replaceLocal = false,
    ) => {
      if (!threadId) {
        return null;
      }
      const localItems = itemsByThread[threadId] ?? [];
      const status = threadStatusById[threadId];
      if (!force && status?.isProcessing && localItems.length > 0) {
        onDebug?.({
          id: `${Date.now()}-client-thread-resume-skipped`,
          timestamp: Date.now(),
          source: "client",
          label: "thread/resume skipped",
          payload: { workspaceId, threadId, reason: "active-turn" },
        });
        return threadId;
      }
      const shouldPreserveLocalClaudeRealtimeItems =
        !force &&
        threadId.startsWith("claude:") &&
        localItems.length > 0 &&
        !replaceLocal &&
        replaceOnResumeRef.current[threadId] !== true;
      if (shouldPreserveLocalClaudeRealtimeItems) {
        onDebug?.({
          id: `${Date.now()}-client-thread-resume-skipped`,
          timestamp: Date.now(),
          source: "client",
          label: "thread/resume skipped",
          payload: { workspaceId, threadId, reason: "local-claude-realtime-items" },
        });
        loadedThreadsRef.current[threadId] = true;
        return threadId;
      }
      if (useUnifiedHistoryLoader) {
        try {
          const workspacePath = workspacePathsByIdRef.current[workspaceId] ?? null;
          const createHistoryLoader = (targetThreadId: string) =>
            targetThreadId.startsWith("shared:")
              ? createSharedHistoryLoader({
                  workspaceId,
                  loadSharedSession: loadSharedSessionService,
                })
              : targetThreadId.startsWith("claude:")
              ? createClaudeHistoryLoader({
                  workspaceId,
                  workspacePath,
                  loadClaudeSession: loadClaudeSessionService,
                })
              : targetThreadId.startsWith("gemini:")
                ? createGeminiHistoryLoader({
                    workspaceId,
                    workspacePath,
                    loadGeminiSession: loadGeminiSessionService,
                  })
              : targetThreadId.startsWith("opencode:")
                ? createOpenCodeHistoryLoader({
                    workspaceId,
                    resumeThread: resumeThreadService,
                  })
                : createCodexHistoryLoader({
                    workspaceId,
                    resumeThread: resumeThreadService,
                    loadCodexSession: loadCodexSessionService,
                  });
          const loader = createHistoryLoader(threadId);
          const snapshot = await loader.load(threadId);
          const snapshotItems = snapshot.items;
          dispatch({
            type: "ensureThread",
            workspaceId,
            threadId,
            engine: snapshot.engine,
          });
          if (snapshotItems.length > 0) {
            dispatch({ type: "setThreadItems", threadId, items: snapshotItems });
          }
          dispatch({ type: "setThreadPlan", threadId, plan: snapshot.plan });
          const hasLocalPendingQueue = userInputRequests.some(
            (request) =>
              request.workspace_id === workspaceId &&
              request.params.thread_id === threadId,
          );
          const hasLocalPendingAskTool = localItems.some(
            (item) =>
              isAskUserQuestionToolItem(item) &&
              !isTerminalToolStatus(item.status),
          );
          if (
            shouldReplaceUserInputQueueFromSnapshot(
              snapshotItems,
              snapshot.userInputQueue.length,
              hasLocalPendingQueue || hasLocalPendingAskTool,
            )
          ) {
            dispatch({
              type: "clearUserInputRequestsForThread",
              workspaceId,
              threadId,
            });
          }
          restoreThreadParentLinksFromSnapshot(
            threadId,
            snapshotItems,
            updateThreadParent,
          );
          const relatedThreadIds = collectRelatedThreadIdsFromSnapshot(
            threadId,
            snapshotItems,
          );
          relatedThreadIds.forEach((relatedThreadId) => {
            dispatch({
              type: "ensureThread",
              workspaceId,
              threadId: relatedThreadId,
              engine: "codex",
            });
          });
          const pendingRelatedThreadIds = relatedThreadIds.filter(
            (relatedThreadId) =>
              Boolean(relatedThreadId) &&
              relatedThreadId !== threadId &&
              !loadedThreadsRef.current[relatedThreadId],
          );
          await mapWithConcurrency(
            pendingRelatedThreadIds,
            RELATED_THREAD_LOAD_CONCURRENCY,
            async (relatedThreadId) => {
              try {
                const relatedSnapshot = await createHistoryLoader(relatedThreadId).load(
                  relatedThreadId,
                );
                const relatedSnapshotItems = relatedSnapshot.items;
                if (relatedSnapshotItems.length > 0) {
                  dispatch({
                    type: "setThreadItems",
                    threadId: relatedThreadId,
                    items: relatedSnapshotItems,
                  });
                }
                dispatch({
                  type: "setThreadPlan",
                  threadId: relatedThreadId,
                  plan: relatedSnapshot.plan,
                });
                restoreThreadParentLinksFromSnapshot(
                  relatedThreadId,
                  relatedSnapshotItems,
                  updateThreadParent,
                );
                loadedThreadsRef.current[relatedThreadId] = true;
              } catch (error) {
                onDebug?.({
                  id: `${Date.now()}-history-loader-related-error`,
                  timestamp: Date.now(),
                  source: "error",
                  label: "thread/history related loader error",
                  payload: {
                    workspaceId,
                    threadId,
                    relatedThreadId,
                    error: error instanceof Error ? error.message : String(error),
                  },
                });
              }
              return relatedThreadId;
            },
          );
          snapshot.userInputQueue.forEach((request) => {
            dispatch({ type: "addUserInputRequest", request });
          });
          if (snapshot.fallbackWarnings.length > 0) {
            onDebug?.({
              id: `${Date.now()}-history-loader-fallback`,
              timestamp: Date.now(),
              source: "client",
              label: "thread/history fallback",
              payload: {
                workspaceId,
                threadId,
                warnings: snapshot.fallbackWarnings,
              },
            });
          }
          loadedThreadsRef.current[threadId] = true;
          return threadId;
        } catch (error) {
          onDebug?.({
            id: `${Date.now()}-history-loader-error`,
            timestamp: Date.now(),
            source: "error",
            label: "thread/history loader error",
            payload: error instanceof Error ? error.message : String(error),
          });
          // Fallback to legacy path to preserve recovery.
        }
      }
      // Claude sessions don't use Codex thread/resume RPC —
      // load message history from JSONL and populate the thread
      const workspacePath = workspacePathsByIdRef.current[workspaceId];
      if (threadId.startsWith("claude:")) {
        dispatch({ type: "ensureThread", workspaceId, threadId, engine: "claude" });
        if (workspacePath && !loadedThreadsRef.current[threadId]) {
          const realSessionId = threadId.slice("claude:".length);
          try {
            const result = await loadClaudeSessionService(
              workspacePath,
              realSessionId,
            );
            // Handle both new format { messages, usage } and old format (array)
            const messagesData = (result as { messages?: unknown }).messages ?? result;
            const usageData = (result as { usage?: unknown }).usage as {
              inputTokens?: number;
              outputTokens?: number;
              cacheCreationInputTokens?: number;
              cacheReadInputTokens?: number;
            } | undefined;

            const items = parseClaudeHistoryMessages(messagesData);
            if (items.length > 0) {
              dispatch({ type: "setThreadItems", threadId, items });
            }

            // Dispatch usage data if available
            if (usageData && (usageData.inputTokens || usageData.outputTokens)) {
              const cachedTokens = (usageData.cacheCreationInputTokens ?? 0) + (usageData.cacheReadInputTokens ?? 0);
              dispatch({
                type: "setThreadTokenUsage",
                threadId,
                tokenUsage: {
                  total: {
                    inputTokens: usageData.inputTokens ?? 0,
                    outputTokens: usageData.outputTokens ?? 0,
                    cachedInputTokens: cachedTokens,
                    totalTokens: (usageData.inputTokens ?? 0) + (usageData.outputTokens ?? 0),
                    reasoningOutputTokens: 0,
                  },
                  last: {
                    inputTokens: usageData.inputTokens ?? 0,
                    outputTokens: usageData.outputTokens ?? 0,
                    cachedInputTokens: cachedTokens,
                    totalTokens: (usageData.inputTokens ?? 0) + (usageData.outputTokens ?? 0),
                    reasoningOutputTokens: 0,
                  },
                  modelContextWindow: DEFAULT_CLAUDE_CONTEXT_WINDOW,
                },
              });
            }
          } catch {
            // Failed to load Claude session history — not fatal
          }
        }
        loadedThreadsRef.current[threadId] = true;
        return threadId;
      }
      if (threadId.startsWith("opencode:")) {
        dispatch({ type: "ensureThread", workspaceId, threadId, engine: "opencode" });
        loadedThreadsRef.current[threadId] = true;
        return threadId;
      }
      if (threadId.startsWith("gemini:")) {
        dispatch({ type: "ensureThread", workspaceId, threadId, engine: "gemini" });
        if (workspacePath && !loadedThreadsRef.current[threadId]) {
          const realSessionId = threadId.slice("gemini:".length);
          try {
            const result = await loadGeminiSessionService(
              workspacePath,
              realSessionId,
            );
            const messagesData = (result as { messages?: unknown }).messages ?? result;
            const items = parseGeminiHistoryMessages(messagesData);
            if (items.length > 0) {
              dispatch({ type: "setThreadItems", threadId, items });
            }
          } catch {
            // Failed to load Gemini session history — not fatal
          }
        }
        loadedThreadsRef.current[threadId] = true;
        return threadId;
      }
      if (!force && loadedThreadsRef.current[threadId]) {
        return threadId;
      }
      if (status?.isProcessing && loadedThreadsRef.current[threadId] && !force) {
        onDebug?.({
          id: `${Date.now()}-client-thread-resume-skipped`,
          timestamp: Date.now(),
          source: "client",
          label: "thread/resume skipped",
          payload: { workspaceId, threadId, reason: "active-turn" },
        });
        return threadId;
      }
      onDebug?.({
        id: `${Date.now()}-client-thread-resume`,
        timestamp: Date.now(),
        source: "client",
        label: "thread/resume",
        payload: { workspaceId, threadId },
      });
      try {
        const response =
          (await resumeThreadService(workspaceId, threadId)) as
            | Record<string, unknown>
            | null;
        onDebug?.({
          id: `${Date.now()}-server-thread-resume`,
          timestamp: Date.now(),
          source: "server",
          label: "thread/resume response",
          payload: response,
        });
        const result = (response?.result ?? response) as
          | Record<string, unknown>
          | null;
        const thread = (result?.thread ?? response?.thread ?? null) as
          | Record<string, unknown>
          | null;
        if (thread) {
          dispatch({ type: "ensureThread", workspaceId, threadId, engine: "codex" });
          applyCollabThreadLinksFromThread(threadId, thread);
          const items = buildItemsFromThread(thread);
          const localItems = itemsByThread[threadId] ?? [];
          const shouldReplace =
            replaceLocal || replaceOnResumeRef.current[threadId] === true;
          if (shouldReplace) {
            replaceOnResumeRef.current[threadId] = false;
          }
          if (localItems.length > 0 && !shouldReplace) {
            loadedThreadsRef.current[threadId] = true;
            return threadId;
          }
          const hasOverlap =
            items.length > 0 &&
            localItems.length > 0 &&
            items.some((item) => localItems.some((local) => local.id === item.id));
          const mergedItems =
            items.length > 0
              ? shouldReplace
                ? items
                : localItems.length > 0 && !hasOverlap
                  ? localItems
                  : mergeThreadItems(items, localItems)
              : localItems;
          if (mergedItems.length > 0) {
            dispatch({
              type: "setThreadItems",
              threadId,
              items: mergedItems,
            });
          }
          dispatch({
            type: "markReviewing",
            threadId,
            isReviewing: isReviewingFromThread(thread),
          });
          const preview = asString(thread?.preview ?? "");
          const customName = getCustomName(workspaceId, threadId);
          if (!customName && preview) {
            dispatch({
              type: "setThreadName",
              workspaceId,
              threadId,
              name: previewThreadName(preview, `Agent ${threadId.slice(0, 4)}`),
            });
          }
          const lastAgentMessage = [...mergedItems]
            .reverse()
            .find(
              (item) => item.kind === "message" && item.role === "assistant",
            ) as ConversationItem | undefined;
          const lastText =
            lastAgentMessage && lastAgentMessage.kind === "message"
              ? lastAgentMessage.text
              : preview;
          if (lastText) {
            dispatch({
              type: "setLastAgentMessage",
              threadId,
              text: lastText,
              timestamp: getThreadTimestamp(thread),
            });
          }
        }
        loadedThreadsRef.current[threadId] = true;
        return threadId;
      } catch (error) {
        onDebug?.({
          id: `${Date.now()}-client-thread-resume-error`,
          timestamp: Date.now(),
          source: "error",
          label: "thread/resume error",
          payload: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    },
    [
      applyCollabThreadLinksFromThread,
      updateThreadParent,
      dispatch,
      getCustomName,
      itemsByThread,
      loadedThreadsRef,
      onDebug,
      replaceOnResumeRef,
      threadStatusById,
      userInputRequests,
      useUnifiedHistoryLoader,
    ],
  );

  const forkThreadForWorkspace = useCallback(
    async (
      workspaceId: string,
      threadId: string,
      options?: { activate?: boolean },
    ) => {
      if (!threadId) {
        return null;
      }
      const shouldActivate = options?.activate !== false;
      onDebug?.({
        id: `${Date.now()}-client-thread-fork`,
        timestamp: Date.now(),
        source: "client",
        label: "thread/fork",
        payload: { workspaceId, threadId },
      });
      try {
        let response: Record<string, unknown> | null | undefined;
        if (threadId.startsWith("claude:")) {
          const workspacePath = workspacePathsByIdRef.current[workspaceId];
          if (!workspacePath) {
            return null;
          }
          const sessionId = threadId.slice("claude:".length).trim();
          if (!sessionId) {
            return null;
          }
          response = await forkClaudeSessionService(workspacePath, sessionId);
        } else if (threadId.startsWith("claude-pending-")) {
          return null;
        } else if (threadId.startsWith("gemini:") || threadId.startsWith("gemini-pending-")) {
          return null;
        } else {
          response = await forkThreadService(workspaceId, threadId);
        }
        onDebug?.({
          id: `${Date.now()}-server-thread-fork`,
          timestamp: Date.now(),
          source: "server",
          label: "thread/fork response",
          payload: response,
        });
        const forkedThreadId = extractThreadId(response);
        if (!forkedThreadId) {
          return null;
        }
        const forkedEngine = forkedThreadId.startsWith("claude:")
          ? "claude"
          : forkedThreadId.startsWith("gemini:")
            ? "gemini"
            : "codex";
        dispatch({
          type: "ensureThread",
          workspaceId,
          threadId: forkedThreadId,
          engine: forkedEngine,
        });
        if (shouldActivate) {
          dispatch({
            type: "setActiveThreadId",
            workspaceId,
            threadId: forkedThreadId,
          });
        }
        loadedThreadsRef.current[forkedThreadId] = false;
        await resumeThreadForWorkspace(workspaceId, forkedThreadId, true, true);
        return forkedThreadId;
      } catch (error) {
        onDebug?.({
          id: `${Date.now()}-client-thread-fork-error`,
          timestamp: Date.now(),
          source: "error",
          label: "thread/fork error",
          payload: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    },
    [dispatch, extractThreadId, loadedThreadsRef, onDebug, resumeThreadForWorkspace],
  );

  const forkClaudeSessionFromMessageForWorkspace = useCallback(
    async (
      workspaceId: string,
      threadId: string,
      messageId: string,
      options?: RewindFromMessageOptions,
    ) => {
      if (!threadId.startsWith("claude:")) {
        return null;
      }
      const normalizedMessageId = messageId.trim();
      if (!normalizedMessageId) {
        return null;
      }
      const workspacePath = workspacePathsByIdRef.current[workspaceId];
      if (!workspacePath) {
        return null;
      }
      const sessionId = threadId.slice("claude:".length).trim();
      if (!sessionId) {
        return null;
      }
      const shouldActivate = options?.activate !== false;
      const rewindMode = normalizeRewindMode(options?.mode);
      const shouldRestoreFiles = shouldRestoreWorkspaceFiles(rewindMode);
      const shouldRewindSession = shouldRewindMessages(rewindMode);
      const rewindLockKey = `${workspaceId}:${threadId}`;
      if (claudeRewindInFlightByThreadRef.current[rewindLockKey]) {
        return null;
      }
      claudeRewindInFlightByThreadRef.current[rewindLockKey] = true;
      onDebug?.({
        id: `${Date.now()}-client-thread-fork-from-message`,
        timestamp: Date.now(),
        source: "client",
        label: "thread/fork from message",
        payload: { workspaceId, threadId, messageId: normalizedMessageId },
      });
      let rewindRestoreState:
        | Awaited<ReturnType<typeof applyClaudeRewindWorkspaceRestore>>
        | null = null;
      try {
        const threadItems = itemsByThread[threadId] ?? [];
        const historyResponse = await loadClaudeSessionService(
          workspacePath,
          sessionId,
        );
        const historyRecord =
          historyResponse && typeof historyResponse === "object"
            ? (historyResponse as Record<string, unknown>)
            : {};
        const historyItems = parseClaudeHistoryMessages(historyRecord.messages);
        const firstHistoryMessageId = findFirstHistoryUserMessageId(historyItems);
        const latestHistoryMessageId = findLatestHistoryUserMessageId(historyItems);
        if (!latestHistoryMessageId) {
          return null;
        }
        const requestedHistoryMessageId = resolveClaudeRewindMessageIdFromHistory({
          requestedMessageId: normalizedMessageId,
          threadItems,
          historyItems,
        });
        const resolvedMessageId = requestedHistoryMessageId.trim();
        if (!resolvedMessageId) {
          return null;
        }
        const impactedItems = findImpactedClaudeRewindItems(
          threadItems,
          normalizedMessageId,
        );
        onDebug?.({
          id: `${Date.now()}-client-thread-fork-from-message-resolved`,
          timestamp: Date.now(),
          source: "client",
          label: "thread/fork from message resolved",
          payload: {
            workspaceId,
            threadId,
            requestedMessageId: normalizedMessageId,
            resolvedMessageId,
            firstHistoryMessageId,
            latestHistoryMessageId,
          },
        });
        if (shouldRestoreFiles) {
          rewindRestoreState = await applyClaudeRewindWorkspaceRestore({
            workspaceId,
            workspacePath,
            impactedItems,
          });
          if ((rewindRestoreState?.ignoredCommittedPaths?.length ?? 0) > 0) {
            onDebug?.({
              id: `${Date.now()}-client-thread-fork-from-message-restore-committed-ignored`,
              timestamp: Date.now(),
              source: "client",
              label: "thread/fork from message restore committed ignored",
              payload: {
                workspaceId,
                threadId,
                ignoredCommittedPaths:
                  rewindRestoreState?.ignoredCommittedPaths ?? [],
              },
            });
          }
          if ((rewindRestoreState?.skippedPaths?.length ?? 0) > 0) {
            onDebug?.({
              id: `${Date.now()}-client-thread-fork-from-message-restore-skipped`,
              timestamp: Date.now(),
              source: "error",
              label: "thread/fork from message restore skipped",
              payload: {
                workspaceId,
                threadId,
                skippedPaths: rewindRestoreState?.skippedPaths ?? [],
              },
            });
          }
        }
        if (!shouldRewindSession) {
          return threadId;
        }
        if (
          firstHistoryMessageId &&
          resolvedMessageId === firstHistoryMessageId
        ) {
          await deleteClaudeSessionService(workspacePath, sessionId);
          delete loadedThreadsRef.current[threadId];
          dispatch({
            type: "removeThread",
            workspaceId,
            threadId,
          });
          return threadId;
        }
        const response = await forkClaudeSessionFromMessageService(
          workspacePath,
          sessionId,
          resolvedMessageId,
        );
        onDebug?.({
          id: `${Date.now()}-server-thread-fork-from-message`,
          timestamp: Date.now(),
          source: "server",
          label: "thread/fork from message response",
          payload: response,
        });
        const forkedThreadId = extractThreadId(response);
        if (!forkedThreadId) {
          if (
            shouldRestoreFiles &&
            rewindRestoreState?.originalSnapshots?.length
          ) {
            await restoreClaudeRewindWorkspaceSnapshots(
              workspaceId,
              rewindRestoreState.originalSnapshots,
            );
          }
          return null;
        }
        dispatch({
          type: "renameThreadId",
          workspaceId,
          oldThreadId: threadId,
          newThreadId: forkedThreadId,
        });
        dispatch({
          type: "hideThread",
          workspaceId,
          threadId,
        });
        try {
          await renameThreadTitleKeyService(workspaceId, threadId, forkedThreadId);
          onRenameThreadTitleMapping?.(workspaceId, threadId, forkedThreadId);
        } catch {
          const previousName = getCustomName(workspaceId, threadId);
          if (previousName) {
            try {
              await setThreadTitleService(workspaceId, forkedThreadId, previousName);
              onRenameThreadTitleMapping?.(workspaceId, threadId, forkedThreadId);
            } catch {
              // Best-effort persistence; keep local rename even if title migration fails.
            }
          }
        }
        if (
          shouldActivate &&
          !activeThreadIdByWorkspace[workspaceId]
        ) {
          dispatch({
            type: "setActiveThreadId",
            workspaceId,
            threadId: forkedThreadId,
          });
        }
        delete loadedThreadsRef.current[threadId];
        loadedThreadsRef.current[forkedThreadId] = false;
        await resumeThreadForWorkspace(workspaceId, forkedThreadId, true, true);
        try {
          await deleteClaudeSessionService(workspacePath, sessionId);
        } catch (error) {
          onDebug?.({
            id: `${Date.now()}-client-thread-fork-from-message-delete-source-error`,
            timestamp: Date.now(),
            source: "error",
            label: "thread/fork from message delete source error",
            payload: error instanceof Error ? error.message : String(error),
          });
        }
        return forkedThreadId;
      } catch (error) {
        try {
          if (
            shouldRestoreFiles &&
            rewindRestoreState?.originalSnapshots?.length
          ) {
            await restoreClaudeRewindWorkspaceSnapshots(
              workspaceId,
              rewindRestoreState.originalSnapshots,
            );
          }
        } catch {
          // Best effort rollback is handled in the main rewind path below.
        }
        onDebug?.({
          id: `${Date.now()}-client-thread-fork-from-message-error`,
          timestamp: Date.now(),
          source: "error",
          label: "thread/fork from message error",
          payload: error instanceof Error ? error.message : String(error),
        });
        return null;
      } finally {
        delete claudeRewindInFlightByThreadRef.current[rewindLockKey];
      }
    },
    [
      dispatch,
      extractThreadId,
      activeThreadIdByWorkspace,
      getCustomName,
      itemsByThread,
      loadedThreadsRef,
      onDebug,
      onRenameThreadTitleMapping,
      resumeThreadForWorkspace,
    ],
  );

  const forkSessionFromMessageForWorkspace = useCallback(
    async (
      workspaceId: string,
      threadId: string,
      messageId: string,
      options?: RewindFromMessageOptions,
    ) => {
      const canonicalThreadId = threadId.trim();
      const rewindEngine = resolveRewindSupportedEngine(canonicalThreadId);
      if (!rewindEngine) {
        return null;
      }
      if (rewindEngine === "claude") {
        const claudeThreadId = canonicalThreadId.replace(/^claude:/i, "claude:");
        return forkClaudeSessionFromMessageForWorkspace(
          workspaceId,
          claudeThreadId,
          messageId,
          options,
        );
      }

      const normalizedMessageId = messageId.trim();
      if (!normalizedMessageId) {
        return null;
      }
      const workspacePath = workspacePathsByIdRef.current[workspaceId];
      if (!workspacePath) {
        return null;
      }
      const shouldActivate = options?.activate !== false;
      const rewindMode = normalizeRewindMode(options?.mode);
      const shouldRestoreFiles = shouldRestoreWorkspaceFiles(rewindMode);
      const shouldRewindSession = shouldRewindMessages(rewindMode);
      const rewindLockKey = `${workspaceId}:${canonicalThreadId}`;
      if (claudeRewindInFlightByThreadRef.current[rewindLockKey]) {
        return null;
      }
      claudeRewindInFlightByThreadRef.current[rewindLockKey] = true;
      onDebug?.({
        id: `${Date.now()}-client-thread-codex-fork-from-message`,
        timestamp: Date.now(),
        source: "client",
        label: "codex/thread/fork from message",
        payload: {
          workspaceId,
          threadId: canonicalThreadId,
          messageId: normalizedMessageId,
        },
      });
      let rewindRestoreState:
        | Awaited<ReturnType<typeof applyClaudeRewindWorkspaceRestore>>
        | null = null;
      try {
        const threadItems = itemsByThread[canonicalThreadId] ?? [];
        const userThreadItems = threadItems.filter(isUserConversationMessage);
        const targetUserTurnIndex = findLastUserMessageIndexById(
          userThreadItems,
          normalizedMessageId,
        );
        if (targetUserTurnIndex < 0) {
          return null;
        }
        const targetUserMessageText = normalizeComparableRewindText(
          userThreadItems[targetUserTurnIndex]?.text ?? "",
        );
        const targetUserMessageOccurrence = targetUserMessageText
          ? userThreadItems.reduce((count, item, index) => {
              if (index > targetUserTurnIndex) {
                return count;
              }
              return normalizeComparableRewindText(item.text) === targetUserMessageText
                ? count + 1
                : count;
            }, 0) || 1
          : undefined;
        const impactedItems = findImpactedClaudeRewindItems(
          threadItems,
          normalizedMessageId,
        );
        if (shouldRestoreFiles) {
          rewindRestoreState = await applyClaudeRewindWorkspaceRestore({
            workspaceId,
            workspacePath,
            impactedItems,
          });
          if ((rewindRestoreState?.ignoredCommittedPaths?.length ?? 0) > 0) {
            onDebug?.({
              id: `${Date.now()}-client-thread-codex-fork-from-message-restore-committed-ignored`,
              timestamp: Date.now(),
              source: "client",
              label: "codex/thread/fork from message restore committed ignored",
              payload: {
                workspaceId,
                threadId: canonicalThreadId,
                ignoredCommittedPaths:
                  rewindRestoreState?.ignoredCommittedPaths ?? [],
              },
            });
          }
          if ((rewindRestoreState?.skippedPaths?.length ?? 0) > 0) {
            onDebug?.({
              id: `${Date.now()}-client-thread-codex-fork-from-message-restore-skipped`,
              timestamp: Date.now(),
              source: "error",
              label: "codex/thread/fork from message restore skipped",
              payload: {
                workspaceId,
                threadId: canonicalThreadId,
                skippedPaths: rewindRestoreState?.skippedPaths ?? [],
              },
            });
          }
        }
        if (!shouldRewindSession) {
          return canonicalThreadId;
        }

        if (targetUserTurnIndex === 0) {
          await deleteCodexSessionService(workspaceId, canonicalThreadId);
          delete loadedThreadsRef.current[canonicalThreadId];
          dispatch({
            type: "removeThread",
            workspaceId,
            threadId: canonicalThreadId,
          });
          return canonicalThreadId;
        }

        const hardRewindResponse = await rewindCodexThreadService(
          workspaceId,
          canonicalThreadId,
          targetUserTurnIndex,
          normalizedMessageId,
          {
            targetUserMessageText:
              targetUserMessageText.length > 0 ? targetUserMessageText : undefined,
            targetUserMessageOccurrence,
            localUserMessageCount: userThreadItems.length,
          },
        );
        onDebug?.({
          id: `${Date.now()}-server-thread-codex-fork-from-message`,
          timestamp: Date.now(),
          source: "server",
          label: "codex/thread/fork from message response",
          payload: hardRewindResponse,
        });
        const forkedThreadId = extractThreadId(hardRewindResponse);
        if (!forkedThreadId) {
          if (
            shouldRestoreFiles &&
            rewindRestoreState?.originalSnapshots?.length
          ) {
            await restoreClaudeRewindWorkspaceSnapshots(
              workspaceId,
              rewindRestoreState.originalSnapshots,
            );
          }
          return null;
        }
        dispatch({
          type: "renameThreadId",
          workspaceId,
          oldThreadId: canonicalThreadId,
          newThreadId: forkedThreadId,
        });
        dispatch({
          type: "hideThread",
          workspaceId,
          threadId: canonicalThreadId,
        });
        try {
          await renameThreadTitleKeyService(
            workspaceId,
            canonicalThreadId,
            forkedThreadId,
          );
          onRenameThreadTitleMapping?.(
            workspaceId,
            canonicalThreadId,
            forkedThreadId,
          );
        } catch {
          const previousName = getCustomName(workspaceId, canonicalThreadId);
          if (previousName) {
            try {
              await setThreadTitleService(workspaceId, forkedThreadId, previousName);
              onRenameThreadTitleMapping?.(
                workspaceId,
                canonicalThreadId,
                forkedThreadId,
              );
            } catch {
              // Best-effort persistence; keep local rename even if title migration fails.
            }
          }
        }
        if (
          shouldActivate &&
          !activeThreadIdByWorkspace[workspaceId]
        ) {
          dispatch({
            type: "setActiveThreadId",
            workspaceId,
            threadId: forkedThreadId,
          });
        }
        delete loadedThreadsRef.current[canonicalThreadId];
        loadedThreadsRef.current[forkedThreadId] = false;
        await resumeThreadForWorkspace(workspaceId, forkedThreadId, true, true);
        return forkedThreadId;
      } catch (error) {
        try {
          if (
            shouldRestoreFiles &&
            rewindRestoreState?.originalSnapshots?.length
          ) {
            await restoreClaudeRewindWorkspaceSnapshots(
              workspaceId,
              rewindRestoreState.originalSnapshots,
            );
          }
        } catch {
          // Best effort rollback is handled in the main rewind path below.
        }
        onDebug?.({
          id: `${Date.now()}-client-thread-codex-fork-from-message-error`,
          timestamp: Date.now(),
          source: "error",
          label: "codex/thread/fork from message error",
          payload: error instanceof Error ? error.message : String(error),
        });
        return null;
      } finally {
        delete claudeRewindInFlightByThreadRef.current[rewindLockKey];
      }
    },
    [
      dispatch,
      extractThreadId,
      activeThreadIdByWorkspace,
      forkClaudeSessionFromMessageForWorkspace,
      getCustomName,
      itemsByThread,
      loadedThreadsRef,
      onDebug,
      onRenameThreadTitleMapping,
      resumeThreadForWorkspace,
    ],
  );

  const refreshThread = useCallback(
    async (workspaceId: string, threadId: string) => {
      if (!threadId) {
        return null;
      }
      replaceOnResumeRef.current[threadId] = true;
      return resumeThreadForWorkspace(workspaceId, threadId, true, true);
    },
    [replaceOnResumeRef, resumeThreadForWorkspace],
  );

  const resetWorkspaceThreads = useCallback(
    (workspaceId: string) => {
      const threadIds = new Set<string>();
      const list = threadsByWorkspace[workspaceId] ?? [];
      list.forEach((thread) => threadIds.add(thread.id));
      const activeThread = activeThreadIdByWorkspace[workspaceId];
      if (activeThread) {
        threadIds.add(activeThread);
      }
      threadIds.forEach((threadId) => {
        loadedThreadsRef.current[threadId] = false;
      });
    },
    [activeThreadIdByWorkspace, loadedThreadsRef, threadsByWorkspace],
  );

  const listThreadsForWorkspace = useCallback(
    async (
      workspace: WorkspaceInfo,
      options?: {
        preserveState?: boolean;
        includeOpenCodeSessions?: boolean;
      },
    ) => {
      // Store workspace path for Claude session loading
      workspacePathsByIdRef.current[workspace.id] = workspace.path;
      const requestSeq = (threadListRequestSeqRef.current[workspace.id] ?? 0) + 1;
      threadListRequestSeqRef.current[workspace.id] = requestSeq;
      const preserveState = options?.preserveState ?? false;
      const includeOpenCodeSessions = options?.includeOpenCodeSessions ?? true;
      const workspacePath = normalizeComparableWorkspacePath(workspace.path);
      if (!preserveState) {
        dispatch({
          type: "setThreadListLoading",
          workspaceId: workspace.id,
          isLoading: true,
        });
        dispatch({
          type: "setThreadListCursor",
          workspaceId: workspace.id,
          cursor: null,
        });
      }
      onDebug?.({
        id: `${Date.now()}-client-thread-list`,
        timestamp: Date.now(),
        source: "client",
        label: "thread/list",
        payload: { workspaceId: workspace.id, path: workspace.path },
      });
      try {
        let mappedTitles: Record<string, string> = {};
        try {
          mappedTitles = await listThreadTitlesService(workspace.id);
          onThreadTitleMappingsLoaded?.(workspace.id, mappedTitles);
        } catch {
          mappedTitles = {};
        }
        const sharedSessions = normalizeSharedSessionSummaries(
          await listSharedSessionsService(workspace.id).catch(() => []),
        );
        const hiddenSharedBindingIds = new Set(
          sharedSessions.flatMap((session) => session.nativeThreadIds),
        );
        const existingThreads = threadsByWorkspace[workspace.id] ?? [];
        const activeThreadId = activeThreadIdByWorkspace[workspace.id] ?? "";
        const knownCodexThreadIds = collectKnownCodexThreadIds(
          existingThreads,
          activeThreadId,
        );
        const engineById = new Map(
          existingThreads.map((thread) => [thread.id, thread.engineSource]),
        );
        const hasGeminiSignal =
          existingThreads.some(
            (thread) =>
              thread.engineSource === "gemini" ||
              thread.id.startsWith("gemini:") ||
              thread.id.startsWith("gemini-pending-"),
          ) ||
          activeThreadId.startsWith("gemini:") ||
          activeThreadId.startsWith("gemini-pending-") ||
          Object.keys(mappedTitles).some((id) => id.startsWith("gemini:"));
        const cachedGemini = geminiSessionCacheRef.current[workspace.id];
        const hasFreshGeminiCache =
          !!cachedGemini &&
          Date.now() - cachedGemini.fetchedAt <= GEMINI_SESSION_CACHE_TTL_MS;
        const knownActivityByThread = threadActivityRef.current[workspace.id] ?? {};
        const hasKnownActivity = Object.keys(knownActivityByThread).length > 0;
        const matchingThreads: Record<string, unknown>[] = [];
        const targetCount = THREAD_LIST_TARGET_COUNT;
        const pageSize = THREAD_LIST_PAGE_SIZE;
        const maxPagesWithoutMatch = hasKnownActivity
          ? THREAD_LIST_MAX_EMPTY_PAGES_WITH_ACTIVITY
          : THREAD_LIST_MAX_EMPTY_PAGES;
        let pagesFetched = 0;
        const fetchStartedAt = Date.now();
        let cursor: string | null = null;
        do {
          pagesFetched += 1;
          let response: Record<string, unknown>;
          try {
            response = (await (async () => {
              try {
                return await listThreadsService(workspace.id, cursor, pageSize);
              } catch (error) {
                if (!isWorkspaceNotConnectedError(error)) {
                  throw error;
                }
                onDebug?.({
                  id: `${Date.now()}-client-workspace-reconnect-before-thread-list`,
                  timestamp: Date.now(),
                  source: "client",
                  label: "workspace/reconnect before thread list",
                  payload: { workspaceId: workspace.id },
                });
                await connectWorkspaceService(workspace.id);
                return await listThreadsService(workspace.id, cursor, pageSize);
              }
            })()) as Record<string, unknown>;
          } catch (error) {
            if (!isWorkspaceNotConnectedError(error)) {
              throw error;
            }
            onDebug?.({
              id: `${Date.now()}-client-thread-list-codex-unavailable`,
              timestamp: Date.now(),
              source: "client",
              label: "thread/list codex unavailable",
              payload: {
                workspaceId: workspace.id,
                reason: error instanceof Error ? error.message : String(error),
              },
            });
            break;
          }
          onDebug?.({
            id: `${Date.now()}-server-thread-list`,
            timestamp: Date.now(),
            source: "server",
            label: "thread/list response",
            payload: response,
          });
          const result = (response.result ?? response) as Record<string, unknown>;
          const data = Array.isArray(result?.data)
            ? (result.data as Record<string, unknown>[])
            : [];
          const allowKnownCodexWithoutCwd = isLocalSessionScanUnavailable(result);
          const nextCursor =
            (result?.nextCursor ?? result?.next_cursor ?? null) as string | null;
          matchingThreads.push(
            ...data.filter(
              (thread) =>
                shouldIncludeWorkspaceThreadEntry(
                  thread,
                  workspacePath,
                  knownCodexThreadIds,
                  allowKnownCodexWithoutCwd,
                ),
            ),
          );
          cursor = nextCursor;
          if (matchingThreads.length === 0 && pagesFetched >= maxPagesWithoutMatch) {
            onDebug?.({
              id: `${Date.now()}-client-thread-list-stop-empty-pages`,
              timestamp: Date.now(),
              source: "client",
              label: "thread/list stop",
              payload: {
                workspaceId: workspace.id,
                reason: "too-many-empty-pages",
                pagesFetched,
                maxPagesWithoutMatch,
              },
            });
            break;
          }
          if (pagesFetched >= THREAD_LIST_MAX_TOTAL_PAGES) {
            onDebug?.({
              id: `${Date.now()}-client-thread-list-stop-page-cap`,
              timestamp: Date.now(),
              source: "client",
              label: "thread/list stop",
              payload: {
                workspaceId: workspace.id,
                reason: "page-cap",
                pagesFetched,
                pageCap: THREAD_LIST_MAX_TOTAL_PAGES,
              },
            });
            break;
          }
          if (Date.now() - fetchStartedAt >= THREAD_LIST_MAX_FETCH_DURATION_MS) {
            onDebug?.({
              id: `${Date.now()}-client-thread-list-stop-time-budget`,
              timestamp: Date.now(),
              source: "client",
              label: "thread/list stop",
              payload: {
                workspaceId: workspace.id,
                reason: "time-budget",
                pagesFetched,
                budgetMs: THREAD_LIST_MAX_FETCH_DURATION_MS,
              },
            });
            break;
          }
        } while (cursor && matchingThreads.length < targetCount);

        const uniqueById = new Map<string, Record<string, unknown>>();
        matchingThreads.forEach((thread) => {
          const id = String(thread?.id ?? "");
          if (id && !uniqueById.has(id)) {
            uniqueById.set(id, thread);
          }
        });
        const uniqueThreads = Array.from(uniqueById.values());
        const activityByThread = threadActivityRef.current[workspace.id] ?? {};
        const nextActivityByThread = { ...activityByThread };
        let didChangeActivity = false;
        uniqueThreads.forEach((thread) => {
          const threadId = String(thread?.id ?? "");
          if (!threadId) {
            return;
          }
          const timestamp = getThreadTimestamp(thread);
          if (timestamp > (nextActivityByThread[threadId] ?? 0)) {
            nextActivityByThread[threadId] = timestamp;
            didChangeActivity = true;
          }
        });
        uniqueThreads.sort((a, b) => {
          const aId = String(a?.id ?? "");
          const bId = String(b?.id ?? "");
          const aCreated = getThreadTimestamp(a);
          const bCreated = getThreadTimestamp(b);
          const aActivity = Math.max(nextActivityByThread[aId] ?? 0, aCreated);
          const bActivity = Math.max(nextActivityByThread[bId] ?? 0, bCreated);
          return bActivity - aActivity;
        });
        const summaries = uniqueThreads
          .slice(0, targetCount)
          .map((thread, index) => {
            const id = String(thread?.id ?? "");
            const preview = asString(thread?.preview ?? "").trim();
            const mappedTitle = mappedTitles[id];
            const customName = mappedTitle || getCustomName(workspace.id, id);
            const fallbackName = `Agent ${index + 1}`;
            const name = customName
              ? customName
              : preview.length > 0
                ? previewThreadName(preview, fallbackName)
                : fallbackName;
            const engineSource = engineById.get(id) ?? ("codex" as const);
            const sourceMeta = resolveThreadSourceMeta(thread);
            return {
              id,
              name,
              updatedAt: getThreadTimestamp(thread),
              sizeBytes: extractThreadSizeBytes(thread),
              engineSource,
              threadKind: "native" as const,
              ...sourceMeta,
            };
          })
          .filter((entry) => entry.id && !hiddenSharedBindingIds.has(entry.id));

        // Fetch Claude/OpenCode sessions in the critical path.
        // Gemini history is merged from cache first, then refreshed in background,
        // so codex/claude thread list latency stays isolated from Gemini I/O scans.
        let allSummaries: ThreadSummary[] = summaries;
        const mergedById = new Map<string, ThreadSummary>();
        allSummaries.forEach((entry) => mergedById.set(entry.id, entry));
        const [claudeResult, opencodeResult] = await Promise.allSettled([
          listClaudeSessionsService(workspace.path, 50),
          includeOpenCodeSessions
            ? getOpenCodeSessionListService(workspace.id)
            : Promise.resolve<
                Awaited<ReturnType<typeof getOpenCodeSessionListService>>
              >([]),
        ]);
        if (claudeResult.status === "fulfilled") {
          const claudeSessions = Array.isArray(claudeResult.value)
            ? claudeResult.value
            : [];
          claudeSessions.forEach(
            (session: {
              sessionId: string;
              firstMessage: string;
              updatedAt: number;
              fileSizeBytes?: number;
            }) => {
              const id = `claude:${session.sessionId}`;
              if (hiddenSharedBindingIds.has(id)) {
                return;
              }
              const prev = mergedById.get(id);
              const updatedAt = session.updatedAt;
              const next: ThreadSummary = {
                id,
                name:
                  mappedTitles[id] ||
                  getCustomName(workspace.id, id) ||
                  previewThreadName(session.firstMessage, "Claude Session"),
                updatedAt,
                sizeBytes: normalizeThreadSizeBytes(session.fileSizeBytes),
                engineSource: "claude",
                threadKind: "native",
              };
              if (!prev || next.updatedAt >= prev.updatedAt) {
                mergedById.set(id, next);
              }
            },
          );
        }
        if (opencodeResult.status === "fulfilled") {
          const opencodeSessions = Array.isArray(opencodeResult.value)
            ? opencodeResult.value
            : [];
          opencodeSessions.forEach((session) => {
            const id = `opencode:${session.sessionId}`;
            if (hiddenSharedBindingIds.has(id)) {
              return;
            }
            const prev = mergedById.get(id);
            const sessionUpdatedAt =
              typeof session.updatedAt === "number" && Number.isFinite(session.updatedAt)
                ? Math.max(0, session.updatedAt)
                : 0;
            const updatedAt =
              sessionUpdatedAt ||
              nextActivityByThread[id] ||
              prev?.updatedAt ||
              0;
            if (updatedAt > (nextActivityByThread[id] ?? 0)) {
              nextActivityByThread[id] = updatedAt;
              didChangeActivity = true;
            }
            const next: ThreadSummary = {
              id,
              name:
                mappedTitles[id] ||
                getCustomName(workspace.id, id) ||
                previewThreadName(session.title, "OpenCode Session"),
              updatedAt,
              sizeBytes: extractThreadSizeBytes(session as Record<string, unknown>),
              engineSource: "opencode",
              threadKind: "native",
            };
            if (!prev || next.updatedAt >= prev.updatedAt) {
              mergedById.set(id, next);
            }
          });
        }
        if (!includeOpenCodeSessions) {
          existingThreads.forEach((thread) => {
            if (thread.threadKind === "shared" || hiddenSharedBindingIds.has(thread.id)) {
              return;
            }
            const isOpenCodeThread =
              thread.engineSource === "opencode"
              || thread.id.startsWith("opencode:")
              || thread.id.startsWith("opencode-pending-");
            if (!isOpenCodeThread) {
              return;
            }
            const prev = mergedById.get(thread.id);
            const threadUpdatedAt = Number.isFinite(thread.updatedAt)
              ? Math.max(0, thread.updatedAt)
              : 0;
            const updatedAt =
              threadUpdatedAt ||
              nextActivityByThread[thread.id] ||
              prev?.updatedAt ||
              0;
            if (updatedAt > (nextActivityByThread[thread.id] ?? 0)) {
              nextActivityByThread[thread.id] = updatedAt;
              didChangeActivity = true;
            }
            const next: ThreadSummary = {
              ...thread,
              updatedAt,
              engineSource: "opencode",
              threadKind: thread.threadKind ?? "native",
            };
            if (!prev || next.updatedAt >= prev.updatedAt) {
              mergedById.set(thread.id, next);
            }
          });
        }
        allSummaries = Array.from(mergedById.values()).sort(
          (a, b) => b.updatedAt - a.updatedAt,
        );
        if (hasFreshGeminiCache && cachedGemini.sessions.length > 0) {
          allSummaries = mergeGeminiSessionSummaries(
            allSummaries,
            cachedGemini.sessions.filter(
              (session) => !hiddenSharedBindingIds.has(`gemini:${session.sessionId}`),
            ),
            workspace.id,
            mappedTitles,
            getCustomName,
          );
        }
        if (sharedSessions.length > 0) {
          const sharedSummaries = sharedSessions.map(toSharedThreadSummary);
          const merged = new Map<string, ThreadSummary>();
          [...sharedSummaries, ...allSummaries].forEach((entry) => {
            const previous = merged.get(entry.id);
            if (!previous || entry.updatedAt >= previous.updatedAt) {
              merged.set(entry.id, entry);
            }
          });
          allSummaries = Array.from(merged.values()).sort(
            (a, b) => b.updatedAt - a.updatedAt,
          );
        }
        if (didChangeActivity) {
          const next = {
            ...threadActivityRef.current,
            [workspace.id]: nextActivityByThread,
          };
          threadActivityRef.current = next;
          saveThreadActivity(next);
        }

        dispatch({
          type: "setThreads",
          workspaceId: workspace.id,
          threads: allSummaries,
        });
        latestThreadsByWorkspaceRef.current = {
          ...latestThreadsByWorkspaceRef.current,
          [workspace.id]: allSummaries,
        };
        dispatch({
          type: "setThreadListCursor",
          workspaceId: workspace.id,
          cursor,
        });
        uniqueThreads.forEach((thread) => {
          const threadId = String(thread?.id ?? "");
          const preview = asString(thread?.preview ?? "").trim();
          if (!threadId || !preview) {
            return;
          }
          dispatch({
            type: "setLastAgentMessage",
            threadId,
            text: preview,
            timestamp: getThreadTimestamp(thread),
          });
        });

        const hasAttemptedGeminiRefresh =
          geminiRefreshAttemptedRef.current[workspace.id] === true;
        const shouldRefreshGeminiSessions =
          hasGeminiSignal || !!cachedGemini || !hasAttemptedGeminiRefresh;
        if (shouldRefreshGeminiSessions) {
          void (async () => {
            geminiRefreshAttemptedRef.current[workspace.id] = true;
            const geminiResult = await withTimeout(
              listGeminiSessionsService(workspace.path, 50),
              GEMINI_SESSION_FETCH_TIMEOUT_MS,
            );
            if (threadListRequestSeqRef.current[workspace.id] !== requestSeq) {
              return;
            }
            if (geminiResult === null) {
              onDebug?.({
                id: `${Date.now()}-client-gemini-session-timeout`,
                timestamp: Date.now(),
                source: "client",
                label: "thread/list gemini timeout",
                payload: {
                  workspaceId: workspace.id,
                  timeoutMs: GEMINI_SESSION_FETCH_TIMEOUT_MS,
                },
              });
              return;
            }
            const normalizedGeminiSessions = normalizeGeminiSessionSummaries(geminiResult);
            geminiSessionCacheRef.current[workspace.id] = {
              fetchedAt: Date.now(),
              sessions: normalizedGeminiSessions,
            };
            const currentSnapshot =
              latestThreadsByWorkspaceRef.current[workspace.id] ?? [];
            const baselineSummaries =
              currentSnapshot.length > 0 ? currentSnapshot : allSummaries;
            const nextSummaries = mergeGeminiSessionSummaries(
              baselineSummaries,
              normalizedGeminiSessions.filter(
                (session) => !hiddenSharedBindingIds.has(`gemini:${session.sessionId}`),
              ),
              workspace.id,
              mappedTitles,
              getCustomName,
            );
            const unchanged =
              nextSummaries.length === baselineSummaries.length &&
              nextSummaries.every((entry, index) => {
                const prev = baselineSummaries[index];
                return (
                  !!prev &&
                  prev.id === entry.id &&
                  prev.name === entry.name &&
                  prev.updatedAt === entry.updatedAt &&
                  prev.engineSource === entry.engineSource &&
                  prev.threadKind === entry.threadKind
                );
              });
            if (!unchanged) {
              dispatch({
                type: "setThreads",
                workspaceId: workspace.id,
                threads: nextSummaries,
              });
              latestThreadsByWorkspaceRef.current = {
                ...latestThreadsByWorkspaceRef.current,
                [workspace.id]: nextSummaries,
              };
            }
          })();
        }
      } catch (error) {
        onDebug?.({
          id: `${Date.now()}-client-thread-list-error`,
          timestamp: Date.now(),
          source: "error",
          label: "thread/list error",
          payload: error instanceof Error ? error.message : String(error),
        });
      } finally {
        if (!preserveState) {
          dispatch({
            type: "setThreadListLoading",
            workspaceId: workspace.id,
            isLoading: false,
          });
        }
      }
    },
    [
      dispatch,
      getCustomName,
      onDebug,
      onThreadTitleMappingsLoaded,
      activeThreadIdByWorkspace,
      threadActivityRef,
      threadsByWorkspace,
    ],
  );

  const loadOlderThreadsForWorkspace = useCallback(
    async (workspace: WorkspaceInfo) => {
      workspacePathsByIdRef.current[workspace.id] = workspace.path;
      const nextCursor = threadListCursorByWorkspace[workspace.id] ?? null;
      if (!nextCursor) {
        return;
      }
      const workspacePath = normalizeComparableWorkspacePath(workspace.path);
      const existing = threadsByWorkspace[workspace.id] ?? [];
      const activeThreadId = activeThreadIdByWorkspace[workspace.id] ?? "";
      const knownCodexThreadIds = collectKnownCodexThreadIds(existing, activeThreadId);
      dispatch({
        type: "setThreadListPaging",
        workspaceId: workspace.id,
        isLoading: true,
      });
      onDebug?.({
        id: `${Date.now()}-client-thread-list-older`,
        timestamp: Date.now(),
        source: "client",
        label: "thread/list older",
        payload: { workspaceId: workspace.id, cursor: nextCursor },
      });
      try {
        let mappedTitles: Record<string, string> = {};
        try {
          mappedTitles = await listThreadTitlesService(workspace.id);
          onThreadTitleMappingsLoaded?.(workspace.id, mappedTitles);
        } catch {
          mappedTitles = {};
        }
        const matchingThreads: Record<string, unknown>[] = [];
        const targetCount = THREAD_LIST_TARGET_COUNT;
        const pageSize = THREAD_LIST_PAGE_SIZE;
        const maxPagesWithoutMatch = THREAD_LIST_MAX_EMPTY_PAGES_LOAD_OLDER;
        let pagesFetched = 0;
        const fetchStartedAt = Date.now();
        let cursor: string | null = nextCursor;
        do {
          pagesFetched += 1;
          const response =
            (await listThreadsService(
              workspace.id,
              cursor,
              pageSize,
            )) as Record<string, unknown>;
          onDebug?.({
            id: `${Date.now()}-server-thread-list-older`,
            timestamp: Date.now(),
            source: "server",
            label: "thread/list older response",
            payload: response,
          });
          const result = (response.result ?? response) as Record<string, unknown>;
          const data = Array.isArray(result?.data)
            ? (result.data as Record<string, unknown>[])
            : [];
          const allowKnownCodexWithoutCwd = isLocalSessionScanUnavailable(result);
          const next =
            (result?.nextCursor ?? result?.next_cursor ?? null) as string | null;
          matchingThreads.push(
            ...data.filter(
              (thread) =>
                shouldIncludeWorkspaceThreadEntry(
                  thread,
                  workspacePath,
                  knownCodexThreadIds,
                  allowKnownCodexWithoutCwd,
                ),
            ),
          );
          cursor = next;
          if (matchingThreads.length === 0 && pagesFetched >= maxPagesWithoutMatch) {
            break;
          }
          if (pagesFetched >= THREAD_LIST_MAX_TOTAL_PAGES) {
            break;
          }
          if (Date.now() - fetchStartedAt >= THREAD_LIST_MAX_FETCH_DURATION_MS) {
            break;
          }
        } while (cursor && matchingThreads.length < targetCount);

        const existingIds = new Set(existing.map((thread) => thread.id));
        const additions: ThreadSummary[] = [];
        matchingThreads.forEach((thread) => {
          const id = String(thread?.id ?? "");
          if (!id || existingIds.has(id)) {
            return;
          }
          const preview = asString(thread?.preview ?? "").trim();
          const mappedTitle = mappedTitles[id];
          const customName = mappedTitle || getCustomName(workspace.id, id);
          const fallbackName = `Agent ${existing.length + additions.length + 1}`;
          const name = customName
            ? customName
            : preview.length > 0
              ? previewThreadName(preview, fallbackName)
              : fallbackName;
          additions.push({
            id,
            name,
            updatedAt: getThreadTimestamp(thread),
            sizeBytes: extractThreadSizeBytes(thread),
            ...resolveThreadSourceMeta(thread),
          });
          existingIds.add(id);
        });

        if (additions.length > 0) {
          dispatch({
            type: "setThreads",
            workspaceId: workspace.id,
            threads: [...existing, ...additions],
          });
        }
        dispatch({
          type: "setThreadListCursor",
          workspaceId: workspace.id,
          cursor,
        });
        matchingThreads.forEach((thread) => {
          const threadId = String(thread?.id ?? "");
          const preview = asString(thread?.preview ?? "").trim();
          if (!threadId || !preview) {
            return;
          }
          dispatch({
            type: "setLastAgentMessage",
            threadId,
            text: preview,
            timestamp: getThreadTimestamp(thread),
          });
        });
      } catch (error) {
        onDebug?.({
          id: `${Date.now()}-client-thread-list-older-error`,
          timestamp: Date.now(),
          source: "error",
          label: "thread/list older error",
          payload: error instanceof Error ? error.message : String(error),
        });
      } finally {
        dispatch({
          type: "setThreadListPaging",
          workspaceId: workspace.id,
          isLoading: false,
        });
      }
    },
    [
      dispatch,
      getCustomName,
      onDebug,
      onThreadTitleMappingsLoaded,
      activeThreadIdByWorkspace,
      threadListCursorByWorkspace,
      threadsByWorkspace,
    ],
  );

  const archiveThread = useCallback(
    async (workspaceId: string, threadId: string) => {
      try {
        await archiveThreadService(workspaceId, threadId);
      } catch (error) {
        onDebug?.({
          id: `${Date.now()}-client-thread-archive-error`,
          timestamp: Date.now(),
          source: "error",
          label: "thread/archive error",
          payload: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
    [onDebug],
  );

  const archiveClaudeThread = useCallback(
    async (workspaceId: string, threadId: string) => {
      const sessionId = threadId.startsWith("claude:")
        ? threadId.slice("claude:".length)
        : threadId;
      const workspacePath = workspacePathsByIdRef.current[workspaceId];
      if (!workspacePath) {
        throw new Error("workspace not connected");
      }
      try {
        await deleteClaudeSessionService(workspacePath, sessionId);
      } catch (error) {
        onDebug?.({
          id: `${Date.now()}-client-claude-archive-error`,
          timestamp: Date.now(),
          source: "error",
          label: "claude/archive error",
          payload: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
    [onDebug],
  );

  const deleteThreadForWorkspace = useCallback(
    async (workspaceId: string, threadId: string) => {
      if (threadId.includes("-pending-")) {
        return;
      }
      const thread = (threadsByWorkspace[workspaceId] ?? []).find((entry) => entry.id === threadId);
      if (thread?.threadKind === "shared" || threadId.startsWith("shared:")) {
        await deleteSharedSessionService(workspaceId, threadId);
        return;
      }
      if (threadId.startsWith("claude:")) {
        await archiveClaudeThread(workspaceId, threadId);
        return;
      }
      if (threadId.startsWith("opencode:")) {
        const sessionId = threadId.slice("opencode:".length);
        await deleteOpenCodeSessionService(workspaceId, sessionId);
        return;
      }
      if (threadId.startsWith("gemini:")) {
        const sessionId = threadId.slice("gemini:".length);
        const workspacePath = workspacePathsByIdRef.current[workspaceId];
        if (!workspacePath) {
          throw new Error("workspace not connected");
        }
        await deleteGeminiSessionService(workspacePath, sessionId);
        return;
      }
      await deleteCodexSessionService(workspaceId, threadId);
    },
    [archiveClaudeThread, threadsByWorkspace],
  );

  const renameThreadTitleMapping = useCallback(
    async (workspaceId: string, oldThreadId: string, newThreadId: string) => {
      try {
        await renameThreadTitleKeyService(workspaceId, oldThreadId, newThreadId);
        onRenameThreadTitleMapping?.(workspaceId, oldThreadId, newThreadId);
      } catch {
        const previousName = getCustomName(workspaceId, oldThreadId);
        if (!previousName) {
          return;
        }
        try {
          await setThreadTitleService(workspaceId, newThreadId, previousName);
          onRenameThreadTitleMapping?.(workspaceId, oldThreadId, newThreadId);
        } catch {
          // Best-effort persistence; ignore mapping failures.
        }
      }
    },
    [getCustomName, onRenameThreadTitleMapping],
  );

  return {
    startThreadForWorkspace,
    startSharedSessionForWorkspace,
    forkThreadForWorkspace,
    forkSessionFromMessageForWorkspace,
    forkClaudeSessionFromMessageForWorkspace,
    resumeThreadForWorkspace,
    refreshThread,
    resetWorkspaceThreads,
    listThreadsForWorkspace,
    loadOlderThreadsForWorkspace,
    archiveThread,
    archiveClaudeThread,
    deleteThreadForWorkspace,
    renameThreadTitleMapping,
  };
}
