import type { WorkspaceSessionCatalogEntry } from "../../../../../../services/tauri/sessionManagement";
import type { SessionFolderSelection } from "./SessionFolderTree";

function normalizeFolderId(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

export function filterEntriesBySelection(
  entries: WorkspaceSessionCatalogEntry[],
  selection: SessionFolderSelection,
  knownFolderIds: ReadonlySet<string>,
): WorkspaceSessionCatalogEntry[] {
  if (selection.kind === "unfiled") {
    return entries.filter((entry) => {
      const folderId = normalizeFolderId(entry.folderId);
      return !folderId || !knownFolderIds.has(folderId);
    });
  }
  return entries.filter(
    (entry) => normalizeFolderId(entry.folderId) === selection.folderId,
  );
}
