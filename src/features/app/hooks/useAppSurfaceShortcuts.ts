import { useEffect } from "react";
import {
  isEditableShortcutTarget,
  matchesShortcutForPlatform,
} from "../../../utils/shortcuts";

type UseAppSurfaceShortcutsOptions = {
  isCompact: boolean;
  rightPanelAvailable: boolean;
  sidebarCollapsed: boolean;
  rightPanelCollapsed: boolean;
  toggleLeftConversationSidebarShortcut: string | null;
  toggleRightConversationSidebarShortcut: string | null;
  toggleRuntimeConsoleShortcut: string | null;
  toggleFilesSurfaceShortcut: string | null;
  onExpandSidebar: () => void;
  onCollapseSidebar: () => void;
  onExpandRightPanel: () => void;
  onCollapseRightPanel: () => void;
  onToggleRuntimeConsole: () => void;
  onOpenFilesSurface: () => void;
};

export function useAppSurfaceShortcuts({
  isCompact,
  rightPanelAvailable,
  sidebarCollapsed,
  rightPanelCollapsed,
  toggleLeftConversationSidebarShortcut,
  toggleRightConversationSidebarShortcut,
  toggleRuntimeConsoleShortcut,
  toggleFilesSurfaceShortcut,
  onExpandSidebar,
  onCollapseSidebar,
  onExpandRightPanel,
  onCollapseRightPanel,
  onToggleRuntimeConsole,
  onOpenFilesSurface,
}: UseAppSurfaceShortcutsOptions) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) {
        return;
      }
      if (
        isEditableShortcutTarget(event.target) ||
        isEditableShortcutTarget(document.activeElement)
      ) {
        return;
      }

      if (
        matchesShortcutForPlatform(
          event,
          toggleLeftConversationSidebarShortcut,
        )
      ) {
        event.preventDefault();
        if (isCompact) {
          return;
        }
        if (sidebarCollapsed) {
          onExpandSidebar();
        } else {
          onCollapseSidebar();
        }
        return;
      }

      if (
        matchesShortcutForPlatform(
          event,
          toggleRightConversationSidebarShortcut,
        )
      ) {
        event.preventDefault();
        if (isCompact || !rightPanelAvailable) {
          return;
        }
        if (rightPanelCollapsed) {
          onExpandRightPanel();
        } else {
          onCollapseRightPanel();
        }
        return;
      }

      if (matchesShortcutForPlatform(event, toggleRuntimeConsoleShortcut)) {
        event.preventDefault();
        onToggleRuntimeConsole();
        return;
      }

      if (matchesShortcutForPlatform(event, toggleFilesSurfaceShortcut)) {
        event.preventDefault();
        onOpenFilesSurface();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    isCompact,
    onCollapseRightPanel,
    onCollapseSidebar,
    onExpandRightPanel,
    onExpandSidebar,
    onOpenFilesSurface,
    onToggleRuntimeConsole,
    rightPanelAvailable,
    rightPanelCollapsed,
    sidebarCollapsed,
    toggleFilesSurfaceShortcut,
    toggleLeftConversationSidebarShortcut,
    toggleRightConversationSidebarShortcut,
    toggleRuntimeConsoleShortcut,
  ]);
}
