// @ts-nocheck
export function renderGitHistoryPanelDialogs(scope: any) {
  const {ActionSurface,CREATE_PR_PREVIEW_COMMIT_LIMIT,ChevronDown,ChevronLeft,ChevronRight,ChevronsDownUp,ChevronsUpDown,CircleAlert,CircleCheck,Cloud,CloudDownload,Copy,DEFAULT_DETAILS_SPLIT,DISABLE_HISTORY_ACTION_BUTTONS,Download,FileIcon,FileText,Folder,FolderOpen,FolderTree,GitBranch,GitCommit,GitDiffViewer,GitHistoryInlinePicker,GitHistoryProjectPicker,GitHistoryWorktreePanel,GitMerge,GitPullRequestCreate,HardDrive,LayoutGrid,LoaderCircle,MessageSquareText,Pencil,Plus,RefreshCw,Repeat,Search,ShieldAlert,Trash2,Upload,X,branchContextActions,branchContextMenu,branchContextMenuRef,branchContextMenuStyle,branchContextTrackingSummary,branchDiffState,branchQuery,branchesWidth,buildFileKey,clearOperationNotice,closeBranchContextMenu,closeBranchDiff,closeCreatePrDialog,closeForceDeleteDialog,closeRenameBranchDialog,closeWorktreePreview,commitContextMenu,commitContextMoreOpen,commitListRef,commitQuery,commitRowVirtualizer,commits,commitsWidth,comparePreviewDetailFile,comparePreviewDetailFileDiff,comparePreviewDiffEntries,comparePreviewFileKey,contextMoreDisabledReason,contextPrimaryActionGroups,contextWriteActions,createBranchCanConfirm,createBranchDialogOpen,createBranchName,createBranchNameInputRef,createBranchSource,createBranchSourceOptions,createBranchSubmitting,createPortal,createPrBaseBranchOptions,createPrBaseRepoOptions,createPrCanConfirm,createPrCanOpen,createPrCompareBranchOptions,createPrCopiedPrUrl,createPrCopiedRetryCommand,createPrDefaultsError,createPrDefaultsLoading,createPrDialogOpen,createPrForm,createPrHeadRepoOptions,createPrHeadRepositoryValue,createPrPreviewBaseOnlyCount,createPrPreviewBaseRef,createPrPreviewCommits,createPrPreviewDetails,createPrPreviewDetailsError,createPrPreviewDetailsLoading,createPrPreviewError,createPrPreviewExpanded,createPrPreviewHasMore,createPrPreviewHeadRef,createPrPreviewLoading,createPrPreviewSelectedCommit,createPrPreviewSelectedSha,createPrResult,createPrResultHeadline,createPrStages,createPrSubmitting,createPrToolbarDisabledReason,currentBranch,currentLocalBranchEntry,defaults,desktopSplitLayout,details,detailsBodyRef,detailsError,detailsLoading,detailsMessageContent,detailsSplitRatio,diffViewMode,emptyStateStatusText,expandedLocalScopes,expandedRemoteScopes,extractCommitBody,fallbackGitRoots,fallbackGitRootsError,fallbackGitRootsLoading,fallbackSelectingRoot,fetchDialogOpen,fetchSubmitting,fileTreeItems,forceDeleteCopiedPath,forceDeleteCountdown,forceDeleteDialogState,formatRelativeTime,getBranchLeafName,getBranchScope,getCommitActionIcon,getCurrentDefaultColumnWidths,getSpecialBranchBadges,getTreeLineOpacity,groupedLocalBranches,groupedRemoteBranches,handleBranchContextMenuKeyDown,handleBranchesSplitResizeStart,handleCommitsSplitResizeStart,handleConfirmCreatePr,handleConfirmFetch,handleConfirmPull,handleConfirmPush,handleConfirmRefresh,handleConfirmResetCommit,handleConfirmSync,handleCopyCreatePrRetryCommand,handleCopyCreatePrUrl,handleCopyForceDeleteWorktreePath,handleCreateBranch,handleCreateBranchConfirm,handleCreatePrHeadRepositoryChange,handleDeleteBranch,handleDetailsSplitResizeStart,handleFallbackGitRootSelect,handleFileTreeDirToggle,handleMergeBranch,handleOpenBranchContextMenu,handleOpenCommitContextMenu,handleOpenCreatePrDialog,handleOpenFetchDialog,handleOpenPullDialog,handleOpenPushDialog,handleOpenRefreshDialog,handleOpenRenameBranchDialog,handleOpenSyncDialog,handleOpenWorktreePreview,handleOverviewSplitResizeStart,handlePushPreviewDirToggle,handleRenameBranchConfirm,handleSelectBranchCompareCommit,handleSelectPullRemote,handleSelectPullTargetBranch,handleSelectPushRemote,handleSelectPushTargetBranch,handleSelectWorktreeDiffFile,handleToggleLocalScope,handleToggleRemoteScope,handleWorktreeSummaryChange,historyError,historyHasMore,historyLoading,historyLoadingMore,historyTotal,isCreatePrDialogMaximized,isHistoryDiffModalMaximized,loadCreatePrCommitPreview,loadHistory,localSectionExpanded,localizeKnownGitError,localizedOperationName,mainGridRef,mainGridStyle,onOpenDiffPath,onRequestClose,onSelectWorkspace,openPullTargetBranchMenu,openPushTargetBranchMenu,operationLoading,operationNotice,overviewCommitSectionCollapsed,overviewListView,overviewWidth,previewDetailFile,previewDetailFileDiff,previewDiffEntries,previewModalFullDiffLoader,projectOptions,projectSections,pullDialogOpen,pullNoCommit,pullNoVerify,pullOptionsMenuOpen,pullOptionsMenuRef,pullRemote,pullRemoteGroups,pullRemoteMenuOpen,pullRemoteMenuPlacement,pullRemotePickerRef,pullRemoteTrimmed,pullSelectedOptions,pullStrategy,pullSubmitting,pullTargetBranch,pullTargetBranchActiveScopeTab,pullTargetBranchFieldRef,pullTargetBranchGroups,pullTargetBranchMenuOpen,pullTargetBranchMenuPlacement,pullTargetBranchMenuRef,pullTargetBranchPickerRef,pullTargetBranchTrimmed,pushCanConfirm,pushCc,pushDialogOpen,pushForceWithLease,pushHasOutgoingCommits,pushIsNewBranchTarget,pushPreviewCommits,pushPreviewDetails,pushPreviewDetailsError,pushPreviewDetailsLoading,pushPreviewError,pushPreviewFileTreeItems,pushPreviewHasMore,pushPreviewLoading,pushPreviewModalDiffEntries,pushPreviewModalFile,pushPreviewModalFileDiff,pushPreviewModalFullDiffLoader,pushPreviewSelectedCommit,pushPreviewSelectedFileKey,pushPreviewSelectedSha,pushRemoteMenuOpen,pushRemoteMenuPlacement,pushRemoteOptions,pushRemotePickerRef,pushRemoteTrimmed,pushReviewers,pushRunHooks,pushSubmitting,pushTags,pushTargetBranch,pushTargetBranchActiveScopeTab,pushTargetBranchFieldRef,pushTargetBranchGroups,pushTargetBranchMenuOpen,pushTargetBranchMenuPlacement,pushTargetBranchMenuRef,pushTargetBranchPickerRef,pushTargetBranchTrimmed,pushTargetSummaryBranch,pushToGerrit,pushTopic,refreshAll,refreshDialogOpen,refreshSubmitting,remoteSectionExpanded,renameBranchCanConfirm,renameBranchDialogOpen,renameBranchName,renameBranchNameInputRef,renameBranchSource,renameBranchSubmitting,renameBranchToolbarDisabledReason,renderChangedFilesSummary,repositoryRootName,repositoryUnavailable,resetDialogOpen,resetMode,resetTargetCommit,resetTargetSha,runCommitAction,selectedBranch,selectedCommitSha,selectedFileKey,selectedLocalBranchForRename,setBranchQuery,setBranchesWidth,setCommitContextMenu,setCommitContextMoreOpen,setCommitQuery,setCommitsWidth,setComparePreviewFileKey,setCreateBranchDialogOpen,setCreateBranchName,setCreateBranchSource,setCreatePrForm,setCreatePrPreviewExpanded,setCreatePrPreviewSelectedSha,setDetailsSplitRatio,setDiffViewMode,setFallbackSelectingRoot,setFetchDialogOpen,setIsCreatePrDialogMaximized,setIsHistoryDiffModalMaximized,setLocalSectionExpanded,setOverviewCommitSectionCollapsed,setOverviewListView,setOverviewWidth,setPreviewFileKey,setPullDialogOpen,setPullNoCommit,setPullNoVerify,setPullOptionsMenuOpen,setPullRemoteMenuOpen,setPullStrategy,setPullTargetBranch,setPullTargetBranchActiveScopeTab,setPullTargetBranchMenuOpen,setPullTargetBranchQuery,setPushCc,setPushDialogOpen,setPushForceWithLease,setPushPreviewModalFileKey,setPushPreviewSelectedFileKey,setPushPreviewSelectedSha,setPushRemoteMenuOpen,setPushReviewers,setPushRunHooks,setPushTags,setPushTargetBranch,setPushTargetBranchActiveScopeTab,setPushTargetBranchMenuOpen,setPushTargetBranchQuery,setPushToGerrit,setPushTopic,setRefreshDialogOpen,setRemoteSectionExpanded,setRenameBranchName,setResetDialogOpen,setResetMode,setSelectedBranch,setSelectedCommitSha,setSelectedFileKey,setSyncDialogOpen,setWorkspaceSelectingId,shouldShowWorkspacePickerPage,statusLabel,strokeWidth,syncDialogOpen,syncPreviewCommits,syncPreviewError,syncPreviewLoading,syncPreviewTargetBranch,syncPreviewTargetFound,syncPreviewTargetRemote,syncSubmitting,t,trimRemotePrefix,updatePullRemoteMenuPlacement,updatePushRemoteMenuPlacement,virtualCommitRows,visiblePullTargetBranchGroups,visiblePushTargetBranchGroups,workbenchGridRef,workbenchGridStyle,workingTreeChangedFiles,workingTreeSummaryLabel,workingTreeTotalAdditions,workingTreeTotalDeletions,workspace,workspaceId,workspacePickerMessage,workspaceSelectingId,worktreePreviewDiffEntries,worktreePreviewDiffText,worktreePreviewError,worktreePreviewFile,worktreePreviewFullDiffLoader,worktreePreviewLoading} = scope;
  const pullTargetSummary = pullTargetBranch.trim() || (currentBranch ?? "HEAD");
  const pullExampleCommand = `git pull ${pullRemote.trim() || "origin"} ${pullTargetSummary}${
    pullStrategy ? ` ${pullStrategy}` : ""
  }${pullNoCommit ? " --no-commit" : ""}${pullNoVerify ? " --no-verify" : ""}`;
  const syncAheadCount = currentLocalBranchEntry?.ahead ?? 0;
  const syncBehindCount = currentLocalBranchEntry?.behind ?? 0;
  return (<>
        {pullDialogOpen ? (
          <div
            className="git-history-create-branch-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !pullSubmitting) {
                setPullDialogOpen(false);
              }
            }}
          >
            <div className="git-history-toolbar-confirm-dialog" role="dialog" aria-modal="true" aria-label={t("git.historyPullDialogTitle")}>
              <div className="git-history-create-branch-title git-history-push-title">
                <Download size={14} />
                <span>{t("git.historyPullDialogTitle")}</span>
              </div>
              <div className="git-history-toolbar-confirm-hero">
                <div className="git-history-toolbar-confirm-hero-line">
                  <span>{pullRemote || "origin"}</span>
                  <span aria-hidden>{"->"}</span>
                  <span>{pullTargetBranch.trim() || currentBranch || "main"}</span>
                </div>
                <code>{pullExampleCommand}</code>
              </div>
              <div className="git-history-toolbar-confirm-grid">
                <label className="git-history-create-branch-field">
                  <span>{t("git.historyPullDialogRemoteLabel")}</span>
                  <div
                    className={`git-history-push-picker${pullRemoteMenuOpen ? " is-open" : ""}`}
                    ref={pullRemotePickerRef}
                  >
                    <button
                      type="button"
                      className="git-history-push-picker-trigger"
                      aria-label={t("git.historyPullDialogRemoteLabel")}
                      aria-haspopup="listbox"
                      aria-expanded={pullRemoteMenuOpen}
                      disabled={pullSubmitting}
                      onClick={() => {
                        if (pullSubmitting) {
                          return;
                        }
                        setPullTargetBranchMenuOpen(false);
                        setPullRemoteMenuOpen((previous) => {
                          const nextOpen = !previous;
                          if (nextOpen) {
                            updatePullRemoteMenuPlacement();
                          }
                          return nextOpen;
                        });
                      }}
                    >
                      <Cloud size={12} className="git-history-push-picker-leading-icon" />
                      <span className="git-history-push-picker-value">{pullRemoteTrimmed || "origin"}</span>
                      <ChevronDown size={13} className="git-history-push-picker-caret" />
                    </button>
                    {pullRemoteMenuOpen ? (
                      <div
                        className={`git-history-push-picker-menu popover-surface${
                          pullRemoteMenuPlacement === "up" ? " is-upward" : ""
                        }`}
                        role="listbox"
                        aria-label={t("git.historyPullDialogRemoteLabel")}
                      >
                        {pullRemoteGroups.map((group) => (
                          <div key={group.scope} className="git-history-push-picker-group">
                            <div className="git-history-push-picker-group-label">
                              <FolderTree size={11} />
                              <span>{group.label}</span>
                              <i>{group.items.length}</i>
                            </div>
                            {group.items.map((remoteName) => (
                              <button
                                key={remoteName}
                                type="button"
                                className={`git-history-push-picker-item${remoteName === pullRemoteTrimmed ? " is-active" : ""}`}
                                role="option"
                                aria-selected={remoteName === pullRemoteTrimmed}
                                onClick={() => handleSelectPullRemote(remoteName)}
                              >
                                <Cloud size={12} className="git-history-push-picker-item-icon" />
                                <span className="git-history-push-picker-item-content">
                                  <span className="git-history-push-picker-item-title">{remoteName}</span>
                                </span>
                              </button>
                            ))}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </label>
                <label
                  className="git-history-create-branch-field git-history-push-target-field"
                  ref={pullTargetBranchFieldRef}
                >
                  <span>{t("git.historyPullDialogTargetBranchLabel")}</span>
                  <div
                    className={`git-history-push-combobox${pullTargetBranchMenuOpen ? " is-open" : ""}`}
                    ref={pullTargetBranchPickerRef}
                  >
                    <input
                      value={pullTargetBranch}
                      disabled={pullSubmitting}
                      onChange={(event) => {
                        setPullTargetBranch(event.target.value);
                        setPullTargetBranchQuery(event.target.value);
                        if (!pullTargetBranchMenuOpen) {
                          openPullTargetBranchMenu(false);
                        }
                      }}
                      onFocus={() => openPullTargetBranchMenu(false)}
                      aria-label={t("git.historyPullDialogTargetBranchLabel")}
                      placeholder={currentBranch ?? "main"}
                    />
                    <button
                      type="button"
                      className="git-history-push-combobox-toggle"
                      aria-label={`${t("git.historyPullDialogTargetBranchLabel")} toggle`}
                      aria-haspopup="listbox"
                      aria-expanded={pullTargetBranchMenuOpen}
                      disabled={pullSubmitting}
                      onClick={() => {
                        if (pullSubmitting) {
                          return;
                        }
                        const nextOpen = !pullTargetBranchMenuOpen;
                        if (nextOpen) {
                          openPullTargetBranchMenu(true);
                          return;
                        }
                        setPullTargetBranchMenuOpen(false);
                      }}
                    >
                      <ChevronDown size={13} />
                    </button>
                  </div>
                  {pullTargetBranchMenuOpen ? (
                    <div
                      className={`git-history-push-picker-menu git-history-push-target-menu popover-surface${
                        pullTargetBranchMenuPlacement === "up" ? " is-upward" : ""
                      }`}
                      ref={pullTargetBranchMenuRef}
                      role="listbox"
                      aria-label={t("git.historyPullDialogTargetBranchLabel")}
                    >
                      {pullTargetBranchGroups.length > 0 ? (
                        <>
                          {pullTargetBranchGroups.length > 1 ? (
                            <div className="git-history-push-picker-tabs" role="tablist">
                              {pullTargetBranchGroups.map((group) => {
                                const isActive = group.scope === pullTargetBranchActiveScopeTab;
                                return (
                                  <button
                                    key={`pull-target-tab-${group.scope}`}
                                    type="button"
                                    role="tab"
                                    aria-selected={isActive}
                                    className={`git-history-push-picker-tab${isActive ? " is-active" : ""}`}
                                    onClick={() => setPullTargetBranchActiveScopeTab(group.scope)}
                                  >
                                    <span>{group.label}</span>
                                    <i>{group.items.length}</i>
                                  </button>
                                );
                              })}
                            </div>
                          ) : null}
                          {visiblePullTargetBranchGroups.map((group) => (
                          <div key={group.scope} className="git-history-push-picker-group">
                            {pullTargetBranchGroups.length <= 1 ? (
                              <div className="git-history-push-picker-group-label">
                                <FolderTree size={11} />
                                <span>{group.label}</span>
                                <i>{group.items.length}</i>
                              </div>
                            ) : null}
                            {group.items.map((branchName) => (
                              <button
                                key={branchName}
                                type="button"
                                className={`git-history-push-picker-item${branchName === pullTargetBranchTrimmed ? " is-active" : ""}`}
                                role="option"
                                aria-selected={branchName === pullTargetBranchTrimmed}
                                title={branchName}
                                onClick={() => handleSelectPullTargetBranch(branchName)}
                              >
                                <GitBranch size={12} className="git-history-push-picker-item-icon" />
                                <span className="git-history-push-picker-item-content">
                                  <span className="git-history-push-picker-item-title">
                                    {getBranchLeafName(branchName)}
                                  </span>
                                  {getBranchScope(branchName) !== "__root__" ? (
                                    <>
                                      <span className="git-history-push-picker-item-separator"> · </span>
                                      <span className="git-history-push-picker-item-subtitle">{branchName}</span>
                                    </>
                                  ) : null}
                                </span>
                              </button>
                            ))}
                          </div>
                          ))}
                        </>
                      ) : (
                        <div className="git-history-push-picker-empty">
                          {t("git.historyPushDialogNoRemoteBranches")}
                        </div>
                      )}
                    </div>
                  ) : null}
                </label>
              </div>
              <div className="git-history-toolbar-confirm-options" ref={pullOptionsMenuRef}>
                <button
                  type="button"
                  className="git-history-push-toggle"
                  disabled={pullSubmitting}
                  onClick={() =>
                    setPullOptionsMenuOpen((previous) => {
                      const nextOpen = !previous;
                      if (nextOpen) {
                        setPullRemoteMenuOpen(false);
                        setPullTargetBranchMenuOpen(false);
                      }
                      return nextOpen;
                    })
                  }
                >
                  <span className="git-history-push-toggle-indicator" aria-hidden>
                    {pullSelectedOptions.length > 0 ? pullSelectedOptions.length : ""}
                  </span>
                  <span>{t("git.historyPullDialogModifyOptions")}</span>
                </button>
                {pullOptionsMenuOpen ? (
                  <div className="git-history-toolbar-confirm-options-menu">
                    {(["--rebase", "--ff-only", "--no-ff", "--squash"] as GitPullStrategyOption[]).map((option) => (
                      <button
                        key={option}
                        type="button"
                        className={`git-history-toolbar-confirm-options-item${pullStrategy === option ? " is-active" : ""}`}
                        onClick={() => {
                          setPullStrategy((previous) => (previous === option ? null : option));
                        }}
                      >
                        {option}
                      </button>
                    ))}
                    <button
                      type="button"
                      className={`git-history-toolbar-confirm-options-item${pullNoCommit ? " is-active" : ""}`}
                      onClick={() => setPullNoCommit((previous) => !previous)}
                    >
                      --no-commit
                    </button>
                    <button
                      type="button"
                      className={`git-history-toolbar-confirm-options-item${pullNoVerify ? " is-active" : ""}`}
                      onClick={() => setPullNoVerify((previous) => !previous)}
                    >
                      --no-verify
                    </button>
                  </div>
                ) : null}
                {pullSelectedOptions.length > 0 ? (
                  <div className="git-history-toolbar-confirm-chip-list">
                    {pullSelectedOptions.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        className="git-history-toolbar-confirm-chip"
                        disabled={pullSubmitting}
                        onClick={entry.onRemove}
                      >
                        <span>{entry.label}</span>
                        <X size={11} />
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <dl className="git-history-toolbar-confirm-facts">
                <div className="git-history-toolbar-confirm-fact">
                  <dt>{t("git.historyIntentTitle")}</dt>
                  <dd>{t("git.historyPullDialogIntent")}</dd>
                </div>
                <div className="git-history-toolbar-confirm-fact">
                  <dt>{t("git.historyWillHappenTitle")}</dt>
                  <dd>{t("git.historyPullDialogWillHappen")}</dd>
                </div>
                <div className="git-history-toolbar-confirm-fact">
                  <dt>{t("git.historyWillNotHappenTitle")}</dt>
                  <dd>{t("git.historyPullDialogWillNotHappen")}</dd>
                </div>
              </dl>
              <div className="git-history-toolbar-confirm-command">
                <span>{t("git.historyExampleTitle")}</span>
                <code>{pullExampleCommand}</code>
              </div>
              <div className="git-history-create-branch-actions">
                <button
                  type="button"
                  className="git-history-create-branch-btn is-cancel"
                  disabled={pullSubmitting}
                  onClick={() => setPullDialogOpen(false)}
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  className="git-history-create-branch-btn"
                  disabled={pullSubmitting}
                  onClick={() => {
                    void handleConfirmPull();
                  }}
                >
                  {pullSubmitting ? t("common.loading") : t("git.pull")}
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {syncDialogOpen ? (
          <div className="git-history-create-branch-backdrop" onMouseDown={(event) => {
            if (event.target === event.currentTarget && !syncSubmitting) {
              setSyncDialogOpen(false);
            }
          }}
          >
            <div className="git-history-toolbar-confirm-dialog" role="dialog" aria-modal="true" aria-label={t("git.historySyncDialogTitle")}>
              <div className="git-history-create-branch-title git-history-push-title">
                <Repeat size={14} />
                <span>{t("git.historySyncDialogTitle")}</span>
              </div>
              <div className="git-history-toolbar-confirm-hero">
                <div className="git-history-toolbar-confirm-hero-line">
                  <span>{currentBranch || t("git.historyHeadRef")}</span>
                  <span aria-hidden>{"->"}</span>
                  <span>{`${syncPreviewTargetRemote || "origin"}:${syncPreviewTargetBranch || (currentBranch ?? "main")}`}</span>
                </div>
                <code>git pull && git push</code>
              </div>
              <div className="git-history-toolbar-confirm-preflight">
                <div>{t("git.historySyncDialogTarget", {
                  sourceBranch: currentBranch || t("git.historyHeadRef"),
                  remote: syncPreviewTargetRemote || "origin",
                  targetBranch: syncPreviewTargetBranch || (currentBranch ?? "main"),
                })}
                </div>
                <div>{t("git.historySyncDialogAheadBehind", { ahead: syncAheadCount, behind: syncBehindCount })}</div>
                {syncPreviewLoading ? <div>{t("common.loading")}</div> : null}
                {syncPreviewError ? <div className="git-history-error">{syncPreviewError}</div> : null}
                {!syncPreviewLoading && !syncPreviewError ? (
                  <div className="git-history-toolbar-confirm-commit-list">
                    {(syncPreviewCommits.slice(0, 5)).map((entry) => (
                      <div key={entry.sha} className="git-history-toolbar-confirm-commit-item">
                        <code>{entry.shortSha}</code>
                        <span>{entry.summary || t("git.historyNoMessage")}</span>
                      </div>
                    ))}
                    {!syncPreviewTargetFound ? (
                      <div className="git-history-toolbar-confirm-note">{t("git.historySyncDialogNoRemoteTarget")}</div>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <dl className="git-history-toolbar-confirm-facts">
                <div className="git-history-toolbar-confirm-fact">
                  <dt>{t("git.historyIntentTitle")}</dt>
                  <dd>{t("git.historySyncDialogIntent")}</dd>
                </div>
                <div className="git-history-toolbar-confirm-fact">
                  <dt>{t("git.historyWillHappenTitle")}</dt>
                  <dd>{t("git.historySyncDialogWillHappen")}</dd>
                </div>
                <div className="git-history-toolbar-confirm-fact">
                  <dt>{t("git.historyWillNotHappenTitle")}</dt>
                  <dd>{t("git.historySyncDialogWillNotHappen")}</dd>
                </div>
              </dl>
              <div className="git-history-toolbar-confirm-command">
                <span>{t("git.historyExampleTitle")}</span>
                <code>git pull && git push</code>
              </div>
              <div className="git-history-create-branch-actions">
                <button type="button" className="git-history-create-branch-btn is-cancel" disabled={syncSubmitting} onClick={() => setSyncDialogOpen(false)}>
                  {t("common.cancel")}
                </button>
                <button type="button" className="git-history-create-branch-btn" disabled={syncSubmitting} onClick={() => { void handleConfirmSync(); }}>
                  {syncSubmitting ? t("common.loading") : t("git.sync")}
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {fetchDialogOpen ? (
          <div className="git-history-create-branch-backdrop" onMouseDown={(event) => {
            if (event.target === event.currentTarget && !fetchSubmitting) {
              setFetchDialogOpen(false);
            }
          }}
          >
            <div className="git-history-toolbar-confirm-dialog" role="dialog" aria-modal="true" aria-label={t("git.historyFetchDialogTitle")}>
              <div className="git-history-create-branch-title git-history-push-title">
                <CloudDownload size={14} />
                <span>{t("git.historyFetchDialogTitle")}</span>
              </div>
              <div className="git-history-toolbar-confirm-hero">
                <div className="git-history-toolbar-confirm-hero-line">
                  <span>{t("git.historyFetchDialogHeroSource")}</span>
                  <span aria-hidden>{"->"}</span>
                  <span>{t("git.historyFetchDialogHeroTarget")}</span>
                </div>
                <code>{t("git.historyFetchDialogHeroHint")}</code>
              </div>
              <dl className="git-history-toolbar-confirm-facts">
                <div className="git-history-toolbar-confirm-fact">
                  <dt>{t("git.historyIntentTitle")}</dt>
                  <dd>{t("git.historyFetchDialogIntent")}</dd>
                </div>
                <div className="git-history-toolbar-confirm-fact">
                  <dt>{t("git.historyWillHappenTitle")}</dt>
                  <dd>{t("git.historyFetchDialogWillHappen")}</dd>
                </div>
                <div className="git-history-toolbar-confirm-fact">
                  <dt>{t("git.historyWillNotHappenTitle")}</dt>
                  <dd>{t("git.historyFetchDialogWillNotHappen")}</dd>
                </div>
              </dl>
              <div className="git-history-toolbar-confirm-command">
                <span>{t("git.historyExampleTitle")}</span>
                <code>git fetch --all</code>
              </div>
              <div className="git-history-create-branch-actions">
                <button type="button" className="git-history-create-branch-btn is-cancel" disabled={fetchSubmitting} onClick={() => setFetchDialogOpen(false)}>
                  {t("common.cancel")}
                </button>
                <button type="button" className="git-history-create-branch-btn" disabled={fetchSubmitting} onClick={() => { void handleConfirmFetch(); }}>
                  {fetchSubmitting ? t("common.loading") : t("git.fetch")}
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {refreshDialogOpen ? (
          <div className="git-history-create-branch-backdrop" onMouseDown={(event) => {
            if (event.target === event.currentTarget && !refreshSubmitting) {
              setRefreshDialogOpen(false);
            }
          }}
          >
            <div className="git-history-toolbar-confirm-dialog" role="dialog" aria-modal="true" aria-label={t("git.historyRefreshDialogTitle")}>
              <div className="git-history-create-branch-title git-history-push-title">
                <RefreshCw size={14} />
                <span>{t("git.historyRefreshDialogTitle")}</span>
              </div>
              <div className="git-history-toolbar-confirm-hero">
                <div className="git-history-toolbar-confirm-hero-line">
                  <span>{t("git.historyRefreshDialogHeroSource")}</span>
                  <span aria-hidden>{"->"}</span>
                  <span>{t("git.historyRefreshDialogHeroTarget")}</span>
                </div>
                <code>refreshAll()</code>
              </div>
              <dl className="git-history-toolbar-confirm-facts">
                <div className="git-history-toolbar-confirm-fact">
                  <dt>{t("git.historyIntentTitle")}</dt>
                  <dd>{t("git.historyRefreshDialogIntent")}</dd>
                </div>
                <div className="git-history-toolbar-confirm-fact">
                  <dt>{t("git.historyWillHappenTitle")}</dt>
                  <dd>{t("git.historyRefreshDialogWillHappen")}</dd>
                </div>
                <div className="git-history-toolbar-confirm-fact">
                  <dt>{t("git.historyWillNotHappenTitle")}</dt>
                  <dd>{t("git.historyRefreshDialogWillNotHappen")}</dd>
                </div>
              </dl>
              <div className="git-history-toolbar-confirm-command">
                <span>{t("git.historyExampleTitle")}</span>
                <code>refreshAll()</code>
              </div>
              <div className="git-history-create-branch-actions">
                <button type="button" className="git-history-create-branch-btn is-cancel" disabled={refreshSubmitting} onClick={() => setRefreshDialogOpen(false)}>
                  {t("common.cancel")}
                </button>
                <button type="button" className="git-history-create-branch-btn" disabled={refreshSubmitting} onClick={() => { void handleConfirmRefresh(); }}>
                  {refreshSubmitting ? t("common.loading") : t("git.refresh")}
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {pushDialogOpen ? (
          <div
            className="git-history-create-branch-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !pushSubmitting) {
                setPushDialogOpen(false);
              }
            }}
          >
            <div
              className="git-history-push-dialog"
              role="dialog"
              aria-modal="true"
              aria-label={t("git.historyPushDialogTitle")}
            >
              <div className="git-history-push-hero">
                <div className="git-history-create-branch-title git-history-push-title">
                  <Upload size={14} />
                  <span>{t("git.historyPushDialogTitle")}</span>
                </div>
                <div className="git-history-push-summary-row">
                  <div className="git-history-push-target-wrap">
                    <div className="git-history-push-target">
                      {t("git.historyPushDialogTarget", {
                        sourceBranch: currentBranch || "HEAD",
                        remote: pushRemoteTrimmed || "origin",
                        targetBranch: pushTargetSummaryBranch,
                      })}
                    </div>
                    {pushIsNewBranchTarget ? (
                      <span className="git-history-push-target-badge">
                        ({t("git.historyPushDialogTargetNewTag")})
                      </span>
                    ) : null}
                  </div>
                  <code className="git-history-push-readonly">{currentBranch || "HEAD"}</code>
                </div>
              </div>
              {!pushIsNewBranchTarget ? (
                <div className="git-history-push-section git-history-push-section-preview">
                  <div className="git-history-push-preview">
                    <div className="git-history-push-preview-pane is-commits">
                      <div className="git-history-push-preview-head">
                        <span className="git-history-push-preview-title">
                          <GitCommit size={12} />
                          {t("git.historyPushDialogPreviewCommits")}
                        </span>
                        <strong>{pushPreviewCommits.length}</strong>
                      </div>
                      {!pushPreviewError && pushPreviewLoading ? (
                        <div className="git-history-push-preview-empty">
                          {t("git.historyPushDialogPreviewLoading")}
                        </div>
                      ) : null}
                      {pushPreviewError ? (
                        <div className="git-history-push-preview-error">
                          {localizeKnownGitError(pushPreviewError) ?? pushPreviewError}
                        </div>
                      ) : null}
                      {!pushPreviewError && !pushPreviewLoading && !pushHasOutgoingCommits ? (
                        <div className="git-history-push-preview-empty">
                          {t("git.historyPushDialogPreviewNoOutgoing")}
                        </div>
                      ) : null}
                      {!pushPreviewError && !pushPreviewLoading && pushHasOutgoingCommits ? (
                        <div className="git-history-push-preview-commit-list">
                          {pushPreviewCommits.map((entry) => {
                            const active = entry.sha === pushPreviewSelectedSha;
                            return (
                              <button
                                key={entry.sha}
                                type="button"
                                className={`git-history-push-preview-commit${active ? " is-active" : ""}`}
                                onClick={() => setPushPreviewSelectedSha(entry.sha)}
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
                      ) : null}
                      {!pushPreviewError && pushPreviewHasMore ? (
                        <div className="git-history-push-preview-hint">
                          {t("git.historyPushDialogPreviewHasMore", {
                            count: pushPreviewCommits.length,
                          })}
                        </div>
                      ) : null}
                    </div>
                    <div className="git-history-push-preview-pane is-details">
                      <div className="git-history-push-preview-head">
                        <span className="git-history-push-preview-title">
                          <FileText size={12} />
                          {t("git.historyPushDialogPreviewDetails")}
                        </span>
                      </div>
                      {!pushPreviewError && pushPreviewDetailsLoading ? (
                        <div className="git-history-push-preview-empty">
                          {t("git.historyPushDialogPreviewLoadingDetails")}
                        </div>
                      ) : null}
                      {pushPreviewDetailsError ? (
                        <div className="git-history-push-preview-error">
                          {localizeKnownGitError(pushPreviewDetailsError) ?? pushPreviewDetailsError}
                        </div>
                      ) : null}
                      {!pushPreviewDetailsLoading &&
                      !pushPreviewDetailsError &&
                      !pushPreviewSelectedCommit ? (
                        <div className="git-history-push-preview-empty">
                          {t("git.historyPushDialogPreviewSelectCommit")}
                        </div>
                      ) : null}
                      {pushPreviewDetails && !pushPreviewDetailsLoading && !pushPreviewDetailsError ? (
                        <div className="git-history-push-preview-details">
                          <div className="git-history-push-preview-metadata">
                            <strong>{pushPreviewDetails.summary || t("git.historyNoMessage")}</strong>
                            <span className="git-history-push-preview-metadata-row">
                              <code>{pushPreviewDetails.sha}</code>
                              <em>{pushPreviewDetails.author || t("git.unknown")}</em>
                              <time>{new Date(pushPreviewDetails.commitTime * 1000).toLocaleString()}</time>
                            </span>
                          </div>
                          <div className="git-history-push-preview-file-head git-filetree-section-header">
                            <FolderTree size={12} />
                            <span>{t("git.historyPushDialogPreviewFiles")}</span>
                            <i>{pushPreviewDetails.files.length}</i>
                          </div>
                          <div className="git-history-push-preview-file-tree git-filetree-list git-filetree-list--tree">
                            {pushPreviewFileTreeItems.length > 0 ? (
                              pushPreviewFileTreeItems.map((item) => {
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
                                      key={`push-preview-${item.id}`}
                                      className="git-history-tree-item git-history-tree-dir git-filetree-folder-row"
                                      onActivate={() => handlePushPreviewDirToggle(item.path)}
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
                                const fileKey = buildFileKey(file);
                                const active = pushPreviewSelectedFileKey === fileKey;
                                return (
                                  <ActionSurface
                                    key={`push-preview-${item.id}`}
                                    className="git-history-tree-item git-history-file-item git-filetree-row"
                                    active={active}
                                    onActivate={() => {
                                      setPushPreviewSelectedFileKey(fileKey);
                                      setPushPreviewModalFileKey(fileKey);
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
                </div>
              ) : (
                <div className="git-history-push-section git-history-push-section-preview">
                  <div className="git-history-push-preview">
                    <div className="git-history-push-preview-pane is-commits">
                      <div className="git-history-push-preview-head">
                        <span className="git-history-push-preview-title">
                          <GitCommit size={12} />
                          {t("git.historyPushDialogPreviewCommits")}
                        </span>
                        <strong>{t("git.historyPushDialogTargetNewTag")}</strong>
                      </div>
                      <div className="git-history-push-preview-empty">
                        {t("git.historyPushDialogNewBranchPreviewTitle")}
                      </div>
                      <div className="git-history-push-preview-hint">
                        {t("git.historyPushDialogPreviewTargetMissing", {
                          remote: pushRemoteTrimmed || "origin",
                          branch: pushTargetBranchTrimmed || "main",
                        })}
                      </div>
                    </div>
                    <div className="git-history-push-preview-pane is-details">
                      <div className="git-history-push-preview-head">
                        <span className="git-history-push-preview-title">
                          <FileText size={12} />
                          {t("git.historyPushDialogPreviewDetails")}
                        </span>
                      </div>
                      <div className="git-history-push-preview-empty">
                        {t("git.historyPushDialogNewBranchPreviewHint")}
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {pushPreviewModalFile && typeof document !== "undefined"
                ? createPortal(
                    <div
                      className="git-history-diff-modal-overlay is-popup"
                      role="presentation"
                      onClick={() => setPushPreviewModalFileKey(null)}
                    >
                      <div
                        className={`git-history-diff-modal ${isHistoryDiffModalMaximized ? "is-maximized" : ""}`}
                        role="dialog"
                        aria-modal="true"
                        aria-label={pushPreviewModalFile.path}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <div className="git-history-diff-modal-header">
                          <div className="git-history-diff-modal-title">
                            <span
                              className={`git-history-file-status git-status-${pushPreviewModalFile.status.toLowerCase()}`}
                            >
                              {pushPreviewModalFile.status}
                            </span>
                            <span className="git-history-tree-icon is-file" aria-hidden>
                              <FileIcon filePath={pushPreviewModalFile.path} />
                            </span>
                            <span className="git-history-diff-modal-path">{pushPreviewModalFile.path}</span>
                            <span className="git-history-diff-modal-stats">
                              <span className="is-add">+{pushPreviewModalFile.additions}</span>
                              <span className="is-sep">/</span>
                              <span className="is-del">-{pushPreviewModalFile.deletions}</span>
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
                              onClick={() => setPushPreviewModalFileKey(null)}
                              aria-label={t("common.close")}
                              title={t("common.close")}
                            >
                              <span className="git-history-diff-modal-close-glyph" aria-hidden>
                                ×
                              </span>
                            </button>
                          </div>
                        </div>

                        {pushPreviewModalFile.truncated && !pushPreviewModalFile.isBinary ? (
                          <div className="git-history-warning">
                            {t("git.historyDiffTooLargeTruncated", {
                              lineCount: pushPreviewModalFile.lineCount,
                            })}
                          </div>
                        ) : null}
                        {pushPreviewModalFile.isBinary ? (
                          <pre className="git-history-diff-modal-code">{pushPreviewModalFileDiff}</pre>
                        ) : (
                          <div className="git-history-diff-modal-viewer">
                            <GitDiffViewer
                              workspaceId={workspaceId}
                              diffs={pushPreviewModalDiffEntries}
                              selectedPath={pushPreviewModalFile.path}
                              isLoading={false}
                              error={null}
                              listView="flat"
                              stickyHeaderMode="controls-only"
                              showContentModeControls
                              fullDiffLoader={pushPreviewModalFullDiffLoader}
                              fullDiffSourceKey={pushPreviewSelectedSha}
                              diffStyle={diffViewMode}
                              onDiffStyleChange={setDiffViewMode}
                            />
                          </div>
                        )}
                      </div>
                    </div>,
                    document.body,
                  )
                : null}
              <div className="git-history-push-section git-history-push-section-controls">
                <div className="git-history-push-grid">
                  <div className="git-history-create-branch-field">
                    <span className="git-history-push-field-label">
                      <Cloud size={12} />
                      {t("git.historyPushDialogRemoteLabel")}
                    </span>
                    <div
                      className={`git-history-push-picker${pushRemoteMenuOpen ? " is-open" : ""}`}
                      ref={pushRemotePickerRef}
                    >
                      <button
                        type="button"
                        className="git-history-push-picker-trigger"
                        aria-label={t("git.historyPushDialogRemoteLabel")}
                        aria-haspopup="listbox"
                        aria-expanded={pushRemoteMenuOpen}
                        disabled={pushSubmitting}
                        onClick={() => {
                          if (pushSubmitting) {
                            return;
                          }
                          setPushTargetBranchMenuOpen(false);
                          setPushRemoteMenuOpen((previous) => {
                            const nextOpen = !previous;
                            if (nextOpen) {
                              updatePushRemoteMenuPlacement();
                            }
                            return nextOpen;
                          });
                        }}
                      >
                        <Cloud size={12} className="git-history-push-picker-leading-icon" />
                        <span className="git-history-push-picker-value">{pushRemoteTrimmed || "origin"}</span>
                        <ChevronDown size={13} className="git-history-push-picker-caret" />
                      </button>
                      {pushRemoteMenuOpen ? (
                        <div
                          className={`git-history-push-picker-menu popover-surface${
                            pushRemoteMenuPlacement === "up" ? " is-upward" : ""
                          }`}
                          role="listbox"
                          aria-label={t("git.historyPushDialogRemoteLabel")}
                        >
                          {pushRemoteOptions.map((remoteName) => (
                            <button
                              key={remoteName}
                              type="button"
                              className={`git-history-push-picker-item${remoteName === pushRemoteTrimmed ? " is-active" : ""}`}
                              role="option"
                              aria-selected={remoteName === pushRemoteTrimmed}
                              onClick={() => handleSelectPushRemote(remoteName)}
                            >
                              <Cloud size={12} className="git-history-push-picker-item-icon" />
                              <span className="git-history-push-picker-item-content">{remoteName}</span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <label
                    className="git-history-create-branch-field git-history-push-target-field"
                    ref={pushTargetBranchFieldRef}
                  >
                    <span className="git-history-push-field-label">
                      <GitBranch size={12} />
                      {t("git.historyPushDialogTargetBranchLabel")}
                    </span>
                    <div
                      className={`git-history-push-combobox${pushTargetBranchMenuOpen ? " is-open" : ""}`}
                      ref={pushTargetBranchPickerRef}
                    >
                      <input
                        value={pushTargetBranch}
                        disabled={pushSubmitting}
                        onChange={(event) => {
                          setPushTargetBranch(event.target.value);
                          setPushTargetBranchQuery(event.target.value);
                          if (!pushTargetBranchMenuOpen) {
                            openPushTargetBranchMenu(false);
                          }
                        }}
                        onFocus={() => openPushTargetBranchMenu(false)}
                        aria-label={t("git.historyPushDialogTargetBranchLabel")}
                        placeholder={currentBranch ?? "main"}
                      />
                      <button
                        type="button"
                        className="git-history-push-combobox-toggle"
                        aria-label={`${t("git.historyPushDialogTargetBranchLabel")} toggle`}
                        aria-haspopup="listbox"
                        aria-expanded={pushTargetBranchMenuOpen}
                        disabled={pushSubmitting}
                        onClick={() => {
                          if (pushSubmitting) {
                            return;
                          }
                          const nextOpen = !pushTargetBranchMenuOpen;
                          if (nextOpen) {
                            openPushTargetBranchMenu(true);
                            return;
                          }
                          setPushTargetBranchMenuOpen(false);
                        }}
                      >
                        <ChevronDown size={13} />
                      </button>
                    </div>
                    {pushTargetBranchMenuOpen ? (
                      <div
                        className={`git-history-push-picker-menu git-history-push-target-menu popover-surface${
                          pushTargetBranchMenuPlacement === "up" ? " is-upward" : ""
                        }`}
                        ref={pushTargetBranchMenuRef}
                        role="listbox"
                        aria-label={t("git.historyPushDialogTargetBranchLabel")}
                      >
                        {pushTargetBranchGroups.length > 0 ? (
                          <>
                            {pushTargetBranchGroups.length > 1 ? (
                              <div className="git-history-push-picker-tabs" role="tablist">
                                {pushTargetBranchGroups.map((group) => {
                                  const isActive = group.scope === pushTargetBranchActiveScopeTab;
                                  return (
                                    <button
                                      key={`push-target-tab-${group.scope}`}
                                      type="button"
                                      role="tab"
                                      aria-selected={isActive}
                                      className={`git-history-push-picker-tab${isActive ? " is-active" : ""}`}
                                      onClick={() => setPushTargetBranchActiveScopeTab(group.scope)}
                                    >
                                      <span>{group.label}</span>
                                      <i>{group.items.length}</i>
                                    </button>
                                  );
                                })}
                              </div>
                            ) : null}
                            {visiblePushTargetBranchGroups.map((group) => (
                            <div key={group.scope} className="git-history-push-picker-group">
                              {pushTargetBranchGroups.length <= 1 ? (
                                <div className="git-history-push-picker-group-label">
                                  <FolderTree size={11} />
                                  <span>{group.label}</span>
                                  <i>{group.items.length}</i>
                                </div>
                              ) : null}
                              {group.items.map((branchName) => (
                                <button
                                  key={branchName}
                                  type="button"
                                  className={`git-history-push-picker-item${branchName === pushTargetBranchTrimmed ? " is-active" : ""}`}
                                  role="option"
                                  aria-selected={branchName === pushTargetBranchTrimmed}
                                  title={branchName}
                                  onClick={() => handleSelectPushTargetBranch(branchName)}
                                >
                                  <GitBranch size={12} className="git-history-push-picker-item-icon" />
                                  <span className="git-history-push-picker-item-content">
                                    <span className="git-history-push-picker-item-title">
                                      {getBranchLeafName(branchName)}
                                    </span>
                                    {getBranchScope(branchName) !== "__root__" ? (
                                      <>
                                        <span className="git-history-push-picker-item-separator"> · </span>
                                        <span className="git-history-push-picker-item-subtitle">{branchName}</span>
                                      </>
                                    ) : null}
                                  </span>
                                </button>
                              ))}
                            </div>
                            ))}
                          </>
                        ) : (
                          <div className="git-history-push-picker-empty">
                            {t("git.historyPushDialogNoRemoteBranches")}
                          </div>
                        )}
                      </div>
                    ) : null}
                  </label>
                </div>
                <button
                  type="button"
                  className={`git-history-push-toggle${pushToGerrit ? " is-active" : ""}`}
                  aria-pressed={pushToGerrit}
                  disabled={pushSubmitting}
                  onClick={() => setPushToGerrit((previous) => !previous)}
                >
                  <span className="git-history-push-toggle-indicator" aria-hidden>
                    {pushToGerrit ? "✓" : ""}
                  </span>
                  <Upload size={12} className="git-history-push-toggle-icon" />
                  <span>{t("git.historyPushDialogPushToGerrit")}</span>
                </button>
                {pushToGerrit ? (
                  <>
                    <div className="git-history-push-hint">
                      {t("git.historyPushDialogGerritHint", {
                        branch: pushTargetBranchTrimmed || currentBranch || "main",
                      })}
                    </div>
                    <div className="git-history-push-grid">
                      <label className="git-history-create-branch-field">
                        <span>{t("git.historyPushDialogTopicLabel")}</span>
                        <input
                          value={pushTopic}
                          disabled={pushSubmitting}
                          onChange={(event) => setPushTopic(event.target.value)}
                        />
                      </label>
                      <label className="git-history-create-branch-field">
                        <span>{t("git.historyPushDialogReviewersLabel")}</span>
                        <input
                          value={pushReviewers}
                          disabled={pushSubmitting}
                          onChange={(event) => setPushReviewers(event.target.value)}
                          placeholder={t("git.historyPushDialogCommaSeparatedHint")}
                        />
                      </label>
                      <label className="git-history-create-branch-field">
                        <span>{t("git.historyPushDialogCcLabel")}</span>
                        <input
                          value={pushCc}
                          disabled={pushSubmitting}
                          onChange={(event) => setPushCc(event.target.value)}
                          placeholder={t("git.historyPushDialogCommaSeparatedHint")}
                        />
                      </label>
                    </div>
                  </>
                ) : null}
              </div>
              <div className="git-history-push-footer">
                <div className="git-history-push-options">
                  <button
                    type="button"
                    className={`git-history-push-toggle${pushTags ? " is-active" : ""}`}
                    aria-pressed={pushTags}
                    disabled={pushSubmitting}
                    onClick={() => setPushTags((previous) => !previous)}
                  >
                    <span className="git-history-push-toggle-indicator" aria-hidden>
                      {pushTags ? "✓" : ""}
                    </span>
                    <GitBranch size={12} className="git-history-push-toggle-icon" />
                    <span>{t("git.historyPushDialogPushTags")}</span>
                  </button>
                  <button
                    type="button"
                    className={`git-history-push-toggle${pushRunHooks ? " is-active" : ""}`}
                    aria-pressed={pushRunHooks}
                    disabled={pushSubmitting}
                    onClick={() => setPushRunHooks((previous) => !previous)}
                  >
                    <span className="git-history-push-toggle-indicator" aria-hidden>
                      {pushRunHooks ? "✓" : ""}
                    </span>
                    <RefreshCw size={12} className="git-history-push-toggle-icon" />
                    <span>{t("git.historyPushDialogRunHooks")}</span>
                  </button>
                  <button
                    type="button"
                    className={`git-history-push-toggle${pushForceWithLease ? " is-active" : ""}`}
                    aria-pressed={pushForceWithLease}
                    disabled={pushSubmitting}
                    onClick={() => setPushForceWithLease((previous) => !previous)}
                  >
                    <span className="git-history-push-toggle-indicator" aria-hidden>
                      {pushForceWithLease ? "✓" : ""}
                    </span>
                    <Repeat size={12} className="git-history-push-toggle-icon" />
                    <span>{t("git.historyPushDialogForceWithLease")}</span>
                  </button>
                </div>
                <div className="git-history-create-branch-actions">
                  <button
                    type="button"
                    className="git-history-create-branch-btn is-cancel"
                    disabled={pushSubmitting}
                    onClick={() => setPushDialogOpen(false)}
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    type="button"
                    className="git-history-create-branch-btn is-confirm"
                    disabled={!pushCanConfirm}
                    title={
                      !pushCanConfirm && !pushPreviewLoading && !pushHasOutgoingCommits
                        ? t("git.historyPushDialogPreviewNoOutgoingDisableHint")
                        : undefined
                    }
                    onClick={() => void handleConfirmPush()}
                  >
                    {pushSubmitting ? t("common.loading") : t("git.push")}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
        {resetDialogOpen && resetTargetCommit ? (
          <div
            className="git-history-create-branch-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !operationLoading) {
                setResetDialogOpen(false);
              }
            }}
          >
            <div
              className="git-history-reset-dialog"
              role="dialog"
              aria-modal="true"
              aria-label={t("git.historyResetDialogTitle")}
            >
              <div className="git-history-create-branch-title">
                {t("git.historyResetDialogTitle")}
              </div>
              <div className="git-history-reset-target">
                {t("git.historyResetDialogTarget", {
                  branch: currentBranch ?? "HEAD",
                  workspace: workspace.name,
                  sha: resetTargetCommit.sha.slice(0, 10),
                  summary: resetTargetCommit.summary,
                  author: resetTargetCommit.author,
                })}
              </div>
              <div className="git-history-reset-description">
                {t("git.historyResetDialogDescription")}
              </div>
              <div className="git-history-reset-mode-list" role="radiogroup">
                {([
                  ["soft", "historyResetModeSoft", "historyResetModeSoftDesc"],
                  ["mixed", "historyResetModeMixed", "historyResetModeMixedDesc"],
                  ["hard", "historyResetModeHard", "historyResetModeHardDesc"],
                  ["keep", "historyResetModeKeep", "historyResetModeKeepDesc"],
                ] as const).map(([mode, labelKey, descKey]) => (
                  <label key={mode} className="git-history-reset-mode-item">
                    <input
                      type="radio"
                      name="git-history-reset-mode"
                      checked={resetMode === mode}
                      onChange={() => setResetMode(mode)}
                    />
                    <div className="git-history-reset-mode-copy">
                      <div className="git-history-reset-mode-label">{t(`git.${labelKey}`)}</div>
                      <div className="git-history-reset-mode-desc">{t(`git.${descKey}`)}</div>
                    </div>
                  </label>
                ))}
              </div>
              {resetMode === "hard" ? (
                <div className="git-history-warning">{t("git.historyResetHardWarning")}</div>
              ) : null}
              <div className="git-history-create-branch-actions">
                <button
                  type="button"
                  className="git-history-create-branch-btn is-cancel"
                  onClick={() => setResetDialogOpen(false)}
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  className="git-history-create-branch-btn is-confirm"
                  disabled={!resetTargetSha || Boolean(operationLoading)}
                  onClick={() => void handleConfirmResetCommit()}
                >
                  {operationLoading === "reset" ? t("common.loading") : t("common.confirm")}
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {forceDeleteDialogState ? (
          <div
            className="git-history-create-branch-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                closeForceDeleteDialog(false);
              }
            }}
          >
            <section
              className="git-history-force-delete-dialog"
              role="dialog"
              aria-modal="true"
              aria-label={t("git.historyTitleForceDeleteBranch")}
            >
              <div className="git-history-force-delete-header">
                <span className="git-history-force-delete-title">
                  <ShieldAlert size={16} />
                  {t("git.historyTitleForceDeleteBranch")}
                </span>
                <button
                  type="button"
                  className="git-history-force-delete-close"
                  onClick={() => closeForceDeleteDialog(false)}
                  aria-label={t("common.close")}
                  title={t("common.close")}
                >
                  <span className="git-history-force-delete-close-glyph" aria-hidden>
                    ×
                  </span>
                </button>
              </div>

              <div className="git-history-force-delete-summary">
                {forceDeleteDialogState.mode === "worktreeOccupied"
                  ? t("git.historyForceDeleteDialogSubtitleWithWorktree", {
                      branch: forceDeleteDialogState.branch,
                    })
                  : t("git.historyForceDeleteDialogSubtitleNotMerged", {
                      branch: forceDeleteDialogState.branch,
                    })}
              </div>

              <div className="git-history-force-delete-risk">
                <strong>{t("git.historyForceDeleteDialogRiskTitle")}</strong>
                <p>
                  {forceDeleteDialogState.mode === "worktreeOccupied"
                    ? t("git.historyForceDeleteDialogRiskWithWorktree")
                    : t("git.historyForceDeleteDialogRiskNotMerged")}
                </p>
              </div>

              <dl className="git-history-force-delete-facts">
                <div>
                  <dt>{t("git.historyForceDeleteDialogBranchLabel")}</dt>
                  <dd>
                    <code>{forceDeleteDialogState.branch}</code>
                  </dd>
                </div>
                {forceDeleteDialogState.worktreePath ? (
                  <div>
                    <dt>{t("git.historyForceDeleteDialogWorktreeLabel")}</dt>
                    <dd>
                      <span className="git-history-force-delete-worktree-row">
                        <code>{forceDeleteDialogState.worktreePath}</code>
                        <button
                          type="button"
                          className="git-history-force-delete-copy"
                          onClick={() => void handleCopyForceDeleteWorktreePath()}
                        >
                          {forceDeleteCopiedPath
                            ? t("git.historyForceDeleteDialogCopied")
                            : t("git.historyForceDeleteDialogCopyPath")}
                        </button>
                      </span>
                    </dd>
                  </div>
                ) : null}
              </dl>

              <p className="git-history-force-delete-tip">
                {t("git.historyForceDeleteDialogTip")}
              </p>

              <div className="git-history-create-branch-actions">
                <button
                  type="button"
                  className="git-history-create-branch-btn is-cancel"
                  onClick={() => closeForceDeleteDialog(false)}
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  className="git-history-create-branch-btn is-danger"
                  disabled={forceDeleteCountdown > 0}
                  onClick={() => closeForceDeleteDialog(true)}
                >
                  {(forceDeleteDialogState.mode === "worktreeOccupied"
                    ? t("git.historyForceDeleteDialogConfirmWithWorktree")
                    : t("git.historyForceDeleteDialogConfirm")) +
                    (forceDeleteCountdown > 0
                      ? ` (${t("git.historyForceDeleteDialogUnlockCountdown", {
                          count: forceDeleteCountdown,
                        })})`
                      : "")}
                </button>
              </div>
            </section>
          </div>
        ) : null}
        {createBranchDialogOpen ? (
          <div
            className="git-history-create-branch-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !createBranchSubmitting) {
                setCreateBranchDialogOpen(false);
              }
            }}
          >
            <div
              className="git-history-create-branch-dialog"
              role="dialog"
              aria-modal="true"
              aria-label={t("git.historyCreateBranchDialogTitle")}
            >
              <div className="git-history-create-branch-title">
                {t("git.historyCreateBranchDialogTitle")}
              </div>
              <label className="git-history-create-branch-field">
                <span>{t("git.historyCreateBranchDialogSourceLabel")}</span>
                <select
                  value={createBranchSource}
                  disabled={createBranchSubmitting}
                  onChange={(event) => setCreateBranchSource(event.target.value)}
                >
                  {createBranchSourceOptions.map((branchName) => (
                    <option key={branchName} value={branchName}>
                      {branchName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="git-history-create-branch-field">
                <span>{t("git.historyCreateBranchDialogNameLabel")}</span>
                <input
                  ref={createBranchNameInputRef}
                  value={createBranchName}
                  disabled={createBranchSubmitting}
                  placeholder={t("git.historyPromptNewBranchName")}
                  onChange={(event) => setCreateBranchName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && createBranchCanConfirm) {
                      event.preventDefault();
                      void handleCreateBranchConfirm();
                    }
                  }}
                />
              </label>
              {createBranchSubmitting ? (
                <div className="git-history-create-branch-hint">
                  {t("git.historyCreateBranchDialogBusy")}
                </div>
              ) : null}
              <div className="git-history-create-branch-actions">
                <button
                  type="button"
                  className="git-history-create-branch-btn is-cancel"
                  disabled={createBranchSubmitting}
                  onClick={() => setCreateBranchDialogOpen(false)}
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  className="git-history-create-branch-btn is-confirm"
                  disabled={!createBranchCanConfirm}
                  onClick={() => void handleCreateBranchConfirm()}
                >
                  {createBranchSubmitting ? t("common.loading") : t("common.confirm")}
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {renameBranchDialogOpen ? (
          <div
            className="git-history-create-branch-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !renameBranchSubmitting) {
                closeRenameBranchDialog();
              }
            }}
          >
            <div
              className="git-history-create-branch-dialog"
              role="dialog"
              aria-modal="true"
              aria-label={t("git.historyRenameBranchDialogTitle")}
            >
              <div className="git-history-create-branch-title">
                {t("git.historyRenameBranchDialogTitle")}
              </div>
              <label className="git-history-create-branch-field">
                <span>{t("git.historyRenameBranchDialogSourceLabel")}</span>
                <input value={renameBranchSource} disabled />
              </label>
              <label className="git-history-create-branch-field">
                <span>{t("git.historyRenameBranchDialogNameLabel")}</span>
                <input
                  ref={renameBranchNameInputRef}
                  value={renameBranchName}
                  disabled={renameBranchSubmitting}
                  placeholder={t("git.historyPromptRenameBranch")}
                  onChange={(event) => setRenameBranchName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && renameBranchCanConfirm) {
                      event.preventDefault();
                      void handleRenameBranchConfirm();
                    }
                  }}
                />
              </label>
              {renameBranchSubmitting ? (
                <div className="git-history-create-branch-hint">
                  {t("git.historyRenameBranchDialogBusy")}
                </div>
              ) : null}
              <div className="git-history-create-branch-actions">
                <button
                  type="button"
                  className="git-history-create-branch-btn is-cancel"
                  disabled={renameBranchSubmitting}
                  onClick={closeRenameBranchDialog}
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  className="git-history-create-branch-btn is-confirm"
                  disabled={!renameBranchCanConfirm}
                  onClick={() => void handleRenameBranchConfirm()}
                >
                  {renameBranchSubmitting ? t("common.loading") : t("common.confirm")}
                </button>
              </div>
            </div>
          </div>
        ) : null}
  </>);
}
