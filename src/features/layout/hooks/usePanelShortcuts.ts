import { useEffect } from "react";
import {
  isEditableShortcutTarget,
  matchesShortcutForPlatform,
} from "../../../utils/shortcuts";

type UsePanelShortcutsOptions = {
  toggleDebugPanelShortcut: string | null;
  toggleTerminalShortcut: string | null;
  onToggleDebug: () => void;
  onToggleTerminal: () => void;
};

export function usePanelShortcuts({
  toggleDebugPanelShortcut,
  toggleTerminalShortcut,
  onToggleDebug,
  onToggleTerminal,
}: UsePanelShortcutsOptions) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.defaultPrevented) {
        return;
      }
      if (
        isEditableShortcutTarget(event.target) ||
        isEditableShortcutTarget(document.activeElement)
      ) {
        return;
      }
      if (matchesShortcutForPlatform(event, toggleDebugPanelShortcut)) {
        event.preventDefault();
        onToggleDebug();
        return;
      }
      if (matchesShortcutForPlatform(event, toggleTerminalShortcut)) {
        event.preventDefault();
        onToggleTerminal();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onToggleDebug, onToggleTerminal, toggleDebugPanelShortcut, toggleTerminalShortcut]);
}
