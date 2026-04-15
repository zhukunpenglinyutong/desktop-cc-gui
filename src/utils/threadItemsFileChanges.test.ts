import { describe, expect, it } from "vitest";
import type { ConversationItem } from "../types";
import {
  inferFileChangesFromCommandExecutionArtifacts,
  inferFileChangesFromPayload,
  mergeToolChanges,
  normalizeFileChangeKind,
} from "./threadItemsFileChanges";

type ToolChanges = NonNullable<Extract<ConversationItem, { kind: "tool" }>["changes"]>;

describe("threadItemsFileChanges.mergeToolChanges", () => {
  it("prefers local specific kind when remote kind is modified", () => {
    const remote: ToolChanges = [
      { path: "src/App.tsx", kind: "modified" },
    ];
    const local: ToolChanges = [
      { path: "src/App.tsx", kind: "add" },
    ];

    const merged = mergeToolChanges(remote, local);

    expect(merged?.[0]?.kind).toBe("add");
  });

  it("keeps remote add/delete/rename kinds when already specific", () => {
    const remote: ToolChanges = [
      { path: "src/App.tsx", kind: "delete" },
    ];
    const local: ToolChanges = [
      { path: "src/App.tsx", kind: "modified" },
    ];

    const merged = mergeToolChanges(remote, local);

    expect(merged?.[0]?.kind).toBe("delete");
  });

  it("falls back to local normalized kind when remote kind is unknown", () => {
    const remote: ToolChanges = [
      { path: "src/App.tsx", kind: "unknown-kind" },
    ];
    const local: ToolChanges = [
      { path: "src/App.tsx", kind: "D" },
    ];

    const merged = mergeToolChanges(remote, local);

    expect(merged?.[0]?.kind).toBe("delete");
  });

  it("normalizes U to modified", () => {
    expect(normalizeFileChangeKind("U")).toBe("modified");
  });

  it("parses concise status lines from string payload", () => {
    const inferred = inferFileChangesFromPayload(
      [
        "(A) src/new-file.ts",
        "(U) src/existing-file.ts",
        "(D) src/removed-file.ts",
      ].join("\n"),
    );

    expect(inferred).toEqual([
      { path: "src/new-file.ts", kind: "add", diff: undefined },
      { path: "src/existing-file.ts", kind: "modified", diff: undefined },
      { path: "src/removed-file.ts", kind: "delete", diff: undefined },
    ]);
  });

  it("parses git porcelain two-letter statuses from command output", () => {
    const inferred = inferFileChangesFromCommandExecutionArtifacts(
      "git status --short",
      [
        "MM src/App.tsx",
        "?? src/new-file.ts",
        "R  src/old-name.ts -> src/new-name.ts",
      ].join("\n"),
    );

    expect(inferred).toEqual([
      { path: "src/App.tsx", kind: "modified", diff: undefined },
      { path: "src/new-file.ts", kind: "add", diff: undefined },
      {
        path: "src/new-name.ts",
        kind: "rename",
        diff: [
          "*** Begin Patch",
          "*** Update File: src/old-name.ts",
          "*** Move to: src/new-name.ts",
          "*** End Patch",
        ].join("\n"),
      },
    ]);
  });

  it("infers deleted file paths from rm-style command execution", () => {
    const inferred = inferFileChangesFromCommandExecutionArtifacts(
      '删除文件 · rm "/Users/demo/repo/SPEC_KIT_实战指南.md" && echo done',
      "",
    );

    expect(inferred).toEqual([
      {
        path: "/Users/demo/repo/SPEC_KIT_实战指南.md",
        kind: "delete",
        diff: undefined,
      },
    ]);
  });

  it("infers added file paths from shell redirection command execution", () => {
    const inferred = inferFileChangesFromCommandExecutionArtifacts(
      "printf '100' > /Users/demo/repo/abc.txt",
      "",
    );

    expect(inferred).toEqual([
      {
        path: "/Users/demo/repo/abc.txt",
        kind: "add",
        diff: undefined,
      },
    ]);
  });

  it("infers added file paths from no-space redirection command execution", () => {
    const inferred = inferFileChangesFromCommandExecutionArtifacts(
      "echo 100>/Users/demo/repo/abc-no-space.txt",
      "",
    );

    expect(inferred).toEqual([
      {
        path: "/Users/demo/repo/abc-no-space.txt",
        kind: "add",
        diff: undefined,
      },
    ]);
  });

  it("treats append redirection as modified to avoid destructive false add", () => {
    const inferred = inferFileChangesFromCommandExecutionArtifacts(
      "echo 100 >> /Users/demo/repo/existing.txt",
      "",
    );

    expect(inferred).toEqual([
      {
        path: "/Users/demo/repo/existing.txt",
        kind: "modified",
        diff: undefined,
      },
    ]);
  });
});
