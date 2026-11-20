import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import type { ComposerInputHandle } from "@/components/application/ai-chat/ai-chat-composer";
import { AddMenu } from "@/components/application/ai-chat/add-menu";
import { PermissionMenu } from "@/components/application/ai-chat/permission-menu";
import type { ComposerPermission } from "@/components/application/ai-chat/permission-menu";
import {
  CliMenu,
  type EffortLevel,
  type ModelOption,
} from "@/components/application/ai-chat/cli-menu";
import {
  effectivePermission,
  useChatStore,
  sessionKey,
  type ActiveSession,
  type QueuedMessage,
  type QueueMoveDirection,
} from "../store";

import { MessageTimeline } from "./MessageTimeline";
import { clearSessionScrollSnapshot } from "./use-scroll-follow";
import { ConversationFooter } from "./ConversationFooter";
import { useComposerActions } from "./use-composer-actions";
import { filterEngineOptions, orderEngineOptions } from "./engine-options";
import { useCliNavOrder } from "@/lib/cli-nav-order";
import { ErrorBanner } from "./ErrorBanner";
import { useBranchSwitcher } from "./use-branch-switcher";
import { useComposerImages } from "./use-composer-images";
import { useEngineModels } from "./use-engine-models";
import { useTabModelDisplay } from "./use-tab-model-display";
import type { EngineInfo, Workspace } from "@/lib/ipc";
import type { OmpServiceTier } from "@/lib/omp-service-tier";
import { EmptyState } from "@/components/base/empty-state";
import { parseUsage } from "../usage";
import { rememberContextWindow, resolveContextMax } from "../context-window-memory";
import { useWorkspaceUIHooks, workspaceAllowedEngines } from "../workspace-ui-bridge";
import { ConversationModePane, ConversationModePicker } from "@/features/plugins/conversation/ConversationModeHost";
import { SessionScope } from "../split/session-scope";
import { usePlanReviewGateActive } from "./PlanReviewDock";
import { useConversationMode } from "@/features/plugins/conversation/use-conversation-mode";


const EMPTY_QUEUE: QueuedMessage[] = [];

/** Keep the most recently visited session timelines mounted (hidden via
 *  visibility:hidden on fixed absolute layers) so switching between recent tabs
 *  skips full DOM teardown/Markdown reparse and preserves native scrollTop.
 *  Closed tabs and entries beyond this cap unmount immediately to bound RAM. */
const MAX_KEPT_TIMELINES = 4;

interface KeptTimelineEntry {
  key: string;
  session: ActiveSession;
}

/** One session's message list with its own bySession subscription and frozen
 *  SessionScope: stream flushes stay inside this subtree, and hidden kept
 *  timelines never re-render when another tab becomes active. */
const KeptSessionTimeline = memo(function KeptSessionTimeline({
  entry,
  visible,
  onLoadEarlier,
}: {
  entry: KeptTimelineEntry;
  visible: boolean;
  onLoadEarlier: (sessionKey: string) => void;
}) {
  const session = useChatStore((s) => s.bySession[entry.key]);
  const handleLoadEarlier = useCallback(
    () => onLoadEarlier(entry.key),
    [onLoadEarlier, entry.key],
  );
  if (!session) return null;
  return (
    <SessionScope session={entry.session}>
      <div
        aria-hidden={!visible}
        className={
          visible
            ? "absolute inset-0 flex flex-col"
            : "invisible pointer-events-none absolute inset-0 flex flex-col"
        }
      >
        <MessageTimeline
          session={session}
          streaming={session.streaming}
          onLoadEarlier={handleLoadEarlier}
          workspacePath={entry.session.workspacePath}
          scrollMemoryKey={entry.key}
          visible={visible}
        />
      </div>
    </SessionScope>
  );
});

/** LRU stack of kept session timelines inside one conversation pane.
 *  DOM insertion order stays strictly monotonic — existing items are never
 *  reordered on activation, because React translates child reordering into
 *  appendChild/insertBefore which resets scrollTop to 0 in browsers. */
const SessionTimeline = memo(function SessionTimeline({
  active,
  activeKey,
  onLoadEarlier,
}: {
  active: ActiveSession | null;
  activeKey: string;
  onLoadEarlier: (sessionKey: string) => void;
}) {
  const openTabs = useChatStore((s) => s.openTabs);
  const lruTickRef = useRef(0);
  const lruRankRef = useRef(new Map<string, number>());
  const [kept, setKept] = useState<KeptTimelineEntry[]>(() =>
    active && activeKey ? [{ key: activeKey, session: active }] : [],
  );

  // Reconcile kept entries during render so newly activated tabs mount in the
  // same commit with no blank frame, while preserving relative DOM order.
  let nextKept = kept;
  const openKeys = new Set(
    openTabs.map((t) => sessionKey(t.engine, t.sessionId, t.workspacePath)),
  );
  const filtered = kept.filter(
    (entry) => entry.key === activeKey || openKeys.has(entry.key),
  );
  if (filtered.length !== kept.length) nextKept = filtered;

  if (active && activeKey) {
    const exists = nextKept.some((entry) => entry.key === activeKey);
    if (!exists) {
      let base = nextKept;
      if (base.length >= MAX_KEPT_TIMELINES) {
        let victimIdx = 0;
        let victimRank = Infinity;
        for (let i = 0; i < base.length; i += 1) {
          const rank = lruRankRef.current.get(base[i].key) ?? 0;
          if (rank < victimRank) {
            victimRank = rank;
            victimIdx = i;
          }
        }
        base = [...base.slice(0, victimIdx), ...base.slice(victimIdx + 1)];
      }
      nextKept = [...base, { key: activeKey, session: active }];
    }
  }

  if (nextKept !== kept) {
    setKept(nextKept);
  }

  // Record LRU recency for eviction and drop scroll snapshots only when a tab
  // is actually closed (LRU-evicted open tabs retain their scroll position).
  useLayoutEffect(() => {
    if (activeKey) {
      lruRankRef.current.set(activeKey, ++lruTickRef.current);
    }
    const open = new Set(
      openTabs.map((t) => sessionKey(t.engine, t.sessionId, t.workspacePath)),
    );
    for (const k of Array.from(lruRankRef.current.keys())) {
      if (k !== activeKey && !open.has(k)) {
        lruRankRef.current.delete(k);
        clearSessionScrollSnapshot(k);
      }
    }
  }, [activeKey, openTabs]);

  if (nextKept.length === 0) return null;
  return (
    <>
      {nextKept.map((entry) => (
        <KeptSessionTimeline
          key={entry.key}
          entry={entry}
          visible={entry.key === activeKey}
          onLoadEarlier={onLoadEarlier}
        />
      ))}
    </>
  );
});

/** Timeline (with the session error banner) for an open session, or the
 *  no-session placeholder. */
function ConversationBody({
  active,
  hasSession,
  sessionError,
  sessionKey: key,
  onDismissError,
  onLoadEarlier,
}: {
  active: ActiveSession | null;
  hasSession: boolean;
  sessionError: string | null;
  sessionKey: string;
  onDismissError: () => void;
  onLoadEarlier: (sessionKey: string) => void;
}) {
  const { t } = useTranslation();
  // 空态的前提有两种，文案不能混：一条工作区都还没有时，「新建会话」会先
  // 弹目录选择器（use-chat-sidebar 的 handleNewSession），所以这里缺的不是
  // 「选一个会话」而是「先有一个可归属的目录」——先说来缺什么。
  // Hook 必须在 early return 之前：这个组件在「没有会话」与「有会话」两种
  // 形态间来回切换，把订阅放到 return 之后会让 Hook 数量随 props 变化。
  const workspaceCount = useChatStore((s) => s.workspaces.length);
  const showTimeline = Boolean(active && hasSession);
  return (
    <>
      {showTimeline && sessionError && (
        <ErrorBanner className="mx-4 mt-3" message={sessionError} onDismiss={onDismissError} />
      )}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {!showTimeline && (
          <EmptyState className="text-body-medium">
            <div className="flex flex-col gap-1">
              <span>{workspaceCount === 0 ? t("chat.noWorkspaceYet") : t("chat.selectSession")}</span>
              {workspaceCount === 0 && (
                <span className="text-caption-1-regular text-text-tertiary">
                  {t("chat.noWorkspaceHint")}
                </span>
              )}
            </div>
          </EmptyState>
        )}
        <SessionTimeline
          active={showTimeline ? active : null}
          activeKey={showTimeline ? key : ""}
          onLoadEarlier={onLoadEarlier}
        />
      </div>
    </>
  );
}

/** Composer menu slots (add / CLI / permission) plus the all-engines-disabled
 * state, memoized so per-keystroke draft updates don't rebuild the menus. */
function useConversationMenus({
  engines,
  engineInfo,
  activeEngine,
  onPickFiles,
  onPickSkills,
  modelsByEngine,
  displayModels,
  displayEfforts,
  channelsByEngine,
  displayProviders,
  ompServiceTier,
  codexServiceTier,
  permission,
  setActiveEngine,
  setPermission,
  setModel,
  setEffort,
  setProvider,
  setOmpServiceTier,
  setCodexServiceTier,
  refreshModels,
  loadingEngines,
  allowedEngines,
}: {
  engines: EngineInfo[];
  engineInfo: EngineInfo | undefined;
  activeEngine: string;
  onPickFiles: () => void;
  /** "Skills" add-menu row: opens the composer's `/` command picker. */
  onPickSkills: () => void;
  modelsByEngine: Record<string, ModelOption[]>;
  displayModels: Record<string, string>;
  displayEfforts: Record<string, EffortLevel>;
  channelsByEngine: Record<string, { id: string; label: string }[]>;
  displayProviders: Record<string, string>;
  ompServiceTier: OmpServiceTier;
  codexServiceTier: OmpServiceTier;
  permission: ComposerPermission;
  setActiveEngine: (engine: string) => void;
  setPermission: (permission: ComposerPermission) => void;
  setModel: (engine: string, model: string) => Promise<void>;
  setEffort: (engine: string, effort: EffortLevel) => Promise<void>;
  setProvider: (engine: string, providerId: string) => Promise<void>;
  setOmpServiceTier: (tier: OmpServiceTier) => Promise<void>;
  setCodexServiceTier: (tier: OmpServiceTier) => Promise<void>;
  refreshModels: () => Promise<void>;
  loadingEngines: readonly string[];
  /** 接管工作区(桥返回非 null):仅列允许表内引擎(null = 不过滤)。 */
  allowedEngines: string[] | null;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // Disabled-in-settings CLIs leave the picker entirely. 接管工作区下:
  // 列表只留桥给的允许表,可用态按列表内与否而不是本机 `command -v` ——
  // 否则本机没装的 CLI 在接管工作区里永远灰点。
  // 顺序跟随设置页 CLI 管理栏的拖拽排序(同一份 localStorage);设置页里
  // 拖动时这里通过 useCliNavOrder 的 change 事件同步更新。
  const cliNavOrder = useCliNavOrder();
  const cliOptions = useMemo(
    () => orderEngineOptions(filterEngineOptions(engines, allowedEngines, t), cliNavOrder),
    [engines, allowedEngines, t, cliNavOrder],
  );
  // Every CLI is switched off in settings: swap the picker for a placeholder
  // that deep-links to the CLI config page.
  const noEnabledEngines = engines.length > 0 && cliOptions.length === 0;
  const handleModelChange = useCallback(
    (engine: string, m: string) => void setModel(engine, m),
    [setModel],
  );
  const handleEffortChange = useCallback(
    (engine: string, level: EffortLevel) => void setEffort(engine, level),
    [setEffort],
  );
  const handleChannelChange = useCallback(
    (engine: string, id: string) => void setProvider(engine, id),
    [setProvider],
  );


  // Files & folders works for every engine: non-image picks become @mentions
  // (plain text), and image picks on an engine without image input surface
  // the unsupported banner instead of being silently dropped — so the menu
  // stays enabled regardless of supportsImages.
  const addMenu = useMemo(
    () => <AddMenu onPickFiles={onPickFiles} onPickSkills={onPickSkills} />,
    [onPickFiles, onPickSkills],
  );
  const cliMenu = useMemo(
    () =>
      noEnabledEngines ? (
        <button
          type="button"
          onClick={() => navigate("/settings?page=cli:claude")}
          className="flex cursor-pointer items-center rounded-md px-1.5 py-1 text-body-2-medium whitespace-nowrap text-text-tertiary transition-colors duration-150 ease hover:text-text-primary"
        >
          {t("chat.noEngineEnabled")}
        </button>
      ) : (
        <CliMenu
          options={cliOptions}
          value={activeEngine}
          onChange={setActiveEngine}
          modelsByEngine={modelsByEngine}
          models={displayModels}
          onModelChange={handleModelChange}
          efforts={displayEfforts}
          onEffortChange={handleEffortChange}
          channelsByEngine={channelsByEngine}
          selectedChannels={displayProviders}
          onChannelChange={handleChannelChange}
          ompServiceTier={ompServiceTier}
          onOmpServiceTierChange={setOmpServiceTier}
          codexServiceTier={codexServiceTier}
          onCodexServiceTierChange={setCodexServiceTier}
          onRefreshModels={refreshModels}
          loadingEngines={loadingEngines}
        />
      ),
    [
      noEnabledEngines,
      navigate,
      t,
      cliOptions,
      activeEngine,
      setActiveEngine,
      modelsByEngine,
      displayModels,
      handleModelChange,
      displayEfforts,
      handleEffortChange,
      channelsByEngine,
      displayProviders,
      handleChannelChange,
      ompServiceTier,
      setOmpServiceTier,
      codexServiceTier,
      setCodexServiceTier,
      refreshModels,
      loadingEngines,
    ],
  );
  const permissionMenu = useMemo(
    () => (
      <PermissionMenu
        value={effectivePermission(engines, activeEngine, permission)}
        onChange={setPermission}
        supported={engineInfo?.permissions}
      />
    ),
    [engines, activeEngine, permission, setPermission, engineInfo],
  );

  return { addMenu, cliMenu, permissionMenu, noEnabledEngines };
}

/** Conversation column: timeline, message queue, composer, status bar. The
 * high-frequency session/draft subscriptions live here so streaming deltas
 * (one store write per animation frame) re-render only this subtree — never
 * the sidebar, tab strip, or side panel. */
export const ChatConversation = memo(function ChatConversation({
  active,
  engines,
  workspaces,
  startNewChat,
  composerInputRef,
}: {
  active: ActiveSession | null;
  engines: EngineInfo[];
  workspaces: Workspace[];
  startNewChat: (workspacePath: string) => void;
  composerInputRef: React.RefObject<ComposerInputHandle | null>;
}) {
  const { t, i18n } = useTranslation();
  const conversationMode = useConversationMode(active);
  // 互斥:计划等待中且 run 活跃时不得切入插件会话模式(会搁置原生等待点);
  // 插件模式激活时整个普通会话区(含计划 dock)本就不挂载。
  const planReviewGate = usePlanReviewGateActive();
  const key = active
    ? sessionKey(active.engine, active.sessionId, active.workspacePath)
    : "";
  // Key-scoped, LOW-frequency slices only: streaming flips at turn start/end,
  // queue/error/usage change on discrete actions. The per-flush messages
  // array is subscribed inside SessionTimeline so stream deltas re-render
  // only that subtree — never the composer, queue bar, or status bar here.
  const streaming = useChatStore((s) =>
    key ? (s.bySession[key]?.streaming ?? false) : false,
  );
  const sessionError = useChatStore((s) =>
    key ? (s.bySession[key]?.error ?? null) : null,
  );
  const dismissSessionError = useChatStore((s) => s.dismissSessionError);
  const queue = useChatStore((s) =>
    key ? (s.bySession[key]?.queue ?? EMPTY_QUEUE) : EMPTY_QUEUE,
  );
  const sessionUsage = useChatStore((s) =>
    key ? s.bySession[key]?.usage : undefined,
  );
  const hasSession = useChatStore((s) => key in s.bySession);
  const draft = useChatStore((s) => s.drafts[key] ?? "");
  const sendShortcut = useChatStore((s) => s.sendShortcut);
  // Engine/effort/model prefs: low-frequency, grouped into one shallow watch.
  const { activeEngine, efforts, models, providers, ompServiceTier, codexServiceTier } = useChatStore(
    useShallow((s) => ({
      activeEngine: s.activeEngine,
      efforts: s.efforts,
      ompServiceTier: s.ompServiceTier,
      codexServiceTier: s.codexServiceTier,
      models: s.models,
      providers: s.providers,
    })),
  );
  const {
    setActiveEngine,
    setEffort,
    setOmpServiceTier,
    setCodexServiceTier,
    setModel,
    setProvider,
    pinModels,
    loadEarlier,
    removeQueued,
    moveQueued,
    sendQueuedNow,
    clearQueue,
  } = useChatStore(
    useShallow((s) => ({
      setActiveEngine: s.setActiveEngine,
      setEffort: s.setEffort,
      setOmpServiceTier: s.setOmpServiceTier,
      setCodexServiceTier: s.setCodexServiceTier,
      setModel: s.setModel,
      setProvider: s.setProvider,
      pinModels: s.pinModels,
      loadEarlier: s.loadEarlier,
      removeQueued: s.removeQueued,
      moveQueued: s.moveQueued,
      sendQueuedNow: s.sendQueuedNow,
      clearQueue: s.clearQueue,
    })),
  );
  const {
    branch,
    branches,
    branchRepoName,
    branchError,
    handleBranchSelect,
    dismissBranchError,
  } = useBranchSwitcher(active);
  // Permission mode lives in the store (persisted) and flows into every
  // send; engines that cannot honor the selected mode fall back to their
  // first supported one, which is what the chip displays.
  const permission = useChatStore((s) => s.permission);
  const setPermission = useChatStore((s) => s.setPermission);

  // Session-scoped, exactly like the draft below: this component instance
  // outlives tab switches (SplitLayout swaps `active` on the same instance),
  // so attachments cannot live in its local state. With no tab open `key` is
  // the unbound "" — pasted pictures wait there for the first new chat.
  const {
    images,
    previews,
    imageError,
    removeImage,
    clearImages,
    pasteImages,
    importImageFiles,
    dismissImageError,
  } = useComposerImages(key);

  const { displayModels, displayEfforts, displayProviders } = useTabModelDisplay({
    active,
    activeEngine,
    sessionKey: key,
    models,
    efforts,
    providers,
  });

  const {
    catalogs,
    modelsByEngine,
    channelsByEngine,
    refresh: refreshModels,
    pendingEngines,
  } = useEngineModels(engines, models, pinModels, displayProviders, active?.workspacePath);
  const loadingEngines = useMemo(
    () => Object.keys(pendingEngines),
    [pendingEngines],
  );

  const displayModel = displayModels[activeEngine];
  // Conversation-reported window (Codex token_count, Claude's modelUsage)
  // wins; a fresh session starts from the last window this engine+model was
  // seen reporting; the model catalog is the fallback for engines that never
  // report one, and the shared constant is the last resort.
  const contextMax = resolveContextMax({
    usage: sessionUsage,
    engine: activeEngine,
    model: displayModel,
    catalogWindow: (catalogs[activeEngine]?.models ?? []).find(
      (m) => m.id === displayModel,
    )?.contextWindow,
  });
  const observedWindow = parseUsage(sessionUsage)?.contextWindow;
  useEffect(() => {
    if (observedWindow) {
      rememberContextWindow(activeEngine, displayModel, observedWindow);
    }
  }, [observedWindow, activeEngine, displayModel]);

  const engineInfo = engines.find((e) => e.id === activeEngine);
  const supportsImages = engineInfo?.supportsImages ?? false;

  const handleLoadEarlier = useCallback(
    (targetKey: string) => void loadEarlier(targetKey),
    [loadEarlier],
  );
  const handleDismissSessionError = useCallback(
    () => dismissSessionError(key),
    [dismissSessionError, key],
  );

  // 队列操作都按本栏的会话 key 发出：分屏后每格管自己的队列。
  const handleRemoveQueued = useCallback(
    (id: string) => removeQueued(id, key),
    [removeQueued, key],
  );
  const handleMoveQueued = useCallback(
    (id: string, direction: QueueMoveDirection) => moveQueued(id, direction, key),
    [moveQueued, key],
  );
  const handleSendQueuedNow = useCallback(
    (id: string) => void sendQueuedNow(id, key),
    [sendQueuedNow, key],
  );
  const handleClearQueue = useCallback(
    () => clearQueue(key),
    [clearQueue, key],
  );

  const {
    submit,
    handleDraftChange,
    handleAddAttachments,
    handleDroppedPaths,
    handleStop,
    handlePickSkills,
  } = useComposerActions({
    active,
    sessionKey: key,
    streaming,
    images,
    clearImages,
    importImageFiles,
    supportsImages,
    composerInputRef,
  });
  // 插件桥给出该工作区的引擎允许表(meta 形状留在插件侧,宿主不解释);
  // null = 非接管工作区,按本机探针展示。
  const uiHooks = useWorkspaceUIHooks();
  const allowedEngines = useMemo(
    // uiHooks 进依赖:插件 activate/热重载换 hooks 后允许表及时重算。
    () => workspaceAllowedEngines(active?.workspacePath),
    [uiHooks, active?.workspacePath],
  );
  const { addMenu, cliMenu, permissionMenu, noEnabledEngines } =
    useConversationMenus({
      engines,
      engineInfo,
      activeEngine,
      allowedEngines,
      modelsByEngine,
      onPickFiles: handleAddAttachments,
      onPickSkills: handlePickSkills,
      displayModels,
      displayEfforts,
      channelsByEngine,
      displayProviders,
      ompServiceTier,
      codexServiceTier,
      permission,
      setActiveEngine,
      setPermission,
      setModel,
      setEffort,
      setProvider,
      setOmpServiceTier,
      setCodexServiceTier,
      refreshModels,
      loadingEngines,
    });

  if (active && conversationMode.exitBlocked && !conversationMode.mode) {
    return <EmptyState className="text-body-medium">{t("plugins.conversationMode.recoveryRequired")}</EmptyState>;
  }

  if (active && conversationMode.mode) {
    return <ConversationModePane
      mode={conversationMode.mode}
      conversationId={conversationMode.conversationId}
      workspacePath={active.workspacePath}
      language={i18n.language}
      onExit={conversationMode.onExit}
    />;
  }

  return (
    <SessionScope session={active}>
      <ConversationBody
        active={active}
        hasSession={hasSession}
        sessionError={sessionError}
        sessionKey={key}
        onDismissError={handleDismissSessionError}
        onLoadEarlier={handleLoadEarlier}
      />

      <ConversationFooter
        active={active}
        workspaces={workspaces}
        queue={queue}
        onRemoveQueued={handleRemoveQueued}
        onMoveQueued={handleMoveQueued}
        onSendQueuedNow={handleSendQueuedNow}
        onClearQueued={handleClearQueue}
        imageError={imageError}
        branchError={branchError}
        onDismissImageError={dismissImageError}
        onDismissBranchError={dismissBranchError}
        images={images}
        previews={previews}
        onRemoveImage={removeImage}
        draft={draft}
        onDraftChange={handleDraftChange}
        onSubmit={submit}
        sendShortcut={sendShortcut}
        onStop={handleStop}
        streaming={streaming}
        noEnabledEngines={noEnabledEngines}
        composerInputRef={composerInputRef}
        addMenu={addMenu}
        cliMenu={<>{cliMenu}<ConversationModePicker disabled={!active || streaming || queue.length > 0 || planReviewGate} onSelect={conversationMode.onSelect} /></>}
        permissionMenu={permissionMenu}
        supportsImages={supportsImages}
        onPasteImages={pasteImages}
        onPastePaths={active ? handleDroppedPaths : undefined}
        onDropPaths={active ? handleDroppedPaths : undefined}
        onDropFiles={supportsImages ? pasteImages : undefined}
        sessionUsage={sessionUsage}
        contextMax={contextMax}
        branch={branch}
        branches={branches}
        branchRepoName={branchRepoName}
        onBranchSelect={handleBranchSelect}
        startNewChat={startNewChat}
      />

    </SessionScope>
  );
});
