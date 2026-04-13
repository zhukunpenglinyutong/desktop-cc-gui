// @ts-nocheck
import { ask } from "@tauri-apps/plugin-dialog";
import { useLayoutNodes } from "../features/layout/hooks/useLayoutNodes";
import { MainHeaderActions } from "../features/app/components/MainHeaderActions";
import { OPENCODE_VARIANT_OPTIONS } from "./utils";

export function useAppShellLayoutNodesSection(ctx: any) {
  const {
    GitHubPanelData, RECENT_THREAD_LIMIT, SettingsView, accessMode, accountByWorkspace, accountSwitching, activeAccount, activeDiffError,
    activeDiffLoading, activeDiffs, activeDraft, activeEditorFilePath, activeEditorLineRange, activeEngine, activeFusingMessageId, activeGitRoot, activeImages,
    activeItems, activeParentWorkspace, activePath, activePlan, activeQueue, activeRateLimits, activeRenamePrompt, activeTab, agentTaskScrollRequest,
    activeTerminalId, activeThreadId, activeThreadIdForModeRef, activeThreadIdRef, activeTokenUsage, activeWorkspace, activeWorkspaceId, activeWorkspaceIdRef,
    activeWorkspaceKanbanTasks, activeWorkspaceRef, activeWorkspaceThreads, addCloneAgent, addDebugEntry, addWorkspace, addWorkspaceFromPath, addWorktreeAgent,
    agent, alertError, appClassName, appMode, appRoot, appRootRef, appSettings, appSettingsLoading,
    applySelectedCollaborationMode, approvals, assignWorkspaceGroup, attachImages, baseWorkspaceRef, branches, canFuseActiveQueue, canInterrupt, cancelClonePrompt,
    cancelWorktreePrompt, cancelled, centerMode, checkoutBranch, chooseCloneCopiesFolder, choosePreset, claudeAccessModeRef, clearActiveImages,
    clearCloneCopiesFolder, clearDebugEntries, clearDictationError, clearDictationHint, clearDictationTranscript, clearDraftForThread, clearGitRootCandidates, clonePrompt,
    closePlanPanel, closeReleaseNotes, closeReviewPrompt, closeSearchPalette, closeSettings, closeTerminalPanel, closeWorktreeCreateResult, codexComposerModeRef,
    collaborationModePayload, collaborationModes, collaborationModesEnabled, collaborationRuntimeModeByThread, collaborationUiModeByThread, collapseRightPanel, collapseSidebar, commands,
    commitError, commitLoading, commitMessage, commitMessageError, commitMessageLoading, completionTrackerBySessionRef, completionTrackerReadyRef, composerEditorSettings,
    composerInputRef, composerInsert, composerKanbanContextMode, composerLinkedKanbanPanels, composerSendLabel, confirmBranch, confirmClonePrompt, confirmCommit,
    confirmCustom, confirmRenameWorktreeUpstream, confirmWorktreePrompt, connectWorkspace, createBranch, createPrompt, createWorkspaceGroup, debugEntries,
    debugOpen, debugPanelHeight, defaultModel, deletePrompt, deleteThreadPrompt, deleteWorkspaceGroup, deletingWorktreeIds, delta,
    dictationError, dictationHint, dictationLevel, dictationModel, dictationReady, dictationState, dictationTranscript, diffScrollRequestId,
    diffSource, directories, dismissErrorToast, dismissUpdate, doctor, dragHandle, dropOverlayActive, dropOverlayText,
    editorHighlightTarget, editorNavigationTarget, editorSplitLayout, effectiveModels, effectiveReasoningSupported, effectiveRuntimeMode, effectiveSelectedModel, effectiveSelectedModelId,
    effectiveUiMode, engineModelsAsOptions, engineSelectedModelIdByType, engineSelection, engineStatuses, ensureLaunchTerminal, ensureTerminalWithTitle, ensureWorkspaceThreadListLoaded,
    entry, errorToasts, existing, exitDiffView, expandRightPanel, expandSidebar, filePanelMode, filePassword,
    fileReferenceMode, fileStatus, files, finishedByAgentUpdate, finishedByDuration, firstAnswer, flushDraggedHeight, force,
    forkThreadForWorkspace, getGlobalPromptsDir, getPinTimestamp, getThreadRows, getWorkspaceGroupName, getWorkspacePromptsDir, gitCommitDiffs, gitDiffListView,
    gitDiffViewStyle, gitHistoryPanelHeight, gitHistoryPanelHeightRef, gitIssues, gitIssuesError, gitIssuesLoading, gitIssuesTotal, gitLogAhead,
    gitLogAheadEntries, gitLogBehind, gitLogBehindEntries, gitLogEntries, gitLogError, gitLogLoading, gitLogTotal, gitLogUpstream,
    gitPanelMode, gitPullRequestComments, gitPullRequestCommentsError, gitPullRequestCommentsLoading, gitPullRequestDiffs, gitPullRequestDiffsError, gitPullRequestDiffsLoading, gitPullRequests,
    gitPullRequestsError, gitPullRequestsLoading, gitPullRequestsTotal, gitRemoteUrl, gitRootCandidates, gitRootScanDepth, gitRootScanError, gitRootScanHasScanned,
    gitRootScanLoading, gitStatus, gitignoredDirectories, gitignoredFiles, globalSearchFilesByWorkspace, group, groupId, groupedWorkspaces,
    handleActivateFileTab, handleActivateWorkspaceFileTab, handleActiveDiffPath, handleAddAgent, handleAddCloneAgent, handleAddWorkspace, handleAddWorkspaceFromPath, handleAddWorktreeAgent,
    handleAppModeChange, handleApplyWorktreeChanges, handleApprovalDecision, handleApprovalRemember, handleArchiveActiveThread, handleCancelSwitchAccount, handleCheckoutBranch, handleCloseAllFileTabs,
    handleCloseAllWorkspaceFileTabs, handleCloseFileTab, handleCloseGitHistoryPanel, handleCloseTaskConversation, handleCloseWorkspaceFileTab, handleCollaborationModeResolved, handleCommit, handleCommitAndPush,
    handleCommitAndSync, handleCommitMessageChange, handleComposerQueue, handleComposerQueueWithEditorFallback, handleComposerSend, handleComposerSendWithEditorFallback, handleContinueLatestConversation, handleCopyDebug,
    handleCopyThread, handleCreateBranch, handleCreatePrompt, handleDebugClick, handleDeletePrompt, handleDeleteQueued, handleDeleteThreadPromptCancel, handleDeleteThreadPromptConfirm,
    handleDeleteWorkspaceConversations, handleDeleteWorkspaceConversationsInSettings, handleDraftChange, handleDragToInProgress, handleDropWorkspacePaths, handleEditQueued, handleEnsureWorkspaceThreadsForSettings, handleExitEditor,
    handleExitWorkspaceEditor, handleGenerateCommitMessage, handleGitIssuesChange, handleGitPanelModeChange, handleGitPullRequestCommentsChange, handleGitPullRequestDiffsChange, handleGitPullRequestsChange, handleInsertComposerText,
    handleKanbanCreateTask, handleLockPanel, handleMovePrompt, handleMoveWorkspace, handleOpenComposerKanbanPanel, handleOpenDetachedFileExplorer, handleOpenFile, handleOpenHomeChat, handleOpenModelSettings,
    handleOpenRenameWorktree, handleOpenSearchPalette, handleOpenSpecHub, handleOpenTaskConversation, handleOpenWorkspaceFile, handleOpenWorkspaceHome, handlePickGitRoot, handlePointerMove,
    handlePointerUp, handlePush, handleRefreshAccountRateLimits, handleRenamePromptCancel, handleRenamePromptChange, handleRenamePromptConfirm, handleRenameThread, handleRenameWorktreeCancel,
    handleRenameWorktreeChange, handleRenameWorktreeConfirm, handleResize, handleRevealActiveWorkspace, handleRevealGeneralPrompts, handleRevealWorkspacePrompts, handleRevertAllGitChanges, handleRevertGitFile,
    handleReviewPromptKeyDown, handleRewindFromMessage, handleSearchPaletteMoveSelection, handleSelectAgent, handleSelectCommit, handleSelectDiff, handleSelectDiffForPanel, handleSelectModel, handleSelectOpenAppId,
    handleSelectOpenCodeAgent, handleSelectOpenCodeVariant, handleSelectPullRequest, handleSelectSearchResult, handleSelectWorkspaceInstance, handleSelectWorkspacePathForGitHistory, handleSend, handleSendPrompt,
    handleSendPromptToNewAgent, handleSelectStatusPanelSubagent, handleSetAccessMode, handleSetGitRoot, handleStageGitAll, handleStageGitFile, handleStartGuidedConversation, handleStartWorkspaceConversation, handleSwitchAccount, handleFuseQueued,
    handleSync, handleTestNotificationSound, handleToggleDictation, handleToggleRuntimeConsole, handleToggleSearchContentFilter, handleToggleSearchPalette, handleToggleTerminal, handleToggleTerminalPanel,
    handleUnlockPanel, handleUnstageGitFile, handleUpdatePrompt, handleUserInputSubmit, handleUserInputSubmitWithPlanApply, handleWorkspaceDragEnter, handleWorkspaceDragLeave, handleWorkspaceDragOver,
    handleWorkspaceDrop, handleWorktreeCreated, hasActivePlan, hasLoaded, hasPlanData, highlightedBranchIndex, highlightedCommitIndex, highlightedPresetIndex,
    historySearchItems, hydratedThreadListWorkspaceIdsRef, installedEngines, interruptTurn, isCompact, isDeleteThreadPromptBusy, isEditorFileMaximized, isFilesLoading,
    isLoadingLatestAgents, isMacDesktop, isPanelLocked, isPhone, isPlanMode, isPlanPanelDismissed, isProcessing, isProcessingNow,
    isPullRequestComposer, isPullRequestComposerFromSections, isReviewing, isSearchPaletteOpen, isSoloMode, isTablet, isThreadAutoNaming, isThreadPinned,
    isValid, isWindowsDesktop, isWorkspaceDropActive, isWorktreeWorkspace, kanbanConversationWidth, kanbanCreatePanel, kanbanCreateTask, kanbanDeletePanel,
    kanbanDeleteTask, kanbanPanels, kanbanReorderTask, kanbanTasks, kanbanUpdatePanel, kanbanUpdateTask, kanbanViewState, key,
    label, lastAgent, lastAgentMessageByThread, lastAgentTimestamp, lastCodexModeSyncThreadRef, lastDurationMs, lastFrameAt, latestAgentRuns,
    latestClampedHeight, latestRawHeight, latestSnippet, launchScriptState, launchScriptsState, listThreadsForWorkspace, listThreadsForWorkspaceTracked, liveEditPreviewEnabled,
    loadOlderThreadsForWorkspace, lockLiveSessions, main, mainWidth, mappedMode, markWorkspaceConnected, maxHeight, minHeight,
    models, monitor, movePrompt, moveWorkspaceGroup, navigateToThread, next, nextDefault, nextDraft,
    nextFiles, nextHeight, nextScope, nextSettings, normalizePath, normalized, onCloseTerminal, onDebugPanelResizeStart,
    onGitHistoryPanelResizeStart, onKanbanConversationResizeStart, onNewTerminal, onPlanPanelResizeStart, onRightPanelResizeStart, onSelectTerminal, onSidebarResizeStart, onTerminalPanelResizeStart,
    onTextareaHeightChange, openAppIconById, openClonePrompt, openCodeAgentByThreadId, openCodeAgents, openCodeDefaultAgentByWorkspace, openCodeDefaultVariantByWorkspace, openCodeVariantByThreadId,
    openDeleteThreadPrompt, openFileTabs, openPlanPanel, openReleaseNotes, openRenamePrompt, openRenameWorktreePrompt, openSettings, openTerminal,
    openWorktreePrompt, path, payload, perfSnapshotRef, persistProjectCopiesFolder, pickImages, pinThread, pinnedThreadsVersion,
    planByThread, planPanelHeight, pointerId, prefillDraft, prevFiles, previous, previousAgentTimestamp, previousDurationMs,
    previousThreadIdRef, previousTracker, prompts, pushError, pushLoading, queueGitStatusRefresh, queueMessage, queueSaveSettings,
    rafId, rateLimitsByWorkspace, reasoningOptions, reasoningSupported, recentThreads, reduceTransparency, refreshAccountInfo, refreshAccountRateLimits,
    refreshFiles, refreshGitDiffs, refreshGitLog, refreshGitStatus, refreshThread, refreshWorkspaces, releaseNotesActiveIndex, releaseNotesEntries,
    releaseNotesError, releaseNotesLoading, releaseNotesOpen, reloadSelectedAgent, removeImage, removeImagesForThread, removeThread, removeWorkspace,
    removeWorktree, renamePrompt, renameThread, renameWorkspaceGroup, renameWorktree, renameWorktreeNotice, renameWorktreePrompt, renameWorktreeUpstream,
    renameWorktreeUpstreamPrompt, requestId, requestThreadId, resetGitHubPanelState, resetPullRequestSelection, resetSoloSplitToHalf, resetWorkspaceThreads, resolveCloneProjectContext,
    resolveCollaborationRuntimeMode, resolveCollaborationUiMode, resolveOpenCodeAgentForThread, resolveOpenCodeVariantForThread, resolvedEffort, resolvedModel, response, restartTerminalSession,
    result, resumePrompt, retryReleaseNotesLoad, reviewPrompt, rightPanelAvailable, rightPanelCollapsed, rightPanelWidth, runtimeMode,
    runtimeRunState, scaleShortcutText, scaleShortcutTitle, scanGitRoots, scheduleDraggedHeightFlush, scopedKanbanTasks, searchContentFilters, searchPaletteQuery,
    searchPaletteSelectedIndex, searchResults, searchScope, sections, selectBranch, selectBranchAtIndex, selectCommit, selectCommitAtIndex,
    selectHome, selectWorkspace, selected, selectedAgent, selectedAnswer, selectedCollaborationMode, selectedCollaborationModeId, selectedCommitSha,
    selectedComposerKanbanPanelId, selectedDiffPath, selectedEffort, selectedKanbanTaskId, selectedModelId, selectedOpenCodeAgent, selectedOpenCodeVariant, selectedPath,
    selectedPullRequest, selection, sendUserMessage, sendUserMessageToThread, sessions, setAccessMode, setActiveEditorLineRange, setActiveEngine,
    setActiveTab, setActiveThreadId, setActiveWorkspaceId, setAppMode, setAppSettings, setCenterMode, setCodexCollaborationMode, setCollaborationRuntimeModeByThread,
    setCollaborationUiModeByThread, setComposerInsert, setComposerKanbanContextMode, setDebugOpen, setDiffSource, setEditorSplitLayout, setEngineSelectedModelIdByType, setFilePanelMode,
    setFileReferenceMode, setGitDiffListView, setGitDiffViewStyle, setGitHistoryPanelHeight, setGitPanelMode, setGitRootScanDepth, setGlobalSearchFilesByWorkspace, setHighlightedBranchIndex,
    setHighlightedCommitIndex, setHighlightedPresetIndex, setIsEditorFileMaximized, setIsPanelLocked, setIsPlanPanelDismissed, setIsSearchPaletteOpen, setKanbanViewState, setLiveEditPreviewEnabled,
    setOpenCodeAgentByThreadId, setOpenCodeAgents, setOpenCodeDefaultAgentByWorkspace, setOpenCodeDefaultVariantByWorkspace, setOpenCodeVariantByThreadId, setPrefillDraft, setReduceTransparency, setRightPanelWidth,
    setSearchContentFilters, setSearchPaletteQuery, setSearchPaletteSelectedIndex, setSearchScope, setSelectedAgent, setSelectedCollaborationModeId, setSelectedCommitSha, setSelectedComposerKanbanPanelId,
    setSelectedDiffPath, setSelectedEffort, setSelectedKanbanTaskId, setSelectedModelId, setSelectedPullRequest, setWorkspaceHomeWorkspaceId, settingsHighlightTarget, settingsOpen,
    settingsSection, shouldForceResumeInCode, shouldImplementPlan, shouldLoadDiffs, shouldLoadGitHubPanelData, shouldMountSpecHub, shouldShowSidebarTopbarContent, showComposer,
    showDebugButton, showGitDetail, showGitHistory, showHome, showKanban, showNextReleaseNotes, showPresetStep, showPreviousReleaseNotes,
    showSpecHub, showWorkspaceHome, sidebarCollapsed, sidebarToggleProps, sidebarWidth, skills, slashToken, snapshot,
    soloModeEnabled, startExport, startFast, startFork, startHeight, startImport, startLsp, startMcp,
    startMode, startResume, startReview, startShare, startSpecRoot, startStatus, startThreadForWorkspace, startUpdate,
    startY, stored, syncError, syncLoading, t, tabletTab, target,
    targetThread, targetWorkspaceIds, task, taskProcessingMap, taskWs, terminalOpen, terminalPanelHeight, terminalState,
    terminalTabs, textareaHeight, threadAccessMode, threadChanged, threadId, threadItemsByThread, threadListCursorByWorkspace, threadListLoadingByWorkspace,
    threadListPagingByWorkspace, threadMode, threadParentById, threadStatusById, threads, threadsByWorkspace, timelinePlan, title,
    toggleSoloMode, tokenUsageByThread, triggerAutoThreadTitle, trimmed, uiMode, uncachedWorkspaceIds, ungroupedLabel, uniquePaths,
    unpinThread, updateCloneCopyName, updateCustomInstructions, updatePrompt, updateWorkspaceCodexBin, updateWorkspaceSettings, updateWorktreeBaseRef, updateWorktreeBranch,
    updateWorktreePublishToOrigin, updateWorktreeSetupScript, updatedAt, updaterState, useSuggestedCloneCopiesFolder, userInputRequests, validModel, viewportHeight,
    wasProcessing, workspace, workspaceActivity, workspaceDropTargetRef, workspaceFilesPollingEnabled, workspaceGroups, workspaceHomeWorkspaceId, workspaceId,
    workspaceNameByPath, workspacePath, workspaceSearchSources, workspaces, workspacesById, workspacesByPath, worktreeApplyError, worktreeApplyLoading,
    worktreeApplySuccess, worktreeCreateResult, worktreeLabel, worktreePrompt, worktreeRename, worktreeSetupScriptState,
    sessionRadarRunningSessions, sessionRadarRecentCompletedSessions, runningSessionCountByWorkspaceId, recentCompletedSessionCountByWorkspaceId,
  } = ctx;
  const enableMainFileExternalChangeMonitoring = Boolean(
    activeWorkspace &&
      activeEditorFilePath,
  );

  const {
    sidebarNode,
    messagesNode,
    composerNode,
    approvalToastsNode,
    updateToastNode,
    errorToastsNode,
    homeNode,
    mainHeaderNode,
    desktopTopbarLeftNode,
    tabletNavNode,
    tabBarNode,
    rightPanelToolbarNode,
    gitDiffPanelNode,
    gitDiffViewerNode,
    fileViewPanelNode,
    planPanelNode,
    debugPanelNode,
    debugPanelFullNode,
    terminalDockNode,
    compactEmptyCodexNode,
    compactEmptySpecNode,
    compactEmptyGitNode,
    compactGitBackNode,
  } = useLayoutNodes({
    workspaces,
    groupedWorkspaces,
    hasWorkspaceGroups: workspaceGroups.length > 0,
    deletingWorktreeIds,
    threadsByWorkspace,
    threadParentById,
    threadStatusById,
    runningSessionCountByWorkspaceId,
    recentCompletedSessionCountByWorkspaceId,
    threadListLoadingByWorkspace,
    threadListPagingByWorkspace,
    threadListCursorByWorkspace,
    activeWorkspaceId,
    activeThreadId,
    isPhone,
    isTablet,
    systemProxyEnabled: appSettings.systemProxyEnabled,
    systemProxyUrl: appSettings.systemProxyUrl,
    activeItems,
    threadItemsByThread,
    sessionRadarRunningSessions,
    sessionRadarRecentCompletedSessions,
    activeRateLimits,
    usageShowRemaining: appSettings.usageShowRemaining,
    onRefreshAccountRateLimits: handleRefreshAccountRateLimits,
    showMessageAnchors: appSettings.showMessageAnchors,
    accountInfo: activeAccount,
    onSwitchAccount: handleSwitchAccount,
    onCancelSwitchAccount: handleCancelSwitchAccount,
    accountSwitching,
    codeBlockCopyUseModifier: appSettings.composerCodeBlockCopyUseModifier,
    openAppTargets: appSettings.openAppTargets,
    openAppIconById,
    selectedOpenAppId: appSettings.selectedOpenAppId,
    onSelectOpenAppId: handleSelectOpenAppId,
    approvals,
    userInputRequests,
    handleApprovalDecision,
    handleApprovalRemember,
    handleUserInputSubmit: handleUserInputSubmitWithPlanApply,
    onOpenSettings: () => openSettings(),
    onOpenAgentSettings: () => openSettings("agents"),
    onOpenPromptSettings: () => openSettings("prompts"),
    onOpenModelSettings: handleOpenModelSettings,
    onOpenDictationSettings: () => openSettings("dictation"),
    onOpenDebug: handleDebugClick,
    showDebugButton,
    onAddWorkspace: handleAddWorkspace,
    onSelectHome: () => {
      closeSettings();
      resetPullRequestSelection();
      setWorkspaceHomeWorkspaceId(null);
      selectHome();
    },
    onSelectWorkspace: (workspaceId) => {
      closeSettings();
      exitDiffView();
      resetPullRequestSelection();
      setWorkspaceHomeWorkspaceId(null);
      setCenterMode("chat");
      setActiveWorkspaceId(workspaceId);
      if (isCompact) {
        setActiveTab("codex");
      }
      ensureWorkspaceThreadListLoaded(workspaceId);
      setActiveThreadId(null, workspaceId);
    },
    onConnectWorkspace: async (workspace) => {
      await connectWorkspace(workspace);
      ensureWorkspaceThreadListLoaded(workspace.id, { force: true });
      if (isCompact) {
        setActiveTab("codex");
      }
    },
    onAddAgent: handleAddAgent,
    onAddWorktreeAgent: handleAddWorktreeAgent,
    onAddCloneAgent: handleAddCloneAgent,
    onToggleWorkspaceCollapse: (workspaceId, collapsed) => {
      const target = workspacesById.get(workspaceId);
      if (!target) {
        return;
      }
      void updateWorkspaceSettings(workspaceId, {
        sidebarCollapsed: collapsed,
      }).then(() => {
        if (!collapsed) {
          ensureWorkspaceThreadListLoaded(workspaceId);
        }
      });
    },
    onSelectThread: (workspaceId, threadId) => {
      closeSettings();
      exitDiffView();
      resetPullRequestSelection();
      setWorkspaceHomeWorkspaceId(null);
      setCenterMode("chat");
      setAppMode("chat");
      setActiveTab("codex");
      selectWorkspace(workspaceId);
      setActiveThreadId(threadId, workspaceId);
      // Auto-switch engine based on thread's engineSource
      const threads = threadsByWorkspace[workspaceId] ?? [];
      const thread = threads.find((t) => t.id === threadId);
      if (thread?.engineSource) {
        setActiveEngine(thread.engineSource);
      }
    },
    onDeleteThread: async (workspaceId, threadId) => {
      openDeleteThreadPrompt(workspaceId, threadId);
    },
    deleteConfirmThreadId: deleteThreadPrompt?.threadId ?? null,
    deleteConfirmWorkspaceId: deleteThreadPrompt?.workspaceId ?? null,
    deleteConfirmBusy: isDeleteThreadPromptBusy,
    onCancelDeleteConfirm: handleDeleteThreadPromptCancel,
    onConfirmDeleteConfirm: () => {
      void handleDeleteThreadPromptConfirm();
    },
    onSyncThread: (workspaceId, threadId) => {
      void refreshThread(workspaceId, threadId);
    },
    pinThread,
    unpinThread,
    isThreadPinned,
    getPinTimestamp,
    pinnedThreadsVersion,
    isThreadAutoNaming,
    onRenameThread: (workspaceId, threadId) => {
      handleRenameThread(workspaceId, threadId);
    },
    onAutoNameThread: (workspaceId, threadId) => {
      addDebugEntry({
        id: `${Date.now()}-thread-title-manual-trigger`,
        timestamp: Date.now(),
        source: "client",
        label: "thread/title manual trigger",
        payload: { workspaceId, threadId },
      });
      void triggerAutoThreadTitle(workspaceId, threadId, { force: true }).then(
        (title) => {
          if (!title) {
            addDebugEntry({
              id: `${Date.now()}-thread-title-manual-empty`,
              timestamp: Date.now(),
              source: "client",
              label: "thread/title manual skipped",
              payload: { workspaceId, threadId },
            });
            return;
          }
          addDebugEntry({
            id: `${Date.now()}-thread-title-manual-success`,
            timestamp: Date.now(),
            source: "server",
            label: "thread/title manual generated",
            payload: { workspaceId, threadId, title },
          });
        },
      ).catch((error) => {
        addDebugEntry({
          id: `${Date.now()}-thread-title-manual-error`,
          timestamp: Date.now(),
          source: "error",
          label: "thread/title manual error",
          payload: error instanceof Error ? error.message : String(error),
        });
      });
    },
    onDeleteWorkspace: (workspaceId) => {
      void removeWorkspace(workspaceId);
    },
    onDeleteWorktree: (workspaceId) => {
      void removeWorktree(workspaceId);
    },
    onLoadOlderThreads: (workspaceId) => {
      const workspace = workspacesById.get(workspaceId);
      if (!workspace) {
        return;
      }
      void loadOlderThreadsForWorkspace(workspace);
    },
    onReloadWorkspaceThreads: async (workspaceId) => {
      const workspace = workspacesById.get(workspaceId);
      if (!workspace) {
        return;
      }
      const workspaceName = workspace.name || t("workspace.noWorkspaceSelected");
      const detailLines = [
        t("workspace.reloadWorkspaceThreadsEffectRefresh"),
        t("workspace.reloadWorkspaceThreadsEffectDisplayOnly"),
        t("workspace.reloadWorkspaceThreadsEffectNoDelete"),
        t("workspace.reloadWorkspaceThreadsEffectNoGitWrite"),
      ];
      const confirmed = await ask(
        `${t("workspace.reloadWorkspaceThreadsConfirm", { name: workspaceName })}\n\n${t("workspace.reloadWorkspaceThreadsBeforeYouConfirm")}\n${detailLines.map((line) => `• ${line}`).join("\n")}`,
        {
          title: t("workspace.reloadWorkspaceThreadsTitle"),
          kind: "warning",
          okLabel: t("threads.reloadThreads"),
          cancelLabel: t("common.cancel"),
        },
      );
      if (!confirmed) {
        return;
      }
      void listThreadsForWorkspaceTracked(workspace);
    },
    updaterState,
    onUpdate: startUpdate,
    onDismissUpdate: dismissUpdate,
    errorToasts,
    onDismissErrorToast: dismissErrorToast,
    latestAgentRuns,
    isLoadingLatestAgents,
    onSelectHomeThread: handleSelectWorkspaceInstance,
    onOpenSpecHub: handleOpenSpecHub,
    activeWorkspace,
    activeParentWorkspace,
    worktreeLabel,
    worktreeRename: worktreeRename ?? undefined,
    isWorktreeWorkspace,
    branchName: gitStatus.branchName || "unknown",
    branches,
    onCheckoutBranch: handleCheckoutBranch,
    onCreateBranch: handleCreateBranch,
    onCopyThread: handleCopyThread,
    onLockPanel: handleLockPanel,
    onToggleTerminal: handleToggleTerminalPanel,
    showTerminalButton: !isCompact,
    launchScript: launchScriptState.launchScript,
    launchScriptEditorOpen: launchScriptState.editorOpen,
    launchScriptDraft: launchScriptState.draftScript,
    launchScriptSaving: launchScriptState.isSaving,
    launchScriptError: launchScriptState.error,
    onRunLaunchScript: launchScriptState.onRunLaunchScript,
    onOpenLaunchScriptEditor: launchScriptState.onOpenEditor,
    onCloseLaunchScriptEditor: launchScriptState.onCloseEditor,
    onLaunchScriptDraftChange: launchScriptState.onDraftScriptChange,
    onSaveLaunchScript: launchScriptState.onSaveLaunchScript,
    launchScriptsState,
    mainHeaderActionsNode: (
      <MainHeaderActions
        isCompact={isCompact}
        rightPanelCollapsed={rightPanelCollapsed}
        sidebarToggleProps={sidebarToggleProps}
        showRuntimeConsoleButton={!isCompact}
        isRuntimeConsoleVisible={runtimeRunState.runtimeConsoleVisible}
        onToggleRuntimeConsole={handleToggleRuntimeConsole}
        showTerminalButton={!isCompact}
        isTerminalOpen={terminalOpen}
        onToggleTerminal={handleToggleTerminalPanel}
        showSoloButton={soloModeEnabled}
        isSoloMode={isSoloMode}
        onToggleSoloMode={toggleSoloMode}
      />
    ),
    filePanelMode,
    onFilePanelModeChange: setFilePanelMode,
    liveEditPreviewEnabled,
    onToggleLiveEditPreview: () => {
      setLiveEditPreviewEnabled((current) => !current);
    },
    fileTreeLoading: isFilesLoading,
    onRefreshFiles: refreshFiles,
    onOpenDetachedFileExplorer: handleOpenDetachedFileExplorer,
    onToggleRuntimeConsole: handleToggleRuntimeConsole,
    runtimeConsoleVisible: runtimeRunState.runtimeConsoleVisible,
    centerMode,
    editorSplitLayout,
    onToggleEditorSplitLayout: () =>
      setEditorSplitLayout((prev) => (prev === "vertical" ? "horizontal" : "vertical")),
    isEditorFileMaximized,
    onToggleEditorFileMaximized: () =>
      setIsEditorFileMaximized((prev) => !prev),
    editorFilePath: activeEditorFilePath,
    editorNavigationTarget,
    editorHighlightTarget,
    openEditorTabs: openFileTabs,
    onActivateEditorTab: handleActivateWorkspaceFileTab,
    onCloseEditorTab: handleCloseWorkspaceFileTab,
    onCloseAllEditorTabs: handleCloseAllWorkspaceFileTabs,
    onActiveEditorLineRangeChange: setActiveEditorLineRange,
    onOpenFile: handleOpenWorkspaceFile,
    externalChangeMonitoringEnabled: enableMainFileExternalChangeMonitoring,
    externalChangeTransportMode: "polling",
    onExitEditor: handleExitWorkspaceEditor,
    onExitDiff: () => {
      setCenterMode("chat");
      handleSelectDiffForPanel(null);
    },
    activeTab,
    onSelectTab: setActiveTab,
    tabletNavTab: tabletTab,
    gitPanelMode,
    onGitPanelModeChange: handleGitPanelModeChange,
    onOpenGitHistoryPanel: () => {
      setAppMode((current) => (current === "gitHistory" ? "chat" : "gitHistory"));
    },
    gitDiffViewStyle,
    gitDiffListView,
    onGitDiffListViewChange: setGitDiffListView,
    worktreeApplyLabel: t("git.applyWorktreeChangesAction"),
    worktreeApplyTitle: activeParentWorkspace?.name
      ? t("git.applyWorktreeChanges") + ` ${activeParentWorkspace.name}`
      : t("git.applyWorktreeChanges"),
    worktreeApplyLoading: isWorktreeWorkspace ? worktreeApplyLoading : false,
    worktreeApplyError: isWorktreeWorkspace ? worktreeApplyError : null,
    worktreeApplySuccess: isWorktreeWorkspace ? worktreeApplySuccess : false,
    onApplyWorktreeChanges: isWorktreeWorkspace
      ? handleApplyWorktreeChanges
      : undefined,
    gitStatus,
    fileStatus,
    selectedDiffPath,
    diffScrollRequestId,
    onSelectDiff: handleSelectDiffForPanel,
    gitLogEntries,
    gitLogTotal,
    gitLogAhead,
    gitLogBehind,
    gitLogAheadEntries,
    gitLogBehindEntries,
    gitLogUpstream,
    gitLogError,
    gitLogLoading,
    selectedCommitSha,
    gitIssues,
    gitIssuesTotal,
    gitIssuesLoading,
    gitIssuesError,
    gitPullRequests,
    gitPullRequestsTotal,
    gitPullRequestsLoading,
    gitPullRequestsError,
    selectedPullRequestNumber: selectedPullRequest?.number ?? null,
    selectedPullRequest: diffSource === "pr" ? selectedPullRequest : null,
    selectedPullRequestComments: diffSource === "pr" ? gitPullRequestComments : [],
    selectedPullRequestCommentsLoading: gitPullRequestCommentsLoading,
    selectedPullRequestCommentsError: gitPullRequestCommentsError,
    onSelectPullRequest: (pullRequest) => {
      setSelectedCommitSha(null);
      handleSelectPullRequest(pullRequest);
    },
    onSelectCommit: (entry) => {
      handleSelectCommit(entry.sha);
    },
    gitRemoteUrl,
    gitRoot: activeGitRoot,
    gitRootCandidates,
    gitRootScanDepth,
    gitRootScanLoading,
    gitRootScanError,
    gitRootScanHasScanned,
    onGitRootScanDepthChange: setGitRootScanDepth,
    onScanGitRoots: scanGitRoots,
    onSelectGitRoot: (path) => {
      void handleSetGitRoot(path);
    },
    onClearGitRoot: () => {
      void handleSetGitRoot(null);
    },
    onPickGitRoot: handlePickGitRoot,
    onStageGitAll: handleStageGitAll,
    onStageGitFile: handleStageGitFile,
    onUnstageGitFile: handleUnstageGitFile,
    onRevertGitFile: handleRevertGitFile,
    onRevertAllGitChanges: handleRevertAllGitChanges,
    gitDiffs: activeDiffs,
    gitDiffLoading: activeDiffLoading,
    gitDiffError: activeDiffError,
    onDiffActivePathChange: handleActiveDiffPath,
    onGitDiffViewStyleChange: setGitDiffViewStyle,
    commitMessage,
    commitMessageLoading,
    commitMessageError,
    onCommitMessageChange: handleCommitMessageChange,
    onGenerateCommitMessage: handleGenerateCommitMessage,
    onCommit: handleCommit,
    onCommitAndPush: handleCommitAndPush,
    onCommitAndSync: handleCommitAndSync,
    onPush: handlePush,
    onSync: handleSync,
    commitLoading,
    pushLoading,
    syncLoading,
    commitError,
    pushError,
    syncError,
    commitsAhead: gitLogAhead,
    onSendPrompt: handleSendPrompt,
    onSendPromptToNewAgent: handleSendPromptToNewAgent,
    onCreatePrompt: handleCreatePrompt,
    onUpdatePrompt: handleUpdatePrompt,
    onDeletePrompt: handleDeletePrompt,
    onMovePrompt: handleMovePrompt,
    onRevealWorkspacePrompts: handleRevealWorkspacePrompts,
    onRevealGeneralPrompts: handleRevealGeneralPrompts,
    canRevealGeneralPrompts: Boolean(activeWorkspace),
    onSend: handleComposerSendWithEditorFallback,
    onQueue: handleComposerQueueWithEditorFallback,
    onStop: interruptTurn,
    onRewind: handleRewindFromMessage,
    canStop: canInterrupt,
    isReviewing,
    isProcessing,
    steerEnabled: appSettings.experimentalSteerEnabled,
    reviewPrompt,
    onReviewPromptClose: closeReviewPrompt,
    onReviewPromptShowPreset: showPresetStep,
    onReviewPromptChoosePreset: choosePreset,
    highlightedPresetIndex,
    onReviewPromptHighlightPreset: setHighlightedPresetIndex,
    highlightedBranchIndex,
    onReviewPromptHighlightBranch: setHighlightedBranchIndex,
    highlightedCommitIndex,
    onReviewPromptHighlightCommit: setHighlightedCommitIndex,
    onReviewPromptKeyDown: handleReviewPromptKeyDown,
    onReviewPromptSelectBranch: selectBranch,
    onReviewPromptSelectBranchAtIndex: selectBranchAtIndex,
    onReviewPromptConfirmBranch: confirmBranch,
    onReviewPromptSelectCommit: selectCommit,
    onReviewPromptSelectCommitAtIndex: selectCommitAtIndex,
    onReviewPromptConfirmCommit: confirmCommit,
    onReviewPromptUpdateCustomInstructions: updateCustomInstructions,
    onReviewPromptConfirmCustom: confirmCustom,
    activeTokenUsage,
    contextDualViewEnabled: activeEngine === "codex",
    activeQueue,
    draftText: activeDraft,
    onDraftChange: handleDraftChange,
    activeImages,
    onPickImages: pickImages,
    onAttachImages: attachImages,
    onRemoveImage: removeImage,
    prefillDraft,
    onPrefillHandled: (id) => {
      if (prefillDraft?.id === id) {
        setPrefillDraft(null);
      }
    },
    insertText: composerInsert,
    onInsertHandled: (id) => {
      if (composerInsert?.id === id) {
        setComposerInsert(null);
      }
    },
    onEditQueued: handleEditQueued,
    onDeleteQueued: handleDeleteQueued,
    onFuseQueued: handleFuseQueued,
    canFuseActiveQueue,
    activeFusingMessageId,
    collaborationModes,
    collaborationModesEnabled,
    selectedCollaborationModeId,
    onSelectCollaborationMode: applySelectedCollaborationMode,
    engines: installedEngines,
    selectedEngine: activeEngine,
    usePresentationProfile: appSettings.chatCanvasUsePresentationProfile,
    onSelectEngine: setActiveEngine,
    models: effectiveModels,
    selectedModelId: effectiveSelectedModelId,
    onSelectModel: handleSelectModel,
    reasoningOptions,
    selectedEffort,
    onSelectEffort: setSelectedEffort,
    reasoningSupported: effectiveReasoningSupported,
    opencodeAgents: openCodeAgents,
    selectedOpenCodeAgent,
    onSelectOpenCodeAgent: handleSelectOpenCodeAgent,
    selectedAgent,
    onSelectAgent: handleSelectAgent,
    opencodeVariantOptions: OPENCODE_VARIANT_OPTIONS,
    selectedOpenCodeVariant,
    onSelectOpenCodeVariant: handleSelectOpenCodeVariant,
    accessMode,
    onSelectAccessMode: handleSetAccessMode,
    skills,
    prompts,
    commands,
    files,
    directories,
    gitignoredFiles,
    gitignoredDirectories,
    onInsertComposerText: handleInsertComposerText,
    textareaRef: composerInputRef,
    composerEditorSettings,
    composerSendShortcut: appSettings.composerSendShortcut,
    textareaHeight,
    onTextareaHeightChange,
    dictationEnabled: appSettings.dictationEnabled && dictationReady,
    dictationState,
    dictationLevel,
    onToggleDictation: handleToggleDictation,
    dictationTranscript,
    onDictationTranscriptHandled: (id) => {
      clearDictationTranscript(id);
    },
    dictationError,
    onDismissDictationError: clearDictationError,
    dictationHint,
    onDismissDictationHint: clearDictationHint,
    onOpenExperimentalSettings: () =>
      openSettings("experimental", "experimental-collaboration-modes"),
    composerSendLabel,
    composerLinkedKanbanPanels,
    selectedComposerKanbanPanelId,
    composerKanbanContextMode,
    onSelectComposerKanbanPanel: setSelectedComposerKanbanPanelId,
    onComposerKanbanContextModeChange: setComposerKanbanContextMode,
    onOpenComposerKanbanPanel: handleOpenComposerKanbanPanel,
    activeComposerFilePath: activeEditorFilePath,
    activeComposerFileLineRange: activeEditorLineRange,
    fileReferenceMode,
    onFileReferenceModeChange: setFileReferenceMode,
    showComposer,
    plan: activePlan,
    isPlanMode,
    onOpenPlanPanel: openPlanPanel,
    onClosePlanPanel: closePlanPanel,
    bottomStatusPanelExpanded: !isPlanPanelDismissed,
    agentTaskScrollRequest,
    onSelectSubagent: handleSelectStatusPanelSubagent,
    debugEntries,
    debugOpen,
    terminalOpen,
    terminalTabs,
    activeTerminalId,
    onSelectTerminal,
    onNewTerminal,
    onCloseTerminal,
    terminalState,
    onClearDebug: clearDebugEntries,
    onCopyDebug: handleCopyDebug,
    onResizeDebug: onDebugPanelResizeStart,
    onResizeTerminal: onTerminalPanelResizeStart,
    onBackFromDiff: () => {
      setSelectedDiffPath(null);
      setCenterMode("chat");
    },
    onGoProjects: () => setActiveTab("projects"),
    workspaceDropTargetRef,
    isWorkspaceDropActive: dropOverlayActive,
    workspaceDropText: dropOverlayText,
    onWorkspaceDragOver: handleWorkspaceDragOver,
    onWorkspaceDragEnter: handleWorkspaceDragEnter,
    onWorkspaceDragLeave: handleWorkspaceDragLeave,
    onWorkspaceDrop: handleWorkspaceDrop,
    appMode,
    onAppModeChange: handleAppModeChange,
    onOpenHomeChat: handleOpenHomeChat,
    onOpenMemory: () => {
      closeSettings();
      setAppMode("chat");
      setCenterMode("memory");
    },
    onOpenProjectMemory: () => {
      closeSettings();
      setAppMode("chat");
      setCenterMode("chat");
      setFilePanelMode("memory");
      expandRightPanel();
      if (isCompact) {
        setActiveTab("git");
      }
    },
    onOpenReleaseNotes: () => {
      void openReleaseNotes();
    },
    onOpenGlobalSearch: handleOpenSearchPalette,
    globalSearchShortcut: appSettings.toggleGlobalSearchShortcut,
    onOpenWorkspaceHome: handleOpenWorkspaceHome,
  });



  return {
    sidebarNode, messagesNode, composerNode, approvalToastsNode, updateToastNode, errorToastsNode, homeNode, mainHeaderNode,
    desktopTopbarLeftNode, tabletNavNode, tabBarNode, rightPanelToolbarNode, gitDiffPanelNode, gitDiffViewerNode, fileViewPanelNode, planPanelNode,
    debugPanelNode, debugPanelFullNode, terminalDockNode, compactEmptyCodexNode, compactEmptySpecNode, compactEmptyGitNode, compactGitBackNode,
  };
}
