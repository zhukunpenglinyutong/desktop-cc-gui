/**
 * Sidebar titlebar drag-region invariants.
 *
 * Refactored from literal-text `toContain` assertions on raw CSS source to
 * jsdom-cascade verification via `findRuleBySelector`. This decouples the
 * test from the exact byte-level text of `sidebar.css` so the rules can be
 * inlined into components (or reorganized into other style files) without
 * breaking the test — as long as the cascade still resolves to the same
 * values.
 *
 * The architectural invariant being pinned here: the shell drag-region
 * remains intact (so the user can drag the window from the topbar) while
 * the sidebar toggle button is explicitly carved out as a no-drag region
 * (so clicks land on the button instead of being absorbed by the drag
 * handler).
 */

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupHarness,
  findRuleBySelector,
  loadStylesheets,
} from "./__layout-guard__/cssTestHarness";

describe("sidebar titlebar drag region", () => {
  beforeEach(() => {
    loadStylesheets("sidebar.css");
  });

  afterEach(() => {
    cleanupHarness();
  });

  it("keeps the shell draggable while isolating the sidebar toggle", () => {
    const contentRule = findRuleBySelector(".sidebar-topbar-content");
    const toggleRule = findRuleBySelector(".sidebar-titlebar-toggle");
    const swappedRule = findRuleBySelector(
      ".sidebar-titlebar-toggle.is-layout-swapped",
    );

    expect(contentRule).toBeDefined();
    expect(contentRule!.style.getPropertyValue("justify-content")).toBe(
      "flex-end",
    );
    expect(contentRule!.style.getPropertyValue("-webkit-app-region")).toBe(
      "drag",
    );

    expect(toggleRule).toBeDefined();
    expect(toggleRule!.style.getPropertyValue("width")).toBe("auto");
    expect(toggleRule!.style.getPropertyValue("margin-left")).toBe("auto");
    expect(toggleRule!.style.getPropertyValue("-webkit-app-region")).toBe(
      "no-drag",
    );

    expect(swappedRule).toBeDefined();
    expect(swappedRule!.style.getPropertyValue("margin-right")).toBe("auto");
  });
});
