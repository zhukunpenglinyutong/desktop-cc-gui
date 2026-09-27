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
  overlayRegistry,
  pageRegistry,
  panelTabRegistry,
  scopedPluginId,
  sessionMenuRegistry,
  settingsRegistry,
  statusBarRegistry,
  composerStatusRegistry,
  timelineRowRegistry,
  workspaceMenuRegistry,
  sidebarNavRegistry,
  centerTabRegistry,
  conversationModeRegistry,
} from "@ccgui/plugin-sdk";
import type {
  AssetDirectoryGrant,
  Disposer,
  PluginAgentCatalogEntry,
  MarkdownRendererDef,
  PluginContext,
  PluginManifest,
  RegisteredWorkspace,
  WorkspaceMetadata,
} from "@ccgui/plugin-sdk";
import {
  registerRuntimeSwitchHooks,
  registerSessionHooks,
  registerTurnHooks,
} from "./hooks";
import { assertPluginEmitTopic, pluginBus } from "./events";
import { setActiveComposerDraft } from "./composer-draft";
import { dismissCenterSurfaces } from "@/features/chat/center-surfaces";
import { addPluginWorkspace, openPluginSession } from "./workspace-bridge";
import { registerSessionSource } from "./session-source";
import { directoryAssetUrl, fileAssetUrl, remoteAssetUrl } from "./asset-url";
import { usePluginTabsStore } from "./center-tabs";
import { runAsPlugin, withAuthorizedHostInvoke } from "./hardening";

/** Storage transport the context talks to; the loader binds the IPC-backed
 *  implementation, tests bind fakes. */
export interface PluginStorageBackend {
  get(id: string, key: string): Promise<unknown>;
  set(id: string, key: string, value: unknown): Promise<void>;
  delete(id: string, key: string): Promise<void>;
}

export type DocumentStorageLocationResponse = {
  kind: "data" | "program" | "custom";
  displayPath: string;
  writable: boolean;
};

export type DocumentStorageWriteResponse =
  | { status: "written"; version: string }
  | { status: "conflict"; currentVersion: string | null };

export type DocumentStorageRemoveResponse =
  | { status: "removed" }
  | { status: "conflict"; currentVersion: string | null };

/** Full backend seam the context needs. Every method accepts pluginId first;
 * the loader binds these calls to IPC and tests bind minimal fakes. */
export interface PluginContextBackend extends PluginStorageBackend {
  agentCatalog?(workspacePath: string): Promise<PluginAgentCatalogEntry[]>;
  bridgeInvoke(command: string, args: Record<string, unknown>): Promise<unknown>;
  workspaceMetadata(id: string): Promise<WorkspaceMetadata>;
  workspaceList(id: string): Promise<RegisteredWorkspace[]>;
  pickDirectory(title?: string): Promise<string | null>;
  documentStorageGetLocation(id: string): Promise<DocumentStorageLocationResponse>;
  documentStorageSelectLocation(
    id: string,
    kind: "data" | "program" | "custom",
    customPath: string | null,
  ): Promise<DocumentStorageLocationResponse>;
  documentStorageReadText(
    id: string,
    relativePath: string,
  ): Promise<{ content: string; version: string } | null>;
  documentStorageWriteTextAtomic(
    id: string,
    relativePath: string,
    content: string,
    expectedVersion: string | null,
  ): Promise<DocumentStorageWriteResponse>;
  documentStorageRemove(
    id: string,
    relativePath: string,
    expectedVersion: string | null,
  ): Promise<DocumentStorageRemoveResponse>;
  documentStorageList(id: string, prefix?: string): Promise<string[]>;
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

export class DocumentStorageConflictError extends Error {
  readonly code = "DOCUMENT_STORAGE_CONFLICT";

  constructor(readonly currentVersion: string | null) {
    super(
      `document storage version conflict (current: ${currentVersion ?? "missing"})`,
    );
    this.name = "DocumentStorageConflictError";
  }
}

function sdkLocation(location: DocumentStorageLocationResponse) {
  return { kind: location.kind, path: location.displayPath };
}

const REMOTE_CSS = /@import|url\(\s*['"]?https?:/i;

/** Shared stylesheet mount: tagged `<style data-plugin=id>` in <head>,
 *  disposer removes it. Remote references rejected (plan §8 gate rule).
 *
 *  `layered` wraps the css in `@layer ccgui-plugins` — declared between
 *  Tailwind's base and components layers in index.css (after base, so
 *  preflight resets can't erase plugin borders/paddings/backgrounds) — so
 *  host component and utility rules still win every specificity tie
 *  against bundle CSS. Without it, a bundle that
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
    hooks: {
      registerSessionHooks(hooks) {
        requirePermission("session.lifecycle.read");
        return track(registerSessionHooks(id, hooks));
      },
      registerTurnHooks(hooks) {
        if (hooks.onTurnStarted || hooks.onRuntimeEvent || hooks.afterTurn) {
          requirePermission("runtime.events.read");
        }
        if (hooks.beforeTurn || hooks.onInternalMessage) {
          requirePermission("prompt.contribute.internal");
        }
        return track(registerTurnHooks(id, hooks));
      },
      registerRuntimeSwitchHooks(hooks) {
        requirePermission("runtime.switch.observe");
        return track(registerRuntimeSwitchHooks(id, hooks));
      },
    },
    workspace: {
      async getMetadata() {
        requirePermission("workspace.metadata.read");
        return withAuthorizedHostInvoke(() => backend.workspaceMetadata(id));
      },
    },
    documentStorage: {
      async getLocation() {
        requirePermission("plugin.storage");
        return sdkLocation(await withAuthorizedHostInvoke(() => backend.documentStorageGetLocation(id)));
      },
      async selectLocation(kind) {
        requirePermission("plugin.storage");
        let customPath: string | null = null;
        if (kind === "custom") {
          customPath = await withAuthorizedHostInvoke(() => backend.pickDirectory());
          if (customPath === null) throw new Error("document storage directory selection cancelled");
        }
        return sdkLocation(await withAuthorizedHostInvoke(() =>
          backend.documentStorageSelectLocation(id, kind, customPath),
        ));
      },
      async readText(relativePath) {
        requirePermission("plugin.storage");
        return withAuthorizedHostInvoke(() => backend.documentStorageReadText(id, relativePath));
      },
      async writeTextAtomic(relativePath, content, expectedVersion) {
        requirePermission("plugin.storage");
        const result = await withAuthorizedHostInvoke(() => backend.documentStorageWriteTextAtomic(
          id,
          relativePath,
          content,
          expectedVersion,
        ));
        if (result.status === "conflict") {
          throw new DocumentStorageConflictError(result.currentVersion);
        }
        return { version: result.version };
      },
      async remove(relativePath, expectedVersion) {
        requirePermission("plugin.storage");
        const result = await withAuthorizedHostInvoke(() => backend.documentStorageRemove(
          id,
          relativePath,
          expectedVersion ?? null,
        ));
        if (result.status === "conflict") {
          throw new DocumentStorageConflictError(result.currentVersion);
        }
      },
      async list(prefix) {
        requirePermission("plugin.storage");
        return withAuthorizedHostInvoke(() => backend.documentStorageList(id, prefix));
      },
    },
    assets: {
      bundleUrl(relativePath) {
        requirePermission("assets:bundle");
        return fileAssetUrl(id, "bundle", relativePath);
      },
      documentUrl(relativePath) {
        requirePermission("plugin.storage");
        return fileAssetUrl(id, "doc", relativePath);
      },
      remoteUrl(url) {
        if (typeof url !== "string") throw new Error("asset URL must be an HTTP(S) string");
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          throw new Error("asset URL must use HTTP or HTTPS");
        }
        if (parsed.username || parsed.password) {
          throw new Error("asset URL credentials are not allowed");
        }
        if (!networkGrantAllows(manifest.permissions, parsed.href)) {
          throw new Error(`[plugins] "${id}" asset request matches no declared network: grant`);
        }
        return remoteAssetUrl(id, parsed);
      },
      async grantDirectory() {
        requirePermission("assets:directory");
        const title = i18n.t("plugins.assetPickTitle");
        const path = await withAuthorizedHostInvoke(() => backend.pickDirectory(title));
        if (path === null) throw new Error("asset directory selection cancelled");
        return withAuthorizedHostInvoke(() => backend.bridgeInvoke(
          "plugin_asset_grant_directory", { pluginId: id, path },
        )) as Promise<AssetDirectoryGrant>;
      },
      async listDirectories() {
        requirePermission("assets:directory");
        return withAuthorizedHostInvoke(() => backend.bridgeInvoke(
          "plugin_asset_list_directories", { pluginId: id },
        )) as Promise<AssetDirectoryGrant[]>;
      },
      async revokeDirectory(grantId) {
        requirePermission("assets:directory");
        if (typeof grantId !== "string") throw new Error("asset grant id must be a string");
        await withAuthorizedHostInvoke(() => backend.bridgeInvoke(
          "plugin_asset_revoke_directory", { pluginId: id, grantId },
        ));
      },
      directoryUrl(grantId, relativePath) {
        requirePermission("assets:directory");
        return directoryAssetUrl(id, grantId, relativePath);
      },
    },
    shell: {
      async revealPath(path) {
        if (!manifest.permissions.includes("plugin.storage") && !manifest.permissions.includes("assets:directory")) {
          throw new Error(`[plugins] "${id}" revealPath requires plugin.storage or assets:directory`);
        }
        if (typeof path !== "string") throw new Error("reveal path must be a string");
        await withAuthorizedHostInvoke(() => backend.bridgeInvoke(
          "plugin_reveal_path", { pluginId: id, path },
        ));
      },
    },
    ui: {
      registerConversationMode(def) {
        requirePermission("ui:conversation-mode");
        return track(conversationModeRegistry.register({
          id: scopedPluginId(id, def.key),
          label: () => runAsPlugin(def.label),
          component: def.component,
        }));
      },
      registerSettingsSection(def) {
        requirePermission("ui:settings-section");
        const key = scopedPluginId(id, def.key);
        return track(
          settingsRegistry.register({
            id: key,
            key,
            label: def.label,
            icon: def.icon,
            group: "plugins",
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
        requirePermission("ui:composer-status");
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
            zone: def.zone,
          }),
        );
      },
      registerComposerStatusItem(def) {
        requirePermission("ui:composer-status");
        return track(
          composerStatusRegistry.register({
            id: scopedPluginId(id, def.key),
            component: def.component,
            order: def.order,
          }),
        );
      },
      registerOverlay(def) {
        requirePermission("ui:overlay");
        return track(overlayRegistry.register({
          id: scopedPluginId(id, def.key),
          component: def.component,
          order: def.order,
        }));
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
      registerSessionMenuItem(def) {
        requirePermission("ui:session-menu");
        return track(
          sessionMenuRegistry.register({
            id: scopedPluginId(id, def.key),
            label: def.label,
            icon: def.icon,
            danger: def.danger,
            run: (target) => runAsPlugin(() => def.run(target)),
          }),
        );
      },
      openSettings(key) {
        requirePermission("ui:settings-section");
        // 宿主是 hash 路由（见 features/commands/builtins.ts 的设置命令）。
        window.location.hash = `#/settings?page=${scopedPluginId(id, key)}`;
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
      registerWorkspaceMenuItem(def) {
        requirePermission("ui:workspace-menu");
        // Callbacks fire from host render/click paths, so each hop is marked
        // as plugin code (same as registerAddMenuRow/registerCommand).
        const visible = def.visible;
        return track(
          workspaceMenuRegistry.register({
            id: scopedPluginId(id, def.key),
            label: (target) => runAsPlugin(() => def.label(target)),
            icon: def.icon,
            visible: visible && ((target) => runAsPlugin(() => visible(target))),
            onSelect: (target) => runAsPlugin(() => def.onSelect(target)),
            order: def.order,
          }),
        );
      },
      registerSidebarNav(def) {
        requirePermission("ui:sidebar-entry");
        return track(
          sidebarNavRegistry.register({
            id: scopedPluginId(id, def.key),
            label: def.label,
            icon: def.icon,
            order: def.order,
            onOpen: () => runAsPlugin(def.onOpen),
          }),
        );
      },
      registerCenterTab(def) {
        requirePermission("ui:center-tab");
        return track(
          centerTabRegistry.register({
            id: scopedPluginId(id, def.key),
            title: def.title,
            icon: def.icon,
            component: def.component,
            order: def.order,
          }),
        );
      },
      openCenterTab(key) {
        requirePermission("ui:center-tab");
        const tabId = scopedPluginId(id, key);
        if (!centerTabRegistry.get(tabId)) {
          throw new Error(`[plugins] "${id}" opened unregistered center tab ${tabId}`);
        }
        // 插件页签置前：其他中心面（浏览器/文件/插件中心/工作台/差异）让位；
        // 否则经由插件侧栏入口打开时，页签开了、画面还停在原地。
        dismissCenterSurfaces();
        usePluginTabsStore.getState().openTab(tabId);
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
        const value = await withAuthorizedHostInvoke(() => backend.get(id, key));
        return (value ?? null) as T | null;
      },
      async set(key, value) {
        requirePermission("storage");
        await withAuthorizedHostInvoke(() => backend.set(id, key, value));
      },
      async delete(key) {
        requirePermission("storage");
        await withAuthorizedHostInvoke(() => backend.delete(id, key));
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
    workspaces: {
      add(path, meta) {
        requirePermission("host:workspace");
        // meta 带 wsl 键 = 远程工作区(会话流量经 ssh 导向插件指定主机),
        // 需要独立的 host:workspace:remote 授权;判定在 workspace-bridge。
        return addPluginWorkspace(id, path, meta, () =>
          requirePermission("host:workspace:remote"),
        );
      },
      async list() {
        requirePermission("workspace.metadata.read");
        return withAuthorizedHostInvoke(() => backend.workspaceList(id));
      },
    },
    sessions: {
      selectSession(engine, sessionId, workspacePath) {
        requirePermission("host:session");
        // 契约返回 Promise:校验失败走 rejection 而不是同步抛,与
        // workspaces.add 一致(插件可用 .catch 链式处理)。
        return Promise.resolve().then(() =>
          openPluginSession(id, engine, sessionId, workspacePath),
        );
      },
      refresh() {
        requirePermission("host:session");
        // 插件直写会话数据后的可见性补偿：走与宿主自身重命名/置顶一致的
        // refreshSessions，侧栏与标签页立即反映。动态引入避免与 chat store
        // 的模块环（store → plugins/runtime/session-source）。
        return import("@/features/chat/store").then((m) =>
          m.useChatStore.getState().refreshSessions(),
        );
      },
      setEffort(engine, sessionId, workspacePath, effort) {
        requirePermission("host:session");
        // 校验失败走 rejection（与 selectSession 一致）。store 侧拒绝未知
        // 会话键——错误的 workspacePath 不得经 patchSession 造出幽灵条目。
        return Promise.resolve().then(() =>
          import("@/features/chat/store").then((m) =>
            m.setPluginSessionEffort(engine, sessionId, workspacePath, effort),
          ),
        );
      },
      registerSource(def) {
        requirePermission("host:session");
        // 入口校验:不合规 def 同步抛回插件(登记期 bug 应当即暴露),
        // 否则非函数 list 会在每次会话刷新时才炸,且连累其他源。
        if (
          typeof def?.id !== "string" ||
          !def.id ||
          typeof def.list !== "function"
        ) {
          throw new Error(
            `[plugins] "${id}" sessions.registerSource: def must be { id: non-empty string, list: () => Promise<ExternalSessionRow[]> }`,
          );
        }
        return track(
          registerSessionSource(id, def.id, () => runAsPlugin(def.list)),
        );
      },
    },
    agent: {
      async catalog(workspacePath) {
        requirePermission("agent");
        if (!backend.agentCatalog) throw new Error("Plugin agent catalog is unavailable on this host");
        return backend.agentCatalog(workspacePath);
      },
      start(def) {
        requirePermission("agent");
        if (def.requestId !== undefined && !/^[a-fA-F0-9]{32}$/.test(def.requestId)) {
          throw new Error("Plugin agent requestId must contain exactly 32 hexadecimal characters");
        }
        return backend.bridgeInvoke("plugin_agent_start", {
          pluginId: id,
          engine: def.engine,
          prompt: def.prompt,
          workspacePath: def.workspacePath,
          model: def.model ?? null,
          providerId: def.providerId ?? null,
          sessionId: def.sessionId ?? null,
          readOnly: def.readOnly ?? false,
          requestId: def.requestId ?? null,
        }) as Promise<{ runId: string; sessionId: string | null }>;
      },
      async interrupt(runId) {
        requirePermission("agent");
        return await backend.bridgeInvoke("plugin_agent_interrupt", { pluginId: id, runId }) as boolean;
      },
    },
    bridge: {
      invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
        // JS 侧预检（DX；真边界是 Rust 侧的服务端强制）：授权未命中即
        // reject，不打 IPC。通过后注入 pluginId 再 invoke。
        // Serialize before granting authority: getters/toJSON cannot change the
        // checked payload or carry executable Tauri serialization hooks onward.
        const hostArgs: Record<string, unknown> = { ...JSON.parse(JSON.stringify(args)), pluginId: id };
        if (command === "plugin_http_request") {
          const url = typeof hostArgs.url === "string" ? hostArgs.url : "";
          if (!networkGrantAllows(manifest.permissions, url)) {
            return Promise.reject(
              new Error(
                `[plugins] "${id}" http request to ${url || "(invalid url)"} matches no declared network: grant`,
              ),
            );
          }
        } else if (command === "plugin_exec_run" || command === "plugin_exec_spawn") {
          const bin = typeof hostArgs.bin === "string" ? hostArgs.bin : "";
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
        } else if (command === "plugin_agent_start" || command === "plugin_agent_interrupt") {
          // 通用出口与 ctx.agent 同一能力：引擎管线走宿主（渠道/注册表/
          // 事件流）；run id 的属主前缀在 Rust 侧强制。
          if (!manifest.permissions.includes("agent")) {
            return Promise.reject(
              new Error(`[plugins] "${id}" used ${command} without declaring "agent" in permissions`),
            );
          }
        } else {
          return Promise.reject(
            new Error(
              `[plugins] unknown bridge command "${command}" (available: plugin_http_request / plugin_exec_run / plugin_exec_spawn / plugin_exec_kill / plugin_agent_start / plugin_agent_interrupt)`,
            ),
          );
        }
        return withAuthorizedHostInvoke(() => backend.bridgeInvoke(command, hostArgs)) as Promise<T>;
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
