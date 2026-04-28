import { useEffect } from "react";
import {
  isEditableShortcutTarget,
  matchesShortcutForPlatform,
} from "../../../utils/shortcuts";

type UsePrimaryModeShortcutsOptions = {
  isEnabled: boolean;
  openChatShortcut: string | null;
  openKanbanShortcut: string | null;
  onOpenChat: () => void;
  onOpenKanban: () => void;
};

export function usePrimaryModeShortcuts({
  isEnabled,
  openChatShortcut,
  openKanbanShortcut,
  onOpenChat,
  onOpenKanban,
}: UsePrimaryModeShortcutsOptions) {
  useEffect(() => {
    if (!isEnabled) {
      return;
    }

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
      const matchesChatShortcut = matchesShortcutForPlatform(
        event,
        openChatShortcut,
      );
      const matchesKanbanShortcut = matchesShortcutForPlatform(
        event,
        openKanbanShortcut,
      );
      if (!matchesChatShortcut && !matchesKanbanShortcut) {
        return;
      }
      event.preventDefault();
      if (matchesChatShortcut) {
        onOpenChat();
        return;
      }
      onOpenKanban();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isEnabled, onOpenChat, onOpenKanban, openChatShortcut, openKanbanShortcut]);
}
