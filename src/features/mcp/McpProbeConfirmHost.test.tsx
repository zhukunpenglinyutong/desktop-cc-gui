import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import type { McpConfigEntry, McpProbePlan } from "./types";

const api = vi.hoisted(() => ({ probePlan: vi.fn() }));
vi.mock("./api", () => ({ mcpApi: api }));

import { McpProbeConfirmHost } from "./McpProbeConfirmHost";
import { confirmWorkspaceProbe, forgetProbeConfirm } from "./probe-confirm";

void i18n;
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ENTRY: McpConfigEntry = {
  id: "claude_project:evil",
  engine: "claude",
  name: "evil",
  source: "claude_project",
  scope: "project",
  workspaceFile: true,
  path: "/ws/.mcp.json",
  format: "json",
  enabled: true,
  transport: "stdio",
  command: "powershell",
  argsCount: 2,
  url: null,
  envKeys: ["API_KEY"],
  headerKeys: [],
  writable: true,
  readonlyReason: null,
  version: "v1",
};

const PLAN: McpProbePlan = {
  kind: "stdio",
  command: "powershell",
  args: ["-enc", "AAAA BBBB"],
  cwd: "/ws/tools",
  envKeys: ["API_KEY"],
  url: null,
  headerKeys: [],
  fingerprint: "fp-1",
};

let container: HTMLDivElement;
let root: Root | null;

beforeEach(async () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  api.probePlan.mockReset().mockResolvedValue(PLAN);
  root = createRoot(container);
  await act(async () => root!.render(<McpProbeConfirmHost />));
});

afterEach(async () => {
  // Confirmations live for the run: start each case unconfirmed.
  forgetProbeConfirm(ENTRY, "/ws");
  if (root) await act(async () => root!.unmount());
  root = null;
  container.remove();
});

function button(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll("button")].find((b) => b.textContent === label);
}

describe("McpProbeConfirmHost", () => {
  it("shows the exact command before running a workspace server, without focusing Run", async () => {
    const answer = confirmWorkspaceProbe([ENTRY], "/ws");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const text = document.body.textContent ?? "";
    expect(text).toContain('powershell -enc "AAAA BBBB"');
    expect(text).toContain("/ws/tools");
    expect(text).toContain("API_KEY");
    expect(text).toContain("/ws/.mcp.json");
    const run = button(i18n.t("mcp.probe.confirmRun"));
    expect(run).toBeTruthy();
    expect(document.activeElement).not.toBe(run);

    await act(async () => run!.click());
    await expect(answer).resolves.toBe(true);
    expect(document.body.textContent).not.toContain("/ws/tools");
  });

  it("cancelling runs nothing", async () => {
    const answer = confirmWorkspaceProbe([{ ...ENTRY, version: "v9" }], "/ws");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => button(i18n.t("common.cancel"))!.click());
    await expect(answer).resolves.toBe(false);
  });
});
