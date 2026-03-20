// @ts-nocheck
import {
  cloneElement,
  isValidElement,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
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
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  SidebarCollapseButton,
  TitlebarExpandControls,
} from "./features/layout/components/SidebarToggleControls";
import { useAppSettingsController } from "./features/app/hooks/useAppSettingsController";
import { useUpdaterController } from "./features/app/hooks/useUpdaterController";
import { useReleaseNotes } from "./features/update/hooks/useReleaseNotes";
import { useErrorToasts } from "./features/notifications/hooks/useErrorToasts";
import { useComposerShortcuts } from "./features/composer/hooks/useComposerShortcuts";
import { useComposerMenuActions } from "./features/composer/hooks/useComposerMenuActions";
import { useComposerEditorState } from "./features/composer/hooks/useComposerEditorState";
import { useDictationController } from "./features/app/hooks/useDictationController";
import { useComposerController } from "./features/app/hooks/useComposerController";
import { useComposerInsert } from "./features/app/hooks/useComposerInsert";
import { useEngineController } from "./features/engine/hooks/useEngineController";
import { useRenameThreadPrompt } from "./features/threads/hooks/useRenameThreadPrompt";
import { useDeleteThreadPrompt } from "./features/threads/hooks/useDeleteThreadPrompt";
import { useWorktreePrompt } from "./features/workspaces/hooks/useWorktreePrompt";
import { useClonePrompt } from "./features/workspaces/hooks/useClonePrompt";
import { useWorkspaceController } from "./features/app/hooks/useWorkspaceController";
import { useWorkspaceSelection } from "./features/workspaces/hooks/useWorkspaceSelection";
import { useWorkspaceSessionActivity } from "./features/session-activity/hooks/useWorkspaceSessionActivity";
import { useSessionRadarFeed } from "./features/session-activity/hooks/useSessionRadarFeed";
import { useLiveEditPreview } from "./features/live-edit-preview/hooks/useLiveEditPreview";
import { useGitHubPanelController } from "./features/app/hooks/useGitHubPanelController";
import { useSettingsModalState } from "./features/app/hooks/useSettingsModalState";
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
import { useUnifiedSearch } from "./features/search/hooks/useUnifiedSearch";
import { loadHistoryWithImportance } from "./features/composer/hooks/useInputHistoryStore";
import { forceRefreshAgents } from "./features/composer/components/ChatInputBox/providers";
import { recordSearchResultOpen } from "./features/search/ranking/recencyStore";
import type { SearchContentFilter, SearchResult, SearchScope } from "./features/search/types";
import { toggleSearchContentFilters } from "./features/search/utils/contentFilters";
import { resolveSearchScopeOnOpen } from "./features/search/utils/scope";
import {
  getSelectedAgentConfig,
  getOpenCodeAgentsList,
  ensureWorkspacePathDir,
  setSelectedAgentConfig,
  getWorkspaceFiles,
  pickWorkspacePath,
  readPanelLockPasswordFile,
  writePanelLockPasswordFile,
} from "./services/tauri";
import type {
  AccessMode,
  AppMode,
  ComposerEditorSettings,
  EngineType,
  MessageSendOptions,
  OpenCodeAgentOption,
  RequestUserInputRequest,
  RequestUserInputResponse,
  SelectedAgentOption,
  WorkspaceInfo,
} from "./types";
import { getClientStoreSync, writeClientStoreValue } from "./services/clientStorage";
import { useOpenAppIcons } from "./features/app/hooks/useOpenAppIcons";
import { useCodeCssVars } from "./features/app/hooks/useCodeCssVars";
import { useAccountSwitching } from "./features/app/hooks/useAccountSwitching";
import { useMenuLocalization } from "./features/app/hooks/useMenuLocalization";
import { sendSystemNotification, setNotificationActionHandler } from "./services/systemNotification";
import { ReleaseNotesModal } from "./features/update/components/ReleaseNotesModal";
import { requestVendorModelManager } from "./features/vendors/modelManagerRequest";
import {
  PANEL_LOCK_INITIAL_PASSWORD,
  LOCK_LIVE_SESSION_LIMIT,
  OPENCODE_VARIANT_OPTIONS,
  GIT_HISTORY_PANEL_MAX_SNAP_THRESHOLD,
  GIT_HISTORY_PANEL_CLOSE_THRESHOLD,
  LOCAL_PLAN_APPLY_REQUEST_PREFIX,
  PLAN_APPLY_ACTION_QUESTION_ID,
  PLAN_APPLY_EXECUTE_PROMPT,
  CODE_MODE_RESUME_PROMPT,
  type ThreadCompletionTracker,
  extractFirstUserInputAnswer,
  clampGitHistoryPanelHeight,
  getDefaultGitHistoryPanelHeight,
  isJankDebugEnabled,
  extractPlanFromTimelineItems,
  resolveLockLivePreview,
} from "./app-shell-parts/utils";
import { useAppShellSearchAndComposerSection } from "./app-shell-parts/useAppShellSearchAndComposerSection";
import { useAppShellSections } from "./app-shell-parts/useAppShellSections";
import { useAppShellLayoutNodesSection } from "./app-shell-parts/useAppShellLayoutNodesSection";
import { renderAppShell } from "./app-shell-parts/renderAppShell";
import {
  RADAR_STORE_NAME,
  SESSION_RADAR_RECENT_STORAGE_KEY,
  type PersistedRadarRecentEntry,
  buildRadarCompletionId,
  dispatchSessionRadarHistoryUpdatedEvent,
  mergePersistedRadarRecentEntries,
  resolveLatestUserMessage,
} from "./features/session-activity/utils/sessionRadarPersistence";

const SettingsView = lazy(() =>
  import("./features/settings/components/SettingsView").then((module) => ({
    default: module.SettingsView,
  })),
);

const GitHubPanelData = lazy(() =>
  import("./features/git/components/GitHubPanelData").then((module) => ({
    default: module.GitHubPanelData,
  })),
);

const GIT_HISTORY_PANEL_MIN_HEIGHT = 260;
const GIT_HISTORY_PANEL_MIN_TOP_CLEARANCE = 44;
function getViewportHeight(): number {
  return typeof window === "undefined" ? 0 : window.innerHeight;
}

export function AppShell() {
  const { t } = useTranslation();
  const {
    appSettings,
    setAppSettings,
    doctor,
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
  const [gitHistoryPanelHeight, setGitHistoryPanelHeight] = useState(() => {
    const stored = getClientStoreSync<number>("layout", "gitHistoryPanelHeight");
    if (typeof stored === "number" && Number.isFinite(stored)) {
      return clampGitHistoryPanelHeight(stored);
    }
    return getDefaultGitHistoryPanelHeight();
  });
  const appRootRef = useRef<HTMLDivElement | null>(null);
  const gitHistoryPanelHeightRef = useRef(gitHistoryPanelHeight);

  const resetSoloSplitToHalf = useCallback(() => {
    window.requestAnimationFrame(() => {
      const appRoot = appRootRef.current;
      const main = appRoot?.querySelector<HTMLElement>(".main");
      const mainWidth = main?.clientWidth ?? window.innerWidth;
      setRightPanelWidth(Math.floor(mainWidth / 2));
    });
  }, [setRightPanelWidth]);

  useEffect(() => {
    gitHistoryPanelHeightRef.current = gitHistoryPanelHeight;
  }, [gitHistoryPanelHeight]);
  useEffect(() => {
    writeClientStoreValue("layout", "gitHistoryPanelHeight", gitHistoryPanelHeight);
  }, [gitHistoryPanelHeight]);
  useEffect(() => {
    const handleResize = () => {
      setGitHistoryPanelHeight((current) => clampGitHistoryPanelHeight(current));
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);
  const onGitHistoryPanelResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const pointerId = event.pointerId;
      const startY = event.clientY;
      const startHeight = gitHistoryPanelHeightRef.current;
      const viewportHeight = getViewportHeight();
      const maxHeight = Math.max(
        GIT_HISTORY_PANEL_MIN_HEIGHT,
        viewportHeight - GIT_HISTORY_PANEL_MIN_TOP_CLEARANCE,
      );
      const minHeight = Math.min(GIT_HISTORY_PANEL_MIN_HEIGHT, maxHeight);
      const dragHandle = event.currentTarget;
      const appRoot = appRootRef.current;
      let latestRawHeight = startHeight;
      let latestClampedHeight = clampGitHistoryPanelHeight(startHeight, viewportHeight);
      let animationFrameId: number | null = null;

      const flushDraggedHeight = () => {
        animationFrameId = null;
        if (appRoot) {
          appRoot.style.setProperty(
            "--git-history-panel-height",
            `${latestClampedHeight}px`,
          );
        }
      };

      const scheduleDraggedHeightFlush = () => {
        if (animationFrameId !== null) {
          return;
        }
        animationFrameId = window.requestAnimationFrame(flushDraggedHeight);
      };

      dragHandle.setPointerCapture(pointerId);
      document.body.dataset.gitHistoryResizing = "true";

      const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) {
          return;
        }
        const delta = moveEvent.clientY - startY;
        const nextHeight = startHeight - delta;
        latestRawHeight = nextHeight;
        latestClampedHeight = clampGitHistoryPanelHeight(nextHeight, viewportHeight);
        scheduleDraggedHeightFlush();
      };

      const handlePointerUp = (upEvent: globalThis.PointerEvent) => {
        if (upEvent.pointerId !== pointerId) {
          return;
        }
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        window.removeEventListener("pointercancel", handlePointerUp);
        if (dragHandle.hasPointerCapture(pointerId)) {
          dragHandle.releasePointerCapture(pointerId);
        }
        if (animationFrameId !== null) {
          window.cancelAnimationFrame(animationFrameId);
          flushDraggedHeight();
        }
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        document.body.style.webkitUserSelect = "";
        delete document.body.dataset.gitHistoryResizing;

        if (latestRawHeight <= minHeight - GIT_HISTORY_PANEL_CLOSE_THRESHOLD) {
          setAppMode("chat");
          return;
        }

        if (latestRawHeight >= maxHeight - GIT_HISTORY_PANEL_MAX_SNAP_THRESHOLD) {
          setGitHistoryPanelHeight(maxHeight);
          return;
        }

        setGitHistoryPanelHeight(latestClampedHeight);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointercancel", handlePointerUp);
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
      document.body.style.webkitUserSelect = "none";
    },
    [],
  );

  const {
    settingsOpen,
    settingsSection,
    settingsHighlightTarget,
    openSettings,
    closeSettings,
  } = useSettingsModalState();

  const handleOpenModelSettings = useCallback(
    (providerId?: string) => {
      const target = providerId === "codex" ? "codex" : "claude";
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
  const [isPanelLocked, setIsPanelLocked] = useState(false);
  const completionTrackerReadyRef = useRef(false);
  const completionTrackerBySessionRef = useRef<Record<string, ThreadCompletionTracker>>({});
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

  // Force accessMode to "full-access" (Auto Mode)
  // Other modes are temporarily disabled in ModeSelect component
  useEffect(() => {
    setAccessMode("full-access");
  }, []);

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
    selectedModelId,
    setSelectedModelId,
    reasoningSupported,
    reasoningOptions,
    selectedEffort,
    setSelectedEffort
  } = useModels({
    activeWorkspace,
    onDebug: addDebugEntry,
    preferredModelId: appSettings.lastComposerModelId,
    preferredEffort: appSettings.lastComposerReasoningEffort,
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
  const [collaborationUiModeByThread, setCollaborationUiModeByThread] = useState<
    Record<string, "plan" | "code">
  >({});
  const [collaborationRuntimeModeByThread, setCollaborationRuntimeModeByThread] = useState<
    Record<string, "plan" | "code">
  >({});
  const activeThreadIdForModeRef = useRef<string | null>(null);
  const lastCodexModeSyncThreadRef = useRef<string | null>(null);
  const codexComposerModeRef = useRef<"plan" | "code" | null>(null);
  const applySelectedCollaborationMode = useCallback(
    (modeId: string | null) => {
      if (!modeId) {
        codexComposerModeRef.current = null;
        setSelectedCollaborationModeId(null);
        return;
      }
      const normalized = modeId === "plan" ? "plan" : "code";
      codexComposerModeRef.current = normalized;
      const threadId = activeThreadIdForModeRef.current;
      if (threadId) {
        setCollaborationUiModeByThread((prev) => {
          if (prev[threadId] === normalized) {
            return prev;
          }
          return {
            ...prev,
            [threadId]: normalized,
          };
        });
      }
      setSelectedCollaborationModeId(normalized);
    },
    [setSelectedCollaborationModeId],
  );
  const setCodexCollaborationMode = useCallback(
    (mode: "plan" | "code") => {
      applySelectedCollaborationMode(mode);
    },
    [applySelectedCollaborationMode],
  );
  const resolveCollaborationRuntimeMode = useCallback(
    (threadId: string): "plan" | "code" | null =>
      collaborationRuntimeModeByThread[threadId] ?? null,
    [collaborationRuntimeModeByThread],
  );
  const resolveCollaborationUiMode = useCallback(
    (threadId: string): "plan" | "code" | null =>
      collaborationUiModeByThread[threadId] ?? null,
    [collaborationUiModeByThread],
  );
  const handleCollaborationModeResolved = useCallback(
    (payload: {
      workspaceId: string;
      threadId: string;
      selectedUiMode: "plan" | "default";
      effectiveRuntimeMode: "plan" | "code";
      effectiveUiMode: "plan" | "default";
      fallbackReason: string | null;
    }) => {
      const threadId = payload.threadId.trim();
      if (!threadId) {
        return;
      }
      const effectiveRuntimeMode = payload.effectiveRuntimeMode === "plan"
        ? "plan"
        : "code";
      const effectiveUiMode = payload.effectiveUiMode === "plan"
        ? "plan"
        : "code";
      setCollaborationRuntimeModeByThread((prev) => {
        if (prev[threadId] === effectiveRuntimeMode) {
          return prev;
        }
        return {
          ...prev,
          [threadId]: effectiveRuntimeMode,
        };
      });
      setCollaborationUiModeByThread((prev) => {
        if (prev[threadId] === effectiveUiMode) {
          return prev;
        }
        return {
          ...prev,
          [threadId]: effectiveUiMode,
        };
      });
    },
    [],
  );

  const { skills } = useSkills({ activeWorkspace, onDebug: addDebugEntry });
  const {
    activeEngine,
    installedEngines,
    setActiveEngine,
    engineModelsAsOptions,
    engineStatuses,
  } = useEngineController({ activeWorkspace, onDebug: addDebugEntry });
  const [openCodeAgents, setOpenCodeAgents] = useState<OpenCodeAgentOption[]>([]);
  const [openCodeAgentByThreadId, setOpenCodeAgentByThreadId] = useState<Record<string, string | null>>({});
  const [openCodeVariantByThreadId, setOpenCodeVariantByThreadId] = useState<
    Record<string, string | null>
  >({});
  const [openCodeDefaultAgentByWorkspace, setOpenCodeDefaultAgentByWorkspace] = useState<
    Record<string, string | null>
  >({});
  const [openCodeDefaultVariantByWorkspace, setOpenCodeDefaultVariantByWorkspace] = useState<
    Record<string, string | null>
  >({});
  const [selectedAgent, setSelectedAgent] = useState<SelectedAgentOption | null>(null);

  const reloadSelectedAgent = useCallback(async () => {
    try {
      const selected = await getSelectedAgentConfig();
      const agent = selected.agent;
      setSelectedAgent(
        agent
          ? {
              id: agent.id,
              name: agent.name,
              prompt: agent.prompt ?? null,
            }
          : null,
      );
    } catch (error) {
      addDebugEntry({
        id: `${Date.now()}-agent-selected-load-error`,
        timestamp: Date.now(),
        source: "error",
        label: "agent/selected load error",
        payload: error instanceof Error ? error.message : String(error),
      });
    }
  }, [addDebugEntry]);

  const handleSelectAgent = useCallback(
    (agent: SelectedAgentOption | null) => {
      const normalized =
        agent && agent.id.trim().length > 0
          ? {
              id: agent.id.trim(),
              name: agent.name.trim(),
              prompt: agent.prompt ?? null,
            }
          : null;
      setSelectedAgent(normalized);
      void setSelectedAgentConfig(normalized?.id ?? null)
        .then((result) => {
          if (!result.agent) {
            if (!normalized) {
              setSelectedAgent(null);
            }
            return;
          }
          setSelectedAgent({
            id: result.agent.id,
            name: result.agent.name,
            prompt: result.agent.prompt ?? null,
          });
        })
        .catch((error) => {
          addDebugEntry({
            id: `${Date.now()}-agent-selected-save-error`,
            timestamp: Date.now(),
            source: "error",
            label: "agent/selected save error",
            payload: error instanceof Error ? error.message : String(error),
          });
        });
    },
    [addDebugEntry],
  );

  useEffect(() => {
    if (activeEngine !== "opencode") {
      return;
    }
    let cancelled = false;
    void getOpenCodeAgentsList()
      .then((response) => {
        if (cancelled) {
          return;
        }
        const payload = Array.isArray(response)
          ? response
          : Array.isArray((response as any)?.result)
            ? (response as any).result
            : [];
        const normalized = payload
          .map((item: any) => ({
            id: String(item.id ?? "").trim(),
            description: item.description ? String(item.description) : undefined,
            isPrimary: Boolean(item.isPrimary ?? item.is_primary),
          }))
          .filter((item: OpenCodeAgentOption) => item.id.length > 0)
          .sort((a: OpenCodeAgentOption, b: OpenCodeAgentOption) =>
            a.id.localeCompare(b.id),
          );
        setOpenCodeAgents(normalized);
      })
      .catch((error) => {
        addDebugEntry({
          id: `${Date.now()}-opencode-agents-list-error`,
          timestamp: Date.now(),
          source: "error",
          label: "opencode/agents list error",
          payload: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [activeEngine, addDebugEntry]);

  // --- Kanban mode ---
  const [appMode, setAppMode] = useState<AppMode>("chat");
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

  const handleSelectModel = useCallback(
    (id: string | null) => {
      if (id === null) return;
      if (import.meta.env.DEV) {
        console.info("[model/select]", {
          activeEngine,
          selectedModelId: id,
        });
      }
      if (activeEngine === "codex") {
        setSelectedModelId(id);
        return;
      }
      setEngineSelectedModelIdByType((prev) => ({
        ...prev,
        [activeEngine]: id,
      }));
    },
    [activeEngine, setSelectedModelId],
  );

  // Derive effective models based on active engine
  // For Codex, use models from useModels hook; for other engines, use engineModelsAsOptions
  const effectiveModels = useMemo(() => {
    if (activeEngine === "codex") {
      return models;
    }
    return engineModelsAsOptions;
  }, [activeEngine, models, engineModelsAsOptions]);

  useEffect(() => {
    if (activeEngine === "codex") {
      return;
    }
    if (activeEngine === "claude") {
      return;
    }
    if (engineModelsAsOptions.length === 0) {
      return;
    }
    setEngineSelectedModelIdByType((prev) => {
      const existing = prev[activeEngine] ?? null;
      const isValid =
        !!existing &&
        engineModelsAsOptions.some((model) => model.id === existing);
      if (isValid) {
        return prev;
      }
      const nextDefault =
        engineModelsAsOptions.find((model) => model.isDefault)?.id ??
        engineModelsAsOptions[0]?.id ??
        null;
      if (!nextDefault || nextDefault === existing) {
        return prev;
      }
      return { ...prev, [activeEngine]: nextDefault };
    });
  }, [activeEngine, engineModelsAsOptions]);

  // Derive effective selected model ID based on active engine
  const effectiveSelectedModelId = useMemo(() => {
    if (activeEngine === "codex") {
      return selectedModelId;
    }
    if (activeEngine === "claude") {
      return (
        engineSelectedModelIdByType[activeEngine] ??
        "claude-sonnet-4-6"
      );
    }
    const engineSelection = engineSelectedModelIdByType[activeEngine] ?? null;
    if (engineModelsAsOptions.length === 0) {
      return null;
    }
    const validModel = engineModelsAsOptions.find(
      (model) => model.id === engineSelection,
    );
    if (validModel) {
      return engineSelection;
    }
    const defaultModel = engineModelsAsOptions.find((model) => model.isDefault);
    return defaultModel?.id ?? engineModelsAsOptions[0]?.id ?? null;
  }, [activeEngine, engineModelsAsOptions, engineSelectedModelIdByType, selectedModelId]);

  // Derive effective reasoning support based on active engine
  const effectiveReasoningSupported = useMemo(() => {
    if (activeEngine === "codex") {
      return reasoningSupported;
    }
    // Other engines don't support reasoning effort selection (yet)
    return false;
  }, [activeEngine, reasoningSupported]);

  // Derive effective selected model based on active engine
  const effectiveSelectedModel = useMemo(() => {
    return effectiveModels.find((m) => m.id === effectiveSelectedModelId) ?? null;
  }, [effectiveModels, effectiveSelectedModelId]);

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
    reasoningOptions,
    selectedEffort,
    onSelectEffort: setSelectedEffort,
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
    reasoningOptions,
    selectedEffort,
    onSelectEffort: setSelectedEffort,
    reasoningSupported: effectiveReasoningSupported,
    onFocusComposer: () => composerInputRef.current?.focus(),
  });

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

  const resolvedModel = effectiveSelectedModel?.model ?? effectiveSelectedModelId ?? null;
  const resolvedEffort = effectiveReasoningSupported ? selectedEffort : null;

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }
    console.info("[model/resolve/app]", {
      activeEngine,
      effectiveSelectedModelId,
      effectiveSelectedModelModel: effectiveSelectedModel?.model ?? null,
      resolvedModel,
    });
  }, [
    activeEngine,
    effectiveSelectedModelId,
    effectiveSelectedModel?.model,
    resolvedModel,
  ]);
  const resolveOpenCodeAgentForThread = useCallback(
    (threadId: string | null) => {
      if (!activeWorkspaceId) {
        return null;
      }
      if (threadId && threadId in openCodeAgentByThreadId) {
        return openCodeAgentByThreadId[threadId] ?? null;
      }
      return openCodeDefaultAgentByWorkspace[activeWorkspaceId] ?? null;
    },
    [activeWorkspaceId, openCodeAgentByThreadId, openCodeDefaultAgentByWorkspace],
  );
  const resolveOpenCodeVariantForThread = useCallback(
    (threadId: string | null) => {
      if (!activeWorkspaceId) {
        return null;
      }
      if (threadId && threadId in openCodeVariantByThreadId) {
        return openCodeVariantByThreadId[threadId] ?? null;
      }
      return openCodeDefaultVariantByWorkspace[activeWorkspaceId] ?? null;
    },
    [activeWorkspaceId, openCodeVariantByThreadId, openCodeDefaultVariantByWorkspace],
  );
  const activeGitRoot = activeWorkspace?.settings.gitRoot ?? null;
  const normalizePath = useCallback((value: string) => {
    return value.replace(/\\/g, "/").replace(/\/+$/, "");
  }, []);
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
    const workspacePath = normalizePath(activeWorkspace.path);
    const selectedPath = normalizePath(selection);
    let nextRoot: string | null = null;
    if (selectedPath === workspacePath) {
      nextRoot = null;
    } else if (selectedPath.startsWith(`${workspacePath}/`)) {
      nextRoot = selectedPath.slice(workspacePath.length + 1);
    } else {
      nextRoot = selectedPath;
    }
    await handleSetGitRoot(nextRoot);
  }, [activeWorkspace, handleSetGitRoot, normalizePath]);
  const fileStatus =
    gitStatus.error
      ? t("git.statusUnavailable")
      : gitStatus.files.length > 0
        ? t("git.filesChanged", { count: gitStatus.files.length })
        : t("git.workingTreeClean");

  usePersistComposerSettings({
    appSettingsLoading,
    selectedModelId,
    selectedEffort,
    setAppSettings,
    queueSaveSettings,
  });

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

  const { collaborationModePayload } = useCollaborationModeSelection({
    selectedCollaborationMode,
    selectedCollaborationModeId,
    selectedEffort: resolvedEffort,
    resolvedModel,
  });
  const threadAccessMode =
    accessMode === "default" ? "current" : accessMode;

  const {
    setActiveThreadId,
    activeThreadId,
    activeItems,
    threadItemsByThread,
    approvals,
    userInputRequests,
    threadsByWorkspace,
    threadParentById,
    threadStatusById,
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
    listThreadsForWorkspace,
    loadOlderThreadsForWorkspace,
    resetWorkspaceThreads,
    refreshThread,
    sendUserMessage,
    sendUserMessageToThread,
    startFork,
    startReview,
    startResume,
    startMcp,
    startSpecRoot,
    startStatus,
    startFast,
    startMode,
    startExport,
    startImport,
    startLsp,
    startShare,
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
    handleApprovalDecision,
    handleApprovalRemember,
    handleUserInputSubmit,
    refreshAccountInfo,
    refreshAccountRateLimits,
  } = useThreads({
    activeWorkspace,
    onWorkspaceConnected: markWorkspaceConnected,
    onDebug: addDebugEntry,
    model: resolvedModel,
    effort: resolvedEffort,
    collaborationMode: collaborationModePayload,
    accessMode: threadAccessMode,
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
  });
  const handleUserInputSubmitWithPlanApply = useCallback(
    async (
      request: RequestUserInputRequest,
      response: RequestUserInputResponse,
    ) => {
      const requestThreadId = String(request.params.thread_id ?? "").trim();
      const runtimeMode = requestThreadId
        ? resolveCollaborationRuntimeMode(requestThreadId)
        : null;
      const uiMode = requestThreadId
        ? (resolveCollaborationUiMode(requestThreadId) ??
          (selectedCollaborationModeId === "plan" ? "plan" : "code"))
        : (selectedCollaborationModeId === "plan" ? "plan" : "code");
      const shouldForceResumeInCode =
        activeEngine === "codex" &&
        runtimeMode === "plan" &&
        uiMode === "code";
      await handleUserInputSubmit(request, response);
      const requestId = String(request.request_id ?? "");
      if (!requestId.startsWith(LOCAL_PLAN_APPLY_REQUEST_PREFIX)) {
        if (!shouldForceResumeInCode) {
          return;
        }
        applySelectedCollaborationMode("code");
        await interruptTurn();
        const firstAnswer = extractFirstUserInputAnswer(response);
        const resumePrompt = firstAnswer
          ? `${CODE_MODE_RESUME_PROMPT}\n\nUser confirmation: ${firstAnswer}`
          : CODE_MODE_RESUME_PROMPT;
        const immediateCodeModePayload: Record<string, unknown> = {
          mode: "code",
          settings: {
            model: resolvedModel ?? null,
            reasoning_effort: resolvedEffort ?? null,
          },
        };
        await sendUserMessage(resumePrompt, [], {
          collaborationMode: immediateCodeModePayload,
        });
        return;
      }
      const selectedAnswer = String(
        response.answers?.[PLAN_APPLY_ACTION_QUESTION_ID]?.answers?.[0] ?? "",
      )
        .trim()
        .toLowerCase();
      const shouldImplementPlan = selectedAnswer.startsWith("yes");
      if (!shouldImplementPlan) {
        applySelectedCollaborationMode("plan");
        return;
      }
      applySelectedCollaborationMode("code");
      const immediateCodeModePayload: Record<string, unknown> = {
        mode: "code",
        settings: {
          model: resolvedModel ?? null,
          reasoning_effort: resolvedEffort ?? null,
        },
      };
      await sendUserMessage(PLAN_APPLY_EXECUTE_PROMPT, [], {
        collaborationMode: immediateCodeModePayload,
      });
    },
    [
      activeEngine,
      applySelectedCollaborationMode,
      handleUserInputSubmit,
      interruptTurn,
      resolveCollaborationRuntimeMode,
      resolveCollaborationUiMode,
      resolvedEffort,
      resolvedModel,
      selectedCollaborationModeId,
      sendUserMessage,
    ],
  );
  const hydratedThreadListWorkspaceIdsRef = useRef(new Set<string>());
  const listThreadsForWorkspaceTracked = useCallback(
    async (
      workspace: WorkspaceInfo,
      options?: { preserveState?: boolean },
    ) => {
      await listThreadsForWorkspace(workspace, options);
      hydratedThreadListWorkspaceIdsRef.current.add(workspace.id);
    },
    [listThreadsForWorkspace],
  );
  const ensureWorkspaceThreadListLoaded = useCallback(
    (
      workspaceId: string,
      options?: { preserveState?: boolean; force?: boolean },
    ) => {
      const workspace = workspacesById.get(workspaceId);
      if (!workspace) {
        return;
      }
      const force = options?.force ?? false;
      if (!force && hydratedThreadListWorkspaceIdsRef.current.has(workspaceId)) {
        return;
      }
      void listThreadsForWorkspaceTracked(workspace, {
        preserveState: options?.preserveState,
      });
    },
    [listThreadsForWorkspaceTracked, workspacesById],
  );
  const handleEnsureWorkspaceThreadsForSettings = useCallback(
    (workspaceId: string) => {
      ensureWorkspaceThreadListLoaded(workspaceId, { preserveState: true });
    },
    [ensureWorkspaceThreadListLoaded],
  );
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
  const previousThreadIdRef = useRef<string | null>(null);
  useEffect(() => {
    const previous = previousThreadIdRef.current;
    if (
      previous &&
      activeThreadId &&
      previous !== activeThreadId &&
      previous.startsWith("opencode-pending-") &&
      activeThreadId.startsWith("opencode:")
    ) {
      setOpenCodeAgentByThreadId((prev) => {
        if (!(previous in prev) || activeThreadId in prev) {
          return prev;
        }
        return { ...prev, [activeThreadId]: prev[previous] ?? null };
      });
      setOpenCodeVariantByThreadId((prev) => {
        if (!(previous in prev) || activeThreadId in prev) {
          return prev;
        }
        return { ...prev, [activeThreadId]: prev[previous] ?? null };
      });
    }
    previousThreadIdRef.current = activeThreadId ?? null;
  }, [activeThreadId]);

  useEffect(() => {
    void reloadSelectedAgent();
  }, [activeThreadId, reloadSelectedAgent]);

  useEffect(() => {
    if (!settingsOpen) {
      forceRefreshAgents();
      void reloadSelectedAgent();
    }
  }, [reloadSelectedAgent, settingsOpen]);

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
      if (!activeWorkspaceId) {
        return;
      }
      const normalized = agentId && agentId.trim().length > 0 ? agentId : null;
      setOpenCodeDefaultAgentByWorkspace((prev) => ({
        ...prev,
        [activeWorkspaceId]: normalized,
      }));
      if (!activeThreadId) {
        return;
      }
      setOpenCodeAgentByThreadId((prev) => ({
        ...prev,
        [activeThreadId]: normalized,
      }));
    },
    [activeThreadId, activeWorkspaceId],
  );

  const handleSelectOpenCodeVariant = useCallback(
    (variant: string | null) => {
      if (!activeWorkspaceId) {
        return;
      }
      const normalized = variant && variant.trim().length > 0 ? variant : null;
      setOpenCodeDefaultVariantByWorkspace((prev) => ({
        ...prev,
        [activeWorkspaceId]: normalized,
      }));
      if (!activeThreadId) {
        return;
      }
      setOpenCodeVariantByThreadId((prev) => ({
        ...prev,
        [activeThreadId]: normalized,
      }));
    },
    [activeThreadId, activeWorkspaceId],
  );

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

  const handleLockPanel = useCallback(() => {
    setIsPanelLocked(true);
  }, []);

  const handleUnlockPanel = useCallback(async (password: string) => {
    try {
      const filePassword = await readPanelLockPasswordFile();
      if (filePassword == null) {
        void writePanelLockPasswordFile(PANEL_LOCK_INITIAL_PASSWORD);
        setIsPanelLocked(false);
        return true;
      }
      const normalized = filePassword.trim();
      if (normalized.length === 0 || password === normalized) {
        setIsPanelLocked(false);
        return true;
      }
      return false;
    } catch {
      // 读取异常时避免用户被锁死
      setIsPanelLocked(false);
      return true;
    }
  }, []);


  const navigateToThread = useCallback(
    (workspaceId: string, threadId: string) => {
      exitDiffView();
      setAppMode("chat");
      setActiveTab("codex");
      collapseRightPanel();
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
      setAppMode,
      selectWorkspace,
      setActiveEngine,
      setActiveTab,
      setActiveThreadId,
      threadsByWorkspace,
    ],
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

  const openAppIconById = useOpenAppIcons(appSettings.openAppTargets);

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
  }, [activeThreadId]);

  useEffect(() => {
    if (activeEngine !== "codex") {
      return;
    }
    const mappedMode = activeThreadId
      ? collaborationUiModeByThread[activeThreadId] ?? null
      : null;
    if (mappedMode === "plan" || mappedMode === "code") {
      lastCodexModeSyncThreadRef.current = activeThreadId;
      codexComposerModeRef.current = mappedMode;
      if (selectedCollaborationModeId !== mappedMode) {
        setSelectedCollaborationModeId(mappedMode);
      }
      return;
    }
    const threadChanged = lastCodexModeSyncThreadRef.current !== activeThreadId;
    if (!threadChanged) {
      return;
    }
    lastCodexModeSyncThreadRef.current = activeThreadId;
    if (!activeThreadId) {
      codexComposerModeRef.current = null;
      return;
    }
    codexComposerModeRef.current = "code";
    if (selectedCollaborationModeId !== "code") {
      setSelectedCollaborationModeId("code");
    }
  }, [
    activeEngine,
    activeThreadId,
    collaborationUiModeByThread,
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
  const showHome = !activeWorkspace && !showKanban;
  const showWorkspaceHome = Boolean(
    activeWorkspace &&
      workspaceHomeWorkspaceId === activeWorkspace.id &&
      !activeThreadId &&
      appMode === "chat" &&
      (isCompact ? (isTablet ? tabletTab : activeTab) === "codex" : activeTab !== "spec"),
  );
  const canInterrupt = activeThreadId
    ? threadStatusById[activeThreadId]?.isProcessing ?? false
    : false;
  const isProcessing = activeThreadId
    ? threadStatusById[activeThreadId]?.isProcessing ?? false
    : false;
  const isReviewing = activeThreadId
    ? threadStatusById[activeThreadId]?.isReviewing ?? false
    : false;
  const {
    activeImages,
    attachImages,
    pickImages,
    removeImage,
    clearActiveImages,
    removeImagesForThread,
    activeQueue,
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
    clearDraftForThread,
  } = useComposerController({
    activeThreadId,
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
    startFork,
    startReview,
    startResume,
    startMcp,
    startSpecRoot,
    startStatus,
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
  });

  const handleInsertComposerText = useComposerInsert({
    activeThreadId,
    draftText: activeDraft,
    onDraftChange: handleDraftChange,
    textareaRef: composerInputRef,
  });
  const perfSnapshotRef = useRef({
    activeThreadId: null as string | null,
    isProcessing: false,
    activeItems: 0,
    filesLoading: false,
    files: 0,
    directories: 0,
    filePanelMode: "git" as "git" | "files" | "search" | "prompts" | "memory" | "activity" | "radar",
    rightPanelCollapsed: false,
    isCompact: false,
    draftLength: 0,
  });
  useEffect(() => {
    perfSnapshotRef.current = {
      activeThreadId,
      isProcessing,
      activeItems: activeItems.length,
      filesLoading: isFilesLoading,
      files: files.length,
      directories: directories.length,
      filePanelMode,
      rightPanelCollapsed,
      isCompact,
      draftLength: activeDraft.length,
    };
  }, [
    activeDraft.length,
    activeItems.length,
    activeThreadId,
    directories.length,
    filePanelMode,
    files.length,
    isCompact,
    isFilesLoading,
    isProcessing,
    rightPanelCollapsed,
  ]);
  useEffect(() => {
    if (!import.meta.env.DEV || !isJankDebugEnabled() || typeof window === "undefined") {
      return;
    }
    let rafId = 0;
    let lastFrameAt = performance.now();
    const monitor = (timestamp: number) => {
      const delta = timestamp - lastFrameAt;
      if (delta >= 120) {
        const snapshot = perfSnapshotRef.current;
        console.warn("[perf][jank]", {
          frameGapMs: Number(delta.toFixed(2)),
          ...snapshot,
        });
      }
      lastFrameAt = timestamp;
      rafId = window.requestAnimationFrame(monitor);
    };
    rafId = window.requestAnimationFrame(monitor);
    return () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, []);

  const activePath = activeWorkspace?.path ?? null;
  const activeWorkspaceKanbanTasks = useMemo(
    () => (activePath ? kanbanTasks.filter((task) => task.workspaceId === activePath) : []),
    [activePath, kanbanTasks],
  );
  const activeWorkspaceThreads = useMemo(
    () => (activeWorkspaceId ? threadsByWorkspace[activeWorkspaceId] ?? [] : []),
    [activeWorkspaceId, threadsByWorkspace],
  );
  const workspaceActivity = useWorkspaceSessionActivity({
    activeThreadId,
    threads: activeWorkspaceThreads,
    itemsByThread: threadItemsByThread,
    threadParentById,
    threadStatusById,
  });
  const RECENT_THREAD_LIMIT = 8;
  const recentThreads = useMemo(() => {
    if (!activeWorkspaceId) {
      return [];
    }
    const threads = threadsByWorkspace[activeWorkspaceId] ?? [];
    if (threads.length === 0) {
      return [];
    }
    return [...threads]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, RECENT_THREAD_LIMIT)
      .map((thread) => {
        const status = threadStatusById[thread.id];
        return {
          id: thread.id,
          workspaceId: activeWorkspaceId,
          threadId: thread.id,
          title: thread.name?.trim() || t("threads.untitledThread"),
          updatedAt: thread.updatedAt,
          isProcessing: status?.isProcessing ?? false,
          isReviewing: status?.isReviewing ?? false,
        };
      });
  }, [activeWorkspaceId, threadStatusById, threadsByWorkspace, t]);
  useEffect(() => {
    if (!activeWorkspaceId) {
      return;
    }
    setGlobalSearchFilesByWorkspace((prev) => {
      const nextFiles = files;
      const prevFiles = prev[activeWorkspaceId];
      if (prevFiles === nextFiles) {
        return prev;
      }
      return {
        ...prev,
        [activeWorkspaceId]: nextFiles,
      };
    });
  }, [activeWorkspaceId, files]);

  useEffect(() => {
    if (!isSearchPaletteOpen || searchScope !== "global") {
      return;
    }
    const targetWorkspaceIds = workspaces.map((workspace) => workspace.id);
    const uncachedWorkspaceIds = targetWorkspaceIds.filter(
      (workspaceId) => !(workspaceId in globalSearchFilesByWorkspace),
    );
    if (uncachedWorkspaceIds.length === 0) {
      return;
    }
    let cancelled = false;
    void Promise.all(
      uncachedWorkspaceIds.map(async (workspaceId) => {
        try {
          const response = await getWorkspaceFiles(workspaceId);
          return [
            workspaceId,
            Array.isArray(response.files) ? response.files : ([] as string[]),
          ] as const;
        } catch {
          return [workspaceId, [] as string[]] as const;
        }
      }),
    ).then((entries) => {
      if (cancelled || entries.length === 0) {
        return;
      }
      setGlobalSearchFilesByWorkspace((prev) => {
        const next = { ...prev };
        for (const [workspaceId, workspaceFiles] of entries) {
          next[workspaceId] = workspaceFiles;
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [globalSearchFilesByWorkspace, isSearchPaletteOpen, searchScope, workspaces]);

  const workspaceSearchSources = useMemo(() => {
    if (searchScope === "global") {
      return workspaces.map((workspace) => ({
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        files: globalSearchFilesByWorkspace[workspace.id] ?? [],
        threads: threadsByWorkspace[workspace.id] ?? [],
      }));
    }
    if (!activeWorkspaceId || !activeWorkspace) {
      return [];
    }
    return [
      {
        workspaceId: activeWorkspaceId,
        workspaceName: activeWorkspace.name,
        files,
        threads: activeWorkspaceThreads,
      },
    ];
  }, [
    activeWorkspace,
    activeWorkspaceId,
    activeWorkspaceThreads,
    files,
    globalSearchFilesByWorkspace,
    searchScope,
    threadsByWorkspace,
    workspaces,
  ]);

  const scopedKanbanTasks = useMemo(
    () => (searchScope === "global" ? kanbanTasks : activeWorkspaceKanbanTasks),
    [activeWorkspaceKanbanTasks, kanbanTasks, searchScope],
  );
  const historySearchItems = useMemo(
    () => (isSearchPaletteOpen ? loadHistoryWithImportance() : []),
    [isSearchPaletteOpen],
  );
  const workspaceNameByPath = useMemo(
    () => new Map(workspaces.map((w) => [w.path, w.name])),
    [workspaces],
  );
  const searchResults = useUnifiedSearch({
    query: searchPaletteQuery,
    contentFilters: searchContentFilters,
    workspaceSources: workspaceSearchSources,
    kanbanTasks: scopedKanbanTasks,
    threadItemsByThread,
    historyItems: historySearchItems,
    skills,
    commands,
    activeWorkspaceId,
    workspaceNameByPath,
  });

  const sessionRadarFeed = useSessionRadarFeed({
    workspaces,
    threadsByWorkspace,
    threadStatusById,
    threadItemsByThread,
    lastAgentMessageByThread,
    runningLimit: LOCK_LIVE_SESSION_LIMIT,
  });
  const lockLiveSessions = sessionRadarFeed.runningSessions;

  useEffect(() => {
    const previous = completionTrackerBySessionRef.current;
    const next: Record<string, ThreadCompletionTracker> = {};
    const completed: PersistedRadarRecentEntry[] = [];

    for (const workspace of workspaces) {
      const threads = threadsByWorkspace[workspace.id] ?? [];
      for (const thread of threads) {
        const key = `${workspace.id}:${thread.id}`;
        const status = threadStatusById[thread.id];
        const isProcessingNow = status?.isProcessing ?? false;
        const lastDurationMs = status?.lastDurationMs ?? null;
        const lastAgentTimestamp = lastAgentMessageByThread[thread.id]?.timestamp ?? 0;
        const previousTracker = previous[key];
        const wasProcessing = previousTracker?.isProcessing ?? false;
        const previousDurationMs = previousTracker?.lastDurationMs ?? null;
        const previousAgentTimestamp = previousTracker?.lastAgentTimestamp ?? 0;
        const finishedByDuration =
          !isProcessingNow &&
          lastDurationMs !== null &&
          lastDurationMs !== previousDurationMs;
        const finishedByAgentUpdate =
          !isProcessingNow &&
          lastAgentTimestamp > previousAgentTimestamp &&
          (wasProcessing || previousDurationMs !== null);

        if ((wasProcessing && !isProcessingNow) || finishedByDuration || finishedByAgentUpdate) {
          const lastAgent = lastAgentMessageByThread[thread.id];
          const completedAt = Math.max(
            thread.updatedAt ?? 0,
            lastAgent?.timestamp ?? 0,
            Date.now(),
          );
          const durationMs = typeof lastDurationMs === "number" ? Math.max(0, lastDurationMs) : null;
          const startedAt =
            durationMs != null
              ? Math.max(0, completedAt - durationMs)
              : (previousTracker?.isProcessing && previousTracker?.lastDurationMs
                  ? Math.max(0, completedAt - previousTracker.lastDurationMs)
                  : null);
          const latestUserMessage = resolveLatestUserMessage(threadItemsByThread[thread.id]);
          completed.push({
            id: buildRadarCompletionId(workspace.id, thread.id),
            workspaceId: workspace.id,
            workspaceName: workspace.name,
            threadId: thread.id,
            threadName: thread.name?.trim() || t("threads.untitledThread"),
            engine: (thread.engineSource || "codex").toUpperCase(),
            preview:
              latestUserMessage ||
              resolveLockLivePreview(threadItemsByThread[thread.id], lastAgent?.text) ||
              thread.name?.trim() ||
              t("threads.untitledThread"),
            updatedAt: completedAt,
            startedAt,
            completedAt,
            durationMs,
          });
        }

        next[key] = {
          isProcessing: isProcessingNow,
          lastDurationMs,
          lastAgentTimestamp,
        };
      }
    }

    if (!completionTrackerReadyRef.current) {
      completionTrackerReadyRef.current = true;
      completionTrackerBySessionRef.current = next;
      return;
    }

    completionTrackerBySessionRef.current = next;
    if (completed.length === 0) {
      return;
    }

    const nextPersistedRecent = mergePersistedRadarRecentEntries(
      getClientStoreSync<unknown>(RADAR_STORE_NAME, SESSION_RADAR_RECENT_STORAGE_KEY),
      completed,
    );
    writeClientStoreValue(
      RADAR_STORE_NAME,
      SESSION_RADAR_RECENT_STORAGE_KEY,
      nextPersistedRecent,
      { immediate: true },
    );
    dispatchSessionRadarHistoryUpdatedEvent();

    // Send a system notification for each completed session.
    if (appSettings.systemNotificationEnabled) {
      for (const entry of completed) {
        void sendSystemNotification({
          title: t("threadCompletion.title"),
          body: `${t("threadCompletion.project")}: ${entry.workspaceName}\n${t("threadCompletion.session")}: ${entry.threadName}`,
          extra: {
            workspaceId: entry.workspaceId,
            threadId: entry.threadId,
          },
        });
      }
    }
  }, [
    appSettings.systemNotificationEnabled,
    lastAgentMessageByThread,
    t,
    threadItemsByThread,
    threadStatusById,
    threadsByWorkspace,
    workspaces,
  ]);

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

  const handleSendPromptToNewAgent = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!activeWorkspace || !trimmed) {
        return;
      }
      if (!activeWorkspace.connected) {
        await connectWorkspace(activeWorkspace);
      }
      const threadId = await startThreadForWorkspace(activeWorkspace.id, {
        activate: false,
      });
      if (!threadId) {
        return;
      }
      await sendUserMessageToThread(activeWorkspace, threadId, trimmed, []);
    },
    [activeWorkspace, connectWorkspace, sendUserMessageToThread, startThreadForWorkspace],
  );


  const handleCreatePrompt = useCallback(
    async (data: {
      scope: "workspace" | "global";
      name: string;
      description?: string | null;
      argumentHint?: string | null;
      content: string;
    }) => {
      try {
        await createPrompt(data);
      } catch (error) {
        alertError(error);
      }
    },
    [alertError, createPrompt],
  );

  const handleUpdatePrompt = useCallback(
    async (data: {
      path: string;
      name: string;
      description?: string | null;
      argumentHint?: string | null;
      content: string;
    }) => {
      try {
        await updatePrompt(data);
      } catch (error) {
        alertError(error);
      }
    },
    [alertError, updatePrompt],
  );

  const handleDeletePrompt = useCallback(
    async (path: string) => {
      try {
        await deletePrompt(path);
      } catch (error) {
        alertError(error);
      }
    },
    [alertError, deletePrompt],
  );

  const handleMovePrompt = useCallback(
    async (data: { path: string; scope: "workspace" | "global" }) => {
      try {
        await movePrompt(data);
      } catch (error) {
        alertError(error);
      }
    },
    [alertError, movePrompt],
  );

  const handleRevealWorkspacePrompts = useCallback(async () => {
    try {
      const path = await getWorkspacePromptsDir();
      await revealItemInDir(path);
    } catch (error) {
      alertError(error);
    }
  }, [alertError, getWorkspacePromptsDir]);

  const handleRevealGeneralPrompts = useCallback(async () => {
    try {
      const path = await getGlobalPromptsDir();
      if (!path) {
        return;
      }
      await revealItemInDir(path);
    } catch (error) {
      alertError(error);
    }
  }, [alertError, getGlobalPromptsDir]);

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
      ? `MossX - ${activeWorkspace.name}`
      : "MossX";
    void getCurrentWindow().setTitle(title).catch(() => {});
  }, [activeWorkspace]);

  useWorkspaceRestore({
    workspaces,
    hasLoaded,
    connectWorkspace,
    activeWorkspaceId,
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
  // Keep legacy context keys defined after large-file modularization;
  // many downstream modules destructure them but do not actively use them.
  const {
    appRoot,
    cancelled,
    defaultModel,
    delta,
    dragHandle,
    effectiveRuntimeMode,
    effectiveUiMode,
    engineSelection,
    entry,
    existing,
    filePassword,
    finishedByAgentUpdate,
    finishedByDuration,
    firstAnswer,
    flushDraggedHeight,
    force,
    group,
    groupId,
    handlePointerMove,
    handlePointerUp,
    handleResize,
    isProcessingNow,
    isValid,
    key,
    label,
    lastAgent,
    lastAgentTimestamp,
    lastDurationMs,
    lastFrameAt,
    latestClampedHeight,
    latestRawHeight,
    latestSnippet,
    main,
    mainWidth,
    mappedMode,
    maxHeight,
    minHeight,
    monitor,
    next,
    nextDefault,
    nextFiles,
    nextHeight,
    nextSettings,
    normalized,
    path,
    payload,
    pointerId,
    prevFiles,
    previous,
    previousAgentTimestamp,
    previousDurationMs,
    previousTracker,
    rafId,
    requestId,
    requestThreadId,
    response,
    result,
    resumePrompt,
    runtimeMode,
    scheduleDraggedHeightFlush,
    selected,
    selectedAnswer,
    selectedPath,
    selection,
    sessions,
    shouldForceResumeInCode,
    shouldImplementPlan,
    snapshot,
    startHeight,
    startY,
    stored,
    target,
    targetThread,
    targetWorkspaceIds,
    threadChanged,
    threadId,
    threadMode,
    threads,
    title,
    trimmed,
    uiMode,
    uncachedWorkspaceIds,
    uniquePaths,
    updatedAt,
    validModel,
    viewportHeight,
    wasProcessing,
    workspace,
    workspaceId,
    workspacePath,
  } = {} as Record<string, unknown>;
  const appShellContext = {
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
    groupedWorkspaces, handleActivateFileTab, handleActiveDiffPath, handleAddAgent, handleAddCloneAgent, handleAddWorkspace, handleOpenNewWindow, handleAddWorkspaceFromPath, handleAddWorktreeAgent,
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
    startStatus, startThreadForWorkspace, startUpdate, startY, stored, syncError, syncLoading,
    t, tabletTab, target, targetThread, targetWorkspaceIds, terminalOpen, terminalPanelHeight, terminalState,
    terminalTabs, textareaHeight, threadAccessMode, threadChanged, threadId, threadItemsByThread, threadListCursorByWorkspace, threadListLoadingByWorkspace,
    threadListPagingByWorkspace, threadMode, threadParentById, threadStatusById, threads, threadsByWorkspace, timelinePlan, title,
    tokenUsageByThread, triggerAutoThreadTitle, trimmed, uiMode, uncachedWorkspaceIds, ungroupedLabel, uniquePaths, unpinThread,
    updateCloneCopyName, updateCustomInstructions, updatePrompt, updateWorkspaceCodexBin, updateWorkspaceSettings, updateWorktreeBaseRef, updateWorktreeBranch, updateWorktreePublishToOrigin,
    updateWorktreeSetupScript, updatedAt, updaterState, useSuggestedCloneCopiesFolder, userInputRequests, validModel, viewportHeight, wasProcessing,
    workspace, workspaceActivity, workspaceDropTargetRef, workspaceFilesPollingEnabled, workspaceGroups, workspaceHomeWorkspaceId, workspaceId, workspaceNameByPath,
    workspacePath, workspaceSearchSources, workspaces, workspacesById, workspacesByPath, worktreeApplyError, worktreeApplyLoading, worktreeApplySuccess,
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
