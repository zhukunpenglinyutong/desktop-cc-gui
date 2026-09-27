import { ipc, type PluginInfo } from "@/lib/ipc";
import { getAppVersion, pickDirectory } from "@/lib/platform";
import i18n from "@/lib/i18n";
import { buildAgentCatalog } from "../conversation/agent-catalog";
import { invoke } from "@/lib/transport";
import { useChatStore } from "@/features/chat/store";
import {
  createPluginContext,
  injectBundleCss,
  type PluginContextBackend,
  type PluginHandle,
} from "./context";
import { bridgePluginAgentEvents, bridgeUsageEvents } from "./events";
import { installHardening, runAsPlugin } from "./hardening";
import { validateManifest } from "./permissions";
import { applyDeclarativePlugin } from "../declarative/interpreter";
import {
  SDK_VERSION,
  compareVersions,
  satisfiesSdkRange,
  type Disposer,
  type PluginManifest,
} from "@ccgui/plugin-sdk";

/**
 * Plugin loader (plan §4.1 runtime/loader.ts + ADR-5 state machine).
 * Loads every enabled, non-quarantined plugin at bootstrap; external bundles
 * are fetched via plugin_read_file and dynamically imported from a blob URL
 * (Phase 0 loading decision for Phase 1: blob works under WKWebView/WebView2
 * module semantics with `script-src … blob:`; the custom `plugin://` protocol
 * remains the documented fallback, plan §7 P0-1).
 */

export type PluginRuntimeState =
  | "installed"
  | "loading"
  | "active"
  | "failed"
  | "quarantined"
  | "incompatible";

export interface PluginRuntimeEntry {
  id: string;
  state: PluginRuntimeState;
  error?: string;
}

/** Backend seam: IPC in the app, fakes in tests. */
export interface LoaderBackend extends PluginContextBackend {
  list(): Promise<PluginInfo[]>;
  readFile(id: string, name: string): Promise<string>;
  quarantine(id: string, error: string): Promise<unknown>;
  setEnabled(id: string, enabled: boolean): Promise<unknown>;
  appVersion(): Promise<string>;
}

export const ipcBackend: LoaderBackend = {
  agentCatalog: (workspacePath) => buildAgentCatalog(ipc, workspacePath, (key) => i18n.t(key)),
  list: () => ipc.pluginList(),
  readFile: (id, name) => ipc.pluginReadFile(id, name),
  quarantine: (id, error) => ipc.pluginQuarantine(id, error),
  setEnabled: (id, enabled) => ipc.pluginSetEnabled(id, enabled),
  appVersion: async () => (await getAppVersion()) ?? "0.0.0",
  get: (id, key) => ipc.pluginStorageGet(id, key),
  set: (id, key, value) => ipc.pluginStorageSet(id, key, value),
  delete: (id, key) => ipc.pluginStorageDelete(id, key),
  bridgeInvoke: (command, args) => invoke(command, args),
  workspaceMetadata: async (id) => {
    const workspacePath = useChatStore.getState().active?.workspacePath;
    if (!workspacePath) throw new Error("no active workspace");
    return ipc.pluginWorkspaceMetadata(id, workspacePath);
  },
  workspaceList: (id) => ipc.pluginListWorkspaces(id),
  pickDirectory: (title = "Select plugin document storage directory") => pickDirectory(title),
  documentStorageGetLocation: (id) => ipc.pluginDocumentStorageGetLocation(id),
  documentStorageSelectLocation: (id, kind, customPath) =>
    ipc.pluginDocumentStorageSelectLocation(id, kind, customPath),
  documentStorageReadText: (id, relativePath) =>
    ipc.pluginDocumentStorageReadText(id, relativePath),
  documentStorageWriteTextAtomic: (id, relativePath, content, expectedVersion) =>
    ipc.pluginDocumentStorageWriteTextAtomic(id, relativePath, content, expectedVersion),
  documentStorageRemove: (id, relativePath, expectedVersion) =>
    ipc.pluginDocumentStorageRemove(id, relativePath, expectedVersion),
  documentStorageList: (id, prefix) => ipc.pluginDocumentStorageList(id, prefix),
};

/** Run a handle's registration stack in reverse (unload order). A throwing
 *  disposer is logged and unwinding continues — partial teardown must never
 *  strand the rest of the stack. Shared by unloadPlugin and loadPlugin's
 *  partial-registration cleanup. */
function disposeHandle(handle: PluginHandle): void {
  for (const dispose of [...handle.disposers].reverse()) {
    try {
      dispose();
    } catch (error) {
      console.error(`[plugins] ${handle.manifest.id} disposer threw`, error);
    }
  }
}

const CRASH_QUARANTINE_THRESHOLD = 3;

interface ActivePlugin {
  handle: PluginHandle;
  /** Cleanup returned by activate (runs before the disposer stack). */
  cleanup?: Disposer;
  /** Blob URL the JS bundle was imported from, revoked on unload. */
  blobUrl?: string;
}

const active = new Map<string, ActivePlugin>();
/** Ids with a loadPlugin call between its first await and completion —
 *  the re-entrancy guard `active` can't provide before `active.set` runs. */
const loading = new Set<string>();
const crashCounts: Record<string, number> = {};
const states = new Map<string, PluginRuntimeEntry>();
const stateListeners = new Set<() => void>();
let statesSnapshot: readonly PluginRuntimeEntry[] = [];

function setState(id: string, state: PluginRuntimeState, error?: string) {
  states.set(id, { id, state, error });
  statesSnapshot = [...states.values()];
  for (const l of stateListeners) l();
}

export function subscribePluginStates(listener: () => void): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

export function getPluginStatesSnapshot(): readonly PluginRuntimeEntry[] {
  return statesSnapshot;
}

export function getPluginState(id: string): PluginRuntimeState | undefined {
  return states.get(id)?.state;
}

/** Set while the document is going away; cleared if the page is restored from
 *  the page cache. Nothing about a failure observed in that window is the
 *  plugin's fault. */
let pageUnloading = false;
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    pageUnloading = true;
  });
  window.addEventListener("pageshow", () => {
    pageUnloading = false;
  });
}

function fail(handleCtxId: string, backend: LoaderBackend, error: unknown, quarantine: boolean) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[plugins] ${handleCtxId} failed:`, error);
  // Quarantine is sticky: every later boot skips a quarantined id until the
  // user re-enables it. So persist it only for faults of the plugin itself —
  // a load that fails while the document is being torn down (dev-server
  // reload, window close) failed because the page went away, and the next
  // boot re-attempts it anyway.
  const persisted = quarantine && !pageUnloading;
  if (persisted) void backend.quarantine(handleCtxId, message).catch(() => {});
  setState(handleCtxId, persisted ? "quarantined" : "failed", message);
}

/** True for a module *transport* failure, false for anything the bundle itself
 *  is answerable for: syntax errors keep their SyntaxError type and an
 *  evaluation error keeps the plugin's own error, so only a failed/aborted
 *  module fetch is retried and a throwing bundle is never re-evaluated. */
function isModuleFetchFailure(error: unknown): boolean {
  // WebKit rejects with TypeError "Importing a module script failed." /
  // "Load failed"; Chromium with "Failed to fetch dynamically imported
  // module: <url>".
  return error instanceof TypeError;
}

// Dynamic import is irreplaceable here: the specifier is a blob URL minted
// from bytes the Rust side read off disk — a static import cannot exist for
// content only known at runtime (rule exception: plugin loading).
async function importBlobOnce(code: string): Promise<Record<string, unknown>> {
  const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
  try {
    return await import(/* @vite-ignore */ url);
  } finally {
    // The module graph holds the evaluated code; revoking only releases the
    // URL string mapping. Reload creates a fresh blob URL, so no cache-key
    // collisions across reloads.
    URL.revokeObjectURL(url);
  }
}

/** Import the bundle as an ESM module from a blob URL, with one retry on a
 *  fresh blob URL: a module fetch can be aborted by transient host conditions
 *  (page teardown, a blocked/aborted blob fetch) that say nothing about the
 *  bundle, and quarantining on the first abort permanently disables a healthy
 *  plugin. A persistent cause (blocked blob: CSP, missing bytes) fails both
 *  attempts and still quarantines. */
async function importBlob(code: string): Promise<Record<string, unknown>> {
  try {
    return await importBlobOnce(code);
  } catch (error) {
    if (!isModuleFetchFailure(error)) throw error;
    console.warn("[plugins] module script fetch failed; retrying once", error);
    return await importBlobOnce(code);
  }
}

export interface LoadablePlugin {
  /** PluginInfo from the backend for installed plugins; synthesized for
   *  builtins. */
  info: PluginInfo;
  /** Full manifest for builtins. Required with builtinActivate: the backend
   *  record for a builtin id carries no manifest fields (empty version/tier),
   *  so building the manifest from `info` would fail validation. */
  manifest?: PluginManifest;
  /** Builtin activate function; absent → load from the plugin directory.
   *  Builtins ship compiled with the host but run through the exact same
   *  PluginContext pipeline. (None currently: usage-stats ships as a real
   *  external plugin in its own repo — plugins must stay decoupled from the
   *  host tree, plan ADR-2/ADR-4.) */
  builtinActivate?: (ctx: PluginHandle["ctx"]) => void | Disposer;
}

export async function loadPlugin(
  plugin: LoadablePlugin,
  backend: LoaderBackend = ipcBackend,
): Promise<void> {
  const { info } = plugin;
  const id = info.id;
  // Re-entrancy guard: `loading` is set synchronously before the first
  // await, so two concurrent loads of the same id can't both pass the check
  // and double-activate (orphaning the first handle's disposer stack). The
  // finally below clears it, so a failed load stays retryable.
  if (active.has(id) || loading.has(id)) return;
  if (info.quarantined) {
    setState(id, "quarantined", info.lastError ?? undefined);
    return;
  }
  loading.add(id);
  try {
    const appVersion = await backend.appVersion();
    if (info.minAppVersion && compareVersions(info.minAppVersion, appVersion) > 0) {
      setState(id, "incompatible", `requires app ≥ ${info.minAppVersion}`);
      return;
    }
    setState(id, "loading");
    // Hoisted so the catch can unwind registrations an activate made before
    // throwing — otherwise its CSS/settings/bus listeners leak while the
    // plugin shows quarantined.
    let handle: PluginHandle | undefined;
    try {
      let manifest: PluginManifest;
      let builtinCleanup: void | Disposer = undefined;
      if (plugin.builtinActivate) {
        if (!plugin.manifest) throw new Error(`builtin plugin ${id} must carry its manifest`);
        manifest = plugin.manifest;
      } else {
        manifest = JSON.parse(await backend.readFile(id, "manifest.json")) as PluginManifest;
      }
      const problems = validateManifest(manifest);
      if (problems.length > 0) throw new Error(`invalid manifest: ${problems.join("; ")}`);
      // SDK version handshake (plan §5.1 sdkVersion): a plugin built against an
      // incompatible contract range is disabled, never loaded — same treatment
      // as minAppVersion, one layer down (contract vs app).
      if (!satisfiesSdkRange(manifest.sdkVersion, SDK_VERSION)) {
        setState(id, "incompatible", `requires sdk ${manifest.sdkVersion} (host ${SDK_VERSION})`);
        return;
      }

      const newHandle = createPluginContext(manifest, backend, { appVersion });
      handle = newHandle;
      if (manifest.tier === "declarative") {
        // Bundle styles.css: injected like the js branch below — it is the
        // install-time-reviewed artifact, not a runtime permission-gated API
        // call, so a declarative plugin needs no theme permission for it.
        let stylesCss: string | undefined;
        try {
          stylesCss = await backend.readFile(id, "styles.css");
        } catch {
          // styles.css is optional.
        }
        if (stylesCss) injectBundleCss(newHandle, stylesCss);
        runAsPlugin(() => applyDeclarativePlugin(newHandle));
      } else if (plugin.builtinActivate) {
        builtinCleanup = runAsPlugin(() => plugin.builtinActivate!(newHandle.ctx));
      } else {
        // Bundle styles.css (Obsidian three-file convention): injected for js
        // plugins too — it's the install-time-reviewed artifact, not a runtime
        // permission-gated API call. Optional file; absence is fine, but a
        // remote-reference violation fails the load.
        let stylesCss: string | undefined;
        try {
          stylesCss = await backend.readFile(id, "styles.css");
        } catch {
          // styles.css is optional.
        }
        if (stylesCss) injectBundleCss(newHandle, stylesCss);
        const code = await backend.readFile(id, "main.js");
        const mod = await importBlob(code);
        if (typeof mod.default !== "function") {
          throw new Error("main.js must `export default function activate(ctx)`");
        }
        builtinCleanup = runAsPlugin(() => (mod.default as (c: unknown) => void | Disposer)(newHandle.ctx));
      }
      active.set(id, {
        handle: newHandle,
        cleanup: typeof builtinCleanup === "function" ? builtinCleanup : undefined,
      });
      setState(id, "active");
    } catch (error) {
      if (handle) disposeHandle(handle);
      fail(id, backend, error, true);
    }
  } finally {
    loading.delete(id);
  }
}

/** Unload: activate cleanup first, then context registrations reversed. A
 *  throwing disposer is logged and unwinding continues — partial teardown
 *  must never strand the rest of the stack. */
export function unloadPlugin(id: string): void {
  const entry = active.get(id);
  if (!entry) return;
  active.delete(id);
  if (entry.cleanup) {
    try {
      runAsPlugin(entry.cleanup);
    } catch (error) {
      console.error(`[plugins] ${id} cleanup threw`, error);
    }
  }
  disposeHandle(entry.handle);
  setState(id, "installed");
}

export async function reloadPlugin(
  plugin: LoadablePlugin,
  backend: LoaderBackend = ipcBackend,
): Promise<void> {
  unloadPlugin(plugin.info.id);
  await loadPlugin(plugin, backend);
}

/** Render-crash report from PluginBoundary: the count is cumulative across
 *  mount points (a plugin rendering in N places racks up crashes from all of
 *  them) and resets on a successful mount via notePluginRenderOk — past the
 *  threshold the plugin is quarantined so one bad render can't loop-crash
 *  the host session. */
export function reportPluginCrash(id: string, error: unknown, backend: LoaderBackend = ipcBackend) {
  crashCounts[id] = (crashCounts[id] ?? 0) + 1;
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[plugins] ${id} render crashed (${crashCounts[id]}×)`, error);
  if (crashCounts[id] >= CRASH_QUARANTINE_THRESHOLD && active.has(id)) {
    unloadPlugin(id);
    void backend.quarantine(id, `render crashed ${crashCounts[id]}×: ${message}`).catch(() => {});
    setState(id, "quarantined", message);
  }
}

/** Successful activation resets the crash counter. */
export function notePluginRenderOk(id: string) {
  crashCounts[id] = 0;
}

/** Uninstall-only prune (the manager's uninstall path): crash counts and the
 *  state entry are per-install runtime data with no meaning once the plugin
 *  is gone. NOT for disable/unload — crash counting must survive reloads so
 *  a crash-looping plugin still quarantines across them. */
export function prunePluginRuntimeState(id: string): void {
  delete crashCounts[id];
  if (states.delete(id)) {
    statesSnapshot = [...states.values()];
    for (const l of stateListeners) l();
  }
}

let bootstrapped = false;
let bootstrapInFlight: Promise<PluginInfo[]> | null = null;

/** True once a full bootstrap pass has listed the backend and run the load
 *  loop. The manager store reads this to re-kick bootstrap when the startup
 *  attempt gave up (slow/absent backend) before the user opened 插件管理. */
export function pluginsBootstrapped(): boolean {
  return bootstrapped;
}

/**
 * Bootstrap the loader (plan §4.1): one-time hardening + event bridge, then
 * activate every enabled builtin/installed plugin.
 *
 * Retry contract: `bootstrapped` flips only after the backend list
 * succeeded and the load loop ran. A list failure (slow backend at startup,
 * web bridge not yet up) rejects the returned promise and leaves bootstrap
 * re-callable — the caller retries (startup backoff) or the manager store
 * re-kicks on open. Concurrent callers share one in-flight pass; per-plugin
 * load errors are isolated (loadPlugin self-reports failed/quarantined) so
 * one bad plugin never strands the rest.
 */
export function bootstrapPlugins(
  backend: LoaderBackend = ipcBackend,
  builtins: LoadablePlugin[] = [],
): Promise<PluginInfo[]> {
  if (bootstrapped) return backend.list();
  bootstrapInFlight ??= doBootstrap(backend, builtins)
    .then((installed) => {
      bootstrapped = true;
      return installed;
    })
    .finally(() => {
      bootstrapInFlight = null;
    });
  return bootstrapInFlight;
}

async function doBootstrap(
  backend: LoaderBackend,
  builtins: LoadablePlugin[],
): Promise<PluginInfo[]> {
  installHardening();
  bridgeUsageEvents();
  bridgePluginAgentEvents();
  // Backend listing is best-effort for builtins: a corrupt plugins.json must
  // not take builtin plugins down with it. But a failed list is a transient
  // startup condition, not a terminal one — load builtins, then rethrow so
  // the caller's retry can load the installed plugins it never saw.
  let installed: PluginInfo[] = [];
  let listError: unknown = null;
  try {
    installed = await backend.list();
  } catch (error) {
    listError = error;
    console.error("[plugins] backend list failed; builtins still load", error);
  }
  const byId: Record<string, PluginInfo> = {};
  for (const info of installed) byId[info.id] = info;
  // Plugin loads are independent of each other — per-id state maps, scoped
  // registry keys, per-plugin <style> tags — so each group loads
  // concurrently. The two groups stay phased (builtins first), and every
  // plugin keeps its own try/catch so one bad plugin never strands the rest.
  // Builtin state rides the same plugins.json record (source "builtin");
  // absent record = enabled, never quarantined.
  await Promise.all(
    builtins.map(async (builtin) => {
      const record = byId[builtin.info.id];
      const info = {
        ...builtin.info,
        enabled: record?.enabled ?? true,
        quarantined: record?.quarantined ?? false,
        lastError: record?.lastError ?? null,
      };
      try {
        if (info.enabled)
          await loadPlugin(
            { info, manifest: builtin.manifest, builtinActivate: builtin.builtinActivate },
            backend,
          );
        else setState(info.id, "installed");
      } catch (error) {
        console.error(`[plugins] bootstrap load of ${info.id} threw`, error);
      }
    }),
  );
  await Promise.all(
    installed.map(async (info) => {
      if (info.source === "builtin") return; // handled above
      try {
        if (info.enabled) await loadPlugin({ info }, backend);
        else setState(info.id, "installed");
      } catch (error) {
        // Reached only when loadPlugin itself rejects outside its own error
        // handling (e.g. the app-version probe); the next retry re-attempts.
        console.error(`[plugins] bootstrap load of ${info.id} threw`, error);
      }
    }),
  );
  if (listError) throw listError;
  return installed;
}
