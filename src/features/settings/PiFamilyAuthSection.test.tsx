import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";

const mocks = vi.hoisted(() => ({
  authList: vi.fn(),
  modelsRead: vi.fn(),
}));

vi.mock("@/lib/ipc", () => ({
  ipc: {
    piFamilyAuthList: mocks.authList,
    piFamilyModelsConfigRead: mocks.modelsRead,
  },
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));
vi.mock("./piFamilyLogin", () => ({
  launchPiFamilyLogin: vi.fn(),
  launchPiFamilyLogout: vi.fn(),
  waitForPiFamilyLogout: vi.fn(),
}));

import { PiFamilyAuthSection } from "./PiFamilyAuthSection";

void i18n;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  mocks.authList.mockReset().mockResolvedValue({
    store: { path: "/home/u/.pi/agent/auth.json", kind: "authJson", exists: true },
    providers: [],
    oauthProviders: [],
  });
  mocks.modelsRead.mockReset().mockResolvedValue({
    file: { path: "/home/u/.pi/agent/models.json", format: "json", exists: false },
    text: null,
    template: "{}",
    providers: [],
    parseError: null,
  });
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  container.remove();
});

describe("PiFamilyAuthSection credential reads", () => {
  it("reads the credential store on mount but not on window focus", async () => {
    root = createRoot(container);
    await act(async () => root!.render(<PiFamilyAuthSection engine="pi" openCustomEditorSignal={0} />));
    expect(mocks.authList).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("focus"));
    });
    expect(mocks.authList).toHaveBeenCalledTimes(1);
  });
});
