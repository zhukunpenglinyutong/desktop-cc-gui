/**
 * 后台复盘的触发与执行（Bot 记忆设置里的「会话结束后后台复盘」）。
 *
 * 规则：
 * - 每累计 `reviewEveryNTurns`（默认 5）轮对话触发一次；
 * - 会话结束（关闭标签、切走）时只要还有没复盘过的轮次，就补一次；
 * - 同一会话同一时间只跑一个；失败会把轮次计数放回去，下次触发重试；
 * - 复盘本身是后端 `memory_review` 命令（用该引擎配置的 API 渠道发一次
 *   HTTP），这里只负责凑上下文、节流，并把结果写进记忆 store 供面板展示。
 *
 * 没有渠道、开关关闭、Bot 已删等情况不在这里判断：开关与 Bot 存在性在组装
 * 上下文时就筛掉，渠道缺失由后端返回 skipped 原因（界面就地说明）。
 */

import { ipc, type BotConfig, type MemoryReviewOutcome, type Message } from "@/lib/ipc";
import { stripAgentBlock } from "@/features/chat/components/agent-block";
import { useMemoryStore } from "./memory";

/** 送给后端的一次复盘输入（transcript 已经裁过一轮，后端还会再裁一次）。 */
export interface ReviewContext {
  /** 会话 key（`engine/sessionId` 或 draft key），只用于本模块去重。 */
  key: string;
  botId: string;
  engine: string;
  providerId: string | null;
  model: string | null;
  /** 该 Bot 的复盘节奏（`reviewEveryNTurns`）。 */
  everyNTurns: number;
  transcript: string;
}

/** Bot 是否参与复盘，以及它的节奏。记忆或复盘关着、Bot 已删都不参与：
 *  复盘是记忆的子功能，没记忆就没有可整理的对象。 */
export function reviewSchedule(
  bot: Pick<BotConfig, "memory"> | null,
): { everyNTurns: number } | null {
  if (!bot || bot.memory.enabled === false || bot.memory.reviewEnabled === false) {
    return null;
  }
  return { everyNTurns: bot.memory.reviewEveryNTurns };
}

/** 一次复盘最多带的对话字符数：超过就只留最近的。 */
const TRANSCRIPT_CHARS = 20_000;
/** 单条消息的字符上限：一条超长粘贴不该把整段对话挤出窗口。 */
const MESSAGE_CHARS = 4_000;

/** 会话消息 → 复盘用文本：只要用户和助手的正文，去掉注入的 Bot 提示块
 *  （账本已经单独带给模型，重复注入只会干扰判断），太长的消息就地截断，
 *  总长超限时保留最近的一段。 */
export function reviewTranscript(messages: Message[]): string {
  const lines: string[] = [];
  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    const raw = message.role === "user" ? stripAgentBlock(message.text).text : message.text;
    const text = raw.trim();
    if (!text) continue;
    // 按字符截（不是 UTF-16 码元）：emoji 截半会变成孤立代理项，过 IPC 时
    // JSON 解析可能直接失败。
    const clipped =
      text.length > MESSAGE_CHARS
        ? `${[...text].slice(0, MESSAGE_CHARS).join("")}……`
        : text;
    lines.push(`${message.role === "user" ? "用户" : "助手"}：${clipped}`);
  }
  const joined = lines.join("\n\n");
  if (joined.length <= TRANSCRIPT_CHARS) return joined;
  // 按字符裁（emoji / 中文不会被劈开）：复盘看的是刚结束的会话，保留尾部。
  const chars = [...joined];
  return `……（更早的对话已省略）\n${chars.slice(chars.length - TRANSCRIPT_CHARS).join("")}`;
}

/** 会话 key → 自上次复盘以来的轮次。内存态：重启后重新计数，不影响正确性
 *  （只是下一次触发来得早一点）。 */
const turnsSinceReview = new Map<string, number>();
/** 正在跑复盘的会话 key，防止同一会话叠请求。 */
const inFlight = new Set<string>();

function restoreTurns(key: string, turns: number) {
  turnsSinceReview.set(key, (turnsSinceReview.get(key) ?? 0) + turns);
}

function report(botId: string, outcome: MemoryReviewOutcome) {
  useMemoryStore.getState().setReview(botId, outcome);
  const store = useMemoryStore.getState();
  // 只有面板正在看这个 Bot 时才刷新：刷新会把 store 的 botId 切走，
  // 让另一个 Bot 的面板显示成空视图。
  if (store.botId === botId && (outcome.applied > 0 || outcome.staged > 0)) {
    void store.refresh(botId);
  }
}

async function runReview(ctx: ReviewContext, turns: number) {
  if (inFlight.has(ctx.key)) {
    restoreTurns(ctx.key, turns);
    return;
  }
  inFlight.add(ctx.key);
  try {
    const outcome = await ipc.memoryReview({
      botId: ctx.botId,
      engine: ctx.engine,
      providerId: ctx.providerId,
      model: ctx.model,
      transcript: ctx.transcript,
    });
    if (
      outcome.status === "failed" ||
      (outcome.status === "skipped" && outcome.message === "busy")
    ) {
      // 失败不吞轮次：渠道抖动、上游 5xx 时下一轮触发会再试；
      // 同一个 Bot 别的会话正在复盘（busy）也不是这次会话的错，放回去等下轮。
      restoreTurns(ctx.key, turns);
    }
    report(ctx.botId, outcome);
  } catch (error) {
    restoreTurns(ctx.key, turns);
    report(ctx.botId, {
      status: "failed",
      applied: 0,
      staged: 0,
      failed: 0,
      message: error instanceof Error ? error.message : String(error),
      at: Date.now(),
    });
  } finally {
    inFlight.delete(ctx.key);
  }
}

/** 一轮对话结束：到节奏就触发，否则只记账。 */
export function noteTurnCompleted(ctx: ReviewContext): void {
  const turns = (turnsSinceReview.get(ctx.key) ?? 0) + 1;
  const every = Math.max(1, ctx.everyNTurns);
  if (turns >= every) {
    turnsSinceReview.set(ctx.key, 0);
    void runReview(ctx, turns);
  } else {
    turnsSinceReview.set(ctx.key, turns);
  }
}

/** 会话结束（关标签 / 切走）：还有没复盘过的轮次就补一次。 */
export function noteSessionEnded(ctx: ReviewContext): void {
  const turns = turnsSinceReview.get(ctx.key) ?? 0;
  if (turns <= 0) return;
  turnsSinceReview.set(ctx.key, 0);
  void runReview(ctx, turns);
}

/** 测试用：清掉进程内的计数与在途标记。 */
export function resetMemoryReviewState(): void {
  turnsSinceReview.clear();
  inFlight.clear();
}
