import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type RefObject } from "react";
import { useVirtualizer, type Virtualizer } from "@tanstack/react-virtual";
import { useTranslation } from "react-i18next";
import Copy from "lucide-react/dist/esm/icons/copy";
import Check from "lucide-react/dist/esm/icons/check";
import GitFork from "lucide-react/dist/esm/icons/git-fork";
import type { Message } from "@/lib/ipc";

import type { SessionState } from "../store";
import { useChatStore } from "../store";
import { timelineColumnClass } from "../chat-column";
import { parseUsage } from "../usage";
import { formatTokens } from "@/utils/format-tokens";
import { cx } from "@/utils/cx";
import { AgentThinking } from "@/components/application/agent-thinking/agent-thinking";
import { useLiveParseInterval, useThrottled } from "@/hooks/use-throttled";
import { useCopied } from "@/hooks/use-copied";
import { sha256Hex } from "@/lib/sha256";
import { useScopedSession } from "../split/session-scope";
import { sessionKey } from "../store/persistence";
import { MessageImages } from "./MessageImages";
import { GrantCard } from "./GrantCard";
import { QuestionRecord } from "./QuestionCard";
import { PlanReviewCard } from "./PlanReviewCard";
import { MESSAGE_ANCHOR_RAIL_BAND_CLASS, MessageAnchorRail } from "./MessageAnchorRail";
import { createAnchorRowsBuilder } from "./timeline-anchors";
import { buildRows, collectToolKeys, rowKey, type TimelineRow } from "./timeline-rows";
import { forkUnavailableReason, type ForkUnavailable } from "../fork";
import { formatDuration } from "./format-duration";
import { modelDisplayName } from "@/features/settings/usage-model";
import { ProcessDisclosure, type ProcessSearchTarget } from "./ProcessDisclosure";
import { ResponseCheckBadge } from "./response-check-badge";
import { CollapsibleMessage } from "./CollapsibleMessage";
import { useScrollFollow, useTailPin } from "./use-scroll-follow";
import { ScrollControl } from "./ScrollControl";
import { pluginIdFromRegistryKey, timelineRowRegistry, useRegistry } from "@ccgui/plugin-sdk";
import { PluginBoundary } from "@/features/plugins/boundary/PluginBoundary";
import { useAnchorRailScroll } from "./use-anchor-rail-scroll";
import { useLoadEarlier } from "./use-load-earlier";
import { stripAgentBlock } from "./agent-block";
import { BotAvatarView } from "@/features/bots/bot-avatar";
import { avatarFromLegacyIcon } from "@/features/bots/bot-avatar-model";
import { useBotStore } from "@/features/bots/bot-store";
import { registerShortcutHandler } from "@/features/shortcuts/runtime";
import { TimelineSearchBar } from "./TimelineSearchBar";
import {
  clearSearchHighlights,
  findTimelineMatches,
  paintSearchHighlights,
  rowSearchText,
  searchHighlightSupported,
} from "./timeline-search";

/**
 * 分叉点解算：以「该轮的用户消息」为定位键。
 *
 * 为什么不用被点击消息自身的文本：一条 assistant 记录在 `fold_rows` 里会被
 * `claude_flush_text` 拆成多行（遇 thinking / tool_use 先把累积文本单独
 * flush），前端存的那一段与后端那一行**不保证全等**。而用户轮没有这些块，
 * 一条 `user` 记录严格对应一行、文本全等（design §3.3）。
 *
 * 返回 `text` 必须是 store 里的**原始** `message.text`：后端拿它去比对转录本
 * 里的用户文本，显示层 strip 过的文本会对不上。
 *
 * 找不到前置用户消息（列表被裁剪到该轮之后）时返回 null——调用方据此不显示
 * 分叉入口，绝不猜一个位置出来。
 */
export function resolveForkAnchor(
  neighbors: readonly Message[],
  message: Message,
): { text: string; seq: number } | null {
  const end = neighbors.indexOf(message);
  // 用户行**包含它自己**：点用户提问这一轮，分叉点就该是"这一轮结束"，也就是
  // 分支要**包含**用户点的那一轮（点「请教一个数学题」→ 分支里有这一轮 +
  // 之前全部）。若从 `from - 1` 起扫，点用户气泡会退到上一轮结束，把用户刚点
  // 的那一轮排除掉——与点同一轮的助手回复给出不同结果，是错的。
  // `indexOf` 未命中时用 length（从末尾开始扫），后面按 `row === undefined`
  // 收口——空列表与"消息不在集合里"都必须安全返回 null。
  const from = end >= 0 ? end : neighbors.length;
  for (let i = from; i >= 0; i -= 1) {
    const row = neighbors[i];
    if (!row) break;
    // 卡片行（授权 / 问答 / 计划）不是对话轮次，跳过。
    if (row.role !== "user") continue;
    // 纯图片轮**照样算定位成功**，只是文本为空：锚点是拿文本摘要去转录本里比对的，
    // 空文本没有可用的摘要（所有纯图片轮共享同一个 `""` 摘要，无法区分），所以这种
    // 情况由调用方置灰并说明原因，而**不是**返回 null。返回 null 会让入口直接消失，
    // 用户分不清"这条消息不支持"还是"功能坏了/记错了位置"。
    return { text: row.text, seq: row.seq };
  }
  return null;
}

const TimelineRowView = memo(function TimelineRowView({
  row,
  workspacePath,
  turnLive,
  autoExpand,
  thinkingAutoCollapse,
  seenTools,
  searchTarget,
  neighbors,
  sessionRemote,
  forkPending,
}: {
  row: TimelineRow;
  workspacePath: string;
  /** True while the current turn is still streaming; suppresses the footer. */
  turnLive: boolean;
  /** True on the timeline's last process row: it rides open until a newer
   * one appears, and stays open once the turn settles. */
  autoExpand: boolean;
  /** False keeps a settled thinking row expanded (设置 → 通用 → 行为). */
  thinkingAutoCollapse: boolean;
  seenTools: Set<string>;
  searchTarget?: ProcessSearchTarget;
  /** 完整消息列表（含被虚拟化裁掉的行）：分叉要回溯「该轮的用户消息」。 */
  neighbors: readonly Message[];
  /** 远程会话（不分叉）与该来源会话的分叉在飞标记，透传给消息行。 */
  sessionRemote: boolean;
  forkPending: boolean;
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
  // The compaction command renders in place, not as a bubble: one grey line
  // that stays after the compaction ends.
  if (row.kind === "curtain") return <CompactionCurtain />;
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
      turnLive={turnLive}
      sessionRemote={sessionRemote}
      forkPending={forkPending}
      neighbors={neighbors}
    />
  );
});

/** The one trace host automatic compaction leaves in the transcript: a grey,
 *  right-aligned line where the /compact bubble used to be. It belongs to the
 *  row, so it survives the compaction ending; the engine's own mid-turn
 *  compaction has no row and mounts this component as the tail instead. */
export function CompactionCurtain() {
  const { t } = useTranslation();
  return (
    <div className="flex justify-end py-2 pr-1" data-testid="compaction-curtain">
      <span className="text-caption-1-medium text-text-tertiary">
        {`< ${t("chat.compactingContext")} >`}
      </span>
    </div>
  );
}

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
  const check = message.responseCheck ?? null;
  if (parts.length === 0 && !check) return null;
  return (
    <span className="text-caption-1-regular tabular-nums text-text-tertiary opacity-0 transition-opacity duration-150 group-hover:opacity-100">
      {parts.join(" · ")}
      {/* Recorded at settle: the response check outlives the tail indicator. */}
      {check && (
        <span className="ml-1.5 inline-flex items-center align-middle">
          <ResponseCheckBadge check={check} />
        </span>
      )}
    </span>
  );
}

/** 消息操作按钮的共用外观。常驻可见（design §4.3.1）：复制与分支一直在，
 *  元信息才走 hover。`focus-visible` 是可达性要求（ui-ux-spec §3：按钮类
 *  控件的焦点环只走 focus-visible）——此前这两个按钮只靠 group-hover 显形，
 *  键盘用户根本够不到，属既有违规，随本次常驻化一并修掉。
 *  `aria-disabled` 的视觉与 `disabled` 同款：解释性禁用走前者（原生 disabled
 *  收不到 hover / focus，挂在它上面的原因读不到）。 */
const ICON_BTN =
  "message-action-btn flex size-6 cursor-pointer items-center justify-center rounded-md text-foreground-icon-secondary transition-colors hover:bg-background-tertiary-hover hover:text-foreground-icon-primary focus-visible:ring-2 focus-visible:ring-border-focus-ring focus-visible:outline-none aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-transparent aria-disabled:hover:text-foreground-icon-secondary";

/** 两种禁用分开表达（ui-ux-spec §3「两种禁用分开」）：等待态说"正在做"，
 *  光标是 `wait`；其余（流式期间"还轮不到你"）用 `not-allowed` + 更低的强调。
 *  分两个常量而不是叠加 class，是因为同族的 cursor 工具类会互相覆盖。 */
const ICON_BTN_BUSY = "disabled:cursor-wait disabled:opacity-70";
const ICON_BTN_FROZEN =
  "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-foreground-icon-secondary";

/** 复制按钮（两侧共用）。 */
function CopyButton({
  text,
  className = "",
}: {
  text: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const { copied, copy } = useCopied();
  return (
    <button
      type="button"
      // ui-ux-spec §4.2：复制没有别的成功信号，可访问名一起改成「已复制」。
      aria-label={copied ? t("chat.copied") : t("chat.copy")}
      title={copied ? t("chat.copied") : t("chat.copy")}
      onClick={() => copy(text)}
      className={`${ICON_BTN} message-copy-btn ${className}`}
    >
      {copied ? (
        <Check className="size-3.5 text-lime-500" aria-hidden />
      ) : (
        <Copy className="size-3.5" aria-hidden />
      )}
    </button>
  );
}

/** 创建分支按钮（两侧共用）。可见性由调用方给（「这条消息能否当分叉锚点」），
 *  不可用时**保留占位**：流式期间禁用而非隐藏，看得见但明确不可用比凭空消失
 *  更诚实，也避免回复结束时多出一行的布局跳动（ui-ux-spec §3）。
 *
 *  禁用分两种，不能混（ui-ux-spec §3「两种禁用分开」）：
 *  - **前提不满足**（远程会话 / 引擎不支持）：原因不写在按钮形状上，用户猜不
 *    出来，所以给 `title` 说明缺什么；原生 `disabled` 收不到 hover / focus，
 *    解释文案等于没写，故这类走 `aria-disabled` + 点击守卫。
 *  - **进行中**（这次分叉还在飞，防双击重复分叉）：`disabled:cursor-wait`——
 *    等待态不能用来表达"你还没准备好前提"。
 *  流式期间属于前者之外的第三种：原因自明，原生 `disabled` 即可。 */
function ForkButton({
  unavailable,
  onFork,
  className = "",
}: {
  unavailable: ForkUnavailable | null;
  onFork: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const blockedReason =
    unavailable === "remote"
      ? t("chat.forkUnavailableRemote")
      : unavailable === "engine"
        ? t("chat.forkUnavailableEngine")
        : unavailable === "image-only"
          ? t("chat.forkUnavailableImageOnly")
          : null;
  return (
    <button
      type="button"
      // 图标刻意不用 GitBranch：状态栏的 git 分支切换器已经占用那个形状，
      // 两者在同一个应用里不该长得一样（design §4.3.1）。
      aria-label={t("chat.forkConversation")}
      title={blockedReason ?? t("chat.forkConversation")}
      aria-disabled={blockedReason ? true : undefined}
      disabled={unavailable !== null && !blockedReason}
      onClick={() => {
        if (unavailable !== null) return;
        onFork();
      }}
      className={cx(
        ICON_BTN,
        "message-fork-btn",
        unavailable === "busy" ? ICON_BTN_BUSY : ICON_BTN_FROZEN,
        className,
      )}
    >
      <GitFork className="size-3.5" aria-hidden />
    </button>
  );
}

/** Assistant message actions: copy + fork, both always visible. */
function MessageActions({
  text,
  showFork,
  forkUnavailable,
  onFork,
}: {
  text: string;
  /** 这条消息能当分叉锚点（入口常驻）；不能时只撤掉分支按钮，复制仍在。 */
  showFork: boolean;
  forkUnavailable: ForkUnavailable | null;
  onFork: () => void;
}) {
  return (
    <div className="flex items-center gap-0.5">
      <CopyButton text={text} />
      {showFork && <ForkButton unavailable={forkUnavailable} onFork={onFork} />}
    </div>
  );
}

/** Copy + fork affordance for a user bubble: icon only, no chrome, in a footer
 *  row under the bubble's bottom-right corner. A side-slot button vertically
 *  centers against the bubble, so long messages push it far from the text
 *  it copies; a footer stays put regardless of bubble height. Always visible
 *  (design §4.3.1) and keyboard reachable. */
function UserMessageActions({
  text,
  showFork,
  forkUnavailable,
  onFork,
}: {
  text: string;
  showFork: boolean;
  forkUnavailable: ForkUnavailable | null;
  onFork: () => void;
}) {
  if (!text.trim() && !showFork) return null;
  return (
    <div className="mt-0.5 flex items-center gap-0.5">
      {text.trim() && <CopyButton text={text} />}
      {showFork && <ForkButton unavailable={forkUnavailable} onFork={onFork} />}
    </div>
  );
}

/** The badge above a user bubble: which bot authored the prompt.
 *
 *  The committed message only carries the name, icon and bot id, so the avatar
 *  resolves against the live bot list first (an edited bot shows its new look
 *  on old turns too). When the bot is gone or built-in, the recorded icon is
 *  the fallback — an emoji as-is, an id-shaped stand-in otherwise — so the
 *  slot is never empty. Rendering goes through the same `BotAvatarView` every
 *  other surface uses, so the badge avatar moves like the settings list. */
function AgentBadge({
  name,
  icon,
  botId,
}: {
  name: string;
  icon?: string;
  botId?: string;
}) {
  const { t } = useTranslation();
  const bot = useBotStore((s) =>
    botId ? s.bots.find((entry) => entry.id === botId) : undefined,
  );
  const avatar = bot?.avatar ?? avatarFromLegacyIcon(icon, botId || icon || name);
  return (
    <span
      aria-label={t("chat.agentBadge", { name })}
      className="mb-1 flex items-center gap-1 text-caption-1-regular text-text-tertiary"
    >
      <span aria-hidden className="flex">
        <BotAvatarView avatar={avatar} seed={botId || name} size={14} />
      </span>
      {name}
    </span>
  );
}

/** User bubble. The agent block sendPrompt appended stays in history (the
 *  CLI transcript owns it), but the bubble strips it and carries the agent
 *  identity as a small badge above, mirroring the meta row's caption type. */
function UserMessageRow({
  message,
  showFork,
  forkUnavailable,
  onFork,
}: {
  message: Message;
  showFork: boolean;
  forkUnavailable: ForkUnavailable | null;
  onFork: () => void;
}) {
  const stripped = useMemo(() => stripAgentBlock(message.text), [message.text]);
  return (
    <div className="group -mr-1.5 ml-auto flex w-full min-w-0 flex-col items-end">
      {stripped.agentName && (
        <AgentBadge
          name={stripped.agentName}
          icon={stripped.agentIcon}
          botId={stripped.botId}
        />
      )}
      <div className="flex w-fit min-w-0 max-w-[72%] flex-col rounded-xl bg-bubble-user px-3.5 py-2.5 text-left text-body-regular whitespace-pre-wrap [overflow-wrap:anywhere] text-text-white max-md:max-w-[85%]">
        <CollapsibleMessage>
          {message.images && message.images.length > 0 && (
            <MessageImages images={message.images} />
          )}
          {stripped.text}
        </CollapsibleMessage>
      </div>
      {/* 复制用 store 的原始文本，不是 strip 后的显示文本——两者在带 agent
          区块时不同，而复制按钮一直复制的是显示文本，这里保持原样。 */}
      <UserMessageActions
        text={stripped.text}
        showFork={showFork}
        forkUnavailable={forkUnavailable}
        onFork={onFork}
      />
    </div>
  );
}

export const MessageRow = memo(function MessageRow({
  message,
  workspacePath,
  turnFinal,
  neighbors,
  turnLive = false,
  sessionRemote = false,
  forkPending = false,
}: {
  message: Message;
  workspacePath: string;
  turnFinal: boolean;
  /** 这条消息所在的完整列表（含未挂载的行）；分叉要找「该轮的用户消息」，
   *  而它可能在被虚拟化裁掉的窗口之外。缺省为空表示"没有邻域可回溯"——
   *  此时不显示分叉入口，而不是猜一个位置。 */
  neighbors?: readonly Message[];
  /** 本轮还在流式：分叉入口保留占位但禁用。 */
  turnLive?: boolean;
  /** 会话目录里的远程标记（远程会话不分叉）；由时间线取一次往下传，避免每行
   *  各自订阅会话目录、在每个流式 flush 里重扫一遍。 */
  sessionRemote?: boolean;
  /** 这个来源会话有一次分叉在飞（防重入）；同样由时间线取一次。 */
  forkPending?: boolean;
}) {
  // A live row's text grows per store flush; a full markdown reparse per
  // flush scales linearly with reply length (~30ms at 32KB) and starves the
  // main thread, so the parse is throttled — and backed off further when the
  // previous commit overran the frame budget (fast streams need the frames
  // for the reveal more than they need an extra parse).
  const parseMs = useLiveParseInterval(message.live === true, message.text.length);
  const text = useThrottled(message.text, parseMs);
  // Hooks must run before any early return below, or the hook count changes
  // between a card row and a chat row.
  const scoped = useScopedSession();
  const forkSession = useChatStore((s) => s.forkSession);
  const requestFork = useCallback(
    (anchorText: string, seqHint: number) => {
      if (!scoped?.sessionId) return;
      void forkSession(scoped.engine, scoped.sessionId, scoped.workspacePath, {
        userTextSha256: sha256Hex(anchorText),
        seqHint,
      });
    },
    [forkSession, scoped?.engine, scoped?.sessionId, scoped?.workspacePath],
  );
  if (message.role === "grant") {
    // Permission-denial card: actionable directory grant, not a chat bubble.
    return <GrantCard message={message} />;
  }
  if (message.role === "question") {
    // The interaction lives in the dock above the composer; the timeline
    // keeps only the placeholder / settled history row.
    return <QuestionRecord message={message} />;
  }
  if (message.role === "plan_review") {
    // Plan preview & approval card: one row per planId+revision; the
    // decision actions live in the dock, settled rows stay as history.
    return <PlanReviewCard message={message} workspacePath={workspacePath} />;
  }
  // 分叉入口的**可见性**只看「这条消息能否当锚点」：用户行包含它自己那一轮
  // （resolve-fork-anchor 的契约），所以用户气泡与同轮助手回复给出同一个分叉
  // 点。**绝不能拿 `turnFinal` 当闸门**——它只由 buildRows 打给助手行
  // （timeline-rows.ts 的收尾扫描），用户行恒为 false，那样用户气泡的入口永远
  // 渲染不出来，而"每条消息都有常驻操作行"是设计约定（design §4.3.1）。
  const forkTarget = resolveForkAnchor(neighbors ?? [], message);
  // 可见性只看"能否定位到这一轮"，**不**看这一轮有没有文本：纯图片轮定位得到但没有
  // 可用的文本摘要，那是"不可用"（置灰 + 说明），不是"看不见"。
  const showFork = forkTarget !== null;
  // 可见 ≠ 可用：流式期间、远程 / 不支持的引擎、纯图片轮、以及这次分叉还在飞，都只
  // 置灰（保留占位，见 ForkButton 的注释）。`scoped?.engine ?? ""` 不在白名单里，
  // 所以"没有会话可归属"时也是禁用态，而不是一颗点了没反应的活按钮。
  const forkUnavailable = showFork
    ? forkUnavailableReason({
        engine: scoped?.engine ?? "",
        remote: sessionRemote,
        imageOnly: !forkTarget.text.trim(),
        live: turnLive || message.live === true,
        pending: forkPending,
      })
    : null;
  const onFork = () =>
    forkTarget && forkTarget.text.trim() && requestFork(forkTarget.text, forkTarget.seq);
  if (message.role === "user") {
    return (
      <UserMessageRow
        message={message}
        showFork={showFork}
        forkUnavailable={forkUnavailable}
        onFork={onFork}
      />
    );
  }
  return (
    <div className="group flex flex-col text-left">
      <Markdown text={text} workspacePath={workspacePath} streaming={message.live} />
      {/* 常驻行（design §4.3.1）：复制/分支一直在，元信息才走 hover。
          这一行不依赖 turnFinal——用户想分叉的那条回复未必是本轮最后一段。 */}
      <div className="mt-1 flex items-center gap-2">
        <MessageActions
          text={message.text}
          showFork={showFork}
          forkUnavailable={forkUnavailable}
          onFork={onFork}
        />
        {turnFinal && <MessageMeta message={message} />}
      </div>
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
        // 对话面可能只是保活挂载（文件/浏览器等中心面在视）。不可见时让位，
        // 否则 ⌘F 会在看不到的对话里开关搜索（Markdown 预览的搜索同时点亮）。
        const el = scrollRef.current;
        if (!el || getComputedStyle(el).visibility === "hidden") return;
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
    [scrollRef],
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
  const wideLayout = useChatStore((s) => s.wideLayout);
  // 分叉入口的可用性在这里取一次再往下传（而不是每行各订阅一次）：会话目录
  // 是长列表，逐行订阅会在每个流式 flush 里重扫一遍。
  const scoped = useScopedSession();
  const sessionRemote = useChatStore((s) => {
    const engine = scoped?.engine;
    const sessionId = scoped?.sessionId;
    if (!engine || !sessionId) return false;
    return s.sessions.some(
      (meta) =>
        meta.engine === engine && meta.sessionId === sessionId && meta.remote === true,
    );
  });
  const forkPending = useChatStore(
    (s) =>
      !!scoped &&
      s.forkingByKey[sessionKey(scoped.engine, scoped.sessionId, scoped.workspacePath)] === true,
  );
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
  // The tail item is the turn-status indicator (or the grey compaction line).
  // A compaction keeps it mounted even between sends, so the line does not
  // blink out in the gap between the compact turn and the resume turn.
  const count = rows.length + (streaming || session.compaction ? 1 : 0);

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
          className={timelineColumnClass(wideLayout)}
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
                  // A host-sent compaction already shows in place (its /compact
                  // row became the grey line), so the tail only carries the
                  // engine's own mid-turn compaction — a flag with no row.
                  session.compaction?.automatic ? (
                    <CompactionCurtain />
                  ) : session.compaction ? null : (
                    <AgentThinking
                      variant="wave"
                      label={t("chat.thinking")}
                      className="py-2"
                      startedAt={session.turnStartedAt ?? undefined}
                      durationFormatter={(d) => t("chat.metaDuration", { duration: d })}
                      model={activeModelFormatted}
                      effort={activeEffortFormatted}
                      usage={liveUsage}
                      metaExtra={<ResponseCheckBadge check={session.responseCheck} />}
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
                  )
                ) : (
                  <TimelineRowView
                    row={rows[item.index]}
                    workspacePath={workspacePath}
                    turnLive={turnLive}
                    autoExpand={
                      rowKey(rows[item.index]) === lastProcessKey ||
                      item.index === currentSearchRow
                    }
                    thinkingAutoCollapse={thinkingAutoCollapse}
                    seenTools={seenTools}
                    searchTarget={item.index === currentSearchRow ? processSearchTarget : undefined}
                    neighbors={session.messages}
                    sessionRemote={sessionRemote}
                    forkPending={forkPending}
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
