// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings, WorkspaceInfo } from "../../../types";
import {
  archiveWorkspaceSessions,
  deleteWorkspaceSessions,
  listWorkspaceSessions,
  unarchiveWorkspaceSessions,
} from "../../../services/tauri";
import { pushErrorToast } from "../../../services/toasts";
import { SettingsView } from "./SettingsView";

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn(() => new Promise<string>(() => {})),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: vi.fn(),
  open: vi.fn(),
}));

vi.mock("../../../i18n", () => ({
  saveLanguage: vi.fn(),
  default: {
    use: () => ({ init: vi.fn() }),
  },
}));

vi.mock("../../../services/toasts", () => ({
  pushErrorToast: vi.fn(),
}));

vi.mock("../../../services/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../../services/tauri")>(
    "../../../services/tauri",
  );
  return {
    ...actual,
    listWorkspaceSessions: vi.fn(),
    archiveWorkspaceSessions: vi.fn(),
    unarchiveWorkspaceSessions: vi.fn(),
    deleteWorkspaceSessions: vi.fn(),
  };
});

const mockedLocalFonts = [
  { family: "Monaco" },
  { family: "Avenir" },
  { family: "SF Pro Text" },
] as const;

const queryLocalFontsMock = vi.fn<() => Promise<Array<{ family: string }>>>(
  () => new Promise<Array<{ family: string }>>(() => {}),
);

beforeEach(() => {
  queryLocalFontsMock.mockReset();
  queryLocalFontsMock.mockImplementation(
    () => new Promise<Array<{ family: string }>>(() => {}),
  );
  (window as any).queryLocalFonts = queryLocalFontsMock;
  vi.mocked(listWorkspaceSessions).mockResolvedValue({
    data: [],
    nextCursor: null,
    partialSource: null,
  });
  vi.mocked(archiveWorkspaceSessions).mockResolvedValue({ results: [] });
  vi.mocked(unarchiveWorkspaceSessions).mockResolvedValue({ results: [] });
  vi.mocked(deleteWorkspaceSessions).mockResolvedValue({ results: [] });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete (window as any).queryLocalFonts;
});

const workspaceA: WorkspaceInfo = {
  id: "ws-a",
  name: "Workspace A",
  path: "/tmp/ws-a",
  connected: true,
  settings: { sidebarCollapsed: false },
};

const workspaceB: WorkspaceInfo = {
  id: "ws-b",
  name: "Workspace B",
  path: "/tmp/ws-b",
  connected: true,
  settings: { sidebarCollapsed: false },
};

const baseSettings: AppSettings = {
  codexBin: null,
  codexArgs: null,
  backendMode: "local",
  remoteBackendHost: "127.0.0.1:4732",
  remoteBackendToken: null,
  webServicePort: 3080,
  systemProxyEnabled: false,
  systemProxyUrl: null,
  defaultAccessMode: "current",
  composerModelShortcut: null,
  composerAccessShortcut: null,
  composerReasoningShortcut: null,
  composerCollaborationShortcut: null,
  interruptShortcut: null,
  newAgentShortcut: null,
  newWorktreeAgentShortcut: null,
  newCloneAgentShortcut: null,
  archiveThreadShortcut: null,
  toggleProjectsSidebarShortcut: null,
  toggleGitSidebarShortcut: null,
  toggleGlobalSearchShortcut: null,
  toggleDebugPanelShortcut: null,
  toggleTerminalShortcut: null,
  cycleAgentNextShortcut: null,
  cycleAgentPrevShortcut: null,
  cycleWorkspaceNextShortcut: null,
  cycleWorkspacePrevShortcut: null,
  lastComposerModelId: null,
  lastComposerReasoningEffort: null,
  uiScale: 1,
  theme: "system",
  canvasWidthMode: "narrow",
  layoutMode: "default",
  userMsgColor: "",
  usageShowRemaining: false,
  showMessageAnchors: true,
  uiFontFamily:
    "Monaco, \"SF Pro Text\", \"SF Pro Display\", -apple-system, \"Helvetica Neue\", sans-serif",
  codeFontFamily:
    "Monaco, \"SF Mono\", \"SFMono-Regular\", Menlo, monospace",
  codeFontSize: 11,
  notificationSoundsEnabled: true,
  notificationSoundId: "default",
  notificationSoundCustomPath: "",
  systemNotificationEnabled: true,
  runtimeRestoreThreadsOnlyOnLaunch: true,
  runtimeForceCleanupOnExit: true,
  runtimeOrphanSweepOnLaunch: true,
  codexMaxHotRuntimes: 1,
  codexMaxWarmRuntimes: 1,
  codexWarmTtlSeconds: 90,
  preloadGitDiffs: true,
  experimentalCollabEnabled: false,
  experimentalCollaborationModesEnabled: false,
  experimentalSteerEnabled: false,
  experimentalUnifiedExecEnabled: false,
  chatCanvasUseNormalizedRealtime: false,
  chatCanvasUseUnifiedHistoryLoader: true,
  chatCanvasUsePresentationProfile: false,
  dictationEnabled: false,
  dictationModelId: "base",
  dictationPreferredLanguage: null,
  dictationHoldKey: null,
  composerEditorPreset: "default",
  composerSendShortcut: "enter",
  composerFenceExpandOnSpace: false,
  composerFenceExpandOnEnter: false,
  composerFenceLanguageTags: false,
  composerFenceWrapSelection: false,
  composerFenceAutoWrapPasteMultiline: false,
  composerFenceAutoWrapPasteCodeLike: false,
  composerListContinuation: false,
  composerCodeBlockCopyUseModifier: false,
  workspaceGroups: [],
  openAppTargets: [
    {
      id: "vscode",
      label: "VS Code",
      kind: "app",
      appName: "Visual Studio Code",
      command: null,
      args: [],
    },
  ],
  selectedOpenAppId: "vscode",
};

const createDoctorResult = () => ({
  ok: true,
  codexBin: null,
  version: null,
  appServerOk: true,
  appServerProbeStatus: "ok",
  details: null,
  path: null,
  pathEnvUsed: null,
  proxyEnvSnapshot: undefined,
  nodeOk: true,
  nodeVersion: null,
  nodeDetails: null,
  resolvedBinaryPath: null,
  wrapperKind: null,
  fallbackRetried: false,
});

const renderDisplaySection = (
  options: {
    appSettings?: Partial<AppSettings>;
    reduceTransparency?: boolean;
    onUpdateAppSettings?: ComponentProps<typeof SettingsView>["onUpdateAppSettings"];
    onToggleTransparency?: ComponentProps<typeof SettingsView>["onToggleTransparency"];
  } = {},
) => {
  cleanup();
  const onUpdateAppSettings =
    options.onUpdateAppSettings ?? vi.fn().mockResolvedValue(undefined);
  const onToggleTransparency = options.onToggleTransparency ?? vi.fn();
  const props: ComponentProps<typeof SettingsView> = {
    reduceTransparency: options.reduceTransparency ?? false,
    onToggleTransparency,
    appSettings: { ...baseSettings, ...options.appSettings },
    openAppIconById: {},
    onUpdateAppSettings,
    workspaceGroups: [],
    groupedWorkspaces: [],
    ungroupedLabel: "Ungrouped",
    onClose: vi.fn(),
    onMoveWorkspace: vi.fn(),
    onDeleteWorkspace: vi.fn(),
    onCreateWorkspaceGroup: vi.fn().mockResolvedValue(null),
    onRenameWorkspaceGroup: vi.fn().mockResolvedValue(null),
    onMoveWorkspaceGroup: vi.fn().mockResolvedValue(null),
    onDeleteWorkspaceGroup: vi.fn().mockResolvedValue(null),
    onAssignWorkspaceGroup: vi.fn().mockResolvedValue(null),
    onRunDoctor: vi.fn().mockResolvedValue(createDoctorResult()),
    activeWorkspace: null,
    activeEngine: "codex",
    onUpdateWorkspaceCodexBin: vi.fn().mockResolvedValue(undefined),
    onUpdateWorkspaceSettings: vi.fn().mockResolvedValue(undefined),
    scaleShortcutTitle: "Scale shortcut",
    scaleShortcutText: "Use Command +/-",
    onTestNotificationSound: vi.fn(),
    dictationModelStatus: null,
    onDownloadDictationModel: vi.fn(),
    onCancelDictationDownload: vi.fn(),
    onRemoveDictationModel: vi.fn(),
  };

  render(<SettingsView {...props} />);

  return { onUpdateAppSettings, onToggleTransparency };
};

const renderComposerSection = (
  options: {
    appSettings?: Partial<AppSettings>;
    onUpdateAppSettings?: ComponentProps<typeof SettingsView>["onUpdateAppSettings"];
  } = {},
) => {
  cleanup();
  const onUpdateAppSettings =
    options.onUpdateAppSettings ?? vi.fn().mockResolvedValue(undefined);
  const props: ComponentProps<typeof SettingsView> = {
    reduceTransparency: false,
    onToggleTransparency: vi.fn(),
    appSettings: { ...baseSettings, ...options.appSettings },
    openAppIconById: {},
    onUpdateAppSettings,
    workspaceGroups: [],
    groupedWorkspaces: [],
    ungroupedLabel: "Ungrouped",
    onClose: vi.fn(),
    onMoveWorkspace: vi.fn(),
    onDeleteWorkspace: vi.fn(),
    onCreateWorkspaceGroup: vi.fn().mockResolvedValue(null),
    onRenameWorkspaceGroup: vi.fn().mockResolvedValue(null),
    onMoveWorkspaceGroup: vi.fn().mockResolvedValue(null),
    onDeleteWorkspaceGroup: vi.fn().mockResolvedValue(null),
    onAssignWorkspaceGroup: vi.fn().mockResolvedValue(null),
    onRunDoctor: vi.fn().mockResolvedValue(createDoctorResult()),
    activeWorkspace: null,
    activeEngine: "codex",
    onUpdateWorkspaceCodexBin: vi.fn().mockResolvedValue(undefined),
    onUpdateWorkspaceSettings: vi.fn().mockResolvedValue(undefined),
    scaleShortcutTitle: "Scale shortcut",
    scaleShortcutText: "Use Command +/-",
    onTestNotificationSound: vi.fn(),
    dictationModelStatus: null,
    onDownloadDictationModel: vi.fn(),
    onCancelDictationDownload: vi.fn(),
    onRemoveDictationModel: vi.fn(),
    initialSection: "composer",
  };

  render(<SettingsView {...props} />);

  return { onUpdateAppSettings };
};

const flushSettingsViewEffects = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe("SettingsView prompts workspace routing", () => {
  it("aligns prompt settings workspace picker to the active workspace when opened from prompts", async () => {
    render(
      <SettingsView
        reduceTransparency={false}
        onToggleTransparency={vi.fn()}
        appSettings={baseSettings}
        openAppIconById={{}}
        onUpdateAppSettings={vi.fn().mockResolvedValue(undefined)}
        workspaceGroups={[]}
        groupedWorkspaces={[
          { id: null, name: "Ungrouped", workspaces: [workspaceA, workspaceB] },
        ]}
        allWorkspaces={[workspaceA, workspaceB]}
        ungroupedLabel="Ungrouped"
        onClose={vi.fn()}
        onMoveWorkspace={vi.fn()}
        onDeleteWorkspace={vi.fn()}
        onCreateWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onRenameWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onMoveWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onDeleteWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onAssignWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onRunDoctor={vi.fn().mockResolvedValue(createDoctorResult())}
        activeWorkspace={workspaceB}
        activeEngine="codex"
        onUpdateWorkspaceCodexBin={vi.fn().mockResolvedValue(undefined)}
        onUpdateWorkspaceSettings={vi.fn().mockResolvedValue(undefined)}
        scaleShortcutTitle="Scale shortcut"
        scaleShortcutText="Use Command +/-"
        onTestNotificationSound={vi.fn()}
        dictationModelStatus={null}
        onDownloadDictationModel={vi.fn()}
        onCancelDictationDownload={vi.fn()}
        onRemoveDictationModel={vi.fn()}
        initialSection="prompts"
      />,
    );

    const picker = await screen.findByDisplayValue("Workspace B");
    expect(picker).toBeTruthy();
  });
});

describe("SettingsView projects display", () => {
  it("hides default workspace entry in projects section", async () => {
    const defaultWorkspace: WorkspaceInfo = {
      id: "ws-default",
      name: "Default Hidden Workspace",
      path: "/Users/demo/.ccgui/workspace",
      connected: true,
      settings: { sidebarCollapsed: false },
    };
    const normalWorkspace: WorkspaceInfo = {
      id: "ws-normal",
      name: "Visible Workspace",
      path: "/tmp/visible-workspace",
      connected: true,
      settings: { sidebarCollapsed: false },
    };

    render(
      <SettingsView
        reduceTransparency={false}
        onToggleTransparency={vi.fn()}
        appSettings={baseSettings}
        openAppIconById={{}}
        onUpdateAppSettings={vi.fn().mockResolvedValue(undefined)}
        workspaceGroups={[]}
        groupedWorkspaces={[
          {
            id: null,
            name: "Ungrouped",
            workspaces: [defaultWorkspace, normalWorkspace],
          },
        ]}
        ungroupedLabel="Ungrouped"
        onClose={vi.fn()}
        onMoveWorkspace={vi.fn()}
        onDeleteWorkspace={vi.fn()}
        onCreateWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onRenameWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onMoveWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onDeleteWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onAssignWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onRunDoctor={vi.fn().mockResolvedValue(createDoctorResult())}
        activeWorkspace={normalWorkspace}
        activeEngine="codex"
        onUpdateWorkspaceCodexBin={vi.fn().mockResolvedValue(undefined)}
        onUpdateWorkspaceSettings={vi.fn().mockResolvedValue(undefined)}
        scaleShortcutTitle="Scale shortcut"
        scaleShortcutText="Use Command +/-"
        onTestNotificationSound={vi.fn()}
        dictationModelStatus={null}
        onDownloadDictationModel={vi.fn()}
        onCancelDictationDownload={vi.fn()}
        onRemoveDictationModel={vi.fn()}
        initialSection="projects"
      />,
    );

    await flushSettingsViewEffects();
    expect(screen.queryByText("Default Hidden Workspace")).toBeNull();
    expect(screen.getByText("Visible Workspace")).toBeTruthy();
  });
});

describe("SettingsView Display", () => {
  it("keeps codex, dictation, git, and experimental sidebar entries hidden", async () => {
    renderDisplaySection();
    await flushSettingsViewEffects();

    expect(screen.queryByRole("button", { name: "Dictation" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Git" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Codex" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Experimental" })).toBeNull();
    expect(screen.getByRole("button", { name: "settings.sidebarWebService" })).toBeTruthy();
  });

  it("removes the dead multi-agent toggle and explains local-vs-official ownership", async () => {
    cleanup();
    render(
      <SettingsView
        reduceTransparency={false}
        onToggleTransparency={vi.fn()}
        appSettings={baseSettings}
        openAppIconById={{}}
        onUpdateAppSettings={vi.fn().mockResolvedValue(undefined)}
        workspaceGroups={[]}
        groupedWorkspaces={[
          {
            id: null,
            name: "Ungrouped",
            workspaces: [
              {
                ...workspaceA,
                settings: {
                  ...workspaceA.settings,
                  codexHome: "/tmp/custom-codex-home",
                },
              },
            ],
          },
        ]}
        ungroupedLabel="Ungrouped"
        onClose={vi.fn()}
        onMoveWorkspace={vi.fn()}
        onDeleteWorkspace={vi.fn()}
        onCreateWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onRenameWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onMoveWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onDeleteWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onAssignWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onRunDoctor={vi.fn().mockResolvedValue(createDoctorResult())}
        activeWorkspace={null}
        activeEngine="codex"
        onUpdateWorkspaceCodexBin={vi.fn().mockResolvedValue(undefined)}
        onUpdateWorkspaceSettings={vi.fn().mockResolvedValue(undefined)}
        scaleShortcutTitle="Scale shortcut"
        scaleShortcutText="Use Command +/-"
        onTestNotificationSound={vi.fn()}
        dictationModelStatus={null}
        onDownloadDictationModel={vi.fn()}
        onCancelDictationDownload={vi.fn()}
        onRemoveDictationModel={vi.fn()}
        initialSection="experimental"
      />,
    );

    await flushSettingsViewEffects();

    expect(screen.queryByText("Multi-agent")).toBeNull();
    expect(screen.getByText(/Only Background terminal syncs/)).toBeTruthy();
    expect(screen.getByText(/Collaboration modes and Steer mode stay/)).toBeTruthy();
    expect(screen.getByText("Open the official Codex config in File Manager.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open in File Manager" })).toBeTruthy();
  });

  it("renders codex doctor probe metadata including proxy context", async () => {
    cleanup();
    const onRunDoctor = vi.fn().mockResolvedValue({
      ...createDoctorResult(),
      version: "1.0.0",
      path: "/usr/local/bin:/usr/bin",
      pathEnvUsed: "/usr/local/bin:/usr/bin",
      resolvedBinaryPath: "C:/Users/test/AppData/Roaming/npm/codex.cmd",
      wrapperKind: "cmd-wrapper",
      fallbackRetried: true,
      proxyEnvSnapshot: {
        HTTP_PROXY: "http://127.0.0.1:7890",
        HTTPS_PROXY: null,
      },
      appServerProbeStatus: "fallback-ok",
    });
    render(
      <SettingsView
        reduceTransparency={false}
        onToggleTransparency={vi.fn()}
        appSettings={baseSettings}
        openAppIconById={{}}
        onUpdateAppSettings={vi.fn().mockResolvedValue(undefined)}
        workspaceGroups={[]}
        groupedWorkspaces={[]}
        ungroupedLabel="Ungrouped"
        onClose={vi.fn()}
        onMoveWorkspace={vi.fn()}
        onDeleteWorkspace={vi.fn()}
        onCreateWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onRenameWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onMoveWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onDeleteWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onAssignWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onRunDoctor={onRunDoctor}
        activeWorkspace={null}
        activeEngine="codex"
        onUpdateWorkspaceCodexBin={vi.fn().mockResolvedValue(undefined)}
        onUpdateWorkspaceSettings={vi.fn().mockResolvedValue(undefined)}
        scaleShortcutTitle="Scale shortcut"
        scaleShortcutText="Use Command +/-"
        onTestNotificationSound={vi.fn()}
        dictationModelStatus={null}
        onDownloadDictationModel={vi.fn()}
        onCancelDictationDownload={vi.fn()}
        onRemoveDictationModel={vi.fn()}
        initialSection="codex"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Run doctor" }));

    await waitFor(() => {
      expect(onRunDoctor).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(document.querySelector(".settings-doctor-body")).toBeTruthy();
    });
    const doctorBodyText = document.querySelector(".settings-doctor-body")?.textContent ?? "";
    expect(doctorBodyText).toContain("App Server Probe: fallback-ok");
    expect(doctorBodyText).toContain(
      "Resolved Binary: C:/Users/test/AppData/Roaming/npm/codex.cmd",
    );
    expect(doctorBodyText).toContain("Wrapper Kind: cmd-wrapper");
    expect(doctorBodyText).toContain("Wrapper Fallback Retry: attempted");
    expect(doctorBodyText).toContain("HTTP_PROXY=http://127.0.0.1:7890");
    expect(doctorBodyText).toContain("HTTPS_PROXY=Not set");
  });

  it("updates the theme selection", async () => {
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);
    renderDisplaySection({ onUpdateAppSettings });

    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({ theme: "dark" }),
      );
    });
  });

  it("updates the canvas width mode selection", async () => {
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);
    renderDisplaySection({ onUpdateAppSettings });

    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "Wide canvas" }));
    });

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({ canvasWidthMode: "wide" }),
      );
    });
  });

  it("switches canvas width mode from wide back to narrow", async () => {
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);
    renderDisplaySection({
      onUpdateAppSettings,
      appSettings: { canvasWidthMode: "wide" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "Narrow canvas" }));
    });

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({ canvasWidthMode: "narrow" }),
      );
    });
  });

  it("updates the layout mode selection", async () => {
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);
    renderDisplaySection({ onUpdateAppSettings });

    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "Left on right" }));
    });

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({ layoutMode: "swapped" }),
      );
    });
  });

  it("switches layout mode from swapped back to default", async () => {
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);
    renderDisplaySection({
      onUpdateAppSettings,
      appSettings: { layoutMode: "swapped" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: "Default layout" }));
    });

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({ layoutMode: "default" }),
      );
    });
  });

  it("updates user message color using reference-compatible format", async () => {
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);
    const appRoot = document.createElement("div");
    appRoot.className = "app reduced-transparency";
    document.body.appendChild(appRoot);
    renderDisplaySection({ onUpdateAppSettings });

    fireEvent.click(screen.getByTestId("settings-user-msg-color-preset-6e40c9"));

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({ userMsgColor: "#6e40c9" }),
      );
    });
    expect(document.documentElement.style.getPropertyValue("--color-message-user-bg")).toBe(
      "#6e40c9",
    );
    expect(appRoot.style.getPropertyValue("--color-message-user-bg")).toBe("#6e40c9");

    fireEvent.change(screen.getByTestId("settings-user-msg-color-hex-input"), {
      target: { value: "#cf222e" },
    });

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({ userMsgColor: "#cf222e" }),
      );
    });
    expect(document.documentElement.style.getPropertyValue("--color-message-user-bg")).toBe(
      "#cf222e",
    );
    expect(appRoot.style.getPropertyValue("--color-message-user-bg")).toBe("#cf222e");

    const callCountBeforeInvalid = onUpdateAppSettings.mock.calls.length;
    fireEvent.change(screen.getByTestId("settings-user-msg-color-hex-input"), {
      target: { value: "#zzzzzz" },
    });

    expect(onUpdateAppSettings).toHaveBeenCalledTimes(callCountBeforeInvalid);
    appRoot.remove();
  });

  it("hides remaining limits, message anchors, and transparency toggles", async () => {
    renderDisplaySection();
    await flushSettingsViewEffects();

    expect(screen.queryByText("Show remaining Codex limits")).toBeNull();
    expect(screen.queryByText("Show message anchors")).toBeNull();
    expect(screen.queryByText("Reduce transparency")).toBeNull();
  });

  it("updates ui scale from slider and save action", async () => {
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);
    renderDisplaySection({ onUpdateAppSettings });

    const fontSizeSlider = screen.getByLabelText("Interface scale");

    fireEvent.change(fontSizeSlider, { target: { value: "1.36" } });
    fireEvent.click(screen.getByTestId("settings-ui-scale-save"));

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({ uiScale: 1.36 }),
      );
    });

    fireEvent.change(fontSizeSlider, { target: { value: "0.8" } });
    fireEvent.click(screen.getByTestId("settings-ui-scale-save"));

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({ uiScale: 0.8 }),
      );
    });
  });

  it("resets ui scale to 100% from settings", async () => {
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);
    renderDisplaySection({ onUpdateAppSettings, appSettings: { uiScale: 1.25 } });

    fireEvent.click(screen.getByTestId("settings-ui-scale-reset"));
    fireEvent.click(screen.getByTestId("settings-ui-scale-save"));

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({ uiScale: 1 }),
      );
    });
  });

  it("commits ui font selection and code font dropdown changes", async () => {
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);
    queryLocalFontsMock.mockResolvedValue([...mockedLocalFonts]);
    renderDisplaySection({ onUpdateAppSettings });

    const uiFontSelect = screen.getByTestId("settings-ui-font-select");
    await waitFor(() => {
      expect(within(uiFontSelect).getByRole("option", { name: "Avenir" })).toBeTruthy();
    });
    fireEvent.change(uiFontSelect, { target: { value: "Avenir" } });

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({ uiFontFamily: "Avenir" }),
      );
    });

    const codeFontSelect = screen.getByTestId("settings-code-font-select");
    fireEvent.change(codeFontSelect, { target: { value: "Avenir" } });

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({ codeFontFamily: "Avenir" }),
      );
    });
  });

  it("lists local fonts in ui/code dropdowns", async () => {
    queryLocalFontsMock.mockResolvedValue([...mockedLocalFonts]);
    renderDisplaySection();

    await waitFor(() => {
      const uiFontSelect = screen.getByTestId("settings-ui-font-select");
      const codeFontSelect = screen.getByTestId("settings-code-font-select");
      expect(within(uiFontSelect).getByRole("option", { name: "Avenir" })).toBeTruthy();
      expect(within(uiFontSelect).getByRole("option", { name: "Monaco" })).toBeTruthy();
      expect(within(codeFontSelect).getByRole("option", { name: "Avenir" })).toBeTruthy();
      expect(within(codeFontSelect).getByRole("option", { name: "Monaco" })).toBeTruthy();
    });
  });

  it("resets font families to defaults", async () => {
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);
    renderDisplaySection({ onUpdateAppSettings });

    const uiFontInput = screen.getByLabelText("UI font family");
    const uiFontRow = uiFontInput.closest(".settings-field-row");
    if (!uiFontRow) {
      throw new Error("Expected UI font row");
    }
    fireEvent.click(within(uiFontRow as HTMLElement).getByRole("button", { name: "Reset" }));

    const codeFontInput = screen.getByLabelText("Code font family");
    const codeFontRow = codeFontInput.closest(".settings-field-row");
    if (!codeFontRow) {
      throw new Error("Expected code font row");
    }
    fireEvent.click(within(codeFontRow as HTMLElement).getByRole("button", { name: "Reset" }));

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          uiFontFamily: expect.stringMatching(/^Monaco,/),
        }),
      );
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          codeFontFamily: expect.stringMatching(/^Monaco,/),
        }),
      );
    });
  });

  it("updates code font size from the slider", async () => {
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);
    renderDisplaySection({ onUpdateAppSettings });

    const slider = screen.getByLabelText("Code font size");
    fireEvent.change(slider, { target: { value: "14" } });

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({ codeFontSize: 14 }),
      );
    });
  });

  it("toggles notification sounds", async () => {
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);
    renderDisplaySection({
      onUpdateAppSettings,
      appSettings: { notificationSoundsEnabled: false },
    });

    fireEvent.click(screen.getByRole("button", { name: "Behavior" }));

    const row = screen
      .getByText("Notification sounds")
      .closest(".settings-sound-toggle-row") as HTMLElement | null;
    if (!row) {
      throw new Error("Expected notification sounds row");
    }
    fireEvent.click(within(row).getByRole("switch"));

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({ notificationSoundsEnabled: true }),
      );
    });
  });

  it("updates selected notification sound option", async () => {
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);
    renderDisplaySection({
      onUpdateAppSettings,
      appSettings: { notificationSoundsEnabled: true, notificationSoundId: "default" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Behavior" }));

    const nativeSelect = screen
      .getAllByLabelText("Notification sound")
      .find((node) => node.tagName.toLowerCase() === "select");
    if (!nativeSelect) {
      throw new Error("Expected native notification sound select");
    }
    fireEvent.change(nativeSelect, {
      target: { value: "bell" },
    });

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({ notificationSoundId: "bell" }),
      );
    });
  });

  it("auto applies network proxy when toggled on", async () => {
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);
    renderDisplaySection({
      onUpdateAppSettings,
      appSettings: { systemProxyEnabled: false, systemProxyUrl: null },
    });
    vi.mocked(pushErrorToast).mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Behavior" }));
    const proxyCard = document.querySelector(".settings-basic-proxy-card") as HTMLElement | null;
    if (!proxyCard) {
      throw new Error("Expected network proxy card");
    }
    fireEvent.change(screen.getByLabelText("settings.behaviorProxyAddress"), {
      target: { value: "http://127.0.0.1:7890" },
    });
    fireEvent.click(within(proxyCard).getByRole("switch"));

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          systemProxyEnabled: true,
          systemProxyUrl: "http://127.0.0.1:7890",
        }),
      );
    });

    expect(document.querySelector(".settings-basic-proxy-card.is-enabled")).toBeTruthy();
    expect(document.querySelector(".settings-proxy-header-badge")).toBeTruthy();
    expect(document.querySelectorAll(".settings-basic-proxy-card .proxy-status-badge")).toHaveLength(1);
    expect((await screen.findByRole("status")).textContent ?? "").toContain(
      "settings.behaviorProxyEnabledSuccess",
    );
  });

  it("auto disables network proxy when toggled off", async () => {
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);
    renderDisplaySection({
      onUpdateAppSettings,
      appSettings: {
        systemProxyEnabled: true,
        systemProxyUrl: "http://127.0.0.1:7890",
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Behavior" }));
    const proxyCard = document.querySelector(".settings-basic-proxy-card") as HTMLElement | null;
    if (!proxyCard) {
      throw new Error("Expected network proxy card");
    }

    fireEvent.click(within(proxyCard).getByRole("switch"));

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          systemProxyEnabled: false,
          systemProxyUrl: "http://127.0.0.1:7890",
        }),
      );
    });

    expect((await screen.findByRole("status")).textContent ?? "").toContain(
      "settings.behaviorProxyDisabledSuccess",
    );
  });

  it("rolls back proxy toggle and shows failure feedback when auto apply fails", async () => {
    const onUpdateAppSettings = vi.fn().mockRejectedValue(new Error("proxy apply failed"));
    renderDisplaySection({
      onUpdateAppSettings,
      appSettings: { systemProxyEnabled: false, systemProxyUrl: null },
    });

    fireEvent.click(screen.getByRole("button", { name: "Behavior" }));
    const proxyCard = document.querySelector(".settings-basic-proxy-card") as HTMLElement | null;
    if (!proxyCard) {
      throw new Error("Expected network proxy card");
    }

    fireEvent.change(screen.getByLabelText("settings.behaviorProxyAddress"), {
      target: { value: "http://127.0.0.1:7890" },
    });
    fireEvent.click(within(proxyCard).getByRole("switch"));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent ?? "").toContain("proxy apply failed");
    });

    expect(within(proxyCard).getByRole("switch").getAttribute("aria-checked")).toBe("false");
    expect(pushErrorToast).toHaveBeenCalledWith({
      title: "common.error",
      message: "proxy apply failed",
    });
  });
});

describe("SettingsView Composer", () => {
  it("updates send shortcut mode", async () => {
    const onUpdateAppSettings = vi.fn().mockResolvedValue(undefined);
    renderComposerSection({ onUpdateAppSettings });

    fireEvent.click(screen.getByRole("radio", { name: /⌘\/Ctrl\+Enter sends/i }));

    await waitFor(() => {
      expect(onUpdateAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({ composerSendShortcut: "cmdEnter" }),
      );
    });
  });
});

describe("SettingsView Session management", () => {
  it("loads session catalog entries for the active workspace", async () => {
    const workspace: WorkspaceInfo = {
      id: "ws-1",
      name: "Workspace",
      path: "/tmp/workspace",
      connected: true,
      settings: { sidebarCollapsed: false },
    };

    vi.mocked(listWorkspaceSessions).mockResolvedValue({
      data: [
        {
          sessionId: "codex:thread-a",
          workspaceId: "ws-1",
          title: "Session A",
          updatedAt: 1710000000000,
          engine: "codex",
          archivedAt: null,
          threadKind: "native",
          sourceLabel: "cli/codex",
        },
      ],
      nextCursor: null,
      partialSource: null,
    });

    render(
      <SettingsView
        workspaceGroups={[]}
        groupedWorkspaces={[{ id: null, name: "Ungrouped", workspaces: [workspace] }]}
        ungroupedLabel="Ungrouped"
        onClose={vi.fn()}
        onMoveWorkspace={vi.fn()}
        onDeleteWorkspace={vi.fn()}
        onCreateWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onRenameWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onMoveWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onDeleteWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onAssignWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        reduceTransparency={false}
        onToggleTransparency={vi.fn()}
        appSettings={baseSettings}
        openAppIconById={{}}
        onUpdateAppSettings={vi.fn().mockResolvedValue(undefined)}
        onRunDoctor={vi.fn().mockResolvedValue(createDoctorResult())}
        activeWorkspace={workspace}
        activeEngine="codex"
        onUpdateWorkspaceCodexBin={vi.fn().mockResolvedValue(undefined)}
        onUpdateWorkspaceSettings={vi.fn().mockResolvedValue(undefined)}
        scaleShortcutTitle="Scale shortcut"
        scaleShortcutText="Use Command +/-"
        onTestNotificationSound={vi.fn()}
        dictationModelStatus={null}
        onDownloadDictationModel={vi.fn()}
        onCancelDictationDownload={vi.fn()}
        onRemoveDictationModel={vi.fn()}
        initialSection="session-management"
      />,
    );

    await waitFor(() => {
      expect(listWorkspaceSessions).toHaveBeenCalledWith("ws-1", {
        query: { keyword: null, engine: null, status: "active" },
        cursor: null,
        limit: 100,
      });
    });
    expect(await screen.findByText("Session A")).toBeTruthy();
  });

  it("deletes selected sessions and triggers workspace refresh", async () => {
    const workspace: WorkspaceInfo = {
      id: "ws-1",
      name: "Workspace",
      path: "/tmp/workspace",
      connected: true,
      settings: { sidebarCollapsed: false },
    };
    const onEnsureWorkspaceThreads = vi.fn();

    vi.mocked(listWorkspaceSessions).mockResolvedValue({
      data: [
        {
          sessionId: "codex:thread-a",
          workspaceId: "ws-1",
          title: "Session A",
          updatedAt: 1710000000000,
          engine: "codex",
          archivedAt: null,
          threadKind: "native",
          sourceLabel: "cli/codex",
        },
      ],
      nextCursor: null,
      partialSource: null,
    });
    vi.mocked(deleteWorkspaceSessions).mockResolvedValue({
      results: [{ sessionId: "codex:thread-a", ok: true }],
    });

    render(
      <SettingsView
        workspaceGroups={[]}
        groupedWorkspaces={[{ id: null, name: "Ungrouped", workspaces: [workspace] }]}
        ungroupedLabel="Ungrouped"
        onClose={vi.fn()}
        onMoveWorkspace={vi.fn()}
        onDeleteWorkspace={vi.fn()}
        onCreateWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onRenameWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onMoveWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onDeleteWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onAssignWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        reduceTransparency={false}
        onToggleTransparency={vi.fn()}
        appSettings={baseSettings}
        openAppIconById={{}}
        onUpdateAppSettings={vi.fn().mockResolvedValue(undefined)}
        onRunDoctor={vi.fn().mockResolvedValue(createDoctorResult())}
        activeWorkspace={workspace}
        activeEngine="codex"
        onUpdateWorkspaceCodexBin={vi.fn().mockResolvedValue(undefined)}
        onUpdateWorkspaceSettings={vi.fn().mockResolvedValue(undefined)}
        onEnsureWorkspaceThreads={onEnsureWorkspaceThreads}
        scaleShortcutTitle="Scale shortcut"
        scaleShortcutText="Use Command +/-"
        onTestNotificationSound={vi.fn()}
        dictationModelStatus={null}
        onDownloadDictationModel={vi.fn()}
        onCancelDictationDownload={vi.fn()}
        onRemoveDictationModel={vi.fn()}
        initialSection="session-management"
      />,
    );

    const checkbox = await screen.findByRole("checkbox", { name: "Session A" });
    fireEvent.click(checkbox);

    const deleteButton = screen.getByTestId("settings-project-sessions-delete-selected");
    fireEvent.click(deleteButton);
    fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(deleteWorkspaceSessions).toHaveBeenCalledWith("ws-1", ["codex:thread-a"]);
    });
    await waitFor(() => {
      expect(onEnsureWorkspaceThreads).toHaveBeenCalledWith("ws-1");
    });
  });

  it("toggles the session management section body", async () => {
    const workspace: WorkspaceInfo = {
      id: "ws-1",
      name: "Workspace",
      path: "/tmp/workspace",
      connected: true,
      settings: { sidebarCollapsed: false },
    };

    vi.mocked(listWorkspaceSessions).mockResolvedValue({
      data: [
        {
          sessionId: "codex:thread-a",
          workspaceId: "ws-1",
          title: "Session A",
          updatedAt: 1710000000000,
          engine: "codex",
          archivedAt: null,
          threadKind: "native",
          sourceLabel: "cli/codex",
        },
      ],
      nextCursor: null,
      partialSource: null,
    });

    render(
      <SettingsView
        workspaceGroups={[]}
        groupedWorkspaces={[{ id: null, name: "Ungrouped", workspaces: [workspace] }]}
        ungroupedLabel="Ungrouped"
        onClose={vi.fn()}
        onMoveWorkspace={vi.fn()}
        onDeleteWorkspace={vi.fn()}
        onCreateWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onRenameWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onMoveWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onDeleteWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onAssignWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        reduceTransparency={false}
        onToggleTransparency={vi.fn()}
        appSettings={baseSettings}
        openAppIconById={{}}
        onUpdateAppSettings={vi.fn().mockResolvedValue(undefined)}
        onRunDoctor={vi.fn().mockResolvedValue(createDoctorResult())}
        activeWorkspace={workspace}
        activeEngine="codex"
        onUpdateWorkspaceCodexBin={vi.fn().mockResolvedValue(undefined)}
        onUpdateWorkspaceSettings={vi.fn().mockResolvedValue(undefined)}
        scaleShortcutTitle="Scale shortcut"
        scaleShortcutText="Use Command +/-"
        onTestNotificationSound={vi.fn()}
        dictationModelStatus={null}
        onDownloadDictationModel={vi.fn()}
        onCancelDictationDownload={vi.fn()}
        onRemoveDictationModel={vi.fn()}
        initialSection="session-management"
      />,
    );

    expect(await screen.findByText("Session A")).toBeTruthy();

    const toggleButton = screen.getByTestId("settings-project-sessions-expand-toggle");
    fireEvent.click(toggleButton);
    expect(screen.queryByText("Session A")).toBeNull();

    fireEvent.click(toggleButton);
    expect(await screen.findByText("Session A")).toBeTruthy();
  });
});

describe("SettingsView Codex overrides", () => {
  it("updates workspace Codex args override on blur", async () => {
    const onUpdateWorkspaceSettings = vi.fn().mockResolvedValue(undefined);
    const workspace: WorkspaceInfo = {
      id: "w1",
      name: "Workspace",
      path: "/tmp/workspace",
      connected: false,
      codex_bin: null,
      kind: "main",
      parentId: null,
      worktree: null,
      settings: { sidebarCollapsed: false, codexArgs: null },
    };

    render(
      <SettingsView
        workspaceGroups={[]}
        groupedWorkspaces={[
          { id: null, name: "Ungrouped", workspaces: [workspace] },
        ]}
        ungroupedLabel="Ungrouped"
        onClose={vi.fn()}
        onMoveWorkspace={vi.fn()}
        onDeleteWorkspace={vi.fn()}
        onCreateWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onRenameWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onMoveWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onDeleteWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onAssignWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        reduceTransparency={false}
        onToggleTransparency={vi.fn()}
        appSettings={baseSettings}
        openAppIconById={{}}
        onUpdateAppSettings={vi.fn().mockResolvedValue(undefined)}
        onRunDoctor={vi.fn().mockResolvedValue(createDoctorResult())}
        activeWorkspace={workspace}
        activeEngine="codex"
        onUpdateWorkspaceCodexBin={vi.fn().mockResolvedValue(undefined)}
        onUpdateWorkspaceSettings={onUpdateWorkspaceSettings}
        scaleShortcutTitle="Scale shortcut"
        scaleShortcutText="Use Command +/-"
        onTestNotificationSound={vi.fn()}
        dictationModelStatus={null}
        onDownloadDictationModel={vi.fn()}
        onCancelDictationDownload={vi.fn()}
        onRemoveDictationModel={vi.fn()}
        initialSection="codex"
      />,
    );

    const input = screen.getByLabelText("Codex args override for Workspace");
    fireEvent.change(input, { target: { value: "--profile dev" } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(onUpdateWorkspaceSettings).toHaveBeenCalledWith("w1", {
        codexArgs: "--profile dev",
      });
    });
  });
});

describe("SettingsView Shortcuts", () => {
  it("closes when clicking back to app", async () => {
    const onClose = vi.fn();
    render(
      <SettingsView
        workspaceGroups={[]}
        groupedWorkspaces={[]}
        ungroupedLabel="Ungrouped"
        onClose={onClose}
        onMoveWorkspace={vi.fn()}
        onDeleteWorkspace={vi.fn()}
        onCreateWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onRenameWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onMoveWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onDeleteWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onAssignWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        reduceTransparency={false}
        onToggleTransparency={vi.fn()}
        appSettings={baseSettings}
        openAppIconById={{}}
        onUpdateAppSettings={vi.fn().mockResolvedValue(undefined)}
        onRunDoctor={vi.fn().mockResolvedValue(createDoctorResult())}
        activeWorkspace={null}
        activeEngine="codex"
        onUpdateWorkspaceCodexBin={vi.fn().mockResolvedValue(undefined)}
        onUpdateWorkspaceSettings={vi.fn().mockResolvedValue(undefined)}
        scaleShortcutTitle="Scale shortcut"
        scaleShortcutText="Use Command +/-"
        onTestNotificationSound={vi.fn()}
        dictationModelStatus={null}
        onDownloadDictationModel={vi.fn()}
        onCancelDictationDownload={vi.fn()}
        onRemoveDictationModel={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Back to app" }));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it("closes on Cmd+W", async () => {
    let unmount = () => {};
    const onClose = vi.fn(() => {
      unmount();
    });
    const rendered = render(
      <SettingsView
        workspaceGroups={[]}
        groupedWorkspaces={[]}
        ungroupedLabel="Ungrouped"
        onClose={onClose}
        onMoveWorkspace={vi.fn()}
        onDeleteWorkspace={vi.fn()}
        onCreateWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onRenameWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onMoveWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onDeleteWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onAssignWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        reduceTransparency={false}
        onToggleTransparency={vi.fn()}
        appSettings={baseSettings}
        openAppIconById={{}}
        onUpdateAppSettings={vi.fn().mockResolvedValue(undefined)}
        onRunDoctor={vi.fn().mockResolvedValue(createDoctorResult())}
        activeWorkspace={null}
        activeEngine="codex"
        onUpdateWorkspaceCodexBin={vi.fn().mockResolvedValue(undefined)}
        onUpdateWorkspaceSettings={vi.fn().mockResolvedValue(undefined)}
        scaleShortcutTitle="Scale shortcut"
        scaleShortcutText="Use Command +/-"
        onTestNotificationSound={vi.fn()}
        dictationModelStatus={null}
        onDownloadDictationModel={vi.fn()}
        onCancelDictationDownload={vi.fn()}
        onRemoveDictationModel={vi.fn()}
      />,
    );
    unmount = rendered.unmount;

    fireEvent.keyDown(window, { key: "w", metaKey: true, bubbles: true });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("closes on Escape", async () => {
    let unmount = () => {};
    const onClose = vi.fn(() => {
      unmount();
    });
    const rendered = render(
      <SettingsView
        workspaceGroups={[]}
        groupedWorkspaces={[]}
        ungroupedLabel="Ungrouped"
        onClose={onClose}
        onMoveWorkspace={vi.fn()}
        onDeleteWorkspace={vi.fn()}
        onCreateWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onRenameWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onMoveWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onDeleteWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        onAssignWorkspaceGroup={vi.fn().mockResolvedValue(null)}
        reduceTransparency={false}
        onToggleTransparency={vi.fn()}
        appSettings={baseSettings}
        openAppIconById={{}}
        onUpdateAppSettings={vi.fn().mockResolvedValue(undefined)}
        onRunDoctor={vi.fn().mockResolvedValue(createDoctorResult())}
        activeWorkspace={null}
        activeEngine="codex"
        onUpdateWorkspaceCodexBin={vi.fn().mockResolvedValue(undefined)}
        onUpdateWorkspaceSettings={vi.fn().mockResolvedValue(undefined)}
        scaleShortcutTitle="Scale shortcut"
        scaleShortcutText="Use Command +/-"
        onTestNotificationSound={vi.fn()}
        dictationModelStatus={null}
        onDownloadDictationModel={vi.fn()}
        onCancelDictationDownload={vi.fn()}
        onRemoveDictationModel={vi.fn()}
      />,
    );
    unmount = rendered.unmount;

    fireEvent.keyDown(window, { key: "Escape", bubbles: true });

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });
});
