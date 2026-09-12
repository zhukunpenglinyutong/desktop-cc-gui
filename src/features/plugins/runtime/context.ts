import * as React from "react";
import i18n from "@/lib/i18n";
import { isWeb } from "@/lib/transport";
import {
  SDK_VERSION,
  addMenuRegistry,
  commandRegistry,
  composerSlotRegistry,
  execGrantAllows,
  markdownRegistry,
  networkGrantAllows,
  pageRegistry,
  panelTabRegistry,
  scopedPluginId,
  settingsRegistry,
  statusBarRegistry,
  timelineRowRegistry,
} from "@ccgui/plugin-sdk";
import type {
  Disposer,
  MarkdownRendererDef,
  PluginContext,
  PluginManifest,
} from "@ccgui/plugin-sdk";
import { assertPluginEmitTopic, pluginBus } from "./events";
import { setActiveComposerDraft } from "./composer-draft";
import { runAsPlugin } from "./hardening";

/** Storage transport the context talks to; the loader binds the IPC-backed
 *  implementation, tests bind fakes. */
export interface PluginStorageBackend {
  get(id: string, key: string): Promise<unknown>;
  set(id: string, key: string, value: unknown): Promise<void>;
  delete(id: string, key: string): Promise<void>;
}

/** Full backend seam the context needs: KV storage plus the bridge invoke
 *  (grant-checked below, then routed through the host's transport by the
 *  loader's IPC-backed implementation). */
export interface PluginContextBackend extends PluginStorageBackend {
  bridgeInvoke(command: string, args: Record<string, unknown>): Promise<unknown>;
}

export interface PluginHandle {
  manifest: PluginManifest;
  ctx: PluginContext;
  /** Registrations made through the context, in registration order. Unload
   *  order (loader): the activate-returned cleanup first, then this stack
   *  reversed — outermost effects unwind before the registrations they were
   *  built on. */
  disposers: Disposer[];
}

const REMOTE_CSS = /@import|url\(\s*['"]?https?:/i;

/** Shared stylesheet mount: tagged `<style data-plugin=id>` in <head>,
 *  disposer removes it. Remote references rejected (plan §8 gate rule).
 *
 *  `layered` wraps the css in `@layer ccgui-plugins` — declared ahead of
 *  Tailwind's theme/base/components/utilities in index.css — so host rules
 *  win every specificity tie against bundle CSS. Without it, a bundle that
 *  accidentally ships its own Tailwind build lands after the host
 *  stylesheet, and its later, equal-specificity `.w-full`/`.hidden` defeat
 *  host responsive variants like `md:w-[254px]` (the settings modal once
 *  collapsed to a full-width nav rail with no content pane this way).
 *  Theme-API CSS stays unlayered on purpose: token overrides must beat the
 *  host's unlayered :root/.dark token definitions.
 */
function mountPluginCss(id: string, css: string, opts?: { layered?: boolean }): Disposer {
  if (REMOTE_CSS.test(css)) {
    throw new Error(`[plugins] "${id}" css references remote resources (@import/url http)`);
  }
  const style = document.createElement("style");
  style.dataset.plugin = id;
  style.textContent = opts?.layered ? `@layer ccgui-plugins {\n${css}\n}` : css;
  document.head.appendChild(style);
  return () => style.remove();
}

/**
 * Inject a bundle's `styles.css` at load time (Obsidian convention: the
 * stylesheet is one of the three bundle files, reviewed at install). This is
 * host behavior, not a plugin API call, so it bypasses the `theme`
 * permission gate — that gate exists for runtime-arbitrary CSS, not for the
 * shipped artifact. The remote-reference rule still applies.
 */
export function injectBundleCss(handle: PluginHandle, css: string): void {
  handle.disposers.push(mountPluginCss(handle.manifest.id, css, { layered: true }));
}

function tokenBlock(selector: string, tokens: Record<string, string> | undefined): string {
  if (!tokens) return "";
  const lines = Object.entries(tokens).map(([k, v]) => {
    if (!k.startsWith("--")) throw new Error(`[plugins] token key "${k}" must start with --`);
    return `${k}: ${v};`;
  });
  return lines.length ? `${selector} { ${lines.join(" ")} }` : "";
}

/**
 * Builds the host implementation of the SDK's PluginContext contract
 * (@ccgui/plugin-sdk). Every registration returns a Disposer and is also
 * pushed onto the plugin's disposer stack, so unload reverses everything
 * even when the plugin forgot to return its own cleanup. Capability groups
 * are trimmed by the manifest's declared permissions (门面裁剪).
 */
export function createPluginContext(
  manifest: PluginManifest,
  backend: PluginContextBackend,
  hostInfo: { appVersion: string },
): PluginHandle {
  const disposers: Disposer[] = [];
  const id = manifest.id;

  /** Missing-permission failures throw: a plugin probing beyond its manifest
   *  is a bug the developer should see, not a silent no-op. Unknown
   *  permissions never reach here — validateManifest rejects them at load. */
  const requirePermission = (capability: string) => {
    if (!manifest.permissions.includes(capability)) {
      throw new Error(`[plugins] "${id}" used ${capability} without declaring it in permissions`);
    }
  };
  const track = (d: Disposer): Disposer => {
    disposers.push(d);
    return d;
  };

  const ctx: PluginContext = {
    pluginId: id,
    version: manifest.version,
    react: React,
    ui: {
      registerSettingsSection(def) {
        requirePermission("ui:settings-section");
        const key = scopedPluginId(id, def.key);
        return track(
          settingsRegistry.register({
            id: key,
            key,
            label: def.label,
            icon: def.icon,
            group: "settings",
            order: 1000,
            component: def.component,
          }),
        );
      },
      registerAddMenuRow(def) {
        requirePermission("ui:add-menu");
        const rowId = scopedPluginId(id, def.key);
        return track(
          addMenuRegistry.register({
            id: rowId,
            label: def.label,
            description: def.description,
            icon: def.icon,
            onSelect: () => runAsPlugin(def.onSelect),
          }),
        );
      },
      registerComposerSlot(def) {
        requirePermission("ui:composer");
        return track(
          composerSlotRegistry.register({
            id: scopedPluginId(id, def.key),
            slot: def.slot,
            component: def.component,
            order: def.order,
          }),
        );
      },
      registerPanelTab(def) {
        requirePermission("ui:panel-tab");
        return track(
          panelTabRegistry.register({
            id: scopedPluginId(id, def.key),
            label: def.label,
            icon: def.icon,
            component: def.component,
            order: def.order,
          }),
        );
      },
      registerStatusBarItem(def) {
        requirePermission("ui:status-bar");
        return track(
          statusBarRegistry.register({
            id: scopedPluginId(id, def.key),
            component: def.component,
            order: def.order,
          }),
        );
      },
      registerCommand(def) {
        requirePermission("ui:command");
        return track(
          commandRegistry.register({
            id: scopedPluginId(id, def.key),
            title: def.title,
            keywords: def.keywords,
            run: () => runAsPlugin(def.run),
          }),
        );
      },
      registerMarkdownRenderer(def) {
        requirePermission("ui:markdown");
        return track(
          markdownRegistry.register({
            id: scopedPluginId(id, def.key),
            remarkPlugins: def.remarkPlugins,
            rehypePlugins: def.rehypePlugins,
            components: def.components as MarkdownRendererDef["components"],
          }),
        );
      },
      registerPage(def) {
        requirePermission("ui:page");
        return track(
          pageRegistry.register({
            id: scopedPluginId(id, def.key),
            title: def.title,
            component: def.component,
          }),
        );
      },
      registerTimelineRowRenderer(def) {
        requirePermission("ui:timeline-row");
        return track(
          timelineRowRegistry.register({
            id: scopedPluginId(id, def.key),
            kind: def.kind,
            component: def.component,
          }),
        );
      },
    },
    theme: {
      injectCss(css) {
        requirePermission("theme");
        return track(mountPluginCss(id, css));
      },
      setTokens(tokens) {
        const css = `${tokenBlock(":root", tokens.light)}\n${tokenBlock(".dark", tokens.dark)}`;
        return ctx.theme.injectCss(css);
      },
    },
    i18n: {
      addBundle(lang, ns, resources) {
        requirePermission("i18n");
        i18n.addResourceBundle(lang, ns, resources, true, true);
        return track(() => {
          // i18next ≥19.10; absence means the bundle stays until reload —
          // acceptable residual state, logged rather than thrown.
          if (typeof i18n.removeResourceBundle === "function") i18n.removeResourceBundle(lang, ns);
        });
      },
    },
    storage: {
      async get<T>(key: string): Promise<T | null> {
        requirePermission("storage");
        const value = await backend.get(id, key);
        return (value ?? null) as T | null;
      },
      async set(key, value) {
        requirePermission("storage");
        await backend.set(id, key, value);
      },
      async delete(key) {
        requirePermission("storage");
        await backend.delete(id, key);
      },
    },
    events: {
      on(topic, cb) {
        requirePermission("events");
        return track(pluginBus.on(topic, (data) => runAsPlugin(() => cb(data))));
      },
      emit(topic, data) {
        requirePermission("events");
        assertPluginEmitTopic(id, topic);
        pluginBus.emit(topic, data);
      },
    },
    composer: {
      setDraft(text) {
        requirePermission("composer:draft");
        setActiveComposerDraft(id, text);
      },
    },
    bridge: {
      invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
        // JS 侧预检（DX；真边界是 Rust 侧的服务端强制）：授权未命中即
        // reject，不打 IPC。通过后注入 pluginId 再 invoke。
        if (command === "plugin_http_request") {
          const url = typeof args.url === "string" ? args.url : "";
          if (!networkGrantAllows(manifest.permissions, url)) {
            return Promise.reject(
              new Error(
                `[plugins] "${id}" http request to ${url || "(invalid url)"} matches no declared network: grant`,
              ),
            );
          }
        } else if (command === "plugin_exec_run" || command === "plugin_exec_spawn") {
          const bin = typeof args.bin === "string" ? args.bin : "";
          if (!execGrantAllows(manifest.permissions, bin)) {
            return Promise.reject(
              new Error(
                `[plugins] "${id}" exec of "${bin || "(invalid bin)"}" matches no declared exec: grant`,
              ),
            );
          }
        } else if (command === "plugin_exec_kill") {
          // Kills only this plugin's own tracked children; requiring some
          // exec: grant keeps the capability auditable in the manifest.
          if (!manifest.permissions.some((p) => p.startsWith("exec:"))) {
            return Promise.reject(
              new Error(`[plugins] "${id}" used plugin_exec_kill without any exec: grant`),
            );
          }
        } else {
          return Promise.reject(
            new Error(
              `[plugins] unknown bridge command "${command}" (available: plugin_http_request / plugin_exec_run / plugin_exec_spawn / plugin_exec_kill)`,
            ),
          );
        }
        // Not wrapped in runAsPlugin: the hardening guard would reject the
        // call it makes through the host's own transport. The grant checks
        // above are the DX gate; the invoke itself is host-authorized.
        return backend.bridgeInvoke(command, { ...args, pluginId: id }) as Promise<T>;
      },
    },
    host: {
      appVersion: hostInfo.appVersion,
      sdkVersion: SDK_VERSION,
      isWeb,
      get locale() {
        return i18n.language;
      },
    },
  };

  return { manifest, ctx, disposers };
}
