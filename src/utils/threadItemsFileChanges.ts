import { computeDiff } from "../features/messages/utils/diffUtils";
import type { ConversationItem } from "../types";

const FILE_CHANGE_PATH_KEYS = [
  "path",
  "file_path",
  "filePath",
  "target_file",
  "targetFile",
  "filename",
  "notebook_path",
  "notebookPath",
];
const FILE_CHANGE_STATUS_KEYS = ["kind", "status", "type", "action", "operation", "op"];
const FILE_CHANGE_DIFF_KEYS = ["diff", "patch", "unifiedDiff", "unified_diff"];
const FILE_CHANGE_PATCH_KEYS = [
  "patch",
  "input",
  "diff",
  "output",
  "aggregatedOutput",
  "result",
  "stdout",
  "stderr",
  "text",
];
const FILE_CHANGE_LIST_KEYS = ["files", "changes", "edits"];

type ToolChange = NonNullable<Extract<ConversationItem, { kind: "tool" }>["changes"]>[number];
type FileChangeEntry = { path: string; kind?: string; diff?: string };

function asString(value: unknown) {
  return typeof value === "string" ? value : value ? String(value) : "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function getFirstStringField(source: Record<string, unknown> | null, keys: string[]) {
  if (!source) {
    return "";
  }
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

export function normalizeFileChangeKind(rawKind: unknown): string | undefined {
  const normalized = asString(rawKind)
    .trim()
    .replace(/^\((.+)\)$/, "$1")
    .toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (["a", "add", "added", "create", "created", "new"].includes(normalized)) {
    return "add";
  }
  if (["d", "del", "delete", "deleted", "remove", "removed"].includes(normalized)) {
    return "delete";
  }
  if (["r", "rename", "renamed", "move", "moved"].includes(normalized)) {
    return "rename";
  }
  if (
    ["m", "mod", "modify", "modified", "u", "update", "updated", "edit", "edited"].includes(
      normalized,
    )
  ) {
    return "modified";
  }
  return normalized;
}

function looksLikeFilePathToken(path: string) {
  const normalized = path.trim();
  if (!normalized) {
    return false;
  }
  if (
    normalized.includes("/") ||
    normalized.includes("\\") ||
    normalized.startsWith("./") ||
    normalized.startsWith("../") ||
    /^[A-Za-z]:[\\/]/.test(normalized) ||
    normalized.includes(".")
  ) {
    return true;
  }
  return false;
}

function resolveStatusTokenKind(rawStatusToken: string): string | undefined {
  const token = rawStatusToken.trim().toUpperCase();
  if (!token) {
    return undefined;
  }
  if (!/^(?:[A-Z?]{1,2}|[RC][0-9]{1,3})$/.test(token)) {
    return undefined;
  }
  if (token.includes("?")) {
    return "add";
  }
  if (token.includes("R")) {
    return "rename";
  }
  if (token.includes("D")) {
    return "delete";
  }
  if (token.includes("A")) {
    return "add";
  }
  if (token.includes("M")) {
    return "modified";
  }
  if (token.includes("U")) {
    return "modified";
  }
  if (token.includes("C")) {
    return "rename";
  }
  const normalized = normalizeFileChangeKind(token);
  if (
    normalized === "add" ||
    normalized === "delete" ||
    normalized === "rename" ||
    normalized === "modified"
  ) {
    return normalized;
  }
  return undefined;
}

function parseRenamePath(rawPath: string): { previousPath?: string; nextPath?: string } {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return {};
  }
  const arrowMatch = trimmed.match(/^(.*?)\s+->\s+(.*)$/);
  if (!arrowMatch) {
    return {};
  }
  const previousPath = arrowMatch[1]?.trim();
  const nextPath = arrowMatch[2]?.trim();
  if (!previousPath || !nextPath) {
    return {};
  }
  return { previousPath, nextPath };
}

function buildSyntheticRenameDiff(previousPath: string, nextPath: string) {
  return [
    "*** Begin Patch",
    `*** Update File: ${previousPath}`,
    `*** Move to: ${nextPath}`,
    "*** End Patch",
  ].join("\n");
}

function parseStatusPathEntries(text: string): FileChangeEntry[] {
  if (!text.trim()) {
    return [];
  }
  const entries: FileChangeEntry[] = [];
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const normalizedLine = line.trim();
    if (!normalizedLine) {
      continue;
    }
    const match = normalizedLine.match(/^\(?([A-Z?]{1,2}|[RC][0-9]{1,3})\)?\s+(.+)$/);
    if (!match) {
      continue;
    }
    const statusToken = (match[1] ?? "").trim();
    const kind = resolveStatusTokenKind(statusToken);
    const rawPath = (match[2] ?? "").trim();
    if (!kind) {
      continue;
    }
    if (kind === "rename") {
      const { previousPath, nextPath } = parseRenamePath(rawPath);
      if (
        previousPath &&
        nextPath &&
        looksLikeFilePathToken(previousPath) &&
        looksLikeFilePathToken(nextPath)
      ) {
        entries.push({
          path: nextPath,
          kind: "rename",
          diff: buildSyntheticRenameDiff(previousPath, nextPath),
        });
        continue;
      }
    }
    if (!looksLikeFilePathToken(rawPath)) {
      continue;
    }
    entries.push({
      path: rawPath,
      kind,
    });
  }
  return entries;
}

function parsePatchFileEntries(text: string): FileChangeEntry[] {
  if (!text.trim()) {
    return [];
  }
  const entries: FileChangeEntry[] = [];
  const lines = text.split(/\r?\n/);
  let currentPath = "";
  let currentKind: string | undefined;
  let currentDiffLines: string[] = [];

  const flushCurrent = () => {
    if (!currentPath || currentPath === "/dev/null") {
      currentPath = "";
      currentKind = undefined;
      currentDiffLines = [];
      return;
    }
    const diff = currentDiffLines.join("\n").trim();
    entries.push({
      path: currentPath,
      kind: currentKind,
      diff: diff || undefined,
    });
    currentPath = "";
    currentKind = undefined;
    currentDiffLines = [];
  };

  const startCurrent = (path: string, kind?: string, keepHeaderLine?: string) => {
    flushCurrent();
    currentPath = path.trim();
    currentKind = kind;
    currentDiffLines = [];
    if (keepHeaderLine) {
      currentDiffLines.push(keepHeaderLine);
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    let matched = "";
    let kind: string | undefined;
    if (trimmed.startsWith("*** Add File: ")) {
      matched = trimmed.slice("*** Add File: ".length).trim();
      kind = "add";
    } else if (trimmed.startsWith("*** Update File: ")) {
      matched = trimmed.slice("*** Update File: ".length).trim();
      kind = "modified";
    } else if (trimmed.startsWith("*** Delete File: ")) {
      matched = trimmed.slice("*** Delete File: ".length).trim();
      kind = "delete";
    } else if (trimmed.startsWith("*** Move to: ")) {
      const movedPath = trimmed.slice("*** Move to: ".length).trim();
      if (currentPath && movedPath && movedPath !== "/dev/null") {
        currentPath = movedPath;
        if (!currentKind || currentKind === "modified") {
          currentKind = "rename";
        }
        currentDiffLines.push(line);
      }
      continue;
    } else if (trimmed.startsWith("+++ b/")) {
      matched = trimmed.slice("+++ b/".length).trim();
      kind = "modified";
    } else if (trimmed.startsWith("--- a/")) {
      matched = trimmed.slice("--- a/".length).trim();
      kind = "modified";
    } else if (trimmed.startsWith("diff --git ")) {
      const rest = trimmed.slice("diff --git ".length).trim();
      const parts = rest.split(/\s+/);
      const right = parts.length >= 2 ? (parts[1] ?? "") : "";
      if (right.startsWith("b/")) {
        matched = right.slice(2);
        kind = "modified";
      }
    }
    if (matched && matched !== "/dev/null") {
      startCurrent(matched, kind, line);
      continue;
    }
    if (!currentPath) {
      continue;
    }
    currentDiffLines.push(line);
  }
  flushCurrent();

  const byPath = new Map<string, FileChangeEntry>();
  entries.forEach((entry) => {
    const normalizedPath = entry.path.trim();
    if (!normalizedPath || normalizedPath === "/dev/null") {
      return;
    }
    const existing = byPath.get(normalizedPath);
    if (!existing) {
      byPath.set(normalizedPath, { ...entry, path: normalizedPath });
      return;
    }
    if (!existing.kind && entry.kind) {
      existing.kind = entry.kind;
    }
    const currentDiff = asString(existing.diff).trim();
    const incomingDiff = asString(entry.diff).trim();
    if (!currentDiff && incomingDiff) {
      existing.diff = incomingDiff;
      return;
    }
    if (currentDiff && incomingDiff && !currentDiff.includes(incomingDiff)) {
      existing.diff = `${currentDiff}\n\n${incomingDiff}`;
    }
  });
  return Array.from(byPath.values());
}

function countDiffEditLines(diff?: string): number {
  if (!diff) {
    return 0;
  }
  return diff.split("\n").reduce((count, line) => {
    if (line.startsWith("+++")) {
      return count;
    }
    if (line.startsWith("---")) {
      return count;
    }
    if (line.startsWith("+") || line.startsWith("-")) {
      return count + 1;
    }
    return count;
  }, 0);
}

function pickRicherDiff(primary?: string, secondary?: string): string | undefined {
  const primaryDiff = asString(primary).trim();
  const secondaryDiff = asString(secondary).trim();
  if (!primaryDiff) {
    return secondaryDiff || undefined;
  }
  if (!secondaryDiff) {
    return primaryDiff;
  }
  const primaryEdits = countDiffEditLines(primaryDiff);
  const secondaryEdits = countDiffEditLines(secondaryDiff);
  if (secondaryEdits > primaryEdits) {
    return secondaryDiff;
  }
  if (primaryEdits > secondaryEdits) {
    return primaryDiff;
  }
  return secondaryDiff.length > primaryDiff.length ? secondaryDiff : primaryDiff;
}

export function shouldPreferExplicitFileChangeOutput(explicitOutput: string): boolean {
  const normalized = explicitOutput.trim();
  if (!normalized) {
    return false;
  }
  if (
    normalized.startsWith("*** Begin Patch") ||
    normalized.startsWith("diff --git ") ||
    normalized.startsWith("@@ ")
  ) {
    return false;
  }
  if (!normalized.includes("\n") && /\bdiff\b/i.test(normalized)) {
    return false;
  }
  return true;
}

const SHELL_TOKEN_REGEX =
  /"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|`((?:\\.|[^`\\])*)`|([^\s]+)/g;
const COMMAND_SEPARATOR_TOKENS = new Set(["&&", "||", "|", ";", "·"]);
const DELETE_COMMAND_TOKENS = new Set([
  "rm",
  "del",
  "erase",
  "unlink",
  "remove-item",
  "removeitem",
  "ri",
]);
const CREATE_COMMAND_TOKENS = new Set(["touch"]);
const ADD_REDIRECTION_TOKENS = new Set([">", "1>"]);
const MODIFY_REDIRECTION_TOKENS = new Set([">>", "1>>"]);
const IGNORED_REDIRECTION_PATHS = new Set(["/dev/null", "nul"]);
const INLINE_REDIRECTION_REGEX = /^(.*?)(1>>|1>|>>|>)(.+)$/;

function decodeQuotedToken(value: string): string {
  return value.replace(/\\(["'`\\])/g, "$1");
}

function tokenizeShellCommand(command: string): string[] {
  if (!command.trim()) {
    return [];
  }
  const tokens: string[] = [];
  for (const match of command.matchAll(SHELL_TOKEN_REGEX)) {
    const rawToken = (match[1] ?? match[2] ?? match[3] ?? match[4] ?? "").trim();
    if (!rawToken) {
      continue;
    }
    const decoded = decodeQuotedToken(rawToken).trim();
    if (decoded) {
      tokens.push(decoded);
    }
  }
  return tokens;
}

function normalizeShellToken(token: string): string {
  return token.replace(/^[()]+|[();]+$/g, "").trim();
}

function normalizeShellPathToken(token: string): string {
  return normalizeShellToken(token).replace(/[<>]+$/, "").trim();
}

function shouldSkipShellPathToken(path: string): boolean {
  const normalized = path.trim();
  if (!normalized) {
    return true;
  }
  if (normalized === "--" || normalized.startsWith("-")) {
    return true;
  }
  if (IGNORED_REDIRECTION_PATHS.has(normalized.toLowerCase())) {
    return true;
  }
  if (
    normalized.startsWith("/") &&
    normalized.length <= 3 &&
    /^[a-z]$/i.test(normalized.slice(1))
  ) {
    return true;
  }
  return false;
}

function parseInlineRedirectionTarget(token: string) {
  const normalizedToken = normalizeShellToken(token);
  if (!normalizedToken) {
    return null;
  }
  const match = INLINE_REDIRECTION_REGEX.exec(normalizedToken);
  if (!match) {
    return null;
  }
  const operator = match[2]?.trim() ?? "";
  const rawPath = match[3]?.trim() ?? "";
  if (!operator || !rawPath) {
    return null;
  }
  return { operator, rawPath };
}

function inferWriteChangesFromCommand(command: string): FileChangeEntry[] {
  const tokens = tokenizeShellCommand(command);
  if (tokens.length === 0) {
    return [];
  }

  const inferred: FileChangeEntry[] = [];
  const seen = new Set<string>();
  const pushPath = (rawPath: string, kind: "add" | "modified") => {
    const path = normalizeShellPathToken(rawPath);
    if (!path) {
      return;
    }
    if (shouldSkipShellPathToken(path)) {
      return;
    }
    if (!looksLikeFilePathToken(path) || seen.has(path)) {
      return;
    }
    seen.add(path);
    inferred.push({
      path,
      kind,
    });
  };

  let index = 0;
  while (index < tokens.length) {
    const token = normalizeShellToken(tokens[index] ?? "");
    if (!token) {
      index += 1;
      continue;
    }
    if (
      ADD_REDIRECTION_TOKENS.has(token) ||
      MODIFY_REDIRECTION_TOKENS.has(token)
    ) {
      const kind = ADD_REDIRECTION_TOKENS.has(token) ? "add" : "modified";
      let nextIndex = index + 1;
      while (nextIndex < tokens.length) {
        const candidate = normalizeShellPathToken(tokens[nextIndex] ?? "");
        if (!candidate) {
          nextIndex += 1;
          continue;
        }
        if (COMMAND_SEPARATOR_TOKENS.has(candidate)) {
          break;
        }
        pushPath(candidate, kind);
        break;
      }
      index += 1;
      continue;
    }
    const inlineRedirection = parseInlineRedirectionTarget(token);
    if (inlineRedirection) {
      const kind = ADD_REDIRECTION_TOKENS.has(inlineRedirection.operator)
        ? "add"
        : "modified";
      pushPath(inlineRedirection.rawPath, kind);
      index += 1;
      continue;
    }
    if (COMMAND_SEPARATOR_TOKENS.has(token)) {
      index += 1;
      continue;
    }
    if (token.toLowerCase() === "sudo") {
      index += 1;
      continue;
    }
    if (!CREATE_COMMAND_TOKENS.has(token.toLowerCase())) {
      index += 1;
      continue;
    }
    index += 1;
    while (index < tokens.length) {
      const argument = normalizeShellPathToken(tokens[index] ?? "");
      if (!argument) {
        index += 1;
        continue;
      }
      if (COMMAND_SEPARATOR_TOKENS.has(argument)) {
        break;
      }
      if (shouldSkipShellPathToken(argument)) {
        index += 1;
        continue;
      }
      if (argument.toLowerCase() === "sudo") {
        break;
      }
      pushPath(argument, "add");
      index += 1;
    }
  }

  return inferred;
}

function inferDeleteChangesFromCommand(command: string): FileChangeEntry[] {
  const tokens = tokenizeShellCommand(command);
  if (tokens.length === 0) {
    return [];
  }

  const inferred: FileChangeEntry[] = [];
  const seen = new Set<string>();
  let index = 0;

  while (index < tokens.length) {
    const normalizedToken = normalizeShellToken(tokens[index] ?? "");
    if (!normalizedToken || COMMAND_SEPARATOR_TOKENS.has(normalizedToken)) {
      index += 1;
      continue;
    }
    if (normalizedToken.toLowerCase() === "sudo") {
      index += 1;
      continue;
    }
    const isDeleteCommand = DELETE_COMMAND_TOKENS.has(normalizedToken.toLowerCase());
    if (!isDeleteCommand) {
      index += 1;
      continue;
    }

    index += 1;
    while (index < tokens.length) {
      const argument = normalizeShellToken(tokens[index] ?? "");
      if (!argument) {
        index += 1;
        continue;
      }
      if (COMMAND_SEPARATOR_TOKENS.has(argument)) {
        break;
      }
      const lowerArgument = argument.toLowerCase();
      if (
        argument === "--" ||
        argument.startsWith("-") ||
        (argument.startsWith("/") &&
          argument.length <= 3 &&
          /^[a-z]$/i.test(argument.slice(1)))
      ) {
        index += 1;
        continue;
      }
      if (lowerArgument === "sudo" || DELETE_COMMAND_TOKENS.has(lowerArgument)) {
        break;
      }
      if (looksLikeFilePathToken(argument) && !seen.has(argument)) {
        seen.add(argument);
        inferred.push({
          path: argument,
          kind: "delete",
        });
      }
      index += 1;
    }
  }

  return inferred;
}

function mergeInferredEntry(
  byPath: Map<string, FileChangeEntry>,
  entry: FileChangeEntry,
) {
  const normalizedPath = entry.path.trim();
  if (!normalizedPath) {
    return;
  }
  const existing = byPath.get(normalizedPath);
  if (!existing) {
    byPath.set(normalizedPath, { ...entry, path: normalizedPath });
    return;
  }
  const existingKind = normalizeFileChangeKind(existing.kind);
  const incomingKind = normalizeFileChangeKind(entry.kind);
  if (!existingKind && incomingKind) {
    existing.kind = incomingKind;
  } else if (existingKind === "modified" && incomingKind && incomingKind !== "modified") {
    existing.kind = incomingKind;
  }
  existing.diff = pickRicherDiff(existing.diff, entry.diff);
}

export function inferFileChangesFromCommandExecutionArtifacts(
  command: string,
  output: string,
): FileChangeEntry[] {
  const normalizedOutput = output.trim();
  const normalizedCommand = command.trim();
  if (!normalizedOutput && !normalizedCommand) {
    return [];
  }

  const fromPatchEntries = [
    ...inferFileChangesFromPayload(normalizedCommand),
    ...inferFileChangesFromPayload(normalizedOutput),
  ];
  const byPath = new Map<string, FileChangeEntry>();
  for (const entry of fromPatchEntries) {
    mergeInferredEntry(byPath, entry);
  }
  for (const entry of inferWriteChangesFromCommand(normalizedCommand)) {
    mergeInferredEntry(byPath, entry);
  }
  for (const entry of inferDeleteChangesFromCommand(normalizedCommand)) {
    mergeInferredEntry(byPath, entry);
  }
  if (!normalizedOutput) {
    return Array.from(byPath.values()).filter((entry) => entry.path);
  }

  for (const entry of parseStatusPathEntries(normalizedOutput)) {
    mergeInferredEntry(byPath, entry);
  }

  const marker = normalizedOutput.match(/updated the following files:\s*([\s\S]*)/i);
  if (!marker) {
    return Array.from(byPath.values()).filter((entry) => entry.path);
  }

  const markerBody = marker[1] ?? "";
  const lines = markerBody.split(/\r?\n/).map((line) => line.trim());
  for (const line of lines) {
    if (!line) {
      continue;
    }
    const match = line.match(/^([A-Z])\s+(.+)$/);
    if (!match) {
      if (line.startsWith("at ") || line.startsWith(">")) {
        break;
      }
      continue;
    }
    const kind = normalizeFileChangeKind(match[1] ?? "");
    const path = (match[2] ?? "").trim();
    if (!path) {
      continue;
    }
    mergeInferredEntry(byPath, { path, kind: kind || undefined });
  }

  return Array.from(byPath.values()).filter((entry) => entry.path);
}

export function mergeToolChanges(
  remoteChanges?: NonNullable<Extract<ConversationItem, { kind: "tool" }>["changes"]>,
  localChanges?: NonNullable<Extract<ConversationItem, { kind: "tool" }>["changes"]>,
) {
  if (!remoteChanges || remoteChanges.length === 0) {
    return localChanges;
  }
  if (!localChanges || localChanges.length === 0) {
    return remoteChanges;
  }
  const localByPath = new Map<string, ToolChange>();
  localChanges.forEach((change) => {
    if (change.path && !localByPath.has(change.path)) {
      localByPath.set(change.path, change);
    }
  });
  const remotePaths = new Set<string>();
  const merged = remoteChanges.map((change) => {
    if (!change.path) {
      return change;
    }
    remotePaths.add(change.path);
    const local = localByPath.get(change.path);
    if (!local) {
      return change;
    }
    const diff = pickRicherDiff(change.diff, local.diff);
    const remoteKind = normalizeFileChangeKind(change.kind);
    const localKind = normalizeFileChangeKind(local.kind);
    const mergedKind = (() => {
      if (!remoteKind) {
        return localKind;
      }
      if (!localKind) {
        return remoteKind;
      }
      if (remoteKind === "modified" && localKind !== "modified") {
        return localKind;
      }
      if (
        remoteKind !== "add" &&
        remoteKind !== "delete" &&
        remoteKind !== "rename" &&
        remoteKind !== "modified"
      ) {
        return localKind;
      }
      return remoteKind;
    })();
    return {
      ...change,
      kind: mergedKind,
      diff,
    };
  });
  localChanges.forEach((change) => {
    if (!change.path || remotePaths.has(change.path)) {
      return;
    }
    merged.push(change);
  });
  return merged;
}

export function inferFileChangesFromPayload(value: unknown): FileChangeEntry[] {
  const byPath = new Map<string, FileChangeEntry>();
  const merge = (path: string, kind?: string, diff?: string) => {
    const normalizedPath = path.trim();
    if (!normalizedPath) {
      return;
    }
    const current = byPath.get(normalizedPath);
    const nextKind = normalizeFileChangeKind(kind);
    const nextDiff = asString(diff).trim();
    if (!current) {
      byPath.set(normalizedPath, {
        path: normalizedPath,
        kind: nextKind || undefined,
        diff: nextDiff || undefined,
      });
      return;
    }
    if (!current.kind && nextKind) {
      current.kind = nextKind;
    }
    if (!current.diff && nextDiff) {
      current.diff = nextDiff;
    }
  };

  const visit = (payload: unknown) => {
    if (payload === null || payload === undefined) {
      return;
    }
    if (typeof payload === "string") {
      for (const parsed of [
        ...parsePatchFileEntries(payload),
        ...parseStatusPathEntries(payload),
      ]) {
        merge(parsed.path, parsed.kind, parsed.diff);
      }
      return;
    }
    if (Array.isArray(payload)) {
      payload.forEach(visit);
      return;
    }
    const record = asRecord(payload);
    if (!record) {
      return;
    }
    const path = getFirstStringField(record, FILE_CHANGE_PATH_KEYS);
    if (path) {
      const kind = getFirstStringField(record, FILE_CHANGE_STATUS_KEYS);
      const diff =
        getFirstStringField(record, FILE_CHANGE_DIFF_KEYS) ||
        buildSyntheticDiffFromRecord(path, record);
      merge(path, kind || "modified", diff);
    }
    for (const listKey of FILE_CHANGE_LIST_KEYS) {
      const nested = record[listKey];
      if (Array.isArray(nested)) {
        nested.forEach(visit);
      }
    }
    for (const patchKey of FILE_CHANGE_PATCH_KEYS) {
      const patchValue = record[patchKey];
      if (typeof patchValue !== "string") {
        continue;
      }
      for (const parsed of parsePatchFileEntries(patchValue)) {
        merge(parsed.path, parsed.kind, parsed.diff);
      }
    }
  };

  visit(value);
  return Array.from(byPath.values());
}

function buildSyntheticDiffFromRecord(
  filePath: string,
  record: Record<string, unknown>,
): string | undefined {
  const oldString = typeof record.old_string === "string" ? record.old_string : "";
  const newStringCandidate =
    typeof record.new_string === "string"
      ? record.new_string
      : typeof record.content === "string"
        ? record.content
        : "";
  const hasStructuredEditPayload =
    typeof record.old_string === "string" ||
    typeof record.new_string === "string" ||
    typeof record.content === "string";
  if (!hasStructuredEditPayload) {
    return undefined;
  }
  return buildSyntheticUnifiedDiff(filePath, oldString, newStringCandidate);
}

function buildSyntheticUnifiedDiff(
  filePath: string,
  oldContent: string,
  newContent: string,
): string | undefined {
  const normalizedOldContent = normalizeDiffContent(oldContent);
  const normalizedNewContent = normalizeDiffContent(newContent);
  if (normalizedOldContent === normalizedNewContent) {
    return undefined;
  }
  const oldLines = splitDiffContentLines(normalizedOldContent);
  const newLines = splitDiffContentLines(normalizedNewContent);
  const diffResult = computeDiff(normalizedOldContent, normalizedNewContent);
  const diffLines = diffResult.lines.map((line) => {
    if (line.type === "added") {
      return `+${line.content}`;
    }
    if (line.type === "deleted") {
      return `-${line.content}`;
    }
    return ` ${line.content}`;
  });
  const oldHeader = oldLines.length === 0 ? "0,0" : `1,${oldLines.length}`;
  const newHeader = newLines.length === 0 ? "0,0" : `1,${newLines.length}`;
  return [
    `diff --git a/${filePath} b/${filePath}`,
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -${oldHeader} +${newHeader} @@`,
    ...diffLines,
  ].join("\n");
}

function normalizeDiffContent(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function splitDiffContentLines(value: string): string[] {
  if (!value) {
    return [];
  }
  return value.split("\n");
}
