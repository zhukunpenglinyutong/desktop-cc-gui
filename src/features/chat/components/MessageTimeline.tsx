import { lazy, memo, Suspense, useEffect, useMemo, useRef, useState, type MutableRefObject, type RefObject } from "react";
import { useVirtualizer, type Virtualizer } from "@tanstack/react-virtual";
import { useTranslation } from "react-i18next";
import Copy from "lucide-react/dist/esm/icons/copy";
import Check from "lucide-react/dist/esm/icons/check";
import type { Message } from "@/lib/ipc";

import type { SessionState } from "../store";
import { useChatStore } from "../store";
import { parseUsage } from "../usage";
import { formatTokens } from "@/utils/format-tokens";
import { cx } from "@/utils/cx";
import { AgentThinking } from "@/components/application/agent-thinking/agent-thinking";
import { useLiveParseInterval, useThrottled } from "@/hooks/use-throttled";
import { useCopied } from "@/hooks/use-copied";
import { MessageImages } from "./MessageImages";
import { GrantCard } from "./GrantCard";
import { QuestionRecord } from "./QuestionCard";
import { MESSAGE_ANCHOR_RAIL_BAND_CLASS, MessageAnchorRail } from "./MessageAnchorRail";
import { createAnchorRowsBuilder } from "./timeline-anchors";
import { buildRows, collectToolKeys, rowKey, type TimelineRow } from "./timeline-rows";
import { formatDuration } from "./format-duration";
import { modelDisplayName } from "@/features/settings/usage-model";
import { ProcessDisclosure, type ProcessSearchTarget } from "./ProcessDisclosure";
import { BackgroundTasksLine } from "./BackgroundTasksPanel";
import { runningTaskCount } from "../background-tasks";
import { CollapsibleMessage } from "./CollapsibleMessage";
import { useScrollFollow, useTailPin } from "./use-scroll-follow";
import { ScrollControl } from "./ScrollControl";
import { pluginIdFromRegistryKey, timelineRowRegistry, useRegistry } from "@ccgui/plugin-sdk";
import { PluginBoundary } from "@/features/plugins/boundary/PluginBoundary";
import { useAnchorRailScroll } from "./use-anchor-rail-scroll";
import { useLoadEarlier } from "./use-load-earlier";
import { stripAgentBlock } from "./agent-block";
import { registerShortcutHandler } from "@/features/shortcuts/runtime";
import { TimelineSearchBar } from "./TimelineSearchBar";
import {
  clearSearchHighlights,
  findTimelineMatches,
  paintSearchHighlights,
  rowSearchText,
  searchHighlightSupported,
} from "./timeline-search";

const TimelineRowView = memo(function TimelineRowView({
  row,
  workspacePath,
  turnLive,
  autoExpand,
  thinkingAutoCollapse,
  thinkingAutoExpand,
  seenTools,
  searchTarget,
}: {
  row: TimelineRow;
  workspacePath: string;
  /** True while the current turn is still streaming; suppresses the footer. */
  turnLive: boolean;
  /** True on the timeline's last process row: it rides open until a newer
   *  one appears, and stays open once the turn settles. Only fed through
   *  when the auto-expand setting allows it (or on a search jump). */
  autoExpand: boolean;
  /** False keeps a settled thinking row expanded (设置 → 通用 → 行为). */
  thinkingAutoCollapse: boolean;
  /** False keeps streaming process rows collapsed until the user expands
   *  one (设置 → 通用 → 行为). */
  thinkingAutoExpand: boolean;
  seenTools: Set<string>;
  searchTarget?: ProcessSearchTarget;
}) {
  // Plugin-defined row kinds (plan §4.2 #5) dispatch to the registered
  // renderer before the builtin switch below; builtin kinds never hit this
  // unless a plugin deliberately shadows one.
  const customRenderers = useRegistry(timelineRowRegistry);
  const custom = customRenderers.find((r) => r.kind === row.kind);
  if (custom) {
    const pluginId = pluginIdFromRegistryKey(custom.id);
    const Renderer = custom.component;
    return (
      <PluginBoundary pluginId={pluginId}>
        <Renderer row={row} />
      </PluginBoundary>
    );
  }
  // Every process run — thinking, tools, or both — folds into the same
  // collapsed summary line ("思考 N 次 工具调用 M 次 >"); expanding shows
  // the per-step details.
  if (row.kind === "process") {
    return (
      <ProcessDisclosure
        items={row.items}
        autoExpand={autoExpand}
        turnLive={turnLive}
        thinkingAutoCollapse={thinkingAutoCollapse}
        thinkingAutoExpand={thinkingAutoExpand}
        processId={row.firstSeq}
        seenTools={seenTools}
        searchTarget={searchTarget}
      />
    );
  }
  return (
    <MessageRow
      message={row.message}
      workspacePath={workspacePath}
      turnFinal={row.turnFinal && !turnLive}
    />
  );
});

const LazyMarkdown = lazy(() => import("./Markdown"));

/** Markdown body; the react-markdown/highlight stack loads in a lazy chunk. */
function Markdown({ text, workspacePath, streaming }: {
  text: string;
  workspacePath: string;
  streaming?: boolean;
}) {
  return (
    <Suspense
      fallback={
        <div className="prose-chat text-body-regular whitespace-pre-wrap text-text-primary">
          {text}
        </div>
      }
    >
      <LazyMarkdown text={text} workspacePath={workspacePath} streaming={streaming} />
    </Suspense>
  );
}

/** Format a message timestamp: HH:mm today, MM-dd HH:mm this year, full date
 * beyond. ts is RFC3339 (claude/pi) or epoch millis as a string (kimi/dsh). */
function formatMessageTime(ts: string | null | undefined): string | null {
  if (!ts) return null;
  const ms = /^\d+$/.test(ts) ? Number(ts) : Date.parse(ts);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.toDateString() === now.toDateString()) return hm;
  if (d.getFullYear() === now.getFullYear())
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hm}`;
}

/** Compact token usage for one message: "↑3.2k ↓412". Input is the whole
 *  prompt side — fresh tokens plus cache reads/writes — so a cache-heavy turn
 *  does not read as if it had sent almost nothing. */
function formatUsage(usage: unknown): string | null {
  const u = parseUsage(usage);
  if (!u) return null;
  const input = u.input + u.cacheRead + u.cacheWrite;
  if (!input && !u.output) return null;
  const parts: string[] = [];
  if (input) parts.push(`↑${formatTokens(input)}`);
  if (u.output) parts.push(`↓${formatTokens(u.output)}`);
  return parts.join(" ");
}

/** Passive per-message facts, revealed on message hover: time · duration · token usage · model · effort. */
function MessageMeta({ message }: { message: Message }) {
  const { t } = useTranslation();
  const effortText = useMemo(() => {
    if (!message.effort) return null;
    const key = `chat.effort${message.effort.charAt(0).toUpperCase() + message.effort.slice(1).toLowerCase()}`;
    const translated = t(key);
    const effortVal = translated && translated !== key ? translated : message.effort;
    return t("chat.metaEffort", { effort: effortVal });
  }, [message.effort, t]);

  const durationFormatted = useMemo(() => {
    const d = formatDuration(message.durationMs);
    return d ? t("chat.metaDuration", { duration: d }) : null;
  }, [message.durationMs, t]);

  const modelFormatted = useMemo(() => {
    return message.model
      ? t("chat.metaModel", { model: modelDisplayName(message.model) })
      : null;
  }, [message.model, t]);

  const parts = [
    formatMessageTime(message.ts),
    durationFormatted,
    formatUsage(message.usage),
    modelFormatted,
    effortText,
  ].filter((p): p is string => Boolean(p));
  if (parts.length === 0) return null;
  return (
    <span className="text-caption-1-regular tabular-nums text-text-tertiary opacity-0 transition-opacity duration-150 group-hover:opacity-100">
      {parts.join(" · ")}
    </span>
  );
}

/** Assistant message hover actions (copy). */
function MessageActions({ text }: { text: string }) {
  const { t } = useTranslation();
  const { copied, copy } = useCopied();
  const iconBtn =
    "flex size-6 cursor-pointer items-center justify-center rounded-md text-foreground-icon-secondary transition-colors hover:bg-background-tertiary-hover hover:text-foreground-icon-primary";
  return (
    <div className="flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
      <button
        type="button"
        aria-label={t("chat.copy")}
        onClick={() => copy(text)}
        className={iconBtn}
      >
        {copied ? (
          <Check className="size-3.5 text-lime-500" aria-hidden />
        ) : (
          <Copy className="size-3.5" aria-hidden />
        )}
      </button>
    </div>
  );
}

/** Copy affordance for a user bubble: icon only, no chrome, in a footer row
 *  under the bubble's bottom-right corner. A side-slot button vertically
 *  centers against the bubble, so long messages push it far from the text
 *  it copies; a footer stays put regardless of bubble height. Mirrors the
 *  assistant row's hover-reveal so a settled conversation stays clean, and
 *  stays reachable by keyboard. */
function UserMessageCopy({ text }: { text: string }) {
  const { t } = useTranslation();
  const { copied, copy } = useCopied();
  if (!text.trim()) return null;
  return (
    <button
      type="button"
      aria-label={t("chat.copy")}
      title={t("chat.copy")}
      onClick={() => copy(text)}
      className="flex size-6 cursor-pointer items-center justify-center rounded-md bg-transparent text-foreground-icon-secondary opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-background-tertiary-hover hover:text-foreground-icon-primary"
    >
      {copied ? (
        <Check className="size-3.5 text-lime-500" aria-hidden />
      ) : (
        <Copy className="size-3.5" aria-hidden />
      )}
    </button>
  );
}

/** User bubble. The agent block sendPrompt appended stays in history (the
 *  CLI transcript owns it), but the bubble strips it and carries the agent
 *  identity as a small badge above, mirroring the meta row's caption type. */
function UserMessageRow({ message }: { message: Message }) {
  const { t } = useTranslation();
  const stripped = useMemo(() => stripAgentBlock(message.text), [message.text]);
  return (
    <div className="group -mr-1.5 ml-auto flex w-full min-w-0 flex-col items-end">
      {stripped.agentName && (
        <span
          aria-label={t("chat.agentBadge", { name: stripped.agentName })}
          className="mb-1 flex items-center gap-1 text-caption-1-regular text-text-tertiary"
        >
          {stripped.agentIcon && <span aria-hidden>{stripped.agentIcon}</span>}
          {stripped.agentName}
        </span>
      )}
      <div className="flex w-fit min-w-0 max-w-[72%] flex-col rounded-xl bg-bubble-user px-3.5 py-2.5 text-left text-body-regular whitespace-pre-wrap [overflow-wrap:anywhere] text-text-white max-md:max-w-[85%]">
        <CollapsibleMessage>
          {message.images && message.images.length > 0 && (
            <MessageImages images={message.images} />
          )}
          {stripped.text}
        </CollapsibleMessage>
      </div>
      <UserMessageCopy text={stripped.text} />
    </div>
  );
}

export const MessageRow = memo(function MessageRow({
  message,
  workspacePath,
  turnFinal,
}: {
  message: Message;
  workspacePath: string;
  turnFinal: boolean;
}) {
  // A live row's text grows per store flush; a full markdown reparse per
  // flush scales linearly with reply length (~30ms at 32KB) and starves the
  // main thread, so the parse is throttled — and backed off further when the
  // previous commit overran the frame budget (fast streams need the frames
  // for the reveal more than they need an extra parse).
  const parseMs = useLiveParseInterval(message.live === true, message.text.length);
  const text = useThrottled(message.text, parseMs);
  if (message.role === "grant") {
    // Permission-denial card: actionable directory grant, not a chat bubble.
    return <GrantCard message={message} />;
  }
  if (message.role === "question") {
    // The interaction lives in the dock above the composer; the timeline
    // keeps only the placeholder / settled history row.
    return <QuestionRecord message={message} />;
  }
  if (message.role === "user") {
    return <UserMessageRow message={message} />;
  }
  return (
    <div className="group flex flex-col text-left">
      <Markdown text={text} workspacePath={workspacePath} streaming={message.live} />
      {turnFinal && (
        <div className="mt-1 flex items-center gap-2">
          <MessageActions text={message.text} />
          <MessageMeta message={message} />
        </div>
      )}
    </div>
  );
});

/** 对话内搜索（⌘F / Ctrl+F）：匹配走数据层（全量行，含未挂载的），
 * 高亮走 DOM（Custom Highlight API，仅已挂载行），互不改渲染管线。 */
function useTimelineSearch({
  rows,
  scrollRef,
  virtualizer,
  atBottomRef,
  userPausedRef,
}: {
  rows: TimelineRow[];
  scrollRef: RefObject<HTMLDivElement | null>;
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  atBottomRef: MutableRefObject<boolean>;
  userPausedRef: MutableRefObject<boolean>;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchCursor, setSearchCursor] = useState(0);
  const [searchRevision, setSearchRevision] = useState(0);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  // 快捷键是开关：再按一次关闭（而不是浏览器式的重新聚焦）。Ref written
  // in an effect so render stays pure; the shortcut only fires post-commit.
  const searchOpenRef = useRef(false);
  useEffect(() => {
    searchOpenRef.current = searchOpen;
  }, [searchOpen]);
  useEffect(
    () =>
      registerShortcutHandler("chatSearch", () => {
        if (searchOpenRef.current) {
          setSearchOpen(false);
          return;
        }
        setSearchOpen(true);
        requestAnimationFrame(() => {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        });
      }),
    [],
  );
  const searchMatches = useMemo(
    () => (searchOpen ? findTimelineMatches(rows, searchQuery) : []),
    [searchOpen, rows, searchQuery],
  );
  // 流式追加可能让命中总数变化；光标只钳位不重置，保留用户的浏览位置。
  const safeCursor =
    searchMatches.length > 0
      ? Math.min(searchCursor, searchMatches.length - 1)
      : 0;
  const currentSearchRow =
    searchMatches.length > 0 ? searchMatches[safeCursor].rowIndex : null;
  const currentSearchItem = useMemo(() => {
    if (currentSearchRow === null) return undefined;
    const row = rows[currentSearchRow];
    if (row.kind !== "process") return undefined;
    const occurrence = safeCursor - searchMatches.findIndex((match) => match.rowIndex === currentSearchRow);
    const needle = searchQuery.trim().toLowerCase();
    const text = rowSearchText(row).toLowerCase();
    let offset = -needle.length;
    for (let index = 0; index <= occurrence; index++) offset = text.indexOf(needle, offset + needle.length);
    let itemEnd = 0;
    for (let index = 0; index < row.items.length; index++) {
      itemEnd += row.items[index].text.toLowerCase().length + 1;
      if (offset < itemEnd) return index;
    }
    return undefined;
  }, [currentSearchRow, rows, safeCursor, searchMatches, searchQuery]);
  const processSearchTarget = useMemo<ProcessSearchTarget | undefined>(
    () => currentSearchItem === undefined ? undefined : {
      itemIndex: currentSearchItem,
      requestKey: JSON.stringify([currentSearchRow, currentSearchItem, searchQuery, safeCursor, searchRevision]),
    },
    [currentSearchRow, currentSearchItem, searchQuery, safeCursor, searchRevision],
  );
  const handleSearchQuery = (value: string) => {
    setSearchQuery(value);
    setSearchCursor(0);
    setSearchRevision((value) => value + 1);
  };
  const gotoNextMatch = () => {
    setSearchRevision((value) => value + 1);
    if (searchMatches.length > 0)
      setSearchCursor((safeCursor + 1) % searchMatches.length);
  };
  const gotoPrevMatch = () => {
    setSearchRevision((value) => value + 1);
    if (searchMatches.length > 0)
      setSearchCursor(
        (safeCursor - 1 + searchMatches.length) % searchMatches.length,
      );
  };
  // 搜索跳转即用户阅读意图：暂停尾部跟随，流式追加不再把视口拽回底部
  // （回到底部按钮/向下滚到底会恢复跟随）。
  useEffect(() => {
    if (currentSearchRow == null) return;
    userPausedRef.current = true;
    atBottomRef.current = false;
    virtualizer.scrollToIndex(currentSearchRow, { align: "auto" });
  }, [currentSearchRow, processSearchTarget, virtualizer, userPausedRef, atBottomRef]);
  // 命中底色：虚拟列表挂载/卸载与流式增改都会触发重绘；rAF 合帧。
  useEffect(() => {
    const el = scrollRef.current;
    if (!searchOpen || !el || !searchHighlightSupported()) return;
    let raf = 0;
    const paint = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() =>
        paintSearchHighlights(el, searchQuery, currentSearchRow),
      );
    };
    paint();
    const observer = new MutationObserver(paint);
    observer.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      clearSearchHighlights();
    };
  }, [searchOpen, searchQuery, currentSearchRow, scrollRef]);
  return {
    searchOpen,
    setSearchOpen,
    searchQuery,
    handleSearchQuery,
    safeCursor,
    matchCount: searchMatches.length,
    currentSearchRow,
    processSearchTarget,
    gotoNextMatch,
    gotoPrevMatch,
    searchInputRef,
  };
}

export const MessageTimeline = memo(function MessageTimeline({
  session,
  streaming,
  onLoadEarlier,
  workspacePath,
}: {
  session: SessionState;
  streaming: boolean;
  onLoadEarlier: () => void;
  workspacePath: string;
}) {

  const { t } = useTranslation();
  const thinkingAutoCollapse = useChatStore((s) => s.thinkingAutoCollapse);
  const thinkingAutoExpand = useChatStore((s) => s.thinkingAutoExpand);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const items = session.messages;
  const rows = useMemo(() => buildRows(items), [items]);
  // Anchor rail: one dash per user message (reference: messageAnchors).
  const buildAnchorRows = useMemo(createAnchorRowsBuilder, []);
  const anchors = useMemo(() => buildAnchorRows(rows), [buildAnchorRows, rows]);
  // Per-timeline, not a module singleton: ChatConversation remounts this
  // with key={sessionKey}, so a tab switch gets a fresh set. Prime from
  // the first snapshot that already has rows so history / tab-open does
  // not replay height 0→auto. Do not lock an empty set — loading failure
  // and load-earlier both flip `session.loading`, and an empty new chat
  // must still animate the first live tools.
  const [seenTools] = useState(() => new Set<string>());
  const [primed, setPrimed] = useState(false);
  if (!primed && rows.length > 0) {
    for (const key of collectToolKeys(rows)) seenTools.add(key);
    setPrimed(true);
  }
  // Key of the last process row — the one that stays expanded by default.
  const lastProcessKey = useMemo(() => {
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].kind === "process") return rowKey(rows[i]);
    }
    return null;
  }, [rows]);
  // Live stream rows are ordinary rows that grow in place; the only extra
  // tail item is the turn-status indicator below them.
  // The tail indicator stays mounted AND visible for the whole turn — a
  // constant status anchor below the growing rows. Hiding it while content
  // grew made every idle ↔ growing transition read as disconnect/reconnect:
  // the status line kept popping in and out at each tool call and pause.
  // The reply footer (copy + time + usage) only makes sense once the turn
  // settles: while streaming, mid-turn segments (kimi multi-message replies)
  // are not the final word.
  const turnLive = streaming;
  // A turn whose reply settled but whose background tasks still run keeps its
  // tail slot: the marker below it is what tells the reader the turn is not
  // over, even though nothing streams.
  const backgroundActive = session.backgroundActive;
  const runningCount = runningTaskCount(session.tasks);
  const count = rows.length + (streaming || backgroundActive ? 1 : 0);

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 72,
    overscan: 8,
    getItemKey: (index) =>
      index < rows.length ? rowKey(rows[index]) : "streaming-tail",
  });

  const { atBottomRef, userPausedRef, isFollowing, scrollToBottom, scrollToEdge } = useScrollFollow({ scrollRef });
  const {
    searchOpen,
    setSearchOpen,
    searchQuery,
    handleSearchQuery,
    safeCursor,
    matchCount,
    currentSearchRow,
    processSearchTarget,
    gotoNextMatch,
    gotoPrevMatch,
    searchInputRef,
  } = useTimelineSearch({ rows, scrollRef, virtualizer, atBottomRef, userPausedRef });
  const { activeAnchorId, handleScrollToAnchor } = useAnchorRailScroll({
    scrollRef,
    anchors,
    virtualizer,
    rowCount: rows.length,
    atBottomRef,
    userPausedRef,
  });
  useTailPin({ scrollRef, count, items, streaming, isFollowing, scrollToBottom });
  useLoadEarlier({
    scrollRef,
    virtualizer,
    rows,
    itemCount: items.length,
    nextBefore: session.nextBefore,
    onLoadEarlier,
  });

  const activeModel = useMemo(() => {
    if (session.activeModel) return session.activeModel;
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].model) return items[i].model;
    }
    return null;
  }, [session.activeModel, items]);

  const activeEffort = useMemo(() => {
    if (session.activeEffort) return session.activeEffort;
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].effort) return items[i].effort;
    }
    return null;
  }, [session.activeEffort, items]);

  const activeModelFormatted = useMemo(() => {
    return activeModel
      ? t("chat.metaModel", { model: modelDisplayName(activeModel) })
      : null;
  }, [activeModel, t]);

  const activeEffortFormatted = useMemo(() => {
    if (!activeEffort) return null;
    const key = `chat.effort${activeEffort.charAt(0).toUpperCase() + activeEffort.slice(1).toLowerCase()}`;
    const translated = t(key);
    const effortVal = translated && translated !== key ? translated : activeEffort;
    return t("chat.metaEffort", { effort: effortVal });
  }, [activeEffort, t]);

  // Tokens the reply in flight has spent, in the same "↑in ↓out" shape the
  // settled rows use. `turnUsage` is the run's reports summed (omp per
  // message, codex token_count); engines that report only at the end have
  // nothing until they do. Nothing is estimated from streamed text, so the
  // number is always real.
  const liveUsage = useMemo(
    () => formatUsage(session.turnUsage ?? session.usage),
    [session.turnUsage, session.usage],
  );

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <MessageAnchorRail
        activeAnchorId={activeAnchorId}
        anchors={anchors}
        navigationLabel={t("chat.anchorNavigation")}
        getFallbackTitle={(index) => t("chat.anchorUserTitle", { index: index + 1 })}
        onScrollToAnchor={handleScrollToAnchor}
      />
      <ScrollControl scrollRef={scrollRef} onJump={scrollToEdge} />
      {searchOpen && (
        <TimelineSearchBar
          query={searchQuery}
          onQueryChange={handleSearchQuery}
          current={safeCursor}
          total={matchCount}
          onPrev={gotoPrevMatch}
          onNext={gotoNextMatch}
          onClose={() => setSearchOpen(false)}
          inputRef={searchInputRef}
        />
      )}
      {/* The rail is absolutely positioned, so its band must be reserved here or
          a narrow window slides the centered column under the dashes. Only when
          the rail actually renders (anchors present) — otherwise the padding
          would be lopsided for no reason. */}
      <div
        ref={scrollRef}
        className={cx(
          "min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4",
          anchors.length > 0 && MESSAGE_ANCHOR_RAIL_BAND_CLASS,
        )}
      >
        <div data-sentinel className="h-px" />
        {session.nextBefore && (
          <button
            type="button"
            onClick={onLoadEarlier}
            className="mx-auto my-2 block rounded-full bg-background-tertiary-default px-3 py-1 text-caption-1-medium text-text-secondary hover:bg-background-secondary-hover"
          >
            {t("chat.loadEarlier")}
          </button>
        )}
        <div
          data-virtual-inner
          style={{ height: virtualizer.getTotalSize(), position: "relative" }}
          className="mx-auto max-w-[750px]"
        >
          {virtualizer.getVirtualItems().map((item) => {
            const isTail = item.index >= rows.length;
            return (
              <div
                key={item.key}
                data-index={item.index}
                ref={virtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${item.start}px)`,
                }}
                className="py-2"
              >
                {isTail ? (
                  streaming ? (
                    <>
                      {/* Both phases of the turn share this one slot: the
                          background marker stays visible above the thinking
                          row while the completion turn streams, and becomes
                          the slot's only content once the reply settles. */}
                      {backgroundActive && <BackgroundTasksLine count={runningCount} />}
                      <AgentThinking
                        variant="wave"
                        label={session.compaction ? t("chat.compactingContext") : t("chat.thinking")}
                        className="py-2"
                        startedAt={session.turnStartedAt ?? undefined}
                        durationFormatter={(d) => t("chat.metaDuration", { duration: d })}
                        model={activeModelFormatted}
                        effort={activeEffortFormatted}
                        usage={liveUsage}
                        retry={
                          session.retry
                            ? session.retry.max > 0
                              ? t("chat.retrying", {
                                  attempt: session.retry.attempt,
                                  max: session.retry.max,
                                })
                              : t("chat.retryingNoMax", { attempt: session.retry.attempt })
                            : null
                        }
                        retryDetail={session.retry?.message || null}
                      />
                    </>
                  ) : (
                    <BackgroundTasksLine count={runningCount} />
                  )
                ) : (
                  <TimelineRowView
                    row={rows[item.index]}
                    workspacePath={workspacePath}
                    turnLive={turnLive}
                    autoExpand={
                      (thinkingAutoExpand &&
                        rowKey(rows[item.index]) === lastProcessKey) ||
                      item.index === currentSearchRow
                    }
                    thinkingAutoCollapse={thinkingAutoCollapse}
                    thinkingAutoExpand={thinkingAutoExpand}
                    seenTools={seenTools}
                    searchTarget={item.index === currentSearchRow ? processSearchTarget : undefined}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});
