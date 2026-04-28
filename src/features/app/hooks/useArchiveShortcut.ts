import { useEffect } from "react";
import {
  isEditableShortcutTarget,
  matchesShortcutForPlatform,
} from "../../../utils/shortcuts";

type UseArchiveShortcutOptions = {
  isEnabled: boolean;
  shortcut: string | null;
  onTrigger: () => void;
};

export function useArchiveShortcut({
  isEnabled,
  shortcut,
  onTrigger,
}: UseArchiveShortcutOptions) {
  useEffect(() => {
    if (!isEnabled || !shortcut) {
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
      if (!matchesShortcutForPlatform(event, shortcut)) {
        return;
      }
      event.preventDefault();
      onTrigger();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isEnabled, onTrigger, shortcut]);
}
