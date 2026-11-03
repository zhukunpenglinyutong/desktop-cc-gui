/**
 * DOM text-search primitives shared by in-content searches (chat timeline,
 * markdown preview). By default matches are case-insensitive, literal and
 * non-overlapping, in document order — the same contract as the browser's own
 * find counter. Preview search opts into case/whole-word/regexp matching.
 *
 * Callers turn the node/offset pairs into Ranges: highlights go through the
 * CSS Custom Highlight API (`highlightSupported`), so rendered content is
 * never mutated and React/Streamdown caches stay valid.
 */

export interface TextMatch {
  node: Text;
  /** Character offsets into `node.nodeValue`. */
  start: number;
  end: number;
}

export interface TextMatchRange {
  /** Character offsets into the searched string. */
  start: number;
  end: number;
}

export interface TextSearchOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
  regexp?: boolean;
}

const WORD_CHAR = /[\p{L}\p{N}_]/u;

function codePointBefore(text: string, index: number): string {
  if (index <= 0) return "";
  const last = text.charCodeAt(index - 1);
  if (last >= 0xdc00 && last <= 0xdfff && index >= 2) {
    const full = text.codePointAt(index - 2);
    return full === undefined ? text[index - 1] : String.fromCodePoint(full);
  }
  return text[index - 1];
}

function codePointAt(text: string, index: number): string {
  if (index < 0 || index >= text.length) return "";
  const point = text.codePointAt(index);
  return point === undefined ? "" : String.fromCodePoint(point);
}

function isWholeWord(text: string, start: number, end: number): boolean {
  return !WORD_CHAR.test(codePointBefore(text, start)) && !WORD_CHAR.test(codePointAt(text, end));
}

interface TextMatcher {
  exec(text: string): TextMatchRange[];
}

function createMatcher(query: string, options: TextSearchOptions): TextMatcher | null {
  const needle = query.trim();
  if (!needle) return null;
  if (options.regexp) {
    let regexp: RegExp;
    try {
      regexp = new RegExp(needle, options.caseSensitive ? "g" : "gi");
    } catch {
      return null;
    }
    return {
      exec(text) {
        const matches: TextMatchRange[] = [];
        regexp.lastIndex = 0;
        for (let found = regexp.exec(text); found; found = regexp.exec(text)) {
          const start = found.index;
          const end = start + found[0].length;
          if (end === start) {
            regexp.lastIndex += 1;
            continue;
          }
          if (!options.wholeWord || isWholeWord(text, start, end)) {
            matches.push({ start, end });
          }
        }
        return matches;
      },
    };
  }
  const literal = options.caseSensitive ? needle : needle.toLowerCase();
  return {
    exec(text) {
      const haystack = options.caseSensitive ? text : text.toLowerCase();
      const matches: TextMatchRange[] = [];
      let from = 0;
      for (;;) {
        const at = haystack.indexOf(literal, from);
        if (at === -1) break;
        const end = at + literal.length;
        if (!options.wholeWord || isWholeWord(text, at, end)) {
          matches.push({ start: at, end });
        }
        from = end;
      }
      return matches;
    },
  };
}

/** Matches of `query` in a plain string, using the same options as the DOM
 *  walker (chat timeline rows are plain text, not DOM). */
export function findStringMatches(
  text: string,
  query: string,
  options: TextSearchOptions = {},
): TextMatchRange[] {
  const matcher = createMatcher(query, options);
  return matcher ? matcher.exec(text) : [];
}

/** Every occurrence of `query` under `root`, walking text nodes in order.
 *  A blank query yields no matches; an invalid regexp also yields none. */
export function findTextMatches(
  root: Node,
  query: string,
  options: TextSearchOptions = {},
): TextMatch[] {
  const matcher = createMatcher(query, options);
  if (!matcher) return [];
  const doc =
    root.ownerDocument ?? (typeof document !== "undefined" ? document : null);
  if (!doc) return [];
  const matches: TextMatch[] = [];
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const text = node.nodeValue ?? "";
    for (const { start, end } of matcher.exec(text)) {
      matches.push({ node: node as Text, start, end });
    }
    node = walker.nextNode();
  }
  return matches;
}

/** WKWebView needs Safari 17.2+, Chromium always has it. Callers fall back to
 *  count-and-scroll when unsupported. */
export function highlightSupported(): boolean {
  return (
    typeof CSS !== "undefined" &&
    "highlights" in CSS &&
    typeof Highlight !== "undefined"
  );
}
