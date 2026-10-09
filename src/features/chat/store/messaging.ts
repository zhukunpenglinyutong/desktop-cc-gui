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
  findActiveRunForKey,
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
import { mergeUsage, parseUsage, reportedContextWindow } from "../usage";
import { getAutoCompactSettings, migrateAutoCompactSettings, nativeAutoCompactThreshold, usesNativeAutoCompact } from "../auto-compact-context";
import { recallContextWindow, resolveContextMax } from "../context-window-memory";
import {
  bindRunLifecycle,
  finishRunLifecycle,
  dropRunUsage,
  firstLineTitle,
  optimisticMeta,
  patchGrantBySeq,
  registerPendingRunLifecycle,
  replayBufferedEngineEvents,
  rememberModelForRun,
  rememberEffortForRun,
  patchQuestionByRequestId,
  rememberProviderForRun,
  settleOrphanedRuns,
  upsertSessionMetaInto,
} from "./engine-events";
import { ASK_OTHER_OPTION, askLoops, beginAskSubmit, revertAskSubmit } from "./ask-loop";
import { engineSupportsComputerUse } from "../computer-use";
import type { SendOptions } from "./types";
import { patchPlanReview } from "./plan-review";
import { effectivePermission } from "./permissions";
import {
  buildBotBlock,
  hasAgentBlock,
} from "../components/agent-block";
import {
  clearSelectedBot,
  freezeSelectedBotBlock,
  getSelectedBot,
  migrateSelectedBot,
} from "@/features/bots/selected-bot";
import { buildBotPromptBlock } from "@/features/bots/bot-block";
import { engineSupportsMemory } from "@/features/bots/memory";
import { botById } from "@/features/bots/bot-store";
import { assembleBotPrompt, builtInBotShell } from "@/features/bots/bot-prompt";
import { appendCommittedRows } from "./session-utils";
import {
  prepareSessionContributions,
  sessionContributionScope,
} from "./session-contributions";
import {
  adoptNativeContributions,
  sessionLifecycleBase,
  workspaceMetadata,
} from "./lifecycle";
import {
  collectBeforeTurnContributions,
  confirmPromptContributions,
  dispatchAfterSwitch,
  dispatchSessionCreated,
  dispatchTurnStarted,
  isInternalMessageCaptureActive,
  runBeforeSwitch,
} from "@/features/plugins/runtime/hooks";
import type { RuntimeSwitchEvent } from "@ccgui/plugin-sdk";
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

/** 会话 key：调用方给了目标就用它，否则回退到当前激活会话。
 *  分屏后每个格子都有自己的输入框与队列，不能再无脑用全局 active。 */
function keyOfTarget(
  target: ActiveSession | null | undefined,
  active: ActiveSession | null,
): string {
  const session = target ?? active;
  return session
    ? sessionKey(session.engine, session.sessionId, session.workspacePath)
    : "";
}

/** 已经算好 key 的调用点直接用 key，没给就回退到激活会话。 */
function resolveKey(key: string | undefined, active: ActiveSession | null): string {
  return key ?? keyOfTarget(null, active);
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
  | "respondToPlanReview"
  | "resumePlanReview"
  | "respondToQuestion"
  | "resendLastUser"
  | "queueMessage"
  | "removeQueued"
  | "moveQueued"
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
  // A replacement turn can reset the session's shared interrupted flag.
  // Keep cancellation attached to the send waiting on hooks or its ACK.
  const pendingSends = new Map<string, { cancelled: boolean }>();

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
    // A pinned bot's assembled prompt rides along as a tail block the
    // transcript keeps (the bubble strips it back out for display). Slash
    // prompts ("/compact") never get it, and a re-sent committed message
    // already carries its block, so re-injecting would duplicate it.
    //
    // The block is frozen on first send: the rest of this session reuses that
    // exact text, so editing the bot mid-conversation cannot change a prompt
    // the model has already been primed with (and the prefix cache holds).
    const selectedBot = getSelectedBot(tab.workspacePath, tab.sessionId);
    // 记忆工具每次发送都要重新挂载（每次发送都是一个新进程）；冻结的只是
    // 提示词。能挂的条件：选中了自定义 Bot、它开着记忆、这个引擎支持 MCP。
    const pinnedBot = selectedBot ? botById(selectedBot.id) : null;
    const memoryToolAvailable =
      pinnedBot !== null &&
      pinnedBot.memory.enabled !== false &&
      engineSupportsMemory(get().engines, tab.engine);
    // Built-in resolve failures are re-flagged after the optimistic-turn
    // patch below (which resets `error` for the new turn).
    let agentResolveError: string | null = null;
    if (selectedBot && !prompt.startsWith("/") && !hasAgentBlock(prompt)) {
      if (selectedBot.block) {
        prompt += `\n\n${selectedBot.block}`;
      } else if (selectedBot.source === "builtIn") {
        // Built-in picks store no prompt: resolve the current catalog prompt
        // at send time. A since-disabled catalog entry fails the resolve —
        // drop the stale pin, surface the session error banner, and still
        // send the bare text.
        try {
          const resolved = await ipc.resolveEnabledBuiltInAgent(selectedBot.id);
          const block = buildBotBlock({
            name: resolved.name,
            icon: resolved.icon ?? undefined,
            body: assembleBotPrompt({
              bot: builtInBotShell(resolved.name, resolved.prompt),
            }).text,
          });
          freezeSelectedBotBlock(tab.workspacePath, tab.sessionId, block);
          prompt += `\n\n${block}`;
        } catch {
          clearSelectedBot(tab.workspacePath, tab.sessionId);
          agentResolveError = i18n.t("chat.agentUnavailable");
        }
      } else {
        const bot = botById(selectedBot.id);
        if (bot) {
          const block = await buildBotPromptBlock(bot, { memoryToolAvailable });
          freezeSelectedBotBlock(tab.workspacePath, tab.sessionId, block);
          prompt += `\n\n${block}`;
        } else {
          // The bot was deleted between picking and sending. Say so instead
          // of silently sending a bare prompt the user did not ask for.
          clearSelectedBot(tab.workspacePath, tab.sessionId);
          agentResolveError = i18n.t("chat.botUnavailable");
        }
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
    // Optimistic user message.
    const workspace = workspaceMetadata(get().workspaces, tab.workspacePath);
    const hookRunId = newId();
    const previousSend = pendingSends.get(key);
    if (previousSend) previousSend.cancelled = true;
    const pendingSend = { cancelled: false };
    pendingSends.set(key, pendingSend);
    // Optimistic user message, right away: the hooks below can take up to
    // their timeout, and the turn must be visible (and stoppable) meanwhile.
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
        liveCompactRunId: null,
        interrupted: false,
        turnStartedAt: Date.now(),
        activeModel: model,
        activeEffort: effort,
        activeProvider: provider,
        // 电脑操控 is per-send opt-in (never sticky: a later ordinary
        // message must not silently regain machine control). The record only
        // feeds resendLastUser, which repeats this very message.
        activeComputerUse: options?.computerUse === true,
        // The tail indicator counts this reply, not the one before it.
        turnUsage: null,
        // The check belongs to this run: the launch event reopens it.
        responseCheck: null,
      },
    );
    // A pending switch prepares its handoff in beforeSwitch, which must run
    // before the turn's contributions are collected so the first target turn
    // carries the handoff (and not the second one).
    const pendingSwitch = get().pendingRuntimeSwitch;
    let switchEvent: RuntimeSwitchEvent | null = null;
    if (
      pendingSwitch &&
      pendingSwitch.targetEngine === engine &&
      pendingSwitch.workspacePath === tab.workspacePath
    ) {
      switchEvent = {
        switchId: hookRunId,
        sourceEngine: pendingSwitch.sourceEngine,
        targetEngine: pendingSwitch.targetEngine,
        sourceSessionId: pendingSwitch.sourceSessionId,
        targetSessionId: tab.sessionId,
        workspace,
        occurredAt: new Date().toISOString(),
      };
      await runBeforeSwitch(switchEvent);
      if (pendingSend.cancelled) return;
    }
    const scope = sessionContributionScope(engine, tab.sessionId, tab.workspacePath);
    const beforeTurn = await collectBeforeTurnContributions({
      runId: hookRunId,
      turnId: hookRunId,
      engine,
      sessionId: tab.sessionId,
      workspace,
      occurredAt: new Date().toISOString(),
    });
    if (pendingSend.cancelled) return;
    // Retire old owners and withdraw their native-history instructions once.
    const prepared = prepareSessionContributions(
      get().sessionContributions,
      scope,
      beforeTurn.promptContributions,
      tab.sessionId !== null,
    );
    if (prepared.next) set({ sessionContributions: prepared.next });
    const promptContributions = prepared.promptContributions;
    // Register the run lifecycle BEFORE the send: a fast engine's
    // session/delta/done events may outrun the send result, and unregistered
    // events would lose their runtime and afterTurn delivery.
    const settleLaunch = registerPendingRunLifecycle(hookRunId, {
      turnId: hookRunId,
      engine,
      sessionId: tab.sessionId,
      workspace,
      captures: beforeTurn.internalMessageCaptures.filter(isInternalMessageCaptureActive),
    });
    // Refresh independently: a slow history read must not delay sending or Stop.
    void get().refreshSessionUsage(key);
    // Stop and early events must address the same lifecycle registered above.
    const requestedRunId = hookRunId;
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
      // Read-only launch observation, after the lifecycle registration so a
      // fast engine's events cannot precede it, and before the send so the
      // hook sees the turn start rather than its result. Same turnId as
      // beforeTurn/afterTurn.
      dispatchTurnStarted({
        runId: hookRunId,
        turnId: hookRunId,
        engine,
        sessionId: tab.sessionId,
        workspace,
        occurredAt: new Date().toISOString(),
      });
      const autoSettings = getAutoCompactSettings(key);
      let autoCompactThresholdTokens: number | undefined;
      if (autoSettings.enabled && usesNativeAutoCompact(engine)) {
        const usage = get().bySession[key]?.usage;
        // Same source and priority as the gauge, including background tabs
        // whose catalog hook is not mounted. No probe when a report is known.
        const catalog = reportedContextWindow(usage) || recallContextWindow(engine, model)
          ? undefined
          : await ipc.listEngineModels(engine, tab.workspacePath).catch(() => undefined);
        if (pendingSend.cancelled) return;
        autoCompactThresholdTokens = nativeAutoCompactThreshold(engine, getAutoCompactSettings(key), resolveContextMax({
          usage: get().bySession[key]?.usage,
          engine,
          model,
          catalogWindow: catalog?.models.find((entry) => entry.id === model)?.contextWindow,
        }));
      }
      const result = await ipc.sendMessage({
        runId: requestedRunId,
        engine,
        workspacePath: tab.workspacePath,
        sessionId: tab.sessionId,
        prompt,
        promptContributions,
        nativeCompact: options?.nativeCompact === true,
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
        memoryBot: memoryToolAvailable ? pinnedBot.id : null,
        ...(autoCompactThresholdTokens !== undefined ? { autoCompactThresholdTokens } : {}),
      });
      confirmPromptContributions(promptContributions);
      if (switchEvent) {
        set((s) => ({
          pendingRuntimeSwitch:
            s.pendingRuntimeSwitch === pendingSwitch ? null : s.pendingRuntimeSwitch,
        }));
        dispatchAfterSwitch({ ...switchEvent, occurredAt: new Date().toISOString() });
      }
      // Rekey the pre-registered lifecycle to the real run id (a no-op when an
      // early event already bound it) and adopt the native session id.
      bindRunLifecycle(hookRunId, result.runId, result.sessionId ?? tab.sessionId);
      settleLaunch(result.sessionId ?? tab.sessionId);
      // Older backends choose their own id. Retire the provisional route.
      if (result.runId !== requestedRunId) {
        runRouting.delete(requestedRunId);
        untrackRun(requestedRunId);
      }
      // 宿主能力（插件轮次）靠这个钩子在 spawn 成功后拿到轮次身份；
      // 聊天发送不传，行为不变。
      options?.onStarted?.({ runId: result.runId, sessionId: result.sessionId ?? null });
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
        migrateSelectedBot(tab.workspacePath, result.sessionId);
        const newKey = sessionKey(
          engine,
          result.sessionId,
          tab.workspacePath,
        );
        adoptNativeContributions(set, engine, tab.workspacePath, result.sessionId);
        migrateAutoCompactSettings(key, newKey);
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
        const createdTab = { ...tab, sessionId: result.sessionId };
        const createdKey = sessionKey(engine, result.sessionId, tab.workspacePath);
        if (!get().createdSessionKeys[createdKey]) {
          set((s) => ({
            createdSessionKeys: { ...s.createdSessionKeys, [createdKey]: true },
          }));
          dispatchSessionCreated(sessionLifecycleBase(get, createdTab));
        }
      } else if (!runRouting.has(result.runId) && !settled && get().bySession[key]) {
        // The engine can announce its session id while the invoke is in
        // flight; onSession rekeys the run to the native key then, and
        // routing it back to the pre-send key would strand the live turn
        // there while the tab renders the native key. If the pending state
        // is already gone the turn migrated (and possibly settled): routing
        // the id back would resurrect a dead pending key on the next event.
        settleOrphanedRuns(set, routeRun(result.runId, key));
      }
      replayBufferedEngineEvents(result.runId, {
        set,
        get,
        drainQueue,
        markUnseenIfBackground,
        upsertSessionMeta: (meta) => upsertSessionMetaInto(set, meta),
        refreshSessionUsage: (sessionKey) => get().refreshSessionUsage(sessionKey),
      });
      // Stop can precede native spawn while invoke is still in flight; retry
      // the interrupt now that the backend has registered the child.
      // Session adoption may have moved the state, so read the live key.
      const liveKey = runRouting.get(result.runId) ?? knownKey ?? (
        result.sessionId && !tab.sessionId
          ? sessionKey(engine, result.sessionId, tab.workspacePath)
          : key);
      // Readiness can arrive before this acknowledgement resolves; a false
      // ACK (an older backend, or a run that already started its loop) must
      // not retire a capability the engine already confirmed.
      if (result.liveCompact === true && !pendingSend.cancelled &&
          !get().bySession[liveKey]?.interrupted &&
          get().streamingByKey[liveKey] && findActiveRunForKey(liveKey) === result.runId) {
        patchSession(set, liveKey, { liveCompactRunId: result.runId });
      }
      if (pendingSend.cancelled || get().bySession[liveKey]?.interrupted) {
        finishRunLifecycle(result.runId, "cancelled");
        patchSession(set, liveKey, { settledRunIds: rememberSettledRun(get().bySession[liveKey], result.runId) });
        runRouting.delete(result.runId);
        untrackRun(result.runId);
        dropRunUsage(result.runId);
        // A replacement may already own the same native session. Only the
        // immutable run id belongs to this late acknowledgement.
        await ipc.interruptSession(result.runId).catch(() => false);
      }
    } catch (error) {
      finishRunLifecycle(hookRunId, "failed", String(error));
      settleLaunch();
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
        liveCompactRunId: null,
        compaction: null,
      });
      // The send never became a turn, so no engine event will report one:
      // without this the rest of the queue waits for a settle that is not
      // coming. Each drain consumes one item, so a run of failures empties
      // the queue instead of looping.
      void get().refreshSessionUsage(failedKey);
      if (!get().bySession[failedKey]?.interrupted) drainQueue(failedKey);
    } finally {
      if (pendingSends.get(key) === pendingSend) pendingSends.delete(key);
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

  /** 按会话 key 中断：公共 `interrupt(target)` 与队列「立即发送」共用。
   *  key 而不是会话对象，是因为后台会话的排队项只有 key。 */
  async function interruptByKey(key: string) {
    // An in-flight send is awaiting plugin beforeTurn hooks: mark it cancelled
    // so its late launch does not start a run the user already stopped.
    const pendingSend = pendingSends.get(key);
    if (pendingSend) {
      pendingSend.cancelled = true;
      pendingSends.delete(key);
    }
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
            liveCompactRunId: null,
            compaction: null,
            retry: null,
          },
        },
        streamingByKey: setStreamingFlag(s.streamingByKey, key, false),
        retryingByKey: setRetryingFlag(s.retryingByKey, key, false),
      };
    });
    // Registry is keyed by native session id once known; before that the
    // run id routes. Try both.
    const sessionId = key.includes("/") ? key.slice(key.indexOf("/") + 1) : "";
    if (sessionId && !key.startsWith("new:"))
      await ipc.interruptSession(sessionId).catch(() => false);
    const deadRunIds: string[] = [];
    for (const [runId, routed] of runRouting) {
      if (routed === key) deadRunIds.push(runId);
    }
    // Independent kills, one IPC call per routed run — fired together.
    await Promise.all(
      deadRunIds.map((runId) => ipc.interruptSession(runId).catch(() => false)),
    );
    // The runs are dead: drop their routing and usage entries so the maps
    // cannot grow forever. (A late done event would also remove them.)
    for (const runId of deadRunIds) {
      // Plugins observing this turn must receive its cancelled terminal state;
      // without it a registered lifecycle never settles.
      finishRunLifecycle(runId, "cancelled");
      patchSession(set, key, {
        settledRunIds: rememberSettledRun(get().bySession[key], runId),
      });
      runRouting.delete(runId);
      untrackRun(runId);
      dropRunUsage(runId);
    }
    // Refresh without holding Stop: the read can take three loads with
    // backoff, and Stop must complete immediately (every other caller
    // fires and forgets).
    void get().refreshSessionUsage(key);
  }

  return {
    drainQueue,
    markUnseenIfBackground,

    send: async (prompt, images, options, target) => {
      const session = target === undefined ? get().active : target;
      if (session) await sendPrompt(session, prompt, images, options);
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

    respondToPlanReview: async (key, planId, expectedRevision, decision, feedback) => {
      const row = (get().bySession[key]?.messages ?? []).find(
        (m) =>
          m.planReview?.planId === planId &&
          m.planReview?.revision === expectedRevision,
      );
      const record = row?.planReview;
      // Only an open revision can be decided; anything else (already
      // submitted, settled, unknown) is a stale click the backend CAS would
      // reject anyway.
      if (
        !record ||
        (record.status !== "awaiting_review" && record.status !== "deferred")
      ) {
        return { kind: "error", error: i18n.t("chat.planReviewNotPending") };
      }
      const text = feedback?.trim() || undefined;
      if (decision === "request_changes" && !text) {
        return { kind: "error", error: i18n.t("chat.planReviewFeedbackRequired") };
      }
      if (decision !== "defer" && !record.complete) {
        return { kind: "error", error: i18n.t("chat.planReviewIncomplete") };
      }
      const revertTo = record.status;
      patchPlanReview(set, key, planId, expectedRevision, (cur) => ({
        ...cur,
        status: "submitting",
      }));
      try {
        const outcome = await ipc.respondPlanReview(
          planId,
          expectedRevision,
          decision,
          text,
        );
        // Applied or conflict, the returned record is the backend's truth:
        // a conflict replaces the card with the current state instead of
        // pretending the submit landed.
        patchPlanReview(set, key, planId, expectedRevision, () => outcome.review);
        // A landed decision closes a dock the user reopened from the card.
        if (get().bySession[key]?.planReviewResume === `${planId}:${expectedRevision}`) {
          patchSession(set, key, { planReviewResume: null });
        }
        return outcome.outcome === "applied"
          ? { kind: "applied", record: outcome.review }
          : { kind: "conflict", record: outcome.review };
      } catch (error) {
        // Never fake success: the card returns to its pre-submit status so
        // the user can retry (or the next settled event resolves it).
        patchPlanReview(set, key, planId, expectedRevision, (cur) =>
          cur.status === "submitting" ? { ...cur, status: revertTo } : cur,
        );
        return { kind: "error", error: errorText(error) };
      }
    },

    resumePlanReview: (key, resume) => {
      patchSession(set, key, { planReviewResume: resume });
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

    queueMessage: (text, images, options, target) => {
      const session = target === undefined ? get().active : target;
      if (!session || (!text.trim() && images.length === 0)) return;
      const key = sessionKey(
        session.engine,
        session.sessionId,
        session.workspacePath,
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

    removeQueued: (id, key) => {
      const targetKey = resolveKey(key, get().active);
      if (!targetKey) return;
      set((s) => {
        const prev = s.bySession[targetKey];
        if (!prev) return {};
        return {
          bySession: {
            ...s.bySession,
            [targetKey]: {
              ...prev,
              queue: prev.queue.filter((item) => item.id !== id),
            },
          },
        };
      });
    },
    /** Reorder one queued message a single step. The card paints newest
     *  first, so "up" walks the row toward the end of the send order (sent
     *  later) and "down" toward the head (sent sooner); a move past either
     *  end is a no-op. */
    moveQueued: (id, direction, key) => {
      const targetKey = resolveKey(key, get().active);
      if (!targetKey) return;
      set((s) => {
        const prev = s.bySession[targetKey];
        if (!prev) return {};
        const index = prev.queue.findIndex((item) => item.id === id);
        if (index < 0) return {};
        const target = direction === "up" ? index + 1 : index - 1;
        if (target < 0 || target >= prev.queue.length) return {};
        const queue = [...prev.queue];
        [queue[index], queue[target]] = [queue[target], queue[index]];
        return {
          bySession: {
            ...s.bySession,
            [targetKey]: { ...prev, queue },
          },
        };
      });
    },
    clearQueue: (key) => {
      const targetKey = resolveKey(key, get().active);
      if (!targetKey) return;
      set((s) => {
        const prev = s.bySession[targetKey];
        if (!prev || prev.queue.length === 0) return {};
        return {
          bySession: {
            ...s.bySession,
            [targetKey]: { ...prev, queue: [] },
          },
        };
      });
    },

    /** Jump the queue with one message. An engine takes one prompt at a time,
     *  so "now" means stopping the turn in flight; the row moves to the head
     *  and the stop's own park is lifted, so the exit drain sends this message
     *  instead of waiting the turn out. The rows behind it follow on the next
     *  settle. */
    sendQueuedNow: async (id, key) => {
      const targetKey = resolveKey(key, get().active);
      if (!targetKey) return;
      const session = get().bySession[targetKey];
      const item = session?.queue.find((entry) => entry.id === id);
      if (!item || !session) return;
      const running = session.streaming;
      set((s) => {
        const prev = s.bySession[targetKey] ?? EMPTY_SESSION;
        return {
          bySession: {
            ...s.bySession,
            [targetKey]: {
              ...prev,
              queue: [item, ...prev.queue.filter((entry) => entry.id !== id)],
              interrupted: false,
            },
          },
        };
      });
      if (running) await interruptByKey(targetKey);
      drainQueue(targetKey);
    },

    interrupt: async (target) => {
      const key = keyOfTarget(target === undefined ? get().active : target, null);
      if (!key) return;
      await interruptByKey(key);
    },

    compactContext: async (key?: string, options?: { trigger?: "manual" | "threshold" }) => {
      const { active, streamingByKey, openTabs } = get();
      const targetKey =
        key ??
        (active
          ? sessionKey(active.engine, active.sessionId, active.workspacePath)
          : "");
      if (!targetKey) return;
      const targetTab = openTabs.find(
        (t) => sessionKey(t.engine, t.sessionId, t.workspacePath) === targetKey,
      ) ?? (active && keyOfTarget(active, null) === targetKey ? active : null);
      if (!targetTab || get().bySession[targetKey]?.compaction) return;

      if (streamingByKey[targetKey]) {
        const runId = get().bySession[targetKey]?.liveCompactRunId;
        if (!runId || findActiveRunForKey(targetKey) !== runId) return;
        const compaction = {
          automatic: false,
          startedAt: Date.now(),
          trigger: options?.trigger ?? "manual" as const,
          runId,
        };
        patchSession(set, targetKey, { compaction });
        try {
          await ipc.compactActiveRun(runId);
        } catch (error) {
          // Rekey may happen during delivery; never clear a replacement run.
          const ownerKey = runRouting.get(runId) ?? targetKey;
          if (get().bySession[ownerKey]?.compaction === compaction) {
            patchSession(set, ownerKey, { compaction: null, error: errorText(error) });
          }
          throw error;
        }
        // ACK is not completion. OMP owns abort/resume; the correlated event
        // clears progress without a host continuation prompt.
        return;
      }

      // The tail status strip swaps its label for the whole run. `automatic`
      // stays false: this is a /compact turn we own, so the settle path below
      // (and the done/end handlers) clear it. The engine's own mid-turn
      // compaction events are the only producer of automatic: true, and they
      // must not take ownership of this flag. `trigger` records who asked.
      const compaction = {
        automatic: false,
        startedAt: Date.now(),
        trigger: options?.trigger ?? "manual" as const,
      };
      patchSession(set, targetKey, { compaction });

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
        await sendPrompt(targetTab, "/compact", [], { nativeCompact: true });
      } catch (error) {
        cleanup?.();
        if (get().bySession[targetKey]?.compaction === compaction) {
          patchSession(set, targetKey, { compaction: null });
        }
        throw error;
      }

      await completionPromise;
      // After compaction turn finishes, wait briefly for engine to persist session file,
      // then refresh session usage snapshot.
      const persisted = Promise.withResolvers<void>();
      setTimeout(persisted.resolve, 400);
      await persisted.promise;
      await get().refreshSessionUsage(targetKey);
      // The settle paths clear the flag as well; this covers the subscription
      // timing out while the run keeps streaming in the background — the
      // indicator then belongs to that turn, not to compaction.
      if (get().bySession[targetKey]?.compaction === compaction) {
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
