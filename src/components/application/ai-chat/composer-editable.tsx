import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type RefObject,
  useCallback,
} from "react";
import { useTranslation } from "react-i18next";
import {
  COMPOSER_INSERTING_ATTR,
  extractText,
  insertTextAtCaret,
} from "@/components/application/ai-chat/file-tags";
import { readClipboardFiles } from "@/components/application/ai-chat/clipboard-files";
import { ipc } from "@/lib/ipc";
import { isWeb } from "@/lib/transport";
import { type FileMentionMenuHandle } from "@/components/application/ai-chat/file-mention-menu";
import { type SlashCommandMenuHandle } from "@/components/application/ai-chat/slash-command-menu";
import { type BotMenuHandle } from "@/components/application/ai-chat/bot-menu";
import { type PromptMenuHandle } from "@/components/application/ai-chat/prompt-menu";
import { cx } from "@/utils/cx";

/**
 * ComposerEditable — the composer's contentEditable field and its event
 * wiring: IME composition gating (WKWebView fires `compositionend` BEFORE
 * the Enter keydown that commits the candidate, so Enter is gated on a sync
 * ref plus the IME keyCode 229), mention-picker key
 * delegation, ghost-text Tab accept, ArrowUp/ArrowDown history recall, the
 * configured send gesture, and file/text paste. All state lives in
 * the composer and arrives as props.
 */
export function ComposerEditable({
  editableRef,
  sendShortcut,
  mentionOpen,
  slashOpen,
  botOpen,
  promptOpen,
  completionSuffix,
  acceptCompletion,
  setEditableText,
  handleHistoryKeyDown,
  resetHistoryNavigation,
  mentionMenuRef,
  slashMenuRef,
  botMenuRef,
  promptMenuRef,
  isComposingRef,
  setIsComposing,
  emitChange,
  syncTags,
  updateTriggers,
  disabled,
  onSubmit,
  onPasteImages,
  onPastePaths,
  manualHeightPx,
}: {
  editableRef: RefObject<HTMLDivElement>;
  sendShortcut: "enter" | "cmdEnter";
  /** A mention trigger is active: gates the ghost completion + key delegation. */
  mentionOpen: boolean;
  /** A `/` command trigger is active: same gating as mentionOpen. */
  slashOpen: boolean;
  /** A `#` bot trigger is active: same gating as mentionOpen. */
  botOpen: boolean;
  /** A `!` prompt trigger is active: same gating as mentionOpen. */
  promptOpen: boolean;
  /** Ghost-text history suffix painted after the caret ("" = none). */
  completionSuffix: string;
  /** Accept the ghost suggestion: returns the full text, or null. */
  acceptCompletion: () => string | null;
  setEditableText: (text: string) => void;
  handleHistoryKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => boolean;
  /** Editing a recalled prompt ends history navigation without changing text. */
  resetHistoryNavigation: () => void;
  mentionMenuRef: MutableRefObject<FileMentionMenuHandle | null>;
  slashMenuRef: MutableRefObject<SlashCommandMenuHandle | null>;
  botMenuRef: MutableRefObject<BotMenuHandle | null>;
  promptMenuRef: MutableRefObject<PromptMenuHandle | null>;
  isComposingRef: MutableRefObject<boolean>;
  setIsComposing: (composing: boolean) => void;
  emitChange: () => void;
  syncTags: () => void;
  /** Re-derive completion triggers (`/` first, then `@`) after real input. */
  updateTriggers: () => void;
  disabled: boolean;
  onSubmit?: (value: string) => void;
  onPasteImages?: (files: File[]) => void;
  /** Clipboard files with a resolvable path: routed exactly like a drop
   *  (images become attachments, other files `@path` mentions at the caret).
   *  Absent = no active session: pasted files stay ignored. */
  onPastePaths?: (paths: string[]) => void;
  /** Explicit editable-area height; null = auto-grow layout. */
  manualHeightPx: number | null;
}) {
  const { t } = useTranslation();
  /** Resolve pasted files to absolute paths and hand them over: the webview
   *  hides Finder / Explorer paths behind opaque blobs, so the host reads the
   *  OS clipboard; `text/uri-list` paths cover clipboard stacks that expose
   *  them directly. A probe that finds no file falls back to `fallback`
   *  (image bytes, which need no path). */
  const routePastedFiles = useCallback(
    (uriPaths: string[], fallback?: () => void) => {
      if (!onPastePaths) return;
      const native = isWeb
        ? Promise.resolve<string[]>([])
        : ipc.clipboardFilePaths().catch(() => []);
      void native.then((nativePaths) => {
        const paths = nativePaths.length > 0 ? nativePaths : uriPaths;
        if (paths.length > 0) onPastePaths(paths);
        else fallback?.();
      });
    },
    [onPastePaths],
  );
  // Send gesture labels name the real modifier: ⌘ on macOS, Ctrl elsewhere.
  const isMac = navigator.platform.includes("Mac");
  return (
    <div
      ref={editableRef}
      contentEditable
      role="textbox"
      aria-multiline="true"
      aria-label={t("chat.send")}
      data-placeholder={sendShortcut === "cmdEnter"
        ? t(isMac ? "chat.inputPlaceholderCmdEnter" : "chat.inputPlaceholderCmdEnterCtrl")
        : t("chat.inputPlaceholder")}
      data-completion-suffix={mentionOpen || slashOpen || botOpen || promptOpen ? undefined : completionSuffix || undefined}
      onInput={() => {
        // insertTextAtCaret's editing command fires input mid-insert. Acting
        // on it (especially syncTags → innerHTML) wipes the undo step the
        // command just opened. The caller emits once the insert returns.
        if (editableRef.current?.hasAttribute(COMPOSER_INSERTING_ATTR)) return;
        emitChange();
        syncTags();
        if (!isComposingRef.current) updateTriggers();
      }}
      onCompositionStart={() => {
        isComposingRef.current = true;
        setIsComposing(true);
        // IME keydowns bypass shortcuts, including the key that normally
        // leaves history navigation. Reset now so later arrows keep edits.
        resetHistoryNavigation();
      }}
      onCompositionEnd={() => {
        isComposingRef.current = false;
        setIsComposing(false);
        // Composition commits text without an input event in WKWebView.
        emitChange();
        syncTags();
        updateTriggers();
      }}
      onKeyDown={(event) => {
        // Leave active composition to the IME. WebKit can report the final
        // candidate-confirming Enter after compositionend; keyCode 229 still
        // identifies it. Preserve IME default behavior and let the next
        // independent Enter send immediately.
        if (event.nativeEvent.isComposing || isComposingRef.current) return;
        if (event.nativeEvent.keyCode === 229) return;
        // An open mention picker owns arrows/Enter/Tab/Escape (never
        // mid-IME: those keys belong to the candidate window).
        if (mentionOpen && mentionMenuRef.current?.handleKey(event.key)) {
          event.preventDefault();
          return;
        }
        // An open `/` picker owns the same keys (same IME gating).
        if (slashOpen && slashMenuRef.current?.handleKey(event.key)) {
          event.preventDefault();
          return;
        }
        // An open `#` bot picker owns the same keys (same IME gating).
        if (botOpen && botMenuRef.current?.handleKey(event.key)) {
          event.preventDefault();
          return;
        }
        // An open `!` prompt picker owns the same keys (same IME gating).
        if (promptOpen && promptMenuRef.current?.handleKey(event.key)) {
          event.preventDefault();
          return;
        }
        // Tab accepts the ghost-text history completion (never mid-IME).
        if (event.key === "Tab" && completionSuffix) {
          event.preventDefault();
          const full = acceptCompletion();
          if (full !== null) setEditableText(full);
          return;
        }
        // ArrowUp/ArrowDown recall submitted prompts from history.
        if (handleHistoryKeyDown(event)) return;
        if (event.key !== "Enter") return;
        // "cmdEnter": only ⌘/Ctrl+Enter sends; bare Enter falls through to
        // the contentEditable default and inserts a newline.
        const meta = event.metaKey || event.ctrlKey;
        if (sendShortcut === "cmdEnter" ? !meta : event.shiftKey) return;
        event.preventDefault();
        // Fires while streaming too: the host queues the message behind the
        // active turn instead of dropping it.
        const el = editableRef.current;
        if (!disabled && el) onSubmit?.(extractText(el));
      }}
      onPaste={(event) => {
        const { imageFiles, otherFiles, uriPaths } = readClipboardFiles(
          event.clipboardData,
        );
        const text = event.clipboardData?.getData("text/plain") ?? "";
        // Files copied in the OS: image bytes keep the data-URL pipeline (a
        // screenshot has no path), every other file resolves to a path and is
        // routed like a drop — attachment for images, `@path` otherwise.
        if (imageFiles.length > 0 || otherFiles.length > 0 || uriPaths.length > 0) {
          event.preventDefault();
          if (otherFiles.length > 0 || uriPaths.length > 0) {
            routePastedFiles(uriPaths, () => {
              if (imageFiles.length > 0) onPasteImages?.(imageFiles);
            });
          } else {
            onPasteImages?.(imageFiles);
          }
          return;
        }
        // No text to insert: a Finder copy may hide every file flavor from
        // the event. The probe is a no-op when the clipboard holds no file.
        if (text === "") {
          event.preventDefault();
          routePastedFiles([]);
          return;
        }
        // Plain text only: clipboard HTML must not leak markup (spans,
        // styles) into the editable — chips are the only allowed markup.
        event.preventDefault();
        const el = editableRef.current;
        if (!el) return;
        insertTextAtCaret(el, text);
        emitChange();
        syncTags();
      }}
      style={manualHeightPx != null ? { height: manualHeightPx } : undefined}
      className={cx(
        "composer-editable w-full overflow-y-auto bg-transparent px-1.5 py-1 text-body-regular text-text-primary caret-accent-500 outline-none",
        manualHeightPx == null && "max-h-40 min-h-[52px]",
      )}
    />
  );
}
