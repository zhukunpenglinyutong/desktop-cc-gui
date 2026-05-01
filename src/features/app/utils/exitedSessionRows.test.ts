import { describe, expect, it } from "vitest";

import { getExitedSessionRowVisibility } from "./exitedSessionRows";

describe("getExitedSessionRowVisibility", () => {
  it("returns original rows when exited filtering is disabled", () => {
    const rows = [
      { thread: { id: "running" }, depth: 0 },
      { thread: { id: "exited" }, depth: 0 },
    ];

    const result = getExitedSessionRowVisibility(rows, {
      hideExitedSessions: false,
      isExitedThread: (thread) => thread.id === "exited",
    });

    expect(result.visibleRows).toEqual(rows);
    expect(result.hiddenExitedCount).toBe(0);
    expect(result.hasExitedSessions).toBe(true);
  });

  it("keeps exited ancestors visible when a running descendant remains visible", () => {
    const rows = [
      { thread: { id: "parent" }, depth: 0 },
      { thread: { id: "child" }, depth: 1 },
      { thread: { id: "sibling" }, depth: 0 },
    ];

    const result = getExitedSessionRowVisibility(rows, {
      hideExitedSessions: true,
      isExitedThread: (thread) => thread.id !== "child",
    });

    expect(result.visibleRows.map((row) => row.thread.id)).toEqual(["parent", "child"]);
    expect(result.hiddenExitedCount).toBe(1);
    expect(result.hasExitedSessions).toBe(true);
  });

  it("hides exited descendants when no running branch depends on them", () => {
    const rows = [
      { thread: { id: "root" }, depth: 0 },
      { thread: { id: "child" }, depth: 1 },
      { thread: { id: "running-root" }, depth: 0 },
    ];

    const result = getExitedSessionRowVisibility(rows, {
      hideExitedSessions: true,
      isExitedThread: (thread) => thread.id !== "running-root",
    });

    expect(result.visibleRows.map((row) => row.thread.id)).toEqual(["running-root"]);
    expect(result.hiddenExitedCount).toBe(2);
  });
});
