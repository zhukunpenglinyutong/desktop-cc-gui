import { useEffect } from "react";
import {
  isEditableShortcutTarget,
  matchesShortcutForPlatform,
} from "../../../utils/shortcuts";

type UseNewAgentShortcutOptions = {
  isEnabled: boolean;
  shortcut: string | null;
  onTrigger: () => void;
};

export function useNewAgentShortcut({
  isEnabled,
  shortcut,
  onTrigger,
}: UseNewAgentShortcutOptions) {
  useEffect(() => {
    if (!isEnabled || !shortcut) {
      return;
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat) {
        return;
      }
      if (
        isEditableShortcutTarget(event.target) ||
        isEditableShortcutTarget(document.activeElement)
      ) {
        return;
      }
      if (matchesShortcutForPlatform(event, shortcut)) {
        event.preventDefault();
        onTrigger();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isEnabled, onTrigger, shortcut]);
}
