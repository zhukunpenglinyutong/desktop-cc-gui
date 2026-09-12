import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Pause from "lucide-react/dist/esm/icons/pause";
import Play from "lucide-react/dist/esm/icons/play";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import { SettingsCard } from "@/components/application/settings/settings-rows";
import { ipc, type UsageRow } from "@/lib/ipc";
import { listenUsageChanged } from "@/lib/events";
import {
  setUsageTrackingEnabled,
  usageTrackingEnabled,
} from "./usage-tracking";
import { UsageChart } from "./UsageChart";
import { modelDisplayName } from "./usage-model";
import { tokensOf } from "./usage-totals";
import { formatTokens } from "@/utils/format-tokens";
import { EngineIcon } from "@/components/foundations/icons/engine-icon";
import { CLI_DISPLAY_NAMES } from "@/components/foundations/icons/engine-brands";
import { ModelBadge } from "@/components/foundations/icons/model-badge";
import type { EngineIconId } from "@/components/foundations/icons/engine-icon";

type Range = "today" | "week" | "month";

/** Same affordance the message rows use: bare icon, hover-revealed chrome. */
const ICON_BUTTON =
  "flex size-7 cursor-pointer items-center justify-center rounded-md text-foreground-icon-secondary transition-colors hover:bg-background-tertiary-hover hover:text-foreground-icon-primary";

const RANGES: { id: Range; labelKey: string }[] = [
  { id: "today", labelKey: "usage.rangeToday" },
  { id: "week", labelKey: "usage.rangeWeek" },
  { id: "month", labelKey: "usage.rangeMonth" },
];

/** Local "YYYY-MM-DD" for a Date (matches the ledger's day buckets). */
function dayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** First local day of the selected range: today, this week (Monday), or the
 *  1st of this month — the calendar the labels promise. */
function rangeStart(range: Range, now: Date): string {
  if (range === "today") return dayKey(now);
  if (range === "month") return dayKey(new Date(now.getFullYear(), now.getMonth(), 1));
  const monday = new Date(now);
  // getDay(): 0 = Sunday; step back to the most recent Monday.
  const back = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - back);
  return dayKey(monday);
}

interface Totals {
  key: string;
  engine: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  requests: number;
}

const emptyTotals = (key: string, engine: string): Totals => ({
  key,
  engine,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  requests: 0,
});

function fold(rows: UsageRow[], keyOf: (row: UsageRow) => string, engineOf: (row: UsageRow) => string): Totals[] {
  const map = new Map<string, Totals>();
  for (const row of rows) {
    const key = keyOf(row);
    const entry = map.get(key) ?? emptyTotals(key, engineOf(row));
    entry.input += row.input;
    entry.output += row.output;
    entry.cacheRead += row.cacheRead;
    entry.cacheWrite += row.cacheWrite;
    entry.requests += row.requests;
    map.set(key, entry);
  }
  const total = (e: Totals) => e.input + e.output + e.cacheRead + e.cacheWrite;
  return [...map.values()].sort((a, b) => total(b) - total(a));
}

const sum = (entries: Totals[]) =>
  entries.reduce(
    (acc, e) => ({
      input: acc.input + e.input,
      output: acc.output + e.output,
      cacheRead: acc.cacheRead + e.cacheRead,
      cacheWrite: acc.cacheWrite + e.cacheWrite,
      requests: acc.requests + e.requests,
    }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 0 },
  );

/** Horizontal share bar: the list's own scale, no chart dependency. */
function ShareBar({ pct }: { pct: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-background-tertiary-default">
      <div className="h-full rounded-full bg-accent-500" style={{ width: `${pct}%` }} />
    </div>
  );
}

const ENGINE_ICON_IDS: readonly EngineIconId[] = ["claude", "codex", "grok", "kimi", "pi", "omp", "dsh"];
const isEngineIcon = (engine: string): engine is EngineIconId =>
  ENGINE_ICON_IDS.includes(engine as EngineIconId);

/**
 * Token usage page: a local ledger of finished turns (see
 * `src-tauri/src/usage.rs`). Nothing is reconstructed from history — the
 * switch below is the feature's own boundary — and nothing leaves the
 * machine. The list refreshes live on `usage://changed`.
 */
export function UsageSection() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [range, setRange] = useState<Range>("today");
  const [enabled, setEnabled] = useState(usageTrackingEnabled);
  const [confirmClear, setConfirmClear] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      // 90 days covers the month view with room for the weekly roll-up.
      const next = await ipc.usageSummary(90, -new Date().getTimezoneOffset());
      setRows(next);
    } catch {
      // A failed read keeps the last good snapshot on screen.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const unlisten = listenUsageChanged(() => void refresh());
    return () => {
      void unlisten.then((off) => off());
    };
  }, [refresh]);

  const scoped = useMemo(() => {
    const from = rangeStart(range, new Date());
    return rows.filter((row) => row.day >= from);
  }, [rows, range]);

  const byEngine = useMemo(() => fold(scoped, (row) => row.engine, (row) => row.engine), [scoped]);
  // 详细数据 nests the models under their CLI: the per-CLI total is what the
  // outer row shows, the models are the breakdown. Rows fold by the model's
  // own name, so a relay-qualified slug and the engine's plain id are one row.
  const byCli = useMemo(() => {
    const clis = new Map<string, { engine: string; models: Totals[] }>();
    for (const row of scoped) {
      const cli = clis.get(row.engine) ?? { engine: row.engine, models: [] };
      const name = modelDisplayName(row.model);
      const existing = cli.models.find((m) => m.key === name);
      const entry = existing ?? emptyTotals(name, row.engine);
      entry.input += row.input;
      entry.output += row.output;
      entry.cacheRead += row.cacheRead;
      entry.cacheWrite += row.cacheWrite;
      entry.requests += row.requests;
      if (!existing) cli.models.push(entry);
      clis.set(row.engine, cli);
    }
    for (const cli of clis.values()) {
      cli.models.sort((a, b) => tokensOf(b) - tokensOf(a));
    }
    return [...clis.values()].sort(
      (a, b) =>
        b.models.reduce((acc, m) => acc + tokensOf(m), 0) -
        a.models.reduce((acc, m) => acc + tokensOf(m), 0),
    );
  }, [scoped]);
  const totals = useMemo(() => sum(byEngine), [byEngine]);
  const perDay = useMemo(() => {
    // One point per local day in the range, gaps filled with 0. The cursor is
    // built from LOCAL parts: `new Date("YYYY-MM-DD")` parses as UTC, which
    // lands later in the day than "now" east of Greenwich and produced an
    // empty series.
    const [year, month, day] = rangeStart(range, new Date()).split("-").map(Number);
    const today = dayKey(new Date());
    const byDay = new Map<string, number>();
    for (const row of scoped) {
      byDay.set(row.day, (byDay.get(row.day) ?? 0) + tokensOf(row));
    }
    const days: { day: string; tokens: number }[] = [];
    for (const cursor = new Date(year, month - 1, day); ; cursor.setDate(cursor.getDate() + 1)) {
      const key = dayKey(cursor);
      if (key > today) break;
      days.push({ day: key, tokens: byDay.get(key) ?? 0 });
    }
    return days;
  }, [scoped, range]);

  return (
    <div className="flex w-full flex-col gap-2">
      <SettingsCard>
        <div className="flex w-full flex-col gap-3 p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1 rounded-lg bg-background-tertiary-default p-0.5">
              {RANGES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setRange(item.id)}
                  className={
                    item.id === range
                      ? "cursor-pointer rounded-md bg-background-primary-default px-2.5 py-1 text-body-2-medium text-text-primary shadow-sm"
                      : "cursor-pointer rounded-md px-2.5 py-1 text-body-2-medium text-text-secondary"
                  }
                >
                  {t(item.labelKey)}
                </button>
              ))}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                aria-label={enabled ? t("usage.trackingDisable") : t("usage.trackingEnable")}
                title={enabled ? t("usage.trackingDisable") : t("usage.trackingEnable")}
                onClick={() => {
                  const next = !enabled;
                  setUsageTrackingEnabled(next);
                  setEnabled(next);
                }}
                className={ICON_BUTTON}
              >
                {enabled ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
              </button>
              <button
                type="button"
                aria-label={t("usage.clear")}
                title={confirmClear ? t("usage.clearConfirm") : t("usage.clear")}
                onClick={() => {
                  if (!confirmClear) {
                    setConfirmClear(true);
                    return;
                  }
                  void ipc
                    .usageClear()
                    .then(() => {
                      setConfirmClear(false);
                      void refresh();
                    })
                    .catch(() => setConfirmClear(false));
                }}
                onBlur={() => setConfirmClear(false)}
                className={confirmClear ? `${ICON_BUTTON} text-text-error-primary` : ICON_BUTTON}
              >
                <Trash2 className="size-4" aria-hidden />
              </button>
        </div>
          </div>
          <div className="flex gap-3">
            <div className="flex flex-1 flex-col gap-0.5">
              <span className="text-body-2-regular text-text-secondary">{t("usage.tokens")}</span>
              <span className="text-title-3 text-text-primary tabular-nums">
                {formatTokens(tokensOf(totals))}
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-0.5">
              <span className="text-body-2-regular text-text-secondary">{t("usage.input")}</span>
              <span className="text-title-3 text-text-primary tabular-nums">
                {/* Prompt-side input: fresh tokens plus cache reads/writes, so
                    累计 = 输入 + 输出 holds on screen. */}
                {formatTokens(totals.input + totals.cacheRead + totals.cacheWrite)}
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-0.5">
              <span className="text-body-2-regular text-text-secondary">{t("usage.output")}</span>
              <span className="text-title-3 text-text-primary tabular-nums">
                {formatTokens(totals.output)}
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-0.5">
              <span className="text-body-2-regular text-text-secondary">{t("usage.turns")}</span>
              <span className="text-title-3 text-text-primary tabular-nums">{totals.requests}</span>
            </div>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard>
        <div className="flex flex-col gap-3 p-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-body-medium text-text-primary">{t("usage.chartTitle")}</span>
            <span className="text-body-2-regular text-text-tertiary">
              {t("usage.chartTotal", { tokens: formatTokens(tokensOf(totals)) })}
            </span>
          </div>
          <UsageChart rows={scoped} days={perDay.map((point) => point.day)} formatTokens={formatTokens} />
        </div>
      </SettingsCard>

      <SettingsCard>
        <div className="flex flex-col gap-3 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-body-medium text-text-primary">{t("usage.details")}</span>
            <span className="text-body-2-regular text-text-tertiary">{t("usage.perRange")}</span>
          </div>
          {loading ? (
            <p className="py-2 text-body-regular text-text-tertiary">{t("usage.loading")}</p>
          ) : byCli.length === 0 ? (
            <p className="py-2 text-body-regular text-text-tertiary">{t("usage.empty")}</p>
          ) : (
            <div className="flex flex-col gap-4">
              {byCli.map((cli) => {
                const total = cli.models.reduce((acc, m) => acc + tokensOf(m), 0);
                const maxModel = cli.models.length ? tokensOf(cli.models[0]) : 0;
                return (
                  <div key={cli.engine} className="flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2">
                        {isEngineIcon(cli.engine) && (
                          <EngineIcon
                            engine={cli.engine}
                            size={16}
                            className="shrink-0 text-foreground-icon-primary"
                          />
                        )}
                        <span className="text-body-medium text-text-primary">
                          {CLI_DISPLAY_NAMES[cli.engine] ?? cli.engine}
                        </span>
                      </span>
                      <span className="text-body-medium text-text-secondary tabular-nums">
                        {formatTokens(total)}
                      </span>
                    </div>
                    <div className="flex flex-col gap-2 pl-6">
                      {cli.models.map((model) => (
                        <div key={model.key || "__unknown__"} className="flex w-full flex-col gap-1">
                          <div className="flex items-center justify-between gap-3">
                            <span className="flex min-w-0 items-center gap-1.5">
                              <ModelBadge name={model.key} size={12} className="shrink-0" />
                              <span className="truncate text-body-regular text-text-primary">
                                {model.key || t("usage.unknownModel")}
                              </span>
                            </span>
                            <span className="shrink-0 text-body-2-regular text-text-secondary tabular-nums">
                              {formatTokens(tokensOf(model))}
                            </span>
                          </div>
                          <ShareBar
                            pct={maxModel > 0 ? Math.max(2, Math.round((tokensOf(model) / maxModel) * 100)) : 0}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </SettingsCard>

      <p className="px-1 text-body-2-regular text-text-tertiary">{t("usage.footnote")}</p>
    </div>
  );
}
