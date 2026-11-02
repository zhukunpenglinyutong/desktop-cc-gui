import { IS_WINDOWS } from "@/lib/platform";
import { invoke } from "./transport";

/** A preview root handed out by `preview_open`: the token names the file's
 *  directory on the backend; `name` is the file inside it. */
export interface PreviewTarget {
  token: string;
  name: string;
}

/**
 * Rendered-preview URL for a file under a preview root, backed by the app's
 * own `ccgui-preview` protocol (src-tauri/src/preview_protocol.rs).
 *
 * The URL never carries the absolute path: the backend serves only the
 * directory the token was issued for, so a previewed page can resolve its
 * relative stylesheets, scripts and images (`draft.css` next to
 * `index.html`) but cannot walk up to the rest of the home directory. The
 * slashes after the token stay real, which keeps relative references working
 * like any web page.
 *
 * Desktop only — the preview tab is not offered in web-access mode.
 */
export function previewUrl(target: PreviewTarget): string {
  const origin = IS_WINDOWS
    ? "http://ccgui-preview.localhost"
    : "ccgui-preview://localhost";
  return `${origin}/${encodeURIComponent(target.token)}/${encodeURIComponent(target.name)}`;
}

/** Scope a preview to `path`'s directory and return the URL to render. The
 *  backend applies the same workspace boundary as `read_file`. */
export async function openFilePreview(path: string): Promise<string> {
  const target = await invoke<PreviewTarget>("preview_open", { path });
  return previewUrl(target);
}
