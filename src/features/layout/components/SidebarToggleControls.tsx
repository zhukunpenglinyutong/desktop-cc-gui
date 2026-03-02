import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import PanelLeftClose from "lucide-react/dist/esm/icons/panel-left-close";
import PanelLeftOpen from "lucide-react/dist/esm/icons/panel-left-open";
import PanelRightClose from "lucide-react/dist/esm/icons/panel-right-close";

export type SidebarToggleProps = {
  isCompact: boolean;
  sidebarCollapsed: boolean;
  rightPanelCollapsed: boolean;
  rightPanelAvailable?: boolean;
  onCollapseSidebar: () => void;
  onExpandSidebar: () => void;
  onCollapseRightPanel: () => void;
  onExpandRightPanel: () => void;
};

export function SidebarCollapseButton({
  isCompact,
  sidebarCollapsed,
  onExpandSidebar,
  onCollapseSidebar,
}: SidebarToggleProps) {
  const { t } = useTranslation();
  if (isCompact) {
    return null;
  }
  const isCollapsed = sidebarCollapsed;
  const labelKey = isCollapsed ? "sidebar.showThreadsSidebar" : "sidebar.hideThreadsSidebar";
  return (
    <button
      type="button"
      className="ghost main-header-action"
      onClick={isCollapsed ? onExpandSidebar : onCollapseSidebar}
      data-tauri-drag-region="false"
      aria-label={t(labelKey)}
      title={t(labelKey)}
    >
      {isCollapsed ? <PanelLeftOpen size={14} aria-hidden /> : <PanelLeftClose size={14} aria-hidden />}
    </button>
  );
}

export function RightPanelCollapseButton({
  isCompact,
  rightPanelCollapsed,
  rightPanelAvailable = true,
  onCollapseRightPanel,
}: SidebarToggleProps) {
  const { t } = useTranslation();
  if (isCompact || rightPanelCollapsed || !rightPanelAvailable) {
    return null;
  }
  return (
    <button
      type="button"
      className="ghost main-header-action"
      onClick={onCollapseRightPanel}
      data-tauri-drag-region="false"
      aria-label={t("sidebar.hideGitSidebar")}
      title={t("sidebar.hideGitSidebar")}
    >
      <PanelRightClose size={14} aria-hidden />
    </button>
  );
}

export function TitlebarExpandControls(_props: SidebarToggleProps) {
  const { t } = useTranslation();
  const isWindowsDesktop = useMemo(() => {
    try {
      if (!isTauri() || typeof navigator === "undefined") {
        return false;
      }
      const platform =
        (
          navigator as Navigator & {
            userAgentData?: { platform?: string };
          }
        ).userAgentData?.platform ??
        navigator.platform ??
        "";
      return platform.toLowerCase().includes("win");
    } catch {
      return false;
    }
  }, []);
  const [isMaximized, setIsMaximized] = useState(false);

  const syncWindowMaximizedState = useCallback(async () => {
    if (!isWindowsDesktop) {
      return;
    }
    try {
      const maximized = await getCurrentWindow().isMaximized();
      setIsMaximized(maximized);
    } catch (error) {
      console.error("Failed to read window maximized state:", error);
    }
  }, [isWindowsDesktop]);

  useEffect(() => {
    if (!isWindowsDesktop) {
      return;
    }

    let disposed = false;
    let unlistenResize: (() => void) | null = null;

    void syncWindowMaximizedState();

    try {
      const window = getCurrentWindow();
      void window
        .onResized(() => {
          void syncWindowMaximizedState();
        })
        .then((unlisten) => {
          if (disposed) {
            unlisten();
            return;
          }
          unlistenResize = unlisten;
        })
        .catch((error) => {
          console.error("Failed to bind window resize listener:", error);
        });
    } catch (error) {
      console.error("Failed to access current window:", error);
    }

    return () => {
      disposed = true;
      if (unlistenResize) {
        unlistenResize();
      }
    };
  }, [isWindowsDesktop, syncWindowMaximizedState]);

  const handleMinimizeWindow = useCallback(() => {
    if (!isWindowsDesktop) {
      return;
    }
    try {
      void getCurrentWindow().minimize();
    } catch (error) {
      console.error("Failed to minimize window:", error);
    }
  }, [isWindowsDesktop]);

  const handleToggleMaximizeWindow = useCallback(async () => {
    if (!isWindowsDesktop) {
      return;
    }
    try {
      const window = getCurrentWindow();
      await window.toggleMaximize();
      const maximized = await window.isMaximized();
      setIsMaximized(maximized);
    } catch (error) {
      console.error("Failed to toggle maximize window:", error);
    }
  }, [isWindowsDesktop]);

  const handleCloseWindow = useCallback(() => {
    if (!isWindowsDesktop) {
      return;
    }
    try {
      void getCurrentWindow().close();
    } catch (error) {
      console.error("Failed to close window:", error);
    }
  }, [isWindowsDesktop]);

  if (!isWindowsDesktop) {
    return null;
  }

  const maximizeLabel = isMaximized ? t("common.restore") : t("menu.maximize");

  return (
    <div className="titlebar-controls">
      {isWindowsDesktop && (
        <div className="titlebar-toggle titlebar-toggle-right titlebar-window-controls">
          <button
            type="button"
            className="titlebar-window-button"
            onClick={handleMinimizeWindow}
            data-tauri-drag-region="false"
            aria-label={t("menu.minimize")}
            title={t("menu.minimize")}
          >
            <span
              className="codicon codicon-chrome-minimize titlebar-window-glyph"
              aria-hidden
            />
          </button>
          <button
            type="button"
            className="titlebar-window-button"
            onClick={() => {
              void handleToggleMaximizeWindow();
            }}
            data-tauri-drag-region="false"
            aria-label={maximizeLabel}
            title={maximizeLabel}
          >
            <span
              className={`codicon ${
                isMaximized ? "codicon-chrome-restore" : "codicon-chrome-maximize"
              } titlebar-window-glyph`}
              aria-hidden
            />
          </button>
          <button
            type="button"
            className="titlebar-window-button titlebar-window-button-close"
            onClick={handleCloseWindow}
            data-tauri-drag-region="false"
            aria-label={t("menu.closeWindow")}
            title={t("menu.closeWindow")}
          >
            <span
              className="codicon codicon-chrome-close titlebar-window-glyph"
              aria-hidden
            />
          </button>
        </div>
      )}
    </div>
  );
}
