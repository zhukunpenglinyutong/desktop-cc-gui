import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import { sessionKey, useChatStore } from "../store";
import { EMPTY_SESSION, type BackgroundTask } from "../store/stream";
import { BackgroundTasksLine, BackgroundTasksPanel } from "./BackgroundTasksPanel";

// React's act() environment flag — same boundary as RunStatusStrip.test.tsx.
const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

const WS = "/ws";
const KEY = sessionKey("claude", "s-1", WS);

const task = (over: Partial<BackgroundTask>): BackgroundTask => ({
  id: "t", runId: "r1", taskType: "local_agent", description: "d",
  status: "running", startedAt: 1, updatedAt: 1, ...over,
});

/** Running run ("old" by clock) plus a completed later run: the panel must
 *  still float the running group above the newer settled one. */
const TASKS: BackgroundTask[] = [
  task({ id: "w", runId: "old", taskType: "local_workflow", workflowName: "ccgui-full-parse", startedAt: 1 }),
  task({
    id: "a", runId: "new", status: "completed", subagentType: "general-purpose",
    description: "读文档", startedAt: 2, progress: "Running Wait 590 seconds",
  }),
];

function seed(tasks: BackgroundTask[], active = true) {
  useChatStore.setState({
    active: active ? { engine: "claude", sessionId: "s-1", workspacePath: WS } : null,
    bySession: { [KEY]: { ...EMPTY_SESSION, tasks } },
  });
}

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  localStorage.clear();
  await i18n.changeLanguage("zh");
  seed([]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function renderPanel() {
  await act(async () => {
    root.render(<BackgroundTasksPanel workspacePath={WS} />);
  });
}

describe("BackgroundTasksPanel", () => {
  it("renders tasks grouped by run with status badges", async () => {
    seed(TASKS);
    await renderPanel();
    const text = container.textContent ?? "";
    // Group header carries the turn time, one per run.
    expect(text).toContain("回合");
    expect(text.match(/回合/g)).toHaveLength(2);
    // Labels fall back through workflowName → description → subagentType.
    expect(text).toContain("ccgui-full-parse");
    expect(text).toContain("读文档");
    // One badge per task, keyed off its status.
    expect(text).toContain("运行中");
    expect(text).toContain("已完成");
    // Live activity line renders under the row.
    expect(text).toContain("Running Wait 590 seconds");
    // The running run floats above the newer settled one.
    expect(text.indexOf("ccgui-full-parse")).toBeLessThan(text.indexOf("读文档"));
  });

  /** 回合组头跨天不能只给时分：今天 HH:mm，今年 MM-dd HH:mm，更早全日期
   *  （与 MessageTimeline 的 formatMessageTime 同一模式）。 */
  it("dates a turn group header once it is not from today", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 8, 24, 10, 0));
      seed([
        task({
          id: "today", status: "completed",
          startedAt: new Date(2026, 8, 24, 9, 5).getTime(),
          updatedAt: new Date(2026, 8, 24, 9, 6).getTime(),
        }),
        task({
          id: "this-year", runId: "r2", status: "completed",
          startedAt: new Date(2026, 8, 20, 8, 30).getTime(),
          updatedAt: new Date(2026, 8, 20, 8, 31).getTime(),
        }),
        task({
          id: "last-year", runId: "r3", status: "completed",
          startedAt: new Date(2025, 11, 31, 23, 40).getTime(),
          updatedAt: new Date(2025, 11, 31, 23, 41).getTime(),
        }),
      ]);
      await renderPanel();
      const text = container.textContent ?? "";
      expect(text).toContain("回合 09:05");
      expect(text).toContain("回合 09-20 08:30");
      expect(text).toContain("回合 2025-12-31 23:40");
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the empty state when the session has no tasks", async () => {
    await renderPanel();
    expect(container.textContent).toContain("暂无后台任务");
  });

  it("falls back to the empty state when no session is active", async () => {
    seed(TASKS, false);
    await renderPanel();
    expect(container.textContent).toContain("暂无后台任务");
  });

  /** 规格验收的「耗时」：运行行按 now - startedAt 走表（面板内有运行任务时 1s
   *  一跳），结算行按 updatedAt - startedAt 定格。 */
  it("shows each row's elapsed time and ticks it while a task runs", async () => {
    vi.useFakeTimers();
    try {
      const now = new Date("2026-09-21T10:00:00Z").getTime();
      vi.setSystemTime(now);
      seed([
        task({ id: "run", startedAt: now - 5_000, updatedAt: now - 5_000 }),
        task({ id: "settled", status: "completed", startedAt: now - 125_000, updatedAt: now - 65_000 }),
      ]);
      await renderPanel();
      expect(container.textContent).toContain("5.0s");
      expect(container.textContent).toContain("1m");

      // The running row's clock advances with the panel's tick.
      await act(async () => {
        vi.advanceTimersByTime(1_000);
      });
      expect(container.textContent).toContain("6.0s");
      // The settled row's elapsed time is frozen at its own last update.
      expect(container.textContent).toContain("1m");
    } finally {
      vi.useRealTimers();
    }
  });

  /** 类型名走 i18n：CLI 没有给出描述/子代理类型时不再把 local_bash 这类原始
   *  类型串摆在界面上；未知类型仍回落原文。 */
  it("names a descriptionless task's type from i18n", async () => {
    seed([
      task({ id: "bash", taskType: "local_bash", description: "" }),
      task({ id: "agent", taskType: "local_agent", description: "" }),
      task({ id: "wf", taskType: "local_workflow", description: "" }),
      task({ id: "odd", taskType: "local_mystery", description: "" }),
    ]);
    await renderPanel();
    const text = container.textContent ?? "";
    expect(text).toContain("后台命令");
    expect(text).toContain("子代理");
    expect(text).toContain("工作流");
    expect(text).toContain("local_mystery");
    expect(text).not.toContain("local_bash");
  });

  it("BackgroundTasksLine names the running task count", async () => {
    await act(async () => {
      root.render(<BackgroundTasksLine count={2} />);
    });
    expect(container.textContent).toContain("后台任务运行中 · 2 个");
  });

  /** Reduced-motion 降级：脉冲点必须静止。 */
  it("stills the BackgroundTasksLine pulse under reduced motion", async () => {
    await act(async () => {
      root.render(<BackgroundTasksLine count={1} />);
    });
    const dot = container.querySelector(".animate-pulse");
    expect(dot).not.toBeNull();
    expect(dot!.className).toContain("motion-reduce:animate-none");
  });
});
