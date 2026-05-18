import { describe, expect, it } from "vitest";
import type {
  WorkspaceSessionCatalogEntry,
  WorkspaceSessionFolder,
} from "../../../../../../services/tauri/sessionManagement";
import { buildSessionFolderProjection } from "./folderProjection";

function makeFolder(
  id: string,
  name: string,
  parentId?: string | null,
): WorkspaceSessionFolder {
  return {
    id,
    workspaceId: "ws",
    parentId: parentId ?? null,
    name,
    createdAt: 1,
    updatedAt: 1,
  };
}

function makeEntry(
  sessionId: string,
  folderId: string | null,
  updatedAt: number,
): WorkspaceSessionCatalogEntry {
  return {
    sessionId,
    workspaceId: "ws",
    engine: "codex",
    title: sessionId,
    updatedAt,
    threadKind: "session",
    folderId,
  };
}

describe("buildSessionFolderProjection", () => {
  it("returns an empty projection when there are no folders and no entries", () => {
    const projection = buildSessionFolderProjection({
      folders: [],
      entries: [],
    });
    expect(projection.unfiledEntryCount).toBe(0);
    expect(projection.unfiledLatestUpdatedAt).toBeNull();
    expect(projection.rootFolders).toEqual([]);
  });

  it("counts entries with null folderId as unfiled and tracks the latest updatedAt", () => {
    const projection = buildSessionFolderProjection({
      folders: [],
      entries: [makeEntry("s1", null, 100), makeEntry("s2", null, 200)],
    });
    expect(projection.unfiledEntryCount).toBe(2);
    expect(projection.unfiledLatestUpdatedAt).toBe(200);
  });

  it("treats entries pointing at a missing folder as unfiled rather than dropping them", () => {
    const projection = buildSessionFolderProjection({
      folders: [],
      entries: [makeEntry("s1", "ghost", 50)],
    });
    expect(projection.unfiledEntryCount).toBe(1);
    expect(projection.unfiledLatestUpdatedAt).toBe(50);
  });

  it("aggregates direct counts and latest updatedAt per folder", () => {
    const folders = [makeFolder("a", "Alpha"), makeFolder("b", "Beta")];
    const entries = [
      makeEntry("s1", "a", 10),
      makeEntry("s2", "a", 30),
      makeEntry("s3", "b", 20),
    ];
    const projection = buildSessionFolderProjection({ folders, entries });
    expect(projection.unfiledEntryCount).toBe(0);
    const alpha = projection.folderById.get("a");
    expect(alpha?.directEntryCount).toBe(2);
    expect(alpha?.directLatestUpdatedAt).toBe(30);
    const beta = projection.folderById.get("b");
    expect(beta?.directEntryCount).toBe(1);
    expect(beta?.directLatestUpdatedAt).toBe(20);
  });

  it("nests child folders under parents and rolls up totals", () => {
    const folders = [
      makeFolder("root", "Root"),
      makeFolder("child", "Child", "root"),
    ];
    const entries = [
      makeEntry("s1", "root", 5),
      makeEntry("s2", "child", 15),
    ];
    const projection = buildSessionFolderProjection({ folders, entries });
    expect(projection.rootFolders).toHaveLength(1);
    const root = projection.rootFolders[0];
    expect(root.folder.id).toBe("root");
    expect(root.children).toHaveLength(1);
    expect(root.children[0].folder.id).toBe("child");
    expect(root.directEntryCount).toBe(1);
    expect(root.directLatestUpdatedAt).toBe(5);
    expect(root.totalEntryCount).toBe(2);
    expect(root.totalLatestUpdatedAt).toBe(15);
  });

  it("breaks cycles by treating cyclically parented folders as roots", () => {
    const folders = [
      makeFolder("a", "Alpha", "b"),
      makeFolder("b", "Beta", "a"),
    ];
    const projection = buildSessionFolderProjection({
      folders,
      entries: [],
    });
    expect(projection.rootFolders.map((node) => node.folder.id).sort()).toEqual(
      ["a", "b"],
    );
  });

  it("sorts root folders by name case-insensitively then by createdAt", () => {
    const folders = [
      makeFolder("z", "zebra"),
      makeFolder("a", "Apple"),
      makeFolder("m", "mango"),
    ];
    const projection = buildSessionFolderProjection({
      folders,
      entries: [],
    });
    expect(projection.rootFolders.map((n) => n.folder.id)).toEqual([
      "a",
      "m",
      "z",
    ]);
  });

  it("preserves direct and total counts when an entry's folderId is whitespace", () => {
    const folders = [makeFolder("a", "Alpha")];
    const entries = [
      makeEntry("s1", " ", 10),
      makeEntry("s2", "a", 20),
    ];
    const projection = buildSessionFolderProjection({ folders, entries });
    expect(projection.unfiledEntryCount).toBe(1);
    expect(projection.folderById.get("a")?.directEntryCount).toBe(1);
  });
});
