export type RewindWorkspaceGitState = {
  isGitRepository: boolean;
  hasDetectedChanges: boolean;
};

type GitStatusSnapshot = {
  error: string | null;
  files: Array<unknown>;
};

function isNonGitRepositoryError(error: string | null | undefined): boolean {
  if (!error) {
    return false;
  }
  const normalized = error.toLowerCase();
  return (
    normalized.includes("could not find repository") ||
    normalized.includes("not a git repository") ||
    normalized.includes("class=repository") ||
    normalized.includes("code=notfound") ||
    normalized.includes("repository not found") ||
    normalized.includes("git root not found")
  );
}

export function deriveRewindWorkspaceGitState(
  gitStatus: GitStatusSnapshot,
): RewindWorkspaceGitState {
  const isKnownGitRepository =
    !gitStatus.error || !isNonGitRepositoryError(gitStatus.error);

  return {
    isGitRepository: isKnownGitRepository,
    hasDetectedChanges:
      isKnownGitRepository &&
      gitStatus.error === null &&
      gitStatus.files.length > 0,
  };
}
