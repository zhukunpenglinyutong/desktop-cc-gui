import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "@uiw/react-codemirror";
import {
  closeSearchPanel,
  findNext,
  getSearchQuery,
  openSearchPanel,
  searchPanelOpen,
} from "@codemirror/search";
import {
  clearEditorSearchQuery,
  createEditorSearchExtensions,
  dispatchEditorSearchQuery,
  editorSearchMatchInfo,
  type EditorSearchKeymapActions,
} from "./editor-search";

const mounted: Array<{ view: EditorView; parent: HTMLDivElement }> = [];

function makeView(doc: string, actions: EditorSearchKeymapActions) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const state = EditorState.create({
    doc,
    extensions: [
      // Same base setup the editor uses; its built-in search keymap must lose
      // Mod-F to our Prec.high binding.
      basicSetup(),
      ...createEditorSearchExtensions({ current: actions }, false),
    ],
  });
  const view = new EditorView({ state, parent });
  mounted.push({ view, parent });
  return view;
}

function press(view: EditorView, key: string, init: KeyboardEventInit = {}) {
  view.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }),
  );
}

afterEach(() => {
  while (mounted.length > 0) {
    const entry = mounted.pop();
    entry?.view.destroy();
    entry?.parent.remove();
  }
});

describe("editor search CodeMirror integration", () => {
  it("routes Mod-F to the React panel action instead of CodeMirror's panel", () => {
    const actions: EditorSearchKeymapActions = {
      openFind: vi.fn(() => true),
      openReplace: vi.fn(() => true),
      findNext: vi.fn(() => true),
      findPrevious: vi.fn(() => true),
      close: vi.fn(() => false),
    };
    const view = makeView("alpha beta", actions);
    press(view, "f", { ctrlKey: true });
    expect(actions.openFind).toHaveBeenCalledTimes(1);
    expect(searchPanelOpen(view.state)).toBe(false);
  });

  it("keeps search highlighting and navigation working with the hidden panel", () => {
    const actions: EditorSearchKeymapActions = {
      openFind: vi.fn(() => true),
      openReplace: vi.fn(() => true),
      findNext: vi.fn(() => true),
      findPrevious: vi.fn(() => true),
      close: vi.fn(() => false),
    };
    const view = makeView("one two one", actions);
    openSearchPanel(view);
    expect(searchPanelOpen(view.state)).toBe(true);
    // The native panel group is removed from layout; the React card replaces it.
    expect(view.dom.querySelector<HTMLElement>(".cm-panels")?.style.display).toBe("none");

    const query = dispatchEditorSearchQuery(view, {
      search: "one",
      caseSensitive: false,
      regexp: false,
      wholeWord: false,
    });
    expect(editorSearchMatchInfo(view.state, query)).toMatchObject({ total: 2, index: 1 });

    expect(findNext(view)).toBe(true);
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe(
      "one",
    );

    closeSearchPanel(view);
    expect(searchPanelOpen(view.state)).toBe(false);
    clearEditorSearchQuery(view);
    expect(getSearchQuery(view.state).search).toBe("");
  });

  it("only consumes Escape through the panel action when the panel reports itself open", () => {
    const close = vi.fn(() => true);
    const actions: EditorSearchKeymapActions = {
      openFind: vi.fn(() => true),
      openReplace: vi.fn(() => true),
      findNext: vi.fn(() => true),
      findPrevious: vi.fn(() => true),
      close,
    };
    const view = makeView("alpha", actions);
    press(view, "Escape");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("routes F3 / Mod-G to the card instead of a search behind the hidden panel", () => {
    const actions: EditorSearchKeymapActions = {
      openFind: vi.fn(() => true),
      openReplace: vi.fn(() => true),
      findNext: vi.fn(() => true),
      findPrevious: vi.fn(() => true),
      close: vi.fn(() => false),
    };
    const view = makeView("alpha foo beta foo", actions);
    view.dispatch({ selection: { anchor: 6, head: 9 } });

    press(view, "F3");
    press(view, "g", { ctrlKey: true });
    press(view, "F3", { shiftKey: true });
    // Browsers report key "G" with Shift; CodeMirror resolves Shift-Mod-g
    // through the key code, which jsdom only sets when given.
    press(view, "G", { ctrlKey: true, shiftKey: true, keyCode: 71 });

    expect(actions.findNext).toHaveBeenCalledTimes(2);
    expect(actions.findPrevious).toHaveBeenCalledTimes(2);
    // CodeMirror's own F3 would have opened the hidden panel with the
    // selection as query, painting highlights with no card on screen.
    expect(searchPanelOpen(view.state)).toBe(false);
    expect(getSearchQuery(view.state).search).toBe("");
    expect(view.state.selection.main.from).toBe(6);
  });
});
