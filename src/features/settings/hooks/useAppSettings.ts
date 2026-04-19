import { useCallback, useEffect, useState } from "react";
import type { AppSettings } from "../../../types";
import { getAppSettings, runCodexDoctor, updateAppSettings } from "../../../services/tauri";
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

const allowedThemes = new Set(["system", "light", "dark", "dim"]);
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

function normalizeGlobalSearchShortcut(value: string | null | undefined): string {
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
  codexBin: null,
  codexArgs: null,
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
  newAgentShortcut: "cmd+n",
  newWorktreeAgentShortcut: "cmd+alt+shift+n",
  newCloneAgentShortcut: "cmd+alt+n",
  archiveThreadShortcut: "cmd+ctrl+a",
  toggleProjectsSidebarShortcut: "cmd+shift+p",
  toggleGitSidebarShortcut: "cmd+shift+g",
  toggleGlobalSearchShortcut: "cmd+o",
  toggleDebugPanelShortcut: "cmd+shift+d",
  toggleTerminalShortcut: "cmd+shift+t",
  cycleAgentNextShortcut: "cmd+ctrl+down",
  cycleAgentPrevShortcut: "cmd+ctrl+up",
  cycleWorkspaceNextShortcut: "cmd+shift+down",
  cycleWorkspacePrevShortcut: "cmd+shift+up",
  lastComposerModelId: null,
  lastComposerReasoningEffort: null,
  uiScale: UI_SCALE_DEFAULT,
  theme: "system",
  canvasWidthMode: "narrow",
  layoutMode: "default",
  userMsgColor: "",
  usageShowRemaining: false,
  showMessageAnchors: true,
  uiFontFamily: DEFAULT_UI_FONT_FAMILY,
  codeFontFamily: DEFAULT_CODE_FONT_FAMILY,
  codeFontSize: CODE_FONT_SIZE_DEFAULT,
  notificationSoundsEnabled: true,
  notificationSoundId: "default",
  notificationSoundCustomPath: "",
  systemNotificationEnabled: true,
  preloadGitDiffs: true,
  detachedExternalChangeAwarenessEnabled: true,
  detachedExternalChangeWatcherEnabled: true,
  experimentalCollabEnabled: false,
  experimentalCollaborationModesEnabled: true,
  codexModeEnforcementEnabled: true,
  experimentalSteerEnabled: false,
  experimentalUnifiedExecEnabled: false,
  chatCanvasUseNormalizedRealtime: false,
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
  codexWarmTtlSeconds: 90,
};

function normalizeAppSettings(
  settings: AppSettings,
  options?: {
    allowLegacyUserMsgColorFallback?: boolean;
    fallbackUiScaleToDefault?: boolean;
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
    codexBin: settings.codexBin?.trim() ? settings.codexBin.trim() : null,
    codexArgs: settings.codexArgs?.trim() ? settings.codexArgs.trim() : null,
    webServicePort: normalizeWebServicePort(settings.webServicePort),
    systemProxyUrl: settings.systemProxyUrl?.trim()
      ? settings.systemProxyUrl.trim()
      : null,
    uiScale: options?.fallbackUiScaleToDefault
      ? sanitizeUiScale(settings.uiScale)
      : clampUiScale(settings.uiScale),
    theme: allowedThemes.has(settings.theme) ? settings.theme : "system",
    canvasWidthMode: allowedCanvasWidthModes.has(settings.canvasWidthMode)
      ? settings.canvasWidthMode
      : "narrow",
    layoutMode: allowedLayoutModes.has(settings.layoutMode ?? "default")
      ? settings.layoutMode ?? "default"
      : "default",
    userMsgColor: fallbackUserMsgColor,
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
    codexWarmTtlSeconds: Number.isFinite(settings.codexWarmTtlSeconds)
      ? Math.max(15, Math.min(3600, Math.trunc(settings.codexWarmTtlSeconds)))
      : 90,
    codeFontSize: clampCodeFontSize(settings.codeFontSize),
    notificationSoundId: ALLOWED_NOTIFICATION_SOUND_IDS.has(settings.notificationSoundId)
      ? settings.notificationSoundId
      : "default",
    notificationSoundCustomPath: settings.notificationSoundCustomPath?.trim() ?? "",
    detachedExternalChangeAwarenessEnabled:
      settings.detachedExternalChangeAwarenessEnabled !== false,
    detachedExternalChangeWatcherEnabled:
      settings.detachedExternalChangeWatcherEnabled !== false,
    codexModeEnforcementEnabled:
      settings.codexModeEnforcementEnabled !== false,
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

  return {
    settings,
    setSettings,
    saveSettings,
    doctor,
    isLoading,
  };
}
