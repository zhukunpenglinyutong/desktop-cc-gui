/**
 * Which open files get a rendered preview in the editor tab, and the mode
 * they open with. Markdown has its own renderer (MarkdownPreview) and opens
 * rendered. HTML renders through HtmlPreview, which needs the desktop
 * `ccgui-preview` protocol — the web-access mode has no equivalent, so there
 * HTML has no preview at all. On desktop HTML still opens in the code view:
 * rendering runs the file's own scripts, so it waits for an explicit
 * "预览" click.
 */

export type EditorViewMode = "edit" | "preview";

const MARKDOWN_RE = /\.(?:md|markdown)$/i;
const HTML_RE = /\.(?:html?|xhtml)$/i;

/** Markdown preview is available on every platform. */
export function isMarkdownFile(name: string): boolean {
  return MARKDOWN_RE.test(name);
}

/** HTML file, before the platform gate — see `canPreviewFile`. */
export function isHtmlFile(name: string): boolean {
  return HTML_RE.test(name);
}

/** Whether the editor offers the edit / preview toggle: Markdown always,
 *  HTML only where the preview protocol exists (desktop). */
export function canPreviewFile(name: string, hasFilePreviews: boolean): boolean {
  return isMarkdownFile(name) || (hasFilePreviews && isHtmlFile(name));
}

/** Whether the file opens already rendered: Markdown only. HTML opens as
 *  code — rendering it executes the page, which must be the user's choice. */
export function opensInPreview(name: string): boolean {
  return isMarkdownFile(name);
}

/** Whether context menus offer "在浏览器中打开": HTML files on desktop only.
 *  Over web access the host would launch its own browser, which the remote
 *  user never sees. */
export function canOpenInBrowser(name: string, isDesktop: boolean): boolean {
  return isDesktop && isHtmlFile(name);
}
