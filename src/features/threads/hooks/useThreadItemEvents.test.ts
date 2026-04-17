// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildConversationItem } from "../../../utils/threadItems";
import { useThreadItemEvents } from "./useThreadItemEvents";

vi.mock("../../../utils/threadItems", () => ({
  buildConversationItem: vi.fn(),
}));

type ItemPayload = Record<string, unknown>;

type SetupOverrides = {
  activeThreadId?: string | null;
  getCustomName?: (workspaceId: string, threadId: string) => string | undefined;
  resolveCollaborationUiMode?: (
    threadId: string,
  ) => "plan" | "code" | null;
  onAgentMessageCompletedExternal?: (payload: {
    workspaceId: string;
    threadId: string;
    itemId: string;
    text: string;
  }) => void;
  onExitPlanModeToolCompleted?: (payload: {
    workspaceId: string;
    threadId: string;
    itemId: string;
  }) => void;
};

const makeOptions = (overrides: SetupOverrides = {}) => {
  const dispatch = vi.fn();
  const markProcessing = vi.fn();
  const markReviewing = vi.fn();
  const safeMessageActivity = vi.fn();
  const recordThreadActivity = vi.fn();
  const applyCollabThreadLinks = vi.fn();
  const getCustomName =
    overrides.getCustomName ?? vi.fn(() => undefined);
  const resolveCollaborationUiMode = overrides.resolveCollaborationUiMode ?? undefined;
  const interruptedThreadsRef = {
    current: new Set<string>(),
  };
  const onAgentMessageCompletedExternal =
    overrides.onAgentMessageCompletedExternal ?? undefined;
  const onExitPlanModeToolCompleted =
    overrides.onExitPlanModeToolCompleted ?? undefined;

  const { result, unmount } = renderHook(() =>
    useThreadItemEvents({
      activeThreadId: overrides.activeThreadId ?? null,
      dispatch,
      getCustomName,
      resolveCollaborationUiMode,
      markProcessing,
      markReviewing,
      safeMessageActivity,
      recordThreadActivity,
      applyCollabThreadLinks,
      interruptedThreadsRef,
      onAgentMessageCompletedExternal,
      onExitPlanModeToolCompleted,
    }),
  );

  return {
    result,
    unmount,
    dispatch,
    markProcessing,
    markReviewing,
    safeMessageActivity,
    recordThreadActivity,
    applyCollabThreadLinks,
    getCustomName,
    interruptedThreadsRef,
    onAgentMessageCompletedExternal,
    onExitPlanModeToolCompleted,
  };
};

describe("useThreadItemEvents", () => {
  const convertedItem = {
    id: "item-1",
    kind: "message",
    role: "assistant",
    text: "Hello",
  } as const;

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.removeItem("ccgui.perf.realtimeBatching");
    vi.mocked(buildConversationItem).mockReturnValue(convertedItem);
  });

  it("dispatches item updates and marks review mode on item start", () => {
    const getCustomName = vi.fn(() => "Custom");
    const { result, dispatch, markProcessing, markReviewing, safeMessageActivity, applyCollabThreadLinks } =
      makeOptions({ getCustomName });
    const item: ItemPayload = { type: "enteredReviewMode", id: "item-1" };

    act(() => {
      result.current.onItemStarted("ws-1", "thread-1", item);
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "thread-1",
      engine: "codex",
    });
    expect(markProcessing).toHaveBeenCalledWith("thread-1", true);
    expect(markReviewing).toHaveBeenCalledWith("thread-1", true);
    expect(applyCollabThreadLinks).toHaveBeenCalledWith("thread-1", item);
    expect(dispatch).toHaveBeenCalledWith({
      type: "upsertItem",
      workspaceId: "ws-1",
      threadId: "thread-1",
      item: convertedItem,
      hasCustomName: true,
    });
    expect(safeMessageActivity).toHaveBeenCalled();
  });

  it("handles item updates without incrementing agent segment repeatedly", () => {
    const { result, dispatch, markProcessing } = makeOptions();
    const item: ItemPayload = { type: "commandExecution", id: "cmd-1" };

    act(() => {
      result.current.onItemUpdated("ws-1", "thread-1", item);
    });

    expect(markProcessing).toHaveBeenCalledWith("thread-1", true);
    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "thread-1",
      engine: "codex",
    });
    expect(dispatch).not.toHaveBeenCalledWith({
      type: "incrementAgentSegment",
      threadId: "thread-1",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "upsertItem",
      workspaceId: "ws-1",
      threadId: "thread-1",
      item: convertedItem,
      hasCustomName: false,
    });
  });

  it("routes agentMessage snapshots into assistant streaming delta updates", () => {
    const { result, dispatch, markProcessing, safeMessageActivity } = makeOptions();

    act(() => {
      result.current.onItemUpdated("ws-1", "claude:session-1", {
        type: "agentMessage",
        id: "assistant-1",
        text: "正在输出正文",
      });
    });

    expect(markProcessing).toHaveBeenCalledWith("claude:session-1", true);
    expect(dispatch).toHaveBeenCalledWith({
      type: "appendAgentDelta",
      workspaceId: "ws-1",
      threadId: "claude:session-1",
      itemId: "assistant-1",
      delta: "正在输出正文",
      hasCustomName: false,
    });
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "upsertItem",
        workspaceId: "ws-1",
        threadId: "claude:session-1",
      }),
    );
    expect(safeMessageActivity).toHaveBeenCalled();
  });

  it("marks review/processing false when review mode exits", () => {
    const { result, dispatch, markProcessing, markReviewing, safeMessageActivity } = makeOptions();
    const item: ItemPayload = { type: "exitedReviewMode", id: "review-1" };

    act(() => {
      result.current.onItemCompleted("ws-1", "thread-1", item);
    });

    expect(markReviewing).toHaveBeenCalledWith("thread-1", false);
    expect(markProcessing).toHaveBeenCalledWith("thread-1", false);
    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "thread-1",
      engine: "codex",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "upsertItem",
      workspaceId: "ws-1",
      threadId: "thread-1",
      item: convertedItem,
      hasCustomName: false,
    });
    expect(safeMessageActivity).toHaveBeenCalled();
  });

  it("emits a handoff callback when Claude completes an ExitPlanMode tool", () => {
    const onExitPlanModeToolCompleted = vi.fn();
    vi.mocked(buildConversationItem).mockReturnValue({
      id: "exit-plan-1",
      kind: "tool",
      toolType: "toolCall",
      title: "Claude / exitplanmode",
      detail: "PLAN\n# Plan",
      status: "completed",
    });
    const { result } = makeOptions({ onExitPlanModeToolCompleted });

    act(() => {
      result.current.onItemCompleted("ws-1", "claude:session-1", {
        type: "toolCall",
        id: "exit-plan-1",
      });
    });

    expect(onExitPlanModeToolCompleted).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      threadId: "claude:session-1",
      itemId: "exit-plan-1",
    });
  });

  it("marks processing and appends agent deltas", () => {
    const { result, dispatch, markProcessing, safeMessageActivity } = makeOptions();

    act(() => {
      result.current.onAgentMessageDelta({
        workspaceId: "ws-1",
        threadId: "thread-1",
        itemId: "assistant-1",
        delta: "Hello",
      });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "thread-1",
      engine: "codex",
    });
    expect(markProcessing).toHaveBeenCalledWith("thread-1", true);
    expect(dispatch).toHaveBeenCalledWith({
      type: "appendAgentDelta",
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId: "assistant-1",
      delta: "Hello",
      hasCustomName: false,
    });
    expect(safeMessageActivity).toHaveBeenCalled();
  });

  it("completes agent messages and updates thread activity", () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1234);
    const { result, dispatch, recordThreadActivity, safeMessageActivity } = makeOptions({
      activeThreadId: "thread-2",
    });

    act(() => {
      result.current.onAgentMessageCompleted({
        workspaceId: "ws-1",
        threadId: "thread-1",
        itemId: "assistant-1",
        text: "Done",
      });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "thread-1",
      engine: "codex",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "completeAgentMessage",
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId: "assistant-1",
      text: "Done",
      hasCustomName: false,
      timestamp: 1234,
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "setThreadTimestamp",
      workspaceId: "ws-1",
      threadId: "thread-1",
      timestamp: 1234,
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "setLastAgentMessage",
      threadId: "thread-1",
      text: "Done",
      timestamp: 1234,
    });
    expect(recordThreadActivity).toHaveBeenCalledWith("ws-1", "thread-1", 1234);
    expect(safeMessageActivity).toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith({
      type: "markUnread",
      threadId: "thread-1",
      hasUnread: true,
    });

    nowSpy.mockRestore();
  });

  it("dispatches reasoning summary boundaries through the active processing path", () => {
    const { result, dispatch, markProcessing, safeMessageActivity } = makeOptions();

    act(() => {
      result.current.onReasoningSummaryBoundary("ws-1", "claude:session-1", "reasoning-1");
    });

    expect(dispatch).toHaveBeenNthCalledWith(1, {
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "claude:session-1",
      engine: "claude",
    });
    expect(markProcessing).toHaveBeenCalledWith("claude:session-1", true);
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      type: "appendReasoningSummaryBoundary",
      threadId: "claude:session-1",
      itemId: "reasoning-1",
    });
    expect(safeMessageActivity).toHaveBeenCalled();
  });

  it("dispatches reasoning text deltas through the active processing path", () => {
    const { result, dispatch, markProcessing, safeMessageActivity } = makeOptions();

    act(() => {
      result.current.onReasoningTextDelta(
        "ws-1",
        "claude:session-1",
        "reasoning-1",
        "先检查控制器",
      );
    });

    expect(dispatch).toHaveBeenNthCalledWith(1, {
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "claude:session-1",
      engine: "claude",
    });
    expect(markProcessing).toHaveBeenCalledWith("claude:session-1", true);
    expect(dispatch).toHaveBeenCalledWith({
      type: "appendReasoningContent",
      threadId: "claude:session-1",
      itemId: "reasoning-1",
      delta: "先检查控制器",
    });
    expect(safeMessageActivity).toHaveBeenCalled();
  });

  it("does not re-enable processing for gemini reasoning deltas", () => {
    const { result, dispatch, markProcessing, safeMessageActivity } = makeOptions();

    act(() => {
      result.current.onReasoningTextDelta(
        "ws-1",
        "gemini:session-1",
        "reasoning-1",
        "先确认目录，再组织回答。",
      );
    });

    expect(dispatch).toHaveBeenNthCalledWith(1, {
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "gemini:session-1",
      engine: "gemini",
    });
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      type: "appendReasoningContent",
      threadId: "gemini:session-1",
      itemId: "reasoning-1",
      delta: "先确认目录，再组织回答。",
    });
    expect(markProcessing).not.toHaveBeenCalled();
    expect(safeMessageActivity).toHaveBeenCalled();
  });

  it("skips reasoning deltas for interrupted threads", () => {
    const { result, dispatch, markProcessing, safeMessageActivity, interruptedThreadsRef } =
      makeOptions();
    interruptedThreadsRef.current.add("claude:session-1");

    act(() => {
      result.current.onReasoningSummaryDelta(
        "ws-1",
        "claude:session-1",
        "reasoning-1",
        "晚到的思考",
      );
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(markProcessing).not.toHaveBeenCalled();
    expect(safeMessageActivity).not.toHaveBeenCalled();
  });

  it("anchors the thread before appending command output deltas", () => {
    const { result, dispatch, markProcessing, safeMessageActivity } = makeOptions();

    act(() => {
      result.current.onCommandOutputDelta("ws-1", "claude:session-1", "cmd-1", "partial output");
    });

    expect(dispatch).toHaveBeenNthCalledWith(1, {
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "claude:session-1",
      engine: "claude",
    });
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      type: "appendToolOutput",
      threadId: "claude:session-1",
      itemId: "cmd-1",
      delta: "partial output",
    });
    expect(markProcessing).toHaveBeenCalledWith("claude:session-1", true);
    expect(safeMessageActivity).toHaveBeenCalled();
  });

  it("skips agent message deltas for interrupted threads", () => {
    const { result, dispatch, markProcessing, interruptedThreadsRef } = makeOptions();
    interruptedThreadsRef.current.add("thread-1");

    act(() => {
      result.current.onAgentMessageDelta({
        workspaceId: "ws-1",
        threadId: "thread-1",
        itemId: "assistant-1",
        delta: "late arriving text",
      });
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(markProcessing).not.toHaveBeenCalled();
  });

  it("skips gemini item snapshots for interrupted threads", () => {
    const { result, dispatch, markProcessing, interruptedThreadsRef, safeMessageActivity } =
      makeOptions();
    interruptedThreadsRef.current.add("gemini:session-1");

    act(() => {
      result.current.onItemStarted("ws-1", "gemini:session-1", {
        type: "commandExecution",
        id: "tool-1",
      });
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(markProcessing).not.toHaveBeenCalled();
    expect(safeMessageActivity).not.toHaveBeenCalled();
  });

  it("skips gemini completed agent snapshots for interrupted threads", () => {
    const {
      result,
      dispatch,
      interruptedThreadsRef,
      onAgentMessageCompletedExternal,
    } = makeOptions({
      onAgentMessageCompletedExternal: vi.fn(),
    });
    interruptedThreadsRef.current.add("gemini:session-1");

    act(() => {
      result.current.onAgentMessageCompleted({
        workspaceId: "ws-1",
        threadId: "gemini:session-1",
        itemId: "assistant-1",
        text: "late arriving text",
      });
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(onAgentMessageCompletedExternal).not.toHaveBeenCalled();
  });

  it("bypasses realtime batching for gemini agent deltas", () => {
    vi.useFakeTimers();
    window.localStorage.setItem("ccgui.perf.realtimeBatching", "1");
    const { result, dispatch, markProcessing, safeMessageActivity } = makeOptions();

    act(() => {
      result.current.onAgentMessageDelta({
        workspaceId: "ws-1",
        threadId: "gemini:session-1",
        itemId: "assistant-1",
        delta: "第一段",
      });
    });

    expect(dispatch).toHaveBeenNthCalledWith(1, {
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "gemini:session-1",
      engine: "gemini",
    });
    expect(markProcessing).toHaveBeenCalledWith("gemini:session-1", true);
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      type: "appendAgentDelta",
      workspaceId: "ws-1",
      threadId: "gemini:session-1",
      itemId: "assistant-1",
      delta: "第一段",
      hasCustomName: false,
    });
    expect(safeMessageActivity).toHaveBeenCalledTimes(1);

    vi.runOnlyPendingTimers();
    expect(dispatch).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("calls onAgentMessageCompletedExternal with correct payload", () => {
    const externalCallback = vi.fn();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(5678);
    const { result } = makeOptions({
      onAgentMessageCompletedExternal: externalCallback,
    });

    act(() => {
      result.current.onAgentMessageCompleted({
        workspaceId: "ws-1",
        threadId: "thread-1",
        itemId: "assistant-1",
        text: "Result text",
      });
    });

    expect(externalCallback).toHaveBeenCalledTimes(1);
    expect(externalCallback).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId: "assistant-1",
      text: "Result text",
    });

    nowSpy.mockRestore();
  });

  it("does not throw when onAgentMessageCompletedExternal is not provided", () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(9999);
    const { result } = makeOptions();

    expect(() => {
      act(() => {
        result.current.onAgentMessageCompleted({
          workspaceId: "ws-1",
          threadId: "thread-1",
          itemId: "assistant-1",
          text: "Safe call",
        });
      });
    }).not.toThrow();

    nowSpy.mockRestore();
  });

  it("enriches codex user messages with thread-level collaboration mode when missing", () => {
    vi.mocked(buildConversationItem).mockReturnValue({
      id: "user-1",
      kind: "message",
      role: "user",
      text: "请先计划",
      collaborationMode: null,
    });
    const { result, dispatch } = makeOptions({
      resolveCollaborationUiMode: () => "plan",
    });
    const item: ItemPayload = {
      type: "userMessage",
      id: "user-1",
    };

    act(() => {
      result.current.onItemStarted("ws-1", "thread-1", item);
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "upsertItem",
      workspaceId: "ws-1",
      threadId: "thread-1",
      item: {
        id: "user-1",
        kind: "message",
        role: "user",
        text: "请先计划",
        collaborationMode: "plan",
      },
      hasCustomName: false,
    });
  });

  it("accepts claude reasoning snapshot upsert so live state can converge to history", () => {
    vi.mocked(buildConversationItem).mockReturnValue({
      id: "reasoning-1",
      kind: "reasoning",
      summary: "思考",
      content: "思考内容",
    });
    const { result, dispatch, safeMessageActivity } = makeOptions();

    act(() => {
      result.current.onItemUpdated("ws-1", "claude:session-1", {
        type: "reasoning",
        id: "reasoning-1",
        text: "思考内容",
      });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "claude:session-1",
      engine: "claude",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "upsertItem",
      workspaceId: "ws-1",
      threadId: "claude:session-1",
      item: {
        id: "reasoning-1",
        kind: "reasoning",
        summary: "思考",
        content: "思考内容",
      },
      hasCustomName: false,
    });
    expect(safeMessageActivity).toHaveBeenCalled();
  });

  it("batches realtime deltas in one flush window while preserving operation order", () => {
    vi.useFakeTimers();
    window.localStorage.setItem("ccgui.perf.realtimeBatching", "1");
    const { result, dispatch, markProcessing, safeMessageActivity } = makeOptions();

    act(() => {
      result.current.onAgentMessageDelta({
        workspaceId: "ws-1",
        threadId: "claude:session-1",
        itemId: "assistant-1",
        delta: "A",
      });
      result.current.onReasoningTextDelta(
        "ws-1",
        "claude:session-1",
        "reasoning-1",
        "B",
      );
      result.current.onAgentMessageDelta({
        workspaceId: "ws-1",
        threadId: "claude:session-1",
        itemId: "assistant-1",
        delta: "C",
      });
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(markProcessing).not.toHaveBeenCalled();
    expect(safeMessageActivity).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(20);
    });

    expect(dispatch).toHaveBeenNthCalledWith(1, {
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "claude:session-1",
      engine: "claude",
    });
    expect(markProcessing).toHaveBeenCalledTimes(1);
    expect(markProcessing).toHaveBeenCalledWith("claude:session-1", true);
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      type: "appendAgentDelta",
      workspaceId: "ws-1",
      threadId: "claude:session-1",
      itemId: "assistant-1",
      delta: "A",
      hasCustomName: false,
    });
    expect(dispatch).toHaveBeenNthCalledWith(3, {
      type: "appendReasoningContent",
      threadId: "claude:session-1",
      itemId: "reasoning-1",
      delta: "B",
    });
    expect(dispatch).toHaveBeenNthCalledWith(4, {
      type: "appendAgentDelta",
      workspaceId: "ws-1",
      threadId: "claude:session-1",
      itemId: "assistant-1",
      delta: "C",
      hasCustomName: false,
    });
    expect(safeMessageActivity).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("flushes buffered realtime deltas on unmount so the last batch is not dropped", () => {
    vi.useFakeTimers();
    window.localStorage.setItem("ccgui.perf.realtimeBatching", "1");
    const { result, dispatch, markProcessing, safeMessageActivity, unmount } = makeOptions();

    act(() => {
      result.current.onAgentMessageDelta({
        workspaceId: "ws-1",
        threadId: "claude:session-1",
        itemId: "assistant-1",
        delta: "closing text",
      });
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(markProcessing).not.toHaveBeenCalled();
    expect(safeMessageActivity).not.toHaveBeenCalled();

    act(() => {
      unmount();
    });

    expect(dispatch).toHaveBeenNthCalledWith(1, {
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "claude:session-1",
      engine: "claude",
    });
    expect(markProcessing).toHaveBeenCalledWith("claude:session-1", true);
    expect(dispatch).toHaveBeenNthCalledWith(2, {
      type: "appendAgentDelta",
      workspaceId: "ws-1",
      threadId: "claude:session-1",
      itemId: "assistant-1",
      delta: "closing text",
      hasCustomName: false,
    });
    expect(safeMessageActivity).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });
});
