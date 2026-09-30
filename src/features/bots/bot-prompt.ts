import type { BotConfig } from "@/lib/ipc";

/**
 * Bot → system prompt. One pure function is the single source of truth for
 * both the outgoing prompt (send path) and the editor's 拼装预览 drawer, so
 * what the user reads is what the model gets.
 *
 * Block order is fixed (plan §6.1); empty blocks are dropped whole, never
 * emitted as an empty heading. Limits are advisory: the store never truncates
 * SOUL/AGENTS, it reports the overrun so the editor can say so.
 */

/** Minimal BotConfig for a read-only built-in catalog pick, which arrives as
 *  a name + prompt and has none of the bot machinery (skills, memory, …). */
export function builtInBotShell(name: string, prompt: string): BotConfig {
  return {
    id: "builtin",
    slug: "builtin",
    name,
    title: null,
    description: null,
    avatar: { type: "generated" },
    soul: prompt,
    instructions: "",
    capabilities: { skills: [], tools: [], mcpServers: [] },
    runtime: {
      kind: "direct",
      model: null,
      cwd: null,
      extraArgs: [],
      permissionMode: "ask",
    },
    memory: {
      enabled: false,
      writeApproval: false,
      memoryCharLimit: 2200,
      reviewEnabled: false,
      reviewEveryNTurns: 5,
    },
    source: "builtin",
    builtinId: null,
    pinned: false,
    hidden: false,
    schemaVersion: 1,
    createdAt: 0,
    updatedAt: 0,
  };
}

/** SOUL + AGENTS share this budget; the editor warns above 80% of it. */
export const PROSE_LIMIT = 10_000;
/** Skills *index* budget (name + description only, not the skill bodies). */
export const SKILL_INDEX_LIMIT = 3_000;
/** The global USER profile's budget (per plan §8.1). */
export const USER_LIMIT = 1_375;

export type PromptBlockId =
  | "app"
  | "identity"
  | "soul"
  | "instructions"
  | "user"
  | "memory"
  | "skills"
  | "memoryGuide"
  | "collaborators";

export interface PromptBlock {
  id: PromptBlockId;
  /** Heading as it appears in the prompt ("你的身份"), empty for `app`. */
  title: string;
  text: string;
  chars: number;
  /** Usage ceiling of this block, when it has one. */
  limit?: number;
  /** True when the block contributes nothing and is left out entirely. */
  omitted: boolean;
  /** Set when the block is waiting on a later phase (协作者 / 定时任务 …):
   *  the preview shows 即将支持 instead of pretending the user left it
   *  empty. Memory no longer uses this — its guide is gated by
   *  `memoryAvailable` instead. */
  planned?: number;
  /**
   * `external` blocks belong to the host CLI (its own system prompt) and are
   * shown in the preview for context but are not part of what we build.
   */
  external?: boolean;
  /** First non-empty line, for the preview drawer's one-line summary. */
  preview: string;
}

export interface AssembledPrompt {
  blocks: PromptBlock[];
  /** Everything the bot contributes (metadata lines included). */
  text: string;
  /** Chars of the bot-owned blocks; the host prompt is not counted. */
  totalChars: number;
}

export interface SkillIndexEntry {
  name: string;
  description: string;
}

export interface CollaboratorEntry {
  slug: string;
  description: string;
}

export interface AssembleInput {
  bot: BotConfig;
  /** Localised heading of the host's own system prompt (preview only). */
  appPromptLabel?: string;
  appPromptChars?: number;
  /** Global USER profile, already rendered as `- item` lines. */
  user?: string;
  /** This bot's MEMORY, already rendered as `- item` lines. */
  memory?: string;
  /**
   * Whether the `memory` tool is mounted for this session. Default false:
   * on engines that cannot mount it, injecting the guide would instruct the
   * model to call a tool it cannot call. The tool exists in this build
   * (memory/mcp.rs); the flag is per-engine.
   */
  memoryAvailable?: boolean;
  /** Phase of the memory feature, for the preview's badge. */
  memoryPhase?: number;
  /** Every skill this bot may use (already filtered by its capability list). */
  skills?: SkillIndexEntry[];
  collaborators?: CollaboratorEntry[];
}

/** The fixed 记忆使用说明 body injected when memory is on (plan §8.4). The
 *  heading comes from the block title, so the constant must not carry one of
 *  its own — a duplicated `# 记忆使用说明` is a real tell that the model is
 *  being handed two competing instructions. */
export const MEMORY_GUIDE = `你有持久记忆，下次对话还能看到。用 \`memory\` 工具管理记忆。
注意：只说"我记住了"不会保存任何东西，必须真正调用工具。

## 应该主动保存（不用等用户要求）
- 用户表达了偏好或习惯 → target=user
- 用户纠正了你（"不对，应该……"）→ 把正确做法存到 target=memory
- 你踩了坑并找到了解决办法（报错原因 + 修复方法）→ target=memory
- 项目或环境的固定事实：路径、技术栈、命令、约定 → target=memory
- 完成了重要工作（日期 + 做了什么）→ target=memory
- 用户明确说"记住……"→ 马上保存

## 不要保存
- 琐碎、模糊的信息（例如"用户问了 Python"）
- 上网就能查到的公共知识
- 大段代码、日志、表格
- 只跟这次会话有关的临时信息
- 已经写在"人格"或"工作规则"里的内容
- 任何密钥、密码、token

## 写法
- 每条信息密度要高，写清具体路径、命令、原因
- 用量超过 80% 时，先合并相近的条目再新增
- 发现旧条目过时了，用 replace 或 remove 更新`;

function countChars(text: string): number {
  return [...text].length;
}

function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ""
  );
}

/**
 * Identity block: what other bots read when they consider delegating, and
 * what the model reads to know who it is. Only non-empty parts are listed.
 */
export function identityText(bot: Pick<BotConfig, "name" | "title" | "description">): string {
  const lines = [`你是「${bot.name}」。`];
  if (bot.title?.trim()) lines.push(`头衔：${bot.title.trim()}`);
  if (bot.description?.trim()) lines.push(`简介：${bot.description.trim()}`);
  return lines.join("\n");
}

/**
 * Skills index: name + description only. Truncation is by list order and
 * always leaves a pointer to the rest — the model can still ask for them.
 */
export function skillsIndexText(skills: SkillIndexEntry[]): { text: string; truncated: number } {
  const lines: string[] = [];
  let used = 0;
  let truncated = 0;
  for (const [index, skill] of skills.entries()) {
    const line = `- ${skill.name}：${skill.description}`;
    const cost = countChars(line) + 1;
    if (used + cost > SKILL_INDEX_LIMIT) {
      truncated = skills.length - index;
      break;
    }
    lines.push(line);
    used += cost;
  }
  if (truncated > 0) {
    lines.push(`- 还有 ${truncated} 个 skill 可以用 skill_list 查看`);
  }
  return { text: lines.join("\n"), truncated };
}

function collaboratorsText(collaborators: CollaboratorEntry[]): string {
  return collaborators
    .filter((c) => c.slug.trim())
    .map((c) => (c.description.trim() ? `- @${c.slug}：${c.description.trim()}` : `- @${c.slug}`))
    .join("\n");
}

/**
 * Assemble the bot's contribution to the system prompt.
 *
 * The host's own prompt is reported as an `external` block so the preview can
 * show the whole picture (plan §6.1 block 1) without pretending we author it.
 */
export function assembleBotPrompt(input: AssembleInput): AssembledPrompt {
  const { bot } = input;
  const memoryOn = bot.memory.enabled !== false;
  const memoryAvailable = input.memoryAvailable === true;
  const skills = skillsIndexText(
    (input.skills ?? []).filter((skill) => skill.name.trim().length > 0),
  );
  const collaborators = collaboratorsText(input.collaborators ?? []);

  const drafts: Array<{
    id: PromptBlockId;
    title: string;
    body: string;
    limit?: number;
    planned?: number;
  }> = [
    {
      id: "identity",
      title: "你的身份",
      body: identityText(bot),
    },
    { id: "soul", title: "你的人格", body: (bot.soul ?? "").trim() },
    { id: "instructions", title: "工作规则", body: (bot.instructions ?? "").trim() },
    { id: "user", title: "关于用户 (USER)", body: (input.user ?? "").trim(), limit: USER_LIMIT },
    {
      id: "memory",
      title: "你的笔记 (MEMORY)",
      body: (input.memory ?? "").trim(),
      limit: bot.memory.memoryCharLimit,
    },
    { id: "skills", title: "可用 Skills", body: skills.text, limit: SKILL_INDEX_LIMIT },
    {
      id: "memoryGuide",
      title: "记忆使用说明",
      body: memoryOn && memoryAvailable ? MEMORY_GUIDE : "",
      planned: memoryOn && !memoryAvailable ? (input.memoryPhase ?? 2) : undefined,
    },
    { id: "collaborators", title: "协作者", body: collaborators },
  ];

  const blocks: PromptBlock[] = drafts.map((draft) => ({
    id: draft.id,
    title: draft.title,
    text: draft.body,
    chars: countChars(draft.body),
    limit: draft.limit,
    omitted: draft.body.length === 0,
    planned: draft.planned,
    preview: firstLine(draft.body),
  }));

  const head = [
    {
      id: "app" as const,
      title: input.appPromptLabel ?? "应用基础系统提示",
      text: "",
      chars: input.appPromptChars ?? 0,
      omitted: false,
      external: true,
      preview: "由当前引擎提供，不由 Bot 配置生成",
    },
    ...blocks,
  ];

  const body = blocks
    .filter((block) => !block.omitted)
    .map((block) => `# ${block.title}\n${block.text}`)
    .join("\n\n");

  return {
    blocks: head,
    text: body,
    totalChars: countChars(body),
  };
}

/** True once SOUL + AGENTS exceed the shared budget — the editor's red state. */
export function proseOverLimit(bot: Pick<BotConfig, "soul" | "instructions">): boolean {
  return countChars(bot.soul ?? "") + countChars(bot.instructions ?? "") > PROSE_LIMIT;
}

/**
 * Phrases that appear in both SOUL and AGENTS: the model reads them twice, so
 * the editor nudges the user to keep each statement in one place. Cheap
 * heuristic on purpose — it only produces a hint, never a block.
 *
 * Lines shorter than six code points are ignored: bullets like "说人话" or
 * "1." would otherwise fire on ordinary prose, and a hint that cries wolf is
 * worse than no hint.
 */
export function duplicateProseLines(
  bot: Pick<BotConfig, "soul" | "instructions">,
): string[] {
  const normalize = (line: string) => line.replace(/^[-*\d.\s]+/, "").trim();
  const significant = (line: string) => line.length >= 6;
  const soulLines = new Set(
    (bot.soul ?? "")
      .split("\n")
      .map(normalize)
      .filter(significant),
  );
  return (bot.instructions ?? "")
    .split("\n")
    .map(normalize)
    .filter((line) => significant(line) && soulLines.has(line));
}
