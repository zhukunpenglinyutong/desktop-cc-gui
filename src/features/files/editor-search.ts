import { EditorSelection, Prec, type EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, type KeyBinding, type Panel } from "@codemirror/view";
import { SearchQuery, search as cmSearch, setSearchQuery } from "@codemirror/search";

/**
 * CodeMirror integration for the editor find/replace panel.
 *
 * The panel UI itself lives in `EditorSearchPanel.tsx`; this module only wires
 * the search state, match counting and key bindings. `createPanel` returns a
 * hidden element so CodeMirror keeps its search state and match highlighting
 * (`cm-searchMatch`) while the React panel owns the visible UI.
 */

/** Upper bound for counting / select-all so a large file cannot turn every
 *  keystroke into an unbounded document scan. */
export const EDITOR_SEARCH_MATCH_LIMIT = 10_000;

export interface EditorSearchQueryOptions {
  search: string;
  replace?: string;
  caseSensitive: boolean;
  regexp: boolean;
  wholeWord: boolean;
}

export function createEditorSearchQuery(
  options: EditorSearchQueryOptions,
): SearchQuery {
  return new SearchQuery({
    search: options.search,
    replace: options.replace ?? "",
    caseSensitive: options.caseSensitive,
    regexp: options.regexp,
    wholeWord: options.wholeWord,
    // Non-regexp queries are literal text; only regexp mode interprets
    // backslashes, matching the dbx editor's behaviour.
    literal: !options.regexp,
  });
}

export function dispatchEditorSearchQuery(
  view: EditorView,
  options: EditorSearchQueryOptions,
): SearchQuery {
  const query = createEditorSearchQuery(options);
  view.dispatch({ effects: setSearchQuery.of(query) });
  return query;
}

/** Reset the search query when the panel closes, so the dismissed search
 *  leaves no match highlighting behind. */
export function clearEditorSearchQuery(view: EditorView) {
  view.dispatch({
    effects: setSearchQuery.of(
      createEditorSearchQuery({
        search: "",
        caseSensitive: false,
        regexp: false,
        wholeWord: false,
      }),
    ),
  });
}

export interface EditorSearchMatch {
  from: number;
  to: number;
}

export interface EditorSearchMatchInfo {
  total: number;
  /** 1-based index of the match under the main selection; 0 without matches. */
  index: number;
  /** True when the document holds more matches than `limit`. */
  truncated: boolean;
  valid: boolean;
}

export const EMPTY_EDITOR_SEARCH_MATCH_INFO: EditorSearchMatchInfo = {
  total: 0,
  index: 0,
  truncated: false,
  valid: false,
};

/**
 * Count matches for `query` and locate the one under the main selection.
 * A selection that does not sit exactly on a match still reports the first
 * match as current, like CodeMirror's own search panel.
 */
export function editorSearchMatchInfo(
  state: EditorState,
  query: SearchQuery,
  limit = EDITOR_SEARCH_MATCH_LIMIT,
): EditorSearchMatchInfo {
  if (!query.valid) return EMPTY_EDITOR_SEARCH_MATCH_INFO;
  const cappedLimit = Math.max(1, limit);
  const selection = state.selection.main;
  let total = 0;
  let index = 0;
  let truncated = false;
  const cursor = query.getCursor(state);
  let next = cursor.next();
  while (!next.done) {
    total += 1;
    if (next.value.from === selection.from && next.value.to === selection.to) {
      index = total;
    }
    if (total >= cappedLimit) {
      truncated = !cursor.next().done;
      break;
    }
    next = cursor.next();
  }
  return {
    total,
    index: index || (total > 0 ? 1 : 0),
    truncated,
    valid: true,
  };
}

/** Scrolls a match to the middle of the viewport rather than flush against
 *  an edge, where dragging to select it would trigger edge autoscroll. */
function scrollMatchToCenter(range: { from: number; to: number }) {
  return EditorView.scrollIntoView(EditorSelection.range(range.from, range.to), { y: "center" });
}

/**
 * Select the first match that starts at or after the main selection's start,
 * wrapping to the first match in the document. Used while the query is being
 * typed: `findNext` searches from the selection's *end*, so a match that is
 * already selected (the "f" of "fo", or the word the query was seeded from)
 * would be skipped on every keystroke.
 *
 * The scan starts at the line start rather than at the selection: a cursor
 * started mid-text can return a range the counter never sees (`aa` from
 * inside `aaaa` overlaps the counted matches; a multiline regexp treats the
 * start offset as `^`).
 */
export function selectEditorSearchMatchFromCursor(
  view: EditorView,
  query: SearchQuery,
): boolean {
  if (!query.valid) return false;
  const { from } = view.state.selection.main;
  const cursor = query.getCursor(view.state, view.state.doc.lineAt(from).from);
  let hit = cursor.next();
  while (!hit.done && hit.value.from < from) hit = cursor.next();
  if (hit.done) hit = query.getCursor(view.state).next();
  if (hit.done) return false;
  view.dispatch({
    selection: EditorSelection.single(hit.value.from, hit.value.to),
    effects: scrollMatchToCenter(hit.value),
    userEvent: "select.search",
  });
  return true;
}

export function collectEditorSearchMatches(
  state: EditorState,
  query: SearchQuery,
  limit = EDITOR_SEARCH_MATCH_LIMIT,
): EditorSearchMatch[] {
  if (!query.valid) return [];
  const matches: EditorSearchMatch[] = [];
  const cursor = query.getCursor(state);
  for (let next = cursor.next(); !next.done; next = cursor.next()) {
    matches.push({ from: next.value.from, to: next.value.to });
    if (matches.length >= limit) break;
  }
  return matches;
}

export interface EditorSearchKeymapActions {
  openFind(view: EditorView): boolean;
  openReplace(view: EditorView): boolean;
  /** F3 / Mod-G (Shift for previous): step through matches through the find
   *  card, or open it when closed. CodeMirror's own binding would otherwise
   *  start a search behind the hidden native panel with no card on screen. */
  findNext(view: EditorView): boolean;
  findPrevious(view: EditorView): boolean;
  /** Returns true when a panel was open and has been closed. */
  close(): boolean;
}

/** The replace shortcut dbx uses: ⌘H is reserved by macOS (Hide app), so that
 *  platform gets ⌥⌘F instead. Windows/Linux keep Ctrl+H. */
export function editorSearchReplaceKey(isMac: boolean): string {
  return isMac ? "Alt-Mod-f" : "Mod-h";
}

export function editorSearchKeyBindings(
  actions: EditorSearchKeymapActions,
  isMac: boolean,
): KeyBinding[] {
  return [
    { key: "Mod-f", preventDefault: true, run: (view) => actions.openFind(view) },
    {
      key: editorSearchReplaceKey(isMac),
      preventDefault: true,
      run: (view) => actions.openReplace(view),
    },
    {
      key: "F3",
      preventDefault: true,
      run: (view) => actions.findNext(view),
      shift: (view) => actions.findPrevious(view),
    },
    {
      key: "Mod-g",
      preventDefault: true,
      run: (view) => actions.findNext(view),
      shift: (view) => actions.findPrevious(view),
    },
    // Only consumes Escape while the panel is open; otherwise completion,
    // snippet and multi-selection handlers keep their own Escape behaviour.
    { key: "Escape", run: () => actions.close() },
  ];
}

/** Stable source so the keymap is built once while still reading the latest
 *  React callbacks. */
export interface EditorSearchActionSource {
  current: EditorSearchKeymapActions;
}

/**
 * Hidden sentinel panel used in place of CodeMirror's own search UI.
 *
 * `top` must agree with the `search({ top: true })` config: a panel without
 * the flag lands in CodeMirror's *bottom* panel group, and a hidden bottom
 * group reports the whole scroller height as a bottom scroll margin — which
 * pushes every `scrollIntoView` target above the viewport.
 */
export function createHiddenEditorSearchPanel(): Panel {
  const dom = document.createElement("span");
  dom.hidden = true;
  return {
    dom,
    top: true,
    mount() {
      // The panel group around the hidden sentinel would otherwise paint its
      // own background and 1px border across the editor edge.
      if (dom.parentElement instanceof HTMLElement) {
        dom.parentElement.style.display = "none";
      }
    },
  };
}

export function createEditorSearchExtensions(
  actions: EditorSearchActionSource,
  isMac: boolean,
): Extension[] {
  return [
    cmSearch({
      top: true,
      // Hide CodeMirror's own panel; its search state and match highlighting
      // stay active, and their lifecycle is driven by open/closeSearchPanel.
      createPanel: createHiddenEditorSearchPanel,
      scrollToMatch: scrollMatchToCenter,
    }),
    Prec.high(
      keymap.of(
        editorSearchKeyBindings(
          {
            openFind: (view) => actions.current.openFind(view),
            openReplace: (view) => actions.current.openReplace(view),
            findNext: (view) => actions.current.findNext(view),
            findPrevious: (view) => actions.current.findPrevious(view),
            close: () => actions.current.close(),
          },
          isMac,
        ),
      ),
    ),
  ];
}
