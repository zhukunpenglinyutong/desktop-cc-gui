import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ask, open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronUp from "lucide-react/dist/esm/icons/chevron-up";
import LayoutGrid from "lucide-react/dist/esm/icons/layout-grid";
import SlidersHorizontal from "lucide-react/dist/esm/icons/sliders-horizontal";
import Mic from "lucide-react/dist/esm/icons/mic";
import Keyboard from "lucide-react/dist/esm/icons/keyboard";
import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left";
import Stethoscope from "lucide-react/dist/esm/icons/stethoscope";
import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import TerminalSquare from "lucide-react/dist/esm/icons/terminal-square";
import FileText from "lucide-react/dist/esm/icons/file-text";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import FlaskConical from "lucide-react/dist/esm/icons/flask-conical";
import ExternalLink from "lucide-react/dist/esm/icons/external-link";
import Store from "lucide-react/dist/esm/icons/store";
import Info from "lucide-react/dist/esm/icons/info";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { GripVertical, MoreHorizontal, Pencil, FolderOpen, Plus, Monitor, Sun, Moon } from "lucide-react";
import { DragDropContext, Droppable, Draggable, type DropResult } from "@hello-pangea/dnd";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import type {
  AppSettings,
  CodexDoctorResult,
  DictationModelStatus,
  WorkspaceSettings,
  OpenAppTarget,
  WorkspaceGroup,
  WorkspaceInfo,
} from "../../../types";
import { formatDownloadSize } from "../../../utils/formatting";
import {
  buildShortcutValue,
  formatShortcut,
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
import { GENERIC_APP_ICON, getKnownOpenAppIcon } from "../../app/utils/openAppIcons";
import { useGlobalAgentsMd } from "../hooks/useGlobalAgentsMd";
import { useGlobalCodexConfigToml } from "../hooks/useGlobalCodexConfigToml";
import { FileEditorCard } from "../../shared/components/FileEditorCard";
import { LanguageSelector } from "./LanguageSelector";
import { HistoryCompletionSettings } from "./HistoryCompletionSettings";
import { AgentSettingsSection } from "./AgentSettingsSection";
import { ModelMappingSettings } from "../../models/components/ModelMappingSettings";
import {
  isHistoryCompletionEnabled,
  setHistoryCompletionEnabled,
} from "../../composer/hooks/useInputHistoryStore";

// Feature flags to show/hide settings sidebar entries
const SHOW_DICTATION_ENTRY = false;
const SHOW_GIT_ENTRY = false;
const SHOW_CODEX_AND_EXPERIMENTAL = false;

const DICTATION_MODELS = (t: (key: string) => string) => [
  { id: "tiny", label: t("settings.dictationModelTiny"), size: "75 MB", note: t("settings.dictationModelFastest") },
  { id: "base", label: t("settings.dictationModelBase"), size: "142 MB", note: t("settings.dictationModelBalanced") },
  { id: "small", label: t("settings.dictationModelSmall"), size: "466 MB", note: t("settings.dictationModelBetter") },
  { id: "medium", label: t("settings.dictationModelMedium"), size: "1.5 GB", note: t("settings.dictationModelHigh") },
  { id: "large-v3", label: t("settings.dictationModelLargeV3"), size: "3.0 GB", note: t("settings.dictationModelBest") },
];

type ComposerPreset = AppSettings["composerEditorPreset"];

type ComposerPresetSettings = Pick<
  AppSettings,
  | "composerFenceExpandOnSpace"
  | "composerFenceExpandOnEnter"
  | "composerFenceLanguageTags"
  | "composerFenceWrapSelection"
  | "composerFenceAutoWrapPasteMultiline"
  | "composerFenceAutoWrapPasteCodeLike"
  | "composerListContinuation"
  | "composerCodeBlockCopyUseModifier"
>;

const COMPOSER_PRESET_LABELS = (t: (key: string) => string): Record<ComposerPreset, string> => ({
  default: t("settings.composerPresetDefault"),
  helpful: t("settings.composerPresetHelpful"),
  smart: t("settings.composerPresetSmart"),
});

const COMPOSER_PRESET_CONFIGS: Record<ComposerPreset, ComposerPresetSettings> = {
  default: {
    composerFenceExpandOnSpace: false,
    composerFenceExpandOnEnter: false,
    composerFenceLanguageTags: false,
    composerFenceWrapSelection: false,
    composerFenceAutoWrapPasteMultiline: false,
    composerFenceAutoWrapPasteCodeLike: false,
    composerListContinuation: false,
    composerCodeBlockCopyUseModifier: false,
  },
  helpful: {
    composerFenceExpandOnSpace: true,
    composerFenceExpandOnEnter: false,
    composerFenceLanguageTags: true,
    composerFenceWrapSelection: true,
    composerFenceAutoWrapPasteMultiline: true,
    composerFenceAutoWrapPasteCodeLike: false,
    composerListContinuation: true,
    composerCodeBlockCopyUseModifier: false,
  },
  smart: {
    composerFenceExpandOnSpace: true,
    composerFenceExpandOnEnter: false,
    composerFenceLanguageTags: true,
    composerFenceWrapSelection: true,
    composerFenceAutoWrapPasteMultiline: true,
    composerFenceAutoWrapPasteCodeLike: true,
    composerListContinuation: true,
    composerCodeBlockCopyUseModifier: false,
  },
};

const normalizeOverrideValue = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const buildWorkspaceOverrideDrafts = (
  projects: WorkspaceInfo[],
  prev: Record<string, string>,
  getValue: (workspace: WorkspaceInfo) => string | null | undefined,
): Record<string, string> => {
  const next: Record<string, string> = {};
  projects.forEach((workspace) => {
    const existing = prev[workspace.id];
    next[workspace.id] = existing ?? getValue(workspace) ?? "";
  });
  return next;
};

export type SettingsViewProps = {
  workspaceGroups: WorkspaceGroup[];
  groupedWorkspaces: Array<{
    id: string | null;
    name: string;
    workspaces: WorkspaceInfo[];
  }>;
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
  onUpdateWorkspaceCodexBin: (id: string, codexBin: string | null) => Promise<void>;
  onUpdateWorkspaceSettings: (
    id: string,
    settings: Partial<WorkspaceSettings>,
  ) => Promise<void>;
  scaleShortcutTitle: string;
  scaleShortcutText: string;
  onTestNotificationSound: () => void;
  dictationModelStatus?: DictationModelStatus | null;
  onDownloadDictationModel?: () => void;
  onCancelDictationDownload?: () => void;
  onRemoveDictationModel?: () => void;
  initialSection?: CodexSection;
  initialHighlightTarget?: "experimental-collaboration-modes";
};

type SettingsSection =
  | "projects"
  | "display"
  | "agents"
  | "composer"
  | "dictation"
  | "shortcuts"
  | "open-apps"
  | "git"
  | "vendors";
type CodexSection = SettingsSection | "codex" | "experimental" | "about";
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

type OpenAppDraft = OpenAppTarget & { argsText: string };

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

const buildOpenAppDrafts = (targets: OpenAppTarget[]): OpenAppDraft[] =>
  targets.map((target) => ({
    ...target,
    argsText: target.args.join(" "),
  }));

const createOpenAppId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `open-app-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export function SettingsView({
  workspaceGroups,
  groupedWorkspaces,
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
  onToggleTransparency,
  appSettings,
  openAppIconById,
  onUpdateAppSettings,
  onRunDoctor,
  onUpdateWorkspaceCodexBin,
  onUpdateWorkspaceSettings,
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
  const [activeSection, setActiveSection] = useState<CodexSection>("vendors");
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [codexPathDraft, setCodexPathDraft] = useState(appSettings.codexBin ?? "");
  const [codexArgsDraft, setCodexArgsDraft] = useState(appSettings.codexArgs ?? "");
  const [remoteHostDraft, setRemoteHostDraft] = useState(appSettings.remoteBackendHost);
  const [remoteTokenDraft, setRemoteTokenDraft] = useState(appSettings.remoteBackendToken ?? "");
  const [scaleDraft, setScaleDraft] = useState(
    `${Math.round(clampUiScale(appSettings.uiScale) * 100)}%`,
  );
  const [uiFontDraft, setUiFontDraft] = useState(appSettings.uiFontFamily);
  const [codeFontDraft, setCodeFontDraft] = useState(appSettings.codeFontFamily);
  const [codeFontSizeDraft, setCodeFontSizeDraft] = useState(appSettings.codeFontSize);
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
    setScaleDraft(`${Math.round(clampUiScale(appSettings.uiScale) * 100)}%`);
  }, [appSettings.uiScale]);

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
      setActiveSection(initialSection);
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

  const trimmedScale = scaleDraft.trim();
  const parsedPercent = trimmedScale
    ? Number(trimmedScale.replace("%", ""))
    : Number.NaN;
  const parsedScale = Number.isFinite(parsedPercent) ? parsedPercent / 100 : null;

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

  const handleCommitScale = async () => {
    if (parsedScale === null) {
      setScaleDraft(`${Math.round(clampUiScale(appSettings.uiScale) * 100)}%`);
      return;
    }
    const nextScale = clampUiScale(parsedScale);
    setScaleDraft(`${Math.round(nextScale * 100)}%`);
    if (nextScale === appSettings.uiScale) {
      return;
    }
    await onUpdateAppSettings({
      ...appSettings,
      uiScale: nextScale,
    });
  };

  const handleResetScale = async () => {
    if (appSettings.uiScale === 1) {
      setScaleDraft("100%");
      return;
    }
    setScaleDraft("100%");
    await onUpdateAppSettings({
      ...appSettings,
      uiScale: 1,
    });
  };

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
      <div className="settings-header">
        <div className="settings-title">{t("settings.title")}</div>
      </div>
      <div className="settings-body">
        <aside className="settings-sidebar">
            <button
              type="button"
              className="settings-nav settings-nav-return"
              onClick={onClose}
              aria-label={t("settings.backToApp")}
            >
              <ArrowLeft aria-hidden />
              {t("settings.backToApp")}
            </button>
            <button
              type="button"
              className={`settings-nav ${activeSection === "vendors" ? "active" : ""}`}
              onClick={() => setActiveSection("vendors")}
            >
              <Store aria-hidden />
              {t("settings.sidebarVendors")}
            </button>
            <button
              type="button"
              className={`settings-nav ${activeSection === "projects" ? "active" : ""}`}
              onClick={() => setActiveSection("projects")}
            >
              <LayoutGrid aria-hidden />
              {t("settings.sidebarProjects")}
            </button>
            <button
              type="button"
              className={`settings-nav ${activeSection === "display" ? "active" : ""}`}
              onClick={() => setActiveSection("display")}
            >
              <SlidersHorizontal aria-hidden />
              {t("settings.sidebarDisplay")}
            </button>
            <button
              type="button"
              className={`settings-nav ${activeSection === "composer" ? "active" : ""}`}
              onClick={() => setActiveSection("composer")}
            >
              <FileText aria-hidden />
              {t("settings.sidebarComposer")}
            </button>
            <button
              type="button"
              className={`settings-nav ${activeSection === "agents" ? "active" : ""}`}
              onClick={() => setActiveSection("agents")}
            >
              <span className="codicon codicon-robot" />
              {t("settings.sidebarAgents")}
            </button>
            {SHOW_DICTATION_ENTRY && (
              <button
                type="button"
                className={`settings-nav ${activeSection === "dictation" ? "active" : ""}`}
                onClick={() => setActiveSection("dictation")}
              >
                <Mic aria-hidden />
                {t("settings.sidebarDictation")}
              </button>
            )}
            <button
              type="button"
              className={`settings-nav ${activeSection === "shortcuts" ? "active" : ""}`}
              onClick={() => setActiveSection("shortcuts")}
            >
              <Keyboard aria-hidden />
              {t("settings.sidebarShortcuts")}
            </button>
            <button
              type="button"
              className={`settings-nav ${activeSection === "open-apps" ? "active" : ""}`}
              onClick={() => setActiveSection("open-apps")}
            >
              <ExternalLink aria-hidden />
              {t("settings.sidebarOpenIn")}
            </button>
            {SHOW_GIT_ENTRY && (
              <button
                type="button"
                className={`settings-nav ${activeSection === "git" ? "active" : ""}`}
                onClick={() => setActiveSection("git")}
              >
                <GitBranch aria-hidden />
                {t("settings.sidebarGit")}
              </button>
            )}
            {SHOW_CODEX_AND_EXPERIMENTAL && (
              <>
                <button
                  type="button"
                  className={`settings-nav ${activeSection === "codex" ? "active" : ""}`}
                  onClick={() => setActiveSection("codex")}
                >
                  <TerminalSquare aria-hidden />
                  {t("settings.sidebarCodex")}
                </button>
                <button
                  type="button"
                  className={`settings-nav ${activeSection === "experimental" ? "active" : ""}`}
                  onClick={() => setActiveSection("experimental")}
                >
                  <FlaskConical aria-hidden />
                  {t("settings.sidebarExperimental")}
                </button>
              </>
            )}
            <button
              type="button"
              className={`settings-nav ${activeSection === "about" ? "active" : ""}`}
              onClick={() => setActiveSection("about")}
            >
              <Info aria-hidden />
              {t("settings.sidebarAbout")}
            </button>
          </aside>
          <ScrollArea className="settings-content">
            {activeSection === "projects" && (
              <section className="settings-section">
                <div className="settings-section-title">{t("settings.projectsTitle")}</div>
                <div className="settings-section-subtitle">
                  {t("settings.projectsDescription")}
                </div>
                <div className="settings-subsection-header">
                  <div className="settings-subsection-title">{t("settings.groupsTitle")}</div>
                  <Popover open={createGroupOpen} onOpenChange={setCreateGroupOpen}>
                    <PopoverTrigger asChild>
                      <button
                        className="ghost icon-button"
                        aria-label={t("settings.addGroupButton")}
                      >
                        <Plus aria-hidden />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="p-3">
                      <div className="settings-popover-content">
                        <div className="settings-field-label">
                          {t("settings.newGroupPlaceholder")}
                        </div>
                        <input
                          className="settings-input settings-input--compact"
                          value={newGroupName}
                          autoFocus
                          placeholder={t("settings.newGroupPlaceholder")}
                          onChange={(event) => setNewGroupName(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" && canCreateGroup) {
                              event.preventDefault();
                              void handleCreateGroup();
                            }
                          }}
                        />
                        <div className="settings-popover-actions">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setCreateGroupOpen(false)}
                          >
                            {t("common.cancel")}
                          </Button>
                          <Button
                            size="sm"
                            disabled={!canCreateGroup}
                            onClick={() => {
                              void handleCreateGroup();
                            }}
                          >
                            {t("common.create")}
                          </Button>
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="settings-subsection-subtitle">
                  {t("settings.groupsDescription")}
                </div>
                <div className="settings-groups">
                  {groupError && <div className="settings-group-error">{groupError}</div>}
                  {workspaceGroups.length > 0 ? (
                    <DragDropContext onDragEnd={handleDragEnd}>
                      <Droppable droppableId="settings-group-list">
                        {(provided) => (
                          <div
                            className="settings-group-list"
                            {...provided.droppableProps}
                            ref={provided.innerRef}
                          >
                            {workspaceGroups.map((group, index) => (
                              <Draggable
                                key={group.id}
                                draggableId={group.id}
                                index={index}
                              >
                                {(provided, snapshot) => (
                                  <div
                                    ref={provided.innerRef}
                                    {...provided.draggableProps}
                                    className={`settings-group-row ${
                                      snapshot.isDragging ? "is-dragging" : ""
                                    }`}
                                    style={provided.draggableProps.style}
                                  >
                                    <span
                                      className="settings-group-drag-handle"
                                      {...provided.dragHandleProps}
                                    >
                                      <GripVertical aria-hidden />
                                    </span>

                                    <div className="settings-group-name">
                                      {renamingGroupId === group.id ? (
                                        <input
                                          className="settings-input settings-input--compact"
                                          value={groupDrafts[group.id] ?? group.name}
                                          autoFocus
                                          onChange={(event) =>
                                            setGroupDrafts((prev) => ({
                                              ...prev,
                                              [group.id]: event.target.value,
                                            }))
                                          }
                                          onBlur={() => {
                                            void handleRenameGroup(group);
                                            setRenamingGroupId(null);
                                          }}
                                          onKeyDown={(event) => {
                                            if (event.key === "Enter") {
                                              event.preventDefault();
                                              void handleRenameGroup(group);
                                              setRenamingGroupId(null);
                                            }
                                            if (event.key === "Escape") {
                                              setGroupDrafts((prev) => ({
                                                ...prev,
                                                [group.id]: group.name,
                                              }));
                                              setRenamingGroupId(null);
                                            }
                                          }}
                                        />
                                      ) : (
                                        <span
                                          className="settings-group-name-text"
                                          onDoubleClick={() => setRenamingGroupId(group.id)}
                                        >
                                          {group.name}
                                        </span>
                                      )}
                                    </div>

                                    {group.copiesFolder && (
                                      <TooltipProvider>
                                        <Tooltip>
                                          <TooltipTrigger>
                                            <span className="settings-group-folder-indicator">
                                              <FolderOpen aria-hidden />
                                            </span>
                                          </TooltipTrigger>
                                          <TooltipContent side="top">
                                            <p>{group.copiesFolder}</p>
                                          </TooltipContent>
                                        </Tooltip>
                                      </TooltipProvider>
                                    )}

                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <button
                                          type="button"
                                          className="ghost icon-button"
                                          aria-label={t("settings.groupMoreActions")}
                                        >
                                          <MoreHorizontal aria-hidden />
                                        </button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end" className="w-48">
                                        <DropdownMenuItem
                                          onSelect={() => setRenamingGroupId(group.id)}
                                        >
                                          <Pencil aria-hidden />
                                          {t("settings.renameGroup")}
                                        </DropdownMenuItem>

                                        <DropdownMenuSeparator />

                                        <DropdownMenuSub>
                                          <DropdownMenuSubTrigger>
                                            <FolderOpen aria-hidden />
                                            {t("settings.copiesFolder")}
                                          </DropdownMenuSubTrigger>
                                          <DropdownMenuSubContent>
                                            <DropdownMenuItem
                                              onSelect={() => {
                                                void handleChooseGroupCopiesFolder(group);
                                              }}
                                            >
                                              {t("settings.chooseEllipsis")}
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                              onSelect={() => {
                                                void handleClearGroupCopiesFolder(group);
                                              }}
                                              disabled={!group.copiesFolder}
                                            >
                                              {t("settings.clear")}
                                            </DropdownMenuItem>
                                          </DropdownMenuSubContent>
                                        </DropdownMenuSub>

                                        <DropdownMenuSeparator />

                                        <DropdownMenuItem
                                          variant="destructive"
                                          onSelect={() => {
                                            void handleDeleteGroup(group);
                                          }}
                                        >
                                          <Trash2 aria-hidden />
                                          {t("settings.deleteGroupAction")}
                                        </DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  </div>
                                )}
                              </Draggable>
                            ))}
                            {provided.placeholder}
                          </div>
                        )}
                      </Droppable>
                    </DragDropContext>
                  ) : (
                    <div className="settings-empty">{t("settings.noGroupsYet")}</div>
                  )}
                </div>
                <div className="settings-subsection-title">{t("settings.projectsSubsectionTitle")}</div>
                <div className="settings-subsection-subtitle">
                  {t("settings.projectsSubsectionDescription")}
                </div>
                <div className="settings-projects">
                  {groupedWorkspaces.map((group) => (
                    <div key={group.id ?? "ungrouped"} className="settings-project-group">
                      <div className="settings-project-group-label">{group.name}</div>
                      {group.workspaces.map((workspace, index) => {
                        const groupValue =
                          workspaceGroups.some(
                            (entry) => entry.id === workspace.settings.groupId,
                          )
                            ? workspace.settings.groupId ?? ""
                            : "";
                        return (
                          <div key={workspace.id} className="settings-project-row">
                            <div className="settings-project-info">
                              <div className="settings-project-name">{workspace.name}</div>
                              <div className="settings-project-path">{workspace.path}</div>
                            </div>
                            <div className="settings-project-actions">
                              <select
                                className="settings-select settings-select--compact"
                                value={groupValue}
                                onChange={(event) => {
                                  const nextGroupId = event.target.value || null;
                                  void onAssignWorkspaceGroup(
                                    workspace.id,
                                    nextGroupId,
                                  );
                                }}
                              >
                                <option value="">{ungroupedLabel}</option>
                                {workspaceGroups.map((entry) => (
                                  <option key={entry.id} value={entry.id}>
                                    {entry.name}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                className="ghost icon-button"
                                onClick={() => onMoveWorkspace(workspace.id, "up")}
                                disabled={index === 0}
                                aria-label={t("settings.moveProjectUp")}
                              >
                                <ChevronUp aria-hidden />
                              </button>
                              <button
                                type="button"
                                className="ghost icon-button"
                                onClick={() => onMoveWorkspace(workspace.id, "down")}
                                disabled={index === group.workspaces.length - 1}
                                aria-label={t("settings.moveProjectDown")}
                              >
                                <ChevronDown aria-hidden />
                              </button>
                              <button
                                type="button"
                                className="ghost icon-button"
                                onClick={() => onDeleteWorkspace(workspace.id)}
                                aria-label={t("settings.deleteProject")}
                              >
                                <Trash2 aria-hidden />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                  {projects.length === 0 && (
                    <div className="settings-empty">{t("settings.noProjectsYet")}</div>
                  )}
                </div>
              </section>
            )}
            {activeSection === "display" && (
              <section className="settings-section">
                <div className="settings-section-title">{t("settings.displayTitle")}</div>
                <div className="settings-section-subtitle">
                  {t("settings.displayDescription")}
                </div>
                <div className="settings-subsection-title">{t("settings.displaySubtitle")}</div>
                <div className="settings-subsection-subtitle">
                  {t("settings.displaySubDescription")}
                </div>
                <div className="settings-field">
                  <label className="settings-field-label" htmlFor="theme-select">
                    {t("settings.theme")}
                  </label>
                  <div className="flex items-center gap-3">
                    <Button
                      variant="outline"
                      className={`w-32 border ${
                        appSettings.theme === "system" ? "border-primary border-2" : ""
                      }`}
                      onClick={() =>
                        void onUpdateAppSettings({
                          ...appSettings,
                          theme: "system",
                        })
                      }
                    >
                      <Monitor className="mr-2 h-4 w-4" />
                      {t("settings.themeSystem")}
                    </Button>
                    <Button
                      variant="outline"
                      className={`w-32 border ${
                        appSettings.theme === "light" ? "border-primary border-2" : ""
                      }`}
                      onClick={() =>
                        void onUpdateAppSettings({
                          ...appSettings,
                          theme: "light",
                        })
                      }
                    >
                      <Sun className="mr-2 h-4 w-4" />
                      {t("settings.themeLight")}
                    </Button>
                    <Button
                      variant="outline"
                      className={`w-32 border ${
                        appSettings.theme === "dark" ? "border-primary border-2" : ""
                      }`}
                      onClick={() =>
                        void onUpdateAppSettings({
                          ...appSettings,
                          theme: "dark",
                        })
                      }
                    >
                      <Moon className="mr-2 h-4 w-4" />
                      {t("settings.themeDark")}
                    </Button>
                  </div>
                </div>
                <LanguageSelector />
                <div className="settings-toggle-row">
                  <div>
                    <div className="settings-toggle-title">
                      {t("settings.showRemainingLimits")}
                    </div>
                    <div className="settings-toggle-subtitle">
                      {t("settings.showRemainingLimitsDesc")}
                    </div>
                  </div>
                  <Switch
                    checked={appSettings.usageShowRemaining}
                    onCheckedChange={(checked) =>
                      void onUpdateAppSettings({
                        ...appSettings,
                        usageShowRemaining: checked,
                      })
                    }
                  />
                </div>
                <div className="settings-toggle-row">
                  <div>
                    <div className="settings-toggle-title">
                      {t("settings.showMessageAnchors")}
                    </div>
                    <div className="settings-toggle-subtitle">
                      {t("settings.showMessageAnchorsDesc")}
                    </div>
                  </div>
                  <Switch
                    checked={appSettings.showMessageAnchors}
                    onCheckedChange={(checked) =>
                      void onUpdateAppSettings({
                        ...appSettings,
                        showMessageAnchors: checked,
                      })
                    }
                  />
                </div>
                <div className="settings-toggle-row">
                  <div>
                    <div className="settings-toggle-title">{t("settings.reduceTransparency")}</div>
                    <div className="settings-toggle-subtitle">
                      {t("settings.reduceTransparencyDesc")}
                    </div>
                  </div>
                  <Switch
                    checked={reduceTransparency}
                    onCheckedChange={(checked) => onToggleTransparency(checked)}
                  />
                </div>
                <div className="settings-toggle-row settings-scale-row">
                  <div>
                    <div className="settings-toggle-title">{t("settings.interfaceScale")}</div>
                    <div
                      className="settings-toggle-subtitle"
                      title={scaleShortcutTitle}
                    >
                      {scaleShortcutText}
                    </div>
                  </div>
                  <div className="settings-scale-controls">
                    <input
                      id="ui-scale"
                      type="text"
                      inputMode="decimal"
                      className="settings-input settings-input--scale"
                      value={scaleDraft}
                      aria-label={t("settings.interfaceScaleAriaLabel")}
                      onChange={(event) => setScaleDraft(event.target.value)}
                      onBlur={() => {
                        void handleCommitScale();
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void handleCommitScale();
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="ghost settings-scale-reset"
                      onClick={() => {
                        void handleResetScale();
                      }}
                    >
                      {t("settings.reset")}
                    </button>
                  </div>
                </div>
                <div className="settings-field">
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
                <div className="settings-field">
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
                <div className="settings-field">
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
                <div className="settings-subsection-title">{t("settings.soundsSubtitle")}</div>
                <div className="settings-subsection-subtitle">
                  {t("settings.soundsSubDescription")}
                </div>
                <div className="settings-toggle-row">
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
                <div className="settings-sound-actions">
                  <button
                    type="button"
                    className="ghost settings-button-compact"
                    onClick={onTestNotificationSound}
                  >
                    {t("settings.test")}
                  </button>
                </div>
                <div className="settings-toggle-row">
                  <div>
                    <div className="settings-toggle-title">{t("settings.systemNotification")}</div>
                    <div className="settings-toggle-subtitle">
                      {t("settings.systemNotificationDesc")}
                    </div>
                  </div>
                  <Switch
                    checked={appSettings.systemNotificationEnabled}
                    onCheckedChange={(checked) =>
                      void onUpdateAppSettings({
                        ...appSettings,
                        systemNotificationEnabled: checked,
                      })
                    }
                  />
                </div>
              </section>
            )}
            {activeSection === "composer" && (
              <section className="settings-section">
                <div className="settings-section-title">{t("settings.composerTitle")}</div>
                <div className="settings-section-subtitle">
                  {t("settings.composerDescription")}
                </div>
                <div className="settings-subsection-title">{t("settings.sendShortcutSubtitle")}</div>
                <div className="settings-subsection-subtitle">
                  {t("settings.sendShortcutSubDescription")}
                </div>
                <div
                  className="settings-send-shortcut-grid"
                  role="radiogroup"
                  aria-label={t("settings.sendShortcutSubtitle")}
                >
                  <button
                    type="button"
                    role="radio"
                    aria-checked={appSettings.composerSendShortcut === "enter"}
                    className={`settings-send-shortcut-option${
                      appSettings.composerSendShortcut === "enter" ? " is-active" : ""
                    }`}
                    onClick={() => handleComposerSendShortcutChange("enter")}
                  >
                    <div className="settings-send-shortcut-option-title-row">
                      <span className="settings-send-shortcut-option-title">
                        {t("settings.sendShortcutEnterTitle")}
                      </span>
                      {appSettings.composerSendShortcut === "enter" && (
                        <span className="settings-send-shortcut-option-check" aria-hidden>
                          ✓
                        </span>
                      )}
                    </div>
                    <span className="settings-send-shortcut-option-desc">
                      {t("settings.sendShortcutEnterDesc")}
                    </span>
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={appSettings.composerSendShortcut === "cmdEnter"}
                    className={`settings-send-shortcut-option${
                      appSettings.composerSendShortcut === "cmdEnter" ? " is-active" : ""
                    }`}
                    onClick={() => handleComposerSendShortcutChange("cmdEnter")}
                  >
                    <div className="settings-send-shortcut-option-title-row">
                      <span className="settings-send-shortcut-option-title">
                        {t("settings.sendShortcutCmdEnterTitle")}
                      </span>
                      {appSettings.composerSendShortcut === "cmdEnter" && (
                        <span className="settings-send-shortcut-option-check" aria-hidden>
                          ✓
                        </span>
                      )}
                    </div>
                    <span className="settings-send-shortcut-option-desc">
                      {t("settings.sendShortcutCmdEnterDesc")}
                    </span>
                  </button>
                </div>
                <Separator className="my-4" />
                <div className="settings-subsection-title">{t("settings.presetsSubtitle")}</div>
                <div className="settings-subsection-subtitle">
                  {t("settings.presetsSubDescription")}
                </div>
                <div className="settings-field">
                  <label className="settings-field-label" htmlFor="composer-preset">
                    {t("settings.preset")}
                  </label>
                  <select
                    id="composer-preset"
                    className="settings-select"
                    value={appSettings.composerEditorPreset}
                    onChange={(event) =>
                      handleComposerPresetChange(
                        event.target.value as ComposerPreset,
                      )
                    }
                  >
                    {Object.entries(COMPOSER_PRESET_LABELS(t)).map(([preset, label]) => (
                      <option key={preset} value={preset}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <div className="settings-help">
                    {t("settings.presetDesc")}
                  </div>
                </div>
                <Separator className="my-4" />
                <div className="settings-subsection-title">{t("settings.codeFencesSubtitle")}</div>
                <div className="settings-toggle-row">
                  <div>
                    <div className="settings-toggle-title">{t("settings.expandFencesOnSpace")}</div>
                    <div className="settings-toggle-subtitle">
                      {t("settings.expandFencesOnSpaceDesc")}
                    </div>
                  </div>
                  <Switch
                    checked={appSettings.composerFenceExpandOnSpace}
                    onCheckedChange={(checked) =>
                      void onUpdateAppSettings({
                        ...appSettings,
                        composerFenceExpandOnSpace: checked,
                      })
                    }
                  />
                </div>
                <div className="settings-toggle-row">
                  <div>
                    <div className="settings-toggle-title">{t("settings.expandFencesOnEnter")}</div>
                    <div className="settings-toggle-subtitle">
                      {t("settings.expandFencesOnEnterDesc")}
                    </div>
                  </div>
                  <Switch
                    checked={appSettings.composerFenceExpandOnEnter}
                    onCheckedChange={(checked) =>
                      void onUpdateAppSettings({
                        ...appSettings,
                        composerFenceExpandOnEnter: checked,
                      })
                    }
                  />
                </div>
                <div className="settings-toggle-row">
                  <div>
                    <div className="settings-toggle-title">{t("settings.supportLanguageTags")}</div>
                    <div className="settings-toggle-subtitle">
                      {t("settings.supportLanguageTagsDesc")}
                    </div>
                  </div>
                  <Switch
                    checked={appSettings.composerFenceLanguageTags}
                    onCheckedChange={(checked) =>
                      void onUpdateAppSettings({
                        ...appSettings,
                        composerFenceLanguageTags: checked,
                      })
                    }
                  />
                </div>
                <div className="settings-toggle-row">
                  <div>
                    <div className="settings-toggle-title">{t("settings.wrapSelectionInFences")}</div>
                    <div className="settings-toggle-subtitle">
                      {t("settings.wrapSelectionInFencesDesc")}
                    </div>
                  </div>
                  <Switch
                    checked={appSettings.composerFenceWrapSelection}
                    onCheckedChange={(checked) =>
                      void onUpdateAppSettings({
                        ...appSettings,
                        composerFenceWrapSelection: checked,
                      })
                    }
                  />
                </div>
                <div className="settings-toggle-row">
                  <div>
                    <div className="settings-toggle-title">{t("settings.copyBlocksWithoutFences")}</div>
                    <div className="settings-toggle-subtitle">
                      {t("settings.copyBlocksWithoutFencesDesc")}
                    </div>
                  </div>
                  <Switch
                    checked={appSettings.composerCodeBlockCopyUseModifier}
                    onCheckedChange={(checked) =>
                      void onUpdateAppSettings({
                        ...appSettings,
                        composerCodeBlockCopyUseModifier: checked,
                      })
                    }
                  />
                </div>
                <Separator className="my-4" />
                <div className="settings-subsection-title">{t("settings.pastingSubtitle")}</div>
                <div className="settings-toggle-row">
                  <div>
                    <div className="settings-toggle-title">{t("settings.autoWrapMultiLinePaste")}</div>
                    <div className="settings-toggle-subtitle">
                      {t("settings.autoWrapMultiLinePasteDesc")}
                    </div>
                  </div>
                  <Switch
                    checked={appSettings.composerFenceAutoWrapPasteMultiline}
                    onCheckedChange={(checked) =>
                      void onUpdateAppSettings({
                        ...appSettings,
                        composerFenceAutoWrapPasteMultiline: checked,
                      })
                    }
                  />
                </div>
                <div className="settings-toggle-row">
                  <div>
                    <div className="settings-toggle-title">{t("settings.autoWrapCodeLikeSingleLines")}</div>
                    <div className="settings-toggle-subtitle">
                      {t("settings.autoWrapCodeLikeSingleLinesDesc")}
                    </div>
                  </div>
                  <Switch
                    checked={appSettings.composerFenceAutoWrapPasteCodeLike}
                    onCheckedChange={(checked) =>
                      void onUpdateAppSettings({
                        ...appSettings,
                        composerFenceAutoWrapPasteCodeLike: checked,
                      })
                    }
                  />
                </div>
                <Separator className="my-4" />
                <div className="settings-subsection-title">{t("settings.listsSubtitle")}</div>
                <div className="settings-toggle-row">
                  <div>
                    <div className="settings-toggle-title">{t("settings.continueListsOnShiftEnter")}</div>
                    <div className="settings-toggle-subtitle">
                      {t("settings.continueListsOnShiftEnterDesc")}
                    </div>
                  </div>
                  <Switch
                    checked={appSettings.composerListContinuation}
                    onCheckedChange={(checked) =>
                      void onUpdateAppSettings({
                        ...appSettings,
                        composerListContinuation: checked,
                      })
                    }
                  />
                </div>
                <Separator className="my-4" />
                <div className="settings-subsection-title">{t("settings.historyCompletionSubtitle")}</div>
                <div className="settings-toggle-row">
                  <div>
                    <div className="settings-toggle-title">{t("settings.historyCompletion")}</div>
                    <div className="settings-toggle-subtitle">
                      {t("settings.historyCompletionDesc")}
                    </div>
                  </div>
                  <Switch
                    checked={historyCompletionEnabled}
                    onCheckedChange={handleHistoryCompletionToggle}
                  />
                </div>
                <HistoryCompletionSettings />
                <Separator className="my-4" />
                <ModelMappingSettings reduceTransparency={reduceTransparency} />
              </section>
            )}
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
            {activeSection === "shortcuts" && (
              <section className="settings-section">
                <div className="settings-section-title">{t("settings.shortcutsTitle")}</div>
                <div className="settings-section-subtitle">
                  {t("settings.shortcutsDescription")}
                </div>
                <div className="settings-subsection-title">{t("settings.fileSubtitle")}</div>
                <div className="settings-subsection-subtitle">
                  {t("settings.fileSubDescription")}
                </div>
                <div className="settings-field">
                  <div className="settings-field-label">{t("settings.newAgent")}</div>
                  <div className="settings-field-row">
                    <input
                      className="settings-input settings-input--shortcut"
                      value={formatShortcut(shortcutDrafts.newAgent)}
                      onKeyDown={(event) =>
                        handleShortcutKeyDown(event, "newAgentShortcut")
                      }
                      placeholder={t("settings.typeShortcut")}
                      readOnly
                    />
                    <button
                      type="button"
                      className="ghost settings-button-compact"
                      onClick={() => void updateShortcut("newAgentShortcut", null)}
                    >
                      {t("settings.clear")}
                    </button>
                  </div>
                  <div className="settings-help">
                    {t("settings.defaultColon")} {formatShortcut("cmd+n")}
                  </div>
                </div>
                <div className="settings-field">
                  <div className="settings-field-label">{t("settings.newWorktreeAgent")}</div>
                  <div className="settings-field-row">
                    <input
                      className="settings-input settings-input--shortcut"
                      value={formatShortcut(shortcutDrafts.newWorktreeAgent)}
                      onKeyDown={(event) =>
                        handleShortcutKeyDown(event, "newWorktreeAgentShortcut")
                      }
                      placeholder={t("settings.typeShortcut")}
                      readOnly
                    />
                    <button
                      type="button"
                      className="ghost settings-button-compact"
                      onClick={() => void updateShortcut("newWorktreeAgentShortcut", null)}
                    >
                      {t("settings.clear")}
                    </button>
                  </div>
                  <div className="settings-help">
                    {t("settings.defaultColon")} {formatShortcut("cmd+shift+n")}
                  </div>
                </div>
                <div className="settings-field">
                  <div className="settings-field-label">{t("settings.newCloneAgent")}</div>
                  <div className="settings-field-row">
                    <input
                      className="settings-input settings-input--shortcut"
                      value={formatShortcut(shortcutDrafts.newCloneAgent)}
                      onKeyDown={(event) =>
                        handleShortcutKeyDown(event, "newCloneAgentShortcut")
                      }
                      placeholder={t("settings.typeShortcut")}
                      readOnly
                    />
                    <button
                      type="button"
                      className="ghost settings-button-compact"
                      onClick={() => void updateShortcut("newCloneAgentShortcut", null)}
                    >
                      {t("settings.clear")}
                    </button>
                  </div>
                  <div className="settings-help">
                    {t("settings.defaultColon")} {formatShortcut("cmd+alt+n")}
                  </div>
                </div>
                <div className="settings-field">
                  <div className="settings-field-label">{t("settings.archiveActiveThread")}</div>
                  <div className="settings-field-row">
                    <input
                      className="settings-input settings-input--shortcut"
                      value={formatShortcut(shortcutDrafts.archiveThread)}
                      onKeyDown={(event) =>
                        handleShortcutKeyDown(event, "archiveThreadShortcut")
                      }
                      placeholder={t("settings.typeShortcut")}
                      readOnly
                    />
                    <button
                      type="button"
                      className="ghost settings-button-compact"
                      onClick={() => void updateShortcut("archiveThreadShortcut", null)}
                    >
                      {t("settings.clear")}
                    </button>
                  </div>
                  <div className="settings-help">
                    {t("settings.defaultColon")} {formatShortcut("cmd+ctrl+a")}
                  </div>
                </div>
                <Separator className="my-4" />
                <div className="settings-subsection-title">{t("settings.composerSubtitle")}</div>
                <div className="settings-subsection-subtitle">
                  {t("settings.composerSubDescription")}
                </div>
                <div className="settings-field">
                  <div className="settings-field-label">{t("settings.cycleModel")}</div>
                  <div className="settings-field-row">
                    <input
                      className="settings-input settings-input--shortcut"
                      value={formatShortcut(shortcutDrafts.model)}
                      onKeyDown={(event) =>
                        handleShortcutKeyDown(event, "composerModelShortcut")
                      }
                      placeholder={t("settings.typeShortcut")}
                      readOnly
                    />
                    <button
                      type="button"
                      className="ghost settings-button-compact"
                      onClick={() => void updateShortcut("composerModelShortcut", null)}
                    >
                      {t("settings.clear")}
                    </button>
                  </div>
                  <div className="settings-help">
                    {t("settings.pressNewShortcut")} {formatShortcut("cmd+shift+m")}
                  </div>
                </div>
                <div className="settings-field">
                  <div className="settings-field-label">{t("settings.cycleAccessMode")}</div>
                  <div className="settings-field-row">
                    <input
                      className="settings-input settings-input--shortcut"
                      value={formatShortcut(shortcutDrafts.access)}
                      onKeyDown={(event) =>
                        handleShortcutKeyDown(event, "composerAccessShortcut")
                      }
                      placeholder={t("settings.typeShortcut")}
                      readOnly
                    />
                    <button
                      type="button"
                      className="ghost settings-button-compact"
                      onClick={() => void updateShortcut("composerAccessShortcut", null)}
                    >
                      {t("settings.clear")}
                    </button>
                  </div>
                  <div className="settings-help">
                    {t("settings.defaultColon")} {formatShortcut("cmd+shift+a")}
                  </div>
                </div>
                <div className="settings-field">
                  <div className="settings-field-label">{t("settings.cycleReasoningMode")}</div>
                  <div className="settings-field-row">
                    <input
                      className="settings-input settings-input--shortcut"
                      value={formatShortcut(shortcutDrafts.reasoning)}
                      onKeyDown={(event) =>
                        handleShortcutKeyDown(event, "composerReasoningShortcut")
                      }
                      placeholder={t("settings.typeShortcut")}
                      readOnly
                    />
                    <button
                      type="button"
                      className="ghost settings-button-compact"
                      onClick={() => void updateShortcut("composerReasoningShortcut", null)}
                    >
                      {t("settings.clear")}
                    </button>
                  </div>
                  <div className="settings-help">
                    {t("settings.defaultColon")} {formatShortcut("cmd+shift+r")}
                  </div>
                </div>
                <div className="settings-field">
                  <div className="settings-field-label">{t("settings.cycleCollaborationMode")}</div>
                  <div className="settings-field-row">
                    <input
                      className="settings-input settings-input--shortcut"
                      value={formatShortcut(shortcutDrafts.collaboration)}
                      onKeyDown={(event) =>
                        handleShortcutKeyDown(event, "composerCollaborationShortcut")
                      }
                      placeholder={t("settings.typeShortcut")}
                      readOnly
                    />
                    <button
                      type="button"
                      className="ghost settings-button-compact"
                      onClick={() => void updateShortcut("composerCollaborationShortcut", null)}
                    >
                      {t("settings.clear")}
                    </button>
                  </div>
                  <div className="settings-help">
                    {t("settings.defaultColon")} {formatShortcut("shift+tab")}
                  </div>
                </div>
                <div className="settings-field">
                  <div className="settings-field-label">{t("settings.stopActiveRun")}</div>
                  <div className="settings-field-row">
                    <input
                      className="settings-input settings-input--shortcut"
                      value={formatShortcut(shortcutDrafts.interrupt)}
                      onKeyDown={(event) =>
                        handleShortcutKeyDown(event, "interruptShortcut")
                      }
                      placeholder={t("settings.typeShortcut")}
                      readOnly
                    />
                    <button
                      type="button"
                      className="ghost settings-button-compact"
                      onClick={() => void updateShortcut("interruptShortcut", null)}
                    >
                      {t("settings.clear")}
                    </button>
                  </div>
                  <div className="settings-help">
                    {t("settings.defaultColon")} {formatShortcut(getDefaultInterruptShortcut())}
                  </div>
                </div>
                <Separator className="my-4" />
                <div className="settings-subsection-title">{t("settings.panelsSubtitle")}</div>
                <div className="settings-subsection-subtitle">
                  {t("settings.panelsSubDescription")}
                </div>
                <div className="settings-field">
                  <div className="settings-field-label">{t("settings.toggleProjectsSidebar")}</div>
                  <div className="settings-field-row">
                    <input
                      className="settings-input settings-input--shortcut"
                      value={formatShortcut(shortcutDrafts.projectsSidebar)}
                      onKeyDown={(event) =>
                        handleShortcutKeyDown(event, "toggleProjectsSidebarShortcut")
                      }
                      placeholder={t("settings.typeShortcut")}
                      readOnly
                    />
                    <button
                      type="button"
                      className="ghost settings-button-compact"
                      onClick={() => void updateShortcut("toggleProjectsSidebarShortcut", null)}
                    >
                      {t("settings.clear")}
                    </button>
                  </div>
                  <div className="settings-help">
                    {t("settings.defaultColon")} {formatShortcut("cmd+shift+p")}
                  </div>
                </div>
                <div className="settings-field">
                  <div className="settings-field-label">{t("settings.toggleGitSidebar")}</div>
                  <div className="settings-field-row">
                    <input
                      className="settings-input settings-input--shortcut"
                      value={formatShortcut(shortcutDrafts.gitSidebar)}
                      onKeyDown={(event) =>
                        handleShortcutKeyDown(event, "toggleGitSidebarShortcut")
                      }
                      placeholder={t("settings.typeShortcut")}
                      readOnly
                    />
                    <button
                      type="button"
                      className="ghost settings-button-compact"
                      onClick={() => void updateShortcut("toggleGitSidebarShortcut", null)}
                    >
                      {t("settings.clear")}
                    </button>
                  </div>
                  <div className="settings-help">
                    {t("settings.defaultColon")} {formatShortcut("cmd+shift+g")}
                  </div>
                </div>
                <div className="settings-field">
                  <div className="settings-field-label">{t("settings.toggleGlobalSearch")}</div>
                  <div className="settings-field-row">
                    <input
                      className="settings-input settings-input--shortcut"
                      value={formatShortcut(shortcutDrafts.globalSearch)}
                      onKeyDown={(event) =>
                        handleShortcutKeyDown(event, "toggleGlobalSearchShortcut")
                      }
                      placeholder={t("settings.typeShortcut")}
                      readOnly
                    />
                    <button
                      type="button"
                      className="ghost settings-button-compact"
                      onClick={() => void updateShortcut("toggleGlobalSearchShortcut", null)}
                    >
                      {t("settings.clear")}
                    </button>
                  </div>
                  <div className="settings-help">
                    {t("settings.defaultColon")} {formatShortcut("cmd+o")}
                  </div>
                </div>
                <div className="settings-field">
                  <div className="settings-field-label">{t("settings.toggleDebugPanel")}</div>
                  <div className="settings-field-row">
                    <input
                      className="settings-input settings-input--shortcut"
                      value={formatShortcut(shortcutDrafts.debugPanel)}
                      onKeyDown={(event) =>
                        handleShortcutKeyDown(event, "toggleDebugPanelShortcut")
                      }
                      placeholder={t("settings.typeShortcut")}
                      readOnly
                    />
                    <button
                      type="button"
                      className="ghost settings-button-compact"
                      onClick={() => void updateShortcut("toggleDebugPanelShortcut", null)}
                    >
                      {t("settings.clear")}
                    </button>
                  </div>
                  <div className="settings-help">
                    {t("settings.defaultColon")} {formatShortcut("cmd+shift+d")}
                  </div>
                </div>
                <div className="settings-field">
                  <div className="settings-field-label">{t("settings.toggleTerminalPanel")}</div>
                  <div className="settings-field-row">
                    <input
                      className="settings-input settings-input--shortcut"
                      value={formatShortcut(shortcutDrafts.terminal)}
                      onKeyDown={(event) =>
                        handleShortcutKeyDown(event, "toggleTerminalShortcut")
                      }
                      placeholder={t("settings.typeShortcut")}
                      readOnly
                    />
                    <button
                      type="button"
                      className="ghost settings-button-compact"
                      onClick={() => void updateShortcut("toggleTerminalShortcut", null)}
                    >
                      {t("settings.clear")}
                    </button>
                  </div>
                  <div className="settings-help">
                    {t("settings.defaultColon")} {formatShortcut("cmd+shift+t")}
                  </div>
                </div>
                <Separator className="my-4" />
                <div className="settings-subsection-title">{t("settings.navigationSubtitle")}</div>
                <div className="settings-subsection-subtitle">
                  {t("settings.navigationSubDescription")}
                </div>
                <div className="settings-field">
                  <div className="settings-field-label">{t("settings.nextAgent")}</div>
                  <div className="settings-field-row">
                    <input
                      className="settings-input settings-input--shortcut"
                      value={formatShortcut(shortcutDrafts.cycleAgentNext)}
                      onKeyDown={(event) =>
                        handleShortcutKeyDown(event, "cycleAgentNextShortcut")
                      }
                      placeholder={t("settings.typeShortcut")}
                      readOnly
                    />
                    <button
                      type="button"
                      className="ghost settings-button-compact"
                      onClick={() => void updateShortcut("cycleAgentNextShortcut", null)}
                    >
                      {t("settings.clear")}
                    </button>
                  </div>
                  <div className="settings-help">
                    {t("settings.defaultColon")} {formatShortcut("cmd+ctrl+down")}
                  </div>
                </div>
                <div className="settings-field">
                  <div className="settings-field-label">{t("settings.previousAgent")}</div>
                  <div className="settings-field-row">
                    <input
                      className="settings-input settings-input--shortcut"
                      value={formatShortcut(shortcutDrafts.cycleAgentPrev)}
                      onKeyDown={(event) =>
                        handleShortcutKeyDown(event, "cycleAgentPrevShortcut")
                      }
                      placeholder={t("settings.typeShortcut")}
                      readOnly
                    />
                    <button
                      type="button"
                      className="ghost settings-button-compact"
                      onClick={() => void updateShortcut("cycleAgentPrevShortcut", null)}
                    >
                      {t("settings.clear")}
                    </button>
                  </div>
                  <div className="settings-help">
                    {t("settings.defaultColon")} {formatShortcut("cmd+ctrl+up")}
                  </div>
                </div>
                <div className="settings-field">
                  <div className="settings-field-label">{t("settings.nextWorkspace")}</div>
                  <div className="settings-field-row">
                    <input
                      className="settings-input settings-input--shortcut"
                      value={formatShortcut(shortcutDrafts.cycleWorkspaceNext)}
                      onKeyDown={(event) =>
                        handleShortcutKeyDown(event, "cycleWorkspaceNextShortcut")
                      }
                      placeholder={t("settings.typeShortcut")}
                      readOnly
                    />
                    <button
                      type="button"
                      className="ghost settings-button-compact"
                      onClick={() => void updateShortcut("cycleWorkspaceNextShortcut", null)}
                    >
                      {t("settings.clear")}
                    </button>
                  </div>
                  <div className="settings-help">
                    {t("settings.defaultColon")} {formatShortcut("cmd+shift+down")}
                  </div>
                </div>
                <div className="settings-field">
                  <div className="settings-field-label">{t("settings.previousWorkspace")}</div>
                  <div className="settings-field-row">
                    <input
                      className="settings-input settings-input--shortcut"
                      value={formatShortcut(shortcutDrafts.cycleWorkspacePrev)}
                      onKeyDown={(event) =>
                        handleShortcutKeyDown(event, "cycleWorkspacePrevShortcut")
                      }
                      placeholder={t("settings.typeShortcut")}
                      readOnly
                    />
                    <button
                      type="button"
                      className="ghost settings-button-compact"
                      onClick={() => void updateShortcut("cycleWorkspacePrevShortcut", null)}
                    >
                      {t("settings.clear")}
                    </button>
                  </div>
                  <div className="settings-help">
                    {t("settings.defaultColon")} {formatShortcut("cmd+shift+up")}
                  </div>
                </div>
              </section>
            )}
            {activeSection === "open-apps" && (
              <section className="settings-section">
                <div className="settings-section-title">{t("settings.openInTitle")}</div>
                <div className="settings-section-subtitle">
                  {t("settings.openInDescription")}
                </div>
                <div className="settings-open-apps">
                  {openAppDrafts.map((target, index) => {
                    const iconSrc =
                      getKnownOpenAppIcon(target.id) ??
                      openAppIconById[target.id] ??
                      GENERIC_APP_ICON;
                    return (
                      <div key={target.id} className="settings-open-app-row">
                        <div className="settings-open-app-icon-wrap" aria-hidden>
                          <img
                            className="settings-open-app-icon"
                            src={iconSrc}
                            alt=""
                            width={18}
                            height={18}
                          />
                        </div>
                        <div className="settings-open-app-fields">
                          <label className="settings-open-app-field settings-open-app-field--label">
                            <span className="settings-visually-hidden">{t("settings.label")}</span>
                            <input
                              className="settings-input settings-input--compact settings-open-app-input settings-open-app-input--label"
                              value={target.label}
                              placeholder={t("settings.label")}
                              onChange={(event) =>
                                handleOpenAppDraftChange(index, {
                                  label: event.target.value,
                                })
                              }
                              onBlur={() => {
                                void handleCommitOpenApps(openAppDrafts);
                              }}
                              aria-label={`Open app label ${index + 1}`}
                            />
                          </label>
                          <label className="settings-open-app-field settings-open-app-field--type">
                            <span className="settings-visually-hidden">{t("settings.type")}</span>
                            <select
                              className="settings-select settings-select--compact settings-open-app-kind"
                              value={target.kind}
                              onChange={(event) =>
                                handleOpenAppKindChange(
                                  index,
                                  event.target.value as OpenAppTarget["kind"],
                                )
                              }
                              aria-label={`Open app type ${index + 1}`}
                            >
                              <option value="app">{t("settings.typeApp")}</option>
                              <option value="command">{t("settings.typeCommand")}</option>
                              <option value="finder">{t("settings.typeFinder")}</option>
                            </select>
                          </label>
                          {target.kind === "app" && (
                            <label className="settings-open-app-field settings-open-app-field--appname">
                              <span className="settings-visually-hidden">{t("settings.appName")}</span>
                              <input
                                className="settings-input settings-input--compact settings-open-app-input settings-open-app-input--appname"
                                value={target.appName ?? ""}
                                placeholder={t("settings.appName")}
                                onChange={(event) =>
                                  handleOpenAppDraftChange(index, {
                                    appName: event.target.value,
                                  })
                                }
                                onBlur={() => {
                                  void handleCommitOpenApps(openAppDrafts);
                                }}
                                aria-label={`Open app name ${index + 1}`}
                              />
                            </label>
                          )}
                          {target.kind === "command" && (
                            <label className="settings-open-app-field settings-open-app-field--command">
                              <span className="settings-visually-hidden">{t("settings.command")}</span>
                              <input
                                className="settings-input settings-input--compact settings-open-app-input settings-open-app-input--command"
                                value={target.command ?? ""}
                                placeholder={t("settings.command")}
                                onChange={(event) =>
                                  handleOpenAppDraftChange(index, {
                                    command: event.target.value,
                                  })
                                }
                                onBlur={() => {
                                  void handleCommitOpenApps(openAppDrafts);
                                }}
                                aria-label={`Open app command ${index + 1}`}
                              />
                            </label>
                          )}
                          {target.kind !== "finder" && (
                            <label className="settings-open-app-field settings-open-app-field--args">
                              <span className="settings-visually-hidden">{t("settings.args")}</span>
                              <input
                                className="settings-input settings-input--compact settings-open-app-input settings-open-app-input--args"
                                value={target.argsText}
                                placeholder={t("settings.args")}
                                onChange={(event) =>
                                  handleOpenAppDraftChange(index, {
                                    argsText: event.target.value,
                                  })
                                }
                                onBlur={() => {
                                  void handleCommitOpenApps(openAppDrafts);
                                }}
                                aria-label={`Open app args ${index + 1}`}
                              />
                            </label>
                          )}
                        </div>
                        <div className="settings-open-app-actions">
                          <label className="settings-open-app-default">
                            <input
                              type="radio"
                              name="open-app-default"
                              checked={target.id === openAppSelectedId}
                              onChange={() => handleSelectOpenAppDefault(target.id)}
                            />
                            {t("settings.defaultRadio")}
                          </label>
                          <div className="settings-open-app-order">
                            <button
                              type="button"
                              className="ghost icon-button"
                              onClick={() => handleMoveOpenApp(index, "up")}
                              disabled={index === 0}
                              aria-label={t("settings.moveUp")}
                            >
                              <ChevronUp aria-hidden />
                            </button>
                            <button
                              type="button"
                              className="ghost icon-button"
                              onClick={() => handleMoveOpenApp(index, "down")}
                              disabled={index === openAppDrafts.length - 1}
                              aria-label={t("settings.moveDown")}
                            >
                              <ChevronDown aria-hidden />
                            </button>
                          </div>
                          <button
                            type="button"
                            className="ghost icon-button"
                            onClick={() => handleDeleteOpenApp(index)}
                            disabled={openAppDrafts.length <= 1}
                            aria-label={t("settings.removeAppAriaLabel")}
                            title={t("settings.removeApp")}
                          >
                            <Trash2 aria-hidden />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="settings-open-app-footer">
                  <button
                    type="button"
                    className="ghost"
                    onClick={handleAddOpenApp}
                  >
                    {t("settings.addApp")}
                  </button>
                  <div className="settings-help">
                    {t("settings.openInHelp")}
                  </div>
                </div>
              </section>
            )}
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
            {activeSection === "vendors" && (
              <section className="settings-section">
                <div className="settings-section-title">
                  {t("settings.vendorsTitle")}
                </div>
                <div className="settings-section-subtitle">
                  {t("settings.vendorsDescription")}
                </div>
                <VendorSettingsPanel />
              </section>
            )}
            {activeSection === "codex" && (
              <section className="settings-section">
                <div className="settings-section-title">{t("settings.codexTitle")}</div>
                <div className="settings-section-subtitle">
                  {t("settings.codexDescription")}
                </div>
                <div className="settings-field">
                  <label className="settings-field-label" htmlFor="codex-path">
                    {t("settings.defaultCodexPath")}
                  </label>
                  <div className="settings-field-row">
                    <input
                      id="codex-path"
                      className="settings-input"
                      value={codexPathDraft}
                      placeholder={t("settings.codexPlaceholder")}
                      onChange={(event) => setCodexPathDraft(event.target.value)}
                    />
                    <button type="button" className="ghost" onClick={handleBrowseCodex}>
                      {t("settings.browse")}
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => setCodexPathDraft("")}
                    >
                      {t("settings.usePath")}
                    </button>
                  </div>
                  <div className="settings-help">
                    {t("settings.pathResolutionDesc")}
                  </div>
                  <label className="settings-field-label" htmlFor="codex-args">
                    {t("settings.defaultCodexArgs")}
                  </label>
                  <div className="settings-field-row">
                    <input
                      id="codex-args"
                      className="settings-input"
                      value={codexArgsDraft}
                      placeholder={t("settings.codexArgsPlaceholder")}
                      onChange={(event) => setCodexArgsDraft(event.target.value)}
                    />
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => setCodexArgsDraft("")}
                    >
                      {t("settings.clear")}
                    </button>
                  </div>
                  <div className="settings-help">
                    {t("settings.codexArgsDesc")} <code>{t("settings.appServer")}</code>{t("settings.codexArgsDescSuffix")}
                  </div>
                <div className="settings-field-actions">
                  {codexDirty && (
                    <button
                      type="button"
                      className="primary"
                      onClick={handleSaveCodexSettings}
                      disabled={isSavingSettings}
                    >
                      {isSavingSettings ? t("settings.saving") : t("common.save")}
                    </button>
                  )}
                  <button
                    type="button"
                    className="ghost settings-button-compact"
                    onClick={handleRunDoctor}
                    disabled={doctorState.status === "running"}
                  >
                    <Stethoscope aria-hidden />
                    {doctorState.status === "running" ? t("settings.running") : t("settings.runDoctor")}
                  </button>
                </div>

                {doctorState.result && (
                  <div
                    className={`settings-doctor ${doctorState.result.ok ? "ok" : "error"}`}
                  >
                    <div className="settings-doctor-title">
                      {doctorState.result.ok ? t("settings.codexLooksGood") : t("settings.codexIssueDetected")}
                    </div>
                    <div className="settings-doctor-body">
                      <div>
                        {t("settings.versionLabel")} {doctorState.result.version ?? t("git.unknown")}
                      </div>
                      <div>
                        {t("settings.appServerLabel")} {doctorState.result.appServerOk ? t("settings.statusOk") : t("settings.statusFailed")}
                      </div>
                      <div>
                        {t("settings.nodeLabel")}{" "}
                        {doctorState.result.nodeOk
                          ? `${t("settings.statusOk")} (${doctorState.result.nodeVersion ?? t("git.unknown")})`
                          : t("settings.statusMissing")}
                      </div>
                      {doctorState.result.details && (
                        <div>{doctorState.result.details}</div>
                      )}
                      {doctorState.result.nodeDetails && (
                        <div>{doctorState.result.nodeDetails}</div>
                      )}
                      {doctorState.result.path && (
                        <div className="settings-doctor-path">
                          {t("settings.pathLabel")} {doctorState.result.path}
                        </div>
                      )}
                      {/* Debug Info Section */}
                      {doctorState.result.debug && (
                        <details className="settings-doctor-debug">
                          <summary style={{ cursor: "pointer", marginTop: "8px", fontWeight: "bold" }}>
                            Debug Info (Click to expand)
                          </summary>
                          <div style={{ marginTop: "8px", fontSize: "12px", fontFamily: "monospace", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                            <div><strong>Platform:</strong> {doctorState.result.debug.platform} ({doctorState.result.debug.arch})</div>
                            <div><strong>Claude Found:</strong> {doctorState.result.debug.claudeFound ?? "Not found"}</div>
                            <div><strong>Codex Found:</strong> {doctorState.result.debug.codexFound ?? "Not found"}</div>
                            <div><strong>Claude (standard which):</strong> {doctorState.result.debug.claudeStandardWhich ?? "Not found"}</div>
                            <div><strong>Codex (standard which):</strong> {doctorState.result.debug.codexStandardWhich ?? "Not found"}</div>
                            <div style={{ marginTop: "8px" }}><strong>Environment Variables:</strong></div>
                            {Object.entries(doctorState.result.debug.envVars).map(([key, value]) => (
                              <div key={key} style={{ marginLeft: "12px" }}>
                                <strong>{key}:</strong> {value ?? "(not set)"}
                              </div>
                            ))}
                            <div style={{ marginTop: "8px" }}><strong>Extra Search Paths:</strong></div>
                            {doctorState.result.debug.extraSearchPaths.map((p, i) => (
                              <div key={i} style={{ marginLeft: "12px" }}>
                                {p.path}{" "}
                                {p.exists ? (p.isDir ? "✓" : "✓ (file)") : "✗"}{" "}
                                {p.hasCodexCmd && <span style={{ color: "green" }}>[codex.cmd ✓]</span>}
                                {p.hasClaudeCmd && <span style={{ color: "green" }}>[claude.cmd ✓]</span>}
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                  </div>
                )}
              </div>

                <div className="settings-field">
                  <label className="settings-field-label" htmlFor="default-access">
                    {t("settings.defaultAccessMode")}
                  </label>
                  <select
                    id="default-access"
                    className="settings-select"
                    value="full-access"
                    disabled
                  >
                    <option value="full-access">{t("settings.fullAccess")}</option>
                  </select>
                </div>

                <div className="settings-field">
                  <label className="settings-field-label" htmlFor="backend-mode">
                    {t("settings.backendMode")}
                  </label>
                  <select
                    id="backend-mode"
                    className="settings-select"
                    value={appSettings.backendMode}
                    onChange={(event) =>
                      void onUpdateAppSettings({
                        ...appSettings,
                        backendMode: event.target.value as AppSettings["backendMode"],
                      })
                    }
                  >
                    <option value="local">{t("settings.backendLocal")}</option>
                    <option value="remote">{t("settings.backendRemote")}</option>
                  </select>
                  <div className="settings-help">
                    {t("settings.backendRemoteDesc")}
                  </div>
                </div>

                {appSettings.backendMode === "remote" && (
                  <div className="settings-field">
                    <div className="settings-field-label">{t("settings.remoteBackend")}</div>
                    <div className="settings-field-row">
                      <input
                        className="settings-input settings-input--compact"
                        value={remoteHostDraft}
                        placeholder="127.0.0.1:4732"
                        onChange={(event) => setRemoteHostDraft(event.target.value)}
                        onBlur={() => {
                          void handleCommitRemoteHost();
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void handleCommitRemoteHost();
                          }
                        }}
                        aria-label={t("settings.remoteBackendHostAriaLabel")}
                      />
                      <input
                        type="password"
                        className="settings-input settings-input--compact"
                        value={remoteTokenDraft}
                        placeholder={t("settings.remoteBackendToken")}
                        onChange={(event) => setRemoteTokenDraft(event.target.value)}
                        onBlur={() => {
                          void handleCommitRemoteToken();
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void handleCommitRemoteToken();
                          }
                        }}
                        aria-label={t("settings.remoteBackendTokenAriaLabel")}
                      />
                    </div>
                    <div className="settings-help">
                      {t("settings.remoteBackendDesc")}
                    </div>
                  </div>
                )}

                <FileEditorCard
                  title={t("settings.globalAgentsMd")}
                  meta={globalAgentsMeta}
                  error={globalAgentsError}
                  value={globalAgentsContent}
                  placeholder={t("settings.globalAgentsMdPlaceholder")}
                  disabled={globalAgentsLoading}
                  refreshDisabled={globalAgentsRefreshDisabled}
                  saveDisabled={globalAgentsSaveDisabled}
                  saveLabel={globalAgentsSaveLabel}
                  onChange={setGlobalAgentsContent}
                  onRefresh={() => {
                    void refreshGlobalAgents();
                  }}
                  onSave={() => {
                    void saveGlobalAgents();
                  }}
                  helpText={
                    <>
                      {t("settings.storedAt")} <code>~/.codex/AGENTS.md</code>.
                    </>
                  }
                  classNames={{
                    container: "settings-field settings-agents",
                    header: "settings-agents-header",
                    title: "settings-field-label",
                    actions: "settings-agents-actions",
                    meta: "settings-help settings-help-inline",
                    iconButton: "ghost settings-icon-button",
                    error: "settings-agents-error",
                    textarea: "settings-agents-textarea",
                    help: "settings-help",
                  }}
                />

                <FileEditorCard
                  title={t("settings.globalCodexConfig")}
                  meta={globalConfigMeta}
                  error={globalConfigError}
                  value={globalConfigContent}
                  placeholder={t("settings.globalConfigTomlPlaceholder")}
                  disabled={globalConfigLoading}
                  refreshDisabled={globalConfigRefreshDisabled}
                  saveDisabled={globalConfigSaveDisabled}
                  saveLabel={globalConfigSaveLabel}
                  onChange={setGlobalConfigContent}
                  onRefresh={() => {
                    void refreshGlobalConfig();
                  }}
                  onSave={() => {
                    void saveGlobalConfig();
                  }}
                  helpText={
                    <>
                      {t("settings.storedAt")} <code>~/.codex/config.toml</code>.
                    </>
                  }
                  classNames={{
                    container: "settings-field settings-agents",
                    header: "settings-agents-header",
                    title: "settings-field-label",
                    actions: "settings-agents-actions",
                    meta: "settings-help settings-help-inline",
                    iconButton: "ghost settings-icon-button",
                    error: "settings-agents-error",
                    textarea: "settings-agents-textarea",
                    help: "settings-help",
                  }}
                />

                <div className="settings-field">
                  <div className="settings-field-label">{t("settings.workspaceOverrides")}</div>
                  <div className="settings-overrides">
                    {projects.map((workspace) => (
                      <div key={workspace.id} className="settings-override-row">
                        <div className="settings-override-info">
                          <div className="settings-project-name">{workspace.name}</div>
                          <div className="settings-project-path">{workspace.path}</div>
                        </div>
                        <div className="settings-override-actions">
                          <div className="settings-override-field">
                            <input
                              className="settings-input settings-input--compact"
                              value={codexBinOverrideDrafts[workspace.id] ?? ""}
                              placeholder={t("settings.codexBinaryOverride")}
                              onChange={(event) =>
                                setCodexBinOverrideDrafts((prev) => ({
                                  ...prev,
                                  [workspace.id]: event.target.value,
                                }))
                              }
                              onBlur={async () => {
                                const draft = codexBinOverrideDrafts[workspace.id] ?? "";
                                const nextValue = normalizeOverrideValue(draft);
                                if (nextValue === (workspace.codex_bin ?? null)) {
                                  return;
                                }
                                await onUpdateWorkspaceCodexBin(workspace.id, nextValue);
                              }}
                              aria-label={`Codex binary override for ${workspace.name}`}
                            />
                            <button
                              type="button"
                              className="ghost"
                              onClick={async () => {
                                setCodexBinOverrideDrafts((prev) => ({
                                  ...prev,
                                  [workspace.id]: "",
                                }));
                                await onUpdateWorkspaceCodexBin(workspace.id, null);
                              }}
                            >
                              {t("settings.clear")}
                            </button>
                          </div>
                          <div className="settings-override-field">
                            <input
                              className="settings-input settings-input--compact"
                              value={codexHomeOverrideDrafts[workspace.id] ?? ""}
                              placeholder={t("settings.codexHomeOverride")}
                              onChange={(event) =>
                                setCodexHomeOverrideDrafts((prev) => ({
                                  ...prev,
                                  [workspace.id]: event.target.value,
                                }))
                              }
                              onBlur={async () => {
                                const draft = codexHomeOverrideDrafts[workspace.id] ?? "";
                                const nextValue = normalizeOverrideValue(draft);
                                if (nextValue === (workspace.settings.codexHome ?? null)) {
                                  return;
                                }
                                await onUpdateWorkspaceSettings(workspace.id, {
                                  codexHome: nextValue,
                                });
                              }}
                              aria-label={`CODEX_HOME override for ${workspace.name}`}
                            />
                            <button
                              type="button"
                              className="ghost"
                              onClick={async () => {
                                setCodexHomeOverrideDrafts((prev) => ({
                                  ...prev,
                                  [workspace.id]: "",
                                }));
                                await onUpdateWorkspaceSettings(workspace.id, {
                                  codexHome: null,
                                });
                              }}
                            >
                              {t("settings.clear")}
                            </button>
                          </div>
                          <div className="settings-override-field">
                            <input
                              className="settings-input settings-input--compact"
                              value={codexArgsOverrideDrafts[workspace.id] ?? ""}
                              placeholder={t("settings.codexArgsOverride")}
                              onChange={(event) =>
                                setCodexArgsOverrideDrafts((prev) => ({
                                  ...prev,
                                  [workspace.id]: event.target.value,
                                }))
                              }
                              onBlur={async () => {
                                const draft = codexArgsOverrideDrafts[workspace.id] ?? "";
                                const nextValue = normalizeOverrideValue(draft);
                                if (nextValue === (workspace.settings.codexArgs ?? null)) {
                                  return;
                                }
                                await onUpdateWorkspaceSettings(workspace.id, {
                                  codexArgs: nextValue,
                                });
                              }}
                              aria-label={`Codex args override for ${workspace.name}`}
                            />
                            <button
                              type="button"
                              className="ghost"
                              onClick={async () => {
                                setCodexArgsOverrideDrafts((prev) => ({
                                  ...prev,
                                  [workspace.id]: "",
                                }));
                                await onUpdateWorkspaceSettings(workspace.id, {
                                  codexArgs: null,
                                });
                              }}
                            >
                              {t("settings.clear")}
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                    {projects.length === 0 && (
                      <div className="settings-empty">{t("settings.noProjectsYet")}</div>
                    )}
                  </div>
                </div>

              </section>
            )}
            {activeSection === "about" && (
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
