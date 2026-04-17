export type RewindMode =
  | "messages-and-files"
  | "messages-only"
  | "files-only";

export function normalizeRewindMode(mode?: RewindMode | null): RewindMode {
  if (mode === "messages-only" || mode === "files-only") {
    return mode;
  }
  return "messages-and-files";
}

export function shouldRewindMessages(mode?: RewindMode | null): boolean {
  return normalizeRewindMode(mode) !== "files-only";
}

export function shouldRestoreWorkspaceFiles(mode?: RewindMode | null): boolean {
  return normalizeRewindMode(mode) !== "messages-only";
}
