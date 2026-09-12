import { normalizeOmpServiceTier } from "@/lib/omp-service-tier";
import { create } from "zustand";
import {
  ipc,
  type SessionMeta,
  type Workspace,
  type WorkspaceGroup,
  type EngineInfo,
} from "@/lib/ipc";
import type { EffortLevel } from "@/components/application/ai-chat/cli-menu";
import { pruneMentionIndex } from "@/components/application/ai-chat/mention-files";
import { pruneSlashCommands } from "@/components/application/ai-chat/slash-commands";
import { listenEngineEvents, listenSessionsChanged } from "@/lib/events";
import { errorText } from "@/lib/errors";
import { writeStored } from "@/lib/storage";
import { newId } from "@/lib/id";
import { subscribeTauriEvent } from "@/hooks/use-tauri-event";
import { CLI_CONFIG_CHANGED_EVENT } from "@/features/settings/providers";
import {
  ENGINE_PREF_KEY,
  PERMISSION_PREF_KEY,
  dedupeTabs,
  persistTabs,
  readPersistedActive,
  readPersistedTabs,
  sameTab,
  sessionKey,
  type ActiveSession,
} from "./store/persistence";
import {
  EMPTY_SESSION,
  applyStreamParts,
  drainPending,
  moveStreamingFlag,
  patchSession,
  resolveSessionModel,
  routeRun,
  runRouting,
  setStreamingFlag,
  settleLiveRows,
  untrackRun,
} from "./store/stream";
import {
  dropRunUsage,
  firstLineTitle,
  handleEngineEvents,
  optimisticMeta,
  patchGrantBySeq,
  rememberModelForRun,
  settleOrphanedRuns,
  upsertSessionMetaInto,
} from "./store/engine-events";
import { effectivePermission, readPermissionPref } from "./store/permissions";
import { persistSettings } from "./store/settings-persist";
import { appendCommittedRows, visibleSessions } from "./store/session-utils";
import type { ChatStore } from "./store/types";

// Facade re-exports: callers keep importing everything from "../store".
export { sessionKey } from "./store/persistence";
export type { ActiveSession } from "./store/persistence";
export type { QueuedMessage, SessionState } from "./store/stream";
export type { ChatStore } from "./store/types";
export { effectivePermission } from "./store/permissions";
export { sortedWorkspaceGroups } from "./store/session-utils";

/** Unlisteners for the module-scope event subscriptions set up in init. */
const eventTeardowns: Array<() => void> = [];
function omitKey(rec: Record<string, boolean>, key: string) {
  const next = { ...rec };
  delete next[key];
  return next;
}

export const useChatStore = create<ChatStore>((set, get) => {
  /** Activate a tab: existing sessions lazy-load via selectSession, pending chats just set. */
  function activateTab(tab: ActiveSession | null) {
    if (!tab) {
      set({ active: null });
      persistTabs(get().openTabs, null);
      return;
    }
    if (tab.sessionId)
      void get().selectSession(tab.engine, tab.sessionId, tab.workspacePath);
    else {
      // A pending tab sends with its own engine, so the picker must follow it
      // — otherwise the chip shows one CLI while sends go to another.
      const syncEngine = tab.engine !== get().activeEngine;
      if (syncEngine) writeStored(ENGINE_PREF_KEY, tab.engine);
      set(
        syncEngine
          ? { active: tab, activeEngine: tab.engine }
          : { active: tab },
      );
      persistTabs(get().openTabs, tab);
    }
  }

  /** Stamp a per-tab composer override (model/effort) onto the active tab, so
   * the picker follows each session across tab switches. Persists with the
   * tab list; no-op without an active tab. */
  function stampActiveTab(patch: Partial<ActiveSession>) {
    set((s) => {
      const current = s.active;
      if (!current) return {};
      const active: ActiveSession = { ...current, ...patch };
      const openTabs = s.openTabs.map((t) =>
        sameTab(t, current.engine, current.sessionId, current.workspacePath)
          ? active
          : t,
      );
      persistTabs(openTabs, active);
      return { openTabs, active };
    });
  }

  /** Reopen cache for closed tabs: keys whose bySession entry survives tab
   * close so selectSession skips a backend reload, most-recently-closed
   * last. Bounded — the oldest non-streaming entries beyond the cap are
   * evicted, so the cache cannot grow forever. */
  const CLOSED_CACHE_LIMIT = 10;
  const closedTabCache: string[] = [];

  function rememberClosedTab(key: string) {
    const i = closedTabCache.indexOf(key);
    if (i >= 0) closedTabCache.splice(i, 1);
    closedTabCache.push(key);
    // Keys whose tab is open again are not "closed" anymore.
    const openKeys = new Set(
      get().openTabs.map((t) =>
        sessionKey(t.engine, t.sessionId, t.workspacePath),
      ),
    );
    for (let j = closedTabCache.length - 1; j >= 0; j--) {
      if (openKeys.has(closedTabCache[j])) closedTabCache.splice(j, 1);
    }
    let overflow = closedTabCache.length - CLOSED_CACHE_LIMIT;
    if (overflow <= 0) return;
    const evict: string[] = [];
    for (const cached of closedTabCache) {
      if (overflow <= 0) break;
      // A streaming closed tab still receives events — never evict it.
      if (get().streamingByKey[cached]) continue;
      evict.push(cached);
      overflow--;
    }
    if (evict.length === 0) return;
    for (const cached of evict) {
      closedTabCache.splice(closedTabCache.indexOf(cached), 1);
    }
    set((s) => {
      const bySession = { ...s.bySession };
      for (const cached of evict) delete bySession[cached];
      return { bySession };
    });
  }

  /** Remove a tab; when it was active, fall back to its nearest neighbor. */
  function removeTab(
    engine: string,
    sessionId: string | null,
    workspacePath: string,
  ) {
    const s = get();
    const idx = s.openTabs.findIndex((t) =>
      sameTab(t, engine, sessionId, workspacePath),
    );
    if (idx < 0) return;
    const openTabs = s.openTabs.filter((_, i) => i !== idx);
    set({ openTabs });
    rememberClosedTab(sessionKey(engine, sessionId, workspacePath));
    if (s.active && sameTab(s.active, engine, sessionId, workspacePath)) {
      activateTab(openTabs[Math.min(idx, openTabs.length - 1)] ?? null);
    } else {
      persistTabs(openTabs, s.active);
    }
  }

  /**
   * Send a prompt to a specific tab. Unlike the public `send` action this is
   * not bound to the active session, so the queue can drain on a background
   * tab after its turn finishes there.
   */
  async function sendPrompt(
    tab: ActiveSession,
    prompt: string,
    images: string[],
  ) {
    if (!prompt.trim() && images.length === 0) return;
    const engine = tab.engine;
    const key = sessionKey(engine, tab.sessionId, tab.workspacePath);
    // Resolve BEFORE the optimistic rows land: the patch below writes
    // activeModel, and a resolver reading it afterwards would see its own
    // write instead of the session's history.
    // The session's own model, not the engine default: continuing a
    // conversation keeps running the model that conversation uses.
    const model =
      resolveSessionModel(tab, get().bySession[key], get().models[engine]) ||
      null;
    // Remember what this session runs, spelled as the picker spells it: the
    // engine's own transcript keeps only the bare model name, so this record
    // is what a restart or another client reads back (see
    // ipc.rememberSessionModel). A brand-new session has no id yet — its
    // `session` event carries the model instead.
    if (model) {
      if (tab.sessionId) {
        void ipc
          .rememberSessionModel(engine, tab.sessionId, model)
          .catch(() => {});
      } else {
        rememberModelForRun(key, model);
      }
    }
    const effort = tab.effort ?? get().efforts[engine] ?? null;
    // Optimistic user message.
    set((s) => ({
      streamingByKey: setStreamingFlag(s.streamingByKey, key, true),
    }));
    appendCommittedRows(
      set,
      key,
      [
        {
          role: "user",
          text: prompt,
          ts: new Date().toISOString(),
          images: images.length ? [...images] : undefined,
        },
      ],
      {
        streaming: true,
        error: null,
        interrupted: false,
        turnStartedAt: Date.now(),
        activeModel: model,
        activeEffort: effort,
        // The tail indicator counts this reply, not the one before it.
        turnUsage: null,
      },
    );
    try {
      const result = await ipc.sendMessage({
        engine,
        workspacePath: tab.workspacePath,
        sessionId: tab.sessionId,
        prompt,
        imagePaths: images.length ? images : null,
        model,
        effort,
        permission: effectivePermission(
          get().engines,
          engine,
          get().permission,
        ),
      });
      if (result.sessionId && !tab.sessionId) {
        // Preassigned native id (grok): adopt immediately.
        const newKey = sessionKey(
          engine,
          result.sessionId,
          tab.workspacePath,
        );
        if (model) {
          void ipc
            .rememberSessionModel(engine, result.sessionId, model)
            .catch(() => {});
        }
        settleOrphanedRuns(set, routeRun(result.runId, newKey));
        set((s) => {
          const bySession = { ...s.bySession };
          if (bySession[key]) {
            bySession[newKey] = bySession[key];
            if (newKey !== key) delete bySession[key];
          }
          // Stamp only the tab that owns this run; blanketing every pending
          // tab of this engine+workspace would create duplicate session tabs.
          let stamped = false;
          const openTabs = dedupeTabs(
            s.openTabs.map((t) => {
              if (
                stamped ||
                t.engine !== engine ||
                t.sessionId !== null ||
                t.workspacePath !== tab.workspacePath
              ) {
                return t;
              }
              stamped = true;
              return { ...t, sessionId: result.sessionId };
            }),
          );
          // Only the active tab adopts the native id on `active`; a
          // background drain leaves the user's current tab untouched.
          const active =
            s.active &&
            s.active.engine === engine &&
            s.active.sessionId === null &&
            s.active.workspacePath === tab.workspacePath
              ? { ...s.active, sessionId: result.sessionId }
              : s.active;
          return {
            bySession,
            openTabs,
            active,
            streamingByKey: moveStreamingFlag(s.streamingByKey, key, newKey),
          };
        });
        persistTabs(get().openTabs, get().active);
        // Sidebar row + tab title pick the new session up immediately
        // instead of waiting for the post-turn rescan.
        upsertSessionMetaInto(
          set,
          optimisticMeta(
            engine,
            result.sessionId,
            tab.workspacePath,
            firstLineTitle(prompt),
          ),
        );
      } else {
        settleOrphanedRuns(set, routeRun(result.runId, key));
      }
      // Stop pressed while this send was still in flight: interrupt() ran
      // before runRouting had this run (it is written above, after the
      // await), so it settled the UI and killed nothing — the CLI kept
      // streaming. Now that the ids exist, kill it. A native id adopted
      // just above moved the state to a new key, so read the key the turn
      // actually lives under.
      const liveKey =
        result.sessionId && !tab.sessionId
          ? sessionKey(engine, result.sessionId, tab.workspacePath)
          : key;
      if (get().bySession[liveKey]?.interrupted) {
        runRouting.delete(result.runId);
        untrackRun(result.runId);
        dropRunUsage(result.runId);
        await Promise.all([
          ipc.interruptSession(result.runId).catch(() => false),
          ...(result.sessionId
            ? [ipc.interruptSession(result.sessionId).catch(() => false)]
            : []),
        ]);
      }
    } catch (error) {
      set((s) => ({
        streamingByKey: setStreamingFlag(s.streamingByKey, key, false),
      }));
      patchSession(set, key, {
        error: String(error),
        streaming: false,
        turnStartedAt: null,
      });
    }
  }

  /** Flag a finished background session as unseen so the sidebar shows the
   * green dot until the user opens it; the watched active tab never flags. */
  function markUnseenIfBackground(key: string) {
    const active = get().active;
    const activeKey = active
      ? sessionKey(active.engine, active.sessionId, active.workspacePath)
      : null;
    if (key === activeKey) return;
    set((s) => (s.unseen[key] ? {} : { unseen: { ...s.unseen, [key]: true } }));
  }

  /** After a turn ends, send the oldest queued message for that session. */
  function drainQueue(key: string) {
    const s = get();
    const session = s.bySession[key];
    if (!session || session.streaming || session.queue.length === 0) return;
    const tab = s.openTabs.find(
      (t) => sessionKey(t.engine, t.sessionId, t.workspacePath) === key,
    );
    if (!tab) return;
    const [head, ...rest] = session.queue;
    set((prev) => ({
      bySession: {
        ...prev.bySession,
        [key]: { ...(prev.bySession[key] ?? EMPTY_SESSION), queue: rest },
      },
    }));
    void sendPrompt(tab, head.text, head.images);
  }

  /** Migrate the engine pref off a CLI that is gone or disabled in
   * settings. All CLIs disabled: leave the pref alone — the composer shows
   * the "no CLI enabled" placeholder instead of a misleading fallback. */
  function ensureUsableEngine(engines: EngineInfo[]) {
    const usable = engines.filter((e) => e.enabled);
    if (usable.length === 0 || usable.some((e) => e.id === get().activeEngine))
      return;
    get().setActiveEngine(usable.find((e) => e.available)?.id ?? usable[0].id);
  }

  return {
    workspaces: [],
    sessions: [],
    engines: [],
    active: null,
    openTabs: [],
    activeEngine: localStorage.getItem(ENGINE_PREF_KEY) ?? "claude",
    permission: readPermissionPref(),
    efforts: {},
    ompServiceTier: null,
    codexServiceTier: null,
    models: {},
    threadLimit: 10,
    workspaceGroups: [],
    workspaceAliases: {},
    archivedWorkspaces: [],
    sendShortcut: "enter",
    bySession: {},
    streamingByKey: {},
    unseen: {},
    drafts: {},
    pendingMention: null,
    actionError: null,
    initialized: false,

    init: async () => {
      if (get().initialized) return;
      set({ initialized: true });
      eventTeardowns.push(
        subscribeTauriEvent(() =>
          listenEngineEvents((events) =>
            handleEngineEvents(events, {
              set,
              get,
              drainQueue,
              markUnseenIfBackground,
              upsertSessionMeta: (meta) => upsertSessionMetaInto(set, meta),
              refreshSessionUsage: (k) => get().refreshSessionUsage(k),
            }),
          ),
        ),
        subscribeTauriEvent(() =>
          listenSessionsChanged(() => void get().refreshSessions()),
        ),
      );
      // Settings' CLI enable switch / channel edits: re-filter history and
      // picker options without a restart.
      const onCliConfigChanged = () => void get().refreshEngines();
      window.addEventListener(CLI_CONFIG_CHANGED_EVENT, onCliConfigChanged);
      eventTeardowns.push(() =>
        window.removeEventListener(
          CLI_CONFIG_CHANGED_EVENT,
          onCliConfigChanged,
        ),
      );
      const [workspaces, sessions, engines] = await Promise.all([
        ipc.listWorkspaces().catch(() => [] as Workspace[]),
        ipc.listSessions().catch(() => [] as SessionMeta[]),
        ipc.listEngines().catch(() => [] as EngineInfo[]),
      ]);
      set({
        workspaces,
        sessions: visibleSessions(sessions, engines),
        engines,
      });
      ensureUsableEngine(engines);
      // Restore persisted tabs; drop ones whose workspace/session is gone.
      const restoredTabs = readPersistedTabs().filter(
        (t) =>
          workspaces.some((w) => w.path === t.workspacePath) &&
          (t.sessionId === null ||
            sessions.some(
              (s) => s.engine === t.engine && s.sessionId === t.sessionId,
            )),
      );
      set({ openTabs: restoredTabs });
      const persistedActive = readPersistedActive();
      const activeTab =
        persistedActive &&
        restoredTabs.some((t) =>
          sameTab(
            t,
            persistedActive.engine,
            persistedActive.sessionId,
            persistedActive.workspacePath,
          ),
        )
          ? persistedActive
          : (restoredTabs[0] ?? null);
      if (activeTab) activateTab(activeTab);
      ipc
        .getAppSettings()
        .then((settings) =>
          set({
            efforts: (settings.defaultEfforts ?? {}) as Record<
              string,
              EffortLevel
            >,
            ompServiceTier: normalizeOmpServiceTier(
              settings.ompOpenaiServiceTier,
            ),
            codexServiceTier: normalizeOmpServiceTier(
              settings.codexServiceTier,
            ),
            models: settings.defaultModels ?? {},
            threadLimit: settings.sidebarThreadLimit ?? 5,
            workspaceGroups: settings.workspaceGroups ?? [],
            workspaceAliases: settings.workspaceAliases ?? {},
            archivedWorkspaces: settings.archivedWorkspaces ?? [],
            sendShortcut: settings.composerSendShortcut ?? "enter",
          }),
        )
        .catch(() => {});
    },

    refreshSessions: async () => {
      const sessions = await ipc.listSessions().catch(() => null);
      if (sessions) set({ sessions: visibleSessions(sessions, get().engines) });
    },

    refreshEngines: async () => {
      const [engines, sessions] = await Promise.all([
        ipc.listEngines().catch(() => null),
        ipc.listSessions().catch(() => null),
      ]);
      if (!engines) return;
      set({
        engines,
        ...(sessions ? { sessions: visibleSessions(sessions, engines) } : {}),
      });
      ensureUsableEngine(engines);
    },

    refreshWorkspaces: async () => {
      const workspaces = await ipc.listWorkspaces().catch(() => null);
      if (workspaces) set({ workspaces });
    },

    addWorkspace: async (path) => {
      try {
        await ipc.addWorkspace(path);
        await get().refreshWorkspaces();
        set({ actionError: null });
      } catch (error) {
        set({ actionError: errorText(error) });
      }
    },

    reorderWorkspaces: async (ids) => {
      // Optimistic: listed ids first in the given order, the rest keep their
      // relative order after them.
      const order = new Map(ids.map((id, index) => [id, index]));
      set((s) => ({
        workspaces: [...s.workspaces].sort(
          (a, b) =>
            (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
            (order.get(b.id) ?? Number.MAX_SAFE_INTEGER),
        ),
      }));
      try {
        await ipc.reorderWorkspaces(ids);
      } catch {
        await get().refreshWorkspaces();
      }
    },

    removeWorkspace: async (id) => {
      try {
        const removedPath = get().workspaces.find((w) => w.id === id)?.path;
        await ipc.removeWorkspace(id);
        await get().refreshWorkspaces();
        set({ actionError: null });
        if (!removedPath) return;
        // The composer's per-root picker caches die with the workspace.
        pruneMentionIndex(removedPath);
        pruneSlashCommands(removedPath);
        // Evict cached session state belonging to the removed workspace:
        // real session keys come from the list cache, pending-chat keys
        // carry the path in the key itself.
        const dead = new Set<string>();
        for (const sess of get().sessions) {
          if (sess.workspacePath === removedPath) {
            dead.add(sessionKey(sess.engine, sess.sessionId, ""));
          }
        }
        const current = get();
        for (const key of [
          ...Object.keys(current.bySession),
          ...Object.keys(current.drafts),
          ...Object.keys(current.unseen),
        ]) {
          if (key.startsWith("new:") && key.endsWith(`:${removedPath}`)) {
            dead.add(key);
          }
        }
        if (dead.size > 0) {
          for (let i = closedTabCache.length - 1; i >= 0; i--) {
            if (dead.has(closedTabCache[i])) closedTabCache.splice(i, 1);
          }
          set((s) => {
            const bySession = { ...s.bySession };
            const drafts = { ...s.drafts };
            const unseen = { ...s.unseen };
            for (const key of dead) {
              delete bySession[key];
              delete drafts[key];
              delete unseen[key];
            }
            return { bySession, drafts, unseen };
          });
        }
        const openTabs = get().openTabs.filter(
          (t) => t.workspacePath !== removedPath,
        );
        set({ openTabs });
        const active = get().active;
        if (active && active.workspacePath === removedPath) {
          activateTab(openTabs[0] ?? null);
        } else {
          persistTabs(openTabs, active);
        }
      } catch (error) {
        set({ actionError: errorText(error) });
      }
    },

    selectSession: async (engine, sessionId, workspacePath) => {
      const key = sessionKey(engine, sessionId, workspacePath);
      // The session remembers the model it ran, and our own record is the
      // only place that carries the provider ("agentrouter qunyou/x", while
      // the engine transcript keeps the bare "x"). Without it a session
      // reopened here — after a restart, or in another window — showed the
      // engine default and sent that instead.
      const remembered = get().sessions.find(
        (x) => x.engine === engine && x.sessionId === sessionId,
      )?.model;
      if (remembered && !get().bySession[key]?.activeModel) {
        patchSession(set, key, { activeModel: remembered });
      }
      const syncEngine = engine !== get().activeEngine;
      if (syncEngine) writeStored(ENGINE_PREF_KEY, engine);
      set((s) => {
        // Reuse the stored tab so its per-tab model/effort overrides survive;
        // a fresh object would drop them on every session switch.
        const stored = s.openTabs.find((t) =>
          sameTab(t, engine, sessionId, workspacePath),
        );
        const tab: ActiveSession = stored ?? {
          engine,
          sessionId,
          workspacePath,
        };
        const openTabs = stored ? s.openTabs : [...s.openTabs, tab];
        persistTabs(openTabs, tab);
        // Opening a session clears its unseen flag.
        const unseen = key in s.unseen ? omitKey(s.unseen, key) : s.unseen;
        // The picker must follow the session's engine — otherwise the chip
        // shows one CLI while sends go to another (same rule as pending tabs).
        return { openTabs, active: tab, unseen, activeEngine: engine };
      });
      const existing = get().bySession[key];
      if (existing && existing.messages.length > 0) return;
      patchSession(set, key, { loading: true });
      try {
        const page = await ipc.loadSessionPage(engine, sessionId, 100);
        patchSession(set, key, {
          messages: page.messages,
          nextBefore: page.nextBefore,
          loading: false,
          // Live "usage" events only cover fresh turns; a resumed session
          // adopts the newest usage snapshot carried by its history.
          usage:
            [...page.messages].reverse().find((m) => m.usage)?.usage ?? null,
        });
      } catch (error) {
        patchSession(set, key, { loading: false, error: String(error) });
      }
    },

    startNewChat: (workspacePath) => {
      // One pending chat per workspace+engine: re-focus it instead of
      // piling up empty "new" tabs.
      set((s) => {
        const existing = s.openTabs.find(
          (t) =>
            t.sessionId === null &&
            t.engine === s.activeEngine &&
            t.workspacePath === workspacePath,
        );
        const tab: ActiveSession = existing ?? {
          engine: s.activeEngine,
          sessionId: null,
          workspacePath,
        };
        const openTabs = existing ? s.openTabs : [...s.openTabs, tab];
        persistTabs(openTabs, tab);
        return { openTabs, active: tab };
      });
    },

    closeTab: (engine, sessionId, workspacePath) => {
      removeTab(engine, sessionId, workspacePath);
    },
    focusTab: (engine, sessionId, workspacePath) => {
      // Reuse the stored tab so its per-tab model/effort overrides apply.
      const stored = get().openTabs.find((t) =>
        sameTab(t, engine, sessionId, workspacePath),
      );
      activateTab(stored ?? { engine, sessionId, workspacePath });
    },
    moveTab: (engine, sessionId, workspacePath, toIndex) => {
      const s = get();
      const from = s.openTabs.findIndex((t) =>
        sameTab(t, engine, sessionId, workspacePath),
      );
      if (from < 0) return;
      const openTabs = [...s.openTabs];
      const [tab] = openTabs.splice(from, 1);
      openTabs.splice(Math.max(0, Math.min(toIndex, openTabs.length)), 0, tab);
      set({ openTabs });
      persistTabs(openTabs, s.active);
    },

    setActiveEngine: (engine) => {
      writeStored(ENGINE_PREF_KEY, engine);
      set((s) => {
        const active = s.active;
        // A pending (never-sent) tab has no backend session yet, so it
        // follows the picker: retarget it to the newly selected engine.
        // Otherwise the chip shows the new CLI while sends still go to the
        // engine the tab was created with.
        if (!active || active.sessionId !== null || active.engine === engine) {
          return { activeEngine: engine };
        }
        const oldKey = sessionKey(active.engine, null, active.workspacePath);
        // First turn still in flight (native id not yet assigned): event
        // routing is keyed to the old engine, so leave the tab untouched.
        if (s.bySession[oldKey]?.streaming) return { activeEngine: engine };
        const newKey = sessionKey(engine, null, active.workspacePath);
        const existing = s.openTabs.find(
          (t) =>
            !sameTab(
              t,
              active.engine,
              active.sessionId,
              active.workspacePath,
            ) &&
            t.sessionId === null &&
            t.engine === engine &&
            t.workspacePath === active.workspacePath,
        );
        // Carry unsent drafts / session state over to the new key.
        const bySession = { ...s.bySession };
        const drafts = { ...s.drafts };
        if (bySession[oldKey] && !bySession[newKey])
          bySession[newKey] = bySession[oldKey];
        delete bySession[oldKey];
        if (drafts[oldKey] !== undefined && drafts[newKey] === undefined) {
          drafts[newKey] = drafts[oldKey];
        }
        delete drafts[oldKey];
        let openTabs: ActiveSession[];
        let nextActive: ActiveSession;
        if (existing) {
          // A pending tab for this engine+workspace already exists: fold
          // into it instead of stacking a duplicate.
          openTabs = s.openTabs.filter(
            (t) =>
              !sameTab(
                t,
                active.engine,
                active.sessionId,
                active.workspacePath,
              ),
          );
          nextActive = existing;
        } else {
          // Engine retarget: the old engine's model/effort overrides don't
          // apply to the new one — drop them so defaults resolve fresh.
          nextActive = {
            ...active,
            engine,
            model: undefined,
            effort: undefined,
          };
          openTabs = s.openTabs.map((t) =>
            sameTab(t, active.engine, active.sessionId, active.workspacePath)
              ? nextActive
              : t,
          );
        }
        persistTabs(openTabs, nextActive);
        return {
          activeEngine: engine,
          openTabs,
          active: nextActive,
          bySession,
          drafts,
          streamingByKey: moveStreamingFlag(s.streamingByKey, oldKey, newKey),
        };
      });
    },

    setPermission: (permission) => {
      writeStored(PERMISSION_PREF_KEY, permission);
      set({ permission });
    },
    setOmpServiceTier: async (tier) => {
      const settings = await ipc.getAppSettings();
      await ipc.updateAppSettings({ ...settings, ompOpenaiServiceTier: tier });
      set({ ompServiceTier: tier });
    },
    setCodexServiceTier: async (tier) => {
      const settings = await ipc.getAppSettings();
      await ipc.updateAppSettings({ ...settings, codexServiceTier: tier });
      set({ codexServiceTier: tier });
    },
    setEffort: async (engine, effort) => {
      set({ efforts: { ...get().efforts, [engine]: effort } });
      if (get().active?.engine === engine) stampActiveTab({ effort });
      await persistSettings((settings) => ({
        defaultEfforts: { ...settings.defaultEfforts, [engine]: effort },
      }));
    },
    setModel: async (engine, model) => {
      const active = get().active;
      // Model choice is a property of the CONVERSATION: picking one inside a
      // session must not rewrite the engine-wide default, or a second session
      // of the same CLI would silently switch models with it. Only a pending
      // "new chat" tab (no session yet) edits the default — that tab is where
      // the next conversation's starting choice is made.
      if (!active || active.sessionId === null) {
        const models = { ...get().models };
        if (model) models[engine] = model;
        else delete models[engine];
        set({ models });
        await persistSettings((settings) => {
          const defaultModels = { ...settings.defaultModels };
          if (model) defaultModels[engine] = model;
          else delete defaultModels[engine];
          return { defaultModels };
        });
      }
      if (active?.engine === engine) {
        // Empty = "CLI default": clear the tab override so the session falls
        // back to its own history/model default again.
        stampActiveTab({ model: model || undefined });
      }
    },
    pinModels: async (updates) => {
      const entries = Object.entries(updates).filter(([, model]) =>
        model.trim(),
      );
      if (entries.length === 0) return;
      const models = { ...get().models };
      for (const [engine, model] of entries) models[engine] = model;
      set({ models });
      await persistSettings((settings) => ({
        defaultModels: {
          ...settings.defaultModels,
          ...Object.fromEntries(entries),
        },
      }));
    },

    setThreadLimit: (limit) => {
      set({ threadLimit: Math.max(1, Math.floor(limit)) });
    },
    createWorkspaceGroup: async (name) => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Group name is required.");
      const current = get().workspaceGroups;
      if (current.some((g) => g.name === trimmed)) {
        throw new Error("Group name already exists.");
      }
      const group: WorkspaceGroup = {
        id: newId(),
        name: trimmed,
        sortOrder:
          current.reduce((max, g) => Math.max(max, g.sortOrder ?? -1), -1) + 1,
      };
      const workspaceGroups = [...current, group];
      set({ workspaceGroups });
      await persistSettings((settings) => ({
        workspaceGroups: [...(settings.workspaceGroups ?? []), group],
      }));
      return group;
    },
    renameWorkspaceGroup: async (id, name) => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Group name is required.");
      const current = get().workspaceGroups;
      if (current.some((g) => g.id !== id && g.name === trimmed)) {
        throw new Error("Group name already exists.");
      }
      set({
        workspaceGroups: current.map((g) =>
          g.id === id ? { ...g, name: trimmed } : g,
        ),
      });
      await persistSettings((settings) => ({
        workspaceGroups: (settings.workspaceGroups ?? []).map((g) =>
          g.id === id ? { ...g, name: trimmed } : g,
        ),
      }));
      return true;
    },
    reorderWorkspaceGroups: async (orderedIds) => {
      const current = get().workspaceGroups;
      const byId = new Map(current.map((g) => [g.id, g]));
      const ordered = orderedIds
        .map((id) => byId.get(id))
        .filter((g): g is WorkspaceGroup => Boolean(g));
      // Groups missing from the submitted order keep trailing positions.
      const orderedIdSet = new Set(orderedIds);
      const rest = current.filter((g) => !orderedIdSet.has(g.id));
      const workspaceGroups = [...ordered, ...rest].map((g, i) => ({
        ...g,
        sortOrder: i,
      }));
      set({ workspaceGroups });
      await persistSettings(() => ({ workspaceGroups }));
    },
    deleteWorkspaceGroup: async (id) => {
      const affected = get().workspaces.filter((w) => w.groupId === id);
      const workspaceGroups = get().workspaceGroups.filter((g) => g.id !== id);
      set({
        workspaceGroups,
        workspaces: get().workspaces.map((w) =>
          w.groupId === id ? { ...w, groupId: null } : w,
        ),
      });
      await persistSettings((settings) => ({
        workspaceGroups: (settings.workspaceGroups ?? []).filter(
          (g) => g.id !== id,
        ),
      }));
      // Members of the deleted group fall back to ungrouped.
      await Promise.all(
        affected.map((w) => ipc.setWorkspaceGroup(w.id, null).catch(() => {})),
      );
    },
    assignWorkspaceGroup: async (workspaceId, groupId) => {
      const valid =
        groupId && get().workspaceGroups.some((g) => g.id === groupId);
      const resolved = valid ? groupId : null;
      set({
        workspaces: get().workspaces.map((w) =>
          w.id === workspaceId ? { ...w, groupId: resolved } : w,
        ),
      });
      try {
        await ipc.setWorkspaceGroup(workspaceId, resolved);
      } catch (error) {
        // Roll back to the persisted truth.
        await get().refreshWorkspaces();
        throw error;
      }
    },
    setWorkspaceAlias: async (workspaceId, alias) => {
      // An alias equal to the folder name is no alias at all — same rule the
      // sidebar display applies — so it clears the entry instead of storing.
      const name = get().workspaces.find((w) => w.id === workspaceId)?.name;
      const trimmed = alias?.trim() ?? "";
      const resolved = trimmed && trimmed !== name ? trimmed : null;
      const workspaceAliases = { ...get().workspaceAliases };
      if (resolved) workspaceAliases[workspaceId] = resolved;
      else delete workspaceAliases[workspaceId];
      set({ workspaceAliases });
      await persistSettings((settings) => {
        const next = { ...(settings.workspaceAliases ?? {}) };
        if (resolved) next[workspaceId] = resolved;
        else delete next[workspaceId];
        return { workspaceAliases: next };
      });
    },
    setWorkspaceArchived: async (workspaceId, archived) => {
      const current = get().archivedWorkspaces;
      const archivedWorkspaces = archived
        ? current.includes(workspaceId)
          ? current
          : [...current, workspaceId]
        : current.filter((id) => id !== workspaceId);
      if (archivedWorkspaces === current) return;
      set({ archivedWorkspaces });
      await persistSettings((settings) => {
        const next = (settings.archivedWorkspaces ?? []).filter(
          (id) => id !== workspaceId,
        );
        if (archived) next.push(workspaceId);
        return { archivedWorkspaces: next };
      });
    },
    setSendShortcut: (shortcut) => {
      set({ sendShortcut: shortcut });
    },

    setDraft: (key, text) => {
      set((s) => ({ drafts: { ...s.drafts, [key]: text } }));
    },
    requestMention: (path) => {
      set((s) => ({
        pendingMention: { path, nonce: (s.pendingMention?.nonce ?? 0) + 1 },
      }));
    },

    clearPendingMention: () => {
      set({ pendingMention: null });
    },

    dismissActionError: () => {
      set({ actionError: null });
    },
    dismissSessionError: (key) => {
      patchSession(set, key, { error: null });
    },

    loadEarlier: async () => {
      const { active, bySession } = get();
      if (!active?.sessionId) return;
      const key = sessionKey(
        active.engine,
        active.sessionId,
        active.workspacePath,
      );
      const state = bySession[key];
      if (!state?.nextBefore || state.loading) return;
      patchSession(set, key, { loading: true });
      try {
        const page = await ipc.loadSessionPage(
          active.engine,
          active.sessionId,
          100,
          state.nextBefore,
        );
        patchSession(set, key, {
          messages: [
            ...page.messages,
            ...(get().bySession[key] ?? EMPTY_SESSION).messages,
          ],
          nextBefore: page.nextBefore,
          loading: false,
        });
      } catch {
        patchSession(set, key, { loading: false });
      }
    },

    send: async (prompt, images) => {
      const { active } = get();
      if (active) await sendPrompt(active, prompt, images);
    },

    respondToGrant: async (key, seq, accept) => {
      const message = get().bySession[key]?.messages.find((m) => m.seq === seq);
      if (!message || message.role !== "grant" || message.grant?.status !== "pending") {
        return;
      }
      if (!accept) {
        patchGrantBySeq(set, key, seq, () => ({ status: "declined" }));
        return;
      }
      const path = message.path;
      if (!path) return;
      try {
        await ipc.grantRoot(path);
        patchGrantBySeq(set, key, seq, (grant) => ({
          ...grant,
          status: "granted",
        }));
      } catch (error) {
        patchSession(set, key, { error: errorText(error) });
      }
    },

    resendLastUser: async (key) => {
      const s = get();
      if (s.streamingByKey[key]) return; // a turn is already running
      const messages = s.bySession[key]?.messages ?? [];
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      if (!lastUser) return;
      const tab =
        s.openTabs.find(
          (t) => sessionKey(t.engine, t.sessionId, t.workspacePath) === key,
        ) ?? s.active;
      if (tab) await sendPrompt(tab, lastUser.text, lastUser.images ?? []);
    },

    queueMessage: (text, images) => {
      const { active } = get();
      if (!active || (!text.trim() && images.length === 0)) return;
      const key = sessionKey(
        active.engine,
        active.sessionId,
        active.workspacePath,
      );
      set((s) => {
        const prev = s.bySession[key] ?? EMPTY_SESSION;
        return {
          bySession: {
            ...s.bySession,
            [key]: {
              ...prev,
              queue: [
                ...prev.queue,
                { id: newId(), text, images, queuedAt: Date.now() },
              ],
            },
          },
        };
      });
    },

    removeQueued: (id) => {
      const { active } = get();
      if (!active) return;
      const key = sessionKey(
        active.engine,
        active.sessionId,
        active.workspacePath,
      );
      set((s) => {
        const prev = s.bySession[key];
        if (!prev) return {};
        return {
          bySession: {
            ...s.bySession,
            [key]: {
              ...prev,
              queue: prev.queue.filter((item) => item.id !== id),
            },
          },
        };
      });
    },
    clearQueue: () => {
      const { active } = get();
      if (!active) return;
      const key = sessionKey(
        active.engine,
        active.sessionId,
        active.workspacePath,
      );
      set((s) => {
        const prev = s.bySession[key];
        if (!prev || prev.queue.length === 0) return {};
        return {
          bySession: {
            ...s.bySession,
            [key]: { ...prev, queue: [] },
          },
        };
      });
    },

    interrupt: async () => {
      const { active } = get();
      if (!active) return;
      const key = sessionKey(
        active.engine,
        active.sessionId,
        active.workspacePath,
      );
      // Settle locally FIRST: the killed run's done event can arrive while
      // the kill IPCs below are still in flight, and onDone drains the queue
      // whenever interrupted is still false — that would fire the next
      // queued message right after the user pressed stop.
      const pending = drainPending(key);
      set((s) => {
        const cur = s.bySession[key] ?? EMPTY_SESSION;
        const messages = settleLiveRows(
          pending
            ? applyStreamParts(cur.messages, pending.parts, pending.model)
            : cur.messages,
        );
        return {
          bySession: {
            ...s.bySession,
            [key]: {
              ...cur,
              messages,
              streaming: false,
              interrupted: true,
              turnStartedAt: null,
            },
          },
          streamingByKey: setStreamingFlag(s.streamingByKey, key, false),
        };
      });
      // Registry is keyed by native session id once known; before that the
      // run id routes. Try both.
      if (active.sessionId)
        await ipc.interruptSession(active.sessionId).catch(() => false);
      const deadRunIds: string[] = [];
      for (const [runId, routed] of runRouting) {
        if (routed === key) deadRunIds.push(runId);
      }
      // Independent kills, one IPC call per routed run — fired together.
      await Promise.all(
        deadRunIds.map((runId) =>
          ipc.interruptSession(runId).catch(() => false),
        ),
      );
      // The runs are dead: drop their routing and usage entries so the maps
      // cannot grow forever. (A late done event would also remove them.)
      for (const runId of deadRunIds) {
        runRouting.delete(runId);
        untrackRun(runId);
        dropRunUsage(runId);
      }
    },

    deleteSession: async (engine, sessionId) => {
      try {
        await ipc.deleteSession(engine, sessionId);
      } catch (error) {
        set({ actionError: errorText(error) });
        return;
      }
      set({ actionError: null });
      const key = sessionKey(engine, sessionId, "");
      const tab = get().openTabs.find(
        (t) => t.engine === engine && t.sessionId === sessionId,
      );
      set((s) => {
        // Permanent delete: the cached session state is dead weight.
        const bySession = { ...s.bySession };
        const drafts = { ...s.drafts };
        delete bySession[key];
        delete drafts[key];
        return {
          sessions: s.sessions.filter(
            (x) => !(x.engine === engine && x.sessionId === sessionId),
          ),
          bySession,
          drafts,
          unseen: omitKey(s.unseen, key),
        };
      });
      // The closed-tab reopen cache must not keep the dead key either.
      const cacheIdx = closedTabCache.indexOf(key);
      if (cacheIdx >= 0) closedTabCache.splice(cacheIdx, 1);
      if (tab) {
        // removeTab activates the neighboring tab when the deleted one was active.
        removeTab(engine, sessionId, tab.workspacePath);
      } else {
        set((s) => ({
          active:
            s.active?.sessionId === sessionId && s.active.engine === engine
              ? null
              : s.active,
        }));
      }
    },

    pinSession: async (engine, sessionId, pinned) => {
      try {
        await ipc.pinSession(engine, sessionId, pinned);
        await get().refreshSessions();
        set({ actionError: null });
      } catch (error) {
        set({ actionError: errorText(error) });
      }
    },

    renameSession: async (engine, sessionId, title) => {
      try {
        await ipc.renameSession(engine, sessionId, title);
        await get().refreshSessions();
        set({ actionError: null });
      } catch (error) {
        set({ actionError: errorText(error) });
      }
    },

    compactContext: async (key?: string) => {
      const { active, streamingByKey, openTabs } = get();
      const targetKey =
        key ??
        (active
          ? sessionKey(active.engine, active.sessionId, active.workspacePath)
          : "");
      if (!targetKey) return;
      if (streamingByKey[targetKey]) return;
      const targetTab =
        openTabs.find(
          (t) =>
            sessionKey(t.engine, t.sessionId, t.workspacePath) === targetKey,
        ) ?? active;
      if (!targetTab) return;

      // Track the compaction turn completion so callers (and UI) can await it.
      let cleanup: (() => void) | undefined;
      const completionPromise = new Promise<void>((resolve) => {
        let started = false;
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        const unsub = useChatStore.subscribe(() => {
          const currentStreaming = get().streamingByKey;
          const isStreaming = Boolean(
            currentStreaming[targetKey] ||
              (targetTab.sessionId &&
                currentStreaming[
                  sessionKey(
                    targetTab.engine,
                    targetTab.sessionId,
                    targetTab.workspacePath,
                  )
                ]),
          );
          if (isStreaming) {
            started = true;
          } else if (started) {
            done();
          }
        });

        const done = () => {
          if (timeoutId) clearTimeout(timeoutId);
          unsub();
          resolve();
        };

        timeoutId = setTimeout(done, 120_000);
        cleanup = () => {
          if (timeoutId) clearTimeout(timeoutId);
          unsub();
        };
      });

      try {
        await sendPrompt(targetTab, "/compact", []);
      } catch (error) {
        cleanup?.();
        throw error;
      }

      await completionPromise;
      // After compaction turn finishes, wait briefly for engine to persist session file,
      // then refresh session usage snapshot.
      await new Promise((r) => setTimeout(r, 400));
      const latestTab =
        get().openTabs.find(
          (t) =>
            sessionKey(t.engine, t.sessionId, t.workspacePath) === targetKey,
        ) ?? get().active;
      const finalKey = latestTab
        ? sessionKey(
            latestTab.engine,
            latestTab.sessionId,
            latestTab.workspacePath,
          )
        : targetKey;
      await get().refreshSessionUsage(finalKey);
    },

    refreshSessionUsage: async (key?: string) => {
      const { active, openTabs } = get();
      const targetKey =
        key ??
        (active
          ? sessionKey(active.engine, active.sessionId, active.workspacePath)
          : "");
      if (!targetKey) return;
      const targetTab =
        openTabs.find(
          (t) =>
            sessionKey(t.engine, t.sessionId, t.workspacePath) === targetKey,
        ) ?? active;

      let engine = targetTab?.engine;
      let sessionId = targetTab?.sessionId;
      if (
        !sessionId &&
        targetKey.includes("/") &&
        !targetKey.startsWith("new:")
      ) {
        const slashIdx = targetKey.indexOf("/");
        engine = targetKey.slice(0, slashIdx);
        sessionId = targetKey.slice(slashIdx + 1);
      }
      if (!engine || !sessionId) return;

      try {
        const page = await ipc.loadSessionPage(
          engine,
          sessionId,
          100,
        );
        const latestUsage =
          [...page.messages].reverse().find((m) => m.usage)?.usage ?? null;
        if (latestUsage) {
          patchSession(set, targetKey, { usage: latestUsage });
        }
        void ipc.rescanSessions();
      } catch (error) {
        console.error("Failed to refresh session usage:", error);
      }
    },
  };
});

// Dev-only handle for poking the store from the webview console; stripped
// from production builds by the env guard.
if (import.meta.env.DEV) {
  (window as unknown as { __chatStore: typeof useChatStore }).__chatStore =
    useChatStore;
}

// HMR swaps this module for a fresh store; without dispose the old module's
// engine/session listeners keep firing into the dead store (and init on the
// new store would double-subscribe).
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    for (const teardown of eventTeardowns.splice(0)) teardown();
  });
}
