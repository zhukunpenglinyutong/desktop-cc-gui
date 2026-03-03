import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { isWindowsPlatform } from "../../../utils/platform";
import type {
  RuntimeCommandPresetId,
  RuntimeConsoleStatus,
} from "../hooks/useRuntimeLogSession";

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

const ANSI_ESCAPE_PATTERN = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const LOG_TOKEN_PATTERN =
  /(\bTRACE\b|\bDEBUG\b|\bINFO\b|\bWARN\b|\bERROR\b|\[\s*[\w\-:.]+\s*\]|(?:\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d{3})?)|(?:[a-z_][\w$]*\.)+[A-Za-z_$][\w$]*(?:@[0-9a-fA-F]+)?|---)/g;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d{3})?$/;
const JAVA_FQCN_PATTERN = /^(?:[a-z_][\w$]*\.)+[A-Za-z_$][\w$]*(?:@[0-9a-fA-F]+)?$/;
const SPRING_BOOT_LINE_PATTERN =
  /^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d{3})?)\s+(TRACE|DEBUG|INFO|WARN|ERROR)\s+(\d+)\s+---\s+(\[[^\]]+\])\s+([^\s]+)\s*:\s?(.*)$/;
const RUNTIME_PANEL_MIN_HEIGHT = 160;
const RUNTIME_PANEL_MAX_HEIGHT = 640;
const RUNTIME_PANEL_DEFAULT_HEIGHT = 240;
const RUNTIME_PANEL_HEIGHT_STORAGE_KEY = "mossx.runtimeConsole.height";
const RUNTIME_PANEL_THEME_STORAGE_KEY = "mossx.runtimeConsole.ideaTheme";

type RuntimeLineTone = "default" | "system" | "info" | "warn" | "error" | "debug";
type RuntimeConsoleIdeaTheme = "classic" | "new-ui";
type RuntimeCommandTool = "maven" | "gradle" | "unknown";

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
const DEFAULT_MAVEN_WRAPPER_PROGRAM = isWindowsPlatform() ? "mvnw.cmd" : "./mvnw";
const DEFAULT_GRADLE_WRAPPER_PROGRAM = isWindowsPlatform() ? "gradlew.bat" : "./gradlew";

function hasProgramPrefix(commandInput: string, program: string) {
  const normalized = commandInput.trim().toLowerCase();
  const target = program.toLowerCase();
  return normalized === target || normalized.startsWith(`${target} `);
}

function resolveCommandTool(
  presetId: RuntimeCommandPresetId,
  commandInput: string,
): RuntimeCommandTool {
  if (presetId === "maven-wrapper" || presetId === "maven-system") {
    return "maven";
  }
  if (presetId === "gradle-wrapper" || presetId === "gradle-system") {
    return "gradle";
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
  if (presetId === "maven-wrapper") {
    if (hasProgramPrefix(commandInput, "mvnw.cmd")) return "mvnw.cmd";
    if (hasProgramPrefix(commandInput, "./mvnw")) return "./mvnw";
    return DEFAULT_MAVEN_WRAPPER_PROGRAM;
  }
  if (presetId === "maven-system") return "mvn";
  if (presetId === "gradle-wrapper") {
    if (hasProgramPrefix(commandInput, "gradlew.bat")) return "gradlew.bat";
    if (hasProgramPrefix(commandInput, "./gradlew")) return "./gradlew";
    return DEFAULT_GRADLE_WRAPPER_PROGRAM;
  }
  if (presetId === "gradle-system") return "gradle";
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
  if (line.includes("[CodeMoss Run]")) {
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
    <>
      <span key={`${keyPrefix}-pkg`} className="runtime-console-token is-java-package">
        {packagePart}
      </span>
      <span key={`${keyPrefix}-class`} className="runtime-console-token is-java-class">
        {classPart}
      </span>
      {hashPart ? (
        <span key={`${keyPrefix}-hash`} className="runtime-console-token is-java-meta">
          {hashPart}
        </span>
      ) : null}
    </>
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
    ? `${log}${log.endsWith("\n") || !log ? "" : "\n"}[CodeMoss Run] ${error}\n`
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
  const commandPresetOptions: ReadonlyArray<{ id: RuntimeCommandPresetId; label: string }> = [
    { id: "auto", label: t("files.runCommandPresetAuto") },
    { id: "maven-wrapper", label: t("files.runCommandPresetMavenWrapper") },
    { id: "maven-system", label: t("files.runCommandPresetMavenSystem") },
    { id: "gradle-wrapper", label: t("files.runCommandPresetGradleWrapper") },
    { id: "gradle-system", label: t("files.runCommandPresetGradleSystem") },
    { id: "custom", label: t("files.runCommandPresetCustom") },
  ];
  const selectedPresetLabel = useMemo(
    () =>
      commandPresetOptions.find((option) => option.id === commandPresetId)?.label ?? commandPresetId,
    [commandPresetId, commandPresetOptions],
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
    return [];
  }, [commandTool]);
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
      return (
        <>
          <span className="runtime-console-token is-time">{timestamp}</span>{" "}
          <span className={`runtime-console-token is-level is-level-${level.toLowerCase()}`}>
            {level}
          </span>{" "}
          <span className="runtime-console-token is-pid">{pid}</span>{" "}
          <span className="runtime-console-token is-separator">---</span>{" "}
          <span className="runtime-console-token is-thread">{thread}</span>{" "}
          {renderJavaToken(logger, "spring-logger")}
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
    <section
      className={`runtime-console-panel is-idea-${ideaTheme}${isResizing ? " is-resizing" : ""}`}
      style={{ height: `${panelHeight}px` }}
    >
      <div
        className="runtime-console-resizer"
        role="separator"
        aria-orientation="horizontal"
        aria-label={t("layout.resizeRuntimeConsole")}
        onMouseDown={handleResizeStart}
      >
        <span className="runtime-console-resizer-bar" aria-hidden />
      </div>
      <div className="runtime-console-header">
        <div className="runtime-console-header-main">
          <div className="runtime-console-title-wrap">
            <div className="runtime-console-title">{t("files.runConsoleTitle")}</div>
            <span className={`runtime-console-status is-${status}`}>{statusLabel}</span>
            {exitCode !== null && exitCode !== undefined ? (
              <span className={`runtime-console-exit ${exitCode === 0 ? "is-ok" : "is-fail"}`}>
                {t("files.exitCode", { code: exitCode })}
              </span>
            ) : null}
            {truncated ? (
              <span className="runtime-console-truncated">
                {t("files.logsTruncated", { count: 5000 })}
              </span>
            ) : null}
          </div>
          <div className="runtime-console-command-inline" ref={commandInlineRef}>
            <div className="runtime-console-select-cluster">
              <div className="runtime-console-select-wrap runtime-console-select-wrap-preset">
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
                    <span className="runtime-console-select-trigger-text">{selectedPresetLabel}</span>
                  </SelectTrigger>
                  <SelectPopup
                  side="top"
                  sideOffset={10}
                  align="start"
                  alignOffset={0}
                  alignItemWithTrigger={false}
                  className="runtime-console-select-list"
                >
                    {commandPresetOptions.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
              <div
                className={`runtime-console-select-wrap runtime-console-select-wrap-goal${
                  isGoalSelectCompact ? " is-compact" : ""
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
                    <span className="runtime-console-select-trigger-text">{selectedGoalLabel}</span>
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
                    ) : null}
                    {commandTool === "maven" || commandTool === "gradle" ? (
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
        <div className="runtime-console-actions">
          <button
            type="button"
            className="ghost icon-button runtime-console-action runtime-console-action-run"
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
            className="ghost icon-button runtime-console-action runtime-console-action-stop"
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
            className="ghost icon-button runtime-console-action"
            onClick={onClear}
            aria-label={clearLabel}
            title={clearLabel}
          >
            <Trash2 size={14} aria-hidden />
          </button>
          <button
            type="button"
            className={`ghost icon-button runtime-console-action${autoScroll ? " is-active" : ""}`}
            onClick={onToggleAutoScroll}
            disabled={!onToggleAutoScroll}
            aria-label={autoScrollLabel}
            title={autoScrollLabel}
          >
            <ArrowDownToLine size={14} aria-hidden />
          </button>
          <button
            type="button"
            className={`ghost icon-button runtime-console-action${wrapLines ? " is-active" : ""}`}
            onClick={onToggleWrapLines}
            disabled={!onToggleWrapLines}
            aria-label={wrapLinesLabel}
            title={wrapLinesLabel}
          >
            <WrapText size={14} aria-hidden />
          </button>
          <button
            type="button"
            className={`ghost icon-button runtime-console-action runtime-console-action-theme${
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
        className={`runtime-console-log ${wrapLines ? "is-wrap" : "is-nowrap"}`}
        ref={logRef}
      >
        {logLines.map((line, index) => (
          <span
            key={`line-${index}-${line.length}`}
            className={`runtime-console-line is-${resolveLineTone(line)}`}
          >
            {renderSpringBootLine(line) ?? renderHighlightedLine(line)}
            {index < logLines.length - 1 ? "\n" : null}
          </span>
        ))}
      </pre>
    </section>
  );
}
