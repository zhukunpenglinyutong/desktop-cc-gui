// @ts-nocheck
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { homeDir } from "@tauri-apps/api/path";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { ensureWorkspacePathDir, isWebServiceRuntime } from "../services/tauri";
import { pushErrorToast } from "../services/toasts";
import {
  isKanbanThreadCompatibleWithEngine,
  resolveKanbanThreadCreationStrategy,
} from "../features/kanban/utils/contextMode";
import { deriveKanbanTaskTitle } from "../features/kanban/utils/taskTitle";
import { findTaskDownstream } from "../features/kanban/utils/chaining";
import { buildChainedPromptPrefix, extractKanbanResultSnapshot } from "../features/kanban/utils/resultSnapshot";
import {
  applyMissedRunPolicy,
  hasReachedRecurringRoundLimit,
  isScheduleDue,
  markRecurringScheduleCompleted,
  markScheduleTriggered,
  resolvePostProcessingStatus,
} from "../features/kanban/utils/scheduling";
import type {
  KanbanTask,
  KanbanTaskExecutionSource,
  KanbanTaskStatus,
} from "../features/kanban/types";
import { useSoloMode } from "../features/layout/hooks/useSoloMode";
import { useLiveEditPreview } from "../features/live-edit-preview/hooks/useLiveEditPreview";
import { useArchiveShortcut } from "../features/app/hooks/useArchiveShortcut";
import { useAppSurfaceShortcuts } from "../features/app/hooks/useAppSurfaceShortcuts";
import { usePrimaryModeShortcuts } from "../features/app/hooks/usePrimaryModeShortcuts";
import { useWorkspaceCycling } from "../features/app/hooks/useWorkspaceCycling";
import { useAppMenuEvents } from "../features/app/hooks/useAppMenuEvents";
import { useMenuAcceleratorController } from "../features/app/hooks/useMenuAcceleratorController";
import { useMenuLocalization } from "../features/app/hooks/useMenuLocalization";
import { runWithLoadingProgress } from "../features/app/utils/loadingProgressActions";
import { isDefaultWorkspacePath } from "../features/workspaces/utils/defaultWorkspace";
import { normalizeSharedSessionEngine } from "../features/shared-session/utils/sharedSessionEngines";
import type { WorkspaceHomeDeleteResult } from "../features/workspaces/components/WorkspaceHome";
import type { EngineType, MessageSendOptions, WorkspaceInfo } from "../types";
import type { KanbanContextMode } from "../features/kanban/utils/contextMode";

const KANBAN_TAG_REGEX = /&@[^\s]+/g;
const KANBAN_SCHEDULER_INTERVAL_MS = 20_000;
const KANBAN_EXECUTION_LOCK_STALE_MS = 120_000;

export function stripComposerKanbanTagsPreserveFormatting(text: string): string {
  if (!text || !text.includes("&@")) {
    return text;
  }
  const stripped = text.replace(KANBAN_TAG_REGEX, "");
  return stripped
    .replace(/[ \t]+(\r?\n)/g, "$1")
    .replace(/(\r?\n)[ \t]+/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function resolveTaskThreadId(
  threadId: string | null | undefined,
  resolveCanonicalThreadId?: ((threadId: string) => string) | null,
): string | null {
  if (!threadId) {
    return null;
  }
  if (!resolveCanonicalThreadId) {
    return threadId;
  }
  const canonical = resolveCanonicalThreadId(threadId);
  return canonical || threadId;
}

export function resolvePendingSessionThreadCandidate(params: {
  pendingThreadId: string;
  workspaceThreadIds: string[];
  occupiedThreadIds: Set<string>;
}): string | null {
  const isClaudePending = params.pendingThreadId.startsWith("claude-pending-");
  const isOpenCodePending = params.pendingThreadId.startsWith("opencode-pending-");
  if (!isClaudePending && !isOpenCodePending) {
    return null;
  }
  const sessionPrefix = isClaudePending ? "claude:" : "opencode:";
  const candidates = params.workspaceThreadIds.filter(
    (threadId) =>
      threadId.startsWith(sessionPrefix) &&
      !params.occupiedThreadIds.has(threadId),
  );
  return candidates.length === 1 ? candidates[0] : null;
}

export function shouldSyncComposerEngineForKanbanExecution(params: {
  activate?: boolean;
}): boolean {
  return params.activate !== false;
}

export async function syncKanbanExecutionEngineAndModel(params: {
  activate?: boolean;
  engine: "claude" | "codex";
  modelId?: string | null;
  setActiveEngine: (engine: "claude" | "codex") => Promise<void> | void;
  setSelectedModelId: (modelId: string) => void;
  setEngineSelectedModelIdByType: (
    updater: (prev: Record<string, string>) => Record<string, string>,
  ) => void;
}): Promise<{ shouldSyncComposerSelection: boolean; outboundModel?: string }> {
  const shouldSyncComposerSelection = shouldSyncComposerEngineForKanbanExecution({
    activate: params.activate,
  });
  if (shouldSyncComposerSelection) {
    await params.setActiveEngine(params.engine);
  }
  let outboundModel: string | undefined;
  if (params.modelId) {
    if (shouldSyncComposerSelection) {
      if (params.engine === "codex") {
        params.setSelectedModelId(params.modelId);
      } else {
        params.setEngineSelectedModelIdByType((prev) => ({
          ...prev,
          [params.engine]: params.modelId,
        }));
      }
    } else {
      outboundModel = params.modelId;
    }
  }
  return { shouldSyncComposerSelection, outboundModel };
}

function isRewindSupportedThreadId(threadId: string): boolean {
  const normalized = threadId.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (normalized.startsWith("claude:") || normalized.startsWith("codex:")) {
    return true;
  }
  if (
    normalized.startsWith("claude-pending-") ||
    normalized.startsWith("codex-pending-") ||
    normalized.startsWith("gemini:") ||
    normalized.startsWith("gemini-pending-") ||
    normalized.startsWith("opencode:") ||
    normalized.startsWith("opencode-pending-")
  ) {
    return false;
  }
  if (normalized.includes(":")) {
    return false;
  }
  return true;
}

export function useAppShellSections(ctx: any) {
  const {
    activeWorkspace,
    workspaces,
    kanbanPanels,
    setKanbanViewState,
    setAppMode,
    activeEngine,
    selectedAgent,
    selectedAgentRef,
    activeWorkspaceId,
    activeThreadId,
    normalizePath,
    addWorkspaceFromPath,
    alertError,
    workspacesById,
    exitDiffView,
    connectWorkspace,
    startThreadForWorkspace,
    startSharedSessionForWorkspace,
    setCenterMode,
    selectWorkspace,
    setActiveThreadId,
    sendUserMessageToThread,
    handleComposerSend,
    isPullRequestComposer,
    resetPullRequestSelection,
    threadsByWorkspace,
    addDebugEntry,
    effectiveSelectedModelId,
    kanbanCreateTask,
    kanbanUpdateTask,
    forkThreadForWorkspace,
    forkSessionFromMessageForWorkspace,
    forkClaudeSessionFromMessageForWorkspace,
    isCompact,
    centerMode,
    setActiveTab,
    recentThreads,
    collapseRightPanel,
    setActiveEngine,
    updateSharedSessionEngineSelection,
    removeThread,
    removeThreads,
    clearDraftForThread,
    removeImagesForThread,
    t,
    setSelectedModelId,
    setEngineSelectedModelIdByType,
    threadItemsByThread,
    threadStatusById,
    kanbanTasks,
    appMode,
    setSelectedKanbanTaskId,
    selectedKanbanTaskId,
    workspacesByPath,
    kanbanViewState,
    setActiveWorkspaceId,
    setWorkspaceHomeWorkspaceId,
    updateWorkspaceSettings,
    activeTab,
    tabletTab,
    settingsOpen,
    showWorkspaceHome,
    filePanelMode,
    sidebarCollapsed,
    rightPanelCollapsed,
    isWorkspaceDropActive,
    setFilePanelMode,
    collapseSidebar,
    expandSidebar,
    expandRightPanel,
    resetSoloSplitToHalf,
    liveEditPreviewEnabled,
    workspaceActivity,
    activeEditorFilePath,
    handleOpenFile,
    handleActivateFileTab,
    handleCloseFileTab,
    handleCloseAllFileTabs,
    handleExitEditor,
    selectedDiffPath,
    isTablet,
    isPhone,
    closeSettings,
    selectHome,
    handleArchiveActiveThread,
    appSettings,
    groupedWorkspaces,
    homeWorkspaceDefaultId,
    homeWorkspaceSelectedId,
    getThreadRows,
    getPinTimestamp,
    activeWorkspaceIdRef,
    activeThreadIdRef,
    activeWorkspaceRef,
    baseWorkspaceRef,
    handleAddWorkspace,
    handleOpenNewWindow,
    handleAddAgent,
    handleAddWorktreeAgent,
    handleAddCloneAgent,
    openSettings,
    handleDebugClick,
    handleToggleRuntimeConsole,
    handleToggleTerminalPanel,
    handleToggleSearchPalette,
    composerSendLabel,
    refreshAccountRateLimits,
    setHomeOpen,
    showHome,
    showKanban,
    showGitHistory,
    showLoadingProgressDialog = () => "",
    hideLoadingProgressDialog = () => {},
    isWindowsDesktop,
    isMacDesktop,
    reduceTransparency,
    handleComposerQueue,
    setSelectedDiffPath,
    handleSelectDiff,
    setSelectedPullRequest,
    setSelectedCommitSha,
    setDiffSource,
    resolveCanonicalThreadId,
  } = ctx;

  const [selectedComposerKanbanPanelId, setSelectedComposerKanbanPanelId] =
    useState<string | null>(null);
  const [composerKanbanContextMode, setComposerKanbanContextMode] =
    useState<KanbanContextMode>("new");
  const composerKanbanWorkspacePaths = useMemo(() => {
    if (!activeWorkspace) {
      return [] as string[];
    }
    const paths = new Set<string>();
    paths.add(activeWorkspace.path);
    if (activeWorkspace.parentId) {
      const parentWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspace.parentId);
      if (parentWorkspace) {
        paths.add(parentWorkspace.path);
      }
    }
    // If current workspace is a parent/main workspace, include its worktrees too.
    for (const workspace of workspaces) {
      if (workspace.parentId === activeWorkspace.id) {
        paths.add(workspace.path);
      }
    }
    return Array.from(paths);
  }, [activeWorkspace, workspaces]);
  const composerLinkedKanbanPanels = useMemo(() => {
    if (composerKanbanWorkspacePaths.length === 0) {
      return [];
    }
    return kanbanPanels
      .filter((panel) => composerKanbanWorkspacePaths.includes(panel.workspaceId))
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt || a.sortOrder - b.sortOrder)
      .map((panel) => ({
        id: panel.id,
        name: panel.name,
        workspaceId: panel.workspaceId,
        createdAt: panel.createdAt,
      }));
  }, [composerKanbanWorkspacePaths, kanbanPanels]);

  useEffect(() => {
    if (!selectedComposerKanbanPanelId) {
      return;
    }
    const stillExists = composerLinkedKanbanPanels.some(
      (panel) => panel.id === selectedComposerKanbanPanelId,
    );
    if (!stillExists) {
      setSelectedComposerKanbanPanelId(null);
    }
  }, [composerLinkedKanbanPanels, selectedComposerKanbanPanelId]);

  const handleOpenComposerKanbanPanel = useCallback(
    (panelId: string) => {
      const panel = composerLinkedKanbanPanels.find((entry) => entry.id === panelId);
      if (!panel) {
        return;
      }
      setKanbanViewState({
        view: "board",
        workspaceId: panel.workspaceId,
        panelId,
      });
      setAppMode("kanban");
    },
    [composerLinkedKanbanPanels, setAppMode, setKanbanViewState],
  );

  const resolveComposerKanbanPanel = useCallback(
    (text: string) => {
      const tagMatches = Array.from(text.matchAll(/&@([^\s]+)/g))
        .map((entry) => entry[1]?.trim())
        .filter((value): value is string => Boolean(value));
      const panelByName = new Map(
        composerLinkedKanbanPanels.map((panel) => [panel.name, panel.id]),
      );
      const firstTaggedPanelId =
        tagMatches.map((name) => panelByName.get(name)).find(Boolean) ?? null;
      const panelId =
        firstTaggedPanelId ??
        (selectedComposerKanbanPanelId &&
        composerLinkedKanbanPanels.some(
          (panel) => panel.id === selectedComposerKanbanPanelId,
        )
          ? selectedComposerKanbanPanelId
          : null);
      const cleanText = stripComposerKanbanTagsPreserveFormatting(text);
      return { panelId, cleanText };
    },
    [composerLinkedKanbanPanels, selectedComposerKanbanPanelId],
  );

  const mergeSelectedAgentOption = useCallback(
    (options?: MessageSendOptions): MessageSendOptions | undefined => {
      if (activeEngine === "opencode") {
        return options;
      }
      const selectedAgentForSend =
        selectedAgentRef?.current ?? selectedAgent ?? null;
      const merged: MessageSendOptions = {
        ...(options ?? {}),
        selectedAgent: selectedAgentForSend
          ? {
              id: selectedAgentForSend.id,
              name: selectedAgentForSend.name,
              prompt: selectedAgentForSend.prompt ?? null,
              icon: selectedAgentForSend.icon ?? null,
            }
          : null,
      };
      return merged;
    },
    [activeEngine, selectedAgent, selectedAgentRef],
  );

  const handleComposerSendWithKanban = useCallback(
    async (
      text: string,
      images: string[],
      options?: MessageSendOptions,
    ) => {
      const trimmedOriginalText = text.trim();
      const { panelId, cleanText } = resolveComposerKanbanPanel(trimmedOriginalText);
      const textForSending = cleanText;

      // HomeChat send: no active workspace yet. Select or create one, then
      // create a thread and jump to normal chat view before sending.
      if (!activeWorkspaceId && !isPullRequestComposer) {
        let workspace: WorkspaceInfo | null = null;
        if (isWebServiceRuntime()) {
          workspace =
            workspaces.find((entry) => isDefaultWorkspacePath(entry.path)) ??
            workspaces.find((entry) => entry.kind === "main") ??
            workspaces[0] ??
            null;

          if (!workspace) {
            try {
              const resolvedHome = normalizePath(await homeDir());
              if (!resolvedHome) {
                throw new Error("Unable to resolve default workspace path.");
              }
              const preferredPaths = [
                `${resolvedHome}/.ccgui/workspace`,
                `${resolvedHome}/.mossx/workspace`,
                `${resolvedHome}/.codemoss/workspace`,
              ];

              let createdWorkspacePath: string | null = null;
              let lastError: unknown = null;
              for (const candidatePath of preferredPaths) {
                try {
                  await ensureWorkspacePathDir(candidatePath);
                  createdWorkspacePath = candidatePath;
                  break;
                } catch (error) {
                  lastError = error;
                }
              }
              if (!createdWorkspacePath) {
                throw lastError ?? new Error("Failed to create default workspace path.");
              }
              const normalizedDefaultPath = normalizePath(createdWorkspacePath);
              workspace = workspaces.find(
                (entry) => normalizePath(entry.path) === normalizedDefaultPath,
              ) ?? null;
              if (!workspace) {
                workspace = await addWorkspaceFromPath(createdWorkspacePath);
              }
            } catch (error) {
              alertError(error);
              return;
            }
          }
        } else {
          let defaultWorkspacePath: string;
          try {
            const resolvedHome = normalizePath(await homeDir());
            defaultWorkspacePath = `${resolvedHome}/.ccgui/workspace`;
            await ensureWorkspacePathDir(defaultWorkspacePath);
          } catch (error) {
            alertError(error);
            return;
          }
          const normalizedDefaultPath = normalizePath(defaultWorkspacePath);
          workspace = workspaces.find(
            (entry) => normalizePath(entry.path) === normalizedDefaultPath,
          ) ?? null;
          if (!workspace) {
            try {
              workspace = await addWorkspaceFromPath(defaultWorkspacePath);
            } catch (error) {
              alertError(error);
              return;
            }
          }
        }

        if (!workspace) {
          return;
        }
        exitDiffView();
        resetPullRequestSelection();
        setWorkspaceHomeWorkspaceId(null);
        setAppMode("chat");
        setCenterMode("chat");
        selectWorkspace(workspace.id);
        if (!workspace.connected) {
          await connectWorkspace(workspace);
        }
        const threadId = await startThreadForWorkspace(workspace.id, {
          engine: activeEngine,
          activate: true,
        });
        if (!threadId) {
          return;
        }
        setActiveThreadId(threadId, workspace.id);
        const fallbackText =
          textForSending.length > 0 ? textForSending : trimmedOriginalText;
        if (fallbackText.length > 0 || images.length > 0) {
          await sendUserMessageToThread(
            workspace,
            threadId,
            fallbackText,
            images,
            mergeSelectedAgentOption(options),
          );
        }
        return;
      }

      if (!panelId || !activeWorkspaceId || isPullRequestComposer) {
        const fallbackText =
          textForSending.length > 0 ? textForSending : trimmedOriginalText;
        await handleComposerSend(
          fallbackText,
          images,
          mergeSelectedAgentOption(options),
        );
        return;
      }

      const workspace = workspacesById.get(activeWorkspaceId);
      if (!workspace) {
        await handleComposerSend(
          textForSending.length > 0 ? textForSending : trimmedOriginalText,
          images,
          mergeSelectedAgentOption(options),
        );
        return;
      }

      // &@ 看板消息必须在新会话里执行，不能污染当前会话窗口
      if (!workspace.connected) {
        await connectWorkspace(workspace);
      }
      const engine = (activeEngine === "codex" ? "codex" : "claude") as
        | "codex"
        | "claude";
      const activeThreadEngine =
        activeThreadId && activeWorkspaceId
          ? (
              threadsByWorkspace[activeWorkspaceId]?.find(
                (thread) => thread.id === activeThreadId,
              )?.engineSource ?? null
            )
          : null;
      const isActiveThreadInWorkspace = Boolean(
        activeWorkspaceId &&
          activeThreadId &&
          threadsByWorkspace[activeWorkspaceId]?.some(
            (thread) => thread.id === activeThreadId,
          ),
      );
      const threadCreationStrategy = resolveKanbanThreadCreationStrategy({
        mode: composerKanbanContextMode,
        engine,
        activeThreadId,
        activeThreadEngine,
        activeWorkspaceId,
        targetWorkspaceId: workspace.id,
        isActiveThreadInWorkspace,
      });
      const canInheritViaFork = threadCreationStrategy === "inherit";
      const threadId =
        canInheritViaFork && activeThreadId
          ? await forkThreadForWorkspace(activeWorkspaceId, activeThreadId, {
              activate: false,
            })
          : await startThreadForWorkspace(activeWorkspaceId, {
              engine,
              activate: false,
            });
      const resolvedThreadId =
        threadId ??
        (await startThreadForWorkspace(activeWorkspaceId, {
          engine,
          activate: false,
        }));
      if (!resolvedThreadId) {
        return;
      }
      if (canInheritViaFork && !threadId) {
        addDebugEntry({
          id: `${Date.now()}-kanban-linked-fork-fallback`,
          timestamp: Date.now(),
          source: "client",
          label: "kanban/linked fork fallback",
          payload: {
            workspaceId: activeWorkspaceId,
            reason: "fork-unavailable",
          },
        });
      }

      if (textForSending.length > 0 || images.length > 0) {
        await sendUserMessageToThread(
          workspace,
          resolvedThreadId,
          textForSending,
          images,
          mergeSelectedAgentOption(options),
        );
      }

      const taskDescription = textForSending.length > 0 ? textForSending : trimmedOriginalText;
      const taskFallbackTitle =
        composerLinkedKanbanPanels.find((panel) => panel.id === panelId)?.name ||
        "Kanban Task";
      const taskTitle = deriveKanbanTaskTitle(taskDescription, taskFallbackTitle);
      const createdTask = kanbanCreateTask({
        workspaceId: workspace.path,
        panelId,
        title: taskTitle,
        description: taskDescription,
        engineType: engine,
        modelId: effectiveSelectedModelId,
        branchName: "main",
        images,
        autoStart: true,
      });

      kanbanUpdateTask(createdTask.id, {
        threadId: resolvedThreadId,
        status: "inprogress",
      });
    },
    [
      resolveComposerKanbanPanel,
      handleComposerSend,
      mergeSelectedAgentOption,
      activeWorkspaceId,
      normalizePath,
      addWorkspaceFromPath,
      alertError,
      workspaces,
      workspacesById,
      exitDiffView,
      resetPullRequestSelection,
      selectWorkspace,
      setAppMode,
      setActiveThreadId,
      setCenterMode,
      setWorkspaceHomeWorkspaceId,
      connectWorkspace,
      startThreadForWorkspace,
      forkThreadForWorkspace,
      sendUserMessageToThread,
      isPullRequestComposer,
      activeEngine,
      activeThreadId,
      threadsByWorkspace,
      addDebugEntry,
      composerKanbanContextMode,
      effectiveSelectedModelId,
      composerLinkedKanbanPanels,
      kanbanCreateTask,
      kanbanUpdateTask,
    ],
  );

  const handleComposerSendWithEditorFallback = useCallback(
    async (
      text: string,
      images: string[],
      options?: MessageSendOptions,
    ) => {
      await handleComposerSendWithKanban(text, images, options);
      if (!isCompact && centerMode === "editor") {
        setCenterMode("chat");
      }
    },
    [centerMode, handleComposerSendWithKanban, isCompact, setCenterMode],
  );

  const handleComposerQueueWithEditorFallback = useCallback(
    async (
      text: string,
      images: string[],
      options?: MessageSendOptions,
    ) => {
      await handleComposerQueue(text, images, mergeSelectedAgentOption(options));
      if (!isCompact && centerMode === "editor") {
        setCenterMode("chat");
      }
    },
    [centerMode, handleComposerQueue, isCompact, mergeSelectedAgentOption, setCenterMode],
  );

  const handleRewindFromMessage = useCallback(
    async (
      messageId: string,
      options?: { mode?: "messages-and-files" | "messages-only" | "files-only" },
    ) => {
      const normalizedMessageId = messageId.trim();
      if (!activeWorkspaceId || !activeThreadId || !normalizedMessageId) {
        throw new Error(t("rewind.notAvailable"));
      }
      if (!isRewindSupportedThreadId(activeThreadId)) {
        throw new Error(t("rewind.notAvailable"));
      }
      const rewindFromMessage =
        forkSessionFromMessageForWorkspace ??
        forkClaudeSessionFromMessageForWorkspace;
      const forkedThreadId = await rewindFromMessage(
        activeWorkspaceId,
        activeThreadId,
        normalizedMessageId,
        {
          activate: true,
          mode: options?.mode,
        },
      );
      if (!forkedThreadId) {
        throw new Error(t("rewind.failed"));
      }
    },
    [
      activeThreadId,
      activeWorkspaceId,
      forkSessionFromMessageForWorkspace,
      forkClaudeSessionFromMessageForWorkspace,
      t,
    ],
  );

  const handleSelectWorkspaceInstance = useCallback(
    (workspaceId: string, threadId: string) => {
      exitDiffView();
      resetPullRequestSelection();
      setHomeOpen(false);
      setWorkspaceHomeWorkspaceId(null);
      setAppMode("chat");
      setActiveTab("codex");
      collapseRightPanel();
      selectWorkspace(workspaceId);
      setActiveThreadId(threadId, workspaceId);
      const threads = threadsByWorkspace[workspaceId] ?? [];
      const thread = threads.find((entry) => entry.id === threadId);
      if (thread?.engineSource) {
        setActiveEngine(thread.engineSource);
      }
    },
    [
      exitDiffView,
      collapseRightPanel,
      resetPullRequestSelection,
      setActiveTab,
      setAppMode,
      setHomeOpen,
      setWorkspaceHomeWorkspaceId,
      selectWorkspace,
      setActiveEngine,
      setActiveThreadId,
      threadsByWorkspace,
    ],
  );

  const handleStartWorkspaceConversation = useCallback(
    async (engine: EngineType = "claude") => {
      if (!activeWorkspace) {
        return;
      }
      try {
        setHomeOpen(false);
        setWorkspaceHomeWorkspaceId(null);
        if (!activeWorkspace.connected) {
          await connectWorkspace(activeWorkspace);
        }
        await setActiveEngine(engine);
        const threadId = await startThreadForWorkspace(activeWorkspace.id, {
          activate: true,
          engine,
        });
        if (!threadId) {
          return;
        }
        setActiveThreadId(threadId, activeWorkspace.id);
        collapseRightPanel();
        if (isCompact) {
          setActiveTab("codex");
        }
      } catch (error) {
        alertError(error);
      }
    },
    [
      activeWorkspace,
      alertError,
      collapseRightPanel,
      connectWorkspace,
      isCompact,
      setHomeOpen,
      setActiveTab,
      setActiveEngine,
      setActiveThreadId,
      setWorkspaceHomeWorkspaceId,
      startThreadForWorkspace,
    ],
  );

  const handleStartSharedConversation = useCallback(
    async (engineOrWorkspace: EngineType | WorkspaceInfo = "claude") => {
      const targetWorkspace =
        typeof engineOrWorkspace === "object" && engineOrWorkspace !== null
          ? engineOrWorkspace
          : activeWorkspace;
      if (!targetWorkspace) {
        return;
      }
      const engine: EngineType =
        typeof engineOrWorkspace === "string"
          ? engineOrWorkspace
          : activeEngine;
      const sharedEngine = normalizeSharedSessionEngine(engine);
      try {
        await runWithLoadingProgress(
          { showLoadingProgressDialog, hideLoadingProgressDialog },
          {
            title: t("workspace.loadingProgressCreateSessionTitle"),
            message: t("workspace.loadingProgressCreateSessionMessage", {
              engine: t("sidebar.newSharedSession"),
              workspace: targetWorkspace.name.trim() || targetWorkspace.path,
            }),
          },
          async () => {
            setWorkspaceHomeWorkspaceId(null);
            selectWorkspace(targetWorkspace.id);
            if (!targetWorkspace.connected) {
              await connectWorkspace(targetWorkspace);
            }
            await setActiveEngine(sharedEngine);
            const threadId = await startSharedSessionForWorkspace(targetWorkspace.id, {
              activate: true,
              initialEngine: sharedEngine,
            });
            if (!threadId) {
              return;
            }
            updateSharedSessionEngineSelection(targetWorkspace.id, threadId, sharedEngine);
            setActiveThreadId(threadId, targetWorkspace.id);
            collapseRightPanel();
            if (isCompact) {
              setActiveTab("codex");
            }
          },
        );
      } catch (error) {
        alertError(error);
      }
    },
    [
      activeEngine,
      activeWorkspace,
      alertError,
      collapseRightPanel,
      connectWorkspace,
      hideLoadingProgressDialog,
      isCompact,
      selectWorkspace,
      setActiveEngine,
      setActiveThreadId,
      setActiveTab,
      setWorkspaceHomeWorkspaceId,
      startSharedSessionForWorkspace,
      showLoadingProgressDialog,
      t,
      updateSharedSessionEngineSelection,
    ],
  );

  const handleContinueLatestConversation = useCallback(() => {
    const latest = recentThreads[0];
    if (!latest) {
      return;
    }
    handleSelectWorkspaceInstance(latest.workspaceId, latest.threadId);
  }, [handleSelectWorkspaceInstance, recentThreads]);

  const handleStartGuidedConversation = useCallback(
    async (prompt: string, engine: EngineType = "claude") => {
      const normalizedPrompt = prompt.trim();
      if (!activeWorkspace || !normalizedPrompt) {
        return;
      }
      try {
        setHomeOpen(false);
        setWorkspaceHomeWorkspaceId(null);
        if (!activeWorkspace.connected) {
          await connectWorkspace(activeWorkspace);
        }
        await setActiveEngine(engine);
        const threadId = await startThreadForWorkspace(activeWorkspace.id, {
          activate: true,
          engine,
        });
        if (!threadId) {
          return;
        }
        setActiveThreadId(threadId, activeWorkspace.id);
        collapseRightPanel();
        await sendUserMessageToThread(activeWorkspace, threadId, normalizedPrompt);
        if (isCompact) {
          setActiveTab("codex");
        }
      } catch (error) {
        alertError(error);
      }
    },
    [
      activeWorkspace,
      alertError,
      collapseRightPanel,
      connectWorkspace,
      isCompact,
      sendUserMessageToThread,
      setHomeOpen,
      setActiveTab,
      setActiveEngine,
      setActiveThreadId,
      setWorkspaceHomeWorkspaceId,
      startThreadForWorkspace,
    ],
  );

  const handleRevealActiveWorkspace = useCallback(async () => {
    if (!activeWorkspace?.path) {
      return;
    }
    try {
      await revealItemInDir(activeWorkspace.path);
    } catch (error) {
      alertError(error);
    }
  }, [activeWorkspace?.path, alertError]);

  const handleDeleteWorkspaceConversations = useCallback(
    async (threadIds: string[]) => {
      if (!activeWorkspace || threadIds.length === 0) {
        return {
          succeededThreadIds: [],
          failed: [],
        } satisfies WorkspaceHomeDeleteResult;
      }
      const succeededThreadIds: string[] = [];
      const failed: WorkspaceHomeDeleteResult["failed"] = [];
      for (const threadId of threadIds) {
        const result = await removeThread(activeWorkspace.id, threadId);
        if (result.success) {
          succeededThreadIds.push(threadId);
          clearDraftForThread(threadId);
          removeImagesForThread(threadId);
          continue;
        }
        failed.push({
          threadId,
          code: result.code ?? "UNKNOWN",
          message: result.message ?? t("workspace.deleteConversationFailed"),
        });
      }
      if (failed.length > 0) {
        const failedReasonLine = failed
          .slice(0, 3)
          .map((entry) => `- ${entry.threadId}: ${t(`workspace.deleteErrorCode.${entry.code}`)}`)
          .join("\n");
        alertError(
          `${t("workspace.deleteConversationsPartial", {
            succeeded: succeededThreadIds.length,
            failed: failed.length,
          })}${failedReasonLine ? `\n${failedReasonLine}` : ""}`,
        );
      }
      return {
        succeededThreadIds,
        failed,
      } satisfies WorkspaceHomeDeleteResult;
    },
    [activeWorkspace, alertError, clearDraftForThread, removeImagesForThread, removeThread, t],
  );
  const handleDeleteWorkspaceConversationsInSettings = useCallback(
    async (workspaceId: string, threadIds: string[]) => {
      if (!workspaceId || threadIds.length === 0) {
        return {
          succeededThreadIds: [],
          failed: [],
        };
      }
      const deleteResults = removeThreads
        ? await removeThreads(workspaceId, threadIds)
        : await Promise.all(threadIds.map((threadId) => removeThread(workspaceId, threadId)));
      const succeededThreadIds: string[] = [];
      const failed: Array<{ threadId: string; code: string; message: string }> = [];
      for (const result of deleteResults) {
        if (result.success) {
          succeededThreadIds.push(result.threadId);
          clearDraftForThread(result.threadId);
          removeImagesForThread(result.threadId);
          continue;
        }
        failed.push({
          threadId: result.threadId,
          code: result.code ?? "UNKNOWN",
          message: result.message ?? t("workspace.deleteConversationFailed"),
        });
      }
      return {
        succeededThreadIds,
        failed,
      };
    },
    [clearDraftForThread, removeImagesForThread, removeThread, removeThreads, t],
  );

  const kanbanTasksRef = useRef(kanbanTasks);
  const schedulerStartedAtRef = useRef(Date.now());
  const kanbanExecutionLocksRef = useRef<
    Record<string, { token: string; source: KanbanTaskExecutionSource; acquiredAt: number }>
  >({});

  useEffect(() => {
    kanbanTasksRef.current = kanbanTasks;
  }, [kanbanTasks]);

  const updateTaskExecution = useCallback(
    (taskId: string, changes: Record<string, unknown>) => {
      const current = kanbanTasksRef.current.find((task) => task.id === taskId);
      if (!current) {
        return;
      }
      kanbanUpdateTask(taskId, {
        execution: {
          ...(current.execution ?? {}),
          ...changes,
        },
      });
    },
    [kanbanUpdateTask],
  );

  const setTaskChainBlockedReason = useCallback(
    (taskId: string, blockedReason: string | null) => {
      const current = kanbanTasksRef.current.find((task) => task.id === taskId);
      if (!current?.chain) {
        return;
      }
      kanbanUpdateTask(taskId, {
        chain: {
          ...current.chain,
          blockedReason,
        },
      });
    },
    [kanbanUpdateTask],
  );

  const launchKanbanTaskExecution = useCallback(
    async (params: {
      taskId: string;
      source: KanbanTaskExecutionSource;
      activate?: boolean;
      injectedPrefix?: string;
      forceNewThread?: boolean;
    }): Promise<{ ok: true; threadId: string } | { ok: false; reason: string }> => {
      const task = kanbanTasksRef.current.find((entry) => entry.id === params.taskId);
      if (!task) {
        return { ok: false, reason: "task_not_found" };
      }
      let launchedSuccessfully = false;
      if (params.source !== "chained" && task.chain?.previousTaskId) {
        setTaskChainBlockedReason(task.id, "chain_requires_head_trigger");
        updateTaskExecution(task.id, {
          lastSource: params.source,
          blockedReason: "chain_requires_head_trigger",
        });
        return { ok: false, reason: "chain_requires_head_trigger" };
      }
      if (params.source === "chained" && task.chain?.previousTaskId) {
        setTaskChainBlockedReason(task.id, null);
      }
      const existingLock = kanbanExecutionLocksRef.current[task.id];
      if (existingLock) {
        updateTaskExecution(task.id, {
          lastSource: params.source,
          blockedReason: "non_reentrant_trigger_blocked",
        });
        return { ok: false, reason: "non_reentrant_trigger_blocked" };
      }

      const lock = {
        token: `${params.source}-${Date.now()}`,
        source: params.source,
        acquiredAt: Date.now(),
      } as const;
      kanbanExecutionLocksRef.current[task.id] = lock;
      updateTaskExecution(task.id, {
        lastSource: params.source,
        lock,
        blockedReason: null,
      });

      try {
        const workspace = workspacesByPath.get(task.workspaceId);
        if (!workspace) {
          throw new Error("workspace_not_found");
        }

        await connectWorkspace(workspace);
        const engine = (task.engineType ?? activeEngine) as "claude" | "codex";
        const workspaceThreads = threadsByWorkspace[workspace.id] ?? [];
        const { outboundModel } = await syncKanbanExecutionEngineAndModel({
          activate: params.activate,
          engine,
          modelId: task.modelId,
          setActiveEngine,
          setSelectedModelId,
          setEngineSelectedModelIdByType,
        });

        const shouldForceNewThread = Boolean(params.forceNewThread);
        const canonicalTaskThreadId =
          shouldForceNewThread
            ? null
            : resolveTaskThreadId(task.threadId, resolveCanonicalThreadId);
        const canonicalTaskThreadEngine =
          canonicalTaskThreadId
            ? (
                workspaceThreads.find((entry) => entry.id === canonicalTaskThreadId)
                  ?.engineSource ?? null
              )
            : null;
        const canReuseExistingThread = isKanbanThreadCompatibleWithEngine({
          engine,
          threadId: canonicalTaskThreadId,
          threadEngine: canonicalTaskThreadEngine,
        });
        let threadId = canReuseExistingThread ? canonicalTaskThreadId : null;
        if (shouldForceNewThread && task.threadId) {
          // Keep previous run in review state before switching task to the new execution thread.
          kanbanUpdateTask(task.id, { status: "testing" });
        }
        if (
          canonicalTaskThreadId &&
          canonicalTaskThreadId !== task.threadId &&
          canReuseExistingThread
        ) {
          kanbanUpdateTask(task.id, { threadId: canonicalTaskThreadId });
        }
        if (!threadId) {
          threadId = await startThreadForWorkspace(workspace.id, {
            engine,
            activate: params.activate ?? false,
          });
          if (!threadId) {
            throw new Error("thread_create_failed");
          }
          kanbanUpdateTask(task.id, { threadId });
        }

        const executionStartedAt = Date.now();
        const baseMessage = task.description?.trim() || task.title;
        const firstMessage = params.injectedPrefix
          ? `${params.injectedPrefix}\n\n${baseMessage}`
          : baseMessage;
        if (firstMessage) {
          await sendUserMessageToThread(workspace, threadId, firstMessage, task.images ?? [], {
            ...(outboundModel ? { model: outboundModel } : {}),
          });
        }

        kanbanUpdateTask(task.id, { status: "inprogress" });
        updateTaskExecution(task.id, {
          lastSource: params.source,
          lock: null,
          blockedReason: null,
          startedAt: executionStartedAt,
          finishedAt: null,
        });
        launchedSuccessfully = true;
        return { ok: true, threadId };
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        updateTaskExecution(task.id, {
          lastSource: params.source,
          lock: null,
          blockedReason: reason,
        });
        return { ok: false, reason };
      } finally {
        if (!launchedSuccessfully) {
          delete kanbanExecutionLocksRef.current[task.id];
        }
      }
    },
    [
      workspacesByPath,
      connectWorkspace,
      activeEngine,
      threadsByWorkspace,
      setActiveEngine,
      setSelectedModelId,
      setEngineSelectedModelIdByType,
      startThreadForWorkspace,
      kanbanUpdateTask,
      sendUserMessageToThread,
      updateTaskExecution,
      setTaskChainBlockedReason,
      resolveCanonicalThreadId,
    ],
  );

  // --- Kanban conversation handlers ---
  const handleOpenTaskConversation = useCallback(
    async (task: KanbanTask) => {
      setSelectedKanbanTaskId(task.id);
      const workspace = workspacesByPath.get(task.workspaceId);
      if (!workspace) return;

      await connectWorkspace(workspace);
      selectWorkspace(workspace.id);

      const engine = (task.engineType ?? activeEngine) as "claude" | "codex";
      const workspaceThreads = threadsByWorkspace[workspace.id] ?? [];
      await setActiveEngine(engine);

      // Apply the model that was selected when the task was created
      if (task.modelId) {
        if (engine === "codex") {
          setSelectedModelId(task.modelId);
        } else {
          setEngineSelectedModelIdByType((prev) => ({
            ...prev,
            [engine]: task.modelId,
          }));
        }
      }

      if (task.threadId) {
        let resolvedThreadId =
          resolveTaskThreadId(task.threadId, resolveCanonicalThreadId) ?? task.threadId;
        const resolvedThreadEngine =
          workspaceThreads.find((entry) => entry.id === resolvedThreadId)?.engineSource ?? null;
        const canReuseExistingThread = isKanbanThreadCompatibleWithEngine({
          engine,
          threadId: resolvedThreadId,
          threadEngine: resolvedThreadEngine,
        });
        if (resolvedThreadId !== task.threadId) {
          kanbanUpdateTask(task.id, { threadId: resolvedThreadId });
        }

        if (!canReuseExistingThread) {
          resolvedThreadId = "";
        }

        const isPendingThread =
          resolvedThreadId.startsWith("claude-pending-") ||
          resolvedThreadId.startsWith("opencode-pending-");
        const hasThreadStatus = threadStatusById[resolvedThreadId] !== undefined;
        const existsInWorkspaceThreads = workspaceThreads.some(
          (entry) => entry.id === resolvedThreadId,
        );

        if (isPendingThread && !hasThreadStatus && !existsInWorkspaceThreads) {
          const occupiedThreadIds = new Set(
            kanbanTasks
              .filter((entry) => entry.id !== task.id && entry.threadId)
              .map((entry) =>
                resolveTaskThreadId(entry.threadId, resolveCanonicalThreadId),
              )
              .filter(
                (threadId): threadId is string =>
                  Boolean(
                    threadId &&
                      !threadId.startsWith("claude-pending-") &&
                      !threadId.startsWith("opencode-pending-"),
                  ),
              ),
          );
          const uniqueCandidate = resolvePendingSessionThreadCandidate({
            pendingThreadId: resolvedThreadId,
            workspaceThreadIds: workspaceThreads.map((entry) => entry.id),
            occupiedThreadIds,
          });
          if (uniqueCandidate) {
            resolvedThreadId = uniqueCandidate;
            kanbanUpdateTask(task.id, { threadId: resolvedThreadId });
          }
        }

        const canActivateExistingThread =
          threadStatusById[resolvedThreadId] !== undefined ||
          workspaceThreads.some((entry) => entry.id === resolvedThreadId) ||
          resolvedThreadId.startsWith("claude-pending-") ||
          resolvedThreadId.startsWith("opencode-pending-");
        if (canActivateExistingThread) {
          setActiveThreadId(resolvedThreadId, workspace.id);
          return;
        }
      }

      const threadId = await startThreadForWorkspace(workspace.id, { engine });
      if (threadId) {
        kanbanUpdateTask(task.id, { threadId });
        setActiveThreadId(threadId, workspace.id);
      }
    },
    [
      workspacesByPath,
      connectWorkspace,
      selectWorkspace,
      setActiveThreadId,
      startThreadForWorkspace,
      kanbanUpdateTask,
      activeEngine,
      setActiveEngine,
      setSelectedModelId,
      setEngineSelectedModelIdByType,
      threadStatusById,
      threadsByWorkspace,
      kanbanTasks,
      resolveCanonicalThreadId,
      setSelectedKanbanTaskId,
    ]
  );

  const handleCloseTaskConversation = useCallback(() => {
    setSelectedKanbanTaskId(null);
  }, [setSelectedKanbanTaskId]);

  const handleKanbanCreateTask = useCallback(
    (input: Parameters<typeof kanbanCreateTask>[0]) => {
      const task = kanbanCreateTask(input);
      if (input.autoStart) {
        const tryLaunch = (attempt: number) => {
          void launchKanbanTaskExecution({
            taskId: task.id,
            source: "autoStart",
            activate: false,
          }).then((result) => {
            if (result.ok) {
              return;
            }
            if (result.reason !== "task_not_found" || attempt >= 3) {
              return;
            }
            window.setTimeout(() => {
              tryLaunch(attempt + 1);
            }, (attempt + 1) * 40);
          });
        };
        tryLaunch(0);
      }
      return task;
    },
    [kanbanCreateTask, launchKanbanTaskExecution],
  );

  // Sync kanban task threadIds when pending IDs are renamed to session IDs.
  // Strategy:
  // 1) Prefer canonical alias resolution from useThreads (deterministic).
  // 2) Fallback to unique-candidate mapping only when there is exactly one safe target.
  // Never guess by taking the first candidate.
  useEffect(() => {
    for (const task of kanbanTasks) {
      if (!task.threadId) {
        continue;
      }
      const canonicalThreadId = resolveTaskThreadId(task.threadId, resolveCanonicalThreadId);
      if (canonicalThreadId && canonicalThreadId !== task.threadId) {
        kanbanUpdateTask(task.id, { threadId: canonicalThreadId });
        continue;
      }

      const taskThreadId = canonicalThreadId ?? task.threadId;
      const isPendingThread =
        taskThreadId.startsWith("claude-pending-") ||
        taskThreadId.startsWith("opencode-pending-");
      if (!isPendingThread) {
        continue;
      }
      if (threadStatusById[taskThreadId] !== undefined) {
        continue;
      }
      const wsId = workspacesByPath.get(task.workspaceId)?.id;
      const threads = wsId ? (threadsByWorkspace[wsId] ?? []) : [];
      if (threads.some((entry) => entry.id === taskThreadId)) {
        continue;
      }
      const otherTaskThreadIds = new Set(
        kanbanTasks
          .filter((entry) => entry.id !== task.id && entry.threadId)
          .map((entry) =>
            resolveTaskThreadId(entry.threadId, resolveCanonicalThreadId),
          )
          .filter(
            (threadId): threadId is string =>
              Boolean(
                threadId &&
                  !threadId.startsWith("claude-pending-") &&
                  !threadId.startsWith("opencode-pending-"),
              ),
          ),
      );
      const uniqueCandidate = resolvePendingSessionThreadCandidate({
        pendingThreadId: taskThreadId,
        workspaceThreadIds: threads.map((entry) => entry.id),
        occupiedThreadIds: otherTaskThreadIds,
      });
      if (uniqueCandidate) {
        kanbanUpdateTask(task.id, { threadId: uniqueCandidate });
      }
    }
  }, [
    kanbanTasks,
    threadStatusById,
    threadsByWorkspace,
    kanbanUpdateTask,
    workspacesByPath,
    resolveCanonicalThreadId,
  ]);

  useEffect(() => {
    if (appMode !== "kanban") {
      setSelectedKanbanTaskId(null);
    }
  }, [appMode, setSelectedKanbanTaskId]);

  // Sync activeWorkspaceId when kanban navigates to a workspace
  useEffect(() => {
    if (appMode === "kanban" && "workspaceId" in kanbanViewState) {
      const kanbanWsPath = kanbanViewState.workspaceId;
      const ws = kanbanWsPath ? workspacesByPath.get(kanbanWsPath) : null;
      if (ws && ws.id !== activeWorkspaceId) {
        setActiveWorkspaceId(ws.id);
      }
    }
  }, [appMode, kanbanViewState, activeWorkspaceId, setActiveWorkspaceId, workspacesByPath]);

  // Compute which kanban tasks are currently processing (AI responding)
  const taskProcessingMap = useMemo(() => {
    const map: Record<string, { isProcessing: boolean; startedAt: number | null }> = {};
    for (const task of kanbanTasks) {
      const taskThreadId = resolveTaskThreadId(task.threadId, resolveCanonicalThreadId);
      if (taskThreadId) {
        const status = threadStatusById[taskThreadId];
        map[task.id] = {
          isProcessing: status?.isProcessing ?? false,
          startedAt: status?.processingStartedAt ?? null,
        };
      }
    }
    return map;
  }, [kanbanTasks, threadStatusById, resolveCanonicalThreadId]);

  useEffect(() => {
    const runSchedulerTick = () => {
      const nowTs = Date.now();
      const activeTaskIds = new Set(kanbanTasksRef.current.map((entry) => entry.id));
      for (const taskId of Object.keys(kanbanExecutionLocksRef.current)) {
        if (activeTaskIds.has(taskId)) {
          continue;
        }
        delete kanbanExecutionLocksRef.current[taskId];
      }
      for (const task of kanbanTasksRef.current) {
        const runtimeLock = kanbanExecutionLocksRef.current[task.id];
        if (runtimeLock) {
          const hasPersistedExecutionLock = Boolean(task.execution?.lock);
          const isLockExpired = nowTs - runtimeLock.acquiredAt > KANBAN_EXECUTION_LOCK_STALE_MS;
          if (!hasPersistedExecutionLock || task.status !== "todo" || isLockExpired) {
            delete kanbanExecutionLocksRef.current[task.id];
            if (task.execution?.lock) {
              updateTaskExecution(task.id, { lock: null });
            }
          }
        }
        if (task.execution?.blockedReason === "scheduled_trigger_blocked") {
          updateTaskExecution(task.id, { blockedReason: null });
        }
        const schedule = task.schedule;
        if (!schedule || schedule.mode === "manual") {
          continue;
        }
        if (schedule.paused) {
          continue;
        }
        const taskThreadId = resolveTaskThreadId(task.threadId, resolveCanonicalThreadId);
        if (taskThreadId && task.threadId && taskThreadId !== task.threadId) {
          kanbanUpdateTask(task.id, { threadId: taskThreadId });
        }
        const isTaskProcessing = taskThreadId
          ? (threadStatusById[taskThreadId]?.isProcessing ?? false)
          : false;
        const shouldPromoteTestingToTodo =
          schedule.mode === "recurring" &&
          schedule.recurringExecutionMode !== "new_thread" &&
          task.status === "testing" &&
          !isTaskProcessing &&
          typeof schedule.nextRunAt === "number" &&
          schedule.nextRunAt <= nowTs;
        const normalizedStatus = shouldPromoteTestingToTodo ? "todo" : task.status;
        if (normalizedStatus !== task.status) {
          kanbanUpdateTask(task.id, { status: normalizedStatus });
        }
        if (normalizedStatus !== "todo") {
          continue;
        }

        const missedRunResult = applyMissedRunPolicy(
          task,
          schedulerStartedAtRef.current,
          nowTs,
        );
        let effectiveSchedule = schedule;
        if (missedRunResult) {
          effectiveSchedule = missedRunResult.schedule;
          kanbanUpdateTask(task.id, {
            schedule: missedRunResult.schedule,
          });
          updateTaskExecution(task.id, {
            lastSource: "scheduled",
            blockedReason: missedRunResult.blockedReason,
          });
          continue;
        }

        if (!isScheduleDue(effectiveSchedule, nowTs)) {
          continue;
        }

        if (
          effectiveSchedule.mode === "recurring" &&
          effectiveSchedule.recurringExecutionMode === "new_thread"
        ) {
          const recurringSeriesId =
            typeof effectiveSchedule.seriesId === "string" && effectiveSchedule.seriesId.trim().length > 0
              ? effectiveSchedule.seriesId.trim()
              : task.id;
          const hasSiblingExecuting = kanbanTasksRef.current.some((entry) => {
            if (entry.id === task.id) {
              return false;
            }
            const siblingSchedule = entry.schedule;
            if (
              !siblingSchedule ||
              siblingSchedule.mode !== "recurring" ||
              siblingSchedule.recurringExecutionMode !== "new_thread"
            ) {
              return false;
            }
            const siblingSeriesId =
              typeof siblingSchedule.seriesId === "string" && siblingSchedule.seriesId.trim().length > 0
                ? siblingSchedule.seriesId.trim()
                : entry.id;
            if (siblingSeriesId !== recurringSeriesId) {
              return false;
            }
            return (
              entry.status === "inprogress" ||
              Boolean(kanbanExecutionLocksRef.current[entry.id])
            );
          });
          if (hasSiblingExecuting) {
            updateTaskExecution(task.id, {
              lastSource: "scheduled",
              blockedReason: "scheduled_trigger_blocked",
            });
            continue;
          }
        }

        if (effectiveSchedule.mode === "recurring" && hasReachedRecurringRoundLimit(effectiveSchedule)) {
          kanbanUpdateTask(task.id, {
            status: "done",
            schedule: {
              ...effectiveSchedule,
              nextRunAt: null,
            },
          });
          updateTaskExecution(task.id, {
            lastSource: "scheduled",
            blockedReason: "max_rounds_reached_auto_completed",
          });
          continue;
        }

        if (isTaskProcessing || Boolean(kanbanExecutionLocksRef.current[task.id])) {
          // Running/locked is an expected transient condition for due recurring tasks.
          // Do not expose it as user-facing "blocked" state.
          updateTaskExecution(task.id, { lastSource: "scheduled", blockedReason: null });
          continue;
        }

        if (effectiveSchedule.mode === "once") {
          const triggeredSchedule = markScheduleTriggered(
            effectiveSchedule,
            "scheduled",
            nowTs,
          );
          kanbanUpdateTask(task.id, { schedule: triggeredSchedule });
        } else {
          kanbanUpdateTask(task.id, {
            schedule: {
              ...effectiveSchedule,
              overdue: false,
              lastTriggeredAt: nowTs,
              lastTriggerSource: "scheduled",
            },
          });
        }
        updateTaskExecution(task.id, {
          lastSource: "scheduled",
          blockedReason: null,
        });
        const forceNewThread =
          effectiveSchedule.mode === "recurring" &&
          effectiveSchedule.recurringExecutionMode === "new_thread";
        const injectedPrefix =
          forceNewThread &&
          effectiveSchedule.newThreadResultMode !== "none" &&
          task.lastResultSnapshot
            ? buildChainedPromptPrefix(task.lastResultSnapshot)
            : undefined;
        void launchKanbanTaskExecution({
          taskId: task.id,
          source: "scheduled",
          activate: false,
          forceNewThread,
          injectedPrefix,
        });
      }
    };

    runSchedulerTick();
    const timer = window.setInterval(runSchedulerTick, KANBAN_SCHEDULER_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [
    threadStatusById,
    kanbanUpdateTask,
    updateTaskExecution,
    launchKanbanTaskExecution,
    resolveCanonicalThreadId,
    kanbanCreateTask,
  ]);

  // Track previous processing state to detect transitions
  const prevProcessingMapRef = useRef<Record<string, boolean>>({});
  const prevTaskStatusMapRef = useRef<Record<string, KanbanTaskStatus>>({});

  useEffect(() => {
    const previousStatusMap = prevTaskStatusMapRef.current;
    const nextStatusMap: Record<string, KanbanTaskStatus> = {};
    for (const task of kanbanTasks) {
      nextStatusMap[task.id] = task.status;
      const previousStatus = previousStatusMap[task.id];
      if (previousStatus === task.status) {
        continue;
      }
      if (task.status === "inprogress") {
        const hasStartedAt = typeof task.execution?.startedAt === "number";
        const hasFinishedAt = typeof task.execution?.finishedAt === "number";
        if (!hasStartedAt || hasFinishedAt) {
          updateTaskExecution(task.id, {
            startedAt: Date.now(),
            finishedAt: null,
          });
        }
        continue;
      }
      if (previousStatus === "inprogress") {
        updateTaskExecution(task.id, {
          finishedAt: Date.now(),
        });
      }
    }
    prevTaskStatusMapRef.current = nextStatusMap;
  }, [kanbanTasks, updateTaskExecution]);

  useEffect(() => {
    const prev = prevProcessingMapRef.current;
    for (const task of kanbanTasks) {
      const wasProcessing = prev[task.id] ?? false;
      const nowProcessing = taskProcessingMap[task.id]?.isProcessing ?? false;
      if (wasProcessing === nowProcessing) continue;

      // AI finished processing (true → false): auto-move inprogress → testing
      if (wasProcessing && !nowProcessing && task.status === "inprogress") {
        const completedAt = Date.now();
        updateTaskExecution(task.id, {
          finishedAt: completedAt,
        });
        const nextStatus = resolvePostProcessingStatus(task);
        if (task.schedule?.mode === "recurring") {
          const completionSource = task.execution?.lastSource ?? "scheduled";
          const recurringSignature = [
            task.workspaceId,
            task.panelId,
            task.title,
            String(task.schedule.interval ?? 1),
            task.schedule.unit ?? "days",
            task.schedule.newThreadResultMode ?? "pass",
          ].join("|");
          const recurringSiblings = kanbanTasksRef.current.filter((entry) => {
            const schedule = entry.schedule;
            if (
              !schedule ||
              schedule.mode !== "recurring" ||
              schedule.recurringExecutionMode !== "new_thread"
            ) {
              return false;
            }
            const signature = [
              entry.workspaceId,
              entry.panelId,
              entry.title,
              String(schedule.interval ?? 1),
              schedule.unit ?? "days",
              schedule.newThreadResultMode ?? "pass",
            ].join("|");
            return signature === recurringSignature;
          });
          const siblingSeriesIds = Array.from(new Set(
            recurringSiblings
              .map((entry) => entry.schedule?.seriesId)
              .filter((seriesId): seriesId is string =>
                typeof seriesId === "string" && seriesId.trim().length > 0),
          ));
          const recurringSeriesId =
            task.schedule.recurringExecutionMode === "new_thread"
              ? (
                task.schedule.seriesId ??
                (siblingSeriesIds.length === 1 ? siblingSeriesIds[0] : null) ??
                task.id
              )
              : task.schedule.seriesId ?? null;
          if (task.schedule.recurringExecutionMode === "new_thread" && siblingSeriesIds.length <= 1) {
            for (const sibling of recurringSiblings) {
              if (!sibling.schedule || sibling.schedule.seriesId === recurringSeriesId) {
                continue;
              }
              kanbanUpdateTask(sibling.id, {
                schedule: {
                  ...sibling.schedule,
                  seriesId: recurringSeriesId,
                },
              });
            }
          }
          const completedSchedule = markRecurringScheduleCompleted(
            {
              ...task.schedule,
              seriesId: recurringSeriesId,
            },
            completionSource,
            completedAt,
          );
          const reachedRoundLimit = hasReachedRecurringRoundLimit(completedSchedule);
          if (task.schedule.recurringExecutionMode === "new_thread") {
            kanbanUpdateTask(task.id, {
              status: reachedRoundLimit ? "done" : nextStatus,
              // Freeze this completed run card in review; next cycle will use a new cloned task.
              schedule: {
                ...completedSchedule,
                nextRunAt: null,
              },
            });
            if (!reachedRoundLimit) {
              const hasPendingSeriesTask = recurringSiblings.some((sibling) => {
                if (sibling.id === task.id) {
                  return false;
                }
                const siblingSchedule = sibling.schedule;
                if (
                  !siblingSchedule ||
                  siblingSchedule.mode !== "recurring" ||
                  siblingSchedule.recurringExecutionMode !== "new_thread"
                ) {
                  return false;
                }
                const siblingSeriesId =
                  typeof siblingSchedule.seriesId === "string" && siblingSchedule.seriesId.trim().length > 0
                    ? siblingSchedule.seriesId.trim()
                    : sibling.id;
                if (siblingSeriesId !== recurringSeriesId) {
                  return false;
                }
                return sibling.status === "todo" || sibling.status === "inprogress";
              });
              if (!hasPendingSeriesTask) {
                kanbanCreateTask({
                  workspaceId: task.workspaceId,
                  panelId: task.panelId,
                  title: task.title,
                  description: task.description,
                  engineType: task.engineType,
                  modelId: task.modelId,
                  branchName: task.branchName,
                  images: task.images ?? [],
                  autoStart: false,
                  schedule: completedSchedule,
                  chain: task.chain
                    ? {
                        ...task.chain,
                        blockedReason: null,
                      }
                    : undefined,
                });
              }
            } else {
              updateTaskExecution(task.id, {
                lastSource: completionSource,
                blockedReason: "max_rounds_reached_auto_completed",
              });
            }
          } else {
            kanbanUpdateTask(task.id, {
              status: reachedRoundLimit ? "done" : nextStatus,
              schedule: reachedRoundLimit
                ? {
                    ...completedSchedule,
                    nextRunAt: null,
                  }
                : completedSchedule,
            });
            if (reachedRoundLimit) {
              updateTaskExecution(task.id, {
                lastSource: completionSource,
                blockedReason: "max_rounds_reached_auto_completed",
              });
            }
          }
        } else {
          kanbanUpdateTask(task.id, { status: nextStatus });
        }

        const snapshot = extractKanbanResultSnapshot(
          resolveTaskThreadId(task.threadId, resolveCanonicalThreadId),
          (() => {
            const taskThreadId = resolveTaskThreadId(task.threadId, resolveCanonicalThreadId);
            return taskThreadId ? threadItemsByThread[taskThreadId] : undefined;
          })(),
        );
        if (snapshot) {
          const taskThreadId = resolveTaskThreadId(task.threadId, resolveCanonicalThreadId);
          kanbanUpdateTask(task.id, {
            ...(taskThreadId && task.threadId && taskThreadId !== task.threadId
              ? { threadId: taskThreadId }
              : null),
            lastResultSnapshot: snapshot,
          });
        }

        const downstreamTask = findTaskDownstream(kanbanTasksRef.current, task.id);
        if (downstreamTask) {
          if (!snapshot) {
            setTaskChainBlockedReason(downstreamTask.id, "missing_upstream_snapshot");
            updateTaskExecution(downstreamTask.id, {
              lastSource: "chained",
              blockedReason: "missing_upstream_snapshot",
            });
          } else if (downstreamTask.status !== "todo") {
            setTaskChainBlockedReason(downstreamTask.id, "downstream_not_todo");
            updateTaskExecution(downstreamTask.id, {
              lastSource: "chained",
              blockedReason: "downstream_not_todo",
            });
          } else if (downstreamTask.schedule?.mode && downstreamTask.schedule.mode !== "manual") {
            setTaskChainBlockedReason(downstreamTask.id, "downstream_has_schedule");
            updateTaskExecution(downstreamTask.id, {
              lastSource: "chained",
              blockedReason: "downstream_has_schedule",
            });
          } else {
            setTaskChainBlockedReason(downstreamTask.id, null);
            updateTaskExecution(downstreamTask.id, {
              lastSource: "chained",
              blockedReason: null,
            });
            void launchKanbanTaskExecution({
              taskId: downstreamTask.id,
              source: "chained",
              activate: false,
              injectedPrefix: buildChainedPromptPrefix(snapshot),
            }).then((result) => {
              if (!result.ok) {
                setTaskChainBlockedReason(downstreamTask.id, result.reason);
                updateTaskExecution(downstreamTask.id, {
                  lastSource: "chained",
                  blockedReason: result.reason,
                });
              }
            });
          }
        }
      }
      // User sent follow-up (false → true): auto-move testing → inprogress
      if (!wasProcessing && nowProcessing && task.status === "testing") {
        kanbanUpdateTask(task.id, { status: "inprogress" });
        updateTaskExecution(task.id, {
          startedAt: taskProcessingMap[task.id]?.startedAt ?? Date.now(),
          finishedAt: null,
        });
      }
    }
    const boolMap: Record<string, boolean> = {};
    for (const [id, val] of Object.entries(taskProcessingMap)) {
      boolMap[id] = val.isProcessing;
    }
    prevProcessingMapRef.current = boolMap;
  }, [
    taskProcessingMap,
    kanbanTasks,
    kanbanUpdateTask,
    kanbanCreateTask,
    threadItemsByThread,
    setTaskChainBlockedReason,
    updateTaskExecution,
    launchKanbanTaskExecution,
    resolveCanonicalThreadId,
  ]);

  // Drag to "inprogress" auto-execute: create thread and send first message (without opening conversation panel)
  const handleDragToInProgress = useCallback(
    (task: KanbanTask) => {
      void launchKanbanTaskExecution({
        taskId: task.id,
        source: "drag",
        activate: false,
      });
    },
    [launchKanbanTaskExecution],
  );

  const orderValue = (entry: WorkspaceInfo) =>
    typeof entry.settings.sortOrder === "number"
      ? entry.settings.sortOrder
      : Number.MAX_SAFE_INTEGER;

  const handleMoveWorkspace = async (
    workspaceId: string,
    direction: "up" | "down"
  ) => {
    const target = workspacesById.get(workspaceId);
    if (!target || (target.kind ?? "main") === "worktree") {
      return;
    }
    const targetGroupId = target.settings.groupId ?? null;
    const ordered = workspaces
      .filter(
        (entry) =>
          (entry.kind ?? "main") !== "worktree" &&
          (entry.settings.groupId ?? null) === targetGroupId,
      )
      .slice()
      .sort((a, b) => {
        const orderDiff = orderValue(a) - orderValue(b);
        if (orderDiff !== 0) {
          return orderDiff;
        }
        return a.name.localeCompare(b.name);
      });
    const index = ordered.findIndex((entry) => entry.id === workspaceId);
    if (index === -1) {
      return;
    }
    const nextIndex = direction === "up" ? index - 1 : index + 1;
    if (nextIndex < 0 || nextIndex >= ordered.length) {
      return;
    }
    const next = ordered.slice();
    const temp = next[index];
    next[index] = next[nextIndex];
    next[nextIndex] = temp;
    await Promise.all(
      next.map((entry, idx) =>
        updateWorkspaceSettings(entry.id, {
          sortOrder: idx
        })
      )
    );
  };

  const shouldMountSpecHub = Boolean(activeWorkspace) && appMode === "chat";
  const showSpecHub = shouldMountSpecHub && activeTab === "spec";
  const rightPanelAvailable = Boolean(
    !isCompact &&
    activeWorkspace &&
    (appMode === "chat" || appMode === "gitHistory") &&
    !settingsOpen &&
    centerMode !== "memory",
  );
  const soloModeEnabled = Boolean(
    !isCompact &&
    activeWorkspace &&
    appMode === "chat" &&
    !settingsOpen &&
    !showSpecHub &&
    !showWorkspaceHome,
  );
  const { isSoloMode, toggleSoloMode, exitSoloMode } = useSoloMode({
    enabled: soloModeEnabled,
    activeTab,
    centerMode,
    filePanelMode,
    sidebarCollapsed,
    rightPanelCollapsed,
    setActiveTab,
    setCenterMode,
    setFilePanelMode,
    collapseSidebar,
    expandSidebar,
    collapseRightPanel,
    expandRightPanel,
    onEnterSoloMode: resetSoloSplitToHalf,
  });
  const sidebarToggleProps = {
    isCompact,
    sidebarCollapsed,
    rightPanelCollapsed,
    isLayoutSwapped: !isCompact && appSettings.layoutMode === "swapped",
    rightPanelAvailable,
    onCollapseSidebar: collapseSidebar,
    onExpandSidebar: expandSidebar,
    onCollapseRightPanel: collapseRightPanel,
    onExpandRightPanel: expandRightPanel,
  };

  useEffect(() => {
    if (!activeWorkspace && isSoloMode) {
      exitSoloMode();
    }
  }, [activeWorkspace, exitSoloMode, isSoloMode]);

  const { markManualNavigation: markLiveEditPreviewManualNavigation } = useLiveEditPreview({
    enabled: liveEditPreviewEnabled,
    timeline: workspaceActivity.timeline,
    centerMode,
    activeEditorFilePath,
    onOpenFile: (path) => {
      handleOpenFile(path);
    },
  });

  const handleOpenWorkspaceFile = useCallback(
    (path: string, location?: { line: number; column: number }) => {
      markLiveEditPreviewManualNavigation();
      handleOpenFile(path, location);
    },
    [handleOpenFile, markLiveEditPreviewManualNavigation],
  );

  const handleActivateWorkspaceFileTab = useCallback(
    (path: string) => {
      markLiveEditPreviewManualNavigation();
      handleActivateFileTab(path);
    },
    [handleActivateFileTab, markLiveEditPreviewManualNavigation],
  );

  const handleCloseWorkspaceFileTab = useCallback(
    (path: string) => {
      markLiveEditPreviewManualNavigation();
      handleCloseFileTab(path);
    },
    [handleCloseFileTab, markLiveEditPreviewManualNavigation],
  );

  const handleCloseAllWorkspaceFileTabs = useCallback(() => {
    markLiveEditPreviewManualNavigation();
    handleCloseAllFileTabs();
  }, [handleCloseAllFileTabs, markLiveEditPreviewManualNavigation]);

  const handleExitWorkspaceEditor = useCallback(() => {
    markLiveEditPreviewManualNavigation();
    handleExitEditor();
  }, [handleExitEditor, markLiveEditPreviewManualNavigation]);

  const showComposer = Boolean(selectedKanbanTaskId) || ((!isCompact
    ? (centerMode === "chat" || centerMode === "diff" || centerMode === "editor") &&
      !showSpecHub &&
      !showWorkspaceHome
    : (isTablet ? tabletTab : activeTab) === "codex" && !showWorkspaceHome));
  const showGitDetail = Boolean(selectedDiffPath) && isPhone;
  const isThreadOpen = Boolean(activeThreadId && showComposer);
  const handleSelectDiffForPanel = useCallback(
    (path: string | null) => {
      markLiveEditPreviewManualNavigation();
      if (!path) {
        setSelectedDiffPath(null);
        return;
      }
      handleSelectDiff(path);
    },
    [handleSelectDiff, markLiveEditPreviewManualNavigation, setSelectedDiffPath],
  );
  const handleCloseGitHistoryPanel = useCallback(() => {
    setAppMode("chat");
  }, [setAppMode]);
  const normalizeWorkspacePath = useCallback(
    (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, ""),
    [],
  );
  const handleSelectWorkspacePathForGitHistory = useCallback(
    async (path: string) => {
      const normalizedTarget = normalizeWorkspacePath(path);
      const existing = workspaces.find(
        (entry) => normalizeWorkspacePath(entry.path) === normalizedTarget,
      );
      if (existing) {
        setActiveWorkspaceId(existing.id);
        return;
      }
      try {
        const workspace = await addWorkspaceFromPath(path);
        if (workspace) {
          setActiveWorkspaceId(workspace.id);
        }
      } catch (error) {
        addDebugEntry({
          id: `${Date.now()}-git-history-select-workspace-path-error`,
          timestamp: Date.now(),
          source: "error",
          label: "git-history/select-workspace-path error",
          payload: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [addDebugEntry, addWorkspaceFromPath, normalizeWorkspacePath, setActiveWorkspaceId, workspaces],
  );

  const handleOpenSpecHub = useCallback(() => {
    closeSettings();
    setAppMode("chat");
    setCenterMode("chat");
    setActiveTab((current) => (current === "spec" ? "codex" : "spec"));
  }, [closeSettings, setActiveTab, setAppMode, setCenterMode]);

  const handleOpenWorkspaceHome = useCallback(() => {
    exitDiffView();
    resetPullRequestSelection();
    setHomeOpen(false);
    setAppMode("chat");
    setCenterMode("chat");
    setActiveTab("codex");
    if (activeWorkspaceId) {
      setWorkspaceHomeWorkspaceId(activeWorkspaceId);
      selectWorkspace(activeWorkspaceId);
      setActiveThreadId(null, activeWorkspaceId);
      return;
    }
    setWorkspaceHomeWorkspaceId(null);
    selectHome();
  }, [
    activeWorkspaceId,
    exitDiffView,
    resetPullRequestSelection,
    setActiveTab,
    setAppMode,
    setCenterMode,
    setHomeOpen,
    setWorkspaceHomeWorkspaceId,
    selectHome,
    selectWorkspace,
    setActiveThreadId,
  ]);

  const handleOpenHomeChat = useCallback(() => {
    exitDiffView();
    resetPullRequestSelection();
    setWorkspaceHomeWorkspaceId(null);
    setAppMode("chat");
    setCenterMode("chat");
    setHomeOpen(true);
    if (homeWorkspaceSelectedId) {
      setActiveWorkspaceId(homeWorkspaceSelectedId);
      setActiveThreadId(null, homeWorkspaceSelectedId);
      return;
    }
    selectHome();
  }, [
    exitDiffView,
    homeWorkspaceSelectedId,
    resetPullRequestSelection,
    selectHome,
    setAppMode,
    setCenterMode,
    setActiveThreadId,
    setActiveWorkspaceId,
    setHomeOpen,
    setWorkspaceHomeWorkspaceId,
  ]);

  const handleSelectHomeWorkspace = useCallback((workspaceId: string) => {
    if (!workspaceId) {
      return;
    }
    exitDiffView();
    resetPullRequestSelection();
    setWorkspaceHomeWorkspaceId(null);
    setAppMode("chat");
    setCenterMode("chat");
    setHomeOpen(true);
    setActiveWorkspaceId(workspaceId);
    setActiveThreadId(null, workspaceId);
  }, [
    exitDiffView,
    resetPullRequestSelection,
    setAppMode,
    setCenterMode,
    setActiveThreadId,
    setActiveWorkspaceId,
    setHomeOpen,
    setWorkspaceHomeWorkspaceId,
  ]);

  const handleOpenKanbanMode = useCallback(() => {
    setHomeOpen(false);
    setAppMode("kanban");
    closeSettings();
  }, [closeSettings, setAppMode, setHomeOpen]);

  const handleOpenFilesSurface = useCallback(() => {
    closeSettings();
    setAppMode("chat");
    setCenterMode("chat");
    setFilePanelMode("files");
    expandRightPanel();
    if (isCompact) {
      setActiveTab("git");
    }
  }, [
    closeSettings,
    expandRightPanel,
    isCompact,
    setActiveTab,
    setAppMode,
    setCenterMode,
    setFilePanelMode,
  ]);

  usePrimaryModeShortcuts({
    isEnabled: true,
    openChatShortcut: appSettings.openChatShortcut,
    openKanbanShortcut: appSettings.openKanbanShortcut,
    onOpenChat: handleOpenHomeChat,
    onOpenKanban: handleOpenKanbanMode,
  });

  useAppSurfaceShortcuts({
    isCompact,
    rightPanelAvailable,
    sidebarCollapsed,
    rightPanelCollapsed,
    toggleLeftConversationSidebarShortcut:
      appSettings.toggleLeftConversationSidebarShortcut,
    toggleRightConversationSidebarShortcut:
      appSettings.toggleRightConversationSidebarShortcut,
    toggleRuntimeConsoleShortcut: appSettings.toggleRuntimeConsoleShortcut,
    toggleFilesSurfaceShortcut: appSettings.toggleFilesSurfaceShortcut,
    onExpandSidebar: expandSidebar,
    onCollapseSidebar: collapseSidebar,
    onExpandRightPanel: expandRightPanel,
    onCollapseRightPanel: collapseRightPanel,
    onToggleRuntimeConsole: handleToggleRuntimeConsole,
    onOpenFilesSurface: handleOpenFilesSurface,
  });

  useArchiveShortcut({
    isEnabled: isThreadOpen,
    shortcut: appSettings.archiveThreadShortcut,
    onTrigger: handleArchiveActiveThread,
  });

  const { handleCycleAgent, handleCycleWorkspace } = useWorkspaceCycling({
    workspaces,
    groupedWorkspaces,
    threadsByWorkspace,
    getThreadRows,
    getPinTimestamp,
    activeWorkspaceIdRef,
    activeThreadIdRef,
    exitDiffView,
    resetPullRequestSelection,
    selectWorkspace,
    setActiveThreadId,
  });

  useAppMenuEvents({
    activeWorkspaceRef,
    baseWorkspaceRef,
    onAddWorkspace: () => {
      void handleAddWorkspace();
    },
    onNewWindow: () => {
      void handleOpenNewWindow();
    },
    onAddAgent: (workspace, engine) => {
      void handleAddAgent(workspace, engine);
    },
    onAddWorktreeAgent: (workspace) => {
      void handleAddWorktreeAgent(workspace);
    },
    onAddCloneAgent: (workspace) => {
      void handleAddCloneAgent(workspace);
    },
    onOpenSettings: () => openSettings(),
    onCycleAgent: handleCycleAgent,
    onCycleWorkspace: handleCycleWorkspace,
    onToggleDebug: handleDebugClick,
    onToggleTerminal: handleToggleTerminalPanel,
    onToggleGlobalSearch: handleToggleSearchPalette,
    sidebarCollapsed,
    rightPanelCollapsed,
    rightPanelAvailable,
    onExpandSidebar: expandSidebar,
    onCollapseSidebar: collapseSidebar,
    onExpandRightPanel: expandRightPanel,
    onCollapseRightPanel: collapseRightPanel,
  });

  useMenuAcceleratorController({ appSettings, onDebug: addDebugEntry });
  useMenuLocalization();
  const handleRefreshAccountRateLimits = useCallback(
    () => refreshAccountRateLimits(activeWorkspaceId ?? undefined),
    [activeWorkspaceId, refreshAccountRateLimits],
  );
  const dropOverlayActive = isWorkspaceDropActive;
  const dropOverlayText = "Drop Project Here";
  const shouldShowSidebarTopbarContent = false;
  const appClassName = `app ${isCompact ? "layout-compact" : "layout-desktop"}${
    isPhone ? " layout-phone" : ""
  }${isTablet ? " layout-tablet" : ""}${
    isWindowsDesktop ? " windows-desktop" : ""
  }${isMacDesktop ? " macos-desktop" : ""
  }${
    reduceTransparency ? " reduced-transparency" : ""
  }${
    appSettings.canvasWidthMode === "wide" ? " canvas-width-wide" : ""
  }${
    !isCompact && appSettings.layoutMode === "swapped" ? " layout-swapped" : ""
  }${!isCompact && sidebarCollapsed ? " sidebar-collapsed" : ""}${
    !isCompact && rightPanelCollapsed ? " right-panel-collapsed" : ""
  }${shouldShowSidebarTopbarContent ? " sidebar-title-relocated" : ""}${
    showHome ? " home-active" : ""
  }${
    showKanban ? " kanban-active" : ""
  }${showGitHistory ? " git-history-active" : ""
  }${isSoloMode ? " solo-mode" : ""
  }`;

  return {
    selectedComposerKanbanPanelId,
    setSelectedComposerKanbanPanelId,
    composerKanbanContextMode,
    setComposerKanbanContextMode,
    composerLinkedKanbanPanels,
    handleOpenComposerKanbanPanel,
    handleComposerSendWithEditorFallback,
    handleComposerQueueWithEditorFallback,
    handleRewindFromMessage,
    handleSelectWorkspaceInstance,
    handleStartWorkspaceConversation,
    handleStartSharedConversation,
    handleContinueLatestConversation,
    handleStartGuidedConversation,
    handleRevealActiveWorkspace,
    handleDeleteWorkspaceConversations,
    handleDeleteWorkspaceConversationsInSettings,
    handleOpenTaskConversation,
    handleCloseTaskConversation,
    handleKanbanCreateTask,
    taskProcessingMap,
    handleDragToInProgress,
    handleMoveWorkspace,
    shouldMountSpecHub,
    showSpecHub,
    rightPanelAvailable,
    soloModeEnabled,
    isSoloMode,
    toggleSoloMode,
    sidebarToggleProps,
    handleOpenWorkspaceFile,
    handleActivateWorkspaceFileTab,
    handleCloseWorkspaceFileTab,
    handleCloseAllWorkspaceFileTabs,
    handleExitWorkspaceEditor,
    showComposer,
    showGitDetail,
    handleSelectDiffForPanel,
    handleCloseGitHistoryPanel,
    handleSelectWorkspacePathForGitHistory,
    handleOpenSpecHub,
    handleOpenWorkspaceHome,
    handleOpenHomeChat,
    handleSelectHomeWorkspace,
    handleRefreshAccountRateLimits,
    dropOverlayActive,
    dropOverlayText,
    shouldShowSidebarTopbarContent,
    appClassName,
    isPullRequestComposer,
    composerSendLabel,
    handleToggleSearchPalette,
  };
}
