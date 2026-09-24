import { ipc, type Message, type QuestionSpec, type SessionMeta } from "@/lib/ipc";
import type { EngineEventPayload } from "@/lib/events";
import { errorText } from "@/lib/errors";
import { dedupeTabs, persistTabs, sessionKey } from "./persistence";
import {
  EMPTY_SESSION,
  EMPTY_TASKS,
  appendToolMessages,
  applyStreamParts,
  bufferStreamPart,
  drainPending,
  migratePendingStream,
  moveRetryingFlag,
  moveStreamingFlag,
  patchSession,
  resolveSessionEffort,
  resolveSessionModel,
  rememberSettledRun,
  routeRun,
  runRouting,
  scheduleDeltaFlush,
  setRetryingFlag,
  setStreamingFlag,
  settleLiveRows,
  touchRun,
  untrackRun,
  updatePendingStreamModel,
  type ToolMessageInput,
  type BackgroundTask,
  type SessionState,
} from "./stream";
import type { ChatStore } from "../store";
import {
  ASK_OTHER_OPTION,
  askLoops,
  declaredMulti,
  openAskLoop,
  parseAskFrame,
  takeAskEditor,
  type AskLoop,
} from "./ask-loop";
import { mergeUsage, parseUsage, reportedContextWindow, type ParsedUsage } from "../usage";
import { usageTrackingEnabled } from "@/features/settings/usage-tracking";
import { migrateSelectedAgent } from "@/features/agents/selected-agent";

/**
 * Engine-event handling: the main loop resolves each event's session key and
 * dispatches to one handler per event kind. Store-agnostic apart from the
 * ChatStore type (type-only import, so no runtime cycle with store.ts);
 * everything the handlers need arrives through EngineEventDeps.
 */

export interface EngineEventDeps {
  set: (fn: (s: ChatStore) => Partial<ChatStore>) => void;
  get: () => ChatStore;
  /** After a turn ends, send the oldest queued message for that session. */
  drainQueue: (key: string) => void;
  /** Flag a finished background session for the sidebar's unseen dot. */
  markUnseenIfBackground: (key: string) => void;
  /** Insert/bump a freshly created session in the sidebar list cache. */
  upsertSessionMeta: (meta: SessionMeta) => void;
  /** Re-fetch the latest token usage from session history for the given session key. */
  refreshSessionUsage?: (key: string) => Promise<void>;
  /** Re-read the session's transcript and merge rows the live view missed
   *  (a foreign run's dropped completion turn) into the open session. */
  reloadTranscript?: (key: string) => void;
}

/** Collapse whitespace and cap a prompt for use as a session title. */
export function firstLineTitle(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 40);
}

/** List-cache entry for a session the backend scanner has not seen yet. */
export function optimisticMeta(
  engine: string,
  sessionId: string,
  workspacePath: string,
  title: string,
): SessionMeta {
  const now = Date.now();
  return {
    engine,
    sessionId,
    workspacePath,
    filePath: "",
    fileSize: 0,
    fileMtimeMs: 0,
    title,
    preview: "",
    createdAt: now,
    updatedAt: now,
    messageCount: 1,
    pinned: false,
    customTitle: null,
  };
}

/** Insert a freshly created session into the sidebar list cache (or bump its
 * timestamp when already present). Without this the row and the tab title
 * stayed missing/"新对话" until the post-turn rescan completed. */
export function upsertSessionMetaInto(
  set: (fn: (s: ChatStore) => Partial<ChatStore>) => void,
  meta: SessionMeta,
) {
  set((s) => {
    if (s.archivedSessionKeys[sessionKey(meta.engine, meta.sessionId, meta.workspacePath)]) {
      return {};
    }
    const idx = s.sessions.findIndex(
      (x) => x.engine === meta.engine && x.sessionId === meta.sessionId,
    );
    if (idx < 0) return { sessions: [meta, ...s.sessions] };
    const sessions = s.sessions.slice();
    sessions[idx] = { ...sessions[idx], updatedAt: meta.updatedAt };
    return { sessions };
  });
}

/** Effective model for event-stamped rows: the session's activeModel wins,
 * followed by the owning tab's per-tab override, then the session's own
 * history, then the engine default — the same resolveSessionModel the send
 * path uses, so a row can never claim a model the turn did not run. */
function stampedModel(
  deps: EngineEventDeps,
  engine: string,
  key: string,
): string | null {
  const s = deps.get();
  const tab = s.openTabs.find(
    (t) => sessionKey(t.engine, t.sessionId, t.workspacePath) === key,
  );
  return (
    resolveSessionModel(tab, s.bySession[key], s.models[engine]) || null
  );
}

/** Effective reasoning effort for event-stamped rows. Native-session state
 * wins; a tab override is only valid before that session receives its id. */
function stampedEffort(
  deps: EngineEventDeps,
  engine: string,
  key: string,
): string | null {
  const s = deps.get();
  const tab = s.openTabs.find(
    (t) => sessionKey(t.engine, t.sessionId, t.workspacePath) === key,
  );
  return resolveSessionEffort(tab, s.bySession[key], s.efforts[engine]) || null;
}

function onModel(
  event: EngineEventPayload,
  key: string,
  deps: EngineEventDeps,
) {
  const reported = typeof event.data === "string" ? event.data.trim() : "";
  if (!reported) return;
  // The engine reports the bare model name; our own record spells it
  // "provider/model" (see ipc.rememberSessionModel). Same model, more
  // context — keep the qualified one instead of dropping the provider.
  const current = deps.get().bySession[key]?.activeModel ?? "";
  const model =
    current === reported || current.endsWith(`/${reported}`) ? current : reported;
  updatePendingStreamModel(key, model);
  deps.set((s) => {
    const cur = s.bySession[key];
    if (!cur) return {};
    let messages = cur.messages;
    if (messages.some((m) => m.role === "assistant" && m.live)) {
      messages = messages.map((m) =>
        m.role === "assistant" && m.live ? { ...m, model } : m,
      );
    }
    return {
      bySession: {
        ...s.bySession,
        [key]: {
          ...cur,
          activeModel: model,
          messages,
        },
      },
    };
  });
}

function onEffort(
  event: EngineEventPayload,
  key: string,
  deps: EngineEventDeps,
) {
  const reported = typeof event.data === "string" ? event.data.trim() : "";
  if (!reported) return;
  deps.set((s) => {
    const cur = s.bySession[key];
    if (!cur || cur.activeEffort === reported) return {};
    return {
      bySession: {
        ...s.bySession,
        [key]: { ...cur, activeEffort: reported },
      },
    };
  });
}

/** Sessions whose run is inside a provider-retry backoff. Kept out of the
 *  store read path on purpose: the delta handlers test this set (O(1)) rather
 *  than reading `bySession` for every streamed token. */
const retryingKeys = new Set<string>();

function onDelta(
  event: EngineEventPayload,
  key: string,
  deps: EngineEventDeps,
) {
  // Content resumed: a re-issued request succeeded, so the retry chip goes.
  if (retryingKeys.has(key)) clearRetry(key, deps);
  bufferStreamPart(
    key,
    "delta",
    event.data as string,
    stampedModel(deps, event.engine, key),
    stampedEffort(deps, event.engine, key),
  );
  scheduleDeltaFlush(deps.set);
}

function onThinking(
  event: EngineEventPayload,
  key: string,
  deps: EngineEventDeps,
) {
  // Content resumed: a re-issued request succeeded, so the retry chip goes.
  if (retryingKeys.has(key)) clearRetry(key, deps);
  bufferStreamPart(
    key,
    "thinking",
    event.data as string,
    stampedModel(deps, event.engine, key),
    stampedEffort(deps, event.engine, key),
  );
  scheduleDeltaFlush(deps.set);
}

function onMessage(
  event: EngineEventPayload,
  key: string,
  deps: EngineEventDeps,
) {
  // Content resumed: a re-issued request succeeded, so the retry chip goes.
  if (retryingKeys.has(key)) clearRetry(key, deps);
  const data = event.data as {
    role: string;
    text: string;
  };
  if (data.role !== "assistant") return;
  // Full-snapshot assistant lines (kimi/codex non-delta) append as settled
  // messages; any live row above is finished growing.
  deps.set((s) => {
    const prev = s.bySession[key] ?? EMPTY_SESSION;
    const settled = settleLiveRows(prev.messages);
    const seq = settled.length ? settled[settled.length - 1].seq + 1 : 1;
    const durationMs = prev.turnStartedAt
      ? Math.max(0, Date.now() - prev.turnStartedAt)
      : null;
    return {
      bySession: {
        ...s.bySession,
        [key]: {
          ...prev,
          messages: [
            ...settled,
            {
              role: "assistant",
              text: data.text,
              ts: new Date().toISOString(),
              model: stampedModel(deps, event.engine, key),
              effort: stampedEffort(deps, event.engine, key),
              durationMs,
              seq,
            },
          ],
        },
      },
    };
  });
}

/** Model a local send resolved for a session key, held until the run reports
 *  the native session id (`session` event) so the two can be remembered
 *  together — the engine transcript only carries the bare model name, and the
 *  new session's id is not known before that event. Only local sends fill
 *  this: an observer must never write its own (bare) reading of a run. */
const pendingSessionModels = new Map<string, string>();
/** Same hand-off for the reasoning level: it is chosen before the first send
 *  of a new session and can only be filed under the id the `session` event
 *  carries. */
const pendingSessionEfforts = new Map<string, string>();
/** Same hand-off for the in-app channel: spawn injects env from this id, and
 *  a brand-new session only learns its native id from the `session` event. */
const pendingSessionProviders = new Map<string, string>();

export function rememberModelForRun(
  key: string,
  model: string | null | undefined,
) {
  if (model) pendingSessionModels.set(key, model);
}

export function rememberEffortForRun(
  key: string,
  effort: string | null | undefined,
) {
  if (effort) pendingSessionEfforts.set(key, effort);
}

export function rememberProviderForRun(
  key: string,
  provider: string | null | undefined,
) {
  if (provider) pendingSessionProviders.set(key, provider);
}

function onSession(
  event: EngineEventPayload,
  key: string,
  deps: EngineEventDeps,
) {
  const nativeId = event.data as string;
  // Resolve the workspace from the tab that owns this key — not from the
  // active tab. A first message sent on a background tab must not adopt the
  // foreground tab's workspace (the session would be orphaned there).
  const state = deps.get();
  const owner = state.openTabs.find(
    (t) => sessionKey(t.engine, t.sessionId, t.workspacePath) === key,
  );
  const pendingCandidates = state.openTabs.filter(
    (t) =>
      t.engine === event.engine &&
      t.sessionId === null &&
      state.bySession[sessionKey(t.engine, null, t.workspacePath)] !==
        undefined,
  );
  // With several pending tabs of one engine, guessing would pin the session
  // onto an unrelated tab's workspace. Adopt only a unique candidate;
  // otherwise fall back to the active tab's workspace.
  const tab =
    owner ?? (pendingCandidates.length === 1 ? pendingCandidates[0] : undefined);
  const workspacePath =
    tab?.workspacePath ?? deps.get().active?.workspacePath ?? "";
  const newKey = sessionKey(event.engine, nativeId, workspacePath);
  // The event can resolve straight to the native key when it beat the send
  // response (the run had no routing entry yet). The turn rows and streaming
  // flag still sit under the pending key then; migrate from there instead of
  // orphaning them on a key nothing renders.
  const pendingKey = sessionKey(event.engine, null, workspacePath);
  const fromKey =
    pendingKey !== newKey && deps.get().bySession[pendingKey]
      ? pendingKey
      : key;

  const sentModel =
    pendingSessionModels.get(fromKey) ?? pendingSessionModels.get(key);
  if (sentModel) {
    pendingSessionModels.delete(fromKey);
    pendingSessionModels.delete(key);
    void ipc
      .rememberSessionModel?.(event.engine, nativeId, sentModel)
      ?.catch(() => {});
  }
  const sentEffort =
    pendingSessionEfforts.get(fromKey) ?? pendingSessionEfforts.get(key);
  if (sentEffort) {
    pendingSessionEfforts.delete(fromKey);
    pendingSessionEfforts.delete(key);
    void ipc
      .rememberSessionEffort?.(event.engine, nativeId, sentEffort)
      ?.catch(() => {});
  }
  const sentProvider =
    pendingSessionProviders.get(fromKey) ?? pendingSessionProviders.get(key);
  if (sentProvider) {
    pendingSessionProviders.delete(fromKey);
    pendingSessionProviders.delete(key);
    void ipc
      .rememberSessionProvider?.(event.engine, nativeId, sentProvider)
      ?.catch(() => {});
  }

  settleOrphanedRuns(deps.set, routeRun(event.runId, newKey));
  // Unflushed stream chunks sit under the pre-migration key; move them too.
  migratePendingStream(fromKey, newKey);
  // Migrate pending key -> native key.
  deps.set((s) => {
    const prev = s.bySession[fromKey];
    if (!prev) return {};
    const cur = s.bySession[newKey];
    const messages =
      cur && cur !== prev && cur.messages.length > 0
        ? [...prev.messages, ...cur.messages]
        : prev.messages;
    // prev (the sender's live turn under the pending key) owns the scalar
    // fields: queue, turnStartedAt, streaming and the active model/effort/
    // provider stamps. cur is a placeholder built from EMPTY_SESSION by
    // events that beat this session event to the native key — spreading it
    // last would silently drop a queue the user filled mid-flight. cur keeps
    // only what arrived under the native key: usage tails and settle records.
    const bySession = {
      ...s.bySession,
      [newKey]: {
        ...cur,
        ...prev,
        messages,
        usage: cur?.usage ?? prev.usage,
        turnUsage: cur?.turnUsage ?? prev.turnUsage,
        settledRunIds: [
          ...new Set([
            ...(prev.settledRunIds ?? []),
            ...(cur && cur !== prev ? (cur.settledRunIds ?? []) : []),
          ]),
        ],
      },
    };
    if (fromKey !== newKey) delete bySession[fromKey];
    const drafts = { ...s.drafts };
    if (fromKey in drafts) {
      drafts[newKey] = drafts[fromKey];
      delete drafts[fromKey];
    }
    const streamingByKey = moveStreamingFlag(s.streamingByKey, fromKey, newKey);
    const retryingByKey = moveRetryingFlag(s.retryingByKey, fromKey, newKey);
    const activeNext =
      s.active &&
      s.active.engine === event.engine &&
      s.active.sessionId === null &&
      s.active.workspacePath === workspacePath
        ? { ...s.active, sessionId: nativeId, effort: undefined, provider: undefined }
        : s.active;
    return { bySession, drafts, streamingByKey, retryingByKey, active: activeNext };
  });
  // The pending tab owning this run adopts the native id. Stamp only the
  // first match: blanketing every pending tab of this engine+workspace
  // would turn a second "new chat" tab into a duplicate of this session
  // (identical React keys break the tab strip). Match by the resolved
  // workspace, so a background tab updates itself, not the foreground tab.
  deps.set((s) => {
    let stamped = false;
    const openTabs = dedupeTabs(
      s.openTabs.map((t) => {
        if (
          stamped ||
          t.engine !== event.engine ||
          t.sessionId !== null ||
          t.workspacePath !== workspacePath
        ) {
          return t;
        }
        stamped = true;
        return { ...t, sessionId: nativeId, effort: undefined, provider: undefined };
      }),
    );
    persistTabs(openTabs, s.active);
    return { openTabs };
  });
  // The pinned agent followed the draft key; move it onto the native id so
  // the next send in this tab injects it again.
  migrateSelectedAgent(workspacePath, nativeId);
  // Sidebar row + tab title pick the new session up immediately instead of
  // waiting for the post-turn rescan.
  const firstUser = (deps.get().bySession[newKey]?.messages ?? []).find(
    (m) => m.role === "user",
  );
  deps.upsertSessionMeta(
    optimisticMeta(
      event.engine,
      nativeId,
      workspacePath,
      firstUser ? firstLineTitle(firstUser.text) : "",
    ),
  );
}

/** Background tasks are panel state, not turn content: bounded per session,
 *  running tasks always kept. */
const TASK_LIMIT = 32;

/** The run that owns this session's live turn, or `null` for an unclaimed
 *  session. Two runs of ONE session can overlap: the reply settles with
 *  background tasks still running and the user sends the next message before
 *  the CLI's completion turn arrives (see `currentRunId`).
 *
 *  A claim is only good while its run still routes to *this* session: a run
 *  that already settled, was reaped by the orphan sweep, was renamed by the
 *  backend, or left its routing behind on a migrated key can never settle this
 *  turn again. Such a stale claim reads as no claim, so the run that is
 *  actually talking (and its terminal event) still owns the turn. */
function turnOwner(cur: SessionState | undefined, key: string): string | null {
  const runId = cur?.currentRunId ?? null;
  if (!runId) return null;
  return runRouting.get(runId) === key ? runId : null;
}

/** Whether an event's run may write this session's turn-level state (streaming,
 *  turnStartedAt, live rows, queue, interrupted). Any run may while the session
 *  is unclaimed; otherwise only the claimed one. */
function ownsTurn(cur: SessionState | undefined, key: string, runId: string): boolean {
  const owner = turnOwner(cur, key);
  return owner === null || owner === runId;
}

/** Kinds that carry the CONTENT of a turn. Their run has to own the session:
 *  frames of a run that does not would otherwise stream into the live row of
 *  the run that does.
 *
 *  Degraded same-session-dual-run rule: while a session streams run B, the
 *  still-routed run A of the same session can keep talking (its own completion
 *  turn after A's background phase). A's text is dropped instead of merged;
 *  when A reaches its terminal done/error the session's transcript is re-read
 *  and the missing rows are merged into the open session (reloadTranscript —
 *  rescanSessions only refreshes the sidebar list). Task frames and
 *  done/error/session keep routing: they belong to their own run's surface
 *  (panel, task settle, run wrap-up). */
const FOREIGN_CONTENT_KINDS = new Set<EngineEventPayload["kind"]>([
  "delta",
  "thinking",
  "message",
  "usage",
  "model",
  "retry",
  "warn",
  "compaction",
]);

function isForeignContent(
  cur: SessionState | undefined,
  key: string,
  runId: string,
): boolean {
  if (!cur?.streaming) return false;
  const owner = turnOwner(cur, key);
  return owner !== null && owner !== runId;
}
/** Runs whose content frames were dropped by the foreign-content gate: their
 *  completion-turn text never streamed, so their terminal done/error triggers
 *  a targeted transcript merge (EngineEventDeps.reloadTranscript) that brings
 *  the missing rows into the open session. Entries are dropped when the run
 *  settles or is reaped, so the set tracks only live runs. Exported like
 *  settledRuns so tests can reset it. */
export const droppedContentRuns = new Set<string>();

/** Re-derive the fields the task list owns from the list itself, then trim it
 *  back to TASK_LIMIT: a running task must never be dropped by retention, so
 *  the settled ones are the ones that go. */
function withTaskDerived(cur: SessionState): SessionState {
  // Turn-level flag, so ambient (session-scoped) tasks never drive it: they
  // outlive every turn and would pin the tail indicator on "后台任务运行中"
  // forever. The panel still lists them (the list itself is not filtered).
  const backgroundActive = cur.tasks.some((t) => t.status === "running" && !t.ambient);
  let tasks = cur.tasks;
  if (tasks.length > TASK_LIMIT) {
    const running = tasks.filter((t) => t.status === "running");
    // A zero budget has to drop the settled rows outright: `slice(-0)` is
    // `slice(0)`, which would keep the whole tail instead.
    const budget = Math.max(0, TASK_LIMIT - running.length);
    const settled = budget > 0 ? tasks.filter((t) => t.status !== "running").slice(-budget) : [];
    tasks = [...settled, ...running].sort((a, b) => a.startedAt - b.startedAt);
  }
  return { ...cur, tasks, backgroundActive };
}

/** Settle the tasks a dead or errored run left running. */
export function settleRunTasks(
  tasks: BackgroundTask[],
  runId: string,
  status: "interrupted" | "stopped",
): BackgroundTask[] {
  const now = Date.now();
  return tasks.map((t) => (t.runId === runId && t.status === "running" ? { ...t, status, updatedAt: now } : t));
}

/** Fold one claude task frame into the session's task list. Every frame is an
 *  upsert by taskId: the CLI may report a task this client never saw start
 *  (an observer joining mid-run), and a re-reported start has to refresh the
 *  same row instead of duplicating it. */
function applyTaskEvent(event: EngineEventPayload, key: string, deps: EngineEventDeps) {
  const data = (event.data ?? {}) as Record<string, unknown>;
  // A task frame without an id is malformed: String(undefined) would create
  // a row literally keyed "undefined".
  if (event.kind !== "tasks" && data.taskId == null) return;
  deps.set((s) => {
    const cur = s.bySession[key] ?? EMPTY_SESSION;
    let tasks = cur.tasks;
    const now = Date.now();
    const upsert = (id: string, patch: Partial<BackgroundTask>, base?: Partial<BackgroundTask>) => {
      const idx = tasks.findIndex((t) => t.id === id);
      if (idx >= 0) {
        // A row belongs to the run that reported the task. Another run of the
        // same session must not rewrite it: the CLI's resume-time
        // reconciliation cannot see a still-live older process's tasks, so a
        // new run reports them as stopped ("didn't finish before the previous
        // session ended") — a false terminal for work that is still running.
        // The owning run's own frames (progress, its real notification, and
        // the reader's closing empty `tasks` frame) keep full control.
        if (tasks[idx].runId !== event.runId) {
          // Ambient rows are the exception: they are session-scoped
          // housekeeping, so whichever run is alive reports them in its
          // authoritative `tasks` frame. Let that frame adopt the row from a
          // run that already settled — otherwise the dead run's settle marks
          // it interrupted and the ownership guard keeps it that way forever
          // while the task is in fact still running.
          if (
            event.kind !== "tasks" ||
            !(tasks[idx].ambient === true || patch.ambient === true)
          ) {
            return;
          }
          tasks = tasks.map((t, i) =>
            i === idx
              ? { ...t, ...patch, runId: event.runId, status: "running" as const, updatedAt: now }
              : t,
          );
          return;
        }
        tasks = tasks.map((t, i) => (i === idx ? { ...t, ...patch, updatedAt: now } : t));
      } else {
        tasks = [
          ...tasks,
          {
            id, runId: event.runId, taskType: "other", description: "",
            status: "running", startedAt: now, updatedAt: now, ...base, ...patch,
          } as BackgroundTask,
        ];
      }
    };
    switch (event.kind) {
      case "task_started":
        upsert(String(data.taskId), {
          taskType: String(data.taskType ?? "other"),
          description: String(data.description ?? ""),
          ...(typeof data.subagentType === "string" ? { subagentType: data.subagentType } : {}),
          ...(typeof data.workflowName === "string" ? { workflowName: data.workflowName } : {}),
          ...(typeof data.isBackgrounded === "boolean" ? { isBackgrounded: data.isBackgrounded } : {}),
          ...(typeof data.spawnDepth === "number" ? { spawnDepth: data.spawnDepth } : {}),
          status: "running",
        });
        break;
      case "task_progress":
        upsert(String(data.taskId), {
          ...(typeof data.description === "string" ? { progress: data.description } : {}),
          ...(typeof data.lastTool === "string" ? { lastTool: data.lastTool } : {}),
          ...(data.usage != null ? { usage: data.usage } : {}),
        });
        break;
      case "task_notification": {
        const raw = String(data.status ?? "stopped");
        const status = raw === "completed" || raw === "failed" || raw === "stopped" ? raw : "stopped";
        upsert(String(data.taskId), { status });
        break;
      }
      case "tasks": {
        // Entries without a task id are malformed; skip them rather than
        // keying a row "undefined".
        const listed = ((data.tasks as Record<string, unknown>[] | undefined) ?? []).filter(
          (t) => t.taskId != null,
        );
        const live = new Set(listed.map((t) => String(t.taskId)));
        // REPLACE semantics: the payload is the authoritative live set, so a
        // running task missing from it is gone without a terminal notification.
        tasks = tasks.map((t) =>
          t.status === "running" && t.runId === event.runId && !live.has(t.id)
            ? { ...t, status: "stopped" as const, updatedAt: now }
            : t,
        );
        for (const t of listed) {
          upsert(String(t.taskId), {
            taskType: String(t.taskType ?? "other"),
            description: String(t.description ?? ""),
            ...(typeof t.ambient === "boolean" ? { ambient: t.ambient } : {}),
          }, { status: "running" });
        }
        break;
      }
    }
    // Fallback convergence: a process that dies in its background phase now
    // always gets a terminal done from the Rust exit tail (which clears
    // awaitingTasks), and that done is staged behind the closing REPLACE.
    // If the done is ever lost, the wait still converges here: once the
    // run has no non-ambient running rows left, nothing remains to wait
    // for. (Ambient rows outlive turns; they never keep a turn waiting.)
    const clearsWait =
      event.kind === "tasks" &&
      cur.awaitingTasks &&
      !cur.streaming &&
      !tasks.some(
        (t) => t.runId === event.runId && t.status === "running" && !t.ambient,
      );
    return {
      bySession: {
        ...s.bySession,
        [key]: withTaskDerived({
          ...cur,
          tasks,
          ...(clearsWait ? { awaitingTasks: false } : {}),
        }),
      },
    };
  });
}

/** Runs whose turn already wrote ledger rows report by report. Every report
 *  is one model response, so each lands in the ledger the moment it arrives —
 *  a codex turn that chats for an hour has to show up while it runs, not when
 *  it ends — and `done` must not write the same tokens again. */
const liveLedgerRuns = new Set<string>();

/** Running token totals for the reply in flight, keyed by run. `usage` keeps
 *  the newest report (the context meter needs occupancy, not a sum), while
 *  the tail indicator and the settled row show this total: what the reply has
 *  spent so far. Claude reports nothing until the end, so it never appears. */
const turnUsageTotals = new Map<string, ParsedUsage>();
/** Drop a run's usage bookkeeping (settled, interrupted, or swept). */
export function dropRunUsage(runId: string) {
  turnUsageTotals.delete(runId);
  liveLedgerRuns.delete(runId);
}

/** Drop every trace of runs the orphan sweep reaped: their usage maps here
 * and the session's stuck streaming state in the store — a dead run's
 * done/error never arrives to clear them. */
export function settleOrphanedRuns(
  set: (fn: (s: ChatStore) => Partial<ChatStore>) => void,
  orphaned: Array<[string, string]>,
) {
  if (orphaned.length === 0) return;
  for (const [runId] of orphaned) {
    dropRunUsage(runId);
    droppedContentRuns.delete(runId);
  }
  set((s) => {
    let streamingByKey = s.streamingByKey;
    let retryingByKey = s.retryingByKey;
    let bySession = s.bySession;
    for (const [runId, key] of orphaned) {
      const cur = bySession[key];
      // The turn's streaming state belongs to its owner. With dual-run (a
      // backgrounded run overlapping the next turn), reaping a run that does
      // not own the turn must not flip the session to not-streaming under the
      // owner's feet: that unlocks the composer mid-turn, and a send in that
      // window spawns a third concurrent run.
      const foreignOwned = cur != null && cur.currentRunId != null && cur.currentRunId !== runId;
      if (!foreignOwned) {
        streamingByKey = setStreamingFlag(streamingByKey, key, false);
        retryingByKey = setRetryingFlag(retryingByKey, key, false);
        retryingKeys.delete(key);
      }
      if (!cur) continue;
      // A reaped run can leave tasks running with the turn already settled
      // (background work outlives its spawner's reply), so the task settle
      // decides on its own whether this session needs a write.
      const unsettled = cur.tasks.some((t) => t.runId === runId && t.status === "running");
      if (!cur.streaming && !cur.retry && !unsettled && !cur.awaitingTasks) continue;
      if (bySession === s.bySession) bySession = { ...s.bySession };
      bySession[key] = withTaskDerived({
        ...cur,
        // The owner's streaming state survives; the reaped run's own
        // leftovers (its task rows, the background wait) still settle.
        ...(foreignOwned ? {} : { streaming: false, turnStartedAt: null, retry: null }),
        // A reaped run can never settle this turn again: drop its claim so the
        // next run's own terminal event is not read as a foreign one.
        ...(cur.currentRunId === runId ? { currentRunId: null } : {}),
        compaction: null,
        // The reaped run's completion turn is never coming.
        awaitingTasks: false,
        ...(unsettled ? { tasks: settleRunTasks(cur.tasks, runId, "interrupted") } : {}),
      });
    }
    return { bySession, streamingByKey, retryingByKey };
  });
}

function onUsage(
  event: EngineEventPayload,
  key: string,
  deps: EngineEventDeps,
) {
  const parsed = parseUsage(event.data);
  const totals = parsed ? addTurnUsage(event.runId, parsed) : null;
  // A compaction report carries only the new occupancy, so the window is
  // taken from the last snapshot that had one: the gauge must not drop to
  // the assumed 200k just because this report is narrower (see mergeUsage).
  const prev = deps.get().bySession[key]?.usage;
  patchSession(deps.set, key, {
    usage: mergeUsage(event.data, prev),
    ...(totals ? { turnUsage: usageSnapshot(totals) } : {}),
  });
  if (parsed) recordUsageReport(deps, event, key, parsed);
}

/** Fold one report into its run's running total. */
function addTurnUsage(runId: string, parsed: ParsedUsage): ParsedUsage {
  const prev = turnUsageTotals.get(runId);
  const totals: ParsedUsage = {
    input: (prev?.input ?? 0) + parsed.input,
    output: (prev?.output ?? 0) + parsed.output,
    cacheRead: (prev?.cacheRead ?? 0) + parsed.cacheRead,
    cacheWrite: (prev?.cacheWrite ?? 0) + parsed.cacheWrite,
    total: 0,
    // A later report may omit the window; the last one that reported it wins.
    contextWindow: parsed.contextWindow ?? prev?.contextWindow,
  };
  totals.total = totals.input + totals.output + totals.cacheRead + totals.cacheWrite;
  turnUsageTotals.set(runId, totals);
  return totals;
}

/** Engine-shaped snapshot of a running total: parseUsage reads it back, and
 *  every consumer downstream (strip, row, breakdown) stays engine-agnostic. */
function usageSnapshot(totals: ParsedUsage): Record<string, number> {
  return {
    input_tokens: totals.input,
    output_tokens: totals.output,
    cache_read_input_tokens: totals.cacheRead,
    cache_creation_input_tokens: totals.cacheWrite,
    ...(totals.contextWindow ? { model_context_window: totals.contextWindow } : {}),
  };
}

/** Ledger one engine report (one request) as it arrives. */
function recordUsageReport(
  deps: EngineEventDeps,
  event: EngineEventPayload,
  key: string,
  parsed: ParsedUsage,
) {
  if (!usageTrackingEnabled()) return;
  liveLedgerRuns.add(event.runId);
  writeUsageRow(deps, event, key, parsed, 1);
}

/** Shared writer: one ledger row for the run's model and session. */
function writeUsageRow(
  deps: EngineEventDeps,
  event: EngineEventPayload,
  key: string,
  parsed: ParsedUsage,
  reports: number,
) {
  const state = deps.get();
  const tab = state.openTabs.find(
    (t) => sessionKey(t.engine, t.sessionId, t.workspacePath) === key,
  );
  void ipc
    .usageRecord({
      ts: Date.now(),
      engine: event.engine,
      model: stampedModel(deps, event.engine, key),
      sessionId: event.sessionId ?? tab?.sessionId ?? null,
      workspacePath: tab?.workspacePath ?? state.active?.workspacePath ?? null,
      input: parsed.input,
      output: parsed.output,
      cacheRead: parsed.cacheRead,
      cacheWrite: parsed.cacheWrite,
      reports,
      durationMs: null,
    })
    .catch(() => {});
}

function onError(
  event: EngineEventPayload,
  key: string,
  deps: EngineEventDeps,
) {
  // An error is terminal for its run regardless of turn ownership: a run
  // whose content frames were dropped as foreign (dual-run) gets the rows
  // the open session missed merged back from its transcript.
  if (droppedContentRuns.delete(event.runId)) deps.reloadTranscript?.(key);
  const prev = deps.get().bySession[key] ?? EMPTY_SESSION;
  const ownTurn = ownsTurn(prev, key, event.runId);
  if (ownTurn) {
    // Retry, ask-loop and compaction state belong to the turn owner. A late
    // error from an overlapping run must not clear the current run's UI state.
    clearRetry(key, deps);
    // A round cannot outlive its owning turn; a different overlapping run
    // must not cancel the live run's question loop.
    askLoops.delete(key);
    if (prev.compaction) patchSession(deps.set, key, { compaction: null });
  }
  if (!ownTurn) {
    // 同会话双 run：另一个 run 的错误不结束会话当前的回合，也不得把它的
    // 错误横幅、live 行、队列结算拖到正在流的新 run 上。只收尾它自己的任务。
    deps.set((s) => {
      const cur = s.bySession[key];
      if (!cur) return {};
      return {
        bySession: {
          ...s.bySession,
          [key]: withTaskDerived({
            ...cur,
            settledRunIds: rememberSettledRun(cur, event.runId),
            tasks: settleRunTasks(cur.tasks ?? EMPTY_TASKS, event.runId, "interrupted"),
          }),
        },
      };
    });
    runRouting.delete(event.runId);
    untrackRun(event.runId);
    dropRunUsage(event.runId);
    ipc.rescanSessions().catch(() => {});
    return;
  }
  // Fold unflushed chunks into rows and settle them: the turn stops here,
  // and the scheduled flush must not write them in after the fact.
  const pending = drainPending(key);
  deps.set((s) => {
    const cur = s.bySession[key] ?? EMPTY_SESSION;
    let messages = settleLiveRows(
      pending
        ? applyStreamParts(
            cur.messages,
            pending.parts,
            pending.model ?? (deps.get().models[event.engine] || null),
            pending.effort ?? stampedEffort(deps, event.engine, key),
          )
        : cur.messages,
    );
    const durationMs = cur.turnStartedAt
      ? Math.max(0, Date.now() - cur.turnStartedAt)
      : null;
    if (durationMs != null) {
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "assistant") {
          messages = [
            ...messages.slice(0, i),
            { ...messages[i], durationMs },
            ...messages.slice(i + 1),
          ];
          break;
        }
      }
    }
    return {
      bySession: {
        ...s.bySession,
        [key]: withTaskDerived({
          ...cur,
          messages,
          error: event.data as string,
          streaming: false,
          turnStartedAt: null,
          currentRunId: null,
          turnUsage: null,
          // A dead run can never produce the completion turn that would clear
          // this: the background phase ends here.
          awaitingTasks: false,
          settledRunIds: rememberSettledRun(cur, event.runId),
          // The run is dead: nothing will ever notify these tasks.
          tasks: settleRunTasks(cur.tasks ?? EMPTY_TASKS, event.runId, "interrupted"),
        }),
      },
      streamingByKey: setStreamingFlag(s.streamingByKey, key, false),
      retryingByKey: setRetryingFlag(s.retryingByKey, key, false),
    };
  });
  // The run is over: drop its routing entry and usage bookkeeping so the
  // maps cannot grow forever.
  runRouting.delete(event.runId);
  untrackRun(event.runId);
  dropRunUsage(event.runId);
  // Failed turns can still create a transcript; index it just as onDone does.
  ipc.rescanSessions().catch(() => {});
  deps.markUnseenIfBackground(key);
  void deps.refreshSessionUsage?.(key).catch(() => {});
  // An error settles the turn exactly like done does — the messages typed
  // behind it are the user's next step, and parking them here left the queue
  // stuck until it was sent or cleared by hand. A stop is still the user's
  // own call: that queue stays parked.
  if (!prev.interrupted) deps.drainQueue(key);
}

/** Patch the grant state of one card row, located by its message seq. */
export function patchGrantBySeq(
  set: (fn: (s: ChatStore) => Partial<ChatStore>) => void,
  key: string,
  seq: number,
  patch: (grant: NonNullable<Message["grant"]>) => NonNullable<Message["grant"]>,
) {
  set((s) => {
    const cur = s.bySession[key];
    if (!cur) return {};
    let changed = false;
    const messages = cur.messages.map((m) => {
      if (m.seq !== seq || m.role !== "grant" || !m.grant) return m;
      changed = true;
      return { ...m, grant: patch(m.grant) };
    });
    if (!changed) return {};
    return { bySession: { ...s.bySession, [key]: { ...cur, messages } } };
  });
}

/** Patch a question card by its control-protocol request id (the settled
 * event carries the request id, not the row seq). */
export function patchQuestionByRequestId(
  set: (fn: (s: ChatStore) => Partial<ChatStore>) => void,
  key: string,
  requestId: string,
  patch: (question: NonNullable<Message["question"]>) => NonNullable<Message["question"]>,
) {
  set((s) => {
    const cur = s.bySession[key];
    if (!cur) return {};
    let changed = false;
    const messages = cur.messages.map((m) => {
      if (m.role !== "question" || m.question?.requestId !== requestId) return m;
      changed = true;
      return { ...m, question: patch(m.question) };
    });
    if (!changed) return {};
    return { bySession: { ...s.bySession, [key]: { ...cur, messages } } };
  });
}

/** Patch a question card by its row seq: a multi-select round keeps one card
 * across the fresh request ids the CLI re-asks it with. */
export function patchQuestionBySeq(
  set: (fn: (s: ChatStore) => Partial<ChatStore>) => void,
  key: string,
  seq: number,
  patch: (question: NonNullable<Message["question"]>) => NonNullable<Message["question"]>,
) {
  set((s) => {
    const cur = s.bySession[key];
    if (!cur) return {};
    let changed = false;
    const messages = cur.messages.map((m) => {
      if (m.seq !== seq || m.role !== "question" || !m.question) return m;
      changed = true;
      return { ...m, question: patch(m.question) };
    });
    if (!changed) return {};
    return { bySession: { ...s.bySession, [key]: { ...cur, messages } } };
  });
}

/** A permission denial arrives mid-turn (tool_result) and again in the
 * final result's permission_denials; one card per denied path. The card is
 * the actionable surface: grant → next launch gets --add-dir. */
function onPermissionDenied(
  event: EngineEventPayload,
  key: string,
  deps: EngineEventDeps,
) {
  const data = event.data as {
    tool?: string | null;
    path?: string | null;
    message?: string;
  };
  const path = data.path?.trim() || null;
  const message = (data.message ?? "").trim();
  // Fold unflushed chunks first so the card lands after the streamed text.
  const pending = drainPending(key);
  let rowSeq = -1;
  deps.set((s) => {
    const cur = s.bySession[key] ?? EMPTY_SESSION;
    const base = pending
      ? applyStreamParts(
          cur.messages,
          pending.parts,
          pending.model ?? (deps.get().models[event.engine] || null),
        )
      : cur.messages;
    const messages = settleLiveRows(base);
    const dup = messages.some(
      (m) =>
        m.role === "grant" &&
        (path ? m.path === path : m.text === message) &&
        m.grant?.status !== "declined",
    );
    if (dup) return {};
    const seq = messages.length ? messages[messages.length - 1].seq + 1 : 1;
    rowSeq = seq;
    return {
      bySession: {
        ...s.bySession,
        [key]: {
          ...cur,
          messages: [
            ...messages,
            {
              role: "grant",
              text: message,
              path,
              ts: new Date().toISOString(),
              seq,
              grant: { status: "pending" as const },
            },
          ],
        },
      },
    };
  });
  // Preview the directory a grant would cover; failure is non-fatal — the
  // backend re-resolves inside grant_root.
  if (path && rowSeq > 0) {
    void ipc
      .grantScope(path)
      .then((dir) =>
        patchGrantBySeq(deps.set, key, rowSeq, (grant) => ({ ...grant, dir })),
      )
      .catch(() => {});
  }
}

/** End a multi-select round through the CLI's free-form row: the only answer
 * that both stops the re-ask loop and reaches the formatted result. */
function sendAskTerminator(loop: AskLoop, key: string, deps: EngineEventDeps) {
  void ipc
    .answerQuestion(loop.runId, loop.requestId, { [loop.base]: ASK_OTHER_OPTION })
    .catch((error) => patchSession(deps.set, key, { error: errorText(error) }));
}

function onQuestion(
  event: EngineEventPayload,
  key: string,
  deps: EngineEventDeps,
) {
  const data = event.data as {
    requestId?: string;
    toolUseId?: string | null;
    input?: { questions?: QuestionSpec[]; extui?: { method?: string } };
  };
  const requestId = data.requestId?.trim();
  const questions = data.input?.questions;
  if (!requestId || !Array.isArray(questions) || questions.length === 0) return;
  const method = data.input?.extui?.method;
  // The CLI's free-form editor, opened by a multi-select submit: the picked
  // labels travel as its text, so it must not surface as another card.
  const editing = method === "editor" || method === "input" ? takeAskEditor(key) : undefined;
  if (editing) {
    void ipc
      .answerQuestion(editing.runId, requestId, { [editing.base]: editing.text })
      .catch((error) => patchSession(deps.set, key, { error: errorText(error) }));
    return;
  }
  const spec = questions[0];
  if (!spec) return;
  const frame = parseAskFrame(spec.question, spec.options ?? []);
  // An rpc select frame carries no checkbox state: its question is multi-select
  // when the ask tool declared it so, or once the CLI reports a selection.
  const rpc = method === "select";
  // The CLI re-asks a multi-select question with a fresh request id after every
  // answer, so those frames resume the card the round already owns.
  const loop = askLoops.get(key);
  if (loop && loop.base === frame.base) {
    if (loop.phase === "sent") {
      // It re-asked because the editor answer was lost: re-arm and re-send.
      loop.requestId = requestId;
      sendAskTerminator(loop, key, deps);
      return;
    }
    patchQuestionBySeq(deps.set, key, loop.seq, (question) => ({
      ...question,
      requestId,
      // Same shape as a fresh card: the CLI's runtime rows are not options.
      questions: rpc && questions.length === 1
        ? [{ ...spec, multiSelect: true, options: frame.options }]
        : questions,
      ...(question.status === "pending" ? {} : { status: "pending" as const }),
    }));
    return;
  }
  const multi = rpc
    ? frame.selectedCount !== null ||
      declaredMulti(deps.get().bySession[key]?.messages ?? [], frame)
    : spec.multiSelect === true;
  // Fold unflushed chunks first so the card lands after the streamed text.
  const pending = drainPending(key);
  let rowSeq = -1;
  deps.set((s) => {
    const cur = s.bySession[key] ?? EMPTY_SESSION;
    const base = pending
      ? applyStreamParts(
          cur.messages,
          pending.parts,
          pending.model ?? (deps.get().models[event.engine] || null),
        )
      : cur.messages;
    const messages = settleLiveRows(base);
    // A replayed frame (initialize re-arm) must not double-render the card.
    const dup = messages.some(
      (m) => m.role === "question" && m.question?.requestId === requestId,
    );
    if (dup) return {};
    const seq = messages.length ? messages[messages.length - 1].seq + 1 : 1;
    rowSeq = seq;
    return {
      bySession: {
        ...s.bySession,
        [key]: {
          ...cur,
          messages: [
            ...messages,
            {
              role: "question",
              text: questions[0]?.question ?? "",
              ts: new Date().toISOString(),
              seq,
              question: {
                requestId,
                runId: event.runId,
                toolUseId: data.toolUseId ?? null,
                // The CLI's runtime rows (free-form Other, done) are not the
                // question's options: the card answers through the round.
                questions:
                  rpc && questions.length === 1
                    ? [{ ...spec, multiSelect: multi, options: frame.options }]
                    : questions,
                status: "pending" as const,
              },
            },
          ],
        },
      },
    };
  });
  if (rowSeq > 0 && rpc && multi) {
    openAskLoop(key, { base: frame.base, seq: rowSeq, requestId, runId: event.runId });
  }
}

function onQuestionSettled(
  event: EngineEventPayload,
  key: string,
  deps: EngineEventDeps,
) {
  const requestId = (event.data as { requestId?: string })?.requestId?.trim();
  if (!requestId) return;
  patchQuestionByRequestId(deps.set, key, requestId, (question) =>
    question.status === "pending" ? { ...question, status: "cancelled" as const } : question,
  );
  // A settled frame ends its round: whatever the CLI was waiting on is gone.
  if (askLoops.get(key)?.requestId === requestId) askLoops.delete(key);
}

function onWarn(event: EngineEventPayload, key: string, deps: EngineEventDeps) {
  // Non-terminal notice (e.g. an upstream 429 the CLI is retrying): show the
  // banner, but the turn is still alive — streaming state, unflushed chunks,
  // and run routing all stay untouched. Cleared by onDone when the turn
  // recovers, overwritten by onError if it ends up failing.
  patchSession(deps.set, key, { error: event.data as string });
}

/**
 * Live provider-retry progress (claude `system/api_retry`, codex
 * `Reconnecting... n/m`, omp `auto_retry_start`). Shown in the run status
 * line as "重试中 x/y" — deliberately NOT the error banner: the CLI is
 * backing off and will re-issue the request, so this is progress. An attempt
 * of 0 (or a retry-end event) clears it; so does the next content event.
 */
function onRetry(event: EngineEventPayload, key: string, deps: EngineEventDeps) {
  const data = (event.data ?? {}) as {
    attempt?: unknown;
    max?: unknown;
    message?: unknown;
  };
  const attempt = typeof data.attempt === "number" ? data.attempt : 0;
  if (attempt <= 0) {
    clearRetry(key, deps);
    return;
  }
  retryingKeys.add(key);
  if (!deps.get().retryingByKey[key]) {
    deps.set((s) => ({ retryingByKey: setRetryingFlag(s.retryingByKey, key, true) }));
  }
  patchSession(deps.set, key, {
    retry: {
      attempt,
      max: typeof data.max === "number" ? data.max : 0,
      message: typeof data.message === "string" ? data.message : "",
    },
  });
}

/** Drop the indicator once the re-issued request produces content. A
 *  recovered retry ends with output, so this lands before any explicit end
 *  event and the chip never lingers over a healthy stream. */
function clearRetry(key: string, deps: EngineEventDeps) {
  retryingKeys.delete(key);
  const state = deps.get();
  if (state.bySession[key]?.retry) patchSession(deps.set, key, { retry: null });
  if (state.retryingByKey[key]) {
    deps.set((s) => ({ retryingByKey: setRetryingFlag(s.retryingByKey, key, false) }));
  }
}

/** Engine-reported compaction progress (omp rpc-ui `auto_compaction_*`):
 *  automatic mid-turn summarization, surfaced as the tail indicator's label
 *  swap. `active: false` clears only an automatic flag — a manual compact
 *  turn owns its flag until the turn settles. */
function onCompaction(event: EngineEventPayload, key: string, deps: EngineEventDeps) {
  const data = (event.data ?? {}) as { active?: unknown };
  if (data.active === true) {
    if (deps.get().bySession[key]?.compaction) return;
    patchSession(deps.set, key, {
      compaction: { automatic: true, startedAt: Date.now() },
    });
  } else if (deps.get().bySession[key]?.compaction?.automatic) {
    patchSession(deps.set, key, { compaction: null });
  }
}

function onDone(event: EngineEventPayload, key: string, deps: EngineEventDeps) {
  const prev = deps.get().bySession[key] ?? EMPTY_SESSION;
  const ownTurn = ownsTurn(prev, key, event.runId);
  // Retry/compaction are turn-level too: a run that does not own the session
  // must not clear the live run's retry chip or compaction flag.
  if (ownTurn) {
    clearRetry(key, deps);
    askLoops.delete(key);
    if (prev.compaction) patchSession(deps.set, key, { compaction: null });
  }
  const data = event.data as { usage: unknown };
  // A done whose turn still has background tasks running is not the run's
  // terminal event: keep the run routed so task frames keep flowing and the
  // CLI's completion turn can reopen it.
  const backgroundTasks =
    typeof (event.data as { backgroundTasks?: unknown } | null)?.backgroundTasks === "number"
      ? (event.data as { backgroundTasks: number }).backgroundTasks
      : 0;
  // A done the reader marked `runContinues` closed a content-free turn (the
  // CLI's queued reconciliation turn): the run is not terminal — the real
  // turn's frames are still coming — so every "the run is over" bookkeeping
  // below (settled ids, routing, ledger booking) stays off.
  const runContinues =
    (event.data as { runContinues?: unknown } | null)?.runContinues === true;
  // Occupancy for the context meter: the newest single report (claude's one
  // payload already carries the turn's totals).
  const turnTotals = turnUsageTotals.get(event.runId);
  let settledUsage = mergeUsage(turnTotals ? prev.usage : data.usage, prev.usage);
  const finalWindow = reportedContextWindow(data.usage);
  if (finalWindow && settledUsage && typeof settledUsage === "object") {
    settledUsage = { ...settledUsage, model_context_window: finalWindow };
  }
  // The row tells the reader what the reply cost: every report of this run
  // summed, which for a multi-request reply is more than its last request.
  turnUsageTotals.delete(event.runId);
  const finalUsage = turnTotals
    ? mergeUsage(usageSnapshot(turnTotals), settledUsage)
    : settledUsage;
  // 回复即落账：后台期的 done 也把这一轮的 usage 记进台账（进程可能死在后台
  // 期，等最终 done 就丢账），落账后把 runId 记为已记账，最终 done 自动跳过。
  // A continuing done books nothing: its usage is the reconciliation turn's,
  // and holding `liveLedgerRuns` would make the real reply's done skip the
  // booking. The real turn's own done books as usual.
  //
  // Book only when the turn actually reported usage (live reports or this
  // done's own payload). A done with `usage: null` and no live reports has
  // nothing of its own to book — without the gate, `finalUsage` falls back
  // to the session's stale usage snapshot and books those (already counted)
  // tokens as a new row. This is what keeps a run's second, terminal done
  // (usage: null, after a held done) from double-booking.
  const hasTurnUsage = turnTotals != null || data.usage != null;
  const booked =
    runContinues || !hasTurnUsage ? false : recordTurnUsage(deps, event, key, finalUsage);
  // A run whose content frames were dropped as foreign (dual-run) never
  // streamed its completion turn: once the run is terminal, merge the rows
  // the open session missed back from its transcript.
  if (backgroundTasks === 0 && !runContinues && droppedContentRuns.delete(event.runId)) {
    deps.reloadTranscript?.(key);
  }

  if (!ownTurn) {
    // 同会话双 run：这个 run 不认领会话（会话在流另一个更晚的 run），它的 done
    // 只能做 run 级收尾——结算它自己的任务、记住它的终局身份、去掉路由与用量
    // 记账。streaming / turnStartedAt / live 行 / 队列 / 前台流标一律不碰。
    const held = backgroundTasks > 0 || runContinues;
    deps.set((s) => {
      const cur = s.bySession[key];
      if (!cur) return {};
      return {
        bySession: {
          ...s.bySession,
          [key]: withTaskDerived({
            ...cur,
            tasks:
              held
                ? cur.tasks
                : settleRunTasks(cur.tasks ?? EMPTY_TASKS, event.runId, "interrupted"),
            settledRunIds:
              held
                ? cur.settledRunIds
                : rememberSettledRun(cur, event.runId),
          }),
        },
      };
    });
    if (held) {
      // Background tasks (or the CLI's queued turn) keep this run alive:
      // routing stays, and the booking holds so its own final done does not
      // book the reply twice.
      if (booked) liveLedgerRuns.add(event.runId);
      void ipc.rescanSessions().catch(() => {});
      return;
    }
    runRouting.delete(event.runId);
    untrackRun(event.runId);
    dropRunUsage(event.runId);
    void ipc.rescanSessions().catch(() => {});
    return;
  }

  // Fold the turn's last unflushed chunks (the final sink batch can arrive
  // in the same frame as done), then settle every live row: the streamed
  // text the user watched arrive *is* the final message.
  const pending = drainPending(key);
  deps.set((s) => {
    const cur = s.bySession[key] ?? EMPTY_SESSION;
    let messages = pending
      ? applyStreamParts(
          cur.messages,
          pending.parts,
          pending.model ?? (deps.get().models[event.engine] || null),
          pending.effort ?? stampedEffort(deps, event.engine, key),
        )
      : cur.messages;
    messages = settleLiveRows(messages);
    const turnStart = cur.turnStartedAt ?? prev.turnStartedAt;
    const durationMs = turnStart ? Math.max(0, Date.now() - turnStart) : null;
    const model = stampedModel(deps, event.engine, key);
    const effort = stampedEffort(deps, event.engine, key);
    // A done with nothing left running ends the run: nothing will ever notify
    // its tasks again, so a row still running means the process died or the
    // notification got lost — interrupted, not left spinning forever. (An
    // ambient housekeeping task can be marked while it still works; accepted,
    // housekeeping never drives the indicator.) A background-phase done keeps
    // the rows untouched: those tasks are exactly what the turn waits for.
    const tasks =
      backgroundTasks > 0 || runContinues
        ? // A runContinues done is not terminal either: the run explicitly
          // continues, so its rows are not orphaned work.
          cur.tasks
        : settleRunTasks(cur.tasks ?? EMPTY_TASKS, event.runId, "interrupted");
    // Stamp usage, durationMs, effort, and model onto the turn's last
    // assistant message — but only when the row provably belongs to this
    // run. A done that arrived with no live claim (this run's own
    // background-phase done already stamped the row, or — dual-run — the
    // session's owning run already settled and this late done merely
    // degenerated to ownTurn because the claim was cleared) must not
    // overwrite a row that already carries another run's usage stamp.
    const claimed = turnOwner(cur, key) === event.runId;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") {
        if (claimed || messages[i].usage == null) {
          messages = [
            ...messages.slice(0, i),
            {
              ...messages[i],
              ...(finalUsage ? { usage: finalUsage } : {}),
              ...(durationMs != null ? { durationMs } : {}),
              ...(effort ? { effort } : {}),
              ...(model ? { model } : {}),
            },
            ...messages.slice(i + 1),
          ];
        }
        break;
      }
    }
    return {
      bySession: {
        ...s.bySession,
        [key]: withTaskDerived({
          ...cur,
          messages,
          error: null,
          streaming: false,
          turnStartedAt: null,
          // The turn is settled: the session is no longer claimed by a run
          // until the next one starts (or this one reopens for its completion
          // turn, which claims it again through adoptObservedRun).
          currentRunId: null,
          usage: settledUsage,
          turnUsage: null,
          interrupted: false,
          awaitingTasks: backgroundTasks > 0,
          // Keep this run alive for its background tasks; only a done with
          // nothing running is the run's terminal event.
          settledRunIds: backgroundTasks > 0 || runContinues ? cur.settledRunIds : rememberSettledRun(cur, event.runId),
          tasks,
        }),
      },
      streamingByKey: setStreamingFlag(s.streamingByKey, key, false),
      retryingByKey: setRetryingFlag(s.retryingByKey, key, false),
    };
  });
  if (backgroundTasks > 0 || runContinues) {
    // The reply's own segment is over, but the run is not terminal: routing
    // and runActivity stay (task frames and the CLI's own follow-up turn —
    // background completion, or the queued turn a continuing done left
    // behind — still come back here); the queue drains as usual so typing is
    // never locked; the usage ledger was booked above, and the follow-up
    // done skips it.
    if (booked) liveLedgerRuns.add(event.runId);
    void ipc.rescanSessions().catch(() => {});
    deps.markUnseenIfBackground(key);
    if (!prev.interrupted) deps.drainQueue(key);
    return;
  }
  // The run is over: drop its routing entry so the map cannot grow forever.
  runRouting.delete(event.runId);
  untrackRun(event.runId);
  dropRunUsage(event.runId);
  // Native file changed; refresh list cache in background.
  void ipc.rescanSessions().catch(() => {});
  deps.markUnseenIfBackground(key);
  // An interrupted turn settles here too: keep the queue parked — the user
  // stopped the session, the next message is theirs to send.
  if (!prev.interrupted) {
    deps.drainQueue(key);
    // Claude's result line reports the turn's summed usage (every request of
    // the turn added up), not the occupancy the meter shows — so re-read the
    // latest per-message snapshot from the session file once the engine has
    // settled it. /compact turns need the same re-read on every engine.
    const lastUser = [...prev.messages].reverse().find((m) => m.role === "user");
    const compactTurn = Boolean(lastUser?.text.trim().startsWith("/compact"));
    if (event.engine === "claude" || compactTurn) {
      setTimeout(() => {
        deps.refreshSessionUsage?.(key)?.catch(() => {});
      }, 400);
    }
  }
}

/** Ledger the turn's own report when it never reported live (claude sends one
 *  usage payload, the turn's totals, on its result line). Turns that streamed
 *  reports already have their rows.
 *
 *  Returns whether a row now exists for this run. The caller holds a
 *  non-terminal done's booking in `liveLedgerRuns`, so the run's own final
 *  done skips the write instead of booking the same reply twice. */
function recordTurnUsage(
  deps: EngineEventDeps,
  event: EngineEventPayload,
  key: string,
  usage: unknown,
): boolean {
  if (!usageTrackingEnabled()) return false;
  if (liveLedgerRuns.delete(event.runId)) return true;
  const parsed = parseUsage(usage);
  if (!parsed) return false;
  writeUsageRow(deps, event, key, parsed, 1);
  return true;
}

/** Mark a session running off an event of a turn this client never sent: the
 *  phone watching the desktop's run, or the desktop watching the phone's.
 *  Routes the run first so Stop and the orphan sweep reach it, then lifts the
 *  two flags the composer / sidebar / tab dots read. */
function adoptObservedRun(
  event: EngineEventPayload,
  key: string,
  deps: EngineEventDeps,
) {
  if (!runRouting.has(event.runId)) {
    settleOrphanedRuns(deps.set, routeRun(event.runId, key));
  }
  const cur = deps.get().bySession[key];
  const taskFrame =
    event.kind === "task_started" ||
    event.kind === "task_progress" ||
    event.kind === "task_notification" ||
    event.kind === "tasks";
  // A run waiting on background work must ignore its own task frames here:
  // they are not the completion turn, so they must not clear awaitingTasks,
  // restart the segment timer, or make the session read as streaming again
  // (the composer would start queueing while the user should be able to send).
  if (cur?.awaitingTasks && taskFrame) return;
  // Task frames route (above) but never adopt: they are panel state, not
  // turn content, so they prove nothing about which run owns the session's
  // reply. A bare task frame must not claim the turn, flip the session to
  // streaming, or restart its segment timer.
  if (taskFrame) return;
  // Claiming a session that already streams without an owner is reserved
  // for content frames: only proof the run is producing the reply may take
  // the turn over.
  const contentFrame =
    event.kind === "delta" || event.kind === "thinking" || event.kind === "message";
  if (!cur?.streaming) {
    // A completion turn reopens the run after its background phase: its text
    // is a fresh segment, so the elapsed timer restarts and the background
    // marker clears. The run also claims the session here: from now on its
    // frames are the turn, and another run's settle may not write over them.
    const reopen = cur?.awaitingTasks === true;
    patchSession(deps.set, key, {
      streaming: true,
      turnStartedAt: reopen ? Date.now() : (cur?.turnStartedAt ?? Date.now()),
      currentRunId: event.runId,
      ...(reopen ? { awaitingTasks: false } : {}),
    });
  } else if (contentFrame && !cur.awaitingTasks && turnOwner(cur, key) === null) {
    // Streaming without a claimed run (a session restored without one): the
    // run now talking owns the turn. A session still awaiting its background
    // tasks is NOT claimed here — its live run already owns it, and the
    // frames arriving are the background phase's, not a newer turn's.
    patchSession(deps.set, key, { currentRunId: event.runId });
  }
  if (!deps.get().streamingByKey[key]) {
    deps.set((s) => ({
      streamingByKey: setStreamingFlag(s.streamingByKey, key, true),
    }));
  }
}

// Retain terminal run identities after routing is removed. A delayed retry
// can otherwise fall back to sessionId and masquerade as a new observed run.
// Bound this history; real new turns always carry a fresh runId.
// Exported like runRouting so tests can reset it — reusing one runId across
// tests would otherwise leak the previous test's terminal state.
export const settledRuns = new Map<string, "done" | "error">();
const MAX_SETTLED_RUNS = 256;

/** Resolve an event's session key (run routing, then session-id match) and
 * dispatch to the per-kind handler. */
export function handleEngineEvents(
  events: EngineEventPayload[],
  deps: EngineEventDeps,
) {
  let toolBatch: { event: EngineEventPayload; key: string; tools: ToolMessageInput[] } | undefined;
  const flushTools = () => {
    if (!toolBatch) return;
    const { event, key, tools } = toolBatch;
    toolBatch = undefined;
    appendToolMessages(deps.set, key, tools, stampedModel(deps, event.engine, key));
  };
  for (const event of events) {
    const data = event.kind === "message"
      ? event.data as ToolMessageInput & { role: string }
      : undefined;
    const isTool = data?.role === "tool" || data?.role === "tool_result";
    if (toolBatch && (
      !isTool ||
      event.runId !== toolBatch.event.runId ||
      event.engine !== toolBatch.event.engine ||
      event.sessionId !== toolBatch.event.sessionId
    )) {
      flushTools();
    }
    const settled = settledRuns.get(event.runId);
    // EOF stderr/failure can follow Done, and the turn's final usage report
    // can trail either terminal event. Keep those, but never adopt the run
    // again or drain its queue a second time.
    if (
      settled &&
      !(
        event.kind === "usage" ||
        (settled === "done" &&
          (event.kind === "warn" ||
            event.kind === "error" ||
            event.kind === "question_settled"))
      )
    ) {
      continue;
    }
    const state = deps.get();
    let key = runRouting.get(event.runId) ?? Object.keys(state.bySession).find(
      (candidate) => state.bySession[candidate]?.settledRunIds?.includes(event.runId),
    );
    if (key) touchRun(event.runId);
    if (!key && event.sessionId) {
      key = sessionKey(event.engine, event.sessionId, "");
      // sessionId-only key lacks workspace; find active match
      if (!(key in state.bySession)) {
        const match = Object.keys(state.bySession).find(
          (k) => k === key || k.endsWith(`/${event.sessionId}`),
        );
        if (match) key = match;
      }
    }
    if (!key) continue;
    if (event.kind === "done" || event.kind === "error") {
      const bg =
        event.kind === "done" &&
        typeof (event.data as { backgroundTasks?: unknown } | null)?.backgroundTasks === "number" &&
        (event.data as { backgroundTasks: number }).backgroundTasks > 0;
      // The reader marks a done that closed a content-free turn (the CLI's
      // own queued reconciliation turn) as `runContinues`: the process still
      // has the user's message to answer, so this done must not mark the run
      // settled — that would drop the real turn's frames at the gate above.
      const runContinues =
        event.kind === "done" &&
        (event.data as { runContinues?: unknown } | null)?.runContinues === true;
      if (!bg && !runContinues) {
        settledRuns.set(event.runId, event.kind);
        if (settledRuns.size > MAX_SETTLED_RUNS) {
          settledRuns.delete(settledRuns.keys().next().value!);
        }
        // The computer-use global Esc-to-stop is disarmed only by the
        // terminal event of the computer-use session's own turn. A held
        // done (background tasks still running — excluded above) and a
        // foreign run's done/error must not kill a system-wide hotkey out
        // from under the run that is still driving the machine. Arming is
        // per computer-use send (messaging.ts); the call is idempotent.
        const settleSession = state.bySession[key];
        if (
          settleSession?.activeComputerUse === true &&
          ownsTurn(settleSession, key, event.runId)
        ) {
          void ipc.computerUseSetActive?.(false)?.catch(() => {});
        }
      }
    }
    if (state.bySession[key]?.settledRunIds?.includes(event.runId)) {
      // A usage report trailing the terminal event carries the turn's final
      // occupancy. Re-read it from the transcript instead of patching the
      // settled state — the file can lag the event, and refreshSessionUsage
      // retries briefly for exactly that.
      if (event.kind === "usage") {
        void deps.refreshSessionUsage?.(key)?.catch(() => {});
      } else if (
        (event.kind === "warn" || event.kind === "error") &&
        !state.bySession[key]?.streaming
      ) {
        // Shutdown diagnostics remain visible, but cannot restart a turn or
        // overwrite a newer turn's state.
        onWarn(event, key, deps);
      }
      continue;
    }

    // 同会话双 run 的降级口径：会话正在流 run B 时，同会话另一个仍在路由中的
    // run A（后台任务尚未收尾）还会说它自己的通知轮。A 的内容帧不并入 B 的 live
    // 行——按 run 记入 droppedContentRuns，待 A 的终局 done/error 到达时对该
    // 会话做定向 transcript 重读合并补显（reloadTranscript；rescanSessions 只
    // 刷侧栏列表，不会补消息）；任务帧与 done/error/session 仍照常路由（见
    // FOREIGN_CONTENT_KINDS）。
    if (
      FOREIGN_CONTENT_KINDS.has(event.kind) &&
      isForeignContent(deps.get().bySession[key], key, event.runId)
    ) {
      droppedContentRuns.add(event.runId);
      continue;
    }

    // Engine events reach every attached client, but the running flag is set
    // by the sender's own send path — so an observer (a phone watching the
    // desktop's turn) would never see one. The events are the shared truth:
    // adopt any run still talking, let done/error settle it below. A denial
    // is excluded on purpose: the CLI has stopped to ask, and the grant
    // card's resend has to stay available while it waits.
    if (!settled && event.kind !== "done" && event.kind !== "error" && event.kind !== "permission_denied") {
      adoptObservedRun(event, key, deps);
    }

    switch (event.kind) {
      case "delta":
        onDelta(event, key, deps);
        break;
      case "thinking":
        onThinking(event, key, deps);
        break;
      case "message":
        if (isTool && data) {
          if (retryingKeys.has(key)) clearRetry(key, deps);
          toolBatch ??= { event, key, tools: [] };
          toolBatch.tools.push({ ...data, patch: data.patch === true });
        } else {
          onMessage(event, key, deps);
        }
        break;
      case "session":
        onSession(event, key, deps);
        break;
      case "usage":
        onUsage(event, key, deps);
        break;
      case "error":
        if (settled === "done") onWarn(event, key, deps);
        else onError(event, key, deps);
        break;
      case "warn":
        onWarn(event, key, deps);
        break;
      case "retry":
        onRetry(event, key, deps);
        break;
      case "compaction":
        onCompaction(event, key, deps);
        break;
      case "permission_denied":
        onPermissionDenied(event, key, deps);
        break;
      case "question":
        onQuestion(event, key, deps);
        break;
      case "question_settled":
        onQuestionSettled(event, key, deps);
        break;
      case "done":
        onDone(event, key, deps);
        break;
      case "model":
        onModel(event, key, deps);
        break;
      case "effort":
        onEffort(event, key, deps);
        break;
      case "task_started":
      case "task_progress":
      case "task_notification":
      case "tasks":
        applyTaskEvent(event, key, deps);
        break;
    }
  }
  flushTools();
}
