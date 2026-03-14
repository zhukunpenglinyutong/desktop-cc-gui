import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState, isValidElement, type ReactNode, type MouseEvent } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { useTranslation } from "react-i18next";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { openUrl } from "@tauri-apps/plugin-opener";

const MermaidBlock = lazy(() => import("./MermaidBlock"));
import {
  decodeFileLink,
  isFileLinkUrl,
  isLinkableFilePath,
  remarkFileLinks,
  toFileLink,
} from "../../../utils/remarkFileLinks";
import { highlightLine } from "../../../utils/syntax";
import { detectCodexLeadMarker, type CodexLeadMarkerConfig } from "../constants/codexLeadMarkers";

type MarkdownProps = {
  value: string;
  className?: string;
  codeBlock?: boolean;
  codeBlockStyle?: "default" | "message";
  codeBlockCopyUseModifier?: boolean;
  streamingThrottleMs?: number;
  softBreaks?: boolean;
  codexLeadMarkerConfig?: CodexLeadMarkerConfig;
  onOpenFileLink?: (path: string) => void;
  onOpenFileLinkMenu?: (event: React.MouseEvent, path: string) => void;
};

type CodeBlockProps = {
  className?: string;
  value: string;
  copyUseModifier: boolean;
};

type PreProps = {
  node?: {
    tagName?: string;
    children?: Array<{
      tagName?: string;
      properties?: { className?: string[] | string };
      children?: Array<{ value?: string }>;
    }>;
  };
  children?: ReactNode;
  copyUseModifier: boolean;
};

type LinkBlockProps = {
  urls: string[];
};

function areMarkdownPropsEqual(prev: MarkdownProps, next: MarkdownProps) {
  return (
    prev.value === next.value &&
    prev.className === next.className &&
    prev.codeBlock === next.codeBlock &&
    prev.codeBlockStyle === next.codeBlockStyle &&
    prev.codeBlockCopyUseModifier === next.codeBlockCopyUseModifier &&
    prev.streamingThrottleMs === next.streamingThrottleMs &&
    prev.softBreaks === next.softBreaks &&
    prev.codexLeadMarkerConfig === next.codexLeadMarkerConfig &&
    prev.onOpenFileLink === next.onOpenFileLink &&
    prev.onOpenFileLinkMenu === next.onOpenFileLinkMenu
  );
}

function extractLanguageTag(className?: string) {
  if (!className) {
    return null;
  }
  const match = className.match(/language-([\w-]+)/i);
  if (!match) {
    return null;
  }
  return match[1];
}

function extractCodeFromPre(node?: PreProps["node"]) {
  const codeNode = node?.children?.find((child) => child.tagName === "code");
  const className = codeNode?.properties?.className;
  const normalizedClassName = Array.isArray(className)
    ? className.join(" ")
    : className;
  const value =
    codeNode?.children?.map((child) => child.value ?? "").join("") ?? "";
  return {
    className: normalizedClassName,
    value: value.replace(/\n$/, ""),
  };
}

function normalizeUrlLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  const withoutBullet = trimmed.replace(/^(?:[-*]|\d+\.)\s+/, "");
  if (!/^https?:\/\/\S+$/i.test(withoutBullet)) {
    return null;
  }
  return withoutBullet;
}

function extractUrlLines(value: string) {
  const lines = value.split(/\r?\n/);
  const urls = lines
    .map((line) => normalizeUrlLine(line))
    .filter((line): line is string => Boolean(line));
  const nonEmptyLines = lines.filter((line) => line.trim().length > 0);
  if (nonEmptyLines.length === 0) {
    return null;
  }
  if (urls.length !== nonEmptyLines.length) {
    return null;
  }
  return urls;
}

function normalizeListIndentation(value: string) {
  const lines = value.split(/\r?\n/);
  let inFence = false;
  let activeOrderedItem = false;
  let orderedBaseIndent = 4;
  let orderedIndentOffset: number | null = null;

  const countLeadingSpaces = (line: string) =>
    line.match(/^\s*/)?.[0].length ?? 0;
  const spaces = (count: number) => " ".repeat(Math.max(0, count));
  const normalized = lines.map((line) => {
    const fenceMatch = line.match(/^\s*(```|~~~)/);
    if (fenceMatch) {
      inFence = !inFence;
      activeOrderedItem = false;
      orderedIndentOffset = null;
      return line;
    }
    if (inFence) {
      return line;
    }
    if (!line.trim()) {
      return line;
    }

    const orderedMatch = line.match(/^(\s*)(\d+)\.(\s*)(.*)$/);
    const orderedContent = orderedMatch?.[4] ?? "";
    const orderedHasWhitespace = (orderedMatch?.[3].length ?? 0) > 0;
    const orderedLooksDecimal =
      Boolean(orderedContent) &&
      !orderedHasWhitespace &&
      /^\d/.test(orderedContent);
    if (orderedMatch && !orderedLooksDecimal) {
      const rawIndent = orderedMatch[1].length;
      const normalizedIndent = rawIndent;
      activeOrderedItem = true;
      orderedBaseIndent = normalizedIndent + 4;
      orderedIndentOffset = null;
      const normalizedBody = orderedContent.trimStart();
      const normalizedLine = normalizedBody
        ? `${spaces(normalizedIndent)}${orderedMatch[2]}. ${normalizedBody}`
        : `${spaces(normalizedIndent)}${orderedMatch[2]}.`;
      if (normalizedIndent !== rawIndent || normalizedLine !== line) {
        return normalizedLine;
      }
      return line;
    }

    const bulletMatch = line.match(/^(\s*)([-*+])\s+/);
    if (bulletMatch) {
      const rawIndent = bulletMatch[1].length;
      let targetIndent = rawIndent;

      if (activeOrderedItem) {
        if (orderedIndentOffset === null && rawIndent < orderedBaseIndent) {
          orderedIndentOffset = orderedBaseIndent - rawIndent;
        }
        if (orderedIndentOffset !== null) {
          const adjustedIndent = rawIndent + orderedIndentOffset;
          if (adjustedIndent <= orderedBaseIndent + 12) {
            targetIndent = adjustedIndent;
          }
        }
      }

      if (targetIndent !== rawIndent) {
        return `${spaces(targetIndent)}${line.trimStart()}`;
      }
      return line;
    }

    const leadingSpaces = countLeadingSpaces(line);
    if (activeOrderedItem && leadingSpaces < orderedBaseIndent) {
      activeOrderedItem = false;
      orderedIndentOffset = null;
    }
    return line;
  });
  return normalized.join("\n");
}

const FRAGMENTED_PARAGRAPH_MIN_RUN = 5;
const FRAGMENTED_PARAGRAPH_MAX_LENGTH = 14;
const FRAGMENTED_PARAGRAPH_MIN_TOTAL_CHARS = 12;
const FRAGMENTED_PARAGRAPH_EDGE_MIN_LENGTH = 6;
const FRAGMENTED_LINE_MIN_RUN = 6;
const FRAGMENTED_LINE_MAX_LENGTH = 10;
const FRAGMENTED_LINE_MIN_TOTAL_CHARS = 12;
const PARAGRAPH_BREAK_SPLIT_REGEX = /\r?\n[^\S\r\n]*\r?\n+/;
const CODE_FENCE_LINE_REGEX = /^\s*(```|~~~)/;

function hasParagraphBreak(value: string) {
  return PARAGRAPH_BREAK_SPLIT_REGEX.test(value);
}

function startsWithMarkdownBlockSyntax(value: string) {
  const trimmed = value.trimStart();
  return (
    /^[-*+]\s/.test(trimmed) ||
    /^\d+\.(?:\s|$|(?!\d)\S)/.test(trimmed) ||
    /^>\s?/.test(trimmed) ||
    /^#{1,6}\s/.test(trimmed) ||
    /^```/.test(trimmed) ||
    /^\|/.test(trimmed)
  );
}

function normalizeInlineOrderedListBreaks(value: string) {
  return value.replace(
    /([：:。！？!?；;])\s*(\d+)\.(?!\d)(\S)/g,
    "$1\n$2. $3",
  );
}

function endsWithSentencePunctuation(value: string) {
  return /[。！？!?;；:：]$/.test(value.trim());
}

function shouldMergeFragmentedParagraph(value: string) {
  const trimmed = value.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= FRAGMENTED_PARAGRAPH_MAX_LENGTH &&
    !startsWithMarkdownBlockSyntax(trimmed)
  );
}

function extractBlockquoteParagraphText(paragraph: string) {
  const lines = paragraph.split(/\r?\n/);
  const fragments: string[] = [];
  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    const match = line.match(/^\s*>\s?(.*)$/);
    if (!match) {
      return null;
    }
    const content = match[1].trim();
    if (!content || startsWithMarkdownBlockSyntax(content)) {
      return null;
    }
    fragments.push(content);
  }
  if (fragments.length === 0) {
    return null;
  }
  return joinFragmentedParagraphs(fragments);
}

function joinFragmentedParagraphs(segments: string[]) {
  return segments.reduce((combined, segment) => {
    if (!segment) {
      return combined;
    }
    if (!combined) {
      return segment;
    }
    const previousChar = combined[combined.length - 1] ?? "";
    const nextChar = segment[0] ?? "";
    const shouldInsertSpace =
      /[A-Za-z0-9]/.test(previousChar) &&
      /[A-Za-z0-9]/.test(nextChar);
    return shouldInsertSpace ? `${combined} ${segment}` : `${combined}${segment}`;
  }, "");
}

function trimMergeWindowByPunctuation(
  entries: string[],
  start: number,
  end: number,
) {
  let mergeStart = start;
  let mergeEnd = end;
  while (mergeStart < mergeEnd) {
    const edge = entries[mergeStart] ?? "";
    if (
      edge.length >= FRAGMENTED_PARAGRAPH_EDGE_MIN_LENGTH &&
      endsWithSentencePunctuation(edge)
    ) {
      mergeStart += 1;
      continue;
    }
    break;
  }
  while (mergeEnd > mergeStart) {
    const edge = entries[mergeEnd - 1] ?? "";
    if (
      edge.length >= FRAGMENTED_PARAGRAPH_EDGE_MIN_LENGTH &&
      endsWithSentencePunctuation(edge)
    ) {
      mergeEnd -= 1;
      continue;
    }
    break;
  }
  return { mergeStart, mergeEnd };
}

function normalizeFragmentedParagraphBreaks(value: string) {
  if (!hasParagraphBreak(value)) {
    return value;
  }
  const paragraphs = value.split(PARAGRAPH_BREAK_SPLIT_REGEX);
  if (paragraphs.length < FRAGMENTED_PARAGRAPH_MIN_RUN) {
    return value;
  }
  const trimmedParagraphs = paragraphs.map((entry) => entry.trim());

  const normalized: string[] = [];
  let changed = false;
  let index = 0;
  while (index < paragraphs.length) {
    const current = paragraphs[index] ?? "";
    const currentQuoteText = extractBlockquoteParagraphText(current);
    if (
      currentQuoteText &&
      shouldMergeFragmentedParagraph(currentQuoteText)
    ) {
      let cursor = index;
      const quoteEntries: string[] = [];
      while (cursor < paragraphs.length) {
        const candidateQuoteText = extractBlockquoteParagraphText(paragraphs[cursor] ?? "");
        if (
          !candidateQuoteText ||
          !shouldMergeFragmentedParagraph(candidateQuoteText)
        ) {
          break;
        }
        quoteEntries.push(candidateQuoteText.trim());
        cursor += 1;
      }

      const { mergeStart, mergeEnd } = trimMergeWindowByPunctuation(
        quoteEntries,
        0,
        quoteEntries.length,
      );
      if (mergeStart > 0) {
        normalized.push(
          ...quoteEntries.slice(0, mergeStart).map((entry) => `> ${entry}`),
        );
      }
      const mergeCandidates = quoteEntries.slice(mergeStart, mergeEnd);
      const mergeTotalChars = mergeCandidates.reduce(
        (sum, entry) => sum + entry.length,
        0,
      );
      if (
        mergeCandidates.length >= FRAGMENTED_PARAGRAPH_MIN_RUN &&
        mergeTotalChars >= FRAGMENTED_PARAGRAPH_MIN_TOTAL_CHARS
      ) {
        normalized.push(`> ${joinFragmentedParagraphs(mergeCandidates)}`);
        changed = true;
      } else {
        normalized.push(
          ...mergeCandidates.map((entry) => `> ${entry}`),
        );
      }
      if (mergeEnd < quoteEntries.length) {
        normalized.push(
          ...quoteEntries
            .slice(mergeEnd)
            .map((entry) => `> ${entry}`),
        );
      }
      index = cursor;
      continue;
    }

    if (!shouldMergeFragmentedParagraph(current)) {
      normalized.push(current);
      index += 1;
      continue;
    }

    let cursor = index;
    while (cursor < paragraphs.length) {
      const candidate = paragraphs[cursor] ?? "";
      if (!shouldMergeFragmentedParagraph(candidate)) {
        break;
      }
      cursor += 1;
    }

    const { mergeStart, mergeEnd } = trimMergeWindowByPunctuation(
      trimmedParagraphs,
      index,
      cursor,
    );

    if (mergeStart > index) {
      normalized.push(...paragraphs.slice(index, mergeStart));
    }

    const mergeCandidates = trimmedParagraphs
      .slice(mergeStart, mergeEnd)
      .filter(Boolean);
    const mergeTotalChars = mergeCandidates.reduce(
      (sum, entry) => sum + entry.length,
      0,
    );
    if (
      mergeCandidates.length >= FRAGMENTED_PARAGRAPH_MIN_RUN &&
      mergeTotalChars >= FRAGMENTED_PARAGRAPH_MIN_TOTAL_CHARS
    ) {
      normalized.push(joinFragmentedParagraphs(mergeCandidates));
      changed = true;
    } else {
      normalized.push(...paragraphs.slice(mergeStart, mergeEnd));
    }

    if (mergeEnd < cursor) {
      normalized.push(...paragraphs.slice(mergeEnd, cursor));
    }
    index = cursor;
  }
  return changed ? normalized.join("\n\n") : value;
}

function shouldMergeFragmentedLine(value: string) {
  const trimmed = value.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= FRAGMENTED_LINE_MAX_LENGTH &&
    !startsWithMarkdownBlockSyntax(trimmed)
  );
}

function normalizeFragmentedLineBreaks(value: string) {
  if (!value.includes("\n")) {
    return value;
  }
  const blocks = value.split(PARAGRAPH_BREAK_SPLIT_REGEX);
  let changed = false;
  const normalizedBlocks = blocks.map((block) => {
    const lines = block.split(/\r?\n/);
    const normalizedLines: string[] = [];
    let index = 0;
    while (index < lines.length) {
      const current = lines[index] ?? "";
      if (!shouldMergeFragmentedLine(current)) {
        normalizedLines.push(current);
        index += 1;
        continue;
      }
      let cursor = index;
      const run: string[] = [];
      let totalChars = 0;
      while (cursor < lines.length) {
        const candidate = lines[cursor] ?? "";
        if (!shouldMergeFragmentedLine(candidate)) {
          break;
        }
        const trimmed = candidate.trim();
        run.push(trimmed);
        totalChars += trimmed.length;
        cursor += 1;
      }
      const runCompact = run.join("");
      const nonSpaceLength = runCompact.replace(/\s+/g, "").length;
      const cjkCount = (runCompact.match(/[\u4e00-\u9fff]/g) ?? []).length;
      const isCjkDominant = cjkCount >= Math.max(2, Math.floor(nonSpaceLength * 0.35));
      if (
        run.length >= FRAGMENTED_LINE_MIN_RUN &&
        totalChars >= FRAGMENTED_LINE_MIN_TOTAL_CHARS &&
        isCjkDominant
      ) {
        normalizedLines.push(joinFragmentedParagraphs(run));
        changed = true;
      } else {
        normalizedLines.push(...lines.slice(index, cursor));
      }
      index = cursor;
    }
    return normalizedLines.join("\n");
  });
  return changed ? normalizedBlocks.join("\n\n") : value;
}

function normalizeOutsideCodeFences(
  value: string,
  normalizer: (segment: string) => string,
) {
  if (!value.includes("```") && !value.includes("~~~")) {
    return normalizer(value);
  }
  const lines = value.split(/\r?\n/);
  const segments: string[] = [];
  let inFence = false;
  let buffer: string[] = [];
  let changed = false;

  const flushBuffer = () => {
    if (buffer.length === 0) {
      return;
    }
    const segment = buffer.join("\n");
    if (inFence) {
      segments.push(segment);
    } else {
      const normalized = normalizer(segment);
      if (normalized !== segment) {
        changed = true;
      }
      segments.push(normalized);
    }
    buffer = [];
  };

  for (const line of lines) {
    if (CODE_FENCE_LINE_REGEX.test(line)) {
      flushBuffer();
      segments.push(line);
      inFence = !inFence;
      continue;
    }
    buffer.push(line);
  }
  flushBuffer();

  const normalized = segments.join("\n");
  return changed ? normalized : value;
}

function safeDecodeUrl(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function stripFileScheme(value: string) {
  if (!value.startsWith("file://")) {
    return value;
  }
  const withoutScheme = value.slice("file://".length);
  if (withoutScheme.startsWith("localhost/")) {
    return `/${withoutScheme.slice("localhost/".length)}`;
  }
  if (withoutScheme.startsWith("/")) {
    return withoutScheme;
  }
  return `/${withoutScheme}`;
}

function isLikelyAbsoluteFilePath(value: string) {
  if (!value.startsWith("/")) {
    return false;
  }
  const pathBody = value.slice(1);
  if (!pathBody) {
    return false;
  }
  return pathBody.includes("/") || pathBody.includes(".");
}

function resolveLocalFileHref(url: string) {
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }
  const normalized = stripFileScheme(safeDecodeUrl(trimmed));
  if (
    normalized.startsWith("/") ||
    normalized.startsWith("./") ||
    normalized.startsWith("../") ||
    normalized.startsWith("~/")
  ) {
    if (normalized.startsWith("/") && !isLikelyAbsoluteFilePath(normalized)) {
      return null;
    }
    return normalized;
  }
  return isLinkableFilePath(normalized) ? normalized : null;
}

function LinkBlock({ urls }: LinkBlockProps) {
  return (
    <div className="markdown-linkblock">
      {urls.map((url, index) => (
        <a
          key={`${url}-${index}`}
          href={url}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void openUrl(url);
          }}
        >
          {url}
        </a>
      ))}
    </div>
  );
}

function CodeBlock({ className, value, copyUseModifier }: CodeBlockProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<number | null>(null);
  const languageTag = extractLanguageTag(className);
  const languageLabel = languageTag ?? "Code";
  const fencedValue = `\`\`\`${languageTag ?? ""}\n${value}\n\`\`\``;
  const highlightedHtml = useMemo(
    () => highlightLine(value, languageTag),
    [value, languageTag],
  );

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const handleCopy = async (event: MouseEvent<HTMLButtonElement>) => {
    try {
      const shouldFence = copyUseModifier ? event.altKey : true;
      const nextValue = shouldFence ? fencedValue : value;
      await navigator.clipboard.writeText(nextValue);
      setCopied(true);
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = window.setTimeout(() => {
        setCopied(false);
      }, 1200);
    } catch {
      // No-op: clipboard errors can occur in restricted contexts.
    }
  };

  return (
    <div className="markdown-codeblock">
      <div className="markdown-codeblock-header">
        <span className="markdown-codeblock-language">{languageLabel}</span>
        <button
          type="button"
          className={`ghost markdown-codeblock-copy${copied ? " is-copied" : ""}`}
          onClick={handleCopy}
          aria-label={t("messages.copyCodeBlock")}
          title={copied ? t("messages.copied") : t("messages.copy")}
        >
          {copied ? t("messages.copied") : t("messages.copy")}
        </button>
      </div>
      <pre>
        <code
          className={className}
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        />
      </pre>
    </div>
  );
}

function MermaidFallback() {
  return (
    <div className="markdown-codeblock markdown-mermaidblock">
      <div className="markdown-codeblock-header">
        <span className="markdown-codeblock-language">Mermaid</span>
      </div>
      <div className="markdown-mermaidblock-loading">Loading...</div>
    </div>
  );
}

function extractMermaidContent(languageTag: string | null, value: string): string | null {
  // Case 1: react-markdown correctly parsed the language tag
  if (languageTag === "mermaid" && value.trim()) {
    return value;
  }
  // Case 2: fenced marker leaked into the content (e.g. ```mermaid\n...\n```)
  const fencedMatch = value.match(/^```mermaid\s*\n([\s\S]*?)(?:\n```\s*)?$/);
  if (fencedMatch) {
    const inner = fencedMatch[1].trim();
    if (inner) return inner;
  }
  return null;
}

function flattenNodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(flattenNodeText).join("");
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return flattenNodeText(node.props?.children);
  }
  return "";
}

function PreBlock({ node, children, copyUseModifier }: PreProps) {
  const { className, value } = extractCodeFromPre(node);
  if (!className && !value && children) {
    return <pre>{children}</pre>;
  }
  const urlLines = extractUrlLines(value);
  if (urlLines) {
    return <LinkBlock urls={urlLines} />;
  }
  const languageTag = extractLanguageTag(className);
  const mermaidContent = extractMermaidContent(languageTag, value);
  if (mermaidContent) {
    return (
      <Suspense fallback={<MermaidFallback />}>
        <MermaidBlock value={mermaidContent} copyUseModifier={copyUseModifier} />
      </Suspense>
    );
  }
  const isSingleLine = !value.includes("\n");
  if (isSingleLine) {
    const highlightedHtml = highlightLine(value, languageTag);
    return (
      <pre className="markdown-codeblock-single">
        <code
          className={className}
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        />
      </pre>
    );
  }
  return (
    <CodeBlock
      className={className}
      value={value}
      copyUseModifier={copyUseModifier}
    />
  );
}

export const Markdown = memo(function Markdown({
  value,
  className,
  codeBlock,
  codeBlockStyle = "default",
  codeBlockCopyUseModifier = false,
  streamingThrottleMs = 80,
  softBreaks = false,
  codexLeadMarkerConfig,
  onOpenFileLink,
  onOpenFileLinkMenu,
}: MarkdownProps) {
  // Throttle rapid value changes during streaming to reduce expensive
  // ReactMarkdown re-parses that block the main thread and cause input lag.
  //
  // Strategy: keep the latest value in a ref and schedule a single timer
  // that fires every THROTTLE_MS. The timer reads from the ref so it
  // always renders the most recent content, even if many updates arrived
  // between ticks. This prevents the timer-cancellation starvation that
  // occurs when every value change cancels and reschedules the timer
  // (on Windows the events can arrive faster than the throttle window,
  // causing the deferred update to never execute).
  const [throttledValue, setThrottledValue] = useState(value);
  const lastUpdateRef = useRef(Date.now());
  const throttleTimerRef = useRef<number>(0);
  const mountedRef = useRef(true);
  const latestValueRef = useRef(value);
  const resolvedThrottleMs = Math.max(0, streamingThrottleMs);
  latestValueRef.current = value;

  useEffect(() => {
    const now = Date.now();
    const elapsed = now - lastUpdateRef.current;
    if (resolvedThrottleMs === 0) {
      setThrottledValue(value);
      lastUpdateRef.current = now;
      return;
    }
    // If enough time has passed, update immediately
    if (elapsed >= resolvedThrottleMs) {
      setThrottledValue(value);
      lastUpdateRef.current = now;
      return;
    }
    // A timer is already pending — it will read latestValueRef when it fires,
    // so there is nothing else to do.
    if (throttleTimerRef.current) {
      return;
    }
    // Schedule a deferred flush. This timer is NOT cancelled when value
    // changes; it will fire once and read the latest value from the ref.
    throttleTimerRef.current = window.setTimeout(() => {
      throttleTimerRef.current = 0;
      if (!mountedRef.current || typeof window === "undefined") {
        return;
      }
      setThrottledValue(latestValueRef.current);
      lastUpdateRef.current = Date.now();
    }, resolvedThrottleMs - elapsed);
  }, [resolvedThrottleMs, value]);

  // Clean up only on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (throttleTimerRef.current) {
        window.clearTimeout(throttleTimerRef.current);
        throttleTimerRef.current = 0;
      }
    };
  }, []);

  const renderValue = throttledValue;

  // Memoize heavy text normalization to avoid re-running on every render
  const content = useMemo(() => {
    if (codeBlock) {
      return `\`\`\`\n${renderValue}\n\`\`\``;
    }
    const normalizeDisplayText = (text: string) =>
      normalizeListIndentation(
        normalizeInlineOrderedListBreaks(
          normalizeFragmentedLineBreaks(normalizeFragmentedParagraphBreaks(text)),
        ),
      );
    return normalizeOutsideCodeFences(renderValue, normalizeDisplayText);
  }, [renderValue, codeBlock]);

  // Stable callback refs for file link handlers
  const onOpenFileLinkRef = useRef(onOpenFileLink);
  onOpenFileLinkRef.current = onOpenFileLink;
  const onOpenFileLinkMenuRef = useRef(onOpenFileLinkMenu);
  onOpenFileLinkMenuRef.current = onOpenFileLinkMenu;

  const handleFileLinkClick = useCallback((event: React.MouseEvent, path: string) => {
    event.preventDefault();
    event.stopPropagation();
    onOpenFileLinkRef.current?.(path);
  }, []);
  const handleFileLinkContextMenu = useCallback((
    event: React.MouseEvent,
    path: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    onOpenFileLinkMenuRef.current?.(event, path);
  }, []);

  // Memoize ReactMarkdown components to prevent full re-initialization on every render.
  // This is critical: when components/plugins change reference, ReactMarkdown
  // discards its entire internal HAST tree and re-parses from scratch.
  const enableCodexLeadEnhancement = className?.includes("markdown-codex-canvas") ?? false;
  const components = useMemo<Components>(() => {
    const result: Components = {
      a: ({ href, children }) => {
        const url = href ?? "";
        if (isFileLinkUrl(url)) {
          const path = decodeFileLink(url);
          return (
            <a
              href={href}
              onClick={(event) => handleFileLinkClick(event, path)}
              onContextMenu={(event) => handleFileLinkContextMenu(event, path)}
            >
              {children}
            </a>
          );
        }
        const localFilePath = resolveLocalFileHref(url);
        if (localFilePath) {
          return (
            <a
              href={href}
              onClick={(event) => handleFileLinkClick(event, localFilePath)}
              onContextMenu={(event) =>
                handleFileLinkContextMenu(event, localFilePath)
              }
            >
              {children}
            </a>
          );
        }
        const isExternal =
          url.startsWith("http://") ||
          url.startsWith("https://") ||
          url.startsWith("mailto:");

        if (!isExternal) {
          return <a href={href}>{children}</a>;
        }

        return (
          <a
            href={href}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void openUrl(url);
            }}
          >
            {children}
          </a>
        );
      },
      code: ({ className: codeClassName, children }) => {
        if (codeClassName) {
          return <code className={codeClassName}>{children}</code>;
        }
        const text = String(children ?? "").trim();
        if (!text || !isLinkableFilePath(text)) {
          return <code>{children}</code>;
        }
        const href = toFileLink(text);
        return (
          <a
            href={href}
            onClick={(event) => handleFileLinkClick(event, text)}
            onContextMenu={(event) => handleFileLinkContextMenu(event, text)}
          >
            <code>{children}</code>
          </a>
        );
      },
    };

    if (enableCodexLeadEnhancement) {
      result.p = ({ children }) => {
        const plainText = flattenNodeText(children);
        const lead = detectCodexLeadMarker(plainText, codexLeadMarkerConfig);
        if (!lead) {
          return <p>{children}</p>;
        }
        return (
          <p className={`markdown-lead-paragraph markdown-lead-${lead.tone}`}>
            <span className="markdown-lead-icon" aria-hidden>{lead.icon}</span>
            <span className="markdown-lead-text">{children}</span>
          </p>
        );
      };
    }

    if (codeBlockStyle === "message") {
      result.pre = ({ node, children }) => (
        <PreBlock node={node as PreProps["node"]} copyUseModifier={codeBlockCopyUseModifier}>
          {children}
        </PreBlock>
      );
    }

    return result;
  }, [
    handleFileLinkClick,
    handleFileLinkContextMenu,
    enableCodexLeadEnhancement,
    codexLeadMarkerConfig,
    codeBlockStyle,
    codeBlockCopyUseModifier,
  ]);

  // Memoize plugin arrays so ReactMarkdown doesn't re-initialize its processor
  const remarkPluginsMemo = useMemo(
    () => (softBreaks ? [remarkGfm, remarkBreaks, remarkFileLinks] : [remarkGfm, remarkFileLinks]),
    [softBreaks],
  );
  const rehypePluginsMemo = useMemo(
    () => [
      rehypeRaw,
      [rehypeSanitize, {
        ...defaultSchema,
        tagNames: [
          ...(defaultSchema.tagNames ?? []),
          "details", "summary", "abbr", "mark", "ins", "del",
          "sub", "sup", "kbd", "var", "samp",
        ],
        attributes: {
          ...defaultSchema.attributes,
          "*": [...(defaultSchema.attributes?.["*"] ?? []), "className", "class", "style"],
          "img": [...(defaultSchema.attributes?.["img"] ?? []), "loading"],
        },
      }],
    ] as Parameters<typeof ReactMarkdown>[0]["rehypePlugins"],
    [],
  );
  const urlTransform = useCallback((url: string) => {
    const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url);
    if (
      isFileLinkUrl(url) ||
      url.startsWith("http://") ||
      url.startsWith("https://") ||
      url.startsWith("mailto:") ||
      url.startsWith("#") ||
      url.startsWith("/") ||
      url.startsWith("./") ||
      url.startsWith("../")
    ) {
      return url;
    }
    if (!hasScheme) {
      return url;
    }
    return "";
  }, []);

  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={remarkPluginsMemo}
        rehypePlugins={rehypePluginsMemo}
        urlTransform={urlTransform}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}, areMarkdownPropsEqual);
