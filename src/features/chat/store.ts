import { create } from "zustand";
import { ipc, type SessionMeta, type SessionPage } from "@/lib/ipc";
import { botById } from "@/features/bots/bot-store";
import { getSelectedBot } from "@/features/bots/selected-bot";
import {
  noteSessionEnded,
  noteTurnCompleted,
  reviewSchedule,
  reviewTranscript,
  type ReviewContext,
} from "@/features/bots/memory-review";
import {
  ENGINE_PREF_KEY,
  persistTabs,
  sessionKey,
} from "./store/persistence";
import { patchSession, resolveSessionModel } from "./store/stream";
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
  /** 一轮对话 / 一个会话的复盘上下文：选中了开着重盘的 Bot 才返回。
   *  复盘是记忆的子功能：记忆或复盘任一关着、Bot 已删，都不触发。 */
  function memoryReviewContext(key: string): ReviewContext | null {
    const s = get();
    const session = s.bySession[key];
    // 正在流式的轮次不算「结束」：等它落定或用户真的离开会话再复盘，
    // 否则整理的是半截对话还多付一次调用。
    if (!session || session.streaming) return null;
    const tab = s.openTabs.find(
      (t) => sessionKey(t.engine, t.sessionId, t.workspacePath) === key,
    );
    const meta = tab
      ? undefined
      : s.sessions.find(
          (m) => sessionKey(m.engine, m.sessionId, m.workspacePath) === key,
        );
    const engine = tab?.engine ?? meta?.engine;
    const sessionId = tab?.sessionId ?? meta?.sessionId;
    const workspacePath = tab?.workspacePath ?? meta?.workspacePath;
    if (!engine || !sessionId || !workspacePath) return null;
    const selected = getSelectedBot(workspacePath, sessionId);
    const bot = selected ? botById(selected.id) : null;
    const schedule = reviewSchedule(bot);
    if (!bot || !schedule) return null;
    const transcript = reviewTranscript(session.messages);
    // 只有工具行没有正文的轮次没什么可整理。
    if (!transcript.trim()) return null;
    return {
      key,
      botId: bot.id,
      engine,
      providerId: session.activeProvider ?? s.providers[engine] ?? null,
      model: resolveSessionModel(tab ?? { engine }, session, s.models[engine]) ?? null,
      everyNTurns: schedule.everyNTurns,
      transcript,
    };
  }

  const turnSettled = (key: string) => {
    const context = memoryReviewContext(key);
    if (context) noteTurnCompleted(context);
  };
  const sessionEnded = (
    engine: string,
    sessionId: string,
    workspacePath: string,
  ) => {
    const context = memoryReviewContext(
      sessionKey(engine, sessionId, workspacePath),
    );
    if (context) noteSessionEnded(context);
  };

  const {
    activateTab,
    stampActiveTab,
    removeTab,
    forgetClosedTab,
    forgetClosedTabs,
    ...tabActions
  } = createTabActions({ set, get, sessionEnded });
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
    turnSettled,
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
