import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  gitDiscoverRepositories: vi.fn(),
  gitStatus: vi.fn(),
  gitBranches: vi.fn(),
  gitStage: vi.fn(),
  gitUnstage: vi.fn(),
  gitDiscard: vi.fn(),
  gitCommit: vi.fn(),
  gitPush: vi.fn(),
  gitPull: vi.fn(),
  gitCheckout: vi.fn(),
  gitCreateBranch: vi.fn(),
  gitInit: vi.fn(),
}));
vi.mock("@/lib/ipc", () => ({ ipc: mocks }));
vi.mock("@/features/files/store", () => ({
  useFilesStore: { getState: () => ({ refreshTree: vi.fn().mockResolvedValue(undefined) }) },
}));

import { useGitStore } from "./store";

const REPOS = [
  { path: "/ws/api", branch: "main", changed: 1, untracked: 0 },
  { path: "/ws/web", branch: "main", changed: 0, untracked: 0 },
];

describe("git store repository discovery", () => {
  beforeEach(() => {
    useGitStore.setState({
      reposByWorkspace: {}, reposFetchedAtByWorkspace: {}, reposRevisionByWorkspace: {},
      statusByWorkspace: {}, fetchedAtByWorkspace: {}, statusRevisionByWorkspace: {},
    });
    mocks.gitDiscoverRepositories.mockReset();
  });

  it("stores the discovered repositories under the workspace root", async () => {
    mocks.gitDiscoverRepositories.mockResolvedValue(REPOS);
    await useGitStore.getState().discoverRepos("/ws");
    expect(useGitStore.getState().reposByWorkspace["/ws"]).toEqual(REPOS);
  });

  it("skips a repeat scan inside the TTL and rescans when forced", async () => {
    mocks.gitDiscoverRepositories.mockResolvedValue(REPOS);
    const { discoverRepos } = useGitStore.getState();
    await discoverRepos("/ws");
    await discoverRepos("/ws");
    expect(mocks.gitDiscoverRepositories).toHaveBeenCalledTimes(1);
    await discoverRepos("/ws", true);
    expect(mocks.gitDiscoverRepositories).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight scan between concurrent callers", async () => {
    let release: (repos: typeof REPOS) => void = () => {};
    mocks.gitDiscoverRepositories.mockReturnValue(
      new Promise<typeof REPOS>((resolve) => { release = resolve; }),
    );
    const first = useGitStore.getState().discoverRepos("/ws");
    const second = useGitStore.getState().discoverRepos("/ws");
    release(REPOS);
    await Promise.all([first, second]);
    expect(mocks.gitDiscoverRepositories).toHaveBeenCalledTimes(1);
    // The dedup key is released, so the next scan (after the TTL) can run.
    await useGitStore.getState().discoverRepos("/ws", true);
    expect(mocks.gitDiscoverRepositories).toHaveBeenCalledTimes(2);
  });

  it("keeps the last good list when a later scan fails", async () => {
    mocks.gitDiscoverRepositories.mockResolvedValue(REPOS);
    await useGitStore.getState().discoverRepos("/ws");
    mocks.gitDiscoverRepositories.mockRejectedValue(new Error("scan blew up"));
    await useGitStore.getState().discoverRepos("/ws", true);
    // An empty list would read as "this workspace holds no projects" and
    // collapse a view the user is working in.
    expect(useGitStore.getState().reposByWorkspace["/ws"]).toEqual(REPOS);
  });

  it("records the failed attempt so the next open does not rescan at once", async () => {
    mocks.gitDiscoverRepositories.mockRejectedValue(new Error("scan blew up"));
    await useGitStore.getState().discoverRepos("/ws");
    await useGitStore.getState().discoverRepos("/ws");
    expect(mocks.gitDiscoverRepositories).toHaveBeenCalledTimes(1);
  });

  it("does not let a failed scan make an older summary look newer than live status", async () => {
    mocks.gitDiscoverRepositories.mockResolvedValue(REPOS);
    await useGitStore.getState().discoverRepos("/ws");
    const revision = useGitStore.getState().reposRevisionByWorkspace["/ws"];
    expect(revision).toBeGreaterThan(0);
    mocks.gitDiscoverRepositories.mockRejectedValue(new Error("scan failed"));
    await useGitStore.getState().discoverRepos("/ws", true);
    expect(useGitStore.getState().reposRevisionByWorkspace["/ws"]).toBe(revision);
  });

  it("refreshes cached status within the TTL when a newer discovery has arrived", async () => {
    mocks.gitStatus.mockResolvedValue({ branch: "main", staged: [], unstaged: [], untracked: [] });
    await useGitStore.getState().refresh("/ws/api", true);
    mocks.gitStatus.mockClear();
    mocks.gitDiscoverRepositories.mockResolvedValue(REPOS);
    await useGitStore.getState().discoverRepos("/ws");
    await useGitStore.getState().refresh("/ws/api");
    expect(mocks.gitStatus).toHaveBeenCalledOnce();
    expect(useGitStore.getState().statusRevisionByWorkspace["/ws/api"])
      .toBeGreaterThan(useGitStore.getState().reposRevisionByWorkspace["/ws"]);
  });

  it("orders overlapping snapshots by request start rather than response arrival", async () => {
    let release!: (repos: typeof REPOS) => void;
    mocks.gitDiscoverRepositories.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const discovery = useGitStore.getState().discoverRepos("/ws");
    mocks.gitStatus.mockResolvedValue({ branch: "newer", staged: [], unstaged: [], untracked: [] });
    await useGitStore.getState().refresh("/ws/api", true);
    release(REPOS);
    await discovery;
    expect(useGitStore.getState().statusRevisionByWorkspace["/ws/api"])
      .toBeGreaterThan(useGitStore.getState().reposRevisionByWorkspace["/ws"]);
  });

  it("follows an older in-flight status with a fresh request after a newer scan", async () => {
    const clean = { branch: "old", staged: [], unstaged: [], untracked: [] };
    let release!: (status: typeof clean) => void;
    mocks.gitStatus.mockReset().mockReturnValueOnce(new Promise((resolve) => { release = resolve; }))
      .mockResolvedValueOnce({ ...clean, branch: "new" });
    const oldRefresh = useGitStore.getState().refresh("/ws/api", true);
    mocks.gitDiscoverRepositories.mockResolvedValue(REPOS);
    await useGitStore.getState().discoverRepos("/ws");
    const freshRefresh = useGitStore.getState().refresh("/ws/api");
    release(clean);
    await Promise.all([oldRefresh, freshRefresh]);
    expect(mocks.gitStatus).toHaveBeenCalledTimes(2);
    expect(useGitStore.getState().statusByWorkspace["/ws/api"]?.branch).toBe("new");
  });
});

const freshStatus = { branch: "main", staged: [], unstaged: [], untracked: [] };

describe("git store init", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useGitStore.setState({
      statusByWorkspace: {},
      notRepoByWorkspace: { "/plain": true },
      errorByWorkspace: {},
      fetchedAtByWorkspace: { "/plain": Date.now() },
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("leaves the non-repo state with fresh status by the time it resolves", async () => {
    let resolveStatus!: (status: typeof freshStatus) => void;
    mocks.gitInit.mockResolvedValue(undefined);
    mocks.gitStatus.mockReturnValue(new Promise((done) => { resolveStatus = done; }));

    let settled = false;
    const pending = useGitStore.getState().init("/plain").then(() => { settled = true; });
    await vi.waitFor(() => expect(mocks.gitStatus).toHaveBeenCalled());
    // Still busy while status is in flight: the panel would otherwise
    // re-enable the init button over a not-yet-refreshed NOT_A_REPO body.
    expect(settled).toBe(false);
    resolveStatus(freshStatus);
    await pending;

    expect(mocks.gitInit).toHaveBeenCalledWith("/plain");
    // The TTL from the NOT_A_REPO probe must not short-circuit the refresh,
    // and the follow-up join must reuse runMutation's request.
    expect(mocks.gitStatus).toHaveBeenCalledTimes(1);
    const state = useGitStore.getState();
    expect(state.notRepoByWorkspace["/plain"]).toBe(false);
    expect(state.statusByWorkspace["/plain"]).toEqual(freshStatus);
  });

  it("asks again when a refresh from before init answers NOT_A_REPO", async () => {
    let rejectStale!: (error: unknown) => void;
    mocks.gitInit.mockResolvedValue(undefined);
    mocks.gitStatus
      .mockReturnValueOnce(new Promise((_, reject) => { rejectStale = reject; }))
      .mockResolvedValue(freshStatus);

    // e.g. a window-focus refresh already in flight when the user clicks.
    const stale = useGitStore.getState().refresh("/plain", true);
    const pending = useGitStore.getState().init("/plain");
    // Let init reach its refresh while the stale request is still in flight,
    // so the in-flight dedup hands that request back.
    await new Promise((done) => setTimeout(done, 0));
    rejectStale("NOT_A_REPO");
    await stale;
    await pending;

    expect(mocks.gitStatus).toHaveBeenCalledTimes(2);
    expect(useGitStore.getState().notRepoByWorkspace["/plain"]).toBe(false);
    expect(useGitStore.getState().statusByWorkspace["/plain"]).toEqual(freshStatus);
  });

  it("rethrows a failed init and keeps the non-repo state", async () => {
    mocks.gitInit.mockRejectedValue("not a directory: /plain");
    mocks.gitStatus.mockRejectedValue("NOT_A_REPO");

    await expect(useGitStore.getState().init("/plain")).rejects.toBe("not a directory: /plain");

    await vi.waitFor(() => expect(mocks.gitStatus).toHaveBeenCalled());
    expect(useGitStore.getState().notRepoByWorkspace["/plain"]).toBe(true);
  });
});
