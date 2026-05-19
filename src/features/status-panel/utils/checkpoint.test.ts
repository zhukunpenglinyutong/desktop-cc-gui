import { describe, expect, it } from "vitest";
import type { ConversationItem } from "../../../types";
import type { CommandSummary, FileChangeSummary } from "../types";
import {
  buildCheckpointViewModel,
  resolveCheckpointGeneratedSummary,
  resolveCheckpointValidationProfile,
} from "./checkpoint";

const baseFileChanges: FileChangeSummary[] = [
  {
    filePath: "src/App.tsx",
    fileName: "App.tsx",
    status: "M",
    additions: 8,
    deletions: 2,
  },
];

function createCommand(
  id: string,
  command: string,
  status: CommandSummary["status"],
): CommandSummary {
  return { id, command, status };
}

describe("buildCheckpointViewModel", () => {
  it("marks checkpoint as blocked when a validation command fails", () => {
    const result = buildCheckpointViewModel({
      todos: [],
      subagents: [],
      fileChanges: baseFileChanges,
      commands: [createCommand("cmd-1", "npm run test", "error")],
      isProcessing: false,
    });

    expect(result.verdict).toBe("blocked");
    expect(result.evidence.validations.find((entry) => entry.kind === "tests")?.status).toBe(
      "fail",
    );
    expect(result.risks.map((entry) => entry.code)).toContain("validation_failed");
  });

  it("marks checkpoint as running while command execution is still in flight", () => {
    const result = buildCheckpointViewModel({
      todos: [],
      subagents: [],
      fileChanges: baseFileChanges,
      commands: [createCommand("cmd-1", "npm run lint", "running")],
      isProcessing: true,
    });

    expect(result.verdict).toBe("running");
    expect(result.evidence.validations.find((entry) => entry.kind === "lint")?.status).toBe(
      "running",
    );
    expect(result.policyAudit.map((entry) => entry.policyId)).toContain("corePolicy");
  });

  it("marks checkpoint as ready after core validations pass", () => {
    const result = buildCheckpointViewModel({
      todos: [],
      subagents: [],
      fileChanges: baseFileChanges,
      commands: [
        createCommand("cmd-1", "npm run lint", "completed"),
        createCommand("cmd-2", "npm run typecheck", "completed"),
        createCommand("cmd-3", "npm run test", "completed"),
      ],
      isProcessing: false,
    });

    expect(result.verdict).toBe("ready");
    expect(
      result.evidence.validations
        .filter((entry) => ["lint", "typecheck", "tests"].includes(entry.kind))
        .every((entry) => entry.status === "pass"),
    ).toBe(true);
  });

  it("surfaces not_run validations when files changed but checks never executed", () => {
    const result = buildCheckpointViewModel({
      todos: [],
      subagents: [],
      fileChanges: baseFileChanges,
      commands: [],
      isProcessing: false,
    });

    expect(result.verdict).toBe("needs_review");
    expect(result.evidence.validations.find((entry) => entry.kind === "lint")?.status).toBe(
      "not_run",
    );
    expect(result.evidence.validations.find((entry) => entry.kind === "build")?.status).toBe(
      "not_observed",
    );
    expect(result.risks.map((entry) => entry.code)).toContain("validation_missing");
  });

  it("uses Java validation semantics for Maven projects", () => {
    const result = buildCheckpointViewModel({
      todos: [],
      subagents: [],
      fileChanges: [
        {
          filePath: "pom.xml",
          fileName: "pom.xml",
          status: "M",
          additions: 2,
          deletions: 1,
        },
        {
          filePath: "src/main/java/com/example/App.java",
          fileName: "App.java",
          status: "M",
          additions: 8,
          deletions: 2,
        },
      ],
      commands: [],
      isProcessing: false,
    });

    expect(result.evidence.validations.find((entry) => entry.kind === "lint")?.status).toBe(
      "not_observed",
    );
    expect(result.evidence.validations.find((entry) => entry.kind === "typecheck")?.status).toBe(
      "not_observed",
    );
    expect(result.evidence.validations.find((entry) => entry.kind === "tests")?.status).toBe(
      "not_run",
    );
    expect(result.evidence.validations.find((entry) => entry.kind === "build")?.status).toBe(
      "not_run",
    );
    expect(result.risks.map((entry) => entry.code)).toContain("validation_missing");
  });

  it("uses cross-platform Gradle validation command suggestions", () => {
    const gradleFileChanges: FileChangeSummary[] = [
      {
        filePath: "build.gradle",
        fileName: "build.gradle",
        status: "M",
        additions: 2,
        deletions: 1,
      },
      {
        filePath: "src/main/java/com/example/App.java",
        fileName: "App.java",
        status: "M",
        additions: 8,
        deletions: 2,
      },
    ];
    const result = buildCheckpointViewModel({
      todos: [],
      subagents: [],
      fileChanges: gradleFileChanges,
      commands: [],
      isProcessing: false,
    });
    const profile = resolveCheckpointValidationProfile({
      commands: [],
      fileChanges: gradleFileChanges,
    });

    expect(result.evidence.validations.find((entry) => entry.kind === "tests")?.status).toBe(
      "not_run",
    );
    expect(result.evidence.validations.find((entry) => entry.kind === "build")?.status).toBe(
      "not_run",
    );
    expect(profile.commands).toMatchObject({
      tests: "gradle test",
      build: "gradle build",
    });
  });

  it("uses not_observed when no execution evidence exists yet", () => {
    const result = buildCheckpointViewModel({
      todos: [],
      subagents: [],
      fileChanges: [],
      commands: [],
      isProcessing: false,
    });

    expect(result.verdict).toBe("needs_review");
    expect(result.evidence.validations.every((entry) => entry.status === "not_observed")).toBe(
      true,
    );
    expect(result.risks.map((entry) => entry.code)).toContain("manual_review");
  });

  it("uses generated summary copy when a safe model summary is available", () => {
    const result = buildCheckpointViewModel({
      todos: [],
      subagents: [],
      fileChanges: baseFileChanges,
      commands: [
        createCommand("cmd-1", "npm run lint", "completed"),
        createCommand("cmd-2", "npm run typecheck", "completed"),
        createCommand("cmd-3", "npm run test", "completed"),
      ],
      isProcessing: false,
      generatedSummary: {
        text: "Implemented the checkpoint surface and verified the observed checks.",
        sourceId: "assistant-1",
      },
    });

    expect(result.summary).toEqual({
      text: "Implemented the checkpoint surface and verified the observed checks.",
    });
    expect(result.sources).toContainEqual({
      kind: "summary",
      sourceId: "assistant-1",
    });
  });

  it("falls back to deterministic summary when model summary is unavailable", () => {
    const items: ConversationItem[] = [
      {
        id: "u1",
        kind: "message",
        role: "user",
        text: "Please change the app shell.",
      },
    ];

    expect(resolveCheckpointGeneratedSummary(items)).toBeNull();

    const result = buildCheckpointViewModel({
      todos: [],
      subagents: [],
      fileChanges: baseFileChanges,
      commands: [],
      isProcessing: false,
    });

    expect(result.summary).toEqual({
      key: "statusPanel.checkpoint.summary.needsValidation",
    });
  });

  it("does not treat ordinary assistant answers as checkpoint summaries", () => {
    const items: ConversationItem[] = [
      {
        id: "assistant-final",
        kind: "message",
        role: "assistant",
        text: "当前提案实现层基本完成，剩下 lint、archive 和 commit。",
      },
    ];

    expect(resolveCheckpointGeneratedSummary(items)).toBeNull();
  });

  it("rejects optimistic generated summary copy while evidence is still unsettled", () => {
    const result = buildCheckpointViewModel({
      todos: [],
      subagents: [],
      fileChanges: baseFileChanges,
      commands: [],
      isProcessing: false,
      generatedSummary: {
        text: "All checks passed and this is ready to commit.",
        sourceId: "assistant-2",
      },
    });

    expect(result.verdict).toBe("needs_review");
    expect(result.summary).toEqual({
      key: "statusPanel.checkpoint.summary.needsValidation",
    });
    expect(
      result.sources.some(
        (entry) => entry.kind === "summary" && entry.sourceId === "assistant-2",
      ),
    ).toBe(false);
  });

  it("keeps command failures as evidence without duplicating command actions", () => {
    const result = buildCheckpointViewModel({
      todos: [],
      subagents: [],
      fileChanges: baseFileChanges,
      commands: [createCommand("cmd-1", "npm run test", "error")],
      isProcessing: false,
    });

    expect(result.risks.map((entry) => entry.code)).toContain("validation_failed");
    expect(result.nextActions.map((entry) => entry.type)).toEqual(["review_diff"]);
  });

  it("downgrades custom command failures to needs_review instead of blocked", () => {
    const result = buildCheckpointViewModel({
      todos: [],
      subagents: [],
      fileChanges: [],
      commands: [createCommand("cmd-1", 'sed -n "1,220p" missing-file.ts', "error")],
      isProcessing: false,
    });

    expect(result.verdict).toBe("needs_review");
    expect(result.summary).toEqual({
      key: "statusPanel.checkpoint.summary.manual",
    });
  });

  it("uses diff review as the checkpoint action for missing validation follow-up", () => {
    const result = buildCheckpointViewModel({
      todos: [],
      subagents: [],
      fileChanges: baseFileChanges,
      commands: [createCommand("cmd-1", "echo changed files", "completed")],
      isProcessing: false,
    });

    expect(result.verdict).toBe("needs_review");
    expect(result.nextActions.map((entry) => entry.type)).toEqual(["review_diff"]);
  });

  it("allows running verdict to use generated summary", () => {
    const result = buildCheckpointViewModel({
      todos: [],
      subagents: [],
      fileChanges: baseFileChanges,
      commands: [createCommand("cmd-1", "npm run test", "running")],
      isProcessing: true,
      generatedSummary: {
        text: "Running tests and typecheck, about halfway done.",
        sourceId: "assistant-3",
      },
    });

    expect(result.verdict).toBe("running");
    expect(result.summary).toEqual({
      text: "Running tests and typecheck, about halfway done.",
    });
  });

  it("resolves summary from assistant message with ## Summary heading", () => {
    const items: ConversationItem[] = [
      {
        id: "u1",
        kind: "message",
        role: "user",
        text: "Run the tests",
      },
      {
        id: "assistant-summary",
        kind: "message",
        role: "assistant",
        text: "## Summary\n\nAll tests pass and the build succeeded.",
      },
    ];

    const summary = resolveCheckpointGeneratedSummary(items);

    expect(summary).toEqual({
      text: "All tests pass and the build succeeded.",
      sourceId: "assistant-summary",
    });
  });

  it("prefers canonicalFileFacts over raw fileChanges when provided", () => {
    const canonicalFacts: FileChangeSummary[] = [
      {
        filePath: "src/overridden.ts",
        fileName: "overridden.ts",
        status: "M",
        additions: 20,
        deletions: 5,
      },
    ];

    const result = buildCheckpointViewModel({
      todos: [],
      subagents: [],
      fileChanges: baseFileChanges,
      commands: [],
      isProcessing: false,
      canonicalFileFacts: canonicalFacts,
    });

    expect(result.evidence.changedFiles).toBe(1);
    expect(result.evidence.additions).toBe(20);
    expect(result.evidence.deletions).toBe(5);
    expect(result.keyChanges[0]?.summary).toMatchObject({
      key: "statusPanel.checkpoint.keyChanges.filesSummary",
      params: { count: 1, additions: 20, deletions: 5 },
    });
  });

  it("falls back to raw fileChanges when canonicalFileFacts is absent", () => {
    const result = buildCheckpointViewModel({
      todos: [],
      subagents: [],
      fileChanges: baseFileChanges,
      commands: [],
      isProcessing: false,
    });

    expect(result.evidence.changedFiles).toBe(1);
    expect(result.evidence.additions).toBe(8);
    expect(result.evidence.deletions).toBe(2);
  });

  it("keeps required-validation command failure as blocked", () => {
    const result = buildCheckpointViewModel({
      todos: [],
      subagents: [],
      fileChanges: baseFileChanges,
      commands: [createCommand("cmd-1", "npm run test", "error")],
      isProcessing: false,
    });

    expect(result.verdict).toBe("blocked");
  });

  it("downgrades optional-validation command failure to not blocked", () => {
    const result = buildCheckpointViewModel({
      todos: [],
      subagents: [],
      fileChanges: baseFileChanges,
      commands: [createCommand("cmd-1", "npm run build", "error")],
      isProcessing: false,
    });

    expect(result.verdict).not.toBe("blocked");
  });
});
