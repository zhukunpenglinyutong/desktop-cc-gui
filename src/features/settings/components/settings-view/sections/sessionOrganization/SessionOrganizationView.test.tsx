// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { WorkspaceSessionCatalogEntry } from "../../../../../../services/tauri/sessionManagement";
import * as sessionManagement from "../../../../../../services/tauri/sessionManagement";
import { SessionOrganizationView } from "./SessionOrganizationView";

const {
  listFoldersMock,
  createFolderMock,
  renameFolderMock,
  deleteFolderMock,
} = vi.hoisted(() => ({
  listFoldersMock: vi.fn(),
  createFolderMock: vi.fn(),
  renameFolderMock: vi.fn(),
  deleteFolderMock: vi.fn(),
}));

vi.mock("../../../../../../services/tauri/sessionManagement", async () => {
  const actual = await vi.importActual<typeof sessionManagement>(
    "../../../../../../services/tauri/sessionManagement",
  );
  return {
    ...actual,
    listWorkspaceSessionFolders: listFoldersMock,
    createWorkspaceSessionFolder: createFolderMock,
    renameWorkspaceSessionFolder: renameFolderMock,
    deleteWorkspaceSessionFolder: deleteFolderMock,
  };
});

function makeEntry(
  sessionId: string,
  folderId: string | null,
): WorkspaceSessionCatalogEntry {
  return {
    sessionId,
    workspaceId: "ws",
    engine: "codex",
    title: `session-${sessionId}`,
    updatedAt: 1700000000000,
    threadKind: "main",
    folderId,
  };
}

beforeEach(() => {
  listFoldersMock.mockReset();
  createFolderMock.mockReset();
  renameFolderMock.mockReset();
  deleteFolderMock.mockReset();
});

describe("SessionOrganizationView integration journey", () => {
  it("creates a folder from the tree and reloads to display it", async () => {
    // first load: empty; reload after create: returns the new folder
    listFoldersMock
      .mockResolvedValueOnce({ workspaceId: "ws", folders: [] })
      .mockResolvedValueOnce({
        workspaceId: "ws",
        folders: [
          {
            id: "f1",
            workspaceId: "ws",
            parentId: null,
            name: "Research",
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      });
    createFolderMock.mockResolvedValue({
      folder: {
        id: "f1",
        workspaceId: "ws",
        parentId: null,
        name: "Research",
        createdAt: 1,
        updatedAt: 1,
      },
    });

    render(
      <SessionOrganizationView
        workspaceId="ws"
        entries={[makeEntry("s1", null)]}
        selectedIds={{}}
        onToggleSelection={vi.fn()}
        locale="en"
      />,
    );

    await waitFor(() => expect(listFoldersMock).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("session-organization-tree-unfiled")).toBeTruthy();
    expect(
      screen.queryByTestId("session-organization-tree-folder-f1"),
    ).toBeNull();

    fireEvent.click(screen.getByTestId("session-organization-tree-add-root"));
    const input = await screen.findByTestId(
      "session-organization-tree-editor-input",
    );
    fireEvent.change(input, { target: { value: "Research" } });
    await act(async () => {
      fireEvent.click(
        screen.getByTestId("session-organization-tree-editor-save"),
      );
    });

    expect(createFolderMock).toHaveBeenCalledWith("ws", "Research", null);
    await waitFor(() =>
      expect(
        screen.getByTestId("session-organization-tree-folder-f1"),
      ).toBeTruthy(),
    );
  });

  it("renames a folder via the tree and reflects the new name", async () => {
    listFoldersMock
      .mockResolvedValueOnce({
        workspaceId: "ws",
        folders: [
          {
            id: "f1",
            workspaceId: "ws",
            parentId: null,
            name: "Alpha",
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      })
      .mockResolvedValueOnce({
        workspaceId: "ws",
        folders: [
          {
            id: "f1",
            workspaceId: "ws",
            parentId: null,
            name: "Beta",
            createdAt: 1,
            updatedAt: 2,
          },
        ],
      });
    renameFolderMock.mockResolvedValue({
      folder: {
        id: "f1",
        workspaceId: "ws",
        parentId: null,
        name: "Beta",
        createdAt: 1,
        updatedAt: 2,
      },
    });

    render(
      <SessionOrganizationView
        workspaceId="ws"
        entries={[]}
        selectedIds={{}}
        onToggleSelection={vi.fn()}
        locale="en"
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByTestId("session-organization-tree-folder-f1"),
      ).toBeTruthy(),
    );

    fireEvent.click(
      screen.getByTestId("session-organization-tree-folder-f1"),
    );
    fireEvent.click(
      screen.getByTestId("session-organization-tree-rename-selected"),
    );
    const input = await screen.findByTestId(
      "session-organization-tree-editor-input",
    );
    fireEvent.change(input, { target: { value: "Beta" } });
    await act(async () => {
      fireEvent.click(
        screen.getByTestId("session-organization-tree-editor-save"),
      );
    });

    expect(renameFolderMock).toHaveBeenCalledWith("ws", "f1", "Beta");
    await waitFor(() =>
      expect(
        screen.getByTestId("session-organization-tree-folder-f1").textContent,
      ).toContain("Beta"),
    );
  });

  it("deletes an empty folder after confirming in the dialog", async () => {
    listFoldersMock
      .mockResolvedValueOnce({
        workspaceId: "ws",
        folders: [
          {
            id: "f1",
            workspaceId: "ws",
            parentId: null,
            name: "Empty",
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      })
      .mockResolvedValueOnce({ workspaceId: "ws", folders: [] });
    deleteFolderMock.mockResolvedValue(undefined);

    render(
      <SessionOrganizationView
        workspaceId="ws"
        entries={[]}
        selectedIds={{}}
        onToggleSelection={vi.fn()}
        locale="en"
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByTestId("session-organization-tree-folder-f1"),
      ).toBeTruthy(),
    );

    fireEvent.click(
      screen.getByTestId("session-organization-tree-folder-f1"),
    );
    fireEvent.click(
      screen.getByTestId("session-organization-tree-delete-selected"),
    );
    expect(deleteFolderMock).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(
        screen.getByTestId("session-organization-tree-delete-dialog-confirm"),
      );
    });
    expect(deleteFolderMock).toHaveBeenCalledWith("ws", "f1");
    await waitFor(() =>
      expect(
        screen.queryByTestId("session-organization-tree-folder-f1"),
      ).toBeNull(),
    );
  });
});
