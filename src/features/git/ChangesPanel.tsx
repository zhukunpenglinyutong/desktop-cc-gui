import {
  memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
  useSyncExternalStore, type RefObject,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslation } from "react-i18next";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import { ConfirmDialog } from "@/components/dialogs";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { type GitFileEntry, type GitStatus } from "@/lib/ipc";
import { errorText } from "@/lib/errors";
import { workspaceRootList } from "@/lib/workspace-roots";
import { cx } from "@/utils/cx";
import { useChatStore } from "@/features/chat/store";
import { useFilesStore } from "@/features/files/store";
import { resolveSelectedRoot, resolveWorkspaceRepository } from "@/features/files/repositorySelection";
import { ChangesGroupBody } from "./ChangesGroupBody";
import { useGitStore, resolveWorkspaceRepositoryGroups, type GitRepoGroup } from "./store";
import { buildGitTree, flattenGitTree } from "./git-tree";
import { DirectoryRow, FileRow } from "./GitTreeRow";

/** Selects a slice of the git store for a *visible* group. Hidden groups
 *  detach every subscription so a background panel costs no re-renders. */
export function useVisibleGitValue<Value>(
  visible: boolean,
  select: (state: ReturnType<typeof useGitStore.getState>) => Value,
) {
  const previous = useRef<Value>();
  const subscribe = useCallback(
    (notify: () => void) => (visible ? useGitStore.subscribe(notify) : () => {}),
    [visible],
  );
  const value = useSyncExternalStore(
    subscribe,
    () => (visible ? select(useGitStore.getState()) : previous.current),
  );
  useLayoutEffect(() => {
    previous.current = value;
  }, [value]);
  return value;
}

const VIEW_MODE_KEY = "ccgui-next.git.viewMode";

/** Persisted flat/tree preference. The read lives in the lazy initializer, so
 *  a disabled localStorage only costs one fallback on first mount. */
export function useGitViewMode() {
  const [viewMode, setViewMode] = useState<"flat" | "tree">(() => {
    try {
      return (localStorage.getItem(VIEW_MODE_KEY) as "flat" | "tree") || "tree";
    } catch {
      return "tree";
    }
  });

  const toggleViewMode = useCallback(() => {
    const next = viewMode === "tree" ? "flat" : "tree";
    setViewMode(next);
    try {
      localStorage.setItem(VIEW_MODE_KEY, next);
    } catch {
      // Private mode / quota: the session keeps the choice.
    }
  }, [viewMode]);

  return { viewMode, toggleViewMode };
}

/** Which files the commit footer's checkbox selection holds. Staged files
 *  start selected; a status refresh drops vanished paths and adopts files that
 *  became staged outside the panel (CLI, another window). The refresh adjust
 *  happens during render so a stale selection never reaches a committed frame. */
export function useChangesSelection(status: GitStatus | undefined) {
  const stagedPaths = useMemo(() => status?.staged.map((f) => f.path) ?? [], [status]);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(() => new Set(stagedPaths));
  const [previousStaged, setPreviousStaged] = useState<string[]>(stagedPaths);

  if (previousStaged !== stagedPaths) {
    setPreviousStaged(stagedPaths);
    setSelectedFiles((prev) => {
      const allCurrentPaths = new Set([
        ...stagedPaths,
        ...(status?.unstaged ?? []).map((f) => f.path),
        ...(status?.untracked ?? []).map((f) => f.path),
      ]);
      const next = new Set<string>();
      for (const path of prev) {
        if (allCurrentPaths.has(path)) next.add(path);
      }
      const previousStagedSet = new Set(previousStaged);
      for (const path of stagedPaths) {
        if (!previousStagedSet.has(path)) next.add(path);
      }
      return next;
    });
  }

  const toggleSelectFile = useCallback((path: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const toggleSelectDir = useCallback((paths: string[]) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      const allSelected = paths.every((p) => next.has(p));
      if (allSelected) {
        for (const p of paths) next.delete(p);
      } else {
        for (const p of paths) next.add(p);
      }
      return next;
    });
  }, []);

  const toggleSelectGroup = useCallback((paths: string[]) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      const allSelected = paths.length > 0 && paths.every((p) => next.has(p));
      if (allSelected) {
        for (const p of paths) next.delete(p);
      } else {
        for (const p of paths) next.add(p);
      }
      return next;
    });
  }, []);

  return { selectedFiles, setSelectedFiles, toggleSelectFile, toggleSelectDir, toggleSelectGroup };
}

export type ChangesSelection = ReturnType<typeof useChangesSelection>;

/** Mutations, their busy/error bookkeeping, and the commit-confirmation flow. */
export function useChangesActions(
  gitWorkspacePath: string,
  status: GitStatus | undefined,
  selection: ChangesSelection,
) {
  const { selectedFiles, setSelectedFiles } = selection;
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, true>>({});
  const [commitMsg, setCommitMsg] = useState("");
  /** Paths awaiting discard confirmation (one row or a whole group). */
  const [discardTarget, setDiscardTarget] = useState<string[] | null>(null);
  /** Commit waiting on confirmation because it would unstage files the user
   *  staged but left unchecked — that reshuffles the index (e.g. hunks
   *  placed with `git add -p`), so it never happens silently. */
  const [pendingCommitPlan, setPendingCommitPlan] = useState<{
    message: string;
    toStage: string[];
    toUnstage: string[];
  } | null>(null);

  /** Runs a mutating action: tracks busy state, surfaces errors inline. */
  const run = useCallback((key: string, action: () => Promise<unknown>) => {
    setPending((p) => ({ ...p, [key]: true }));
    setActionError(null);
    void action()
      .catch((err: unknown) => setActionError(errorText(err)))
      .finally(() => {
        setPending((p) => {
          const next = { ...p };
          delete next[key];
          return next;
        });
      });
  }, []);

  /** Dismiss the header error: the failed action's error, else the store's
   *  last refresh failure. */
  const dismissError = useCallback(() => {
    setActionError(null);
    useGitStore.getState().clearError(gitWorkspacePath);
  }, [gitWorkspacePath]);

  const stage = useCallback(
    (files: string[]) => {
      setSelectedFiles((prev) => {
        const next = new Set(prev);
        for (const f of files) next.add(f);
        return next;
      });
      run("stage", () => useGitStore.getState().stage(gitWorkspacePath, files));
    },
    [run, gitWorkspacePath, setSelectedFiles],
  );

  const unstage = useCallback(
    (files: string[]) => {
      setSelectedFiles((prev) => {
        const next = new Set(prev);
        for (const f of files) next.delete(f);
        return next;
      });
      run("unstage", () => useGitStore.getState().unstage(gitWorkspacePath, files));
    },
    [run, gitWorkspacePath, setSelectedFiles],
  );

  const stageOne = useCallback((file: string) => stage([file]), [stage]);
  const unstageOne = useCallback((file: string) => unstage([file]), [unstage]);

  const discardRow = useCallback((file: string) => setDiscardTarget([file]), []);
  const confirmDiscard = useCallback(() => {
    if (discardTarget === null) return;
    run("discard", () => useGitStore.getState().discard(gitWorkspacePath, discardTarget));
    setDiscardTarget(null);
  }, [run, gitWorkspacePath, discardTarget]);

  const runCommitPlan = useCallback(
    (plan: { message: string; toStage: string[]; toUnstage: string[] }) => {
      run("commit", async () => {
        if (plan.toUnstage.length > 0) {
          await useGitStore.getState().unstage(gitWorkspacePath, plan.toUnstage);
        }
        if (plan.toStage.length > 0) {
          await useGitStore.getState().stage(gitWorkspacePath, plan.toStage);
        }
        await useGitStore.getState().commit(gitWorkspacePath, plan.message);
        setCommitMsg("");
      });
    },
    [run, gitWorkspacePath],
  );

  const confirmCommitPlan = useCallback(() => {
    if (pendingCommitPlan === null) return;
    const plan = pendingCommitPlan;
    setPendingCommitPlan(null);
    runCommitPlan(plan);
  }, [pendingCommitPlan, runCommitPlan]);

  const handleCommitSelected = useCallback(async () => {
    const message = commitMsg.trim();
    if (!message || selectedFiles.size === 0 || !status) return;

    const stagedSet = new Set(status.staged.map((f) => f.path));
    // A checked file commits in full: anything still sitting in the
    // worktree (unstaged or untracked) gets staged too, so a partially
    // staged file never commits only its indexed half.
    const worktreePaths = new Set([
      ...status.unstaged.map((f) => f.path),
      ...status.untracked.map((f) => f.path),
    ]);
    const toStage: string[] = [];
    const toUnstage: string[] = [];
    for (const path of selectedFiles) {
      if (worktreePaths.has(path)) {
        toStage.push(path);
      }
    }
    for (const path of stagedSet) {
      if (!selectedFiles.has(path)) {
        toUnstage.push(path);
      }
    }

    const plan = { message, toStage, toUnstage };
    if (toUnstage.length > 0) {
      setPendingCommitPlan(plan);
      return;
    }
    runCommitPlan(plan);
  }, [commitMsg, selectedFiles, status, runCommitPlan]);

  const openStagedDiff = useCallback(
    (file: string) => useGitStore.getState().openDiff(gitWorkspacePath, { file, staged: true }),
    [gitWorkspacePath],
  );
  const openUnstagedDiff = useCallback(
    (file: string) => useGitStore.getState().openDiff(gitWorkspacePath, { file, staged: false }),
    [gitWorkspacePath],
  );

  return {
    actionError,
    pending,
    commitMsg,
    setCommitMsg,
    discardTarget,
    setDiscardTarget,
    pendingCommitPlan,
    setPendingCommitPlan,
    run,
    dismissError,
    stage,
    unstage,
    stageOne,
    unstageOne,
    discardRow,
    confirmDiscard,
    runCommitPlan,
    confirmCommitPlan,
    handleCommitSelected,
    openStagedDiff,
    openUnstagedDiff,
  };
}

export type ChangesActions = ReturnType<typeof useChangesActions>;

/**
 * 工作区多目录：Git 面板按根分组列出各仓库。
 *
 * 主目录恒为第一组且默认聚焦（不变量）；每个是 Git 仓库的根独立成一组，各自
 * 拥有 header（分支/pull/push）、变更列表与提交框，可分别 stage/commit/push。
 * 非仓库根不出变更列表，仅显示「非仓库」占位。单根时结果与旧的单仓库面板一致。
 */
export function ChangesPanel({
  workspacePath,
  roots: rootsProp,
  repoPath,
  className,
  visible = true,
}: {
  workspacePath: string;
  /** 工作区多目录的附加根（由 ChatSidePanel 透传）。缺省时从 chat store
   *  读取当前工作区的 roots，直接渲染（如测试）也能工作。 */
  roots?: readonly string[];
  /** Pin the panel to this repository instead of following the file tree's
   *  selection — for callers that render the panel outside the files
   *  context, where a global selectedPath would silently steer it. */
  repoPath?: string;
  className?: string;
  visible?: boolean;
}) {
  const selectedPath = useFilesStore((s) => s.selectedPath);
  const repositories = useFilesStore((s) => s.repositories);
  const workspaces = useChatStore((s) => s.workspaces);
  const roots = useMemo(
    () =>
      workspaceRootList(
        workspacePath,
        rootsProp ?? workspaces.find((w) => w.path === workspacePath)?.roots ?? [],
      ),
    [rootsProp, workspaces, workspacePath],
  );

  const repositoryRoots = useMemo(() => Object.keys(repositories), [repositories]);

  const groups: GitRepoGroup[] = useMemo(
    () =>
      resolveWorkspaceRepositoryGroups({
        primaryRoot: workspacePath,
        roots,
        repositoryRoots,
      }),
    [workspacePath, roots, repositoryRoots],
  );

  // 文件树选择（或显式 repoPath）决定聚焦哪个仓库；单根/无选择时恒为主目录。
  const selectionRepo = useMemo(
    () =>
      repoPath ??
      resolveWorkspaceRepository({
        selectedPath,
        repositoryRoots,
        workspacePath,
        roots,
      }),
    [repoPath, selectedPath, repositoryRoots, workspacePath, roots],
  );
  const selectionRoot = useMemo(
    () => resolveSelectedRoot({ selectedPath, repositoryRoots, workspacePath, roots }),
    [selectedPath, repositoryRoots, workspacePath, roots],
  );
  const [focusPath, setFocusPath] = useState<string | null>(null);
  // 聚焦优先级：文件树选择/显式 repoPath（真正指向某个根时）> 用户点组标题的
  // 手动聚焦 > 第一个仓库组 > 主目录（不变量：主目录默认在首组/默认根）。
  // 无选择时 `selectionRepo` 会退回主目录，故只有存在活动选择/固定仓库时才让
  // 它参与，手动点选才不会被主目录默认值盖掉。
  const treeDriven = selectedPath !== null || repoPath !== undefined;
  const resolvedFocus =
    (treeDriven
      ? groups.find((g) => g.path === selectionRoot && g.repoPath)?.repoPath ??
        groups.find((g) => g.repoPath === selectionRepo)?.repoPath
      : undefined) ??
    groups.find((g) => g.path === focusPath && g.repoPath)?.repoPath ??
    groups.find((g) => g.repoPath)?.repoPath ??
    null;

  // 每个是仓库的根在自己的组内刷新（见 ChangesGroupBody，按根多次调用既有
  // 单 path 命令；隐藏时不发请求）。

  // 附加根在文件树根层被发现是仓库后补成一组：刷新发现其确为仓库时迁移为
  // 真组（原先的「非仓库」占位组随之消失）。仅针对新增的、尚未判定过的根，
  // 因此不会重复请求；单根时该集合恒为空。
  useEffect(() => {
    if (!visible) return;
    const git = useGitStore.getState();
    for (const group of groups) {
      if (group.repoPath !== null || group.extra === false) continue;
      if (group.path in git.notRepoByWorkspace) continue;
      void git.refresh(group.path, true).catch(() => undefined);
    }
  }, [visible, groups]);

  return (
    <aside
      style={{ display: visible ? undefined : "none" }}
      className={cx("flex h-full min-h-0 flex-col bg-background-primary-default", className)}
    >
      {groups.map((group) => {
        const gitWorkspacePath = group.repoPath ?? group.path;
        const isActive = group.repoPath !== null && group.repoPath === resolvedFocus;
        return (
          <div
            key={group.path}
            data-git-group
            data-git-group-path={group.path}
            data-git-group-active={isActive ? "true" : "false"}
            data-git-group-repo={group.repoPath === null ? "false" : "true"}
            className={cx(
              "flex min-h-0 flex-col",
              // 单根：占满整个面板（与旧行为一致）；多根：每组按内容分担高度，
              // 组内各自滚动。单根时 groups.length===1 恒为 flex-1。
              groups.length > 1 ? "flex-1" : "min-h-0 flex-1",
              group.extra && "border-t border-separator-border",
            )}
          >
            <ChangesGroupBody
              path={group.path}
              label={groupLabel(group.path)}
              extra={group.extra}
              gitWorkspacePath={gitWorkspacePath}
              isRepo={group.repoPath !== null}
              isActive={isActive}
              visible={visible}
              grouped={groups.length > 1}
              onFocus={() => setFocusPath(group.path)}
            />
          </div>
        );
      })}
    </aside>
  );
}

/** Directory name of a root, for the group header label. */
function groupLabel(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return idx < 0 ? trimmed : trimmed.slice(idx + 1);
}

/* -------------------------------------------------------------------------- */

/** Scrollable body for one group: loading / empty placeholder, or the three
 *  file groups. Shared by every repository group in the panel. */
export function GitChangesBody({
  visible = true,
  status,
  viewMode,
  scrollElement,
  scrollOffset,
  pending,
  selection,
  actions,
}: {
  visible?: boolean;
  status: GitStatus | undefined;
  viewMode: "flat" | "tree";
  scrollElement: HTMLDivElement | null;
  scrollOffset: RefObject<number>;
  pending: Record<string, true>;
  selection: ChangesSelection;
  actions: ChangesActions;
}) {
  const { t } = useTranslation();
  const {
    selectedFiles,
    toggleSelectFile,
    toggleSelectDir,
    toggleSelectGroup,
  } = selection;
  const {
    pendingCommitPlan,
    discardTarget,
    setDiscardTarget,
    confirmDiscard,
    confirmCommitPlan,
    setPendingCommitPlan,
    stage,
    unstage,
    stageOne,
    unstageOne,
    discardRow,
    openStagedDiff,
    openUnstagedDiff,
  } = actions;

  if (!status) return <ChangesPlaceholder text={t("common.loading")} />;
  const total = status.staged.length + status.unstaged.length + status.untracked.length;
  if (total === 0) return <ChangesPlaceholder text={t("git.noChanges")} />;
  return (
    <>
      <ChangesSummary status={status} selectedCount={selectedFiles.size} />
      <GroupSection
        visible={visible}
        scrollElement={scrollElement}
        scrollOffset={scrollOffset}
        title={t("git.staged")}
        entries={status.staged}
        viewMode={viewMode}
        selectedFiles={selectedFiles}
        onToggleSelectFile={toggleSelectFile}
        onToggleSelectDir={toggleSelectDir}
        onToggleSelectGroup={toggleSelectGroup}
        groupActionLabel={t("git.unstageAll")}
        onGroupAction={unstage}
        rowActionLabel={t("git.unstage")}
        rowActionKind="unstage"
        onRowAction={unstageOne}
        onOpen={openStagedDiff}
        actionBusy={pending.unstage === true}
      />
      <GroupSection
        visible={visible}
        scrollElement={scrollElement}
        scrollOffset={scrollOffset}
        title={t("git.unstaged")}
        entries={status.unstaged}
        viewMode={viewMode}
        selectedFiles={selectedFiles}
        onToggleSelectFile={toggleSelectFile}
        onToggleSelectDir={toggleSelectDir}
        onToggleSelectGroup={toggleSelectGroup}
        groupActionLabel={t("git.stageAll")}
        onGroupAction={stage}
        rowActionLabel={t("git.stage")}
        rowActionKind="stage"
        onRowAction={stageOne}
        rowDiscardLabel={t("git.discard")}
        onRowDiscard={discardRow}
        groupDiscardLabel={t("git.discardAll")}
        onGroupDiscard={setDiscardTarget}
        onOpen={openUnstagedDiff}
        actionBusy={pending.stage === true}
      />
      <GroupSection
        visible={visible}
        scrollElement={scrollElement}
        scrollOffset={scrollOffset}
        title={t("git.untracked")}
        entries={status.untracked}
        viewMode={viewMode}
        selectedFiles={selectedFiles}
        onToggleSelectFile={toggleSelectFile}
        onToggleSelectDir={toggleSelectDir}
        onToggleSelectGroup={toggleSelectGroup}
        groupActionLabel={t("git.stageAll")}
        onGroupAction={stage}
        rowActionLabel={t("git.stage")}
        rowActionKind="stage"
        onRowAction={stageOne}
        rowDiscardLabel={t("git.discard")}
        onRowDiscard={discardRow}
        groupDiscardLabel={t("git.discardAll")}
        onGroupDiscard={setDiscardTarget}
        onOpen={openUnstagedDiff}
        actionBusy={pending.stage === true}
        isNew
      />
      <ChangesConfirmDialogs
        visible={visible}
        discardTarget={discardTarget}
        pendingCommitPlan={pendingCommitPlan}
        onConfirmDiscard={confirmDiscard}
        onCancelDiscard={() => setDiscardTarget(null)}
        onConfirmPlan={confirmCommitPlan}
        onCancelPlan={() => setPendingCommitPlan(null)}
      />
    </>
  );
}

/** Centered loading / no-changes placeholder. */
function ChangesPlaceholder({ text }: { text: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-4">
      <p className="text-body-medium text-text-tertiary">{text}</p>
    </div>
  );
}

const ChangesSummary = memo(function ChangesSummary({
  status,
  selectedCount,
}: {
  status: GitStatus;
  selectedCount: number;
}) {
  const { t } = useTranslation();
  const all = [...status.staged, ...status.unstaged, ...status.untracked];
  const adds = all.reduce((n, f) => n + (f.additions ?? 0), 0);
  const dels = all.reduce((n, f) => n + (f.deletions ?? 0), 0);
  return (
    <div className="sticky top-0 z-20 flex items-center justify-between border-b border-separator-border bg-background-primary-default px-3 py-2">
      <div className="flex items-center gap-1.5">
        <span className="text-body-medium text-text-primary">
          {all.length} {t("git.uncommittedChanges")}
        </span>
        <span className="text-xs text-state-success-text">+{adds}</span>
        <span className="text-xs text-text-error-primary">−{dels}</span>
      </div>
      {selectedCount > 0 && (
        <span className="text-xs font-medium text-text-secondary">
          {t("git.selectedCount", { count: selectedCount })}
        </span>
      )}
    </div>
  );
});

/** Discard and commit-plan confirmations: conditions stay together so the
 *  panel body's JSX does not grow another conditional block. */
export function ChangesConfirmDialogs({
  visible,
  discardTarget,
  pendingCommitPlan,
  onConfirmDiscard,
  onCancelDiscard,
  onConfirmPlan,
  onCancelPlan,
}: {
  visible: boolean;
  discardTarget: string[] | null;
  pendingCommitPlan: { message: string; toStage: string[]; toUnstage: string[] } | null;
  onConfirmDiscard: () => void;
  onCancelDiscard: () => void;
  onConfirmPlan: () => void;
  onCancelPlan: () => void;
}) {
  const { t } = useTranslation();
  if (!visible) return null;
  return (
    <>
      {discardTarget !== null && (
        <ConfirmDialog
          danger
          message={
            discardTarget.length === 1
              ? t("git.discardConfirm", { path: discardTarget[0] })
              : t("git.discardAllConfirm", { count: discardTarget.length })
          }
          onConfirm={onConfirmDiscard}
          onCancel={onCancelDiscard}
        />
      )}
      {pendingCommitPlan !== null && (
        <ConfirmDialog
          message={t("git.commitUnstageConfirm", {
            count: pendingCommitPlan.toUnstage.length,
          })}
          onConfirm={onConfirmPlan}
          onCancel={onCancelPlan}
        />
      )}
    </>
  );
}

interface GroupSectionProps {
  visible: boolean;
  scrollElement: HTMLDivElement | null;
  scrollOffset: RefObject<number>;
  title: string;
  entries: GitFileEntry[];
  viewMode: "flat" | "tree";
  selectedFiles: Set<string>;
  onToggleSelectFile: (path: string) => void;
  onToggleSelectDir: (paths: string[]) => void;
  onToggleSelectGroup: (paths: string[]) => void;
  groupActionLabel: string;
  onGroupAction: (files: string[]) => void;
  rowActionLabel: string;
  rowActionKind: "stage" | "unstage";
  onRowAction: (file: string) => void;
  /** Discard is destructive and only meaningful for worktree-side groups
   *  (unstaged/untracked); staged rows get no discard button. */
  rowDiscardLabel?: string;
  onRowDiscard?: (file: string) => void;
  /** Red group-level discard next to the stage-all action, same groups. */
  groupDiscardLabel?: string;
  onGroupDiscard?: (files: string[]) => void;
  onOpen: (file: string) => void;
  actionBusy: boolean;
  isNew?: boolean;
}

const GroupSection = memo(function GroupSection({
  visible,
  scrollElement,
  scrollOffset,
  title,
  entries,
  viewMode,
  selectedFiles,
  onToggleSelectFile,
  onToggleSelectDir,
  onToggleSelectGroup,
  groupActionLabel,
  onGroupAction,
  rowActionLabel,
  rowActionKind,
  onRowAction,
  rowDiscardLabel,
  onRowDiscard,
  groupDiscardLabel,
  onGroupDiscard,
  onOpen,
  actionBusy,
  isNew = false,
}: GroupSectionProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const [collapsedDirIds, setCollapsedDirIds] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLUListElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);

  const toggleDirOpen = useCallback((id: string) => {
    setCollapsedDirIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const allGroupPaths = useMemo(() => entries.map((e) => e.path), [entries]);
  const selectedCountInGroup = useMemo(
    () => allGroupPaths.filter((p) => selectedFiles.has(p)).length,
    [allGroupPaths, selectedFiles],
  );
  const groupSelectedState: "all" | "some" | "none" =
    selectedCountInGroup === 0
      ? "none"
      : selectedCountInGroup === allGroupPaths.length
      ? "all"
      : "some";

  const tree = useMemo(() => {
    if (viewMode !== "tree") return [];
    return buildGitTree(entries);
  }, [entries, viewMode]);

  const visibleTreeItems = useMemo(() => {
    if (viewMode !== "tree") return [];
    return flattenGitTree(tree, collapsedDirIds);
  }, [tree, collapsedDirIds, viewMode]);

  const itemCount = viewMode === "tree" ? visibleTreeItems.length : entries.length;
  const virtual = itemCount > 40;

  useLayoutEffect(() => {
    const scroller = scrollElement;
    if (!visible || !open || !virtual || !scroller) return;
    const measure = () => {
      if (!listRef.current) return;
      setScrollMargin(
        listRef.current.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top +
          scroller.scrollTop,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    for (const child of scroller.children) observer.observe(child);
    return () => observer.disconnect();
  }, [visible, open, virtual, itemCount, scrollElement]);

  const getItemKey = useCallback(
    (index: number) => {
      if (viewMode === "tree") {
        return visibleTreeItems[index]?.id ?? `item-${index}`;
      }
      return entries[index]?.path ?? `item-${index}`;
    },
    [viewMode, visibleTreeItems, entries],
  );

  const virtualizer = useVirtualizer({
    count: itemCount,
    getScrollElement: () => scrollElement,
    estimateSize: () => 32,
    getItemKey,
    overscan: 5,
    scrollMargin,
    initialOffset: () => scrollOffset.current ?? 0,
    enabled: visible && open && virtual,
  });

  if (entries.length === 0) return <section hidden />;

  const rows = !visible
    ? []
    : virtual
    ? virtualizer.getVirtualItems()
    : Array.from({ length: itemCount }, (_, index) => ({
        key: viewMode === "tree" ? visibleTreeItems[index]?.id : entries[index]?.path,
        index,
        start: index * 32 + scrollMargin,
        size: 32,
      }));

  return (
    <section>
      <div
        className={cx(
          "sticky top-[33px] z-10 flex items-center gap-1.5 bg-background-secondary-default px-3 py-1.5",
          "border-b border-separator-border",
        )}
      >
        <button
          type="button"
          className="flex items-center text-foreground-icon-tertiary hover:text-foreground-icon-secondary"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? t("git.collapseGroup", { title }) : t("git.expandGroup", { title })}
        >
          {open ? (
            <ChevronDown aria-hidden className="size-4" />
          ) : (
            <ChevronRight aria-hidden className="size-4" />
          )}
        </button>

        <div className="flex shrink-0 items-center justify-center">
          <Checkbox
            size="sm"
            isSelected={groupSelectedState === "all"}
            isIndeterminate={groupSelectedState === "some"}
            onChange={() => onToggleSelectGroup(allGroupPaths)}
            aria-label={title}
          />
        </div>

        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1 text-left"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="text-body-medium text-text-secondary">{title}</span>
          <span className="text-xs text-text-tertiary">{entries.length}</span>
        </button>

        {groupDiscardLabel !== undefined && onGroupDiscard !== undefined && (
          <button
            type="button"
            disabled={actionBusy}
            onClick={() => onGroupDiscard(entries.map((f) => f.path))}
            className={cx(
              "shrink-0 rounded px-1.5 py-0.5 text-xs text-text-error-primary",
              "hover:bg-background-tertiary-hover disabled:text-text-disabled",
            )}
          >
            {groupDiscardLabel}
          </button>
        )}
        <button
          type="button"
          disabled={actionBusy}
          onClick={() => onGroupAction(entries.map((f) => f.path))}
          className={cx(
            "shrink-0 rounded px-1.5 py-0.5 text-xs text-text-secondary",
            "hover:bg-background-tertiary-hover disabled:text-text-disabled",
          )}
        >
          {groupActionLabel}
        </button>
      </div>

      {open && (
        <ul ref={listRef} className="relative" style={{ height: itemCount * 32 }}>
          {rows.map((row) => {
            const transform = `translateY(${row.start - scrollMargin}px)`;
            const rowStyle = {
              position: "absolute" as const,
              top: 0,
              left: 0,
              width: "100%",
              height: row.size,
              transform,
            };

            if (viewMode === "tree") {
              const item = visibleTreeItems[row.index];
              if (!item) return null;
              if (item.type === "dir") {
                const isAllSelected = item.allPaths.every((p) => selectedFiles.has(p));
                const isSomeSelected =
                  !isAllSelected && item.allPaths.some((p) => selectedFiles.has(p));
                const selectedState = isAllSelected ? "all" : isSomeSelected ? "some" : "none";
                return (
                  <DirectoryRow
                    key={row.key}
                    node={item}
                    style={rowStyle}
                    indent={12 + item.depth * 16}
                    isOpen={!collapsedDirIds.has(item.id)}
                    onToggleOpen={toggleDirOpen}
                    selectedState={selectedState}
                    onToggleSelect={onToggleSelectDir}
                    actionLabel={rowActionLabel}
                    actionKind={rowActionKind}
                    onAction={onGroupAction}
                    discardLabel={rowDiscardLabel}
                    onDiscard={onGroupDiscard}
                    actionBusy={actionBusy}
                  />
                );
              }
              return (
                <FileRow
                  key={row.key}
                  entry={item.entry}
                  style={rowStyle}
                  indent={12 + item.depth * 16}
                  displayName={item.name}
                  isSelected={selectedFiles.has(item.path)}
                  onToggleSelect={onToggleSelectFile}
                  actionLabel={rowActionLabel}
                  actionKind={rowActionKind}
                  onAction={onRowAction}
                  discardLabel={rowDiscardLabel}
                  onDiscard={onRowDiscard}
                  onOpen={onOpen}
                  actionBusy={actionBusy}
                  isNew={isNew}
                />
              );
            }

            const entry = entries[row.index];
            if (!entry) return null;
            return (
              <FileRow
                key={row.key}
                entry={entry}
                style={rowStyle}
                isSelected={selectedFiles.has(entry.path)}
                onToggleSelect={onToggleSelectFile}
                actionLabel={rowActionLabel}
                actionKind={rowActionKind}
                onAction={onRowAction}
                discardLabel={rowDiscardLabel}
                onDiscard={onRowDiscard}
                onOpen={onOpen}
                actionBusy={actionBusy}
                isNew={isNew}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
});
