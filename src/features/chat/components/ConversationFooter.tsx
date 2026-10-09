import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Info from "lucide-react/dist/esm/icons/info";
import { CLI_DISPLAY_NAMES } from "@/components/foundations/icons/engine-brands";
import {
  Composer,
  StatusBar,
  type ComposerInputHandle,
} from "@/components/application/ai-chat/ai-chat-composer";
import { MessageQueue } from "@/components/application/ai-chat/message-queue";
import type { ContextSegment } from "@/components/application/agent-limits/agent-limits-card";
import type { BranchInfo, Workspace } from "@/lib/ipc";
import type { ActiveSession, QueuedMessage, QueueMoveDirection } from "../store";
import { useChatStore } from "../store";
import { ImageLightbox } from "@/components/base/image-lightbox";
import { imageMetaText } from "@/utils/image-meta";
import type { AttachmentPreview } from "./use-composer-images";
import { RunStatusStrip } from "./RunStatusStrip";
import { QuestionDock, usePendingQuestion } from "./QuestionDock";
import { PlanReviewDock, usePendingPlanReview } from "./PlanReviewDock";
import { ErrorBanner } from "./ErrorBanner";
import { sessionKey } from "../store";
import { ComposerSlotExtras } from "@/features/plugins/boundary/composer-slot-extras";
import { COMPOSER_DRAFT_TOPIC, pluginBus } from "@/features/plugins/runtime/events";
import { USAGE_PART_LABEL_KEYS, usageBreakdown } from "./usage-breakdown";
import { useComposerFileDrop } from "./use-composer-file-drop";
import {
  hasPendingUserInput,
  setAutoCompactEnabled,
  setAutoCompactThreshold,
  shouldAutoCompact,
  shouldResumeAfterAutoCompact,
  useAutoCompactSettings,
} from "../auto-compact-context";

/** Path → trailing name (folder or file) for status-bar and chip labels.
 *  Both separators: workspace/attachment paths are native — backslashes on
 *  Windows — matching fileName in features/files/store. */
function baseName(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return idx < 0 ? trimmed : trimmed.slice(idx + 1);
}

/** Composer attachment chip lightbox target: preview URL + display name. */
type ZoomImage = { src: string; name: string } | null;


/** One attachment chip: thumbnail + name button zooms the preview, × removes. */
function AttachmentChip({
  path,
  preview,
  onRemove,
  onZoom,
}: {
  path: string;
  preview: AttachmentPreview | undefined;
  onRemove: (path: string) => void;
  onZoom: (zoom: NonNullable<ZoomImage>) => void;
}) {
  const { t } = useTranslation();
  const name = preview?.name ?? baseName(path);
  const meta = preview ? imageMetaText(preview) : "";
  return (
    <span
      className="inline-flex items-center rounded-full bg-background-tertiary-default text-caption-1-medium text-text-secondary"
    >
      <button
        type="button"
        onClick={() =>
          preview && onZoom({ src: preview.url, name: preview.name })
        }
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-l-full py-0.5 pl-0.5"
        aria-label={name}
      >
        {preview && (
          <img
            src={preview.url}
            alt=""
            className="size-6 shrink-0 rounded-full object-cover"
          />
        )}
        <span className="max-w-48 truncate">{name}</span>
        {meta && (
          <span className="shrink-0 whitespace-nowrap text-text-tertiary">
            {meta}
          </span>
        )}
      </button>
      <button
        type="button"
        aria-label={t("common.close")}
        onClick={() => onRemove(path)}
        className="cursor-pointer rounded-r-full py-0.5 pr-2 pl-1 hover:text-text-primary"
      >
        ×
      </button>
    </span>
  );
}

/** Attachment chip row above the composer; hidden with no attachments. */
function AttachmentChips({
  images,
  previews,
  onRemoveImage,
  onZoomImage,
}: {
  images: string[];
  previews: Record<string, AttachmentPreview>;
  onRemoveImage: (path: string) => void;
  onZoomImage: (zoom: NonNullable<ZoomImage>) => void;
}) {
  if (images.length === 0) return null;
  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="flex flex-wrap gap-1.5">
        {images.map((path) => (
          <AttachmentChip
            key={path}
            path={path}
            preview={previews[path]}
            onRemove={onRemoveImage}
            onZoom={onZoomImage}
          />
        ))}
      </div>
    </div>
  );
}

/** Active session's run status; renders idle placeholders with no session. */
function ActiveRunStatus({ active }: { active: ActiveSession | null }) {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <RunStatusStrip
        sessionKey={active ? sessionKey(active.engine, active.sessionId, active.workspacePath) : ""}
        engine={active?.engine ?? ""}
        workspacePath={active?.workspacePath ?? ""}
      />
    </div>
  );
}

/** 工作区多目录:非 claude 引擎只用主目录的轻提示。仅在「激活工作区含附加根
 *  且当前引擎非 claude(仅 claude 会把附加根注入为可读写目录)」时出现;纯提示,
 *  不阻塞输入与发送(非 claude 仍照常只用主目录)。 */
function MultiRootEngineNotice({ workspacePath }: { workspacePath: string }) {
  const { t } = useTranslation();
  const extraRoots = useChatStore(
    (s) => s.workspaces.find((w) => w.path === workspacePath)?.roots?.length ?? 0,
  );
  const engine = useChatStore((s) => s.activeEngine);
  if (extraRoots === 0 || engine === "claude") return null;
  const engineName = CLI_DISPLAY_NAMES[engine] ?? engine;
  return (
    <div className="mx-auto w-full max-w-3xl">
      <div
        role="note"
        className="flex items-start gap-2 rounded-lg bg-background-secondary-default px-2.5 py-1.5 text-caption-1-regular text-text-secondary"
      >
        <Info aria-hidden className="mt-0.5 size-3.5 shrink-0 text-foreground-icon-tertiary" />
        <span>{t("chat.engineNoMultiRoot", { engine: engineName })}</span>
      </div>
    </div>
  );
}

/** Composer with its slot menus, disabled state, and image-paste wiring. */
function FooterComposer({
  active,
  draft,
  onDraftChange,
  onSubmit,
  sendShortcut,
  onStop,
  streaming,
  noEnabledEngines,
  images,
  composerInputRef,
  addMenu,
  cliMenu,
  permissionMenu,
  supportsImages,
  onPasteImages,
}: {
  active: ActiveSession | null;
  draft: string;
  onDraftChange: (value: string) => void;
  onSubmit: (value: string) => void;
  sendShortcut: string;
  onStop: () => void;
  streaming: boolean;
  noEnabledEngines: boolean;
  images: string[];
  composerInputRef: React.RefObject<ComposerInputHandle | null>;
  addMenu: ReactNode;
  cliMenu: ReactNode;
  permissionMenu: ReactNode;
  supportsImages: boolean;
  onPasteImages: (files: File[]) => void;
}) {
  return (
    <Composer
      className="mx-auto max-w-3xl"
      value={draft}
      onValueChange={onDraftChange}
      onSubmit={onSubmit}
      sendShortcut={sendShortcut === "cmdEnter" ? "cmdEnter" : "enter"}
      onStop={onStop}
      streaming={streaming}
      disabled={!active || noEnabledEngines || (!draft.trim() && images.length === 0)}
      inputRef={composerInputRef}
      addMenu={<>{addMenu}<ComposerSlotExtras slot="addMenu" /></>}
      cliMenu={<>{cliMenu}<ComposerSlotExtras slot="cliMenu" /></>}
      permissionMenu={<>{permissionMenu}<ComposerSlotExtras slot="permissionMenu" /></>}
      onPasteImages={supportsImages ? onPasteImages : undefined}
      workspacePath={active?.workspacePath}
    />
  );
}

/** Branch/folder/usage status bar under the composer. The quick-switch
 * folder chip mirrors the sidebar: archived workspaces stay hidden until
 * unarchived. */
function FooterStatusBar({
  active,
  streaming,
  workspaces,
  sessionUsage,
  contextMax,
  branch,
  branches,
  branchRepoName,
  onBranchSelect,
  startNewChat,
}: {
  active: ActiveSession | null;
  streaming: boolean;
  workspaces: Workspace[];
  sessionUsage: unknown;
  contextMax: number;
  branch: string | undefined;
  branches: BranchInfo[] | undefined;
  branchRepoName: string | undefined;
  onBranchSelect: (name: string) => void;
  startNewChat: (workspacePath: string) => void;
}) {
  const { t } = useTranslation();
  // Same denominator as the breakdown card (contextMax), so the ring pill
  // and the card never disagree.
  const usage = useMemo(
    () => usageBreakdown(sessionUsage, contextMax),
    [sessionUsage, contextMax],
  );
  const contextSegments: ContextSegment[] | undefined = useMemo(
    () =>
      usage?.parts.map((p) => ({
        label: t(USAGE_PART_LABEL_KEYS[p.kind]),
        tokens: p.tokens,
      })),
    [usage, t],
  );
  const archivedWorkspaces = useChatStore((s) => s.archivedWorkspaces);
  const compactContext = useChatStore((s) => s.compactContext);
  const refreshSessionUsage = useChatStore((s) => s.refreshSessionUsage);
  const [compacting, setCompacting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // 压缩/刷新按本格子的会话 key 发出：分屏时不能再落到全局 active 上。
  const sessionKeyValue = active
    ? sessionKey(active.engine, active.sessionId, active.workspacePath)
    : "";
  const autoCompact = useAutoCompactSettings(sessionKeyValue);
  const autoCompactLatch = useRef<{
    sessionKey: string;
    attemptedAtPct: number | null;
  }>({ sessionKey: "", attemptedAtPct: null });

  /** Hand the task back after a threshold compaction: the point of
   *  auto-compact is not having to type 「继续」 by hand. Manual clicks stay
   *  the user's own move, and a failed compaction / pressed stop / queued
   *  message / parked dialog all mean someone else owns what happens next
   *  (see shouldResumeAfterAutoCompact). */
  const resumeAfterAutoCompact = useCallback(
    (key: string) => {
      const state = useChatStore.getState();
      const session = state.bySession[key];
      // No active fallback: a closed tab means there is nothing to resume
      // into, and the fallback would send the nudge to a different session.
      const tab = state.openTabs.find(
        (t) => sessionKey(t.engine, t.sessionId, t.workspacePath) === key,
      );
      const shouldResume = shouldResumeAfterAutoCompact({
        trigger: "threshold",
        // A send clears the error up front, so anything set here came from
        // this very compaction attempt.
        errorAfter: session?.error ?? null,
        interrupted: session?.interrupted === true,
        streaming: session?.streaming === true,
        queued: session?.queue.length ?? 0,
        parked: hasPendingUserInput(session?.messages ?? []),
        sessionId: tab?.sessionId ?? null,
      });
      if (!shouldResume || !tab) return;
      void state
        .send(
          t("chat.autoCompactResume"),
          [],
          {},
          {
            engine: tab.engine,
            sessionId: tab.sessionId,
            workspacePath: tab.workspacePath,
          },
        )
        .catch(() => {});
    },
    [t],
  );

  const compactSession = useCallback(
    async (trigger: "manual" | "threshold") => {
      if (!sessionKeyValue || streaming || compacting) return;
      setCompacting(true);
      try {
        await compactContext(sessionKeyValue, { trigger });
        if (trigger === "threshold") {
          resumeAfterAutoCompact(sessionKeyValue);
        }
      } finally {
        setCompacting(false);
      }
    },
    [compactContext, compacting, resumeAfterAutoCompact, sessionKeyValue, streaming],
  );

  const handleCompact = useCallback(() => {
    if (usage?.pct !== undefined && usage.pct >= autoCompact.threshold) {
      autoCompactLatch.current = {
        sessionKey: sessionKeyValue,
        attemptedAtPct: usage.pct,
      };
    }
    void compactSession("manual").catch(() => {});
  }, [autoCompact.threshold, compactSession, sessionKeyValue, usage?.pct]);

  useEffect(() => {
    if (autoCompactLatch.current.sessionKey !== sessionKeyValue) {
      autoCompactLatch.current = { sessionKey: sessionKeyValue, attemptedAtPct: null };
    }

    const usagePct = usage?.pct;
    if (usagePct !== undefined && usagePct < autoCompact.threshold) {
      // Back under the threshold: the next upward crossing is a new event.
      autoCompactLatch.current.attemptedAtPct = null;
    }
    if (
      !sessionKeyValue ||
      !shouldAutoCompact({
        enabled: autoCompact.enabled,
        threshold: autoCompact.threshold,
        usagePct,
        streaming,
        compacting,
        attemptedAtPct: autoCompactLatch.current.attemptedAtPct,
      })
    ) {
      return;
    }

    // Arm at the level just tried: a retry needs the context to grow past it,
    // so a failed compaction (or one that left usage above the threshold)
    // neither spins nor disarms the session for good.
    autoCompactLatch.current.attemptedAtPct = usagePct ?? null;
    void compactSession("threshold").catch(() => {});
  }, [
    autoCompact.enabled,
    autoCompact.threshold,
    compactSession,
    compacting,
    sessionKeyValue,
    streaming,
    usage?.pct,
  ]);

  const handleRefresh = useCallback(async () => {
    if (!active || refreshing) return;
    setRefreshing(true);
    try {
      await refreshSessionUsage(sessionKeyValue);
    } finally {
      // No minimum-visible-busy delay here: the refresh button's feedback
      // finishes the spin lap (and checks) on its own.
      setRefreshing(false);
    }
  }, [active, refreshing, refreshSessionUsage, sessionKeyValue]);

  const visibleWorkspaces = useMemo(
    () => {
      const archivedIds = new Set(archivedWorkspaces);
      return workspaces.filter((w) => !archivedIds.has(w.id));
    },
    [workspaces, archivedWorkspaces],
  );
  const statusFolders = useMemo(() => visibleWorkspaces.map((w) => baseName(w.path)), [visibleWorkspaces]);
  const handleFolderSelect = useCallback(
    (name: string) => {
      const target = visibleWorkspaces.find((w) => baseName(w.path) === name);
      if (target) startNewChat(target.path);
    },
    [visibleWorkspaces, startNewChat],
  );

  return (
    <div className="mx-auto w-full max-w-3xl">
      <StatusBar
        branch={branch}
        branches={branches}
        branchRepoName={branchRepoName}
        onBranchSelect={onBranchSelect}
        folders={statusFolders}
        selectedFolder={active ? baseName(active.workspacePath) : undefined}
        onFolderSelect={handleFolderSelect}
        usagePct={usage?.pct}
        contextMax={contextMax}
        contextSegments={contextSegments}
        onCompactContext={handleCompact}
        onRefreshUsage={handleRefresh}
        compacting={compacting}
        refreshing={refreshing}
        canCompact={Boolean(active) && !streaming && !compacting}
        autoCompact={autoCompact}
        autoCompactDisabled={!sessionKeyValue}
        onAutoCompactEnabledChange={(enabled) => setAutoCompactEnabled(sessionKeyValue, enabled)}
        onAutoCompactThresholdChange={(threshold) => setAutoCompactThreshold(sessionKeyValue, threshold)}
      />
    </div>
  );
}

/** Attachment preview lightbox; hidden until a chip is clicked. */
function AttachmentLightbox({
  zoom,
  onClose,
}: {
  zoom: ZoomImage;
  onClose: () => void;
}) {
  if (!zoom) return null;
  return <ImageLightbox src={zoom.src} name={zoom.name} onClose={onClose} />;
}

/** Bottom column of the conversation: the message queue, error banners,
 * attachment chips, the composer, and the branch/folder/usage status bar. */
export function ConversationFooter({
  active,
  workspaces,
  queue,
  onRemoveQueued,
  onMoveQueued,
  onSendQueuedNow,
  onClearQueued,
  imageError,
  branchError,
  onDismissImageError,
  onDismissBranchError,
  images,
  previews,
  onRemoveImage,
  draft,
  onDraftChange,
  onSubmit,
  sendShortcut,
  onStop,
  streaming,
  noEnabledEngines,
  composerInputRef,
  addMenu,
  cliMenu,
  permissionMenu,
  supportsImages,
  onPasteImages,
  onDropPaths,
  onDropFiles,
  sessionUsage,
  contextMax,
  branch,
  branches,
  branchRepoName,
  onBranchSelect,
  startNewChat,
}: {
  active: ActiveSession | null;
  workspaces: Workspace[];
  queue: QueuedMessage[];
  onRemoveQueued: (id: string) => void;
  onMoveQueued: (id: string, direction: QueueMoveDirection) => void;
  onSendQueuedNow: (id: string) => void;
  onClearQueued?: () => void;
  imageError: string | null;
  branchError: string | null;
  onDismissImageError: () => void;
  onDismissBranchError: () => void;
  images: string[];
  previews: Record<string, AttachmentPreview>;
  onRemoveImage: (path: string) => void;
  draft: string;
  onDraftChange: (value: string) => void;
  onSubmit: (value: string) => void;
  sendShortcut: string;
  onStop: () => void;
  streaming: boolean;
  noEnabledEngines: boolean;
  composerInputRef: React.RefObject<ComposerInputHandle | null>;
  addMenu: ReactNode;
  cliMenu: ReactNode;
  permissionMenu: ReactNode;
  supportsImages: boolean;
  onPasteImages: (files: File[]) => void;
  /** OS files dropped on the composer (desktop: absolute paths). Absent =
   *  no active session: drops stay ignored. */
  onDropPaths?: (paths: string[]) => void;
  /** Web-bridge drop: image File blobs only (browsers expose no path). */
  onDropFiles?: (files: File[]) => void;
  sessionUsage: unknown;
  contextMax: number;
  branch: string | undefined;
  branches: BranchInfo[] | undefined;
  onBranchSelect: (name: string) => void;
  branchRepoName: string | undefined;
  startNewChat: (workspacePath: string) => void;
}) {
  /** Composer attachment chip lightbox: preview URL + display name. */
  const [zoomImage, setZoomImage] = useState<ZoomImage>(null);
  // While the CLI waits on an AskUserQuestion the panel takes the composer's
  // place — it covers the input box instead of floating beside it.
  const pendingQuestion = usePendingQuestion();
  // A plan revision awaiting the user's decision takes the same slot; the
  // backend serializes native waiting points, so at most one is pending.
  const pendingPlan = usePendingPlanReview();

  // The draft prop is the store's per-session value, so watching it covers
  // every change source at once: typing, submit-clear, and session switches
  // all re-emit with the latest text (empty string included).
  useEffect(() => {
    pluginBus.emit(COMPOSER_DRAFT_TOPIC, { text: draft });
  }, [draft]);

  const { t } = useTranslation();
  // OS file drop target: the whole footer column (chips + composer + status
  // bar). Images become attachments, other files @mentions at the caret.
  const { dropRef, isDragOver } = useComposerFileDrop({
    disabled: !onDropPaths,
    onDropPaths,
    onDropFiles,
  });

  return (
    <>
      <div
        ref={dropRef}
        className="relative flex w-full flex-col gap-2.5 bg-background-primary-default px-4 pt-2.5 pb-2"
      >
        {isDragOver && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-border-focus-ring bg-background-primary-default/85">
            <span className="text-body-medium text-text-secondary">
              {t("chat.dropFilesHint")}
            </span>
          </div>
        )}
        <MessageQueue queue={queue} onRemove={onRemoveQueued} onMove={onMoveQueued} onSendNow={onSendQueuedNow} onClear={onClearQueued} className="mx-auto w-full max-w-3xl" />
        <ErrorBanner message={imageError} onDismiss={onDismissImageError} />
        <ErrorBanner message={branchError} onDismiss={onDismissBranchError} />
        <AttachmentChips
          images={images}
          previews={previews}
          onRemoveImage={onRemoveImage}
          onZoomImage={setZoomImage}
        />
        <ActiveRunStatus active={active} />
        {active && <MultiRootEngineNotice workspacePath={active.workspacePath} />}
        {pendingPlan ? (
          <PlanReviewDock />
        ) : pendingQuestion ? (
          <QuestionDock />
        ) : (
          <FooterComposer
            active={active}
            draft={draft}
            onDraftChange={onDraftChange}
            onSubmit={onSubmit}
            sendShortcut={sendShortcut}
            onStop={onStop}
            streaming={streaming}
            noEnabledEngines={noEnabledEngines}
            images={images}
            composerInputRef={composerInputRef}
            addMenu={addMenu}
            cliMenu={cliMenu}
            permissionMenu={permissionMenu}
            supportsImages={supportsImages}
            onPasteImages={onPasteImages}
          />
        )}
        <FooterStatusBar
          active={active}
          streaming={streaming}
          workspaces={workspaces}
          sessionUsage={sessionUsage}
          contextMax={contextMax}
          branch={branch}
          branches={branches}
          branchRepoName={branchRepoName}
          onBranchSelect={onBranchSelect}
          startNewChat={startNewChat}
        />

      </div>
      <AttachmentLightbox zoom={zoomImage} onClose={() => setZoomImage(null)} />
    </>
  );
}
