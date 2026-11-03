import { create } from "zustand";
import { ipc, type BranchInfo, type GitStatus, type RepositorySummary } from "@/lib/ipc";
import { errorText } from "@/lib/errors";

const TTL_MS = 30_000;
// Order snapshots by request start, including requests that finish out of
// order in the same millisecond. Failed attempts never advance data freshness.
let snapshotRevision = 0;

/** A file whose diff is shown: staged (index vs HEAD) or unstaged/untracked. */
export interface DiffTarget {
  file: string;
  staged: boolean;
}

function isNotARepo(err: unknown): boolean {
  return errorText(err).includes("NOT_A_REPO");
}

/** Partial state marking a workspace as a non-repo after a NOT_A_REPO error. */
function notRepoPatch(workspacePath: string) {
  return (s: GitStore) => ({
    notRepoByWorkspace: { ...s.notRepoByWorkspace, [workspacePath]: true },
    statusByWorkspace: { ...s.statusByWorkspace, [workspacePath]: undefined },
  });
}

interface GitStore {
  statusByWorkspace: Record<string, GitStatus | undefined>;
  notRepoByWorkspace: Record<string, boolean>;
  errorByWorkspace: Record<string, string | null>;
  branchesByWorkspace: Record<string, BranchInfo[] | undefined>;
  /** epoch ms of last successful/failed fetch per workspace (TTL bookkeeping) */
  fetchedAtByWorkspace: Record<string, number>;
  statusRevisionByWorkspace: Record<string, number>;
  /** Diff open in the center area; null = center shows chat/files. */
  diffView: { workspacePath: string; target: DiffTarget } | null;
  openDiff: (workspacePath: string, target: DiffTarget) => void;
  closeDiff: () => void;
  /** Dismiss the surfaced refresh error for one workspace. */
  clearError: (workspacePath: string) => void;

  /** Refreshes status; skipped when fetched < 30s ago unless `force`. */
  refresh: (workspacePath: string, force?: boolean) => Promise<void>;
  loadBranches: (workspacePath: string) => Promise<void>;

  // Mutating actions — each force-refreshes status afterwards. Errors are
  // re-thrown so callers can surface them inline.
  stage: (workspacePath: string, files: string[]) => Promise<void>;
  unstage: (workspacePath: string, files: string[]) => Promise<void>;
  discard: (workspacePath: string, files: string[]) => Promise<void>;
  commit: (workspacePath: string, message: string) => Promise<string>;
  push: (workspacePath: string) => Promise<void>;
  pull: (workspacePath: string) => Promise<void>;
  checkout: (workspacePath: string, branch: string) => Promise<void>;
  createBranch: (workspacePath: string, name: string) => Promise<void>;
  /** `git init`; resolves once status has refreshed out of the non-repo state. */
  init: (workspacePath: string) => Promise<void>;

  /** Repositories discovered under a workspace root, for the panel's
   *  multi-project view. Keyed by the workspace root that was scanned. */
  reposByWorkspace: Record<string, RepositorySummary[] | undefined>;
  /** epoch ms of the last discovery pass per workspace root. */
  reposFetchedAtByWorkspace: Record<string, number>;
  reposRevisionByWorkspace: Record<string, number>;
  /** Repositories under `workspacePath`; skipped when scanned < 30s ago
   *  unless `force`. Best-effort: a failed scan keeps the last good list
   *  and records no error, so the panel falls back to the workspace root
   *  instead of surfacing an error nobody can act on. */
  discoverRepos: (workspacePath: string, force?: boolean) => Promise<void>;
}
/** In-flight refresh dedup per workspace. */
const inflight = new Map<string, Promise<void>>();

/** In-flight discovery dedup per workspace root. */
const discoveryInflight = new Map<string, Promise<void>>();

function latestDiscoveryRevision(state: GitStore, repoPath: string): number {
  let latest = 0;
  for (const [workspace, repos] of Object.entries(state.reposByWorkspace)) {
    if (repos?.some((repo) => repo.path === repoPath)) {
      latest = Math.max(latest, state.reposRevisionByWorkspace[workspace] ?? 0);
    }
  }
  return latest;
}

export const useGitStore = create<GitStore>((set, get) => {
  const runMutation = async (
    workspacePath: string,
    action: () => Promise<unknown>,
  ) => {
    try {
      return await action();
    } catch (err) {
      if (isNotARepo(err)) {
        set(notRepoPatch(workspacePath));
      }
      throw err;
    } finally {
      // Status changed (or may have): drop the TTL and refetch.
      set((s) => ({
        fetchedAtByWorkspace: { ...s.fetchedAtByWorkspace, [workspacePath]: 0 },
      }));
      get()
        .refresh(workspacePath, true)
        .catch(() => undefined);
      // The file tree's git badges/colors are stale after any mutation
      // (commit/stage/checkout); refreshTree re-walks every loaded level.
      // 动态引入避免与 files/store 的模块环：文件抢到中心时也要关差异页签。
      void import("@/features/files/store")
        .then((m) => m.useFilesStore.getState().refreshTree())
        .catch(() => undefined);
    }
  };

  return {
    statusByWorkspace: {},
    notRepoByWorkspace: {},
    errorByWorkspace: {},
    branchesByWorkspace: {},
    fetchedAtByWorkspace: {},
    statusRevisionByWorkspace: {},
    diffView: null,
    reposByWorkspace: {},
    reposFetchedAtByWorkspace: {},
    reposRevisionByWorkspace: {},

    openDiff: (workspacePath, target) => set({ diffView: { workspacePath, target } }),
    closeDiff: () => set({ diffView: null }),
    clearError: (workspacePath) =>
      set((s) => ({
        errorByWorkspace: { ...s.errorByWorkspace, [workspacePath]: null },
      })),

    refresh: (workspacePath, force = false) => {
      const last = get().fetchedAtByWorkspace[workspacePath];
      const requiredRevision = latestDiscoveryRevision(get(), workspacePath);
      if (!force && last && Date.now() - last < TTL_MS
        && (get().statusRevisionByWorkspace[workspacePath] ?? 0) >= requiredRevision) {
        return Promise.resolve();
      }
      const pending = inflight.get(workspacePath);
      if (pending) {
        return pending.then(() => {
          // A scan may have arrived during this older status request. Share
          // the pending work, then refresh once if it cannot satisfy the scan.
          if ((get().statusRevisionByWorkspace[workspacePath] ?? 0) < requiredRevision) {
            return get().refresh(workspacePath);
          }
        });
      }

      const revision = ++snapshotRevision;
      const task = ipc
        .gitStatus(workspacePath)
        .then((status) => {
          set((s) => ({
            statusByWorkspace: { ...s.statusByWorkspace, [workspacePath]: status },
            statusRevisionByWorkspace: { ...s.statusRevisionByWorkspace, [workspacePath]: revision },
            notRepoByWorkspace: { ...s.notRepoByWorkspace, [workspacePath]: false },
            errorByWorkspace: { ...s.errorByWorkspace, [workspacePath]: null },
            fetchedAtByWorkspace: {
              ...s.fetchedAtByWorkspace,
              [workspacePath]: Date.now(),
            },
          }));
        })
        .catch((err: unknown) => {
          set((s) => ({
            statusByWorkspace: { ...s.statusByWorkspace, [workspacePath]: undefined },
            notRepoByWorkspace: {
              ...s.notRepoByWorkspace,
              [workspacePath]: isNotARepo(err),
            },
            errorByWorkspace: {
              ...s.errorByWorkspace,
              [workspacePath]: isNotARepo(err) ? null : errorText(err),
            },
            fetchedAtByWorkspace: {
              ...s.fetchedAtByWorkspace,
              [workspacePath]: Date.now(),
            },
          }));
        })
        .finally(() => {
          inflight.delete(workspacePath);
        });
      inflight.set(workspacePath, task);
      return task;
    },

    loadBranches: async (workspacePath) => {
      if (get().notRepoByWorkspace[workspacePath]) return;
      try {
        const branches = await ipc.gitBranches(workspacePath);
        set((s) => ({
          branchesByWorkspace: { ...s.branchesByWorkspace, [workspacePath]: branches },
        }));
      } catch (err) {
        if (isNotARepo(err)) {
          set(notRepoPatch(workspacePath));
        }
      }
    },

    // Discovery is best-effort: a failed scan keeps the panel on the
    // workspace root instead of surfacing an error nobody can act on.
    discoverRepos: (workspacePath, force = false) => {
      const last = get().reposFetchedAtByWorkspace[workspacePath];
      if (!force && last && Date.now() - last < TTL_MS) return Promise.resolve();
      const pending = discoveryInflight.get(workspacePath);
      if (pending) return pending;
      const revision = ++snapshotRevision;
      const task = ipc
        .gitDiscoverRepositories(workspacePath)
        .then((repositories) => {
          set((s) => ({
            reposByWorkspace: { ...s.reposByWorkspace, [workspacePath]: repositories },
            reposRevisionByWorkspace: { ...s.reposRevisionByWorkspace, [workspacePath]: revision },
            reposFetchedAtByWorkspace: {
              ...s.reposFetchedAtByWorkspace,
              [workspacePath]: Date.now(),
            },
          }));
        })
        .catch(() => {
          // Keep the last good list: an empty scan looks exactly like "this
          // workspace holds no projects", and one transient failure would
          // collapse a multi-project view the user is working in. Record the
          // attempt so the next open does not retry instantly.
          set((s) => ({
            reposFetchedAtByWorkspace: {
              ...s.reposFetchedAtByWorkspace,
              [workspacePath]: Date.now(),
            },
          }));
        })
        .finally(() => {
          discoveryInflight.delete(workspacePath);
        });
      discoveryInflight.set(workspacePath, task);
      return task;
    },

    stage: (workspacePath, files) =>
      runMutation(workspacePath, () => ipc.gitStage(workspacePath, files)) as Promise<void>,
    unstage: (workspacePath, files) =>
      runMutation(workspacePath, () => ipc.gitUnstage(workspacePath, files)) as Promise<void>,
    discard: (workspacePath, files) =>
      runMutation(workspacePath, () => ipc.gitDiscard(workspacePath, files)) as Promise<void>,
    commit: (workspacePath, message) =>
      runMutation(workspacePath, () => ipc.gitCommit(workspacePath, message)) as Promise<string>,
    push: (workspacePath) =>
      runMutation(workspacePath, () => ipc.gitPush(workspacePath)) as Promise<void>,
    pull: (workspacePath) =>
      runMutation(workspacePath, () => ipc.gitPull(workspacePath)) as Promise<void>,
    checkout: async (workspacePath, branch) => {
      await runMutation(workspacePath, () => ipc.gitCheckout(workspacePath, branch));
      await get().loadBranches(workspacePath);
    },
    createBranch: async (workspacePath, name) => {
      await runMutation(workspacePath, () => ipc.gitCreateBranch(workspacePath, name));
      await get().loadBranches(workspacePath);
    },
    init: async (workspacePath) => {
      await runMutation(workspacePath, () => ipc.gitInit(workspacePath));
      // runMutation's refresh is fire-and-forget; join it (the in-flight map
      // dedups) so the caller stays busy until the panel leaves NOT_A_REPO.
      await get().refresh(workspacePath, true);
      // The dedup can hand back a request sent before the repository existed
      // (focus / turn-end refresh); its NOT_A_REPO is stale, so ask once more.
      if (get().notRepoByWorkspace[workspacePath]) {
        await get().refresh(workspacePath, true);
      }
    },
  };
});
