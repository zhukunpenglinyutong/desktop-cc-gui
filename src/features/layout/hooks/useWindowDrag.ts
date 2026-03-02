import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function useWindowDrag(targetId: string) {
  useEffect(() => {
    let isWindowsDesktop = false;
    try {
      if (isTauri() && typeof navigator !== "undefined") {
        const platform =
          (
            navigator as Navigator & {
              userAgentData?: { platform?: string };
            }
          ).userAgentData?.platform ??
          navigator.platform ??
          "";
        isWindowsDesktop = platform.toLowerCase().includes("win");
      }
    } catch {
      // Ignore and continue with fallback behavior.
    }

    if (isWindowsDesktop) {
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

      const shouldIgnoreTarget = (target: EventTarget | null) => {
        const el = target as HTMLElement | null;
        if (!el) {
          return false;
        }
        if (
          el.closest(
            [
              '[data-tauri-drag-region="false"]',
              "[data-window-drag-ignore='true']",
              "button",
              "a",
              "input",
              "textarea",
              "select",
              "[role='button']",
              ".titlebar-window-controls",
              ".open-app-dropdown",
              ".launch-script-popover",
              ".workspace-project-dropdown",
              ".workspace-branch-dropdown",
              ".worktree-info-popover",
              ".sidebar-resizer",
              ".right-panel-resizer",
              ".projects-resizer",
              ".kanban-conversation-resizer",
              ".git-history-dock-resizer",
              ".git-history-vertical-resizer",
              ".git-history-details-resizer",
              ".terminal-panel-resizer",
              ".debug-panel-resizer",
              ".right-panel-divider",
              ".composer-resize-handle",
            ].join(","),
          )
        ) {
          return true;
        }
        return false;
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
        try {
          void getCurrentWindow().startDragging();
        } catch {
          // Ignore in non-Tauri test/runtime cases.
        }
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
        try {
          void getCurrentWindow().toggleMaximize();
        } catch {
          // Ignore in non-Tauri test/runtime cases.
        }
      };

      document.addEventListener("mousedown", onMouseDown);
      document.addEventListener("dblclick", onDoubleClick);
      return () => {
        document.removeEventListener("mousedown", onMouseDown);
        document.removeEventListener("dblclick", onDoubleClick);
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
