/**
 * Composer prompt-history hooks, ported from desktop-cc-gui:
 * - usePromptCompletion: ghost-text suffix from history (Tab accepts).
 * - usePromptHistoryNav: ArrowUp/ArrowDown recall of submitted prompts.
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  findPromptCompletion,
  getPromptHistory,
  isPromptHistoryEnabled,
  subscribePromptHistory,
} from "@/features/chat/prompt-history";
import { extractText } from "@/components/application/ai-chat/file-tags";

const INVISIBLE_CHARS_RE = /[\u200B-\u200D\uFEFF]/g;

export interface PromptCompletion {
  /** Ghost suffix painted after the caret; "" when nothing matches. */
  suffix: string;
  /** Accept only if the editable still contains the query that produced it. */
  accept: (currentText: string) => string | null;
}

/**
 * Debounced prefix match of `text` against the prompt history. The caller
 * passes "" while an IME composition is in flight so candidates never
 * produce a ghost.
 */
export function usePromptCompletion(text: string, debounceMs = 100): PromptCompletion {
  const [suggestion, setSuggestion] = useState<{ query: string; text: string } | null>(null);
  const [enabled, setEnabled] = useState(isPromptHistoryEnabled);

  // The settings toggle fires the same change event as history mutations.
  useEffect(
    () => subscribePromptHistory(() => setEnabled(isPromptHistoryEnabled())),
    [],
  );

  useEffect(() => {
    if (!enabled) {
      setSuggestion(null);
      return;
    }
    if (text.replace(INVISIBLE_CHARS_RE, "").trim().length < 2) {
      setSuggestion(null);
      return;
    }
    const timer = setTimeout(() => {
      const completion = findPromptCompletion(text);
      setSuggestion(completion === null ? null : { query: text, text: completion });
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [text, debounceMs, enabled]);

  const clean = text.replace(INVISIBLE_CHARS_RE, "").trim();
  // Invalidate during render, not in the next effect or debounce callback.
  const full =
    enabled && suggestion?.query === text && clean.length >= 2 &&
    suggestion.text.length > clean.length &&
    suggestion.text.toLowerCase().startsWith(clean.toLowerCase())
      ? suggestion.text
      : null;
  const suffix = full === null ? "" : full.slice(clean.length);

  const accept = useCallback((currentText: string): string | null => {
    setSuggestion(null);
    // Input and Tab (or the settings toggle) can share a React batch. Check
    // the live DOM and switch too, rather than trusting this render's props.
    // HTML parsing may normalize a restored draft's line endings. Compare
    // using the same whitespace/zero-width rules as the completion query.
    const currentClean = currentText.replace(INVISIBLE_CHARS_RE, "").trim();
    return isPromptHistoryEnabled() && currentClean === clean ? full : null;
  }, [clean, full]);

  return { suffix, accept };
}

interface HistoryKeyEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
}

/**
 * Shell-style recall: ArrowUp on an EMPTY input walks history newest →
 * oldest; ArrowDown walks back and past the newest restores the draft.
 * Any other key exits navigation. Returns true when the key was consumed.
 */
export function usePromptHistoryNav({
  editableRef,
  setText,
}: {
  editableRef: RefObject<HTMLDivElement | null>;
  setText: (text: string) => void;
}): {
  handleKeyDown: (event: HistoryKeyEvent) => boolean;
  resetNavigation: () => void;
} {
  const indexRef = useRef(-1);
  const draftRef = useRef("");
  const resetNavigation = useCallback(() => {
    indexRef.current = -1;
    draftRef.current = "";
  }, []);

  // A submit records a prompt and clears the field: drop the nav cursor.
  useEffect(() => subscribePromptHistory(resetNavigation), [resetNavigation]);

  const handleKeyDown = useCallback(
    (event: HistoryKeyEvent): boolean => {
      const key = event.key;
      const isNavigating = indexRef.current !== -1;
      if (!isPromptHistoryEnabled()) return false;

      if (isNavigating && key !== "ArrowUp" && key !== "ArrowDown") {
        resetNavigation();
        return false;
      }
      if (key !== "ArrowUp" && key !== "ArrowDown") return false;
      if (event.metaKey || event.ctrlKey || event.altKey) return false;

      const items = getPromptHistory();
      if (items.length === 0) return false;

      const el = editableRef.current;
      const currentText = el ? extractText(el) : "";
      // Navigation only starts from an empty input; ArrowDown never starts it.
      if (!isNavigating && currentText.replace(INVISIBLE_CHARS_RE, "").trim()) return false;
      if (!isNavigating && key === "ArrowDown") return false;

      event.preventDefault();
      event.stopPropagation();
      if (!isNavigating) draftRef.current = currentText;

      if (key === "ArrowUp") {
        const next = isNavigating ? Math.max(0, indexRef.current - 1) : items.length - 1;
        indexRef.current = next;
        setText(items[next] ?? draftRef.current);
        return true;
      }
      if (indexRef.current < items.length - 1) {
        indexRef.current += 1;
        setText(items[indexRef.current] ?? draftRef.current);
        return true;
      }
      setText(draftRef.current);
      resetNavigation();
      return true;
    },
    [editableRef, setText, resetNavigation],
  );

  return { handleKeyDown, resetNavigation };
}
