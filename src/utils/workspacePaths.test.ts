import { describe, expect, it } from "vitest";
import {
  resolveFileReadTarget,
  resolveDiffPathFromWorkspacePath,
  resolveWorkspaceRelativePath,
} from "./workspacePaths";

describe("workspacePaths", () => {
  it("resolves Windows workspace-relative paths case-insensitively", () => {
    expect(
      resolveWorkspaceRelativePath(
        "C:/Users/Chen/Project",
        "c:/users/chen/project/src/App.tsx",
      ),
    ).toBe("src/App.tsx");
  });

  it("resolves mac-style absolute paths without changing relative behavior", () => {
    expect(
      resolveWorkspaceRelativePath(
        "/Users/chen/project",
        "/Users/chen/project/src/App.tsx",
      ),
    ).toBe("src/App.tsx");
  });

  it("matches diff paths case-insensitively for Windows tool output", () => {
    expect(
      resolveDiffPathFromWorkspacePath(
        "c:/users/chen/project/src/App.tsx",
        ["src/app.tsx", "src/other.ts"],
        "C:/Users/Chen/Project",
      ),
    ).toBe("src/app.tsx");
  });

  it("routes absolute path under external spec root to external-spec domain", () => {
    expect(
      resolveFileReadTarget(
        "/repo",
        "/spec-root/openspec/changes/fix/tasks.md",
        "/spec-root",
      ),
    ).toEqual({
      domain: "external-spec",
      normalizedInputPath: "/spec-root/openspec/changes/fix/tasks.md",
      workspaceRelativePath: "/spec-root/openspec/changes/fix/tasks.md",
      externalSpecLogicalPath: "openspec/changes/fix/tasks.md",
    });
  });

  it("matches Windows external spec root paths case-insensitively", () => {
    expect(
      resolveFileReadTarget(
        "C:/Users/Chen/Project",
        "c:/spec-disk/openspec/changes/fix/tasks.md",
        "C:/Spec-Disk/OpenSpec",
      ),
    ).toEqual({
      domain: "external-spec",
      normalizedInputPath: "c:/spec-disk/openspec/changes/fix/tasks.md",
      workspaceRelativePath: "c:/spec-disk/openspec/changes/fix/tasks.md",
      externalSpecLogicalPath: "openspec/changes/fix/tasks.md",
    });
  });

  it("supports Windows project root custom spec paths", () => {
    expect(
      resolveFileReadTarget(
        "C:/Users/Chen/Project",
        "c:/spec-disk/openspec/changes/fix/tasks.md",
        "C:/Spec-Disk",
      ),
    ).toEqual({
      domain: "external-spec",
      normalizedInputPath: "c:/spec-disk/openspec/changes/fix/tasks.md",
      workspaceRelativePath: "c:/spec-disk/openspec/changes/fix/tasks.md",
      externalSpecLogicalPath: "openspec/changes/fix/tasks.md",
    });
  });

  it("marks unsupported absolute paths outside workspace and spec root", () => {
    expect(
      resolveFileReadTarget(
        "/repo",
        "/another-project/src/App.tsx",
        "/spec-root",
      ),
    ).toEqual({
      domain: "unsupported-external",
      normalizedInputPath: "/another-project/src/App.tsx",
      workspaceRelativePath: "/another-project/src/App.tsx",
    });
  });
});
