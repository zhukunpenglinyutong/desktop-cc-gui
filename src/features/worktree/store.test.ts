import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorktreeCreateArgs, WorktreeCreateProgress } from "@/lib/ipc";

const createMock = vi.fn();
const cancelMock = vi.fn();
vi.mock("@/lib/ipc", () => ({
  ipc: {
    gitWorktreeCreate: (...args: unknown[]) => createMock(...args),
    gitWorktreeCreateCancel: (...args: unknown[]) => cancelMock(...args),
  },
}));

const listenMock = vi.fn();
vi.mock("@/lib/transport", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

const refreshWorkspacesMock = vi.fn();
const startNewChatMock = vi.fn();
vi.mock("@/features/chat/store", () => ({
  useChatStore: {
    getState: () => ({
      refreshWorkspaces: refreshWorkspacesMock,
      startNewChat: startNewChatMock,
    }),
  },
}));

const dismissCenterSurfacesMock = vi.fn();
vi.mock("@/features/chat/center-surfaces", () => ({
  dismissCenterSurfaces: dismissCenterSurfacesMock,
}));

// vi.mock 提升后静态导入拿到的是 mock 版。
import { useWorktreeStore } from "./store";

const ARGS: WorktreeCreateArgs = {
  repoPath: "/repo/app",
  parentWorkspaceId: "ws-parent",
  branch: "pr-1842-x",
  worktreePath: "/repo/app-worktrees/pr-1842-x",
  baseRef: null,
  prNumber: 1842,
  prTitle: "Add worktree support",
  prUrl: "https://github.com/o/r/pull/1842",
  existingBranch: false,
};

function progress(
  creationId: string,
  stage: WorktreeCreateProgress["stage"],
  extra: Partial<WorktreeCreateProgress> = {},
): WorktreeCreateProgress {
  return { creationId, stage, ...extra };
}

function startOne(openSessionAfter = true): string {
  useWorktreeStore.getState().start(ARGS, { parentPath: ARGS.repoPath, openSessionAfter });
  return useWorktreeStore.getState().pending.at(-1)!.creationId;
}

describe("worktree store", () => {
  beforeEach(() => {
    localStorage.clear();
    useWorktreeStore.setState({ pending: [], prefs: { location: null, openSessionAfter: true } });
    createMock.mockReset().mockResolvedValue(undefined);
    cancelMock.mockReset().mockResolvedValue(undefined);
    listenMock.mockReset().mockResolvedValue(() => {});
    refreshWorkspacesMock.mockReset().mockResolvedValue(undefined);
    startNewChatMock.mockReset();
    dismissCenterSurfacesMock.mockReset();
  });

  it("start registers a pending row and launches the backend pipeline", () => {
    const id = startOne();
    const state = useWorktreeStore.getState();
    expect(state.pending).toHaveLength(1);
    expect(state.pending[0]).toMatchObject({
      creationId: id,
      parentWorkspaceId: "ws-parent",
      branch: "pr-1842-x",
      stage: "validate",
    });
    expect(createMock).toHaveBeenCalledWith(id, ARGS);
    expect(listenMock).toHaveBeenCalledWith("worktree://create-progress", expect.any(Function));
  });

  it("running progress updates stage and detail on the matching row only", () => {
    const id = startOne();
    const other = startOne();
    useWorktreeStore.getState().applyProgress(progress(id, "fetch", { message: "origin main" }));
    const [first, second] = useWorktreeStore.getState().pending;
    expect(first).toMatchObject({ creationId: id, stage: "fetch", detail: "origin main" });
    expect(second).toMatchObject({ creationId: other, stage: "validate" });
  });

  it("progress for an unknown creationId is ignored", () => {
    startOne();
    useWorktreeStore.getState().applyProgress(progress("ghost", "add"));
    expect(useWorktreeStore.getState().pending[0].stage).toBe("validate");
  });

  it("done removes the row, refreshes workspaces, then clears surfaces and opens a chat", async () => {
    const id = startOne(true);
    useWorktreeStore.getState().applyProgress(progress(id, "done"));

    expect(useWorktreeStore.getState().pending).toHaveLength(0);
    // Surfaces clear inside startNewChat, only once the chat really opens.
    await vi.waitFor(() =>
      expect(startNewChatMock).toHaveBeenCalledWith(ARGS.worktreePath, undefined, dismissCenterSurfacesMock),
    );
    expect(refreshWorkspacesMock).toHaveBeenCalled();
  });

  it("done without openSessionAfter refreshes but does not open a chat", async () => {
    const id = startOne(false);
    useWorktreeStore.getState().applyProgress(progress(id, "done"));

    await vi.waitFor(() => expect(refreshWorkspacesMock).toHaveBeenCalled());
    expect(startNewChatMock).not.toHaveBeenCalled();
    expect(dismissCenterSurfacesMock).not.toHaveBeenCalled();
  });

  it("failed keeps the row with the error kind for retry", () => {
    const id = startOne();
    useWorktreeStore
      .getState()
      .applyProgress(progress(id, "failed", { errorKind: "fetch_failed", error: "boom" }));
    const row = useWorktreeStore.getState().pending[0];
    expect(row).toMatchObject({ stage: "failed", errorKind: "fetch_failed", error: "boom" });
  });

  it("cancel forwards to the backend cancellation registry", () => {
    const id = startOne();
    useWorktreeStore.getState().cancel(id);
    expect(cancelMock).toHaveBeenCalledWith(id);
  });

  it("retry relaunches a failed creation with a fresh id and the same args", () => {
    const id = startOne();
    useWorktreeStore.getState().applyProgress(progress(id, "failed", { errorKind: "unknown" }));

    useWorktreeStore.getState().retry(id);

    const state = useWorktreeStore.getState();
    expect(state.pending).toHaveLength(1);
    expect(state.pending[0].creationId).not.toBe(id);
    expect(state.pending[0].stage).toBe("validate");
    expect(createMock).toHaveBeenLastCalledWith(state.pending[0].creationId, ARGS);
  });

  it("retry after a name clash renames with a fresh 3-digit suffix", () => {
    const id = startOne();
    useWorktreeStore
      .getState()
      .applyProgress(progress(id, "failed", { errorKind: "branch_exists", error: "exists" }));

    useWorktreeStore.getState().retry(id);

    const row = useWorktreeStore.getState().pending[0];
    expect(row.branch).toMatch(/^pr-1842-x-\d{3}$/);
    expect(row.branch).not.toBe(ARGS.branch);
    // 目录跟着分支名走，否则重试还会撞 dir_exists
    expect(createMock).toHaveBeenLastCalledWith(
      row.creationId,
      expect.objectContaining({
        branch: row.branch,
        worktreePath: `/repo/app-worktrees/${row.branch}`,
      }),
    );
  });

  it("retry replaces an existing suffix instead of stacking a second one", () => {
    const args = { ...ARGS, branch: "pr-1842-x-482", worktreePath: "/repo/app-worktrees/pr-1842-x-482" };
    useWorktreeStore.getState().start(args, { parentPath: args.repoPath, openSessionAfter: true });
    const id = useWorktreeStore.getState().pending.at(-1)!.creationId;
    useWorktreeStore.getState().applyProgress(progress(id, "failed", { errorKind: "dir_exists" }));

    useWorktreeStore.getState().retry(id);

    const row = useWorktreeStore.getState().pending.at(-1)!;
    expect(row.branch).toMatch(/^pr-1842-x-\d{3}$/);
    expect(row.branch).not.toBe("pr-1842-x-482");
  });

  it("retry on a still-running creation is a no-op", () => {
    const id = startOne();
    createMock.mockClear();
    useWorktreeStore.getState().retry(id);
    expect(createMock).not.toHaveBeenCalled();
    expect(useWorktreeStore.getState().pending[0].creationId).toBe(id);
  });

  it("an invoke rejection (event never arrives) fails the row instead of spinning forever", async () => {
    createMock.mockRejectedValueOnce(new Error("ipc down"));
    const id = startOne();
    await vi.waitFor(() => {
      expect(useWorktreeStore.getState().pending[0].stage).toBe("failed");
    });
    expect(useWorktreeStore.getState().pending[0].creationId).toBe(id);
  });

  it("dismiss removes the row without touching the backend", () => {
    const id = startOne();
    useWorktreeStore.getState().applyProgress(progress(id, "failed"));
    useWorktreeStore.getState().dismiss(id);
    expect(useWorktreeStore.getState().pending).toHaveLength(0);
  });

  it("setPrefs persists to localStorage", () => {
    useWorktreeStore.getState().setPrefs({ location: "/custom/dir", openSessionAfter: false });
    const raw = localStorage.getItem("ccgui-next.worktreePrefs:v1");
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!)).toEqual({ location: "/custom/dir", openSessionAfter: false });
  });
});
