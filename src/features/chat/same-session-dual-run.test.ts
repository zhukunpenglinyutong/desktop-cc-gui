import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineEventPayload } from "@/lib/events";
import { useChatStore } from "./store";
import {
  droppedContentRuns,
  handleEngineEvents,
  settleOrphanedRuns,
  settledRuns,
  type EngineEventDeps,
} from "./store/engine-events";
import { sessionKey } from "./store/persistence";
import { EMPTY_SESSION, flushPendingStreams, runRouting } from "./store/stream";

vi.mock("@/lib/ipc", () => ({
  ipc: {
    rescanSessions: vi.fn(async () => {}),
    usageRecord: vi.fn(async () => {}),
    // The echo-back backend: the run id the client asked for is the run id it
    // reports (the real Rust command does the same).
    sendMessage: vi.fn(async (args: { runId: string }) => ({
      runId: args.runId,
      sessionId: "s-1",
    })),
    interruptSession: vi.fn(async () => true),
    rememberSessionModel: vi.fn(async () => {}),
    rememberSessionEffort: vi.fn(async () => {}),
    rememberSessionProvider: vi.fn(async () => {}),
    loadSessionPage: vi.fn(async () => ({ messages: [], nextBefore: null })),
  },
}));
vi.mock("@/lib/events", () => ({
  listenEngineEvents: vi.fn(async () => () => {}),
  listenSessionsChanged: vi.fn(async () => () => {}),
}));

const WS = "/tmp/ws";
const KEY = sessionKey("claude", "s-1", WS);
const TAB = { engine: "claude", sessionId: "s-1", workspacePath: WS };
const RUN_A = "run-a";
const RUN_B = "run-b";

let drainSpy: ReturnType<typeof vi.fn>;

function deps(): EngineEventDeps {
  return {
    set: useChatStore.setState,
    get: useChatStore.getState,
    drainQueue: drainSpy,
    markUnseenIfBackground: () => {},
    upsertSessionMeta: () => {},
    refreshSessionUsage: vi.fn(async () => {}),
  };
}

const ev = (runId: string, kind: EngineEventPayload["kind"], seq: number, data: unknown) => ({
  runId, sessionId: "s-1", engine: "claude", seq, kind, data,
});

const session = () => useChatStore.getState().bySession[KEY]!;
const assistantTexts = () =>
  session().messages.filter((m) => m.role === "assistant").map((m) => m.text);

/** Run A's reply settles with background work still running. */
function settleRunAOnBackground() {
  handleEngineEvents([
    ev(RUN_A, "delta", 1, "正文段"),
    ev(RUN_A, "task_started", 2, {
      taskId: "w1", taskType: "local_workflow", description: "wf",
    }),
    ev(RUN_A, "done", 3, { usage: null, backgroundTasks: 1 }),
  ], deps());
}

describe("same-session dual run", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    drainSpy = vi.fn();
    runRouting.clear();
    settledRuns.clear();
    droppedContentRuns.clear();
    useChatStore.setState({
      active: TAB,
      openTabs: [TAB],
      models: { claude: "claude-sonnet-4" },
      unseen: {},
      bySession: {
        [KEY]: {
          ...EMPTY_SESSION,
          streaming: true,
          turnStartedAt: Date.now(),
          messages: [{ seq: 1, role: "user", text: "跑一下", ts: null }],
        },
      },
      streamingByKey: { [KEY]: true },
    });
  });

  it("keeps a newer run's live turn out of the old run's settle", () => {
    settleRunAOnBackground();
    const afterA = session();
    expect(afterA.awaitingTasks).toBe(true);
    expect(afterA.streaming).toBe(false);
    expect(drainSpy).toHaveBeenCalledTimes(1); // A 的后台段不锁输入
    drainSpy.mockClear();

    // 用户随即给同一会话发 B（新 run）：B 的第一帧认领会话。
    handleEngineEvents([ev(RUN_B, "delta", 1, "B 正文")], deps());
    const bStartedAt = session().turnStartedAt;
    flushPendingStreams(useChatStore.setState);
    expect(session().streaming).toBe(true);
    expect(session().currentRunId).toBe(RUN_B);
    expect(session().turnStartedAt).toBe(bStartedAt);

    // B 流式期间用户排队一条消息：它属于 B 的下一回合。
    useChatStore.setState((s) => ({
      bySession: {
        ...s.bySession,
        [KEY]: {
          ...s.bySession[KEY]!,
          queue: [{ id: "q-1", text: "下一句", images: [], queuedAt: 0 }],
        },
      },
    }));

    // A 的通知轮内容在 B 流式期间到达：不得并入 B 的 live 行（降级口径）。
    handleEngineEvents([ev(RUN_A, "delta", 4, "工作流完成：")], deps());
    flushPendingStreams(useChatStore.setState);
    expect(assistantTexts()).toEqual(["正文段", "B 正文"]);

    // A 的 run 级终局 done：只结算 A 自己的任务与路由。
    handleEngineEvents([ev(RUN_A, "done", 5, { usage: null, backgroundTasks: 0 })], deps());

    const s = session();
    expect(s.streaming).toBe(true);                    // B 仍在流
    expect(s.currentRunId).toBe(RUN_B);
    expect(s.turnStartedAt).toBe(bStartedAt);          // A 不得清掉 B 的计时
    expect(s.messages[s.messages.length - 1].live).toBe(true); // B 的 live 行未被结算
    expect(s.queue).toHaveLength(1);                   // 队列仍在
    expect(drainSpy).not.toHaveBeenCalled();           // A 的 done 不得 drain B 的队列
    expect(s.tasks.find((t) => t.id === "w1")!.status).toBe("interrupted");
    expect(runRouting.has(RUN_A)).toBe(false);
    expect(settledRuns.get(RUN_A)).toBe("done");
  });

  it("claims the session for a locally sent run", async () => {
    settleRunAOnBackground();
    drainSpy.mockClear();

    await useChatStore.getState().send("B 提问", []);
    const claimed = session().currentRunId;
    expect(claimed).toBeTruthy();
    expect(session().streaming).toBe(true);
    // B 的开始终结 A 的后台等待：awaitingTasks 不得带着旧标志进入新回合。
    expect(session().awaitingTasks).toBe(false);
    // A 的通知轮照旧在 B 流式期间到达，但会话已归 B。
    handleEngineEvents([
      ev(RUN_A, "delta", 4, "工作流完成："),
      ev(RUN_A, "done", 5, { usage: null, backgroundTasks: 0 }),
    ], deps());
    flushPendingStreams(useChatStore.setState);
    const s = session();
    expect(s.currentRunId).toBe(claimed);
    expect(s.streaming).toBe(true);
    expect(s.turnStartedAt).not.toBeNull();
    expect(drainSpy).not.toHaveBeenCalled();
    // B 自己的 done 才是这个会话的回合终点。
    handleEngineEvents([ev(claimed!, "done", 6, { usage: null, backgroundTasks: 0 })], deps());
    expect(session().streaming).toBe(false);
    expect(session().currentRunId).toBeNull();
  });

  it("reaps an older run without clearing the newer owner's retry state", () => {
    settleRunAOnBackground();
    handleEngineEvents([ev(RUN_B, "delta", 1, "B 正文")], deps());
    handleEngineEvents(
      [ev(RUN_B, "retry", 2, { attempt: 1, max: 3, message: "重试中 (1/3)" })],
      deps(),
    );
    expect(session().currentRunId).toBe(RUN_B);
    expect(useChatStore.getState().retryingByKey[KEY]).toBe(true);

    settleOrphanedRuns(useChatStore.setState, [[RUN_A, KEY]]);

    expect(session()).toMatchObject({
      currentRunId: RUN_B,
      streaming: true,
      retry: { attempt: 1, max: 3 },
    });
    expect(useChatStore.getState().streamingByKey[KEY]).toBe(true);
    expect(useChatStore.getState().retryingByKey[KEY]).toBe(true);
    expect(session().tasks.find((task) => task.id === "w1")?.status).toBe("interrupted");

    // The retryingKeys fast-path must survive too, so B's next output can clear
    // the retry marker rather than leaving stale progress in the session.
    handleEngineEvents([ev(RUN_B, "delta", 3, "B 恢复输出")], deps());
    expect(session().retry).toBeNull();
    expect(useChatStore.getState().retryingByKey[KEY]).toBeUndefined();
  });

  it("backfills the dropped completion turn via a transcript reload when the foreign run settles", () => {
    const reload = vi.fn();
    const d = { ...deps(), reloadTranscript: reload };
    settleRunAOnBackground();
    handleEngineEvents([ev(RUN_B, "delta", 1, "B 正文")], d);

    // A 的通知轮内容在 B 流式期间到达：被丢弃，但按 run 记下待补显。
    handleEngineEvents([ev(RUN_A, "delta", 4, "工作流完成：")], d);
    expect(reload).not.toHaveBeenCalled();

    // A 的终局 done 到达：触发该会话的定向 transcript 重读合并。
    handleEngineEvents([ev(RUN_A, "done", 5, { usage: null, backgroundTasks: 0 })], d);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledWith(KEY);

    // 幂等：marker 已消费，重复处理同一终局帧不会再次触发（此处直接被
    // settled 门禁拦下）。
    handleEngineEvents([ev(RUN_A, "done", 6, { usage: null, backgroundTasks: 0 })], d);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("backfills on the foreign run's error too", () => {
    const reload = vi.fn();
    const d = { ...deps(), reloadTranscript: reload };
    settleRunAOnBackground();
    handleEngineEvents([ev(RUN_B, "delta", 1, "B 正文")], d);
    handleEngineEvents([ev(RUN_A, "delta", 4, "工作流完成：")], d);

    handleEngineEvents([ev(RUN_A, "error", 5, "boom")], d);

    expect(reload).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledWith(KEY);
    // B 的回合不受 A 的错误影响。
    expect(session().streaming).toBe(true);
    expect(session().currentRunId).toBe(RUN_B);
  });

  it("does not reload the transcript when no frames were dropped", () => {
    const reload = vi.fn();
    const d = { ...deps(), reloadTranscript: reload };
    handleEngineEvents([ev(RUN_A, "delta", 1, "正文")], d);
    handleEngineEvents([ev(RUN_A, "done", 2, { usage: null })], d);
    expect(reload).not.toHaveBeenCalled();
  });

  it("does not let a late foreign done stamp its usage over the settled reply", () => {
    settleRunAOnBackground();
    handleEngineEvents([ev(RUN_B, "delta", 1, "B 正文")], deps());
    // A 的通知轮在 B 流式期间被丢弃。
    handleEngineEvents([ev(RUN_A, "delta", 4, "工作流完成：")], deps());

    // B 收尾：最后一个 assistant 行盖上 B 的 usage。
    handleEngineEvents(
      [ev(RUN_B, "done", 2, { usage: { input_tokens: 10, output_tokens: 5 }, backgroundTasks: 0 })],
      deps(),
    );
    const lastAssistant = () =>
      [...session().messages].reverse().find((m) => m.role === "assistant")!;
    expect(lastAssistant().text).toBe("B 正文");
    expect(lastAssistant().usage).toMatchObject({ input_tokens: 10, output_tokens: 5 });

    // A 的迟到终局 done：claim 已被 B 的 done 清空，ownTurn 退化为 true，
    // 但它不得把 B 的行盖上 A 的 usage——只做 run 级收尾。
    handleEngineEvents(
      [ev(RUN_A, "done", 5, { usage: { input_tokens: 999, output_tokens: 1 }, backgroundTasks: 0 })],
      deps(),
    );
    expect(lastAssistant().text).toBe("B 正文");
    expect(lastAssistant().usage).toMatchObject({ input_tokens: 10, output_tokens: 5 });
    expect(session().settledRunIds).toEqual(expect.arrayContaining([RUN_A, RUN_B]));
    expect(runRouting.has(RUN_A)).toBe(false);
  });

  it("lets a run take over a session whose claim was already settled", () => {
    // 会话处于 idle（无认领）：任何 run 都能成为它的回合主人。
    handleEngineEvents([ev(RUN_A, "delta", 1, "正文")], deps());
    expect(session().currentRunId).toBe(RUN_A);
    handleEngineEvents([ev(RUN_A, "done", 2, { usage: null })], deps());
    expect(session().streaming).toBe(false);
    expect(session().currentRunId).toBeNull();

    handleEngineEvents([ev(RUN_B, "delta", 1, "下一回合")], deps());
    handleEngineEvents([ev(RUN_B, "done", 2, { usage: null })], deps());
    expect(session().streaming).toBe(false);
    expect(session().currentRunId).toBeNull();
    expect(session().settledRunIds).toEqual(expect.arrayContaining([RUN_A, RUN_B]));
  });
});
