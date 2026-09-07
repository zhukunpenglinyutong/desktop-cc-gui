import { convertFileSrc, invoke as tauriInvoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { isWeb, serverVersion, webToken } from "./transport";

export { isWeb } from "./transport";

/**
 * Platform shims for the few places that touch native APIs outside the
 * invoke/listen surface. Each has a browser fallback used in web-access mode.
 */

/** Open a URL in the system browser (new tab in web mode). */
export function openExternal(url: string) {
  if (isWeb) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  void tauriInvoke("plugin:opener|open_url", { url }).catch(() => {});
}

/** App version: bundle metadata natively, bridge hello frame on web. */
export function getAppVersion(): Promise<string | null> {
  if (isWeb) return serverVersion();
  return getVersion().catch(() => null);
}

/**
 * Absolute filesystem path → URL loadable by an <img>. Native uses the asset
 * protocol; web mode uses the bridge's scoped /file route (same $HOME scope,
 * see web.rs).
 */
export function fileUrl(path: string): string {
  if (isWeb) {
    return `/file?path=${encodeURIComponent(path)}&token=${encodeURIComponent(webToken ?? "")}`;
  }
  return convertFileSrc(path);
}

/** Webview zoom is a no-op on web — browsers have native pinch/⌘± zoom. */
export function setWebviewZoom(fraction: number) {
  if (isWeb) return;
  // getCurrentWebview throws synchronously outside a Tauri webview; the bar
  // still renders, zoom just stays inert.
  try {
    void getCurrentWebview()
      .setZoom(fraction)
      .catch(() => {});
  } catch {}
}

/** Titlebar drag is desktop-only. */
export function startWindowDrag() {
  if (isWeb) return;
  void getCurrentWindow().startDragging();
}

/**
 * Directory picker: native dialog on desktop; on web there is no filesystem
 * dialog, so fall back to typing the absolute path.
 */
export async function pickDirectory(title: string): Promise<string | null> {
  if (isWeb) {
    const entered = window.prompt(title);
    const trimmed = entered?.trim();
    return trimmed ? trimmed : null;
  }
  const selected = await openDialog({ directory: true, multiple: false, title });
  const path = Array.isArray(selected) ? selected[0] : selected;
  return path ?? null;
}
