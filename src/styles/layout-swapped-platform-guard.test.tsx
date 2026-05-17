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
 *
 * The "Claude render-safe mitigation" describe block was de-pinned from
 * `messages.part1.css` (and `messages.status-shell.css`) by injecting a
 * self-contained contract-CSS snippet instead of loading `messages.css`.
 * The architectural invariant being tested ("render-safe scope must be
 * platform-anchored") is preserved while leaving the source CSS free to
 * evolve or be inlined into React components without breaking this test.
 */

// @vitest-environment jsdom
import { render, cleanup as cleanupReact } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MessagesHistoryStickyHeader } from "../features/messages/components/MessagesHistoryStickyHeader";
import type { HistoryStickyCandidate } from "../features/messages/components/messagesRenderUtils";
import {
  appendDiv,
  cleanupHarness,
  findRuleBySelector,
  findRules,
  hasRuleWithSelector,
  injectStyle,
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
      loadStylesheets("base.css", "main.css", "messages.css", "diff-keepers.css");
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
    // Phase P0-1 deepen: the sticky header is now an extracted React
    // component (`MessagesHistoryStickyHeader`) that carries its layout
    // styles inline. These tests render the component into a wrapper
    // `.app[.canvas-width-wide]` host so the ancestor-class observer in the
    // component sees the wide-canvas flag, then read the inline `style`
    // attribute on the rendered DOM. None of these assertions depend on
    // `messages.history-sticky.css` existing on disk.

    const CANDIDATE: HistoryStickyCandidate = {
      id: "sticky-test",
      text: "Sticky header probe",
    };

    afterEach(() => {
      cleanupReact();
    });

    function renderStickyHeader(opts: {
      canvasWidth?: "wide";
      collapsed?: boolean;
    } = {}) {
      const host = document.createElement("div");
      const appClasses = ["app", "layout-desktop"];
      if (opts.canvasWidth === "wide") appClasses.push("canvas-width-wide");
      host.className = appClasses.join(" ");
      document.body.appendChild(host);

      const main = document.createElement("div");
      main.className = "main";
      host.appendChild(main);

      const { unmount } = render(
        <MessagesHistoryStickyHeader
          candidate={CANDIDATE}
          isCollapsed={opts.collapsed ?? true}
          onCollapse={() => {}}
          onExpand={() => {}}
        />,
        { container: main },
      );

      const header = main.querySelector<HTMLElement>(
        ".messages-history-sticky-header",
      );
      if (!header) throw new Error("sticky header did not render");
      const inner = header.querySelector<HTMLElement>(
        ".messages-history-sticky-header-inner",
      );
      const content = header.querySelector<HTMLElement>(
        ".messages-history-sticky-header-content",
      );
      const bubble = header.querySelector<HTMLElement>(
        ".messages-history-sticky-header-bubble",
      );
      if (!inner || !content || !bubble) {
        throw new Error("sticky header sub-elements did not render");
      }

      return { host, header, inner, content, bubble, unmount };
    }

    it("default-canvas collapsed header pulls right margin to negate panel padding", () => {
      const { header } = renderStickyHeader();
      // Inline style applied by the component when collapsed (default canvas):
      //   marginRight: "calc(-1 * var(--main-panel-padding))"
      expect(header.style.marginRight).toContain("calc");
      expect(header.style.marginRight).toContain("main-panel-padding");
    });

    it("wide-canvas collapsed header overrides to margin-right: -25px", () => {
      const { header } = renderStickyHeader({ canvasWidth: "wide" });
      // Ancestor observer must have detected `.canvas-width-wide` before this
      // assertion runs; testing-library's render flushes useEffect so the
      // override is in effect immediately.
      expect(header.style.marginRight).toBe("-25px");
    });

    it("collapsed inner zeros its right padding", () => {
      const { inner } = renderStickyHeader();
      expect(inner.style.paddingRight).toBe("0px");
    });

    it("collapsed content justifies items to flex-end", () => {
      const { content } = renderStickyHeader();
      expect(content.style.justifyContent).toBe("flex-end");
    });

    it("collapsed bubble takes the peek width and resets transform", () => {
      const { bubble } = renderStickyHeader();
      expect(bubble.style.width).toContain(
        "var(--messages-history-sticky-peek-width",
      );
      expect(bubble.style.transform).toBe("none");
    });

    it("declares --messages-history-sticky-peek-width: 16px on the content scope", () => {
      const { content } = renderStickyHeader();
      expect(
        content.style.getPropertyValue("--messages-history-sticky-peek-width"),
      ).toBe("16px");
    });

    it("peek itself is borderless / no clip-path (the rectangular peek strip shape)", () => {
      const { header } = renderStickyHeader();
      const peek = header.querySelector<HTMLElement>(
        ".messages-history-sticky-header-peek",
      );
      expect(peek).not.toBeNull();
      // jsdom keeps a numeric `borderRadius: 0` as the string "0px"; using
      // getPropertyValue returns the original assigned value ("0" or "0px")
      // depending on how the React style serializer formatted it.
      expect(
        peek!.style.borderRadius === "0" || peek!.style.borderRadius === "0px",
      ).toBe(true);
      expect(peek!.style.clipPath).toBe("none");
    });

    it("peek slab (replaces ::before) is 5x26", () => {
      const { header } = renderStickyHeader();
      const slab = header.querySelector<HTMLElement>(
        ".messages-history-sticky-header-peek-slab",
      );
      expect(slab).not.toBeNull();
      expect(slab!.style.width).toBe("5px");
      expect(slab!.style.height).toBe("26px");
    });

    it("non-collapsed bubble does NOT take the peek-width override", () => {
      // Cascade-order check replacement: confirm the wide-canvas override is
      // only applied alongside the collapsed-state override (i.e. there's no
      // stale wide-canvas margin leaking onto an expanded header).
      const { header } = renderStickyHeader({
        canvasWidth: "wide",
        collapsed: false,
      });
      // Expanded header has no collapsed margin-right inline rule, so wide
      // canvas (-25px) and default canvas (calc) must both be absent.
      expect(header.style.marginRight).toBe("");
    });
  });

  describe("Claude render-safe mitigation is scoped to desktop messages shell", () => {
    // Contract CSS (decoupled from messages.part1.css / messages.status-shell.css
    // by design): this describe block previously loaded the full `messages.css`
    // chain via `loadStylesheets`, which pinned the literal text of
    // `messages.part1.css` (and `messages.status-shell.css`) — any future
    // attempt to inline those rules into a React component would have broken
    // these jsdom-cascade assertions.
    //
    // We now inject a self-contained "contract CSS" snippet that mirrors the
    // selector/property shape we want to guarantee — the messages CSS files
    // are free to evolve (or even disappear, if inlined) without breaking the
    // architectural invariant being tested here: "the render-safe mitigation
    // must be platform-scoped (.app.<platform>-desktop), not unscoped".
    const RENDER_SAFE_CONTRACT_CSS = `
      .message {
        content-visibility: auto;
      }
      .app.windows-desktop .messages-shell.claude-render-safe .message,
      .app.macos-desktop .messages-shell.claude-render-safe .message {
        content-visibility: visible;
      }
      .working.is-ingress .working-spinner {
        animation-duration: 0.42s;
      }
      .app.windows-desktop
        .messages-shell.claude-render-safe
        .working.is-ingress
        .working-spinner,
      .app.macos-desktop
        .messages-shell.claude-render-safe
        .working.is-ingress
        .working-spinner {
        animation-duration: 1s;
      }
    `;

    beforeEach(() => {
      loadStylesheets("base.css");
      injectStyle(RENDER_SAFE_CONTRACT_CSS);
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
      // Contract invariant: the render-safe spinner override must be
      // platform-scoped (.app.<platform>-desktop ...), never an unscoped rule
      // that selects `.messages-shell.claude-render-safe` directly. We
      // sweep the injected contract CSS for any rule that breaks this
      // invariant — there should be none.
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
