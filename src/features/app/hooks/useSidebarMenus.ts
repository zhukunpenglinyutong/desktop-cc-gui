import { useCallback, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Menu, MenuItem } from "@tauri-apps/api/menu";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";

import type { EngineType, WorkspaceInfo } from "../../../types";
import { formatByteSize } from "../../../utils/formatting";

export type WorkspaceMenuIconKind =
  | "engine-claude"
  | "engine-codex"
  | "engine-opencode"
  | "engine-gemini"
  | "new-shared"
  | "reload"
  | "remove"
  | "new-worktree"
  | "new-clone";

export type WorkspaceMenuAction = {
  id: string;
  label: string;
  iconKind: WorkspaceMenuIconKind;
  tone?: "default" | "danger";
  deprecated?: boolean;
  unavailable?: boolean;
  onSelect: () => void;
};

export type WorkspaceMenuGroup = {
  id: string;
  label: string;
  actions: WorkspaceMenuAction[];
};

export type WorkspaceMenuState = {
  x: number;
  y: number;
  workspaceId: string;
  groups: WorkspaceMenuGroup[];
};

type SidebarMenuHandlers = {
  onAddAgent: (workspace: WorkspaceInfo, engine?: EngineType) => void;
  onAddSharedAgent?: (workspace: WorkspaceInfo) => void;
  onDeleteThread: (workspaceId: string, threadId: string) => void;
  onSyncThread: (workspaceId: string, threadId: string) => void;
  onPinThread: (workspaceId: string, threadId: string) => void;
  onUnpinThread: (workspaceId: string, threadId: string) => void;
  isThreadPinned: (workspaceId: string, threadId: string) => boolean;
  isThreadAutoNaming: (workspaceId: string, threadId: string) => boolean;
  onRenameThread: (workspaceId: string, threadId: string) => void;
  onAutoNameThread: (workspaceId: string, threadId: string) => void;
  onReloadWorkspaceThreads: (workspaceId: string) => void;
  onDeleteWorkspace: (workspaceId: string) => void;
  onDeleteWorktree: (workspaceId: string) => void;
  onAddWorktreeAgent: (workspace: WorkspaceInfo) => void;
  onAddCloneAgent: (workspace: WorkspaceInfo) => void;
};

export function useSidebarMenus({
  onAddAgent,
  onAddSharedAgent,
  onDeleteThread,
  onSyncThread,
  onPinThread,
  onUnpinThread,
  isThreadPinned,
  isThreadAutoNaming,
  onRenameThread,
  onAutoNameThread,
  onReloadWorkspaceThreads,
  onDeleteWorkspace,
  onDeleteWorktree,
  onAddWorktreeAgent,
  onAddCloneAgent,
}: SidebarMenuHandlers) {
  const { t } = useTranslation();
  const [workspaceMenuState, setWorkspaceMenuState] =
    useState<WorkspaceMenuState | null>(null);

  const closeWorkspaceMenu = useCallback(() => {
    setWorkspaceMenuState(null);
  }, []);

  const onWorkspaceMenuAction = useCallback(
    (action: WorkspaceMenuAction) => {
      if (action.unavailable) {
        return;
      }
      closeWorkspaceMenu();
      action.onSelect();
    },
    [closeWorkspaceMenu],
  );

  const showThreadMenu = useCallback(
    async (
      event: MouseEvent,
      workspaceId: string,
      threadId: string,
      canPin: boolean,
      sizeBytes?: number,
    ) => {
      event.preventDefault();
      event.stopPropagation();
      const isClaudeSession = threadId.startsWith("claude:");
      const renameItem = await MenuItem.new({
        text: t("threads.rename"),
        action: () => onRenameThread(workspaceId, threadId),
      });
      const isAutoNamingNow = isThreadAutoNaming(workspaceId, threadId);
      const autoNameItem = await MenuItem.new({
        text: isAutoNamingNow
          ? t("threads.autoNaming")
          : t("threads.autoName"),
        action: () => {
          if (isAutoNamingNow) {
            return;
          }
          onAutoNameThread(workspaceId, threadId);
        },
      });
      const copyItem = await MenuItem.new({
        text: t("threads.copyId"),
        action: async () => {
          try {
            const copyId = isClaudeSession
              ? threadId.slice("claude:".length)
              : threadId;
            await navigator.clipboard.writeText(copyId);
          } catch {
            // Clipboard failures are non-fatal here.
          }
        },
      });
      const items = [renameItem, autoNameItem];
      // Sync and archive are Codex-specific — skip for Claude sessions
      if (!isClaudeSession) {
        const syncItem = await MenuItem.new({
          text: t("threads.syncFromServer"),
          action: () => onSyncThread(workspaceId, threadId),
        });
        items.push(syncItem);
      }
      if (canPin) {
        const isPinned = isThreadPinned(workspaceId, threadId);
        items.push(
          await MenuItem.new({
            text: isPinned ? t("threads.unpin") : t("threads.pin"),
            action: () => {
              if (isPinned) {
                onUnpinThread(workspaceId, threadId);
              } else {
                onPinThread(workspaceId, threadId);
              }
            },
          }),
        );
      }
      items.push(copyItem);
      const sizeLabel = formatByteSize(sizeBytes);
      if (sizeLabel) {
        items.push(
          await MenuItem.new({
            text: `${t("threads.size")}: ${sizeLabel}`,
            enabled: false,
          }),
        );
      }
      const deleteItem = await MenuItem.new({
        text: t("threads.delete"),
        action: () => onDeleteThread(workspaceId, threadId),
      });
      items.push(deleteItem);
      const menu = await Menu.new({ items });
      const window = getCurrentWindow();
      const position = new LogicalPosition(event.clientX, event.clientY);
      await menu.popup(position, window);
    },
    [
      t,
      isThreadPinned,
      isThreadAutoNaming,
      onDeleteThread,
      onPinThread,
      onAutoNameThread,
      onRenameThread,
      onSyncThread,
      onUnpinThread,
    ],
  );

  const showWorkspaceMenu = useCallback(
    (event: MouseEvent, workspace: WorkspaceInfo) => {
      event.preventDefault();
      event.stopPropagation();
      const workspaceId = workspace.id;

      const menuWidthEstimate = 328;
      const menuHeightEstimate = 420;
      const viewportPadding = 12;
      const maxX = Math.max(
        viewportPadding,
        window.innerWidth - menuWidthEstimate - viewportPadding,
      );
      const maxY = Math.max(
        viewportPadding,
        window.innerHeight - menuHeightEstimate - viewportPadding,
      );
      const x = Math.min(Math.max(event.clientX, viewportPadding), maxX);
      const y = Math.min(Math.max(event.clientY, viewportPadding), maxY);

      const groups: WorkspaceMenuGroup[] = [
        {
          id: "new-session",
          label: t("sidebar.sessionActionsGroup"),
          actions: [
            {
              id: "new-session-shared",
              label: t("sidebar.newSharedSession"),
              iconKind: "new-shared",
              unavailable: !onAddSharedAgent,
              onSelect: () => onAddSharedAgent?.(workspace),
            },
            {
              id: "new-session-claude",
              label: t("workspace.engineClaudeCode"),
              iconKind: "engine-claude",
              onSelect: () => onAddAgent(workspace, "claude"),
            },
            {
              id: "new-session-codex",
              label: t("workspace.engineCodex"),
              iconKind: "engine-codex",
              onSelect: () => onAddAgent(workspace, "codex"),
            },
            {
              id: "new-session-opencode",
              label: t("workspace.engineOpenCode"),
              iconKind: "engine-opencode",
              onSelect: () => onAddAgent(workspace, "opencode"),
            },
            {
              id: "new-session-gemini",
              label: t("workspace.engineGemini"),
              iconKind: "engine-gemini",
              onSelect: () => onAddAgent(workspace, "gemini"),
            },
          ],
        },
        {
          id: "workspace-actions",
          label: t("sidebar.workspaceActionsGroup"),
          actions: [
            {
              id: "reload-threads",
              label: t("threads.reloadThreads"),
              iconKind: "reload",
              onSelect: () => onReloadWorkspaceThreads(workspaceId),
            },
            {
              id: "remove-workspace",
              label: t("sidebar.removeWorkspace"),
              iconKind: "remove",
              tone: "danger",
              onSelect: () => onDeleteWorkspace(workspaceId),
            },
            {
              id: "new-worktree-agent",
              label: t("sidebar.newWorktreeAgent"),
              iconKind: "new-worktree",
              onSelect: () => onAddWorktreeAgent(workspace),
            },
            {
              id: "new-clone-agent",
              label: t("sidebar.newCloneAgent"),
              iconKind: "new-clone",
              deprecated: true,
              onSelect: () => onAddCloneAgent(workspace),
            },
          ],
        },
      ];

      setWorkspaceMenuState({
        x,
        y,
        workspaceId,
        groups,
      });
    },
    [
      t,
      onAddAgent,
      onAddSharedAgent,
      onReloadWorkspaceThreads,
      onDeleteWorkspace,
      onAddWorktreeAgent,
      onAddCloneAgent,
    ],
  );

  const showWorktreeMenu = useCallback(
    async (event: MouseEvent, workspaceId: string) => {
      event.preventDefault();
      event.stopPropagation();
      const reloadItem = await MenuItem.new({
        text: t("threads.reloadThreads"),
        action: () => onReloadWorkspaceThreads(workspaceId),
      });
      const deleteItem = await MenuItem.new({
        text: t("threads.deleteWorktree"),
        action: () => onDeleteWorktree(workspaceId),
      });
      const menu = await Menu.new({ items: [reloadItem, deleteItem] });
      const window = getCurrentWindow();
      const position = new LogicalPosition(event.clientX, event.clientY);
      await menu.popup(position, window);
    },
    [t, onReloadWorkspaceThreads, onDeleteWorktree],
  );

  return {
    showThreadMenu,
    showWorkspaceMenu,
    showWorktreeMenu,
    workspaceMenuState,
    closeWorkspaceMenu,
    onWorkspaceMenuAction,
  };
}
