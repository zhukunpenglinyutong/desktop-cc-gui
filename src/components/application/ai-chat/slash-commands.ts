import { ipc, type SlashCommandEntry } from "@/lib/ipc";
import {
  createRootCacheStore,
  type RootCache,
} from "@/components/application/ai-chat/create-root-cache-store";

/**
 * Catalog for the composer's `/` picker, ported from desktop-cc-gui's
 * slash-command completion (claude_commands.rs + ChatInputBoxAdapter) and
 * extended with skills. The Rust side scans the workspace's `.claude/`
 * plus the CLIs' global skill roots (Claude home, `$CODEX_HOME/skills`
 * incl. `.system`, `~/.agents/skills`, Codex plugin cache) for two
 * distinct kinds — commands (markdown under `commands/`) and skills
 * (`skills/<name>/SKILL.md`) — via
 * `entry.kind`; this store caches the catalog per workspace root with the
 * same stale-while-revalidate model as the @-mention file index
 * (createRootCacheStore) — one IPC per TTL window, matching is pure JS per
 * keystroke.
 */

/** An active `/query` trigger at the caret: `start` is the offset of the
 *  `/` itself, `query` is the text typed after it. */
export interface SlashTrigger {
  start: number;
  query: string;
}

/**
 * Find the `/` command trigger spanning the caret, if any. A trigger is a
 * `/` at the start of a line (desktop-cc-gui parity: mid-line slashes are
 * paths, not commands) whose query contains no whitespace — the first
 * space after the command ends the trigger.
 */
export function findSlashTrigger(text: string, caret: number): SlashTrigger | null {
  if (caret <= 0 || caret > text.length) return null;
  let start = caret - 1;
  while (start >= 0) {
    const ch = text[start];
    if (ch === "/" || /\s/.test(ch)) break;
    start--;
  }
  if (start < 0 || text[start] !== "/") return null;
  // Only line-start slashes open the picker (text start or after a newline).
  if (start > 0 && text[start - 1] !== "\n") return null;
  const query = text.slice(start + 1, caret);
  if (query.length > 64) return null;
  return { start, query };
}

export type RootCommands = RootCache<SlashCommandEntry>;

const COMMANDS_TTL_MS = 60_000;

const { useStore: useSlashCommandStore, prune: pruneSlashCommands } =
  createRootCacheStore<SlashCommandEntry>({
    fetch: (root) => ipc.listSlashCommands(root),
    ttlMs: COMMANDS_TTL_MS,
  });

/** Drop one workspace root's cached catalog when its workspace is removed;
 * the per-root cache would otherwise accumulate every root ever opened. */
export { useSlashCommandStore, pruneSlashCommands };

/** Max rows the picker renders — caps DOM work regardless of match count. */
export const SLASH_MENU_LIMIT = 50;

/**
 * Catalog filter for a trigger query (desktop-cc-gui parity): case-
 * insensitive substring over the command name and its description, keeping
 * the backend's alphabetical order.
 */
export function matchSlashCommands(
  entries: SlashCommandEntry[],
  query: string,
  limit = SLASH_MENU_LIMIT,
): SlashCommandEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries.slice(0, limit);
  const out: SlashCommandEntry[] = [];
  for (const entry of entries) {
    if (
      entry.name.toLowerCase().includes(q) ||
      (entry.description ?? "").toLowerCase().includes(q)
    ) {
      out.push(entry);
      if (out.length >= limit) break;
    }
  }
  return out;
}
