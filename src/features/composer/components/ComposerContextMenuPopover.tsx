import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

type ComposerContextMenuPopoverProps = {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  closeOnBackdropClick?: boolean;
  panelClassName?: string;
  panelProps?: HTMLAttributes<HTMLDivElement>;
  children: ReactNode;
};

type PopoverPlacement = "top" | "bottom";

type PopoverPosition = {
  left: number;
  top: number;
  maxHeight: number;
  placement: PopoverPlacement;
};

const VIEWPORT_MARGIN = 8;
const MENU_GAP = 8;

function clamp(value: number, min: number, max: number) {
  if (max < min) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

export function ComposerContextMenuPopover({
  open,
  anchorRef,
  onClose,
  closeOnBackdropClick = true,
  panelClassName,
  panelProps,
  children,
}: ComposerContextMenuPopoverProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<PopoverPosition | null>(null);

  const updatePosition = useCallback(() => {
    if (!open) {
      return;
    }
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) {
      return;
    }

    const anchorRect = anchor.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const panelWidth = panelRect.width || 900;
    const panelHeight = panelRect.height || 320;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const left = clamp(
      anchorRect.left,
      VIEWPORT_MARGIN,
      viewportWidth - panelWidth - VIEWPORT_MARGIN,
    );

    const availableTop = anchorRect.top - MENU_GAP - VIEWPORT_MARGIN;
    const availableBottom =
      viewportHeight - anchorRect.bottom - MENU_GAP - VIEWPORT_MARGIN;
    const shouldPlaceBottom = panelHeight > availableTop && availableBottom > availableTop;
    const placement: PopoverPlacement = shouldPlaceBottom ? "bottom" : "top";
    const top =
      placement === "top"
        ? Math.max(VIEWPORT_MARGIN, anchorRect.top - MENU_GAP - panelHeight)
        : Math.min(
            viewportHeight - VIEWPORT_MARGIN - panelHeight,
            anchorRect.bottom + MENU_GAP,
          );
    const maxHeight =
      placement === "top"
        ? Math.max(120, anchorRect.top - MENU_GAP - VIEWPORT_MARGIN)
        : Math.max(120, viewportHeight - anchorRect.bottom - MENU_GAP - VIEWPORT_MARGIN);

    setPosition({ left, top, maxHeight, placement });
  }, [anchorRef, open]);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    updatePosition();
    const rafId = requestAnimationFrame(updatePosition);
    return () => cancelAnimationFrame(rafId);
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleWindowChange = () => updatePosition();
    const scrollOptions = { capture: true, passive: true } as const;
    window.addEventListener("resize", handleWindowChange);
    window.addEventListener("scroll", handleWindowChange, scrollOptions);
    return () => {
      window.removeEventListener("resize", handleWindowChange);
      window.removeEventListener("scroll", handleWindowChange, scrollOptions);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose, open]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  const { className: panelPropsClassName, style: panelPropsStyle, ...restPanelProps } =
    panelProps ?? {};
  const panelStyle: CSSProperties = {
    ...(panelPropsStyle ?? {}),
    left: position?.left ?? VIEWPORT_MARGIN,
    top: position?.top ?? VIEWPORT_MARGIN,
    maxHeight: position?.maxHeight,
  };
  const mergedClassName = [
    "composer-context-menu-panel",
    "composer-context-menu-panel--portal",
    "fixed bottom-auto z-[1200] flex min-w-[900px] w-[min(1120px,94vw)] max-h-[min(570px,66vh)] flex-col gap-1.5 overflow-x-hidden overflow-y-auto rounded-xl border border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--surface-elevated)_96%,#0b1020)] p-2 shadow-[0_16px_40px_rgba(0,0,0,0.4)] backdrop-blur-lg",
    panelClassName,
    panelPropsClassName,
    position?.placement ? `is-placement-${position.placement}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return createPortal(
    <>
      <div
        className="composer-context-backdrop fixed inset-0 z-[1190] bg-transparent"
        onClick={closeOnBackdropClick ? onClose : undefined}
        style={closeOnBackdropClick ? undefined : { pointerEvents: "none" }}
        aria-hidden="true"
      />
      <div ref={panelRef} className={mergedClassName} style={panelStyle} {...restPanelProps}>
        {children}
      </div>
    </>,
    document.body,
  );
}
