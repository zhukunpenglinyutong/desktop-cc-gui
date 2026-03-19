// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceSessionRadarPanel } from "./WorkspaceSessionRadarPanel";

describe("WorkspaceSessionRadarPanel", () => {
  it("renders global radar entries and jumps to the selected session", () => {
    const onSelectThread = vi.fn();

    render(
      <WorkspaceSessionRadarPanel
        runningSessions={[
          {
            id: "w1:t1",
            workspaceId: "w1",
            workspaceName: "Workspace 1",
            threadId: "t1",
            threadName: "Running Thread",
            engine: "CODEX",
            preview: "running preview",
            updatedAt: 10,
            isProcessing: true,
            startedAt: 5,
            completedAt: null,
            durationMs: 5000,
          },
        ]}
        recentCompletedSessions={[
          {
            id: "w2:t2",
            workspaceId: "w2",
            workspaceName: "Workspace 2",
            threadId: "t2",
            threadName: "Recent Thread",
            engine: "CLAUDE",
            preview: "recent preview",
            updatedAt: 5,
            isProcessing: false,
            startedAt: 1,
            completedAt: 5,
            durationMs: 4000,
          },
          {
            id: "w2:t3",
            workspaceId: "w2",
            workspaceName: "Workspace 2",
            threadId: "t3",
            threadName: "Recent Thread 2",
            engine: "CLAUDE",
            preview: "recent preview 2",
            updatedAt: 6,
            isProcessing: false,
            startedAt: 2,
            completedAt: 6,
            durationMs: 4000,
          },
        ]}
        onSelectThread={onSelectThread}
      />,
    );

    const dateGroupToggle = screen.getByRole("button", { name: /1970-01-01/i });
    expect(dateGroupToggle).toBeTruthy();
    expect(within(dateGroupToggle).getByText("2")).toBeTruthy();
    expect(screen.queryByText("Recent Thread")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Running Thread/i }));
    expect(onSelectThread).toHaveBeenCalledWith("w1", "t1");
    fireEvent.click(dateGroupToggle);
    expect(screen.getByText("Recent Thread")).toBeTruthy();
    expect(screen.getAllByLabelText("activityPanel.radar.unreadMark")).toHaveLength(2);
    expect(screen.queryByText("activityPanel.radar.openSession")).toBeNull();

    fireEvent.click(screen.getByTitle("Recent Thread"));
    expect(onSelectThread).toHaveBeenCalledWith("w2", "t2");
    expect(screen.getAllByLabelText("activityPanel.radar.unreadMark")).toHaveLength(1);
    expect(screen.getByLabelText("activityPanel.radar.readMark")).toBeTruthy();

    fireEvent.click(dateGroupToggle);
    expect(screen.queryByRole("button", { name: /Recent Thread 2/i })).toBeNull();
  });
});
