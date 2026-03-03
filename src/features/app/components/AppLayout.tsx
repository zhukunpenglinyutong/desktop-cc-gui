import { memo } from "react";
import type { MouseEvent, PointerEvent, ReactNode } from "react";
import { DesktopLayout } from "../../layout/components/DesktopLayout";
import { TabletLayout } from "../../layout/components/TabletLayout";
import { PhoneLayout } from "../../layout/components/PhoneLayout";
type AppLayoutProps = {
  isPhone: boolean;
  isTablet: boolean;
  showHome: boolean;
  showKanban: boolean;
  showGitHistory: boolean;
  hideRightPanel: boolean;
  kanbanNode: ReactNode;
  gitHistoryNode: ReactNode;
  showGitDetail: boolean;
  activeTab: "projects" | "codex" | "spec" | "git" | "log";
  tabletTab: "codex" | "spec" | "git" | "log";
  centerMode: "chat" | "diff" | "editor" | "memory";
  editorSplitLayout: "vertical" | "horizontal";
  hasActivePlan: boolean;
  activeWorkspace: boolean;
  sidebarNode: ReactNode;
  messagesNode: ReactNode;
  composerNode: ReactNode;
  approvalToastsNode: ReactNode;
  updateToastNode: ReactNode;
  errorToastsNode: ReactNode;
  homeNode: ReactNode;
  mainHeaderNode: ReactNode;
  desktopTopbarLeftNode: ReactNode;
  tabletNavNode: ReactNode;
  tabBarNode: ReactNode;
  gitDiffPanelNode: ReactNode;
  gitDiffViewerNode: ReactNode;
  fileViewPanelNode: ReactNode;
  planPanelNode: ReactNode;
  runtimeConsoleDockNode: ReactNode;
  debugPanelNode: ReactNode;
  debugPanelFullNode: ReactNode;
  terminalDockNode: ReactNode;
  compactEmptyCodexNode: ReactNode;
  compactEmptySpecNode: ReactNode;
  compactEmptyGitNode: ReactNode;
  compactGitBackNode: ReactNode;
  settingsOpen: boolean;
  settingsNode: ReactNode;
  onSidebarResizeStart: (event: MouseEvent<HTMLDivElement>) => void;
  onRightPanelResizeStart: (event: MouseEvent<HTMLDivElement>) => void;
  onPlanPanelResizeStart: (event: MouseEvent<HTMLDivElement>) => void;
  onGitHistoryPanelResizeStart: (event: PointerEvent<HTMLDivElement>) => void;
};

export const AppLayout = memo(function AppLayout({
  isPhone,
  isTablet,
  showHome,
  showKanban,
  showGitHistory,
  hideRightPanel,
  kanbanNode,
  gitHistoryNode,
  showGitDetail,
  activeTab,
  tabletTab,
  centerMode,
  editorSplitLayout,
  hasActivePlan,
  activeWorkspace,
  sidebarNode,
  messagesNode,
  composerNode,
  approvalToastsNode,
  updateToastNode,
  errorToastsNode,
  homeNode,
  mainHeaderNode,
  desktopTopbarLeftNode,
  tabletNavNode,
  tabBarNode,
  gitDiffPanelNode,
  gitDiffViewerNode,
  fileViewPanelNode,
  planPanelNode,
  runtimeConsoleDockNode,
  debugPanelNode,
  debugPanelFullNode,
  terminalDockNode,
  compactEmptyCodexNode,
  compactEmptySpecNode,
  compactEmptyGitNode,
  compactGitBackNode,
  settingsOpen,
  settingsNode,
  onSidebarResizeStart,
  onRightPanelResizeStart,
  onPlanPanelResizeStart,
  onGitHistoryPanelResizeStart,
}: AppLayoutProps) {
  if (isPhone) {
    return (
      <PhoneLayout
        approvalToastsNode={approvalToastsNode}
        updateToastNode={updateToastNode}
        errorToastsNode={errorToastsNode}
        tabBarNode={tabBarNode}
        sidebarNode={sidebarNode}
        activeTab={activeTab}
        showGitHistory={showGitHistory}
        gitHistoryNode={gitHistoryNode}
        activeWorkspace={activeWorkspace}
        showGitDetail={showGitDetail}
        compactEmptyCodexNode={compactEmptyCodexNode}
        compactEmptySpecNode={compactEmptySpecNode}
        compactEmptyGitNode={compactEmptyGitNode}
        compactGitBackNode={compactGitBackNode}
        topbarLeftNode={mainHeaderNode}
        messagesNode={messagesNode}
        composerNode={composerNode}
        gitDiffPanelNode={gitDiffPanelNode}
        gitDiffViewerNode={gitDiffViewerNode}
        debugPanelNode={debugPanelFullNode}
        settingsOpen={settingsOpen}
        settingsNode={settingsNode}
      />
    );
  }

  if (isTablet) {
    return (
      <TabletLayout
        tabletNavNode={tabletNavNode}
        approvalToastsNode={approvalToastsNode}
        updateToastNode={updateToastNode}
        errorToastsNode={errorToastsNode}
        showGitHistory={showGitHistory}
        gitHistoryNode={gitHistoryNode}
        homeNode={homeNode}
        showHome={showHome}
        showWorkspace={activeWorkspace && !showHome}
        sidebarNode={sidebarNode}
        tabletTab={tabletTab}
        onSidebarResizeStart={onSidebarResizeStart}
        topbarLeftNode={mainHeaderNode}
        messagesNode={messagesNode}
        composerNode={composerNode}
        gitDiffPanelNode={gitDiffPanelNode}
        gitDiffViewerNode={gitDiffViewerNode}
        debugPanelNode={debugPanelFullNode}
        settingsOpen={settingsOpen}
        settingsNode={settingsNode}
      />
    );
  }

  return (
    <DesktopLayout
      sidebarNode={sidebarNode}
      updateToastNode={updateToastNode}
      approvalToastsNode={approvalToastsNode}
      errorToastsNode={errorToastsNode}
      homeNode={homeNode}
      showHome={showHome}
      showWorkspace={activeWorkspace && !showHome && !showKanban}
      showKanban={showKanban}
      showGitHistory={showGitHistory}
      hideRightPanel={hideRightPanel}
      kanbanNode={kanbanNode}
      gitHistoryNode={gitHistoryNode}
      settingsOpen={settingsOpen}
      settingsNode={settingsNode}
      topbarLeftNode={desktopTopbarLeftNode}
      centerMode={centerMode}
      editorSplitLayout={editorSplitLayout}
      messagesNode={messagesNode}
      gitDiffViewerNode={gitDiffViewerNode}
      fileViewPanelNode={fileViewPanelNode}
      gitDiffPanelNode={gitDiffPanelNode}
      planPanelNode={planPanelNode}
      composerNode={composerNode}
      runtimeConsoleDockNode={runtimeConsoleDockNode}
      terminalDockNode={terminalDockNode}
      debugPanelNode={debugPanelNode}
      hasActivePlan={hasActivePlan}
      onSidebarResizeStart={onSidebarResizeStart}
      onRightPanelResizeStart={onRightPanelResizeStart}
      onPlanPanelResizeStart={onPlanPanelResizeStart}
      onGitHistoryPanelResizeStart={onGitHistoryPanelResizeStart}
    />
  );
});
