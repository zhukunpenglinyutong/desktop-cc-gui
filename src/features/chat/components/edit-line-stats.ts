import type { Message } from "@/lib/ipc";
import { isEditToolLabel } from "./agent-task-steps";

/** Parsed arguments of an edit-class tool call ({ old_string, new_string,
 * file_path }, plus the write/patch variants). */
export interface EditArgs {
  filePath?: string;
  oldString?: string;
  newString?: string;
  content?: string;
  patch?: string;
}

export function parseEditArgs(args: unknown): EditArgs | null {
  if (!args || typeof args !== "object") return null;
  const obj = args as Record<string, unknown>;
  const filePath =
    typeof obj.file_path === "string"
      ? obj.file_path
      : typeof obj.filePath === "string"
        ? obj.filePath
        : typeof obj.path === "string"
          ? obj.path
          : undefined;

  const oldString =
    typeof obj.old_string === "string"
      ? obj.old_string
      : typeof obj.oldString === "string"
        ? obj.oldString
        : undefined;

  const newString =
    typeof obj.new_string === "string"
      ? obj.new_string
      : typeof obj.newString === "string"
        ? obj.newString
        : undefined;

  const content = typeof obj.content === "string" ? obj.content : undefined;
  const patch =
    typeof obj.patch === "string"
      ? obj.patch
      : typeof obj.diff === "string"
        ? obj.diff
        : undefined;

  if (!oldString && !newString && !content && !patch) return null;
  return { filePath, oldString, newString, content, patch };
}

export interface DiffLine {
  type: "add" | "del" | "ctx" | "header";
  text: string;
  oldLineNo?: number;
  newLineNo?: number;
}

/** Compute a simple unified diff line set from old and new strings. */
export function computeDiffLines(oldStr?: string, newStr?: string): DiffLine[] {
  const oldLines = oldStr !== undefined ? oldStr.split("\n") : [];
  const newLines = newStr !== undefined ? newStr.split("\n") : [];
  const lines: DiffLine[] = [];

  let oldIdx = 1;
  let newIdx = 1;

  if (oldStr !== undefined && (newStr === undefined || newStr === "")) {
    // Pure deletion
    for (const l of oldLines) {
      lines.push({ type: "del", text: l, oldLineNo: oldIdx++ });
    }
    return lines;
  }

  if (newStr !== undefined && (oldStr === undefined || oldStr === "")) {
    // Pure addition
    for (const l of newLines) {
      lines.push({ type: "add", text: l, newLineNo: newIdx++ });
    }
    return lines;
  }

  // Find common prefix
  let startCommon = 0;
  while (
    startCommon < oldLines.length &&
    startCommon < newLines.length &&
    oldLines[startCommon] === newLines[startCommon]
  ) {
    lines.push({
      type: "ctx",
      text: oldLines[startCommon],
      oldLineNo: oldIdx++,
      newLineNo: newIdx++,
    });
    startCommon++;
  }

  // Find common suffix
  let oldEnd = oldLines.length - 1;
  let newEnd = newLines.length - 1;
  const suffixLines: DiffLine[] = [];
  while (
    oldEnd >= startCommon &&
    newEnd >= startCommon &&
    oldLines[oldEnd] === newLines[newEnd]
  ) {
    suffixLines.push({
      type: "ctx",
      text: oldLines[oldEnd],
      oldLineNo: oldEnd + 1,
      newLineNo: newEnd + 1,
    });
    oldEnd--;
    newEnd--;
  }

  // Changed lines in the middle
  for (let i = startCommon; i <= oldEnd; i++) {
    lines.push({ type: "del", text: oldLines[i], oldLineNo: oldIdx++ });
  }
  for (let j = startCommon; j <= newEnd; j++) {
    lines.push({ type: "add", text: newLines[j], newLineNo: newIdx++ });
  }

  return [...lines, ...suffixLines.reverse()];
}

/** Parse unified patch format (e.g. @@ ... @@). */
export function parsePatchLines(patch: string): DiffLine[] {
  const rawLines = patch.split("\n");
  const lines: DiffLine[] = [];
  let oldLine = 1;
  let newLine = 1;

  for (const raw of rawLines) {
    if (raw.startsWith("@@")) {
      lines.push({ type: "header", text: raw });
      const m = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (m) {
        oldLine = parseInt(m[1], 10);
        newLine = parseInt(m[2], 10);
      }
    } else if (raw.startsWith("-")) {
      lines.push({ type: "del", text: raw.slice(1), oldLineNo: oldLine++ });
    } else if (raw.startsWith("+")) {
      lines.push({ type: "add", text: raw.slice(1), newLineNo: newLine++ });
    } else {
      const text = raw.startsWith(" ") ? raw.slice(1) : raw;
      lines.push({
        type: "ctx",
        text,
        oldLineNo: oldLine++,
        newLineNo: newLine++,
      });
    }
  }
  return lines;
}

export interface EditLineStat {
  additions: number;
  deletions: number;
}

/** Added/removed line tally for one edit-tool call's arguments, or null when
 * the args carry no recognizable edit payload. */
export function countEditLines(args: unknown): EditLineStat | null {
  const edit = parseEditArgs(args);
  if (!edit) return null;
  let additions = 0;
  let deletions = 0;
  if (edit.patch) {
    for (const line of edit.patch.split("\n")) {
      if (line.startsWith("+")) additions++;
      else if (line.startsWith("-")) deletions++;
    }
    return { additions, deletions };
  }
  if (edit.content !== undefined) {
    return { additions: edit.content.split("\n").length, deletions: 0 };
  }
  const oldLines = edit.oldString === undefined ? [] : edit.oldString.split("\n");
  const newLines = edit.newString === undefined ? [] : edit.newString.split("\n");
  if (edit.oldString !== undefined && !edit.newString) {
    return { additions: 0, deletions: oldLines.length };
  }
  if (edit.newString !== undefined && !edit.oldString) {
    return { additions: newLines.length, deletions: 0 };
  }
  let start = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) start++;
  let oldEnd = oldLines.length;
  let newEnd = newLines.length;
  while (oldEnd > start && newEnd > start && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  return { additions: newEnd - start, deletions: oldEnd - start };
}

/**
 * Per-file line stats derived from the session transcript itself, keyed by
 * `message.path` exactly as `deriveEditedFiles` reports it so lookups line
 * up. Session-sourced instead of git-sourced: gitignored targets
 * (`.omp/**`), non-repo workspaces and files already committed mid-session
 * are invisible to git status but still real edits the user wants counted.
 * Repeated edits of one path accumulate — the session's total churn, not the
 * last call's.
 */
export function deriveEditLineStats(messages: Message[]): Map<string, EditLineStat> {
  return createEditLineStatsBuilder()(messages);
}

/** Shared per-message line-count cache across session switches: WeakMap keys
 *  never retain evicted messages, so switching tabs reuses parsed edit args. */
const sharedEditLineCache = new WeakMap<Message, EditLineStat | null>();

export function createEditLineStatsBuilder() {
  const cache = sharedEditLineCache;
  let previous: Message[] = [];
  let stats = new Map<string, EditLineStat>();
  return (messages: Message[]): Map<string, EditLineStat> => {
    const edits = messages.filter(message => message.role === "tool" && message.path &&
      isEditToolLabel(message.text) && !/^[a-z][a-z0-9+.-]*:\/\//i.test(message.path));
    if (edits.length === previous.length && edits.every((message, index) => message === previous[index])) return stats;
    const next = new Map<string, EditLineStat>();
    for (const message of edits) {
      let stat = cache.get(message);
      if (stat === undefined) {
        stat = countEditLines(message.args);
        cache.set(message, stat);
      }
      if (!stat) continue;
      const path = message.path!;
      const accumulated = next.get(path);
      next.set(path, {
        additions: (accumulated?.additions ?? 0) + stat.additions,
        deletions: (accumulated?.deletions ?? 0) + stat.deletions,
      });
    }
    previous = edits;
    stats = next;
    return stats;
  };
}
