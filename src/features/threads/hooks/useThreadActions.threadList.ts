import type { ThreadSummary, WorkspaceInfo } from "../../../types";
import {
  DEFAULT_VISIBLE_THREAD_ROOT_COUNT,
  normalizeVisibleThreadRootCount,
} from "../../app/constants";
import type { CodexCatalogSessionSummary } from "./useThreadActions.helpers";

export const THREAD_LIST_TARGET_COUNT = 50;
export const THREAD_LIST_PAGE_SIZE = 50;
export const THREAD_LIST_MAX_EMPTY_PAGES = 5;
export const THREAD_LIST_MAX_EMPTY_PAGES_WITH_ACTIVITY = 20;
export const THREAD_LIST_MAX_TOTAL_PAGES = 40;
export const THREAD_LIST_MAX_EMPTY_PAGES_LOAD_OLDER = 10;
export const SIDEBAR_THREAD_LIST_TIMEOUT_MS = 30_000;
export const THREAD_LIST_MAX_FETCH_DURATION_MS =
  SIDEBAR_THREAD_LIST_TIMEOUT_MS;
export const THREAD_LIST_LIVE_REQUEST_TIMEOUT_MS =
  SIDEBAR_THREAD_LIST_TIMEOUT_MS;
export const THREAD_RECOVERY_MAX_PAGES = 3;
export const THREAD_RECOVERY_MAX_FETCH_DURATION_MS =
  SIDEBAR_THREAD_LIST_TIMEOUT_MS;
export const THREAD_RECOVERY_HISTORY_MATCH_CANDIDATES = 8;
export const RELATED_THREAD_LOAD_CONCURRENCY = 2;
export const DEFAULT_CLAUDE_CONTEXT_WINDOW = 200_000;
export const GEMINI_SESSION_CACHE_TTL_MS = 60_000;
export const GEMINI_SESSION_FETCH_TIMEOUT_MS =
  SIDEBAR_THREAD_LIST_TIMEOUT_MS;
export const NATIVE_SESSION_LIST_FETCH_TIMEOUT_MS =
  SIDEBAR_THREAD_LIST_TIMEOUT_MS;
export const CODEX_SESSION_CATALOG_FETCH_TIMEOUT_MS =
  SIDEBAR_THREAD_LIST_TIMEOUT_MS;
export const SESSION_CATALOG_PAGE_SIZE = 200;

const MIN_NATIVE_SESSION_LIST_LIMIT = Math.min(
  SESSION_CATALOG_PAGE_SIZE,
  DEFAULT_VISIBLE_THREAD_ROOT_COUNT,
);
const THREAD_LIST_CURSOR_SOURCE_SEPARATOR = "::";
const THREAD_LIST_CURSOR_CATALOG_ROOT = "__root__";

type ThreadListCursorSource = "catalog" | "runtime";

export type StartupThreadHydrationMode = "first-page" | "full-catalog";

export type ThreadListCursorState = {
  source: ThreadListCursorSource;
  cursor: string | null;
};

export type ProjectCatalogSessionSummary = {
  sessionId: string;
  workspaceId?: string | null;
  matchedWorkspaceId?: string | null;
  title: string;
  updatedAt: number;
  sizeBytes?: number;
  parentSessionId?: string | null;
  engine?: ThreadSummary["engineSource"] | string | null;
  source?: string | null;
  provider?: string | null;
  sourceLabel?: string | null;
  folderId?: string | null;
};

function encodeThreadListCursorState(
  source: ThreadListCursorSource,
  cursor: string | null,
): string {
  return `${source}${THREAD_LIST_CURSOR_SOURCE_SEPARATOR}${cursor ?? THREAD_LIST_CURSOR_CATALOG_ROOT}`;
}

export function decodeThreadListCursorState(
  cursor: string,
): ThreadListCursorState {
  const trimmedCursor = cursor.trim();
  if (
    trimmedCursor.startsWith(`catalog${THREAD_LIST_CURSOR_SOURCE_SEPARATOR}`)
  ) {
    const value = trimmedCursor.slice(
      `catalog${THREAD_LIST_CURSOR_SOURCE_SEPARATOR}`.length,
    );
    return {
      source: "catalog",
      cursor: value === THREAD_LIST_CURSOR_CATALOG_ROOT ? null : value,
    };
  }
  if (
    trimmedCursor.startsWith(`runtime${THREAD_LIST_CURSOR_SOURCE_SEPARATOR}`)
  ) {
    const value = trimmedCursor.slice(
      `runtime${THREAD_LIST_CURSOR_SOURCE_SEPARATOR}`.length,
    );
    return {
      source: "runtime",
      cursor: value === THREAD_LIST_CURSOR_CATALOG_ROOT ? null : value,
    };
  }
  if (trimmedCursor.startsWith("offset:")) {
    return { source: "catalog", cursor: trimmedCursor };
  }
  return { source: "runtime", cursor: trimmedCursor };
}

export function resolveNativeSessionListLimit(
  workspace: WorkspaceInfo,
): number {
  const visibleRootCount = normalizeVisibleThreadRootCount(
    workspace.settings.visibleThreadRootCount,
  );
  return Math.min(
    SESSION_CATALOG_PAGE_SIZE,
    Math.max(MIN_NATIVE_SESSION_LIST_LIMIT, visibleRootCount),
  );
}

export function resolveThreadListCursorForDisplay(params: {
  catalogCursor: string | null;
  catalogPartialSource: string | null;
  runtimeCursor: string | null;
}): string | null {
  if (params.catalogCursor) {
    return encodeThreadListCursorState("catalog", params.catalogCursor);
  }
  if (params.catalogPartialSource) {
    return encodeThreadListCursorState("catalog", null);
  }
  if (params.runtimeCursor) {
    return encodeThreadListCursorState("runtime", params.runtimeCursor);
  }
  return null;
}

export function countSummariesByEngine(summaries: ThreadSummary[]) {
  return summaries.reduce<Record<string, number>>((counts, summary) => {
    const engine = summary.engineSource ?? "unknown";
    counts[engine] = (counts[engine] ?? 0) + 1;
    return counts;
  }, {});
}

export function countCatalogSessionsByEngine(
  sessions: Pick<CodexCatalogSessionSummary, "engine">[],
) {
  return sessions.reduce<Record<string, number>>((counts, session) => {
    const engine =
      typeof session.engine === "string" && session.engine.trim()
        ? session.engine.trim()
        : "unknown";
    counts[engine] = (counts[engine] ?? 0) + 1;
    return counts;
  }, {});
}

export function normalizeProjectCatalogSession(
  entry: unknown,
): ProjectCatalogSessionSummary | null {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const session = entry as {
    sessionId?: unknown;
    title?: unknown;
    workspaceId?: unknown;
    matchedWorkspaceId?: unknown;
    updatedAt?: unknown;
    sizeBytes?: unknown;
    parentSessionId?: unknown;
    engine?: unknown;
    source?: unknown;
    provider?: unknown;
    sourceLabel?: unknown;
    folderId?: unknown;
  };
  const sessionId = String(session.sessionId ?? "").trim();
  if (!sessionId) {
    return null;
  }
  return {
    sessionId,
    workspaceId:
      typeof session.workspaceId === "string" || session.workspaceId == null
        ? (session.workspaceId ?? null)
        : null,
    matchedWorkspaceId:
      typeof session.matchedWorkspaceId === "string" ||
      session.matchedWorkspaceId == null
        ? (session.matchedWorkspaceId ?? null)
        : null,
    title: String(session.title ?? "").trim(),
    updatedAt:
      typeof session.updatedAt === "number" &&
      Number.isFinite(session.updatedAt)
        ? session.updatedAt
        : 0,
    sizeBytes:
      typeof session.sizeBytes === "number" &&
      Number.isFinite(session.sizeBytes)
        ? session.sizeBytes
        : undefined,
    parentSessionId:
      typeof session.parentSessionId === "string" ||
      session.parentSessionId == null
        ? (session.parentSessionId ?? null)
        : null,
    engine:
      typeof session.engine === "string" || session.engine == null
        ? (session.engine ?? null)
        : null,
    source:
      typeof session.source === "string" || session.source == null
        ? (session.source ?? null)
        : null,
    provider:
      typeof session.provider === "string" || session.provider == null
        ? (session.provider ?? null)
        : null,
    sourceLabel:
      typeof session.sourceLabel === "string" || session.sourceLabel == null
        ? (session.sourceLabel ?? null)
        : null,
    folderId:
      typeof session.folderId === "string" || session.folderId == null
        ? (session.folderId ?? null)
        : null,
  };
}
