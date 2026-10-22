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
import { cx } from "@/utils/cx";
import { useFilesStore } from "@/features/files/store";
import { resolveWorkspaceRepository } from "@/features/files/repositorySelection";
import { useGitStore } from "./store";
import { ChangesPanelHeader } from "./ChangesPanelHeader";
import { CommitFooter } from "./CommitFooter";
import { buildGitTree, flattenGitTree } from "./git-tree";
import { DirectoryRow, FileRow } from "./GitTreeRow";
import { RepoSection } from "./RepoSection";

function useVisibleGitValue<Value>(
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
function useGitViewMode() {
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
function useChangesSelection(status: GitStatus | undefined) {
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

/** Mutations, their busy/error bookkeeping, and the commit-confirmation flow. */
function useChangesActions(
  gitWorkspacePath: string,
  status: GitStatus | undefined,
  selection: ReturnType<typeof useChangesSelection>,
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

/**
 * Workspace-scoped entry point. When the workspace holds more than one
 * repository — a plain folder holding several projects — every repository
 * gets its own section, IDEA-style: all projects' changes at a glance, each
 * one staged and committed against its own repository. A single-repository
 * workspace renders the previous single-repository panel unchanged, so the
 * common case looks exactly as before.
 */
export function ChangesPanel({
  workspacePath,
  repoPath,
  className,
  visible = true,
}: {
  workspacePath: string;
  /** Pin the panel to this repository instead of discovering the workspace's
   *  repositories — for callers that render the panel outside the files
   *  context, where discovery and selection would silently steer it. */
  repoPath?: string;
  className?: string;
  visible?: boolean;
}) {
  const repositories = useGitStore((s) =>
    repoPath === undefined ? s.reposByWorkspace[workspacePath] : undefined,
  );
  // Discovery already reports the workspace root when the root is itself a
  // repository, so the summaries are the whole list of projects. More than
  // one project is the only case that needs sections: a workspace holding a
  // single repository keeps the exact panel it has always shown.
  const repos = useMemo(
    () => repositories?.map((repo) => repo.path) ?? [],
    [repositories],
  );
  const multi = repoPath === undefined && repos.length > 1;
  // Discovery can return exactly one repository that is not the workspace
  // root (a workspace subfolder inside a repo, or a single nested project).
  // Pin the panel to it rather than letting the file-tree selection decide.
  const pinnedRepoPath = repoPath ?? (repos.length === 1 ? repos[0] : undefined);
  useEffect(() => {
    if (!visible || repoPath !== undefined) return;
    void useGitStore.getState().discoverRepos(workspacePath);
  }, [workspacePath, visible, repoPath]);
  // Sections share one scroller so that a single scrollbar walks every
  // project, the way IDEA walks its whole change list.
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  if (!multi) {
    return (
      <RepoChangesPanel
        workspacePath={workspacePath}
        repoPath={pinnedRepoPath}
        className={className}
        visible={visible}
      />
    );
  }
  return (
    <aside
      style={{ display: visible ? undefined : "none" }}
      className={cx("flex h-full min-h-0 flex-col bg-background-primary-default", className)}
    >
      {/* One scroller for every project: a single scrollbar walks the whole
          workspace, and each section's group headers stick to it. */}
      <div ref={setScroller} className="min-h-0 flex-1 overflow-y-auto">
        {repos.map((path) => (
          <RepoSection key={path} repoPath={path}>
            <RepoChangesPanel
              workspacePath={workspacePath}
              repoPath={path}
              visible={visible}
              embedded
              sharedScrollElement={scroller}
            />
          </RepoSection>
        ))}
      </div>
    </aside>
  );
}

/**
 * One repository's changes: header (branch, pull/push, errors), the staged /
 * unstaged / untracked groups, and the commit box. `repoPath` pins the
 * repository; without it the panel follows the file tree's selection.
 */
function RepoChangesPanel({
  workspacePath,
  repoPath,
  className,
  visible = true,
  embedded = false,
  sharedScrollElement,
}: {
  workspacePath: string;
  /** Pin the panel to this repository instead of following the file tree's
   *  selection — for callers that render the panel outside the files
   *  context, where a global selectedPath would silently steer it. */
  repoPath?: string;
  className?: string;
  visible?: boolean;
  /** Inside a repository section: the surrounding panel owns the scroller
   *  and the height, so this renders as a plain column. */
  embedded?: boolean;
  /** Shared scroller for embedded sections (their group headers stick to
   *  it); a standalone panel passes nothing and owns its scroller. */
  sharedScrollElement?: HTMLDivElement | null;
}) {
  const { t } = useTranslation();
  const selectedPath = useFilesStore((s) => s.selectedPath);
  const repositories = useFilesStore((s) => s.repositories);
  const gitWorkspacePath = useMemo(
    () =>
      repoPath ??
      resolveWorkspaceRepository({
        selectedPath,
        repositoryRoots: Object.keys(repositories),
        workspacePath,
      }),
    [repositories, selectedPath, workspacePath, repoPath],
  );
  const status = useVisibleGitValue(visible, (s) => s.statusByWorkspace[gitWorkspacePath]);
  const notRepo = useVisibleGitValue(visible, (s) => s.notRepoByWorkspace[gitWorkspacePath]);
  const refreshError = useVisibleGitValue(visible, (s) => s.errorByWorkspace[gitWorkspacePath]);
  const branches = useVisibleGitValue(visible, (s) => s.branchesByWorkspace[gitWorkspacePath]);
  const [ownScrollElement, setOwnScrollElement] = useState<HTMLDivElement | null>(null);
  const scrollElement = embedded ? (sharedScrollElement ?? null) : ownScrollElement;
  const scrollOffset = useRef(0);

  const { viewMode, toggleViewMode } = useGitViewMode();
  const selection = useChangesSelection(status);
  const {
    selectedFiles,
    toggleSelectFile,
    toggleSelectDir,
    toggleSelectGroup,
  } = selection;
  const {
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
    confirmCommitPlan,
    handleCommitSelected,
    openStagedDiff,
    openUnstagedDiff,
  } = useChangesActions(gitWorkspacePath, status, selection);

  useLayoutEffect(() => {
    if (!embedded && visible && scrollElement) {
      scrollElement.scrollTop = scrollOffset.current;
    }
  }, [visible, scrollElement, embedded]);

  useEffect(() => {
    if (!visible) return;
    void useGitStore.getState().refresh(gitWorkspacePath);
    void useGitStore.getState().loadBranches(gitWorkspacePath);
  }, [gitWorkspacePath, visible]);

  const header = visible ? (
    <ChangesPanelHeader
      workspacePath={gitWorkspacePath}
      // Name the repository when the panel followed the file tree's
      // selection into a nested repo — otherwise a commit there looks
      // identical to one against the workspace root.
      followedRepoPath={
        repoPath === undefined && gitWorkspacePath !== workspacePath
          ? gitWorkspacePath
          : undefined
      }
      notRepo={notRepo ?? false}
      branch={status?.branch}
      ahead={status?.ahead}
      behind={status?.behind}
      branches={branches}
      pending={pending}
      error={actionError ?? refreshError ?? null}
      run={run}
      onDismissError={dismissError}
      viewMode={viewMode}
      onToggleViewMode={toggleViewMode}
    />
  ) : null;

  if (notRepo) {
    return (
      <aside
        style={{ display: visible ? undefined : "none" }}
        className={cx("flex h-full flex-col bg-background-primary-default", className)}
      >
        {header}
        <div className="flex flex-1 items-center justify-center p-4">
          <p className="text-center text-body-medium text-text-tertiary">
            {t("git.notARepo")}
          </p>
        </div>
      </aside>
    );
  }

  if (embedded) {
    return (
      <>
        {header}
        <ChangesBody
          status={status}
          visible={visible}
          scrollElement={scrollElement}
          scrollOffset={scrollOffset}
          pending={pending}
          viewMode={viewMode}
          selectedFiles={selectedFiles}
          onToggleSelectFile={toggleSelectFile}
          onToggleSelectDir={toggleSelectDir}
          onToggleSelectGroup={toggleSelectGroup}
          stage={stage}
          unstage={unstage}
          stageOne={stageOne}
          unstageOne={unstageOne}
          discardRow={discardRow}
          setDiscardTarget={setDiscardTarget}
          openStagedDiff={openStagedDiff}
          openUnstagedDiff={openUnstagedDiff}
        />
        {visible && (
          <CommitFooter
            workspacePath={gitWorkspacePath}
            stagedCount={status?.staged.length ?? 0}
            selectedCount={selectedFiles.size}
            onCommitSelected={handleCommitSelected}
            busy={pending.commit === true}
            commitMsg={commitMsg}
            onCommitMsgChange={setCommitMsg}
            run={run}
          />
        )}
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

  return (
    <aside
      style={{ display: visible ? undefined : "none" }}
      className={cx("flex h-full min-h-0 flex-col bg-background-primary-default", className)}
    >
      {header}
      <div
        ref={setOwnScrollElement}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        onScroll={(event) => {
          if (visible) scrollOffset.current = event.currentTarget.scrollTop;
        }}
      >
        <ChangesBody
          status={status}
          visible={visible}
          scrollElement={scrollElement}
          scrollOffset={scrollOffset}
          pending={pending}
          viewMode={viewMode}
          selectedFiles={selectedFiles}
          onToggleSelectFile={toggleSelectFile}
          onToggleSelectDir={toggleSelectDir}
          onToggleSelectGroup={toggleSelectGroup}
          stage={stage}
          unstage={unstage}
          stageOne={stageOne}
          unstageOne={unstageOne}
          discardRow={discardRow}
          setDiscardTarget={setDiscardTarget}
          openStagedDiff={openStagedDiff}
          openUnstagedDiff={openUnstagedDiff}
        />
      </div>
      {visible && (
        <CommitFooter
          workspacePath={gitWorkspacePath}
          stagedCount={status?.staged.length ?? 0}
          selectedCount={selectedFiles.size}
          onCommitSelected={handleCommitSelected}
          busy={pending.commit === true}
          commitMsg={commitMsg}
          onCommitMsgChange={setCommitMsg}
          run={run}
        />
      )}
      <ChangesConfirmDialogs
        visible={visible}
        discardTarget={discardTarget}
        pendingCommitPlan={pendingCommitPlan}
        onConfirmDiscard={confirmDiscard}
        onCancelDiscard={() => setDiscardTarget(null)}
        onConfirmPlan={confirmCommitPlan}
        onCancelPlan={() => setPendingCommitPlan(null)}
      />
    </aside>
  );
}

/** Discard and commit-plan confirmations: conditions stay together so the
 *  panel body's JSX does not grow another two conditional blocks. */
function ChangesConfirmDialogs({
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

/* -------------------------------------------------------------------------- */

/** Scrollable body: loading / empty placeholder, or the three file groups. */
function ChangesBody({
  status,
  visible,
  scrollElement,
  scrollOffset,
  pending,
  viewMode,
  selectedFiles,
  onToggleSelectFile,
  onToggleSelectDir,
  onToggleSelectGroup,
  stage,
  unstage,
  stageOne,
  unstageOne,
  discardRow,
  setDiscardTarget,
  openStagedDiff,
  openUnstagedDiff,
}: {
  status: GitStatus | undefined;
  visible: boolean;
  scrollElement: HTMLDivElement | null;
  scrollOffset: RefObject<number>;
  pending: Record<string, true>;
  viewMode: "flat" | "tree";
  selectedFiles: Set<string>;
  onToggleSelectFile: (path: string) => void;
  onToggleSelectDir: (paths: string[]) => void;
  onToggleSelectGroup: (paths: string[]) => void;
  stage: (files: string[]) => void;
  unstage: (files: string[]) => void;
  stageOne: (file: string) => void;
  unstageOne: (file: string) => void;
  discardRow: (file: string) => void;
  setDiscardTarget: (target: string[] | null) => void;
  openStagedDiff: (file: string) => void;
  openUnstagedDiff: (file: string) => void;
}) {
  const { t } = useTranslation();
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
        onToggleSelectFile={onToggleSelectFile}
        onToggleSelectDir={onToggleSelectDir}
        onToggleSelectGroup={onToggleSelectGroup}
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
        onToggleSelectFile={onToggleSelectFile}
        onToggleSelectDir={onToggleSelectDir}
        onToggleSelectGroup={onToggleSelectGroup}
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
        onToggleSelectFile={onToggleSelectFile}
        onToggleSelectDir={onToggleSelectDir}
        onToggleSelectGroup={onToggleSelectGroup}
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
    </>
  );
}

/** Centered loading / no-changes placeholder. */
function ChangesPlaceholder({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center p-4">
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
