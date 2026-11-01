import {
  memo,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Streamdown, type Components, type StreamdownTranslations } from "streamdown";
import type { ImgHTMLAttributes, AnchorHTMLAttributes } from "react";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import { cjk } from "@streamdown/cjk";
import "katex/dist/katex.min.css";
import { registerShortcutHandler } from "@/features/shortcuts/runtime";
import { FindOnlyPanel } from "@/components/base/find-panel/find-only-panel";
import { useFilesStore } from "@/features/files/store";
import { fileUrl, openExternal } from "@/lib/platform";
import {
  clearMarkdownSearchHighlights,
  findMarkdownMatches,
  paintMarkdownSearchHighlights,
  scrollRangeIntoView,
} from "./markdown-search";

// Plugins are stateless singletons; a module-level reference keeps the
// Streamdown `plugins` prop stable across renders.
const PLUGINS = { code, math, mermaid, cjk };
// External links are handed to the OS browser by the `a` override below;
// Streamdown's link-safety modal would be a second, redundant gate.
const LINK_SAFETY = { enabled: false };

const BROWSER_LOADABLE_SRC_RE = /^(?:https?:|data:|blob:|asset:)/i;

/** 预览正文内的链接样式（index.css 的 .md-preview-link）：沿用聊天
 *  Markdown 的绿色点状下划线，深浅色随语义 token 翻转。Streamdown 只在
 *  自己的 link 组件上写类名，组件被替换后会丢——这里显式带上。 */
const LINK_CLASS = "md-preview-link";

function normalizePathSegments(path: string): string {
  const isAbsolute = /^([a-zA-Z]:[\\/]|\/|\\\\)/.test(path);
  const segments = path.split(/[\\/]+/);
  const out: string[] = [];
  for (const seg of segments) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (out.length > 0 && out[out.length - 1] !== "..") out.pop();
      else if (!isAbsolute) out.push("..");
      continue;
    }
    out.push(seg);
  }
  const joined = out.join("/");
  if (isAbsolute) {
    const prefix = /^[a-zA-Z]:/.test(path) ? "" : "/";
    return prefix + joined;
  }
  return joined;
}

/** Local relative image src → absolute path next to the markdown file. */
function resolveMarkdownImageSrc(src: string, sourceFilePath: string): string {
  let cleaned: string;
  try {
    cleaned = decodeURIComponent(src);
  } catch {
    cleaned = src;
  }
  if (BROWSER_LOADABLE_SRC_RE.test(cleaned)) return cleaned;
  if (!/\.(?:apng|avif|bmp|gif|jpe?g|png|svg|webp)(?:[?#].*)?$/i.test(cleaned)) {
    return cleaned;
  }
  const pathOnly = cleaned.replace(/[?#].*$/, "");
  if (/^([a-zA-Z]:[\\/]|\/|\\\\)/.test(pathOnly)) {
    return fileUrl(normalizePathSegments(pathOnly));
  }
  const sepIdx = Math.max(
    sourceFilePath.lastIndexOf("/"),
    sourceFilePath.lastIndexOf("\\"),
  );
  if (sepIdx <= 0) return cleaned;
  try {
    return fileUrl(
      normalizePathSegments(`${sourceFilePath.slice(0, sepIdx)}/${pathOnly}`),
    );
  } catch {
    return cleaned;
  }
}

/** Relative link target (`./docs/x.md`, `../a.png`) → absolute path next to
 *  the markdown file; null when the href is a URL / scheme / anchor / a
 *  directory, none of which may be handed to the file editor. */
function resolveMarkdownLinkPath(
  href: string,
  sourceFilePath: string,
): string | null {
  let cleaned: string;
  try {
    cleaned = decodeURIComponent(href);
  } catch {
    cleaned = href;
  }
  if (!cleaned || cleaned.startsWith("#")) return null;
  // Any scheme (http:, https:, mailto:, file:, data:, …) stays out of the
  // file-open path; http(s)/mailto are handled before this call.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(cleaned)) return null;
  const pathOnly = cleaned.replace(/[?#].*$/, "");
  if (!pathOnly) return null;
  // Directory links (`./docs/`) and extension-less segments are not files.
  const lastSegment = pathOnly.split(/[\\/]/).filter(Boolean).pop() ?? "";
  if (!lastSegment.includes(".")) return null;
  if (/^([a-zA-Z]:[\\/]|\/|\\\\)/.test(pathOnly)) {
    return normalizePathSegments(pathOnly);
  }
  const sepIdx = Math.max(
    sourceFilePath.lastIndexOf("/"),
    sourceFilePath.lastIndexOf("\\"),
  );
  if (sepIdx <= 0) return null;
  try {
    return normalizePathSegments(`${sourceFilePath.slice(0, sepIdx)}/${pathOnly}`);
  } catch {
    return null;
  }
}

/** The parsed document, isolated behind memo: opening/closing the find bar or
 *  typing in it must not re-parse the markdown. */
const MarkdownDocument = memo(function MarkdownDocument({
  draft,
  components,
  translations,
}: {
  draft: string;
  components: Components;
  translations: Partial<StreamdownTranslations>;
}) {
  return (
    <Streamdown
      mode="static"
      plugins={PLUGINS}
      components={components}
      translations={translations}
      linkSafety={LINK_SAFETY}
    >
      {draft}
    </Streamdown>
  );
});

export function MarkdownPreview({
  path,
  draft,
  active = true,
  searchOpen = false,
  onSearchOpenChange,
  bindSearchShortcut = false,
}: {
  path: string;
  draft: string;
  /** Whether this preview is the visible surface. Kept so find highlights
   *  repaint when the tab comes back into view; standalone callers default
   *  to true. */
  active?: boolean;
  /** Controlled find-bar visibility. Omit (dialogs) for a preview without
   *  search affordances. */
  searchOpen?: boolean;
  onSearchOpenChange?: (open: boolean) => void;
  /** Register the shared ⌘F shortcut while this preview is the visible file
   *  tab. Dialogs leave it off so they don't steal the key. */
  bindSearchShortcut?: boolean;
}) {
  const { t } = useTranslation();
  // Preview parses a deferred copy of the draft: re-parsing the whole
  // document per keystroke would jank typing.
  const deferredDraft = useDeferredValue(draft);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [matchCount, setMatchCount] = useState(0);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const rangesRef = useRef<Range[]>([]);
  // Highlights live in a global registry: only clear them when this preview
  // actually painted, so a hidden/new preview can't wipe a sibling's search.
  const paintedRef = useRef(false);

  const components = useMemo<Components>(
    () => ({
      // Local relative image paths must resolve next to the markdown file;
      // Streamdown's default <img> would pass the raw relative src through.
      img: (props: ImgHTMLAttributes<HTMLImageElement>) => (
        <img
          {...props}
          src={props.src ? resolveMarkdownImageSrc(String(props.src), path) : props.src}
          className="max-w-full"
        />
      ),
      a: ({
        node: _node,
        className: _className,
        href,
        children,
        ...rest
      }: AnchorHTMLAttributes<HTMLAnchorElement> & { node?: unknown }) => {
        const url = href ?? "";
        if (/^https?:/i.test(url) || /^mailto:/i.test(url)) {
          return (
            <a
              {...rest}
              className={LINK_CLASS}
              href={url}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                openExternal(url);
              }}
            >
              {children}
            </a>
          );
        }
        // Relative/absolute file targets open as editor tabs (resolved next
        // to the markdown file). Letting the webview navigate instead would
        // replace the app shell.
        const localPath = resolveMarkdownLinkPath(url, path);
        if (localPath) {
          return (
            <a
              {...rest}
              className={LINK_CLASS}
              href={url}
              title={localPath}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void useFilesStore.getState().openFile(localPath);
              }}
            >
              {children}
            </a>
          );
        }
        // In-page anchors and unrecognized schemes stay inert text — same
        // policy as chat markdown (a "#" href would hit HashRouter).
        return <span>{children}</span>;
      },
    }),
    [path],
  );
  const translations = useMemo<Partial<StreamdownTranslations>>(
    () => ({
      close: t("files.markdown.close"),
      copied: t("files.markdown.copied"),
      copyCode: t("files.markdown.copyCode"),
      copyTable: t("files.markdown.copyTable"),
      copyTableAsCsv: t("files.markdown.copyTableAsCsv"),
      copyTableAsMarkdown: t("files.markdown.copyTableAsMarkdown"),
      copyTableAsTsv: t("files.markdown.copyTableAsTsv"),
      downloadDiagram: t("files.markdown.downloadDiagram"),
      downloadDiagramAsMmd: t("files.markdown.downloadDiagramAsMmd"),
      downloadDiagramAsPng: t("files.markdown.downloadDiagramAsPng"),
      downloadDiagramAsSvg: t("files.markdown.downloadDiagramAsSvg"),
      downloadFile: t("files.markdown.downloadFile"),
      downloadImage: t("files.markdown.downloadImage"),
      downloadTable: t("files.markdown.downloadTable"),
      downloadTableAsCsv: t("files.markdown.downloadTableAsCsv"),
      downloadTableAsMarkdown: t("files.markdown.downloadTableAsMarkdown"),
      exitFullscreen: t("files.markdown.exitFullscreen"),
      imageNotAvailable: t("files.markdown.imageNotAvailable"),
      resetView: t("files.markdown.resetView"),
      viewFullscreen: t("files.markdown.viewFullscreen"),
      zoomIn: t("files.markdown.zoomIn"),
      zoomOut: t("files.markdown.zoomOut"),
    }),
    [t],
  );

  // ⌘F toggles the find bar (the shared "chatSearch" action is the one
  // content-search binding). Only the visible file tab registers, so the key
  // never opens a search bar on an invisible preview.
  const searchOpenRef = useRef(searchOpen);
  useEffect(() => {
    searchOpenRef.current = searchOpen;
  }, [searchOpen]);
  useEffect(() => {
    if (!bindSearchShortcut || !onSearchOpenChange) return;
    return registerShortcutHandler("chatSearch", () => {
      onSearchOpenChange(!searchOpenRef.current);
    });
  }, [bindSearchShortcut, onSearchOpenChange]);
  useEffect(() => {
    if (!searchOpen) return;
    const raf = requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    });
    return () => cancelAnimationFrame(raf);
  }, [searchOpen]);

  // Recompute matches on query/content/cursor changes; the MutationObserver
  // picks up content Streamdown renders late (mermaid diagrams, lazy nodes)
  // so those join the match set too. rAF coalesces bursts.
  useEffect(() => {
    const root = contentRef.current;
    if (!searchOpen || !active || !root || !query.trim()) {
      rangesRef.current = [];
      setMatchCount(0);
      if (paintedRef.current) {
        paintedRef.current = false;
        clearMarkdownSearchHighlights();
      }
      return;
    }
    let raf = 0;
    const refresh = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const ranges = findMarkdownMatches(root, query, {
          caseSensitive,
          wholeWord,
          regexp: useRegex,
        });
        rangesRef.current = ranges;
        setMatchCount(ranges.length);
        const index = ranges.length > 0 ? Math.min(cursor, ranges.length - 1) : 0;
        paintMarkdownSearchHighlights(ranges, index);
        paintedRef.current = true;
        scrollRangeIntoView(scrollRef.current, ranges[index]);
      });
    };
    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [searchOpen, active, query, cursor, caseSensitive, wholeWord, useRegex, deferredDraft]);
  // Drop this preview's highlights on unmount.
  useEffect(
    () => () => {
      if (!paintedRef.current) return;
      paintedRef.current = false;
      clearMarkdownSearchHighlights();
    },
    [],
  );

  const safeCursor = matchCount > 0 ? Math.min(cursor, matchCount - 1) : 0;
  const handleQueryChange = (value: string) => {
    setQuery(value);
    setCursor(0);
  };
  const handleCaseSensitiveChange = (value: boolean) => {
    setCaseSensitive(value);
    setCursor(0);
  };
  const handleWholeWordChange = (value: boolean) => {
    setWholeWord(value);
    setCursor(0);
  };
  const handleRegexChange = (value: boolean) => {
    setUseRegex(value);
    setCursor(0);
  };
  const gotoNextMatch = () => {
    if (matchCount > 0) setCursor((safeCursor + 1) % matchCount);
  };
  const gotoPrevMatch = () => {
    if (matchCount > 0) setCursor((safeCursor - 1 + matchCount) % matchCount);
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {searchOpen && (
        <FindOnlyPanel
          inputRef={searchInputRef}
          placeholder={t("files.markdown.searchPlaceholder")}
          query={query}
          onQueryChange={handleQueryChange}
          caseSensitive={caseSensitive}
          onCaseSensitiveChange={handleCaseSensitiveChange}
          wholeWord={wholeWord}
          onWholeWordChange={handleWholeWordChange}
          useRegex={useRegex}
          onUseRegexChange={handleRegexChange}
          current={matchCount > 0 ? safeCursor + 1 : 0}
          total={matchCount}
          onPrev={gotoPrevMatch}
          onNext={gotoNextMatch}
          onClose={() => onSearchOpenChange?.(false)}
        />
      )}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto p-4 text-body-medium text-text-primary"
      >
        <div ref={contentRef}>
          <MarkdownDocument
            draft={deferredDraft}
            components={components}
            translations={translations}
          />
        </div>
      </div>
    </div>
  );
}
