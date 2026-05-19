import { useCallback } from "react";
import type {
  WorkspaceSessionCatalogPage,
  WorkspaceSessionCatalogQuery,
} from "../../../services/tauri";
import { withTimeout } from "./useThreadActions.helpers";
import {
  CODEX_SESSION_CATALOG_FETCH_TIMEOUT_MS,
  SESSION_CATALOG_PAGE_SIZE,
  normalizeProjectCatalogSession,
  type ProjectCatalogSessionSummary,
} from "./useThreadActions.threadList";

export type ListWorkspaceSessionsService = (
  workspaceId: string,
  options: {
    query?: WorkspaceSessionCatalogQuery | null;
    cursor?: string | null;
    limit?: number | null;
  },
) => Promise<WorkspaceSessionCatalogPage>;

type UseThreadActionsSessionCatalogOptions = {
  canListWorkspaceSessions: boolean;
  listWorkspaceSessionsService: ListWorkspaceSessionsService | null;
};

export function useThreadActionsSessionCatalog({
  canListWorkspaceSessions,
  listWorkspaceSessionsService,
}: UseThreadActionsSessionCatalogOptions) {
  const loadArchivedSessionMap = useCallback(
    async (workspaceId: string): Promise<Map<string, number> | null> => {
      if (!canListWorkspaceSessions || !listWorkspaceSessionsService) {
        return null;
      }
      try {
        const archivedAtBySessionId = new Map<string, number>();
        let cursor: string | null = null;
        const visitedCursors = new Set<string>();
        do {
          const currentCursor = cursor;
          const cursorKey = currentCursor ?? "__root__";
          if (visitedCursors.has(cursorKey)) {
            break;
          }
          visitedCursors.add(cursorKey);
          const response = await listWorkspaceSessionsService(workspaceId, {
            query: { status: "all" },
            cursor: currentCursor,
            limit: SESSION_CATALOG_PAGE_SIZE,
          });
          response.data.forEach((entry) => {
            const archivedAt =
              typeof entry.archivedAt === "number" &&
              Number.isFinite(entry.archivedAt)
                ? Math.max(0, entry.archivedAt)
                : 0;
            if (archivedAt > 0) {
              archivedAtBySessionId.set(entry.sessionId, archivedAt);
            }
          });
          cursor = response.nextCursor ?? null;
        } while (cursor);
        return archivedAtBySessionId;
      } catch {
        return null;
      }
    },
    [canListWorkspaceSessions, listWorkspaceSessionsService],
  );

  const loadActiveProjectCatalogSessions = useCallback(
    async (
      workspaceId: string,
    ): Promise<{
      sessions: ProjectCatalogSessionSummary[];
      partialSource: string | null;
      nextCursor: string | null;
    } | null> => {
      if (!canListWorkspaceSessions || !listWorkspaceSessionsService) {
        return null;
      }
      const response: WorkspaceSessionCatalogPage | null = await withTimeout(
        listWorkspaceSessionsService(workspaceId, {
          query: { status: "active" },
          cursor: null,
          limit: SESSION_CATALOG_PAGE_SIZE,
        }),
        CODEX_SESSION_CATALOG_FETCH_TIMEOUT_MS,
      );
      if (!response) {
        return {
          sessions: [],
          partialSource: "session-catalog-timeout",
          nextCursor: null,
        };
      }
      const sessions = response.data
        .map((entry: unknown) => normalizeProjectCatalogSession(entry))
        .filter((entry): entry is ProjectCatalogSessionSummary => {
          if (!entry) {
            return false;
          }
          return (entry.workspaceId ?? workspaceId) === workspaceId;
        });
      return {
        sessions,
        partialSource: response.partialSource ?? null,
        nextCursor: response.nextCursor ?? null,
      };
    },
    [canListWorkspaceSessions, listWorkspaceSessionsService],
  );

  return {
    loadActiveProjectCatalogSessions,
    loadArchivedSessionMap,
  };
}
