import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import {
  createPluginContext,
  DocumentStorageConflictError,
  injectBundleCss,
  type PluginContextBackend,
} from "./context";
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
  overlayRegistry,
  conversationModeRegistry,
  timelineRowRegistry,
  workspaceMenuRegistry,
} from "@ccgui/plugin-sdk";
import { pluginBus } from "./events";
import { setActiveComposerDraft } from "./composer-draft";
import type { PluginManifest } from "@ccgui/plugin-sdk";
import { dispatchSessionCreated, dispatchRuntimeEvent } from "./hooks";
import { installHardening, runAsPlugin } from "./hardening";
// composer.setDraft 的 store 落点由 composer-draft.test.ts 单独覆盖；
// 这里只验证权限门与委派，不拉入 chat store 依赖链。
vi.mock("./composer-draft", () => ({ setActiveComposerDraft: vi.fn() }));

function fakeStorage(): PluginContextBackend & {
  data: Map<string, unknown>;
  bridgeInvoke: Mock;
  workspaceMetadata: Mock;
  workspaceList: Mock;
  pickDirectory: Mock;
  documentStorageGetLocation: Mock;
  documentStorageSelectLocation: Mock;
  documentStorageReadText: Mock;
  documentStorageWriteTextAtomic: Mock;
  documentStorageRemove: Mock;
  documentStorageList: Mock;
} {
  const data = new Map<string, unknown>();
  return {
    data,
    bridgeInvoke: vi.fn(async () => null),
    get: async (id, key) => data.get(`${id}:${key}`) ?? null,
    set: async (id, key, value) => void data.set(`${id}:${key}`, value),
    delete: async (id, key) => void data.delete(`${id}:${key}`),
    workspaceMetadata: vi.fn(async () => ({ id: "workspace-id", path: "C:/work" })),
    workspaceList: vi.fn(async () => [
      { id: "workspace-id", name: "Work", path: "C:/work" },
      { id: "other-id", name: "Other", path: "D:/other" },
    ]),
    pickDirectory: vi.fn(async () => "C:/chosen"),
    documentStorageGetLocation: vi.fn(async () => ({
      kind: "data" as const,
      displayPath: "C:/data/plugin-data/test-plugin",
      writable: true,
    })),
    documentStorageSelectLocation: vi.fn(async (_id, kind, customPath) => ({
      kind,
      displayPath: `${customPath ?? "C:/data"}/plugin-data/test-plugin`,
      writable: true,
    })),
    documentStorageReadText: vi.fn(async () => ({ content: "saved", version: "v1" })),
    documentStorageWriteTextAtomic: vi.fn(async () => ({
      status: "written" as const,
      version: "v2",
    })),
    documentStorageRemove: vi.fn(async () => ({ status: "removed" as const })),
    documentStorageList: vi.fn(async () => ["one.txt"]),
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
  it("mounts overlays only with ui:overlay and removes them on dispose", () => {
    const denied = createPluginContext(manifest([]), fakeStorage(), { appVersion: "1.0.0" });
    expect(() => denied.ctx.ui.registerOverlay({ component: () => null })).toThrow(/ui:overlay/);
    const { ctx } = createPluginContext(manifest(["ui:overlay"]), fakeStorage(), {
      appVersion: "1.0.0",
    });
    const dispose = ctx.ui.registerOverlay({ key: "pet", component: () => null, order: 5 });
    expect(overlayRegistry.get("plugin:test-plugin:pet")?.order).toBe(5);
    dispose();
    expect(overlayRegistry.get("plugin:test-plugin:pet")).toBeUndefined();
  });

  it("denies resource and reveal access without their source permissions", async () => {
    const { ctx } = createPluginContext(manifest([]), fakeStorage(), { appVersion: "1.0.0" });
    expect(() => ctx.assets.bundleUrl("assets/icon.png")).toThrow(/assets:bundle/);
    expect(() => ctx.assets.documentUrl("settings.jsonc")).toThrow(/plugin\.storage/);
    expect(() => ctx.assets.directoryUrl("grant-one", "model.json")).toThrow(/assets:directory/);
    await expect(ctx.assets.grantDirectory()).rejects.toThrow(/assets:directory/);
    await expect(ctx.assets.listDirectories()).rejects.toThrow(/assets:directory/);
    await expect(ctx.assets.revokeDirectory("grant-one")).rejects.toThrow(/assets:directory/);
    await expect(ctx.shell.revealPath("C:/private/file.txt")).rejects.toThrow(
      /plugin\.storage|assets:directory/,
    );
  });

  it("does not grant directory access when the picker is cancelled", async () => {
    const backend = fakeStorage();
    const { ctx } = createPluginContext(manifest(["assets:directory"]), backend, {
      appVersion: "1.0.0",
    });
    backend.pickDirectory.mockResolvedValueOnce(null);
    await expect(ctx.assets.grantDirectory()).rejects.toThrow(/cancel/i);
    expect(backend.bridgeInvoke).not.toHaveBeenCalled();
  });

  it("requires read permission for turn-start observers without granting prompt writes", () => {
    const denied = createPluginContext(manifest([]), fakeStorage(), { appVersion: "1.0.0" });
    expect(() => denied.ctx.hooks.registerTurnHooks({ onTurnStarted: () => {} })).toThrow(
      /runtime\.events\.read/,
    );
    const observer = createPluginContext(manifest(["runtime.events.read"]), fakeStorage(), {
      appVersion: "1.0.0",
    });
    const dispose = observer.ctx.hooks.registerTurnHooks({ onTurnStarted: () => {} });
    try {
      expect(() => observer.ctx.hooks.registerTurnHooks({ beforeTurn: () => undefined })).toThrow(
        /prompt\.contribute\.internal/,
      );
    } finally {
      dispose();
    }
  });

  it("keeps remote resource URLs behind exact host and port grants", () => {
    const { ctx } = createPluginContext(
      manifest(["network:assets.example:8443"]),
      fakeStorage(),
      { appVersion: "1.0.0" },
    );
    expect(() => ctx.assets.remoteUrl("https://assets.example/model.json")).toThrow(/network/);
    expect(() => ctx.assets.remoteUrl("https://child.assets.example:8443/model.json")).toThrow(
      /network/,
    );
    expect(() => ctx.assets.remoteUrl("file:///C:/private/model.json")).toThrow(/http/i);
    expect(() =>
      ctx.assets.remoteUrl("https://user:secret@assets.example:8443/model.json"),
    ).toThrow(/credential|user|password/i);
    const proxied = new URL(
      ctx.assets.remoteUrl("https://assets.example:8443/models/a/model.json?revision=2"),
      window.location.origin,
    );
    expect(proxied.hostname).not.toBe("assets.example");
    expect(proxied.pathname).toContain("/test-plugin/remote/");
    expect(new URL("textures/texture.png", proxied).pathname).toBe(
      proxied.pathname.replace("model.json", "textures/texture.png"),
    );
    expect(proxied.search).toBe("?revision=2");
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

  it("opens only the plugin's own settings pages when permission is granted", () => {
    const originalHash = window.location.hash;
    try {
      window.location.hash = "#/settings?page=general";
      const denied = createPluginContext(manifest([]), fakeStorage(), { appVersion: "1.0.0" });
      expect(() => denied.ctx.ui.openSettings()).toThrow(/ui:settings-section/);
      expect(window.location.hash).toBe("#/settings?page=general");

      const { ctx } = createPluginContext(manifest(["ui:settings-section"]), fakeStorage(), {
        appVersion: "1.0.0",
      });
      ctx.ui.openSettings();
      expect(window.location.hash).toBe("#/settings?page=plugin:test-plugin");
      ctx.ui.openSettings("advanced");
      expect(window.location.hash).toBe("#/settings?page=plugin:test-plugin:advanced");
    } finally {
      window.location.hash = originalHash;
    }
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

  it("gates hook groups precisely, tracks registrations, and disposal stops delivery", async () => {
    const denied = createPluginContext(manifest([]), fakeStorage(), { appVersion: "1.0.0" });
    expect(() => denied.ctx.hooks.registerSessionHooks({})).toThrow(/session\.lifecycle\.read/);
    expect(() => denied.ctx.hooks.registerTurnHooks({ onRuntimeEvent: () => {} })).toThrow(
      /runtime\.events\.read/,
    );
    expect(() =>
      createPluginContext(manifest(["runtime.events.read"]), fakeStorage(), {
        appVersion: "1.0.0",
      }).ctx.hooks.registerTurnHooks({ beforeTurn: () => undefined }),
    ).toThrow(/prompt\.contribute\.internal/);
    expect(() => denied.ctx.hooks.registerRuntimeSwitchHooks({})).toThrow(
      /runtime\.switch\.observe/,
    );

    const sessionSeen = vi.fn();
    const runtimeSeen = vi.fn();
    const handle = createPluginContext(
      manifest(["session.lifecycle.read", "runtime.events.read"]),
      fakeStorage(),
      { appVersion: "1.0.0" },
    );
    const stopSession = handle.ctx.hooks.registerSessionHooks({ onCreated: sessionSeen });
    const stopTurn = handle.ctx.hooks.registerTurnHooks({ onRuntimeEvent: runtimeSeen });
    expect(handle.disposers).toEqual([stopSession, stopTurn]);

    const base = {
      engine: "claude",
      sessionId: null,
      workspace: { id: "workspace-id", path: "C:/work" },
      occurredAt: "2026-09-13T00:00:00.000Z",
    } as const;
    dispatchSessionCreated(base);
    dispatchRuntimeEvent({
      eventId: "event-1",
      runId: "run-1",
      turnId: "turn-1",
      engine: base.engine,
      sessionId: base.sessionId,
      workspaceId: base.workspace.id,
      workspacePath: base.workspace.path,
      occurredAt: "2026-09-13T00:00:00.000Z",
      kind: "assistant-completed",
    });
    await Promise.resolve();
    expect(sessionSeen).toHaveBeenCalledTimes(1);
    expect(runtimeSeen).toHaveBeenCalledTimes(1);

    stopSession();
    stopTurn();
    dispatchSessionCreated(base);
    dispatchRuntimeEvent({
      eventId: "event-2",
      runId: "run-2",
      turnId: "turn-2",
      engine: base.engine,
      sessionId: base.sessionId,
      workspaceId: base.workspace.id,
      workspacePath: base.workspace.path,
      occurredAt: "2026-09-13T00:00:01.000Z",
      kind: "assistant-completed",
    });
    await Promise.resolve();
    expect(sessionSeen).toHaveBeenCalledTimes(1);
    expect(runtimeSeen).toHaveBeenCalledTimes(1);
  });

  it("routes workspace metadata and document storage through the plugin namespace", async () => {
    const backend = fakeStorage();
    const { ctx } = createPluginContext(
      manifest(["workspace.metadata.read", "plugin.storage"]),
      backend,
      { appVersion: "1.0.0" },
    );

    await expect(ctx.workspace.getMetadata()).resolves.toEqual({
      id: "workspace-id",
      path: "C:/work",
    });
    expect(backend.workspaceMetadata).toHaveBeenCalledWith("test-plugin");
    await expect(ctx.workspaces.list()).resolves.toEqual([
      { id: "workspace-id", name: "Work", path: "C:/work" },
      { id: "other-id", name: "Other", path: "D:/other" },
    ]);
    expect(backend.workspaceList).toHaveBeenCalledWith("test-plugin");

    await expect(ctx.documentStorage.getLocation()).resolves.toEqual({
      kind: "data",
      path: "C:/data/plugin-data/test-plugin",
    });
    await expect(ctx.documentStorage.readText("state.json")).resolves.toEqual({
      content: "saved",
      version: "v1",
    });
    await expect(ctx.documentStorage.writeTextAtomic("state.json", "next", "v1")).resolves.toEqual({
      version: "v2",
    });
    await ctx.documentStorage.remove("state.json");
    await expect(ctx.documentStorage.list("state")).resolves.toEqual(["one.txt"]);

    expect(backend.documentStorageGetLocation).toHaveBeenCalledWith("test-plugin");
    expect(backend.documentStorageReadText).toHaveBeenCalledWith("test-plugin", "state.json");
    expect(backend.documentStorageWriteTextAtomic).toHaveBeenCalledWith(
      "test-plugin",
      "state.json",
      "next",
      "v1",
    );
    expect(backend.documentStorageRemove).toHaveBeenCalledWith("test-plugin", "state.json", null);
    expect(backend.documentStorageList).toHaveBeenCalledWith("test-plugin", "state");
  });

  it("reports a stale document deletion as a typed storage conflict", async () => {
    const backend = fakeStorage();
    const { ctx } = createPluginContext(manifest(["plugin.storage"]), backend, {
      appVersion: "1.0.0",
    });

    backend.documentStorageRemove.mockResolvedValueOnce({
      status: "conflict",
      currentVersion: "v3",
    });
    await expect(ctx.documentStorage.remove("state.json", "v2")).rejects.toMatchObject({
      name: "DocumentStorageConflictError",
      code: "DOCUMENT_STORAGE_CONFLICT",
      currentVersion: "v3",
    });
  });

  it("uses the host chooser only for custom document storage and preserves cancellation", async () => {
    const backend = fakeStorage();
    const { ctx } = createPluginContext(manifest(["plugin.storage"]), backend, {
      appVersion: "1.0.0",
    });

    await expect(ctx.documentStorage.selectLocation("program")).resolves.toEqual({
      kind: "program",
      path: "C:/data/plugin-data/test-plugin",
    });
    expect(backend.pickDirectory).not.toHaveBeenCalled();
    expect(backend.documentStorageSelectLocation).toHaveBeenLastCalledWith(
      "test-plugin",
      "program",
      null,
    );

    await expect(ctx.documentStorage.selectLocation("custom")).resolves.toEqual({
      kind: "custom",
      path: "C:/chosen/plugin-data/test-plugin",
    });
    expect(backend.pickDirectory).toHaveBeenCalledTimes(1);
    expect(backend.documentStorageSelectLocation).toHaveBeenLastCalledWith(
      "test-plugin",
      "custom",
      "C:/chosen",
    );

    backend.pickDirectory.mockResolvedValueOnce(null);
    await expect(ctx.documentStorage.selectLocation("custom")).rejects.toThrow(/cancelled/i);
    expect(backend.documentStorageSelectLocation).toHaveBeenCalledTimes(2);
  });

  it("rejects structured document CAS conflicts as a typed error", async () => {
    const backend = fakeStorage();
    backend.documentStorageWriteTextAtomic.mockResolvedValueOnce({
      status: "conflict",
      currentVersion: "v2",
    });
    const { ctx } = createPluginContext(manifest(["plugin.storage"]), backend, {
      appVersion: "1.0.0",
    });

    const write = ctx.documentStorage.writeTextAtomic("state.json", "stale", "v1");
    await expect(write).rejects.toBeInstanceOf(DocumentStorageConflictError);
    await expect(write).rejects.toMatchObject({
      name: "DocumentStorageConflictError",
      code: "DOCUMENT_STORAGE_CONFLICT",
      currentVersion: "v2",
    });
  });

  it("rejects workspace and document access before calling the backend when permissions are absent", async () => {
    const backend = fakeStorage();
    const { ctx } = createPluginContext(manifest([]), backend, { appVersion: "1.0.0" });
    await expect(ctx.workspace.getMetadata()).rejects.toThrow(/workspace\.metadata\.read/);
    await expect(ctx.documentStorage.getLocation()).rejects.toThrow(/plugin\.storage/);
    expect(backend.workspaceMetadata).not.toHaveBeenCalled();
    await expect(ctx.workspaces.list()).rejects.toThrow(/workspace\.metadata\.read/);
    expect(backend.workspaceList).not.toHaveBeenCalled();
    expect(backend.documentStorageGetLocation).not.toHaveBeenCalled();
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
      "ui:workspace-menu",
      (ctx: PluginContext) =>
        ctx.ui.registerWorkspaceMenuItem({ label: () => "W", onSelect: () => {} }),
      workspaceMenuRegistry,
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

describe("permissioned SDK calls from guarded plugin callbacks", () => {
  const originalInternals = window.__TAURI_INTERNALS__;
  const nativeInvoke = vi.fn(async (_cmd: string, _args?: unknown): Promise<unknown> => null);

  beforeAll(() => {
    window.__TAURI_INTERNALS__ = { invoke: nativeInvoke };
    installHardening();
  });
  beforeEach(() => { nativeInvoke.mockClear(); });
  afterAll(() => {
    if (originalInternals) window.__TAURI_INTERNALS__ = originalInternals;
    else delete window.__TAURI_INTERNALS__;
  });

  // Follow the loader's synchronous backend -> Tauri path instead of a fake
  // backend that skips hardening (and therefore cannot expose this regression).
  function ipcStorage(): PluginContextBackend {
    return {
      ...fakeStorage(),
      get: (id, key) => tauriInvoke("plugin_storage_get", { id, key }),
      set: (id, key, value) => tauriInvoke("plugin_storage_set", { id, key, value }),
      delete: (id, key) => tauriInvoke("plugin_storage_delete", { id, key }),
      workspaceMetadata: (pluginId) => tauriInvoke("workspace_metadata", { pluginId }),
      documentStorageReadText: (pluginId, relativePath) =>
        tauriInvoke("plugin_document_storage_read_text", { pluginId, relativePath }),
      documentStorageWriteTextAtomic: (pluginId, relativePath, content, expectedVersion) =>
        tauriInvoke("plugin_document_storage_write_text_atomic", {
          pluginId, relativePath, content, expectedVersion,
        }),
      pickDirectory: () => tauriInvoke("plugin:dialog|open"),
      documentStorageSelectLocation: (pluginId, kind, customPath) =>
        tauriInvoke("plugin_document_storage_select_location", { pluginId, kind, customPath }),
      bridgeInvoke: (command, args) => tauriInvoke(command, args),
    };
  }

  it("persists workspace menu changes while rejecting direct IPC in that callback", async () => {
    const data = new Map<string, unknown>();
    nativeInvoke.mockImplementation(async (cmd, args) => {
      const input = JSON.parse(JSON.stringify(args)) as { id: string; key: string; value?: unknown };
      const key = `${input.id}:${input.key}`;
      if (cmd === "plugin_storage_set") data.set(key, input.value);
      if (cmd === "plugin_storage_delete") data.delete(key);
      return cmd === "plugin_storage_get" ? data.get(key) ?? null : null;
    });
    const { ctx } = createPluginContext(manifest(["storage", "ui:workspace-menu"]), ipcStorage(), {
      appVersion: "1.0.0",
    });
    let direct: Promise<unknown> | undefined;
    const dispose = ctx.ui.registerWorkspaceMenuItem({
      key: "toggle",
      label: () => "Toggle",
      onSelect: ({ workspaceId }) => {
        const saved = ctx.storage.set(workspaceId, { enabled: false });
        direct = tauriInvoke("plugin_storage_delete", { id: ctx.pluginId, key: workspaceId });
        return saved;
      },
    });
    try {
      await workspaceMenuRegistry.get("plugin:test-plugin:toggle")!.onSelect({
        workspaceId: "work", archived: false,
      });
      await expect(direct).rejects.toThrow(/blocked/);
      await expect(runAsPlugin(() => ctx.storage.get("work"))).resolves.toEqual({ enabled: false });
      await runAsPlugin(() => ctx.storage.delete("work"));
      await expect(runAsPlugin(() => ctx.storage.get("work"))).resolves.toBeNull();
    } finally {
      dispose();
    }
  });

  it("allows document, chooser, metadata and granted bridge operations during activation", async () => {
    nativeInvoke.mockImplementation(async (cmd) => {
      if (cmd === "workspace_metadata") return { id: "work", path: "C:/work" };
      if (cmd === "plugin_document_storage_read_text") return { content: "saved", version: "v1" };
      if (cmd === "plugin_document_storage_write_text_atomic") return { status: "written", version: "v2" };
      if (cmd === "plugin:dialog|open") return "C:/chosen";
      if (cmd === "plugin_document_storage_select_location") {
        return { kind: "custom", displayPath: "C:/chosen/plugin-data/test-plugin", writable: true };
      }
      if (cmd === "plugin_exec_run") return { code: 0, stdout: "ready", stderr: "" };
      throw new Error(`unexpected command ${cmd}`);
    });
    const { ctx } = createPluginContext(
      manifest(["workspace.metadata.read", "plugin.storage", "exec:tool"]),
      ipcStorage(),
      { appVersion: "1.0.0" },
    );
    const results = runAsPlugin(() => Promise.all([
      ctx.workspace.getMetadata(),
      ctx.documentStorage.readText("state.json"),
      ctx.documentStorage.writeTextAtomic("state.json", "next", "v1"),
      ctx.documentStorage.selectLocation("custom"),
      ctx.bridge.invoke("plugin_exec_run", { bin: "tool", args: [] }),
    ]));
    await expect(results).resolves.toEqual([
      { id: "work", path: "C:/work" },
      { content: "saved", version: "v1" },
      { version: "v2" },
      { kind: "custom", path: "C:/chosen/plugin-data/test-plugin" },
      { code: 0, stdout: "ready", stderr: "" },
    ]);
  });

  it("does not authorize undeclared SDK permissions or unknown bridge commands", async () => {
    const { ctx } = createPluginContext(manifest([]), ipcStorage(), { appVersion: "1.0.0" });
    const results = runAsPlugin(() => [
      ctx.storage.set("work", false),
      ctx.documentStorage.writeTextAtomic("state.json", "next", null),
      ctx.bridge.invoke("plugin_exec_run", { bin: "tool" }),
      ctx.bridge.invoke("plugin_http_request", { url: "https://example.com" }),
      ctx.bridge.invoke("plugin_storage_delete", { id: ctx.pluginId, key: "work" }),
    ]);
    for (const [index, permission] of [/storage/, /plugin\.storage/, /exec:/, /network:/, /unknown bridge command/].entries()) {
      await expect(results[index]).rejects.toThrow(permission);
    }
    expect(nativeInvoke).not.toHaveBeenCalled();
  });

  it("rejects an executable replaced during JSON serialization before dispatch", async () => {
    nativeInvoke.mockImplementation(async (_cmd, args) => JSON.parse(JSON.stringify(args)));
    const { ctx } = createPluginContext(manifest(["exec:tool"]), ipcStorage(), { appVersion: "1.0.0" });
    const result = runAsPlugin(() => ctx.bridge.invoke("plugin_exec_run", {
      bin: "tool",
      toJSON: () => ({ pluginId: "another-plugin", bin: "ungranted-tool" }),
    }));
    await expect(result).rejects.toThrow(/exec:/);
    expect(nativeInvoke).not.toHaveBeenCalled();
  });

  it("binds serialized bridge requests to the calling plugin and excludes IPC serializer hooks", async () => {
    nativeInvoke.mockImplementation(async (_cmd, args) => JSON.parse(JSON.stringify(args, (_key, value) => {
      if (value && typeof value === "object" && "__TAURI_TO_IPC_KEY__" in value) return value.__TAURI_TO_IPC_KEY__();
      return value;
    })));
    const { ctx } = createPluginContext(manifest(["exec:tool"]), ipcStorage(), { appVersion: "1.0.0" });
    await expect(runAsPlugin(() => ctx.bridge.invoke("plugin_exec_run", {
      bin: "tool",
      toJSON: () => ({ pluginId: "another-plugin", bin: "tool", args: ["--version"] }),
    }))).resolves.toEqual({ pluginId: ctx.pluginId, bin: "tool", args: ["--version"] });
    await expect(runAsPlugin(() => ctx.bridge.invoke("plugin_exec_run", {
      bin: "tool",
      __TAURI_TO_IPC_KEY__: () => ({ pluginId: "another-plugin", bin: "ungranted-tool" }),
    }))).resolves.toEqual({ pluginId: ctx.pluginId, bin: "tool" });
  });

  it("prepares bridge getters without authority and checks the exact values sent", async () => {
    nativeInvoke.mockImplementationOnce(async (_cmd, args) => {
      if (!args || typeof args !== "object" || !("bin" in args)) {
        throw new Error("missing executable in IPC request");
      }
      return { code: 0, stdout: args.bin, stderr: "" };
    });
    const { ctx } = createPluginContext(manifest(["exec:tool"]), ipcStorage(), { appVersion: "1.0.0" });
    let fromGetter: Promise<unknown> | undefined;
    let binReads = 0;
    const result = runAsPlugin(() => ctx.bridge.invoke("plugin_exec_run", {
      get bin() {
        return ++binReads === 1 ? "tool" : "ungranted-tool";
      },
      get args() {
        fromGetter = tauriInvoke("plugin_exec_run", { bin: "ungranted-tool" });
        return [];
      },
    }));
    await expect(result).resolves.toEqual({ code: 0, stdout: "tool", stderr: "" });
    await expect(fromGetter).rejects.toThrow(/blocked/);
    expect(nativeInvoke.mock.calls.map(([cmd]) => cmd)).toEqual(["plugin_exec_run"]);
  });
});
