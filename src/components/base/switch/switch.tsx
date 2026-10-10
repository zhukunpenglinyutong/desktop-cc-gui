"use client";

import { forwardRef, type ReactNode } from "react";
import { Switch as AriaSwitch } from "react-aria-components";
import type { SwitchProps as AriaSwitchProps } from "react-aria-components";
import { cx } from "@/utils/cx";
import { switchSizes } from "./switch-sizes";

/**
 * Figma source: Board UI → "Toogles" (node 3856:3807).
 *
 * Two shapes × three sizes, plus off / on:
 *   shape   pill        (Figma "fully rounded") — track & thumb rounded-full
 *           rectangle   (Figma "rectangle")     — track radius/md-scale, thumb radius/xs-scale
 *   size    sm 28×16 · md 42×24 · lg 56×32   (track w×h; thumb = h − 2·pad)
 *
 * Anatomy (all values 1:1 with Figma):
 *   track   off → bg background/tertiary/default (#ebebeb, no border)
 *           on  → Button/Primary gradient (blue/500 → blue/600) + an inset
 *                 ring + top highlight that scales with size. lg is exactly
 *                 the shared `--shadow-checkbox-selected` token; md/sm scale
 *                 the ring (0.75px / 0.5px) and highlight (1.5px / 1px).
 *   thumb   theme-stable white gradient + contact shadow,
 *           slides by (w − thumb − 2·pad) between states.
 *   chip    small embossed inset in the thumb centre:
 *           off → white→neutral-100 in light mode; in dark mode it matches
 *                 the track so the mark reads like a hole through the thumb;
 *           on  → switch-on-chip-start→end (accent mixes matching Figma's
 *                 raw #2473fe→#0450e2 for blue), accent/600 border.
 *
 * The track visual lives in `SwitchTrack` so `Switch` and `SwitchCard` share it
 * (mirrors how Checkbox / CheckboxCard share `CheckboxGlyph`). Built on
 * react-aria Switch: native toggle semantics, keyboard support, focus-visible
 * ring, optional label via `children`.
 */

export type SwitchSize = "sm" | "md" | "lg";
export type SwitchShape = "pill" | "rectangle";

export interface SwitchVisualState {
  isSelected: boolean;
  isDisabled: boolean;
  isFocusVisible: boolean;
}

/**
 * The track + thumb + chip visual. Pure presentation — the react-aria Switch
 * (in `Switch` or `SwitchCard`) owns the input and passes its render state in.
 */
export function SwitchTrack({
  state,
  size = "md",
  shape = "pill",
}: {
  state: SwitchVisualState;
  size?: SwitchSize;
  shape?: SwitchShape;
}) {
  const s = switchSizes[size];

  return (
    <span
      aria-hidden
      className={cx(
        "relative shrink-0 transition-colors duration-200 ease",
        s.track,
        s.trackRadius[shape],
        state.isSelected
          ? cx("bg-linear-to-b from-accent-500 to-accent-600", s.onShadow)
          : "bg-background-tertiary-default",
        state.isDisabled && "opacity-50",
        state.isFocusVisible && "ring-2 ring-border-focus-ring ring-offset-2",
      )}
    >
      {/* Thumb */}
      <span
        className={cx(
          "absolute flex items-center justify-center",
          "bg-linear-to-b from-control-indicator-background from-[43.837%] to-control-indicator-background-subtle",
          "shadow-[0_3px_3px_0_rgb(0_0_0/0.03),0_0.75px_0_0_rgb(0_0_0/0.05)]",
          "transition-transform duration-200 ease",
          s.thumb,
          s.thumbRadius[shape],
          s.offset,
          state.isSelected && s.travel,
        )}
      >
        {/* Embossed inner chip. Gradient runs bottom→top (`to-t`) — equivalent
            to the Figma layer's vertical flip — but WITHOUT a transform, so the
            chip stays pixel-snapped/centred (no blurry 1px shift at sub-pixel
            sizes) and its drop shadow points down instead of up. */}
        <span
          className={cx(
            "border-solid bg-linear-to-t from-[43.837%]",
            s.chip,
            s.chipRadius[shape],
            state.isSelected
              ? "border-accent-600 from-switch-on-chip-start to-switch-on-chip-end"
              : "border-border-button-default/50 from-switch-off-chip-start to-switch-off-chip-end",
          )}
        />
      </span>
    </span>
  );
}

export interface SwitchProps extends Omit<AriaSwitchProps, "children"> {
  children?: ReactNode;
  size?: SwitchSize;
  shape?: SwitchShape;
}

/**
 * `forwardRef` is load-bearing: react-aria's tooltip/`Focusable` wrappers
 * clone their trigger and need the ref to land on a DOM node. A plain function
 * component that merely reads `ref` out of props does not get one under React
 * 18 — React logs "Function components cannot be given refs", the trigger ref
 * stays null, and the tooltip anchors to the viewport corner instead of the
 * pill.
 */
export const Switch = forwardRef<HTMLLabelElement, SwitchProps>(function Switch(
  { className, children, size = "md", shape = "pill", ...props },
  ref,
) {
  return (
    <AriaSwitch
      ref={ref}
      {...props}
      className={(state) =>
        cx(
          "group inline-flex items-center gap-2 select-none",
          state.isDisabled ? "cursor-not-allowed" : "cursor-pointer",
          typeof className === "function" ? className(state) : className,
        )
      }
    >
      {(state) => (
        <>
          <SwitchTrack state={state} size={size} shape={shape} />
          {children != null && children !== false && (
            <span className="text-body-medium text-text-primary">{children}</span>
          )}
        </>
      )}
    </AriaSwitch>
  );
});
