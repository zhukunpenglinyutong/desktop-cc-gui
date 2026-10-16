import { readStoredJson, writeStored } from "@/lib/storage";
import type { EffortLevel } from "@/components/application/ai-chat/cli-menu";

/**
 * Tab/active-session persistence (localStorage) plus the session-key helpers
 * every chat module shares. Leaf module: no store imports, so stream and
 * engine-events can both build on it without cycles.
 */

export interface ActiveSession {
  engine: string;
  /** null => not yet created (first message not sent) */
  sessionId: string | null;
  workspacePath: string;
  /** Per-tab model override; undefined => follow the engine's global default. */
  model?: string;
  /** Per-tab effort override; undefined => follow the engine's global default. */
  effort?: EffortLevel;
  /** Per-tab channel override; undefined => follow the engine's `current`.
   *  Only a pending (sessionId === null) tab may carry this; native sessions
   *  own the channel in SessionState / session_providers. */
  provider?: string;
}

export function sessionKey(
  engine: string,
  sessionId: string | null,
  workspacePath: string,
) {
  return sessionId
    ? `${engine}/${sessionId}`
    : `new:${engine}:${workspacePath}`;
}

/** 还没有任何标签页时的草稿归属（`sessionKey` 在 `active === null` 时返回的
 *  空串）。输入框此时仍可输入，字就落在这个键上——它属于用户接下来的第一个
 *  会话，`startNewChat` 会把这份草稿搬过去并删掉本键（见 store/tabs.ts）。 */
export const UNBOUND_DRAFT_KEY = "";

/** `sessionKey` 待发键的逆：插件轮次（ctx.sessions.startRun）不占标签页，
 *  会话事件里的工作区只能从路由键取（见 engine-events onSession）。非待发
 *  键返回 ""，调用方继续走原来的回落。 */
export function pendingWorkspaceOfKey(engine: string, key: string): string {
  const prefix = `new:${engine}:`;
  return key.startsWith(prefix) ? key.slice(prefix.length) : "";
}

/** Inverse of `sessionKey` for pending (never-sent) tabs. */
export function parseDraftSessionKey(
  key: string,
): { engine: string; workspacePath: string } | null {
  if (!key.startsWith("new:")) return null;
  const rest = key.slice(4);
  const colon = rest.indexOf(":");
  if (colon <= 0) return null;
  return { engine: rest.slice(0, colon), workspacePath: rest.slice(colon + 1) };
}

export const OPEN_TABS_KEY = "ccgui-next.openTabs:v1";
const ACTIVE_SESSION_KEY = "ccgui-next.activeSession:v1";
const LEGACY_OPEN_TABS_KEY = "ccgui-next.openTabs";
const LEGACY_ACTIVE_SESSION_KEY = "ccgui-next.activeSession";
export const ENGINE_PREF_KEY = "ccgui-next.enginePref";
export const PERMISSION_PREF_KEY = "ccgui-next.permissionPref";

export function sameTab(
  tab: ActiveSession,
  engine: string,
  sessionId: string | null,
  workspacePath: string,
) {
  return (
    tab.engine === engine &&
    tab.sessionId === sessionId &&
    tab.workspacePath === workspacePath
  );
}
/** Drop duplicate tabs (same engine+sessionId+workspacePath), keeping the
 * first occurrence. Duplicates render with identical React keys and break
 * the tab strip's reconciliation. */
export function dedupeTabs(tabs: ActiveSession[]): ActiveSession[] {
  const out: ActiveSession[] = [];
  for (const tab of tabs) {
    if (
      out.some((t) => sameTab(t, tab.engine, tab.sessionId, tab.workspacePath))
    )
      continue;
    out.push(tab);
  }
  return out;
}

export function persistTabs(
  openTabs: ActiveSession[],
  active: ActiveSession | null,
) {
  writeStored(OPEN_TABS_KEY, JSON.stringify(openTabs));
  if (active) writeStored(ACTIVE_SESSION_KEY, JSON.stringify(active));
  else localStorage.removeItem(ACTIVE_SESSION_KEY);
}

/** Read a persisted JSON value, migrating the pre-versioned key on first read. */
function readPersistedValue<T>(
  key: string,
  legacyKey: string,
  validate: (value: unknown) => T | null,
): T | null {
  const current = readStoredJson(key, validate);
  if (current !== null) return current;
  const legacy = readStoredJson(legacyKey, validate);
  if (legacy === null) return null;
  // One-time migration: the validated legacy value moves to the versioned key.
  writeStored(key, JSON.stringify(legacy));
  localStorage.removeItem(legacyKey);
  return legacy;
}

function isActiveSession(t: unknown): t is ActiveSession {
  const tab = t as ActiveSession;
  return (
    !!tab &&
    typeof tab.engine === "string" &&
    typeof tab.workspacePath === "string" &&
    (tab.sessionId === null || typeof tab.sessionId === "string") &&
    (tab.model === undefined || typeof tab.model === "string") &&
    (tab.effort === undefined || typeof tab.effort === "string") &&
    (tab.provider === undefined || typeof tab.provider === "string")
  );
}

export function readPersistedTabs(): ActiveSession[] {
  return dedupeTabs(
    readPersistedValue(OPEN_TABS_KEY, LEGACY_OPEN_TABS_KEY, (raw) =>
      Array.isArray(raw) ? raw.filter(isActiveSession) : null,
    ) ?? [],
  );
}

export function readPersistedActive(): ActiveSession | null {
  return readPersistedValue(
    ACTIVE_SESSION_KEY,
    LEGACY_ACTIVE_SESSION_KEY,
    (raw) => (isActiveSession(raw) ? raw : null),
  );
}
