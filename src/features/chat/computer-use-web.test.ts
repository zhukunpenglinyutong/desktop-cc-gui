import { beforeEach, describe, expect, it, vi } from "vitest";
import { ipc, type EngineInfo } from "@/lib/ipc";
import i18n from "@/lib/i18n";

/**
 * Computer use is desktop-only. On a web-access client a `/ccgui-cua` send is
 * refused up front with a desktop-only notice: the bridge drops the flag, so
 * sending anyway would run a text-only turn the user did not ask for.
 */

vi.mock("@/lib/platform", async (original) => ({
  ...(await original<typeof import("@/lib/platform")>()),
  isWeb: true,
}));
vi.mock("@/lib/ipc", () => ({
  ipc: {
    sendMessage: vi.fn(async () => ({ runId: "run-1", sessionId: null })),
    interruptSession: vi.fn(async () => true),
    computerUseSetActive: vi.fn(async () => {}),
    rememberSessionModel: vi.fn(async () => {}),
    rememberSessionEffort: vi.fn(async () => {}),
    listSessions: vi.fn(async () => []),
    loadSessionPage: vi.fn(async () => ({ messages: [], nextBefore: null, subagentHistory: [] })),
    getAppSettings: vi.fn(async () => ({})),
    updateAppSettings: vi.fn(async () => {}),
    rescanSessions: vi.fn(async () => {}),
    refreshSessionUsage: vi.fn(async () => null),
  },
}));
vi.mock("@/lib/events", () => ({
  listenEngineEvents: vi.fn(async () => () => {}),
  listenSessionsChanged: vi.fn(async () => () => {}),
  listenComputerUseEscape: vi.fn(async () => () => {}),
}));

const WS = "/tmp/ws";
const { useChatStore } = await import("./store");
const { sessionKey } = await import("./store/persistence");
const { computerUseRefusalKey } = await import("./computer-use");

const KEY = sessionKey("omp", "s-1", WS);

function engine(id: string, supportsComputerUse: boolean): EngineInfo {
  return {
    id,
    available: true,
    enabled: true,
    supportsImages: true,
    supportsComputerUse,
    permissions: ["auto"],
  };
}

describe("computer use on a web-access client", () => {
  beforeEach(() => {
    vi.mocked(ipc.sendMessage).mockClear();
    vi.mocked(ipc.computerUseSetActive).mockClear();
    useChatStore.setState({
      engines: [engine("omp", true)],
      active: { engine: "omp", sessionId: "s-1", workspacePath: WS },
      openTabs: [{ engine: "omp", sessionId: "s-1", workspacePath: WS }],
      activeEngine: "omp",
      models: {},
      efforts: {},
      bySession: {},
      streamingByKey: {},
      unseen: {},
      drafts: {},
    });
  });

  it("names the desktop-only rule ahead of engine support", () => {
    expect(computerUseRefusalKey([engine("omp", true)], "omp")).toBe("chat.cuaDesktopOnly");
    expect(computerUseRefusalKey([engine("codex", false)], "codex")).toBe("chat.cuaDesktopOnly");
  });

  it("refuses the send instead of running it text-only", async () => {
    await useChatStore.getState().send("打开计算器", [], { computerUse: true });
    expect(vi.mocked(ipc.sendMessage)).not.toHaveBeenCalled();
    expect(vi.mocked(ipc.computerUseSetActive)).not.toHaveBeenCalled();
    expect(useChatStore.getState().bySession[KEY]?.error).toBe(i18n.t("chat.cuaDesktopOnly"));
  });

  it("still sends ordinary turns", async () => {
    await useChatStore.getState().send("你好", []);
    expect(vi.mocked(ipc.sendMessage)).toHaveBeenCalledWith(
      expect.objectContaining({ computerUse: false }),
    );
  });
});
