"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import Globe from "lucide-react/dist/esm/icons/globe";
import LayoutGrid from "lucide-react/dist/esm/icons/layout-grid";
import MessageSquarePlus from "lucide-react/dist/esm/icons/message-square-plus";
import PanelLeft from "lucide-react/dist/esm/icons/panel-left";
import ScanSearch from "lucide-react/dist/esm/icons/scan-search";
import Settings from "lucide-react/dist/esm/icons/settings";
import Workflow from "lucide-react/dist/esm/icons/workflow";
import { Focusable } from "react-aria-components";
import { Tooltip, TooltipContent } from "@/components/base/tooltip/tooltip";
import {
  WorkspaceBlankContextMenu,
  WorkspaceContextMenu,
  type BlankMenuState,
  type WorkspaceMenuState,
} from "@/components/application/ai-chat/workspace-context-menu";
import {
  ThreadContextMenu,
  type ThreadMenuState,
} from "@/components/application/ai-chat/thread-context-menu";
import type { ThreadAction } from "@/components/application/ai-chat/sidebar-types";
import { cx } from "@/utils/cx";
import { needsWindowControls, useTitlebarStyle } from "@/features/settings/titlebar";
import { WindowControls } from "@/components/application/window-controls";
import { useRemoteControl } from "@/hooks/use-remote-control";
import { compareByOrder, sidebarNavRegistry, useRegistry } from "@ccgui/plugin-sdk";

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

/** Grayed-out nav entry for a feature that is not available yet: hover shows
 *  the tip after the usual delay, click pins it open (same pin/unpin rules as
 *  InfoTip: outside press, Escape, scroll, or a second click closes it). The
 *  button stays enabled so the tip stays reachable; `aria-disabled` carries
 *  the unavailable state. */
export function DisabledNavItem({
  icon: Icon,
  label,
  tip,
}: {
  icon: IconComponent;
  label: string;
  tip: string;
}) {
  const [hoverOpen, setHoverOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!pinned) return;
    const onPointerDown = (e: PointerEvent) => {
      if (triggerRef.current?.contains(e.target as Node)) return;
      setPinned(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPinned(false);
    };
    const onScroll = () => setPinned(false);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [pinned]);

  return (
    <Tooltip isOpen={pinned || hoverOpen} onOpenChange={setHoverOpen}>
      <Focusable>
        <button
          ref={triggerRef}
          type="button"
          aria-label={label}
          aria-disabled
          onClick={() => setPinned((p) => !p)}
          className="flex w-full cursor-not-allowed items-center gap-2 rounded-2lg p-2 opacity-40"
        >
          <Icon className="size-4 shrink-0 text-foreground-icon-secondary" aria-hidden />
          <span className="text-body-2-medium whitespace-nowrap text-text-secondary">{label}</span>
        </button>
      </Focusable>
      <TooltipContent placement="right">{tip}</TooltipContent>
    </Tooltip>
  );
}

/** Icon button opening the session search palette (⌘L); shared by the drag
 *  strip and the flat variant's brand row. */
function SearchPaletteButton({ onOpen }: { onOpen?: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      aria-label={t("chat.searchSessions")}
      title={t("chat.searchSessions")}
      onClick={onOpen}
      className={headerButtonClasses}
    >
      <ScanSearch className="size-4" aria-hidden />
    </button>
  );
}

/** Window drag strip reaching the overlay titlebar: macOS traffic lights
 *  float over its left edge, action icons pin right. "deep" lets the container wrappers
 *  (icon gaps) drag/zoom too; the icon buttons stay clickable. Windows
 *  仿 mac 模式在这里放自绘三色按钮。 */
export function SidebarDragStrip({
  onClose,
  onOpenSearch,
}: {
  onClose?: () => void;
  onOpenSearch?: () => void;
}) {
  const { t } = useTranslation();
  const titlebarStyle = useTitlebarStyle();
  return (
    <div
      data-tauri-drag-region="deep"
      className="flex h-10 w-full shrink-0 items-center justify-between gap-1 border-b border-separator-border px-3"
    >
      <div className="flex min-w-0 items-center">
        {needsWindowControls(titlebarStyle) && <WindowControls />}
      </div>
      <div className="flex items-center gap-1">
        <SearchPaletteButton onOpen={onOpenSearch} />
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
    </div>
  );
}

/** App identity row (flat/embedded variant only). */
export function SidebarBrandRow({ onOpenSearch }: { onOpenSearch?: () => void }) {
  return (
    <div className="flex w-full flex-row items-center justify-between">
      <span className="flex items-center gap-2 px-1">
        <img src="/app-icon.png" alt="CC GUI" className="size-7 rounded-lg" />
        <span className="text-headline-medium text-text-primary">CC GUI</span>
      </span>
      <SearchPaletteButton onOpen={onOpenSearch} />
    </div>
  );
}

/** Primary actions: 新建会话/插件/浏览器/任务工作台 (会话搜索在顶栏图标 + ⌘L 弹窗),
 *  其后是插件注册的导航项（SDK 0.3.12 ui:sidebar-entry）。 */
export function SidebarPrimaryNav({
  onNewSession,
  onNewBrowser,
  onOpenPlugins,
  onOpenMission,
}: {
  onNewSession?: () => void;
  onNewBrowser?: () => void;
  onOpenPlugins?: () => void;
  onOpenMission?: () => void;
}) {
  const { t } = useTranslation();
  const pluginEntries = [...useRegistry(sidebarNavRegistry)].sort(compareByOrder);
  return (
    <nav className="flex w-full shrink-0 flex-col gap-1">
      <NavItem icon={MessageSquarePlus} label={t("chat.newSession")} onClick={onNewSession} />
      <NavItem icon={LayoutGrid} label={t("plugins.hub.title")} onClick={onOpenPlugins} />
      {onNewBrowser && (
        <NavItem icon={Globe} label={t("chat.newBrowser")} onClick={onNewBrowser} />
      )}
      {onOpenMission && (
        <NavItem icon={Workflow} label={t("mission.title")} onClick={onOpenMission} />
      )}
      {pluginEntries.map((entry) => (
        <NavItem
          key={entry.id}
          icon={(entry.icon ?? LayoutGrid) as IconComponent}
          label={entry.label()}
          onClick={entry.onOpen}
        />
      ))}
    </nav>
  );
}

/** Secondary nav (设置) with the floating web-remote badge. The badge is
 *  floating, not laid out: it covers the empty half of the row (设置 keeps
 *  its full width and hover) and lets clicks through. */
export function SidebarFooter({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const { t } = useTranslation();
  const remoteActive = useRemoteControl();
  return (
    <div className="flex w-full shrink-0 flex-col gap-3 px-3 pb-3">
      <div className="relative flex w-full items-center">
        <nav className="flex w-full flex-col gap-1">
          <NavItem icon={Settings} label={t("settings.title")} onClick={onOpenSettings} />
        </nav>
        {remoteActive && (
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
  );
}

/** Workspace, thread, and blank-area right-click menus; each mounts only
 *  while its state is open and at least one entry has a handler. */
export function SidebarContextMenus({
  workspaceMenu,
  threadMenu,
  blankMenu,
  onCloseWorkspaceMenu,
  onCloseThreadMenu,
  onCloseBlankMenu,
  onWorkspaceAlias,
  onSetWorkspaceArchived,
  onNewWorktree,
  onDeleteWorktree,
  onCreateGroup,
  onThreadAction,
  onCopyThreadId,
}: {
  workspaceMenu: WorkspaceMenuState | null;
  threadMenu: ThreadMenuState | null;
  blankMenu: BlankMenuState | null;
  onCloseWorkspaceMenu: () => void;
  onCloseThreadMenu: () => void;
  onCloseBlankMenu: () => void;
  onWorkspaceAlias?: (id: string) => void;
  onSetWorkspaceArchived?: (id: string, archived: boolean) => void;
  /** 工作区菜单「新建 Worktree…」：目标行是普通工作区或 worktree 子行均可。 */
  onNewWorktree?: (workspaceId: string) => void;
  /** worktree 子行菜单「删除 Worktree…」。 */
  onDeleteWorktree?: (workspaceId: string) => void;
  onCreateGroup?: () => void;
  onThreadAction?: (id: string, action: ThreadAction) => void;
  onCopyThreadId?: (id: string) => void;
}) {
  return (
    <>
      {/* The opener already decided the menu has entries (builtin or
          registered), and WorkspaceContextMenu renders null once it has none —
          so a plugin-only menu must not be gated on host handlers here. */}
      {workspaceMenu && (
        <WorkspaceContextMenu
          menu={workspaceMenu}
          onClose={onCloseWorkspaceMenu}
          onSetAlias={onWorkspaceAlias}
          onSetArchived={onSetWorkspaceArchived}
          onNewWorktree={onNewWorktree}
          onDeleteWorktree={onDeleteWorktree}
        />
      )}
      {blankMenu && onCreateGroup && (
        <WorkspaceBlankContextMenu
          menu={blankMenu}
          onClose={onCloseBlankMenu}
          onCreateGroup={onCreateGroup}
        />
      )}
      {threadMenu && (onThreadAction || onCopyThreadId) && (
        <ThreadContextMenu
          menu={threadMenu}
          onClose={onCloseThreadMenu}
          onThreadAction={onThreadAction}
          onCopyId={onCopyThreadId}
        />
      )}
    </>
  );
}
