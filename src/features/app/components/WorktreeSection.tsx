import Layers from "lucide-react/dist/esm/icons/layers";
import { useMemo } from "react";
import type { MouseEvent } from "react";

import type { ThreadSummary, WorkspaceInfo } from "../../../types";
import { ThreadList } from "./ThreadList";
import { ThreadEmptyState } from "./ThreadEmptyState";
import { WorktreeCard } from "./WorktreeCard";
import { getExitedSessionRowVisibility } from "../utils/exitedSessionRows";

type ThreadStatusMap = Record<
  string,
  { isProcessing: boolean; hasUnread: boolean; isReviewing: boolean }
>;

type ThreadRowsResult = {
  pinnedRows: Array<{ thread: ThreadSummary; depth: number }>;
  unpinnedRows: Array<{ thread: ThreadSummary; depth: number }>;
  totalRoots: number;
  hasMoreRoots: boolean;
};

type WorktreeSectionProps = {
  parentWorkspaceId: string;
  worktrees: WorkspaceInfo[];
  isSectionCollapsed: boolean;
  onToggleSectionCollapse: (workspaceId: string) => void;
  deletingWorktreeIds: Set<string>;
  threadsByWorkspace: Record<string, ThreadSummary[]>;
  threadStatusById: ThreadStatusMap;
  hydratedThreadListWorkspaceIds: ReadonlySet<string>;
  threadListLoadingByWorkspace: Record<string, boolean>;
  threadListPagingByWorkspace: Record<string, boolean>;
  threadListCursorByWorkspace: Record<string, string | null>;
  expandedWorkspaces: Set<string>;
  activeWorkspaceId: string | null;
  activeThreadId: string | null;
  systemProxyEnabled?: boolean;
  systemProxyUrl?: string | null;
  getThreadRows: (
    threads: ThreadSummary[],
    isExpanded: boolean,
    workspaceId: string,
    getPinTimestamp: (workspaceId: string, threadId: string) => number | null,
  ) => ThreadRowsResult;
  getThreadTime: (thread: ThreadSummary) => string | null;
  isThreadPinned: (workspaceId: string, threadId: string) => boolean;
  isThreadAutoNaming: (workspaceId: string, threadId: string) => boolean;
  onToggleThreadPin: (workspaceId: string, threadId: string) => void;
  getPinTimestamp: (workspaceId: string, threadId: string) => number | null;
  onConnectWorkspace: (workspace: WorkspaceInfo) => void;
  onShowWorktreeSessionMenu: (event: MouseEvent, workspace: WorkspaceInfo) => void;
  onQuickReloadWorkspaceThreads?: (workspaceId: string) => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onToggleWorkspaceCollapse: (workspaceId: string, collapsed: boolean) => void;
  isExitedSessionsHidden?: (workspacePath: string) => boolean;
  onToggleExitedSessionsHidden?: (workspacePath: string) => void;
  onSelectThread: (workspaceId: string, threadId: string) => void;
  onShowThreadMenu: (
    event: MouseEvent,
    workspaceId: string,
    threadId: string,
    canPin: boolean,
  ) => void;
  deleteConfirmThreadId?: string | null;
  deleteConfirmWorkspaceId?: string | null;
  deleteConfirmBusy?: boolean;
  onCancelDeleteConfirm?: () => void;
  onConfirmDeleteConfirm?: () => void;
  onShowWorktreeMenu: (event: MouseEvent, workspaceId: string) => void;
  onToggleExpanded: (workspaceId: string) => void;
  onLoadOlderThreads: (workspaceId: string) => void;
};

export function WorktreeSection({
  parentWorkspaceId,
  worktrees,
  isSectionCollapsed,
  onToggleSectionCollapse,
  deletingWorktreeIds,
  threadsByWorkspace,
  threadStatusById,
  hydratedThreadListWorkspaceIds,
  threadListLoadingByWorkspace,
  threadListPagingByWorkspace,
  threadListCursorByWorkspace,
  expandedWorkspaces,
  activeWorkspaceId,
  activeThreadId,
  systemProxyEnabled = false,
  systemProxyUrl = null,
  getThreadRows,
  getThreadTime,
  isThreadPinned,
  isThreadAutoNaming,
  onToggleThreadPin,
  getPinTimestamp,
  onConnectWorkspace,
  onShowWorktreeSessionMenu,
  onQuickReloadWorkspaceThreads,
  onSelectWorkspace,
  onToggleWorkspaceCollapse,
  isExitedSessionsHidden = () => false,
  onToggleExitedSessionsHidden = () => undefined,
  onSelectThread,
  onShowThreadMenu,
  deleteConfirmThreadId = null,
  deleteConfirmWorkspaceId = null,
  deleteConfirmBusy = false,
  onCancelDeleteConfirm,
  onConfirmDeleteConfirm,
  onShowWorktreeMenu,
  onToggleExpanded,
  onLoadOlderThreads,
}: WorktreeSectionProps) {
  const hasDegradedThreadList = (threads: ThreadSummary[]) =>
    threads.some((thread) => {
      const partialSource =
        typeof thread.partialSource === "string" ? thread.partialSource.trim() : "";
      return thread.isDegraded || partialSource.length > 0;
    });

  const threadRowsByWorktreeId = useMemo(() => {
    const rowsByWorktreeId = new Map<
      string,
      { unpinnedRows: ThreadRowsResult["unpinnedRows"]; totalRoots: number }
    >();
    if (isSectionCollapsed || worktrees.length === 0) {
      return rowsByWorktreeId;
    }
    worktrees.forEach((worktree) => {
      if (worktree.settings.sidebarCollapsed) {
        rowsByWorktreeId.set(worktree.id, { unpinnedRows: [], totalRoots: 0 });
        return;
      }
      const isWorktreeExpanded = expandedWorkspaces.has(worktree.id);
      const worktreeThreads = threadsByWorkspace[worktree.id] ?? [];
      const { unpinnedRows, totalRoots } = getThreadRows(
        worktreeThreads,
        isWorktreeExpanded,
        worktree.id,
        getPinTimestamp,
      );
      rowsByWorktreeId.set(worktree.id, { unpinnedRows, totalRoots });
    });
    return rowsByWorktreeId;
  }, [
    expandedWorkspaces,
    getPinTimestamp,
    getThreadRows,
    isSectionCollapsed,
    threadsByWorkspace,
    worktrees,
  ]);

  if (!worktrees.length) {
    return null;
  }

  return (
    <div className="worktree-section">
      <button
        type="button"
        className={`worktree-header ${isSectionCollapsed ? "collapsed" : "expanded"}`}
        onDoubleClick={(event) => {
          if (event.button !== 0) {
            return;
          }
          onToggleSectionCollapse(parentWorkspaceId);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggleSectionCollapse(parentWorkspaceId);
          }
        }}
        aria-expanded={!isSectionCollapsed}
        aria-label={isSectionCollapsed ? "Expand worktrees" : "Collapse worktrees"}
      >
        <Layers className="worktree-header-icon" aria-hidden />
        <span className="worktree-header-text">worktrees</span>
        <span className="worktree-header-count" aria-hidden>
          {worktrees.length}
        </span>
        <span className="worktree-header-toggle" aria-hidden>
          ›
        </span>
      </button>
      <div className={`worktree-list ${isSectionCollapsed ? "collapsed" : "expanded"}`}>
        {!isSectionCollapsed &&
          worktrees.map((worktree) => {
            const worktreeThreads = threadsByWorkspace[worktree.id] ?? [];
            const worktreeCollapsed = worktree.settings.sidebarCollapsed;
            const worktreeNextCursor =
              threadListCursorByWorkspace[worktree.id] ?? null;
            const showWorktreeThreadList =
              !worktreeCollapsed &&
              (worktreeThreads.length > 0 || Boolean(worktreeNextCursor));
            const showWorktreeEmptyState =
              !worktreeCollapsed &&
              !showWorktreeThreadList &&
              hydratedThreadListWorkspaceIds.has(worktree.id);
            const isWorktreePaging =
              threadListPagingByWorkspace[worktree.id] ?? false;
            const isThreadListRefreshing = threadListLoadingByWorkspace[worktree.id] ?? false;
            const isWorktreeExpanded = expandedWorkspaces.has(worktree.id);
            const hasPrimaryActiveThread =
              worktree.id === activeWorkspaceId && Boolean(activeThreadId);
            const hasRunningSession = worktreeThreads.some(
              (thread) => Boolean(threadStatusById[thread.id]?.isProcessing),
            );
            const isThreadListDegraded = hasDegradedThreadList(worktreeThreads);
            const threadRows = threadRowsByWorktreeId.get(worktree.id);
            const worktreeThreadRows = threadRows?.unpinnedRows ?? [];
            const totalWorktreeRoots = threadRows?.totalRoots ?? 0;
            const hideExitedSessions = isExitedSessionsHidden(worktree.path);
            const exitedSessionVisibility = getExitedSessionRowVisibility(
              worktreeThreadRows,
              {
                hideExitedSessions,
                isExitedThread: (thread) => {
                  const status = threadStatusById[thread.id];
                  return !status?.isProcessing && !status?.isReviewing;
                },
              },
            );

            return (
              <WorktreeCard
                key={worktree.id}
                worktree={worktree}
                isActive={worktree.id === activeWorkspaceId}
                isThreadListDegraded={isThreadListDegraded}
                isThreadListRefreshing={isThreadListRefreshing}
                hasPrimaryActiveThread={hasPrimaryActiveThread}
                hasRunningSession={hasRunningSession}
                showExitedSessionsToggle={
                  exitedSessionVisibility.hasExitedSessions
                  || exitedSessionVisibility.hiddenExitedCount > 0
                }
                hideExitedSessions={hideExitedSessions}
                hiddenExitedSessionsCount={exitedSessionVisibility.hiddenExitedCount}
                threadCount={totalWorktreeRoots}
                hasThreadCursor={Boolean(worktreeNextCursor)}
                isDeleting={deletingWorktreeIds.has(worktree.id)}
                onShowWorktreeMenu={onShowWorktreeMenu}
                onShowWorktreeSessionMenu={onShowWorktreeSessionMenu}
                onQuickReloadWorkspaceThreads={onQuickReloadWorkspaceThreads}
                onToggleWorkspaceCollapse={onToggleWorkspaceCollapse}
                onConnectWorkspace={onConnectWorkspace}
                onToggleExitedSessions={onToggleExitedSessionsHidden}
                onSelectWorkspace={onSelectWorkspace}
              >
                {showWorktreeThreadList && (
                  <ThreadList
                    workspaceId={worktree.id}
                    pinnedRows={[]}
                    unpinnedRows={worktreeThreadRows}
                    totalThreadRoots={totalWorktreeRoots}
                    isExpanded={isWorktreeExpanded}
                    nextCursor={worktreeNextCursor}
                    isPaging={isWorktreePaging}
                    nested
                    showLoadOlder={false}
                    hideExitedSessions={hideExitedSessions}
                    activeWorkspaceId={activeWorkspaceId}
                    activeThreadId={activeThreadId}
                    systemProxyEnabled={systemProxyEnabled}
                    systemProxyUrl={systemProxyUrl}
                    threadStatusById={threadStatusById}
                    getThreadTime={getThreadTime}
                    isThreadPinned={isThreadPinned}
                    isThreadAutoNaming={isThreadAutoNaming}
                    onToggleThreadPin={onToggleThreadPin}
                    onToggleExpanded={onToggleExpanded}
                    onLoadOlderThreads={onLoadOlderThreads}
                    onSelectThread={onSelectThread}
                    onShowThreadMenu={onShowThreadMenu}
                    deleteConfirmThreadId={deleteConfirmThreadId}
                    deleteConfirmWorkspaceId={deleteConfirmWorkspaceId}
                    deleteConfirmBusy={deleteConfirmBusy}
                    onCancelDeleteConfirm={onCancelDeleteConfirm}
                    onConfirmDeleteConfirm={onConfirmDeleteConfirm}
                  />
                )}
                {showWorktreeEmptyState ? <ThreadEmptyState nested /> : null}
              </WorktreeCard>
            );
          })}
      </div>
    </div>
  );
}
