import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cx } from "@/utils/cx";
import { useBrowserOcclusion } from "@/features/browser/occlusion";

export interface ContextMenuEntry {
  id: string;
  label: ReactNode;
  icon: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  /** Native tooltip — used to explain why a disabled entry is unavailable. */
  title?: string;
  onSelect: () => void;
}

/**
 * Generic right-click menu chrome, shared by every pointer-anchored context
 * menu in the app (file tree, sidebar workspace rows, …). Rendered in a body
 * portal, anchored to the pointer and clamped into the viewport after first
 * layout. Closes on Escape, outside pointerdown, and window blur/resize.
 *
 * Feature menus (FileTreeContextMenu, WorkspaceContextMenu) own their entry
 * list and handlers; this component owns positioning, dismissal and row
 * rendering so the interaction stays identical everywhere.
 */
export function ContextMenu({
  x,
  y,
  ariaLabel,
  entries,
  onClose,
}: {
  x: number;
  y: number;
  ariaLabel: string;
  entries: (ContextMenuEntry | "separator")[];
  onClose: () => void;
}) {
  // Only mounted while open; hides the native browser webview so menu rows
  // dropping over the browser pane stay visible.
  useBrowserOcclusion(true);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  // Latest-handler ref so the global dismissal listeners below subscribe
  // once yet always invoke the current onClose.
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });

  // Clamp into the viewport once the menu's real size is known.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const clampedX = Math.min(x, window.innerWidth - rect.width - 8);
    const clampedY = Math.min(y, window.innerHeight - rect.height - 8);
    setPos({ x: Math.max(8, clampedX), y: Math.max(8, clampedY) });
  }, [x, y]);

  // Global dismissal: Escape, outside press, blur/resize. Capture phase so
  // the same right-click that opened the menu can't instantly close it.
  useLayoutEffect(() => {
    const close = () => onCloseRef.current();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) close();
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    };
  }, []);

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={ariaLabel}
      className="fixed z-120 flex w-52 flex-col gap-0.5 rounded-xl border border-border-button-default bg-background-primary-default p-1.5 shadow-dropdown"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {entries.map((entry, i) =>
        entry === "separator" ? (
          <hr key={`sep-${i}`} className="mx-1 my-1 h-px border-0 bg-separator-border" />
        ) : (
          <button
            key={entry.id}
            type="button"
            role="menuitem"
            disabled={entry.disabled}
            title={entry.title}
            onClick={() => {
              onClose();
              entry.onSelect();
            }}
            className={cx(
              "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-body-medium outline-none",
              entry.danger
                ? "text-text-error-primary hover:bg-background-primary-hover"
                : "text-text-primary hover:bg-background-primary-hover",
              entry.disabled && "cursor-default opacity-40 hover:bg-transparent",
            )}
          >
            <span className="shrink-0 text-foreground-icon-tertiary" aria-hidden>
              {entry.icon}
            </span>
            <span className="truncate">{entry.label}</span>
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
