import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Search from "lucide-react/dist/esm/icons/search";
import { cx } from "@/utils/cx";
import {
  MENU_ITEM,
  MENU_ITEM_ACTIVE,
  MENU_ITEMS_CONTAINER,
} from "@/components/base/dropdown/menu-styles";
import { useMentionIndexStore } from "@/components/application/ai-chat/mention-files";
import { getFileTreeIconSvg } from "./fileIcons";
import {
  combineRootEntries,
  scopeToPrimaryRoot,
  searchEntries,
  searchRowLabel,
  type ScopedSearchEntry,
} from "./file-search";
import { joinPath, useFilesStore } from "./store";

const INPUT_ID = "file-search-input";

/**
 * Workspace file search scoped to one folder, opened from the tree's
 * right-click menu. Shares the @-mention index cache for every root of the
 * active workspace (no extra walk), merges them into one namespace and
 * searches across all of them — same-volume roots rebase by relative path,
 * cross-drive roots by absolute path (see combineRootEntries). Exists only
 * while `searchRoot` is set — see FilesPanel. Escape closes; the input keeps
 * focus, so the pointer and the keyboard both work without a focus dance.
 */
export function FileSearchOverlay({ searchRoot }: { searchRoot: string }) {
  const { t } = useTranslation();
  const roots = useFilesStore((s) => s.roots);
  // 每个根的 @-mention 索引都参与检索,合并进主目录命名空间(跨根搜索)。
  // 订阅稳定的 byRoot 记录后在 useMemo 里取用,避免 selector 每次返回新数组
  // (zustand 5 下会导致重渲染循环)。
  const byRoot = useMentionIndexStore((s) => s.byRoot);
  const indices = useMemo(() => roots.map((r) => byRoot[r]), [roots, byRoot]);
  const closeSearch = useFilesStore((s) => s.closeSearch);
  const root = roots[0] ?? "";
  useEffect(() => {
    for (const r of roots) useMentionIndexStore.getState().ensure(r);
  }, [roots]);

  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // The overlay mounts per open, so this focuses the input exactly then.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const combined = useMemo(
    () => combineRootEntries(roots, indices.map((i) => i?.entries)),
    [roots, indices],
  );
  const scope = useMemo(() => scopeToPrimaryRoot(roots, searchRoot), [roots, searchRoot]);
  const items = useMemo(
    () => (scope === null ? [] : searchEntries(combined, root, scope, query)),
    [combined, root, scope, query],
  );

  // The match list can shrink under the cursor; clamp the active row.
  const active = items.length > 0 ? Math.min(activeIndex, items.length - 1) : -1;

  const activate = useCallback(
    (entry: ScopedSearchEntry) => {
      // innerRel 是条目在自身根内的相对路径(重定基前),直接拼回来源根的绝对
      // 路径;追加根里的文件也以绝对路径打开(编辑器跨根保留)。
      const absolute = entry.innerRel
        ? joinPath(entry.root, entry.innerRel)
        : entry.root;
      if (entry.isDir) useFilesStore.getState().selectPath(absolute, true);
      else void useFilesStore.getState().openFile(absolute);
      closeSearch();
    },
    [closeSearch],
  );

  // Keys live on the window (same pattern as the command palette): the input
  // holds focus, but the overlay stays keyboard-driven even if focus leaves.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          e.preventDefault();
          closeSearch();
          return;
        case "ArrowDown":
          e.preventDefault();
          setActiveIndex((i) => Math.min(i + 1, Math.max(0, items.length - 1)));
          return;
        case "ArrowUp":
          e.preventDefault();
          setActiveIndex((i) => Math.max(i - 1, 0));
          return;
        case "Enter": {
          const entry = active >= 0 ? items[active] : undefined;
          if (!entry) return;
          e.preventDefault();
          activate(entry);
          return;
        }
        default:
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [items, active, activate, closeSearch]);

  // Keep the keyboard-highlighted row in view while arrowing.
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [active, items]);

  return (
    <div className="absolute inset-0 z-20 flex min-h-0 flex-col bg-background-primary-default">
      <div className="flex items-center gap-2 border-b border-separator-border px-3">
        <Search className="size-4 shrink-0 text-foreground-icon-tertiary" aria-hidden />
        <label
          htmlFor={INPUT_ID}
          className="sr-only"
        >
          {t("files.searchFilesTitle")}
        </label>
        <input
          id={INPUT_ID}
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
          }}
          placeholder={t("files.searchPlaceholder")}
          className="palette-search-field h-9 w-full bg-transparent text-body-medium text-text-primary outline-none placeholder:text-text-placeholder"
        />
      </div>
      <div
        ref={listRef}
        role="listbox"
        aria-label={t("files.searchFilesTitle")}
        className={cx(MENU_ITEMS_CONTAINER, "min-h-0 flex-1 overflow-y-auto p-1.5")}
      >
        {items.length === 0 ? (
          // No query → nothing at all: see searchEntries. A query with no
          // matches gets the empty state.
          query.trim() ? (
            <div className="p-2 text-body-regular text-text-tertiary select-none">
              {t("files.searchNoMatches")}
            </div>
          ) : null
        ) : (
          items.map((entry, i) => {
            // Gray folder label: source root token + in-root relative dir
            // (e.g. `lib/docs`); single root keeps the bare relative dir —
            // see `searchRowLabel`.
            const dir = searchRowLabel(roots, entry);
            return (
              <div
                key={entry.rel}
                role="option"
                aria-selected={i === active}
                data-active={i === active || undefined}
                tabIndex={-1}
                title={entry.rel}
                // Keep focus in the input so typing never stops: the click
                // still activates the row below.
                onMouseDown={(e) => e.preventDefault()}
                onMouseMove={() => {
                  if (i !== active) setActiveIndex(i);
                }}
                onClick={() => activate(entry)}
                className={cx(MENU_ITEM, "cursor-pointer", i === active && MENU_ITEM_ACTIVE)}
              >
                <span
                  aria-hidden
                  className="flex size-4 shrink-0 items-center justify-center text-foreground-icon-secondary [&>svg]:size-4"
                  dangerouslySetInnerHTML={{
                    __html: getFileTreeIconSvg(entry.name, entry.isDir),
                  }}
                />
                <span className="shrink-0 text-body-regular text-text-primary">{entry.name}</span>
                {dir ? (
                  <span className="truncate text-body-regular text-text-tertiary">{dir}</span>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
