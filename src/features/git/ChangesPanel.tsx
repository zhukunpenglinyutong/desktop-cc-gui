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

export function ChangesPanel({
  workspacePath,
  repoPath,
  className,
  visible = true,
}: {
  workspacePath: string;
  repoPath?: string;
  className?: string;
  visible?: boolean;
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
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const scrollOffset = useRef(0);

  const [viewMode, setViewMode] = useState<"flat" | "tree">(() => {
    try {
      return (localStorage.getItem("ccgui-next.git.viewMode") as "flat" | "tree") || "tree";
    } catch {
      return "tree";
    }
  });

  const toggleViewMode = useCallback(() => {
    setViewMode((prev) => {
      const next = prev === "tree" ? "flat" : "tree";
      try {
        localStorage.setItem("ccgui-next.git.viewMode", next);
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  useLayoutEffect(() => {
    if (visible && scrollElement) scrollElement.scrollTop = scrollOffset.current;
  }, [visible, scrollElement]);

  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, true>>({});
  const [commitMsg, setCommitMsg] = useState("");
  const [discardTarget, setDiscardTarget] = useState<string[] | null>(null);

  // Selected files for commit
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(() => {
    return new Set((status?.staged ?? []).map((f) => f.path));
  });
  const prevStagedRef = useRef<string[]>((status?.staged ?? []).map((f) => f.path));

  useEffect(() => {
    if (!status) return;
    const currentStaged = status.staged.map((f) => f.path);
    const allCurrentPaths = new Set([
      ...currentStaged,
      ...status.unstaged.map((f) => f.path),
      ...status.untracked.map((f) => f.path),
    ]);

    setSelectedFiles((prev) => {
      const next = new Set<string>();
      for (const p of prev) {
        if (allCurrentPaths.has(p)) {
          next.add(p);
        }
      }
      const prevStagedSet = new Set(prevStagedRef.current);
      for (const p of currentStaged) {
        if (!prevStagedSet.has(p)) {
          next.add(p);
        }
      }
      return next;
    });

    prevStagedRef.current = currentStaged;
  }, [status]);

  useEffect(() => {
    if (!visible) return;
    void useGitStore.getState().refresh(gitWorkspacePath);
    void useGitStore.getState().loadBranches(gitWorkspacePath);
  }, [gitWorkspacePath, visible]);

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
    [run, gitWorkspacePath],
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
    [run, gitWorkspacePath],
  );

  const stageOne = useCallback((file: string) => stage([file]), [stage]);
  const unstageOne = useCallback((file: string) => unstage([file]), [unstage]);
  const discard = useCallback(
    (files: string[]) =>
      run("discard", () => useGitStore.getState().discard(gitWorkspacePath, files)),
    [run, gitWorkspacePath],
  );
  const discardRow = useCallback((file: string) => setDiscardTarget([file]), []);
  const confirmDiscard = useCallback(() => {
    if (discardTarget === null) return;
    discard(discardTarget);
    setDiscardTarget(null);
  }, [discard, discardTarget]);

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

  const handleCommitSelected = useCallback(async () => {
    const message = commitMsg.trim();
    if (!message || selectedFiles.size === 0) return;

    run("commit", async () => {
      const stagedSet = new Set((status?.staged ?? []).map((f) => f.path));
      const toStage: string[] = [];
      const toUnstage: string[] = [];

      for (const path of selectedFiles) {
        if (!stagedSet.has(path)) {
          toStage.push(path);
        }
      }
      for (const path of stagedSet) {
        if (!selectedFiles.has(path)) {
          toUnstage.push(path);
        }
      }

      if (toUnstage.length > 0) {
        await useGitStore.getState().unstage(gitWorkspacePath, toUnstage);
      }
      if (toStage.length > 0) {
        await useGitStore.getState().stage(gitWorkspacePath, toStage);
      }

      await useGitStore.getState().commit(gitWorkspacePath, message);
      setCommitMsg("");
    });
  }, [commitMsg, selectedFiles, status, gitWorkspacePath, run]);

  const openStagedDiff = useCallback(
    (file: string) =>
      useGitStore.getState().openDiff(gitWorkspacePath, { file, staged: true }),
    [gitWorkspacePath],
  );
  const openUnstagedDiff = useCallback(
    (file: string) =>
      useGitStore.getState().openDiff(gitWorkspacePath, { file, staged: false }),
    [gitWorkspacePath],
  );

  const header = visible ? (
    <ChangesPanelHeader
      workspacePath={gitWorkspacePath}
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

  return (
    <aside
      style={{ display: visible ? undefined : "none" }}
      className={cx("flex h-full min-h-0 flex-col bg-background-primary-default", className)}
    >
      {header}
      <div
        ref={setScrollElement}
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
      {visible && discardTarget !== null && (
        <ConfirmDialog
          danger
          message={
            discardTarget.length === 1
              ? t("git.discardConfirm", { path: discardTarget[0] })
              : t("git.discardAllConfirm", { count: discardTarget.length })
          }
          onConfirm={confirmDiscard}
          onCancel={() => setDiscardTarget(null)}
        />
      )}
    </aside>
  );
}

/* -------------------------------------------------------------------------- */

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
  rowDiscardLabel?: string;
  onRowDiscard?: (file: string) => void;
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
                    onAction={() => onGroupAction(item.allPaths)}
                    discardLabel={rowDiscardLabel}
                    onDiscard={() => onGroupDiscard?.(item.allPaths)}
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
