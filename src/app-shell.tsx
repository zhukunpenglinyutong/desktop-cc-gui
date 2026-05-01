// @ts-nocheck
import {
  cloneElement,
  isValidElement,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { AppLayout } from "./features/app/components/AppLayout";
import { AppModals } from "./features/app/components/AppModals";
import { LockScreenOverlay } from "./features/app/components/LockScreenOverlay";
import { MainHeaderActions } from "./features/app/components/MainHeaderActions";
import { RuntimeConsoleDock } from "./features/app/components/RuntimeConsoleDock";
import { useLayoutNodes } from "./features/layout/hooks/useLayoutNodes";
import { useWorkspaceDropZone } from "./features/workspaces/hooks/useWorkspaceDropZone";
import { useThreads } from "./features/threads/hooks/useThreads";
import { useWindowDrag } from "./features/layout/hooks/useWindowDrag";
import { useGitPanelController } from "./features/app/hooks/useGitPanelController";
import { useGitRemote } from "./features/git/hooks/useGitRemote";
import { useGitRepoScan } from "./features/git/hooks/useGitRepoScan";
import { usePullRequestComposer } from "./features/git/hooks/usePullRequestComposer";
import { useGitActions } from "./features/git/hooks/useGitActions";
import { useAutoExitEmptyDiff } from "./features/git/hooks/useAutoExitEmptyDiff";
import { useModels } from "./features/models/hooks/useModels";
import { refreshCodexModelConfig } from "./features/models/refreshCodexModelConfig";
import { useCollaborationModes } from "./features/collaboration/hooks/useCollaborationModes";
import { useCollaborationModeSelection } from "./features/collaboration/hooks/useCollaborationModeSelection";
import { useSkills } from "./features/skills/hooks/useSkills";
import { useCustomCommands } from "./features/commands/hooks/useCustomCommands";
import { useCustomPrompts } from "./features/prompts/hooks/useCustomPrompts";
import { useWorkspaceFiles } from "./features/workspaces/hooks/useWorkspaceFiles";
import { useGitBranches } from "./features/git/hooks/useGitBranches";
import { useDebugLog } from "./features/debug/hooks/useDebugLog";
import { useWorkspaceRefreshOnFocus } from "./features/workspaces/hooks/useWorkspaceRefreshOnFocus";
import { useWorkspaceRestore } from "./features/workspaces/hooks/useWorkspaceRestore";
import { useOpenPaths } from "./features/workspaces/hooks/useOpenPaths";
import { useRenameWorktreePrompt } from "./features/workspaces/hooks/useRenameWorktreePrompt";
import { useLayoutController } from "./features/app/hooks/useLayoutController";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { homeDir } from "@tauri-apps/api/path";
import { isMacPlatform, isWindowsPlatform } from "./utils/platform";
import { ask } from "@tauri-apps/plugin-dialog";
import { writeClientStoreValue } from "./services/clientStorage";
import {
  SidebarCollapseButton,
  TitlebarExpandControls,
} from "./features/layout/components/SidebarToggleControls";
import { useAppSettingsController } from "./features/app/hooks/useAppSettingsController";
import { useUpdaterController } from "./features/app/hooks/useUpdaterController";
import { useGitHistoryPanelResize } from "./features/app/hooks/useGitHistoryPanelResize";
import { useReleaseNotes } from "./features/update/hooks/useReleaseNotes";
import { useErrorToasts } from "./features/notifications/hooks/useErrorToasts";
import { useComposerShortcuts } from "./features/composer/hooks/useComposerShortcuts";
import { useComposerMenuActions } from "./features/composer/hooks/useComposerMenuActions";
import { useComposerEditorState } from "./features/composer/hooks/useComposerEditorState";
import { useDictationController } from "./features/app/hooks/useDictationController";
import { useComposerController } from "./features/app/hooks/useComposerController";
import { useEngineController } from "./features/engine/hooks/useEngineController";
import { resolveClaudePendingThreadModelRefreshKey } from "./features/engine/utils/claudeModelRefresh";
import { useRenameThreadPrompt } from "./features/threads/hooks/useRenameThreadPrompt";
import { useDeleteThreadPrompt } from "./features/threads/hooks/useDeleteThreadPrompt";
import { useWorktreePrompt } from "./features/workspaces/hooks/useWorktreePrompt";
import { useClonePrompt } from "./features/workspaces/hooks/useClonePrompt";
import { useWorkspaceController } from "./features/app/hooks/useWorkspaceController";
import { useWorkspaceSelection } from "./features/workspaces/hooks/useWorkspaceSelection";
import { useLiveEditPreview } from "./features/live-edit-preview/hooks/useLiveEditPreview";
import { useGitHubPanelController } from "./features/app/hooks/useGitHubPanelController";
import { useSettingsModalState } from "./features/app/hooks/useSettingsModalState";
import { useLoadingProgressDialogState } from "./features/app/hooks/useLoadingProgressDialogState";
import { usePersistComposerSettings } from "./features/app/hooks/usePersistComposerSettings";
import { useSyncSelectedDiffPath } from "./features/app/hooks/useSyncSelectedDiffPath";
import { useMenuAcceleratorController } from "./features/app/hooks/useMenuAcceleratorController";
import { useAppMenuEvents } from "./features/app/hooks/useAppMenuEvents";
import { useWorkspaceActions } from "./features/app/hooks/useWorkspaceActions";
import { useWorkspaceCycling } from "./features/app/hooks/useWorkspaceCycling";
import { useThreadRows } from "./features/app/hooks/useThreadRows";
import { useInterruptShortcut } from "./features/app/hooks/useInterruptShortcut";
import { useArchiveShortcut } from "./features/app/hooks/useArchiveShortcut";
import { useGlobalSearchShortcut } from "./features/app/hooks/useGlobalSearchShortcut";
import { useLiquidGlassEffect } from "./features/app/hooks/useLiquidGlassEffect";
import { useCopyThread } from "./features/threads/hooks/useCopyThread";
import { useTerminalController } from "./features/terminal/hooks/useTerminalController";
import { useWorkspaceLaunchScript } from "./features/app/hooks/useWorkspaceLaunchScript";
import { useWorkspaceRuntimeRun } from "./features/app/hooks/useWorkspaceRuntimeRun";
import { useKanbanStore } from "./features/kanban/hooks/useKanbanStore";
import { KanbanView } from "./features/kanban/components/KanbanView";
import { GitHistoryPanel } from "./features/git-history/components/GitHistoryPanel";
import type { KanbanTask } from "./features/kanban/types";
import {
  resolveKanbanThreadCreationStrategy,
  type KanbanContextMode,
} from "./features/kanban/utils/contextMode";
import { deriveKanbanTaskTitle } from "./features/kanban/utils/taskTitle";
import { useWorkspaceLaunchScripts } from "./features/app/hooks/useWorkspaceLaunchScripts";
import { useWorktreeSetupScript } from "./features/app/hooks/useWorktreeSetupScript";
import { useGitCommitController } from "./features/app/hooks/useGitCommitController";
import { useSoloMode } from "./features/layout/hooks/useSoloMode";
import {
  WorkspaceHome,
  type WorkspaceHomeDeleteResult,
} from "./features/workspaces/components/WorkspaceHome";
import { SpecHub } from "./features/spec/components/SpecHub";
import { SearchPalette } from "./features/search/components/SearchPalette";
import {
  getHomeWorkspaceOptions,
  resolveHomeWorkspaceId,
} from "./features/home/utils/homeWorkspaceOptions";
import { shouldHideHomeOnThreadActivation } from "./features/home/utils/homeVisibility";
import { forceRefreshAgents } from "./features/composer/components/ChatInputBox/providers";
import { recordSearchResultOpen } from "./features/search/ranking/recencyStore";
import type { SearchContentFilter, SearchResult, SearchScope } from "./features/search/types";
import { toggleSearchContentFilters } from "./features/search/utils/contentFilters";
import { resolveSearchScopeOnOpen } from "./features/search/utils/scope";
import {
  normalizeFsPath,
  resolveWorkspaceRelativePath,
} from "./utils/workspacePaths";
import {
  buildDetachedFileExplorerSession,
  openOrFocusDetachedFileExplorer,
} from "./features/files/detachedFileExplorer";
import {
  ensureWorkspacePathDir,
  pickWorkspacePath,
} from "./services/tauri";
import type {
  AccessMode,
  AppMode,
  ComposerEditorSettings,
  EngineType,
  MessageSendOptions,
  WorkspaceInfo,
} from "./types";
import { useCodeCssVars } from "./features/app/hooks/useCodeCssVars";
import { useAccountSwitching } from "./features/app/hooks/useAccountSwitching";
import { useMenuLocalization } from "./features/app/hooks/useMenuLocalization";
import { setNotificationActionHandler } from "./services/systemNotification";
import { pushErrorToast } from "./services/toasts";
import { ReleaseNotesModal } from "./features/update/components/ReleaseNotesModal";
import { requestVendorModelManager } from "./features/vendors/modelManagerRequest";
import {
  OPENCODE_VARIANT_OPTIONS,
  extractPlanFromTimelineItems,
  resolveThreadScopedCollaborationModeSync,
} from "./app-shell-parts/utils";
import { useAppShellPromptActionsSection } from "./app-shell-parts/useAppShellPromptActionsSection";
import { useAppShellSearchRadarSection } from "./app-shell-parts/useAppShellSearchRadarSection";
import { useAppShellSearchAndComposerSection } from "./app-shell-parts/useAppShellSearchAndComposerSection";
import { useAppShellSections } from "./app-shell-parts/useAppShellSections";
import { useAppShellLayoutNodesSection } from "./app-shell-parts/useAppShellLayoutNodesSection";
import { renderAppShell } from "./app-shell-parts/renderAppShell";
import {
  getEffectiveSelectedEffort,
  getEffectiveModels,
  getEffectiveReasoningSupported,
  getEffectiveSelectedModelId,
  getReasoningOptionsForModel,
  getNextEngineSelectedModelId,
} from "./app-shell-parts/modelSelection";
import { useOpenCodeSelection } from "./app-shell-parts/useOpenCodeSelection";
import { useSelectedAgentSession } from "./app-shell-parts/useSelectedAgentSession";
import { useSelectedComposerSession } from "./app-shell-parts/useSelectedComposerSession";
import { APP_SHELL_LEGACY_CONTEXT_DEFAULTS } from "./app-shell-parts/legacyContextDefaults";
import { usePanelLockState } from "./app-shell-parts/usePanelLockState";
import { usePlanApplyHandlers } from "./app-shell-parts/usePlanApplyHandlers";
import { useThreadScopedCollaborationMode } from "./app-shell-parts/useThreadScopedCollaborationMode";
import { GitHubPanelData, SettingsView } from "./app-shell-parts/lazyViews";
import { useCreateSessionLoading } from "./app-shell-parts/useCreateSessionLoading";
import type { AgentTaskScrollRequest } from "./features/messages/types";
import type { SubagentInfo } from "./features/status-panel/types";

const EMPTY_OPEN_APP_ICON_MAP: Record<string, string> = {};
const DEFAULT_CLAUDE_MODEL_ID = "claude-sonnet-4-6";
const resolveModelConfigEngine = (
  providerId: string | undefined,
  fallbackEngine: EngineType,
): EngineType | null => {
  if (providerId === "claude" || providerId === "codex" || providerId === "gemini") {
    return providerId;
  }
  if (fallbackEngine === "claude" || fallbackEngine === "codex" || fallbackEngine === "gemini") {
    return fallbackEngine;
  }
  return null;
};

export function AppShell() {
  const { t } = useTranslation();
  const {
    appSettings,
    setAppSettings,
    doctor,
    claudeDoctor,
    appSettingsLoading,
    reduceTransparency,
    setReduceTransparency,
    scaleShortcutTitle,
    scaleShortcutText,
    queueSaveSettings,
  } = useAppSettingsController();
  useCodeCssVars(appSettings);
  const {
    dictationModel,
    dictationState,
    dictationLevel,
    dictationTranscript,
    dictationError,
    dictationHint,
    dictationReady,
    handleToggleDictation,
    clearDictationTranscript,
    clearDictationError,
    clearDictationHint,
  } = useDictationController(appSettings);
  const {
    debugOpen,
    setDebugOpen,
    debugEntries,
    showDebugButton,
    addDebugEntry,
    handleCopyDebug,
    clearDebugEntries,
  } = useDebugLog();
  useLiquidGlassEffect({ reduceTransparency, onDebug: addDebugEntry });
  const [accessMode, setAccessMode] = useState<AccessMode>("full-access");
  const claudeAccessModeRef = useRef<AccessMode>("full-access");
  const [activeTab, setActiveTab] = useState<
    "projects" | "codex" | "spec" | "git" | "log"
  >("codex");
  const tabletTab = activeTab === "projects" ? "codex" : activeTab;
  const {
    workspaces,
    workspaceGroups,
    groupedWorkspaces,
    getWorkspaceGroupName,
    ungroupedLabel,
    activeWorkspace,
    activeWorkspaceId,
    setActiveWorkspaceId,
    addWorkspace,
    addWorkspaceFromPath,
    addCloneAgent,
    addWorktreeAgent,
    connectWorkspace,
    markWorkspaceConnected,
    updateWorkspaceSettings,
    updateWorkspaceCodexBin,
    createWorkspaceGroup,
    renameWorkspaceGroup,
    moveWorkspaceGroup,
    deleteWorkspaceGroup,
    assignWorkspaceGroup,
    removeWorkspace,
    removeWorktree,
    renameWorktree,
    renameWorktreeUpstream,
    deletingWorktreeIds,
    hasLoaded,
    refreshWorkspaces,
  } = useWorkspaceController({
    appSettings,
    addDebugEntry,
    queueSaveSettings,
  });
  const workspacesById = useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.id, workspace])),
    [workspaces],
  );
  const workspacesByPath = useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.path, workspace])),
    [workspaces],
  );
  const [homeOpen, setHomeOpen] = useState(true);
  const homeWorkspaceOptions = useMemo(
    () => getHomeWorkspaceOptions(groupedWorkspaces, workspaces),
    [groupedWorkspaces, workspaces],
  );
  const homeWorkspaceDefaultId = homeWorkspaceOptions[0]?.id ?? null;
  const homeWorkspaceSelectedId = useMemo(
    () => resolveHomeWorkspaceId(activeWorkspaceId, homeWorkspaceOptions),
    [activeWorkspaceId, homeWorkspaceOptions],
  );
  const {
    sidebarWidth,
    rightPanelWidth,
    setRightPanelWidth,
    onSidebarResizeStart,
    onRightPanelResizeStart,
    planPanelHeight,
    onPlanPanelResizeStart,
    terminalPanelHeight,
    onTerminalPanelResizeStart,
    debugPanelHeight,
    onDebugPanelResizeStart,
    kanbanConversationWidth,
    onKanbanConversationResizeStart,
    isCompact,
    isTablet,
    isPhone,
    sidebarCollapsed,
    rightPanelCollapsed,
    collapseSidebar,
    expandSidebar,
    collapseRightPanel,
    expandRightPanel,
    terminalOpen,
    handleDebugClick,
    handleToggleTerminal,
    openTerminal,
    closeTerminal: closeTerminalPanel,
  } = useLayoutController({
    activeWorkspaceId,
    setActiveTab,
    setDebugOpen,
    toggleDebugPanelShortcut: appSettings.toggleDebugPanelShortcut,
    toggleTerminalShortcut: appSettings.toggleTerminalShortcut,
  });
  const [appMode, setAppMode] = useState<AppMode>("chat");
  const [agentTaskScrollRequest, setAgentTaskScrollRequest] =
    useState<AgentTaskScrollRequest | null>(null);
  const appRootRef = useRef<HTMLDivElement | null>(null);
  const {
    gitHistoryPanelHeight,
    gitHistoryPanelHeightRef,
    onGitHistoryPanelResizeStart,
    setGitHistoryPanelHeight,
  } = useGitHistoryPanelResize({
    appRootRef,
    onClosePanel: () => {
      setAppMode("chat");
    },
  });

  const resetSoloSplitToHalf = useCallback(() => {
    window.requestAnimationFrame(() => {
      const appRoot = appRootRef.current;
      const main = appRoot?.querySelector<HTMLElement>(".main");
      const mainWidth = main?.clientWidth ?? window.innerWidth;
      setRightPanelWidth(Math.floor(mainWidth / 2));
    });
  }, [setRightPanelWidth]);

  const {
    settingsOpen,
    settingsSection,
    settingsHighlightTarget,
    openSettings,
    closeSettings,
  } = useSettingsModalState();
  const {
    loadingProgressDialog,
    showLoadingProgressDialog,
    hideLoadingProgressDialog,
    dismissLoadingProgressDialog,
  } = useLoadingProgressDialogState();

  const runWithCreateSessionLoading = useCreateSessionLoading({
    hideLoadingProgressDialog,
    showLoadingProgressDialog,
    t,
  });

  const handleOpenModelSettings = useCallback(
    (providerId?: string) => {
      const target =
        providerId === "codex"
          ? "codex"
          : providerId === "gemini"
            ? "gemini"
            : "claude";
      requestVendorModelManager({ target, addMode: true });
      openSettings("providers");
    },
    [openSettings],
  );

  const [isSearchPaletteOpen, setIsSearchPaletteOpen] = useState(false);
  const [searchScope, setSearchScope] = useState<SearchScope>("active-workspace");
  const [searchContentFilters, setSearchContentFilters] =
    useState<SearchContentFilter[]>(["all"]);
  const [searchPaletteQuery, setSearchPaletteQuery] = useState("");
  const [searchPaletteSelectedIndex, setSearchPaletteSelectedIndex] = useState(0);
  const [globalSearchFilesByWorkspace, setGlobalSearchFilesByWorkspace] = useState<
    Record<string, string[]>
  >({});
  const {
    isPanelLocked,
    setIsPanelLocked,
    handleLockPanel,
    handleUnlockPanel,
  } = usePanelLockState();
  const completionTrackerReadyRef = useRef(false);
  const completionTrackerBySessionRef = useRef<Record<string, any>>({});
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);

  const {
    updaterState,
    startUpdate,
    dismissUpdate,
    handleTestNotificationSound,
  } = useUpdaterController({
    notificationSoundsEnabled: appSettings.notificationSoundsEnabled,
    notificationSoundId: appSettings.notificationSoundId,
    notificationSoundCustomPath: appSettings.notificationSoundCustomPath,
    onDebug: addDebugEntry,
  });
  const {
    isOpen: releaseNotesOpen,
    entries: releaseNotesEntries,
    activeIndex: releaseNotesActiveIndex,
    loading: releaseNotesLoading,
    error: releaseNotesError,
    openReleaseNotes,
    closeReleaseNotes,
    goToPrevious: showPreviousReleaseNotes,
    goToNext: showNextReleaseNotes,
    retryLoad: retryReleaseNotesLoad,
  } = useReleaseNotes({
    onDebug: addDebugEntry,
  });

  const { errorToasts, dismissErrorToast } = useErrorToasts();
  const normalizePath = useCallback((path: string) => normalizeFsPath(path).trim(), []);

  const {
    gitIssues,
    gitIssuesTotal,
    gitIssuesLoading,
    gitIssuesError,
    gitPullRequests,
    gitPullRequestsTotal,
    gitPullRequestsLoading,
    gitPullRequestsError,
    gitPullRequestDiffs,
    gitPullRequestDiffsLoading,
    gitPullRequestDiffsError,
    gitPullRequestComments,
    gitPullRequestCommentsLoading,
    gitPullRequestCommentsError,
    handleGitIssuesChange,
    handleGitPullRequestsChange,
    handleGitPullRequestDiffsChange,
    handleGitPullRequestCommentsChange,
    resetGitHubPanelState,
  } = useGitHubPanelController();

  const {
    centerMode,
    setCenterMode,
    selectedDiffPath,
    setSelectedDiffPath,
    diffScrollRequestId,
    gitPanelMode,
    setGitPanelMode,
    gitDiffViewStyle,
    setGitDiffViewStyle,
    gitDiffListView,
    setGitDiffListView,
    filePanelMode,
    setFilePanelMode,
    selectedPullRequest,
    setSelectedPullRequest,
    selectedCommitSha,
    setSelectedCommitSha,
    diffSource,
    setDiffSource,
    gitStatus,
    refreshGitStatus,
    queueGitStatusRefresh,
    refreshGitDiffs,
    gitLogEntries,
    gitLogTotal,
    gitLogAhead,
    gitLogBehind,
    gitLogAheadEntries,
    gitLogBehindEntries,
    gitLogUpstream,
    gitLogLoading,
    gitLogError,
    refreshGitLog,
    gitCommitDiffs,
    shouldLoadDiffs,
    activeDiffs,
    activeDiffLoading,
    activeDiffError,
    handleSelectDiff,
    handleSelectCommit,
    handleActiveDiffPath,
    handleGitPanelModeChange,
    activeEditorFilePath,
    editorNavigationTarget,
    editorHighlightTarget,
    openFileTabs,
    handleOpenFile,
    handleActivateFileTab,
    handleCloseFileTab,
    handleCloseAllFileTabs,
    handleExitEditor,
    activeWorkspaceIdRef,
    activeWorkspaceRef,
  } = useGitPanelController({
    activeWorkspace,
    gitDiffPreloadEnabled: appSettings.preloadGitDiffs,
    isCompact,
    isTablet,
    rightPanelCollapsed,
    activeTab,
    tabletTab,
    setActiveTab,
    prDiffs: gitPullRequestDiffs,
    prDiffsLoading: gitPullRequestDiffsLoading,
    prDiffsError: gitPullRequestDiffsError,
  });
  const [activeEditorLineRange, setActiveEditorLineRange] = useState<{
    startLine: number;
    endLine: number;
  } | null>(null);
  const [fileReferenceMode, setFileReferenceMode] = useState<"path" | "none">("none");
  const [editorSplitLayout, setEditorSplitLayout] = useState<"vertical" | "horizontal">(
    "vertical",
  );
  const [isEditorFileMaximized, setIsEditorFileMaximized] = useState(false);
  const [liveEditPreviewEnabled, setLiveEditPreviewEnabled] = useState(false);

  useEffect(() => {
    if (!activeEditorFilePath) {
      setActiveEditorLineRange(null);
      setIsEditorFileMaximized(false);
    }
  }, [activeEditorFilePath]);


  const shouldLoadGitHubPanelData =
    gitPanelMode === "issues" ||
    gitPanelMode === "prs" ||
    (shouldLoadDiffs && diffSource === "pr");

  useEffect(() => {
    resetGitHubPanelState();
  }, [activeWorkspaceId, resetGitHubPanelState]);
  const { remote: gitRemoteUrl } = useGitRemote(activeWorkspace);
  const {
    repos: gitRootCandidates,
    isLoading: gitRootScanLoading,
    error: gitRootScanError,
    depth: gitRootScanDepth,
    hasScanned: gitRootScanHasScanned,
    scan: scanGitRoots,
    setDepth: setGitRootScanDepth,
    clear: clearGitRootCandidates,
  } = useGitRepoScan(activeWorkspace);
  const {
    models,
    modelsReady,
    selectedModelId,
    setSelectedModelId,
    selectedEffort,
    setSelectedEffort,
    refreshModels,
    globalSelectionReady,
  } = useModels({
    activeWorkspace,
    onDebug: addDebugEntry,
    preferredModelId: appSettings.lastComposerModelId,
    preferredEffort: appSettings.lastComposerReasoningEffort,
    preferredSelectionReady: !appSettingsLoading,
  });

  const {
    collaborationModes,
    collaborationModesEnabled,
    selectedCollaborationMode,
    selectedCollaborationModeId,
    setSelectedCollaborationModeId,
  } = useCollaborationModes({
    activeWorkspace,
    enabled: true,
    onDebug: addDebugEntry,
  });
  const {
    collaborationUiModeByThread,
    setCollaborationUiModeByThread,
    collaborationRuntimeModeByThread,
    setCollaborationRuntimeModeByThread,
    activeThreadIdForModeRef,
    lastCodexModeSyncThreadRef,
    codexComposerModeRef,
    applySelectedCollaborationMode,
    setCodexCollaborationMode,
    resolveCollaborationRuntimeMode,
    resolveCollaborationUiMode,
    handleCollaborationModeResolved,
  } = useThreadScopedCollaborationMode({
    setSelectedCollaborationModeId,
  });

  const { skills } = useSkills({ activeWorkspace, onDebug: addDebugEntry });
  const {
    activeEngine,
    availableEngines,
    installedEngines,
    setActiveEngine,
    engineModelsAsOptions,
    engineStatuses,
    refreshEngineModels,
    refreshEngines,
  } = useEngineController({ activeWorkspace, onDebug: addDebugEntry });
  const [modelConfigRefreshingByEngine, setModelConfigRefreshingByEngine] =
    useState<Partial<Record<EngineType, boolean>>>({});
  const modelConfigRefreshInFlightRef =
    useRef<Partial<Record<EngineType, boolean>>>({});
  const handleRefreshModelConfig = useCallback(
    async (providerId?: string) => {
      const targetEngine = resolveModelConfigEngine(providerId, activeEngine);
      if (!targetEngine || modelConfigRefreshInFlightRef.current[targetEngine]) {
        return;
      }
      modelConfigRefreshInFlightRef.current = {
        ...modelConfigRefreshInFlightRef.current,
        [targetEngine]: true,
      };
      setModelConfigRefreshingByEngine((current) => ({
        ...current,
        [targetEngine]: true,
      }));
      addDebugEntry({
        id: `${Date.now()}-model-config-refresh-start`,
        timestamp: Date.now(),
        source: "client",
        label: "model/config refresh start",
        payload: { engine: targetEngine },
      });
      try {
        if (targetEngine === "codex") {
          await refreshCodexModelConfig({ refreshModels });
        } else {
          await refreshEngineModels(targetEngine, { forceRefresh: true });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        addDebugEntry({
          id: `${Date.now()}-model-config-refresh-error`,
          timestamp: Date.now(),
          source: "error",
          label: "model/config refresh error",
          payload: { engine: targetEngine, error: message },
        });
        throw error;
      } finally {
        modelConfigRefreshInFlightRef.current = {
          ...modelConfigRefreshInFlightRef.current,
          [targetEngine]: false,
        };
        setModelConfigRefreshingByEngine((current) => ({
          ...current,
          [targetEngine]: false,
        }));
      }
    },
    [activeEngine, addDebugEntry, refreshEngineModels, refreshModels],
  );
  const isModelConfigRefreshing = Boolean(modelConfigRefreshingByEngine[activeEngine]);
  const {
    openCodeAgents,
    resolveOpenCodeAgentForThread,
    resolveOpenCodeVariantForThread,
    selectOpenCodeAgentForThread,
    selectOpenCodeVariantForThread,
    syncActiveOpenCodeThread,
  } = useOpenCodeSelection({
    activeEngine,
    activeWorkspaceId,
    onDebug: addDebugEntry,
  });

  const handleAppModeChange = useCallback(
    (mode: AppMode) => {
      setAppMode(mode);
      closeSettings();
    },
    [closeSettings],
  );
  const {
    panels: kanbanPanels,
    tasks: kanbanTasks,
    kanbanViewState,
    setKanbanViewState,
    createPanel: kanbanCreatePanel,
    updatePanel: kanbanUpdatePanel,
    deletePanel: kanbanDeletePanel,
    createTask: kanbanCreateTask,
    updateTask: kanbanUpdateTask,
    deleteTask: kanbanDeleteTask,
    reorderTask: kanbanReorderTask,
  } = useKanbanStore(workspaces);

  const [engineSelectedModelIdByType, setEngineSelectedModelIdByType] =
    useState<Partial<Record<EngineType, string | null>>>({});
  const effectiveModels = useMemo(() => {
    return getEffectiveModels(activeEngine, models, engineModelsAsOptions);
  }, [activeEngine, models, engineModelsAsOptions]);

  useEffect(() => {
    const nextDefault = getNextEngineSelectedModelId({
      activeEngine,
      engineModelsAsOptions,
      currentSelection: engineSelectedModelIdByType[activeEngine] ?? null,
    });
    if (!nextDefault) {
      return;
    }
    setEngineSelectedModelIdByType((prev) => {
      const existing = prev[activeEngine] ?? null;
      if (nextDefault === existing) {
        return prev;
      }
      return { ...prev, [activeEngine]: nextDefault };
    });
  }, [activeEngine, engineModelsAsOptions, engineSelectedModelIdByType]);

  // Sync accessMode when switching engines (Codex forces full-access, Claude restores saved mode)
  useEffect(() => {
    if (activeEngine === "codex") {
      setAccessMode((prev) => {
        if (prev !== "full-access") {
          claudeAccessModeRef.current = prev;
        }
        return "full-access";
      });
    } else {
      setAccessMode(claudeAccessModeRef.current);
    }
  }, [activeEngine]);

  // Keep claudeAccessModeRef in sync when user changes mode on a non-codex engine
  const handleSetAccessMode = useCallback(
    (mode: AccessMode) => {
      setAccessMode(mode);
      if (activeEngine !== "codex") {
        claudeAccessModeRef.current = mode;
      }
    },
    [activeEngine],
  );

  const {
    prompts,
    createPrompt,
    updatePrompt,
    deletePrompt,
    movePrompt,
    getWorkspacePromptsDir,
    getGlobalPromptsDir,
  } = useCustomPrompts({ activeWorkspace, onDebug: addDebugEntry });
  const { commands } = useCustomCommands({
    onDebug: addDebugEntry,
    activeEngine,
    workspaceId: activeWorkspace?.id ?? null,
  });
  const workspaceFilesPollingEnabled = !isCompact && !rightPanelCollapsed && filePanelMode === "files";
  const {
    files,
    directories,
    gitignoredFiles,
    gitignoredDirectories,
    isLoading: isFilesLoading,
    loadError: fileTreeLoadError,
    refreshFiles,
  } = useWorkspaceFiles({
    activeWorkspace,
    onDebug: addDebugEntry,
    pollingEnabled: workspaceFilesPollingEnabled,
  });
  const { branches, checkoutBranch, createBranch } = useGitBranches({
    activeWorkspace,
    onDebug: addDebugEntry
  });
  const handleCheckoutBranch = async (name: string) => {
    await checkoutBranch(name);
    refreshGitStatus();
  };
  const handleCreateBranch = async (name: string) => {
    await createBranch(name);
    refreshGitStatus();
  };
  const alertError = useCallback((error: unknown) => {
    alert(error instanceof Error ? error.message : String(error));
  }, []);
  const handleOpenDetachedFileExplorer = useCallback(
    async (initialFilePath?: string | null) => {
      if (!activeWorkspace) {
        return;
      }
      try {
        await openOrFocusDetachedFileExplorer(
          buildDetachedFileExplorerSession({
            workspaceId: activeWorkspace.id,
            workspacePath: activeWorkspace.path,
            workspaceName: activeWorkspace.name,
            gitRoot: activeWorkspace.settings.gitRoot ?? null,
            initialFilePath,
          }),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        pushErrorToast({
          title: t("files.openDetachedExplorer"),
          message,
        });
      }
    },
    [activeWorkspace, t],
  );
  const {
    applyWorktreeChanges: handleApplyWorktreeChanges,
    revertAllGitChanges: handleRevertAllGitChanges,
    revertGitFile: handleRevertGitFile,
    stageGitAll: handleStageGitAll,
    stageGitFile: handleStageGitFile,
    unstageGitFile: handleUnstageGitFile,
    worktreeApplyError,
    worktreeApplyLoading,
    worktreeApplySuccess,
  } = useGitActions({
    activeWorkspace,
    onRefreshGitStatus: refreshGitStatus,
    onRefreshGitDiffs: refreshGitDiffs,
    onError: alertError,
  });
  const activeGitRoot = activeWorkspace?.settings.gitRoot ?? null;
  const handleSetGitRoot = useCallback(
    async (path: string | null) => {
      if (!activeWorkspace) {
        return;
      }
      await updateWorkspaceSettings(activeWorkspace.id, {
        gitRoot: path,
      });
      clearGitRootCandidates();
      refreshGitStatus();
    },
    [
      activeWorkspace,
      clearGitRootCandidates,
      refreshGitStatus,
      updateWorkspaceSettings,
    ],
  );
  const handlePickGitRoot = useCallback(async () => {
    if (!activeWorkspace) {
      return;
    }
    const selection = await pickWorkspacePath();
    if (!selection) {
      return;
    }
    const relativeRoot = resolveWorkspaceRelativePath(activeWorkspace.path, selection);
    const nextRoot = relativeRoot === "" ? null : relativeRoot;
    await handleSetGitRoot(nextRoot);
  }, [activeWorkspace, handleSetGitRoot]);
  const fileStatus =
    gitStatus.error
      ? t("git.statusUnavailable")
      : gitStatus.files.length > 0
        ? t("git.filesChanged", { count: gitStatus.files.length })
        : t("git.workingTreeClean");

  const { textareaHeight, onTextareaHeightChange } =
    useComposerEditorState();

  const composerEditorSettings = useMemo<ComposerEditorSettings>(
    () => ({
      preset: appSettings.composerEditorPreset,
      expandFenceOnSpace: appSettings.composerFenceExpandOnSpace,
      expandFenceOnEnter: appSettings.composerFenceExpandOnEnter,
      fenceLanguageTags: appSettings.composerFenceLanguageTags,
      fenceWrapSelection: appSettings.composerFenceWrapSelection,
      autoWrapPasteMultiline: appSettings.composerFenceAutoWrapPasteMultiline,
      autoWrapPasteCodeLike: appSettings.composerFenceAutoWrapPasteCodeLike,
      continueListOnShiftEnter: appSettings.composerListContinuation,
    }),
    [
      appSettings.composerEditorPreset,
      appSettings.composerFenceExpandOnSpace,
      appSettings.composerFenceExpandOnEnter,
      appSettings.composerFenceLanguageTags,
      appSettings.composerFenceWrapSelection,
      appSettings.composerFenceAutoWrapPasteMultiline,
      appSettings.composerFenceAutoWrapPasteCodeLike,
      appSettings.composerListContinuation,
    ],
  );


  useSyncSelectedDiffPath({
    diffSource,
    centerMode,
    gitPullRequestDiffs,
    gitCommitDiffs,
    selectedDiffPath,
    setSelectedDiffPath,
  });
  const composerSelectionResolverRef = useRef({
    model: null as string | null,
    effort: null as string | null,
    collaborationMode: null as Record<string, unknown> | null,
  });
  const resolveComposerSelection = useCallback(
    () => composerSelectionResolverRef.current,
    [],
  );

  const {
    setActiveThreadId,
    activeThreadId,
    activeItems,
    threadItemsByThread,
    historyRestoredAtMsByThread,
    approvals,
    userInputRequests,
    threadsByWorkspace,
    threadParentById,
    threadStatusById,
    historyLoadingByThreadId,
    activeTurnIdByThread,
    completionEmailIntentByThread,
    toggleCompletionEmailIntent,
    threadListLoadingByWorkspace,
    threadListPagingByWorkspace,
    threadListCursorByWorkspace,
    tokenUsageByThread,
    rateLimitsByWorkspace,
    accountByWorkspace,
    planByThread,
    lastAgentMessageByThread,
    interruptTurn,
    removeThread,
    removeThreads,
    pinThread,
    unpinThread,
    isThreadPinned,
    getPinTimestamp,
    pinnedThreadsVersion,
    renameThread,
    triggerAutoThreadTitle,
    isThreadAutoNaming,
    startThreadForWorkspace,
    forkThreadForWorkspace,
    forkSessionFromMessageForWorkspace,
    forkClaudeSessionFromMessageForWorkspace,
    listThreadsForWorkspace,
    loadOlderThreadsForWorkspace,
    resetWorkspaceThreads,
    refreshThread,
    sendUserMessage,
    sendUserMessageToThread,
    handleFusionStalled,
    startFork,
    startReview,
    startResume,
    startMcp,
    startSpecRoot,
    startStatus,
    startContext,
    startCompact,
    startFast,
    startMode,
    startExport,
    startImport,
    startLsp,
    startShare,
    startSharedSessionForWorkspace,
    updateSharedSessionEngineSelection,
    resolveCanonicalThreadId,
    reviewPrompt,
    closeReviewPrompt,
    showPresetStep,
    choosePreset,
    highlightedPresetIndex,
    setHighlightedPresetIndex,
    highlightedBranchIndex,
    setHighlightedBranchIndex,
    highlightedCommitIndex,
    setHighlightedCommitIndex,
    handleReviewPromptKeyDown,
    confirmBranch,
    selectBranch,
    selectBranchAtIndex,
    selectCommit,
    selectCommitAtIndex,
    confirmCommit,
    updateCustomInstructions,
    confirmCustom,
    handleApprovalBatchAccept,
    handleApprovalDecision,
    handleApprovalRemember,
    handleUserInputSubmit,
    refreshAccountInfo,
    refreshAccountRateLimits,
  } = useThreads({
    activeWorkspace,
    onWorkspaceConnected: markWorkspaceConnected,
    onDebug: addDebugEntry,
    model: null,
    effort: null,
    collaborationMode: null,
    resolveComposerSelection,
    accessMode,
    steerEnabled: appSettings.experimentalSteerEnabled,
    customPrompts: prompts,
    onMessageActivity: queueGitStatusRefresh,
    activeEngine,
    useNormalizedRealtimeAdapters: appSettings.chatCanvasUseNormalizedRealtime,
    useUnifiedHistoryLoader: appSettings.chatCanvasUseUnifiedHistoryLoader,
    resolveOpenCodeAgent: resolveOpenCodeAgentForThread,
    resolveOpenCodeVariant: resolveOpenCodeVariantForThread,
    resolveCollaborationUiMode,
    resolveCollaborationRuntimeMode,
    onCollaborationModeResolved: handleCollaborationModeResolved,
    runWithCreateSessionLoading,
  });

  useEffect(() => {
    syncActiveOpenCodeThread(activeThreadId);
  }, [activeThreadId, syncActiveOpenCodeThread]);

  const selectedOpenCodeAgent = useMemo(
    () => resolveOpenCodeAgentForThread(activeThreadId),
    [activeThreadId, resolveOpenCodeAgentForThread],
  );

  const selectedOpenCodeVariant = useMemo(
    () => resolveOpenCodeVariantForThread(activeThreadId),
    [activeThreadId, resolveOpenCodeVariantForThread],
  );

  const handleSelectOpenCodeAgent = useCallback(
    (agentId: string | null) => {
      selectOpenCodeAgentForThread(activeThreadId, agentId);
    },
    [activeThreadId, selectOpenCodeAgentForThread],
  );

  const handleSelectOpenCodeVariant = useCallback(
    (variant: string | null) => {
      selectOpenCodeVariantForThread(activeThreadId, variant);
    },
    [activeThreadId, selectOpenCodeVariantForThread],
  );

  const {
    selectedComposerSelection,
    handleSelectComposerSelection,
    persistComposerSelectionForThread,
    resolveComposerSelectionForThread,
  } = useSelectedComposerSession({
    activeThreadId,
    activeWorkspaceId,
    resolveCanonicalThreadId,
    onDebug: addDebugEntry,
  });
  const hasActiveComposerThread = activeThreadId !== null;
  const effectiveSelectedModelId = useMemo(() => {
    return getEffectiveSelectedModelId({
      activeEngine,
      selectedModelId,
      activeThreadSelectedModelId: selectedComposerSelection?.modelId ?? null,
      hasActiveThread: hasActiveComposerThread,
      codexModels: models,
      engineModelsAsOptions,
      engineSelectedModelIdByType,
      defaultClaudeModelId: DEFAULT_CLAUDE_MODEL_ID,
    });
  }, [
    activeEngine,
    models,
    engineModelsAsOptions,
    engineSelectedModelIdByType,
    hasActiveComposerThread,
    selectedComposerSelection,
    selectedModelId,
  ]);
  const effectiveSelectedModel = useMemo(() => {
    return effectiveModels.find((model) => model.id === effectiveSelectedModelId) ?? null;
  }, [effectiveModels, effectiveSelectedModelId]);
  const persistedGlobalComposerModelId = useMemo(() => {
    return getEffectiveSelectedModelId({
      activeEngine: "codex",
      selectedModelId,
      activeThreadSelectedModelId: null,
      hasActiveThread: false,
      codexModels: models,
      engineModelsAsOptions: [],
      engineSelectedModelIdByType: {},
      defaultClaudeModelId: DEFAULT_CLAUDE_MODEL_ID,
    });
  }, [models, selectedModelId]);
  const persistedGlobalComposerModel = useMemo(() => {
    return (
      models.find((model) => model.id === persistedGlobalComposerModelId) ?? null
    );
  }, [models, persistedGlobalComposerModelId]);
  const persistedGlobalComposerReasoningOptions = useMemo(() => {
    return getReasoningOptionsForModel(persistedGlobalComposerModel);
  }, [persistedGlobalComposerModel]);
  const persistedGlobalComposerEffort = useMemo(() => {
    return getEffectiveSelectedEffort({
      activeEngine: "codex",
      hasActiveThread: false,
      selectedEffort,
      activeThreadSelection: null,
      reasoningOptions: persistedGlobalComposerReasoningOptions,
    });
  }, [persistedGlobalComposerReasoningOptions, selectedEffort]);
  const effectiveReasoningOptions = useMemo(() => {
    return getReasoningOptionsForModel(effectiveSelectedModel);
  }, [effectiveSelectedModel]);
  const effectiveReasoningSupported = useMemo(() => {
    return getEffectiveReasoningSupported(activeEngine, effectiveReasoningOptions.length > 0);
  }, [activeEngine, effectiveReasoningOptions.length]);
  const effectiveSelectedEffort = useMemo(() => {
    return getEffectiveSelectedEffort({
      activeEngine,
      hasActiveThread: hasActiveComposerThread,
      selectedEffort,
      activeThreadSelection: selectedComposerSelection,
      reasoningOptions: effectiveReasoningOptions,
    });
  }, [
    activeEngine,
    effectiveReasoningOptions,
    hasActiveComposerThread,
    selectedEffort,
    selectedComposerSelection,
  ]);
  const resolvedModel = effectiveSelectedModel?.model ?? effectiveSelectedModelId ?? null;
  const resolvedEffort = effectiveReasoningSupported ? effectiveSelectedEffort : null;
  const handleSelectModel = useCallback(
    (id: string | null) => {
      if (id === null) {
        return;
      }
      const nextSelectedModel =
        effectiveModels.find((model) => model.id === id) ?? null;
      if (!nextSelectedModel) {
        return;
      }
      const nextSelectedEffort =
        activeEngine === "codex"
          ? getEffectiveSelectedEffort({
              activeEngine: "codex",
              hasActiveThread: hasActiveComposerThread,
              selectedEffort: effectiveSelectedEffort,
              activeThreadSelection: hasActiveComposerThread
                ? {
                    modelId: nextSelectedModel.id,
                    effort: effectiveSelectedEffort,
                  }
                : null,
              reasoningOptions: getReasoningOptionsForModel(nextSelectedModel),
            })
          : effectiveSelectedEffort;
      if (import.meta.env.DEV) {
        console.info("[model/select]", {
          activeEngine,
          selectedModelId: nextSelectedModel.id,
        });
      }
      if (activeEngine === "codex" && !hasActiveComposerThread) {
        setSelectedModelId(nextSelectedModel.id);
      } else if (activeEngine !== "codex") {
        setEngineSelectedModelIdByType((prev) => ({
          ...prev,
          [activeEngine]: nextSelectedModel.id,
        }));
      }
      handleSelectComposerSelection({
        modelId: nextSelectedModel.id,
        effort: nextSelectedEffort,
      });
    },
    [
      activeEngine,
      effectiveModels,
      effectiveSelectedEffort,
      handleSelectComposerSelection,
      hasActiveComposerThread,
      setSelectedModelId,
    ],
  );
  const handleSelectComposerEffort = useCallback(
    (effort: string | null) => {
      const nextEffort =
        activeEngine === "codex"
          ? getEffectiveSelectedEffort({
              activeEngine: "codex",
              hasActiveThread: hasActiveComposerThread,
              selectedEffort: effort,
              activeThreadSelection: hasActiveComposerThread
                ? {
                    modelId: effectiveSelectedModelId,
                    effort,
                  }
                : null,
              reasoningOptions: effectiveReasoningOptions,
            })
          : effort;
      if (!(activeEngine === "codex" && hasActiveComposerThread)) {
        setSelectedEffort(nextEffort);
      }
      handleSelectComposerSelection({
        modelId: effectiveSelectedModelId,
        effort: nextEffort,
      });
    },
    [
      activeEngine,
      effectiveSelectedModelId,
      effectiveReasoningOptions,
      handleSelectComposerSelection,
      hasActiveComposerThread,
      setSelectedEffort,
    ],
  );
  const { collaborationModePayload } = useCollaborationModeSelection({
    selectedCollaborationMode,
    selectedCollaborationModeId,
    selectedEffort: resolvedEffort,
    resolvedModel,
  });
  const threadAccessMode = accessMode;
  composerSelectionResolverRef.current = {
    model: resolvedModel,
    effort: resolvedEffort,
    collaborationMode: collaborationModePayload,
  };
  useEffect(() => {
    if (
      activeEngine !== "codex" ||
      !activeThreadId ||
      !selectedComposerSelection ||
      !modelsReady
    ) {
      return;
    }
    const needsModelRepair =
      selectedComposerSelection.modelId !== null &&
      selectedComposerSelection.modelId !== effectiveSelectedModelId;
    const needsEffortRepair =
      selectedComposerSelection.effort !== effectiveSelectedEffort;
    if (!needsModelRepair && !needsEffortRepair) {
      return;
    }
    persistComposerSelectionForThread(activeWorkspaceId, activeThreadId, {
      modelId: effectiveSelectedModelId,
      effort: effectiveSelectedEffort,
    });
  }, [
    activeEngine,
    activeThreadId,
    activeWorkspaceId,
    effectiveSelectedEffort,
    effectiveSelectedModelId,
    modelsReady,
    persistComposerSelectionForThread,
    selectedComposerSelection,
  ]);
  usePersistComposerSettings({
    enabled: !hasActiveComposerThread,
    appSettingsLoading,
    selectionReady: globalSelectionReady,
    selectedModelId: persistedGlobalComposerModelId,
    selectedEffort: persistedGlobalComposerEffort,
    setAppSettings,
    queueSaveSettings,
  });
  useComposerShortcuts({
    textareaRef: composerInputRef,
    modelShortcut: appSettings.composerModelShortcut,
    accessShortcut: appSettings.composerAccessShortcut,
    reasoningShortcut: appSettings.composerReasoningShortcut,
    collaborationShortcut: appSettings.composerCollaborationShortcut,
    models: effectiveModels,
    collaborationModes,
    selectedModelId: effectiveSelectedModelId,
    onSelectModel: handleSelectModel,
    selectedCollaborationModeId,
    onSelectCollaborationMode: applySelectedCollaborationMode,
    accessMode,
    onSelectAccessMode: handleSetAccessMode,
    reasoningOptions: effectiveReasoningOptions,
    selectedEffort: effectiveSelectedEffort,
    onSelectEffort: handleSelectComposerEffort,
    reasoningSupported: effectiveReasoningSupported,
  });
  useComposerMenuActions({
    models: effectiveModels,
    selectedModelId: effectiveSelectedModelId,
    onSelectModel: handleSelectModel,
    collaborationModes,
    selectedCollaborationModeId,
    onSelectCollaborationMode: applySelectedCollaborationMode,
    accessMode,
    onSelectAccessMode: handleSetAccessMode,
    reasoningOptions: effectiveReasoningOptions,
    selectedEffort: effectiveSelectedEffort,
    onSelectEffort: handleSelectComposerEffort,
    reasoningSupported: effectiveReasoningSupported,
    onFocusComposer: () => composerInputRef.current?.focus(),
  });
  const {
    selectedAgent,
    selectedAgentRef,
    handleSelectAgent,
    reloadSelectedAgent,
    reloadAgentCatalog,
  } = useSelectedAgentSession({
    activeThreadId,
    activeWorkspaceId,
    resolveCanonicalThreadId,
    onDebug: addDebugEntry,
  });

  const claudeModelRefreshThreadKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const refreshKey = resolveClaudePendingThreadModelRefreshKey({
      activeEngine,
      activeThreadId,
      activeWorkspaceId,
    });
    if (!refreshKey) {
      return;
    }
    if (claudeModelRefreshThreadKeyRef.current === refreshKey) {
      return;
    }
    claudeModelRefreshThreadKeyRef.current = refreshKey;
    addDebugEntry({
      id: `${Date.now()}-claude-model-refresh-on-new-thread`,
      timestamp: Date.now(),
      source: "client",
      label: "engine/models refresh on new claude thread",
      payload: { workspaceId: activeWorkspaceId, threadId: activeThreadId },
    });
    void refreshEngineModels("claude");
  }, [activeEngine, activeThreadId, activeWorkspaceId, addDebugEntry, refreshEngineModels]);

  const {
    handleUserInputSubmitWithPlanApply,
    handleExitPlanModeExecute,
  } = usePlanApplyHandlers({
    activeEngine,
    applySelectedCollaborationMode,
    handleSetAccessMode,
    handleUserInputSubmit,
    interruptTurn,
    resolveCollaborationRuntimeMode,
    resolveCollaborationUiMode,
    resolvedEffort,
    resolvedModel,
    selectedCollaborationModeId,
    sendUserMessage,
  });
  const {
    activeAccount,
    accountSwitching,
    handleSwitchAccount,
    handleCancelSwitchAccount,
  } = useAccountSwitching({
    activeWorkspaceId,
    accountByWorkspace,
    refreshAccountInfo,
    refreshAccountRateLimits,
    alertError,
  });
  const activeThreadIdRef = useRef<string | null>(activeThreadId ?? null);
  const { getThreadRows } = useThreadRows(threadParentById);
  useEffect(() => {
    activeThreadIdRef.current = activeThreadId ?? null;
  }, [activeThreadId]);

  useEffect(() => {
    void reloadAgentCatalog();
  }, [reloadAgentCatalog]);

  useEffect(() => {
    if (!settingsOpen) {
      forceRefreshAgents();
      void reloadAgentCatalog();
    }
  }, [reloadAgentCatalog, settingsOpen]);

  useAutoExitEmptyDiff({
    centerMode,
    autoExitEnabled: diffSource === "local",
    activeDiffCount: activeDiffs.length,
    activeDiffLoading,
    activeDiffError,
    activeThreadId,
    isCompact,
    setCenterMode,
    setSelectedDiffPath,
    setActiveTab,
  });

  const { handleCopyThread } = useCopyThread({
    activeItems,
    onDebug: addDebugEntry,
  });

  const {
    renamePrompt,
    openRenamePrompt,
    handleRenamePromptChange,
    handleRenamePromptCancel,
    handleRenamePromptConfirm,
  } = useRenameThreadPrompt({
    threadsByWorkspace,
    renameThread,
  });

  const {
    deletePrompt: deleteThreadPrompt,
    isDeleting: isDeleteThreadPromptBusy,
    openDeletePrompt: openDeleteThreadPrompt,
    handleDeletePromptCancel: handleDeleteThreadPromptCancel,
    handleDeletePromptConfirm: handleDeleteThreadPromptConfirm,
  } = useDeleteThreadPrompt({
    threadsByWorkspace,
    removeThread,
    onDeleteSuccess: (threadId) => {
      clearDraftForThread(threadId);
      removeImagesForThread(threadId);
    },
    onDeleteError: (message) => {
      alertError(message ?? t("workspace.deleteConversationFailed"));
    },
  });

  const {
    renamePrompt: renameWorktreePrompt,
    notice: renameWorktreeNotice,
    upstreamPrompt: renameWorktreeUpstreamPrompt,
    confirmUpstream: confirmRenameWorktreeUpstream,
    openRenamePrompt: openRenameWorktreePrompt,
    handleRenameChange: handleRenameWorktreeChange,
    handleRenameCancel: handleRenameWorktreeCancel,
    handleRenameConfirm: handleRenameWorktreeConfirm,
  } = useRenameWorktreePrompt({
    workspaces,
    activeWorkspaceId,
    renameWorktree,
    renameWorktreeUpstream,
    onRenameSuccess: (workspace) => {
      resetWorkspaceThreads(workspace.id);
      void listThreadsForWorkspaceTracked(workspace);
      if (activeThreadId && activeWorkspaceId === workspace.id) {
        void refreshThread(workspace.id, activeThreadId);
      }
    },
  });

  const handleRenameThread = useCallback(
    (workspaceId: string, threadId: string) => {
      openRenamePrompt(workspaceId, threadId);
    },
    [openRenamePrompt],
  );

  const handleOpenRenameWorktree = useCallback(() => {
    if (activeWorkspace) {
      openRenameWorktreePrompt(activeWorkspace.id);
    }
  }, [activeWorkspace, openRenameWorktreePrompt]);

  const {
    terminalTabs,
    activeTerminalId,
    onSelectTerminal,
    onNewTerminal,
    onCloseTerminal,
    terminalState,
    ensureTerminalWithTitle,
    restartTerminalSession,
  } = useTerminalController({
    activeWorkspaceId,
    activeWorkspace,
    terminalOpen,
    onCloseTerminalPanel: closeTerminalPanel,
    onDebug: addDebugEntry,
  });

  const ensureLaunchTerminal = useCallback(
    (workspaceId: string) => ensureTerminalWithTitle(workspaceId, "launch", "Launch"),
    [ensureTerminalWithTitle],
  );
  const launchScriptState = useWorkspaceLaunchScript({
    activeWorkspace,
    updateWorkspaceSettings,
    openTerminal,
    ensureLaunchTerminal,
    restartLaunchSession: restartTerminalSession,
    terminalState,
    activeTerminalId,
  });
  const runtimeRunState = useWorkspaceRuntimeRun({ activeWorkspace });

  const handleToggleRuntimeConsole = useCallback(() => {
    if (runtimeRunState.runtimeConsoleVisible) {
      runtimeRunState.onCloseRuntimeConsole();
      return;
    }
    closeTerminalPanel();
    runtimeRunState.onOpenRuntimeConsole();
  }, [
    closeTerminalPanel,
    runtimeRunState,
  ]);

  const handleToggleTerminalPanel = useCallback(() => {
    if (!terminalOpen) {
      runtimeRunState.onCloseRuntimeConsole();
    }
    handleToggleTerminal();
  }, [handleToggleTerminal, runtimeRunState, terminalOpen]);

  useEffect(() => {
    if (!terminalOpen || !runtimeRunState.runtimeConsoleVisible) {
      return;
    }
    closeTerminalPanel();
  }, [closeTerminalPanel, runtimeRunState.runtimeConsoleVisible, terminalOpen]);

  const launchScriptsState = useWorkspaceLaunchScripts({
    activeWorkspace,
    updateWorkspaceSettings,
    openTerminal,
    ensureLaunchTerminal: (workspaceId, entry, title) => {
      const label = entry.label?.trim() || entry.icon;
      return ensureTerminalWithTitle(
        workspaceId,
        `launch:${entry.id}`,
        title || `Launch ${label}`,
      );
    },
    restartLaunchSession: restartTerminalSession,
    terminalState,
    activeTerminalId,
  });

  const worktreeSetupScriptState = useWorktreeSetupScript({
    ensureTerminalWithTitle,
    restartTerminalSession,
    openTerminal,
    onDebug: addDebugEntry,
  });

  const handleWorktreeCreated = useCallback(
    async (worktree: WorkspaceInfo, _parentWorkspace?: WorkspaceInfo) => {
      await worktreeSetupScriptState.maybeRunWorktreeSetupScript(worktree);
    },
    [worktreeSetupScriptState],
  );

  const { exitDiffView, selectWorkspace, selectHome } = useWorkspaceSelection({
    workspaces,
    isCompact,
    activeWorkspaceId,
    setActiveTab,
    setActiveWorkspaceId,
    updateWorkspaceSettings,
    setCenterMode,
    setSelectedDiffPath,
  });
  const {
    worktreePrompt,
    worktreeCreateResult,
    openPrompt: openWorktreePrompt,
    confirmPrompt: confirmWorktreePrompt,
    cancelPrompt: cancelWorktreePrompt,
    closeWorktreeCreateResult,
    updateBranch: updateWorktreeBranch,
    updateBaseRef: updateWorktreeBaseRef,
    updatePublishToOrigin: updateWorktreePublishToOrigin,
    updateSetupScript: updateWorktreeSetupScript,
  } = useWorktreePrompt({
    addWorktreeAgent,
    updateWorkspaceSettings,
    connectWorkspace,
    onSelectWorkspace: selectWorkspace,
    onWorktreeCreated: handleWorktreeCreated,
    onCompactActivate: isCompact ? () => setActiveTab("codex") : undefined,
    onError: (message) => {
      addDebugEntry({
        id: `${Date.now()}-client-add-worktree-error`,
        timestamp: Date.now(),
        source: "error",
        label: "worktree/add error",
        payload: message,
      });
    },
  });

  const resolveCloneProjectContext = useCallback(
    (workspace: WorkspaceInfo) => {
      const groupId = workspace.settings.groupId ?? null;
      const group = groupId
        ? appSettings.workspaceGroups.find((entry) => entry.id === groupId)
        : null;
      return {
        groupId,
        copiesFolder: group?.copiesFolder ?? null,
      };
    },
    [appSettings.workspaceGroups],
  );

  const handleSelectOpenAppId = useCallback(
    (id: string) => {
      writeClientStoreValue("app", "openWorkspaceApp", id);
      setAppSettings((current) => {
        if (current.selectedOpenAppId === id) {
          return current;
        }
        const nextSettings = {
          ...current,
          selectedOpenAppId: id,
        };
        void queueSaveSettings(nextSettings);
        return nextSettings;
      });
    },
    [queueSaveSettings, setAppSettings],
  );

  const navigateToThreadWithUiOptions = useCallback(
    (
      workspaceId: string,
      threadId: string,
      options: {
        collapseRightPanel?: boolean;
      } = {},
    ) => {
      const { collapseRightPanel: shouldCollapseRightPanel = true } = options;
      exitDiffView();
      setAppMode("chat");
      setActiveTab("codex");
      setHomeOpen(false);
      if (shouldCollapseRightPanel) {
        collapseRightPanel();
      }
      setSelectedKanbanTaskId(null);
      selectWorkspace(workspaceId);
      setActiveThreadId(threadId, workspaceId);
      const threads = threadsByWorkspace[workspaceId] ?? [];
      const targetThread = threads.find((entry) => entry.id === threadId);
      if (targetThread?.engineSource) {
        setActiveEngine(targetThread.engineSource);
      }
    },
    [
      exitDiffView,
      collapseRightPanel,
      setHomeOpen,
      setAppMode,
      selectWorkspace,
      setActiveEngine,
      setActiveTab,
      setActiveThreadId,
      threadsByWorkspace,
    ],
  );

  const navigateToThread = useCallback(
    (workspaceId: string, threadId: string) => {
      navigateToThreadWithUiOptions(workspaceId, threadId);
    },
    [navigateToThreadWithUiOptions],
  );

  // Register system notification click handler to navigate to the completed thread
  useEffect(() => {
    setNotificationActionHandler((extra) => {
      const workspaceId = typeof extra.workspaceId === "string" ? extra.workspaceId : undefined;
      const threadId = typeof extra.threadId === "string" ? extra.threadId : undefined;
      if (workspaceId && threadId) {
        navigateToThread(workspaceId, threadId);
      }
    });
  }, [navigateToThread]);

  const handleSelectStatusPanelSubagent = useCallback(
    (agent: SubagentInfo) => {
      const target = agent.navigationTarget;
      if (!target) {
        return;
      }
      if (target.kind === "thread") {
        if (!activeWorkspaceId) {
          return;
        }
        navigateToThreadWithUiOptions(activeWorkspaceId, target.threadId, {
          collapseRightPanel: false,
        });
        return;
      }
      if (target.kind === "claude-task") {
        exitDiffView();
        setAppMode("chat");
        setCenterMode("chat");
        setActiveTab("codex");
        setAgentTaskScrollRequest({
          nonce: Date.now(),
          taskId: target.taskId ?? null,
          toolUseId: target.toolUseId ?? null,
        });
      }
    },
    [
      activeWorkspaceId,
      exitDiffView,
      navigateToThreadWithUiOptions,
      setActiveTab,
      setCenterMode,
    ],
  );

  const openAppIconById = EMPTY_OPEN_APP_ICON_MAP;

  const persistProjectCopiesFolder = useCallback(
    async (groupId: string, copiesFolder: string) => {
      await queueSaveSettings({
        ...appSettings,
        workspaceGroups: appSettings.workspaceGroups.map((entry) =>
          entry.id === groupId ? { ...entry, copiesFolder } : entry,
        ),
      });
    },
    [appSettings, queueSaveSettings],
  );

  const {
    clonePrompt,
    openPrompt: openClonePrompt,
    confirmPrompt: confirmClonePrompt,
    cancelPrompt: cancelClonePrompt,
    updateCopyName: updateCloneCopyName,
    chooseCopiesFolder: chooseCloneCopiesFolder,
    useSuggestedCopiesFolder: useSuggestedCloneCopiesFolder,
    clearCopiesFolder: clearCloneCopiesFolder,
  } = useClonePrompt({
    addCloneAgent,
    connectWorkspace,
    onSelectWorkspace: selectWorkspace,
    resolveProjectContext: resolveCloneProjectContext,
    persistProjectCopiesFolder,
    onCompactActivate: isCompact ? () => setActiveTab("codex") : undefined,
    onError: (message) => {
      addDebugEntry({
        id: `${Date.now()}-client-add-clone-error`,
        timestamp: Date.now(),
        source: "error",
        label: "clone/add error",
        payload: message,
      });
    },
  });

  const latestAgentRuns = useMemo(() => {
    const entries: Array<{
      threadId: string;
      message: string;
      timestamp: number;
      projectName: string;
      groupName?: string | null;
      workspaceId: string;
      isProcessing: boolean;
    }> = [];
    workspaces.forEach((workspace) => {
      const threads = threadsByWorkspace[workspace.id] ?? [];
      threads.forEach((thread) => {
        const entry = lastAgentMessageByThread[thread.id];
        if (entry) {
          entries.push({
            threadId: thread.id,
            message: entry.text,
            timestamp: entry.timestamp,
            projectName: workspace.name,
            groupName: getWorkspaceGroupName(workspace.id),
            workspaceId: workspace.id,
            isProcessing: threadStatusById[thread.id]?.isProcessing ?? false
          });
        } else if (thread.id.startsWith("claude:")) {
          entries.push({
            threadId: thread.id,
            message: thread.name,
            timestamp: thread.updatedAt,
            projectName: workspace.name,
            groupName: getWorkspaceGroupName(workspace.id),
            workspaceId: workspace.id,
            isProcessing: false
          });
        }
      });
    });
    return entries.sort((a, b) => b.timestamp - a.timestamp).slice(0, 3);
  }, [
    lastAgentMessageByThread,
    getWorkspaceGroupName,
    threadStatusById,
    threadsByWorkspace,
    workspaces
  ]);
  const isLoadingLatestAgents = useMemo(
    () =>
      !hasLoaded ||
      workspaces.some(
        (workspace) => threadListLoadingByWorkspace[workspace.id] ?? false
      ),
    [hasLoaded, threadListLoadingByWorkspace, workspaces]
  );

  const activeRateLimits = activeWorkspaceId
    ? rateLimitsByWorkspace[activeWorkspaceId] ?? null
    : null;
  const activeTokenUsage = activeThreadId
    ? tokenUsageByThread[activeThreadId] ?? null
    : null;
  const timelinePlan = useMemo(
    () => extractPlanFromTimelineItems(activeItems),
    [activeItems],
  );
  const activePlan = activeThreadId
    ? timelinePlan ?? planByThread[activeThreadId] ?? null
    : timelinePlan;
  useEffect(() => {
    activeThreadIdForModeRef.current = activeThreadId;
  }, [activeThreadId, activeThreadIdForModeRef]);

  useEffect(() => {
    const syncResult = resolveThreadScopedCollaborationModeSync({
      activeEngine,
      activeThreadId,
      mappedMode: activeThreadId
        ? collaborationUiModeByThread[activeThreadId] ?? null
        : null,
      selectedCollaborationModeId,
      lastSyncedThreadId: lastCodexModeSyncThreadRef.current,
    });
    if (!syncResult) {
      return;
    }
    lastCodexModeSyncThreadRef.current = syncResult.nextSyncedThreadId;
    codexComposerModeRef.current = syncResult.nextMode;
    if (syncResult.shouldUpdateSelectedMode && syncResult.nextMode) {
      setSelectedCollaborationModeId(syncResult.nextMode);
      return;
    }
  }, [
    activeEngine,
    activeThreadId,
    codexComposerModeRef,
    collaborationUiModeByThread,
    lastCodexModeSyncThreadRef,
    selectedCollaborationModeId,
    setSelectedCollaborationModeId,
  ]);
  const isPlanMode = selectedCollaborationMode?.mode === "plan";
  const hasPlanData = Boolean(
    activePlan && (activePlan.steps.length > 0 || activePlan.explanation)
  );
  const [isPlanPanelDismissed, setIsPlanPanelDismissed] = useState(false);
  const hasActivePlan = hasPlanData && !isPlanPanelDismissed;
  useEffect(() => {
    setIsPlanPanelDismissed(false);
  }, [activeThreadId]);
  const openPlanPanel = useCallback(() => {
    setIsPlanPanelDismissed(false);
    expandRightPanel();
  }, [expandRightPanel]);
  const closePlanPanel = useCallback(() => {
    setIsPlanPanelDismissed(true);
  }, []);
  const showKanban = appMode === "kanban";
  const showGitHistory = appMode === "gitHistory";
  const [selectedKanbanTaskId, setSelectedKanbanTaskId] = useState<string | null>(null);
  const [workspaceHomeWorkspaceId, setWorkspaceHomeWorkspaceId] = useState<string | null>(null);
  const showHome = (!activeWorkspace || homeOpen) && !showKanban;
  const showWorkspaceHome = Boolean(
    activeWorkspace &&
      !showHome &&
      workspaceHomeWorkspaceId === activeWorkspace.id &&
      !activeThreadId &&
      appMode === "chat" &&
      (isCompact ? (isTablet ? tabletTab : activeTab) === "codex" : activeTab !== "spec"),
  );
  useEffect(() => {
    if (!showHome || activeWorkspaceId || !homeWorkspaceDefaultId) {
      return;
    }
    setActiveWorkspaceId(homeWorkspaceDefaultId);
    setActiveThreadId(null, homeWorkspaceDefaultId);
  }, [
    activeWorkspaceId,
    homeWorkspaceDefaultId,
    setActiveThreadId,
    setActiveWorkspaceId,
    showHome,
  ]);
  useEffect(() => {
    if (
      !shouldHideHomeOnThreadActivation({
        homeOpen,
        activeThreadId,
      })
    ) {
      return;
    }
    setHomeOpen(false);
  }, [
    activeThreadId,
    homeOpen,
    setHomeOpen,
  ]);
  const canInterrupt = activeThreadId
    ? threadStatusById[activeThreadId]?.isProcessing ?? false
    : false;
  const isProcessing = activeThreadId
    ? threadStatusById[activeThreadId]?.isProcessing ?? false
    : false;
  const isReviewing = activeThreadId
    ? threadStatusById[activeThreadId]?.isReviewing ?? false
    : false;
  const activeTurnId = activeThreadId
    ? activeTurnIdByThread[activeThreadId] ?? null
    : null;
  const {
    activeImages,
    attachImages,
    pickImages,
    removeImage,
    clearActiveImages,
    removeImagesForThread,
    activeQueue,
    activeQueuedHandoffBubble,
    handleSend,
    queueMessage,
    prefillDraft,
    setPrefillDraft,
    composerInsert,
    setComposerInsert,
    activeDraft,
    handleDraftChange,
    handleSendPrompt,
    handleEditQueued,
    handleDeleteQueued,
    handleFuseQueued,
    canFuseActiveQueue,
    activeFusingMessageId,
    clearDraftForThread,
  } = useComposerController({
    activeThreadId,
    activeTurnId,
    activeContinuationPulse: activeThreadId
      ? (threadStatusById[activeThreadId]?.continuationPulse ?? 0)
      : 0,
    activeTerminalPulse: activeThreadId
      ? (threadStatusById[activeThreadId]?.terminalPulse ?? 0)
      : 0,
    activeWorkspaceId,
    activeWorkspace,
    isProcessing,
    isReviewing,
    steerEnabled: appSettings.experimentalSteerEnabled,
    activeEngine,
    connectWorkspace,
    startThreadForWorkspace,
    sendUserMessage,
    sendUserMessageToThread,
    handleFusionStalled,
    startFork,
    startReview,
    startResume,
    startMcp,
    startSpecRoot,
    startStatus,
    startContext,
    startCompact,
    startFast,
    startMode,
    startExport,
    startImport,
    startLsp,
    startShare,
    setCodexCollaborationMode,
    getCodexCollaborationMode: () => {
      const threadMode = activeThreadId
        ? collaborationUiModeByThread[activeThreadId] ?? null
        : null;
      if (threadMode === "plan" || threadMode === "code") {
        return threadMode;
      }
      if (selectedCollaborationModeId === "plan" || selectedCollaborationModeId === "code") {
        return selectedCollaborationModeId;
      }
      return "code";
    },
    getCodexCollaborationPayload: () => collaborationModePayload,
    interruptTurn,
  });

  const {
    activePath,
    activeWorkspaceKanbanTasks,
    activeWorkspaceThreads,
    ensureWorkspaceThreadListLoaded,
    handleEnsureWorkspaceThreadsForSettings,
    handleInsertComposerText,
    historySearchItems,
    hydratedThreadListWorkspaceIdsRef,
    listThreadsForWorkspaceTracked,
    lockLiveSessions,
    perfSnapshotRef,
    RECENT_THREAD_LIMIT,
    recentThreads,
    scopedKanbanTasks,
    searchResults,
    sessionRadarFeed,
    workspaceActivity,
    workspaceNameByPath,
    workspaceSearchSources,
  } = useAppShellSearchRadarSection({
    activeDraft,
    activeItems,
    activeThreadId,
    activeWorkspace,
    activeWorkspaceId,
    appSettings,
    commands,
    composerInputRef,
    completionTrackerBySessionRef,
    completionTrackerReadyRef,
    directories,
    filePanelMode,
    files,
    globalSearchFilesByWorkspace,
    handleDraftChange,
    isCompact,
    isFilesLoading,
    isProcessing,
    isSearchPaletteOpen,
    kanbanTasks,
    lastAgentMessageByThread,
    listThreadsForWorkspace,
    rightPanelCollapsed,
    searchContentFilters,
    searchPaletteQuery,
    searchScope,
    setGlobalSearchFilesByWorkspace,
    skills,
    t,
    threadItemsByThread,
    threadListLoadingByWorkspace,
    threadParentById,
    threadStatusById,
    threadsByWorkspace,
    workspaces,
    workspacesById,
  });

  const {
    commitMessage,
    commitMessageLoading,
    commitMessageError,
    commitLoading,
    pushLoading,
    syncLoading,
    commitError,
    pushError,
    syncError,
    onCommitMessageChange: handleCommitMessageChange,
    onGenerateCommitMessage: handleGenerateCommitMessage,
    onCommit: handleCommit,
    onCommitAndPush: handleCommitAndPush,
    onCommitAndSync: handleCommitAndSync,
    onPush: handlePush,
    onSync: handleSync,
  } = useGitCommitController({
    activeWorkspace,
    activeWorkspaceId,
    activeWorkspaceIdRef,
    gitStatus,
    refreshGitStatus,
    refreshGitLog,
  });

  const {
    handleSendPromptToNewAgent,
    handleCreatePrompt,
    handleUpdatePrompt,
    handleDeletePrompt,
    handleMovePrompt,
    handleRevealWorkspacePrompts,
    handleRevealGeneralPrompts,
  } = useAppShellPromptActionsSection({
    activeWorkspace,
    alertError,
    connectWorkspace,
    createPrompt,
    deletePrompt,
    getGlobalPromptsDir,
    getWorkspacePromptsDir,
    movePrompt,
    sendUserMessageToThread,
    startThreadForWorkspace,
    updatePrompt,
  });

  const isWorktreeWorkspace = activeWorkspace?.kind === "worktree";
  const activeParentWorkspace = isWorktreeWorkspace
    ? workspacesById.get(activeWorkspace?.parentId ?? "") ?? null
    : null;
  const worktreeLabel = isWorktreeWorkspace
    ? activeWorkspace?.worktree?.branch ?? activeWorkspace?.name ?? null
    : null;
  const activeRenamePrompt =
    renameWorktreePrompt?.workspaceId === activeWorkspace?.id
      ? renameWorktreePrompt
      : null;
  const worktreeRename =
    isWorktreeWorkspace && activeWorkspace
      ? {
          name: activeRenamePrompt?.name ?? worktreeLabel ?? "",
          error: activeRenamePrompt?.error ?? null,
          notice: renameWorktreeNotice,
          isSubmitting: activeRenamePrompt?.isSubmitting ?? false,
          isDirty: activeRenamePrompt
            ? activeRenamePrompt.name.trim() !==
              activeRenamePrompt.originalName.trim()
            : false,
          upstream:
            renameWorktreeUpstreamPrompt?.workspaceId === activeWorkspace.id
              ? {
                  oldBranch: renameWorktreeUpstreamPrompt.oldBranch,
                  newBranch: renameWorktreeUpstreamPrompt.newBranch,
                  error: renameWorktreeUpstreamPrompt.error,
                  isSubmitting: renameWorktreeUpstreamPrompt.isSubmitting,
                  onConfirm: confirmRenameWorktreeUpstream,
                }
              : null,
          onFocus: handleOpenRenameWorktree,
          onChange: handleRenameWorktreeChange,
          onCancel: handleRenameWorktreeCancel,
          onCommit: handleRenameWorktreeConfirm,
        }
      : null;
  const baseWorkspaceRef = useRef(activeParentWorkspace ?? activeWorkspace);

  useEffect(() => {
    baseWorkspaceRef.current = activeParentWorkspace ?? activeWorkspace;
  }, [activeParentWorkspace, activeWorkspace]);

  useEffect(() => {
    if (!isPhone) {
      return;
    }
    if (!activeWorkspace && activeTab !== "projects") {
      setActiveTab("projects");
    }
  }, [activeTab, activeWorkspace, isPhone]);

  useEffect(() => {
    if (!isTablet) {
      return;
    }
    if (activeTab === "projects") {
      setActiveTab("codex");
    }
  }, [activeTab, isTablet]);

  useWindowDrag("titlebar");

  const isWindowsDesktop = useMemo(() => isWindowsPlatform(), []);
  const isMacDesktop = useMemo(() => isMacPlatform(), []);

  useEffect(() => {
    const title = activeWorkspace
      ? `ccgui - ${activeWorkspace.name}`
      : "ccgui";
    void getCurrentWindow().setTitle(title).catch(() => {});
  }, [activeWorkspace]);

  useWorkspaceRestore({
    workspaces,
    hasLoaded,
    connectWorkspace,
    activeWorkspaceId,
    restoreThreadsOnlyOnLaunch:
      appSettings.runtimeRestoreThreadsOnlyOnLaunch !== false,
    listThreadsForWorkspace: listThreadsForWorkspaceTracked,
  });
  useWorkspaceRefreshOnFocus({
    workspaces,
    refreshWorkspaces,
    activeWorkspaceId,
    listThreadsForWorkspace: listThreadsForWorkspaceTracked,
  });

  const {
    handleAddWorkspace,
    handleOpenNewWindow,
    handleAddWorkspaceFromPath,
    handleAddAgent,
    handleAddWorktreeAgent,
    handleAddCloneAgent,
  } = useWorkspaceActions({
    activeWorkspace,
    isCompact,
    activeEngine,
    newAgentShortcut: appSettings.newAgentShortcut,
    setActiveEngine,
    addWorkspace,
    addWorkspaceFromPath,
    connectWorkspace,
    startThreadForWorkspace,
    setActiveThreadId,
    setActiveTab,
    exitDiffView,
    selectWorkspace,
    openWorktreePrompt,
    openClonePrompt,
    composerInputRef,
    showLoadingProgressDialog,
    hideLoadingProgressDialog,
    onDebug: addDebugEntry,
  });

  const handleDropWorkspacePaths = useCallback(
    async (paths: string[]) => {
      const uniquePaths = Array.from(
        new Set(paths.filter((path) => path.length > 0)),
      );
      if (uniquePaths.length === 0) {
        return;
      }
      uniquePaths.forEach((path) => {
        void handleAddWorkspaceFromPath(path);
      });
    },
    [handleAddWorkspaceFromPath],
  );

  useOpenPaths({
    onOpenPaths: handleDropWorkspacePaths,
  });

  const {
    dropTargetRef: workspaceDropTargetRef,
    isDragOver: isWorkspaceDropActive,
    handleDragOver: handleWorkspaceDragOver,
    handleDragEnter: handleWorkspaceDragEnter,
    handleDragLeave: handleWorkspaceDragLeave,
    handleDrop: handleWorkspaceDrop,
  } = useWorkspaceDropZone({
    onDropPaths: handleDropWorkspacePaths,
  });

  const handleArchiveActiveThread = useCallback(async () => {
    if (!activeWorkspaceId || !activeThreadId) {
      return;
    }
    const result = await removeThread(activeWorkspaceId, activeThreadId);
    if (!result.success) {
      alertError(result.message ?? t("workspace.deleteConversationFailed"));
      return;
    }
    clearDraftForThread(activeThreadId);
    removeImagesForThread(activeThreadId);
  }, [
    activeThreadId,
    activeWorkspaceId,
    alertError,
    clearDraftForThread,
    removeImagesForThread,
    removeThread,
    t,
  ]);

  const agent = selectedAgent;
  const appShellContext = {
    ...APP_SHELL_LEGACY_CONTEXT_DEFAULTS,
    GitHubPanelData, RECENT_THREAD_LIMIT, SettingsView, accessMode, accountByWorkspace, accountSwitching, activeAccount, activeDiffError,
    activeDiffLoading, activeDiffs, activeDraft, activeEditorFilePath, activeEditorLineRange, activeEngine, activeGitRoot, activeImages,
    activeFusingMessageId, activeItems, activeParentWorkspace, activePath, activePlan, activeQueue, activeQueuedHandoffBubble, activeRateLimits, activeRenamePrompt, activeTab, agentTaskScrollRequest,
    activeTerminalId, activeThreadId, activeThreadIdForModeRef, activeThreadIdRef, activeTokenUsage, activeWorkspace, activeWorkspaceId, activeWorkspaceIdRef,
    activeWorkspaceKanbanTasks, activeWorkspaceRef, activeWorkspaceThreads, addCloneAgent, addDebugEntry, addWorkspace, addWorkspaceFromPath, addWorktreeAgent,
    agent, alertError, appMode, appRootRef, appSettings, appSettingsLoading, applySelectedCollaborationMode,
    approvals, assignWorkspaceGroup, attachImages, baseWorkspaceRef, branches, canFuseActiveQueue, canInterrupt, cancelClonePrompt, cancelWorktreePrompt,
    centerMode, checkoutBranch, chooseCloneCopiesFolder, choosePreset, claudeAccessModeRef, clearActiveImages, clearCloneCopiesFolder,
    clearDebugEntries, clearDictationError, clearDictationHint, clearDictationTranscript, clearDraftForThread, clearGitRootCandidates, clonePrompt, closePlanPanel,
    closeReleaseNotes, closeReviewPrompt, closeSettings, closeTerminalPanel, closeWorktreeCreateResult, codexComposerModeRef, collaborationModePayload, collaborationModes,
    collaborationModesEnabled, collaborationRuntimeModeByThread, collaborationUiModeByThread, collapseRightPanel, collapseSidebar, commands, commitError, commitLoading,
    commitMessage, commitMessageError, commitMessageLoading, completionEmailIntentByThread, completionTrackerBySessionRef, completionTrackerReadyRef, composerEditorSettings, composerInputRef, composerInsert,
    confirmBranch, confirmClonePrompt, confirmCommit, confirmCustom, confirmRenameWorktreeUpstream, confirmWorktreePrompt, connectWorkspace, createBranch,
    createPrompt, createWorkspaceGroup, debugEntries, debugOpen, debugPanelHeight, deletePrompt, deleteThreadPrompt,
    deleteWorkspaceGroup, deletingWorktreeIds, dictationError, dictationHint, dictationLevel, dictationModel, dictationReady,
    dictationState, dictationTranscript, diffScrollRequestId, diffSource, directories, dismissErrorToast, dismissUpdate, doctor, claudeDoctor,
    editorHighlightTarget, editorNavigationTarget, editorSplitLayout, effectiveModels, effectiveReasoningSupported, effectiveSelectedModel,
    effectiveSelectedModelId, engineModelsAsOptions, engineSelectedModelIdByType, engineStatuses, ensureLaunchTerminal, ensureTerminalWithTitle,
    ensureWorkspaceThreadListLoaded, errorToasts, exitDiffView, expandRightPanel, expandSidebar, filePanelMode,
    fileReferenceMode, fileStatus, fileTreeLoadError, files,
    forkThreadForWorkspace, forkSessionFromMessageForWorkspace, forkClaudeSessionFromMessageForWorkspace, getGlobalPromptsDir, getPinTimestamp, getThreadRows, getWorkspaceGroupName, getWorkspacePromptsDir, gitCommitDiffs,
    gitDiffListView, gitDiffViewStyle, gitHistoryPanelHeight, gitHistoryPanelHeightRef, gitIssues, gitIssuesError, gitIssuesLoading, gitIssuesTotal,
    gitLogAhead, gitLogAheadEntries, gitLogBehind, gitLogBehindEntries, gitLogEntries, gitLogError, gitLogLoading, gitLogTotal,
    gitLogUpstream, gitPanelMode, gitPullRequestComments, gitPullRequestCommentsError, gitPullRequestCommentsLoading, gitPullRequestDiffs, gitPullRequestDiffsError, gitPullRequestDiffsLoading,
    gitPullRequests, gitPullRequestsError, gitPullRequestsLoading, gitPullRequestsTotal, gitRemoteUrl, gitRootCandidates, gitRootScanDepth, gitRootScanError,
    gitRootScanHasScanned, gitRootScanLoading, gitStatus, gitignoredDirectories, gitignoredFiles, globalSearchFilesByWorkspace,
    groupedWorkspaces, handleActivateFileTab, handleActiveDiffPath, handleAddAgent, handleAddCloneAgent, handleAddWorkspace, handleOpenNewWindow, handleAddWorkspaceFromPath, handleAddWorktreeAgent,
    handleAppModeChange, handleApplyWorktreeChanges, handleApprovalBatchAccept, handleApprovalDecision, handleApprovalRemember, handleArchiveActiveThread, handleCancelSwitchAccount, handleCheckoutBranch, handleCloseAllFileTabs,
    handleCloseFileTab, handleCollaborationModeResolved, handleCommit, handleCommitAndPush, handleCommitAndSync, handleCommitMessageChange, handleCopyDebug, handleCopyThread,
    handleCreateBranch, handleCreatePrompt, handleDebugClick, handleDeletePrompt, handleDeleteQueued, handleDeleteThreadPromptCancel, handleDeleteThreadPromptConfirm, handleDraftChange,
    handleDropWorkspacePaths, handleEditQueued, handleEnsureWorkspaceThreadsForSettings, handleExitEditor, handleGenerateCommitMessage, handleGitIssuesChange, handleGitPanelModeChange, handleGitPullRequestCommentsChange,
    handleGitPullRequestDiffsChange, handleGitPullRequestsChange, handleInsertComposerText, handleLockPanel, handleMovePrompt, handleOpenDetachedFileExplorer, handleOpenFile, handleOpenModelSettings, handleRefreshModelConfig, handleOpenRenameWorktree,
    handlePickGitRoot, handlePush, handleRenamePromptCancel, handleRenamePromptChange, handleRenamePromptConfirm, handleRenameThread,
    handleRenameWorktreeCancel, handleRenameWorktreeChange, handleRenameWorktreeConfirm, handleRevealGeneralPrompts, handleRevealWorkspacePrompts, handleRevertAllGitChanges, handleRevertGitFile,
    handleReviewPromptKeyDown, handleSelectAgent, handleSelectCommit, handleSelectDiff, handleSelectModel, handleSelectOpenAppId, handleSelectOpenCodeAgent, handleSelectOpenCodeVariant, handleSelectStatusPanelSubagent,
    handleSend, handleSendPrompt, handleSendPromptToNewAgent, handleSetAccessMode, handleSetGitRoot, handleStageGitAll, handleStageGitFile, handleSwitchAccount, handleFuseQueued,
    handleSync, handleTestNotificationSound, handleToggleDictation, handleToggleRuntimeConsole, handleToggleTerminal, handleToggleTerminalPanel, handleUnlockPanel, handleUnstageGitFile,
    handleUpdatePrompt, handleUserInputSubmit, handleUserInputSubmitWithPlanApply, handleExitPlanModeExecute, handleWorkspaceDragEnter, handleWorkspaceDragLeave, handleWorkspaceDragOver, handleWorkspaceDrop, handleWorktreeCreated,
    hasActivePlan, hasLoaded, hasPlanData, highlightedBranchIndex, highlightedCommitIndex, highlightedPresetIndex, historySearchItems, hydratedThreadListWorkspaceIdsRef,
    availableEngines, installedEngines, interruptTurn, isCompact, isDeleteThreadPromptBusy, isEditorFileMaximized, isFilesLoading, isLoadingLatestAgents, isMacDesktop, isModelConfigRefreshing,
    isPanelLocked, isPhone, isPlanMode, isPlanPanelDismissed, isProcessing, isReviewing, isSearchPaletteOpen,
    isTablet, isThreadAutoNaming, isThreadPinned, isWindowsDesktop, isWorkspaceDropActive, isWorktreeWorkspace, kanbanConversationWidth,
    kanbanCreatePanel, kanbanCreateTask, kanbanDeletePanel, kanbanDeleteTask, kanbanPanels, kanbanReorderTask, kanbanTasks, kanbanUpdatePanel,
    kanbanUpdateTask, kanbanViewState, lastAgentMessageByThread, lastCodexModeSyncThreadRef,
    latestAgentRuns, launchScriptState, launchScriptsState,
    listThreadsForWorkspace, listThreadsForWorkspaceTracked, liveEditPreviewEnabled, loadOlderThreadsForWorkspace, lockLiveSessions,
    markWorkspaceConnected, models, movePrompt, moveWorkspaceGroup, navigateToThread,
    normalizePath, onCloseTerminal,
    onDebugPanelResizeStart, onGitHistoryPanelResizeStart, onKanbanConversationResizeStart, onNewTerminal, onPlanPanelResizeStart, onRightPanelResizeStart, onSelectTerminal, onSidebarResizeStart,
    onTerminalPanelResizeStart, onTextareaHeightChange, openAppIconById, openClonePrompt, openCodeAgents, openDeleteThreadPrompt, openFileTabs, openPlanPanel, openReleaseNotes, openRenamePrompt, openRenameWorktreePrompt, openSettings,
    openTerminal, openWorktreePrompt, perfSnapshotRef, persistComposerSelectionForThread, persistProjectCopiesFolder, pickImages, pinThread,
    pinnedThreadsVersion, planByThread, planPanelHeight, prefillDraft,
    prompts, pushError, pushLoading, queueGitStatusRefresh, queueMessage,
    queueSaveSettings, rateLimitsByWorkspace, reasoningOptions: effectiveReasoningOptions, reasoningSupported: effectiveReasoningSupported, recentThreads, reduceTransparency, refreshAccountInfo,
    refreshAccountRateLimits, refreshEngines, refreshFiles, refreshGitDiffs, refreshGitLog, refreshGitStatus, refreshThread, refreshWorkspaces, releaseNotesActiveIndex,
    releaseNotesEntries, releaseNotesError, releaseNotesLoading, releaseNotesOpen, reloadSelectedAgent, removeImage, removeImagesForThread, removeThread, removeThreads,
    removeWorkspace, removeWorktree, renamePrompt, renameThread, renameWorkspaceGroup, renameWorktree, renameWorktreeNotice, renameWorktreePrompt,
    renameWorktreeUpstream, renameWorktreeUpstreamPrompt, resetGitHubPanelState, resetSoloSplitToHalf, resetWorkspaceThreads, resolveCloneProjectContext,
    resolveCanonicalThreadId, resolveCollaborationRuntimeMode, resolveCollaborationUiMode, resolveComposerSelectionForThread, resolveOpenCodeAgentForThread, resolveOpenCodeVariantForThread, resolvedEffort, resolvedModel, restartTerminalSession,
    retryReleaseNotesLoad, reviewPrompt, rightPanelCollapsed, rightPanelWidth, runtimeRunState,
    scaleShortcutText, scaleShortcutTitle, scanGitRoots, scopedKanbanTasks, searchContentFilters, searchPaletteQuery, searchPaletteSelectedIndex,
    searchResults, searchScope, selectBranch, selectBranchAtIndex, selectCommit, selectCommitAtIndex, selectHome, selectWorkspace,
    selectedAgent, selectedCollaborationMode, selectedCollaborationModeId, selectedCommitSha, selectedDiffPath, selectedEffort: effectiveSelectedEffort,
    selectedAgentRef,
    selectedKanbanTaskId, selectedModelId: effectiveSelectedModelId, selectedOpenCodeAgent, selectedOpenCodeVariant, selectedPullRequest, sendUserMessage,
    sendUserMessageToThread, setAccessMode, setActiveEditorLineRange, setActiveEngine, setActiveTab, setActiveThreadId, setActiveWorkspaceId,
    setAppMode, setAppSettings, setCenterMode, setCodexCollaborationMode, setCollaborationRuntimeModeByThread, setCollaborationUiModeByThread, setComposerInsert, setDebugOpen,
    setDiffSource, setEditorSplitLayout, setEngineSelectedModelIdByType, setFilePanelMode, setFileReferenceMode, setGitDiffListView, setGitDiffViewStyle, setGitHistoryPanelHeight,
    setGitPanelMode, setGitRootScanDepth, setGlobalSearchFilesByWorkspace, setHighlightedBranchIndex, setHighlightedCommitIndex, setHighlightedPresetIndex, setIsEditorFileMaximized, setIsPanelLocked,
    setIsPlanPanelDismissed, setIsSearchPaletteOpen, setKanbanViewState, setLiveEditPreviewEnabled, setPrefillDraft, setReduceTransparency, setRightPanelWidth, setSearchContentFilters, setSearchPaletteQuery, setSearchPaletteSelectedIndex, setSearchScope,
    setSelectedCollaborationModeId, setSelectedCommitSha, setSelectedDiffPath, setSelectedEffort: handleSelectComposerEffort, setSelectedKanbanTaskId, setSelectedModelId, setSelectedPullRequest,
    setHomeOpen, setWorkspaceHomeWorkspaceId, settingsHighlightTarget, settingsOpen, settingsSection, loadingProgressDialog, dismissLoadingProgressDialog, shouldLoadDiffs, shouldLoadGitHubPanelData,
    showLoadingProgressDialog, hideLoadingProgressDialog,
    showDebugButton, showGitHistory, showHome, showKanban, showNextReleaseNotes, showPresetStep, showPreviousReleaseNotes, showWorkspaceHome,
    sidebarCollapsed, sidebarWidth, skills, startCompact, startExport, startFast, startFork,
    startImport, startLsp, startMcp, startMode, startResume, startReview, startShare, startSpecRoot,
    startStatus, startThreadForWorkspace, startSharedSessionForWorkspace, startUpdate, syncError, syncLoading,
    t, tabletTab, terminalOpen, terminalPanelHeight, terminalState,
    terminalTabs, textareaHeight, threadAccessMode, threadItemsByThread, threadListCursorByWorkspace, threadListLoadingByWorkspace,
    threadListPagingByWorkspace, threadParentById, threadStatusById, historyLoadingByThreadId, historyRestoredAtMsByThread, threadsByWorkspace, timelinePlan,
    tokenUsageByThread, toggleCompletionEmailIntent, triggerAutoThreadTitle, ungroupedLabel, unpinThread,
    updateCloneCopyName, updateCustomInstructions, updatePrompt, updateSharedSessionEngineSelection, updateWorkspaceCodexBin, updateWorkspaceSettings, updateWorktreeBaseRef, updateWorktreeBranch, updateWorktreePublishToOrigin,
    updateWorktreeSetupScript, updaterState, useSuggestedCloneCopiesFolder, userInputRequests,
    workspaceActivity, workspaceDropTargetRef, workspaceFilesPollingEnabled, workspaceGroups, workspaceHomeWorkspaceId, workspaceNameByPath,
    homeWorkspaceDefaultId,
    homeWorkspaceSelectedId,
    workspaceSearchSources, workspaces, workspacesById, workspacesByPath, worktreeApplyError, worktreeApplyLoading, worktreeApplySuccess,
    worktreeCreateResult, worktreeLabel, worktreePrompt, worktreeRename, worktreeSetupScriptState,
    sessionRadarRunningSessions: sessionRadarFeed.runningSessions,
    sessionRadarRecentCompletedSessions: sessionRadarFeed.recentCompletedSessions,
    runningSessionCountByWorkspaceId: sessionRadarFeed.runningCountByWorkspaceId,
    recentCompletedSessionCountByWorkspaceId: sessionRadarFeed.recentCountByWorkspaceId,
  };

  const searchAndComposerSection = useAppShellSearchAndComposerSection(
    appShellContext,
  );

  const sections = useAppShellSections({
    ...appShellContext,
    handleComposerSend: searchAndComposerSection.handleComposerSend,
    isPullRequestComposer: searchAndComposerSection.isPullRequestComposer,
    composerSendLabel: searchAndComposerSection.composerSendLabel,
    resetPullRequestSelection: searchAndComposerSection.resetPullRequestSelection,
    handleToggleSearchPalette: searchAndComposerSection.handleToggleSearchPalette,
    handleComposerQueue: searchAndComposerSection.handleComposerQueue,
  });

  const isPullRequestComposer = sections.isPullRequestComposer;

  const layoutNodes = useAppShellLayoutNodesSection({
    ...appShellContext,
    ...searchAndComposerSection,
    ...sections,
    isPullRequestComposer,
    isPullRequestComposerFromSections: sections.isPullRequestComposer,
    sections,
  });

  return renderAppShell({
    ...appShellContext,
    ...searchAndComposerSection,
    ...sections,
    ...layoutNodes,
    isPullRequestComposer,
    isPullRequestComposerFromSections: sections.isPullRequestComposer,
    sections,
  });
}
