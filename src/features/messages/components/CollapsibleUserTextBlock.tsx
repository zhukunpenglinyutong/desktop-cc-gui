import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import FileIcon from "../../../components/FileIcon";

type CollapsibleUserTextBlockProps = {
  content: string;
  parsedContent?: UserTextParseResult;
};

const MAX_COLLAPSED_HEIGHT = 160;

type UserReferenceSegment = {
  path: string;
  displayName: string;
  parentPath: string;
  isDirectory: boolean;
};

export type UserCodeAnnotationSegment = UserReferenceSegment & {
  lineRange: string;
  body: string;
};

export type UserTextParseResult = {
  plainText: string;
  references: UserReferenceSegment[];
  codeAnnotations: UserCodeAnnotationSegment[];
};

const CODE_ANNOTATION_BLOCK_REGEX =
  /@file\s+`([^`\n]+#L\d+(?:-L?\d+)?)`\s*\r?\n标注[:：]([^\r\n]*(?:\r?\n(?!\s*@file\s+`[^`\n]+#L\d+(?:-L?\d+)?`\s*\r?\n标注[:：])[\s\S]*?)?)(?=(?:\r?\n){2,}\s*@file\s+`[^`\n]+#L\d+(?:-L?\d+)?`\s*\r?\n标注[:：]|\s*$)/g;

function isTokenBoundary(char: string | undefined) {
  if (!char) {
    return true;
  }
  return /\s/.test(char) || /[([{"'`，。！？；：、（）【】《》“”‘’]/.test(char);
}

function isQuoteChar(char: string | undefined) {
  return char === '"' || char === "'";
}

function isInlinePathReferencePrefix(content: string, tokenStart: number) {
  const firstChar = content[tokenStart];
  if (!firstChar) {
    return false;
  }
  if (isQuoteChar(firstChar)) {
    return true;
  }
  if (firstChar === "/" || firstChar === "~") {
    return true;
  }
  if (firstChar === ".") {
    const nextChar = content[tokenStart + 1];
    return nextChar === "/" || nextChar === ".";
  }
  if (firstChar === "\\") {
    return content[tokenStart + 1] === "\\";
  }
  if (firstChar.toLowerCase() === "f") {
    return content.slice(tokenStart, tokenStart + 7).toLowerCase() === "file://";
  }
  if (/[A-Za-z]/.test(firstChar)) {
    return content[tokenStart + 1] === ":";
  }
  return false;
}

function splitTrailingPunctuation(token: string) {
  const suffixMatch = token.match(/[),.;!?，。；：！？、）】》”’"'`]+$/);
  if (!suffixMatch) {
    return { body: token, suffix: "" };
  }
  const suffix = suffixMatch[0] ?? "";
  return {
    body: token.slice(0, token.length - suffix.length),
    suffix,
  };
}

function normalizeReferencePath(tokenPath: string) {
  const trimmed = tokenPath.trim();
  if (!trimmed) {
    return "";
  }
  if (!trimmed.startsWith("file://")) {
    return trimmed;
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "file:") {
      return trimmed;
    }
    const decodedPath = decodeURIComponent(url.pathname || "");
    const normalizedPath = decodedPath.replace(/\\/g, "/");
    const hostname = (url.hostname || "").trim();

    if (/^\/[A-Za-z]:\//.test(normalizedPath)) {
      return normalizedPath.slice(1);
    }
    if (/^[A-Za-z]:\//.test(normalizedPath)) {
      return normalizedPath;
    }
    if (hostname && hostname !== "localhost") {
      return `//${hostname}${normalizedPath}`;
    }
    return normalizedPath;
  } catch {
    const withoutScheme = trimmed.slice("file://".length);
    const decoded = decodeURIComponent(withoutScheme);
    if (/^\/[A-Za-z]:\//.test(decoded)) {
      return decoded.slice(1);
    }
    return decoded;
  }
}

function isLikelyPath(path: string) {
  return /^(?:\/|~\/|\.{1,2}\/|[A-Za-z]:[\\/]|\\\\|\/\/)/.test(path);
}

function stripLineSuffix(path: string) {
  const withoutHashLine = path.replace(/#L?\d+(?:C\d+)?(?:-\d+)?$/i, "");
  return withoutHashLine.replace(/:(\d+)(?::\d+)?$/g, "");
}

function getPathParts(path: string) {
  const normalized = stripLineSuffix(path).replace(/\\/g, "/");
  const hadTrailingSlash = /\/$/.test(normalized);
  const clean = normalized.replace(/\/+$/, "");
  const segments = clean.split("/").filter(Boolean);
  const baseName = segments[segments.length - 1] ?? clean;
  const parentPath = segments.length > 1 ? clean.slice(0, clean.length - baseName.length - 1) : "";
  return { baseName, parentPath, hadTrailingSlash };
}

function isExtractablePathCandidate(path: string) {
  if (!path || !isLikelyPath(path)) {
    return false;
  }
  const { baseName, hadTrailingSlash } = getPathParts(path);
  if (!baseName) {
    return hadTrailingSlash;
  }

  if (hadTrailingSlash) {
    return true;
  }

  if (baseName.includes(".")) {
    const extension = baseName.split(".").pop() ?? "";
    return /^[A-Za-z0-9_-]{1,16}$/.test(extension);
  }

  return !/\s/.test(baseName);
}

function findReferenceTokenEnd(content: string, atIndex: number) {
  let end = atIndex + 1;
  while (end < content.length) {
    const char = content[end] ?? "";
    if (char === "\n" || char === "\r" || char === "\t") {
      break;
    }
    if (char === "@") {
      const prevChar = end > 0 ? content[end - 1] : undefined;
      if (isTokenBoundary(prevChar)) {
        break;
      }
    }
    end += 1;
  }
  return end;
}

function resolveReferenceToken(rawToken: string) {
  let bestMatch: { normalizedPath: string; suffix: string; consumedLength: number } | null = null;
  const windowToken = rawToken.trimEnd();

  for (let candidateEnd = 1; candidateEnd <= windowToken.length; candidateEnd += 1) {
    const candidateToken = windowToken.slice(0, candidateEnd);
    const { body, suffix } = splitTrailingPunctuation(candidateToken);
    const normalizedPath = normalizeReferencePath(body);
    if (!isExtractablePathCandidate(normalizedPath)) {
      continue;
    }
    bestMatch = {
      normalizedPath,
      suffix,
      consumedLength: candidateEnd,
    };

    // Once we hit a likely file path (`*.md`, `*.ts`, etc.) and the next character
    // is whitespace, treat it as a complete match to avoid swallowing trailing prose.
    const nextChar = rawToken[candidateEnd];
    if (nextChar && /\s/.test(nextChar)) {
      const { baseName } = getPathParts(normalizedPath);
      const extension = baseName.includes(".") ? (baseName.split(".").pop() ?? "") : "";
      if (/[A-Za-z]/.test(extension)) {
        let consumedLength = candidateEnd;
        while (consumedLength < rawToken.length && /\s/.test(rawToken[consumedLength] ?? "")) {
          consumedLength += 1;
        }
        bestMatch = {
          normalizedPath,
          suffix,
          consumedLength,
        };
        break;
      }
    }
  }

  return bestMatch;
}

function parseQuotedReferenceToken(content: string, atIndex: number) {
  const quoteChar = content[atIndex + 1];
  if (!isQuoteChar(quoteChar)) {
    return null;
  }

  let cursor = atIndex + 2;
  while (cursor < content.length) {
    const currentChar = content[cursor] ?? "";
    const previousChar = cursor > atIndex + 2 ? content[cursor - 1] : undefined;
    if (currentChar === quoteChar && previousChar !== "\\") {
      break;
    }
    cursor += 1;
  }

  if (cursor >= content.length || content[cursor] !== quoteChar) {
    return null;
  }

  const quotedBody = content.slice(atIndex + 2, cursor);
  const normalizedPath = normalizeReferencePath(quotedBody);
  if (!isExtractablePathCandidate(normalizedPath)) {
    return null;
  }

  let suffixEnd = cursor + 1;
  while (suffixEnd < content.length) {
    const char = content[suffixEnd] ?? "";
    if (/\s/.test(char) || char === "@") {
      break;
    }
    suffixEnd += 1;
  }
  const suffix = content.slice(cursor + 1, suffixEnd);

  return {
    normalizedPath,
    suffix,
    consumedEnd: suffixEnd,
  };
}

function createReferenceSegment(path: string): UserReferenceSegment {
  const { baseName, parentPath, hadTrailingSlash } = getPathParts(path);
  const isDirectory = hadTrailingSlash || !baseName.includes(".");
  const displayName = isDirectory ? `${baseName}/` : baseName;
  return {
    path,
    displayName: displayName || path,
    parentPath,
    isDirectory,
  };
}

function splitCodeAnnotationReference(reference: string) {
  const trimmedReference = reference.trim();
  const hashIndex = trimmedReference.lastIndexOf("#");
  if (hashIndex <= 0) {
    return null;
  }
  const path = trimmedReference.slice(0, hashIndex).trim();
  const lineRange = trimmedReference.slice(hashIndex + 1).trim();
  if (!path || !/^L\d+(?:-L?\d+)?$/i.test(lineRange)) {
    return null;
  }
  return {
    path,
    lineRange: lineRange.replace(/-L?(\d+)$/i, "-L$1").replace(/^l/i, "L"),
  };
}

function extractCodeAnnotationBlocks(content: string) {
  const textParts: string[] = [];
  const codeAnnotations: UserCodeAnnotationSegment[] = [];
  let cursor = 0;

  for (const match of content.matchAll(CODE_ANNOTATION_BLOCK_REGEX)) {
    const matchStart = match.index ?? -1;
    if (matchStart < 0) {
      continue;
    }
    const reference = splitCodeAnnotationReference(match[1] ?? "");
    const body = (match[2] ?? "").trim();
    if (!reference || !body) {
      continue;
    }
    if (cursor < matchStart) {
      textParts.push(content.slice(cursor, matchStart));
    }
    codeAnnotations.push({
      ...createReferenceSegment(reference.path),
      lineRange: reference.lineRange,
      body,
    });
    cursor = matchStart + match[0].length;
  }

  if (cursor < content.length) {
    textParts.push(content.slice(cursor));
  }

  return {
    contentWithoutAnnotations: textParts.join("").replace(/\n{3,}/g, "\n\n"),
    codeAnnotations,
  };
}

export function parseUserTextContent(content: string): UserTextParseResult {
  if (!content) {
    return { plainText: "", references: [], codeAnnotations: [] };
  }

  const { contentWithoutAnnotations, codeAnnotations } = extractCodeAnnotationBlocks(content);

  const textParts: string[] = [];
  const references: UserReferenceSegment[] = [];
  const seenPaths = new Set<string>();
  let cursor = 0;
  let index = 0;

  while (index < contentWithoutAnnotations.length) {
    if (contentWithoutAnnotations[index] !== "@") {
      index += 1;
      continue;
    }

    const previousChar = index > 0 ? contentWithoutAnnotations[index - 1] : undefined;
    if (
      !isTokenBoundary(previousChar) &&
      !isInlinePathReferencePrefix(contentWithoutAnnotations, index + 1)
    ) {
      index += 1;
      continue;
    }

    const quotedToken = parseQuotedReferenceToken(contentWithoutAnnotations, index);
    if (quotedToken) {
      if (cursor < index) {
        textParts.push(contentWithoutAnnotations.slice(cursor, index));
      }
      if (quotedToken.suffix) {
        textParts.push(quotedToken.suffix);
      }

      const dedupeKey = quotedToken.normalizedPath.toLowerCase();
      if (!seenPaths.has(dedupeKey)) {
        seenPaths.add(dedupeKey);
        references.push(createReferenceSegment(quotedToken.normalizedPath));
      }

      cursor = quotedToken.consumedEnd;
      index = quotedToken.consumedEnd;
      continue;
    }

    const tokenEnd = findReferenceTokenEnd(contentWithoutAnnotations, index);
    const rawToken = contentWithoutAnnotations.slice(index + 1, tokenEnd);
    if (!rawToken) {
      index += 1;
      continue;
    }

    const resolvedToken = resolveReferenceToken(rawToken);
    if (!resolvedToken) {
      index += 1;
      continue;
    }
    const { normalizedPath, suffix, consumedLength } = resolvedToken;

    if (cursor < index) {
      textParts.push(contentWithoutAnnotations.slice(cursor, index));
    }
    if (suffix) {
      textParts.push(suffix);
    }

    const dedupeKey = normalizedPath.toLowerCase();
    if (!seenPaths.has(dedupeKey)) {
      seenPaths.add(dedupeKey);
      references.push(createReferenceSegment(normalizedPath));
    }

    const consumedEnd = index + 1 + consumedLength;
    cursor = consumedEnd;
    index = consumedEnd;
  }

  if (cursor < contentWithoutAnnotations.length) {
    textParts.push(contentWithoutAnnotations.slice(cursor));
  }

  return {
    plainText: textParts.join(""),
    references,
    codeAnnotations,
  };
}

export const CollapsibleUserTextBlock = memo(function CollapsibleUserTextBlock({
  content,
  parsedContent: parsedContentProp,
}: CollapsibleUserTextBlockProps) {
  const { t } = useTranslation();
  const contentRef = useRef<HTMLDivElement | null>(null);
  const parsedContent = useMemo(
    () => parsedContentProp ?? parseUserTextContent(content),
    [content, parsedContentProp],
  );
  const [expanded, setExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [hasMeasuredOverflow, setHasMeasuredOverflow] = useState(false);

  useLayoutEffect(() => {
    setHasMeasuredOverflow(false);
  }, [content]);

  useLayoutEffect(() => {
    if (!contentRef.current) {
      return;
    }

    const checkHeight = () => {
      if (!contentRef.current) {
        return;
      }
      setIsOverflowing(contentRef.current.scrollHeight > MAX_COLLAPSED_HEIGHT);
      setHasMeasuredOverflow(true);
    };

    checkHeight();
    const observer = new ResizeObserver(checkHeight);
    observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, [content]);

  return (
    <div className={`user-collapsible-block flex flex-col w-full ${expanded ? "is-expanded" : "is-collapsed"}`}>
      <div
        className={`user-collapsible-content relative [transition:max-height_0.3s_ease-out]${hasMeasuredOverflow ? " is-measured" : " is-measuring [transition:none]"}`}
        ref={contentRef}
        style={{
          maxHeight: expanded || !isOverflowing ? "none" : `${MAX_COLLAPSED_HEIGHT}px`,
          overflow: "hidden",
        }}
      >
        <div className="user-collapsible-text-content text-inherit whitespace-pre-wrap break-words">
          <span>{parsedContent.plainText}</span>
        </div>
        {parsedContent.references.length > 0 ? (
          <div className="user-reference-card mt-2 pt-1.5 border-t border-[color-mix(in_srgb,var(--color-message-user-text,#ffffff)_18%,transparent)]" aria-label="Referenced files and folders">
            <div className="user-reference-card-title text-[10px] tracking-[0.03em] uppercase text-[color-mix(in_srgb,var(--color-message-user-text,#ffffff)_62%,transparent)] mb-1">References</div>
            <div className="user-reference-card-list flex flex-col gap-[3px]">
              {parsedContent.references.map((reference) => (
                <div
                  key={reference.path}
                  className="user-reference-card-item inline-flex items-center gap-2 min-w-0 py-0.5"
                  title={reference.path}
                >
                  <span className="user-reference-card-icon inline-flex items-center justify-center w-[18px] h-[18px] flex-none rounded-[5px] [background:linear-gradient(180deg,color-mix(in_srgb,#ffffff_30%,transparent)_0%,color-mix(in_srgb,#ffffff_20%,transparent)_100%)] [box-shadow:inset_0_0_0_1px_color-mix(in_srgb,#ffffff_36%,transparent),0_0_0_1px_color-mix(in_srgb,#000000_16%,transparent)] [&_.file-icon]:inline-flex [&_.file-icon]:items-center [&_.file-icon]:justify-center [&_.file-icon_svg]:w-[14px] [&_.file-icon_svg]:h-[14px] [&_.file-icon_svg]:[filter:saturate(1.35)_contrast(1.35)_brightness(1.2)_drop-shadow(0_0_0.55px_color-mix(in_srgb,#000000_45%,transparent))]" aria-hidden>
                    <FileIcon filePath={reference.path} isFolder={reference.isDirectory} />
                  </span>
                  <span className="user-reference-card-meta inline-flex flex-col min-w-0 leading-[1.15]">
                    <span className="user-reference-card-name max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-[11px] font-semibold">{reference.displayName}</span>
                    {reference.parentPath ? (
                      <span className="user-reference-card-parent max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-[10px] opacity-[0.72]">{reference.parentPath}</span>
                    ) : null}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {!expanded && isOverflowing ? <div className="user-collapsible-overlay absolute bottom-0 -left-3.5 w-[calc(100%+28px)] h-[60px] [background:linear-gradient(to_bottom,transparent,var(--color-message-user-bg,var(--surface-bubble-user)))] pointer-events-none z-[1]" /> : null}
      </div>
      {isOverflowing ? (
        <button
          type="button"
          className="user-collapsible-toggle flex justify-center items-center w-[calc(100%+28px)] h-5 mt-0 -mr-3.5 -mb-2.5 -ml-3.5 py-0.5 border-0 border-t border-[color-mix(in_srgb,var(--color-message-user-text,#ffffff)_18%,transparent)] rounded-b-xl [background:var(--color-message-user-bg,var(--surface-bubble-user))] text-[color-mix(in_srgb,var(--color-message-user-text,#ffffff)_74%,transparent)] cursor-pointer [transition:color_0.2s_ease] hover:[background:var(--color-message-user-bg,var(--surface-bubble-user))] hover:text-[var(--color-message-user-text,#ffffff)] [&_.codicon]:text-[14px] [&_.codicon]:[transition:transform_0.2s] [&_.codicon.is-expanded]:[transform:rotate(180deg)]"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
          aria-label={expanded ? t("messages.collapseInput") : t("messages.expandInput")}
        >
          <span className={`codicon codicon-chevron-down${expanded ? " is-expanded" : ""}`} />
        </button>
      ) : null}
    </div>
  );
});

export const UserCodeAnnotationContextBlock = memo(function UserCodeAnnotationContextBlock({
  annotations,
}: {
  annotations: UserCodeAnnotationSegment[];
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  if (annotations.length === 0) {
    return null;
  }

  return (
    <div
      className={`message-code-annotation-context w-[min(720px,100%)] grid gap-1.5 px-2.5 py-2 rounded-xl border border-(--border-subtle) bg-(--surface-card)${expanded ? " is-expanded" : " is-collapsed py-1.75 px-2.25 rounded-[10px]"}`}
      aria-label={t("messages.codeAnnotations")}
    >
      <div className="message-code-annotation-context-head flex items-center justify-between gap-3 min-w-0">
        <div className="message-code-annotation-context-title inline-flex items-center gap-1.5 min-w-0 text-(--text-muted) text-[11px] font-[650] tracking-[0.01em] [&_.codicon]:text-(--text-faint) [&_.codicon]:text-[13px]">
          <span className="codicon codicon-comment-discussion" aria-hidden />
          <span>{t("messages.codeAnnotations")}</span>
          <span className="message-code-annotation-context-count text-(--text-faint) text-[11px] font-[650] tracking-[0.01em] whitespace-nowrap">
            {t("messages.codeAnnotationContextCount", { count: annotations.length })}
          </span>
        </div>
        <button
          type="button"
          className="message-code-annotation-context-toggle flex-none inline-flex items-center justify-center gap-1.25 min-h-6 px-1.75 border border-(--border-subtle) rounded-full bg-(--surface-item) text-(--text-muted) cursor-pointer [transition:background-color_0.18s_ease,border-color_0.18s_ease,color_0.18s_ease] hover:bg-(--surface-hover) hover:border-(--border-strong) hover:text-(--text-primary)"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
          aria-label={
            expanded
              ? t("messages.collapseCodeAnnotations")
              : t("messages.expandCodeAnnotations")
          }
        >
          <span className="message-code-annotation-context-toggle-label text-[11px] font-[650] leading-none whitespace-nowrap">
            {expanded ? t("messages.collapse") : t("messages.expand")}
          </span>
          <span
            className={`codicon codicon-chevron-down message-code-annotation-context-toggle-icon text-current text-[13px] [transition:transform_0.18s_ease]${expanded ? " is-expanded [transform:rotate(180deg)]" : ""}`}
            aria-hidden
          />
        </button>
      </div>
      {expanded ? (
        <div className="message-code-annotation-context-list grid gap-1.5">
          {annotations.map((annotation, index) => (
            <div
              key={`${annotation.path}-${annotation.lineRange}-${index}`}
              className="message-code-annotation-context-item grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2 min-w-0 py-1.75 px-2 rounded-[9px] border border-(--border-subtle) bg-(--surface-item)"
              title={`${annotation.path}#${annotation.lineRange}`}
            >
              <span className="message-code-annotation-context-icon inline-flex items-center justify-center w-[22px] h-[22px] rounded-[7px] border border-(--border-subtle) bg-(--surface-card) [&_.file-icon_svg]:w-3.5 [&_.file-icon_svg]:h-3.5" aria-hidden>
                <FileIcon filePath={annotation.path} isFolder={false} />
              </span>
              <span className="message-code-annotation-context-meta grid gap-0.5 min-w-0">
                <span className="message-code-annotation-context-reference inline-flex items-center gap-1.75 min-w-0 [&_code]:flex-none [&_code]:px-1.25 [&_code]:py-px [&_code]:rounded-full [&_code]:border [&_code]:border-(--border-subtle) [&_code]:bg-(--surface-card) [&_code]:text-(--text-muted) [&_code]:text-[10px] [&_code]:font-mono">
                  <span className="message-code-annotation-context-name min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-(--text-primary) text-xs font-bold">
                    {annotation.displayName}
                  </span>
                  <code>{annotation.lineRange}</code>
                </span>
                {annotation.parentPath ? (
                  <span className="message-code-annotation-context-parent min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-(--text-faint) text-[10px]">
                    {annotation.parentPath}
                  </span>
                ) : null}
                <span className="message-code-annotation-context-body text-(--text-primary) text-xs font-semibold leading-[1.35] whitespace-pre-wrap break-words">
                  {annotation.body}
                </span>
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
});
