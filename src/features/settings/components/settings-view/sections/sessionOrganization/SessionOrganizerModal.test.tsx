// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as sessionManagement from "../../../../../../services/tauri/sessionManagement";
import { SessionOrganizerModal } from "./SessionOrganizerModal";

const { listFoldersMock } = vi.hoisted(() => ({
  listFoldersMock: vi.fn(),
}));

vi.mock("../../../../../../services/tauri/sessionManagement", async () => {
  const actual = await vi.importActual<typeof sessionManagement>(
    "../../../../../../services/tauri/sessionManagement",
  );
  return {
    ...actual,
    listWorkspaceSessionFolders: listFoldersMock,
  };
});

beforeEach(() => {
  listFoldersMock.mockReset();
  listFoldersMock.mockResolvedValue({ workspaceId: "ws", folders: [] });
});

function renderModal(
  overrides: Partial<React.ComponentProps<typeof SessionOrganizerModal>> = {},
) {
  const props: React.ComponentProps<typeof SessionOrganizerModal> = {
    workspaceId: "ws",
    workspaceLabel: "My Workspace",
    entries: [
      {
        sessionId: "s1",
        workspaceId: "ws",
        engine: "codex",
        title: "session-1",
        updatedAt: 1700000000000,
        threadKind: "main",
        folderId: null,
      },
    ],
    selectedIds: {},
    selectedCount: 0,
    deleteArmed: false,
    isMutating: false,
    isMovingToFolder: false,
    locale: "en",
    onClose: vi.fn(),
    onToggleSelection: vi.fn(),
    onSelectAll: vi.fn(),
    onClearSelection: vi.fn(),
    onArchive: vi.fn(),
    onUnarchive: vi.fn(),
    onDelete: vi.fn(),
    onOpenMovePicker: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<SessionOrganizerModal {...props} />) };
}

describe("SessionOrganizerModal", () => {
  it("renders the title element when opened", async () => {
    renderModal({ workspaceLabel: "Galaxy / Project Foo" });
    await waitFor(() =>
      expect(screen.getByTestId("session-organizer-modal-title")).toBeTruthy(),
    );
  });

  it("fires onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    fireEvent.click(screen.getByTestId("session-organizer-modal-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("fires onClose when the backdrop is clicked outside the dialog", () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    fireEvent.click(screen.getByTestId("session-organizer-modal-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("disables close-via-backdrop / button while a mutation is in flight", () => {
    const onClose = vi.fn();
    renderModal({ onClose, isMutating: true });
    fireEvent.click(screen.getByTestId("session-organizer-modal-backdrop"));
    fireEvent.click(screen.getByTestId("session-organizer-modal-close"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps batch buttons disabled when nothing is selected", () => {
    renderModal({ selectedCount: 0 });
    const move = screen.getByTestId(
      "session-organizer-modal-move",
    ) as HTMLButtonElement;
    const archive = screen.getByTestId(
      "session-organizer-modal-archive",
    ) as HTMLButtonElement;
    const unarchive = screen.getByTestId(
      "session-organizer-modal-unarchive",
    ) as HTMLButtonElement;
    const del = screen.getByTestId(
      "session-organizer-modal-delete",
    ) as HTMLButtonElement;
    expect(move.disabled).toBe(true);
    expect(archive.disabled).toBe(true);
    expect(unarchive.disabled).toBe(true);
    expect(del.disabled).toBe(true);
  });

  it("fires the correct callback for each batch action when selection is non-empty", () => {
    const onOpenMovePicker = vi.fn();
    const onArchive = vi.fn();
    const onUnarchive = vi.fn();
    const onDelete = vi.fn();
    renderModal({
      selectedCount: 2,
      selectedIds: { "ws::s1": true, "ws::s2": true },
      onOpenMovePicker,
      onArchive,
      onUnarchive,
      onDelete,
    });
    fireEvent.click(screen.getByTestId("session-organizer-modal-move"));
    fireEvent.click(screen.getByTestId("session-organizer-modal-archive"));
    fireEvent.click(screen.getByTestId("session-organizer-modal-unarchive"));
    fireEvent.click(screen.getByTestId("session-organizer-modal-delete"));
    expect(onOpenMovePicker).toHaveBeenCalledTimes(1);
    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(onUnarchive).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("keeps the delete button enabled when armed with selection", () => {
    renderModal({ selectedCount: 3, deleteArmed: true });
    const del = screen.getByTestId(
      "session-organizer-modal-delete",
    ) as HTMLButtonElement;
    expect(del.disabled).toBe(false);
  });

  it("renders the footer selection count slot", () => {
    renderModal({ selectedCount: 4 });
    expect(
      screen.getByTestId("session-organizer-modal-selected-count"),
    ).toBeTruthy();
  });

  it("fires onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
