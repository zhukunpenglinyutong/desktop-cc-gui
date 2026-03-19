import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isWindowsPlatform } from "../../../utils/platform";

export function useWindowDrag(targetId: string) {
  useEffect(() => {
    const isWindowsDesktop = isWindowsPlatform();

    if (isWindowsDesktop) {
      let pendingDragTimer: number | null = null;

      const clearPendingDragTimer = () => {
        if (pendingDragTimer !== null) {
          window.clearTimeout(pendingDragTimer);
          pendingDragTimer = null;
        }
      };

      const getTitlebarHeight = () => {
        const raw = getComputedStyle(document.documentElement)
          .getPropertyValue("--titlebar-height")
          .trim();
        const parsed = Number.parseFloat(raw);
        return Number.isFinite(parsed) ? parsed : 44;
      };

      const isMainTopbarArea = (target: EventTarget | null) => {
        const el = target as HTMLElement | null;
        if (!el) {
          return false;
        }
        return Boolean(
          el.closest(
            [
              ".main-topbar",
              ".main-header",
              ".sidebar-topbar-placeholder",
              ".sidebar-topbar-content",
            ].join(","),
          ),
        );
      };

      const DRAG_IGNORE_SELECTOR = [
        // Data attributes for explicit opt-out
        '[data-tauri-drag-region="false"]',
        "[data-window-drag-ignore='true']",
        // Interactive elements
        "button",
        "a",
        "input",
        "textarea",
        "select",
        "[role='button']",
        // Window controls
        ".titlebar-window-controls",
        // Popovers and dropdowns
        "[class*='-dropdown']",
        "[class*='-popover']",
        // Resizers and dividers
        "[class*='-resizer']",
        "[class*='-divider']",
        "[class*='-resize-handle']",
      ].join(",");

      const shouldIgnoreTarget = (target: EventTarget | null) => {
        const el = target as HTMLElement | null;
        if (!el) {
          return false;
        }
        return Boolean(el.closest(DRAG_IGNORE_SELECTOR));
      };

      const onMouseDown = (event: MouseEvent) => {
        if (event.button !== 0 || event.detail > 1) {
          return;
        }
        const inTopTitlebarLane = event.clientY <= getTitlebarHeight();
        const inMainTopbarBlankArea = isMainTopbarArea(event.target);
        if (!inTopTitlebarLane && !inMainTopbarBlankArea) {
          return;
        }
        if (shouldIgnoreTarget(event.target)) {
          return;
        }
        clearPendingDragTimer();
        pendingDragTimer = window.setTimeout(() => {
          void (async () => {
            try {
              const windowHandle = getCurrentWindow();
              const fullscreen = await windowHandle.isFullscreen();
              if (fullscreen) {
                return;
              }
              await windowHandle.startDragging();
            } catch {
              // Ignore in non-Tauri test/runtime cases.
            } finally {
              pendingDragTimer = null;
            }
          })();
        }, 140);
      };

      const onDoubleClick = (event: MouseEvent) => {
        if (event.button !== 0) {
          return;
        }
        const inTopTitlebarLane = event.clientY <= getTitlebarHeight();
        const inMainTopbarBlankArea = isMainTopbarArea(event.target);
        if (!inTopTitlebarLane && !inMainTopbarBlankArea) {
          return;
        }
        if (shouldIgnoreTarget(event.target)) {
          return;
        }
        clearPendingDragTimer();
        void (async () => {
          try {
            const windowHandle = getCurrentWindow();
            const fullscreen = await windowHandle.isFullscreen();
            if (fullscreen) {
              await windowHandle.setFullscreen(false);
              await new Promise((resolve) => window.setTimeout(resolve, 16));
            }
            await windowHandle.toggleMaximize();
          } catch {
            // Ignore in non-Tauri test/runtime cases.
          }
        })();
      };

      const onMouseUp = (event: MouseEvent) => {
        if (event.button !== 0) {
          return;
        }
        clearPendingDragTimer();
      };

      document.addEventListener("mousedown", onMouseDown);
      document.addEventListener("dblclick", onDoubleClick);
      document.addEventListener("mouseup", onMouseUp);
      return () => {
        clearPendingDragTimer();
        document.removeEventListener("mousedown", onMouseDown);
        document.removeEventListener("dblclick", onDoubleClick);
        document.removeEventListener("mouseup", onMouseUp);
      };
    }

    const el = document.getElementById(targetId);
    if (!el) {
      return;
    }

    const handler = (event: MouseEvent) => {
      if (event.buttons !== 1) {
        return;
      }
      if (event.detail > 1) {
        return;
      }
      getCurrentWindow().startDragging();
    };

    el.addEventListener("mousedown", handler);
    return () => {
      el.removeEventListener("mousedown", handler);
    };
  }, [targetId]);
}
