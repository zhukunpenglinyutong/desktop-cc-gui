import { normalizeOmpServiceTier } from "@/lib/omp-service-tier";
import {
  AGENT_STATUS_ROLE,
  ipc,
  type EngineInfo,
  type Message,
  type SessionMeta,
  type SessionPage,
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
import { mergePlanReviewHistory } from "./plan-review";
import { withoutComposerAttachments } from "./attachments";
import i18n from "@/lib/i18n";
import {
  listExternalSessionMetas,
  setSessionSourcesChangedCallback,
} from "@/features/plugins/runtime/session-source";
import { emitSessionActivated } from "@/features/plugins/runtime/events";
import { sessionSelection } from "./selection";
import {
  dispatchSessionClosed,
  dispatchSessionRestored,
} from "@/features/plugins/runtime/hooks";
import { clearScopedContributions, sessionLifecycleBase } from "./lifecycle";
import {
  mergeExternalSessions,
  preserveUnscannedSessions,
  visibleSessions,
} from "./session-utils";
import type { ChatStore } from "./types";
import type { LoadHistoryPage, StoreGet, StoreSet } from "./context";
import { agentState, deriveAgentTaskSteps, dispatchRefsFromArgs } from "../components/agent-task-steps";

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

const SUBAGENT_STATUS_RETRY_DELAYS_MS = [2_000, 10_000, 30_000] as const;
const SUBAGENT_STATUS_PAGE_SIZE = 100;
/** After the backoff, keep polling at the capped interval for roughly ten
 *  minutes: a job whose completion never reaches the transcript (killed
 *  task, crashed engine) must not keep this tab reading forever. */
const SUBAGENT_STATUS_MAX_RETRIES = 20;
/** Only the pi-family extractor turns async completions into status rows. */
const SUBAGENT_STATUS_ENGINES: Record<string, true> = { pi: true, omp: true };
/** A hung read (remote / WSL page fetch) would otherwise hold `task.promise`
 *  forever and freeze every later refresh for this session. */
const SUBAGENT_STATUS_READ_TIMEOUT_MS = 60_000;
const SUBAGENT_STATUS_BUCKETS = ["jobs", "peers", "progress"] as const;

function withStatusReadTimeout<T>(read: Promise<T>, ms: number): Promise<T> {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  const timer = window.setTimeout(
    () => reject(new Error("subagent status read timed out")),
    ms,
  );
  read.then(
    (value) => {
      window.clearTimeout(timer);
      resolve(value);
    },
    (error) => {
      window.clearTimeout(timer);
      reject(error);
    },
  );
  return promise;
}
// Appending rows changes their local seq, not their transcript identity/order.
const statusRowSources = new WeakMap<Message, { seq: number; signature: string | null }>();
// Rows parsed from a transcript carry the engine host's clock; rows appended
// from the live event stream carry this machine's. The two clocks are not
// comparable (a WSL / remote host can run minutes behind after a suspend), so
// supersede checks only trust timestamps from transcript rows.
const transcriptRows = new WeakSet<Message>();

function markTranscriptRows(rows: Message[]): void {
  for (const row of rows) transcriptRows.add(row);
}

type StatusRefreshTask = {
  retriesScheduled: number;
  /** Retry attempts since the last `done` / `error` / tab revisit; unlike
   *  `retriesScheduled` this is not capped by the delay table. */
  retriesTotal: number;
  timer: number | null;
  promise: Promise<void> | null;
  cancelled: boolean;
  refreshAfterCancel: boolean;
  /** An arm that arrived while a cancelled read still held the slot; the
   *  backoff is re-scheduled once that read settles. */
  pendingArm: boolean;
};

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function statusJobId(value: unknown): string | undefined {
  const entry = recordValue(value);
  if (!entry || agentState(entry.status) === undefined) return undefined;
  const id = typeof entry.id === "string" ? entry.id.trim() : "";
  const jobId = typeof entry.jobId === "string" ? entry.jobId.trim() : "";
  return id || jobId || undefined;
}

function statusJobIds(message: Message): string[] {
  if (message.role !== "tool" && message.role !== AGENT_STATUS_ROLE) return [];
  const details = recordValue(recordValue(message.result)?.details);
  if (!details) return [];
  const ids: string[] = [];
  for (const bucket of SUBAGENT_STATUS_BUCKETS) {
    const values = details[bucket];
    if (!Array.isArray(values)) continue;
    for (const value of values) {
      const id = statusJobId(value);
      if (id) ids.push(id);
    }
  }
  return ids;
}

function isNewerTranscriptRow(message: Message, candidate: Message): boolean {
  if (message === candidate) return false;
  // Both sides sort in the transcript's sequence space: history rows keep the
  // file's seq and appended status rows carry the source seq recorded in
  // `statusRowSources`. Timestamps win when both sides have one; a live row's
  // clock is not comparable with the engine host's, and the caller gates that
  // case before trusting a time comparison.
  const timestamp = message.ts ? Date.parse(message.ts) : NaN;
  const candidateTimestamp = candidate.ts ? Date.parse(candidate.ts) : NaN;
  if (Number.isFinite(timestamp) && Number.isFinite(candidateTimestamp) && timestamp !== candidateTimestamp) {
    return timestamp > candidateTimestamp;
  }
  return (statusRowSources.get(message)?.seq ?? message.seq) >
    (statusRowSources.get(candidate)?.seq ?? candidate.seq);
}

function hasNewerJobEvidence(
  candidate: Message,
  jobId: string,
  transcript: Message[],
  sameClock: (message: Message) => boolean,
): boolean {
  return transcript.some((message) => {
    if (!isNewerTranscriptRow(message, candidate)) return false;
    // A live row's timestamp comes from this machine, the delivery's from the
    // engine host. When the host clock runs behind, the delivery looks older
    // than the last live "running" snapshot even though it happened after;
    // only rows from the same transcript clock may supersede it by time.
    if (message.ts && candidate.ts && !sameClock(message)) return false;
    if (statusJobIds(message).includes(jobId)) return true;
    return message.role === "tool" &&
      dispatchRefsFromArgs(message.args).some((ref) => ref.id === jobId);
  });
}

function withoutSupersededJobs(
  message: Message,
  transcript: Message[],
  sameClock: (message: Message) => boolean,
): Message | null {
  const result = recordValue(message.result);
  const details = recordValue(result?.details);
  if (!result || !details) return null;
  let changed = false;
  let remaining = 0;
  const nextDetails = { ...details };
  const keepProgressIdentity = message.role === "tool" && Boolean(message.toolCallId) &&
    dispatchRefsFromArgs(message.args).length > 0;
  for (const bucket of SUBAGENT_STATUS_BUCKETS) {
    const values = details[bucket];
    if (!Array.isArray(values)) continue;
    const filtered: unknown[] = [];
    let bucketChanged = false;
    for (const value of values) {
      const id = statusJobId(value);
      if (id && hasNewerJobEvidence(message, id, transcript, sameClock)) {
        bucketChanged = true;
        // Completion supersedes the running state, not the dispatch's
        // authoritative index -> runtime id association.
        const entry = recordValue(value);
        if (bucket === "progress" && keepProgressIdentity && typeof entry?.id === "string") {
          filtered.push({ id: entry.id, index: entry.index });
          remaining++;
        }
      } else {
        filtered.push(value);
        if (id) remaining++;
      }
    }
    if (bucketChanged) {
      changed = true;
      nextDetails[bucket] = filtered;
    }
  }
  if (!remaining) return null;
  return changed
    ? { ...message, result: { ...result, details: nextDetails } }
    : message;
}

function statusRowSignature(message: Message): string | null {
  const source = statusRowSources.get(message);
  if (source) return source.signature;
  try {
    return JSON.stringify([message.text, message.args ?? null, message.result ?? null]);
  } catch {
    return null;
  }
}

function freshStatusRows(
  current: Message[],
  pageMessages: Message[],
  firstSequence: number,
): Message[] {
  const transcript = [...current, ...pageMessages];
  // The page and previously appended transcript rows share the engine's
  // clock; everything else in `current` is live.
  const pageRows = new WeakSet(pageMessages);
  const sameClock = (message: Message) =>
    pageRows.has(message) || transcriptRows.has(message);
  // A tool snapshot can supersede a delivery only if its state is retained
  // too. Keep it hidden rather than adding a second visible hub/task row.
  const sourceKey = (message: Message) => JSON.stringify([
    statusRowSources.get(message)?.seq ?? message.seq,
    message.ts,
    statusRowSignature(message),
  ]);
  const currentSources = new Set(current
    .filter((message) => statusRowSources.has(message) || statusJobIds(message).length > 0)
    .map(sourceKey));
  // A delivery is identified by its timestamp, but two deliveries can land in
  // the same millisecond; only treat a same-ts row as a duplicate when every
  // job it reports is already covered by that timestamp.
  const timestampJobs = new Map<string, Set<string>>();
  for (const message of current) {
    if (message.role !== AGENT_STATUS_ROLE || !message.ts) continue;
    const known = timestampJobs.get(message.ts) ?? new Set<string>();
    for (const id of statusJobIds(message)) known.add(id);
    timestampJobs.set(message.ts, known);
  }
  const signatures = new Set(
    current
      .filter((message) => message.role === AGENT_STATUS_ROLE && !message.ts)
      .map(statusRowSignature)
      .filter((signature): signature is string => Boolean(signature)),
  );
  const rows = pageMessages
    .filter((message) => message.role === AGENT_STATUS_ROLE || statusJobIds(message).length > 0)
    .sort((left, right) => left.seq - right.seq);
  const fresh: Message[] = [];
  let seq = firstSequence;
  for (const source of rows) {
    const signature = statusRowSignature(source);
    const key = sourceKey(source);
    if (source.role === "tool" && currentSources.has(key)) continue;
    const jobs = source.ts ? statusJobIds(source) : [];
    if (source.role === AGENT_STATUS_ROLE) {
      if (source.ts) {
        const known = timestampJobs.get(source.ts);
        if (known && jobs.every((id) => known.has(id))) continue;
      } else if (signature && signatures.has(signature)) {
        continue;
      }
    }
    const message = withoutSupersededJobs(source, transcript, sameClock);
    if (!message) continue;
    const appended = { ...message, seq: seq++, role: AGENT_STATUS_ROLE, text: "" };
    transcriptRows.add(appended);
    statusRowSources.set(appended, {
      seq: statusRowSources.get(source)?.seq ?? source.seq,
      signature,
    });
    fresh.push(appended);
    currentSources.add(key);
    if (source.ts) {
      const known = timestampJobs.get(source.ts) ?? new Set<string>();
      for (const id of jobs) known.add(id);
      timestampJobs.set(source.ts, known);
    } else if (signature) {
      signatures.add(signature);
    }
  }
  return fresh;
}


function hasActiveSubagents(messages: Message[], engine: string): boolean {
  return deriveAgentTaskSteps(messages, false, engine).some(
    (step) => step.state === "active",
  );
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
  /** 一轮结束后的复盘计数钩子（store.ts 接记忆模块）。 */
  turnSettled: (key: string) => void;
}

export function createSessionActions(
  deps: SessionDeps,
): Pick<
  ChatStore,
  | "init"
  | "refreshSessions"
  | "refreshEngines"
  | "selectSession"
  | "refreshSubagentStatus"
  | "cancelSubagentStatusRefresh"
  | "reloadSession"
  | "forkSession"
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
    turnSettled,
  } = deps;
  let historyReloadId = 0;

  const statusRefreshes = new Map<string, StatusRefreshTask>();

  const cancelStatusRefresh = (key: string) => {
    const task = statusRefreshes.get(key);
    if (!task) return;
    if (task.timer !== null) {
      window.clearTimeout(task.timer);
      task.timer = null;
    }
    task.cancelled = true;
    task.refreshAfterCancel = false;
    task.pendingArm = false;
    if (!task.promise) statusRefreshes.delete(key);
  };

  const runStatusRefresh = (key: string, task: StatusRefreshTask): Promise<void> => {
    if (statusRefreshes.get(key) !== task || task.cancelled) return Promise.resolve();
    if (task.promise) return task.promise;

    const request = (async () => {
      const beforeStore = get();
      const tab = beforeStore.openTabs.find(
        (item) => sessionKey(item.engine, item.sessionId, item.workspacePath) === key,
      );
      const before = beforeStore.bySession[key];
      if (
        !tab?.sessionId ||
        !before ||
        !SUBAGENT_STATUS_ENGINES[tab.engine] ||
        before.streaming ||
        beforeStore.streamingByKey[key] ||
        !hasActiveSubagents([...before.subagentHistory, ...before.messages], tab.engine)
      ) {
        cancelStatusRefresh(key);
        return;
      }

      const sessionId = tab.sessionId;
      const readPage = (beforeSeq: number | null) =>
        withStatusReadTimeout(
          loadHistoryPage(
            tab.engine,
            sessionId,
            tab.workspacePath,
            SUBAGENT_STATUS_PAGE_SIZE,
            beforeSeq,
          ),
          SUBAGENT_STATUS_READ_TIMEOUT_MS,
        );
      // The read in flight may finish after the window moved (a stream, a
      // reload, another history page); only fold it over the exact window it
      // was requested for. A cancelled task is left untouched: `clearRequest`
      // owns its restart (or the pending arm), so clearing its flag here would
      // drop the refresh that was queued for it.
      const stillFresh = (): boolean => {
        if (statusRefreshes.get(key) !== task) return false;
        if (task.cancelled) return false;
        const store = get();
        const current = store.bySession[key];
        if (!current || current.streaming || store.streamingByKey[key]) {
          cancelStatusRefresh(key);
          return false;
        }
        if (
          !store.openTabs.some(
            (item) => sessionKey(item.engine, item.sessionId, item.workspacePath) === key,
          )
        ) {
          cancelStatusRefresh(key);
          return false;
        }
        if (current.messages !== before.messages || current.subagentHistory !== before.subagentHistory) {
          if (hasActiveSubagents([...current.subagentHistory, ...current.messages], tab.engine)) {
            scheduleStatusRetry(key, task, tab.engine);
          } else {
            cancelStatusRefresh(key);
          }
          return false;
        }
        return true;
      };
      const collectFresh = (pages: SessionPage[]): Message[] => {
        const pageRows = pages.flatMap((entry) => [...entry.subagentHistory, ...entry.messages]);
        const currentRows = [...before.subagentHistory, ...before.messages];
        // Appended rows must sort after every transcript row on screen — the
        // folded history uses the same sequence space as `messages`.
        let firstSequence = 1;
        for (const message of [...currentRows, ...pageRows]) {
          if (message.seq >= firstSequence) firstSequence = message.seq + 1;
        }
        return freshStatusRows(currentRows, pageRows, firstSequence);
      };

      try {
        // `page.messages` carries the deliveries inside the newest window and
        // `page.subagentHistory` every one before it, so this single page is
        // the whole transcript's status. Paging older never adds a delivery.
        const page = await readPage(null);
        if (!stillFresh()) return;
        const rows = collectFresh([page]);
        if (rows.length > 0) {
          patchSession(set, key, { messages: [...before.messages, ...rows] });
        }
        const current = get().bySession[key];
        if (
          current &&
          !current.streaming &&
          !get().streamingByKey[key] &&
          hasActiveSubagents([...current.subagentHistory, ...current.messages], tab.engine)
        ) {
          scheduleStatusRetry(key, task, tab.engine);
        } else {
          cancelStatusRefresh(key);
        }
      } catch {
        if (statusRefreshes.get(key) !== task || task.cancelled) return;
        const latestStore = get();
        const latest = latestStore.bySession[key];
        if (latest?.streaming || latestStore.streamingByKey[key]) {
          cancelStatusRefresh(key);
        } else if (
          latest &&
          hasActiveSubagents([...latest.subagentHistory, ...latest.messages], tab.engine)
        ) {
          scheduleStatusRetry(key, task, tab.engine);
        } else {
          cancelStatusRefresh(key);
        }
      }
    })();
    task.promise = request;
    const clearRequest = () => {
      if (statusRefreshes.get(key) !== task || task.promise !== request) return;
      task.promise = null;
      if (task.refreshAfterCancel) {
        task.refreshAfterCancel = false;
        task.cancelled = false;
        task.retriesScheduled = 0;
        task.retriesTotal = 0;
        void runStatusRefresh(key, task);
      } else if (task.pendingArm) {
        // Manual reload finished while this read was in flight: restart the
        // backoff on the reloaded window instead of leaving the poll dead.
        task.pendingArm = false;
        task.cancelled = false;
        task.retriesScheduled = 0;
        task.retriesTotal = 0;
        const engine = get().openTabs.find(
          (item) => sessionKey(item.engine, item.sessionId, item.workspacePath) === key,
        )?.engine;
        if (engine) scheduleStatusRetry(key, task, engine);
        else statusRefreshes.delete(key);
      } else if (task.cancelled || task.timer === null) {
        statusRefreshes.delete(key);
      }
    };
    void request.then(clearRequest, clearRequest);
    return request;
  };

  const scheduleStatusRetry = (
    key: string,
    task: StatusRefreshTask,
    engine: string,
  ) => {
    if (statusRefreshes.get(key) !== task || task.timer !== null) return;
    const latestStore = get();
    const latest = latestStore.bySession[key];
    if (
      !latest ||
      latest.streaming ||
      latestStore.streamingByKey[key] ||
      !latestStore.openTabs.some((tab) => sessionKey(tab.engine, tab.sessionId, tab.workspacePath) === key) ||
      !hasActiveSubagents([...latest.subagentHistory, ...latest.messages], engine)
    ) {
      cancelStatusRefresh(key);
      return;
    }
    // The transcript can settle after the engine's `done` event; keep polling
    // at the capped interval while the delegated task still appears active.
    if (task.retriesTotal >= SUBAGENT_STATUS_MAX_RETRIES) {
      cancelStatusRefresh(key);
      return;
    }
    task.retriesTotal += 1;
    const delayIndex = Math.min(
      task.retriesScheduled,
      SUBAGENT_STATUS_RETRY_DELAYS_MS.length - 1,
    );
    task.retriesScheduled = delayIndex + 1;
    const delay = SUBAGENT_STATUS_RETRY_DELAYS_MS[delayIndex];
    task.timer = window.setTimeout(() => {
      task.timer = null;
      void runStatusRefresh(key, task);
    }, delay);
  };

  const refreshSubagentStatus = (key: string): Promise<void> => {
    let task = statusRefreshes.get(key);
    if (task?.promise) {
      const activeTask = task;
      const inFlight = task.promise;
      if (!activeTask.cancelled) {
        // The turn just settled / failed: the read in flight still belongs to
        // the new signal, so restart the retry budget from here.
        activeTask.retriesScheduled = 0;
        activeTask.retriesTotal = 0;
        return inFlight;
      }
      activeTask.refreshAfterCancel = true;
      return inFlight.then(() => {
        if (statusRefreshes.get(key) === activeTask) return activeTask.promise ?? undefined;
      });
    }
    if (task?.timer !== null && task?.timer !== undefined) {
      window.clearTimeout(task.timer);
      task.timer = null;
    }
    if (!task) {
      task = {
        retriesScheduled: 0,
        retriesTotal: 0,
        timer: null,
        promise: null,
        cancelled: false,
        refreshAfterCancel: false,
        pendingArm: false,
      };
      statusRefreshes.set(key, task);
    }
    task.cancelled = false;
    // A fresh signal (turn settled, failure, tab revisit) re-arms the budget.
    task.retriesScheduled = 0;
    task.retriesTotal = 0;
    return runStatusRefresh(key, task);
  };

  /** The page just loaded is already the newest page, so reading it again
   *  right away can only return the same rows. When it still shows a running
   *  subagent, wait out the first backoff instead. */
  const armStatusRetry = (key: string): void => {
    const store = get();
    const tab = store.openTabs.find(
      (item) => sessionKey(item.engine, item.sessionId, item.workspacePath) === key,
    );
    const session = store.bySession[key];
    if (
      !tab ||
      !session ||
      !SUBAGENT_STATUS_ENGINES[tab.engine] ||
      session.streaming ||
      store.streamingByKey[key] ||
      !hasActiveSubagents([...session.subagentHistory, ...session.messages], tab.engine)
    ) {
      return;
    }
    let task = statusRefreshes.get(key);
    if (task?.timer !== null && task?.timer !== undefined) return;
    if (task?.promise) {
      // A cancelled read (manual reload took over) still holds the slot; arm
      // once it settles instead of dropping the backoff for good.
      if (task.cancelled) task.pendingArm = true;
      return;
    }
    if (!task) {
      task = {
        retriesScheduled: 0,
        retriesTotal: 0,
        timer: null,
        promise: null,
        cancelled: false,
        refreshAfterCancel: false,
        pendingArm: false,
      };
      statusRefreshes.set(key, task);
    }
    task.cancelled = false;
    task.refreshAfterCancel = false;
    task.retriesScheduled = 0;
    task.retriesTotal = 0;
    scheduleStatusRetry(key, task, tab.engine);
  };

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
    refreshSubagentStatus,
    cancelSubagentStatusRefresh: cancelStatusRefresh,

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
              refreshSubagentStatus: (k) => void refreshSubagentStatus(k),
              cancelSubagentStatusRefresh: cancelStatusRefresh,
              turnSettled,
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
      // Hydrate the selection inputs (default models / current providers)
      // BEFORE the first activation: the retained session://activated payload
      // reads them via sessionSelection, and nothing re-emits after they
      // land — a plugin loading later would replay null provider/model
      // forever (until the user switches tabs or changes a pick).
      await Promise.all([
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
              wideLayout: settings.chatWideLayout ?? false,
            }),
          )
          .catch(() => {}),
        Promise.resolve(ipc.getCliConfig?.())
          .then((config) => {
            if (config) set({ providers: engineCurrents(config) });
          })
          .catch(() => {}),
      ]);
      if (activeTab) activateTab(activeTab);
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
      for (const session of archivedSessions) {
        clearScopedContributions(set, session.engine, session.sessionId, session.workspacePath);
        const tab = get().openTabs.find((candidate) =>
          sameTab(candidate, session.engine, session.sessionId, session.workspacePath),
        );
        if (tab) dispatchSessionClosed(sessionLifecycleBase(get, tab));
      }
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
        // Composer attachments die with their session, same as the draft
        // above: a hidden conversation must not keep a picture (and its
        // sandbox file reference) alive.
        const composerAttachments = withoutComposerAttachments(
          s.composerAttachments,
          Object.keys(archivedSessionKeys),
        );
        for (const meta of merged) {
          const key = sessionKey(meta.engine, meta.sessionId, meta.workspacePath);
          const current = bySession[key];
          if (!current) continue;
          bySession[key] = {
            ...current,
            // Saved selectors drive the next send, not the model already running.
            activeModel: current.streaming && current.activeModel
              ? current.activeModel
              : meta.model ?? current.activeModel,
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
          composerAttachments,
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
      // A selection restores the session whether or not its messages are
      // already cached (e.g. reopened after a tab close): the hook fires once
      // per frontend lifetime, before any load.
      if (!get().restoredSessionKeys[key]) {
        set((s) => ({ restoredSessionKeys: { ...s.restoredSessionKeys, [key]: true } }));
        dispatchSessionRestored({ ...sessionLifecycleBase(get, { engine, sessionId, workspacePath }), sessionId });
      }
      emitSessionActivated(
        engine,
        sessionId,
        sessionSelection(get(), engine, sessionId, workspacePath),
      );
      const existing = get().bySession[key];
      if (existing?.loading) return;
      if (existing && existing.messages.length > 0) {
        void refreshSubagentStatus(key);
        return;
      }
      patchSession(set, key, { loading: true });
      // 并行取计划审批历史:失败静默降级为无历史计划,绝不阻塞会话加载。
      const plansPromise = ipc
        .listPlanReviews(engine, sessionId)
        .catch(() => null);
      try {
        const page = await loadHistoryPage(engine, sessionId, workspacePath, 100);
        markTranscriptRows(page.messages);
        markTranscriptRows(page.subagentHistory);
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
        armStatusRetry(key);
        // 历史页应用后再并入计划卡片(按 planId+revision 去重;活跃等待点
        // 可否恢复由后端状态保证,前端只按 record.status 渲染)。
        const plans = await plansPromise;
        if (plans && plans.length > 0) {
          set((s) => {
            const cur = s.bySession[key];
            if (!cur) return {};
            const messages = mergePlanReviewHistory(cur.messages, plans);
            if (!messages) return {};
            return {
              bySession: { ...s.bySession, [key]: { ...cur, messages } },
            };
          });
        }
      } catch (error) {
        patchSession(set, key, { loading: false, error: String(error) });
      }
    },

    reloadSession: async (session) => {
      const { engine, sessionId, workspacePath } = session;
      const key = sessionKey(engine, sessionId, workspacePath);
      const existing = get().bySession[key];
      if (get().streamingByKey[key] || existing?.streaming) {
        set({ actionError: i18n.t("chat.sessionRefreshRunning") });
        return;
      }
      if (existing?.loading || get().archivedSessionKeys[key]) return;
      // A status append replaces `messages`, which would make every `unchanged`
      // check below fail and drop this refresh without any feedback.
      cancelStatusRefresh(key);
      patchSession(set, key, { loading: true, error: null, historyReloadId: ++historyReloadId });
      set({ actionError: null });
      const snapshot = get().bySession[key];
      const plansPromise = ipc.listPlanReviews(engine, sessionId).catch(() => null);
      const unchanged = () => {
        const current = get().bySession[key];
        return current && current.historyReloadId === snapshot.historyReloadId && !get().archivedSessionKeys[key] &&
          !get().streamingByKey[key] && !current.streaming &&
          current.messages === snapshot.messages &&
          current.settledRunIds === snapshot.settledRunIds;
      };
      try {
        // Keep the already-visible history window, including more than one native page.
        let remaining = Math.max(100, snapshot.messages.length);
        let before: number | null = null;
        let subagentHistory = snapshot.subagentHistory;
        const pages = [];
        do {
          const page = await loadHistoryPage(engine, sessionId, workspacePath, Math.min(500, remaining), before, session, pages.length === 0);
          if (!unchanged()) return;
          markTranscriptRows(page.messages);
          markTranscriptRows(page.subagentHistory);
          pages.push(page.messages);
          remaining -= page.messages.length;
          before = page.nextBefore;
          subagentHistory = page.subagentHistory;
          if (page.messages.length === 0) break;
        } while (remaining > 0 && before !== null);
        let messages = pages.reverse().flat();
        const plans = await plansPromise;
        if (!unchanged()) return;
        const reviews = plans ?? snapshot.messages.flatMap((message) => message.planReview ? [message.planReview] : []);
        messages = mergePlanReviewHistory(messages, reviews) ?? messages;
        let usage: unknown = null;
        for (let index = messages.length - 1; index >= 0; index--) {
          if (messages[index].usage) {
            usage = messages[index].usage;
            break;
          }
        }
        patchSession(set, key, { messages, subagentHistory, nextBefore: before, usage, turnUsage: null, loading: false });
      } catch (error) {
        if (unchanged()) set({ actionError: i18n.t("chat.sessionRefreshFailed", { error: errorText(error) }) });
      } finally {
        // Deleted/archived entries must not be recreated by a late completion.
        if (get().bySession[key]?.historyReloadId === snapshot.historyReloadId) {
          patchSession(set, key, { loading: false, historyReloadId: undefined });
          // A failed reload keeps the previous window, which can still have
          // running agents just like a successfully refreshed window.
          armStatusRetry(key);
        }
      }
    },

    forkSession: async (engine, sessionId, workspacePath, anchor) => {
      const key = sessionKey(engine, sessionId, workspacePath);
      // 防重入：分叉是一次"点击即落盘"的 IPC，连点两次会让后端各建一个分支——
      // 各自分配标题编号，用户拿到两条看起来一样的会话。同一来源会话在飞期间，
      // 后续点击直接丢弃；入口据此置灰成"进行中"。
      //
      // 注意范围：`forkingByKey` 是**本窗口**的 store 状态，只挡同一个渲染进程里的
      // 重复点击。局域网网页客户端与桌面端同时分叉时驱动的是同一个进程，由后端把
      // 分叉逐个执行（`fork_session_blocking` 的进程内锁），编号不会撞。仍挡不住的
      // 只有同一个数据目录跑起两个进程（应用没有单实例锁）：编号是「读标题快照 →
      // 之后才写」两步，两个进程之间没有原子性，可能取到同一个 `#N`。
      if (get().forkingByKey[key]) return;
      set((s) => ({ forkingByKey: { ...s.forkingByKey, [key]: true } }));
      try {
        // 后端**点击即落盘**：算切点、写好继承过来的前缀转录本、登记 sessions
        // 行，一次搞定。所以这里拿到 plan 时分支已经是一个真实会话——不需要
        // 再发一条消息才"落地"（惰性落地会让分支窗口在点击后是空的）。
        // 分支标题由**后端**生成（`<来源标题> (fork #N)`）：编号要与已有标题查重，
        // 只有后端知道现有标题；后缀语言中立，所以不必经过 i18n。
        //
        // ⚠️ 这一步单独 try：**只有分叉本身失败**才说"创建分支失败"。下面插页签、
        // 读历史失败时分支其实已经建好了，再套那句话会让用户以为白点了一次。
        let plan;
        try {
          plan = await ipc.forkSession(engine, sessionId, anchor ?? null);
        } catch (error) {
          // 说明**是哪件事**失败了：只丢一句原始错误，用户不知道这是分叉出错
          // （可能是定位不到该轮、来源文件被外部改过等）。
          set({ actionError: i18n.t("chat.forkFailed", { reason: errorText(error) }) });
          return;
        }
        // 分支的 `sessions` 行是后端按**来源会话的工作区**写的，页签必须跟着它，
        // 否则来源是从搜索/插件等入口打开、调用方工作区与它不一致时，分支首轮
        // 会以别的 cwd 启动——而引擎按 cwd 解析转录本，`--resume` 可能找不到
        // 刚写好的分支文件。旧后端不返回该字段时回退到调用方工作区。
        const branchWorkspace = plan.workspacePath ?? workspacePath;
        // 降级要**说出来**：分支已经建好，但链路最后一步（继承原会话的模型 / 思考
        // 档位 / 供应商）有失败项时，分支首轮会用引擎默认值。后端只打日志，打包后
        // 的 GUI 没有控制台，不说用户就永远不知道——他只会觉得"分支怎么换了模型"。
        if (plan.degraded && plan.degraded.length > 0) {
          set({
            actionError: i18n.t("chat.forkDegraded", {
              items: plan.degraded.map((item) => i18n.t(`chat.forkDegradedItem.${item}`)).join("、"),
            }),
          });
        }
        set((s) => {
          const tab: ActiveSession = {
            engine: plan.sourceEngine,
            sessionId: plan.targetSessionId,
            workspacePath: branchWorkspace,
          };
          // 已经开过这个分支就不重复插入（重复点击）。
          const openTabs = s.openTabs.some((t) =>
            sameTab(t, tab.engine, tab.sessionId, branchWorkspace),
          )
            ? s.openTabs
            : [...s.openTabs, tab];
          persistTabs(openTabs, tab);
          return { openTabs, active: tab, activeEngine: tab.engine };
        });
        // 立刻把继承过来的历史读进时间线：分支页签要**马上**显示分叉点之前的
        // 对话，而不是等用户切走再切回来。会话激活广播由 selectSession 发出
        // （tabs.ts 的 activateTab 也走同一条路径），这里不再补发第二次。
        //
        // 这一步失败时分支已经建好、页签也已插入，所以**不**报"创建分支失败"：
        // 让 `selectSession` 自己的错误通道处理（它会把 error 挂到会话上、界面
        // 显示读取失败并给重试）。这里只留一条日志，便于区分"分叉没成功"和
        // "分叉成功但历史没读进来"。
        try {
          await get().selectSession(plan.sourceEngine, plan.targetSessionId, branchWorkspace);
        } catch (error) {
          console.error("[fork] 分支已创建，但读取历史失败", error);
        }
      } finally {
        // 失败也要清，否则入口会永远停在"进行中"。
        set((s) => {
          const forkingByKey = { ...s.forkingByKey };
          delete forkingByKey[key];
          return { forkingByKey };
        });
      }
    },

    loadEarlier: async (key) => {
      const { active, bySession, openTabs } = get();
      // 分屏里每格各自向上加载历史：不带 key 时仍按激活会话。
      const targetKey =
        key ??
        (active
          ? sessionKey(active.engine, active.sessionId, active.workspacePath)
          : "");
      if (!targetKey) return;
      const tab = openTabs.find(
        (t) => sessionKey(t.engine, t.sessionId, t.workspacePath) === targetKey,
      );
      if (!tab?.sessionId) return;
      const state = bySession[targetKey];
      if (!state?.nextBefore || state.loading) return;
      patchSession(set, targetKey, { loading: true });
      try {
        const page = await loadHistoryPage(
          tab.engine,
          tab.sessionId,
          tab.workspacePath,
          100,
          state.nextBefore,
        );
        markTranscriptRows(page.messages);
        markTranscriptRows(page.subagentHistory);
        patchSession(set, targetKey, {
          messages: [
            ...page.messages,
            ...(get().bySession[targetKey] ?? EMPTY_SESSION).messages,
          ],
          nextBefore: page.nextBefore,
          subagentHistory: page.subagentHistory,
          loading: false,
        });
      } catch {
        patchSession(set, targetKey, { loading: false });
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
          composerAttachments: withoutComposerAttachments(s.composerAttachments, [key]),
          unseen: omitKey(s.unseen, key),
          actionError: null,
        };
      });
      forgetClosedTab(key);
      const tab = get().openTabs.find(
        (item) => item.engine === engine && item.sessionId === sessionId,
      );
      if (tab) get().closeTab(engine, sessionId, tab.workspacePath);
      else clearScopedContributions(set, engine, sessionId, workspacePath);
    },

    deleteSession: async (engine, sessionId) => {
      // 远程(插件会话源,如 WSL 发行版内 CLI)会话没有本地 db 行,本地
      // delete_session 只会 "session not found";走远程通道删 remotePath。
      const meta = get().sessions.find(
        (x) => x.engine === engine && x.sessionId === sessionId,
      );
      try {
        if (meta?.remote && meta.remotePath) {
          await ipc.deleteRemoteSession(meta.workspacePath, engine, sessionId, meta.remotePath);
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
      // The session is gone: its remembered contributions go with it.
      clearScopedContributions(set, engine, sessionId, "");
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
          composerAttachments: withoutComposerAttachments(s.composerAttachments, [key]),
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
