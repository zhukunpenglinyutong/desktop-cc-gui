import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MarketPlugin, PluginInfo } from "@/lib/ipc";
import type { PluginInstallProgress } from "@/lib/events";

const pluginFetchIndex = vi.fn(async (_force = false): Promise<MarketPlugin[]> => []);
const pluginCheckUpdates = vi.fn(async () => [] as { id: string }[]);
const pluginInstallFromMarketplace = vi.fn();
vi.mock("@/lib/ipc", () => ({
  ipc: {
    pluginFetchIndex: (force: boolean) => pluginFetchIndex(force),
    pluginCheckUpdates: () => pluginCheckUpdates(),
    pluginInstallFromMarketplace: (id: string) => pluginInstallFromMarketplace(id),
  },
}));

let progressCb: ((p: PluginInstallProgress) => void) | null = null;
const unlisten = vi.fn();
vi.mock("@/lib/events", () => ({
  listenPluginInstallProgress: vi.fn(async (cb: (p: PluginInstallProgress) => void) => {
    progressCb = cb;
    return unlisten;
  }),
}));

const loadPlugin = vi.fn(async (_args: unknown) => {});
vi.mock("../runtime/loader", () => ({
  loadPlugin: (args: unknown) => loadPlugin(args),
}));

const refreshInstalled = vi.fn(async () => {});
vi.mock("../manager/usePlugins", () => ({
  usePluginsStore: { getState: () => ({ refresh: refreshInstalled }) },
}));

// vi.mock calls above are hoisted, so this static import sees the mocks.
import { useMarketplaceStore } from "./store";

function entry(over: Partial<MarketPlugin> = {}): MarketPlugin {
  return {
    id: "react-doctor",
    repo: "zhukunpenglinyutong/ccgui-plugin-react-doctor",
    name: "React Doctor",
    description: "",
    author: "zhukunpenglinyutong",
    tier: "js",
    version: "0.2.0",
    minAppVersion: "1.0.0",
    sdkVersion: "^0.3",
    permissions: ["storage"],
    ...over,
  };
}

function installedInfo(over: Partial<PluginInfo> = {}): PluginInfo {
  return {
    id: "react-doctor",
    name: "React Doctor",
    version: "0.2.0",
    description: "",
    author: "",
    tier: "js",
    source: "marketplace",
    enabled: true,
    quarantined: false,
    lastError: null,
    permissions: ["storage"],
    installedAt: 0,
    minAppVersion: "1.0.0",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  progressCb = null;
  useMarketplaceStore.setState({
    entries: [],
    loaded: false,
    error: null,
    updates: [],
    installing: null,
  });
});

describe("fetchIndex", () => {
  it("stores the listing on success", async () => {
    pluginFetchIndex.mockResolvedValueOnce([entry()]);

    await useMarketplaceStore.getState().fetchIndex();

    expect(useMarketplaceStore.getState().entries).toHaveLength(1);
    expect(useMarketplaceStore.getState().loaded).toBe(true);
    expect(useMarketplaceStore.getState().error).toBeNull();
  });

  it("surfaces the error when the index fetch fails", async () => {
    pluginFetchIndex.mockRejectedValueOnce(new Error("offline"));

    await useMarketplaceStore.getState().fetchIndex();

    expect(useMarketplaceStore.getState().error).toContain("offline");
    expect(useMarketplaceStore.getState().loaded).toBe(true);
  });
});

describe("checkUpdates", () => {
  it("keeps the previous list when the check fails (offline tolerance)", async () => {
    useMarketplaceStore.setState({
      updates: [{ id: "react-doctor", currentVersion: "0.1.0", latestVersion: "0.2.0" }],
    });
    pluginCheckUpdates.mockRejectedValueOnce(new Error("offline"));

    await useMarketplaceStore.getState().checkUpdates();

    expect(useMarketplaceStore.getState().updates).toHaveLength(1);
    expect(useMarketplaceStore.getState().error).toBeNull();
  });
});

describe("install", () => {
  it("activates an enabled plugin and refreshes installed state and updates", async () => {
    pluginInstallFromMarketplace.mockResolvedValue(installedInfo());

    await useMarketplaceStore.getState().install("react-doctor");

    expect(pluginInstallFromMarketplace).toHaveBeenCalledWith("react-doctor");
    expect(loadPlugin).toHaveBeenCalledOnce();
    expect(refreshInstalled).toHaveBeenCalledOnce();
    expect(pluginCheckUpdates).toHaveBeenCalled();
    expect(useMarketplaceStore.getState().installing).toBeNull();
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("does not activate a plugin the user had disabled (update keeps the flag)", async () => {
    pluginInstallFromMarketplace.mockResolvedValue(installedInfo({ enabled: false }));

    await useMarketplaceStore.getState().install("react-doctor");

    expect(loadPlugin).not.toHaveBeenCalled();
  });

  it("tracks progress events against the installing entry", async () => {
    const gate = Promise.withResolvers<PluginInfo>();
    pluginInstallFromMarketplace.mockReturnValue(gate.promise);

    const pending = useMarketplaceStore.getState().install("react-doctor");
    await vi.waitFor(() => expect(progressCb).not.toBeNull());
    progressCb!({ done: 5, total: 10, finished: false });
    expect(useMarketplaceStore.getState().installing).toEqual({ id: "react-doctor", done: 5, total: 10 });

    gate.resolve(installedInfo());
    await pending;
    expect(useMarketplaceStore.getState().installing).toBeNull();
  });

  it("refuses a second concurrent install (single progress channel)", async () => {
    const gate = Promise.withResolvers<PluginInfo>();
    pluginInstallFromMarketplace.mockReturnValue(gate.promise);

    const first = useMarketplaceStore.getState().install("react-doctor");
    await vi.waitFor(() => expect(useMarketplaceStore.getState().installing).not.toBeNull());
    await useMarketplaceStore.getState().install("other-plugin");

    expect(pluginInstallFromMarketplace).toHaveBeenCalledTimes(1);

    gate.resolve(installedInfo());
    await first;
  });

  it("clears installing and surfaces the error on failure (bad hash etc.)", async () => {
    pluginInstallFromMarketplace.mockRejectedValue(new Error("SHA-256 mismatch"));

    await useMarketplaceStore.getState().install("react-doctor");

    expect(useMarketplaceStore.getState().installing).toBeNull();
    expect(useMarketplaceStore.getState().error).toContain("SHA-256 mismatch");
    expect(loadPlugin).not.toHaveBeenCalled();
    expect(unlisten).toHaveBeenCalledOnce();
  });
});
