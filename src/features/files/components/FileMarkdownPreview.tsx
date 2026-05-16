import {
  Children,
  createElement,
  isValidElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Element } from "hast";
import { highlightLine } from "../../../utils/syntax";
import {
  isThemeMutationAttribute,
  mapAppearanceToMermaidTheme,
  readDocumentThemeAppearance,
} from "../../theme/utils/themeAppearance";
import type {
  CodeAnnotationLineRange,
  CodeAnnotationSelection,
} from "../../code-annotations/types";
import { formatCodeAnnotationLineRange } from "../../code-annotations/utils/codeAnnotations";

type FileMarkdownPreviewProps = {
  value: string;
  className?: string;
  onAnnotationStart?: (lineRange: CodeAnnotationLineRange) => void;
  annotationDraft?: { lineRange: CodeAnnotationLineRange; body: string } | null;
  annotations?: CodeAnnotationSelection[];
  renderAnnotationDraft?: (draft: { lineRange: CodeAnnotationLineRange; body: string }) => ReactNode;
  renderAnnotationMarker?: (annotation: CodeAnnotationSelection) => ReactNode;
  annotationActionLabel?: string;
};

type PreviewPreNode = {
  children?: Array<{
    tagName?: string;
    properties?: { className?: string[] | string };
    children?: Array<{ value?: string }>;
  }>;
};

type MermaidRenderState =
  | { status: "idle" }
  | { status: "rendering" }
  | { status: "success"; svg: string }
  | { status: "error"; message: string };

type FrontmatterField = {
  key: string;
  value: string;
};

type MarkdownPositionTreeNode = Pick<Element, "children" | "position" | "tagName"> | undefined;

type AnnotatableBlockTag =
  | "blockquote"
  | "div"
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "ol"
  | "p"
  | "ul";

const ANNOTATABLE_MARKDOWN_NODE_TAGS = new Set<string>([
  "blockquote",
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ol",
  "p",
  "pre",
  "table",
  "ul",
]);

function extractLanguageTag(className?: string) {
  if (!className) {
    return null;
  }
  const match = className.match(/language-([\w-]+)/i);
  return match?.[1] ?? null;
}

function extractCodeFromPre(node?: PreviewPreNode) {
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

function detectMermaidTheme(): "dark" | "default" {
  return mapAppearanceToMermaidTheme(readDocumentThemeAppearance());
}

function normalizeFrontmatterValue(raw: string): string {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((item) => normalizeFrontmatterValue(item))
      .filter(Boolean)
      .join(" · ");
  }
  return trimmed;
}

function extractFrontmatter(value: string): {
  fields: FrontmatterField[];
  body: string;
  bodyStartLine: number;
} {
  const match = value.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  if (!match) {
    return { fields: [], body: value, bodyStartLine: 1 };
  }

  const frontmatterBlock = match[1] ?? "";
  const rawFields = frontmatterBlock
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const fields = rawFields
    .map((line) => {
      const separatorIndex = line.indexOf(":");
      if (separatorIndex <= 0) {
        return null;
      }
      const key = line.slice(0, separatorIndex).trim();
      const rawValue = line.slice(separatorIndex + 1).trim();
      return {
        key,
        value: normalizeFrontmatterValue(rawValue),
      };
    })
    .filter((field): field is FrontmatterField => Boolean(field));

  return {
    fields,
    body: value.slice(match[0].length),
    bodyStartLine: (match[0].match(/\r?\n/g) ?? []).length + 1,
  };
}

function resolveMarkdownNodeLineRange(
  node: MarkdownPositionTreeNode,
  bodyStartLine: number,
): CodeAnnotationLineRange | null {
  const startLine = node?.position?.start.line;
  const endLine = node?.position?.end.line;
  if (
    typeof startLine !== "number" ||
    typeof endLine !== "number" ||
    startLine < 1 ||
    endLine < 1
  ) {
    return null;
  }
  const offset = Math.max(bodyStartLine - 1, 0);
  return {
    startLine: Math.min(startLine, endLine) + offset,
    endLine: Math.max(startLine, endLine) + offset,
  };
}

function annotationEndsInBlock(
  annotationLineRange: CodeAnnotationLineRange,
  blockLineRange: CodeAnnotationLineRange,
) {
  return (
    annotationLineRange.endLine >= blockLineRange.startLine &&
    annotationLineRange.endLine <= blockLineRange.endLine
  );
}

function lineRangeContains(
  outerRange: CodeAnnotationLineRange,
  innerRange: CodeAnnotationLineRange,
) {
  return (
    innerRange.startLine >= outerRange.startLine &&
    innerRange.endLine <= outerRange.endLine
  );
}

function lineRangeSpan(lineRange: CodeAnnotationLineRange) {
  return lineRange.endLine - lineRange.startLine;
}

function collectNestedAnnotatableRanges(children: ReactNode): CodeAnnotationLineRange[] {
  const ranges: CodeAnnotationLineRange[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) {
      return;
    }
    const props = child.props as {
      children?: ReactNode;
      lineRange?: CodeAnnotationLineRange;
    };
    if (props.lineRange) {
      ranges.push(props.lineRange);
    }
    if (props.children) {
      ranges.push(...collectNestedAnnotatableRanges(props.children));
    }
  });
  return ranges;
}

function collectNestedNodeLineRanges(
  node: MarkdownPositionTreeNode,
  bodyStartLine: number,
): CodeAnnotationLineRange[] {
  const ranges: CodeAnnotationLineRange[] = [];
  const children = node?.children ?? [];
  for (const child of children) {
    if (typeof child !== "object" || child === null || !("position" in child)) {
      continue;
    }
    const childNode = child as MarkdownPositionTreeNode;
    const lineRange = ANNOTATABLE_MARKDOWN_NODE_TAGS.has(childNode?.tagName ?? "")
      ? resolveMarkdownNodeLineRange(childNode, bodyStartLine)
      : null;
    if (lineRange) {
      ranges.push(lineRange);
    }
    ranges.push(...collectNestedNodeLineRanges(childNode, bodyStartLine));
  }
  return ranges;
}

function hasMoreSpecificAnnotationBlock({
  children,
  currentLineRange,
  targetLineRange,
  node,
  bodyStartLine,
}: {
  children: ReactNode;
  currentLineRange: CodeAnnotationLineRange;
  targetLineRange: CodeAnnotationLineRange;
  node?: MarkdownPositionTreeNode;
  bodyStartLine?: number;
}) {
  const nestedRanges = [
    ...collectNestedAnnotatableRanges(children),
    ...(node && bodyStartLine
      ? collectNestedNodeLineRanges(node, bodyStartLine)
      : []),
  ];
  return nestedRanges.some(
    (nestedRange) =>
      lineRangeContains(nestedRange, targetLineRange) &&
      lineRangeSpan(nestedRange) < lineRangeSpan(currentLineRange),
  );
}

function MarkdownAnnotatableBlock({
  lineRange,
  node,
  bodyStartLine,
  onAnnotationStart,
  annotationDraft,
  annotations,
  renderAnnotationDraft,
  renderAnnotationMarker,
  annotationActionLabel,
  children,
}: {
  lineRange: CodeAnnotationLineRange;
  node?: MarkdownPositionTreeNode;
  bodyStartLine: number;
  onAnnotationStart?: (lineRange: CodeAnnotationLineRange) => void;
  annotationDraft?: { lineRange: CodeAnnotationLineRange; body: string } | null;
  annotations: CodeAnnotationSelection[];
  renderAnnotationDraft?: (draft: { lineRange: CodeAnnotationLineRange; body: string }) => ReactNode;
  renderAnnotationMarker?: (annotation: CodeAnnotationSelection) => ReactNode;
  annotationActionLabel: string;
  children: ReactNode;
}) {
  const blockAnnotations = annotations.filter((annotation) =>
    annotationEndsInBlock(annotation.lineRange, lineRange) &&
      !hasMoreSpecificAnnotationBlock({
        children,
        currentLineRange: lineRange,
        targetLineRange: annotation.lineRange,
        node,
        bodyStartLine,
      }),
  );
  const shouldRenderDraft = Boolean(
    annotationDraft &&
      annotationEndsInBlock(annotationDraft.lineRange, lineRange),
  ) && !(
    annotationDraft &&
    hasMoreSpecificAnnotationBlock({
      children,
      currentLineRange: lineRange,
      targetLineRange: annotationDraft.lineRange,
      node,
      bodyStartLine,
    })
  );

  return (
    <div
      className="fvp-markdown-annotatable-block relative m-0 py-px pr-[34px] pl-0 rounded-[10px] after:content-[''] after:absolute after:-top-1 after:right-0 after:-bottom-1 after:w-[34px] after:pointer-events-none hover:bg-[color-mix(in_srgb,#2563eb_5%,transparent)] focus-within:bg-[color-mix(in_srgb,#2563eb_5%,transparent)] hover:[&_.fvp-markdown-annotation-button]:opacity-100 focus-within:[&_.fvp-markdown-annotation-button]:opacity-100"
      data-source-line-start={lineRange.startLine}
      data-source-line-end={lineRange.endLine}
    >
      {onAnnotationStart ? (
        <button
          type="button"
          className="fvp-markdown-annotation-button absolute top-0.5 right-0 z-[1] opacity-0 border border-[color-mix(in_srgb,#2563eb_42%,var(--border-subtle))] rounded-full py-[3px] px-2 bg-[color-mix(in_srgb,var(--surface-card)_94%,#2563eb_6%)] text-[#2563eb] shadow-[0_8px_18px_color-mix(in_srgb,#000_12%,transparent)] cursor-pointer text-[11px] font-bold leading-[1.2] hover:opacity-100 focus-visible:opacity-100"
          onClick={() => onAnnotationStart(lineRange)}
          aria-label={`${annotationActionLabel} ${formatCodeAnnotationLineRange(lineRange)}`}
          title={`${annotationActionLabel} ${formatCodeAnnotationLineRange(lineRange)}`}
        >
          {annotationActionLabel}
        </button>
      ) : null}
      {children}
      {blockAnnotations.map((annotation) =>
        renderAnnotationMarker ? (
          <div key={annotation.id} className="fvp-markdown-annotation-inline my-2 mt-2 mb-3">
            {renderAnnotationMarker(annotation)}
          </div>
        ) : null,
      )}
      {shouldRenderDraft && annotationDraft && renderAnnotationDraft ? (
        <div className="fvp-markdown-annotation-inline my-2 mt-2 mb-3">
          {renderAnnotationDraft(annotationDraft)}
        </div>
      ) : null}
    </div>
  );
}

function FileMarkdownCodeBlock({
  className,
  value,
}: {
  className?: string;
  value: string;
}) {
  const languageTag = extractLanguageTag(className);
  const highlightedHtml = useMemo(
    () => highlightLine(value, languageTag),
    [languageTag, value],
  );

  return (
    <div className="fvp-file-markdown-codeblock mb-4 border border-(--fvp-markdown-rule) rounded-xl bg-(--fvp-markdown-code-bg) overflow-hidden [&_pre]:m-0 [&_pre]:pt-[13px] [&_pre]:px-3.5 [&_pre]:pb-3.5 [&_pre]:whitespace-pre [&_pre]:overflow-x-auto [&_pre]:font-[var(--code-font-family)] [&_pre]:text-[var(--code-font-size,11px)] [&_pre]:leading-[var(--code-line-height,1.28)] [&_code]:text-(--fvp-reader-text)">
      {languageTag ? (
        <div className="fvp-file-markdown-codeblock-label flex items-center justify-between gap-3 pt-[7px] pb-1.5 px-3 border-b border-b-(--fvp-markdown-rule) text-[10px] tracking-[0.08em] uppercase text-(--fvp-reader-faint) bg-[color-mix(in_srgb,var(--surface-control)_58%,transparent)]">{languageTag}</div>
      ) : null}
      <pre>
        <code
          className={className}
          dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        />
      </pre>
    </div>
  );
}

function FileMarkdownMermaidBlock({
  className,
  value,
}: {
  className?: string;
  value: string;
}) {
  const [activeTab, setActiveTab] = useState<"source" | "render">("source");
  const [renderState, setRenderState] = useState<MermaidRenderState>({
    status: "idle",
  });
  const [renderKey, setRenderKey] = useState(0);
  const idRef = useRef(`file-mermaid-${crypto.randomUUID()}`);
  const highlightedHtml = useMemo(() => highlightLine(value, "mermaid"), [value]);

  useEffect(() => {
    if (activeTab !== "render") {
      return;
    }

    let cancelled = false;
    setRenderState({ status: "rendering" });

    void (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: detectMermaidTheme(),
          securityLevel: "strict",
          fontFamily:
            "ui-sans-serif, -apple-system, BlinkMacSystemFont, sans-serif",
        });

        const id = `${idRef.current}-${renderKey}-${Date.now()}`;
        const { svg } = await mermaid.render(id, value);
        if (!cancelled) {
          setRenderState({ status: "success", svg });
        }
      } catch (error) {
        if (!cancelled) {
          setRenderState({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeTab, renderKey, value]);

  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (isThemeMutationAttribute(mutation.attributeName)) {
          setRenderKey((prev) => prev + 1);
        }
      }
    });
    observer.observe(document.documentElement, { attributes: true });
    return () => observer.disconnect();
  }, []);

  return (
    <div className="fvp-file-markdown-codeblock fvp-file-markdown-mermaid mb-4 border border-(--fvp-markdown-rule) rounded-xl bg-(--fvp-markdown-code-bg) overflow-hidden [&_pre]:m-0 [&_pre]:pt-[13px] [&_pre]:px-3.5 [&_pre]:pb-3.5 [&_pre]:whitespace-pre [&_pre]:overflow-x-auto [&_pre]:font-[var(--code-font-family)] [&_pre]:text-[var(--code-font-size,11px)] [&_pre]:leading-[var(--code-line-height,1.28)] [&_code]:text-(--fvp-reader-text)">
      <div className="fvp-file-markdown-codeblock-label flex items-center justify-between gap-3 pt-[7px] pb-1.5 px-3 border-b border-b-(--fvp-markdown-rule) text-[10px] tracking-[0.08em] uppercase text-(--fvp-reader-faint) bg-[color-mix(in_srgb,var(--surface-control)_58%,transparent)]">
        <span>Mermaid</span>
        <div className="fvp-file-markdown-mermaid-tabs inline-flex items-center gap-1" role="tablist" aria-label="Mermaid block view">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "source"}
            className={`fvp-file-markdown-mermaid-tab border-0 rounded-full py-1 px-2 text-[10px] tracking-[0.08em] uppercase cursor-pointer focus-visible:outline focus-visible:outline-(--text-accent) focus-visible:outline-1 focus-visible:outline-offset-[1px] ${activeTab === "source" ? "is-active text-(--text-stronger) bg-[color-mix(in_srgb,var(--surface-control)_76%,#79a6ff_10%)]" : "text-(--fvp-reader-faint) bg-transparent hover:text-(--text-stronger) hover:bg-[color-mix(in_srgb,var(--surface-hover)_72%,transparent)]"}`}
            onClick={() => setActiveTab("source")}
          >
            Source
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "render"}
            className={`fvp-file-markdown-mermaid-tab border-0 rounded-full py-1 px-2 text-[10px] tracking-[0.08em] uppercase cursor-pointer focus-visible:outline focus-visible:outline-(--text-accent) focus-visible:outline-1 focus-visible:outline-offset-[1px] ${activeTab === "render" ? "is-active text-(--text-stronger) bg-[color-mix(in_srgb,var(--surface-control)_76%,#79a6ff_10%)]" : "text-(--fvp-reader-faint) bg-transparent hover:text-(--text-stronger) hover:bg-[color-mix(in_srgb,var(--surface-hover)_72%,transparent)]"}`}
            onClick={() => setActiveTab("render")}
          >
            Render
          </button>
        </div>
      </div>

      {activeTab === "source" ? (
        <pre>
          <code
            className={className}
            dangerouslySetInnerHTML={{ __html: highlightedHtml }}
          />
        </pre>
      ) : renderState.status === "success" ? (
        <div
          className="fvp-file-markdown-mermaid-diagram p-3.5 overflow-auto [&_svg]:block [&_svg]:max-w-full [&_svg]:h-auto"
          data-testid="file-markdown-mermaid-preview"
          dangerouslySetInnerHTML={{ __html: renderState.svg }}
        />
      ) : renderState.status === "error" ? (
        <div className="fvp-file-markdown-mermaid-status fvp-file-markdown-mermaid-error p-3.5 text-[var(--color-danger-strong,#ef4444)] text-[12px]">
          Render failed: {renderState.message}
        </div>
      ) : (
        <div className="fvp-file-markdown-mermaid-status p-3.5 text-(--fvp-reader-muted) text-[12px]">
          Rendering diagram...
        </div>
      )}
    </div>
  );
}

export function FileMarkdownPreview({
  value,
  className = "fvp-file-markdown",
  onAnnotationStart,
  annotationDraft = null,
  annotations = [],
  renderAnnotationDraft,
  renderAnnotationMarker,
  annotationActionLabel = "Annotate",
}: FileMarkdownPreviewProps) {
  const frontmatter = useMemo(() => extractFrontmatter(value), [value]);
  const rehypePlugins = useMemo(
    () => [
      rehypeRaw,
      [rehypeSanitize, {
        ...defaultSchema,
        tagNames: [
          ...(defaultSchema.tagNames ?? []),
          "details",
          "summary",
          "abbr",
          "mark",
          "ins",
          "del",
          "sub",
          "sup",
          "kbd",
          "var",
          "samp",
        ],
        attributes: {
          ...defaultSchema.attributes,
          "*": [...(defaultSchema.attributes?.["*"] ?? []), "className", "class"],
        },
      }],
    ] as Parameters<typeof ReactMarkdown>[0]["rehypePlugins"],
    [],
  );

  const handleAnchorClick = useCallback((event: MouseEvent, href?: string) => {
    if (!href) {
      return;
    }
    const isExternal =
      href.startsWith("http://") ||
      href.startsWith("https://") ||
      href.startsWith("mailto:");
    if (!isExternal) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    void openUrl(href);
  }, []);

  const renderAnnotatableBlock = useCallback((
    tagName: AnnotatableBlockTag,
    node: MarkdownPositionTreeNode,
    children: ReactNode,
    props?: Record<string, unknown>,
  ) => {
    const lineRange = resolveMarkdownNodeLineRange(node, frontmatter.bodyStartLine);
    const content = createElement(tagName, props, children);
    if (!lineRange) {
      return content;
    }
    return (
      <MarkdownAnnotatableBlock
        lineRange={lineRange}
        node={node}
        bodyStartLine={frontmatter.bodyStartLine}
        onAnnotationStart={onAnnotationStart}
        annotationDraft={annotationDraft}
        annotations={annotations}
        renderAnnotationDraft={renderAnnotationDraft}
        renderAnnotationMarker={renderAnnotationMarker}
        annotationActionLabel={annotationActionLabel}
      >
        {content}
      </MarkdownAnnotatableBlock>
    );
  }, [
    annotationActionLabel,
    annotationDraft,
    annotations,
    frontmatter.bodyStartLine,
    onAnnotationStart,
    renderAnnotationDraft,
    renderAnnotationMarker,
  ]);

  const components = useMemo<Components>(() => ({
    a: ({ href, children }) => (
      <a href={href} onClick={(event) => handleAnchorClick(event, href)}>
        {children}
      </a>
    ),
    blockquote: ({ node, children }) => renderAnnotatableBlock("blockquote", node, children),
    h1: ({ node, children }) => renderAnnotatableBlock("h1", node, children),
    h2: ({ node, children }) => renderAnnotatableBlock("h2", node, children),
    h3: ({ node, children }) => renderAnnotatableBlock("h3", node, children),
    h4: ({ node, children }) => renderAnnotatableBlock("h4", node, children),
    h5: ({ node, children }) => renderAnnotatableBlock("h5", node, children),
    h6: ({ node, children }) => renderAnnotatableBlock("h6", node, children),
    ol: ({ node, children }) => renderAnnotatableBlock("ol", node, children),
    p: ({ node, children }) => renderAnnotatableBlock("p", node, children),
    ul: ({ node, children }) => renderAnnotatableBlock("ul", node, children),
    table: ({ node, children }) => renderAnnotatableBlock(
      "div",
      node,
      <table>{children}</table>,
      { className: "fvp-file-markdown-table-wrap block overflow-x-auto max-w-full mb-4 mt-0 mx-0 border border-(--fvp-markdown-rule) rounded-xl bg-[color-mix(in_srgb,var(--surface-card)_90%,transparent)]" },
    ),
    pre: ({ node, children }) => {
      const { className: codeClassName, value: codeValue } = extractCodeFromPre(
        node as PreviewPreNode,
      );
      if (!codeClassName && !codeValue) {
        return renderAnnotatableBlock("div", node, <pre>{children}</pre>);
      }
      if (extractLanguageTag(codeClassName) === "mermaid") {
        return renderAnnotatableBlock(
          "div",
          node,
          <FileMarkdownMermaidBlock
            className={codeClassName}
            value={codeValue}
          />,
        );
      }
      return renderAnnotatableBlock(
        "div",
        node,
        <FileMarkdownCodeBlock
          className={codeClassName}
          value={codeValue}
        />,
      );
    },
  }), [handleAnchorClick, renderAnnotatableBlock]);

  return (
    <div className={className} data-testid="file-markdown-preview">
      {frontmatter.fields.length > 0 ? (
        <section className="fvp-file-markdown-frontmatter mb-4 py-2.5 px-3 border border-(--fvp-markdown-rule) rounded-[10px] bg-[color-mix(in_srgb,var(--surface-card)_92%,#5fa3ff_4%)]" data-testid="file-markdown-frontmatter">
          <div className="fvp-file-markdown-frontmatter-label mb-2 text-[10px] tracking-[0.06em] uppercase text-(--fvp-reader-faint)">Metadata</div>
          <dl className="fvp-file-markdown-frontmatter-grid grid gap-1.5 m-0">
            {frontmatter.fields.map((field) => (
              <div key={field.key} className="fvp-file-markdown-frontmatter-row grid grid-cols-[minmax(82px,108px)_minmax(0,1fr)] gap-2.5 items-baseline leading-[1.35] [&_dt]:m-0 [&_dt]:text-(--fvp-reader-faint) [&_dt]:text-[11px] [&_dt]:lowercase [&_dd]:m-0 [&_dd]:text-(--fvp-reader-text) [&_dd]:font-medium [&_dd]:text-[13px] [&_dd]:break-words">
                <dt>{field.key}</dt>
                <dd>{field.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {frontmatter.body}
      </ReactMarkdown>
    </div>
  );
}
