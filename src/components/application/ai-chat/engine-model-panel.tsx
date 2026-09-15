"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Check from "lucide-react/dist/esm/icons/check";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import Search from "lucide-react/dist/esm/icons/search";
import X from "lucide-react/dist/esm/icons/x";
import { m } from "motion/react";
import { CLI_DISPLAY_NAMES, inferModelEngine } from "@/components/foundations/icons/engine-brands";
import { EngineIcon } from "@/components/foundations/icons/engine-icon";
import { supportsOmpFastMode, type OmpServiceTier } from "@/lib/omp-service-tier";
import { cx } from "@/utils/cx";
import { OmpSpeedSection } from "./omp-speed-section";
import { filterModels, groupModelsByProvider, type ModelGroup } from "./model-list";
import { EFFORT_LABEL_KEYS, type EffortLevel } from "./effort-levels";
import { EffortSlider } from "./effort-slider";
import type { MenuOption, ModelOption } from "./cli-menu";

export interface ChannelOption {
  id: string;
  label: string;
}

/** Per-engine model flyout: pops to the right of the CLI popover, bottom-
 *  aligned with the engine list so the taller panel never clips below the
 *  composer-anchored popover. */
const FLYOUT_CLASSES = cx(
  "absolute left-full bottom-0 z-10 ml-2 w-80 max-w-[calc(100vw-32px)]",
  "rounded-lg border border-border-button-default bg-background-primary-default p-1 shadow-dropdown",
);

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
      <span className="min-w-0 truncate text-body-medium text-text-primary">
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

function ChannelList({
  channels,
  selectedChannelId,
  engineId,
  onPickChannel,
}: {
  channels: ChannelOption[];
  selectedChannelId: string;
  engineId: string;
  onPickChannel: (engine: string, id: string) => void;
}) {
  const { t } = useTranslation();
  if (channels.length === 0) return null;
  return (
    <div className="flex w-full flex-col" role="radiogroup" aria-label={t("chat.channelPicker")}>
      <span className="px-2 pt-0.5 pb-0.5 text-body-2-medium text-text-tertiary">
        {t("chat.channelPicker")}
      </span>
      {channels.map((channel) => (
        <ChannelRow
          key={channel.id}
          option={channel}
          selected={channel.id === selectedChannelId}
          engineId={engineId}
          onPick={onPickChannel}
        />
      ))}
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
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-body-medium whitespace-nowrap text-text-primary">
          {option.label}
        </span>
        {/* CLI /model-menu style subtitle ("Custom Opus model"); absent
            for plain catalog rows. */}
        {option.description && (
          <span className="truncate text-body-2-regular whitespace-nowrap text-text-secondary">
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
 * spinning until the probe settles. */
function RefreshButton({ onRefresh }: { onRefresh: () => void | Promise<void> }) {
  const { t } = useTranslation();
  const [refreshing, setRefreshing] = useState(false);
  return (
    <button
      type="button"
      aria-label={t("common.refresh")}
      title={t("common.refresh")}
      disabled={refreshing}
      onClick={() => {
        if (refreshing) return;
        setRefreshing(true);
        Promise.resolve(onRefresh()).finally(() => setRefreshing(false));
      }}
      className="flex size-7 items-center justify-center rounded-lg text-foreground-icon-secondary hover:bg-background-secondary-hover hover:text-foreground-icon-primary disabled:cursor-default"
    >
      <RefreshCw
        className={cx("size-3.5", refreshing && "animate-spin")}
        aria-hidden
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
              {group.key}
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
  const normalizedQuery = query.trim().toLowerCase();
  const filteredModels = filterModels(models, normalizedQuery);
  // Provider sections layer the list whenever the engine's catalog mixes
  // sources (OMP serving several relays) — including while filtering, so the
  // results keep naming their origin instead of collapsing into identical
  // rows. Pinning the active row to the top would tear it out of its section,
  // so a grouped list keeps the catalog order and marks the pick in place;
  // only a flat single-source list reorders to surface the pick.
  const groups = useMemo(() => groupModelsByProvider(filteredModels), [filteredModels]);
  // Sectioned whenever the grouping carried keys — a single provider still
  // gets its header (the group is keyless only when no provider is known).
  const layered = groups.length > 0 && groups[0].key !== "";
  const orderedModels = layered
    ? filteredModels
    : [...filteredModels].sort(
        (a, b) =>
          Number(b.id === selectedModelId) - Number(a.id === selectedModelId),
      );
  // The section holding the current pick leads so the selection is never
  // scrolled out of view; within sections the catalog order stands.
  const visibleGroups = layered
    ? [...groups].sort(
        (a, b) =>
          Number(b.rows.some((m) => m.id === selectedModelId)) -
          Number(a.rows.some((m) => m.id === selectedModelId)),
      )
    : null;
  const ompFast = option.id === "omp" && supportsOmpFastMode(selectedModelId);
  const codexFast = option.id === "codex";
  const showFast = ompFast || codexFast;
  const fastTier = codexFast ? codexServiceTier : ompServiceTier;
  const onFastChange = codexFast ? onCodexServiceTierChange : onOmpServiceTierChange;

  return (
    <div className="flex w-full flex-col gap-1.5">
      <div className="flex items-center justify-between gap-1">
        <span className="truncate px-2 py-1.5 text-body-medium text-text-secondary">
          {t("chat.engineHeader", {
            name: CLI_DISPLAY_NAMES[option.id] ?? option.label,
          })}
        </span>
        <PanelActions onRefresh={onRefresh} onClose={onClose} />
      </div>
      {channels && onPickChannel && (
        <ChannelList
          channels={channels}
          selectedChannelId={selectedChannelId ?? ""}
          engineId={option.id}
          onPickChannel={onPickChannel}
        />
      )}
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
      <ModelGroupList
        groups={visibleGroups ?? [{ key: "", rows: orderedModels }]}
        empty={orderedModels.length === 0}
        loading={loading}
        selectedModelId={selectedModelId}
        engineId={option.id}
        onPickModel={onPickModel}
      />

      {/* Full-bleed divider, like the reference submenu. */}
      <div aria-hidden className={cx("-mx-1 mt-[7px] h-px bg-border-button-default", showFast ? "mb-1" : "mb-3")} />
      <FlyoutEffortSection
        header={showFast ? (
          <OmpSpeedSection
            model={selectedModelId}
            supported={codexFast || undefined}
            value={fastTier}
            onChange={onFastChange}
          >
            <span className="text-body-medium text-text-primary">{t(EFFORT_LABEL_KEYS[effort])}</span>
          </OmpSpeedSection>
        ) : undefined}
        effort={effort}
        onChange={(level) => onEffortChange(option.id, level)}
      />
    </div>
  );
}

/** Desktop-only wrapper: the model panel as a flyout popping to the right of
 *  the CLI popover. On mobile CliMenu renders the same panel in a modal
 *  dialog instead (hover flyouts don't work on touch). */
export function EngineFlyout(props: Parameters<typeof EngineModelPanel>[0]) {
  return (
    <div className={FLYOUT_CLASSES}>
      <EngineModelPanel {...props} />
    </div>
  );
}
