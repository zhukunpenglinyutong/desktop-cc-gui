import { normalizeOmpServiceTier } from "@/lib/omp-service-tier";
import {
  ipc,
  type EngineInfo,
  type Message,
  type SessionMeta,
  type Workspace,
} from "@/lib/ipc";
import type { EffortLevel } from "@/components/application/ai-chat/cli-menu";
import { listenEngineEvents, listenSessionsChanged, listenComputerUseEscape } from "@/lib/events";
import { errorText } from "@/lib/errors";
import { writeStored } from "@/lib/storage";
import { subscribeTauriEvent } from "@/hooks/use-tauri-event";
import {
  CLI_CONFIG_CHANGED_EVENT,
  engineCurrents,
} from "@/features/settings/providers";
import {
  ENGINE_PREF_KEY,
  persistTabs,
  readPersistedActive,
  readPersistedTabs,
  sameTab,
  sessionKey,
  type ActiveSession,
} from "./persistence";
import { EMPTY_SESSION, patchSession } from "./stream";
import { handleEngineEvents, upsertSessionMetaInto } from "./engine-events";
import i18n from "@/lib/i18n";
import {
  listExternalSessionMetas,
  setSessionSourcesChangedCallback,
} from "@/features/plugins/runtime/session-source";
import { emitSessionActivated } from "@/features/plugins/runtime/events";
import {
  mergeExternalSessions,
  preserveUnscannedSessions,
  visibleSessions,
} from "./session-utils";
import type { ChatStore } from "./types";
import type { LoadHistoryPage, StoreGet, StoreSet } from "./context";

function omitKey(rec: Record<string, boolean>, key: string) {
  const next = { ...rec };
  delete next[key];
  return next;
}

function archivedKeyMap(sessions: SessionMeta[]): Record<string, true> {
  return Object.fromEntries(
    sessions.map((session) => [
      sessionKey(session.engine, session.sessionId, session.workspacePath),
      true as const,
    ]),
  );
}

function withoutArchived(
  sessions: SessionMeta[],
  archived: Record<string, true>,
): SessionMeta[] {
  return sessions.filter(
    (session) =>
      !archived[sessionKey(session.engine, session.sessionId, session.workspacePath)],
  );
}

/** Merge transcript rows the live view is missing into the open session's
 *  message list, without touching what is already on screen.
 *
 *  Used when a foreign run's frames were dropped (same-session dual run):
 *  its completion turn is in the transcript but was never streamed here.
 *  History rows are aligned against the local rows in order (role + text;
 *  live rows never match — their text is a prefix of the final one). A
 *  history row with no local counterpart is inserted where the alignment
 *  says it belongs; unmatched local rows (the live row of the run still
 *  streaming, ephemeral grant/question cards) keep their place. Inserted
 *  rows get fresh seqs so existing row identities (React keys, card seq
 *  references) stay stable. Idempotent: once every history row has a local
 *  counterpart, the input is returned unchanged. */
export function mergeMissingTranscriptRows(
  local: Message[],
  history: Message[],
): Message[] {
  if (history.length === 0) return local;
  // Greedy in-order alignment of history rows to local rows.
  const matchAt = new Array<number>(history.length).fill(-1);
  let li = 0;
  for (let hi = 0; hi < history.length && li < local.length; hi++) {
    const h = history[hi];
    for (let j = li; j < local.length; j++) {
      const m = local[j];
      if (!m.live && m.role === h.role && m.text === h.text) {
        matchAt[hi] = j;
        li = j + 1;
        break;
      }
    }
  }
  if (matchAt.every((j) => j >= 0)) return local;
  let nextSeq = Math.max(0, ...local.map((m) => m.seq), ...history.map((m) => m.seq)) + 1;
  const out: Message[] = [];
  let cursor = 0;
  for (let hi = 0; hi < history.length; hi++) {
    const j = matchAt[hi];
    if (j < 0) {
      // Missing locally: a dropped run's row. Insert it ahead of the next
      // aligned local row so the transcript's order is preserved.
      out.push({ ...history[hi], seq: nextSeq++ });
      continue;
    }
    for (; cursor < j; cursor++) out.push(local[cursor]);
    out.push(local[j]);
    cursor = j + 1;
  }
  for (; cursor < local.length; cursor++) out.push(local[cursor]);
  return out;
}

/** Targeted transcript re-read for one open session: fold transcript rows
 *  the live view missed (a foreign run's dropped completion turn) into
 *  bySession[key].messages. Unlike selectSession's load — which returns
 *  early once messages exist — this merges on top of a live session
 *  without disturbing the in-flight run's rows or pending streams. The
 *  transcript write can trail the terminal event that triggered this, so
 *  an empty first merge retries once after a short delay; the merge is
 *  idempotent, and a session already holding the rows is a no-op. */
export async function mergeTranscriptTail(
  set: StoreSet,
  get: StoreGet,
  loadHistoryPage: LoadHistoryPage,
  key: string,
  retryDelayMs = 400,
): Promise<void> {
  // Native session keys are `${engine}/${sessionId}`; the workspace comes
  // from the tab that owns the key (remote transcripts resolve through it).
  const tab = get().openTabs.find(
    (t) => sessionKey(t.engine, t.sessionId, t.workspacePath) === key,
  );
  const slash = key.indexOf("/");
  const engine = tab?.engine ?? (slash > 0 ? key.slice(0, slash) : "");
  const sessionId = tab?.sessionId ?? (slash > 0 ? key.slice(slash + 1) : "");
  if (!engine || !sessionId) return;
  const workspacePath = tab?.workspacePath ?? get().active?.workspacePath ?? "";
  const mergeOnce = async (): Promise<boolean> => {
    const page = await loadHistoryPage(engine, sessionId, workspacePath, 100).catch(
      () => null,
    );
    if (!page || page.messages.length === 0) return false;
    let merged = false;
    set((s) => {
      const cur = s.bySession[key];
      if (!cur) return {};
      const messages = mergeMissingTranscriptRows(cur.messages, page.messages);
      if (messages === cur.messages) return {};
      merged = true;
      return { bySession: { ...s.bySession, [key]: { ...cur, messages } } };
    });
    return merged;
  };
  if (await mergeOnce()) return;
  if (retryDelayMs > 0) {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, retryDelayMs);
    await promise;
    await mergeOnce();
  }
}

/**
 * Session lifecycle: init/refresh of the session/engine catalogs, history
 * paging, and sidebar session ops (archive/delete/pin/rename).
 */

export interface SessionDeps {
  set: StoreSet;
  get: StoreGet;
  loadHistoryPage: LoadHistoryPage;
  /** Module-scope unlisteners (store.ts) init pushes into; HMR dispose runs them. */
  eventTeardowns: Array<() => void>;
  activateTab: (tab: ActiveSession | null) => void;
  removeTab: (
    engine: string,
    sessionId: string | null,
    workspacePath: string,
  ) => void;
  forgetClosedTab: (key: string) => void;
  drainQueue: (key: string) => void;
  markUnseenIfBackground: (key: string) => void;
}

export function createSessionActions(
  deps: SessionDeps,
): Pick<
  ChatStore,
  | "init"
  | "refreshSessions"
  | "refreshEngines"
  | "selectSession"
  | "loadEarlier"
  | "archiveSession"
  | "deleteSession"
  | "pinSession"
  | "renameSession"
> {
  const {
    set,
    get,
    loadHistoryPage,
    eventTeardowns,
    activateTab,
    removeTab,
    forgetClosedTab,
    drainQueue,
    markUnseenIfBackground,
  } = deps;

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
              // A foreign run's dropped frames (dual-run) are backfilled from
              // the transcript when that run settles — rescanSessions only
              // refreshes the sidebar, it never touches an open session's
              // messages.
              reloadTranscript: (k) =>
                void mergeTranscriptTail(set, get, loadHistoryPage, k).catch(
                  () => {},
                ),
            }),
          ),
        ),
        subscribeTauriEvent(() =>
          listenSessionsChanged(() => void get().refreshSessions()),
        ),
        // Global Esc during a computer-use run: the backend arms that hotkey
        // only while a run is active, so this fires exactly when the user
        // needs the escape hatch out of a machine-driving turn.
        subscribeTauriEvent(() =>
          listenComputerUseEscape(() => void get().interrupt()),
        ),
      );
      // Settings' CLI enable switch / channel edits: re-filter history and
      // picker options without a restart.
      const onCliConfigChanged = () => void get().refreshEngines();
      window.addEventListener(CLI_CONFIG_CHANGED_EVENT, onCliConfigChanged);
      eventTeardowns.push(() =>
        window.removeEventListener(CLI_CONFIG_CHANGED_EVENT, onCliConfigChanged),
      );
      const [workspaces, sessions, archivedSessions, engines] = await Promise.all([
        ipc.listWorkspaces().catch(() => [] as Workspace[]),
        ipc.listSessions().catch(() => [] as SessionMeta[]),
        ipc.listArchivedSessions().catch(() => [] as SessionMeta[]),
        ipc.listEngines().catch(() => [] as EngineInfo[]),
      ]);
      // Plugin session sources (remote/容器内 CLI) merge under the local
      // scan so WSL 等远端会话进侧栏,且重启时已开标签不至于因“会话表无
      // 此会话”被清掉。
      setSessionSourcesChangedCallback(() => void get().refreshSessions());
      const external = await listExternalSessionMetas();
      const archivedSessionKeys = archivedKeyMap(archivedSessions);
      const allSessions = withoutArchived(
        mergeExternalSessions(sessions, external, workspaces.map((w) => w.path)),
        archivedSessionKeys,
      );
      set({
        workspaces,
        sessions: visibleSessions(allSessions, engines),
        archivedSessionKeys,
        engines,
      });
      ensureUsableEngine(engines);
      // Restore persisted tabs; drop ones whose workspace/session is gone.
      const restoredTabs = readPersistedTabs().filter(
        (t) =>
          workspaces.some((w) => w.path === t.workspacePath) &&
          (t.sessionId === null ||
            allSessions.some(
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
            thinkingAutoCollapse: settings.thinkingAutoCollapse ?? true,
            thinkingAutoExpand: settings.thinkingAutoExpand ?? true,
          }),
        )
        .catch(() => {});
      ipc
        .getCliConfig?.()
        ?.then((config) => set({ providers: engineCurrents(config) }))
        .catch(() => {});
    },

    refreshSessions: async () => {
      const [sessions, external, archivedSessions] = await Promise.all([
        ipc.listSessions().catch(() => null),
        listExternalSessionMetas(),
        ipc.listArchivedSessions().catch(() => null),
      ]);
      if (!sessions || !archivedSessions) return;
      const archivedSessionKeys = archivedKeyMap(archivedSessions);
      const merged = withoutArchived(
        mergeExternalSessions(sessions, external, get().workspaces.map((w) => w.path)),
        archivedSessionKeys,
      );
      set((s) => {
        const visible = visibleSessions(
          withoutArchived(
            preserveUnscannedSessions(merged, s.sessions, s.bySession),
            archivedSessionKeys,
          ),
          s.engines,
        );
        const bySession = { ...s.bySession };
        const drafts = { ...s.drafts };
        const unseen = { ...s.unseen };
        const streamingByKey = { ...s.streamingByKey };
        const retryingByKey = { ...s.retryingByKey };
        for (const key of Object.keys(archivedSessionKeys)) {
          delete bySession[key];
          delete drafts[key];
          delete unseen[key];
          delete streamingByKey[key];
          delete retryingByKey[key];
        }
        for (const meta of merged) {
          const key = sessionKey(meta.engine, meta.sessionId, meta.workspacePath);
          const current = bySession[key];
          if (!current) continue;
          bySession[key] = {
            ...current,
            activeModel: meta.model ?? current.activeModel,
            activeEffort: meta.effort ?? current.activeEffort,
            activeProvider: meta.provider ?? current.activeProvider,
          };
        }
        const openTabs = s.openTabs.filter(
          (tab) =>
            tab.sessionId === null ||
            !archivedSessionKeys[sessionKey(tab.engine, tab.sessionId, tab.workspacePath)],
        );
        const active =
          s.active?.sessionId &&
          archivedSessionKeys[
            sessionKey(s.active.engine, s.active.sessionId, s.active.workspacePath)
          ]
            ? (openTabs[0] ?? null)
            : s.active;
        persistTabs(openTabs, active);
        return {
          sessions: visible,
          archivedSessionKeys,
          bySession,
          drafts,
          unseen,
          streamingByKey,
          retryingByKey,
          openTabs,
          active,
        };
      });
    },

    refreshEngines: async () => {
      const [engines, sessions, external, archivedSessions, config] = await Promise.all([
        ipc.listEngines().catch(() => null),
        ipc.listSessions().catch(() => null),
        listExternalSessionMetas(),
        ipc.listArchivedSessions().catch(() => null),
        ipc.getCliConfig?.().catch(() => null) ?? Promise.resolve(null),
      ]);
      if (!engines) return;
      set((s) => {
        const keys = archivedSessions
          ? archivedKeyMap(archivedSessions)
          : s.archivedSessionKeys;
        return {
          engines,
          archivedSessionKeys: keys,
          ...(sessions
            ? {
                sessions: visibleSessions(
                  withoutArchived(
                    preserveUnscannedSessions(
                      mergeExternalSessions(
                        sessions,
                        external,
                        s.workspaces.map((w) => w.path),
                      ),
                      s.sessions,
                      s.bySession,
                    ),
                    keys,
                  ),
                  engines,
                ),
              }
            : {}),
          ...(config ? { providers: engineCurrents(config) } : {}),
        };
      });
      ensureUsableEngine(engines);
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
      // Same for the reasoning level: the picker and the next send follow the
      // session, so an unset level adopts the one this session last ran.
      const rememberedEffort = get().sessions.find(
        (x) => x.engine === engine && x.sessionId === sessionId,
      )?.effort;
      if (rememberedEffort && !get().bySession[key]?.activeEffort) {
        patchSession(set, key, { activeEffort: rememberedEffort });
      }
      const rememberedProvider = get().sessions.find(
        (x) => x.engine === engine && x.sessionId === sessionId,
      )?.provider;
      if (rememberedProvider && !get().bySession[key]?.activeProvider) {
        patchSession(set, key, { activeProvider: rememberedProvider });
      }
      const syncEngine = engine !== get().activeEngine;
      if (syncEngine) writeStored(ENGINE_PREF_KEY, engine);
      set((s) => {
        // Native sessions read effort from SessionState/database. Strip the
        // legacy per-tab field so an old localStorage value cannot shadow it.
        const stored = s.openTabs.find((t) =>
          sameTab(t, engine, sessionId, workspacePath),
        );
        const tab: ActiveSession = stored
          ? { ...stored, effort: undefined, provider: undefined }
          : { engine, sessionId, workspacePath };
        const openTabs = stored
          ? s.openTabs.map((t) => (t === stored ? tab : t))
          : [...s.openTabs, tab];
        persistTabs(openTabs, tab);
        const unseen = key in s.unseen ? omitKey(s.unseen, key) : s.unseen;
        return { openTabs, active: tab, unseen, activeEngine: engine };
      });
      emitSessionActivated(engine, sessionId);
      const existing = get().bySession[key];
      if (existing && existing.messages.length > 0) return;
      patchSession(set, key, { loading: true });
      try {
        const page = await loadHistoryPage(engine, sessionId, workspacePath, 100);
        patchSession(set, key, {
          messages: page.messages,
          subagentHistory: page.subagentHistory,
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
        const page = await loadHistoryPage(
          active.engine,
          active.sessionId,
          active.workspacePath,
          100,
          state.nextBefore,
        );
        patchSession(set, key, {
          messages: [
            ...page.messages,
            ...(get().bySession[key] ?? EMPTY_SESSION).messages,
          ],
          nextBefore: page.nextBefore,
          subagentHistory: page.subagentHistory,
          loading: false,
        });
      } catch {
        patchSession(set, key, { loading: false });
      }
    },

    archiveSession: async (session) => {
      const { engine, sessionId, workspacePath } = session;
      const key = sessionKey(engine, sessionId, workspacePath);
      if (get().streamingByKey[key]) {
        set({ actionError: i18n.t("chat.archiveRunning") });
        return;
      }
      try {
        await ipc.archiveSession(session);
      } catch (error) {
        set({ actionError: errorText(error) });
        return;
      }
      set((s) => {
        const bySession = { ...s.bySession };
        const drafts = { ...s.drafts };
        delete bySession[key];
        delete drafts[key];
        return {
          sessions: s.sessions.filter(
            (item) => !(item.engine === engine && item.sessionId === sessionId),
          ),
          archivedSessionKeys: { ...s.archivedSessionKeys, [key]: true },
          bySession,
          drafts,
          unseen: omitKey(s.unseen, key),
          actionError: null,
        };
      });
      forgetClosedTab(key);
      const tab = get().openTabs.find(
        (item) => item.engine === engine && item.sessionId === sessionId,
      );
      if (tab) removeTab(engine, sessionId, tab.workspacePath);
    },

    deleteSession: async (engine, sessionId) => {
      // 远程(插件会话源,如 WSL 发行版内 CLI)会话没有本地 db 行,本地
      // delete_session 只会 "session not found";走远程通道删 remotePath。
      const meta = get().sessions.find(
        (x) => x.engine === engine && x.sessionId === sessionId,
      );
      try {
        if (meta?.remote && meta.remotePath) {
          await ipc.deleteRemoteSession(meta.workspacePath, engine, meta.remotePath);
        } else {
          await ipc.deleteSession(engine, sessionId);
        }
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
        const streamingByKey = { ...s.streamingByKey };
        const retryingByKey = { ...s.retryingByKey };
        delete bySession[key];
        delete drafts[key];
        // Deleting a running session must clear its flat-map flags too:
        // nothing re-scans a deleted key later (archive is swept by
        // refreshSessions; a delete is gone for good).
        delete streamingByKey[key];
        delete retryingByKey[key];
        return {
          sessions: s.sessions.filter(
            (x) => !(x.engine === engine && x.sessionId === sessionId),
          ),
          bySession,
          drafts,
          streamingByKey,
          retryingByKey,
          unseen: omitKey(s.unseen, key),
        };
      });
      // The closed-tab reopen cache must not keep the dead key either.
      forgetClosedTab(key);
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
  };
}
