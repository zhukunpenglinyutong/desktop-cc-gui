// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings, CodexDoctorResult } from "../../../types";
import { useAppSettings } from "./useAppSettings";
import {
  getAppSettings,
  runClaudeDoctor,
  runCodexDoctor,
  updateAppSettings,
} from "../../../services/tauri";
import { UI_SCALE_DEFAULT, UI_SCALE_MAX } from "../../../utils/uiScale";

vi.mock("../../../services/tauri", () => ({
  getAppSettings: vi.fn(),
  updateAppSettings: vi.fn(),
  runClaudeDoctor: vi.fn(),
  runCodexDoctor: vi.fn(),
}));

const getAppSettingsMock = vi.mocked(getAppSettings);
const runClaudeDoctorMock = vi.mocked(runClaudeDoctor);
const updateAppSettingsMock = vi.mocked(updateAppSettings);
const runCodexDoctorMock = vi.mocked(runCodexDoctor);

describe("useAppSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("loads settings and normalizes theme + uiScale", async () => {
    getAppSettingsMock.mockResolvedValue(
      {
        uiScale: UI_SCALE_MAX + 1,
        theme: "nope" as unknown as AppSettings["theme"],
        lightThemePresetId: "vscode-dark-plus" as unknown as AppSettings["lightThemePresetId"],
        darkThemePresetId: "vscode-light-plus" as unknown as AppSettings["darkThemePresetId"],
        canvasWidthMode: "invalid" as unknown as AppSettings["canvasWidthMode"],
        layoutMode: "invalid" as unknown as NonNullable<AppSettings["layoutMode"]>,
        userMsgColor: "#XYZXYZ",
        backendMode: "remote",
        remoteBackendHost: "example:1234",
        uiFontFamily: "",
        codeFontFamily: "  ",
        codeFontSize: 25,
        experimentalUnifiedExecEnabled: true,
        codexAutoCompactionEnabled: undefined,
        codexAutoCompactionThresholdPercent: 93,
      } as unknown as AppSettings,
    );

    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.settings.uiScale).toBe(UI_SCALE_DEFAULT);
    expect(result.current.settings.theme).toBe("system");
    expect(result.current.settings.lightThemePresetId).toBe("vscode-light-modern");
    expect(result.current.settings.darkThemePresetId).toBe("vscode-dark-modern");
    expect(result.current.settings.canvasWidthMode).toBe("narrow");
    expect(result.current.settings.layoutMode).toBe("default");
    expect(result.current.settings.userMsgColor).toBe("");
    expect(result.current.settings.uiFontFamily).toMatch(/^Monaco,/);
    expect(result.current.settings.codeFontFamily).toMatch(/^Monaco,/);
    expect(result.current.settings.codeFontSize).toBe(16);
    expect(result.current.settings.codexUnifiedExecPolicy).toBe("inherit");
    expect(result.current.settings.backendMode).toBe("remote");
    expect(result.current.settings.remoteBackendHost).toBe("example:1234");
    expect(result.current.settings.claudeBin).toBeNull();
    expect(result.current.settings.codexAutoCompactionEnabled).toBe(true);
    expect(result.current.settings.codexAutoCompactionThresholdPercent).toBe(92);
    expect(result.current.settings.performanceCompatibilityModeEnabled).toBe(false);
  });

  it("preserves explicitly enabled performance compatibility mode", async () => {
    getAppSettingsMock.mockResolvedValue({
      performanceCompatibilityModeEnabled: true,
    } as AppSettings);

    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.settings.performanceCompatibilityModeEnabled).toBe(true);
  });

  it("preserves disabled Codex auto-compaction", async () => {
    getAppSettingsMock.mockResolvedValue({
      codexAutoCompactionEnabled: false,
      codexAutoCompactionThresholdPercent: 150,
    } as AppSettings);

    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.settings.codexAutoCompactionEnabled).toBe(false);
    expect(result.current.settings.codexAutoCompactionThresholdPercent).toBe(150);
  });

  it("keeps supported Codex auto-compaction thresholds", async () => {
    getAppSettingsMock.mockResolvedValue({
      codexAutoCompactionThresholdPercent: 150,
    } as AppSettings);

    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.settings.codexAutoCompactionThresholdPercent).toBe(150);
  });

  it("normalizes terminal shell path while loading settings", async () => {
    getAppSettingsMock.mockResolvedValue({
      terminalShellPath: "  C:\\Program Files\\PowerShell\\7\\pwsh.exe  ",
    } as AppSettings);

    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.settings.terminalShellPath).toBe(
      "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
    );
  });

  it("normalizes blank terminal shell path to null while loading settings", async () => {
    getAppSettingsMock.mockResolvedValue({
      terminalShellPath: "   ",
    } as AppSettings);

    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.settings.terminalShellPath).toBeNull();
  });

  it("upgrades legacy warm ttl to the current startup default when loading", async () => {
    getAppSettingsMock.mockResolvedValue({
      codexWarmTtlSeconds: 300,
    } as AppSettings);

    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.settings.codexWarmTtlSeconds).toBe(7200);
  });

  it("upgrades legacy realtime and history curtain flags to the normalized defaults", async () => {
    getAppSettingsMock.mockResolvedValue({
      chatCanvasUseNormalizedRealtime: false,
      chatCanvasUseUnifiedHistoryLoader: false,
    } as AppSettings);

    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.settings.chatCanvasUseNormalizedRealtime).toBe(true);
    expect(result.current.settings.chatCanvasUseUnifiedHistoryLoader).toBe(true);
  });

  it("preserves an explicitly cleared global search shortcut", async () => {
    getAppSettingsMock.mockResolvedValue({
      toggleGlobalSearchShortcut: null,
    } as AppSettings);

    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.settings.toggleGlobalSearchShortcut).toBeNull();
  });

  it("preserves dim theme while sanitizing preset ids into valid appearance slots", async () => {
    getAppSettingsMock.mockResolvedValue({
      theme: "dim",
      lightThemePresetId: "vscode-dark-plus" as unknown as AppSettings["lightThemePresetId"],
      darkThemePresetId: "vscode-light-plus" as unknown as AppSettings["darkThemePresetId"],
    } as AppSettings);

    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.settings.theme).toBe("dim");
    expect(result.current.settings.lightThemePresetId).toBe("vscode-light-modern");
    expect(result.current.settings.darkThemePresetId).toBe("vscode-dark-modern");
  });

  it("keeps defaults when getAppSettings fails", async () => {
    getAppSettingsMock.mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.settings.uiScale).toBe(UI_SCALE_DEFAULT);
    expect(result.current.settings.theme).toBe("system");
    expect(result.current.settings.uiFontFamily).toMatch(/^Monaco,/);
    expect(result.current.settings.codeFontFamily).toMatch(/^Monaco,/);
    expect(result.current.settings.backendMode).toBe("local");
    expect(result.current.settings.dictationModelId).toBe("base");
    expect(result.current.settings.interruptShortcut).toBeTruthy();
    expect(result.current.settings.performanceCompatibilityModeEnabled).toBe(false);
  });

  it("persists settings via updateAppSettings and updates local state", async () => {
    getAppSettingsMock.mockResolvedValue({} as AppSettings);
    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const next: AppSettings = {
      ...result.current.settings,
      codexArgs: "--profile dev",
      theme: "nope" as unknown as AppSettings["theme"],
      lightThemePresetId: "vscode-dark-modern" as unknown as AppSettings["lightThemePresetId"],
      darkThemePresetId: "vscode-light-modern" as unknown as AppSettings["darkThemePresetId"],
      uiScale: 0.04,
      uiFontFamily: "",
      codeFontFamily: "  ",
      codeFontSize: 2,
      notificationSoundsEnabled: false,
      codexAutoCompactionEnabled: false,
      codexAutoCompactionThresholdPercent: 95,
    };
    const saved: AppSettings = {
      ...result.current.settings,
      codexArgs: "--profile dev",
      theme: "dark",
      lightThemePresetId: "vscode-light-modern",
      darkThemePresetId: "vscode-dark-modern",
      uiScale: 1.25,
      uiFontFamily: "Avenir, sans-serif",
      codeFontFamily: "JetBrains Mono, monospace",
      codeFontSize: 13,
      notificationSoundsEnabled: false,
    };
    updateAppSettingsMock.mockResolvedValue(saved);

    let returned: AppSettings | undefined;
    await act(async () => {
      returned = await result.current.saveSettings(next);
    });

    expect(updateAppSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        theme: "system",
        lightThemePresetId: "vscode-light-modern",
        darkThemePresetId: "vscode-dark-modern",
        uiScale: 0.8,
        uiFontFamily: expect.stringMatching(/^Monaco,/),
        codeFontFamily: expect.stringMatching(/^Monaco,/),
        codeFontSize: 9,
        notificationSoundsEnabled: false,
        codexAutoCompactionEnabled: false,
        codexAutoCompactionThresholdPercent: 92,
      }),
    );
    expect(returned).toEqual(saved);
    expect(result.current.settings.theme).toBe("dark");
    expect(result.current.settings.uiScale).toBe(1.25);
  });

  it("sanitizes preset slots before persisting settings", async () => {
    getAppSettingsMock.mockResolvedValue({} as AppSettings);
    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    updateAppSettingsMock.mockResolvedValue({
      ...result.current.settings,
      theme: "dim",
      lightThemePresetId: "vscode-light-plus",
      darkThemePresetId: "vscode-dark-plus",
    });

    await act(async () => {
      await result.current.saveSettings({
        ...result.current.settings,
        theme: "dim",
        lightThemePresetId: "vscode-dark-plus" as unknown as AppSettings["lightThemePresetId"],
        darkThemePresetId: "vscode-light-plus" as unknown as AppSettings["darkThemePresetId"],
      });
    });

    expect(updateAppSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        theme: "dim",
        lightThemePresetId: "vscode-light-modern",
        darkThemePresetId: "vscode-dark-modern",
      }),
    );
  });

  it("surfaces doctor errors", async () => {
    getAppSettingsMock.mockResolvedValue({} as AppSettings);
    runCodexDoctorMock.mockRejectedValue(new Error("doctor fail"));
    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await expect(result.current.doctor("/bin/codex", "--profile test")).rejects.toThrow(
      "doctor fail",
    );
    expect(runCodexDoctorMock).toHaveBeenCalledWith(
      "/bin/codex",
      "--profile test",
    );
  });

  it("returns doctor results", async () => {
    getAppSettingsMock.mockResolvedValue({} as AppSettings);
    const response: CodexDoctorResult = {
      ok: true,
      codexBin: "/bin/codex",
      version: "1.0.0",
      appServerOk: true,
      details: null,
      path: null,
      nodeOk: true,
      nodeVersion: "20.0.0",
      nodeDetails: null,
    };
    runCodexDoctorMock.mockResolvedValue(response);
    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await expect(result.current.doctor("/bin/codex", null)).resolves.toEqual(
      response,
    );
  });

  it("returns claude doctor results", async () => {
    getAppSettingsMock.mockResolvedValue({} as AppSettings);
    const response: CodexDoctorResult = {
      ok: true,
      codexBin: "/bin/claude",
      version: "0.9.0",
      appServerOk: false,
      details: null,
      path: null,
      nodeOk: true,
      nodeVersion: "20.0.0",
      nodeDetails: null,
    };
    runClaudeDoctorMock.mockResolvedValue(response);
    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await expect(result.current.claudeDoctor("/bin/claude")).resolves.toEqual(response);
    expect(runClaudeDoctorMock).toHaveBeenCalledWith("/bin/claude");
  });

  it("uses legacy localStorage user message color when settings value is missing", async () => {
    window.localStorage.setItem("userMsgColor", "#6E40C9");
    getAppSettingsMock.mockResolvedValue({} as AppSettings);

    const { result } = renderHook(() => useAppSettings());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.settings.userMsgColor).toBe("#6e40c9");
  });
});
