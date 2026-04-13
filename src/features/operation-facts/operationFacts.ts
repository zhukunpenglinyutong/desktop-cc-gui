import type { ConversationItem } from "../../types";
import {
  buildCommandSummary,
  extractToolName,
  getFileName,
  getFirstStringField,
  isBashTool,
  parseToolArgs,
  resolveToolStatus,
} from "../messages/components/toolBlocks/toolConstants";

export type OperationCommandSummary = {
  id: string;
  command: string;
  status: "running" | "completed" | "error";
};

export type OperationFileChangeSummary = {
  filePath: string;
  fileName: string;
  status: "A" | "D" | "R" | "M";
  additions: number;
  deletions: number;
  diff?: string;
};

export type OperationFileChangeEventSummary = {
  summary: string;
  filePath?: string;
  fileCount: number;
  additions: number;
  deletions: number;
  statusLetter?: "A" | "D" | "R" | "M";
};

const FILE_CHANGE_TOOL_HINTS = ["replace", "edit", "write", "patch", "apply"];
const FILE_CHANGE_PATH_KEYS = [
  "file_path",
  "filePath",
  "filepath",
  "path",
  "target_file",
  "targetFile",
  "filename",
  "file",
];

export function extractCommandSummaries(
  items: ConversationItem[],
  options: { isCodexEngine?: boolean } = {},
): OperationCommandSummary[] {
  const { isCodexEngine = false } = options;
  const result: OperationCommandSummary[] = [];
  for (const item of items) {
    if (item.kind !== "tool") {
      continue;
    }
    const toolName = extractToolName(item.title);
    if (item.toolType !== "commandExecution" && !isBashTool(toolName)) {
      continue;
    }
    const summaryCommand = buildCommandSummary(item, { includeDetail: false });
    const command = isCodexEngine
      ? summaryCommand
      : summaryCommand || item.detail.trim();
    const resolved = resolveToolStatus(item.status, Boolean(item.output));
    result.push({
      id: item.id,
      command,
      status:
        resolved === "failed"
          ? "error"
          : resolved === "completed"
            ? "completed"
            : "running",
    });
  }
  return result;
}

export function extractFileChangeSummaries(items: ConversationItem[]): OperationFileChangeSummary[] {
  const seen = new Map<string, OperationFileChangeSummary>();
  for (const item of items) {
    if (item.kind !== "tool") {
      continue;
    }
    const changes = item.changes;
    if (!changes || changes.length === 0) {
      continue;
    }
    const parsedArgs = parseToolArgs(item.detail);
    const inputArgs = asRecord(parsedArgs?.input);
    const nestedArgs = asRecord(parsedArgs?.arguments);
    const candidateArgs = [parsedArgs, inputArgs, nestedArgs].filter(
      (entry): entry is Record<string, unknown> => Boolean(entry),
    );
    for (const change of changes) {
      const filePath = change.path;
      if (!filePath) {
        continue;
      }
      const fileName = getFileName(filePath);
      const directStats = collectDiffStats(change.diff);
      const fallbackStats =
        directStats.additions === 0 &&
        directStats.deletions === 0 &&
        changes.length === 1
          ? collectSingleChangeFallbackStats(candidateArgs, filePath, item.output)
          : { additions: 0, deletions: 0 };
      const additions =
        directStats.additions === 0 && directStats.deletions === 0
          ? fallbackStats.additions
          : directStats.additions;
      const deletions =
        directStats.additions === 0 && directStats.deletions === 0
          ? fallbackStats.deletions
          : directStats.deletions;
      const status = normalizeFileStatus(change.kind);
      const existing = seen.get(filePath);
      if (!existing) {
        seen.set(filePath, {
          filePath,
          fileName,
          status,
          additions,
          deletions,
          diff: change.diff?.trim() || undefined,
        });
        continue;
      }
      existing.additions += additions;
      existing.deletions += deletions;
      if (status === "A") {
        existing.status = "A";
      }
      existing.diff = pickPreferredDiff(existing.diff, change.diff);
    }
  }
  return Array.from(seen.values());
}

function pickPreferredDiff(primary?: string, secondary?: string): string | undefined {
  const left = primary?.trim() ?? "";
  const right = secondary?.trim() ?? "";
  if (!left) {
    return right || undefined;
  }
  if (!right) {
    return left;
  }
  const leftStats = collectDiffStats(left);
  const rightStats = collectDiffStats(right);
  const leftChurn = leftStats.additions + leftStats.deletions;
  const rightChurn = rightStats.additions + rightStats.deletions;
  if (rightChurn > leftChurn) {
    return right;
  }
  if (leftChurn > rightChurn) {
    return left;
  }
  return right.length > left.length ? right : left;
}

export function summarizeFileChangeItem(
  item: Extract<ConversationItem, { kind: "tool" }>,
): OperationFileChangeEventSummary | null {
  const changes = item.changes ?? [];
  const parsedArgs = parseToolArgs(item.detail);
  const inputArgs = asRecord(parsedArgs?.input);
  const nestedArgs = asRecord(parsedArgs?.arguments);
  const candidateArgs = [parsedArgs, inputArgs, nestedArgs].filter(
    (entry): entry is Record<string, unknown> => Boolean(entry),
  );
  const titlePathHint = extractLikelyPathFromTitle(item.title);
  const hasFileChangeArgHints = candidateArgs.some(isLikelyFileChangeArgs);
  const hasToolHint = isLikelyFileChangeTool(item.title);
  const shouldTreatAsFileChange =
    item.toolType === "fileChange" ||
    changes.length > 0 ||
    (hasToolHint && (hasFileChangeArgHints || Boolean(titlePathHint)));
  if (!shouldTreatAsFileChange) {
    return null;
  }

  const primaryPath =
    changes[0]?.path ||
    getFirstStringFieldFromSources(candidateArgs, FILE_CHANGE_PATH_KEYS) ||
    titlePathHint ||
    "";
  const fileName = getFileName(primaryPath) || primaryPath || "Pending changes";
  let additions = 0;
  let deletions = 0;
  if (changes.length > 0) {
    for (const change of changes) {
      const stats = collectDiffStats(change.diff);
      additions += stats.additions;
      deletions += stats.deletions;
    }
    if (additions === 0 && deletions === 0) {
      const fallback = collectSingleChangeFallbackStats(
        candidateArgs,
        changes.length === 1 ? primaryPath : "",
        item.output,
      );
      additions = fallback.additions;
      deletions = fallback.deletions;
    }
  } else {
    for (const args of candidateArgs) {
      const stats = collectDiffStatsFromArgs(args);
      additions += stats.additions;
      deletions += stats.deletions;
      if (additions > 0 || deletions > 0) {
        break;
      }
    }
    if (additions === 0 && deletions === 0) {
      const fallback = collectDiffStats(item.output);
      additions = fallback.additions;
      deletions = fallback.deletions;
    }
  }
  const extraCount = Math.max(0, changes.length - 1);
  const summaryBase = extraCount > 0 ? `${fileName} +${extraCount}` : fileName;
  return {
    summary: `File change · ${summaryBase}`,
    filePath: primaryPath || undefined,
    fileCount: Math.max(changes.length, 1),
    additions,
    deletions,
    statusLetter: normalizeFileStatus(changes[0]?.kind),
  };
}

function isLikelyFileChangeTool(title: string): boolean {
  const toolName = extractToolName(title).trim().toLowerCase();
  if (!toolName || isBashTool(toolName)) {
    return false;
  }
  if (toolName === "todowrite" || toolName === "todo_write") {
    return false;
  }
  return FILE_CHANGE_TOOL_HINTS.some((hint) => toolName.includes(hint));
}

function isLikelyFileChangeArgs(args: Record<string, unknown>) {
  const path = getFirstStringFieldCaseInsensitive(args, FILE_CHANGE_PATH_KEYS);
  if (path) {
    return true;
  }
  if (getFirstStringFieldCaseInsensitive(args, ["old_string", "oldString"])) {
    return true;
  }
  if (getFirstStringFieldCaseInsensitive(args, ["new_string", "newString"])) {
    return true;
  }
  if (getFirstStringFieldCaseInsensitive(args, ["content", "new_content", "newContent"])) {
    return true;
  }
  return false;
}

function getFirstStringFieldFromSources(
  sources: Record<string, unknown>[],
  keys: string[],
): string {
  for (const source of sources) {
    const direct = getFirstStringField(source, keys);
    if (direct) {
      return direct;
    }
    const ci = getFirstStringFieldCaseInsensitive(source, keys);
    if (ci) {
      return ci;
    }
  }
  return "";
}

function getFirstStringFieldCaseInsensitive(
  source: Record<string, unknown>,
  keys: string[],
): string {
  const lowered = new Map<string, unknown>();
  for (const [key, value] of Object.entries(source)) {
    lowered.set(key.toLowerCase(), value);
  }
  for (const key of keys) {
    const value = lowered.get(key.toLowerCase());
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function extractLikelyPathFromTitle(title: string): string {
  const normalized = title.replace(/^(?:Tool|Command):\s*/i, "").trim();
  if (!normalized) {
    return "";
  }
  const tail = normalized.includes("/") ? normalized.split("/").pop() ?? normalized : normalized;
  const tokens = tail
    .split(/\s+/)
    .map((token) => token.replace(/^[('"`]+|[)'",;:.!?`]+$/g, "").trim())
    .filter(Boolean);
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index];
    if (!token) {
      continue;
    }
    if (
      token.includes("/") ||
      token.includes("\\") ||
      token.startsWith("./") ||
      token.startsWith("../") ||
      /^[A-Za-z]:[\\/]/.test(token) ||
      /\.[A-Za-z0-9]{1,8}$/.test(token)
    ) {
      return token;
    }
  }
  return "";
}

function normalizeFileStatus(kind?: string): "A" | "D" | "R" | "M" {
  const normalized = (kind ?? "").toLowerCase();
  if (
    normalized.includes("add") ||
    normalized.includes("create") ||
    normalized.includes("new")
  ) {
    return "A";
  }
  if (normalized.includes("delete") || normalized.includes("remove")) {
    return "D";
  }
  if (normalized.includes("rename") || normalized.includes("move")) {
    return "R";
  }
  return "M";
}

function collectDiffStats(diff?: string) {
  if (!diff) {
    return { additions: 0, deletions: 0 };
  }
  let additions = 0;
  let deletions = 0;
  const lines = diff.split("\n");
  for (const line of lines) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      additions += 1;
    }
    if (line.startsWith("-") && !line.startsWith("---")) {
      deletions += 1;
    }
  }
  return { additions, deletions };
}

function collectSingleChangeFallbackStats(
  candidateArgs: Record<string, unknown>[],
  expectedPath: string,
  output?: string,
) {
  for (const args of candidateArgs) {
    const pathHint =
      getFirstStringField(args, FILE_CHANGE_PATH_KEYS) ||
      getFirstStringFieldCaseInsensitive(args, FILE_CHANGE_PATH_KEYS);
    if (pathHint && expectedPath && !pathHintMatches(pathHint, expectedPath)) {
      continue;
    }
    const stats = collectDiffStatsFromArgs(args);
    if (stats.additions > 0 || stats.deletions > 0) {
      return stats;
    }
  }
  return collectDiffStats(output);
}

function collectDiffStatsFromArgs(args: Record<string, unknown>) {
  const oldString = getFirstStringFieldCaseInsensitive(args, ["old_string", "oldString"]);
  const newString = getFirstStringFieldCaseInsensitive(args, ["new_string", "newString"]);
  if (oldString || newString) {
    return computeLineDelta(oldString, newString);
  }
  const content = getFirstStringFieldCaseInsensitive(args, [
    "content",
    "new_content",
    "newContent",
  ]);
  if (content) {
    return { additions: content.split("\n").length, deletions: 0 };
  }
  const diff = getFirstStringFieldCaseInsensitive(args, ["diff", "patch", "unified_diff"]);
  if (diff) {
    return collectDiffStats(diff);
  }
  return { additions: 0, deletions: 0 };
}

function computeLineDelta(oldString: string, newString: string) {
  const oldCount = countContentLines(oldString);
  const newCount = countContentLines(newString);
  if (oldCount === 0 && newCount === 0) {
    return { additions: 0, deletions: 0 };
  }
  if (oldCount === 0) {
    return { additions: newCount, deletions: 0 };
  }
  if (newCount === 0) {
    return { additions: 0, deletions: oldCount };
  }
  if (oldString !== newString && oldCount === newCount) {
    return { additions: 1, deletions: 1 };
  }
  const diff = newCount - oldCount;
  if (diff >= 0) {
    return { additions: diff || 1, deletions: 0 };
  }
  return { additions: 0, deletions: -diff };
}

function countContentLines(value: string): number {
  if (!value) {
    return 0;
  }
  return value.split("\n").length;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").trim();
}

function pathHintMatches(pathHint: string, targetPath: string): boolean {
  const normalizedHint = normalizePath(pathHint);
  const normalizedTarget = normalizePath(targetPath);
  if (!normalizedHint || !normalizedTarget) {
    return true;
  }
  return (
    normalizedHint === normalizedTarget ||
    normalizedHint.endsWith(`/${normalizedTarget}`) ||
    normalizedTarget.endsWith(`/${normalizedHint}`)
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}
