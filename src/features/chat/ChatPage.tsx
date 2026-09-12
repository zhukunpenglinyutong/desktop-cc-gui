import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useChatStore } from "./store";
import { SessionTabStrip } from "./components/SessionTabStrip";
import type { ComposerInputHandle } from "@/components/application/ai-chat/ai-chat-composer";
import { AppStatusBar } from "@/components/application/app-status-bar/app-status-bar";
import { isWeb } from "@/lib/platform";
import PanelLeftOpen from "lucide-react/dist/esm/icons/panel-left-open";
import { TerminalDock } from "@/features/terminal/TerminalDock";
import { useTerminalStore } from "@/features/terminal/store";
import { useGitStore } from "@/features/git/store";
import { ipc } from "@/lib/ipc";
import { cx } from "@/utils/cx";
import { useLayoutPanels } from "./use-layout-panels";
import { commandRegistry } from "@ccgui/plugin-sdk";
import { keywords } from "@/features/commands/builtins";
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

export default function ChatPage() {
  const { t } = useTranslation();
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

  // Layout toggles registered as palette commands (plan §4.2 #9): the toggles
  // live in this hook instance, so registration happens here where they're in
  // scope. ChatPage stays mounted for the app's lifetime; the cleanup keeps
  // the registry honest under HMR.
  useEffect(() => {
    const disposers = [
      commandRegistry.register({
        id: "builtin:toggleSidePanel",
        title: () => t("commands.toggleSidePanel"),
        keywords: keywords("commands.toggleSidePanelKeywords"),
        run: togglePanelCollapsed,
      }),
      commandRegistry.register({
        id: "builtin:toggleSidebar",
        title: () => t("commands.toggleSidebar"),
        keywords: keywords("commands.toggleSidebarKeywords"),
        run: toggleSidebarCollapsed,
      }),
    ];
    return () => disposers.forEach((d) => d());
  }, [t, togglePanelCollapsed, toggleSidebarCollapsed]);
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
    handleRemoveWorkspace,
    handleWorkspaceAlias,
    handleSetWorkspaceArchived,
    handleNewSession,
    handleNewSessionInWorkspace,
    handleReorderWorkspaces,
  } = useChatSidebar({
    sessionById,
    threadStreaming,
    collapseSidebarOnMobile,
    composerInputRef,
    setDialog,
  });

  useEffect(() => {
    void init();
  }, [init]);

  // Refocus rescan: 5min TTL, aligned with TokenTracker tier-1.
  useEffect(() => {
    let lastScan = Date.now();
    const onFocus = () => {
      if (Date.now() - lastScan > 5 * 60_000) {
        lastScan = Date.now();
        void ipc.rescanSessions().catch(() => {});
      }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // Git status follows the active workspace (30s TTL inside the store).
  useEffect(() => {
    if (active?.workspacePath) void gitRefresh(active.workspacePath);
  }, [active?.workspacePath, gitRefresh]);
  // ⌘J / Ctrl+J toggles the terminal dock for the active workspace.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.shiftKey &&
        !e.altKey &&
        e.key.toLowerCase() === "j"
      ) {
        if (!active) return;
        e.preventDefault();
        toggleTerminal(active.workspacePath);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, toggleTerminal]);

  return (
    <div
      className={cx(
        "relative flex h-dvh w-full overflow-hidden bg-background-secondary-default",
        NEEDS_TITLEBAR_HAIRLINE && "border-t border-separator-border",
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
        onAddWorkspace={handleAddWorkspace}
        onRemoveWorkspace={handleRemoveWorkspace}
        onWorkspaceAlias={handleWorkspaceAlias}
        onSetWorkspaceArchived={handleSetWorkspaceArchived}
        archivedRepos={archivedRepos}
        onNewSessionInWorkspace={handleNewSessionInWorkspace}
        onNewSession={handleNewSession}
        onReorderWorkspaces={handleReorderWorkspaces}
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
                panelCollapsed={panelCollapsed}
                onTogglePanelCollapsed={togglePanelCollapsed}
                panelWidth={panelWidth}
                panelHeaderRef={panelHeaderRef}
                dragging={dragging}
              />
            ) : undefined
          }
        />

        {actionError && (
          <div
            role="alert"
            className="mx-4 mt-2 flex shrink-0 items-center gap-2 rounded-lg border border-border-error-default bg-background-tertiary-error px-3 py-2 text-body-regular text-text-error-primary"
          >
            <span className="min-w-0 flex-1 break-all">
              {t("common.error")}: {actionError}
            </span>
            <button
              type="button"
              aria-label={t("common.close")}
              onClick={dismissActionError}
              className="shrink-0 cursor-pointer rounded p-0.5 hover:bg-background-tertiary-hover"
            >
              ×
            </button>
          </div>
        )}

        <div
          id="center-tabpanel"
          role="tabpanel"
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
            panelWidth={panelWidth}
            panelCollapsed={panelCollapsed}
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
