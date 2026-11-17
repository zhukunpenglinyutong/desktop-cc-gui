import type { IDisposable, Terminal } from "@xterm/xterm";

/** How long a delivered insertion stays comparable with xterm's late echo of
 *  the same text. xterm schedules that echo from a `setTimeout(0)` right after
 *  the insertion, so it normally lands within a few milliseconds; the window
 *  also covers a busy main thread delaying that timer. Matching only extends
 *  this far so a character typed again later is never mistaken for an echo. */
const ECHO_WINDOW_MS = 250;

/** Bounds on retained echo bookkeeping so a long typing burst cannot grow it
 *  without limit. */
const MAX_REMEMBERED = 64;

interface Delivery {
  text: string;
  at: number;
}

/**
 * WKWebView (which Tauri uses on macOS) delivers a system input method's
 * passthrough text as `input` (insertText) *before* that character's
 * `keydown`, which carries the IME placeholder keyCode 229. xterm 6.0.0
 * dedupes the input event against `_keyDownSeen`, a flag armed by the previous
 * key's keydown and cleared only on keyup; while typing fast (or with an IME
 * that reports 229 for every key) the insertion is considered "already sent"
 * and the character never reaches onData. xterm's own keyCode-229 fallback is
 * a deferred textarea diff that races the next key, so it re-adds the
 * character only sometimes — and can add it twice.
 *
 * This bridge accounts for every browser text insertion: it is delivered
 * exactly once, by xterm when xterm does emit, otherwise by us at the end of
 * the input event, and xterm's late echo of an already-delivered insertion is
 * dropped. Composition input (`isComposing`, insertCompositionText) is left
 * entirely to xterm.
 *
 * Upstream reports: https://github.com/xtermjs/xterm.js/issues/5887 (gate),
 * https://github.com/xtermjs/xterm.js/issues/6045 (deferred diff).
 */
export function attachInputBridge(term: Terminal, send: (data: string) => void): IDisposable {
  const element = term.element;

  /** The insertion whose `input` event is being dispatched. */
  let insertion: { text: string; sent: boolean } | null = null;
  /** Insertion texts already delivered, in order, for dropping late echoes. */
  const delivered: Delivery[] = [];
  /** xterm's keypress path sends a character before its `input` event exists. */
  let keypress: { text: string; at: number; handled: boolean } | null = null;

  const remember = (text: string) => {
    const at = performance.now();
    delivered.push({ text, at });
    while (delivered.length > MAX_REMEMBERED || at - delivered[0].at > ECHO_WINDOW_MS) {
      delivered.shift();
    }
  };

  const expire = (at: number) => {
    while (delivered.length && at - delivered[0].at > ECHO_WINDOW_MS) delivered.shift();
  };

  /** Whether `text` is a repeat of recently delivered insertions. The deferred
   *  textarea diff emits the suffix inserted since its keydown, which can span
   *  several rolled-over insertions, so match the newest entries. */
  const isEcho = (text: string): boolean => {
    expire(performance.now());
    let matched = "";
    let count = 0;
    for (let index = delivered.length - 1; index >= 0 && matched.length < text.length; index--) {
      matched = delivered[index].text + matched;
      count++;
    }
    if (matched !== text) return false;
    delivered.splice(delivered.length - count, count);
    return true;
  };

  const onKeyDown = () => {
    // Each key sequence starts a fresh keypress record.
    keypress = null;
  };

  const onKeyPress = (event: Event) => {
    const { charCode, which, keyCode } = event as KeyboardEvent;
    const code = charCode || which || keyCode;
    keypress = code
      ? { text: String.fromCharCode(code), at: performance.now(), handled: false }
      : null;
  };

  const onInputCapture = (event: Event) => {
    insertion = null;
    if (term.options.screenReaderMode) return;
    const input = event as InputEvent;
    if (input.inputType !== "insertText" || !input.data || input.isComposing) return;
    // xterm's keypress path already sent this character; it then skips the
    // input event itself through `_keyPressHandled`.
    const sent =
      keypress !== null &&
      keypress.handled &&
      keypress.text === input.data &&
      performance.now() - keypress.at <= ECHO_WINDOW_MS;
    keypress = null;
    insertion = { text: input.data, sent };
    if (sent) remember(input.data);
  };

  const onInputBubble = () => {
    const current = insertion;
    insertion = null;
    if (!current || current.sent) return;
    remember(current.text);
    send(current.text);
  };

  const dataDisposable = term.onData((data) => {
    if (insertion && data === insertion.text) {
      // xterm emitted the insertion's own text: that is the delivery the
      // bridge was waiting for. If it was already delivered through the
      // keypress path this is xterm double-sending the same key.
      if (!insertion.sent) {
        insertion.sent = true;
        remember(data);
        send(data);
      }
      return;
    }
    if (keypress && !insertion && data === keypress.text) {
      keypress.handled = true;
    }
    // A deferred keyCode-229 textarea diff repeating text the browser already
    // inserted and the bridge already delivered.
    if (!insertion && isEcho(data)) return;
    send(data);
  });

  const listeners: Array<[string, EventListener, boolean]> = [
    ["keydown", onKeyDown, true],
    ["keypress", onKeyPress, true],
    ["input", onInputCapture, true],
    ["input", onInputBubble, false],
  ];
  if (element) {
    for (const [type, listener, capture] of listeners) {
      element.addEventListener(type, listener, capture);
    }
  }

  return {
    dispose() {
      dataDisposable.dispose();
      if (element) {
        for (const [type, listener, capture] of listeners) {
          element.removeEventListener(type, listener, capture);
        }
      }
    },
  };
}
