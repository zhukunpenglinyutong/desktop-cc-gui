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

/** "\n"-separated line count without materializing the lines
 *  (`text.split("\n").length` in O(1) allocations). */
export function countTextLines(text: string): number {
  let count = 1;
  for (let at = text.indexOf("\n"); at >= 0; at = text.indexOf("\n", at + 1)) count++;
  return count;
}

/** Forward line cursor: `text.split("\n")` order without the array. */
class LineCursor {
  private offset = 0;
  private exhausted = false;
  constructor(private readonly text: string) {}
  next(): string | undefined {
    if (this.exhausted) return undefined;
    const at = this.text.indexOf("\n", this.offset);
    if (at < 0) {
      this.exhausted = true;
      const line = this.text.slice(this.offset);
      this.offset = this.text.length;
      return line;
    }
    const line = this.text.slice(this.offset, at);
    this.offset = at + 1;
    return line;
  }
}

/** Backward line cursor: `text.split("\n").reverse()` order. Comparing the
 *  common suffix is what keeps a one-line edit at the top of a 20k-line file
 *  from materializing the other 19,999 lines. */
class ReverseLineCursor {
  private end: number;
  private exhausted = false;
  constructor(private readonly text: string) {
    this.end = text.length;
  }
  next(): string | undefined {
    if (this.exhausted) return undefined;
    if (this.end === 0) {
      this.exhausted = true;
      // Only the empty text still owns a (single, empty) line here.
      return this.text.length === 0 ? "" : undefined;
    }
    const at = this.text.lastIndexOf("\n", this.end - 1);
    const line = this.text.slice(at + 1, this.end);
    if (at < 0) {
      this.exhausted = true;
      this.end = 0;
      return line;
    }
    this.end = at;
    return line;
  }
}

/** A diff narrowed to a rendered window. `total` / `addCount` / `delCount`
 *  describe the **whole** diff, so the header and the truncation banner stay
 *  exact while only `limit` lines are ever materialized. */
export interface BoundedDiffLines {
  lines: DiffLine[];
  total: number;
  addCount: number;
  delCount: number;
}

function oneSided(text: string, type: "add" | "del", limit: number): BoundedDiffLines {
  const total = countTextLines(text);
  const lines: DiffLine[] = [];
  const cursor = new LineCursor(text);
  for (let index = 0; index < total && lines.length < limit; index++) {
    const line = cursor.next() ?? "";
    lines.push(
      type === "add"
        ? { type, text: line, newLineNo: index + 1 }
        : { type, text: line, oldLineNo: index + 1 },
    );
  }
  return {
    lines,
    total,
    addCount: type === "add" ? total : 0,
    delCount: type === "del" ? total : 0,
  };
}

/** Bounded equivalent of `content.split("\n").map(add line)`. */
export function previewContentLines(content: string, limit: number): BoundedDiffLines {
  return oneSided(content, "add", limit);
}

/** Bounded equivalent of `parsePatchLines(patch)`; the hunk header numbering
 *  and the +/- classification match the unbounded parser line for line. */
const PATCH_HUNK = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function previewPatchLines(patch: string, limit: number): BoundedDiffLines {
  const lines: DiffLine[] = [];
  let addCount = 0;
  let delCount = 0;
  let total = 0;
  let oldLine = 1;
  let newLine = 1;
  const cursor = new LineCursor(patch);
  for (let raw = cursor.next(); raw !== undefined; raw = cursor.next()) {
    total++;
    if (raw.startsWith("@@")) {
      const match = PATCH_HUNK.exec(raw);
      if (match) {
        oldLine = parseInt(match[1], 10);
        newLine = parseInt(match[2], 10);
      }
      if (lines.length < limit) lines.push({ type: "header", text: raw });
    } else if (raw.startsWith("-")) {
      delCount++;
      if (lines.length < limit) lines.push({ type: "del", text: raw.slice(1), oldLineNo: oldLine++ });
    } else if (raw.startsWith("+")) {
      addCount++;
      if (lines.length < limit) lines.push({ type: "add", text: raw.slice(1), newLineNo: newLine++ });
    } else {
      const text = raw.startsWith(" ") ? raw.slice(1) : raw;
      if (lines.length < limit) lines.push({ type: "ctx", text, oldLineNo: oldLine, newLineNo: newLine });
      oldLine++;
      newLine++;
    }
  }
  return { lines, total, addCount, delCount };
}

/** Bounded equivalent of `computeDiffLines(oldStr, newStr)`: same prefix /
 *  deletion / addition / suffix order and numbering, but at most `limit` lines
 *  are built and the rest are only walked for the counts. */
export function previewDiffLines(
  oldStr: string | undefined,
  newStr: string | undefined,
  limit: number,
): BoundedDiffLines {
  const hasOld = oldStr !== undefined && oldStr !== "";
  const hasNew = newStr !== undefined && newStr !== "";
  if (!hasOld && !hasNew) return { lines: [], total: 0, addCount: 0, delCount: 0 };
  if (!hasNew) return oneSided(oldStr!, "del", limit);
  if (!hasOld) return oneSided(newStr!, "add", limit);

  const oldCount = countTextLines(oldStr!);
  const newCount = countTextLines(newStr!);
  const minCount = Math.min(oldCount, newCount);
  const lines: DiffLine[] = [];
  const oldCursor = new LineCursor(oldStr!);
  const newCursor = new LineCursor(newStr!);
  let prefix = 0;
  let oldLine = oldCursor.next();
  let newLine = newCursor.next();
  while (
    prefix < minCount
    && oldLine !== undefined
    && newLine !== undefined
    && oldLine === newLine
  ) {
    if (lines.length < limit) {
      lines.push({ type: "ctx", text: oldLine, oldLineNo: prefix + 1, newLineNo: prefix + 1 });
    }
    prefix++;
    oldLine = oldCursor.next();
    newLine = newCursor.next();
  }

  // Suffix walk, clamped so it can never overlap the common prefix.
  let suffix = 0;
  const maxSuffix = minCount - prefix;
  if (maxSuffix > 0) {
    const oldBack = new ReverseLineCursor(oldStr!);
    const newBack = new ReverseLineCursor(newStr!);
    while (suffix < maxSuffix) {
      const a = oldBack.next();
      const b = newBack.next();
      if (a === undefined || b === undefined || a !== b) break;
      suffix++;
    }
  }

  const delCount = oldCount - prefix - suffix;
  const addCount = newCount - prefix - suffix;
  // The prefix walk consumed one lookahead line past the common prefix on each
  // side; whichever block ends up first (deletions, then the common suffix)
  // must start from that line, never from the cursor behind it.
  let oldLookahead = oldLine;
  let newLookahead = newLine;
  for (let index = 0; index < delCount && lines.length < limit; index++) {
    const line = oldLookahead ?? oldCursor.next();
    if (line === undefined) break;
    oldLookahead = undefined;
    lines.push({ type: "del", text: line, oldLineNo: prefix + index + 1 });
  }
  for (let index = 0; index < addCount && lines.length < limit; index++) {
    const line = newLookahead ?? newCursor.next();
    if (line === undefined) break;
    newLookahead = undefined;
    lines.push({ type: "add", text: line, newLineNo: prefix + index + 1 });
  }
  for (let index = 0; index < suffix && lines.length < limit; index++) {
    const line = oldLookahead ?? oldCursor.next();
    if (line === undefined) break;
    oldLookahead = undefined;
    lines.push({
      type: "ctx",
      text: line,
      oldLineNo: oldCount - suffix + index + 1,
      newLineNo: newCount - suffix + index + 1,
    });
  }
  return { lines, total: prefix + delCount + addCount + suffix, addCount, delCount };
}

export interface EditLineStat {
  additions: number;
  deletions: number;
}

/** Added/removed line tally for one edit-tool call's arguments, or null when
 * the args carry no recognizable edit payload. Walks the payload without
 * materializing lines: a whole-file write or a 20k-line edit costs one pass of
 * counting, not a split plus an object per line. */
export function countEditLines(args: unknown): EditLineStat | null {
  const edit = parseEditArgs(args);
  if (!edit) return null;
  const counts = edit.patch
    ? previewPatchLines(edit.patch, 0)
    : edit.content !== undefined
      ? previewContentLines(edit.content, 0)
      : previewDiffLines(edit.oldString, edit.newString, 0);
  return { additions: counts.addCount, deletions: counts.delCount };
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
