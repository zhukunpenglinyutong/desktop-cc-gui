"use client";

import { useEffect, useRef, useState, type ComponentProps, type ComponentType, type ReactNode } from "react";
import Info from "lucide-react/dist/esm/icons/info";
import {
  Focusable,
  OverlayArrow as AriaOverlayArrow,
  Tooltip as AriaTooltip,
  TooltipTrigger as AriaTooltipTrigger,
} from "react-aria-components";
import { cx } from "@/utils/cx";

/**
 * Tooltip — hover hint for truncated or icon-only content.
 *
 * Composable primitives on react-aria, same contract as Dropdown: `Tooltip`
 * wraps a trigger element (any focusable element works) and one
 * `TooltipContent`; hover/focus opens after `delay`, moving away closes
 * immediately. Never put essential copy here — it is unreachable on touch.
 *
 * The trigger MUST be a react-aria component (Button, Link, …) or a plain
 * element wrapped in `Focusable`. AriaTooltipTrigger passes its ref and
 * hover/focus handlers through FocusableContext, which only those consume;
 * a bare DOM element leaves the trigger ref null, so useOverlayPosition
 * never measures it and the tooltip pins to `top:0; left:0` — the viewport
 * corner — instead of anchoring to the trigger.
 */

export interface TooltipProps extends ComponentProps<typeof AriaTooltipTrigger> {}

export function Tooltip({ delay = 500, closeDelay = 0, ...props }: TooltipProps) {
  return <AriaTooltipTrigger delay={delay} closeDelay={closeDelay} {...props} />;
}

export interface TooltipContentProps
  extends Pick<ComponentProps<typeof AriaTooltip>, "placement" | "offset"> {
  children: ReactNode;
  className?: string;
}

export function TooltipContent({
  placement = "top",
  offset = 6,
  className,
  children,
}: TooltipContentProps) {
  return (
    <AriaTooltip
      placement={placement}
      offset={offset}
      className={cx(
        "max-w-[min(360px,calc(100vw-32px))] rounded-lg border border-border-button-default",
        "bg-background-primary-default px-2 py-1 shadow-dropdown",
        "text-caption-1-medium text-text-secondary",
        "transition duration-150 ease-out",
        "data-[entering]:opacity-0 data-[entering]:scale-95 data-[exiting]:opacity-0",
        "data-[placement=bottom]:origin-top data-[placement=top]:origin-bottom",
        className,
      )}
    >
      <AriaOverlayArrow>
        <svg
          viewBox="0 0 8 8"
          className="size-2 fill-background-primary-default stroke-border-button-default data-[placement=bottom]:rotate-180"
        >
          <path d="M0 0 L4 4 L8 0" />
        </svg>
      </AriaOverlayArrow>
      {children}
    </AriaTooltip>
  );
}

/**
 * InfoTip — clickable ⓘ hint next to a label.
 *
 * A plain Tooltip only opens on hover (after `delay`) or keyboard focus, so
 * clicking the icon used to do nothing and felt dead. InfoTip additionally
 * pins the tip open on click: it stays visible while the pointer moves away
 * and closes on outside press, Escape, or a second click.
 *
 * `icon` swaps the default ⓘ for a note that reads as a caution instead.
 */
export function InfoTip({
  label,
  icon: Icon = Info,
  tone = "hint",
}: {
  label: string;
  icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
  /** Lets the trigger double as a status light: red while something failed,
   *  green once it went through. "hint" is the ordinary muted ⓘ. */
  tone?: "hint" | "error" | "success";
}) {
  const [hoverOpen, setHoverOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!pinned) return;
    const onPointerDown = (e: PointerEvent) => {
      if (triggerRef.current?.contains(e.target as Node)) return;
      setPinned(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPinned(false);
    };
    // Unpin on scroll too: react-aria closes hover-driven tooltips when a
    // parent scrolls, and a pinned one would otherwise float detached.
    const onScroll = () => setPinned(false);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [pinned]);

  return (
    <Tooltip isOpen={pinned || hoverOpen} onOpenChange={setHoverOpen} delay={300}>
      <Focusable>
        <button
          ref={triggerRef}
          type="button"
          aria-label={label}
          // Never let the hint click bubble into a surrounding clickable row.
          onClick={(e) => {
            e.stopPropagation();
            setPinned((p) => !p);
          }}
          className={cx(
            "inline-flex shrink-0 cursor-help items-center justify-center transition-colors",
            tone === "error"
              ? "text-text-error-primary"
              : tone === "success"
                ? "text-notification-success-foreground"
                : "text-foreground-icon-quaternary hover:text-text-secondary",
          )}
        >
          <Icon className="size-3.5" aria-hidden />
        </button>
      </Focusable>
      <TooltipContent className="max-w-[320px] whitespace-pre-line">{label}</TooltipContent>
    </Tooltip>
  );
}
