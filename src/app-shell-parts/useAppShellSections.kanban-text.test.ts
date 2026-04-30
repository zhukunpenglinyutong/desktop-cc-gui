import { describe, expect, it, vi } from "vitest";
import {
  resolvePendingSessionThreadCandidate,
  shouldSyncComposerEngineForKanbanExecution,
  syncKanbanExecutionEngineAndModel,
  resolveTaskThreadId,
  stripComposerKanbanTagsPreserveFormatting,
} from "./useAppShellSections";

describe("stripComposerKanbanTagsPreserveFormatting", () => {
  it("keeps multiline formatting when no kanban tag is present", () => {
    const input = "你好\n我是陈湘宁!!";
    expect(stripComposerKanbanTagsPreserveFormatting(input)).toBe(input);
  });

  it("removes kanban tags without collapsing line breaks", () => {
    const input = "第一行\n&@看板A 第二行\n第三行";
    expect(stripComposerKanbanTagsPreserveFormatting(input)).toBe("第一行\n第二行\n第三行");
  });

  it("preserves CRLF line endings when removing kanban tags", () => {
    const input = "第一行\r\n&@看板A 第二行\r\n第三行";
    expect(stripComposerKanbanTagsPreserveFormatting(input)).toBe("第一行\r\n第二行\r\n第三行");
  });

  it("collapses only redundant spaces caused by removed tags", () => {
    const input = "任务 &@看板A   描述";
    expect(stripComposerKanbanTagsPreserveFormatting(input)).toBe("任务 描述");
  });

  it("remains stable across repeated calls with and without tags", () => {
    expect(stripComposerKanbanTagsPreserveFormatting("&@看板A 第一行")).toBe("第一行");
    expect(stripComposerKanbanTagsPreserveFormatting("第二行")).toBe("第二行");
    expect(stripComposerKanbanTagsPreserveFormatting("&@看板B 第三行")).toBe("第三行");
  });
});

describe("resolveTaskThreadId", () => {
  it("returns canonical thread id when resolver provides an alias", () => {
    const resolved = resolveTaskThreadId(
      "claude-pending-1",
      (threadId) => (threadId === "claude-pending-1" ? "claude:session-1" : threadId),
    );
    expect(resolved).toBe("claude:session-1");
  });

  it("keeps original thread id when resolver is absent", () => {
    expect(resolveTaskThreadId("claude-pending-1")).toBe("claude-pending-1");
  });
});

describe("resolvePendingSessionThreadCandidate", () => {
  it("maps pending thread only when exactly one unoccupied session candidate exists", () => {
    const resolved = resolvePendingSessionThreadCandidate({
      pendingThreadId: "claude-pending-1",
      workspaceThreadIds: ["claude:session-a", "claude:session-b"],
      occupiedThreadIds: new Set(["claude:session-a"]),
    });
    expect(resolved).toBe("claude:session-b");
  });

  it("returns null when session candidate is ambiguous", () => {
    const resolved = resolvePendingSessionThreadCandidate({
      pendingThreadId: "claude-pending-1",
      workspaceThreadIds: ["claude:session-a", "claude:session-b"],
      occupiedThreadIds: new Set<string>(),
    });
    expect(resolved).toBeNull();
  });

  it("returns null for non-pending thread ids", () => {
    const resolved = resolvePendingSessionThreadCandidate({
      pendingThreadId: "claude:session-1",
      workspaceThreadIds: ["claude:session-a"],
      occupiedThreadIds: new Set<string>(),
    });
    expect(resolved).toBeNull();
  });
});

describe("shouldSyncComposerEngineForKanbanExecution", () => {
  it("returns false for background execution", () => {
    expect(
      shouldSyncComposerEngineForKanbanExecution({
        activate: false,
      }),
    ).toBe(false);
  });

  it("returns true when activate is true", () => {
    expect(
      shouldSyncComposerEngineForKanbanExecution({
        activate: true,
      }),
    ).toBe(true);
  });

  it("defaults to true when activate is omitted", () => {
    expect(shouldSyncComposerEngineForKanbanExecution({})).toBe(true);
  });
});

describe("syncKanbanExecutionEngineAndModel", () => {
  it("does not sync global composer engine for background execution", async () => {
    const setActiveEngine = vi.fn(async () => undefined);

    const result = await syncKanbanExecutionEngineAndModel({
      activate: false,
      engine: "claude",
      modelId: "claude-sonnet-4-5",
      setActiveEngine,
    });

    expect(setActiveEngine).not.toHaveBeenCalled();
    expect(result).toEqual({
      shouldSyncComposerSelection: false,
      outboundModel: "claude-sonnet-4-5",
      composerSelection: null,
    });
  });

  it("returns a codex composer selection for foreground execution without mutating global state", async () => {
    const setActiveEngine = vi.fn(async () => undefined);

    const result = await syncKanbanExecutionEngineAndModel({
      activate: true,
      engine: "codex",
      modelId: "gpt-5.4",
      setActiveEngine,
    });

    expect(setActiveEngine).toHaveBeenCalledWith("codex");
    expect(result).toEqual({
      shouldSyncComposerSelection: true,
      outboundModel: undefined,
      composerSelection: {
        modelId: "gpt-5.4",
        effort: null,
      },
    });
  });

  it("returns a claude composer selection for foreground execution without mutating global state", async () => {
    const setActiveEngine = vi.fn(async () => undefined);

    const result = await syncKanbanExecutionEngineAndModel({
      activate: true,
      engine: "claude",
      modelId: "claude-sonnet-4-5",
      setActiveEngine,
    });

    expect(setActiveEngine).toHaveBeenCalledWith("claude");
    expect(result).toEqual({
      shouldSyncComposerSelection: true,
      outboundModel: undefined,
      composerSelection: {
        modelId: "claude-sonnet-4-5",
        effort: null,
      },
    });
  });
});
