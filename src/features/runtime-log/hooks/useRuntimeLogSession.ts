import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TerminalOutputEvent } from "../../../services/events";
import {
  subscribeRuntimeLogExited,
  subscribeRuntimeLogStatus,
  subscribeTerminalOutput,
} from "../../../services/events";
import {
  closeTerminalSession,
  openTerminalSession,
  runtimeLogGetSession,
  runtimeLogMarkExit,
  runtimeLogStart,
  runtimeLogStop,
  type RuntimeLogSessionSnapshot,
  type RuntimeLogSessionStatus,
  writeTerminalSession,
} from "../../../services/tauri";
import type { WorkspaceInfo } from "../../../types";
import { isWindowsPlatform } from "../../../utils/platform";

const RUNTIME_TERMINAL_ID = "runtime-console";
const DEFAULT_TERMINAL_COLS = 120;
const DEFAULT_TERMINAL_ROWS = 32;
const MAX_LOG_LINES = 5000;
const EXIT_CODE_PATTERN = /\[CodeMoss Run\] __EXIT__:(-?\d+)/;
const IS_WINDOWS_RUNTIME = isWindowsPlatform();

export type RuntimeConsoleStatus = "idle" | "starting" | "running" | "stopped" | "error";
export type RuntimeCommandPresetId =
  | "auto"
  | "maven-wrapper"
  | "maven-system"
  | "gradle-wrapper"
  | "gradle-system"
  | "custom";

const RUNTIME_COMMAND_PRESETS: ReadonlyArray<{
  id: Exclude<RuntimeCommandPresetId, "custom">;
  command: string;
}> = [
  { id: "auto", command: "" },
  {
    id: "maven-wrapper",
    command: IS_WINDOWS_RUNTIME ? "mvnw.cmd spring-boot:run" : "./mvnw spring-boot:run",
  },
  { id: "maven-system", command: "mvn spring-boot:run" },
  {
    id: "gradle-wrapper",
    command: IS_WINDOWS_RUNTIME ? "gradlew.bat bootRun" : "./gradlew bootRun",
  },
  { id: "gradle-system", command: "gradle bootRun" },
];

type UseRuntimeLogSessionOptions = {
  activeWorkspace: WorkspaceInfo | null;
};

type RuntimeWorkspaceSession = {
  visible: boolean;
  status: RuntimeConsoleStatus;
  commandPreview: string | null;
  commandPresetId: RuntimeCommandPresetId;
  commandInput: string;
  log: string;
  error: string | null;
  truncated: boolean;
  exitCode: number | null;
  autoScroll: boolean;
  wrapLines: boolean;
};

export type RuntimeLogSessionState = {
  onOpenRuntimeConsole: () => void;
  onSelectRuntimeCommandPreset: (presetId: RuntimeCommandPresetId) => void;
  onChangeRuntimeCommandInput: (value: string) => void;
  onRunProject: () => Promise<void>;
  onStopProject: () => Promise<void>;
  onClearRuntimeLogs: () => void;
  onCopyRuntimeLogs: () => Promise<void>;
  onToggleRuntimeAutoScroll: () => void;
  onToggleRuntimeWrapLines: () => void;
  onCloseRuntimeConsole: () => void;
  runtimeAutoScroll: boolean;
  runtimeWrapLines: boolean;
  runtimeConsoleVisible: boolean;
  runtimeConsoleStatus: RuntimeConsoleStatus;
  runtimeConsoleCommandPreview: string | null;
  runtimeCommandPresetId: RuntimeCommandPresetId;
  runtimeCommandInput: string;
  runtimeConsoleLog: string;
  runtimeConsoleError: string | null;
  runtimeConsoleTruncated: boolean;
  runtimeConsoleExitCode: number | null;
};

const DEFAULT_SESSION: RuntimeWorkspaceSession = {
  visible: false,
  status: "idle",
  commandPreview: null,
  commandPresetId: "auto",
  commandInput: "",
  log: "",
  error: null,
  truncated: false,
  exitCode: null,
  autoScroll: true,
  wrapLines: true,
};

function resolveCommandPresetId(command: string): RuntimeCommandPresetId {
  const normalized = command.trim();
  if (!normalized) {
    return "auto";
  }
  const matchedPreset = RUNTIME_COMMAND_PRESETS.find((preset) => {
    if (preset.id === "auto") {
      return false;
    }
    return preset.command === normalized;
  });
  return matchedPreset ? matchedPreset.id : "custom";
}

function appendRuntimeLog(
  current: string,
  chunk: string,
): { next: string; truncated: boolean } {
  const merged = current + chunk;
  const segments = merged.split("\n");
  const maxSegments = MAX_LOG_LINES + 1;
  if (segments.length <= maxSegments) {
    return { next: merged, truncated: false };
  }
  return {
    next: segments.slice(segments.length - maxSegments).join("\n"),
    truncated: true,
  };
}

function mapRuntimeStatus(status: RuntimeLogSessionStatus): RuntimeConsoleStatus {
  switch (status) {
    case "starting":
      return "starting";
    case "running":
      return "running";
    case "stopping":
      return "running";
    case "stopped":
      return "stopped";
    case "failed":
      return "error";
    default:
      return "idle";
  }
}

function applyRuntimeSnapshot(
  current: RuntimeWorkspaceSession,
  snapshot: RuntimeLogSessionSnapshot,
): RuntimeWorkspaceSession {
  const mappedStatus = mapRuntimeStatus(snapshot.status);
  const nextCommandInput =
    current.commandInput.trim().length === 0 && snapshot.commandPreview
      ? snapshot.commandPreview
      : current.commandInput;
  return {
    ...current,
    visible: mappedStatus !== "idle",
    status: mappedStatus,
    commandPreview: snapshot.commandPreview,
    commandInput: nextCommandInput,
    commandPresetId: resolveCommandPresetId(nextCommandInput),
    exitCode: snapshot.exitCode ?? current.exitCode,
    error: snapshot.error ?? null,
  };
}

function isMissingCommandError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    error.message.includes("runtime_log_start") ||
    error.message.includes("runtime_log_stop") ||
    error.message.includes("runtime_log_mark_exit") ||
    error.message.includes("unknown command")
  );
}

function buildLegacyJavaRunScript(commandOverride?: string | null) {
  if (IS_WINDOWS_RUNTIME) {
    const normalizedOverride = commandOverride?.trim() ?? "";
    if (normalizedOverride) {
      return [
        "@echo off",
        "setlocal EnableExtensions EnableDelayedExpansion",
        "set \"CODEMOSS_RUN_EXIT_CODE=0\"",
        "where java >nul 2>&1",
        "if errorlevel 1 (",
        "  echo [CodeMoss Run] Java not found. Install JDK and ensure java is on PATH.",
        "  set \"CODEMOSS_RUN_EXIT_CODE=127\"",
        ") else (",
        "  echo [CodeMoss Run] Using custom run command from console.",
        `  ${normalizedOverride}`,
        "  set \"CODEMOSS_RUN_EXIT_CODE=!ERRORLEVEL!\"",
        ")",
        "echo [CodeMoss Run] __EXIT__:!CODEMOSS_RUN_EXIT_CODE!",
      ].join("\r\n");
    }

    return [
      "@echo off",
      "setlocal EnableExtensions EnableDelayedExpansion",
      "set \"CODEMOSS_RUN_EXIT_CODE=0\"",
      "echo [CodeMoss Run] Detecting Java launcher...",
      "where java >nul 2>&1",
      "if errorlevel 1 (",
      "  echo [CodeMoss Run] Java not found. Install JDK and ensure java is on PATH.",
      "  set \"CODEMOSS_RUN_EXIT_CODE=127\"",
      ") else if exist \"mvnw.cmd\" if exist \"pom.xml\" (",
      "  echo [CodeMoss Run] Using: mvnw.cmd spring-boot:run",
      "  call mvnw.cmd spring-boot:run",
      "  set \"CODEMOSS_RUN_EXIT_CODE=!ERRORLEVEL!\"",
      ") else if exist \"pom.xml\" (",
      "  where mvn >nul 2>&1",
      "  if errorlevel 1 (",
      "    echo [CodeMoss Run] Maven not found. Install Maven or add mvnw.cmd to project root.",
      "    set \"CODEMOSS_RUN_EXIT_CODE=127\"",
      "  ) else (",
      "    echo [CodeMoss Run] Using: mvn spring-boot:run",
      "    call mvn spring-boot:run",
      "    set \"CODEMOSS_RUN_EXIT_CODE=!ERRORLEVEL!\"",
      "  )",
      ") else if exist \"gradlew.bat\" if exist \"build.gradle\" (",
      "  echo [CodeMoss Run] Using: gradlew.bat bootRun",
      "  call gradlew.bat bootRun",
      "  set \"CODEMOSS_RUN_EXIT_CODE=!ERRORLEVEL!\"",
      ") else if exist \"gradlew.bat\" if exist \"build.gradle.kts\" (",
      "  echo [CodeMoss Run] Using: gradlew.bat bootRun",
      "  call gradlew.bat bootRun",
      "  set \"CODEMOSS_RUN_EXIT_CODE=!ERRORLEVEL!\"",
      ") else if exist \"build.gradle\" (",
      "  where gradle >nul 2>&1",
      "  if errorlevel 1 (",
      "    echo [CodeMoss Run] Gradle not found. Install Gradle or add gradlew.bat to project root.",
      "    set \"CODEMOSS_RUN_EXIT_CODE=127\"",
      "  ) else (",
      "    echo [CodeMoss Run] Using: gradle bootRun",
      "    call gradle bootRun",
      "    set \"CODEMOSS_RUN_EXIT_CODE=!ERRORLEVEL!\"",
      "  )",
      ") else if exist \"build.gradle.kts\" (",
      "  where gradle >nul 2>&1",
      "  if errorlevel 1 (",
      "    echo [CodeMoss Run] Gradle not found. Install Gradle or add gradlew.bat to project root.",
      "    set \"CODEMOSS_RUN_EXIT_CODE=127\"",
      "  ) else (",
      "    echo [CodeMoss Run] Using: gradle bootRun",
      "    call gradle bootRun",
      "    set \"CODEMOSS_RUN_EXIT_CODE=!ERRORLEVEL!\"",
      "  )",
      ") else (",
      "  echo [CodeMoss Run] No Java project launcher detected in workspace root.",
      "  echo [CodeMoss Run] Expected one of: pom.xml, build.gradle, build.gradle.kts.",
      "  set \"CODEMOSS_RUN_EXIT_CODE=127\"",
      ")",
      "echo [CodeMoss Run] __EXIT__:!CODEMOSS_RUN_EXIT_CODE!",
    ].join("\r\n");
  }

  const normalizedOverride = commandOverride?.trim() ?? "";
  if (normalizedOverride) {
    return [
      "CODEMOSS_RUN_EXIT_CODE=0",
      "if ! command -v java >/dev/null 2>&1; then",
      "  echo \"[CodeMoss Run] Java not found. Install JDK and ensure java is on PATH.\"",
      "  CODEMOSS_RUN_EXIT_CODE=127",
      "else",
      "  echo \"[CodeMoss Run] Using custom run command from console.\"",
      `  ${normalizedOverride}`,
      "  CODEMOSS_RUN_EXIT_CODE=$?",
      "fi",
      "echo \"[CodeMoss Run] __EXIT__:${CODEMOSS_RUN_EXIT_CODE}\"",
    ].join("\n");
  }

  return [
    "CODEMOSS_RUN_EXIT_CODE=0",
    "echo \"[CodeMoss Run] Detecting Java launcher...\"",
    "if ! command -v java >/dev/null 2>&1; then",
    "  echo \"[CodeMoss Run] Java not found. Install JDK and ensure java is on PATH.\"",
    "  CODEMOSS_RUN_EXIT_CODE=127",
    "elif [ -f \"./mvnw\" ] && [ -f \"./pom.xml\" ]; then",
    "  echo \"[CodeMoss Run] Using: ./mvnw spring-boot:run\"",
    "  ./mvnw spring-boot:run",
    "  CODEMOSS_RUN_EXIT_CODE=$?",
    "elif [ -f \"./pom.xml\" ]; then",
    "  if command -v mvn >/dev/null 2>&1; then",
    "    echo \"[CodeMoss Run] Using: mvn spring-boot:run\"",
    "    mvn spring-boot:run",
    "    CODEMOSS_RUN_EXIT_CODE=$?",
    "  else",
    "    echo \"[CodeMoss Run] Maven not found. Install Maven or add ./mvnw to project root.\"",
    "    CODEMOSS_RUN_EXIT_CODE=127",
    "  fi",
    "elif [ -f \"./gradlew\" ] && { [ -f \"./build.gradle\" ] || [ -f \"./build.gradle.kts\" ]; }; then",
    "  echo \"[CodeMoss Run] Using: ./gradlew bootRun\"",
    "  ./gradlew bootRun",
    "  CODEMOSS_RUN_EXIT_CODE=$?",
    "elif [ -f \"./build.gradle\" ] || [ -f \"./build.gradle.kts\" ]; then",
    "  if command -v gradle >/dev/null 2>&1; then",
    "    echo \"[CodeMoss Run] Using: gradle bootRun\"",
    "    gradle bootRun",
    "    CODEMOSS_RUN_EXIT_CODE=$?",
    "  else",
    "    echo \"[CodeMoss Run] Gradle not found. Install Gradle or add ./gradlew to project root.\"",
    "    CODEMOSS_RUN_EXIT_CODE=127",
    "  fi",
    "else",
    "  echo \"[CodeMoss Run] No Java project launcher detected in workspace root.\"",
    "  echo \"[CodeMoss Run] Expected one of: pom.xml, build.gradle, build.gradle.kts.\"",
    "  CODEMOSS_RUN_EXIT_CODE=127",
    "fi",
    "echo \"[CodeMoss Run] __EXIT__:${CODEMOSS_RUN_EXIT_CODE}\"",
  ].join("\n");
}

export function useRuntimeLogSession({
  activeWorkspace,
}: UseRuntimeLogSessionOptions): RuntimeLogSessionState {
  const activeWorkspaceId = activeWorkspace?.id ?? null;
  const [sessionByWorkspace, setSessionByWorkspace] = useState<
    Record<string, RuntimeWorkspaceSession>
  >({});
  const exitBufferByWorkspaceRef = useRef<Record<string, string>>({});

  const updateWorkspaceSession = useCallback(
    (workspaceId: string, updater: (current: RuntimeWorkspaceSession) => RuntimeWorkspaceSession) => {
      setSessionByWorkspace((prev) => {
        const current = prev[workspaceId] ?? DEFAULT_SESSION;
        const next = updater(current);
        return { ...prev, [workspaceId]: next };
      });
    },
    [],
  );

  const appendWorkspaceLog = useCallback(
    (workspaceId: string, chunk: string) => {
      updateWorkspaceSession(workspaceId, (current) => {
        const { next, truncated } = appendRuntimeLog(current.log, chunk);
        return {
          ...current,
          log: next,
          truncated: current.truncated || truncated,
        };
      });
    },
    [updateWorkspaceSession],
  );

  const consumeExitCode = useCallback((workspaceId: string, chunk: string) => {
    const buffers = exitBufferByWorkspaceRef.current;
    const pending = `${buffers[workspaceId] ?? ""}${chunk}`;
    const lines = pending.split("\n");
    buffers[workspaceId] = lines.pop() ?? "";

    let exitCode: number | null = null;
    for (const line of lines) {
      const match = line.match(EXIT_CODE_PATTERN);
      if (!match) {
        continue;
      }
      const parsed = Number.parseInt(match[1] ?? "", 10);
      if (!Number.isNaN(parsed)) {
        exitCode = parsed;
      }
    }
    return exitCode;
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeTerminalOutput((event: TerminalOutputEvent) => {
      if (event.terminalId !== RUNTIME_TERMINAL_ID) {
        return;
      }

      appendWorkspaceLog(event.workspaceId, event.data);

      const exitCode = consumeExitCode(event.workspaceId, event.data);
      if (exitCode !== null) {
        updateWorkspaceSession(event.workspaceId, (current) => ({
          ...current,
          visible: true,
          exitCode,
          status: exitCode === 0 ? "stopped" : "error",
          error: exitCode === 0 ? null : `Process exited with code ${exitCode}.`,
        }));
        void runtimeLogMarkExit(event.workspaceId, exitCode).catch(() => undefined);
        return;
      }

      updateWorkspaceSession(event.workspaceId, (current) => ({
        ...current,
        visible: true,
        status:
          current.status === "starting" || current.status === "idle" || current.status === "stopped"
            ? "running"
            : current.status,
      }));
    });
    return () => {
      unsubscribe();
    };
  }, [appendWorkspaceLog, consumeExitCode, updateWorkspaceSession]);

  useEffect(() => {
    const unsubscribeStatus = subscribeRuntimeLogStatus((event) => {
      updateWorkspaceSession(event.workspaceId, (current) =>
        applyRuntimeSnapshot(current, event),
      );
    });
    const unsubscribeExited = subscribeRuntimeLogExited((event) => {
      updateWorkspaceSession(event.workspaceId, (current) =>
        applyRuntimeSnapshot(current, event),
      );
    });

    return () => {
      unsubscribeStatus();
      unsubscribeExited();
    };
  }, [updateWorkspaceSession]);

  useEffect(() => {
    if (!activeWorkspaceId) {
      return;
    }
    let cancelled = false;
    runtimeLogGetSession(activeWorkspaceId)
      .then((snapshot) => {
        if (cancelled || !snapshot) {
          return;
        }
        updateWorkspaceSession(activeWorkspaceId, (current) =>
          applyRuntimeSnapshot(current, snapshot),
        );
      })
      .catch(() => {
        // Ignore runtime session restore failures.
      });
    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, updateWorkspaceSession]);

  const onSelectRuntimeCommandPreset = useCallback(
    (presetId: RuntimeCommandPresetId) => {
      if (!activeWorkspaceId) {
        return;
      }
      updateWorkspaceSession(activeWorkspaceId, (current) => {
        if (presetId === "custom") {
          return {
            ...current,
            commandPresetId: "custom",
          };
        }
        const preset = RUNTIME_COMMAND_PRESETS.find((item) => item.id === presetId);
        if (!preset) {
          return current;
        }
        return {
          ...current,
          commandPresetId: preset.id,
          commandInput: preset.command,
        };
      });
    },
    [activeWorkspaceId, updateWorkspaceSession],
  );

  const onChangeRuntimeCommandInput = useCallback(
    (value: string) => {
      if (!activeWorkspaceId) {
        return;
      }
      updateWorkspaceSession(activeWorkspaceId, (current) => ({
        ...current,
        commandInput: value,
        commandPresetId: resolveCommandPresetId(value),
      }));
    },
    [activeWorkspaceId, updateWorkspaceSession],
  );

  const activeSession = useMemo<RuntimeWorkspaceSession>(() => {
    if (!activeWorkspaceId) {
      return DEFAULT_SESSION;
    }
    return sessionByWorkspace[activeWorkspaceId] ?? DEFAULT_SESSION;
  }, [activeWorkspaceId, sessionByWorkspace]);

  const onRunProject = useCallback(async () => {
    const workspaceId = activeWorkspace?.id;
    if (!workspaceId) {
      return;
    }
    const commandOverride = activeSession.commandInput.trim() || null;
    exitBufferByWorkspaceRef.current[workspaceId] = "";
    updateWorkspaceSession(workspaceId, (current) => ({
      ...current,
      visible: true,
      status: "starting",
      commandPreview: null,
      error: null,
      exitCode: null,
      truncated: false,
      autoScroll: true,
    }));
    appendWorkspaceLog(
      workspaceId,
      `\n[CodeMoss Run] Starting at ${new Date().toLocaleTimeString()}\n`,
    );
    try {
      const snapshot = await runtimeLogStart(workspaceId, {
        commandOverride,
      });
      updateWorkspaceSession(workspaceId, (current) => ({
        ...applyRuntimeSnapshot(current, snapshot),
        visible: true,
        status: "running",
      }));
    } catch (error) {
      if (isMissingCommandError(error)) {
        try {
          await closeTerminalSession(workspaceId, RUNTIME_TERMINAL_ID).catch(() => undefined);
          await openTerminalSession(
            workspaceId,
            RUNTIME_TERMINAL_ID,
            DEFAULT_TERMINAL_COLS,
            DEFAULT_TERMINAL_ROWS,
          );
          await writeTerminalSession(
            workspaceId,
            RUNTIME_TERMINAL_ID,
            `${buildLegacyJavaRunScript(commandOverride)}\n`,
          );
          updateWorkspaceSession(workspaceId, (current) => ({
            ...current,
            status: "running",
            commandPreview:
              commandOverride && commandOverride.length > 0 ? commandOverride : current.commandPreview,
          }));
          return;
        } catch (fallbackError) {
          const fallbackMessage =
            fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
          updateWorkspaceSession(workspaceId, (current) => ({
            ...current,
            status: "error",
            error: fallbackMessage,
          }));
          appendWorkspaceLog(
            workspaceId,
            `[CodeMoss Run] Failed to start runtime: ${fallbackMessage}\n`,
          );
          return;
        }
      }
      const message = error instanceof Error ? error.message : String(error);
      updateWorkspaceSession(workspaceId, (current) => ({
        ...current,
        status: "error",
        error: message,
      }));
      appendWorkspaceLog(
        workspaceId,
        `[CodeMoss Run] Failed to start runtime: ${message}\n`,
      );
    }
  }, [activeSession.commandInput, activeWorkspace?.id, appendWorkspaceLog, updateWorkspaceSession]);

  const onOpenRuntimeConsole = useCallback(() => {
    if (!activeWorkspaceId) {
      return;
    }
    updateWorkspaceSession(activeWorkspaceId, (current) => ({
      ...current,
      visible: true,
    }));
  }, [activeWorkspaceId, updateWorkspaceSession]);

  const onStopProject = useCallback(async () => {
    const workspaceId = activeWorkspace?.id;
    if (!workspaceId) {
      return;
    }
    try {
      const snapshot = await runtimeLogStop(workspaceId);
      updateWorkspaceSession(workspaceId, (current) => ({
        ...applyRuntimeSnapshot(current, snapshot),
        status: "stopped",
      }));
      appendWorkspaceLog(workspaceId, "[CodeMoss Run] Stopped.\n");
    } catch (error) {
      if (isMissingCommandError(error)) {
        try {
          await closeTerminalSession(workspaceId, RUNTIME_TERMINAL_ID);
          updateWorkspaceSession(workspaceId, (current) => ({
            ...current,
            status: "stopped",
            exitCode: current.exitCode === null ? 130 : current.exitCode,
          }));
          appendWorkspaceLog(workspaceId, "[CodeMoss Run] Stopped.\n");
          return;
        } catch (fallbackError) {
          const fallbackMessage =
            fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
          updateWorkspaceSession(workspaceId, (current) => ({
            ...current,
            status: "error",
            error: fallbackMessage,
          }));
          appendWorkspaceLog(
            workspaceId,
            `[CodeMoss Run] Stop failed: ${fallbackMessage}\n`,
          );
          return;
        }
      }
      const message = error instanceof Error ? error.message : String(error);
      updateWorkspaceSession(workspaceId, (current) => ({
        ...current,
        status: "error",
        error: message,
      }));
      appendWorkspaceLog(
        workspaceId,
        `[CodeMoss Run] Stop failed: ${message}\n`,
      );
    }
  }, [activeWorkspace?.id, appendWorkspaceLog, updateWorkspaceSession]);

  const onClearRuntimeLogs = useCallback(() => {
    if (!activeWorkspaceId) {
      return;
    }
    updateWorkspaceSession(activeWorkspaceId, (current) => ({
      ...current,
      log: "",
      truncated: false,
    }));
  }, [activeWorkspaceId, updateWorkspaceSession]);

  const onCopyRuntimeLogs = useCallback(async () => {
    if (!activeSession.log) {
      return;
    }
    try {
      await navigator.clipboard.writeText(activeSession.log);
    } catch {
      // Ignore clipboard failures in restricted contexts.
    }
  }, [activeSession.log]);

  const onToggleRuntimeAutoScroll = useCallback(() => {
    if (!activeWorkspaceId) {
      return;
    }
    updateWorkspaceSession(activeWorkspaceId, (current) => ({
      ...current,
      autoScroll: !current.autoScroll,
    }));
  }, [activeWorkspaceId, updateWorkspaceSession]);

  const onToggleRuntimeWrapLines = useCallback(() => {
    if (!activeWorkspaceId) {
      return;
    }
    updateWorkspaceSession(activeWorkspaceId, (current) => ({
      ...current,
      wrapLines: !current.wrapLines,
    }));
  }, [activeWorkspaceId, updateWorkspaceSession]);

  const onCloseRuntimeConsole = useCallback(() => {
    if (!activeWorkspaceId) {
      return;
    }
    updateWorkspaceSession(activeWorkspaceId, (current) => ({
      ...current,
      visible: false,
    }));
  }, [activeWorkspaceId, updateWorkspaceSession]);

  return {
    onOpenRuntimeConsole,
    onSelectRuntimeCommandPreset,
    onChangeRuntimeCommandInput,
    onRunProject,
    onStopProject,
    onClearRuntimeLogs,
    onCopyRuntimeLogs,
    onToggleRuntimeAutoScroll,
    onToggleRuntimeWrapLines,
    onCloseRuntimeConsole,
    runtimeAutoScroll: activeSession.autoScroll,
    runtimeWrapLines: activeSession.wrapLines,
    runtimeConsoleVisible: activeSession.visible,
    runtimeConsoleStatus: activeSession.status,
    runtimeConsoleCommandPreview: activeSession.commandPreview,
    runtimeCommandPresetId: activeSession.commandPresetId,
    runtimeCommandInput: activeSession.commandInput,
    runtimeConsoleLog: activeSession.log,
    runtimeConsoleError: activeSession.error,
    runtimeConsoleTruncated: activeSession.truncated,
    runtimeConsoleExitCode: activeSession.exitCode,
  };
}
