import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import FileText from "lucide-react/dist/esm/icons/file-text";
import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import Globe from "lucide-react/dist/esm/icons/globe";
import LayoutGrid from "lucide-react/dist/esm/icons/layout-grid";
import Network from "lucide-react/dist/esm/icons/network";
import Sparkles from "lucide-react/dist/esm/icons/sparkles";
import { BROWSER_TAB_PREFIX, useBrowserStore, type BrowserTab } from "@/features/browser/store";
import { browserTabLabel } from "@/features/browser/address";
import { useBetaFeature } from "@/features/settings/beta-features";
import { MISSION_WORKBENCH_TAB_KEY, useMissionStore } from "@/features/mission/store";
import { PLUGIN_HUB_TAB_KEY, usePluginHubStore } from "@/features/plugins/hub/store";
import { centerTabRegistry, useRegistry } from "@ccgui/plugin-sdk";
import type { LucideIcon } from "lucide-react";
import { PLUGIN_TAB_PREFIX, usePluginTabsStore } from "@/features/plugins/runtime/center-tabs";
import { RELEASE_NOTES_TAB_KEY, useReleaseNotesTabStore } from "@/features/update/notes-tab";
import { fileName, useFilesStore } from "@/features/files/store";
import { useGitStore, type DiffTarget } from "@/features/git/store";
import type { SessionMeta } from "@/lib/ipc";
import { sessionKey, useChatStore, type ActiveSession } from "./store";
import type { ChatPageDialog } from "./ChatPageDialogs";

// File tabs share the session tab strip; their keys are prefixed so select /
// close handlers can route them to the files store instead of the chat store.
const FILE_TAB_PREFIX = "file:";
// The changes diff opens as a center tab too; a single instance at a time.
const DIFF_TAB_KEY = "diff:";
// Stable empty list for a hidden beta entry: keeps the tab memos from
// recomputing on every render while the flag is off.
const NO_BROWSER_TABS: BrowserTab[] = [];

export interface UseChatTabsResult {
  tabItems: Array<{
    key: string;
    label: string;
    title?: string;
    icon?: LucideIcon;
    engine?: string;
    streaming: boolean;
    retrying?: boolean;
    unseen?: boolean;
    unread?: string;
    dirty?: boolean;
    session?: ActiveSession;
  }>;
  activeTabKey: string | null;
  handleTabSelect: (tabKey: string) => void;
  handleTabClose: (tabKey: string) => void;
  handleTabCloseAll: () => void;
  handleTabCloseInactive: (targetKey?: string) => void;
  handleTabCloseLeft: (targetKey: string) => void;
  handleTabCloseRight: (targetKey: string) => void;
  handleTabReorder: (draggedKey: string, targetKey: string, before: boolean) => void;
  sessionById: Map<string, SessionMeta>;
  threadStreaming: boolean[];
  threadRetrying: boolean[];
  openFiles: string[];
  activeFilePath: string | null;
  browserTabs: BrowserTab[];
  activeBrowserId: string | null;
  pluginTabs: string[];
  activePluginTabId: string | null;
  pluginHubOpen: boolean;
  pluginHubActive: boolean;
  missionOpen: boolean;
  missionActive: boolean;
  notesOpen: boolean;
  notesActive: boolean;
  diffView: { workspacePath: string; target: DiffTarget } | null;
  closeDiff: () => void;
}

/** Center tab strip data: session/file/diff tab items, the active key, and
 * the select/close/reorder handlers routing each tab kind to its store.
 * Sidebar/tab-strip slices are low-frequency — they change only on
 * navigation or a list refresh. */
export function useChatTabs({
  setDialog,
}: {
  setDialog: (dialog: ChatPageDialog) => void;
}): UseChatTabsResult {
  const { t } = useTranslation();
  const { active, openTabs, sessions, unseen } = useChatStore(
    useShallow((s) => ({
      active: s.active,
      openTabs: s.openTabs,
      sessions: s.sessions,
      unseen: s.unseen,
    })),
  );
  const { focusTab, closeTab, moveTab } = useChatStore(
    useShallow((s) => ({
      focusTab: s.focusTab,
      closeTab: s.closeTab,
      moveTab: s.moveTab,
    })),
  );
  // Open file tabs render alongside the session tabs in the center area.
  const { openFiles, activeFilePath, dirtyPaths, activateFile, clearActiveFile, closeFile, moveOpenFile } =
    useFilesStore(
      useShallow((s) => ({
        openFiles: s.openFiles,
        activeFilePath: s.activeFilePath,
        dirtyPaths: s.dirtyPaths,
        activateFile: s.activateFile,
        clearActiveFile: s.clearActiveFile,
        closeFile: s.closeFile,
        moveOpenFile: s.moveOpenFile,
      })),
    );
  // Center diff, opened from the changes panel's file rows.
  const diffView = useGitStore((s) => s.diffView);
  const closeDiff = useGitStore((s) => s.closeDiff);
  // Plugin center tabs (SDK 0.3.12 ui:center-tab): definitions in the SDK
  // registry, open instances in the plugin tabs store. Stale ids (plugin
  // unloaded with a tab open) drop read-side via registry membership.
  const { pluginTabs, activePluginTabIdRaw, activatePluginTab, deactivatePluginTab, closePluginTab, movePluginTab } =
    usePluginTabsStore(
      useShallow((s) => ({
        pluginTabs: s.tabs,
        activePluginTabIdRaw: s.activeId,
        activatePluginTab: s.activate,
        deactivatePluginTab: s.deactivate,
        closePluginTab: s.closeTab,
        movePluginTab: s.moveTab,
      })),
    );
  const centerTabDefs = useRegistry(centerTabRegistry);
  // Browser tabs share the strip too; keyed by id behind BROWSER_TAB_PREFIX.
  const { browserTabs, activeBrowserId, activateBrowserTab, deactivateBrowserTab, closeBrowserTab, moveBrowserTab } =
    useBrowserStore(
      useShallow((s) => ({
        browserTabs: s.tabs,
        activeBrowserId: s.activeId,
        activateBrowserTab: s.activate,
        deactivateBrowserTab: s.deactivate,
        closeBrowserTab: s.closeTab,
        moveBrowserTab: s.moveTab,
      })),
    );
  // 任务工作台中心页签（单实例）：开关与激活态都在 mission store。
  const missionOpen = useMissionStore((s) => s.open);
  const missionActive = useMissionStore((s) => s.active);
  // 插件中心页签（原生单实例）：侧栏「插件」入口的落地页。
  const hubOpen = usePluginHubStore((s) => s.open);
  const hubActive = usePluginHubStore((s) => s.active);
  // 版本更新说明页签（原生单实例）：更新检查发现新版本时自动打开，升级后首启
  // 也可能带着未读标记出现（见 upgrade-announcement.ts）。
  const notesOpen = useReleaseNotesTabStore((s) => s.open);
  const notesActive = useReleaseNotesTabStore((s) => s.active);
  const notesUnread = useReleaseNotesTabStore((s) => s.unreadVersion);
  // 内测入口关闭时对应的中心面整体隐藏（store 状态保留，重新开启即恢复）。
  const browserEntryEnabled = useBetaFeature("newBrowser");
  const missionEntryEnabled = useBetaFeature("missionWorkbench");
  const visibleBrowserTabs = browserEntryEnabled ? browserTabs : NO_BROWSER_TABS;
  const visibleActiveBrowserId = browserEntryEnabled ? activeBrowserId : null;
  const visibleMissionOpen = missionEntryEnabled && missionOpen;
  const visibleMissionActive = missionEntryEnabled && missionActive;
  // Flat streaming map: its reference changes only when a session actually
  // starts/stops streaming, so these selectors do not rescan bySession on
  // every per-frame stream flush.
  const streamingByKey = useChatStore((s) => s.streamingByKey);
  const retryingByKey = useChatStore((s) => s.retryingByKey);
  // Per-tab streaming flags for the tab strip; recomputed only when a flag
  // actually flips (or the tab list changes).
  const tabStreaming = useMemo(
    () =>
      openTabs.map(
        (tab) => streamingByKey[sessionKey(tab.engine, tab.sessionId, tab.workspacePath)] === true,
      ),
    [openTabs, streamingByKey],
  );
  // Same for the retry flag: reference-stable, so the strip only re-renders
  // when a tab actually enters/leaves provider backoff.
  const tabRetrying = useMemo(
    () =>
      openTabs.map(
        (tab) => retryingByKey[sessionKey(tab.engine, tab.sessionId, tab.workspacePath)] === true,
      ),
    [openTabs, retryingByKey],
  );
  // Sidebar status dots: per-thread streaming/retry flags plus the unseen map.
  const threadStreaming = useMemo(
    () =>
      sessions.map(
        (sess) =>
          streamingByKey[sessionKey(sess.engine, sess.sessionId, sess.workspacePath)] === true,
      ),
    [sessions, streamingByKey],
  );
  const threadRetrying = useMemo(
    () =>
      sessions.map(
        (sess) =>
          retryingByKey[sessionKey(sess.engine, sess.sessionId, sess.workspacePath)] === true,
      ),
    [sessions, retryingByKey],
  );

  const sessionById = useMemo(() => {
    const map = new Map<string, SessionMeta>();
    for (const s of sessions) map.set(`${s.engine}/${s.sessionId}`, s);
    return map;
  }, [sessions]);
  const sessionTabItems = useMemo(
    () =>
      openTabs.map((tab, index) => {
        const meta = tab.sessionId
          ? sessionById.get(`${tab.engine}/${tab.sessionId}`)
          : undefined;
        return {
          key: sessionKey(tab.engine, tab.sessionId, tab.workspacePath),
          // 会话身份随页签带下去：向下拖出页签条即分屏（split/drag.tsx）。
          session: tab,
          engine: tab.engine,
          label: meta?.customTitle || meta?.title || t("chat.newChat"),
          streaming: tabStreaming[index] ?? false,
          retrying: tabRetrying[index] ?? false,
          unseen: unseen[`${tab.engine}/${tab.sessionId}`] ?? false,
          tab,
        };
      }),
    [openTabs, sessionById, tabStreaming, tabRetrying, t, unseen],
  );
  // File tabs trail the session tabs in the same strip.
  const fileTabItems = useMemo(
    () =>
      openFiles.map((path) => ({
        key: FILE_TAB_PREFIX + path,
        label: fileName(path),
        title: path,
        icon: FileText,
        streaming: false,
        dirty: !!dirtyPaths[path],
      })),
    [openFiles, dirtyPaths],
  );
  // Plugin tabs trail the browser tabs in the same strip.
  const pluginTabItems = useMemo(
    () =>
      pluginTabs.flatMap((id) => {
        const def = centerTabDefs.find((d) => d.id === id);
        if (!def) return [];
        const title = def.title();
        return [
          {
            key: PLUGIN_TAB_PREFIX + id,
            label: title,
            title,
            // SDK 插件图标是宽松 ComponentType；宿主页签条按 Lucide 渲染。
            icon: def.icon as LucideIcon | undefined,
            streaming: false,
          },
        ];
      }),
    [pluginTabs, centerTabDefs],
  );
  // The active plugin tab only counts while its definition still exists.
  const activePluginTabId =
    activePluginTabIdRaw && centerTabDefs.some((d) => d.id === activePluginTabIdRaw)
      ? activePluginTabIdRaw
      : null;
  // Browser tabs trail the file tabs in the same strip.
  const browserTabItems = useMemo(
    () =>
      visibleBrowserTabs.map((tab) => ({
        key: BROWSER_TAB_PREFIX + tab.id,
        label: browserTabLabel(tab, t("browser.newTab")),
        title: tab.url,
        icon: Globe,
        streaming: false,
      })),
    [visibleBrowserTabs, t],
  );
  // 插件中心页签插在 SDK 插件页签之后、任务工作台之前。
  const hubTabItems = useMemo(
    () =>
      hubOpen
        ? [
            {
              key: PLUGIN_HUB_TAB_KEY,
              label: t("plugins.hub.title"),
              title: t("plugins.hub.title"),
              icon: LayoutGrid as LucideIcon,
              streaming: false,
            },
          ]
        : [],
    [hubOpen, t],
  );
  // 任务工作台页签插在插件页签之后、差异页签之前。
  const missionTabItems = useMemo(
    () =>
      visibleMissionOpen
        ? [
            {
              key: MISSION_WORKBENCH_TAB_KEY,
              label: t("mission.title"),
              title: t("mission.title"),
              icon: Network as LucideIcon,
              streaming: false,
            },
          ]
        : [],
    [visibleMissionOpen, t],
  );
  // 版本更新说明页签排在最尾：它由更新检查自动弹出，不插到用户自己的页签中间。
  const notesTabItems = useMemo(
    () =>
      notesOpen
        ? [
            {
              key: RELEASE_NOTES_TAB_KEY,
              label: t("changelog.title"),
              title: t("changelog.title"),
              icon: Sparkles as LucideIcon,
              streaming: false,
              // 升级后首启的未读标记：页签挂强调色圆点，关掉页签即消失。
              unread: notesUnread ? t("changelog.newVersion") : undefined,
            },
          ]
        : [],
    [notesOpen, notesUnread, t],
  );
  const tabItems = useMemo(
    () => [
      ...sessionTabItems,
      ...fileTabItems,
      ...browserTabItems,
      ...pluginTabItems,
      ...hubTabItems,
      ...missionTabItems,
      ...notesTabItems,
      ...(diffView
        ? [
            {
              key: DIFF_TAB_KEY,
              label: fileName(diffView.target.file),
              title: diffView.target.file,
              icon: GitBranch,
              streaming: false,
            },
          ]
        : []),
    ],
    [sessionTabItems, fileTabItems, browserTabItems, pluginTabItems, hubTabItems, missionTabItems, notesTabItems, diffView],
  );
  const activeTabKey = activeCenterTabKey({
    diffView,
    activeBrowserId: visibleActiveBrowserId,
    activePluginTabId,
    hubActive,
    missionActive: visibleMissionActive,
    notesActive,
    activeFilePath,
    active,
  });
  const {
    handleTabSelect,
    handleTabClose,
    handleTabCloseAll,
    handleTabCloseInactive,
    handleTabCloseLeft,
    handleTabCloseRight,
    handleTabReorder,
  } = useChatTabHandlers({
    tabItems,
    setDialog,
    sessionTabItems,
    activeTabKey,
    openFiles,
    dirtyPaths,
    activateFile,
    clearActiveFile,
    closeFile,
    moveOpenFile,
    focusTab,
    closeTab,
    moveTab,
    closeDiff,
    browserTabs,
    activeBrowserId,
    activateBrowserTab,
    deactivateBrowserTab,
    closeBrowserTab,
    moveBrowserTab,
    pluginTabs,
    activePluginTabId,
    activatePluginTab,
    deactivatePluginTab,
    closePluginTab,
    movePluginTab,
  });

  return {
    tabItems,
    activeTabKey,
    handleTabSelect,
    handleTabClose,
    handleTabCloseAll,
    handleTabCloseInactive,
    handleTabCloseLeft,
    handleTabCloseRight,
    handleTabReorder,
    sessionById,
    threadStreaming,
    threadRetrying,
    openFiles,
    activeFilePath,
    // Hidden beta surfaces report empty/inactive so ChatCenterPane unmounts
    // them; the handlers below keep the raw store values for close actions.
    browserTabs: visibleBrowserTabs,
    activeBrowserId: visibleActiveBrowserId,
    pluginTabs,
    activePluginTabId,
    pluginHubOpen: hubOpen,
    pluginHubActive: hubActive,
    missionOpen: visibleMissionOpen,
    missionActive: visibleMissionActive,
    notesOpen,
    notesActive,
    diffView,
    closeDiff,
  };
}

/** One session tab's strip item; the handlers route on `key` and act on
 *  `tab`. */
interface SessionTabItem {
  key: string;
  engine: string;
  label: string;
  streaming: boolean;
  unseen: boolean;
  tab: ActiveSession;
}

/** Tab-kind routing shared by select/close/reorder: keys carry a prefix so
 *  each kind lands in its own store. */
type TabKind = "session" | "file" | "browser" | "plugin" | "hub" | "mission" | "notes";

function tabKindOf(key: string): TabKind {
  if (key.startsWith(BROWSER_TAB_PREFIX)) return "browser";
  if (key.startsWith(PLUGIN_TAB_PREFIX)) return "plugin";
  if (key === PLUGIN_HUB_TAB_KEY) return "hub";
  if (key === MISSION_WORKBENCH_TAB_KEY) return "mission";
  if (key === RELEASE_NOTES_TAB_KEY) return "notes";
  if (key.startsWith(FILE_TAB_PREFIX)) return "file";
  return "session";
}

/** The active center tab key: diff wins, then the mutually exclusive
 *  browser/plugin/file surfaces, then the chat session. A browser tab and
 *  a file tab are never active at once (handleTabSelect enforces it), so
 *  this precedence is only a tie-breaker for restores. */
function activeCenterTabKey({
  diffView,
  activeBrowserId,
  activePluginTabId,
  hubActive,
  missionActive,
  notesActive,
  activeFilePath,
  active,
}: {
  diffView: unknown;
  activeBrowserId: string | null;
  activePluginTabId: string | null;
  hubActive: boolean;
  missionActive: boolean;
  notesActive: boolean;
  activeFilePath: string | null;
  active: ActiveSession | null;
}): string | null {
  if (diffView) return DIFF_TAB_KEY;
  if (activeBrowserId) return BROWSER_TAB_PREFIX + activeBrowserId;
  if (activePluginTabId) return PLUGIN_TAB_PREFIX + activePluginTabId;
  if (hubActive) return PLUGIN_HUB_TAB_KEY;
  if (missionActive) return MISSION_WORKBENCH_TAB_KEY;
  if (notesActive) return RELEASE_NOTES_TAB_KEY;
  if (activeFilePath) return FILE_TAB_PREFIX + activeFilePath;
  return active ? sessionKey(active.engine, active.sessionId, active.workspacePath) : null;
}

/** Index a dragged tab lands at: after-target drops shift one past the
 *  target, and dragging downward pulls the vacated slot back one. */
function dropTargetIndex(from: number, target: number, before: boolean): number {
  const to = target + (before ? 0 : 1);
  return from >= 0 && from < to ? to - 1 : to;
}

interface ChatTabHandlerDeps {
  setDialog: (dialog: ChatPageDialog) => void;
  tabItems: Array<{ key: string }>;
  sessionTabItems: SessionTabItem[];
  activeTabKey: string | null;
  // Session tabs (chat store).
  focusTab: (engine: string, sessionId: string | null, workspacePath: string) => void;
  closeTab: (engine: string, sessionId: string | null, workspacePath: string) => void;
  moveTab: (engine: string, sessionId: string | null, workspacePath: string, toIndex: number) => void;
  // File tabs (files store).
  openFiles: string[];
  dirtyPaths: Record<string, true>;
  activateFile: (path: string) => void;
  clearActiveFile: () => void;
  closeFile: (path: string) => void;
  moveOpenFile: (path: string, toIndex: number) => void;
  // Diff tab (git store).
  closeDiff: () => void;
  // Browser tabs (browser store).
  browserTabs: BrowserTab[];
  activeBrowserId?: string | null;
  activateBrowserTab: (id: string) => void;
  deactivateBrowserTab: () => void;
  closeBrowserTab: (id: string) => void;
  moveBrowserTab: (id: string, toIndex: number) => void;
  // Plugin center tabs (plugin tabs store).
  pluginTabs: string[];
  activePluginTabId?: string | null;
  activatePluginTab: (id: string) => void;
  deactivatePluginTab: () => void;
  closePluginTab: (id: string) => void;
  movePluginTab: (id: string, toIndex: number) => void;
}

/** Select/close/reorder/close-all/close-inactive for the center tab strip.
 *  Each tab kind routes to its own store behind its key prefix; the kinds
 *  are mutually exclusive in the center area (selecting one deactivates the
 *  others). */
function useChatTabHandlers({
  tabItems,
  setDialog,
  sessionTabItems,
  activeTabKey,
  focusTab,
  closeTab,
  moveTab,
  openFiles,
  dirtyPaths,
  activateFile,
  clearActiveFile,
  closeFile,
  moveOpenFile,
  closeDiff,
  browserTabs,
  activeBrowserId: _activeBrowserId,
  activateBrowserTab,
  deactivateBrowserTab,
  closeBrowserTab,
  moveBrowserTab,
  pluginTabs,
  activePluginTabId: _activePluginTabId,
  activatePluginTab,
  deactivatePluginTab,
  closePluginTab,
  movePluginTab,
}: ChatTabHandlerDeps) {
  const handleTabSelect = useCallback(
    (tabKey: string) => {
      // The diff tab is already the active center view while diffView is set.
      if (tabKey === DIFF_TAB_KEY) return;
      // Selecting any other tab dismisses the diff so the tab shows.
      closeDiff();
      const kind = tabKindOf(tabKey);
      if (kind === "hub") {
        clearActiveFile();
        deactivateBrowserTab();
        deactivatePluginTab();
        useMissionStore.getState().deactivate();
        useReleaseNotesTabStore.getState().deactivate();
        usePluginHubStore.getState().activate();
        return;
      }
      if (kind === "mission") {
        clearActiveFile();
        deactivateBrowserTab();
        deactivatePluginTab();
        usePluginHubStore.getState().deactivate();
        useReleaseNotesTabStore.getState().deactivate();
        useMissionStore.getState().activate();
        return;
      }
      if (kind === "notes") {
        clearActiveFile();
        deactivateBrowserTab();
        deactivatePluginTab();
        usePluginHubStore.getState().deactivate();
        useMissionStore.getState().deactivate();
        useReleaseNotesTabStore.getState().activate();
        return;
      }
      useMissionStore.getState().deactivate();
      usePluginHubStore.getState().deactivate();
      useReleaseNotesTabStore.getState().deactivate();
      if (kind === "browser") {
        clearActiveFile();
        deactivatePluginTab();
        activateBrowserTab(tabKey.slice(BROWSER_TAB_PREFIX.length));
        return;
      }
      deactivateBrowserTab();
      if (kind === "plugin") {
        clearActiveFile();
        activatePluginTab(tabKey.slice(PLUGIN_TAB_PREFIX.length));
        return;
      }
      deactivatePluginTab();
      if (kind === "file") {
        activateFile(tabKey.slice(FILE_TAB_PREFIX.length));
        return;
      }
      clearActiveFile();
      const item = sessionTabItems.find((i) => i.key === tabKey);
      if (item) focusTab(item.tab.engine, item.tab.sessionId, item.tab.workspacePath);
    },
    [sessionTabItems, focusTab, activateFile, clearActiveFile, closeDiff, activateBrowserTab, deactivateBrowserTab, activatePluginTab, deactivatePluginTab],
  );
  const handleTabClose = useCallback(
    (tabKey: string) => {
      if (tabKey === DIFF_TAB_KEY) {
        closeDiff();
        return;
      }
      const kind = tabKindOf(tabKey);
      if (kind === "hub") {
        usePluginHubStore.getState().close();
        return;
      }
      if (kind === "mission") {
        useMissionStore.getState().close();
        return;
      }
      if (kind === "notes") {
        useReleaseNotesTabStore.getState().close();
        return;
      }
      if (kind === "browser") {
        closeBrowserTab(tabKey.slice(BROWSER_TAB_PREFIX.length));
        return;
      }
      if (kind === "plugin") {
        closePluginTab(tabKey.slice(PLUGIN_TAB_PREFIX.length));
        return;
      }
      if (kind === "file") {
        const path = tabKey.slice(FILE_TAB_PREFIX.length);
        if (dirtyPaths[path]) setDialog({ kind: "closeFile", path });
        else closeFile(path);
        return;
      }
      const item = sessionTabItems.find((i) => i.key === tabKey);
      if (item) closeTab(item.tab.engine, item.tab.sessionId, item.tab.workspacePath);
    },
    [sessionTabItems, closeTab, closeFile, dirtyPaths, closeDiff, setDialog, closeBrowserTab, closePluginTab],
  );
  // Drag-reorder stays within each tab-kind group (sessions, files,
  // browsers each reorder in their own store); cross-group drops are
  // ignored.
  const handleTabReorder = useCallback(
    (draggedKey: string, targetKey: string, before: boolean) => {
      if (draggedKey === DIFF_TAB_KEY || targetKey === DIFF_TAB_KEY) return;
      const kind = tabKindOf(draggedKey);
      if (kind !== tabKindOf(targetKey)) return;
      // 任务工作台、插件中心与版本更新说明是单实例页签，不参与拖拽排序。
      if (kind === "mission" || kind === "hub" || kind === "notes") return;
      if (kind === "browser") {
        const draggedId = draggedKey.slice(BROWSER_TAB_PREFIX.length);
        const targetId = targetKey.slice(BROWSER_TAB_PREFIX.length);
        const from = browserTabs.findIndex((t) => t.id === draggedId);
        const target = browserTabs.findIndex((t) => t.id === targetId);
        moveBrowserTab(draggedId, dropTargetIndex(from, target, before));
        return;
      }
      if (kind === "plugin") {
        const draggedId = draggedKey.slice(PLUGIN_TAB_PREFIX.length);
        const targetId = targetKey.slice(PLUGIN_TAB_PREFIX.length);
        const from = pluginTabs.indexOf(draggedId);
        const target = pluginTabs.indexOf(targetId);
        movePluginTab(draggedId, dropTargetIndex(from, target, before));
        return;
      }
      if (kind === "file") {
        const draggedPath = draggedKey.slice(FILE_TAB_PREFIX.length);
        const targetPath = targetKey.slice(FILE_TAB_PREFIX.length);
        const from = openFiles.indexOf(draggedPath);
        const target = openFiles.indexOf(targetPath);
        moveOpenFile(draggedPath, dropTargetIndex(from, target, before));
        return;
      }
      const from = sessionTabItems.findIndex((i) => i.key === draggedKey);
      const target = sessionTabItems.findIndex((i) => i.key === targetKey);
      const dragged = sessionTabItems[from]?.tab;
      if (!dragged || target < 0) return;
      moveTab(dragged.engine, dragged.sessionId, dragged.workspacePath, dropTargetIndex(from, target, before));
    },
    [openFiles, moveOpenFile, sessionTabItems, moveTab, browserTabs, moveBrowserTab, pluginTabs, movePluginTab],
  );

  // Close a specific list of tab keys with the unified invariant:
  // - Close matching singleton tabs (diff, mission, hub, notes)
  // - Close matching session tabs (unless streaming)
  // - Close matching browser and plugin tabs
  // - Close matching clean files; prompt on the first dirty file
  const closeKeys = useCallback(
    (keysToClose: string[]) => {
      const keysSet = new Set(keysToClose);
      if (keysSet.has(DIFF_TAB_KEY)) closeDiff();
      if (keysSet.has(MISSION_WORKBENCH_TAB_KEY)) useMissionStore.getState().close();
      if (keysSet.has(PLUGIN_HUB_TAB_KEY)) usePluginHubStore.getState().close();
      if (keysSet.has(RELEASE_NOTES_TAB_KEY)) useReleaseNotesTabStore.getState().close();
      for (const item of sessionTabItems) {
        if (keysSet.has(item.key) && !item.streaming) {
          closeTab(item.tab.engine, item.tab.sessionId, item.tab.workspacePath);
        }
      }
      for (const tab of browserTabs) {
        if (keysSet.has(BROWSER_TAB_PREFIX + tab.id)) {
          closeBrowserTab(tab.id);
        }
      }
      for (const id of pluginTabs) {
        if (keysSet.has(PLUGIN_TAB_PREFIX + id)) {
          closePluginTab(id);
        }
      }
      const matchingFiles = openFiles.filter((path) => keysSet.has(FILE_TAB_PREFIX + path));
      const dirty = matchingFiles.filter((path) => dirtyPaths[path]);
      for (const path of matchingFiles) {
        if (!dirtyPaths[path]) closeFile(path);
      }
      if (dirty[0]) setDialog({ kind: "closeFile", path: dirty[0] });
    },
    [
      closeDiff,
      sessionTabItems,
      closeTab,
      browserTabs,
      closeBrowserTab,
      pluginTabs,
      closePluginTab,
      openFiles,
      dirtyPaths,
      closeFile,
      setDialog,
    ],
  );

  const handleTabCloseAll = useCallback(() => {
    closeKeys(tabItems.map((t) => t.key));
  }, [closeKeys, tabItems]);

  const handleTabCloseInactive = useCallback(
    (targetKey?: string) => {
      const preserve = targetKey ?? activeTabKey;
      if (!preserve || !tabItems.some((t) => t.key === preserve)) return;
      closeKeys(tabItems.map((t) => t.key).filter((k) => k !== preserve));
    },
    [activeTabKey, closeKeys, tabItems],
  );

  const handleTabCloseLeft = useCallback(
    (targetKey: string) => {
      const index = tabItems.findIndex((t) => t.key === targetKey);
      if (index <= 0) return;
      closeKeys(tabItems.slice(0, index).map((t) => t.key));
    },
    [closeKeys, tabItems],
  );

  const handleTabCloseRight = useCallback(
    (targetKey: string) => {
      const index = tabItems.findIndex((t) => t.key === targetKey);
      if (index < 0 || index >= tabItems.length - 1) return;
      closeKeys(tabItems.slice(index + 1).map((t) => t.key));
    },
    [closeKeys, tabItems],
  );
  return {
    handleTabSelect,
    handleTabClose,
    handleTabCloseAll,
    handleTabCloseInactive,
    handleTabCloseLeft,
    handleTabCloseRight,
    handleTabReorder,

  };
}
