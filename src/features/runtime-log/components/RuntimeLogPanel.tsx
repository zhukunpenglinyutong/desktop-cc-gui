import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useTranslation } from "react-i18next";
import ArrowDownToLine from "lucide-react/dist/esm/icons/arrow-down-to-line";
import Palette from "lucide-react/dist/esm/icons/palette";
import Play from "lucide-react/dist/esm/icons/play";
import Square from "lucide-react/dist/esm/icons/square";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import WrapText from "lucide-react/dist/esm/icons/wrap-text";
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectSeparator,
  SelectTrigger,
} from "../../../components/ui/select";
import type {
  RuntimeCommandPresetId,
  RuntimeConsoleStatus,
} from "../hooks/useRuntimeLogSession";
import { isWindowsPlatform } from "../../../utils/platform";

export type RuntimeLogPanelProps = {
  isVisible: boolean;
  status: RuntimeConsoleStatus;
  commandPreview?: string | null;
  log: string;
  error: string | null;
  exitCode?: number | null;
  truncated?: boolean;
  autoScroll?: boolean;
  wrapLines?: boolean;
  commandPresetOptions?: RuntimeCommandPresetId[];
  commandPresetId?: RuntimeCommandPresetId;
  commandInput?: string;
  onRun?: () => Promise<void> | void;
  onCommandPresetChange?: (presetId: RuntimeCommandPresetId) => void;
  onCommandInputChange?: (value: string) => void;
  onStop: () => Promise<void> | void;
  onClear: () => void;
  onCopy?: () => Promise<void> | void;
  onToggleAutoScroll?: () => void;
  onToggleWrapLines?: () => void;
};

const ESCAPE_CHAR = String.fromCharCode(27);
const ANSI_ESCAPE_PATTERN = new RegExp(`${ESCAPE_CHAR}\\[[0-9;?]*[ -/]*[@-~]`, "g");
const LOG_TOKEN_PATTERN =
  /(\bTRACE\b|\bDEBUG\b|\bINFO\b|\bWARN\b|\bERROR\b|\[\s*[\w\-:.]+\s*\]|(?:\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d{3})?)|(?:[a-z_][\w$]*\.)+[A-Za-z_$][\w$]*(?:@[0-9a-fA-F]+)?|---)/g;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d{3})?$/;
const JAVA_FQCN_PATTERN = /^(?:[a-z_][\w$]*\.)+[A-Za-z_$][\w$]*(?:@[0-9a-fA-F]+)?$/;
const SPRING_BOOT_LINE_PATTERN =
  /^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d{3})?)\s+(TRACE|DEBUG|INFO|WARN|ERROR)\s+(\d+)\s+---\s+(\[[^\]]+\])\s+([^\s]+)\s*:\s?(.*)$/;
const RUNTIME_PANEL_MIN_HEIGHT = 160;
const RUNTIME_PANEL_MAX_HEIGHT = 640;
const RUNTIME_PANEL_DEFAULT_HEIGHT = 240;
const RUNTIME_PANEL_HEIGHT_STORAGE_KEY = "ccgui.runtimeConsole.height";
const RUNTIME_PANEL_THEME_STORAGE_KEY = "ccgui.runtimeConsole.ideaTheme";
const IS_WINDOWS_RUNTIME = isWindowsPlatform();

type RuntimeLineTone = "default" | "system" | "info" | "warn" | "error" | "debug";
type RuntimeConsoleIdeaTheme = "classic" | "new-ui";
type RuntimeCommandTool = "maven" | "gradle" | "node" | "python" | "go" | "unknown";

const COMMAND_OPTION_CUSTOM = "__custom__";
const MAVEN_PHASE_OPTIONS = [
  "clean",
  "validate",
  "compile",
  "test",
  "package",
  "verify",
  "install",
  "site",
  "deploy",
];
const MAVEN_SPRING_BOOT_OPTIONS = [
  "spring-boot:build-image",
  "spring-boot:build-info",
  "spring-boot:help",
  "spring-boot:repackage",
  "spring-boot:run",
  "spring-boot:start",
  "spring-boot:stop",
];
const GRADLE_TASK_OPTIONS = [
  "clean",
  "assemble",
  "build",
  "check",
  "test",
  "bootRun",
  "publish",
];
const NODE_SCRIPT_OPTIONS_DEV_FIRST = [
  "dev",
  "tauri dev",
  "start",
  "build",
  "tauri build",
  "preview",
  "test",
];
const NODE_SCRIPT_OPTIONS_START_FIRST = [
  "start",
  "dev",
  "tauri dev",
  "build",
  "tauri build",
  "preview",
  "test",
];
const PYTHON_COMMAND_OPTIONS = [
  "python3 main.py",
  "python3 app.py",
  "python3 manage.py runserver",
  "py -3 main.py",
  "py -3 app.py",
  "py -3 manage.py runserver",
  "main.py",
  "app.py",
  "manage.py runserver",
  "-m uvicorn main:app --reload",
];
const GO_RUN_TARGET_OPTIONS = [".", "./cmd/server", "./cmd/api", "./cmd/main"];

function hasProgramPrefix(commandInput: string, program: string) {
  const normalized = commandInput.trim().toLowerCase();
  const target = program.toLowerCase();
  return normalized === target || normalized.startsWith(`${target} `);
}

function resolveNodeCommandProgram(commandInput: string): string | null {
  if (hasProgramPrefix(commandInput, "pnpm run")) {
    return "pnpm run";
  }
  if (hasProgramPrefix(commandInput, "npm run")) {
    return "npm run";
  }
  if (hasProgramPrefix(commandInput, "yarn run")) {
    return "yarn run";
  }
  if (hasProgramPrefix(commandInput, "yarn")) {
    return "yarn";
  }
  if (hasProgramPrefix(commandInput, "bun run")) {
    return "bun run";
  }
  return null;
}

function resolveCommandTool(
  presetId: RuntimeCommandPresetId,
  commandInput: string,
): RuntimeCommandTool {
  if (presetId === "java-maven") {
    return "maven";
  }
  if (presetId === "java-gradle") {
    return "gradle";
  }
  if (presetId === "node-dev" || presetId === "node-start") {
    return "node";
  }
  if (presetId === "python-main") {
    return "python";
  }
  if (presetId === "go-run") {
    return "go";
  }
  if (resolveNodeCommandProgram(commandInput)) {
    return "node";
  }
  if (
    hasProgramPrefix(commandInput, "py -3") ||
    hasProgramPrefix(commandInput, "py") ||
    hasProgramPrefix(commandInput, "python3") ||
    hasProgramPrefix(commandInput, "python")
  ) {
    return "python";
  }
  if (hasProgramPrefix(commandInput, "go run")) {
    return "go";
  }
  if (
    hasProgramPrefix(commandInput, "./mvnw") ||
    hasProgramPrefix(commandInput, "mvnw.cmd") ||
    hasProgramPrefix(commandInput, "mvn")
  ) {
    return "maven";
  }
  if (
    hasProgramPrefix(commandInput, "./gradlew") ||
    hasProgramPrefix(commandInput, "gradlew.bat") ||
    hasProgramPrefix(commandInput, "gradle")
  ) {
    return "gradle";
  }
  return "unknown";
}

function resolveCommandProgram(
  presetId: RuntimeCommandPresetId,
  tool: RuntimeCommandTool,
  commandInput: string,
): string | null {
  if (presetId === "java-maven") {
    if (hasProgramPrefix(commandInput, "mvnw.cmd")) return "mvnw.cmd";
    if (hasProgramPrefix(commandInput, "./mvnw")) return "./mvnw";
    if (hasProgramPrefix(commandInput, "mvn")) return "mvn";
    return "mvn";
  }
  if (presetId === "java-gradle") {
    if (hasProgramPrefix(commandInput, "gradlew.bat")) return "gradlew.bat";
    if (hasProgramPrefix(commandInput, "./gradlew")) return "./gradlew";
    if (hasProgramPrefix(commandInput, "gradle")) return "gradle";
    return "gradle";
  }
  if (presetId === "node-dev" || presetId === "node-start") {
    return resolveNodeCommandProgram(commandInput) ?? "npm run";
  }
  if (presetId === "python-main") {
    if (hasProgramPrefix(commandInput, "py -3")) return "py -3";
    if (hasProgramPrefix(commandInput, "py")) return "py";
    if (hasProgramPrefix(commandInput, "python3")) return "python3";
    if (hasProgramPrefix(commandInput, "python")) return "python";
    return IS_WINDOWS_RUNTIME ? "py -3" : "python3";
  }
  if (presetId === "go-run") {
    return "go run";
  }
  if (tool === "maven") {
    if (hasProgramPrefix(commandInput, "mvnw.cmd")) return "mvnw.cmd";
    if (hasProgramPrefix(commandInput, "./mvnw")) return "./mvnw";
    if (hasProgramPrefix(commandInput, "mvn")) return "mvn";
    return null;
  }
  if (tool === "gradle") {
    if (hasProgramPrefix(commandInput, "gradlew.bat")) return "gradlew.bat";
    if (hasProgramPrefix(commandInput, "./gradlew")) return "./gradlew";
    if (hasProgramPrefix(commandInput, "gradle")) return "gradle";
    return null;
  }
  if (tool === "node") {
    return resolveNodeCommandProgram(commandInput);
  }
  if (tool === "python") {
    if (hasProgramPrefix(commandInput, "py -3")) return "py -3";
    if (hasProgramPrefix(commandInput, "py")) return "py";
    if (hasProgramPrefix(commandInput, "python3")) return "python3";
    if (hasProgramPrefix(commandInput, "python")) return "python";
    return null;
  }
  if (tool === "go") {
    if (hasProgramPrefix(commandInput, "go run")) return "go run";
    return null;
  }
  return null;
}

function extractCommandTail(program: string | null, commandInput: string): string {
  const normalized = commandInput.trim();
  if (!program || !normalized.startsWith(program)) {
    return "";
  }
  return normalized.slice(program.length).trim();
}

function sanitizeRuntimeOutput(raw: string) {
  return raw
    .replace(ANSI_ESCAPE_PATTERN, "")
    .replace(/\r/g, "");
}

function resolveLineTone(line: string): RuntimeLineTone {
  if (SPRING_BOOT_LINE_PATTERN.test(line)) {
    return "default";
  }
  const normalized = line.toUpperCase();
  if (line.includes("[ccgui Run]") || line.includes("[CodeMoss Run]")) {
    return "system";
  }
  if (
    /^\s*CAUSED BY:/.test(normalized) ||
    /^\s*AT\s+/.test(normalized) ||
    /^\s*\.\.\. \d+ MORE$/.test(normalized) ||
    /\bEXCEPTION\b/.test(normalized)
  ) {
    return "error";
  }
  if (/\bERROR\b/.test(normalized)) {
    return "error";
  }
  return "default";
}

function clampPanelHeight(value: number) {
  return Math.round(Math.min(RUNTIME_PANEL_MAX_HEIGHT, Math.max(RUNTIME_PANEL_MIN_HEIGHT, value)));
}

function readSavedPanelHeight() {
  if (typeof window === "undefined") {
    return RUNTIME_PANEL_DEFAULT_HEIGHT;
  }
  const raw = window.localStorage.getItem(RUNTIME_PANEL_HEIGHT_STORAGE_KEY);
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return RUNTIME_PANEL_DEFAULT_HEIGHT;
  }
  return clampPanelHeight(parsed);
}

function normalizeIdeaTheme(value: string | null): RuntimeConsoleIdeaTheme {
  return value === "classic" ? "classic" : "new-ui";
}

function readSavedIdeaTheme(): RuntimeConsoleIdeaTheme {
  if (typeof window === "undefined") {
    return "new-ui";
  }
  return normalizeIdeaTheme(window.localStorage.getItem(RUNTIME_PANEL_THEME_STORAGE_KEY));
}

function classifyToken(token: string) {
  const normalized = token.toUpperCase();
  if (/^(TRACE|DEBUG|INFO|WARN|ERROR)$/.test(normalized)) {
    return `is-level is-level-${normalized.toLowerCase()}`;
  }
  if (token.startsWith("[") && token.endsWith("]")) {
    return "is-thread";
  }
  if (TIMESTAMP_PATTERN.test(token)) {
    return "is-time";
  }
  if (token === "---") {
    return "is-separator";
  }
  if (JAVA_FQCN_PATTERN.test(token)) {
    return "is-java";
  }
  return "";
}

function renderJavaToken(token: string, keyPrefix: string) {
  if (!JAVA_FQCN_PATTERN.test(token) || !token.includes(".")) {
    return (
      <span key={`${keyPrefix}-java`} className="runtime-console-token is-java">
        {token}
      </span>
    );
  }

  const hashStart = token.indexOf("@");
  const symbolPart = hashStart >= 0 ? token.slice(0, hashStart) : token;
  const hashPart = hashStart >= 0 ? token.slice(hashStart) : "";
  const splitAt = symbolPart.lastIndexOf(".");
  if (splitAt <= 0) {
    return (
      <span key={`${keyPrefix}-java`} className="runtime-console-token is-java">
        {token}
      </span>
    );
  }

  const packagePart = symbolPart.slice(0, splitAt + 1);
  const classPart = symbolPart.slice(splitAt + 1);
  return (
    <Fragment key={`${keyPrefix}-java`}>
      <span className="runtime-console-token is-java-package">{packagePart}</span>
      <span className="runtime-console-token is-java-class">{classPart}</span>
      {hashPart ? <span className="runtime-console-token is-java-meta">{hashPart}</span> : null}
    </Fragment>
  );
}

function resolveStatusLabel(
  status: RuntimeConsoleStatus,
  t: (key: string) => string,
) {
  switch (status) {
    case "starting":
      return t("files.runStatusStarting");
    case "running":
      return t("files.runStatusRunning");
    case "stopped":
      return t("files.runStatusStopped");
    case "error":
      return t("files.runStatusError");
    default:
      return t("files.runStatusIdle");
  }
}

export function RuntimeLogPanel({
  isVisible,
  status,
  log,
  error,
  exitCode,
  truncated = false,
  autoScroll = true,
  wrapLines = true,
  commandPresetOptions = ["auto", "custom"],
  commandPresetId = "auto",
  commandInput = "",
  onRun,
  onCommandPresetChange,
  onCommandInputChange,
  onStop,
  onClear,
  onToggleAutoScroll,
  onToggleWrapLines,
}: RuntimeLogPanelProps) {
  const { t } = useTranslation();
  const logRef = useRef<HTMLPreElement | null>(null);
  const commandInlineRef = useRef<HTMLDivElement | null>(null);
  const [panelHeight, setPanelHeight] = useState(readSavedPanelHeight);
  const [ideaTheme, setIdeaTheme] = useState<RuntimeConsoleIdeaTheme>(readSavedIdeaTheme);
  const [isResizing, setIsResizing] = useState(false);
  const [isGoalSelectCompact, setIsGoalSelectCompact] = useState(false);
  const statusLabel = useMemo(() => resolveStatusLabel(status, t), [status, t]);
  const isStoppable = status === "starting" || status === "running";
  const canRun = !isStoppable && Boolean(onRun);
  const rawOutput = error
    ? `${log}${log.endsWith("\n") || !log ? "" : "\n"}[ccgui Run] ${error}\n`
    : log;
  const output = useMemo(() => sanitizeRuntimeOutput(rawOutput), [rawOutput]);
  const logLines = useMemo(
    () => (output ? output.split("\n") : [t("files.runConsoleEmpty")]),
    [output, t],
  );
  const stopLabel = t("files.stopRun");
  const runLabel = t("files.runProject");
  const commandPresetLabel = t("files.runCommandPresetLabel");
  const commandGoalLabel = t("files.runCommandGoalLabel");
  const commandInputLabel = t("files.runCommandInputLabel");
  const commandInputPlaceholder = t("files.runCommandInputPlaceholder");
  const clearLabel = t("files.clearLogs");
  const autoScrollLabel = autoScroll ? t("files.autoScrollOn") : t("files.autoScrollOff");
  const wrapLinesLabel = wrapLines ? t("files.wrapLogsOff") : t("files.wrapLogsOn");
  const commandPresetItems: ReadonlyArray<{ id: RuntimeCommandPresetId; label: string }> =
    commandPresetOptions.map((id) => {
      switch (id) {
        case "auto":
          return { id, label: t("files.runCommandPresetAuto") };
        case "java-maven":
          return { id, label: t("files.runCommandPresetJavaMaven") };
        case "java-gradle":
          return { id, label: t("files.runCommandPresetJavaGradle") };
        case "node-dev":
          return { id, label: t("files.runCommandPresetNodeDev") };
        case "node-start":
          return { id, label: t("files.runCommandPresetNodeStart") };
        case "python-main":
          return { id, label: t("files.runCommandPresetPythonMain") };
        case "go-run":
          return { id, label: t("files.runCommandPresetGoRun") };
        case "custom":
          return { id, label: t("files.runCommandPresetCustom") };
      }
    });
  const selectedPresetLabel = useMemo(
    () =>
      commandPresetItems.find((option) => option.id === commandPresetId)?.label ?? commandPresetId,
    [commandPresetId, commandPresetItems],
  );
  const commandTool = useMemo(
    () => resolveCommandTool(commandPresetId, commandInput),
    [commandPresetId, commandInput],
  );
  const commandProgram = useMemo(
    () => resolveCommandProgram(commandPresetId, commandTool, commandInput),
    [commandPresetId, commandTool, commandInput],
  );
  const commandGoalOptions = useMemo(() => {
    if (commandTool === "maven") {
      return [...MAVEN_PHASE_OPTIONS, ...MAVEN_SPRING_BOOT_OPTIONS];
    }
    if (commandTool === "gradle") {
      return GRADLE_TASK_OPTIONS;
    }
    if (commandTool === "node") {
      return commandPresetId === "node-start"
        ? NODE_SCRIPT_OPTIONS_START_FIRST
        : NODE_SCRIPT_OPTIONS_DEV_FIRST;
    }
    if (commandTool === "python") {
      return PYTHON_COMMAND_OPTIONS;
    }
    if (commandTool === "go") {
      return GO_RUN_TARGET_OPTIONS;
    }
    return [];
  }, [commandPresetId, commandTool]);
  const commandTail = useMemo(
    () => extractCommandTail(commandProgram, commandInput),
    [commandProgram, commandInput],
  );
  const selectedCommandGoal = useMemo(() => {
    if (!commandGoalOptions.length) {
      return COMMAND_OPTION_CUSTOM;
    }
    return commandGoalOptions.includes(commandTail) ? commandTail : COMMAND_OPTION_CUSTOM;
  }, [commandGoalOptions, commandTail]);
  const selectedGoalLabel = useMemo(() => {
    if (!commandProgram || commandGoalOptions.length === 0) {
      return commandGoalLabel;
    }
    if (selectedCommandGoal === COMMAND_OPTION_CUSTOM) {
      return t("files.runCommandGoalCustom");
    }
    return selectedCommandGoal;
  }, [commandGoalLabel, commandGoalOptions.length, commandProgram, selectedCommandGoal, t]);
  const nextThemeLabel =
    ideaTheme === "classic" ? t("files.runConsoleThemeNewUi") : t("files.runConsoleThemeClassic");
  const toggleThemeLabel = t("files.toggleRunConsoleTheme", { theme: nextThemeLabel });

  const renderHighlightedLine = useCallback((line: string) => {
    const parts = line.split(LOG_TOKEN_PATTERN);
    return parts.map((part, index) => {
      if (!part) {
        return null;
      }
      const tokenClass = classifyToken(part);
      if (!tokenClass) {
        return <span key={`plain-${index}`}>{part}</span>;
      }
      if (tokenClass === "is-java") {
        return renderJavaToken(part, `token-${index}`);
      }
      return (
        <span key={`token-${index}`} className={`runtime-console-token ${tokenClass}`}>
          {part}
        </span>
      );
    });
  }, []);

  const renderSpringBootLine = useCallback(
    (line: string) => {
      const matched = line.match(SPRING_BOOT_LINE_PATTERN);
      if (!matched) {
        return null;
      }
      const [, timestamp, level, pid, thread, logger, message] = matched;
      const normalizedLevel = level ?? "info";
      return (
        <>
          <span className="runtime-console-token is-time">{timestamp}</span>{" "}
          <span className={`runtime-console-token is-level is-level-${normalizedLevel.toLowerCase()}`}>
            {normalizedLevel}
          </span>{" "}
          <span className="runtime-console-token is-pid">{pid}</span>{" "}
          <span className="runtime-console-token is-separator">---</span>{" "}
          <span className="runtime-console-token is-thread">{thread}</span>{" "}
          {renderJavaToken(logger ?? "", "spring-logger")}
          <span className="runtime-console-token is-separator"> : </span>
          {message ? renderHighlightedLine(message) : null}
        </>
      );
    },
    [renderHighlightedLine],
  );

  const handleResizeStart = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      const startY = event.clientY;
      const startHeight = panelHeight;
      setIsResizing(true);
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
      document.body.style.webkitUserSelect = "none";

      const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
        const deltaY = moveEvent.clientY - startY;
        setPanelHeight(clampPanelHeight(startHeight - deltaY));
      };

      const handleMouseUp = () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        document.body.style.webkitUserSelect = "";
        setIsResizing(false);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [panelHeight],
  );

  useEffect(() => {
    if (!autoScroll) {
      return;
    }
    const node = logRef.current;
    if (!node) {
      return;
    }
    node.scrollTop = node.scrollHeight;
  }, [autoScroll, output]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(RUNTIME_PANEL_HEIGHT_STORAGE_KEY, String(panelHeight));
  }, [panelHeight]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(RUNTIME_PANEL_THEME_STORAGE_KEY, ideaTheme);
  }, [ideaTheme]);

  useEffect(() => {
    const node = commandInlineRef.current;
    if (!node) {
      return;
    }

    const updateCompactState = () => {
      const width = node.getBoundingClientRect().width;
      setIsGoalSelectCompact(width < 540);
    };

    updateCompactState();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateCompactState);
      return () => {
        window.removeEventListener("resize", updateCompactState);
      };
    }

    const observer = new ResizeObserver(updateCompactState);
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, []);

  if (!isVisible) {
    return null;
  }

  return (
    <>
      <style>{`
        /* Token color CSS variables — kept as CSS since they're referenced by dynamic class names */
        .runtime-console-panel {
          --runtime-console-line-system: #7fb7ff;
          --runtime-console-line-info: #d7deea;
          --runtime-console-line-warn: #f6cd8b;
          --runtime-console-line-error: #ffadad;
          --runtime-console-line-debug: #bdc6d8;
          --runtime-console-token-time: #6c8ec7;
          --runtime-console-token-thread: #8d98ac;
          --runtime-console-token-level-info: #3fa061;
          --runtime-console-token-level-warn: #c7802f;
          --runtime-console-token-level-error: #d45e5e;
          --runtime-console-token-level-debug: #8a76d6;
          --runtime-console-token-level-trace: #6b7f93;
          --runtime-console-token-pid: #7c879b;
          --runtime-console-token-separator: #8e99aa;
          --runtime-console-token-java-package: #8b97aa;
          --runtime-console-token-java-class: #63b3d3;
          --runtime-console-token-java-meta: #7f8da5;
          --runtime-console-token-java: #6aa7c6;
          --runtime-console-log-bg: color-mix(in srgb, var(--surface-raised) 90%, #0b1220 10%);
          --runtime-console-log-font-size: 12px;
          --runtime-console-log-line-height: 1.45;
        }
        .runtime-console-panel.is-idea-classic {
          --runtime-console-line-info: #cfd6e3;
          --runtime-console-line-warn: #e7bf80;
          --runtime-console-line-error: #f2a0a0;
          --runtime-console-line-debug: #b5bfd5;
          --runtime-console-token-time: #4e6f99;
          --runtime-console-token-thread: #7d889d;
          --runtime-console-token-level-info: #3a9958;
          --runtime-console-token-level-warn: #b2711f;
          --runtime-console-token-level-error: #c75555;
          --runtime-console-token-level-debug: #7b6ac5;
          --runtime-console-token-level-trace: #5f7088;
          --runtime-console-token-pid: #75849c;
          --runtime-console-token-separator: #8793a7;
          --runtime-console-token-java-package: #7f8a9f;
          --runtime-console-token-java-class: #4e9bc4;
          --runtime-console-token-java-meta: #6e7e97;
          --runtime-console-token-java: #5a9ec0;
          --runtime-console-log-bg: color-mix(in srgb, var(--surface-raised) 76%, #0a0f1c 24%);
          --runtime-console-log-font-size: 11px;
          --runtime-console-log-line-height: 1.5;
        }
        :root[data-theme="light"] .runtime-console-panel,
        @media (prefers-color-scheme: light) { :root:not([data-theme]) .runtime-console-panel } {
          --runtime-console-line-system: #2f6fdd;
          --runtime-console-line-info: #334155;
          --runtime-console-line-warn: #8a4f08;
          --runtime-console-line-error: #b22d2d;
          --runtime-console-line-debug: #475569;
          --runtime-console-token-time: #2d5ca3;
          --runtime-console-token-thread: #6b7280;
          --runtime-console-token-level-info: #2f8f46;
          --runtime-console-token-level-warn: #b06500;
          --runtime-console-token-level-error: #be2f2f;
          --runtime-console-token-level-debug: #7a5ac6;
          --runtime-console-token-level-trace: #637186;
          --runtime-console-token-pid: #697489;
          --runtime-console-token-separator: #7a8598;
          --runtime-console-token-java-package: #7f8798;
          --runtime-console-token-java-class: #286b9b;
          --runtime-console-token-java-meta: #64748b;
          --runtime-console-token-java: #2f739f;
          --runtime-console-log-bg: color-mix(in srgb, var(--surface-raised) 98%, #f2f4f8 2%);
          --runtime-console-log-font-size: 12px;
          --runtime-console-log-line-height: 1.45;
        }
        /* Token coloring via CSS vars — cannot be replaced by arbitrary Tailwind values */
        .runtime-console-line.is-system { color: var(--runtime-console-line-system); }
        .runtime-console-line.is-info { color: var(--runtime-console-line-info); }
        .runtime-console-line.is-warn { color: var(--runtime-console-line-warn); }
        .runtime-console-line.is-error { color: var(--runtime-console-line-error); }
        .runtime-console-line.is-debug { color: var(--runtime-console-line-debug); }
        .runtime-console-token.is-level-info { color: var(--runtime-console-token-level-info); }
        .runtime-console-token.is-level-warn { color: var(--runtime-console-token-level-warn); }
        .runtime-console-token.is-level-error { color: var(--runtime-console-token-level-error); }
        .runtime-console-token.is-level-debug { color: var(--runtime-console-token-level-debug); }
        .runtime-console-token.is-level-trace { color: var(--runtime-console-token-level-trace); }
        .runtime-console-token.is-time { color: var(--runtime-console-token-time); }
        .runtime-console-token.is-thread { color: var(--runtime-console-token-thread); }
        .runtime-console-token.is-java { color: var(--runtime-console-token-java); }
        .runtime-console-token.is-java-package { color: var(--runtime-console-token-java-package); }
        .runtime-console-token.is-java-class { color: var(--runtime-console-token-java-class); }
        .runtime-console-token.is-java-meta { color: var(--runtime-console-token-java-meta); }
        .runtime-console-token.is-pid { color: var(--runtime-console-token-pid); }
        .runtime-console-token.is-separator { color: var(--runtime-console-token-separator); }
        /* action-theme uses CSS var for border/bg in active state */
        .runtime-console-action-theme { color: var(--runtime-console-token-java-class); pointer-events: auto; position: relative; z-index: 1; }
        .runtime-console-action-theme.is-active {
          color: var(--runtime-console-token-java-class);
          border-color: color-mix(in srgb, var(--runtime-console-token-java-class) 45%, var(--border-subtle) 55%);
          background: color-mix(in srgb, var(--runtime-console-token-java-class) 16%, transparent);
        }
        /* select trigger — heavily overridden for theme variants, kept as CSS */
        .runtime-console-select-trigger {
          width: 100%; min-height: 28px !important; height: 28px;
          border-radius: 0 !important; border: 0 !important;
          border-bottom: 1px solid #c9cfda !important;
          background: transparent !important; color: #1f2937 !important;
          font-size: 12px !important; font-weight: 500;
          font-family: var(--font-sans); box-shadow: none !important;
        }
        .runtime-console-select-trigger:hover:not([data-disabled]) { border-bottom-color: #94a3b8 !important; background: transparent !important; }
        .runtime-console-select-trigger:focus-visible { border-bottom-color: #3b82f6 !important; box-shadow: inset 0 -2px 0 rgba(59,130,246,0.55) !important; }
        .runtime-console-select-trigger[data-disabled] { opacity: 0.58; background: transparent !important; }
        .runtime-console-select-trigger-goal.is-compact { padding-inline: 0 !important; justify-content: center !important; }
        .runtime-console-select-trigger-goal.is-compact [data-slot="select-value"] { display: none; }
        .runtime-console-select-trigger-goal.is-compact [data-slot="select-icon"] { margin: 0 !important; }
        :root[data-theme="dark"] .runtime-console-select-trigger,
        :root[data-theme="dim"] .runtime-console-select-trigger { border-bottom-color: #334155 !important; color: #e5e7eb !important; }
        :root[data-theme="dark"] .runtime-console-select-trigger:hover:not([data-disabled]),
        :root[data-theme="dim"] .runtime-console-select-trigger:hover:not([data-disabled]) { border-bottom-color: #64748b !important; }
        :root[data-theme="dark"] .runtime-console-select-trigger:focus-visible,
        :root[data-theme="dim"] .runtime-console-select-trigger:focus-visible { border-bottom-color: #60a5fa !important; box-shadow: inset 0 -2px 0 rgba(96,165,250,0.72) !important; }
        @media (prefers-color-scheme: dark) {
          :root:not([data-theme]) .runtime-console-select-trigger { border-bottom-color: #334155 !important; color: #e5e7eb !important; }
          :root:not([data-theme]) .runtime-console-select-trigger:hover:not([data-disabled]) { border-bottom-color: #64748b !important; }
          :root:not([data-theme]) .runtime-console-select-trigger:focus-visible { border-bottom-color: #60a5fa !important; box-shadow: inset 0 -2px 0 rgba(96,165,250,0.72) !important; }
        }
        /* select list */
        .runtime-console-select-list { min-width: max(152px, var(--anchor-width)); max-height: min(34vh, 280px); padding: 4px; border: 0; border-radius: 12px; background: transparent; font-family: var(--font-sans); font-size: 13px; line-height: 1.4; }
        .runtime-console-select-list [data-slot="select-group-label"] { padding: 6px 10px 4px; font-size: 10px; font-weight: 600; letter-spacing: 0.01em; color: #8f96a3; }
        .runtime-console-select-list [data-slot="select-separator"] { margin: 6px 2px; background: #e7ebf1; }
        .runtime-console-select-list [data-slot="select-item"] { min-height: 30px; border-radius: 8px; grid-template-columns: 16px 1fr; gap: 8px; padding-inline: 9px 10px; color: #1f2937; font-size: 12px; font-weight: 500; }
        .runtime-console-select-list [data-slot="select-item"] svg { width: 12px; height: 12px; stroke-width: 2.2; }
        .runtime-console-select-list [data-slot="select-item"][data-highlighted] { background: #edf0f4; color: #111827; }
        .runtime-console-select-list [data-slot="select-item"][data-selected],
        .runtime-console-select-list [data-slot="select-item"][aria-selected="true"] { background: #e8edf4; color: #111827; }
        .runtime-console-select-list [data-slot="select-item"][data-disabled] { opacity: 0.45; }
        [data-slot="select-popup"]:has(.runtime-console-select-list) [data-slot="select-scroll-up-arrow"],
        [data-slot="select-popup"]:has(.runtime-console-select-list) [data-slot="select-scroll-down-arrow"] { display: none; }
        [data-slot="select-popup"]:has(.runtime-console-select-list) > div { border: 1px solid #d6dbe3 !important; background: #f7f8fa !important; border-radius: 12px !important; box-shadow: 0 10px 24px rgba(15,23,42,0.14) !important; overflow: hidden; }
        :root[data-theme="dark"] .runtime-console-select-list [data-slot="select-group-label"],
        :root[data-theme="dim"] .runtime-console-select-list [data-slot="select-group-label"] { color: #9ca3af; }
        :root[data-theme="dark"] .runtime-console-select-list [data-slot="select-separator"],
        :root[data-theme="dim"] .runtime-console-select-list [data-slot="select-separator"] { background: color-mix(in srgb, #334155 80%, transparent); }
        :root[data-theme="dark"] .runtime-console-select-list [data-slot="select-item"],
        :root[data-theme="dim"] .runtime-console-select-list [data-slot="select-item"] { color: #e5e7eb; }
        :root[data-theme="dark"] .runtime-console-select-list [data-slot="select-item"][data-highlighted],
        :root[data-theme="dim"] .runtime-console-select-list [data-slot="select-item"][data-highlighted] { background: color-mix(in srgb, #1f2937 72%, transparent); color: #f8fafc; }
        :root[data-theme="dark"] .runtime-console-select-list [data-slot="select-item"][data-selected],
        :root[data-theme="dark"] .runtime-console-select-list [data-slot="select-item"][aria-selected="true"],
        :root[data-theme="dim"] .runtime-console-select-list [data-slot="select-item"][data-selected],
        :root[data-theme="dim"] .runtime-console-select-list [data-slot="select-item"][aria-selected="true"] { background: color-mix(in srgb, #374151 76%, transparent); color: #ffffff; }
        :root[data-theme="dark"] [data-slot="select-popup"]:has(.runtime-console-select-list) > div,
        :root[data-theme="dim"] [data-slot="select-popup"]:has(.runtime-console-select-list) > div { border-color: color-mix(in srgb, #334155 85%, var(--border-subtle)) !important; background: color-mix(in srgb, #0a1223 92%, var(--surface-card)) !important; box-shadow: 0 12px 28px rgba(2,8,20,0.46) !important; }
        @media (prefers-color-scheme: dark) {
          :root:not([data-theme]) .runtime-console-select-list [data-slot="select-group-label"] { color: #9ca3af; }
          :root:not([data-theme]) .runtime-console-select-list [data-slot="select-separator"] { background: color-mix(in srgb, #334155 80%, transparent); }
          :root:not([data-theme]) .runtime-console-select-list [data-slot="select-item"] { color: #e5e7eb; }
          :root:not([data-theme]) .runtime-console-select-list [data-slot="select-item"][data-highlighted] { background: color-mix(in srgb, #1f2937 72%, transparent); color: #f8fafc; }
          :root:not([data-theme]) .runtime-console-select-list [data-slot="select-item"][data-selected],
          :root:not([data-theme]) .runtime-console-select-list [data-slot="select-item"][aria-selected="true"] { background: color-mix(in srgb, #374151 76%, transparent); color: #ffffff; }
          :root:not([data-theme]) [data-slot="select-popup"]:has(.runtime-console-select-list) > div { border-color: color-mix(in srgb, #334155 85%, var(--border-subtle)) !important; background: color-mix(in srgb, #0a1223 92%, var(--surface-card)) !important; box-shadow: 0 12px 28px rgba(2,8,20,0.46) !important; }
        }
        /* command input — border-bottom style, dark theme variants */
        .runtime-console-command-input { height: 28px; border-radius: 0; border: 0; border-bottom: 1px solid #c9cfda; background: transparent; color: var(--text-emphasis); font-size: 12px; padding: 0 6px; width: auto; min-width: 0; flex: 1 1 auto; font-family: var(--code-font-family, Menlo, Monaco, "Courier New", monospace); }
        .runtime-console-command-input:focus { outline: none; border-bottom-color: #3b82f6; box-shadow: inset 0 -2px 0 rgba(59,130,246,0.55); }
        :root[data-theme="dark"] .runtime-console-command-input,
        :root[data-theme="dim"] .runtime-console-command-input { border-bottom-color: #334155; }
        :root[data-theme="dark"] .runtime-console-command-input:focus,
        :root[data-theme="dim"] .runtime-console-command-input:focus { border-bottom-color: #60a5fa; box-shadow: inset 0 -2px 0 rgba(96,165,250,0.72); }
        @media (prefers-color-scheme: dark) {
          :root:not([data-theme]) .runtime-console-command-input { border-bottom-color: #334155; }
          :root:not([data-theme]) .runtime-console-command-input:focus { border-bottom-color: #60a5fa; box-shadow: inset 0 -2px 0 rgba(96,165,250,0.72); }
        }
        /* resizer hover — compound selector */
        .runtime-console-resizer:hover .runtime-console-resizer-bar,
        .runtime-console-panel.is-resizing .runtime-console-resizer-bar { width: 72px; background: var(--border-strong); }
        /* log scrollbar */
        .runtime-console-log::-webkit-scrollbar { width: 8px; }
        .runtime-console-log::-webkit-scrollbar-thumb { border-radius: 999px; background: color-mix(in srgb, var(--text-subtle), transparent 42%); }
      `}</style>
      <section
        className={`runtime-console-panel border-t border-(--border-subtle) bg-(--surface-debug) flex flex-col gap-[6px] col-[1_/_-1] row-[4] w-full min-h-[160px] flex-shrink-0 px-3 pt-1 pb-[10px] [-webkit-app-region:no-drag] relative z-[2]${isResizing ? " is-resizing select-none cursor-row-resize" : ""} is-idea-${ideaTheme}`}
        style={{ height: `${panelHeight}px` }}
      >
        <div
          className="runtime-console-resizer h-2 cursor-row-resize flex items-start justify-center flex-shrink-0"
          role="separator"
          aria-orientation="horizontal"
          aria-label={t("layout.resizeRuntimeConsole")}
          onMouseDown={handleResizeStart}
        >
          <span className="runtime-console-resizer-bar w-14 h-0.5 rounded-full bg-(--border-subtle) transition-[background,width] duration-[140ms] ease-in" aria-hidden />
        </div>
        <div className="runtime-console-header flex items-center justify-between gap-3 min-w-0">
          <div className="runtime-console-header-main flex items-center gap-2 min-w-0 flex-1">
            <div className="runtime-console-title-wrap inline-flex items-center gap-2 min-w-0 flex-[0_1_auto] whitespace-nowrap">
              <div className="runtime-console-title text-[12px] font-semibold text-(--text-emphasis)">{t("files.runConsoleTitle")}</div>
              <span className={`runtime-console-status inline-flex items-center py-[2px] px-1 pb-[3px] border-0 border-b-2 border-b-transparent text-(--text-faint) text-[11px] leading-[1.3] bg-transparent${
                status === "starting" || status === "running"
                  ? " is-starting is-running border-b-green-400 text-green-400"
                  : status === "error" || status === "stopped"
                    ? " is-error is-stopped border-b-red-400 text-red-400"
                    : ""
              } is-${status}`}>{statusLabel}</span>
              {exitCode !== null && exitCode !== undefined ? (
                <span className={`runtime-console-exit inline-flex items-center py-[2px] px-1 pb-[3px] border-0 border-b-2 border-b-transparent text-(--text-faint) text-[11px] leading-[1.3] bg-transparent${exitCode === 0 ? " is-ok border-b-green-400 text-green-400" : " is-fail border-b-red-400 text-red-400"}`}>
                  {t("files.exitCode", { code: exitCode })}
                </span>
              ) : null}
              {truncated ? (
                <span className="runtime-console-truncated inline-flex items-center py-[2px] px-2 rounded-full border border-amber-500/[.55] text-amber-500 text-[11px] leading-[1.3]">
                  {t("files.logsTruncated", { count: 5000 })}
                </span>
              ) : null}
            </div>
            <div className="runtime-console-command-inline flex items-center gap-1 min-w-0 flex-1" ref={commandInlineRef}>
              <div className="runtime-console-select-cluster inline-flex items-center gap-1 min-w-0 flex-[0_1_auto]">
                <div className={`runtime-console-select-wrap runtime-console-select-wrap-preset min-w-0 flex-[0_1_auto] max-[980px]:w-[116px] w-[146px]`}>
                  <Select
                    value={commandPresetId}
                    onValueChange={(value) => {
                      onCommandPresetChange?.(value as RuntimeCommandPresetId);
                    }}
                  >
                    <SelectTrigger
                      size="sm"
                      className="runtime-console-select-trigger runtime-console-select-trigger-preset w-auto"
                      aria-label={commandPresetLabel}
                      title={selectedPresetLabel}
                    >
                      <span className="runtime-console-select-trigger-text block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{selectedPresetLabel}</span>
                    </SelectTrigger>
                    <SelectPopup
                    side="top"
                    sideOffset={10}
                    align="start"
                    alignOffset={0}
                    alignItemWithTrigger={false}
                    className="runtime-console-select-list"
                  >
                      {commandPresetItems.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </div>
                <div
                  className={`runtime-console-select-wrap runtime-console-select-wrap-goal min-w-0 flex-[0_1_auto] max-[980px]:w-[116px]${
                    isGoalSelectCompact ? " is-compact w-[34px] min-w-[34px]" : " w-[146px]"
                  }`}
                >
                  <Select
                    value={selectedCommandGoal}
                    onValueChange={(value) => {
                      if (
                        value === COMMAND_OPTION_CUSTOM ||
                        !commandProgram ||
                        !commandGoalOptions.length
                      ) {
                        return;
                      }
                      onCommandInputChange?.(`${commandProgram} ${value}`);
                    }}
                  >
                    <SelectTrigger
                      size="sm"
                      className={`runtime-console-select-trigger runtime-console-select-trigger-goal w-auto${
                        isGoalSelectCompact ? " is-compact" : ""
                      }`}
                      aria-label={commandGoalLabel}
                      title={selectedGoalLabel}
                      disabled={!commandProgram || commandGoalOptions.length === 0}
                    >
                      <span className="runtime-console-select-trigger-text block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{selectedGoalLabel}</span>
                    </SelectTrigger>
                    <SelectPopup
                    side="top"
                    sideOffset={10}
                    align="start"
                    alignOffset={0}
                    alignItemWithTrigger={false}
                    className="runtime-console-select-list"
                  >
                      {commandTool === "maven" ? (
                        <>
                          <SelectGroup>
                            <SelectGroupLabel>{t("files.runCommandGoalGroupPhases")}</SelectGroupLabel>
                            {MAVEN_PHASE_OPTIONS.map((option) => (
                              <SelectItem key={option} value={option}>
                                {option}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                          <SelectSeparator />
                          <SelectGroup>
                            <SelectGroupLabel>{t("files.runCommandGoalGroupSpringBoot")}</SelectGroupLabel>
                            {MAVEN_SPRING_BOOT_OPTIONS.map((option) => (
                              <SelectItem key={option} value={option}>
                                {option}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </>
                      ) : commandTool === "gradle" ? (
                        <SelectGroup>
                          <SelectGroupLabel>{t("files.runCommandGoalGroupTasks")}</SelectGroupLabel>
                          {commandGoalOptions.map((option) => (
                            <SelectItem key={option} value={option}>
                              {option}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ) : commandTool === "node" ? (
                        <SelectGroup>
                          <SelectGroupLabel>{t("files.runCommandGoalGroupNodeScripts")}</SelectGroupLabel>
                          {commandGoalOptions.map((option) => (
                            <SelectItem key={option} value={option}>
                              {option}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ) : commandTool === "python" ? (
                        <SelectGroup>
                          <SelectGroupLabel>{t("files.runCommandGoalGroupPythonExamples")}</SelectGroupLabel>
                          {commandGoalOptions.map((option) => (
                            <SelectItem key={option} value={option}>
                              {option}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ) : commandTool === "go" ? (
                        <SelectGroup>
                          <SelectGroupLabel>{t("files.runCommandGoalGroupGoExamples")}</SelectGroupLabel>
                          {commandGoalOptions.map((option) => (
                            <SelectItem key={option} value={option}>
                              {option}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ) : null}
                      {commandGoalOptions.length > 0 ? (
                        <SelectSeparator />
                      ) : null}
                      <SelectItem value={COMMAND_OPTION_CUSTOM}>
                        {t("files.runCommandGoalCustom")}
                      </SelectItem>
                    </SelectPopup>
                  </Select>
                </div>
              </div>
              <input
                className="runtime-console-command-input"
                type="text"
                value={commandInput}
                onChange={(event) => {
                  onCommandInputChange?.(event.target.value);
                }}
                placeholder={commandInputPlaceholder}
                aria-label={commandInputLabel}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
              />
            </div>
          </div>
          <div className="runtime-console-actions inline-flex items-center gap-1 flex-wrap-nowrap justify-end flex-shrink-0">
            <button
              type="button"
              className="ghost icon-button runtime-console-action runtime-console-action-run w-7 h-7 p-0 rounded-lg text-green-400 hover:text-green-600 disabled:opacity-50"
              onClick={() => {
                void onRun?.();
              }}
              disabled={!canRun}
              aria-label={runLabel}
              title={runLabel}
            >
              <Play size={14} aria-hidden />
            </button>
            <button
              type="button"
              className="ghost icon-button runtime-console-action runtime-console-action-stop w-7 h-7 p-0 rounded-lg text-red-400 hover:text-red-600 disabled:opacity-50"
              onClick={() => {
                void onStop();
              }}
              disabled={!isStoppable}
              aria-label={stopLabel}
              title={stopLabel}
            >
              <Square size={14} aria-hidden />
            </button>
            <button
              type="button"
              className="ghost icon-button runtime-console-action w-7 h-7 p-0 rounded-lg"
              onClick={onClear}
              aria-label={clearLabel}
              title={clearLabel}
            >
              <Trash2 size={14} aria-hidden />
            </button>
            <button
              type="button"
              className={`ghost icon-button runtime-console-action w-7 h-7 p-0 rounded-lg${autoScroll ? " is-active text-(--text-emphasis) border-(--border-accent-soft) bg-(--surface-active)/60" : ""}`}
              onClick={onToggleAutoScroll}
              disabled={!onToggleAutoScroll}
              aria-label={autoScrollLabel}
              title={autoScrollLabel}
            >
              <ArrowDownToLine size={14} aria-hidden />
            </button>
            <button
              type="button"
              className={`ghost icon-button runtime-console-action w-7 h-7 p-0 rounded-lg${wrapLines ? " is-active text-(--text-emphasis) border-(--border-accent-soft) bg-(--surface-active)/60" : ""}`}
              onClick={onToggleWrapLines}
              disabled={!onToggleWrapLines}
              aria-label={wrapLinesLabel}
              title={wrapLinesLabel}
            >
              <WrapText size={14} aria-hidden />
            </button>
            <button
              type="button"
              className={`ghost icon-button runtime-console-action runtime-console-action-theme w-7 h-7 p-0 rounded-lg${
                ideaTheme === "classic" ? " is-active" : ""
              }`}
              onClick={() => {
                setIdeaTheme((prev) => (prev === "classic" ? "new-ui" : "classic"));
              }}
              aria-label={toggleThemeLabel}
              title={toggleThemeLabel}
            >
              <Palette size={14} aria-hidden />
            </button>
          </div>
        </div>
        <pre
          className={`runtime-console-log m-0 flex-1 min-h-0 px-3 py-[10px] rounded-lg border border-(--border-subtle) bg-[var(--runtime-console-log-bg)] text-(--text-normal) font-[family-name:var(--code-font-family,_Menlo,_Monaco,_monospace)] text-[length:var(--runtime-console-log-font-size)] leading-[var(--runtime-console-log-line-height)] [font-variant-ligatures:none] [tab-size:2] overflow-auto ${wrapLines ? "is-wrap whitespace-pre-wrap break-words overflow-wrap-anywhere" : "is-nowrap whitespace-pre break-normal"}`}
          ref={logRef}
        >
          {logLines.map((line, index) => (
            <span
              key={`line-${index}-${line.length}`}
              className={`runtime-console-line block is-${resolveLineTone(line)}`}
            >
              {renderSpringBootLine(line) ?? renderHighlightedLine(line)}
              {index < logLines.length - 1 ? "\n" : null}
            </span>
          ))}
        </pre>
      </section>
    </>
  );
}
