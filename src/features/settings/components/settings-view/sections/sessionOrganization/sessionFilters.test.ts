import { describe, expect, it } from "vitest";
import type { WorkspaceSessionCatalogEntry } from "../../../../../../services/tauri/sessionManagement";
import { filterEntriesBySelection } from "./sessionFilters";

function makeEntry(
  sessionId: string,
  folderId: string | null,
  updatedAt = 0,
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

describe("filterEntriesBySelection", () => {
  it("returns only entries with no folderId when selection is unfiled", () => {
    const entries = [
      makeEntry("a", null),
      makeEntry("b", "folder-1"),
      makeEntry("c", null),
    ];
    const result = filterEntriesBySelection(
      entries,
      { kind: "unfiled" },
      new Set(["folder-1"]),
    );
    expect(result.map((e) => e.sessionId)).toEqual(["a", "c"]);
  });

  it("treats entries with folderId pointing at an unknown folder as unfiled", () => {
    const entries = [
      makeEntry("a", "ghost"),
      makeEntry("b", "folder-1"),
      makeEntry("c", null),
    ];
    const result = filterEntriesBySelection(
      entries,
      { kind: "unfiled" },
      new Set(["folder-1"]),
    );
    expect(result.map((e) => e.sessionId).sort()).toEqual(["a", "c"]);
  });

  it("treats whitespace-only folderId as unfiled", () => {
    const entries = [
      makeEntry("a", "   "),
      makeEntry("b", "folder-1"),
    ];
    const result = filterEntriesBySelection(
      entries,
      { kind: "unfiled" },
      new Set(["folder-1"]),
    );
    expect(result.map((e) => e.sessionId)).toEqual(["a"]);
  });

  it("returns only entries assigned to the selected folder", () => {
    const entries = [
      makeEntry("a", "folder-1"),
      makeEntry("b", "folder-2"),
      makeEntry("c", "folder-1"),
      makeEntry("d", null),
    ];
    const result = filterEntriesBySelection(
      entries,
      { kind: "folder", folderId: "folder-1" },
      new Set(["folder-1", "folder-2"]),
    );
    expect(result.map((e) => e.sessionId)).toEqual(["a", "c"]);
  });

  it("returns an empty array when no entry matches the selected folder", () => {
    const entries = [makeEntry("a", "folder-1")];
    const result = filterEntriesBySelection(
      entries,
      { kind: "folder", folderId: "folder-99" },
      new Set(["folder-1", "folder-99"]),
    );
    expect(result).toEqual([]);
  });
});
