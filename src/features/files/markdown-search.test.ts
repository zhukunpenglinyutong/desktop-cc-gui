import { afterEach, describe, expect, it } from "vitest";
import { findMarkdownMatches, scrollRangeIntoView } from "./markdown-search";

const roots: HTMLElement[] = [];

function makeRoot(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  document.body.appendChild(el);
  roots.push(el);
  return el;
}

afterEach(() => {
  for (const el of roots.splice(0)) el.remove();
});

describe("findMarkdownMatches", () => {
  it("returns one range per occurrence, case-insensitively, in document order", () => {
    const root = makeRoot("<p>Fix the BUG</p><p>bug one, Bug two</p>");
    const ranges = findMarkdownMatches(root, "bug");
    expect(ranges).toHaveLength(3);
    expect(ranges.map((r) => r.toString())).toEqual(["BUG", "bug", "Bug"]);
  });

  it("finds matches across nested block elements and code blocks", () => {
    const root = makeRoot(
      "<h2>友链</h2><p><strong>AtomGit</strong> 托管</p><pre><code>atomgit clone</code></pre>",
    );
    expect(findMarkdownMatches(root, "atomgit")).toHaveLength(2);
    expect(findMarkdownMatches(root, "友链")).toHaveLength(1);
  });

  it("matches CJK substrings without word boundaries", () => {
    const root = makeRoot("<p>感谢 AtomGit 平台 G-Star 认证</p>");
    const ranges = findMarkdownMatches(root, "认证");
    expect(ranges).toHaveLength(1);
    expect(ranges[0].toString()).toBe("认证");
  });

  it("keeps occurrences non-overlapping and ignores blank queries", () => {
    const root = makeRoot("<p>aaaa</p>");
    expect(findMarkdownMatches(root, "aa")).toHaveLength(2);
    expect(findMarkdownMatches(root, "   ")).toEqual([]);
    expect(findMarkdownMatches(root, "")).toEqual([]);
  });

  it("honours case sensitivity", () => {
    const root = makeRoot("<p>Bug bug BUG</p>");
    expect(findMarkdownMatches(root, "bug")).toHaveLength(3);
    expect(findMarkdownMatches(root, "bug", { caseSensitive: true })).toHaveLength(1);
  });

  it("honours whole-word matching", () => {
    const root = makeRoot("<p>cat concatenate cat</p>");
    expect(findMarkdownMatches(root, "cat")).toHaveLength(3);
    expect(
      findMarkdownMatches(root, "cat", { wholeWord: true }).map((range) => range.toString()),
    ).toEqual(["cat", "cat"]);
  });

  it("supports regular expressions and ignores invalid ones", () => {
    const root = makeRoot("<p>bug 123 BUG 456</p>");
    expect(findMarkdownMatches(root, "\\d+", { regexp: true })).toHaveLength(2);
    expect(findMarkdownMatches(root, "BUG", { regexp: true })).toHaveLength(2);
    expect(findMarkdownMatches(root, "BUG", { regexp: true, caseSensitive: true })).toHaveLength(1);
    expect(findMarkdownMatches(root, "(", { regexp: true })).toEqual([]);
  });
});

describe("scrollRangeIntoView", () => {
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
    scrollRangeIntoView(scrollEl, fakeRange(box(400, 420)));
    expect(scrollEl.scrollTop).toBe(144); // 420 - 300 + 24
  });

  it("scrolls a match above the view back with margin", () => {
    const scrollEl = document.createElement("div");
    scrollEl.getBoundingClientRect = () => box(100, 300);
    scrollEl.scrollTop = 200;
    scrollRangeIntoView(scrollEl, fakeRange(box(90, 110)));
    expect(scrollEl.scrollTop).toBe(166); // 200 + (90 - 100 - 24)
  });

  it("leaves an already-visible match alone", () => {
    const scrollEl = document.createElement("div");
    scrollEl.getBoundingClientRect = () => box(100, 300);
    scrollEl.scrollTop = 50;
    scrollRangeIntoView(scrollEl, fakeRange(box(150, 170)));
    expect(scrollEl.scrollTop).toBe(50);
  });

  it("is inert without a container or range", () => {
    const scrollEl = document.createElement("div");
    scrollEl.getBoundingClientRect = () => box(100, 300);
    expect(() => scrollRangeIntoView(null, fakeRange(box(400, 420)))).not.toThrow();
    expect(() => scrollRangeIntoView(scrollEl, undefined)).not.toThrow();
  });
});
