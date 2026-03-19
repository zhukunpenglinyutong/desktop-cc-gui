import type {
  AccountSnapshot,
  AppMode,
  EngineType,
  RateLimitSnapshot,
  ThreadSummary,
  WorkspaceInfo,
} from "../../../types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { useTranslation } from "react-i18next";

import { ThreadList } from "./ThreadList";
import { ThreadLoading } from "./ThreadLoading";
import { WorktreeSection } from "./WorktreeSection";
import { PinnedThreadList } from "./PinnedThreadList";
import { WorkspaceCard } from "./WorkspaceCard";
import { WorkspaceGroup } from "./WorkspaceGroup";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCollapsedGroups } from "../hooks/useCollapsedGroups";
import { useSidebarMenus } from "../hooks/useSidebarMenus";
import { useSidebarScrollFade } from "../hooks/useSidebarScrollFade";
import { useThreadRows } from "../hooks/useThreadRows";
import { isDefaultWorkspacePath } from "../../workspaces/utils/defaultWorkspace";
import { formatShortcutForPlatform, isMacPlatform } from "../../../utils/shortcuts";
import { formatRelativeTimeShort } from "../../../utils/time";
import { EngineIcon } from "../../engine/components/EngineIcon";
import { pushErrorToast } from "../../../services/toasts";
import Brain from "lucide-react/dist/esm/icons/brain";
import BrainCircuit from "lucide-react/dist/esm/icons/brain-circuit";
import BriefcaseBusiness from "lucide-react/dist/esm/icons/briefcase-business";
import ChevronUp from "lucide-react/dist/esm/icons/chevron-up";
import ChevronsDownUp from "lucide-react/dist/esm/icons/chevrons-down-up";
import Copy from "lucide-react/dist/esm/icons/copy";
import FileText from "lucide-react/dist/esm/icons/file-text";
import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import LayoutDashboard from "lucide-react/dist/esm/icons/layout-dashboard";
import Lock from "lucide-react/dist/esm/icons/lock";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import Settings from "lucide-react/dist/esm/icons/settings";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";

const UNGROUPED_COLLAPSE_ID = "__ungrouped__";

type WorkspaceGroupSection = {
  id: string | null;
  name: string;
  workspaces: WorkspaceInfo[];
};

type WorkspaceThreadRows = {
  unpinnedRows: Array<{ thread: ThreadSummary; depth: number }>;
  totalRoots: number;
};

type SidebarProps = {
  workspaces: WorkspaceInfo[];
  groupedWorkspaces: WorkspaceGroupSection[];
  hasWorkspaceGroups: boolean;
  deletingWorktreeIds: Set<string>;
  threadsByWorkspace: Record<string, ThreadSummary[]>;
  threadParentById: Record<string, string>;
  threadStatusById: Record<
    string,
    { isProcessing: boolean; hasUnread: boolean; isReviewing: boolean }
  >;
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
  onAddAgent: (workspace: WorkspaceInfo, engine?: EngineType) => void;
  onAddWorktreeAgent: (workspace: WorkspaceInfo) => void;
  onAddCloneAgent: (workspace: WorkspaceInfo) => void;
  onToggleWorkspaceCollapse: (workspaceId: string, collapsed: boolean) => void;
  onSelectThread: (workspaceId: string, threadId: string) => void;
  onDeleteThread: (workspaceId: string, threadId: string) => void;
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
  onLoadOlderThreads: (workspaceId: string) => void;
  onReloadWorkspaceThreads: (workspaceId: string) => void;
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
  onOpenMemory: () => void;
  onLockPanel?: () => void;
  onOpenProjectMemory: () => void;
  onOpenReleaseNotes: () => void;
  onOpenSpecHub: () => void;
  onOpenWorkspaceHome: () => void;
  onOpenGlobalSearch: () => void;
  globalSearchShortcut: string | null;
  topbarNode?: ReactNode;
};

export function Sidebar({
  workspaces,
  groupedWorkspaces,
  hasWorkspaceGroups: _hasWorkspaceGroups,
  deletingWorktreeIds,
  threadsByWorkspace,
  threadParentById,
  threadStatusById,
  runningSessionCountByWorkspaceId = {},
  recentSessionCountByWorkspaceId = {},
  threadListLoadingByWorkspace,
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
  onAddWorktreeAgent,
  onAddCloneAgent,
  onToggleWorkspaceCollapse,
  onSelectThread,
  onDeleteThread,
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
  onLoadOlderThreads,
  onReloadWorkspaceThreads,
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
  onOpenMemory,
  onLockPanel,
  onOpenProjectMemory,
  onOpenReleaseNotes,
  onOpenSpecHub,
  onOpenWorkspaceHome: _onOpenWorkspaceHome,
  onOpenGlobalSearch,
  globalSearchShortcut,
  topbarNode,
}: SidebarProps) {
  const { t } = useTranslation();
  const quickSearchLabel = t("sidebar.quickSearch");
  const quickSearchShortcutLabel = useMemo(
    () => {
      const normalizedShortcut = (globalSearchShortcut ?? "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "");
      const isMac = isMacPlatform();
      if (!normalizedShortcut || normalizedShortcut === "cmd+o" || normalizedShortcut === "ctrl+o") {
        return formatShortcutForPlatform(isMac ? "cmd+f" : "ctrl+f", isMac);
      }
      return formatShortcutForPlatform(globalSearchShortcut, isMac);
    },
    [globalSearchShortcut],
  );

  const [expandedWorkspaces, setExpandedWorkspaces] = useState(
    new Set<string>(),
  );
  const [collapsedWorktreeSections, setCollapsedWorktreeSections] = useState(
    new Set<string>(),
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isSearchOpen] = useState(false);
  const [isSettingsMenuOpen, setIsSettingsMenuOpen] = useState(false);
  const settingsMenuRef = useRef<HTMLDivElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const { collapsedGroups, toggleGroupCollapse, replaceCollapsedGroups } =
    useCollapsedGroups();
  const { getThreadRows } = useThreadRows(threadParentById);
  const {
    showThreadMenu,
    showWorkspaceMenu,
    showWorktreeMenu,
    workspaceMenuState,
    closeWorkspaceMenu,
    onWorkspaceMenuAction,
  } =
    useSidebarMenus({
      onAddAgent,
      onDeleteThread,
      onSyncThread,
      onPinThread: pinThread,
      onUnpinThread: unpinThread,
      isThreadPinned,
      isThreadAutoNaming,
      onRenameThread,
      onAutoNameThread,
      onReloadWorkspaceThreads,
      onDeleteWorkspace,
      onDeleteWorktree,
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
    window.addEventListener("keydown", handleWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  }, [workspaceMenuState, closeWorkspaceMenu]);

  const renderWorkspaceMenuIcon = useCallback((iconKind: string) => {
    switch (iconKind) {
      case "engine-claude":
        return <EngineIcon engine="claude" size={14} />;
      case "engine-codex":
        return <EngineIcon engine="codex" size={14} style={{ color: "#10a37f" }} />;
      case "engine-opencode":
        return <EngineIcon engine="opencode" size={14} style={{ color: "#3b82f6" }} />;
      case "engine-gemini":
        return <EngineIcon engine="gemini" size={14} />;
      case "reload":
        return <RefreshCw size={13} />;
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
      rows: ThreadRow[];
    }> = [];

    workspaces.forEach((workspace) => {
      if (!isWorkspaceMatch(workspace)) {
        return;
      }
      const threads = threadsByWorkspace[workspace.id] ?? [];
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
        })),
      );
  }, [
    workspaces,
    threadsByWorkspace,
    getThreadRows,
    getPinTimestamp,
    isWorkspaceMatch,
    pinnedThreadsVersion,
  ]);

  const scrollFadeDeps = useMemo(
    () => [groupedWorkspaces, threadsByWorkspace, expandedWorkspaces, normalizedQuery],
    [groupedWorkspaces, threadsByWorkspace, expandedWorkspaces, normalizedQuery],
  );
  const { sidebarBodyRef, scrollFade, updateScrollFade } =
    useSidebarScrollFade(scrollFadeDeps);

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

  const isSearchActive = Boolean(normalizedQuery);

  const hasNamedGroupsInView = useMemo(
    () => filteredGroupedWorkspacesWithoutDefault.some((g) => g.id !== null),
    [filteredGroupedWorkspacesWithoutDefault],
  );

  const threadRowsByWorkspace = useMemo(() => {
    const rowsByWorkspace = new Map<string, WorkspaceThreadRows>();
    const hasNamedGroups = filteredGroupedWorkspaces.some((g) => g.id !== null);
    filteredGroupedWorkspaces.forEach((group) => {
      const showGroupHeader = Boolean(group.id) || hasNamedGroups;
      const toggleId = group.id ?? (showGroupHeader ? UNGROUPED_COLLAPSE_ID : null);
      const isGroupCollapsed = Boolean(toggleId && collapsedGroups.has(toggleId));
      if (isGroupCollapsed) {
        return;
      }
      group.workspaces.forEach((workspace) => {
        if (workspace.settings.sidebarCollapsed) {
          rowsByWorkspace.set(workspace.id, { unpinnedRows: [], totalRoots: 0 });
          return;
        }
        const threads = threadsByWorkspace[workspace.id] ?? [];
        const isExpanded = expandedWorkspaces.has(workspace.id);
        const { unpinnedRows, totalRoots } = getThreadRows(
          threads,
          isExpanded,
          workspace.id,
          getPinTimestamp,
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
    threadsByWorkspace,
  ]);

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
    const hasNamedGroups = groupedWorkspaces.some((g) => g.id !== null);
    const ids = new Set<string>();
    groupedWorkspaces.forEach((group) => {
      const showGroupHeader = Boolean(group.id) || hasNamedGroups;
      if (!showGroupHeader) {
        return;
      }
      ids.add(group.id ?? UNGROUPED_COLLAPSE_ID);
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
    const handle = window.setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 150);
    return () => window.clearTimeout(handle);
  }, [searchQuery]);

  const handleOpenSkillsComingSoon = useCallback(() => {
    pushErrorToast({
      title: t("sidebar.comingSoon"),
      message: t("sidebar.comingSoonMessage"),
      durationMs: 3000,
    });
  }, [t]);

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
    const isLoadingThreads =
      threadListLoadingByWorkspace[entry.id] ?? false;
    const showThreadLoader =
      !isCollapsed && isLoadingThreads && threads.length === 0;
    const isPaging = threadListPagingByWorkspace[entry.id] ?? false;
    const worktrees = worktreesByParent.get(entry.id) ?? [];
    const isWorktreeSectionCollapsed =
      collapsedWorktreeSections.has(entry.id);
    const hasPrimaryActiveThread =
      entry.id === activeWorkspaceId && Boolean(activeThreadId);
    const runningSessionCount = (runningSessionCountByWorkspaceId[entry.id] ?? 0) +
      worktrees.reduce(
        (sum, worktree) => sum + (runningSessionCountByWorkspaceId[worktree.id] ?? 0),
        0,
      );
    const recentSessionCount = (recentSessionCountByWorkspaceId[entry.id] ?? 0) +
      worktrees.reduce(
        (sum, worktree) => sum + (recentSessionCountByWorkspaceId[worktree.id] ?? 0),
        0,
      );
    const hasRunningSession = runningSessionCount > 0 || (hasRunningSessionByProjectId.get(entry.id) ?? false);
    return (
      <WorkspaceCard
        key={entry.id}
        workspace={entry}
        workspaceName={renderHighlightedName(entry.name)}
        isActive={entry.id === activeWorkspaceId}
        hasPrimaryActiveThread={hasPrimaryActiveThread}
        hasRunningSession={hasRunningSession}
        runningSessionCount={runningSessionCount}
        recentSessionCount={recentSessionCount}
        isCollapsed={isCollapsed}
        onSelectWorkspace={onSelectWorkspace}
        onShowWorkspaceMenu={showWorkspaceMenu}
        onToggleWorkspaceCollapse={onToggleWorkspaceCollapse}
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
            runningSessionCountByWorkspaceId={runningSessionCountByWorkspaceId}
            recentSessionCountByWorkspaceId={recentSessionCountByWorkspaceId}
            threadListLoadingByWorkspace={threadListLoadingByWorkspace}
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
            getPinTimestamp={getPinTimestamp}
            onSelectWorkspace={onSelectWorkspace}
            onConnectWorkspace={onConnectWorkspace}
            onToggleWorkspaceCollapse={onToggleWorkspaceCollapse}
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
        {showThreadList && (
          <ThreadList
            workspaceId={entry.id}
            pinnedRows={[]}
            unpinnedRows={unpinnedRows}
            totalThreadRoots={totalThreadRoots}
            isExpanded={isExpanded}
            nextCursor={nextCursor}
            isPaging={isPaging}
            activeWorkspaceId={activeWorkspaceId}
            activeThreadId={activeThreadId}
            systemProxyEnabled={systemProxyEnabled}
            systemProxyUrl={systemProxyUrl}
            threadStatusById={threadStatusById}
            getThreadTime={getThreadTime}
            isThreadPinned={isThreadPinned}
            isThreadAutoNaming={isThreadAutoNaming}
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
        )}
        {showThreadLoader && (
          <ThreadLoading />
        )}
      </WorkspaceCard>
    );
  }, [
    activeThreadId,
    activeWorkspaceId,
    collapsedWorktreeSections,
    deleteConfirmBusy,
    deleteConfirmThreadId,
    deleteConfirmWorkspaceId,
    deletingWorktreeIds,
    expandedWorkspaces,
    getPinTimestamp,
    getThreadRows,
    getThreadTime,
    handleToggleExpanded,
    handleToggleWorktreeSection,
    isThreadAutoNaming,
    isThreadPinned,
    hasRunningSessionByProjectId,
    recentSessionCountByWorkspaceId,
    runningSessionCountByWorkspaceId,
    onCancelDeleteConfirm,
    onConfirmDeleteConfirm,
    onConnectWorkspace,
    onLoadOlderThreads,
    onSelectThread,
    onSelectWorkspace,
    showThreadMenu,
    showWorkspaceMenu,
    showWorktreeMenu,
    onToggleWorkspaceCollapse,
    renderHighlightedName,
    threadListCursorByWorkspace,
    threadListLoadingByWorkspace,
    threadListPagingByWorkspace,
    threadRowsByWorkspace,
    threadStatusById,
    threadsByWorkspace,
    worktreesByParent,
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
      <div className="sidebar-topbar-placeholder">
        {topbarNode ? (
          <div className="sidebar-topbar-content">
            {topbarNode}
          </div>
        ) : null}
      </div>
      <div className={`sidebar-search${isSearchOpen ? " is-open" : ""}`}>
        {isSearchOpen && (
          <input
            className="sidebar-search-input"
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
            className="sidebar-search-clear"
            onClick={() => setSearchQuery("")}
            aria-label={t("sidebar.clearSearch")}
            data-tauri-drag-region="false"
          >
            <span className="codicon codicon-close" style={{ fontSize: "12px" }} aria-hidden />
          </button>
        )}
      </div>
      <div
        className={`workspace-drop-overlay${
          isWorkspaceDropActive ? " is-active" : ""
        }`}
        aria-hidden
      >
        <div
          className={`workspace-drop-overlay-text${
            workspaceDropText === "Adding Project..." ? " is-busy" : ""
          }`}
        >
          {workspaceDropText === "Drop Project Here" && (
            <span className="codicon codicon-folder-opened workspace-drop-overlay-icon" aria-hidden />
          )}
          {workspaceDropText === "Drop Project Here"
            ? t("sidebar.dropProjectHere")
            : workspaceDropText === "Adding Project..."
              ? t("sidebar.addingProject")
              : workspaceDropText}
        </div>
      </div>
      <div className="sidebar-body">
        <div className="sidebar-body-layout">
          <nav className="sidebar-primary-nav" aria-label={t("tabbar.primaryNavigation")}>
            <button
              type="button"
              className={`sidebar-primary-nav-item sidebar-primary-nav-mode-item ${appMode === "chat" ? "is-active" : ""}`}
              onClick={onOpenHomeChat}
              title={t("sidebar.quickNewThread")}
              aria-label={t("sidebar.quickNewThread")}
              data-tauri-drag-region="false"
            >
              <svg className="sidebar-primary-nav-icon" aria-hidden width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M14.7842 2.9688C15.0826 2.67043 15.4873 2.50281 15.9092 2.50281C16.3312 2.50281 16.7359 2.67043 17.0342 2.9688C17.3326 3.26717 17.5002 3.67184 17.5002 4.0938C17.5002 4.51575 17.3326 4.92043 17.0342 5.2188L10.2745 11.9793C10.0964 12.1572 9.8764 12.2875 9.63475 12.358L7.48 12.988C7.41546 13.0069 7.34705 13.008 7.28193 12.9913C7.21681 12.9746 7.15737 12.9407 7.10983 12.8932C7.0623 12.8457 7.02842 12.7862 7.01173 12.7211C6.99505 12.656 6.99618 12.5876 7.015 12.523L7.645 10.3683C7.71589 10.1268 7.8464 9.90709 8.0245 9.7293L14.7842 2.9688Z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M10 3.25H6.25C4.59315 3.25 3.25 4.59315 3.25 6.25V13.75C3.25 15.4069 4.59315 16.75 6.25 16.75H13.75C15.4069 16.75 16.75 15.4069 16.75 13.75V10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
              <span className="sidebar-primary-nav-text">{t("sidebar.quickNewThread")}</span>
            </button>
            <button
              type="button"
              className={`sidebar-primary-nav-item sidebar-primary-nav-mode-item ${appMode === "kanban" ? "is-active" : ""}`}
              onClick={() => onAppModeChange("kanban")}
              title={t("sidebar.quickAutomation")}
              aria-label={t("sidebar.quickAutomation")}
              data-tauri-drag-region="false"
            >
              <svg className="sidebar-primary-nav-icon" aria-hidden width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M10 3.25V16C10 16.1989 9.92098 16.3897 9.78033 16.5303C9.63968 16.671 9.44891 16.75 9.25 16.75H4.75C4.35218 16.75 3.97064 16.592 3.68934 16.3107C3.40804 16.0294 3.25 15.6478 3.25 15.25V4.75C3.25 4.35218 3.40804 3.97064 3.68934 3.68934C3.97064 3.40804 4.35218 3.25 4.75 3.25H15.25C15.6478 3.25 16.0294 3.40804 16.3107 3.68934C16.592 3.97064 16.75 4.35218 16.75 4.75V9.25C16.75 9.44891 16.671 9.63968 16.5303 9.78033C16.3897 9.92098 16.1989 10 16 10H3.25" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M13 15.25H17.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M15.25 17.5V13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span className="sidebar-primary-nav-text">{t("sidebar.quickAutomation")}</span>
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
            className={`sidebar-content-column${scrollFade.top ? " fade-top" : ""}${
              scrollFade.bottom ? " fade-bottom" : ""
            }`}
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
                  getThreadTime={getThreadTime}
                  isThreadPinned={isThreadPinned}
                  isThreadAutoNaming={isThreadAutoNaming}
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
                className="sidebar-title-add sidebar-title-toggle-all"
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
              <button
                className="sidebar-title-add"
                onClick={onAddWorkspace}
                data-tauri-drag-region="false"
                aria-label={t("sidebar.addWorkspace")}
                type="button"
                title={t("sidebar.addWorkspace")}
              >
                <span
                  className="codicon codicon-new-folder"
                  aria-hidden
                  style={{ fontSize: "16px" }}
                />
              </button>
            </div>
            <div className="workspace-list">
          {defaultWorkspaceEntries.map(renderWorkspaceEntry)}
          {filteredGroupedWorkspacesWithoutDefault.map((group) => {
            const groupId = group.id;
            const showGroupHeader = Boolean(groupId) || hasNamedGroupsInView;
            const toggleId = groupId ?? (showGroupHeader ? UNGROUPED_COLLAPSE_ID : null);
            const isGroupCollapsed = Boolean(
              toggleId && collapsedGroups.has(toggleId),
            );
            const visibleWorkspaces = isGroupCollapsed ? [] : group.workspaces;

            return (
              <WorkspaceGroup
                key={group.id ?? "ungrouped"}
                toggleId={toggleId}
                name={group.name}
                showHeader={showGroupHeader}
                isCollapsed={isGroupCollapsed}
                onToggleCollapse={toggleGroupCollapse}
              >
                {visibleWorkspaces.map(renderWorkspaceEntry)}
              </WorkspaceGroup>
            );
          })}
          {!filteredGroupedWorkspacesWithoutDefault.length && defaultWorkspaceEntries.length === 0 && (
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
                      onOpenMemory();
                    }}
                  >
                    <BrainCircuit size={14} aria-hidden />
                    <span>{t("sidebar.longTermMemory")}</span>
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
            aria-label={t("sidebar.workspaceActionsGroup")}
            style={{
              left: workspaceMenuState.x,
              top: workspaceMenuState.y,
            }}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            {workspaceMenuState.groups.map((group, groupIndex) => (
              <div className="sidebar-workspace-menu-group" key={group.id}>
                <div className="sidebar-workspace-menu-group-title">
                  {group.label}
                </div>
                {group.actions.map((action) => (
                  <button
                    key={action.id}
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
                        ({t("sidebar.unavailableTag")})
                      </span>
                    ) : null}
                  </button>
                ))}
                {groupIndex < workspaceMenuState.groups.length - 1 ? (
                  <div className="sidebar-workspace-menu-divider" aria-hidden />
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </aside>
  );
}
