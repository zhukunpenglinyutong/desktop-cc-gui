import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

type DictationWaveformProps = {
  active: boolean;
  processing: boolean;
  level: number;
};

const MAX_BARS = 36;
const MIN_BAR = 0.08;

function normalizeLevel(level: number) {
  if (!Number.isFinite(level)) {
    return 0;
  }
  return Math.min(1, Math.max(0, level));
}

export function DictationWaveform({
  active,
  processing,
  level,
}: DictationWaveformProps) {
  const { t } = useTranslation();
  const [bars, setBars] = useState<number[]>(
    () => new Array(MAX_BARS).fill(0),
  );
  const normalized = normalizeLevel(level);

  useEffect(() => {
    if (!active) {
      setBars(new Array(MAX_BARS).fill(0));
      return;
    }
    setBars((prev) => {
      const next = prev.slice(1);
      const value = Math.max(MIN_BAR, normalized);
      next.push(value);
      return next;
    });
  }, [active, normalized]);

  const barHeights = useMemo(
    () =>
      bars.map((value) => `${Math.round((MIN_BAR + value * 0.92) * 100)}%`),
    [bars],
  );

  return (
    <div
      className={`composer-waveform relative mt-2.5 flex h-10 items-end gap-[3px] rounded-[10px] border border-[var(--border-muted)] bg-card px-2 py-1.5${processing ? " is-processing" : ""}`}
      aria-hidden
    >
      {processing && <span className="composer-waveform-label pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] uppercase tracking-[0.02em] text-[var(--text-subtle)]">{t("messages.processing")}</span>}
      {barHeights.map((height, index) => (
        <span
          key={index}
          className="composer-waveform-bar min-w-0.5 flex-1 rounded-full bg-[#7aaccc] transition-[height] duration-[120ms] ease-in-out"
          style={{ height }}
        />
      ))}
    </div>
  );
}
