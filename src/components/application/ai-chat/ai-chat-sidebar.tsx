"use client";

import type { ComponentType, Ref, RefObject } from "react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import MessageSquarePlus from "lucide-react/dist/esm/icons/message-square-plus";
import PanelLeft from "lucide-react/dist/esm/icons/panel-left";
import ScanSearch from "lucide-react/dist/esm/icons/scan-search";
import Settings from "lucide-react/dist/esm/icons/settings";
import { CloseButton } from "@/components/base/buttons/close-button";
import {
  WorkspaceContextMenu,
} from "@/components/application/ai-chat/workspace-context-menu";
import {
  ARCHIVED_SECTION_ID,
  useCollapsedGroups,
  useExpandedWorkspaces,
  useFilteredWorkspaces,
  useSidebarSearch,
  useWorkspaceMenu,
} from "@/components/application/ai-chat/use-sidebar-state";
import { ArchivedSection, WorkspaceSection } from "@/components/application/ai-chat/workspace-sections";
import type { AiChatRepo, AiChatRepoSection, ThreadAction } from "@/components/application/ai-chat/sidebar-types";
import { cx } from "@/utils/cx";
import { useRemoteControl } from "@/hooks/use-remote-control";

export type { AiChatRepo, AiChatRepoSection, AiChatThread, ThreadAction } from "@/components/application/ai-chat/sidebar-types";

/**
 * Board UI → "ai_chat" → Sidebar (node 4030:5910, 260×876), adapted to live
 * data: the repositories tree is fed workspaces → sessions, quick actions
 * drive the chat store, and the footer navigates to the app routes. Visual
 * recipe is unchanged from the template.
 */

type IconComponent = ComponentType<{
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
}>;

/** Shared look for the icon buttons in the window drag strip. */
const headerButtonClasses = cx(
  "flex size-7 cursor-pointer items-center justify-center rounded-lg transition-colors duration-150",
  "text-foreground-icon-secondary hover:bg-background-secondary-hover hover:text-foreground-icon-primary",
);

/** Top-level nav row — icon + label, p 8, radius/2lg. */
function NavItem({
  icon: Icon,
  label,
  onClick,
}: {
  icon: IconComponent;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cx(
        "flex w-full cursor-pointer items-center gap-2 rounded-2lg p-2 transition-colors duration-150 ease",
        "hover:bg-background-secondary-hover",
      )}
    >
      <Icon className="size-4 shrink-0 text-foreground-icon-secondary" aria-hidden />
      <span className="text-body-2-medium whitespace-nowrap text-text-secondary">{label}</span>
    </button>
  );
}

/** The active quick-search row: filter field replacing the "Search" nav
 *  item, ⌘L-focusable, Escape exits. */
function SearchField({
  query,
  onQueryChange,
  onDeactivate,
  inputRef,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  onDeactivate: () => void;
  inputRef: RefObject<HTMLInputElement>;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex w-full items-center gap-2 rounded-2lg bg-background-tertiary-default p-2 ring-2 ring-inset ring-border-focus-ring">
      <ScanSearch className="size-4 shrink-0 text-foreground-icon-secondary" aria-hidden />
      <input
        ref={inputRef}
        type="search"
        aria-label={t("chat.searchSessions")}
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onDeactivate();
          }
        }}
        placeholder={t("chat.searchSessions")}
        className="min-w-0 flex-1 bg-transparent text-body-2-medium text-text-primary outline-none placeholder:text-text-tertiary"
      />
      <CloseButton
        size="xs"
        aria-label={t("common.close")}
        onClick={onDeactivate}
      />
    </div>
  );
}

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
  onReorderWorkspaces,
  onThreadAction,
  onAddWorkspace,
  onRemoveWorkspace,
  onWorkspaceAlias,
  onSetWorkspaceArchived,
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
  onAddWorkspace?: () => void;
  onRemoveWorkspace?: (id: string) => void;
  /** Workspace context-menu action: open the set-alias dialog for the row. */
  onWorkspaceAlias?: (id: string) => void;
  /** Workspace context-menu action: move the row into / out of 已归档. */
  onSetWorkspaceArchived?: (id: string, archived: boolean) => void;
  /** Per-row + button: start a new chat in that workspace. */
  onNewSessionInWorkspace?: (id: string) => void;
  /** Commit of a drag-handle reorder (ordered workspace ids). */
  onReorderWorkspaces?: (orderedIds: string[]) => void;
  /** 新建会话 nav entry: start a new chat in the current workspace. */
  onNewSession?: () => void;
  onOpenSettings?: () => void;
  onClose?: () => void;
  flat?: boolean;
} = {}) {
  const { t } = useTranslation();
  const {
    searchActive,
    query,
    setQuery,
    normalizedQuery,
    searchInputRef,
    activateSearch,
    deactivateSearch,
  } = useSidebarSearch();
  const { collapsedGroups, toggleGroup } = useCollapsedGroups();
  const remoteActive = useRemoteControl();
  const allRepos = useMemo(
    () => (sections ? sections.flatMap((section) => section.repos) : repos),
    [sections, repos],
  );
  const { isRepoExpanded, toggleRepoExpanded } = useExpandedWorkspaces(allRepos);
  const { workspaceMenu, closeWorkspaceMenu, openWorkspaceMenu, openArchivedMenu } =
    useWorkspaceMenu(onWorkspaceAlias, onSetWorkspaceArchived);
  const { filteredRepos, filteredSections, filteredArchivedRepos } = useFilteredWorkspaces(
    repos,
    sections,
    archivedRepos,
    normalizedQuery,
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
      {/* Window drag strip reaching the overlay titlebar: macOS traffic
          lights float over its left edge, action icons pin right. */}
      {!flat && (
        <div
          data-tauri-drag-region
          className="flex h-10 w-full shrink-0 items-center justify-end gap-1 border-b border-separator-border px-3"
        >
          <button
            type="button"
            aria-label={t("chat.collapseSidebar")}
            title={t("chat.collapseSidebar")}
            onClick={onClose}
            className={headerButtonClasses}
          >
            <PanelLeft className="size-4 -scale-x-100" aria-hidden />
          </button>
        </div>
      )}
      <div className="flex min-h-0 w-full flex-1 flex-col gap-3 p-3">
        {/* App identity (flat/embedded variant only) */}
        {flat && (
          <div className="flex w-full flex-row items-center justify-between">
            <span className="flex items-center gap-2 px-1">
              <img src="/app-icon.png" alt="CC GUI" className="size-7 rounded-lg" />
              <span className="text-headline-medium text-text-primary">CC GUI</span>
            </span>
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto scrollbar-none">
          {/* Primary actions */}
          <nav className="flex w-full shrink-0 flex-col gap-1">
            {searchActive ? (
              <SearchField
                query={query}
                onQueryChange={setQuery}
                onDeactivate={deactivateSearch}
                inputRef={searchInputRef}
              />
            ) : (
              <NavItem icon={ScanSearch} label={t("common.search")} onClick={activateSearch} />
            )}
            <NavItem icon={MessageSquarePlus} label={t("chat.newSession")} onClick={onNewSession} />
          </nav>

          <WorkspaceSection
            filteredRepos={filteredRepos}
            sections={filteredSections}
            searching={Boolean(normalizedQuery)}
            collapsedGroups={collapsedGroups}
            isRepoExpanded={isRepoExpanded}
            onToggleRepo={toggleRepoExpanded}
            activeThreadId={activeThreadId}
            onThreadSelect={onThreadSelect}
            onThreadAction={onThreadAction}
            onAddWorkspace={onAddWorkspace}
            onRemoveWorkspace={onRemoveWorkspace}
            onNewSessionInWorkspace={onNewSessionInWorkspace}
            onReorderWorkspaces={onReorderWorkspaces}
            onToggleGroup={toggleGroup}
            onRepoContextMenu={openWorkspaceMenu}
          />
          {filteredArchivedRepos.length > 0 && (
            <ArchivedSection
              repos={filteredArchivedRepos}
              searching={Boolean(normalizedQuery)}
              collapsed={collapsedGroups.has(ARCHIVED_SECTION_ID)}
              onToggle={() => toggleGroup(ARCHIVED_SECTION_ID)}
              onRepoContextMenu={openArchivedMenu}
            />
          )}
          {filteredRepos.length === 0 && (
            <p className="px-2 text-body-regular text-text-tertiary">{t("chat.noSessions")}</p>
          )}
        </div>
      </div>

      <div className="flex w-full shrink-0 flex-col gap-3 px-3 pb-3">
        {/* Secondary nav */}
        <div className="relative flex w-full items-center">
          <nav className="flex w-full flex-col gap-1">
            <NavItem icon={Settings} label={t("settings.title")} onClick={onOpenSettings} />
          </nav>
          {remoteActive && (
            // Floating, not laid out: it covers the empty half of the row
            // (设置 keeps its full width and hover) and lets clicks through.
            <div
              title={t("settings.webRemoteActive")}
              className="pointer-events-none absolute right-0 top-1/2 flex -translate-y-1/2 items-center gap-1.5 rounded-full bg-button-primary px-2.5 py-1 shadow-xs"
            >
              <span aria-hidden className="size-1.5 animate-pulse rounded-full bg-text-white" />
              <span className="text-body-2-medium whitespace-nowrap text-text-white">
                {t("settings.webRemoteActive")}
              </span>
            </div>
          )}
        </div>
      </div>

      {workspaceMenu && (onWorkspaceAlias || onSetWorkspaceArchived) && (
        <WorkspaceContextMenu
          menu={workspaceMenu}
          onClose={closeWorkspaceMenu}
          onSetAlias={onWorkspaceAlias}
          onSetArchived={onSetWorkspaceArchived}
        />
      )}
    </aside>
  );
}
