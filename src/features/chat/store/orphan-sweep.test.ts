import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ipc } from "@/lib/ipc";
import { useChatStore } from "../store";
import { reapOrphanedRuns } from "./engine-events";
import { sessionKey } from "./persistence";
import { EMPTY_SESSION, routeRun, runRouting, touchRun, untrackRun } from "./stream";

vi.mock("@/lib/ipc", () => ({
  ipc: {
    liveRuns: vi.fn(),
    rescanSessions: vi.fn(async () => {}),
  },
}));
vi.mock("@/lib/events", () => ({
  listenEngineEvents: vi.fn(async () => () => {}),
  listenSessionsChanged: vi.fn(async () => () => {}),
  listenComputerUseEscape: vi.fn(async () => () => {}),
}));

const SILENT = sessionKey("codex", "s-silent", "/tmp/ws");
const OTHER = sessionKey("claude", "s-other", "/tmp/ws");
const STARTED = Date.UTC(2026, 9, 29);
const PAST_TTL = STARTED + 31 * 60_000;
const liveRuns = vi.mocked(ipc.liveRuns);
const routed: string[] = [];

/** Route a run and remember it, so afterEach can untrack it: the activity
 *  map is module state and would leak stale runs into the next test. */
function route(runId: string, key: string) {
  routed.push(runId);
  return routeRun(runId, key);
}

const reap = (candidates: Array<[string, string]>) =>
  reapOrphanedRuns(useChatStore.setState, candidates);

const streaming = (key: string) => useChatStore.getState().bySession[key]?.streaming;

describe("orphan sweep", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(STARTED);
    liveRuns.mockReset();
    runRouting.clear();
    useChatStore.setState({
      bySession: {
        [SILENT]: { ...EMPTY_SESSION, streaming: true },
        [OTHER]: { ...EMPTY_SESSION, streaming: true },
      },
      streamingByKey: { [SILENT]: true, [OTHER]: true },
      retryingByKey: {},
    });
    route("run-silent", SILENT);
    vi.setSystemTime(PAST_TTL);
  });

  afterEach(() => {
    for (const runId of routed.splice(0)) untrackRun(runId);
    vi.useRealTimers();
  });

  it("keeps a run silent past 30 minutes routed while the host still runs it", async () => {
    // A long command or a question waiting on the user emits nothing; the
    // silence alone must not stop the spinner under a live turn.
    liveRuns.mockResolvedValue(["run-silent"]);

    await reap(route("run-next", OTHER));

    expect(liveRuns).toHaveBeenCalledWith(["run-silent"]);
    expect(runRouting.get("run-silent")).toBe(SILENT);
    expect(streaming(SILENT)).toBe(true);
    // Re-stamped as alive: the very next routing does not ask again.
    await reap(route("run-after", OTHER));
    expect(liveRuns).toHaveBeenCalledTimes(1);
  });

  it("settles a silent run the host no longer runs", async () => {
    liveRuns.mockResolvedValue([]);

    await reap(route("run-next", OTHER));

    expect(runRouting.has("run-silent")).toBe(false);
    expect(streaming(SILENT)).toBe(false);
    expect(useChatStore.getState().streamingByKey[SILENT]).toBeUndefined();
    expect(streaming(OTHER)).toBe(true);
  });

  it("keeps candidates routed when the host check fails, and asks again next sweep", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    liveRuns.mockRejectedValueOnce(new Error("bridge down")).mockResolvedValueOnce([]);

    await reap(route("run-next", OTHER));

    expect(warn).toHaveBeenCalledWith(expect.any(String), "bridge down");
    expect(runRouting.get("run-silent")).toBe(SILENT);
    expect(streaming(SILENT)).toBe(true);

    await reap(route("run-after", OTHER));

    expect(liveRuns).toHaveBeenCalledTimes(2);
    expect(streaming(SILENT)).toBe(false);
    warn.mockRestore();
  });

  it("does not settle a run that spoke while the host check was in flight", async () => {
    let answer!: (live: string[]) => void;
    liveRuns.mockReturnValue(new Promise((resolve) => (answer = resolve)));

    const reaping = reap(route("run-next", OTHER));
    touchRun("run-silent");
    answer([]);
    await reaping;

    expect(runRouting.get("run-silent")).toBe(SILENT);
    expect(streaming(SILENT)).toBe(true);
  });
});
