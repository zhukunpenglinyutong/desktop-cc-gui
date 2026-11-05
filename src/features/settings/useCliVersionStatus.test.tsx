import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cliVersionStatus: vi.fn(),
  cliUpdate: vi.fn(),
}));
const terminal = vi.hoisted(() => ({
  backlog: new Map<string, string>(),
  open: new Set<string>(),
}));
vi.mock("@/lib/ipc", () => ({ ipc: mocks }));
vi.mock("@/features/terminal/sessions", () => ({
  terminalBacklog: (id: string) => terminal.backlog.get(id) ?? "",
  hasTerminalSession: (id: string) => terminal.open.has(id),
}));

import type { CliVersionStatus } from "@/lib/ipc";
import type { EngineId } from "./providers";
import { useCliVersionStatus, type CliVersionStatusView } from "./useCliVersionStatus";

// React 18's act() requires this flag to be set by the test environment.
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function versionStatus(engine: EngineId, over: Partial<CliVersionStatus> = {}): CliVersionStatus {
  return {
    engine,
    installed: true,
    localVersion: "2.1.228 (Claude Code)",
    latestVersion: "2.1.267",
    updateAvailable: true,
    updateKind: "native",
    ...over,
  };
}

/** Renders the hook and captures its latest value. */
function Probe({ engine, capture }: { engine: EngineId; capture: (v: CliVersionStatusView) => void }) {
  const value = useCliVersionStatus(engine);
  useEffect(() => {
    capture(value);
  });
  return null;
}

// The store is module-level session state keyed by engine: each test uses
// its own engine so it starts cold without resetting the module.
describe("useCliVersionStatus session store", () => {
  let container: HTMLDivElement;
  let root: Root | null;
  let latest: CliVersionStatusView;
  const capture = (v: CliVersionStatusView) => {
    latest = v;
  };

  beforeEach(() => {
    mocks.cliVersionStatus.mockReset();
    mocks.cliUpdate.mockReset();
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
    const nextRoot = createRoot(container);
    root = nextRoot;
    await act(async () => {
      nextRoot.render(<Probe engine={engine} capture={capture} />);
    });
  }

  it("dedupes concurrent consumers into one probe", async () => {
    // Never settles: any second probe would also be observable here.
    mocks.cliVersionStatus.mockReturnValue(Promise.withResolvers<CliVersionStatus>().promise);
    const twoConsumers = createRoot(container);
    root = twoConsumers;
    await act(async () => {
      twoConsumers.render(
        <>
          <Probe engine="codex" capture={capture} />
          <Probe engine="codex" capture={capture} />
        </>,
      );
    });
    expect(mocks.cliVersionStatus).toHaveBeenCalledTimes(1);
    expect(mocks.cliVersionStatus).toHaveBeenCalledWith("codex");
    expect(latest.loading).toBe(true);
  });

  it("repaints the cached status instantly on remount, soft-refreshing behind it", async () => {
    mocks.cliVersionStatus.mockResolvedValue(versionStatus("claude"));
    await render("claude");
    expect(latest.status?.localVersion).toBe("2.1.228 (Claude Code)");
    const firstRoot = root!;
    await act(async () => firstRoot.unmount());
    root = null;

    // Second mount: the soft refresh is held pending…
    const secondProbe = Promise.withResolvers<CliVersionStatus>();
    mocks.cliVersionStatus.mockReturnValue(secondProbe.promise);
    await render("claude");
    // …but the cached status paints synchronously.
    expect(latest.status?.localVersion).toBe("2.1.228 (Claude Code)");
    expect(latest.loading).toBe(true);

    await act(async () => {
      secondProbe.resolve(
        versionStatus("claude", { localVersion: "2.1.229 (Claude Code)", updateAvailable: false }),
      );
    });
    expect(latest.status?.localVersion).toBe("2.1.229 (Claude Code)");
    expect(latest.loading).toBe(false);
  });

  it("update runs the installer then re-probes", async () => {
    mocks.cliVersionStatus.mockResolvedValue(versionStatus("kimi"));
    mocks.cliUpdate.mockResolvedValue({ ok: true, version: "2.1.267 (Claude Code)" });
    await render("kimi");
    const probesBefore = mocks.cliVersionStatus.mock.calls.length;

    await act(async () => {
      await latest.update("run-1");
    });
    expect(mocks.cliUpdate).toHaveBeenCalledWith("kimi", "run-1");
    expect(mocks.cliVersionStatus.mock.calls.length).toBe(probesBefore + 1);
    expect(latest.updating).toBe(false);
    expect(latest.error).toBeNull();
  });

  it("update failure surfaces the error and rejects", async () => {
    mocks.cliVersionStatus.mockResolvedValue(versionStatus("pi"));
    mocks.cliUpdate.mockRejectedValue(new Error("npm boom"));
    await render("pi");
    const probesBefore = mocks.cliVersionStatus.mock.calls.length;

    await act(async () => {
      await expect(latest.update("run-2")).rejects.toThrow("npm boom");
    });
    expect(latest.error).toBe("npm boom");
    expect(latest.updating).toBe(false);
    // No re-probe after a failed install.
    expect(mocks.cliVersionStatus.mock.calls.length).toBe(probesBefore);
  });

  it("a terminal install stays updating until its marker, then re-probes", async () => {
    vi.useFakeTimers();
    try {
      mocks.cliVersionStatus.mockResolvedValue(versionStatus("opencode", { localVersion: "0.1.0" }));
      await render("opencode");
      terminal.open.add("tab-ok");
      terminal.backlog.set("tab-ok", '$ curl … | bash; echo "__CCGUI_CLI_DONE__$?"\r\n');
      const probesBefore = mocks.cliVersionStatus.mock.calls.length;

      await act(async () => latest.watchTerminal("tab-ok"));
      expect(latest.updating).toBe(true);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      // The echoed command is not a completion.
      expect(latest.updating).toBe(true);
      expect(mocks.cliVersionStatus.mock.calls.length).toBe(probesBefore);

      terminal.backlog.set("tab-ok", "…installed\r\n__CCGUI_CLI_DONE__0\r\n$ ");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1100);
      });
      expect(latest.updating).toBe(false);
      expect(latest.error).toBeNull();
      expect(mocks.cliVersionStatus.mock.calls.length).toBe(probesBefore + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a failed or abandoned terminal install still converges", async () => {
    vi.useFakeTimers();
    try {
      mocks.cliVersionStatus.mockResolvedValue(versionStatus("claude"));
      await render("claude");
      terminal.open.add("tab-fail");
      await act(async () => latest.watchTerminal("tab-fail"));
      terminal.backlog.set("tab-fail", "boom\r\n__CCGUI_CLI_DONE__1\r\n");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1100);
      });
      expect(latest.updating).toBe(false);
      expect(latest.error).not.toBeNull();

      // Closing the tab (Ctrl+C then close, or a lost PTY) also ends the watch.
      terminal.open.add("tab-closed");
      await act(async () => latest.watchTerminal("tab-closed"));
      expect(latest.updating).toBe(true);
      terminal.open.delete("tab-closed");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1100);
      });
      expect(latest.updating).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
