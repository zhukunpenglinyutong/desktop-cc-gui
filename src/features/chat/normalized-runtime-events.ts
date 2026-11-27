import type { NormalizedRuntimeEvent } from "@ccgui/plugin-sdk";
import type { EngineEventPayload } from "@/lib/events";

/**
 * Terminal facts resolved by the engine lifecycle, outside the event payload.
 * A raw `done` is intentionally insufficient: today it represents both a
 * completed turn and a user-killed process.
 */
export type EngineTerminalFact =
  | { status: "completed" }
  | { status: "cancelled" }
  | { status: "exited"; exitCode: number | null };

export interface RuntimeEventNormalizationContext {
  turnId: string;
  workspaceId: string;
  workspacePath: string;
  occurredAt: string;
  /** Clears all pending command identities for this run before normalization. */
  terminal?: EngineTerminalFact;
}

interface ToolMessageData {
  role?: unknown;
  text?: unknown;
  args?: unknown;
  result?: unknown;
  toolCallId?: unknown;
}

interface ToolMessage {
  /** Raw display text; a label (`name · intent`) or a bare tool name. */
  text: string;
  args: Record<string, unknown> | null;
  /** The engine's settled result, if the message carries one at all. */
  hasResult: boolean;
  result: unknown;
  toolCallId: string | null;
}

/** Tool names whose settled result means the engine wrote to a path. Matched
 *  case-insensitively — engines report `Edit`/`Write`, not `edit`. */
const MUTATING_TOOLS: Record<string, true> = {
  write: true,
  edit: true,
  multiedit: true,
  multi_edit: true,
  apply_patch: true,
  str_replace_editor: true,
  str_replace: true,
  create_file: true,
  notebook_edit: true,
  write_file: true,
};

/** Arg keys a mutating tool uses to name its target path, in priority order. */
const PATH_ARGS = ["path", "file_path", "filePath"] as const;

/** Arg keys an engine uses to carry the shell command text. */
const COMMAND_ARGS = ["command"] as const;

/** 展示用改动预览的上限：file-changed 会广播给所有插件，不能把整份
 *  大文件塞进事件（工具结果本身另有 64KB 上限）。 */
const MAX_FILE_CHANGE_PREVIEW_CHARS = 8 * 1024;
/** 参数与结果分两条消息到达时，按 toolCallId 暂存的预览条数上限。 */
const MAX_PENDING_FILE_CHANGES = 256;

interface PendingCommand {
  runId: string;
  command: string;
  cwd: string;
  startedAt: string;
  ambiguous: boolean;
}

interface PendingFileChange {
  runId: string;
  paths: string[];
  preview: string | null;
}

interface NormalizedBase {
  eventId: string;
  runId: string;
  turnId: string;
  engine: string;
  sessionId: string | null;
  workspaceId: string;
  workspacePath: string;
  occurredAt: string;
}

const MAX_PENDING_COMMANDS = 1_024;
const pendingCommands = new Map<string, PendingCommand>();
const pendingFileChanges = new Map<string, PendingFileChange>();

/**
 * Conservatively projects an engine event into the public plugin event model.
 * Missing or ambiguous source facts produce no event rather than a guess.
 */
export function normalizeEngineEvent(
  event: EngineEventPayload,
  context: RuntimeEventNormalizationContext,
): NormalizedRuntimeEvent | NormalizedRuntimeEvent[] | null {
  if (event.kind === "done" || event.kind === "error") {
    clearPendingCommands(event.runId);
    clearPendingFileChanges(event.runId);
  }
  const base = normalizedBase(event, context);
  if (!base) return null;

  if (event.kind === "error") {
    const error = typeof event.data === "string" ? event.data : undefined;
    return {
      ...base,
      kind: "turn-failed",
      ...(error === undefined ? {} : { error }),
    };
  }

  if (event.kind === "permission_denied") {
    const data = asRecord(event.data);
    if (!data || Array.isArray(event.data)) return null;
    return {
      ...base,
      kind: "permission-requested",
      tool: typeof data.tool === "string" && data.tool.trim() ? data.tool : null,
      path: typeof data.path === "string" && data.path.trim() ? data.path : null,
    };
  }

  if (event.kind === "message") {
    const data = asToolMessage(event.data);
    if (!data) return null;
    const label = data.text.trim();
    const args = data.args;
    const toolName = toolNameFromLabel(label).toLowerCase();

    // 参数与结果常分两条 message 到达（先 call，后 result）。结果行往往
    // 只有 toolCallId，路径与预览都要在 call 行按 id 暂存（OMP 的 hashline
    // edit 把路径写在 `input` 的 `[path#tag]` 头里）。
    if (Object.hasOwn(MUTATING_TOOLS, toolName) && !data.hasResult && data.toolCallId !== null) {
      const paths = collectFileChangePaths(args, null);
      const preview = fileChangePreview(args);
      if (paths.length > 0 || preview !== null) {
        rememberPendingFileChange(event.runId, data.toolCallId, paths, preview);
      }
    }

    // A mutating tool call may report its path in the call args, while OMP's
    // edit tool reports the authoritative path only in result.details.path.
    // Either shape is structured host data; neither asserts write success.
    if (Object.hasOwn(MUTATING_TOOLS, toolName) && data.hasResult) {
      const pending =
        data.toolCallId !== null ? takePendingFileChange(event.runId, data.toolCallId) : null;
      const paths = collectFileChangePaths(args, data.result);
      if (paths.length === 0 && pending !== null) paths.push(...pending.paths);
      const preview =
        resultDetailsDiff(data.result) ??
        (args ? fileChangePreview(args) : null) ??
        pending?.preview ??
        null;
      if (paths.length > 0) {
        const change = {
          ...base,
          kind: "file-changed" as const,
          change: "touched" as const,
          ...(preview === null ? {} : { preview }),
        };
        // 参数里的相对路径与结果里的绝对路径可能指向同一文件，按归一化
        // 后的工作区相对路径去重。
        const relativePaths: string[] = [];
        for (const path of paths) {
          const relative = workspaceRelative(path, context.workspacePath);
          if (!relativePaths.includes(relative)) relativePaths.push(relative);
        }
        if (relativePaths.length === 1) {
          return { ...change, path: relativePaths[0] };
        }
        // 一次调用可改多个文件（hashline 的多 `[path#tag]` 段、apply_patch
        // 的多文件 patch）：每个路径一条事件，eventId 加稳定后缀避免被
        // 消费方当重复事件丢掉。
        return relativePaths.map((path, index) => ({
          ...change,
          eventId: `${base.eventId}:file:${index}`,
          path,
        }));
      }
    }

    // A non-blank command arg means the engine invoked this command. Calls
    // carrying an adapter identity are retained until the matching split
    // result arrives; same-message call+result remains a pure projection.
    const command = args ? firstString(args, COMMAND_ARGS) : null;
    if (command !== null) {
      if (!data.hasResult) {
        if (data.toolCallId !== null) {
          rememberPendingCommand(event.runId, data.toolCallId, {
            command,
            cwd: context.workspacePath,
            startedAt: context.occurredAt,
          });
        }
        return {
          ...base,
          kind: "command-started",
          command,
          cwd: context.workspacePath,
          startedAt: context.occurredAt,
        };
      }
      if (data.toolCallId !== null) takePendingCommand(event.runId, data.toolCallId);
      return commandFinished(base, command, context.workspacePath, data.result, context.occurredAt);
    }

    if (data.hasResult && data.toolCallId !== null) {
      const pending = takePendingCommand(event.runId, data.toolCallId);
      if (pending && !pending.ambiguous) {
        return commandFinished(
          base,
          pending.command,
          pending.cwd,
          data.result,
          context.occurredAt,
          pending.startedAt,
        );
      }
    }

    // Only a settled tool reports a completion fact; a bare call start with
    // nothing actionable in its args stays silent.
    if (!data.hasResult) return null;

    return {
      ...base,
      kind: "tool-finished",
      toolName: label,
      status: "unknown",
    };
  }

  if (event.kind !== "done" || !context.terminal) return null;

  switch (context.terminal.status) {
    case "completed":
      return { ...base, kind: "assistant-completed" };
    case "cancelled":
      return { ...base, kind: "turn-cancelled" };
    case "exited":
      if (
        context.terminal.exitCode !== null &&
        !Number.isSafeInteger(context.terminal.exitCode)
      ) {
        return null;
      }
      return {
        ...base,
        kind: "runtime-exited",
        exitCode: context.terminal.exitCode,
      };
  }
}

function normalizedBase(
  event: EngineEventPayload,
  context: RuntimeEventNormalizationContext,
) {
  if (
    !event.runId ||
    !event.engine ||
    !Number.isSafeInteger(event.seq) ||
    event.seq < 1 ||
    (event.sessionId !== null && typeof event.sessionId !== "string") ||
    !context.turnId ||
    !context.workspaceId ||
    !context.workspacePath ||
    !context.occurredAt ||
    !Number.isFinite(Date.parse(context.occurredAt))
  ) {
    return null;
  }

  return {
    eventId: `${event.runId}:${event.seq}`,
    runId: event.runId,
    turnId: context.turnId,
    engine: event.engine,
    sessionId: event.sessionId,
    workspaceId: context.workspaceId,
    workspacePath: context.workspacePath,
    occurredAt: context.occurredAt,
  };
}

/**
 * Leading token of a tool display label (`name · intent`, e.g.
 * `write · Creating smoke note`). Only the name addresses the mutating
 * allowlist; the intent never does. The full label stays on the message for
 * `tool-finished`.
 */
export function toolNameFromLabel(text: string): string {
  const label = text.trim();
  const separator = label.indexOf("·");
  return (separator === -1 ? label : label.slice(0, separator)).trim();
}

/**
 * A tool `message`: the engine sends the call (args, no result) and the
 * result (no args) as separate messages, each its own fact. A row that
 * carries neither payload says nothing.
 */
function asToolMessage(value: unknown): ToolMessage | null {
  if (typeof value !== "object" || value === null) return null;
  const data = value as ToolMessageData;
  if (
    data.role !== "tool" ||
    typeof data.text !== "string" ||
    !data.text.trim()
  ) {
    return null;
  }
  const hasResult = Object.prototype.hasOwnProperty.call(data, "result");
  const args = asRecord(data.args);
  if (!args && !hasResult) return null;
  const toolCallId =
    typeof data.toolCallId === "string" && data.toolCallId.trim()
      ? data.toolCallId
      : null;
  return { text: data.text, args, hasResult, result: data.result, toolCallId };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

/** OMP edit results report the authoritative target at result.details.path
 *  (`resolvedPath` for write); Claude-style results may carry neither. */
function resultDetailsPath(result: unknown): string | null {
  const details = asRecord(asRecord(result)?.details);
  return details ? firstString(details, [...PATH_ARGS, "resolvedPath"]) : null;
}

/** Engine-reported post-edit diff (OMP edit `details.diff`), when it is a
 *  displayable string; structured patch objects stay out of the event. */
function resultDetailsDiff(result: unknown): string | null {
  const details = asRecord(asRecord(result)?.details);
  const diff = details ? stringArg(details, ["diff", "patch"]) : null;
  return diff !== null && diff.trim() ? boundedPreview(diff) : null;
}

/** First arg whose value is a non-blank string, in declared priority order. */
function firstString(
  args: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

/** The engine's numeric exit code, or null — never parsed from prose. */
function readExitCode(result: unknown): number | null {
  const record = asRecord(result);
  if (!record) return null;
  for (const key of ["exit_code", "exitCode"] as const) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function commandFinished(
  base: NormalizedBase,
  command: string,
  cwd: string,
  result: unknown,
  finishedAt: string,
  startedAt?: string,
): NormalizedRuntimeEvent {
  const exitCode = readExitCode(result);
  return {
    ...base,
    kind: "command-finished",
    command,
    cwd,
    exitCode,
    ...(startedAt === undefined ? {} : { startedAt }),
    finishedAt,
    status: exitCode === null ? "unknown" : exitCode === 0 ? "completed" : "failed",
  };
}

function commandIdentity(runId: string, toolCallId: string): string {
  return `${runId}\u0000${toolCallId}`;
}

function rememberPendingCommand(
  runId: string,
  toolCallId: string,
  command: Omit<PendingCommand, "runId" | "ambiguous">,
): void {
  const key = commandIdentity(runId, toolCallId);
  const existing = pendingCommands.get(key);
  pendingCommands.set(key, {
    runId,
    ...command,
    ambiguous: existing !== undefined,
  });
  if (existing !== undefined) return;
  while (pendingCommands.size > MAX_PENDING_COMMANDS) {
    const oldest = pendingCommands.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    pendingCommands.delete(oldest);
  }
}

function takePendingCommand(runId: string, toolCallId: string): PendingCommand | null {
  const key = commandIdentity(runId, toolCallId);
  const pending = pendingCommands.get(key) ?? null;
  pendingCommands.delete(key);
  return pending;
}

function clearPendingCommands(runId: string): void {
  for (const [key, pending] of pendingCommands) {
    if (pending.runId === runId) pendingCommands.delete(key);
  }
}

/** 参数行携带的展示预览按 toolCallId 暂存到结果行；界面上一次工具调用
 *  只产生一条 file-changed，暂存项在匹配或用完时删除。 */
function fileChangeIdentity(runId: string, toolCallId: string): string {
  return `${runId}\u0000${toolCallId}`;
}

function rememberPendingFileChange(
  runId: string,
  toolCallId: string,
  paths: string[],
  preview: string | null,
): void {
  pendingFileChanges.set(fileChangeIdentity(runId, toolCallId), { runId, paths, preview });
  while (pendingFileChanges.size > MAX_PENDING_FILE_CHANGES) {
    const oldest = pendingFileChanges.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    pendingFileChanges.delete(oldest);
  }
}

function takePendingFileChange(runId: string, toolCallId: string): PendingFileChange | null {
  const key = fileChangeIdentity(runId, toolCallId);
  const pending = pendingFileChanges.get(key) ?? null;
  pendingFileChanges.delete(key);
  return pending;
}

function clearPendingFileChanges(runId: string): void {
  for (const [key, pending] of pendingFileChanges) {
    if (pending.runId === runId) pendingFileChanges.delete(key);
  }
}

/** First arg whose value is a string (empty string counts: deleting a file's
 *  content is a real edit and still has a displayable payload). */
function stringArg(args: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string") return value;
  }
  return null;
}

function prefixLines(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function pairPreview(oldString: string | null, newString: string | null): string {
  const lines: string[] = [];
  if (oldString !== null) {
    for (const line of oldString.split("\n")) lines.push(`-${line}`);
  }
  if (newString !== null) {
    for (const line of newString.split("\n")) lines.push(`+${line}`);
  }
  return lines.join("\n");
}

/** Clamp by code point so a surrogate pair is never split at the cut. */
function boundedPreview(text: string): string {
  if (text.length <= MAX_FILE_CHANGE_PREVIEW_CHARS) return text;
  let end = MAX_FILE_CHANGE_PREVIEW_CHARS;
  if (/[\uD800-\uDBFF]/.test(text[end - 1])) end -= 1;
  return `${text.slice(0, end)}\n…（预览已截断）`;
}

/** Strip one pair of wrapping quotes from patch headers (`"my file.txt"`). */
function unquotePath(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/**
 * Paths carried by OMP-style `input` patch strings: hashline sections
 * (`[path#TAG]`) and apply_patch / sloppy file headers. Structured `path`
 * args still win; this is the fallback for tools whose only path lives in
 * the patch text.
 */
function inputFilePaths(args: Record<string, unknown> | null): string[] {
  if (!args) return [];
  const input = stringArg(args, ["input"]);
  if (input === null) return [];
  const paths: string[] = [];
  for (const match of input.matchAll(/(?:^|\n)[ \t]*\[([^\]\n#]+)#[^\]\n]*\]/g)) {
    paths.push(match[1]);
  }
  for (const match of input.matchAll(/^[ \t]*\*\*\* (?:Add|Update|Delete|Edit) File:[ \t]*(.+)$/gm)) {
    paths.push(match[1]);
  }
  for (const match of input.matchAll(/^[ \t]*\*\*\* Move to:[ \t]*(.+)$/gm)) {
    paths.push(match[1]);
  }
  return paths;
}

/** Structured path arg → result.details.path → paths inside an `input` patch. */
function collectFileChangePaths(
  args: Record<string, unknown> | null,
  result: unknown,
): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  const add = (value: string | null | undefined) => {
    if (typeof value !== "string") return;
    const trimmed = unquotePath(value);
    if (!trimmed) return;
    const key = trimmed.replace(/\\/g, "/");
    if (seen.has(key)) return;
    seen.add(key);
    paths.push(trimmed);
  };
  add(args ? firstString(args, PATH_ARGS) : null);
  add(resultDetailsPath(result));
  for (const path of inputFilePaths(args)) add(path);
  return paths;
}

/**
 * 展示用改动预览（不保证是合法 patch）：优先引擎给的 patch/diff，其次
 * patch 原文（apply_patch / OMP hashline 的 `input`），再次整份新内容，
 * 最后 old→new 片段；MultiEdit 的 edits 依次拼接。
 */
function fileChangePreview(args: Record<string, unknown> | null): string | null {
  if (!args) return null;
  const patch = stringArg(args, ["patch", "diff"]);
  if (patch !== null && patch.trim()) return boundedPreview(patch);

  const rawInput = stringArg(args, ["input"]);
  if (rawInput !== null && rawInput.trim()) return boundedPreview(rawInput);

  const content = stringArg(args, ["content"]);
  if (content !== null) return boundedPreview(prefixLines(content, "+"));

  const oldString = stringArg(args, ["old_string", "oldString"]);
  const newString = stringArg(args, ["new_string", "newString"]);
  if (oldString !== null || newString !== null) {
    return boundedPreview(pairPreview(oldString, newString));
  }

  const edits = Array.isArray(args.edits) ? args.edits : null;
  if (edits !== null) {
    const chunks: string[] = [];
    for (const edit of edits) {
      const record = asRecord(edit);
      if (!record) continue;
      const oldEdit = stringArg(record, ["old_string", "oldString"]);
      const newEdit = stringArg(record, ["new_string", "newString"]);
      if (oldEdit === null && newEdit === null) continue;
      chunks.push(pairPreview(oldEdit, newEdit));
    }
    if (chunks.length > 0) return boundedPreview(chunks.join("\n@@\n"));
  }
  return null;
}

/** Path relative to the workspace root when it sits strictly under it (drive
 *  letters compared case-insensitively); otherwise the path as reported. */
function workspaceRelative(path: string, workspacePath: string): string {
  const file = path.replace(/\\/g, "/");
  const root = workspacePath.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!root) return path;
  const boundary = `${root}/`;
  const prefix = file.slice(0, boundary.length);
  const under = /^[a-zA-Z]:\//u.test(root)
    ? prefix.toLowerCase() === boundary.toLowerCase()
    : prefix === boundary;
  return under ? file.slice(boundary.length) : path;
}
