import { create } from "zustand";
import { ipc, type BranchInfo, type GitStatus } from "@/lib/ipc";
import { errorText } from "@/lib/errors";

const TTL_MS = 30_000;

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

/**
 * 工作区多目录：Git 面板按根分组的描述。
 *
 * `path` 是仓库根的绝对路径（主目录或附加根）；`extra` 为 true 表示它不是
 * 工作区主目录（`Workspace.path`），UI 以此标注附加根组。`repoPath` 仅在该根
 * 确为仓库时与 `path` 相同，否则为 null —— 由 `resolveWorkspaceRepositoryGroups`
 * 结合文件树已发现的 `repositories` 判定，非仓库根保持 null（不出变更列表）。
 */
export interface GitRepoGroup {
  /** 根路径，同时是 git store 的状态键。 */
  path: string;
  /** 是否为附加根（非主目录）。 */
  extra: boolean;
  /** 该根确为仓库时的（规范化）路径；null = 非仓库。 */
  repoPath: string | null;
}

/**
 * 按工作区的全部根解析 Git 分组，主目录恒为第一组。
 *
 * 主目录（首个根）始终成组：它是会话/引擎的主目录，变更面板以它自己的路径
 * 取状态（失败即显示「非仓库」占位）。附加根只有当文件树在根层判定其确为
 * 仓库时才成组（`repoPath` = 根本身），否则 `repoPath` 为 null，UI 标注
 * 「非仓库」且不展示变更列表。单根时结果恒为 `[{ path: primary, ... }]`，
 * 与旧的单仓库呈现一致。
 */
export function resolveWorkspaceRepositoryGroups(input: {
  primaryRoot: string;
  roots: readonly string[];
  /** 文件树已发现的确切仓库根（files store `repositories` 的键）。 */
  repositoryRoots: readonly string[];
}): GitRepoGroup[] {
  const { primaryRoot, roots, repositoryRoots } = input;
  const known = new Set(repositoryRoots.map(normalizeGitPath));
  return roots.map((root) => {
    const isPrimary = normalizeGitPath(root) === normalizeGitPath(primaryRoot);
    const isRepo =
      isPrimary || known.has(normalizeGitPath(root));
    return { path: root, extra: !isPrimary, repoPath: isRepo ? root : null };
  });
}

/** Separator- and (Windows-only) case-insensitive key, aligned with
 *  `repositorySelection.normalize` (Git repos are matched by path identity). */
function normalizeGitPath(path: string): string {
  const unified = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[a-zA-Z]:\//.test(unified) ? unified.toLowerCase() : unified;
}

interface GitStore {
  statusByWorkspace: Record<string, GitStatus | undefined>;
  notRepoByWorkspace: Record<string, boolean>;
  errorByWorkspace: Record<string, string | null>;
  branchesByWorkspace: Record<string, BranchInfo[] | undefined>;
  /** epoch ms of last successful/failed fetch per workspace (TTL bookkeeping) */
  fetchedAtByWorkspace: Record<string, number>;
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
}

/** In-flight refresh dedup per workspace. */
const inflight = new Map<string, Promise<void>>();

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
    diffView: null,

    openDiff: (workspacePath, target) => set({ diffView: { workspacePath, target } }),
    closeDiff: () => set({ diffView: null }),
    clearError: (workspacePath) =>
      set((s) => ({
        errorByWorkspace: { ...s.errorByWorkspace, [workspacePath]: null },
      })),

    refresh: (workspacePath, force = false) => {
      const last = get().fetchedAtByWorkspace[workspacePath];
      if (!force && last && Date.now() - last < TTL_MS) return Promise.resolve();
      const pending = inflight.get(workspacePath);
      if (pending) return pending;

      const task = ipc
        .gitStatus(workspacePath)
        .then((status) => {
          set((s) => ({
            statusByWorkspace: { ...s.statusByWorkspace, [workspacePath]: status },
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
  };
});
