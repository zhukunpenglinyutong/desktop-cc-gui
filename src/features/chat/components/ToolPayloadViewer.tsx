import { memo, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Terminal from "lucide-react/dist/esm/icons/terminal";
import FileDiff from "lucide-react/dist/esm/icons/file-diff";
import Copy from "lucide-react/dist/esm/icons/copy";
import Check from "lucide-react/dist/esm/icons/check";
import AlertCircle from "lucide-react/dist/esm/icons/alert-circle";
import CornerDownRight from "lucide-react/dist/esm/icons/corner-down-right";
import { cx } from "@/utils/cx";
import { useCopied } from "@/hooks/use-copied";
import {
  computeDiffLines,
  parseEditArgs,
  parsePatchLines,
  previewContentLines,
  previewDiffLines,
  previewPatchLines,
  type BoundedDiffLines,
  type DiffLine,
  type EditArgs,
} from "./edit-line-stats";

export interface ToolPayloadViewerProps {
  toolName: string;
  path?: string | null;
  args?: unknown;
  result?: unknown;
}

/** Cap rendered payload size in DOM so MB-scale tool outputs (e.g. bash logs,
 *  big diffs) do not freeze layout/scrolling when expanded. */
const TOOL_TEXT_PREVIEW_CHARS = 32_000;
const TOOL_DIFF_PREVIEW_LINES = 400;

/** A diff narrowed to the rendered window. Built once per tool-call args
 *  object: the store replaces a tool row instead of mutating its args, so the
 *  reference survives collapses and re-opening a panel reuses the window
 *  instead of re-materializing a line object per file line. */
interface DiffPreview extends BoundedDiffLines {
  filePath?: string;
  copyText: string;
  /** Whole line set, built only for the explicit 「显示全部」 click. */
  expand: () => DiffLine[];
}

const diffPreviewCache = new WeakMap<object, DiffPreview | null>();

function buildDiffPreview(edit: EditArgs, path: string | null | undefined): DiffPreview {
  const { patch, content, oldString, newString } = edit;
  const bounded = patch
    ? previewPatchLines(patch, TOOL_DIFF_PREVIEW_LINES)
    : content !== undefined
      ? previewContentLines(content, TOOL_DIFF_PREVIEW_LINES)
      : previewDiffLines(oldString, newString, TOOL_DIFF_PREVIEW_LINES);
  return {
    ...bounded,
    filePath: edit.filePath ?? path ?? undefined,
    copyText: newString ?? content ?? patch ?? oldString ?? "",
    expand: () =>
      patch
        ? parsePatchLines(patch)
        : content !== undefined
          ? content.split("\n").map((text, index) => ({
              type: "add" as const,
              text,
              newLineNo: index + 1,
            }))
          : computeDiffLines(oldString, newString),
  };
}

/** Cached diff window for an edit-class tool call, or null when the args carry
 *  no diffable payload (the generic viewer takes over then). */
function diffPreviewOf(args: unknown, path: string | null | undefined): DiffPreview | null {
  if (!args || typeof args !== "object") return null;
  const cached = diffPreviewCache.get(args);
  if (cached !== undefined) return cached;
  const edit = parseEditArgs(args);
  const preview = edit ? buildDiffPreview(edit, path) : null;
  diffPreviewCache.set(args, preview);
  return preview;
}

/** Tool payloads never change in place, so their rendered text is cached per
 *  object identity: the same panel is re-expanded many times. The cache is
 *  skipped above the render cap so a multi-megabyte payload never pins a
 *  second full copy of itself in memory — re-serializing that rare case costs
 *  a few milliseconds, retaining it costs the session's budget. */
const CACHEABLE_TEXT_CHARS = TOOL_TEXT_PREVIEW_CHARS * 4;
const jsonTextCache = new WeakMap<object, string | null>();
const resultTextCache = new WeakMap<object, { text: string; isError: boolean } | null>();

function formatToolArgs(args: unknown): string | null {
  if (args == null) return null;
  if (typeof args === "string") return args.trim();
  if (typeof args !== "object") return JSON.stringify(args, null, 2) ?? null;
  const cached = jsonTextCache.get(args);
  if (cached !== undefined) return cached;
  let text: string | null;
  try {
    const json = JSON.stringify(args, null, 2);
    text = json && json !== "{}" && json !== "[]" ? json : null;
  } catch {
    text = String(args);
  }
  if (text === null || text.length <= CACHEABLE_TEXT_CHARS) jsonTextCache.set(args, text);
  return text;
}

function truncatePreviewText(text: string): {
  text: string;
  truncated: boolean;
  totalChars: number;
} {
  if (text.length <= TOOL_TEXT_PREVIEW_CHARS) {
    return { text, truncated: false, totalChars: text.length };
  }
  // Do not split a surrogate pair (emoji) at the cut, or a stray "\uFFFD" shows.
  const end = /[\uD800-\uDBFF]/.test(text[TOOL_TEXT_PREVIEW_CHARS - 1])
    ? TOOL_TEXT_PREVIEW_CHARS - 1
    : TOOL_TEXT_PREVIEW_CHARS;
  return {
    text: text.slice(0, end),
    truncated: true,
    totalChars: text.length,
  };
}

function BoundedPre({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const [showFull, setShowFull] = useState(false);
  const preview = useMemo(() => truncatePreviewText(text), [text]);
  const visibleText = showFull ? text : preview.text;
  return (
    <>
      <pre className={className}>{visibleText}</pre>
      {preview.truncated && !showFull ? (
        <div className="flex items-center justify-between border-t border-border-secondary/60 bg-background-secondary-default/40 px-3 py-1.5 text-[11px] text-text-tertiary">
          <span>
            {t("chat.toolPayloadTruncated", {
              shown: preview.text.length.toLocaleString(i18n.language),
              total: preview.totalChars.toLocaleString(i18n.language),
            })}
          </span>
          <button
            type="button"
            onClick={() => setShowFull(true)}
            className="cursor-pointer font-medium text-accent-500 hover:underline"
          >
            {t("chat.toolPayloadShowAll")}
          </button>
        </div>
      ) : null}
    </>
  );
}
/** Check if the tool is an edit/diff operation. */
function isEditTool(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.includes("edit") ||
    lower.includes("write") ||
    lower.includes("patch") ||
    lower.includes("diff")
  );
}

/** Check if the tool is a bash/terminal command. */
function isBashTool(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower === "bash" ||
    lower === "sh" ||
    lower === "shell" ||
    lower === "terminal" ||
    lower.includes("command") ||
    lower.includes("exec")
  );
}

/** Git Diff-style file change viewer. Renders the precomputed window so the
 *  panel opens on the click frame; the unbounded line set is built only when
 *  the user asks for every line. */
export const FileDiffViewer = memo(function FileDiffViewer({
  preview,
}: {
  preview: DiffPreview;
}) {
  const { t } = useTranslation();
  const { copied, copy } = useCopied();
  const [showAll, setShowAll] = useState(false);
  const fullLines = useMemo(() => (showAll ? preview.expand() : null), [showAll, preview]);
  const lines = fullLines ?? preview.lines;
  const total = fullLines ? fullLines.length : preview.total;
  const { addCount, delCount, filePath, copyText } = preview;
  const fileName = filePath ? filePath.split(/[\\/]/).pop() : null;

  return (
    <div className="mt-1.5 overflow-hidden rounded-md border border-border-secondary bg-background-primary-default text-[12px] font-mono leading-[1.6]">
      {/* Diff Header */}
      <div className="flex items-center justify-between border-b border-border-secondary bg-background-secondary-default px-2.5 py-1.5 text-caption-1-medium text-text-secondary">
        <div className="flex items-center gap-1.5 overflow-hidden">
          <FileDiff className="size-3.5 shrink-0 text-text-tertiary" aria-hidden />
          <span className="truncate" title={filePath}>
            {filePath || fileName || t("chat.editedFiles_one", { count: 1 })}
          </span>
          <div className="ml-1.5 flex items-center gap-1 tabular-nums text-[11px]">
            {addCount > 0 && (
              <span className="text-emerald-600 dark:text-emerald-400">+{addCount}</span>
            )}
            {delCount > 0 && (
              <span className="text-red-600 dark:text-red-400">-{delCount}</span>
            )}
          </div>
        </div>
        <button
          type="button"
          aria-label={t("chat.copy")}
          onClick={() => copy(copyText)}
          className="flex size-6 cursor-pointer items-center justify-center rounded text-foreground-icon-secondary transition-colors hover:bg-background-tertiary-hover hover:text-foreground-icon-primary"
        >
          {copied ? (
            <Check className="size-3.5 text-lime-500" aria-hidden />
          ) : (
            <Copy className="size-3.5" aria-hidden />
          )}
        </button>
      </div>

      {/* Diff Content */}
      <div className="max-h-72 overflow-auto py-1">
        {total === 0 ? (
          <div className="px-3 py-2 text-text-tertiary italic">
            {t("chat.diffEmpty")}
          </div>
        ) : (
          <>
            {lines.map((line, idx) => {
              const isAdd = line.type === "add";
              const isDel = line.type === "del";
              const isHdr = line.type === "header";
              return (
                <div
                  key={idx}
                  className={cx(
                    "flex items-baseline px-2 py-[1px] hover:bg-background-secondary-hover/40",
                    isAdd && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                    isDel && "bg-red-500/10 text-red-700 dark:text-red-300",
                    isHdr && "bg-background-tertiary-default/50 text-sky-600 dark:text-sky-400 font-semibold"
                  )}
                >
                  {/* Line Numbers */}
                  <span className="w-8 shrink-0 select-none text-right pr-2 text-[10px] text-text-quaternary tabular-nums">
                    {line.oldLineNo ?? ""}
                  </span>
                  <span className="w-8 shrink-0 select-none text-right pr-2 text-[10px] text-text-quaternary tabular-nums">
                    {line.newLineNo ?? ""}
                  </span>
                  {/* Sign */}
                  <span className="w-4 shrink-0 select-none text-center font-bold">
                    {isAdd ? "+" : isDel ? "-" : isHdr ? "@" : " "}
                  </span>
                  {/* Line text */}
                  <span className="flex-1 whitespace-pre-wrap break-all pl-1">
                    {line.text || " "}
                  </span>
                </div>
              );
            })}
            {!showAll && total > TOOL_DIFF_PREVIEW_LINES ? (
              <div className="flex items-center justify-between border-t border-border-secondary/60 bg-background-secondary-default/40 px-3 py-1.5 text-[11px] text-text-tertiary">
                <span>
                  {t("chat.toolDiffTruncated", {
                    shown: TOOL_DIFF_PREVIEW_LINES,
                    total,
                  })}
                </span>
                <button
                  type="button"
                  onClick={() => setShowAll(true)}
                  className="cursor-pointer font-medium text-accent-500 hover:underline"
                >
                  {t("chat.toolPayloadShowAll")}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
});

/** Parse bash command string and description. */
interface BashArgs {
  command: string;
  description?: string;
}

function parseBashArgs(args: unknown): BashArgs | null {
  if (!args) return null;
  if (typeof args === "string") {
    const cmd = args.trim();
    return cmd ? { command: cmd } : null;
  }
  if (typeof args === "object") {
    const obj = args as Record<string, unknown>;
    const cmd =
      typeof obj.command === "string"
        ? obj.command
        : typeof obj.cmd === "string"
          ? obj.cmd
          : typeof obj.script === "string"
            ? obj.script
            : null;
    const desc = typeof obj.description === "string" ? obj.description : undefined;
    if (cmd) return { command: cmd.trim(), description: desc };
  }
  return null;
}

/** Format execution result to readable string or object format. */
function formatExecutionResult(result: unknown): {
  text: string;
  isError: boolean;
} | null {
  if (result == null) return null;
  if (typeof result === "string") {
    const trimmed = result.trim();
    return trimmed ? { text: trimmed, isError: false } : null;
  }
  if (typeof result === "object") {
    const obj = result as Record<string, unknown>;
    // Check for standard stdout/stderr wrapper
    const stdout = typeof obj.stdout === "string" ? obj.stdout.trim() : "";
    const stderr = typeof obj.stderr === "string" ? obj.stderr.trim() : "";
    const isError = Boolean(obj.is_error || obj.isError || (stderr && !stdout));

    if (stdout && stderr) {
      return { text: `${stdout}\n--- stderr ---\n${stderr}`, isError };
    }
    if (stderr) return { text: stderr, isError: true };
    if (stdout) return { text: stdout, isError: false };

    // Fallback to JSON serialization
    try {
      const text = JSON.stringify(result, null, 2);
      return text && text !== "{}" ? { text, isError } : null;
    } catch {
      return { text: String(result), isError: false };
    }
  }
  return { text: String(result), isError: false };
}

/** `formatExecutionResult` memoized per payload object (see `resultTextCache`). */
function executionResultOf(result: unknown): { text: string; isError: boolean } | null {
  if (result !== null && typeof result === "object") {
    const cached = resultTextCache.get(result);
    if (cached !== undefined) return cached;
    const formatted = formatExecutionResult(result);
    if (formatted === null || formatted.text.length <= CACHEABLE_TEXT_CHARS) {
      resultTextCache.set(result, formatted);
    }
    return formatted;
  }
  return formatExecutionResult(result);
}

/** Terminal-style Bash Command & Result Viewer. */
export const BashCommandViewer = memo(function BashCommandViewer({
  toolName,
  command,
  description,
  result,
}: {
  toolName: string;
  command: string;
  description?: string;
  result?: unknown;
}) {
  const { t } = useTranslation();
  const { copied, copy } = useCopied();
  const [showResult, setShowResult] = useState(true);

  const formattedResult = useMemo(() => executionResultOf(result), [result]);

  return (
    <div className="mt-1.5 overflow-hidden rounded-md border border-border-secondary bg-background-primary-default text-[12px] font-mono leading-[1.55]">
      {/* Top Header Bar */}
      <div className="flex items-center justify-between border-b border-border-secondary bg-background-secondary-default px-2.5 py-1.5 text-caption-1-medium text-text-secondary">
        <div className="flex items-center gap-1.5 overflow-hidden">
          <Terminal className="size-3.5 shrink-0 text-text-tertiary" aria-hidden />
          <span className="font-semibold text-text-primary">{toolName}</span>
          {description && (
            <span className="truncate text-text-tertiary font-normal" title={description}>
              · {description}
            </span>
          )}
        </div>
        <button
          type="button"
          aria-label={t("chat.copy")}
          onClick={() => copy(command)}
          className="flex size-6 cursor-pointer items-center justify-center rounded text-foreground-icon-secondary transition-colors hover:bg-background-tertiary-hover hover:text-foreground-icon-primary"
        >
          {copied ? (
            <Check className="size-3.5 text-lime-500" aria-hidden />
          ) : (
            <Copy className="size-3.5" aria-hidden />
          )}
        </button>
      </div>

      {/* Command Block */}
      <div className="bg-background-secondary-default/50 px-3 py-2 text-text-primary">
        <div className="flex items-start gap-2">
          <span className="select-none font-bold text-emerald-600 dark:text-emerald-400">$</span>
          <div className="min-w-0 flex-1">
            <BoundedPre
              text={command}
              className="whitespace-pre-wrap break-all font-mono"
            />
          </div>
        </div>
      </div>

      {/* Execution Result Block */}
      {formattedResult && (
        <div className="border-t border-border-secondary bg-background-primary-default">
          <div className="flex items-center justify-between px-2.5 py-1 bg-background-secondary-default/30 text-[11px] text-text-tertiary">
            <button
              type="button"
              onClick={() => setShowResult((v) => !v)}
              className="flex items-center gap-1 cursor-pointer hover:text-text-secondary transition-colors"
            >
              <CornerDownRight className="size-3" aria-hidden />
              <span>{t("chat.toolResult")}</span>
              {formattedResult.isError && (
                <span className="flex items-center gap-0.5 text-red-600 dark:text-red-400 font-semibold">
                  <AlertCircle className="size-3" aria-hidden />
                  {t("chat.toolFailed")}
                </span>
              )}
            </button>
          </div>
          {showResult && (
            <BoundedPre
              text={formattedResult.text}
              className={cx(
                "max-h-60 overflow-auto whitespace-pre-wrap break-all px-3 py-2 text-[11px] leading-[1.5]",
                formattedResult.isError
                  ? "text-red-600 dark:text-red-400 bg-red-500/5"
                  : "text-text-secondary"
              )}
            />
          )}
        </div>
      )}
    </div>
  );
});

/** Generic Fallback Tool Args & Result Viewer. */
export const GenericToolViewer = memo(function GenericToolViewer({
  args,
  result,
}: {
  args?: unknown;
  result?: unknown;
}) {
  const { t } = useTranslation();
  const [showResult, setShowResult] = useState(true);

  const formattedArgs = useMemo(() => formatToolArgs(args), [args]);

  const formattedResult = useMemo(() => executionResultOf(result), [result]);

  if (!formattedArgs && !formattedResult) return null;

  return (
    <div className="mt-1.5 overflow-hidden rounded-md border border-border-secondary bg-background-secondary-default text-[11px] font-mono leading-[1.5]">
      {formattedArgs && (
        <div className="p-2">
          <div className="mb-1 text-caption-1-medium text-text-tertiary">
            {t("chat.toolCallArgs")}
          </div>
          <BoundedPre
            text={formattedArgs}
            className="max-h-56 overflow-auto whitespace-pre-wrap break-all text-text-secondary"
          />
        </div>
      )}
      {formattedResult && (
        <div className="border-t border-border-secondary bg-background-primary-default p-2">
          <button
            type="button"
            onClick={() => setShowResult((v) => !v)}
            className="mb-1 flex items-center gap-1 text-caption-1-medium text-text-tertiary hover:text-text-secondary cursor-pointer"
          >
            <CornerDownRight className="size-3" aria-hidden />
            <span>{t("chat.toolResult")}</span>
          </button>
          {showResult && (
            <BoundedPre
              text={formattedResult.text}
              className={cx(
                "max-h-56 overflow-auto whitespace-pre-wrap break-all text-text-secondary",
                formattedResult.isError && "text-red-600 dark:text-red-400"
              )}
            />
          )}
        </div>
      )}
    </div>
  );
});

/** Unified Entry Point: Automatically dispatches to DiffViewer, BashViewer, or GenericViewer. */
export const ToolPayloadViewer = memo(function ToolPayloadViewer({
  toolName,
  path,
  args,
  result,
}: ToolPayloadViewerProps) {
  // 1. Check if it is an edit tool with diffable args
  if (isEditTool(toolName)) {
    const preview = diffPreviewOf(args, path);
    if (preview) return <FileDiffViewer preview={preview} />;
  }

  // 2. Check if it is a bash/terminal command
  if (isBashTool(toolName)) {
    const bashArgs = parseBashArgs(args);
    if (bashArgs) {
      return (
        <BashCommandViewer
          toolName={toolName}
          command={bashArgs.command}
          description={bashArgs.description}
          result={result}
        />
      );
    }
  }

  // 3. Fallback to generic viewer
  return <GenericToolViewer args={args} result={result} />;
});
