import { isValidElement, memo, useEffect, useMemo, useState, type ComponentProps, type ReactNode } from "react";
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
import { createCachedHighlighter } from "./cached-highlight";
import { openExternal } from "@/lib/platform";
import { useTranslation } from "react-i18next";
import Copy from "lucide-react/dist/esm/icons/copy";
import Check from "lucide-react/dist/esm/icons/check";
import { useFilesStore } from "@/features/files/store";
import { markdownRegistry, useRegistry } from "@ccgui/plugin-sdk";
import { useCopied } from "@/hooks/use-copied";
import { FileLinkContextMenu } from "./FileLinkContextMenu";
import { ipc } from "@/lib/ipc";
import { readRemoteAware } from "@/features/files/remote-files";
import { isPathUnder, resolveChatFileLink } from "@/features/chat/file-link-resolution";
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

function openFileFromChat(rawPath: string, workspacePath: string) {
  // Async on purpose: a path that only exists nested below the workspace
  // root (outer folder opened as workspace) is found through the index
  // fallback instead of dead-ending in a not-found tab.
  void resolveChatFileLink(rawPath, workspacePath).then((path) => {
    if (!path) return;
    // Opens as a center-area tab; visible at every window width.
    void useFilesStore.getState().openFile(path);
  });
}

function openExternalUrl(url: string) {
  openExternal(url);
}

const SAFE_DATA_IMAGE_URL = /^data:image\/(?:apng|avif|bmp|gif|jpeg|png|webp|x-icon);base64,/i;

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
  const imageSource = src ?? "";
  const directImage = /^https?:/i.test(imageSource) || SAFE_DATA_IMAGE_URL.test(imageSource);
  const [resolvedSource, setResolvedSource] = useState<string | null>();

  useEffect(() => {
    if (!imageSource || directImage) return;
    let cancelled = false;
    setResolvedSource(undefined);
    void resolveChatFileLink(imageSource, workspacePath)
      .then((path) => {
        if (!path || !isPathUnder(path, workspacePath)) return null;
        return readRemoteAware(path, (localPath) => ipc.readFile(localPath));
      })
      .then((content) => {
        if (!cancelled) {
          setResolvedSource(content?.kind === "image" ? content.dataUrl : null);
        }
      })
      .catch(() => {
        if (!cancelled) setResolvedSource(null);
      });
    return () => {
      cancelled = true;
    };
  }, [imageSource, workspacePath, directImage]);

  const imageUrl = directImage ? imageSource : resolvedSource;
  if (typeof imageUrl !== "string" || !imageUrl) {
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
          openFileFromChat(path, workspacePath);
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
  const cachedHighlight = useMemo(() => createCachedHighlighter(undefined, {
    entries: contributions.some(c => c.rehypePlugins?.length) ? 0 : 32,
    characters: 256_000,
  }), [contributions]);
  // Historical rows need no reveal spans/subscriptions. Once a live row uses
  // them, retain its DOM shape on settle so selection does not jump.
  const [revealEnabled, setRevealEnabled] = useState(streaming);
  if (streaming && !revealEnabled) setRevealEnabled(true);
  // `\[...\]` / `\(...\)` become the `$` delimiters remark-math knows, and
  // nested `$...$` inside box commands (e.g. `\colorbox{yellow}{$x$}`) must
  // not end remark-math's span early; the prepared text feeds both the plan
  // and the renderer so reveal offsets stay aligned with the DOM.
  const mathText = useMemo(() => prepareMathText(text), [text]);
  const plan = useMemo(createRevealPlan, [mathText, contributions]);
  // Show already-received text on mount (including virtualizer remounts);
  // smooth only subsequent arrivals, never replay a paragraph from empty.
  const controller = useLiveReveal(plan, streaming);
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
        ...(revealEnabled ? [plan.plugin] : []),
      ] as PluginListProp,
    [contributions, cachedHighlight, streaming, revealEnabled, plan],
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
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
        urlTransform={(url) => {
          // file: is deliberately excluded: model output must not smuggle in
          // local-file URLs. Workspace image paths use MarkdownImage's scoped reader.
          if (isFileLinkUrl(url) || SAFE_DATA_IMAGE_URL.test(url)) return url;
          if (/^(https?|mailto):/i.test(url)) return url;
          // Anything without a scheme is a relative reference ("#anchor",
          // "/abs", "./rel" or a bare "dir/file.png"). Scheme-bearing URLs
          // (file:, javascript:, vbscript:, …) stay blanked.
          if (!/^[A-Za-z][A-Za-z0-9+.-]*:/.test(url)) return url;
          return "";
        }}
      >
        {mathText}
      </ReactMarkdown>
    </div>
  );
});
