// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ConversationItem } from "../../../../../../types";
import { ReadOnlyTimelineViewer } from "./ReadOnlyTimelineViewer";

describe("ReadOnlyTimelineViewer", () => {
  it("shows the empty message when items array is empty", () => {
    render(
      <ReadOnlyTimelineViewer
        items={[]}
        engine="codex"
        emptyMessage="No messages."
      />,
    );
    expect(
      screen.getByTestId("session-organization-timeline-empty"),
    ).toBeTruthy();
    expect(screen.getByText("No messages.")).toBeTruthy();
  });

  it("renders a single user message item", () => {
    const items: ConversationItem[] = [
      {
        id: "msg-1",
        kind: "message",
        role: "user",
        text: "Hello world",
      },
    ];
    render(
      <ReadOnlyTimelineViewer
        items={items}
        engine="codex"
        emptyMessage="No messages."
      />,
    );
    expect(
      screen.getByTestId("session-organization-timeline"),
    ).toBeTruthy();
    expect(screen.getByText("Hello world")).toBeTruthy();
  });

  it("renders a tool item via the read-only tool fallback", () => {
    const items: ConversationItem[] = [
      {
        id: "tool-1",
        kind: "tool",
        toolType: "Read",
        title: "Read main.py",
        detail: "lines 1-30",
      },
    ];
    render(
      <ReadOnlyTimelineViewer
        items={items}
        engine="codex"
        emptyMessage="No messages."
      />,
    );
    expect(
      screen.getByTestId("session-organization-timeline-tool-tool-1"),
    ).toBeTruthy();
    expect(screen.getByText("Read main.py")).toBeTruthy();
  });

  it("renders multiple items in order", () => {
    const items: ConversationItem[] = [
      { id: "u1", kind: "message", role: "user", text: "Question" },
      {
        id: "a1",
        kind: "message",
        role: "assistant",
        text: "Answer",
        isFinal: true,
      },
    ];
    const { container } = render(
      <ReadOnlyTimelineViewer
        items={items}
        engine="codex"
        emptyMessage="No messages."
      />,
    );
    expect(container.textContent).toContain("Question");
    expect(container.textContent).toContain("Answer");
  });
});
