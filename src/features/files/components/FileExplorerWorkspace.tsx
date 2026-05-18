import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GitFileStatus, OpenAppTarget } from "../../../types";
import type { WorkspaceDirectoryEntry } from "../../../services/tauri";
import { getClientStoreSync, writeClientStoreValue } from "../../../services/clientStorage";
import { pushErrorToast } from "../../../services/toasts";
import {
  buildDetachedSpecHubSession,
  openOrFocusDetachedSpecHub,
} from "../../spec/detachedSpecHub";
import { FileTreePanel } from "./FileTreePanel";
import { FileViewPanel } from "./FileViewPanel";
import type { EditorNavigationTarget } from "../../app/hooks/useGitPanelController";

const DETACHED_EXPLORER_SIDEBAR_WIDTH_KEY = "detachedFileExplorerSidebarWidth";
const DEFAULT_DETACHED_EXPLORER_SIDEBAR_WIDTH = 320;
const MIN_DETACHED_EXPLORER_SIDEBAR_WIDTH = 220;
const MAX_DETACHED_EXPLORER_SIDEBAR_WIDTH = 520;

function clampSidebarWidth(width: number) {
  return Math.min(
    MAX_DETACHED_EXPLORER_SIDEBAR_WIDTH,
    Math.max(MIN_DETACHED_EXPLORER_SIDEBAR_WIDTH, width),
  );
}

type FileExplorerWorkspaceProps = {
  workspaceId: string;
  workspaceName: string;
  workspacePath: string;
  gitRoot?: string | null;
  files: string[];
  directories: string[];
  directoryMetadata?: WorkspaceDirectoryEntry[];
  isLoading: boolean;
  loadError?: string | null;
  gitignoredFiles: Set<string>;
  gitignoredDirectories: Set<string>;
  gitStatusFiles?: GitFileStatus[];
  openTargets: OpenAppTarget[];
  openAppIconById: Record<string, string>;
  selectedOpenAppId: string;
  onSelectOpenAppId: (id: string) => void;
  openTabs: string[];
  activeFilePath: string | null;
  navigationTarget: EditorNavigationTarget | null;
  onOpenFile: (path: string, location?: { line: number; column: number }) => void;
  onActivateTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  onCloseAllTabs: () => void;
  onRefreshFiles?: () => void;
  externalChangeMonitoringEnabled?: boolean;
  externalChangeTransportMode?: "watcher" | "polling";
  fileViewHeaderLayout?: "stacked" | "single-row";
};

export function FileExplorerWorkspace({
  workspaceId,
  workspaceName,
  workspacePath,
  gitRoot = null,
  files,
  directories,
  directoryMetadata,
  isLoading,
  loadError = null,
  gitignoredFiles,
  gitignoredDirectories,
  gitStatusFiles,
  openTargets,
  openAppIconById,
  selectedOpenAppId,
  onSelectOpenAppId,
  openTabs,
  activeFilePath,
  navigationTarget,
  onOpenFile,
  onActivateTab,
  onCloseTab,
  onCloseAllTabs,
  onRefreshFiles,
  externalChangeMonitoringEnabled = false,
  externalChangeTransportMode = "polling",
  fileViewHeaderLayout = "stacked",
}: FileExplorerWorkspaceProps) {
  const { t } = useTranslation();
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    clampSidebarWidth(
      getClientStoreSync<number>("layout", DETACHED_EXPLORER_SIDEBAR_WIDTH_KEY) ??
        DEFAULT_DETACHED_EXPLORER_SIDEBAR_WIDTH,
    ),
  );

  useEffect(() => {
    writeClientStoreValue("layout", DETACHED_EXPLORER_SIDEBAR_WIDTH_KEY, sidebarWidth);
  }, [sidebarWidth]);

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, []);

  const handleResizeStart = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    const workspace = workspaceRef.current;
    if (!workspace) {
      return;
    }
    const workspaceRect = workspace.getBoundingClientRect();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const maxWidth = Math.min(
      MAX_DETACHED_EXPLORER_SIDEBAR_WIDTH,
      Math.max(MIN_DETACHED_EXPLORER_SIDEBAR_WIDTH, workspaceRect.width - 280),
    );
    if (maxWidth <= MIN_DETACHED_EXPLORER_SIDEBAR_WIDTH) {
      return;
    }

    event.preventDefault();
    document.body.dataset.panelResizing = "true";

    const cleanup = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      delete document.body.dataset.panelResizing;
      cleanupRef.current = null;
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextWidth = clampSidebarWidth(startWidth + (moveEvent.clientX - startX));
      setSidebarWidth(Math.min(maxWidth, nextWidth));
    };

    const handlePointerUp = () => {
      cleanup();
    };

    cleanupRef.current?.();
    cleanupRef.current = cleanup;
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  }, [sidebarWidth]);
  const handleOpenSpecHub = useCallback(() => {
    void openOrFocusDetachedSpecHub(
      buildDetachedSpecHubSession({
        workspaceId,
        workspaceName,
        files,
        directories,
      }),
    ).catch((error) => {
      pushErrorToast({
        title: t("sidebar.specHub"),
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }, [directories, files, t, workspaceId, workspaceName]);
  const handleOpenWorkspaceFile = useCallback(
    (path: string, location?: { line: number; column: number }) => {
      onOpenFile(path, location);
    },
    [onOpenFile],
  );
  const handleToggleSidebar = useCallback(() => {
    setSidebarCollapsed((current) => !current);
  }, []);
  const showViewerExpandButton = sidebarCollapsed && !activeFilePath;

  return (
    <div
      ref={workspaceRef}
      className={`detached-file-explorer-workspace grid grid-cols-[minmax(220px,var(--detached-file-explorer-sidebar-width,320px))_10px_minmax(0,1fr)] min-w-0 min-h-0 flex-1 overflow-hidden relative bg-[var(--surface-messages)] [&.is-sidebar-collapsed]:grid-cols-[0_0_minmax(0,1fr)] max-[860px]:grid-cols-[minmax(200px,var(--detached-file-explorer-sidebar-width,260px))_10px_minmax(0,1fr)]${sidebarCollapsed ? " is-sidebar-collapsed" : ""}`}
      style={{
        "--detached-file-explorer-sidebar-width": `${sidebarWidth}px`,
      } as CSSProperties}
    >
      <div className="detached-file-explorer-sidebar min-w-0 min-h-0 bg-[var(--surface-messages)] [.is-sidebar-collapsed_&]:invisible [&_.coss-file-tree-panel]:h-full">
        <FileTreePanel
          workspaceId={workspaceId}
          workspaceName={workspaceName}
          workspacePath={workspacePath}
          gitRoot={gitRoot}
          files={files}
          directories={directories}
          directoryMetadata={directoryMetadata}
          isLoading={isLoading}
          loadError={loadError}
          filePanelMode="files"
          onFilePanelModeChange={() => undefined}
          onOpenFile={handleOpenWorkspaceFile}
          openTargets={openTargets}
          openAppIconById={openAppIconById}
          selectedOpenAppId={selectedOpenAppId}
          onSelectOpenAppId={onSelectOpenAppId}
          gitStatusFiles={gitStatusFiles}
          gitignoredFiles={gitignoredFiles}
          gitignoredDirectories={gitignoredDirectories}
          onRefreshFiles={onRefreshFiles}
          onOpenSpecHub={handleOpenSpecHub}
          isSpecHubActive={false}
          showSpecHubAction
          showDetachedExplorerAction={false}
          crossWindowDragTargetLabel="main"
        />
      </div>
      <div
        className="detached-file-explorer-resizer relative min-h-0 cursor-col-resize z-[2] bg-transparent [.is-sidebar-collapsed_&]:invisible [.is-sidebar-collapsed_&]:pointer-events-none before:content-[''] before:absolute before:top-1/2 before:left-1/2 before:w-[3px] before:h-16 before:rounded-full before:bg-[color-mix(in_srgb,var(--border-strong)_52%,transparent)] before:-translate-x-1/2 before:-translate-y-1/2 before:opacity-[0.72] before:transition-[opacity,background-color,width] before:duration-150 hover:before:w-1 hover:before:opacity-[0.96] hover:before:bg-[color-mix(in_srgb,var(--border-stronger)_72%,transparent)]"
        role="separator"
        aria-orientation="vertical"
        aria-label={t("layout.resizeSidebar")}
        onPointerDown={handleResizeStart}
      />
      <div className="detached-file-explorer-viewer relative min-w-0 min-h-0 bg-[var(--surface-messages)]">
        {showViewerExpandButton ? (
          <button
            type="button"
            className="detached-file-explorer-sidebar-expand absolute top-2 left-2 z-[4] inline-flex items-center justify-center w-6 h-6 border border-transparent rounded-md bg-transparent text-[var(--text-faint)] transition-colors duration-[120ms] hover:text-[var(--text-strong)] hover:border-[var(--border-strong)] hover:bg-[color-mix(in_srgb,var(--surface-hover)_68%,var(--surface-card))] focus-visible:text-[var(--text-strong)] focus-visible:border-[var(--border-strong)] focus-visible:bg-[color-mix(in_srgb,var(--surface-hover)_68%,var(--surface-card))]"
            onClick={handleToggleSidebar}
            aria-label={t("sidebar.sidebarExpand")}
            title={t("sidebar.sidebarExpand")}
          >
            <span
              className="codicon codicon-chevron-right detached-file-explorer-sidebar-expand-icon inline-flex items-center justify-center text-base leading-none"
              aria-hidden
            />
          </button>
        ) : null}
        {activeFilePath ? (
          <FileViewPanel
            workspaceId={workspaceId}
            workspacePath={workspacePath}
            gitRoot={gitRoot}
            filePath={activeFilePath}
            gitStatusFiles={gitStatusFiles}
            navigationTarget={navigationTarget}
            openTabs={openTabs}
            activeTabPath={activeFilePath}
            onActivateTab={onActivateTab}
            onCloseTab={onCloseTab}
            onCloseAllTabs={onCloseAllTabs}
            openTargets={openTargets}
            openAppIconById={openAppIconById}
            selectedOpenAppId={selectedOpenAppId}
            onSelectOpenAppId={onSelectOpenAppId}
            onNavigateToLocation={handleOpenWorkspaceFile}
            onClose={onCloseAllTabs}
            externalChangeMonitoringEnabled={externalChangeMonitoringEnabled}
            externalChangeTransportMode={externalChangeTransportMode}
            headerLayout={fileViewHeaderLayout}
            onSingleRowLeadingAction={
              fileViewHeaderLayout === "single-row" ? handleToggleSidebar : undefined
            }
            singleRowLeadingDirection={sidebarCollapsed ? "right" : "left"}
            singleRowLeadingLabel={
              fileViewHeaderLayout === "single-row"
                ? sidebarCollapsed
                  ? t("sidebar.sidebarExpand")
                  : t("sidebar.sidebarCollapse")
                : undefined
            }
          />
        ) : (
          <div className="detached-file-explorer-empty flex flex-col justify-center items-center gap-2.5 h-full p-8 text-center">
            <p className="detached-file-explorer-empty-title m-0 text-base font-semibold text-[var(--text-stronger)]">
              {t("files.detachedExplorerEmptyTitle")}
            </p>
            <p className="detached-file-explorer-empty-body m-0 max-w-[420px] text-[13px] leading-relaxed text-[var(--text-muted)]">
              {t("files.detachedExplorerEmptyBody")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
