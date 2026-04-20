// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectSucceededWorkspaceIds,
  SessionManagementSection,
} from "./SessionManagementSection";
import type { WorkspaceInfo } from "../../../../../types";
import {
  archiveWorkspaceSessions,
  deleteWorkspaceSessions,
  getWorkspaceSessionProjectionSummary,
  listGlobalCodexSessions,
  listProjectRelatedCodexSessions,
  listWorkspaceSessions,
} from "../../../../../services/tauri";

vi.mock("../../../../../services/tauri", () => ({
  getWorkspaceSessionProjectionSummary: vi.fn(),
  listGlobalCodexSessions: vi.fn(),
  listProjectRelatedCodexSessions: vi.fn(),
  listWorkspaceSessions: vi.fn(),
  archiveWorkspaceSessions: vi.fn(),
  unarchiveWorkspaceSessions: vi.fn(),
  deleteWorkspaceSessions: vi.fn(),
}));

const workspace: WorkspaceInfo = {
  id: "ws-1",
  name: "Workspace",
  path: "/tmp/workspace",
  connected: true,
  settings: { sidebarCollapsed: false },
};

const worktree: WorkspaceInfo = {
  id: "ws-2",
  name: "Workspace Worktree",
  path: "/tmp/worktree",
  connected: true,
  kind: "worktree",
  parentId: "ws-1",
  settings: { sidebarCollapsed: false },
};

function getEnabledButtonByName(name: string) {
  const button = screen
    .getAllByRole("button", { name })
    .find((candidate) => !(candidate as HTMLButtonElement).disabled);
  expect(button).toBeTruthy();
  return button as HTMLButtonElement;
}

function clickFirstEnabledButtonByName(name: string) {
  fireEvent.click(getEnabledButtonByName(name));
}

function getEnabledButtonByTestId(testId: string) {
  const button = screen
    .getAllByTestId(testId)
    .find((candidate) => !(candidate as HTMLButtonElement).disabled);
  expect(button).toBeTruthy();
  return button as HTMLButtonElement;
}

function getCheckboxByName(name: string) {
  const checkbox = screen.getAllByRole("checkbox", { name })[0];
  expect(checkbox).toBeTruthy();
  return checkbox as HTMLInputElement;
}

describe("SessionManagementSection", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getWorkspaceSessionProjectionSummary).mockResolvedValue({
      scopeKind: "project",
      ownerWorkspaceIds: ["ws-1", "ws-2"],
      activeTotal: 0,
      archivedTotal: 0,
      allTotal: 0,
      filteredTotal: 0,
      partialSources: [],
    });
    vi.mocked(listWorkspaceSessions).mockResolvedValue({
      data: [],
      nextCursor: null,
      partialSource: null,
    });
    vi.mocked(listGlobalCodexSessions).mockResolvedValue({
      data: [],
      nextCursor: null,
      partialSource: null,
    });
    vi.mocked(listProjectRelatedCodexSessions).mockResolvedValue({
      data: [],
      nextCursor: null,
      partialSource: null,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders owner workspace label for aggregated project entries", async () => {
    vi.mocked(getWorkspaceSessionProjectionSummary).mockResolvedValue({
      scopeKind: "project",
      ownerWorkspaceIds: ["ws-1", "ws-2"],
      activeTotal: 2,
      archivedTotal: 0,
      allTotal: 2,
      filteredTotal: 2,
      partialSources: [],
    });
    vi.mocked(listWorkspaceSessions).mockResolvedValue({
      data: [
        {
          sessionId: "codex:main",
          workspaceId: "ws-1",
          title: "Main session",
          updatedAt: 1710000000000,
          engine: "codex",
          archivedAt: null,
          threadKind: "native",
          sourceLabel: "cli/codex",
        },
        {
          sessionId: "codex:worktree",
          workspaceId: "ws-2",
          title: "Worktree session",
          updatedAt: 1710000000001,
          engine: "codex",
          archivedAt: null,
          threadKind: "native",
          sourceLabel: "cli/codex",
        },
      ],
      nextCursor: null,
      partialSource: null,
    });

    render(
      <SessionManagementSection
        title="Session Management"
        description="Manage sessions"
        workspaces={[workspace, worktree]}
        groupedWorkspaces={[{ id: null, name: "Ungrouped", workspaces: [workspace, worktree] }]}
        initialWorkspaceId="ws-1"
      />,
    );

    expect(await screen.findByText("Ungrouped / Workspace")).toBeTruthy();
    expect(
      await screen.findByText(
        "Ungrouped / settings.sessionManagementScopeTagWorktree Workspace Worktree",
      ),
    ).toBeTruthy();
    expect(await screen.findAllByText("cli/codex")).toHaveLength(2);
    expect(await screen.findByText("settings.sessionManagementFilteredTotalCount")).toBeTruthy();
    expect(await screen.findByText("settings.sessionManagementCurrentPageCount")).toBeTruthy();
  });

  it("marks root workspace picker entries as project scope", async () => {
    render(
      <SessionManagementSection
        title="Session Management"
        description="Manage sessions"
        workspaces={[workspace, worktree]}
        groupedWorkspaces={[{ id: null, name: "Ungrouped", workspaces: [workspace, worktree] }]}
        initialWorkspaceId="ws-1"
      />,
    );

    const trigger = getEnabledButtonByTestId("settings-project-sessions-workspace-picker-trigger");
    expect(trigger.textContent).toContain(
      "Ungrouped / settings.sessionManagementScopeTagProject Workspace",
    );

    fireEvent.click(trigger);

    expect(
      await screen.findByRole("option", {
        name: "Ungrouped / settings.sessionManagementScopeTagProject Workspace",
      }),
    ).toBeTruthy();
    expect(
      await screen.findByRole("option", {
        name: "Ungrouped / settings.sessionManagementScopeTagWorktree Workspace Worktree",
      }),
    ).toBeTruthy();
  });

  it("explains filtered total versus current page window for project scope", async () => {
    vi.mocked(getWorkspaceSessionProjectionSummary).mockResolvedValue({
      scopeKind: "project",
      ownerWorkspaceIds: ["ws-1", "ws-2"],
      activeTotal: 23,
      archivedTotal: 4,
      allTotal: 27,
      filteredTotal: 23,
      partialSources: ["codex-history-unavailable"],
    });
    vi.mocked(listWorkspaceSessions).mockResolvedValue({
      data: Array.from({ length: 3 }, (_, index) => ({
        sessionId: `codex:${index}`,
        workspaceId: "ws-1",
        title: `Session ${index}`,
        updatedAt: 1710000000000 + index,
        engine: "codex",
        archivedAt: null,
        threadKind: "native",
      })),
      nextCursor: "offset:3",
      partialSource: null,
    });

    render(
      <SessionManagementSection
        title="Session Management"
        description="Manage sessions"
        workspaces={[workspace, worktree]}
        groupedWorkspaces={[{ id: null, name: "Ungrouped", workspaces: [workspace, worktree] }]}
        initialWorkspaceId="ws-1"
      />,
    );

    expect(await screen.findAllByText("settings.sessionManagementFilteredTotalCount")).not.toHaveLength(0);
    expect(await screen.findAllByText("settings.sessionManagementCurrentPageCount")).not.toHaveLength(0);
    expect(await screen.findByText("settings.sessionManagementVisibleWindowHint")).toBeTruthy();
    expect(await screen.findByText("settings.sessionManagementActiveProjectionScopeHint")).toBeTruthy();
    expect(await screen.findByText("settings.sessionManagementPartialSource")).toBeTruthy();
  });

  it("switches to global archive mode and renders unassigned history label", async () => {
    vi.mocked(listWorkspaceSessions).mockResolvedValueOnce({
      data: [],
      nextCursor: null,
      partialSource: null,
    });
    vi.mocked(listGlobalCodexSessions).mockResolvedValueOnce({
      data: [
        {
          sessionId: "codex:global",
          workspaceId: "__global_unassigned__",
          title: "Detached session",
          updatedAt: 1710000000000,
          engine: "codex",
          archivedAt: null,
          threadKind: "native",
          sourceLabel: "cli/openai",
        },
      ],
      nextCursor: null,
      partialSource: null,
    });

    render(
      <SessionManagementSection
        title="Session Management"
        description="Manage sessions"
        workspaces={[workspace]}
        groupedWorkspaces={[{ id: null, name: "Ungrouped", workspaces: [workspace] }]}
        initialWorkspaceId="ws-1"
      />,
    );

    clickFirstEnabledButtonByName("settings.sessionManagementModeGlobal");

    expect(await screen.findByText("settings.sessionManagementWorkspaceUnassigned")).toBeTruthy();
    expect(listGlobalCodexSessions).toHaveBeenCalled();
  });

  it("renders missing timestamps as an unknown marker", async () => {
    vi.mocked(listGlobalCodexSessions).mockResolvedValueOnce({
      data: [
        {
          sessionId: "codex:global",
          workspaceId: "__global_unassigned__",
          title: "Missing timestamp session",
          updatedAt: 0,
          engine: "codex",
          archivedAt: null,
          threadKind: "native",
        },
      ],
      nextCursor: null,
      partialSource: null,
    });

    render(
      <SessionManagementSection
        title="Session Management"
        description="Manage sessions"
        workspaces={[workspace]}
        groupedWorkspaces={[{ id: null, name: "Ungrouped", workspaces: [workspace] }]}
        initialWorkspaceId="ws-1"
      />,
    );

    clickFirstEnabledButtonByName("settings.sessionManagementModeGlobal");

    expect(await screen.findByText("Missing timestamp session")).toBeTruthy();
    expect(await screen.findByText("--")).toBeTruthy();
  });

  it("keeps refresh available in global mode even when no workspace is selected", async () => {
    vi.mocked(listGlobalCodexSessions).mockResolvedValueOnce({
      data: [],
      nextCursor: null,
      partialSource: null,
    });

    render(
      <SessionManagementSection
        title="Session Management"
        description="Manage sessions"
        workspaces={[]}
        groupedWorkspaces={[]}
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "settings.sessionManagementModeGlobal" }),
    );

    await waitFor(() => {
      expect(
        (
          screen.getByRole("button", {
            name: "settings.projectSessionRefresh",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false);
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "settings.projectSessionRefresh",
      }),
    );

    await waitFor(() => {
      expect(listGlobalCodexSessions).toHaveBeenCalledTimes(2);
    });
  });

  it("reloads the projection summary when project scope is refreshed", async () => {
    render(
      <SessionManagementSection
        title="Session Management"
        description="Manage sessions"
        workspaces={[workspace]}
        groupedWorkspaces={[{ id: null, name: "Ungrouped", workspaces: [workspace] }]}
        initialWorkspaceId="ws-1"
      />,
    );

    await waitFor(() => {
      expect(getWorkspaceSessionProjectionSummary).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(
      await screen.findByRole("button", {
        name: "settings.projectSessionRefresh",
      }),
    );

    await waitFor(() => {
      expect(getWorkspaceSessionProjectionSummary).toHaveBeenCalledTimes(2);
    });
  });

  it("explains strict empty state before redirecting users to the global archive", async () => {
    vi.mocked(listWorkspaceSessions).mockResolvedValueOnce({
      data: [],
      nextCursor: null,
      partialSource: null,
    });

    render(
      <SessionManagementSection
        title="Session Management"
        description="Manage sessions"
        workspaces={[workspace]}
        groupedWorkspaces={[{ id: null, name: "Ungrouped", workspaces: [workspace] }]}
        initialWorkspaceId="ws-1"
      />,
    );

    expect(
      await screen.findByText("settings.sessionManagementProjectEmptyStrictHint"),
    ).toBeTruthy();
    expect(
      await screen.findByRole("button", { name: "settings.sessionManagementViewGlobalCta" }),
    ).toBeTruthy();
  });

  it("collects unique owner workspaces from successful mutation results", () => {
    expect(
      collectSucceededWorkspaceIds([
        {
          selectionKey: "ws-1::codex:1",
          sessionId: "codex:1",
          workspaceId: "ws-1",
          ok: true,
        },
        {
          selectionKey: "ws-2::codex:2",
          sessionId: "codex:2",
          workspaceId: "ws-2",
          ok: true,
        },
        {
          selectionKey: "ws-1::codex:3",
          sessionId: "codex:3",
          workspaceId: "ws-1",
          ok: true,
        },
        {
          selectionKey: "ws-3::codex:4",
          sessionId: "codex:4",
          workspaceId: "ws-3",
          ok: false,
          error: "failed",
          code: "DELETE_FAILED",
        },
      ]),
    ).toEqual(["ws-1", "ws-2"]);
  });

  it("renders related sessions in a dedicated inferred surface", async () => {
    vi.mocked(listWorkspaceSessions).mockResolvedValueOnce({
      data: [],
      nextCursor: null,
      partialSource: null,
    });
    vi.mocked(listProjectRelatedCodexSessions).mockResolvedValueOnce({
      data: [
        {
          sessionId: "codex:related",
          workspaceId: "ws-2",
          matchedWorkspaceId: "ws-1",
          matchedWorkspaceLabel: "Workspace",
          attributionStatus: "inferred-related",
          attributionReason: "shared-worktree-family",
          attributionConfidence: "high",
          title: "Sibling worktree session",
          updatedAt: 1710000000002,
          engine: "codex",
          archivedAt: null,
          threadKind: "native",
          sourceLabel: "cli/codex",
        },
      ],
      nextCursor: null,
      partialSource: null,
    });

    render(
      <SessionManagementSection
        title="Session Management"
        description="Manage sessions"
        workspaces={[workspace, worktree]}
        groupedWorkspaces={[{ id: null, name: "Ungrouped", workspaces: [workspace, worktree] }]}
        initialWorkspaceId="ws-1"
      />,
    );

    expect(await screen.findByText("settings.projectSessionEmpty")).toBeTruthy();
    expect(
      await screen.findByText("settings.sessionManagementProjectEmptyStrictHint"),
    ).toBeTruthy();
    expect(await screen.findByText("settings.sessionManagementRelatedSectionTitle")).toBeTruthy();
    expect(await screen.findByText("Sibling worktree session")).toBeTruthy();
    expect(await screen.findByText("settings.sessionManagementBadgeRelated")).toBeTruthy();
    expect(
      await screen.findByText("settings.sessionManagementAttributionReasonWorktreeFamily"),
    ).toBeTruthy();
  });

  it("explains that project mode aggregates child worktrees", async () => {
    vi.mocked(listWorkspaceSessions).mockResolvedValueOnce({
      data: [
        {
          sessionId: "codex:main",
          workspaceId: "ws-1",
          title: "Main session",
          updatedAt: 1710000000000,
          engine: "codex",
          archivedAt: null,
          threadKind: "native",
        },
      ],
      nextCursor: null,
      partialSource: null,
    });

    render(
      <SessionManagementSection
        title="Session Management"
        description="Manage sessions"
        workspaces={[workspace, worktree]}
        groupedWorkspaces={[{ id: null, name: "Ungrouped", workspaces: [workspace, worktree] }]}
        initialWorkspaceId="ws-1"
      />,
    );

    expect(await screen.findByText("settings.sessionManagementProjectScopeHint")).toBeTruthy();
  });

  it("reloads related sessions after a successful related delete", async () => {
    vi.mocked(listWorkspaceSessions).mockResolvedValue({
      data: [],
      nextCursor: null,
      partialSource: null,
    });
    vi.mocked(listProjectRelatedCodexSessions)
      .mockResolvedValueOnce({
        data: [
          {
            sessionId: "codex:related",
            workspaceId: "ws-2",
            matchedWorkspaceId: "ws-1",
            matchedWorkspaceLabel: "Workspace",
            attributionStatus: "inferred-related",
            attributionReason: "shared-worktree-family",
            attributionConfidence: "high",
            title: "Sibling worktree session",
            updatedAt: 1710000000002,
            engine: "codex",
            archivedAt: null,
            threadKind: "native",
            sourceLabel: "cli/codex",
          },
        ],
        nextCursor: null,
        partialSource: null,
      })
      .mockResolvedValueOnce({
        data: [],
        nextCursor: null,
        partialSource: null,
      });
    vi.mocked(deleteWorkspaceSessions).mockResolvedValue({
      results: [{ sessionId: "codex:related", ok: true }],
    });

    render(
      <SessionManagementSection
        title="Session Management"
        description="Manage sessions"
        workspaces={[workspace, worktree]}
        groupedWorkspaces={[{ id: null, name: "Ungrouped", workspaces: [workspace, worktree] }]}
        initialWorkspaceId="ws-1"
      />,
    );

    fireEvent.click(await screen.findByRole("checkbox", { name: "Sibling worktree session" }));
    fireEvent.click(getEnabledButtonByTestId("settings-project-sessions-delete-selected"));
    fireEvent.click(getEnabledButtonByTestId("settings-project-sessions-delete-selected"));

    await waitFor(() => {
      expect(deleteWorkspaceSessions).toHaveBeenCalledWith("ws-2", ["codex:related"]);
    });
    await waitFor(() => {
      expect(listProjectRelatedCodexSessions).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.queryByRole("checkbox", { name: "Sibling worktree session" })).toBeNull();
    });
  });

  it("keeps failed sessions selected after partial archive failure", async () => {
    vi.mocked(listWorkspaceSessions)
      .mockResolvedValueOnce({
        data: [
          {
            sessionId: "codex:ok",
            workspaceId: "ws-1",
            title: "Ok session",
            updatedAt: 1710000000000,
            engine: "codex",
            archivedAt: null,
            threadKind: "native",
            sourceLabel: "cli/codex",
          },
          {
            sessionId: "codex:failed",
            workspaceId: "ws-1",
            title: "Failed session",
            updatedAt: 1710000000001,
            engine: "codex",
            archivedAt: null,
            threadKind: "native",
            sourceLabel: "cli/codex",
          },
        ],
        nextCursor: null,
        partialSource: null,
      })
      .mockResolvedValueOnce({
        data: [
          {
            sessionId: "codex:failed",
            workspaceId: "ws-1",
            title: "Failed session",
            updatedAt: 1710000000001,
            engine: "codex",
            archivedAt: null,
            threadKind: "native",
            sourceLabel: "cli/codex",
          },
        ],
        nextCursor: null,
        partialSource: null,
      });
    vi.mocked(archiveWorkspaceSessions).mockResolvedValue({
      results: [
        { sessionId: "codex:ok", ok: true, archivedAt: 1710000000999 },
        {
          sessionId: "codex:failed",
          ok: false,
          error: "archive failed",
          code: "DELETE_FAILED",
        },
      ],
    });

    render(
      <SessionManagementSection
        title="Session Management"
        description="Manage sessions"
        workspaces={[workspace]}
        groupedWorkspaces={[{ id: null, name: "Ungrouped", workspaces: [workspace] }]}
        initialWorkspaceId="ws-1"
      />,
    );

    fireEvent.click(await screen.findByRole("checkbox", { name: "Ok session" }));
    fireEvent.click(getCheckboxByName("Failed session"));
    fireEvent.click(getEnabledButtonByName("settings.sessionManagementArchiveSelected"));

    await waitFor(() => {
      expect(archiveWorkspaceSessions).toHaveBeenCalledWith("ws-1", [
        "codex:ok",
        "codex:failed",
      ]);
    });

    await waitFor(() => {
      expect(screen.queryByRole("checkbox", { name: "Ok session" })).toBeNull();
    });

    expect(
      getCheckboxByName("Failed session").checked,
    ).toBe(true);
  });

  it("groups delete requests by entry owner workspace", async () => {
    vi.mocked(listWorkspaceSessions).mockResolvedValueOnce({
      data: [
        {
          sessionId: "codex:main",
          workspaceId: "ws-1",
          title: "Main session",
          updatedAt: 1710000000000,
          engine: "codex",
          archivedAt: null,
          threadKind: "native",
        },
        {
          sessionId: "codex:worktree",
          workspaceId: "ws-2",
          title: "Worktree session",
          updatedAt: 1710000000001,
          engine: "codex",
          archivedAt: null,
          threadKind: "native",
        },
      ],
      nextCursor: null,
      partialSource: null,
    });
    vi.mocked(deleteWorkspaceSessions)
      .mockResolvedValueOnce({
        results: [{ sessionId: "codex:main", ok: true }],
      })
      .mockResolvedValueOnce({
        results: [{ sessionId: "codex:worktree", ok: true }],
      });

    render(
      <SessionManagementSection
        title="Session Management"
        description="Manage sessions"
        workspaces={[workspace, worktree]}
        groupedWorkspaces={[{ id: null, name: "Ungrouped", workspaces: [workspace, worktree] }]}
        initialWorkspaceId="ws-1"
      />,
    );

    fireEvent.click(await screen.findByRole("checkbox", { name: "Main session" }));
    fireEvent.click(getCheckboxByName("Worktree session"));
    fireEvent.click(getEnabledButtonByTestId("settings-project-sessions-delete-selected"));
    fireEvent.click(getEnabledButtonByTestId("settings-project-sessions-delete-selected"));

    await waitFor(() => {
      expect(deleteWorkspaceSessions).toHaveBeenNthCalledWith(1, "ws-1", ["codex:main"]);
      expect(deleteWorkspaceSessions).toHaveBeenNthCalledWith(2, "ws-2", ["codex:worktree"]);
    });
  });

  it("notifies every succeeded owner workspace after a cross-workspace delete", async () => {
    const onSessionsMutated = vi.fn();
    vi.mocked(listWorkspaceSessions).mockResolvedValueOnce({
      data: [
        {
          sessionId: "codex:main",
          workspaceId: "ws-1",
          title: "Main session",
          updatedAt: 1710000000000,
          engine: "codex",
          archivedAt: null,
          threadKind: "native",
        },
        {
          sessionId: "codex:worktree",
          workspaceId: "ws-2",
          title: "Worktree session",
          updatedAt: 1710000000001,
          engine: "codex",
          archivedAt: null,
          threadKind: "native",
        },
      ],
      nextCursor: null,
      partialSource: null,
    });
    vi.mocked(deleteWorkspaceSessions)
      .mockResolvedValueOnce({
        results: [{ sessionId: "codex:main", ok: true }],
      })
      .mockResolvedValueOnce({
        results: [{ sessionId: "codex:worktree", ok: true }],
      });

    render(
      <SessionManagementSection
        title="Session Management"
        description="Manage sessions"
        workspaces={[workspace, worktree]}
        groupedWorkspaces={[{ id: null, name: "Ungrouped", workspaces: [workspace, worktree] }]}
        initialWorkspaceId="ws-1"
        onSessionsMutated={onSessionsMutated}
      />,
    );

    fireEvent.click(await screen.findByRole("checkbox", { name: "Main session" }));
    fireEvent.click(getCheckboxByName("Worktree session"));
    fireEvent.click(getEnabledButtonByTestId("settings-project-sessions-delete-selected"));
    fireEvent.click(getEnabledButtonByTestId("settings-project-sessions-delete-selected"));

    await waitFor(() => {
      expect(onSessionsMutated).toHaveBeenCalledTimes(2);
      expect(onSessionsMutated).toHaveBeenNthCalledWith(1, "ws-1");
      expect(onSessionsMutated).toHaveBeenNthCalledWith(2, "ws-2");
    });
    await waitFor(() => {
      expect(getWorkspaceSessionProjectionSummary).toHaveBeenCalledTimes(2);
    });
  });

});
