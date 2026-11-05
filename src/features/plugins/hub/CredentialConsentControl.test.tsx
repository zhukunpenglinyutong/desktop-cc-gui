import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  request: vi.fn(),
  changeListeners: new Set<(granted: boolean) => void>(),
  isWeb: false,
}));

vi.mock("@/lib/credential-consent", () => ({
  getCredentialConsent: mocks.get,
  setCredentialConsent: mocks.set,
  requestCredentialConsent: mocks.request,
  subscribeCredentialConsentChange: (cb: (granted: boolean) => void) => {
    mocks.changeListeners.add(cb);
    return () => mocks.changeListeners.delete(cb);
  },
}));
vi.mock("@/lib/transport", () => ({
  get isWeb() {
    return mocks.isWeb;
  },
}));

import { CredentialConsentControl } from "./CredentialConsentControl";

void i18n;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | null;

async function render() {
  root = createRoot(container);
  await act(async () => root!.render(<CredentialConsentControl />));
}

function button(): HTMLButtonElement | undefined {
  return container.querySelector("button") ?? undefined;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  mocks.isWeb = false;
  mocks.changeListeners.clear();
  mocks.get.mockReset().mockResolvedValue(false);
  mocks.set.mockReset().mockResolvedValue(undefined);
  mocks.request.mockReset().mockResolvedValue(true);
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  container.remove();
});

describe("CredentialConsentControl", () => {
  it("grants only through the disclosure prompt", async () => {
    await render();
    expect(container.textContent).toContain(i18n.t("plugins.credentialConsent.notGranted"));
    await act(async () => button()!.click());
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.set).not.toHaveBeenCalled();
    expect(container.textContent).toContain(i18n.t("plugins.credentialConsent.granted"));
  });

  it("stays not granted when the prompt is declined", async () => {
    mocks.request.mockResolvedValueOnce(false);
    await render();
    await act(async () => button()!.click());
    expect(container.textContent).toContain(i18n.t("plugins.credentialConsent.notGranted"));
  });

  it("revokes directly and reports a failure", async () => {
    mocks.get.mockResolvedValue(true);
    await render();
    expect(container.textContent).toContain(i18n.t("plugins.credentialConsent.granted"));
    await act(async () => button()!.click());
    expect(mocks.set).toHaveBeenCalledWith(false);
    expect(container.textContent).toContain(i18n.t("plugins.credentialConsent.notGranted"));

    mocks.request.mockRejectedValueOnce(new Error("disk full"));
    await act(async () => button()!.click());
    expect(container.textContent).toContain(i18n.t("plugins.credentialConsent.failed"));
  });

  it("follows a grant made through the plugin-triggered prompt", async () => {
    await render();
    expect(container.textContent).toContain(i18n.t("plugins.credentialConsent.notGranted"));
    await act(async () => mocks.changeListeners.forEach((cb) => cb(true)));
    expect(container.textContent).toContain(i18n.t("plugins.credentialConsent.granted"));
    await act(async () => root!.unmount());
    root = null;
    expect(mocks.changeListeners.size).toBe(0);
  });

  it("renders nothing for web-access clients", async () => {
    mocks.isWeb = true;
    await render();
    expect(container.textContent).toBe("");
    expect(mocks.get).not.toHaveBeenCalled();
  });
});
