import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";

const mocks = vi.hoisted(() => ({
  ipcAccess: vi.fn(),
  launchCodeBuddyLogin: vi.fn(),
  navigate: vi.fn(),
}));

// Any IPC touched by the section is recorded: the section must not probe the
// OS credential store (cmdkey / security / secret-tool) on mount or focus.
vi.mock("@/lib/ipc", () => ({
  ipc: new Proxy(
    {},
    {
      get: (_target, key) => {
        mocks.ipcAccess(String(key));
        return vi.fn().mockResolvedValue(undefined);
      },
    },
  ),
}));
vi.mock("./codebuddyLogin", () => ({
  launchCodeBuddyLogin: mocks.launchCodeBuddyLogin,
}));
vi.mock("react-router-dom", () => ({
  useNavigate: () => mocks.navigate,
}));

import { CodeBuddyAuthSection } from "./CodeBuddyAuthSection";

void i18n;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | null;

async function render() {
  root = createRoot(container);
  await act(async () => root!.render(<CodeBuddyAuthSection />));
}

function loginButton(): HTMLButtonElement {
  return [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes(i18n.t("settings.codebuddyAccountLogin")),
  )!;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  mocks.ipcAccess.mockReset();
  mocks.launchCodeBuddyLogin.mockReset().mockResolvedValue({ ok: true });
  mocks.navigate.mockReset();
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  container.remove();
});

describe("CodeBuddy account section", () => {
  it("never probes the credential store on mount or window focus", async () => {
    await render();
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(mocks.ipcAccess).not.toHaveBeenCalled();
  });

  it("shows a neutral hint instead of a probed login state", async () => {
    await render();
    expect(container.textContent).toContain(i18n.t("settings.codebuddyAccountCliOwned"));
    expect(container.textContent).toContain(i18n.t("settings.codebuddyAccountCliOwnedDesc"));
    expect(loginButton()).toBeTruthy();
  });

  it("closes settings once the login terminal is up", async () => {
    await render();
    await act(async () => loginButton().click());
    expect(mocks.launchCodeBuddyLogin).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith("/");
  });

  it("explains a missing workspace and stays on the page", async () => {
    mocks.launchCodeBuddyLogin.mockResolvedValueOnce({ ok: false, reason: "no-workspace" });
    await render();
    await act(async () => loginButton().click());
    expect(container.textContent).toContain(i18n.t("settings.codebuddyLoginNoWorkspace"));
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("reports a terminal failure, including a thrown launch", async () => {
    mocks.launchCodeBuddyLogin.mockRejectedValueOnce(new Error("pty gone"));
    await render();
    await act(async () => loginButton().click());
    expect(container.textContent).toContain(i18n.t("settings.codebuddyLoginFailed"));
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
