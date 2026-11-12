import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineEventPayload } from "@/lib/events";

vi.mock("@/features/chat/center-surfaces", () => ({ dismissCenterSurfaces: vi.fn() }));

const sendMock = vi.fn();
const interruptMock = vi.fn();
const selectMock = vi.fn();
const chatState = {
  sessions: [] as { engine: string; sessionId: string; workspacePath: string }[],
  streamingByKey: {} as Record<string, boolean>,
  bySession: {} as Record<string, { error?: string; messages: unknown[] }>,
};
vi.mock("@/features/chat/store", () => ({
  useChatStore: {
    getState: () => ({ ...chatState, send: sendMock, interrupt: interruptMock, selectSession: selectMock }),
  },
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
    selectMock.mockReset();
    selectMock.mockResolvedValue(undefined);
    chatState.sessions = [];
    chatState.streamingByKey = {};
    chatState.bySession = {};
    interruptMock.mockReset();
    interruptMock.mockResolvedValue(undefined);
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

    // 省略会话 ID 时，按属主轮次实际所在的会话停止。
    await interruptPluginChatRun("p", { engine: "pi", workspacePath: "/w" });
    expect(interruptMock).toHaveBeenCalledWith({ engine: "pi", sessionId: "sess-owned", workspacePath: "/w" });

    await expect(interruptPluginChatRun("p", { engine: "", workspacePath: "" })).rejects.toThrow(
      /engine and workspacePath/,
    );
    // Settle the owned run so its record cannot leak into later tests.
    emitEngineEvents?.([engineEvent("run-owned", "done", { sessionId: "sess-owned" })]);
  });
  it("恢复原生历史后续接会话，且只有属主插件可停止", async () => {
    chatState.sessions = [{ engine: "claude", sessionId: "existing", workspacePath: "/repo" }];
    chatState.bySession["claude/existing"] = { messages: [{ text: "original history" }] };
    sendMock.mockImplementation(async (_prompt, _images, options, target) => {
      expect(selectMock).toHaveBeenCalledWith("claude", "existing", "/repo");
      expect(target.sessionId).toBe("existing");
      expect(chatState.bySession["claude/existing"].messages).toHaveLength(1);
      options.onStarted({ runId: "resume-run", sessionId: "existing" });
    });
    await expect(startPluginChatRun("personal-board", { engine: "claude", sessionId: "existing", workspacePath: "/repo", prompt: "fix column" })).resolves.toEqual({ runId: "resume-run", sessionId: "existing" });
    await expect(interruptPluginChatRun("other-plugin", { engine: "claude", workspacePath: "/repo", sessionId: "existing" })).rejects.toThrow(/may only stop/);
    await interruptPluginChatRun("personal-board", { engine: "claude", workspacePath: "/repo", sessionId: "existing" });
    expect(interruptMock).toHaveBeenCalledWith({ engine: "claude", workspacePath: "/repo", sessionId: "existing" });
    emitEngineEvents?.([engineEvent("resume-run", "done", { engine: "claude", sessionId: "existing" })]);
  });

  it("拒绝不存在、不匹配或忙碌的会话，不创建替代轮次", async () => {
    chatState.sessions = [{ engine: "claude", sessionId: "existing", workspacePath: "/repo" }];
    const def = { engine: "claude", sessionId: "existing", workspacePath: "/wrong", prompt: "fix" };
    await expect(startPluginChatRun("p", def)).rejects.toThrow(/session_not_found/);
    await expect(startPluginChatRun("p", { ...def, workspacePath: "/repo", engine: "pi" })).rejects.toThrow(/session_not_found/);
    chatState.streamingByKey["claude/existing"] = true;
    await expect(startPluginChatRun("p", { ...def, workspacePath: "/repo" })).rejects.toThrow(/session_busy/);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("恢复历史后再次检查忙碌状态，失败时释放续接锁以便重试", async () => {
    chatState.sessions = [{ engine: "claude", sessionId: "existing", workspacePath: "/repo" }];
    const def = { engine: "claude", sessionId: "existing", workspacePath: "/repo", prompt: "fix" };
    selectMock.mockImplementationOnce(async () => { chatState.streamingByKey["claude/existing"] = true; });
    await expect(startPluginChatRun("p", def)).rejects.toThrow(/session_busy/);
    chatState.streamingByKey = {};
    chatState.bySession["claude/existing"] = { error: "read failed", messages: [] };
    await expect(startPluginChatRun("p", def)).rejects.toThrow(/session_load_failed/);
    chatState.bySession = {};
    sendMock.mockRejectedValueOnce(Error("engine missing"));
    await expect(startPluginChatRun("p", def)).rejects.toThrow(/engine missing/);
    sendMock.mockImplementationOnce(async (_prompt, _images, options) => options.onStarted({ runId: "retry-resume", sessionId: "existing" }));
    await expect(startPluginChatRun("p", def)).resolves.toEqual({ runId: "retry-resume", sessionId: "existing" });
    emitEngineEvents?.([engineEvent("retry-resume", "done", { engine: "claude", sessionId: "existing" })]);
  });

  it("同一会话加载历史时阻止两个插件并发发送", async () => {
    chatState.sessions = [{ engine: "claude", sessionId: "existing", workspacePath: "/repo" }];
    let release!: () => void;
    selectMock.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    const def = { engine: "claude", sessionId: "existing", workspacePath: "/repo", prompt: "fix" };
    const first = startPluginChatRun("p", def);
    await vi.waitFor(() => expect(selectMock).toHaveBeenCalled());
    await expect(startPluginChatRun("q", def)).rejects.toThrow(/session_busy/);
    sendMock.mockImplementationOnce(async (_prompt, _images, options) => options.onStarted({ runId: "race-resume", sessionId: "existing" }));
    release();
    await first;
    emitEngineEvents?.([engineEvent("race-resume", "done", { engine: "claude", sessionId: "existing" })]);
  });

  it("不传 sessionId 时按轮次实际所在的会话停止", async () => {
    sendMock.mockImplementation(async (_prompt, _images, options) => {
      options.onStarted({ runId: "run-late-id", sessionId: null });
    });
    await startPluginChatRun("p", { engine: "pi", prompt: "x", workspacePath: "/w" });

    // 原生 ID 未知时按轮次 ID 停止。
    await interruptPluginChatRun("p", { engine: "pi", workspacePath: "/w" });
    expect(interruptMock).toHaveBeenLastCalledWith({ engine: "pi", sessionId: null, workspacePath: "/w" }, "run-late-id");

    // id 学到以后：轮次已迁到原生键，必须停原生键。
    emitEngineEvents?.([engineEvent("run-late-id", "session", { sessionId: "sess-late" })]);
    interruptMock.mockClear();
    await interruptPluginChatRun("p", { engine: "pi", workspacePath: "/w" });
    expect(interruptMock).toHaveBeenCalledWith({ engine: "pi", sessionId: "sess-late", workspacePath: "/w" });

    emitEngineEvents?.([engineEvent("run-late-id", "done", { sessionId: "sess-late" })]);
  });

  it("启动和停止使用相同的会话 ID 规范化规则", async () => {
    chatState.sessions = [{ engine: "pi", sessionId: "trimmed", workspacePath: "/w" }];
    sendMock.mockImplementationOnce(async (_prompt, _images, options) => {
      options.onStarted({ runId: "trimmed-run", sessionId: "trimmed" });
    });
    const target = { engine: "pi", workspacePath: "/w", sessionId: " trimmed " };
    await startPluginChatRun("trim-owner", { ...target, prompt: "任务" });
    await expect(interruptPluginChatRun("trim-owner", { ...target, sessionId: " " }))
      .rejects.toThrow("invalid_args");
    expect(interruptMock).not.toHaveBeenCalled();
    await interruptPluginChatRun("trim-owner", target);
    expect(interruptMock).toHaveBeenCalledWith({ ...target, sessionId: "trimmed" });
    emitEngineEvents?.([engineEvent("trimmed-run", "done", { sessionId: "trimmed" })]);
  });

  it.each([undefined, null])("省略或传空会话 ID（%s）时停止范围内全部属主轮次", async (sessionId) => {
    const records = [
      { plugin: "scope-owner", engine: "pi", workspacePath: "/w", runId: "scope-a", sessionId: "session-a" },
      { plugin: "scope-owner", engine: "pi", workspacePath: "/w", runId: "scope-b", sessionId: "session-b" },
      { plugin: "scope-other", engine: "pi", workspacePath: "/w", runId: "scope-other", sessionId: "other-session" },
      { plugin: "scope-owner", engine: "claude", workspacePath: "/w", runId: "scope-engine", sessionId: "other-engine" },
      { plugin: "scope-owner", engine: "pi", workspacePath: "/other", runId: "scope-workspace", sessionId: "other-workspace" },
    ];
    for (const record of records) {
      sendMock.mockImplementationOnce(async (_prompt, _images, options) => {
        options.onStarted({ runId: record.runId, sessionId: record.sessionId });
      });
      await startPluginChatRun(record.plugin, { engine: record.engine, workspacePath: record.workspacePath, prompt: "任务" });
    }

    await interruptPluginChatRun("scope-owner", { engine: "pi", workspacePath: "/w", sessionId });

    expect(interruptMock.mock.calls.map(([target]) => target)).toEqual([
      { engine: "pi", workspacePath: "/w", sessionId: "session-a" },
      { engine: "pi", workspacePath: "/w", sessionId: "session-b" },
    ]);
    emitEngineEvents?.(records.map((record) => engineEvent(record.runId, "done", { sessionId: record.sessionId })));
  });
});
