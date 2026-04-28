import { describe, expect, it } from "vitest";
import {
  DEFAULT_CLIENT_UI_VISIBILITY_PREFERENCE,
  isClientUiControlPreferenceVisible,
  isClientUiControlVisible,
  isClientUiPanelVisible,
  normalizeClientUiVisibilityPreference,
  setClientUiControlVisibility,
  setClientUiPanelVisibility,
} from "./clientUiVisibility";

describe("clientUiVisibility", () => {
  it("treats missing and malformed preferences as fully visible", () => {
    expect(normalizeClientUiVisibilityPreference(null)).toEqual(
      DEFAULT_CLIENT_UI_VISIBILITY_PREFERENCE,
    );
    expect(
      normalizeClientUiVisibilityPreference({
        panels: { topSessionTabs: "nope", unknown: false },
        controls: { "topTool.terminal": 0, "future.control": false },
      }),
    ).toEqual({ panels: {}, controls: {} });
  });

  it("ignores unknown keys while applying known booleans", () => {
    const preference = normalizeClientUiVisibilityPreference({
      panels: {
        topSessionTabs: false,
        futurePanel: false,
      },
      controls: {
        "topTool.terminal": false,
        "curtain.stickyUserBubble": false,
        "future.control": false,
      },
    });

    expect(preference).toEqual({
      panels: { topSessionTabs: false },
      controls: {
        "topTool.terminal": false,
        "curtain.stickyUserBubble": false,
      },
    });
    expect(isClientUiPanelVisible(preference, "topSessionTabs")).toBe(false);
    expect(isClientUiControlVisible(preference, "topTool.terminal")).toBe(false);
    expect(isClientUiControlVisible(preference, "curtain.stickyUserBubble")).toBe(false);
  });

  it("lets parent panel hiding override child visibility without erasing child preference", () => {
    const preference = setClientUiControlVisibility(
      setClientUiPanelVisibility(
        DEFAULT_CLIENT_UI_VISIBILITY_PREFERENCE,
        "rightActivityToolbar",
        false,
      ),
      "rightToolbar.files",
      true,
    );

    expect(isClientUiPanelVisible(preference, "rightActivityToolbar")).toBe(false);
    expect(
      isClientUiControlPreferenceVisible(preference, "rightToolbar.files"),
    ).toBe(true);
    expect(isClientUiControlVisible(preference, "rightToolbar.files")).toBe(false);

    const restored = setClientUiPanelVisibility(
      preference,
      "rightActivityToolbar",
      true,
    );
    expect(isClientUiControlVisible(restored, "rightToolbar.files")).toBe(true);
  });
});
