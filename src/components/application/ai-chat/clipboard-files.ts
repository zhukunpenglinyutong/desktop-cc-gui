/**
 * Clipboard file reads shared by the composer's paste handler.
 *
 * A paste of files copied in Finder / Explorer reaches the webview as opaque
 * `File` blobs (images keep usable bytes) or as `text/uri-list` entries on
 * GTK-style clipboards; the absolute path is never in the event on macOS and
 * Windows, where the host has to read the OS clipboard itself. This module
 * only classifies what the event does expose.
 */

export interface ClipboardFilePayload {
  /** Image bytes on the clipboard; screenshots have no usable path. */
  imageFiles: File[];
  /** Non-image blobs: usable only where the host cannot read a path. */
  otherFiles: File[];
  /** Paths already exposed as `text/uri-list` file URLs. */
  uriPaths: string[];
}

/** Classify the file flavors a paste event exposes. */
export function readClipboardFiles(
  clipboardData: DataTransfer | null,
): ClipboardFilePayload {
  const imageFiles: File[] = [];
  const otherFiles: File[] = [];
  for (const item of Array.from(clipboardData?.items ?? [])) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (!file) continue;
    (item.type.startsWith("image/") ? imageFiles : otherFiles).push(file);
  }
  const uriPaths = filePathsFromUriList(clipboardData?.getData("text/uri-list") ?? "");
  return { imageFiles, otherFiles, uriPaths };
}

/** `text/uri-list` → absolute local paths, in list order. */
export function filePathsFromUriList(text: string): string[] {
  const paths: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const entry = line.trim();
    if (entry === "" || entry.startsWith("#")) continue;
    const path = fileUrlToPath(entry);
    if (path !== null) paths.push(path);
  }
  return paths;
}

/** One `file:` URL → absolute path. Web links and other schemes are not
 *  files and return null; so does a remote host (a network share pasted on
 *  Windows resolves through the native clipboard read instead). */
export function fileUrlToPath(url: string): string | null {
  if (!/^file:\/\//i.test(url)) return null;
  const rest = url.slice("file://".length);
  const slash = rest.indexOf("/");
  const host = slash === -1 ? rest : rest.slice(0, slash);
  if (host !== "" && host.toLowerCase() !== "localhost") return null;
  if (slash === -1) return null;
  let path: string;
  try {
    path = decodeURIComponent(rest.slice(slash));
  } catch {
    // Malformed escapes would produce a path that does not exist on disk;
    // skipping beats mentioning the wrong file.
    return null;
  }
  // `file:///C:/Users/x` carries a URL root that Windows does not have.
  if (/^\/[A-Za-z]:[\\/]/.test(path)) path = path.slice(1);
  return path === "" ? null : path;
}
