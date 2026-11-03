import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  isWeb: false,
}));

vi.mock("@/lib/ipc", () => ({
  ipc: { analyticsEnabledGet: mocks.get, analyticsEnabledSet: mocks.set },
}));
vi.mock("@/lib/platform", () => ({
  get isWeb() {
    return mocks.isWeb;
  },
}));

import { AnalyticsSetting } from "./AnalyticsSetting";

void i18n;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | null;

async function render() {
  root = createRoot(container);
  await act(async () => root!.render(<AnalyticsSetting />));
}

function toggle(): HTMLInputElement {
  return container.querySelector("input[type=checkbox]")!;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  mocks.isWeb = false;
  mocks.get.mockReset().mockResolvedValue(true);
  mocks.set.mockReset().mockResolvedValue(undefined);
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  container.remove();
});

describe("AnalyticsSetting", () => {
  it("explains what is sent and reflects the stored switch", async () => {
    await render();
    expect(container.textContent).toContain(i18n.t("settings.analyticsTitle"));
    expect(container.textContent).toContain(i18n.t("settings.analyticsDesc"));
    expect(toggle().checked).toBe(true);
  });

  it("turns the beacon off through the dedicated command", async () => {
    await render();
    await act(async () => toggle().click());
    expect(mocks.set).toHaveBeenCalledWith(false);
    expect(toggle().checked).toBe(false);
  });

  it("restores the switch and reports a failed save", async () => {
    mocks.set.mockRejectedValueOnce(new Error("disk full"));
    await render();
    await act(async () => toggle().click());
    expect(toggle().checked).toBe(true);
    expect(container.textContent).toContain(i18n.t("settings.analyticsSaveFailed"));
  });

  it("is not offered to web-access clients", async () => {
    mocks.isWeb = true;
    await render();
    expect(container.textContent).toBe("");
    expect(mocks.get).not.toHaveBeenCalled();
  });
});
