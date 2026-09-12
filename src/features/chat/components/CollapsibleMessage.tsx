import { memo, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useReducedMotion } from "motion/react";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronUp from "lucide-react/dist/esm/icons/chevron-up";
import { cx } from "@/utils/cx";

/** Taller than this and the message is offered collapsed. */
const COLLAPSE_THRESHOLD_PX = 480;
/** Clamped height while collapsed — a few paragraphs stay readable above
 *  the fade. */
const COLLAPSED_HEIGHT_PX = 320;

const toggleBtn =
  "flex size-6 cursor-pointer items-center justify-center rounded-full bg-white/25 text-text-white transition-colors hover:bg-white/40";

/** Long user messages collapse behind a bottom fade with a centered
 *  chevron — a pasted document no longer floods the timeline. The fade
 *  dissolves into the bubble fill and the toggle rides as translucent
 *  white, matching the bubble surface.
 *
 *  Measurement rides on `scrollHeight` of the clamped box, so it reports
 *  the full content height in both states and a late-loading image
 *  re-deciding `collapsible` just works. The toggle animates `max-height`
 *  between the clamp and that measured height instead of hard-cutting;
 *  the first render still collapses instantly (`max-height: none` is not
 *  a transitionable length, so only user toggles animate). */
export const CollapsibleMessage = memo(function CollapsibleMessage({
  children,
}: {
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [collapsible, setCollapsible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [contentHeight, setContentHeight] = useState(0);

  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const measure = () => {
      const h = el.scrollHeight;
      setContentHeight(h);
      setCollapsible(h > COLLAPSE_THRESHOLD_PX);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const collapsed = collapsible && !expanded;
  return (
    <div className="relative">
      <div
        ref={contentRef}
        style={
          collapsible
            ? {
                maxHeight: collapsed ? COLLAPSED_HEIGHT_PX : contentHeight,
                overflow: "hidden",
                transition: reduceMotion
                  ? undefined
                  : "max-height 240ms ease-out",
              }
            : undefined
        }
      >
        {children}
      </div>
      {/* Content dissolves into the bubble fill instead of hard-cutting
          (same recipe as the settings page top fade). Kept mounted in both
          states so the fade eases out alongside the height animation. */}
      {collapsible && (
        <div
          aria-hidden
          className={cx(
            "pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-linear-to-t from-bubble-user to-transparent",
            "transition-opacity duration-200",
            collapsed ? "opacity-100" : "opacity-0",
          )}
        />
      )}
      {collapsed && (
        <button
          type="button"
          aria-expanded={false}
          aria-label={t("chat.messageExpand")}
          title={t("chat.messageExpand")}
          onClick={() => setExpanded(true)}
          className={`${toggleBtn} absolute bottom-1 left-1/2 -translate-x-1/2`}
        >
          <ChevronDown className="size-3.5" aria-hidden />
        </button>
      )}
      {collapsible && expanded && (
        <button
          type="button"
          aria-expanded={true}
          aria-label={t("chat.messageCollapse")}
          title={t("chat.messageCollapse")}
          onClick={() => setExpanded(false)}
          className={`${toggleBtn} mx-auto mt-1`}
        >
          <ChevronUp className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
});
