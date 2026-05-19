export function normalizeGovernancePath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/^\.\/+/, "");
}

export function hasGovernancePath(
  files: readonly string[],
  candidatePath: string,
): boolean {
  const normalizedCandidate = normalizeGovernancePath(candidatePath);
  return files.some((file) => normalizeGovernancePath(file) === normalizedCandidate);
}

