import { describe, expect, it } from "vitest";
import { createPluginContext, type PluginContextBackend } from "../runtime/context";
import { commandRegistry, statusBarRegistry } from "@ccgui/plugin-sdk";
import { pluginBus } from "../runtime/events";
import type { PluginManifest } from "@ccgui/plugin-sdk";
import { applyDeclarativePlugin } from "./interpreter";

function fakeBackend(): PluginContextBackend {
  const data = new Map<string, unknown>();
  return {
    get: async (id, key) => data.get(`${id}:${key}`) ?? null,
    set: async (id, key, value) => void data.set(`${id}:${key}`, value),
    delete: async (id, key) => void data.delete(`${id}:${key}`),
    bridgeInvoke: async () => null,
    workspaceMetadata: async () => ({ id: "workspace", path: "/work" }),
    workspaceList: async () => [],
    pickDirectory: async () => null,
    documentStorageGetLocation: async () => ({ kind: "data", displayPath: "/data", writable: true }),
    documentStorageSelectLocation: async (_id, kind) => ({ kind, displayPath: "/data", writable: true }),
    documentStorageReadText: async () => null,
    documentStorageWriteTextAtomic: async () => ({ status: "written", version: "v1" }),
    documentStorageRemove: async () => ({ status: "removed" }),
    documentStorageList: async () => [],
  };
}

function declarative(manifest: Partial<PluginManifest>): PluginManifest {
  return {
    id: "deco",
    name: "Deco",
    version: "1.0.0",
    tier: "declarative",
    permissions: [],
    ...manifest,
  };
}

describe("applyDeclarativePlugin (phase-2 contributes)", () => {
  it("statusBarItems register static text chips and dispose cleanly", () => {
    const handle = createPluginContext(
      declarative({
        permissions: ["ui:status-bar"],
        contributes: { statusBarItems: [{ key: "motto", text: "hello" }] },
      }),
      fakeBackend(),
      { appVersion: "1.0.0" },
    );
    applyDeclarativePlugin(handle);
    const entry = statusBarRegistry.get("plugin:deco:motto");
    expect(entry).toBeDefined();
    for (const d of [...handle.disposers].reverse()) d();
    expect(statusBarRegistry.get("plugin:deco:motto")).toBeUndefined();
  });

  it("declarative commands register with static title and emit their topic when run", () => {
    const handle = createPluginContext(
      declarative({
        permissions: ["ui:command", "events"],
        contributes: { commands: [{ key: "ping", title: "Ping" }] },
      }),
      fakeBackend(),
      { appVersion: "1.0.0" },
    );
    applyDeclarativePlugin(handle);
    const entry = commandRegistry.get("plugin:deco:ping");
    expect(entry?.title()).toBe("Ping");

    const seen: unknown[] = [];
    const off = pluginBus.on("plugin:deco:command:ping", (d) => seen.push(d));
    entry?.run();
    expect(seen).toEqual([{ command: "ping" }]);
    off();
    for (const d of [...handle.disposers].reverse()) d();
    expect(commandRegistry.get("plugin:deco:ping")).toBeUndefined();
  });

  it("honors a custom emits topic (inside the plugin's own namespace)", () => {
    const handle = createPluginContext(
      declarative({
        permissions: ["ui:command", "events"],
        contributes: {
          commands: [{ key: "go", title: "Go", emits: "plugin:deco:custom:go" }],
        },
      }),
      fakeBackend(),
      { appVersion: "1.0.0" },
    );
    applyDeclarativePlugin(handle);
    const seen: unknown[] = [];
    const off = pluginBus.on("plugin:deco:custom:go", (d) => seen.push(d));
    commandRegistry.get("plugin:deco:go")?.run();
    expect(seen).toHaveLength(1);
    off();
    for (const d of [...handle.disposers].reverse()) d();
  });

  it("undeclared permissions surface as an activate-time failure, not a silent skip", () => {
    const handle = createPluginContext(
      declarative({
        permissions: [],
        contributes: { statusBarItems: [{ text: "x" }] },
      }),
      fakeBackend(),
      { appVersion: "1.0.0" },
    );
    expect(() => applyDeclarativePlugin(handle)).toThrow(/ui:status-bar/);
  });
});
