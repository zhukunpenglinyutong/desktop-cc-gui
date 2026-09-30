"use client";

/**
 * Vendored from BoardUI Pro (`boardui add agent-creator` →
 * `components/application/theme/accent-gloss.tsx`) and trimmed to the swatch
 * art the agent editor uses: the hue table, the gloss layer stack, one
 * selectable swatch and the rainbow well bitmap. The accent-engine grid and
 * the site-accent helpers are gone (this app colours a bot, not the theme),
 * as is `next/image` — this is a Vite app.
 */

import { GlossLayers } from "@/components/application/theme/custom-color-picker";
import { cx } from "@/utils/cx";

/**
 * Glossy accent swatches — the lit-sphere cells from Figma node 4341:16265,
 * shared by the landing dock and the Color page's accent card. Each cell is
 * a radial base under the GlossLayers reflection stack, sized by className;
 * the active cell carries a 2px inner ring at 30% black.
 *
 * The rainbow well wraps the same art around AccentColorPickerWell, so any
 * surface can offer the custom picker as "one more cell".
 */

/* Figma cell fills: radial gradient, center → edge. The first six are raw
 * fills from the comp (no token yet). The rest are derived from the comp's
 * measured pattern relative to each hue's Tailwind 500 in oklch — center at
 * −0.7% lightness / 84% chroma, edge at −12% lightness / 97% chroma / −4°
 * hue — so every Tailwind hue has a matching lit sphere. */
/** The BoardUI hue vocabulary; spelled out because this file no longer
 *  depends on the accent engine's `TAILWIND_RAMPS`. */
export type GlossHueName =
  | "red" | "orange" | "amber" | "yellow" | "lime" | "green" | "emerald"
  | "teal" | "cyan" | "sky" | "blue" | "indigo" | "violet" | "purple"
  | "fuchsia" | "pink" | "rose";

export const GLOSS_GRADIENTS = {
  red: ["#E74241", "#CF0100"],
  orange: ["#f47327", "#d83f00"],
  amber: ["#F09E38", "#E57F00"],
  yellow: ["#e7b021", "#cd8800"],
  lime: ["#88c81c", "#6aa400"],
  green: ["#36c15c", "#009f13"],
  emerald: ["#55BA82", "#009040"],
  teal: ["#27b5a2", "#00957c"],
  cyan: ["#1bb4ce", "#0093ad"],
  sky: ["#14a3e3", "#0082c6"],
  blue: ["#437EF7", "#004DE9"],
  indigo: ["#5e66ea", "#3a3bd4"],
  violet: ["#8554F6", "#3E00CD"],
  purple: ["#a257f2", "#811ade"],
  fuchsia: ["#d24bec", "#b000d8"],
  pink: ["#E34798", "#D3006D"],
  rose: ["#ee4262", "#cf0043"],
} satisfies Record<GlossHueName, [string, string]>;

export type GlossHue = GlossHueName;

/** Selection marker: a 2px inner ring at 30% black, over the gloss. */
export function ActiveRing() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 rounded-full shadow-[inset_0_0_0_2px_rgb(0_0_0/0.30)]"
    />
  );
}

export interface GlossSwatchProps {
  label?: string;
  hue: GlossHue;
  /** Cell diameter classes (default the comp's size-[26px]). */
  cellClassName?: string;
  active?: boolean;
  onSelect: () => void;
}

/** One glossy hue cell: reports the pick, inner ring when active. */
export function GlossSwatch({ hue, cellClassName = "size-[26px]", active, onSelect, label }: GlossSwatchProps) {
  const [center, edge] = GLOSS_GRADIENTS[hue];
  return (
    <button
      type="button"
      aria-label={label ?? `${hue} accent`}
      aria-pressed={active}
      title={hue}
      onClick={onSelect}
      className={cx(
        "relative shrink-0 cursor-pointer overflow-hidden rounded-full transition-transform duration-150 ease-out hover:scale-110 outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring focus-visible:ring-offset-2",
        cellClassName,
      )}
      style={{
        background: `radial-gradient(closest-side circle at 50% 50%, ${center} 0%, ${edge} 100%)`,
      }}
    >
      <GlossLayers />
      {active ? <ActiveRing /> : null}
    </button>
  );
}

export function RainbowGlossArt() {
  return (
    <span aria-hidden className="absolute inset-0 overflow-hidden rounded-full">
      {/* The vendored block used next/image with `fill`; a plain absolutely
          positioned img is the same box in a Vite app. */}
      <img
        src="/accent-rainbow-well-light.png"
        alt=""
        className="theme-asset-light absolute inset-0 size-full object-cover"
      />
      <img
        src="/accent-rainbow-well-dark.png"
        alt=""
        className="theme-asset-dark absolute inset-0 size-full object-cover"
      />
    </span>
  );
}

/** The rainbow disc: the comp's PNG wheels (public/accent-rainbow-well-light
 * / -dark.png; drop higher-res exports over those files to upgrade, no code
 * change), matte at full opacity. Opens the picker. */
