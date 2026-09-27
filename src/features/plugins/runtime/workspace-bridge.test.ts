import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { addPluginWorkspace } from "./workspace-bridge";
import { installHardening, runAsPlugin } from "./hardening";

const refreshWorkspaces = vi.fn(async () => {});
vi.mock("@/features/chat/store", () => ({
  useChatStore: { getState: () => ({ refreshWorkspaces }) },
}));
vi.mock("@/lib/ipc", () => ({
  ipc: {
    pluginAddWorkspace: (pluginId: string, path: string, meta?: Record<string, unknown>) =>
      tauriInvoke("plugin_add_workspace", { pluginId, path, meta }),
  },
}));

describe("workspace SDK IPC authorization", () => {
  const originalInternals = window.__TAURI_INTERNALS__;
  const nativeInvoke = vi.fn(async (_cmd: string, args?: unknown) => JSON.stringify(args));

  beforeAll(() => {
    window.__TAURI_INTERNALS__ = { invoke: nativeInvoke };
    installHardening();
  });
  beforeEach(() => {
    nativeInvoke.mockClear();
    refreshWorkspaces.mockClear();
  });
  afterAll(() => {
    if (originalInternals) window.__TAURI_INTERNALS__ = originalInternals;
    else delete window.__TAURI_INTERNALS__;
  });

  it("authorizes workspace registration but not permission proxies or serialization callbacks", async () => {
    const nested: Promise<unknown>[] = [];
    const meta = new Proxy({
      wsl: { hostId: "remote", distro: "Ubuntu" },
      toJSON() {
        nested.push(tauriInvoke("from_toJSON"));
        return { wsl: this.wsl };
      },
    }, {
      has(target, key) {
        nested.push(tauriInvoke("from_proxy"));
        return Reflect.has(target, key);
      },
    });
    const permitted = vi.fn();
    await runAsPlugin(() => addPluginWorkspace("test-plugin", " C:/work ", meta, permitted));

    for (const request of nested) await expect(request).rejects.toThrow(/blocked/);
    expect(nativeInvoke.mock.calls.map(([cmd]) => cmd)).toEqual(["plugin_add_workspace"]);
    expect(JSON.parse(await nativeInvoke.mock.results[0].value)).toEqual({
      pluginId: "test-plugin",
      path: "C:/work",
      meta: { wsl: { hostId: "remote", distro: "Ubuntu" } },
    });
    expect(permitted).toHaveBeenCalledOnce();
    expect(refreshWorkspaces).toHaveBeenCalledOnce();
  });

  it("rejects remote workspace registration before authorizing any IPC", async () => {
    const result = runAsPlugin(() => addPluginWorkspace(
      "test-plugin", "C:/work", { wsl: { hostId: "remote" } }, () => {
        throw new Error("host:workspace:remote denied");
      },
    ));
    await expect(result).rejects.toThrow(/host:workspace:remote/);
    expect(nativeInvoke).not.toHaveBeenCalled();
    expect(refreshWorkspaces).not.toHaveBeenCalled();
  });
});
