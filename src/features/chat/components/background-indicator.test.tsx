import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import type { EngineEventPayload } from "@/lib/events";
import { sessionKey, useChatStore } from "../store";
import { handleEngineEvents, type EngineEventDeps } from "../store/engine-events";
import { EMPTY_SESSION, runRouting, type BackgroundTask, type SessionState } from "../store/stream";
import { MessageTimeline } from "./MessageTimeline";

vi.mock("@/lib/ipc", () => ({
  ipc: { rescanSessions: vi.fn(async () => {}), usageRecord: vi.fn(async () => {}) },
}));
vi.mock("@/lib/events", () => ({
  listenEngineEvents: vi.fn(async () => () => {}),
  listenSessionsChanged: vi.fn(async () => () => {}),
}));

// React's act() environment flag — same boundary as RunStatusStrip.test.tsx.
const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no ResizeObserver and sizes every element 0×0, so the virtualizer
// would compute an empty range and render no row at all — the tail indicator
// under test would then be missing for the wrong reason. A no-op observer plus
// a fake viewport height gets the real render path back.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

// The timeline's load-earlier sentinel observer; never fires in jsdom.
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);

const realOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
const realOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");

const WS = "/ws";
const KEY = sessionKey("claude", "s-1", WS);

function task(over: Partial<BackgroundTask>): BackgroundTask {
  return {
    id: "t", runId: "r1", taskType: "local_agent", description: "d",
    status: "running", startedAt: 1, updatedAt: 1, ...over,
  };
}

/** The reply has settled but its background tasks have not. */
function backgroundPhase(tasks: BackgroundTask[]): SessionState {
  return {
    ...EMPTY_SESSION,
    messages: [{ seq: 1, role: "user", text: "跑一下", ts: null }],
    tasks,
    backgroundActive: tasks.some((t) => t.status === "running"),
    awaitingTasks: true,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  localStorage.clear();
  await i18n.changeLanguage("zh");
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get: () => 600,
  });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get: () => 800,
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  if (realOffsetHeight) Object.defineProperty(HTMLElement.prototype, "offsetHeight", realOffsetHeight);
  if (realOffsetWidth) Object.defineProperty(HTMLElement.prototype, "offsetWidth", realOffsetWidth);
  vi.restoreAllMocks();
});

async function renderTimeline(session: SessionState) {
  await act(async () => {
    root.render(
      <MessageTimeline
        session={session}
        streaming={session.streaming}
        onLoadEarlier={() => {}}
        workspacePath={WS}
      />,
    );
  });
}

describe("turn-tail background indicator", () => {
  it("shows the background running line when tasks run after the reply settled", async () => {
    const session = backgroundPhase([task({ id: "w", workflowName: "ccgui-full-parse" })]);
    await renderTimeline(session);

    // The reply is settled, so the thinking indicator is gone…
    expect(container.textContent).not.toContain("响应中");
    // …and the tail slot carries the background marker instead.
    expect(container.textContent).toContain("后台任务运行中 · 1 个");
  });

  it("counts only the running tasks of the session", async () => {
    const session = backgroundPhase([
      task({ id: "a" }),
      task({ id: "b" }),
      task({ id: "c", status: "completed" }),
      task({ id: "d", status: "failed" }),
    ]);
    await renderTimeline(session);

    expect(container.textContent).toContain("后台任务运行中 · 2 个");
  });

  it("keeps the thinking indicator on top while the run streams background tasks", async () => {
    const session: SessionState = {
      ...backgroundPhase([task({ id: "a" }), task({ id: "b" })]),
      streaming: true,
    };
    await renderTimeline(session);

    expect(container.textContent).toContain("响应中");
    expect(container.textContent).toContain("后台任务运行中 · 2 个");
    // Same tail slot, marker above the thinking row.
    const text = container.textContent ?? "";
    expect(text.indexOf("后台任务运行中")).toBeLessThan(text.indexOf("响应中"));
  });

  /** End to end through the store: an ambient (session-scoped) task is listed
   *  in the panel but never drives the tail indicator — it never finishes
   *  inside a turn, so the line would stay up for the session's whole life. */
  it("stays off for an ambient-only background task", async () => {
    runRouting.clear();
    useChatStore.setState({
      bySession: { [KEY]: { ...EMPTY_SESSION, awaitingTasks: true } },
    });
    const event = {
      runId: "run-ambient", sessionId: "s-1", engine: "claude", seq: 1,
      kind: "tasks" as EngineEventPayload["kind"],
      data: { tasks: [{ taskId: "mon", taskType: "local_agent", description: "monitor", ambient: true }] },
    };
    const deps: EngineEventDeps = {
      set: useChatStore.setState, get: useChatStore.getState,
      drainQueue: () => {}, markUnseenIfBackground: () => {}, upsertSessionMeta: () => {},
    };
    handleEngineEvents([event], deps);

    const session = useChatStore.getState().bySession[KEY]!;
    expect(session.tasks.map((t) => t.id)).toEqual(["mon"]);
    expect(session.backgroundActive).toBe(false);
    await renderTimeline(session);
    expect(container.textContent).not.toContain("后台任务运行中");
  });

  it("renders no background line without a running task", async () => {
    const settled = backgroundPhase([task({ id: "c", status: "completed" })]);
    await renderTimeline({ ...settled, backgroundActive: false, awaitingTasks: false });
    expect(container.textContent).not.toContain("后台任务运行中");

    await renderTimeline({
      ...settled,
      backgroundActive: false,
      awaitingTasks: false,
      streaming: true,
    });
    expect(container.textContent).toContain("响应中");
    expect(container.textContent).not.toContain("后台任务运行中");
  });
});
