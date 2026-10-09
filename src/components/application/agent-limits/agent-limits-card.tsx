"use client";

import { useMemo, useState, type ComponentType } from "react";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ArrowRight from "lucide-react/dist/esm/icons/arrow-right";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import Minimize2 from "lucide-react/dist/esm/icons/minimize-2";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import Zap from "lucide-react/dist/esm/icons/zap";
import { Button as AriaButton } from "react-aria-components";
import { Collapsible } from "@/components/application/collapsible/collapsible";
import { Tooltip, TooltipContent } from "@/components/base/tooltip/tooltip";
import {
  ActionFeedbackIcon,
  useRunningFeedback,
  type ActionFeedback,
} from "@/components/base/action-feedback";
import { cx } from "@/utils/cx";
import { formatTokens } from "@/utils/format-tokens";
import { normalizeAutoCompactThreshold } from "@/features/chat/auto-compact-context";

/** Series colours: explicit `color` (+ optional `activeColor`) wins;
 * otherwise the `chart-n` token palette cycles in an order that keeps
 * neighbouring segments distinct. A custom colour without a hover step is
 * darkened with `color-mix` so hover still reads. */
type ChartTone = { color: string; activeColor: string };

const TONE_ORDER = [2, 6, 5, 3, 8, 7, 4, 1] as const;

const CHART_TONES: ChartTone[] = TONE_ORDER.map((n) => ({
  color: `var(--color-chart-${n})`,
  activeColor: `var(--color-chart-${n}-active)`,
}));

function resolveTone(index: number, color?: string, activeColor?: string): ChartTone {
  if (color) {
    return { color, activeColor: activeColor ?? `color-mix(in srgb, ${color} 82%, black)` };
  }
  return CHART_TONES[index % CHART_TONES.length];
}

/**
 * Agent limits card - the "how much of my agent budget is left" widget:
 *
 *   Context window   stacked usage bar (one segment per token bucket) with a
 *                    "used / max (pct)" readout. Expanding it grows the whole
 *                    card to reveal the breakdown: a legend row per bucket
 *                    (swatch · label · tokens · share), free space, deferred
 *                    buckets that don't count against the window ("—"), and
 *                    collapsible groups (MCP tools, memory files…) listing
 *                    their members.
 *   Plan limits      one row per rolling limit: label, reset time, percent,
 *                    and a progress bar.
 *
 * All numbers are props: `context.max` + `context.segments[]` drive the bar
 * and shares, `context.groups[]` the collapsible rows, `limits[]` the plan
 * section. Segment colours cycle the chart palette from blue unless set.
 */

export type ContextSegment = {
  label: string;
  tokens: number;
  /** Any CSS colour; defaults to the chart palette by index (blue first). */
  color?: string;
  /** Deferred buckets are listed but neither drawn in the bar nor counted. */
  deferred?: boolean;
};

export type ContextGroup = {
  label: string;
  tokens: number;
  items: { label: string; tokens: number }[];
};

export type UsageLimit = {
  label: string;
  /** 0-1 share of the limit already used. */
  used: number;
  /** "Resets in 2 hr 46 min", "Resets Tue 3:00 PM"… */
  resets: string;
};

export interface AgentLimitsCardProps {
  context: {
    /** Window size in tokens (e.g. 1_000_000). */
    max: number;
    segments: ContextSegment[];
    groups?: ContextGroup[];
  };
  /** Plan name shown after "Plan usage limits ·". */
  plan?: string;
  planHref?: string;
  limits?: UsageLimit[];
  /** Start with the context breakdown open. */
  defaultExpanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  /** Copy, already localized by the caller (i18n lives in feature code). */
  text: {
    contextWindow: string;
    freeSpace: string;
    planUsageLimits: string;
    /** aria-label for the plan link arrow (rendered only with `planHref`). */
    managePlan: string;
    compactContext?: string;
    compactContextTooltip?: string;
    compacting?: string;
    refreshUsage?: string;
    refreshUsageTooltip?: string;
    refreshing?: string;
    autoCompactThreshold?: string;
    autoCompactEnable?: string;
    autoCompactDisable?: string;
    /** Tooltip shown while the controls have no session to bind to. */
    autoCompactNoSession?: string;
  };
  onCompact?: () => void;
  onRefresh?: () => void;
  compacting?: boolean;
  refreshing?: boolean;
  canCompact?: boolean;
  autoCompact?: {
    enabled: boolean;
    threshold: number;
    /** No active session: render the controls but keep them inert. */
    disabled?: boolean;
    minThreshold?: number;
    maxThreshold?: number;
    thresholdUnavailable?: boolean;
    validationHint?: string;
    error?: string;
    hint?: string;
    onEnabledChange: (enabled: boolean) => void;
    onThresholdChange: (threshold: number) => void;
  };
  className?: string;
}

/** Thin rounded track + fill, the same bar the earnings/steps cards use. */
function Bar({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cx("flex h-1.5 w-full gap-px overflow-hidden rounded-full bg-chart-track", className)}>
      {children}
    </div>
  );
}

/** Share of the context window, 0-100. */
function shareOf(n: number, max: number) {
  return (n / Math.max(1, max)) * 100;
}

type ActionIcon = ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;

/** Header row: the "Context window" label, the used / max (pct) readout and
 *  the expand chevron. The whole row is the toggle. */
function ContextHeader({
  label,
  used,
  max,
  expanded,
  onToggle,
}: {
  label: string;
  used: number;
  max: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className="group -mx-2 flex cursor-pointer items-center justify-between gap-3 rounded-2lg px-2 py-1 text-left outline-none transition-colors duration-150 hover:bg-background-secondary-hover focus-visible:ring-2 focus-visible:ring-border-focus-ring"
    >
      <span className="text-body-medium text-text-secondary">{label}</span>
      <span className="flex items-center gap-2">
        <span className="text-body-medium whitespace-nowrap text-text-secondary tabular-nums">
          {formatTokens(used)} / {formatTokens(max)}{" "}
          <span className="text-text-primary">({Math.round(shareOf(used, max))}%)</span>
        </span>
        <ChevronDown
          className={cx(
            "size-4 shrink-0 text-text-tertiary transition-transform duration-200 ease-out group-hover:text-text-secondary",
            expanded && "rotate-180",
          )}
          aria-hidden
        />
      </span>
    </button>
  );
}

/** One collapsible group (MCP tools, memory files…): header row with the
 *  chevron, token total and member count; expanding lists the members. */
function ContextGroupSection({
  group,
  open,
  onToggle,
}: {
  group: ContextGroup;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="-mx-2 flex cursor-pointer items-center gap-1.5 rounded-2lg px-2 py-[7px] text-left outline-none transition-colors duration-150 hover:bg-background-secondary-hover focus-visible:ring-2 focus-visible:ring-border-focus-ring"
      >
        <ChevronRight
          className={cx(
            "size-4 shrink-0 text-text-tertiary transition-transform duration-200 ease-out",
            open && "rotate-90",
          )}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate text-body-regular text-text-secondary">{group.label}</span>
        <span className="text-body-regular text-text-tertiary tabular-nums">{formatTokens(group.tokens)}</span>
        <span className="w-14 text-right text-body-regular text-text-tertiary tabular-nums">
          {group.items.length}
        </span>
      </button>
      <Collapsible open={open} seconds={0.26}>
        <div className="flex flex-col pb-1 pl-[22px]">
          {group.items.map((item) => (
            <div key={item.label} className="flex items-center gap-2 py-1">
              <span className="min-w-0 flex-1 truncate text-body-2-regular text-text-secondary">
                {item.label}
              </span>
              <span className="text-body-2-regular text-text-tertiary tabular-nums">
                {formatTokens(item.tokens)}
              </span>
              <span className="w-14" />
            </div>
          ))}
        </div>
      </Collapsible>
    </div>
  );
}

/** The breakdown revealed by expanding the card: a legend row per token
 *  bucket (swatch · label · tokens · share — deferred buckets show "—"),
 *  the free-space row, then the collapsible groups. */
function SegmentLegend({
  segments,
  tones,
  max,
  free,
  freeSpace,
  groups,
  openGroups,
  onToggleGroup,
}: {
  segments: ContextSegment[];
  tones: ChartTone[];
  max: number;
  free: number;
  freeSpace: string;
  groups?: ContextGroup[];
  openGroups: Set<string>;
  onToggleGroup: (label: string) => void;
}) {
  return (
    <div className="flex flex-col pt-3">
      {segments.map((s, i) => (
        <div key={s.label} className="flex items-center gap-2 py-[5px]">
          <span
            className="size-2.5 shrink-0 rounded-[3px]"
            style={{ backgroundColor: s.deferred ? "var(--color-chart-cursor)" : tones[i].color }}
          />
          <span className="min-w-0 flex-1 truncate text-body-regular text-text-primary">{s.label}</span>
          <span className="text-body-regular text-text-tertiary tabular-nums">{formatTokens(s.tokens)}</span>
          <span className="w-14 text-right text-body-medium text-text-primary tabular-nums">
            {s.deferred ? "—" : `${shareOf(s.tokens, max).toFixed(1)}%`}
          </span>
        </div>
      ))}
      <div className="flex items-center gap-2 py-[5px]">
        <span className="size-2.5 shrink-0 rounded-[3px] bg-chart-track" />
        <span className="min-w-0 flex-1 truncate text-body-regular text-text-primary">{freeSpace}</span>
        <span className="text-body-regular text-text-tertiary tabular-nums">{formatTokens(free)}</span>
        <span className="w-14 text-right text-body-medium text-text-primary tabular-nums">
          {shareOf(free, max).toFixed(1)}%
        </span>
      </div>

      {groups && groups.length > 0 && (
        <div className="mt-1.5 flex flex-col">
          {groups.map((g) => (
            <ContextGroupSection
              key={g.label}
              group={g}
              open={openGroups.has(g.label)}
              onToggle={() => onToggleGroup(g.label)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** One card action (compact / refresh): bordered pill button that dims and
 *  animates its icon while busy. */
function CardActionButton({
  testId,
  disabled,
  busy,
  onClick,
  tooltip,
  label,
  busyLabel,
  icon: Icon,
  busyIconClassName,
  feedback,
}: {
  testId: string;
  disabled: boolean;
  busy: boolean;
  onClick: () => void;
  tooltip?: string;
  label?: string;
  busyLabel?: string;
  icon: ActionIcon;
  /** Busy-state animation class when no `feedback` is given (compact pulse). */
  busyIconClassName?: string;
  /** Refresh-style feedback: spins + checks instead of the plain busy icon. */
  feedback?: ActionFeedback;
}) {
  return (
    <Tooltip>
      <AriaButton
        data-testid={testId}
        // aria-disabled keeps the button hoverable/focusable so its tooltip
        // still explains what it does while it is unavailable.
        aria-disabled={disabled || undefined}
        onPress={() => {
          if (disabled) return;
          onClick();
        }}
        className={cx(
          "inline-flex h-6 items-center gap-1.5 rounded-md border border-border-button-default bg-background-primary-default px-2 text-caption-1-medium transition-colors duration-150",
          disabled
            ? "cursor-not-allowed opacity-50 text-text-tertiary"
            : "cursor-pointer text-text-secondary hover:bg-background-secondary-hover hover:text-text-primary active:bg-background-tertiary-default",
        )}
      >
        {feedback ? (
          <ActionFeedbackIcon
            icon={Icon}
            feedback={feedback}
            spin
            iconClassName="size-3"
            runningClassName="text-blue-500"
          />
        ) : (
          <Icon
            className={cx("size-3 shrink-0", busy && `${busyIconClassName} text-blue-500`)}
            aria-hidden
          />
        )}
        <span>{busy ? busyLabel : label}</span>
      </AriaButton>
      {tooltip && <TooltipContent>{tooltip}</TooltipContent>}
    </Tooltip>
  );
}

function AutoCompactControls({
  settings,
  text,
}: {
  settings: NonNullable<AgentLimitsCardProps["autoCompact"]>;
  text: AgentLimitsCardProps["text"];
}) {
  const [draft, setDraft] = useState(String(settings.threshold));
  const min = settings.minThreshold ?? 1;
  const max = settings.maxThreshold ?? 100;
  const invalidDraft = draft.trim() === "" || !Number.isInteger(Number(draft)) || Number(draft) < min || Number(draft) > max;
  const error = settings.thresholdUnavailable || invalidDraft ? settings.validationHint : settings.error;

  // No threshold-sync effect: the parent keys this component by threshold, so
  // a change from outside remounts it with the right draft.

  const commitThreshold = (value = draft) => {
    if (settings.thresholdUnavailable || (settings.validationHint && (value.trim() === "" || !Number.isInteger(Number(value)) || Number(value) < min || Number(value) > max))) {
      setDraft(value);
      return;
    }
    const next = normalizeAutoCompactThreshold(value, settings.threshold);
    setDraft(String(next));
    settings.onThresholdChange(next);
  };

  const toggleLabel = settings.enabled
    ? text.autoCompactDisable ?? "关闭自动压缩"
    : text.autoCompactEnable ?? "开启自动压缩";
  // No session to bind to: the controls stay visible (the row keeps its shape
  // from the first launch) but cannot be edited until a chat exists.
  const disabled = settings.disabled === true;
  const hint = disabled ? text.autoCompactNoSession ?? toggleLabel : error ?? settings.hint ?? toggleLabel;

  return (
    <div className="mr-auto flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
      <div
        className={cx(
          "flex h-6 w-11 items-center rounded-md border border-border-button-default bg-background-primary-default px-1.5",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <input
          type="number"
          min={min}
          max={max}
          step={1}
          inputMode="numeric"
          disabled={disabled || settings.thresholdUnavailable}
          aria-invalid={Boolean(error) || undefined}
          data-testid="auto-compact-threshold"
          aria-label={text.autoCompactThreshold ?? "自动压缩阈值"}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={(event) => commitThreshold(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              commitThreshold(event.currentTarget.value);
              event.currentTarget.blur();
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-right text-caption-1-medium tabular-nums text-text-secondary outline-none disabled:cursor-not-allowed"
        />
        <span className="pl-0.5 text-caption-1-medium text-text-tertiary">%</span>
      </div>
      <Tooltip>
        <AriaButton
          data-testid="auto-compact-toggle"
          // aria-disabled, not isDisabled: a natively disabled button receives
          // neither hover nor focus, so its tooltip could never be read — and
          // this hint is exactly what explains the inert state. The press is
          // guarded instead.
          aria-disabled={disabled || (!settings.enabled && Boolean(error)) || undefined}
          aria-label={toggleLabel}
          aria-pressed={settings.enabled}
          onPress={() => {
            if (disabled || (!settings.enabled && error)) return;
            settings.onEnabledChange(!settings.enabled);
          }}
          className={cx(
            "flex size-6 items-center justify-center rounded-md border border-border-button-default outline-none transition-colors focus-visible:ring-2 focus-visible:ring-border-focus-ring",
            disabled && "cursor-not-allowed opacity-50",
            !disabled && "cursor-pointer",
            settings.enabled
              ? "bg-background-tertiary-default text-text-primary"
              : "text-text-tertiary hover:bg-background-secondary-hover hover:text-text-secondary",
          )}
        >
          <Zap className="size-3.5" fill={settings.enabled ? "currentColor" : "none"} aria-hidden />
        </AriaButton>
        <TooltipContent>{hint}</TooltipContent>
      </Tooltip>
      </div>
      {(error || settings.hint) && <span role={error ? "alert" : undefined} className="max-w-64 text-caption-1-medium text-text-tertiary">{error ?? settings.hint}</span>}
    </div>
  );
}

/** Compact / refresh actions and the per-session auto-compaction controls. */
function ContextActions({
  text,
  onCompact,
  onRefresh,
  compacting,
  refreshing,
  canCompact,
  autoCompact,
}: {
  text: AgentLimitsCardProps["text"];
  onCompact?: () => void;
  onRefresh?: () => void;
  compacting: boolean;
  refreshing: boolean;
  canCompact: boolean;
  autoCompact?: AgentLimitsCardProps["autoCompact"];
}) {
  const refreshFeedback = useRunningFeedback(refreshing);
  if (!onCompact && !onRefresh && !autoCompact) return null;
  return (
    <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-border-button-default/40 pt-2.5">
      {autoCompact ? (
        // Keyed by threshold: an external change (settings sync, another
        // surface) remounts the control instead of syncing state in an effect.
        <AutoCompactControls
          key={autoCompact.threshold}
          settings={autoCompact}
          text={text}
        />
      ) : (
        <span />
      )}
      <div className="flex items-center gap-2">
        {onCompact && (
          <CardActionButton
            testId="compact-context-btn"
            disabled={!canCompact || compacting}
            busy={compacting}
            onClick={onCompact}
            tooltip={text.compactContextTooltip ?? text.compactContext}
            label={text.compactContext ?? "压缩"}
            busyLabel={text.compacting ?? "压缩中…"}
            icon={Minimize2}
            busyIconClassName="animate-pulse"
          />
        )}

        {onRefresh && (
          <CardActionButton
            testId="refresh-usage-btn"
            disabled={refreshing}
            busy={refreshing}
            onClick={onRefresh}
            tooltip={text.refreshUsageTooltip ?? text.refreshUsage}
            label={text.refreshUsage ?? "刷新"}
            busyLabel={text.refreshing ?? "刷新中…"}
            icon={RefreshCw}
            feedback={refreshFeedback}
          />
        )}
      </div>
    </div>
  );
}

/** Plan limits: the header with the plan name and manage link, then one
 *  labeled progress bar per rolling limit. */
function PlanLimitsSection({
  limits,
  plan,
  planHref,
  planUsageLimits,
  managePlan,
}: {
  limits: UsageLimit[];
  plan?: string;
  planHref?: string;
  planUsageLimits: string;
  managePlan: string;
}) {
  if (limits.length === 0) return null;
  return (
    <>
      <div className="my-3 h-px w-full bg-separator-border-strong" />

      <div className="flex items-center justify-between gap-3 py-1">
        <span className="text-body-medium text-text-secondary">
          {planUsageLimits}
          {plan ? ` · ${plan}` : ""}
        </span>
        {planHref && (
          <a
            href={planHref}
            aria-label={managePlan}
            className="flex size-6 items-center justify-center rounded-md text-text-tertiary outline-none transition-colors duration-150 hover:bg-background-secondary-hover hover:text-text-secondary focus-visible:ring-2 focus-visible:ring-border-focus-ring"
          >
            <ArrowRight className="size-4" aria-hidden />
          </a>
        )}
      </div>

      <div className="flex flex-col gap-3 pt-1">
        {limits.map((limit) => {
          const pct = Math.round(Math.max(0, Math.min(1, limit.used)) * 100);
          return (
            <div key={limit.label} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-body-medium text-text-primary">{limit.label}</span>
                <span className="flex shrink-0 items-baseline gap-2">
                  <span className="text-body-regular text-text-tertiary">{limit.resets}</span>
                  <span className="w-9 text-right text-body-medium text-text-primary tabular-nums">{pct}%</span>
                </span>
              </div>
              <Bar>
                <div
                  className="h-full rounded-full transition-[width] duration-500 ease-out"
                  style={{ width: `${pct}%`, backgroundColor: "var(--color-chart-6)" }}
                />
              </Bar>
            </div>
          );
        })}
      </div>
    </>
  );
}

export function AgentLimitsCard({
  context,
  plan,
  planHref,
  limits = [],
  defaultExpanded = false,
  onExpandedChange,
  text,
  onCompact,
  onRefresh,
  compacting = false,
  refreshing = false,
  canCompact = true,
  autoCompact,
  className,
}: AgentLimitsCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  const counted = useMemo(() => context.segments.filter((s) => !s.deferred), [context.segments]);
  const used = useMemo(() => counted.reduce((sum, s) => sum + s.tokens, 0), [counted]);
  const free = useMemo(() => Math.max(0, context.max - used), [context.max, used]);
  const tones = useMemo(
    () => context.segments.map((s, i) => resolveTone(i + 1, s.color)),
    [context.segments],
  );

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    onExpandedChange?.(next);
  };

  const toggleGroup = (label: string) =>
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });

  return (
    <section
      className={cx(
        "flex w-full min-w-0 flex-col rounded-2xl bg-background-secondary-default px-4 pt-2.5 pb-4",
        className,
      )}
    >
      {/* ---------------------------------------------- context window */}
      <ContextHeader
        label={text.contextWindow}
        used={used}
        max={context.max}
        expanded={expanded}
        onToggle={toggle}
      />

      <Bar className="mt-1.5">
        {context.segments.map((s, i) =>
          s.deferred ? null : (
            <div
              key={s.label}
              className="h-full shrink-0 transition-[width] duration-500 ease-out"
              style={{ width: `${shareOf(s.tokens, context.max)}%`, backgroundColor: tones[i].color }}
              title={`${s.label} · ${formatTokens(s.tokens)}`}
            />
          ),
        )}
      </Bar>

      <Collapsible
        open={expanded}
        seconds={0.32}
        // The panel clips while collapsing, so it bleeds 8px past the content
        // and pads back in - the hover pills on the rows below extend into
        // that gutter and keep their rounded corners.
        innerClassName="-mx-2 px-2"
      >
        <SegmentLegend
          segments={context.segments}
          tones={tones}
          max={context.max}
          free={free}
          freeSpace={text.freeSpace}
          groups={context.groups}
          openGroups={openGroups}
          onToggleGroup={toggleGroup}
        />
      </Collapsible>

      {/* ---------------------------------------------- actions: compact & refresh */}
      <ContextActions
        text={text}
        onCompact={onCompact}
        onRefresh={onRefresh}
        compacting={compacting}
        refreshing={refreshing}
        canCompact={canCompact}
        autoCompact={autoCompact}
      />

      {/* ------------------------------------------------- plan limits */}
      <PlanLimitsSection
        limits={limits}
        plan={plan}
        planHref={planHref}
        planUsageLimits={text.planUsageLimits}
        managePlan={text.managePlan}
      />
    </section>
  );
}
