import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getAppSettings, terminalWrite, piFamilyAuthList, newTab } = vi.hoisted(() => ({
  getAppSettings: vi.fn(async () => ({})),
  terminalWrite: vi.fn(async () => {}),
  piFamilyAuthList: vi.fn(),
  newTab: vi.fn(),
}));

vi.mock("@/lib/ipc", () => ({
  ipc: { getAppSettings, terminalWrite, piFamilyAuthList },
}));
vi.mock("@/features/chat/store", () => ({
  useChatStore: { getState: () => ({ active: { workspacePath: "/project" } }) },
}));
vi.mock("@/features/terminal/store", () => ({
  useTerminalStore: {
    getState: () => ({ open: true, newTab, activeByWorkspace: { "/project": "term-1" } }),
  },
}));
vi.mock("@/features/terminal/sessions", () => ({ hasTerminalSession: () => true }));

import { launchPiFamilyLogout, waitForPiFamilyLogout } from "./piFamilyLogin";

beforeEach(() => {
  getAppSettings.mockClear();
  terminalWrite.mockClear();
  piFamilyAuthList.mockReset();
  newTab.mockClear();
});

afterEach(() => vi.useRealTimers());

describe("Pi family subscription logout", () => {
  it("runs OMP logout for the selected credential id in a new terminal tab", async () => {
    expect(await launchPiFamilyLogout("omp", "openai-codex")).toBe(true);
    expect(newTab).toHaveBeenCalledWith("/project");
    expect(terminalWrite).toHaveBeenCalledWith(
      "term-1",
      "omp auth-broker logout openai-codex\r",
    );
  });

  it("does not report a launched logout when the terminal write fails", async () => {
    terminalWrite.mockRejectedValueOnce(new Error("terminal closed"));
    await expect(launchPiFamilyLogout("omp", "anthropic")).rejects.toThrow("terminal closed");
  });

  it("opens the Pi logout picker without choosing an account", async () => {
    vi.useFakeTimers();
    expect(await launchPiFamilyLogout("pi", "openai-codex")).toBe(true);
    expect(terminalWrite).toHaveBeenCalledWith("term-1", "pi\r");
    await vi.advanceTimersByTimeAsync(1500);
    expect(terminalWrite).toHaveBeenCalledWith("term-1", "/logout\r");
  });

  it("accepts logout only after every credential id for the row disappears", async () => {
    vi.useFakeTimers();
    piFamilyAuthList
      .mockResolvedValueOnce({ oauthProviders: ["openai-codex"] })
      .mockResolvedValueOnce({ oauthProviders: [] });
    const result = waitForPiFamilyLogout("pi", ["openai", "openai-codex"]);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(result).resolves.toBe(true);
  });
});
