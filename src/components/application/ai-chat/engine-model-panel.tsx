"use client";

import { useMemo, useId, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode, RefObject } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import Check from "lucide-react/dist/esm/icons/check";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import Search from "lucide-react/dist/esm/icons/search";
import X from "lucide-react/dist/esm/icons/x";
import { m } from "motion/react";
import { ActionFeedbackIcon, useActionFeedback } from "@/components/base/action-feedback";
import { CLI_DISPLAY_NAMES, inferModelEngine } from "@/components/foundations/icons/engine-brands";
import { ChevronDownSmall } from "@/components/foundations/icons/chevrons";
import { EngineIcon } from "@/components/foundations/icons/engine-icon";
import { supportsOmpFastMode, type OmpServiceTier } from "@/lib/omp-service-tier";
import { cx } from "@/utils/cx";
import { OmpSpeedSection } from "./omp-speed-section";
import {
  filterModels,
  groupModelsByProvider,
  isEnterpriseGroup,
  orderModelGroups,
  type ModelGroup,
} from "./model-list";
import { EFFORT_LABEL_KEYS, supportsEffort, type EffortLevel } from "./effort-levels";
import { EffortSlider } from "./effort-slider";
import { useLockedMinWidth } from "./use-locked-min-width";
import type { MenuOption, ModelOption } from "./cli-menu";

export interface ChannelOption {
  id: string;
  label: string;
}

/** Bottom-aligned model flyout; its available side determines the width. */
const FLYOUT_CLASSES = cx(
  "absolute bottom-0 z-10 w-max min-w-[min(320px,var(--flyout-max-width))] max-w-[var(--flyout-max-width)]",
  "rounded-lg border border-border-button-default bg-background-primary-default p-1 shadow-dropdown",
);
const FLYOUT_MAX_WIDTH = 480;
/** 16px viewport margin plus the 8px gap beside the CLI popover. */
const FLYOUT_EDGE_SPACE = 24;

/* ------------------------------------------------------------------ flyout */

/** One checkmark channel row. Shown only when the engine has in-app channels. */
function ChannelRow({
  option,
  selected,
  engineId,
  onPick,
}: {
  option: ChannelOption;
  selected: boolean;
  engineId: string;
  onPick: (engine: string, id: string) => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={() => onPick(engineId, option.id)}
      className={cx(
        "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none transition-colors",
        selected
          ? "bg-background-primary-hover"
          : "hover:bg-background-primary-hover focus-visible:bg-background-primary-hover",
      )}
    >
      <span className="min-w-0 text-body-medium whitespace-normal text-text-primary [overflow-wrap:anywhere]">
        {option.label}
      </span>
      {selected && (
        <Check
          className="ml-auto size-4 shrink-0 text-foreground-icon-primary"
          aria-hidden
        />
      )}
    </button>
  );
}

/** Header field narrowing the channel list. While it holds text the dropdown
 *  stays open, so the matches are visible without a second click. */
function ChannelFilterField({
  query,
  onQueryChange,
}: {
  query: string;
  onQueryChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <input
      value={query}
      onChange={(event) => onQueryChange(event.target.value)}
      placeholder={t("chat.channelFilterPlaceholder")}
      aria-label={t("chat.channelFilterPlaceholder")}
      className="h-6 w-[104px] shrink-0 rounded-md border border-separator-border bg-background-secondary-default px-1.5 text-caption-1-regular text-text-primary outline-none placeholder:text-text-tertiary focus-visible:ring-2 focus-visible:ring-border-focus-ring"
    />
  );
}

/** Provider dropdown: collapsed to the current channel until opened, then a
 *  height-bounded scroll list. The old inline list rendered every channel at
 *  once, so a machine with a dozen relays pushed the model list — the part
 *  the panel exists for — off the flyout. */
function ChannelPicker({
  channels,
  selectedChannelId,
  engineId,
  onPickChannel,
  query,
  onQueryChange,
}: {
  channels: ChannelOption[];
  selectedChannelId: string;
  engineId: string;
  onPickChannel: (engine: string, id: string) => void;
  /** Header filter text; a non-empty filter also holds the list open. */
  query: string;
  onQueryChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const listId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  if (channels.length === 0) return null;
  const needle = query.trim().toLowerCase();
  // Match the id too: the visible label is the channel's name, but people
  // search by the slug they pasted into the provider dialog.
  const visible = needle
    ? channels.filter((channel) =>
        `${channel.label} ${channel.id}`.toLowerCase().includes(needle),
      )
    : channels;
  const expanded = open || needle.length > 0;
  const selected = channels.find((channel) => channel.id === selectedChannelId);
  return (
    <div className="flex w-full flex-col">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={() => {
          // Filtered? The arrow clears the filter instead of hiding the list
          // the text is still narrowing.
          if (needle) {
            onQueryChange("");
            setOpen(false);
            return;
          }
          setOpen((prev) => !prev);
        }}
        className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none transition-colors hover:bg-background-primary-hover focus-visible:bg-background-primary-hover"
      >
        <span className="shrink-0 text-body-2-medium text-text-tertiary">
          {t("chat.channelPicker")}
        </span>
        {/* w-0 + flex-1: picking a long channel must not widen the flyout. The
            row stays one line; the title and the opened list show the full name. */}
        <span title={selected?.label} className="w-0 flex-1 truncate text-body-medium text-text-primary">
          {selected?.label ?? t("chat.channelUnselected")}
        </span>
        <ChevronDownSmall
          className={cx(
            "ml-auto size-4 shrink-0 text-foreground-icon-secondary transition-transform duration-200 ease",
            expanded && "rotate-180",
          )}
        />
      </button>
      {expanded && (
        // w-0 + min-w-full: fills the panel but adds nothing to its max-content
        // width, so opening the list can't make the flyout jump.
        <div
          id={listId}
          role="radiogroup"
          aria-label={t("chat.channelPicker")}
          className="flex max-h-[200px] w-0 min-w-full flex-col overflow-y-auto"
        >
          {visible.map((channel) => (
            <ChannelRow
              key={channel.id}
              option={channel}
              selected={channel.id === selectedChannelId}
              engineId={engineId}
              onPick={(engine, id) => {
                // Restore focus before this row unmounts; otherwise the overlay
                // focuses the first engine row and switches away from this panel.
                triggerRef.current?.focus({ preventScroll: true });
                onPickChannel(engine, id);
                onQueryChange("");
                setOpen(false);
              }}
            />
          ))}
          {visible.length === 0 && (
            <span className="px-2 py-1.5 text-body-2-regular text-text-tertiary">
              {t("chat.noMatchingChannels")}
            </span>
          )}
        </div>
      )}
      <div aria-hidden className="-mx-1 mt-1 mb-1 h-px bg-border-button-default" />
    </div>
  );
}

/** One checkmark model row inside the flyout's radio group. */
function ModelRow({
  option,
  selected,
  engineId,
  onPick,
}: {
  option: ModelOption;
  selected: boolean;
  engineId: string;
  onPick: (engine: string, id: string) => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={() => onPick(engineId, option.id)}
      className={cx(
        "flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none transition-colors",
        selected
          ? "bg-background-primary-hover"
          : "hover:bg-background-primary-hover focus-visible:bg-background-primary-hover",
      )}
    >
      <EngineIcon
        engine={inferModelEngine(option.label) ?? inferModelEngine(option.id) ?? engineId}
        size={18}
        className="shrink-0 text-foreground-icon-primary"
      />
      <span className="flex min-w-0 flex-col [overflow-wrap:anywhere]">
        <span className="text-body-medium whitespace-normal text-text-primary">
          {option.label}
        </span>
        {/* CLI /model-menu style subtitle ("Custom Opus model"); absent
            for plain catalog rows. */}
        {option.description && (
          <span className="text-body-2-regular whitespace-normal text-text-secondary">
            {option.description}
          </span>
        )}
      </span>
      {selected && (
        <Check
          className="ml-auto size-4 shrink-0 text-foreground-icon-primary"
          aria-hidden
        />
      )}
    </button>
  );
}

/** The flyout's effort section: label with a keyed blur-in value, the
 *  faster/smarter captions, and the five-stop slider. */
function FlyoutEffortSection({
  effort,
  onChange,
  header,
}: {
  effort: EffortLevel;
  onChange: (level: EffortLevel) => void;
  header?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex w-full flex-col">
      {header ?? <span className="pl-2 text-body-medium text-text-secondary">
        {t("chat.effort")}{" "}
        {/* Keyed on the value so each change remounts and blurs in. */}
        <m.span
          key={effort}
          initial={{ opacity: 0, filter: "blur(4px)" }}
          animate={{ opacity: 1, filter: "blur(0px)" }}
          transition={{ duration: 0.35, ease: "easeOut" }}
          className="inline-block text-text-primary"
        >
          {t(EFFORT_LABEL_KEYS[effort])}
        </m.span>
      </span>}
      <div className={cx("flex w-full items-center justify-between px-2 pb-[3px]", header ? "pt-0" : "pt-2")}>
        <span className="text-body-2-medium whitespace-nowrap text-text-secondary">
          {t("chat.effortFaster")}
        </span>
        <span className="text-body-2-medium whitespace-nowrap text-text-secondary">
          {t("chat.effortSmarter")}
        </span>
      </div>
      <div className="w-full px-2 pb-2">
        <EffortSlider value={effort} onChange={onChange} />
      </div>
    </div>
  );
}

/** Header refresh button: re-probes provider configs and model catalogs,
 * spinning until the probe settles and checking once it does. */
function RefreshButton({ onRefresh }: { onRefresh: () => void | Promise<void> }) {
  const { t } = useTranslation();
  const refreshAction = useActionFeedback({ spin: true });
  const refreshing = refreshAction.feedback === "running";
  return (
    <button
      type="button"
      aria-label={t("common.refresh")}
      title={t("common.refresh")}
      disabled={refreshing}
      onClick={() => {
        if (refreshing) return;
        void refreshAction.start(() => Promise.resolve(onRefresh()));
      }}
      className="flex size-7 items-center justify-center rounded-lg text-foreground-icon-secondary hover:bg-background-secondary-hover hover:text-foreground-icon-primary disabled:cursor-default"
    >
      <ActionFeedbackIcon
        icon={RefreshCw}
        feedback={refreshAction.feedback}
        spin
        iconClassName="size-3.5"
      />
    </button>
  );
}

/** Optional header actions: catalog refresh (flyout + dialog) and/or the
 * dialog's dismiss button. Renders nothing when neither applies. */
function PanelActions({
  onRefresh,
  onClose,
}: {
  onRefresh?: () => void | Promise<void>;
  onClose?: () => void;
}) {
  const { t } = useTranslation();
  if (!onRefresh && !onClose) return null;
  return (
    <span className="mr-1 flex shrink-0 items-center">
      {onRefresh && <RefreshButton onRefresh={onRefresh} />}
      {onClose && (
        <button
          type="button"
          aria-label={t("common.close")}
          onClick={onClose}
          className="flex size-7 items-center justify-center rounded-lg text-foreground-icon-secondary hover:bg-background-secondary-hover hover:text-foreground-icon-primary"
        >
          <X className="size-4" aria-hidden />
        </button>
      )}
    </span>
  );
}

/** The scrollable radio-group model list: provider-sectioned (search
 * included) when the catalog mixes sources, flat otherwise; an exhausted
 * search shows the no-match hint. */
function ModelGroupList({
  groups,
  empty,
  loading,
  selectedModelId,
  engineId,
  onPickModel,
}: {
  groups: ModelGroup[];
  empty: boolean;
  /** Catalog probe still running: the list on screen may be incomplete. */
  loading?: boolean;
  selectedModelId: string;
  engineId: string;
  onPickModel: (engine: string, id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="flex max-h-[240px] w-full flex-col overflow-y-auto"
      role="radiogroup"
      aria-label={t("chat.modelPicker")}
    >
      {groups.map((group) => (
        <div key={group.key || "__flat__"} className="flex w-full flex-col">
          {group.key && (
            <span className="sticky top-0 z-10 bg-background-primary-default px-2 pt-1.5 pb-0.5 text-body-2-medium text-text-tertiary">
              {sectionTitle(engineId, group.key, t)}
            </span>
          )}
          {group.rows.map((model) => (
            <ModelRow
              key={model.id || "__default__"}
              option={model}
              selected={model.id === selectedModelId}
              engineId={engineId}
              onPick={onPickModel}
            />
          ))}
        </div>
      ))}
      {loading && !empty && (
        <span className="px-2 pt-1 pb-2 text-body-2-regular text-text-tertiary">
          {t("chat.modelsLoading")}
        </span>
      )}
      {empty && (
        <span className="p-2 text-body-medium text-text-tertiary">
          {t("chat.noMatchingModels")}
        </span>
      )}
    </div>
  );
}

/** What a section header reads: the provider key, except CodeBuddy's
 *  enterprise section, which is titled through i18n. */
function sectionTitle(engineId: string, key: string, t: TFunction): string {
  return isEnterpriseGroup(engineId, key) ? t("chat.modelGroupEnterprise") : key;
}

/** Filters the catalog by the search query and shapes the rows for
 *  ModelGroupList: provider sections layer the list whenever the engine's
 *  catalog mixes sources (OMP serving several relays) — including while
 *  filtering, so the results keep naming their origin instead of collapsing
 *  into identical rows. Pinning the active row to the top would tear it out
 *  of its section, so a grouped list keeps the catalog order and marks the
 *  pick in place; only a flat single-source list reorders to surface the
 *  pick. Section order comes from `orderModelGroups`: the section holding the
 *  pick leads so the selection is never scrolled out of view, and CodeBuddy's
 *  enterprise section otherwise sits last. The search also matches what a
 *  header reads, so typing 企业模型 finds that section. */
function useOrderedModelGroups(
  models: ModelOption[],
  query: string,
  selectedModelId: string,
  engineId: string,
): { groups: ModelGroup[]; empty: boolean } {
  const { t } = useTranslation();
  return useMemo(() => {
    const filtered = filterModels(models, query.trim().toLowerCase(), (provider) =>
      sectionTitle(engineId, provider, t),
    );
    const groups = groupModelsByProvider(filtered);
    // Sectioned whenever the grouping carried keys — a single provider
    // still gets its header (the group is keyless only when no provider is
    // known).
    const layered = groups.length > 0 && groups[0].key !== "";
    if (layered) {
      const ordered = orderModelGroups(groups, engineId, selectedModelId);
      return { groups: ordered, empty: filtered.length === 0 };
    }
    const flat = [...filtered].sort(
      (a, b) =>
        Number(b.id === selectedModelId) - Number(a.id === selectedModelId),
    );
    return { groups: [{ key: "", rows: flat }], empty: flat.length === 0 };
  }, [models, query, selectedModelId, engineId, t]);
}

/** The search field filtering the model list. */
function ModelSearchField({
  query,
  onQueryChange,
}: {
  query: string;
  onQueryChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="relative mx-1 -mt-1.5 pb-1">
      <Search
        className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-[calc(50%+2px)] text-foreground-icon-secondary"
        aria-hidden
      />
      <input
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder={t("chat.modelSearchPlaceholder")}
        aria-label={t("chat.modelSearchPlaceholder")}
        className="h-8 w-full rounded-md border border-separator-border bg-background-secondary-default pr-2 pl-7 text-body-regular text-text-primary outline-none placeholder:text-text-tertiary focus-visible:ring-2 focus-visible:ring-border-focus-ring"
      />
    </div>
  );
}

/** Panel footer: full-bleed divider (like the reference submenu) over the
 *  effort section. For OMP models supporting Fast mode and for Codex the
 *  effort header additionally carries the speed-tier picker. */
function EffortFooter({
  engineId,
  selectedModelId,
  effort,
  onEffortChange,
  ompServiceTier,
  onOmpServiceTierChange,
  codexServiceTier,
  onCodexServiceTierChange,
}: {
  engineId: string;
  selectedModelId: string;
  effort: EffortLevel;
  onEffortChange: (engine: string, level: EffortLevel) => void;
  ompServiceTier: OmpServiceTier;
  onOmpServiceTierChange: (tier: OmpServiceTier) => Promise<void>;
  codexServiceTier: OmpServiceTier;
  onCodexServiceTierChange: (tier: OmpServiceTier) => Promise<void>;
}) {
  const { t } = useTranslation();
  const ompFast = engineId === "omp" && supportsOmpFastMode(selectedModelId);
  const codexFast = engineId === "codex";
  const showFast = ompFast || codexFast;
  const fastTier = codexFast ? codexServiceTier : ompServiceTier;
  const onFastChange = codexFast ? onCodexServiceTierChange : onOmpServiceTierChange;
  const header = showFast ? (
    <OmpSpeedSection
      model={selectedModelId}
      supported={codexFast || undefined}
      value={fastTier}
      onChange={onFastChange}
    >
      <span className="text-body-medium text-text-primary">{t(EFFORT_LABEL_KEYS[effort])}</span>
    </OmpSpeedSection>
  ) : undefined;
  return (
    <>
      <div aria-hidden className={cx("-mx-1 mt-[7px] h-px bg-border-button-default", showFast ? "mb-1" : "mb-3")} />
      <FlyoutEffortSection
        header={header}
        effort={effort}
        onChange={(level) => onEffortChange(engineId, level)}
      />
    </>
  );
}

/**
 * Engine model panel content: "{name} 引擎" header over a search field over
 * checkmark model rows over the effort slider. Shared by the desktop flyout
 * (EngineFlyout) and the mobile second-level dialog; `onClose` adds a
 * dismiss button to the header, which only the dialog passes. Model picks
 * stay in-panel so Fast / effort can follow without reopening.
 */
export function EngineModelPanel({
  option,
  models,
  selectedModelId,
  query,
  onQueryChange,
  effort,
  onPickModel,
  onEffortChange,
  channels,
  selectedChannelId,
  onPickChannel,
  ompServiceTier,
  onOmpServiceTierChange,
  codexServiceTier,
  onCodexServiceTierChange,
  onRefresh,
  onClose,
  loading,
}: {
  option: MenuOption;
  models: ModelOption[];
  selectedModelId: string;
  query: string;
  onQueryChange: (value: string) => void;
  effort: EffortLevel;
  onPickModel: (engine: string, id: string) => void;
  onEffortChange: (engine: string, level: EffortLevel) => void;
  channels?: ChannelOption[];
  selectedChannelId?: string;
  onPickChannel?: (engine: string, id: string) => void;
  ompServiceTier: OmpServiceTier;
  onOmpServiceTierChange: (tier: OmpServiceTier) => Promise<void>;
  codexServiceTier: OmpServiceTier;
  onCodexServiceTierChange: (tier: OmpServiceTier) => Promise<void>;
  /** Re-probe provider configs and model catalogs without an app restart. */
  onRefresh?: () => void | Promise<void>;
  onClose?: () => void;
  /** This engine's catalog probe is still running. */
  loading?: boolean;
}) {
  const { t } = useTranslation();
  const { groups, empty } = useOrderedModelGroups(
    models,
    query,
    selectedModelId,
    option.id,
  );
  // Header channel filter (empty = the full channel list). Engines without
  // channels (omp until one is added in settings) get no channel UI at all —
  // an empty-array channels prop is still truthy, and a filter box that
  // narrows nothing is worse than none.
  const [channelQuery, setChannelQuery] = useState("");
  const engineChannels = channels ?? [];
  const hasChannels = engineChannels.length > 0;

  return (
    <div className="flex w-full flex-col gap-1.5">
      <div className="flex items-center justify-between gap-1">
        <span className="min-w-0 flex-1 truncate px-2 py-1.5 text-body-medium text-text-secondary">
          {t("chat.engineHeader", {
            name: CLI_DISPLAY_NAMES[option.id] ?? option.label,
          })}
        </span>
        {hasChannels && onPickChannel && (
          <ChannelFilterField query={channelQuery} onQueryChange={setChannelQuery} />
        )}
        <PanelActions onRefresh={onRefresh} onClose={onClose} />
      </div>
      {hasChannels && onPickChannel && (
        <ChannelPicker
          channels={engineChannels}
          selectedChannelId={selectedChannelId ?? ""}
          engineId={option.id}
          onPickChannel={onPickChannel}
          query={channelQuery}
          onQueryChange={setChannelQuery}
        />
      )}
      <ModelSearchField query={query} onQueryChange={onQueryChange} />
      <ModelGroupList
        groups={groups}
        empty={empty}
        loading={loading}
        selectedModelId={selectedModelId}
        engineId={option.id}
        onPickModel={onPickModel}
      />
      {supportsEffort(option.id) && (
        <EffortFooter
          engineId={option.id}
          selectedModelId={selectedModelId}
          effort={effort}
          onEffortChange={onEffortChange}
          ompServiceTier={ompServiceTier}
          onOmpServiceTierChange={onOmpServiceTierChange}
          codexServiceTier={codexServiceTier}
          onCodexServiceTierChange={onCodexServiceTierChange}
        />
      )}
    </div>
  );
}

/** Which side of the CLI popover the flyout opens on and how wide it may get,
 *  re-measured whenever the popover can have moved or settled. */
function useFlyoutLayout(ref: RefObject<HTMLDivElement | null>) {
  const [layout, setLayout] = useState({ left: false, maxWidth: FLYOUT_MAX_WIDTH });
  useLayoutEffect(() => {
    const panel = ref.current;
    const anchor = panel?.parentElement;
    if (!panel || !anchor) return;
    const update = () => {
      const bounds = anchor.getBoundingClientRect();
      const rightSpace = window.innerWidth - bounds.right - FLYOUT_EDGE_SPACE;
      const leftSpace = bounds.left - FLYOUT_EDGE_SPACE;
      const left = rightSpace < Math.min(FLYOUT_MAX_WIDTH, leftSpace);
      const maxWidth = Math.max(0, Math.min(FLYOUT_MAX_WIDTH, left ? leftSpace : rightSpace));
      setLayout((current) => current.left === left && current.maxWidth === maxWidth
        ? current : { left, maxWidth });
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(update);
    observer?.observe(anchor);
    observer?.observe(panel);
    // 入口变宽时外层弹层会平移，浮层自身尺寸可能不变。
    const popover = anchor.closest('[role="dialog"]')?.parentElement;
    const positionObserver = new MutationObserver(update);
    if (popover) positionObserver.observe(popover, { attributes: true, attributeFilter: ["style"] });
    // 入场动画期间外层弹层只有 95% 大小，上面读到的边界偏小，动画结束后再量一次；
    // 行悬停等子元素的过渡会冒泡上来，不算。
    const onPopoverTransitionEnd = (event: Event) => {
      if (event.target === popover) update();
    };
    popover?.addEventListener("transitionend", onPopoverTransitionEnd);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      positionObserver.disconnect();
      popover?.removeEventListener("transitionend", onPopoverTransitionEnd);
      window.removeEventListener("resize", update);
    };
  }, [ref]);
  return layout;
}

/** Desktop-only wrapper: the model panel flies out on the roomier side of
 *  the CLI popover. On mobile CliMenu renders the same panel in a modal
 *  dialog instead (hover flyouts don't work on touch). */
export function EngineFlyout(props: Parameters<typeof EngineModelPanel>[0]) {
  const ref = useRef<HTMLDivElement>(null);
  const layout = useFlyoutLayout(ref);
  // 搜索期间保持搜索前的宽度：筛掉最长的名字后，浮层不变窄，输入框也不会横向挪动。
  const searchMinWidth = useLockedMinWidth(Boolean(props.query), ref);
  // data-engine-flyout: CliMenu's hover-intent guard checks focus against
  // this marker so hovering a row never swaps the panel while the user is
  // typing in its search / channel filter.
  return (
    <div
      ref={ref}
      data-engine-flyout
      className={cx(FLYOUT_CLASSES, layout.left ? "right-full mr-2" : "left-full ml-2")}
      style={{
        "--flyout-max-width": `${layout.maxWidth}px`,
        minWidth: searchMinWidth === undefined ? undefined : Math.min(searchMinWidth, layout.maxWidth),
      } as CSSProperties}
    >
      <EngineModelPanel {...props} />
    </div>
  );
}
