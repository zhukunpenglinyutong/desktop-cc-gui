// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TaskCenterView } from "./TaskCenterView";
import type { TaskRunRecord } from "../types";

function makeRun(overrides: Partial<TaskRunRecord> = {}): TaskRunRecord {
  return {
    runId: "run-1",
    task: {
      taskId: "task-1",
      source: "kanban",
      workspaceId: "/repo",
      title: "Build release",
    },
    engine: "codex",
    status: "running",
    trigger: "manual",
    linkedThreadId: "thread-1",
    planSnapshot: "Plan",
    currentStep: "Writing tests",
    latestOutputSummary: "Updated task run model",
    blockedReason: null,
    failureReason: null,
    artifacts: [{ kind: "file", label: "src/features/tasks/types.ts" }],
    availableRecoveryActions: ["open_conversation", "cancel"],
    startedAt: 10,
    updatedAt: 20,
    finishedAt: null,
    ...overrides,
  };
}

describe("TaskCenterView", () => {
  it("filters runs by workspace, status, and engine", () => {
    render(
      <TaskCenterView
        workspaceId="/repo"
        runs={[
          makeRun(),
          makeRun({
            runId: "run-2",
            task: { taskId: "task-2", source: "kanban", workspaceId: "/repo", title: "Gemini run" },
            engine: "gemini",
            status: "failed",
            updatedAt: 30,
          }),
          makeRun({
            runId: "run-3",
            task: { taskId: "task-3", source: "kanban", workspaceId: "/other", title: "Other" },
            updatedAt: 40,
          }),
        ]}
      />,
    );

    expect(screen.getAllByText("Build release").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Gemini run").length).toBeGreaterThan(0);
    expect(screen.queryByText("Other")).toBeNull();

    fireEvent.change(screen.getByLabelText("taskCenter.statusFilter"), {
      target: { value: "failed" },
    });

    expect(screen.queryByText("Build release")).toBeNull();
    expect(screen.getAllByText("Gemini run").length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("taskCenter.engineFilter"), {
      target: { value: "codex" },
    });

    expect(screen.queryByText("Gemini run")).toBeNull();
    expect(screen.getByText("taskCenter.empty")).toBeTruthy();
  });

  it("renders diagnostics, artifacts, and navigation without mutating run state", () => {
    const onOpenConversation = vi.fn();
    const run = makeRun();
    render(<TaskCenterView runs={[run]} onOpenConversation={onOpenConversation} />);

    expect(screen.getByText("Writing tests")).toBeTruthy();
    expect(screen.getAllByText("Updated task run model").length).toBeGreaterThan(0);
    expect(screen.getByText("src/features/tasks/types.ts")).toBeTruthy();
    expect(screen.getAllByText("taskCenter.nextStep.monitor").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByText("taskCenter.action.openConversation"));

    expect(onOpenConversation).toHaveBeenCalledWith("thread-1");
    expect(run.status).toBe("running");
  });

  it("disables duplicate-producing recovery actions when another active run exists", () => {
    render(
      <TaskCenterView
        runs={[
          makeRun({
            runId: "settled",
            status: "failed",
            updatedAt: 10,
            availableRecoveryActions: ["open_conversation", "retry", "resume"],
          }),
          makeRun({
            runId: "active",
            status: "running",
            updatedAt: 20,
            availableRecoveryActions: ["open_conversation", "cancel"],
          }),
        ]}
        onRetryRun={vi.fn()}
        onForkRun={vi.fn()}
      />,
    );

    fireEvent.click(screen.getAllByText("Build release")[1]!);
    expect(screen.getByText("taskCenter.action.retry")).toHaveProperty("disabled", true);
    expect(screen.getByText("taskCenter.action.fork")).toHaveProperty("disabled", true);
  });

  it("sorts attention-needing runs ahead of lower-priority active runs", () => {
    render(
      <TaskCenterView
        runs={[
          makeRun({
            runId: "running",
            status: "running",
            updatedAt: 30,
            task: { taskId: "task-running", source: "kanban", workspaceId: "/repo", title: "Running task" },
          }),
          makeRun({
            runId: "blocked",
            status: "blocked",
            blockedReason: "manual intervention required",
            updatedAt: 10,
            task: { taskId: "task-blocked", source: "kanban", workspaceId: "/repo", title: "Blocked task" },
          }),
        ]}
      />,
    );

    const runTitles = screen.getAllByRole("button").map((node) => node.textContent ?? "");
    expect(runTitles[0]).toContain("Blocked task");
    expect(screen.getAllByText("taskCenter.nextStep.openConversation").length).toBeGreaterThan(0);
  });

  it("disables actions that are not available for the selected run", () => {
    render(
      <TaskCenterView
        runs={[
          makeRun({
            status: "completed",
            availableRecoveryActions: ["open_conversation", "fork_new_run"],
          }),
        ]}
        onRetryRun={vi.fn()}
        onResumeRun={vi.fn()}
        onCancelRun={vi.fn()}
        onForkRun={vi.fn()}
      />,
    );

    expect(screen.getByText("taskCenter.action.retry")).toHaveProperty("disabled", true);
    expect(screen.getByText("taskCenter.action.resume")).toHaveProperty("disabled", true);
    expect(screen.getByText("taskCenter.action.cancel")).toHaveProperty("disabled", true);
    expect(screen.getByText("taskCenter.action.fork")).toHaveProperty("disabled", false);
  });
});
