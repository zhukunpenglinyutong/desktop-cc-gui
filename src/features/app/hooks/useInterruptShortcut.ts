import { useEffect } from "react";
import {
  isEditableShortcutTarget,
  matchesShortcutForPlatform,
} from "../../../utils/shortcuts";

type UseInterruptShortcutOptions = {
  isEnabled: boolean;
  shortcut: string | null;
  onTrigger: () => void | Promise<void>;
};

export function useInterruptShortcut({
  isEnabled,
  shortcut,
  onTrigger,
}: UseInterruptShortcutOptions) {
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
      void onTrigger();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isEnabled, onTrigger, shortcut]);
}
