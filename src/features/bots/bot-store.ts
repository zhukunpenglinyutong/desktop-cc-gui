/**
 * Bots: the app-wide cache of `~/.ccgui-next/bots` behind the `bot_*` IPC
 * commands, plus the bundled read-only built-in catalog whose enabled entries
 * merge into the same composer `#` menu. Every mutation goes through this
 * store, then refreshes and broadcasts BOTS_CHANGED_EVENT so non-store
 * listeners (selected-bot persistence pruning a deleted bot, the message badge
 * resolving an avatar) re-read too.
 */

import { create } from "zustand";
import i18n from "@/lib/i18n";
import {
  ipc,
  type BotConfig,
  type BotCreateInput,
  type BotPatch,
  type BuiltInAgentDivisionView,
  type BuiltInAgentView,
} from "@/lib/ipc";

/** Broadcast after any bot mutation (window CustomEvent, no detail). */
export const BOTS_CHANGED_EVENT = "ccgui-next:bots-changed";

/** Subscribe to bot-list mutations; returns the unlisten fn. */
export function subscribeBotsChanged(listener: () => void): () => void {
  window.addEventListener(BOTS_CHANGED_EVENT, listener);
  return () => window.removeEventListener(BOTS_CHANGED_EVENT, listener);
}

function notifyBotsChanged(): void {
  window.dispatchEvent(new CustomEvent(BOTS_CHANGED_EVENT));
}

/** Locale argument for `listBuiltInAgents`: catalog names/descriptions ship
 *  per-language, so pickers follow the UI language. */
export function currentCatalogLocale(): string {
  return i18n.resolvedLanguage ?? i18n.language;
}

interface BotStore {
  bots: BotConfig[];
  /** Enabled built-in catalog entries, merged into the `#` menu. */
  builtInAgents: BuiltInAgentView[];
  /** Catalog divisions in display order, for the menu's section headers. */
  builtInDivisions: BuiltInAgentDivisionView[];
  /** False until the first refresh settles — lets pickers show loading. */
  loaded: boolean;
  /** Re-fetch both lists; concurrent calls share one IPC round-trip. Never
   *  rejects: a failure keeps the previous list (stale-on-error model). */
  refresh: () => Promise<void>;
  create: (input: BotCreateInput) => Promise<BotConfig>;
  update: (id: string, patch: BotPatch) => Promise<BotConfig | null>;
  remove: (id: string) => Promise<void>;
  duplicate: (id: string) => Promise<BotConfig | null>;
}

/** In-flight refresh shared by concurrent callers. */
let refreshInFlight: Promise<void> | null = null;

/** Call an IPC method that may be missing in a partial test/web bridge, and
 *  never throw: the store's contract is "a failure keeps the previous list",
 *  which has to include a synchronously-throwing call. */
function safe<T>(call: () => Promise<T>): Promise<T | null> {
  try {
    return call().catch(() => null);
  } catch {
    return Promise.resolve(null);
  }
}

export const useBotStore = create<BotStore>()((set, get) => ({
  bots: [],
  builtInAgents: [],
  builtInDivisions: [],
  loaded: false,
  refresh: () => {
    if (refreshInFlight) return refreshInFlight;
    const p = Promise.all([
      safe(() => ipc.listBots()),
      // The catalog is a bundled read-only resource; a failure keeps the
      // previous built-in list.
      safe(() => ipc.listBuiltInAgents(currentCatalogLocale())),
    ])
      .then(([bots, catalog]) =>
        set((s) => ({
          bots: bots ?? s.bots,
          builtInAgents: catalog
            ? catalog.agents.filter((agent) => agent.enabled)
            : s.builtInAgents,
          builtInDivisions: catalog ? catalog.divisions : s.builtInDivisions,
          loaded: true,
        })),
      )
      .finally(() => {
        refreshInFlight = null;
      });
    refreshInFlight = p;
    return p;
  },
  create: async (input) => {
    const bot = await ipc.createBot(input);
    // Dispatch before refreshing: subscribers' refreshes then join the
    // in-flight fetch below instead of firing a second one.
    notifyBotsChanged();
    await get().refresh();
    return bot;
  },
  update: async (id, patch) => {
    const bot = await ipc.updateBot(id, patch);
    notifyBotsChanged();
    await get().refresh();
    return bot;
  },
  remove: async (id) => {
    await ipc.deleteBot(id);
    notifyBotsChanged();
    await get().refresh();
  },
  duplicate: async (id) => {
    const bot = await ipc.duplicateBot(id);
    notifyBotsChanged();
    await get().refresh();
    return bot;
  },
}));

// Mutations from any surface revalidate the cache.
subscribeBotsChanged(() => {
  void useBotStore.getState().refresh();
});

// Catalog strings are localized: re-fetch when the UI language changes.
i18n.on("languageChanged", () => {
  void useBotStore.getState().refresh();
});

/** Non-hook lookup for the send path and the message badge. */
export function botById(id: string | null | undefined): BotConfig | null {
  if (!id) return null;
  return useBotStore.getState().bots.find((bot) => bot.id === id) ?? null;
}

/** Non-hook lookup by `@` handle (delegation, group chat). */
export function botBySlug(slug: string): BotConfig | null {
  const wanted = slug.replace(/^@/, "").toLowerCase();
  return (
    useBotStore.getState().bots.find((bot) => bot.slug.toLowerCase() === wanted) ?? null
  );
}

/** Bots the `#` picker offers: hidden ones stay in settings only. */
export function visibleBots(bots: BotConfig[]): BotConfig[] {
  return bots.filter((bot) => !bot.hidden);
}

/** `#` picker filter: case-insensitive substring over the fields a user can
 *  see or type — name, title, description and the `@` handle (which doubles
 *  as the pinyin-ish key for a Chinese name). */
export function matchBots(bots: BotConfig[], query: string): BotConfig[] {
  const q = query.trim().toLowerCase().replace(/^@/, "");
  if (!q) return bots;
  return bots.filter(
    (bot) =>
      bot.name.toLowerCase().includes(q) ||
      (bot.title ?? "").toLowerCase().includes(q) ||
      (bot.description ?? "").toLowerCase().includes(q) ||
      bot.slug.toLowerCase().includes(q),
  );
}

/** Same filter for built-in catalog rows: name + description (they carry
 *  no prompt — that resolves at send time). */
export function matchBuiltInAgents(
  agents: BuiltInAgentView[],
  query: string,
): BuiltInAgentView[] {
  const q = query.trim().toLowerCase();
  if (!q) return agents;
  return agents.filter(
    (agent) =>
      agent.name.toLowerCase().includes(q) ||
      agent.description.toLowerCase().includes(q),
  );
}
