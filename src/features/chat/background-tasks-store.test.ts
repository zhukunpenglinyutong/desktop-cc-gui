import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineEventPayload } from "@/lib/events";
import { useChatStore } from "./store";
import {
  handleEngineEvents,
  settleOrphanedRuns,
  type EngineEventDeps,
} from "./store/engine-events";
import { sessionKey } from "./store/persistence";
import { EMPTY_SESSION, runRouting, type BackgroundTask } from "./store/stream";

vi.mock("@/lib/ipc", () => ({
  ipc: { rescanSessions: vi.fn(async () => {}), usageRecord: vi.fn(async () => {}) },
}));
vi.mock("@/lib/events", () => ({
  listenEngineEvents: vi.fn(async () => () => {}),
  listenSessionsChanged: vi.fn(async () => () => {}),
}));

const KEY = sessionKey("claude", "s-1", "/tmp/ws");
const KEY2 = sessionKey("claude", "s-2", "/tmp/ws");
let runId: string;
let drainSpy: ReturnType<typeof vi.fn>;

function deps(): EngineEventDeps {
  return {
    set: useChatStore.setState,
    get: useChatStore.getState,
    drainQueue: drainSpy,
    markUnseenIfBackground: () => {},
    upsertSessionMeta: () => {},
  };
}

function ev(kind: EngineEventPayload["kind"], seq: number, data: unknown, eventRunId = runId, key = KEY) {
  return { runId: eventRunId, sessionId: key.split("/").pop()!, engine: "claude", seq, kind, data };
}

describe("background task store", () => {
  beforeEach(() => {
    runId = `bg-${Date.now()}-${Math.random()}`;
    localStorage.clear();
    vi.clearAllMocks();
    drainSpy = vi.fn();
    runRouting.clear();
    useChatStore.setState({
      openTabs: [],
      active: null,
      unseen: {},
      bySession: {
        [KEY]: { ...EMPTY_SESSION, streaming: true, messages: [{ seq: 1, role: "user", text: "go", ts: null }] },
      },
      streamingByKey: { [KEY]: true },
    });
  });

  it("tracks a started task and marks the session background-active", () => {
    handleEngineEvents(
      [ev("task_started", 2, {
        taskId: "w1", taskType: "local_workflow", description: "全量解析",
        workflowName: "ccgui-full-parse",
      })],
      deps(),
    );
    const s = useChatStore.getState().bySession[KEY]!;
    expect(s.tasks).toHaveLength(1);
    expect(s.tasks[0]).toMatchObject({
      id: "w1", runId, taskType: "local_workflow", status: "running",
      description: "全量解析", workflowName: "ccgui-full-parse",
    });
    expect(s.backgroundActive).toBe(true);
  });

  // The Rust side counts only the tasks a run waits for (it filters ambient
  // ones out of `pending_tasks`), so the frontend's turn-level derivations have
  // to agree — otherwise one ambient monitor makes the session read as
  // "background running" for its whole life. The panel still shows the row.
  it("does not read as background-active for an ambient-only task", () => {
    handleEngineEvents(
      [ev("tasks", 2, {
        tasks: [{ taskId: "mon", taskType: "local_agent", description: "monitor", ambient: true }],
      })],
      deps(),
    );
    const s = useChatStore.getState().bySession[KEY]!;
    expect(s.tasks).toHaveLength(1);
    expect(s.tasks[0].ambient).toBe(true);
    expect(s.backgroundActive).toBe(false);
  });

  it("patches live progress onto the running task", () => {
    handleEngineEvents(
      [
        ev("task_started", 2, { taskId: "w1", taskType: "local_workflow", description: "wf" }),
        ev("task_progress", 3, { taskId: "w1", description: "探针阶段: probe-1plus1" }),
      ],
      deps(),
    );
    expect(useChatStore.getState().bySession[KEY]!.tasks[0].progress).toBe("探针阶段: probe-1plus1");
  });

  it("converges on notification and clears background-active", () => {
    handleEngineEvents(
      [
        ev("task_started", 2, { taskId: "w1", taskType: "local_agent", description: "a" }),
        ev("task_notification", 3, { taskId: "w1", status: "completed" }),
      ],
      deps(),
    );
    const s = useChatStore.getState().bySession[KEY]!;
    expect(s.tasks[0].status).toBe("completed");
    expect(s.backgroundActive).toBe(false);
  });

  // The CLI's resume-time reconciliation of a NEW process cannot see the older
  // process's still-live tasks and reports them as stopped ("didn't finish
  // before the previous session ended"). The row belongs to the run that
  // reported it, so a foreign run's notification must not settle it.
  it("lets the next run's tasks frame adopt an ambient row a dead run left interrupted", () => {
    handleEngineEvents(
      [
        ev("tasks", 2, {
          tasks: [{ taskId: "mon", taskType: "local_agent", description: "monitor", ambient: true }],
        }),
        // The owning run dies: its settle labels the ambient row interrupted.
        ev("done", 3, { usage: null, backgroundTasks: 0 }),
      ],
      deps(),
    );
    expect(useChatStore.getState().bySession[KEY]!.tasks[0].status).toBe("interrupted");

    // The session's next run lists the same ambient housekeeping task in its
    // authoritative set: the row transfers to it and reads as running again
    // instead of staying mislabeled forever.
    handleEngineEvents(
      [
        ev("tasks", 4, {
          tasks: [{ taskId: "mon", taskType: "local_agent", description: "monitor", ambient: true }],
        }, "run-b"),
      ],
      deps(),
    );
    const row = useChatStore.getState().bySession[KEY]!.tasks.find((t) => t.id === "mon")!;
    expect(row).toMatchObject({ runId: "run-b", status: "running", ambient: true });
  });

  it("still refuses a tasks-frame adoption for a run-scoped (non-ambient) row", () => {
    handleEngineEvents(
      [ev("task_started", 2, { taskId: "w1", taskType: "local_workflow", description: "wf" })],
      deps(),
    );
    handleEngineEvents(
      [
        ev("tasks", 3, {
          tasks: [{ taskId: "w1", taskType: "local_workflow", description: "wf" }],
        }, "run-b"),
      ],
      deps(),
    );
    const row = useChatStore.getState().bySession[KEY]!.tasks.find((t) => t.id === "w1")!;
    expect(row).toMatchObject({ runId, status: "running" });
  });

  it("ignores another run's stopped notification for this run's task", () => {
    runRouting.set("other-run", KEY);
    handleEngineEvents(
      [
        ev("task_started", 2, { taskId: "w1", taskType: "local_workflow", description: "wf" }),
        ev("task_notification", 3, { taskId: "w1", status: "stopped" }, "other-run"),
      ],
      deps(),
    );
    const s = useChatStore.getState().bySession[KEY]!;
    expect(s.tasks[0]).toMatchObject({ id: "w1", runId, status: "running" });
    expect(s.backgroundActive).toBe(true);
  });

  it("still settles the row on its own run's notification after a foreign one", () => {
    runRouting.set("other-run", KEY);
    handleEngineEvents(
      [
        ev("task_started", 2, { taskId: "w1", taskType: "local_workflow", description: "wf" }),
        ev("task_notification", 3, { taskId: "w1", status: "stopped" }, "other-run"),
        ev("task_notification", 4, { taskId: "w1", status: "completed" }),
      ],
      deps(),
    );
    expect(useChatStore.getState().bySession[KEY]!.tasks[0].status).toBe("completed");
  });

  it("marks running tasks missing from the replace set as stopped", () => {
    handleEngineEvents(
      [
        ev("task_started", 2, { taskId: "w1", taskType: "local_agent", description: "a" }),
        ev("task_started", 3, { taskId: "w2", taskType: "local_agent", description: "b" }),
        ev("tasks", 4, { tasks: [{ taskId: "w1", taskType: "local_agent", description: "a" }] }),
      ],
      deps(),
    );
    const tasks = useChatStore.getState().bySession[KEY]!.tasks;
    expect(tasks.find((t) => t.id === "w1")!.status).toBe("running");
    expect(tasks.find((t) => t.id === "w2")!.status).toBe("stopped");
  });

  it("keeps task frames scoped to their own session", () => {
    useChatStore.setState((s) => ({
      bySession: { ...s.bySession, [KEY2]: { ...EMPTY_SESSION } },
    }));
    handleEngineEvents([ev("task_started", 2, { taskId: "x", taskType: "local_agent", description: "x" }, `${runId}-other`, KEY2)], deps());
    expect(useChatStore.getState().bySession[KEY]!.tasks).toHaveLength(0);
    expect(useChatStore.getState().bySession[KEY2]!.tasks).toHaveLength(1);
  });

  it("marks a run's running tasks interrupted on error", () => {
    handleEngineEvents(
      [
        ev("task_started", 2, { taskId: "w1", taskType: "local_workflow", description: "wf" }),
        ev("error", 3, "boom"),
      ],
      deps(),
    );
    const s = useChatStore.getState().bySession[KEY]!;
    expect(s.tasks[0].status).toBe("interrupted");
    expect(s.backgroundActive).toBe(false);
  });

  it("settles a reaped run's tasks on the orphan sweep", () => {
    handleEngineEvents(
      [ev("task_started", 2, { taskId: "w1", taskType: "local_workflow", description: "wf" })],
      deps(),
    );
    settleOrphanedRuns(useChatStore.setState, [[runId, KEY]]);
    const s = useChatStore.getState().bySession[KEY]!;
    expect(s.tasks[0].status).toBe("interrupted");
    expect(s.backgroundActive).toBe(false);
  });

  it("trims settled tasks first and always keeps running ones", () => {
    const frames: ReturnType<typeof ev>[] = [];
    // 40 settled tasks around one that never reports a terminal status.
    for (let i = 1; i <= 40; i++) {
      frames.push(ev("task_started", 2 + i * 2, { taskId: `t${i}`, taskType: "local_agent", description: `t${i}` }));
      frames.push(ev("task_notification", 3 + i * 2, { taskId: `t${i}`, status: "completed" }));
    }
    frames.push(ev("task_started", 200, { taskId: "keep", taskType: "local_workflow", description: "keep" }));
    handleEngineEvents(frames, deps());
    const tasks = useChatStore.getState().bySession[KEY]!.tasks;
    expect(tasks).toHaveLength(32);
    expect(tasks.find((t) => t.id === "keep")!.status).toBe("running");
    // Settled tasks are the ones retention drops, oldest first — the running
    // one survives and the surviving settled rows are the newest.
    expect(tasks.find((t) => t.id === "t1")).toBeUndefined();
    expect(tasks.find((t) => t.id === "t40")).toBeDefined();
    expect(tasks[tasks.length - 1].id).toBe("keep");
  });

  it("drops every settled task when running ones already fill the cap", () => {
    const task = (id: string, status: BackgroundTask["status"]): BackgroundTask => ({
      id, runId, taskType: "local_agent", description: id, status, startedAt: Date.now(), updatedAt: Date.now(),
    });
    const settled = [task("s1", "completed"), task("s2", "completed")];
    const running = Array.from({ length: 33 }, (_, i) => task(`r${i}`, "running"));
    useChatStore.setState((s) => ({
      bySession: {
        ...s.bySession,
        [KEY]: { ...s.bySession[KEY]!, tasks: [...settled, ...running], backgroundActive: true },
      },
    }));
    handleEngineEvents([ev("task_progress", 2, { taskId: "r0", description: "阶段" })], deps());
    const tasks = useChatStore.getState().bySession[KEY]!.tasks;
    // The cap leaves no budget for settled rows; running ones are never dropped.
    expect(tasks.filter((t) => t.status !== "running")).toHaveLength(0);
    expect(tasks.filter((t) => t.status === "running")).toHaveLength(33);
  });

  it("keeps settled rows out once running tasks reach the cap through frames", () => {
    const frames: ReturnType<typeof ev>[] = [
      ev("task_started", 1, { taskId: "s1", taskType: "local_agent", description: "s1" }),
      ev("task_notification", 2, { taskId: "s1", status: "completed" }),
      ev("task_started", 3, { taskId: "s2", taskType: "local_agent", description: "s2" }),
      ev("task_notification", 4, { taskId: "s2", status: "completed" }),
    ];
    for (let i = 1; i <= 32; i++) {
      frames.push(ev("task_started", 100 + i, { taskId: `r${i}`, taskType: "local_workflow", description: `r${i}` }));
    }
    handleEngineEvents(frames, deps());
    const tasks = useChatStore.getState().bySession[KEY]!.tasks;
    expect(tasks).toHaveLength(32);
    expect(tasks.filter((t) => t.status !== "running")).toHaveLength(0);
    expect(tasks.filter((t) => t.status === "running")).toHaveLength(32);
  });
});
