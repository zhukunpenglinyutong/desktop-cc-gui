// @ts-nocheck
import { useGlobalSearchShortcut } from "../features/app/hooks/useGlobalSearchShortcut";
import { useInterruptShortcut } from "../features/app/hooks/useInterruptShortcut";
import { usePullRequestComposer } from "../features/git/hooks/usePullRequestComposer";
import { recordSearchResultOpen } from "../features/search/ranking/recencyStore";
import { resolveSearchScopeOnOpen } from "../features/search/utils/scope";
import { toggleSearchContentFilters } from "../features/search/utils/contentFilters";

export function useAppShellSearchAndComposerSection(ctx: any) {
  const {
    GitHubPanelData, RECENT_THREAD_LIMIT, SettingsView, accessMode, accountByWorkspace, accountSwitching, activeAccount, activeDiffError,
    activeDiffLoading, activeDiffs, activeDraft, activeEditorFilePath, activeEditorLineRange, activeEngine, activeGitRoot, activeImages,
    activeItems, activeParentWorkspace, activePath, activePlan, activeQueue, activeRateLimits, activeRenamePrompt, activeTab,
    activeTerminalId, activeThreadId, activeThreadIdForModeRef, activeThreadIdRef, activeTokenUsage, activeWorkspace, activeWorkspaceId, activeWorkspaceIdRef,
    activeWorkspaceKanbanTasks, activeWorkspaceRef, activeWorkspaceThreads, addCloneAgent, addDebugEntry, addWorkspace, addWorkspaceFromPath, addWorktreeAgent,
    agent, alertError, appMode, appRoot, appRootRef, appSettings, appSettingsLoading, applySelectedCollaborationMode,
    approvals, assignWorkspaceGroup, attachImages, baseWorkspaceRef, branches, canInterrupt, cancelClonePrompt, cancelWorktreePrompt,
    cancelled, centerMode, checkoutBranch, chooseCloneCopiesFolder, choosePreset, claudeAccessModeRef, clearActiveImages, clearCloneCopiesFolder,
    clearDebugEntries, clearDictationError, clearDictationHint, clearDictationTranscript, clearDraftForThread, clearGitRootCandidates, clonePrompt, closePlanPanel,
    closeReleaseNotes, closeReviewPrompt, closeSettings, closeTerminalPanel, closeWorktreeCreateResult, codexComposerModeRef, collaborationModePayload, collaborationModes,
    collaborationModesEnabled, collaborationRuntimeModeByThread, collaborationUiModeByThread, collapseRightPanel, collapseSidebar, commands, commitError, commitLoading,
    commitMessage, commitMessageError, commitMessageLoading, completionTrackerBySessionRef, completionTrackerReadyRef, composerEditorSettings, composerInputRef, composerInsert,
    confirmBranch, confirmClonePrompt, confirmCommit, confirmCustom, confirmRenameWorktreeUpstream, confirmWorktreePrompt, connectWorkspace, createBranch,
    createPrompt, createWorkspaceGroup, debugEntries, debugOpen, debugPanelHeight, defaultModel, deletePrompt, deleteThreadPrompt,
    deleteWorkspaceGroup, deletingWorktreeIds, delta, dictationError, dictationHint, dictationLevel, dictationModel, dictationReady,
    dictationState, dictationTranscript, diffScrollRequestId, diffSource, directories, dismissErrorToast, dismissUpdate, doctor,
    dragHandle, editorHighlightTarget, editorNavigationTarget, editorSplitLayout, effectiveModels, effectiveReasoningSupported, effectiveRuntimeMode, effectiveSelectedModel,
    effectiveSelectedModelId, effectiveUiMode, engineModelsAsOptions, engineSelectedModelIdByType, engineSelection, engineStatuses, ensureLaunchTerminal, ensureTerminalWithTitle,
    ensureWorkspaceThreadListLoaded, entry, errorToasts, existing, exitDiffView, expandRightPanel, expandSidebar, filePanelMode,
    filePassword, fileReferenceMode, fileStatus, files, finishedByAgentUpdate, finishedByDuration, firstAnswer, flushDraggedHeight,
    force, forkThreadForWorkspace, getGlobalPromptsDir, getPinTimestamp, getThreadRows, getWorkspaceGroupName, getWorkspacePromptsDir, gitCommitDiffs,
    gitDiffListView, gitDiffViewStyle, gitHistoryPanelHeight, gitHistoryPanelHeightRef, gitIssues, gitIssuesError, gitIssuesLoading, gitIssuesTotal,
    gitLogAhead, gitLogAheadEntries, gitLogBehind, gitLogBehindEntries, gitLogEntries, gitLogError, gitLogLoading, gitLogTotal,
    gitLogUpstream, gitPanelMode, gitPullRequestComments, gitPullRequestCommentsError, gitPullRequestCommentsLoading, gitPullRequestDiffs, gitPullRequestDiffsError, gitPullRequestDiffsLoading,
    gitPullRequests, gitPullRequestsError, gitPullRequestsLoading, gitPullRequestsTotal, gitRemoteUrl, gitRootCandidates, gitRootScanDepth, gitRootScanError,
    gitRootScanHasScanned, gitRootScanLoading, gitStatus, gitignoredDirectories, gitignoredFiles, globalSearchFilesByWorkspace, group, groupId,
    groupedWorkspaces, handleActivateFileTab, handleActiveDiffPath, handleAddAgent, handleAddCloneAgent, handleAddWorkspace, handleAddWorkspaceFromPath, handleAddWorktreeAgent,
    handleAppModeChange, handleApplyWorktreeChanges, handleApprovalDecision, handleApprovalRemember, handleArchiveActiveThread, handleCancelSwitchAccount, handleCheckoutBranch, handleCloseAllFileTabs,
    handleCloseFileTab, handleCollaborationModeResolved, handleCommit, handleCommitAndPush, handleCommitAndSync, handleCommitMessageChange, handleCopyDebug, handleCopyThread,
    handleCreateBranch, handleCreatePrompt, handleDebugClick, handleDeletePrompt, handleDeleteQueued, handleDeleteThreadPromptCancel, handleDeleteThreadPromptConfirm, handleDraftChange,
    handleDropWorkspacePaths, handleEditQueued, handleEnsureWorkspaceThreadsForSettings, handleExitEditor, handleGenerateCommitMessage, handleGitIssuesChange, handleGitPanelModeChange, handleGitPullRequestCommentsChange,
    handleGitPullRequestDiffsChange, handleGitPullRequestsChange, handleInsertComposerText, handleLockPanel, handleMovePrompt, handleOpenFile, handleOpenModelSettings, handleOpenRenameWorktree,
    handlePickGitRoot, handlePointerMove, handlePointerUp, handlePush, handleRenamePromptCancel, handleRenamePromptChange, handleRenamePromptConfirm, handleRenameThread,
    handleRenameWorktreeCancel, handleRenameWorktreeChange, handleRenameWorktreeConfirm, handleResize, handleRevealGeneralPrompts, handleRevealWorkspacePrompts, handleRevertAllGitChanges, handleRevertGitFile,
    handleReviewPromptKeyDown, handleSelectAgent, handleSelectCommit, handleSelectDiff, handleSelectModel, handleSelectOpenAppId, handleSelectOpenCodeAgent, handleSelectOpenCodeVariant,
    handleSend, handleSendPrompt, handleSendPromptToNewAgent, handleSetAccessMode, handleSetGitRoot, handleStageGitAll, handleStageGitFile, handleSwitchAccount,
    handleSync, handleTestNotificationSound, handleToggleDictation, handleToggleRuntimeConsole, handleToggleTerminal, handleToggleTerminalPanel, handleUnlockPanel, handleUnstageGitFile,
    handleUpdatePrompt, handleUserInputSubmit, handleUserInputSubmitWithPlanApply, handleWorkspaceDragEnter, handleWorkspaceDragLeave, handleWorkspaceDragOver, handleWorkspaceDrop, handleWorktreeCreated,
    hasActivePlan, hasLoaded, hasPlanData, highlightedBranchIndex, highlightedCommitIndex, highlightedPresetIndex, historySearchItems, hydratedThreadListWorkspaceIdsRef,
    installedEngines, interruptTurn, isCompact, isDeleteThreadPromptBusy, isEditorFileMaximized, isFilesLoading, isLoadingLatestAgents, isMacDesktop,
    isPanelLocked, isPhone, isPlanMode, isPlanPanelDismissed, isProcessing, isProcessingNow, isReviewing, isSearchPaletteOpen,
    isTablet, isThreadAutoNaming, isThreadPinned, isValid, isWindowsDesktop, isWorkspaceDropActive, isWorktreeWorkspace, kanbanConversationWidth,
    kanbanCreatePanel, kanbanCreateTask, kanbanDeletePanel, kanbanDeleteTask, kanbanPanels, kanbanReorderTask, kanbanTasks, kanbanUpdatePanel,
    kanbanUpdateTask, kanbanViewState, key, label, lastAgent, lastAgentMessageByThread, lastAgentTimestamp, lastCodexModeSyncThreadRef,
    lastDurationMs, lastFrameAt, latestAgentRuns, latestClampedHeight, latestRawHeight, latestSnippet, launchScriptState, launchScriptsState,
    listThreadsForWorkspace, listThreadsForWorkspaceTracked, liveEditPreviewEnabled, loadOlderThreadsForWorkspace, lockLiveSessions, main, mainWidth, mappedMode,
    markWorkspaceConnected, maxHeight, minHeight, models, monitor, movePrompt, moveWorkspaceGroup, navigateToThread,
    next, nextDefault, nextFiles, nextHeight, nextSettings, normalizePath, normalized, onCloseTerminal,
    onDebugPanelResizeStart, onGitHistoryPanelResizeStart, onKanbanConversationResizeStart, onNewTerminal, onPlanPanelResizeStart, onRightPanelResizeStart, onSelectTerminal, onSidebarResizeStart,
    onTerminalPanelResizeStart, onTextareaHeightChange, openAppIconById, openClonePrompt, openCodeAgentByThreadId, openCodeAgents, openCodeDefaultAgentByWorkspace, openCodeDefaultVariantByWorkspace,
    openCodeVariantByThreadId, openDeleteThreadPrompt, openFileTabs, openPlanPanel, openReleaseNotes, openRenamePrompt, openRenameWorktreePrompt, openSettings,
    openTerminal, openWorktreePrompt, path, payload, perfSnapshotRef, persistProjectCopiesFolder, pickImages, pinThread,
    pinnedThreadsVersion, planByThread, planPanelHeight, pointerId, prefillDraft, prevFiles, previous, previousAgentTimestamp,
    previousDurationMs, previousThreadIdRef, previousTracker, prompts, pushError, pushLoading, queueGitStatusRefresh, queueMessage,
    queueSaveSettings, rafId, rateLimitsByWorkspace, reasoningOptions, reasoningSupported, recentThreads, reduceTransparency, refreshAccountInfo,
    refreshAccountRateLimits, refreshFiles, refreshGitDiffs, refreshGitLog, refreshGitStatus, refreshThread, refreshWorkspaces, releaseNotesActiveIndex,
    releaseNotesEntries, releaseNotesError, releaseNotesLoading, releaseNotesOpen, reloadSelectedAgent, removeImage, removeImagesForThread, removeThread,
    removeWorkspace, removeWorktree, renamePrompt, renameThread, renameWorkspaceGroup, renameWorktree, renameWorktreeNotice, renameWorktreePrompt,
    renameWorktreeUpstream, renameWorktreeUpstreamPrompt, requestId, requestThreadId, resetGitHubPanelState, resetSoloSplitToHalf, resetWorkspaceThreads, resolveCloneProjectContext,
    resolveCollaborationRuntimeMode, resolveCollaborationUiMode, resolveOpenCodeAgentForThread, resolveOpenCodeVariantForThread, resolvedEffort, resolvedModel, response, restartTerminalSession,
    result, resumePrompt, retryReleaseNotesLoad, reviewPrompt, rightPanelCollapsed, rightPanelWidth, runtimeMode, runtimeRunState,
    scaleShortcutText, scaleShortcutTitle, scanGitRoots, scheduleDraggedHeightFlush, scopedKanbanTasks, searchContentFilters, searchPaletteQuery, searchPaletteSelectedIndex,
    searchResults, searchScope, selectBranch, selectBranchAtIndex, selectCommit, selectCommitAtIndex, selectHome, selectWorkspace,
    selected, selectedAgent, selectedAnswer, selectedCollaborationMode, selectedCollaborationModeId, selectedCommitSha, selectedDiffPath, selectedEffort,
    selectedKanbanTaskId, selectedModelId, selectedOpenCodeAgent, selectedOpenCodeVariant, selectedPath, selectedPullRequest, selection, sendUserMessage,
    sendUserMessageToThread, sessions, setAccessMode, setActiveEditorLineRange, setActiveEngine, setActiveTab, setActiveThreadId, setActiveWorkspaceId,
    setAppMode, setAppSettings, setCenterMode, setCodexCollaborationMode, setCollaborationRuntimeModeByThread, setCollaborationUiModeByThread, setComposerInsert, setDebugOpen,
    setDiffSource, setEditorSplitLayout, setEngineSelectedModelIdByType, setFilePanelMode, setFileReferenceMode, setGitDiffListView, setGitDiffViewStyle, setGitHistoryPanelHeight,
    setGitPanelMode, setGitRootScanDepth, setGlobalSearchFilesByWorkspace, setHighlightedBranchIndex, setHighlightedCommitIndex, setHighlightedPresetIndex, setIsEditorFileMaximized, setIsPanelLocked,
    setIsPlanPanelDismissed, setIsSearchPaletteOpen, setKanbanViewState, setLiveEditPreviewEnabled, setOpenCodeAgentByThreadId, setOpenCodeAgents, setOpenCodeDefaultAgentByWorkspace, setOpenCodeDefaultVariantByWorkspace,
    setOpenCodeVariantByThreadId, setPrefillDraft, setReduceTransparency, setRightPanelWidth, setSearchContentFilters, setSearchPaletteQuery, setSearchPaletteSelectedIndex, setSearchScope,
    setSelectedAgent, setSelectedCollaborationModeId, setSelectedCommitSha, setSelectedDiffPath, setSelectedEffort, setSelectedKanbanTaskId, setSelectedModelId, setSelectedPullRequest,
    setWorkspaceHomeWorkspaceId, settingsHighlightTarget, settingsOpen, settingsSection, shouldForceResumeInCode, shouldImplementPlan, shouldLoadDiffs, shouldLoadGitHubPanelData,
    showDebugButton, showGitHistory, showHome, showKanban, showNextReleaseNotes, showPresetStep, showPreviousReleaseNotes, showWorkspaceHome,
    sidebarCollapsed, sidebarWidth, skills, snapshot, startExport, startFast, startFork, startHeight,
    startImport, startLsp, startMcp, startMode, startResume, startReview, startShare, startSpecRoot,
    startStatus, startThreadForWorkspace, startUpdate, startY, status, stored, syncError, syncLoading,
    t, tabletTab, target, targetThread, targetWorkspaceIds, terminalOpen, terminalPanelHeight, terminalState,
    terminalTabs, textareaHeight, threadAccessMode, threadChanged, threadId, threadItemsByThread, threadListCursorByWorkspace, threadListLoadingByWorkspace,
    threadListPagingByWorkspace, threadMode, threadParentById, threadStatusById, threads, threadsByWorkspace, timelinePlan, title,
    tokenUsageByThread, triggerAutoThreadTitle, trimmed, uiMode, uncachedWorkspaceIds, ungroupedLabel, uniquePaths, unpinThread,
    updateCloneCopyName, updateCustomInstructions, updatePrompt, updateWorkspaceCodexBin, updateWorkspaceSettings, updateWorktreeBaseRef, updateWorktreeBranch, updateWorktreePublishToOrigin,
    updateWorktreeSetupScript, updatedAt, updaterState, useSuggestedCloneCopiesFolder, userInputRequests, validModel, viewportHeight, wasProcessing,
    workspace, workspaceActivity, workspaceDropTargetRef, workspaceFilesPollingEnabled, workspaceGroups, workspaceHomeWorkspaceId, workspaceId, workspaceNameByPath,
    workspacePath, workspaceSearchSources, workspaces, workspacesById, workspacesByPath, worktreeApplyError, worktreeApplyLoading, worktreeApplySuccess,
    worktreeCreateResult, worktreeLabel, worktreePrompt, worktreeRename, worktreeSetupScriptState,
  } = ctx;

  const closeSearchPalette = useCallback(() => {
    setIsSearchPaletteOpen(false);
    setSearchPaletteQuery("");
    setSearchPaletteSelectedIndex(0);
  }, []);

  const handleOpenSearchPalette = useCallback(() => {
    const nextScope = resolveSearchScopeOnOpen(searchScope, activeWorkspaceId);
    if (nextScope !== searchScope) {
      setSearchScope(nextScope);
    }
    setIsSearchPaletteOpen(true);
    setSearchPaletteSelectedIndex(0);
  }, [activeWorkspaceId, searchScope]);

  const handleToggleSearchPalette = useCallback(() => {
    if (isSearchPaletteOpen) {
      closeSearchPalette();
      return;
    }
    handleOpenSearchPalette();
  }, [closeSearchPalette, handleOpenSearchPalette, isSearchPaletteOpen]);

  useGlobalSearchShortcut({
    isEnabled: true,
    shortcut: appSettings.toggleGlobalSearchShortcut,
    onTrigger: handleToggleSearchPalette,
  });

  useEffect(() => {
    if (!isSearchPaletteOpen) {
      return;
    }
    setSearchPaletteSelectedIndex(0);
  }, [isSearchPaletteOpen, searchPaletteQuery]);

  const handleSearchPaletteMoveSelection = useCallback(
    (direction: "up" | "down") => {
      if (!searchResults.length) {
        return;
      }
      setSearchPaletteSelectedIndex((prev) => {
        if (direction === "down") {
          return (prev + 1) % searchResults.length;
        }
        return (prev - 1 + searchResults.length) % searchResults.length;
      });
    },
    [searchResults.length],
  );

  const handleToggleSearchContentFilter = useCallback((nextFilter: SearchContentFilter) => {
    setSearchContentFilters((prev) => toggleSearchContentFilters(prev, nextFilter));
    setSearchPaletteSelectedIndex(0);
  }, []);

  const handleSelectSearchResult = useCallback(
    (result: SearchResult) => {
      switch (result.kind) {
        case "file":
          if (result.filePath) {
            handleOpenFile(result.filePath);
          }
          break;
        case "thread":
          if (result.workspaceId && result.threadId) {
            exitDiffView();
            setSelectedPullRequest(null);
            setSelectedCommitSha(null);
            setDiffSource("local");
            selectWorkspace(result.workspaceId);
            setActiveThreadId(result.threadId, result.workspaceId);
          }
          break;
        case "kanban":
          if (result.taskId) {
            const task = kanbanTasks.find((entry) => entry.id === result.taskId);
            if (task) {
              const taskWs = workspacesByPath.get(task.workspaceId);
              setAppMode("kanban");
              setSelectedKanbanTaskId(task.id);
              if (taskWs) selectWorkspace(taskWs.id);
              setKanbanViewState({
                view: "board",
                workspaceId: task.workspaceId,
                panelId: task.panelId,
              });
            }
          }
          break;
        case "history":
          if (result.historyText) {
            handleDraftChange(result.historyText);
            if (isCompact) {
              setActiveTab("codex");
            }
          }
          break;
        case "message":
          if (result.workspaceId && result.threadId) {
            exitDiffView();
            setSelectedPullRequest(null);
            setSelectedCommitSha(null);
            setDiffSource("local");
            selectWorkspace(result.workspaceId);
            setActiveThreadId(result.threadId, result.workspaceId);
            if (isCompact) {
              setActiveTab("codex");
            }
          }
          break;
        case "skill":
          if (result.skillName) {
            const slashToken = `/${result.skillName}`;
            const nextDraft = activeDraft.trim()
              ? `${activeDraft.trim()} ${slashToken} `
              : `${slashToken} `;
            handleDraftChange(nextDraft);
            if (isCompact) {
              setActiveTab("codex");
            }
          }
          break;
        case "command":
          if (result.commandName) {
            const slashToken = `/${result.commandName}`;
            const nextDraft = activeDraft.trim()
              ? `${activeDraft.trim()} ${slashToken} `
              : `${slashToken} `;
            handleDraftChange(nextDraft);
            if (isCompact) {
              setActiveTab("codex");
            }
          }
          break;
        default:
          break;
      }
      recordSearchResultOpen(result.id);
      closeSearchPalette();
    },
    [
      closeSearchPalette,
      exitDiffView,
      handleDraftChange,
      handleOpenFile,
      activeDraft,
      isCompact,
      kanbanTasks,
      workspacesByPath,
      selectWorkspace,
      setActiveTab,
      setAppMode,
      setDiffSource,
      setActiveThreadId,
      setKanbanViewState,
      setSelectedCommitSha,
      setSelectedPullRequest,
    ],
  );

  useInterruptShortcut({
    isEnabled: canInterrupt,
    shortcut: appSettings.interruptShortcut,
    onTrigger: () => {
      void interruptTurn();
    },
  });

  const {
    handleSelectPullRequest,
    resetPullRequestSelection,
    isPullRequestComposer,
    composerSendLabel,
    handleComposerSend,
    handleComposerQueue,
  } = usePullRequestComposer({
    activeWorkspace,
    selectedPullRequest,
    gitPullRequestDiffs,
    filePanelMode,
    gitPanelMode,
    centerMode,
    isCompact,
    setSelectedPullRequest,
    setDiffSource,
    setSelectedDiffPath,
    setCenterMode,
    setGitPanelMode,
    setPrefillDraft,
    setActiveTab,
    connectWorkspace,
    startThreadForWorkspace,
    sendUserMessageToThread,
    clearActiveImages,
    handleSend,
    queueMessage,
  });



  return {
    closeSearchPalette,
    handleOpenSearchPalette,
    handleToggleSearchPalette,
    handleSearchPaletteMoveSelection,
    handleToggleSearchContentFilter,
    handleSelectSearchResult,
    resetPullRequestSelection,
    isPullRequestComposer,
    composerSendLabel,
    handleComposerSend,
    handleComposerQueue,
  };
}
