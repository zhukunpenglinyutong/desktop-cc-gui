// @ts-nocheck
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ask, open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { DropResult } from "@hello-pangea/dnd";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronUp from "lucide-react/dist/esm/icons/chevron-up";
import LayoutGrid from "lucide-react/dist/esm/icons/layout-grid";
import Mic from "lucide-react/dist/esm/icons/mic";
import Keyboard from "lucide-react/dist/esm/icons/keyboard";
import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left";
import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import TerminalSquare from "lucide-react/dist/esm/icons/terminal-square";
import FileText from "lucide-react/dist/esm/icons/file-text";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import FlaskConical from "lucide-react/dist/esm/icons/flask-conical";
import ExternalLink from "lucide-react/dist/esm/icons/external-link";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  FolderOpen,
  Monitor,
  Sun,
  Moon,
  Palette,
  Cog,
  Type,
  MessageCircle,
  RotateCcw,
  Info,
  Check,
  Wifi,
  Save,
} from "lucide-react";
import type {
  AppSettings,
  CodexDoctorResult,
  DictationModelStatus,
  WorkspaceSettings,
  OpenAppTarget,
  ThreadSummary,
  WorkspaceGroup,
  WorkspaceInfo,
} from "../../../types";
import { formatDownloadSize } from "../../../utils/formatting";
import {
  buildShortcutValue,
  getDefaultInterruptShortcut,
} from "../../../utils/shortcuts";
import { clampUiScale } from "../../../utils/uiScale";
import {
  getCodexConfigPath,
} from "../../../services/tauri";
import {
  DEFAULT_CODE_FONT_FAMILY,
  DEFAULT_UI_FONT_FAMILY,
  CODE_FONT_SIZE_DEFAULT,
  CODE_FONT_SIZE_MAX,
  CODE_FONT_SIZE_MIN,
  clampCodeFontSize,
  normalizeFontFamily,
} from "../../../utils/fonts";
import { DEFAULT_OPEN_APP_ID } from "../../app/constants";
import { writeClientStoreValue } from "../../../services/clientStorage";
import { VendorSettingsPanel } from "../../vendors/components/VendorSettingsPanel";
import { useGlobalAgentsMd } from "../hooks/useGlobalAgentsMd";
import { useGlobalCodexConfigToml } from "../hooks/useGlobalCodexConfigToml";
import { LanguageSelector } from "./LanguageSelector";
import { HistoryCompletionSettings } from "./HistoryCompletionSettings";
import { AgentSettingsSection } from "./AgentSettingsSection";
import { PlaceholderSection } from "./PlaceholderSection";
import { CommitSection } from "./CommitSection";
import { PromptSection } from "./PromptSection";
import { ProxyStatusBadge } from "../../../components/ProxyStatusBadge";
import { UsageSection } from "./UsageSection";
import { McpSection } from "./McpSection";
import { SkillsSection } from "./SkillsSection";
import {
  ProjectSessionManagementSection,
  type ProjectSessionDeleteResult,
} from "./ProjectSessionManagementSection";
import { SessionRadarHistoryManagementSection } from "./SessionRadarHistoryManagementSection";
import type { SessionRadarEntry } from "../../session-activity/hooks/useSessionRadarFeed";
import {
  deleteSessionRadarHistoryEntries,
  type SessionRadarHistoryDeleteResult,
} from "../../session-activity/utils/sessionRadarHistoryManagement";
import Settings from "lucide-react/dist/esm/icons/settings";
import GitCommitHorizontal from "lucide-react/dist/esm/icons/git-commit-horizontal";
import BookOpen from "lucide-react/dist/esm/icons/book-open";
import Server from "lucide-react/dist/esm/icons/server";
import Shield from "lucide-react/dist/esm/icons/shield";
import BarChart3 from "lucide-react/dist/esm/icons/bar-chart-3";
import MoreHorizontalIcon from "lucide-react/dist/esm/icons/more-horizontal";
import NotebookPen from "lucide-react/dist/esm/icons/notebook-pen";
import Users from "lucide-react/dist/esm/icons/users";
import { pushErrorToast } from "../../../services/toasts";
import {
  isHistoryCompletionEnabled,
  setHistoryCompletionEnabled,
} from "../../composer/hooks/useInputHistoryStore";
import {
  buildOpenAppDrafts,
  buildWorkspaceOverrideDrafts,
  COMPOSER_PRESET_CONFIGS,
  createOpenAppId,
  type ComposerPreset,
  type OpenAppDraft,
} from "./settings-view/actions/settingsViewActions";
import { useSystemResolvedTheme } from "./settings-view/hooks/useSystemResolvedTheme";
import { ProjectsSection } from "./settings-view/sections/ProjectsSection";
import { ComposerSection } from "./settings-view/sections/ComposerSection";
import { ShortcutsSection } from "./settings-view/sections/ShortcutsSection";
import { OpenAppsSection } from "./settings-view/sections/OpenAppsSection";
import { CodexSection } from "./settings-view/sections/CodexSection";

// Feature flags to show/hide settings sidebar entries
const SHOW_DICTATION_ENTRY = false;
const SHOW_GIT_ENTRY = false;
const SHOW_CODEX_ENTRY = false;
const SHOW_EXPERIMENTAL_ENTRY = false;
const SHOW_COMMIT_ENTRY = false;
const SHOW_COMPOSER_ENTRY = false;
const SHOW_SHORTCUTS_ENTRY = false;

const DICTATION_MODELS = (t: (key: string) => string) => [
  { id: "tiny", label: t("settings.dictationModelTiny"), size: "75 MB", note: t("settings.dictationModelFastest") },
  { id: "base", label: t("settings.dictationModelBase"), size: "142 MB", note: t("settings.dictationModelBalanced") },
  { id: "small", label: t("settings.dictationModelSmall"), size: "466 MB", note: t("settings.dictationModelBetter") },
  { id: "medium", label: t("settings.dictationModelMedium"), size: "1.5 GB", note: t("settings.dictationModelHigh") },
  { id: "large-v3", label: t("settings.dictationModelLargeV3"), size: "3.0 GB", note: t("settings.dictationModelBest") },
];

type InlineNoticeState =
  | {
      kind: "success" | "error";
      message: string;
    }
  | null;

export type SettingsViewProps = {
  workspaceGroups: WorkspaceGroup[];
  groupedWorkspaces: Array<{
    id: string | null;
    name: string;
    workspaces: WorkspaceInfo[];
  }>;
  allWorkspaces?: WorkspaceInfo[];
  ungroupedLabel: string;
  onClose: () => void;
  onMoveWorkspace: (id: string, direction: "up" | "down") => void;
  onDeleteWorkspace: (id: string) => void;
  onCreateWorkspaceGroup: (name: string) => Promise<WorkspaceGroup | null>;
  onRenameWorkspaceGroup: (id: string, name: string) => Promise<boolean | null>;
  onMoveWorkspaceGroup: (id: string, direction: "up" | "down") => Promise<boolean | null>;
  onDeleteWorkspaceGroup: (id: string) => Promise<boolean | null>;
  onAssignWorkspaceGroup: (
    workspaceId: string,
    groupId: string | null,
  ) => Promise<boolean | null>;
  reduceTransparency: boolean;
  onToggleTransparency: (value: boolean) => void;
  appSettings: AppSettings;
  openAppIconById: Record<string, string>;
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
  onRunDoctor: (
    codexBin: string | null,
    codexArgs: string | null,
  ) => Promise<CodexDoctorResult>;
  activeWorkspace: WorkspaceInfo | null;
  activeEngine: string | null;
  onUpdateWorkspaceCodexBin: (id: string, codexBin: string | null) => Promise<void>;
  onUpdateWorkspaceSettings: (
    id: string,
    settings: Partial<WorkspaceSettings>,
  ) => Promise<void>;
  workspaceThreadsById?: Record<string, ThreadSummary[]>;
  workspaceThreadListLoadingById?: Record<string, boolean>;
  sessionRadarRecentCompletedSessions?: SessionRadarEntry[];
  onEnsureWorkspaceThreads?: (workspaceId: string) => void;
  onDeleteWorkspaceThreads?: (
    workspaceId: string,
    threadIds: string[],
  ) => Promise<ProjectSessionDeleteResult>;
  scaleShortcutTitle: string;
  scaleShortcutText: string;
  onTestNotificationSound: (soundId?: string, customSoundPath?: string) => void;
  dictationModelStatus?: DictationModelStatus | null;
  onDownloadDictationModel?: () => void;
  onCancelDictationDownload?: () => void;
  onRemoveDictationModel?: () => void;
  initialSection?: CodexSection;
  initialHighlightTarget?: "experimental-collaboration-modes";
};

type SettingsSection =
  | "basic"
  | "providers"
  | "projects"
  | "usage"
  | "mcp"
  | "permissions"
  | "commit"
  | "agents"
  | "prompts"
  | "skills"
  | "composer"
  | "dictation"
  | "shortcuts"
  | "open-apps"
  | "git"
  | "other"
  | "community"
  | "vendors";
type CodexSection = SettingsSection | "codex" | "experimental" | "about";

const TEMPORARILY_DISABLED_SIDEBAR_SECTIONS: ReadonlySet<CodexSection> = new Set([
  "mcp",
  "permissions",
  "prompts",
  "skills",
]);

type ShortcutSettingKey =
  | "composerModelShortcut"
  | "composerAccessShortcut"
  | "composerReasoningShortcut"
  | "composerCollaborationShortcut"
  | "interruptShortcut"
  | "newAgentShortcut"
  | "newWorktreeAgentShortcut"
  | "newCloneAgentShortcut"
  | "archiveThreadShortcut"
  | "toggleProjectsSidebarShortcut"
  | "toggleGitSidebarShortcut"
  | "toggleGlobalSearchShortcut"
  | "toggleDebugPanelShortcut"
  | "toggleTerminalShortcut"
  | "cycleAgentNextShortcut"
  | "cycleAgentPrevShortcut"
  | "cycleWorkspaceNextShortcut"
  | "cycleWorkspacePrevShortcut";
type ShortcutDraftKey =
  | "model"
  | "access"
  | "reasoning"
  | "collaboration"
  | "interrupt"
  | "newAgent"
  | "newWorktreeAgent"
  | "newCloneAgent"
  | "archiveThread"
  | "projectsSidebar"
  | "gitSidebar"
  | "globalSearch"
  | "debugPanel"
  | "terminal"
  | "cycleAgentNext"
  | "cycleAgentPrev"
  | "cycleWorkspaceNext"
  | "cycleWorkspacePrev";

const shortcutDraftKeyBySetting: Record<ShortcutSettingKey, ShortcutDraftKey> = {
  composerModelShortcut: "model",
  composerAccessShortcut: "access",
  composerReasoningShortcut: "reasoning",
  composerCollaborationShortcut: "collaboration",
  interruptShortcut: "interrupt",
  newAgentShortcut: "newAgent",
  newWorktreeAgentShortcut: "newWorktreeAgent",
  newCloneAgentShortcut: "newCloneAgent",
  archiveThreadShortcut: "archiveThread",
  toggleProjectsSidebarShortcut: "projectsSidebar",
  toggleGitSidebarShortcut: "gitSidebar",
  toggleGlobalSearchShortcut: "globalSearch",
  toggleDebugPanelShortcut: "debugPanel",
  toggleTerminalShortcut: "terminal",
  cycleAgentNextShortcut: "cycleAgentNext",
  cycleAgentPrevShortcut: "cycleAgentPrev",
  cycleWorkspaceNextShortcut: "cycleWorkspaceNext",
  cycleWorkspacePrevShortcut: "cycleWorkspacePrev",
};

const USER_MSG_DARK_PRESETS = [
  { color: "#005fb8", label: "Default" },
  { color: "#1a7f37", label: "Green" },
  { color: "#6e40c9", label: "Purple" },
  { color: "#9a6700", label: "Amber" },
  { color: "#cf222e", label: "Red" },
  { color: "#0e6b8a", label: "Teal" },
  { color: "#6b4c9a", label: "Violet" },
  { color: "#4a5568", label: "Gray" },
] as const;

const USER_MSG_LIGHT_PRESETS = [
  { color: "#0078d4", label: "Default" },
  { color: "#1a7f37", label: "Green" },
  { color: "#8250df", label: "Purple" },
  { color: "#bf8700", label: "Amber" },
  { color: "#cf222e", label: "Red" },
  { color: "#0e8a9a", label: "Teal" },
  { color: "#7c5cbf", label: "Violet" },
  { color: "#57606a", label: "Gray" },
] as const;

import { normalizeHexColor, HEX_COLOR_PATTERN } from "../../../utils/colorUtils";

const DEFAULT_DARK_USER_MSG = "#005fb8";
const DEFAULT_LIGHT_USER_MSG = "#0078d4";
const BASIC_FONT_SIZE_LEVELS = [
  { value: 0.8, labelKey: "settings.fontSizeLevel1" },
  { value: 0.9, labelKey: "settings.fontSizeLevel2" },
  { value: 1, labelKey: "settings.fontSizeLevel3" },
  { value: 1.1, labelKey: "settings.fontSizeLevel4" },
  { value: 1.2, labelKey: "settings.fontSizeLevel5" },
  { value: 1.4, labelKey: "settings.fontSizeLevel6" },
] as const;
const BASIC_FONT_SIZE_LEVEL_SET = new Set(
  BASIC_FONT_SIZE_LEVELS.map((level) => Number(level.value.toFixed(2))),
);

export function SettingsView({
  workspaceGroups,
  groupedWorkspaces,
  allWorkspaces,
  ungroupedLabel,
  onClose,
  onMoveWorkspace,
  onDeleteWorkspace,
  onCreateWorkspaceGroup,
  onRenameWorkspaceGroup,
  onMoveWorkspaceGroup: _onMoveWorkspaceGroup,
  onDeleteWorkspaceGroup,
  onAssignWorkspaceGroup,
  reduceTransparency,
  onToggleTransparency: _onToggleTransparency,
  appSettings,
  openAppIconById,
  onUpdateAppSettings,
  onRunDoctor,
  activeWorkspace,
  activeEngine,
  onUpdateWorkspaceCodexBin,
  onUpdateWorkspaceSettings,
  workspaceThreadsById = {},
  workspaceThreadListLoadingById = {},
  sessionRadarRecentCompletedSessions = [],
  onEnsureWorkspaceThreads,
  onDeleteWorkspaceThreads,
  scaleShortcutTitle,
  scaleShortcutText,
  onTestNotificationSound,
  dictationModelStatus,
  onDownloadDictationModel,
  onCancelDictationDownload,
  onRemoveDictationModel,
  initialSection,
  initialHighlightTarget,
}: SettingsViewProps) {
  const { t } = useTranslation();
  const [activeSection, setActiveSection] = useState<CodexSection>("basic");
  const [basicSubTab, setBasicSubTab] = useState<"appearance" | "behavior">("appearance");
  const [commitPrompt, setCommitPrompt] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [codexPathDraft, setCodexPathDraft] = useState(appSettings.codexBin ?? "");
  const [codexArgsDraft, setCodexArgsDraft] = useState(appSettings.codexArgs ?? "");
  const [remoteHostDraft, setRemoteHostDraft] = useState(appSettings.remoteBackendHost);
  const [remoteTokenDraft, setRemoteTokenDraft] = useState(appSettings.remoteBackendToken ?? "");
  const [uiFontDraft, setUiFontDraft] = useState(appSettings.uiFontFamily);
  const [codeFontDraft, setCodeFontDraft] = useState(appSettings.codeFontFamily);
  const [codeFontSizeDraft, setCodeFontSizeDraft] = useState(appSettings.codeFontSize);
  const [userMsgHexDraft, setUserMsgHexDraft] = useState(() =>
    normalizeHexColor(appSettings.userMsgColor),
  );
  const [notificationSoundPathDraft, setNotificationSoundPathDraft] = useState(
    appSettings.notificationSoundCustomPath ?? "",
  );
  const systemResolvedTheme = useSystemResolvedTheme();
  const [codexBinOverrideDrafts, setCodexBinOverrideDrafts] = useState<
    Record<string, string>
  >({});
  const [codexHomeOverrideDrafts, setCodexHomeOverrideDrafts] = useState<
    Record<string, string>
  >({});
  const [codexArgsOverrideDrafts, setCodexArgsOverrideDrafts] = useState<
    Record<string, string>
  >({});
  const [groupDrafts, setGroupDrafts] = useState<Record<string, string>>({});
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [highlightedRow, setHighlightedRow] = useState<string | null>(null);
  const [openAppDrafts, setOpenAppDrafts] = useState<OpenAppDraft[]>(() =>
    buildOpenAppDrafts(appSettings.openAppTargets),
  );
  const [openAppSelectedId, setOpenAppSelectedId] = useState(
    appSettings.selectedOpenAppId,
  );
  const [historyCompletionEnabled, setHistoryCompletionEnabledState] = useState(
    () => isHistoryCompletionEnabled(),
  );
  const [systemProxyEnabledDraft, setSystemProxyEnabledDraft] = useState(
    appSettings.systemProxyEnabled ?? false,
  );
  const [systemProxyUrlDraft, setSystemProxyUrlDraft] = useState(
    appSettings.systemProxyUrl ?? "",
  );
  const [systemProxyError, setSystemProxyError] = useState<string | null>(null);
  const [systemProxyNotice, setSystemProxyNotice] = useState<InlineNoticeState>(null);
  const [systemProxySaving, setSystemProxySaving] = useState(false);
  const handleHistoryCompletionToggle = useCallback(() => {
    const next = !historyCompletionEnabled;
    setHistoryCompletionEnabledState(next);
    setHistoryCompletionEnabled(next);
  }, [historyCompletionEnabled]);
  const [doctorState, setDoctorState] = useState<{
    status: "idle" | "running" | "done";
    result: CodexDoctorResult | null;
  }>({ status: "idle", result: null });
  const {
    content: globalAgentsContent,
    exists: globalAgentsExists,
    truncated: globalAgentsTruncated,
    isLoading: globalAgentsLoading,
    isSaving: globalAgentsSaving,
    error: globalAgentsError,
    isDirty: globalAgentsDirty,
    setContent: setGlobalAgentsContent,
    refresh: refreshGlobalAgents,
    save: saveGlobalAgents,
  } = useGlobalAgentsMd();
  const {
    content: globalConfigContent,
    exists: globalConfigExists,
    truncated: globalConfigTruncated,
    isLoading: globalConfigLoading,
    isSaving: globalConfigSaving,
    error: globalConfigError,
    isDirty: globalConfigDirty,
    setContent: setGlobalConfigContent,
    refresh: refreshGlobalConfig,
    save: saveGlobalConfig,
  } = useGlobalCodexConfigToml();
  const [openConfigError, setOpenConfigError] = useState<string | null>(null);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [shortcutDrafts, setShortcutDrafts] = useState({
    model: appSettings.composerModelShortcut ?? "",
    access: appSettings.composerAccessShortcut ?? "",
    reasoning: appSettings.composerReasoningShortcut ?? "",
    collaboration: appSettings.composerCollaborationShortcut ?? "",
    interrupt: appSettings.interruptShortcut ?? "",
    newAgent: appSettings.newAgentShortcut ?? "",
    newWorktreeAgent: appSettings.newWorktreeAgentShortcut ?? "",
    newCloneAgent: appSettings.newCloneAgentShortcut ?? "",
    archiveThread: appSettings.archiveThreadShortcut ?? "",
    projectsSidebar: appSettings.toggleProjectsSidebarShortcut ?? "",
    gitSidebar: appSettings.toggleGitSidebarShortcut ?? "",
    globalSearch: appSettings.toggleGlobalSearchShortcut ?? "",
    debugPanel: appSettings.toggleDebugPanelShortcut ?? "",
    terminal: appSettings.toggleTerminalShortcut ?? "",
    cycleAgentNext: appSettings.cycleAgentNextShortcut ?? "",
    cycleAgentPrev: appSettings.cycleAgentPrevShortcut ?? "",
    cycleWorkspaceNext: appSettings.cycleWorkspaceNextShortcut ?? "",
    cycleWorkspacePrev: appSettings.cycleWorkspacePrevShortcut ?? "",
  });
  const normalizedUserMsgColor = useMemo(
    () => normalizeHexColor(appSettings.userMsgColor),
    [appSettings.userMsgColor],
  );
  const resolvedAppearanceTheme = useMemo<"light" | "dark">(() => {
    if (appSettings.theme === "light") {
      return "light";
    }
    if (appSettings.theme === "system") {
      return systemResolvedTheme;
    }
    return "dark";
  }, [appSettings.theme, systemResolvedTheme]);
  const userMsgPresets = useMemo(
    () =>
      resolvedAppearanceTheme === "light"
        ? USER_MSG_LIGHT_PRESETS
        : USER_MSG_DARK_PRESETS,
    [resolvedAppearanceTheme],
  );
  const defaultUserMsgColor =
    resolvedAppearanceTheme === "light"
      ? DEFAULT_LIGHT_USER_MSG
      : DEFAULT_DARK_USER_MSG;
  const selectedNotificationSound = useMemo(() => {
    const raw = appSettings.notificationSoundId?.trim();
    if (!raw) {
      return "default";
    }
    if (
      raw === "default" ||
      raw === "chime" ||
      raw === "bell" ||
      raw === "ding" ||
      raw === "success" ||
      raw === "custom"
    ) {
      return raw;
    }
    return "default";
  }, [appSettings.notificationSoundId]);
  const soundOptions = useMemo(
    () => [
      { value: "default", label: t("settings.soundOptionDefault") },
      { value: "chime", label: t("settings.soundOptionChime") },
      { value: "bell", label: t("settings.soundOptionBell") },
      { value: "ding", label: t("settings.soundOptionDing") },
      { value: "success", label: t("settings.soundOptionSuccess") },
      { value: "custom", label: t("settings.soundOptionCustom") },
    ],
    [t],
  );
  const clampedUiScale = clampUiScale(appSettings.uiScale);
  const uiScalePercentLabel = `${Math.round(clampedUiScale * 100)}%`;
  const uiScaleSelectValue = useMemo(() => {
    const normalizedScale = Number(clampedUiScale.toFixed(2));
    return BASIC_FONT_SIZE_LEVEL_SET.has(normalizedScale)
      ? String(normalizedScale)
      : "custom";
  }, [clampedUiScale]);
  const dictationReady = dictationModelStatus?.state === "ready";
  const dictationProgress = dictationModelStatus?.progress ?? null;
  const globalAgentsStatus = globalAgentsLoading
    ? t("settings.loading")
    : globalAgentsSaving
      ? t("settings.saving")
      : globalAgentsExists
        ? ""
        : t("settings.notFound");
  const globalAgentsMetaParts: string[] = [];
  if (globalAgentsStatus) {
    globalAgentsMetaParts.push(globalAgentsStatus);
  }
  if (globalAgentsTruncated) {
    globalAgentsMetaParts.push(t("settings.truncated"));
  }
  const globalAgentsMeta = globalAgentsMetaParts.join(" · ");
  const globalAgentsSaveLabel = globalAgentsExists ? t("common.save") : t("common.create");
  const globalAgentsSaveDisabled = globalAgentsLoading || globalAgentsSaving || !globalAgentsDirty;
  const globalAgentsRefreshDisabled = globalAgentsLoading || globalAgentsSaving;
  const globalConfigStatus = globalConfigLoading
    ? t("settings.loading")
    : globalConfigSaving
      ? t("settings.saving")
      : globalConfigExists
        ? ""
        : t("settings.notFound");
  const globalConfigMetaParts: string[] = [];
  if (globalConfigStatus) {
    globalConfigMetaParts.push(globalConfigStatus);
  }
  if (globalConfigTruncated) {
    globalConfigMetaParts.push(t("settings.truncated"));
  }
  const globalConfigMeta = globalConfigMetaParts.join(" · ");
  const globalConfigSaveLabel = globalConfigExists ? t("common.save") : t("common.create");
  const globalConfigSaveDisabled = globalConfigLoading || globalConfigSaving || !globalConfigDirty;
  const globalConfigRefreshDisabled = globalConfigLoading || globalConfigSaving;
  const selectedDictationModel = useMemo(() => {
    const models = DICTATION_MODELS(t);
    return (
      models.find(
        (model) => model.id === appSettings.dictationModelId,
      ) ?? models[1]
    );
  }, [appSettings.dictationModelId, t]);

  const projects = useMemo(
    () => groupedWorkspaces.flatMap((group) => group.workspaces),
    [groupedWorkspaces],
  );
  const sessionWorkspaceOptions = useMemo(
    () => (allWorkspaces && allWorkspaces.length > 0 ? allWorkspaces : projects),
    [allWorkspaces, projects],
  );
  const [settingsWorkspaceId, setSettingsWorkspaceId] = useState<string | null>(null);
  const [projectSessionWorkspaceId, setProjectSessionWorkspaceId] = useState<string | null>(null);
  const selectedSettingsWorkspace = useMemo(() => {
    if (projects.length === 0) {
      return activeWorkspace;
    }
    if (settingsWorkspaceId) {
      const matched = projects.find((workspace) => workspace.id === settingsWorkspaceId);
      if (matched) {
        return matched;
      }
    }
    return projects[0] ?? null;
  }, [activeWorkspace, projects, settingsWorkspaceId]);
  const selectedProjectSessionWorkspace = useMemo(() => {
    if (sessionWorkspaceOptions.length === 0) {
      return null;
    }
    if (projectSessionWorkspaceId) {
      const matched = sessionWorkspaceOptions.find(
        (workspace) => workspace.id === projectSessionWorkspaceId,
      );
      if (matched) {
        return matched;
      }
    }
    if (selectedSettingsWorkspace) {
      const linked = sessionWorkspaceOptions.find(
        (workspace) => workspace.id === selectedSettingsWorkspace.id,
      );
      if (linked) {
        return linked;
      }
    }
    return sessionWorkspaceOptions[0] ?? null;
  }, [projectSessionWorkspaceId, selectedSettingsWorkspace, sessionWorkspaceOptions]);
  const mcpContextWorkspace = useMemo(
    () => activeWorkspace ?? projects[0] ?? null,
    [activeWorkspace, projects],
  );
  const selectedWorkspaceThreads = useMemo(() => {
    if (!selectedProjectSessionWorkspace) {
      return [];
    }
    const raw = workspaceThreadsById[selectedProjectSessionWorkspace.id] ?? [];
    return [...raw].sort((left, right) => right.updatedAt - left.updatedAt);
  }, [selectedProjectSessionWorkspace, workspaceThreadsById]);
  const selectedWorkspaceThreadListLoading = selectedProjectSessionWorkspace
    ? (workspaceThreadListLoadingById[selectedProjectSessionWorkspace.id] ?? false)
    : false;
  const handleDeleteWorkspaceThreadsInSettings = useCallback(
    async (workspaceId: string, threadIds: string[]) => {
      if (!onDeleteWorkspaceThreads) {
        return {
          succeededThreadIds: [],
          failed: threadIds.map((threadId) => ({
            threadId,
            code: "UNAVAILABLE",
            message: t("settings.projectSessionDeleteUnavailable"),
          })),
        } satisfies ProjectSessionDeleteResult;
      }
      return onDeleteWorkspaceThreads(workspaceId, threadIds);
    },
    [onDeleteWorkspaceThreads, t],
  );
  const handleDeleteSessionRadarHistoryInSettings = useCallback(
    async (entries: SessionRadarEntry[]) => {
      const targets = entries.map((entry) => ({
        id: entry.id,
        completedAt: entry.completedAt ?? entry.updatedAt,
      }));
      return Promise.resolve(deleteSessionRadarHistoryEntries(targets));
    },
    [],
  );
  const shouldShowWorkspaceSelector =
    activeSection === "prompts" ||
    activeSection === "skills";
  const mcpSectionDisabled = TEMPORARILY_DISABLED_SIDEBAR_SECTIONS.has("mcp");
  const permissionsSectionDisabled = TEMPORARILY_DISABLED_SIDEBAR_SECTIONS.has("permissions");
  const promptsSectionDisabled = TEMPORARILY_DISABLED_SIDEBAR_SECTIONS.has("prompts");
  const skillsSectionDisabled = TEMPORARILY_DISABLED_SIDEBAR_SECTIONS.has("skills");
  const hasCodexHomeOverrides = useMemo(
    () => projects.some((workspace) => workspace.settings.codexHome != null),
    [projects],
  );

  useEffect(() => {
    let active = true;
    void getVersion().then((v) => {
      if (active) setAppVersion(v);
    }).catch(() => {
      if (active) setAppVersion(null);
    });
    return () => { active = false; };
  }, [t]);

  useEffect(() => {
    if (
      projectSessionWorkspaceId &&
      sessionWorkspaceOptions.some((workspace) => workspace.id === projectSessionWorkspaceId)
    ) {
      return;
    }
    if (
      selectedSettingsWorkspace &&
      sessionWorkspaceOptions.some((workspace) => workspace.id === selectedSettingsWorkspace.id)
    ) {
      setProjectSessionWorkspaceId(selectedSettingsWorkspace.id);
      return;
    }
    setProjectSessionWorkspaceId(sessionWorkspaceOptions[0]?.id ?? null);
  }, [
    projectSessionWorkspaceId,
    selectedSettingsWorkspace,
    sessionWorkspaceOptions,
  ]);

  useEffect(() => {
    setSystemProxyEnabledDraft(appSettings.systemProxyEnabled ?? false);
    setSystemProxyUrlDraft(appSettings.systemProxyUrl ?? "");
    setSystemProxyError(null);
  }, [appSettings.systemProxyEnabled, appSettings.systemProxyUrl]);

  useEffect(() => {
    if (!systemProxyNotice) {
      return;
    }
    const timer = window.setTimeout(() => {
      setSystemProxyNotice(null);
    }, 2600);
    return () => window.clearTimeout(timer);
  }, [systemProxyNotice]);

  const updateSystemProxySettings = useCallback(async (
    nextEnabled: boolean,
    nextProxyUrl: string,
    successMessage: string,
    rollbackDraft: {
      enabled: boolean;
      proxyUrl: string;
    },
  ) => {
    const trimmedProxyUrl = nextProxyUrl.trim();
    if (nextEnabled && !trimmedProxyUrl) {
      const message = t("settings.behaviorProxyRequired");
      setSystemProxyEnabledDraft(rollbackDraft.enabled);
      setSystemProxyUrlDraft(rollbackDraft.proxyUrl);
      setSystemProxyError(message);
      setSystemProxyNotice(null);
      return false;
    }

    setSystemProxySaving(true);
    setSystemProxyError(null);
    setSystemProxyNotice(null);
    try {
      await onUpdateAppSettings({
        ...appSettings,
        systemProxyEnabled: nextEnabled,
        systemProxyUrl: trimmedProxyUrl || null,
      });
      setSystemProxyNotice({
        kind: "success",
        message: successMessage,
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSystemProxyEnabledDraft(rollbackDraft.enabled);
      setSystemProxyUrlDraft(rollbackDraft.proxyUrl);
      setSystemProxyError(message);
      setSystemProxyNotice(null);
      pushErrorToast({
        title: t("common.error"),
        message,
      });
      return false;
    } finally {
      setSystemProxySaving(false);
    }
  }, [
    appSettings,
    onUpdateAppSettings,
    t,
  ]);

  const handleSaveSystemProxy = useCallback(async () => {
    await updateSystemProxySettings(
      systemProxyEnabledDraft,
      systemProxyUrlDraft,
      t("settings.behaviorProxySaved"),
      {
        enabled: appSettings.systemProxyEnabled ?? false,
        proxyUrl: appSettings.systemProxyUrl ?? "",
      },
    );
  }, [
    appSettings.systemProxyEnabled,
    appSettings.systemProxyUrl,
    systemProxyEnabledDraft,
    systemProxyUrlDraft,
    t,
    updateSystemProxySettings,
  ]);

  const handleToggleSystemProxy = useCallback((checked: boolean) => {
    if (systemProxySaving) {
      return;
    }
    const rollbackDraft = {
      enabled: appSettings.systemProxyEnabled ?? false,
      proxyUrl: appSettings.systemProxyUrl ?? "",
    };
    const nextProxyUrl = checked
      ? systemProxyUrlDraft
      : (systemProxyUrlDraft.trim() || rollbackDraft.proxyUrl);

    setSystemProxyEnabledDraft(checked);
    setSystemProxyError(null);
    setSystemProxyNotice(null);

    void updateSystemProxySettings(
      checked,
      nextProxyUrl,
      checked
        ? t("settings.behaviorProxyEnabledSuccess")
        : t("settings.behaviorProxyDisabledSuccess"),
      rollbackDraft,
    );
  }, [
    appSettings.systemProxyEnabled,
    appSettings.systemProxyUrl,
    systemProxySaving,
    systemProxyUrlDraft,
    t,
    updateSystemProxySettings,
  ]);

  const systemProxyDirty =
    (appSettings.systemProxyEnabled ?? false) !== systemProxyEnabledDraft ||
    (appSettings.systemProxyUrl ?? "") !== systemProxyUrlDraft;

  useEffect(() => {
    setCodexPathDraft(appSettings.codexBin ?? "");
  }, [appSettings.codexBin]);

  useEffect(() => {
    setCodexArgsDraft(appSettings.codexArgs ?? "");
  }, [appSettings.codexArgs]);

  useEffect(() => {
    setRemoteHostDraft(appSettings.remoteBackendHost);
  }, [appSettings.remoteBackendHost]);

  useEffect(() => {
    setRemoteTokenDraft(appSettings.remoteBackendToken ?? "");
  }, [appSettings.remoteBackendToken]);

  useEffect(() => {
    setUiFontDraft(appSettings.uiFontFamily);
  }, [appSettings.uiFontFamily]);

  useEffect(() => {
    setCodeFontDraft(appSettings.codeFontFamily);
  }, [appSettings.codeFontFamily]);

  useEffect(() => {
    setCodeFontSizeDraft(appSettings.codeFontSize);
  }, [appSettings.codeFontSize]);

  useEffect(() => {
    setUserMsgHexDraft(normalizedUserMsgColor);
  }, [normalizedUserMsgColor]);

  useEffect(() => {
    setNotificationSoundPathDraft(appSettings.notificationSoundCustomPath ?? "");
  }, [appSettings.notificationSoundCustomPath]);

  useEffect(() => {
    setOpenAppDrafts(buildOpenAppDrafts(appSettings.openAppTargets));
    setOpenAppSelectedId(appSettings.selectedOpenAppId);
  }, [appSettings.openAppTargets, appSettings.selectedOpenAppId]);

  useEffect(() => {
    setShortcutDrafts({
      model: appSettings.composerModelShortcut ?? "",
      access: appSettings.composerAccessShortcut ?? "",
      reasoning: appSettings.composerReasoningShortcut ?? "",
      collaboration: appSettings.composerCollaborationShortcut ?? "",
      interrupt: appSettings.interruptShortcut ?? "",
      newAgent: appSettings.newAgentShortcut ?? "",
      newWorktreeAgent: appSettings.newWorktreeAgentShortcut ?? "",
      newCloneAgent: appSettings.newCloneAgentShortcut ?? "",
      archiveThread: appSettings.archiveThreadShortcut ?? "",
      projectsSidebar: appSettings.toggleProjectsSidebarShortcut ?? "",
      gitSidebar: appSettings.toggleGitSidebarShortcut ?? "",
      globalSearch: appSettings.toggleGlobalSearchShortcut ?? "",
      debugPanel: appSettings.toggleDebugPanelShortcut ?? "",
      terminal: appSettings.toggleTerminalShortcut ?? "",
      cycleAgentNext: appSettings.cycleAgentNextShortcut ?? "",
      cycleAgentPrev: appSettings.cycleAgentPrevShortcut ?? "",
      cycleWorkspaceNext: appSettings.cycleWorkspaceNextShortcut ?? "",
      cycleWorkspacePrev: appSettings.cycleWorkspacePrevShortcut ?? "",
    });
  }, [
    appSettings.composerAccessShortcut,
    appSettings.composerModelShortcut,
    appSettings.composerReasoningShortcut,
    appSettings.composerCollaborationShortcut,
    appSettings.interruptShortcut,
    appSettings.newAgentShortcut,
    appSettings.newWorktreeAgentShortcut,
    appSettings.newCloneAgentShortcut,
    appSettings.archiveThreadShortcut,
    appSettings.toggleProjectsSidebarShortcut,
    appSettings.toggleGitSidebarShortcut,
    appSettings.toggleGlobalSearchShortcut,
    appSettings.toggleDebugPanelShortcut,
    appSettings.toggleTerminalShortcut,
    appSettings.cycleAgentNextShortcut,
    appSettings.cycleAgentPrevShortcut,
    appSettings.cycleWorkspaceNextShortcut,
    appSettings.cycleWorkspacePrevShortcut,
  ]);

  const handleOpenConfig = useCallback(async () => {
    setOpenConfigError(null);
    try {
      const configPath = await getCodexConfigPath();
      await revealItemInDir(configPath);
    } catch (error) {
      setOpenConfigError(
        error instanceof Error ? error.message : t("settings.unableToOpenConfig"),
      );
    }
  }, [t]);

  useEffect(() => {
    if (
      activeSection !== "other" ||
      !selectedProjectSessionWorkspace ||
      !onEnsureWorkspaceThreads
    ) {
      return;
    }
    onEnsureWorkspaceThreads(selectedProjectSessionWorkspace.id);
  }, [activeSection, onEnsureWorkspaceThreads, selectedProjectSessionWorkspace]);

  useEffect(() => {
    setCodexBinOverrideDrafts((prev) =>
      buildWorkspaceOverrideDrafts(
        projects,
        prev,
        (workspace) => workspace.codex_bin ?? null,
      ),
    );
    setCodexHomeOverrideDrafts((prev) =>
      buildWorkspaceOverrideDrafts(
        projects,
        prev,
        (workspace) => workspace.settings.codexHome ?? null,
      ),
    );
    setCodexArgsOverrideDrafts((prev) =>
      buildWorkspaceOverrideDrafts(
        projects,
        prev,
        (workspace) => workspace.settings.codexArgs ?? null,
      ),
    );
  }, [projects]);

  useEffect(() => {
    if (projects.length === 0) {
      setSettingsWorkspaceId(null);
      return;
    }
    setSettingsWorkspaceId((current) => {
      if (current && projects.some((workspace) => workspace.id === current)) {
        return current;
      }
      return projects[0]?.id ?? null;
    });
  }, [projects]);

  useEffect(() => {
    setGroupDrafts((prev) => {
      const next: Record<string, string> = {};
      workspaceGroups.forEach((group) => {
        next[group.id] = prev[group.id] ?? group.name;
      });
      return next;
    });
  }, [workspaceGroups]);

  useEffect(() => {
    if (initialSection) {
      setActiveSection(
        TEMPORARILY_DISABLED_SIDEBAR_SECTIONS.has(initialSection)
          ? "basic"
          : initialSection,
      );
    }
  }, [initialSection]);

  useEffect(() => {
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && key === "w") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    if (activeSection !== "experimental") {
      return;
    }
    if (initialHighlightTarget !== "experimental-collaboration-modes") {
      return;
    }
    setHighlightedRow("experimental-collaboration-modes");
    const timer = window.setTimeout(() => {
      setHighlightedRow((current) =>
        current === "experimental-collaboration-modes" ? null : current,
      );
    }, 2200);
    return () => window.clearTimeout(timer);
  }, [activeSection, initialHighlightTarget]);

  const nextCodexBin = codexPathDraft.trim() ? codexPathDraft.trim() : null;
  const nextCodexArgs = codexArgsDraft.trim() ? codexArgsDraft.trim() : null;
  const codexDirty =
    nextCodexBin !== (appSettings.codexBin ?? null) ||
    nextCodexArgs !== (appSettings.codexArgs ?? null);

  const handleSaveCodexSettings = async () => {
    setIsSavingSettings(true);
    try {
      await onUpdateAppSettings({
        ...appSettings,
        codexBin: nextCodexBin,
        codexArgs: nextCodexArgs,
      });
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleCommitRemoteHost = async () => {
    const nextHost = remoteHostDraft.trim() || "127.0.0.1:4732";
    setRemoteHostDraft(nextHost);
    if (nextHost === appSettings.remoteBackendHost) {
      return;
    }
    await onUpdateAppSettings({
      ...appSettings,
      remoteBackendHost: nextHost,
    });
  };

  const handleCommitRemoteToken = async () => {
    const nextToken = remoteTokenDraft.trim() ? remoteTokenDraft.trim() : null;
    setRemoteTokenDraft(nextToken ?? "");
    if (nextToken === appSettings.remoteBackendToken) {
      return;
    }
    await onUpdateAppSettings({
      ...appSettings,
      remoteBackendToken: nextToken,
    });
  };

  const handleSelectBasicFontSizeLevel = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      const nextValue = event.target.value;
      if (nextValue === "custom") {
        return;
      }
      const parsedScale = Number(nextValue);
      if (!Number.isFinite(parsedScale)) {
        return;
      }
      const nextScale = clampUiScale(parsedScale);
      if (nextScale === appSettings.uiScale) {
        return;
      }
      void onUpdateAppSettings({
        ...appSettings,
        uiScale: nextScale,
      });
    },
    [appSettings, onUpdateAppSettings],
  );

  const handleCommitUiFont = async () => {
    const nextFont = normalizeFontFamily(
      uiFontDraft,
      DEFAULT_UI_FONT_FAMILY,
    );
    setUiFontDraft(nextFont);
    if (nextFont === appSettings.uiFontFamily) {
      return;
    }
    await onUpdateAppSettings({
      ...appSettings,
      uiFontFamily: nextFont,
    });
  };

  const handleCommitCodeFont = async () => {
    const nextFont = normalizeFontFamily(
      codeFontDraft,
      DEFAULT_CODE_FONT_FAMILY,
    );
    setCodeFontDraft(nextFont);
    if (nextFont === appSettings.codeFontFamily) {
      return;
    }
    await onUpdateAppSettings({
      ...appSettings,
      codeFontFamily: nextFont,
    });
  };

  const handleCommitCodeFontSize = async (nextSize: number) => {
    const clampedSize = clampCodeFontSize(nextSize);
    setCodeFontSizeDraft(clampedSize);
    if (clampedSize === appSettings.codeFontSize) {
      return;
    }
    await onUpdateAppSettings({
      ...appSettings,
      codeFontSize: clampedSize,
    });
  };

  const handleSaveUserMsgColor = useCallback(
    async (nextColor: string) => {
      const normalized = normalizeHexColor(nextColor);
      if (normalized === normalizedUserMsgColor) {
        return;
      }
      await onUpdateAppSettings({
        ...appSettings,
        userMsgColor: normalized,
      });
    },
    [appSettings, normalizedUserMsgColor, onUpdateAppSettings],
  );

  const handleUserMsgPresetClick = useCallback(
    (presetColor: string) => {
      const normalizedPreset = presetColor.toLowerCase();
      const nextColor =
        normalizedPreset === defaultUserMsgColor ? "" : normalizedPreset;
      setUserMsgHexDraft(nextColor);
      void handleSaveUserMsgColor(nextColor);
    },
    [defaultUserMsgColor, handleSaveUserMsgColor],
  );

  const handleUserMsgColorPickerChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const nextColor = normalizeHexColor(event.target.value);
      setUserMsgHexDraft(nextColor);
      void handleSaveUserMsgColor(nextColor);
    },
    [handleSaveUserMsgColor],
  );

  const handleUserMsgHexInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const nextValue = event.target.value;
      setUserMsgHexDraft(nextValue);
      if (HEX_COLOR_PATTERN.test(nextValue)) {
        void handleSaveUserMsgColor(nextValue);
      }
    },
    [handleSaveUserMsgColor],
  );

  const handleResetUserMsgColor = useCallback(() => {
    setUserMsgHexDraft("");
    void handleSaveUserMsgColor("");
  }, [handleSaveUserMsgColor]);

  const handleNotificationSoundOptionChange = useCallback(
    (nextSound: string | null) => {
      if (!nextSound) {
        return;
      }
      if (nextSound === selectedNotificationSound) {
        return;
      }
      void onUpdateAppSettings({
        ...appSettings,
        notificationSoundId: nextSound,
      });
    },
    [appSettings, onUpdateAppSettings, selectedNotificationSound],
  );

  const handleSaveNotificationSoundPath = useCallback(() => {
    const nextPath = notificationSoundPathDraft.trim();
    if (nextPath === (appSettings.notificationSoundCustomPath ?? "")) {
      return;
    }
    void onUpdateAppSettings({
      ...appSettings,
      notificationSoundCustomPath: nextPath,
    });
  }, [appSettings, notificationSoundPathDraft, onUpdateAppSettings]);

  const handleBrowseNotificationSoundPath = useCallback(async () => {
    const selection = await open({
      multiple: false,
      directory: false,
      filters: [
        {
          name: "Audio",
          extensions: ["wav", "mp3", "aiff"],
        },
      ],
    });
    if (typeof selection !== "string" || !selection.trim()) {
      return;
    }
    const nextPath = selection.trim();
    setNotificationSoundPathDraft(nextPath);
    await onUpdateAppSettings({
      ...appSettings,
      notificationSoundId: "custom",
      notificationSoundCustomPath: nextPath,
    });
  }, [appSettings, onUpdateAppSettings]);

  const isUserMsgPresetActive = useCallback(
    (presetColor: string) => {
      const normalizedPreset = presetColor.toLowerCase();
      if (!normalizedUserMsgColor && normalizedPreset === defaultUserMsgColor) {
        return true;
      }
      return normalizedUserMsgColor === normalizedPreset;
    },
    [defaultUserMsgColor, normalizedUserMsgColor],
  );

  const normalizeOpenAppTargets = useCallback(
    (drafts: OpenAppDraft[]): OpenAppTarget[] =>
      drafts.map(({ argsText, ...target }) => ({
        ...target,
        label: target.label.trim(),
        appName: (target.appName?.trim() ?? "") || null,
        command: (target.command?.trim() ?? "") || null,
        args: argsText.trim() ? argsText.trim().split(/\s+/) : [],
      })),
    [],
  );

  const handleCommitOpenApps = useCallback(
    async (drafts: OpenAppDraft[], selectedId = openAppSelectedId) => {
      const nextTargets = normalizeOpenAppTargets(drafts);
      const nextSelectedId =
        nextTargets.find((target) => target.id === selectedId)?.id ??
        nextTargets[0]?.id ??
        DEFAULT_OPEN_APP_ID;
      setOpenAppDrafts(buildOpenAppDrafts(nextTargets));
      setOpenAppSelectedId(nextSelectedId);
      await onUpdateAppSettings({
        ...appSettings,
        openAppTargets: nextTargets,
        selectedOpenAppId: nextSelectedId,
      });
    },
    [
      appSettings,
      normalizeOpenAppTargets,
      onUpdateAppSettings,
      openAppSelectedId,
    ],
  );

  const handleOpenAppDraftChange = (
    index: number,
    updates: Partial<OpenAppDraft>,
  ) => {
    setOpenAppDrafts((prev) => {
      const next = [...prev];
      const current = next[index];
      if (!current) {
        return prev;
      }
      next[index] = { ...current, ...updates };
      return next;
    });
  };

  const handleOpenAppKindChange = (index: number, kind: OpenAppTarget["kind"]) => {
    setOpenAppDrafts((prev) => {
      const next = [...prev];
      const current = next[index];
      if (!current) {
        return prev;
      }
      next[index] = {
        ...current,
        kind,
        appName: kind === "app" ? current.appName ?? "" : null,
        command: kind === "command" ? current.command ?? "" : null,
        argsText: kind === "finder" ? "" : current.argsText,
      };
      void handleCommitOpenApps(next);
      return next;
    });
  };

  const handleMoveOpenApp = (index: number, direction: "up" | "down") => {
    const nextIndex = direction === "up" ? index - 1 : index + 1;
    if (nextIndex < 0 || nextIndex >= openAppDrafts.length) {
      return;
    }
    const next = [...openAppDrafts];
    const [moved] = next.splice(index, 1);
    next.splice(nextIndex, 0, moved);
    setOpenAppDrafts(next);
    void handleCommitOpenApps(next);
  };

  const handleDeleteOpenApp = (index: number) => {
    if (openAppDrafts.length <= 1) {
      return;
    }
    const removed = openAppDrafts[index];
    const next = openAppDrafts.filter((_, draftIndex) => draftIndex !== index);
    const nextSelected =
      removed?.id === openAppSelectedId ? next[0]?.id ?? DEFAULT_OPEN_APP_ID : openAppSelectedId;
    setOpenAppDrafts(next);
    void handleCommitOpenApps(next, nextSelected);
  };

  const handleAddOpenApp = () => {
    const newTarget: OpenAppDraft = {
      id: createOpenAppId(),
      label: t("settings.newApp"),
      kind: "app",
      appName: "",
      command: null,
      args: [],
      argsText: "",
    };
    const next = [...openAppDrafts, newTarget];
    setOpenAppDrafts(next);
    void handleCommitOpenApps(next, newTarget.id);
  };

  const handleSelectOpenAppDefault = (id: string) => {
    setOpenAppSelectedId(id);
    writeClientStoreValue("app", "openWorkspaceApp", id);
    void handleCommitOpenApps(openAppDrafts, id);
  };

  const handleComposerPresetChange = (preset: ComposerPreset) => {
    const config = COMPOSER_PRESET_CONFIGS[preset];
    void onUpdateAppSettings({
      ...appSettings,
      composerEditorPreset: preset,
      ...config,
    });
  };

  const handleComposerSendShortcutChange = (
    shortcut: AppSettings["composerSendShortcut"],
  ) => {
    if (appSettings.composerSendShortcut === shortcut) {
      return;
    }
    void onUpdateAppSettings({
      ...appSettings,
      composerSendShortcut: shortcut,
    });
  };

  const handleBrowseCodex = async () => {
    const selection = await open({ multiple: false, directory: false });
    if (!selection || Array.isArray(selection)) {
      return;
    }
    setCodexPathDraft(selection);
  };

  const handleRunDoctor = async () => {
    setDoctorState({ status: "running", result: null });
    try {
      const result = await onRunDoctor(nextCodexBin, nextCodexArgs);
      setDoctorState({ status: "done", result });
    } catch (error) {
      setDoctorState({
        status: "done",
        result: {
          ok: false,
          codexBin: nextCodexBin,
          version: null,
          appServerOk: false,
          details: error instanceof Error ? error.message : String(error),
          path: null,
          nodeOk: false,
          nodeVersion: null,
          nodeDetails: null,
        },
      });
    }
  };

  const updateShortcut = async (key: ShortcutSettingKey, value: string | null) => {
    const draftKey = shortcutDraftKeyBySetting[key];
    setShortcutDrafts((prev) => ({
      ...prev,
      [draftKey]: value ?? "",
    }));
    await onUpdateAppSettings({
      ...appSettings,
      [key]: value,
    });
  };

  const handleShortcutKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
    key: ShortcutSettingKey,
  ) => {
    if (event.key === "Tab" && key !== "composerCollaborationShortcut") {
      return;
    }
    if (event.key === "Tab" && !event.shiftKey) {
      return;
    }
    event.preventDefault();
    if (event.key === "Backspace" || event.key === "Delete") {
      void updateShortcut(key, null);
      return;
    }
    const value = buildShortcutValue(event.nativeEvent);
    if (!value) {
      return;
    }
    void updateShortcut(key, value);
  };

  const trimmedGroupName = newGroupName.trim();
  const canCreateGroup = Boolean(trimmedGroupName);

  const handleCreateGroup = async () => {
    setGroupError(null);
    try {
      const created = await onCreateWorkspaceGroup(newGroupName);
      if (created) {
        setNewGroupName("");
        setCreateGroupOpen(false);
      }
    } catch (error) {
      setGroupError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleRenameGroup = async (group: WorkspaceGroup) => {
    const draft = groupDrafts[group.id] ?? "";
    const trimmed = draft.trim();
    if (!trimmed || trimmed === group.name) {
      setGroupDrafts((prev) => ({
        ...prev,
        [group.id]: group.name,
      }));
      return;
    }
    setGroupError(null);
    try {
      await onRenameWorkspaceGroup(group.id, trimmed);
    } catch (error) {
      setGroupError(error instanceof Error ? error.message : String(error));
      setGroupDrafts((prev) => ({
        ...prev,
        [group.id]: group.name,
      }));
    }
  };

  const updateGroupCopiesFolder = async (
    groupId: string,
    copiesFolder: string | null,
  ) => {
    setGroupError(null);
    try {
      await onUpdateAppSettings({
        ...appSettings,
        workspaceGroups: appSettings.workspaceGroups.map((entry) =>
          entry.id === groupId ? { ...entry, copiesFolder } : entry,
        ),
      });
    } catch (error) {
      setGroupError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleChooseGroupCopiesFolder = async (group: WorkspaceGroup) => {
    const selection = await open({ multiple: false, directory: true });
    if (!selection || Array.isArray(selection)) {
      return;
    }
    await updateGroupCopiesFolder(group.id, selection);
  };

  const handleClearGroupCopiesFolder = async (group: WorkspaceGroup) => {
    if (!group.copiesFolder) {
      return;
    }
    await updateGroupCopiesFolder(group.id, null);
  };

  const handleDeleteGroup = async (group: WorkspaceGroup) => {
    const groupProjects =
      groupedWorkspaces.find((entry) => entry.id === group.id)?.workspaces ?? [];
    const detail =
      groupProjects.length > 0
        ? `\n\n${t("settings.deleteGroupWarning")} "${ungroupedLabel}".`
        : "";
    const confirmed = await ask(
      `${t("common.delete")} "${group.name}"?${detail}`,
      {
        title: t("settings.deleteGroupTitle"),
        kind: "warning",
        okLabel: t("common.delete"),
        cancelLabel: t("common.cancel"),
      },
    );
    if (!confirmed) {
      return;
    }
    setGroupError(null);
    try {
      await onDeleteWorkspaceGroup(group.id);
    } catch (error) {
      setGroupError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) {
      return;
    }
    const sourceIndex = result.source.index;
    const destinationIndex = result.destination.index;
    if (sourceIndex === destinationIndex) {
      return;
    }

    const newGroups = Array.from(workspaceGroups);
    const [moved] = newGroups.splice(sourceIndex, 1);
    newGroups.splice(destinationIndex, 0, moved);

    // Update sortOrder based on the new index to persist the order
    const updatedGroups = newGroups.map((group, index) => ({
      ...group,
      sortOrder: index,
    }));

    void onUpdateAppSettings({
      ...appSettings,
      workspaceGroups: updatedGroups,
    });
  };

  return (
    <div className="settings-embedded">
      <div className="settings-header" />
      <div className="settings-body">
        <aside className={`settings-sidebar${sidebarCollapsed ? " is-collapsed" : ""}`}>
            <button
              type="button"
              className="settings-nav settings-nav-return"
              onClick={onClose}
              aria-label={t("settings.backToApp")}
              title={sidebarCollapsed ? t("settings.backToApp") : ""}
            >
              <ArrowLeft aria-hidden />
              {!sidebarCollapsed && t("settings.backToApp")}
            </button>
            <button
              type="button"
              className={`settings-nav ${activeSection === "basic" ? "active" : ""}`}
              onClick={() => setActiveSection("basic")}
              title={sidebarCollapsed ? t("settings.sidebarBasic") : ""}
            >
              <Settings aria-hidden />
              {!sidebarCollapsed && t("settings.sidebarBasic")}
            </button>
            <button
              type="button"
              className={`settings-nav ${activeSection === "providers" || activeSection === "vendors" ? "active" : ""}`}
              onClick={() => setActiveSection("providers")}
              title={sidebarCollapsed ? t("settings.sidebarProviders") : ""}
            >
              <span className="codicon codicon-vm-connect" />
              {!sidebarCollapsed && t("settings.sidebarProviders")}
            </button>
            <button
              type="button"
              className={`settings-nav ${activeSection === "projects" ? "active" : ""}`}
              onClick={() => setActiveSection("projects")}
              title={sidebarCollapsed ? t("settings.sidebarProjects") : ""}
            >
              <LayoutGrid aria-hidden />
              {!sidebarCollapsed && t("settings.sidebarProjects")}
            </button>
            <button
              type="button"
              className={`settings-nav ${activeSection === "usage" ? "active" : ""}`}
              onClick={() => setActiveSection("usage")}
              title={sidebarCollapsed ? t("settings.sidebarUsage") : ""}
            >
              <BarChart3 aria-hidden />
              {!sidebarCollapsed && t("settings.sidebarUsage")}
            </button>
            <button
              type="button"
              className={`settings-nav ${!mcpSectionDisabled && activeSection === "mcp" ? "active" : ""}${mcpSectionDisabled ? " is-disabled" : ""}`}
              onClick={() => {
                if (!mcpSectionDisabled) {
                  setActiveSection("mcp");
                }
              }}
              disabled={mcpSectionDisabled}
              title={sidebarCollapsed ? t("settings.sidebarMcp") : ""}
            >
              <Server aria-hidden />
              {!sidebarCollapsed && t("settings.sidebarMcp")}
            </button>
            <button
              type="button"
              className={`settings-nav ${!permissionsSectionDisabled && activeSection === "permissions" ? "active" : ""}${permissionsSectionDisabled ? " is-disabled" : ""}`}
              onClick={() => {
                if (!permissionsSectionDisabled) {
                  setActiveSection("permissions");
                }
              }}
              disabled={permissionsSectionDisabled}
              title={sidebarCollapsed ? t("settings.sidebarPermissions") : ""}
            >
              <Shield aria-hidden />
              {!sidebarCollapsed && t("settings.sidebarPermissions")}
            </button>
            {SHOW_COMMIT_ENTRY && (
            <button
              type="button"
              className={`settings-nav ${activeSection === "commit" ? "active" : ""}`}
              onClick={() => setActiveSection("commit")}
              title={sidebarCollapsed ? t("settings.sidebarCommit") : ""}
            >
              <GitCommitHorizontal aria-hidden />
              {!sidebarCollapsed && t("settings.sidebarCommit")}
            </button>
            )}
            <button
              type="button"
              className={`settings-nav ${activeSection === "agents" ? "active" : ""}`}
              onClick={() => setActiveSection("agents")}
              title={sidebarCollapsed ? t("settings.sidebarAgents") : ""}
            >
              <span className="codicon codicon-robot" />
              {!sidebarCollapsed && t("settings.sidebarAgents")}
            </button>
            <button
              type="button"
              className={`settings-nav ${!promptsSectionDisabled && activeSection === "prompts" ? "active" : ""}${promptsSectionDisabled ? " is-disabled" : ""}`}
              onClick={() => {
                if (!promptsSectionDisabled) {
                  setActiveSection("prompts");
                }
              }}
              disabled={promptsSectionDisabled}
              title={sidebarCollapsed ? t("settings.sidebarPrompts") : ""}
            >
              <NotebookPen aria-hidden />
              {!sidebarCollapsed && t("settings.sidebarPrompts")}
            </button>
            <button
              type="button"
              className={`settings-nav ${!skillsSectionDisabled && activeSection === "skills" ? "active" : ""}${skillsSectionDisabled ? " is-disabled" : ""}`}
              onClick={() => {
                if (!skillsSectionDisabled) {
                  setActiveSection("skills");
                }
              }}
              disabled={skillsSectionDisabled}
              title={sidebarCollapsed ? t("settings.sidebarSkills") : ""}
            >
              <BookOpen aria-hidden />
              {!sidebarCollapsed && t("settings.sidebarSkills")}
            </button>
            {SHOW_COMPOSER_ENTRY && (
            <button
              type="button"
              className={`settings-nav ${activeSection === "composer" ? "active" : ""}`}
              onClick={() => setActiveSection("composer")}
              title={sidebarCollapsed ? t("settings.sidebarComposer") : ""}
            >
              <FileText aria-hidden />
              {!sidebarCollapsed && t("settings.sidebarComposer")}
            </button>
            )}
            {SHOW_DICTATION_ENTRY && (
              <button
                type="button"
                className={`settings-nav ${activeSection === "dictation" ? "active" : ""}`}
                onClick={() => setActiveSection("dictation")}
                title={sidebarCollapsed ? t("settings.sidebarDictation") : ""}
              >
                <Mic aria-hidden />
                {!sidebarCollapsed && t("settings.sidebarDictation")}
              </button>
            )}
            {SHOW_SHORTCUTS_ENTRY && (
            <button
              type="button"
              className={`settings-nav ${activeSection === "shortcuts" ? "active" : ""}`}
              onClick={() => setActiveSection("shortcuts")}
              title={sidebarCollapsed ? t("settings.sidebarShortcuts") : ""}
            >
              <Keyboard aria-hidden />
              {!sidebarCollapsed && t("settings.sidebarShortcuts")}
            </button>
            )}
            <button
              type="button"
              className={`settings-nav ${activeSection === "open-apps" ? "active" : ""}`}
              onClick={() => setActiveSection("open-apps")}
              title={sidebarCollapsed ? t("settings.sidebarOpenIn") : ""}
            >
              <ExternalLink aria-hidden />
              {!sidebarCollapsed && t("settings.sidebarOpenIn")}
            </button>
            {SHOW_GIT_ENTRY && (
              <button
                type="button"
                className={`settings-nav ${activeSection === "git" ? "active" : ""}`}
                onClick={() => setActiveSection("git")}
                title={sidebarCollapsed ? t("settings.sidebarGit") : ""}
              >
                <GitBranch aria-hidden />
                {!sidebarCollapsed && t("settings.sidebarGit")}
              </button>
            )}
            <button
              type="button"
              className={`settings-nav ${activeSection === "other" ? "active" : ""}`}
              onClick={() => setActiveSection("other")}
              title={sidebarCollapsed ? t("settings.sidebarOther") : ""}
            >
              <MoreHorizontalIcon aria-hidden />
              {!sidebarCollapsed && t("settings.sidebarOther")}
            </button>
            {SHOW_CODEX_ENTRY && (
              <button
                type="button"
                className={`settings-nav ${activeSection === "codex" ? "active" : ""}`}
                onClick={() => setActiveSection("codex")}
                title={sidebarCollapsed ? t("settings.sidebarCodex") : ""}
              >
                <TerminalSquare aria-hidden />
                {!sidebarCollapsed && t("settings.sidebarCodex")}
              </button>
            )}
            {SHOW_EXPERIMENTAL_ENTRY && (
              <>
                <button
                  type="button"
                  className={`settings-nav ${activeSection === "experimental" ? "active" : ""}`}
                  onClick={() => setActiveSection("experimental")}
                  title={sidebarCollapsed ? t("settings.sidebarExperimental") : ""}
                >
                  <FlaskConical aria-hidden />
                  {!sidebarCollapsed && t("settings.sidebarExperimental")}
                </button>
              </>
            )}
            <button
              type="button"
              className={`settings-nav ${activeSection === "community" ? "active" : ""}`}
              onClick={() => setActiveSection("community")}
              title={sidebarCollapsed ? t("settings.sidebarCommunity") : ""}
            >
              <Users aria-hidden />
              {!sidebarCollapsed && t("settings.sidebarCommunity")}
            </button>
            <button
              type="button"
              className="settings-sidebar-toggle"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              aria-label={sidebarCollapsed ? t("settings.sidebarExpand") : t("settings.sidebarCollapse")}
              title={sidebarCollapsed ? t("settings.sidebarExpand") : t("settings.sidebarCollapse")}
            >
              <span className={`codicon ${sidebarCollapsed ? "codicon-chevron-right" : "codicon-chevron-left"}`} />
            </button>
          </aside>
          <ScrollArea className="settings-content">
            {shouldShowWorkspaceSelector && (
              <div className="settings-workspace-picker">
                <div className="settings-workspace-picker-label">
                  {t("settings.workspacePickerLabel")}
                </div>
                {projects.length > 0 ? (
                  <div className="settings-select-wrap">
                    <select
                      className="settings-select"
                      value={selectedSettingsWorkspace?.id ?? ""}
                      onChange={(event) => setSettingsWorkspaceId(event.target.value || null)}
                    >
                      {projects.map((workspace) => (
                        <option key={workspace.id} value={workspace.id}>
                          {workspace.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="settings-inline-muted">
                    {t("settings.workspacePickerEmpty")}
                  </div>
                )}
              </div>
            )}
            <ProjectsSection
              active={activeSection === "projects"}
              t={t}
              createGroupOpen={createGroupOpen}
              setCreateGroupOpen={setCreateGroupOpen}
              newGroupName={newGroupName}
              setNewGroupName={setNewGroupName}
              canCreateGroup={canCreateGroup}
              handleCreateGroup={handleCreateGroup}
              groupError={groupError}
              workspaceGroups={workspaceGroups}
              handleDragEnd={handleDragEnd}
              renamingGroupId={renamingGroupId}
              setRenamingGroupId={setRenamingGroupId}
              groupDrafts={groupDrafts}
              setGroupDrafts={setGroupDrafts}
              handleRenameGroup={handleRenameGroup}
              handleChooseGroupCopiesFolder={handleChooseGroupCopiesFolder}
              handleClearGroupCopiesFolder={handleClearGroupCopiesFolder}
              handleDeleteGroup={handleDeleteGroup}
              groupedWorkspaces={groupedWorkspaces}
              onAssignWorkspaceGroup={onAssignWorkspaceGroup}
              ungroupedLabel={ungroupedLabel}
              onMoveWorkspace={onMoveWorkspace}
              onDeleteWorkspace={onDeleteWorkspace}
              projectsCount={projects.length}
            />
            {activeSection === "basic" && (
              <section className="settings-section settings-section-basic" data-basic-tab={basicSubTab}>
                <div className="settings-section-title">{t("settings.sidebarBasic")}</div>
                <div className="settings-section-subtitle">
                  {t("settings.basicDescription")}
                </div>
                <div className="settings-basic-tabs">
                  <button
                    type="button"
                    className={`settings-basic-tab ${basicSubTab === "appearance" ? "active" : ""}`}
                    onClick={() => setBasicSubTab("appearance")}
                  >
                    <Monitor className="settings-basic-tab-icon" aria-hidden />
                    {t("settings.basicAppearance")}
                  </button>
                  <button
                    type="button"
                    className={`settings-basic-tab ${basicSubTab === "behavior" ? "active" : ""}`}
                    onClick={() => setBasicSubTab("behavior")}
                  >
                    <Cog className="settings-basic-tab-icon" aria-hidden />
                    {t("settings.basicBehavior")}
                  </button>
                </div>
                {basicSubTab === "behavior" && (
                  <div className="settings-basic-behavior settings-basic-surface">
                    <div className="settings-basic-group-card">
                      <div className="settings-subsection-title">{t("settings.sendShortcutSubtitle")}</div>
                      <div className="settings-subsection-subtitle">
                        {t("settings.sendShortcutSubDescription")}
                      </div>
                      <div className="settings-shortcut-cards">
                        <button
                          type="button"
                          className={`settings-shortcut-card ${appSettings.composerSendShortcut === "enter" ? "active" : ""}`}
                          onClick={() =>
                            void onUpdateAppSettings({
                              ...appSettings,
                              composerSendShortcut: "enter",
                            })
                          }
                        >
                          {appSettings.composerSendShortcut === "enter" ? (
                            <div className="settings-shortcut-card-check" aria-hidden>
                              <Check size={12} />
                            </div>
                          ) : null}
                          <div className="settings-shortcut-card-title">{t("settings.sendShortcutEnterTitle")}</div>
                          <div className="settings-shortcut-card-desc">{t("settings.sendShortcutEnterDesc")}</div>
                        </button>
                        <button
                          type="button"
                          className={`settings-shortcut-card ${appSettings.composerSendShortcut === "cmdEnter" ? "active" : ""}`}
                          onClick={() =>
                            void onUpdateAppSettings({
                              ...appSettings,
                              composerSendShortcut: "cmdEnter",
                            })
                          }
                        >
                          {appSettings.composerSendShortcut === "cmdEnter" ? (
                            <div className="settings-shortcut-card-check" aria-hidden>
                              <Check size={12} />
                            </div>
                          ) : null}
                          <div className="settings-shortcut-card-title">{t("settings.sendShortcutCmdEnterTitle")}</div>
                          <div className="settings-shortcut-card-desc">{t("settings.sendShortcutCmdEnterDesc")}</div>
                        </button>
                      </div>
                    </div>
                    <Card className="settings-basic-group-card settings-basic-shadcn-card settings-basic-streaming-card">
                      <CardHeader className="settings-card-switch-header">
                        <div className="settings-card-switch-meta">
                          <CardTitle className="settings-toggle-title">
                            {t("settings.behaviorStreaming")}
                          </CardTitle>
                          <CardDescription className="settings-toggle-subtitle">
                            {t("settings.behaviorStreamingDesc")}
                          </CardDescription>
                        </div>
                        <CardAction className="settings-card-switch-action">
                          <Switch
                            checked={appSettings.streamingEnabled ?? true}
                            onCheckedChange={(checked) =>
                              void onUpdateAppSettings({
                                ...appSettings,
                                streamingEnabled: checked,
                              })
                            }
                          />
                        </CardAction>
                      </CardHeader>
                    </Card>
                    <Card
                      className={`settings-basic-group-card settings-basic-shadcn-card settings-basic-proxy-card${
                        systemProxyEnabledDraft ? " is-enabled" : ""
                      }`}
                    >
                      <CardHeader className="settings-basic-sounds-card-header settings-proxy-card-header">
                        <div className="settings-card-switch-meta">
                          <CardTitle className="settings-subsection-title">
                            <span className="settings-proxy-card-title">
                              <Wifi size={16} aria-hidden />
                              {t("settings.behaviorProxyTitle")}
                              {systemProxyEnabledDraft && (
                                <ProxyStatusBadge
                                  proxyUrl={systemProxyUrlDraft}
                                  label={t("messages.proxyBadge")}
                                  variant="compact"
                                  className="settings-proxy-header-badge"
                                />
                              )}
                            </span>
                          </CardTitle>
                          <CardDescription className="settings-subsection-subtitle">
                            {t("settings.behaviorProxyDesc")}
                          </CardDescription>
                        </div>
                        <CardAction className="settings-proxy-card-action">
                          <Switch
                            checked={systemProxyEnabledDraft}
                            onCheckedChange={handleToggleSystemProxy}
                            aria-label={t("settings.behaviorProxyEnabled")}
                          />
                        </CardAction>
                      </CardHeader>
                      <CardContent className="settings-basic-sounds-card-content settings-proxy-card-content">
                        <div className="settings-proxy-input-row">
                          <Label
                            className="settings-visually-hidden"
                            htmlFor="system-proxy-url"
                          >
                            {t("settings.behaviorProxyAddress")}
                          </Label>
                          <div className="settings-proxy-input-shell">
                            <Input
                              id="system-proxy-url"
                              className="settings-proxy-input"
                              value={systemProxyUrlDraft}
                              onChange={(event) => {
                                setSystemProxyUrlDraft(event.target.value);
                                setSystemProxyError(null);
                                setSystemProxyNotice(null);
                              }}
                              placeholder={t("settings.behaviorProxyAddressPlaceholder")}
                              spellCheck={false}
                              autoCapitalize="off"
                              autoCorrect="off"
                            />
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            className="settings-proxy-save-btn"
                            onClick={() => void handleSaveSystemProxy()}
                            disabled={systemProxySaving || !systemProxyDirty}
                          >
                            <Save size={14} aria-hidden />
                            {t("settings.behaviorProxySave")}
                          </Button>
                        </div>
                        <div className="settings-help settings-sound-hint settings-sound-hint-shadcn settings-proxy-hint">
                          <span className="settings-sound-hint-copy">
                            {t("settings.behaviorProxyHint")}
                          </span>
                        </div>
                        {systemProxyNotice ? (
                          <div
                            className={
                              systemProxyNotice.kind === "error"
                                ? "settings-inline-error"
                                : "settings-inline-success"
                            }
                            role={systemProxyNotice.kind === "error" ? "alert" : "status"}
                          >
                            {systemProxyNotice.message}
                          </div>
                        ) : null}
                        {systemProxyError ? (
                          <div className="settings-toggle-subtitle" role="alert">
                            {systemProxyError}
                          </div>
                        ) : null}
                      </CardContent>
                    </Card>
                    <Card
                      className={`settings-basic-group-card settings-basic-shadcn-card settings-basic-sounds-card${
                        appSettings.notificationSoundsEnabled ? " is-enabled" : ""
                      }`}
                    >
                      <CardHeader className="settings-basic-sounds-card-header">
                        <CardTitle className="settings-subsection-title">
                          {t("settings.soundsSubtitle")}
                        </CardTitle>
                        <CardDescription className="settings-subsection-subtitle">
                          {t("settings.soundsSubDescription")}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="settings-basic-sounds-card-content">
                        <div className="settings-sound-toggle-row">
                          <div>
                            <div className="settings-toggle-title">{t("settings.notificationSounds")}</div>
                            <div className="settings-toggle-subtitle">
                              {t("settings.notificationSoundsDesc")}
                            </div>
                          </div>
                          <Switch
                            checked={appSettings.notificationSoundsEnabled}
                            onCheckedChange={(checked) =>
                              void onUpdateAppSettings({
                                ...appSettings,
                                notificationSoundsEnabled: checked,
                              })
                            }
                          />
                        </div>
                        <div className="settings-help settings-sound-hint settings-sound-hint-shadcn">
                          <Badge variant="outline" className="settings-sound-status-badge">
                            <Info size={12} aria-hidden />
                            <span>
                              {appSettings.notificationSoundsEnabled
                                ? t("settings.notificationSoundsEnabled")
                                : t("settings.notificationSoundsDisabled")}
                            </span>
                          </Badge>
                          <span className="settings-sound-hint-copy">
                            {t("settings.notificationSoundsHint")}
                          </span>
                        </div>
                        {appSettings.notificationSoundsEnabled ? (
                          <div className="settings-sound-config settings-sound-config-shadcn">
                            <div className="settings-sound-control-item">
                              <Label className="settings-field-label" htmlFor="notification-sound-select-native">
                                {t("settings.soundSelectLabel")}
                              </Label>
                              <div className="settings-sound-select-row settings-sound-select-row-shadcn">
                                <select
                                  id="notification-sound-select-native"
                                  className="settings-sound-native-select-sr"
                                  value={selectedNotificationSound}
                                  onChange={(event) => handleNotificationSoundOptionChange(event.target.value)}
                                >
                                  {soundOptions.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                                <Select
                                  value={selectedNotificationSound}
                                  onValueChange={handleNotificationSoundOptionChange}
                                >
                                  <SelectTrigger
                                    id="notification-sound-select"
                                    className="settings-sound-select-trigger"
                                    aria-label={t("settings.soundSelectLabel")}
                                  >
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {soundOptions.map((option) => (
                                      <SelectItem key={option.value} value={option.value}>
                                        {option.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="settings-sound-test-btn"
                                  onClick={() =>
                                    onTestNotificationSound(
                                      selectedNotificationSound,
                                      notificationSoundPathDraft,
                                    )
                                  }
                                >
                                  {t("settings.test")}
                                </Button>
                              </div>
                            </div>
                            {selectedNotificationSound === "custom" ? (
                              <div className="settings-sound-control-item settings-sound-control-item-custom">
                                <Label className="settings-field-label" htmlFor="notification-sound-custom-path">
                                  {t("settings.soundCustomFileLabel")}
                                </Label>
                                <div className="settings-sound-custom-path-row settings-sound-custom-path-row-shadcn">
                                  <Input
                                    id="notification-sound-custom-path"
                                    type="text"
                                    className="settings-sound-custom-input"
                                    value={notificationSoundPathDraft}
                                    placeholder={t("settings.soundCustomPlaceholder")}
                                    onChange={(event) => setNotificationSoundPathDraft(event.target.value)}
                                  />
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="settings-button-compact"
                                    onClick={() => {
                                      void handleBrowseNotificationSoundPath();
                                    }}
                                    aria-label={t("settings.browse")}
                                  >
                                    <FolderOpen size={14} aria-hidden />
                                    {t("settings.browse")}
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="settings-button-compact"
                                    onClick={handleSaveNotificationSoundPath}
                                  >
                                    {t("common.save")}
                                  </Button>
                                </div>
                                <div className="settings-help settings-sound-custom-hint">
                                  {t("settings.soundCustomHint")}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </CardContent>
                    </Card>
                  </div>
                )}
                {basicSubTab === "appearance" && (
                  <div className="settings-basic-appearance settings-basic-surface">
                    <div className="settings-basic-group-card settings-basic-group-card--list">
                      <div className="settings-subsection-title">{t("settings.displaySubtitle")}</div>
                      <div className="settings-subsection-subtitle">
                        {t("settings.displaySubDescription")}
                      </div>
                      <div className="settings-field settings-basic-theme-field settings-basic-item">
                        <div className="settings-basic-field-header">
                          <Palette className="settings-basic-field-icon" aria-hidden />
                          <span className="settings-basic-field-label">{t("settings.theme")}</span>
                        </div>
                        <div className="settings-basic-theme-selector" role="radiogroup" aria-label={t("settings.theme")}>
                          <button
                            type="button"
                            role="radio"
                            aria-checked={appSettings.theme === "system"}
                            className={`settings-basic-theme-option ${
                              appSettings.theme === "system" ? "active" : ""
                            }`}
                            onClick={() =>
                              void onUpdateAppSettings({
                                ...appSettings,
                                theme: "system",
                              })
                            }
                          >
                            <span className="settings-basic-theme-icon settings-basic-theme-icon-system">
                              <Monitor size={14} />
                            </span>
                            <span>{t("settings.themeSystem")}</span>
                          </button>
                          <button
                            type="button"
                            role="radio"
                            aria-checked={appSettings.theme === "light"}
                            className={`settings-basic-theme-option ${
                              appSettings.theme === "light" ? "active" : ""
                            }`}
                            onClick={() =>
                              void onUpdateAppSettings({
                                ...appSettings,
                                theme: "light",
                              })
                            }
                          >
                            <span className="settings-basic-theme-icon settings-basic-theme-icon-light">
                              <Sun size={14} />
                            </span>
                            <span>{t("settings.themeLight")}</span>
                          </button>
                          <button
                            type="button"
                            role="radio"
                            aria-checked={appSettings.theme === "dark"}
                            className={`settings-basic-theme-option ${
                              appSettings.theme === "dark" ? "active" : ""
                            }`}
                            onClick={() =>
                              void onUpdateAppSettings({
                                ...appSettings,
                                theme: "dark",
                              })
                            }
                          >
                            <span className="settings-basic-theme-icon settings-basic-theme-icon-dark">
                              <Moon size={14} />
                            </span>
                            <span>{t("settings.themeDark")}</span>
                          </button>
                        </div>
                      </div>
                      <LanguageSelector rowClassName="settings-basic-item" />
                      <div className="settings-field settings-basic-item">
                        <div className="settings-basic-field-header">
                          <Type className="settings-basic-field-icon" aria-hidden />
                          <span className="settings-basic-field-label">{t("settings.fontSizeLabel")}</span>
                        </div>
                        <div className="settings-control">
                          <div className="settings-select-wrap">
                            <select
                              className="settings-select"
                              value={uiScaleSelectValue}
                              aria-label={t("settings.fontSizeLabel")}
                              onChange={handleSelectBasicFontSizeLevel}
                            >
                              {BASIC_FONT_SIZE_LEVELS.map((level) => (
                                <option key={level.value} value={level.value}>
                                  {t(level.labelKey)}
                                </option>
                              ))}
                              {uiScaleSelectValue === "custom" ? (
                                <option value="custom">{t("settings.fontSizeCustom", { value: uiScalePercentLabel })}</option>
                              ) : null}
                            </select>
                          </div>
                        </div>
                        <div className="settings-help" title={scaleShortcutTitle}>
                          {scaleShortcutText}
                        </div>
                      </div>
                    </div>
                    <div className="settings-color-config-card settings-basic-group-card">
                      <div className="settings-color-config-head">
                        <MessageCircle className="settings-color-config-icon" aria-hidden />
                        <span className="settings-color-config-title">
                          {t("settings.userMsgColorLabel")}
                        </span>
                      </div>
                      <div className="settings-color-preset-grid" role="list">
                        {userMsgPresets.map((preset) => (
                          <button
                            key={preset.color}
                            type="button"
                            role="listitem"
                            className={`settings-color-swatch${isUserMsgPresetActive(preset.color) ? " is-active" : ""}`}
                            onClick={() => handleUserMsgPresetClick(preset.color)}
                            title={preset.label}
                            aria-label={`${t("settings.userMsgColorLabel")} ${preset.color}`}
                            data-testid={`settings-user-msg-color-preset-${preset.color.slice(1)}`}
                          >
                            <span
                              className="settings-color-swatch-inner"
                              style={{ backgroundColor: preset.color }}
                            />
                          </button>
                        ))}
                      </div>
                      <div className="settings-color-custom-row">
                        <span className="settings-color-custom-label">
                          {t("settings.userMsgColorCustom")}
                        </span>
                        <label className="settings-color-picker" aria-label={t("settings.userMsgColorLabel")}>
                          <span
                            className="settings-color-picker-preview"
                            style={{
                              backgroundColor: normalizedUserMsgColor || defaultUserMsgColor,
                            }}
                          />
                          <input
                            type="color"
                            className="settings-color-picker-input"
                            value={normalizedUserMsgColor || defaultUserMsgColor}
                            onChange={handleUserMsgColorPickerChange}
                            aria-label={t("settings.userMsgColorLabel")}
                          />
                        </label>
                        <input
                          type="text"
                          className="settings-input settings-color-hex-input"
                          value={userMsgHexDraft}
                          onChange={handleUserMsgHexInputChange}
                          placeholder="#6e40c9"
                          maxLength={7}
                          spellCheck={false}
                          aria-label={t("settings.userMsgColorLabel")}
                          data-testid="settings-user-msg-color-hex-input"
                        />
                        {normalizedUserMsgColor ? (
                          <button
                            type="button"
                            className="ghost settings-color-reset"
                            onClick={handleResetUserMsgColor}
                            data-testid="settings-user-msg-color-reset"
                          >
                            <RotateCcw size={14} aria-hidden />
                            {t("settings.userMsgColorReset")}
                          </button>
                        ) : null}
                      </div>
                      <div className="settings-help settings-color-hint">
                        <Info size={14} aria-hidden />
                        <span>{t("settings.userMsgColorHint")}</span>
                      </div>
                    </div>
                    <div className="settings-basic-group-card settings-basic-group-card--list">
                      <div className="settings-field settings-basic-item">
                        <label className="settings-field-label" htmlFor="ui-font-family">
                          {t("settings.uiFontFamily")}
                        </label>
                        <div className="settings-field-row">
                          <input
                            id="ui-font-family"
                            type="text"
                            className="settings-input"
                            value={uiFontDraft}
                            onChange={(event) => setUiFontDraft(event.target.value)}
                            onBlur={() => {
                              void handleCommitUiFont();
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                void handleCommitUiFont();
                              }
                            }}
                          />
                          <button
                            type="button"
                            className="ghost settings-button-compact"
                            onClick={() => {
                              setUiFontDraft(DEFAULT_UI_FONT_FAMILY);
                              void onUpdateAppSettings({
                                ...appSettings,
                                uiFontFamily: DEFAULT_UI_FONT_FAMILY,
                              });
                            }}
                          >
                            {t("settings.reset")}
                          </button>
                        </div>
                        <div className="settings-help">
                          {t("settings.uiFontFamilyDesc")}
                        </div>
                      </div>
                      <div className="settings-field settings-basic-item">
                        <label className="settings-field-label" htmlFor="code-font-family">
                          {t("settings.codeFontFamily")}
                        </label>
                        <div className="settings-field-row">
                          <input
                            id="code-font-family"
                            type="text"
                            className="settings-input"
                            value={codeFontDraft}
                            onChange={(event) => setCodeFontDraft(event.target.value)}
                            onBlur={() => {
                              void handleCommitCodeFont();
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                void handleCommitCodeFont();
                              }
                            }}
                          />
                          <button
                            type="button"
                            className="ghost settings-button-compact"
                            onClick={() => {
                              setCodeFontDraft(DEFAULT_CODE_FONT_FAMILY);
                              void onUpdateAppSettings({
                                ...appSettings,
                                codeFontFamily: DEFAULT_CODE_FONT_FAMILY,
                              });
                            }}
                          >
                            {t("settings.reset")}
                          </button>
                        </div>
                        <div className="settings-help">
                          {t("settings.codeFontFamilyDesc")}
                        </div>
                      </div>
                      <div className="settings-field settings-basic-item">
                        <label className="settings-field-label" htmlFor="code-font-size">
                          {t("settings.codeFontSize")}
                        </label>
                        <div className="settings-field-row">
                          <input
                            id="code-font-size"
                            type="range"
                            min={CODE_FONT_SIZE_MIN}
                            max={CODE_FONT_SIZE_MAX}
                            step={1}
                            className="settings-input settings-input--range"
                            value={codeFontSizeDraft}
                            onChange={(event) => {
                              const nextValue = Number(event.target.value);
                              setCodeFontSizeDraft(nextValue);
                              void handleCommitCodeFontSize(nextValue);
                            }}
                          />
                          <div className="settings-scale-value">{codeFontSizeDraft}px</div>
                          <button
                            type="button"
                            className="ghost settings-button-compact"
                            onClick={() => {
                              setCodeFontSizeDraft(CODE_FONT_SIZE_DEFAULT);
                              void handleCommitCodeFontSize(CODE_FONT_SIZE_DEFAULT);
                            }}
                          >
                            {t("settings.reset")}
                          </button>
                        </div>
                        <div className="settings-help">
                          {t("settings.codeFontSizeDesc")}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </section>
            )}
            {activeSection === "providers" && (
              <VendorSettingsPanel />
            )}
            {activeSection === "usage" && (
              <UsageSection
                activeWorkspace={selectedSettingsWorkspace}
                activeEngine={activeEngine}
                workspaces={projects}
                selectedWorkspaceId={selectedSettingsWorkspace?.id ?? ""}
                onWorkspaceChange={(workspaceId) => setSettingsWorkspaceId(workspaceId || null)}
              />
            )}
            {activeSection === "mcp" && (
              <McpSection
                activeWorkspace={mcpContextWorkspace}
                activeEngine={activeEngine}
              />
            )}
            {activeSection === "permissions" && (
              <PlaceholderSection type="permissions" />
            )}
            {activeSection === "commit" && (
              <CommitSection
                commitPrompt={commitPrompt}
                onCommitPromptChange={setCommitPrompt}
                onSaveCommitPrompt={async () => {
                  void onUpdateAppSettings({
                    ...appSettings,
                    commitPrompt,
                  });
                }}
              />
            )}
            {activeSection === "prompts" && (
              <PromptSection activeWorkspace={selectedSettingsWorkspace} />
            )}
            {activeSection === "skills" && (
              <SkillsSection activeWorkspace={selectedSettingsWorkspace} />
            )}
            {activeSection === "other" && (
              <section className="settings-section">
                <div className="settings-section-title">{t("settings.sidebarOther")}</div>
                <div className="settings-section-subtitle">
                  {t("settings.otherDescription")}
                </div>
                <HistoryCompletionSettings />
                <Separator className="my-4" />
                <SessionRadarHistoryManagementSection
                  entries={sessionRadarRecentCompletedSessions}
                  onDeleteEntries={handleDeleteSessionRadarHistoryInSettings}
                />
                <Separator className="my-4" />
                <ProjectSessionManagementSection
                  workspace={selectedProjectSessionWorkspace}
                  workspaces={sessionWorkspaceOptions}
                  groupedWorkspaces={groupedWorkspaces}
                  selectedWorkspaceId={selectedProjectSessionWorkspace?.id ?? null}
                  onWorkspaceChange={setProjectSessionWorkspaceId}
                  threads={selectedWorkspaceThreads}
                  loading={selectedWorkspaceThreadListLoading}
                  onRefresh={
                    onEnsureWorkspaceThreads
                      ? (workspaceId) => {
                          onEnsureWorkspaceThreads(workspaceId);
                        }
                      : undefined
                  }
                  onDeleteSessions={handleDeleteWorkspaceThreadsInSettings}
                />
              </section>
            )}
            {activeSection === "community" && (
              <section className="settings-section settings-about-section">
                <div className="settings-about-name">
                  MossX
                  {appVersion && (
                    <span className="settings-about-version">{appVersion}</span>
                  )}
                </div>
                <div className="settings-about-tagline">
                  {t("about.tagline")}
                </div>
                <div className="settings-about-links">
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => void openUrl("https://github.com/zhukunpenglinyutong/mossx")}
                  >
                    {t("about.github")}
                  </button>
                </div>
                <div className="settings-about-wechat">
                  <div className="settings-about-wechat-label">{t("about.wechatGroupTitle")}</div>
                  <img
                    className="settings-about-wechat-qr"
                    src="https://claudecodecn-1253302184.cos.ap-beijing.myqcloud.com/vscode/wxq.png"
                    alt={t("about.wechatGroupTitle")}
                  />
                </div>
              </section>
            )}
            <ComposerSection
              active={activeSection === "composer"}
              t={t}
              appSettings={appSettings}
              onUpdateAppSettings={onUpdateAppSettings}
              handleComposerPresetChange={handleComposerPresetChange}
              handleComposerSendShortcutChange={handleComposerSendShortcutChange}
              historyCompletionEnabled={historyCompletionEnabled}
              handleHistoryCompletionToggle={handleHistoryCompletionToggle}
              reduceTransparency={reduceTransparency}
            />
            <AgentSettingsSection active={activeSection === "agents"} />
            {activeSection === "dictation" && (
              <section className="settings-section">
                <div className="settings-section-title">{t("settings.dictationTitle")}</div>
                <div className="settings-section-subtitle">
                  {t("settings.dictationDescription")}
                </div>
                <div className="settings-toggle-row">
                  <div>
                    <div className="settings-toggle-title">{t("settings.enableDictation")}</div>
                    <div className="settings-toggle-subtitle">
                      {t("settings.enableDictationDesc")}
                    </div>
                  </div>
                  <Switch
                    checked={appSettings.dictationEnabled}
                    onCheckedChange={(checked) => {
                      void onUpdateAppSettings({
                        ...appSettings,
                        dictationEnabled: checked,
                      });
                      if (
                        !checked &&
                        dictationModelStatus?.state === "downloading" &&
                        onCancelDictationDownload
                      ) {
                        onCancelDictationDownload();
                      }
                      if (
                        checked &&
                        dictationModelStatus?.state === "missing" &&
                        onDownloadDictationModel
                      ) {
                        onDownloadDictationModel();
                      }
                    }}
                  />
                </div>
                <div className="settings-field">
                  <label className="settings-field-label" htmlFor="dictation-model">
                    {t("settings.dictationModel")}
                  </label>
                  <select
                    id="dictation-model"
                    className="settings-select"
                    value={appSettings.dictationModelId}
                    onChange={(event) =>
                      void onUpdateAppSettings({
                        ...appSettings,
                        dictationModelId: event.target.value,
                      })
                    }
                  >
                    {DICTATION_MODELS(t).map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.label} ({model.size})
                      </option>
                    ))}
                  </select>
                  <div className="settings-help">
                    {selectedDictationModel.note} {t("settings.downloadSize")} {selectedDictationModel.size}.
                  </div>
                </div>
                <div className="settings-field">
                  <label className="settings-field-label" htmlFor="dictation-language">
                    {t("settings.preferredDictationLanguage")}
                  </label>
                  <select
                    id="dictation-language"
                    className="settings-select"
                    value={appSettings.dictationPreferredLanguage ?? ""}
                    onChange={(event) =>
                      void onUpdateAppSettings({
                        ...appSettings,
                        dictationPreferredLanguage: event.target.value || null,
                      })
                    }
                  >
                    <option value="">{t("settings.autoDetectOnly")}</option>
                    <option value="en">{t("settings.languageEnglish")}</option>
                    <option value="es">{t("settings.languageSpanish")}</option>
                    <option value="fr">{t("settings.languageFrench")}</option>
                    <option value="de">{t("settings.languageGerman")}</option>
                    <option value="it">{t("settings.languageItalian")}</option>
                    <option value="pt">{t("settings.languagePortuguese")}</option>
                    <option value="nl">{t("settings.languageDutch")}</option>
                    <option value="sv">{t("settings.languageSwedish")}</option>
                    <option value="no">{t("settings.languageNorwegian")}</option>
                    <option value="da">{t("settings.languageDanish")}</option>
                    <option value="fi">{t("settings.languageFinnish")}</option>
                    <option value="pl">{t("settings.languagePolish")}</option>
                    <option value="tr">{t("settings.languageTurkish")}</option>
                    <option value="ru">{t("settings.languageRussian")}</option>
                    <option value="uk">{t("settings.languageUkrainian")}</option>
                    <option value="ja">{t("settings.languageJapanese")}</option>
                    <option value="ko">{t("settings.languageKorean")}</option>
                    <option value="zh">{t("settings.languageChinese")}</option>
                  </select>
                  <div className="settings-help">
                    {t("settings.languageDetectionDesc")}
                  </div>
                </div>
                <div className="settings-field">
                  <label className="settings-field-label" htmlFor="dictation-hold-key">
                    {t("settings.holdToDictateKey")}
                  </label>
                  <select
                    id="dictation-hold-key"
                    className="settings-select"
                    value={appSettings.dictationHoldKey ?? ""}
                    onChange={(event) =>
                      void onUpdateAppSettings({
                        ...appSettings,
                        dictationHoldKey: event.target.value,
                      })
                    }
                  >
                    <option value="">{t("settings.holdToDictateOff")}</option>
                    <option value="alt">{t("settings.holdToDictateOption")}</option>
                    <option value="shift">{t("settings.holdToDictateShift")}</option>
                    <option value="control">{t("settings.holdToDictateControl")}</option>
                    <option value="meta">{t("settings.holdToDictateCommand")}</option>
                  </select>
                  <div className="settings-help">
                    {t("settings.holdToDictateDesc")}
                  </div>
                </div>
                {dictationModelStatus && (
                  <div className="settings-field">
                    <div className="settings-field-label">
                      {t("settings.modelStatus")} ({selectedDictationModel.label})
                    </div>
                    <div className="settings-help">
                      {dictationModelStatus.state === "ready" && t("settings.modelReady")}
                      {dictationModelStatus.state === "missing" && t("settings.modelNotDownloaded")}
                      {dictationModelStatus.state === "downloading" &&
                        t("settings.modelDownloading")}
                      {dictationModelStatus.state === "error" &&
                        (dictationModelStatus.error ?? t("settings.modelDownloadError"))}
                    </div>
                    {dictationProgress && (
                      <div className="settings-download-progress">
                        <div className="settings-download-bar">
                          <div
                            className="settings-download-fill"
                            style={{
                              width: dictationProgress.totalBytes
                                ? `${Math.min(
                                    100,
                                    (dictationProgress.downloadedBytes /
                                      dictationProgress.totalBytes) *
                                      100,
                                  )}%`
                                : "0%",
                            }}
                          />
                        </div>
                        <div className="settings-download-meta">
                          {formatDownloadSize(dictationProgress.downloadedBytes)}
                        </div>
                      </div>
                    )}
                    <div className="settings-field-actions">
                      {dictationModelStatus.state === "missing" && (
                        <button
                          type="button"
                          className="primary"
                          onClick={onDownloadDictationModel}
                          disabled={!onDownloadDictationModel}
                        >
                          {t("settings.downloadModel")}
                        </button>
                      )}
                      {dictationModelStatus.state === "downloading" && (
                        <button
                          type="button"
                          className="ghost settings-button-compact"
                          onClick={onCancelDictationDownload}
                          disabled={!onCancelDictationDownload}
                        >
                          {t("settings.cancelDownload")}
                        </button>
                      )}
                      {dictationReady && (
                        <button
                          type="button"
                          className="ghost settings-button-compact"
                          onClick={onRemoveDictationModel}
                          disabled={!onRemoveDictationModel}
                        >
                          {t("settings.removeModel")}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </section>
            )}
            <ShortcutsSection
              active={activeSection === "shortcuts"}
              t={t}
              shortcutDrafts={shortcutDrafts}
              handleShortcutKeyDown={handleShortcutKeyDown}
              updateShortcut={updateShortcut}
            />
            <OpenAppsSection
              active={activeSection === "open-apps"}
              t={t}
              openAppDrafts={openAppDrafts}
              openAppIconById={openAppIconById}
              openAppSelectedId={openAppSelectedId}
              handleOpenAppDraftChange={handleOpenAppDraftChange}
              handleCommitOpenApps={handleCommitOpenApps}
              handleOpenAppKindChange={handleOpenAppKindChange}
              handleSelectOpenAppDefault={handleSelectOpenAppDefault}
              handleMoveOpenApp={handleMoveOpenApp}
              handleDeleteOpenApp={handleDeleteOpenApp}
              handleAddOpenApp={handleAddOpenApp}
            />
            {activeSection === "git" && (
              <section className="settings-section">
                <div className="settings-section-title">{t("settings.gitTitle")}</div>
                <div className="settings-section-subtitle">
                  {t("settings.gitDescription")}
                </div>
                <div className="settings-toggle-row">
                  <div>
                    <div className="settings-toggle-title">{t("settings.preloadGitDiffs")}</div>
                    <div className="settings-toggle-subtitle">
                      {t("settings.preloadGitDiffsDesc")}
                    </div>
                  </div>
                  <Switch
                    checked={appSettings.preloadGitDiffs}
                    onCheckedChange={(checked) =>
                      void onUpdateAppSettings({
                        ...appSettings,
                        preloadGitDiffs: checked,
                      })
                    }
                  />
                </div>
              </section>
            )}
            {/* vendors is now mapped to providers above */}
            <CodexSection
              active={activeSection === "codex"}
              t={t}
              appSettings={appSettings}
              onUpdateAppSettings={onUpdateAppSettings}
              codexPathDraft={codexPathDraft}
              setCodexPathDraft={setCodexPathDraft}
              codexArgsDraft={codexArgsDraft}
              setCodexArgsDraft={setCodexArgsDraft}
              codexDirty={codexDirty}
              handleBrowseCodex={handleBrowseCodex}
              handleSaveCodexSettings={handleSaveCodexSettings}
              isSavingSettings={isSavingSettings}
              handleRunDoctor={handleRunDoctor}
              doctorState={doctorState}
              remoteHostDraft={remoteHostDraft}
              setRemoteHostDraft={setRemoteHostDraft}
              remoteTokenDraft={remoteTokenDraft}
              setRemoteTokenDraft={setRemoteTokenDraft}
              handleCommitRemoteHost={handleCommitRemoteHost}
              handleCommitRemoteToken={handleCommitRemoteToken}
              globalAgentsMeta={globalAgentsMeta}
              globalAgentsError={globalAgentsError}
              globalAgentsContent={globalAgentsContent}
              globalAgentsLoading={globalAgentsLoading}
              globalAgentsRefreshDisabled={globalAgentsRefreshDisabled}
              globalAgentsSaveDisabled={globalAgentsSaveDisabled}
              globalAgentsSaveLabel={globalAgentsSaveLabel}
              setGlobalAgentsContent={setGlobalAgentsContent}
              refreshGlobalAgents={refreshGlobalAgents}
              saveGlobalAgents={saveGlobalAgents}
              globalConfigMeta={globalConfigMeta}
              globalConfigError={globalConfigError}
              globalConfigContent={globalConfigContent}
              globalConfigLoading={globalConfigLoading}
              globalConfigRefreshDisabled={globalConfigRefreshDisabled}
              globalConfigSaveDisabled={globalConfigSaveDisabled}
              globalConfigSaveLabel={globalConfigSaveLabel}
              setGlobalConfigContent={setGlobalConfigContent}
              refreshGlobalConfig={refreshGlobalConfig}
              saveGlobalConfig={saveGlobalConfig}
              projects={projects}
              codexBinOverrideDrafts={codexBinOverrideDrafts}
              setCodexBinOverrideDrafts={setCodexBinOverrideDrafts}
              codexHomeOverrideDrafts={codexHomeOverrideDrafts}
              setCodexHomeOverrideDrafts={setCodexHomeOverrideDrafts}
              codexArgsOverrideDrafts={codexArgsOverrideDrafts}
              setCodexArgsOverrideDrafts={setCodexArgsOverrideDrafts}
              onUpdateWorkspaceCodexBin={onUpdateWorkspaceCodexBin}
              onUpdateWorkspaceSettings={onUpdateWorkspaceSettings}
            />
            {/* about is now mapped to community above */}
            {activeSection === "experimental" && (
              <section className="settings-section">
                <div className="settings-section-title">{t("settings.experimentalTitle")}</div>
                <div className="settings-section-subtitle">
                  {t("settings.experimentalDescription")}
                </div>
                {hasCodexHomeOverrides && (
                  <div className="settings-help">
                    {t("settings.experimentalWarning1")}
                    <br />
                    {t("settings.experimentalWarning2")}
                  </div>
                )}
                <div className="settings-toggle-row">
                  <div>
                    <div className="settings-toggle-title">{t("settings.configFile")}</div>
                    <div className="settings-toggle-subtitle">
                      {t("settings.configFileDesc")}
                    </div>
                  </div>
                  <button type="button" className="ghost" onClick={handleOpenConfig}>
                    {t("settings.openInFinder")}
                  </button>
                </div>
                {openConfigError && (
                  <div className="settings-help">{openConfigError}</div>
                )}
                <div className="settings-toggle-row">
                  <div>
                    <div className="settings-toggle-title">{t("settings.multiAgent")}</div>
                    <div className="settings-toggle-subtitle">
                      {t("settings.multiAgentDesc")}
                    </div>
                  </div>
                  <Switch
                    checked={appSettings.experimentalCollabEnabled}
                    onCheckedChange={(checked) =>
                      void onUpdateAppSettings({
                        ...appSettings,
                        experimentalCollabEnabled: checked,
                      })
                    }
                  />
                </div>
                <div
                  className={`settings-toggle-row${
                    highlightedRow === "experimental-collaboration-modes"
                      ? " is-highlighted"
                      : ""
                  }`}
                >
                  <div>
                    <div className="settings-toggle-title">{t("settings.collaborationModes")}</div>
                    <div className="settings-toggle-subtitle">
                      {t("settings.collaborationModesDesc")}
                    </div>
                  </div>
                  <Switch
                    checked={appSettings.experimentalCollaborationModesEnabled}
                    onCheckedChange={(checked) =>
                      void onUpdateAppSettings({
                        ...appSettings,
                        experimentalCollaborationModesEnabled: checked,
                      })
                    }
                  />
                </div>
                <div className="settings-toggle-row">
                  <div>
                    <div className="settings-toggle-title">{t("settings.backgroundTerminal")}</div>
                    <div className="settings-toggle-subtitle">
                      {t("settings.backgroundTerminalDesc")}
                    </div>
                  </div>
                  <Switch
                    checked={appSettings.experimentalUnifiedExecEnabled}
                    onCheckedChange={(checked) =>
                      void onUpdateAppSettings({
                        ...appSettings,
                        experimentalUnifiedExecEnabled: checked,
                      })
                    }
                  />
                </div>
                <div className="settings-toggle-row">
                  <div>
                    <div className="settings-toggle-title">{t("settings.steerMode")}</div>
                    <div className="settings-toggle-subtitle">
                      {t("settings.steerModeDesc")}
                    </div>
                  </div>
                  <Switch
                    checked={appSettings.experimentalSteerEnabled}
                    onCheckedChange={(checked) =>
                      void onUpdateAppSettings({
                        ...appSettings,
                        experimentalSteerEnabled: checked,
                      })
                    }
                  />
                </div>
              </section>
            )}
          </ScrollArea>
        </div>
    </div>
  );
}
