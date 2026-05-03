/** @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { KanbanTask } from "../types";
import { KanbanCard } from "./KanbanCard";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (typeof options?.reason === "string") {
        return `${key}:${options.reason}`;
      }
      return key;
    },
  }),
}));

vi.mock("@hello-pangea/dnd", () => ({
  Draggable: ({
    children,
  }: {
    children: (
      provided: {
        innerRef: (element: HTMLElement | null) => void;
        draggableProps: Record<string, never>;
        dragHandleProps: Record<string, never>;
      },
      snapshot: { isDragging: boolean },
    ) => unknown;
  }) =>
    children(
      {
        innerRef: vi.fn(),
        draggableProps: {},
        dragHandleProps: {},
      },
      { isDragging: false },
    ),
}));

function createTask(blockedReason: string | null): KanbanTask {
  return {
    id: "task-1",
    workspaceId: "ws-1",
    panelId: "panel-1",
    title: "Task 1",
    description: "",
    status: "todo",
    engineType: "codex",
    modelId: null,
    branchName: "main",
    images: [],
    autoStart: false,
    sortOrder: 1,
    threadId: null,
    execution: blockedReason ? { blockedReason } : {},
    latestRunSummary: null,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("KanbanCard blocked reason dismiss", () => {
  it("allows dismissing blocked reason banner manually", () => {
    const { container } = render(
      <KanbanCard
        task={createTask("manual_blocked")}
        index={0}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(container.querySelector(".kanban-card-blocked-reason")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "kanban.conversation.close" }));

    expect(container.querySelector(".kanban-card-blocked-reason")).toBeNull();
  });

  it("shows banner again when blocked reason changes", () => {
    const { container, rerender } = render(
      <KanbanCard
        task={createTask("manual_blocked")}
        index={0}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "kanban.conversation.close" }));
    expect(container.querySelector(".kanban-card-blocked-reason")).toBeNull();

    rerender(
      <KanbanCard
        task={createTask("manual_blocked")}
        index={0}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(container.querySelector(".kanban-card-blocked-reason")).toBeNull();

    rerender(
      <KanbanCard
        task={createTask("chain_requires_head_trigger")}
        index={0}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(container.querySelector(".kanban-card-blocked-reason")).not.toBeNull();
  });

  it("shows precise head/current order hint for chained blocked tasks", () => {
    const { container } = render(
      <KanbanCard
        task={createTask("chain_requires_head_trigger")}
        index={0}
        chainOrderIndex={2}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(container.textContent).toContain(
      "kanban.task.blockedReason.chainRequiresHeadTriggerWithOrder",
    );
  });

  it("renders latest run summary with shared task-center hint copy", () => {
    const { container } = render(
      <KanbanCard
        task={{
          ...createTask(null),
          latestRunSummary: {
            runId: "run-1",
            status: "failed",
            trigger: "manual",
            engine: "codex",
            linkedThreadId: "thread-1",
            latestOutputSummary: "unit tests failed",
            blockedReason: null,
            failureReason: "unit tests failed",
            artifactCount: 0,
            updatedAt: Date.now(),
            finishedAt: Date.now(),
          },
        }}
        index={0}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(container.querySelector(".kanban-card-run-summary")).not.toBeNull();
    expect(container.textContent).toContain("taskCenter.nextStep.openConversation");
    expect(container.textContent).toContain("unit tests failed");
  });

  it("does not render completed run detail body inside kanban summary card", () => {
    const { container } = render(
      <KanbanCard
        task={{
          ...createTask(null),
          latestRunSummary: {
            runId: "run-2",
            status: "completed",
            trigger: "manual",
            engine: "codex",
            linkedThreadId: "thread-2",
            latestOutputSummary: "very long generated analysis body should stay out of kanban",
            blockedReason: null,
            failureReason: null,
            artifactCount: 0,
            updatedAt: Date.now(),
            finishedAt: Date.now(),
          },
        }}
        index={0}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(container.querySelector(".kanban-card-run-summary")).not.toBeNull();
    expect(container.textContent).not.toContain(
      "very long generated analysis body should stay out of kanban",
    );
    expect(container.textContent).not.toContain("taskCenter.unavailable");
  });

  it("does not render unavailable placeholder for running run summary without detail copy", () => {
    const { container } = render(
      <KanbanCard
        task={{
          ...createTask(null),
          latestRunSummary: {
            runId: "run-3",
            status: "running",
            trigger: "manual",
            engine: "codex",
            linkedThreadId: "thread-3",
            latestOutputSummary: null,
            blockedReason: null,
            failureReason: null,
            artifactCount: 0,
            updatedAt: Date.now(),
            finishedAt: null,
          },
        }}
        index={0}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(container.querySelector(".kanban-card-run-summary")).not.toBeNull();
    expect(container.textContent).not.toContain("taskCenter.unavailable");
  });
});
