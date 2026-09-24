import { ipc } from "@/lib/ipc";
import { errorText } from "@/lib/errors";
import { newId } from "@/lib/id";
import i18n from "@/lib/i18n";
import {
  dedupeTabs,
  persistTabs,
  sessionKey,
  type ActiveSession,
} from "./persistence";
import {
  EMPTY_SESSION,
  applyStreamParts,
  drainPending,
  moveStreamingFlag,
  patchSession,
  resolveSessionModel,
  resolveSessionEffort,
  resolveSessionProvider,
  routeRun,
  rememberSettledRun,
  runRouting,
  setRetryingFlag,
  setStreamingFlag,
  settleLiveRows,
  untrackRun,
} from "./stream";
import { mergeUsage, parseUsage } from "../usage";
import {
  dropRunUsage,
  firstLineTitle,
  optimisticMeta,
  patchGrantBySeq,
  rememberModelForRun,
  rememberEffortForRun,
  patchQuestionByRequestId,
  rememberProviderForRun,
  settleOrphanedRuns,
  settleRunTasks,
  upsertSessionMetaInto,
} from "./engine-events";
import { ASK_OTHER_OPTION, askLoops, beginAskSubmit, revertAskSubmit } from "./ask-loop";
import { engineSupportsComputerUse } from "../computer-use";
import type { SendOptions } from "./types";
import { effectivePermission } from "./permissions";
import {
  buildAgentBlock,
  hasAgentBlock,
} from "../components/agent-block";
import {
  clearSelectedAgent,
  getSelectedAgent,
  migrateSelectedAgent,
} from "@/features/agents/selected-agent";
import { appendCommittedRows } from "./session-utils";
import type { ChatStore } from "./types";
import type {
  LoadHistoryPage,
  StoreGet,
  StoreSet,
  StoreSubscribe,
} from "./context";

/**
 * Messaging: sending prompts (optimistic turn, native-id adoption, queue
 * drain), the message queue, interrupt, grant/question replies, compaction,
 * and the post-turn usage refresh. drainQueue and markUnseenIfBackground are
 * returned alongside the actions — init wires them into engine-event handling.
 */

export interface MessagingDeps {
  set: StoreSet;
  get: StoreGet;
  loadHistoryPage: LoadHistoryPage;
  subscribe: StoreSubscribe;
}

/** The one answer value a question card sends. A multi-select pick arrives as
 * labels and travels as the text the CLI's free-form editor would have given. */
function answerText(answers: Record<string, string | string[]>): string {
  const value = Object.values(answers)[0];
  return Array.isArray(value) ? value.join(", ") : value ?? "";
}

export function createMessagingActions(
  deps: MessagingDeps,
): Pick<
  ChatStore,
  | "send"
  | "respondToGrant"
  | "respondToQuestion"
  | "resendLastUser"
  | "queueMessage"
  | "removeQueued"
  | "clearQueue"
  | "sendQueuedNow"
  | "interrupt"
  | "compactContext"
  | "refreshSessionUsage"
> & {
  /** After a turn ends, send the oldest queued message for that session. */
  drainQueue: (key: string) => void;
  /** Flag a finished background session for the sidebar's unseen dot. */
  markUnseenIfBackground: (key: string) => void;
} {
  const { set, get, loadHistoryPage, subscribe } = deps;

  /**
   * Send a prompt to a specific tab. Unlike the public `send` action this is
   * not bound to the active session, so the queue can drain on a background
   * tab after its turn finishes there.
   */
  async function sendPrompt(
    tab: ActiveSession,
    prompt: string,
    images: string[],
    options?: SendOptions,
  ) {
    if (!prompt.trim() && images.length === 0) return;
    // A pinned agent's instructions ride along as a tail block the
    // transcript keeps (the bubble strips it back out for display). Slash
    // prompts ("/compact") never get it, and a re-sent committed message
    // already carries its block, so re-injecting would duplicate it.
    const selectedAgent = getSelectedAgent(tab.workspacePath, tab.sessionId);
    // Built-in resolve failures are re-flagged after the optimistic-turn
    // patch below (which resets `error` for the new turn).
    let agentResolveError: string | null = null;
    if (selectedAgent && !prompt.startsWith("/") && !hasAgentBlock(prompt)) {
      // Built-in picks store no prompt: resolve the current catalog prompt
      // at send time. A since-disabled catalog entry fails the resolve —
      // drop the stale pin, surface the session error banner, and still
      // send the bare text.
      if (selectedAgent.source === "builtIn") {
        try {
          const resolved = await ipc.resolveEnabledBuiltInAgent(selectedAgent.id);
          prompt += buildAgentBlock({
            name: resolved.name,
            icon: resolved.icon ?? undefined,
            prompt: resolved.prompt,
          });
        } catch {
          clearSelectedAgent(tab.workspacePath, tab.sessionId);
          agentResolveError = i18n.t("chat.agentUnavailable");
        }
      } else if (selectedAgent.prompt) {
        prompt += buildAgentBlock({
          name: selectedAgent.name,
          icon: selectedAgent.icon,
          prompt: selectedAgent.prompt,
        });
      }
    }
    const engine = tab.engine;
    const key = sessionKey(engine, tab.sessionId, tab.workspacePath);
    // Computer use asks for the driver; engines without an MCP-mount path
    // would run the prompt text-only while the user believes the machine is
    // under agent control. Refuse loudly instead of downgrading silently.
    if (options?.computerUse && !engineSupportsComputerUse(get().engines, engine)) {
      patchSession(set, key, { error: i18n.t("chat.cuaUnsupportedEngine") });
      return;
    }
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
    const effort =
      resolveSessionEffort(tab, get().bySession[key], get().efforts[engine]) ??
      null;
    // Remember the level the way the model is remembered: the picker follows
    // the session, so a reopened session — here, in another window, or on the
    // phone — keeps running the level it ran instead of the engine default.
    if (effort) {
      if (tab.sessionId) {
        void ipc
          .rememberSessionEffort?.(engine, tab.sessionId, effort)
          ?.catch(() => {});
      } else {
        rememberEffortForRun(key, effort);
      }
    }
    const provider =
      resolveSessionProvider(
        tab,
        get().bySession[key],
        get().providers[engine],
      ) ?? null;
    if (provider) {
      if (tab.sessionId) {
        void ipc
          .rememberSessionProvider?.(engine, tab.sessionId, provider)
          ?.catch(() => {});
      } else {
        rememberProviderForRun(key, provider);
      }
    }
    // The run id exists before the optimistic write: the turn claims the
    // session for it (currentRunId), so an older run of this session that is
    // still streaming its completion turn cannot settle this turn's state
    // under it (see ownsTurn / isForeignContent).
    const requestedRunId = `run-${newId()}`;
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
        currentRunId: requestedRunId,
        // This send starts the session's new turn: any background wait
        // left over from the previous run no longer describes the phase.
        awaitingTasks: false,
        activeModel: model,
        activeEffort: effort,
        activeProvider: provider,
        // 电脑操控 is per-send opt-in (never sticky: a later ordinary
        // message must not silently regain machine control). The record only
        // feeds resendLastUser, which repeats this very message.
        activeComputerUse: options?.computerUse === true,
        // The tail indicator counts this reply, not the one before it.
        turnUsage: null,
      },
    );
    // Refresh independently: a slow history read must not delay sending or Stop.
    void get().refreshSessionUsage(key);
    settleOrphanedRuns(set, routeRun(requestedRunId, key));
    if (agentResolveError) {
      patchSession(set, key, { error: agentResolveError });
    }
    if (options?.computerUse) {
      // Arm the global Esc-to-stop for this run: the escape hatch out of a
      // machine-driving turn. Disarmed when the turn settles (onDone / a
      // failed spawn), so the system-wide hotkey never outlives the run.
      void ipc.computerUseSetActive?.(true)?.catch(() => {});
    }
    try {
      const result = await ipc.sendMessage({
        runId: requestedRunId,
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
        providerId: provider,
        computerUse: options?.computerUse === true,
      });
      // Older backends choose their own id. Retire the provisional route —
      // and with it the provisional claim: a claim whose run is no longer
      // routed to this session reads as no claim (see turnOwner), so the run
      // the backend actually started can still own and settle the turn.
      if (result.runId !== requestedRunId) {
        runRouting.delete(requestedRunId);
        untrackRun(requestedRunId);
      }
      // A whole turn can finish while invoke is still pending. Its session
      // event has then moved the state and done has removed the routing entry.
      const knownKey = runRouting.get(result.runId) ?? Object.keys(get().bySession).find(
        (candidate) => get().bySession[candidate]?.settledRunIds?.includes(result.runId),
      );
      const settled = knownKey && get().bySession[knownKey]?.settledRunIds?.includes(result.runId);
      // A turn that settled while invoke was pending still needs the adoption
      // when its session announcement never arrived (an older backend, or a
      // done that carried the id silently): without it the tab stays pending
      // forever and no one clears its streaming flag. If onSession already
      // migrated the state, bySession[key] is gone and this stays a no-op.
      const stillPending = get().bySession[key] !== undefined;
      if (result.sessionId && !tab.sessionId
          && (!settled || (knownKey && get().bySession[knownKey]?.interrupted) || stillPending)) {
        // Preassigned native id (grok): adopt immediately.
        migrateSelectedAgent(tab.workspacePath, result.sessionId);
        const newKey = sessionKey(
          engine,
          result.sessionId,
          tab.workspacePath,
        );
        if (model) {
          void ipc
            .rememberSessionModel?.(engine, result.sessionId, model)
            ?.catch(() => {});
        }
        if (effort) {
          void ipc
            .rememberSessionEffort?.(engine, result.sessionId, effort)
            ?.catch(() => {});
        }
        if (provider) {
          void ipc
            .rememberSessionProvider?.(engine, result.sessionId, provider)
            ?.catch(() => {});
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
              return { ...t, sessionId: result.sessionId, effort: undefined };
            }),
          );
          // Only the active tab adopts the native id on `active`; a
          // background drain leaves the user's current tab untouched.
          const active =
            s.active &&
            s.active.engine === engine &&
            s.active.sessionId === null &&
            s.active.workspacePath === tab.workspacePath
              ? { ...s.active, sessionId: result.sessionId, effort: undefined }
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
      } else if (!runRouting.has(result.runId) && !settled && get().bySession[key]) {
        // The engine can announce its session id while the invoke is in
        // flight; onSession rekeys the run to the native key then, and
        // routing it back to the pre-send key would strand the live turn
        // there while the tab renders the native key. If the pending state
        // is already gone the turn migrated (and possibly settled): routing
        // the id back would resurrect a dead pending key on the next event.
        settleOrphanedRuns(set, routeRun(result.runId, key));
      }
      // Stop can precede native spawn while invoke is still in flight.
      // Retry the interrupt now that the backend has registered the child.
      // A native id adopted
      // just above moved the state to a new key, so read the key the turn
      // actually lives under.
      const liveKey = runRouting.get(result.runId) ?? knownKey ?? (
        result.sessionId && !tab.sessionId
          ? sessionKey(engine, result.sessionId, tab.workspacePath)
          : key);
      if (get().bySession[liveKey]?.interrupted) {
        patchSession(set, liveKey, { settledRunIds: rememberSettledRun(get().bySession[liveKey], result.runId) });
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
      const failedKey = runRouting.get(requestedRunId) ?? key;
      runRouting.delete(requestedRunId);
      untrackRun(requestedRunId);
      dropRunUsage(requestedRunId);
      if (options?.computerUse) {
        void ipc.computerUseSetActive?.(false)?.catch(() => {});
      }
      set((s) => ({
        streamingByKey: setStreamingFlag(s.streamingByKey, failedKey, false),
      }));
      patchSession(set, failedKey, {
        error: String(error),
        streaming: false,
        turnStartedAt: null,
        // The send never became a turn: drop the claim it wrote.
        currentRunId: null,
      });
      // The send never became a turn, so no engine event will report one:
      // without this the rest of the queue waits for a settle that is not
      // coming. Each drain consumes one item, so a run of failures empties
      // the queue instead of looping.
      void get().refreshSessionUsage(failedKey);
      if (!get().bySession[failedKey]?.interrupted) drainQueue(failedKey);
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
    void sendPrompt(tab, head.text, head.images, {
      computerUse: head.computerUse,
    });
  }

  return {
    drainQueue,
    markUnseenIfBackground,

    send: async (prompt, images, options) => {
      const { active } = get();
      if (active) await sendPrompt(active, prompt, images, options);
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

    respondToQuestion: async (key, seq, answers) => {
      const message = get().bySession[key]?.messages.find((m) => m.seq === seq);
      const question = message?.question;
      if (
        !message ||
        message.role !== "question" ||
        !question ||
        question.status !== "pending"
      ) {
        return;
      }
      // A multi-select round is answered through the CLI's free-form row, whose
      // editor then carries the picked labels: replying to the select frame with
      // a label only toggles the CLI's own set and re-asks the same question.
      const loop = answers ? beginAskSubmit(key, seq, answerText(answers)) : undefined;
      try {
        await ipc.answerQuestion(
          question.runId,
          question.requestId,
          loop ? { [loop.base]: ASK_OTHER_OPTION } : answers,
        );
        patchQuestionByRequestId(set, key, question.requestId, (cur) => ({
          ...cur,
          status: answers ? ("answered" as const) : ("dismissed" as const),
          ...(answers ? { answers } : {}),
        }));
        // Skipping abandons the round: the CLI settles it as cancelled.
        if (!answers) askLoops.delete(key);
      } catch (error) {
        // The answer never reached the process (the run is gone): surface it;
        // a later question_settled event resolves the still-pending card.
        if (loop) revertAskSubmit(key, seq);
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
      if (tab)
        await sendPrompt(tab, lastUser.text, lastUser.images ?? [], {
          computerUse: s.bySession[key]?.activeComputerUse === true,
        });
    },

    queueMessage: (text, images, options) => {
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
                {
                  id: newId(),
                  text,
                  images,
                  queuedAt: Date.now(),
                  computerUse: options?.computerUse === true,
                },
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

    /** Jump the queue with one message. An engine takes one prompt at a time,
     *  so "now" means stopping the turn in flight; the row moves to the head
     *  and the stop's own park is lifted, so the exit drain sends this message
     *  instead of waiting the turn out. The rows behind it follow on the next
     *  settle. */
    sendQueuedNow: async (id) => {
      const { active } = get();
      if (!active) return;
      const key = sessionKey(
        active.engine,
        active.sessionId,
        active.workspacePath,
      );
      const session = get().bySession[key];
      const item = session?.queue.find((entry) => entry.id === id);
      if (!item || !session) return;
      const running = session.streaming;
      set((s) => {
        const prev = s.bySession[key] ?? EMPTY_SESSION;
        return {
          bySession: {
            ...s.bySession,
            [key]: {
              ...prev,
              queue: [item, ...prev.queue.filter((entry) => entry.id !== id)],
              interrupted: false,
            },
          },
        };
      });
      if (running) await get().interrupt();
      drainQueue(key);
    },

    interrupt: async () => {
      const { active } = get();
      if (!active) return;
      const key = sessionKey(
        active.engine,
        active.sessionId,
        active.workspacePath,
      );
      // This session's current runs: the ones Stop is about to kill, so no
      // task frame will ever report a terminal status for what they left
      // running. Read here — before the awaits below — because the settle
      // that follows must not catch a run started while Stop was in flight.
      const stoppedRunIds = [...runRouting]
        .filter(([, routed]) => routed === key)
        .map(([runId]) => runId);
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
        // A session that is (or was) waiting on background work has rows the
        // stop just killed; a plain streaming turn has nothing to settle.
        // `stopped`, not `interrupted`: the user asked for this stop, and the
        // store reserves 已中断 for a run that died without a notification.
        // Runs whose routing entry is already gone are out of this scope:
        // the orphan sweep settles whatever they left running.
        // backgroundActive excludes ambient tasks, so it alone would skip
        // the settle for a session whose only running rows are ambient —
        // those rows would spin forever (routing is deleted below and the
        // settledRunIds gate drops their late frames). Look at the stopped
        // runs' own rows instead.
        const stoppingTasks =
          cur.awaitingTasks ||
          cur.tasks.some((t) => stoppedRunIds.includes(t.runId) && t.status === "running");
        const tasks = stoppingTasks
          ? stoppedRunIds.reduce(
              (acc, runId) => settleRunTasks(acc, runId, "stopped"),
              cur.tasks,
            )
          : cur.tasks;
        return {
          bySession: {
            ...s.bySession,
            [key]: {
              ...cur,
              messages,
              streaming: false,
              interrupted: true,
              turnStartedAt: null,
              retry: null,
              // The stopped runs are settled: the session is unclaimed again,
              // so their late frames cannot read as a newer run's turn.
              currentRunId: null,
              // The wait ends with the work it waited for: without this the
              // tail indicator keeps claiming a task is running and the pill
              // keeps breathing over rows the user just stopped.
              ...(stoppingTasks
                ? {
                    tasks,
                    awaitingTasks: false,
                    // Same derivation as withTaskDerived: ambient tasks never
                    // drive the turn-level flag.
                    backgroundActive: tasks.some((t) => t.status === "running" && !t.ambient),
                  }
                : {}),
              // Mark the runs dead in this same write. The kill IPCs below can
              // take a while, and the last task frames of the dying process
              // arrive inside that window — still routed, with no done that
              // ever marked them settled. Without this the cleared wait above
              // would no longer shield them: adoptObservedRun would reopen the
              // turn (streaming true, composer queueing) for a process that is
              // already gone. Idempotent with the loop at the end of the stop.
              settledRunIds: stoppedRunIds.reduce(
                (acc, runId) => rememberSettledRun({ settledRunIds: acc }, runId),
                cur.settledRunIds ?? [],
              ),
            },
          },
          streamingByKey: setStreamingFlag(s.streamingByKey, key, false),
          retryingByKey: setRetryingFlag(s.retryingByKey, key, false),
        };
      });
      // Registry is keyed by native session id once known; before that the
      // run id routes. Try both.
      if (active.sessionId)
        await ipc.interruptSession(active.sessionId).catch(() => false);
      const deadRunIds: string[] = [];
      for (const [runId, routed] of runRouting) {
        // Intersect with the pre-kill snapshot: a run started while the kill
        // IPCs were in flight (Stop→Send race) is routed to this key but was
        // never asked to stop — killing and settling it here would strand its
        // streaming state and drop all its frames.
        if (routed === key && stoppedRunIds.includes(runId)) deadRunIds.push(runId);
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
        patchSession(set, key, { settledRunIds: rememberSettledRun(get().bySession[key], runId) });
        runRouting.delete(runId);
        untrackRun(runId);
        dropRunUsage(runId);
      }
      // Refresh without holding Stop: the read can take three loads with
      // backoff, and Stop must complete immediately (every other caller
      // fires and forgets).
      void get().refreshSessionUsage(key);
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

      // Manual-compaction flag: the tail status strip swaps to the compacting
      // label for the whole run. Cleared in the finally below.
      patchSession(set, targetKey, {
        compaction: { automatic: false, startedAt: Date.now() },
      });

      // Track the compaction turn completion so callers (and UI) can await it.
      let cleanup: (() => void) | undefined;
      const completionPromise = new Promise<void>((resolve) => {
        let started = false;
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        const unsub = subscribe(() => {
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
        patchSession(set, targetKey, { compaction: null });
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
      // The settle paths clear the flag as well; this covers the subscription
      // timing out while the run keeps streaming in the background — the
      // indicator then belongs to that turn, not to compaction.
      if (get().bySession[targetKey]?.compaction?.automatic === false) {
        patchSession(set, targetKey, { compaction: null });
      }
    },

    refreshSessionUsage: async (key?: string) => {
      const { active, openTabs } = get();
      const targetKey =
        key ??
        (active
          ? sessionKey(active.engine, active.sessionId, active.workspacePath)
          : "");
      if (!targetKey) return;
      // A background/closed tab must never fall back to the active session.
      const targetTab = openTabs.find(
        (t) => sessionKey(t.engine, t.sessionId, t.workspacePath) === targetKey,
      );
      const slashIdx = targetKey.indexOf("/");
      const engine = targetTab?.engine ?? targetKey.slice(0, slashIdx);
      const sessionId = targetTab?.sessionId ?? targetKey.slice(slashIdx + 1);
      if (targetKey.startsWith("new:") || slashIdx < 1 || !engine || !sessionId) return;
      const before = get().bySession[targetKey];
      if (!before) return;
      const beforeTotal = parseUsage(before.usage)?.total ?? null;

      try {
        // The engine flushes a turn's final usage into the transcript file a
        // moment after the settle event fires, so a read that still shows the
        // pre-turn snapshot is retried briefly instead of leaving the meter
        // stale. A read that resolves *behind* a newer live report is dropped
        // outright — live data wins and the file catches up on a later
        // refresh; patching it back would resurrect the stale totals and drop
        // the live context window.
        //
        // "Newer" is decided by object identity, not by comparing totals: a
        // claude result line carries the turn's *summed* billing (every
        // request of the turn added up), so the settled value is always
        // larger than the file's occupancy snapshot. A magnitude test would
        // therefore read every claude re-read as stale and leave the meter
        // parked on the sum, far past the window it is measured against.
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const page = await loadHistoryPage(
            engine,
            sessionId,
            targetTab?.workspacePath ?? "",
            100,
          );
          const latestUsage =
            [...page.messages].reverse().find((m) => m.usage)?.usage ?? null;
          if (!latestUsage) return;
          const current = get().bySession[targetKey]?.usage;
          // A report that landed while this read was in flight replaced the
          // usage object; anything else left it untouched (patches spread the
          // session and pass `usage` through by reference).
          if (current !== before.usage) return;
          const latestTotal = parseUsage(latestUsage)?.total ?? null;
          if (beforeTotal !== null && latestTotal === beforeTotal && attempt < 2) {
            const wait = Promise.withResolvers<void>();
            setTimeout(wait.resolve, 300);
            await wait.promise;
            continue;
          }
          // The transcript carries the API's per-message usage and no window;
          // only the live result line reports one. Keep the window already
          // known for this session so the gauge holds its scale.
          patchSession(set, targetKey, {
            usage: mergeUsage(latestUsage, current),
          });
          return;
        }
      } catch (error) {
        console.error("Failed to refresh session usage:", error);
      }
    },
  };
}
