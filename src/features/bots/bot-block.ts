import { ipc, type BotConfig } from "@/lib/ipc";
import { cachedInstalledSkills } from "@/features/skills/api";
import { buildBotBlock } from "@/features/chat/components/agent-block";
import { assembleBotPrompt, type SkillIndexEntry } from "./bot-prompt";
import { renderMemory } from "./memory";

/**
 * Bot → outgoing prompt block. The send path freezes the result on the
 * thread's selection (see selected-bot.ts), so this runs once per session,
 * not once per message.
 *
 * What goes in is what exists: identity, SOUL, AGENTS, the skills index, the
 * global USER profile and this bot's MEMORY. The memory guide is included
 * only when `memoryToolAvailable` is true (the engine can mount the app's
 * memory MCP server, see features/bots/memory.ts) — otherwise the model
 * would be told to call a tool it cannot call. 协作者 arrives with
 * delegation; `assembleBotPrompt` marks it as planned instead of silently
 * leaving it out.
 */

/** Avatar → the single character the transcript badge can carry. Generated
 *  and image avatars carry none: the badge resolves those from the bot id. */
export function avatarGlyph(bot: BotConfig): string {
  return bot.avatar.type === "emoji" ? (bot.avatar.value?.trim() ?? "") : "";
}

/** Enabled skills of one bot. `["*"]` means every skill the hub knows. */
export async function skillIndexFor(bot: BotConfig): Promise<SkillIndexEntry[]> {
  const enabled = bot.capabilities.skills;
  if (enabled.length === 0) return [];
  const all = await cachedInstalledSkills().catch(() => null);
  if (!all) return [];
  const entries = all.skills.map((skill) => ({
    name: skill.name,
    description: skill.description,
  }));
  if (enabled.includes("*")) return entries;
  // A skill the user enabled but that has since been uninstalled simply
  // drops out of the index; the bot keeps working without it.
  return entries.filter((entry) => enabled.includes(entry.name));
}

/**
 * The two ledgers, already rendered as `- item` lines. A read failure is not
 * fatal to the turn: memory is context, and sending without it beats refusing
 * to send at all. It is logged so a persistent failure is visible.
 */
async function memoryForPrompt(
  bot: BotConfig,
): Promise<{ user: string; memory: string }> {
  try {
    const view = await ipc.memoryList(bot.id);
    return {
      user: renderMemory(view.user.entries),
      memory: view.memory ? renderMemory(view.memory.entries) : "",
    };
  } catch (error) {
    console.warn("[memory] loading ledgers for the prompt failed", error);
    return { user: "", memory: "" };
  }
}

/** Build the `## Agent Role and Instructions` tail block for a bot. */
export async function buildBotPromptBlock(
  bot: BotConfig,
  options?: { memoryToolAvailable?: boolean },
): Promise<string> {
  const skills = await skillIndexFor(bot);
  const memoryOn = bot.memory.enabled !== false;
  const ledgers = memoryOn ? await memoryForPrompt(bot) : null;
  const assembled = assembleBotPrompt({
    bot,
    skills,
    user: ledgers?.user,
    memory: ledgers?.memory,
    memoryAvailable: memoryOn && options?.memoryToolAvailable === true,
  });
  return buildBotBlock({
    name: bot.name,
    icon: avatarGlyph(bot),
    botId: bot.id,
    body: assembled.text,
  });
}
