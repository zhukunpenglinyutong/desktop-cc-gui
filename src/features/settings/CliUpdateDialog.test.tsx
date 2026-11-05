import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import type { CliUpdatePlan } from "@/lib/ipc";
import { CliUpdateDialog } from "./CliUpdateDialog";
import type { CliUpdateFlow, CliUpdateFlowState } from "./useCliUpdateFlow";

void i18n;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LINE = 'curl -fsSL https://claude.ai/install.sh | bash; echo "__CCGUI_CLI_DONE__$?"';

const terminalPlan: CliUpdatePlan = {
  engine: "claude",
  action: "update",
  kind: "native",
  command: [LINE],
  manualCommand: "curl -fsSL https://claude.ai/install.sh | bash",
  terminalCommand: LINE,
  canRun: true,
  blockers: [],
  platform: "macos",
};

let container: HTMLDivElement;
let root: Root | null;

function flow(state: Partial<CliUpdateFlowState>): CliUpdateFlow {
  return {
    state: {
      status: "ready",
      plan: terminalPlan,
      error: null,
      notice: null,
      runId: null,
      logs: [],
      ...state,
    },
    begin: vi.fn(),
    confirm: vi.fn(),
    close: vi.fn(),
  };
}

async function render(value: CliUpdateFlow) {
  root = createRoot(container);
  await act(async () =>
    root!.render(
      <MemoryRouter>
        <CliUpdateDialog engine="claude" flow={value} />
      </MemoryRouter>,
    ),
  );
}

const text = () => document.body.textContent ?? "";

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  container.remove();
});

describe("CliUpdateDialog terminal installs", () => {
  it("previews the exact terminal line and confirms with Run in Terminal", async () => {
    await render(flow({}));
    expect(text()).toContain(i18n.t("settings.cliUpdateTerminalHint"));
    expect(text()).toContain(LINE);
    expect(text()).toContain(i18n.t("settings.cliUpdateRunInTerminal"));
  });

  it("once started, says so and offers the way to the terminal", async () => {
    await render(flow({ status: "terminal" }));
    expect(text()).toContain(i18n.t("settings.cliUpdateInTerminal"));
    expect(text()).toContain(i18n.t("settings.cliUpdateGoToTerminal"));
    // Output lives in the terminal tab: no in-app log box.
    expect(container.ownerDocument.querySelector("pre.max-h-56")).toBeNull();
    expect(text()).not.toContain(i18n.t("settings.cliUpdateWaitingOutput"));
  });

  it("renders the no-workspace notice from i18n", async () => {
    await render(flow({ status: "error", notice: "no-workspace" }));
    expect(text()).toContain(i18n.t("settings.cliUpdateNoWorkspace"));
  });
});
