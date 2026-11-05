import { useEffect, type MutableRefObject, type RefObject } from "react";
import {
  extractText,
  insertTextAtCaret,
  setCaretOffset,
} from "@/components/application/ai-chat/file-tags";
import { findSlashTrigger } from "@/components/application/ai-chat/slash-commands";
import { type ComposerInputHandle } from "@/components/application/ai-chat/ai-chat-composer";

/**
 * Publishes the composer's imperative input handle (focus + mention insertion
 * from the file tree + slash-picker shortcut) on the parent's `inputRef`;
 * clears it again on unmount.
 */
export function useComposerInputHandle({
  inputRef,
  editableRef,
  emitChange,
  syncTags,
  updateSlashTrigger,
}: {
  inputRef?: MutableRefObject<ComposerInputHandle | null>;
  editableRef: RefObject<HTMLDivElement | null>;
  emitChange: () => void;
  syncTags: () => void;
  /** Re-derive the `/` trigger from the DOM after programmatic insertion. */
  updateSlashTrigger: () => boolean;
}) {
  useEffect(() => {
    if (!inputRef) return;
    const handle: ComposerInputHandle = {
      focus: () => editableRef.current?.focus(),
      insertText: (text) => {
        const el = editableRef.current;
        // Collapse previously unmounted the field. Keep commands inactive
        // while hidden, including late native clipboard replies.
        if (!el || el.hidden) return;
        insertTextAtCaret(el, text);
        emitChange();
        syncTags();
      },
      openSlashPicker: () => {
        const el = editableRef.current;
        if (!el || el.hidden) return;
        el.focus();
        // Append at the end: the trigger regex only accepts a line-start
        // `/`, so an arbitrary caret position mid-line could not open the
        // picker anyway.
        const text = extractText(el);
        setCaretOffset(el, text.length);
        if (!findSlashTrigger(text, text.length)) {
          insertTextAtCaret(el, text === "" || text.endsWith("\n") ? "/" : "\n/");
        }
        emitChange();
        syncTags();
        updateSlashTrigger();
        // react-aria restores focus to the popover trigger when the add
        // menu unmounts — after our focus() above. Reclaim the field so
        // typing reaches it once the picker is open.
        requestAnimationFrame(() => editableRef.current?.focus());
      },
    };
    inputRef.current = handle;
    return () => {
      if (inputRef.current === handle) inputRef.current = null;
    };
  }, [inputRef, emitChange, syncTags, updateSlashTrigger, editableRef]);
}
