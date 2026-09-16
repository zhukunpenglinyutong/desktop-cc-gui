import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useChatStore } from "./store";
import { SessionTabStrip } from "./components/SessionTabStrip";
import { ErrorBanner } from "./components/ErrorBanner";
import type { ComposerInputHandle } from "@/components/application/ai-chat/ai-chat-composer";
import { AppStatusBar } from "@/components/application/app-status-bar/app-status-bar";
import { isWeb } from "@/lib/platform";
import { useTitlebarStyle } from "@/features/settings/titlebar";
import PanelLeftOpen from "lucide-react/dist/esm/icons/panel-left-open";
import { TerminalDock } from "@/features/terminal/TerminalDock";
import { useTerminalStore } from "@/features/terminal/store";
import { useGitStore } from "@/features/git/store";
import { cx } from "@/utils/cx";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useLayoutPanels } from "./use-layout-panels";
import {
  useChatPageLifecycle,
  useChatShortcutHandlers,
  useLayoutCommands,
} from "./use-chat-page-effects";
import { useChatTabs } from "./use-chat-tabs";
import { useChatSidebar } from "./use-chat-sidebar";
import { ChatPageDialogs, type ChatPageDialog } from "./ChatPageDialogs";
import { ChatPanelHeader } from "./ChatPanelHeader";
import { PANEL_TOGGLE_CLASSES } from "./panel-toggle-classes";
import { ChatSidebarFrame } from "./ChatSidebarFrame";
import { ChatSidePanel } from "./ChatSidePanel";
import { ChatCenterPane } from "./ChatCenterPane";
// Side-effect import: registers the builtin files/changes tabs into
// panelTabRegistry (plan §4.2 #4).
import "./panel-tabs";

// Windows keeps its native titlebar (titleBarStyle Overlay is macOS-only), so
// the caption row sits directly on the app background with no visual break —
// draw a hairline under it. Web mode has browser chrome; skip there.
const NEEDS_TITLEBAR_HAIRLINE =
  !isWeb &&
  typeof navigator !== "undefined" &&
  /windows/i.test(navigator.userAgent);

// Below Tailwind's xl breakpoint the side panel and the chat column cannot
// both be comfortable, so the panel defaults to collapsed there. It stays
// expandable: the titlebar toggle renders at every width.
const PANEL_MEDIA = "(max-width: 1279px)";
// Floor reserved for the chat column when clamping the panel width.
const CHAT_MIN_WIDTH = 320;

export default function ChatPage() {
  const { t } = useTranslation();
  const titlebarStyle = useTitlebarStyle();
  // Store actions/slices are stable or low-frequency references. The
  // high-frequency session/draft subscriptions live in ChatConversation
  // (components/ChatConversation.tsx).
  const init = useChatStore((s) => s.init);
  const engines = useChatStore((s) => s.engines);
  const actionError = useChatStore((s) => s.actionError);
  const dismissActionError = useChatStore((s) => s.dismissActionError);
  const gitRefresh = useGitStore((s) => s.refresh);
  // Terminal dock: toggled from the header open-actions cluster (and ⌘J).
  const toggleTerminal = useTerminalStore((s) => s.toggle);
  const [dialog, setDialog] = useState<ChatPageDialog | null>(null);
  const composerInputRef = useRef<ComposerInputHandle>(null);
  const {
    panelWidth,
    panelCollapsed,
    togglePanelCollapsed,
    panelTab,
    setPanelTab,
    sidebarCollapsed,
    toggleSidebarCollapsed,
    collapseSidebarOnMobile,
    sidebarWidth,
    dragging,
    handleResizeStart,
    panelRef,
    panelHeaderRef,
    sidebarRef,
    sidebarResizerRef,
  } = useLayoutPanels();

  // Narrow windows default to a collapsed panel. The override is local and
  // deliberately NOT persisted: toggling while narrow must not clobber the
  // wide-window preference, and every breakpoint crossing re-applies the
  // default while an explicit expand sticks until the next crossing.
  const narrowPanel = useMediaQuery(PANEL_MEDIA);
  const [narrowPanelExpanded, setNarrowPanelExpanded] = useState(false);
  useEffect(() => {
    setNarrowPanelExpanded(false);
  }, [narrowPanel]);
  const panelCollapsedEffective = narrowPanel
    ? !narrowPanelExpanded
    : panelCollapsed;
  const handleTogglePanel = useCallback(() => {
    if (narrowPanel) setNarrowPanelExpanded((prev) => !prev);
    else togglePanelCollapsed();
  }, [narrowPanel, togglePanelCollapsed]);
  // The persisted width can exceed what is left beside the sidebar, so clamp
  // it for rendering only: storage keeps the user's width, and drags still
  // mutate style.width imperatively against the real min/max. Measured off
  // the center row rather than window.innerWidth because the sidebar overlays
  // the content below md instead of taking layout space.
  const centerRowRef = useRef<HTMLDivElement>(null);
  const [centerRowWidth, setCenterRowWidth] = useState(0);
  useEffect(() => {
    const el = centerRowRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() =>
      setCenterRowWidth(el.getBoundingClientRect().width),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Before the first measurement centerRowWidth is 0; fall back to the stored
  // width so the panel does not flash collapsed on mount.
  const panelWidthEffective =
    centerRowWidth > 0
      ? Math.min(panelWidth, Math.max(0, centerRowWidth - CHAT_MIN_WIDTH))
      : panelWidth;

  useLayoutCommands(handleTogglePanel, toggleSidebarCollapsed);
  const {
    tabItems,
    activeTabKey,
    handleTabSelect,
    handleTabClose,
    handleTabCloseAll,
    handleTabCloseInactive,
    handleTabReorder,
    sessionById,
    threadStreaming,
    openFiles,
    activeFilePath,
    diffView,
    closeDiff,
  } = useChatTabs({ setDialog });
  const diffStatus = useGitStore((s) =>
    s.diffView ? s.statusByWorkspace[s.diffView.workspacePath] : undefined,
  );
  const {
    active,
    workspaces,
    startNewChat,
    repos,
    sections,
    archivedRepos,
    handleAddWorkspace,
    handleThreadSelect,
    handleThreadAction,
    handleCopyThreadId,
    handleRemoveWorkspace,
    handleWorkspaceAlias,
    handleSetWorkspaceArchived,
    handleNewSession,
    handleNewSessionInWorkspace,
    handleReorderWorkspaces,
    handleDropWorkspaceToSection,
  } = useChatSidebar({
    sessionById,
    threadStreaming,
    collapseSidebarOnMobile,
    composerInputRef,
    setDialog,
  });

  useChatPageLifecycle(init, gitRefresh, active?.workspacePath);
  useChatShortcutHandlers(
    active?.workspacePath,
    toggleTerminal,
    handleNewSession,
  );

  return (
    <div
      className={cx(
        "relative flex h-dvh w-full overflow-hidden bg-background-secondary-default",
        // Phones with `viewport-fit=cover` (index.html) lay the app under the
        // status bar/notch: without the inset the tab strip — and with it the
        // only way to switch sessions — sits behind the iOS chrome, which is
        // where it kept disappearing (Chrome for iOS especially). Zero on
        // desktop, so this only moves pixels on a notched device.
        "pt-[env(safe-area-inset-top)]",
        // Same for the home indicator: it overlays AppStatusBar otherwise.
        "pb-[env(safe-area-inset-bottom)]",
        NEEDS_TITLEBAR_HAIRLINE && titlebarStyle === "native" && "border-t border-separator-border",
        dragging && "cursor-col-resize select-none",
      )}
    >
      <ChatSidebarFrame
        active={active}
        collapsed={sidebarCollapsed}
        width={sidebarWidth}
        dragging={dragging}
        sidebarRef={sidebarRef}
        resizerRef={sidebarResizerRef}
        onResizeStart={handleResizeStart("sidebar")}
        onClose={toggleSidebarCollapsed}
        repos={repos}
        sections={sections}
        onThreadSelect={handleThreadSelect}
        onThreadAction={handleThreadAction}
        onCopyThreadId={handleCopyThreadId}
        onAddWorkspace={handleAddWorkspace}
        onRemoveWorkspace={handleRemoveWorkspace}
        onWorkspaceAlias={handleWorkspaceAlias}
        onSetWorkspaceArchived={handleSetWorkspaceArchived}
        archivedRepos={archivedRepos}
        onNewSessionInWorkspace={handleNewSessionInWorkspace}
        onNewSession={handleNewSession}
        onReorderWorkspaces={handleReorderWorkspaces}
        onDropWorkspaceToSection={handleDropWorkspaceToSection}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background-primary-default md:rounded-l-[14px] md:border-l md:border-separator-border">
        <SessionTabStrip
          tabs={tabItems}
          activeKey={activeTabKey}
          onSelect={handleTabSelect}
          onClose={handleTabClose}
          onCloseAll={handleTabCloseAll}
          onCloseInactive={handleTabCloseInactive}
          closeLabel={t("common.close")}
          onReorder={handleTabReorder}
          onNew={handleNewSession}
          trafficLightInset={sidebarCollapsed && !isWeb}
          leading={
            sidebarCollapsed ? (
              <button
                type="button"
                title={t("chat.expandSidebar")}
                aria-label={t("chat.expandSidebar")}
                onClick={toggleSidebarCollapsed}
                className={PANEL_TOGGLE_CLASSES}
              >
                <PanelLeftOpen className="size-4" aria-hidden />
              </button>
            ) : undefined
          }
          actions={
            active ? (
              <ChatPanelHeader
                workspacePath={active.workspacePath}
                panelTab={panelTab}
                onPanelTabChange={setPanelTab}
                panelCollapsed={panelCollapsedEffective}
                onTogglePanelCollapsed={handleTogglePanel}
                panelWidth={panelWidthEffective}
                panelHeaderRef={panelHeaderRef}
                dragging={dragging}
              />
            ) : undefined
          }
        />

        {actionError && (
          <ErrorBanner
            className="mx-4 mt-2"
            message={`${t("common.error")}: ${actionError}`}
            onDismiss={dismissActionError}
          />
        )}

        <div
          id="center-tabpanel"
          role="tabpanel"
          ref={centerRowRef}
          className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden"
        >
          <ChatCenterPane
            active={active}
            engines={engines}
            workspaces={workspaces}
            startNewChat={startNewChat}
            composerInputRef={composerInputRef}
            openFiles={openFiles}
            activeFilePath={activeFilePath}
            diffView={diffView}
            diffStatus={diffStatus}
            closeDiff={closeDiff}
          />
          <ChatSidePanel
            active={active}
            panelRef={panelRef}
            panelWidth={panelWidthEffective}
            panelCollapsed={panelCollapsedEffective}
            dragging={dragging}
            panelTab={panelTab}
            onResizeStart={handleResizeStart("panel")}
          />
        </div>
        {active && <TerminalDock workspacePath={active.workspacePath} />}
        <AppStatusBar />
      </div>

      <ChatPageDialogs dialog={dialog} onClose={() => setDialog(null)} />
    </div>
  );
}
