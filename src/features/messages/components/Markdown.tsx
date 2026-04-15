import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState, isValidElement, type ReactNode, type MouseEvent } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { useTranslation } from "react-i18next";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeRaw from "rehype-raw";
import rehypeKatex from "rehype-katex";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import katex from "katex";
import { openUrl } from "@tauri-apps/plugin-opener";
import { convertFileSrc } from "@tauri-apps/api/core";
import { LocalImage } from "./LocalImage";
import "katex/dist/katex.min.css";

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
  workspaceId?: string | null;
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

type LatexRenderEntry =
  | { kind: "label"; text: string }
  | { kind: "formula"; source: string };

function areMarkdownPropsEqual(prev: MarkdownProps, next: MarkdownProps) {
  return (
    prev.value === next.value &&
    prev.className === next.className &&
    prev.workspaceId === next.workspaceId &&
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
  return match[1] ?? null;
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
  const orderedHasWhitespace = ((orderedMatch?.[3] ?? "").length ?? 0) > 0;
    const orderedLooksDecimal =
      Boolean(orderedContent) &&
      !orderedHasWhitespace &&
      /^\d/.test(orderedContent);
    if (orderedMatch && !orderedLooksDecimal) {
      const rawIndent = (orderedMatch[1] ?? "").length;
      const normalizedIndent = rawIndent;
      activeOrderedItem = true;
      orderedBaseIndent = normalizedIndent + 4;
      orderedIndentOffset = null;
      const normalizedBody = orderedContent.trimStart();
      const normalizedLine = normalizedBody
        ? `${spaces(normalizedIndent)}${orderedMatch[2] ?? ""}. ${normalizedBody}`
        : `${spaces(normalizedIndent)}${orderedMatch[2] ?? ""}.`;
      if (normalizedIndent !== rawIndent || normalizedLine !== line) {
        return normalizedLine;
      }
      return line;
    }

    const bulletMatch = line.match(/^(\s*)([-*+])\s+/);
    if (bulletMatch) {
      const rawIndent = (bulletMatch[1] ?? "").length;
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
const MARKDOWN_IMAGE_FILE_EXTENSION_REGEX =
  /\.(png|jpe?g|gif|webp|bmp|tiff?|svg|ico|avif)(?:[?#].*)?$/i;

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

function looksLikeInlineLatexExpression(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  return (
    /\\[A-Za-z]+/.test(trimmed) ||
    /[_^]/.test(trimmed)
  );
}

function isCjkCharacter(value: string) {
  return /[\u3400-\u9fff]/u.test(value);
}

function hasSafeInlineLatexWrapperBoundary(source: string, startIndex: number) {
  if (startIndex <= 0) {
    return true;
  }
  const previousChar = source[startIndex - 1] ?? "";
  return (
    /\s/.test(previousChar) ||
    /[([{"'“‘`<、，。！？；：,:;!?]/u.test(previousChar) ||
    isCjkCharacter(previousChar)
  );
}

function looksLikeStandaloneLatexFormulaLine(value: string) {
  const trimmed = value.trim();
  if (!trimmed || startsWithMarkdownBlockSyntax(trimmed)) {
    return false;
  }
  if (/[\u3400-\u9fff]/u.test(trimmed)) {
    return false;
  }
  const hasLatexCommand = /\\[A-Za-z]+/.test(trimmed);
  const hasEquationOperator = /[=<>]/.test(trimmed);
  const hasMathStructure = /[_^{}()+\-*/]/.test(trimmed);
  if (!(hasLatexCommand || hasEquationOperator) || !hasMathStructure) {
    return false;
  }
  const plainWordTokens = trimmed
    .replace(/\\[A-Za-z]+/g, " ")
    .replace(/[{}_^=<>+\-*/()[\],.;:]/g, " ")
    .match(/[A-Za-z]{3,}/g);
  return (plainWordTokens?.length ?? 0) === 0;
}

function looksLikeExplicitInlineMathLine(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  return (
    /^\$(?!\$)[\s\S]*?(?<!\\)\$[，。！？；：,.;:!?]?$/.test(trimmed) ||
    /^\\\([\s\S]*?\\\)[，。！？；：,.;:!?]?$/.test(trimmed)
  );
}

function normalizeStandaloneMathDisplayLines(value: string) {
  if (!value.includes("\n")) {
    return value;
  }
  const lines = value.split(/\r?\n/);
  let inDisplayMathBlock = false;
  let changed = false;
  const normalized = lines.flatMap((line) => {
    const trimmed = line.trim();
    const leadingWhitespace = line.match(/^\s*/)?.[0] ?? "";
    if (trimmed === "$$") {
      inDisplayMathBlock = !inDisplayMathBlock;
      return [line];
    }
    if (!trimmed) {
      return [line];
    }
    if (inDisplayMathBlock) {
      return [line];
    }

    const singleLineDisplayMatch = trimmed.match(/^\$\$(?!\s*$)([\s\S]*?)(?<!\\)\$\$$/);
    if (singleLineDisplayMatch) {
      const expression = (singleLineDisplayMatch[1] ?? "").trim();
      if (!expression) {
        return [line];
      }
      changed = true;
      return [
        `${leadingWhitespace}$$`,
        `${leadingWhitespace}${expression}`,
        `${leadingWhitespace}$$`,
      ];
    }

    if (looksLikeExplicitInlineMathLine(trimmed)) {
      return [line];
    }

    if (!looksLikeStandaloneLatexFormulaLine(trimmed)) {
      return [line];
    }
    changed = true;
    return [
      `${leadingWhitespace}$$`,
      `${leadingWhitespace}${trimmed}`,
      `${leadingWhitespace}$$`,
    ];
  });
  return changed ? normalized.join("\n") : value;
}

function normalizeCommonMathDelimiters(value: string) {
  let changed = false;
  let normalized = value.replace(
    /\\\(\s*([^\n]*?)\s*\\\)/g,
    (match, inner: string) => {
      if (!looksLikeInlineLatexExpression(inner)) {
        return match;
      }
      changed = true;
      return `$${inner.trim()}$`;
    },
  );

  normalized = normalized.replace(
    /\\\[\s*([\s\S]*?)\s*\\\]/g,
    (match, inner: string) => {
      const expression = inner.trim();
      if (!looksLikeInlineLatexExpression(expression)) {
        return match;
      }
      changed = true;
      return `$$\n${expression}\n$$`;
    },
  );

  normalized = normalized.replace(
    /[（(]\s*(\\[A-Za-z][^()\n（）]*?)\s*[）)]/g,
    (match, inner: string, offset: number, source: string) => {
      if (!looksLikeInlineLatexExpression(inner)) {
        return match;
      }
      if (!hasSafeInlineLatexWrapperBoundary(source, offset)) {
        return match;
      }
      changed = true;
      return `$${inner.trim()}$`;
    },
  );

  return changed ? normalized : value;
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
    const content = (match[1] ?? "").trim();
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

function escapeHtmlAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function parseImageAttributes(raw: string) {
  const attributes: Record<string, string> = {};
  const pattern = /([a-zA-Z_:][-\w.:]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let match: RegExpExecArray | null = null;
  while ((match = pattern.exec(raw)) !== null) {
    const key = match[1]?.toLowerCase();
    if (!key) {
      continue;
    }
    const value = match[3] ?? match[4] ?? match[5] ?? "";
    attributes[key] = value;
  }
  return attributes;
}

function toHtmlImageTag(src: string, alt?: string, title?: string) {
  const safeSrc = escapeHtmlAttribute(src.trim());
  if (!safeSrc) {
    return "";
  }
  const safeAlt = escapeHtmlAttribute((alt ?? "image").trim() || "image");
  const titlePart = title && title.trim()
    ? ` title="${escapeHtmlAttribute(title.trim())}"`
    : "";
  return `<img src="${safeSrc}" alt="${safeAlt}" loading="lazy"${titlePart} />`;
}

function normalizeMarkdownLocalImageSyntax(value: string) {
  return value.replace(
    /!\[([^\]]*)\]\((file:\/\/[^\s)]+|[A-Za-z]:[\\/][^\s)]*)(?:\s+"([^"]*)")?\)/g,
    (match, rawAlt: string, rawSrc: string, rawTitle: string) => {
      const normalizedLocalPath = normalizeImageLocalPath(rawSrc);
      let renderSrc = normalizedLocalPath ?? rawSrc;
      if (/^[A-Za-z]:[\\/]/.test(renderSrc)) {
        renderSrc = `/${renderSrc}`;
      }
      const next = toHtmlImageTag(renderSrc, rawAlt, rawTitle);
      return next || match;
    },
  );
}

function normalizeImageTags(value: string) {
  let changed = false;
  const withLocalMarkdownImages = normalizeMarkdownLocalImageSyntax(value);
  if (withLocalMarkdownImages !== value) {
    changed = true;
  }

  const withBlockTags = withLocalMarkdownImages.replace(
    /<image>\s*([\s\S]*?)\s*<\/image>/gi,
    (_match, body: string) => {
      const src = body.trim();
      const next = toHtmlImageTag(src);
      if (!next) {
        return _match;
      }
      changed = true;
      return next;
    },
  );

  const withSelfClosingTags = withBlockTags.replace(
    /<image\b([^>]*)\/?>/gi,
    (match, rawAttrs: string) => {
      const attrs = parseImageAttributes(rawAttrs ?? "");
      const src = attrs.src?.trim();
      if (!src) {
        return match;
      }
      const next = toHtmlImageTag(src, attrs.alt, attrs.title);
      if (!next) {
        return match;
      }
      changed = true;
      return next;
    },
  );

  return changed ? withSelfClosingTags : value;
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
  const normalized = repairFragmentedResourceToken(
    stripFileScheme(safeDecodeUrl(trimmed)),
  );
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

function decodeUrlValueSafe(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function looksLikeResourceReference(value: string) {
  const compact = value.replace(/\s+/g, "");
  if (!compact) {
    return false;
  }
  return (
    /(https?:\/\/|file:\/\/|\/Users\/|data:image\/)/i.test(compact) ||
    /^[A-Za-z]:[\\/]/.test(compact) ||
    MARKDOWN_IMAGE_FILE_EXTENSION_REGEX.test(compact)
  );
}

function repairFragmentedResourceToken(value: string) {
  const trimmed = value.trim();
  if (!trimmed || !looksLikeResourceReference(trimmed)) {
    return trimmed;
  }
  let repaired = trimmed;
  repaired = repaired.replace(/(https?):\s*\/\s*\//gi, "$1://");
  repaired = repaired.replace(/file:\s*\/\s*\//gi, "file://");
  repaired = repaired.replace(/([A-Za-z0-9])\s+([./\\:_-])/g, "$1$2");
  repaired = repaired.replace(/([./\\:_-])\s+([A-Za-z0-9])/g, "$1$2");
  return repaired.trim();
}

function normalizeFragmentedResourceReferences(value: string) {
  const withMarkdownTargets = value.replace(
    /(!?\[[^\]]*]\()([\s\S]*?)(\))/g,
    (match, prefix: string, rawTarget: string, suffix: string) => {
      const repaired = repairFragmentedResourceToken(rawTarget);
      if (!repaired || repaired === rawTarget || !looksLikeResourceReference(repaired)) {
        return match;
      }
      return `${prefix}${repaired}${suffix}`;
    },
  );
  const source = withMarkdownTargets;
  const lines = source.split(/\r?\n/);
  let changed = false;
  const normalized = lines.map((line) => {
    if (!looksLikeResourceReference(line)) {
      return line;
    }
    const repaired = repairFragmentedResourceToken(line);
    if (repaired !== line) {
      changed = true;
    }
    return repaired;
  });
  if (!changed) {
    return source;
  }
  return normalized.join("\n");
}

function normalizeImageLocalPath(src: string) {
  const decoded = repairFragmentedResourceToken(decodeUrlValueSafe(src.trim()));
  if (!decoded) {
    return null;
  }
  if (/^\/[A-Za-z]:[\\/]/.test(decoded)) {
    return decoded.slice(1);
  }
  if (decoded.startsWith("file://")) {
    const withoutScheme = decoded.slice("file://".length);
    const withoutHost = withoutScheme.startsWith("localhost/")
      ? withoutScheme.slice("localhost/".length)
      : withoutScheme;
    if (/^\/[A-Za-z]:[\\/]/.test(withoutHost)) {
      return withoutHost.slice(1);
    }
    if (/^[A-Za-z]:[\\/]/.test(withoutHost)) {
      return withoutHost;
    }
    if (withoutHost.startsWith("/")) {
      return withoutHost;
    }
    return `/${withoutHost}`;
  }
  if (
    decoded.startsWith("/") ||
    decoded.startsWith("./") ||
    decoded.startsWith("../") ||
    decoded.startsWith("~/") ||
    /^[A-Za-z]:[\\/]/.test(decoded) ||
    /^\\\\[^\\]/.test(decoded)
  ) {
    return decoded;
  }
  return null;
}

function normalizeMarkdownImageSrc(src: string) {
  const trimmed = src.trim();
  if (!trimmed) {
    return "";
  }
  const cleaned = repairFragmentedResourceToken(
    trimmed
    .replace(/^<(.+)>$/, "$1")
    .replace(/^['"](.+)['"]$/, "$1")
    .trim(),
  );
  if (!cleaned) {
    return "";
  }
  if (
    cleaned.startsWith("data:") ||
    cleaned.startsWith("http://") ||
    cleaned.startsWith("https://") ||
    cleaned.startsWith("asset://")
  ) {
    return cleaned;
  }
  const localPath = normalizeImageLocalPath(cleaned);
  const imageLikeLocal = MARKDOWN_IMAGE_FILE_EXTENSION_REGEX.test(cleaned);
  if (!localPath && !imageLikeLocal) {
    return "";
  }
  try {
    return convertFileSrc(localPath ?? cleaned);
  } catch {
    return "";
  }
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

function isLatexLanguage(languageTag: string | null) {
  const normalized = languageTag?.toLowerCase();
  return normalized === "latex" || normalized === "tex";
}

function extractLatexContent(languageTag: string | null, value: string): string | null {
  if (isLatexLanguage(languageTag) && value.trim()) {
    return value;
  }
  const fencedMatch = value.match(/^```(?:latex|tex)\s*\n([\s\S]*?)(?:\n```\s*)?$/i);
  if (!fencedMatch) {
    return null;
  }
  const inner = (fencedMatch[1] ?? "").trim();
  return inner || null;
}

function buildLatexRenderEntries(value: string): LatexRenderEntry[] {
  const lines = value.split(/\r?\n/);
  const entries: LatexRenderEntry[] = [];
  let formulaBuffer: string[] = [];

  const flushFormula = () => {
    const source = formulaBuffer.join("\n").trim();
    formulaBuffer = [];
    if (!source) {
      return;
    }
    entries.push({ kind: "formula", source });
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushFormula();
      continue;
    }
    if (trimmed.startsWith("%")) {
      flushFormula();
      const label = trimmed.replace(/^%\s*/, "").trim();
      if (label) {
        entries.push({ kind: "label", text: label });
      }
      continue;
    }
    formulaBuffer.push(line);
  }
  flushFormula();

  if (entries.length > 0) {
    return entries;
  }
  const fallbackSource = value.trim();
  return fallbackSource ? [{ kind: "formula", source: fallbackSource }] : [];
}

function unwrapLatexDelimiters(source: string) {
  const trimmed = source.trim();
  if (!trimmed) {
    return trimmed;
  }
  const wrappedPatterns = [
    /^\$\$\s*([\s\S]*?)\s*\$\$$/,
    /^\\\[\s*([\s\S]*?)\s*\\\]$/,
    /^\$(?!\$)\s*([\s\S]*?)\s*(?<!\\)\$$/,
    /^\\\(\s*([\s\S]*?)\s*\\\)$/,
  ];
  for (const pattern of wrappedPatterns) {
    const match = trimmed.match(pattern);
    if (!match) {
      continue;
    }
    const inner = (match[1] ?? "").trim();
    if (inner) {
      return inner;
    }
  }
  return trimmed;
}

function renderLatexFormula(source: string) {
  try {
    const renderedHtml = katex.renderToString(unwrapLatexDelimiters(source), {
      displayMode: true,
      throwOnError: false,
      strict: "ignore",
      trust: false,
    });
    return renderedHtml.includes("katex-error") ? null : renderedHtml;
  } catch {
    return null;
  }
}

function CodeBlock({ className, value, copyUseModifier }: CodeBlockProps) {
  const { t } = useTranslation();
  const [copiedMode, setCopiedMode] = useState<"plain" | "fenced" | null>(null);
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
      const nextValue = copyUseModifier && event.altKey ? fencedValue : value;
      await navigator.clipboard.writeText(nextValue);
      setCopiedMode(nextValue === fencedValue ? "fenced" : "plain");
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = window.setTimeout(() => {
        setCopiedMode(null);
      }, 1200);
    } catch {
      // No-op: clipboard errors can occur in restricted contexts.
    }
  };

  const handleCopyFenced = async () => {
    try {
      await navigator.clipboard.writeText(fencedValue);
      setCopiedMode("fenced");
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = window.setTimeout(() => {
        setCopiedMode(null);
      }, 1200);
    } catch {
      // No-op: clipboard errors can occur in restricted contexts.
    }
  };

  return (
    <div className="markdown-codeblock">
      <div className="markdown-codeblock-header">
        <span className="markdown-codeblock-language">{languageLabel}</span>
        <div className="markdown-codeblock-actions">
          <button
            type="button"
            className={`ghost markdown-codeblock-copy${copiedMode === "plain" ? " is-copied" : ""}`}
            onClick={handleCopy}
            aria-label={t("messages.copyCodeBlock")}
            title={copiedMode === "plain" ? t("messages.copied") : t("messages.copy")}
          >
            {copiedMode === "plain" ? t("messages.copied") : t("messages.copy")}
          </button>
          <button
            type="button"
            className={`ghost markdown-codeblock-copy${copiedMode === "fenced" ? " is-copied" : ""}`}
            onClick={handleCopyFenced}
            aria-label={t("messages.copyCodeBlockWithFence")}
            title={copiedMode === "fenced" ? t("messages.copied") : t("messages.copyWithFence")}
          >
            {copiedMode === "fenced" ? t("messages.copied") : t("messages.copyWithFence")}
          </button>
        </div>
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

function LatexBlock({ className, value, copyUseModifier }: CodeBlockProps) {
  const { t } = useTranslation();
  const [copiedMode, setCopiedMode] = useState<"plain" | "fenced" | null>(null);
  const copyTimeoutRef = useRef<number | null>(null);
  const languageTag = extractLanguageTag(className);
  const languageLabel = languageTag ? languageTag.toUpperCase() : "LaTeX";
  const fencedValue = `\`\`\`${languageTag ?? "latex"}\n${value}\n\`\`\``;
  const entries = useMemo(
    () => buildLatexRenderEntries(value),
    [value],
  );
  const renderedEntries = useMemo(
    () => entries.map((entry) => (
      entry.kind === "label"
        ? { ...entry }
        : { ...entry, html: renderLatexFormula(entry.source) }
    )),
    [entries],
  );
  const hasFormulaRenderFailure = renderedEntries.some(
    (entry) => entry.kind === "formula" && !entry.html,
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
      const nextValue = copyUseModifier && event.altKey ? fencedValue : value;
      await navigator.clipboard.writeText(nextValue);
      setCopiedMode(nextValue === fencedValue ? "fenced" : "plain");
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = window.setTimeout(() => {
        setCopiedMode(null);
      }, 1200);
    } catch {
      // No-op: clipboard errors can occur in restricted contexts.
    }
  };

  const handleCopyFenced = async () => {
    try {
      await navigator.clipboard.writeText(fencedValue);
      setCopiedMode("fenced");
      if (copyTimeoutRef.current) {
        window.clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = window.setTimeout(() => {
        setCopiedMode(null);
      }, 1200);
    } catch {
      // No-op: clipboard errors can occur in restricted contexts.
    }
  };

  if (hasFormulaRenderFailure) {
    return (
      <CodeBlock
        className={className}
        value={value}
        copyUseModifier={copyUseModifier}
      />
    );
  }

  return (
    <div className="markdown-codeblock markdown-latexblock">
      <div className="markdown-codeblock-header">
        <span className="markdown-codeblock-language">{languageLabel}</span>
        <div className="markdown-codeblock-actions">
          <button
            type="button"
            className={`ghost markdown-codeblock-copy${copiedMode === "plain" ? " is-copied" : ""}`}
            onClick={handleCopy}
            aria-label={t("messages.copyCodeBlock")}
            title={copiedMode === "plain" ? t("messages.copied") : t("messages.copy")}
          >
            {copiedMode === "plain" ? t("messages.copied") : t("messages.copy")}
          </button>
          <button
            type="button"
            className={`ghost markdown-codeblock-copy${copiedMode === "fenced" ? " is-copied" : ""}`}
            onClick={handleCopyFenced}
            aria-label={t("messages.copyCodeBlockWithFence")}
            title={copiedMode === "fenced" ? t("messages.copied") : t("messages.copyWithFence")}
          >
            {copiedMode === "fenced" ? t("messages.copied") : t("messages.copyWithFence")}
          </button>
        </div>
      </div>
      <div className="markdown-latexblock-content">
        {renderedEntries.map((entry, index) => (
          entry.kind === "label" ? (
            <p
              key={`latex-label-${index}-${entry.text}`}
              className="markdown-latexblock-label"
            >
              {entry.text}
            </p>
          ) : (
            <div
              key={`latex-formula-${index}`}
              className="markdown-latexblock-formula"
              dangerouslySetInnerHTML={{ __html: entry.html ?? "" }}
            />
          )
        ))}
      </div>
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
    const inner = (fencedMatch[1] ?? "").trim();
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
  const mermaidContent = extractMermaidContent(languageTag, value ?? "");
  if (mermaidContent) {
    return (
      <Suspense fallback={<MermaidFallback />}>
        <MermaidBlock value={mermaidContent} copyUseModifier={copyUseModifier} />
      </Suspense>
    );
  }
  const latexContent = extractLatexContent(languageTag, value ?? "");
  if (latexContent) {
    return (
      <LatexBlock
        className={className}
        value={latexContent}
        copyUseModifier={copyUseModifier}
      />
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
  workspaceId = null,
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
      normalizeImageTags(
        normalizeStandaloneMathDisplayLines(
          normalizeCommonMathDelimiters(
            normalizeFragmentedResourceReferences(
              normalizeListIndentation(
                normalizeInlineOrderedListBreaks(
                  normalizeFragmentedLineBreaks(normalizeFragmentedParagraphBreaks(text)),
                ),
              ),
            ),
          ),
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
      img: ({ src, alt, ...props }) => {
        const fallbackLocalPath = normalizeImageLocalPath(src ?? "");
        const normalizedSrc = normalizeMarkdownImageSrc(src ?? "");
        if (!normalizedSrc) {
          return null;
        }
        return (
          <LocalImage
            {...props}
            src={normalizedSrc}
            localPath={fallbackLocalPath}
            workspaceId={workspaceId}
            alt={alt ?? "image"}
            loading="lazy"
          />
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
    workspaceId,
  ]);

  // Memoize plugin arrays so ReactMarkdown doesn't re-initialize its processor
  const remarkPluginsMemo = useMemo(
    () => (softBreaks
      ? [remarkGfm, remarkBreaks, remarkMath, remarkFileLinks]
      : [remarkGfm, remarkMath, remarkFileLinks]),
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
      rehypeKatex,
    ] as Parameters<typeof ReactMarkdown>[0]["rehypePlugins"],
    [],
  );
  const urlTransform = useCallback((url: string) => {
    const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url);
    if (
      isFileLinkUrl(url) ||
      url.startsWith("http://") ||
      url.startsWith("https://") ||
      url.startsWith("file://") ||
      url.startsWith("mailto:") ||
      url.startsWith("#") ||
      url.startsWith("/") ||
      url.startsWith("./") ||
      url.startsWith("../") ||
      /^[A-Za-z]:[\\/]/.test(url)
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
