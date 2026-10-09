import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cx } from "@/utils/cx";
import {
  GitChangesBody,
  useChangesActions,
  useChangesSelection,
  useGitViewMode,
  useVisibleGitValue,
} from "./ChangesPanel";
import { ChangesPanelHeader } from "./ChangesPanelHeader";
import { CommitFooter } from "./CommitFooter";
import { useGitStore } from "./store";

/**
 * One Git repository group inside the multi-root changes panel: its own status,
 * checkbox selection, view mode, header (branch/pull/push) and commit footer.
 * Each group keys the git store on its own repository path, so stage / commit /
 * push act on that root alone — the backend keeps its single-`path` commands,
 * the frontend simply calls them once per root.
 *
 * The group only follows the store while `visible` (the panel is shown); a
 * hidden panel detaches every subscription.
 */
export function ChangesGroupBody({
  path,
  label,
  extra,
  gitWorkspacePath,
  isRepo,
  isActive,
  visible,
  grouped,
  onFocus,
}: {
  /** Root path — also this group's git store key when it is itself the repo. */
  path: string;
  /** Group title (root folder name). */
  label: string;
  /** True when this root is an extra root (not the workspace primary). */
  extra: boolean;
  /** Repo path when known (repo root under this root), else `path`. */
  gitWorkspacePath: string;
  /** True when the root is (or contains) a repository. */
  isRepo: boolean;
  /** True when the panel is focused on this group (status-bar branch etc.). */
  isActive: boolean;
  /** Panel visibility — hidden groups detach store subscriptions. */
  visible: boolean;
  /** 多根分组时渲染组标题行；单根时省略，保持与旧的单仓库面板一致。 */
  grouped: boolean;
  /** Clicking a group root focuses it (updates the shared selection). */
  onFocus: () => void;
}) {
  const { t } = useTranslation();
  const status = useVisibleGitValue(visible, (s) => s.statusByWorkspace[gitWorkspacePath]);
  const notRepo = useVisibleGitValue(visible, (s) => s.notRepoByWorkspace[gitWorkspacePath]);
  const refreshError = useVisibleGitValue(visible, (s) => s.errorByWorkspace[gitWorkspacePath]);
  const branches = useVisibleGitValue(visible, (s) => s.branchesByWorkspace[gitWorkspacePath]);
  const { viewMode, toggleViewMode } = useGitViewMode();
  const selection = useChangesSelection(status);
  const actions = useChangesActions(gitWorkspacePath, status, selection);

  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const scrollOffset = useRef(0);

  // 恢复共享的滚动位置：隐藏再显示后，组重新挂载，把记录的位置写回 scroller。
  useLayoutEffect(() => {
    if (visible && scrollElement) scrollElement.scrollTop = scrollOffset.current;
  }, [visible, scrollElement]);

  // 每个是仓库的根各自刷新（前端按根多次调用既有的单 path 命令）；隐藏时不发
  // 请求。主目录即便取状态失败也保留 header 显示「非仓库」占位（与旧行为一致）。
  useEffect(() => {
    if (!visible || !isRepo) return;
    void useGitStore.getState().refresh(gitWorkspacePath);
    void useGitStore.getState().loadBranches(gitWorkspacePath);
  }, [visible, isRepo, gitWorkspacePath]);

  const showNotRepo = isRepo === false || notRepo === true;

  return (
    <>
      {visible && isActive && (
        <ChangesPanelHeader
          workspacePath={gitWorkspacePath}
          // 组标题已显示根目录名；聚焦仓库落在更深的嵌套仓库时才另标仓库路径。
          followedRepoPath={
            gitWorkspacePath !== path && label !== gitWorkspacePath
              ? gitWorkspacePath
              : undefined
          }
          notRepo={showNotRepo}
          branch={status?.branch}
          ahead={status?.ahead}
          behind={status?.behind}
          branches={branches}
          pending={actions.pending}
          error={actions.actionError ?? refreshError ?? null}
          run={actions.run}
          onDismissError={actions.dismissError}
          viewMode={viewMode}
          onToggleViewMode={toggleViewMode}
        />
      )}
      {grouped && (
        <RootGroupHeader
          label={label}
          extra={extra}
          isActive={visible && isActive}
          branch={status?.branch}
          onFocus={onFocus}
        />
      )}
      {showNotRepo ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-4">
          <p className="text-center text-body-medium text-text-tertiary">
            {t("git.notARepo")}
          </p>
        </div>
      ) : (
        <>
          <div
            ref={setScrollElement}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
            onScroll={(event) => {
              // 面板隐藏时浏览器可能把 scrollTop 归零，只记录可见期间的滚动。
              if (visible) scrollOffset.current = event.currentTarget.scrollTop;
            }}
          >
            <GitChangesBody
              visible={visible}
              status={status}
              viewMode={viewMode}
              scrollElement={scrollElement}
              scrollOffset={scrollOffset}
              pending={actions.pending}
              selection={selection}
              actions={actions}
            />
          </div>
          {visible && isActive && (
            <CommitFooter
              workspacePath={gitWorkspacePath}
              stagedCount={status?.staged.length ?? 0}
              selectedCount={selection.selectedFiles.size}
              onCommitSelected={actions.handleCommitSelected}
              busy={actions.pending.commit === true}
              commitMsg={actions.commitMsg}
              onCommitMsgChange={actions.setCommitMsg}
              run={actions.run}
            />
          )}
        </>
      )}
    </>
  );
}

/** Group title row: root name, 附加根 badge, current branch, and the marker
 *  for the group the panel is focused on. Clicking it re-focuses the group. */
function RootGroupHeader({
  label,
  extra,
  isActive,
  branch,
  onFocus,
}: {
  label: string;
  extra: boolean;
  isActive: boolean;
  branch: string | undefined;
  onFocus: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={cx(
        "sticky top-0 z-20 flex items-center gap-1.5 border-b border-separator-border px-3 py-1.5",
        isActive ? "bg-background-secondary-default" : "bg-background-primary-default",
      )}
    >
      <button
        type="button"
        onClick={onFocus}
        title={label}
        className={cx(
          "flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left",
          isActive ? "text-text-primary" : "text-text-secondary hover:text-text-primary",
        )}
      >
        <span className="truncate text-body-medium">{label}</span>
        {extra && (
          <span className="shrink-0 rounded-md bg-background-secondary-default px-1.5 py-0.5 text-caption-1-regular text-text-tertiary">
            {t("git.extraRoot")}
          </span>
        )}
      </button>
      {branch && <span className="shrink-0 text-xs text-text-tertiary">{branch}</span>}
      {isActive && (
        <span className="shrink-0 text-caption-1-regular text-text-tertiary">
          {t("git.activeRoot")}
        </span>
      )}
    </div>
  );
}

