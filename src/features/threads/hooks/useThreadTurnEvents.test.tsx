// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { engineInterrupt, interruptTurn } from "../../../services/tauri";
import {
  normalizePlanUpdate,
  normalizeRateLimits,
  normalizeTokenUsage,
} from "../utils/threadNormalize";
import { useThreadTurnEvents } from "./useThreadTurnEvents";

vi.mock("../../../services/tauri", () => ({
  engineInterrupt: vi.fn(),
  interruptTurn: vi.fn(),
}));

vi.mock("../utils/threadNormalize", () => ({
  asString: (value: unknown) =>
    typeof value === "string" ? value : value ? String(value) : "",
  normalizePlanUpdate: vi.fn(),
  normalizeRateLimits: vi.fn(),
  normalizeTokenUsage: vi.fn(),
}));

type SetupOverrides = {
  pendingInterrupts?: string[];
  interruptedThreads?: string[];
  activeThreadId?: string | null;
};

const makeOptions = (overrides: SetupOverrides = {}) => {
  const dispatch = vi.fn();
  const getCustomName = vi.fn();
  const isAutoTitlePending = vi.fn(() => false);
  const isThreadHidden = vi.fn(() => false);
  const markProcessing = vi.fn();
  const markReviewing = vi.fn();
  const setActiveTurnId = vi.fn();
  const pushThreadErrorMessage = vi.fn();
  const safeMessageActivity = vi.fn();
  const recordThreadActivity = vi.fn();
  const renameCustomNameKey = vi.fn();
  const renameAutoTitlePendingKey = vi.fn();
  const renameThreadTitleMapping = vi.fn();
  const resolvePendingThreadForSession = vi.fn();
  const renamePendingMemoryCaptureKey = vi.fn();
  const pendingInterruptsRef = {
    current: new Set(overrides.pendingInterrupts ?? []),
  };
  const interruptedThreadsRef = {
    current: new Set(overrides.interruptedThreads ?? []),
  };

  const { result } = renderHook(() =>
    useThreadTurnEvents({
      activeThreadId: overrides.activeThreadId ?? null,
      dispatch,
      getCustomName,
      isAutoTitlePending,
      isThreadHidden,
      markProcessing,
      markReviewing,
      setActiveTurnId,
      pendingInterruptsRef,
      interruptedThreadsRef,
      pushThreadErrorMessage,
      safeMessageActivity,
      recordThreadActivity,
      renameCustomNameKey,
      renameAutoTitlePendingKey,
      renameThreadTitleMapping,
      resolvePendingThreadForSession,
      renamePendingMemoryCaptureKey,
    }),
  );

  return {
    result,
    dispatch,
    getCustomName,
    isAutoTitlePending,
    isThreadHidden,
    markProcessing,
    markReviewing,
    setActiveTurnId,
    pushThreadErrorMessage,
    safeMessageActivity,
    recordThreadActivity,
    renameCustomNameKey,
    renameAutoTitlePendingKey,
    renameThreadTitleMapping,
    resolvePendingThreadForSession,
    renamePendingMemoryCaptureKey,
    pendingInterruptsRef,
    interruptedThreadsRef,
  };
};

describe("useThreadTurnEvents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(engineInterrupt).mockResolvedValue();
  });

  it("upserts thread summaries when a thread starts", () => {
    const { result, dispatch, recordThreadActivity, safeMessageActivity } =
      makeOptions();

    act(() => {
      result.current.onThreadStarted("ws-1", {
        id: "thread-1",
        preview: "A brand new thread",
        updatedAt: 1_700_000_000_000,
      });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "thread-1",
      engine: "codex",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "setThreadTimestamp",
      workspaceId: "ws-1",
      threadId: "thread-1",
      timestamp: 1_700_000_000_000,
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "setThreadName",
      workspaceId: "ws-1",
      threadId: "thread-1",
      name: "A brand new thread",
    });
    expect(recordThreadActivity).toHaveBeenCalledWith(
      "ws-1",
      "thread-1",
      1_700_000_000_000,
    );
    expect(safeMessageActivity).toHaveBeenCalled();
  });

  it("does not override custom thread names on thread started", () => {
    const { result, dispatch, getCustomName } = makeOptions();
    getCustomName.mockReturnValue("Custom name");

    act(() => {
      result.current.onThreadStarted("ws-1", {
        id: "thread-2",
        preview: "Preview text",
        updatedAt: 1_700_000_000_100,
      });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "thread-2",
      engine: "codex",
    });
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "setThreadName",
        workspaceId: "ws-1",
        threadId: "thread-2",
      }),
    );
  });

  it("does not override thread name when auto-title generation is pending", () => {
    const { result, dispatch, isAutoTitlePending } = makeOptions();
    isAutoTitlePending.mockReturnValue(true);

    act(() => {
      result.current.onThreadStarted("ws-1", {
        id: "thread-3",
        preview: "Preview that should be ignored",
        updatedAt: 1_700_000_000_300,
      });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "thread-3",
      engine: "codex",
    });
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "setThreadName",
        workspaceId: "ws-1",
        threadId: "thread-3",
      }),
    );
  });

  it("ignores thread started events for hidden threads", () => {
    const { result, dispatch, isThreadHidden, recordThreadActivity, safeMessageActivity } =
      makeOptions();
    isThreadHidden.mockReturnValue(true);

    act(() => {
      result.current.onThreadStarted("ws-1", {
        id: "thread-hidden",
        preview: "Hidden thread",
        updatedAt: 1_700_000_000_200,
      });
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(recordThreadActivity).not.toHaveBeenCalled();
    expect(safeMessageActivity).not.toHaveBeenCalled();
  });

  it("suppresses Codex helper threads on thread started", () => {
    const { result, dispatch, recordThreadActivity, safeMessageActivity } = makeOptions();

    act(() => {
      result.current.onThreadStarted("ws-1", {
        id: "thread-helper-1",
        preview:
          "You are generating OpenSpec project context.\nReturn ONLY valid JSON with keys:",
        updatedAt: 1_700_000_000_250,
      });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "hideThread",
      workspaceId: "ws-1",
      threadId: "thread-helper-1",
    });
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "ensureThread",
        workspaceId: "ws-1",
        threadId: "thread-helper-1",
      }),
    );
    expect(recordThreadActivity).not.toHaveBeenCalled();
    expect(safeMessageActivity).not.toHaveBeenCalled();
  });

  it("does not suppress non-Codex threads even when preview resembles helper prompts", () => {
    const { result, dispatch, recordThreadActivity, safeMessageActivity } = makeOptions();

    act(() => {
      result.current.onThreadStarted("ws-1", {
        id: "claude:session-1",
        preview:
          "You are generating OpenSpec project context.\nReturn ONLY valid JSON with keys:",
        updatedAt: 1_700_000_000_260,
      });
    });

    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "hideThread",
        workspaceId: "ws-1",
        threadId: "claude:session-1",
      }),
    );
    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "claude:session-1",
      engine: "claude",
    });
    expect(recordThreadActivity).toHaveBeenCalledWith(
      "ws-1",
      "claude:session-1",
      1_700_000_000_260,
    );
    expect(safeMessageActivity).toHaveBeenCalled();
  });

  it("marks processing and active turn on turn started", () => {
    const { result, dispatch, markProcessing, setActiveTurnId } = makeOptions();

    act(() => {
      result.current.onTurnStarted("ws-1", "thread-1", "turn-1");
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "thread-1",
      engine: "codex",
    });
    expect(markProcessing).toHaveBeenCalledWith("thread-1", true);
    expect(setActiveTurnId).toHaveBeenCalledWith("thread-1", "turn-1");
    expect(interruptTurn).not.toHaveBeenCalled();
  });

  it("interrupts immediately when a pending interrupt is queued", () => {
    const { result, markProcessing, setActiveTurnId, pendingInterruptsRef } =
      makeOptions({ pendingInterrupts: ["thread-1"] });
    vi.mocked(interruptTurn).mockResolvedValue({});

    act(() => {
      result.current.onTurnStarted("ws-1", "thread-1", "turn-2");
    });

    expect(pendingInterruptsRef.current.has("thread-1")).toBe(false);
    expect(interruptTurn).toHaveBeenCalledWith("ws-1", "thread-1", "turn-2");
    expect(markProcessing).not.toHaveBeenCalled();
    expect(setActiveTurnId).not.toHaveBeenCalled();
  });

  it("routes pending gemini interrupts through engine interrupt only", () => {
    const { result, markProcessing, setActiveTurnId, pendingInterruptsRef } =
      makeOptions({ pendingInterrupts: ["gemini:session-1"] });
    vi.mocked(engineInterrupt).mockResolvedValue();

    act(() => {
      result.current.onTurnStarted("ws-1", "gemini:session-1", "turn-2");
    });

    expect(pendingInterruptsRef.current.has("gemini:session-1")).toBe(false);
    expect(engineInterrupt).toHaveBeenCalledWith("ws-1");
    expect(interruptTurn).not.toHaveBeenCalled();
    expect(markProcessing).not.toHaveBeenCalled();
    expect(setActiveTurnId).not.toHaveBeenCalled();
  });

  it("clears pending interrupt and active turn on turn completed", () => {
    const { result, dispatch, markProcessing, setActiveTurnId, pendingInterruptsRef } =
      makeOptions({ pendingInterrupts: ["thread-1"] });

    act(() => {
      result.current.onTurnCompleted("ws-1", "thread-1", "turn-1");
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "finalizePendingToolStatuses",
      threadId: "thread-1",
      status: "completed",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "settleThreadPlanInProgress",
      threadId: "thread-1",
      targetStatus: "completed",
    });
    expect(markProcessing).toHaveBeenCalledWith("thread-1", false);
    expect(setActiveTurnId).toHaveBeenCalledWith("thread-1", null);
    expect(pendingInterruptsRef.current.has("thread-1")).toBe(false);
  });

  it("also settles pending alias thread on completed event", () => {
    const {
      result,
      dispatch,
      markProcessing,
      setActiveTurnId,
      resolvePendingThreadForSession,
    } = makeOptions();
    resolvePendingThreadForSession.mockImplementation(
      (_workspaceId: string, engine: "claude" | "gemini" | "opencode") =>
        engine === "opencode" ? "opencode-pending-abc" : null,
    );

    act(() => {
      result.current.onTurnCompleted("ws-1", "opencode:session-1", "turn-1");
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "finalizePendingToolStatuses",
      threadId: "opencode:session-1",
      status: "completed",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "settleThreadPlanInProgress",
      threadId: "opencode:session-1",
      targetStatus: "completed",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "finalizePendingToolStatuses",
      threadId: "opencode-pending-abc",
      status: "completed",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "settleThreadPlanInProgress",
      threadId: "opencode-pending-abc",
      targetStatus: "completed",
    });
    expect(markProcessing).toHaveBeenCalledWith("opencode:session-1", false);
    expect(markProcessing).toHaveBeenCalledWith("opencode-pending-abc", false);
    expect(setActiveTurnId).toHaveBeenCalledWith("opencode:session-1", null);
    expect(setActiveTurnId).toHaveBeenCalledWith("opencode-pending-abc", null);
  });

  it("renames local mappings when claude pending thread gets real session id", () => {
    const {
      result,
      dispatch,
      renameCustomNameKey,
      renameAutoTitlePendingKey,
      renameThreadTitleMapping,
      renamePendingMemoryCaptureKey,
    } = makeOptions();

    act(() => {
      result.current.onThreadSessionIdUpdated(
        "ws-1",
        "claude-pending-abc",
        "session-xyz",
      );
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "renameThreadId",
      workspaceId: "ws-1",
      oldThreadId: "claude-pending-abc",
      newThreadId: "claude:session-xyz",
    });
    expect(renameCustomNameKey).toHaveBeenCalledWith(
      "ws-1",
      "claude-pending-abc",
      "claude:session-xyz",
    );
    expect(renameAutoTitlePendingKey).toHaveBeenCalledWith(
      "ws-1",
      "claude-pending-abc",
      "claude:session-xyz",
    );
    expect(renamePendingMemoryCaptureKey).toHaveBeenCalledWith(
      "claude-pending-abc",
      "claude:session-xyz",
    );
    expect(renameThreadTitleMapping).toHaveBeenCalledWith(
      "ws-1",
      "claude-pending-abc",
      "claude:session-xyz",
    );
  });

  it("renames local mappings when opencode pending thread gets real session id", () => {
    const {
      result,
      dispatch,
      renameCustomNameKey,
      renameAutoTitlePendingKey,
      renameThreadTitleMapping,
    } = makeOptions();

    act(() => {
      result.current.onThreadSessionIdUpdated(
        "ws-1",
        "opencode-pending-abc",
        "session-xyz",
      );
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "renameThreadId",
      workspaceId: "ws-1",
      oldThreadId: "opencode-pending-abc",
      newThreadId: "opencode:session-xyz",
    });
    expect(renameCustomNameKey).toHaveBeenCalledWith(
      "ws-1",
      "opencode-pending-abc",
      "opencode:session-xyz",
    );
    expect(renameAutoTitlePendingKey).toHaveBeenCalledWith(
      "ws-1",
      "opencode-pending-abc",
      "opencode:session-xyz",
    );
    expect(renameThreadTitleMapping).toHaveBeenCalledWith(
      "ws-1",
      "opencode-pending-abc",
      "opencode:session-xyz",
    );
  });

  it("does not fallback to pending when event thread id is same-engine finalized", () => {
    const {
      result,
      dispatch,
      renameCustomNameKey,
      renameAutoTitlePendingKey,
      renameThreadTitleMapping,
      resolvePendingThreadForSession,
    } = makeOptions();
    resolvePendingThreadForSession.mockReturnValue("opencode-pending-active");

    act(() => {
      result.current.onThreadSessionIdUpdated(
        "ws-1",
        "opencode:temp",
        "session-xyz",
      );
    });

    expect(resolvePendingThreadForSession).toHaveBeenCalledWith("ws-1", "opencode");
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "renameThreadId",
      }),
    );
    expect(renameCustomNameKey).not.toHaveBeenCalled();
    expect(renameAutoTitlePendingKey).not.toHaveBeenCalled();
    expect(renameThreadTitleMapping).not.toHaveBeenCalled();
  });

  it("does not remap pending thread when event thread id is already finalized", () => {
    const {
      result,
      dispatch,
      renameCustomNameKey,
      renameAutoTitlePendingKey,
      renameThreadTitleMapping,
      resolvePendingThreadForSession,
      renamePendingMemoryCaptureKey,
    } = makeOptions();
    resolvePendingThreadForSession.mockImplementation(
      (_workspaceId: string, engine: "claude" | "gemini" | "opencode") =>
        engine === "claude" ? "claude-pending-active" : null,
    );

    act(() => {
      result.current.onThreadSessionIdUpdated(
        "ws-1",
        "claude:session-xyz",
        "session-xyz",
      );
    });

    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "renameThreadId",
      }),
    );
    expect(renameCustomNameKey).not.toHaveBeenCalled();
    expect(renameAutoTitlePendingKey).not.toHaveBeenCalled();
    expect(renamePendingMemoryCaptureKey).not.toHaveBeenCalled();
    expect(renameThreadTitleMapping).not.toHaveBeenCalled();
  });

  it("does not rename finalized opencode thread when no pending mapping exists", () => {
    const {
      result,
      dispatch,
      renameCustomNameKey,
      renameAutoTitlePendingKey,
      renameThreadTitleMapping,
      resolvePendingThreadForSession,
    } = makeOptions();
    resolvePendingThreadForSession.mockReturnValue(null);

    act(() => {
      result.current.onThreadSessionIdUpdated(
        "ws-1",
        "opencode:session-old",
        "session-new",
      );
    });

    expect(resolvePendingThreadForSession).toHaveBeenCalledWith("ws-1", "opencode");
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "renameThreadId",
      }),
    );
    expect(renameCustomNameKey).not.toHaveBeenCalled();
    expect(renameAutoTitlePendingKey).not.toHaveBeenCalled();
    expect(renameThreadTitleMapping).not.toHaveBeenCalled();
  });

  it("does not rename finalized claude thread when no pending mapping exists", () => {
    const {
      result,
      dispatch,
      renameCustomNameKey,
      renameAutoTitlePendingKey,
      renameThreadTitleMapping,
      resolvePendingThreadForSession,
    } = makeOptions();
    resolvePendingThreadForSession.mockReturnValue(null);

    act(() => {
      result.current.onThreadSessionIdUpdated(
        "ws-1",
        "claude:session-old",
        "session-new",
      );
    });

    expect(resolvePendingThreadForSession).toHaveBeenCalledWith("ws-1", "claude");
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "renameThreadId",
      }),
    );
    expect(renameCustomNameKey).not.toHaveBeenCalled();
    expect(renameAutoTitlePendingKey).not.toHaveBeenCalled();
    expect(renameThreadTitleMapping).not.toHaveBeenCalled();
  });

  it("rebinds active finalized claude thread when session id rotates", () => {
    const {
      result,
      dispatch,
      renameCustomNameKey,
      renameAutoTitlePendingKey,
      renameThreadTitleMapping,
      renamePendingMemoryCaptureKey,
      resolvePendingThreadForSession,
    } = makeOptions({
      activeThreadId: "claude:session-old",
    });
    resolvePendingThreadForSession.mockReturnValue(null);

    act(() => {
      result.current.onThreadSessionIdUpdated(
        "ws-1",
        "claude:session-old",
        "session-new",
      );
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "renameThreadId",
      workspaceId: "ws-1",
      oldThreadId: "claude:session-old",
      newThreadId: "claude:session-new",
    });
    expect(renameCustomNameKey).toHaveBeenCalledWith(
      "ws-1",
      "claude:session-old",
      "claude:session-new",
    );
    expect(renameAutoTitlePendingKey).toHaveBeenCalledWith(
      "ws-1",
      "claude:session-old",
      "claude:session-new",
    );
    expect(renamePendingMemoryCaptureKey).toHaveBeenCalledWith(
      "claude:session-old",
      "claude:session-new",
    );
    expect(renameThreadTitleMapping).toHaveBeenCalledWith(
      "ws-1",
      "claude:session-old",
      "claude:session-new",
    );
  });

  it("infers engine from pending threads when session update thread id has no engine prefix", () => {
    const {
      result,
      dispatch,
      renameCustomNameKey,
      renameAutoTitlePendingKey,
      renameThreadTitleMapping,
      resolvePendingThreadForSession,
    } = makeOptions();
    resolvePendingThreadForSession.mockImplementation(
      (_workspaceId: string, engine: "claude" | "gemini" | "opencode") =>
        engine === "opencode" ? "opencode-pending-active" : null,
    );

    act(() => {
      result.current.onThreadSessionIdUpdated(
        "ws-1",
        "session-raw-id",
        "session-xyz",
      );
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "renameThreadId",
      workspaceId: "ws-1",
      oldThreadId: "opencode-pending-active",
      newThreadId: "opencode:session-xyz",
    });
    expect(renameCustomNameKey).toHaveBeenCalledWith(
      "ws-1",
      "opencode-pending-active",
      "opencode:session-xyz",
    );
    expect(renameAutoTitlePendingKey).toHaveBeenCalledWith(
      "ws-1",
      "opencode-pending-active",
      "opencode:session-xyz",
    );
    expect(renameThreadTitleMapping).toHaveBeenCalledWith(
      "ws-1",
      "opencode-pending-active",
      "opencode:session-xyz",
    );
  });

  it("does not rename ambiguously when both claude and opencode pending threads exist", () => {
    const {
      result,
      dispatch,
      renameCustomNameKey,
      renameAutoTitlePendingKey,
      renameThreadTitleMapping,
      resolvePendingThreadForSession,
    } = makeOptions();
    resolvePendingThreadForSession.mockImplementation(
      (_workspaceId: string, engine: "claude" | "gemini" | "opencode") =>
        engine === "opencode" ? "opencode-pending-active" : "claude-pending-active",
    );

    act(() => {
      result.current.onThreadSessionIdUpdated(
        "ws-1",
        "session-raw-id",
        "session-xyz",
      );
    });

    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "renameThreadId",
      }),
    );
    expect(renameCustomNameKey).not.toHaveBeenCalled();
    expect(renameAutoTitlePendingKey).not.toHaveBeenCalled();
    expect(renameThreadTitleMapping).not.toHaveBeenCalled();
  });

  it("does not rename non-prefixed source thread id when no pending mapping exists", () => {
    const {
      result,
      dispatch,
      renameCustomNameKey,
      renameAutoTitlePendingKey,
      renameThreadTitleMapping,
      resolvePendingThreadForSession,
    } = makeOptions();
    resolvePendingThreadForSession.mockReturnValue(null);

    act(() => {
      result.current.onThreadSessionIdUpdated(
        "ws-1",
        "2112",
        "ses_abc",
        "opencode",
      );
    });

    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "renameThreadId",
      }),
    );
    expect(renameCustomNameKey).not.toHaveBeenCalled();
    expect(renameAutoTitlePendingKey).not.toHaveBeenCalled();
    expect(renameThreadTitleMapping).not.toHaveBeenCalled();
  });

  it("dispatches normalized plan updates", () => {
    const { result, dispatch } = makeOptions();
    const normalized = { id: "turn-3", steps: [] };

    vi.mocked(normalizePlanUpdate).mockReturnValue(normalized as never);

    act(() => {
      result.current.onTurnPlanUpdated("ws-1", "thread-1", "turn-3", {
        explanation: "Plan",
        plan: [{ id: "step-1" }],
      });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "thread-1",
      engine: "codex",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "setThreadPlan",
      threadId: "thread-1",
      plan: normalized,
    });
  });

  it("dispatches normalized token usage updates", () => {
    const { result, dispatch } = makeOptions();
    const normalized = { total: 123 };

    vi.mocked(normalizeTokenUsage).mockReturnValue(normalized as never);

    act(() => {
      result.current.onThreadTokenUsageUpdated("ws-1", "thread-1", {
        total: 123,
      });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "thread-1",
      engine: "codex",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "setThreadTokenUsage",
      threadId: "thread-1",
      tokenUsage: normalized,
    });
  });

  it("dispatches normalized rate limits updates", () => {
    const { result, dispatch } = makeOptions();
    const normalized = { primary: { usedPercent: 10 } };

    vi.mocked(normalizeRateLimits).mockReturnValue(normalized as never);

    act(() => {
      result.current.onAccountRateLimitsUpdated("ws-1", { primary: {} });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "setRateLimits",
      workspaceId: "ws-1",
      rateLimits: normalized,
    });
  });

  it("handles turn errors when retries are disabled", () => {
    const {
      result,
      dispatch,
      markProcessing,
      markReviewing,
      setActiveTurnId,
      pushThreadErrorMessage,
      safeMessageActivity,
    } = makeOptions();

    act(() => {
      result.current.onTurnError("ws-1", "thread-1", "turn-1", {
        message: "boom",
        willRetry: false,
      });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "thread-1",
      engine: "codex",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "finalizePendingToolStatuses",
      threadId: "thread-1",
      status: "failed",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "settleThreadPlanInProgress",
      threadId: "thread-1",
      targetStatus: "pending",
    });
    expect(markProcessing).toHaveBeenCalledWith("thread-1", false);
    expect(markReviewing).toHaveBeenCalledWith("thread-1", false);
    expect(setActiveTurnId).toHaveBeenCalledWith("thread-1", null);
    expect(pushThreadErrorMessage).toHaveBeenCalledWith(
      "thread-1",
      "会话失败：boom",
    );
    expect(safeMessageActivity).toHaveBeenCalled();
  });

  it("ignores turn errors that will retry", () => {
    const { result, dispatch, markProcessing } = makeOptions();

    act(() => {
      result.current.onTurnError("ws-1", "thread-1", "turn-1", {
        message: "boom",
        willRetry: true,
      });
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(markProcessing).not.toHaveBeenCalled();
  });

  it("appends a context compacted message and records activity", () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(2222);
    const { result, dispatch, recordThreadActivity, safeMessageActivity } = makeOptions();

    act(() => {
      result.current.onContextCompacted("ws-1", "thread-1", "turn-9");
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "thread-1",
      engine: "codex",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "appendContextCompacted",
      threadId: "thread-1",
      turnId: "turn-9",
    });
    expect(recordThreadActivity).toHaveBeenCalledWith("ws-1", "thread-1", 2222);
    expect(safeMessageActivity).toHaveBeenCalled();

    nowSpy.mockRestore();
  });

  it("falls back to synthetic turn id when context compacted event has no turn id", () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(3333);
    const { result, dispatch } = makeOptions();

    act(() => {
      result.current.onContextCompacted("ws-1", "thread-1", "");
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "appendContextCompacted",
      threadId: "thread-1",
      turnId: "auto-3333",
    });

    nowSpy.mockRestore();
  });

  it("pushes thread error when context compaction fails", () => {
    const { result, dispatch, pushThreadErrorMessage, safeMessageActivity } = makeOptions();

    act(() => {
      result.current.onContextCompactionFailed("ws-1", "thread-1", "rpc failed");
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "thread-1",
      engine: "codex",
    });
    expect(pushThreadErrorMessage).toHaveBeenCalledWith(
      "thread-1",
      "threads.contextCompactionFailedWithMessage",
    );
    expect(safeMessageActivity).toHaveBeenCalled();
  });

  it("suppresses error message for user-interrupted threads", () => {
    const {
      result,
      dispatch,
      markProcessing,
      markReviewing,
      setActiveTurnId,
      pushThreadErrorMessage,
      safeMessageActivity,
      interruptedThreadsRef,
    } = makeOptions({ interruptedThreads: ["thread-1"] });

    act(() => {
      result.current.onTurnError("ws-1", "thread-1", "turn-1", {
        message: "Session stopped.",
        willRetry: false,
      });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "thread-1",
      engine: "codex",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "finalizePendingToolStatuses",
      threadId: "thread-1",
      status: "failed",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "settleThreadPlanInProgress",
      threadId: "thread-1",
      targetStatus: "pending",
    });
    expect(markProcessing).toHaveBeenCalledWith("thread-1", false);
    expect(markReviewing).toHaveBeenCalledWith("thread-1", false);
    expect(setActiveTurnId).toHaveBeenCalledWith("thread-1", null);
    // Error message should NOT be shown for interrupted threads
    expect(pushThreadErrorMessage).not.toHaveBeenCalled();
    expect(safeMessageActivity).toHaveBeenCalled();
    // Interrupted flag should be cleared
    expect(interruptedThreadsRef.current.has("thread-1")).toBe(false);
  });

  it("keeps gemini interrupted flag until a later terminal cleanup", () => {
    const { result, interruptedThreadsRef, pushThreadErrorMessage } = makeOptions({
      interruptedThreads: ["gemini:session-1"],
    });

    act(() => {
      result.current.onTurnError("ws-1", "gemini:session-1", "turn-1", {
        message: "Session stopped.",
        willRetry: false,
      });
    });

    expect(pushThreadErrorMessage).not.toHaveBeenCalled();
    expect(interruptedThreadsRef.current.has("gemini:session-1")).toBe(true);
  });

  it("clears interrupted thread flag on turn completed", () => {
    const { result, interruptedThreadsRef } = makeOptions({
      interruptedThreads: ["thread-1"],
    });

    act(() => {
      result.current.onTurnCompleted("ws-1", "thread-1", "turn-1");
    });

    expect(interruptedThreadsRef.current.has("thread-1")).toBe(false);
  });
});
