// @ts-nocheck
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Switch } from "@/components/ui/switch";
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
  Globe,
  Monitor,
  Cog,
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
  WorkspaceGroup,
  WorkspaceInfo,
} from "../../../types";
import wxqImage from "../../../assets/wxq.png";
import {
  buildShortcutValue,
  getDefaultInterruptShortcut,
} from "../../../utils/shortcuts";
import { clampUiScale } from "../../../utils/uiScale";
import {
  reloadCodexRuntimeConfig,
} from "../../../services/tauri";
import {
  DEFAULT_CODE_FONT_FAMILY,
  DEFAULT_UI_FONT_FAMILY,
  clampCodeFontSize,
  normalizeFontFamily,
} from "../../../utils/fonts";
import { DEFAULT_OPEN_APP_ID } from "../../app/constants";
import { writeClientStoreValue } from "../../../services/clientStorage";
import { VendorSettingsPanel } from "../../vendors/components/VendorSettingsPanel";
import { AgentSettingsSection } from "./AgentSettingsSection";
import { PlaceholderSection } from "./PlaceholderSection";
import { CommitSection } from "./CommitSection";
import { PromptSection } from "./PromptSection";
import { ProxyStatusBadge } from "../../../components/ProxyStatusBadge";
import { UsageSection } from "./UsageSection";
import { McpSection } from "./McpSection";
import { SkillsSection } from "./SkillsSection";
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
import Archive from "lucide-react/dist/esm/icons/archive";
import MoreHorizontalIcon from "lucide-react/dist/esm/icons/more-horizontal";
import NotebookPen from "lucide-react/dist/esm/icons/notebook-pen";
import Users from "lucide-react/dist/esm/icons/users";
import { pushErrorToast } from "../../../services/toasts";
import {
  normalizeHexColor,
  HEX_COLOR_PATTERN,
  getContrastingTextColor,
} from "../../../utils/colorUtils";
import {
} from "../../../utils/platform";
import {
  isHistoryCompletionEnabled,
  setHistoryCompletionEnabled,
} from "../../composer/hooks/useInputHistoryStore";
import {
  buildOpenAppDrafts,
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
import { BasicAppearanceSection } from "./settings-view/sections/BasicAppearanceSection";
import { CodexSection } from "./settings-view/sections/CodexSection";
import { OtherSection } from "./settings-view/sections/OtherSection";
import { SessionManagementSection } from "./settings-view/sections/SessionManagementSection";
import { RuntimePoolSection } from "./settings-view/sections/RuntimePoolSection";
import { DetachedExternalChangeToggles } from "./settings-view/sections/DetachedExternalChangeToggles";
import { WebServiceSettings } from "./settings-view/sections/WebServiceSettings";
import { DictationSection } from "./settings-view/sections/DictationSection";
import {
  buildShortcutDrafts,
  shortcutDraftKeyBySetting,
  type ShortcutDrafts,
  type ShortcutSettingKey,
} from "./settings-view/settingsViewShortcuts";
import {
  applyUserMessageBubbleCssVars,
  DEFAULT_DARK_USER_MSG,
  DEFAULT_LIGHT_USER_MSG,
  extractPrimaryFontFamily,
  formatFontFamilySetting,
  listLocalUiFonts,
  SettingsViewSection,
  USER_MSG_DARK_PRESETS,
  USER_MSG_LIGHT_PRESETS,
} from "./settings-view/settingsViewAppearance";
import {
  SHOW_CODEX_ENTRY,
  SHOW_COMMIT_ENTRY,
  SHOW_COMPOSER_ENTRY,
  SHOW_DICTATION_ENTRY,
  SHOW_EXPERIMENTAL_ENTRY,
  SHOW_GIT_ENTRY,
  SHOW_SHORTCUTS_ENTRY,
  TEMPORARILY_DISABLED_SIDEBAR_SECTIONS as BASE_DISABLED_SIDEBAR_SECTIONS,
} from "./settings-view/settingsViewConstants";

type ExperimentalToggleRowProps = {
  title: string;
  description: string;
  markerLabel: string;
  markerTone: "success" | "info" | "warning";
  markerDetail: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  highlighted?: boolean;
};

function ExperimentalToggleRow({
  title,
  description,
  markerLabel,
  markerTone,
  markerDetail,
  checked,
  onCheckedChange,
  highlighted = false,
}: ExperimentalToggleRowProps) {
  return (
    <div className={`settings-toggle-row${highlighted ? " is-highlighted" : ""}`}>
      <div>
        <div className="settings-toggle-title flex items-center gap-2">
          <span>{title}</span>
          <Badge variant={markerTone} size="sm">
            {markerLabel}
          </Badge>
        </div>
        <div className="settings-toggle-subtitle">
          {description}
        </div>
        <div className="settings-help">{markerDetail}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

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
  onRunCodexDoctor?: (
    codexBin: string | null,
    codexArgs: string | null,
  ) => Promise<CodexDoctorResult>;
  onRunClaudeDoctor?: (claudeBin: string | null) => Promise<CodexDoctorResult>;
  onRunDoctor?: (
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
  sessionRadarRecentCompletedSessions?: SessionRadarEntry[];
  onEnsureWorkspaceThreads?: (workspaceId: string) => void;
  scaleShortcutTitle: string;
  scaleShortcutText: string;
  onTestNotificationSound: (soundId?: string, customSoundPath?: string) => void;
  dictationModelStatus?: DictationModelStatus | null;
  onDownloadDictationModel?: () => void;
  onCancelDictationDownload?: () => void;
  onRemoveDictationModel?: () => void;
  initialSection?: SettingsViewSection;
  initialHighlightTarget?: "experimental-collaboration-modes";
};
const TEMPORARILY_DISABLED_SIDEBAR_SECTIONS: ReadonlySet<SettingsViewSection> =
  BASE_DISABLED_SIDEBAR_SECTIONS as ReadonlySet<SettingsViewSection>;
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
  onRunCodexDoctor,
  onRunClaudeDoctor,
  onRunDoctor,
  activeWorkspace,
  activeEngine,
  onUpdateWorkspaceCodexBin,
  onUpdateWorkspaceSettings,
  sessionRadarRecentCompletedSessions = [],
  onEnsureWorkspaceThreads: _onEnsureWorkspaceThreads,
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
  const runCodexDoctor = onRunCodexDoctor ?? onRunDoctor;
  const [activeSection, setActiveSection] = useState<SettingsViewSection>("basic");
  const [basicSubTab, setBasicSubTab] = useState<"appearance" | "behavior">("appearance");
  const [commitPrompt, setCommitPrompt] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [claudePathDraft, setClaudePathDraft] = useState(appSettings.claudeBin ?? "");
  const [codexPathDraft, setCodexPathDraft] = useState(appSettings.codexBin ?? "");
  const [codexArgsDraft, setCodexArgsDraft] = useState(appSettings.codexArgs ?? "");
  const [remoteHostDraft, setRemoteHostDraft] = useState(appSettings.remoteBackendHost);
  const [remoteTokenDraft, setRemoteTokenDraft] = useState(appSettings.remoteBackendToken ?? "");
  const [uiFontDraft, setUiFontDraft] = useState(() =>
    extractPrimaryFontFamily(appSettings.uiFontFamily) ||
    extractPrimaryFontFamily(DEFAULT_UI_FONT_FAMILY),
  );
  const [uiFontOptions, setUiFontOptions] = useState<string[]>([]);
  const [codeFontDraft, setCodeFontDraft] = useState(() =>
    extractPrimaryFontFamily(appSettings.codeFontFamily) ||
    extractPrimaryFontFamily(DEFAULT_CODE_FONT_FAMILY),
  );
  const [codeFontSizeDraft, setCodeFontSizeDraft] = useState(appSettings.codeFontSize);
  const [uiScaleDraft, setUiScaleDraft] = useState(clampUiScale(appSettings.uiScale));
  const [userMsgHexDraft, setUserMsgHexDraft] = useState(() =>
    normalizeHexColor(appSettings.userMsgColor),
  );
  const [notificationSoundPathDraft, setNotificationSoundPathDraft] = useState(
    appSettings.notificationSoundCustomPath ?? "",
  );
  const systemResolvedTheme = useSystemResolvedTheme();
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
  const runtimePanelWorkspaces = useMemo(
    () =>
      allWorkspaces && allWorkspaces.length > 0
        ? allWorkspaces
        : groupedWorkspaces.flatMap((group) => group.workspaces),
    [allWorkspaces, groupedWorkspaces],
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
  const [claudeDoctorState, setClaudeDoctorState] = useState<{
    status: "idle" | "running" | "done";
    result: CodexDoctorResult | null;
  }>({ status: "idle", result: null });
  const [codexRuntimeReloadState, setCodexRuntimeReloadState] = useState<{
    status: "idle" | "reloading" | "applied" | "failed";
    message: string | null;
  }>({ status: "idle", message: null });
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [shortcutDrafts, setShortcutDrafts] = useState<ShortcutDrafts>(() =>
    buildShortcutDrafts(appSettings),
  );
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
  const defaultUiPrimaryFont = useMemo(
    () => extractPrimaryFontFamily(DEFAULT_UI_FONT_FAMILY),
    [],
  );
  const uiFontSelectOptions = useMemo(() => {
    const options = new Set<string>(uiFontOptions);
    const currentPrimary = extractPrimaryFontFamily(appSettings.uiFontFamily);
    if (defaultUiPrimaryFont) {
      options.add(defaultUiPrimaryFont);
    }
    if (currentPrimary) {
      options.add(currentPrimary);
    }
    if (uiFontDraft) {
      options.add(uiFontDraft);
    }
    return Array.from(options).sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: "base" }),
    );
  }, [appSettings.uiFontFamily, defaultUiPrimaryFont, uiFontDraft, uiFontOptions]);
  const defaultCodePrimaryFont = useMemo(
    () => extractPrimaryFontFamily(DEFAULT_CODE_FONT_FAMILY),
    [],
  );
  const codeFontSelectOptions = useMemo(() => {
    const options = new Set<string>(uiFontOptions);
    const currentPrimary = extractPrimaryFontFamily(appSettings.codeFontFamily);
    if (defaultCodePrimaryFont) {
      options.add(defaultCodePrimaryFont);
    }
    if (currentPrimary) {
      options.add(currentPrimary);
    }
    if (codeFontDraft) {
      options.add(codeFontDraft);
    }
    return Array.from(options).sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: "base" }),
    );
  }, [appSettings.codeFontFamily, codeFontDraft, defaultCodePrimaryFont, uiFontOptions]);
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
  const uiScaleDraftPercentLabel = `${Math.round(uiScaleDraft * 100)}%`;
  const projects = useMemo(
    () => groupedWorkspaces.flatMap((group) => group.workspaces),
    [groupedWorkspaces],
  );
  const sessionWorkspaceOptions = useMemo(
    () => (allWorkspaces && allWorkspaces.length > 0 ? allWorkspaces : projects),
    [allWorkspaces, projects],
  );
  const [settingsWorkspaceId, setSettingsWorkspaceId] = useState<string | null>(null);
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
  const mcpContextWorkspace = useMemo(
    () => activeWorkspace ?? projects[0] ?? null,
    [activeWorkspace, projects],
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
  const shouldShowWorkspaceSelector = false;
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
    let active = true;
    void listLocalUiFonts()
      .then((fonts) => {
        if (active) {
          setUiFontOptions(fonts);
        }
      })
      .catch(() => {
        if (active) {
          setUiFontOptions([]);
        }
      });
    return () => {
      active = false;
    };
  }, []);
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
    setClaudePathDraft(appSettings.claudeBin ?? "");
  }, [appSettings.claudeBin]);

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
    const nextPrimaryFont =
      extractPrimaryFontFamily(appSettings.uiFontFamily) ||
      extractPrimaryFontFamily(DEFAULT_UI_FONT_FAMILY);
    setUiFontDraft(nextPrimaryFont);
  }, [appSettings.uiFontFamily]);

  useEffect(() => {
    const nextPrimaryFont =
      extractPrimaryFontFamily(appSettings.codeFontFamily) ||
      extractPrimaryFontFamily(DEFAULT_CODE_FONT_FAMILY);
    setCodeFontDraft(nextPrimaryFont);
  }, [appSettings.codeFontFamily]);

  useEffect(() => {
    setCodeFontSizeDraft(appSettings.codeFontSize);
  }, [appSettings.codeFontSize]);

  useEffect(() => {
    setUiScaleDraft(clampedUiScale);
  }, [clampedUiScale]);

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
    setShortcutDrafts(buildShortcutDrafts(appSettings));
  }, [appSettings]);

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
    if (initialSection !== "prompts") {
      return;
    }
    setSettingsWorkspaceId(activeWorkspace?.id ?? null);
  }, [activeWorkspace?.id, initialSection]);

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

  const nextClaudeBin = claudePathDraft.trim() ? claudePathDraft.trim() : null;
  const nextCodexBin = codexPathDraft.trim() ? codexPathDraft.trim() : null;
  const nextCodexArgs = codexArgsDraft.trim() ? codexArgsDraft.trim() : null;
  const claudeDirty = nextClaudeBin !== (appSettings.claudeBin ?? null);
  const codexDirty =
    nextCodexBin !== (appSettings.codexBin ?? null) ||
    nextCodexArgs !== (appSettings.codexArgs ?? null);

  const handleSaveClaudeSettings = async () => {
    setIsSavingSettings(true);
    try {
      await onUpdateAppSettings({
        ...appSettings,
        claudeBin: nextClaudeBin,
      });
    } finally {
      setIsSavingSettings(false);
    }
  };

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

  const handleSaveUiScale = useCallback(() => {
    const nextScale = clampUiScale(uiScaleDraft);
    if (nextScale === clampedUiScale) {
      return;
    }
    void onUpdateAppSettings({
      ...appSettings,
      uiScale: nextScale,
    });
  }, [appSettings, clampedUiScale, onUpdateAppSettings, uiScaleDraft]);

  const handleResetUiScaleDraft = useCallback(() => {
    setUiScaleDraft(1);
  }, []);

  const handleCommitUiFont = useCallback(
    async (selectedFontName: string) => {
      const normalizedFontName = selectedFontName.trim();
      const nextFont = normalizeFontFamily(
        formatFontFamilySetting(normalizedFontName),
        DEFAULT_UI_FONT_FAMILY,
      );
      if (nextFont === appSettings.uiFontFamily) {
        return;
      }
      await onUpdateAppSettings({
        ...appSettings,
        uiFontFamily: nextFont,
      });
    },
    [appSettings, onUpdateAppSettings],
  );

  const handleUiFontSelectChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      const nextFontName = event.target.value;
      setUiFontDraft(nextFontName);
      void handleCommitUiFont(nextFontName);
    },
    [handleCommitUiFont],
  );

  const handleCommitCodeFont = useCallback(
    async (selectedFontName: string) => {
      const normalizedFontName = selectedFontName.trim();
      const nextFont = normalizeFontFamily(
        formatFontFamilySetting(normalizedFontName),
        DEFAULT_CODE_FONT_FAMILY,
      );
      if (nextFont === appSettings.codeFontFamily) {
        return;
      }
      await onUpdateAppSettings({
        ...appSettings,
        codeFontFamily: nextFont,
      });
    },
    [appSettings, onUpdateAppSettings],
  );

  const handleCodeFontSelectChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      const nextFontName = event.target.value;
      setCodeFontDraft(nextFontName);
      void handleCommitCodeFont(nextFontName);
    },
    [handleCommitCodeFont],
  );

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
      applyUserMessageBubbleCssVars(
        normalized || null,
        normalized ? getContrastingTextColor(normalized) : null,
      );
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

  const handleBrowseClaude = async () => {
    const selection = await open({ multiple: false, directory: false });
    if (!selection || Array.isArray(selection)) {
      return;
    }
    setClaudePathDraft(selection);
  };

  const handleRunDoctor = async () => {
    setDoctorState({ status: "running", result: null });
    try {
      if (!runCodexDoctor) {
        throw new Error("Codex doctor is not available.");
      }
      const result = await runCodexDoctor(nextCodexBin, nextCodexArgs);
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

  const handleRunClaudeDoctor = async () => {
    setClaudeDoctorState({ status: "running", result: null });
    try {
      if (!onRunClaudeDoctor) {
        throw new Error("Claude doctor is not available.");
      }
      const result = await onRunClaudeDoctor(nextClaudeBin);
      setClaudeDoctorState({ status: "done", result });
    } catch (error) {
      setClaudeDoctorState({
        status: "done",
        result: {
          ok: false,
          codexBin: nextClaudeBin,
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

  const handleReloadCodexRuntimeConfig = useCallback(async () => {
    setCodexRuntimeReloadState({ status: "reloading", message: null });
    try {
      const result = await reloadCodexRuntimeConfig();
      const message =
        result.restartedSessions === 0
          ? t("settings.codexRuntimeReloadNoConnectedSessions")
          : t("settings.codexRuntimeReloadAppliedCount", {
              count: result.restartedSessions,
            });
      setCodexRuntimeReloadState({ status: "applied", message });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setCodexRuntimeReloadState({
        status: "failed",
        message,
      });
    }
  }, [t]);

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
      <div className={`settings-body${sidebarCollapsed ? " is-sidebar-collapsed" : ""}`}>
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
              className={`settings-nav ${activeSection === "session-management" ? "active" : ""}`}
              onClick={() => setActiveSection("session-management")}
              title={sidebarCollapsed ? t("settings.sidebarSessionManagement") : ""}
            >
              <Archive aria-hidden />
              {!sidebarCollapsed && t("settings.sidebarSessionManagement")}
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
            <button
              type="button"
              className={`settings-nav ${activeSection === "web-service" ? "active" : ""}`}
              onClick={() => setActiveSection("web-service")}
              title={sidebarCollapsed ? t("settings.sidebarWebService") : ""}
            >
              <Globe aria-hidden />
              {!sidebarCollapsed && t("settings.sidebarWebService")}
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
              className={`settings-nav ${activeSection === "runtime" ? "active" : ""}`}
              onClick={() => setActiveSection("runtime")}
              title={sidebarCollapsed ? t("settings.sidebarRuntime") : ""}
            >
              <TerminalSquare aria-hidden />
              {!sidebarCollapsed && t("settings.sidebarRuntime")}
            </button>
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
                  <BasicAppearanceSection
                    appSettings={appSettings}
                    onUpdateAppSettings={onUpdateAppSettings}
                    uiScaleDraft={uiScaleDraft}
                    clampedUiScale={clampedUiScale}
                    uiScaleDraftPercentLabel={uiScaleDraftPercentLabel}
                    setUiScaleDraft={setUiScaleDraft}
                    handleResetUiScaleDraft={handleResetUiScaleDraft}
                    handleSaveUiScale={handleSaveUiScale}
                    scaleShortcutTitle={scaleShortcutTitle}
                    scaleShortcutText={scaleShortcutText}
                    userMsgPresets={userMsgPresets}
                    isUserMsgPresetActive={isUserMsgPresetActive}
                    handleUserMsgPresetClick={handleUserMsgPresetClick}
                    normalizedUserMsgColor={normalizedUserMsgColor}
                    defaultUserMsgColor={defaultUserMsgColor}
                    handleUserMsgColorPickerChange={handleUserMsgColorPickerChange}
                    userMsgHexDraft={userMsgHexDraft}
                    handleUserMsgHexInputChange={handleUserMsgHexInputChange}
                    handleResetUserMsgColor={handleResetUserMsgColor}
                    uiFontDraft={uiFontDraft}
                    handleUiFontSelectChange={handleUiFontSelectChange}
                    uiFontSelectOptions={uiFontSelectOptions}
                    defaultUiPrimaryFont={defaultUiPrimaryFont}
                    setUiFontDraft={setUiFontDraft}
                    codeFontDraft={codeFontDraft}
                    codeFontSelectOptions={codeFontSelectOptions}
                    handleCodeFontSelectChange={handleCodeFontSelectChange}
                    defaultCodePrimaryFont={defaultCodePrimaryFont}
                    setCodeFontDraft={setCodeFontDraft}
                    codeFontSizeDraft={codeFontSizeDraft}
                    setCodeFontSizeDraft={setCodeFontSizeDraft}
                    handleCommitCodeFontSize={handleCommitCodeFontSize}
                  />
                )}
              </section>
            )}
            {activeSection === "providers" && (
              <VendorSettingsPanel
                codexReloadStatus={codexRuntimeReloadState.status}
                codexReloadMessage={codexRuntimeReloadState.message}
                handleReloadCodexRuntimeConfig={handleReloadCodexRuntimeConfig}
              />
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
              <PromptSection
                activeWorkspace={selectedSettingsWorkspace}
                workspaces={projects}
                selectedWorkspaceId={selectedSettingsWorkspace?.id ?? null}
                onWorkspaceChange={(workspaceId) => setSettingsWorkspaceId(workspaceId || null)}
              />
            )}
            {activeSection === "skills" && (
              <SkillsSection activeWorkspace={selectedSettingsWorkspace} />
            )}
            {activeSection === "session-management" && (
              <SessionManagementSection
                title={t("settings.projectSessionTitle")}
                description={t("settings.sessionManagementDescription")}
                workspaces={sessionWorkspaceOptions}
                groupedWorkspaces={groupedWorkspaces}
                initialWorkspaceId={selectedSettingsWorkspace?.id ?? null}
                onSessionsMutated={_onEnsureWorkspaceThreads}
              />
            )}
            {activeSection === "other" && (
              <OtherSection
                title={t("settings.sidebarOther")}
                description={t("settings.otherDescription")}
                sessionRadarRecentCompletedSessions={sessionRadarRecentCompletedSessions}
                onDeleteSessionRadarHistory={handleDeleteSessionRadarHistoryInSettings}
              />
            )}
            {activeSection === "runtime" && (
              <RuntimePoolSection
                t={t}
                appSettings={appSettings}
                workspaces={runtimePanelWorkspaces}
                onUpdateAppSettings={onUpdateAppSettings}
              />
            )}
            {activeSection === "community" && (
              <section className="settings-section settings-about-section">
                <div className="settings-about-name">
                  ccgui
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
                    onClick={() => void openUrl("https://github.com/zhukunpenglinyutong/desktop-cc-gui")}
                  >
                    {t("about.github")}
                  </button>
                </div>
                <div className="settings-about-wechat">
                  <div className="settings-about-wechat-label">{t("about.wechatGroupTitle")}</div>
                  <img
                    className="settings-about-wechat-qr"
                    src={wxqImage}
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
            <DictationSection
              active={activeSection === "dictation"}
              t={t}
              appSettings={appSettings}
              onUpdateAppSettings={onUpdateAppSettings}
              dictationModelStatus={dictationModelStatus}
              onDownloadDictationModel={onDownloadDictationModel}
              onCancelDictationDownload={onCancelDictationDownload}
              onRemoveDictationModel={onRemoveDictationModel}
            />
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
            {activeSection === "web-service" && (
              <section className="settings-section">
                <WebServiceSettings
                  t={t}
                  appSettings={appSettings}
                  onUpdateAppSettings={onUpdateAppSettings}
                />
              </section>
            )}
            {activeSection === "git" && (
              <section className="settings-section">
                <div className="settings-section-title">{t("settings.gitTitle")}</div>
                <div className="settings-section-subtitle">
                  {t("settings.gitDescription")}
                </div>
                <DetachedExternalChangeToggles
                  t={t}
                  appSettings={appSettings}
                  onUpdateAppSettings={onUpdateAppSettings}
                />
              </section>
            )}
            {/* vendors is now mapped to providers above */}
            <CodexSection
              active={activeSection === "codex"}
              t={t}
              appSettings={appSettings}
              onUpdateAppSettings={onUpdateAppSettings}
              claudePathDraft={claudePathDraft}
              setClaudePathDraft={setClaudePathDraft}
              claudeDirty={claudeDirty}
              handleBrowseClaude={handleBrowseClaude}
              handleSaveClaudeSettings={handleSaveClaudeSettings}
              handleRunClaudeDoctor={handleRunClaudeDoctor}
              claudeDoctorState={claudeDoctorState}
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
                <ExperimentalToggleRow
                  title={t("settings.collaborationModes")}
                  description={t("settings.collaborationModesDesc")}
                  markerLabel={t("settings.experimentalBadgeRecommended")}
                  markerTone="success"
                  markerDetail={t("settings.collaborationModesMarkerDesc")}
                  highlighted={highlightedRow === "experimental-collaboration-modes"}
                  checked={appSettings.experimentalCollaborationModesEnabled}
                  onCheckedChange={(checked) =>
                    void onUpdateAppSettings({
                      ...appSettings,
                      experimentalCollaborationModesEnabled: checked,
                    })
                  }
                />
                <ExperimentalToggleRow
                  title={t("settings.steerMode")}
                  description={t("settings.steerModeDesc")}
                  markerLabel={t("settings.experimentalBadgeAvailable")}
                  markerTone="success"
                  markerDetail={t("settings.steerModeMarkerDesc")}
                  checked={appSettings.experimentalSteerEnabled}
                  onCheckedChange={(checked) =>
                    void onUpdateAppSettings({
                      ...appSettings,
                      experimentalSteerEnabled: checked,
                    })
                  }
                />
              </section>
            )}
          </ScrollArea>
        </div>
    </div>
  );
}
