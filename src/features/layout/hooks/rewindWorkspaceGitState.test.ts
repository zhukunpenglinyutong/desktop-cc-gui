import { describe, expect, it } from "vitest";
import { deriveRewindWorkspaceGitState } from "./rewindWorkspaceGitState";

describe("deriveRewindWorkspaceGitState", () => {
  it("treats non-git repository errors as non-git workspaces", () => {
    expect(
      deriveRewindWorkspaceGitState({
        error: "fatal: not a git repository (or any of the parent directories): .git",
        files: [],
      }),
    ).toEqual({
      isGitRepository: false,
      hasDetectedChanges: false,
    });
  });

  it("does not hide file rewind UI when git status fails inside a git workspace", () => {
    expect(
      deriveRewindWorkspaceGitState({
        error: "failed to refresh git status: permission denied",
        files: [],
      }),
    ).toEqual({
      isGitRepository: true,
      hasDetectedChanges: false,
    });
  });

  it("marks a known git repository as clean only when git status succeeds with no changes", () => {
    expect(
      deriveRewindWorkspaceGitState({
        error: null,
        files: [],
      }),
    ).toEqual({
      isGitRepository: true,
      hasDetectedChanges: false,
    });
  });

  it("marks a known git repository as dirty when git status succeeds with changed files", () => {
    expect(
      deriveRewindWorkspaceGitState({
        error: null,
        files: [{ path: "src/app.ts" }],
      }),
    ).toEqual({
      isGitRepository: true,
      hasDetectedChanges: true,
    });
  });
});
