import { describe, expect, it } from "vitest";
import type { ConversationItem } from "../../../types";
import type { TaskRunRecord } from "../types";
import {
  deriveTaskRunTelemetryPatch,
  inferTaskRunEngine,
  normalizeTaskRunTelemetry,
} from "./taskRunTelemetry";

function makeRun(overrides: Partial<TaskRunRecord> = {}): TaskRunRecord {
  return {
    runId: "run-1",
    task: { taskId: "task-1", source: "kanban", workspaceId: "/repo" },
    engine: "codex",
    status: "planning",
    trigger: "manual",
    artifacts: [],
    availableRecoveryActions: ["open_conversation", "cancel"],
    updatedAt: 10,
    ...overrides,
  };
}

describe("taskRunTelemetry", () => {
  it("normalizes runtime/thread signal into shared run telemetry", () => {
    const items: ConversationItem[] = [
      {
        id: "tool-1",
        kind: "tool",
        toolType: "exec",
        status: "completed",
        title: "Run tests",
        detail: "Running focused tests",
        output: "All tests passed",
        changes: [{ path: "src/features/tasks/types.ts", kind: "modified" }],
      },
    ];

    const run = normalizeTaskRunTelemetry({
      run: makeRun(),
      threadStatus: { isProcessing: true, lastDurationMs: 0, lastAgentTimestamp: 20 },
      items,
      now: 30,
    });

    expect(run.status).toBe("running");
    expect(run.currentStep).toBe("Running focused tests");
    expect(run.latestOutputSummary).toBe("All tests passed");
    expect(run.artifacts).toEqual([
      {
        kind: "file",
        label: "src/features/tasks/types.ts",
        ref: "src/features/tasks/types.ts",
      },
    ]);
  });

  it("settles active runs when processing stops", () => {
    const run = normalizeTaskRunTelemetry({
      run: makeRun({ status: "running" }),
      threadStatus: { isProcessing: false, lastDurationMs: 10, lastAgentTimestamp: 20 },
      now: 40,
    });

    expect(run.status).toBe("completed");
    expect(run.finishedAt).toBe(40);
    expect(run.availableRecoveryActions).toContain("fork_new_run");
  });

  it("emits a minimal patch for completion telemetry updates", () => {
    const patch = deriveTaskRunTelemetryPatch({
      run: makeRun({ status: "running" }),
      threadStatus: { isProcessing: false, lastDurationMs: 10, lastAgentTimestamp: 20 },
      items: [
        {
          id: "assistant-1",
          kind: "message",
          role: "assistant",
          text: "Completed the remaining Task Center work.",
        },
      ],
      now: 99,
    });

    expect(patch).toMatchObject({
      status: "completed",
      latestOutputSummary: "Completed the remaining Task Center work.",
      finishedAt: 99,
      now: 99,
    });
  });

  it("infers supported engines from thread identity", () => {
    expect(inferTaskRunEngine("codex:abc")).toBe("codex");
    expect(inferTaskRunEngine("claude:abc")).toBe("claude");
    expect(inferTaskRunEngine("gemini:abc")).toBe("gemini");
    expect(inferTaskRunEngine("opencode:abc")).toBe("opencode");
  });
});
