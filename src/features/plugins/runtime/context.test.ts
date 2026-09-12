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
  settingsRegistry,
  statusBarRegistry,
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
      "ui:composer",
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
    // Bundle CSS is wrapped in the ccgui-plugins layer (declared first in
    // index.css) so it can never outrank host utilities on specificity ties.
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
