import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => {
  cleanup();
});

if (typeof Element !== "undefined" && !Element.prototype.getAnimations) {
  Object.defineProperty(Element.prototype, "getAnimations", {
    value: () => [],
    configurable: true,
  });
}

// Mock react-i18next to return keys or fallback text during tests
vi.mock("react-i18next", () => ({
  initReactI18next: {
    type: "3rdParty",
    init: vi.fn(),
  },
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) => {
      // Map keys to Chinese text for tests (matching default language)
      const translations: Record<string, string> = {
        "update.title": "Update",
        "update.checkingForUpdates": "Checking for updates...",
        "update.updateAvailable": "A new version is available.",
        "update.upToDate": "You're up to date.",
        "update.downloading": "Downloading update…",
        "update.installing": "Installing update…",
        "update.restarting": "Restarting…",
        "update.failed": "Update failed.",
        "update.downloaded": "downloaded",
        "update.releaseNotesTitle": "Release Notes",
        "update.releaseNotesLoading": "Loading release notes…",
        "update.releaseNotesLoadFailed": "Failed to load release notes.",
        "update.releaseNotesEmpty": "No release notes yet.",
        "update.releaseNotesPrev": "Previous",
        "update.releaseNotesNext": "Next",
        "update.releaseNotesPage": "{{current}} / {{total}}",
        "update.releaseNotesEnglish": "English:",
        "update.releaseNotesChinese": "中文：",
        "common.later": "Later",
        "common.dismiss": "Dismiss",
        "common.retry": "Retry",
        "common.deleting": "Deleting…",
        "errors.failedToCreateSession": "Failed to create session.",
        "errors.failedToCreateSessionNoThreadId":
          "The runtime did not return a new session id.",
        "errors.failedToCreateSessionRuntimeRecovering":
          "The runtime was restarting while creating this session. The app already retried once. Reconnect the workspace and try again.",
        "errors.reconnectAndRetryCreateSession":
          "Reconnect and retry creation",
        "errors.reconnectingAndRetryingCreateSession":
          "Reconnecting and retrying creation...",
        "errors.runtimeRecovered": "Runtime recovered.",
        "errors.retryingCreateSessionAfterRecovery":
          "Retrying session creation...",
        "runtimeNotice.title": "运行时提示",
        "runtimeNotice.open": "打开运行时提示",
        "runtimeNotice.minimize": "最小化",
        "runtimeNotice.clear": "清空",
        "runtimeNotice.emptyTitle": "暂无运行时提示",
        "runtimeNotice.emptyDescription": "初始化进度和关键错误会显示在这里",
        "runtimeNotice.statusIdle": "空闲",
        "runtimeNotice.statusStreaming": "运行中",
        "runtimeNotice.statusError": "异常",
        "runtimeNotice.severityInfo": "提示",
        "runtimeNotice.severityWarning": "警告",
        "runtimeNotice.severityError": "错误",
        "runtimeNotice.bootstrap.start": "正在初始化本地状态...",
        "runtimeNotice.bootstrap.storageMigrationCheck": "正在检查本地状态迁移...",
        "runtimeNotice.bootstrap.inputHistoryRestore": "正在恢复输入历史...",
        "runtimeNotice.bootstrap.interfaceResources": "正在加载界面资源...",
        "runtimeNotice.bootstrap.mountShell": "正在挂载客户端界面...",
        "runtimeNotice.bootstrap.localStorageMigrationFailed":
          "本地状态迁移失败，已按降级模式继续启动",
        "runtimeNotice.bootstrap.ready": "客户端初始化完成",
        "runtimeNotice.bootstrap.failed": "客户端初始化失败，请刷新后重试",
        "runtimeNotice.runtime.startupPending":
          `${String(params?.workspace ?? "")}：${String(params?.engine ?? "Runtime")} runtime 正在连接...`,
        "runtimeNotice.runtime.resumePending":
          `${String(params?.workspace ?? "")}：Runtime 探活异常，正在尝试恢复`,
        "runtimeNotice.runtime.ready":
          `${String(params?.workspace ?? "")}：${String(params?.engine ?? "Runtime")} runtime 已连接`,
        "runtimeNotice.runtime.suspectStale":
          `${String(params?.workspace ?? "")}：Runtime 探活异常，正在尝试恢复`,
        "runtimeNotice.runtime.cooldown":
          `${String(params?.workspace ?? "")}：Runtime 恢复失败，当前处于冷却期`,
        "runtimeNotice.runtime.quarantined":
          `${String(params?.workspace ?? "")}：Runtime 恢复失败，需要人工关注`,
        "runtimeNotice.error.threadTurnFailed":
          `${String(params?.engine ?? "Runtime")} 会话失败：${String(params?.message ?? "")}`,
        "runtimeNotice.engine.checking":
          `正在检测 ${String(params?.engine ?? "")} 状态...`,
        "runtimeNotice.engine.ready":
          `${String(params?.engine ?? "")} 已就绪`,
        "runtimeNotice.engine.unavailable":
          `${String(params?.engine ?? "")} 未安装，请先安装`,
        "runtimeNotice.engine.requiresLogin":
          `${String(params?.engine ?? "")} 需先登录`,
        "runtimeNotice.error.createSessionRecoveryRequired":
          `${String(params?.workspace ?? "")}：会话创建失败，运行时正在恢复`,
        "sidebar.searchProjects": "Search projects",
        "sidebar.clearSearch": "Clear search",
        "sidebar.pinned": "Pinned",
        "sidebar.newAgent": "New agent",
        "sidebar.newWorktreeAgent": "New worktree agent",
        "sidebar.newCloneAgent": "New clone agent",
        "sidebar.noProjectsMatch": "No projects match your search.",
        "sidebar.addWorkspaceToStart": "Add a workspace to start.",
        "sidebar.quickNewThread": "Home",
        "sidebar.quickAutomation": "Automation",
        "sidebar.quickSearch": "Search",
        "sidebar.quickSkills": "Skills",
        "sidebar.releaseNotes": "Release Notes",
        "sidebar.threadsSection": "Threads",
        "sidebar.dropProjectHere": "Drop Project Here",
        "sidebar.addingProject": "Adding Project...",
        "sidebar.apiKey": "API key",
        "sidebar.signInToCodex": "Sign in to Codex",
        "sidebar.switchAccount": "Switch account",
        "sidebar.signIn": "Sign in",
        "threads.size": "Size",
        "app.title": "ccgui",
        "app.subtitle": "Orchestrate agents across your local projects.",
        "home.latestAgents": "Latest agents",
        "home.agentReplied": "Agent replied.",
        "home.running": "Running",
        "home.loadingAgents": "Loading agents",
        "home.noAgentActivity": "No agent activity yet",
        "home.startThreadToSee": "Start a thread to see the latest responses here.",
        "home.openProject": "Add project",
        "home.addWorkspace": "Add Workspace",
        "home.usageSnapshot": "Usage snapshot",
        "home.refreshUsage": "Refresh usage",
        "home.workspace": "Workspace",
        "home.allWorkspaces": "All workspaces",
        "home.view": "View",
        "home.tokens": "Tokens",
        "home.time": "Time",
        "settings.title": "Settings",
        "settings.theme": "Theme",
        "settings.themeSystem": "System",
        "settings.themeLight": "Light",
        "settings.themeDark": "Dark",
        "settings.themeDim": "Dim",
        "settings.themeCustom": "Custom",
        "settings.themePreset": "Theme Palette",
        "settings.themePresetDescription": "Choose any VS Code-inspired palette for the Custom theme.",
        "settings.themePresetDarkModern": "Dark Modern",
        "settings.themePresetDarkPlus": "Dark+",
        "settings.themePresetLightModern": "Light Modern",
        "settings.themePresetLightPlus": "Light+",
        "settings.themePresetGitHubLight": "GitHub Light",
        "settings.themePresetSolarizedLight": "Solarized Light",
        "settings.themePresetGitHubDark": "GitHub Dark",
        "settings.themePresetGitHubDarkDimmed": "GitHub Dark Dimmed",
        "settings.themePresetOneDarkPro": "One Dark Pro",
        "settings.themePresetMonokai": "Monokai",
        "settings.themePresetSolarizedDark": "Solarized Dark",
        "settings.language": "Language",
        "settings.languageZh": "中文",
        "settings.languageEn": "English",
        "settings.projectsTitle": "Projects",
        "settings.projectsDescription": "Group related workspaces and reorder projects within each group.",
        "settings.groupsTitle": "GROUPS",
        "settings.groupsDescription": "Create group labels for related repositories.",
        "settings.newGroupPlaceholder": "New group name",
        "settings.addGroupButton": "Add group",
        "settings.noGroupsYet": "No groups yet.",
        "settings.projectsSubsectionTitle": "PROJECTS",
        "settings.projectsSubsectionDescription": "Assign projects to groups and adjust their order.",
        "settings.ungrouped": "Ungrouped",
        "settings.sidebarProjectManagement": "Project Management",
        "settings.sidebarBasic": "Basic Settings",
        "settings.sidebarMcpSkills": "MCP / Skills",
        "settings.sidebarAgentPromptManagement": "Agents / Prompts",
        "settings.sidebarRuntimeEnvironment": "Runtime Environment",
        "settings.basicShortcutsTab": "Shortcuts",
        "settings.basicOpenAppsTab": "Open in",
        "settings.basicWebServiceTab": "Web Service",
        "settings.basicEmailTab": "Email",
        "settings.mcpSkillsDescription":
          "Inspect MCP servers and browse global Skills from one place.",
        "settings.sidebarUsage": "Usage",
        "settings.sidebarWebService": "Web Service",
        "settings.sidebarEmail": "Email",
        "settings.agentPromptAgentsTab": "Agents",
        "settings.agentPromptPromptsTab": "Prompts",
        "settings.runtimeEnvironmentPoolTab": "Runtime Pool",
        "settings.runtimeEnvironmentCliValidationTab": "CLI Validation",
        "settings.skillsPanel.title": "Skills",
        "settings.sidebarDisplay": "Display & Sound",
        "settings.sidebarComposer": "Composer",
        "settings.sidebarDictation": "Dictation",
        "settings.sidebarGit": "Git",
        "settings.sidebarOther": "Other",
        "settings.sidebarReleaseNotes": "Release Notes",
        "settings.releaseNotesDescription": "Review feature updates and fixes from every release.",
        "settings.openReleaseNotes": "Open release notes",
        "settings.cliValidationTitle": "CLI Validation",
        "settings.cliValidationDescription":
          "Validate the CLIs used by ccgui, choose the shared execution backend once, and switch diagnostics between Codex and Claude Code.",
        "settings.cliExecutionBackendTitle": "Execution backend",
        "settings.cliExecutionBackendDescription":
          "These transport settings are shared by Codex and Claude Code runtime requests.",
        "settings.cliValidationTabCodex": "Codex",
        "settings.cliValidationTabClaudeCode": "Claude Code",
        "settings.runClaudeDoctor": "Run Claude Doctor",
        "settings.defaultClaudePath": "Default Claude Code path",
        "settings.sidebarExperimental": "Experimental",
        "settings.basicAppearance": "Appearance",
        "settings.basicBehavior": "Behavior",
        "settings.projectManagementDescription": "Manage project groups and real workspace sessions from one place.",
        "settings.projectManagementGroupsTab": "Groups",
        "settings.projectManagementSessionsTab": "Session Management",
        "settings.projectManagementUsageTab": "Usage",
        "settings.usagePanel.title": "Usage",
        "settings.webServiceTitle": "Web Service",
        "settings.emailTitle": "Email",
        "settings.agentPromptManagementDescription": "Manage reusable agents and prompt assets from one place.",
        "settings.runtimeEnvironmentDescription": "Inspect runtime pool state and validate local CLI installations from one place.",
        "settings.performanceCompatibilityTitle": "Low-performance compatibility mode",
        "settings.performanceCompatibilityDesc": "Opt-in fallback for older machines that show high foreground CPU while idle.",
        "settings.performanceCompatibilityEnabled": "Enable low-performance compatibility mode",
        "settings.performanceCompatibilityStatusEnabled": "Compatibility mode on",
        "settings.performanceCompatibilityStatusDisabled": "Compatibility mode off",
        "settings.performanceCompatibilityHint":
          "When enabled, non-critical UI refreshes may update less often or pause while the window is hidden. Sending messages, files, Git, and runtime behavior stay unchanged.",
        "settings.diagnosticsBundleTitle": "Diagnostics bundle",
        "settings.diagnosticsBundleDesc": "Export a local JSON bundle for performance, startup, runtime, UI, or configuration bug reports.",
        "settings.diagnosticsBundleExport": "Export diagnostics",
        "settings.diagnosticsBundleExporting": "Exporting...",
        "settings.diagnosticsBundleExported": `Diagnostics bundle exported: ${String(params?.path ?? "")}`,
        "settings.diagnosticsBundleExportFailed": `Failed to export diagnostics: ${String(params?.error ?? "")}`,
        "settings.diagnosticsBundleLocalOnly": "Local file only",
        "settings.diagnosticsBundleHint":
          "The bundle includes bounded settings, runtime, renderer, platform, and client store evidence. It avoids tokens and message text.",
        "settings.terminalShellPathTitle": "Terminal shell",
        "settings.terminalShellPathDesc": "Choose the executable used when opening the built-in terminal.",
        "settings.terminalShellPathLabel": "Terminal shell path",
        "settings.terminalShellPathPlaceholder": "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
        "settings.terminalShellPathHint":
          "Windows example: C:\\Program Files\\PowerShell\\7\\pwsh.exe; macOS example: /bin/zsh or /opt/homebrew/bin/fish. Leave empty to use COMSPEC on Windows or SHELL on macOS/Linux.",
        "settings.terminalShellPathSave": "Save terminal shell path",
        "settings.terminalShellPathClear": "Clear terminal shell path",
        "settings.showRemainingLimits": "Show remaining Codex limits",
        "settings.reduceTransparency": "Reduce transparency",
        "settings.fontSizeLabel": "Font size",
        "settings.fontSizeLevel1": "Small (80%)",
        "settings.fontSizeLevel2": "Smaller (90%)",
        "settings.fontSizeLevel3": "Default (100%)",
        "settings.fontSizeLevel4": "Larger (110%)",
        "settings.fontSizeLevel5": "Large (120%)",
        "settings.fontSizeLevel6": "Largest (140%)",
        "settings.fontSizeCustom": "Custom ({{value}})",
        "settings.notificationSounds": "Notification sounds",
        "settings.notificationSoundsEnabled": "Enabled",
        "settings.notificationSoundsDisabled": "Disabled",
        "settings.notificationSoundsHint": "When enabled, a notification sound plays when AI completes a task, even if you are away from the screen.",
        "settings.soundSelectLabel": "Notification sound",
        "settings.soundOptionDefault": "Default",
        "settings.soundOptionChime": "Chime",
        "settings.soundOptionBell": "Bell",
        "settings.soundOptionDing": "Ding",
        "settings.soundOptionSuccess": "Success",
        "settings.soundOptionCustom": "Custom…",
        "settings.soundCustomFileLabel": "Custom sound file",
        "settings.soundCustomPlaceholder": "Select or enter audio file path",
        "settings.soundCustomHint": "Supports WAV, MP3, AIFF formats.",
        "settings.systemNotification": "System Notifications",
        "settings.systemNotificationDesc": "Send system-level notifications when sessions complete, even when the window is not in focus.",
        // Common actions
        "settings.close": "Close",
        "settings.closeSettings": "Close settings",
        "settings.backToApp": "Back to app",
        "settings.save": "Save",
        "settings.saving": "Saving...",
        "settings.reset": "Reset",
        "settings.clear": "Clear",
        "settings.browse": "Browse",
        "settings.chooseEllipsis": "Choose…",
        "settings.notSet": "Not set",
        "settings.notFound": "Not found",
        "settings.truncated": "Truncated",
        "settings.loading": "Loading…",
        "settings.test": "Test",
        "settings.testSound": "Test sound",
        "settings.default": "Default",
        "settings.defaultColon": "Default:",
        "settings.ok": "OK",
        "settings.moveUp": "Move up",
        "settings.moveDown": "Move down",
        "settings.remove": "Remove",
        "settings.add": "Add",
        // Composer presets
        "settings.composerPresetDefault": "Default (no helpers)",
        "settings.composerPresetHelpful": "Helpful",
        "settings.composerPresetSmart": "Smart",
        // Dictation models
        "settings.dictationModelTiny": "Tiny",
        "settings.dictationModelBase": "Base",
        "settings.dictationModelSmall": "Small",
        "settings.dictationModelMedium": "Medium",
        "settings.dictationModelLargeV3": "Large V3",
        "settings.dictationModelFastest": "Fastest, least accurate.",
        "settings.dictationModelBalanced": "Balanced default.",
        "settings.dictationModelBetter": "Better accuracy.",
        "settings.dictationModelHigh": "High accuracy.",
        "settings.dictationModelBest": "Best accuracy, heavy download.",
        // Projects section (additional)
        "settings.copiesFolder": "Copies folder",
        "settings.deleteGroupTitle": "Delete Group",
        "settings.deleteGroupWarning": "Projects in this group will move to",
        "settings.moveGroupUp": "Move group up",
        "settings.moveGroupDown": "Move group down",
        "settings.deleteGroup": "Delete group",
        "settings.moveProjectUp": "Move project up",
        "settings.moveProjectDown": "Move project down",
        "settings.deleteProject": "Delete project",
        "settings.noProjectsYet": "No projects yet.",
        // Display & Sound section
        "settings.displayTitle": "Display & Sound",
        "settings.displayDescription": "Tune visuals and audio alerts to your preferences.",
        "settings.displaySubtitle": "Display",
        "settings.displaySubDescription": "Adjust how the window renders backgrounds and effects.",
        "settings.clientUiVisibility.title": "Client UI visibility",
        "settings.clientUiVisibility.description": "Hide optional panels and icon buttons without disabling the underlying features.",
        "settings.clientUiVisibility.reset": "Restore default visibility",
        "settings.clientUiVisibility.parentHiddenHint": "This entry stays saved and applies when the parent panel is shown again.",
        "settings.clientUiVisibility.panels.topSessionTabs": "Top session tabs",
        "settings.clientUiVisibility.panels.topRunControls": "Top run controls",
        "settings.clientUiVisibility.panels.topToolControls": "Top tool controls",
        "settings.clientUiVisibility.panels.rightActivityToolbar": "Right activity toolbar",
        "settings.clientUiVisibility.panels.bottomActivityPanel": "Bottom activity panel",
        "settings.clientUiVisibility.panels.cornerStatusIndicator": "Conversation canvas",
        "settings.clientUiVisibility.panels.globalRuntimeNoticeDock": "Runtime notice dock",
        "settings.clientUiVisibility.panelDescriptions.topSessionTabs": "Open-session tabs above the workspace header.",
        "settings.clientUiVisibility.panelDescriptions.topRunControls": "Launch script controls near the workspace header.",
        "settings.clientUiVisibility.panelDescriptions.topToolControls": "Workspace, runtime, terminal, focus, and right-panel shortcuts.",
        "settings.clientUiVisibility.panelDescriptions.rightActivityToolbar": "Right-side entries for activity, radar, Git, files, and search.",
        "settings.clientUiVisibility.panelDescriptions.bottomActivityPanel": "Docked task, agent, edit, and latest-message status panel.",
        "settings.clientUiVisibility.panelDescriptions.cornerStatusIndicator": "Sticky user bubble and message anchor rail in the conversation canvas.",
        "settings.clientUiVisibility.panelDescriptions.globalRuntimeNoticeDock": "Global bottom-right runtime notice entry and expandable notice panel.",
        "settings.clientUiVisibility.controls.topRunStart": "Launch script buttons",
        "settings.clientUiVisibility.controls.topToolOpenWorkspace": "Open workspace app",
        "settings.clientUiVisibility.controls.topToolRuntimeConsole": "Runtime console shortcut",
        "settings.clientUiVisibility.controls.topToolTerminal": "Terminal shortcut",
        "settings.clientUiVisibility.controls.topToolFocus": "Focus mode shortcut",
        "settings.clientUiVisibility.controls.topToolRightPanel": "Right panel toggle",
        "settings.clientUiVisibility.controls.rightToolbarActivity": "Activity entry",
        "settings.clientUiVisibility.controls.rightToolbarRadar": "Radar entry",
        "settings.clientUiVisibility.controls.rightToolbarGit": "Git entry",
        "settings.clientUiVisibility.controls.rightToolbarFiles": "Files entry",
        "settings.clientUiVisibility.controls.rightToolbarSearch": "Search entry",
        "settings.clientUiVisibility.controls.bottomActivityTasks": "Tasks tab",
        "settings.clientUiVisibility.controls.bottomActivityAgents": "Agents tab",
        "settings.clientUiVisibility.controls.bottomActivityEdits": "Edits tab",
        "settings.clientUiVisibility.controls.bottomActivityLatestConversation": "Latest conversation tab",
        "settings.clientUiVisibility.controls.curtainStickyUserBubble": "Sticky user bubble",
        "settings.clientUiVisibility.controls.curtainContextLedger": "Context sources card",
        "settings.clientUiVisibility.controls.cornerStatusMessageAnchors": "Message anchors",
        "settings.clientUiVisibility.controlDescriptions.topRunStart": "Hides launch script run/edit buttons only.",
        "settings.clientUiVisibility.controlDescriptions.topToolOpenWorkspace": "Hides the app launcher for opening the workspace elsewhere.",
        "settings.clientUiVisibility.controlDescriptions.topToolRuntimeConsole": "Hides the top runtime console shortcut; runtime behavior is unchanged.",
        "settings.clientUiVisibility.controlDescriptions.topToolTerminal": "Hides the top terminal shortcut; terminal shortcuts keep working.",
        "settings.clientUiVisibility.controlDescriptions.topToolFocus": "Hides the focus mode shortcut without changing focus state.",
        "settings.clientUiVisibility.controlDescriptions.topToolRightPanel": "Hides the top right-panel collapse/expand button.",
        "settings.clientUiVisibility.controlDescriptions.rightToolbarActivity": "Hides the activity panel entry without clearing collected activity.",
        "settings.clientUiVisibility.controlDescriptions.rightToolbarRadar": "Hides the radar panel entry without stopping session tracking.",
        "settings.clientUiVisibility.controlDescriptions.rightToolbarGit": "Hides the Git panel entry without changing Git state.",
        "settings.clientUiVisibility.controlDescriptions.rightToolbarFiles": "Hides the file tree entry without closing opened files.",
        "settings.clientUiVisibility.controlDescriptions.rightToolbarSearch": "Hides the workspace search entry without changing search state.",
        "settings.clientUiVisibility.controlDescriptions.bottomActivityTasks": "Hides the task status tab.",
        "settings.clientUiVisibility.controlDescriptions.bottomActivityAgents": "Hides the agent status tab.",
        "settings.clientUiVisibility.controlDescriptions.bottomActivityEdits": "Hides the edit summary tab.",
        "settings.clientUiVisibility.controlDescriptions.bottomActivityLatestConversation": "Hides the latest conversation tab.",
        "settings.clientUiVisibility.controlDescriptions.curtainStickyUserBubble": "Hides the sticky user bubble at the top of the conversation canvas.",
        "settings.clientUiVisibility.controlDescriptions.curtainContextLedger": "Hides the context sources card above the composer without disabling ledger calculations.",
        "settings.clientUiVisibility.controlDescriptions.cornerStatusMessageAnchors": "Hides message anchor dots from the conversation canvas.",
        "settings.showRemainingLimitsDesc": "Display what is left instead of what is used.",
        "settings.reduceTransparencyDesc": "Use solid surfaces instead of glass.",
        "settings.interfaceScale": "Interface scale",
        "settings.interfaceScaleAriaLabel": "Interface scale",
        "settings.canvasWidth": "Canvas width",
        "settings.canvasWidthDesc": "Controls content width for the message canvas and composer.",
        "settings.canvasWidthNarrow": "Narrow canvas",
        "settings.canvasWidthWide": "Wide canvas",
        "settings.layoutMode": "Layout switch",
        "settings.layoutModeDesc": "Switch left and right panels while keeping the center view unchanged.",
        "settings.layoutModeDefault": "Default layout",
        "settings.layoutModeSwapped": "Left on right",
        "settings.uiFontFamily": "UI font family",
        "settings.uiFontFamilyDesc": "Applies to all UI text. Leave empty to use the default system font stack.",
        "settings.codeFontFamily": "Code font family",
        "settings.codeFontFamilyDesc": "Applies to git diffs and other mono-spaced readouts.",
        "settings.codeFontSize": "Code font size",
        "settings.codeFontSizeDesc": "Adjusts code and diff text size.",
        "settings.soundsSubtitle": "Sounds",
        "settings.soundsSubDescription": "Control notification audio alerts.",
        "settings.notificationSoundsDesc": "Play a notification sound when AI completes a task.",
        // Composer section
        "settings.composerTitle": "Composer",
        "settings.composerDescription": "Control helpers and formatting behavior inside the message editor.",
        "settings.sendShortcutSubtitle": "Send shortcut",
        "settings.sendShortcutSubDescription": "Choose how to send messages and insert new lines in the composer.",
        "settings.sendShortcutEnterTitle": "Enter sends",
        "settings.sendShortcutEnterDesc": "Press Enter to send, Shift+Enter for a new line.",
        "settings.sendShortcutCmdEnterTitle": "⌘/Ctrl+Enter sends",
        "settings.sendShortcutCmdEnterDesc": "Press ⌘/Ctrl+Enter to send, Enter for a new line.",
        "settings.presetsSubtitle": "Presets",
        "settings.presetsSubDescription": "Choose a starting point and fine-tune the toggles below.",
        "settings.preset": "Preset",
        "settings.presetDesc": "Presets update the toggles below. Customize any setting after selecting.",
        "settings.codeFencesSubtitle": "Code fences",
        "settings.expandFencesOnSpace": "Expand fences on Space",
        "settings.expandFencesOnSpaceDesc": "Typing ``` then Space inserts a fenced block.",
        "settings.expandFencesOnEnter": "Expand fences on Enter",
        "settings.expandFencesOnEnterDesc": "Use Enter to expand ``` lines when enabled.",
        "settings.supportLanguageTags": "Support language tags",
        "settings.supportLanguageTagsDesc": "Allows ```lang + Space to include a language.",
        "settings.wrapSelectionInFences": "Wrap selection in fences",
        "settings.wrapSelectionInFencesDesc": "Wraps selected text when creating a fence.",
        "settings.copyBlocksWithoutFences": "Copy blocks without fences",
        "settings.copyBlocksWithoutFencesDesc": "When enabled, Copy is plain text. Hold Option to include ``` fences.",
        "settings.pastingSubtitle": "Pasting",
        "settings.autoWrapMultiLinePaste": "Auto-wrap multi-line paste",
        "settings.autoWrapMultiLinePasteDesc": "Wraps multi-line paste inside a fenced block.",
        "settings.autoWrapCodeLikeSingleLines": "Auto-wrap code-like single lines",
        "settings.autoWrapCodeLikeSingleLinesDesc": "Wraps long single-line code snippets on paste.",
        "settings.listsSubtitle": "Lists",
        "settings.continueListsOnShiftEnter": "Continue lists on Shift+Enter",
        "settings.continueListsOnShiftEnterDesc": "Continues numbered and bulleted lists when the line has content.",
        // Dictation section
        "settings.dictationTitle": "Dictation",
        "settings.dictationDescription": "Enable microphone dictation with on-device transcription.",
        "settings.enableDictation": "Enable dictation",
        "settings.enableDictationDesc": "Downloads the selected Whisper model on first use.",
        "settings.dictationModel": "Dictation model",
        "settings.downloadSize": "Download size:",
        "settings.preferredDictationLanguage": "Preferred dictation language",
        "settings.autoDetectOnly": "Auto-detect only",
        "settings.languageEnglish": "English",
        "settings.languageSpanish": "Spanish",
        "settings.languageFrench": "French",
        "settings.languageGerman": "German",
        "settings.languageItalian": "Italian",
        "settings.languagePortuguese": "Portuguese",
        "settings.languageDutch": "Dutch",
        "settings.languageSwedish": "Swedish",
        "settings.languageNorwegian": "Norwegian",
        "settings.languageDanish": "Danish",
        "settings.languageFinnish": "Finnish",
        "settings.languagePolish": "Polish",
        "settings.languageTurkish": "Turkish",
        "settings.languageRussian": "Russian",
        "settings.languageUkrainian": "Ukrainian",
        "settings.languageJapanese": "Japanese",
        "settings.languageKorean": "Korean",
        "settings.languageChinese": "Chinese",
        "settings.languageDetectionDesc": "Auto-detect stays on; this nudges the decoder toward your preference.",
        "settings.holdToDictateKey": "Hold-to-dictate key",
        "settings.holdToDictateOff": "Off",
        "settings.holdToDictateOption": "Option / Alt",
        "settings.holdToDictateShift": "Shift",
        "settings.holdToDictateControl": "Control",
        "settings.holdToDictateCommand": "Command / Meta",
        "settings.holdToDictateDesc": "Hold the key to start dictation, release to stop and process.",
        "settings.modelStatus": "Model status",
        "settings.modelReady": "Ready for dictation.",
        "settings.modelNotDownloaded": "Model not downloaded yet.",
        "settings.modelDownloading": "Downloading model...",
        "settings.modelDownloadError": "Download error.",
        "settings.downloadModel": "Download model",
        "settings.cancelDownload": "Cancel download",
        "settings.removeModel": "Remove model",
        // Shortcuts section
        "settings.shortcutsTitle": "Shortcuts",
        "settings.shortcutsDescription": "Customize keyboard shortcuts for file actions, composer, panels, and navigation.",
        "settings.fileSubtitle": "File",
        "settings.fileSubDescription": "Create agents and worktrees from the keyboard.",
        "settings.newAgent": "New Agent",
        "settings.newWorktreeAgent": "New Worktree Agent",
        "settings.newCloneAgent": "New Clone Agent",
        "settings.archiveActiveThread": "Archive active thread",
        "settings.typeShortcut": "Type shortcut",
        "settings.pressNewShortcut": "Press a new shortcut while focused. Default:",
        "settings.composerSubtitle": "Composer",
        "settings.composerSubDescription": "Cycle between model, access, reasoning, and collaboration modes.",
        "settings.cycleModel": "Cycle model",
        "settings.cycleAccessMode": "Cycle access mode",
        "settings.cycleReasoningMode": "Cycle reasoning mode",
        "settings.cycleCollaborationMode": "Cycle collaboration mode",
        "settings.stopActiveRun": "Stop active run",
        "settings.panelsSubtitle": "Panels",
        "settings.panelsSubDescription": "Toggle sidebars and panels.",
        "settings.toggleProjectsSidebar": "Toggle projects sidebar",
        "settings.toggleGitSidebar": "Toggle right sidebar",
        "settings.toggleGlobalSearch": "Toggle global search",
        "settings.toggleDebugPanel": "Toggle debug panel",
        "settings.toggleTerminalPanel": "Toggle terminal panel",
        "settings.navigationSubtitle": "Navigation",
        "settings.navigationSubDescription": "Cycle between agents and workspaces.",
        "settings.nextAgent": "Next agent",
        "settings.previousAgent": "Previous agent",
        "settings.nextWorkspace": "Next workspace",
        "settings.previousWorkspace": "Previous workspace",
        // Open in section
        "settings.openInTitle": "Open in",
        "settings.openInDescription": "Customize the Open in menu shown in the title bar and file previews.",
        "settings.label": "Label",
        "settings.type": "Type",
        "settings.typeApp": "App",
        "settings.typeCommand": "Command",
        "settings.typeFinder": "Finder",
        "settings.appName": "App name",
        "settings.command": "Command",
        "settings.args": "Args",
        "settings.defaultRadio": "Default",
        "settings.removeApp": "Remove app",
        "settings.removeAppAriaLabel": "Remove app",
        "settings.addApp": "Add app",
        "settings.openInHelp": "Commands receive the selected path as the final argument. Apps use macOS open with optional args.",
        "settings.newApp": "New App",
        // Git section
        "settings.gitTitle": "Git",
        "settings.gitDescription": "Manage how diffs are loaded in the Git sidebar.",
        "settings.preloadGitDiffs": "Preload git diffs",
        "settings.preloadGitDiffsDesc": "Make viewing git diff faster.",
        // Codex section
        "settings.codexTitle": "Codex",
        "settings.codexDescription": "Configure the Codex CLI used by ccgui and validate the install.",
        "settings.defaultCodexPath": "Default Codex path",
        "settings.codexPlaceholder": "codex",
        "settings.usePath": "Use PATH",
        "settings.pathResolutionDesc": "Leave empty to use the system PATH resolution.",
        "settings.defaultCodexArgs": "Default Codex args",
        "settings.codexArgsPlaceholder": "--profile personal",
        "settings.codexArgsDesc": "Extra flags passed before",
        "settings.appServer": "app-server",
        "settings.codexArgsDescSuffix": ". Use quotes for values with spaces.",
        "settings.runDoctor": "Run doctor",
        "settings.running": "Running...",
        "settings.codexLooksGood": "Codex looks good",
        "settings.codexIssueDetected": "Codex issue detected",
        "settings.versionLabel": "Version:",
        "settings.appServerLabel": "App-server:",
        "settings.nodeLabel": "Node:",
        "settings.pathLabel": "PATH:",
        "settings.statusOk": "ok",
        "settings.statusFailed": "failed",
        "settings.statusMissing": "missing",
        "settings.statusUnknown": "unknown",
        "settings.doctorAppServerProbe": "App Server Probe",
        "settings.doctorResolvedBinary": "Resolved Binary",
        "settings.doctorWrapperKind": "Wrapper Kind",
        "settings.doctorWrapperFallbackRetry": "Wrapper Fallback Retry",
        "settings.doctorProxyEnvironment": "Proxy Environment",
        "settings.doctorDebugInfo": "Debug Info",
        "settings.doctorClickToExpand": "Click to expand",
        "settings.doctorPlatform": "Platform",
        "settings.doctorPathUsed": "PATH Used",
        "settings.doctorClaudeFound": "Claude Found",
        "settings.doctorCodexFound": "Codex Found",
        "settings.doctorClaudeStandardWhich": "Claude (standard which)",
        "settings.doctorCodexStandardWhich": "Codex (standard which)",
        "settings.doctorAttempted": "attempted",
        "settings.defaultAccessMode": "Default access mode",
        "settings.readOnly": "Read only",
        "settings.onRequest": "On-request",
        "settings.fullAccess": "Full access",
        "settings.backendMode": "Backend mode",
        "settings.backendLocal": "Local (default)",
        "settings.backendRemote": "Remote (daemon)",
        "settings.backendRemoteDesc": "Remote mode connects to a separate daemon running the backend on another machine (e.g. WSL2/Linux).",
        "settings.remoteBackend": "Remote backend",
        "settings.remoteBackendHost": "127.0.0.1:4732",
        "settings.remoteBackendToken": "Token (optional)",
        "settings.remoteBackendHostAriaLabel": "Remote backend host",
        "settings.remoteBackendTokenAriaLabel": "Remote backend token",
        "settings.remoteBackendDesc": "Start the daemon separately and point ccgui to it (host:port + token).",
        "settings.globalAgentsMd": "Global AGENTS.md",
        "settings.globalAgentsMdPlaceholder": "Add global instructions for Codex agents…",
        "settings.storedAt": "Stored at",
        "settings.globalConfigToml": "Global config.toml",
        "settings.globalConfigTomlPlaceholder": "Edit the global Codex config.toml…",
        "settings.workspaceOverrides": "Workspace overrides",
        "settings.codexBinaryOverride": "Codex binary override",
        "settings.codexHomeOverride": "CODEX_HOME override",
        "settings.codexArgsOverride": "Codex args override",
        // Experimental section
        "settings.experimentalTitle": "Experimental",
        "settings.experimentalDescription": "Preview features that may change or be removed.",
        "settings.experimentalWarning1":
          "Background terminal now follows the official unified_exec default unless you choose an override.",
        "settings.experimentalWarning2":
          "Desktop no longer rewrites the global CODEX_HOME/config.toml during normal settings saves.",
        "settings.configFile": "Config file",
        "settings.configFileDesc": "Open the official Codex config in {{fileManager}}.",
        "settings.openInFinder": "Open in Finder",
        "settings.openInFileManager": "Open in {{fileManager}}",
        "settings.fileManagerFinder": "Finder",
        "settings.fileManagerExplorer": "Explorer",
        "settings.fileManagerGeneric": "File Manager",
        "settings.experimentalBadgeRecommended": "Recommended",
        "settings.experimentalBadgeOfficial": "Official config",
        "settings.experimentalBadgeAvailable": "Available",
        "settings.experimentalBadgePreview": "Preview",
        "settings.collaborationModes": "Collaboration modes",
        "settings.collaborationModesDesc": "Enable collaboration mode presets (Code, Plan).",
        "settings.collaborationModesMarkerDesc":
          "This already feeds the main interaction path and is enabled by default; keep it on if you want Plan mode.",
        "settings.backgroundTerminal": "Background terminal",
        "settings.backgroundTerminalDesc":
          "Edit the official CODEX_HOME/config.toml unified_exec directly.",
        "settings.backgroundTerminalMarkerDesc":
          'Click "Enable" to write true, "Disable" to write false, and "Follow official default" to remove that explicit config line.',
        "settings.backgroundTerminalOfficialActionsDesc":
          "After each change, the app will try to refresh Codex. If no session is connected, the change applies on the next connection.",
        "settings.backgroundTerminalOptionInherit": "Follow official default",
        "settings.backgroundTerminalOptionForceEnable": "Always enable",
        "settings.backgroundTerminalOptionForceDisable": "Always disable",
        "settings.backgroundTerminalDefaultEnabled":
          "Official default on this platform: enabled.",
        "settings.backgroundTerminalDefaultDisabled":
          "Official default on this platform: disabled.",
        "settings.backgroundTerminalOfficialConfigDefault":
          "Official config status: no explicit unified_exec key; Codex will fall back to the official default or any remaining config.",
        "settings.backgroundTerminalOfficialConfigEnabled":
          "Official config status: explicit unified_exec = enabled.",
        "settings.backgroundTerminalOfficialConfigDisabled":
          "Official config status: explicit unified_exec = disabled.",
        "settings.backgroundTerminalOfficialConfigInvalid":
          "Official config status: an explicit unified_exec entry exists, but its value is invalid.",
        "settings.backgroundTerminalValueEnabled": "enabled",
        "settings.backgroundTerminalValueDisabled": "disabled",
        "settings.backgroundTerminalFollowOfficial": "Follow official default",
        "settings.backgroundTerminalOfficialWriteEnabled": "Enable",
        "settings.backgroundTerminalOfficialWriteDisabled": "Disable",
        "settings.backgroundTerminalOfficialWriteEnabledSuccess":
          "Wrote official unified_exec = enabled.",
        "settings.backgroundTerminalOfficialWriteDisabledSuccess":
          "Wrote official unified_exec = disabled.",
        "settings.backgroundTerminalFollowOfficialSuccess":
          "Restored the official unified_exec config.",
        "settings.backgroundTerminalOfficialWriteReloadFailed":
          "Official unified_exec was written, but refreshing the current Codex runtime failed: {{message}}",
        "settings.codexRuntimeReloadNoConnectedSessions":
          "No Codex session is currently connected. The config has been updated and will apply on the next connection.",
        "settings.steerMode": "Follow-up fusion",
        "settings.steerModeDesc":
          "When enabled: keep asking follow-ups while a response is streaming, queue them automatically, and fuse them into the current answer when available.",
        "settings.steerModeMarkerDesc":
          "This is already wired into same-run continuation, queued send, and queue fusion. Turn it on if you often keep asking follow-ups while an answer is still streaming.",
        "chat.contextDualViewLabel": "Dual",
        "chat.contextDualViewTotalTokens": "Total {{tokens}}",
        "chat.contextDualViewEmpty": "No context usage yet",
        "chat.contextDualViewCompacting": "Compacting context...",
        "chat.contextDualViewCompacted": "Context compacted",
        "chat.contextDualViewAriaLabel": "Dual context view status: {{state}}",
        "composer.collaborationCode": "Code",
        "composer.collaborationPlan": "Plan",
        "composer.collaborationModeDisabledHint":
          "Enable collaboration modes in Settings > Experimental",
        "composer.collaborationPlanHint":
          "Plan mode enables interactive questions. It is different from the update_plan checklist tool.",
        "composer.collaborationCodeInlineHint":
          "{{mode}} · directly implement code changes",
        "approval.showSecret": "Show",
        "approval.hideSecret": "Hide",
        "approval.submitFailed": "Submit failed. Please retry.",
        "settings.mcpPanel.title": "MCP Servers",
        "settings.mcpPanel.description":
          "Inspect MCP readiness, runtime inventory, and effective rules for each engine.",
        "settings.mcpPanel.workspaceRequired":
          "Add and open at least one workspace to query MCP status.",
        "settings.mcpPanel.serverCount": "{{count}} servers · {{toolCount}} tools",
        "settings.mcpPanel.refresh": "Refresh",
        "settings.mcpPanel.enabled": "Enabled",
        "settings.mcpPanel.disabled": "Disabled",
        "settings.mcpPanel.overviewActiveEngine": "Selected engine",
        "settings.mcpPanel.overviewDetectedEngines": "Detected engines",
        "settings.mcpPanel.detectedEnginesValue": "{{installed}} / {{total}} installed",
        "settings.mcpPanel.overviewDetectedDesc":
          "Shows which clients can currently provide MCP-related context.",
        "settings.mcpPanel.overviewLiveInventory": "Live inventory",
        "settings.mcpPanel.overviewInventoryDesc":
          "Runtime inventory follows the selected engine when supported.",
        "settings.mcpPanel.enginesTitle": "By engine",
        "settings.mcpPanel.enginesDesc":
          "Each engine has a different source of truth and refresh rule.",
        "settings.mcpPanel.engineSelectLabel": "Select engine to inspect",
        "settings.mcpPanel.detailsTitle": "Detailed status and rules",
        "settings.mcpPanel.detailsDesc":
          "Read configuration entry points, runtime availability, and visible MCP servers.",
        "settings.mcpPanel.engineClaude": "Claude Code",
        "settings.mcpPanel.engineCodex": "Codex",
        "settings.mcpPanel.engineGemini": "Gemini",
        "settings.mcpPanel.engineOpenCode": "OpenCode",
        "workspace.engineStatusLoading": "Checking...",
        "workspace.engineStatusRequiresLogin": "Sign in required",
        "settings.mcpPanel.engineStatusActive": "Active",
        "settings.mcpPanel.engineStatusInstalled": "Installed",
        "settings.mcpPanel.engineStatusUnavailable": "Unavailable",
        "settings.mcpPanel.detailVersion": "Version",
        "settings.mcpPanel.detailBinary": "Binary path",
        "settings.mcpPanel.detailMode": "Display mode",
        "settings.mcpPanel.detailConfigPaths": "Config entry points",
        "settings.mcpPanel.detailRuntimeStatus": "Runtime visibility",
        "settings.mcpPanel.detailWorkspace": "Workspace",
        "settings.mcpPanel.detailError": "Detection note",
        "settings.mcpPanel.valueUnknown": "Unknown",
        "settings.mcpPanel.valueUnavailable": "Unavailable",
        "settings.mcpPanel.rulesTitle": "Runtime rules",
        "settings.mcpPanel.environmentTitle": "Environment details",
        "settings.mcpPanel.configServersTitle": "Config-defined servers",
        "settings.mcpPanel.runtimeServersTitle": "Runtime servers",
        "settings.mcpPanel.sessionOverviewTitle": "Session overview",
        "settings.mcpPanel.noConfigServers":
          "No servers were discovered from the known config source.",
        "settings.mcpPanel.noRuntimeServers": "No runtime servers were reported.",
        "settings.mcpPanel.noOpenCodeSnapshot":
          "OpenCode runtime snapshot is not available in the current context.",
        "settings.mcpPanel.detectEmptyTitle": "No engine data returned",
        "settings.mcpPanel.detectEmptyDesc":
          "Refresh after the engine runtime is ready, or verify the local daemon/web-service connection.",
        "settings.mcpPanel.ruleModeLabel": "Mode",
        "settings.mcpPanel.ruleScopeLabel": "Scope",
        "settings.mcpPanel.ruleSourceLabel": "Source",
        "settings.mcpPanel.ruleRefreshLabel": "Refresh",
        "settings.mcpPanel.ruleRuntimeLabel": "Visible inventory",
        "settings.mcpPanel.ruleModeConfigOnly": "Config-driven",
        "settings.mcpPanel.ruleModeRuntimeRead": "Runtime inventory",
        "settings.mcpPanel.ruleModeSessionRead": "Session inventory",
        "settings.mcpPanel.ruleScopeClaude":
          "User-level config. Shared across Claude sessions on this machine.",
        "settings.mcpPanel.ruleScopeCodex":
          "Global config plus workspace runtime inspection.",
        "settings.mcpPanel.ruleScopeGemini":
          "Client config. Effective behavior depends on Gemini-side runtime loading.",
        "settings.mcpPanel.ruleScopeOpenCode": "Current workspace session only.",
        "settings.mcpPanel.ruleSourceClaude":
          "~/.claude.json and Claude settings files.",
        "settings.mcpPanel.ruleSourceCodex":
          "~/.ccgui/config.json, ~/.codex/config.toml, and workspace runtime status.",
        "settings.mcpPanel.ruleSourceGemini":
          "~/.gemini/settings.json and compatible bridge config.",
        "settings.mcpPanel.ruleSourceOpenCode":
          "OpenCode workspace runtime snapshot.",
        "settings.mcpPanel.ruleRefreshConfig":
          "Refresh this page after editing config files or restarting the client.",
        "settings.mcpPanel.ruleRefreshRuntime":
          "Use Refresh to re-read the latest runtime snapshot.",
        "settings.mcpPanel.ruleRuntimeConfigOnly":
          "This page shows config entry points, not per-server runtime inventory.",
        "settings.mcpPanel.ruleRuntimeCodex":
          "Config-defined servers plus workspace runtime-reported tools and auth state.",
        "settings.mcpPanel.ruleRuntimeOpenCode":
          "Session-level global state and per-server enabled status are shown read-only.",
        "settings.mcpPanel.runtimeStatusOpenCodeReady":
          "Workspace selected. Session snapshot can be queried.",
        "settings.mcpPanel.runtimeStatusWorkspaceRequired":
          "Select a workspace to query runtime state.",
        "settings.mcpPanel.runtimeStatusCodexReady":
          "Workspace selected. Runtime inventory can be queried.",
        "settings.mcpPanel.runtimeStatusWorkspaceOptional":
          "Global config is visible. Workspace runtime inventory needs a workspace.",
        "settings.mcpPanel.runtimeStatusConfigOnly": "Config entry points only.",
        "settings.mcpPanel.sourceClaude": "Source: ~/.claude.json",
        "settings.mcpPanel.sourceCcgui": "Source: ~/.ccgui/config.json",
        "settings.mcpPanel.commandMeta": "{{command}} · args {{args}}",
        "settings.mcpPanel.urlMeta": "URL: {{url}}",
        "settings.mcpPanel.transportUnknown": "unknown transport",
        "settings.mcpPanel.pathWorkspaceSession": "Current workspace session",
        "settings.mcpPanel.pathRuntimeInjection": "OpenCode runtime injection",
        "settings.mcpPanel.globalToggle": "Global toggle",
        "settings.mcpPanel.globalToggleDesc":
          "When disabled, OpenCode will stop injecting MCP tools.",
        "settings.mcpPanel.noServers": "No MCP servers configured.",
        "settings.mcpPanel.statusUnknown": "status unknown",
        "settings.mcpPanel.authUnknown": "auth unknown",
        "settings.mcpPanel.resourcesTemplates":
          "resources {{resources}} / templates {{templates}}",
        "settings.mcpPanel.noTools": "No tools",
        "tools.userInputRequest": "Ask User Question",
        "tools.planQuickView": "Plan",
        "tools.openFullPlanPanel": "Open full Plan panel",
        "statusPanel.tabLatestUserMessage": "User Conversation",
        "statusPanel.emptyLatestUserMessage": "No user conversation",
        "statusPanel.latestUserMessageImages": "Images: {{count}}",
        "statusPanel.expandLatestUserMessage": "Expand",
        "statusPanel.collapseLatestUserMessage": "Collapse",
        "statusPanel.jumpToConversationMessage": "Jump to message",
        "statusPanel.userConversationSequence": "Newest to oldest {{index}}",
        "statusPanel.tabPlan": "Plan",
        "statusPanel.emptyPlan": "No plan",
        "statusPanel.planGenerating": "Generating plan...",
        "statusPanel.planSwitchHint": "Switch to Plan mode to view plan",
        // Error messages
        "settings.unableToOpenConfig": "Unable to open config.",
        // Thread error messages
        "threads.sessionStopped": "会话已停止。",
        "threads.sessionStoppedForFusion": "正在切换到融合回复，等待新的接续事件…",
        "threads.turnFailed": "会话失败。",
        "threads.turnFailedWithMessage": "会话失败：{{message}}",
        "threads.turnFailedToStart": "会话启动失败。",
        "threads.turnFailedToStartWithMessage": "会话启动失败：{{message}}",
        "threads.fusionTurnStalled": "融合回复未能接上，当前线程已回到可继续操作的状态。",
        "threads.fusionTurnStalledWithMessage": "融合回复未能接上：{{message}}",
        "threads.untitledThread": "未命名对话",
        "messages.middleStepsCollapsedHint": "已折叠 {{count}} 条中间步骤（实时中）",
        "workspace.homeHeroTitle": "构建任何东西",
        "workspace.homeBranchLabelMain": "主分支",
        "workspace.homeBranchLabelWorktree": "工作树",
      };
      // Simple interpolation for test environment
      let template = translations[key] ?? key;
      if (params && typeof template === "string") {
        Object.entries(params).forEach(([paramKey, value]) => {
          template = template.replace(new RegExp(`{{${paramKey}}}`, "g"), value);
        });
      }
      return template;
    },
    i18n: {
      language: "en",
      changeLanguage: vi.fn(),
    },
  }),
}));

if (!("IS_REACT_ACT_ENVIRONMENT" in globalThis)) {
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    value: true,
    writable: true,
  });
} else {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
}

if (!("matchMedia" in globalThis)) {
  Object.defineProperty(globalThis, "matchMedia", {
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    }),
  });
}

if (!("ResizeObserver" in globalThis)) {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(globalThis, "ResizeObserver", { value: ResizeObserverMock });
}

if (!("IntersectionObserver" in globalThis)) {
  class IntersectionObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  Object.defineProperty(globalThis, "IntersectionObserver", {
    value: IntersectionObserverMock,
  });
}

if (!("requestAnimationFrame" in globalThis)) {
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    value: (callback: FrameRequestCallback) =>
      setTimeout(() => callback(Date.now()), 0),
  });
  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    value: (id: number) => clearTimeout(id),
  });
}

const localStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const existingLocalStorage =
  localStorageDescriptor && "value" in localStorageDescriptor
    ? localStorageDescriptor.value
    : null;

if (!existingLocalStorage || typeof (existingLocalStorage as Storage).clear !== "function") {
  const store = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => (store.has(key) ? store.get(key) ?? null : null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: localStorage,
    writable: true,
    configurable: true,
  });
}

// Mock Tauri APIs
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://localhost/${path}`,
  invoke: vi.fn(() => Promise.resolve(null)),
}));

// Mock client storage to use in-memory cache without Tauri backend
vi.mock("../services/clientStorage", () => {
  const cache: Record<string, Record<string, unknown>> = {};
  return {
    preloadClientStores: vi.fn(() => Promise.resolve()),
    isPreloaded: vi.fn(() => true),
    getClientStoreSync: vi.fn((store: string, key: string) => {
      return cache[store]?.[key];
    }),
    getClientStoreFullSync: vi.fn((store: string) => {
      return cache[store];
    }),
    writeClientStoreValue: vi.fn((store: string, key: string, value: unknown) => {
      if (!cache[store]) cache[store] = {};
      cache[store][key] = value;
    }),
    writeClientStoreData: vi.fn((store: string, data: Record<string, unknown>) => {
      cache[store] = data;
    }),
  };
});

vi.mock("../services/dragDrop", () => ({
  subscribeWindowDragDrop: vi.fn(() => () => {}),
}));
