import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

type TooltipPlacement = "top" | "bottom";

interface VisibleTooltip {
  target: HTMLElement;
  text: string;
  x: number;
  y: number;
  placement: TooltipPlacement;
}

const SHOW_DELAY = 300;
const VIEWPORT_GUTTER = 16;
// Gap between the target and the tooltip box; the 8px SVG arrow bridges it.
const ARROW_OFFSET = 8;
// Subpixel border snapping moves the measured box by a fraction of a pixel
// after each write. Treat anything under 1px as already clamped.
const POSITION_EPSILON = 1;

function targetFromEvent(eventTarget: EventTarget | null, root: HTMLElement) {
  const element = eventTarget instanceof Element
    ? eventTarget
    : eventTarget instanceof Node
      ? eventTarget.parentElement
      : null;
  const target = element?.closest<HTMLElement>("[data-native-tooltip]");
  return target && root.contains(target) ? target : null;
}

// Pre-measurement estimate painted on the first (pre-clamp) render only; the
// layout effect below repositions the measured box before the browser paints.
function getPosition(target: HTMLElement) {
  const rect = target.getBoundingClientRect();
  const placement: TooltipPlacement = rect.top >= 80 ? "top" : "bottom";
  const x = Math.min(
    Math.max(rect.left + rect.width / 2, VIEWPORT_GUTTER),
    window.innerWidth - VIEWPORT_GUTTER,
  );
  return {
    x,
    y: placement === "top" ? rect.top - ARROW_OFFSET : rect.bottom + ARROW_OFFSET,
    placement,
  };
}

// Measured clamp. w-max on the node makes width max-content, so `left` cannot
// change the used width and writing the result back cannot reflow the box.
function clampMeasured(rect: DOMRect, width: number, height: number) {
  const halfWidth = width / 2;
  const x = Math.round(Math.min(
    Math.max(rect.left + rect.width / 2, VIEWPORT_GUTTER + halfWidth),
    window.innerWidth - VIEWPORT_GUTTER - halfWidth,
  ));

  const fitsAbove = rect.top - ARROW_OFFSET - height >= VIEWPORT_GUTTER;
  const fitsBelow =
    window.innerHeight - rect.bottom - ARROW_OFFSET - height >= VIEWPORT_GUTTER;
  const placement: TooltipPlacement = fitsAbove
    ? "top"
    : fitsBelow
      ? "bottom"
      : rect.top >= window.innerHeight - rect.bottom ? "top" : "bottom";

  const y = Math.round(placement === "top"
    ? Math.max(rect.top - ARROW_OFFSET, VIEWPORT_GUTTER + height)
    : Math.min(
        rect.bottom + ARROW_OFFSET,
        window.innerHeight - VIEWPORT_GUTTER - height,
      ));
  return { x, y, placement };
}

/**
 * Converts native HTML title attributes into the app TooltipContent surface.
 * This keeps legacy and third-party UI on the same themed tooltip treatment
 * without requiring every title-bearing control to be manually rewritten.
 */
export function NativeTitleTooltip() {
  const [visible, setVisible] = useState<VisibleTooltip | null>(null);
  const activeTarget = useRef<HTMLElement | null>(null);
  const showTimer = useRef<number | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const managedRemovals = useRef(new WeakSet<HTMLElement>());
  // Position we already published. The effect depends on `visible`, so writing
  // x/y back would measure again; long titles reflow and that never settles.
  const clamped = useRef<{ text: string; x: number; y: number; placement: TooltipPlacement } | null>(null);

  useEffect(() => {
    const root = document.getElementById("root");
    if (!root) return;

    const clearShowTimer = () => {
      if (showTimer.current !== null) {
        window.clearTimeout(showTimer.current);
        showTimer.current = null;
      }
    };

    const hide = () => {
      clearShowTimer();
      activeTarget.current = null;
      setVisible(null);
    };

    const syncTitle = (element: HTMLElement) => {
      const title = element.getAttribute("title");
      if (title) {
        element.dataset.nativeTooltip = title;
        managedRemovals.current.add(element);
        // Keep an empty attribute so a later React removal still emits an
        // observable mutation after the native value has been intercepted.
        element.setAttribute("title", "");
        return;
      }
      if (!managedRemovals.current.has(element)) {
        delete element.dataset.nativeTooltip;
      }
      managedRemovals.current.delete(element);
    };

    const scan = (node: Node) => {
      if (node instanceof HTMLElement && node.hasAttribute("title")) syncTitle(node);
      if (!(node instanceof Element)) return;
      for (const element of node.querySelectorAll<HTMLElement>("[title]")) {
        syncTitle(element);
      }
    };

    scan(root);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes" && record.target instanceof HTMLElement) {
          syncTitle(record.target);
          if (activeTarget.current === record.target) {
            const text = record.target.dataset.nativeTooltip;
            if (text) {
              setVisible((current) => current ? { ...current, text } : current);
            } else {
              hide();
            }
          }
          continue;
        }
        for (const node of record.addedNodes) scan(node);
      }
    });
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["title"] });

    const scheduleShow = (target: HTMLElement) => {
      const text = target.dataset.nativeTooltip;
      if (!text) return;
      clearShowTimer();
      activeTarget.current = target;
      showTimer.current = window.setTimeout(() => {
        showTimer.current = null;
        const text = target.dataset.nativeTooltip;
        if (!target.isConnected || !text) return;
        const position = getPosition(target);
        setVisible({ target, text, ...position });
      }, SHOW_DELAY);
    };

    const onPointerOver = (event: PointerEvent) => {
      const target = targetFromEvent(event.target, root);
      if (!target) return;
      const related = event.relatedTarget;
      if (related instanceof Node && target.contains(related)) return;
      scheduleShow(target);
    };
    const onPointerOut = (event: PointerEvent) => {
      const target = targetFromEvent(event.target, root);
      if (!target) return;
      const related = event.relatedTarget;
      if (related instanceof Node && target.contains(related)) return;
      if (activeTarget.current === target) hide();
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = targetFromEvent(event.target, root);
      if (target) scheduleShow(target);
    };
    const onFocusOut = (event: FocusEvent) => {
      const target = targetFromEvent(event.target, root);
      if (!target) return;
      const related = event.relatedTarget;
      if (related instanceof Node && target.contains(related)) return;
      if (activeTarget.current === target) hide();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    const onScroll = () => hide();
    const onResize = () => {
      setVisible((current) => {
        if (!current || !current.target.isConnected) return null;
        return { ...current, ...getPosition(current.target) };
      });
    };

    root.addEventListener("pointerover", onPointerOver);
    root.addEventListener("pointerout", onPointerOut);
    root.addEventListener("focusin", onFocusIn);
    root.addEventListener("focusout", onFocusOut);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      hide();
      observer.disconnect();
      root.removeEventListener("pointerover", onPointerOver);
      root.removeEventListener("pointerout", onPointerOut);
      root.removeEventListener("focusin", onFocusIn);
      root.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  // The estimate clamps only the anchor point, so wide or tall tips could hang
  // off an edge. Measure once per text/position and publish a single correction.
  // Feeding every measured pixel back into `visible` re-runs this effect; long
  // titles then reflow and React hits the nested update limit.
  useLayoutEffect(() => {
    const element = tooltipRef.current;
    if (!visible || !element) {
      clamped.current = null;
      return;
    }
    const published = clamped.current;
    if (
      published &&
      published.text === visible.text &&
      published.placement === visible.placement &&
      published.x === visible.x &&
      published.y === visible.y
    ) {
      return;
    }
    const { width, height } = element.getBoundingClientRect();
    if (!width || !height) return;
    const next = clampMeasured(visible.target.getBoundingClientRect(), width, height);
    if (
      visible.placement === next.placement &&
      Math.abs(visible.x - next.x) < POSITION_EPSILON &&
      Math.abs(visible.y - next.y) < POSITION_EPSILON
    ) {
      clamped.current = { text: visible.text, x: visible.x, y: visible.y, placement: visible.placement };
      return;
    }
    clamped.current = { text: visible.text, ...next };
    setVisible((current) =>
      current && current.text === visible.text ? { ...current, ...next } : current,
    );
  }, [visible]);

  if (!visible) return null;
  const transform = visible.placement === "top"
    ? "translate(-50%, -100%)"
    : "translateX(-50%)";
  return createPortal(
    <div
      ref={tooltipRef}
      role="tooltip"
      className="pointer-events-none fixed z-[130] w-max max-w-[min(360px,calc(100vw-32px))] rounded-lg border border-border-button-default bg-background-primary-default px-2 py-1 text-caption-1-medium text-text-secondary shadow-dropdown whitespace-pre-line break-words transition duration-150 ease-out"
      data-placement={visible.placement}
      style={{ left: visible.x, top: visible.y, transform }}
    >
      {visible.text}
      <svg
        aria-hidden
        viewBox="0 0 8 8"
        className={visible.placement === "top"
          ? "absolute -bottom-2 left-1/2 size-2 -translate-x-1/2 fill-background-primary-default stroke-border-button-default"
          : "absolute -top-2 left-1/2 size-2 -translate-x-1/2 rotate-180 fill-background-primary-default stroke-border-button-default"}
      >
        <path d="M0 0 L4 4 L8 0" />
      </svg>
    </div>,
    document.body,
  );
}
