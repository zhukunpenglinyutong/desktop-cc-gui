import { listen } from "@/lib/transport";
import { listenEngineEvents, type EngineEventPayload } from "@/lib/events";
import type { Disposer } from "@ccgui/plugin-sdk";

/**
 * Plugin event bus (plan §5.2 ctx.events). Carries host→plugin topics (e.g.
 * `usage://updated`, bridged from engine events below) and plugin↔plugin
 * topics. Delivery is synchronous; listener errors are isolated so one bad
 * plugin can't break the bus for others.
 */
type Listener = (data: unknown) => void;

/** Topic plugins subscribe to for live token-usage snapshots (plan §5.2). */
export const USAGE_UPDATED_TOPIC = "usage://updated";

/** Engine `done` events (SDK 0.3.8): `data.usage` carries the turn's final
 *  usage, the only usage channel for engines like claude/grok that never
 *  emit a standalone usage event, and the precise turn-end signal for all
 *  others. */
export const USAGE_DONE_TOPIC = "usage://done";

/** Active-session switches (SDK 0.3.8, selection since 0.3.21):
 *  `{ engine, sessionId, provider, model }`; a pending tab reports sessionId
 *  null, clearing all tabs reports everything null. `provider` is the channel
 *  id the session runs with, or null when the engine uses its own settings;
 *  `model` is the picker's selector (e.g. `deepseek/deepseek-flash`), or null
 *  for the CLI default. */
export const SESSION_ACTIVATED_TOPIC = "session://activated";

/** Provider/model changed for the session that is already active (SDK 0.3.21).
 *  Same payload as `session://activated`, so consumers can merge both: the
 *  activation event is the baseline, this one keeps it current. */
export const SESSION_SELECTION_CHANGED_TOPIC = "session://selection-changed";

/** What the active session runs: the selected channel (null = the engine's
 *  own settings) and the model selector the picker spells (null = CLI default). */
export interface SessionSelection {
  provider: string | null;
  model: string | null;
}

/** Host→plugin topic carrying the composer's in-progress draft (plan §5.2). */
export const COMPOSER_DRAFT_TOPIC = "composer://draft";

/**
 * Retained topics: the latest payload is replayed to late subscribers.
 *
 * `session://activated` is retained because the host emits it while the chat
 * store hydrates on app start (restored tabs go through activateTab then
 * selectSession), typically before plugins finish loading (read main.js,
 * dynamic import, activate - each async). A plugin subscribing later would
 * otherwise never learn the active session/engine, and the SDK exposes no
 * getter to ask for it. Replay is idempotent for consumers (the same value
 * they would have received live); every other topic stays fire-and-forget.
 * A `session://selection-changed` for the same session rewrites this retained
 * payload, so a plugin that loads after a model/channel switch still replays
 * the current selection rather than the activation-time one.
 */
const RETAINED_TOPICS = new Set<string>([SESSION_ACTIVATED_TOPIC]);
const retained = new Map<string, unknown>();

const listeners = new Map<string, Set<Listener>>();

export const pluginBus = {
  on(topic: string, cb: Listener): Disposer {
    let set = listeners.get(topic);
    if (!set) {
      set = new Set();
      listeners.set(topic, set);
    }
    set.add(cb);
    // Late subscriber on a retained topic: deliver the current value once, so
    // "which session is active right now" is answerable at any point in time.
    if (RETAINED_TOPICS.has(topic) && retained.has(topic)) {
      try {
        cb(retained.get(topic));
      } catch (error) {
        console.error(`[plugins] retained listener on "${topic}" threw`, error);
      }
    }
    return () => {
      set.delete(cb);
      if (set.size === 0) listeners.delete(topic);
    };
  },

  emit(topic: string, data: unknown): void {
    if (RETAINED_TOPICS.has(topic)) retained.set(topic, data);
    const set = listeners.get(topic);
    if (!set) return;
    for (const cb of [...set]) {
      try {
        cb(data);
      } catch (error) {
        console.error(`[plugins] listener on "${topic}" threw`, error);
      }
    }
  },
};

/** Drop listeners and retained payloads (tests only). */
export function resetPluginBusForTests(): void {
  listeners.clear();
  retained.clear();
}

/**
 * Emit-side topic namespace guard (plan §5.2): a plugin may emit only its own
 * `plugin:<id>:*` topics and shared `plugin-`-prefixed topics (e.g.
 * plugin-config://changed). Host topics (usage://updated, composer://draft)
 * and other plugins' `plugin:<otherId>:*` namespaces throw, because emit is
 * broadcast: cross-namespace writes would let one plugin impersonate the
 * host or spam a sibling.
 */
export function assertPluginEmitTopic(pluginId: string, topic: string): void {
  if (topic.startsWith(`plugin:${pluginId}:`) || topic.startsWith("plugin-")) return;
  throw new Error(
    `[plugins] "${pluginId}" may not emit topic "${topic}" (allowed: plugin:${pluginId}:* or shared plugin-*)`,
  );
}

let bridged = false;
let agentBridged = false;

/** 插件 agent 事件话题前缀：agent://<pluginId>，payload 为引擎事件信封。 */
export const AGENT_EVENT_TOPIC_PREFIX = "agent://";

/** run id 内嵌属主（Rust plugin_agent_start: pa-<pluginId>-<32hex>）。 */
export function pluginIdFromAgentRunId(runId: string): string | null {
  if (!runId.startsWith("pa-") || runId.length <= 36) return null;
  return runId.slice(3, -33);
}

/**
 * 把插件 agent 轮次的独立事件流（plugin-agent://event）按 run id 前缀
 * 路由回属主插件的总线话题。与聊天引擎流隔离：插件 run 不会进 chat
 * store，chat store 也不会收养这些事件。
 */
export function bridgePluginAgentEvents(): void {
  if (agentBridged) return;
  agentBridged = true;
  void listen<EngineEventPayload[]>("plugin-agent://event", (e) => {
    for (const event of e.payload) {
      const pluginId = pluginIdFromAgentRunId(event.runId);
      if (pluginId) pluginBus.emit(`${AGENT_EVENT_TOPIC_PREFIX}${pluginId}`, event);
    }
  });
}

/**
 * Re-emit engine `usage` events onto the plugin bus. Bound once at plugin
 * bootstrap; plugins never touch the raw engine stream (they have no invoke).
 */
export function bridgeUsageEvents(): void {
  if (bridged) return;
  bridged = true;
  void listenEngineEvents((batch) => {
    for (const event of batch) {
      if (event.kind === "usage") pluginBus.emit(USAGE_UPDATED_TOPIC, event);
      else if (event.kind === "done") pluginBus.emit(USAGE_DONE_TOPIC, event);
    }
  });
}

/** Emit an active-session switch onto the plugin bus (chat store calls this
 *  from activateTab/selectSession). Not part of bridgeUsageEvents: the source
 *  is the store, not the engine stream. Retained, so plugins that finish
 *  loading later still receive the latest value when they subscribe. */
export function emitSessionActivated(
  engine: string | null,
  sessionId: string | null,
  selection: Partial<SessionSelection> = {},
): void {
  pluginBus.emit(SESSION_ACTIVATED_TOPIC, {
    engine,
    sessionId,
    provider: selection.provider ?? null,
    model: selection.model ?? null,
  });
}

/** Emit a provider/model change for the already-active session. The retained
 *  activation payload is kept in step, so a plugin that loads after the change
 *  still replays the current selection instead of a stale one. */
export function emitSessionSelectionChanged(
  engine: string,
  sessionId: string | null,
  selection: SessionSelection,
): void {
  const payload = {
    engine,
    sessionId,
    provider: selection.provider ?? null,
    model: selection.model ?? null,
  };
  const current = retained.get(SESSION_ACTIVATED_TOPIC) as
    | { engine?: unknown; sessionId?: unknown }
    | undefined;
  if (current?.engine === engine && current.sessionId === sessionId) {
    retained.set(SESSION_ACTIVATED_TOPIC, payload);
  }
  pluginBus.emit(SESSION_SELECTION_CHANGED_TOPIC, payload);
}
