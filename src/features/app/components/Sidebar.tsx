import type {
  AccountSnapshot,
  AppMode,
  ConversationItem,
  EngineType,
  RateLimitSnapshot,
  ThreadSummary,
  WorkspaceInfo,
} from "../../../types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode, RefObject } from "react";
import { useTranslation } from "react-i18next";

import { ThreadList } from "./ThreadList";
import { ThreadEmptyState } from "./ThreadEmptyState";
import { WorktreeSection } from "./WorktreeSection";
import { PinnedThreadList } from "./PinnedThreadList";
import { WorkspaceCard } from "./WorkspaceCard";
import { WorkspaceGroup } from "./WorkspaceGroup";
import { WorkspaceSessionFolderTree } from "./WorkspaceSessionFolderTree";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RendererContextMenu } from "../../../components/ui/RendererContextMenu";
import { useCollapsedGroups } from "../hooks/useCollapsedGroups";
import { useExitedSessionVisibility } from "../hooks/useExitedSessionVisibility";
import { registerKeydownHandler } from "../hooks/keyboardDispatcher";
import { useSidebarMenus } from "../hooks/useSidebarMenus";
import type { ThreadMoveFolderTarget } from "../hooks/useSidebarMenus";
import { useSidebarScrollFade } from "../hooks/useSidebarScrollFade";
import { useThreadRows } from "../hooks/useThreadRows";
import { parseToolArgs } from "../../messages/components/toolBlocks/toolConstants";
import { isDefaultWorkspacePath } from "../../workspaces/utils/defaultWorkspace";
import { formatShortcutForPlatform, isMacPlatform } from "../../../utils/shortcuts";
import { formatRelativeTimeShort } from "../../../utils/time";
import { EngineIcon } from "../../engine/components/EngineIcon";
import type {
  EngineDisplayInfo,
  EngineRefreshResult,
} from "../../engine/hooks/useEngineController";
import { TooltipIconButton } from "../../../components/ui/tooltip-icon-button";
import { SharedSessionIcon } from "../../shared-session/components/SharedSessionIcon";
import { pushErrorToast } from "../../../services/toasts";
import {
  getClientStoreSync,
  writeClientStoreValue,
} from "../../../services/clientStorage";
import Brain from "lucide-react/dist/esm/icons/brain";
import BriefcaseBusiness from "lucide-react/dist/esm/icons/briefcase-business";
import ChevronUp from "lucide-react/dist/esm/icons/chevron-up";
import ChevronsDownUp from "lucide-react/dist/esm/icons/chevrons-down-up";
import Copy from "lucide-react/dist/esm/icons/copy";
import FileText from "lucide-react/dist/esm/icons/file-text";
import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import House from "lucide-react/dist/esm/icons/house";
import LayoutDashboard from "lucide-react/dist/esm/icons/layout-dashboard";
import Lock from "lucide-react/dist/esm/icons/lock";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import Settings from "lucide-react/dist/esm/icons/settings";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import {
  getWorkspaceSidebarAlias,
  getWorkspaceSidebarLabel,
} from "../utils/workspaceSidebarLabel";
import { normalizeVisibleThreadRootCount } from "../constants";
import { getExitedSessionRowVisibility } from "../utils/exitedSessionRows";
import {
  buildWorkspaceSessionFolderMoveTargets,
  buildWorkspaceSessionFolderProjection,
} from "../utils/workspaceSessionFolders";
import {
  assignWorkspaceSessionFolder,
  createWorkspaceSessionFolder,
  deleteWorkspaceSessionFolder,
  listWorkspaceSessionFolders,
  renameWorkspaceSessionFolder,
  type WorkspaceSessionFolder,
} from "../../../services/tauri";

type WorkspaceGroupSection = {
  id: string | null;
  name: string;
  workspaces: WorkspaceInfo[];
};

type WorkspaceThreadRows = {
  unpinnedRows: Array<{ thread: ThreadSummary; depth: number }>;
  totalRoots: number;
};

type ToolConversationItem = Extract<ConversationItem, { kind: "tool" }>;

type ThreadFolderMovePickerState = {
  workspaceId: string;
  threadId: string;
  targets: ThreadMoveFolderTarget[];
  currentFolderId: string | null;
};

const SESSION_FOLDER_COLLAPSED_STATE_KEY = "workspaceSessionFolders.collapsedByWorkspaceId";

function readPersistedCollapsedSessionFolderIds(): Record<string, string[]> {
  const stored = getClientStoreSync<Record<string, unknown>>(
    "layout",
    SESSION_FOLDER_COLLAPSED_STATE_KEY,
  );
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    return {};
  }
  const normalized: Record<string, string[]> = {};
  Object.entries(stored).forEach(([workspaceId, rawIds]) => {
    if (!Array.isArray(rawIds)) {
      return;
    }
    const folderIds = rawIds
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean);
    if (folderIds.length > 0) {
      normalized[workspaceId] = Array.from(new Set(folderIds));
    }
  });
  return normalized;
}

function writePersistedCollapsedSessionFolderIds(value: Record<string, string[]>): void {
  writeClientStoreValue("layout", SESSION_FOLDER_COLLAPSED_STATE_KEY, value);
}

function updateCollapsedSessionFolderIdsForWorkspace(
  current: Record<string, string[]>,
  workspaceId: string,
  folderIds: string[],
): Record<string, string[]> {
  const normalizedIds = Array.from(new Set(folderIds.map((id) => id.trim()).filter(Boolean)));
  if (normalizedIds.length === 0) {
    const { [workspaceId]: _removed, ...rest } = current;
    return rest;
  }
  return {
    ...current,
    [workspaceId]: normalizedIds,
  };
}

function isPendingEngineThreadId(threadId: string): boolean {
  const normalizedThreadId = threadId.trim();
  return (
    normalizedThreadId.startsWith("codex-pending-") ||
    normalizedThreadId.startsWith("claude-pending-") ||
    normalizedThreadId.startsWith("gemini-pending-") ||
    normalizedThreadId.startsWith("opencode-pending-")
  );
}

function isSharedSessionThreadId(threadId: string): boolean {
  return threadId.trim().startsWith("shared:");
}

function isSessionCatalogNotReadyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("session does not belong to target workspace");
}

function resolveEnginePrefix(threadId: string): "claude" | "gemini" | "opencode" | "codex" {
  if (threadId.startsWith("claude:") || threadId.startsWith("claude-pending-")) {
    return "claude";
  }
  if (threadId.startsWith("gemini:") || threadId.startsWith("gemini-pending-")) {
    return "gemini";
  }
  if (threadId.startsWith("opencode:") || threadId.startsWith("opencode-pending-")) {
    return "opencode";
  }
  if (threadId.startsWith("codex:") || threadId.startsWith("codex-pending-")) {
    return "codex";
  }
  return "codex";
}

function resolveFolderIntentReplacementThreadId(
  pendingThreadId: string,
  threads: ThreadSummary[],
): string | null {
  if (!isPendingEngineThreadId(pendingThreadId)) {
    return pendingThreadId;
  }
  const pendingEngine = resolveEnginePrefix(pendingThreadId);
  const sameEngineRealThreads = threads.filter((thread) => {
    const engineSource = thread.engineSource ?? resolveEnginePrefix(thread.id);
    return (
      engineSource === pendingEngine &&
      thread.id.startsWith(`${pendingEngine}:`) &&
      !thread.id.includes("-pending-")
    );
  });
  if (sameEngineRealThreads.length !== 1) {
    return null;
  }
  return sameEngineRealThreads[0]?.id ?? null;
}

function isClaudeThreadId(threadId: string | null | undefined) {
  return Boolean(threadId?.startsWith("claude:") || threadId?.startsWith("claude-pending-"));
}

function isPendingSubagentThreadId(threadId: string) {
  return threadId.startsWith("claude-pending-subagent:");
}

function resolveThreadParentId(
  thread: ThreadSummary,
  threadParentById: Record<string, string>,
) {
  return thread.parentThreadId ?? threadParentById[thread.id] ?? null;
}

function collectThreadSubtreeIds(
  threads: ThreadSummary[],
  threadParentById: Record<string, string>,
  rootThreadId: string,
) {
  const childrenByParent = new Map<string, string[]>();
  threads.forEach((thread) => {
    const parentId = resolveThreadParentId(thread, threadParentById);
    if (!parentId || parentId === thread.id) {
      return;
    }
    const children = childrenByParent.get(parentId) ?? [];
    children.push(thread.id);
    childrenByParent.set(parentId, children);
  });

  const subtreeIds: string[] = [];
  const visited = new Set<string>();
  const visit = (threadId: string) => {
    if (visited.has(threadId)) {
      return;
    }
    visited.add(threadId);
    subtreeIds.push(threadId);
    (childrenByParent.get(threadId) ?? []).forEach(visit);
  };
  visit(rootThreadId);
  return subtreeIds;
}

function normalizeRuntimeString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function extractToolName(title: unknown) {
  return normalizeRuntimeString(title).replace(/^Tool:\s*/i, "").trim();
}

function isClaudeAgentTool(item: ToolConversationItem) {
  const normalizedToolType = normalizeRuntimeString(item.toolType).trim().toLowerCase();
  const normalizedToolName = extractToolName(item.title).trim().toLowerCase();
  return normalizedToolType === "agent" || normalizedToolName === "agent";
}

function getFirstStringField(source: Record<string, unknown> | null, keys: string[]) {
  if (!source) {
    return "";
  }
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function isCompletedToolStatus(status: string | undefined, output: string | undefined) {
  const normalized = status?.trim().toLowerCase() ?? "";
  return Boolean(output) || normalized === "completed" || normalized === "success";
}

function buildClaudeLiveSubagentRows(
  threads: ThreadSummary[],
  workspaceId: string,
  activeWorkspaceId: string | null,
  activeThreadId: string | null,
  activeItems: ConversationItem[],
): ThreadSummary[] {
  if (workspaceId !== activeWorkspaceId || !isClaudeThreadId(activeThreadId)) {
    return threads;
  }
  const parent = threads.find((thread) => thread.id === activeThreadId);
  if (!parent) {
    return threads;
  }
  const threadIds = new Set(threads.map((thread) => thread.id));
  const parentSessionId = activeThreadId?.replace(/^claude:/, "") ?? "";
  let unmatchedRealChildCount = threads.filter(
    (thread) =>
      thread.parentThreadId === activeThreadId ||
      thread.id.startsWith(`claude:subagent:${parentSessionId}:`),
  ).length;
  const pendingRows: ThreadSummary[] = [];

  activeItems.forEach((item) => {
    if (item.kind !== "tool" || !isClaudeAgentTool(item)) {
      return;
    }
    const args = parseToolArgs(normalizeRuntimeString(item.detail));
    const taskId = getFirstStringField(args, ["task_id", "taskId"]);
    const stableAgentId = getFirstStringField(args, ["agent_id", "agentId"]);
    const childSessionId = stableAgentId
      ? `claude:subagent:${parentSessionId}:${stableAgentId}`
      : "";
    if (childSessionId && threadIds.has(childSessionId)) {
      return;
    }
    const output = normalizeRuntimeString(item.output);
    if (!stableAgentId && isCompletedToolStatus(item.status, output) && unmatchedRealChildCount > 0) {
      unmatchedRealChildCount -= 1;
      return;
    }
    const pendingId = `claude-pending-subagent:${activeThreadId}:${taskId || item.id}`;
    if (threadIds.has(pendingId)) {
      return;
    }
    const description =
      getFirstStringField(args, ["description", "prompt", "query", "task"]) ||
      output.split(/\r?\n/, 1)[0]?.trim() ||
      "Claude subagent";
    const subagentType =
      getFirstStringField(args, ["subagent_type", "agent", "type", "name"]) || "Agent";
    pendingRows.push({
      id: pendingId,
      name: `${subagentType} ${description}`.trim(),
      updatedAt: parent.updatedAt,
      engineSource: "claude",
      threadKind: "native",
      parentThreadId: activeThreadId,
      isDegraded: true,
      degradedReason: isCompletedToolStatus(item.status, item.output)
        ? "Subagent transcript is still being indexed."
        : "Subagent is running; transcript is not available yet.",
    });
  });

  return pendingRows.length > 0 ? [...threads, ...pendingRows] : threads;
}

type SidebarProps = {
  workspaces: WorkspaceInfo[];
  groupedWorkspaces: WorkspaceGroupSection[];
  hasWorkspaceGroups: boolean;
  deletingWorktreeIds: Set<string>;
  threadsByWorkspace: Record<string, ThreadSummary[]>;
  activeItems: ConversationItem[];
  threadParentById: Record<string, string>;
  threadStatusById: Record<
    string,
    { isProcessing: boolean; hasUnread: boolean; isReviewing: boolean }
  >;
  hydratedThreadListWorkspaceIds: ReadonlySet<string>;
  runningSessionCountByWorkspaceId?: Record<string, number>;
  recentSessionCountByWorkspaceId?: Record<string, number>;
  threadListLoadingByWorkspace: Record<string, boolean>;
  threadListPagingByWorkspace: Record<string, boolean>;
  threadListCursorByWorkspace: Record<string, string | null>;
  activeWorkspaceId: string | null;
  activeThreadId: string | null;
  systemProxyEnabled?: boolean;
  systemProxyUrl?: string | null;
  accountRateLimits: RateLimitSnapshot | null;
  usageShowRemaining: boolean;
  accountInfo: AccountSnapshot | null;
  onSwitchAccount: () => void;
  onCancelSwitchAccount: () => void;
  accountSwitching: boolean;
  onOpenSettings: () => void;
  onOpenDebug: () => void;
  showDebugButton?: boolean;
  showTerminalButton?: boolean;
  isTerminalOpen?: boolean;
  onToggleTerminal?: () => void;
  onAddWorkspace: () => void;
  onSelectHome: () => void;
  onSelectWorkspace: (id: string) => void;
  onConnectWorkspace: (workspace: WorkspaceInfo) => void;
  onAddAgent: (
    workspace: WorkspaceInfo,
    engine?: EngineType,
    options?: { folderId?: string | null },
  ) => Promise<string | null> | string | null | void;
  engineOptions?: EngineDisplayInfo[];
  enabledEngines?: Partial<Record<EngineType, boolean>>;
  onRefreshEngineOptions?: () =>
    | Promise<EngineRefreshResult | void>
    | EngineRefreshResult
    | void;
  onAddSharedAgent?: (workspace: WorkspaceInfo) => Promise<string | null> | string | null | void;
  onAddWorktreeAgent: (workspace: WorkspaceInfo) => void;
  onAddCloneAgent: (workspace: WorkspaceInfo) => void;
  onOpenClaudeTui?: (input: {
    workspaceId: string;
    workspacePath: string;
    sessionId: string;
  }) => void;
  onToggleWorkspaceCollapse: (workspaceId: string, collapsed: boolean) => void;
  onSelectThread: (workspaceId: string, threadId: string) => void;
  onDeleteThread: (workspaceId: string, threadId: string) => void;
  onArchiveThread: (workspaceId: string, threadId: string) => void;
  deleteConfirmThreadId?: string | null;
  deleteConfirmWorkspaceId?: string | null;
  deleteConfirmBusy?: boolean;
  onCancelDeleteConfirm?: () => void;
  onConfirmDeleteConfirm?: () => void;
  onSyncThread: (workspaceId: string, threadId: string) => void;
  pinThread: (workspaceId: string, threadId: string) => boolean;
  unpinThread: (workspaceId: string, threadId: string) => void;
  isThreadPinned: (workspaceId: string, threadId: string) => boolean;
  isThreadAutoNaming: (workspaceId: string, threadId: string) => boolean;
  getPinTimestamp: (workspaceId: string, threadId: string) => number | null;
  pinnedThreadsVersion: number;
  onRenameThread: (workspaceId: string, threadId: string) => void;
  onAutoNameThread: (workspaceId: string, threadId: string) => void;
  onDeleteWorkspace: (workspaceId: string) => void;
  onDeleteWorktree: (workspaceId: string) => void;
  onRenameWorkspaceAlias: (workspace: WorkspaceInfo) => void;
  onLoadOlderThreads: (workspaceId: string) => void;
  onReloadWorkspaceThreads: (workspaceId: string) => void;
  onQuickReloadWorkspaceThreads?: (workspaceId: string) => void;
  workspaceDropTargetRef: RefObject<HTMLElement | null>;
  isWorkspaceDropActive: boolean;
  workspaceDropText: string;
  onWorkspaceDragOver: (event: React.DragEvent<HTMLElement>) => void;
  onWorkspaceDragEnter: (event: React.DragEvent<HTMLElement>) => void;
  onWorkspaceDragLeave: (event: React.DragEvent<HTMLElement>) => void;
  onWorkspaceDrop: (event: React.DragEvent<HTMLElement>) => void;
  appMode: AppMode;
  onAppModeChange: (mode: AppMode) => void;
  onOpenHomeChat: () => void;
  onLockPanel?: () => void;
  onOpenProjectMemory: () => void;
  onOpenReleaseNotes: () => void;
  onOpenSpecHub: () => void;
  onOpenWorkspaceHome: () => void;
  onOpenGlobalSearch: () => void;
  globalSearchShortcut: string | null;
  openChatShortcut: string | null;
  openKanbanShortcut: string | null;
  topbarNode?: ReactNode;
};

export function Sidebar({
  workspaces,
  groupedWorkspaces,
  hasWorkspaceGroups: _hasWorkspaceGroups,
  deletingWorktreeIds,
  threadsByWorkspace,
  activeItems,
  threadParentById,
  threadStatusById,
  hydratedThreadListWorkspaceIds,
  runningSessionCountByWorkspaceId: _runningSessionCountByWorkspaceId = {},
  recentSessionCountByWorkspaceId: _recentSessionCountByWorkspaceId = {},
  threadListLoadingByWorkspace: _threadListLoadingByWorkspace,
  threadListPagingByWorkspace,
  threadListCursorByWorkspace,
  activeWorkspaceId,
  activeThreadId,
  systemProxyEnabled = false,
  systemProxyUrl = null,
  accountInfo: _accountInfo,
  onSwitchAccount: _onSwitchAccount,
  onCancelSwitchAccount: _onCancelSwitchAccount,
  accountSwitching: _accountSwitching,
  onOpenSettings,
  onOpenDebug: _onOpenDebug,
  showTerminalButton: _showTerminalButton,
  isTerminalOpen: _isTerminalOpen,
  onToggleTerminal: _onToggleTerminal,
  onAddWorkspace,
  onSelectHome: _onSelectHome,
  onSelectWorkspace,
  onConnectWorkspace,
  onAddAgent,
  engineOptions = [],
  enabledEngines,
  onRefreshEngineOptions,
  onAddSharedAgent,
  onAddWorktreeAgent,
  onAddCloneAgent,
  onOpenClaudeTui,
  onToggleWorkspaceCollapse,
  onSelectThread,
  onDeleteThread,
  onArchiveThread,
  deleteConfirmThreadId = null,
  deleteConfirmWorkspaceId = null,
  deleteConfirmBusy = false,
  onCancelDeleteConfirm,
  onConfirmDeleteConfirm,
  onSyncThread,
  pinThread,
  unpinThread,
  isThreadPinned,
  isThreadAutoNaming,
  getPinTimestamp,
  pinnedThreadsVersion,
  onRenameThread,
  onAutoNameThread,
  onDeleteWorkspace,
  onDeleteWorktree,
  onRenameWorkspaceAlias,
  onLoadOlderThreads,
  onReloadWorkspaceThreads,
  onQuickReloadWorkspaceThreads,
  workspaceDropTargetRef,
  isWorkspaceDropActive,
  workspaceDropText,
  onWorkspaceDragOver,
  onWorkspaceDragEnter,
  onWorkspaceDragLeave,
  onWorkspaceDrop,
  appMode,
  onAppModeChange,
  onOpenHomeChat,
  onLockPanel,
  onOpenProjectMemory,
  onOpenReleaseNotes,
  onOpenSpecHub,
  onOpenWorkspaceHome: _onOpenWorkspaceHome,
  onOpenGlobalSearch,
  globalSearchShortcut,
  openChatShortcut,
  openKanbanShortcut,
  topbarNode,
}: SidebarProps) {
  const { t } = useTranslation();
  const quickSearchLabel = t("sidebar.quickSearch");
  const isMac = isMacPlatform();
  const quickChatShortcutLabel = useMemo(
    () => formatShortcutForPlatform(openChatShortcut, isMac),
    [isMac, openChatShortcut],
  );
  const quickKanbanShortcutLabel = useMemo(
    () => formatShortcutForPlatform(openKanbanShortcut, isMac),
    [isMac, openKanbanShortcut],
  );
  const quickSearchShortcutLabel = useMemo(
    () => formatShortcutForPlatform(globalSearchShortcut, isMac),
    [globalSearchShortcut, isMac],
  );

  const [expandedWorkspaces, setExpandedWorkspaces] = useState<Set<string>>(
    () => new Set(),
  );
  const [collapsedWorktreeSections, setCollapsedWorktreeSections] = useState<Set<string>>(
    () => new Set(),
  );
  const [sessionFoldersByWorkspaceId, setSessionFoldersByWorkspaceId] = useState<
    Record<string, WorkspaceSessionFolder[]>
  >(() => ({}));
  const loadedSessionFolderWorkspaceIdsRef = useRef<Set<string>>(new Set());
  const [sessionFolderErrorByWorkspaceId, setSessionFolderErrorByWorkspaceId] = useState<
    Record<string, string>
  >(() => ({}));
  const [sessionFolderOverrideByWorkspaceId, setSessionFolderOverrideByWorkspaceId] = useState<
    Record<string, Record<string, string | null>>
  >(() => ({}));
  const [
    pendingSessionFolderIntentByWorkspaceId,
    setPendingSessionFolderIntentByWorkspaceId,
  ] = useState<Record<string, Record<string, string>>>(() => ({}));
  const [rootSessionFolderDraftRequestByWorkspaceId, setRootSessionFolderDraftRequestByWorkspaceId] = useState<
    Record<string, number>
  >(() => ({}));
  const [collapsedSessionFolderIdsByWorkspaceId, setCollapsedSessionFolderIdsByWorkspaceId] = useState<
    Record<string, string[]>
  >(() => readPersistedCollapsedSessionFolderIds());
  const pendingSessionFolderAssignInFlightRef = useRef<Set<string>>(new Set());
  const [folderMovePicker, setFolderMovePicker] =
    useState<ThreadFolderMovePickerState | null>(null);
  const [folderMovePickerQuery, setFolderMovePickerQuery] = useState("");
  const { isExitedSessionsHidden, toggleExitedSessionsHidden } =
    useExitedSessionVisibility();
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isSearchOpen] = useState(false);
  const [isSettingsMenuOpen, setIsSettingsMenuOpen] = useState(false);
  const settingsMenuRef = useRef<HTMLDivElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const { collapsedGroups, toggleGroupCollapse, replaceCollapsedGroups } =
    useCollapsedGroups();
  const { getThreadRows } = useThreadRows(threadParentById);
  const getProjectedThreads = useCallback(
    (workspaceId: string) =>
      buildClaudeLiveSubagentRows(
        threadsByWorkspace[workspaceId] ?? [],
        workspaceId,
        activeWorkspaceId,
        activeThreadId,
        activeItems,
      ),
    [activeItems, activeThreadId, activeWorkspaceId, threadsByWorkspace],
  );
  const mergeSessionFolder = useCallback((folder: WorkspaceSessionFolder) => {
    setSessionFoldersByWorkspaceId((current) => {
      const existingFolders = current[folder.workspaceId] ?? [];
      const replaced = existingFolders.some((entry) => entry.id === folder.id);
      const nextFolders = replaced
        ? existingFolders.map((entry) => (entry.id === folder.id ? folder : entry))
        : [...existingFolders, folder];
      return {
        ...current,
        [folder.workspaceId]: nextFolders,
      };
    });
  }, []);

  const removeSessionFolder = useCallback((workspaceId: string, folderId: string) => {
    setSessionFoldersByWorkspaceId((current) => ({
      ...current,
      [workspaceId]: (current[workspaceId] ?? []).filter((folder) => folder.id !== folderId),
    }));
    setCollapsedSessionFolderIdsByWorkspaceId((current) => {
      const nextIds = (current[workspaceId] ?? []).filter((id) => id !== folderId);
      const next = updateCollapsedSessionFolderIdsForWorkspace(current, workspaceId, nextIds);
      writePersistedCollapsedSessionFolderIds(next);
      return next;
    });
  }, []);

  const assignSessionToFolder = useCallback(
    async (workspaceId: string, threadId: string, folderId: string | null) => {
      const response = await assignWorkspaceSessionFolder(workspaceId, threadId, folderId);
      const nextFolderId = response.folderId ?? null;
      setSessionFolderOverrideByWorkspaceId((current) => ({
        ...current,
        [workspaceId]: {
          ...(current[workspaceId] ?? {}),
          [threadId]: nextFolderId,
        },
      }));
      onQuickReloadWorkspaceThreads?.(workspaceId);
    },
    [onQuickReloadWorkspaceThreads],
  );

  const assignThreadSubtreeToFolder = useCallback(
    async (workspaceId: string, threadId: string, folderId: string | null) => {
      const projectedThreads = getProjectedThreads(workspaceId);
      const threadIds = new Set(projectedThreads.map((thread) => thread.id));
      const targetThreadIds = threadIds.has(threadId)
        ? collectThreadSubtreeIds(projectedThreads, threadParentById, threadId)
        : [threadId];
      for (const targetThreadId of targetThreadIds) {
        if (isPendingSubagentThreadId(targetThreadId)) {
          continue;
        }
        await assignSessionToFolder(workspaceId, targetThreadId, folderId);
      }
    },
    [assignSessionToFolder, getProjectedThreads, threadParentById],
  );

  const clearPendingSessionFolderIntent = useCallback((workspaceId: string, threadId: string) => {
    setPendingSessionFolderIntentByWorkspaceId((current) => {
      const intents = current[workspaceId];
      if (!intents || !Object.hasOwn(intents, threadId)) {
        return current;
      }
      const { [threadId]: _removed, ...restIntents } = intents;
      if (Object.keys(restIntents).length === 0) {
        const { [workspaceId]: _workspaceRemoved, ...rest } = current;
        return rest;
      }
      return {
        ...current,
        [workspaceId]: restIntents,
      };
    });
  }, []);

  const rememberPendingSessionFolderIntent = useCallback(
    (workspaceId: string, threadId: string, folderId: string) => {
      setPendingSessionFolderIntentByWorkspaceId((current) => ({
        ...current,
        [workspaceId]: {
          ...(current[workspaceId] ?? {}),
          [threadId]: folderId,
        },
      }));
      setSessionFolderOverrideByWorkspaceId((current) => ({
        ...current,
        [workspaceId]: {
          ...(current[workspaceId] ?? {}),
          [threadId]: folderId,
        },
      }));
    },
    [],
  );

  const rememberLocalSessionFolderOverride = useCallback(
    (workspaceId: string, threadId: string, folderId: string) => {
      setSessionFolderOverrideByWorkspaceId((current) => ({
        ...current,
        [workspaceId]: {
          ...(current[workspaceId] ?? {}),
          [threadId]: folderId,
        },
      }));
    },
    [],
  );

  const assignNewSessionToFolder = useCallback(
    async (workspaceId: string, threadId: string, folderId: string) => {
      if (isSharedSessionThreadId(threadId)) {
        rememberLocalSessionFolderOverride(workspaceId, threadId, folderId);
        return;
      }
      if (isPendingEngineThreadId(threadId)) {
        rememberPendingSessionFolderIntent(workspaceId, threadId, folderId);
        return;
      }
      try {
        await assignSessionToFolder(workspaceId, threadId, folderId);
        clearPendingSessionFolderIntent(workspaceId, threadId);
      } catch (error: unknown) {
        if (isSessionCatalogNotReadyError(error)) {
          rememberPendingSessionFolderIntent(workspaceId, threadId, folderId);
          return;
        }
        pushErrorToast({
          title: t("sidebar.sessionFolderMoveFailed"),
          message: error instanceof Error ? error.message : String(error),
          durationMs: 5000,
        });
      }
    },
    [
      assignSessionToFolder,
      clearPendingSessionFolderIntent,
      rememberLocalSessionFolderOverride,
      rememberPendingSessionFolderIntent,
      t,
    ],
  );

  useEffect(() => {
    Object.entries(pendingSessionFolderIntentByWorkspaceId).forEach(
      ([workspaceId, intents]) => {
        const workspaceThreads = threadsByWorkspace[workspaceId] ?? [];
        Object.entries(intents).forEach(([intentThreadId, folderId]) => {
          const targetThreadId = resolveFolderIntentReplacementThreadId(
            intentThreadId,
            workspaceThreads,
          );
          if (!targetThreadId || isPendingEngineThreadId(targetThreadId)) {
            return;
          }
          const assignKey = `${workspaceId}:${intentThreadId}:${targetThreadId}:${folderId}`;
          if (pendingSessionFolderAssignInFlightRef.current.has(assignKey)) {
            return;
          }
          pendingSessionFolderAssignInFlightRef.current.add(assignKey);
          void assignSessionToFolder(workspaceId, targetThreadId, folderId)
            .then(() => {
              clearPendingSessionFolderIntent(workspaceId, intentThreadId);
              if (targetThreadId !== intentThreadId) {
                clearPendingSessionFolderIntent(workspaceId, targetThreadId);
              }
            })
            .catch((error: unknown) => {
              if (isSessionCatalogNotReadyError(error)) {
                return;
              }
              clearPendingSessionFolderIntent(workspaceId, intentThreadId);
              pushErrorToast({
                title: t("sidebar.sessionFolderMoveFailed"),
                message: error instanceof Error ? error.message : String(error),
                durationMs: 5000,
              });
            })
            .finally(() => {
              pendingSessionFolderAssignInFlightRef.current.delete(assignKey);
            });
        });
      },
    );
  }, [
    assignSessionToFolder,
    clearPendingSessionFolderIntent,
    pendingSessionFolderIntentByWorkspaceId,
    threadsByWorkspace,
    t,
  ]);
  const {
    showThreadMenu,
    showWorkspaceMenu,
    showWorkspaceSessionMenu,
    showWorktreeMenu,
    workspaceMenuState,
    sidebarContextMenuState,
    closeWorkspaceMenu,
    closeSidebarContextMenu,
    onWorkspaceMenuAction,
  } =
    useSidebarMenus({
      onAddAgent,
      engineOptions,
      enabledEngines,
      onRefreshEngineOptions,
      onAddSharedAgent,
      onAssignNewSessionToFolder: assignNewSessionToFolder,
      onDeleteThread,
      onArchiveThread,
      onSyncThread,
      onPinThread: pinThread,
      onUnpinThread: unpinThread,
      isThreadPinned,
      isThreadAutoNaming,
      onRenameThread,
      onAutoNameThread,
      onMoveThreadToFolder: async (workspaceId, threadId, folderId) => {
        try {
          await assignThreadSubtreeToFolder(workspaceId, threadId, folderId);
        } catch (error: unknown) {
          pushErrorToast({
            title: t("sidebar.sessionFolderMoveFailed"),
            message: error instanceof Error ? error.message : String(error),
            durationMs: 5000,
          });
        }
      },
      onOpenThreadFolderPicker: (workspaceId, threadId, targets, currentFolderId) => {
        setFolderMovePicker({
          workspaceId,
          threadId,
          targets,
          currentFolderId,
        });
        setFolderMovePickerQuery("");
      },
      onOpenClaudeTui,
      onReloadWorkspaceThreads,
      onDeleteWorkspace,
      onDeleteWorktree,
      onRenameWorkspaceAlias,
      onAddWorktreeAgent,
      onAddCloneAgent,
    });
  const normalizedQuery = debouncedQuery.trim().toLowerCase();

  useEffect(() => {
    if (!workspaceMenuState) {
      return;
    }
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeWorkspaceMenu();
      }
    };
    return registerKeydownHandler(handleWindowKeyDown);
  }, [workspaceMenuState, closeWorkspaceMenu]);

  const renderWorkspaceMenuIcon = useCallback((iconKind: string) => {
    switch (iconKind) {
      case "engine-claude":
        return <EngineIcon engine="claude" size={14} />;
      case "engine-codex":
        return <EngineIcon engine="codex" size={14} />;
      case "engine-opencode":
        return <EngineIcon engine="opencode" size={14} style={{ color: "#3b82f6" }} />;
      case "engine-gemini":
        return <EngineIcon engine="gemini" size={14} />;
      case "reload":
        return <RefreshCw size={13} />;
      case "new-shared":
        return <SharedSessionIcon size={13} />;
      case "alias":
        return <Pencil size={13} />;
      case "remove":
        return <Trash2 size={13} />;
      case "new-worktree":
        return <GitBranch size={13} />;
      case "new-clone":
        return <Copy size={13} />;
      default:
        return null;
    }
  }, []);

  const isWorkspaceMatch = useCallback(
    (workspace: WorkspaceInfo) => {
      if (!normalizedQuery) {
        return true;
      }
      return workspace.name.toLowerCase().includes(normalizedQuery);
    },
    [normalizedQuery],
  );

  const renderHighlightedName = useCallback(
    (name: string) => {
      if (!normalizedQuery) {
        return name;
      }
      const lower = name.toLowerCase();
      const parts: React.ReactNode[] = [];
      let cursor = 0;
      let matchIndex = lower.indexOf(normalizedQuery, cursor);

      while (matchIndex !== -1) {
        if (matchIndex > cursor) {
          parts.push(name.slice(cursor, matchIndex));
        }
        parts.push(
          <span key={`${matchIndex}-${cursor}`} className="workspace-name-match">
            {name.slice(matchIndex, matchIndex + normalizedQuery.length)}
          </span>,
        );
        cursor = matchIndex + normalizedQuery.length;
        matchIndex = lower.indexOf(normalizedQuery, cursor);
      }

      if (cursor < name.length) {
        parts.push(name.slice(cursor));
      }

      return parts.length ? parts : name;
    },
    [normalizedQuery],
  );

  const pinnedThreadRows = useMemo(() => {
    type ThreadRow = { thread: ThreadSummary; depth: number };
    const groups: Array<{
      pinTime: number;
      workspaceId: string;
      workspacePath: string;
      rows: ThreadRow[];
    }> = [];
    if (pinnedThreadsVersion < 0) {
      return [];
    }

    workspaces.forEach((workspace) => {
      if (!isWorkspaceMatch(workspace)) {
        return;
      }
      const threads = getProjectedThreads(workspace.id);
      if (!threads.length) {
        return;
      }
      const { pinnedRows } = getThreadRows(
        threads,
        true,
        workspace.id,
        getPinTimestamp,
      );
      if (!pinnedRows.length) {
        return;
      }
      let currentRows: ThreadRow[] = [];
      let currentPinTime: number | null = null;

      pinnedRows.forEach((row) => {
        if (row.depth === 0) {
          if (currentRows.length && currentPinTime !== null) {
            groups.push({
              pinTime: currentPinTime,
              workspaceId: workspace.id,
              workspacePath: workspace.path,
              rows: currentRows,
            });
          }
          currentRows = [row];
          currentPinTime = getPinTimestamp(workspace.id, row.thread.id);
        } else {
          currentRows.push(row);
        }
      });

      if (currentRows.length && currentPinTime !== null) {
        groups.push({
          pinTime: currentPinTime,
          workspaceId: workspace.id,
          workspacePath: workspace.path,
          rows: currentRows,
        });
      }
    });

    return groups
      .sort((a, b) => a.pinTime - b.pinTime)
      .flatMap((group) =>
        group.rows.map((row) => ({
          ...row,
          workspaceId: group.workspaceId,
          workspacePath: group.workspacePath,
        })),
      );
  }, [
    workspaces,
    getProjectedThreads,
    getThreadRows,
    getPinTimestamp,
    isWorkspaceMatch,
    pinnedThreadsVersion,
  ]);

  const { sidebarBodyRef, scrollFade, updateScrollFade } = useSidebarScrollFade(
    groupedWorkspaces,
    threadsByWorkspace,
    expandedWorkspaces,
    normalizedQuery,
  );

  const filteredGroupedWorkspaces = useMemo(
    () =>
      groupedWorkspaces
        .map((group) => ({
          ...group,
          workspaces: group.workspaces.filter(isWorkspaceMatch),
        }))
        .filter((group) => group.workspaces.length > 0),
    [groupedWorkspaces, isWorkspaceMatch],
  );
  const defaultWorkspaceEntries = useMemo(
    () =>
      filteredGroupedWorkspaces
        .flatMap((group) => group.workspaces)
        .filter((workspace) => isDefaultWorkspacePath(workspace.path)),
    [filteredGroupedWorkspaces],
  );
  const filteredGroupedWorkspacesWithoutDefault = useMemo(
    () =>
      filteredGroupedWorkspaces
        .map((group) => ({
          ...group,
          workspaces: group.workspaces.filter(
            (workspace) => !isDefaultWorkspacePath(workspace.path),
          ),
        }))
        .filter((group) => group.workspaces.length > 0),
    [filteredGroupedWorkspaces],
  );
  const ungroupedWorkspaceEntries = useMemo(
    () =>
      filteredGroupedWorkspacesWithoutDefault
        .filter((group) => group.id === null)
        .flatMap((group) => group.workspaces),
    [filteredGroupedWorkspacesWithoutDefault],
  );
  const namedGroupedWorkspaces = useMemo(
    () =>
      filteredGroupedWorkspacesWithoutDefault.filter(
        (group): group is WorkspaceGroupSection & { id: string } => group.id !== null,
      ),
    [filteredGroupedWorkspacesWithoutDefault],
  );

  const isSearchActive = Boolean(normalizedQuery);

  const threadRowsByWorkspace = useMemo(() => {
    const rowsByWorkspace = new Map<string, WorkspaceThreadRows>();
    filteredGroupedWorkspaces.forEach((group) => {
      const toggleId = group.id;
      const isGroupCollapsed = Boolean(toggleId && collapsedGroups.has(toggleId));
      if (isGroupCollapsed) {
        return;
      }
      group.workspaces.forEach((workspace) => {
        if (workspace.settings.sidebarCollapsed) {
          rowsByWorkspace.set(workspace.id, { unpinnedRows: [], totalRoots: 0 });
          return;
        }
        const threads = getProjectedThreads(workspace.id);
        const isExpanded = expandedWorkspaces.has(workspace.id);
        const visibleThreadRootCount = normalizeVisibleThreadRootCount(
          workspace.settings.visibleThreadRootCount,
        );
        const { unpinnedRows, totalRoots } = getThreadRows(
          threads,
          isExpanded,
          workspace.id,
          getPinTimestamp,
          visibleThreadRootCount,
        );
        rowsByWorkspace.set(workspace.id, { unpinnedRows, totalRoots });
      });
    });
    return rowsByWorkspace;
  }, [
    collapsedGroups,
    expandedWorkspaces,
    filteredGroupedWorkspaces,
    getPinTimestamp,
    getThreadRows,
    getProjectedThreads,
  ]);

  useEffect(() => {
    let cancelled = false;
    const workspaceIds = filteredGroupedWorkspaces
      .flatMap((group) => group.workspaces)
      .filter((workspace) => !workspace.settings.sidebarCollapsed)
      .map((workspace) => workspace.id);
    const missingWorkspaceIds = workspaceIds.filter(
      (workspaceId) =>
        sessionFoldersByWorkspaceId[workspaceId] === undefined &&
        !loadedSessionFolderWorkspaceIdsRef.current.has(workspaceId),
    );
    if (missingWorkspaceIds.length === 0) {
      return;
    }

    missingWorkspaceIds.forEach((workspaceId) => {
      listWorkspaceSessionFolders(workspaceId)
        .then((tree) => {
          if (cancelled) {
            return;
          }
          loadedSessionFolderWorkspaceIdsRef.current.add(workspaceId);
          if (tree.folders.length > 0) {
            setSessionFoldersByWorkspaceId((current) => ({
              ...current,
              [workspaceId]: tree.folders,
            }));
          }
          setCollapsedSessionFolderIdsByWorkspaceId((current) => {
            const liveFolderIds = new Set(tree.folders.map((folder) => folder.id));
            const currentIds = current[workspaceId] ?? [];
            const nextIds = currentIds.filter((id) => liveFolderIds.has(id));
            if (nextIds.length === currentIds.length) {
              return current;
            }
            const next = updateCollapsedSessionFolderIdsForWorkspace(current, workspaceId, nextIds);
            writePersistedCollapsedSessionFolderIds(next);
            return next;
          });
          setSessionFolderErrorByWorkspaceId((current) => {
            if (!Object.hasOwn(current, workspaceId)) {
              return current;
            }
            const { [workspaceId]: _unused, ...rest } = current;
            return rest;
          });
        })
        .catch((error: unknown) => {
          if (cancelled) {
            return;
          }
          const message = error instanceof Error ? error.message : String(error);
          loadedSessionFolderWorkspaceIdsRef.current.add(workspaceId);
          setSessionFoldersByWorkspaceId((current) => ({
            ...current,
            [workspaceId]: [],
          }));
          setSessionFolderErrorByWorkspaceId((current) => ({
            ...current,
            [workspaceId]: message,
          }));
        });
    });

    return () => {
      cancelled = true;
    };
  }, [filteredGroupedWorkspaces, sessionFoldersByWorkspaceId]);

  const worktreesByParent = useMemo(() => {
    const worktrees = new Map<string, WorkspaceInfo[]>();
    workspaces
      .filter((entry) => (entry.kind ?? "main") === "worktree" && entry.parentId)
      .forEach((entry) => {
        const parentId = entry.parentId as string;
        const list = worktrees.get(parentId) ?? [];
        list.push(entry);
        worktrees.set(parentId, list);
      });
    worktrees.forEach((entries) => {
      entries.sort((a, b) => a.name.localeCompare(b.name));
    });
    return worktrees;
  }, [workspaces]);

  const hasRunningThreadByWorkspaceId = useMemo(() => {
    const next = new Map<string, boolean>();
    Object.entries(threadsByWorkspace).forEach(([workspaceId, threads]) => {
      next.set(
        workspaceId,
        threads.some((thread) => Boolean(threadStatusById[thread.id]?.isProcessing)),
      );
    });
    return next;
  }, [threadStatusById, threadsByWorkspace]);

  const hasRunningSessionByProjectId = useMemo(() => {
    const next = new Map<string, boolean>();
    workspaces
      .filter((entry) => (entry.kind ?? "main") !== "worktree")
      .forEach((entry) => {
        const hasRunningThreadOnWorkspace = hasRunningThreadByWorkspaceId.get(entry.id) ?? false;
        const hasRunningThreadOnWorktree = (worktreesByParent.get(entry.id) ?? []).some(
          (worktree) => hasRunningThreadByWorkspaceId.get(worktree.id) ?? false,
        );
        next.set(entry.id, hasRunningThreadOnWorkspace || hasRunningThreadOnWorktree);
      });
    return next;
  }, [hasRunningThreadByWorkspaceId, workspaces, worktreesByParent]);

  const handleToggleExpanded = useCallback((workspaceId: string) => {
    setExpandedWorkspaces((prev) => {
      const next = new Set(prev);
      if (next.has(workspaceId)) {
        next.delete(workspaceId);
      } else {
        next.add(workspaceId);
      }
      return next;
    });
  }, []);

  const handleToggleWorktreeSection = useCallback((workspaceId: string) => {
    setCollapsedWorktreeSections((previous) => {
      const next = new Set(previous);
      if (next.has(workspaceId)) {
        next.delete(workspaceId);
      } else {
        next.add(workspaceId);
      }
      return next;
    });
  }, []);

  const rootWorkspaceIds = useMemo(
    () =>
      groupedWorkspaces.flatMap((group) =>
        group.workspaces.map((workspace) => workspace.id),
      ),
    [groupedWorkspaces],
  );

  const allGroupToggleIds = useMemo(() => {
    const ids = new Set<string>();
    groupedWorkspaces.forEach((group) => {
      if (!group.id) {
        return;
      }
      ids.add(group.id);
    });
    return Array.from(ids);
  }, [groupedWorkspaces]);

  const isAllCollapsed = useMemo(() => {
    const allWorkspaceCollapsed = workspaces.every(
      (workspace) => workspace.settings.sidebarCollapsed,
    );
    const allWorktreeSectionCollapsed = rootWorkspaceIds.every((id) =>
      collapsedWorktreeSections.has(id),
    );
    const allWorkspaceGroupCollapsed = allGroupToggleIds.every((id) =>
      collapsedGroups.has(id),
    );
    return (
      allWorkspaceCollapsed &&
      allWorktreeSectionCollapsed &&
      allWorkspaceGroupCollapsed
    );
  }, [
    workspaces,
    rootWorkspaceIds,
    collapsedWorktreeSections,
    allGroupToggleIds,
    collapsedGroups,
  ]);

  const handleToggleCollapseAll = useCallback(() => {
    const shouldCollapse = !isAllCollapsed;
    workspaces.forEach((workspace) => {
      const currentlyCollapsed = workspace.settings.sidebarCollapsed;
      if (currentlyCollapsed !== shouldCollapse) {
        onToggleWorkspaceCollapse(workspace.id, shouldCollapse);
      }
    });
    setCollapsedWorktreeSections(
      shouldCollapse ? new Set(rootWorkspaceIds) : new Set<string>(),
    );
    replaceCollapsedGroups(
      shouldCollapse ? new Set(allGroupToggleIds) : new Set<string>(),
    );
  }, [
    allGroupToggleIds,
    isAllCollapsed,
    onToggleWorkspaceCollapse,
    replaceCollapsedGroups,
    rootWorkspaceIds,
    workspaces,
  ]);

  const getThreadTime = useCallback(
    (thread: ThreadSummary) => {
      const timestamp = thread.updatedAt ?? null;
      return timestamp ? formatRelativeTimeShort(timestamp) : null;
    },
    [],
  );

  useEffect(() => {
    if (!isSettingsMenuOpen) {
      return;
    }
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        settingsMenuRef.current &&
        !settingsMenuRef.current.contains(target) &&
        settingsButtonRef.current &&
        !settingsButtonRef.current.contains(target)
      ) {
        setIsSettingsMenuOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsSettingsMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isSettingsMenuOpen]);

  useEffect(() => {
    if (!isSearchOpen && searchQuery) {
      setSearchQuery("");
    }
  }, [isSearchOpen, searchQuery]);

  useEffect(() => {
    if (debouncedQuery === searchQuery) {
      return;
    }
    const handle = window.setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 150);
    return () => window.clearTimeout(handle);
  }, [debouncedQuery, searchQuery]);

  const handleOpenSkillsComingSoon = useCallback(() => {
    pushErrorToast({
      title: t("sidebar.comingSoon"),
      message: t("sidebar.comingSoonMessage"),
      durationMs: 3000,
    });
  }, [t]);

  const handleToggleThreadPin = useCallback((workspaceId: string, threadId: string) => {
    if (isThreadPinned(workspaceId, threadId)) {
      unpinThread(workspaceId, threadId);
      return;
    }
    pinThread(workspaceId, threadId);
  }, [isThreadPinned, pinThread, unpinThread]);

  const refreshWorkspaceSessionFolders = useCallback(async (workspaceId: string) => {
    const tree = await listWorkspaceSessionFolders(workspaceId);
    loadedSessionFolderWorkspaceIdsRef.current.add(workspaceId);
    setSessionFoldersByWorkspaceId((current) => ({
      ...current,
      [workspaceId]: tree.folders,
    }));
    setCollapsedSessionFolderIdsByWorkspaceId((current) => {
      const liveFolderIds = new Set(tree.folders.map((folder) => folder.id));
      const nextIds = (current[workspaceId] ?? []).filter((id) => liveFolderIds.has(id));
      if (nextIds.length === (current[workspaceId] ?? []).length) {
        return current;
      }
      const next = updateCollapsedSessionFolderIdsForWorkspace(current, workspaceId, nextIds);
      writePersistedCollapsedSessionFolderIds(next);
      return next;
    });
    setSessionFolderErrorByWorkspaceId((current) => {
      if (!Object.hasOwn(current, workspaceId)) {
        return current;
      }
      const { [workspaceId]: _unused, ...rest } = current;
      return rest;
    });
  }, []);

  const handleToggleSessionFolderCollapsed = useCallback(
    (workspaceId: string, folderId: string) => {
      setCollapsedSessionFolderIdsByWorkspaceId((current) => {
        const ids = new Set(current[workspaceId] ?? []);
        if (ids.has(folderId)) {
          ids.delete(folderId);
        } else {
          ids.add(folderId);
        }
        const next = updateCollapsedSessionFolderIdsForWorkspace(
          current,
          workspaceId,
          Array.from(ids),
        );
        writePersistedCollapsedSessionFolderIds(next);
        return next;
      });
    },
    [],
  );

  const closeFolderMovePicker = useCallback(() => {
    setFolderMovePicker(null);
    setFolderMovePickerQuery("");
  }, []);

  const selectFolderMoveTarget = useCallback(
    async (target: ThreadMoveFolderTarget) => {
      if (!folderMovePicker) {
        return;
      }
      if ((target.folderId ?? null) === (folderMovePicker.currentFolderId ?? null)) {
        return;
      }
      try {
        await assignThreadSubtreeToFolder(
          folderMovePicker.workspaceId,
          folderMovePicker.threadId,
          target.folderId,
        );
        closeFolderMovePicker();
      } catch (error: unknown) {
        pushErrorToast({
          title: t("sidebar.sessionFolderMoveFailed"),
          message: error instanceof Error ? error.message : String(error),
          durationMs: 5000,
        });
      }
    },
    [assignThreadSubtreeToFolder, closeFolderMovePicker, folderMovePicker, t],
  );

  const filteredFolderMoveTargets = useMemo(() => {
    if (!folderMovePicker) {
      return [];
    }
    const keyword = folderMovePickerQuery.trim().toLowerCase();
    return folderMovePicker.targets.filter((target) => {
      if (target.folderId === null) {
        return true;
      }
      if (!keyword) {
        return true;
      }
      return target.label.toLowerCase().includes(keyword);
    });
  }, [folderMovePicker, folderMovePickerQuery]);

  useEffect(() => {
    if (!folderMovePicker) {
      return;
    }
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeFolderMovePicker();
      }
    };
    return registerKeydownHandler(handleWindowKeyDown);
  }, [closeFolderMovePicker, folderMovePicker]);

  const handleCreateSessionFolder = useCallback(
    async (workspaceId: string, name: string, parentId: string | null) => {
      const trimmedName = name.trim();
      if (!trimmedName) {
        return;
      }
      try {
        const mutation = await createWorkspaceSessionFolder(workspaceId, trimmedName, parentId);
        mergeSessionFolder(mutation.folder);
        await refreshWorkspaceSessionFolders(workspaceId);
      } catch (error: unknown) {
        pushErrorToast({
          title: t("sidebar.sessionFolderCreateFailed"),
          message: error instanceof Error ? error.message : String(error),
          durationMs: 5000,
        });
      }
    },
    [mergeSessionFolder, refreshWorkspaceSessionFolders, t],
  );

  const handleOpenRootSessionFolderDraft = useCallback((workspaceId: string) => {
    onToggleWorkspaceCollapse(workspaceId, false);
    setRootSessionFolderDraftRequestByWorkspaceId((current) => ({
      ...current,
      [workspaceId]: (current[workspaceId] ?? 0) + 1,
    }));
  }, [onToggleWorkspaceCollapse]);

  const handleOpenSessionFolderSessionMenu = useCallback(
    (event: ReactMouseEvent, workspaceId: string, folderId: string) => {
      const workspace = workspaces.find((entry) => entry.id === workspaceId);
      if (!workspace) {
        return;
      }
      onToggleWorkspaceCollapse(workspaceId, false);
      setCollapsedSessionFolderIdsByWorkspaceId((current) => {
        const nextIds = (current[workspaceId] ?? []).filter((id) => id !== folderId);
        if (nextIds.length === (current[workspaceId] ?? []).length) {
          return current;
        }
        const next = updateCollapsedSessionFolderIdsForWorkspace(
          current,
          workspaceId,
          nextIds,
        );
        writePersistedCollapsedSessionFolderIds(next);
        return next;
      });
      showWorkspaceSessionMenu(event, workspace, { targetFolderId: folderId });
    },
    [onToggleWorkspaceCollapse, showWorkspaceSessionMenu, workspaces],
  );

  const handleRenameSessionFolder = useCallback(
    async (
      workspaceId: string,
      folderId: string,
      name: string,
    ) => {
      const trimmedName = name.trim();
      const currentFolder = sessionFoldersByWorkspaceId[workspaceId]?.find(
        (folder) => folder.id === folderId,
      );
      if (!trimmedName || trimmedName === currentFolder?.name) {
        return;
      }
      try {
        const mutation = await renameWorkspaceSessionFolder(workspaceId, folderId, trimmedName);
        mergeSessionFolder(mutation.folder);
        await refreshWorkspaceSessionFolders(workspaceId);
      } catch (error: unknown) {
        pushErrorToast({
          title: t("sidebar.sessionFolderRenameFailed"),
          message: error instanceof Error ? error.message : String(error),
          durationMs: 5000,
        });
      }
    },
    [mergeSessionFolder, refreshWorkspaceSessionFolders, sessionFoldersByWorkspaceId, t],
  );

  const handleDeleteSessionFolder = useCallback(
    async (
      workspaceId: string,
      folderId: string,
      _name: string,
    ) => {
      try {
        await deleteWorkspaceSessionFolder(workspaceId, folderId);
        removeSessionFolder(workspaceId, folderId);
        await refreshWorkspaceSessionFolders(workspaceId);
      } catch (error: unknown) {
        pushErrorToast({
          title: t("sidebar.sessionFolderDeleteFailed"),
          message: error instanceof Error ? error.message : String(error),
          durationMs: 5000,
        });
      }
    },
    [refreshWorkspaceSessionFolders, removeSessionFolder, t],
  );

  const hasDegradedThreadList = useCallback((threads: ThreadSummary[]) => {
    return threads.some((thread) => {
      const partialSource =
        typeof thread.partialSource === "string" ? thread.partialSource.trim() : "";
      return thread.isDegraded || partialSource.length > 0;
    });
  }, []);

  const moveFolderTargetsByWorkspaceId = useMemo(() => {
    const targetsByWorkspaceId: Record<string, ThreadMoveFolderTarget[]> = {};
    for (const [workspaceId, folders] of Object.entries(sessionFoldersByWorkspaceId)) {
      targetsByWorkspaceId[workspaceId] = buildWorkspaceSessionFolderMoveTargets({
        folders,
        rootLabel: t("threads.moveToProjectRoot"),
      });
    }
    return targetsByWorkspaceId;
  }, [sessionFoldersByWorkspaceId, t]);

  const renderWorkspaceEntry = useCallback((entry: WorkspaceInfo) => {
    const threads = threadsByWorkspace[entry.id] ?? [];
    const isCollapsed = entry.settings.sidebarCollapsed;
    const isExpanded = expandedWorkspaces.has(entry.id);
    const threadRows = threadRowsByWorkspace.get(entry.id);
    const unpinnedRows = threadRows?.unpinnedRows ?? [];
    const totalThreadRoots = threadRows?.totalRoots ?? 0;
    const nextCursor =
      threadListCursorByWorkspace[entry.id] ?? null;
    const showThreadList =
      !isCollapsed && (threads.length > 0 || Boolean(nextCursor));
    const isPaging = threadListPagingByWorkspace[entry.id] ?? false;
    const worktrees = worktreesByParent.get(entry.id) ?? [];
    const isWorktreeSectionCollapsed =
      collapsedWorktreeSections.has(entry.id);
    const showThreadEmptyState =
      !isCollapsed &&
      !showThreadList &&
      worktrees.length === 0 &&
      hydratedThreadListWorkspaceIds.has(entry.id);
    const isThreadListDegraded =
      hasDegradedThreadList(threads) ||
      worktrees.some((worktree) => hasDegradedThreadList(threadsByWorkspace[worktree.id] ?? []));
    const isThreadListRefreshing =
      Boolean(_threadListLoadingByWorkspace[entry.id]) ||
      worktrees.some((worktree) => Boolean(_threadListLoadingByWorkspace[worktree.id]));
    const hasPrimaryActiveThread =
      entry.id === activeWorkspaceId && Boolean(activeThreadId);
    const hasRunningSession = hasRunningSessionByProjectId.get(entry.id) ?? false;
    const workspaceSidebarAlias = getWorkspaceSidebarAlias(entry);
    const visibleThreadRootCount = normalizeVisibleThreadRootCount(
      entry.settings.visibleThreadRootCount,
    );
    const hideExitedSessions = isExitedSessionsHidden(entry.path);
    const exitedSessionVisibility = getExitedSessionRowVisibility(unpinnedRows, {
      hideExitedSessions,
      isExitedThread: (thread) => {
        const status = threadStatusById[thread.id];
        return !status?.isProcessing && !status?.isReviewing;
      },
    });
    const sessionFolders = sessionFoldersByWorkspaceId[entry.id] ?? [];
    const collapsedSessionFolderIds = new Set(
      collapsedSessionFolderIdsByWorkspaceId[entry.id] ?? [],
    );
    const rootFolderDraftRequestKey =
      rootSessionFolderDraftRequestByWorkspaceId[entry.id] ?? 0;
    const folderOverrides = sessionFolderOverrideByWorkspaceId[entry.id] ?? {};
    const folderIdBySessionId = new Map<string, string | null>();
    unpinnedRows.forEach((row) => {
      if (Object.hasOwn(folderOverrides, row.thread.id)) {
        const folderId = folderOverrides[row.thread.id]?.trim();
        folderIdBySessionId.set(row.thread.id, folderId ? folderId : null);
        return;
      }
      const folderId = row.thread.folderId?.trim();
      if (folderId) {
        folderIdBySessionId.set(row.thread.id, folderId);
      }
    });
    const projectedRows = unpinnedRows.map((row) => {
      if (!Object.hasOwn(folderOverrides, row.thread.id)) {
        return row;
      }
      return {
        ...row,
        thread: {
          ...row.thread,
          folderId: folderOverrides[row.thread.id],
        },
      };
    });
    const folderProjection = buildWorkspaceSessionFolderProjection({
      folders: sessionFolders,
      rows: projectedRows,
      folderIdBySessionId,
    });
    const folderMoveTargets = buildWorkspaceSessionFolderMoveTargets({
      folders: sessionFolders,
      rootLabel: t("threads.moveToProjectRoot"),
    });
    const hasVisibleFolderTree =
      sessionFolders.length > 0 || folderProjection.rootRows.length > 0;
    const hasRootFolderDraftRequest = rootFolderDraftRequestKey > 0;
    const showFolderProjection =
      !isCollapsed &&
      (showThreadList || hasRootFolderDraftRequest) &&
      (hasVisibleFolderTree || hasRootFolderDraftRequest);
    return (
      <WorkspaceCard
        key={entry.id}
        workspace={entry}
        workspaceName={renderHighlightedName(getWorkspaceSidebarLabel(entry))}
        workspaceAliasOriginalName={workspaceSidebarAlias ? entry.name : null}
        isActive={entry.id === activeWorkspaceId}
        isThreadListDegraded={isThreadListDegraded}
        isThreadListRefreshing={isThreadListRefreshing}
        hasPrimaryActiveThread={hasPrimaryActiveThread}
        hasRunningSession={hasRunningSession}
        showExitedSessionsToggle={
          exitedSessionVisibility.hasExitedSessions
          || exitedSessionVisibility.hiddenExitedCount > 0
        }
        hideExitedSessions={hideExitedSessions}
        hiddenExitedSessionsCount={exitedSessionVisibility.hiddenExitedCount}
        isCollapsed={isCollapsed}
        onShowWorkspaceMenu={showWorkspaceMenu}
        onCreateSessionFolder={handleOpenRootSessionFolderDraft}
        onQuickReloadWorkspaceThreads={onQuickReloadWorkspaceThreads}
        onSelectWorkspace={onSelectWorkspace}
        onToggleWorkspaceCollapse={onToggleWorkspaceCollapse}
        onToggleExitedSessions={toggleExitedSessionsHidden}
      >
        {!isCollapsed && worktrees.length > 0 && (
          <WorktreeSection
            parentWorkspaceId={entry.id}
            worktrees={worktrees}
            isSectionCollapsed={isWorktreeSectionCollapsed}
            onToggleSectionCollapse={handleToggleWorktreeSection}
            deletingWorktreeIds={deletingWorktreeIds}
            threadsByWorkspace={threadsByWorkspace}
            threadStatusById={threadStatusById}
            hydratedThreadListWorkspaceIds={hydratedThreadListWorkspaceIds}
            threadListLoadingByWorkspace={_threadListLoadingByWorkspace}
            threadListPagingByWorkspace={threadListPagingByWorkspace}
            threadListCursorByWorkspace={threadListCursorByWorkspace}
            expandedWorkspaces={expandedWorkspaces}
            activeWorkspaceId={activeWorkspaceId}
            activeThreadId={activeThreadId}
            systemProxyEnabled={systemProxyEnabled}
            systemProxyUrl={systemProxyUrl}
            getThreadRows={getThreadRows}
            getThreadTime={getThreadTime}
            isThreadPinned={isThreadPinned}
            isThreadAutoNaming={isThreadAutoNaming}
            onToggleThreadPin={handleToggleThreadPin}
            getPinTimestamp={getPinTimestamp}
            onConnectWorkspace={onConnectWorkspace}
            onShowWorktreeSessionMenu={showWorkspaceSessionMenu}
            onQuickReloadWorkspaceThreads={onQuickReloadWorkspaceThreads}
            onSelectWorkspace={onSelectWorkspace}
            onToggleWorkspaceCollapse={onToggleWorkspaceCollapse}
            isExitedSessionsHidden={isExitedSessionsHidden}
            onToggleExitedSessionsHidden={toggleExitedSessionsHidden}
            onSelectThread={onSelectThread}
            onShowThreadMenu={showThreadMenu}
            deleteConfirmThreadId={deleteConfirmThreadId}
            deleteConfirmWorkspaceId={deleteConfirmWorkspaceId}
            deleteConfirmBusy={deleteConfirmBusy}
            onCancelDeleteConfirm={onCancelDeleteConfirm}
            onConfirmDeleteConfirm={onConfirmDeleteConfirm}
            onShowWorktreeMenu={showWorktreeMenu}
            onToggleExpanded={handleToggleExpanded}
            onLoadOlderThreads={onLoadOlderThreads}
          />
        )}
        {showFolderProjection ? (
          <WorkspaceSessionFolderTree
            workspaceId={entry.id}
            workspacePath={entry.path}
            folders={folderProjection.folders}
            rootRows={folderProjection.rootRows}
            totalThreadRoots={totalThreadRoots}
            isExpanded={isExpanded}
            rootDraftRequestKey={rootFolderDraftRequestKey}
            moveFolderTargets={folderMoveTargets}
            collapsedFolderIds={collapsedSessionFolderIds}
            onNewFolder={handleCreateSessionFolder}
            onRenameFolder={handleRenameSessionFolder}
            onDeleteFolder={handleDeleteSessionFolder}
            onToggleFolderCollapsed={handleToggleSessionFolderCollapsed}
            onNewSessionInFolder={handleOpenSessionFolderSessionMenu}
            threadListProps={{
              visibleThreadRootCount,
              hideExitedSessions,
              activeWorkspaceId,
              activeThreadId,
              systemProxyEnabled,
              systemProxyUrl,
              threadStatusById,
              getThreadTime,
              isThreadPinned,
              isThreadAutoNaming,
              onToggleThreadPin: handleToggleThreadPin,
              onToggleExpanded: handleToggleExpanded,
              onLoadOlderThreads,
              onSelectThread,
              onShowThreadMenu: showThreadMenu,
              deleteConfirmThreadId,
              deleteConfirmWorkspaceId,
              deleteConfirmBusy,
              onCancelDeleteConfirm,
              onConfirmDeleteConfirm,
              nextCursor,
              isPaging,
              showLoadOlder: true,
            }}
          />
        ) : null}
        {showThreadList && !showFolderProjection ? (
          <ThreadList
            workspaceId={entry.id}
            workspacePath={entry.path}
            pinnedRows={[]}
            unpinnedRows={unpinnedRows}
            totalThreadRoots={totalThreadRoots}
            visibleThreadRootCount={visibleThreadRootCount}
            isExpanded={isExpanded}
            nextCursor={nextCursor}
            isPaging={isPaging}
            moveFolderTargets={folderMoveTargets}
            hideExitedSessions={hideExitedSessions}
            activeWorkspaceId={activeWorkspaceId}
            activeThreadId={activeThreadId}
            systemProxyEnabled={systemProxyEnabled}
            systemProxyUrl={systemProxyUrl}
            threadStatusById={threadStatusById}
            getThreadTime={getThreadTime}
            isThreadPinned={isThreadPinned}
            isThreadAutoNaming={isThreadAutoNaming}
            onToggleThreadPin={handleToggleThreadPin}
            onToggleExpanded={handleToggleExpanded}
            onLoadOlderThreads={onLoadOlderThreads}
            onSelectThread={onSelectThread}
            onShowThreadMenu={showThreadMenu}
            deleteConfirmThreadId={deleteConfirmThreadId}
            deleteConfirmWorkspaceId={deleteConfirmWorkspaceId}
            deleteConfirmBusy={deleteConfirmBusy}
            onCancelDeleteConfirm={onCancelDeleteConfirm}
            onConfirmDeleteConfirm={onConfirmDeleteConfirm}
          />
        ) : null}
        {sessionFolderErrorByWorkspaceId[entry.id] ? (
          <div className="workspace-session-folder-error">
            {t("sidebar.sessionFolderLoadFailed")}
          </div>
        ) : null}
        {showThreadEmptyState ? <ThreadEmptyState /> : null}
      </WorkspaceCard>
    );
  }, [
    activeThreadId,
    activeWorkspaceId,
    collapsedWorktreeSections,
    collapsedSessionFolderIdsByWorkspaceId,
    deleteConfirmBusy,
    deleteConfirmThreadId,
    deleteConfirmWorkspaceId,
    deletingWorktreeIds,
    expandedWorkspaces,
    getPinTimestamp,
    getThreadRows,
    getThreadTime,
    handleToggleThreadPin,
    handleToggleExpanded,
    handleToggleWorktreeSection,
    handleCreateSessionFolder,
    handleOpenRootSessionFolderDraft,
    handleOpenSessionFolderSessionMenu,
    handleRenameSessionFolder,
    handleDeleteSessionFolder,
    handleToggleSessionFolderCollapsed,
    hasDegradedThreadList,
    isThreadAutoNaming,
    isThreadPinned,
    hasRunningSessionByProjectId,
    onQuickReloadWorkspaceThreads,
    onCancelDeleteConfirm,
    onConfirmDeleteConfirm,
    onConnectWorkspace,
    onLoadOlderThreads,
    onSelectWorkspace,
    onSelectThread,
    showThreadMenu,
    showWorkspaceSessionMenu,
    showWorkspaceMenu,
    showWorktreeMenu,
    systemProxyEnabled,
    systemProxyUrl,
    onToggleWorkspaceCollapse,
    renderHighlightedName,
    hydratedThreadListWorkspaceIds,
    isExitedSessionsHidden,
    sessionFolderErrorByWorkspaceId,
    sessionFoldersByWorkspaceId,
    rootSessionFolderDraftRequestByWorkspaceId,
    sessionFolderOverrideByWorkspaceId,
    t,
    threadListCursorByWorkspace,
    threadListPagingByWorkspace,
    threadRowsByWorkspace,
    threadStatusById,
    threadsByWorkspace,
    toggleExitedSessionsHidden,
    worktreesByParent,
    _threadListLoadingByWorkspace,
  ]);

  return (
    <aside
      className={`sidebar${isSearchOpen ? " search-open" : ""}`}
      ref={workspaceDropTargetRef}
      onDragOver={onWorkspaceDragOver}
      onDragEnter={onWorkspaceDragEnter}
      onDragLeave={onWorkspaceDragLeave}
      onDrop={onWorkspaceDrop}
    >
      <div className="sidebar-topbar-placeholder" data-tauri-drag-region>
        {topbarNode ? (
          <div className="sidebar-topbar-content" data-tauri-drag-region>
            {topbarNode}
          </div>
        ) : null}
      </div>
      <div
        className={`sidebar-search sticky top-0 z-[4] ${
          isSearchOpen
            ? "is-open py-1.5 px-1 pt-1.5 pb-2.5"
            : "h-0 overflow-hidden px-1"
        }`}
      >
        {isSearchOpen && (
          <input
            className="sidebar-search-input w-full pl-2.5 pr-[26px] py-1.5 rounded-lg border border-(--border-quiet) text-(--text-strong) text-xs outline-none placeholder:text-(--text-muted) focus:border-(--border-accent) focus:shadow-[0_0_0_2px_var(--border-accent-soft)]"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={t("sidebar.searchProjects")}
            aria-label={t("sidebar.searchProjects")}
            data-tauri-drag-region="false"
            autoFocus
          />
        )}
        {isSearchOpen && searchQuery.length > 0 && (
          <button
            type="button"
            className="sidebar-search-clear absolute right-3.5 top-1/2 -translate-y-1/2 w-5 h-5 inline-flex items-center justify-center border-none bg-transparent text-(--text-muted) text-base leading-none cursor-pointer p-0 rounded-none font-semibold shadow-none transition-none hover:bg-transparent hover:text-(--text-strong) hover:-translate-y-1/2 hover:shadow-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-(--border-accent) focus-visible:outline-offset-2"
            onClick={() => setSearchQuery("")}
            aria-label={t("sidebar.clearSearch")}
            data-tauri-drag-region="false"
          >
            <span className="codicon codicon-close" style={{ fontSize: "12px" }} aria-hidden />
          </button>
        )}
      </div>
      <div
        className={`workspace-drop-overlay absolute inset-0 z-[8] flex items-center justify-center bg-black/70 backdrop-blur-[4px] pointer-events-none transition-opacity duration-200 ease-out ${
          isWorkspaceDropActive ? "is-active opacity-100" : "opacity-0"
        }`}
        aria-hidden
      >
        <div
          className={`workspace-drop-overlay-text text-base font-semibold tracking-[0.02em] inline-flex items-center gap-2.5 ${
            workspaceDropText === "Adding Project..."
              ? "is-busy text-transparent bg-[linear-gradient(90deg,rgba(255,255,255,0.25),rgba(255,255,255,0.85),rgba(255,255,255,0.25))] bg-[length:200%_100%] bg-clip-text [-webkit-background-clip:text] animate-[drop-text-shimmer_1.2s_ease-in-out_infinite]"
              : "text-(--text-strong)"
          }`}
        >
          {workspaceDropText === "Drop Project Here" && (
            <span
              className="codicon codicon-folder-opened workspace-drop-overlay-icon w-[18px] h-[18px] opacity-80"
              aria-hidden
            />
          )}
          {workspaceDropText === "Drop Project Here"
            ? t("sidebar.dropProjectHere")
            : workspaceDropText === "Adding Project..."
              ? t("sidebar.addingProject")
              : workspaceDropText}
        </div>
      </div>
      <div className="sidebar-body flex-1 min-h-0 overflow-hidden [-webkit-app-region:no-drag]">
        <div className="sidebar-body-layout flex flex-col gap-2 h-full min-h-0 items-stretch">
          <nav
            className="sidebar-primary-nav flex flex-col gap-0.5 px-0.5 pt-2"
            aria-label={t("tabbar.primaryNavigation")}
          >
            <button
              type="button"
              className={`sidebar-primary-nav-item sidebar-primary-nav-mode-item ${appMode === "chat" ? "is-active" : ""}`}
              onClick={onOpenHomeChat}
              title={`${t("sidebar.quickNewThread")} (${quickChatShortcutLabel})`}
              aria-label={t("sidebar.quickNewThread")}
              data-tauri-drag-region="false"
            >
              <House className="sidebar-primary-nav-icon" aria-hidden size={20} strokeWidth={1.8} />
              <span className="sidebar-primary-nav-text">{t("sidebar.quickNewThread")}</span>
            </button>
            <button
              type="button"
              className={`sidebar-primary-nav-item sidebar-primary-nav-mode-item ${appMode === "kanban" ? "is-active" : ""}`}
              onClick={() => onAppModeChange("kanban")}
              title={`${t("sidebar.quickAutomation")} (${quickKanbanShortcutLabel})`}
              aria-label={t("sidebar.quickAutomation")}
              data-tauri-drag-region="false"
            >
              <svg className="sidebar-primary-nav-icon" aria-hidden width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M10 3.25V16C10 16.1989 9.92098 16.3897 9.78033 16.5303C9.63968 16.671 9.44891 16.75 9.25 16.75H4.75C4.35218 16.75 3.97064 16.592 3.68934 16.3107C3.40804 16.0294 3.25 15.6478 3.25 15.25V4.75C3.25 4.35218 3.40804 3.97064 3.68934 3.68934C3.97064 3.40804 4.35218 3.25 4.75 3.25H15.25C15.6478 3.25 16.0294 3.40804 16.3107 3.68934C16.592 3.97064 16.75 4.35218 16.75 4.75V9.25C16.75 9.44891 16.671 9.63968 16.5303 9.78033C16.3897 9.92098 16.1989 10 16 10H3.25" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M13 15.25H17.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M15.25 17.5V13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span className="sidebar-primary-nav-text">{t("sidebar.quickAutomation")}</span>
              <span className="sidebar-primary-nav-shortcut" aria-hidden>
                {quickKanbanShortcutLabel}
              </span>
            </button>
            <button
              type="button"
              className="sidebar-primary-nav-item sidebar-primary-nav-subitem"
              onClick={onOpenGlobalSearch}
              title={`${quickSearchLabel} (${quickSearchShortcutLabel})`}
              aria-label={quickSearchLabel}
              data-tauri-drag-region="false"
            >
              <svg className="sidebar-primary-nav-icon" aria-hidden width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M17.2888 17.2899L13.7734 13.7745" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M9.19094 15.67C12.7697 15.67 15.6709 12.7688 15.6709 9.18996C15.6709 5.61116 12.7697 2.70996 9.19094 2.70996C5.61213 2.70996 2.71094 5.61116 2.71094 9.18996C2.71094 12.7688 5.61213 15.67 9.19094 15.67Z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span className="sidebar-primary-nav-text">{quickSearchLabel}</span>
              <span className="sidebar-primary-nav-shortcut" aria-hidden>
                {quickSearchShortcutLabel}
              </span>
            </button>
          </nav>
          <ScrollArea
            className={`sidebar-content-column flex-1 min-w-0 min-h-0 self-stretch overflow-hidden pr-0 pt-0 [-webkit-app-region:no-drag] [scrollbar-gutter:auto] [&>[data-slot=scroll-area-viewport]]:overflow-y-auto [&>[data-slot=scroll-area-viewport]]:overflow-x-hidden [&>[data-slot=scroll-area-viewport]]:[scrollbar-gutter:auto] [&>[data-slot=scroll-area-viewport]]:[scrollbar-width:none] [&>[data-slot=scroll-area-viewport]::-webkit-scrollbar]:w-0 [&>[data-slot=scroll-area-viewport]::-webkit-scrollbar]:h-0 [&>[data-slot=scroll-area-scrollbar]]:hidden [&>[data-slot=scroll-area-corner]]:hidden${
              scrollFade.top ? " fade-top" : ""
            }${scrollFade.bottom ? " fade-bottom" : ""}`}
            onViewportScroll={updateScrollFade}
            viewportRef={sidebarBodyRef}
          >
            {pinnedThreadRows.length > 0 && (
              <div className="pinned-section sidebar-pinned-section">
                <PinnedThreadList
                  rows={pinnedThreadRows}
                  activeWorkspaceId={activeWorkspaceId}
                  activeThreadId={activeThreadId}
                  systemProxyEnabled={systemProxyEnabled}
                  systemProxyUrl={systemProxyUrl}
                  threadStatusById={threadStatusById}
                  moveFolderTargetsByWorkspaceId={moveFolderTargetsByWorkspaceId}
                  getThreadTime={getThreadTime}
                  isThreadPinned={isThreadPinned}
                  isThreadAutoNaming={isThreadAutoNaming}
                  onToggleThreadPin={handleToggleThreadPin}
                  onSelectThread={onSelectThread}
                  onShowThreadMenu={showThreadMenu}
                  deleteConfirmThreadId={deleteConfirmThreadId}
                  deleteConfirmWorkspaceId={deleteConfirmWorkspaceId}
                  deleteConfirmBusy={deleteConfirmBusy}
                  onCancelDeleteConfirm={onCancelDeleteConfirm}
                  onConfirmDeleteConfirm={onConfirmDeleteConfirm}
                />
              </div>
            )}
            <div className="sidebar-section-header">
              <div className="sidebar-section-title">
                {t("sidebar.projects")}
              </div>
              <button
                className="sidebar-title-add sidebar-title-toggle-all hidden inline-flex items-center justify-center w-6 h-6 p-0 border-none bg-transparent text-(--text-muted) leading-none rounded-md shadow-none transform-none transition-colors duration-150 ease-out hover:bg-(--surface-hover) hover:text-(--text-strong) hover:shadow-none hover:transform-none focus-visible:bg-(--surface-hover) focus-visible:text-(--text-strong) focus-visible:shadow-none focus-visible:transform-none [&_svg]:w-4 [&_svg]:h-4"
                onClick={handleToggleCollapseAll}
                data-tauri-drag-region="false"
                aria-label={
                  isAllCollapsed
                    ? t("sidebar.expandAllSections")
                    : t("sidebar.collapseAllSections")
                }
                type="button"
                title={
                  isAllCollapsed
                    ? t("sidebar.expandAllSections")
                    : t("sidebar.collapseAllSections")
                }
              >
                <ChevronsDownUp size={14} aria-hidden />
              </button>
              <TooltipIconButton
                className="sidebar-title-add inline-flex items-center justify-center w-6 h-6 p-0 border-none bg-transparent text-(--text-muted) leading-none rounded-md shadow-none transform-none transition-colors duration-150 ease-out hover:bg-(--surface-hover) hover:text-(--text-strong) hover:shadow-none hover:transform-none focus-visible:bg-(--surface-hover) focus-visible:text-(--text-strong) focus-visible:shadow-none focus-visible:transform-none [&_svg]:w-4 [&_svg]:h-4"
                onClick={onAddWorkspace}
                data-tauri-drag-region="false"
                label={t("sidebar.addWorkspace")}
              >
                <span
                  className="codicon codicon-new-folder"
                  aria-hidden
                  style={{ fontSize: "16px" }}
                />
              </TooltipIconButton>
            </div>
            <div className="workspace-list">
          {defaultWorkspaceEntries.map(renderWorkspaceEntry)}
          {ungroupedWorkspaceEntries.map(renderWorkspaceEntry)}
          {namedGroupedWorkspaces.map((group) => {
            const toggleId = group.id;
            const isGroupCollapsed = Boolean(
              toggleId && collapsedGroups.has(toggleId),
            );
            const visibleWorkspaces = isGroupCollapsed ? [] : group.workspaces;

            return (
              <WorkspaceGroup
                key={group.id}
                toggleId={toggleId}
                name={group.name}
                showHeader
                isCollapsed={isGroupCollapsed}
                onToggleCollapse={toggleGroupCollapse}
              >
                {visibleWorkspaces.map(renderWorkspaceEntry)}
              </WorkspaceGroup>
            );
          })}
          {!namedGroupedWorkspaces.length &&
            ungroupedWorkspaceEntries.length === 0 &&
            defaultWorkspaceEntries.length === 0 && (
            <div className="empty">
              {isSearchActive
                ? t("sidebar.noProjectsMatch")
                : t("sidebar.addWorkspaceToStart")}
            </div>
            )}
            </div>
          </ScrollArea>
          <div className="sidebar-bottom-nav">
            <div className="sidebar-settings-dropdown-wrapper">
              {isSettingsMenuOpen && (
                <div
                  className="sidebar-settings-dropdown"
                  ref={settingsMenuRef}
                  role="menu"
                >
                  <button
                    type="button"
                    role="menuitem"
                    className="sidebar-settings-dropdown-item"
                    disabled
                    onClick={() => {
                      setIsSettingsMenuOpen(false);
                      handleOpenSkillsComingSoon();
                    }}
                  >
                    <BriefcaseBusiness size={14} aria-hidden />
                    <span>{t("sidebar.quickSkills")}</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="sidebar-settings-dropdown-item"
                    onClick={() => {
                      setIsSettingsMenuOpen(false);
                      onLockPanel?.();
                    }}
                  >
                    <Lock size={14} aria-hidden />
                    <span>{t("lockScreen.lock")}</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="sidebar-settings-dropdown-item"
                    onClick={() => {
                      setIsSettingsMenuOpen(false);
                      onOpenSpecHub();
                    }}
                  >
                    <LayoutDashboard size={14} aria-hidden />
                    <span>{t("sidebar.specHub")}</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="sidebar-settings-dropdown-item"
                    onClick={() => {
                      setIsSettingsMenuOpen(false);
                      onOpenProjectMemory();
                    }}
                  >
                    <Brain size={14} aria-hidden />
                    <span>{t("panels.memory")}</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className={`sidebar-settings-dropdown-item${appMode === "gitHistory" ? " is-active" : ""}`}
                    onClick={() => {
                      setIsSettingsMenuOpen(false);
                      onAppModeChange(appMode === "gitHistory" ? "chat" : "gitHistory");
                    }}
                  >
                    <GitBranch size={14} aria-hidden />
                    <span>{t("git.logMode")}</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="sidebar-settings-dropdown-item"
                    onClick={() => {
                      setIsSettingsMenuOpen(false);
                      onOpenReleaseNotes();
                    }}
                  >
                    <FileText size={14} aria-hidden />
                    <span>{t("sidebar.releaseNotes")}</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="sidebar-settings-dropdown-item"
                    onClick={() => {
                      setIsSettingsMenuOpen(false);
                      onOpenSettings();
                    }}
                  >
                    <Settings size={14} aria-hidden />
                    <span>{t("settings.title")}</span>
                  </button>
                </div>
              )}
              <button
                ref={settingsButtonRef}
                type="button"
                className={`sidebar-primary-nav-item sidebar-primary-nav-item-bottom${isSettingsMenuOpen ? " is-active" : ""}`}
                onClick={() => setIsSettingsMenuOpen((prev) => !prev)}
                title={t("settings.title")}
                aria-label={t("settings.title")}
                aria-expanded={isSettingsMenuOpen}
                aria-haspopup="menu"
                data-tauri-drag-region="false"
              >
                <Settings className="sidebar-primary-nav-icon" aria-hidden />
                <span className="sidebar-primary-nav-text">{t("settings.title")}</span>
                <ChevronUp
                  size={14}
                  className={`sidebar-settings-chevron${isSettingsMenuOpen ? " is-open" : ""}`}
                  aria-hidden
                />
              </button>
            </div>
          </div>
        </div>
      </div>
      {folderMovePicker ? (
        <div
          className="sidebar-workspace-menu-backdrop"
          onClick={closeFolderMovePicker}
          onContextMenu={(event) => {
            event.preventDefault();
            closeFolderMovePicker();
          }}
        >
          <div
            className="sidebar-workspace-menu sidebar-folder-move-picker"
            role="dialog"
            aria-label={t("threads.moveToFolder")}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            <div className="sidebar-workspace-menu-group">
              <div className="sidebar-workspace-menu-group-title">
                {t("threads.moveToFolder")}
              </div>
              <input
                className="sidebar-search-input sidebar-folder-move-picker-input"
                value={folderMovePickerQuery}
                onChange={(event) => setFolderMovePickerQuery(event.target.value)}
                placeholder={t("threads.searchFolderTargets")}
                aria-label={t("threads.searchFolderTargets")}
                data-tauri-drag-region="false"
                autoFocus
              />
              <div className="sidebar-folder-move-picker-list" role="listbox">
                {filteredFolderMoveTargets.map((target) => {
                  const isCurrentTarget =
                    (target.folderId ?? null) === (folderMovePicker.currentFolderId ?? null);
                  return (
                    <button
                      key={target.folderId ?? "__root__"}
                      type="button"
                      className={`sidebar-workspace-menu-item${
                        isCurrentTarget ? " is-unavailable" : ""
                      }`}
                      role="option"
                      aria-selected={isCurrentTarget}
                      disabled={isCurrentTarget}
                      onClick={() => void selectFolderMoveTarget(target)}
                    >
                      <span className="sidebar-workspace-menu-item-label">
                        {target.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {workspaceMenuState ? (
        <div
          className="sidebar-workspace-menu-backdrop"
          onClick={closeWorkspaceMenu}
          onContextMenu={(event) => {
            event.preventDefault();
            closeWorkspaceMenu();
          }}
        >
          <div
            className="sidebar-workspace-menu"
            role="menu"
            aria-label={
              workspaceMenuState.groups.length === 1 &&
              workspaceMenuState.groups[0]?.id === "new-session"
                ? t("sidebar.sessionActionsGroup")
                : t("sidebar.workspaceActionsGroup")
            }
            style={{
              left: workspaceMenuState.x,
              top: workspaceMenuState.y,
            }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            {workspaceMenuState.groups.map((group, groupIndex) => (
              <div className="sidebar-workspace-menu-group" key={group.id}>
                <div className="sidebar-workspace-menu-group-title">
                  {group.label}
                </div>
                {group.actions.map((action) => (
                  <div className="sidebar-workspace-menu-item-row" key={action.id}>
                    <button
                      type="button"
                      role="menuitem"
                      className={`sidebar-workspace-menu-item${
                        action.tone === "danger" ? " is-danger" : ""
                      }${action.deprecated ? " is-deprecated" : ""}${
                        action.unavailable ? " is-unavailable" : ""
                      }`}
                      disabled={action.unavailable}
                      onClick={() => onWorkspaceMenuAction(action)}
                    >
                      <span
                        className={`sidebar-workspace-menu-item-icon sidebar-workspace-menu-item-icon-${action.iconKind}${
                          action.unavailable ? " is-unavailable" : ""
                        }`}
                        aria-hidden
                      >
                        {renderWorkspaceMenuIcon(action.iconKind)}
                      </span>
                      <span className="sidebar-workspace-menu-item-label">
                        {action.label}
                      </span>
                      {action.deprecated ? (
                        <span className="sidebar-workspace-menu-item-deprecated">
                          ({t("sidebar.deprecatedTag")})
                        </span>
                      ) : null}
                      {action.unavailable ? (
                        <span className="sidebar-workspace-menu-item-unavailable">
                          （{action.statusLabel ?? t("sidebar.unavailableTag")}）
                        </span>
                      ) : null}
                    </button>
                    {action.refreshable ? (
                      <button
                        type="button"
                        className={`sidebar-workspace-menu-item-refresh${
                          action.refreshing ? " is-refreshing" : ""
                        }`}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onPointerDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          void action.onRefresh?.();
                        }}
                        onDoubleClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        aria-label={t("common.refresh")}
                        title={t("common.refresh")}
                        data-tauri-drag-region="false"
                        disabled={action.refreshing}
                      >
                        <RefreshCw size={13} aria-hidden />
                      </button>
                    ) : null}
                  </div>
                ))}
                {groupIndex < workspaceMenuState.groups.length - 1 ? (
                  <div className="sidebar-workspace-menu-divider" aria-hidden />
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {sidebarContextMenuState ? (
        <RendererContextMenu
          menu={sidebarContextMenuState}
          onClose={closeSidebarContextMenu}
          className="renderer-context-menu sidebar-renderer-context-menu"
        />
      ) : null}
    </aside>
  );
}
