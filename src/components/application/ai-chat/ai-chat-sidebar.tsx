"use client";

import type { Ref } from "react";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ARCHIVED_SECTION_ID,
  useCollapsedGroups,
  useExpandedWorkspaces,
  useSearchPalette,
  useWorkspaceMenu,
  useBlankMenu,
  useThreadMenu,
} from "@/components/application/ai-chat/use-sidebar-state";
import { ArchivedSection, WorkspaceSection } from "@/components/application/ai-chat/workspace-sections";
import {
  SidebarBrandRow,
  SidebarContextMenus,
  SidebarDragStrip,
  SidebarFooter,
  SidebarPrimaryNav,
} from "@/components/application/ai-chat/sidebar-chrome";
import { SessionSearchPalette } from "@/components/application/ai-chat/session-search-palette";
import type { AiChatRepo, AiChatRepoSection, ThreadAction } from "@/components/application/ai-chat/sidebar-types";
import { cx } from "@/utils/cx";

export type { AiChatRepo, AiChatRepoSection, AiChatThread, ThreadAction } from "@/components/application/ai-chat/sidebar-types";

/**
 * Board UI → "ai_chat" → Sidebar (node 4030:5910, 260×876), adapted to live
 * data: the repositories tree is fed workspaces → sessions, quick actions
 * drive the chat store, and the footer navigates to the app routes. Visual
 * recipe is unchanged from the template. Chrome (drag strip, nav rows,
 * footer, context menus) lives in sidebar-chrome.tsx.
 */

export function AiChatSidebar({
  repos = [],
  sections,
  archivedRepos = [],
  className,
  width = 260,
  rootRef,
  activeThreadId,
  onThreadSelect,
  onNewSessionInWorkspace,
  onNewSession,
  onNewBrowser,
  onOpenPlugins,
  onOpenMission,
  onReorderWorkspaces,
  onThreadAction,
  onCopyThreadId,
  onAddWorkspace,
  onRemoveWorkspace,
  onWorkspaceAlias,
  onSetWorkspaceArchived,
  onNewWorktree,
  onDeleteWorktree,
  onAddWorkspaceRoot,
  onRemoveWorkspaceRoot,
  onDropWorkspaceToSection,
  onCreateGroup,
  onOpenSettings,
  onClose,
  flat = false,
}: {
  repos?: AiChatRepo[];
  /** Grouped repo tree (工作区二级分类); omitted = flat `repos` list. */
  sections?: AiChatRepoSection[];
  /** Archived workspaces for the bottom 已归档 section (labels only). */
  archivedRepos?: AiChatRepo[];
  className?: string;
  /** Sidebar width in px; the parent owns resizing. */
  width?: number;
  /** Ref to the root <aside> so the parent can mutate width mid-drag. */
  rootRef?: Ref<HTMLElement>;
  activeThreadId?: string;
  onThreadSelect?: (id: string) => void;
  onThreadAction?: (id: string, action: ThreadAction) => void;
  /** Thread context-menu action: copy the session id to the clipboard. */
  onCopyThreadId?: (id: string) => void;
  onAddWorkspace?: () => void;
  onRemoveWorkspace?: (id: string) => void;
  /** Workspace context-menu action: open the set-alias dialog for the row. */
  onWorkspaceAlias?: (id: string) => void;
  /** Workspace context-menu action: move the row into / out of 已归档. */
  onSetWorkspaceArchived?: (id: string, archived: boolean) => void;
  /** Workspace context-menu / WORKTREES ＋: open the worktree create dialog. */
  onNewWorktree?: (id: string) => void;
  /** Worktree child-row menu「删除 Worktree…」: open the delete dialog. */
  onDeleteWorktree?: (id: string) => void;
  /** 工作区多目录:「添加目录…」——登记一个附加根(目录选择器)。 */
  onAddWorkspaceRoot?: (id: string) => void;
  /** 工作区多目录:「移除目录…」——移除一个附加根(选择对话框)。 */
  onRemoveWorkspaceRoot?: (id: string) => void;
  /** Per-row + button: start a new chat in that workspace. */
  onNewSessionInWorkspace?: (id: string) => void;
  /** Commit of a drag-handle reorder (ordered workspace ids). */
  onReorderWorkspaces?: (orderedIds: string[]) => void;
  /** Workspace row dropped onto a section container: group id, the archived
   *  sentinel (drop on 已归档), or null (ungrouped). */
  onDropWorkspaceToSection?: (workspaceId: string, targetSectionId: string | null) => void;
  /** Blank-area menu「新建分组」commit: returns a localized validation error
   *  (keeps the composer open), or null when the name was accepted. */
  onCreateGroup?: (name: string) => string | null;
  /** 新建会话 nav entry: start a new chat in the current workspace. */
  onNewSession?: () => void;
  /** 新建浏览器 nav entry (desktop only): open a browser tab. */
  onNewBrowser?: () => void;
  /** 插件 nav entry: open the native plugin hub center tab. */
  onOpenPlugins?: () => void;
  /** 任务工作台入口（原生中心页签；替换原「自动化」占位项）。 */
  onOpenMission?: () => void;
  onOpenSettings?: () => void;
  onClose?: () => void;
  flat?: boolean;
} = {}) {
  const { t } = useTranslation();
  const { searchOpen, openSearch, closeSearch } = useSearchPalette();
  const { collapsedGroups, toggleGroup } = useCollapsedGroups();
  // Worktree 子行也进展开集/搜索面板的数据源：跟着父行扁平化。
  const allRepos = useMemo(() => {
    const topLevel = sections ? sections.flatMap((section) => section.repos) : repos;
    return topLevel.flatMap((repo) => [repo, ...(repo.worktrees ?? [])]);
  }, [sections, repos]);
  const { isRepoExpanded, toggleRepoExpanded } = useExpandedWorkspaces(allRepos, activeThreadId);
  const { workspaceMenu, closeWorkspaceMenu, openWorkspaceMenu, openArchivedMenu } =
    useWorkspaceMenu(
      onWorkspaceAlias,
      onSetWorkspaceArchived,
      onAddWorkspaceRoot,
      onRemoveWorkspaceRoot,
    );
  const { blankMenu, openBlankMenu, closeBlankMenu } = useBlankMenu();
  // Blank-area menu「新建分组」: the inline composer lives at the end of the
  // workspace section until the name commits or the edit is cancelled.
  const [creatingGroup, setCreatingGroup] = useState(false);
  const handleCreateGroupCommit = useCallback(
    (name: string): string | null => {
      const error = onCreateGroup?.(name) ?? null;
      if (!error) setCreatingGroup(false);
      return error;
    },
    [onCreateGroup],
  );
  const { threadMenu, openThreadMenu, closeThreadMenu } = useThreadMenu(
    onThreadAction,
    onCopyThreadId,
  );
  // Mid-drag the sidebar reveals the 已归档 section even when empty so it
  // can accept a dropped workspace row.
  const [workspaceDragging, setWorkspaceDragging] = useState(false);
  const handleDropWorkspaceToSection = useCallback(
    (workspaceId: string, target: string | null) => {
      // Landing in a collapsed group expands it so the moved row is visible.
      if (target && target !== ARCHIVED_SECTION_ID && collapsedGroups.has(target)) {
        toggleGroup(target);
      }
      onDropWorkspaceToSection?.(workspaceId, target);
    },
    [collapsedGroups, toggleGroup, onDropWorkspaceToSection],
  );

  return (
    <aside
      ref={rootRef}
      style={{ width }}
      className={cx(
        "flex h-full shrink-0 flex-col overflow-hidden select-none",
        flat
          ? "bg-background-full"
          : "bg-background-secondary-default",
        className,
      )}
    >
      {!flat && <SidebarDragStrip onClose={onClose} onOpenSearch={openSearch} />}
      <div className="flex min-h-0 w-full flex-1 flex-col gap-3 p-3">
        {flat && <SidebarBrandRow onOpenSearch={openSearch} />}

        <div
          className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain scrollbar-none"
          onContextMenu={onCreateGroup ? openBlankMenu : undefined}
        >
          <SidebarPrimaryNav
            onNewSession={onNewSession}
            onNewBrowser={onNewBrowser}
            onOpenPlugins={onOpenPlugins}
            onOpenMission={onOpenMission}
          />

          <WorkspaceSection
            repos={repos}
            sections={sections}
            collapsedGroups={collapsedGroups}
            isRepoExpanded={isRepoExpanded}
            onToggleRepo={toggleRepoExpanded}
            activeThreadId={activeThreadId}
            onThreadSelect={onThreadSelect}
            onThreadAction={onThreadAction}
            onThreadContextMenu={openThreadMenu}
            onAddWorkspace={onAddWorkspace}
            onRemoveWorkspace={onRemoveWorkspace}
            onNewSessionInWorkspace={onNewSessionInWorkspace}
            onNewWorktree={onNewWorktree}
            onReorderWorkspaces={onReorderWorkspaces}
            onToggleGroup={toggleGroup}
            onRepoContextMenu={openWorkspaceMenu}
            onWorkspaceDragActiveChange={setWorkspaceDragging}
            onDropWorkspaceToSection={handleDropWorkspaceToSection}
            creatingGroup={creatingGroup}
            onCreateGroup={onCreateGroup && handleCreateGroupCommit}
            onCreateGroupCancel={() => setCreatingGroup(false)}
          />
          {(archivedRepos.length > 0 || workspaceDragging) && (
            <ArchivedSection
              repos={archivedRepos}
              collapsed={collapsedGroups.has(ARCHIVED_SECTION_ID)}
              onToggle={() => toggleGroup(ARCHIVED_SECTION_ID)}
              onRepoContextMenu={openArchivedMenu}
            />
          )}
          {allRepos.length === 0 && (
            <p className="px-2 text-body-regular text-text-tertiary">{t("chat.noSessions")}</p>
          )}
        </div>
      </div>

      <SidebarFooter onOpenSettings={onOpenSettings} />

      <SessionSearchPalette
        open={searchOpen}
        repos={allRepos}
        onClose={closeSearch}
        onThreadSelect={onThreadSelect}
      />

      <SidebarContextMenus
        workspaceMenu={workspaceMenu}
        threadMenu={threadMenu}
        blankMenu={blankMenu}
        onCloseWorkspaceMenu={closeWorkspaceMenu}
        onCloseThreadMenu={closeThreadMenu}
        onCloseBlankMenu={closeBlankMenu}
        onCreateGroup={onCreateGroup ? () => setCreatingGroup(true) : undefined}
        onWorkspaceAlias={onWorkspaceAlias}
        onSetWorkspaceArchived={onSetWorkspaceArchived}
        onNewWorktree={onNewWorktree}
        onDeleteWorktree={onDeleteWorktree}
        onAddWorkspaceRoot={onAddWorkspaceRoot}
        onRemoveWorkspaceRoot={onRemoveWorkspaceRoot}
        onThreadAction={onThreadAction}
        onCopyThreadId={onCopyThreadId}
      />
    </aside>
  );
}
