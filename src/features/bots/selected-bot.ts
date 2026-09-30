import { useCallback } from "react";
import { create } from "zustand";
import type { BotAvatar } from "@/lib/ipc";
import { readStoredJson, writeStored } from "@/lib/storage";
import { avatarFromLegacyIcon } from "./bot-avatar";

/**
 * Per-thread pinned bot, persisted across restarts. Draft tabs (no session id
 * yet) share the `${root}::draft` slot; when the engine stamps a native session
 * id, `migrateSelectedBot` moves the entry onto the real key so the selection
 * survives the draft → session transition.
 *
 * The record carries a *frozen* prompt block: assembled the first time the
 * thread sends with this bot and reused for the rest of the session, so a
 * mid-session edit (or another window's edit) can never change the prompt of a
 * conversation already in flight — the same rule the plan applies to
 * `Session.promptSnapshot`. `刷新上下文` clears it to re-assemble.
 */
const STORAGE_KEY = "ccgui-next.selectedBotByThread:v1";
/** v1 key: agent picks. Read once and converted, never written back. */
const LEGACY_STORAGE_KEY = "ccgui-next.selectedAgentByThread:v1";
const DRAFT_SESSION = "draft";

export interface SelectedBot {
  id: string;
  name: string;
  title?: string;
  slug?: string;
  avatar: BotAvatar;
  /** Built-in catalog picks carry no prompt: it resolves at send time. */
  source?: "custom" | "builtIn";
  /** Frozen `## Agent Role and Instructions` block (see the module comment). */
  block?: string;
  /** When `block` was last assembled; the editor shows it as "本次会话的提示词". */
  assembledAt?: number;
}

export function selectedBotKey(root: string, sessionId: string | null): string {
  return `${root}::${sessionId ?? DRAFT_SESSION}`;
}

function validate(value: unknown): Record<string, SelectedBot> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, SelectedBot> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!entry || typeof entry !== "object") continue;
    const bot = entry as SelectedBot;
    if (typeof bot.id !== "string" || typeof bot.name !== "string") continue;
    out[key] = {
      ...bot,
      avatar: bot.avatar ?? avatarFromLegacyIcon(null, bot.id),
    };
  }
  return out;
}

/** v1 agent pick → bot pick: the icon string becomes an avatar, and a
 *  custom pick's inline prompt is dropped (the block is re-assembled from the
 *  migrated bot, which now owns that text). */
function convertLegacy(
  value: unknown,
): Record<string, SelectedBot> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, SelectedBot> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!entry || typeof entry !== "object") continue;
    const agent = entry as {
      id?: unknown;
      name?: unknown;
      icon?: unknown;
      source?: unknown;
    };
    if (typeof agent.id !== "string" || typeof agent.name !== "string") continue;
    out[key] = {
      id: agent.id,
      name: agent.name,
      avatar: avatarFromLegacyIcon(
        typeof agent.icon === "string" ? agent.icon : null,
        agent.id,
      ),
      source: agent.source === "builtIn" ? "builtIn" : "custom",
    };
  }
  return out;
}

function loadInitial(): Record<string, SelectedBot> {
  const current = readStoredJson(STORAGE_KEY, validate);
  if (current) return current;
  const legacy = readStoredJson(LEGACY_STORAGE_KEY, convertLegacy);
  if (!legacy) return {};
  // One-way: write the converted picks under the new key. The v1 key is left
  // untouched so a downgrade still finds its own data.
  writeStored(STORAGE_KEY, JSON.stringify(legacy));
  return legacy;
}

interface SelectedBotState {
  byThread: Record<string, SelectedBot>;
  select(key: string, bot: SelectedBot): void;
  /** Merge fields into an existing pick (used to freeze the prompt block). */
  patch(key: string, patch: Partial<SelectedBot>): void;
  clear(key: string): void;
  migrate(root: string, sessionId: string): void;
  /** Drop a bot from every thread (a deleted bot must not stay pinned). */
  forgetBot(botId: string): void;
}

function persist(
  byThread: Record<string, SelectedBot>,
): { byThread: Record<string, SelectedBot> } {
  writeStored(STORAGE_KEY, JSON.stringify(byThread));
  return { byThread };
}

const useSelectedBotStore = create<SelectedBotState>((set, get) => ({
  byThread: loadInitial(),
  select: (key, bot) =>
    set((s) => persist({ ...s.byThread, [key]: { ...bot, block: undefined } })),
  patch: (key, patch) =>
    set((s) => {
      const current = s.byThread[key];
      if (!current) return s;
      return persist({ ...s.byThread, [key]: { ...current, ...patch } });
    }),
  clear: (key) =>
    set((s) => {
      if (!(key in s.byThread)) return s;
      const next = { ...s.byThread };
      delete next[key];
      return persist(next);
    }),
  migrate: (root, sessionId) =>
    set((s) => {
      const draftKey = selectedBotKey(root, null);
      const nextKey = selectedBotKey(root, sessionId);
      const bot = s.byThread[draftKey];
      if (!bot || s.byThread[nextKey]) return s;
      const next = { ...s.byThread, [nextKey]: bot };
      delete next[draftKey];
      return persist(next);
    }),
  forgetBot: (botId) => {
    const { byThread } = get();
    if (!Object.values(byThread).some((bot) => bot.id === botId)) return;
    const next: Record<string, SelectedBot> = {};
    for (const [key, bot] of Object.entries(byThread)) {
      if (bot.id !== botId) next[key] = bot;
    }
    set(persist(next));
  },
}));

/** Hook for the composer pickers: the bot pinned to this thread. */
export function useSelectedBot(root: string, sessionId: string | null) {
  const key = selectedBotKey(root, sessionId);
  const bot = useSelectedBotStore((s) => s.byThread[key] ?? null);
  const selectEntry = useSelectedBotStore((s) => s.select);
  const clearEntry = useSelectedBotStore((s) => s.clear);
  return {
    bot,
    select: useCallback(
      (next: SelectedBot) => selectEntry(key, next),
      [selectEntry, key],
    ),
    clear: useCallback(() => clearEntry(key), [clearEntry, key]),
  };
}

/** Non-hook read for the send path. */
export function getSelectedBot(
  root: string,
  sessionId: string | null,
): SelectedBot | null {
  return useSelectedBotStore.getState().byThread[selectedBotKey(root, sessionId)] ?? null;
}

/** Non-hook select, the write half of getSelectedBot (send path, tests). */
export function selectSelectedBot(
  root: string,
  sessionId: string | null,
  bot: SelectedBot,
): void {
  useSelectedBotStore.getState().select(selectedBotKey(root, sessionId), bot);
}

/** Non-hook clear for the send path (e.g. a built-in pick whose catalog
 *  entry was disabled since). */
export function clearSelectedBot(root: string, sessionId: string | null): void {
  useSelectedBotStore.getState().clear(selectedBotKey(root, sessionId));
}

/** Freeze the assembled prompt block onto this thread's pick. */
export function freezeSelectedBotBlock(
  root: string,
  sessionId: string | null,
  block: string,
): void {
  useSelectedBotStore
    .getState()
    .patch(selectedBotKey(root, sessionId), { block, assembledAt: Date.now() });
}

/** Drop the frozen block so the next send re-assembles it (刷新上下文). */
export function refreshSelectedBotBlock(root: string, sessionId: string | null): void {
  useSelectedBotStore
    .getState()
    .patch(selectedBotKey(root, sessionId), { block: undefined, assembledAt: undefined });
}

/** Move a draft-tab selection onto the freshly stamped native session id. */
export function migrateSelectedBot(root: string, sessionId: string): void {
  useSelectedBotStore.getState().migrate(root, sessionId);
}

/** Forget a deleted bot everywhere it was pinned. */
export function forgetBotSelection(botId: string): void {
  useSelectedBotStore.getState().forgetBot(botId);
}

/** Drop the frozen block of every thread that has this bot pinned, so the
 *  next send in each of them re-assembles it (the editor's 刷新上下文).
 *  Returns how many threads were affected — 0 is worth reporting. */
export function refreshBotBlocks(botId: string): number {
  const store = useSelectedBotStore.getState();
  let touched = 0;
  for (const [key, bot] of Object.entries(store.byThread)) {
    if (bot.id !== botId || bot.block === undefined) continue;
    store.patch(key, { block: undefined, assembledAt: undefined });
    touched += 1;
  }
  return touched;
}
