import { IS_WINDOWS } from "@/lib/platform";
import { isWeb, webToken } from "@/lib/transport";

function prefix(pluginId: string): string {
  const origin = isWeb
    ? `${window.location.origin}/plugin-asset/${encodeURIComponent(webToken ?? "-")}`
    : IS_WINDOWS
      ? "http://pluginasset.localhost"
      : "pluginasset://localhost";
  return `${origin}/${encodeURIComponent(pluginId)}`;
}

function relativePath(path: string): string {
  if (typeof path !== "string" || /[\\:\u0000-\u001f\u007f]/.test(path)) {
    throw new Error("asset path must be a forward-slash relative path");
  }
  const parts = path.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error("asset path must not be absolute or contain empty, . or .. segments");
  }
  return parts.map(encodeURIComponent).join("/");
}

export function fileAssetUrl(pluginId: string, source: "bundle" | "doc", path: string): string {
  return `${prefix(pluginId)}/${source}/${relativePath(path)}`;
}

export function directoryAssetUrl(pluginId: string, grantId: string, path: string): string {
  if (typeof grantId !== "string" || !/^[A-Za-z0-9_-]+$/.test(grantId)) {
    throw new Error("invalid asset directory grant id");
  }
  return `${prefix(pluginId)}/dir/${grantId}/${relativePath(path)}`;
}

/** Only the origin is opaque: keeping the pathname intact lets browser URL
 * resolution locate textures, audio and other sibling resources naturally. */
export function remoteAssetUrl(pluginId: string, url: URL): string {
  const origin = btoa(url.origin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${prefix(pluginId)}/remote/${origin}${url.pathname}${url.search}${url.hash}`;
}
