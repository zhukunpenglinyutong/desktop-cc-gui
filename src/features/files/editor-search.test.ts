import { describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  collectEditorSearchMatches,
  createEditorSearchQuery,
  createHiddenEditorSearchPanel,
  editorSearchKeyBindings,
  editorSearchMatchInfo,
  editorSearchReplaceKey,
  selectEditorSearchMatchFromCursor,
  type EditorSearchKeymapActions,
} from "./editor-search";

function keymapActions(): EditorSearchKeymapActions {
  return {
    openFind: vi.fn(() => true),
    openReplace: vi.fn(() => true),
    findNext: vi.fn(() => true),
    findPrevious: vi.fn(() => true),
    close: vi.fn(() => false),
  };
}

function stateOf(doc: string, selection?: { anchor: number; head?: number }) {
  return EditorState.create({ doc, selection });
}

function queryOf(
  search: string,
  overrides: Partial<{
    caseSensitive: boolean;
    regexp: boolean;
    wholeWord: boolean;
  }> = {},
) {
  return createEditorSearchQuery({
    search,
    caseSensitive: false,
    regexp: false,
    wholeWord: false,
    ...overrides,
  });
}

describe("createEditorSearchQuery", () => {
  it("matches case-insensitively by default and strictly when requested", () => {
    const state = stateOf("Foo foo FOOD");
    expect(editorSearchMatchInfo(state, queryOf("foo")).total).toBe(3);
    expect(editorSearchMatchInfo(state, queryOf("foo", { caseSensitive: true })).total).toBe(1);
  });

  it("honours whole-word matching", () => {
    const state = stateOf("cat concatenate cat");
    expect(editorSearchMatchInfo(state, queryOf("cat")).total).toBe(3);
    expect(editorSearchMatchInfo(state, queryOf("cat", { wholeWord: true })).total).toBe(2);
  });

  it("treats non-regexp queries as literal text", () => {
    const state = stateOf("a\\nb");
    expect(editorSearchMatchInfo(state, queryOf("\\n")).total).toBe(1);
    expect(editorSearchMatchInfo(state, queryOf("\\n", { regexp: true })).total).toBe(0);
  });

  it("reports invalid regular expressions instead of throwing", () => {
    const query = queryOf("(", { regexp: true });
    expect(query.valid).toBe(false);
    const info = editorSearchMatchInfo(stateOf("anything"), query);
    expect(info).toMatchObject({ total: 0, index: 0, valid: false });
  });
});

describe("editorSearchMatchInfo", () => {
  it("locates the match under the main selection", () => {
    const state = stateOf("one two one", { anchor: 8, head: 11 });
    expect(editorSearchMatchInfo(state, queryOf("one"))).toMatchObject({
      total: 2,
      index: 2,
      truncated: false,
      valid: true,
    });
  });

  it("falls back to the first match when the cursor is not on one", () => {
    const state = stateOf("one two one", { anchor: 4 });
    expect(editorSearchMatchInfo(state, queryOf("one")).index).toBe(1);
  });

  it("caps the scan and reports truncation", () => {
    const state = stateOf("a a a a a");
    expect(editorSearchMatchInfo(state, queryOf("a"), 3)).toMatchObject({
      total: 3,
      truncated: true,
    });
    expect(editorSearchMatchInfo(state, queryOf("a"), 5)).toMatchObject({
      total: 5,
      truncated: false,
    });
  });

  it("is empty for an empty query", () => {
    expect(editorSearchMatchInfo(stateOf("abc"), queryOf(""))).toMatchObject({
      total: 0,
      index: 0,
      valid: false,
    });
  });
});

describe("collectEditorSearchMatches", () => {
  it("returns matches up to the requested limit", () => {
    const state = stateOf("one two one three one");
    const matches = collectEditorSearchMatches(state, queryOf("one"), 2);
    expect(matches).toEqual([
      { from: 0, to: 3 },
      { from: 8, to: 11 },
    ]);
  });
});

describe("selectEditorSearchMatchFromCursor", () => {
  function viewOf(doc: string, selection?: { anchor: number; head?: number }) {
    return new EditorView({ state: EditorState.create({ doc, selection }) });
  }
  const selected = (view: EditorView) => [
    view.state.selection.main.from,
    view.state.selection.main.to,
  ];

  it("keeps the match that starts at the selection (typing f -> fo)", () => {
    const view = viewOf("foo foo foo", { anchor: 0, head: 1 });
    expect(selectEditorSearchMatchFromCursor(view, queryOf("fo"))).toBe(true);
    expect(selected(view)).toEqual([0, 2]);
    view.destroy();
  });

  it("keeps a selected word that seeded the query", () => {
    const view = viewOf("alpha foo beta foo", { anchor: 6, head: 9 });
    expect(selectEditorSearchMatchFromCursor(view, queryOf("foo"))).toBe(true);
    expect(selected(view)).toEqual([6, 9]);
    view.destroy();
  });

  it("wraps to the document's first match when none starts at or after the cursor", () => {
    const view = viewOf("foo bar", { anchor: 1 });
    expect(selectEditorSearchMatchFromCursor(view, queryOf("foo"))).toBe(true);
    expect(selected(view)).toEqual([0, 3]);
    view.destroy();
  });

  it("agrees with the counted matches instead of starting mid-text", () => {
    // From offset 1, a raw scan would return the overlapping "aa" at [1,3],
    // which is not one of the counted (and highlighted) matches.
    const overlap = viewOf("aaaa", { anchor: 1 });
    expect(selectEditorSearchMatchFromCursor(overlap, queryOf("aa"))).toBe(true);
    expect(selected(overlap)).toEqual([2, 4]);
    overlap.destroy();

    // A multiline regexp cursor treats its start offset as "^".
    const anchored = viewOf("  x foo\nfoo", { anchor: 4 });
    expect(
      selectEditorSearchMatchFromCursor(anchored, queryOf("^\\s*foo", { regexp: true })),
    ).toBe(true);
    expect(selected(anchored)).toEqual([8, 11]);
    anchored.destroy();
  });

  it("leaves the selection alone without a match or with an invalid query", () => {
    const view = viewOf("foo bar", { anchor: 2 });
    expect(selectEditorSearchMatchFromCursor(view, queryOf("zzz"))).toBe(false);
    expect(selectEditorSearchMatchFromCursor(view, queryOf("(", { regexp: true }))).toBe(false);
    expect(selected(view)).toEqual([2, 2]);
    view.destroy();
  });
});

describe("hidden search panel", () => {
  it("stays in the top panel group so it contributes no scroll margin", () => {
    // A hidden *bottom* panel makes CodeMirror treat the scroller height as a
    // bottom scroll margin, which scrolls matches above the viewport.
    const panel = createHiddenEditorSearchPanel();
    expect(panel.top).toBe(true);
  });

  it("removes its panel group from layout when mounted", () => {
    const group = document.createElement("div");
    const panel = createHiddenEditorSearchPanel();
    group.appendChild(panel.dom);
    panel.mount?.();
    expect(group.style.display).toBe("none");
    expect(panel.dom.hidden).toBe(true);
  });
});

describe("editor search shortcuts", () => {
  it("uses Ctrl+H on Windows/Linux and Alt+Cmd+F on macOS", () => {
    expect(editorSearchReplaceKey(false)).toBe("Mod-h");
    expect(editorSearchReplaceKey(true)).toBe("Alt-Mod-f");
  });

  it("routes Mod-F and the platform replace key to the panel actions", () => {
    const actions = keymapActions();
    const bindings = editorSearchKeyBindings(actions, false);
    expect(bindings.map((binding) => binding.key)).toEqual([
      "Mod-f",
      "Mod-h",
      "F3",
      "Mod-g",
      "Escape",
    ]);
    expect(bindings[0].run?.({} as EditorView)).toBe(true);
    expect(bindings[1].run?.({} as EditorView)).toBe(true);
    expect(actions.openFind).toHaveBeenCalledTimes(1);
    expect(actions.openReplace).toHaveBeenCalledTimes(1);
    expect(bindings[4].run?.({} as EditorView)).toBe(false);
    expect(actions.close).toHaveBeenCalledTimes(1);
  });

  it("routes F3 / Mod-G (Shift for previous) to the panel actions", () => {
    const actions = keymapActions();
    const bindings = editorSearchKeyBindings(actions, false);
    for (const binding of bindings.filter((b) => b.key === "F3" || b.key === "Mod-g")) {
      expect(binding.preventDefault).toBe(true);
      binding.run?.({} as EditorView);
      binding.shift?.({} as EditorView);
    }
    expect(actions.findNext).toHaveBeenCalledTimes(2);
    expect(actions.findPrevious).toHaveBeenCalledTimes(2);
  });

  it("binds Alt+Cmd+F as the replace fallback on macOS", () => {
    const bindings = editorSearchKeyBindings(keymapActions(), true);
    expect(bindings.map((binding) => binding.key)).toEqual([
      "Mod-f",
      "Alt-Mod-f",
      "F3",
      "Mod-g",
      "Escape",
    ]);
  });
});
