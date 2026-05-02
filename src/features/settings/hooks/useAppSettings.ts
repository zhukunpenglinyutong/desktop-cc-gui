import { useCallback, useEffect, useState } from "react";
import type { AppSettings } from "../../../types";
import {
  getAppSettings,
  runClaudeDoctor,
  runCodexDoctor,
  updateAppSettings,
} from "../../../services/tauri";
import {
  CODEX_AUTO_COMPACTION_THRESHOLD_DEFAULT_PERCENT,
  normalizeCodexAutoCompactionThresholdPercent,
} from "../../codex/constants/codexAutoCompactionThreshold";
import {
  clampUiScale,
  sanitizeUiScale,
  UI_SCALE_DEFAULT,
} from "../../../utils/uiScale";
import {
  DEFAULT_CODE_FONT_FAMILY,
  DEFAULT_UI_FONT_FAMILY,
  CODE_FONT_SIZE_DEFAULT,
  clampCodeFontSize,
  normalizeFontFamily,
} from "../../../utils/fonts";
import {
  DEFAULT_OPEN_APP_ID,
  DEFAULT_OPEN_APP_TARGETS,
} from "../../app/constants";
import { getClientStoreSync } from "../../../services/clientStorage";
import { normalizeOpenAppTargets } from "../../app/utils/openApp";
import { getDefaultInterruptShortcut } from "../../../utils/shortcuts";
import { normalizeHexColor } from "../../../utils/colorUtils";
import {
  sanitizeDarkThemePresetId,
  sanitizeLightThemePresetId,
  sanitizeThemePresetId,
} from "../../theme/utils/themePreset";

const allowedThemes = new Set(["system", "light", "dark", "dim", "custom"]);
const allowedCanvasWidthModes = new Set(["narrow", "wide"]);
const allowedLayoutModes = new Set(["default", "swapped"]);
const allowedComposerSendShortcuts = new Set(["enter", "cmdEnter"]);
const SEARCH_SHORTCUT_DISALLOWED = new Set(["cmd+p", "ctrl+p"]);
const ALLOWED_NOTIFICATION_SOUND_IDS = new Set([
  "default",
  "chime",
  "bell",
  "ding",
  "success",
  "custom",
]);
const allowedEmailSenderProviders = new Set(["126", "163", "qq", "custom"]);
const allowedEmailSenderSecurity = new Set(["ssl_tls", "start_tls", "none"]);

function readLegacyUserMsgColor(): string {
  if (typeof window === "undefined") {
    return "";
  }
  try {
    const stored = window.localStorage.getItem("userMsgColor");
    return normalizeHexColor(stored);
  } catch {
    return "";
  }
}

function normalizeShortcutValue(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  return normalized || null;
}

function normalizeGlobalSearchShortcut(value: string | null | undefined): string | null {
  if (value === null) {
    return null;
  }
  const normalized = normalizeShortcutValue(value);
  if (!normalized || SEARCH_SHORTCUT_DISALLOWED.has(normalized)) {
    return "cmd+o";
  }
  return normalized;
}

function normalizeNewWorktreeShortcut(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeShortcutValue(value);
  if (normalized === "cmd+shift+n" || normalized === "ctrl+shift+n") {
    return "cmd+alt+shift+n";
  }
  return normalized;
}

function normalizeWebServicePort(value: number | null | undefined): number {
  if (!Number.isFinite(value)) {
    return 3080;
  }
  const normalized = Math.round(value as number);
  if (normalized < 1024 || normalized > 65535) {
    return 3080;
  }
  return normalized;
}

const defaultSettings: AppSettings = {
  claudeBin: null,
  codexBin: null,
  codexArgs: null,
  terminalShellPath: null,
  backendMode: "local",
  remoteBackendHost: "127.0.0.1:4732",
  remoteBackendToken: null,
  webServicePort: 3080,
  systemProxyEnabled: false,
  systemProxyUrl: null,
  defaultAccessMode: "full-access",
  composerModelShortcut: "cmd+shift+m",
  composerAccessShortcut: "cmd+shift+a",
  composerReasoningShortcut: "cmd+shift+r",
  composerCollaborationShortcut: "shift+tab",
  interruptShortcut: getDefaultInterruptShortcut(),
  openSettingsShortcut: "cmd+,",
  newWindowShortcut: "cmd+shift+n",
  newAgentShortcut: "cmd+n",
  newWorktreeAgentShortcut: "cmd+alt+shift+n",
  newCloneAgentShortcut: "cmd+alt+n",
  archiveThreadShortcut: "cmd+ctrl+a",
  openChatShortcut: "cmd+j",
  openKanbanShortcut: "cmd+k",
  cycleOpenSessionPrevShortcut: "cmd+shift+[",
  cycleOpenSessionNextShortcut: "cmd+shift+]",
  toggleLeftConversationSidebarShortcut: "cmd+alt+[",
  toggleRightConversationSidebarShortcut: "cmd+alt+]",
  toggleProjectsSidebarShortcut: "cmd+shift+p",
  toggleGitSidebarShortcut: "cmd+shift+g",
  toggleGlobalSearchShortcut: "cmd+o",
  toggleDebugPanelShortcut: "cmd+shift+d",
  toggleTerminalShortcut: "cmd+shift+t",
  toggleRuntimeConsoleShortcut: "cmd+shift+`",
  toggleFilesSurfaceShortcut: "cmd+shift+e",
  saveFileShortcut: "cmd+s",
  findInFileShortcut: "cmd+f",
  toggleGitDiffListViewShortcut: "alt+shift+v",
  increaseUiScaleShortcut: "cmd+=",
  decreaseUiScaleShortcut: "cmd+-",
  resetUiScaleShortcut: "cmd+0",
  cycleAgentNextShortcut: "cmd+ctrl+down",
  cycleAgentPrevShortcut: "cmd+ctrl+up",
  cycleWorkspaceNextShortcut: "cmd+shift+down",
  cycleWorkspacePrevShortcut: "cmd+shift+up",
  lastComposerModelId: null,
  lastComposerReasoningEffort: null,
  uiScale: UI_SCALE_DEFAULT,
  theme: "system",
  lightThemePresetId: "vscode-light-modern",
  darkThemePresetId: "vscode-dark-modern",
  customThemePresetId: "vscode-dark-modern",
  canvasWidthMode: "narrow",
  layoutMode: "default",
  userMsgColor: "",
  usageShowRemaining: false,
  showMessageAnchors: true,
  performanceCompatibilityModeEnabled: false,
  uiFontFamily: DEFAULT_UI_FONT_FAMILY,
  codeFontFamily: DEFAULT_CODE_FONT_FAMILY,
  codeFontSize: CODE_FONT_SIZE_DEFAULT,
  notificationSoundsEnabled: true,
  notificationSoundId: "default",
  notificationSoundCustomPath: "",
  systemNotificationEnabled: true,
  emailSender: {
    enabled: false,
    provider: "custom",
    senderEmail: "",
    senderName: "",
    smtpHost: "",
    smtpPort: 465,
    security: "ssl_tls",
    username: "",
    recipientEmail: "",
  },
  preloadGitDiffs: true,
  detachedExternalChangeAwarenessEnabled: true,
  detachedExternalChangeWatcherEnabled: true,
  experimentalCollabEnabled: false,
  experimentalCollaborationModesEnabled: true,
  codexModeEnforcementEnabled: true,
  experimentalSteerEnabled: false,
  codexUnifiedExecPolicy: "inherit",
  chatCanvasUseNormalizedRealtime: true,
  chatCanvasUseUnifiedHistoryLoader: true,
  chatCanvasUsePresentationProfile: false,
  dictationEnabled: false,
  dictationModelId: "base",
  dictationPreferredLanguage: null,
  dictationHoldKey: "alt",
  composerEditorPreset: "default",
  composerSendShortcut: "enter",
  composerFenceExpandOnSpace: false,
  composerFenceExpandOnEnter: false,
  composerFenceLanguageTags: false,
  composerFenceWrapSelection: false,
  composerFenceAutoWrapPasteMultiline: false,
  composerFenceAutoWrapPasteCodeLike: false,
  composerListContinuation: false,
  composerCodeBlockCopyUseModifier: true,
  workspaceGroups: [],
  openAppTargets: DEFAULT_OPEN_APP_TARGETS,
  selectedOpenAppId: DEFAULT_OPEN_APP_ID,
  runtimeRestoreThreadsOnlyOnLaunch: true,
  runtimeForceCleanupOnExit: true,
  runtimeOrphanSweepOnLaunch: true,
  codexMaxHotRuntimes: 1,
  codexMaxWarmRuntimes: 1,
  codexWarmTtlSeconds: 7200,
  codexAutoCompactionEnabled: true,
  codexAutoCompactionThresholdPercent: CODEX_AUTO_COMPACTION_THRESHOLD_DEFAULT_PERCENT,
};

const CODEX_WARM_TTL_DEFAULT_SECONDS = 7200;

function normalizeAppSettings(
  settings: AppSettings,
  options?: {
    allowLegacyUserMsgColorFallback?: boolean;
    fallbackUiScaleToDefault?: boolean;
    upgradeWarmTtlToDefaultOnLoad?: boolean;
  },
): AppSettings {
  const normalizedUserMsgColor = normalizeHexColor(settings.userMsgColor);
  const fallbackUserMsgColor =
    options?.allowLegacyUserMsgColorFallback && !normalizedUserMsgColor
      ? readLegacyUserMsgColor()
      : normalizedUserMsgColor;
  const normalizedTargets =
    settings.openAppTargets && settings.openAppTargets.length
      ? normalizeOpenAppTargets(settings.openAppTargets)
      : DEFAULT_OPEN_APP_TARGETS;
  const storedOpenAppId = getClientStoreSync<string>("app", "openWorkspaceApp") ?? null;
  const hasPersistedSelection = normalizedTargets.some(
    (target) => target.id === settings.selectedOpenAppId,
  );
  const hasStoredSelection =
    !hasPersistedSelection &&
    storedOpenAppId !== null &&
    normalizedTargets.some((target) => target.id === storedOpenAppId);
  const selectedOpenAppId = hasPersistedSelection
    ? settings.selectedOpenAppId
    : hasStoredSelection
      ? storedOpenAppId
      : normalizedTargets[0]?.id ?? DEFAULT_OPEN_APP_ID;
  return {
    ...settings,
    experimentalCollabEnabled: false,
    codexUnifiedExecPolicy: "inherit",
    experimentalUnifiedExecEnabled: undefined,
    claudeBin: settings.claudeBin?.trim() ? settings.claudeBin.trim() : null,
    codexBin: settings.codexBin?.trim() ? settings.codexBin.trim() : null,
    codexArgs: settings.codexArgs?.trim() ? settings.codexArgs.trim() : null,
    terminalShellPath: settings.terminalShellPath?.trim()
      ? settings.terminalShellPath.trim()
      : null,
    webServicePort: normalizeWebServicePort(settings.webServicePort),
    systemProxyUrl: settings.systemProxyUrl?.trim()
      ? settings.systemProxyUrl.trim()
      : null,
    uiScale: options?.fallbackUiScaleToDefault
      ? sanitizeUiScale(settings.uiScale)
      : clampUiScale(settings.uiScale),
    theme: allowedThemes.has(settings.theme) ? settings.theme : "system",
    lightThemePresetId: sanitizeLightThemePresetId(settings.lightThemePresetId),
    darkThemePresetId: sanitizeDarkThemePresetId(settings.darkThemePresetId),
    customThemePresetId: sanitizeThemePresetId(settings.customThemePresetId),
    canvasWidthMode: allowedCanvasWidthModes.has(settings.canvasWidthMode)
      ? settings.canvasWidthMode
      : "narrow",
    layoutMode: allowedLayoutModes.has(settings.layoutMode ?? "default")
      ? settings.layoutMode ?? "default"
      : "default",
    userMsgColor: fallbackUserMsgColor,
    performanceCompatibilityModeEnabled:
      settings.performanceCompatibilityModeEnabled === true,
    uiFontFamily: normalizeFontFamily(
      settings.uiFontFamily,
      DEFAULT_UI_FONT_FAMILY,
    ),
    codeFontFamily: normalizeFontFamily(
      settings.codeFontFamily,
      DEFAULT_CODE_FONT_FAMILY,
    ),
    runtimeRestoreThreadsOnlyOnLaunch:
      settings.runtimeRestoreThreadsOnlyOnLaunch !== false,
    runtimeForceCleanupOnExit: settings.runtimeForceCleanupOnExit !== false,
    runtimeOrphanSweepOnLaunch: settings.runtimeOrphanSweepOnLaunch !== false,
    codexMaxHotRuntimes: Number.isFinite(settings.codexMaxHotRuntimes)
      ? Math.max(0, Math.min(8, Math.trunc(settings.codexMaxHotRuntimes)))
      : 1,
    codexMaxWarmRuntimes: Number.isFinite(settings.codexMaxWarmRuntimes)
      ? Math.max(0, Math.min(16, Math.trunc(settings.codexMaxWarmRuntimes)))
      : 1,
    codexWarmTtlSeconds: (() => {
      const normalized = Number.isFinite(settings.codexWarmTtlSeconds)
        ? Math.max(15, Math.min(14400, Math.trunc(settings.codexWarmTtlSeconds)))
        : CODEX_WARM_TTL_DEFAULT_SECONDS;
      return options?.upgradeWarmTtlToDefaultOnLoad
        ? Math.max(CODEX_WARM_TTL_DEFAULT_SECONDS, normalized)
        : normalized;
    })(),
    codexAutoCompactionThresholdPercent: normalizeCodexAutoCompactionThresholdPercent(
      settings.codexAutoCompactionThresholdPercent,
    ),
    codexAutoCompactionEnabled: settings.codexAutoCompactionEnabled !== false,
    codeFontSize: clampCodeFontSize(settings.codeFontSize),
    notificationSoundId: ALLOWED_NOTIFICATION_SOUND_IDS.has(settings.notificationSoundId)
      ? settings.notificationSoundId
      : "default",
    notificationSoundCustomPath: settings.notificationSoundCustomPath?.trim() ?? "",
    emailSender: {
      enabled: settings.emailSender?.enabled === true,
      provider: allowedEmailSenderProviders.has(settings.emailSender?.provider)
        ? settings.emailSender.provider
        : "custom",
      senderEmail: settings.emailSender?.senderEmail?.trim() ?? "",
      senderName: settings.emailSender?.senderName?.trim() ?? "",
      smtpHost: settings.emailSender?.smtpHost?.trim() ?? "",
      smtpPort: Number.isFinite(settings.emailSender?.smtpPort)
        ? Math.max(1, Math.min(65535, Math.trunc(settings.emailSender.smtpPort)))
        : 465,
      security: allowedEmailSenderSecurity.has(settings.emailSender?.security)
        ? settings.emailSender.security
        : "ssl_tls",
      username: settings.emailSender?.username?.trim() ?? "",
      recipientEmail: settings.emailSender?.recipientEmail?.trim() ?? "",
    },
    detachedExternalChangeAwarenessEnabled:
      settings.detachedExternalChangeAwarenessEnabled !== false,
    detachedExternalChangeWatcherEnabled:
      settings.detachedExternalChangeWatcherEnabled !== false,
    codexModeEnforcementEnabled:
      settings.codexModeEnforcementEnabled !== false,
    // Conversation curtain convergence now depends on the normalized realtime adapters.
    // Keep it enabled even for older persisted settings that still store false.
    chatCanvasUseNormalizedRealtime: true,
    // Session activity history recovery now depends on the unified history loader.
    // Keep it enabled even for older persisted settings that still store false.
    chatCanvasUseUnifiedHistoryLoader: true,
    composerSendShortcut: allowedComposerSendShortcuts.has(settings.composerSendShortcut)
      ? settings.composerSendShortcut
      : "enter",
    newWorktreeAgentShortcut: normalizeNewWorktreeShortcut(settings.newWorktreeAgentShortcut),
    toggleGlobalSearchShortcut: normalizeGlobalSearchShortcut(settings.toggleGlobalSearchShortcut),
    openAppTargets: normalizedTargets,
    selectedOpenAppId,
  };
}

export function useAppSettings() {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await getAppSettings();
        if (active) {
          const allowLegacyUserMsgColorFallback =
            (response as Partial<AppSettings>).userMsgColor == null;
          setSettings(
            normalizeAppSettings({
              ...defaultSettings,
              ...response,
            }, {
              allowLegacyUserMsgColorFallback,
              fallbackUiScaleToDefault: true,
              upgradeWarmTtlToDefaultOnLoad: true,
            }),
          );
        }
      } catch {
        // Defaults stay in place if loading settings fails.
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const saveSettings = useCallback(async (next: AppSettings) => {
    const normalized = normalizeAppSettings(next);
    const saved = await updateAppSettings(normalized);
    setSettings(
      normalizeAppSettings({
        ...defaultSettings,
        ...saved,
      }),
    );
    return saved;
  }, []);

  const doctor = useCallback(
    async (codexBin: string | null, codexArgs: string | null) => {
      return runCodexDoctor(codexBin, codexArgs);
    },
    [],
  );

  const claudeDoctor = useCallback(async (claudeBin: string | null) => {
    return runClaudeDoctor(claudeBin);
  }, []);

  return {
    settings,
    setSettings,
    saveSettings,
    doctor,
    claudeDoctor,
    isLoading,
  };
}
