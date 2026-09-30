"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import Search from "lucide-react/dist/esm/icons/search";
import { EngineIcon } from "@/components/foundations/icons/engine-icon";
import type { AiChatRepo } from "@/components/application/ai-chat/sidebar-types";
import { cx } from "@/utils/cx";
import { useBrowserOcclusion } from "@/features/browser/occlusion";
import { ipc, type MessageSearchHit } from "@/lib/ipc";
import { relativeTime } from "@/features/chat/time";
import { isModalDialogOpen, hideModalDialog, showModalDialog } from "@/lib/engine-compat";

/** Hard cap on listed rows: the palette is a jumper, not a browser. */
const MAX_RESULTS = 50;
/** Content hits fetched per query — small on purpose, ranked by bm25. */
const CONTENT_LIMIT = 20;
/** Debounce before a content query fires (agentsview uses the same 300ms). */
const CONTENT_DEBOUNCE_MS = 300;
/** Content search needs at least this many chars; title match runs always. */
const CONTENT_MIN_CHARS = 2;

/** Stable empties: lane filters reuse them so an unchanged list keeps its
 *  identity across renders instead of allocating a fresh array. */
const EMPTY_MATCHES: SessionMatch[] = [];
const EMPTY_HITS: MessageSearchHit[] = [];

/** Backend stats for the strip under the input: the query's own wall time
 *  (microseconds) and the message count it searched. */
interface SearchStats {
  elapsedUs: number;
  totalMessages: number;
}

/** Duration chip for the stats line: sub-10ms keeps one decimal so a
 *  sub-millisecond FTS query does not collapse to "0 ms", whole ms below a
 *  second, seconds with two decimals past that. */
export function formatSearchDuration(elapsedUs: number): string {
  if (!Number.isFinite(elapsedUs) || elapsedUs <= 0) return "0 ms";
  const ms = elapsedUs / 1000;
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  if (ms >= 10) return `${Math.round(ms)} ms`;
  return `${ms.toFixed(1)} ms`;
}

interface SessionMatch {
  id: string;
  label: string;
  engine?: string;
  /** Relative-time chip (e.g. "34m"), same string the sidebar shows. */
  time: string;
  workspace: string;
}

/**
 * Session quick-search palette (sidebar strip icon / ⌘L). Two lanes: title
 * matches are instant and local; message-content hits come from the
 * backend's FTS5 trigram index (debounced, stale responses dropped by a
 * request counter). A stats strip under the input reports the backend
 * query's own wall time and the indexed-message corpus it ran against.
 * The 标题 / 内容 chips are inclusive lane filters — both pressed shows both
 * lanes, un-pressing one narrows to the other. Empty query lists the most
 * recent sessions in sidebar order. Enter/click jumps to the session; Esc
 * or a backdrop press closes.
 *
 * Dialog mechanics (native <dialog>, backdrop press-to-close, window-level
 * key navigation) mirror the ⌘K command palette.
 */
export function SessionSearchPalette({
  open,
  repos,
  onClose,
  onThreadSelect,
}: {
  open: boolean;
  /** Every workspace (sections already flattened by the caller). */
  repos: AiChatRepo[];
  onClose: () => void;
  onThreadSelect?: (id: string) => void;
}) {
  const { t } = useTranslation();
  useBrowserOcclusion(open);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  // Lane filters (标题 / 内容). Both on is the default: title matches first,
  // then content hits.
  const [showTitle, setShowTitle] = useState(true);
  const [showContent, setShowContent] = useState(true);
  const [contentHits, setContentHits] = useState<MessageSearchHit[]>([]);
  const [contentPending, setContentPending] = useState(0);
  // Stats strip state: the last completed query's numbers, whether a query
  // is being awaited, and whether the last one failed. Cleared with the
  // lane so a leftover number can never label a query it did not run.
  const [contentStats, setContentStats] = useState<SearchStats | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [contentFailed, setContentFailed] = useState(false);
  // Invalidate in-flight content responses: Tauri invoke cannot be
  // aborted, so a monotonically increasing request id drops late arrivals
  // (agentsview's requestVersion — the AbortController equivalent here).
  const requestSeq = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const trimmedQuery = query.trim();

  const titleMatches = useMemo<SessionMatch[]>(() => {
    const normalized = query.trim().toLocaleLowerCase();
    const out: SessionMatch[] = [];
    for (const repo of repos) {
      const repoHit = normalized
        ? repo.label.toLocaleLowerCase().includes(normalized)
        : false;
      for (const thread of repo.threads) {
        if (!thread.id) continue;
        if (
          normalized &&
          !repoHit &&
          !thread.label.toLocaleLowerCase().includes(normalized)
        ) {
          continue;
        }
        out.push({
          id: thread.id,
          label: thread.label,
          engine: thread.engine,
          time: thread.time,
          workspace: repo.label,
        });
        if (out.length >= MAX_RESULTS) return out;
      }
    }
    return out;
  }, [repos, query]);
  // The chips only exist once the content lane can be live (≥2 chars); under
  // that the stored filter is not applied, so a hidden chip can never blank
  // the list out from under the user.
  const filtersLive = trimmedQuery.length >= CONTENT_MIN_CHARS;
  const showTitleRows = !filtersLive || showTitle;
  const titleRows = showTitleRows ? titleMatches : EMPTY_MATCHES;
  // Content lane: debounced backend FTS. Title matches above are free;
  // this fires at most once per 300ms pause, only for ≥2 chars, and only
  // while the 内容 chip is pressed.
  useEffect(() => {
    if (!open || !showContent || trimmedQuery.length < CONTENT_MIN_CHARS) {
      // Bump the sequence too: an in-flight response must not repopulate a
      // lane the user just switched off.
      requestSeq.current += 1;
      setContentHits(EMPTY_HITS);
      setContentPending(0);
      setContentStats(null);
      setContentLoading(false);
      setContentFailed(false);
      return;
    }
    const seq = ++requestSeq.current;
    // Debounce window included: from the first keystroke the strip says a
    // search is running, not what the previous query found.
    setContentLoading(true);
    setContentFailed(false);
    const timer = setTimeout(() => {
      ipc
        .searchMessages(trimmedQuery, CONTENT_LIMIT, 0)
        .then((page) => {
          if (requestSeq.current !== seq) return;
          setContentHits(page.hits);
          setContentPending(page.pending);
          setContentStats({
            elapsedUs: page.elapsedUs,
            totalMessages: page.totalMessages,
          });
          setContentLoading(false);
        })
        .catch(() => {
          if (requestSeq.current !== seq) return;
          setContentHits([]);
          setContentStats(null);
          setContentLoading(false);
          setContentFailed(true);
        });
    }, CONTENT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [open, trimmedQuery, showContent]);

  // A session matching by title is not repeated as a content hit — but only
  // while the title rows are actually on screen.
  const content = useMemo(() => {
    if (!showContent) return EMPTY_HITS;
    if (contentHits.length === 0) return contentHits;
    if (!showTitleRows) return contentHits;
    const titled = new Set(titleRows.map((m) => m.id));
    return contentHits.filter((h) => !titled.has(`${h.engine}/${h.sessionId}`));
  }, [showContent, showTitleRows, titleRows, contentHits]);
  const rowCount = titleRows.length + content.length;

  // Inclusive filter toggles: un-pressing the last pressed chip flips both
  // back on (an all-off filter could only ever show an empty palette).
  const toggleLane = (lane: "title" | "content") => {
    const nextTitle = lane === "title" ? !showTitle : showTitle;
    const nextContent = lane === "content" ? !showContent : showContent;
    if (!nextTitle && !nextContent) {
      setShowTitle(true);
      setShowContent(true);
    } else {
      setShowTitle(nextTitle);
      setShowContent(nextContent);
    }
    setActiveIndex(0);
  };

  // Native <dialog>: keep the modal open state in sync with the prop.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !isModalDialogOpen(dialog)) showModalDialog(dialog);
    if (!open && isModalDialogOpen(dialog)) hideModalDialog(dialog);
  }, [open]);

  // Fresh query + cursor every time the palette opens, adjusted during
  // render (the React-docs pattern) so the first open paint already shows
  // the cleared box — a reset effect would flash the previous query.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setQuery("");
      setActiveIndex(0);
      // A fresh search starts with both lanes on, like the query reset.
      setShowTitle(true);
      setShowContent(true);
    }
  }
  // Focus is a DOM side effect, so it stays in an effect.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const jump = (match: SessionMatch) => {
    onClose();
    onThreadSelect?.(match.id);
  };
  const jumpContent = (hit: MessageSearchHit) => {
    onClose();
    onThreadSelect?.(`${hit.engine}/${hit.sessionId}`);
  };

  const jumpRow = (index: number) => {
    if (index < titleRows.length) jump(titleRows[index]);
    else jumpContent(content[index - titleRows.length]);
  };

  // Backdrop press-to-close (see CommandPalette for why this is a window
  // listener rather than a dialog click handler).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (e.target === dialogRef.current) onClose();
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open, onClose]);

  // Keyboard navigation on window: Esc/↑/↓/Enter work regardless of which
  // element inside the palette holds focus. IME composition is left alone —
  // Enter that confirms a candidate must not jump.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, rowCount - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (rowCount > 0) jumpRow(Math.min(activeIndex, rowCount - 1));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, titleRows, content, activeIndex, onClose]);

  // The filtered list can shrink under the cursor; clamp the active row.
  const active = Math.min(activeIndex, Math.max(0, rowCount - 1));

  // Content-lane status line under the input box. Running / failed / stats
  // share one fixed row, so results never jump when it changes state.
  const statsLine = contentLoading
    ? t("chat.searchStatsLoading")
    : contentFailed
      ? t("chat.searchStatsFailed")
      : contentStats
        ? t("chat.searchStats", {
            time: formatSearchDuration(contentStats.elapsedUs),
            total: contentStats.totalMessages.toLocaleString(),
          })
        : "";

  // Keep the keyboard-highlighted row visible while arrowing through a
  // scrolled list. Section headers sit between option rows, so address by
  // role, not child index.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelectorAll("[role='option']")
      [active]?.scrollIntoView?.({ block: "nearest" });
  }, [open, active]);

  return (
    <dialog
      ref={dialogRef}
      aria-label={t("chat.searchSessions")}
      className={cx(
        "fixed inset-0 z-110 m-0 h-full max-h-none w-full max-w-none items-start justify-center bg-overlay-backdrop px-4 pt-[15vh]",
        open ? "flex" : "hidden",
      )}
      onCancel={onClose}
    >
      <div className="w-[560px] max-w-full overflow-hidden rounded-2xl border border-border-button-default bg-background-primary-default shadow-dropdown">
        <div className="flex items-center gap-2 border-b border-separator-border px-3">
          <Search className="size-4 shrink-0 text-foreground-icon-tertiary" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            placeholder={t("chat.searchSessions")}
            aria-label={t("chat.searchSessions")}
            className="palette-search-field h-11 w-full bg-transparent text-body-medium text-text-primary outline-none placeholder:text-text-placeholder"
          />
          {filtersLive && (
            <div className="flex shrink-0 items-center gap-1">
              {(
                [
                  { key: "title", label: t("chat.searchScopeTitle"), on: showTitle },
                  { key: "content", label: t("chat.searchScopeContent"), on: showContent },
                ] as const
              ).map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  aria-pressed={chip.on}
                  onClick={() => toggleLane(chip.key)}
                  className={cx(
                    "cursor-pointer rounded-2lg px-2 py-1 text-caption-1-medium outline-none transition-colors",
                    chip.on
                      ? "bg-background-secondary-default text-text-primary"
                      : "text-text-tertiary hover:bg-dropdown-item-hover-background",
                  )}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          )}
        </div>
        {filtersLive && showContent && (
          <div
            role="status"
            className={cx(
              "border-b border-separator-border px-3 py-1.5 text-caption-1-medium",
              contentFailed ? "text-text-error-primary" : "text-text-tertiary",
            )}
          >
            {statsLine}
          </div>
        )}
        <PaletteResults
          listRef={listRef}
          matches={titleRows}
          content={content}
          contentPending={contentPending}
          queryLongEnough={trimmedQuery.length >= CONTENT_MIN_CHARS}
          active={active}
          onHover={setActiveIndex}
          onJump={jump}
          onJumpContent={jumpContent}
        />
      </div>
    </dialog>
  );
}

/** Results listbox: title matches first, then the debounced FTS content
 *  lane, then the indexing notice. Rows are buttons with option roles so
 *  window-level arrow navigation can address them uniformly. */
function PaletteResults({
  listRef,
  matches,
  content,
  contentPending,
  queryLongEnough,
  active,
  onHover,
  onJump,
  onJumpContent,
}: {
  listRef: RefObject<HTMLDivElement>;
  matches: SessionMatch[];
  content: MessageSearchHit[];
  contentPending: number;
  /** Query meets CONTENT_MIN_CHARS: the content lane is live. */
  queryLongEnough: boolean;
  active: number;
  onHover: (index: number) => void;
  onJump: (match: SessionMatch) => void;
  onJumpContent: (hit: MessageSearchHit) => void;
}) {
  const { t } = useTranslation();
  return (
    <div ref={listRef} role="listbox" className="max-h-[320px] overflow-y-auto p-2">
      {matches.length === 0 && content.length === 0 ? (
        <div className="px-2 py-6 text-center text-body-medium text-text-secondary">
          {t("chat.noSessions")}
        </div>
      ) : (
        matches.map((match, index) => (
          <button
            key={match.id}
            type="button"
            role="option"
            aria-selected={index === active}
            onMouseEnter={() => onHover(index)}
            onClick={() => onJump(match)}
            className={cx(
              "flex w-full cursor-pointer items-center gap-2 rounded-2lg px-2 py-1.5 text-left outline-none transition-colors",
              index === active && "bg-dropdown-item-hover-background",
            )}
          >
            {match.engine && (
              <EngineIcon
                engine={match.engine}
                size={12}
                className="size-3 shrink-0 text-foreground-icon-secondary"
              />
            )}
            <span className="min-w-0 flex-1 truncate text-body-medium text-text-primary">
              {match.label}
            </span>
            {match.time && (
              <span className="shrink-0 text-caption-1-medium text-text-tertiary">
                {match.time}
              </span>
            )}
            <span className="shrink-0 text-caption-1-medium text-text-tertiary">
              {match.workspace}
            </span>
          </button>
        ))
      )}
      {content.length > 0 && (
        <div
          aria-hidden
          className="px-2 pt-2 pb-1 text-caption-1-medium text-text-tertiary"
        >
          {t("chat.searchMessageMatches")}
        </div>
      )}
      {content.map((hit, i) => {
        const index = matches.length + i;
        return (
          <button
            key={`${hit.engine}/${hit.sessionId}`}
            type="button"
            role="option"
            aria-selected={index === active}
            onMouseEnter={() => onHover(index)}
            onClick={() => onJumpContent(hit)}
            className={cx(
              "flex w-full cursor-pointer flex-col gap-0.5 rounded-2lg px-2 py-1.5 text-left outline-none transition-colors",
              index === active && "bg-dropdown-item-hover-background",
            )}
          >
            <span className="flex w-full items-center gap-2">
              <EngineIcon
                engine={hit.engine}
                size={12}
                className="size-3 shrink-0 text-foreground-icon-secondary"
              />
              <span className="min-w-0 flex-1 truncate text-body-medium text-text-primary">
                {hit.customTitle || hit.title || hit.sessionId.slice(0, 8)}
              </span>
              {hit.updatedAt ? (
                <span className="shrink-0 text-caption-1-medium text-text-tertiary">
                  {relativeTime(hit.updatedAt)}
                </span>
              ) : null}
              <span className="shrink-0 text-caption-1-medium text-text-tertiary">
                {hit.workspaceName ?? hit.workspacePath}
              </span>
            </span>
            <span className="w-full truncate pl-5 text-caption-1-medium text-text-secondary">
              {hit.snippet.map((part, j) =>
                part.marked ? (
                  <mark
                    key={j}
                    className="rounded-xs bg-background-tertiary-warning px-0.5 text-text-warning-primary"
                  >
                    {part.text}
                  </mark>
                ) : (
                  <span key={j}>{part.text}</span>
                ),
              )}
            </span>
          </button>
        );
      })}
      {contentPending > 0 && queryLongEnough && (
        <div aria-live="polite" className="px-2 pt-1 pb-1 text-caption-1-medium text-text-tertiary">
          {t("chat.searchIndexing", { count: contentPending })}
        </div>
      )}
    </div>
  );
}
