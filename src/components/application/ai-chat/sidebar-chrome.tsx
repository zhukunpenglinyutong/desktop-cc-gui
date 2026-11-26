"use client";

import { useEffect, useId, useMemo, useRef, useState, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
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

import { SidebarDisclosure } from "./repo-tree";
import { WorkspaceSortableList, type RepoDragChrome } from "./workspace-sortable-list";
import { orderByStoredKeys } from "@/lib/cli-nav-order";
import { writeStored } from "@/lib/storage";
import {
  SIDEBAR_PLUGIN_ORDER_KEY,
  SIDEBAR_PLUGIN_EXPANDED_KEY,
  readSidebarPluginOrder,
  readSidebarPluginsExpanded,
  mergeSidebarPluginOrder,
} from "@/lib/sidebar-plugin-nav";

type IconComponent = ComponentType<{
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
}>;

/** Shared look for the icon buttons in the window drag strip. */
const headerButtonClasses = cx(
  "flex size-7 cursor-pointer items-center justify-center rounded-lg transition-colors duration-150",
  "text-foreground-icon-secondary hover:bg-background-secondary-hover hover:text-foreground-icon-primary",
);

/** Top-level nav row — icon + label, p 8, radius/2lg. `badge` (SDK 0.3.22)
 *  is the plugin's optional trailing count; absent = no extra DOM. */
function NavItem({
  icon: Icon,
  label,
  badge,
  onClick,
  drag,
  dragLabel,
}: {
  icon: IconComponent;
  label: string;
  badge?: string | null;
  onClick?: () => void;
  drag?: RepoDragChrome | null;
  dragLabel?: string;
}) {
  const rowClass = cx(
    "flex w-full cursor-pointer items-center gap-2 rounded-2lg p-2 transition-colors duration-150 ease",
    "hover:bg-background-secondary-hover",
  );
  const labelContent = (
    <>
      <span className="text-body-2-medium whitespace-nowrap text-text-secondary">{label}</span>
      {badge != null && (
        <span className="ml-auto shrink-0 rounded-full bg-background-tertiary-default px-1.5 py-px text-caption-2-medium text-text-tertiary">
          {badge}
        </span>
      )}
    </>
  );
  if (drag?.dragHandleProps) {
    return (
      <div className={rowClass}>
        <button
          type="button"
          aria-label={dragLabel}
          title={dragLabel}
          {...drag.dragHandleProps}
          onClick={(event) => event.stopPropagation()}
          className="shrink-0 cursor-grab touch-none rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring"
        >
          <Icon className="size-4 text-foreground-icon-secondary" aria-hidden />
        </button>
        <button
          type="button"
          aria-label={badge != null ? `${label} (${badge})` : label}
          onClick={onClick}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring"
        >{labelContent}</button>
      </div>
    );
  }
  return (
    <button
      type="button"
      aria-label={badge != null ? `${label} (${badge})` : label}
      onClick={onClick}
      className={rowClass}
    >
      <Icon className="size-4 shrink-0 text-foreground-icon-secondary" aria-hidden />
      {labelContent}
    </button>
  );
}

/** 插件导航项末尾的计数：每次渲染求值；抛错或空串按「无徽标」，一个插件的
 *  坏状态不能连带整条侧栏（context 侧已包 runAsPlugin，这里兜底直连注册表
 *  的宿主/插件写入）。 */
function sidebarNavLabel(entry: { id: string; label: () => string }): string {
  try {
    return entry.label();
  } catch {
    return entry.id;
  }
}

function sidebarNavBadge(entry: { badge?: () => string | number | null }): string | null {
  try {
    const value = entry.badge?.();
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    return text === "" ? null : text;
  } catch {
    return null;
  }
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

/** 两个及以上插件入口收进插件中心下方；零个或一个时维持原布局。 */
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
  const entries = useRegistry(sidebarNavRegistry);
  const [pluginOrder, setPluginOrder] = useState(readSidebarPluginOrder);
  const [pluginsExpanded, setPluginsExpanded] = useState(readSidebarPluginsExpanded);
  const pluginEntries = useMemo(() => orderByStoredKeys(
    [...entries].sort(compareByOrder).map((entry) => ({ ...entry, key: entry.id })),
    pluginOrder,
  ), [entries, pluginOrder]);
  const collapsible = pluginEntries.length > 1;
  const expanded = !collapsible || pluginsExpanded;
  const listId = useId();
  // 注册表增减或折叠时终止在途拖拽，不能提交已经失效的预览顺序。
  const listKey = JSON.stringify([expanded, entries.map((entry) => entry.id).sort()]);
  const pluginList = (
      <div id={listId}>
        <SidebarDisclosure expanded={expanded} keepMounted>
          <WorkspaceSortableList
            key={listKey}
            items={pluginEntries}
            className="flex flex-col gap-1"
            onReorder={(keys) => {
              const next = mergeSidebarPluginOrder(pluginOrder, keys);
              setPluginOrder(next);
              writeStored(SIDEBAR_PLUGIN_ORDER_KEY, JSON.stringify(next));
            }}
            renderItem={(entry, drag) => (
              <NavItem
                icon={(entry.icon ?? LayoutGrid) as IconComponent}
                label={sidebarNavLabel(entry)}
                badge={sidebarNavBadge(entry)}
                onClick={entry.onOpen}
                drag={drag}
                dragLabel={t("plugins.hub.dragEntry", { name: sidebarNavLabel(entry) })}
              />
            )}
          />
        </SidebarDisclosure>
      </div>
  );
  return (
    <nav className="flex w-full shrink-0 flex-col gap-1">
      <NavItem icon={MessageSquarePlus} label={t("chat.newSession")} onClick={onNewSession} />
      <div className="flex items-center">
        <NavItem icon={LayoutGrid} label={t("plugins.hub.title")} onClick={onOpenPlugins} />
        {collapsible && (
          <button
            type="button"
            aria-label={t(expanded ? "plugins.hub.collapseEntries" : "plugins.hub.expandEntries")}
            aria-expanded={expanded}
            aria-controls={listId}
            onClick={() => {
              setPluginsExpanded(!expanded);
              writeStored(SIDEBAR_PLUGIN_EXPANDED_KEY, JSON.stringify(!expanded));
            }}
            className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-2lg text-foreground-icon-secondary outline-none hover:bg-background-secondary-hover focus-visible:ring-2 focus-visible:ring-border-focus-ring"
          >
            <ChevronRight className={cx("size-4 transition-transform duration-150 motion-reduce:transition-none", expanded && "rotate-90")} aria-hidden />
          </button>
        )}
      </div>
      {collapsible && pluginList}
      {onNewBrowser && (
        <NavItem icon={Globe} label={t("chat.newBrowser")} onClick={onNewBrowser} />
      )}
      {onOpenMission && (
        <NavItem icon={Workflow} label={t("mission.title")} onClick={onOpenMission} />
      )}
      {!collapsible && pluginEntries.length > 0 && pluginList}
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
  onSetWorkspacePinned,
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
  onSetWorkspacePinned?: (id: string, pinned: boolean) => void;
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
          onSetPinned={onSetWorkspacePinned}
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
