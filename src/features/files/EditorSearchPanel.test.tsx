import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { openSearchPanel } from "@codemirror/search";
// Side-effect import: initializes the i18next instance useTranslation reads.
import i18n from "@/lib/i18n";
import { EditorSearchPanel, type EditorSearchDirection } from "./EditorSearchPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no layout engine. CodeMirror measures text ranges when a search
// match is scrolled into view; an empty rect list is enough for these tests.
if (typeof Range.prototype.getClientRects !== "function") {
  Object.defineProperty(Range.prototype, "getClientRects", { value: () => [] });
}
if (typeof Range.prototype.getBoundingClientRect !== "function") {
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    value: () => new DOMRect(0, 0, 0, 0),
  });
}

const viewHost = document.createElement("div");
let view: EditorView;
let container: HTMLDivElement;
let root: Root;

function makeView(doc: string, selection?: { anchor: number; head: number }) {
  document.body.appendChild(viewHost);
  view = new EditorView({
    state: EditorState.create({ doc, selection }),
    parent: viewHost,
  });
  openSearchPanel(view);
}

function renderPanel(
  options: {
    showReplace?: boolean;
    readOnly?: boolean;
    isMac?: boolean;
    onShowReplaceChange?: (show: boolean) => void;
    onClose?: () => void;
    navigateRef?: { current: ((direction: EditorSearchDirection) => void) | null };
  } = {},
) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root.render(
      <EditorSearchPanel
        view={view}
        open
        showReplace={options.showReplace ?? false}
        readOnly={options.readOnly ?? false}
        isMac={options.isMac ?? false}
        focusRequest={{ target: "find", token: 1 }}
        documentText={view.state.doc.toString()}
        onShowReplaceChange={options.onShowReplaceChange ?? (() => {})}
        onClose={options.onClose ?? (() => {})}
        navigateRef={options.navigateRef}
      />,
    ),
  );
}

function input(placeholder: string) {
  const field = container.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`);
  if (!field) throw new Error(`input not found: ${placeholder}`);
  return field;
}

function typeInto(field: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function button(label: string) {
  const element = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!element) throw new Error(`button not found: ${label}`);
  return element;
}

function selectedRange() {
  return [view.state.selection.main.from, view.state.selection.main.to];
}

function keyDown(target: HTMLElement, init: KeyboardEventInit) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  });
}

function statusText() {
  return container.querySelector('[role="status"]')?.textContent ?? "";
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  view?.destroy();
  viewHost.remove();
  vi.useRealTimers();
});

describe("EditorSearchPanel", () => {
  it("seeds the query from a single-line selection and selects it", () => {
    makeView("one two one", { anchor: 0, head: 3 });
    renderPanel();

    const field = input(i18n.t("files.editorSearch.find"));
    expect(field.value).toBe("one");
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(3);
  });

  it("keeps the selected word current when the query is seeded from it", () => {
    makeView("alpha foo beta foo", { anchor: 6, head: 9 });
    renderPanel();
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(selectedRange()).toEqual([6, 9]);
    expect(statusText()).toBe("1/2");
  });

  it("does not skip the current match while the query is typed letter by letter", () => {
    makeView("foo foo foo");
    renderPanel();
    const find = input(i18n.t("files.editorSearch.find"));

    // Pauses longer than the debounce, as in normal typing.
    for (const value of ["f", "fo", "foo"]) {
      typeInto(find, value);
      act(() => {
        vi.advanceTimersByTime(200);
      });
    }

    expect(selectedRange()).toEqual([0, 3]);
    expect(statusText()).toBe("1/3");
  });

  it("opens the replace row with Option+Cmd+F on macOS, which WebKit reports as \"ƒ\"", () => {
    const onShowReplaceChange = vi.fn();
    makeView("one two one");
    renderPanel({ isMac: true, onShowReplaceChange });
    const find = input(i18n.t("files.editorSearch.find"));
    // Values measured in a real WKWebView; with Shift it reports key "Ï".
    keyDown(find, { key: "Ï", code: "KeyF", keyCode: 70, metaKey: true, altKey: true, shiftKey: true });
    expect(onShowReplaceChange).not.toHaveBeenCalled();
    keyDown(find, { key: "ƒ", code: "KeyF", keyCode: 70, metaKey: true, altKey: true });
    expect(onShowReplaceChange).toHaveBeenCalledWith(true);
  });

  it("keeps the current match when a toggle still matches it", () => {
    makeView("one ONE one");
    renderPanel();
    typeInto(input(i18n.t("files.editorSearch.find")), "one");
    act(() => {
      vi.advanceTimersByTime(200);
    });
    act(() => button(i18n.t("files.editorSearch.nextMatch")).click());
    act(() => button(i18n.t("files.editorSearch.nextMatch")).click());
    expect(selectedRange()).toEqual([8, 11]);

    act(() => button(i18n.t("files.editorSearch.caseSensitive")).click());
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(selectedRange()).toEqual([8, 11]);
    expect(statusText()).toBe("2/2");
  });

  it("steps with F3 / Ctrl+G inside the card and keeps the counter current", () => {
    makeView("one two one three one");
    renderPanel();
    const find = input(i18n.t("files.editorSearch.find"));
    typeInto(find, "one");
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(statusText()).toBe("1/3");

    keyDown(find, { key: "F3" });
    expect(statusText()).toBe("2/3");
    keyDown(find, { key: "g", ctrlKey: true });
    expect(statusText()).toBe("3/3");
    keyDown(find, { key: "F3", shiftKey: true });
    expect(statusText()).toBe("2/3");
  });

  it("exposes stepping to the editor keymap through navigateRef", () => {
    const navigateRef: { current: ((direction: EditorSearchDirection) => void) | null } = {
      current: null,
    };
    makeView("one two one");
    renderPanel({ navigateRef });
    typeInto(input(i18n.t("files.editorSearch.find")), "one");
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(statusText()).toBe("1/2");

    act(() => navigateRef.current?.("next"));
    expect(statusText()).toBe("2/2");
    expect(selectedRange()).toEqual([8, 11]);

    act(() => root.unmount());
    expect(navigateRef.current).toBeNull();
    root = createRoot(container);
  });

  it("opens the replace row with Ctrl+H while the find input has focus", () => {
    const onShowReplaceChange = vi.fn();
    makeView("one two one");
    renderPanel({ onShowReplaceChange });
    const find = input(i18n.t("files.editorSearch.find"));
    act(() =>
      find.dispatchEvent(
        new KeyboardEvent("keydown", { key: "h", ctrlKey: true, bubbles: true, cancelable: true }),
      ),
    );
    expect(onShowReplaceChange).toHaveBeenCalledWith(true);
  });

  it("searches, counts and steps through matches", () => {
    makeView("one two one");
    renderPanel();

    typeInto(input(i18n.t("files.editorSearch.find")), "one");
    act(() => {
      vi.advanceTimersByTime(200);
    });

    // The first match is selected and the counter reflects it.
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe(
      "one",
    );
    expect(statusText()).toBe("1/2");

    act(() => button(i18n.t("files.editorSearch.nextMatch")).click());
    expect(statusText()).toBe("2/2");
  });

  it("replaces every match", () => {
    makeView("one two one");
    renderPanel({ showReplace: true });

    typeInto(input(i18n.t("files.editorSearch.find")), "one");
    act(() => {
      vi.advanceTimersByTime(200);
    });
    typeInto(input(i18n.t("files.editorSearch.replace")), "1");

    act(() => {
      const replaceAll = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
        (element) => element.textContent === i18n.t("files.editorSearch.replaceAll"),
      );
      replaceAll?.click();
    });

    expect(view.state.doc.toString()).toBe("1 two 1");
  });

  it("hides replacement controls for read-only files", () => {
    makeView("one two one");
    renderPanel({ showReplace: true, readOnly: true });

    expect(
      container.querySelector(`button[aria-label="${i18n.t("files.editorSearch.expandReplace")}"]`),
    ).toBeNull();
    // The row stays mounted for the collapse animation but is not visible.
    const replaceInput = input(i18n.t("files.editorSearch.replace"));
    expect(replaceInput.closest('[style*="visibility: hidden"]')).not.toBeNull();
    expect(button(i18n.t("files.editorSearch.selectAllMatches"))).not.toBeNull();
  });
});
