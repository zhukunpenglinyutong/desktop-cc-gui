import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import type { ComposerInputHandle } from "@/components/application/ai-chat/ai-chat-composer";
import { useBrowserStore } from "@/features/browser/store";
import { useMissionStore } from "@/features/mission/store";
import { usePluginHubStore } from "@/features/plugins/hub/store";
import type { AiChatRepo, AiChatRepoSection, ThreadAction } from "@/components/application/ai-chat/ai-chat-sidebar";
import { ARCHIVED_SECTION_ID } from "@/components/application/ai-chat/use-sidebar-state";
import { copyText } from "@/lib/clipboard";
import { worktreeMetaOf, type SessionMeta, type Workspace } from "@/lib/ipc";
import { isWeb, pickDirectory } from "@/lib/platform";
import { recentPointerAnchor } from "@/lib/pointer-anchor";
import { parseDraftSessionKey, sessionKey, useChatStore, sortedWorkspaceGroups } from "./store";
import { dismissCenterSurfaces } from "./center-surfaces";
import { focusComposerWhenVisible } from "./focus-composer";
import { relativeTime } from "./time";
import { useWorkspaceUIHooks, workspaceLabelSuffix } from "./workspace-ui-bridge";
import type { ChatPageDialog } from "./ChatPageDialogs";

/** Sidebar data and actions: the workspace/thread repo list plus thread
 * selection, pin/rename/delete dispatch, workspace add/remove/reorder, and
 * the new-chat entries. */
export function useChatSidebar({
  sessionById,
  threadStreaming,
  threadRetrying,
  collapseSidebarOnMobile,
  composerInputRef,
  setDialog,
}: {
  sessionById: Map<string, SessionMeta>;
  threadStreaming: boolean[];
  threadRetrying: boolean[];
  collapseSidebarOnMobile: () => void;
  composerInputRef: React.RefObject<ComposerInputHandle | null>;
  setDialog: (dialog: ChatPageDialog) => void;
}) {
  const { t, i18n } = useTranslation();
  const { active, openTabs, workspaces, sessions, threadLimit, workspaceGroups, workspaceAliases, archivedWorkspaces, unseen } = useChatStore(
    useShallow((s) => ({
      active: s.active,
      openTabs: s.openTabs,
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
  const { selectSession, startNewChat, addWorkspace, reorderWorkspaces, pinSession, archiveSession, setWorkspaceArchived, assignWorkspaceGroup, createWorkspaceGroup, focusTab, closeTab } =
    useChatStore(
      useShallow((s) => ({
        selectSession: s.selectSession,
        startNewChat: s.startNewChat,
        addWorkspace: s.addWorkspace,
        reorderWorkspaces: s.reorderWorkspaces,
        pinSession: s.pinSession,
        archiveSession: s.archiveSession,
        setWorkspaceArchived: s.setWorkspaceArchived,
        assignWorkspaceGroup: s.assignWorkspaceGroup,
        createWorkspaceGroup: s.createWorkspaceGroup,
        focusTab: s.focusTab,
        closeTab: s.closeTab,
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
  // Worktree 子工作区：父行在可见集里就挂到父行下，父不可见（已归档/
  // 被移除后残留）时降级为普通顶层行，不丢入口。
  const { parentWorkspaces, childrenByParent } = useMemo(() => {
    const visibleIds = new Set(visibleWorkspaces.map((w) => w.id));
    const parents: Workspace[] = [];
    const children = new Map<string, Workspace[]>();
    for (const w of visibleWorkspaces) {
      if (w.parentId && visibleIds.has(w.parentId)) {
        const list = children.get(w.parentId) ?? [];
        list.push(w);
        children.set(w.parentId, list);
      } else {
        parents.push(w);
      }
    }
    return { parentWorkspaces: parents, childrenByParent: children };
  }, [visibleWorkspaces]);

  const repos: AiChatRepo[] = useMemo(() => {
    const sorted = [...sessions].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
    });
    const streamingById = new Map<string, boolean>();
    const retryingById = new Map<string, boolean>();
    sessions.forEach((s, i) => {
      if (threadStreaming[i]) streamingById.set(`${s.engine}/${s.sessionId}`, true);
      if (threadRetrying[i]) retryingById.set(`${s.engine}/${s.sessionId}`, true);
    });
    const buildRepo = (w: Workspace, defaultOpen: boolean): AiChatRepo => {
      // Sidebar alias: a user-set name replaces the folder name in the
      // sidebar only; the original stays on the row tooltip.
      const alias = workspaceAliases[w.id]?.trim();
      const suffix = workspaceLabelSuffix(w.path);
      const meta = worktreeMetaOf(w);
      const children = childrenByParent.get(w.id);
      return {
        id: w.id,
        path: w.path,
        // Worktree 子行的主名是分支名（mockup 场景 1），目录名进 tooltip。
        label: alias || (meta?.branch ?? w.name),
        originalLabel: alias || meta ? w.name : undefined,
        labelSuffix: suffix ?? undefined,
        defaultOpen,
        threadLimit,
        worktree: meta ? { branch: meta.branch, prNumber: meta.prNumber ?? undefined } : undefined,
        worktrees: children?.map((c) => buildRepo(c, false)),
        threads: [
          ...openTabs.flatMap((tab) => {
            if (tab.sessionId !== null || tab.workspacePath !== w.path) return [];
            return [
              {
                id: sessionKey(tab.engine, null, tab.workspacePath),
                label: t("chat.newChat"),
                engine: tab.engine,
                time: "",
                isDraft: true,
              },
            ];
          }),
          ...sorted.flatMap((s) => {
            if (s.workspacePath !== w.path) return [];
            return [
              {
                id: `${s.engine}/${s.sessionId}`,
                label: s.customTitle || s.title || s.sessionId.slice(0, 8),
                engine: s.engine,
                time: relativeTime(s.updatedAt),
                pinned: s.pinned,
                streaming: streamingById.get(`${s.engine}/${s.sessionId}`) ?? false,
                retrying: retryingById.get(`${s.engine}/${s.sessionId}`) ?? false,
                unseen: unseen[`${s.engine}/${s.sessionId}`] ?? false,
              },
            ];
          }),
        ],
      };
    };
    return parentWorkspaces.map((w, index) => buildRepo(w, index === 0));
  }, [parentWorkspaces, childrenByParent, workspaceAliases, sessions, openTabs, threadLimit, threadStreaming, threadRetrying, unseen, i18n.language, uiHooks, t]);
  // 工作区二级分类: bucket repos by their workspace's group assignment.
  // Ungrouped repos come first (no header), then groups in settings order.
  // Empty groups stay in the tree — the sidebar renders them like populated
  // ones so a freshly created group is visible before it has members.
  const sections: AiChatRepoSection[] | undefined = useMemo(() => {
    const groups = sortedWorkspaceGroups(workspaceGroups);
    if (groups.length === 0) return undefined;
    const groupIds = new Set(groups.map((g) => g.id));
    const ungrouped: AiChatRepo[] = [];
    const byGroup = new Map<string, AiChatRepo[]>();
    parentWorkspaces.forEach((w, index) => {
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
  }, [repos, parentWorkspaces, workspaceGroups]);

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
    // 移动端/网页访问模式没有目录选择器，侧栏也不渲染添加入口。
    if (isWeb) return;
    void pickDirectory(t("chat.addWorkspace"))
      .then((path) => {
        if (path) void addWorkspace(path);
      })
      .catch(() => {});
  }, [t, addWorkspace]);

  const handleThreadSelect = useCallback(
    (id: string) => {
      // Selecting a conversation brings the chat surface back; other center
      // surfaces step aside (their tabs stay in the strip).
      dismissCenterSurfaces();
      const session = sessionById.get(id);
      if (session) {
        void selectSession(session.engine, session.sessionId, session.workspacePath);
        collapseSidebarOnMobile();
        return;
      }
      const draft = parseDraftSessionKey(id);
      if (draft) {
        focusTab(draft.engine, null, draft.workspacePath);
        collapseSidebarOnMobile();
      }
    },
    [sessionById, selectSession, focusTab, collapseSidebarOnMobile],
  );

  const handleThreadAction = useCallback(
    (id: string, action: ThreadAction) => {
      const session = sessionById.get(id);
      if (session) {
        if (action === "pin") {
          void pinSession(session.engine, session.sessionId, !session.pinned);
        } else if (action === "rename") {
          setDialog({ kind: "rename", session });
        } else if (action === "archive") {
          void archiveSession(session);
        } else if (action === "delete") {
          setDialog({ kind: "delete", session, anchor: recentPointerAnchor() ?? undefined });
        }
        return;
      }
      const draft = parseDraftSessionKey(id);
      if (draft && action === "delete") {
        closeTab(draft.engine, null, draft.workspacePath);
      }
    },
    [sessionById, pinSession, archiveSession, setDialog, closeTab],
  );
  // 右键菜单「复制 ID」:写入原生会话 uuid(CLI --resume 可用的那个),与
  // 文件树「复制路径」一致——静默写剪贴板,失败不打扰。
  const handleCopyThreadId = useCallback(
    (id: string) => {
      const session = sessionById.get(id);
      if (!session) return;
      void copyText(session.sessionId);
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
      // 归档带 worktree 子项的父行 → 级联确认（一并归档/仅父行由用户选）；
      // 取消归档或无子项时直接执行。
      if (
        archived &&
        workspaces.some((w) => w.parentId === workspaceId)
      ) {
        setDialog({ kind: "archiveWorkspace", workspaceId });
        return;
      }
      void setWorkspaceArchived(workspaceId, archived);
    },
    [workspaces, setWorkspaceArchived, setDialog],
  );
  // 右键菜单/WORKTREES 分组 ＋：打开创建对话框（目标是该工作区所在仓库——
  // worktree 行上触发时落到它的父工作区）。
  const handleNewWorktree = useCallback(
    (workspaceId: string) => {
      const workspace = workspaces.find((w) => w.id === workspaceId);
      const parentId = workspace?.parentId ?? workspaceId;
      setDialog({ kind: "createWorktree", workspaceId: parentId });
    },
    [workspaces, setDialog],
  );
  const handleDeleteWorktree = useCallback(
    (workspaceId: string) => {
      setDialog({ kind: "deleteWorktree", workspaceId });
    },
    [setDialog],
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
    dismissCenterSurfaces();
    startNewChat(workspace.path);
    // 中心面可能刚从别处（插件中心/浏览器）切回来，那时直接 focus() 会被
    // 浏览器忽略（隐藏元素），交给等可见的助手。
    focusComposerWhenVisible(composerInputRef);
    collapseSidebarOnMobile();
  }, [workspaces, visibleWorkspaces, archivedIds, active?.workspacePath, startNewChat, handleAddWorkspace, collapseSidebarOnMobile, composerInputRef]);

  // Workspace row + button: start (or re-focus) the pending new chat in that
  // workspace.
  const handleNewSessionInWorkspace = useCallback(
    (workspaceId: string) => {
      const workspace = workspaces.find((w) => w.id === workspaceId);
      if (!workspace) return;
      dismissCenterSurfaces();
      startNewChat(workspace.path);
      focusComposerWhenVisible(composerInputRef);
      collapseSidebarOnMobile();
    },
    [workspaces, startNewChat, collapseSidebarOnMobile, composerInputRef],
  );
  // Sidebar 新建浏览器 nav entry: open a fresh browser tab in the center
  // strip. Other center surfaces step aside (same mutual exclusion as
  // handleTabSelect) — otherwise an active plugin hub/workbench keeps the
  // center in place while the strip already highlights the new tab.
  const handleNewBrowser = useCallback(() => {
    dismissCenterSurfaces();
    useBrowserStore.getState().openTab();
    collapseSidebarOnMobile();
  }, [collapseSidebarOnMobile]);
  // Sidebar 任务工作台 nav entry（原生）：打开中心页签的工作台，其他
  // 中心面（浏览器/文件/插件页/差异）暂时让位；数据留在 mission store。
  const handleOpenMission = useCallback(() => {
    dismissCenterSurfaces();
    useMissionStore.getState().openWorkbench();
    collapseSidebarOnMobile();
  }, [collapseSidebarOnMobile]);
  // Sidebar 插件 nav entry（原生）：打开插件中心中心页签（市场 + 已安装管理）。
  const handleOpenPlugins = useCallback(() => {
    dismissCenterSurfaces();
    usePluginHubStore.getState().openHub();
    collapseSidebarOnMobile();
  }, [collapseSidebarOnMobile]);
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

  // Sidebar blank-area menu「新建分组」: validate like the settings page
  // (the store re-checks as the source of truth), then create. The composer
  // stays open on a validation error via the returned message.
  const handleCreateGroup = useCallback(
    (name: string): string | null => {
      const trimmed = name.trim();
      if (!trimmed) return t("settings.groupNameRequired");
      if (workspaceGroups.some((g) => g.name === trimmed)) {
        return t("settings.groupNameDuplicate");
      }
      void createWorkspaceGroup(trimmed).catch((error: unknown) =>
        console.error("[chat] createWorkspaceGroup failed", error),
      );
      return null;
    },
    [workspaceGroups, createWorkspaceGroup, t],
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
    handleNewBrowser,
    handleOpenPlugins,
    handleOpenMission,
    handleReorderWorkspaces,
    handleDropWorkspaceToSection,
    handleCreateGroup,
    handleNewWorktree,
    handleDeleteWorktree,
  };
}
