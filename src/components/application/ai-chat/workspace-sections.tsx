"use client";

import type { MouseEvent as ReactMouseEvent } from "react";
import { useTranslation } from "react-i18next";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import FolderPlus from "lucide-react/dist/esm/icons/folder-plus";
import FolderSymlink from "lucide-react/dist/esm/icons/folder-symlink";
import {
  WORKSPACE_DROP_TARGET_ATTR,
  WorkspaceSortableList,
} from "@/components/application/ai-chat/workspace-sortable-list";
import { ARCHIVED_SECTION_ID } from "@/components/application/ai-chat/use-sidebar-state";
import { RepoItem } from "@/components/application/ai-chat/repo-tree";
import type { AiChatRepo, AiChatRepoSection, ThreadAction } from "@/components/application/ai-chat/sidebar-types";
import { cx } from "@/utils/cx";

/** Drop-target container chrome: the drag layer marks the hovered section
 *  with data-drop-hover; group/ungrouped/已归档 all share the look. */
const dropTargetClasses = cx(
  "flex w-full flex-col rounded-2lg transition-colors duration-150",
  "data-[drop-hover=true]:bg-background-secondary-hover data-[drop-hover=true]:ring-1 data-[drop-hover=true]:ring-border-button-active",
);

/** Workspace group header (› name): click toggles the group's
 *  repo list; collapsed state is owned (and persisted) by the sidebar. */
function GroupHeaderRow({
  name,
  collapsed,
  onToggle,
}: {
  name: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-expanded={!collapsed}
      onClick={onToggle}
      className="flex w-full cursor-pointer items-center gap-1 rounded-2lg px-1 py-[5px] transition-colors duration-150 ease hover:bg-background-secondary-hover"
    >
      <ChevronRight
        className={cx(
          "size-3.5 shrink-0 text-foreground-icon-secondary transition-transform duration-150",
          !collapsed && "rotate-90",
        )}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate text-left text-caption-1-medium text-text-tertiary">
        {name}
      </span>
    </button>
  );
}

/** A grayed, non-expandable archived workspace row: right-click is the only
 *  interaction (unarchive / set alias via the shared workspace menu). */
function ArchivedRepoRow({
  repo,
  onContextMenu,
}: {
  repo: AiChatRepo;
  onContextMenu?: (event: ReactMouseEvent<HTMLElement>) => void;
}) {
  return (
    <div
      onContextMenu={onContextMenu}
      className="flex w-full cursor-default items-center gap-2 rounded-2lg p-2 transition-colors duration-150 ease hover:bg-background-secondary-hover"
    >
      <span className="flex size-6 shrink-0 items-center justify-center" aria-hidden>
        <FolderSymlink className="size-4 text-foreground-icon-tertiary" />
      </span>
      <span
        title={repo.originalLabel}
        className="min-w-0 flex-1 truncate text-body-2-medium whitespace-nowrap text-text-tertiary"
      >
        {repo.label}
      </span>
    </div>
  );
}

/** 已归档 section at the bottom of the workspace tree: collapsible like a
 *  group header (same persisted collapse set), rows are plain grayed labels. */
export function ArchivedSection({
  repos,
  searching,
  collapsed,
  onToggle,
  onRepoContextMenu,
}: {
  repos: AiChatRepo[];
  searching: boolean;
  collapsed: boolean;
  onToggle: () => void;
  onRepoContextMenu?: (event: ReactMouseEvent<HTMLElement>, workspaceId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div {...{ [WORKSPACE_DROP_TARGET_ATTR]: ARCHIVED_SECTION_ID }} className={dropTargetClasses}>
      <GroupHeaderRow
        name={t("chat.archivedWorkspaces", { count: repos.length })}
        collapsed={!searching && collapsed}
        onToggle={onToggle}
      />
      {(searching || !collapsed) && (
        <div className="flex w-full flex-col gap-1">
          {repos.map((repo) => (
            <ArchivedRepoRow
              key={repo.id ?? repo.label}
              repo={repo}
              onContextMenu={
                onRepoContextMenu && repo.id
                  ? (event) => onRepoContextMenu(event, repo.id!)
                  : undefined
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Workspaces section: header with the add button + the sortable repo tree.
 *  With workspace groups configured, repos render under collapsible group
 *  headers (工作区二级分类); otherwise the flat list renders unchanged. */
export function WorkspaceSection({
  filteredRepos,
  sections,
  searching,
  collapsedGroups,
  isRepoExpanded,
  onToggleRepo,
  activeThreadId,
  onThreadSelect,
  onThreadAction,
  onThreadContextMenu,
  onAddWorkspace,
  onRemoveWorkspace,
  onNewSessionInWorkspace,
  onReorderWorkspaces,
  onToggleGroup,
  onRepoContextMenu,
  workspaceDragging = false,
  onWorkspaceDragActiveChange,
  onDropWorkspaceToSection,
}: {
  filteredRepos: AiChatRepo[];
  /** Grouped repo tree; absent/empty = legacy flat list. */
  sections?: AiChatRepoSection[];
  searching: boolean;
  collapsedGroups: Set<string>;
  /** Sidebar-owned so expansion survives restarts. */
  isRepoExpanded: (repo: AiChatRepo) => boolean;
  onToggleRepo: (repo: AiChatRepo) => void;
  activeThreadId?: string;
  onThreadSelect?: (id: string) => void;
  onThreadAction?: (id: string, action: ThreadAction) => void;
  /** Right-click on a thread row (thread context menu). */
  onThreadContextMenu?: (event: ReactMouseEvent<HTMLElement>, threadId: string) => void;
  onAddWorkspace?: () => void;
  onRemoveWorkspace?: (id: string) => void;
  onNewSessionInWorkspace?: (id: string) => void;
  onReorderWorkspaces?: (orderedIds: string[]) => void;
  onToggleGroup?: (groupId: string) => void;
  /** Right-click on a repo header row (workspace context menu). */
  onRepoContextMenu?: (event: ReactMouseEvent<HTMLElement>, workspaceId: string) => void;
  /** A workspace drag is in flight: empty groups render as drop targets. */
  workspaceDragging?: boolean;
  onWorkspaceDragActiveChange?: (active: boolean) => void;
  /** Drop of a workspace row onto a section container (group id, the
   *  archived sentinel, or null = ungrouped). */
  onDropWorkspaceToSection?: (workspaceId: string, targetSectionId: string | null) => void;
}) {
  const { t } = useTranslation();
  const hasGroups = Boolean(sections?.some((section) => section.id !== null));

  const renderRepoList = (repos: AiChatRepo[], sectionId: string | null) =>
    repos.length > 0 && (
      <WorkspaceSortableList
        items={repos}
        sectionId={sectionId}
        disabled={searching}
        onDropToSection={onDropWorkspaceToSection}
        onDragActiveChange={onWorkspaceDragActiveChange}
        onReorder={
          onReorderWorkspaces
            ? (orderedIds) => {
                // Rebuild the global order: other sections keep theirs, the
                // dragged section takes the new one.
                const all = (sections ?? [{ id: null, name: "", repos: filteredRepos }]).flatMap(
                  (section) =>
                    section.id === sectionId
                      ? orderedIds
                      : section.repos.map((repo) => repo.id),
                );
                onReorderWorkspaces(all.filter((id): id is string => Boolean(id)));
              }
            : undefined
        }
        className="flex w-full flex-col gap-1"
        renderItem={(repo, drag) => (
          <RepoItem
            repo={repo}
            open={isRepoExpanded(repo)}
            onToggleOpen={() => onToggleRepo(repo)}
            forceOpen={searching}
            activeThreadId={activeThreadId}
            onThreadSelect={onThreadSelect}
            onThreadAction={onThreadAction}
            onThreadContextMenu={onThreadContextMenu}
            onRemove={onRemoveWorkspace}
            onNewSession={onNewSessionInWorkspace}
            onContextMenu={
              onRepoContextMenu && repo.id
                ? (event) => onRepoContextMenu(event, repo.id!)
                : undefined
            }
            isDragging={drag?.isDragging ?? false}
            dragHandleProps={drag?.dragHandleProps ?? null}
          />
        )}
      />
    );

  return (
    <div className="flex w-full flex-col gap-2.5">
      <div
        {...{ [WORKSPACE_DROP_TARGET_ATTR]: "" }}
        className="flex w-full items-center justify-between rounded-2lg transition-colors duration-150 data-[drop-hover=true]:bg-background-secondary-hover data-[drop-hover=true]:ring-1 data-[drop-hover=true]:ring-border-button-active"
      >
        <span className="text-body-2-medium text-text-secondary">
          {t("chat.workspaces")}
        </span>
        <button
          type="button"
          aria-label={t("chat.addWorkspace")}
          title={t("chat.addWorkspace")}
          onClick={onAddWorkspace}
          className="flex size-7 cursor-pointer items-center justify-center rounded-full text-foreground-icon-secondary transition-colors duration-150 hover:bg-background-tertiary-hover/55 hover:text-foreground-icon-primary"
        >
          <FolderPlus className="size-4" aria-hidden />
        </button>
      </div>
      {!hasGroups && renderRepoList(filteredRepos, null)}
      {hasGroups &&
        sections!.map((section) =>
          section.id === null ? (
            <div key="ungrouped" {...{ [WORKSPACE_DROP_TARGET_ATTR]: "" }} className={dropTargetClasses}>
              {renderRepoList(section.repos, null)}
            </div>
          ) : (
            // Empty groups hide at rest (matches the reference sidebar) but
            // stay mounted mid-drag so they can accept a dropped row.
            (section.repos.length > 0 || workspaceDragging) && (
              <div key={section.id} {...{ [WORKSPACE_DROP_TARGET_ATTR]: section.id }} className={dropTargetClasses}>
                <GroupHeaderRow
                  name={section.name}
                  collapsed={!searching && collapsedGroups.has(section.id)}
                  onToggle={() => onToggleGroup?.(section.id!)}
                />
                {(searching || !collapsedGroups.has(section.id)) &&
                  renderRepoList(section.repos, section.id)}
              </div>
            )
          ),
        )}
    </div>
  );
}
