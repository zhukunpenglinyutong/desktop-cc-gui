import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipPopup,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { CSSProperties, MouseEvent } from "react";
import { useTranslation } from "react-i18next";

import type { ThreadSummary } from "../../../types";
import { ProxyStatusBadge } from "../../../components/ProxyStatusBadge";
import { EngineIcon } from "../../engine/components/EngineIcon";
import { SharedSessionIcon } from "../../shared-session/components/SharedSessionIcon";
import { ThreadDeleteConfirmBubble } from "../../threads/components/ThreadDeleteConfirmBubble";

type ThreadStatusMap = Record<
  string,
  { isProcessing: boolean; hasUnread: boolean; isReviewing: boolean }
>;

type PinnedThreadRow = {
  thread: ThreadSummary;
  depth: number;
  workspaceId: string;
};

type PinnedThreadListProps = {
  rows: PinnedThreadRow[];
  activeWorkspaceId: string | null;
  activeThreadId: string | null;
  systemProxyEnabled?: boolean;
  systemProxyUrl?: string | null;
  threadStatusById: ThreadStatusMap;
  getThreadTime: (thread: ThreadSummary) => string | null;
  isThreadPinned: (workspaceId: string, threadId: string) => boolean;
  isThreadAutoNaming: (workspaceId: string, threadId: string) => boolean;
  onToggleThreadPin?: (workspaceId: string, threadId: string) => void;
  onSelectThread: (workspaceId: string, threadId: string) => void;
  onShowThreadMenu: (
    event: MouseEvent,
    workspaceId: string,
    threadId: string,
    canPin: boolean,
  ) => void;
  deleteConfirmThreadId?: string | null;
  deleteConfirmWorkspaceId?: string | null;
  deleteConfirmBusy?: boolean;
  onCancelDeleteConfirm?: () => void;
  onConfirmDeleteConfirm?: () => void;
};

export function PinnedThreadList({
  rows,
  activeWorkspaceId,
  activeThreadId,
  systemProxyEnabled = false,
  systemProxyUrl = null,
  threadStatusById,
  getThreadTime,
  isThreadPinned,
  isThreadAutoNaming,
  onToggleThreadPin,
  onSelectThread,
  onShowThreadMenu,
  deleteConfirmThreadId = null,
  deleteConfirmWorkspaceId = null,
  deleteConfirmBusy = false,
  onCancelDeleteConfirm,
  onConfirmDeleteConfirm,
}: PinnedThreadListProps) {
  const { t } = useTranslation();

  return (
    <div className="thread-list pinned-thread-list">
      {rows.map(({ thread, depth, workspaceId }) => {
        const relativeTime = getThreadTime(thread);
        const indentStyle =
          depth > 0
            ? ({ "--thread-indent": `${depth * 14}px` } as CSSProperties)
            : undefined;
        const status = threadStatusById[thread.id];
        const statusClass = status?.isReviewing
          ? "reviewing"
          : status?.isProcessing
            ? "processing"
            : status?.hasUnread
              ? "unread"
              : "ready";
        const isProcessing = Boolean(status?.isProcessing);
        const canPin = depth === 0;
        const isPinned = canPin && isThreadPinned(workspaceId, thread.id);
        const isAutoNaming = isThreadAutoNaming(workspaceId, thread.id);
        const showProxyBadge = systemProxyEnabled && isProcessing;
        const isSharedThread = thread.threadKind === "shared";
        const engineSource = thread.engineSource ?? "codex";
        const baseEngineTitle =
          engineSource === "claude"
            ? "Claude Code"
            : engineSource === "gemini"
              ? "Gemini"
              : engineSource === "opencode"
                ? "OpenCode"
                : "Codex";
        const engineTitle =
          isSharedThread
            ? `Shared Session · ${baseEngineTitle}`
            : baseEngineTitle;
        const isDeleteConfirmOpen =
          deleteConfirmWorkspaceId === workspaceId && deleteConfirmThreadId === thread.id;

        return (
          <Popover
            key={`${workspaceId}:${thread.id}`}
            open={isDeleteConfirmOpen}
            onOpenChange={(open) => {
              if (!open) {
                onCancelDeleteConfirm?.();
              }
            }}
          >
            <Tooltip>
              <PopoverAnchor asChild>
                <TooltipTrigger
                  delay={450}
                  className={`thread-row ${
                    workspaceId === activeWorkspaceId && thread.id === activeThreadId
                      ? "active"
                      : ""
                  }${isDeleteConfirmOpen ? " has-delete-confirm" : ""}${
                    canPin ? " has-pin-toggle" : ""
                  }`}
                  style={indentStyle}
                  onClick={() => onSelectThread(workspaceId, thread.id)}
                  onContextMenu={(event) =>
                    onShowThreadMenu(event, workspaceId, thread.id, canPin)
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectThread(workspaceId, thread.id);
                    }
                  }}
                >
                  <span className={`thread-status ${statusClass}`} aria-hidden />
                  {canPin && onToggleThreadPin && (
                    <span
                      className={`thread-pin-toggle${isPinned ? " is-pinned" : ""}`}
                      role="button"
                      aria-label={isPinned ? t("threads.unpin") : t("threads.pin")}
                      title={isPinned ? t("threads.unpin") : t("threads.pin")}
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onToggleThreadPin(workspaceId, thread.id);
                      }}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                    >
                      <span className="thread-pin-toggle-icon" aria-hidden />
                    </span>
                  )}
                  <span
                    className={`thread-engine-badge ${
                      isSharedThread ? "thread-engine-shared" : `thread-engine-${engineSource}`
                    }${isProcessing ? " is-processing" : ""}`}
                    title={engineTitle}
                  >
                    {isSharedThread ? (
                      <SharedSessionIcon size={12} />
                    ) : (
                      <EngineIcon engine={engineSource} size={12} />
                    )}
                  </span>
                  {showProxyBadge && (
                    <ProxyStatusBadge
                      proxyUrl={systemProxyUrl}
                      label={t("threads.proxyBadge")}
                      variant="compact"
                      className="thread-proxy-badge"
                    />
                  )}
                  <span className="thread-name">{thread.name}</span>
                  <div className="thread-meta">
                    {isAutoNaming && (
                      <span className="thread-auto-naming">{t("threads.autoNaming")}</span>
                    )}
                    {relativeTime && <span className="thread-time">{relativeTime}</span>}
                  </div>
                </TooltipTrigger>
              </PopoverAnchor>
              <TooltipPopup
                side="top"
                align="start"
                sideOffset={4}
                className="max-w-[400px] break-words"
              >
                {thread.name}
              </TooltipPopup>
            </Tooltip>
            {isDeleteConfirmOpen && (
              <PopoverContent
                side="right"
                align="start"
                sideOffset={10}
                className="thread-delete-popover-shell"
                onOpenAutoFocus={(event) => event.preventDefault()}
              >
                <ThreadDeleteConfirmBubble
                  threadName={thread.name}
                  isDeleting={deleteConfirmBusy}
                  onCancel={() => onCancelDeleteConfirm?.()}
                  onConfirm={() => onConfirmDeleteConfirm?.()}
                />
              </PopoverContent>
            )}
          </Popover>
        );
      })}
    </div>
  );
}
