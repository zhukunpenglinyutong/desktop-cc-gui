import { describe, expect, it } from "vitest";
import { resolvePanelLayout } from "./panel-layout";

describe("resolvePanelLayout", () => {
  it("lets a narrow remote panel use the full available row without clipping", () => {
    expect(
      resolvePanelLayout({
        storedWidth: 560,
        centerRowWidth: 420,
        narrowPanel: true,
        isWeb: true,
      }),
    ).toEqual({ panelWidth: 420, overlay: true });
  });

  it("keeps the chat floor for the native split layout", () => {
    expect(
      resolvePanelLayout({
        storedWidth: 560,
        centerRowWidth: 600,
        narrowPanel: true,
        isWeb: false,
      }),
    ).toEqual({ panelWidth: 280, overlay: false });
  });

  it("does not enable overlay mode for a wide remote viewport", () => {
    expect(
      resolvePanelLayout({
        storedWidth: 560,
        centerRowWidth: 1600,
        narrowPanel: false,
        isWeb: true,
      }),
    ).toEqual({ panelWidth: 560, overlay: false });
  });
});
