import { describe, expect, it, vi } from "vitest";
import type { CliConfig, EngineInfo } from "@/lib/ipc";
import { buildAgentCatalog } from "./agent-catalog";

const engine = (id: string, extra: Partial<EngineInfo> = {}): EngineInfo => ({
  id, available: true, enabled: true, supportsImages: false, permissions: [], supportsToolConstraints: true, ...extra,
});
const config = { codex: { current: "custom", providers: { custom: { name: "Display", apiKey: "SECRET", env: { TOKEN: "SECRET" } } } } } as unknown as CliConfig;
const backend = () => ({
  listEngines: vi.fn(async () => [engine("codex"), engine("pi", { available: false }), engine("claude", { enabled: false })]),
  getCliConfig: vi.fn(async () => config),
  listEngineModels: vi.fn(async () => ({ models: [{ id: "model", name: "Model", provider: "hidden", description: "SECRET" }], authoritative: true })),
  cliVersionStatus: vi.fn(async () => ({ engine: "codex", installed: true, localVersion: "codex-cli 0.154.0" as string | null, latestVersion: "99.0.0", updateAvailable: true, updateKind: "npm" as const })),
  cliUpdatePlan: vi.fn(async () => ({ engine: "codex", action: "update" as const, kind: "npm", command: ["SECRET"], manualCommand: "SECRET", terminalCommand: null, canRun: true, blockers: [], platform: "linux" })),
});

describe("agent catalog", () => {
  it("offers audited macOS Codex using native local version/platform, with isolation still checked at start", async () => {
    const source = backend();
    source.cliUpdatePlan.mockResolvedValue({ ...await source.cliUpdatePlan(), platform: "macos" });
    source.cliUpdatePlan.mockClear();
    source.listEngines.mockResolvedValue([
      engine("codex", { supportsToolConstraints: false }), engine("pi"), engine("omp"), engine("claude"),
    ]);
    const result = await buildAgentCatalog(source, "/workspace", (key) => key);
    expect(result.map(({ engine: id, readOnly }) => [id, readOnly])).toEqual([
      ["codex", true], ["pi", true], ["omp", false], ["claude", false],
    ]);
    expect(source.cliVersionStatus).toHaveBeenCalledExactlyOnceWith("codex");
    expect(source.cliUpdatePlan).toHaveBeenCalledExactlyOnceWith("codex");
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });

  it.each(["linux", "windows", "unknown"])("does not offer Codex on native platform %s", async (platform) => {
    const source = backend();
    source.cliUpdatePlan.mockResolvedValue({ ...await source.cliUpdatePlan(), platform });
    const result = await buildAgentCatalog(source, "/workspace", (key) => key);
    expect(result.find((entry) => entry.engine === "codex")?.readOnly).toBe(false);
  });

  it.each([null, "codex-cli 0.153.0", "codex-cli 0.155.0", "codex-cli 0.154.0-dev", "unknown"])("fails closed for unaudited local version %s", async (localVersion) => {
    const source = backend();
    source.cliUpdatePlan.mockResolvedValue({ ...await source.cliUpdatePlan(), platform: "macos" });
    source.cliVersionStatus.mockResolvedValue({ ...await source.cliVersionStatus(), localVersion, latestVersion: "0.154.0" });
    expect((await buildAgentCatalog(source, "/workspace", (key) => key))[0].readOnly).toBe(false);
  });

  it.each(["ssh://remote/workspace", "relative/workspace", ""])("does not offer local Codex planning for path %s", async (workspace) => {
    const source = backend();
    source.cliUpdatePlan.mockResolvedValue({ ...await source.cliUpdatePlan(), platform: "macos" });
    expect((await buildAgentCatalog(source, workspace, (key) => key))[0].readOnly).toBe(false);
  });

  it("keeps availability separate from Codex eligibility and still filters disabled engines", async () => {
    const source = backend();
    source.listEngines.mockResolvedValue([engine("codex", { available: false })]);
    expect(await buildAgentCatalog(source, "/workspace", (key) => key)).toMatchObject([
      { engine: "codex", readOnly: false, available: false, models: [] },
    ]);
    expect(source.listEngineModels).not.toHaveBeenCalled();
    expect(source.cliVersionStatus).not.toHaveBeenCalled();
    expect(source.cliUpdatePlan).not.toHaveBeenCalled();
    source.listEngines.mockResolvedValue([engine("codex", { enabled: false })]);
    expect(await buildAgentCatalog(source, "/workspace", (key) => key)).toEqual([]);
  });

  it("preserves native capability probe failures instead of claiming readiness", async () => {
    const source = backend();
    source.cliVersionStatus.mockRejectedValueOnce(new Error("version probe failed"));
    await expect(buildAgentCatalog(source, "/workspace", (key) => key)).rejects.toThrow("version probe failed");
    source.cliUpdatePlan.mockRejectedValueOnce(new Error("platform probe failed"));
    await expect(buildAgentCatalog(source, "/workspace", (key) => key)).rejects.toThrow("platform probe failed");
  });

  it("filters disabled engines and exposes only identifiers and display names", async () => {
    const source = backend();
    const result = await buildAgentCatalog(source, "/workspace", (key) => key);
    expect(result.map((entry) => entry.engine)).toEqual(["codex", "pi"]);
    // provider 随模型一并给出（选择器要按渠道分组）；description 等其余
    // 字段不进插件目录（下面的 SECRET 断言守住这条边界）。
    expect(result[0]).toEqual({ engine: "codex", label: "settings.engines.codex", available: true, readOnly: false,
      providers: [{ id: "__local_settings_json__", label: "settings.cliOfficial" }, { id: "custom", label: "Display" }],
      models: [{ id: "model", label: "Model", provider: "hidden" }],
      efforts: ["low", "medium", "high", "xhigh", "max", "ultra"] });
    expect(result[1]).toMatchObject({ available: false, readOnly: true, models: [] });
    expect(JSON.stringify(result)).not.toContain("SECRET");
    expect(source.listEngineModels).toHaveBeenCalledExactlyOnceWith("codex", "/workspace");
  });
  it("preserves missing model catalogs without claiming unavailable engines are ready", async () => {
    const source = backend();
    source.listEngineModels.mockRejectedValue(new Error("no model catalog"));
    expect((await buildAgentCatalog(source, "/w", (key) => key))[0].models).toEqual([]);
  });
  it("propagates engine/config failures and does not invent read-only support", async () => {
    const source = backend();
    source.listEngines.mockRejectedValueOnce(new Error("engine failure"));
    await expect(buildAgentCatalog(source, "/w", (key) => key)).rejects.toThrow("engine failure");
    source.getCliConfig.mockRejectedValueOnce(new Error("config failure"));
    await expect(buildAgentCatalog(source, "/w", (key) => key)).rejects.toThrow("config failure");
    source.listEngines.mockResolvedValue([engine("claude"), engine("codex", { supportsToolConstraints: false })]);
    expect((await buildAgentCatalog(source, "/w", (key) => key)).every((entry) => !entry.readOnly)).toBe(true);
  });
});
