import { describe, expect, it } from "vitest";
import type { ThreadSummary } from "../../../types";
import {
  buildTopbarSessionTabItems,
  createEmptyTopbarSessionWindows,
  dismissAllTopbarSessionTabs,
  dismissCompletedTopbarSessionTabs,
  dismissTopbarSessionTab,
  dismissTopbarSessionTabsToLeft,
  dismissTopbarSessionTabsToRight,
  pickAdjacentOpenSessionTab,
  pickAdjacentTopbarSessionFallbackTab,
  pruneTopbarSessionWindows,
  recordTopbarSessionActivation,
  resolveTopbarSessionTabLabel,
  type TopbarSessionWindows,
} from "./topbarSessionTabs";

function makeThreads(ids: string[]): ThreadSummary[] {
  return ids.map((id, index) => ({
    id,
    name: `Thread ${index + 1}`,
    updatedAt: index + 1,
  }));
}

describe("topbarSessionTabs", () => {
  it("keeps at most five tabs and never evicts the active one", () => {
    let windows: TopbarSessionWindows = createEmptyTopbarSessionWindows();
    const threadsByWorkspace = {
      w1: makeThreads(["t1", "t2", "t3", "t4", "t5", "t6"]),
    };

    for (const thread of threadsByWorkspace.w1) {
      windows = recordTopbarSessionActivation(
        windows,
        "w1",
        thread.id,
        threadsByWorkspace,
      );
    }

    expect(windows.tabs).toHaveLength(5);
    expect(
      windows.tabs.some((tab) => tab.workspaceId === "w1" && tab.threadId === "t6"),
    ).toBe(true);
    expect(
      windows.tabs.some((tab) => tab.workspaceId === "w1" && tab.threadId === "t1"),
    ).toBe(false);
    expect(
      windows.tabs.some((tab) => tab.workspaceId === "w1" && tab.threadId === "t2"),
    ).toBe(true);
  });

  it("stores tabs across different workspaces in one global rotation window", () => {
    let windows: TopbarSessionWindows = createEmptyTopbarSessionWindows();
    const threadsByWorkspace = {
      w1: makeThreads(["a1", "a2"]),
      w2: makeThreads(["b1", "b2"]),
    };

    windows = recordTopbarSessionActivation(windows, "w1", "a1", threadsByWorkspace);
    windows = recordTopbarSessionActivation(windows, "w2", "b1", threadsByWorkspace);
    windows = recordTopbarSessionActivation(windows, "w1", "a2", threadsByWorkspace);

    expect(windows.tabs).toEqual([
      { workspaceId: "w1", threadId: "a1" },
      { workspaceId: "w2", threadId: "b1" },
      { workspaceId: "w1", threadId: "a2" },
    ]);
  });

  it("does not reorder existing tabs when switching between already opened sessions", () => {
    const threadsByWorkspace = {
      w1: makeThreads(["a1", "a2", "a3"]),
    };
    let windows: TopbarSessionWindows = createEmptyTopbarSessionWindows();
    windows = recordTopbarSessionActivation(windows, "w1", "a1", threadsByWorkspace);
    windows = recordTopbarSessionActivation(windows, "w1", "a2", threadsByWorkspace);
    windows = recordTopbarSessionActivation(windows, "w1", "a3", threadsByWorkspace);

    const before = windows.tabs.map((tab) => `${tab.workspaceId}:${tab.threadId}`);
    windows = recordTopbarSessionActivation(windows, "w1", "a1", threadsByWorkspace);
    const after = windows.tabs.map((tab) => `${tab.workspaceId}:${tab.threadId}`);

    expect(after).toEqual(before);
  });

  it("picks next and previous open sessions in visible tab order", () => {
    const windows: TopbarSessionWindows = {
      tabs: [
        { workspaceId: "w1", threadId: "a1" },
        { workspaceId: "w2", threadId: "b1" },
        { workspaceId: "w1", threadId: "a2" },
      ],
      activationOrdinalByTabKey: {},
      nextActivationOrdinal: 0,
    };

    expect(pickAdjacentOpenSessionTab(windows, "w2", "b1", "next")).toEqual({
      workspaceId: "w1",
      threadId: "a2",
    });
    expect(pickAdjacentOpenSessionTab(windows, "w2", "b1", "prev")).toEqual({
      workspaceId: "w1",
      threadId: "a1",
    });
    expect(pickAdjacentOpenSessionTab(windows, "w1", "a2", "next")).toEqual({
      workspaceId: "w1",
      threadId: "a1",
    });
  });

  it("returns null when open session navigation is unavailable", () => {
    const windows: TopbarSessionWindows = {
      tabs: [{ workspaceId: "w1", threadId: "a1" }],
      activationOrdinalByTabKey: {},
      nextActivationOrdinal: 0,
    };

    expect(pickAdjacentOpenSessionTab(windows, "w1", "a1", "next")).toBeNull();
    expect(pickAdjacentOpenSessionTab(windows, "w1", "missing", "next")).toBeNull();
    expect(pickAdjacentOpenSessionTab(windows, null, "a1", "next")).toBeNull();
  });

  it("uses deterministic tie-break for equal ordinals", () => {
    const windows: TopbarSessionWindows = {
      tabs: [
        { workspaceId: "w1", threadId: "z1" },
        { workspaceId: "w1", threadId: "a1" },
        { workspaceId: "w2", threadId: "n1" },
        { workspaceId: "w2", threadId: "p1" },
      ],
      activationOrdinalByTabKey: {
        "w1::z1": 1,
        "w1::a1": 1,
        "w2::n1": 2,
        "w2::p1": 3,
      },
      nextActivationOrdinal: 3,
    };
    const threadsByWorkspace = {
      w1: makeThreads(["z1", "a1"]),
      w2: makeThreads(["n1", "p1", "x1"]),
    };

    const next = recordTopbarSessionActivation(
      windows,
      "w2",
      "x1",
      threadsByWorkspace,
      4,
    );

    expect(
      next.tabs.some((tab) => tab.workspaceId === "w1" && tab.threadId === "a1"),
    ).toBe(false);
    expect(
      next.tabs.some((tab) => tab.workspaceId === "w1" && tab.threadId === "z1"),
    ).toBe(true);
  });

  it("uses code-unit order for equal ordinals to avoid locale-dependent eviction", () => {
    const windows: TopbarSessionWindows = {
      tabs: [
        { workspaceId: "w1", threadId: "a1" },
        { workspaceId: "w1", threadId: "A1" },
        { workspaceId: "w2", threadId: "n1" },
        { workspaceId: "w2", threadId: "p1" },
      ],
      activationOrdinalByTabKey: {
        "w1::a1": 1,
        "w1::A1": 1,
        "w2::n1": 2,
        "w2::p1": 3,
      },
      nextActivationOrdinal: 3,
    };
    const threadsByWorkspace = {
      w1: makeThreads(["a1", "A1"]),
      w2: makeThreads(["n1", "p1", "x1"]),
    };

    const next = recordTopbarSessionActivation(
      windows,
      "w2",
      "x1",
      threadsByWorkspace,
      4,
    );

    expect(
      next.tabs.some((tab) => tab.workspaceId === "w1" && tab.threadId === "A1"),
    ).toBe(false);
    expect(
      next.tabs.some((tab) => tab.workspaceId === "w1" && tab.threadId === "a1"),
    ).toBe(true);
  });

  it("falls back to untitled label with short thread id", () => {
    const label = resolveTopbarSessionTabLabel(
      {
        id: "thread-123456789",
        name: "   ",
        updatedAt: Date.now(),
      },
      "Untitled",
    );
    expect(label).toContain("Untitled");
    expect(label).toContain("thread-1");
  });

  it("builds tab items across workspaces and marks active by workspace + thread", () => {
    const items = buildTopbarSessionTabItems(
      "w2",
      "x1",
      {
        w1: makeThreads(["t1", "t2"]),
        w2: makeThreads(["x1"]),
      },
      {
        tabs: [
          { workspaceId: "w1", threadId: "t1" },
          { workspaceId: "w2", threadId: "x1" },
        ],
        activationOrdinalByTabKey: {
          "w1::t1": 1,
          "w2::x1": 2,
        },
        nextActivationOrdinal: 2,
      },
      "Untitled",
      {
        codex: "Codex",
        claude: "Claude",
        opencode: "OpenCode",
      },
    );

    expect(items).toHaveLength(2);
    expect(items[1]?.isActive).toBe(true);
    expect(items[1]?.workspaceId).toBe("w2");
    expect(items[1]?.threadId).toBe("x1");
  });

  it("prunes stale thread references that no longer exist", () => {
    const windows: TopbarSessionWindows = {
      tabs: [
        { workspaceId: "w1", threadId: "t1" },
        { workspaceId: "w1", threadId: "t2" },
        { workspaceId: "w2", threadId: "ghost" },
      ],
      activationOrdinalByTabKey: {
        "w1::t1": 1,
        "w1::t2": 2,
        "w2::ghost": 3,
      },
      nextActivationOrdinal: 3,
    };
    const pruned = pruneTopbarSessionWindows(windows, {
      w1: makeThreads(["t1", "t2"]),
      w2: [],
    });
    expect(pruned.tabs).toEqual([
      { workspaceId: "w1", threadId: "t1" },
      { workspaceId: "w1", threadId: "t2" },
    ]);
  });

  it("allows closing a single tab without deleting the thread", () => {
    const windows: TopbarSessionWindows = {
      tabs: [
        { workspaceId: "w1", threadId: "t1" },
        { workspaceId: "w2", threadId: "t2" },
      ],
      activationOrdinalByTabKey: {
        "w1::t1": 1,
        "w2::t2": 2,
      },
      nextActivationOrdinal: 2,
    };
    const next = dismissTopbarSessionTab(windows, "w1", "t1");

    expect(next.tabs).toEqual([{ workspaceId: "w2", threadId: "t2" }]);
    expect(next.activationOrdinalByTabKey["w1::t1"]).toBeUndefined();
    expect(next.activationOrdinalByTabKey["w2::t2"]).toBe(2);
  });

  it("closes all tabs without mutating lifecycle state", () => {
    const windows: TopbarSessionWindows = {
      tabs: [
        { workspaceId: "w1", threadId: "t1" },
        { workspaceId: "w2", threadId: "t2" },
      ],
      activationOrdinalByTabKey: {
        "w1::t1": 1,
        "w2::t2": 2,
      },
      nextActivationOrdinal: 2,
    };

    const next = dismissAllTopbarSessionTabs(windows);

    expect(next.tabs).toEqual([]);
    expect(next.activationOrdinalByTabKey).toEqual({});
    expect(next.nextActivationOrdinal).toBe(2);
  });

  it("closes tabs to the left of the target tab only", () => {
    const windows: TopbarSessionWindows = {
      tabs: [
        { workspaceId: "w1", threadId: "t1" },
        { workspaceId: "w1", threadId: "t2" },
        { workspaceId: "w2", threadId: "t3" },
      ],
      activationOrdinalByTabKey: {
        "w1::t1": 1,
        "w1::t2": 2,
        "w2::t3": 3,
      },
      nextActivationOrdinal: 3,
    };

    const next = dismissTopbarSessionTabsToLeft(windows, "w1", "t2");

    expect(next.tabs).toEqual([
      { workspaceId: "w1", threadId: "t2" },
      { workspaceId: "w2", threadId: "t3" },
    ]);
    expect(next.activationOrdinalByTabKey["w1::t1"]).toBeUndefined();
  });

  it("closes tabs to the right of the target tab only", () => {
    const windows: TopbarSessionWindows = {
      tabs: [
        { workspaceId: "w1", threadId: "t1" },
        { workspaceId: "w1", threadId: "t2" },
        { workspaceId: "w2", threadId: "t3" },
      ],
      activationOrdinalByTabKey: {
        "w1::t1": 1,
        "w1::t2": 2,
        "w2::t3": 3,
      },
      nextActivationOrdinal: 3,
    };

    const next = dismissTopbarSessionTabsToRight(windows, "w1", "t2");

    expect(next.tabs).toEqual([
      { workspaceId: "w1", threadId: "t1" },
      { workspaceId: "w1", threadId: "t2" },
    ]);
    expect(next.activationOrdinalByTabKey["w2::t3"]).toBeUndefined();
  });

  it("closes only explicitly completed tabs and preserves unknown status", () => {
    const windows: TopbarSessionWindows = {
      tabs: [
        { workspaceId: "w1", threadId: "t1" },
        { workspaceId: "w1", threadId: "t2" },
        { workspaceId: "w2", threadId: "t3" },
      ],
      activationOrdinalByTabKey: {
        "w1::t1": 1,
        "w1::t2": 2,
        "w2::t3": 3,
      },
      nextActivationOrdinal: 3,
    };

    const next = dismissCompletedTopbarSessionTabs(windows, {
      t1: { isProcessing: true },
      t2: { isProcessing: false },
      t3: undefined,
    });

    expect(next.tabs).toEqual([
      { workspaceId: "w1", threadId: "t1" },
      { workspaceId: "w2", threadId: "t3" },
    ]);
  });

  it("does not close tabs with unknown processing status when closing completed tabs", () => {
    const windows: TopbarSessionWindows = {
      tabs: [
        { workspaceId: "w1", threadId: "t1" },
        { workspaceId: "w1", threadId: "t2" },
      ],
      activationOrdinalByTabKey: {
        "w1::t1": 1,
        "w1::t2": 2,
      },
      nextActivationOrdinal: 2,
    };

    const next = dismissCompletedTopbarSessionTabs(windows, {
      t1: { isProcessing: false },
      t2: undefined,
    });

    expect(next.tabs).toEqual([{ workspaceId: "w1", threadId: "t2" }]);
  });

  it("picks the nearest tab on the right as fallback when active is removed", () => {
    const previousWindows: TopbarSessionWindows = {
      tabs: [
        { workspaceId: "w1", threadId: "t1" },
        { workspaceId: "w1", threadId: "t2" },
        { workspaceId: "w2", threadId: "t3" },
      ],
      activationOrdinalByTabKey: {
        "w1::t1": 1,
        "w1::t2": 2,
        "w2::t3": 3,
      },
      nextActivationOrdinal: 3,
    };
    const nextWindows = dismissTopbarSessionTab(previousWindows, "w1", "t2");

    expect(
      pickAdjacentTopbarSessionFallbackTab(previousWindows, nextWindows, "w1", "t2"),
    ).toEqual({ workspaceId: "w2", threadId: "t3" });
  });

  it("falls back to the nearest tab on the left when no right-side tab remains", () => {
    const previousWindows: TopbarSessionWindows = {
      tabs: [
        { workspaceId: "w1", threadId: "t1" },
        { workspaceId: "w1", threadId: "t2" },
      ],
      activationOrdinalByTabKey: {
        "w1::t1": 1,
        "w1::t2": 2,
      },
      nextActivationOrdinal: 2,
    };
    const nextWindows = dismissTopbarSessionTab(previousWindows, "w1", "t2");

    expect(
      pickAdjacentTopbarSessionFallbackTab(previousWindows, nextWindows, "w1", "t2"),
    ).toEqual({ workspaceId: "w1", threadId: "t1" });
  });

  it("starts empty after restart and rebuilds on next activation", () => {
    const threadsByWorkspace = {
      w1: makeThreads(["t1", "t2"]),
    };
    const afterRestart: TopbarSessionWindows = createEmptyTopbarSessionWindows();
    const noActivationItems = buildTopbarSessionTabItems(
      "w1",
      "t1",
      threadsByWorkspace,
      afterRestart,
      "Untitled",
    );
    expect(noActivationItems).toHaveLength(0);

    const rebuilt = recordTopbarSessionActivation(
      afterRestart,
      "w1",
      "t1",
      threadsByWorkspace,
    );
    const rebuiltItems = buildTopbarSessionTabItems(
      "w1",
      "t1",
      threadsByWorkspace,
      rebuilt,
      "Untitled",
    );
    expect(rebuiltItems).toHaveLength(1);
    expect(rebuiltItems[0]?.threadId).toBe("t1");
  });

  it("truncates displayed tab text after four characters", () => {
    const items = buildTopbarSessionTabItems(
      "w1",
      "t1",
      {
        w1: [
          {
            id: "t1",
            name: "这是一个超长标题",
            updatedAt: Date.now(),
            engineSource: "claude",
          },
        ],
      },
      {
        tabs: [{ workspaceId: "w1", threadId: "t1" }],
        activationOrdinalByTabKey: { "w1::t1": 1 },
        nextActivationOrdinal: 1,
      },
      "Untitled",
      {
        claude: "Claude",
      },
    );

    expect(items[0]?.displayLabel).toBe("这是一个超长标...");
    expect(items[0]?.engineLabel).toBe("Claude");
  });
});
