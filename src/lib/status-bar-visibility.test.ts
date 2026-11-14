import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  STATUS_BAR_BUILTIN_CATALOG,
  isStatusBarItemHidden,
  setStatusBarItemsVisible,
  useStatusBarVisibilityStore,
} from "./status-bar-visibility";

const STORAGE_KEY = "ccgui.statusBar.hidden";

function resetStore() {
  localStorage.clear();
  useStatusBarVisibilityStore.setState({ hidden: new Set() });
}

/** Re-read the persisted payload by re-running the store's initializer is not
 *  possible (it runs once at import), so the tests assert the written value
 *  directly and the read path through the validator. */
function storedHidden(): string[] {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
}

describe("status bar visibility preference", () => {
  beforeEach(resetStore);
  afterEach(resetStore);

  it("defaults to everything visible", () => {
    expect(isStatusBarItemHidden("builtin:performance")).toBe(false);
    expect(isStatusBarItemHidden("plugin:any:chip")).toBe(false);
    expect(storedHidden()).toEqual([]);
  });

  it("hides and re-shows an item, persisting the hidden set", () => {
    setStatusBarItemsVisible(["builtin:performance"], false);
    expect(isStatusBarItemHidden("builtin:performance")).toBe(true);
    expect(storedHidden()).toEqual(["builtin:performance"]);

    setStatusBarItemsVisible(["builtin:performance"], true);
    expect(isStatusBarItemHidden("builtin:performance")).toBe(false);
    expect(storedHidden()).toEqual([]);
  });

  it("toggles several ids at once (one switch per plugin)", () => {
    const chipIds = ["plugin:demo", "plugin:demo:chip"];
    setStatusBarItemsVisible(chipIds, false);
    expect(chipIds.every(isStatusBarItemHidden)).toBe(true);

    setStatusBarItemsVisible(chipIds, true);
    expect(chipIds.some(isStatusBarItemHidden)).toBe(false);
  });

  it("keeps unrelated ids untouched when hiding one item", () => {
    setStatusBarItemsVisible(["builtin:zoom"], false);
    expect(isStatusBarItemHidden("builtin:zoom")).toBe(true);
    expect(isStatusBarItemHidden("builtin:sync")).toBe(false);
  });

  it("every builtin catalog entry carries a distinct id and anchor", () => {
    const ids = STATUS_BAR_BUILTIN_CATALOG.map((item) => item.id);
    const anchors = STATUS_BAR_BUILTIN_CATALOG.map((item) => item.anchor);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(anchors).size).toBe(anchors.length);
  });
});
