import { useEffect } from "react";
import {
  isEditableShortcutTarget,
  matchesShortcutForPlatform,
} from "../../../utils/shortcuts";

type UseGlobalSearchShortcutOptions = {
  isEnabled: boolean;
  shortcut: string | null;
  onTrigger: () => void;
};

const DISALLOWED_SHORTCUTS = new Set(["cmd+p", "ctrl+p"]);

function normalizeShortcutValue(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  return normalized || null;
}

export function useGlobalSearchShortcut({
  isEnabled,
  shortcut,
  onTrigger,
}: UseGlobalSearchShortcutOptions) {
  useEffect(() => {
    if (!isEnabled) {
      return;
    }

    const normalizedConfiguredShortcut = normalizeShortcutValue(shortcut);
    const canUseConfiguredShortcut =
      Boolean(normalizedConfiguredShortcut) &&
      (normalizedConfiguredShortcut
        ? !DISALLOWED_SHORTCUTS.has(normalizedConfiguredShortcut)
        : false);
    if (!canUseConfiguredShortcut || !normalizedConfiguredShortcut) {
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
      if (!matchesShortcutForPlatform(event, normalizedConfiguredShortcut)) {
        return;
      }
      event.preventDefault();
      onTrigger();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isEnabled, onTrigger, shortcut]);
}
