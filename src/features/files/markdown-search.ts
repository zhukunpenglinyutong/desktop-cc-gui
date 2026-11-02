import {
  findTextMatches,
  highlightSupported,
  type TextSearchOptions,
} from "@/lib/dom-text-search";

/**
 * 文件 Markdown 预览内查找（⌘F）：命中范围用 CSS Custom Highlight API
 * 上色，不改 Streamdown 渲染出的 DOM。与对话搜索共用底层文本匹配
 * （`@/lib/dom-text-search`），高亮名独立，两边可同时开启互不覆盖。
 */

const HIGHLIGHT_ALL = "ccgui-md-search";
const HIGHLIGHT_CURRENT = "ccgui-md-search-current";

/** 命中滚入视口时上下各留的白（px），避免命中贴边看不清。 */
const SCROLL_MARGIN = 24;

export function clearMarkdownSearchHighlights(): void {
  if (!highlightSupported()) return;
  CSS.highlights.delete(HIGHLIGHT_ALL);
  CSS.highlights.delete(HIGHLIGHT_CURRENT);
}

/** 预览容器内的全部命中，按文档顺序返回 Range（无高亮支持时也返回，
 *  调用方仍可计数与滚动）。 */
export function findMarkdownMatches(
  root: HTMLElement,
  query: string,
  options?: TextSearchOptions,
): Range[] {
  const doc = root.ownerDocument;
  return findTextMatches(root, query, options).map(({ node, start, end }) => {
    const range = doc.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    return range;
  });
}

/** 全量命中画普通底色，`currentIndex` 那处进 CURRENT 组（更高优先级）。 */
export function paintMarkdownSearchHighlights(
  ranges: Range[],
  currentIndex: number,
): void {
  clearMarkdownSearchHighlights();
  if (!highlightSupported()) return;
  const all: Range[] = [];
  const current: Range[] = [];
  ranges.forEach((range, index) => {
    (index === currentIndex ? current : all).push(range);
  });
  if (all.length > 0) CSS.highlights.set(HIGHLIGHT_ALL, new Highlight(...all));
  if (current.length > 0) {
    const highlight = new Highlight(...current);
    highlight.priority = 1;
    CSS.highlights.set(HIGHLIGHT_CURRENT, highlight);
  }
}

/** 只滚动到命中可见为止（已在视口内不动）：与浏览器查找一致的最小跳转，
 *  不用 scrollIntoView 以免连带滚动祖先容器。 */
export function scrollRangeIntoView(
  scrollEl: HTMLElement | null,
  range: Range | undefined,
): void {
  if (!scrollEl || !range) return;
  const rect = range.getBoundingClientRect();
  const box = scrollEl.getBoundingClientRect();
  if (rect.top < box.top + SCROLL_MARGIN) {
    scrollEl.scrollTop += rect.top - box.top - SCROLL_MARGIN;
  } else if (rect.bottom > box.bottom - SCROLL_MARGIN) {
    scrollEl.scrollTop += rect.bottom - box.bottom + SCROLL_MARGIN;
  }
}
