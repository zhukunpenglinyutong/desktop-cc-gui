import { useCallback } from "react";
import type { Dispatch, MutableRefObject } from "react";
import type {
  DebugEntry,
  ThreadSummary,
  WorkspaceInfo,
} from "../../../types";
import type { WorkspaceSessionCatalogPage } from "../../../services/tauri";
import {
  listThreadTitles as listThreadTitlesService,
  listThreads as listThreadsService,
} from "../../../services/tauri";
import {
  getThreadTimestamp,
  previewThreadName,
} from "../../../utils/threadItems";
import { asString } from "../utils/threadNormalize";
import {
  collectKnownCodexThreadIds,
  normalizeComparableWorkspacePath,
} from "./useThreadActions.workspacePath";
import {
  extractThreadSizeBytes,
  isLocalSessionScanUnavailable,
  mergeCodexCatalogSessionSummaries,
  resolveThreadSourceMeta,
  shouldIncludeWorkspaceThreadEntry,
  withTimeout,
} from "./useThreadActions.helpers";
import {
  CODEX_SESSION_CATALOG_FETCH_TIMEOUT_MS,
  SESSION_CATALOG_PAGE_SIZE,
  THREAD_LIST_MAX_EMPTY_PAGES_LOAD_OLDER,
  THREAD_LIST_MAX_FETCH_DURATION_MS,
  THREAD_LIST_MAX_TOTAL_PAGES,
  THREAD_LIST_PAGE_SIZE,
  THREAD_LIST_TARGET_COUNT,
  decodeThreadListCursorState,
  normalizeProjectCatalogSession,
  resolveThreadListCursorForDisplay,
  type ProjectCatalogSessionSummary,
} from "./useThreadActions.threadList";
import type { ListWorkspaceSessionsService } from "./useThreadActionsSessionCatalog";
import type { ThreadAction, ThreadState } from "./useThreadsReducer";

type UseLoadOlderThreadsForWorkspaceOptions = {
  activeThreadIdByWorkspace: ThreadState["activeThreadIdByWorkspace"];
  applySessionArchiveState: (
    summaries: ThreadSummary[],
    archivedAtBySessionId: Map<string, number> | null,
  ) => ThreadSummary[];
  canListWorkspaceSessions: boolean;
  dispatch: Dispatch<ThreadAction>;
  getCustomName: (workspaceId: string, threadId: string) => string | undefined;
  latestThreadsByWorkspaceRef: MutableRefObject<
    Record<string, ThreadSummary[] | undefined>
  >;
  listWorkspaceSessionsService: ListWorkspaceSessionsService | null;
  loadArchivedSessionMap: (
    workspaceId: string,
  ) => Promise<Map<string, number> | null>;
  onDebug?: (entry: DebugEntry) => void;
  onThreadTitleMappingsLoaded?: (
    workspaceId: string,
    titles: Record<string, string>,
  ) => void;
  threadListCursorByWorkspace: ThreadState["threadListCursorByWorkspace"];
  threadsByWorkspace: ThreadState["threadsByWorkspace"];
  workspacePathsByIdRef: MutableRefObject<Record<string, string>>;
};

export function useLoadOlderThreadsForWorkspace({
  activeThreadIdByWorkspace,
  applySessionArchiveState,
  canListWorkspaceSessions,
  dispatch,
  getCustomName,
  latestThreadsByWorkspaceRef,
  listWorkspaceSessionsService,
  loadArchivedSessionMap,
  onDebug,
  onThreadTitleMappingsLoaded,
  threadListCursorByWorkspace,
  threadsByWorkspace,
  workspacePathsByIdRef,
}: UseLoadOlderThreadsForWorkspaceOptions) {
  return useCallback(
    async (workspace: WorkspaceInfo) => {
      workspacePathsByIdRef.current[workspace.id] = workspace.path;
      const encodedNextCursor =
        threadListCursorByWorkspace[workspace.id] ?? null;
      if (!encodedNextCursor) {
        return;
      }
      const cursorState = decodeThreadListCursorState(encodedNextCursor);
      const workspacePath = normalizeComparableWorkspacePath(workspace.path);
      const existing = threadsByWorkspace[workspace.id] ?? [];
      const activeThreadId = activeThreadIdByWorkspace[workspace.id] ?? "";
      const knownCodexThreadIds = collectKnownCodexThreadIds(
        existing,
        activeThreadId,
      );
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
        payload: {
          workspaceId: workspace.id,
          cursor: encodedNextCursor,
          cursorSource: cursorState.source,
        },
      });
      try {
        let mappedTitles: Record<string, string> = {};
        const archivedSessionMapPromise = loadArchivedSessionMap(workspace.id);
        try {
          mappedTitles = await listThreadTitlesService(workspace.id);
          onThreadTitleMappingsLoaded?.(workspace.id, mappedTitles);
        } catch {
          mappedTitles = {};
        }
        let catalogCursor: string | null = null;
        let didLoadCatalogPage = false;
        let catalogSessions: ProjectCatalogSessionSummary[] = [];
        let catalogPartialSource: string | null = null;
        if (
          canListWorkspaceSessions &&
          listWorkspaceSessionsService &&
          cursorState.source === "catalog"
        ) {
          const response: WorkspaceSessionCatalogPage | null =
            await withTimeout(
              listWorkspaceSessionsService(workspace.id, {
                query: { status: "active" },
                cursor: cursorState.cursor,
                limit: SESSION_CATALOG_PAGE_SIZE,
              }),
              CODEX_SESSION_CATALOG_FETCH_TIMEOUT_MS,
            );
          if (response) {
            didLoadCatalogPage = true;
            catalogCursor = response.nextCursor ?? null;
            catalogPartialSource = response.partialSource ?? null;
            catalogSessions = response.data
              .map((entry) => normalizeProjectCatalogSession(entry))
              .filter(
                (entry): entry is ProjectCatalogSessionSummary =>
                  Boolean(entry) &&
                  (entry!.workspaceId ?? workspace.id) === workspace.id,
              );
          } else {
            catalogPartialSource = "session-catalog-load-older-timeout";
          }
        }
        const matchingThreads: Record<string, unknown>[] = [];
        const targetCount = THREAD_LIST_TARGET_COUNT;
        const pageSize = THREAD_LIST_PAGE_SIZE;
        const maxPagesWithoutMatch = THREAD_LIST_MAX_EMPTY_PAGES_LOAD_OLDER;
        let pagesFetched = 0;
        const fetchStartedAt = Date.now();
        let runtimeCursor: string | null = null;
        if (cursorState.source === "runtime") {
          runtimeCursor = cursorState.cursor;
          do {
            pagesFetched += 1;
            const response = (await listThreadsService(
              workspace.id,
              runtimeCursor,
              pageSize,
            )) as Record<string, unknown>;
            onDebug?.({
              id: `${Date.now()}-server-thread-list-older`,
              timestamp: Date.now(),
              source: "server",
              label: "thread/list older response",
              payload: response,
            });
            const result = (response.result ?? response) as Record<
              string,
              unknown
            >;
            const data = Array.isArray(result?.data)
              ? (result.data as Record<string, unknown>[])
              : [];
            const allowKnownCodexWithoutCwd =
              isLocalSessionScanUnavailable(result);
            const next = (result?.nextCursor ?? result?.next_cursor ?? null) as
              | string
              | null;
            matchingThreads.push(
              ...data.filter((thread) =>
                shouldIncludeWorkspaceThreadEntry(
                  thread,
                  workspacePath,
                  knownCodexThreadIds,
                  allowKnownCodexWithoutCwd,
                ),
              ),
            );
            runtimeCursor = next;
            if (
              matchingThreads.length === 0 &&
              pagesFetched >= maxPagesWithoutMatch
            ) {
              break;
            }
            if (pagesFetched >= THREAD_LIST_MAX_TOTAL_PAGES) {
              break;
            }
            if (
              Date.now() - fetchStartedAt >=
              THREAD_LIST_MAX_FETCH_DURATION_MS
            ) {
              break;
            }
          } while (runtimeCursor && matchingThreads.length < targetCount);
        }

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

        const visibleAdditions = applySessionArchiveState(
          additions,
          await archivedSessionMapPromise,
        );

        const mergedCatalogThreads = mergeCodexCatalogSessionSummaries(
          [...existing, ...visibleAdditions],
          catalogSessions,
          workspace.id,
          mappedTitles,
          getCustomName,
        );
        const visibleMergedThreads = applySessionArchiveState(
          mergedCatalogThreads,
          await archivedSessionMapPromise,
        );

        const visibleMergedIds = visibleMergedThreads
          .map((thread) => thread.id)
          .join("\u0000");
        const existingIdsSignature = existing
          .map((thread) => thread.id)
          .join("\u0000");
        if (visibleMergedIds !== existingIdsSignature) {
          dispatch({
            type: "setThreads",
            workspaceId: workspace.id,
            threads: visibleMergedThreads,
          });
          latestThreadsByWorkspaceRef.current = {
            ...latestThreadsByWorkspaceRef.current,
            [workspace.id]: visibleMergedThreads,
          };
        }
        dispatch({
          type: "setThreadListCursor",
          workspaceId: workspace.id,
          cursor: didLoadCatalogPage
            ? resolveThreadListCursorForDisplay({
                catalogCursor,
                catalogPartialSource,
                runtimeCursor: null,
              })
            : resolveThreadListCursorForDisplay({
                catalogCursor: null,
                catalogPartialSource: null,
                runtimeCursor,
              }),
        });
        if (catalogPartialSource) {
          onDebug?.({
            id: `${Date.now()}-client-thread-list-older-catalog-partial`,
            timestamp: Date.now(),
            source: "client",
            label: "thread/list older catalog partial",
            payload: {
              workspaceId: workspace.id,
              partialSource: catalogPartialSource,
            },
          });
        }
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
      activeThreadIdByWorkspace,
      applySessionArchiveState,
      canListWorkspaceSessions,
      dispatch,
      getCustomName,
      latestThreadsByWorkspaceRef,
      listWorkspaceSessionsService,
      loadArchivedSessionMap,
      onDebug,
      onThreadTitleMappingsLoaded,
      threadListCursorByWorkspace,
      threadsByWorkspace,
      workspacePathsByIdRef,
    ],
  );
}
