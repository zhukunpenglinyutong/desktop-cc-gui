/**
 * Layout-guard CSS test harness.
 *
 * Loads real .css files into a jsdom document so layout-class cascade can be
 * verified via getComputedStyle / styleSheet.cssRules — instead of brittle
 * literal-text `toContain` assertions on raw CSS source.
 *
 * NOTE: This helper is ONLY intended for layout-swapped-platform-guard.test.ts
 * (and any future layout-class invariance tests). It is NOT a general fixture
 * for component testing.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const STYLES_DIR = resolve(process.cwd(), "src/styles");

/** Read a .css file, recursively inlining its `@import "./foo.css";` rules. */
export function readCssWithImports(filePath: string): string {
  const css = readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
  return css.replace(/^@import\s+"(.+?)";$/gm, (_, rel: string) =>
    readCssWithImports(resolve(dirname(filePath), rel)),
  );
}

/** Resolve a stylesheet filename inside src/styles/. */
export function styleFile(name: string): string {
  return resolve(STYLES_DIR, name);
}

/** Inject one CSS string into <head> as a <style> tag; return the element. */
export function injectStyle(css: string): HTMLStyleElement {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
  return style;
}

/**
 * Inject multiple stylesheets (by filename inside src/styles/). Returns each
 * inserted <style> element, with @import rules inlined recursively so the
 * loaded sheet is self-contained.
 */
export function loadStylesheets(...filenames: string[]): HTMLStyleElement[] {
  return filenames.map((name) =>
    injectStyle(readCssWithImports(styleFile(name))),
  );
}

/** Remove all injected <style> tags + body content. Call in afterEach. */
export function cleanupHarness(): void {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
}

/* ─────────────────────────────────────────────────────────── DOM fixtures */

export type AppOptions = {
  /** Desktop layout vs mobile / tablet. */
  layout: "desktop" | "phone" | "tablet";
  /** Platform-specific class (drives Win/mac safety rules). */
  platform?: "windows" | "macos";
  /** Whether the user has flipped the sidebar to the right (swap). */
  swapped?: boolean;
  /** Wide canvas mode (drives messages-history-sticky overrides). */
  canvasWidth?: "narrow" | "wide";
  /** Sidebar collapsed (drives Win-mac-mirror padding rules). */
  sidebarCollapsed?: boolean;
  /** Right-panel collapsed (drives Win-mac-mirror padding rules). */
  rightPanelCollapsed?: boolean;
  /** Reduced-transparency theme (currently unused, kept for parity). */
  reducedTransparency?: boolean;
};

/** Build `.app` root class for given options. */
export function appClassName(options: AppOptions): string {
  const tokens = ["app"];
  if (options.layout === "desktop") tokens.push("layout-desktop");
  if (options.layout === "phone") tokens.push("layout-phone");
  if (options.layout === "tablet") tokens.push("layout-tablet");
  if (options.swapped) tokens.push("layout-swapped");
  if (options.platform === "windows") tokens.push("windows-desktop");
  if (options.platform === "macos") tokens.push("macos-desktop");
  if (options.canvasWidth === "wide") tokens.push("canvas-width-wide");
  if (options.sidebarCollapsed) tokens.push("sidebar-collapsed");
  if (options.rightPanelCollapsed) tokens.push("right-panel-collapsed");
  if (options.reducedTransparency) tokens.push("reduced-transparency");
  return tokens.join(" ");
}

/** Create a fresh `.app` root with given options, append to body, return it. */
export function mountApp(options: AppOptions): HTMLDivElement {
  const app = document.createElement("div");
  app.className = appClassName(options);
  document.body.appendChild(app);
  return app;
}

/** Append a child element with a given class to `parent` and return it. */
export function appendDiv(
  parent: HTMLElement,
  className: string,
  tag: keyof HTMLElementTagNameMap = "div",
): HTMLElement {
  const child = document.createElement(tag);
  child.className = className;
  parent.appendChild(child);
  return child;
}

/* ───────────────────────────────────────────────────── cssRules introspection */

/** Find all CSSStyleRule objects in injected sheets matching a predicate. */
export function findRules(
  predicate: (rule: CSSStyleRule) => boolean,
): CSSStyleRule[] {
  const out: CSSStyleRule[] = [];
  for (const sheet of document.styleSheets) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule && predicate(rule)) {
        out.push(rule);
      }
    }
  }
  return out;
}

/** Normalize a selectorText: collapse whitespace runs to a single space. */
export function normalizeSelector(selector: string): string {
  return selector.replace(/\s+/g, " ").trim();
}

/** Find the first rule whose normalized selectorText exactly matches. */
export function findRuleBySelector(selector: string): CSSStyleRule | undefined {
  const want = normalizeSelector(selector);
  return findRules((r) => normalizeSelector(r.selectorText) === want)[0];
}

/** Return true if any rule has the given normalized selectorText. */
export function hasRuleWithSelector(selector: string): boolean {
  return findRuleBySelector(selector) !== undefined;
}
