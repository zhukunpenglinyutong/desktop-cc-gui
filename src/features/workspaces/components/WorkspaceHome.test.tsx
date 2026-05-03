// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceInfo } from "../../../types";
import { WorkspaceHome } from "./WorkspaceHome";
import { loadTaskRunStore } from "../../tasks/utils/taskRunStorage";

vi.mock("../../tasks/utils/taskRunStorage", () => ({
  loadTaskRunStore: vi.fn(),
}));

const mockedLoadTaskRunStore = vi.mocked(loadTaskRunStore);

const baseWorkspace: WorkspaceInfo = {
  id: "workspace-1",
  name: "desktop-cc-gui",
  path: "/Users/zhukunpeng/Desktop/desktop-cc-gui",
  connected: true,
  kind: "main",
  worktree: null,
  settings: {
    sidebarCollapsed: false,
  },
};

function renderWorkspaceHome(
  workspace: WorkspaceInfo,
  currentBranch: string | null,
  overrides?: Partial<React.ComponentProps<typeof WorkspaceHome>>,
) {
  return render(
    <WorkspaceHome
      workspace={workspace}
      currentBranch={currentBranch}
      recentThreads={[]}
      onSelectConversation={() => {}}
      onStartConversation={async () => {}}
      onContinueLatestConversation={() => {}}
      onStartGuidedConversation={async () => {}}
      onOpenSpecHub={() => {}}
      onRevealWorkspace={async () => {}}
      onDeleteConversations={async () => ({ succeededThreadIds: [], failed: [] })}
      {...overrides}
    />,
  );
}

describe("WorkspaceHome", () => {
  beforeEach(() => {
    mockedLoadTaskRunStore.mockReturnValue({ version: 1, runs: [] });
  });

  it("renders the centered workspace summary without a last-modified row", () => {
    const { container } = renderWorkspaceHome(baseWorkspace, "feature/ref-layout");

    expect(screen.getByRole("heading", { level: 1, name: "构建任何东西" })).toBeTruthy();
    expect(container.querySelector(".workspace-home-path-line")?.textContent)
      .toBe("/Users/zhukunpeng/Desktop/desktop-cc-gui");
    expect(container.querySelector(".workspace-home-path-name")?.textContent).toBe("desktop-cc-gui");
    expect(container.querySelector(".workspace-home-branch-line")?.textContent)
      .toContain("主分支(feature/ref-layout)");
    expect(screen.queryByText(/最后修改/i)).toBeNull();
  });

  it("uses the worktree label when the workspace is a worktree", () => {
    const { container } = renderWorkspaceHome(
      {
        ...baseWorkspace,
        kind: "worktree",
        worktree: { branch: "feature/worktree-home" },
      },
      null,
    );

    expect(container.querySelector(".workspace-home-branch-line")?.textContent)
      .toContain("工作树(feature/worktree-home)");
  });

  it("normalizes Windows paths when rendering the workspace summary", () => {
    const { container } = renderWorkspaceHome(
      {
        ...baseWorkspace,
        path: "C:\\Users\\demo\\Desktop\\desktop-cc-gui",
      },
      "feature/ref-layout",
    );

    expect(container.querySelector(".workspace-home-path-line")?.textContent)
      .toBe("C:/Users/demo/Desktop/desktop-cc-gui");
    expect(container.querySelector(".workspace-home-path-name")?.textContent)
      .toBe("desktop-cc-gui");
  });

  it("does not render an unknown branch placeholder when branch data is unavailable", () => {
    const { container } = renderWorkspaceHome(baseWorkspace, null);

    expect(container.querySelector(".workspace-home-branch-line")).toBeNull();
    expect(container.textContent).not.toContain("unknown");
  });

  it("renders workspace-scoped task runs from Task Center storage", () => {
    mockedLoadTaskRunStore.mockReturnValue({
      version: 1,
      runs: [
        {
          runId: "run-1",
          task: {
            taskId: "task-1",
            source: "kanban",
            workspaceId: baseWorkspace.path,
            title: "Ship Task Center",
          },
          engine: "codex",
          status: "running",
          trigger: "manual",
          linkedThreadId: "thread-1",
          currentStep: "Wiring workspace entry",
          latestOutputSummary: "Task Center is visible",
          artifacts: [],
          availableRecoveryActions: ["open_conversation"],
          updatedAt: 20,
        },
        {
          runId: "run-2",
          task: {
            taskId: "task-2",
            source: "kanban",
            workspaceId: "/other",
            title: "Other workspace",
          },
          engine: "codex",
          status: "running",
          trigger: "manual",
          artifacts: [],
          availableRecoveryActions: [],
          updatedAt: 10,
        },
      ],
    });

    renderWorkspaceHome(baseWorkspace, "feature/ref-layout");

    expect(screen.getAllByText("Ship Task Center").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Task Center is visible").length).toBeGreaterThan(0);
    expect(screen.getByText("taskCenter.workspaceHero")).toBeTruthy();
    expect(screen.queryByText("Other workspace")).toBeNull();
  });

  it("wires task center recovery handlers through workspace home", () => {
    const onRetryTaskRun = vi.fn();
    mockedLoadTaskRunStore.mockReturnValue({
      version: 1,
      runs: [
        {
          runId: "run-1",
          task: {
            taskId: "task-1",
            source: "kanban",
            workspaceId: baseWorkspace.path,
            title: "Ship Task Center",
          },
          engine: "codex",
          status: "failed",
          trigger: "manual",
          linkedThreadId: "thread-1",
          currentStep: "Wiring workspace entry",
          latestOutputSummary: "Task Center is visible",
          artifacts: [],
          availableRecoveryActions: ["open_conversation", "retry", "resume"],
          updatedAt: 20,
        },
      ],
    });

    renderWorkspaceHome(baseWorkspace, "feature/ref-layout", { onRetryTaskRun });

    fireEvent.click(screen.getByText("taskCenter.action.retry"));
    expect(onRetryTaskRun).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
      }),
    );
  });
});
