"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import GitMerge from "lucide-react/dist/esm/icons/git-merge";
import Globe from "lucide-react/dist/esm/icons/globe";
import {
  Button as AriaButton,
  Dialog as AriaDialog,
  DialogTrigger as AriaDialogTrigger,
  Popover as AriaPopover,
} from "react-aria-components";
import {
  AgentLimitsCard,
  type ContextSegment,
  type UsageLimit,
} from "@/components/application/agent-limits/agent-limits-card";
import { Tooltip, TooltipContent } from "@/components/base/tooltip/tooltip";
import { ProjectFolderMenu } from "@/components/application/ai-chat/project-folder-menu";
import {
  BranchMenu,
  type BranchMenuItem,
} from "@/components/application/ai-chat/branch-menu";
import { ComposerResizeHandle } from "@/components/application/ai-chat/composer-resize-handle";
import { ComposerEditable } from "@/components/application/ai-chat/composer-editable";
import { ComposerToolbar } from "@/components/application/ai-chat/composer-toolbar";
import { ComposerPickerMenus } from "@/components/application/ai-chat/composer-picker-menus";
import { SelectedBotChip } from "@/components/application/ai-chat/composer-bot-chip";
import { useComposerPickers } from "@/components/application/ai-chat/use-composer-pickers";
import { useComposerInputHandle } from "@/components/application/ai-chat/use-composer-input-handle";
import { useResizableComposer } from "@/components/application/ai-chat/use-resizable-composer";
import {
  FILE_TAG_CLASS,
  extractText,
  htmlFromText,
  renderFileTags,
  sanitizeEditableHtml,
  setCaretOffset,
} from "@/components/application/ai-chat/file-tags";
import { ipc } from "@/lib/ipc";
import { listenSettingsChanged } from "@/lib/events";
import { useTauriEvent } from "@/hooks/use-tauri-event";
import { ASSUMED_CONTEXT_WINDOW } from "@/features/chat/usage";
import {
  usePromptCompletion,
  usePromptHistoryNav,
} from "@/components/application/ai-chat/use-prompt-history";
import { cx } from "@/utils/cx";
import { useDismissOnOutsidePress, useTriggerToggle } from "@/utils/use-dismiss-on-outside-press";
import {
  compareByOrder,
  composerStatusRegistry,
  pluginIdFromRegistryKey,
  useRegistry,
} from "@ccgui/plugin-sdk";
import { PluginBoundary } from "@/features/plugins/boundary/PluginBoundary";

/**
 * Board UI → "ai_chat" composer + status bar, adapted to live data. The pill
 * keeps the template visual (add menu, model menu, send control); the field
 * is a textarea so Shift+Enter inserts a newline; while a turn streams the
 * send button becomes a stop control. The status bar renders real branch /
 * workspace / token usage.
 */

/** Imperative handle on the composer's editable field. */
export interface ComposerInputHandle {
  focus: () => void;
  /** Insert plain text at the caret; `@/abs/path` mentions render as chips. */
  insertText: (text: string) => void;
  /** Focus the field and open the `/` picker, appending a line-start `/`
   *  when the caret is not already inside a slash trigger. */
  openSlashPicker: () => void;
}

export interface ComposerProps {
  className?: string;
  /** Controlled field value. */
  value?: string;
  onValueChange?: (value: string) => void;
  /** Fires on the send button and on the configured send gesture (sendShortcut). */
  onSubmit?: (value: string) => void;
  /** Send gesture: "enter" = Enter sends, Shift+Enter newline (default);
   *  "cmdEnter" = ⌘/Ctrl+Enter sends, plain Enter newline. */
  sendShortcut?: "enter" | "cmdEnter";
  /** Fires on the stop button while streaming. */
  onStop?: () => void;
  /** A turn is in flight: send becomes stop. */
  streaming?: boolean;
  /** Greys out send. */
  disabled?: boolean;
  /** Slot for the add-attachment menu (template AddMenu). */
  addMenu?: ReactNode;
  /** Slot for the CLI + model switcher (CliMenu). */
  cliMenu?: ReactNode;
  /** Slot for the permission-mode picker (PermissionMenu). */
  permissionMenu?: ReactNode;
  /** The field itself, for focus management and mention insertion. */
  inputRef?: MutableRefObject<ComposerInputHandle | null>;
  /** Clipboard images pasted into the field; absent = paste stays text-only. */
  onPasteImages?: (files: File[]) => void;
  /** Active workspace root: enables the `@` file-mention picker. */
  workspacePath?: string;
}

export function Composer({
  className,
  value,
  onValueChange,
  onSubmit,
  sendShortcut = "enter",
  onStop,
  streaming = false,
  disabled = false,
  addMenu,
  cliMenu,
  permissionMenu,
  inputRef,
  onPasteImages,
  workspacePath,
}: ComposerProps = {}) {
  const editableRef = useRef<HTMLDivElement>(null);
  // IME composition tracking (desktop-cc-gui parity): WKWebView fires
  // `compositionend` BEFORE the Enter keydown that commits the candidate, so
  // `nativeEvent.isComposing` is already false at that keydown and the plain
  // check would send the message. Gate Enter on a sync ref plus a 100ms
  // "recently settled" window after compositionend.
  const isComposingRef = useRef(false);
  const lastCompositionEndTimeRef = useRef(0);
  // Reactive mirror of isComposingRef: gates the ghost completion so IME
  // candidates never produce a suggestion.
  const [isComposing, setIsComposing] = useState(false);

  // Top-edge drag resize (desktop-cc-gui parity): the handle fixes the field
  // at an explicit height; without a manual size the field keeps auto-growing.
  const { isResizing, isCollapsed, manualHeightPx, getHandleProps, nudge } =
    useResizableComposer({ editableRef });

  /** Last text we emitted upward; the value-sync effect skips our own echoes. */
  const lastEmittedRef = useRef("");

  const emitChange = useCallback(() => {
    const el = editableRef.current;
    if (!el) return;
    // Keep the DOM truly empty when the text is, so the :empty placeholder
    // shows (browsers like to leave a stray <br> behind).
    const text = extractText(el);
    if (text === "" && el.innerHTML !== "") el.innerHTML = "";
    lastEmittedRef.current = text;
    onValueChange?.(text);
  }, [onValueChange]);

  const syncTags = useCallback(() => {
    const el = editableRef.current;
    if (el && !isComposingRef.current) renderFileTags(el);
  }, []);

  // `@` mention / `/` slash / `#` bot / `!` prompt pickers: trigger
  // tracking, priority arbitration, and select actions live in
  // useComposerPickers. The parent owns the wrapper ref (root div + popover
  // anchor).
  const wrapperRef = useRef<HTMLDivElement>(null);
  const pickers = useComposerPickers({
    editableRef,
    wrapperRef,
    workspacePath,
    value,
    lastEmittedRef,
    emitChange,
    syncTags,
  });
  const {
    mention,
    slash,
    bot,
    prompt,
    mentionMenuRef,
    slashMenuRef,
    botMenuRef,
    promptMenuRef,
    updateSlashTrigger,
    updateTriggers,
    selectedBot,
    clearSelectedBot,
  } = pickers;

  // Ghost-text completion from prompt history (desktop-cc-gui parity):
  // suffix is painted via data-completion-suffix and accepted with Tab.
  const completion = usePromptCompletion(isComposing ? "" : (value ?? ""));

  // Replace the field's content programmatically: rebuild DOM from text and
  // put the caret at its end. Shared by the external-value sync (draft
  // restore) and by history recall / Tab accept below.
  const replaceEditableText = useCallback((text: string) => {
    const el = editableRef.current;
    if (!el) return;
    el.innerHTML = sanitizeEditableHtml(htmlFromText(text));
    setCaretOffset(el, text.length);
  }, []);

  // Replace the field's content and emit upward (history recall, Tab accept).
  const setEditableText = useCallback(
    (text: string) => {
      replaceEditableText(text);
      emitChange();
      syncTags();
    },
    [replaceEditableText, emitChange, syncTags],
  );

  // ArrowUp/ArrowDown recall of previously submitted prompts.
  const { handleKeyDown: handleHistoryKeyDown } = usePromptHistoryNav({
    editableRef,
    setText: setEditableText,
  });

  // External value changes (draft restore on tab switch, clear on submit,
  // 插件中心「创建插件」预填命令): the effect below rebuilds the DOM from text;
  // the mention picker resets itself on the same signal (see useMentionPicker).
  // Own emissions are already in the DOM and skip both paths through
  // lastEmittedRef.
  //
  // 光标必须我们自己落位：DOM 一重建，浏览器手里的插入点就没了，随后的
  // focus()（例如 creator flow 的 focusComposerWhenVisible）会把光标放到
  // 内容开头。落到文本末尾，用户可以直接接着敲需求。
  useEffect(() => {
    const v = value ?? "";
    if (v === lastEmittedRef.current) return;
    lastEmittedRef.current = v;
    replaceEditableText(v);
  }, [value, replaceEditableText]);

  // Expose the field handle (focus + mention insertion from the file tree).
  useComposerInputHandle({
    inputRef,
    editableRef,
    emitChange,
    syncTags,
    updateSlashTrigger,
  });

  // Chip × removal via delegation (chips are raw DOM, not React).
  useEffect(() => {
    const el = editableRef.current;
    if (!el) return;
    const onClick = (event: MouseEvent) => {
      const close = (event.target as HTMLElement).closest?.(`.${FILE_TAG_CLASS}-close`);
      if (!close) return;
      event.preventDefault();
      event.stopPropagation();
      close.closest(`.${FILE_TAG_CLASS}`)?.remove();
      emitChange();
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, [emitChange]);

  return (
    <div
      ref={wrapperRef}
      className={cx(
        "relative flex w-full flex-col gap-1 rounded-2xl border p-2 shadow-xs",
        isCollapsed
          ? "h-2 gap-0 border-transparent bg-transparent p-0 shadow-none"
          : "border-separator-border bg-background-primary-default",
        className,
      )}
    >
      <ComposerResizeHandle
        getHandleProps={getHandleProps}
        nudge={nudge}
        isResizing={isResizing}
        isCollapsed={isCollapsed}
      />
      <ComposerPickerMenus
        isCollapsed={isCollapsed}
        workspacePath={workspacePath}
        pickers={pickers}
      />

      {/* Pinned-bot chip above the input, styled after the attachment
          chips (ConversationFooter); × clears the selection. */}
      {!isCollapsed && selectedBot && (
        <SelectedBotChip bot={selectedBot} onClear={clearSelectedBot} />
      )}

      {!isCollapsed && (
        <ComposerEditable
          editableRef={editableRef}
          sendShortcut={sendShortcut}
          mentionOpen={mention != null}
          slashOpen={slash != null}
          botOpen={bot != null}
          promptOpen={prompt != null}
          completionSuffix={completion.suffix}
          acceptCompletion={completion.accept}
          setEditableText={setEditableText}
          handleHistoryKeyDown={handleHistoryKeyDown}
          mentionMenuRef={mentionMenuRef}
          slashMenuRef={slashMenuRef}
          botMenuRef={botMenuRef}
          promptMenuRef={promptMenuRef}
          isComposingRef={isComposingRef}
          lastCompositionEndTimeRef={lastCompositionEndTimeRef}
          setIsComposing={setIsComposing}
          emitChange={emitChange}
          syncTags={syncTags}
          updateTriggers={updateTriggers}
          disabled={disabled}
          onSubmit={onSubmit}
          onPasteImages={onPasteImages}
          manualHeightPx={manualHeightPx}
        />
      )}

      {!isCollapsed && (
        <ComposerToolbar
          addMenu={addMenu}
          cliMenu={cliMenu}
          permissionMenu={permissionMenu}
          streaming={streaming}
          disabled={disabled}
          onStop={onStop}
          onSend={() => onSubmit?.(value ?? "")}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------- status bar */
const CONTEXT_POPOVER_CLASSES = cx(
  "w-[340px] max-w-[calc(100vw-32px)] origin-bottom-right",
  "rounded-2xl border border-border-button-default bg-background-primary-default p-2 shadow-dropdown",
  "transition duration-150 ease-out",
  "data-[entering]:opacity-0 data-[entering]:scale-95 data-[entering]:blur-[2px]",
  "data-[exiting]:opacity-0 data-[exiting]:scale-95 data-[exiting]:blur-[2px]",
);

const EMPTY_LIMITS: UsageLimit[] = [];
const EMPTY_PLAN = "";

/**
 * Mirrors `validate_proxy_settings` in src-tauri/src/proxy.rs: enabling the
 * proxy requires a configured URL with an http(s)/socks5 scheme and a host.
 * Disabling never fails validation, so an enabled toggle stays operable even
 * if the stored URL is later broken.
 */
function isUsableProxyUrl(value: string | null): boolean {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return false;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  const scheme = parsed.protocol.replace(":", "");
  return (
    ["http", "https", "socks5", "socks5h"].includes(scheme) &&
    parsed.hostname.length > 0
  );
}

type ProxyQuickToggleState = { enabled: boolean; url: string | null };

/** Decide whether an unconfigured footer glyph should open proxy settings. */
export function getProxyQuickToggleAction(state: ProxyQuickToggleState): "settings" | "toggle" {
  if (!state.enabled && !isUsableProxyUrl(state.url)) return "settings";
  return "toggle";
}

/**
 * One-click network-proxy switch for the composer footer: the glyph carries
 * the state (dim = off, green = on) and the click persists `systemProxyEnabled`
 * through the same read-modify-write funnel the settings page uses, so the two
 * surfaces can never clobber each other.
 *
 * When off without a usable proxy URL, clicking the visible glyph opens the
 * proxy settings instead of attempting an invalid enable operation.
 */
function ProxyQuickToggle() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [state, setState] = useState<ProxyQuickToggleState | null>(null);
  const [busy, setBusy] = useState(false);

  const read = useCallback(() => {
    void ipc
      .getAppSettings()
      .then((s) =>
        setState({ enabled: s.systemProxyEnabled ?? false, url: s.systemProxyUrl ?? null }),
      )
      .catch(() => {});
  }, []);

  useEffect(() => read(), [read]);
  // The settings page (desktop or phone) writes the same field.
  useTauriEvent(() => listenSettingsChanged(read));

  const toggle = useCallback(async () => {
    if (busy || !state) return;
    if (getProxyQuickToggleAction(state) === "settings") {
      navigate("/settings?page=proxy");
      return;
    }
    setBusy(true);
    try {
      const latest = await ipc.getAppSettings();
      const next = !(latest.systemProxyEnabled ?? false);
      await ipc.updateAppSettings({ ...latest, systemProxyEnabled: next });
      setState({ enabled: next, url: latest.systemProxyUrl ?? null });
    } catch {
      // Persist failed: keep the old glyph, the settings page is where the
      // reason is shown.
    } finally {
      setBusy(false);
    }
  }, [busy, navigate, state]);

  if (!state) return null;
  const { enabled } = state;
  const action = getProxyQuickToggleAction(state);
  const label =
    action === "settings" ? t("chat.proxyConfigure") : enabled ? t("chat.proxyOn") : t("chat.proxyOff");
  const tip =
    action === "settings"
      ? t("chat.proxyTipConfigure")
      : enabled
        ? t("chat.proxyTipOn")
        : t("chat.proxyTipOff");
  // Mirror the context-meter button exactly: react-aria AriaButton, the same
  // shape/focus classes, colour carries the state. That control never shows
  // a stray circle, so this one should not either.
  return (
    <Tooltip>
      <AriaButton
        aria-label={label}
        aria-pressed={action === "toggle" ? enabled : undefined}
        isDisabled={busy}
        onPress={() => void toggle()}
        className={cx(
          "flex cursor-pointer items-center rounded-full p-1.5 outline-none transition-colors duration-150 ease focus-visible:ring-2 focus-visible:ring-border-focus-ring",
          enabled ? "text-notification-success-foreground" : "text-foreground-icon-tertiary",
        )}
      >
        <Globe className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
      </AriaButton>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}

/** 16px circular context meter at `pct` percent. */
function ContextRing({ pct }: { pct: number }) {
  const r = 6;
  const c = 2 * Math.PI * r;
  return (
    <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" className="shrink-0 -rotate-90">
      <circle cx="8" cy="8" r={r} fill="none" stroke="var(--color-agent-progress-ring)" strokeWidth="2.5" />
      <circle
        cx="8"
        cy="8"
        r={r}
        fill="none"
        stroke="var(--color-foreground-icon-tertiary)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={`${(pct / 100) * c} ${c}`}
      />
    </svg>
  );
}

export function StatusBar({
  branch,
  branches,
  branchRepoName,
  onBranchSelect,
  folders,
  selectedFolder,
  onFolderSelect,
  usagePct,
  contextMax,
  contextSegments,
  onCompactContext,
  onRefreshUsage,
  compacting,
  refreshing,
  canCompact,
}: {
  branch?: string;
  /** Local and remote-tracking branches for the switcher; empty until the
   *  first load. */
  branches?: BranchMenuItem[];
  /** Repository display name when the chip tracks a nested repo (file-tree
   *  selection inside a subfolder repository); prefixes the branch label. */
  branchRepoName?: string;
  /** Present → the branch label becomes a switcher dropdown. */
  onBranchSelect?: (name: string) => void;
  /** Workspace folder display names. */
  folders?: string[];
  selectedFolder?: string;
  onFolderSelect?: (name: string) => void;
  usagePct?: number;
  /** Context window size in tokens for the breakdown card. */
  contextMax?: number;
  /** Token buckets for the breakdown card; empty until usage is reported. */
  contextSegments?: ContextSegment[];
  onCompactContext?: () => void;
  onRefreshUsage?: () => void;
  compacting?: boolean;
  refreshing?: boolean;
  canCompact?: boolean;
}) {
  const { t } = useTranslation();
  // `isNonModal` popovers don't dismiss on outside press (react-aria couples
  // the two); restore it manually — same fix as Select (see the hook doc).
  const [contextOpen, setContextOpen] = useState(false);
  const contextTriggerRef = useRef<HTMLButtonElement>(null);
  const contextPopoverRef = useRef<HTMLElement>(null);
  useDismissOnOutsidePress(contextOpen, () => setContextOpen(false), [
    contextTriggerRef,
    contextPopoverRef,
  ]);
  const allowContextOpenChange = useTriggerToggle(contextOpen, contextTriggerRef);
  // Plugin chips (SDK 0.3.9, permission ui:composer-status) render in the
  // left group after the branch switcher, each behind its own boundary.
  const pluginItems = useRegistry(composerStatusRegistry);
  const limitsContext = useMemo(
    () => ({ max: contextMax ?? ASSUMED_CONTEXT_WINDOW, segments: contextSegments ?? [] }),
    [contextMax, contextSegments],
  );
  const limitsText = useMemo(
    () => ({
      contextWindow: t("chat.contextWindow"),
      freeSpace: t("chat.freeSpace"),
      planUsageLimits: t("chat.planUsageLimits"),
      managePlan: t("chat.managePlan"),
      compactContext: t("chat.compactContext"),
      compactContextTooltip: t("chat.compactContextTooltip"),
      compacting: t("chat.compacting"),
      refreshUsage: t("chat.refreshUsage"),
      refreshUsageTooltip: t("chat.refreshUsageTooltip"),
      refreshing: t("chat.refreshing"),
    }),
    [t],
  );
  return (
    <div className="flex h-[26px] w-full items-center justify-between select-none">
      <div className="flex items-center gap-3">
        {folders && folders.length > 0 && (
          <ProjectFolderMenu
            folders={folders}
            selectedName={selectedFolder}
            onSelect={onFolderSelect}
          />
        )}
        {branch &&
          (onBranchSelect ? (
            <BranchMenu
              branches={branches ?? []}
              currentName={branch}
              repoName={branchRepoName}
              onSelect={onBranchSelect}
            />
          ) : (
            <span className="flex items-center gap-1">
              <GitMerge
                className="size-3.5 shrink-0 -scale-y-100 text-foreground-icon-tertiary"
                aria-hidden
              />
              <span className="text-caption-1-regular whitespace-nowrap text-text-tertiary">
                {branch}
              </span>
            </span>
          ))}
        {[...pluginItems].sort(compareByOrder).map((def) => {
          const pluginId = pluginIdFromRegistryKey(def.id);
          const Chip = def.component;
          return (
            <PluginBoundary key={def.id} pluginId={pluginId}>
              <Chip />
            </PluginBoundary>
          );
        })}
      </div>
      <div className="flex items-center gap-3">
        <ProxyQuickToggle />
        {/* Context meter is always on: 0% until the first usage report. */}
        <AriaDialogTrigger
          isOpen={contextOpen}
          onOpenChange={(o) => allowContextOpenChange(o) && setContextOpen(o)}
        >
          <AriaButton
            ref={contextTriggerRef}
            aria-label={t("chat.contextWindow")}
            className="flex cursor-pointer items-center gap-1 rounded-[40px] py-1 pr-2 pl-1.5 outline-none transition-colors duration-150 ease focus-visible:ring-2 focus-visible:ring-border-focus-ring"
          >
            <ContextRing pct={usagePct ?? 0} />
            <span className="text-body-2-medium whitespace-nowrap text-text-secondary">
              {usagePct ?? 0}%
            </span>
          </AriaButton>
          <AriaPopover
            ref={contextPopoverRef}
            isNonModal
            placement="top end"
            offset={8}
            className={CONTEXT_POPOVER_CLASSES}
          >
            <AriaDialog aria-label={t("chat.contextWindow")} className="outline-none">
              <AgentLimitsCard
                context={limitsContext}
                plan={EMPTY_PLAN}
                limits={EMPTY_LIMITS}
                text={limitsText}
                onCompact={onCompactContext}
                onRefresh={onRefreshUsage}
                compacting={compacting}
                refreshing={refreshing}
                canCompact={canCompact}
              />
            </AriaDialog>
          </AriaPopover>
        </AriaDialogTrigger>
      </div>
    </div>
  );
}
