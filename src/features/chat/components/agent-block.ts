/**
 * The agent-role block sendPrompt appends to an outgoing prompt when a
 * selected agent carries instructions. It is part of the committed history
 * (so the transcript the CLI sees matches ours), but the user bubble strips
 * it and shows a small badge instead.
 */
export const AGENT_BLOCK_HEADER = "## Agent Role and Instructions";

/** Tail block: two blank-line separated `## Agent Role and Instructions`
 *  through end of text, or the same header opening the whole message. The
 *  `[\s\S]*$` body also matches a streaming half-block that has no end yet. */
const AGENT_BLOCK_TAIL_REGEX =
  /(?:\r?\n\r?\n|^)##\s*Agent Role and Instructions\s*(?:\r?\n)+([\s\S]*)$/;
const AGENT_NAME_LINE_REGEX = /^Agent Name:[ \t]*(.+)$/m;
const AGENT_ICON_LINE_REGEX = /^Agent Icon:[ \t]*(.*)$/m;
const BOT_ID_LINE_REGEX = /^Bot Id:[ \t]*(.*)$/m;

export interface StrippedAgentBlock {
  /** Message text with the agent block removed (trimmed of trailing space). */
  text: string;
  agentName?: string;
  agentIcon?: string;
  /** Bot the block was built from — lets the badge render a generated avatar. */
  botId?: string;
}

/** True when the prompt already ends with an injected agent block, so a
 *  re-send of a committed user message (grant retry) never double-injects. */
export function hasAgentBlock(text: string): boolean {
  return AGENT_BLOCK_TAIL_REGEX.test(text);
}

/** Build the block sendPrompt appends after the user's prompt. `body` is the
 *  assembled bot prompt (see features/bots/bot-prompt.ts). `botId` rides
 *  along so the transcript badge can resolve a generated avatar; it is part
 *  of the committed text, exactly like the name and icon lines. */
export function buildBotBlock(input: {
  name: string;
  icon?: string;
  botId?: string;
  body: string;
}): string {
  const idLine = input.botId ? `Bot Id: ${input.botId}\n\n` : "";
  return `\n\n${AGENT_BLOCK_HEADER}\n\nAgent Name: ${input.name}\n\nAgent Icon: ${input.icon ?? ""}\n\n${idLine}${input.body}`;
}

export function stripAgentBlock(text: string): StrippedAgentBlock {
  const match = AGENT_BLOCK_TAIL_REGEX.exec(text);
  if (!match || match.index < 0) return { text };
  const block = match[1] ?? "";
  const name = AGENT_NAME_LINE_REGEX.exec(block)?.[1]?.trim();
  const icon = AGENT_ICON_LINE_REGEX.exec(block)?.[1]?.trim();
  const botId = BOT_ID_LINE_REGEX.exec(block)?.[1]?.trim();
  return {
    // A message that opens with the block and has nothing before it
    // displays an empty body; the badge still carries the agent identity.
    text: text.slice(0, match.index).replace(/\s+$/, ""),
    agentName: name || undefined,
    agentIcon: icon || undefined,
    botId: botId || undefined,
  };
}
