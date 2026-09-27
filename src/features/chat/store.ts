import { create } from "zustand";
import { ipc, type SessionMeta, type SessionPage } from "@/lib/ipc";
import {
  ENGINE_PREF_KEY,
  persistTabs,
  sessionKey,
} from "./store/persistence";
import { patchSession } from "./store/stream";
import { readPermissionPref } from "./store/permissions";
import { createTabActions } from "./store/tabs";
import { createMessagingActions } from "./store/messaging";
import { createSessionActions } from "./store/sessions";
import { createWorkspaceActions } from "./store/workspaces";
import { createPreferenceActions } from "./store/preferences";
import { createComposerActions } from "./store/composer";
import type { ChatStore } from "./store/types";

// Facade re-exports: callers keep importing everything from "../store".
export { parseDraftSessionKey, sessionKey } from "./store/persistence";
export type { ActiveSession } from "./store/persistence";
export type {
  QueuedMessage,
  QueueMoveDirection,
  SessionState,
} from "./store/stream";
export type { ChatStore } from "./store/types";
export { effectivePermission } from "./store/permissions";
export { AGENT_BLOCK_HEADER } from "./components/agent-block";
export { sortedWorkspaceGroups } from "./store/session-utils";

/** Unlisteners for the module-scope event subscriptions set up in init. */
const eventTeardowns: Array<() => void> = [];

/** Load a page of session history, routing remote (plugin-fed, e.g. WSL
 *  distro CLI) transcripts through the host's remote fetch instead of the
 *  local db lookup. `meta` is looked up from the current session catalog
 *  when not supplied (usage refresh can't key by workspace). */
function loadHistoryPage(
  engine: string,
  sessionId: string,
  workspacePath: string,
  limit?: number,
  beforeSeq?: number | null,
  meta?: SessionMeta,
): Promise<SessionPage> {
  const m =
    meta ??
    useChatStore
      .getState()
      .sessions.find(
        (s) =>
          s.engine === engine &&
          s.sessionId === sessionId &&
          s.workspacePath === workspacePath,
      );
  if (m?.remote && m.remotePath) {
    return ipc.loadRemoteSessionPage(
      workspacePath,
      engine,
      sessionId,
      m.remotePath,
      limit,
      beforeSeq,
    );
  }
  return beforeSeq === undefined
    ? ipc.loadSessionPage(engine, sessionId, limit)
    : ipc.loadSessionPage(engine, sessionId, limit, beforeSeq);
}

export const useChatStore = create<ChatStore>((set, get) => {
  const {
    activateTab,
    stampActiveTab,
    removeTab,
    forgetClosedTab,
    forgetClosedTabs,
    ...tabActions
  } = createTabActions({ set, get });
  const { drainQueue, markUnseenIfBackground, ...messagingActions } =
    createMessagingActions({
      set,
      get,
      loadHistoryPage,
      subscribe: (listener) => useChatStore.subscribe(listener),
    });
  const sessionActions = createSessionActions({
    set,
    get,
    loadHistoryPage,
    eventTeardowns,
    activateTab,
    removeTab,
    forgetClosedTab,
    drainQueue,
    markUnseenIfBackground,
  });
  const workspaceActions = createWorkspaceActions({
    set,
    get,
    activateTab,
    forgetClosedTabs,
  });
  const preferenceActions = createPreferenceActions({
    set,
    get,
    stampActiveTab,
  });
  const composerActions = createComposerActions({ set });

  return {
    workspaces: [],
    sessions: [],
    archivedSessionKeys: {},
    engines: [],
    active: null,
    openTabs: [],
    activeEngine: localStorage.getItem(ENGINE_PREF_KEY) ?? "claude",
    permission: readPermissionPref(),
    efforts: {},
    ompServiceTier: null,
    codexServiceTier: null,
    models: {},
    providers: {},
    threadLimit: 10,
    workspaceGroups: [],
    workspaceAliases: {},
    archivedWorkspaces: [],
    sendShortcut: "enter",
    thinkingAutoCollapse: true,
    bySession: {},
    streamingByKey: {},
    retryingByKey: {},
    unseen: {},
    drafts: {},
    pendingMention: null,
    actionError: null,
    initialized: false,
    restoredSessionKeys: {},
    createdSessionKeys: {},
    sessionContributions: {},
    pendingRuntimeSwitch: null,

    ...sessionActions,
    ...workspaceActions,
    ...tabActions,
    ...preferenceActions,
    ...composerActions,
    ...messagingActions,
  };
});

// Dev-only handle for poking the store from the webview console; stripped
// from production builds by the env guard.
if (import.meta.env.DEV) {
  (window as unknown as { __chatStore: typeof useChatStore }).__chatStore =
    useChatStore;
}

/**
 * Plugin API backend (ctx.sessions.setEffort, host:session): patch an
 * EXISTING session's effort and persist it. Unknown keys are rejected — a
 * wrong workspacePath/sessionId must not mint a ghost EMPTY_SESSION entry
 * via patchSession. The owning tab's effort stamp is cleared (parity with
 * setEffort's session branch) so refreshSessions cannot resurrect the
 * pre-patch level.
 */
export function setPluginSessionEffort(
  engine: string,
  sessionId: string,
  workspacePath: string,
  effort: string,
): void {
  const trimmed = effort.trim();
  if (!trimmed) {
    throw new Error("sessions.setEffort: effort must be non-empty");
  }
  if (!engine || !sessionId) {
    throw new Error("sessions.setEffort: engine and sessionId are required");
  }
  const key = sessionKey(engine, sessionId, workspacePath);
  const state = useChatStore.getState();
  if (!state.bySession[key]) {
    throw new Error(`sessions.setEffort: unknown session ${key}`);
  }
  patchSession(useChatStore.setState, key, { activeEffort: trimmed });
  void ipc.rememberSessionEffort?.(engine, sessionId, trimmed)?.catch(() => {});
  const clearStamp = <T extends { engine: string; sessionId: string | null; workspacePath: string; effort?: string }>(
    t: T,
  ): T =>
    sessionKey(t.engine, t.sessionId, t.workspacePath) === key && t.effort !== undefined
      ? { ...t, effort: undefined }
      : t;
  const openTabs = state.openTabs.map(clearStamp);
  const active = state.active ? clearStamp(state.active) : state.active;
  if (openTabs.some((t, i) => t !== state.openTabs[i]) || active !== state.active) {
    useChatStore.setState({ openTabs, active });
    persistTabs(openTabs, active);
  }
}

// HMR swaps this module for a fresh store; without dispose the old module's
// engine/session listeners keep firing into the dead store (and init on the
// new store would double-subscribe).
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    for (const teardown of eventTeardowns.splice(0)) teardown();
  });
}
