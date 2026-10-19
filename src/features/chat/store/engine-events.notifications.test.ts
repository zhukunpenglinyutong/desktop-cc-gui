import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleEngineEvents, settledRuns, type EngineEventDeps } from "./engine-events";
import type { Message } from "@/lib/ipc";
import type { ChatStore } from "./types";
import { EMPTY_SESSION, runRouting } from "./stream";
import * as notifications from "@/lib/notifications";

vi.mock("@/lib/notifications", () => ({
  notifyTurnComplete: vi.fn(),
  notifyInterrupted: vi.fn(),
  notifyTurnError: vi.fn(),
  notifyQuestion: vi.fn(),
  notifyPlanReview: vi.fn(),
  notifyPermissionRequest: vi.fn(),
}));

vi.mock("@/lib/ipc", () => ({
  ipc: {
    rescanSessions: vi.fn(async () => []),
    usageRecord: vi.fn(async () => {}),
  },
}));

describe("engine-events notifications", () => {
  const KEY = "claude:s-1:/ws";

  beforeEach(() => {
    vi.clearAllMocks();
    settledRuns.clear();
    runRouting.clear();
  });

  function createDeps(initialInterrupted = false, runId = "r-1") {
    runRouting.set(runId, KEY);
    const messages: Message[] = [
      { role: "user", text: "hi", ts: "1", seq: 1 },
      { role: "assistant", text: "hello world", ts: "2", seq: 2 },
    ];
    const session = {
      ...EMPTY_SESSION,
      interrupted: initialInterrupted,
      streaming: true,
      messages,
    };
    const state = {
      bySession: { [KEY]: session },
      openTabs: [],
      streamingByKey: { [KEY]: true },
      retryingByKey: {},
      models: {},
      efforts: {},
    };
    const deps: EngineEventDeps = {
      set: (fn) => {
        const patch = typeof fn === "function" ? fn(state as unknown as ChatStore) : fn;
        Object.assign(state, patch);
        if (patch.bySession?.[KEY]) {
          state.bySession[KEY] = { ...state.bySession[KEY], ...patch.bySession[KEY] };
        }
      },
      get: () => state as unknown as ChatStore,
      drainQueue: vi.fn(),
      markUnseenIfBackground: vi.fn(),
      upsertSessionMeta: vi.fn(),
    };
    return { state, deps };
  }

  it("triggers notifyTurnComplete on normal onDone when not interrupted", () => {
    const { deps } = createDeps(false);
    handleEngineEvents(
      [{ runId: "r-1", sessionId: "s-1", engine: "claude", seq: 3, kind: "done", data: { usage: null } }],
      deps,
    );
    expect(notifications.notifyTurnComplete).toHaveBeenCalledWith(KEY, "hello world");
    expect(notifications.notifyInterrupted).not.toHaveBeenCalled();
    expect(notifications.notifyTurnError).not.toHaveBeenCalled();
  });

  it("does NOT trigger notifyInterrupted onDone when user manually interrupted", () => {
    const { deps } = createDeps(true);
    handleEngineEvents(
      [{ runId: "r-1", sessionId: "s-1", engine: "claude", seq: 3, kind: "done", data: { usage: null } }],
      deps,
    );
    expect(notifications.notifyTurnComplete).not.toHaveBeenCalled();
    expect(notifications.notifyInterrupted).not.toHaveBeenCalled();
    expect(notifications.notifyTurnError).not.toHaveBeenCalled();
  });

  it("does NOT trigger notifications onError when user manually interrupted", () => {
    const { deps } = createDeps(true);
    handleEngineEvents(
      [{ runId: "r-1", sessionId: "s-1", engine: "claude", seq: 3, kind: "error", data: "stream closed" }],
      deps,
    );
    expect(notifications.notifyTurnError).not.toHaveBeenCalled();
    expect(notifications.notifyInterrupted).not.toHaveBeenCalled();
  });

  it("triggers notifyInterrupted onError when API/stream is disconnected and user did not interrupt", () => {
    const { deps } = createDeps(false);
    handleEngineEvents(
      [{ runId: "r-1", sessionId: "s-1", engine: "claude", seq: 3, kind: "error", data: "dsh 会话流中断：连接超时" }],
      deps,
    );
    expect(notifications.notifyInterrupted).toHaveBeenCalledWith(KEY, "dsh 会话流中断：连接超时");
    expect(notifications.notifyTurnError).not.toHaveBeenCalled();
  });

  it("triggers notifyTurnError onError on general errors when user did not interrupt", () => {
    const { deps } = createDeps(false);
    handleEngineEvents(
      [{ runId: "r-1", sessionId: "s-1", engine: "claude", seq: 3, kind: "error", data: "401 Unauthorized" }],
      deps,
    );
    expect(notifications.notifyTurnError).toHaveBeenCalledWith(KEY, "401 Unauthorized");
    expect(notifications.notifyInterrupted).not.toHaveBeenCalled();
  });
});
