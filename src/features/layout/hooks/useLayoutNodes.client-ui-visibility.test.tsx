// @vitest-environment jsdom
import { fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { ConversationItem, WorkspaceInfo } from "../../../types";
import { useLayoutNodes } from "./useLayoutNodes";

vi.mock("react-i18next", () => ({
  initReactI18next: {
    type: "3rdParty",
    init: vi.fn(),
  },
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@tauri-apps/api/dpi", () => ({
  LogicalPosition: class LogicalPosition {
    constructor(
      public x: number,
      public y: number,
    ) {}
  },
}));

vi.mock("@tauri-apps/api/menu", () => ({
  Menu: { new: vi.fn(async () => ({ popup: vi.fn() })) },
  MenuItem: { new: vi.fn(async (item: unknown) => item) },
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({})),
}));

vi.mock("../../client-ui-visibility/hooks/useClientUiVisibility", () => ({
  useClientUiVisibility: () => ({
    preference: {
      panels: {
        topSessionTabs: false,
        topRunControls: false,
        topToolControls: false,
        rightActivityToolbar: false,
        bottomActivityPanel: false,
        cornerStatusIndicator: false,
      },
      controls: {
        "topRun.start": false,
        "topTool.openWorkspace": false,
        "topTool.runtimeConsole": false,
        "topTool.terminal": false,
        "topTool.focus": false,
        "topTool.rightPanel": false,
        "rightToolbar.activity": false,
        "rightToolbar.radar": false,
        "rightToolbar.git": false,
        "rightToolbar.files": false,
        "rightToolbar.search": false,
        "bottomActivity.tasks": false,
        "bottomActivity.agents": false,
        "bottomActivity.edits": false,
        "bottomActivity.latestConversation": false,
        "curtain.stickyUserBubble": false,
        "cornerStatus.messageAnchors": false,
      },
    },
    isPanelVisible: () => false,
    isControlVisible: () => false,
    isControlPreferenceVisible: () => false,
    setPanelVisible: vi.fn(),
    setControlVisible: vi.fn(),
    resetVisibility: vi.fn(),
  }),
}));

vi.mock("../../app/components/Sidebar", () => ({
  Sidebar: ({ onOpenSettings }: { onOpenSettings: () => void }) => (
    <aside data-testid="sidebar">
      <button type="button" onClick={onOpenSettings}>
        settings
      </button>
    </aside>
  ),
}));

vi.mock("../../messages/components/Messages", () => ({
  Messages: ({
    showMessageAnchors,
    showStickyUserBubble,
  }: {
    showMessageAnchors: boolean;
    showStickyUserBubble: boolean;
  }) => (
    <section
      data-testid="messages"
      data-message-anchors={String(showMessageAnchors)}
      data-sticky-user-bubble={String(showStickyUserBubble)}
    />
  ),
}));

vi.mock("../../composer/components/Composer", () => ({
  Composer: ({
    draftText,
    onDraftChange,
    onSend,
    sendLabel,
  }: {
    draftText: string;
    onDraftChange: (next: string) => void;
    onSend: (text: string, images: string[]) => void;
    sendLabel: string;
  }) => (
    <form data-testid="composer">
      <textarea
        aria-label="composer input"
        value={draftText}
        onChange={(event) => onDraftChange(event.currentTarget.value)}
      />
      <button type="button" onClick={() => onSend(draftText, [])}>
        {sendLabel}
      </button>
    </form>
  ),
}));

vi.mock("../../app/components/MainHeader", () => ({
  MainHeader: ({ sessionTabsNode, extraActionsNode }: { sessionTabsNode?: ReactNode; extraActionsNode?: ReactNode }) => (
    <header data-testid="main-header">
      {sessionTabsNode}
      {extraActionsNode}
    </header>
  ),
}));

vi.mock("../../app/components/TopbarSessionTabs", () => ({
  TopbarSessionTabs: () => <div data-testid="topbar-session-tabs" />,
}));

vi.mock("../../home/components/HomeChat", () => ({
  HomeChat: ({ composerNode }: { composerNode?: ReactNode }) => (
    <section data-testid="home-chat">{composerNode}</section>
  ),
}));

vi.mock("../../update/components/UpdateToast", () => ({
  UpdateToast: () => <div data-testid="update-toast" />,
}));

vi.mock("../../notifications/components/ErrorToasts", () => ({
  ErrorToasts: () => <div data-testid="error-toasts" />,
}));

vi.mock("../../notifications/components/GlobalRuntimeNoticeDock", () => ({
  GlobalRuntimeNoticeDock: () => <div data-testid="runtime-notice-dock" />,
}));

vi.mock("../../git/components/GitDiffPanel", () => ({
  GitDiffPanel: () => <div data-testid="git-diff-panel" />,
}));

vi.mock("../../git/components/GitDiffViewer", () => ({
  GitDiffViewer: () => <div data-testid="git-diff-viewer" />,
}));

vi.mock("../../files/components/FileTreePanel", () => ({
  FileTreePanel: () => <div data-testid="file-tree-panel" />,
}));

vi.mock("../../search/components/WorkspaceSearchPanel", () => ({
  WorkspaceSearchPanel: () => <div data-testid="workspace-search-panel" />,
}));

vi.mock("../../files/components/FileViewPanel", () => ({
  FileViewPanel: () => <div data-testid="file-view-panel" />,
}));

vi.mock("../../prompts/components/PromptPanel", () => ({
  PromptPanel: () => <div data-testid="prompt-panel" />,
}));

vi.mock("../../project-memory/components/ProjectMemoryPanel", () => ({
  ProjectMemoryPanel: () => <div data-testid="project-memory-panel" />,
}));

vi.mock("../../session-activity/components/WorkspaceSessionActivityPanel", () => ({
  WorkspaceSessionActivityPanel: () => <div data-testid="workspace-session-activity-panel" />,
}));

vi.mock("../../session-activity/components/WorkspaceSessionRadarPanel", () => ({
  WorkspaceSessionRadarPanel: () => <div data-testid="workspace-session-radar-panel" />,
}));

vi.mock("../../debug/components/DebugPanel", () => ({
  DebugPanel: () => <div data-testid="debug-panel" />,
}));

vi.mock("../components/PanelTabs", () => ({
  PanelTabs: () => <div data-testid="panel-tabs" />,
}));

vi.mock("../../app/components/TabBar", () => ({
  TabBar: () => <div data-testid="tab-bar" />,
}));

vi.mock("../../app/components/TabletNav", () => ({
  TabletNav: () => <div data-testid="tablet-nav" />,
}));

vi.mock("../../terminal/components/TerminalDock", () => ({
  TerminalDock: () => <div data-testid="terminal-dock" />,
}));

vi.mock("../../terminal/components/TerminalPanel", () => ({
  TerminalPanel: () => <div data-testid="terminal-panel" />,
}));

vi.mock("../../status-panel/components/StatusPanel", () => ({
  StatusPanel: () => <div data-testid="status-panel" />,
}));

vi.mock("../../status-panel/hooks/useStatusPanelData", () => ({
  useStatusPanelData: () => ({
    todoTotal: 0,
    subagentTotal: 0,
    fileChanges: [],
    commandTotal: 0,
  }),
}));

vi.mock("../../session-activity/hooks/useWorkspaceSessionActivity", () => ({
  useWorkspaceSessionActivity: () => ({ isProcessing: false }),
}));

vi.mock("../../notifications/hooks/useGlobalRuntimeNoticeDock", () => ({
  useGlobalRuntimeNoticeDock: () => ({
    notices: [],
    visibility: "hidden",
    status: "idle",
    expand: vi.fn(),
    minimize: vi.fn(),
    clear: vi.fn(),
  }),
}));

const workspace: WorkspaceInfo = {
  id: "workspace-1",
  name: "Workspace",
  path: "/tmp/workspace",
  connected: true,
  settings: {},
} as WorkspaceInfo;

const activeItems: ConversationItem[] = [
  {
    id: "message-1",
    kind: "message",
    role: "user",
    text: "hello",
  },
];

const noop = vi.fn();
const asyncNoop = vi.fn(async () => undefined);

function createLayoutOptions(
  overrides: Partial<Parameters<typeof useLayoutNodes>[0]> = {},
): Parameters<typeof useLayoutNodes>[0] {
  return {
    workspaces: [workspace],
    groupedWorkspaces: [{ id: null, name: "Ungrouped", workspaces: [workspace] }],
    hasWorkspaceGroups: false,
    deletingWorktreeIds: new Set(),
    threadsByWorkspace: {
      [workspace.id]: [{ id: "thread-1", name: "Thread", updatedAt: 1 }],
    },
    threadParentById: {},
    threadStatusById: {},
    historyLoadingByThreadId: {},
    runningSessionCountByWorkspaceId: {},
    recentCompletedSessionCountByWorkspaceId: {},
    hydratedThreadListWorkspaceIds: new Set(),
    threadListLoadingByWorkspace: {},
    threadListPagingByWorkspace: {},
    threadListCursorByWorkspace: {},
    activeWorkspaceId: workspace.id,
    activeThreadId: "thread-1",
    activeItems,
    activeQueuedHandoffBubble: null,
    threadItemsByThread: {},
    sessionRadarRunningSessions: [],
    sessionRadarRecentCompletedSessions: [],
    activeRateLimits: null,
    usageShowRemaining: false,
    showMessageAnchors: true,
    accountInfo: null,
    onSwitchAccount: noop,
    onCancelSwitchAccount: noop,
    accountSwitching: false,
    codeBlockCopyUseModifier: false,
    openAppTargets: [],
    openAppIconById: {},
    selectedOpenAppId: "",
    onSelectOpenAppId: noop,
    approvals: [],
    userInputRequests: [],
    handleApprovalDecision: noop,
    handleApprovalBatchAccept: noop,
    handleApprovalRemember: noop,
    handleUserInputSubmit: asyncNoop,
    onOpenSettings: noop,
    onOpenExperimentalSettings: noop,
    onOpenDebug: noop,
    showDebugButton: false,
    onAddWorkspace: noop,
    onSelectHome: noop,
    onSelectWorkspace: noop,
    onConnectWorkspace: asyncNoop,
    onAddAgent: asyncNoop,
    onAddSharedAgent: asyncNoop,
    onAddWorktreeAgent: asyncNoop,
    onAddCloneAgent: asyncNoop,
    onToggleWorkspaceCollapse: noop,
    onSelectThread: noop,
    onDeleteThread: noop,
    onSyncThread: noop,
    pinThread: () => true,
    unpinThread: noop,
    isThreadPinned: () => false,
    isThreadAutoNaming: () => false,
    getPinTimestamp: () => null,
    pinnedThreadsVersion: 0,
    onRenameThread: noop,
    onAutoNameThread: noop,
    onDeleteWorkspace: noop,
    onDeleteWorktree: noop,
    onLoadOlderThreads: noop,
    onReloadWorkspaceThreads: noop,
    workspaceDropTargetRef: { current: null },
    isWorkspaceDropActive: false,
    workspaceDropText: "",
    onWorkspaceDragOver: noop,
    onWorkspaceDragEnter: noop,
    onWorkspaceDragLeave: noop,
    onWorkspaceDrop: noop,
    appMode: "chat",
    isPhone: false,
    isTablet: false,
    onAppModeChange: noop,
    onOpenHomeChat: noop,
    onOpenMemory: noop,
    onOpenProjectMemory: noop,
    onOpenReleaseNotes: noop,
    onOpenGlobalSearch: noop,
    globalSearchShortcut: null,
    openChatShortcut: null,
    openKanbanShortcut: null,
    cycleOpenSessionPrevShortcut: null,
    cycleOpenSessionNextShortcut: null,
    saveFileShortcut: null,
    findInFileShortcut: null,
    toggleGitDiffListViewShortcut: null,
    onOpenSpecHub: noop,
    onOpenWorkspaceHome: noop,
    updaterState: { status: "idle" },
    onUpdate: noop,
    onDismissUpdate: noop,
    errorToasts: [],
    onDismissErrorToast: noop,
    latestAgentRuns: [],
    isLoadingLatestAgents: false,
    onSelectHomeThread: noop,
    onSelectHomeWorkspace: noop,
    activeWorkspace: workspace,
    activeParentWorkspace: null,
    worktreeLabel: null,
    isWorktreeWorkspace: false,
    branchName: "main",
    branches: [],
    onCheckoutBranch: asyncNoop,
    onCreateBranch: asyncNoop,
    onCopyThread: noop,
    onToggleTerminal: noop,
    showTerminalButton: true,
    launchScript: null,
    launchScriptEditorOpen: false,
    launchScriptDraft: "",
    launchScriptSaving: false,
    launchScriptError: null,
    onRunLaunchScript: noop,
    onOpenLaunchScriptEditor: noop,
    onCloseLaunchScriptEditor: noop,
    onLaunchScriptDraftChange: noop,
    onSaveLaunchScript: noop,
    centerMode: "chat",
    editorSplitLayout: "vertical",
    onToggleEditorSplitLayout: noop,
    isEditorFileMaximized: false,
    onToggleEditorFileMaximized: noop,
    editorFilePath: null,
    editorNavigationTarget: null,
    editorHighlightTarget: null,
    openEditorTabs: [],
    onActivateEditorTab: noop,
    onCloseEditorTab: noop,
    onCloseAllEditorTabs: noop,
    onActiveEditorLineRangeChange: noop,
    onOpenFile: noop,
    onExitEditor: noop,
    onExitDiff: noop,
    activeTab: "codex",
    onSelectTab: noop,
    tabletNavTab: "codex",
    gitPanelMode: "diff",
    onGitPanelModeChange: noop,
    onOpenGitHistoryPanel: noop,
    gitDiffViewStyle: "split",
    gitDiffListView: "flat",
    onGitDiffListViewChange: noop,
    worktreeApplyLabel: "Apply",
    worktreeApplyTitle: null,
    worktreeApplyLoading: false,
    worktreeApplyError: null,
    worktreeApplySuccess: false,
    filePanelMode: "files",
    onFilePanelModeChange: noop,
    fileTreeLoading: false,
    fileTreeLoadError: null,
    onToggleRuntimeConsole: noop,
    runtimeConsoleVisible: false,
    gitStatus: {
      branchName: "main",
      files: [],
      stagedFiles: [],
      unstagedFiles: [],
      totalAdditions: 0,
      totalDeletions: 0,
      error: null,
    },
    fileStatus: "",
    selectedDiffPath: null,
    diffScrollRequestId: 0,
    onSelectDiff: noop,
    gitLogEntries: [],
    gitLogTotal: 0,
    gitLogAhead: 0,
    gitLogBehind: 0,
    gitLogAheadEntries: [],
    gitLogBehindEntries: [],
    gitLogUpstream: null,
    selectedCommitSha: null,
    onSelectCommit: noop,
    gitLogError: null,
    gitLogLoading: false,
    gitIssues: [],
    gitIssuesTotal: 0,
    gitIssuesLoading: false,
    gitIssuesError: null,
    gitPullRequests: [],
    gitPullRequestsTotal: 0,
    gitPullRequestsLoading: false,
    gitPullRequestsError: null,
    selectedPullRequestNumber: null,
    selectedPullRequest: null,
    selectedPullRequestComments: [],
    selectedPullRequestCommentsLoading: false,
    selectedPullRequestCommentsError: null,
    onSelectPullRequest: noop,
    gitRemoteUrl: null,
    gitRoot: null,
    gitRootCandidates: [],
    gitRootScanDepth: 3,
    gitRootScanLoading: false,
    gitRootScanError: null,
    gitRootScanHasScanned: false,
    onGitRootScanDepthChange: noop,
    onScanGitRoots: noop,
    onSelectGitRoot: noop,
    onClearGitRoot: noop,
    onPickGitRoot: noop,
    onStageGitAll: asyncNoop,
    onStageGitFile: asyncNoop,
    onUnstageGitFile: asyncNoop,
    onRevertGitFile: asyncNoop,
    onRevertAllGitChanges: asyncNoop,
    gitDiffs: [],
    gitDiffLoading: false,
    gitDiffError: null,
    onGitDiffViewStyleChange: noop,
    commitMessage: "",
    commitMessageLoading: false,
    commitMessageError: null,
    onCommitMessageChange: noop,
    onGenerateCommitMessage: noop,
    onSendPrompt: noop,
    onSendPromptToNewAgent: noop,
    onCreatePrompt: noop,
    onUpdatePrompt: noop,
    onDeletePrompt: noop,
    onMovePrompt: noop,
    onRevealWorkspacePrompts: noop,
    onRevealGeneralPrompts: noop,
    canRevealGeneralPrompts: false,
    onSend: noop,
    onQueue: noop,
    onStop: noop,
    canStop: false,
    isReviewing: false,
    isProcessing: false,
    steerEnabled: false,
    reviewPrompt: { open: false },
    onReviewPromptClose: noop,
    onReviewPromptShowPreset: noop,
    onReviewPromptChoosePreset: noop,
    highlightedPresetIndex: -1,
    onReviewPromptHighlightPreset: noop,
    highlightedBranchIndex: -1,
    onReviewPromptHighlightBranch: noop,
    highlightedCommitIndex: -1,
    onReviewPromptHighlightCommit: noop,
    onReviewPromptKeyDown: () => false,
    onReviewPromptSelectBranch: noop,
    onReviewPromptSelectBranchAtIndex: noop,
    onReviewPromptConfirmBranch: asyncNoop,
    onReviewPromptSelectCommit: noop,
    onReviewPromptSelectCommitAtIndex: noop,
    onReviewPromptConfirmCommit: asyncNoop,
    onReviewPromptUpdateCustomInstructions: noop,
    onReviewPromptConfirmCustom: asyncNoop,
    activeTokenUsage: null,
    activeQueue: [],
    draftText: "hello from maximum hidden mode",
    onDraftChange: noop,
    activeImages: [],
    onPickImages: noop,
    onAttachImages: noop,
    onRemoveImage: noop,
    prefillDraft: null,
    onPrefillHandled: noop,
    insertText: null,
    onInsertHandled: noop,
    onEditQueued: noop,
    onDeleteQueued: noop,
    onFuseQueued: noop,
    canFuseActiveQueue: false,
    activeFusingMessageId: null,
    collaborationModes: [],
    collaborationModesEnabled: false,
    selectedCollaborationModeId: null,
    onSelectCollaborationMode: noop,
    selectedEngine: "codex",
    models: [],
    selectedModelId: null,
    onSelectModel: noop,
    reasoningOptions: [],
    selectedEffort: null,
    onSelectEffort: noop,
    reasoningSupported: false,
    opencodeAgents: [],
    selectedOpenCodeAgent: null,
    onSelectOpenCodeAgent: noop,
    selectedAgent: null,
    onSelectAgent: noop,
    onOpenAgentSettings: noop,
    onOpenPromptSettings: noop,
    onOpenModelSettings: noop,
    opencodeVariantOptions: [],
    selectedOpenCodeVariant: null,
    onSelectOpenCodeVariant: noop,
    accessMode: "default",
    onSelectAccessMode: noop,
    skills: [],
    prompts: [],
    commands: [],
    files: [],
    directories: [],
    gitignoredFiles: new Set(),
    gitignoredDirectories: new Set(),
    onInsertComposerText: noop,
    textareaRef: { current: null },
    composerEditorSettings: {},
    composerSendShortcut: "enter",
    textareaHeight: 120,
    onTextareaHeightChange: noop,
    dictationEnabled: false,
    dictationState: { status: "idle" },
    dictationLevel: 0,
    onToggleDictation: noop,
    dictationTranscript: null,
    onDictationTranscriptHandled: noop,
    dictationError: null,
    onDismissDictationError: noop,
    dictationHint: null,
    onDismissDictationHint: noop,
    showComposer: true,
    composerLinkedKanbanPanels: [],
    selectedComposerKanbanPanelId: null,
    composerKanbanContextMode: "new",
    onSelectComposerKanbanPanel: noop,
    onComposerKanbanContextModeChange: noop,
    onOpenComposerKanbanPanel: noop,
    activeComposerFilePath: null,
    activeComposerFileLineRange: null,
    fileReferenceMode: "none",
    onFileReferenceModeChange: noop,
    plan: null,
    isPlanMode: false,
    onOpenPlanPanel: noop,
    onClosePlanPanel: noop,
    bottomStatusPanelExpanded: true,
    debugEntries: [],
    debugOpen: false,
    terminalOpen: false,
    terminalTabs: [],
    activeTerminalId: null,
    onSelectTerminal: noop,
    onNewTerminal: noop,
    onCloseTerminal: noop,
    terminalState: null,
    onClearDebug: noop,
    onCopyDebug: noop,
    onResizeDebug: noop,
    onResizeTerminal: noop,
    onBackFromDiff: noop,
    onGoProjects: noop,
    ...overrides,
  } as Parameters<typeof useLayoutNodes>[0];
}

describe("useLayoutNodes client UI visibility", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("keeps conversation, composer, send, and settings recovery available when every optional entry is hidden", () => {
    const onOpenSettings = vi.fn();
    const onSend = vi.fn();
    const { result } = renderHook(() =>
      useLayoutNodes(createLayoutOptions({ onOpenSettings, onSend })),
    );

    expect(result.current.rightPanelToolbarNode).toBeNull();
    expect(result.current.planPanelNode).toBeNull();

    render(
      <>
        {result.current.sidebarNode}
        {result.current.messagesNode}
        {result.current.composerNode}
      </>,
    );

    expect(screen.getByTestId("messages")).toBeTruthy();
    expect(screen.getByTestId("messages").dataset.messageAnchors).toBe("false");
    expect(screen.getByTestId("messages").dataset.stickyUserBubble).toBe("false");
    expect(screen.getByRole("textbox", { name: "composer input" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "messages.send" }));
    expect(onSend).toHaveBeenCalledWith("hello from maximum hidden mode", []);

    fireEvent.click(screen.getByRole("button", { name: "settings" }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});
