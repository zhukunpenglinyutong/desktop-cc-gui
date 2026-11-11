import DOMPurify from "dompurify";
import { getFileTreeIconSvg } from "@/features/files/fileIcons";
import i18n from "@/lib/i18n";
/** An active `@` autocomplete trigger at the caret: `start` is the offset
 * of the `@` itself, `query` is the text typed after it. */
export interface MentionTrigger {
  start: number;
  query: string;
}

/**
 * Find the `@` mention trigger spanning the caret, if any. A trigger is an
 * `@` preceded by start-of-text or whitespace, followed by the query: no
 * whitespace and no further `@` between it and the caret. Chips flatten to
 * their `@path` mention but always carry a trailing space (and the chip
 * itself is atomic), so a caret behind an inserted chip never re-triggers.
 */
export function findMentionTrigger(text: string, caret: number): MentionTrigger | null {
  if (caret <= 0 || caret > text.length) return null;
  let start = caret - 1;
  while (start >= 0) {
    const ch = text[start];
    if (ch === "@" || /\s/.test(ch)) break;
    start--;
  }
  if (start < 0 || text[start] !== "@") return null;
  // `x@y` (emails, handles) is not a mention trigger.
  if (start > 0 && !/\s/.test(text[start - 1])) return null;
  const query = text.slice(start + 1, caret);
  // Bound the query so a huge whitespace-free run never feeds the matcher.
  if (query.length > 128) return null;
  return { start, query };
}

/**
 * Inline file-tag ("chip") support for the composer's contentEditable field,
 * ported from desktop-cc-gui's useFileTags.
 *
 * Model: the field's text is the source of truth. A mention is the plain
 * text `@<absolute-path>`; renderFileTags re-renders each mention as a
 * non-editable chip span (icon + name + ×), and extractText flattens the DOM
 * back to text (chips become their `@path` mention again), so what the user
 * sees and what gets sent never diverge.
 */

export const FILE_TAG_CLASS = "composer-file-tag";

/**
 * Set on the editable while `insertTextAtCaret` is applying an editing
 * command. The command fires `input` synchronously; the composer must ignore
 * that event, or `renderFileTags` will replace innerHTML mid-command (which
 * clears the undo step just opened, and can make the command fail so the DOM
 * fallback inserts the text a second time).
 */
export const COMPOSER_INSERTING_ATTR = "data-composer-inserting";

/** Absolute-path mention: `@/plain/path` or `@"quoted/path with spaces"`. */
const MENTION_RE = /@(?:"(\/[^"]+)"|(\/[^\s@]+))/g;

/**
 * Mention token for a path: quoted when it contains whitespace.
 *
 * The mention grammar (MENTION_RE) and `resolveFilePath` speak one canonical
 * form: a `/`-rooted, forward-slash absolute path — Windows `C:\Users\x`
 * becomes `/C:/Users/x` (the MSYS-style prefix `resolveFilePath` strips on
 * the way back to the filesystem). Without the leading `/` the token is not
 * a mention at all: it never renders as a chip and never round-trips through
 * extractText — which is exactly what happened to tree-inserted
 * `@S:\…\path` tokens on Windows.
 */
export function mentionToken(path: string): string {
  const slashed = path.trim().replace(/\\/g, "/");
  const mentionPath = slashed.startsWith("/") ? slashed : `/${slashed}`;
  return /\s/.test(mentionPath) ? `@"${mentionPath}"` : `@${mentionPath}`;
}

function escapeHtmlText(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function baseName(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx >= 0 ? path.slice(idx + 1) : path;
}

/**
 * Flatten the editable DOM to plain text: chips become their `@path`
 * mention, <br> and block elements become newlines.
 */
export function extractText(el: HTMLElement): string {
  return flatten(el);
}

/** Flatten any node (editable, fragment) to plain text with the chip rules. */
function flatten(root: Node): string {
  let out = "";
  const walk = (node: Node, isFirstBlock: boolean) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.textContent ?? "";
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as HTMLElement;
    if (element.classList.contains(FILE_TAG_CLASS)) {
      // Round-trip the original token so quoted (spaced) paths survive
      // chip → text → chip cycles intact.
      out += element.getAttribute("data-mention") ?? "";
      return;
    }
    if (element.tagName === "BR") {
      out += "\n";
      return;
    }
    const isBlock = element.tagName === "DIV" || element.tagName === "P";
    if (isBlock && !isFirstBlock) out += "\n";
    let first = true;
    node.childNodes.forEach((child) => {
      walk(child, first);
      first = false;
    });
  };
  let first = true;
  root.childNodes.forEach((child) => {
    walk(child, first);
    first = false;
  });
  return out;
}

/**
 * Caret position as a character offset into extractText(el). Chip spans
 * count as their mention text (`@path`), so offsets survive re-renders.
 */
export function getCaretOffset(el: HTMLElement): number {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return -1;
  const range = selection.getRangeAt(0);
  if (!el.contains(range.startContainer)) return -1;
  // Everything before the caret, flattened with the chip rules. Cloning the
  // leading range sidesteps the caret sitting in an ELEMENT container
  // (e.g. right after an inserted node) where a node walk never matches.
  const preRange = document.createRange();
  preRange.setStart(el, 0);
  preRange.setEnd(range.startContainer, range.startOffset);
  return flatten(preRange.cloneContents()).length;
}

/**
 * Caret x relative to the composer wrapper, clamped so a `menuWidth`-px
 * popover anchored there stays inside the wrapper. Shared by the
 * `@`-mention and `/`-command pickers.
 */
export function caretLeftPx(wrapper: HTMLElement | null, menuWidth: number): number {
  const selection = window.getSelection();
  if (!wrapper || !selection || selection.rangeCount === 0) return 0;
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  const wrap = wrapper.getBoundingClientRect();
  // A collapsed range in an element container (right after a chip) reports
  // a zero rect in WKWebView — fall back to the wrapper's left edge.
  const raw = (rect.left || wrap.left) - wrap.left;
  return Math.max(0, Math.min(raw, Math.max(0, wrap.width - menuWidth)));
}

/** Inverse of getCaretOffset: place the caret at a text offset. */
export function setCaretOffset(el: HTMLElement, target: number) {
  const selection = window.getSelection();
  if (!selection) return;
  let offset = 0;
  let placed = false;
  const place = (node: Node, offsetInNode: number) => {
    const range = document.createRange();
    range.setStart(node, offsetInNode);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    placed = true;
  };
  const walk = (node: Node, isFirstBlock: boolean) => {
    if (placed) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const len = node.textContent?.length ?? 0;
      if (offset + len >= target) {
        place(node, Math.max(0, target - offset));
        return;
      }
      offset += len;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as HTMLElement;
    if (element.classList.contains(FILE_TAG_CLASS)) {
      offset += (element.getAttribute("data-mention") ?? "").length;
      return;
    }
    if (element.tagName === "BR") {
      offset += 1;
      return;
    }
    const isBlock = element.tagName === "DIV" || element.tagName === "P";
    if (isBlock && !isFirstBlock) offset += 1;
    let first = true;
    node.childNodes.forEach((child) => {
      walk(child, first);
      first = false;
    });
  };
  let first = true;
  el.childNodes.forEach((child) => {
    walk(child, first);
    first = false;
  });
  if (!placed) {
    // Past the end: caret after the last node.
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }
}

function chipHtml(path: string): string {
  const name = baseName(path);
  // Same heuristic as desktop-cc-gui: an extension-less name is a folder.
  const isDir = !name.includes(".");
  const icon = getFileTreeIconSvg(name, isDir);
  const escapedPath = escapeHtmlText(path);
  const escapedMention = escapeHtmlText(mentionToken(path));
  return (
    `<span class="${FILE_TAG_CLASS}" contenteditable="false" data-file-path="${escapedPath}" data-mention="${escapedMention}" title="${escapedPath}">` +
    `<span class="${FILE_TAG_CLASS}-icon">${icon}</span>` +
    `<span class="${FILE_TAG_CLASS}-text">${escapeHtmlText(name)}</span>` +
    `<span class="${FILE_TAG_CLASS}-close" role="button" aria-label="${escapeHtmlText(i18n.t("chat.removeTag", { name }))}">&times;</span>` +
    `</span>`
  );
}

/** Build the editable's innerHTML from plain text (mentions → chips). */
export function htmlFromText(text: string): string {
  const parts: string[] = [];
  let lastIndex = 0;
  MENTION_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MENTION_RE.exec(text)) !== null) {
    const before = text.slice(lastIndex, match.index);
    parts.push(textToInsertHtml(before));
    parts.push(chipHtml(match[1] ?? match[2]));
    lastIndex = match.index + match[0].length;
  }
  parts.push(textToInsertHtml(text.slice(lastIndex)));
  return parts.join("");
}

/**
 * Sanitize chip HTML at the innerHTML trust boundary. Everything
 * htmlFromText interpolates is already escaped or static icon markup; this
 * makes the invariant provable at each sink. `contenteditable` is
 * allowlisted because DOMPurify's default profile strips it and the chips
 * must stay non-editable.
 */
export function sanitizeEditableHtml(html: string): string {
  return DOMPurify.sanitize(html, { ADD_ATTR: ["contenteditable"] });
}

/**
 * Convert every unrendered mention in the editable into a chip, preserving
 * the caret. No-op when no text node contains a full mention token (so
 * typing `@` or a partial path never rebuilds the DOM).
 */
export function renderFileTags(el: HTMLElement): void {
  let hasUnrendered = false;
  const walk = (node: Node) => {
    if (hasUnrendered) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const data = node.textContent ?? "";
      if (data.includes("@")) {
        MENTION_RE.lastIndex = 0;
        if (MENTION_RE.test(data)) hasUnrendered = true;
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if ((node as HTMLElement).classList.contains(FILE_TAG_CLASS)) return;
    node.childNodes.forEach(walk);
  };
  el.childNodes.forEach(walk);
  if (!hasUnrendered) return;

  const caret = getCaretOffset(el);
  const text = extractText(el);
  el.innerHTML = sanitizeEditableHtml(htmlFromText(text));
  if (caret >= 0) setCaretOffset(el, caret);
}

/**
 * Put the caret where an editing command will insert: the current caret when
 * it already sits inside `el`, otherwise the end. Focus first when needed —
 * execCommand no-ops on an unfocused editing host — then re-pin the caret,
 * because focusing an element whose selection was outside can park it at 0.
 */
function ensureCaretIn(el: HTMLElement) {
  const selection = window.getSelection();
  const alreadyInside =
    !!selection &&
    selection.rangeCount > 0 &&
    el.contains(selection.getRangeAt(0).startContainer);
  if (document.activeElement !== el) el.focus({ preventScroll: true });
  if (alreadyInside) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

/**
 * Plain text as HTML the editing host can insert without parsing markup:
 * escaped text, newlines as <br> (same shape as htmlFromText). CRLF collapses
 * to one break so a Windows clipboard paste doesn't keep a stray `\r`.
 */
function textToInsertHtml(text: string): string {
  return escapeHtmlText(text).replace(/\r\n|\r|\n/g, "<br>");
}

/**
 * Insert plain text at the caret (or at the end when the caret is outside
 * the editable), converting newlines to <br>.
 *
 * Goes through insertHTML so the insert is its own undo step. Two failure
 * modes if it doesn't: a raw Range mutation never enters the undo stack, so
 * Ctrl+Z restores the pre-typing snapshot and takes the paste with it; and
 * insertText is swallowed by the still-open typing command, so the same
 * Ctrl+Z drops everything typed before the paste as well. insertHTML is not
 * a typing command, so it closes that group and undoes as one paste.
 * The command fires an input event; the caller still emits the change for
 * engines that don't. Falls back to a DOM insert where execCommand is
 * unavailable (jsdom).
 */
export function insertTextAtCaret(el: HTMLElement, text: string) {
  ensureCaretIn(el);
  el.setAttribute(COMPOSER_INSERTING_ATTR, "");
  let inserted = false;
  try {
    inserted = document.execCommand("insertHTML", false, textToInsertHtml(text));
  } catch {
    // Unsupported or rejected — fall through to the DOM insert.
    inserted = false;
  } finally {
    el.removeAttribute(COMPOSER_INSERTING_ATTR);
  }
  if (inserted) return;
  const selection = window.getSelection();
  let range: Range;
  if (selection && selection.rangeCount > 0 && el.contains(selection.getRangeAt(0).startContainer)) {
    range = selection.getRangeAt(0);
  } else {
    range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
  }
  range.deleteContents();

  const lines = text.split("\n");
  const fragment = document.createDocumentFragment();
  let lastNode: Node | null = null;
  lines.forEach((line, i) => {
    if (i > 0) {
      const br = document.createElement("br");
      fragment.appendChild(br);
      lastNode = br;
    }
    if (line) {
      const node = document.createTextNode(line);
      fragment.appendChild(node);
      lastNode = node;
    }
  });
  range.insertNode(fragment);
  if (lastNode) {
    const caretRange = document.createRange();
    caretRange.setStartAfter(lastNode);
    caretRange.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(caretRange);
  }
}
