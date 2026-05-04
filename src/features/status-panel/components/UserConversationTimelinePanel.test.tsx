// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserConversationTimelinePanel } from "./UserConversationTimelinePanel";

describe("UserConversationTimelinePanel", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders empty state when there is no message", () => {
    render(
      <UserConversationTimelinePanel
        timeline={{ items: [], hasMessage: false }}
      />,
    );

    expect(screen.getByText("No user conversation")).toBeTruthy();
  });

  it("shows collapsed state for long messages", () => {
    render(
      <UserConversationTimelinePanel
        timeline={{
          items: [{ id: "u1", text: "1\n2\n3\n4\n5", imageCount: 0, chronologicalIndex: 1 }],
          hasMessage: true,
        }}
      />,
    );

    expect(screen.getByText("Expand")).toBeTruthy();
    expect(document.querySelector(".sp-user-conversation-text.is-collapsed")).toBeTruthy();
  });

  it("expands and collapses one long message without affecting others", () => {
    render(
      <UserConversationTimelinePanel
        timeline={{
          items: [
            { id: "u1", text: "1\n2\n3\n4\n5", imageCount: 0, chronologicalIndex: 1 },
            { id: "u2", text: "a\nb\nc\nd\ne", imageCount: 0, chronologicalIndex: 2 },
          ],
          hasMessage: true,
        }}
      />,
    );

    const expandButtons = screen.getAllByText("Expand");
    fireEvent.click(expandButtons[0]);
    expect(screen.getByText("Collapse")).toBeTruthy();
    expect(document.querySelectorAll(".sp-user-conversation-text.is-collapsed")).toHaveLength(1);
  });

  it("emits jump callback with the clicked message id", () => {
    const onJumpToMessage = vi.fn();

    render(
      <UserConversationTimelinePanel
        timeline={{
          items: [{ id: "u1", text: "hello", imageCount: 0, chronologicalIndex: 1 }],
          hasMessage: true,
        }}
        onJumpToMessage={onJumpToMessage}
      />,
    );

    fireEvent.click(screen.getByText("Jump to message"));
    expect(onJumpToMessage).toHaveBeenCalledWith("u1");
  });

  it("shows sequence metadata for each timeline item", () => {
    render(
      <UserConversationTimelinePanel
        timeline={{
          items: [
            { id: "u2", text: "latest", imageCount: 0, chronologicalIndex: 2 },
            { id: "u1", text: "older", imageCount: 0, chronologicalIndex: 1 },
          ],
          hasMessage: true,
        }}
      />,
    );

    expect(screen.getByText("Newest to oldest 1/2")).toBeTruthy();
    expect(screen.getByText("#2")).toBeTruthy();
    expect(screen.getByText("Newest to oldest 2/2")).toBeTruthy();
    expect(screen.getByText("#1")).toBeTruthy();
  });
});
