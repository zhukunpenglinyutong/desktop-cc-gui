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
import "./styles/globals.css";
import "./styles/base.css";
import "./styles/buttons.css";
import "./styles/sidebar.css";
import "./styles/home.css";
import "./styles/main.css";
import "./styles/messages.css";
import "./styles/approval-toasts.css";
import "./styles/error-toasts.css";
import "./styles/request-user-input.css";
import "./styles/update-toasts.css";
import "./styles/release-notes.css";
import "./styles/composer.css";
import "./styles/review-inline.css";
import "./styles/diff.css";
import "./styles/diff-viewer.css";
import "./styles/file-tree.css";
import "./styles/runtime-console.css";
import "./styles/file-view-panel.css";
import "./styles/panel-tabs.css";
import "./styles/prompts.css";
import "./styles/debug.css";
import "./styles/terminal.css";
import "./styles/plan.css";
import "./styles/about.css";
import "./styles/tabbar.css";
import "./styles/worktree-modal.css";
import "./styles/clone-modal.css";
import "./styles/settings.css";
import "./styles/compact-base.css";
import "./styles/compact-phone.css";
import "./styles/compact-tablet.css";
import "./styles/tool-blocks.css";
import "./styles/status-panel.css";
import "./styles/opencode-panel.css";
import "./styles/kanban.css";
import "./styles/git-history.css";
import "./styles/search-palette.css";
import "./styles/panel-lock.css";
import "./styles/spec-hub.css";
import "./styles/workspace-home.css";
import successSoundUrl from "./assets/success-notification.mp3";
import errorSoundUrl from "./assets/error-notification.mp3";
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
import { useWindowLabel } from "./features/layout/hooks/useWindowLabel";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isWindowsPlatform } from "./utils/platform";
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
import { useWorktreePrompt } from "./features/workspaces/hooks/useWorktreePrompt";
import { useClonePrompt } from "./features/workspaces/hooks/useClonePrompt";
import { useWorkspaceController } from "./features/app/hooks/useWorkspaceController";
import { useWorkspaceSelection } from "./features/workspaces/hooks/useWorkspaceSelection";
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
  setSelectedAgentConfig,
  getWorkspaceFiles,
  pickWorkspacePath,
  readPanelLockPasswordFile,
  writePanelLockPasswordFile,
} from "./services/tauri";
import type {
  AccessMode,
  AppMode,
  ConversationItem,
  ComposerEditorSettings,
  EngineType,
  MessageSendOptions,
  OpenCodeAgentOption,
  RequestUserInputRequest,
  RequestUserInputResponse,
  SelectedAgentOption,
  TurnPlan,
  TurnPlanStepStatus,
  WorkspaceInfo,
} from "./types";
import { getClientStoreSync, writeClientStoreValue } from "./services/clientStorage";
import { useOpenAppIcons } from "./features/app/hooks/useOpenAppIcons";
import { useCodeCssVars } from "./features/app/hooks/useCodeCssVars";
import { useAccountSwitching } from "./features/app/hooks/useAccountSwitching";
import { useMenuLocalization } from "./features/app/hooks/useMenuLocalization";
import { sendSystemNotification, setNotificationActionHandler } from "./services/systemNotification";
import { ReleaseNotesModal } from "./features/update/components/ReleaseNotesModal";

const AboutView = lazy(() =>
  import("./features/about/components/AboutView").then((module) => ({
    default: module.AboutView,
  })),
);

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

// Non-security UI panel lock: decorative only, not for access control.
const PANEL_LOCK_INITIAL_PASSWORD = "000000";
const LOCK_LIVE_SESSION_LIMIT = 12;
const LOCK_LIVE_PREVIEW_MAX = 180;
const OPENCODE_VARIANT_OPTIONS = ["minimal", "low", "medium", "high", "max"];
const GIT_HISTORY_PANEL_MIN_HEIGHT = 260;
const GIT_HISTORY_PANEL_MIN_TOP_CLEARANCE = 120;
const GIT_HISTORY_PANEL_DEFAULT_RATIO = 0.5;
const APP_JANK_DEBUG_FLAG_KEY = "mossx.debug.jank";
const LOCAL_PLAN_APPLY_REQUEST_PREFIX = "mossx-plan-apply:";
const PLAN_APPLY_ACTION_QUESTION_ID = "plan_apply_action";
const PLAN_APPLY_EXECUTE_PROMPT = "Implement this plan.";
const CODE_MODE_RESUME_PROMPT =
  "I switched to code mode. Continue from the latest context and execute directly.";

function extractFirstUserInputAnswer(response: RequestUserInputResponse): string | null {
  const entries = Object.values(response.answers ?? {});
  for (const entry of entries) {
    for (const answer of entry?.answers ?? []) {
      const normalized = String(answer ?? "").trim();
      if (!normalized) {
        continue;
      }
      if (normalized.toLowerCase().startsWith("user_note:")) {
        const note = normalized.slice("user_note:".length).trim();
        if (note) {
          return note;
        }
        continue;
      }
      return normalized;
    }
  }
  return null;
}

type ThreadCompletionTracker = {
  isProcessing: boolean;
  lastDurationMs: number | null;
  lastAgentTimestamp: number;
};

function getViewportHeight(): number {
  if (typeof window === "undefined") {
    return 900;
  }
  return window.innerHeight;
}

function clampGitHistoryPanelHeight(height: number, viewportHeight = getViewportHeight()): number {
  const maxHeight = Math.max(GIT_HISTORY_PANEL_MIN_HEIGHT, viewportHeight - GIT_HISTORY_PANEL_MIN_TOP_CLEARANCE);
  const minHeight = Math.min(GIT_HISTORY_PANEL_MIN_HEIGHT, maxHeight);
  return Math.round(Math.min(maxHeight, Math.max(minHeight, height)));
}

function getDefaultGitHistoryPanelHeight(): number {
  const viewportHeight = getViewportHeight();
  return clampGitHistoryPanelHeight(viewportHeight * GIT_HISTORY_PANEL_DEFAULT_RATIO, viewportHeight);
}

function isJankDebugEnabled(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return window.localStorage.getItem(APP_JANK_DEBUG_FLAG_KEY) === "1";
}

function normalizeLockLiveSnippet(text: string, maxLength = LOCK_LIVE_PREVIEW_MAX) {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) {
    return "";
  }
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, Math.max(0, maxLength - 1))}...`;
}

function normalizeTimelinePlanStepStatus(raw: string): TurnPlanStepStatus {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "completed" || normalized === "done" || normalized === "success") {
    return "completed";
  }
  if (
    normalized === "in_progress" ||
    normalized === "in-progress" ||
    normalized === "inprogress" ||
    normalized === "running"
  ) {
    return "inProgress";
  }
  return "pending";
}

function extractPlanFromTimelineItems(items: ConversationItem[]): TurnPlan | null {
  const latestPlanItem = [...items]
    .reverse()
    .find(
      (item) =>
        item.kind === "tool" &&
        (item.toolType === "proposed-plan" || item.toolType === "plan-implementation"),
    );
  if (!latestPlanItem || latestPlanItem.kind !== "tool") {
    return null;
  }
  const output = (latestPlanItem.output ?? "").trim();
  const lines = output
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const steps = lines
    .map((line) => {
      const withStatus = line.match(/^- \[([^\]]+)\]\s*(.+)$/);
      if (withStatus) {
        return {
          step: withStatus[2].trim(),
          status: normalizeTimelinePlanStepStatus(withStatus[1]),
        };
      }
      const bullet = line.match(/^- (.+)$/);
      if (bullet) {
        return {
          step: bullet[1].trim(),
          status: "pending" as TurnPlanStepStatus,
        };
      }
      return null;
    })
    .filter((entry): entry is { step: string; status: TurnPlanStepStatus } => Boolean(entry));
  const detail = (latestPlanItem.detail ?? "").trim();
  const turnId = detail.startsWith("implement-plan:")
    ? detail.slice("implement-plan:".length).trim() || latestPlanItem.id
    : latestPlanItem.id;
  const explanation = steps.length > 0 ? null : output || null;
  if (!explanation && steps.length === 0) {
    return null;
  }
  return {
    turnId,
    explanation,
    steps,
  };
}

function resolveLockLivePreview(
  items: ConversationItem[] | undefined,
  fallbackText: string | undefined,
) {
  const threadItems = items ?? [];
  for (let index = threadItems.length - 1; index >= 0; index -= 1) {
    const item = threadItems[index];
    if (item.kind === "message") {
      const value = normalizeLockLiveSnippet(item.text);
      if (value) {
        return value;
      }
      continue;
    }
    if (item.kind === "reasoning") {
      const value = normalizeLockLiveSnippet(item.summary || item.content);
      if (value) {
        return value;
      }
      continue;
    }
    if (item.kind === "tool") {
      const value = normalizeLockLiveSnippet(item.output || item.detail || item.title);
      if (value) {
        return value;
      }
      continue;
    }
    if (item.kind === "review") {
      const value = normalizeLockLiveSnippet(item.text);
      if (value) {
        return value;
      }
      continue;
    }
    if (item.kind === "diff") {
      const value = normalizeLockLiveSnippet(item.title);
      if (value) {
        return value;
      }
      continue;
    }
    if (item.kind === "explore") {
      const latest = item.entries[item.entries.length - 1];
      const value = normalizeLockLiveSnippet(latest?.detail || latest?.label || "");
      if (value) {
        return value;
      }
    }
  }
  return normalizeLockLiveSnippet(fallbackText || "");
}


function MainApp() {
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
      const startHeight = gitHistoryPanelHeight;
      const dragHandle = event.currentTarget;
      dragHandle.setPointerCapture(pointerId);
      document.body.dataset.gitHistoryResizing = "true";

      const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) {
          return;
        }
        const delta = moveEvent.clientY - startY;
        const nextHeight = startHeight - delta;
        setGitHistoryPanelHeight(clampGitHistoryPanelHeight(nextHeight));
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
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        document.body.style.webkitUserSelect = "";
        delete document.body.dataset.gitHistoryResizing;
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointercancel", handlePointerUp);
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
      document.body.style.webkitUserSelect = "none";
    },
    [gitHistoryPanelHeight],
  );

  const {
    settingsOpen,
    settingsSection,
    settingsHighlightTarget,
    openSettings,
    closeSettings,
  } = useSettingsModalState();

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
    onDebug: addDebugEntry,
    successSoundUrl,
    errorSoundUrl,
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

  useEffect(() => {
    if (!activeEditorFilePath) {
      setActiveEditorLineRange(null);
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
  const { files, directories, gitignoredFiles, isLoading: isFilesLoading, refreshFiles } = useWorkspaceFiles({
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

  const resolvedModel = effectiveSelectedModel?.model ?? null;
  const resolvedEffort = effectiveReasoningSupported ? selectedEffort : null;
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
    runtimeRunState.onCloseRuntimeConsole();
  }, [runtimeRunState, terminalOpen]);

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
    filePanelMode: "git" as "git" | "files" | "prompts" | "memory",
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

  const activeWorkspaceKanbanTasks = useMemo(
    () => {
      const activePath = activeWorkspace?.path;
      return activePath ? kanbanTasks.filter((task) => task.workspaceId === activePath) : [];
    },
    [activeWorkspace, kanbanTasks],
  );
  const activeWorkspaceThreads = useMemo(
    () => (activeWorkspaceId ? threadsByWorkspace[activeWorkspaceId] ?? [] : []),
    [activeWorkspaceId, threadsByWorkspace],
  );
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

  const lockLiveSessions = useMemo(() => {
    const sessions = workspaces.flatMap((workspace) => {
      const threads = threadsByWorkspace[workspace.id] ?? [];
      return threads.flatMap((thread) => {
        const status = threadStatusById[thread.id];
        if (!status?.isProcessing) {
          return [];
        }
        const lastAgent = lastAgentMessageByThread[thread.id];
        const updatedAt = Math.max(
          thread.updatedAt ?? 0,
          lastAgent?.timestamp ?? 0,
          status?.processingStartedAt ?? 0,
        );
        return [{
          id: `${workspace.id}:${thread.id}`,
          workspaceName: workspace.name,
          threadName: thread.name?.trim() || t("threads.untitledThread"),
          engine: (thread.engineSource || "codex").toUpperCase(),
          preview: resolveLockLivePreview(
            threadItemsByThread[thread.id],
            lastAgent?.text,
          ),
          updatedAt,
          isProcessing: status?.isProcessing ?? false,
        }];
      });
    });
    return sessions
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, LOCK_LIVE_SESSION_LIMIT);
  }, [
    lastAgentMessageByThread,
    threadItemsByThread,
    threadStatusById,
    threadsByWorkspace,
    t,
    workspaces,
  ]);

  useEffect(() => {
    const previous = completionTrackerBySessionRef.current;
    const next: Record<string, ThreadCompletionTracker> = {};
    const completed: { workspaceId: string; workspaceName: string; threadId: string; threadName: string }[] = [];

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
          const latestSnippet =
            resolveLockLivePreview(threadItemsByThread[thread.id], lastAgent?.text) ||
            thread.name?.trim() ||
            t("threads.untitledThread");
          completed.push({
            workspaceId: workspace.id,
            workspaceName: workspace.name,
            threadId: thread.id,
            threadName: latestSnippet,
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

  useEffect(() => {
    try {
      const title = activeWorkspace
        ? `MossX - ${activeWorkspace.name}`
        : "MossX";
      void getCurrentWindow().setTitle(title);
    } catch {
      // Non-Tauri environment, ignore.
    }
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
      workspacesById,
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
    appMode === "chat" &&
    !settingsOpen &&
    centerMode !== "memory",
  );
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

  const showComposer = Boolean(selectedKanbanTaskId) || ((!isCompact
    ? (centerMode === "chat" || centerMode === "diff" || centerMode === "editor") &&
      !showSpecHub &&
      !showWorkspaceHome
    : (isTablet ? tabletTab : activeTab) === "codex" && !showWorkspaceHome));
  const showGitDetail = Boolean(selectedDiffPath) && isPhone;
  const isThreadOpen = Boolean(activeThreadId && showComposer);
  const handleSelectDiffForPanel = useCallback(
    (path: string | null) => {
      if (!path) {
        setSelectedDiffPath(null);
        return;
      }
      handleSelectDiff(path);
    },
    [handleSelectDiff, setSelectedDiffPath],
  );
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
  }${
    reduceTransparency ? " reduced-transparency" : ""
  }${!isCompact && sidebarCollapsed && !showGitHistory ? " sidebar-collapsed" : ""}${
    !isCompact && rightPanelCollapsed ? " right-panel-collapsed" : ""
  }${shouldShowSidebarTopbarContent ? " sidebar-title-relocated" : ""}${
    showHome ? " home-active" : ""
  }${
    showKanban ? " kanban-active" : ""
  }${showGitHistory ? " git-history-active" : ""
  }`;
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
    threadListLoadingByWorkspace,
    threadListPagingByWorkspace,
    threadListCursorByWorkspace,
    activeWorkspaceId,
    activeThreadId,
    activeItems,
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
      selectWorkspace(workspaceId);
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
      const result = await removeThread(workspaceId, threadId);
      if (!result.success) {
        alertError(result.message ?? t("workspace.deleteConversationFailed"));
        return;
      }
      clearDraftForThread(threadId);
      removeImagesForThread(threadId);
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
      />
    ),
    filePanelMode,
    onFilePanelModeChange: setFilePanelMode,
    fileTreeLoading: isFilesLoading,
    onRefreshFiles: refreshFiles,
    onToggleRuntimeConsole: handleToggleRuntimeConsole,
    runtimeConsoleVisible: runtimeRunState.runtimeConsoleVisible,
    centerMode,
    editorSplitLayout,
    onToggleEditorSplitLayout: () =>
      setEditorSplitLayout((prev) => (prev === "vertical" ? "horizontal" : "vertical")),
    editorFilePath: activeEditorFilePath,
    editorNavigationTarget,
    openEditorTabs: openFileTabs,
    onActivateEditorTab: handleActivateFileTab,
    onCloseEditorTab: handleCloseFileTab,
    onCloseAllEditorTabs: handleCloseAllFileTabs,
    onActiveEditorLineRangeChange: setActiveEditorLineRange,
    onOpenFile: handleOpenFile,
    onExitEditor: handleExitEditor,
    onExitDiff: () => {
      setCenterMode("chat");
      setSelectedDiffPath(null);
    },
    activeTab,
    onSelectTab: setActiveTab,
    tabletNavTab: tabletTab,
    gitPanelMode,
    onGitPanelModeChange: handleGitPanelModeChange,
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
      onOpenDiffPath={(path) => handleSelectDiffForPanel(path)}
      onRequestClose={() => setAppMode("chat")}
    />
  );

  const desktopTopbarLeftNodeWithToggle = !isCompact ? (
    <div className="topbar-leading">
      <SidebarCollapseButton {...sidebarToggleProps} />
      {desktopTopbarLeftNode}
    </div>
  ) : (
    desktopTopbarLeftNode
  );
  const sidebarNodeWithTopbar = shouldShowSidebarTopbarContent &&
    isValidElement(sidebarNode)
    ? cloneElement(
        sidebarNode as React.ReactElement<{ topbarNode?: React.ReactNode }>,
        { topbarNode: desktopTopbarLeftNodeWithToggle },
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
      className={appClassName}
      style={
        {
          "--sidebar-width": `${
            isCompact
              ? sidebarWidth
              : settingsOpen
                ? 0
              : showGitHistory
                ? Math.max(sidebarWidth, 360)
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
      <TitlebarExpandControls {...sidebarToggleProps} />
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

function App() {
  const windowLabel = useWindowLabel();
  if (windowLabel === "about") {
    return (
      <Suspense fallback={null}>
        <AboutView />
      </Suspense>
    );
  }
  return <MainApp />;
}

export default App;
