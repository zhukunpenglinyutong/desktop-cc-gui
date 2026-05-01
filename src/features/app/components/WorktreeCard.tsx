import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import ArrowRight from "lucide-react/dist/esm/icons/arrow-right";
import Eye from "lucide-react/dist/esm/icons/eye";
import EyeOff from "lucide-react/dist/esm/icons/eye-off";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";

import type { WorkspaceInfo } from "../../../types";
import { TooltipIconButton } from "../../../components/ui/tooltip-icon-button";

function isActivationKey(key: string) {
  return key === "Enter" || key === " " || key === "Space" || key === "Spacebar";
}

type WorktreeCardProps = {
  worktree: WorkspaceInfo;
  isActive: boolean;
  isThreadListDegraded?: boolean;
  isThreadListRefreshing?: boolean;
  hasPrimaryActiveThread: boolean;
  hasRunningSession?: boolean;
  showExitedSessionsToggle?: boolean;
  hideExitedSessions?: boolean;
  hiddenExitedSessionsCount?: number;
  threadCount: number;
  hasThreadCursor: boolean;
  isDeleting?: boolean;
  onShowWorktreeMenu: (event: MouseEvent, workspaceId: string) => void;
  onShowWorktreeSessionMenu: (event: MouseEvent, workspace: WorkspaceInfo) => void;
  onQuickReloadWorkspaceThreads?: (workspaceId: string) => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onToggleWorkspaceCollapse: (workspaceId: string, collapsed: boolean) => void;
  onConnectWorkspace: (workspace: WorkspaceInfo) => void;
  onToggleExitedSessions?: (workspacePath: string) => void;
  children?: React.ReactNode;
};

type ParsedWorktreeName = {
  prefix: string | null;
  leaf: string;
};

function parseWorktreeName(rawName: string): ParsedWorktreeName {
  const normalized = rawName.trim();
  if (!normalized) {
    return { prefix: null, leaf: rawName };
  }
  const separatorIndex = Math.max(
    normalized.lastIndexOf("/"),
    normalized.lastIndexOf("\\"),
  );
  if (separatorIndex <= 0 || separatorIndex >= normalized.length - 1) {
    return { prefix: null, leaf: normalized };
  }
  return {
    prefix: normalized.slice(0, separatorIndex),
    leaf: normalized.slice(separatorIndex + 1),
  };
}

export function WorktreeCard({
  worktree,
  isActive,
  isThreadListDegraded = false,
  isThreadListRefreshing = false,
  hasPrimaryActiveThread,
  hasRunningSession = false,
  showExitedSessionsToggle = false,
  hideExitedSessions = false,
  hiddenExitedSessionsCount = 0,
  threadCount,
  hasThreadCursor,
  isDeleting = false,
  onShowWorktreeMenu,
  onShowWorktreeSessionMenu,
  onQuickReloadWorkspaceThreads,
  onSelectWorkspace,
  onToggleWorkspaceCollapse,
  onConnectWorkspace,
  onToggleExitedSessions,
  children,
}: WorktreeCardProps) {
  const { t } = useTranslation();
  const worktreeCollapsed = worktree.settings.sidebarCollapsed;
  const worktreeBranch = worktree.worktree?.branch ?? "";
  const displayName = worktreeBranch || worktree.name;
  const parsedName = parseWorktreeName(displayName);
  const canQuickReloadThreadList =
    isThreadListDegraded && typeof onQuickReloadWorkspaceThreads === "function";
  const exitedSessionsToggleLabel = hideExitedSessions
    ? t("threads.showExitedSessions")
    : t("threads.hideExitedSessions");
  const exitedSessionsToggleTitle =
    hideExitedSessions && hiddenExitedSessionsCount > 0
      ? `${exitedSessionsToggleLabel} · ${t("threads.exitedSessionsHidden", {
          count: hiddenExitedSessionsCount,
        })}`
      : exitedSessionsToggleLabel;
  const hiddenExitedSessionsCountLabel =
    hiddenExitedSessionsCount > 99 ? "99+" : String(hiddenExitedSessionsCount);
  const handleToggleCollapse = () => {
    onToggleWorkspaceCollapse(worktree.id, !worktreeCollapsed);
  };

  return (
    <div className={`worktree-card${isDeleting ? " deleting" : ""}`}>
      <div
        className={`worktree-row ${
          isActive
            ? hasPrimaryActiveThread
              ? "context-active"
              : "active"
            : ""
        }${isDeleting ? " deleting" : ""}`}
        role="button"
        tabIndex={isDeleting ? -1 : 0}
        aria-disabled={isDeleting}
        aria-expanded={!worktreeCollapsed}
        onClick={(event) => {
          if (!isDeleting && event.detail <= 1) {
            handleToggleCollapse();
          }
        }}
        onContextMenu={(event) => {
          if (!isDeleting) {
            onShowWorktreeMenu(event, worktree.id);
          }
        }}
        title={displayName}
        onKeyDown={(event) => {
          if (isDeleting) {
            return;
          }
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            handleToggleCollapse();
          }
        }}
      >
        <div
          className={`worktree-leading-icons${showExitedSessionsToggle && onToggleExitedSessions ? " has-exited-toggle" : ""}`}
        >
          <GitBranch
            className={`worktree-node-icon${hasRunningSession ? " is-session-running" : ""}`}
            aria-hidden
          />
          {showExitedSessionsToggle && onToggleExitedSessions ? (
            <button
              type="button"
              className={`workspace-exited-toggle${hideExitedSessions ? " is-active" : ""}`}
              aria-pressed={hideExitedSessions}
              aria-label={exitedSessionsToggleTitle}
              title={exitedSessionsToggleTitle}
              data-tauri-drag-region="false"
              onClick={(event) => {
                event.stopPropagation();
                onToggleExitedSessions(worktree.path);
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
              }}
              onKeyDown={(event) => {
                if (isActivationKey(event.key)) {
                  event.stopPropagation();
                }
              }}
              onKeyUp={(event) => {
                if (isActivationKey(event.key)) {
                  event.stopPropagation();
                }
              }}
            >
              {hideExitedSessions ? <EyeOff size={10} aria-hidden /> : <Eye size={10} aria-hidden />}
              {hideExitedSessions && hiddenExitedSessionsCount > 0 ? (
                <span className="workspace-exited-toggle-count" aria-hidden>
                  {hiddenExitedSessionsCountLabel}
                </span>
              ) : null}
            </button>
          ) : null}
        </div>
        <div className="worktree-label-wrap">
          {parsedName.prefix ? (
            <span className="worktree-label-prefix">{parsedName.prefix}</span>
          ) : null}
          <div className="worktree-label">{parsedName.leaf}</div>
        </div>
        <div className="worktree-actions">
          {isDeleting ? (
            <div className="worktree-deleting" role="status" aria-live="polite">
              <span className="worktree-deleting-spinner" aria-hidden />
              <span className="worktree-deleting-label">{t("common.deleting")}</span>
            </div>
          ) : (
            <>
              {canQuickReloadThreadList ? (
                <TooltipIconButton
                  className="worktree-create-session-button worktree-degraded-badge"
                  onClick={(event) => {
                    event.stopPropagation();
                    onQuickReloadWorkspaceThreads(worktree.id);
                  }}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                  }}
                  label={
                    isThreadListRefreshing
                      ? t("threads.degradedWorkspaceRefreshingTooltip")
                      : t("threads.degradedWorkspaceRefreshTooltip")
                  }
                  aria-label={
                    isThreadListRefreshing
                      ? t("threads.degradedWorkspaceRefreshingAriaLabel")
                      : t("threads.degradedWorkspaceRefreshAriaLabel")
                  }
                  data-tauri-drag-region="false"
                  disabled={isDeleting || isThreadListRefreshing}
                >
                  <RefreshCw
                    size={13}
                    aria-hidden
                    className={isThreadListRefreshing ? "sidebar-refresh-icon is-spinning" : "sidebar-refresh-icon"}
                  />
                </TooltipIconButton>
              ) : null}
              <button
                type="button"
                className="worktree-create-session-button"
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectWorkspace(worktree.id);
                }}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                }}
                data-tauri-drag-region="false"
                aria-label={t("sidebar.activateWorkspace")}
                title={t("sidebar.activateWorkspace")}
                disabled={isActive}
              >
                <ArrowRight size={13} aria-hidden />
              </button>
              <button
                type="button"
                className="worktree-create-session-button"
                onClick={(event) => {
                  event.stopPropagation();
                  onShowWorktreeSessionMenu(event, worktree);
                }}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                }}
                data-tauri-drag-region="false"
                aria-label={t("sidebar.sessionActionsGroup")}
                title={t("sidebar.sessionActionsGroup")}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  aria-hidden
                >
                  <path
                    d="M7 3V11"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                  <path
                    d="M3 7H11"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
              {(threadCount > 0 || hasThreadCursor) && (
                <span className="worktree-thread-count" aria-label={`Threads: ${threadCount}`}>
                  {threadCount > 0 ? threadCount : "0"}
                  {hasThreadCursor ? "+" : ""}
                </span>
              )}
              <button
                className={`worktree-toggle ${worktreeCollapsed ? "" : "expanded"}`}
                onClick={(event) => {
                  event.stopPropagation();
                  handleToggleCollapse();
                }}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                }}
                data-tauri-drag-region="false"
                aria-label={worktreeCollapsed ? "Show agents" : "Hide agents"}
                aria-expanded={!worktreeCollapsed}
              >
                <span className="worktree-toggle-icon">›</span>
              </button>
              {!worktree.connected && (
                <span
                  className="connect"
                  onClick={(event) => {
                    event.stopPropagation();
                    onConnectWorkspace(worktree);
                  }}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                  }}
                >
                  connect
                </span>
              )}
            </>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}
