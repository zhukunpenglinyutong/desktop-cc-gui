import { beforeEach, describe, expect, it, vi } from "vitest";
import { ipc, type EngineInfo } from "@/lib/ipc";

/**
 * 电脑操控 (computer use) send path: the `/ccgui-cua <task>` flag has to
 * reach `sendMessage` (that is what mounts the driver backend-side), and an
 * engine that cannot mount it must be refused up front — never sent as an
 * ordinary chat the user did not ask for.
 */

vi.mock("@/lib/ipc", () => ({
  ipc: {
    sendMessage: vi.fn(async () => ({ runId: "run-1", sessionId: null })),
    interruptSession: vi.fn(async () => true),
    computerUseSetActive: vi.fn(async () => {}),
    rememberSessionModel: vi.fn(async () => {}),
    rememberSessionEffort: vi.fn(async () => {}),
    listSessions: vi.fn(async () => []),
    loadSessionPage: vi.fn(async () => ({ messages: [], nextBefore: null, subagentHistory: [] })),
    getAppSettings: vi.fn(async () => ({})),
    updateAppSettings: vi.fn(async () => {}),
    rescanSessions: vi.fn(async () => {}),
    refreshSessionUsage: vi.fn(async () => null),
  },
}));
vi.mock("@/lib/events", () => ({
  listenEngineEvents: vi.fn(async () => () => {}),
  listenSessionsChanged: vi.fn(async () => () => {}),
  listenComputerUseEscape: vi.fn(async () => () => {}),
}));

const WS = "/tmp/ws";
// Dynamic imports: the mocked ipc/events modules above must be in place
// before the store (and its engine-events wiring) is first evaluated.
const { useChatStore } = await import("./store");
const { sessionKey } = await import("./store/persistence");
const { engineSupportsComputerUse } = await import("./computer-use");
const { handleEngineEvents, settledRuns } = await import("./store/engine-events");
const { EMPTY_SESSION, runRouting } = await import("./store/stream");

const KEY = sessionKey("omp", "s-1", WS);

function engine(id: string, supportsComputerUse: boolean): EngineInfo {
  return {
    id,
    available: true,
    enabled: true,
    supportsImages: true,
    supportsComputerUse,
    permissions: ["auto"],
  };
}

describe("engineSupportsComputerUse", () => {
  it("reads the engine's own capability flag", () => {
    const engines = [engine("omp", true), engine("codex", false)];
    expect(engineSupportsComputerUse(engines, "omp")).toBe(true);
    expect(engineSupportsComputerUse(engines, "codex")).toBe(false);
  });

  it("treats an engine missing from the catalog as unsupported", () => {
    expect(engineSupportsComputerUse([], "omp")).toBe(false);
  });
});

describe("computer-use sends", () => {
  beforeEach(() => {
    vi.mocked(ipc.sendMessage).mockClear();
    // Default backend shape: an older backend that chooses its own run id.
    vi.mocked(ipc.sendMessage).mockImplementation(async () => ({
      runId: "run-1",
      sessionId: null,
    }));
    vi.mocked(ipc.computerUseSetActive).mockClear();
    runRouting.clear();
    settledRuns.clear();
    useChatStore.setState({
      engines: [engine("omp", true)],
      active: { engine: "omp", sessionId: "s-1", workspacePath: WS },
      openTabs: [{ engine: "omp", sessionId: "s-1", workspacePath: WS }],
      activeEngine: "omp",
      models: {},
      efforts: {},
      bySession: {},
      streamingByKey: {},
      unseen: {},
      drafts: {},
    });
  });

  it("carries the flag to sendMessage and arms Esc-to-stop", async () => {
    await useChatStore.getState().send("打开计算器", [], { computerUse: true });
    expect(vi.mocked(ipc.sendMessage)).toHaveBeenCalledWith(
      expect.objectContaining({
        engine: "omp",
        prompt: "打开计算器",
        computerUse: true,
      }),
    );
    expect(vi.mocked(ipc.computerUseSetActive)).toHaveBeenCalledWith(true);
  });

  it("sends an ordinary turn with the flag off", async () => {
    await useChatStore.getState().send("你好", []);
    expect(vi.mocked(ipc.sendMessage)).toHaveBeenCalledWith(
      expect.objectContaining({ computerUse: false }),
    );
    expect(vi.mocked(ipc.computerUseSetActive)).not.toHaveBeenCalled();
  });

  it("refuses an engine that cannot mount the driver", async () => {
    useChatStore.setState({ engines: [engine("codex", false)] });
    await useChatStore
      .getState()
      .send("打开计算器", [], { computerUse: true });
    // No turn: the user asked for machine control, and a text-only run would
    // silently pretend it happened.
    expect(vi.mocked(ipc.sendMessage)).not.toHaveBeenCalled();
    expect(useChatStore.getState().bySession[KEY]?.error).toBeTruthy();
  });

  it("keeps the flag on a queued computer-use turn", async () => {
    useChatStore.getState().queueMessage("打开计算器", [], {
      computerUse: true,
    });
    const queued = useChatStore.getState().bySession[KEY]?.queue ?? [];
    expect(queued).toHaveLength(1);
    expect(queued[0].computerUse).toBe(true);

    // Drain it the way the queue does on user request.
    await useChatStore.getState().sendQueuedNow(queued[0].id);
    expect(vi.mocked(ipc.sendMessage)).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "打开计算器", computerUse: true }),
    );
  });

  it("keeps Esc armed through the held done, disarms on the terminal one", async () => {
    // The echo-back backend: the run keeps the id the client requested, so
    // the claim and the routing stay intact.
    vi.mocked(ipc.sendMessage).mockImplementation(async (args) => ({
      runId: args.runId ?? "run-1",
      sessionId: "s-1",
    }));
    await useChatStore.getState().send("打开计算器", [], { computerUse: true });
    vi.mocked(ipc.computerUseSetActive).mockClear();
    // The send claims the session under the run id it requested.
    const runId = vi.mocked(ipc.sendMessage).mock.calls[0][0].runId ?? "run-1";
    const d = {
      set: useChatStore.setState,
      get: useChatStore.getState,
      drainQueue: () => {},
      markUnseenIfBackground: () => {},
      upsertSessionMeta: () => {},
    };
    const done = (data: unknown) => ({
      runId, sessionId: "s-1", engine: "omp", seq: 2, kind: "done" as const, data,
    });

    // The reply settled but background tasks keep the run alive: the Esc
    // hotkey belongs to the run, not the reply segment.
    handleEngineEvents([done({ usage: null, backgroundTasks: 1 })], d);
    expect(vi.mocked(ipc.computerUseSetActive)).not.toHaveBeenCalled();

    handleEngineEvents([done({ usage: null, backgroundTasks: 0 })], d);
    expect(vi.mocked(ipc.computerUseSetActive)).toHaveBeenCalledWith(false);
  });

  it("does not disarm Esc for a foreign run's done", async () => {
    vi.mocked(ipc.sendMessage).mockImplementation(async (args) => ({
      runId: args.runId ?? "run-1",
      sessionId: "s-1",
    }));
    await useChatStore.getState().send("打开计算器", [], { computerUse: true });
    vi.mocked(ipc.computerUseSetActive).mockClear();
    // 同会话双 run：电脑操控 run 仍在流且认领会话，另一个 run 的终局 done 到达。
    runRouting.set("run-9", KEY);
    handleEngineEvents(
      [
        {
          runId: "run-9", sessionId: "s-1", engine: "omp", seq: 2,
          kind: "done" as const, data: { usage: null, backgroundTasks: 0 },
        },
      ],
      {
        set: useChatStore.setState,
        get: useChatStore.getState,
        drainQueue: () => {},
        markUnseenIfBackground: () => {},
        upsertSessionMeta: () => {},
      },
    );
    expect(vi.mocked(ipc.computerUseSetActive)).not.toHaveBeenCalled();
    expect(useChatStore.getState().bySession[KEY]?.streaming).toBe(true);
  });

  it("does not disarm Esc for another session's done", async () => {
    await useChatStore.getState().send("打开计算器", [], { computerUse: true });
    vi.mocked(ipc.computerUseSetActive).mockClear();
    // 另一会话（非电脑操控）的 run 收尾：全局热键属于 run-1，不得解除。
    const OTHER_KEY = sessionKey("omp", "s-2", WS);
    useChatStore.setState((s) => ({
      bySession: { ...s.bySession, [OTHER_KEY]: { ...EMPTY_SESSION, streaming: true } },
    }));
    runRouting.set("run-2", OTHER_KEY);
    handleEngineEvents(
      [
        {
          runId: "run-2", sessionId: "s-2", engine: "omp", seq: 2,
          kind: "done" as const, data: { usage: null, backgroundTasks: 0 },
        },
      ],
      {
        set: useChatStore.setState,
        get: useChatStore.getState,
        drainQueue: () => {},
        markUnseenIfBackground: () => {},
        upsertSessionMeta: () => {},
      },
    );
    expect(vi.mocked(ipc.computerUseSetActive)).not.toHaveBeenCalled();
  });

  it("disarms Esc-to-stop when the turn settles", async () => {
    await useChatStore.getState().send("打开计算器", [], { computerUse: true });
    vi.mocked(ipc.computerUseSetActive).mockClear();
    const { handleEngineEvents } = await import("./store/engine-events");
    handleEngineEvents(
      [
        {
          runId: "run-1",
          sessionId: "s-1",
          engine: "omp",
          seq: 2,
          kind: "done" as const,
          data: { usage: null },
        },
      ],
      {
        set: useChatStore.setState,
        get: useChatStore.getState,
        drainQueue: () => {},
        markUnseenIfBackground: () => {},
        upsertSessionMeta: () => {},
      },
    );
    expect(vi.mocked(ipc.computerUseSetActive)).toHaveBeenCalledWith(false);
  });
});
