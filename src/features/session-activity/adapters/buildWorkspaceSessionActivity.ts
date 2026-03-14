import type { ConversationItem, ThreadSummary } from "../../../types";
import {
  extractToolName,
  getFirstStringField,
  isBashTool,
  isReadTool,
  isSearchTool,
  isWebTool,
  parseToolArgs,
  resolveToolStatus,
} from "../../messages/components/toolBlocks/toolConstants";
import {
  extractCommandSummaries,
  summarizeFileChangeItem,
} from "../../operation-facts/operationFacts";
import {
  findPrimaryGitMarkerLine,
  parseLineMarkersFromDiff,
} from "../../files/utils/gitLineMarkers";
import { getThreadTimestamp } from "../../../utils/threadItems";
import type {
  SessionActivityEvent,
  SessionActivityEventStatus,
  SessionActivityRelationshipSource,
  SessionActivitySessionSummary,
  WorkspaceSessionActivityViewModel,
} from "../types";

type ThreadStatusSnapshot = {
  isProcessing?: boolean;
};

type BuildWorkspaceSessionActivityOptions = {
  activeThreadId: string | null;
  threads: ThreadSummary[];
  itemsByThread: Record<string, ConversationItem[]>;
  threadParentById: Record<string, string>;
  threadStatusById: Record<string, ThreadStatusSnapshot | undefined>;
};

const PARAGRAPH_BREAK_SPLIT_REGEX = /\n{2,}/;

function resolveEventStatus(
  status: string | undefined,
  hasOutput: boolean,
  threadIsProcessing: boolean,
): SessionActivityEventStatus {
  const resolved = resolveToolStatus(status, hasOutput);
  if (resolved === "failed") {
    return "failed";
  }
  if (resolved === "completed") {
    return "completed";
  }
  if (!threadIsProcessing) {
    return "completed";
  }
  return "running";
}

function resolveExploreEventStatus(
  status: "exploring" | "explored" | undefined,
  threadIsProcessing: boolean,
): SessionActivityEventStatus {
  if (status === "explored" || !threadIsProcessing) {
    return "completed";
  }
  return "running";
}

function sanitizeReasoningTitle(title: string) {
  return title
    .replace(/[`*_~]/g, "")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .trim();
}

function compactReasoningText(value: string) {
  return value.replace(/\s+/g, "");
}

function compactComparableReasoningText(value: string) {
  return compactReasoningText(value)
    .replace(/[！!]/g, "!")
    .replace(/[？?]/g, "?")
    .replace(/[，,]/g, ",")
    .replace(/[。．.]/g, ".");
}

function sliceByComparableLength(text: string, targetLength: number) {
  if (targetLength <= 0) {
    return text;
  }
  let compactLength = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (!/\s/.test(text[index])) {
      compactLength += 1;
    }
    if (compactLength >= targetLength) {
      return text.slice(index + 1);
    }
  }
  return "";
}

function stripLeadingReasoningTitleOverlap(content: string, candidates: string[]) {
  const trimmedContent = content.trim();
  if (!trimmedContent) {
    return trimmedContent;
  }
  const normalizedCandidates = candidates
    .map((entry) => entry.trim())
    .filter((entry) => entry.length >= 8);
  if (normalizedCandidates.length === 0) {
    return trimmedContent;
  }

  for (const candidate of normalizedCandidates) {
    if (trimmedContent.startsWith(candidate)) {
      return trimmedContent
        .slice(candidate.length)
        .replace(/^[\s，。！？!?:：;；、-]+/, "")
        .trim();
    }
  }

  const compactContent = compactComparableReasoningText(trimmedContent);
  for (const candidate of normalizedCandidates) {
    const compactCandidate = compactComparableReasoningText(candidate);
    if (!compactCandidate || compactCandidate.length < 8) {
      continue;
    }
    if (compactContent === compactCandidate) {
      return "";
    }
    if (compactContent.startsWith(compactCandidate)) {
      const sliced = sliceByComparableLength(trimmedContent, compactCandidate.length);
      return sliced.replace(/^[\s，。！？!?:：;；、-]+/, "").trim();
    }
  }

  return trimmedContent;
}

function splitComparableReasoningClauses(value: string) {
  return value
    .split(/[。！？!?；;\n]+/)
    .map((entry) => compactComparableReasoningText(entry.trim()))
    .filter((entry) => entry.length >= 6);
}

function hasSharedReasoningClauseSuffix(left: string, right: string) {
  const leftClauses = splitComparableReasoningClauses(left);
  const rightClauses = splitComparableReasoningClauses(right);
  if (leftClauses.length < 3 || rightClauses.length < 3) {
    return false;
  }
  const max = Math.min(leftClauses.length, rightClauses.length);
  let shared = 0;
  for (let offset = 1; offset <= max; offset += 1) {
    if (leftClauses[leftClauses.length - offset] !== rightClauses[rightClauses.length - offset]) {
      break;
    }
    shared += 1;
  }
  return shared >= 2;
}

function dedupeAdjacentReasoningParagraphs(value: string) {
  const collapseRepeatedParagraph = (paragraph: string) => {
    const trimmed = paragraph.trim();
    if (trimmed.length < 12) {
      return trimmed;
    }
    const directRepeat = trimmed.match(/^([\s\S]{6,}?)\s+\1$/);
    if (directRepeat?.[1]) {
      return directRepeat[1].trim();
    }
    const compact = compactReasoningText(trimmed);
    if (compact.length >= 12 && compact.length % 2 === 0) {
      const half = compact.slice(0, compact.length / 2);
      if (`${half}${half}` === compact) {
        let compactLength = 0;
        for (let index = 0; index < trimmed.length; index += 1) {
          if (!/\s/.test(trimmed[index])) {
            compactLength += 1;
          }
          if (compactLength >= half.length) {
            return trimmed.slice(0, index + 1).trim();
          }
        }
      }
    }
    const sentenceMatches = trimmed.match(/[^。！？!?]+[。！？!?]/g);
    if (sentenceMatches && sentenceMatches.length >= 4 && sentenceMatches.length % 2 === 0) {
      const mid = sentenceMatches.length / 2;
      const left = compactReasoningText(sentenceMatches.slice(0, mid).join(""));
      const right = compactReasoningText(sentenceMatches.slice(mid).join(""));
      if (left.length >= 6 && left === right) {
        return sentenceMatches.slice(0, mid).join("").trim();
      }
    }
    return trimmed;
  };

  const paragraphs = value
    .split(PARAGRAPH_BREAK_SPLIT_REGEX)
    .map((line) => collapseRepeatedParagraph(line))
    .filter(Boolean);
  if (paragraphs.length <= 1) {
    return paragraphs[0] ?? value.trim();
  }
  const deduped: string[] = [];
  for (const paragraph of paragraphs) {
    const previous = deduped[deduped.length - 1];
    if (
      previous &&
      compactReasoningText(previous) === compactReasoningText(paragraph) &&
      compactReasoningText(paragraph).length >= 8
    ) {
      continue;
    }
    deduped.push(paragraph);
  }
  return deduped.join("\n\n");
}

function scoreReasoningTextQuality(value: string) {
  const paragraphs = value
    .split(PARAGRAPH_BREAK_SPLIT_REGEX)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (paragraphs.length <= 1) {
    return 0;
  }
  const shortParagraphs = paragraphs.filter((entry) => entry.length <= 8).length;
  return shortParagraphs * 3 + paragraphs.length;
}

function chooseBetterReasoningText(left: string, right: string) {
  const leftScore = scoreReasoningTextQuality(left);
  const rightScore = scoreReasoningTextQuality(right);
  if (leftScore < rightScore) {
    return left;
  }
  if (rightScore < leftScore) {
    return right;
  }
  const leftLength = compactComparableReasoningText(left).length;
  const rightLength = compactComparableReasoningText(right).length;
  return rightLength >= leftLength ? right : left;
}

function isGenericReasoningTitle(title: string) {
  const normalized = title
    .trim()
    .toLowerCase()
    .replace(/[.:：。!！]+$/g, "");
  return (
    normalized === "reasoning" ||
    normalized === "thinking" ||
    normalized === "planning" ||
    normalized === "思考中" ||
    normalized === "正在思考" ||
    normalized === "正在规划"
  );
}

type ParsedReasoningMeta = {
  summaryTitle: string;
  bodyText: string;
  hasBody: boolean;
  workingLabel: string | null;
};

function parseReasoning(item: Extract<ConversationItem, { kind: "reasoning" }>): ParsedReasoningMeta {
  const summary = item.summary ?? "";
  const content = item.content ?? "";
  const hasSummary = summary.trim().length > 0 && !isGenericReasoningTitle(summary);
  const titleSource = hasSummary ? summary : content;
  const titleLines = titleSource.split("\n");
  const trimmedLines = titleLines.map((line) => line.trim());
  const titleLineIndex = trimmedLines.findIndex(Boolean);
  const rawTitle = titleLineIndex >= 0 ? trimmedLines[titleLineIndex] : "";
  const cleanTitle = sanitizeReasoningTitle(rawTitle);
  const summaryTitle = cleanTitle
    ? cleanTitle.length > 80
      ? `${cleanTitle.slice(0, 80)}…`
      : cleanTitle
    : "Reasoning";
  const summaryLines = summary.split("\n");
  const contentLines = content.split("\n");
  const summaryBody =
    hasSummary && titleLineIndex >= 0
      ? summaryLines
          .filter((_, index) => index !== titleLineIndex)
          .join("\n")
          .trim()
      : "";
  let contentBody = hasSummary
    ? content.trim()
    : titleLineIndex >= 0
      ? contentLines
          .filter((_, index) => index !== titleLineIndex)
          .join("\n")
          .trim()
      : content.trim();
  if (!hasSummary && !contentBody && content.trim()) {
    contentBody = content.trim();
  }
  const normalizedSummaryBody = summaryBody.trim();
  const normalizedContentBody = stripLeadingReasoningTitleOverlap(
    contentBody,
    [rawTitle, cleanTitle, normalizedSummaryBody],
  ).trim();
  const compactSummaryBody = compactReasoningText(normalizedSummaryBody);
  const compactContentBody = compactReasoningText(normalizedContentBody);
  let bodyParts: string[] = [];
  if (normalizedSummaryBody && normalizedContentBody) {
    if (compactSummaryBody === compactContentBody) {
      bodyParts = [normalizedContentBody];
    } else if (compactContentBody.startsWith(compactSummaryBody)) {
      bodyParts = [normalizedContentBody];
    } else if (compactSummaryBody.startsWith(compactContentBody)) {
      bodyParts = [normalizedSummaryBody];
    } else if (hasSharedReasoningClauseSuffix(normalizedSummaryBody, normalizedContentBody)) {
      bodyParts = [chooseBetterReasoningText(normalizedSummaryBody, normalizedContentBody)];
    } else {
      bodyParts = [normalizedSummaryBody, normalizedContentBody];
    }
  } else {
    bodyParts = [normalizedSummaryBody, normalizedContentBody].filter(Boolean);
  }
  const bodyText = dedupeAdjacentReasoningParagraphs(bodyParts.join("\n\n")).trim();
  const hasBody = bodyText.length > 0;
  const hasAnyText = titleSource.trim().length > 0;
  const workingLabel = hasAnyText ? summaryTitle : null;
  return {
    summaryTitle,
    bodyText,
    hasBody,
    workingLabel,
  };
}

function isReasoningDuplicate(previous: ParsedReasoningMeta, next: ParsedReasoningMeta) {
  const previousBody = compactComparableReasoningText(previous.bodyText || "");
  const nextBody = compactComparableReasoningText(next.bodyText || "");
  if (previousBody && nextBody) {
    if (previousBody === nextBody) {
      return true;
    }
    if (previousBody.length >= 16 && nextBody.includes(previousBody)) {
      return true;
    }
    if (nextBody.length >= 16 && previousBody.includes(nextBody)) {
      return true;
    }
    return false;
  }

  const previousTitle = compactComparableReasoningText(
    previous.summaryTitle || previous.workingLabel || "",
  );
  const nextTitle = compactComparableReasoningText(
    next.summaryTitle || next.workingLabel || "",
  );

  if (!previousBody && !nextBody) {
    if (
      previousTitle &&
      nextTitle &&
      previousTitle.length >= 8 &&
      nextTitle.length >= 8
    ) {
      return previousTitle === nextTitle;
    }
    return false;
  }

  if (
    previousTitle &&
    nextTitle &&
    previousTitle.length >= 6 &&
    nextTitle.length >= 6 &&
    previousTitle !== nextTitle
  ) {
    return false;
  }

  return false;
}

function dedupeAdjacentReasoningItems(
  list: ConversationItem[],
  reasoningMetaById: Map<string, ParsedReasoningMeta>,
  appendOnly = false,
) {
  const deduped: ConversationItem[] = [];
  for (const item of list) {
    const previous = deduped[deduped.length - 1];
    if (item.kind !== "reasoning" || previous?.kind !== "reasoning") {
      deduped.push(item);
      continue;
    }
    const previousMeta = reasoningMetaById.get(previous.id) ?? parseReasoning(previous);
    const nextMeta = reasoningMetaById.get(item.id) ?? parseReasoning(item);
    if (!isReasoningDuplicate(previousMeta, nextMeta)) {
      deduped.push(item);
      continue;
    }
    deduped[deduped.length - 1] = {
      ...item,
      summary: appendOnly
        ? appendReasoningRunText(previous.summary, item.summary)
        : chooseBetterReasoningText(previous.summary, item.summary),
      content: appendOnly
        ? appendReasoningRunText(previous.content, item.content)
        : chooseBetterReasoningText(previous.content, item.content),
    };
  }
  return deduped;
}

function collapseConsecutiveReasoningRuns(
  list: ConversationItem[],
  enabled: boolean,
  appendOnly = false,
) {
  if (!enabled || list.length <= 1) {
    return list;
  }
  const collapsed: ConversationItem[] = [];
  let index = 0;
  while (index < list.length) {
    const item = list[index];
    if (item.kind !== "reasoning") {
      collapsed.push(item);
      index += 1;
      continue;
    }

    let end = index + 1;
    while (end < list.length && list[end].kind === "reasoning") {
      end += 1;
    }

    if (end - index === 1) {
      collapsed.push(item);
      index = end;
      continue;
    }

    const run = list.slice(index, end) as Array<Extract<ConversationItem, { kind: "reasoning" }>>;
    const latest = run[run.length - 1];
    let mergedSummary = run[0].summary;
    let mergedContent = run[0].content;
    for (let runIndex = 1; runIndex < run.length; runIndex += 1) {
      const candidate = run[runIndex];
      mergedSummary = mergeReasoningRunText(
        mergedSummary,
        candidate.summary,
        appendOnly,
      );
      mergedContent = mergeReasoningRunText(
        mergedContent,
        candidate.content,
        appendOnly,
      );
    }
    collapsed.push({
      ...latest,
      summary: mergedSummary,
      content: mergedContent,
    });
    index = end;
  }
  return collapsed;
}

function appendReasoningRunText(existing: string, incoming: string) {
  if (!existing) {
    return incoming;
  }
  if (!incoming) {
    return existing;
  }
  const normalizedExisting = existing.trim();
  const normalizedIncoming = incoming.trim();
  const compactExisting = compactComparableReasoningText(normalizedExisting);
  const compactIncoming = compactComparableReasoningText(normalizedIncoming);
  if (!compactExisting) {
    return normalizedIncoming;
  }
  if (!compactIncoming) {
    return normalizedExisting;
  }
  if (compactExisting === compactIncoming) {
    return chooseBetterReasoningText(normalizedExisting, normalizedIncoming);
  }
  const maxOverlap = Math.min(compactExisting.length, compactIncoming.length);
  for (let overlapLength = maxOverlap; overlapLength > 0; overlapLength -= 1) {
    if (!compactExisting.endsWith(compactIncoming.slice(0, overlapLength))) {
      continue;
    }
    const suffix = sliceByComparableLength(normalizedIncoming, overlapLength).trimStart();
    return suffix ? `${normalizedExisting}${suffix}` : normalizedExisting;
  }
  return `${normalizedExisting}\n\n${normalizedIncoming}`;
}

function mergeReasoningRunText(
  existing: string,
  incoming: string,
  appendOnly = false,
) {
  if (appendOnly) {
    return appendReasoningRunText(existing, incoming);
  }
  if (!existing) {
    return incoming;
  }
  if (!incoming) {
    return existing;
  }
  const normalizedExisting = existing.trim();
  const normalizedIncoming = incoming.trim();
  const compactExisting = compactComparableReasoningText(normalizedExisting);
  const compactIncoming = compactComparableReasoningText(normalizedIncoming);
  if (!compactExisting) {
    return normalizedIncoming;
  }
  if (!compactIncoming) {
    return normalizedExisting;
  }
  if (compactExisting === compactIncoming) {
    return chooseBetterReasoningText(normalizedExisting, normalizedIncoming);
  }
  if (compactIncoming.includes(compactExisting)) {
    return normalizedIncoming;
  }
  if (compactExisting.includes(compactIncoming)) {
    return normalizedExisting;
  }
  return `${normalizedExisting}\n\n${normalizedIncoming}`;
}

function inferReasoningPresentationEngine(threadId: string) {
  if (threadId.startsWith("claude:") || threadId.startsWith("claude-pending-")) {
    return "claude";
  }
  if (threadId.startsWith("opencode:") || threadId.startsWith("opencode-pending-")) {
    return "opencode";
  }
  if (threadId.startsWith("gemini:") || threadId.startsWith("gemini-pending-")) {
    return "gemini";
  }
  return "codex";
}

function normalizeReasoningItemsForTimeline(threadId: string, items: ConversationItem[]) {
  const sourceReasoningMetaById = new Map<string, ParsedReasoningMeta>();
  const filtered = items.filter((item) => {
    if (item.kind !== "reasoning") {
      return true;
    }
    const parsed = parseReasoning(item);
    sourceReasoningMetaById.set(item.id, parsed);
    return parsed.hasBody || Boolean(parsed.workingLabel);
  });
  const engine = inferReasoningPresentationEngine(threadId);
  const appendReasoningRuns = engine === "claude";
  const deduped = dedupeAdjacentReasoningItems(
    filtered,
    sourceReasoningMetaById,
    appendReasoningRuns,
  );
  const collapseReasoningRuns = engine !== "codex" && engine !== "gemini";
  const normalized = collapseConsecutiveReasoningRuns(
    deduped,
    collapseReasoningRuns,
    appendReasoningRuns,
  );
  const reasoningMetaById = new Map<string, ParsedReasoningMeta>();
  normalized.forEach((item) => {
    if (item.kind !== "reasoning") {
      return;
    }
    reasoningMetaById.set(item.id, parseReasoning(item));
  });
  return {
    items: normalized,
    reasoningMetaById,
  };
}

function extractCommandOutputWindow(output: string | undefined) {
  if (!output) {
    return "";
  }
  const lines = output.split(/\r?\n/);
  if (lines.length === 0) {
    return "";
  }
  const tail = lines.slice(-80).join("\n").trim();
  if (!tail) {
    return "";
  }
  return tail.slice(-4_000);
}

function normalizeCommandValue(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

function extractCommandMetadata(item: Extract<ConversationItem, { kind: "tool" }>) {
  const detailArgs = parseToolArgs(item.detail);
  const inputArgs =
    detailArgs && typeof detailArgs.input === "object" && detailArgs.input
      ? (detailArgs.input as Record<string, unknown>)
      : null;
  const nestedArgs =
    detailArgs && typeof detailArgs.arguments === "object" && detailArgs.arguments
      ? (detailArgs.arguments as Record<string, unknown>)
      : null;
  const commandKeys = ["command", "cmd", "script", "shell_command", "bash", "argv"];
  const descriptionKeys = ["description", "summary", "label", "title", "task"];
  const cwdKeys = ["cwd", "workdir", "working_directory", "workingDirectory"];

  const command =
    normalizeCommandValue(
      detailArgs
        ? commandKeys.map((key) => detailArgs[key]).find((value) => normalizeCommandValue(value))
        : undefined,
    ) ||
    normalizeCommandValue(
      inputArgs
        ? commandKeys.map((key) => inputArgs[key]).find((value) => normalizeCommandValue(value))
        : undefined,
    ) ||
    normalizeCommandValue(
      nestedArgs
        ? commandKeys.map((key) => nestedArgs[key]).find((value) => normalizeCommandValue(value))
        : undefined,
    );

  const description =
    getFirstStringField(detailArgs, descriptionKeys) ||
    getFirstStringField(inputArgs, descriptionKeys) ||
    getFirstStringField(nestedArgs, descriptionKeys) ||
    "";

  const cwd =
    getFirstStringField(detailArgs, cwdKeys) ||
    getFirstStringField(inputArgs, cwdKeys) ||
    getFirstStringField(nestedArgs, cwdKeys) ||
    "";

  const fallbackSummary = extractCommandSummaries([item])[0]?.command || item.title || "Command";

  return {
    commandText: command || fallbackSummary,
    commandDescription: description,
    commandWorkingDirectory: cwd,
    summary: command || fallbackSummary,
  };
}

function summarizeTask(item: Extract<ConversationItem, { kind: "tool" }>) {
  const toolName = extractToolName(item.title).trim().toLowerCase();
  const args = parseToolArgs(item.detail);
  if (toolName === "task") {
    const description =
      getFirstStringField(args, ["description", "prompt", "query", "task"]) ||
      item.output?.split(/\r?\n/, 1)[0]?.trim() ||
      item.title.replace(/^Tool:\s*/i, "").trim() ||
      "Task";
    return `Task · ${description}`;
  }
  if (toolName === "todowrite" || toolName === "todo_write") {
    const todos = Array.isArray(args?.todos) ? args.todos : [];
    const completed = todos.filter((todo) => {
      if (!todo || typeof todo !== "object") {
        return false;
      }
      return (todo as { status?: string }).status === "completed";
    }).length;
    return `Task · Todo updated ${completed}/${todos.length}`;
  }
  if (item.toolType === "proposed-plan" || item.toolType === "plan-implementation") {
    const firstLine =
      item.output?.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() || "";
    return firstLine
      ? `Task · ${firstLine.slice(0, 80)}`
      : `Task · ${item.title}`;
  }
  return null;
}

function getFirstNonEmptyValue(
  source: Record<string, unknown> | null,
  keys: string[],
) {
  if (!source) {
    return "";
  }
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (Array.isArray(value)) {
      const parts = value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean);
      if (parts.length > 0) {
        return parts.join(", ");
      }
    }
  }
  return "";
}

function resolveReadableFilePath(candidate: string | undefined) {
  if (!candidate) {
    return null;
  }
  const normalized = candidate.trim();
  if (!normalized) {
    return null;
  }
  if (normalized === "." || normalized === "..") {
    return null;
  }
  if (normalized.includes("\n") || normalized.includes("\r") || normalized.includes("*")) {
    return null;
  }
  if (/^[a-z]+:\/\//i.test(normalized)) {
    return null;
  }
  return normalized;
}

function isLikelyFilePath(candidate: string) {
  const normalized = candidate.trim();
  if (!normalized) {
    return false;
  }
  if (
    normalized.includes("/") ||
    normalized.includes("\\") ||
    normalized.startsWith("./") ||
    normalized.startsWith("../") ||
    normalized.startsWith("~/") ||
    /^[A-Za-z]:[\\/]/.test(normalized)
  ) {
    return true;
  }
  return /\.[A-Za-z0-9]{1,16}$/.test(normalized) && !/\s/.test(normalized);
}

function resolveExploreReadPath(label: string, detail: string) {
  const detailPath = resolveReadableFilePath(detail);
  if (detailPath && isLikelyFilePath(detailPath)) {
    return detailPath;
  }
  const labelPath = resolveReadableFilePath(label);
  if (labelPath && isLikelyFilePath(labelPath)) {
    return labelPath;
  }
  return null;
}

function joinDirectoryAndFilePath(directory: string, filePath: string) {
  const normalizedDirectory = directory.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedFilePath = filePath.replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (!normalizedDirectory || !normalizedFilePath) {
    return "";
  }
  if (
    normalizedFilePath.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalizedFilePath)
  ) {
    return normalizedFilePath;
  }
  return `${normalizedDirectory}/${normalizedFilePath}`;
}

function extractDisplayFileName(pathValue: string) {
  const normalized = pathValue.trim();
  if (!normalized) {
    return "";
  }
  const withoutTrailingSlash = normalized.replace(/[\\/]+$/, "");
  if (!withoutTrailingSlash) {
    return normalized;
  }
  const segments = withoutTrailingSlash.split(/[\\/]/);
  return segments[segments.length - 1] || withoutTrailingSlash;
}

function extractPrimaryChangeDiff(
  item: Extract<ConversationItem, { kind: "tool" }>,
  filePath: string | undefined,
) {
  if (!filePath) {
    return "";
  }
  const directMatch = item.changes?.find((change) => change.path === filePath);
  return typeof directMatch?.diff === "string" ? directMatch.diff : "";
}

const INSPECTION_PATH_KEYS = [
  "filePath",
  "file_path",
  "filepath",
  "path",
  "paths",
  "file",
  "files",
  "filename",
  "target_file",
  "targetFile",
  "target_path",
  "targetPath",
  "target",
  "directory",
  "dir",
  "cwd",
  "workdir",
  "url",
  "query",
  "pattern",
];

function summarizeInspectionTool(item: Extract<ConversationItem, { kind: "tool" }>) {
  const toolName = extractToolName(item.title).trim().toLowerCase();
  if (!toolName || isBashTool(toolName)) {
    return null;
  }

  const args = parseToolArgs(item.detail);
  const inputArgs =
    args && typeof args.input === "object" && args.input
      ? (args.input as Record<string, unknown>)
      : null;
  const nestedArgs =
    args && typeof args.arguments === "object" && args.arguments
      ? (args.arguments as Record<string, unknown>)
      : null;
  const path =
    getFirstNonEmptyValue(args, INSPECTION_PATH_KEYS) ||
    getFirstNonEmptyValue(inputArgs, INSPECTION_PATH_KEYS) ||
    getFirstNonEmptyValue(nestedArgs, INSPECTION_PATH_KEYS);
  const workingDirectory =
    getFirstNonEmptyValue(args, ["cwd", "workdir", "working_directory", "workingDirectory", "directory", "dir"]) ||
    getFirstNonEmptyValue(inputArgs, ["cwd", "workdir", "working_directory", "workingDirectory", "directory", "dir"]) ||
    getFirstNonEmptyValue(nestedArgs, ["cwd", "workdir", "working_directory", "workingDirectory", "directory", "dir"]);
  const toolLabel = toolName.replace(/^mcp__[^_]+__/, "").replace(/_/g, " ");

  if (isReadTool(toolName)) {
    const resolvedPath = resolveReadableFilePath(path);
    const resolvedWorkingDirectory = resolveReadableFilePath(workingDirectory);
    const combinedPath =
      resolvedPath &&
      resolvedWorkingDirectory &&
      !resolvedPath.startsWith("/") &&
      !/^[A-Za-z]:[\\/]/.test(resolvedPath)
        ? resolveReadableFilePath(joinDirectoryAndFilePath(resolvedWorkingDirectory, resolvedPath))
        : null;
    const finalPath = combinedPath || resolvedPath;
    const summaryTarget = finalPath || path || toolLabel || "file";
    const displayName = extractDisplayFileName(summaryTarget);
    return {
      summary: `Read · ${displayName || summaryTarget}`,
      jumpTarget: finalPath
        ? ({ type: "file", path: finalPath } as const)
        : undefined,
    };
  }
  if (isSearchTool(toolName)) {
    return { summary: `Search · ${path || toolLabel || "workspace"}` };
  }
  if (isWebTool(toolName)) {
    return { summary: `Web · ${path || toolLabel || "request"}` };
  }
  if (toolName === "skill_mcp" || toolName === "skill") {
    const nestedToolName = getFirstNonEmptyValue(args, ["tool_name", "toolName", "name"]);
    return { summary: `Skill · ${nestedToolName || path || "tool call"}` };
  }
  if (item.toolType === "mcpToolCall") {
    return { summary: `Tool · ${path || toolLabel || "activity"}` };
  }
  return null;
}

function parseFallbackLink(detail: string, fallbackParentId: string) {
  const trimmed = detail.trim();
  if (!trimmed.includes("→")) {
    return null;
  }
  const [leftSide, rightSide] = trimmed.split("→", 2).map((part) => part.trim());
  const parentMatch = leftSide.match(/^From\s+(.+)$/i);
  const parentId = parentMatch?.[1]?.trim() || fallbackParentId;
  const receivers = rightSide
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!parentId || receivers.length === 0) {
    return null;
  }
  return { parentId, receivers };
}

function buildFallbackParentById(
  threads: ThreadSummary[],
  itemsByThread: Record<string, ConversationItem[]>,
) {
  const fallbackParentById: Record<string, string> = {};
  for (const thread of threads) {
    const items = itemsByThread[thread.id] ?? [];
    for (const item of items) {
      if (item.kind !== "tool" || item.toolType !== "collabToolCall") {
        continue;
      }
      const parsed = parseFallbackLink(item.detail, thread.id);
      if (!parsed) {
        continue;
      }
      for (const receiverId of parsed.receivers) {
        if (!fallbackParentById[receiverId]) {
          fallbackParentById[receiverId] = parsed.parentId;
        }
      }
    }
  }
  return fallbackParentById;
}

function resolveRootThreadId(
  activeThreadId: string,
  threadParentById: Record<string, string>,
  fallbackParentById: Record<string, string>,
) {
  const visited = new Set<string>();
  let current = activeThreadId;
  while (current && !visited.has(current)) {
    visited.add(current);
    const nextParent = threadParentById[current] ?? fallbackParentById[current];
    if (!nextParent) {
      return current;
    }
    current = nextParent;
  }
  return activeThreadId;
}

function isDescendantOfRoot(
  threadId: string,
  rootThreadId: string,
  threadParentById: Record<string, string>,
  fallbackParentById: Record<string, string>,
) {
  if (threadId === rootThreadId) {
    return true;
  }
  const visited = new Set<string>();
  let current: string | undefined = threadId;
  while (current && !visited.has(current)) {
    visited.add(current);
    const nextParent: string | undefined =
      threadParentById[current] ?? fallbackParentById[current];
    if (!nextParent) {
      return false;
    }
    if (nextParent === rootThreadId) {
      return true;
    }
    current = nextParent;
  }
  return false;
}

function resolveRelationshipSource(
  threadId: string,
  rootThreadId: string,
  threadParentById: Record<string, string>,
  fallbackParentById: Record<string, string>,
): SessionActivityRelationshipSource {
  if (threadId === rootThreadId) {
    return "directParent";
  }
  if (threadParentById[threadId]) {
    return "directParent";
  }
  if (fallbackParentById[threadId]) {
    return "fallbackLinking";
  }
  return "directParent";
}

function buildThreadEvents(args: {
  thread: ThreadSummary;
  rootThreadId: string;
  items: ConversationItem[];
  relationshipSource: SessionActivityRelationshipSource;
  threadIsProcessing: boolean;
}) {
  const events: SessionActivityEvent[] = [];
  const occurredBase = getThreadTimestamp(args.thread) || 0;
  const shouldMergeClaudeReasoningIntoFirstNode =
    inferReasoningPresentationEngine(args.thread.id) === "claude";
  const reasoningAnchorIndexByTurnId = new Map<string, number>();
  const { items: normalizedItems, reasoningMetaById } = normalizeReasoningItemsForTimeline(
    args.thread.id,
    args.items,
  );
  const fallbackThreadOccurredAt = occurredBase > 0 ? occurredBase : Date.now();
  const resolveFallbackOccurredAt = (itemIndex: number) => {
    const reverseIndex = normalizedItems.length - 1 - itemIndex;
    const safeReverseIndex = reverseIndex > 0 ? reverseIndex : 0;
    // Keep one-second spacing so HH:mm:ss labels remain distinct per node.
    return fallbackThreadOccurredAt - safeReverseIndex * 1000;
  };
  let latestUserMessageIndex = -1;
  normalizedItems.forEach((item, index) => {
    if (item.kind === "message" && item.role === "user") {
      latestUserMessageIndex = index;
    }
  });
  let currentTurnIndex = 0;
  let currentTurnToken = "bootstrap";
  normalizedItems.forEach((item, index) => {
    if (item.kind === "message" && item.role === "user") {
      currentTurnIndex += 1;
      currentTurnToken = item.id || `turn-${currentTurnIndex}`;
      return;
    }
    const sessionRole = args.thread.id === args.rootThreadId ? "root" : "child";
    const threadName = args.thread.name || args.thread.id;
    const occurredAtBase = resolveFallbackOccurredAt(index);
    const turnIndex = currentTurnIndex > 0 ? currentTurnIndex : 1;
    const turnId = `${args.thread.id}:turn:${currentTurnToken}`;

    if (item.kind === "reasoning") {
      const parsed = reasoningMetaById.get(item.id) ?? parseReasoning(item);
      const summary =
        parsed.workingLabel || item.summary.trim() || item.content.trim() || "Thinking";
      const reasoningPreview =
        parsed.bodyText || item.content.trim() || item.summary.trim() || "Thinking";
      const belongsToLatestTurn =
        latestUserMessageIndex >= 0 ? index > latestUserMessageIndex : true;
      const reasoningStatus =
        args.threadIsProcessing && belongsToLatestTurn ? "running" : "completed";
      if (shouldMergeClaudeReasoningIntoFirstNode) {
        const anchorIndex = reasoningAnchorIndexByTurnId.get(turnId);
        if (anchorIndex !== undefined) {
          const anchorEvent = events[anchorIndex];
          if (anchorEvent?.kind === "reasoning") {
            events[anchorIndex] = {
              ...anchorEvent,
              occurredAt: Math.max(anchorEvent.occurredAt, occurredAtBase),
              status:
                anchorEvent.status === "running" || reasoningStatus === "running"
                  ? "running"
                  : "completed",
              reasoningPreview: appendReasoningRunText(
                anchorEvent.reasoningPreview ?? "",
                reasoningPreview,
              ),
            };
            return;
          }
        }
      }
      const nextReasoningEvent: SessionActivityEvent = {
        eventId: `reasoning:${item.id}`,
        threadId: args.thread.id,
        threadName,
        turnId,
        turnIndex,
        sessionRole,
        relationshipSource: args.relationshipSource,
        kind: "reasoning",
        occurredAt: occurredAtBase,
        summary: `Thinking · ${summary}`,
        status: reasoningStatus,
        jumpTarget: { type: "thread", threadId: args.thread.id },
        reasoningPreview,
      };
      events.push(nextReasoningEvent);
      if (shouldMergeClaudeReasoningIntoFirstNode) {
        reasoningAnchorIndexByTurnId.set(turnId, events.length - 1);
      }
      return;
    }

    if (item.kind === "explore") {
      const entries = Array.isArray(item.entries) ? item.entries : [];
      const eventStatus = resolveExploreEventStatus(item.status, args.threadIsProcessing);
      entries.forEach((entry, entryIndex) => {
        const label = entry.label.trim();
        const detail = (entry.detail ?? "").trim();
        const occurredAt =
          occurredAtBase +
          Math.floor(((entryIndex + 1) * 900) / (entries.length + 1));
        if (entry.kind === "run") {
          events.push({
            eventId: `explore:run:${item.id}:${entryIndex}`,
            threadId: args.thread.id,
            threadName,
            turnId,
            turnIndex,
            sessionRole,
            relationshipSource: args.relationshipSource,
            kind: "explore",
            occurredAt,
            summary: label || "Command",
            status: eventStatus,
            commandText: label || "Command",
            commandDescription: detail || undefined,
            explorePreview: detail || undefined,
          });
          return;
        }
        const summaryPrefix =
          entry.kind === "read"
            ? "Read"
            : entry.kind === "search"
              ? "Search"
              : "List";
        const displayLabel =
          entry.kind === "read"
            ? (() => {
                const candidate = resolveExploreReadPath(label, detail);
                if (!candidate) {
                  return label || detail || "workspace";
                }
                return extractDisplayFileName(candidate) || candidate;
              })()
            : label || detail || "workspace";
        events.push({
          eventId: `explore:${entry.kind}:${item.id}:${entryIndex}`,
          threadId: args.thread.id,
          threadName,
          turnId,
          turnIndex,
          sessionRole,
          relationshipSource: args.relationshipSource,
          kind: "explore",
          occurredAt,
          summary: `${summaryPrefix} · ${displayLabel}`,
          status: eventStatus,
          explorePreview: detail || undefined,
          jumpTarget:
            entry.kind === "read"
              ? (() => {
                  const resolvedPath = resolveExploreReadPath(label, detail);
                  return resolvedPath
                    ? ({ type: "file", path: resolvedPath } as const)
                    : ({ type: "thread", threadId: args.thread.id } as const);
                })()
              : { type: "thread", threadId: args.thread.id },
        });
      });
      return;
    }

    if (item.kind !== "tool") {
      return;
    }
    const lowerToolName = extractToolName(item.title).trim().toLowerCase();
    const hasOutput = Boolean(item.output) || Boolean(item.changes?.length);
    const eventStatus = resolveEventStatus(item.status, hasOutput, args.threadIsProcessing);
    const occurredAt = occurredAtBase;

    if (item.toolType === "commandExecution" || isBashTool(lowerToolName)) {
      const commandMeta = extractCommandMetadata(item);
      events.push({
        eventId: `command:${item.id}`,
        threadId: args.thread.id,
        threadName,
        turnId,
        turnIndex,
        sessionRole,
        relationshipSource: args.relationshipSource,
        kind: "command",
        occurredAt,
        summary: commandMeta.summary || "Command",
        status: eventStatus,
        commandText: commandMeta.commandText,
        commandDescription: commandMeta.commandDescription || undefined,
        commandWorkingDirectory: commandMeta.commandWorkingDirectory || undefined,
        commandPreview: extractCommandOutputWindow(item.output),
      });
      return;
    }

    const taskSummary = summarizeTask(item);
    if (taskSummary) {
      events.push({
        eventId: `task:${item.id}`,
        threadId: args.thread.id,
        threadName,
        turnId,
        turnIndex,
        sessionRole,
        relationshipSource: args.relationshipSource,
        kind: "task",
        occurredAt,
        summary: taskSummary,
        status: eventStatus,
        jumpTarget: { type: "thread", threadId: args.thread.id },
      });
      return;
    }

    const inspectionSummary = summarizeInspectionTool(item);
    if (inspectionSummary) {
      events.push({
        eventId: `task:${item.id}`,
        threadId: args.thread.id,
        threadName,
        turnId,
        turnIndex,
        sessionRole,
        relationshipSource: args.relationshipSource,
        kind: "task",
        occurredAt,
        summary: inspectionSummary.summary,
        status: eventStatus,
        jumpTarget: inspectionSummary.jumpTarget ?? { type: "thread", threadId: args.thread.id },
      });
      return;
    }

    const fileChangeSummary = summarizeFileChangeItem(item);
    if (fileChangeSummary) {
      const primaryDiff = extractPrimaryChangeDiff(item, fileChangeSummary.filePath);
      const markers = parseLineMarkersFromDiff(primaryDiff);
      const primaryLine = findPrimaryGitMarkerLine(markers) ?? undefined;
      events.push({
        eventId: `file:${item.id}`,
        threadId: args.thread.id,
        threadName,
        turnId,
        turnIndex,
        sessionRole,
        relationshipSource: args.relationshipSource,
        kind: "fileChange",
        occurredAt,
        summary: fileChangeSummary.summary,
        status: eventStatus,
        jumpTarget: fileChangeSummary.filePath
          ? {
              type: "file",
              path: fileChangeSummary.filePath,
              line: primaryLine,
              markers,
            }
          : undefined,
        filePath: fileChangeSummary.filePath,
        fileCount: fileChangeSummary.fileCount,
        additions: fileChangeSummary.additions,
        deletions: fileChangeSummary.deletions,
      });
    }
  });
  return events;
}

export function buildWorkspaceSessionActivity({
  activeThreadId,
  threads,
  itemsByThread,
  threadParentById,
  threadStatusById,
}: BuildWorkspaceSessionActivityOptions): WorkspaceSessionActivityViewModel {
  if (!activeThreadId) {
    return {
      rootThreadId: null,
      rootThreadName: null,
      relevantThreadIds: [],
      timeline: [],
      sessionSummaries: [],
      isProcessing: false,
      emptyState: "idle",
    };
  }

  const threadMap = new Map(threads.map((thread) => [thread.id, thread]));
  const fallbackParentById = buildFallbackParentById(threads, itemsByThread);
  const rootThreadId = resolveRootThreadId(
    activeThreadId,
    threadParentById,
    fallbackParentById,
  );
  const relevantThreads = threads.filter((thread) =>
    isDescendantOfRoot(thread.id, rootThreadId, threadParentById, fallbackParentById),
  );

  if (!threadMap.has(activeThreadId)) {
    const fallbackThread: ThreadSummary = {
      id: activeThreadId,
      name: activeThreadId,
      updatedAt: 0,
    };
    threadMap.set(activeThreadId, fallbackThread);
    if (isDescendantOfRoot(activeThreadId, rootThreadId, threadParentById, fallbackParentById)) {
      relevantThreads.push(fallbackThread);
    }
  }

  const uniqueRelevantThreads = Array.from(
    new Map(relevantThreads.map((thread) => [thread.id, thread])).values(),
  );

  const timeline = uniqueRelevantThreads
    .flatMap((thread) =>
      buildThreadEvents({
        thread,
        rootThreadId,
        items: itemsByThread[thread.id] ?? [],
        relationshipSource: resolveRelationshipSource(
          thread.id,
          rootThreadId,
          threadParentById,
          fallbackParentById,
        ),
        threadIsProcessing: Boolean(threadStatusById[thread.id]?.isProcessing),
      }),
    )
    .sort((left, right) => right.occurredAt - left.occurredAt);

  const sessionSummaries: SessionActivitySessionSummary[] = uniqueRelevantThreads
    .map((thread) => {
      const relationshipSource = resolveRelationshipSource(
        thread.id,
        rootThreadId,
        threadParentById,
        fallbackParentById,
      );
      const sessionRole: SessionActivitySessionSummary["sessionRole"] =
        thread.id === rootThreadId ? "root" : "child";
      return {
        threadId: thread.id,
        threadName: thread.name || thread.id,
        sessionRole,
        relationshipSource,
        eventCount: timeline.filter((event) => event.threadId === thread.id).length,
        isProcessing: Boolean(threadStatusById[thread.id]?.isProcessing),
      };
    })
    .sort((left, right) => {
      if (left.sessionRole !== right.sessionRole) {
        return left.sessionRole === "root" ? -1 : 1;
      }
      return right.eventCount - left.eventCount;
    });

  const rootThread = threadMap.get(rootThreadId) ?? null;
  const isProcessing = uniqueRelevantThreads.some((thread) =>
    Boolean(threadStatusById[thread.id]?.isProcessing),
  );
  const emptyState =
    timeline.length > 0 ? (isProcessing ? "running" : "completed") : isProcessing ? "running" : "idle";

  return {
    rootThreadId,
    rootThreadName: rootThread?.name ?? rootThreadId,
    relevantThreadIds: uniqueRelevantThreads.map((thread) => thread.id),
    timeline,
    sessionSummaries,
    isProcessing,
    emptyState,
  };
}
