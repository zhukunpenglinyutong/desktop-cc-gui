import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { EngineIcon, type EngineIconId } from "@/components/foundations/icons/engine-icon";
import { CLI_DISPLAY_NAMES } from "@/components/foundations/icons/engine-brands";
import { ModelBadge } from "@/components/foundations/icons/model-badge";
import { modelDisplayName } from "./usage-model";
import { tokensOf } from "./usage-totals";
import type { UsageBucket } from "./usage-buckets";
import type { UsageRow } from "@/lib/ipc";

/**
 * Stacked token chart: one bar per bucket — a local day, a local month, or a
 * whole CLI — with one segment per model and a hover breakdown. Hand-rolled
 * SVG on purpose — the page ships no chart dependency, and the shape needed
 * here (stacked bars + tooltip + legend) is smaller than the smallest library
 * that could draw it.
 */

/** Series colors, assigned by descending total. Categorical palette that
 *  stays legible on the dark canvas and in light mode. */
const PALETTE = [
  "#34d399", // emerald
  "#fbbf24", // amber
  "#38bdf8", // sky
  "#a78bfa", // violet
  "#fb7185", // rose
  "#facc15", // yellow
  "#2dd4bf", // teal
  "#f97316", // orange
  "#94a3b8", // slate
];

const OTHER_COLOR = "#64748b";
/** Model shades inside a CLI row: distinguishable, but clearly a family. */
const MODEL_SHADES = ["#34d399", "#fbbf24", "#38bdf8", "#a78bfa", "#fb7185", "#facc15"];

export interface UsageChartProps {
  rows: UsageRow[];
  /** One column per bucket, in draw order. */
  buckets: UsageBucket[];
  /** Bucket key a ledger row belongs to; a row whose key is missing from
   *  `buckets` is not drawn. */
  bucketOf: (row: UsageRow) => string;
  /** Scale cap in tokens; bars share it so buckets stay comparable. */
  formatTokens: (n: number) => string;
  /** Name of the selected range (今日/本周/本月/本年/总和) — the axis
   *  tooltip's title. */
  axisLabel: string;
  /** Per-column total label, e.g. 当天合计 / 当月合计 / 合计. */
  bucketTotalLabel: string;
}

interface Series {
  /** CLI display name (series key). */
  model: string;
  /** Engine id behind the CLI, for its brand mark. */
  engine: string;
  color: string;
  values: number[];
  total: number;
  /** Models inside this CLI, largest first — the tooltip's second level. */
  models: { name: string; color: string; values: number[]; total: number }[];
}

/** Readable axis step: 1/2/5 × 10^n covering `max` in ~4 ticks. */
function axisMax(max: number): number {
  if (max <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  for (const factor of [1, 2, 2.5, 5, 10]) {
    const candidate = magnitude * factor;
    if (candidate >= max) return candidate;
  }
  return magnitude * 10;
}

/** Tooltip breakdown: one pass over the series (and one over each CLI's
 *  models), keeping non-zero entries in series order. `tokensFor` picks the
 *  number to show per CLI/model — one bucket's slot, or the range's sum. */
function buildTooltipRows(
  series: Series[],
  tokensFor: (values: number[]) => number,
  formatTokens: (n: number) => string,
): ReactNode[] {
  const rows: ReactNode[] = [];
  for (const cli of series) {
    const tokens = tokensFor(cli.values);
    if (tokens <= 0) continue;
    const modelRows: ReactNode[] = [];
    for (const model of cli.models) {
      const modelTokens = tokensFor(model.values);
      if (modelTokens <= 0) continue;
      modelRows.push(
        <span
          key={model.name}
          className="flex items-center justify-between gap-3 pl-5 text-caption-1-regular"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <ModelBadge name={model.name} size={11} className="shrink-0" />
            <span className="truncate text-text-tertiary">{model.name}</span>
          </span>
          <span className="shrink-0 tabular-nums text-text-tertiary">
            {formatTokens(modelTokens)}
          </span>
        </span>,
      );
    }
    rows.push(
      <span key={cli.engine} className="flex flex-col gap-0.5">
        <span className="flex items-center justify-between gap-3 text-body-2-regular">
          <span className="flex min-w-0 items-center gap-1.5">
            <EngineIcon
              engine={cli.engine as EngineIconId}
              size={12}
              className="shrink-0 text-foreground-icon-primary"
            />
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-sm"
              style={{ backgroundColor: cli.color }}
            />
            <span className="truncate text-text-secondary">{cli.model}</span>
          </span>
          <span className="shrink-0 tabular-nums text-text-primary">
            {formatTokens(tokens)}
          </span>
        </span>
        {modelRows}
      </span>,
    );
  }
  return rows;
}

export function UsageChart({
  rows,
  buckets,
  bucketOf,
  formatTokens,
  axisLabel,
  bucketTotalLabel,
}: UsageChartProps) {
  const { t } = useTranslation();
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  /** The axis gutter answers the other question the columns cannot: how much
   *  the whole selected range holds, not one bucket of it. */
  const [hoverAxis, setHoverAxis] = useState(false);
  // The tooltip trails the pointer (clamped to the chart box) instead of
  // being pinned to the hovered column: pinning made it jump to the other
  // side near the edges and widened the settings pane into a scrollbar.
  const boxRef = useRef<HTMLDivElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [tipPos, setTipPos] = useState<{ left: number; top: number } | null>(null);

  // Rows are matched to columns by bucket key, never by array position: the
  // CLI columns are ordered by total while the series are ordered by their
  // own totals, and the two must not have to agree.
  const indexOf = useMemo(
    () => new Map(buckets.map((bucket, index) => [bucket.key, index])),
    [buckets],
  );

  const { series, bucketTotals, max } = useMemo(() => {
    // Stack by CLI (the details card's top level), with each CLI's models kept
    // for the tooltip — the chart and 详细数据 then describe the same thing.
    const byCli = new Map<string, Map<string, number[]>>();
    for (const row of rows) {
      // Same fold as 详细数据: the chart and the details card must describe
      // one model per row, whatever slug the session ran.
      const name = modelDisplayName(row.model) || t("usage.unknownModel");
      const models = byCli.get(row.engine) ?? new Map<string, number[]>();
      const perBucket = models.get(name) ?? new Array(buckets.length).fill(0);
      const index = indexOf.get(bucketOf(row));
      if (index !== undefined) {
        perBucket[index] += tokensOf(row);
      }
      models.set(name, perBucket);
      byCli.set(row.engine, models);
    }
    const built: Series[] = [...byCli.entries()]
      .map(([engine, models]) => {
        const entries = [...models.entries()].map(([name, values]) => ({
          name,
          values,
          total: values.reduce((acc, n) => acc + n, 0),
          color: OTHER_COLOR,
        }));
        entries.sort((a, b) => b.total - a.total);
        return {
          model: CLI_DISPLAY_NAMES[engine] ?? engine,
          engine,
          color: OTHER_COLOR,
          values: buckets.map((_, index) => entries.reduce((acc, e) => acc + (e.values[index] ?? 0), 0)),
          total: entries.reduce((acc, e) => acc + e.total, 0),
          models: entries,
        };
      })
      .sort((a, b) => b.total - a.total);
    built.forEach((entry, index) => {
      entry.color = PALETTE[index % PALETTE.length];
      entry.models.forEach((model, modelIndex) => {
        // Same hue as the CLI, stepped lighter per model so the tooltip reads
        // as a breakdown of the bar rather than a different data set.
        model.color = MODEL_SHADES[modelIndex % MODEL_SHADES.length];
      });
    });
    const totals = buckets.map((_bucket, index) =>
      built.reduce((acc, s) => acc + (s.values[index] ?? 0), 0),
    );
    const peak = Math.max(...totals, 0);
    return { series: built, bucketTotals: totals, max: axisMax(peak) };
  }, [rows, buckets, bucketOf, indexOf, t]);

  // Fixed viewBox: the panel is a known width, and uniform scaling keeps the
  // label sizes honest instead of stretching text non-uniformly.
  const W = 620;
  const H = 220;
  const padLeft = 52;
  const padRight = 8;
  const padTop = 10;
  const padBottom = 26;
  const plotW = W - padLeft - padRight;
  const plotH = H - padTop - padBottom;
  const step = plotW / Math.max(buckets.length, 1);
  // Bar width follows the bucket count: a month of days packs slim columns,
  // a single day fills a readable slab instead of leaving one hairline in the
  // plot. The cap keeps ≤7-bucket views from looking like solid blocks.
  const barW = Math.max(3, Math.min(step * 0.62, 76));
  const y = (tokens: number) => padTop + plotH - (tokens / max) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  // Thin the labels so they never collide.
  const labelEvery = Math.max(1, Math.ceil(buckets.length / 8));

  const hoverIndex = hoverKey ? indexOf.get(hoverKey) ?? -1 : -1;
  const hoverBucket = hoverIndex >= 0 ? buckets[hoverIndex] : undefined;
  const hoverTotal = hoverIndex >= 0 ? bucketTotals[hoverIndex] : 0;
  const tooltipRows = hoverIndex >= 0 ? buildTooltipRows(series, (values) => values[hoverIndex] ?? 0, formatTokens) : [];
  /** Same breakdown, summed over every bucket the range covers. */
  const rangeTotal = bucketTotals.reduce((acc, n) => acc + n, 0);
  const axisRows = hoverAxis
    ? buildTooltipRows(series, (values) => values.reduce((acc, n) => acc + n, 0), formatTokens)
    : [];

  useLayoutEffect(() => {
    const box = boxRef.current;
    const tip = tipRef.current;
    if (!box || !tip || !cursor) {
      setTipPos(null);
      return;
    }
    const bounds = box.getBoundingClientRect();
    const size = tip.getBoundingClientRect();
    // Stay inside the settings pane (not just the chart): anything past it
    // widened the pane into a scrollbar. Bounds are the pane's edges mapped
    // into this wrapper's coordinates.
    const pane = box.closest("[role='dialog']")?.getBoundingClientRect() ?? bounds;
    const left = pane.left - bounds.left + 4;
    const right = pane.right - bounds.left - 4;
    const top = pane.top - bounds.top + 4;
    const bottom = pane.bottom - bounds.top - 4;
    // Auto side: prefer the pointer's right, flip to its left when the box
    // would not fit there.
    const flips = right - cursor.x < size.width + 18;
    const desiredLeft = flips ? cursor.x - size.width - 14 : cursor.x + 14;
    setTipPos({
      left: Math.max(left, Math.min(desiredLeft, right - size.width)),
      top: Math.max(top, Math.min(cursor.y + 14, bottom - size.height)),
    });
  }, [cursor, hoverKey, hoverAxis]);

  return (
    <div
      ref={boxRef}
      className="relative flex w-full flex-col gap-2"
      onMouseMove={(event) => {
        const box = boxRef.current?.getBoundingClientRect();
        if (!box) return;
        setCursor({ x: event.clientX - box.left, y: event.clientY - box.top });
      }}
      onMouseLeave={() => {
        setCursor(null);
        setHoverAxis(false);
      }}
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={t("usage.chartLabel")}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={padLeft}
              x2={W - padRight}
              y1={y(tick)}
              y2={y(tick)}
              stroke="var(--color-separator-border)"
              strokeDasharray={tick === 0 ? undefined : "3 4"}
            />
            <text
              x={padLeft - 8}
              y={y(tick) + 3.5}
              textAnchor="end"
              className="fill-text-tertiary"
              style={{ fontSize: 10 }}
            >
              {formatTokens(tick)}
            </text>
          </g>
        ))}
        {/* Axis gutter: hovering the scale totals the whole selected range —
            the question the per-bucket columns cannot answer. Covers the tick
            labels too, so the hit area is forgiving. */}
        <rect
          x={0}
          y={padTop}
          width={padLeft}
          height={plotH}
          fill="transparent"
          onMouseEnter={() => {
            setHoverAxis(true);
            setHoverKey(null);
          }}
          onMouseLeave={() => setHoverAxis(false)}
        />
        {buckets.map((bucket, bucketIndex) => {
          const x = padLeft + bucketIndex * step + (step - barW) / 2;
          let cursor = 0;
          return (
            <g key={bucket.key}>
              {/* Hit area spans the full column so hovering is forgiving. */}
              <rect
                x={padLeft + bucketIndex * step}
                y={padTop}
                width={step}
                height={plotH}
                fill={hoverIndex === bucketIndex ? "var(--color-background-primary-hover)" : "transparent"}
                onMouseEnter={() => setHoverKey(bucket.key)}
                onMouseLeave={() => setHoverKey((current) => (current === bucket.key ? null : current))}
              />
              {series.map((s) => {
                const tokens = s.values[bucketIndex] ?? 0;
                if (tokens <= 0) return null;
                const height = (tokens / max) * plotH;
                const segmentY = padTop + plotH - cursor - height;
                cursor += height;
                return (
                  <rect
                    key={s.model}
                    x={x}
                    y={segmentY}
                    width={barW}
                    height={Math.max(height - 0.6, 0.6)}
                    fill={s.color}
                    pointerEvents="none"
                  />
                );
              })}
              {bucketIndex % labelEvery === 0 && (
                <text
                  x={padLeft + bucketIndex * step + step / 2}
                  y={H - 8}
                  textAnchor="middle"
                  className="fill-text-tertiary"
                  style={{ fontSize: 10 }}
                >
                  {bucket.axis}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {(hoverIndex >= 0 || hoverAxis) && (
        <div
          ref={tipRef}
          className="pointer-events-none absolute z-10 flex min-w-[150px] flex-col gap-1 rounded-lg border border-separator-border bg-background-primary-default p-2 shadow-dropdown"
          style={tipPos ? { left: tipPos.left, top: tipPos.top } : { left: 0, top: 0, visibility: "hidden" }}
        >
          <span className="text-body-2-regular text-text-tertiary">
            {hoverAxis ? axisLabel : hoverBucket?.title}
          </span>
          <span className="flex items-baseline justify-between gap-3 text-body-2-medium text-text-primary">
            <span>{hoverAxis ? t("usage.rangeTooltipTotal") : bucketTotalLabel}</span>
            <span className="tabular-nums">
              {formatTokens(hoverAxis ? rangeTotal : hoverTotal)}
            </span>
          </span>
          {hoverAxis ? axisRows : tooltipRows}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {series.map((s) => (
          <span key={s.engine} className="flex min-w-0 items-center gap-1.5 text-body-2-regular text-text-secondary">
            <EngineIcon
              engine={s.engine as EngineIconId}
              size={14}
              className="shrink-0 text-foreground-icon-primary"
            />
            <span aria-hidden className="size-2 shrink-0 rounded-sm" style={{ backgroundColor: s.color }} />
            <span className="max-w-[150px] truncate">{s.model}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
