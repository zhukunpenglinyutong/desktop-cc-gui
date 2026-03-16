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
import { ensureWorkspacePathDir } from "../services/tauri";
import { resolveKanbanThreadCreationStrategy } from "../features/kanban/utils/contextMode";
import { deriveKanbanTaskTitle } from "../features/kanban/utils/taskTitle";
import { useSoloMode } from "../features/layout/hooks/useSoloMode";
import { useLiveEditPreview } from "../features/live-edit-preview/hooks/useLiveEditPreview";
import { useArchiveShortcut } from "../features/app/hooks/useArchiveShortcut";
import { useWorkspaceCycling } from "../features/app/hooks/useWorkspaceCycling";
import { useAppMenuEvents } from "../features/app/hooks/useAppMenuEvents";
import { useMenuAcceleratorController } from "../features/app/hooks/useMenuAcceleratorController";
import { useMenuLocalization } from "../features/app/hooks/useMenuLocalization";

export function useAppShellSections(ctx: any) {
  const {
    activeWorkspace,
    workspaces,
    kanbanPanels,
    setKanbanViewState,
    setAppMode,
    activeEngine,
    selectedAgent,
    activeWorkspaceId,
    normalizePath,
    addWorkspaceFromPath,
    alertError,
    workspacesById,
    exitDiffView,
    connectWorkspace,
    startThreadForWorkspace,
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
    isCompact,
    centerMode,
    setActiveTab,
    recentThreads,
    collapseRightPanel,
    setActiveEngine,
    removeThread,
    clearDraftForThread,
    removeImagesForThread,
    t,
    setSelectedModelId,
    setEngineSelectedModelIdByType,
    threadStatusById,
    kanbanTasks,
    appMode,
    setSelectedKanbanTaskId,
    workspacesByPath,
    kanbanViewState,
    setActiveWorkspaceId,
    updateWorkspaceSettings,
    activeTab,
    settingsOpen,
    showWorkspaceHome,
    filePanelMode,
    sidebarCollapsed,
    rightPanelCollapsed,
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
    isPhone,
    closeSettings,
    selectHome,
    handleArchiveActiveThread,
    appSettings,
    groupedWorkspaces,
    getThreadRows,
    getPinTimestamp,
    activeWorkspaceIdRef,
    activeThreadIdRef,
    activeWorkspaceRef,
    baseWorkspaceRef,
    handleAddWorkspace,
    handleAddAgent,
    handleAddWorktreeAgent,
    handleAddCloneAgent,
    openSettings,
    handleDebugClick,
    handleToggleTerminalPanel,
    handleToggleSearchPalette,
    refreshAccountRateLimits,
    showHome,
    showKanban,
    showGitHistory,
    isWindowsDesktop,
    isMacDesktop,
    reduceTransparency,
    handleComposerQueue,
    setSelectedDiffPath,
    handleSelectDiff,
    setSelectedPullRequest,
    setSelectedCommitSha,
    setDiffSource,
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
    [composerLinkedKanbanPanels, setKanbanViewState],
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
      const cleanText = text.replace(/&@[^\s]+/g, " ").replace(/\s+/g, " ").trim();
      return { panelId, cleanText };
    },
    [composerLinkedKanbanPanels, selectedComposerKanbanPanelId],
  );

  const mergeSelectedAgentOption = useCallback(
    (options?: MessageSendOptions): MessageSendOptions | undefined => {
      if (activeEngine === "opencode") {
        return options;
      }
      const merged: MessageSendOptions = {
        ...(options ?? {}),
        selectedAgent: selectedAgent
          ? {
              id: selectedAgent.id,
              name: selectedAgent.name,
              prompt: selectedAgent.prompt ?? null,
            }
          : null,
      };
      return merged;
    },
    [activeEngine, selectedAgent],
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
        let defaultWorkspacePath: string;
        try {
          const resolvedHome = normalizePath(await homeDir());
          defaultWorkspacePath = `${resolvedHome}/.codemoss/workspace`;
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
      setActiveThreadId,
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

  const handleSelectWorkspaceInstance = useCallback(
    (workspaceId: string, threadId: string) => {
      exitDiffView();
      resetPullRequestSelection();
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
      setActiveEngine,
      setActiveThreadId,
      startThreadForWorkspace,
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
      setActiveEngine,
      setActiveThreadId,
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
      const succeededThreadIds: string[] = [];
      const failed: Array<{ threadId: string; code: string; message: string }> = [];
      for (const threadId of threadIds) {
        const result = await removeThread(workspaceId, threadId);
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
      return {
        succeededThreadIds,
        failed,
      };
    },
    [clearDraftForThread, removeImagesForThread, removeThread, t],
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
        let resolvedThreadId = task.threadId;
        // If the stored threadId is a stale claude-pending-* that was already renamed,
        // resolve to the new ID by checking threadsByWorkspace.
        if (
          resolvedThreadId.startsWith("claude-pending-") &&
          !threadStatusById[resolvedThreadId]
        ) {
          const threads = threadsByWorkspace[workspace.id] ?? [];
          const otherTaskThreadIds = new Set(
            kanbanTasks
              .filter((t) => t.id !== task.id && t.threadId && !t.threadId.startsWith("claude-pending-"))
              .map((t) => t.threadId as string)
          );
          const match = threads.find(
            (t) => t.id.startsWith("claude:") && !otherTaskThreadIds.has(t.id)
          );
          if (match) {
            resolvedThreadId = match.id;
            kanbanUpdateTask(task.id, { threadId: resolvedThreadId });
          }
        }
        setActiveThreadId(resolvedThreadId, workspace.id);
      } else {
        const threadId = await startThreadForWorkspace(workspace.id, { engine });
        if (threadId) {
          kanbanUpdateTask(task.id, { threadId });
          setActiveThreadId(threadId, workspace.id);
        }
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
    ]
  );

  const handleCloseTaskConversation = useCallback(() => {
    setSelectedKanbanTaskId(null);
  }, []);

  const handleKanbanCreateTask = useCallback(
    (input: Parameters<typeof kanbanCreateTask>[0]) => {
      const task = kanbanCreateTask(input);
      if (input.autoStart) {
        // Auto-execute: create thread and send first message (without opening conversation panel)
        const executeAutoStart = async () => {
          const workspace = workspacesByPath.get(task.workspaceId);
          if (!workspace) return;

          await connectWorkspace(workspace);
          selectWorkspace(workspace.id);

          const engine = (task.engineType ?? activeEngine) as "claude" | "codex";
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

          const threadId = await startThreadForWorkspace(workspace.id, { engine });
          if (!threadId) return;
          kanbanUpdateTask(task.id, { threadId });
          setActiveThreadId(threadId, workspace.id);

          // Send task description (or title if no description) as first message
          const firstMessage = task.description?.trim() || task.title;
          if (firstMessage) {
            // Small delay to let activeWorkspace state settle after selectWorkspace
            await new Promise((r) => setTimeout(r, 100));
            await sendUserMessageToThread(workspace, threadId, firstMessage, task.images ?? []);
          }
        };
        executeAutoStart().catch((err) => {
          console.error("[kanban] autoStart execute failed:", err);
        });
      }
      return task;
    },
    [
      kanbanCreateTask,
      kanbanUpdateTask,
      workspacesByPath,
      connectWorkspace,
      selectWorkspace,
      activeEngine,
      setActiveEngine,
      setSelectedModelId,
      setEngineSelectedModelIdByType,
      startThreadForWorkspace,
      setActiveThreadId,
      sendUserMessageToThread,
    ]
  );

  // Sync kanban task threadIds when Claude renames pending → session.
  // Must cover ALL tasks (not just selected) because background tasks get renamed too.
  useEffect(() => {
    const usedNewIds = new Set<string>();
    for (const task of kanbanTasks) {
      if (!task.threadId || !task.threadId.startsWith("claude-pending-")) continue;
      // If the old ID still exists in the thread system, no rename happened yet
      if (threadStatusById[task.threadId] !== undefined) continue;
      // Thread was renamed — find the new ID from threadsByWorkspace
      const wsId = workspacesByPath.get(task.workspaceId)?.id;
      const threads = wsId ? (threadsByWorkspace[wsId] ?? []) : [];
      const otherTaskThreadIds = new Set(
        kanbanTasks
          .filter((t) => t.id !== task.id && t.threadId && !t.threadId.startsWith("claude-pending-"))
          .map((t) => t.threadId as string)
      );
      const newThread = threads.find(
        (t) =>
          t.id.startsWith("claude:") &&
          !otherTaskThreadIds.has(t.id) &&
          !usedNewIds.has(t.id)
      );
      if (newThread) {
        usedNewIds.add(newThread.id);
        kanbanUpdateTask(task.id, { threadId: newThread.id });
      }
    }
  }, [kanbanTasks, threadStatusById, threadsByWorkspace, kanbanUpdateTask, workspacesByPath]);

  useEffect(() => {
    if (appMode !== "kanban") {
      setSelectedKanbanTaskId(null);
    }
  }, [appMode]);

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
      if (task.threadId) {
        const status = threadStatusById[task.threadId];
        map[task.id] = {
          isProcessing: status?.isProcessing ?? false,
          startedAt: status?.processingStartedAt ?? null,
        };
      }
    }
    return map;
  }, [kanbanTasks, threadStatusById]);

  // Track previous processing state to detect transitions
  const prevProcessingMapRef = useRef<Record<string, boolean>>({});
  useEffect(() => {
    const prev = prevProcessingMapRef.current;
    for (const task of kanbanTasks) {
      const wasProcessing = prev[task.id] ?? false;
      const nowProcessing = taskProcessingMap[task.id]?.isProcessing ?? false;
      if (wasProcessing === nowProcessing) continue;

      // AI finished processing (true → false): auto-move inprogress → testing
      if (wasProcessing && !nowProcessing && task.status === "inprogress") {
        kanbanUpdateTask(task.id, { status: "testing" });
      }
      // User sent follow-up (false → true): auto-move testing → inprogress
      if (!wasProcessing && nowProcessing && task.status === "testing") {
        kanbanUpdateTask(task.id, { status: "inprogress" });
      }
    }
    const boolMap: Record<string, boolean> = {};
    for (const [id, val] of Object.entries(taskProcessingMap)) {
      boolMap[id] = val.isProcessing;
    }
    prevProcessingMapRef.current = boolMap;
  }, [taskProcessingMap, kanbanTasks, kanbanUpdateTask]);

  // Drag to "inprogress" auto-execute: create thread and send first message (without opening conversation panel)
  const handleDragToInProgress = useCallback(
    (task: KanbanTask) => {
      // Auto-execute regardless of existing threadId — reuse thread if present
      const executeTask = async () => {
        const workspace = workspacesByPath.get(task.workspaceId);
        if (!workspace) return;

        await connectWorkspace(workspace);
        selectWorkspace(workspace.id);

        const engine = (task.engineType ?? activeEngine) as "claude" | "codex";
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

        let threadId = task.threadId;
        if (!threadId) {
          // activate: false — this is background execution, must not switch
          // the global active thread (which would hijack any conversation
          // panel the user is currently viewing).
          threadId = await startThreadForWorkspace(workspace.id, {
            engine,
            activate: false,
          });
          if (!threadId) return;
          kanbanUpdateTask(task.id, { threadId });
        }

        const firstMessage = task.description?.trim() || task.title;
        if (firstMessage) {
          await new Promise((r) => setTimeout(r, 100));
          await sendUserMessageToThread(workspace, threadId, firstMessage, task.images ?? []);
        }
      };
      executeTask().catch((err) => {
        console.error("[kanban] drag-to-inprogress auto-execute failed:", err);
      });
    },
    [
      workspacesByPath,
      connectWorkspace,
      selectWorkspace,
      activeEngine,
      setActiveEngine,
      setSelectedModelId,
      setEngineSelectedModelIdByType,
      startThreadForWorkspace,
      kanbanUpdateTask,
      sendUserMessageToThread,
    ]
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
  }, [closeSettings]);

  const handleOpenWorkspaceHome = useCallback(() => {
    exitDiffView();
    resetPullRequestSelection();
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
    selectHome();
  }, [
    exitDiffView,
    resetPullRequestSelection,
    selectHome,
  ]);

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
    handleSelectWorkspaceInstance,
    handleStartWorkspaceConversation,
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
