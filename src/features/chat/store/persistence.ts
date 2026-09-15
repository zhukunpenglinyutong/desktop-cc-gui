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
