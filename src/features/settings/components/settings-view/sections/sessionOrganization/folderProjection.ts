import type {
  WorkspaceSessionCatalogEntry,
  WorkspaceSessionFolder,
} from "../../../../../../services/tauri/sessionManagement";

export type FolderProjectionNode = {
  folder: WorkspaceSessionFolder;
  children: FolderProjectionNode[];
  directEntryCount: number;
  directLatestUpdatedAt: number | null;
  totalEntryCount: number;
  totalLatestUpdatedAt: number | null;
};

export type FolderProjection = {
  unfiledEntryCount: number;
  unfiledLatestUpdatedAt: number | null;
  rootFolders: FolderProjectionNode[];
  folderById: ReadonlyMap<string, FolderProjectionNode>;
};

function normalizeFolderId(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function sortFolders(
  folders: WorkspaceSessionFolder[],
): WorkspaceSessionFolder[] {
  return [...folders].sort(
    (left, right) =>
      left.name
        .toLocaleLowerCase()
        .localeCompare(right.name.toLocaleLowerCase()) ||
      left.createdAt - right.createdAt ||
      left.id.localeCompare(right.id),
  );
}

function hasReachableCycle(
  folderId: string,
  parentById: ReadonlyMap<string, string | null>,
): boolean {
  const seen = new Set<string>();
  let cursor: string | null = folderId;
  while (cursor) {
    if (seen.has(cursor)) {
      return true;
    }
    seen.add(cursor);
    cursor = parentById.get(cursor) ?? null;
  }
  return false;
}

function maxNullable(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return a > b ? a : b;
}

export function buildSessionFolderProjection(params: {
  folders: WorkspaceSessionFolder[];
  entries: WorkspaceSessionCatalogEntry[];
}): FolderProjection {
  const sortedFolders = sortFolders(params.folders);
  const folderIds = new Set(sortedFolders.map((folder) => folder.id));

  const nodeById = new Map<string, FolderProjectionNode>();
  const parentById = new Map<string, string | null>();

  sortedFolders.forEach((folder) => {
    parentById.set(folder.id, normalizeFolderId(folder.parentId));
    nodeById.set(folder.id, {
      folder,
      children: [],
      directEntryCount: 0,
      directLatestUpdatedAt: null,
      totalEntryCount: 0,
      totalLatestUpdatedAt: null,
    });
  });

  const rootFolders: FolderProjectionNode[] = [];
  sortedFolders.forEach((folder) => {
    const node = nodeById.get(folder.id);
    if (!node) {
      return;
    }
    const parentId = normalizeFolderId(folder.parentId);
    const isValidParent =
      Boolean(parentId) &&
      parentId !== folder.id &&
      folderIds.has(parentId as string) &&
      !hasReachableCycle(folder.id, parentById);
    if (isValidParent) {
      nodeById.get(parentId as string)?.children.push(node);
      return;
    }
    rootFolders.push(node);
  });

  let unfiledEntryCount = 0;
  let unfiledLatestUpdatedAt: number | null = null;
  params.entries.forEach((entry) => {
    const folderId = normalizeFolderId(entry.folderId ?? null);
    const node = folderId ? nodeById.get(folderId) ?? null : null;
    if (!node) {
      unfiledEntryCount += 1;
      unfiledLatestUpdatedAt = maxNullable(unfiledLatestUpdatedAt, entry.updatedAt);
      return;
    }
    node.directEntryCount += 1;
    node.directLatestUpdatedAt = maxNullable(
      node.directLatestUpdatedAt,
      entry.updatedAt,
    );
  });

  const aggregate = (node: FolderProjectionNode): void => {
    node.totalEntryCount = node.directEntryCount;
    node.totalLatestUpdatedAt = node.directLatestUpdatedAt;
    node.children.forEach((child) => {
      aggregate(child);
      node.totalEntryCount += child.totalEntryCount;
      node.totalLatestUpdatedAt = maxNullable(
        node.totalLatestUpdatedAt,
        child.totalLatestUpdatedAt,
      );
    });
  };
  rootFolders.forEach(aggregate);

  return {
    unfiledEntryCount,
    unfiledLatestUpdatedAt,
    rootFolders,
    folderById: nodeById,
  };
}
