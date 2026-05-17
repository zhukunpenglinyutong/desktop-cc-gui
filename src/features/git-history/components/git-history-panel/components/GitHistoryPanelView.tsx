// @ts-nocheck
import { renderGitHistoryPanelDialogs } from "./GitHistoryPanelDialogs";

export function renderGitHistoryPanelView(scope: any) {
  const {ActionSurface,CREATE_PR_PREVIEW_COMMIT_LIMIT,ChevronDown,ChevronLeft,ChevronRight,ChevronsDownUp,ChevronsUpDown,CircleAlert,CircleCheck,Cloud,CloudDownload,Copy,DEFAULT_DETAILS_SPLIT,DISABLE_HISTORY_ACTION_BUTTONS,Download,FileIcon,FileText,Folder,FolderOpen,FolderTree,GitBranch,GitCommit,GitDiffViewer,GitHistoryInlinePicker,GitHistoryProjectPicker,GitHistoryWorktreePanel,GitMerge,GitPullRequestCreate,HardDrive,LayoutGrid,LoaderCircle,MessageSquareText,Pencil,Plus,RefreshCw,Repeat,Search,ShieldAlert,Trash2,Upload,X,branchContextActions,branchContextMenu,branchContextMenuRef,branchContextMenuStyle,branchContextTrackingSummary,branchDiffState,branchQuery,branchesWidth,buildFileKey,clearOperationNotice,closeBranchContextMenu,closeBranchDiff,closeCreatePrDialog,closeForceDeleteDialog,closeRenameBranchDialog,closeWorktreePreview,codeAnnotations,commitContextMenu,commitContextMoreOpen,commitListRef,commitQuery,commitRowVirtualizer,commits,commitsWidth,comparePreviewDetailFile,comparePreviewDetailFileDiff,comparePreviewDiffEntries,comparePreviewFileKey,contextMoreDisabledReason,contextPrimaryActionGroups,contextWriteActions,createBranchCanConfirm,createBranchDialogOpen,createBranchName,createBranchNameInputRef,createBranchSource,createBranchSourceOptions,createBranchSubmitting,createPortal,createPrBaseBranchOptions,createPrBaseRepoOptions,createPrCanConfirm,createPrCanOpen,createPrCompareBranchOptions,createPrCopiedPrUrl,createPrCopiedRetryCommand,createPrDefaultsError,createPrDefaultsLoading,createPrDialogOpen,createPrForm,createPrHeadRepoOptions,createPrHeadRepositoryValue,createPrPreviewBaseOnlyCount,createPrPreviewBaseRef,createPrPreviewCommits,createPrPreviewDetails,createPrPreviewDetailsError,createPrPreviewDetailsLoading,createPrPreviewError,createPrPreviewExpanded,createPrPreviewHasMore,createPrPreviewHeadRef,createPrPreviewLoading,createPrPreviewSelectedCommit,createPrPreviewSelectedSha,createPrResult,createPrResultHeadline,createPrStages,createPrSubmitting,createPrToolbarDisabledReason,currentBranch,currentLocalBranchEntry,desktopSplitLayout,details,detailsBodyRef,detailsError,detailsLoading,detailsMessageContent,detailsSplitRatio,diffViewMode,emptyStateStatusText,expandedLocalScopes,expandedRemoteScopes,extractCommitBody,fallbackGitRoots,fallbackGitRootsError,fallbackGitRootsLoading,fallbackSelectingRoot,fetchDialogOpen,fetchSubmitting,fileTreeItems,forceDeleteCopiedPath,forceDeleteCountdown,forceDeleteDialogState,formatRelativeTime,getBranchLeafName,getBranchScope,getCommitActionIcon,getCurrentDefaultColumnWidths,getSpecialBranchBadges,getTreeLineOpacity,groupedLocalBranches,groupedRemoteBranches,handleBranchContextMenuKeyDown,handleBranchesSplitResizeStart,handleCommitsSplitResizeStart,handleConfirmCreatePr,handleConfirmFetch,handleConfirmPull,handleConfirmPush,handleConfirmRefresh,handleConfirmResetCommit,handleConfirmSync,handleCopyCreatePrRetryCommand,handleCopyCreatePrUrl,handleCopyForceDeleteWorktreePath,handleCreateBranch,handleCreateBranchConfirm,handleCreatePrHeadRepositoryChange,handleDeleteBranch,handleDetailsSplitResizeStart,handleFallbackGitRootSelect,handleFileTreeDirToggle,handleMergeBranch,handleOpenBranchContextMenu,handleOpenCommitContextMenu,handleOpenCreatePrDialog,handleOpenFetchDialog,handleOpenPullDialog,handleOpenPushDialog,handleOpenRefreshDialog,handleOpenRenameBranchDialog,handleOpenSyncDialog,handleOpenWorktreePreview,handleOverviewSplitResizeStart,handlePushPreviewDirToggle,handleRenameBranchConfirm,handleSelectBranchCompareCommit,handleSelectPullRemote,handleSelectPullTargetBranch,handleSelectPushRemote,handleSelectPushTargetBranch,handleSelectWorktreeDiffFile,handleToggleLocalScope,handleToggleRemoteScope,handleWorktreeSummaryChange,historyError,historyHasMore,historyLoading,historyLoadingMore,historyTotal,isCreatePrDialogMaximized,isHistoryDiffModalMaximized,loadCreatePrCommitPreview,loadHistory,localSectionExpanded,localizeKnownGitError,localizedOperationName,mainGridRef,mainGridStyle,onCreateCodeAnnotation,onOpenDiffPath,onRemoveCodeAnnotation,onRequestClose,onSelectWorkspace,openPullTargetBranchMenu,openPushTargetBranchMenu,operationLoading,operationNotice,overviewCommitSectionCollapsed,overviewListView,overviewWidth,previewDetailFile,previewDetailFileDiff,previewDiffEntries,previewModalFullDiffLoader,projectOptions,projectSections,pullDialogOpen,pullNoCommit,pullNoVerify,pullOptionsMenuOpen,pullOptionsMenuRef,pullRemote,pullRemoteGroups,pullRemoteMenuOpen,pullRemoteMenuPlacement,pullRemotePickerRef,pullRemoteTrimmed,pullSelectedOptions,pullStrategy,pullSubmitting,pullTargetBranch,pullTargetBranchActiveScopeTab,pullTargetBranchFieldRef,pullTargetBranchGroups,pullTargetBranchMenuOpen,pullTargetBranchMenuPlacement,pullTargetBranchMenuRef,pullTargetBranchPickerRef,pullTargetBranchTrimmed,pushCanConfirm,pushCc,pushDialogOpen,pushForceWithLease,pushHasOutgoingCommits,pushIsNewBranchTarget,pushPreviewCommits,pushPreviewDetails,pushPreviewDetailsError,pushPreviewDetailsLoading,pushPreviewError,pushPreviewFileTreeItems,pushPreviewHasMore,pushPreviewLoading,pushPreviewModalDiffEntries,pushPreviewModalFile,pushPreviewModalFileDiff,pushPreviewModalFullDiffLoader,pushPreviewSelectedCommit,pushPreviewSelectedFileKey,pushPreviewSelectedSha,pushRemoteMenuOpen,pushRemoteMenuPlacement,pushRemoteOptions,pushRemotePickerRef,pushRemoteTrimmed,pushReviewers,pushRunHooks,pushSubmitting,pushTags,pushTargetBranch,pushTargetBranchActiveScopeTab,pushTargetBranchFieldRef,pushTargetBranchGroups,pushTargetBranchMenuOpen,pushTargetBranchMenuPlacement,pushTargetBranchMenuRef,pushTargetBranchPickerRef,pushTargetBranchTrimmed,pushTargetSummaryBranch,pushToGerrit,pushTopic,refreshAll,refreshDialogOpen,refreshSubmitting,remoteSectionExpanded,renameBranchCanConfirm,renameBranchDialogOpen,renameBranchName,renameBranchNameInputRef,renameBranchSource,renameBranchSubmitting,renameBranchToolbarDisabledReason,renderChangedFilesSummary,repositoryRootName,repositoryUnavailable,resetDialogOpen,resetMode,resetTargetCommit,resetTargetSha,runCommitAction,selectedBranch,selectedCommitSha,selectedFileKey,selectedLocalBranchForRename,setBranchQuery,setBranchesWidth,setCommitContextMenu,setCommitContextMoreOpen,setCommitQuery,setCommitsWidth,setComparePreviewFileKey,setCreateBranchDialogOpen,setCreateBranchName,setCreateBranchSource,setCreatePrForm,setCreatePrPreviewExpanded,setCreatePrPreviewSelectedSha,setDetailsSplitRatio,setDiffViewMode,setFallbackSelectingRoot,setFetchDialogOpen,setIsCreatePrDialogMaximized,setIsHistoryDiffModalMaximized,setLocalSectionExpanded,setOverviewCommitSectionCollapsed,setOverviewListView,setOverviewWidth,setPreviewFileKey,setPullDialogOpen,setPullNoCommit,setPullNoVerify,setPullOptionsMenuOpen,setPullRemoteMenuOpen,setPullStrategy,setPullTargetBranch,setPullTargetBranchActiveScopeTab,setPullTargetBranchMenuOpen,setPullTargetBranchQuery,setPushCc,setPushDialogOpen,setPushForceWithLease,setPushPreviewModalFileKey,setPushPreviewSelectedFileKey,setPushPreviewSelectedSha,setPushRemoteMenuOpen,setPushReviewers,setPushRunHooks,setPushTags,setPushTargetBranch,setPushTargetBranchActiveScopeTab,setPushTargetBranchMenuOpen,setPushTargetBranchQuery,setPushToGerrit,setPushTopic,setRefreshDialogOpen,setRemoteSectionExpanded,setRenameBranchName,setResetDialogOpen,setResetMode,setSelectedBranch,setSelectedCommitSha,setSelectedFileKey,setSyncDialogOpen,setWorkspaceSelectingId,shouldShowWorkspacePickerPage,statusLabel,strokeWidth,syncDialogOpen,syncPreviewCommits,syncPreviewError,syncPreviewLoading,syncPreviewTargetBranch,syncPreviewTargetFound,syncPreviewTargetRemote,syncSubmitting,t,trimRemotePrefix,updatePullRemoteMenuPlacement,updatePushRemoteMenuPlacement,virtualCommitRows,visiblePullTargetBranchGroups,visiblePushTargetBranchGroups,workbenchGridRef,workbenchGridStyle,workingTreeChangedFiles,workingTreeSummaryLabel,workingTreeTotalAdditions,workingTreeTotalDeletions,workspace,workspaceId,workspacePickerMessage,workspaceSelectingId,worktreePreviewDiffEntries,worktreePreviewDiffText,worktreePreviewError,worktreePreviewFile,worktreePreviewFullDiffLoader,worktreePreviewLoading} = scope;
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
      <div className="git-history-workbench relative flex flex-col w-full h-full min-w-0 min-h-0 text-(--text-primary) bg-[var(--git-history-pane-bg)] focus-visible:outline-2 focus-visible:outline-[color-mix(in_srgb,var(--accent-primary,#2563eb)_52%,transparent)] focus-visible:[outline-offset:-2px]">
        <div className="git-history-toolbar git-history-empty-toolbar flex items-center justify-between gap-2.5 py-2 px-[10px] border-b border-[color:var(--border-default)] bg-[color-mix(in_srgb,var(--surface-card-muted,#111725)_95%,transparent)]">
          <div className="git-history-toolbar-left inline-flex items-center min-w-0 flex-wrap gap-2.5">
            <span className="git-history-empty-inline-text text-xs text-(--text-secondary)">{workspacePickerMessage}</span>
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
              <span className="git-history-empty-inline-text text-xs text-(--text-secondary)">
                {localizeKnownGitError(fallbackGitRootsError) ?? fallbackGitRootsError}
              </span>
            ) : null}
          </div>
          {onRequestClose ? (
            <div className="git-history-toolbar-actions inline-flex items-center gap-2 flex-wrap justify-end">
              <ActionSurface
                className="git-history-close-chip w-6 h-6 rounded-full border border-[color-mix(in_srgb,var(--border-default)_72%,transparent)] bg-[color-mix(in_srgb,var(--surface-control,#1a2230)_66%,transparent)]"
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
      className="git-history-workbench relative flex flex-col w-full h-full min-w-0 min-h-0 text-(--text-primary) bg-[var(--git-history-pane-bg)] focus-visible:outline-2 focus-visible:outline-[color-mix(in_srgb,var(--accent-primary,#2563eb)_52%,transparent)] focus-visible:[outline-offset:-2px]"
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
      <div className="git-history-toolbar git-history-toolbar--hover-actions group/toolbar flex items-center justify-between gap-2.5 py-2 px-[10px] border-b border-[color:var(--border-default)] bg-[color-mix(in_srgb,var(--surface-card-muted,#111725)_95%,transparent)]">
        <div className="git-history-toolbar-left inline-flex items-center min-w-0 flex-wrap gap-2.5">
          <h2 className="m-0 text-sm font-semibold text-(--text-stronger)">{t("git.historyTitle")}</h2>
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
          <div className="git-history-toolbar-meta inline-flex items-center gap-2 min-w-0 text-(--text-muted) text-[11px]">
            <span className="git-history-head-pill inline-flex items-center justify-center h-[18px] px-[6px] rounded-full text-[10px] font-bold tracking-[0.03em] text-[color-mix(in_srgb,var(--accent-primary,#2563eb)_86%,#dbeafe)] border border-[color-mix(in_srgb,var(--accent-primary,#2563eb)_58%,transparent)] bg-[color-mix(in_srgb,var(--accent-primary,#2563eb)_18%,transparent)]">HEAD</span>
            <code className="git-history-current-branch inline-flex items-center h-5 px-2 rounded-full border border-[color-mix(in_srgb,#10b981_58%,transparent)] bg-[color-mix(in_srgb,#10b981_16%,var(--surface-control,#1a2230))] min-w-0 max-w-[min(36vw,440px)] overflow-hidden text-ellipsis whitespace-nowrap text-[10px] font-semibold leading-none text-[color-mix(in_srgb,#10b981_82%,#d1fae5)]">{currentBranch ?? workspace.name}</code>
            <span
              className={`git-history-toolbar-worktree whitespace-nowrap text-[11px] ${
                workingTreeChangedFiles > 0 ? "is-dirty text-[#fca5a5]" : "is-clean text-(--text-muted)"
              }`}
            >
              {workingTreeSummaryLabel}
            </span>
            {workingTreeChangedFiles > 0 ? (
              <span className="git-history-toolbar-lines inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] text-(--text-muted)">
                <span className="git-history-diff-add text-[color:var(--status-success,#22c55e)]">+{workingTreeTotalAdditions}</span>
                <span className="git-history-diff-sep text-(--text-muted) opacity-82" aria-hidden>
                  /
                </span>
                <span className="git-history-diff-del text-[color:var(--status-error,#f87171)]">-{workingTreeTotalDeletions}</span>
              </span>
            ) : null}
            <span className="git-history-toolbar-count text-(--text-muted) whitespace-nowrap">
              {t("git.historyCommitCount", { count: historyTotal })}
            </span>
          </div>
        </div>
        <div className="git-history-toolbar-actions inline-flex items-center gap-2 flex-wrap justify-end">
          <div className="git-history-toolbar-action-group inline-flex items-center gap-1 p-0.5 border border-[color-mix(in_srgb,var(--border-default)_78%,transparent)] rounded-full bg-[color-mix(in_srgb,var(--surface-control,#1a2230)_42%,transparent)] opacity-0 pointer-events-none translate-x-[18px] transition-[opacity_160ms_ease,transform_180ms_ease] group-hover/toolbar:opacity-100 group-hover/toolbar:pointer-events-auto group-hover/toolbar:translate-x-0 group-focus-within/toolbar:opacity-100 group-focus-within/toolbar:pointer-events-auto group-focus-within/toolbar:translate-x-0 motion-reduce:translate-x-0 motion-reduce:transition-[opacity_120ms_ease]">
            <ActionSurface
              className="git-history-chip git-history-chip-pr h-6 px-2 text-[11px] font-medium rounded-full border-transparent bg-transparent text-[color-mix(in_srgb,var(--accent-primary,#2563eb)_80%,var(--text-secondary))] hover:text-[color-mix(in_srgb,var(--accent-primary,#2563eb)_88%,var(--text-primary))] hover:bg-[color-mix(in_srgb,var(--accent-primary,#2563eb)_20%,transparent)] [&.is-active]:border-[color-mix(in_srgb,var(--accent-primary,#2563eb)_34%,transparent)] [&.is-active]:bg-[color-mix(in_srgb,var(--accent-primary,#2563eb)_12%,transparent)] [&.is-active]:text-[color-mix(in_srgb,var(--accent-primary,#2563eb)_88%,var(--text-primary))]"
              active={createPrDialogOpen}
              onActivate={handleOpenCreatePrDialog}
              disabled={!createPrCanOpen}
              title={createPrToolbarDisabledReason ?? t("git.historyCreatePr")}
            >
              <GitPullRequestCreate size={13} />
              <span>{t("git.historyCreatePr")}</span>
            </ActionSurface>
            <ActionSurface
              className="git-history-chip h-6 px-2 text-[11px] font-medium rounded-full border-transparent bg-transparent text-(--text-secondary) hover:text-(--text-stronger) hover:bg-[color-mix(in_srgb,var(--surface-control-hover,#263044)_85%,transparent)]"
              active={pullDialogOpen}
              onActivate={handleOpenPullDialog}
              disabled={Boolean(operationLoading)}
              title={t("git.pull")}
            >
              <Download size={13} />
              <span>{t("git.pull")}</span>
            </ActionSurface>
            <ActionSurface
              className="git-history-chip h-6 px-2 text-[11px] font-medium rounded-full border-transparent bg-transparent text-(--text-secondary) hover:text-(--text-stronger) hover:bg-[color-mix(in_srgb,var(--surface-control-hover,#263044)_85%,transparent)]"
              active={pushDialogOpen}
              onActivate={handleOpenPushDialog}
              disabled={Boolean(operationLoading)}
              title={t("git.push")}
            >
              <Upload size={13} />
              <span>{t("git.push")}</span>
            </ActionSurface>
            <ActionSurface
              className="git-history-chip h-6 px-2 text-[11px] font-medium rounded-full border-transparent bg-transparent text-(--text-secondary) hover:text-(--text-stronger) hover:bg-[color-mix(in_srgb,var(--surface-control-hover,#263044)_85%,transparent)]"
              active={syncDialogOpen}
              onActivate={handleOpenSyncDialog}
              disabled={Boolean(operationLoading)}
              title={t("git.sync")}
            >
              <Repeat size={13} />
              <span>{t("git.sync")}</span>
            </ActionSurface>
            <ActionSurface
              className="git-history-chip h-6 px-2 text-[11px] font-medium rounded-full border-transparent bg-transparent text-(--text-secondary) hover:text-(--text-stronger) hover:bg-[color-mix(in_srgb,var(--surface-control-hover,#263044)_85%,transparent)]"
              active={fetchDialogOpen}
              onActivate={handleOpenFetchDialog}
              disabled={Boolean(operationLoading)}
              title={t("git.fetch")}
            >
              <CloudDownload size={13} />
              <span>{t("git.fetch")}</span>
            </ActionSurface>
            <ActionSurface
              className="git-history-chip h-6 px-2 text-[11px] font-medium rounded-full border-transparent bg-transparent text-(--text-secondary) hover:text-(--text-stronger) hover:bg-[color-mix(in_srgb,var(--surface-control-hover,#263044)_85%,transparent)]"
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
            className="git-history-close-chip w-6 h-6 rounded-full border border-[color-mix(in_srgb,var(--border-default)_72%,transparent)] bg-[color-mix(in_srgb,var(--surface-control,#1a2230)_66%,transparent)]"
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
        className={`git-history-grid grid w-full flex-1 min-h-0 overflow-hidden [grid-template-columns:minmax(200px,240px)_minmax(0,1fr)]${desktopSplitLayout ? " with-vertical-resizers [&.with-vertical-resizers_.git-history-overview]:border-r-0" : ""}`}
        ref={workbenchGridRef}
        style={workbenchGridStyle}
      >
        <aside className="git-history-overview min-w-0 min-h-0 flex flex-col gap-2.5 p-[10px] border-r border-[color:var(--border-default)] bg-[var(--git-history-pane-bg)]">
          <div className="git-history-overview-toolbar flex items-center justify-between gap-2 is-files-top-row">
            <div className="git-history-overview-list-toggle inline-flex items-center gap-2 self-center p-0 w-fit border-none rounded-none bg-transparent" role="group" aria-label={t("git.listView")}>
              <button
                type="button"
                className={`git-history-overview-list-tab min-h-6 py-1 px-0.5 pb-[5px] inline-flex items-center justify-center gap-1 border-none border-b-2 border-b-transparent rounded-none bg-transparent text-(--text-secondary) text-[11px] font-semibold whitespace-nowrap cursor-pointer transition-[border-bottom-color_160ms_ease,color_160ms_ease] hover:text-(--text-emphasis) hover:bg-transparent focus-visible:outline-none focus-visible:text-[color:var(--text-accent,#7a9dcc)] [&_svg]:flex-[0_0_auto]${
                  overviewListView === "flat" ? " is-active text-[color-mix(in_srgb,var(--accent-primary,#2563eb)_88%,var(--text-emphasis))] border-b-[color:var(--accent-primary,#2563eb)]" : ""
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
                className={`git-history-overview-list-tab min-h-6 py-1 px-0.5 pb-[5px] inline-flex items-center justify-center gap-1 border-none border-b-2 border-b-transparent rounded-none bg-transparent text-(--text-secondary) text-[11px] font-semibold whitespace-nowrap cursor-pointer transition-[border-bottom-color_160ms_ease,color_160ms_ease] hover:text-(--text-emphasis) hover:bg-transparent focus-visible:outline-none focus-visible:text-[color:var(--text-accent,#7a9dcc)] [&_svg]:flex-[0_0_auto]${
                  overviewListView === "tree" ? " is-active text-[color-mix(in_srgb,var(--accent-primary,#2563eb)_88%,var(--text-emphasis))] border-b-[color:var(--accent-primary,#2563eb)]" : ""
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
                className={`git-history-overview-list-tab min-h-6 py-1 px-0.5 pb-[5px] inline-flex items-center justify-center gap-1 border-none border-b-2 border-b-transparent rounded-none bg-transparent text-(--text-secondary) text-[11px] font-semibold whitespace-nowrap cursor-pointer transition-[border-bottom-color_160ms_ease,color_160ms_ease] hover:text-(--text-emphasis) hover:bg-transparent focus-visible:outline-none focus-visible:text-[color:var(--text-accent,#7a9dcc)] [&_svg]:flex-[0_0_auto]${
                  !overviewCommitSectionCollapsed ? " is-active text-[color-mix(in_srgb,var(--accent-primary,#2563eb)_88%,var(--text-emphasis))] border-b-[color:var(--accent-primary,#2563eb)]" : ""
                } w-[30px] p-0 justify-center`}
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
            className="git-history-vertical-resizer relative cursor-col-resize touch-none bg-[color-mix(in_srgb,var(--surface-control,#1a2230)_58%,transparent)] after:content-[''] after:absolute after:top-0 after:bottom-0 after:left-1/2 after:w-px after:bg-[color-mix(in_srgb,var(--border-default)_88%,transparent)] after:-translate-x-[0.5px] hover:after:bg-[color-mix(in_srgb,var(--accent-primary,#2563eb)_72%,transparent)]"
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
          className={`git-history-main-grid min-w-0 min-h-0 grid overflow-hidden [grid-template-columns:minmax(220px,0.82fr)_minmax(420px,1.35fr)_minmax(420px,1.2fr)]${desktopSplitLayout ? " with-vertical-resizers [&.with-vertical-resizers_.git-history-branches]:border-r-0 [&.with-vertical-resizers_.git-history-commits]:border-r-0" : ""}`}
          ref={mainGridRef}
          style={mainGridStyle}
        >
        <section className="git-history-branches min-w-0 min-h-0 flex flex-col border-r border-(--border-default) overflow-hidden bg-(--git-history-pane-bg)">
          <div className="git-history-column-header flex items-center justify-between gap-2 py-[7px] px-2.5 border-b border-(--border-default) text-[11px] text-(--text-secondary) bg-[color-mix(in_srgb,var(--surface-card-muted,#111725)_72%,transparent)] min-h-11 box-border [&>span]:inline-flex [&>span]:items-center [&>span]:gap-1.5 [&>span]:font-semibold">
            <span>
              <GitBranch size={14} /> {t("git.historyBranches")}
            </span>
            <div className="git-history-branch-actions inline-flex items-center gap-0.5 p-0.5 rounded-full border border-[color-mix(in_srgb,var(--border-default)_72%,transparent)] bg-[color-mix(in_srgb,var(--surface-control,#1a2230)_74%,transparent)] shadow-[inset_0_1px_0_color-mix(in_srgb,#ffffff_10%,transparent)] [&_.git-history-mini-chip]:w-7 [&_.git-history-mini-chip]:h-[26px] [&_.git-history-mini-chip]:p-0 [&_.git-history-mini-chip]:border-none [&_.git-history-mini-chip]:rounded-full [&_.git-history-mini-chip]:bg-transparent [&_.git-history-mini-chip]:text-(--text-secondary) [&_.git-history-mini-chip]:font-semibold [&_.git-history-mini-chip]:transition-[background-color,color,opacity] [&_.git-history-mini-chip]:duration-140 [&_.git-history-mini-chip]:ease [&_.git-history-mini-chip_svg]:w-3.5 [&_.git-history-mini-chip_svg]:h-3.5 [&_.git-history-mini-chip_svg]:[stroke-width:2.1] [&_.git-history-mini-chip:hover:not(.is-disabled)]:bg-[color-mix(in_srgb,var(--surface-control-hover,#263044)_86%,transparent)] [&_.git-history-mini-chip:hover:not(.is-disabled)]:text-(--text-stronger)">
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
          <label className="git-history-search flex items-center gap-1.5 my-2 mx-2.5 py-1.5 px-2 border border-(--border-default) rounded-[7px] bg-(--surface-control,#1a2130) text-(--text-muted) [&_input]:border-none [&_input]:bg-transparent [&_input]:w-full [&_input]:min-w-0 [&_input]:text-inherit [&_input]:outline-none [&_input]:text-xs">
            <Search size={14} />
            <input
              value={branchQuery}
              onChange={(event) => setBranchQuery(event.target.value)}
              placeholder={t("git.historySearchBranches")}
            />
          </label>
          <div className="git-history-branch-list flex-1 min-h-0 overflow-auto">
            <ActionSurface
              className="git-history-branch-item git-history-branch-all-item w-full justify-start border-none flex items-center justify-between gap-2 my-0.5 mx-1 mb-2 py-1.5 px-2 text-(--text-secondary) text-[11px] rounded-lg"
              active={selectedBranch === "all"}
              onActivate={() => setSelectedBranch("all")}
            >
              <span>{t("git.historyAllBranches")}</span>
            </ActionSurface>

            <div className="git-history-tree-section mb-1.5">
              <ActionSurface
                className="git-history-tree-section-toggle w-full justify-start border-none mx-1 py-[5px] px-2 gap-1.5 text-(--text-secondary) text-[10px] uppercase tracking-[0.06em] font-bold rounded-lg [&_svg]:text-[color-mix(in_srgb,var(--text-muted)_86%,transparent)]"
                onActivate={() => setLocalSectionExpanded((prev) => !prev)}
                ariaLabel={t("git.historyToggleLocalBranches")}
              >
                {localSectionExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <HardDrive size={13} />
                <span>{t("git.historyLocal")}</span>
              </ActionSurface>
              {localSectionExpanded && (
                <div className="git-history-tree-section-body flex flex-col gap-0.5 mt-[3px]">
                  {groupedLocalBranches.map((group) => {
                    const scopeExpanded = expandedLocalScopes.has(group.key);
                    return (
                      <div key={`local-group-${group.key}`} className="git-history-tree-scope-group flex flex-col gap-px">
                        <ActionSurface
                          className="git-history-tree-scope-toggle w-full justify-start border-none mx-1 py-[5px] pr-2 pl-[22px] gap-1.5 rounded-lg text-(--text-muted) text-[10px] tracking-[0.06em] uppercase font-semibold"
                          onActivate={() => handleToggleLocalScope(group.key)}
                          ariaLabel={t("git.historyToggleLocalGroup", { group: group.label })}
                        >
                          {scopeExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          {scopeExpanded ? <FolderOpen size={12} /> : <Folder size={12} />}
                          <span className="git-history-tree-scope-label min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{group.label}</span>
                        </ActionSurface>
                        {scopeExpanded &&
                          group.items.map((entry) => (
                            <div
                              key={`local-${entry.name}`}
                              className="git-history-branch-row block my-0 mx-2.5 ml-9"
                              onContextMenu={(event) => handleOpenBranchContextMenu(event, entry, "local")}
                            >
                              <ActionSurface
                                className={`git-history-branch-item git-history-branch-item-tree w-full justify-start border-none flex items-center justify-between gap-2 py-1.5 px-2 text-xs rounded-lg min-h-7 pl-2.5 pr-3 border-l-2 border-l-transparent${
                                  entry.isCurrent ? " is-head-branch border-l-[color-mix(in_srgb,var(--accent-primary,#2563eb)_76%,transparent)] [&_.git-history-branch-name]:text-[color-mix(in_srgb,var(--accent-primary,#2563eb)_88%,var(--text-stronger))] [&_.git-history-branch-name]:font-bold" : ""
                                }${selectedBranch === entry.name ? " is-active bg-[color-mix(in_srgb,var(--accent-primary,#2563eb)_17%,transparent)]" : ""}`}
                                active={selectedBranch === entry.name}
                                onActivate={() => setSelectedBranch(entry.name)}
                              >
                                <span className="git-history-tree-branch-main flex-1 min-w-0 inline-flex items-center gap-1.5 [&_svg]:text-[color-mix(in_srgb,var(--text-muted)_82%,transparent)] [&_svg]:flex-none">
                                  <GitBranch size={11} />
                                  <span className="git-history-branch-name min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                                    {getBranchLeafName(entry.name)}
                                  </span>
                                </span>
                                <span className="git-history-branch-badges inline-flex items-center gap-1.5 mr-2 flex-none [&_em]:not-italic [&_em]:text-[10px] [&_em]:font-semibold [&_em]:rounded-full [&_em]:py-0 [&_em]:px-1.5 [&_em]:border [&_em]:border-transparent [&_i]:not-italic [&_i]:text-[10px] [&_i]:font-semibold [&_i]:rounded-full [&_i]:py-0 [&_i]:px-1.5 [&_i]:border [&_i]:border-transparent [&_.is-head]:!border-none [&_.is-head]:!bg-transparent [&_.is-head]:!p-0 [&_.is-head]:tracking-[0.02em] [&_.is-head]:text-[color-mix(in_srgb,var(--accent-primary,#2563eb)_92%,#bfdbfe)] [&_.is-special]:text-[color-mix(in_srgb,var(--text-muted)_82%,var(--text-secondary))] [&_.is-special]:border-[color-mix(in_srgb,var(--border-default)_62%,transparent)] [&_.is-special]:bg-[color-mix(in_srgb,var(--surface-control,#1a2230)_66%,transparent)] [&_.is-ahead]:text-[#16a34a] [&_.is-ahead]:border-[color-mix(in_srgb,#16a34a_45%,transparent)] [&_.is-ahead]:bg-[color-mix(in_srgb,#16a34a_14%,transparent)] [&_.is-behind]:text-[#dc2626] [&_.is-behind]:border-[color-mix(in_srgb,#dc2626_45%,transparent)] [&_.is-behind]:bg-[color-mix(in_srgb,#dc2626_14%,transparent)]">
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

            <div className="git-history-tree-section mb-1.5">
              <ActionSurface
                className="git-history-tree-section-toggle w-full justify-start border-none mx-1 py-[5px] px-2 gap-1.5 text-(--text-secondary) text-[10px] uppercase tracking-[0.06em] font-bold rounded-lg [&_svg]:text-[color-mix(in_srgb,var(--text-muted)_86%,transparent)]"
                onActivate={() => setRemoteSectionExpanded((prev) => !prev)}
                ariaLabel={t("git.historyToggleRemoteBranches")}
              >
                {remoteSectionExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <Cloud size={13} />
                <span>{t("git.historyRemote")}</span>
              </ActionSurface>
              {remoteSectionExpanded && (
                <div className="git-history-tree-section-body flex flex-col gap-0.5 mt-[3px]">
                  {groupedRemoteBranches.map((group) => {
                    const scopeExpanded = expandedRemoteScopes.has(group.remote);
                    return (
                      <div key={`remote-group-${group.remote}`} className="git-history-tree-scope-group flex flex-col gap-px">
                        <ActionSurface
                          className="git-history-tree-scope-toggle w-full justify-start border-none mx-1 py-[5px] pr-2 pl-[22px] gap-1.5 rounded-lg text-(--text-muted) text-[10px] tracking-[0.06em] uppercase font-semibold"
                          onActivate={() => handleToggleRemoteScope(group.remote)}
                          ariaLabel={t("git.historyToggleRemoteGroup", { group: group.remote })}
                        >
                          {scopeExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          {scopeExpanded ? <FolderOpen size={12} /> : <Folder size={12} />}
                          <span className="git-history-tree-scope-label min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{group.remote}</span>
                        </ActionSurface>
                        {scopeExpanded &&
                          group.items.map((entry) => (
                            <div
                              key={`remote-${entry.name}`}
                              className="git-history-branch-row git-history-branch-row-remote block my-0 mx-2.5 ml-9"
                              onContextMenu={(event) => handleOpenBranchContextMenu(event, entry, "remote")}
                            >
                              <ActionSurface
                                className={`git-history-branch-item git-history-branch-item-remote-tree w-full justify-start border-none flex items-center justify-between gap-2 py-1.5 px-2 text-xs rounded-lg m-0 min-w-0 box-border min-h-7 pl-2.5 pr-3 text-(--text-secondary) [&_.git-history-branch-badges]:mr-0${selectedBranch === entry.name ? " is-active bg-[color-mix(in_srgb,var(--accent-primary,#2563eb)_17%,transparent)]" : ""}`}
                                active={selectedBranch === entry.name}
                                onActivate={() => setSelectedBranch(entry.name)}
                              >
                                <span className="git-history-tree-branch-main flex-1 min-w-0 inline-flex items-center gap-1.5 [&_svg]:text-[color-mix(in_srgb,var(--text-muted)_82%,transparent)] [&_svg]:flex-none">
                                  <GitBranch size={11} />
                                  <span className="git-history-branch-name min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                                    {trimRemotePrefix(entry.name, group.remote)}
                                  </span>
                                </span>
                                <span className="git-history-branch-badges inline-flex items-center gap-1.5 flex-none [&_i]:not-italic [&_i]:text-[10px] [&_i]:font-semibold [&_i]:rounded-full [&_i]:py-0 [&_i]:px-1.5 [&_i]:border [&_i]:border-transparent [&_.is-special]:text-[color-mix(in_srgb,var(--text-muted)_82%,var(--text-secondary))] [&_.is-special]:border-[color-mix(in_srgb,var(--border-default)_62%,transparent)] [&_.is-special]:bg-[color-mix(in_srgb,var(--surface-control,#1a2230)_66%,transparent)]">
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
            className="git-history-vertical-resizer relative cursor-col-resize touch-none bg-[color-mix(in_srgb,var(--surface-control,#1a2230)_58%,transparent)] after:content-[''] after:absolute after:top-0 after:bottom-0 after:left-1/2 after:w-px after:bg-[color-mix(in_srgb,var(--border-default)_88%,transparent)] after:-translate-x-[0.5px] hover:after:bg-[color-mix(in_srgb,var(--accent-primary,#2563eb)_72%,transparent)]"
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

        <section className="git-history-commits min-w-0 min-h-0 flex flex-col border-r border-(--border-default) overflow-hidden bg-(--git-history-pane-bg)">
          <div className="git-history-column-header flex items-center justify-between gap-2 py-[7px] px-2.5 border-b border-(--border-default) text-[11px] text-(--text-secondary) bg-[color-mix(in_srgb,var(--surface-card-muted,#111725)_72%,transparent)] min-h-11 box-border [&>span]:inline-flex [&>span]:items-center [&>span]:gap-1.5 [&>span]:font-semibold">
            <span>
              <GitCommit size={14} /> {t("git.historyCommits")}
            </span>
          </div>
          <label className="git-history-search flex items-center gap-1.5 my-2 mx-2.5 py-1.5 px-2 border border-(--border-default) rounded-[7px] bg-(--surface-control,#1a2130) text-(--text-muted) [&_input]:border-none [&_input]:bg-transparent [&_input]:w-full [&_input]:min-w-0 [&_input]:text-inherit [&_input]:outline-none [&_input]:text-xs">
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
            <div className="git-history-empty p-4 text-(--text-muted) text-xs">{t("git.historyLoadingCommits")}</div>
          )}
          {!historyLoading && !commits.length && (
            <div className="git-history-empty p-4 text-(--text-muted) text-xs">{t("git.historyNoCommitsFound")}</div>
          )}

          <div className="git-history-commit-list flex-1 min-h-0 overflow-auto relative" ref={commitListRef}>
            <div
              className="git-history-commit-list-virtual relative"
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
                  className={`git-history-commit-row w-full justify-start rounded-none border-none grid [grid-template-columns:18px_minmax(0,1fr)] gap-[7px] items-start py-[7px] px-2.5 border-b border-b-[color-mix(in_srgb,var(--border-default)_48%,transparent)]${active ? " bg-[color-mix(in_srgb,var(--accent-primary,#2563eb)_17%,transparent)]" : ""}`}
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
                  <span className={`${graphClassName} relative block h-full min-h-8.5 [&.is-first_.git-history-graph-line]:top-2 [&.is-last_.git-history-graph-line]:bottom-2`} aria-hidden>
                    <i className="git-history-graph-line absolute left-[7px] -top-2 -bottom-2 w-0.5 bg-[color-mix(in_srgb,var(--text-muted)_45%,transparent)]" />
                    <i className="git-history-graph-dot absolute left-[3px] top-[11px] w-2.5 h-2.5 rounded-full bg-(--accent-primary,#2563eb)" />
                  </span>
                  <span className="git-history-commit-content min-w-0 flex flex-col gap-0.5">
                    <span
                      className="git-history-commit-summary text-xs leading-[1.35] whitespace-nowrap overflow-hidden text-ellipsis"
                      title={entry.summary || t("git.historyNoMessage")}
                    >
                      {entry.summary || t("git.historyNoMessage")}
                    </span>
                    <span className="git-history-commit-meta inline-flex items-center gap-[7px] text-(--text-muted) text-[10px]">
                      <code>{entry.shortSha}</code>
                      <em>{entry.author || t("git.unknown")}</em>
                      <time>{formatRelativeTime(entry.timestamp, t)}</time>
                    </span>
                    {entry.refs.length > 0 && (
                      <span className="git-history-commit-refs text-[color-mix(in_srgb,var(--accent-primary,#2563eb)_62%,var(--text-muted))] text-[10px] whitespace-nowrap overflow-hidden text-ellipsis" title={entry.refs.join(", ")}>
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
            <div className="git-history-load-more py-2 px-2.5 border-t border-(--border-default) flex justify-center">
              <ActionSurface
                className="git-history-load-more-chip h-6 px-2 text-[11px] rounded-full border-[color-mix(in_srgb,var(--border-default)_72%,transparent)] bg-[color-mix(in_srgb,var(--surface-control,#1a2230)_72%,transparent)]"
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
            className="git-history-vertical-resizer relative cursor-col-resize touch-none bg-[color-mix(in_srgb,var(--surface-control,#1a2230)_58%,transparent)] after:content-[''] after:absolute after:top-0 after:bottom-0 after:left-1/2 after:w-px after:bg-[color-mix(in_srgb,var(--border-default)_88%,transparent)] after:-translate-x-[0.5px] hover:after:bg-[color-mix(in_srgb,var(--accent-primary,#2563eb)_72%,transparent)]"
            role="separator"
            aria-orientation="vertical"
            onMouseDown={handleCommitsSplitResizeStart}
            onDoubleClick={() => {
              const defaults = getCurrentDefaultColumnWidths();
              setCommitsWidth(defaults.commitsWidth);
            }}
          />
        )}

        <section className="git-history-details min-w-0 min-h-0 flex flex-col overflow-hidden bg-(--git-history-pane-bg)">
          <div className="git-history-column-header flex items-center justify-between gap-2 py-[7px] px-2.5 border-b border-(--border-default) text-[11px] text-(--text-secondary) bg-[color-mix(in_srgb,var(--surface-card-muted,#111725)_72%,transparent)] min-h-11 box-border [&>span]:inline-flex [&>span]:items-center [&>span]:gap-1.5 [&>span]:font-semibold">
            <span>
              {details ? <FolderTree size={14} /> : <FileText size={14} />}
              {details ? t("git.historyChangedFiles") : t("git.historyCommitDetails")}
            </span>
            {details && (
              <span className="git-history-file-tree-head-summary inline-flex items-center gap-0 whitespace-nowrap">
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
            <div className="git-history-empty p-4 text-(--text-muted) text-xs">{t("git.historyLoadingCommitDetails")}</div>
          )}
          {!detailsLoading && !details && (
            <div className="git-history-empty p-4 text-(--text-muted) text-xs">{t("git.historySelectCommitToViewDetails")}</div>
          )}

          {details && (
            <>
              <div
                className="git-history-details-body grid min-h-0 h-full"
                ref={detailsBodyRef}
                style={{
                  gridTemplateRows: `minmax(140px, ${detailsSplitRatio}%) 8px minmax(0, 1fr)`,
                }}
              >
                <div className="git-history-file-list git-filetree-section flex-1 min-h-0 overflow-auto border border-(--git-filetree-section-border) rounded-(--git-filetree-section-radius) bg-transparent shadow-none">
                  {!fileTreeItems.length && (
                    <div className="git-history-empty p-4 text-(--text-muted) text-xs">
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
                    };
                    if (item.type === "dir") {
                      return (
                        <ActionSurface
                          key={item.id}
                          className="git-history-tree-item git-history-tree-dir git-filetree-folder-row w-full justify-start border-none grid [grid-template-columns:12px_auto_minmax(0,1fr)] items-center min-h-(--git-filetree-row-min-height) gap-(--git-filetree-row-gap) py-(--git-filetree-row-pad-y) px-(--git-filetree-row-pad-x) border border-transparent rounded-(--git-filetree-row-radius) bg-transparent text-[13px] relative font-[560] text-(--text-secondary)"
                          onActivate={() => handleFileTreeDirToggle(item.path)}
                          style={treeRowStyle}
                        >
                          <span className="git-history-tree-caret text-(--text-muted) inline-flex items-center justify-center w-(--git-filetree-icon-size)" aria-hidden>
                            {item.expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          </span>
                          <span className="git-history-tree-icon inline-flex items-center justify-center text-[color-mix(in_srgb,var(--text-muted)_86%,transparent)] w-4 h-4 [&_.file-icon]:w-4 [&_.file-icon]:h-4 [&_.file-icon_svg]:w-4 [&_.file-icon_svg]:h-4" aria-hidden>
                            <FileIcon filePath={item.path} isFolder isOpen={item.expanded} />
                          </span>
                          <span className="git-history-tree-label min-w-0 overflow-hidden whitespace-nowrap text-ellipsis">{item.label}</span>
                        </ActionSurface>
                      );
                    }

                    const file = item.change;
                    const active = selectedFileKey === buildFileKey(file);
                    return (
                      <ActionSurface
                        key={item.id}
                        className="git-history-tree-item git-history-file-item git-filetree-row w-full justify-start border-none grid [grid-template-columns:auto_auto_minmax(0,1fr)_auto] items-center min-h-(--git-filetree-row-min-height) gap-(--git-filetree-row-gap) py-(--git-filetree-row-pad-y) px-(--git-filetree-row-pad-x) border border-transparent rounded-(--git-filetree-row-radius) bg-transparent text-[13px] relative"
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
                          className={`git-history-file-status git-status-${file.status.toLowerCase()} inline-flex items-center justify-center w-[19px] h-[19px] rounded-full text-[10px] font-bold bg-[color-mix(in_srgb,var(--surface-control,#1a2230)_85%,transparent)]`}
                        >
                          {file.status}
                        </span>
                        <span className="git-history-tree-icon is-file inline-flex items-center justify-center text-[color-mix(in_srgb,var(--text-secondary)_84%,transparent)] w-4 h-4 [&_.file-icon]:w-4 [&_.file-icon]:h-4 [&_.file-icon_svg]:w-4 [&_.file-icon_svg]:h-4" aria-hidden>
                          <FileIcon filePath={file.path} />
                        </span>
                        <span className="git-history-file-path min-w-0 overflow-hidden whitespace-nowrap text-ellipsis">{item.label}</span>
                        <span className="git-history-file-stats git-filetree-badge text-(--git-filetree-badge-font-size) whitespace-nowrap inline-flex items-center gap-(--git-filetree-badge-gap) py-(--git-filetree-badge-pad-y) px-(--git-filetree-badge-pad-x) rounded-(--git-filetree-badge-radius) border border-[color-mix(in_srgb,var(--border-default)_58%,transparent)] bg-[color-mix(in_srgb,var(--surface-control,#1a2230)_64%,transparent)] font-(family-name:--code-font-family) [font-variant-numeric:tabular-nums] [&_.is-add]:text-[#22c55e] [&_.is-del]:text-[#f87171] [&_.is-sep]:text-(--text-muted)">
                          <span className="is-add">+{file.additions}</span>
                          <span className="is-sep">/</span>
                          <span className="is-del">-{file.deletions}</span>
                        </span>
                      </ActionSurface>
                    );
                  })}
                </div>

                <div
                  className="git-history-details-resizer relative cursor-row-resize bg-[color-mix(in_srgb,var(--surface-control,#1a2230)_58%,transparent)] after:content-[''] after:absolute after:left-0 after:right-0 after:top-1/2 after:h-px after:bg-[color-mix(in_srgb,var(--border-default)_88%,transparent)] after:-translate-y-[0.5px]"
                  role="separator"
                  aria-orientation="horizontal"
                  aria-label={t("git.historyResizeFileListAndDiff")}
                  onMouseDown={handleDetailsSplitResizeStart}
                  onDoubleClick={() => setDetailsSplitRatio(DEFAULT_DETAILS_SPLIT)}
                />

                <div className="git-history-diff-view flex-1 min-h-0 overflow-auto">
                  <div className="git-history-message-panel flex flex-col gap-2.5 p-2.5">
                    <div className="git-history-message-row flex flex-col gap-1">
                      <span className="git-history-message-label text-[11px] text-(--text-muted) tracking-[0.02em]">{t("git.historyCommitMetaTitleLabel")}</span>
                      <strong className="git-history-message-title text-[15px] leading-[1.35] text-(--text-stronger)">
                        {details.summary || t("git.historyNoMessage")}
                      </strong>
                    </div>
                    <div className="git-history-message-row flex flex-col gap-1">
                      <span className="git-history-message-label text-[11px] text-(--text-muted) tracking-[0.02em]">{t("git.historyCommitMetaContentLabel")}</span>
                      <div className="git-history-message-content text-[13px] leading-[1.45] text-(--text-secondary) whitespace-pre-wrap wrap-break-word">
                        {detailsMessageContent}
                      </div>
                    </div>
                    <div className="git-history-message-meta-row flex flex-wrap gap-2.5 items-center">
                      <span className="git-history-message-meta-item inline-flex items-center gap-1.5 text-[11px] text-(--text-muted) [&_i]:not-italic [&_i]:text-[color-mix(in_srgb,var(--text-muted)_84%,transparent)] [&_code]:text-[11px]">
                        <i>{t("git.historyCommitMetaAuthorLabel")}</i>
                        <span>{details.author || t("git.unknown")}</span>
                      </span>
                      <span className="git-history-message-meta-item inline-flex items-center gap-1.5 text-[11px] text-(--text-muted) [&_i]:not-italic [&_i]:text-[color-mix(in_srgb,var(--text-muted)_84%,transparent)] [&_code]:text-[11px]">
                        <i>{t("git.historyCommitMetaTimeLabel")}</i>
                        <time>{new Date(details.commitTime * 1000).toLocaleString()}</time>
                      </span>
                      <span className="git-history-message-meta-item inline-flex items-center gap-1.5 text-[11px] text-(--text-muted) [&_i]:not-italic [&_i]:text-[color-mix(in_srgb,var(--text-muted)_84%,transparent)] [&_code]:text-[11px]">
                        <i>{t("git.historyCommitMetaIdLabel")}</i>
                        <code>{details.sha}</code>
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {previewDetailFile && (
                <div
                  className="git-history-diff-modal-overlay fixed inset-0 z-50 bg-[rgba(7,11,18,0.42)] flex items-center justify-center p-6 animate-[git-history-modal-fade-in_130ms_ease]"
                  role="presentation"
                  onClick={() => setPreviewFileKey(null)}
                >
                  <div
                    className={`git-history-diff-modal w-[min(1080px,calc(100vw-48px))] max-h-[calc(100vh-64px)] rounded-xl border border-[color-mix(in_srgb,var(--border-strong,var(--border-default))_82%,transparent)] bg-(--surface-popover,var(--surface-messages,#0d0f14)) text-(--text-primary) shadow-[0_22px_64px_rgba(0,0,0,0.4)] overflow-hidden flex flex-col animate-[git-history-modal-pop-in_160ms_ease]${isHistoryDiffModalMaximized ? " is-maximized w-[calc(100vw-16px)] max-h-[calc(100vh-16px)] rounded-lg" : ""}`}
                    role="dialog"
                    aria-modal="true"
                    aria-label={previewDetailFile.path}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div className="git-history-diff-modal-header min-h-9 flex items-center justify-between gap-3 py-1.5 px-2.5 border-b border-b-[color-mix(in_srgb,var(--border-default)_48%,transparent)]">
                      <div className="git-history-diff-modal-title min-w-0 flex-1 inline-flex items-center gap-2 text-xs text-(--text-muted)">
                        <span
                          className={`git-history-file-status git-status-${previewDetailFile.status.toLowerCase()} inline-flex items-center justify-center w-[19px] h-[19px] rounded-full text-[10px] font-bold bg-[color-mix(in_srgb,var(--surface-control,#1a2230)_85%,transparent)]`}
                        >
                          {previewDetailFile.status}
                        </span>
                        <span className="git-history-tree-icon is-file inline-flex items-center justify-center text-[color-mix(in_srgb,var(--text-secondary)_84%,transparent)] w-4 h-4 [&_.file-icon]:w-4 [&_.file-icon]:h-4 [&_.file-icon_svg]:w-4 [&_.file-icon_svg]:h-4" aria-hidden>
                          <FileIcon filePath={previewDetailFile.path} />
                        </span>
                        <span className="git-history-diff-modal-path min-w-0 flex-1 whitespace-nowrap overflow-hidden text-ellipsis text-(--text-strong)">{previewDetailFile.path}</span>
                        <span className="git-history-diff-modal-stats text-[11px] whitespace-nowrap inline-flex items-center gap-0.75 [&_.is-add]:text-[#22c55e] [&_.is-del]:text-[#f87171] [&_.is-sep]:text-(--text-muted)">
                          <span className="is-add">+{previewDetailFile.additions}</span>
                          <span className="is-sep">/</span>
                          <span className="is-del">-{previewDetailFile.deletions}</span>
                        </span>
                      </div>
                      <div className="git-history-diff-modal-actions inline-flex flex-none items-center gap-2.5 whitespace-nowrap">
                        <button
                          type="button"
                          className="git-history-diff-modal-close w-[26px] h-[26px] border border-[color-mix(in_srgb,var(--border-default)_72%,transparent)] rounded-lg bg-[color-mix(in_srgb,var(--surface-control,#1a2230)_72%,transparent)] text-(--text-emphasis,#111827) inline-flex items-center justify-center cursor-pointer leading-none hover:text-(--text-strong,#0f172a) hover:border-[color-mix(in_srgb,var(--border-default)_92%,transparent)] [&>svg]:w-3.5 [&>svg]:h-3.5 [&>svg]:block [&>svg]:flex-none [&>svg]:stroke-current [&>svg]:[stroke-width:2.2]"
                          onClick={() => setIsHistoryDiffModalMaximized((value) => !value)}
                          aria-label={isHistoryDiffModalMaximized ? t("common.restore") : t("menu.maximize")}
                          title={isHistoryDiffModalMaximized ? t("common.restore") : t("menu.maximize")}
                        >
                          <span className="git-history-diff-modal-close-glyph inline-flex items-center justify-center w-3.5 h-3.5 text-base font-bold leading-none" aria-hidden>
                            {isHistoryDiffModalMaximized ? "❐" : "□"}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="git-history-diff-modal-close w-[26px] h-[26px] border border-[color-mix(in_srgb,var(--border-default)_72%,transparent)] rounded-lg bg-[color-mix(in_srgb,var(--surface-control,#1a2230)_72%,transparent)] text-(--text-emphasis,#111827) inline-flex items-center justify-center cursor-pointer leading-none hover:text-(--text-strong,#0f172a) hover:border-[color-mix(in_srgb,var(--border-default)_92%,transparent)] [&>svg]:w-3.5 [&>svg]:h-3.5 [&>svg]:block [&>svg]:flex-none [&>svg]:stroke-current [&>svg]:[stroke-width:2.2]"
                          onClick={() => setPreviewFileKey(null)}
                          aria-label={t("common.close")}
                          title={t("common.close")}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>

                    {previewDetailFile.truncated && !previewDetailFile.isBinary && (
                      <div className="git-history-warning m-2 py-2 px-2.5 rounded-lg bg-[color-mix(in_srgb,#f59e0b_18%,transparent)] text-(--text-secondary) text-xs">
                        {t("git.historyDiffTooLargeTruncated", {
                          lineCount: previewDetailFile.lineCount,
                        })}
                      </div>
                    )}
                    {previewDetailFile.isBinary ? (
                      <pre className="git-history-diff-modal-code m-0 p-3 overflow-auto text-xs leading-[1.45] text-(--text-primary) bg-[color-mix(in_srgb,var(--surface-control,#1a2230)_56%,transparent)] whitespace-pre font-(family-name:--code-font-family,ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation_Mono','Courier_New',monospace)">{previewDetailFileDiff}</pre>
                    ) : (
                      <div className="git-history-diff-modal-viewer flex flex-col min-h-[280px] h-[calc(100vh-180px)] max-h-[calc(100vh-180px)] min-w-0 overflow-hidden [.is-maximized_&]:h-[calc(100vh-128px)] [.is-maximized_&]:max-h-[calc(100vh-128px)] [&>.diff-viewer-frame]:flex-1 [&>.diff-viewer-frame]:min-h-0 [&>.diff-viewer-frame]:min-w-0">
                        <GitDiffViewer
                          workspaceId={workspaceId}
                          diffs={previewDiffEntries}
                          selectedPath={previewDetailFile.path}
                          isLoading={false}
                          error={null}
                          listView="flat"
                          stickyHeaderMode="controls-only"
                          embeddedAnchorVariant="modal-pager"
                          showContentModeControls
                          fullDiffLoader={previewModalFullDiffLoader}
                          fullDiffSourceKey={selectedCommitSha}
                          diffStyle={diffViewMode}
                          onDiffStyleChange={setDiffViewMode}
                          onCreateCodeAnnotation={onCreateCodeAnnotation}
                          onRemoveCodeAnnotation={onRemoveCodeAnnotation}
                          codeAnnotations={codeAnnotations}
                          codeAnnotationSurface="modal-diff-view"
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
            className="git-history-diff-modal-overlay fixed inset-0 z-50 bg-[rgba(7,11,18,0.42)] flex items-center justify-center p-6 animate-[git-history-modal-fade-in_130ms_ease]"
            role="presentation"
            onClick={closeWorktreePreview}
          >
            <div
              className={`git-history-diff-modal w-[min(1080px,calc(100vw-48px))] max-h-[calc(100vh-64px)] rounded-xl border border-[color-mix(in_srgb,var(--border-strong,var(--border-default))_82%,transparent)] bg-(--surface-popover,var(--surface-messages,#0d0f14)) text-(--text-primary) shadow-[0_22px_64px_rgba(0,0,0,0.4)] overflow-hidden flex flex-col animate-[git-history-modal-pop-in_160ms_ease]${isHistoryDiffModalMaximized ? " is-maximized w-[calc(100vw-16px)] max-h-[calc(100vh-16px)] rounded-lg" : ""}`}
              role="dialog"
              aria-modal="true"
              aria-label={worktreePreviewFile.path}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="git-history-diff-modal-header min-h-9 flex items-center justify-between gap-3 py-1.5 px-2.5 border-b border-b-[color-mix(in_srgb,var(--border-default)_48%,transparent)]">
                <div className="git-history-diff-modal-title min-w-0 flex-1 inline-flex items-center gap-2 text-xs text-(--text-muted)">
                  <span className={`git-history-file-status git-status-${worktreePreviewFile.status.toLowerCase()} inline-flex items-center justify-center w-[19px] h-[19px] rounded-full text-[10px] font-bold bg-[color-mix(in_srgb,var(--surface-control,#1a2230)_85%,transparent)]`}>
                    {worktreePreviewFile.status}
                  </span>
                  <span className="git-history-tree-icon is-file inline-flex items-center justify-center text-[color-mix(in_srgb,var(--text-secondary)_84%,transparent)] w-4 h-4 [&_.file-icon]:w-4 [&_.file-icon]:h-4 [&_.file-icon_svg]:w-4 [&_.file-icon_svg]:h-4" aria-hidden>
                    <FileIcon filePath={worktreePreviewFile.path} />
                  </span>
                  <span className="git-history-diff-modal-path min-w-0 flex-1 whitespace-nowrap overflow-hidden text-ellipsis text-(--text-strong)">{worktreePreviewFile.path}</span>
                  <span className="git-history-diff-modal-stats text-[11px] whitespace-nowrap inline-flex items-center gap-0.75 [&_.is-add]:text-[#22c55e] [&_.is-del]:text-[#f87171] [&_.is-sep]:text-(--text-muted)">
                    <span className="is-add">+{worktreePreviewFile.additions}</span>
                    <span className="is-sep">/</span>
                    <span className="is-del">-{worktreePreviewFile.deletions}</span>
                  </span>
                </div>
                <div className="git-history-diff-modal-actions inline-flex flex-none items-center gap-2.5 whitespace-nowrap">
                  <button
                    type="button"
                    className="git-history-diff-modal-close w-[26px] h-[26px] border border-[color-mix(in_srgb,var(--border-default)_72%,transparent)] rounded-lg bg-[color-mix(in_srgb,var(--surface-control,#1a2230)_72%,transparent)] text-(--text-emphasis,#111827) inline-flex items-center justify-center cursor-pointer leading-none hover:text-(--text-strong,#0f172a) hover:border-[color-mix(in_srgb,var(--border-default)_92%,transparent)] [&>svg]:w-3.5 [&>svg]:h-3.5 [&>svg]:block [&>svg]:flex-none [&>svg]:stroke-current [&>svg]:[stroke-width:2.2]"
                    onClick={() => setIsHistoryDiffModalMaximized((value) => !value)}
                    aria-label={isHistoryDiffModalMaximized ? t("common.restore") : t("menu.maximize")}
                    title={isHistoryDiffModalMaximized ? t("common.restore") : t("menu.maximize")}
                  >
                    <span className="git-history-diff-modal-close-glyph inline-flex items-center justify-center w-3.5 h-3.5 text-base font-bold leading-none" aria-hidden>
                      {isHistoryDiffModalMaximized ? "❐" : "□"}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="git-history-diff-modal-close w-[26px] h-[26px] border border-[color-mix(in_srgb,var(--border-default)_72%,transparent)] rounded-lg bg-[color-mix(in_srgb,var(--surface-control,#1a2230)_72%,transparent)] text-(--text-emphasis,#111827) inline-flex items-center justify-center cursor-pointer leading-none hover:text-(--text-strong,#0f172a) hover:border-[color-mix(in_srgb,var(--border-default)_92%,transparent)] [&>svg]:w-3.5 [&>svg]:h-3.5 [&>svg]:block [&>svg]:flex-none [&>svg]:stroke-current [&>svg]:[stroke-width:2.2]"
                    onClick={closeWorktreePreview}
                    aria-label={t("common.close")}
                    title={t("common.close")}
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
              {worktreePreviewError ? (
                <div className="git-history-error">
                  {localizeKnownGitError(worktreePreviewError) ?? worktreePreviewError}
                </div>
              ) : null}
              {worktreePreviewLoading ? (
                <div className="git-history-empty p-4 text-(--text-muted) text-xs">{t("common.loading")}</div>
              ) : worktreePreviewFile.isBinary || !(worktreePreviewFile.diff ?? "").trim() ? (
                <pre className="git-history-diff-modal-code m-0 p-3 overflow-auto text-xs leading-[1.45] text-(--text-primary) bg-[color-mix(in_srgb,var(--surface-control,#1a2230)_56%,transparent)] whitespace-pre font-(family-name:--code-font-family,ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation_Mono','Courier_New',monospace)">{worktreePreviewDiffText}</pre>
              ) : (
                <div className="git-history-diff-modal-viewer flex flex-col min-h-[280px] h-[calc(100vh-180px)] max-h-[calc(100vh-180px)] min-w-0 overflow-hidden [.is-maximized_&]:h-[calc(100vh-128px)] [.is-maximized_&]:max-h-[calc(100vh-128px)] [&>.diff-viewer-frame]:flex-1 [&>.diff-viewer-frame]:min-h-0 [&>.diff-viewer-frame]:min-w-0">
                  <GitDiffViewer
                    workspaceId={workspaceId}
                    diffs={worktreePreviewDiffEntries}
                    selectedPath={worktreePreviewFile.path}
                    isLoading={false}
                    error={null}
                    listView="flat"
                    stickyHeaderMode="controls-only"
                    embeddedAnchorVariant="modal-pager"
                    showContentModeControls
                    fullDiffLoader={worktreePreviewFullDiffLoader}
                    fullDiffSourceKey={worktreePreviewFile.path}
                    diffStyle={diffViewMode}
                    onDiffStyleChange={setDiffViewMode}
                    onCreateCodeAnnotation={onCreateCodeAnnotation}
                    onRemoveCodeAnnotation={onRemoveCodeAnnotation}
                    codeAnnotations={codeAnnotations}
                    codeAnnotationSurface="modal-diff-view"
                  />
                </div>
              )}
            </div>
          </div>
        )}
        </div>
        {branchDiffState ? (
          <div
            className="git-history-diff-modal-overlay fixed inset-0 z-50 bg-[rgba(7,11,18,0.42)] flex items-center justify-center p-6 animate-[git-history-modal-fade-in_130ms_ease]"
            role="presentation"
            onClick={closeBranchDiff}
          >
            <div
              className={`git-history-diff-modal w-[min(1080px,calc(100vw-48px))] max-h-[calc(100vh-64px)] rounded-xl border bg-(--surface-popover,var(--surface-messages,#0d0f14)) text-(--text-primary) shadow-[0_22px_64px_rgba(0,0,0,0.4)] overflow-hidden flex flex-col animate-[git-history-modal-pop-in_160ms_ease] ${
                branchDiffState.mode === "worktree"
                  ? `git-history-branch-worktree-diff-modal ${branchDiffModeClassName} [--git-history-branch-diff-accent:var(--accent-primary,#2563eb)] [&.is-worktree-mode]:[--git-history-branch-diff-accent:#0ea5e9] [&.is-branch-mode]:[--git-history-branch-diff-accent:#f59e0b] !w-[min(1320px,calc(100vw-24px))] max-h-[calc(100vh-28px)] !rounded-[14px] border-[color-mix(in_srgb,var(--git-history-branch-diff-accent)_24%,color-mix(in_srgb,var(--border-default)_86%,transparent))]`
                  : "git-history-branch-compare-modal border-[color-mix(in_srgb,var(--border-strong,var(--border-default))_82%,transparent)]"
              } ${isHistoryDiffModalMaximized ? "is-maximized w-[calc(100vw-16px)] max-h-[calc(100vh-16px)] rounded-lg" : ""}`}
              role="dialog"
              aria-modal="true"
              aria-label={branchDiffTitle}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="git-history-diff-modal-header min-h-9 flex items-center justify-between gap-3 py-1.5 px-2.5 border-b border-b-[color-mix(in_srgb,var(--border-default)_48%,transparent)] [.git-history-branch-worktree-diff-modal_&]:min-h-12 [.git-history-branch-worktree-diff-modal_&]:p-2.5 [.git-history-branch-worktree-diff-modal_&]:px-3 [.git-history-branch-worktree-diff-modal_&]:border-b-[color-mix(in_srgb,var(--git-history-branch-diff-accent)_24%,var(--border-default))] [.git-history-branch-worktree-diff-modal_&]:bg-linear-to-r [.git-history-branch-worktree-diff-modal_&]:from-[color-mix(in_srgb,var(--git-history-branch-diff-accent)_16%,transparent)] [.git-history-branch-worktree-diff-modal_&]:to-[color-mix(in_srgb,var(--surface-control,#1a2230)_46%,transparent)]">
                <div className="git-history-diff-modal-title git-history-branch-worktree-diff-title min-w-0 flex flex-col items-start gap-1">
                  <span className="git-history-branch-worktree-diff-title-main min-w-0 inline-flex items-center gap-2">
                    <span
                      className={`git-history-branch-worktree-diff-title-icon ${branchDiffModeClassName} w-[22px] h-[22px] rounded-full inline-flex items-center justify-center shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--git-history-branch-diff-accent)_35%,transparent)] ${isWorktreeDiffMode ? "text-[color-mix(in_srgb,#0ea5e9_88%,#cffafe)] bg-[color-mix(in_srgb,#0ea5e9_20%,transparent)]" : "text-[color-mix(in_srgb,#f59e0b_88%,#fef3c7)] bg-[color-mix(in_srgb,#f59e0b_20%,transparent)]"}`}
                      aria-hidden
                    >
                      {isWorktreeDiffMode ? <FolderTree size={14} /> : <GitCommit size={14} />}
                    </span>
                    <span className={`git-history-branch-worktree-diff-mode-badge ${branchDiffModeClassName} py-0.5 px-2 rounded-full text-[10px] font-bold tracking-[0.02em] ${isWorktreeDiffMode ? "border border-[color-mix(in_srgb,#0ea5e9_34%,transparent)] text-[color-mix(in_srgb,#0ea5e9_88%,#e0f2fe)] bg-[color-mix(in_srgb,#0ea5e9_16%,transparent)]" : "border border-[color-mix(in_srgb,#f59e0b_38%,transparent)] text-[color-mix(in_srgb,#f59e0b_90%,#fef3c7)] bg-[color-mix(in_srgb,#f59e0b_18%,transparent)]"}`}>
                      {branchDiffModeLabel}
                    </span>
                    <span className="git-history-branch-worktree-diff-title-text min-w-0 whitespace-nowrap overflow-hidden text-ellipsis text-(--text-strong) text-[12.5px]">{branchDiffTitle}</span>
                  </span>
                  <span className="git-history-branch-worktree-diff-subtitle min-w-0 max-w-full text-(--text-muted) text-[11px] whitespace-nowrap overflow-hidden text-ellipsis">{branchDiffSubtitle}</span>
                  <span className="git-history-diff-modal-stats git-history-branch-worktree-diff-stats py-0.5 px-2 rounded-full !text-[11px] !font-semibold !border !border-[color-mix(in_srgb,var(--git-history-branch-diff-accent)_34%,transparent)] !bg-[color-mix(in_srgb,var(--git-history-branch-diff-accent)_16%,transparent)] !text-[color-mix(in_srgb,var(--git-history-branch-diff-accent)_88%,#dbeafe)]">
                    {branchDiffStatsLabel}
                  </span>
                </div>
                <div className="git-history-diff-modal-actions inline-flex flex-none items-center gap-2.5 whitespace-nowrap">
                  <button
                    type="button"
                    className="git-history-diff-modal-close w-[26px] h-[26px] border border-[color-mix(in_srgb,var(--border-default)_72%,transparent)] rounded-lg bg-[color-mix(in_srgb,var(--surface-control,#1a2230)_72%,transparent)] text-(--text-emphasis,#111827) inline-flex items-center justify-center cursor-pointer leading-none hover:text-(--text-strong,#0f172a) hover:border-[color-mix(in_srgb,var(--border-default)_92%,transparent)] [&>svg]:w-3.5 [&>svg]:h-3.5 [&>svg]:block [&>svg]:flex-none [&>svg]:stroke-current [&>svg]:[stroke-width:2.2]"
                    onClick={() => setIsHistoryDiffModalMaximized((value) => !value)}
                    aria-label={isHistoryDiffModalMaximized ? t("common.restore") : t("menu.maximize")}
                    title={isHistoryDiffModalMaximized ? t("common.restore") : t("menu.maximize")}
                  >
                    <span className="git-history-diff-modal-close-glyph inline-flex items-center justify-center w-3.5 h-3.5 text-base font-bold leading-none" aria-hidden>
                      {isHistoryDiffModalMaximized ? "❐" : "□"}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="git-history-diff-modal-close w-[26px] h-[26px] border border-[color-mix(in_srgb,var(--border-default)_72%,transparent)] rounded-lg bg-[color-mix(in_srgb,var(--surface-control,#1a2230)_72%,transparent)] text-(--text-emphasis,#111827) inline-flex items-center justify-center cursor-pointer leading-none hover:text-(--text-strong,#0f172a) hover:border-[color-mix(in_srgb,var(--border-default)_92%,transparent)] [&>svg]:w-3.5 [&>svg]:h-3.5 [&>svg]:block [&>svg]:flex-none [&>svg]:stroke-current [&>svg]:[stroke-width:2.2]"
                    onClick={closeBranchDiff}
                    aria-label={t("common.close")}
                    title={t("common.close")}
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>

              {branchDiffState.loading ? (
                <div className="git-history-empty p-4 text-(--text-muted) text-xs">{t("common.loading")}</div>
              ) : branchDiffState.error ? (
                <div className="git-history-error">{branchDiffState.error}</div>
              ) : branchDiffState.mode === "worktree" ? (
                branchDiffState.files.length === 0 ? (
                  <div className="git-history-empty p-4 text-(--text-muted) text-xs">{t("git.historyBranchWorktreeDiffEmpty")}</div>
                ) : (
                  <div className="git-history-branch-worktree-diff-layout flex-1 min-h-105 h-[min(78vh,860px)] max-h-[calc(100vh-120px)] grid [grid-template-columns:minmax(0,1fr)_minmax(320px,34%)] border-t border-t-[color-mix(in_srgb,var(--border-default)_44%,transparent)] overflow-hidden">
                    <div className="git-history-branch-worktree-diff-detail order-1 h-full min-w-0 min-h-0 flex flex-col overflow-hidden bg-[color-mix(in_srgb,var(--surface-popover,#0d0f14)_94%,transparent)] [&_.git-history-diff-modal-viewer]:flex-1 [&_.git-history-diff-modal-viewer]:min-h-0 [&_.git-history-diff-modal-viewer]:max-h-none">
                      {!branchDiffState.selectedPath ? (
                        <div className="git-history-empty p-4 text-(--text-muted) text-xs">
                          {t("git.historyBranchWorktreeDiffSelectFile")}
                        </div>
                      ) : branchDiffState.selectedDiffLoading ? (
                        <div className="git-history-empty p-4 text-(--text-muted) text-xs">{t("common.loading")}</div>
                      ) : branchDiffState.selectedDiffError ? (
                        <div className="git-history-error">{branchDiffState.selectedDiffError}</div>
                      ) : branchDiffState.selectedDiff ? (
                        <div className="git-history-diff-modal-viewer flex flex-col min-h-[280px] h-[calc(100vh-180px)] max-h-[calc(100vh-180px)] min-w-0 overflow-hidden [&>.diff-viewer-frame]:flex-1 [&>.diff-viewer-frame]:min-h-0 [&>.diff-viewer-frame]:min-w-0">
                          <GitDiffViewer
                            workspaceId={workspaceId}
                            diffs={[branchDiffState.selectedDiff]}
                            selectedPath={branchDiffState.selectedDiff.path}
                            isLoading={false}
                            error={null}
                            listView="flat"
                            stickyHeaderMode="controls-only"
                            embeddedAnchorVariant="modal-pager"
                            showContentModeControls
                            diffStyle={diffViewMode}
                            onDiffStyleChange={setDiffViewMode}
                            onCreateCodeAnnotation={onCreateCodeAnnotation}
                            onRemoveCodeAnnotation={onRemoveCodeAnnotation}
                            codeAnnotations={codeAnnotations}
                            codeAnnotationSurface="modal-diff-view"
                          />
                        </div>
                      ) : (
                        <div className="git-history-empty p-4 text-(--text-muted) text-xs">{t("git.diffUnavailable")}</div>
                      )}
                    </div>
                    <div className="git-history-branch-worktree-diff-files order-2 h-full min-h-0 min-w-0 flex flex-col border-l border-l-[color-mix(in_srgb,var(--git-history-branch-diff-accent)_18%,var(--border-default))] bg-[color-mix(in_srgb,var(--surface-control,#1a2230)_42%,transparent)]">
                      <div className="git-history-branch-worktree-diff-files-title pt-2.5 px-3 pb-2 text-[11px] font-semibold text-(--text-secondary) border-b border-b-[color-mix(in_srgb,var(--border-default)_38%,transparent)]">
                        {t("git.historyBranchWorktreeDiffFilesTitle")}
                      </div>
                      <div className="git-history-branch-worktree-diff-files-list flex-1 min-h-0 overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable_both-edges] p-1 [scrollbar-width:thin] [scrollbar-color:transparent_transparent] hover:[scrollbar-color:color-mix(in_srgb,var(--git-history-branch-diff-accent)_36%,transparent)_transparent] hover:[--sb-thumb-color:color-mix(in_srgb,var(--text-muted)_56%,transparent)] [&::-webkit-scrollbar]:w-[9px] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:border-2 [&::-webkit-scrollbar-thumb]:border-transparent [&::-webkit-scrollbar-thumb]:[background-clip:content-box] [&::-webkit-scrollbar-thumb]:bg-(--sb-thumb-color) hover:[&::-webkit-scrollbar-thumb:hover]:bg-[color-mix(in_srgb,var(--git-history-branch-diff-accent)_54%,transparent)]">
                        {branchDiffState.files.map((entry) => (
                          <button
                            key={entry.path}
                            type="button"
                            className={`git-history-branch-worktree-diff-file w-full border-none bg-transparent text-(--text-primary) inline-flex items-center gap-2 text-left rounded-lg py-[7px] px-2 cursor-pointer hover:bg-[color-mix(in_srgb,var(--surface-control-hover,#263044)_72%,transparent)] [&_.git-history-file-status]:!w-[21px] [&_.git-history-file-status]:!h-[21px] [&_.git-history-file-status]:text-[10.5px] [&_.git-history-file-status]:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--border-default)_58%,transparent)] [&_.git-status-a]:!text-[#15803d] [&_.git-status-a]:!bg-[color-mix(in_srgb,#22c55e_24%,transparent)] [&_.git-status-m]:!text-[#1d4ed8] [&_.git-status-m]:!bg-[color-mix(in_srgb,#2563eb_24%,transparent)] [&_.git-status-d]:!text-[#b91c1c] [&_.git-status-d]:!bg-[color-mix(in_srgb,#ef4444_26%,transparent)]${
                              branchDiffState.selectedPath === entry.path ? " is-active bg-[color-mix(in_srgb,var(--git-history-branch-diff-accent)_18%,transparent)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--git-history-branch-diff-accent)_24%,transparent)]" : ""
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
                              className={`git-history-file-status git-status-${entry.status.toLowerCase()} inline-flex items-center justify-center w-[19px] h-[19px] rounded-full text-[10px] font-bold bg-[color-mix(in_srgb,var(--surface-control,#1a2230)_85%,transparent)]`}
                            >
                              {entry.status}
                            </span>
                            <span className="git-history-branch-worktree-diff-file-path min-w-0 text-xs overflow-hidden text-ellipsis whitespace-nowrap">
                              {entry.path}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )
              ) : (
                <div className="git-history-branch-compare-layout flex-auto min-h-[420px] h-[min(78vh,860px)] max-h-[calc(100vh-120px)] grid grid-cols-[minmax(320px,42%)_minmax(0,1fr)] border-t border-t-[color-mix(in_srgb,var(--border-default)_44%,transparent)] overflow-hidden">
                  <div className="git-history-branch-compare-lists min-h-0 grid grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-2.5 p-2.5 border-r border-r-[color-mix(in_srgb,#f59e0b_14%,var(--border-default))] bg-[color-mix(in_srgb,var(--surface-control,#1a2230)_34%,transparent)]">
                    <section className="git-history-branch-compare-list-card is-target">
                      <header className="git-history-branch-compare-list-header is-target">
                        <span className="git-history-branch-compare-list-title-wrap min-w-0 inline-flex items-center gap-2">
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
                        <div className="git-history-empty p-4 text-(--text-muted) text-xs">
                          {t("git.historyBranchCompareDirectionEmpty")}
                        </div>
                      ) : (
                        <div className="git-history-branch-compare-list flex-auto min-h-0 overflow-auto p-1.5 flex flex-col gap-1">
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
                        <div className="git-history-empty p-4 text-(--text-muted) text-xs">
                          {t("git.historyBranchCompareDirectionEmpty")}
                        </div>
                      ) : (
                        <div className="git-history-branch-compare-list flex-auto min-h-0 overflow-auto p-1.5 flex flex-col gap-1">
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

                  <div className="git-history-branch-compare-detail min-h-0 flex flex-col bg-[color-mix(in_srgb,var(--surface-popover,#0d0f14)_92%,transparent)]">
                    {!branchDiffState.selectedCommitSha ? (
                      <div className="git-history-empty p-4 text-(--text-muted) text-xs">
                        {t("git.historyBranchCompareSelectCommit")}
                      </div>
                    ) : branchDiffState.selectedCommitLoading ? (
                      <div className="git-history-empty p-4 text-(--text-muted) text-xs">{t("common.loading")}</div>
                    ) : branchDiffState.selectedCommitError ? (
                      <div className="git-history-error">{branchDiffState.selectedCommitError}</div>
                    ) : branchDiffState.selectedCommitDetails ? (
                      <div className="git-history-branch-compare-detail-body flex-auto min-h-0 overflow-auto p-3 flex flex-col gap-2.5">
                        <div className="git-history-branch-compare-detail-summary text-[13px] font-bold text-(--text-stronger)">
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
                          <div className="git-history-empty p-4 text-(--text-muted) text-xs">{t("git.historyNoFileChangesInCommit")}</div>
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
                      <div className="git-history-empty p-4 text-(--text-muted) text-xs">{t("git.diffUnavailable")}</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : null}
        {comparePreviewDetailFile ? (
          <div
            className="git-history-diff-modal-overlay fixed inset-0 z-50 bg-[rgba(7,11,18,0.42)] flex items-center justify-center p-6 animate-[git-history-modal-fade-in_130ms_ease]"
            role="presentation"
            onClick={() => setComparePreviewFileKey(null)}
          >
            <div
              className={`git-history-diff-modal w-[min(1080px,calc(100vw-48px))] max-h-[calc(100vh-64px)] rounded-xl border border-[color-mix(in_srgb,var(--border-strong,var(--border-default))_82%,transparent)] bg-(--surface-popover,var(--surface-messages,#0d0f14)) text-(--text-primary) shadow-[0_22px_64px_rgba(0,0,0,0.4)] overflow-hidden flex flex-col animate-[git-history-modal-pop-in_160ms_ease]${isHistoryDiffModalMaximized ? " is-maximized w-[calc(100vw-16px)] max-h-[calc(100vh-16px)] rounded-lg" : ""}`}
              role="dialog"
              aria-modal="true"
              aria-label={comparePreviewDetailFile.path}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="git-history-diff-modal-header min-h-9 flex items-center justify-between gap-3 py-1.5 px-2.5 border-b border-b-[color-mix(in_srgb,var(--border-default)_48%,transparent)]">
                <div className="git-history-diff-modal-title min-w-0 flex-1 inline-flex items-center gap-2 text-xs text-(--text-muted)">
                  <span
                    className={`git-history-file-status git-status-${comparePreviewDetailFile.status.toLowerCase()} inline-flex items-center justify-center w-[19px] h-[19px] rounded-full text-[10px] font-bold bg-[color-mix(in_srgb,var(--surface-control,#1a2230)_85%,transparent)]`}
                  >
                    {comparePreviewDetailFile.status}
                  </span>
                  <span className="git-history-diff-modal-path min-w-0 flex-1 whitespace-nowrap overflow-hidden text-ellipsis text-(--text-strong)">{comparePreviewDetailFile.path}</span>
                  <span className="git-history-diff-modal-stats text-[11px] whitespace-nowrap inline-flex items-center gap-0.75">
                    +{comparePreviewDetailFile.additions} / -{comparePreviewDetailFile.deletions}
                  </span>
                </div>
                <div className="git-history-diff-modal-actions inline-flex flex-none items-center gap-2.5 whitespace-nowrap">
                  <button
                    type="button"
                    className="git-history-diff-modal-close w-[26px] h-[26px] border border-[color-mix(in_srgb,var(--border-default)_72%,transparent)] rounded-lg bg-[color-mix(in_srgb,var(--surface-control,#1a2230)_72%,transparent)] text-(--text-emphasis,#111827) inline-flex items-center justify-center cursor-pointer leading-none hover:text-(--text-strong,#0f172a) hover:border-[color-mix(in_srgb,var(--border-default)_92%,transparent)] [&>svg]:w-3.5 [&>svg]:h-3.5 [&>svg]:block [&>svg]:flex-none [&>svg]:stroke-current [&>svg]:[stroke-width:2.2]"
                    onClick={() => setIsHistoryDiffModalMaximized((value) => !value)}
                    aria-label={isHistoryDiffModalMaximized ? t("common.restore") : t("menu.maximize")}
                    title={isHistoryDiffModalMaximized ? t("common.restore") : t("menu.maximize")}
                  >
                    <span className="git-history-diff-modal-close-glyph inline-flex items-center justify-center w-3.5 h-3.5 text-base font-bold leading-none" aria-hidden>
                      {isHistoryDiffModalMaximized ? "❐" : "□"}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="git-history-diff-modal-close w-[26px] h-[26px] border border-[color-mix(in_srgb,var(--border-default)_72%,transparent)] rounded-lg bg-[color-mix(in_srgb,var(--surface-control,#1a2230)_72%,transparent)] text-(--text-emphasis,#111827) inline-flex items-center justify-center cursor-pointer leading-none hover:text-(--text-strong,#0f172a) hover:border-[color-mix(in_srgb,var(--border-default)_92%,transparent)] [&>svg]:w-3.5 [&>svg]:h-3.5 [&>svg]:block [&>svg]:flex-none [&>svg]:stroke-current [&>svg]:[stroke-width:2.2]"
                    onClick={() => setComparePreviewFileKey(null)}
                    aria-label={t("common.close")}
                    title={t("common.close")}
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>

              {comparePreviewDetailFile.truncated && !comparePreviewDetailFile.isBinary && (
                <div className="git-history-warning m-2 py-2 px-2.5 rounded-lg bg-[color-mix(in_srgb,#f59e0b_18%,transparent)] text-(--text-secondary) text-xs">
                  {t("git.historyDiffTooLargeTruncated", {
                    lineCount: comparePreviewDetailFile.lineCount,
                  })}
                </div>
              )}
              {comparePreviewDetailFile.isBinary ? (
                <pre className="git-history-diff-modal-code m-0 p-3 overflow-auto text-xs leading-[1.45] text-(--text-primary) bg-[color-mix(in_srgb,var(--surface-control,#1a2230)_56%,transparent)] whitespace-pre font-(family-name:--code-font-family,ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation_Mono','Courier_New',monospace)">{comparePreviewDetailFileDiff}</pre>
              ) : (
                <div className="git-history-diff-modal-viewer flex flex-col min-h-[280px] h-[calc(100vh-180px)] max-h-[calc(100vh-180px)] min-w-0 overflow-hidden [.is-maximized_&]:h-[calc(100vh-128px)] [.is-maximized_&]:max-h-[calc(100vh-128px)] [&>.diff-viewer-frame]:flex-1 [&>.diff-viewer-frame]:min-h-0 [&>.diff-viewer-frame]:min-w-0">
                  <GitDiffViewer
                    workspaceId={workspaceId}
                    diffs={comparePreviewDiffEntries}
                    selectedPath={comparePreviewDetailFile.path}
                    isLoading={false}
                    error={null}
                    listView="flat"
                    stickyHeaderMode="controls-only"
                    embeddedAnchorVariant="modal-pager"
                    showContentModeControls
                    diffStyle={diffViewMode}
                    onDiffStyleChange={setDiffViewMode}
                    onCreateCodeAnnotation={onCreateCodeAnnotation}
                    onRemoveCodeAnnotation={onRemoveCodeAnnotation}
                    codeAnnotations={codeAnnotations}
                    codeAnnotationSurface="modal-diff-view"
                  />
                </div>
              )}
            </div>
          </div>
        ) : null}
        {branchContextMenu ? (
          <div className="git-history-branch-context-backdrop fixed inset-0 z-[1200] pointer-events-none">
            <div
              ref={branchContextMenuRef}
              className="git-history-branch-context-menu fixed pointer-events-auto w-max min-w-[min(276px,calc(100vw-16px))] max-w-[min(520px,calc(100vw-16px))] max-h-[min(560px,calc(100vh-16px))] overflow-auto rounded-[14px] border border-[color-mix(in_srgb,var(--border-default)_82%,transparent)] bg-[color-mix(in_srgb,var(--surface-card,#121926)_92%,#0b111c)] backdrop-blur-[14px] shadow-[0_24px_46px_color-mix(in_srgb,#000_45%,transparent),0_1px_0_color-mix(in_srgb,#fff_10%,transparent)_inset] p-2"
              role="menu"
              style={branchContextMenuStyle}
              onKeyDown={handleBranchContextMenuKeyDown}
            >
              {branchContextTrackingSummary ? (
                <div className="git-history-branch-context-tracking my-0.5 mx-0.5 mb-2 py-2 px-2.5 rounded-[10px] border border-[color-mix(in_srgb,var(--border-default)_64%,transparent)] bg-[color-mix(in_srgb,var(--surface-control,#1a2230)_72%,transparent)]" aria-label={t("git.upstream")}>
                  <span className="git-history-branch-context-tracking-text block min-w-0 text-xs font-semibold leading-[1.35] text-[color-mix(in_srgb,var(--text-muted)_86%,var(--text-secondary))] whitespace-normal [overflow-wrap:anywhere]">
                    {branchContextTrackingSummary}
                  </span>
                </div>
              ) : null}
              {branchContextActions.map((action) => (
                <div
                  key={action.id}
                  className={`git-history-branch-context-item-wrap${action.dividerBefore ? " with-divider mt-1.5 pt-2 relative before:content-[''] before:absolute before:left-2.5 before:right-2.5 before:top-0 before:h-px before:bg-[linear-gradient(90deg,color-mix(in_srgb,var(--border-default)_38%,transparent),color-mix(in_srgb,var(--border-default)_78%,transparent)_30%,color-mix(in_srgb,var(--border-default)_78%,transparent)_70%,color-mix(in_srgb,var(--border-default)_38%,transparent))]" : ""}`}
                >
                  <button
                    type="button"
                    className={`git-history-branch-context-item w-full border-none bg-transparent text-(--text-primary) text-[13px] leading-[1.3] text-left rounded-[10px] py-[9px] px-2.5 cursor-pointer transition-[background-color,color] duration-140 ease hover:[&:not(:disabled)]:bg-[color-mix(in_srgb,var(--surface-control-hover,#263044)_86%,transparent)] hover:[&:not(:disabled)_.git-history-branch-context-item-icon]:text-[color-mix(in_srgb,var(--accent-primary,#2563eb)_84%,var(--text-strong))] focus-visible:outline focus-visible:outline-[color-mix(in_srgb,var(--accent-primary,#2563eb)_74%,transparent)] focus-visible:[outline-offset:-1px] disabled:text-(--text-muted) disabled:opacity-54 disabled:cursor-not-allowed${action.disabled ? " is-disabled" : ""}${
                      action.tone === "danger" ? " is-danger [&:not(:disabled)]:text-[color-mix(in_srgb,#ef4444_86%,var(--text-primary))] [&:not(:disabled)_.git-history-branch-context-item-icon]:text-[color-mix(in_srgb,#ef4444_72%,var(--text-muted))]" : ""
                    }`}
                    role="menuitem"
                    disabled={action.disabled}
                    title={action.disabledReason ?? undefined}
                    onClick={() => {
                      action.onSelect();
                    }}
                  >
                    <span className="git-history-branch-context-item-main grid [grid-template-columns:16px_minmax(0,1fr)] items-center gap-[9px]">
                      <span className="git-history-branch-context-item-icon inline-flex items-center justify-center text-[color-mix(in_srgb,var(--text-muted)_84%,transparent)]">{action.icon}</span>
                      <span className="git-history-branch-context-item-label min-w-0 whitespace-normal [overflow-wrap:anywhere]">{action.label}</span>
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
                className="git-history-create-branch-backdrop git-history-create-pr-backdrop fixed z-[68] bg-[#0b1220] inset-0 flex items-center justify-center p-4"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) {
                    closeCreatePrDialog();
                  }
                }}
              >
                <section
                  className={`git-history-create-pr-dialog w-[min(1360px,98vw)] max-h-[min(90vh,920px)] rounded-[14px] border border-[color-mix(in_srgb,var(--border-default)_88%,transparent)] bg-(--surface-sidebar-opaque,#ffffff) shadow-[0_18px_46px_color-mix(in_srgb,#0f172a_26%,transparent),0_1px_0_color-mix(in_srgb,#ffffff_36%,transparent)_inset] p-3.5 flex flex-col gap-2.5 overflow-auto ${isCreatePrDialogMaximized ? "is-maximized w-[calc(100vw-32px)] max-h-[calc(100vh-32px)] rounded-[10px]" : ""}`}
                  role="dialog"
                  aria-modal="true"
                  aria-label={t("git.historyCreatePrDialogTitle")}
                >
              <div className="git-history-create-pr-header flex items-start justify-between gap-2.5">
                <div className="git-history-create-pr-title-wrap inline-flex items-start gap-2.5 min-w-0">
                  <span className="git-history-create-pr-title-icon w-[34px] h-[34px] rounded-[10px] border border-[color-mix(in_srgb,var(--accent-primary,#2563eb)_36%,transparent)] bg-[color-mix(in_srgb,var(--accent-primary,#2563eb)_12%,transparent)] text-[color-mix(in_srgb,var(--accent-primary,#2563eb)_84%,#dbeafe)] inline-flex items-center justify-center flex-none">
                    <GitPullRequestCreate size={16} />
                  </span>
                  <div className="git-history-create-pr-title-copy min-w-0 flex flex-col gap-0.75 [&_strong]:text-[15px] [&_strong]:text-(--text-stronger) [&_p]:m-0 [&_p]:text-xs [&_p]:text-(--text-secondary) [&_p]:leading-[1.45]">
                    <strong>{t("git.historyCreatePrDialogTitle")}</strong>
                    <p>{t("git.historyCreatePrDialogSubtitle")}</p>
                  </div>
                </div>
                <div className="git-history-create-pr-header-actions inline-flex items-center gap-2">
                  <button
                    type="button"
                    className="git-history-force-delete-close inline-flex items-center justify-center w-[26px] h-[26px] rounded-full border border-(--border-default)/72 bg-[color-mix(in_srgb,var(--surface-control,#1a2230)_66%,transparent)] text-(--text-secondary) cursor-pointer hover:[&:not(:disabled)]:text-(--text-primary) hover:[&:not(:disabled)]:border-[color-mix(in_srgb,var(--accent-primary,#2563eb)_56%,transparent)] disabled:opacity-100 disabled:text-[color-mix(in_srgb,var(--text-secondary)_78%,var(--text-muted))] [&_svg]:block [&_svg]:w-3.5 [&_svg]:h-3.5 [&_svg]:stroke-current [&_svg]:[stroke-width:2.35]"
                    onClick={() => setIsCreatePrDialogMaximized((value) => !value)}
                    aria-label={isCreatePrDialogMaximized ? t("common.restore") : t("menu.maximize")}
                    title={isCreatePrDialogMaximized ? t("common.restore") : t("menu.maximize")}
                  >
                    <span className="git-history-force-delete-close-glyph inline-flex items-center justify-center w-3.5 h-3.5 text-lg font-bold leading-none text-current" aria-hidden>
                      {isCreatePrDialogMaximized ? "❐" : "□"}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="git-history-force-delete-close inline-flex items-center justify-center w-[26px] h-[26px] rounded-full border border-(--border-default)/72 bg-[color-mix(in_srgb,var(--surface-control,#1a2230)_66%,transparent)] text-(--text-secondary) cursor-pointer hover:[&:not(:disabled)]:text-(--text-primary) hover:[&:not(:disabled)]:border-[color-mix(in_srgb,var(--accent-primary,#2563eb)_56%,transparent)] disabled:opacity-100 disabled:text-[color-mix(in_srgb,var(--text-secondary)_78%,var(--text-muted))] [&_svg]:block [&_svg]:w-3.5 [&_svg]:h-3.5 [&_svg]:stroke-current [&_svg]:[stroke-width:2.35]"
                    onClick={closeCreatePrDialog}
                    aria-label={t("common.close")}
                    title={t("common.close")}
                    disabled={createPrSubmitting}
                  >
                    <span className="git-history-force-delete-close-glyph inline-flex items-center justify-center w-3.5 h-3.5 text-lg font-bold leading-none text-current" aria-hidden>
                      ×
                    </span>
                  </button>
                </div>
              </div>

              {createPrDefaultsLoading ? (
                <div className="git-history-create-pr-inline-hint text-xs text-(--text-secondary) border border-(--border-default)/66 bg-[color-mix(in_srgb,var(--surface-control,#f8fafc)_70%,transparent)] rounded-[10px] py-2 px-2.5">
                  {t("git.historyCreatePrLoadingDefaults")}
                </div>
              ) : null}
              {createPrDefaultsError ? (
                <div className="git-history-create-pr-warning rounded-[10px] border border-[color-mix(in_srgb,#ef4444_36%,transparent)] bg-[color-mix(in_srgb,#ef4444_14%,transparent)] text-[color-mix(in_srgb,#991b1b_72%,var(--text-primary))] inline-flex items-start gap-2 py-2 px-2.5 text-xs leading-[1.45]">
                  <CircleAlert size={14} />
                  <span>
                    {t("git.historyCreatePrLoadDefaultsFailed")}{" "}
                    {localizeKnownGitError(createPrDefaultsError) ?? createPrDefaultsError}
                  </span>
                </div>
              ) : null}

              <section className="git-history-create-pr-compare-card rounded-xl border border-(--border-default)/70 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--surface-control,#f8fafc)_88%,transparent)_0%,color-mix(in_srgb,var(--surface-control,#f8fafc)_72%,transparent)_100%)] py-2.5 px-3">
                <div className="git-history-create-pr-compare-bar grid grid-cols-[auto_minmax(0,1.45fr)_minmax(0,1.05fr)_auto_minmax(0,1.45fr)_minmax(0,1.05fr)] gap-2.5 items-center">
                  <span className="git-history-create-pr-compare-icon w-[38px] h-10 rounded-[11px] border border-[color-mix(in_srgb,var(--accent-primary,#2563eb)_34%,transparent)] bg-[color-mix(in_srgb,var(--accent-primary,#2563eb)_10%,transparent)] text-[color-mix(in_srgb,var(--accent-primary,#2563eb)_84%,var(--text-primary))] inline-flex items-center justify-center" aria-hidden>
                    <GitPullRequestCreate size={14} />
                  </span>
                  <label className="git-history-create-pr-compare-field flex flex-col-reverse items-stretch justify-center gap-1 min-w-0 min-h-[52px] rounded-xl border border-(--border-default)/68 bg-[color-mix(in_srgb,var(--surface-card-muted,#ffffff)_92%,transparent)] py-[7px] px-2.5 relative transition-[border-color,box-shadow,background-color] duration-140 ease focus-within:border-[color-mix(in_srgb,var(--accent-primary,#2563eb)_52%,transparent)] focus-within:shadow-[0_0_0_2px_color-mix(in_srgb,var(--accent-primary,#2563eb)_17%,transparent),0_8px_20px_color-mix(in_srgb,#0f172a_8%,transparent)] [&>span]:w-fit [&>span]:max-w-full [&>span]:inline-flex [&>span]:items-center [&>span]:gap-[5px] [&>span]:py-px [&>span]:px-1.5 [&>span]:rounded-full [&>span]:border [&>span]:border-(--border-default)/72 [&>span]:bg-[color-mix(in_srgb,var(--surface-control,#f8fafc)_65%,transparent)] [&>span]:text-[10px] [&>span]:font-[620] [&>span]:text-[color-mix(in_srgb,var(--text-secondary)_90%,var(--text-primary))] [&>span]:whitespace-nowrap [&>span]:tracking-[0.004em] [&>span]:leading-[1.25] [&>span]:overflow-hidden [&>span]:text-ellipsis">
                    <span>
                      <HardDrive size={11} className="git-history-create-pr-field-chip-icon flex-none text-[color-mix(in_srgb,var(--text-secondary)_84%,var(--accent-primary,#2563eb))]" />
                      <span className="git-history-create-pr-field-chip-text min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
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
                  <label className="git-history-create-pr-compare-field flex flex-col-reverse items-stretch justify-center gap-1 min-w-0 min-h-[52px] rounded-xl border border-(--border-default)/68 bg-[color-mix(in_srgb,var(--surface-card-muted,#ffffff)_92%,transparent)] py-[7px] px-2.5 relative transition-[border-color,box-shadow,background-color] duration-140 ease focus-within:border-[color-mix(in_srgb,var(--accent-primary,#2563eb)_52%,transparent)] focus-within:shadow-[0_0_0_2px_color-mix(in_srgb,var(--accent-primary,#2563eb)_17%,transparent),0_8px_20px_color-mix(in_srgb,#0f172a_8%,transparent)] [&>span]:w-fit [&>span]:max-w-full [&>span]:inline-flex [&>span]:items-center [&>span]:gap-[5px] [&>span]:py-px [&>span]:px-1.5 [&>span]:rounded-full [&>span]:border [&>span]:border-(--border-default)/72 [&>span]:bg-[color-mix(in_srgb,var(--surface-control,#f8fafc)_65%,transparent)] [&>span]:text-[10px] [&>span]:font-[620] [&>span]:text-[color-mix(in_srgb,var(--text-secondary)_90%,var(--text-primary))] [&>span]:whitespace-nowrap [&>span]:tracking-[0.004em] [&>span]:leading-[1.25] [&>span]:overflow-hidden [&>span]:text-ellipsis">
                    <span>
                      <GitBranch size={11} className="git-history-create-pr-field-chip-icon flex-none text-[color-mix(in_srgb,var(--text-secondary)_84%,var(--accent-primary,#2563eb))]" />
                      <span className="git-history-create-pr-field-chip-text min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
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
                  <span className="git-history-create-pr-compare-separator w-[38px] h-10 rounded-[11px] border border-(--border-default)/68 bg-[color-mix(in_srgb,var(--surface-card-muted,#ffffff)_90%,transparent)] text-(--text-secondary) inline-flex items-center justify-center" aria-hidden>
                    <ChevronLeft size={14} />
                  </span>
                  <label className="git-history-create-pr-compare-field flex flex-col-reverse items-stretch justify-center gap-1 min-w-0 min-h-[52px] rounded-xl border border-(--border-default)/68 bg-[color-mix(in_srgb,var(--surface-card-muted,#ffffff)_92%,transparent)] py-[7px] px-2.5 relative transition-[border-color,box-shadow,background-color] duration-140 ease focus-within:border-[color-mix(in_srgb,var(--accent-primary,#2563eb)_52%,transparent)] focus-within:shadow-[0_0_0_2px_color-mix(in_srgb,var(--accent-primary,#2563eb)_17%,transparent),0_8px_20px_color-mix(in_srgb,#0f172a_8%,transparent)] [&>span]:w-fit [&>span]:max-w-full [&>span]:inline-flex [&>span]:items-center [&>span]:gap-[5px] [&>span]:py-px [&>span]:px-1.5 [&>span]:rounded-full [&>span]:border [&>span]:border-(--border-default)/72 [&>span]:bg-[color-mix(in_srgb,var(--surface-control,#f8fafc)_65%,transparent)] [&>span]:text-[10px] [&>span]:font-[620] [&>span]:text-[color-mix(in_srgb,var(--text-secondary)_90%,var(--text-primary))] [&>span]:whitespace-nowrap [&>span]:tracking-[0.004em] [&>span]:leading-[1.25] [&>span]:overflow-hidden [&>span]:text-ellipsis">
                    <span>
                      <HardDrive size={11} className="git-history-create-pr-field-chip-icon flex-none text-[color-mix(in_srgb,var(--text-secondary)_84%,var(--accent-primary,#2563eb))]" />
                      <span className="git-history-create-pr-field-chip-text min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
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
                  <label className="git-history-create-pr-compare-field flex flex-col-reverse items-stretch justify-center gap-1 min-w-0 min-h-[52px] rounded-xl border border-(--border-default)/68 bg-[color-mix(in_srgb,var(--surface-card-muted,#ffffff)_92%,transparent)] py-[7px] px-2.5 relative transition-[border-color,box-shadow,background-color] duration-140 ease focus-within:border-[color-mix(in_srgb,var(--accent-primary,#2563eb)_52%,transparent)] focus-within:shadow-[0_0_0_2px_color-mix(in_srgb,var(--accent-primary,#2563eb)_17%,transparent),0_8px_20px_color-mix(in_srgb,#0f172a_8%,transparent)] [&>span]:w-fit [&>span]:max-w-full [&>span]:inline-flex [&>span]:items-center [&>span]:gap-[5px] [&>span]:py-px [&>span]:px-1.5 [&>span]:rounded-full [&>span]:border [&>span]:border-(--border-default)/72 [&>span]:bg-[color-mix(in_srgb,var(--surface-control,#f8fafc)_65%,transparent)] [&>span]:text-[10px] [&>span]:font-[620] [&>span]:text-[color-mix(in_srgb,var(--text-secondary)_90%,var(--text-primary))] [&>span]:whitespace-nowrap [&>span]:tracking-[0.004em] [&>span]:leading-[1.25] [&>span]:overflow-hidden [&>span]:text-ellipsis">
                    <span>
                      <GitPullRequestCreate size={11} className="git-history-create-pr-field-chip-icon flex-none text-[color-mix(in_srgb,var(--text-secondary)_84%,var(--accent-primary,#2563eb))]" />
                      <span className="git-history-create-pr-field-chip-text min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
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
                className={`git-history-create-pr-preview-card rounded-[10px] border bg-[color-mix(in_srgb,var(--surface-control,#f8fafc)_78%,transparent)] py-2 px-2.5 flex flex-col gap-2 transition-[border-color,box-shadow] duration-140 ease ${createPrPreviewExpanded ? "is-expanded border-[color-mix(in_srgb,var(--accent-primary,#2563eb)_44%,transparent)] shadow-[0_8px_20px_color-mix(in_srgb,var(--accent-primary,#2563eb)_14%,transparent)] [&_.git-history-create-pr-preview-caret]:rotate-180 [&_.git-history-create-pr-preview-caret]:text-(--text-secondary) [&_.git-history-create-pr-preview-caret]:border-[color-mix(in_srgb,var(--accent-primary,#2563eb)_44%,transparent)] [&_.git-history-create-pr-preview-collapsible]:max-h-[1300px] [&_.git-history-create-pr-preview-collapsible]:opacity-100 [&_.git-history-create-pr-preview-collapsible]:overflow-visible [&_.git-history-create-pr-preview-collapsible]:pointer-events-auto [&_.git-history-create-pr-preview-collapsible]:translate-y-0" : "border-(--border-default)/72"}`}
              >
                <div className="git-history-create-pr-preview-head flex items-center justify-between gap-2.5">
                  <div className="git-history-create-pr-preview-title-wrap min-w-0 flex flex-col gap-0.5">
                    <span className="git-history-create-pr-preview-title text-xs text-(--text-secondary) font-semibold">
                      {t("git.historyCreatePrPreviewTitle")}
                    </span>
                    <span className="git-history-create-pr-preview-range text-[11px] text-(--text-muted) overflow-hidden text-ellipsis whitespace-nowrap">
                      {t("git.historyCreatePrPreviewRange", {
                        base: createPrPreviewBaseRef || "upstream/HEAD",
                        head: createPrPreviewHeadRef || "HEAD",
                      })}
                    </span>
                  </div>
                  <div className="git-history-create-pr-preview-actions inline-flex items-center gap-1.5">
                    <button
                      type="button"
                      className="git-history-create-pr-preview-caret w-5 h-5 p-0 rounded-md border border-(--border-default)/64 bg-[color-mix(in_srgb,var(--surface-card-muted,#ffffff)_86%,transparent)] text-(--text-muted) inline-flex items-center justify-center cursor-pointer transition-[transform,color,border-color] duration-220 ease hover:text-(--text-secondary) hover:border-[color-mix(in_srgb,var(--accent-primary,#2563eb)_44%,transparent)]"
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
                      className="git-history-create-pr-mini-btn border border-(--border-default)/68 rounded-full bg-[color-mix(in_srgb,var(--surface-control,#f8fafc)_86%,transparent)] text-(--text-secondary) min-h-7 py-0 px-2.5 inline-flex items-center gap-1.5 text-xs cursor-pointer hover:border-[color-mix(in_srgb,var(--accent-primary,#2563eb)_54%,transparent)] hover:text-(--text-primary)"
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
                <div className="git-history-create-pr-preview-collapsible flex flex-col gap-2 max-h-0 opacity-0 overflow-hidden pointer-events-none -translate-y-[3px] transition-[max-height,opacity,transform] duration-260 ease">
                  <div className="git-history-create-pr-preview-summary inline-flex items-center gap-2 flex-wrap [&>span]:text-[11px] [&>span]:text-(--text-secondary) [&>span]:py-0.5 [&>span]:px-[7px] [&>span]:rounded-full [&>span]:border [&>span]:border-(--border-default)/68 [&>span]:bg-[color-mix(in_srgb,var(--surface-card-muted,#ffffff)_88%,transparent)]">
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
                            <pre className="git-history-create-pr-preview-message m-0 py-2 px-[9px] rounded-lg border border-(--border-default)/58 bg-[color-mix(in_srgb,var(--surface-card-muted,#ffffff)_90%,transparent)] text-(--text-secondary) text-xs leading-[1.45] whitespace-pre-wrap overflow-auto max-h-[120px]">
                              {extractCommitBody(createPrPreviewDetails.summary, createPrPreviewDetails.message)}
                            </pre>
                          ) : null}
                          <div className="git-history-push-preview-file-head git-filetree-section-header">
                            <FolderTree size={12} />
                            <span>{t("git.historyPushDialogPreviewFiles")}</span>
                            <i>{createPrPreviewDetails.files.length}</i>
                          </div>
                          <div className="git-history-create-pr-preview-file-list rounded-lg border border-(--border-default)/58 bg-[color-mix(in_srgb,var(--surface-card-muted,#ffffff)_90%,transparent)] max-h-[240px] overflow-auto">
                            {createPrPreviewDetails.files.length > 0 ? (
                              createPrPreviewDetails.files.map((file) => {
                                const fileKey = buildFileKey(file);
                                return (
                                  <div
                                    key={`create-pr-preview-file-${fileKey}`}
                                    className="git-history-create-pr-preview-file-item py-2 px-2.5 text-xs leading-[1.35] text-(--text-primary) border-b border-(--border-default)/44 [overflow-wrap:anywhere] last:border-b-0"
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
                    <div className="git-history-create-pr-preview-hint text-[11px] text-(--text-muted)">
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
                  className="git-history-create-pr-textarea min-h-[98px] resize-y rounded-[10px] border border-(--border-default)/66 bg-[color-mix(in_srgb,var(--surface-control,#f8fafc)_82%,transparent)] text-(--text-primary) py-2 px-2.5 text-xs leading-[1.45]"
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
                    className="git-history-create-pr-textarea is-compact min-h-[64px] resize-y rounded-[10px] border border-(--border-default)/66 bg-[color-mix(in_srgb,var(--surface-control,#f8fafc)_82%,transparent)] text-(--text-primary) py-2 px-2.5 text-xs leading-[1.45]"
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

              <div className="git-history-create-pr-stage-card rounded-[10px] border border-(--border-default)/72 bg-[color-mix(in_srgb,var(--surface-control,#f8fafc)_78%,transparent)] py-2 px-2.5 flex flex-col gap-2">
                <div className="git-history-create-pr-stage-title text-xs text-(--text-secondary) font-semibold">{t("git.historyCreatePrStageProgress")}</div>
                <div className="git-history-create-pr-stage-list grid grid-cols-4 gap-1.5">
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
                    const stageBorder =
                      stage.status === "success"
                        ? "border-[color-mix(in_srgb,#22c55e_34%,transparent)]"
                        : stage.status === "failed"
                          ? "border-[color-mix(in_srgb,#ef4444_36%,transparent)]"
                          : stage.status === "running"
                            ? "border-[color-mix(in_srgb,var(--accent-primary,#2563eb)_42%,transparent)]"
                            : "border-(--border-default)/62";
                    const stageIconColor =
                      stage.status === "success"
                        ? "text-[color-mix(in_srgb,#16a34a_84%,var(--text-primary))]"
                        : stage.status === "failed"
                          ? "text-[color-mix(in_srgb,#dc2626_84%,var(--text-primary))]"
                          : stage.status === "running"
                            ? "text-[color-mix(in_srgb,var(--accent-primary,#2563eb)_88%,var(--text-primary))] [&_svg]:animate-spin"
                            : "text-(--text-secondary)";
                    return (
                      <div
                        key={stage.key}
                        className={`git-history-create-pr-stage-item is-${stage.status} grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border bg-[color-mix(in_srgb,var(--surface-card-muted,#ffffff)_88%,transparent)] py-[7px] px-2 ${stageBorder}`}
                      >
                        <span className={`git-history-create-pr-stage-icon w-4 h-4 inline-flex items-center justify-center ${stageIconColor}`} aria-hidden>
                          {stage.status === "success" ? (
                            <CircleCheck size={14} />
                          ) : stage.status === "failed" ? (
                            <CircleAlert size={14} />
                          ) : stage.status === "running" ? (
                            <LoaderCircle size={14} />
                          ) : (
                            <span className="git-history-create-pr-stage-dot w-[7px] h-[7px] rounded-full bg-(--border-default)/80" />
                          )}
                        </span>
                        <span className="git-history-create-pr-stage-main min-w-0 flex flex-col gap-0.5">
                          <span className="git-history-create-pr-stage-label text-xs text-(--text-primary) font-semibold">{stage.label}</span>
                          <span className="git-history-create-pr-stage-detail text-[11px] text-(--text-muted) leading-[1.35] [overflow-wrap:anywhere]">{stage.detail}</span>
                        </span>
                        <span className="git-history-create-pr-stage-status text-[11px] text-(--text-secondary)">{statusLabel}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {createPrResult ? (
                <div
                  className={`git-history-create-pr-result rounded-[10px] border bg-[color-mix(in_srgb,var(--surface-control,#f8fafc)_80%,transparent)] py-2 px-2.5 flex flex-col gap-[7px] ${
                    createPrResult.ok ? "is-success border-[color-mix(in_srgb,#22c55e_34%,transparent)]" : "is-failed border-[color-mix(in_srgb,#ef4444_38%,transparent)]"
                  }`}
                >
                  <div className="git-history-create-pr-result-head inline-flex items-center gap-2 min-w-0 [&>code]:border [&>code]:border-(--border-default)/60 [&>code]:rounded-full [&>code]:py-px [&>code]:px-[7px] [&>code]:text-[11px]">
                    <span className="git-history-create-pr-result-title text-[13px] text-(--text-primary) font-bold">{createPrResultHeadline}</span>
                    {createPrResult.prNumber ? (
                      <code>#{createPrResult.prNumber}</code>
                    ) : null}
                  </div>
                  <div className="git-history-create-pr-result-message text-xs leading-[1.45] text-(--text-primary) [overflow-wrap:anywhere]">{createPrResult.message}</div>
                  {createPrResult.nextActionHint ? (
                    <div className="git-history-create-pr-result-hint text-xs text-[color-mix(in_srgb,#b45309_84%,var(--text-secondary))]">
                      {createPrResult.nextActionHint}
                    </div>
                  ) : null}
                  {createPrResult.prUrl ? (
                    <div className="git-history-create-pr-result-actions inline-flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="git-history-create-pr-mini-btn border border-(--border-default)/68 rounded-full bg-[color-mix(in_srgb,var(--surface-control,#f8fafc)_86%,transparent)] text-(--text-secondary) min-h-7 py-0 px-2.5 inline-flex items-center gap-1.5 text-xs cursor-pointer hover:border-[color-mix(in_srgb,var(--accent-primary,#2563eb)_54%,transparent)] hover:text-(--text-primary)"
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
                    <div className="git-history-create-pr-retry-command rounded-lg border border-dashed border-(--border-default)/66 bg-[color-mix(in_srgb,var(--surface-card-muted,#ffffff)_82%,transparent)] p-2 flex flex-col gap-[7px] [&>span]:text-xs [&>span]:text-(--text-secondary) [&>span]:font-semibold [&>code]:text-xs [&>code]:leading-[1.4] [&>code]:text-(--text-primary) [&>code]:[overflow-wrap:anywhere]">
                      <span>{t("git.historyCreatePrRetryCommand")}</span>
                      <code>{createPrResult.retryCommand}</code>
                      <button
                        type="button"
                        className="git-history-create-pr-mini-btn border border-(--border-default)/68 rounded-full bg-[color-mix(in_srgb,var(--surface-control,#f8fafc)_86%,transparent)] text-(--text-secondary) min-h-7 py-0 px-2.5 inline-flex items-center gap-1.5 text-xs cursor-pointer hover:border-[color-mix(in_srgb,var(--accent-primary,#2563eb)_54%,transparent)] hover:text-(--text-primary)"
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
