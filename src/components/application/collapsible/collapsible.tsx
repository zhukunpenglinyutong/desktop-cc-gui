import type { ReactNode } from "react";
import { cx } from "@/utils/cx";

const COLLAPSE_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

/**
 * CSS grid-rows accordion: the panel's real box grows/collapses, so siblings
 * are pushed smoothly, while the browser interpolates — no per-frame JS and
 * no motion layout props. Content stays mounted so the collapse can animate;
 * `visibility` flips to hidden at the END of closing, dropping the closed
 * panel out of the tab order and a11y tree. When open it is left to inherit
 * the ancestor instead of forcing `visible`: a forced value would keep the
 * content painted inside hidden tabs/surfaces (the editor find card used to
 * leak its replace row over the next file tab this way).
 */
export function Collapsible({
  open,
  seconds,
  className,
  innerClassName,
  children,
}: {
  open: boolean;
  /** Collapse/expand duration in seconds. */
  seconds: number;
  className?: string;
  /** Classes for the clipping wrapper (e.g. bleed gutters). */
  innerClassName?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={className}
      style={{
        display: "grid",
        gridTemplateRows: open ? "1fr" : "0fr",
        opacity: open ? 1 : 0,
        visibility: open ? undefined : "hidden",
        transition:
          `grid-template-rows ${seconds}s ${COLLAPSE_EASE}, ` +
          `opacity ${seconds}s ${COLLAPSE_EASE}, ` +
          `visibility 0s ${open ? "0s" : `${seconds}s`}`,
      }}
    >
      <div className={cx("min-h-0 overflow-hidden", innerClassName)}>{children}</div>
    </div>
  );
}
