import type { ReactNode } from "react";
import { MainTopbar } from "../../app/components/MainTopbar";
import { cn } from "@/lib/utils";

const COMPACT_PANEL_CLASS = "compact-panel flex flex-col flex-1 min-h-0";
const COMPACT_CONTENT_CLASS = "compact-content flex flex-col flex-1 min-h-0";
const COMPACT_GIT_CLASS = "compact-git flex flex-col gap-3 flex-1 min-h-0";
const COMPACT_GIT_LIST_CLASS = "compact-git-list flex-1 min-h-0 overflow-hidden";
const COMPACT_GIT_VIEWER_CLASS =
  "compact-git-viewer flex-1 min-h-0 overflow-hidden [&_.diff-viewer]:h-full";

type PhoneLayoutProps = {
  approvalToastsNode: ReactNode;
  updateToastNode: ReactNode;
  errorToastsNode: ReactNode;
  globalRuntimeNoticeDockNode: ReactNode;
  tabBarNode: ReactNode;
  sidebarNode: ReactNode;
  showGitHistory: boolean;
  gitHistoryNode: ReactNode;
  activeTab: "projects" | "codex" | "spec" | "git" | "log";
  activeWorkspace: boolean;
  showGitDetail: boolean;
  compactEmptyCodexNode: ReactNode;
  compactEmptySpecNode: ReactNode;
  compactEmptyGitNode: ReactNode;
  compactGitBackNode: ReactNode;
  topbarLeftNode: ReactNode;
  messagesNode: ReactNode;
  composerNode: ReactNode;
  gitDiffPanelNode: ReactNode;
  gitDiffViewerNode: ReactNode;
  debugPanelNode: ReactNode;
  settingsOpen: boolean;
  settingsNode: ReactNode;
};

export function PhoneLayout({
  approvalToastsNode,
  updateToastNode,
  errorToastsNode,
  globalRuntimeNoticeDockNode,
  tabBarNode,
  sidebarNode,
  showGitHistory,
  gitHistoryNode,
  activeTab,
  activeWorkspace,
  showGitDetail,
  compactEmptyCodexNode,
  compactEmptySpecNode,
  compactEmptyGitNode,
  compactGitBackNode,
  topbarLeftNode,
  messagesNode,
  composerNode,
  gitDiffPanelNode,
  gitDiffViewerNode,
  debugPanelNode,
  settingsOpen,
  settingsNode,
}: PhoneLayoutProps) {
  return (
    <div className="compact-shell relative flex flex-col h-full min-h-0">
      {approvalToastsNode}
      {updateToastNode}
      {errorToastsNode}
      {globalRuntimeNoticeDockNode}
      {!settingsOpen && showGitHistory && <div className={COMPACT_PANEL_CLASS}>{gitHistoryNode}</div>}
      {settingsOpen && <div className={COMPACT_PANEL_CLASS}>{settingsNode}</div>}
      {!settingsOpen && !showGitHistory && activeTab === "projects" && (
        <div className={COMPACT_PANEL_CLASS}>{sidebarNode}</div>
      )}
      {!showGitHistory && activeTab === "codex" && (
        <div className={COMPACT_PANEL_CLASS}>
          {activeWorkspace ? (
            <>
              <MainTopbar leftNode={topbarLeftNode} className="compact-topbar px-4 pt-2.5 pb-2" />
              <div className={cn("content", COMPACT_CONTENT_CLASS)}>{messagesNode}</div>
              {composerNode}
            </>
          ) : (
            compactEmptyCodexNode
          )}
        </div>
      )}
      {!showGitHistory && activeTab === "spec" && (
        <div className={COMPACT_PANEL_CLASS}>
          {activeWorkspace ? (
            <>
              <MainTopbar leftNode={topbarLeftNode} className="compact-topbar px-4 pt-2.5 pb-2" />
              <div className={cn("content", COMPACT_CONTENT_CLASS)}>{messagesNode}</div>
            </>
          ) : (
            compactEmptySpecNode
          )}
        </div>
      )}
      {!showGitHistory && activeTab === "git" && (
        <div className={COMPACT_PANEL_CLASS}>
          {!activeWorkspace && compactEmptyGitNode}
          {activeWorkspace && showGitDetail && (
            <>
              {compactGitBackNode}
              <div className={COMPACT_GIT_VIEWER_CLASS}>{gitDiffViewerNode}</div>
            </>
          )}
          {activeWorkspace && !showGitDetail && (
            <>
              <MainTopbar leftNode={topbarLeftNode} className="compact-topbar px-4 pt-2.5 pb-2" />
              <div className={COMPACT_GIT_CLASS}>
                <div className={COMPACT_GIT_LIST_CLASS}>{gitDiffPanelNode}</div>
              </div>
            </>
          )}
        </div>
      )}
      {!showGitHistory && activeTab === "log" && (
        <div className={COMPACT_PANEL_CLASS}>{debugPanelNode}</div>
      )}
      {tabBarNode}
    </div>
  );
}
