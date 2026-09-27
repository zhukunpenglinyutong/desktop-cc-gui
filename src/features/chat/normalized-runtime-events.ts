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

interface PendingCommand {
  runId: string;
  command: string;
  cwd: string;
  startedAt: string;
  ambiguous: boolean;
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

/**
 * Conservatively projects an engine event into the public plugin event model.
 * Missing or ambiguous source facts produce no event rather than a guess.
 */
export function normalizeEngineEvent(
  event: EngineEventPayload,
  context: RuntimeEventNormalizationContext,
): NormalizedRuntimeEvent | null {
  if (event.kind === "done" || event.kind === "error") {
    clearPendingCommands(event.runId);
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

    // A mutating tool call may report its path in the call args, while OMP's
    // edit tool reports the authoritative path only in result.details.path.
    // Either shape is structured host data; neither asserts write success.
    if (Object.hasOwn(MUTATING_TOOLS, toolName) && data.hasResult) {
      const path =
        (args ? firstString(args, PATH_ARGS) : null) ??
        resultDetailsPath(data.result);
      if (path !== null) {
        return {
          ...base,
          kind: "file-changed",
          path: workspaceRelative(path, context.workspacePath),
          change: "touched",
        };
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

/** OMP edit results report the authoritative target at result.details.path. */
function resultDetailsPath(result: unknown): string | null {
  const details = asRecord(asRecord(result)?.details);
  return details ? firstString(details, PATH_ARGS) : null;
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
