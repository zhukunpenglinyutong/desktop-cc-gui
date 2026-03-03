// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  subscribeRuntimeLogExited,
  subscribeRuntimeLogStatus,
  subscribeTerminalOutput,
  type TerminalOutputEvent,
} from "../../../services/events";
import {
  closeTerminalSession,
  openTerminalSession,
  runtimeLogMarkExit,
  runtimeLogGetSession,
  runtimeLogStart,
  runtimeLogStop,
  writeTerminalSession,
} from "../../../services/tauri";
import type { WorkspaceInfo } from "../../../types";
import { useWorkspaceRuntimeRun } from "./useWorkspaceRuntimeRun";

vi.mock("../../../services/tauri", () => ({
  openTerminalSession: vi.fn(),
  writeTerminalSession: vi.fn(),
  closeTerminalSession: vi.fn(),
  runtimeLogStart: vi.fn(),
  runtimeLogStop: vi.fn(),
  runtimeLogGetSession: vi.fn(),
  runtimeLogMarkExit: vi.fn(),
}));

vi.mock("../../../services/events", () => ({
  subscribeTerminalOutput: vi.fn(),
  subscribeRuntimeLogStatus: vi.fn(),
  subscribeRuntimeLogExited: vi.fn(),
}));

const baseWorkspace: WorkspaceInfo = {
  id: "workspace-1",
  name: "Workspace",
  path: "/tmp/workspace",
  connected: true,
  settings: { sidebarCollapsed: false },
};
const secondWorkspace: WorkspaceInfo = {
  id: "workspace-2",
  name: "Workspace 2",
  path: "/tmp/workspace-2",
  connected: true,
  settings: { sidebarCollapsed: false },
};

let terminalOutputListener: ((event: TerminalOutputEvent) => void) | null = null;

beforeEach(() => {
  terminalOutputListener = null;
  Object.defineProperty(globalThis.navigator, "clipboard", {
    value: {
      writeText: vi.fn(async () => undefined),
    },
    configurable: true,
  });
  vi.mocked(openTerminalSession).mockResolvedValue({ id: "runtime-console" });
  vi.mocked(writeTerminalSession).mockResolvedValue(undefined);
  vi.mocked(closeTerminalSession).mockResolvedValue(undefined);
  vi.mocked(runtimeLogStart).mockResolvedValue({
    workspaceId: "workspace-1",
    terminalId: "runtime-console",
    status: "running",
    commandPreview: "./mvnw spring-boot:run",
    startedAtMs: Date.now(),
    stoppedAtMs: null,
    exitCode: null,
    error: null,
  });
  vi.mocked(runtimeLogStop).mockResolvedValue({
    workspaceId: "workspace-1",
    terminalId: "runtime-console",
    status: "stopped",
    commandPreview: "./mvnw spring-boot:run",
    startedAtMs: Date.now(),
    stoppedAtMs: Date.now(),
    exitCode: 130,
    error: null,
  });
  vi.mocked(runtimeLogGetSession).mockResolvedValue(null);
  vi.mocked(runtimeLogMarkExit).mockResolvedValue({
    workspaceId: "workspace-1",
    terminalId: "runtime-console",
    status: "stopped",
    commandPreview: "./mvnw spring-boot:run",
    startedAtMs: Date.now(),
    stoppedAtMs: Date.now(),
    exitCode: 0,
    error: null,
  });
  vi.mocked(subscribeTerminalOutput).mockImplementation((listener) => {
    terminalOutputListener = listener;
    return () => {
      terminalOutputListener = null;
    };
  });
  vi.mocked(subscribeRuntimeLogStatus).mockImplementation(() => () => undefined);
  vi.mocked(subscribeRuntimeLogExited).mockImplementation(() => () => undefined);
});

describe("useWorkspaceRuntimeRun", () => {
  it("opens runtime console without starting runtime session", () => {
    const { result } = renderHook(() =>
      useWorkspaceRuntimeRun({
        activeWorkspace: baseWorkspace,
      }),
    );

    expect(result.current.runtimeConsoleVisible).toBe(false);

    act(() => {
      result.current.onOpenRuntimeConsole();
    });

    expect(result.current.runtimeConsoleVisible).toBe(true);
    expect(result.current.runtimeConsoleStatus).toBe("idle");
    expect(result.current.runtimeCommandPresetId).toBe("auto");
    expect(result.current.runtimeCommandInput).toBe("");
    expect(runtimeLogStart).not.toHaveBeenCalled();
  });

  it("starts runtime session and writes java run script", async () => {
    const { result } = renderHook(() =>
      useWorkspaceRuntimeRun({
        activeWorkspace: baseWorkspace,
      }),
    );

    await act(async () => {
      await result.current.onRunProject();
    });

    expect(result.current.runtimeConsoleVisible).toBe(true);
    expect(result.current.runtimeConsoleStatus).toBe("running");
    expect(runtimeLogStart).toHaveBeenCalledWith("workspace-1", {
      commandOverride: null,
    });
  });

  it("passes selected command preset as command override", async () => {
    const { result } = renderHook(() =>
      useWorkspaceRuntimeRun({
        activeWorkspace: baseWorkspace,
      }),
    );

    act(() => {
      result.current.onSelectRuntimeCommandPreset("maven-system");
    });

    expect(result.current.runtimeCommandPresetId).toBe("maven-system");
    expect(result.current.runtimeCommandInput).toBe("mvn spring-boot:run");

    await act(async () => {
      await result.current.onRunProject();
    });

    expect(runtimeLogStart).toHaveBeenCalledWith("workspace-1", {
      commandOverride: "mvn spring-boot:run",
    });
  });

  it("uses edited command input as custom override", async () => {
    const { result } = renderHook(() =>
      useWorkspaceRuntimeRun({
        activeWorkspace: baseWorkspace,
      }),
    );

    act(() => {
      result.current.onChangeRuntimeCommandInput(
        "mvn spring-boot:run -Dspring-boot.run.profiles=dev",
      );
    });

    expect(result.current.runtimeCommandPresetId).toBe("custom");

    await act(async () => {
      await result.current.onRunProject();
    });

    expect(runtimeLogStart).toHaveBeenCalledWith("workspace-1", {
      commandOverride: "mvn spring-boot:run -Dspring-boot.run.profiles=dev",
    });
  });

  it("appends runtime logs from terminal-output event stream", async () => {
    const { result } = renderHook(() =>
      useWorkspaceRuntimeRun({
        activeWorkspace: baseWorkspace,
      }),
    );

    await act(async () => {
      await result.current.onRunProject();
    });

    act(() => {
      terminalOutputListener?.({
        workspaceId: "workspace-1",
        terminalId: "runtime-console",
        data: "Hello runtime log\n",
      });
    });

    await waitFor(() => {
      expect(result.current.runtimeConsoleLog).toContain("Hello runtime log");
    });
  });

  it("supports stop, clear, and close console actions", async () => {
    const { result } = renderHook(() =>
      useWorkspaceRuntimeRun({
        activeWorkspace: baseWorkspace,
      }),
    );

    await act(async () => {
      await result.current.onRunProject();
    });

    act(() => {
      terminalOutputListener?.({
        workspaceId: "workspace-1",
        terminalId: "runtime-console",
        data: "line-1\n",
      });
    });

    await waitFor(() => {
      expect(result.current.runtimeConsoleLog).toContain("line-1");
    });

    await act(async () => {
      await result.current.onStopProject();
    });

    expect(runtimeLogStop).toHaveBeenCalledWith("workspace-1");
    expect(result.current.runtimeConsoleStatus).toBe("stopped");

    await act(async () => {
      await result.current.onCopyRuntimeLogs();
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalled();

    act(() => {
      result.current.onClearRuntimeLogs();
    });
    expect(result.current.runtimeConsoleLog).toBe("");
    expect(result.current.runtimeConsoleTruncated).toBe(false);

    act(() => {
      result.current.onToggleRuntimeAutoScroll();
    });
    expect(result.current.runtimeAutoScroll).toBe(false);
    expect(result.current.runtimeWrapLines).toBe(true);

    act(() => {
      result.current.onToggleRuntimeWrapLines();
    });
    expect(result.current.runtimeWrapLines).toBe(false);

    act(() => {
      result.current.onCloseRuntimeConsole();
    });
    expect(result.current.runtimeConsoleVisible).toBe(false);
  });

  it("captures exit code marker from output stream", async () => {
    const { result } = renderHook(() =>
      useWorkspaceRuntimeRun({
        activeWorkspace: baseWorkspace,
      }),
    );

    await act(async () => {
      await result.current.onRunProject();
    });

    act(() => {
      terminalOutputListener?.({
        workspaceId: "workspace-1",
        terminalId: "runtime-console",
        data: "[CodeMoss Run] __EXIT__:1\n",
      });
    });

    await waitFor(() => {
      expect(result.current.runtimeConsoleStatus).toBe("error");
      expect(result.current.runtimeConsoleExitCode).toBe(1);
    });
    expect(runtimeLogMarkExit).toHaveBeenCalledWith("workspace-1", 1);
  });

  it("marks runtime log as truncated when line buffer exceeds limit", async () => {
    const { result } = renderHook(() =>
      useWorkspaceRuntimeRun({
        activeWorkspace: baseWorkspace,
      }),
    );

    await act(async () => {
      await result.current.onRunProject();
    });

    const manyLines = `${Array.from({ length: 5200 }, (_, index) => `line-${index}`).join("\n")}\n`;

    act(() => {
      terminalOutputListener?.({
        workspaceId: "workspace-1",
        terminalId: "runtime-console",
        data: manyLines,
      });
    });

    await waitFor(() => {
      expect(result.current.runtimeConsoleTruncated).toBe(true);
    });
    expect(result.current.runtimeConsoleLog).toContain("line-5199");
    expect(result.current.runtimeConsoleLog).not.toContain("line-0");
  });

  it("keeps runtime logs isolated between workspaces", async () => {
    const { result, rerender } = renderHook(
      ({ activeWorkspace }: { activeWorkspace: WorkspaceInfo | null }) =>
        useWorkspaceRuntimeRun({
          activeWorkspace,
        }),
      {
        initialProps: { activeWorkspace: baseWorkspace },
      },
    );

    await act(async () => {
      await result.current.onRunProject();
    });

    act(() => {
      terminalOutputListener?.({
        workspaceId: "workspace-1",
        terminalId: "runtime-console",
        data: "ws1-line-1\n",
      });
    });

    await waitFor(() => {
      expect(result.current.runtimeConsoleLog).toContain("ws1-line-1");
    });

    rerender({ activeWorkspace: secondWorkspace });
    expect(result.current.runtimeConsoleLog).toBe("");

    act(() => {
      terminalOutputListener?.({
        workspaceId: "workspace-1",
        terminalId: "runtime-console",
        data: "ws1-line-2\n",
      });
    });

    expect(result.current.runtimeConsoleLog).toBe("");

    rerender({ activeWorkspace: baseWorkspace });
    await waitFor(() => {
      expect(result.current.runtimeConsoleLog).toContain("ws1-line-2");
    });
  });
});
