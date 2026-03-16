// @ts-nocheck
import { renderGitHistoryPanelDialogs } from "./GitHistoryPanelDialogs";

export function renderGitHistoryPanelView(scope: any) {
  const {ActionSurface,CREATE_PR_PREVIEW_COMMIT_LIMIT,ChevronDown,ChevronLeft,ChevronRight,ChevronsDownUp,ChevronsUpDown,CircleAlert,CircleCheck,Cloud,CloudDownload,Copy,DEFAULT_DETAILS_SPLIT,DISABLE_HISTORY_ACTION_BUTTONS,Download,FileIcon,FileText,Folder,FolderOpen,FolderTree,GitBranch,GitCommit,GitDiffViewer,GitHistoryInlinePicker,GitHistoryProjectPicker,GitHistoryWorktreePanel,GitMerge,GitPullRequestCreate,HardDrive,LayoutGrid,LoaderCircle,MessageSquareText,Pencil,Plus,RefreshCw,Repeat,Search,ShieldAlert,Trash2,Upload,X,branchContextActions,branchContextMenu,branchContextMenuRef,branchContextMenuStyle,branchContextTrackingSummary,branchDiffState,branchQuery,branchesWidth,buildFileKey,clearOperationNotice,closeBranchContextMenu,closeBranchDiff,closeCreatePrDialog,closeForceDeleteDialog,closeRenameBranchDialog,closeWorktreePreview,commitContextMenu,commitContextMoreOpen,commitListRef,commitQuery,commitRowVirtualizer,commits,commitsWidth,comparePreviewDetailFile,comparePreviewDetailFileDiff,comparePreviewDiffEntries,comparePreviewFileKey,contextMoreDisabledReason,contextPrimaryActionGroups,contextWriteActions,createBranchCanConfirm,createBranchDialogOpen,createBranchName,createBranchNameInputRef,createBranchSource,createBranchSourceOptions,createBranchSubmitting,createPortal,createPrBaseBranchOptions,createPrBaseRepoOptions,createPrCanConfirm,createPrCanOpen,createPrCompareBranchOptions,createPrCopiedPrUrl,createPrCopiedRetryCommand,createPrDefaultsError,createPrDefaultsLoading,createPrDialogOpen,createPrForm,createPrHeadRepoOptions,createPrHeadRepositoryValue,createPrPreviewBaseOnlyCount,createPrPreviewBaseRef,createPrPreviewCommits,createPrPreviewDetails,createPrPreviewDetailsError,createPrPreviewDetailsLoading,createPrPreviewError,createPrPreviewExpanded,createPrPreviewHasMore,createPrPreviewHeadRef,createPrPreviewLoading,createPrPreviewSelectedCommit,createPrPreviewSelectedSha,createPrResult,createPrResultHeadline,createPrStages,createPrSubmitting,createPrToolbarDisabledReason,currentBranch,currentLocalBranchEntry,defaults,desktopSplitLayout,details,detailsBodyRef,detailsError,detailsLoading,detailsMessageContent,detailsSplitRatio,diffViewMode,emptyStateStatusText,expandedLocalScopes,expandedRemoteScopes,extractCommitBody,fallbackGitRoots,fallbackGitRootsError,fallbackGitRootsLoading,fallbackSelectingRoot,fetchDialogOpen,fetchSubmitting,fileTreeItems,forceDeleteCopiedPath,forceDeleteCountdown,forceDeleteDialogState,formatRelativeTime,getBranchLeafName,getBranchScope,getCommitActionIcon,getCurrentDefaultColumnWidths,getSpecialBranchBadges,getTreeLineOpacity,groupedLocalBranches,groupedRemoteBranches,handleBranchContextMenuKeyDown,handleBranchesSplitResizeStart,handleCommitsSplitResizeStart,handleConfirmCreatePr,handleConfirmFetch,handleConfirmPull,handleConfirmPush,handleConfirmRefresh,handleConfirmResetCommit,handleConfirmSync,handleCopyCreatePrRetryCommand,handleCopyCreatePrUrl,handleCopyForceDeleteWorktreePath,handleCreateBranch,handleCreateBranchConfirm,handleCreatePrHeadRepositoryChange,handleDeleteBranch,handleDetailsSplitResizeStart,handleFallbackGitRootSelect,handleFileTreeDirToggle,handleMergeBranch,handleOpenBranchContextMenu,handleOpenCommitContextMenu,handleOpenCreatePrDialog,handleOpenFetchDialog,handleOpenPullDialog,handleOpenPushDialog,handleOpenRefreshDialog,handleOpenRenameBranchDialog,handleOpenSyncDialog,handleOpenWorktreePreview,handleOverviewSplitResizeStart,handlePushPreviewDirToggle,handleRenameBranchConfirm,handleSelectBranchCompareCommit,handleSelectPullRemote,handleSelectPullTargetBranch,handleSelectPushRemote,handleSelectPushTargetBranch,handleSelectWorktreeDiffFile,handleToggleLocalScope,handleToggleRemoteScope,handleWorktreeSummaryChange,historyError,historyHasMore,historyLoading,historyLoadingMore,historyTotal,isCreatePrDialogMaximized,isHistoryDiffModalMaximized,loadCreatePrCommitPreview,loadHistory,localSectionExpanded,localizeKnownGitError,localizedOperationName,mainGridRef,mainGridStyle,onOpenDiffPath,onRequestClose,onSelectWorkspace,openPullTargetBranchMenu,openPushTargetBranchMenu,operationLoading,operationNotice,overviewCommitSectionCollapsed,overviewListView,overviewWidth,previewDetailFile,previewDetailFileDiff,previewDiffEntries,previewModalFullDiffLoader,projectOptions,projectSections,pullDialogOpen,pullNoCommit,pullNoVerify,pullOptionsMenuOpen,pullOptionsMenuRef,pullRemote,pullRemoteGroups,pullRemoteMenuOpen,pullRemoteMenuPlacement,pullRemotePickerRef,pullRemoteTrimmed,pullSelectedOptions,pullStrategy,pullSubmitting,pullTargetBranch,pullTargetBranchActiveScopeTab,pullTargetBranchFieldRef,pullTargetBranchGroups,pullTargetBranchMenuOpen,pullTargetBranchMenuPlacement,pullTargetBranchMenuRef,pullTargetBranchPickerRef,pullTargetBranchTrimmed,pushCanConfirm,pushCc,pushDialogOpen,pushForceWithLease,pushHasOutgoingCommits,pushIsNewBranchTarget,pushPreviewCommits,pushPreviewDetails,pushPreviewDetailsError,pushPreviewDetailsLoading,pushPreviewError,pushPreviewFileTreeItems,pushPreviewHasMore,pushPreviewLoading,pushPreviewModalDiffEntries,pushPreviewModalFile,pushPreviewModalFileDiff,pushPreviewModalFullDiffLoader,pushPreviewSelectedCommit,pushPreviewSelectedFileKey,pushPreviewSelectedSha,pushRemoteMenuOpen,pushRemoteMenuPlacement,pushRemoteOptions,pushRemotePickerRef,pushRemoteTrimmed,pushReviewers,pushRunHooks,pushSubmitting,pushTags,pushTargetBranch,pushTargetBranchActiveScopeTab,pushTargetBranchFieldRef,pushTargetBranchGroups,pushTargetBranchMenuOpen,pushTargetBranchMenuPlacement,pushTargetBranchMenuRef,pushTargetBranchPickerRef,pushTargetBranchTrimmed,pushTargetSummaryBranch,pushToGerrit,pushTopic,refreshAll,refreshDialogOpen,refreshSubmitting,remoteSectionExpanded,renameBranchCanConfirm,renameBranchDialogOpen,renameBranchName,renameBranchNameInputRef,renameBranchSource,renameBranchSubmitting,renameBranchToolbarDisabledReason,renderChangedFilesSummary,repositoryRootName,repositoryUnavailable,resetDialogOpen,resetMode,resetTargetCommit,resetTargetSha,runCommitAction,selectedBranch,selectedCommitSha,selectedFileKey,selectedLocalBranchForRename,setBranchQuery,setBranchesWidth,setCommitContextMenu,setCommitContextMoreOpen,setCommitQuery,setCommitsWidth,setComparePreviewFileKey,setCreateBranchDialogOpen,setCreateBranchName,setCreateBranchSource,setCreatePrForm,setCreatePrPreviewExpanded,setCreatePrPreviewSelectedSha,setDetailsSplitRatio,setDiffViewMode,setFallbackSelectingRoot,setFetchDialogOpen,setIsCreatePrDialogMaximized,setIsHistoryDiffModalMaximized,setLocalSectionExpanded,setOverviewCommitSectionCollapsed,setOverviewListView,setOverviewWidth,setPreviewFileKey,setPullDialogOpen,setPullNoCommit,setPullNoVerify,setPullOptionsMenuOpen,setPullRemoteMenuOpen,setPullStrategy,setPullTargetBranch,setPullTargetBranchActiveScopeTab,setPullTargetBranchMenuOpen,setPullTargetBranchQuery,setPushCc,setPushDialogOpen,setPushForceWithLease,setPushPreviewModalFileKey,setPushPreviewSelectedFileKey,setPushPreviewSelectedSha,setPushRemoteMenuOpen,setPushReviewers,setPushRunHooks,setPushTags,setPushTargetBranch,setPushTargetBranchActiveScopeTab,setPushTargetBranchMenuOpen,setPushTargetBranchQuery,setPushToGerrit,setPushTopic,setRefreshDialogOpen,setRemoteSectionExpanded,setRenameBranchName,setResetDialogOpen,setResetMode,setSelectedBranch,setSelectedCommitSha,setSelectedFileKey,setSyncDialogOpen,setWorkspaceSelectingId,shouldShowWorkspacePickerPage,statusLabel,strokeWidth,syncDialogOpen,syncPreviewCommits,syncPreviewError,syncPreviewLoading,syncPreviewTargetBranch,syncPreviewTargetFound,syncPreviewTargetRemote,syncSubmitting,t,trimRemotePrefix,updatePullRemoteMenuPlacement,updatePushRemoteMenuPlacement,virtualCommitRows,visiblePullTargetBranchGroups,visiblePushTargetBranchGroups,workbenchGridRef,workbenchGridStyle,workingTreeChangedFiles,workingTreeSummaryLabel,workingTreeTotalAdditions,workingTreeTotalDeletions,workspace,workspaceId,workspacePickerMessage,workspaceSelectingId,worktreePreviewDiffEntries,worktreePreviewDiffText,worktreePreviewError,worktreePreviewFile,worktreePreviewFullDiffLoader,worktreePreviewLoading} = scope;
  const isWorktreeDiffMode = branchDiffState?.mode === "worktree";
  const branchDiffModeClassName = isWorktreeDiffMode ? "is-worktree-mode" : "is-branch-mode";
  const branchDiffTitle = branchDiffState
    ? branchDiffState.mode === "worktree"
      ? t("git.historyBranchWorktreeDiffTitle", {
        branch: branchDiffState.branch,
        currentBranch: branchDiffState.compareBranch || t("git.unknown"),
      })
      : t("git.historyBranchCompareDiffTitle", {
        branch: branchDiffState.branch,
        compareBranch: branchDiffState.compareBranch || t("git.unknown"),
      })
    : "";
  const branchDiffSubtitle = branchDiffState
    ? branchDiffState.mode === "worktree"
      ? t("git.historyBranchWorktreeDiffSubtitle", { branch: branchDiffState.branch })
      : t("git.historyBranchCompareDiffSubtitle", {
        branch: branchDiffState.branch,
        compareBranch: branchDiffState.compareBranch || t("git.unknown"),
      })
    : "";
  const branchDiffModeLabel = isWorktreeDiffMode
    ? t("git.historyBranchWorktreeDiffModeBadge")
    : t("git.historyBranchCompareDiffModeBadge");
  const branchDiffStatsLabel = branchDiffState
    ? branchDiffState.mode === "worktree"
      ? t("git.filesChanged", { count: branchDiffState.files.length })
      : t("git.historyBranchCompareCommitCount", {
        count: branchDiffState.targetOnlyCommits.length + branchDiffState.currentOnlyCommits.length,
      })
    : "";
  const syncAheadCount = currentLocalBranchEntry?.ahead ?? 0;
  const syncBehindCount = currentLocalBranchEntry?.behind ?? 0;
  const pullTargetSummary = pullTargetBranch.trim() || (currentBranch ?? "HEAD");
  const pullExampleCommand = `git pull ${pullRemote.trim() || "origin"} ${pullTargetSummary}${
    pullStrategy ? ` ${pullStrategy}` : ""
  }${pullNoCommit ? " --no-commit" : ""}${pullNoVerify ? " --no-verify" : ""}`;

  if (shouldShowWorkspacePickerPage) {
    const canPickFallbackGitRoot = repositoryUnavailable && Boolean(workspace);
    const isEmptyStateSelecting = Boolean(fallbackSelectingRoot || workspaceSelectingId);
    return (
      <div className="git-history-workbench">
        <div className="git-history-toolbar git-history-empty-toolbar">
          <div className="git-history-toolbar-left">
            <span className="git-history-empty-inline-text">{workspacePickerMessage}</span>
            {projectOptions.length > 0 && onSelectWorkspace ? (
              <GitHistoryProjectPicker
                sections={projectSections}
                selectedId={workspace?.id ?? null}
                selectedLabel={workspace?.name ?? t("git.historyProject")}
                ariaLabel={t("git.historyProject")}
                searchPlaceholder={t("workspace.searchProjects")}
                emptyText={t("workspace.noProjectsFound")}
                disabled={isEmptyStateSelecting}
                onSelect={(nextWorkspaceId) => {
                  if (nextWorkspaceId && nextWorkspaceId !== workspace?.id) {
                    setWorkspaceSelectingId(nextWorkspaceId);
                    onSelectWorkspace(nextWorkspaceId);
                  }
                }}
              />
            ) : null}
            {canPickFallbackGitRoot ? (
              <GitHistoryProjectPicker
                sections={[
                  {
                    id: null,
                    name: "",
                    options: fallbackGitRoots.map((root) => ({ id: root, label: root })),
                  },
                ]}
                selectedId={fallbackSelectingRoot}
                selectedLabel={
                  fallbackSelectingRoot
                  || (fallbackGitRootsLoading
                    ? t("git.scanningRepositories")
                    : fallbackGitRoots.length > 0
                      ? t("git.chooseRepo")
                      : t("git.noRepositoriesFound"))
                }
                ariaLabel={t("git.chooseRepo")}
                searchPlaceholder={t("workspace.searchProjects")}
                emptyText={t("git.noRepositoriesFound")}
                disabled={
                  fallbackGitRootsLoading
                  || isEmptyStateSelecting
                  || fallbackGitRoots.length === 0
                }
                onSelect={(selectedRoot) => {
                  if (!selectedRoot) {
                    return;
                  }
                  void (async () => {
                    setFallbackSelectingRoot(selectedRoot);
                    try {
                      await handleFallbackGitRootSelect(selectedRoot);
                    } finally {
                      setFallbackSelectingRoot(null);
                    }
                  })();
                }}
              />
            ) : null}
            {fallbackGitRootsError ? (
              <span className="git-history-empty-inline-text">
                {localizeKnownGitError(fallbackGitRootsError) ?? fallbackGitRootsError}
              </span>
            ) : null}
          </div>
          {onRequestClose ? (
            <div className="git-history-toolbar-actions">
              <ActionSurface
                className="git-history-close-chip"
                onActivate={() => onRequestClose()}
                title={t("git.historyClosePanel")}
              >
                <X size={14} />
              </ActionSurface>
            </div>
          ) : null}
        </div>
        <div className="git-history-empty git-history-empty-body">
          <div className="git-history-empty-guide">
            <div className="git-history-empty-guide-title">
              {t("git.historyWorkspacePickerGuideTitle")}
            </div>
            <p className="git-history-empty-guide-line">
              {t("git.historyWorkspacePickerGuideStepCheck")}
            </p>
            <p className="git-history-empty-guide-line">
              {t("git.historyWorkspacePickerGuideStepScan")}
            </p>
            <p className="git-history-empty-guide-line">
              {t("git.historyWorkspacePickerGuideStepSelect")}
            </p>
          </div>
          <div className={`git-history-empty-progress ${isEmptyStateSelecting ? "is-busy" : ""}`}>
            {emptyStateStatusText}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="git-history-workbench"
      tabIndex={0}
      onKeyDown={(event) => {
        if (branchDiffState && event.key === "Escape") {
          event.preventDefault();
          closeBranchDiff();
          return;
        }
        if (branchContextMenu && event.key === "Escape") {
          event.preventDefault();
          closeBranchContextMenu();
          return;
        }
        if (pushDialogOpen && event.key === "Escape") {
          event.preventDefault();
          if (pushRemoteMenuOpen || pushTargetBranchMenuOpen) {
            setPushRemoteMenuOpen(false);
            setPushTargetBranchMenuOpen(false);
            return;
          }
          if (!pushSubmitting) {
            setPushDialogOpen(false);
          }
          return;
        }
        if (createPrDialogOpen && event.key === "Escape") {
          event.preventDefault();
          closeCreatePrDialog();
          return;
        }
        if (pullDialogOpen && event.key === "Escape") {
          event.preventDefault();
          if (pullRemoteMenuOpen || pullTargetBranchMenuOpen) {
            setPullRemoteMenuOpen(false);
            setPullTargetBranchMenuOpen(false);
            return;
          }
          if (!pullSubmitting) {
            setPullDialogOpen(false);
          }
          return;
        }
        if (syncDialogOpen && event.key === "Escape") {
          event.preventDefault();
          if (!syncSubmitting) {
            setSyncDialogOpen(false);
          }
          return;
        }
        if (fetchDialogOpen && event.key === "Escape") {
          event.preventDefault();
          if (!fetchSubmitting) {
            setFetchDialogOpen(false);
          }
          return;
        }
        if (refreshDialogOpen && event.key === "Escape") {
          event.preventDefault();
          if (!refreshSubmitting) {
            setRefreshDialogOpen(false);
          }
          return;
        }
        if (resetDialogOpen && event.key === "Escape") {
          event.preventDefault();
          setResetDialogOpen(false);
          return;
        }
        if (createBranchDialogOpen && event.key === "Escape") {
          event.preventDefault();
          if (!createBranchSubmitting) {
            setCreateBranchDialogOpen(false);
          }
          return;
        }
        if (renameBranchDialogOpen && event.key === "Escape") {
          event.preventDefault();
          closeRenameBranchDialog();
          return;
        }
        if (
          createBranchDialogOpen ||
          renameBranchDialogOpen ||
          resetDialogOpen ||
          pushDialogOpen ||
          createPrDialogOpen ||
          pullDialogOpen ||
          syncDialogOpen ||
          fetchDialogOpen ||
          refreshDialogOpen ||
          branchContextMenu ||
          branchDiffState
        ) {
          return;
        }
        const target = event.target as HTMLElement | null;
        const isTypingTarget = Boolean(
          target &&
            (target.tagName === "INPUT" ||
              target.tagName === "TEXTAREA" ||
              target.isContentEditable),
        );
        if (isTypingTarget) {
          return;
        }
          if (!commits.length) {
          return;
        }
        const currentIndex = commits.findIndex((entry) => entry.sha === selectedCommitSha);
        if (event.key === "ArrowDown") {
          event.preventDefault();
          const nextIndex = currentIndex < 0 ? 0 : Math.min(currentIndex + 1, commits.length - 1);
          setSelectedCommitSha(commits[nextIndex].sha);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          const nextIndex = currentIndex < 0 ? 0 : Math.max(currentIndex - 1, 0);
          setSelectedCommitSha(commits[nextIndex].sha);
        } else if (event.key === "Escape") {
          onRequestClose?.();
        }
      }}
    >
      <div className="git-history-toolbar">
        <div className="git-history-toolbar-left">
          <h2>{t("git.historyTitle")}</h2>
          {projectOptions.length > 0 && onSelectWorkspace ? (
            <GitHistoryProjectPicker
              sections={projectSections}
              selectedId={workspace.id}
              selectedLabel={workspace.name}
              ariaLabel={t("git.historyProject")}
              searchPlaceholder={t("workspace.searchProjects")}
              emptyText={t("workspace.noProjectsFound")}
              onSelect={(nextWorkspaceId) => {
                if (nextWorkspaceId && nextWorkspaceId !== workspace.id) {
                  setWorkspaceSelectingId(nextWorkspaceId);
                  onSelectWorkspace(nextWorkspaceId);
                }
              }}
            />
          ) : null}
          <div className="git-history-toolbar-meta">
            <span className="git-history-head-pill">HEAD</span>
            <code className="git-history-current-branch">{currentBranch ?? workspace.name}</code>
            <span
              className={`git-history-toolbar-worktree ${
                workingTreeChangedFiles > 0 ? "is-dirty" : "is-clean"
              }`}
            >
              {workingTreeSummaryLabel}
            </span>
            {workingTreeChangedFiles > 0 ? (
              <span className="git-history-toolbar-lines">
                <span className="git-history-diff-add">+{workingTreeTotalAdditions}</span>
                <span className="git-history-diff-sep" aria-hidden>
                  /
                </span>
                <span className="git-history-diff-del">-{workingTreeTotalDeletions}</span>
              </span>
            ) : null}
            <span className="git-history-toolbar-count">
              {t("git.historyCommitCount", { count: historyTotal })}
            </span>
          </div>
        </div>
        <div className="git-history-toolbar-actions">
          <div className="git-history-toolbar-action-group">
            <ActionSurface
              className="git-history-chip git-history-chip-pr"
              active={createPrDialogOpen}
              onActivate={handleOpenCreatePrDialog}
              disabled={!createPrCanOpen}
              title={createPrToolbarDisabledReason ?? t("git.historyCreatePr")}
            >
              <GitPullRequestCreate size={13} />
              <span>{t("git.historyCreatePr")}</span>
            </ActionSurface>
            <ActionSurface
              className="git-history-chip"
              active={pullDialogOpen}
              onActivate={handleOpenPullDialog}
              disabled={Boolean(operationLoading)}
              title={t("git.pull")}
            >
              <Download size={13} />
              <span>{t("git.pull")}</span>
            </ActionSurface>
            <ActionSurface
              className="git-history-chip"
              active={pushDialogOpen}
              onActivate={handleOpenPushDialog}
              disabled={Boolean(operationLoading)}
              title={t("git.push")}
            >
              <Upload size={13} />
              <span>{t("git.push")}</span>
            </ActionSurface>
            <ActionSurface
              className="git-history-chip"
              active={syncDialogOpen}
              onActivate={handleOpenSyncDialog}
              disabled={Boolean(operationLoading)}
              title={t("git.sync")}
            >
              <Repeat size={13} />
              <span>{t("git.sync")}</span>
            </ActionSurface>
            <ActionSurface
              className="git-history-chip"
              active={fetchDialogOpen}
              onActivate={handleOpenFetchDialog}
              disabled={Boolean(operationLoading)}
              title={t("git.fetch")}
            >
              <CloudDownload size={13} />
              <span>{t("git.fetch")}</span>
            </ActionSurface>
            <ActionSurface
              className="git-history-chip"
              active={refreshDialogOpen}
              onActivate={handleOpenRefreshDialog}
              disabled={Boolean(operationLoading) || historyLoading}
              title={t("git.refresh")}
            >
              <RefreshCw size={13} />
              <span>{t("git.refresh")}</span>
            </ActionSurface>
          </div>
          <ActionSurface
            className="git-history-close-chip"
            onActivate={() => onRequestClose?.()}
            title={t("git.historyClosePanel")}
          >
            <X size={14} />
          </ActionSurface>
        </div>
      </div>

      {operationNotice && (
        <div
          className={operationNotice.kind === "error" ? "git-history-error" : "git-history-success"}
          title={operationNotice.debugMessage}
        >
          <span>{operationNotice.message}</span>
          {operationNotice.kind === "error" ? (
            <button
              type="button"
              className="git-history-notice-close"
              onClick={clearOperationNotice}
              aria-label={t("common.close")}
              title={t("common.close")}
            >
              <X size={12} />
            </button>
          ) : null}
        </div>
      )}
      {localizedOperationName && (
        <div className="git-history-status">
          {t("git.historyRunningOperation", { operation: localizedOperationName })}
        </div>
      )}

      <div
        className={`git-history-grid${desktopSplitLayout ? " with-vertical-resizers" : ""}`}
        ref={workbenchGridRef}
        style={workbenchGridStyle}
      >
        <aside className="git-history-overview">
          <div className="git-history-overview-toolbar is-files-top-row">
            <div className="git-history-overview-list-toggle" role="group" aria-label={t("git.listView")}>
              <button
                type="button"
                className={`git-history-overview-list-tab${
                  overviewListView === "flat" ? " is-active" : ""
                }`}
                onClick={() => setOverviewListView("flat")}
                aria-pressed={overviewListView === "flat"}
                aria-label={t("git.listFlat")}
                title={t("git.listFlat")}
              >
                <LayoutGrid size={13} />
                <span>{t("git.listFlat")}</span>
              </button>
              <button
                type="button"
                className={`git-history-overview-list-tab${
                  overviewListView === "tree" ? " is-active" : ""
                }`}
                onClick={() => setOverviewListView("tree")}
                aria-pressed={overviewListView === "tree"}
                aria-label={t("git.listTree")}
                title={t("git.listTree")}
              >
                <FolderTree size={13} />
                <span>{t("git.listTree")}</span>
              </button>
              <button
                type="button"
                className={`git-history-overview-list-tab${
                  !overviewCommitSectionCollapsed ? " is-active" : ""
                }`}
                onClick={() => setOverviewCommitSectionCollapsed((value) => !value)}
                aria-pressed={!overviewCommitSectionCollapsed}
                aria-label={t("git.toggleCommitSection")}
                title={
                  overviewCommitSectionCollapsed
                    ? t("git.expandCommitSection")
                    : t("git.collapseCommitSection")
                }
              >
                {!overviewCommitSectionCollapsed ? <ChevronsDownUp size={13} /> : <ChevronsUpDown size={13} />}
                <span>{t("git.commit")}</span>
              </button>
            </div>
          </div>
          <GitHistoryWorktreePanel
            workspaceId={workspace.id}
            listView={overviewListView}
            commitSectionCollapsed={overviewCommitSectionCollapsed}
            rootFolderName={repositoryRootName}
            onMutated={() => refreshAll()}
            onSummaryChange={handleWorktreeSummaryChange}
            onOpenDiffPath={(path) => {
              void handleOpenWorktreePreview(path);
            }}
          />
        </aside>

        {desktopSplitLayout && (
          <div
            className="git-history-vertical-resizer"
            role="separator"
            aria-orientation="vertical"
            onMouseDown={handleOverviewSplitResizeStart}
            onDoubleClick={() => {
              const defaults = getCurrentDefaultColumnWidths();
              setOverviewWidth(defaults.overviewWidth);
            }}
          />
        )}

        <div
          className={`git-history-main-grid${desktopSplitLayout ? " with-vertical-resizers" : ""}`}
          ref={mainGridRef}
          style={mainGridStyle}
        >
        <section className="git-history-branches">
          <div className="git-history-column-header">
            <span>
              <GitBranch size={14} /> {t("git.historyBranches")}
            </span>
            <div className="git-history-branch-actions">
              <ActionSurface
                className="git-history-mini-chip"
                onActivate={() => void handleCreateBranch()}
                disabled={Boolean(operationLoading) || createBranchSourceOptions.length === 0}
                title={t("git.historyNew")}
                ariaLabel={t("git.historyNew")}
              >
                <Plus size={13} aria-hidden />
              </ActionSurface>
              <ActionSurface
                className="git-history-mini-chip"
                onActivate={() => handleOpenRenameBranchDialog(selectedLocalBranchForRename)}
                disabled={Boolean(DISABLE_HISTORY_ACTION_BUTTONS || renameBranchToolbarDisabledReason)}
                title={renameBranchToolbarDisabledReason ?? t("git.historyRename")}
                ariaLabel={t("git.historyRename")}
              >
                <Pencil size={13} aria-hidden />
              </ActionSurface>
              <ActionSurface
                className="git-history-mini-chip"
                onActivate={() => void handleDeleteBranch()}
                title={t("git.historyDelete")}
                ariaLabel={t("git.historyDelete")}
              >
                <Trash2 size={13} aria-hidden />
              </ActionSurface>
              <ActionSurface
                className="git-history-mini-chip"
                onActivate={() => void handleMergeBranch()}
                title={t("git.historyMerge")}
                ariaLabel={t("git.historyMerge")}
              >
                <GitMerge size={13} aria-hidden />
              </ActionSurface>
            </div>
          </div>
          <label className="git-history-search">
            <Search size={14} />
            <input
              value={branchQuery}
              onChange={(event) => setBranchQuery(event.target.value)}
              placeholder={t("git.historySearchBranches")}
            />
          </label>
          <div className="git-history-branch-list">
            <ActionSurface
              className="git-history-branch-item git-history-branch-all-item"
              active={selectedBranch === "all"}
              onActivate={() => setSelectedBranch("all")}
            >
              <span>{t("git.historyAllBranches")}</span>
            </ActionSurface>

            <div className="git-history-tree-section">
              <ActionSurface
                className="git-history-tree-section-toggle"
                onActivate={() => setLocalSectionExpanded((prev) => !prev)}
                ariaLabel={t("git.historyToggleLocalBranches")}
              >
                {localSectionExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <HardDrive size={13} />
                <span>{t("git.historyLocal")}</span>
              </ActionSurface>
              {localSectionExpanded && (
                <div className="git-history-tree-section-body">
                  {groupedLocalBranches.map((group) => {
                    const scopeExpanded = expandedLocalScopes.has(group.key);
                    return (
                      <div key={`local-group-${group.key}`} className="git-history-tree-scope-group">
                        <ActionSurface
                          className="git-history-tree-scope-toggle"
                          onActivate={() => handleToggleLocalScope(group.key)}
                          ariaLabel={t("git.historyToggleLocalGroup", { group: group.label })}
                        >
                          {scopeExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          {scopeExpanded ? <FolderOpen size={12} /> : <Folder size={12} />}
                          <span className="git-history-tree-scope-label">{group.label}</span>
                        </ActionSurface>
                        {scopeExpanded &&
                          group.items.map((entry) => (
                            <div
                              key={`local-${entry.name}`}
                              className="git-history-branch-row"
                              onContextMenu={(event) => handleOpenBranchContextMenu(event, entry, "local")}
                            >
                              <ActionSurface
                                className={`git-history-branch-item git-history-branch-item-tree ${
                                  entry.isCurrent ? "is-head-branch" : ""
                                }`}
                                active={selectedBranch === entry.name}
                                onActivate={() => setSelectedBranch(entry.name)}
                              >
                                <span className="git-history-tree-branch-main">
                                  <GitBranch size={11} />
                                  <span className="git-history-branch-name">
                                    {getBranchLeafName(entry.name)}
                                  </span>
                                </span>
                                <span className="git-history-branch-badges">
                                  {entry.isCurrent ? <em className="is-head">HEAD</em> : null}
                                  {getSpecialBranchBadges(entry.name, t).map((badge) => (
                                    <i key={`${entry.name}-${badge}`} className="is-special">
                                      {badge}
                                    </i>
                                  ))}
                                  {entry.ahead > 0 ? <i className="is-ahead">+{entry.ahead}</i> : null}
                                  {entry.behind > 0 ? <i className="is-behind">-{entry.behind}</i> : null}
                                </span>
                              </ActionSurface>
                            </div>
                          ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="git-history-tree-section">
              <ActionSurface
                className="git-history-tree-section-toggle"
                onActivate={() => setRemoteSectionExpanded((prev) => !prev)}
                ariaLabel={t("git.historyToggleRemoteBranches")}
              >
                {remoteSectionExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <Cloud size={13} />
                <span>{t("git.historyRemote")}</span>
              </ActionSurface>
              {remoteSectionExpanded && (
                <div className="git-history-tree-section-body">
                  {groupedRemoteBranches.map((group) => {
                    const scopeExpanded = expandedRemoteScopes.has(group.remote);
                    return (
                      <div key={`remote-group-${group.remote}`} className="git-history-tree-scope-group">
                        <ActionSurface
                          className="git-history-tree-scope-toggle"
                          onActivate={() => handleToggleRemoteScope(group.remote)}
                          ariaLabel={t("git.historyToggleRemoteGroup", { group: group.remote })}
                        >
                          {scopeExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          {scopeExpanded ? <FolderOpen size={12} /> : <Folder size={12} />}
                          <span className="git-history-tree-scope-label">{group.remote}</span>
                        </ActionSurface>
                        {scopeExpanded &&
                          group.items.map((entry) => (
                            <div
                              key={`remote-${entry.name}`}
                              className="git-history-branch-row git-history-branch-row-remote"
                              onContextMenu={(event) => handleOpenBranchContextMenu(event, entry, "remote")}
                            >
                              <ActionSurface
                                className="git-history-branch-item git-history-branch-item-remote-tree"
                                active={selectedBranch === entry.name}
                                onActivate={() => setSelectedBranch(entry.name)}
                              >
                                <span className="git-history-tree-branch-main">
                                  <GitBranch size={11} />
                                  <span className="git-history-branch-name">
                                    {trimRemotePrefix(entry.name, group.remote)}
                                  </span>
                                </span>
                                <span className="git-history-branch-badges">
                                  {getSpecialBranchBadges(entry.name, t).map((badge) => (
                                    <i key={`${entry.name}-${badge}`} className="is-special">
                                      {badge}
                                    </i>
                                  ))}
                                </span>
                              </ActionSurface>
                            </div>
                          ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </section>

        {desktopSplitLayout && (
          <div
            className="git-history-vertical-resizer"
            role="separator"
            aria-orientation="vertical"
            onMouseDown={handleBranchesSplitResizeStart}
            onDoubleClick={() => {
              const defaults = getCurrentDefaultColumnWidths();
              setBranchesWidth(defaults.branchesWidth);
              setCommitsWidth(defaults.commitsWidth);
            }}
          />
        )}

        <section className="git-history-commits">
          <div className="git-history-column-header">
            <span>
              <GitCommit size={14} /> {t("git.historyCommits")}
            </span>
          </div>
          <label className="git-history-search">
            <Search size={14} />
            <input
              value={commitQuery}
              onChange={(event) => setCommitQuery(event.target.value)}
              placeholder={t("git.historySearchCommits")}
            />
          </label>

          {historyError && (
            <div className="git-history-error">
              {localizeKnownGitError(historyError) ?? historyError}
            </div>
          )}
          {!historyError && historyLoading && (
            <div className="git-history-empty">{t("git.historyLoadingCommits")}</div>
          )}
          {!historyLoading && !commits.length && (
            <div className="git-history-empty">{t("git.historyNoCommitsFound")}</div>
          )}

          <div className="git-history-commit-list" ref={commitListRef}>
            <div
              className="git-history-commit-list-virtual"
              style={{ height: `${commitRowVirtualizer.getTotalSize()}px` }}
            >
              {virtualCommitRows.map((virtualRow) => {
                const entry = commits[virtualRow.index];
                if (!entry) {
                  return null;
                }
              const active = selectedCommitSha === entry.sha;
              const graphClassName = [
                "git-history-graph",
                  virtualRow.index === 0 ? "is-first" : "",
                  virtualRow.index === commits.length - 1 ? "is-last" : "",
              ]
                .filter(Boolean)
                .join(" ");

              return (
                <ActionSurface
                  key={entry.sha}
                  className="git-history-commit-row"
                  active={active}
                  onActivate={() => setSelectedCommitSha(entry.sha)}
                  onContextMenu={(event) => handleOpenCommitContextMenu(event, entry.sha)}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                >
                  <span className={graphClassName} aria-hidden>
                    <i className="git-history-graph-line" />
                    <i className="git-history-graph-dot" />
                  </span>
                  <span className="git-history-commit-content">
                    <span
                      className="git-history-commit-summary"
                      title={entry.summary || t("git.historyNoMessage")}
                    >
                      {entry.summary || t("git.historyNoMessage")}
                    </span>
                    <span className="git-history-commit-meta">
                      <code>{entry.shortSha}</code>
                      <em>{entry.author || t("git.unknown")}</em>
                      <time>{formatRelativeTime(entry.timestamp, t)}</time>
                    </span>
                    {entry.refs.length > 0 && (
                      <span className="git-history-commit-refs" title={entry.refs.join(", ")}>
                        {entry.refs.slice(0, 3).join(" · ")}
                      </span>
                    )}
                  </span>
                </ActionSurface>
              );
              })}
            </div>
          </div>

          {historyHasMore && (
            <div className="git-history-load-more">
              <ActionSurface
                className="git-history-load-more-chip"
                disabled={historyLoadingMore}
                onActivate={() => void loadHistory(true, commits.length)}
              >
                {historyLoadingMore ? t("common.loading") : t("git.historyLoadMore")}
              </ActionSurface>
            </div>
          )}
        </section>

        {desktopSplitLayout && (
          <div
            className="git-history-vertical-resizer"
            role="separator"
            aria-orientation="vertical"
            onMouseDown={handleCommitsSplitResizeStart}
            onDoubleClick={() => {
              const defaults = getCurrentDefaultColumnWidths();
              setCommitsWidth(defaults.commitsWidth);
            }}
          />
        )}

        <section className="git-history-details">
          <div className="git-history-column-header">
            <span>
              {details ? <FolderTree size={14} /> : <FileText size={14} />}
              {details ? t("git.historyChangedFiles") : t("git.historyCommitDetails")}
            </span>
            {details && (
              <span className="git-history-file-tree-head-summary">
                {renderChangedFilesSummary(
                  t,
                  details.files.length,
                  details.totalAdditions,
                  details.totalDeletions,
                )}
              </span>
            )}
          </div>

          {detailsError && (
            <div className="git-history-error">
              {localizeKnownGitError(detailsError) ?? detailsError}
            </div>
          )}
          {!detailsError && detailsLoading && (
            <div className="git-history-empty">{t("git.historyLoadingCommitDetails")}</div>
          )}
          {!detailsLoading && !details && (
            <div className="git-history-empty">{t("git.historySelectCommitToViewDetails")}</div>
          )}

          {details && (
            <>
              <div
                className="git-history-details-body"
                ref={detailsBodyRef}
                style={{
                  gridTemplateRows: `minmax(140px, ${detailsSplitRatio}%) 8px minmax(0, 1fr)`,
                }}
              >
                <div className="git-history-file-list git-filetree-section">
                  {!fileTreeItems.length && (
                    <div className="git-history-empty">
                      {t("git.historyNoFileChangesInCommit")}
                    </div>
                  )}

                  {fileTreeItems.map((item) => {
                    const treeIndentPx = item.depth * 14;
                    const treeGuideDepth = item.depth > 0 ? 1 : 0;
                    const treeRowStyle = {
                      paddingLeft: `${treeIndentPx}px`,
                      ["--git-tree-indent-x" as string]: `${Math.max(treeGuideDepth * 14 - 7, 0)}px`,
                      ["--git-tree-line-opacity" as string]: getTreeLineOpacity(treeGuideDepth),
                    } as CSSProperties;
                    if (item.type === "dir") {
                      return (
                        <ActionSurface
                          key={item.id}
                          className="git-history-tree-item git-history-tree-dir git-filetree-folder-row"
                          onActivate={() => handleFileTreeDirToggle(item.path)}
                          style={treeRowStyle}
                        >
                          <span className="git-history-tree-caret" aria-hidden>
                            {item.expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          </span>
                          <span className="git-history-tree-icon" aria-hidden>
                            <FileIcon filePath={item.path} isFolder isOpen={item.expanded} />
                          </span>
                          <span className="git-history-tree-label">{item.label}</span>
                        </ActionSurface>
                      );
                    }

                    const file = item.change;
                    const active = selectedFileKey === buildFileKey(file);
                    return (
                      <ActionSurface
                        key={item.id}
                        className="git-history-tree-item git-history-file-item git-filetree-row"
                        active={active}
                        onActivate={() => {
                          const fileKey = buildFileKey(file);
                          setSelectedFileKey(fileKey);
                          setPreviewFileKey(fileKey);
                        }}
                        style={treeRowStyle}
                        title={statusLabel(file)}
                      >
                        <span
                          className={`git-history-file-status git-status-${file.status.toLowerCase()}`}
                        >
                          {file.status}
                        </span>
                        <span className="git-history-tree-icon is-file" aria-hidden>
                          <FileIcon filePath={file.path} />
                        </span>
                        <span className="git-history-file-path">{item.label}</span>
                        <span className="git-history-file-stats git-filetree-badge">
                          <span className="is-add">+{file.additions}</span>
                          <span className="is-sep">/</span>
                          <span className="is-del">-{file.deletions}</span>
                        </span>
                      </ActionSurface>
                    );
                  })}
                </div>

                <div
                  className="git-history-details-resizer"
                  role="separator"
                  aria-orientation="horizontal"
                  aria-label={t("git.historyResizeFileListAndDiff")}
                  onMouseDown={handleDetailsSplitResizeStart}
                  onDoubleClick={() => setDetailsSplitRatio(DEFAULT_DETAILS_SPLIT)}
                />

                <div className="git-history-diff-view">
                  <div className="git-history-message-panel">
                    <div className="git-history-message-row">
                      <span className="git-history-message-label">{t("git.historyCommitMetaTitleLabel")}</span>
                      <strong className="git-history-message-title">
                        {details.summary || t("git.historyNoMessage")}
                      </strong>
                    </div>
                    <div className="git-history-message-row">
                      <span className="git-history-message-label">{t("git.historyCommitMetaContentLabel")}</span>
                      <div className="git-history-message-content">
                        {detailsMessageContent}
                      </div>
                    </div>
                    <div className="git-history-message-meta-row">
                      <span className="git-history-message-meta-item">
                        <i>{t("git.historyCommitMetaAuthorLabel")}</i>
                        <span>{details.author || t("git.unknown")}</span>
                      </span>
                      <span className="git-history-message-meta-item">
                        <i>{t("git.historyCommitMetaTimeLabel")}</i>
                        <time>{new Date(details.commitTime * 1000).toLocaleString()}</time>
                      </span>
                      <span className="git-history-message-meta-item">
                        <i>{t("git.historyCommitMetaIdLabel")}</i>
                        <code>{details.sha}</code>
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {previewDetailFile && (
                <div
                  className="git-history-diff-modal-overlay"
                  role="presentation"
                  onClick={() => setPreviewFileKey(null)}
                >
                  <div
                    className={`git-history-diff-modal ${isHistoryDiffModalMaximized ? "is-maximized" : ""}`}
                    role="dialog"
                    aria-modal="true"
                    aria-label={previewDetailFile.path}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div className="git-history-diff-modal-header">
                      <div className="git-history-diff-modal-title">
                        <span
                          className={`git-history-file-status git-status-${previewDetailFile.status.toLowerCase()}`}
                        >
                          {previewDetailFile.status}
                        </span>
                        <span className="git-history-tree-icon is-file" aria-hidden>
                          <FileIcon filePath={previewDetailFile.path} />
                        </span>
                        <span className="git-history-diff-modal-path">{previewDetailFile.path}</span>
                        <span className="git-history-diff-modal-stats">
                          <span className="is-add">+{previewDetailFile.additions}</span>
                          <span className="is-sep">/</span>
                          <span className="is-del">-{previewDetailFile.deletions}</span>
                        </span>
                      </div>
                      <div className="git-history-diff-modal-actions">
                        <button
                          type="button"
                          className="git-history-diff-modal-close"
                          onClick={() => setIsHistoryDiffModalMaximized((value) => !value)}
                          aria-label={isHistoryDiffModalMaximized ? t("common.restore") : t("menu.maximize")}
                          title={isHistoryDiffModalMaximized ? t("common.restore") : t("menu.maximize")}
                        >
                          <span className="git-history-diff-modal-close-glyph" aria-hidden>
                            {isHistoryDiffModalMaximized ? "❐" : "□"}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="git-history-diff-modal-close"
                          onClick={() => setPreviewFileKey(null)}
                          aria-label={t("common.close")}
                          title={t("common.close")}
                        >
                          <span className="git-history-diff-modal-close-glyph" aria-hidden>
                            ×
                          </span>
                        </button>
                      </div>
                    </div>

                    {previewDetailFile.truncated && !previewDetailFile.isBinary && (
                      <div className="git-history-warning">
                        {t("git.historyDiffTooLargeTruncated", {
                          lineCount: previewDetailFile.lineCount,
                        })}
                      </div>
                    )}
                    {previewDetailFile.isBinary ? (
                      <pre className="git-history-diff-modal-code">{previewDetailFileDiff}</pre>
                    ) : (
                      <div className="git-history-diff-modal-viewer">
                        <GitDiffViewer
                          workspaceId={workspaceId}
                          diffs={previewDiffEntries}
                          selectedPath={previewDetailFile.path}
                          isLoading={false}
                          error={null}
                          listView="flat"
                          stickyHeaderMode="controls-only"
                          showContentModeControls
                          fullDiffLoader={previewModalFullDiffLoader}
                          fullDiffSourceKey={selectedCommitSha}
                          diffStyle={diffViewMode}
                          onDiffStyleChange={setDiffViewMode}
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </section>
        {worktreePreviewFile && (
          <div
            className="git-history-diff-modal-overlay"
            role="presentation"
            onClick={closeWorktreePreview}
          >
            <div
              className={`git-history-diff-modal ${isHistoryDiffModalMaximized ? "is-maximized" : ""}`}
              role="dialog"
              aria-modal="true"
              aria-label={worktreePreviewFile.path}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="git-history-diff-modal-header">
                <div className="git-history-diff-modal-title">
                  <span className={`git-history-file-status git-status-${worktreePreviewFile.status.toLowerCase()}`}>
                    {worktreePreviewFile.status}
                  </span>
                  <span className="git-history-tree-icon is-file" aria-hidden>
                    <FileIcon filePath={worktreePreviewFile.path} />
                  </span>
                  <span className="git-history-diff-modal-path">{worktreePreviewFile.path}</span>
                  <span className="git-history-diff-modal-stats">
                    <span className="is-add">+{worktreePreviewFile.additions}</span>
                    <span className="is-sep">/</span>
                    <span className="is-del">-{worktreePreviewFile.deletions}</span>
                  </span>
                </div>
                <div className="git-history-diff-modal-actions">
                  <button
                    type="button"
                    className="git-history-diff-modal-close"
                    onClick={() => setIsHistoryDiffModalMaximized((value) => !value)}
                    aria-label={isHistoryDiffModalMaximized ? t("common.restore") : t("menu.maximize")}
                    title={isHistoryDiffModalMaximized ? t("common.restore") : t("menu.maximize")}
                  >
                    <span className="git-history-diff-modal-close-glyph" aria-hidden>
                      {isHistoryDiffModalMaximized ? "❐" : "□"}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="git-history-diff-modal-close"
                    onClick={closeWorktreePreview}
                    aria-label={t("common.close")}
                    title={t("common.close")}
                  >
                    <span className="git-history-diff-modal-close-glyph" aria-hidden>
                      ×
                    </span>
                  </button>
                </div>
              </div>
              {worktreePreviewError ? (
                <div className="git-history-error">
                  {localizeKnownGitError(worktreePreviewError) ?? worktreePreviewError}
                </div>
              ) : null}
              {worktreePreviewLoading ? (
                <div className="git-history-empty">{t("common.loading")}</div>
              ) : worktreePreviewFile.isBinary || !(worktreePreviewFile.diff ?? "").trim() ? (
                <pre className="git-history-diff-modal-code">{worktreePreviewDiffText}</pre>
              ) : (
                <div className="git-history-diff-modal-viewer">
                  <GitDiffViewer
                    workspaceId={workspaceId}
                    diffs={worktreePreviewDiffEntries}
                    selectedPath={worktreePreviewFile.path}
                    isLoading={false}
                    error={null}
                    listView="flat"
                    stickyHeaderMode="controls-only"
                    showContentModeControls
                    fullDiffLoader={worktreePreviewFullDiffLoader}
                    fullDiffSourceKey={worktreePreviewFile.path}
                    diffStyle={diffViewMode}
                    onDiffStyleChange={setDiffViewMode}
                  />
                </div>
              )}
            </div>
          </div>
        )}
        </div>
        {branchDiffState ? (
          <div
            className="git-history-diff-modal-overlay"
            role="presentation"
            onClick={closeBranchDiff}
          >
            <div
              className={`git-history-diff-modal ${
                branchDiffState.mode === "worktree"
                  ? `git-history-branch-worktree-diff-modal ${branchDiffModeClassName}`
                  : "git-history-branch-compare-modal"
              } ${isHistoryDiffModalMaximized ? "is-maximized" : ""}`}
              role="dialog"
              aria-modal="true"
              aria-label={branchDiffTitle}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="git-history-diff-modal-header">
                <div className="git-history-diff-modal-title git-history-branch-worktree-diff-title">
                  <span className="git-history-branch-worktree-diff-title-main">
                    <span
                      className={`git-history-branch-worktree-diff-title-icon ${branchDiffModeClassName}`}
                      aria-hidden
                    >
                      {isWorktreeDiffMode ? <FolderTree size={14} /> : <GitCommit size={14} />}
                    </span>
                    <span className={`git-history-branch-worktree-diff-mode-badge ${branchDiffModeClassName}`}>
                      {branchDiffModeLabel}
                    </span>
                    <span className="git-history-branch-worktree-diff-title-text">{branchDiffTitle}</span>
                  </span>
                  <span className="git-history-branch-worktree-diff-subtitle">{branchDiffSubtitle}</span>
                  <span className="git-history-diff-modal-stats git-history-branch-worktree-diff-stats">
                    {branchDiffStatsLabel}
                  </span>
                </div>
                <div className="git-history-diff-modal-actions">
                  <button
                    type="button"
                    className="git-history-diff-modal-close"
                    onClick={() => setIsHistoryDiffModalMaximized((value) => !value)}
                    aria-label={isHistoryDiffModalMaximized ? t("common.restore") : t("menu.maximize")}
                    title={isHistoryDiffModalMaximized ? t("common.restore") : t("menu.maximize")}
                  >
                    <span className="git-history-diff-modal-close-glyph" aria-hidden>
                      {isHistoryDiffModalMaximized ? "❐" : "□"}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="git-history-diff-modal-close"
                    onClick={closeBranchDiff}
                    aria-label={t("common.close")}
                    title={t("common.close")}
                  >
                    <span className="git-history-diff-modal-close-glyph" aria-hidden>
                      ×
                    </span>
                  </button>
                </div>
              </div>

              {branchDiffState.loading ? (
                <div className="git-history-empty">{t("common.loading")}</div>
              ) : branchDiffState.error ? (
                <div className="git-history-error">{branchDiffState.error}</div>
              ) : branchDiffState.mode === "worktree" ? (
                branchDiffState.files.length === 0 ? (
                  <div className="git-history-empty">{t("git.historyBranchWorktreeDiffEmpty")}</div>
                ) : (
                  <div className="git-history-branch-worktree-diff-layout">
                    <div className="git-history-branch-worktree-diff-detail">
                      {!branchDiffState.selectedPath ? (
                        <div className="git-history-empty">
                          {t("git.historyBranchWorktreeDiffSelectFile")}
                        </div>
                      ) : branchDiffState.selectedDiffLoading ? (
                        <div className="git-history-empty">{t("common.loading")}</div>
                      ) : branchDiffState.selectedDiffError ? (
                        <div className="git-history-error">{branchDiffState.selectedDiffError}</div>
                      ) : branchDiffState.selectedDiff ? (
                        <div className="git-history-diff-modal-viewer">
                          <GitDiffViewer
                            workspaceId={workspaceId}
                            diffs={[branchDiffState.selectedDiff]}
                            selectedPath={branchDiffState.selectedDiff.path}
                            isLoading={false}
                            error={null}
                            listView="flat"
                            stickyHeaderMode="controls-only"
                            showContentModeControls
                            diffStyle={diffViewMode}
                            onDiffStyleChange={setDiffViewMode}
                          />
                        </div>
                      ) : (
                        <div className="git-history-empty">{t("git.diffUnavailable")}</div>
                      )}
                    </div>
                    <div className="git-history-branch-worktree-diff-files">
                      <div className="git-history-branch-worktree-diff-files-title">
                        {t("git.historyBranchWorktreeDiffFilesTitle")}
                      </div>
                      <div className="git-history-branch-worktree-diff-files-list">
                        {branchDiffState.files.map((entry) => (
                          <button
                            key={entry.path}
                            type="button"
                            className={`git-history-branch-worktree-diff-file${
                              branchDiffState.selectedPath === entry.path ? " is-active" : ""
                            }`}
                            onClick={() => {
                              void handleSelectWorktreeDiffFile(
                                branchDiffState.branch,
                                branchDiffState.compareBranch,
                                entry,
                              );
                            }}
                          >
                            <span
                              className={`git-history-file-status git-status-${entry.status.toLowerCase()}`}
                            >
                              {entry.status}
                            </span>
                            <span className="git-history-branch-worktree-diff-file-path">
                              {entry.path}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )
              ) : (
                <div className="git-history-branch-compare-layout">
                  <div className="git-history-branch-compare-lists">
                    <section className="git-history-branch-compare-list-card is-target">
                      <header className="git-history-branch-compare-list-header is-target">
                        <span className="git-history-branch-compare-list-title-wrap">
                          <span className="git-history-branch-compare-list-dot" aria-hidden />
                          <span className="git-history-branch-compare-list-title">
                            {t("git.historyBranchCompareDirectionTargetOnly", {
                              target: branchDiffState.branch,
                              current: branchDiffState.compareBranch,
                            })}
                          </span>
                        </span>
                        <span className="git-history-branch-compare-list-count">
                          {t("git.historyCommitCount", { count: branchDiffState.targetOnlyCommits.length })}
                        </span>
                      </header>
                      {branchDiffState.targetOnlyCommits.length === 0 ? (
                        <div className="git-history-empty">
                          {t("git.historyBranchCompareDirectionEmpty")}
                        </div>
                      ) : (
                        <div className="git-history-branch-compare-list">
                          {branchDiffState.targetOnlyCommits.map((entry) => (
                            <button
                              key={`target-${entry.sha}`}
                              type="button"
                              className={`git-history-branch-compare-commit${
                                branchDiffState.selectedDirection === "targetOnly"
                                && branchDiffState.selectedCommitSha === entry.sha
                                  ? " is-active"
                                  : ""
                              }`}
                              onClick={() => {
                                void handleSelectBranchCompareCommit(
                                  branchDiffState.branch,
                                  branchDiffState.compareBranch,
                                  "targetOnly",
                                  entry,
                                );
                              }}
                            >
                              <span className="git-history-branch-compare-commit-summary">
                                {entry.summary || t("git.historyNoMessage")}
                              </span>
                              <span className="git-history-branch-compare-commit-meta">
                                <code>{entry.shortSha}</code>
                                <span>{entry.author}</span>
                                <time>{formatRelativeTime(entry.timestamp, t)}</time>
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </section>

                    <section className="git-history-branch-compare-list-card is-current">
                      <header className="git-history-branch-compare-list-header is-current">
                        <span className="git-history-branch-compare-list-title-wrap">
                          <span className="git-history-branch-compare-list-dot" aria-hidden />
                          <span className="git-history-branch-compare-list-title">
                            {t("git.historyBranchCompareDirectionCurrentOnly", {
                              target: branchDiffState.branch,
                              current: branchDiffState.compareBranch,
                            })}
                          </span>
                        </span>
                        <span className="git-history-branch-compare-list-count">
                          {t("git.historyCommitCount", { count: branchDiffState.currentOnlyCommits.length })}
                        </span>
                      </header>
                      {branchDiffState.currentOnlyCommits.length === 0 ? (
                        <div className="git-history-empty">
                          {t("git.historyBranchCompareDirectionEmpty")}
                        </div>
                      ) : (
                        <div className="git-history-branch-compare-list">
                          {branchDiffState.currentOnlyCommits.map((entry) => (
                            <button
                              key={`current-${entry.sha}`}
                              type="button"
                              className={`git-history-branch-compare-commit${
                                branchDiffState.selectedDirection === "currentOnly"
                                && branchDiffState.selectedCommitSha === entry.sha
                                  ? " is-active"
                                  : ""
                              }`}
                              onClick={() => {
                                void handleSelectBranchCompareCommit(
                                  branchDiffState.branch,
                                  branchDiffState.compareBranch,
                                  "currentOnly",
                                  entry,
                                );
                              }}
                            >
                              <span className="git-history-branch-compare-commit-summary">
                                {entry.summary || t("git.historyNoMessage")}
                              </span>
                              <span className="git-history-branch-compare-commit-meta">
                                <code>{entry.shortSha}</code>
                                <span>{entry.author}</span>
                                <time>{formatRelativeTime(entry.timestamp, t)}</time>
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </section>
                  </div>

                  <div className="git-history-branch-compare-detail">
                    {!branchDiffState.selectedCommitSha ? (
                      <div className="git-history-empty">
                        {t("git.historyBranchCompareSelectCommit")}
                      </div>
                    ) : branchDiffState.selectedCommitLoading ? (
                      <div className="git-history-empty">{t("common.loading")}</div>
                    ) : branchDiffState.selectedCommitError ? (
                      <div className="git-history-error">{branchDiffState.selectedCommitError}</div>
                    ) : branchDiffState.selectedCommitDetails ? (
                      <div className="git-history-branch-compare-detail-body">
                        <div className="git-history-branch-compare-detail-summary">
                          {branchDiffState.selectedCommitDetails.summary || t("git.historyNoMessage")}
                        </div>
                        <div className="git-history-branch-compare-detail-meta">
                          <code>{branchDiffState.selectedCommitDetails.sha.slice(0, 7)}</code>
                          <span>{branchDiffState.selectedCommitDetails.author}</span>
                          <time>
                            {new Date(branchDiffState.selectedCommitDetails.commitTime * 1000).toLocaleString()}
                          </time>
                        </div>
                        {branchDiffState.selectedCommitDetails.message.trim().length > 0 ? (
                          <pre className="git-history-branch-compare-detail-message">
                            {branchDiffState.selectedCommitDetails.message.trim()}
                          </pre>
                        ) : null}
                        <div className="git-history-branch-compare-files-title">
                          {renderChangedFilesSummary(
                            t,
                            branchDiffState.selectedCommitDetails.files.length,
                            branchDiffState.selectedCommitDetails.totalAdditions,
                            branchDiffState.selectedCommitDetails.totalDeletions,
                          )}
                        </div>
                        {branchDiffState.selectedCommitDetails.files.length === 0 ? (
                          <div className="git-history-empty">{t("git.historyNoFileChangesInCommit")}</div>
                        ) : (
                          <div className="git-history-branch-compare-files-list">
                            {branchDiffState.selectedCommitDetails.files.map((file) => {
                              const fileKey = buildFileKey(file);
                              return (
                                <button
                                  key={fileKey}
                                  type="button"
                                  className={`git-history-branch-compare-file${
                                    comparePreviewFileKey === fileKey ? " is-active" : ""
                                  }`}
                                  onClick={() => setComparePreviewFileKey(fileKey)}
                                  title={statusLabel(file)}
                                >
                                  <span
                                    className={`git-history-file-status git-status-${file.status.toLowerCase()}`}
                                  >
                                    {file.status}
                                  </span>
                                  <span className="git-history-branch-compare-file-path">
                                    {statusLabel(file)}
                                  </span>
                                  <span className="git-history-branch-compare-file-stats">
                                    +{file.additions} / -{file.deletions}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="git-history-empty">{t("git.diffUnavailable")}</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : null}
        {comparePreviewDetailFile ? (
          <div
            className="git-history-diff-modal-overlay"
            role="presentation"
            onClick={() => setComparePreviewFileKey(null)}
          >
            <div
              className={`git-history-diff-modal ${isHistoryDiffModalMaximized ? "is-maximized" : ""}`}
              role="dialog"
              aria-modal="true"
              aria-label={comparePreviewDetailFile.path}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="git-history-diff-modal-header">
                <div className="git-history-diff-modal-title">
                  <span
                    className={`git-history-file-status git-status-${comparePreviewDetailFile.status.toLowerCase()}`}
                  >
                    {comparePreviewDetailFile.status}
                  </span>
                  <span className="git-history-diff-modal-path">{comparePreviewDetailFile.path}</span>
                  <span className="git-history-diff-modal-stats">
                    +{comparePreviewDetailFile.additions} / -{comparePreviewDetailFile.deletions}
                  </span>
                </div>
                <div className="git-history-diff-modal-actions">
                  <button
                    type="button"
                    className="git-history-diff-modal-close"
                    onClick={() => setIsHistoryDiffModalMaximized((value) => !value)}
                    aria-label={isHistoryDiffModalMaximized ? t("common.restore") : t("menu.maximize")}
                    title={isHistoryDiffModalMaximized ? t("common.restore") : t("menu.maximize")}
                  >
                    <span className="git-history-diff-modal-close-glyph" aria-hidden>
                      {isHistoryDiffModalMaximized ? "❐" : "□"}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="git-history-diff-modal-close"
                    onClick={() => setComparePreviewFileKey(null)}
                    aria-label={t("common.close")}
                    title={t("common.close")}
                  >
                    <span className="git-history-diff-modal-close-glyph" aria-hidden>
                      ×
                    </span>
                  </button>
                </div>
              </div>

              {comparePreviewDetailFile.truncated && !comparePreviewDetailFile.isBinary && (
                <div className="git-history-warning">
                  {t("git.historyDiffTooLargeTruncated", {
                    lineCount: comparePreviewDetailFile.lineCount,
                  })}
                </div>
              )}
              {comparePreviewDetailFile.isBinary ? (
                <pre className="git-history-diff-modal-code">{comparePreviewDetailFileDiff}</pre>
              ) : (
                <div className="git-history-diff-modal-viewer">
                  <GitDiffViewer
                    workspaceId={workspaceId}
                    diffs={comparePreviewDiffEntries}
                    selectedPath={comparePreviewDetailFile.path}
                    isLoading={false}
                    error={null}
                    listView="flat"
                    stickyHeaderMode="controls-only"
                    showContentModeControls
                    diffStyle={diffViewMode}
                    onDiffStyleChange={setDiffViewMode}
                  />
                </div>
              )}
            </div>
          </div>
        ) : null}
        {branchContextMenu ? (
          <div className="git-history-branch-context-backdrop">
            <div
              ref={branchContextMenuRef}
              className="git-history-branch-context-menu"
              role="menu"
              style={branchContextMenuStyle}
              onKeyDown={handleBranchContextMenuKeyDown}
            >
              {branchContextTrackingSummary ? (
                <div className="git-history-branch-context-tracking" aria-label={t("git.upstream")}>
                  <span className="git-history-branch-context-tracking-text">
                    {branchContextTrackingSummary}
                  </span>
                </div>
              ) : null}
              {branchContextActions.map((action) => (
                <div
                  key={action.id}
                  className={`git-history-branch-context-item-wrap${action.dividerBefore ? " with-divider" : ""}`}
                >
                  <button
                    type="button"
                    className={`git-history-branch-context-item${action.disabled ? " is-disabled" : ""}${
                      action.tone === "danger" ? " is-danger" : ""
                    }`}
                    role="menuitem"
                    disabled={action.disabled}
                    title={action.disabledReason ?? undefined}
                    onClick={() => {
                      action.onSelect();
                    }}
                  >
                    <span className="git-history-branch-context-item-main">
                      <span className="git-history-branch-context-item-icon">{action.icon}</span>
                      <span className="git-history-branch-context-item-label">{action.label}</span>
                    </span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {commitContextMenu ? (
          <div
            className="git-history-commit-context-menu"
            role="menu"
            style={{
              top: Math.max(8, commitContextMenu.y),
              left: Math.max(8, commitContextMenu.x),
            }}
            onClick={(event) => event.stopPropagation()}
          >
            {contextPrimaryActionGroups.map(({ groupKey, items }) => (
              <div key={groupKey} className="git-history-commit-context-group">
                {items.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    role="menuitem"
                    className="git-history-commit-context-item"
                    disabled={action.disabled}
                    title={action.disabledReason ?? action.label}
                    onClick={() => {
                      if (action.disabled) {
                        return;
                      }
                      runCommitAction(action.id, commitContextMenu.commitSha);
                      setCommitContextMenu(null);
                    }}
                  >
                    <span className="git-history-commit-context-item-icon" aria-hidden>
                      {getCommitActionIcon(action.id, 13)}
                    </span>
                    <span className="git-history-commit-context-item-label">{action.label}</span>
                  </button>
                ))}
              </div>
            ))}
            {contextWriteActions.length > 0 ? (
              <div className="git-history-commit-context-group">
                <button
                  type="button"
                  role="menuitem"
                  className="git-history-commit-context-item is-more"
                  disabled={contextWriteActions.every((action) => action.disabled)}
                  title={contextMoreDisabledReason ?? t("git.historyMoreOperations")}
                  onClick={() => setCommitContextMoreOpen((prev) => !prev)}
                >
                  <span className="git-history-commit-context-item-icon" aria-hidden>
                    <LayoutGrid size={13} strokeWidth={1.9} />
                  </span>
                  <span className="git-history-commit-context-item-label">
                    {t("git.historyMoreOperations")}
                  </span>
                  <span
                    className={`git-history-commit-context-item-chevron${commitContextMoreOpen ? " is-open" : ""}`}
                    aria-hidden
                  >
                    <ChevronRight size={13} strokeWidth={2} />
                  </span>
                </button>
                {commitContextMoreOpen ? (
                  <div className="git-history-commit-context-submenu" role="menu">
                    {contextWriteActions.map((action) => (
                      <button
                        key={action.id}
                        type="button"
                        role="menuitem"
                        className="git-history-commit-context-item"
                        disabled={action.disabled}
                        title={action.disabledReason ?? action.label}
                        onClick={() => {
                          if (action.disabled) {
                            return;
                          }
                          runCommitAction(action.id, commitContextMenu.commitSha);
                          setCommitContextMenu(null);
                        }}
                      >
                        <span className="git-history-commit-context-item-icon" aria-hidden>
                          {getCommitActionIcon(action.id, 13)}
                        </span>
                        <span className="git-history-commit-context-item-label">{action.label}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        {createPrDialogOpen && typeof document !== "undefined"
          ? createPortal(
              <div
                className="git-history-create-branch-backdrop git-history-create-pr-backdrop"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) {
                    closeCreatePrDialog();
                  }
                }}
              >
                <section
                  className={`git-history-create-pr-dialog ${isCreatePrDialogMaximized ? "is-maximized" : ""}`}
                  role="dialog"
                  aria-modal="true"
                  aria-label={t("git.historyCreatePrDialogTitle")}
                >
              <div className="git-history-create-pr-header">
                <div className="git-history-create-pr-title-wrap">
                  <span className="git-history-create-pr-title-icon">
                    <GitPullRequestCreate size={16} />
                  </span>
                  <div className="git-history-create-pr-title-copy">
                    <strong>{t("git.historyCreatePrDialogTitle")}</strong>
                    <p>{t("git.historyCreatePrDialogSubtitle")}</p>
                  </div>
                </div>
                <div className="git-history-create-pr-header-actions">
                  <button
                    type="button"
                    className="git-history-force-delete-close"
                    onClick={() => setIsCreatePrDialogMaximized((value) => !value)}
                    aria-label={isCreatePrDialogMaximized ? t("common.restore") : t("menu.maximize")}
                    title={isCreatePrDialogMaximized ? t("common.restore") : t("menu.maximize")}
                  >
                    <span className="git-history-force-delete-close-glyph" aria-hidden>
                      {isCreatePrDialogMaximized ? "❐" : "□"}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="git-history-force-delete-close"
                    onClick={closeCreatePrDialog}
                    aria-label={t("common.close")}
                    title={t("common.close")}
                    disabled={createPrSubmitting}
                  >
                    <span className="git-history-force-delete-close-glyph" aria-hidden>
                      ×
                    </span>
                  </button>
                </div>
              </div>

              {createPrDefaultsLoading ? (
                <div className="git-history-create-pr-inline-hint">
                  {t("git.historyCreatePrLoadingDefaults")}
                </div>
              ) : null}
              {createPrDefaultsError ? (
                <div className="git-history-create-pr-warning">
                  <CircleAlert size={14} />
                  <span>
                    {t("git.historyCreatePrLoadDefaultsFailed")}{" "}
                    {localizeKnownGitError(createPrDefaultsError) ?? createPrDefaultsError}
                  </span>
                </div>
              ) : null}

              <section className="git-history-create-pr-compare-card">
                <div className="git-history-create-pr-compare-bar">
                  <span className="git-history-create-pr-compare-icon" aria-hidden>
                    <GitPullRequestCreate size={14} />
                  </span>
                  <label className="git-history-create-pr-compare-field">
                    <span>
                      <HardDrive size={11} className="git-history-create-pr-field-chip-icon" />
                      <span className="git-history-create-pr-field-chip-text">
                        {t("git.historyCreatePrCompareBaseRepo")}
                      </span>
                    </span>
                    <GitHistoryInlinePicker
                      label={t("git.historyCreatePrCompareBaseRepo")}
                      value={createPrForm.upstreamRepo}
                      options={createPrBaseRepoOptions}
                      triggerIcon={<HardDrive size={13} />}
                      optionIcon={<HardDrive size={13} />}
                      disabled={createPrSubmitting || createPrDefaultsLoading}
                      searchPlaceholder={t("workspace.searchProjects")}
                      emptyText={t("workspace.noProjectsFound")}
                      onSelect={(nextValue) =>
                        setCreatePrForm((previous) => ({
                          ...previous,
                          upstreamRepo: nextValue,
                        }))}
                    />
                  </label>
                  <label className="git-history-create-pr-compare-field">
                    <span>
                      <GitBranch size={11} className="git-history-create-pr-field-chip-icon" />
                      <span className="git-history-create-pr-field-chip-text">
                        {t("git.historyCreatePrCompareBase")}
                      </span>
                    </span>
                    <GitHistoryInlinePicker
                      label={t("git.historyCreatePrCompareBase")}
                      value={createPrForm.baseBranch}
                      options={createPrBaseBranchOptions}
                      triggerIcon={<GitBranch size={13} />}
                      optionIcon={<GitBranch size={13} />}
                      disabled={createPrSubmitting || createPrDefaultsLoading}
                      searchPlaceholder={t("git.historySearchBranches")}
                      emptyText={t("git.historyNoBranchesFound")}
                      onSelect={(nextValue) =>
                        setCreatePrForm((previous) => ({
                          ...previous,
                          baseBranch: nextValue,
                        }))}
                    />
                  </label>
                  <span className="git-history-create-pr-compare-separator" aria-hidden>
                    <ChevronLeft size={14} />
                  </span>
                  <label className="git-history-create-pr-compare-field">
                    <span>
                      <HardDrive size={11} className="git-history-create-pr-field-chip-icon" />
                      <span className="git-history-create-pr-field-chip-text">
                        {t("git.historyCreatePrCompareHeadRepo")}
                      </span>
                    </span>
                    <GitHistoryInlinePicker
                      label={t("git.historyCreatePrCompareHeadRepo")}
                      value={createPrHeadRepositoryValue}
                      options={createPrHeadRepoOptions}
                      triggerIcon={<HardDrive size={13} />}
                      optionIcon={<HardDrive size={13} />}
                      disabled={createPrSubmitting || createPrDefaultsLoading}
                      searchPlaceholder={t("workspace.searchProjects")}
                      emptyText={t("workspace.noProjectsFound")}
                      onSelect={handleCreatePrHeadRepositoryChange}
                    />
                  </label>
                  <label className="git-history-create-pr-compare-field">
                    <span>
                      <GitPullRequestCreate size={11} className="git-history-create-pr-field-chip-icon" />
                      <span className="git-history-create-pr-field-chip-text">
                        {t("git.historyCreatePrCompare")}
                      </span>
                    </span>
                    <GitHistoryInlinePicker
                      label={t("git.historyCreatePrCompare")}
                      value={createPrForm.headBranch}
                      options={createPrCompareBranchOptions}
                      triggerIcon={<GitPullRequestCreate size={13} />}
                      optionIcon={<GitPullRequestCreate size={13} />}
                      disabled={createPrSubmitting || createPrDefaultsLoading}
                      searchPlaceholder={t("git.historySearchBranches")}
                      emptyText={t("git.historyNoBranchesFound")}
                      onSelect={(nextValue) =>
                        setCreatePrForm((previous) => ({
                          ...previous,
                          headBranch: nextValue,
                        }))}
                    />
                  </label>
                </div>
              </section>

              <section
                className={`git-history-create-pr-preview-card${createPrPreviewExpanded ? " is-expanded" : ""}`}
              >
                <div className="git-history-create-pr-preview-head">
                  <div className="git-history-create-pr-preview-title-wrap">
                    <span className="git-history-create-pr-preview-title">
                      {t("git.historyCreatePrPreviewTitle")}
                    </span>
                    <span className="git-history-create-pr-preview-range">
                      {t("git.historyCreatePrPreviewRange", {
                        base: createPrPreviewBaseRef || "upstream/HEAD",
                        head: createPrPreviewHeadRef || "HEAD",
                      })}
                    </span>
                  </div>
                  <div className="git-history-create-pr-preview-actions">
                    <button
                      type="button"
                      className="git-history-create-pr-preview-caret"
                      onClick={() => setCreatePrPreviewExpanded((previous) => !previous)}
                      aria-label={
                        createPrPreviewExpanded
                          ? t("git.historyCreatePrPreviewCollapse")
                          : t("git.historyCreatePrPreviewExpand")
                      }
                      title={
                        createPrPreviewExpanded
                          ? t("git.historyCreatePrPreviewCollapse")
                          : t("git.historyCreatePrPreviewExpand")
                      }
                    >
                      <ChevronDown size={13} />
                    </button>
                    <button
                      type="button"
                      className="git-history-create-pr-mini-btn"
                      onClick={() => void loadCreatePrCommitPreview()}
                      disabled={
                        createPrSubmitting
                        || createPrDefaultsLoading
                        || createPrPreviewLoading
                        || !createPrPreviewHeadRef
                        || !createPrPreviewBaseRef
                      }
                    >
                      {createPrPreviewLoading ? <LoaderCircle size={13} /> : <RefreshCw size={13} />}
                      <span>{t("git.historyCreatePrPreviewRefresh")}</span>
                    </button>
                  </div>
                </div>
                <div className="git-history-create-pr-preview-collapsible">
                  <div className="git-history-create-pr-preview-summary">
                    <span>{t("git.historyCreatePrPreviewOutgoingCount", { count: createPrPreviewCommits.length })}</span>
                    <span>{t("git.historyCreatePrPreviewBaseOnlyCount", { count: createPrPreviewBaseOnlyCount })}</span>
                  </div>
                  <div className="git-history-push-preview">
                    <div className="git-history-push-preview-pane is-commits">
                      <div className="git-history-push-preview-head">
                        <span className="git-history-push-preview-title">
                          <GitCommit size={12} />
                          {t("git.historyPushDialogPreviewCommits")}
                        </span>
                        <strong>{createPrPreviewCommits.length}</strong>
                      </div>
                      {createPrPreviewError ? (
                        <div className="git-history-push-preview-error">{createPrPreviewError}</div>
                      ) : createPrPreviewLoading ? (
                        <div className="git-history-push-preview-empty">{t("common.loading")}</div>
                      ) : createPrPreviewCommits.length === 0 ? (
                        <div className="git-history-push-preview-empty">{t("git.historyCreatePrPreviewEmpty")}</div>
                      ) : (
                        <div className="git-history-push-preview-commit-list">
                          {createPrPreviewCommits.map((entry) => {
                            const active = entry.sha === createPrPreviewSelectedSha;
                            return (
                              <button
                                key={`create-pr-preview-${entry.sha}`}
                                type="button"
                                className={`git-history-push-preview-commit${active ? " is-active" : ""}`}
                                onClick={() => setCreatePrPreviewSelectedSha(entry.sha)}
                              >
                                <span className="git-history-push-preview-commit-summary">
                                  {entry.summary || t("git.historyNoMessage")}
                                </span>
                                <span className="git-history-push-preview-commit-meta">
                                  <code>{entry.shortSha}</code>
                                  <em>{entry.author || t("git.unknown")}</em>
                                  <time>{formatRelativeTime(entry.timestamp, t)}</time>
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <div className="git-history-push-preview-pane is-details">
                      <div className="git-history-push-preview-head">
                        <span className="git-history-push-preview-title">
                          <FileText size={12} />
                          {t("git.historyPushDialogPreviewDetails")}
                        </span>
                      </div>
                      {!createPrPreviewError && createPrPreviewDetailsLoading ? (
                        <div className="git-history-push-preview-empty">
                          {t("git.historyPushDialogPreviewLoadingDetails")}
                        </div>
                      ) : null}
                      {createPrPreviewDetailsError ? (
                        <div className="git-history-push-preview-error">{createPrPreviewDetailsError}</div>
                      ) : null}
                      {!createPrPreviewDetailsLoading
                      && !createPrPreviewDetailsError
                      && !createPrPreviewSelectedCommit ? (
                        <div className="git-history-push-preview-empty">
                          {t("git.historyPushDialogPreviewSelectCommit")}
                        </div>
                      ) : null}
                      {createPrPreviewDetails && !createPrPreviewDetailsLoading && !createPrPreviewDetailsError ? (
                        <div className="git-history-push-preview-details">
                          <div className="git-history-push-preview-metadata">
                            <strong>{createPrPreviewDetails.summary || t("git.historyNoMessage")}</strong>
                            <span className="git-history-push-preview-metadata-row">
                              <code>{createPrPreviewDetails.sha}</code>
                              <em>{createPrPreviewDetails.author || t("git.unknown")}</em>
                              <time>{new Date(createPrPreviewDetails.commitTime * 1000).toLocaleString()}</time>
                            </span>
                          </div>
                          {extractCommitBody(createPrPreviewDetails.summary, createPrPreviewDetails.message) ? (
                            <pre className="git-history-create-pr-preview-message">
                              {extractCommitBody(createPrPreviewDetails.summary, createPrPreviewDetails.message)}
                            </pre>
                          ) : null}
                          <div className="git-history-push-preview-file-head git-filetree-section-header">
                            <FolderTree size={12} />
                            <span>{t("git.historyPushDialogPreviewFiles")}</span>
                            <i>{createPrPreviewDetails.files.length}</i>
                          </div>
                          <div className="git-history-create-pr-preview-file-list">
                            {createPrPreviewDetails.files.length > 0 ? (
                              createPrPreviewDetails.files.map((file) => {
                                const fileKey = buildFileKey(file);
                                return (
                                  <div
                                    key={`create-pr-preview-file-${fileKey}`}
                                    className="git-history-create-pr-preview-file-item"
                                    title={file.path}
                                  >
                                    {file.path}
                                  </div>
                                );
                              })
                            ) : (
                              <div className="git-history-push-preview-empty">
                                {t("git.historyNoFileChangesInCommit")}
                              </div>
                            )}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                  {!createPrPreviewError && !createPrPreviewLoading && createPrPreviewHasMore ? (
                    <div className="git-history-create-pr-preview-hint">
                      {t("git.historyCreatePrPreviewTruncated", { count: CREATE_PR_PREVIEW_COMMIT_LIMIT })}
                    </div>
                  ) : null}
                </div>
              </section>

              <label className="git-history-create-branch-field">
                <span>{t("git.historyCreatePrFieldTitle")}</span>
                <input
                  value={createPrForm.title}
                  disabled={createPrSubmitting || createPrDefaultsLoading}
                  onChange={(event) =>
                    setCreatePrForm((previous) => ({
                      ...previous,
                      title: event.target.value,
                    }))}
                  placeholder={t("git.historyCreatePrTitlePlaceholder")}
                />
              </label>
              <label className="git-history-create-branch-field">
                <span>{t("git.historyCreatePrFieldBody")}</span>
                <textarea
                  className="git-history-create-pr-textarea"
                  value={createPrForm.body}
                  disabled={createPrSubmitting || createPrDefaultsLoading}
                  onChange={(event) =>
                    setCreatePrForm((previous) => ({
                      ...previous,
                      body: event.target.value,
                    }))}
                />
              </label>
              <button
                type="button"
                className={`git-history-push-toggle${createPrForm.commentAfterCreate ? " is-active" : ""}`}
                aria-pressed={createPrForm.commentAfterCreate}
                disabled={createPrSubmitting || createPrDefaultsLoading}
                onClick={() =>
                  setCreatePrForm((previous) => ({
                    ...previous,
                    commentAfterCreate: !previous.commentAfterCreate,
                  }))}
              >
                <span className="git-history-push-toggle-indicator" aria-hidden>
                  {createPrForm.commentAfterCreate ? "✓" : ""}
                </span>
                <MessageSquareText size={12} className="git-history-push-toggle-icon" />
                <span>{t("git.historyCreatePrCommentAfterCreate")}</span>
              </button>
              {createPrForm.commentAfterCreate ? (
                <label className="git-history-create-branch-field">
                  <span>{t("git.historyCreatePrCommentBody")}</span>
                  <textarea
                    className="git-history-create-pr-textarea is-compact"
                    value={createPrForm.commentBody}
                    disabled={createPrSubmitting || createPrDefaultsLoading}
                    onChange={(event) =>
                      setCreatePrForm((previous) => ({
                        ...previous,
                        commentBody: event.target.value,
                      }))}
                  />
                </label>
              ) : null}

              <div className="git-history-create-pr-stage-card">
                <div className="git-history-create-pr-stage-title">{t("git.historyCreatePrStageProgress")}</div>
                <div className="git-history-create-pr-stage-list">
                  {createPrStages.map((stage) => {
                    const statusLabel =
                      stage.status === "running"
                        ? t("git.historyCreatePrStageRunning")
                        : stage.status === "success"
                          ? t("git.historyCreatePrStageSuccess")
                          : stage.status === "failed"
                            ? t("git.historyCreatePrStageFailed")
                            : stage.status === "skipped"
                              ? t("git.historyCreatePrStageSkipped")
                              : t("git.historyCreatePrStagePending");
                    return (
                      <div
                        key={stage.key}
                        className={`git-history-create-pr-stage-item is-${stage.status}`}
                      >
                        <span className="git-history-create-pr-stage-icon" aria-hidden>
                          {stage.status === "success" ? (
                            <CircleCheck size={14} />
                          ) : stage.status === "failed" ? (
                            <CircleAlert size={14} />
                          ) : stage.status === "running" ? (
                            <LoaderCircle size={14} />
                          ) : (
                            <span className="git-history-create-pr-stage-dot" />
                          )}
                        </span>
                        <span className="git-history-create-pr-stage-main">
                          <span className="git-history-create-pr-stage-label">{stage.label}</span>
                          <span className="git-history-create-pr-stage-detail">{stage.detail}</span>
                        </span>
                        <span className="git-history-create-pr-stage-status">{statusLabel}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {createPrResult ? (
                <div
                  className={`git-history-create-pr-result ${
                    createPrResult.ok ? "is-success" : "is-failed"
                  }`}
                >
                  <div className="git-history-create-pr-result-head">
                    <span className="git-history-create-pr-result-title">{createPrResultHeadline}</span>
                    {createPrResult.prNumber ? (
                      <code>#{createPrResult.prNumber}</code>
                    ) : null}
                  </div>
                  <div className="git-history-create-pr-result-message">{createPrResult.message}</div>
                  {createPrResult.nextActionHint ? (
                    <div className="git-history-create-pr-result-hint">
                      {createPrResult.nextActionHint}
                    </div>
                  ) : null}
                  {createPrResult.prUrl ? (
                    <div className="git-history-create-pr-result-actions">
                      <button
                        type="button"
                        className="git-history-create-pr-mini-btn"
                        onClick={() => void handleCopyCreatePrUrl()}
                      >
                        <Copy size={13} />
                        <span>
                          {createPrCopiedPrUrl ? t("git.historyCreatePrCopied") : t("git.historyCreatePrCopyLink")}
                        </span>
                      </button>
                    </div>
                  ) : null}
                  {createPrResult.retryCommand ? (
                    <div className="git-history-create-pr-retry-command">
                      <span>{t("git.historyCreatePrRetryCommand")}</span>
                      <code>{createPrResult.retryCommand}</code>
                      <button
                        type="button"
                        className="git-history-create-pr-mini-btn"
                        onClick={() => void handleCopyCreatePrRetryCommand()}
                      >
                        <Copy size={13} />
                        <span>
                          {createPrCopiedRetryCommand
                            ? t("git.historyCreatePrCopied")
                            : t("git.historyCreatePrCopyCommand")}
                        </span>
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}

                  <div className="git-history-create-branch-actions">
                    <button
                      type="button"
                      className="git-history-create-branch-btn is-cancel"
                      disabled={createPrSubmitting || createPrDefaultsLoading}
                      onClick={closeCreatePrDialog}
                    >
                      {t("common.cancel")}
                    </button>
                    <button
                      type="button"
                      className="git-history-create-branch-btn is-confirm"
                      disabled={!createPrCanConfirm}
                      onClick={() => void handleConfirmCreatePr()}
                      title={!createPrCanConfirm ? t("git.historyCreatePrFormIncomplete") : undefined}
                    >
                      {createPrSubmitting
                        ? t("common.loading")
                        : createPrResult && !createPrResult.ok
                          ? t("common.retry")
                          : t("git.historyCreatePrAction")}
                    </button>
                  </div>
                </section>
              </div>,
              document.body,
            )
          : null}
        {renderGitHistoryPanelDialogs({
          ...scope,
          pullExampleCommand,
          syncAheadCount,
          syncBehindCount,
        })}
      </div>
    </div>
  );
}
