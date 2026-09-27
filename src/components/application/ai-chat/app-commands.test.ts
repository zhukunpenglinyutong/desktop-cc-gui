import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ipc } from "@/lib/ipc";
import { parseAppCommand, matchAppCommand } from "./app-commands";
import { useChatStore } from "@/features/chat/store";
import { handleEngineEvents, type EngineEventDeps } from "@/features/chat/store/engine-events";
import { sessionKey } from "@/features/chat/store/persistence";
import { EMPTY_SESSION } from "@/features/chat/store/stream";
import { useSlashCommandStore } from "./slash-commands";

vi.mock("@/lib/ipc", () => ({
  ipc: {
    sendMessage: vi.fn(async () => ({ runId: "run-1", sessionId: null })),
    rememberSessionModel: vi.fn(async () => {}),
    rememberSessionEffort: vi.fn(async () => {}),
    loadSessionPage: vi.fn(async () => ({ messages: [], nextBefore: null, subagentHistory: [] })),
    getAppSettings: vi.fn(async () => ({})),
    updateAppSettings: vi.fn(async () => {}),
    rescanSessions: vi.fn(async () => {}),
    listSessionMessages: vi.fn(async () => []),
    refreshSessionUsage: vi.fn(async () => null),
  },
}));
vi.mock("@/lib/events", () => ({
  listenEngineEvents: vi.fn(async () => () => {}),
  listenSessionsChanged: vi.fn(async () => () => {}),
  listenComputerUseEscape: vi.fn(async () => () => {}),
}));

const WS = "/tmp/ws";
const KEY = sessionKey("omp", "s-1", WS);

function deps(): EngineEventDeps {
  return {
    set: useChatStore.setState,
    get: useChatStore.getState,
    drainQueue: () => {},
    markUnseenIfBackground: () => {},
    upsertSessionMeta: () => {},
  };
}

function compactionEvent(active: boolean) {
  return {
    runId: "run-1",
    sessionId: "s-1",
    engine: "omp",
    seq: 1,
    kind: "compaction" as const,
    data: { active, reason: active ? "threshold" : null },
  };
}

describe("matchAppCommand", () => {
  beforeEach(() => {
    useSlashCommandStore.setState({ byRoot: {} });
  });

  it("matches bare /new, /compact and /mcp only", () => {
    expect(matchAppCommand("/new", WS)).toBe("new");
    expect(matchAppCommand("/clear", WS)).toBe("new");
    expect(matchAppCommand("  /compact  ", WS)).toBe("compact");
    expect(matchAppCommand("/mcp", WS)).toBe("mcp");
    expect(matchAppCommand("/mcp 参数", WS)).toBeNull();
    expect(matchAppCommand("/compact 聚焦改动", WS)).toBeNull();
    expect(matchAppCommand("/news", WS)).toBeNull();
    expect(matchAppCommand("hello /new", WS)).toBeNull();
    expect(matchAppCommand("/new", null)).toBe("new");
  });

  it("defers to a user-defined catalog command of the same name", () => {
    useSlashCommandStore.setState({
      byRoot: {
        [WS]: {
          entries: [{ name: "new", description: null, source: "workspace", kind: "command" }],
          status: "ready",
          fetchedAt: Date.now(),
        },
      },
    });
    expect(matchAppCommand("/new", WS)).toBeNull();
    expect(matchAppCommand("/compact", WS)).toBe("compact");
    expect(matchAppCommand("/mcp", WS)).toBe("mcp");
  });
});

describe("parseAppCommand", () => {
  beforeEach(() => {
    useSlashCommandStore.setState({ byRoot: {} });
  });

  it("reads the task after /ccgui-cua as the argument", () => {
    expect(parseAppCommand("/ccgui-cua 打开计算器算 1+1", WS)).toEqual({
      command: "cua",
      arg: "打开计算器算 1+1",
    });
    expect(parseAppCommand("  /ccgui-cua   截图   ", WS)).toEqual({
      command: "cua",
      arg: "截图",
    });
  });

  it("keeps the bare form as an argument-less command", () => {
    // Bare /ccgui-cua opens the setup page instead of sending.
    expect(parseAppCommand("/ccgui-cua", WS)).toEqual({ command: "cua", arg: "" });
  });

  it("gives the argument-less commands no argument", () => {
    expect(parseAppCommand("/new", WS)).toEqual({ command: "new", arg: "" });
    expect(parseAppCommand("  /compact  ", WS)).toEqual({
      command: "compact",
      arg: "",
    });
    // Not an ARG_COMMANDS member: the CLI's own argument form still belongs
    // to the engine.
    expect(parseAppCommand("/compact 聚焦改动", WS)).toBeNull();
    expect(parseAppCommand("/mcp 参数", WS)).toBeNull();
  });

  it("ignores lookalikes and mid-text slashes", () => {
    expect(parseAppCommand("/ccgui-cua2 任务", WS)).toBeNull();
    expect(parseAppCommand("/ccgui 任务", WS)).toBeNull();
    expect(parseAppCommand("hello /ccgui-cua 任务", WS)).toBeNull();
    expect(parseAppCommand("", WS)).toBeNull();
  });

  it("defers to a user-defined catalog command named ccgui-cua", () => {
    useSlashCommandStore.setState({
      byRoot: {
        [WS]: {
          entries: [
            { name: "ccgui-cua", description: null, source: "workspace", kind: "command" },
          ],
          status: "ready",
          fetchedAt: Date.now(),
        },
      },
    });
    expect(parseAppCommand("/ccgui-cua 任务", WS)).toBeNull();
    expect(parseAppCommand("/ccgui-cua", WS)).toBeNull();
  });
});

describe("compaction progress", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    useChatStore.setState({ bySession: {}, streamingByKey: {} });
  });
  afterEach(() => useChatStore.setState({ bySession: {}, streamingByKey: {} }));

  it("engine compaction events set and clear an automatic flag", () => {
    useChatStore.setState({ bySession: { [KEY]: { ...EMPTY_SESSION, streaming: true } } });
    handleEngineEvents([compactionEvent(true)], deps());
    expect(useChatStore.getState().bySession[KEY].compaction).toMatchObject({ automatic: true });
    handleEngineEvents([compactionEvent(false)], deps());
    expect(useChatStore.getState().bySession[KEY].compaction).toBeNull();
  });

  it("a done event clears a lingering compaction flag", () => {
    useChatStore.setState({
      bySession: {
        [KEY]: {
          ...EMPTY_SESSION,
          streaming: true,
          compaction: { automatic: true, startedAt: Date.now() },
        },
      },
    });
    handleEngineEvents(
      [{ runId: "run-1", sessionId: "s-1", engine: "omp", seq: 2, kind: "done" as const, data: { usage: null } }],
      deps(),
    );
    expect(useChatStore.getState().bySession[KEY].compaction).toBeNull();
  });

  it("an engine end event does not clear a manual compact flag", () => {
    useChatStore.setState({
      bySession: {
        [KEY]: {
          ...EMPTY_SESSION,
          streaming: true,
          compaction: { automatic: false, startedAt: Date.now() },
        },
      },
    });
    handleEngineEvents([compactionEvent(false)], deps());
    expect(useChatStore.getState().bySession[KEY].compaction).toMatchObject({ automatic: false });
  });

  it("compactContext flags the session and sends /compact", async () => {
    useChatStore.setState({
      activeEngine: "omp",
      active: { engine: "omp", sessionId: "s-1", workspacePath: WS },
      openTabs: [{ engine: "omp", sessionId: "s-1", workspacePath: WS }],
    });
    const compacting = useChatStore.getState().compactContext();
    await vi.waitFor(() => {
      expect(useChatStore.getState().bySession[KEY]?.compaction).toMatchObject({ automatic: false });
    });
    // compactContext sets the flag synchronously, then sendPrompt awaits plugin
    // turn contributions before the send — /compact reaches ipc a few microtasks
    // after the flag, so await the call rather than assuming it is synchronous.
    await vi.waitFor(() => {
      expect(vi.mocked(ipc.sendMessage)).toHaveBeenCalledWith(
        expect.objectContaining({ engine: "omp", sessionId: "s-1", prompt: "/compact" }),
      );
    });
    // The store routes events by its own requested run id, not the mocked
    // response — replay the id sendMessage actually received.
    const runId = vi.mocked(ipc.sendMessage).mock.calls[0][0].runId!;
    // The run settles: done event clears streaming, the store drains the flag.
    handleEngineEvents(
      [{ runId, sessionId: "s-1", engine: "omp", seq: 9, kind: "done" as const, data: { usage: null } }],
      deps(),
    );
    await compacting;
    expect(useChatStore.getState().bySession[KEY].compaction).toBeNull();
  });
});
