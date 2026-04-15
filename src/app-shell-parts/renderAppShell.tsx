// @ts-nocheck
import { cloneElement, isValidElement, Suspense } from "react";
import type * as React from "react";
import { AppLayout } from "../features/app/components/AppLayout";
import { AppModals } from "../features/app/components/AppModals";
import { LockScreenOverlay } from "../features/app/components/LockScreenOverlay";
import { RuntimeConsoleDock } from "../features/app/components/RuntimeConsoleDock";
import { SidebarCollapseButton, TitlebarExpandControls } from "../features/layout/components/SidebarToggleControls";
import { KanbanView } from "../features/kanban/components/KanbanView";
import { GitHistoryPanel } from "../features/git-history/components/GitHistoryPanel";
import {
  shouldShowFloatingTitlebarSidebarToggle,
  shouldShowMainTopbarSidebarToggle,
  shouldShowSidebarTopbarSidebarToggle,
} from "../features/layout/utils/sidebarTogglePlacement";
import { WorkspaceHome } from "../features/workspaces/components/WorkspaceHome";
import { SpecHub } from "../features/spec/components/SpecHub";
import { SearchPalette } from "../features/search/components/SearchPalette";
import { ReleaseNotesModal } from "../features/update/components/ReleaseNotesModal";

export function renderAppShell(ctx: any) {
  const {
    GitHubPanelData, RECENT_THREAD_LIMIT, SettingsView, accessMode, accountByWorkspace, accountSwitching, activeAccount, activeDiffError,
    activeDiffLoading, activeDiffs, activeDraft, activeEditorFilePath, activeEditorLineRange, activeEngine, activeGitRoot, activeImages,
    activeItems, activeParentWorkspace, activePath, activePlan, activeQueue, activeRateLimits, activeRenamePrompt, activeTab,
    activeTerminalId, activeThreadId, activeThreadIdForModeRef, activeThreadIdRef, activeTokenUsage, activeWorkspace, activeWorkspaceId, activeWorkspaceIdRef,
    activeWorkspaceKanbanTasks, activeWorkspaceRef, activeWorkspaceThreads, addCloneAgent, addDebugEntry, addWorkspace, addWorkspaceFromPath, addWorktreeAgent,
    agent, alertError, appClassName, appMode, appRoot, appRootRef, appSettings, appSettingsLoading,
    applySelectedCollaborationMode, approvalToastsNode, approvals, assignWorkspaceGroup, attachImages, baseWorkspaceRef, branches, canInterrupt,
    cancelClonePrompt, cancelWorktreePrompt, cancelled, centerMode, checkoutBranch, chooseCloneCopiesFolder, choosePreset, claudeAccessModeRef,
    clearActiveImages, clearCloneCopiesFolder, clearDebugEntries, clearDictationError, clearDictationHint, clearDictationTranscript, clearDraftForThread, clearGitRootCandidates,
    clonePrompt, closePlanPanel, closeReleaseNotes, closeReviewPrompt, closeSearchPalette, closeSettings, closeTerminalPanel, closeWorktreeCreateResult,
    codexComposerModeRef, collaborationModePayload, collaborationModes, collaborationModesEnabled, collaborationRuntimeModeByThread, collaborationUiModeByThread, collapseRightPanel, collapseSidebar,
    commands, commitError, commitLoading, commitMessage, commitMessageError, commitMessageLoading, compactEmptyCodexNode, compactEmptyGitNode,
    compactEmptySpecNode, compactGitBackNode, completionTrackerBySessionRef, completionTrackerReadyRef, composerEditorSettings, composerInputRef, composerInsert, composerKanbanContextMode,
    composerLinkedKanbanPanels, composerNode, composerSendLabel, confirmBranch, confirmClonePrompt, confirmCommit, confirmCustom, confirmRenameWorktreeUpstream,
    confirmWorktreePrompt, connectWorkspace, createBranch, createPrompt, createWorkspaceGroup, debugEntries, debugOpen, debugPanelFullNode,
    debugPanelHeight, debugPanelNode, defaultModel, deletePrompt, deleteThreadPrompt, deleteWorkspaceGroup, deletingWorktreeIds, delta,
    desktopTopbarLeftNode, dictationError, dictationHint, dictationLevel, dictationModel, dictationReady, dictationState, dictationTranscript,
    diffScrollRequestId, diffSource, directories, dismissErrorToast, dismissUpdate, doctor, dragHandle, dropOverlayActive,
    dropOverlayText, editorHighlightTarget, editorNavigationTarget, editorSplitLayout, effectiveModels, effectiveReasoningSupported, effectiveRuntimeMode, effectiveSelectedModel,
    effectiveSelectedModelId, effectiveUiMode, engineModelsAsOptions, engineSelectedModelIdByType, engineSelection, engineStatuses, ensureLaunchTerminal, ensureTerminalWithTitle,
    ensureWorkspaceThreadListLoaded, entry, errorToasts, errorToastsNode, existing, exitDiffView, expandRightPanel, expandSidebar,
    filePanelMode, filePassword, fileReferenceMode, fileStatus, fileViewPanelNode, files, finishedByAgentUpdate, finishedByDuration,
    firstAnswer, flushDraggedHeight, force, forkThreadForWorkspace, getGlobalPromptsDir, getPinTimestamp, getThreadRows, getWorkspaceGroupName,
    getWorkspacePromptsDir, gitCommitDiffs, gitDiffListView, gitDiffPanelNode, gitDiffViewStyle, gitDiffViewerNode, gitHistoryPanelHeight, gitHistoryPanelHeightRef,
    gitIssues, gitIssuesError, gitIssuesLoading, gitIssuesTotal, gitLogAhead, gitLogAheadEntries, gitLogBehind, gitLogBehindEntries,
    gitLogEntries, gitLogError, gitLogLoading, gitLogTotal, gitLogUpstream, gitPanelMode, gitPullRequestComments, gitPullRequestCommentsError,
    gitPullRequestCommentsLoading, gitPullRequestDiffs, gitPullRequestDiffsError, gitPullRequestDiffsLoading, gitPullRequests, gitPullRequestsError, gitPullRequestsLoading, gitPullRequestsTotal,
    gitRemoteUrl, gitRootCandidates, gitRootScanDepth, gitRootScanError, gitRootScanHasScanned, gitRootScanLoading, gitStatus, gitignoredDirectories,
    gitignoredFiles, globalSearchFilesByWorkspace, group, groupId, groupedWorkspaces, handleActivateFileTab, handleActivateWorkspaceFileTab, handleActiveDiffPath,
    handleAddAgent, handleAddCloneAgent, handleAddWorkspace, handleAddWorkspaceFromPath, handleAddWorktreeAgent, handleAppModeChange, handleApplyWorktreeChanges, handleApprovalDecision,
    handleApprovalRemember, handleArchiveActiveThread, handleCancelSwitchAccount, handleCheckoutBranch, handleCloseAllFileTabs, handleCloseAllWorkspaceFileTabs, handleCloseFileTab, handleCloseGitHistoryPanel,
    handleCloseTaskConversation, handleCloseWorkspaceFileTab, handleCollaborationModeResolved, handleCommit, handleCommitAndPush, handleCommitAndSync, handleCommitMessageChange, handleComposerQueue,
    handleComposerQueueWithEditorFallback, handleComposerSend, handleComposerSendWithEditorFallback, handleContinueLatestConversation, handleCopyDebug, handleCopyThread, handleCreateBranch, handleCreatePrompt,
    handleDebugClick, handleDeletePrompt, handleDeleteQueued, handleDeleteThreadPromptCancel, handleDeleteThreadPromptConfirm, handleDeleteWorkspaceConversations, handleDeleteWorkspaceConversationsInSettings, handleDraftChange,
    handleDragToInProgress, handleDropWorkspacePaths, handleEditQueued, handleEnsureWorkspaceThreadsForSettings, handleExitEditor, handleExitWorkspaceEditor, handleGenerateCommitMessage, handleGitIssuesChange,
    handleGitPanelModeChange, handleGitPullRequestCommentsChange, handleGitPullRequestDiffsChange, handleGitPullRequestsChange, handleInsertComposerText, handleKanbanCreateTask, handleLockPanel, handleMovePrompt,
    handleMoveWorkspace, handleOpenComposerKanbanPanel, handleOpenFile, handleOpenHomeChat, handleOpenModelSettings, handleOpenRenameWorktree, handleOpenSearchPalette, handleOpenSpecHub,
    handleOpenTaskConversation, handleOpenWorkspaceFile, handleOpenWorkspaceHome, handlePickGitRoot, handlePointerMove, handlePointerUp, handlePush, handleRefreshAccountRateLimits,
    handleRenamePromptCancel, handleRenamePromptChange, handleRenamePromptConfirm, handleRenameThread, handleRenameWorktreeCancel, handleRenameWorktreeChange, handleRenameWorktreeConfirm, handleResize,
    handleRevealActiveWorkspace, handleRevealGeneralPrompts, handleRevealWorkspacePrompts, handleRevertAllGitChanges, handleRevertGitFile, handleReviewPromptKeyDown, handleSearchPaletteMoveSelection, handleSelectAgent,
    handleSelectCommit, handleSelectDiff, handleSelectDiffForPanel, handleSelectModel, handleSelectOpenAppId, handleSelectOpenCodeAgent, handleSelectOpenCodeVariant, handleSelectPullRequest,
    handleSelectSearchResult, handleSelectWorkspaceInstance, handleSelectWorkspacePathForGitHistory, handleSend, handleSendPrompt, handleSendPromptToNewAgent, handleSetAccessMode, handleSetGitRoot,
    handleStageGitAll, handleStageGitFile, handleStartGuidedConversation, handleStartSharedConversation, handleStartWorkspaceConversation, handleSwitchAccount, handleSync, handleTestNotificationSound, handleToggleDictation,
    handleToggleRuntimeConsole, handleToggleSearchContentFilter, handleToggleSearchPalette, handleToggleTerminal, handleToggleTerminalPanel, handleUnlockPanel, handleUnstageGitFile, handleUpdatePrompt,
    handleUserInputSubmit, handleUserInputSubmitWithPlanApply, handleWorkspaceDragEnter, handleWorkspaceDragLeave, handleWorkspaceDragOver, handleWorkspaceDrop, handleWorktreeCreated, hasActivePlan,
    hasLoaded, hasPlanData, highlightedBranchIndex, highlightedCommitIndex, highlightedPresetIndex, historySearchItems, homeNode, hydratedThreadListWorkspaceIdsRef,
    installedEngines, interruptTurn, isCompact, isDeleteThreadPromptBusy, isEditorFileMaximized, isFilesLoading, isLoadingLatestAgents, isMacDesktop,
    isPanelLocked, isPhone, isPlanMode, isPlanPanelDismissed, isProcessing, isProcessingNow, isPullRequestComposer, isPullRequestComposerFromSections,
    isReviewing, isSearchPaletteOpen, isSoloMode, isTablet, isThreadAutoNaming, isThreadPinned, isValid, isWindowsDesktop,
    isWorkspaceDropActive, isWorktreeWorkspace, kanbanConversationWidth, kanbanCreatePanel, kanbanCreateTask, kanbanDeletePanel, kanbanDeleteTask, kanbanPanels,
    kanbanReorderTask, kanbanTasks, kanbanUpdatePanel, kanbanUpdateTask, kanbanViewState, key, label, lastAgent,
    lastAgentMessageByThread, lastAgentTimestamp, lastCodexModeSyncThreadRef, lastDurationMs, lastFrameAt, latestAgentRuns, latestClampedHeight, latestRawHeight,
    latestSnippet, launchScriptState, launchScriptsState, listThreadsForWorkspace, listThreadsForWorkspaceTracked, liveEditPreviewEnabled, loadOlderThreadsForWorkspace, lockLiveSessions,
    main, mainHeaderNode, mainWidth, mappedMode, markWorkspaceConnected, maxHeight, messagesNode, minHeight,
    models, monitor, movePrompt, moveWorkspaceGroup, navigateToThread, next, nextDefault, nextDraft,
    nextFiles, nextHeight, nextScope, nextSettings, normalizePath, normalized, onCloseTerminal, onDebugPanelResizeStart,
    onGitHistoryPanelResizeStart, onKanbanConversationResizeStart, onNewTerminal, onPlanPanelResizeStart, onRightPanelResizeStart, onSelectTerminal, onSidebarResizeStart, onTerminalPanelResizeStart,
    onTextareaHeightChange, openAppIconById, openClonePrompt, openCodeAgents,
    openDeleteThreadPrompt, openFileTabs, openPlanPanel, openReleaseNotes, openRenamePrompt, openRenameWorktreePrompt, openSettings, openTerminal,
    openWorktreePrompt, path, payload, perfSnapshotRef, persistProjectCopiesFolder, pickImages, pinThread, pinnedThreadsVersion,
    planByThread, planPanelHeight, planPanelNode, pointerId, prefillDraft, prevFiles, previous, previousAgentTimestamp,
    previousDurationMs, previousThreadIdRef, previousTracker, prompts, pushError, pushLoading, queueGitStatusRefresh, queueMessage,
    queueSaveSettings, rafId, rateLimitsByWorkspace, reasoningOptions, reasoningSupported, recentThreads, reduceTransparency, refreshAccountInfo,
    refreshAccountRateLimits, refreshFiles, refreshGitDiffs, refreshGitLog, refreshGitStatus, refreshThread, refreshWorkspaces, releaseNotesActiveIndex,
    releaseNotesEntries, releaseNotesError, releaseNotesLoading, releaseNotesOpen, reloadSelectedAgent, removeImage, removeImagesForThread, removeThread,
    removeWorkspace, removeWorktree, renamePrompt, renameThread, renameWorkspaceGroup, renameWorktree, renameWorktreeNotice, renameWorktreePrompt,
    renameWorktreeUpstream, renameWorktreeUpstreamPrompt, requestId, requestThreadId, resetGitHubPanelState, resetPullRequestSelection, resetSoloSplitToHalf, resetWorkspaceThreads,
    resolveCloneProjectContext, resolveCollaborationRuntimeMode, resolveCollaborationUiMode, resolveOpenCodeAgentForThread, resolveOpenCodeVariantForThread, resolvedEffort, resolvedModel, response,
    restartTerminalSession, result, resumePrompt, retryReleaseNotesLoad, reviewPrompt, rightPanelAvailable, rightPanelCollapsed, rightPanelToolbarNode,
    rightPanelWidth, runtimeMode, runtimeRunState, scaleShortcutText, scaleShortcutTitle, scanGitRoots, scheduleDraggedHeightFlush, scopedKanbanTasks,
    searchContentFilters, searchPaletteQuery, searchPaletteSelectedIndex, searchResults, searchScope, sections, selectBranch, selectBranchAtIndex,
    selectCommit, selectCommitAtIndex, selectHome, selectWorkspace, selected, selectedAgent, selectedAnswer, selectedCollaborationMode,
    selectedCollaborationModeId, selectedCommitSha, selectedComposerKanbanPanelId, selectedDiffPath, selectedEffort, selectedKanbanTaskId, selectedModelId, selectedOpenCodeAgent,
    selectedOpenCodeVariant, selectedPath, selectedPullRequest, selection, sendUserMessage, sendUserMessageToThread, sessions, setAccessMode,
    setActiveEditorLineRange, setActiveEngine, setActiveTab, setActiveThreadId, setActiveWorkspaceId, setAppMode, setAppSettings, setCenterMode,
    setCodexCollaborationMode, setCollaborationRuntimeModeByThread, setCollaborationUiModeByThread, setComposerInsert, setComposerKanbanContextMode, setDebugOpen, setDiffSource, setEditorSplitLayout,
    setEngineSelectedModelIdByType, setFilePanelMode, setFileReferenceMode, setGitDiffListView, setGitDiffViewStyle, setGitHistoryPanelHeight, setGitPanelMode, setGitRootScanDepth,
    setGlobalSearchFilesByWorkspace, setHighlightedBranchIndex, setHighlightedCommitIndex, setHighlightedPresetIndex, setIsEditorFileMaximized, setIsPanelLocked, setIsPlanPanelDismissed, setIsSearchPaletteOpen,
    setKanbanViewState, setLiveEditPreviewEnabled, setPrefillDraft,
    setReduceTransparency, setRightPanelWidth, setSearchContentFilters, setSearchPaletteQuery, setSearchPaletteSelectedIndex, setSearchScope, setSelectedAgent, setSelectedCollaborationModeId,
    setSelectedCommitSha, setSelectedComposerKanbanPanelId, setSelectedDiffPath, setSelectedEffort, setSelectedKanbanTaskId, setSelectedModelId, setSelectedPullRequest, setWorkspaceHomeWorkspaceId,
    settingsHighlightTarget, settingsOpen, settingsSection, shouldForceResumeInCode, shouldImplementPlan, shouldLoadDiffs, shouldLoadGitHubPanelData, shouldMountSpecHub,
    shouldShowSidebarTopbarContent, showComposer, showDebugButton, showGitDetail, showGitHistory, showHome, showKanban, showNextReleaseNotes,
    showPresetStep, showPreviousReleaseNotes, showSpecHub, showWorkspaceHome, sidebarCollapsed, sidebarNode, sidebarToggleProps, sidebarWidth,
    skills, slashToken, snapshot, soloModeEnabled, startExport, startFast, startFork, startHeight,
    startImport, startLsp, startMcp, startMode, startResume, startReview, startShare, startSpecRoot,
    startStatus, startThreadForWorkspace, startUpdate, startY, stored, syncError, syncLoading,
    sessionRadarRecentCompletedSessions,
    t, tabBarNode, tabletNavNode, tabletTab, target, targetThread, targetWorkspaceIds, task,
    taskProcessingMap, taskWs, terminalDockNode, terminalOpen, terminalPanelHeight, terminalState, terminalTabs, textareaHeight,
    threadAccessMode, threadChanged, threadId, threadItemsByThread, threadListCursorByWorkspace, threadListLoadingByWorkspace, threadListPagingByWorkspace, threadMode,
    threadParentById, threadStatusById, threads, threadsByWorkspace, timelinePlan, title, toggleSoloMode, tokenUsageByThread,
    triggerAutoThreadTitle, trimmed, uiMode, uncachedWorkspaceIds, ungroupedLabel, uniquePaths, unpinThread, updateCloneCopyName,
    updateCustomInstructions, updatePrompt, updateToastNode, updateWorkspaceCodexBin, updateWorkspaceSettings, updateWorktreeBaseRef, updateWorktreeBranch, updateWorktreePublishToOrigin,
    updateWorktreeSetupScript, updatedAt, updaterState, useSuggestedCloneCopiesFolder, userInputRequests, validModel, viewportHeight, wasProcessing,
    workspace, workspaceActivity, workspaceDropTargetRef, workspaceFilesPollingEnabled, workspaceGroups, workspaceHomeWorkspaceId, workspaceId, workspaceNameByPath,
    workspacePath, workspaceSearchSources, workspaces, workspacesById, workspacesByPath, worktreeApplyError, worktreeApplyLoading, worktreeApplySuccess,
    worktreeCreateResult, worktreeLabel, worktreePrompt, worktreeRename, worktreeSetupScriptState,
  } = ctx;

  const specHubNode = shouldMountSpecHub ? (
    <SpecHub
      workspaceId={activeWorkspace?.id ?? null}
      workspaceName={activeWorkspace?.name ?? null}
      files={files}
      directories={directories}
      onBackToChat={() => setActiveTab("codex")}
    />
  ) : null;

  const workspaceHomeNode = activeWorkspace ? (
    <WorkspaceHome
      workspace={activeWorkspace}
      engines={installedEngines}
      currentBranch={gitStatus.branchName || null}
      recentThreads={recentThreads}
      onSelectConversation={handleSelectWorkspaceInstance}
      onStartConversation={handleStartWorkspaceConversation}
      onStartSharedConversation={handleStartSharedConversation}
      onContinueLatestConversation={handleContinueLatestConversation}
      onStartGuidedConversation={handleStartGuidedConversation}
      onOpenSpecHub={handleOpenSpecHub}
      onRevealWorkspace={handleRevealActiveWorkspace}
      onDeleteConversations={handleDeleteWorkspaceConversations}
    />
  ) : null;

  const workspacePrimaryNode = showWorkspaceHome ? workspaceHomeNode : messagesNode;

  const mainMessagesNode = shouldMountSpecHub
    ? (
      <div className="workspace-chat-stack">
        <div className={`workspace-chat-layer ${showSpecHub ? "is-hidden" : "is-active"}`}>
          {workspacePrimaryNode}
        </div>
        <div className={`workspace-spec-layer ${showSpecHub ? "is-active" : "is-hidden"}`}>
          {specHubNode}
        </div>
      </div>
    )
    : workspacePrimaryNode;

  const kanbanConversationNode = selectedKanbanTaskId ? (
    <div className="kanban-conversation-content">
      {messagesNode}
      {composerNode}
    </div>
  ) : null;

  const gitHistoryNode = (
    <GitHistoryPanel
      workspace={activeWorkspace}
      workspaces={workspaces}
      groupedWorkspaces={groupedWorkspaces}
      onSelectWorkspace={setActiveWorkspaceId}
      onSelectWorkspacePath={handleSelectWorkspacePathForGitHistory}
      onOpenDiffPath={handleSelectDiffForPanel}
      onRequestClose={handleCloseGitHistoryPanel}
    />
  );

  const showSidebarTopbarSidebarToggle = shouldShowSidebarTopbarSidebarToggle({
    isCompact,
    isMacDesktop,
    isSoloMode,
    sidebarCollapsed,
  });
  const showMainTopbarSidebarToggle = shouldShowMainTopbarSidebarToggle({
    isCompact,
    isMacDesktop,
    isSoloMode,
    sidebarCollapsed,
  });
  const showFloatingTitlebarSidebarToggle =
    shouldShowFloatingTitlebarSidebarToggle({
      showHome,
      showMainTopbarSidebarToggle,
    });

  const desktopTopbarLeftNodeWithToggle = showMainTopbarSidebarToggle ? (
    <div className="topbar-leading">
      <SidebarCollapseButton {...sidebarToggleProps} />
      {desktopTopbarLeftNode}
    </div>
  ) : (
    desktopTopbarLeftNode
  );
  const sidebarTopbarToggleNode = showSidebarTopbarSidebarToggle ? (
    <div
      className={`sidebar-titlebar-toggle${
        sidebarToggleProps.isLayoutSwapped ? " is-layout-swapped" : ""
      }`}
      data-tauri-drag-region="false"
    >
      <SidebarCollapseButton {...sidebarToggleProps} />
    </div>
  ) : null;
  const sidebarNodeWithTopbar = sidebarTopbarToggleNode &&
    isValidElement(sidebarNode)
    ? cloneElement(
        sidebarNode as React.ReactElement<{ topbarNode?: React.ReactNode }>,
        { topbarNode: sidebarTopbarToggleNode },
      )
    : sidebarNode;
  const runtimeConsoleDockNode = (
    <RuntimeConsoleDock
      isVisible={runtimeRunState.runtimeConsoleVisible}
      status={runtimeRunState.runtimeConsoleStatus}
      commandPreview={runtimeRunState.runtimeConsoleCommandPreview}
      log={runtimeRunState.runtimeConsoleLog}
      error={runtimeRunState.runtimeConsoleError}
      exitCode={runtimeRunState.runtimeConsoleExitCode}
      truncated={runtimeRunState.runtimeConsoleTruncated}
      autoScroll={runtimeRunState.runtimeAutoScroll}
      wrapLines={runtimeRunState.runtimeWrapLines}
      commandPresetOptions={runtimeRunState.runtimeCommandPresetOptions}
      commandPresetId={runtimeRunState.runtimeCommandPresetId}
      commandInput={runtimeRunState.runtimeCommandInput}
      onRun={runtimeRunState.onRunProject}
      onCommandPresetChange={runtimeRunState.onSelectRuntimeCommandPreset}
      onCommandInputChange={runtimeRunState.onChangeRuntimeCommandInput}
      onStop={runtimeRunState.onStopProject}
      onClear={runtimeRunState.onClearRuntimeLogs}
      onCopy={runtimeRunState.onCopyRuntimeLogs}
      onToggleAutoScroll={runtimeRunState.onToggleRuntimeAutoScroll}
      onToggleWrapLines={runtimeRunState.onToggleRuntimeWrapLines}
    />
  );

  return (
    <div
      ref={appRootRef}
      className={appClassName}
      style={
        {
          "--sidebar-width": `${
            isCompact
              ? sidebarWidth
              : settingsOpen
                ? 0
                : sidebarCollapsed
                  ? 0
                  : sidebarWidth
          }px`,
          "--right-panel-width": `${
            isCompact ? rightPanelWidth : rightPanelCollapsed ? 0 : rightPanelWidth
          }px`,
          "--plan-panel-height": `${planPanelHeight}px`,
          "--terminal-panel-height": `${terminalPanelHeight}px`,
          "--debug-panel-height": `${debugPanelHeight}px`,
          "--git-history-panel-height": `${gitHistoryPanelHeight}px`,
          "--ui-font-family": appSettings.uiFontFamily,
          "--code-font-family": appSettings.codeFontFamily,
          "--code-font-size": `${appSettings.codeFontSize}px`
        } as React.CSSProperties
      }
    >
      <div className="drag-strip" id="titlebar" data-tauri-drag-region />
      <TitlebarExpandControls
        {...sidebarToggleProps}
        showSidebarTitlebarToggle={showFloatingTitlebarSidebarToggle}
      />
      {shouldLoadGitHubPanelData ? (
        <Suspense fallback={null}>
          <GitHubPanelData
            activeWorkspace={activeWorkspace}
            gitPanelMode={gitPanelMode}
            shouldLoadDiffs={shouldLoadDiffs}
            diffSource={diffSource}
            selectedPullRequestNumber={selectedPullRequest?.number ?? null}
            onIssuesChange={handleGitIssuesChange}
            onPullRequestsChange={handleGitPullRequestsChange}
            onPullRequestDiffsChange={handleGitPullRequestDiffsChange}
            onPullRequestCommentsChange={handleGitPullRequestCommentsChange}
          />
        </Suspense>
      ) : null}
      <AppLayout
        isPhone={isPhone}
        isTablet={isTablet}
        showHome={showHome}
        showKanban={showKanban}
        showGitHistory={showGitHistory}
        hideRightPanel={activeTab === "spec" && rightPanelCollapsed}
        isSoloMode={isSoloMode}
        kanbanNode={
          showKanban ? (
            <KanbanView
              viewState={kanbanViewState}
              onViewStateChange={setKanbanViewState}
              workspaces={workspaces}
              panels={kanbanPanels}
              tasks={kanbanTasks}
              onCreateTask={handleKanbanCreateTask}
              onUpdateTask={kanbanUpdateTask}
              onDeleteTask={kanbanDeleteTask}
              onReorderTask={kanbanReorderTask}
              onCreatePanel={kanbanCreatePanel}
              onUpdatePanel={kanbanUpdatePanel}
              onDeletePanel={kanbanDeletePanel}
              onAddWorkspace={handleAddWorkspace}
              onAppModeChange={handleAppModeChange}
              engineStatuses={engineStatuses}
              conversationNode={kanbanConversationNode}
              selectedTaskId={selectedKanbanTaskId}
              taskProcessingMap={taskProcessingMap}
              onOpenTaskConversation={handleOpenTaskConversation}
              onCloseTaskConversation={handleCloseTaskConversation}
              onDragToInProgress={handleDragToInProgress}
              kanbanConversationWidth={kanbanConversationWidth}
              onKanbanConversationResizeStart={onKanbanConversationResizeStart}
              gitPanelNode={gitDiffPanelNode}
              terminalOpen={terminalOpen}
              onToggleTerminal={handleToggleTerminalPanel}
            />
          ) : null
        }
        gitHistoryNode={showGitHistory ? gitHistoryNode : null}
        showGitDetail={showGitDetail}
        activeTab={activeTab}
        tabletTab={tabletTab}
        centerMode={centerMode}
        editorSplitLayout={editorSplitLayout}
        isEditorFileMaximized={isEditorFileMaximized}
        hasActivePlan={hasActivePlan}
        activeWorkspace={Boolean(activeWorkspace)}
        sidebarNode={sidebarNodeWithTopbar}
        messagesNode={mainMessagesNode}
        composerNode={composerNode}
        approvalToastsNode={approvalToastsNode}
        updateToastNode={updateToastNode}
        errorToastsNode={errorToastsNode}
        homeNode={homeNode}
        mainHeaderNode={mainHeaderNode}
        desktopTopbarLeftNode={desktopTopbarLeftNodeWithToggle}
        tabletNavNode={tabletNavNode}
        tabBarNode={tabBarNode}
        rightPanelToolbarNode={rightPanelToolbarNode}
        gitDiffPanelNode={gitDiffPanelNode}
        gitDiffViewerNode={gitDiffViewerNode}
        fileViewPanelNode={fileViewPanelNode}
        planPanelNode={planPanelNode}
        runtimeConsoleDockNode={runtimeConsoleDockNode}
        debugPanelNode={debugPanelNode}
        debugPanelFullNode={debugPanelFullNode}
        terminalDockNode={terminalDockNode}
        compactEmptyCodexNode={compactEmptyCodexNode}
        compactEmptySpecNode={compactEmptySpecNode}
        compactEmptyGitNode={compactEmptyGitNode}
        compactGitBackNode={compactGitBackNode}
        settingsOpen={settingsOpen}
        settingsNode={
          settingsOpen ? (
            <Suspense fallback={null}>
              <SettingsView
                workspaceGroups={workspaceGroups}
                groupedWorkspaces={groupedWorkspaces}
                allWorkspaces={workspaces}
                ungroupedLabel={ungroupedLabel}
                onMoveWorkspace={handleMoveWorkspace}
                onDeleteWorkspace={(workspaceId) => {
                  void removeWorkspace(workspaceId);
                }}
                onCreateWorkspaceGroup={createWorkspaceGroup}
                onRenameWorkspaceGroup={renameWorkspaceGroup}
                onMoveWorkspaceGroup={moveWorkspaceGroup}
                onDeleteWorkspaceGroup={deleteWorkspaceGroup}
                onAssignWorkspaceGroup={assignWorkspaceGroup}
                reduceTransparency={reduceTransparency}
                onToggleTransparency={setReduceTransparency}
                appSettings={appSettings}
                openAppIconById={openAppIconById}
                onUpdateAppSettings={async (next) => {
                  setAppSettings(next);
                  await queueSaveSettings(next);
                }}
                onRunDoctor={doctor}
                activeWorkspace={activeWorkspace}
                activeEngine={activeEngine}
                onUpdateWorkspaceCodexBin={async (id, codexBin) => {
                  await updateWorkspaceCodexBin(id, codexBin);
                }}
                onUpdateWorkspaceSettings={async (id, settings) => {
                  await updateWorkspaceSettings(id, settings);
                }}
                workspaceThreadsById={threadsByWorkspace}
                workspaceThreadListLoadingById={threadListLoadingByWorkspace}
                sessionRadarRecentCompletedSessions={sessionRadarRecentCompletedSessions}
                onEnsureWorkspaceThreads={handleEnsureWorkspaceThreadsForSettings}
                onDeleteWorkspaceThreads={handleDeleteWorkspaceConversationsInSettings}
                scaleShortcutTitle={scaleShortcutTitle}
                scaleShortcutText={scaleShortcutText}
                onTestNotificationSound={handleTestNotificationSound}
                dictationModelStatus={dictationModel.status}
                onDownloadDictationModel={dictationModel.download}
                onCancelDictationDownload={dictationModel.cancel}
                onRemoveDictationModel={dictationModel.remove}
                onClose={closeSettings}
                initialSection={settingsSection ?? undefined}
                initialHighlightTarget={settingsHighlightTarget ?? undefined}
              />
            </Suspense>
          ) : null
        }
        onSidebarResizeStart={onSidebarResizeStart}
        onRightPanelResizeStart={onRightPanelResizeStart}
        onPlanPanelResizeStart={onPlanPanelResizeStart}
        onGitHistoryPanelResizeStart={onGitHistoryPanelResizeStart}
      />
      <LockScreenOverlay
        isOpen={isPanelLocked}
        onUnlock={handleUnlockPanel}
        liveSessions={lockLiveSessions}
      />
      <SearchPalette
        isOpen={isSearchPaletteOpen}
        scope={searchScope}
        contentFilters={searchContentFilters}
        workspaceName={activeWorkspace?.name ?? null}
        query={searchPaletteQuery}
        results={searchResults}
        selectedIndex={searchPaletteSelectedIndex}
        onQueryChange={setSearchPaletteQuery}
        onMoveSelection={handleSearchPaletteMoveSelection}
        onSelect={(result) => {
          void handleSelectSearchResult(result);
        }}
        onScopeChange={(nextScope) => {
          setSearchScope(nextScope);
          setSearchPaletteSelectedIndex(0);
        }}
        onContentFilterToggle={handleToggleSearchContentFilter}
        onClose={closeSearchPalette}
      />
      <ReleaseNotesModal
        isOpen={releaseNotesOpen}
        entries={releaseNotesEntries}
        activeIndex={releaseNotesActiveIndex}
        loading={releaseNotesLoading}
        error={releaseNotesError}
        onClose={closeReleaseNotes}
        onPrev={showPreviousReleaseNotes}
        onNext={showNextReleaseNotes}
        onRetry={retryReleaseNotesLoad}
      />
      <AppModals
        renamePrompt={renamePrompt}
        onRenamePromptChange={handleRenamePromptChange}
        onRenamePromptCancel={handleRenamePromptCancel}
        onRenamePromptConfirm={handleRenamePromptConfirm}
        worktreePrompt={worktreePrompt}
        onWorktreePromptChange={updateWorktreeBranch}
        onWorktreePromptBaseRefChange={updateWorktreeBaseRef}
        onWorktreePromptPublishChange={updateWorktreePublishToOrigin}
        onWorktreeSetupScriptChange={updateWorktreeSetupScript}
        onWorktreePromptCancel={cancelWorktreePrompt}
        onWorktreePromptConfirm={confirmWorktreePrompt}
        worktreeCreateResult={worktreeCreateResult}
        onWorktreeCreateResultClose={closeWorktreeCreateResult}
        clonePrompt={clonePrompt}
        onClonePromptCopyNameChange={updateCloneCopyName}
        onClonePromptChooseCopiesFolder={chooseCloneCopiesFolder}
        onClonePromptUseSuggestedFolder={useSuggestedCloneCopiesFolder}
        onClonePromptClearCopiesFolder={clearCloneCopiesFolder}
        onClonePromptCancel={cancelClonePrompt}
        onClonePromptConfirm={confirmClonePrompt}
      />
    </div>
  );
}
