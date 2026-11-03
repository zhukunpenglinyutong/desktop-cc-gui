import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cliVersionStatus: vi.fn(),
  cliUpdatePlan: vi.fn(),
  cliUpdate: vi.fn(),
  listenCliUpdateProgress: vi.fn(),
}));
const terminalMocks = vi.hoisted(() => ({ launchCliInstallInTerminal: vi.fn() }));
vi.mock("@/lib/ipc", () => ({ ipc: mocks }));
vi.mock("@/lib/events", () => ({
  listenCliUpdateProgress: mocks.listenCliUpdateProgress,
}));
vi.mock("./cliInstallTerminal", () => ({
  launchCliInstallInTerminal: terminalMocks.launchCliInstallInTerminal,
}));
// The launched installer keeps its tab open for the whole test.
vi.mock("@/features/terminal/sessions", () => ({
  terminalBacklog: () => "",
  hasTerminalSession: () => true,
}));

import type { CliUpdatePlan, CliVersionStatus } from "@/lib/ipc";
import type { CliUpdateProgress } from "@/lib/events";
import type { EngineId } from "./providers";
import { useCliUpdateFlow, type CliUpdateFlow } from "./useCliUpdateFlow";

// React 18's act() requires this flag to be set by the test environment.
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function versionStatus(engine: EngineId): CliVersionStatus {
  return {
    engine,
    installed: true,
    localVersion: "1.0.0",
    latestVersion: "1.1.0",
    updateAvailable: true,
    updateKind: "npm",
  };
}

function plan(engine: EngineId): CliUpdatePlan {
  return {
    engine,
    action: "update",
    kind: "npm",
    command: ["npm", "install", "-g", "pkg@latest"],
    manualCommand: "npm install -g pkg@latest",
    terminalCommand: null,
    canRun: true,
    blockers: [],
    platform: "macos",
  };
}

/** Renders the hook and captures its latest value. */
function Probe({ engine, capture }: { engine: EngineId; capture: (v: CliUpdateFlow) => void }) {
  const value = useCliUpdateFlow(engine);
  useEffect(() => {
    capture(value);
  });
  return null;
}

// The version store behind the flow is module-level session state keyed by
// engine: each test uses its own engine so it starts cold.
describe("useCliUpdateFlow", () => {
  let container: HTMLDivElement;
  let root: Root | null;
  let latest: CliUpdateFlow;
  const capture = (v: CliUpdateFlow) => {
    latest = v;
  };
  /** The progress listener registered while a run is active. */
  let progressListener: ((events: CliUpdateProgress[]) => void) | null;

  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.listenCliUpdateProgress.mockImplementation(
      (cb: (events: CliUpdateProgress[]) => void) => {
        progressListener = cb;
        return Promise.resolve(() => {});
      },
    );
    progressListener = null;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = null;
  });

  afterEach(async () => {
    if (root) {
      const current = root;
      await act(async () => current.unmount());
    }
    container.remove();
  });

  async function render(engine: EngineId) {
    mocks.cliVersionStatus.mockResolvedValue(versionStatus(engine));
    const nextRoot = createRoot(container);
    root = nextRoot;
    await act(async () => {
      nextRoot.render(<Probe engine={engine} capture={capture} />);
    });
  }

  it("begin fetches the execution plan and waits for confirmation", async () => {
    mocks.cliUpdatePlan.mockResolvedValue(plan("kimi"));
    await render("kimi");
    expect(latest.state.status).toBe("idle");

    await act(async () => {
      await latest.begin();
    });
    expect(latest.state.status).toBe("ready");
    expect(latest.state.plan?.command).toEqual(["npm", "install", "-g", "pkg@latest"]);
    // No run yet: no runId, no listener, no invoke.
    expect(mocks.cliUpdate).not.toHaveBeenCalled();
    expect(mocks.listenCliUpdateProgress).not.toHaveBeenCalled();
  });

  it("confirm streams only the current run's lines, then finishes done", async () => {
    mocks.cliUpdatePlan.mockResolvedValue(plan("pi"));
    const run = Promise.withResolvers<{ ok: boolean; version: string | null }>();
    mocks.cliUpdate.mockReturnValue(run.promise);
    await render("pi");
    await act(async () => {
      await latest.begin();
    });

    await act(async () => {
      void latest.confirm();
    });
    expect(latest.state.status).toBe("running");
    expect(mocks.cliUpdate).toHaveBeenCalledTimes(1);
    const runId = mocks.cliUpdate.mock.calls[0][1] as string;
    expect(progressListener).not.toBeNull();

    await act(async () => {
      progressListener?.([
        { runId: "someone-else", engine: "pi", phase: "stdout", line: "foreign", exitOk: null },
        { runId, engine: "pi", phase: "stdout", line: "downloading", exitOk: null },
        { runId, engine: "pi", phase: "stderr", line: "warn: deprecated", exitOk: null },
        { runId, engine: "pi", phase: "finished", line: null, exitOk: true },
      ]);
    });
    expect(latest.state.logs).toEqual([
      { stream: "stdout", text: "downloading" },
      { stream: "stderr", text: "warn: deprecated" },
    ]);
    // The finished event alone doesn't close the run — the invoke result does.
    expect(latest.state.status).toBe("running");

    await act(async () => {
      run.resolve({ ok: true, version: "1.1.0" });
      await run.promise;
    });
    expect(latest.state.status).toBe("done");
    // Success re-probes the version through the shared store.
    expect(mocks.cliVersionStatus.mock.calls.length).toBeGreaterThan(1);
  });

  it("a failed run surfaces the error and offers retry", async () => {
    mocks.cliUpdatePlan.mockResolvedValue(plan("omp"));
    mocks.cliUpdate.mockRejectedValue(new Error("npm boom"));
    await render("omp");
    await act(async () => {
      await latest.begin();
    });

    await act(async () => {
      await latest.confirm();
    });
    expect(latest.state.status).toBe("error");
    expect(latest.state.error).toBe("npm boom");
    // The plan stays so retry can re-run without re-planning.
    expect(latest.state.plan).not.toBeNull();
  });

  it("close is a no-op while a run is active", async () => {
    mocks.cliUpdatePlan.mockResolvedValue(plan("claude"));
    const run = Promise.withResolvers<{ ok: boolean; version: string | null }>();
    mocks.cliUpdate.mockReturnValue(run.promise);
    await render("claude");
    await act(async () => {
      await latest.begin();
    });
    await act(async () => {
      void latest.confirm();
    });

    await act(async () => {
      latest.close();
    });
    expect(latest.state.status).toBe("running");

    await act(async () => {
      run.resolve({ ok: true, version: "1.1.0" });
      await run.promise;
    });
    await act(async () => {
      latest.close();
    });
    expect(latest.state.status).toBe("idle");
  });

  it("an official installer is typed into the terminal, never run by the app", async () => {
    const line = 'curl -fsSL https://claude.ai/install.sh | bash; echo "__CCGUI_CLI_DONE__$?"';
    mocks.cliUpdatePlan.mockResolvedValue({ ...plan("codex"), kind: "native", command: [line], terminalCommand: line });
    terminalMocks.launchCliInstallInTerminal.mockReset().mockResolvedValue({ ok: true, terminalId: "tab-1" });
    await render("codex");
    await act(async () => {
      await latest.begin();
    });

    await act(async () => {
      await latest.confirm();
    });
    expect(terminalMocks.launchCliInstallInTerminal).toHaveBeenCalledWith(line);
    expect(mocks.cliUpdate).not.toHaveBeenCalled();
    expect(mocks.listenCliUpdateProgress).not.toHaveBeenCalled();
    expect(latest.state.status).toBe("terminal");
    // The dialog may close while the installer keeps running in its tab.
    await act(async () => {
      latest.close();
    });
    expect(latest.state.status).toBe("idle");
  });

  it("a second click while the terminal opens does not start a second install", async () => {
    const line = 'curl -fsSL https://x/install.sh | bash; echo "__CCGUI_CLI_DONE__$?"';
    mocks.cliUpdatePlan.mockResolvedValue({ ...plan("omp"), kind: "native", command: [line], terminalCommand: line });
    const opening = Promise.withResolvers<{ ok: true; terminalId: string }>();
    terminalMocks.launchCliInstallInTerminal.mockReset().mockReturnValue(opening.promise);
    await render("omp");
    await act(async () => {
      await latest.begin();
    });

    await act(async () => {
      void latest.confirm();
    });
    expect(latest.state.status).toBe("launching");
    await act(async () => {
      void latest.confirm();
    });
    expect(terminalMocks.launchCliInstallInTerminal).toHaveBeenCalledTimes(1);

    await act(async () => {
      opening.resolve({ ok: true, terminalId: "tab-omp" });
    });
    expect(latest.state.status).toBe("terminal");
  });

  it("closing while the terminal opens does not bring the dialog back", async () => {
    const line = 'curl -fsSL https://x/install.sh | bash; echo "__CCGUI_CLI_DONE__$?"';
    mocks.cliUpdatePlan.mockResolvedValue({ ...plan("opencode"), kind: "native", command: [line], terminalCommand: line });
    const opening = Promise.withResolvers<{ ok: false; reason: "terminal-unavailable" }>();
    terminalMocks.launchCliInstallInTerminal.mockReset().mockReturnValue(opening.promise);
    await render("opencode");
    await act(async () => {
      await latest.begin();
    });
    await act(async () => {
      void latest.confirm();
    });
    await act(async () => {
      latest.close();
    });
    expect(latest.state.status).toBe("idle");

    await act(async () => {
      opening.resolve({ ok: false, reason: "terminal-unavailable" });
    });
    expect(latest.state.status).toBe("idle");
  });

  it("explains a missing workspace instead of running anything", async () => {
    const line = "irm https://claude.ai/install.ps1 | iex";
    mocks.cliUpdatePlan.mockResolvedValue({ ...plan("claude"), kind: "native", command: [line], terminalCommand: line });
    terminalMocks.launchCliInstallInTerminal
      .mockReset()
      .mockResolvedValue({ ok: false, reason: "no-workspace" });
    await render("claude");
    await act(async () => {
      await latest.begin();
    });

    await act(async () => {
      await latest.confirm();
    });
    expect(latest.state.status).toBe("error");
    expect(latest.state.notice).toBe("no-workspace");
    expect(mocks.cliUpdate).not.toHaveBeenCalled();
    // The plan stays so the user can retry after opening a project.
    expect(latest.state.plan?.terminalCommand).toBe(line);
  });
});
