/**
 * Layout-swapped platform guard test.
 *
 * Phase P0 of the coss-ui migration refactored these assertions from literal
 * CSS-text `toContain` checks to real jsdom cascade verification. The original
 * intent — pin the layout-swap / Win-mac mirror / desktop-only scope behavior
 * across messages / sidebar / diff-viewer / main — is preserved by:
 *   1. Injecting the actual .css files into jsdom (with @import inlined).
 *   2. Mounting minimal DOM that exercises the relevant selectors.
 *   3. Asserting on getComputedStyle / styleSheet.cssRules — instead of raw
 *      CSS source text.
 *
 * The remaining literal lookups (selector-presence and pseudo-element
 * properties) go through normalized cssRules introspection rather than raw
 * substring checks, so format-only edits (whitespace, comment moves) cannot
 * trigger false-positive failures.
 */

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendDiv,
  cleanupHarness,
  findRuleBySelector,
  findRules,
  hasRuleWithSelector,
  loadStylesheets,
  mountApp,
  normalizeSelector,
} from "./__layout-guard__/cssTestHarness";

afterEach(() => {
  cleanupHarness();
});

describe("layout swapped platform guard", () => {
  describe("scopes swapped structure selectors to desktop layout", () => {
    beforeEach(() => {
      loadStylesheets("base.css", "main.css");
    });

    it("places main and sidebar in the swap grid positions under layout-desktop", () => {
      const app = mountApp({ layout: "desktop", swapped: true });
      const main = appendDiv(app, "main");
      const sidebar = appendDiv(app, "sidebar");
      const resizer = appendDiv(app, "sidebar-resizer");

      expect(getComputedStyle(main).gridColumn).toBe("1");
      expect(getComputedStyle(sidebar).gridColumn).toBe("2");
      // sidebar swaps borders: right→none (jsdom doesn't expand `border-left:
      // 1px solid var(--border-subtle)` because var() blocks shorthand
      // parsing, so we only verify the right-border reset here and rely on
      // the cssRules-level assertion below to pin the border-left value)
      expect(getComputedStyle(sidebar).borderRightStyle).toBe("none");
      const swapSidebarRule = findRuleBySelector(
        ".app.layout-desktop.layout-swapped .sidebar",
      );
      expect(swapSidebarRule).toBeDefined();
      // jsdom doesn't expose shorthand via JS property; use getPropertyValue.
      expect(swapSidebarRule!.style.getPropertyValue("border-left")).toContain(
        "var(--border-subtle)",
      );
      // resizer moves to the right edge
      expect(getComputedStyle(resizer).left).toBe("auto");
      expect(getComputedStyle(resizer).right).not.toBe("");
    });

    it("does NOT apply the swap structure when layout-desktop is absent", () => {
      const app = mountApp({ layout: "phone", swapped: true });
      const main = appendDiv(app, "main");
      const sidebar = appendDiv(app, "sidebar");
      const resizer = appendDiv(app, "sidebar-resizer");

      // phone-mode swap is a no-op — main/sidebar pick up default grid-column
      expect(getComputedStyle(main).gridColumn).toBe("");
      expect(getComputedStyle(sidebar).gridColumn).toBe("");
      expect(getComputedStyle(resizer).right).toBe("");
    });

    it("does NOT apply the swap main-padding when layout-desktop is absent", () => {
      const app = mountApp({ layout: "phone", swapped: true });
      const main = appendDiv(app, "main");
      const topbar = appendDiv(main, "main-topbar");

      // .app.layout-desktop.layout-swapped .main:not(...) .main-topbar { grid-column: 2 }
      // should NOT match without layout-desktop
      expect(getComputedStyle(topbar).gridColumn).not.toBe("2");
    });
  });

  describe("Win/mac titlebar safety mirrors swap and non-swap modes", () => {
    beforeEach(() => {
      loadStylesheets("base.css", "main.css");
    });

    function mountTopbar(opts: Parameters<typeof mountApp>[0]) {
      const app = mountApp(opts);
      const main = appendDiv(app, "main");
      const topbar = appendDiv(main, "main-topbar");
      const actions = appendDiv(topbar, "main-header-actions");
      return { app, topbar, actions };
    }

    it("Win — default mode, right-panel collapsed: topbar gets right padding for window buttons", () => {
      const { topbar } = mountTopbar({
        layout: "desktop",
        platform: "windows",
        rightPanelCollapsed: true,
      });
      expect(getComputedStyle(topbar).paddingRight).toContain("calc(");
    });

    it("Win — swap mode, sidebar collapsed: topbar gets the SAME right padding (mirror)", () => {
      const { topbar } = mountTopbar({
        layout: "desktop",
        platform: "windows",
        swapped: true,
        sidebarCollapsed: true,
      });
      expect(getComputedStyle(topbar).paddingRight).toContain("calc(");
    });

    it("Win — swap mode, right-panel collapsed: topbar does NOT get the Win mirror padding", () => {
      // swapped + right-panel-collapsed should not trigger the same padding
      // because the Win mirror rule is sidebar-collapsed in swap, NOT right
      const { topbar } = mountTopbar({
        layout: "desktop",
        platform: "windows",
        swapped: true,
        rightPanelCollapsed: true,
      });
      expect(getComputedStyle(topbar).paddingRight).not.toContain("titlebar-window-controls-width");
    });

    it("mac — default mode, sidebar collapsed: topbar gets left padding for traffic lights", () => {
      const { topbar } = mountTopbar({
        layout: "desktop",
        platform: "macos",
        sidebarCollapsed: true,
      });
      expect(getComputedStyle(topbar).paddingLeft).toContain("calc(");
    });

    it("mac — swap mode, right-panel collapsed: topbar gets the SAME left padding (mirror)", () => {
      const { topbar } = mountTopbar({
        layout: "desktop",
        platform: "macos",
        swapped: true,
        rightPanelCollapsed: true,
      });
      expect(getComputedStyle(topbar).paddingLeft).toContain("calc(");
    });

    it("Win — default mode, right-panel collapsed: main-header-actions gets right margin", () => {
      const { actions } = mountTopbar({
        layout: "desktop",
        platform: "windows",
        rightPanelCollapsed: true,
      });
      expect(getComputedStyle(actions).marginRight).not.toBe("");
      expect(getComputedStyle(actions).marginRight).not.toBe("0px");
    });

    it("Win — swap mode, sidebar collapsed: main-header-actions gets the SAME right margin", () => {
      const { actions } = mountTopbar({
        layout: "desktop",
        platform: "windows",
        swapped: true,
        sidebarCollapsed: true,
      });
      expect(getComputedStyle(actions).marginRight).not.toBe("");
      expect(getComputedStyle(actions).marginRight).not.toBe("0px");
    });
  });

  describe("sidebar titlebar controls stack above the macOS drag strip", () => {
    beforeEach(() => {
      loadStylesheets("base.css", "sidebar.css");
    });

    it("drag-strip sits at z-index 2", () => {
      const strip = appendDiv(document.body, "drag-strip");
      expect(getComputedStyle(strip).zIndex).toBe("2");
    });

    it("sidebar-topbar-placeholder is positioned relative at z-index 3 (above drag strip)", () => {
      const tp = appendDiv(document.body, "sidebar-topbar-placeholder");
      expect(getComputedStyle(tp).position).toBe("relative");
      expect(getComputedStyle(tp).zIndex).toBe("3");
    });

    it("sidebar-topbar-content stays drag-region but excluded toggle is no-drag", () => {
      // -webkit-app-region is not reified into getComputedStyle by jsdom; read
      // the underlying CSS rule directly.
      const contentRule = findRuleBySelector(".sidebar-topbar-content");
      expect(contentRule).toBeDefined();
      expect(contentRule!.style.getPropertyValue("-webkit-app-region")).toBe("drag");

      const toggleRule = findRuleBySelector(".sidebar-titlebar-toggle");
      expect(toggleRule).toBeDefined();
      expect(toggleRule!.style.getPropertyValue("-webkit-app-region")).toBe("no-drag");
    });
  });

  describe("floating homepage sidebar restore control is icon-only", () => {
    beforeEach(() => {
      loadStylesheets("base.css");
    });

    it("plain restore button picks up border:none / transparent / no shadow", () => {
      const toggle = appendDiv(document.body, "titlebar-sidebar-toggle");
      const btn = appendDiv(toggle, "main-header-action", "button");

      const cs = getComputedStyle(btn);
      expect(cs.borderTopStyle).toBe("none");
      expect(cs.backgroundColor).toBe("rgba(0, 0, 0, 0)");
      expect(cs.boxShadow).toBe("none");
    });

    it("open-app-action exception is NOT stripped of its base treatment", () => {
      // The rule excludes :not(.open-app-action):not(.open-app-toggle), so a
      // button with .open-app-action should NOT be reset to transparent here.
      const toggle = appendDiv(document.body, "titlebar-sidebar-toggle");
      const btn = appendDiv(toggle, "main-header-action open-app-action", "button");

      // We can't measure the absence in cascade, but we can confirm the rule
      // is :not() scoped — i.e. the matching selector includes :not(...).
      const rule = findRules((r) =>
        normalizeSelector(r.selectorText).includes(
          ".titlebar-sidebar-toggle .main-header-action:not(.open-app-action):not(.open-app-toggle)",
        ),
      );
      expect(rule.length).toBeGreaterThan(0);
      // sanity: btn picks up the .main-header-action base (no special check)
      expect(btn.classList.contains("open-app-action")).toBe(true);
    });
  });

  describe("floating sidebar restore control lives on the shared titlebar inset anchor", () => {
    beforeEach(() => {
      loadStylesheets("base.css");
    });

    it("titlebar-toggle-left positions via the titlebar-inset-left variable", () => {
      const left = appendDiv(document.body, "titlebar-toggle titlebar-toggle-left");
      // jsdom preserves calc(var(...)) as a string; just assert it references
      // the inset variable.
      const computedLeft = getComputedStyle(left).left;
      expect(computedLeft).toContain("var(--titlebar-inset-left");
    });

    it("titlebar-toggle-right positions at right: 10px", () => {
      const right = appendDiv(document.body, "titlebar-toggle titlebar-toggle-right");
      expect(getComputedStyle(right).right).toBe("10px");
    });

    it("does NOT keep legacy sidebar-toggle-specific anchor selectors", () => {
      expect(
        hasRuleWithSelector(".titlebar-sidebar-toggle.titlebar-toggle-left"),
      ).toBe(false);
      expect(
        hasRuleWithSelector(".titlebar-sidebar-toggle.titlebar-toggle-right"),
      ).toBe(false);
    });
  });

  describe("expanded sidebar titlebar toggle is icon-only", () => {
    beforeEach(() => {
      loadStylesheets("sidebar.css");
    });

    it("plain expanded toggle picks up border:none / transparent / no shadow", () => {
      const toggle = appendDiv(document.body, "sidebar-titlebar-toggle");
      const btn = appendDiv(toggle, "main-header-action", "button");

      const cs = getComputedStyle(btn);
      expect(cs.borderTopStyle).toBe("none");
      expect(cs.backgroundColor).toBe("rgba(0, 0, 0, 0)");
      expect(cs.boxShadow).toBe("none");
    });
  });

  describe("swapped-only overlay anchoring is isolated from default mode", () => {
    beforeEach(() => {
      loadStylesheets("base.css", "main.css", "messages.css", "diff-viewer.css");
    });

    it("workspace-branch-dropdown flips to right: 0 only under desktop swap", () => {
      const app = mountApp({ layout: "desktop", swapped: true });
      const dropdown = appendDiv(app, "workspace-branch-dropdown");

      expect(getComputedStyle(dropdown).left).toBe("auto");
      expect(getComputedStyle(dropdown).right).toBe("0px");
    });

    it("workspace-project-dropdown flips to right: 0 only under desktop swap", () => {
      const app = mountApp({ layout: "desktop", swapped: true });
      const dropdown = appendDiv(app, "workspace-project-dropdown");

      expect(getComputedStyle(dropdown).left).toBe("auto");
      expect(getComputedStyle(dropdown).right).toBe("0px");
    });

    it("messages-live-controls picks up the sidebar-width offset only under desktop swap", () => {
      const app = mountApp({ layout: "desktop", swapped: true });
      const controls = appendDiv(app, "messages-live-controls");

      // swap rule sets `right: calc(var(--sidebar-width, 210px) + ...)`
      expect(getComputedStyle(controls).right).toContain("sidebar-width");
    });

    it("diff-viewer floating anchor picks up sidebar-width offset only under desktop swap", () => {
      const app = mountApp({ layout: "desktop", swapped: true });
      const anchor = appendDiv(app, "diff-viewer-anchor-floating");

      // swap rule excludes .is-embedded; ours doesn't have that class → matches
      expect(getComputedStyle(anchor).right).toContain("sidebar-width");
    });

    it("is-embedded floating anchor is NOT shifted by the swap rule", () => {
      const app = mountApp({ layout: "desktop", swapped: true });
      const anchor = appendDiv(
        app,
        "diff-viewer-anchor-floating is-embedded",
      );
      // :not(.is-embedded) on the swap rule means embedded variant escapes the
      // sidebar-width offset.
      expect(getComputedStyle(anchor).right).not.toContain("sidebar-width");
    });

    it("under layout-phone (no layout-desktop) swap is a no-op for overlays", () => {
      const app = mountApp({ layout: "phone", swapped: true });
      const dropdown = appendDiv(app, "workspace-branch-dropdown");
      const controls = appendDiv(app, "messages-live-controls");

      // Base rule sets `left: 0;` and leaves `right` unset. The swap rule
      // (which flips to `left: auto; right: 0`) must NOT fire under phone.
      expect(getComputedStyle(dropdown).left).toBe("0px");
      expect(getComputedStyle(dropdown).right).toBe(""); // swap didn't apply

      // controls right should not contain the swap-only sidebar-width offset
      expect(getComputedStyle(controls).right).not.toContain("sidebar-width");
    });
  });

  describe("collapsed message sticky peek hugs the canvas right edge", () => {
    beforeEach(() => {
      loadStylesheets("base.css", "messages.css");
    });

    function mountStickyHeader(opts: { canvasWidth?: "wide" } = {}) {
      const app = mountApp({
        layout: "desktop",
        canvasWidth: opts.canvasWidth,
      });
      const main = appendDiv(app, "main");
      const header = appendDiv(main, "messages-history-sticky-header");
      header.setAttribute("data-history-sticky-collapsed", "true");
      const inner = appendDiv(header, "messages-history-sticky-header-inner");
      const content = appendDiv(inner, "messages-history-sticky-header-content");
      const bubble = appendDiv(
        content,
        "messages-history-sticky-header-bubble is-collapsed",
      );
      return { app, header, inner, content, bubble };
    }

    it("default-canvas collapsed header pulls right margin to negate panel padding", () => {
      const { header } = mountStickyHeader();
      // margin-right: calc(-1 * var(--main-panel-padding))
      expect(getComputedStyle(header).marginRight).toContain("calc");
      expect(getComputedStyle(header).marginRight).toContain("main-panel-padding");
    });

    it("wide-canvas collapsed header overrides to margin-right: -25px", () => {
      const { header } = mountStickyHeader({ canvasWidth: "wide" });
      expect(getComputedStyle(header).marginRight).toBe("-25px");
    });

    it("collapsed inner zeros its right padding", () => {
      const { inner } = mountStickyHeader();
      expect(getComputedStyle(inner).paddingRight).toBe("0px");
    });

    it("collapsed content justifies items to flex-end", () => {
      const { content } = mountStickyHeader();
      expect(getComputedStyle(content).justifyContent).toBe("flex-end");
    });

    it("collapsed bubble takes the peek width and resets transform", () => {
      const { bubble } = mountStickyHeader();
      const cs = getComputedStyle(bubble);
      expect(cs.width).toContain("var(--messages-history-sticky-peek-width");
      expect(cs.transform).toBe("none");
    });

    it("declares --messages-history-sticky-peek-width: 16px on the content scope", () => {
      const contentRule = findRuleBySelector(
        ".messages-history-sticky-header-content",
      );
      expect(contentRule).toBeDefined();
      expect(
        contentRule!.style.getPropertyValue(
          "--messages-history-sticky-peek-width",
        ),
      ).toBe("16px");
    });

    it("peek itself is borderless / no clip-path (the rectangular peek strip shape)", () => {
      // Two rules share `.messages-history-sticky-header-peek` (positioning
      // base + collapsed-state appearance). The collapsed-appearance rule is
      // the one that pins the borderless / no-clip shape.
      const peekRules = findRules(
        (r) =>
          normalizeSelector(r.selectorText) ===
          ".messages-history-sticky-header-peek",
      );
      expect(peekRules.length).toBeGreaterThan(0);
      const borderlessRule = peekRules.find(
        (r) => r.style.getPropertyValue("border-radius") === "0",
      );
      expect(borderlessRule).toBeDefined();
      // jsdom returns shorthand-as-JS-property as undefined; use longhand.
      expect(borderlessRule!.style.getPropertyValue("border-radius")).toBe(
        "0",
      );
      expect(borderlessRule!.style.getPropertyValue("clip-path")).toBe("none");
    });

    it("peek ::before slab is 5x26 (pseudo-element via cssRules, not getComputedStyle)", () => {
      const beforeRule = findRuleBySelector(
        ".messages-history-sticky-header-peek::before",
      );
      expect(beforeRule).toBeDefined();
      expect(beforeRule!.style.width).toBe("5px");
      expect(beforeRule!.style.height).toBe("26px");
    });

    it("wide-canvas overrides come AFTER the collapsed margin-right override (cascade order)", () => {
      // Original literal-text test asserted indexOf > indexOf to ensure that
      // the collapsed override appears AFTER the wide-canvas one; preserve
      // that semantics by checking selectorText positions in cssRules.
      const allRules = findRules(() => true);
      const wideCanvasIdx = allRules.findIndex(
        (r) =>
          normalizeSelector(r.selectorText) ===
          ".app.canvas-width-wide .messages-history-sticky-header-inner",
      );
      const collapsedInnerIdx = allRules.findIndex(
        (r) =>
          normalizeSelector(r.selectorText) ===
          '.messages-history-sticky-header[data-history-sticky-collapsed="true"] .messages-history-sticky-header-inner',
      );
      expect(wideCanvasIdx).toBeGreaterThanOrEqual(0);
      expect(collapsedInnerIdx).toBeGreaterThanOrEqual(0);
      expect(collapsedInnerIdx).toBeGreaterThan(wideCanvasIdx);
    });
  });

  describe("Claude render-safe mitigation is scoped to desktop messages shell", () => {
    beforeEach(() => {
      loadStylesheets("base.css", "messages.css");
    });

    function mountRenderSafe(
      opts: Parameters<typeof mountApp>[0],
    ): { spinner: HTMLElement; message: HTMLElement } {
      const app = mountApp(opts);
      const shell = appendDiv(app, "messages-shell claude-render-safe");
      const working = appendDiv(shell, "working is-ingress");
      const spinner = appendDiv(working, "working-spinner");
      const message = appendDiv(shell, "message");
      return { spinner, message };
    }

    it("on windows-desktop the spinner gets the 1s mitigation animation", () => {
      const { spinner } = mountRenderSafe({
        layout: "desktop",
        platform: "windows",
      });
      expect(getComputedStyle(spinner).animationDuration).toBe("1s");
    });

    it("on macos-desktop the spinner gets the 1s mitigation animation", () => {
      const { spinner } = mountRenderSafe({
        layout: "desktop",
        platform: "macos",
      });
      expect(getComputedStyle(spinner).animationDuration).toBe("1s");
    });

    it("on layout-phone (no platform class) the spinner does NOT get the mitigation", () => {
      const { spinner } = mountRenderSafe({ layout: "phone" });
      // Without windows-desktop / macos-desktop the spinner falls back to
      // whatever the .working.is-ingress base sets — which is NOT 1s. The
      // exact non-mitigated value depends on the cascade but must not be 1s.
      expect(getComputedStyle(spinner).animationDuration).not.toBe("1s");
    });

    it("on windows-desktop the message gets content-visibility: visible (the mitigation)", () => {
      const { message } = mountRenderSafe({
        layout: "desktop",
        platform: "windows",
      });
      expect(getComputedStyle(message).contentVisibility).toBe("visible");
    });

    it("on macos-desktop the message gets content-visibility: visible (the mitigation)", () => {
      const { message } = mountRenderSafe({
        layout: "desktop",
        platform: "macos",
      });
      expect(getComputedStyle(message).contentVisibility).toBe("visible");
    });

    it("on layout-phone (no platform class) the message keeps its base content-visibility", () => {
      const { message } = mountRenderSafe({ layout: "phone" });
      // The base .message rule sets `content-visibility: auto;` — the platform
      // override is what flips it to visible. Without the platform class the
      // value must NOT be 'visible'.
      expect(getComputedStyle(message).contentVisibility).not.toBe("visible");
    });

    it("does NOT keep an unscoped .messages-shell.claude-render-safe spinner rule", () => {
      // The platform-scoped rules exist (.app.windows-desktop ... and
      // .app.macos-desktop ...) but no rule should target `.messages-shell.claude-render-safe`
      // directly without a `.app.<platform>-desktop` ancestor — that's the
      // "scoping" invariant.
      const violating = findRules((r) => {
        const sel = normalizeSelector(r.selectorText);
        return (
          sel.startsWith(".messages-shell.claude-render-safe") &&
          sel.includes(".working.is-ingress") &&
          sel.includes(".working-spinner")
        );
      });
      expect(violating.length).toBe(0);
    });
  });

  describe("swapped sidebar quick nav keeps LTR icon → text → shortcut order", () => {
    beforeEach(() => {
      loadStylesheets("base.css", "sidebar.css");
    });

    function mountQuickNav(opts: Parameters<typeof mountApp>[0]) {
      const app = mountApp(opts);
      const nav = appendDiv(app, "sidebar-primary-nav");
      const item = appendDiv(nav, "sidebar-primary-nav-item", "button");
      const icon = appendDiv(item, "sidebar-primary-nav-icon", "span");
      const text = appendDiv(item, "sidebar-primary-nav-text", "span");
      const shortcut = appendDiv(item, "sidebar-primary-nav-shortcut", "span");
      return { item, icon, text, shortcut };
    }

    it("swap-mode item keeps LTR justify-content + text-align (no RTL flip)", () => {
      const { item } = mountQuickNav({ layout: "desktop", swapped: true });
      const cs = getComputedStyle(item);
      expect(cs.justifyContent).toBe("flex-start");
      expect(cs.textAlign).toBe("left");
    });

    it("swap-mode icon explicitly orders to 0 (leftmost)", () => {
      const { icon } = mountQuickNav({ layout: "desktop", swapped: true });
      expect(getComputedStyle(icon).order).toBe("0");
    });

    it("swap-mode text explicitly orders to 1 (middle)", () => {
      const { text } = mountQuickNav({ layout: "desktop", swapped: true });
      expect(getComputedStyle(text).order).toBe("1");
    });

    it("swap-mode shortcut explicitly orders to 2 with margin-left:auto (rightmost)", () => {
      const { shortcut } = mountQuickNav({
        layout: "desktop",
        swapped: true,
      });
      const cs = getComputedStyle(shortcut);
      expect(cs.order).toBe("2");
      expect(cs.marginLeft).toBe("auto");
      expect(cs.marginRight).toBe("0px");
    });

    it("under desktop without swap, quick-nav explicit order rules do NOT apply", () => {
      const { icon, text, shortcut } = mountQuickNav({
        layout: "desktop",
        swapped: false,
      });
      // Base rules don't set order on icon/text; only the swap rules do. The
      // base shortcut rule sets margin-left:auto so that's unchanged. We just
      // verify that the *swap-only* order overrides are absent from the
      // cascade — icon/text resolve to the unset default ("" in jsdom).
      expect(getComputedStyle(shortcut).marginLeft).toBe("auto"); // base rule
      expect(getComputedStyle(icon).order).toBe(""); // swap rule didn't fire
      expect(getComputedStyle(text).order).toBe(""); // swap rule didn't fire
    });
  });
});
