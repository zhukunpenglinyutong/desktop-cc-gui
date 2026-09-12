import X from "lucide-react/dist/esm/icons/x";
import CircleX from "lucide-react/dist/esm/icons/circle-x";
import Plus from "lucide-react/dist/esm/icons/plus";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ReactNode, KeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import type { LucideIcon } from "lucide-react";
import { isWeb, startWindowDrag } from "@/lib/platform";
import { cx } from "@/utils/cx";
import { ContextMenu } from "@/components/context-menu";
import { EngineIcon } from "@/components/foundations/icons/engine-icon";

// Overlay titlebar leaves the native traffic lights floating over the
// strip's left edge on macOS; other platforms keep their own titlebar.
const IS_MAC =
  typeof navigator !== "undefined" && /macintosh|mac os x/i.test(navigator.userAgent);

// Interactive elements keep their click behavior; any other press inside the
// strip (empty padding, container wrappers, panel header blanks) starts a
// window drag. data-tauri-drag-region alone only fires when the press lands
// on the element carrying the attribute, never on its children — so the
// nested containers swallowing most of the titlebar could not drag.
const DRAG_IGNORE_SELECTOR = "button, a, input, textarea, select, [role='tab']";

export interface SessionTabItem {
  key: string;
  label: string;
  streaming: boolean;
  /** Engine (CLI) id, shown as a brand mark before the label. */
  engine?: string;
  /** Icon for non-session tabs (e.g. files); takes precedence over engine. */
  icon?: LucideIcon;
  /** Finished activity the user has not opened yet — solid green dot. */
  unseen?: boolean;
  /** Unsaved-changes dot before the label. */
  dirty?: boolean;
  /** Tooltip; defaults to the label. */
  title?: string;
}

interface SessionTabStripProps {
  tabs: SessionTabItem[];
  activeKey: string | null;
  onSelect: (key: string) => void;
  onClose: (key: string) => void;
  /** Tab right-click menu entry: close every tab. Omit to hide the menu. */
  onCloseAll?: () => void;
  /** Tab right-click menu entry: close every tab but the one in view. */
  onCloseInactive?: () => void;
  closeLabel: string;
  /** Drag-reorder: dragged tab key dropped before/after a target tab key. */
  onReorder?: (draggedKey: string, targetKey: string, before: boolean) => void;
  /** Invoked by the trailing "+" button; omit to hide it. */
  onNew?: () => void;
  /** Buttons pinned to the strip's right edge, outside the scrolling tabs. */
  actions?: ReactNode;
  /** Node pinned left of the tabs (e.g. a sidebar expand button). */
  leading?: ReactNode;
  /** Reserve the macOS traffic-light inset; turn off while the full-height
   *  sidebar owns the titlebar's left edge. Default true. */
  trafficLightInset?: boolean;
}

/** Custom tab icon when provided, else the engine brand mark. */
function TabLeadingIcon({
  icon: Icon,
  engine,
}: {
  icon?: LucideIcon;
  engine?: string;
}) {
  if (Icon) {
    return (
      <Icon
        className="size-3 shrink-0 text-foreground-icon-secondary"
        aria-hidden
      />
    );
  }
  return (
    <EngineIcon
      engine={engine ?? ""}
      size={12}
      className="size-3 shrink-0 text-foreground-icon-secondary"
    />
  );
}

/** Same status dots as the sidebar: breathing blue while the turn streams,
 * solid green for unseen finished activity. */
function TabStatusDot({
  streaming,
  unseen,
}: {
  streaming: boolean;
  unseen?: boolean;
}) {
  const { t } = useTranslation();
  if (streaming) {
    return (
      <span
        className="sidebar-thread-status sidebar-thread-status-processing"
        role="status"
        aria-label={t("chat.sessionRunning")}
        title={t("chat.sessionRunning")}
      />
    );
  }
  if (unseen) {
    return (
      <span
        className="sidebar-thread-status sidebar-thread-status-unseen"
        aria-label={t("chat.sessionUnseen")}
        title={t("chat.sessionUnseen")}
      />
    );
  }
  return null;
}

/** One tab in the strip: icon, status dots, label, drop indicator, close
 * button. Selection lives on the tab; the close button sits beside it so no
 * focusable control nests inside the tab. */
function SessionTab({
  tab,
  isActive,
  dragged,
  dropBefore,
  closeLabel,
  onShowMenu,
  onSelect,
  onClose,
  onPointerDown,
  suppressClickRef,
}: {
  tab: SessionTabItem;
  isActive: boolean;
  /** This tab is the one being drag-reordered. */
  dragged: boolean;
  /** Drop indicator side, null when this tab is not the drop target. */
  dropBefore: boolean | null;
  closeLabel: string;
  /** Right-click menu anchor; omitted when the strip has no tab menu. */
  onShowMenu?: (position: { x: number; y: number }) => void;
  onSelect: (key: string) => void;
  onClose: (key: string) => void;
  onPointerDown?: (e: ReactPointerEvent<HTMLDivElement>) => void;
  suppressClickRef: React.MutableRefObject<boolean>;
}) {
  return (
    <div
      data-tab-key={tab.key}
      role="presentation"
      title={tab.title ?? tab.label}
      onContextMenu={(e) => {
        if (!onShowMenu) return;
        e.preventDefault();
        onShowMenu({ x: e.clientX, y: e.clientY });
      }}
      className={cx(
        "group relative flex h-7 max-w-48 shrink-0 cursor-default items-center gap-1.5 rounded-lg px-2.5 text-body-medium transition-colors",
        dragged && "opacity-50",
        isActive
          ? "bg-background-secondary-default text-text-primary"
          : "text-text-tertiary hover:bg-background-secondary-hover hover:text-text-secondary",
      )}
    >
      <div
        role="tab"
        aria-selected={isActive}
        aria-controls="center-tabpanel"
        tabIndex={isActive ? 0 : -1}
        onClick={() => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
          }
          onSelect(tab.key);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(tab.key);
          }
        }}
        onAuxClick={(e) => {
          if (e.button === 1) onClose(tab.key);
        }}
        onPointerDown={onPointerDown}
        className="flex min-w-0 flex-1 cursor-default items-center gap-1.5"
      >
        <TabLeadingIcon icon={tab.icon} engine={tab.engine} />
        <TabStatusDot streaming={tab.streaming} unseen={tab.unseen} />
        {tab.dirty && (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-foreground-icon-primary" />
        )}
        <span className="truncate">{tab.label}</span>
      </div>
      {dropBefore !== null && (
        <span
          aria-hidden
          className={cx(
            "pointer-events-none absolute top-1 bottom-1 w-0.5 rounded-full bg-accent-500",
            dropBefore ? "-left-[3px]" : "-right-[3px]",
          )}
        />
      )}
      <button
        type="button"
        aria-label={closeLabel}
        onClick={(e) => {
          e.stopPropagation();
          onClose(tab.key);
        }}
        className={cx(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded text-foreground-icon-tertiary hover:bg-background-tertiary-hover hover:text-foreground-icon-primary",
          // Keyboard users must see the button when it has focus, not
          // only on pointer hover.
          isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
        )}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/** Pointer-driven tab drag-reorder: dragged key lives in a ref, the
 * insertion point in state so the indicator bar follows the pointer.
 * Pointer events, not HTML5 DnD: WKWebView never delivers dragover/drop, so
 * native DnD only reordered in Chromium. A 5px threshold keeps plain clicks
 * intact. */
function useTabDragReorder(
  onReorder?: (draggedKey: string, targetKey: string, before: boolean) => void,
) {
  const dragStateRef = useRef<{ key: string; startX: number; dragging: boolean } | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    draggedKey: string;
    key: string;
    before: boolean;
  } | null>(null);
  // pointerup fires before click; swallow the click that ends a drag.
  const suppressClickRef = useRef(false);

  function handleTabPointerDown(tab: SessionTabItem) {
    return (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!onReorder || e.button !== 0) return;
      // Dragging from the close button feels broken; keep it click-only.
      if ((e.target as HTMLElement).closest("button")) return;
      dragStateRef.current = { key: tab.key, startX: e.clientX, dragging: false };
    };
  }

  useEffect(() => {
    if (!onReorder) return;
    const DRAG_THRESHOLD = 5;
    const targetAt = (x: number, y: number, excludeKey: string) => {
      const el = document
        .elementFromPoint(x, y)
        ?.closest<HTMLElement>("[data-tab-key]");
      const key = el?.dataset.tabKey;
      if (!el || !key || key === excludeKey) return null;
      const rect = el.getBoundingClientRect();
      return { key, before: x < rect.left + rect.width / 2 };
    };
    const onMove = (e: PointerEvent) => {
      const st = dragStateRef.current;
      if (!st) return;
      if (!st.dragging) {
        if (Math.abs(e.clientX - st.startX) < DRAG_THRESHOLD) return;
        st.dragging = true;
      }
      const target = targetAt(e.clientX, e.clientY, st.key);
      setDropTarget((prev) => {
        const next = target ? { draggedKey: st.key, ...target } : null;
        return prev?.key === next?.key &&
          prev?.before === next?.before &&
          prev?.draggedKey === next?.draggedKey
          ? prev
          : next;
      });
    };
    const onUp = (e: PointerEvent) => {
      const st = dragStateRef.current;
      dragStateRef.current = null;
      setDropTarget(null);
      if (!st?.dragging) return;
      suppressClickRef.current = true;
      // The click ending the drag fires right after pointerup — but when
      // the press lands on one tab and releases on another, it targets
      // their container instead, never reaching a tab's onClick. Clear the
      // flag on the next task so it can't swallow a later genuine click.
      setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
      const target = targetAt(e.clientX, e.clientY, st.key);
      if (target) onReorder(st.key, target.key, target.before);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [onReorder]);

  return { dropTarget, suppressClickRef, handleTabPointerDown };
}

/**
 * Conversation tab strip doubling as the window drag region (overlay
 * titlebar). Clicks land on tab elements; only the strip's own padding
 * starts a window drag. Tabs scroll horizontally without a scrollbar and
 * vertical wheel deltas translate to horizontal scroll, like VSCode.
 */
export function SessionTabStrip({
  tabs,
  activeKey,
  onSelect,
  onClose,
  onCloseAll,
  onCloseInactive,
  closeLabel,
  onReorder,
  actions,
  onNew,
  leading,
  trafficLightInset = true,
}: SessionTabStripProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();
  const { dropTarget, suppressClickRef, handleTabPointerDown } =
    useTabDragReorder(onReorder);
  // Tab right-click menu (a single "Close All" entry for now), anchored at
  // the pointer like every other context menu in the app.
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  // Window drag: presses that miss every interactive element start dragging
  // the window (overlay titlebar). Native listener — the drag region is a
  // window-level gesture, not a control with click/keyboard semantics.
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const onMouseDown = (e: globalThis.MouseEvent) => {
      // No native titlebar to drag in web-access mode.
      if (isWeb || e.button !== 0) return;
      if ((e.target as HTMLElement).closest(DRAG_IGNORE_SELECTOR)) return;
      e.preventDefault();
      startWindowDrag();
    };
    el.addEventListener("mousedown", onMouseDown);
    return () => el.removeEventListener("mousedown", onMouseDown);
  }, []);

  // Vertical wheel drives the horizontal tab scroll (VSCode behavior).
  // Native non-passive listener: React wheel handlers cannot preventDefault.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaX === 0 && e.deltaY === 0) return;
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      el.scrollLeft += delta;
      e.preventDefault();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Keep the active tab in view as tabs stream in/out of the strip.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !activeKey) return;
    el.querySelector(`[data-tab-key="${CSS.escape(activeKey)}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeKey, tabs.length]);

  // Roving-tabindex tab list: Arrow keys move focus between tabs (selection
  // still requires Enter/Space, matching the platform tab convention).
  function handleTabListKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const el = scrollRef.current;
    if (!el) return;
    const tabEls = Array.from(el.querySelectorAll<HTMLElement>('[role="tab"]'));
    const current = tabEls.indexOf(document.activeElement as HTMLElement);
    if (current < 0) return;
    e.preventDefault();
    const next =
      e.key === "ArrowRight"
        ? (current + 1) % tabEls.length
        : (current - 1 + tabEls.length) % tabEls.length;
    tabEls[next]?.focus();
  }

  return (
    <div
      ref={stripRef}
      data-tauri-drag-region
      className={cx(
        "flex h-10 shrink-0 items-center border-b border-separator-border bg-background-primary-default select-none",
        IS_MAC && trafficLightInset && "pl-[80px]",
      )}
    >
      {leading && <div className="flex h-full shrink-0 items-center pl-2">{leading}</div>}
      <div
        ref={scrollRef}
        onKeyDown={handleTabListKeyDown}
        className="group scrollbar-none flex min-w-0 flex-1 items-center overflow-x-auto px-2"
      >
      <div role="tablist" aria-label="tabs" className="flex min-w-0 items-center gap-1">
      {tabs.map((tab) => (
        <SessionTab
          key={tab.key}
          tab={tab}
          isActive={tab.key === activeKey}
          dragged={dropTarget?.draggedKey === tab.key}
          dropBefore={dropTarget?.key === tab.key ? dropTarget.before : null}
          closeLabel={closeLabel}
          onShowMenu={onCloseAll || onCloseInactive ? setMenu : undefined}
          onSelect={onSelect}
          onClose={onClose}
          onPointerDown={onReorder ? handleTabPointerDown(tab) : undefined}
          suppressClickRef={suppressClickRef}
        />
      ))}
      </div>
      {onNew && (
        <button
          type="button"
          aria-label={t("chat.newChat")}
          title={t("chat.newChat")}
          onClick={onNew}
          className="ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-foreground-icon-tertiary opacity-0 transition-opacity hover:bg-background-secondary-hover hover:text-foreground-icon-primary focus-visible:opacity-100 group-hover:opacity-100"
        >
          <Plus className="size-4" aria-hidden />
        </button>
      )}
      </div>
      {actions && (
        <div className="flex h-full shrink-0 items-center">
          {actions}
        </div>
      )}
      {menu && (onCloseAll || onCloseInactive) && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          ariaLabel={t("chat.closeAllTabs")}
          entries={[
            ...(onCloseInactive
              ? [
                  {
                    id: "close-inactive",
                    label: t("chat.closeInactiveTabs"),
                    icon: <CircleX className="size-4" aria-hidden />,
                    onSelect: onCloseInactive,
                  },
                ]
              : []),
            ...(onCloseInactive && onCloseAll ? ["separator" as const] : []),
            ...(onCloseAll
              ? [
                  {
                    id: "close-all",
                    label: t("chat.closeAllTabs"),
                    icon: <X className="size-4" aria-hidden />,
                    onSelect: onCloseAll,
                  },
                ]
              : []),
          ]}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
