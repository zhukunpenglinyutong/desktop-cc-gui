import {
  findStringMatches,
  findTextMatches,
  highlightSupported,
  type TextSearchOptions,
} from "@/lib/dom-text-search";
import type { TimelineRow } from "./timeline-rows";

/**
 * 对话内搜索（⌘F / Ctrl+F）：数据层负责匹配计数与行定位，DOM 层用 CSS
 * Custom Highlight API 给已挂载的行上底色——不改 Markdown/进程行的渲染
 * 管线，未变行的 memo 与缓存全部不受影响。
 */

/** 一行时间线的可搜索文本：气泡行取消息正文；进程行把折叠的思考/工具
 *  步骤合成一段，命中后由搜索导航展开该行。 */
export function rowSearchText(row: TimelineRow): string {
  if (row.kind === "msg") return row.message.text;
  if (row.kind === "curtain") return "";
  return row.items.map((item) => item.text).join("\n");
}

export interface TimelineMatch {
  rowIndex: number;
  /** Offsets into `rowSearchText(row)`, used to find the process item. */
  start: number;
  end: number;
}

/** 找出所有命中，按文档顺序每处出现一条（与浏览器查找的 “3/12” 计数
 *  一致）。默认大小写不敏感；预览式查找可传 case/wholeWord/regexp。
 *  空查询返回空数组。 */
export function findTimelineMatches(
  rows: TimelineRow[],
  query: string,
  options?: TextSearchOptions,
): TimelineMatch[] {
  const matches: TimelineMatch[] = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    for (const range of findStringMatches(rowSearchText(rows[rowIndex]), query, options)) {
      matches.push({ rowIndex, start: range.start, end: range.end });
    }
  }
  return matches;
}

const HIGHLIGHT_ALL = "ccgui-chat-search";
const HIGHLIGHT_CURRENT = "ccgui-chat-search-current";

/** WKWebView 需 Safari 17.2+；不支持时退化为仅计数+跳转+行圈选。 */
export function searchHighlightSupported(): boolean {
  return highlightSupported();
}

export function clearSearchHighlights(): void {
  if (!searchHighlightSupported()) return;
  CSS.highlights.delete(HIGHLIGHT_ALL);
  CSS.highlights.delete(HIGHLIGHT_CURRENT);
}

/**
 * 给滚动容器内已挂载行的文本命中建 Range 并注册高亮。当前行里选中的那
 * 一处进 CURRENT 组（更高优先级，盖过普通底色），其余命中进 ALL 组。
 * 返回当前命中对应的 Range，调用方据此把单词本身滚进视口——只按行滚会
 * 在同一条长消息有多个命中时停在行首。
 *
 * 时间线是虚拟列表，未挂载的行没有 DOM——调用方在虚拟器挂载/流式变更
 * （MutationObserver）后重绘。`currentOccurrence` 是当前行内的第几个命中
 * （0 基）；不传 `currentRowTotal` 时，该页尚未挂载就回落到当前行的第一个
 * 可见命中。
 *
 * `currentRowTotal` 是数据层在当前行数到的命中数。计数按原文（Markdown
 * 源码、折叠的过程条目）算，高亮按渲染出的 DOM 算：链接网址、未展开的
 * 条目会让两边对不上，这时按序号挑 Range 会挑错词（“下一个”往回跳）。
 * 对不上就整行标为当前、不返回 Range，只保留按行定位。
 */
export function paintSearchHighlights(
  root: HTMLElement,
  query: string,
  currentRowIndex: number | null,
  options?: TextSearchOptions,
  currentOccurrence = 0,
  currentRowTotal?: number,
): Range | null {
  clearSearchHighlights();
  if (!query.trim() || !searchHighlightSupported()) return null;
  const all: Range[] = [];
  const currentRowRanges: Range[] = [];
  for (const match of findTextMatches(root, query, options)) {
    const rowIndex = Number(
      match.node.parentElement?.closest("[data-index]")?.getAttribute("data-index"),
    );
    const range = new Range();
    range.setStart(match.node, match.start);
    range.setEnd(match.node, match.end);
    if (rowIndex === currentRowIndex) currentRowRanges.push(range);
    else all.push(range);
  }
  const countsAgree =
    currentRowTotal === undefined || currentRowRanges.length === currentRowTotal;
  if (!countsAgree) {
    if (all.length > 0) CSS.highlights.set(HIGHLIGHT_ALL, new Highlight(...all));
    if (currentRowRanges.length > 0) {
      const highlight = new Highlight(...currentRowRanges);
      highlight.priority = 1;
      CSS.highlights.set(HIGHLIGHT_CURRENT, highlight);
    }
    return null;
  }
  const active = currentRowRanges[currentOccurrence] ?? currentRowRanges[0] ?? null;
  if (active) {
    for (const range of currentRowRanges) {
      if (range !== active) all.push(range);
    }
  } else {
    all.push(...currentRowRanges);
  }
  if (all.length > 0) CSS.highlights.set(HIGHLIGHT_ALL, new Highlight(...all));
  if (active) {
    const highlight = new Highlight(active);
    // 同一段文本同时命中两组时，当前组必须画在上层。
    highlight.priority = 1;
    CSS.highlights.set(HIGHLIGHT_CURRENT, highlight);
  }
  return active;
}

/** 命中滚入视口时上下各留的白（px）；已在视口内则不动。 */
const SCROLL_MARGIN = 24;

/** 只把命中滚到可见为止，与浏览器查找一致；不改变滚动容器的其他祖先。 */
export function scrollMatchIntoView(
  scrollEl: HTMLElement | null,
  range: Range | null,
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
