import { describe, expect, it, vi, type Mock } from "vitest";
import { createPluginContext, injectBundleCss, type PluginContextBackend } from "./context";
import type { PluginContext } from "@ccgui/plugin-sdk";
import {
  addMenuRegistry,
  commandRegistry,
  composerSlotRegistry,
  markdownRegistry,
  pageRegistry,
  panelTabRegistry,
  sessionMenuRegistry,
  settingsRegistry,
  statusBarRegistry,
  composerStatusRegistry,
  conversationModeRegistry,
  timelineRowRegistry,
} from "@ccgui/plugin-sdk";
import { pluginBus } from "./events";
import { setActiveComposerDraft } from "./composer-draft";
import type { PluginManifest } from "@ccgui/plugin-sdk";
// composer.setDraft 的 store 落点由 composer-draft.test.ts 单独覆盖；
// 这里只验证权限门与委派，不拉入 chat store 依赖链。
vi.mock("./composer-draft", () => ({ setActiveComposerDraft: vi.fn() }));

function fakeStorage(): PluginContextBackend & { data: Map<string, unknown>; bridgeInvoke: Mock } {
  const data = new Map<string, unknown>();
  return {
    data,
    bridgeInvoke: vi.fn(async () => null),
    get: async (id, key) => data.get(`${id}:${key}`) ?? null,
    set: async (id, key, value) => void data.set(`${id}:${key}`, value),
    delete: async (id, key) => void data.delete(`${id}:${key}`),
  };
}

function manifest(permissions: string[]): PluginManifest {
  return {
    id: "test-plugin",
    name: "Test",
    version: "1.0.0",
    tier: "js",
    permissions,
  };
}

describe("createPluginContext", () => {
  it("preserves the native interrupt routed boolean for recovery", async () => {
    const backend = fakeStorage();
    const { ctx } = createPluginContext(manifest(["agent"]), backend, { appVersion: "1" });
    backend.bridgeInvoke.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await ctx.agent.interrupt("live")).toBe(true);
    expect(await ctx.agent.interrupt("gone")).toBe(false);
    expect(backend.bridgeInvoke).toHaveBeenLastCalledWith("plugin_agent_interrupt", { pluginId: "test-plugin", runId: "gone" });
  });
  it("forwards a validated optional request token but never a plugin-supplied run id", async () => {
    const backend = fakeStorage();
    const { ctx } = createPluginContext(manifest(["agent"]), backend, { appVersion: "1" });
    const requestId = "a".repeat(32);
    await ctx.agent.start({ engine: "pi", prompt: "inspect", workspacePath: "/w", requestId });
    expect(backend.bridgeInvoke).toHaveBeenCalledWith("plugin_agent_start", expect.objectContaining({ requestId }));
    expect(() => ctx.agent.start({ engine: "pi", prompt: "inspect", workspacePath: "/w", requestId: "arbitrary-run-id" })).toThrow(/requestId/);
    expect(backend.bridgeInvoke).toHaveBeenCalledTimes(1);
  });
  it("gates conversation modes and tracks their scoped registration for unload", () => {
    const denied = createPluginContext(manifest([]), fakeStorage(), { appVersion: "1" });
    const def = { key: "relay", label: () => "Relay", component: () => null };
    expect(() => denied.ctx.ui.registerConversationMode(def)).toThrow(/ui:conversation-mode/);
    const handle = createPluginContext(manifest(["ui:conversation-mode"]), fakeStorage(), { appVersion: "1" });
    handle.ctx.ui.registerConversationMode(def);
    expect(conversationModeRegistry.get("plugin:test-plugin:relay")?.component).toBe(def.component);
    handle.disposers.forEach((dispose) => dispose());
    expect(conversationModeRegistry.getSnapshot()).toEqual([]);
  });

  it("gates and validates the controlled main-window API", async () => {
    const backend = {
      ...fakeStorage(),
      windowGetState: vi.fn(async () => ({
        bounds: { x: 10, y: 20, width: 1000, height: 800 },
        state: "normal" as const,
        scaleFactor: 1.25,
      })),
      windowSetNormalBounds: vi.fn(async (_id: string, bounds: { x: number; y: number; width: number; height: number }) => ({
        bounds,
        state: "normal" as const,
        scaleFactor: 1.25,
      })),
      windowSampleWechat: vi.fn(async () => ({
        bounds: { x: 30, y: 40, width: 1100, height: 850 },
        executable: "Weixin.exe" as const,
      })),
    };
    const denied = createPluginContext(manifest([]), backend, { appVersion: "1", isWeb: false });
    await expect(denied.ctx.window.getState()).rejects.toThrow(/host:window/);
    expect(backend.windowGetState).not.toHaveBeenCalled();

    const { ctx } = createPluginContext(manifest(["host:window"]), backend, {
      appVersion: "1",
      isWeb: false,
    });
    expect((await ctx.window.getState()).state).toBe("normal");
    expect(backend.windowGetState).toHaveBeenCalledWith("test-plugin");
    await expect(ctx.window.setNormalBounds({ x: 0, y: 0, width: 639, height: 480 })).rejects.toThrow(/Invalid window bounds/);
    expect(backend.windowSetNormalBounds).not.toHaveBeenCalled();
    await ctx.window.setNormalBounds({ x: -100, y: 20, width: 800, height: 600 });
    expect(backend.windowSetNormalBounds).toHaveBeenCalledWith("test-plugin", { x: -100, y: 20, width: 800, height: 600 });
    expect((await ctx.window.sampleWechat()).executable).toBe("Weixin.exe");

    const remote = createPluginContext(manifest(["host:window"]), backend, {
      appVersion: "1",
      isWeb: true,
    });
    await expect(remote.ctx.window.getState()).rejects.toThrow(/remote web hosts/);
  });

  it("gates authoritative model discovery and preserves only catalog fields", async () => {
    const modelResult = {
      models: [{ id: "provider/model", name: "Model", provider: "provider", contextWindow: 128000 }],
      authoritative: true,
      remote: false,
    };
    const engineResult = {
      id: "codex",
      available: true,
      enabled: true,
      supportsImages: true,
      supportsComputerUse: false,
      supportsEffort: true,
      supportsToolConstraints: false,
      permissions: ["default"],
    };
    const backend = {
      ...fakeStorage(),
      modelListEngines: vi.fn(async () => [engineResult]),
      modelListEngineModels: vi.fn(async () => modelResult),
      modelCatalog: vi.fn(async () => ({
        engines: [{ engine: engineResult, sources: [{
          id: "codex:cli",
          name: "CLI",
          kind: "cli" as const,
          authoritative: true,
          remote: false,
          models: modelResult.models,
          refreshedAt: 1,
        }] }],
        errors: [{ engine: "dsh", message: "model catalog unavailable" }],
        refreshedAt: 1,
      })),
    };
    const denied = createPluginContext(manifest([]), backend, { appVersion: "1" });
    await expect(denied.ctx.models.listEngines()).rejects.toThrow(/host:models/);
    expect(backend.modelListEngines).not.toHaveBeenCalled();

    const { ctx } = createPluginContext(manifest(["host:models"]), backend, { appVersion: "1" });
    await expect(ctx.models.listEngineModels(" ")).rejects.toThrow(/non-empty/);
    const catalog = await ctx.models.listEngineModels("codex", "/workspace");
    expect(catalog.authoritative).toBe(true);
    expect(catalog.models[0]).toEqual({ id: "provider/model", name: "Model", provider: "provider", contextWindow: 128000 });
    expect(catalog.models[0]).not.toHaveProperty("apiKey");
    expect(backend.modelListEngineModels).toHaveBeenCalledWith("test-plugin", "codex", "/workspace");
    const aggregate = await ctx.models.catalog();
    expect(aggregate.engines[0].sources[0]).toEqual({
      id: "codex:cli",
      name: "CLI",
      kind: "cli",
      authoritative: true,
      remote: false,
      models: modelResult.models,
      refreshedAt: 1,
    });
    expect(aggregate.errors[0].message).toBe("model catalog unavailable");
    expect(backend.modelCatalog).toHaveBeenLastCalledWith("test-plugin", undefined);
    await ctx.models.catalog({ workspace: "/workspace", refreshProviders: true });
    expect(backend.modelCatalog).toHaveBeenLastCalledWith("test-plugin", {
      workspace: "/workspace",
      refreshProviders: true,
    });
    await expect(ctx.models.catalog(null as never)).rejects.toThrow(/object/);
    await expect(ctx.models.catalog([] as never)).rejects.toThrow(/object/);
    await expect(ctx.models.catalog({ workspace: 1 as never })).rejects.toThrow(/string/);
    await expect(
      ctx.models.catalog({ refreshProviders: "yes" as unknown as boolean }),
    ).rejects.toThrow(/boolean/);
  });

  it("gates the private agent catalog seam and forwards readOnly", async () => {
    const backend = { ...fakeStorage(), agentCatalog: vi.fn(async () => []) };
    const denied = createPluginContext(manifest([]), backend, { appVersion: "1" });
    await expect(denied.ctx.agent.catalog("/workspace")).rejects.toThrow(/agent/);
    expect(backend.agentCatalog).not.toHaveBeenCalled();
    const { ctx } = createPluginContext(manifest(["agent"]), backend, { appVersion: "1" });
    expect(await ctx.agent.catalog("/workspace")).toEqual([]);
    expect(backend.agentCatalog).toHaveBeenCalledWith("/workspace");
    await ctx.agent.start({ engine: "codex", prompt: "inspect", workspacePath: "/workspace", readOnly: true });
    expect(backend.bridgeInvoke).toHaveBeenCalledWith("plugin_agent_start", expect.objectContaining({ readOnly: true }));
    backend.agentCatalog.mockRejectedValueOnce(new Error("engine probe failed"));
    await expect(ctx.agent.catalog("/workspace")).rejects.toThrow("engine probe failed");
    await expect(ctx.bridge.invoke("list_engines")).rejects.toThrow(/unknown bridge/);
  });

  it("registers a settings section under plugin:<id> and the disposer removes it", () => {
    const { ctx } = createPluginContext(manifest(["ui:settings-section"]), fakeStorage(), {
      appVersion: "1.0.0",
    });
    const dispose = ctx.ui.registerSettingsSection({
      label: () => "Test",
      component: () => null,
    });
    expect(settingsRegistry.get("plugin:test-plugin")).toBeDefined();
    dispose();
    expect(settingsRegistry.get("plugin:test-plugin")).toBeUndefined();
  });

  it("rejects capability use that the manifest did not declare", () => {
    const { ctx } = createPluginContext(manifest([]), fakeStorage(), { appVersion: "1.0.0" });
    expect(() =>
      ctx.ui.registerAddMenuRow({ label: () => "x", onSelect: () => {} }),
    ).toThrow(/ui:add-menu/);
    expect(() => ctx.theme.injectCss(".a{}")).toThrow(/theme/);
    return expect(ctx.storage.get("k")).rejects.toThrow(/storage/);
  });

  it("storage round-trips through the backend in the plugin's namespace", async () => {
    const backend = fakeStorage();
    const { ctx } = createPluginContext(manifest(["storage"]), backend, { appVersion: "1.0.0" });
    await ctx.storage.set("k", { n: 1 });
    expect(backend.data.get("test-plugin:k")).toEqual({ n: 1 });
    expect(await ctx.storage.get("k")).toEqual({ n: 1 });
    await ctx.storage.delete("k");
    expect(await ctx.storage.get("k")).toBeNull();
  });

  it("theme.injectCss mounts a tagged <style> and its disposer removes it", () => {
    const { ctx } = createPluginContext(manifest(["theme"]), fakeStorage(), {
      appVersion: "1.0.0",
    });
    const dispose = ctx.theme.injectCss(".composer { border-color: red; }");
    const node = document.head.querySelector('style[data-plugin="test-plugin"]');
    expect(node?.textContent).toContain("border-color: red");
    // Theme-API CSS stays unlayered: token overrides must beat the host's
    // unlayered :root/.dark token definitions.
    expect(node?.textContent).not.toContain("@layer");
    dispose();
    expect(document.head.querySelector('style[data-plugin="test-plugin"]')).toBeNull();
  });

  it("theme.setTokens emits :root and .dark blocks and rejects non-token keys", () => {
    const { ctx } = createPluginContext(manifest(["theme"]), fakeStorage(), {
      appVersion: "1.0.0",
    });
    const dispose = ctx.theme.setTokens({
      light: { "--color-text-primary": "red" },
      dark: { "--color-text-primary": "blue" },
    });
    const css = document.head.querySelector('style[data-plugin="test-plugin"]')?.textContent ?? "";
    expect(css).toContain(":root { --color-text-primary: red;");
    expect(css).toContain(".dark { --color-text-primary: blue;");
    expect(() => ctx.theme.setTokens({ light: { color: "red" } })).toThrow(/--/);
    dispose();
  });

  it("injectCss rejects remote references (plan §8 gate rule)", () => {
    const { ctx } = createPluginContext(manifest(["theme"]), fakeStorage(), {
      appVersion: "1.0.0",
    });
    expect(() => ctx.theme.injectCss('@import url("https://evil.com/x.css");')).toThrow(/remote/);
    expect(() => ctx.theme.injectCss(".a { background: url(https://evil.com/x.png); }")).toThrow(
      /remote/,
    );
  });

  it("events.on delivers bus emissions and the disposer unsubscribes", () => {
    const { ctx } = createPluginContext(manifest(["events"]), fakeStorage(), {
      appVersion: "1.0.0",
    });
    const seen: unknown[] = [];
    const dispose = ctx.events.on("t://opic", (d) => seen.push(d));
    pluginBus.emit("t://opic", 1);
    dispose();
    pluginBus.emit("t://opic", 2);
    expect(seen).toEqual([1]);
  });

  it("events.emit is confined to the plugin's own and shared plugin- topics", () => {
    const { ctx } = createPluginContext(manifest(["events"]), fakeStorage(), {
      appVersion: "1.0.0",
    });
    // Own namespace and shared plugin-* topics are fine.
    const seen: unknown[] = [];
    const offOwn = pluginBus.on("plugin:test-plugin:ping", (d) => seen.push(d));
    const offShared = pluginBus.on("plugin-config://changed", (d) => seen.push(d));
    ctx.events.emit("plugin:test-plugin:ping", 1);
    ctx.events.emit("plugin-config://changed", { pluginId: "test-plugin", key: "k", value: 2 });
    expect(seen).toEqual([1, { pluginId: "test-plugin", key: "k", value: 2 }]);
    offOwn();
    offShared();

    // Host topics and other plugins' namespaces throw.
    expect(() => ctx.events.emit("usage://updated", {})).toThrow(/may not emit/);
    expect(() => ctx.events.emit("composer://draft", {})).toThrow(/may not emit/);
    expect(() => ctx.events.emit("plugin:other-plugin:ping", 1)).toThrow(/may not emit/);
  });

  it("accumulates every registration on the handle's disposer stack", () => {
    const handle = createPluginContext(
      manifest(["ui:settings-section", "ui:add-menu", "theme"]),
      fakeStorage(),
      { appVersion: "1.0.0" },
    );
    handle.ctx.ui.registerSettingsSection({ label: () => "s", component: () => null });
    handle.ctx.ui.registerAddMenuRow({ label: () => "m", onSelect: () => {} });
    handle.ctx.theme.injectCss(".x{}");
    expect(handle.disposers).toHaveLength(3);
    for (const d of [...handle.disposers].reverse()) d();
    expect(settingsRegistry.get("plugin:test-plugin")).toBeUndefined();
    expect(addMenuRegistry.get("plugin:test-plugin")).toBeUndefined();
    expect(document.head.querySelector('style[data-plugin="test-plugin"]')).toBeNull();
  });

  it.each([
    [
      "ui:composer-status",
      (ctx: PluginContext) =>
        ctx.ui.registerComposerSlot({ slot: "addMenu", component: () => null }),
      composerSlotRegistry,
    ],
    [
      "ui:panel-tab",
      (ctx: PluginContext) =>
        ctx.ui.registerPanelTab({ label: () => "T", component: () => null }),
      panelTabRegistry,
    ],
    [
      "ui:status-bar",
      (ctx: PluginContext) =>
        ctx.ui.registerStatusBarItem({ component: () => null }),
      statusBarRegistry,
    ],
    [
      "ui:composer-status",
      (ctx: PluginContext) =>
        ctx.ui.registerComposerStatusItem({ component: () => null }),
      composerStatusRegistry,
    ],
    [
      "ui:markdown",
      (ctx: PluginContext) =>
        ctx.ui.registerMarkdownRenderer({}),
      markdownRegistry,
    ],
    [
      "ui:page",
      (ctx: PluginContext) =>
        ctx.ui.registerPage({ title: () => "P", component: () => null }),
      pageRegistry,
    ],
    [
      "ui:timeline-row",
      (ctx: PluginContext) =>
        ctx.ui.registerTimelineRowRenderer({ kind: "custom", component: () => null }),
      timelineRowRegistry,
    ],
    [
      "ui:session-menu",
      (ctx: PluginContext) =>
        ctx.ui.registerSessionMenuItem({ label: () => "S", run: () => {} }),
      sessionMenuRegistry,
    ],
  ])(
    "%s gates and registers under plugin:<id>, disposer removes (phase-2 ui points)",
    (permission, register, registry) => {
      const denied = createPluginContext(manifest([]), fakeStorage(), { appVersion: "1.0.0" });
      expect(() => register(denied.ctx)).toThrow(new RegExp(permission));

      const { ctx } = createPluginContext(manifest([permission]), fakeStorage(), {
        appVersion: "1.0.0",
      });
      const dispose = register(ctx);
      expect(registry.get("plugin:test-plugin")).toBeDefined();
      dispose();
      expect(registry.get("plugin:test-plugin")).toBeUndefined();
    },
  );

  it("registerCommand requires a key, prefixes ids, and wraps run with the plugin guard", () => {
    const denied = createPluginContext(manifest([]), fakeStorage(), { appVersion: "1.0.0" });
    expect(() =>
      denied.ctx.ui.registerCommand({ key: "go", title: () => "Go", run: () => {} }),
    ).toThrow(/ui:command/);

    const { ctx } = createPluginContext(manifest(["ui:command"]), fakeStorage(), {
      appVersion: "1.0.0",
    });
    let ran = 0;
    const dispose = ctx.ui.registerCommand({
      key: "go",
      title: () => "Go",
      run: () => ran++,
    });
    const entry = commandRegistry.get("plugin:test-plugin:go");
    expect(entry?.title()).toBe("Go");
    entry?.run();
    expect(ran).toBe(1);
    dispose();
    expect(commandRegistry.get("plugin:test-plugin:go")).toBeUndefined();
  });

  it("registerSessionMenuItem wraps run with the plugin guard and passes the target", () => {
    const { ctx } = createPluginContext(manifest(["ui:session-menu"]), fakeStorage(), {
      appVersion: "1.0.0",
    });
    let got: unknown = null;
    const dispose = ctx.ui.registerSessionMenuItem({
      key: "re-title",
      label: () => "Re-title",
      run: (target) => {
        got = target;
      },
    });
    const entry = sessionMenuRegistry.get("plugin:test-plugin:re-title");
    expect(entry?.label()).toBe("Re-title");
    entry?.run({ engine: "omp", sessionId: "abc-123" });
    expect(got).toEqual({ engine: "omp", sessionId: "abc-123" });
    dispose();
    expect(sessionMenuRegistry.get("plugin:test-plugin:re-title")).toBeUndefined();
  });
  it("composer.setDraft is gated by composer:draft and delegates with the plugin id", () => {
    const denied = createPluginContext(manifest([]), fakeStorage(), { appVersion: "1.0.0" });
    expect(() => denied.ctx.composer.setDraft("x")).toThrow(/composer:draft/);
    expect(setActiveComposerDraft).not.toHaveBeenCalled();

    const { ctx } = createPluginContext(manifest(["composer:draft"]), fakeStorage(), {
      appVersion: "1.0.0",
    });
    ctx.composer.setDraft("fix these");
    expect(setActiveComposerDraft).toHaveBeenCalledWith("test-plugin", "fix these");
  });

  it("injectBundleCss mounts bundle styles without the theme permission and rejects remote refs", () => {
    const handle = createPluginContext(manifest([]), fakeStorage(), { appVersion: "1.0.0" });
    injectBundleCss(handle, ".bundle { color: red; }");
    const css = document.head.querySelector('style[data-plugin="test-plugin"]')?.textContent ?? "";
    expect(css).toContain("color: red");
    // Bundle CSS is wrapped in the ccgui-plugins layer (declared between
    // base and components in index.css) so it can never outrank host
    // utilities on specificity ties.
    expect(css).toMatch(/^@layer ccgui-plugins \{/);
    expect(handle.disposers).toHaveLength(1);
    handle.disposers[0]();
    expect(document.head.querySelector('style[data-plugin="test-plugin"]')).toBeNull();

    expect(() => injectBundleCss(handle, '@import url("https://evil.com/x.css");')).toThrow(
      /remote/,
    );
  });

  describe("bridge.invoke grant prechecks", () => {
    it("rejects plugin_http_request to a url with no matching network: grant, without IPC", async () => {
      const backend = fakeStorage();
      const { ctx } = createPluginContext(manifest([]), backend, { appVersion: "1.0.0" });
      await expect(
        ctx.bridge.invoke("plugin_http_request", {
          method: "GET",
          url: "http://127.0.0.1:7684/functions/tokentracker-user-status",
        }),
      ).rejects.toThrow(/network:/);
      expect(backend.bridgeInvoke).not.toHaveBeenCalled();
    });

    it("rejects plugin_http_request when the port falls outside the granted range", async () => {
      const backend = fakeStorage();
      const { ctx } = createPluginContext(manifest(["network:127.0.0.1:7680-7690"]), backend, {
        appVersion: "1.0.0",
      });
      await expect(
        ctx.bridge.invoke("plugin_http_request", { method: "GET", url: "http://127.0.0.1:8000/" }),
      ).rejects.toThrow(/network:/);
      expect(backend.bridgeInvoke).not.toHaveBeenCalled();
    });

    it("passes a granted http request through and injects pluginId", async () => {
      const backend = fakeStorage();
      backend.bridgeInvoke.mockResolvedValue({ status: 200, body: "{}" });
      const { ctx } = createPluginContext(manifest(["network:127.0.0.1:7680-7690"]), backend, {
        appVersion: "1.0.0",
      });
      const result = await ctx.bridge.invoke("plugin_http_request", {
        method: "GET",
        url: "http://127.0.0.1:7684/functions/tokentracker-user-status",
      });
      expect(result).toEqual({ status: 200, body: "{}" });
      expect(backend.bridgeInvoke).toHaveBeenCalledWith("plugin_http_request", {
        method: "GET",
        url: "http://127.0.0.1:7684/functions/tokentracker-user-status",
        pluginId: "test-plugin",
      });
    });

    it("rejects plugin_exec_run/spawn without a matching exec: grant, without IPC", async () => {
      const backend = fakeStorage();
      const { ctx } = createPluginContext(manifest(["exec:npm"]), backend, {
        appVersion: "1.0.0",
      });
      await expect(
        ctx.bridge.invoke("plugin_exec_run", { bin: "tokentracker", args: ["--version"] }),
      ).rejects.toThrow(/exec:/);
      await expect(
        ctx.bridge.invoke("plugin_exec_spawn", { bin: "tokentracker", args: ["serve"] }),
      ).rejects.toThrow(/exec:/);
      expect(backend.bridgeInvoke).not.toHaveBeenCalled();
    });

    it("passes a granted exec through and injects pluginId", async () => {
      const backend = fakeStorage();
      backend.bridgeInvoke.mockResolvedValue({ code: 0, stdout: "1.0.0", stderr: "" });
      const { ctx } = createPluginContext(manifest(["exec:tokentracker"]), backend, {
        appVersion: "1.0.0",
      });
      const result = await ctx.bridge.invoke("plugin_exec_run", {
        bin: "tokentracker",
        args: ["--version"],
        timeoutMs: 10000,
      });
      expect(result).toEqual({ code: 0, stdout: "1.0.0", stderr: "" });
      expect(backend.bridgeInvoke).toHaveBeenCalledWith("plugin_exec_run", {
        bin: "tokentracker",
        args: ["--version"],
        timeoutMs: 10000,
        pluginId: "test-plugin",
      });
    });

    it("rejects unknown bridge commands (cmd: mechanism is gone)", async () => {
      const backend = fakeStorage();
      const { ctx } = createPluginContext(
        manifest(["network:example.com", "exec:npm"]),
        backend,
        { appVersion: "1.0.0" },
      );
      await expect(ctx.bridge.invoke("tt_proxy", {})).rejects.toThrow(/unknown bridge command/);
      expect(backend.bridgeInvoke).not.toHaveBeenCalled();
    });
  });
});
