import { lazy, memo, Suspense, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslation } from "react-i18next";
import Copy from "lucide-react/dist/esm/icons/copy";
import Check from "lucide-react/dist/esm/icons/check";
import type { Message } from "@/lib/ipc";
import type { SessionState } from "../store";
import { parseUsage } from "../usage";
import { formatTokens } from "@/utils/format-tokens";
import { AgentThinking } from "@/components/application/agent-thinking/agent-thinking";
import { streamParseInterval, useThrottled } from "@/hooks/use-throttled";
import { useCopied } from "@/hooks/use-copied";
import { MessageImages } from "./MessageImages";
import { GrantCard } from "./GrantCard";
import { MessageAnchorRail } from "./MessageAnchorRail";
import { createAnchorRowsBuilder } from "./timeline-anchors";
import { buildRows, collectToolKeys, rowKey, type TimelineRow } from "./timeline-rows";
import { formatDuration } from "./format-duration";
import { ProcessDisclosure } from "./ProcessDisclosure";
import { CollapsibleMessage } from "./CollapsibleMessage";
import { useScrollFollow, useTailPin } from "./use-scroll-follow";
import { ScrollToBottomButton } from "./ScrollToBottomButton";
import { pluginIdFromRegistryKey, timelineRowRegistry, useRegistry } from "@ccgui/plugin-sdk";
import { PluginBoundary } from "@/features/plugins/boundary/PluginBoundary";
import { useAnchorRailScroll } from "./use-anchor-rail-scroll";
import { useLoadEarlier } from "./use-load-earlier";

const TimelineRowView = memo(function TimelineRowView({
  row,
  workspacePath,
  turnLive,
  autoExpand,
  seenTools,
}: {
  row: TimelineRow;
  workspacePath: string;
  /** True while the current turn is still streaming; suppresses the footer. */
  turnLive: boolean;
  /** True on the timeline's last process row: it rides open until a newer
   * one appears, and stays open once the turn settles. */
  autoExpand: boolean;
  seenTools: Set<string>;
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
        processId={row.firstSeq}
        seenTools={seenTools}
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
    return message.model ? t("chat.metaModel", { model: message.model }) : null;
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
  // main thread, so the parse is throttled. Settled rows never change and
  // render as-is.
  const text = useThrottled(message.text, message.live ? streamParseInterval(message.text.length) : 0);
  if (message.role === "grant") {
    // Permission-denial card: actionable directory grant, not a chat bubble.
    return <GrantCard message={message} />;
  }
  if (message.role === "user") {
    return (
      <div className="group -mr-1.5 ml-auto flex w-fit max-w-[85%] flex-col items-end">
        <div className="flex flex-col rounded-xl bg-bubble-user px-3.5 py-2.5 text-left text-body-regular whitespace-pre-wrap break-words text-text-white">
          <CollapsibleMessage>
            {message.images && message.images.length > 0 && (
              <MessageImages images={message.images} />
            )}
            {message.text}
          </CollapsibleMessage>
        </div>
        <UserMessageCopy text={message.text} />
      </div>
    );
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
  const count = rows.length + (streaming ? 1 : 0);

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 72,
    overscan: 8,
    getItemKey: (index) =>
      index < rows.length ? rowKey(rows[index]) : "streaming-tail",
  });

  const { atBottomRef, userPausedRef, isFollowing, scrollToBottom, resumeFollow } = useScrollFollow({ scrollRef });
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
    return activeModel ? t("chat.metaModel", { model: activeModel }) : null;
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
      <ScrollToBottomButton scrollRef={scrollRef} contentSignal={count} onJump={resumeFollow} />
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4">
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
                  <AgentThinking
                    variant="wave"
                    label={t("chat.thinking")}
                    className="py-2"
                    startedAt={session.turnStartedAt ?? undefined}
                    durationFormatter={(d) => t("chat.metaDuration", { duration: d })}
                    model={activeModelFormatted}
                    effort={activeEffortFormatted}
                    usage={liveUsage}
                  />
                ) : (
                  <TimelineRowView
                    row={rows[item.index]}
                    workspacePath={workspacePath}
                    turnLive={turnLive}
                    autoExpand={rowKey(rows[item.index]) === lastProcessKey}
                    seenTools={seenTools}
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
