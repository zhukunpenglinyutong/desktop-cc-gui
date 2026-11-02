import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpConfigEntry, McpProbePlan } from "./types";

const api = vi.hoisted(() => ({ probePlan: vi.fn() }));
vi.mock("./api", () => ({ mcpApi: api }));

type ConfirmModule = typeof import("./probe-confirm");

function entry(overrides: Partial<McpConfigEntry> = {}): McpConfigEntry {
  return {
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
    ...overrides,
  };
}

const PLAN: McpProbePlan = {
  kind: "stdio",
  command: "powershell",
  args: ["-enc", "AAAA"],
  cwd: "/ws",
  envKeys: ["API_KEY"],
  url: null,
  headerKeys: [],
  fingerprint: "fp-1",
};

let confirm: ConfirmModule;
let unsubscribe: (() => void) | null = null;

/** Answer every prompt with `answer`, recording what each one showed. */
function autoAnswer(answer: boolean) {
  const seen: unknown[] = [];
  unsubscribe = confirm.subscribeProbeConfirm(() => {
    const request = confirm.currentProbeConfirm();
    if (!request) return;
    seen.push(request.items);
    queueMicrotask(() => confirm.answerProbeConfirm(answer));
  });
  return seen;
}

beforeEach(async () => {
  vi.resetModules();
  confirm = await import("./probe-confirm");
  api.probePlan.mockReset().mockResolvedValue(PLAN);
});

afterEach(() => {
  unsubscribe?.();
  unsubscribe = null;
});

describe("confirmWorkspaceProbe", () => {
  it("shows the full command before anything runs, then remembers the answer for that config", async () => {
    const seen = autoAnswer(true);
    await expect(confirm.confirmWorkspaceProbe([entry()], "/ws")).resolves.toBe(true);
    expect(api.probePlan).toHaveBeenCalledWith(entry(), "/ws");
    expect(seen).toEqual([[{ entry: entry(), plan: PLAN }]]);

    expect(confirm.confirmedFingerprint(entry(), "/ws")).toBe("fp-1");

    // Same config again: the plan is re-read, but no second prompt.
    await expect(confirm.confirmWorkspaceProbe([entry()], "/ws")).resolves.toBe(true);
    expect(seen).toHaveLength(1);
    expect(api.probePlan).toHaveBeenCalledTimes(2);

    // The file changed behind a stale list (same entry version, new
    // command): it is a new plan, so ask again and bind the new one.
    api.probePlan.mockResolvedValueOnce({ ...PLAN, args: ["-enc", "BBBB"], fingerprint: "fp-2" });
    await confirm.confirmWorkspaceProbe([entry()], "/ws");
    expect(seen).toHaveLength(2);
    expect(confirm.confirmedFingerprint(entry(), "/ws")).toBe("fp-2");
  });

  it("forgets a confirmation the backend rejected as stale", async () => {
    const seen = autoAnswer(true);
    await confirm.confirmWorkspaceProbe([entry()], "/ws");
    confirm.forgetProbeConfirm(entry(), "/ws");
    expect(confirm.confirmedFingerprint(entry(), "/ws")).toBeUndefined();
    await confirm.confirmWorkspaceProbe([entry()], "/ws");
    expect(seen).toHaveLength(2);
  });

  it("returns false on decline and asks again next time", async () => {
    const seen = autoAnswer(false);
    await expect(confirm.confirmWorkspaceProbe([entry()], "/ws")).resolves.toBe(false);
    await expect(confirm.confirmWorkspaceProbe([entry()], "/ws")).resolves.toBe(false);
    expect(seen).toHaveLength(2);
  });

  it("still asks when the plan cannot be read, showing it as unavailable", async () => {
    api.probePlan.mockRejectedValueOnce(new Error("gone"));
    const seen = autoAnswer(false);
    await confirm.confirmWorkspaceProbe([entry()], "/ws");
    expect(seen).toEqual([[{ entry: entry(), plan: null }]]);
  });

  it("serializes concurrent requests instead of dropping one", async () => {
    const seen = autoAnswer(true);
    const [first, second] = await Promise.all([
      confirm.confirmWorkspaceProbe([entry()], "/ws"),
      confirm.confirmWorkspaceProbe([entry({ id: "omp_project:other", name: "other" })], "/ws"),
    ]);
    expect([first, second]).toEqual([true, true]);
    expect(seen).toHaveLength(2);
  });

  it("never treats a plan without a fingerprint as already confirmed", async () => {
    api.probePlan.mockResolvedValue({ ...PLAN, fingerprint: "" });
    const seen = autoAnswer(true);
    await confirm.confirmWorkspaceProbe([entry()], "/ws");
    await confirm.confirmWorkspaceProbe([entry()], "/ws");
    expect(seen).toHaveLength(2);
  });

  it("does not prompt for an empty list", async () => {
    const seen = autoAnswer(true);
    await expect(confirm.confirmWorkspaceProbe([], "/ws")).resolves.toBe(true);
    expect(seen).toEqual([]);
    expect(api.probePlan).not.toHaveBeenCalled();
  });
});
