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
  /** Computer-use send: the flag rides the queue so the drained turn still
   *  mounts the driver instead of silently running text-only. */
  computerUse?: boolean;
}

/** One background task of a run (claude task frames): a Workflow, a Task-tool
 *  subagent, or a background shell. `runId` groups tasks under their turn. */
export interface BackgroundTask {
  id: string;
  runId: string;
  taskType: string;
  description: string;
  subagentType?: string;
  workflowName?: string;
  isBackgrounded?: boolean;
  spawnDepth?: number;
  ambient?: boolean;
  /** `interrupted` = its run died without a terminal notification. */
  status: "running" | "completed" | "failed" | "stopped" | "interrupted";
  /** Live activity line ("<phase>: <agent>" / "Running Wait 590 seconds"). */
  progress?: string;
  lastTool?: string;
  usage?: unknown;
  startedAt: number;
  updatedAt: number;
}
export const EMPTY_TASKS: BackgroundTask[] = [];

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
  /** The run that owns the live turn of this session. Two runs of ONE session
   * can overlap — a reply settles with background tasks still running and the
   * user sends the next message before the CLI's completion turn arrives — and
   * the settling run must not write the session's turn-level state under the
   * newer run's feet. `null` = no claim: nothing is being attributed to a run
   * (idle, or a turn this client did not mark), so any run may own it. */
  currentRunId: string | null;
  activeModel?: string | null;
  activeEffort?: string | null;
  /** In-app channel this session runs; spawn injects its env. */
  activeProvider?: string | null;
  /** Whether the turn currently running was sent with 电脑操控; read by
   *  resendLastUser so a retry repeats the same kind of turn. */
  activeComputerUse?: boolean;
  /** Newest single report: the context meter reads occupancy from it. */
  usage: unknown;
  /** Running total of the reply in flight (sum of its reports), so the tail
   *  indicator counts this reply instead of showing one request's slice. */
  turnUsage: unknown;
  /** Bounded terminal-run history; late events must not revive a finished turn. */
  settledRunIds?: string[];
  error: string | null;
  /** Live provider-retry progress for the running turn ("重试中 2/5"). The
   * CLI is backing off and will re-issue the request, so this is progress,
   * not a failure: it clears on the next content event or when the turn
   * settles. `null` when nothing is being retried. */
  retry: { attempt: number; max: number; message: string } | null;
  /** Context compaction in progress: set by the composer compact action
   *  (manual) or by the engine's compaction events (automatic, omp rpc-ui).
   *  Cleared when the compact turn settles or the engine reports the end. */
  compaction: { automatic: boolean; startedAt: number } | null;
  /** Messages typed while a turn streams; sent FIFO when the turn ends. */
  queue: QueuedMessage[];
  /** Set by interrupt(): the next "done" settles the turn but must not
   * auto-drain the queue — pressing stop is not "go on to the next". */
  interrupted: boolean;
  /** Background tasks of this session, oldest first. Running tasks always
   *  survive the retention trim. */
  tasks: BackgroundTask[];
  /** A running task exists: drives the background indicator and the pill. */
  backgroundActive: boolean;
  /** The reply settled but its background tasks are still running: the turn
   *  reads as "运行中（后台任务）" and the CLI's completion turn may still
   *  arrive in this run. */
  awaitingTasks: boolean;
}

export const EMPTY_SESSION: SessionState = {
  messages: [],
  subagentHistory: [],
  nextBefore: null,
  loading: false,
  streaming: false,
  turnStartedAt: null,
  currentRunId: null,
  activeModel: null,
  activeEffort: null,
  activeProvider: null,
  usage: null,
  turnUsage: null,
  error: null,
  retry: null,
  compaction: null,
  queue: [],
  interrupted: false,
  tasks: EMPTY_TASKS,
  backgroundActive: false,
  awaitingTasks: false,
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

/** Append a terminal run identity. Takes just the field it reads so a caller
 *  can fold a list of runs before it has a session to write them to. */
export function rememberSettledRun(
  session: Pick<SessionState, "settledRunIds"> | undefined,
  runId: string,
): string[] {
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
  appendToolMessages(set, key, [{ text, path, todos, args, patch, result }], model);
}

export interface ToolMessageInput {
  text: string;
  path?: string | null;
  todos?: TodosPayload | null;
  args?: unknown;
  patch?: boolean;
  result?: unknown;
}

function sameToolValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  const pending: Array<[unknown, unknown]> = [[left, right]];
  const seen = new WeakMap<object, object>();
  while (pending.length) {
    const [current, incoming] = pending.pop()!;
    if (Object.is(current, incoming)) continue;
    if (!current || !incoming || typeof current !== "object" || typeof incoming !== "object") return false;
    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.getPrototypeOf(incoming)) return false;
    if (Array.isArray(current)) {
      if (current.length !== (incoming as unknown[]).length) return false;
    } else if (prototype !== Object.prototype && prototype !== null) {
      return false;
    }
    const previous = seen.get(current);
    if (previous) {
      if (previous !== incoming) return false;
      continue;
    }
    seen.set(current, incoming);
    const keys = Object.keys(current);
    if (keys.length !== Object.keys(incoming).length) return false;
    for (const key of keys) {
      if (!Object.hasOwn(incoming, key)) return false;
      pending.push([(current as Record<string, unknown>)[key], (incoming as Record<string, unknown>)[key]]);
    }
  }
  return true;
}

export function appendToolMessages<T extends BySessionSlice>(
  set: SetFn<T>,
  key: string,
  tools: ToolMessageInput[],
  model: string | null,
) {
  if (tools.length === 0) return;
  const pending = drainPending(key);
  set((s) => {
    const prev = s.bySession[key] ?? EMPTY_SESSION;
    let messages = pending
      ? applyStreamParts(prev.messages, pending.parts, pending.model ?? model)
      : prev.messages;
    messages = settleLiveRows(messages);
    const emptyTools = new Map<string, { indices: number[]; cursor: number }>();
    const indicesBySeq = new Map<number, number[]>();
    const toolIndices: number[] = [];
    const resultTargets = new Map<string, { scanned: number; index: number }>();
    const indexMessage = (message: Message, index: number) => {
      const indices = indicesBySeq.get(message.seq);
      if (indices) indices.push(index);
      else indicesBySeq.set(message.seq, [index]);
      if (message.role !== "tool") return;
      toolIndices.push(index);
      if (message.args == null) {
        const queue = emptyTools.get(message.text);
        if (queue) queue.indices.push(index);
        else emptyTools.set(message.text, { indices: [index], cursor: 0 });
      }
    };
    messages.forEach(indexMessage);
    const writable = () => {
      if (messages === prev.messages) messages = messages.slice();
    };
    for (const tool of tools) {
      const { text, path, todos, args, patch, result } = tool;
      if (!patch) {
        const message: Message = {
          role: "tool",
          text,
          path: path ?? null,
          ts: new Date().toISOString(),
          seq: messages.length ? messages[messages.length - 1].seq + 1 : 1,
          ...(todos ? { todos } : {}),
          ...(args !== undefined ? { args } : {}),
          ...(result !== undefined ? { result } : {}),
        };
        writable();
        indexMessage(message, messages.length);
        messages.push(message);
        continue;
      }
      let target = -1;
      if (result !== undefined) {
        const cached = resultTargets.get(text);
        target = cached?.index ?? -1;
        for (let offset = toolIndices.length - 1; offset >= (cached?.scanned ?? 0); offset--) {
          const index = toolIndices[offset];
          if (!text || messages[index].text.includes(text)) {
            target = index;
            break;
          }
        }
        resultTargets.set(text, { scanned: toolIndices.length, index: target });
      } else {
        const queue = emptyTools.get(text);
        if (queue) {
          while (queue.cursor < queue.indices.length && messages[queue.indices[queue.cursor]].args != null) {
            queue.cursor++;
          }
          target = queue.indices[queue.cursor] ?? -1;
        }
      }
      if (target < 0) continue;
      for (const index of indicesBySeq.get(messages[target].seq)!) {
        const message = messages[index];
        const patchFields = result !== undefined
          ? { result, ...(todos ? { todos } : {}) }
          : {
              path: path ?? message.path,
              ...(todos ? { todos } : {}),
              ...(args !== undefined ? { args } : {}),
            };
        if (Object.entries(patchFields).every(([field, value]) => sameToolValue(message[field as keyof Message], value))) continue;
        writable();
        messages[index] = { ...message, ...patchFields };
      }
    }
    if (messages === prev.messages) return s;
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

/** Write one session's retrying flag into the flat map consumed by the
 * sidebar. Reference-stable when the flag does not actually flip, so retry
 * progress never makes the sidebar subscribe to per-token session writes. */
export function setRetryingFlag(
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

/** Carry the retrying flag across a pending-to-native session-key migration. */
export function moveRetryingFlag(
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
