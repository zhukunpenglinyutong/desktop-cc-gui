import { afterEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@/lib/ipc";
import { buildRows } from "./timeline-rows";
import {
  findTimelineMatches,
  paintSearchHighlights,
  rowSearchText,
  scrollMatchIntoView,
} from "./timeline-search";

const msg = (seq: number, role: string, text: string): Message => ({
  seq,
  role,
  text,
  ts: null,
});

describe("findTimelineMatches", () => {
  it("returns nothing for a blank query", () => {
    const rows = buildRows([msg(1, "user", "hello")]);
    expect(findTimelineMatches(rows, "")).toEqual([]);
    expect(findTimelineMatches(rows, "   ")).toEqual([]);
  });

  it("matches message text case-insensitively, one entry per occurrence", () => {
    const rows = buildRows([
      msg(1, "user", "Fix the BUG"),
      msg(2, "assistant", "bug one, Bug two"),
    ]);
    expect(findTimelineMatches(rows, "bug")).toEqual([
      { rowIndex: 0, start: 8, end: 11 },
      { rowIndex: 1, start: 0, end: 3 },
      { rowIndex: 1, start: 9, end: 12 },
    ]);
  });

  it("searches folded process rows (thinking + tool steps)", () => {
    const rows = buildRows([
      msg(1, "user", "refactor the store"),
      msg(2, "thinking", "planning the refactor"),
      msg(3, "tool", "read_file"),
      msg(4, "assistant", "done"),
    ]);
    // One process row folds the thinking + tool steps (row index 1).
    expect(rows.map((row) => row.kind)).toEqual(["msg", "process", "msg"]);
    expect(findTimelineMatches(rows, "refactor")).toEqual([
      { rowIndex: 0, start: 0, end: 8 },
      { rowIndex: 1, start: 13, end: 21 },
    ]);
    expect(findTimelineMatches(rows, "read_file")).toEqual([
      { rowIndex: 1, start: 22, end: 31 },
    ]);
  });

  it("does not overlap occurrences", () => {
    const rows = buildRows([msg(1, "user", "aaaa")]);
    expect(findTimelineMatches(rows, "aa")).toEqual([
      { rowIndex: 0, start: 0, end: 2 },
      { rowIndex: 0, start: 2, end: 4 },
    ]);
  });

  it("honours case sensitivity, whole words and regexps", () => {
    const rows = buildRows([msg(1, "assistant", "Bug bug cat concatenate 123")]);
    expect(findTimelineMatches(rows, "bug", { caseSensitive: true })).toHaveLength(1);
    expect(findTimelineMatches(rows, "cat", { wholeWord: true })).toHaveLength(1);
    expect(findTimelineMatches(rows, "\\d+", { regexp: true })).toHaveLength(1);
    expect(findTimelineMatches(rows, "(", { regexp: true })).toEqual([]);
  });
});

describe("rowSearchText", () => {
  it("joins process items into one searchable blob", () => {
    const rows = buildRows([
      msg(1, "thinking", "think"),
      msg(2, "tool", "bash"),
    ]);
    expect(rowSearchText(rows[0])).toBe("think\nbash");
  });
});

describe("chat search highlights", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubHighlightApi() {
    class FakeHighlight {
      priority = 0;
      ranges: Range[];
      constructor(...ranges: Range[]) {
        this.ranges = ranges;
      }
    }
    const highlights = new Map<string, FakeHighlight>();
    vi.stubGlobal("CSS", { highlights });
    vi.stubGlobal("Highlight", FakeHighlight);
    return highlights;
  }

  function makeRoot(html: string) {
    const root = document.createElement("div");
    root.innerHTML = html;
    document.body.appendChild(root);
    return root;
  }

  it("marks only the active occurrence in the current row", () => {
    const highlights = stubHighlightApi();
    const root = makeRoot(
      '<div data-index="0"><p>one one one</p></div><div data-index="1"><p>one two</p></div>',
    );
    const active = paintSearchHighlights(root, "one", 0, undefined, 1);
    expect(active?.toString()).toBe("one");
    expect(highlights.get("ccgui-chat-search-current")?.ranges[0]).toBe(active);
    // The other two occurrences in row 0 and the one in row 1 stay yellow.
    expect(highlights.get("ccgui-chat-search")?.ranges).toHaveLength(3);
    root.remove();
  });

  it("does not guess the active word when the row's DOM and data counts differ", () => {
    const highlights = stubHighlightApi();
    // Raw markdown holds three "foo" (one inside the link URL); the rendered
    // bubble shows two. Picking by index would paint the wrong word.
    const rows = buildRows([msg(1, "assistant", "See [docs](https://x.dev/foo). Then foo, and foo.")]);
    const total = findTimelineMatches(rows, "foo").length;
    expect(total).toBe(3);
    const root = makeRoot('<div data-index="0"><p>See <a>docs</a>. Then foo, and foo.</p></div>');

    const active = paintSearchHighlights(root, "foo", 0, undefined, 2, total);

    expect(active).toBeNull();
    // The whole row is marked current instead (row-level, as before word scrolling).
    expect(highlights.get("ccgui-chat-search-current")?.ranges).toHaveLength(2);
    expect(highlights.has("ccgui-chat-search")).toBe(false);
    root.remove();
  });

  it("picks the active word when the row's DOM and data counts agree", () => {
    stubHighlightApi();
    const root = makeRoot('<div data-index="0"><p>one <b>one</b> one</p></div>');
    const active = paintSearchHighlights(root, "one", 0, undefined, 1, 3);
    expect(active?.startContainer.parentElement?.tagName).toBe("B");
    root.remove();
  });

  it("falls back to the first mounted occurrence when the active page is not rendered", () => {
    stubHighlightApi();
    const root = makeRoot('<div data-index="0"><p>one two</p></div>');
    const active = paintSearchHighlights(root, "one", 0, undefined, 5);
    expect(active?.toString()).toBe("one");
    root.remove();
  });
});

describe("scrollMatchIntoView", () => {
  function box(top: number, bottom: number): DOMRect {
    return {
      top,
      bottom,
      left: 0,
      right: 100,
      width: 100,
      height: bottom - top,
      x: 0,
      y: top,
      toJSON: () => ({}),
    } as DOMRect;
  }

  function fakeRange(rect: DOMRect): Range {
    const range = document.createRange();
    range.getBoundingClientRect = () => rect;
    return range;
  }

  it("scrolls a match below the view just into view with margin", () => {
    const scrollEl = document.createElement("div");
    scrollEl.getBoundingClientRect = () => box(100, 300);
    scrollMatchIntoView(scrollEl, fakeRange(box(400, 420)));
    expect(scrollEl.scrollTop).toBe(144); // 420 - 300 + 24
  });

  it("scrolls a match above the view back with margin", () => {
    const scrollEl = document.createElement("div");
    scrollEl.getBoundingClientRect = () => box(100, 300);
    scrollEl.scrollTop = 200;
    scrollMatchIntoView(scrollEl, fakeRange(box(90, 110)));
    expect(scrollEl.scrollTop).toBe(166); // 200 + (90 - 100 - 24)
  });

  it("leaves an already-visible match alone", () => {
    const scrollEl = document.createElement("div");
    scrollEl.getBoundingClientRect = () => box(100, 300);
    scrollEl.scrollTop = 50;
    scrollMatchIntoView(scrollEl, fakeRange(box(150, 170)));
    expect(scrollEl.scrollTop).toBe(50);
  });

  it("is inert without a container or range", () => {
    const scrollEl = document.createElement("div");
    scrollEl.getBoundingClientRect = () => box(100, 300);
    expect(() => scrollMatchIntoView(null, fakeRange(box(400, 420)))).not.toThrow();
    expect(() => scrollMatchIntoView(scrollEl, null)).not.toThrow();
  });
});
