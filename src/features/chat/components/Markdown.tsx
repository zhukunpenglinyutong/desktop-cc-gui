import {
  isValidElement,
  memo,
  startTransition,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { remarkDisplayMath } from "./remark-display-math";
import { isAlertClassName, remarkGithubAlerts } from "./remark-github-alerts";
import { AlertTitle } from "./github-alerts";
import {
  prepareMathText,
  restoreMathDollars,
} from "./math-delimiters";
import { RevealText } from "./reveal-text";
import { useLiveReveal } from "./use-live-reveal";
import { createRevealPlan } from "./reveal-plan";
import { createCachedHighlighter, sharedCachedHighlighter } from "./cached-highlight";
import { splitMarkdown } from "./markdown-chunks";
import { openExternal } from "@/lib/platform";
import { useTranslation } from "react-i18next";
import Copy from "lucide-react/dist/esm/icons/copy";
import Check from "lucide-react/dist/esm/icons/check";
import { useCopied } from "@/hooks/use-copied";
import { markdownRegistry, useRegistry } from "@ccgui/plugin-sdk";
import { FileLinkContextMenu } from "./FileLinkContextMenu";
import {
  imageCacheKey,
  isDirectImageSource,
  loadMarkdownImage,
  markdownImageCache,
} from "./markdown-image-source";
import { transformMarkdownUrl } from "./markdown-url";
import { openChatFilePath } from "@/features/chat/open-chat-file";
import {
  decodeFileLink,
  isFileLinkUrl,
  isLinkableFilePath,
  resolveFilePath,
  toFileLink,
} from "@/lib/fileLinks";

const REMARK_PLUGINS = [remarkGfm, remarkMath, remarkDisplayMath, remarkGithubAlerts];
/** ReactMarkdown's plugin-list prop type, derived here instead of importing
 * `PluggableList` from unified (a transitive dep we don't declare). */
type PluginListProp = NonNullable<
  ComponentProps<typeof ReactMarkdown>["remarkPlugins"]
>;

/** Above this size a single ReactMarkdown tree is split into independent
 *  ~8k-char chunk trees: live streaming only re-parses the growing tail chunk
 *  (earlier memoized chunks stay untouched), and settled historical replies
 *  mount their chunks progressively across frames. */
const PROGRESSIVE_MARKDOWN_FROM = 16_000;

/** Let the plain snapshot paint before the transition starts parsing. */
function afterPaint(callback: () => void): () => void {
  if (typeof requestAnimationFrame === "function") {
    const id = requestAnimationFrame(callback);
    return () => cancelAnimationFrame(id);
  }
  const id = setTimeout(callback, 0);
  return () => clearTimeout(id);
}

function openExternalUrl(url: string) {
  openExternal(url);
}

function MarkdownImage({
  src,
  alt = "",
  title,
  workspacePath,
}: {
  src?: string;
  alt?: string;
  title?: string;
  workspacePath: string;
}) {
  const source = src ?? "";
  const direct = isDirectImageSource(source);
  const key = imageCacheKey(source, workspacePath);
  // Keyed by source so a changed src never shows the previous image.
  const [loaded, setLoaded] = useState<{ key: string; url: string | null } | null>(null);

  useEffect(() => {
    if (!source || direct) return;
    let cancelled = false;
    void loadMarkdownImage(source, workspacePath).then((image) => {
      if (!cancelled) setLoaded({ key, url: image?.dataUrl ?? null });
    });
    return () => {
      cancelled = true;
    };
  }, [source, workspacePath, direct, key]);

  // A remount (virtualizer scroll back) paints the cached copy at once while
  // the effect checks the file is unchanged.
  const imageUrl = direct
    ? source
    : loaded?.key === key
      ? loaded.url
      : markdownImageCache.peek(key)?.dataUrl ?? null;
  if (!imageUrl) {
    return alt ? <span className="md-image-fallback">{alt}</span> : null;
  }
  return <img src={imageUrl} alt={alt} title={title} className="md-image" loading="lazy" />;
}

/** Green dotted-underline file link (parity with desktop-cc-gui). */
function FileLink({
  href,
  path,
  workspacePath,
  children,
}: {
  href: string;
  path: string;
  workspacePath: string;
  children: ReactNode;
}) {
  const resolved = resolveFilePath(path, workspacePath);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  return (
    <>
      <a
        className="md-file-link"
        href={href}
        title={resolved ?? path}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          openChatFilePath(path, workspacePath);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setMenu({ x: event.clientX, y: event.clientY });
        }}
      >
        {children}
      </a>
      {menu && (
        <FileLinkContextMenu
          menu={{ ...menu, path, resolvedPath: resolved, workspacePath }}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}

/** One independently parsed slice of a large document. Memoized so the
 *  transition that mounts later slices never re-parses earlier ones. */
const MarkdownChunk = memo(function MarkdownChunk({
  text,
  remarkPlugins,
  rehypePlugins,
  components,
}: {
  text: string;
  remarkPlugins: PluginListProp;
  rehypePlugins: PluginListProp;
  components: Components;
}) {
  return (
    <div className="md-chunk">
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
        urlTransform={transformMarkdownUrl}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});

/** Pull the raw text out of a rendered <code> node (hljs wraps tokens in
 * spans, so children is a tree, not a string). */
function extractText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (isValidElement(node)) return extractText(node.props.children);
  return "";
}

/** shadcn-style code block card: language header + copy button, theme-aware
 * muted surface. Single-line fences render compact with a floating copy. */
function CodeBlock({ children }: { children?: ReactNode }) {
  const { t } = useTranslation();
  const { copied, copy } = useCopied();

  const codeProps = isValidElement(children) ? children.props : undefined;
  const language = /language-([\w+-]+)/.exec(codeProps?.className ?? "")?.[1] ?? null;
  const value = extractText(codeProps?.children).replace(/\n$/, "");

  const copyButton = (
    <button
      type="button"
      className="md-codeblock-copy"
      aria-label={copied ? t("common.copied") : t("chat.copy")}
      title={copied ? t("common.copied") : t("chat.copy")}
      onClick={() => copy(value)}
    >
      {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
    </button>
  );

  if (!value.includes("\n")) {
    return (
      <div className="md-codeblock-single-wrap">
        <div className="md-codeblock-single-actions">{copyButton}</div>
        <pre className="md-codeblock-single">{children}</pre>
      </div>
    );
  }

  return (
    <div className="md-codeblock">
      <div className="md-codeblock-header">
        <span className="md-codeblock-language">{(language ?? "text").toUpperCase()}</span>
        {copyButton}
      </div>
      <pre>{children}</pre>
    </div>
  );
}

export default memo(function Markdown({
  text,
  workspacePath,
  streaming = false,
}: {
  text: string;
  workspacePath: string;
  streaming?: boolean;
}) {
  const contributions = useRegistry(markdownRegistry);
  // External rehype plugins may mutate highlighted nodes in place. Avoid
  // sharing cached subtrees with that pipeline so mutations cannot accumulate.
  const hasExternalRehype = contributions.some((c) => c.rehypePlugins?.length);
  const cachedHighlight = useMemo(
    () =>
      hasExternalRehype
        ? createCachedHighlighter(undefined, { entries: 0, characters: 0 })
        : sharedCachedHighlighter,
    [hasExternalRehype],
  );
  // Historical rows need no reveal spans/subscriptions. Once a live row uses
  // them, retain its DOM shape on settle so selection does not jump.
  const [revealEnabled, setRevealEnabled] = useState(streaming);
  if (streaming && !revealEnabled) setRevealEnabled(true);
  // `\[...\]` / `\(...\)` become the `$` delimiters remark-math knows, and
  // nested `$...$` inside box commands (e.g. `\colorbox{yellow}{$x$}`) must
  // not end remark-math's span early; the prepared text feeds both the plan
  // and the renderer so reveal offsets stay aligned with the DOM.
  const mathText = useMemo(() => prepareMathText(text), [text]);
  const large = text.length > PROGRESSIVE_MARKDOWN_FROM;
  // Above 16k chars, split into independent ~8k-char chunks. During live
  // streaming all chunks stay mounted as rich Markdown so the user never sees
  // formatted text collapse into raw plain text, while `MarkdownChunk` memo
  // keeps settled prefix chunks from re-parsing on each tail flush. For
  // settled historical mounts, paint plain-text placeholders first and mount
  // chunks a couple per frame so opening a huge session never blocks input.
  const chunks = useMemo(
    () => (large ? splitMarkdown(mathText) : []),
    [large, mathText],
  );
  const [markdownReadyFor, setMarkdownReadyFor] = useState<string | null>(null);
  const [visibleChunks, setVisibleChunks] = useState(0);
  useEffect(() => {
    if (!large || streaming || revealEnabled) return;
    let cancelled = false;
    const cancel = afterPaint(() => {
      if (cancelled) return;
      startTransition(() => {
        setVisibleChunks(1);
        setMarkdownReadyFor(mathText);
      });
    });
    return () => {
      cancelled = true;
      cancel();
    };
  }, [large, streaming, revealEnabled, mathText]);
  const showMarkdown = !large || streaming || revealEnabled || markdownReadyFor === mathText;
  const mountedChunks = streaming || revealEnabled ? chunks.length : visibleChunks;
  useEffect(() => {
    if (streaming || revealEnabled || !showMarkdown || !large || visibleChunks === 0 || visibleChunks >= chunks.length) {
      return;
    }
    let cancelled = false;
    let frame = 0;
    const schedule = (callback: () => void) => {
      if (typeof requestAnimationFrame === "function") {
        frame = requestAnimationFrame(callback);
      } else {
        frame = window.setTimeout(callback, 16);
      }
    };
    const cancel = () => {
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
      else window.clearTimeout(frame);
    };
    const step = () => {
      schedule(() => {
        if (cancelled) return;
        setVisibleChunks((count) => Math.min(count + 2, chunks.length));
        step();
      });
    };
    step();
    return () => {
      cancelled = true;
      cancel();
    };
  }, [streaming, revealEnabled, showMarkdown, large, visibleChunks, chunks.length]);
  // Reveal spans animate a growing document in place. Splitting would lose
  // the character offsets, so large documents publish complete text instead.
  const reveal = revealEnabled && !large;
  const plan = useMemo(createRevealPlan, [mathText, contributions]);
  // Show already-received text on mount (including virtualizer remounts);
  // smooth only subsequent arrivals, never replay a paragraph from empty.
  const controller = useLiveReveal(plan, streaming && reveal);
  // Stable components map: a new reference makes ReactMarkdown discard its
  // HAST tree and re-parse the whole document.
  const hostComponents = useMemo<Components>(
    () => ({
      span: ({ node, className, children, ...rest }) => {
        const start = node?.properties.dataStreamStart;
        // Forward every other prop (style, aria-hidden, ...): KaTeX positions
        // superscripts, fractions and radicals with inline styles like
        // `style="top:-3.06em"` on bare spans — dropping them collapses the
        // whole formula onto the baseline with overlapping glyphs.
        return typeof start === "number" && typeof children === "string"
          ? <RevealText controller={controller} start={start}>{children}</RevealText>
          : <span className={className} {...rest}>{children}</span>;
      },
      img: ({ src, alt, title }) => (
        <MarkdownImage src={src} alt={alt} title={title} workspacePath={workspacePath} />
      ),
      a: ({ href, children }) => {
        const url = href ?? "";
        if (isFileLinkUrl(url)) {
          return (
            <FileLink href={url} path={decodeFileLink(url)} workspacePath={workspacePath}>
              {children}
            </FileLink>
          );
        }
        if (/^(https?:|mailto:)/.test(url)) {
          return (
            <a
              href={url}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                openExternalUrl(url);
              }}
            >
              {children}
            </a>
          );
        }
        // A relative/absolute link target that is itself a file path.
        if (url && isLinkableFilePath(url)) {
          return (
            <FileLink href={url} path={url} workspacePath={workspacePath}>
              {children}
            </FileLink>
          );
        }
        // Unrecognized or blocked scheme (blanked by urlTransform, file:,
        // in-page "#" which would hit HashRouter, ...): render the label as
        // plain text, never a navigable anchor.
        return <span>{children}</span>;
      },
      code: ({ className, children }) => {
        // Block code (inside <pre>) carries the hljs class — leave it alone.
        if (className) return <code className={className}>{children}</code>;
        const value = extractText(children).trim();
        if (!value || !isLinkableFilePath(value)) return <code>{children}</code>;
        return (
          <FileLink href={toFileLink(value)} path={value} workspacePath={workspacePath}>
            <code>{children}</code>
          </FileLink>
        );
      },
      pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
      // GitHub-style alert (`> [!NOTE]` …): the remark plugin stamps the
      // className onto the blockquote; a plain quote keeps the flattened
      // Codex-style flow.
      blockquote: ({ node, children }) => {
        const alertType = isAlertClassName(node?.properties?.className);
        return alertType ? (
          <blockquote className={`md-alert md-alert-${alertType}`}>
            <AlertTitle type={alertType} />
            {children}
          </blockquote>
        ) : (
          <blockquote>{children}</blockquote>
        );
      },
    }),
    [workspacePath, controller],
  );
  // Plugin pipeline contributions (plan §4.2 #5): host defaults first, then
  // each plugin's in registration order. Plugin halves arrive as `unknown[]`
  // — blob bundles can't share the host's unified/react-markdown type
  // identities — so the merged lists are asserted back to ReactMarkdown's
  // prop type once, here at the boundary.
  const remarkPlugins = useMemo(
    () =>
      [
        ...REMARK_PLUGINS,
        ...contributions.flatMap((c) => c.remarkPlugins ?? []),
      ] as PluginListProp,
    [contributions],
  );
  const chunkRehypePlugins = useMemo(
    () =>
      [
        restoreMathDollars,
        rehypeKatex,
        [cachedHighlight, { streaming: false }],
        ...contributions.flatMap((c) => c.rehypePlugins ?? []),
      ] as PluginListProp,
    [contributions, cachedHighlight],
  );
  const rehypePlugins = useMemo(
    () =>
      [
        // Math first: a display formula arrives as a code block
        // (`language-math`), and the highlighter below would otherwise try to
        // syntax-highlight the TeX as if it were source code. The dollar
        // restore runs before KaTeX so nested `$...$` reaches the renderer.
        restoreMathDollars,
        rehypeKatex,
        [cachedHighlight, { streaming }],
        ...contributions.flatMap((c) => c.rehypePlugins ?? []),
        ...(reveal ? [plan.plugin] : []),
      ] as PluginListProp,
    [contributions, cachedHighlight, streaming, reveal, plan],
  );
  // Later wins: plugin component overrides may intentionally shadow host
  // keys, and later registrations shadow earlier ones.
  const components = useMemo<Components>(() => {
    let merged = hostComponents;
    for (const contrib of contributions) {
      if (contrib.components) merged = { ...merged, ...contrib.components };
    }
    return merged;
  }, [hostComponents, contributions]);

  return (
    <div className="prose-chat text-body-regular text-text-primary">
      {!showMarkdown ? (
        <div className="whitespace-pre-wrap [overflow-wrap:anywhere]">{text}</div>
      ) : large ? (
        chunks.map((chunk, index) => {
          const isGrowingTail = streaming && index === chunks.length - 1;
          return index < mountedChunks ? (
            <MarkdownChunk
              key={chunk.start}
              text={chunk.text}
              remarkPlugins={remarkPlugins}
              rehypePlugins={isGrowingTail ? rehypePlugins : chunkRehypePlugins}
              components={components}
            />
          ) : (
            <div className="md-chunk" key={chunk.start} aria-busy="true">
              <div className="whitespace-pre-wrap [overflow-wrap:anywhere]">{chunk.text}</div>
            </div>
          );
        })
      ) : (
        <ReactMarkdown
          remarkPlugins={remarkPlugins}
          rehypePlugins={rehypePlugins}
          components={components}
          urlTransform={transformMarkdownUrl}
        >
          {mathText}
        </ReactMarkdown>
      )}
    </div>
  );
});
