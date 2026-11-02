import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  active: null as null | { workspacePath: string },
  openDedicatedTerminalTab: vi.fn(),
  waitForSession: vi.fn(),
  settleTerminalBacklog: vi.fn(),
  hasTerminalSession: vi.fn(),
  ensureTerminalOutputListener: vi.fn(),
  terminalWrite: vi.fn(),
  closeTab: vi.fn(),
}));

vi.mock("@/lib/ipc", () => ({ ipc: { terminalWrite: mocks.terminalWrite } }));
vi.mock("@/features/chat/store", () => ({
  useChatStore: { getState: () => ({ active: mocks.active }) },
}));
vi.mock("@/features/terminal/store", () => ({
  useTerminalStore: { getState: () => ({ closeTab: mocks.closeTab }) },
}));
vi.mock("@/features/terminal/sessions", () => ({
  hasTerminalSession: mocks.hasTerminalSession,
  ensureTerminalOutputListener: mocks.ensureTerminalOutputListener,
}));
vi.mock("./terminalLogin", () => ({
  ENTER: "\r",
  openDedicatedTerminalTab: mocks.openDedicatedTerminalTab,
  waitForSession: mocks.waitForSession,
  settleTerminalBacklog: mocks.settleTerminalBacklog,
}));

import { launchCliInstallInTerminal, terminalInstallOutcome } from "./cliInstallTerminal";

const LINE = 'curl -fsSL https://claude.ai/install.sh | bash; echo "__CCGUI_CLI_DONE__$?"';

beforeEach(() => {
  mocks.active = { workspacePath: "/project" };
  mocks.openDedicatedTerminalTab.mockReset().mockReturnValue("install-tab");
  mocks.waitForSession.mockReset().mockResolvedValue(true);
  mocks.settleTerminalBacklog.mockReset().mockResolvedValue(120);
  mocks.hasTerminalSession.mockReset().mockReturnValue(true);
  mocks.ensureTerminalOutputListener.mockReset();
  mocks.terminalWrite.mockReset().mockResolvedValue(undefined);
  mocks.closeTab.mockReset();
});

describe("CLI install in the built-in terminal", () => {
  it("types the planned line into a fresh terminal tab", async () => {
    await expect(launchCliInstallInTerminal(LINE)).resolves.toEqual({
      ok: true,
      terminalId: "install-tab",
    });
    expect(mocks.openDedicatedTerminalTab).toHaveBeenCalledWith("/project");
    expect(mocks.terminalWrite).toHaveBeenCalledWith("install-tab", `${LINE}\r`);
    expect(mocks.closeTab).not.toHaveBeenCalled();
  });

  it("needs an active workspace: the terminal dock lives in one", async () => {
    mocks.active = null;
    await expect(launchCliInstallInTerminal(LINE)).resolves.toEqual({
      ok: false,
      reason: "no-workspace",
    });
    expect(mocks.openDedicatedTerminalTab).not.toHaveBeenCalled();
  });

  it("closes only its own tab when the PTY never appears or the write fails", async () => {
    mocks.waitForSession.mockResolvedValueOnce(false);
    await expect(launchCliInstallInTerminal(LINE)).resolves.toEqual({
      ok: false,
      reason: "terminal-unavailable",
    });
    expect(mocks.closeTab).toHaveBeenCalledWith("/project", "install-tab");

    mocks.closeTab.mockReset();
    mocks.terminalWrite.mockRejectedValueOnce(new Error("pty gone"));
    await expect(launchCliInstallInTerminal(LINE)).resolves.toEqual({
      ok: false,
      reason: "terminal-unavailable",
    });
    expect(mocks.closeTab).toHaveBeenCalledWith("/project", "install-tab");
  });

  it("reads completion only from the marker the finished command prints", () => {
    expect(terminalInstallOutcome("")).toBe("running");
    // The echo of the typed command is not a completion.
    expect(terminalInstallOutcome(`$ ${LINE}\r\n`)).toBe("running");
    expect(terminalInstallOutcome("> echo __CCGUI_CLI_DONE_^_0 || echo __CCGUI_CLI_DONE_^_1")).toBe(
      "running",
    );
    expect(terminalInstallOutcome(`$ ${LINE}\r\nInstalled!\r\n__CCGUI_CLI_DONE__0\r\n$ `)).toBe(
      "succeeded",
    );
    expect(terminalInstallOutcome("error\r\n__CCGUI_CLI_DONE__1\r\n")).toBe("failed");
  });
});
