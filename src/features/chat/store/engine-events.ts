import { ipc, type Message, type SessionMeta, type TodosPayload } from "@/lib/ipc";
import type { EngineEventPayload } from "@/lib/events";
import { dedupeTabs, persistTabs, sessionKey } from "./persistence";
import {
  EMPTY_SESSION,
  appendToolMessage,
  applyStreamParts,
  bufferStreamPart,
  drainPending,
  migratePendingStream,
  moveStreamingFlag,
  patchSession,
  resolveSessionModel,
  routeRun,
  runRouting,
  scheduleDeltaFlush,
  setStreamingFlag,
  settleLiveRows,
  touchRun,
  untrackRun,
  updatePendingStreamModel,
} from "./stream";
import type { ChatStore } from "../store";
import { mergeUsage, parseUsage, type ParsedUsage } from "../usage";
import { usageTrackingEnabled } from "@/features/settings/usage-tracking";

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

/** Effective reasoning effort for event-stamped rows: the session's activeEffort wins,
 * followed by the owning tab's per-tab override, then engine default. */
function stampedEffort(
  deps: EngineEventDeps,
  engine: string,
  key: string,
): string | null {
  const s = deps.get();
  const sessionActive = s.bySession[key]?.activeEffort;
  if (sessionActive) return sessionActive;
  const tab = s.openTabs.find(
    (t) => sessionKey(t.engine, t.sessionId, t.workspacePath) === key,
  );
  return (tab?.effort ?? s.efforts[engine]) || null;
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

function onDelta(
  event: EngineEventPayload,
  key: string,
  deps: EngineEventDeps,
) {
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
  const data = event.data as {
    role: string;
    text: string;
    path?: string | null;
    todos?: TodosPayload;
    args?: unknown;
    result?: unknown;
    patch?: boolean;
  };
  if (data.role === "tool" || data.role === "tool_result") {
    appendToolMessage(
      deps.set,
      key,
      data.text,
      stampedModel(deps, event.engine, key),
      data.path ?? null,
      data.todos ?? null,
      data.args,
      data.patch === true,
      data.result,
    );
    return;
  }
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

export function rememberModelForRun(
  key: string,
  model: string | null | undefined,
) {
  if (model) pendingSessionModels.set(key, model);
}

function onSession(
  event: EngineEventPayload,
  key: string,
  deps: EngineEventDeps,
) {
  const nativeId = event.data as string;
  const sentModel = pendingSessionModels.get(key);
  if (sentModel) {
    pendingSessionModels.delete(key);
    void ipc
      .rememberSessionModel(event.engine, nativeId, sentModel)
      .catch(() => {});
  }
  // Resolve the workspace from the tab that owns this key — not from the
  // active tab. A first message sent on a background tab must not adopt the
  // foreground tab's workspace (the session would be orphaned there).
  const tab = deps
    .get()
    .openTabs.find(
      (t) => sessionKey(t.engine, t.sessionId, t.workspacePath) === key,
    );
  const workspacePath =
    tab?.workspacePath ?? deps.get().active?.workspacePath ?? "";
  const newKey = sessionKey(event.engine, nativeId, workspacePath);
  settleOrphanedRuns(deps.set, routeRun(event.runId, newKey));
  // Unflushed stream chunks sit under the pre-migration key; move them too.
  migratePendingStream(key, newKey);
  // Migrate pending key -> native key.
  deps.set((s) => {
    const prev = s.bySession[key];
    if (!prev) return {};
    const bySession = { ...s.bySession, [newKey]: prev };
    if (key !== newKey) delete bySession[key];
    const drafts = { ...s.drafts };
    if (key in drafts) {
      drafts[newKey] = drafts[key];
      delete drafts[key];
    }
    const streamingByKey = moveStreamingFlag(s.streamingByKey, key, newKey);
    const activeNext =
      s.active &&
      s.active.engine === event.engine &&
      s.active.sessionId === null &&
      s.active.workspacePath === workspacePath
        ? { ...s.active, sessionId: nativeId }
        : s.active;
    return { bySession, drafts, streamingByKey, active: activeNext };
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
        return { ...t, sessionId: nativeId };
      }),
    );
    persistTabs(openTabs, s.active);
    return { openTabs };
  });
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
  for (const [runId] of orphaned) dropRunUsage(runId);
  set((s) => {
    let streamingByKey = s.streamingByKey;
    let bySession = s.bySession;
    for (const [, key] of orphaned) {
      streamingByKey = setStreamingFlag(streamingByKey, key, false);
      const cur = bySession[key];
      if (cur?.streaming) {
        if (bySession === s.bySession) bySession = { ...s.bySession };
        bySession[key] = { ...cur, streaming: false, turnStartedAt: null };
      }
    }
    return { bySession, streamingByKey };
  });
}

function onUsage(
  event: EngineEventPayload,
  key: string,
  deps: EngineEventDeps,
) {
  const parsed = parseUsage(event.data);
  const totals = parsed ? addTurnUsage(event.runId, parsed) : null;
  patchSession(deps.set, key, {
    usage: event.data,
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
        [key]: {
          ...cur,
          messages,
          error: event.data as string,
          streaming: false,
          turnStartedAt: null,
          turnUsage: null,
        },
      },
      streamingByKey: setStreamingFlag(s.streamingByKey, key, false),
    };
  });
  // The run is over: drop its routing entry and usage bookkeeping so the
  // maps cannot grow forever.
  runRouting.delete(event.runId);
  untrackRun(event.runId);
  dropRunUsage(event.runId);
  deps.markUnseenIfBackground(key);
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

function onWarn(event: EngineEventPayload, key: string, deps: EngineEventDeps) {
  // Non-terminal notice (e.g. an upstream 429 the CLI is retrying): show the
  // banner, but the turn is still alive — streaming state, unflushed chunks,
  // and run routing all stay untouched. Cleared by onDone when the turn
  // recovers, overwritten by onError if it ends up failing.
  patchSession(deps.set, key, { error: event.data as string });
}

function onDone(event: EngineEventPayload, key: string, deps: EngineEventDeps) {
  const prev = deps.get().bySession[key] ?? EMPTY_SESSION;
  const data = event.data as { usage: unknown };
  // Occupancy for the context meter: the newest single report (claude's one
  // payload already carries the turn's totals).
  const settledUsage = mergeUsage(data.usage, prev.usage);
  // The row tells the reader what the reply cost: every report of this run
  // summed, which for a multi-request reply is more than its last request.
  const turnTotals = turnUsageTotals.get(event.runId);
  turnUsageTotals.delete(event.runId);
  const finalUsage = turnTotals
    ? mergeUsage(usageSnapshot(turnTotals), settledUsage)
    : settledUsage;
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
    // Stamp usage, durationMs, effort, and model onto the turn's last assistant message.
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") {
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
        break;
      }
    }
    return {
      bySession: {
        ...s.bySession,
        [key]: {
          ...cur,
          messages,
          error: null,
          streaming: false,
          turnStartedAt: null,
          usage: settledUsage,
          turnUsage: null,
          interrupted: false,
        },
      },
      streamingByKey: setStreamingFlag(s.streamingByKey, key, false),
    };
  });
  // The run is over: drop its routing entry so the map cannot grow forever.
  runRouting.delete(event.runId);
  untrackRun(event.runId);
  // Ledger the turn's tokens now that it is settled: the same report that
  // stamps the row above, so the usage page counts real engine numbers. The
  // feature's own switch gates it (localStorage-backed, see usage-tracking.ts).
  recordTurnUsage(deps, event, key, finalUsage);
  // Native file changed; refresh list cache in background.
  ipc.rescanSessions().catch(() => {});
  deps.markUnseenIfBackground(key);
  // An interrupted turn settles here too: keep the queue parked — the user
  // stopped the session, the next message is theirs to send.
  if (!prev.interrupted) {
    deps.drainQueue(key);
    // If this turn was a /compact command, refresh latest token usage from session history
    // once the engine settles the session file on disk.
    const lastUser = [...prev.messages].reverse().find((m) => m.role === "user");
    if (lastUser?.text.trim().startsWith("/compact")) {
      setTimeout(() => {
        deps.refreshSessionUsage?.(key)?.catch(() => {});
      }, 400);
    }
  }
}

/** Ledger the turn's own report when it never reported live (claude sends one
 *  usage payload, the turn's totals, on its result line). Turns that streamed
 *  reports already have their rows. */
function recordTurnUsage(
  deps: EngineEventDeps,
  event: EngineEventPayload,
  key: string,
  usage: unknown,
) {
  if (!usageTrackingEnabled()) return;
  if (liveLedgerRuns.delete(event.runId)) return;
  const parsed = parseUsage(usage);
  if (!parsed) return;
  writeUsageRow(deps, event, key, parsed, 1);
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
  if (!cur?.streaming) {
    patchSession(deps.set, key, {
      streaming: true,
      turnStartedAt: cur?.turnStartedAt ?? Date.now(),
    });
  }
  if (!deps.get().streamingByKey[key]) {
    deps.set((s) => ({
      streamingByKey: setStreamingFlag(s.streamingByKey, key, true),
    }));
  }
}

/** Resolve an event's session key (run routing, then session-id match) and
 * dispatch to the per-kind handler. */
export function handleEngineEvents(
  events: EngineEventPayload[],
  deps: EngineEventDeps,
) {
  for (const event of events) {
    const state = deps.get();
    let key = runRouting.get(event.runId);
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

    // Engine events reach every attached client, but the running flag is set
    // by the sender's own send path — so an observer (a phone watching the
    // desktop's turn) would never see one. The events are the shared truth:
    // adopt any run still talking, let done/error settle it below. A denial
    // is excluded on purpose: the CLI has stopped to ask, and the grant
    // card's resend has to stay available while it waits.
    if (event.kind !== "done" && event.kind !== "error" && event.kind !== "permission_denied") {
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
        onMessage(event, key, deps);
        break;
      case "session":
        onSession(event, key, deps);
        break;
      case "usage":
        onUsage(event, key, deps);
        break;
      case "error":
        onError(event, key, deps);
        break;
      case "warn":
        onWarn(event, key, deps);
        break;
      case "permission_denied":
        onPermissionDenied(event, key, deps);
        break;
      case "done":
        onDone(event, key, deps);
        break;
      case "model":
        onModel(event, key, deps);
        break;
    }
  }
}
