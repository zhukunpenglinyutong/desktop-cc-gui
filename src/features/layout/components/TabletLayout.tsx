import type { MouseEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { MainTopbar } from "../../app/components/MainTopbar";
import { cn } from "@/lib/utils";

type TabletLayoutProps = {
  tabletNavNode: ReactNode;
  approvalToastsNode: ReactNode;
  updateToastNode: ReactNode;
  errorToastsNode: ReactNode;
  globalRuntimeNoticeDockNode: ReactNode;
  showGitHistory: boolean;
  gitHistoryNode: ReactNode;
  homeNode: ReactNode;
  showHome: boolean;
  showWorkspace: boolean;
  sidebarNode: ReactNode;
  tabletTab: "projects" | "codex" | "spec" | "git" | "log";
  onSidebarResizeStart: (event: MouseEvent<HTMLDivElement>) => void;
  topbarLeftNode: ReactNode;
  messagesNode: ReactNode;
  composerNode: ReactNode;
  gitDiffPanelNode: ReactNode;
  gitDiffViewerNode: ReactNode;
  debugPanelNode: ReactNode;
  settingsOpen: boolean;
  settingsNode: ReactNode;
};

export function TabletLayout({
  tabletNavNode,
  approvalToastsNode,
  updateToastNode,
  errorToastsNode,
  globalRuntimeNoticeDockNode,
  showGitHistory,
  gitHistoryNode,
  homeNode,
  showHome,
  showWorkspace,
  sidebarNode,
  tabletTab,
  onSidebarResizeStart,
  topbarLeftNode,
  messagesNode,
  composerNode,
  gitDiffPanelNode,
  gitDiffViewerNode,
  debugPanelNode,
  settingsOpen,
  settingsNode,
}: TabletLayoutProps) {
  const { t } = useTranslation();
  return (
    <>
      {tabletNavNode}
      <div className="tablet-projects border-r border-border min-h-0 h-full overflow-hidden">
        {sidebarNode}
      </div>
      <div
        className={cn(
          "projects-resizer absolute top-0 bottom-0 w-2 cursor-col-resize z-[3]",
          "left-[calc(var(--tablet-nav-width,72px)+var(--sidebar-width,210px)-4px)]",
          "after:content-[''] after:absolute after:top-0 after:bottom-0 after:left-[3px] after:w-px after:bg-border after:opacity-0 after:transition-opacity",
          "hover:after:opacity-100",
        )}
        role="separator"
        aria-orientation="vertical"
        aria-label={t("layout.resizeProjects")}
        onMouseDown={onSidebarResizeStart}
      />
      <section className="tablet-main flex flex-col min-h-0 min-w-0 h-full">
        {approvalToastsNode}
        {updateToastNode}
        {errorToastsNode}
        {globalRuntimeNoticeDockNode}
        {settingsOpen && settingsNode}
        {!settingsOpen && showGitHistory && gitHistoryNode}
        {!settingsOpen && showHome && homeNode}
        {!settingsOpen && !showGitHistory && showWorkspace && (
          <>
            <MainTopbar leftNode={topbarLeftNode} className="tablet-topbar px-5 pt-2.5 pb-2" />
            {tabletTab === "codex" && (
              <>
                <div className="content tablet-content flex-1 min-h-0">{messagesNode}</div>
                {composerNode}
              </>
            )}
            {tabletTab === "spec" && (
              <div className="content tablet-content flex-1 min-h-0">{messagesNode}</div>
            )}
            {tabletTab === "git" && (
              <div className="tablet-git flex flex-col gap-3 flex-1 min-h-0">
                {gitDiffPanelNode}
                <div className="tablet-git-viewer flex-1 min-h-0 overflow-hidden [&_.diff-viewer]:h-full">
                  {gitDiffViewerNode}
                </div>
              </div>
            )}
            {tabletTab === "log" && debugPanelNode}
          </>
        )}
      </section>
    </>
  );
}
