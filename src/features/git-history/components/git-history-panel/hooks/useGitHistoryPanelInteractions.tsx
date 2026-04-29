// @ts-nocheck
import { useCallback, useEffect, useMemo, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";
import type { GitPrWorkflowDefaults } from "../../../../../types";
import { useGitHistoryPanelBranchCompareHandlers } from "./useGitHistoryPanelBranchCompareHandlers";

type CommitActionId =
  | "checkout"
  | "create-branch"
  | "revert"
  | "cherry-pick"
  | "copy-sha"
  | "copy-message"
  | "reset";

type BranchContextAction = {
  id: string;
  label: string;
  icon: unknown;
  tone?: "normal" | "danger";
  disabled?: boolean;
  disabledReason?: string | null;
  dividerBefore?: boolean;
  onSelect: () => void;
};

export function useGitHistoryPanelInteractions(scope: any) {
  const {BRANCHES_MIN_WIDTH,COMMITS_MIN_WIDTH,COMMIT_ROW_ESTIMATED_HEIGHT,COMPACT_LAYOUT_BREAKPOINT,CREATE_PR_PREVIEW_COMMIT_LIMIT,DETAILS_MIN_WIDTH,DETAILS_SPLIT_MAX,DETAILS_SPLIT_MIN,DISABLE_HISTORY_COMMIT_ACTIONS,Download,FileText,FolderTree,GitBranch,GitMerge,OVERVIEW_MIN_WIDTH,Pencil,Plus,RefreshCw,Repeat,Trash2,Upload,VERTICAL_SPLITTER_SIZE,ask,branchCompareDetailsCacheRef,branchContextMenu,branchContextMenuRef,branchDiffCacheRef,branchesWidth,buildCreatePrInitialStages,checkoutGitBranch,cherryPickCommit,clamp,clearOperationNotice,closeBranchContextMenu,commitContextMenu,commitListRef,commits,commitsWidth,createBranchName,createBranchSource,createBranchSourceOptions,createGitBranchFromBranch,createGitBranchFromCommit,createGitPrWorkflow,createOperationErrorState,createPrCanConfirm,createPrCanOpen,createPrDefaultsLoading,createPrDialogOpen,createPrForm,createPrPreviewBaseRef,createPrPreviewBaseRemoteName,createPrPreviewDetailsCacheRef,createPrPreviewDetailsLoadTokenRef,createPrPreviewHeadRef,createPrPreviewLoadTokenRef,createPrPreviewSelectedSha,createPrProgressTimerRef,createPrResult,createPrSubmitting,currentBranch,currentLocalBranchEntry,defaults,deleteGitBranch,desktopSplitLayout,details,detailsBodyRef,extractWorktreePathFromDeleteError,fallbackGitRoots,fallbackGitRootsLoading,fallbackSelectingRoot,fetchGit,getDefaultColumnWidths,getGitBranchCompareCommits,getGitCommitDetails,getGitDiffs,getGitPrWorkflowDefaults,getGitPushPreview,getGitStatus,getGitWorktreeDiffAgainstBranch,getGitWorktreeDiffFileAgainstBranch,getOperationDisplayName,historyHasMore,historyLoading,historyLoadingMore,isBranchDeleteNotFullyMergedError,isBranchDeleteUsedByWorktreeError,listGitRoots,loadHistory,localBranches,localizeKnownGitError,mainGridRef,mapCreatePrStagesFromResult,mergeGitBranch,onOpenDiffPath,onSelectWorkspace,onSelectWorkspacePath,operationLoading,overviewWidth,owner,projectOptions,promptForceDeleteDialog,pullGit,pullNoCommit,pullNoVerify,pullRemote,pullRemoteOptions,pullStrategy,pullTargetBranch,pushCanConfirm,pushCc,pushDialogOpen,pushForceWithLease,pushGit,pushPreviewDetailsLoadTokenRef,pushPreviewLoadTokenRef,pushPreviewSelectedSha,pushRemoteOptions,pushRemoteTrimmed,pushReviewers,pushRunHooks,pushTags,pushTargetBranchTrimmed,pushToGerrit,pushTopic,rebaseGitBranch,refreshAll,renameBranchCanConfirm,renameBranchNameTrimmed,renameBranchSource,renameBranchSubmitting,renameGitBranch,repositoryUnavailable,resetGitCommit,resetMode,resetTargetSha,resolveGitRootPath,resolvePushTargetBranchOptions,resolveUpstreamTarget,revertCommit,runOperation,selectedBranch,selectedCommitSha,setBranchContextMenu,setBranchDiffState,setBranchesWidth,setCommitContextMenu,setCommitContextMoreOpen,setCommitsWidth,setComparePreviewFileKey,setCreateBranchDialogOpen,setCreateBranchName,setCreateBranchSource,setCreatePrCopiedPrUrl,setCreatePrCopiedRetryCommand,setCreatePrDefaults,setCreatePrDefaultsError,setCreatePrDefaultsLoading,setCreatePrDialogOpen,setCreatePrForm,setCreatePrPreviewBaseOnlyCount,setCreatePrPreviewCommits,setCreatePrPreviewDetails,setCreatePrPreviewDetailsError,setCreatePrPreviewDetailsLoading,setCreatePrPreviewError,setCreatePrPreviewExpanded,setCreatePrPreviewLoading,setCreatePrPreviewSelectedSha,setCreatePrResult,setCreatePrStages,setDesktopSplitLayout,setDetailsSplitRatio,setExpandedDirs,setExpandedLocalScopes,setExpandedRemoteScopes,setFallbackGitRoots,setFallbackGitRootsError,setFallbackGitRootsLoading,setFallbackSelectingRoot,setFetchDialogOpen,setIsCreatePrDialogMaximized,setOperationLoading,setOverviewWidth,setPullDialogOpen,setPullNoCommit,setPullNoVerify,setPullOptionsMenuOpen,setPullRemote,setPullRemoteMenuOpen,setPullRemoteMenuPlacement,setPullStrategy,setPullTargetBranch,setPullTargetBranchMenuOpen,setPullTargetBranchMenuPlacement,setPullTargetBranchQuery,setPushCc,setPushDialogOpen,setPushForceWithLease,setPushPreviewCommits,setPushPreviewDetails,setPushPreviewDetailsError,setPushPreviewDetailsLoading,setPushPreviewError,setPushPreviewExpandedDirs,setPushPreviewHasMore,setPushPreviewLoading,setPushPreviewSelectedSha,setPushPreviewTargetFound,setPushRemote,setPushRemoteMenuOpen,setPushReviewers,setPushRunHooks,setPushTags,setPushTargetBranch,setPushTargetBranchMenuOpen,setPushTargetBranchMenuPlacement,setPushTargetBranchQuery,setPushToGerrit,setPushTopic,setRefreshDialogOpen,setRenameBranchDialogOpen,setRenameBranchName,setRenameBranchSource,setResetDialogOpen,setResetMode,setResetTargetSha,setSelectedBranch,setSelectedCommitSha,setSyncDialogOpen,setSyncPreviewCommits,setSyncPreviewError,setSyncPreviewLoading,setSyncPreviewTargetBranch,setSyncPreviewTargetFound,setSyncPreviewTargetRemote,setWorkingTreeChangedFiles,setWorkingTreeTotalAdditions,setWorkingTreeTotalDeletions,setWorkspaceSelectingId,setWorktreePreviewError,setWorktreePreviewFile,setWorktreePreviewLoading,showOperationNotice,splitGitHubRepo,syncDialogOpen,syncGit,syncPreviewTargetBranch,syncPreviewTargetRemote,t,trimmed,updateGitBranch,useCallback,useEffect,useMemo,useVirtualizer,workbenchGridRef,workspace,workspaceId,workspaceSelectingId,workspaces} = scope;
  const refreshFallbackGitRoots = useCallback(async () => {
    if (!repositoryUnavailable || !workspace) {
      setFallbackGitRoots([]);
      setFallbackGitRootsLoading(false);
      setFallbackGitRootsError(null);
      return;
    }
    setFallbackGitRootsLoading(true);
    setFallbackGitRootsError(null);
    try {
      const roots = await listGitRoots(workspace.id, 2);
      setFallbackGitRoots(roots);
      setFallbackGitRootsLoading(false);
    } catch (error) {
      setFallbackGitRoots([]);
      setFallbackGitRootsLoading(false);
      setFallbackGitRootsError(error instanceof Error ? error.message : String(error));
    }
  }, [
    listGitRoots,
    repositoryUnavailable,
    setFallbackGitRoots,
    setFallbackGitRootsError,
    setFallbackGitRootsLoading,
    workspace,
  ]);

  useEffect(() => {
    if (!repositoryUnavailable || !workspace) {
      setFallbackGitRoots([]);
      setFallbackGitRootsLoading(false);
      setFallbackGitRootsError(null);
      return;
    }
    void refreshFallbackGitRoots();
  }, [
    refreshFallbackGitRoots,
    repositoryUnavailable,
    setFallbackGitRoots,
    setFallbackGitRootsError,
    setFallbackGitRootsLoading,
    workspace,
  ]);

  const handleFallbackGitRootSelect = useCallback(
    async (relativeRoot: string) => {
      if (!workspace || !relativeRoot) {
        return;
      }
      const absolutePath = resolveGitRootPath(workspace.path, relativeRoot);
      if (onSelectWorkspacePath) {
        await onSelectWorkspacePath(absolutePath);
        return;
      }
      if (!onSelectWorkspace) {
        return;
      }
      const normalizedTarget = absolutePath.replace(/\\/g, "/").replace(/\/+$/, "");
      const matched = workspaces.find(
        (entry) => entry.path.replace(/\\/g, "/").replace(/\/+$/, "") === normalizedTarget,
      );
      if (matched) {
        onSelectWorkspace(matched.id);
      }
    },
    [onSelectWorkspace, onSelectWorkspacePath, resolveGitRootPath, workspace, workspaces],
  );

  useEffect(() => {
    setWorkspaceSelectingId(null);
  }, [setWorkspaceSelectingId, workspace?.id]);

  useEffect(() => {
    if (!repositoryUnavailable) {
      setFallbackSelectingRoot(null);
    }
  }, [repositoryUnavailable, setFallbackSelectingRoot]);

  const workspaceSelectingName = useMemo(() => {
    if (!workspaceSelectingId) {
      return "";
    }
    return (
      projectOptions.find((entry) => entry.id === workspaceSelectingId)?.name ??
      t("git.historyProject")
    );
  }, [projectOptions, t, workspaceSelectingId]);

  const emptyStateStatusText = useMemo(() => {
    if (fallbackSelectingRoot) {
      return t("git.historyWorkspacePickerStatusSwitchRepo", { repo: fallbackSelectingRoot });
    }
    if (workspaceSelectingId) {
      return t("git.historyWorkspacePickerStatusSwitchWorkspace", {
        workspace: workspaceSelectingName,
      });
    }
    if (fallbackGitRootsLoading) {
      return t("git.historyWorkspacePickerStatusScanning");
    }
    if (fallbackGitRoots.length > 0) {
      return t("git.historyWorkspacePickerStatusReady", { count: fallbackGitRoots.length });
    }
    return t("git.historyWorkspacePickerStatusNoRepo");
  }, [
    fallbackGitRoots.length,
    fallbackGitRootsLoading,
    fallbackSelectingRoot,
    t,
    workspaceSelectingId,
    workspaceSelectingName,
  ]);
  const handleWorktreeSummaryChange = useCallback(
    (summary: {
      changedFiles: number;
      totalAdditions: number;
      totalDeletions: number;
    }) => {
      setWorkingTreeChangedFiles(summary.changedFiles);
      setWorkingTreeTotalAdditions(summary.totalAdditions);
      setWorkingTreeTotalDeletions(summary.totalDeletions);
    },
    [
      setWorkingTreeChangedFiles,
      setWorkingTreeTotalAdditions,
      setWorkingTreeTotalDeletions,
    ],
  );
  const handleToggleLocalScope = useCallback((scope: string) => {
    setExpandedLocalScopes((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) {
        next.delete(scope);
      } else {
        next.add(scope);
      }
      return next;
    });
  }, [setExpandedLocalScopes]);

  const handleToggleRemoteScope = useCallback((scope: string) => {
    setExpandedRemoteScopes((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) {
        next.delete(scope);
      } else {
        next.add(scope);
      }
      return next;
    });
  }, [setExpandedRemoteScopes]);

  const handleCheckoutBranch = useCallback(
    async (name: string) => {
      if (!workspaceId) {
        return;
      }
      await runOperation("checkout", async () => {
        await checkoutGitBranch(workspaceId, name);
        setSelectedBranch(name);
      });
    },
    [checkoutGitBranch, runOperation, setSelectedBranch, workspaceId],
  );

  const handleCreateBranch = useCallback((sourceBranch?: string | null) => {
    if (!workspaceId || operationLoading) {
      return;
    }
    const source = sourceBranch?.trim() ?? "";
    const defaultSource = source
      || (currentBranch && createBranchSourceOptions.includes(currentBranch) ? currentBranch : null)
      || createBranchSourceOptions[0]
      || "";
    setCreateBranchSource(defaultSource);
    setCreateBranchName(t("git.historyPromptNewBranchDefault"));
    closeBranchContextMenu();
    setCreateBranchDialogOpen(true);
  }, [
    closeBranchContextMenu,
    createBranchSourceOptions,
    currentBranch,
    operationLoading,
    setCreateBranchDialogOpen,
    setCreateBranchName,
    setCreateBranchSource,
    t,
    workspaceId,
  ]);

  const handleCreateBranchConfirm = useCallback(async () => {
    if (!workspaceId) {
      return;
    }
    const source = createBranchSource.trim();
    const target = createBranchName.trim();
    if (!source || !target || operationLoading) {
      return;
    }
    await runOperation("createBranch", async () => {
      await createGitBranchFromBranch(workspaceId, target, source);
      setSelectedBranch(target);
      setCreateBranchDialogOpen(false);
      setCreateBranchName("");
      setCreateBranchSource("");
    });
  }, [
    createBranchName,
    createBranchSource,
    createGitBranchFromBranch,
    operationLoading,
    runOperation,
    setCreateBranchDialogOpen,
    setCreateBranchName,
    setCreateBranchSource,
    setSelectedBranch,
    workspaceId,
  ]);

  const applyCreatePrDefaults = useCallback((defaults: GitPrWorkflowDefaults) => {
    setCreatePrDefaults(defaults);
    setCreatePrForm({
      upstreamRepo: defaults.upstreamRepo,
      baseBranch: defaults.baseBranch,
      headOwner: defaults.headOwner,
      headBranch: defaults.headBranch,
      title: defaults.title,
      body: defaults.body,
      commentAfterCreate: true,
      commentBody: defaults.commentBody,
    });
  }, [setCreatePrDefaults, setCreatePrForm]);

  const handleCreatePrHeadRepositoryChange = useCallback((nextRepository: string) => {
    const { owner } = splitGitHubRepo(nextRepository);
    setCreatePrForm((previous) => ({
      ...previous,
      headOwner: owner || nextRepository.trim(),
    }));
  }, [setCreatePrForm, splitGitHubRepo]);

  const loadCreatePrCommitPreview = useCallback(async () => {
    if (!workspaceId || !createPrDialogOpen) {
      return;
    }
    if (!createPrPreviewHeadRef || !createPrPreviewBaseRef) {
      createPrPreviewLoadTokenRef.current += 1;
      createPrPreviewDetailsLoadTokenRef.current += 1;
      setCreatePrPreviewLoading(false);
      setCreatePrPreviewError(null);
      setCreatePrPreviewCommits([]);
      setCreatePrPreviewBaseOnlyCount(0);
      setCreatePrPreviewSelectedSha(null);
      setCreatePrPreviewDetails(null);
      setCreatePrPreviewDetailsLoading(false);
      setCreatePrPreviewDetailsError(null);
      return;
    }
    const loadToken = createPrPreviewLoadTokenRef.current + 1;
    createPrPreviewLoadTokenRef.current = loadToken;
    setCreatePrPreviewLoading(true);
    setCreatePrPreviewError(null);
    try {
      const commitSets = await getGitBranchCompareCommits(
        workspaceId,
        createPrPreviewHeadRef,
        createPrPreviewBaseRef,
        CREATE_PR_PREVIEW_COMMIT_LIMIT,
      );
      if (loadToken !== createPrPreviewLoadTokenRef.current) {
        return;
      }
      setCreatePrPreviewCommits(commitSets.targetOnlyCommits);
      setCreatePrPreviewBaseOnlyCount(commitSets.currentOnlyCommits.length);
      setCreatePrPreviewSelectedSha((previous) => {
        if (previous && commitSets.targetOnlyCommits.some((entry) => entry.sha === previous)) {
          return previous;
        }
        return commitSets.targetOnlyCommits[0]?.sha ?? null;
      });
    } catch (error) {
      if (loadToken !== createPrPreviewLoadTokenRef.current) {
        return;
      }
      const raw = error instanceof Error ? error.message : String(error);
      setCreatePrPreviewError(localizeKnownGitError(raw) ?? raw);
      setCreatePrPreviewCommits([]);
      setCreatePrPreviewBaseOnlyCount(0);
      setCreatePrPreviewSelectedSha(null);
      setCreatePrPreviewDetails(null);
      setCreatePrPreviewDetailsLoading(false);
      setCreatePrPreviewDetailsError(null);
    } finally {
      if (loadToken === createPrPreviewLoadTokenRef.current) {
        setCreatePrPreviewLoading(false);
      }
    }
  }, [
    CREATE_PR_PREVIEW_COMMIT_LIMIT,
    createPrDialogOpen,
    createPrPreviewBaseRef,
    createPrPreviewDetailsLoadTokenRef,
    createPrPreviewHeadRef,
    createPrPreviewLoadTokenRef,
    getGitBranchCompareCommits,
    localizeKnownGitError,
    setCreatePrPreviewBaseOnlyCount,
    setCreatePrPreviewCommits,
    setCreatePrPreviewDetails,
    setCreatePrPreviewDetailsError,
    setCreatePrPreviewDetailsLoading,
    setCreatePrPreviewError,
    setCreatePrPreviewLoading,
    setCreatePrPreviewSelectedSha,
    workspaceId,
  ]);

  useEffect(() => {
    if (!createPrDialogOpen || !workspaceId) {
      return;
    }
    const timer = window.setTimeout(() => {
      void loadCreatePrCommitPreview();
    }, 300);
    return () => {
      window.clearTimeout(timer);
    };
  }, [
    createPrDialogOpen,
    createPrForm.baseBranch,
    createPrForm.headBranch,
    createPrPreviewBaseRemoteName,
    loadCreatePrCommitPreview,
    workspaceId,
  ]);

  useEffect(() => {
    if (!createPrDialogOpen || !workspaceId || !createPrPreviewSelectedSha) {
      createPrPreviewDetailsLoadTokenRef.current += 1;
      setCreatePrPreviewDetails(null);
      setCreatePrPreviewDetailsLoading(false);
      setCreatePrPreviewDetailsError(null);
      return;
    }
    const cached = createPrPreviewDetailsCacheRef.current.get(createPrPreviewSelectedSha);
    if (cached) {
      setCreatePrPreviewDetails(cached);
      setCreatePrPreviewDetailsLoading(false);
      setCreatePrPreviewDetailsError(null);
      return;
    }
    const loadToken = createPrPreviewDetailsLoadTokenRef.current + 1;
    createPrPreviewDetailsLoadTokenRef.current = loadToken;
    setCreatePrPreviewDetailsLoading(true);
    setCreatePrPreviewDetailsError(null);
    void getGitCommitDetails(workspaceId, createPrPreviewSelectedSha)
      .then((response) => {
        if (loadToken !== createPrPreviewDetailsLoadTokenRef.current) {
          return;
        }
        createPrPreviewDetailsCacheRef.current.set(createPrPreviewSelectedSha, response);
        setCreatePrPreviewDetails(response);
      })
      .catch((error) => {
        if (loadToken !== createPrPreviewDetailsLoadTokenRef.current) {
          return;
        }
        const raw = error instanceof Error ? error.message : String(error);
        setCreatePrPreviewDetails(null);
        setCreatePrPreviewDetailsError(localizeKnownGitError(raw) ?? raw);
      })
      .finally(() => {
        if (loadToken === createPrPreviewDetailsLoadTokenRef.current) {
          setCreatePrPreviewDetailsLoading(false);
        }
      });
  }, [
    createPrDialogOpen,
    createPrPreviewDetailsCacheRef,
    createPrPreviewDetailsLoadTokenRef,
    createPrPreviewSelectedSha,
    getGitCommitDetails,
    localizeKnownGitError,
    setCreatePrPreviewDetails,
    setCreatePrPreviewDetailsError,
    setCreatePrPreviewDetailsLoading,
    workspaceId,
  ]);

  const handleOpenCreatePrDialog = useCallback(() => {
    if (!workspaceId || !createPrCanOpen) {
      return;
    }
    createPrPreviewLoadTokenRef.current += 1;
    createPrPreviewDetailsLoadTokenRef.current += 1;
    createPrPreviewDetailsCacheRef.current.clear();
    setCreatePrDialogOpen(true);
    setIsCreatePrDialogMaximized(false);
    setCreatePrDefaultsLoading(true);
    setCreatePrDefaultsError(null);
    setCreatePrDefaults(null);
    setCreatePrResult(null);
    setCreatePrCopiedPrUrl(false);
    setCreatePrCopiedRetryCommand(false);
    setCreatePrPreviewLoading(false);
    setCreatePrPreviewError(null);
    setCreatePrPreviewCommits([]);
    setCreatePrPreviewBaseOnlyCount(0);
    setCreatePrPreviewSelectedSha(null);
    setCreatePrPreviewExpanded(false);
    setCreatePrPreviewDetails(null);
    setCreatePrPreviewDetailsLoading(false);
    setCreatePrPreviewDetailsError(null);
    setCreatePrStages(buildCreatePrInitialStages(t));
    void getGitPrWorkflowDefaults(workspaceId)
      .then((defaults) => {
        applyCreatePrDefaults(defaults);
        if (!defaults.canCreate && defaults.disabledReason) {
          setCreatePrDefaultsError(defaults.disabledReason);
        }
      })
      .catch((error) => {
        setCreatePrDefaultsError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        setCreatePrDefaultsLoading(false);
      });
  }, [
    applyCreatePrDefaults,
    buildCreatePrInitialStages,
    createPrCanOpen,
    createPrPreviewDetailsCacheRef,
    createPrPreviewDetailsLoadTokenRef,
    createPrPreviewLoadTokenRef,
    getGitPrWorkflowDefaults,
    setCreatePrCopiedPrUrl,
    setCreatePrCopiedRetryCommand,
    setCreatePrDefaults,
    setCreatePrDefaultsError,
    setCreatePrDefaultsLoading,
    setCreatePrDialogOpen,
    setCreatePrPreviewBaseOnlyCount,
    setCreatePrPreviewCommits,
    setCreatePrPreviewDetails,
    setCreatePrPreviewDetailsError,
    setCreatePrPreviewDetailsLoading,
    setCreatePrPreviewError,
    setCreatePrPreviewExpanded,
    setCreatePrPreviewLoading,
    setCreatePrPreviewSelectedSha,
    setCreatePrResult,
    setCreatePrStages,
    setIsCreatePrDialogMaximized,
    t,
    workspaceId,
  ]);

  const closeCreatePrDialog = useCallback(() => {
    if (createPrSubmitting || createPrDefaultsLoading) {
      return;
    }
    if (createPrProgressTimerRef.current !== null) {
      window.clearInterval(createPrProgressTimerRef.current);
      createPrProgressTimerRef.current = null;
    }
    createPrPreviewLoadTokenRef.current += 1;
    createPrPreviewDetailsLoadTokenRef.current += 1;
    setCreatePrPreviewLoading(false);
    setCreatePrPreviewDetailsLoading(false);
    setCreatePrPreviewExpanded(false);
    setIsCreatePrDialogMaximized(false);
    setCreatePrDialogOpen(false);
  }, [
    createPrDefaultsLoading,
    createPrPreviewDetailsLoadTokenRef,
    createPrPreviewLoadTokenRef,
    createPrProgressTimerRef,
    createPrSubmitting,
    setCreatePrDialogOpen,
    setCreatePrPreviewDetailsLoading,
    setCreatePrPreviewExpanded,
    setCreatePrPreviewLoading,
    setIsCreatePrDialogMaximized,
  ]);

  const handleCopyCreatePrUrl = useCallback(async () => {
    const url = createPrResult?.prUrl?.trim();
    if (!url) {
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCreatePrCopiedPrUrl(true);
      window.setTimeout(() => setCreatePrCopiedPrUrl(false), 1200);
    } catch {
      setCreatePrCopiedPrUrl(false);
    }
  }, [createPrResult?.prUrl, setCreatePrCopiedPrUrl]);

  const handleCopyCreatePrRetryCommand = useCallback(async () => {
    const retryCommand = createPrResult?.retryCommand?.trim();
    if (!retryCommand) {
      return;
    }
    try {
      await navigator.clipboard.writeText(retryCommand);
      setCreatePrCopiedRetryCommand(true);
      window.setTimeout(() => setCreatePrCopiedRetryCommand(false), 1200);
    } catch {
      setCreatePrCopiedRetryCommand(false);
    }
  }, [createPrResult?.retryCommand, setCreatePrCopiedRetryCommand]);

  const handleConfirmCreatePr = useCallback(async () => {
    if (!workspaceId || !createPrCanConfirm || createPrSubmitting) {
      return;
    }
    const initialStages = buildCreatePrInitialStages(t);
    setCreatePrResult(null);
    setCreatePrCopiedPrUrl(false);
    setCreatePrCopiedRetryCommand(false);
    setCreatePrStages(
      initialStages.map((stage, index) =>
        index === 0
          ? { ...stage, status: "running", detail: t("git.historyCreatePrStageRunning") }
          : stage,
      ),
    );
    if (createPrProgressTimerRef.current !== null) {
      window.clearInterval(createPrProgressTimerRef.current);
    }
    createPrProgressTimerRef.current = window.setInterval(() => {
      setCreatePrStages((previous) => {
        const runningIndex = previous.findIndex((stage) => stage.status === "running");
        if (runningIndex < 0 || runningIndex >= previous.length - 1) {
          return previous;
        }
        const next = [...previous];
        const current = next[runningIndex];
        const following = next[runningIndex + 1];
        if (following.status !== "pending") {
          return previous;
        }
        next[runningIndex] = { ...current, status: "success", detail: t("git.historyCreatePrStagePending") };
        next[runningIndex + 1] = {
          ...following,
          status: "running",
          detail: t("git.historyCreatePrStageRunning"),
        };
        return next;
      });
    }, 800);

    clearOperationNotice();
    setOperationLoading("createPr");
    try {
      const workflowResult = await createGitPrWorkflow(workspaceId, {
        upstreamRepo: createPrForm.upstreamRepo.trim(),
        baseBranch: createPrForm.baseBranch.trim(),
        headOwner: createPrForm.headOwner.trim(),
        headBranch: createPrForm.headBranch.trim(),
        title: createPrForm.title.trim(),
        body: createPrForm.body.trim(),
        commentAfterCreate: createPrForm.commentAfterCreate,
        commentBody: createPrForm.commentBody.trim(),
      });
      setCreatePrResult(workflowResult);
      setCreatePrStages(mapCreatePrStagesFromResult(t, workflowResult.stages));
      if (workflowResult.ok) {
        showOperationNotice({
          kind: "success",
          message: t("git.historyOperationSucceeded", {
            operation: t("git.historyOperationCreatePr"),
          }),
        });
      } else {
        showOperationNotice({
          kind: "error",
          message: `${t("git.historyOperationFailed", {
            operation: t("git.historyOperationCreatePr"),
          })} ${workflowResult.message} ${t("git.historyOperationRetryHint")}`,
          debugMessage: workflowResult.message,
        });
      }
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      setCreatePrResult({
        ok: false,
        status: "failed",
        message: rawMessage,
        stages: [],
      });
      setCreatePrStages((previous) =>
        previous.map((stage, index) =>
          index === 0
            ? { ...stage, status: "failed", detail: rawMessage }
            : stage.status === "running"
              ? { ...stage, status: "failed", detail: rawMessage }
              : stage,
        ),
      );
      showOperationNotice({
        kind: "error",
        message: `${t("git.historyOperationFailed", {
          operation: t("git.historyOperationCreatePr"),
        })} ${rawMessage} ${t("git.historyOperationRetryHint")}`,
        debugMessage: rawMessage,
      });
    } finally {
      if (createPrProgressTimerRef.current !== null) {
        window.clearInterval(createPrProgressTimerRef.current);
        createPrProgressTimerRef.current = null;
      }
      setOperationLoading(null);
    }
  }, [
    buildCreatePrInitialStages,
    clearOperationNotice,
    createGitPrWorkflow,
    createPrCanConfirm,
    createPrForm.baseBranch,
    createPrForm.body,
    createPrForm.commentAfterCreate,
    createPrForm.commentBody,
    createPrForm.headBranch,
    createPrForm.headOwner,
    createPrForm.title,
    createPrForm.upstreamRepo,
    createPrProgressTimerRef,
    createPrSubmitting,
    mapCreatePrStagesFromResult,
    setCreatePrCopiedPrUrl,
    setCreatePrCopiedRetryCommand,
    setCreatePrResult,
    setCreatePrStages,
    setOperationLoading,
    showOperationNotice,
    t,
    workspaceId,
  ]);

  const handleOpenPullDialog = useCallback(() => {
    if (operationLoading) {
      return;
    }
    const defaultRemote = pullRemoteOptions.includes("origin")
      ? "origin"
      : pullRemoteOptions[0] ?? "origin";
    const defaultTargetOptions = resolvePushTargetBranchOptions(defaultRemote);
    const defaultTargetBranch =
      (currentBranch && defaultTargetOptions.includes(currentBranch) ? currentBranch : null) ??
      defaultTargetOptions[0] ??
      currentBranch ??
      "";
    setPullRemote(defaultRemote);
    setPullTargetBranch(defaultTargetBranch);
    setPullTargetBranchQuery("");
    setPullStrategy(null);
    setPullNoCommit(false);
    setPullNoVerify(false);
    setPullRemoteMenuOpen(false);
    setPullRemoteMenuPlacement("up");
    setPullOptionsMenuOpen(false);
    setPullTargetBranchMenuOpen(false);
    setPullTargetBranchMenuPlacement("down");
    setPullDialogOpen(true);
  }, [
    currentBranch,
    operationLoading,
    pullRemoteOptions,
    resolvePushTargetBranchOptions,
    setPullDialogOpen,
    setPullNoCommit,
    setPullNoVerify,
    setPullOptionsMenuOpen,
    setPullRemote,
    setPullRemoteMenuOpen,
    setPullRemoteMenuPlacement,
    setPullStrategy,
    setPullTargetBranch,
    setPullTargetBranchMenuOpen,
    setPullTargetBranchMenuPlacement,
    setPullTargetBranchQuery,
  ]);

  const handleSelectPullTargetBranch = useCallback((branchName: string) => {
    setPullTargetBranch(branchName);
    setPullTargetBranchQuery("");
    setPullTargetBranchMenuOpen(false);
  }, [setPullTargetBranch, setPullTargetBranchMenuOpen, setPullTargetBranchQuery]);

  const handleSelectPullRemote = useCallback(
    (remoteName: string) => {
      const normalizedRemote = remoteName.trim();
      if (!normalizedRemote) {
        return;
      }
      setPullRemote(normalizedRemote);
      setPullRemoteMenuOpen(false);
      setPullTargetBranchMenuOpen(false);
      setPullTargetBranchQuery("");
      const targetOptions = resolvePushTargetBranchOptions(normalizedRemote);
      setPullTargetBranch((previousValue) => {
        const normalizedPrevious = previousValue.trim();
        if (!targetOptions.length || targetOptions.includes(normalizedPrevious)) {
          return normalizedPrevious;
        }
        return targetOptions[0] ?? normalizedPrevious;
      });
    },
    [
      resolvePushTargetBranchOptions,
      setPullRemote,
      setPullRemoteMenuOpen,
      setPullTargetBranch,
      setPullTargetBranchMenuOpen,
      setPullTargetBranchQuery,
    ],
  );

  const handleConfirmPull = useCallback(async () => {
    if (!workspaceId || operationLoading) {
      return;
    }
    const remote = pullRemote.trim();
    const branch = pullTargetBranch.trim();
    setPullDialogOpen(false);
    await runOperation("pull", () =>
      pullGit(workspaceId, {
        remote: remote || null,
        branch: branch || null,
        strategy: pullStrategy,
        noCommit: pullNoCommit,
        noVerify: pullNoVerify,
      }),
    );
  }, [
    operationLoading,
    pullGit,
    pullNoCommit,
    pullNoVerify,
    pullRemote,
    pullStrategy,
    pullTargetBranch,
    runOperation,
    setPullDialogOpen,
    workspaceId,
  ]);

  const handleOpenSyncDialog = useCallback(() => {
    if (operationLoading) {
      return;
    }
    const target = resolveUpstreamTarget(currentLocalBranchEntry?.upstream);
    setSyncPreviewTargetRemote(target.remote);
    setSyncPreviewTargetBranch(target.branch);
    setSyncPreviewError(null);
    setSyncPreviewCommits([]);
    setSyncPreviewTargetFound(true);
    setSyncDialogOpen(true);
  }, [
    currentLocalBranchEntry?.upstream,
    operationLoading,
    resolveUpstreamTarget,
    setSyncDialogOpen,
    setSyncPreviewCommits,
    setSyncPreviewError,
    setSyncPreviewTargetBranch,
    setSyncPreviewTargetFound,
    setSyncPreviewTargetRemote,
  ]);

  const handleConfirmSync = useCallback(async () => {
    if (!workspaceId || operationLoading) {
      return;
    }
    setSyncDialogOpen(false);
    await runOperation("sync", () => syncGit(workspaceId));
  }, [operationLoading, runOperation, setSyncDialogOpen, syncGit, workspaceId]);

  const handleOpenFetchDialog = useCallback(() => {
    if (operationLoading) {
      return;
    }
    setFetchDialogOpen(true);
  }, [operationLoading, setFetchDialogOpen]);

  const handleConfirmFetch = useCallback(async () => {
    if (!workspaceId || operationLoading) {
      return;
    }
    setFetchDialogOpen(false);
    await runOperation("fetch", () => fetchGit(workspaceId));
  }, [fetchGit, operationLoading, runOperation, setFetchDialogOpen, workspaceId]);

  const handleOpenRefreshDialog = useCallback(() => {
    if (operationLoading || historyLoading) {
      return;
    }
    setRefreshDialogOpen(true);
  }, [historyLoading, operationLoading, setRefreshDialogOpen]);

  const handleConfirmRefresh = useCallback(async () => {
    if (operationLoading || historyLoading) {
      return;
    }
    setRefreshDialogOpen(false);
    await runOperation("refresh", refreshAll);
  }, [historyLoading, operationLoading, refreshAll, runOperation, setRefreshDialogOpen]);

  const handleSelectPushRemote = useCallback(
    (remoteName: string) => {
      const normalizedRemote = remoteName.trim();
      if (!normalizedRemote) {
        return;
      }
      setPushRemote(normalizedRemote);
      setPushRemoteMenuOpen(false);
      setPushTargetBranchMenuOpen(false);
      setPushTargetBranchQuery("");
      const targetOptions = resolvePushTargetBranchOptions(normalizedRemote);
      setPushTargetBranch((previousValue) => {
        const normalizedPrevious = previousValue.trim();
        if (normalizedPrevious && (targetOptions.includes(normalizedPrevious) || !targetOptions.length)) {
          return normalizedPrevious;
        }
        if (currentBranch && targetOptions.includes(currentBranch)) {
          return currentBranch;
        }
        return targetOptions[0] ?? normalizedPrevious;
      });
    },
    [
      currentBranch,
      resolvePushTargetBranchOptions,
      setPushRemote,
      setPushRemoteMenuOpen,
      setPushTargetBranch,
      setPushTargetBranchMenuOpen,
      setPushTargetBranchQuery,
    ],
  );

  const handleSelectPushTargetBranch = useCallback((branchName: string) => {
    setPushTargetBranch(branchName);
    setPushTargetBranchQuery("");
    setPushTargetBranchMenuOpen(false);
  }, [setPushTargetBranch, setPushTargetBranchMenuOpen, setPushTargetBranchQuery]);

  const handleOpenPushDialog = useCallback(() => {
    if (operationLoading) {
      return;
    }
    const defaultRemote = pushRemoteOptions.includes("origin")
      ? "origin"
      : pushRemoteOptions[0] ?? "origin";
    const defaultTargetOptions = resolvePushTargetBranchOptions(defaultRemote);
    const defaultTargetBranch =
      (currentBranch && defaultTargetOptions.includes(currentBranch) ? currentBranch : null) ??
      defaultTargetOptions[0] ??
      currentBranch ??
      "";
    setPushRemote(defaultRemote);
    setPushTargetBranch(defaultTargetBranch);
    setPushTargetBranchQuery("");
    setPushTags(false);
    setPushRunHooks(true);
    setPushForceWithLease(false);
    setPushToGerrit(false);
    setPushTopic("");
    setPushReviewers("");
    setPushCc("");
    setPushRemoteMenuOpen(false);
    setPushTargetBranchMenuOpen(false);
    setPushTargetBranchMenuPlacement("down");
    setPushDialogOpen(true);
  }, [
    currentBranch,
    operationLoading,
    pushRemoteOptions,
    resolvePushTargetBranchOptions,
    setPushCc,
    setPushDialogOpen,
    setPushForceWithLease,
    setPushRemote,
    setPushRemoteMenuOpen,
    setPushReviewers,
    setPushRunHooks,
    setPushTags,
    setPushTargetBranch,
    setPushTargetBranchMenuOpen,
    setPushTargetBranchMenuPlacement,
    setPushTargetBranchQuery,
    setPushToGerrit,
    setPushTopic,
  ]);

  const loadPushPreview = useCallback(
    async (remoteName: string, targetBranchName: string) => {
      if (!workspaceId) {
        return;
      }
      const requestToken = pushPreviewLoadTokenRef.current + 1;
      pushPreviewLoadTokenRef.current = requestToken;
      setPushPreviewLoading(true);
      setPushPreviewError(null);
      try {
        const response = await getGitPushPreview(workspaceId, {
          remote: remoteName,
          branch: targetBranchName,
          limit: 120,
        });
        if (requestToken !== pushPreviewLoadTokenRef.current) {
          return;
        }
        setPushPreviewTargetFound(response.targetFound);
        setPushPreviewHasMore(response.hasMore);
        setPushPreviewCommits(response.commits);
        setPushPreviewSelectedSha((previousSha) => {
          if (!response.targetFound) {
            return null;
          }
          if (previousSha && response.commits.some((entry) => entry.sha === previousSha)) {
            return previousSha;
          }
          return response.commits[0]?.sha ?? null;
        });
        if (!response.targetFound || !response.commits.length) {
          pushPreviewDetailsLoadTokenRef.current += 1;
          setPushPreviewDetails(null);
          setPushPreviewDetailsError(null);
          setPushPreviewDetailsLoading(false);
        }
      } catch (error) {
        if (requestToken !== pushPreviewLoadTokenRef.current) {
          return;
        }
        pushPreviewDetailsLoadTokenRef.current += 1;
        setPushPreviewTargetFound(true);
        setPushPreviewHasMore(false);
        setPushPreviewCommits([]);
        setPushPreviewSelectedSha(null);
        setPushPreviewDetails(null);
        setPushPreviewDetailsLoading(false);
        setPushPreviewDetailsError(null);
        setPushPreviewError(error instanceof Error ? error.message : String(error));
      } finally {
        if (requestToken === pushPreviewLoadTokenRef.current) {
          setPushPreviewLoading(false);
        }
      }
    },
    [
      getGitPushPreview,
      pushPreviewDetailsLoadTokenRef,
      pushPreviewLoadTokenRef,
      setPushPreviewCommits,
      setPushPreviewDetails,
      setPushPreviewDetailsError,
      setPushPreviewDetailsLoading,
      setPushPreviewError,
      setPushPreviewHasMore,
      setPushPreviewLoading,
      setPushPreviewSelectedSha,
      setPushPreviewTargetFound,
      workspaceId,
    ],
  );

  useEffect(() => {
    if (!pushDialogOpen) {
      return;
    }
    if (!workspaceId || !pushRemoteTrimmed || !pushTargetBranchTrimmed) {
      pushPreviewLoadTokenRef.current += 1;
      pushPreviewDetailsLoadTokenRef.current += 1;
      setPushPreviewLoading(false);
      setPushPreviewError(null);
      setPushPreviewTargetFound(true);
      setPushPreviewHasMore(false);
      setPushPreviewCommits([]);
      setPushPreviewSelectedSha(null);
      setPushPreviewDetails(null);
      setPushPreviewDetailsLoading(false);
      setPushPreviewDetailsError(null);
      return;
    }
    const timer = window.setTimeout(() => {
      void loadPushPreview(pushRemoteTrimmed, pushTargetBranchTrimmed);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [
    loadPushPreview,
    pushDialogOpen,
    pushPreviewDetailsLoadTokenRef,
    pushPreviewLoadTokenRef,
    pushRemoteTrimmed,
    setPushPreviewCommits,
    setPushPreviewDetails,
    setPushPreviewDetailsError,
    setPushPreviewDetailsLoading,
    setPushPreviewError,
    setPushPreviewHasMore,
    setPushPreviewLoading,
    setPushPreviewSelectedSha,
    setPushPreviewTargetFound,
    pushTargetBranchTrimmed,
    workspaceId,
  ]);

  useEffect(() => {
    if (!pushDialogOpen || !workspaceId || !pushPreviewSelectedSha) {
      pushPreviewDetailsLoadTokenRef.current += 1;
      setPushPreviewDetails(null);
      setPushPreviewDetailsLoading(false);
      setPushPreviewDetailsError(null);
      return;
    }
    const requestToken = pushPreviewDetailsLoadTokenRef.current + 1;
    pushPreviewDetailsLoadTokenRef.current = requestToken;
    setPushPreviewDetailsLoading(true);
    setPushPreviewDetailsError(null);
    void getGitCommitDetails(workspaceId, pushPreviewSelectedSha)
      .then((response) => {
        if (requestToken !== pushPreviewDetailsLoadTokenRef.current) {
          return;
        }
        setPushPreviewDetails(response);
      })
      .catch((error) => {
        if (requestToken !== pushPreviewDetailsLoadTokenRef.current) {
          return;
        }
        setPushPreviewDetails(null);
        setPushPreviewDetailsError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (requestToken === pushPreviewDetailsLoadTokenRef.current) {
          setPushPreviewDetailsLoading(false);
        }
      });
  }, [
    getGitCommitDetails,
    pushDialogOpen,
    pushPreviewDetailsLoadTokenRef,
    pushPreviewSelectedSha,
    setPushPreviewDetails,
    setPushPreviewDetailsError,
    setPushPreviewDetailsLoading,
    workspaceId,
  ]);

  useEffect(() => {
    if (!syncDialogOpen || !workspaceId) {
      return;
    }
    if (!syncPreviewTargetRemote || !syncPreviewTargetBranch) {
      setSyncPreviewError(null);
      setSyncPreviewCommits([]);
      setSyncPreviewTargetFound(true);
      return;
    }
    let isCancelled = false;
    setSyncPreviewLoading(true);
    setSyncPreviewError(null);
    void getGitPushPreview(workspaceId, {
      remote: syncPreviewTargetRemote,
      branch: syncPreviewTargetBranch,
      limit: 5,
    })
      .then((response) => {
        if (isCancelled) {
          return;
        }
        setSyncPreviewTargetFound(response.targetFound);
        setSyncPreviewCommits(response.commits);
      })
      .catch((error) => {
        if (isCancelled) {
          return;
        }
        setSyncPreviewTargetFound(true);
        setSyncPreviewCommits([]);
        setSyncPreviewError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!isCancelled) {
          setSyncPreviewLoading(false);
        }
      });
    return () => {
      isCancelled = true;
    };
  }, [
    getGitPushPreview,
    setSyncPreviewCommits,
    setSyncPreviewError,
    setSyncPreviewLoading,
    setSyncPreviewTargetFound,
    syncDialogOpen,
    syncPreviewTargetBranch,
    syncPreviewTargetRemote,
    workspaceId,
  ]);

  const handleConfirmPush = useCallback(async () => {
    if (!workspaceId || !pushCanConfirm) {
      return;
    }
    setPushRemoteMenuOpen(false);
    setPushTargetBranchMenuOpen(false);
    setPushDialogOpen(false);
    await runOperation("push", () =>
      pushGit(workspaceId, {
        remote: pushRemoteTrimmed,
        branch: pushTargetBranchTrimmed,
        forceWithLease: pushForceWithLease,
        pushTags,
        runHooks: pushRunHooks,
        pushToGerrit,
        topic: pushToGerrit ? pushTopic.trim() : null,
        reviewers: pushToGerrit ? pushReviewers.trim() : null,
        cc: pushToGerrit ? pushCc.trim() : null,
      }),
    );
  }, [
    pushCanConfirm,
    pushCc,
    pushForceWithLease,
    pushGit,
    pushRemoteTrimmed,
    pushReviewers,
    pushRunHooks,
    pushTags,
    pushTargetBranchTrimmed,
    pushToGerrit,
    pushTopic,
    runOperation,
    setPushDialogOpen,
    setPushRemoteMenuOpen,
    setPushTargetBranchMenuOpen,
    workspaceId,
  ]);

  const handleCreateBranchFromCommit = useCallback(async (commitSha?: string | null) => {
    const targetSha = commitSha ?? selectedCommitSha;
    if (!workspaceId || !targetSha) {
      return;
    }
    const suggested = `feature/commit-${targetSha.slice(0, 7)}`;
    const name = window.prompt(t("git.historyPromptBranchFromCommitName"), suggested);
    if (!name || !name.trim()) {
      return;
    }
    await runOperation("createFromCommit", async () => {
      const trimmed = name.trim();
      await createGitBranchFromCommit(workspaceId, trimmed, targetSha);
      setSelectedBranch(trimmed);
    });
  }, [createGitBranchFromCommit, runOperation, selectedCommitSha, setSelectedBranch, t, workspaceId]);

  const handleDeleteBranch = useCallback(async (targetBranch?: string | null) => {
    const branchName = targetBranch ?? selectedBranch;
    if (!workspaceId || !branchName || branchName === "all") {
      return;
    }
    const confirmed = await ask(t("git.historyConfirmDeleteBranch", { branch: branchName }), {
      title: t("git.historyTitleDeleteBranch"),
      kind: "warning",
    });
    if (!confirmed) {
      return;
    }
    closeBranchContextMenu();
    const operationName = "deleteBranch";
    const showDeleteFailure = (rawMessage: string) => {
      const operationState = createOperationErrorState(rawMessage);
      showOperationNotice({
        kind: "error",
        message: `${t("git.historyOperationFailed", {
          operation: getOperationDisplayName(operationName),
        })} ${operationState.userMessage}${
          operationState.retryable ? ` ${t("git.historyOperationRetryHint")}` : ""
        }`,
        debugMessage: operationState.debugMessage,
      });
    };
    const runForceDelete = async () => {
      await deleteGitBranch(workspaceId, branchName, {
        force: true,
        removeOccupiedWorktree: true,
      });
      setSelectedBranch(currentBranch ?? "all");
      await refreshAll();
      showOperationNotice({
        kind: "success",
        message: t("git.historyOperationSucceeded", {
          operation: getOperationDisplayName(operationName),
        }),
      });
    };
    clearOperationNotice();
    setOperationLoading(operationName);
    try {
      await deleteGitBranch(workspaceId, branchName);
      setSelectedBranch(currentBranch ?? "all");
      await refreshAll();
      showOperationNotice({
        kind: "success",
        message: t("git.historyOperationSucceeded", {
          operation: getOperationDisplayName(operationName),
        }),
      });
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      if (isBranchDeleteNotFullyMergedError(rawMessage)) {
        const forceConfirmed = await promptForceDeleteDialog(
          "notMerged",
          branchName,
          null,
        );
        if (forceConfirmed) {
          try {
            await runForceDelete();
            return;
          } catch (forceError) {
            showDeleteFailure(
              forceError instanceof Error ? forceError.message : String(forceError),
            );
            return;
          }
        }
      } else if (isBranchDeleteUsedByWorktreeError(rawMessage)) {
        const forceConfirmed = await promptForceDeleteDialog(
          "worktreeOccupied",
          branchName,
          extractWorktreePathFromDeleteError(rawMessage),
        );
        if (forceConfirmed) {
          try {
            await runForceDelete();
            return;
          } catch (forceError) {
            showDeleteFailure(
              forceError instanceof Error ? forceError.message : String(forceError),
            );
            return;
          }
        }
      }
      showDeleteFailure(rawMessage);
    } finally {
      setOperationLoading(null);
    }
  }, [
    ask,
    clearOperationNotice,
    closeBranchContextMenu,
    createOperationErrorState,
    currentBranch,
    deleteGitBranch,
    getOperationDisplayName,
    isBranchDeleteNotFullyMergedError,
    isBranchDeleteUsedByWorktreeError,
    extractWorktreePathFromDeleteError,
    promptForceDeleteDialog,
    refreshAll,
    selectedBranch,
    setOperationLoading,
    setSelectedBranch,
    showOperationNotice,
    t,
    workspaceId,
  ]);

  const handleOpenRenameBranchDialog = useCallback((targetBranch?: string | null) => {
    const branchNameCandidate = targetBranch ?? (selectedBranch === "all" ? currentBranch : selectedBranch);
    const branchName = branchNameCandidate?.trim();
    if (!workspaceId || operationLoading || !branchName) {
      return;
    }
    if (!localBranches.some((entry) => entry.name === branchName)) {
      return;
    }
    setRenameBranchSource(branchName);
    setRenameBranchName(branchName);
    closeBranchContextMenu();
    setRenameBranchDialogOpen(true);
  }, [
    closeBranchContextMenu,
    currentBranch,
    localBranches,
    operationLoading,
    selectedBranch,
    setRenameBranchDialogOpen,
    setRenameBranchName,
    setRenameBranchSource,
    workspaceId,
  ]);

  const closeRenameBranchDialog = useCallback(() => {
    if (renameBranchSubmitting) {
      return;
    }
    setRenameBranchDialogOpen(false);
  }, [renameBranchSubmitting, setRenameBranchDialogOpen]);

  const handleRenameBranchConfirm = useCallback(async () => {
    if (!workspaceId || !renameBranchCanConfirm) {
      return;
    }
    const source = renameBranchSource.trim();
    const target = renameBranchNameTrimmed;
    if (!source || !target) {
      return;
    }
    await runOperation("renameBranch", async () => {
      await renameGitBranch(workspaceId, source, target);
      setSelectedBranch(target);
      setRenameBranchDialogOpen(false);
      setRenameBranchSource("");
      setRenameBranchName("");
    });
  }, [
    renameBranchCanConfirm,
    renameBranchNameTrimmed,
    renameBranchSource,
    renameGitBranch,
    runOperation,
    setRenameBranchDialogOpen,
    setRenameBranchName,
    setRenameBranchSource,
    setSelectedBranch,
    workspaceId,
  ]);

  const handleMergeBranch = useCallback(async (targetBranch?: string | null) => {
    const branchName = targetBranch ?? selectedBranch;
    if (!workspaceId || !branchName || branchName === "all") {
      return;
    }
    const confirmed = await ask(
      t("git.historyConfirmMergeBranchIntoCurrent", { branch: branchName }),
      {
        title: t("git.historyTitleMergeBranch"),
        kind: "warning",
      },
    );
    if (!confirmed) {
      return;
    }
    closeBranchContextMenu();
    await runOperation("mergeBranch", async () => {
      await mergeGitBranch(workspaceId, branchName);
    });
  }, [ask, closeBranchContextMenu, mergeGitBranch, runOperation, selectedBranch, t, workspaceId]);

  const handleCheckoutAndRebaseCurrent = useCallback(async (targetBranch: string) => {
    if (!workspaceId) {
      return;
    }
    const current = currentBranch;
    if (!current || !targetBranch || targetBranch === current) {
      return;
    }
    const confirmed = await ask(
      t("git.historyConfirmCheckoutAndRebaseCurrent", {
        branch: targetBranch,
        current,
      }),
      {
        title: t("git.historyTitleCheckoutAndRebaseCurrent"),
        kind: "warning",
      },
    );
    if (!confirmed) {
      return;
    }
    closeBranchContextMenu();
    await runOperation("checkoutRebase", async () => {
      await checkoutGitBranch(workspaceId, targetBranch);
      await rebaseGitBranch(workspaceId, current);
      setSelectedBranch(targetBranch);
    });
  }, [
    ask,
    checkoutGitBranch,
    closeBranchContextMenu,
    currentBranch,
    rebaseGitBranch,
    runOperation,
    setSelectedBranch,
    t,
    workspaceId,
  ]);

  const handleRebaseCurrentOntoBranch = useCallback(async (targetBranch: string) => {
    if (!workspaceId) {
      return;
    }
    const current = currentBranch;
    if (!current || !targetBranch || targetBranch === current) {
      return;
    }
    const confirmed = await ask(
      t("git.historyConfirmRebaseCurrentOntoBranch", {
        current,
        branch: targetBranch,
      }),
      {
        title: t("git.historyTitleRebaseCurrentOntoBranch"),
        kind: "warning",
      },
    );
    if (!confirmed) {
      return;
    }
    closeBranchContextMenu();
    await runOperation("rebaseBranch", async () => {
      await rebaseGitBranch(workspaceId, targetBranch);
    });
  }, [ask, closeBranchContextMenu, currentBranch, rebaseGitBranch, runOperation, t, workspaceId]);

  const {
    handleShowDiffWithWorktree,
    handleCompareWithCurrentBranch,
    handleSelectWorktreeDiffFile,
    handleSelectBranchCompareCommit,
  } = useGitHistoryPanelBranchCompareHandlers({
    branchCompareDetailsCacheRef,
    branchDiffCacheRef,
    closeBranchContextMenu,
    currentBranch,
    getGitBranchCompareCommits,
    getGitCommitDetails,
    getGitWorktreeDiffAgainstBranch,
    getGitWorktreeDiffFileAgainstBranch,
    localizeKnownGitError,
    setBranchDiffState,
    setComparePreviewFileKey,
    useCallback,
    workspaceId,
  });

  const handleRevertSelectedCommit = useCallback(async (commitSha?: string | null) => {
    const targetSha = commitSha ?? selectedCommitSha;
    if (!workspaceId || !targetSha) {
      return;
    }
    const confirmed = await ask(
      t("git.historyConfirmRevertCommit", { sha: targetSha.slice(0, 10) }),
      {
        title: t("git.historyTitleRevertCommit"),
        kind: "warning",
      },
    );
    if (!confirmed) {
      return;
    }
    await runOperation("revert", () => revertCommit(workspaceId, targetSha));
  }, [ask, revertCommit, runOperation, selectedCommitSha, t, workspaceId]);

  const handleCherryPickCommit = useCallback(async (commitSha?: string | null) => {
    const targetSha = commitSha ?? selectedCommitSha;
    if (!workspaceId || !targetSha) {
      return;
    }
    await runOperation("cherry-pick", () => cherryPickCommit(workspaceId, targetSha));
  }, [cherryPickCommit, runOperation, selectedCommitSha, workspaceId]);

  const handleCopyCommitRevision = useCallback(
    async (commitSha?: string | null) => {
      const targetSha = commitSha ?? selectedCommitSha;
      if (!targetSha) {
        return;
      }
      try {
        await navigator.clipboard.writeText(targetSha);
        showOperationNotice({
          kind: "success",
          message: t("git.historyOperationSucceeded", {
            operation: t("git.historyCopyRevisionNumber"),
          }),
        });
      } catch (error) {
        const rawMessage = error instanceof Error ? error.message : String(error);
        showOperationNotice({
          kind: "error",
          message: `${t("git.historyOperationFailed", {
            operation: t("git.historyCopyRevisionNumber"),
          })} ${rawMessage}`,
          debugMessage: rawMessage,
        });
      }
    },
    [selectedCommitSha, showOperationNotice, t],
  );

  const handleCopyCommitMessage = useCallback(
    async (commitSha?: string | null) => {
      const targetSha = commitSha ?? selectedCommitSha;
      if (!targetSha) {
        return;
      }
      const targetCommit = commits.find((entry) => entry.sha === targetSha);
      const targetMessage =
        targetCommit?.message
        || (details?.sha === targetSha ? details.message : "")
        || targetCommit?.summary
        || "";
      if (!targetMessage.trim()) {
        return;
      }
      try {
        await navigator.clipboard.writeText(targetMessage);
        showOperationNotice({
          kind: "success",
          message: t("git.historyOperationSucceeded", {
            operation: t("git.historyCopyCommitMessage"),
          }),
        });
      } catch (error) {
        const rawMessage = error instanceof Error ? error.message : String(error);
        showOperationNotice({
          kind: "error",
          message: `${t("git.historyOperationFailed", {
            operation: t("git.historyCopyCommitMessage"),
          })} ${rawMessage}`,
          debugMessage: rawMessage,
        });
      }
    },
    [commits, details, selectedCommitSha, showOperationNotice, t],
  );

  const openResetDialog = useCallback((commitSha?: string | null) => {
    const targetSha = commitSha ?? selectedCommitSha;
    if (!targetSha) {
      return;
    }
    setResetTargetSha(targetSha);
    setResetMode("mixed");
    setResetDialogOpen(true);
  }, [selectedCommitSha, setResetDialogOpen, setResetMode, setResetTargetSha]);

  const handleConfirmResetCommit = useCallback(async () => {
    if (!workspaceId || !resetTargetSha) {
      return;
    }
    if (resetMode === "hard") {
      const confirmed = await ask(
        t("git.historyConfirmHardReset", { sha: resetTargetSha.slice(0, 10) }),
        {
          title: t("git.historyTitleHardReset"),
          kind: "warning",
        },
      );
      if (!confirmed) {
        return;
      }
    }
    setResetDialogOpen(false);
    await runOperation("reset", () => resetGitCommit(workspaceId, resetTargetSha, resetMode));
  }, [ask, resetGitCommit, resetMode, resetTargetSha, runOperation, setResetDialogOpen, t, workspaceId]);

  const handleFileTreeDirToggle = useCallback((path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, [setExpandedDirs]);

  const handlePushPreviewDirToggle = useCallback((path: string) => {
    setPushPreviewExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, [setPushPreviewExpandedDirs]);

  const closeWorktreePreview = useCallback(() => {
    setWorktreePreviewFile(null);
    setWorktreePreviewError(null);
    setWorktreePreviewLoading(false);
  }, [setWorktreePreviewError, setWorktreePreviewFile, setWorktreePreviewLoading]);

  const handleOpenWorktreePreview = useCallback(
    async (path: string) => {
      if (!workspaceId) {
        onOpenDiffPath?.(path);
        return;
      }
      setWorktreePreviewError(null);
      setWorktreePreviewLoading(true);
      setWorktreePreviewFile((current) =>
        current && current.path === path
          ? current
          : {
              path,
              status: "M",
              additions: 0,
              deletions: 0,
              diff: "",
            },
      );
      try {
        const [statusResponse, diffEntries] = await Promise.all([
          getGitStatus(workspaceId),
          getGitDiffs(workspaceId),
        ]);
        const statusFile =
          statusResponse.files.find((entry) => entry.path === path)
          ?? statusResponse.unstagedFiles.find((entry) => entry.path === path)
          ?? statusResponse.stagedFiles.find((entry) => entry.path === path);
        const diffEntry = diffEntries.find((entry) => entry.path === path);
        setWorktreePreviewFile({
          path,
          status: statusFile?.status ?? "M",
          additions: statusFile?.additions ?? 0,
          deletions: statusFile?.deletions ?? 0,
          diff: diffEntry?.diff ?? "",
          isBinary: diffEntry?.isBinary,
          isImage: diffEntry?.isImage,
          oldImageData: diffEntry?.oldImageData ?? null,
          newImageData: diffEntry?.newImageData ?? null,
          oldImageMime: diffEntry?.oldImageMime ?? null,
          newImageMime: diffEntry?.newImageMime ?? null,
        });
      } catch (error) {
        const rawMessage = error instanceof Error ? error.message : String(error);
        setWorktreePreviewError(rawMessage);
        onOpenDiffPath?.(path);
      } finally {
        setWorktreePreviewLoading(false);
      }
    },
    [
      getGitDiffs,
      getGitStatus,
      onOpenDiffPath,
      setWorktreePreviewError,
      setWorktreePreviewFile,
      setWorktreePreviewLoading,
      workspaceId,
    ],
  );

  const resetTargetCommit = useMemo(() => {
    if (!resetTargetSha) {
      return null;
    }
    if (details?.sha === resetTargetSha) {
      return {
        sha: resetTargetSha,
        summary: details.summary || t("git.historyNoMessage"),
        author: details.author || t("git.unknown"),
      };
    }
    const entry = commits.find((item) => item.sha === resetTargetSha);
    if (!entry) {
      return null;
    }
    return {
      sha: resetTargetSha,
      summary: entry.summary || t("git.historyNoMessage"),
      author: entry.author || t("git.unknown"),
    };
  }, [commits, details?.author, details?.sha, details?.summary, resetTargetSha, t]);

  const branchContextTrackingSummary = useMemo(() => {
    if (!branchContextMenu) {
      return null;
    }
    const branchName = branchContextMenu.branch.name;
    const isRemote = branchContextMenu.source === "remote" || branchContextMenu.branch.isRemote;
    if (isRemote) {
      return `${branchName} -> ${branchName}`;
    }
    const upstreamName = branchContextMenu.branch.upstream?.trim();
    const trackingTarget = upstreamName && upstreamName.length > 0
      ? upstreamName
      : `(${t("git.historyBranchMenuNoUpstreamTracking")})`;
    return `${branchName} -> ${trackingTarget}`;
  }, [branchContextMenu, t]);

  const handleUpdateBranchFromContextMenu = useCallback(async (
    targetBranch: string,
    options: {
      isCurrent: boolean;
      isRemote: boolean;
      remoteName: string | null;
      hasUpstream: boolean;
    },
  ) => {
    closeBranchContextMenu();
    if (options.isRemote && options.remoteName) {
      await runOperation("fetch", () => fetchGit(workspaceId, options.remoteName));
      return;
    }
    if (options.isCurrent) {
      await runOperation("pull", () => pullGit(workspaceId));
      return;
    }
    if (!options.hasUpstream) {
      return;
    }

    const operationName = "updateBranch";
    clearOperationNotice();
    setOperationLoading(operationName);
    try {
      const result = await updateGitBranch(workspaceId, targetBranch);
      await refreshAll();
      if (result.status === "blocked") {
        const message = result.reason === "diverged"
          ? t("git.historyBranchUpdateBlockedDiverged", { branch: targetBranch })
          : result.reason === "occupied_worktree"
            ? t("git.historyBranchUpdateBlockedOccupiedWorktree", {
              branch: targetBranch,
              path: result.worktreePath ?? "",
            })
            : result.reason === "stale_ref"
              ? t("git.historyBranchUpdateBlockedStaleRef", { branch: targetBranch })
              : t("git.historyBranchUpdateBlockedNoUpstream", { branch: targetBranch });
        showOperationNotice({
          kind: "error",
          message,
          debugMessage: result.message,
        });
        return;
      }

      const message = result.status === "no-op"
        ? result.reason === "ahead_only"
          ? t("git.historyBranchUpdateAheadOnly", { branch: targetBranch })
          : t("git.historyBranchUpdateAlreadyUpToDate", { branch: targetBranch })
        : t("git.historyBranchUpdateSuccess", { branch: targetBranch });
      showOperationNotice({
        kind: "success",
        message,
        debugMessage: result.message,
      });
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      const operationState = createOperationErrorState(rawMessage);
      showOperationNotice({
        kind: "error",
        message: `${t("git.historyOperationFailed", {
          operation: getOperationDisplayName(operationName),
        })} ${operationState.userMessage}${
          operationState.retryable ? ` ${t("git.historyOperationRetryHint")}` : ""
        }`,
        debugMessage: operationState.debugMessage,
      });
    } finally {
      setOperationLoading(null);
    }
  }, [
    clearOperationNotice,
    closeBranchContextMenu,
    createOperationErrorState,
    fetchGit,
    getOperationDisplayName,
    pullGit,
    refreshAll,
    runOperation,
    setOperationLoading,
    showOperationNotice,
    t,
    updateGitBranch,
    workspaceId,
  ]);

  const branchContextActions = useMemo<BranchContextAction[]>(() => {
    if (!workspaceId || !branchContextMenu) {
      return [];
    }
    const targetBranch = branchContextMenu.branch.name;
    const isCurrent = branchContextMenu.branch.isCurrent || currentBranch === targetBranch;
    const isRemote = branchContextMenu.source === "remote" || branchContextMenu.branch.isRemote;
    const baseDisabledReason = operationLoading ? t("git.historyBranchMenuUnavailableBusy") : null;
    const currentDisabledReason = t("git.historyBranchMenuUnavailableCurrent");
    const remoteDisabledReason = t("git.historyBranchMenuUnavailableRemote");
    const noCurrentBranchDisabledReason = t("git.historyBranchMenuUnavailableNoCurrent");
    const noUpstreamDisabledReason = t("git.historyBranchMenuNoUpstreamTracking");
    const currentBranchName = currentBranch ?? t("git.unknown");
    const remoteName = branchContextMenu.branch.remote ?? null;
    const hasUpstream = Boolean(branchContextMenu.branch.upstream?.trim());

    const createDisabledReason = createBranchSourceOptions.length === 0
      ? baseDisabledReason
      : null;

    return [
      {
        id: "checkout",
        label: t("git.historyBranchMenuCheckout"),
        icon: <GitBranch size={14} aria-hidden />,
        disabled: Boolean(baseDisabledReason || isCurrent),
        disabledReason: baseDisabledReason || (isCurrent ? currentDisabledReason : null),
        onSelect: () => {
          closeBranchContextMenu();
          void handleCheckoutBranch(targetBranch);
        },
      },
      {
        id: "create-branch",
        label: t("git.historyBranchMenuCreateFromBranch", { branch: targetBranch }),
        icon: <Plus size={14} aria-hidden />,
        disabled: Boolean(baseDisabledReason || createDisabledReason),
        disabledReason: baseDisabledReason || createDisabledReason,
        onSelect: () => {
          closeBranchContextMenu();
          handleCreateBranch(targetBranch);
        },
      },
      {
        id: "checkout-rebase",
        label: t("git.historyBranchMenuCheckoutAndRebaseCurrent", { current: currentBranchName }),
        icon: <Repeat size={14} aria-hidden />,
        disabled: Boolean(baseDisabledReason || isCurrent || isRemote || !currentBranch),
        disabledReason:
          baseDisabledReason ||
          (isCurrent
            ? currentDisabledReason
            : isRemote
              ? remoteDisabledReason
              : !currentBranch
                ? noCurrentBranchDisabledReason
                : null),
        onSelect: () => {
          closeBranchContextMenu();
          void handleCheckoutAndRebaseCurrent(targetBranch);
        },
      },
      {
        id: "compare-current",
        label: t("git.historyBranchMenuCompareWithCurrent", { current: currentBranchName }),
        icon: <FileText size={14} aria-hidden />,
        dividerBefore: true,
        disabled: Boolean(baseDisabledReason || isCurrent),
        disabledReason: baseDisabledReason || (isCurrent ? currentDisabledReason : null),
        onSelect: () => {
          void handleCompareWithCurrentBranch(targetBranch);
        },
      },
      {
        id: "diff-worktree",
        label: t("git.historyBranchMenuShowDiffWithWorktree"),
        icon: <FolderTree size={14} aria-hidden />,
        disabled: Boolean(baseDisabledReason),
        disabledReason: baseDisabledReason,
        onSelect: () => {
          void handleShowDiffWithWorktree(targetBranch);
        },
      },
      {
        id: "rebase-current-onto",
        label: t("git.historyBranchMenuRebaseCurrentOnto", {
          current: currentBranchName,
          branch: targetBranch,
        }),
        icon: <RefreshCw size={14} aria-hidden />,
        dividerBefore: true,
        disabled: Boolean(baseDisabledReason || isCurrent || isRemote || !currentBranch),
        disabledReason:
          baseDisabledReason ||
          (isCurrent
            ? currentDisabledReason
            : isRemote
              ? remoteDisabledReason
              : !currentBranch
                ? noCurrentBranchDisabledReason
                : null),
        onSelect: () => {
          closeBranchContextMenu();
          void handleRebaseCurrentOntoBranch(targetBranch);
        },
      },
      {
        id: "merge-into-current",
        label: t("git.historyBranchMenuMergeIntoCurrent", {
          branch: targetBranch,
          current: currentBranchName,
        }),
        icon: <GitMerge size={14} aria-hidden />,
        disabled: Boolean(baseDisabledReason || isCurrent || isRemote),
        disabledReason: baseDisabledReason || (isCurrent ? currentDisabledReason : isRemote ? remoteDisabledReason : null),
        onSelect: () => {
          closeBranchContextMenu();
          void handleMergeBranch(targetBranch);
        },
      },
      {
        id: "update",
        label: t("git.historyBranchMenuUpdate"),
        icon: <Download size={14} aria-hidden />,
        dividerBefore: true,
        disabled: Boolean(baseDisabledReason || (isRemote ? !remoteName : !isCurrent && !hasUpstream)),
        disabledReason:
          baseDisabledReason ||
          (isRemote
            ? (!remoteName ? remoteDisabledReason : null)
            : !isCurrent && !hasUpstream
              ? noUpstreamDisabledReason
              : null),
        onSelect: () => {
          void handleUpdateBranchFromContextMenu(targetBranch, {
            isCurrent,
            isRemote,
            remoteName,
            hasUpstream,
          });
        },
      },
      {
        id: "push",
        label: t("git.historyBranchMenuPush"),
        icon: <Upload size={14} aria-hidden />,
        disabled: Boolean(baseDisabledReason || isRemote || !isCurrent),
        disabledReason: baseDisabledReason || (isRemote ? remoteDisabledReason : !isCurrent ? currentDisabledReason : null),
        onSelect: () => {
          closeBranchContextMenu();
          handleOpenPushDialog();
        },
      },
      {
        id: "rename",
        label: t("git.historyBranchMenuRename"),
        icon: <Pencil size={14} aria-hidden />,
        dividerBefore: true,
        disabled: Boolean(baseDisabledReason || isRemote),
        disabledReason:
          baseDisabledReason
          || (isRemote ? remoteDisabledReason : null),
        onSelect: () => {
          closeBranchContextMenu();
          handleOpenRenameBranchDialog(targetBranch);
        },
      },
      {
        id: "delete",
        label: t("git.historyBranchMenuDelete"),
        icon: <Trash2 size={14} aria-hidden />,
        tone: "danger",
        disabled: Boolean(baseDisabledReason || isCurrent || isRemote),
        disabledReason: baseDisabledReason || (isCurrent ? currentDisabledReason : isRemote ? remoteDisabledReason : null),
        onSelect: () => {
          closeBranchContextMenu();
          void handleDeleteBranch(targetBranch);
        },
      },
    ];
  }, [
    Download,
    FileText,
    FolderTree,
    GitBranch,
    GitMerge,
    Pencil,
    Plus,
    RefreshCw,
    Repeat,
    Trash2,
    Upload,
    branchContextMenu,
    closeBranchContextMenu,
    createBranchSourceOptions.length,
    currentBranch,
    handleCheckoutAndRebaseCurrent,
    handleCheckoutBranch,
    handleCompareWithCurrentBranch,
    handleCreateBranch,
    handleDeleteBranch,
    handleMergeBranch,
    handleOpenPushDialog,
    handleRebaseCurrentOntoBranch,
    handleOpenRenameBranchDialog,
    handleShowDiffWithWorktree,
    handleUpdateBranchFromContextMenu,
    operationLoading,
    t,
    workspaceId,
  ]);

  const handleBranchContextMenuKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const menuElement = branchContextMenuRef.current;
      if (!menuElement) {
        return;
      }
      const enabledItems = Array.from(
        menuElement.querySelectorAll<HTMLButtonElement>(
          '.git-history-branch-context-item[role="menuitem"]:not(:disabled)',
        ),
      );
      if (!enabledItems.length) {
        return;
      }
      const activeElement = document.activeElement;
      const currentIndex = enabledItems.findIndex((item) => item === activeElement);
      const focusIndex = (index: number) => {
        const normalized = ((index % enabledItems.length) + enabledItems.length) % enabledItems.length;
        enabledItems[normalized]?.focus();
      };

      if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        focusIndex(currentIndex < 0 ? 0 : currentIndex + 1);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        focusIndex(currentIndex < 0 ? enabledItems.length - 1 : currentIndex - 1);
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        event.stopPropagation();
        focusIndex(0);
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        event.stopPropagation();
        focusIndex(enabledItems.length - 1);
      }
    },
    [branchContextMenuRef],
  );

  useEffect(() => {
    if (!branchContextMenu) {
      return;
    }
    const rafId = window.requestAnimationFrame(() => {
      const menuElement = branchContextMenuRef.current;
      if (!menuElement) {
        return;
      }
      const firstEnabled = menuElement.querySelector<HTMLButtonElement>(
        '.git-history-branch-context-item[role="menuitem"]:not(:disabled)',
      );
      firstEnabled?.focus();
    });
    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [branchContextActions, branchContextMenu, branchContextMenuRef]);

  const branchContextMenuStyle = useMemo<CSSProperties | undefined>(() => {
    if (!branchContextMenu) {
      return undefined;
    }
    const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1440;
    const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 900;
    const longestLabelLength = branchContextActions.reduce(
      (max, action) => Math.max(max, action.label.length),
      0,
    );
    const estimatedMenuWidth = clamp(longestLabelLength * 8 + 96, 276, 520);
    const dividerCount = branchContextActions.reduce(
      (count, action) => count + (action.dividerBefore ? 1 : 0),
      0,
    );
    const estimatedMenuHeight = clamp(
      branchContextActions.length * 38 + dividerCount * 8 + 18,
      220,
      560,
    );
    const padding = 10;
    return {
      left: clamp(
        branchContextMenu.x,
        padding,
        Math.max(padding, viewportWidth - estimatedMenuWidth - padding),
      ),
      top: clamp(
        branchContextMenu.y,
        padding,
        Math.max(padding, viewportHeight - estimatedMenuHeight - padding),
      ),
    };
  }, [branchContextActions, branchContextMenu, clamp]);

  const buildCommitActions = useCallback(
    (targetSha: string | null): CommitActionDescriptor[] => {
      const noCommitReason = t("git.historySelectCommitToViewDetails");
      const busyReason = t("git.historyOperationBusy");
      const hasTarget = Boolean(targetSha);
      const busy = Boolean(operationLoading);
      return [
        {
          id: "copyRevision",
          label: t("git.historyCopyRevisionNumber"),
          group: "quick",
          disabled: !hasTarget,
          disabledReason: !hasTarget ? noCommitReason : undefined,
        },
        {
          id: "copyMessage",
          label: t("git.historyCopyCommitMessage"),
          group: "quick",
          disabled: !hasTarget,
          disabledReason: !hasTarget ? noCommitReason : undefined,
        },
        {
          id: "createBranch",
          label: t("git.historyBranchFromCommit"),
          group: "branch",
          disabled: !hasTarget || busy,
          disabledReason: !hasTarget ? noCommitReason : busy ? busyReason : undefined,
        },
        {
          id: "reset",
          label: t("git.historyResetCurrentBranchToHere"),
          group: "branch",
          disabled: !hasTarget || busy,
          disabledReason: !hasTarget ? noCommitReason : busy ? busyReason : undefined,
        },
        {
          id: "cherryPick",
          label: t("git.historyCherryPick"),
          group: "write",
          disabled: DISABLE_HISTORY_COMMIT_ACTIONS || !hasTarget || busy,
          disabledReason: DISABLE_HISTORY_COMMIT_ACTIONS
            ? busyReason
            : !hasTarget
              ? noCommitReason
              : busy
                ? busyReason
                : undefined,
        },
        {
          id: "revert",
          label: t("git.historyRevert"),
          group: "write",
          disabled: DISABLE_HISTORY_COMMIT_ACTIONS || !hasTarget || busy,
          disabledReason: DISABLE_HISTORY_COMMIT_ACTIONS
            ? busyReason
            : !hasTarget
              ? noCommitReason
              : busy
                ? busyReason
                : undefined,
        },
      ];
    },
    [DISABLE_HISTORY_COMMIT_ACTIONS, operationLoading, t],
  );

  const contextCommitActions = useMemo(
    () => buildCommitActions(commitContextMenu?.commitSha ?? null),
    [buildCommitActions, commitContextMenu?.commitSha],
  );

  const contextPrimaryActionGroups = useMemo(() => {
    return (["quick", "branch"] as const)
      .map((groupKey) => ({
        groupKey,
        items: contextCommitActions.filter(
          (item) => item.group === groupKey && item.id !== "copyMessage",
        ),
      }))
      .filter((entry) => entry.items.length > 0);
  }, [contextCommitActions]);

  const contextWriteActions = useMemo(
    () => contextCommitActions.filter((item) => item.group === "write"),
    [contextCommitActions],
  );

  const contextMoreDisabledReason = useMemo(() => {
    if (!contextWriteActions.length) {
      return undefined;
    }
    if (!contextWriteActions.every((action) => action.disabled)) {
      return undefined;
    }
    return contextWriteActions.find((action) => action.disabledReason)?.disabledReason;
  }, [contextWriteActions]);

  const runCommitAction = useCallback(
    (actionId: CommitActionId, commitSha: string | null) => {
      if (!commitSha) {
        return;
      }
      switch (actionId) {
        case "copyRevision":
          void handleCopyCommitRevision(commitSha);
          return;
        case "copyMessage":
          void handleCopyCommitMessage(commitSha);
          return;
        case "createBranch":
          void handleCreateBranchFromCommit(commitSha);
          return;
        case "reset":
          openResetDialog(commitSha);
          return;
        case "cherryPick":
          void handleCherryPickCommit(commitSha);
          return;
        case "revert":
          void handleRevertSelectedCommit(commitSha);
          return;
      }
    },
    [
      handleCherryPickCommit,
      handleCopyCommitMessage,
      handleCopyCommitRevision,
      handleCreateBranchFromCommit,
      handleRevertSelectedCommit,
      openResetDialog,
    ],
  );

  const handleOpenCommitContextMenu = useCallback(
    (event: MouseEvent<HTMLElement>, commitSha: string) => {
      event.preventDefault();
      event.stopPropagation();
      setSelectedCommitSha(commitSha);
      setBranchContextMenu(null);
      setCommitContextMoreOpen(false);
      setCommitContextMenu({
        x: event.clientX,
        y: event.clientY,
        commitSha,
      });
    },
    [setBranchContextMenu, setCommitContextMenu, setCommitContextMoreOpen, setSelectedCommitSha],
  );

  useEffect(() => {
    const handleWindowResize = () => {
      setDesktopSplitLayout(window.innerWidth > COMPACT_LAYOUT_BREAKPOINT);
    };
    window.addEventListener("resize", handleWindowResize);
    return () => {
      window.removeEventListener("resize", handleWindowResize);
    };
  }, [COMPACT_LAYOUT_BREAKPOINT, setDesktopSplitLayout]);

  const getCurrentDefaultColumnWidths = useCallback(() => {
    const containerWidth =
      workbenchGridRef.current?.getBoundingClientRect().width ??
      (typeof window !== "undefined" ? window.innerWidth : 1600);
    return getDefaultColumnWidths(containerWidth);
  }, [getDefaultColumnWidths, workbenchGridRef]);

  useEffect(() => {
    if (!desktopSplitLayout) {
      return;
    }
    const defaults = getCurrentDefaultColumnWidths();
    setOverviewWidth(defaults.overviewWidth);
    setBranchesWidth(defaults.branchesWidth);
    setCommitsWidth(defaults.commitsWidth);
  }, [
    desktopSplitLayout,
    getCurrentDefaultColumnWidths,
    setBranchesWidth,
    setCommitsWidth,
    setOverviewWidth,
  ]);

  const beginVerticalResize = useCallback(
    (event: MouseEvent<HTMLDivElement>, onDeltaChange: (deltaX: number) => void) => {
      event.preventDefault();
      const startX = event.clientX;

      const onMouseMove = (moveEvent: globalThis.MouseEvent) => {
        onDeltaChange(moveEvent.clientX - startX);
      };

      const onMouseUp = () => {
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        document.body.style.webkitUserSelect = "";
        delete document.body.dataset.gitHistoryColumnResizing;
      };

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.body.style.webkitUserSelect = "none";
      document.body.dataset.gitHistoryColumnResizing = "true";
    },
    [],
  );

  const handleOverviewSplitResizeStart = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!desktopSplitLayout) {
        return;
      }
      const host = workbenchGridRef.current;
      if (!host) {
        return;
      }
      const hostWidth = host.getBoundingClientRect().width;
      const maxOverviewWidth =
        hostWidth -
        VERTICAL_SPLITTER_SIZE -
        (branchesWidth +
          VERTICAL_SPLITTER_SIZE +
          commitsWidth +
          VERTICAL_SPLITTER_SIZE +
          DETAILS_MIN_WIDTH);

      beginVerticalResize(event, (deltaX) => {
        const nextWidth = clamp(
          overviewWidth + deltaX,
          OVERVIEW_MIN_WIDTH,
          Math.max(OVERVIEW_MIN_WIDTH, maxOverviewWidth),
        );
        setOverviewWidth(nextWidth);
      });
    },
    [
      DETAILS_MIN_WIDTH,
      OVERVIEW_MIN_WIDTH,
      VERTICAL_SPLITTER_SIZE,
      beginVerticalResize,
      branchesWidth,
      clamp,
      commitsWidth,
      desktopSplitLayout,
      overviewWidth,
      setOverviewWidth,
      workbenchGridRef,
    ],
  );

  const handleBranchesSplitResizeStart = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!desktopSplitLayout) {
        return;
      }
      const pairWidth = branchesWidth + commitsWidth;

      beginVerticalResize(event, (deltaX) => {
        const nextBranchesWidth = clamp(
          branchesWidth + deltaX,
          BRANCHES_MIN_WIDTH,
          pairWidth - COMMITS_MIN_WIDTH,
        );
        setBranchesWidth(nextBranchesWidth);
        setCommitsWidth(pairWidth - nextBranchesWidth);
      });
    },
    [BRANCHES_MIN_WIDTH, COMMITS_MIN_WIDTH, beginVerticalResize, branchesWidth, clamp, commitsWidth, desktopSplitLayout, setBranchesWidth, setCommitsWidth],
  );

  const handleCommitsSplitResizeStart = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!desktopSplitLayout) {
        return;
      }
      const host = mainGridRef.current;
      if (!host) {
        return;
      }
      const hostWidth = host.getBoundingClientRect().width;
      const maxCommitsWidth =
        hostWidth -
        branchesWidth -
        VERTICAL_SPLITTER_SIZE -
        VERTICAL_SPLITTER_SIZE -
        DETAILS_MIN_WIDTH;

      beginVerticalResize(event, (deltaX) => {
        const nextCommitsWidth = clamp(
          commitsWidth + deltaX,
          COMMITS_MIN_WIDTH,
          Math.max(COMMITS_MIN_WIDTH, maxCommitsWidth),
        );
        setCommitsWidth(nextCommitsWidth);
      });
    },
    [COMMITS_MIN_WIDTH, DETAILS_MIN_WIDTH, VERTICAL_SPLITTER_SIZE, beginVerticalResize, branchesWidth, clamp, commitsWidth, desktopSplitLayout, mainGridRef, setCommitsWidth],
  );

  const handleDetailsSplitResizeStart = useCallback((event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();

    const onMouseMove = (moveEvent: globalThis.MouseEvent) => {
      const host = detailsBodyRef.current;
      if (!host) {
        return;
      }
      const rect = host.getBoundingClientRect();
      if (rect.height <= 0) {
        return;
      }
      const nextRatio = ((moveEvent.clientY - rect.top) / rect.height) * 100;
      const clamped = Math.max(DETAILS_SPLIT_MIN, Math.min(DETAILS_SPLIT_MAX, nextRatio));
      setDetailsSplitRatio(clamped);
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  }, [DETAILS_SPLIT_MAX, DETAILS_SPLIT_MIN, detailsBodyRef, setDetailsSplitRatio]);

  const workbenchGridStyle = desktopSplitLayout
    ? {
        gridTemplateColumns: `${Math.round(overviewWidth)}px ${VERTICAL_SPLITTER_SIZE}px minmax(0, 1fr)`,
      }
    : undefined;

  const mainGridStyle = desktopSplitLayout
    ? {
        gridTemplateColumns: `${Math.round(branchesWidth)}px ${VERTICAL_SPLITTER_SIZE}px ${Math.round(
          commitsWidth,
        )}px ${VERTICAL_SPLITTER_SIZE}px minmax(0, 1fr)`,
      }
    : undefined;

  const commitRowVirtualizer = useVirtualizer({
    count: commits.length,
    getScrollElement: () => commitListRef.current,
    estimateSize: () => COMMIT_ROW_ESTIMATED_HEIGHT,
    overscan: 10,
  });
  const virtualCommitRows = commitRowVirtualizer.getVirtualItems();

  useEffect(() => {
    if (!selectedCommitSha || !commits.length) {
      return;
    }
    const selectedIndex = commits.findIndex((entry) => entry.sha === selectedCommitSha);
    if (selectedIndex >= 0) {
      commitRowVirtualizer.scrollToIndex(selectedIndex, { align: "center" });
    }
  }, [commitRowVirtualizer, commits, selectedCommitSha]);

  useEffect(() => {
    if (!historyHasMore || historyLoading || historyLoadingMore || !virtualCommitRows.length) {
      return;
    }
    const lastVisible = virtualCommitRows[virtualCommitRows.length - 1];
    if (lastVisible.index >= commits.length - 8) {
      void loadHistory(true, commits.length);
    }
  }, [
    commits.length,
    historyHasMore,
    historyLoading,
    historyLoadingMore,
    loadHistory,
    virtualCommitRows,
  ]);


  return {refreshFallbackGitRoots,handleFallbackGitRootSelect,workspaceSelectingName,emptyStateStatusText,handleWorktreeSummaryChange,handleToggleLocalScope,handleToggleRemoteScope,handleCheckoutBranch,handleCreateBranch,handleCreateBranchConfirm,applyCreatePrDefaults,handleCreatePrHeadRepositoryChange,loadCreatePrCommitPreview,handleOpenCreatePrDialog,closeCreatePrDialog,handleCopyCreatePrUrl,handleCopyCreatePrRetryCommand,handleConfirmCreatePr,handleOpenPullDialog,handleSelectPullTargetBranch,handleSelectPullRemote,handleConfirmPull,handleOpenSyncDialog,handleConfirmSync,handleOpenFetchDialog,handleConfirmFetch,handleOpenRefreshDialog,handleConfirmRefresh,handleSelectPushRemote,handleSelectPushTargetBranch,handleOpenPushDialog,loadPushPreview,handleConfirmPush,handleCreateBranchFromCommit,handleDeleteBranch,handleOpenRenameBranchDialog,closeRenameBranchDialog,handleRenameBranchConfirm,handleMergeBranch,handleCheckoutAndRebaseCurrent,handleRebaseCurrentOntoBranch,handleShowDiffWithWorktree,handleCompareWithCurrentBranch,handleSelectWorktreeDiffFile,handleSelectBranchCompareCommit,handleRevertSelectedCommit,handleCherryPickCommit,handleCopyCommitRevision,handleCopyCommitMessage,openResetDialog,handleConfirmResetCommit,handleFileTreeDirToggle,handlePushPreviewDirToggle,closeWorktreePreview,handleOpenWorktreePreview,resetTargetCommit,branchContextTrackingSummary,branchContextActions,handleBranchContextMenuKeyDown,branchContextMenuStyle,buildCommitActions,contextCommitActions,contextPrimaryActionGroups,contextWriteActions,contextMoreDisabledReason,runCommitAction,handleOpenCommitContextMenu,getCurrentDefaultColumnWidths,beginVerticalResize,handleOverviewSplitResizeStart,handleBranchesSplitResizeStart,handleCommitsSplitResizeStart,handleDetailsSplitResizeStart,workbenchGridStyle,mainGridStyle,commitRowVirtualizer,virtualCommitRows};
}
