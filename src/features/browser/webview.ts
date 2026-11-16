import { invoke, isWeb, listen } from "@/lib/transport";

/** Thin IPC layer over the Rust child-webview commands in
 * src-tauri/src/browser.rs. Everything is a no-op in web-access mode: the
 * pane there renders the desktop-only notice and never calls these. */

export interface WebviewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Coalesce concurrent creates for the same tab. Creation is async in the
 * native layer, so React StrictMode's double effect (or a bounds-change
 * retry during startup) must not race two add_child calls with one label. */
const pendingCreates = new Map<string, Promise<void>>();

export function createBrowserWebview(id: string, url: string, rect: WebviewRect): Promise<void> {
  if (isWeb) return Promise.resolve();
  const pending = pendingCreates.get(id);
  if (pending) return pending;
  const creation = invoke<void>("browser_create", { id, url, ...rect });
  pendingCreates.set(id, creation);
  const clear = () => {
    if (pendingCreates.get(id) === creation) pendingCreates.delete(id);
  };
  creation.then(clear, clear);
  return creation;
}

export async function closeBrowserWebview(id: string): Promise<void> {
  if (isWeb) return Promise.resolve();
  // Creating is async now; a tab can be closed before add_child settles. Wait
  // for that create so the new native webview cannot outlive its tab.
  await pendingCreates.get(id)?.catch(() => {});
  // Late invocations can land after the native side already closed the
  // webview (tab close races an unmount); "not found" is not an error here.
  return invoke<void>("browser_close", { id }).catch(() => {});
}

export function setBrowserWebviewBounds(id: string, rect: WebviewRect): Promise<void> {
  if (isWeb) return Promise.resolve();
  return invoke<void>("browser_set_bounds", { id, ...rect });
}

export function setBrowserWebviewVisible(id: string, visible: boolean): Promise<void> {
  if (isWeb) return Promise.resolve();
  return invoke<void>("browser_set_visible", { id, visible }).catch(() => {});
}

export async function navigateBrowserWebview(id: string, url: string): Promise<void> {
  if (isWeb) return;
  // A coalesced create keeps its first URL, and navigating before it lands
  // hits "not found": wait so an address submitted mid-create still applies.
  await pendingCreates.get(id)?.catch(() => {});
  return invoke<void>("browser_navigate", { id, url });
}

export function browserGoBack(id: string): Promise<void> {
  if (isWeb) return Promise.resolve();
  return invoke<void>("browser_go_back", { id }).catch(() => {});
}

export function browserGoForward(id: string): Promise<void> {
  if (isWeb) return Promise.resolve();
  return invoke<void>("browser_go_forward", { id }).catch(() => {});
}

export function browserReload(id: string): Promise<void> {
  if (isWeb) return Promise.resolve();
  return invoke<void>("browser_reload", { id }).catch(() => {});
}

/** Current URL from the native webview (tracks SPA pushState); null when
 * the webview is gone. Polled only while the tab is active. */
export function browserCurrentUrl(id: string): Promise<string | null> {
  if (isWeb) return Promise.resolve(null);
  return invoke<string | null>("browser_current_url", { id }).catch(() => null);
}

/** Subscribe to native navigation events (payload: {id, url}). */
export function listenBrowserNav(cb: (id: string, url: string) => void): Promise<() => void> {
  return listen<{ id: string; url: string }>("browser-tab-nav", (e) => cb(e.payload.id, e.payload.url));
}

/** Subscribe to document-title events (payload: {id, title}). */
export function listenBrowserTitle(cb: (id: string, title: string) => void): Promise<() => void> {
  return listen<{ id: string; title: string }>("browser-tab-title", (e) =>
    cb(e.payload.id, e.payload.title),
  );
}
