// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { FolderProjectionNode } from "./folderProjection";
import { SubfolderCardGrid } from "./SubfolderCardGrid";

function makeNode(
  id: string,
  name: string,
  options: {
    directEntryCount?: number;
    directLatestUpdatedAt?: number | null;
  } = {},
): FolderProjectionNode {
  const directEntryCount = options.directEntryCount ?? 0;
  const directLatestUpdatedAt = options.directLatestUpdatedAt ?? null;
  return {
    folder: {
      id,
      workspaceId: "ws",
      parentId: null,
      name,
      createdAt: 1,
      updatedAt: 1,
    },
    children: [],
    directEntryCount,
    directLatestUpdatedAt,
    totalEntryCount: directEntryCount,
    totalLatestUpdatedAt: directLatestUpdatedAt,
  };
}

describe("SubfolderCardGrid", () => {
  it("renders nothing when the nodes array is empty", () => {
    const { container } = render(
      <SubfolderCardGrid nodes={[]} locale="en" onSelect={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders one card per node with name visible", () => {
    const nodes = [
      makeNode("a", "Alpha", { directEntryCount: 3 }),
      makeNode("b", "Beta", { directEntryCount: 1 }),
    ];
    render(<SubfolderCardGrid nodes={nodes} locale="en" onSelect={vi.fn()} />);
    expect(
      screen.getByTestId("session-organization-subfolder-card-a"),
    ).toBeTruthy();
    expect(
      screen.getByTestId("session-organization-subfolder-card-b"),
    ).toBeTruthy();
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();
  });

  it("calls onSelect with the clicked folder id only", () => {
    const onSelect = vi.fn();
    const nodes = [
      makeNode("alpha", "Alpha"),
      makeNode("beta", "Beta"),
    ];
    render(<SubfolderCardGrid nodes={nodes} locale="en" onSelect={onSelect} />);
    fireEvent.click(
      screen.getByTestId("session-organization-subfolder-card-beta"),
    );
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("beta");
  });

  it("renders -- when a node has no direct latest updatedAt", () => {
    const nodes = [makeNode("alpha", "Alpha", { directLatestUpdatedAt: null })];
    const { container } = render(
      <SubfolderCardGrid nodes={nodes} locale="en" onSelect={vi.fn()} />,
    );
    const time = container.querySelector(
      ".session-organization-subfolder-card-time",
    );
    expect(time?.textContent).toBe("--");
  });

  it("formats directLatestUpdatedAt as MM/DD HH:mm in the supplied locale", () => {
    const fixedTs = Date.UTC(2026, 4, 17, 5, 30);
    const nodes = [
      makeNode("alpha", "Alpha", { directLatestUpdatedAt: fixedTs }),
    ];
    const { container } = render(
      <SubfolderCardGrid nodes={nodes} locale="en" onSelect={vi.fn()} />,
    );
    const time = container.querySelector(
      ".session-organization-subfolder-card-time",
    );
    expect(time?.textContent).toMatch(/\d{2}\/\d{2},?\s+\d{2}:\d{2}/);
  });
});
