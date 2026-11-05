import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";

const mocks = vi.hoisted(() => ({ refreshAppSettings: vi.fn(), isWeb: false }));

vi.mock("@/lib/ipc", () => ({ ipc: { refreshAppSettings: mocks.refreshAppSettings } }));
vi.mock("@/lib/events", () => ({ listenSettingsChanged: async () => () => {} }));
vi.mock("@/lib/platform", () => ({
  get isWeb() {
    return mocks.isWeb;
  },
}));
vi.mock("./WebRelayDeployCard", () => ({ WebRelayDeployCard: () => <div>deploy-card</div> }));
vi.mock("./WebRelayCard", () => ({ WebRelayCard: () => <div>relay-card</div> }));
vi.mock("./WebAuthCard", () => ({ WebAuthCard: () => <div>auth-card</div> }));
vi.mock("./WebDevicesCard", () => ({ WebDevicesCard: () => <div>devices-card</div> }));

import { WebWanPane } from "./WebWanPane";

void i18n;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | null;

async function render() {
  root = createRoot(container);
  await act(async () => root!.render(<WebWanPane onInfoRefresh={() => {}} />));
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  mocks.isWeb = false;
  mocks.refreshAppSettings.mockReset().mockResolvedValue({ webRelayUrl: null, webRelayKey: null });
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  container.remove();
});

describe("WebWanPane", () => {
  it("offers the relay, deploy, pairing and device controls on the desktop", async () => {
    await render();
    for (const card of ["deploy-card", "relay-card", "auth-card", "devices-card"]) {
      expect(container.textContent).toContain(card);
    }
  });

  it("tells a web-access client these controls are desktop-only", async () => {
    mocks.isWeb = true;
    await render();
    expect(container.textContent).toContain(i18n.t("settings.webWanDesktopOnly"));
    for (const card of ["deploy-card", "relay-card", "auth-card", "devices-card"]) {
      expect(container.textContent).not.toContain(card);
    }
    // Nothing to load either: the relay fields are desktop-owned.
    expect(mocks.refreshAppSettings).not.toHaveBeenCalled();
  });
});
