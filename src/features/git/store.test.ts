import { beforeEach, describe, expect, it, vi } from "vitest";

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
}));
vi.mock("@/lib/ipc", () => ({ ipc: mocks }));

import { useGitStore } from "./store";

const REPOS = [
  { path: "/ws/api", branch: "main", changed: 1, untracked: 0 },
  { path: "/ws/web", branch: "main", changed: 0, untracked: 0 },
];

describe("git store repository discovery", () => {
  beforeEach(() => {
    useGitStore.setState({ reposByWorkspace: {}, reposFetchedAtByWorkspace: {} });
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
});
