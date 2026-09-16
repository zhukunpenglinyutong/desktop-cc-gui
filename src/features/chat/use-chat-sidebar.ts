import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import type { ComposerInputHandle } from "@/components/application/ai-chat/ai-chat-composer";
import type { AiChatRepo, AiChatRepoSection, ThreadAction } from "@/components/application/ai-chat/ai-chat-sidebar";
import { ARCHIVED_SECTION_ID } from "@/components/application/ai-chat/use-sidebar-state";
import type { SessionMeta } from "@/lib/ipc";
import { pickDirectory } from "@/lib/platform";
import { useChatStore, sortedWorkspaceGroups } from "./store";
import { relativeTime } from "./time";
import { useWorkspaceUIHooks, workspaceLabelSuffix } from "./workspace-ui-bridge";
import type { ChatPageDialog } from "./ChatPageDialogs";

/** Sidebar data and actions: the workspace/thread repo list plus thread
 * selection, pin/rename/delete dispatch, workspace add/remove/reorder, and
 * the new-chat entries. */
export function useChatSidebar({
  sessionById,
  threadStreaming,
  collapseSidebarOnMobile,
  composerInputRef,
  setDialog,
}: {
  sessionById: Map<string, SessionMeta>;
  threadStreaming: boolean[];
  collapseSidebarOnMobile: () => void;
  composerInputRef: React.RefObject<ComposerInputHandle | null>;
  setDialog: (dialog: ChatPageDialog) => void;
}) {
  const { t, i18n } = useTranslation();
  const { active, workspaces, sessions, threadLimit, workspaceGroups, workspaceAliases, archivedWorkspaces, unseen } = useChatStore(
    useShallow((s) => ({
      active: s.active,
      workspaces: s.workspaces,
      sessions: s.sessions,
      threadLimit: s.threadLimit,
      workspaceGroups: s.workspaceGroups,
      workspaceAliases: s.workspaceAliases,
      archivedWorkspaces: s.archivedWorkspaces,
      unseen: s.unseen,
    })),
  );
  // Store actions are stable references — one shallow subscription for all.
  const { selectSession, startNewChat, addWorkspace, reorderWorkspaces, pinSession, setWorkspaceArchived, assignWorkspaceGroup } =
    useChatStore(
      useShallow((s) => ({
        selectSession: s.selectSession,
        startNewChat: s.startNewChat,
        addWorkspace: s.addWorkspace,
        reorderWorkspaces: s.reorderWorkspaces,
        pinSession: s.pinSession,
        setWorkspaceArchived: s.setWorkspaceArchived,
        assignWorkspaceGroup: s.assignWorkspaceGroup,
      })),
    );

  // Archived workspaces hide from the main tree; everything else (group
  // bucketing, ordering, aliases) works on the visible subset.
  const archivedIds = useMemo(() => new Set(archivedWorkspaces), [archivedWorkspaces]);
  // 订阅插件桥:插件 activate/热重载换 hooks 后,侧栏徽标随之重算。
  const uiHooks = useWorkspaceUIHooks();
  const visibleWorkspaces = useMemo(
    () => workspaces.filter((w) => !archivedIds.has(w.id)),
    [workspaces, archivedIds],
  );

  const repos: AiChatRepo[] = useMemo(() => {
    const sorted = [...sessions].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
    });
    const streamingById = new Map<string, boolean>();
    sessions.forEach((s, i) => {
      if (threadStreaming[i]) streamingById.set(`${s.engine}/${s.sessionId}`, true);
    });
    return visibleWorkspaces.map((w, index) => {
      // Sidebar alias: a user-set name replaces the folder name in the
      // sidebar only; the original stays on the row tooltip.
      const alias = workspaceAliases[w.id]?.trim();
      const suffix = workspaceLabelSuffix(w.path);
      return {
        id: w.id,
        label: alias || w.name,
        originalLabel: alias ? w.name : undefined,
        labelSuffix: suffix ?? undefined,
        defaultOpen: index === 0,
        threadLimit,
        threads: sorted.flatMap((s) => {
          if (s.workspacePath !== w.path) return [];
          return [
            {
              id: `${s.engine}/${s.sessionId}`,
              label: s.customTitle || s.title || s.sessionId.slice(0, 8),
              engine: s.engine,
              time: relativeTime(s.updatedAt),
              pinned: s.pinned,
              streaming: streamingById.get(`${s.engine}/${s.sessionId}`) ?? false,
              unseen: unseen[`${s.engine}/${s.sessionId}`] ?? false,
            },
          ];
        }),
      };
    });
  }, [visibleWorkspaces, workspaceAliases, sessions, threadLimit, threadStreaming, unseen, i18n.language, uiHooks]);
  // 工作区二级分类: bucket repos by their workspace's group assignment.
  // Ungrouped repos come first (no header), then groups in settings order.
  // Empty groups stay in the tree — the sidebar hides them at rest but
  // reveals them as drop targets while a workspace is being dragged.
  const sections: AiChatRepoSection[] | undefined = useMemo(() => {
    const groups = sortedWorkspaceGroups(workspaceGroups);
    if (groups.length === 0) return undefined;
    const groupIds = new Set(groups.map((g) => g.id));
    const ungrouped: AiChatRepo[] = [];
    const byGroup = new Map<string, AiChatRepo[]>();
    visibleWorkspaces.forEach((w, index) => {
      const repo = repos[index];
      if (!repo) return;
      const groupId = w.groupId;
      if (groupId && groupIds.has(groupId)) {
        const list = byGroup.get(groupId) ?? [];
        list.push(repo);
        byGroup.set(groupId, list);
      } else {
        ungrouped.push(repo);
      }
    });
    const result: AiChatRepoSection[] = [];
    if (ungrouped.length > 0) result.push({ id: null, name: "", repos: ungrouped });
    groups.forEach((group) => {
      result.push({ id: group.id, name: group.name, repos: byGroup.get(group.id) ?? [] });
    });
    return result.some((s) => s.id !== null) ? result : undefined;
  }, [repos, visibleWorkspaces, workspaceGroups]);

  // 已归档 section: archived workspaces in sidebar order, labels resolved
  // with the same alias rule as the main tree. Threads stay hidden — the
  // section exists to unarchive, not to browse.
  const archivedRepos: AiChatRepo[] = useMemo(() => {
    const result: AiChatRepo[] = [];
    for (const w of workspaces) {
      if (!archivedIds.has(w.id)) continue;
      const alias = workspaceAliases[w.id]?.trim();
      result.push({
        id: w.id,
        label: alias || w.name,
        originalLabel: alias ? w.name : undefined,
        threads: [],
      });
    }
    return result;
  }, [workspaces, archivedIds, workspaceAliases]);

  const handleAddWorkspace = useCallback(() => {
    void pickDirectory(t("chat.addWorkspace"))
      .then((path) => {
        if (path) void addWorkspace(path);
      })
      .catch(() => {});
  }, [t, addWorkspace]);

  const handleThreadSelect = useCallback(
    (id: string) => {
      const session = sessionById.get(id);
      if (session) void selectSession(session.engine, session.sessionId, session.workspacePath);
      collapseSidebarOnMobile();
    },
    [sessionById, selectSession, collapseSidebarOnMobile],
  );

  const handleThreadAction = useCallback(
    (id: string, action: ThreadAction) => {
      const session = sessionById.get(id);
      if (!session) return;
      if (action === "pin") {
        void pinSession(session.engine, session.sessionId, !session.pinned);
      } else if (action === "rename") {
        setDialog({ kind: "rename", session });
      } else if (action === "delete") {
        setDialog({ kind: "delete", session });
      }
    },
    [sessionById, pinSession, setDialog],
  );
  // 右键菜单「复制 ID」:写入原生会话 uuid(CLI --resume 可用的那个),与
  // 文件树「复制路径」一致——静默写剪贴板,失败不打扰。
  const handleCopyThreadId = useCallback(
    (id: string) => {
      const session = sessionById.get(id);
      if (!session) return;
      void navigator.clipboard.writeText(session.sessionId).catch(() => {});
    },
    [sessionById],
  );
  const handleRemoveWorkspace = useCallback(
    (workspaceId: string) => {
      setDialog({ kind: "removeWorkspace", workspaceId });
    },
    [setDialog],
  );
  const handleWorkspaceAlias = useCallback(
    (workspaceId: string) => {
      setDialog({ kind: "workspaceAlias", workspaceId });
    },
    [setDialog],
  );
  const handleSetWorkspaceArchived = useCallback(
    (workspaceId: string, archived: boolean) => {
      void setWorkspaceArchived(workspaceId, archived);
    },
    [setWorkspaceArchived],
  );

  // Sidebar 新建会话 nav entry: new chat in the active workspace (fallback:
  // first visible workspace; archived ones never pick up new chats, and no
  // workspace yet → add one first).
  const handleNewSession = useCallback(() => {
    const workspace =
      workspaces.find((w) => w.path === active?.workspacePath && !archivedIds.has(w.id)) ??
      visibleWorkspaces[0];
    if (!workspace) {
      handleAddWorkspace();
      return;
    }
    startNewChat(workspace.path);
    composerInputRef.current?.focus();
    collapseSidebarOnMobile();
  }, [workspaces, visibleWorkspaces, archivedIds, active?.workspacePath, startNewChat, handleAddWorkspace, collapseSidebarOnMobile, composerInputRef]);

  // Workspace row + button: start (or re-focus) the pending new chat in that
  // workspace.
  const handleNewSessionInWorkspace = useCallback(
    (workspaceId: string) => {
      const workspace = workspaces.find((w) => w.id === workspaceId);
      if (!workspace) return;
      startNewChat(workspace.path);
      composerInputRef.current?.focus();
      collapseSidebarOnMobile();
    },
    [workspaces, startNewChat, collapseSidebarOnMobile, composerInputRef],
  );
  const handleReorderWorkspaces = useCallback(
    (orderedIds: string[]) => void reorderWorkspaces(orderedIds),
    [reorderWorkspaces],
  );
  // Sidebar drag-and-drop: a workspace row released over a section container
  // moves there — group assignment, ungroup (null), or archive (已归档
  // sentinel, the row keeps its groupId so unarchiving restores it).
  const handleDropWorkspaceToSection = useCallback(
    (workspaceId: string, targetSectionId: string | null) => {
      if (targetSectionId === ARCHIVED_SECTION_ID) {
        void setWorkspaceArchived(workspaceId, true);
      } else {
        void assignWorkspaceGroup(workspaceId, targetSectionId);
      }
    },
    [setWorkspaceArchived, assignWorkspaceGroup],
  );

  return {
    active,
    workspaces,
    startNewChat,
    repos,
    sections,
    archivedRepos,
    handleAddWorkspace,
    handleThreadSelect,
    handleThreadAction,
    handleCopyThreadId,
    handleRemoveWorkspace,
    handleWorkspaceAlias,
    handleSetWorkspaceArchived,
    handleNewSession,
    handleNewSessionInWorkspace,
    handleReorderWorkspaces,
    handleDropWorkspaceToSection,
  };
}
