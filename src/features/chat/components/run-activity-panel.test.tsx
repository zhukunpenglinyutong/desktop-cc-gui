import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import { ipc } from "@/lib/ipc";
import type { RunActivitySnapshot } from "../run-activity";
import { runRouting } from "../store/stream";
import { RunActivityTrigger } from "./run-activity-panel";

vi.mock("@/lib/ipc", () => ({
  ipc: { runActivity: vi.fn() },
}));

const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

const KEY = "claude/s-activity";

function snapshot(over: Partial<RunActivitySnapshot> = {}): RunActivitySnapshot {
  return {
    runId: "run-a",
    engine: "claude",
    pid: 4321,
    startedAtMs: 0,
    lastOutputAtMs: 55_000,
    lastEventAtMs: 55_000,
    lastEvent: "retry",
    responseHasOutput: false,
    tools: [],
    retries: [
      { atMs: 50_000, attempt: 1, max: 10, category: "network", message: "API error: Connection error." },
      { atMs: 55_000, attempt: 2, max: 10, status: 529, category: "overloaded", message: "API error (HTTP 529: overloaded_error)" },
    ],
    retrying: true,
    awaitingUser: false,
    backgroundTasks: 0,
    nowMs: 60_000,
    ...over,
  };
}

describe("RunActivityTrigger", () => {
  let container: HTMLDivElement;
  let root: Root;
  const runActivity = vi.mocked(ipc.runActivity);

  beforeEach(async () => {
    await i18n.changeLanguage("en");
    vi.useFakeTimers();
    runActivity.mockReset();
    runRouting.clear();
    runRouting.set("run-a", KEY);
    runRouting.set("run-other", "claude/elsewhere");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    runRouting.clear();
    vi.useRealTimers();
  });

  function trigger(): HTMLElement {
    const el = container.querySelector<HTMLElement>('[role="button"]');
    if (!el) throw new Error("trigger missing");
    return el;
  }

  async function open() {
    await act(async () => {
      for (const type of ["pointerdown", "mousedown", "mouseup", "click"]) {
        trigger().dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
      }
    });
    // Let the first poll resolve.
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("does not poll while closed, then shows phase, retry cause and history when opened", async () => {
    runActivity.mockResolvedValue([snapshot()]);
    act(() => {
      root.render(
        <RunActivityTrigger sessionKey={KEY}>
          <span>Responding</span>
        </RunActivityTrigger>,
      );
    });
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    expect(runActivity).not.toHaveBeenCalled();

    await open();
    expect(runActivity).toHaveBeenCalledWith(["run-a"]);
    const panel = document.querySelector('[data-testid="run-activity-panel"]');
    expect(panel).not.toBeNull();
    const text = panel?.textContent ?? "";
    expect(text).toContain(i18n.t("chat.runActivity.phase.retrying"));
    expect(text).toContain(i18n.t("chat.runActivity.retryCategory.overloaded"));
    expect(text).toContain("HTTP 529");
    expect(text).toContain(i18n.t("chat.runActivity.retryCategory.network"));
    expect(text).toContain("PID 4321");
    expect(text).toContain(i18n.t("chat.runActivity.ago", { duration: "5.0s" }));

    // Polls again while open...
    await act(async () => {
      vi.advanceTimersByTime(1_000);
      await Promise.resolve();
    });
    expect(runActivity).toHaveBeenCalledTimes(2);
  });

  it("calls out a silent CLI while waiting on the model", async () => {
    runActivity.mockResolvedValue([
      snapshot({ retries: [], retrying: false, lastEvent: "tool_result", lastOutputAtMs: 1_000, lastEventAtMs: 1_000, nowMs: 301_000 }),
    ]);
    act(() => {
      root.render(
        <RunActivityTrigger sessionKey={KEY}>
          <span>Responding</span>
        </RunActivityTrigger>,
      );
    });
    await open();
    const text = document.querySelector('[data-testid="run-activity-panel"]')?.textContent ?? "";
    expect(text).toContain(i18n.t("chat.runActivity.phase.waiting_model"));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("5m");
  });

  it("says so when no run is tracked for the session", async () => {
    runRouting.clear();
    act(() => {
      root.render(
        <RunActivityTrigger sessionKey={KEY}>
          <span>Responding</span>
        </RunActivityTrigger>,
      );
    });
    await open();
    expect(runActivity).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(i18n.t("chat.runActivity.noRun"));
  });
});
