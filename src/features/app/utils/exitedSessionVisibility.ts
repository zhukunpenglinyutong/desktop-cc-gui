import { getClientStoreSync, writeClientStoreValue } from "../../../services/clientStorage";

const HIDDEN_EXITED_SESSIONS_KEY = "sidebarExitedSessionsHiddenByWorkspacePath";

export type HiddenExitedSessionsByWorkspacePath = Record<string, true>;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripFileUri(path: string): string {
  const trimmed = path.trim();
  if (!trimmed.toLowerCase().startsWith("file://")) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    const pathname = decodeURIComponent(url.pathname || "");
    const host = decodeURIComponent(url.hostname || "");
    if (!pathname) {
      return trimmed;
    }
    if (/^[A-Za-z]$/.test(host) && pathname.startsWith("/")) {
      return `${host.toUpperCase()}:${pathname}`;
    }
    if (host && host.toLowerCase() !== "localhost") {
      return `//${host}${pathname}`;
    }
    if (/^\/[A-Za-z]:\//.test(pathname)) {
      return pathname.slice(1);
    }
    return pathname;
  } catch {
    return trimmed;
  }
}

function normalizeWindowsExtendedPath(path: string): string {
  if (path.startsWith("\\\\?\\UNC\\")) {
    return `//${path.slice("\\\\?\\UNC\\".length).replace(/\\/g, "/")}`;
  }
  if (path.startsWith("\\\\?\\")) {
    return path.slice("\\\\?\\".length);
  }
  if (path.startsWith("//?/UNC/")) {
    return `//${path.slice("//?/UNC/".length)}`;
  }
  if (path.startsWith("//?/")) {
    return path.slice("//?/".length);
  }
  return path;
}

function isWindowsLikePath(path: string): boolean {
  return /^[A-Za-z]:\//.test(path) || path.startsWith("//");
}

export function normalizeExitedSessionWorkspacePath(path: string): string {
  const strippedPath = stripFileUri(path).trim();
  if (!strippedPath) {
    return "";
  }

  const normalizedPath = normalizeWindowsExtendedPath(strippedPath)
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");

  if (!normalizedPath) {
    return "";
  }

  return isWindowsLikePath(normalizedPath)
    ? normalizedPath.toLowerCase()
    : normalizedPath;
}

export function loadHiddenExitedSessionsByWorkspacePath(): HiddenExitedSessionsByWorkspacePath {
  const raw = getClientStoreSync<unknown>("threads", HIDDEN_EXITED_SESSIONS_KEY);
  if (!isPlainRecord(raw)) {
    return {};
  }

  const normalized: HiddenExitedSessionsByWorkspacePath = {};
  Object.entries(raw).forEach(([workspacePath, hidden]) => {
    const normalizedPath = normalizeExitedSessionWorkspacePath(workspacePath);
    if (normalizedPath && hidden === true) {
      normalized[normalizedPath] = true;
    }
  });
  return normalized;
}

export function isExitedSessionsHiddenForWorkspacePath(
  hiddenByWorkspacePath: HiddenExitedSessionsByWorkspacePath,
  workspacePath: string,
): boolean {
  const normalizedPath = normalizeExitedSessionWorkspacePath(workspacePath);
  return normalizedPath ? hiddenByWorkspacePath[normalizedPath] === true : false;
}

export function updateHiddenExitedSessionsByWorkspacePath(
  current: HiddenExitedSessionsByWorkspacePath,
  workspacePath: string,
  hidden: boolean,
): HiddenExitedSessionsByWorkspacePath {
  const normalizedPath = normalizeExitedSessionWorkspacePath(workspacePath);
  if (!normalizedPath) {
    return current;
  }

  if (!hidden) {
    if (!(normalizedPath in current)) {
      return current;
    }
    const next = { ...current };
    delete next[normalizedPath];
    return next;
  }

  if (current[normalizedPath] === true) {
    return current;
  }

  return {
    ...current,
    [normalizedPath]: true,
  };
}

export function persistHiddenExitedSessionsByWorkspacePath(
  hiddenByWorkspacePath: HiddenExitedSessionsByWorkspacePath,
): void {
  writeClientStoreValue("threads", HIDDEN_EXITED_SESSIONS_KEY, hiddenByWorkspacePath);
}
