import { memo, useCallback, useEffect, useMemo } from "react";
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

/** Message list with its own bySession subscription: stream flushes swap the
 * messages array once per animation frame, and this boundary keeps that
 * high-frequency re-render from reaching the composer/status bar above. */
const SessionTimeline = memo(function SessionTimeline({
  sessionKey: key,
  workspacePath,
  onLoadEarlier,
}: {
  sessionKey: string;
  workspacePath: string;
  onLoadEarlier: () => void;
}) {
  const session = useChatStore((s) => s.bySession[key]);
  if (!session) return null;
  return (
    <MessageTimeline
      key={key}
      session={session}
      streaming={session.streaming}
      onLoadEarlier={onLoadEarlier}
      workspacePath={workspacePath}
    />
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
  onLoadEarlier: () => void;
}) {
  const { t } = useTranslation();
  if (!active || !hasSession) {
    return <EmptyState className="text-body-medium">{t("chat.selectSession")}</EmptyState>;
  }
  return (
    <>
      {sessionError && (
        <ErrorBanner className="mx-4 mt-3" message={sessionError} onDismiss={onDismissError} />
      )}
      <SessionTimeline
        sessionKey={key}
        workspacePath={active.workspacePath}
        onLoadEarlier={onLoadEarlier}
      />
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

  const {
    images,
    previews,
    imageError,
    removeImage,
    clearImages,
    pasteImages,
    importImageFiles,
    dismissImageError,
  } = useComposerImages();

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
    () => void loadEarlier(key),
    [loadEarlier, key],
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
        onDismissError={() => dismissSessionError(key)}
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
