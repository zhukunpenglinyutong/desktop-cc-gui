import type { Message, TodosPayload } from "@/lib/ipc";

/**
 * Streaming buffers and bySession write helpers. Leaf module: functions are
 * generic over a minimal BySessionSlice so neither this file nor
 * engine-events needs a runtime import of the store itself (no cycles).
 */

export interface QueuedMessage {
  id: string;
  text: string;
  images: string[];
  queuedAt: number;
}

export interface SessionState {
  messages: Message[];
  /** Older delegation metadata kept outside the paginated message window. */
  subagentHistory: Message[];
  nextBefore: number | null;
  loading: boolean;
  streaming: boolean;
  /** Epoch ms when the current streaming turn began; drives the tail
   * indicator's elapsed timer so it survives the indicator's unmount/remount
   * cycle (idle ↔ growing) instead of restarting from 0 every pause. */
  turnStartedAt: number | null;
  activeModel?: string | null;
  activeEffort?: string | null;
  /** In-app channel this session runs; spawn injects its env. */
  activeProvider?: string | null;
  /** Newest single report: the context meter reads occupancy from it. */
  usage: unknown;
  /** Running total of the reply in flight (sum of its reports), so the tail
   *  indicator counts this reply instead of showing one request's slice. */
  turnUsage: unknown;
  /** Bounded terminal-run history; late events must not revive a finished turn. */
  settledRunIds?: string[];
  error: string | null;
  /** Messages typed while a turn streams; sent FIFO when the turn ends. */
  queue: QueuedMessage[];
  /** Set by interrupt(): the next "done" settles the turn but must not
   * auto-drain the queue — pressing stop is not "go on to the next". */
  interrupted: boolean;
}

export const EMPTY_SESSION: SessionState = {
  messages: [],
  subagentHistory: [],
  nextBefore: null,
  loading: false,
  streaming: false,
  turnStartedAt: null,
  activeModel: null,
  activeEffort: null,
  activeProvider: null,
  usage: null,
  turnUsage: null,
  error: null,
  queue: [],
  interrupted: false,
};

/** The model one session runs with, most specific first:
 *
 *  1. the tab's own pick (an explicit choice for this session),
 *  2. what the engine reported running for this session,
 *  3. the model this session's history was written with,
 *  4. the engine default (new chats, sessions with no history yet).
 *
 * Per session on purpose: two omp sessions may run different models, so the
 * picker, the send, and the stamped rows must all read the session's model —
 * an engine-wide default would make one session's pick leak into the other.
 */
export function resolveSessionModel(
  tab: { engine: string; model?: string } | null | undefined,
  session: Pick<SessionState, "activeModel" | "messages"> | undefined,
  engineDefault?: string,
): string | undefined {
  if (!tab) return engineDefault;
  if (tab.model) return tab.model;
  if (session?.activeModel) return session.activeModel;
  const messages = session?.messages;
  if (messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const model = messages[i].model;
      if (model) return model;
    }
  }
  return engineDefault;
}

/** The reasoning level one session runs with. A native session owns its level
 * in SessionState/database; only a not-yet-created tab may carry a starting
 * override. This prevents stale persisted tab fields from shadowing a newer
 * level recorded by another client. */
export function resolveSessionEffort(
  tab: { engine: string; sessionId?: string | null; effort?: string | null } | null | undefined,
  session: Pick<SessionState, "activeEffort" | "messages"> | undefined,
  engineDefault?: string,
): string | undefined {
  if (!tab) return engineDefault;
  if (tab.sessionId === null && tab.effort) return tab.effort;
  if (session?.activeEffort) return session.activeEffort;
  const messages = session?.messages;
  if (messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const effort = messages[i].effort;
      if (effort) return effort;
    }
  }
  return engineDefault;
}

/** The in-app channel one session runs with. A native session owns it in
 * SessionState / session_providers; only a not-yet-created tab may carry a
 * starting override. There is no message-history scan: the transcript does
 * not record the channel. */
export function resolveSessionProvider(
  tab: { engine: string; sessionId?: string | null; provider?: string | null } | null | undefined,
  session: Pick<SessionState, "activeProvider"> | undefined,
  engineDefault?: string,
): string | undefined {
  if (!tab) return engineDefault;
  if (tab.sessionId === null && tab.provider) return tab.provider;
  if (session?.activeProvider) return session.activeProvider;
  return engineDefault;
}

/** Minimal store shape these helpers touch. */
export interface BySessionSlice {
  bySession: Record<string, SessionState>;
}

export type SetFn<T extends BySessionSlice> = (fn: (s: T) => Partial<T>) => void;

/** runId -> sessionKey routing for engine events. Entries are removed when
 * the run settles (done/error) or is interrupted — the map must not grow
 * monotonically over the app's lifetime. */
export const runRouting = new Map<string, string>();

export function rememberSettledRun(session: SessionState | undefined, runId: string): string[] {
  return [...(session?.settledRunIds ?? []).filter((id) => id !== runId), runId].slice(-32);
}
/** runId -> last activity (stamped at routing, refreshed on each routed
 * event). A run that dies without done/error (engine crash, killed process)
 * never gets its routing entry removed by the settling paths, so each newly
 * routed run sweeps entries silent for longer than the TTL — bounded, no
 * timer. Activity-based rather than start-based so an hours-long codex turn
 * is never swept while it is still talking. */
const runActivity = new Map<string, number>();
const RUN_ORPHAN_TTL_MS = 30 * 60_000;

/** Route a run to its session key and stamp its activity. Each call also
 * sweeps runs silent past the TTL; the returned `[runId, sessionKey]` pairs
 * are the dropped orphans, so the caller can clear their other run-scoped
 * state (usage maps, streaming flags). */
export function routeRun(runId: string, key: string): Array<[string, string]> {
  runRouting.set(runId, key);
  runActivity.set(runId, Date.now());
  return sweepOrphanRuns();
}

/** Refresh a live run's activity stamp on each routed event. */
export function touchRun(runId: string) {
  if (runActivity.has(runId)) runActivity.set(runId, Date.now());
}

/** Forget a settled run (its routing entry is dropped by the settling path). */
export function untrackRun(runId: string) {
  runActivity.delete(runId);
}

/** Drop routing entries silent past the TTL — their done/error never came. */
function sweepOrphanRuns(): Array<[string, string]> {
  const now = Date.now();
  const orphaned: Array<[string, string]> = [];
  for (const [runId, seenAt] of runActivity) {
    if (now - seenAt < RUN_ORPHAN_TTL_MS) continue;
    runActivity.delete(runId);
    const key = runRouting.get(runId);
    runRouting.delete(runId);
    if (key !== undefined) orphaned.push([runId, key]);
  }
  return orphaned;
}

/** One ordered stream chunk. Thinking and text deltas interleave within a
 * turn (extended thinking resumes between tool calls), so per-kind string
 * buffers would scramble their relative order; parts append in arrival order
 * and merge with the previous part when the kind matches. */
interface StreamPart {
  kind: "delta" | "thinking";
  text: string;
}
interface PendingStream {
  model: string | null;
  effort?: string | null;
  parts: StreamPart[];
}
/** sessionKey -> ordered stream chunks not yet flushed into rows */
const pendingStreams = new Map<string, PendingStream>();
let rafScheduled = false;
let fallbackScheduled = false;

/** Fold stream parts into the message list in place. omp interleaves the
 *  thinking and text channels within ONE assistant message (GLM emits
 *  reasoning deltas between text deltas), so each channel must grow a
 *  single row: appending to the last live row OF THAT ROLE — skipping the
 *  other channel's live row — instead of the last row overall. Text
 *  therefore stays one continuous markdown document (a mid-message split
 *  leaves `**`/backticks unclosed and renders literally) and thinking folds
 *  into one process section. A settled row ends its segment: tool starts
 *  and turn boundaries settle rows, so post-tool text correctly starts a
 *  fresh row. */
export function applyStreamParts(
  messages: Message[],
  parts: StreamPart[],
  model: string | null,
  effort: string | null = null,
): Message[] {
  let out = messages;
  for (const part of parts) {
    if (!part.text) continue;
    const role = part.kind === "thinking" ? "thinking" : "assistant";
    // Scan back over live rows (the other channel) to this channel's row;
    // stop at the first settled row — everything before it is history.
    let target = -1;
    for (let i = out.length - 1; i >= 0; i--) {
      if (out[i].live) {
        if (out[i].role === role) {
          target = i;
          break;
        }
      } else {
        break;
      }
    }
    if (target >= 0) {
      if (out === messages) out = messages.slice();
      const last = out[target];
      out[target] = { ...last, text: last.text + part.text };
      continue;
    }
    const seq = out.length ? out[out.length - 1].seq + 1 : 1;
    if (out === messages) out = messages.slice();
    out.push({
      seq,
      role,
      text: part.text,
      ts: new Date().toISOString(),
      live: true,
      ...(role === "assistant" ? { model, effort } : {}),
    });
  }
  return out;
}

/** Clear the live flag on every row; identity-preserving when nothing is
 * live. Rows stop growing once their segment is over (tool start, turn end). */
export function settleLiveRows(messages: Message[]): Message[] {
  if (!messages.some((m) => m.live)) return messages;
  return messages.map((m) => (m.live ? { ...m, live: false } : m));
}

export function bufferStreamPart(
  key: string,
  kind: StreamPart["kind"],
  text: string,
  model: string | null,
  effort: string | null = null,
) {
  const pending = pendingStreams.get(key) ?? { model, effort, parts: [] };
  if (!pending.model && model) pending.model = model;
  if (!pending.effort && effort) pending.effort = effort;
  const last = pending.parts[pending.parts.length - 1];
  if (last?.kind === kind) last.text += text;
  else pending.parts.push({ kind, text });
  pendingStreams.set(key, pending);
}

export function updatePendingStreamModel(key: string, model: string) {
  const pending = pendingStreams.get(key);
  if (pending) {
    pending.model = model;
  }
}

/** Pull one session's unflushed stream chunks out of the pending map. Any
 * structural path (tool row, done, error, interrupt) must fold these in —
 * otherwise chunks between the last flush and the structural event land
 * after it, out of order. */
export function drainPending(key: string): PendingStream | null {
  const pending = pendingStreams.get(key) ?? null;
  pendingStreams.delete(key);
  return pending;
}

/** Move unflushed stream chunks when a session's key changes (pending tab
 * adopts its native id), or the next flush resurrects the old key with
 * orphaned content. */
export function migratePendingStream(fromKey: string, toKey: string) {
  const pending = pendingStreams.get(fromKey);
  if (!pending) return;
  pendingStreams.delete(fromKey);
  const existing = pendingStreams.get(toKey);
  pendingStreams.set(
    toKey,
    existing
      ? { model: existing.model ?? pending.model, parts: [...existing.parts, ...pending.parts] }
      : pending,
  );
}

/** Append a live tool-call row. Buffered stream chunks are folded in first
 * so an interleaved "thinking → text → tool → text" turn keeps chronological
 * order, and the rows they grew settle — the next delta starts a fresh row
 * below the tool call. */
export function appendToolMessage<T extends BySessionSlice>(
  set: SetFn<T>,
  key: string,
  text: string,
  model: string | null,
  path: string | null = null,
  todos: TodosPayload | null = null,
  args?: unknown,
  patch = false,
  result?: unknown,
) {
  const pending = drainPending(key);
  set((s) => {
    const prev = s.bySession[key] ?? EMPTY_SESSION;
    let messages = pending
      ? applyStreamParts(prev.messages, pending.parts, pending.model ?? model)
      : prev.messages;
    messages = settleLiveRows(messages);
    // If this is a result patch, attach to the matching or latest tool message
    if (patch && result !== undefined) {
      const target = text
        ? messages.slice().reverse().find((m) => m.role === "tool" && (!text || m.text.includes(text)))
        : messages.slice().reverse().find((m) => m.role === "tool");
      if (target) {
        messages = messages.map((m) =>
          m.seq === target.seq ? { ...m, result } : m,
        );
      }
      return { bySession: { ...s.bySession, [key]: { ...prev, messages } } } as Partial<T>;
    }
    // Claude streams the tool name first, then patches args onto that row.
    // Match the oldest still-empty same-name tool so parallel Reads stay in
    // order. Unmatched patches are dropped — appending would duplicate.
    if (patch) {
      const target = messages.find(
        (m) => m.role === "tool" && m.text === text && m.args == null,
      );
      if (!target) {
        return { bySession: { ...s.bySession, [key]: { ...prev, messages } } } as Partial<T>;
      }
      messages = messages.map((m) =>
        m.seq === target.seq
          ? {
              ...m,
              path: path ?? m.path,
              ...(todos ? { todos } : {}),
              ...(args !== undefined ? { args } : {}),
              ...(result !== undefined ? { result } : {}),
            }
          : m,
      );
      return { bySession: { ...s.bySession, [key]: { ...prev, messages } } } as Partial<T>;
    }
    const seq = messages.length ? messages[messages.length - 1].seq + 1 : 1;
    messages = [
      ...messages,
      {
        role: "tool",
        text,
        path,
        ts: new Date().toISOString(),
        seq,
        ...(todos ? { todos } : {}),
        ...(args !== undefined ? { args } : {}),
        ...(result !== undefined ? { result } : {}),
      },
    ];
    return { bySession: { ...s.bySession, [key]: { ...prev, messages } } } as Partial<T>;
  });
}

export function patchSession<T extends BySessionSlice>(
  set: SetFn<T>,
  key: string,
  patch: Partial<SessionState>,
) {
  set((s) => ({
    bySession: {
      ...s.bySession,
      [key]: { ...(s.bySession[key] ?? EMPTY_SESSION), ...patch },
    },
  }) as Partial<T>);
}

export function flushPendingStreams<T extends BySessionSlice>(set: SetFn<T>) {
  if (pendingStreams.size === 0) return;
  set((s) => {
    const bySession = { ...s.bySession };
    for (const [key, pending] of pendingStreams) {
      const prev = bySession[key] ?? EMPTY_SESSION;
      bySession[key] = {
        ...prev,
        messages: applyStreamParts(prev.messages, pending.parts, pending.model),
      };
    }
    return { bySession } as Partial<T>;
  });
  pendingStreams.clear();
}

export function scheduleDeltaFlush<T extends BySessionSlice>(set: SetFn<T>) {
  // rAF stalls while the webview is occluded or the tab is backgrounded;
  // the timer guarantees buffered deltas still land within ~100ms. The
  // structural paths (tool row / done / error) drain the map directly, so a
  // late fallback flush is a harmless no-op.
  if (!fallbackScheduled) {
    fallbackScheduled = true;
    setTimeout(() => {
      fallbackScheduled = false;
      flushPendingStreams(set);
    }, 100);
  }
  if (rafScheduled) return;
  rafScheduled = true;
  requestAnimationFrame(() => {
    rafScheduled = false;
    flushPendingStreams(set);
  });
}

/** Write one session's streaming flag into the flat map ChatPage subscribes.
 * Reference-stable when the flag does not actually flip, so selectors keyed
 * on the map only re-render on real start/stop transitions. */
export function setStreamingFlag(
  rec: Record<string, true>,
  key: string,
  on: boolean,
): Record<string, true> {
  const has = rec[key] === true;
  if (has === on) return rec;
  const next = { ...rec };
  if (on) next[key] = true;
  else delete next[key];
  return next;
}

/** Carry the streaming flag across a session-key migration. */
export function moveStreamingFlag(
  rec: Record<string, true>,
  fromKey: string,
  toKey: string,
): Record<string, true> {
  if (rec[fromKey] !== true || fromKey === toKey) return rec;
  const next = { ...rec };
  delete next[fromKey];
  next[toKey] = true;
  return next;
}
