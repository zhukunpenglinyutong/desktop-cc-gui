import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import { useChatStore } from "../store";
import { useGitStore } from "@/features/git/store";
import { RunStatusStrip } from "./RunStatusStrip";
import { deriveTodoList } from "./agent-task-steps";
import { ipc } from "@/lib/ipc";
import { type BackgroundTask } from "../store/stream";
import type { Message, TodosPayload } from "@/lib/ipc";

// React's act() environment flag — a well-known global the runtime can't
// validate, so a named cast with no narrowing is the right boundary.
const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

const KEY = "test-session";
const WS = "/ws";

function msg(seq: number, role: string, text: string, path?: string): Message {
  return { seq, role, text, path: path ?? null, ts: null };
}
function todoMsg(seq: number, todos: TodosPayload): Message {
  return { seq, role: "tool", text: "todo", ts: null, todos };
}

/** Turn with one active subagent spawn and one edit to /ws/src/a.ts. */
const TURN: Message[] = [
  msg(1, "user", "fix the tests"),
  msg(2, "tool", "task · Dispatching 10 parallel fix agents"),
  msg(3, "tool", "edit_file", "/ws/src/a.ts"),
];

function seed(messages: Message[], streaming: boolean) {
  useChatStore.setState({
    bySession: { [KEY]: { messages, streaming } as never },
  });
}

function task(over: Partial<BackgroundTask>): BackgroundTask {
  return {
    id: "t", runId: "r1", taskType: "local_agent", description: "d",
    status: "running", startedAt: 1, updatedAt: 1, ...over,
  };
}

/** Claude reports its subagents as background tasks; this seeds that table. */
function seedTasks(
  tasks: BackgroundTask[],
  messages: Message[] = [msg(1, "user", "跑一下")],
  streaming = false,
  currentRunId: string | null = null,
) {
  useChatStore.setState({
    bySession: {
      [KEY]: {
        messages,
        streaming,
        tasks,
        currentRunId,
        backgroundActive: tasks.some((t) => t.status === "running" && !t.ambient),
      } as never,
    },
  });
}

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  localStorage.clear();
  await i18n.changeLanguage("zh");
  useChatStore.setState({ bySession: {} });
  useGitStore.setState({
    statusByWorkspace: {
      [WS]: {
        branch: "main",
        staged: [],
        unstaged: [{ path: "src/a.ts", status: "M", additions: 10, deletions: 2 }],
        untracked: [],
      },
    },
    // Strip must not hit IPC in tests.
    refresh: async () => {},
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function renderStrip(engine = "pi") {
  await act(async () => {
    root.render(<RunStatusStrip sessionKey={KEY} engine={engine} workspacePath={WS} />);
  });
}

async function click(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function pill(label: string): Element {
  const found = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
    (el) => el.textContent?.includes(label),
  );
  expect(found, `pill ${label}`).toBeTruthy();
  return found!;
}

describe("RunStatusStrip", () => {
  it("does not reread a completed edit payload when assistant text grows", async () => {
    const readContent = vi.fn(() => "one\ntwo");
    const tool: Message = {
      ...msg(1, "tool", "edit_file", "/ws/src/a.ts"),
      args: { get content() { return readContent(); } },
    };
    seed([tool], true);
    await renderStrip();
    const reads = readContent.mock.calls.length;
    expect(reads).toBeGreaterThan(0);
    await act(async () => seed([tool, msg(2, "assistant", "more text")], true));
    expect(readContent).toHaveBeenCalledTimes(reads);
    await act(async () => seed([tool, msg(2, "assistant", "more text still arriving")], true));
    expect(readContent).toHaveBeenCalledTimes(reads);
  });

  it("restores older subagents with their session after switching and reopening", async () => {
    const brief = "# Target\nReview relay recovery.\n# Acceptance\nReconnect without toggling.";
    const history: Message[] = [
      msg(1, "user", "Review the relay"),
      {
        ...msg(2, "tool", "task · Reviewing relay"),
        args: { tasks: [{ name: "SavedReviewer", agent: "reviewer", task: brief }] },
      },
      {
        ...msg(3, "tool", "hub · Waiting for review"),
        args: { op: "wait" },
        result: { details: { jobs: [{ id: "SavedReviewer", status: "completed" }] } },
      },
    ];
    const savedPage = {
      messages: [msg(201, "user", "Continue later"), msg(202, "assistant", "Ready")],
      nextBefore: 201,
      subagentHistory: history,
    };
    vi.spyOn(ipc, "loadSessionPage").mockImplementation(async (_engine, id, _limit, before) =>
      structuredClone(id === "saved" ? before ? {
        messages: history,
        nextBefore: null,
        subagentHistory: [],
      } : savedPage : {
        messages: [msg(1, "user", "Unrelated session")],
        nextBefore: null,
        subagentHistory: [],
      }),
    );
    const open = async (id: string) => {
      await act(async () => {
        await useChatStore.getState().selectSession("omp", id, WS);
        root.render(<RunStatusStrip key={id} sessionKey={`omp/${id}`} engine="omp" workspacePath={WS} />);
      });
    };

    await open("saved");
    await click(pill("子代理"));
    const row = container.querySelector<HTMLButtonElement>("[data-agent-step-key]")!;
    expect(row.textContent).toContain("SavedReviewer");
    expect(row.textContent).toContain("reviewer");
    expect(row.textContent).toContain("已完成");
    await click(row);
    expect(container.querySelector("[data-testid='subagent-detail-overlay'] pre")?.textContent).toBe(brief);

    await open("other");
    expect(container.querySelector("[data-testid='run-status-strip']")).toBeNull();
    await open("saved");
    expect(pill("子代理").textContent).toContain("1/1");

    // Drop all frontend session state: reopening must reconstruct from history.
    await act(async () => {
      root.unmount();
      useChatStore.setState({ bySession: {}, active: null });
    });
    root = createRoot(container);
    await open("saved");
    await click(pill("子代理"));
    const restored = container.querySelector<HTMLButtonElement>("[data-agent-step-key]")!;
    expect(restored.textContent).toContain("SavedReviewer");
    expect(restored.textContent).toContain("已完成");
    await click(restored);
    expect(container.querySelector("[data-testid='subagent-detail-overlay'] pre")?.textContent).toBe(brief);

    await act(async () => {
      await useChatStore.getState().loadEarlier();
    });
    await click(container.querySelector("[aria-label='返回子代理列表']")!);
    expect(pill("子代理").textContent).toContain("1/1");
    expect(container.querySelectorAll("[data-agent-step-key]")).toHaveLength(1);
    await act(async () => {
      useChatStore.setState((state) => {
        const session = state.bySession["omp/saved"];
        return {
          bySession: {
            ...state.bySession,
            "omp/saved": {
              ...session,
              streaming: true,
              messages: [...session.messages, {
                ...msg(203, "tool", "hub · Resuming saved reviewer"),
                args: { op: "wait" },
                result: { details: { jobs: [{ id: "SavedReviewer", status: "running" }] } },
              }],
            },
          },
        };
      });
    });
    expect(container.querySelector("[data-agent-step-key]")?.textContent).toContain("运行中");
    expect(pill("子代理").textContent).toContain("0/1");
  });

  it("moves focus into the subagent detail and back to its row", async () => {
    seed(TURN, true);
    await renderStrip();
    await click(pill("子代理"));

    const row = container.querySelector<HTMLButtonElement>("[data-agent-step-key]")!;
    await click(row);
    const back = container.querySelector<HTMLButtonElement>("[aria-label='返回子代理列表']");
    expect(document.activeElement).toBe(back);

    await click(back!);
    const restored = container.querySelector<HTMLButtonElement>(
      `[data-agent-step-key="${row.dataset.agentStepKey}"]`,
    );
    expect(document.activeElement).toBe(restored);
  });

  it("renders subagent count and edited git stats as pills", async () => {
    seed(TURN, true);
    await renderStrip();
    expect(pill("子代理").textContent).toContain("0/1");
    // The +/− numbers render as odometer digit columns, so the pill's text
    // content is the 0-9 strip: read the semantic value instead.
    const edited = pill("已编辑");
    const additions = edited.querySelector("[data-testid='run-status-edit-additions']");
    const deletions = edited.querySelector("[data-testid='run-status-edit-deletions']");
    expect(additions?.getAttribute("aria-label")).toBe("+10");
    expect(additions?.getAttribute("data-value")).toBe("10");
    expect(deletions?.getAttribute("aria-label")).toBe("−2");
    expect(deletions?.getAttribute("data-value")).toBe("2");
  });

  it("opens panels single-open above the strip and closes on Esc", async () => {
    seed(TURN, true);
    await renderStrip();

    await click(pill("子代理"));
    expect(container.querySelector("[data-testid='run-status-subagents']")?.textContent).toContain(
      "运行中",
    );

    // Single-open: switching pills swaps the panel.
    await click(pill("已编辑"));
    expect(container.querySelector("[data-testid='run-status-subagents']")).toBeNull();
    expect(container.querySelector("[data-testid='run-status-files']")?.textContent).toContain(
      "a.ts",
    );

    // Same pill toggles closed…
    await click(pill("已编辑"));
    expect(container.querySelector("[data-testid='run-status-files']")).toBeNull();

    // …and Esc collapses an open panel.
    await click(pill("子代理"));
    expect(container.querySelector("[data-testid='run-status-subagents']")).not.toBeNull();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(container.querySelector("[data-testid='run-status-subagents']")).toBeNull();
  });

  it("chrome toggle hides the pill row and persists across remounts", async () => {
    seed(TURN, true);
    await renderStrip();
    await click(container.querySelector("[aria-label='收起运行状态']")!);
    expect(container.querySelector('[role="tab"]')).toBeNull();
    expect(localStorage.getItem("ccgui.chat.runStatusChromeOpen")).toBe("0");

    await act(async () => root.unmount());
    root = createRoot(container);
    await renderStrip();
    expect(container.querySelector('[role="tab"]')).toBeNull();
    expect(container.querySelector("[aria-label='展开运行状态']")).not.toBeNull();
  });

  it("freezes counts and shows 已完成 once the turn settles", async () => {
    seed(TURN, true);
    await renderStrip();
    await act(async () => {
      seed(TURN, false);
    });
    expect(pill("子代理").textContent).toContain("1/1");
    await click(pill("子代理"));
    expect(container.querySelector("[data-testid='run-status-subagents']")?.textContent).toContain(
      "已完成",
    );
    expect(container.querySelector("[data-testid='run-status-subagents']")?.textContent).not.toContain(
      "运行中",
    );
  });

  it("renders nothing when the turn has no subagents or edits", async () => {
    seed([msg(1, "user", "hi"), msg(2, "assistant", "hello")], false);
    await renderStrip();
    expect(container.querySelector("[data-testid='run-status-strip']")).toBeNull();
  });
  it("ignores write-tool rows targeting device endpoints, not files", async () => {
    seed(
      [msg(1, "user", "hi"), msg(2, "tool", "write", "xd://browser"), msg(3, "tool", "edit_file", "/ws/src/a.ts")],
      false,
    );
    await renderStrip();
    await click(pill("已编辑"));
    const files = container.querySelector("[data-testid='run-status-files']");
    expect(files?.textContent).toContain("a.ts");
    expect(files?.textContent).not.toContain("browser");
  });
  it("keeps files edited in earlier turns (session-scoped, no expiry)", async () => {
    seed(
      [
        msg(1, "user", "first turn"),
        msg(2, "tool", "edit_file", "/ws/src/old.ts"),
        msg(3, "assistant", "done"),
        msg(4, "user", "second turn"),
        msg(5, "assistant", "no edits this turn"),
      ],
      false,
    );
    await renderStrip();
    await click(pill("已编辑"));
    expect(container.querySelector("[data-testid='run-status-files']")?.textContent).toContain(
      "old.ts",
    );
  });
  it("folds todo snapshots and patches into the 任务 pill", async () => {
    seed(
      [
        msg(1, "user", "do work"),
        todoMsg(2, {
          replace: true,
          items: [
            { content: "定位根因", status: "pending" },
            { content: "修复", status: "pending" },
            { content: "回归验证", status: "pending" },
          ],
        }),
        todoMsg(3, { replace: false, items: [{ content: "定位根因", status: "complete" }] }),
        todoMsg(4, { replace: false, items: [{ content: "修复", status: "active" }] }),
      ],
      true,
    );
    await renderStrip();
    expect(pill("任务").textContent).toContain("1/3");
    await click(pill("任务"));
    const panel = container.querySelector("[data-testid='run-status-todos']")?.textContent;
    expect(panel).toContain("定位根因");
    expect(panel).toContain("已完成");
    expect(panel).toContain("运行中");
    expect(panel).toContain("待处理");
  });

  it("a later replace snapshot resets the list; dropped patches remove items", async () => {
    const folded = deriveTodoList([
      todoMsg(1, {
        replace: true,
        items: [
          { content: "a", status: "pending" },
          { content: "b", status: "pending" },
        ],
      }),
      todoMsg(2, { replace: false, items: [{ content: "a", status: "dropped" }] }),
      todoMsg(3, { replace: true, items: [{ content: "c", status: "complete" }] }),
    ]);
    expect(folded).toEqual([{ content: "c", status: "complete" }]);
  });

  it("extracts subagent type and description with breathing light indicator", async () => {
    const subagentTurn: Message[] = [
      msg(1, "user", "run architecture analysis"),
      {
        seq: 2,
        role: "tool",
        text: "Agent",
        ts: null,
        args: {
          subagent_type: "architect",
          description: "分析系统设计与模块划分",
        },
      },
    ];

    seed(subagentTurn, true);
    await renderStrip();

    expect(pill("子代理").textContent).toContain("0/1");
    // In running state, breathing light animation is rendered
    expect(container.querySelector(".animate-ping")).not.toBeNull();

    await click(pill("子代理"));
    const panel = container.querySelector("[data-testid='run-status-subagents']")?.textContent;
    expect(panel).toContain("architect");
    expect(panel).toContain("分析系统设计与模块划分");
    expect(panel).toContain("运行中");
  });

  it("opens a subagent's full assignment inside the existing panel", async () => {
    const assignment = "# Target\nOwn relay.rs only.\n# Acceptance\nOutages recover without toggling.";
    seed([
      msg(1, "user", "delegate"),
      {
        seq: 2,
        role: "tool",
        text: "task · Dispatching relay worker",
        ts: null,
        args: { tasks: [{ agent: "task", name: "RelayRecovery", task: assignment }] },
      },
    ], true);
    await renderStrip();
    await click(pill("子代理"));
    await click(container.querySelector("[data-agent-step-key]")!);

    const panel = container.querySelector("[data-testid='run-status-subagents']");
    expect(panel?.textContent).toContain("RelayRecovery");
    expect(panel?.textContent).toContain("Own relay.rs only.");
    expect(panel?.textContent).toContain("Outages recover without toggling.");
    expect(panel?.querySelector("[data-testid='subagent-detail-overlay']")).not.toBeNull();
  });

  it("keeps subagents from earlier turns visible in completed state", async () => {
    const multiTurn: Message[] = [
      msg(1, "user", "turn 1: run subagent"),
      {
        seq: 2,
        role: "tool",
        text: "Agent",
        ts: null,
        args: {
          subagent_type: "code-reviewer",
          description: "检查代码安全漏洞",
        },
      },
      msg(3, "assistant", "turn 1 finished"),
      msg(4, "user", "turn 2: ordinary message"),
      msg(5, "assistant", "no subagents here"),
    ];

    seed(multiTurn, false);
    await renderStrip();

    // The subagent pill survives cross-turn in completed state
    expect(pill("子代理").textContent).toContain("1/1");
    expect(container.querySelector(".animate-ping")).toBeNull();

    await click(pill("子代理"));
    const panel = container.querySelector("[data-testid='run-status-subagents']")?.textContent;
    expect(panel).toContain("code-reviewer");
    expect(panel).toContain("检查代码安全漏洞");
    expect(panel).toContain("已完成");
  });

  it("reads the claude subagent steps from the session's task table", async () => {
    // TURN carries a message-derived subagent row of its own: the task table
    // is the real data and must win over the message fold.
    seedTasks(
      [
        task({ id: "a", subagentType: "general-purpose", description: "读文档" }),
        task({ id: "b", status: "completed", workflowName: "ccgui-full-parse" }),
        task({ id: "c", status: "failed", description: "坏掉的子代理" }),
      ],
      TURN,
    );
    await renderStrip("claude");

    // Settled over total: 1 running, 1 completed, 1 failed → 2/3.
    expect(pill("子代理").textContent).toContain("2/3");
    await click(pill("子代理"));
    const panel = container.querySelector("[data-testid='run-status-subagents']")?.textContent;
    expect(panel).toContain("general-purpose");
    expect(panel).toContain("ccgui-full-parse");
    expect(panel).toContain("坏掉的子代理");
    expect(panel).toContain("运行中");
    expect(panel).toContain("已完成");
    expect(panel).toContain("失败");
  });

  /** Turn-level surface: ambient housekeeping never belongs to the pill, and
   *  once a run is claimed only its own tasks tell the turn's story. */
  it("keeps ambient tasks and other runs' settled tasks out of the subagent pill", async () => {
    seedTasks(
      [
        task({ id: "mon", ambient: true, description: "夜间巡检" }),
        task({ id: "old", runId: "old-run", status: "completed", description: "旧回合" }),
        task({ id: "now", runId: "now-run" }),
      ],
      TURN,
      false,
      "now-run",
    );
    await renderStrip("claude");

    expect(pill("子代理").textContent).toContain("0/1");
    await click(pill("子代理"));
    const panel = container.querySelector("[data-testid='run-status-subagents']")?.textContent;
    expect(panel).toContain("运行中");
    expect(panel).not.toContain("夜间巡检");
    expect(panel).not.toContain("旧回合");
  });

  it("renders a failed task in the error palette without a breathing dot", async () => {
    seedTasks([
      task({ id: "a", status: "failed", subagentType: "code-reviewer", description: "审查" }),
    ]);
    await renderStrip("claude");
    // The only task is dead: the pill must not claim something is running.
    // Settled semantics: the failed step counts toward the numerator (1/1) —
    // what matters is that nothing claims to be running.
    expect(pill("子代理").textContent).toContain("1/1");
    expect(container.querySelector(".animate-ping")).toBeNull();

    await click(pill("子代理"));
    const row = container.querySelector<HTMLButtonElement>("[data-agent-step-key]");
    expect(row?.textContent).toContain("失败");
    expect(row?.querySelector(".animate-ping")).toBeNull();
    expect(row?.querySelector(".text-text-error-primary")).not.toBeNull();
    // The name steps down to the settled tone instead of fighting the red.
    expect(row?.querySelector(".text-caption-1-medium")?.className).toContain(
      "text-text-secondary",
    );
  });

  it("keeps the message-derived steps for engines that report no task frames", async () => {
    seedTasks([task({ id: "a" }), task({ id: "b", status: "completed" })], TURN, true);
    await renderStrip("pi");

    // pi has no task table: the pill still follows the message stream (one
    // active subagent in TURN), not the claude-only task rows.
    expect(pill("子代理").textContent).toContain("0/1");
  });

  /** 详情覆盖层沿用列表行的色调规则：failed 步的名字降为次级色，不与旁边
   *  红色「失败」抢焦点。 */
  it("steps a failed subagent's name down inside the detail overlay", async () => {
    seedTasks([
      task({ id: "a", status: "failed", subagentType: "code-reviewer", description: "审查" }),
    ]);
    await renderStrip("claude");

    await click(pill("子代理"));
    const row = container.querySelector<HTMLButtonElement>("[data-agent-step-key]")!;
    await click(row);

    const overlay = container.querySelector("[data-testid='subagent-detail-overlay']");
    expect(overlay).not.toBeNull();
    // The step's label is its brief (the chain prefers the description over
    // the bare type); the subagentType rides along as the type chip, and the
    // row that opened this overlay read the same text.
    const label = overlay!.querySelector(".text-caption-1-medium");
    expect(label?.textContent).toContain("审查");
    expect(label?.className).toContain("text-text-secondary");
    expect(label?.className).not.toContain("text-text-primary");
    expect(overlay!.textContent).toContain("code-reviewer");
  });

  /** 新回合的 runId 在发送时被乐观写入，先于该 run 的首个任务帧到达：
   *  pill 不得闪烁消失，已打开的面板不得收起；新 run 的首个任务帧到达后
   *  才切换为新回合的计数。 */
  it("freezes the pill over the turn gap instead of blinking away", async () => {
    const history = [
      task({ id: "old-1", runId: "r1", status: "completed", description: "旧任务一" }),
      task({ id: "old-2", runId: "r1", status: "completed", description: "旧任务二" }),
    ];
    seedTasks(history, undefined, false, "r1");
    await renderStrip("claude");
    expect(pill("子代理").textContent).toContain("2/2");
    await click(pill("子代理"));
    expect(container.querySelector("[data-testid='run-status-subagents']")?.textContent).toContain(
      "旧任务一",
    );

    // 发送新消息：currentRunId 切到 r2，任务表里还没有 r2 的任何帧。
    await act(async () => {
      useChatStore.setState({
        bySession: {
          [KEY]: {
            messages: [msg(1, "user", "跑一下"), msg(2, "user", "再来一轮")],
            streaming: true,
            tasks: history,
            currentRunId: "r2",
            backgroundActive: false,
          } as never,
        },
      });
    });
    // Pill 冻结在上一回合的计数上，面板保持打开。
    expect(pill("子代理").textContent).toContain("2/2");
    expect(container.querySelector("[data-testid='run-status-subagents']")?.textContent).toContain(
      "旧任务一",
    );

    // r2 的首个任务帧到达：pill 切换为新回合的计数与内容。
    await act(async () => {
      useChatStore.setState({
        bySession: {
          [KEY]: {
            messages: [msg(1, "user", "跑一下"), msg(2, "user", "再来一轮")],
            streaming: true,
            tasks: [...history, task({ id: "new-1", runId: "r2", description: "新任务" })],
            currentRunId: "r2",
            backgroundActive: true,
          } as never,
        },
      });
    });
    expect(pill("子代理").textContent).toContain("0/1");
    const panel = container.querySelector("[data-testid='run-status-subagents']")?.textContent;
    expect(panel).toContain("新任务");
    expect(panel).not.toContain("旧任务一");
  });

  /** stopped/interrupted 不是「已完成」：pill 面板与后台任务面板用同一份
   *  i18n 状态文案（灰「已停止」/红「已中断」），不得显示绿勾已完成。 */
  it("names stopped and interrupted tasks instead of reading them as done", async () => {
    seedTasks([
      task({ id: "s", status: "stopped", description: "被停下的" }),
      task({ id: "i", status: "interrupted", description: "被中断的" }),
    ]);
    await renderStrip("claude");
    // Both settled: they count toward the numerator, but nothing breathes
    // and nothing claims completion.
    expect(pill("子代理").textContent).toContain("2/2");
    expect(container.querySelector(".animate-ping")).toBeNull();

    await click(pill("子代理"));
    const panelEl = container.querySelector("[data-testid='run-status-subagents']")!;
    const panel = panelEl.textContent ?? "";
    expect(panel).toContain("已停止");
    expect(panel).toContain("已中断");
    expect(panel).not.toContain("已完成");
    // interrupted goes red like failed; stopped stays gray.
    const rows = [...panelEl.querySelectorAll<HTMLButtonElement>("[data-agent-step-key]")];
    const stoppedRow = rows.find((r) => r.textContent?.includes("已停止"))!;
    const interruptedRow = rows.find((r) => r.textContent?.includes("已中断"))!;
    expect(stoppedRow.querySelector(".text-text-error-primary")).toBeNull();
    expect(interruptedRow.querySelector(".text-text-error-primary")).not.toBeNull();
  });

  it("correctly maps TaskCreate and subsequent TaskUpdate by taskId to complete status", async () => {
    const taskTurn: Message[] = [
      msg(1, "user", "create and complete task"),
      {
        seq: 2,
        role: "tool",
        text: "TaskCreate",
        ts: null,
        args: {
          subject: "在输入框上方模块增加子代理任务信息与呼吸灯",
        },
        result: "Task #13 created successfully",
        todos: {
          replace: false,
          items: [
            {
              id: "13",
              content: "在输入框上方模块增加子代理任务信息与呼吸灯",
              status: "pending",
            },
          ],
        },
      },
      {
        seq: 3,
        role: "tool",
        text: "TaskUpdate",
        ts: null,
        args: {
          taskId: "13",
          status: "completed",
        },
        todos: {
          replace: false,
          items: [
            {
              id: "13",
              content: "",
              status: "complete",
            },
          ],
        },
      },
    ];

    seed(taskTurn, false);
    await renderStrip();

    expect(pill("任务").textContent).toContain("1/1");
    await click(pill("任务"));
    const panel = container.querySelector("[data-testid='run-status-todos']")?.textContent;
    expect(panel).toContain("在输入框上方模块增加子代理任务信息与呼吸灯");
    expect(panel).toContain("已完成");
    expect(panel).not.toContain("待处理");
  });

  it("turns off breathing dots on both 任务 and 子代理 pills when streaming is false", async () => {
    const messages: Message[] = [
      msg(1, "user", "run tasks"),
      {
        seq: 2,
        role: "tool",
        text: "task · Dispatching 4 agents",
        ts: null,
        args: {
          tasks: [
            { name: "A", task: "Task A" },
            { name: "B", task: "Task B" },
            { name: "C", task: "Task C" },
            { name: "D", task: "Task D" },
          ],
        },
      },
      {
        seq: 3,
        role: "tool",
        text: "hub · Waiting for agents",
        ts: null,
        args: { op: "wait" },
        result: {
          details: {
            jobs: [
              { id: "A", status: "completed" },
              { id: "B", status: "completed" },
              { id: "C", status: "completed" },
              { id: "D", status: "running" },
            ],
          },
        },
      },
      todoMsg(4, {
        replace: true,
        items: [{ content: "单一任务", status: "active" }],
      }),
      msg(5, "assistant", "Turn finished."),
    ];

    // While streaming: both pills show breathing light
    seed(messages, true);
    await renderStrip();
    expect(pill("任务").textContent).toContain("0/1");
    expect(pill("子代理").textContent).toContain("3/4");
    expect(container.querySelectorAll(".animate-ping").length).toBeGreaterThanOrEqual(2);

    // When turn ends (streaming: false): breathing lights MUST turn off
    await act(async () => seed(messages, false));
    expect(pill("任务").textContent).toContain("0/1");
    expect(pill("子代理").textContent).toContain("4/4");
    expect(container.querySelector(".animate-ping")).toBeNull();

    // Inside panel: when not live, active item displays 待处理 instead of 运行中
    await click(pill("任务"));
    const todoPanel = container.querySelector("[data-testid='run-status-todos']")?.textContent;
    expect(todoPanel).toContain("待处理");
    expect(todoPanel).not.toContain("运行中");
  });

  it("reads completed todo snapshot from message.result without pre-set message.todos", async () => {
    const messages: Message[] = [
      msg(1, "user", "complete todo"),
      {
        seq: 2,
        role: "tool",
        text: "todo",
        ts: null,
        args: { op: "init" },
        result: {
          details: {
            phases: [
              {
                name: "phase1",
                tasks: [{ content: "修复状态问题", status: "completed" }],
              },
            ],
          },
        },
      },
      msg(3, "assistant", "done"),
    ];

    seed(messages, false);
    await renderStrip();
    expect(pill("任务").textContent).toContain("1/1");
    expect(container.querySelector(".animate-ping")).toBeNull();
  });

  it("drills down into task detail and execution status on click, and returns on back", async () => {
    const messages: Message[] = [
      msg(1, "user", "create task"),
      {
        seq: 2,
        role: "tool",
        text: "todo",
        ts: null,
        args: { op: "init" },
        result: {
          details: {
            phases: [
              {
                name: "Diagnose",
                tasks: [
                  {
                    content: "定位页面查询零条数原因",
                    status: "completed",
                    detail: "排查数据库连接池与实体映射",
                  },
                ],
              },
            ],
          },
        },
      },
      msg(3, "assistant", "done"),
    ];

    seed(messages, false);
    await renderStrip();
    await click(pill("任务"));

    // Find the task row button and click it to drill down
    const row = container.querySelector<HTMLButtonElement>("[data-todo-item-key]")!;
    expect(row).not.toBeNull();
    expect(row.textContent).toContain("定位页面查询零条数原因");
    await click(row);

    // Overlay is open
    const overlay = container.querySelector("[data-testid='todo-detail-overlay']");
    expect(overlay).not.toBeNull();
    expect(overlay?.textContent).toContain("定位页面查询零条数原因");
    expect(overlay?.textContent).toContain("Diagnose");
    expect(overlay?.textContent).toContain("已完成");
    expect(overlay?.textContent).toContain("排查数据库连接池与实体映射");

    // Focus moved to back button
    const back = container.querySelector<HTMLButtonElement>("[aria-label='返回任务列表']");
    expect(document.activeElement).toBe(back);

    // Click back to return to the task list
    await click(back!);
    expect(container.querySelector("[data-testid='todo-detail-overlay']")).toBeNull();
    expect(container.querySelectorAll("[data-todo-item-key]")).toHaveLength(1);
    expect(document.activeElement?.getAttribute("data-todo-item-key")).toBe("定位页面查询零条数原因");
  });
});
