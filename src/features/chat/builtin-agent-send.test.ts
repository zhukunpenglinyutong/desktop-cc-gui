import { beforeEach, describe, expect, it, vi } from "vitest";
import { ipc } from "@/lib/ipc";

/**
 * Built-in agent picks (`source: "builtIn"`) store no prompt: sendPrompt
 * resolves the current catalog prompt via ipc.resolveEnabledBuiltInAgent,
 * and a failed resolve (disabled/removed entry) drops the pin, flags the
 * session error banner, and still sends the bare text.
 */

vi.mock("@/lib/ipc", () => ({
  ipc: {
    sendMessage: vi.fn(async () => ({ runId: "run-1", sessionId: null })),
    interruptSession: vi.fn(async () => true),
    rememberSessionModel: vi.fn(async () => {}),
    rememberSessionEffort: vi.fn(async () => {}),
    listSessions: vi.fn(async () => []),
    loadSessionPage: vi.fn(async () => ({ messages: [], nextBefore: null, subagentHistory: [] })),
    loadRemoteSessionPage: vi.fn(async () => ({ messages: [], nextBefore: null, subagentHistory: [] })),
    deleteSession: vi.fn(async () => {}),
    deleteRemoteSession: vi.fn(async () => {}),
    getAppSettings: vi.fn(async () => ({})),
    updateAppSettings: vi.fn(async () => {}),
    rescanSessions: vi.fn(async () => {}),
    resolveEnabledBuiltInAgent: vi.fn(async () => ({
      id: "agency-agents:design/design-ui-designer",
      name: "UI 设计师",
      icon: "🎨",
      prompt: "你是 UI 设计师。",
      promptHash: "hash",
    })),
  },
}));
vi.mock("@/lib/events", () => ({
  listenEngineEvents: vi.fn(async () => () => {}),
  listenSessionsChanged: vi.fn(async () => () => {}),
  listenComputerUseEscape: vi.fn(async () => () => {}),
}));

const WS = "/tmp/ws";
const STORAGE_KEY = "ccgui-next.selectedBotByThread:v1";
const BUILT_IN_PICK = {
  id: "agency-agents:design/design-ui-designer",
  name: "UI 设计师",
  avatar: { type: "emoji" as const, value: "🎨" },
  source: "builtIn" as const,
};
// Seeded before the store module loads (a test exercising the module-load
// boundary): selected-bot reads localStorage once at import time.
localStorage.setItem(
  STORAGE_KEY,
  JSON.stringify({ [`${WS}::draft`]: BUILT_IN_PICK }),
);

const { useChatStore } = await import("./store");
const { getSelectedBot, selectSelectedBot } = await import(
  "@/features/bots/selected-bot"
);
const { sessionKey } = await import("./store/persistence");
describe("sendPrompt with a built-in agent pinned", () => {
  beforeEach(() => {
    vi.mocked(ipc.sendMessage).mockClear();
    vi.mocked(ipc.resolveEnabledBuiltInAgent).mockClear();
    useChatStore.setState({
      openTabs: [],
      active: null,
      activeEngine: "claude",
      models: {},
      efforts: {},
      bySession: {},
      streamingByKey: {},
      unseen: {},
      drafts: {},
    });
    // Re-seed the in-memory selection too: a previous test's clear()
    // removes the entry from both the store and localStorage.
    selectSelectedBot(WS, null, BUILT_IN_PICK);
  });

  it("resolves the catalog prompt at send time and appends the block", async () => {
    useChatStore.getState().startNewChat(WS);
    await useChatStore.getState().send("hi", []);

    expect(vi.mocked(ipc.resolveEnabledBuiltInAgent)).toHaveBeenCalledWith(
      BUILT_IN_PICK.id,
    );
    const sent = vi.mocked(ipc.sendMessage).mock.calls[0]?.[0] as {
      prompt: string;
    };
    expect(sent.prompt).toContain("hi");
    expect(sent.prompt).toContain("## Agent Role and Instructions");
    expect(sent.prompt).toContain("Agent Name: UI 设计师");
    expect(sent.prompt).toContain("你是 UI 设计师。");
  });

  it("a failed resolve clears the pin, flags the session error, and sends bare text", async () => {
    vi.mocked(ipc.resolveEnabledBuiltInAgent).mockRejectedValueOnce(
      new Error("agent disabled"),
    );
    // Hold sendMessage open: the turn's done-event clears the session error
    // banner, so assert while the invoke is still pending.
    const { promise, resolve: resolveSend } = Promise.withResolvers<{
      runId: string;
      sessionId: string | null;
    }>();
    vi.mocked(ipc.sendMessage).mockReturnValueOnce(promise);

    useChatStore.getState().startNewChat(WS);
    const sending = useChatStore.getState().send("hi", []);
    await vi.waitFor(() => {
      expect(vi.mocked(ipc.sendMessage)).toHaveBeenCalled();
    });

    const sent = vi.mocked(ipc.sendMessage).mock.calls[0]?.[0] as {
      prompt: string;
    };
    expect(sent.prompt).toBe("hi");
    expect(getSelectedBot(WS, null)).toBeNull();
    const key = sessionKey("claude", null, WS);
    expect(useChatStore.getState().bySession[key]?.error).toBeTruthy();

    resolveSend({ runId: "run-1", sessionId: null });
    await sending;
  });
});
