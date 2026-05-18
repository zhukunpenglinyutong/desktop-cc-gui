// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as sessionManagement from "../../../../../../services/tauri/sessionManagement";
import { MoveToFolderPicker } from "./MoveToFolderPicker";

const { listWorkspaceSessionFoldersMock } = vi.hoisted(() => ({
  listWorkspaceSessionFoldersMock: vi.fn(),
}));

vi.mock("../../../../../../services/tauri/sessionManagement", async () => {
  const actual = await vi.importActual<typeof sessionManagement>(
    "../../../../../../services/tauri/sessionManagement",
  );
  return {
    ...actual,
    listWorkspaceSessionFolders: listWorkspaceSessionFoldersMock,
  };
});

beforeEach(() => {
  listWorkspaceSessionFoldersMock.mockReset();
});

describe("MoveToFolderPicker", () => {
  it("shows the empty state when no folders exist", async () => {
    listWorkspaceSessionFoldersMock.mockResolvedValue({
      workspaceId: "ws",
      folders: [],
    });
    render(
      <MoveToFolderPicker
        workspaceId="ws"
        selectedCount={2}
        onClose={vi.fn()}
        onApply={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("session-organization-move-picker-empty"),
      ).toBeTruthy(),
    );
  });

  it("renders the unfile target plus each folder as a target", async () => {
    listWorkspaceSessionFoldersMock.mockResolvedValue({
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
        {
          id: "f2",
          workspaceId: "ws",
          parentId: null,
          name: "Beta",
          createdAt: 2,
          updatedAt: 2,
        },
      ],
    });
    render(
      <MoveToFolderPicker
        workspaceId="ws"
        selectedCount={1}
        onClose={vi.fn()}
        onApply={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("session-organization-move-picker-list"),
      ).toBeTruthy(),
    );
    expect(
      screen.getByTestId("session-organization-move-picker-target-__unfile__"),
    ).toBeTruthy();
    expect(
      screen.getByTestId("session-organization-move-picker-target-f1"),
    ).toBeTruthy();
    expect(
      screen.getByTestId("session-organization-move-picker-target-f2"),
    ).toBeTruthy();
  });

  it("keeps the apply button disabled until a target is selected", async () => {
    listWorkspaceSessionFoldersMock.mockResolvedValue({
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
    });
    render(
      <MoveToFolderPicker
        workspaceId="ws"
        selectedCount={1}
        onClose={vi.fn()}
        onApply={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("session-organization-move-picker-list"),
      ).toBeTruthy(),
    );
    const apply = screen.getByTestId(
      "session-organization-move-picker-apply",
    ) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    fireEvent.click(
      screen.getByTestId("session-organization-move-picker-target-f1"),
    );
    expect(apply.disabled).toBe(false);
  });

  it("invokes onApply with the chosen folder id and exposes unfile as null", async () => {
    listWorkspaceSessionFoldersMock.mockResolvedValue({
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
    });
    const onApply = vi.fn().mockResolvedValue(undefined);
    render(
      <MoveToFolderPicker
        workspaceId="ws"
        selectedCount={1}
        onClose={vi.fn()}
        onApply={onApply}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("session-organization-move-picker-list"),
      ).toBeTruthy(),
    );

    fireEvent.click(
      screen.getByTestId("session-organization-move-picker-target-__unfile__"),
    );
    fireEvent.click(
      screen.getByTestId("session-organization-move-picker-apply"),
    );
    expect(onApply).toHaveBeenCalledWith(null);
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when cancel button is clicked", async () => {
    listWorkspaceSessionFoldersMock.mockResolvedValue({
      workspaceId: "ws",
      folders: [],
    });
    const onClose = vi.fn();
    render(
      <MoveToFolderPicker
        workspaceId="ws"
        selectedCount={1}
        onClose={onClose}
        onApply={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("session-organization-move-picker-empty"),
      ).toBeTruthy(),
    );
    fireEvent.click(
      screen.getByTestId("session-organization-move-picker-cancel"),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
