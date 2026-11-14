import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineEventPayload } from "@/lib/events";

const sendMock = vi.fn();
const interruptMock = vi.fn();
const hydrateMock = vi.fn(async () => {});
/** 宿主聊天 store 的最小切片：续跑要判断会话是否存在、是否在跑。 */
const storeState = {
  sessions: [] as { engine: string; sessionId: string; workspacePath: string }[],
  workspaces: [] as { path: string }[],
  streamingByKey: {} as Record<string, boolean>,
  send: sendMock,
  interrupt: interruptMock,
  hydrateSession: hydrateMock,
};
vi.mock("@/features/chat/store", () => ({
  useChatStore: { getState: () => storeState },
}));

let emitEngineEvents: ((events: EngineEventPayload[]) => void) | null = null;
vi.mock("@/lib/events", () => ({
  listenEngineEvents: vi.fn(async (cb: (events: EngineEventPayload[]) => void) => {
    emitEngineEvents = cb;
    return () => {};
  }),
}));

import { pluginBus } from "./events";
import { interruptPluginChatRun, startPluginChatRun } from "./session-run-bridge";

function engineEvent(runId: string, kind: EngineEventPayload["kind"], extra: Partial<EngineEventPayload> = {}): EngineEventPayload {
  return { runId, sessionId: null, engine: "pi", seq: 1, kind, data: {}, ...extra } as EngineEventPayload;
}

describe("plugin session-run bridge", () => {
  beforeEach(() => {
    sendMock.mockReset();
    interruptMock.mockReset();
    interruptMock.mockResolvedValue(undefined);
    hydrateMock.mockReset();
    storeState.sessions = [];
    storeState.workspaces = [];
    storeState.streamingByKey = {};
  });

  it("sends through the chat store with per-run overrides and reports terminal events", async () => {
    const seen: unknown[] = [];
    const unsubscribe = pluginBus.on("plugin-run://git-tasks", (payload) => seen.push(payload));

    // send 成功返回前 onStarted 会先被调用（宿主实现依赖这一点）。
    sendMock.mockImplementation(async (_prompt, _images, options, target) => {
      expect(target).toEqual({
        engine: "pi",
        sessionId: null,
        workspacePath: "/repo/wt",
        model: "deepseek/deepseek-flash",
        effort: "xhigh",
        provider: "deepseek",
      });
      // 引擎在 spawn 返回里不给 session id（很常见），稍后才 announce。
      options.onStarted({ runId: "run-9", sessionId: null });
    });

    const handle = await startPluginChatRun("git-tasks", {
      engine: "pi",
      prompt: "review this PR",
      workspacePath: "/repo/wt",
      model: "deepseek/deepseek-flash",
      effort: "xhigh",
      providerId: "deepseek",
    });
    expect(handle).toEqual({ runId: "run-9", sessionId: null });
    expect(sendMock).toHaveBeenCalledTimes(1);
    // started 在 send 返回前就发给插件，插件无需等 startRun 才认领轮次。
    expect(seen).toEqual([
      { runId: "run-9", sessionId: null, engine: "pi", workspacePath: "/repo/wt", kind: "started", error: null },
    ]);

    // 终态事件 → 回执给属主插件（并在同一轮里清掉记录）。
    // 引擎之后才 announce 原生 session id（spawn 返回里没有）：照样转给插件，
    // 否则「打开会话」一直点不了。
    emitEngineEvents?.([engineEvent("run-9", "delta", { sessionId: "sess-late" })]);
    expect(seen).toHaveLength(2);
    expect(seen[1]).toEqual({
      runId: "run-9",
      sessionId: "sess-late",
      engine: "pi",
      workspacePath: "/repo/wt",
      kind: "session",
      error: null,
    });
    emitEngineEvents?.([engineEvent("run-9", "done", { sessionId: "sess-late" })]);
    expect(seen).toHaveLength(3);
    expect(seen[2]).toMatchObject({ kind: "done", sessionId: "sess-late" });
    // 记录已删：重复事件不再回执。
    emitEngineEvents?.([engineEvent("run-9", "error")]);
    expect(seen).toHaveLength(3);

    unsubscribe();
  });

  it("rejects invalid defs and cleans the run record when the send fails", async () => {
    await expect(startPluginChatRun("p", { engine: "", prompt: "x", workspacePath: "/w" })).rejects.toThrow(
      /empty engine/,
    );
    await expect(startPluginChatRun("p", { engine: "pi", prompt: "  ", workspacePath: "/w" })).rejects.toThrow(
      /empty prompt/,
    );

    sendMock.mockImplementation(async (_prompt, _images, options) => {
      options.onStarted({ runId: "run-fail", sessionId: null });
      throw new Error("engine missing");
    });
    await expect(
      startPluginChatRun("p", { engine: "pi", prompt: "x", workspacePath: "/w" }),
    ).rejects.toThrow("engine missing");

    const seen: unknown[] = [];
    const unsubscribe = pluginBus.on("plugin-run://p", (payload) => seen.push(payload));
    emitEngineEvents?.([engineEvent("run-fail", "error")]);
    expect(seen).toEqual([]);
    unsubscribe();
  });

  it("interrupts only runs the plugin started", async () => {
    sendMock.mockImplementation(async (_prompt, _images, options) => {
      options.onStarted({ runId: "run-owned", sessionId: "sess-owned" });
    });
    await startPluginChatRun("p", { engine: "pi", prompt: "x", workspacePath: "/w" });

    await interruptPluginChatRun("p", { engine: "pi", workspacePath: "/w", sessionId: "sess-owned" });
    expect(interruptMock).toHaveBeenCalledWith({ engine: "pi", sessionId: "sess-owned", workspacePath: "/w" });

    // An unowned session (the user's turn, or a sibling plugin's) never reaches
    // the store: stopping it would be outside this plugin's grant.
    interruptMock.mockClear();
    await expect(
      interruptPluginChatRun("p", { engine: "pi", workspacePath: "/w", sessionId: "sess-user" }),
    ).rejects.toThrow(/may only stop a run started by this plugin/);
    expect(interruptMock).not.toHaveBeenCalled();

    // The native id may not be known yet: a null identity stops the plugin's
    // own live run in that engine+workspace scope.
    await interruptPluginChatRun("p", { engine: "pi", workspacePath: "/w" });
    expect(interruptMock).toHaveBeenCalledWith({ engine: "pi", sessionId: null, workspacePath: "/w" });

    await expect(interruptPluginChatRun("p", { engine: "", workspacePath: "" })).rejects.toThrow(
      /engine and workspacePath/,
    );
    // Settle the owned run so its record cannot leak into later tests.
    emitEngineEvents?.([engineEvent("run-owned", "done", { sessionId: "sess-owned" })]);
  });

  it("resumes an existing session: hydrates its transcript first, then sends into it", async () => {
    storeState.sessions = [
      { engine: "pi", sessionId: "sess-old", workspacePath: "/w" },
    ];
    sendMock.mockImplementation(async (_prompt, _images, options, target) => {
      // 续跑就是把这一轮投进原会话的键上：不新开侧栏行。
      expect(target).toMatchObject({ engine: "pi", sessionId: "sess-old", workspacePath: "/w" });
      options.onStarted({ runId: "run-resume", sessionId: "sess-old" });
    });

    // 冷会话：必须先读历史，再让聊天发送往同一键追加，否则打开标签页时
    // 「已有消息」会跳过历史加载，旧对话像是被吞了。
    await startPluginChatRun("p", {
      engine: "pi",
      prompt: "daily check",
      workspacePath: "/w",
      sessionId: "sess-old",
    });
    expect(hydrateMock).toHaveBeenCalledWith({
      engine: "pi",
      sessionId: "sess-old",
      workspacePath: "/w",
    });
    const hydrateOrder = hydrateMock.mock.invocationCallOrder[0]!;
    const sendOrder = sendMock.mock.invocationCallOrder[0]!;
    expect(hydrateOrder).toBeLessThan(sendOrder);

    emitEngineEvents?.([engineEvent("run-resume", "done", { sessionId: "sess-old" })]);
  });

  it("refuses to resume a session that is unknown or already running", async () => {
    // 未知会话：--resume 起不来，别让插件以为这一轮已经发出去了。
    await expect(
      startPluginChatRun("p", { engine: "pi", prompt: "x", workspacePath: "/w", sessionId: "sess-gone" }),
    ).rejects.toThrow(/unknown session/);
    expect(sendMock).not.toHaveBeenCalled();

    storeState.sessions = [{ engine: "pi", sessionId: "sess-busy", workspacePath: "/w" }];
    storeState.streamingByKey = { "pi/sess-busy": true };
    await expect(
      startPluginChatRun("p", { engine: "pi", prompt: "x", workspacePath: "/w", sessionId: "sess-busy" }),
    ).rejects.toThrow(/session_busy/);
    expect(sendMock).not.toHaveBeenCalled();

    // 历史上读失败也不发：宁可这一轮报错，也不要往半截转录上追加。
    storeState.streamingByKey = {};
    hydrateMock.mockRejectedValueOnce(new Error("history read failed"));
    await expect(
      startPluginChatRun("p", { engine: "pi", prompt: "x", workspacePath: "/w", sessionId: "sess-busy" }),
    ).rejects.toThrow("history read failed");
    expect(sendMock).not.toHaveBeenCalled();

    // 空串是参数错误，不是「新建会话」。
    await expect(
      startPluginChatRun("p", { engine: "pi", prompt: "x", workspacePath: "/w", sessionId: "  " }),
    ).rejects.toThrow(/empty sessionId/);
  });
});
