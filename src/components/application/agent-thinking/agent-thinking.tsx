"use client";

import { useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { cx } from "@/utils/cx";

/**
 * Agent Thinking — the agent "thinking" state that sits above a chat composer
 * while a response is being worked on.
 *
 * Four curated variants:
 * - `wave`     dot grid with a diagonal wavefront gliding top-left → bottom-right
 * - `spin`     dot grid with a bright head orbiting the grid clockwise
 * - `stars`    sparkles twinkling in and out with a stagger
 * - `infinity` a comet trail sweeping a figure-eight
 *
 * Every variant pairs the indicator with a shimmering label and an elapsed
 * timer that starts when the loader mounts. Shimmer and CSS animations fall
 * back to static rendering under `prefers-reduced-motion` (see globals.css).
 */

export type AgentThinkingVariant = "wave" | "spin" | "stars" | "infinity";
export type AgentThinkingTone = "subtle" | "default" | "primary" | "accent";

export interface AgentThinkingProps {
  variant?: AgentThinkingVariant;
  /** Status label, e.g. "Thinking" or "Searching the docs" — required, already
   *  localized by the caller (i18n lives in feature code). */
  label: string;
  /** Tone of the indicator + label. Defaults per variant (`stars` is subtle). */
  tone?: AgentThinkingTone;
  /** Animated highlight traveling across the label. */
  shimmer?: boolean;
  /** Elapsed seconds since mount, rendered after the label. */
  showTimer?: boolean;
  /** Epoch ms the timed work began. When set, the timer counts from this
   * fixed origin instead of mount time, so an unmount/remount cycle keeps
   * counting instead of restarting from 0. */
  startedAt?: number;
  className?: string;
  /** Optional custom formatter for the elapsed timer string (e.g. "耗时 2m2s"). */
  durationFormatter?: (elapsed: string) => string;
  /** Pre-localized model label (e.g. "模型 gemini-3.8-flash"). */
  model?: string | null;
  /** Pre-localized reasoning effort label (e.g. "推理档位 high"). */
  effort?: string | null;
  /** Engine-reported token usage for the running turn ("↑12.3k ↓412"),
   *  refreshed as the CLI reports it. */
  usage?: string | null;
  /** Live provider-retry progress, pre-localized (e.g. "重试中 2/5"). Shown
   *  at the end of the meta row: the CLI is backing off and will re-issue the
   *  request, so this is progress rather than a failure. */
  retry?: string | null;
  /** The provider's own reason for the retry ("HTTP 502", "stream
   *  disconnected"), revealed on hover. */
  retryDetail?: string | null;
  /** Extra meta-row content rendered right after the effort label. A slot
   *  on purpose: the data and its own hover card belong to feature code. */
  metaExtra?: ReactNode;
}

const TONE_COLORS: Record<AgentThinkingTone, string> = {
  subtle: "var(--color-text-tertiary)",
  default: "var(--color-text-secondary)",
  primary: "var(--color-text-primary)",
  accent: "var(--color-blue-500)",
};

const VARIANT_TONE: Record<AgentThinkingVariant, AgentThinkingTone> = {
  wave: "default",
  spin: "default",
  stars: "subtle",
  infinity: "default",
};

/* ------------------------------------------------------------------- dots */

const DOTS_GRID = 3;
const DOTS_SIZE = 4;
const DOTS_GAP = 2;
const DOTS_TICK_MS = 80;
const DOTS_FADE_MS = 220;
const DOTS_TRAIL = 0.3;
const DOTS_MIN_OPACITY = 0.12;
const DOTS_PHASE_STEP = 1 / 8;

// Static first frame: identical on server and client, and the resting state
// under prefers-reduced-motion.
const DOTS_SEED = [0.55, 0.3, 0.15, 0.85, 0.55, 0.3, 1, 0.85, 0.55];

/**
 * How far along the pattern's travel direction each cell sits, in [0, 1),
 * precomputed per variant at module scope: the scalars never change, so the
 * 80ms tick below only runs the phase math, not nine atan2 calls a frame.
 * The wave scalar is compressed below 1 so the phase wrap reads as the front
 * leaving the grid and re-entering; the spin angle is naturally cyclic.
 */
const DOT_SCALARS: Record<"wave" | "spin", number[]> = {
  wave: Array.from({ length: DOTS_GRID * DOTS_GRID }, (_, i) => {
    const m = DOTS_GRID - 1;
    return ((i % DOTS_GRID + Math.floor(i / DOTS_GRID)) / (2 * m)) * (DOTS_GRID / (DOTS_GRID + 1));
  }),
  spin: Array.from({ length: DOTS_GRID * DOTS_GRID }, (_, i) => {
    const center = (DOTS_GRID - 1) / 2;
    return (Math.atan2(Math.floor(i / DOTS_GRID) - center, (i % DOTS_GRID) - center) / (2 * Math.PI) + 1) % 1;
  }),
};

function dotOpacities(variant: "wave" | "spin", phase: number) {
  return DOT_SCALARS[variant].map((s) => {
    // Comet: bright head at the phase front, tail fading behind it.
    const behind = (phase - s + 1) % 1;
    const lit = Math.max(0, 1 - behind / DOTS_TRAIL) ** 1.5;
    return DOTS_MIN_OPACITY + (1 - DOTS_MIN_OPACITY) * lit;
  });
}

function DotsIndicator({ variant, animated }: { variant: "wave" | "spin"; animated: boolean }) {
  const [opacities, setOpacities] = useState<number[]>(DOTS_SEED);

  useEffect(() => {
    if (
      !animated ||
      (typeof window !== "undefined" &&
        window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches)
    )
      return;
    let phase = 0;
    let id: number | null = null;
    const start = () => {
      if (id !== null || document.hidden) return;
      id = window.setInterval(() => {
        phase = (phase + DOTS_PHASE_STEP) % 1;
        setOpacities(dotOpacities(variant, phase));
      }, DOTS_TICK_MS);
    };
    const stop = () => {
      if (id === null) return;
      window.clearInterval(id);
      id = null;
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [animated, variant]);

  return (
    <span
      aria-hidden
      className="grid shrink-0"
      style={{
        gridTemplateColumns: `repeat(${DOTS_GRID}, ${DOTS_SIZE}px)`,
        gap: DOTS_GAP,
      }}
    >
      {opacities.map((opacity, i) => (
        <span
          key={i}
          className="rounded-[1px] bg-current"
          style={{
            width: DOTS_SIZE,
            height: DOTS_SIZE,
            opacity,
            transition: animated ? `opacity ${DOTS_FADE_MS}ms ease` : undefined,
          }}
        />
      ))}
    </span>
  );
}

/* ------------------------------------------------------------------ stars */

const STAR_PERIOD_S = 1.4;
const STAR_SIZE = 14;
const STAR_COUNT = 5;
const STAR_LAYOUT = [
  { x: 50, y: 46, scale: 1 },
  { x: 18, y: 22, scale: 0.55 },
  { x: 82, y: 26, scale: 0.45 },
  { x: 78, y: 76, scale: 0.55 },
  { x: 22, y: 78, scale: 0.4 },
];
const STAR_PATH = "M12 0C13 7 17 11 24 12C17 13 13 17 12 24C11 17 7 13 0 12C7 11 11 7 12 0Z";
const STAR_BOX = STAR_SIZE * 1.5;

const STATIC_STAR_STYLE: CSSProperties = {
  animation: "none",
  transform: "none",
  opacity: 0.7,
};

function buildStarsIndicator(staticState: boolean) {
  return (
    <span
      aria-hidden
      className="bui-agent-thinking-stars relative block shrink-0"
      style={{ width: STAR_BOX, height: STAR_BOX }}
    >
      {STAR_LAYOUT.slice(0, STAR_COUNT).map((star, i) => {
        const size = STAR_SIZE * star.scale;
        return (
          <svg
            key={i}
            viewBox="0 0 24 24"
            className="bui-agent-thinking-star absolute"
            style={{
              width: size,
              height: size,
              left: `${star.x}%`,
              top: `${star.y}%`,
              marginLeft: -size / 2,
              marginTop: -size / 2,
              animationDuration: `${STAR_PERIOD_S}s`,
              animationDelay: `${(i * STAR_PERIOD_S * 0.7) / STAR_COUNT}s`,
              ...(staticState ? STATIC_STAR_STYLE : {}),
            }}
          >
            <path d={STAR_PATH} fill="currentColor" />
          </svg>
        );
      })}
    </span>
  );
}

// Build both variants once: retry mode uses a visible resting frame instead
// of leaving each star at the animated keyframe's scale(0) start state.
const STARS_INDICATOR = buildStarsIndicator(false);
const STATIC_STARS_INDICATOR = buildStarsIndicator(true);

function StarsIndicator({ animated }: { animated: boolean }) {
  return animated ? STARS_INDICATOR : STATIC_STARS_INDICATOR;
}

/* --------------------------------------------------------------- infinity */

const INFINITY_WIDTH = 32;
const INFINITY_TRAIL = 11;
const INFINITY_STROKE = 2.75;
const INFINITY_DURATION_S = 1.2;
const INFINITY_PATH =
  "M28 14C33 5 47 5 47 14C47 23 33 23 28 14C23 5 9 5 9 14C9 23 23 23 28 14Z";

function InfinityIndicator() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 56 28"
      className="shrink-0"
      // The figure-eight spans x 9-47 of the 56-wide viewBox, so the svg box
      // carries ~4px of dead space per side at this width; pull it back in so
      // the label sits at the loader's real gap.
      style={{ width: INFINITY_WIDTH, height: INFINITY_WIDTH / 2, margin: "0 -4px" }}
    >
      <path
        d={INFINITY_PATH}
        fill="none"
        stroke="currentColor"
        strokeWidth={INFINITY_STROKE}
        opacity={0.15}
      />
      <path
        d={INFINITY_PATH}
        pathLength={100}
        fill="none"
        stroke="currentColor"
        strokeWidth={INFINITY_STROKE}
        strokeLinecap="round"
        strokeDasharray={`${INFINITY_TRAIL} ${100 - INFINITY_TRAIL}`}
        className="bui-agent-thinking-comet"
        style={{ animationDuration: `${INFINITY_DURATION_S}s` }}
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ timer */

/** Under 60s: "12.3s"; 60s+: "2m12s"; 1h+: "1h23m" (finer units are noise at that scale). */
function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m${Math.floor(seconds % 60)}s`;
  return `${Math.floor(m / 60)}h${m % 60}m`;
}

function ElapsedTimer({
  startedAt,
  formatter,
}: {
  startedAt?: number;
  formatter?: (elapsed: string) => string;
}) {
  const [elapsed, setElapsed] = useState(() =>
    startedAt ? Math.max(0, (Date.now() - startedAt) / 1000) : 0,
  );

  useEffect(() => {
    // 500ms cadence: visually smooth enough for "12.3s" without waking React 10x/s,
    // and pauses completely while the window/tab is hidden.
    const origin = startedAt ?? performance.now();
    const readElapsed = () =>
      startedAt
        ? Math.max(0, (Date.now() - origin) / 1000)
        : (performance.now() - origin) / 1000;
    let id: number | null = null;
    const start = () => {
      if (id !== null || document.hidden) return;
      setElapsed(readElapsed());
      id = window.setInterval(() => setElapsed(readElapsed()), 500);
    };
    const stop = () => {
      if (id === null) return;
      window.clearInterval(id);
      id = null;
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [startedAt]);

  const raw = formatElapsed(elapsed);
  return (
    <span className="font-mono text-caption-1-regular text-text-tertiary tabular-nums">
      {formatter ? formatter(raw) : raw}
    </span>
  );
}

/* ----------------------------------------------------------------- loader */

function VariantIndicator({ variant, animated }: { variant: AgentThinkingVariant; animated: boolean }) {
  if (variant === "wave" || variant === "spin") {
    return <DotsIndicator variant={variant} animated={animated} />;
  }
  if (variant === "stars") {
    return <StarsIndicator animated={animated} />;
  }
  return <InfinityIndicator />;
}

/** One meta-row entry, preceded by the "·" separator. */
function MetaItem({ children }: { children: ReactNode }) {
  return (
    <>
      <span aria-hidden className="text-text-tertiary">·</span>
      {children}
    </>
  );
}

type MetaRowProps = Pick<
  AgentThinkingProps,
  | "showTimer"
  | "startedAt"
  | "durationFormatter"
  | "usage"
  | "model"
  | "effort"
  | "retry"
  | "retryDetail"
  | "metaExtra"
>;

function MetaRow({
  showTimer,
  startedAt,
  durationFormatter,
  usage,
  model,
  effort,
  retry,
  retryDetail,
  metaExtra,
}: MetaRowProps) {
  if (!(showTimer || model || effort || usage || retry || metaExtra)) {
    return null;
  }
  return (
    <div className="flex items-center gap-1.5 text-caption-1-regular text-text-tertiary tabular-nums">
      {showTimer && (
        <ElapsedTimer
          startedAt={startedAt}
          formatter={durationFormatter}
        />
      )}
      {usage && <MetaItem><span>{usage}</span></MetaItem>}
      {model && <MetaItem><span>{model}</span></MetaItem>}
      {effort && <MetaItem><span>{effort}</span></MetaItem>}
      {metaExtra}
      {retry && (
        <MetaItem>
          {/* Progress, not an error: a retry that recovers is invisible
              apart from this chip, and one that fails surfaces as the
              turn's own error banner. */}
          <span title={retryDetail ?? undefined} className="text-text-warning-primary">
            {retry}
          </span>
        </MetaItem>
      )}
    </div>
  );
}

export function AgentThinking({
  variant = "wave",
  label,
  tone,
  shimmer = true,
  showTimer = true,
  startedAt,
  className,
  durationFormatter,
  model,
  effort,
  usage,
  retry,
  retryDetail,
  metaExtra,
}: AgentThinkingProps) {
  const color = TONE_COLORS[tone ?? VARIANT_TONE[variant]];
  const animated = !retry;

  return (
    <div
      role="status"
      className={cx(
        "flex items-center gap-2.5",
        retry && "bui-agent-thinking-static",
        className,
      )}
      style={{ color, "--bui-agent-thinking-tone": color } as CSSProperties}
    >
      <VariantIndicator variant={variant} animated={animated} />
      <span
        aria-label={label}
        className={cx("text-body-medium", shimmer && animated && "bui-agent-thinking-label")}
      >
        {label}
      </span>
      <MetaRow
        showTimer={showTimer}
        startedAt={startedAt}
        durationFormatter={durationFormatter}
        model={model}
        effort={effort}
        usage={usage}
        retry={retry}
        retryDetail={retryDetail}
        metaExtra={metaExtra}
      />
    </div>
  );
}
