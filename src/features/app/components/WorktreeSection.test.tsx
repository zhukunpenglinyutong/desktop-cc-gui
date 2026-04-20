// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceInfo } from "../../../types";
import { WorktreeSection } from "./WorktreeSection";

const worktree: WorkspaceInfo = {
  id: "wt-1",
  name: "Worktree One",
  path: "/tmp/worktree",
  connected: true,
  kind: "worktree",
  worktree: { branch: "feature/test" },
  settings: { sidebarCollapsed: false },
};

afterEach(() => {
  cleanup();
});

describe("WorktreeSection", () => {
  it("does not render older thread controls for worktrees", () => {
    render(
      <WorktreeSection
        parentWorkspaceId="workspace-1"
        worktrees={[worktree]}
        isSectionCollapsed={false}
        onToggleSectionCollapse={vi.fn()}
        deletingWorktreeIds={new Set()}
        threadsByWorkspace={{ [worktree.id]: [] }}
        threadStatusById={{}}
        hydratedThreadListWorkspaceIds={new Set()}
        threadListLoadingByWorkspace={{ [worktree.id]: false }}
        threadListPagingByWorkspace={{ [worktree.id]: false }}
        threadListCursorByWorkspace={{ [worktree.id]: "cursor" }}
        expandedWorkspaces={new Set()}
        activeWorkspaceId={null}
        activeThreadId={null}
        getThreadRows={() => ({
          pinnedRows: [],
          unpinnedRows: [],
          totalRoots: 0,
          hasMoreRoots: false,
        })}
        getThreadTime={() => null}
        isThreadPinned={() => false}
        isThreadAutoNaming={() => false}
        onToggleThreadPin={vi.fn()}
        getPinTimestamp={() => null}
        onConnectWorkspace={vi.fn()}
        onShowWorktreeSessionMenu={vi.fn()}
        onSelectWorkspace={vi.fn()}
        onToggleWorkspaceCollapse={vi.fn()}
        onSelectThread={vi.fn()}
        onShowThreadMenu={vi.fn()}
        onShowWorktreeMenu={vi.fn()}
        onToggleExpanded={vi.fn()}
        onLoadOlderThreads={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Search older..." }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Load older..." }),
    ).toBeNull();
  });

  it("shows an empty session message instead of a loading skeleton for empty worktrees", () => {
    render(
      <WorktreeSection
        parentWorkspaceId="workspace-1"
        worktrees={[worktree]}
        isSectionCollapsed={false}
        onToggleSectionCollapse={vi.fn()}
        deletingWorktreeIds={new Set()}
        threadsByWorkspace={{ [worktree.id]: [] }}
        threadStatusById={{}}
        hydratedThreadListWorkspaceIds={new Set([worktree.id])}
        threadListLoadingByWorkspace={{ [worktree.id]: true }}
        threadListPagingByWorkspace={{ [worktree.id]: false }}
        threadListCursorByWorkspace={{ [worktree.id]: null }}
        expandedWorkspaces={new Set()}
        activeWorkspaceId={null}
        activeThreadId={null}
        getThreadRows={() => ({
          pinnedRows: [],
          unpinnedRows: [],
          totalRoots: 0,
          hasMoreRoots: false,
        })}
        getThreadTime={() => null}
        isThreadPinned={() => false}
        isThreadAutoNaming={() => false}
        onToggleThreadPin={vi.fn()}
        getPinTimestamp={() => null}
        onConnectWorkspace={vi.fn()}
        onShowWorktreeSessionMenu={vi.fn()}
        onSelectWorkspace={vi.fn()}
        onToggleWorkspaceCollapse={vi.fn()}
        onSelectThread={vi.fn()}
        onShowThreadMenu={vi.fn()}
        onShowWorktreeMenu={vi.fn()}
        onToggleExpanded={vi.fn()}
        onLoadOlderThreads={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/No sessions yet\.|暂无会话|sidebar\.emptyWorkspaceSessions/i),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Loading agents")).toBeNull();
  });

  it("does not show the empty session message before worktree sessions hydrate", () => {
    render(
      <WorktreeSection
        parentWorkspaceId="workspace-1"
        worktrees={[worktree]}
        isSectionCollapsed={false}
        onToggleSectionCollapse={vi.fn()}
        deletingWorktreeIds={new Set()}
        threadsByWorkspace={{ [worktree.id]: [] }}
        threadStatusById={{}}
        hydratedThreadListWorkspaceIds={new Set()}
        threadListLoadingByWorkspace={{ [worktree.id]: true }}
        threadListPagingByWorkspace={{ [worktree.id]: false }}
        threadListCursorByWorkspace={{ [worktree.id]: null }}
        expandedWorkspaces={new Set()}
        activeWorkspaceId={null}
        activeThreadId={null}
        getThreadRows={() => ({
          pinnedRows: [],
          unpinnedRows: [],
          totalRoots: 0,
          hasMoreRoots: false,
        })}
        getThreadTime={() => null}
        isThreadPinned={() => false}
        isThreadAutoNaming={() => false}
        onToggleThreadPin={vi.fn()}
        getPinTimestamp={() => null}
        onConnectWorkspace={vi.fn()}
        onShowWorktreeSessionMenu={vi.fn()}
        onSelectWorkspace={vi.fn()}
        onToggleWorkspaceCollapse={vi.fn()}
        onSelectThread={vi.fn()}
        onShowThreadMenu={vi.fn()}
        onShowWorktreeMenu={vi.fn()}
        onToggleExpanded={vi.fn()}
        onLoadOlderThreads={vi.fn()}
      />,
    );

    expect(
      screen.queryByText(/No sessions yet\.|暂无会话|sidebar\.emptyWorkspaceSessions/i),
    ).toBeNull();
  });

  it("toggles the worktree section on double click only", () => {
    const onToggleSectionCollapse = vi.fn();

    const { container } = render(
      <WorktreeSection
        parentWorkspaceId="workspace-1"
        worktrees={[worktree]}
        isSectionCollapsed={false}
        onToggleSectionCollapse={onToggleSectionCollapse}
        deletingWorktreeIds={new Set()}
        threadsByWorkspace={{ [worktree.id]: [] }}
        threadStatusById={{}}
        hydratedThreadListWorkspaceIds={new Set()}
        threadListLoadingByWorkspace={{ [worktree.id]: false }}
        threadListPagingByWorkspace={{ [worktree.id]: false }}
        threadListCursorByWorkspace={{ [worktree.id]: null }}
        expandedWorkspaces={new Set()}
        activeWorkspaceId={null}
        activeThreadId={null}
        getThreadRows={() => ({
          pinnedRows: [],
          unpinnedRows: [],
          totalRoots: 0,
          hasMoreRoots: false,
        })}
        getThreadTime={() => null}
        isThreadPinned={() => false}
        isThreadAutoNaming={() => false}
        onToggleThreadPin={vi.fn()}
        getPinTimestamp={() => null}
        onConnectWorkspace={vi.fn()}
        onShowWorktreeSessionMenu={vi.fn()}
        onSelectWorkspace={vi.fn()}
        onToggleWorkspaceCollapse={vi.fn()}
        onSelectThread={vi.fn()}
        onShowThreadMenu={vi.fn()}
        onShowWorktreeMenu={vi.fn()}
        onToggleExpanded={vi.fn()}
        onLoadOlderThreads={vi.fn()}
      />,
    );

    const header = container.querySelector(".worktree-header") as HTMLButtonElement | null;
    expect(header).toBeTruthy();
    if (!header) {
      throw new Error("Expected worktree header");
    }
    fireEvent.click(header);
    expect(onToggleSectionCollapse).not.toHaveBeenCalled();

    fireEvent.doubleClick(header);
    expect(onToggleSectionCollapse).toHaveBeenCalledWith("workspace-1");
  });

  it("toggles worktree agents on single click", () => {
    const onToggleWorkspaceCollapse = vi.fn();

    const { container } = render(
      <WorktreeSection
        parentWorkspaceId="workspace-1"
        worktrees={[worktree]}
        isSectionCollapsed={false}
        onToggleSectionCollapse={vi.fn()}
        deletingWorktreeIds={new Set()}
        threadsByWorkspace={{ [worktree.id]: [] }}
        threadStatusById={{}}
        hydratedThreadListWorkspaceIds={new Set()}
        threadListLoadingByWorkspace={{ [worktree.id]: false }}
        threadListPagingByWorkspace={{ [worktree.id]: false }}
        threadListCursorByWorkspace={{ [worktree.id]: null }}
        expandedWorkspaces={new Set()}
        activeWorkspaceId={null}
        activeThreadId={null}
        getThreadRows={() => ({
          pinnedRows: [],
          unpinnedRows: [],
          totalRoots: 0,
          hasMoreRoots: false,
        })}
        getThreadTime={() => null}
        isThreadPinned={() => false}
        isThreadAutoNaming={() => false}
        onToggleThreadPin={vi.fn()}
        getPinTimestamp={() => null}
        onConnectWorkspace={vi.fn()}
        onShowWorktreeSessionMenu={vi.fn()}
        onSelectWorkspace={vi.fn()}
        onToggleWorkspaceCollapse={onToggleWorkspaceCollapse}
        onSelectThread={vi.fn()}
        onShowThreadMenu={vi.fn()}
        onShowWorktreeMenu={vi.fn()}
        onToggleExpanded={vi.fn()}
        onLoadOlderThreads={vi.fn()}
      />,
    );

    const worktreeRow = container.querySelector(".worktree-row") as HTMLElement | null;
    expect(worktreeRow).toBeTruthy();
    if (!worktreeRow) {
      throw new Error("Expected worktree row");
    }

    fireEvent.click(worktreeRow);
    expect(onToggleWorkspaceCollapse).toHaveBeenCalledWith("wt-1", true);
  });

  it("renders a new session button for worktrees and does not toggle collapse when clicked", () => {
    const onShowWorktreeSessionMenu = vi.fn();
    const onToggleWorkspaceCollapse = vi.fn();

    render(
      <WorktreeSection
        parentWorkspaceId="workspace-1"
        worktrees={[worktree]}
        isSectionCollapsed={false}
        onToggleSectionCollapse={vi.fn()}
        deletingWorktreeIds={new Set()}
        threadsByWorkspace={{ [worktree.id]: [] }}
        threadStatusById={{}}
        hydratedThreadListWorkspaceIds={new Set()}
        threadListLoadingByWorkspace={{ [worktree.id]: false }}
        threadListPagingByWorkspace={{ [worktree.id]: false }}
        threadListCursorByWorkspace={{ [worktree.id]: null }}
        expandedWorkspaces={new Set()}
        activeWorkspaceId={null}
        activeThreadId={null}
        getThreadRows={() => ({
          pinnedRows: [],
          unpinnedRows: [],
          totalRoots: 0,
          hasMoreRoots: false,
        })}
        getThreadTime={() => null}
        isThreadPinned={() => false}
        isThreadAutoNaming={() => false}
        onToggleThreadPin={vi.fn()}
        getPinTimestamp={() => null}
        onConnectWorkspace={vi.fn()}
        onShowWorktreeSessionMenu={onShowWorktreeSessionMenu}
        onSelectWorkspace={vi.fn()}
        onToggleWorkspaceCollapse={onToggleWorkspaceCollapse}
        onSelectThread={vi.fn()}
        onShowThreadMenu={vi.fn()}
        onShowWorktreeMenu={vi.fn()}
        onToggleExpanded={vi.fn()}
        onLoadOlderThreads={vi.fn()}
      />,
    );

    const createSessionButton = screen.getByRole("button", {
      name: /新建会话|New session|New agent|sidebar\.sessionActionsGroup/i,
    });
    fireEvent.click(createSessionButton);

    expect(onShowWorktreeSessionMenu).toHaveBeenCalledTimes(1);
    expect(onShowWorktreeSessionMenu.mock.calls[0]?.[1]).toEqual(worktree);
    expect(onToggleWorkspaceCollapse).not.toHaveBeenCalled();
  });

  it("activates the worktree from the explicit main-panel action without toggling collapse", () => {
    const onSelectWorkspace = vi.fn();
    const onToggleWorkspaceCollapse = vi.fn();

    render(
      <WorktreeSection
        parentWorkspaceId="workspace-1"
        worktrees={[worktree]}
        isSectionCollapsed={false}
        onToggleSectionCollapse={vi.fn()}
        deletingWorktreeIds={new Set()}
        threadsByWorkspace={{ [worktree.id]: [] }}
        threadStatusById={{}}
        hydratedThreadListWorkspaceIds={new Set()}
        threadListLoadingByWorkspace={{ [worktree.id]: false }}
        threadListPagingByWorkspace={{ [worktree.id]: false }}
        threadListCursorByWorkspace={{ [worktree.id]: null }}
        expandedWorkspaces={new Set()}
        activeWorkspaceId={null}
        activeThreadId={null}
        getThreadRows={() => ({
          pinnedRows: [],
          unpinnedRows: [],
          totalRoots: 0,
          hasMoreRoots: false,
        })}
        getThreadTime={() => null}
        isThreadPinned={() => false}
        isThreadAutoNaming={() => false}
        onToggleThreadPin={vi.fn()}
        getPinTimestamp={() => null}
        onConnectWorkspace={vi.fn()}
        onShowWorktreeSessionMenu={vi.fn()}
        onSelectWorkspace={onSelectWorkspace}
        onToggleWorkspaceCollapse={onToggleWorkspaceCollapse}
        onSelectThread={vi.fn()}
        onShowThreadMenu={vi.fn()}
        onShowWorktreeMenu={vi.fn()}
        onToggleExpanded={vi.fn()}
        onLoadOlderThreads={vi.fn()}
      />,
    );

    const activateButton = screen.getByRole("button", {
      name: /切到主区|Open in main panel|sidebar\.activateWorkspace/i,
    });
    fireEvent.click(activateButton);

    expect(onSelectWorkspace).toHaveBeenCalledWith("wt-1");
    expect(onToggleWorkspaceCollapse).not.toHaveBeenCalled();
  });
});
