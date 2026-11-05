import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/transport", () => ({ invoke: mocks.invoke, isWeb: false }));

import { CredentialConsentDialogHost } from "./dialogs";
import { withCredentialConsent } from "@/lib/credential-consent";

void i18n;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  mocks.invoke.mockReset().mockImplementation(async (command: string) => {
    if (command === "cli_credential_consent_get") return false;
    if (command === "cli_credential_sources") {
      return [{ provider: "codex", kind: "file", location: "/home/u/.codex/auth.json", host: "chatgpt.com" }];
    }
    return undefined;
  });
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  container.remove();
});

describe("CredentialConsentDialogHost", () => {
  it("opens without focusing Allow, so a stray Enter cannot grant", async () => {
    root = createRoot(container);
    await act(async () => root!.render(<CredentialConsentDialogHost />));
    const composer = document.createElement("textarea");
    document.body.appendChild(composer);
    composer.focus();

    const lookup = withCredentialConsent(() =>
      Promise.reject("CredentialConsentRequired: not allowed"),
    ).catch(() => "declined");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const allow = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === i18n.t("plugins.credentialConsent.allow"),
    );
    expect(allow).toBeTruthy();
    expect(document.body.textContent).toContain("/home/u/.codex/auth.json");
    expect(document.activeElement).not.toBe(allow);

    const cancel = [...document.querySelectorAll("button")].find(
      (button) => button.textContent === i18n.t("common.cancel"),
    )!;
    await act(async () => cancel.click());
    await expect(lookup).resolves.toBe("declined");
    composer.remove();
  });
});
