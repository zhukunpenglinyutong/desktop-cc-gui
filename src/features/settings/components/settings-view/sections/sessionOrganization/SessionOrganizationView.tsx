import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  assignWorkspaceSessionFolder,
  createWorkspaceSessionFolder,
  deleteWorkspaceSessionFolder,
  deleteWorkspaceSessions,
  listWorkspaceSessionFolders,
  renameWorkspaceSessionFolder,
  type WorkspaceSessionCatalogEntry,
  type WorkspaceSessionFolder,
} from "../../../../../../services/tauri/sessionManagement";
import {
  buildSessionFolderProjection,
  type FolderProjection,
  type FolderProjectionNode,
} from "./folderProjection";
import {
  SessionFolderTree,
  type SessionFolderSelection,
} from "./SessionFolderTree";
import { filterEntriesBySelection } from "./sessionFilters";
import { OrganizationSessionList } from "./OrganizationSessionList";
import { SubfolderCardGrid } from "./SubfolderCardGrid";
import { SessionDetailModal } from "./SessionDetailModal";

type SessionOrganizationViewProps = {
  workspaceId: string;
  workspacePath?: string | null;
  entries: WorkspaceSessionCatalogEntry[];
  selectedIds: Record<string, true>;
  onToggleSelection: (selectionKey: string) => void;
  onOpenSessionInMainWindow?: (entry: WorkspaceSessionCatalogEntry) => void;
  onCatalogMutated?: () => void;
  locale: string;
};

export function SessionOrganizationView({
  workspaceId,
  workspacePath,
  entries,
  selectedIds,
  onToggleSelection,
  onOpenSessionInMainWindow,
  onCatalogMutated,
  locale,
}: SessionOrganizationViewProps) {
  const { t } = useTranslation();
  const [folders, setFolders] = useState<WorkspaceSessionFolder[]>([]);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [selection, setSelection] = useState<SessionFolderSelection>({
    kind: "unfiled",
  });
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<
    ReadonlySet<string>
  >(() => new Set<string>());
  const [detailEntry, setDetailEntry] =
    useState<WorkspaceSessionCatalogEntry | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFolderError(null);
    listWorkspaceSessionFolders(workspaceId)
      .then((tree) => {
        if (cancelled) return;
        setFolders(tree.folders);
      })
      .catch((error) => {
        if (cancelled) return;
        setFolderError(
          error instanceof Error ? error.message : String(error),
        );
        setFolders([]);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const reloadFolders = useCallback(async () => {
    try {
      const tree = await listWorkspaceSessionFolders(workspaceId);
      setFolders(tree.folders);
      setFolderError(null);
    } catch (error) {
      setFolderError(error instanceof Error ? error.message : String(error));
    }
  }, [workspaceId]);

  const handleCreateFolder = useCallback(
    async (parentId: string | null, name: string) => {
      await createWorkspaceSessionFolder(workspaceId, name, parentId);
      await reloadFolders();
    },
    [reloadFolders, workspaceId],
  );

  const handleRenameFolder = useCallback(
    async (folderId: string, name: string) => {
      await renameWorkspaceSessionFolder(workspaceId, folderId, name);
      await reloadFolders();
    },
    [reloadFolders, workspaceId],
  );

  useEffect(() => {
    if (
      selection.kind === "folder" &&
      !folders.some((folder) => folder.id === selection.folderId)
    ) {
      setSelection({ kind: "unfiled" });
    }
  }, [folders, selection]);

  const projection: FolderProjection = useMemo(
    () => buildSessionFolderProjection({ folders, entries }),
    [entries, folders],
  );

  const handleDeleteFolder = useCallback(
    async (folderId: string, cascade: boolean) => {
      const node = projection.folderById.get(folderId);
      if (!node) {
        await deleteWorkspaceSessionFolder(workspaceId, folderId);
        await reloadFolders();
        return;
      }

      const folderIdsPostOrder: string[] = [];
      const walkFolders = (current: FolderProjectionNode) => {
        current.children.forEach(walkFolders);
        folderIdsPostOrder.push(current.folder.id);
      };
      walkFolders(node);

      const folderIdSet = new Set(folderIdsPostOrder);
      const subtreeSessionIds = entries
        .filter((entry) => {
          const id = entry.folderId?.trim();
          return id ? folderIdSet.has(id) : false;
        })
        .map((entry) => entry.sessionId);

      let catalogChanged = false;

      if (subtreeSessionIds.length > 0) {
        if (cascade) {
          await deleteWorkspaceSessions(workspaceId, subtreeSessionIds);
        } else {
          for (const sessionId of subtreeSessionIds) {
            await assignWorkspaceSessionFolder(workspaceId, sessionId, null);
          }
        }
        catalogChanged = true;
      }

      for (const id of folderIdsPostOrder) {
        await deleteWorkspaceSessionFolder(workspaceId, id);
      }
      await reloadFolders();
      if (catalogChanged) {
        onCatalogMutated?.();
      }
    },
    [entries, onCatalogMutated, projection.folderById, reloadFolders, workspaceId],
  );

  const knownFolderIds = useMemo(
    () => new Set(folders.map((folder) => folder.id)),
    [folders],
  );

  const visibleEntries = useMemo(
    () => filterEntriesBySelection(entries, selection, knownFolderIds),
    [entries, knownFolderIds, selection],
  );

  const handleToggleCollapse = (folderId: string) => {
    setCollapsedFolderIds((current) => {
      const next = new Set(current);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  const selectedSummary = useMemo(() => {
    if (selection.kind === "unfiled") {
      return {
        title: t("settings.sessionOrganizationUnfiledNodeLabel"),
        directCount: projection.unfiledEntryCount,
      };
    }
    const node = projection.folderById.get(selection.folderId);
    if (!node) {
      return null;
    }
    return {
      title: node.folder.name,
      directCount: node.directEntryCount,
    };
  }, [projection, selection, t]);

  const subfolderChildren = useMemo(() => {
    if (selection.kind !== "folder") {
      return [];
    }
    return projection.folderById.get(selection.folderId)?.children ?? [];
  }, [projection, selection]);

  const detailFolderPath = useMemo(() => {
    if (!detailEntry) return [];
    const startingFolderId = detailEntry.folderId?.trim() || null;
    if (!startingFolderId) return [];
    const result: string[] = [];
    let cursor = projection.folderById.get(startingFolderId);
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor.folder.id)) {
      seen.add(cursor.folder.id);
      result.unshift(cursor.folder.name);
      const parentId = cursor.folder.parentId?.trim();
      cursor = parentId ? projection.folderById.get(parentId) : undefined;
    }
    return result;
  }, [detailEntry, projection.folderById]);

  const emptyMessage =
    selection.kind === "unfiled"
      ? t("settings.sessionOrganizationUnfiledEmpty")
      : t("settings.sessionOrganizationFolderEmpty");

  return (
    <div
      className="session-organization-view"
      data-testid="session-organization-view"
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(280px, 380px) minmax(0, 1fr)",
        gap: "1rem",
        height: "100%",
        minHeight: 0,
      }}
    >
      <aside
        className="session-organization-view-pane session-organization-view-pane-left"
        style={{
          minHeight: 0,
          minWidth: 0,
          overflowX: "auto",
          overflowY: "auto",
          paddingInlineEnd: "0.5rem",
          borderInlineEnd: "1px solid var(--border, rgba(0,0,0,0.08))",
        }}
      >
        {folderError ? (
          <div role="alert" className="session-organization-view-error">
            {folderError}
          </div>
        ) : null}
        <SessionFolderTree
          projection={projection}
          selection={selection}
          collapsedFolderIds={collapsedFolderIds}
          onSelectionChange={setSelection}
          onToggleCollapse={handleToggleCollapse}
          onSetCollapsedFolderIds={(ids) => setCollapsedFolderIds(ids)}
          onCreateFolder={handleCreateFolder}
          onRenameFolder={handleRenameFolder}
          onDeleteFolder={handleDeleteFolder}
        />
      </aside>
      <section
        className="session-organization-view-pane session-organization-view-pane-right"
        style={{
          minHeight: 0,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: "0.75rem",
        }}
      >
        <header
          className="session-organization-view-pane-header"
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: "0.5rem",
            paddingBottom: "0.25rem",
            borderBottom: "1px solid var(--border, rgba(0,0,0,0.08))",
          }}
        >
          <h4
            className="session-organization-view-pane-title"
            data-testid="session-organization-view-selected-title"
            style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600 }}
          >
            {selectedSummary?.title ?? ""}
          </h4>
          {selectedSummary ? (
            <span
              className="session-organization-view-pane-meta"
              style={{
                fontSize: "0.75rem",
                color: "var(--muted-foreground, rgba(0,0,0,0.55))",
              }}
            >
              {t("settings.sessionOrganizationDirectCount", {
                count: selectedSummary.directCount,
              })}
            </span>
          ) : null}
        </header>
        <OrganizationSessionList
          entries={visibleEntries}
          selectedIds={selectedIds}
          onToggleSelection={onToggleSelection}
          onOpenSessionDetail={setDetailEntry}
          emptyMessage={emptyMessage}
          locale={locale}
        />
        {selection.kind === "folder" ? (
          <SubfolderCardGrid
            nodes={subfolderChildren}
            locale={locale}
            onSelect={(folderId) =>
              setSelection({ kind: "folder", folderId })
            }
          />
        ) : null}
      </section>
      {detailEntry ? (
        <SessionDetailModal
          workspaceId={workspaceId}
          workspacePath={workspacePath ?? null}
          entry={detailEntry}
          folderPath={detailFolderPath}
          locale={locale}
          onClose={() => setDetailEntry(null)}
          onOpenInMainWindow={
            onOpenSessionInMainWindow
              ? (entry) => {
                  onOpenSessionInMainWindow(entry);
                  setDetailEntry(null);
                }
              : undefined
          }
        />
      ) : null}
    </div>
  );
}
