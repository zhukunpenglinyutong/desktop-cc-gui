import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Per-thread bot picks: the frozen prompt block is the important contract —
 * a session keeps the prompt it started with, and only 刷新上下文 (or picking
 * another bot) reassembles it.
 */

const NEW_KEY = "ccgui-next.selectedBotByThread:v1";
const LEGACY_KEY = "ccgui-next.selectedAgentByThread:v1";

type Store = typeof import("./selected-bot");

async function freshStore(): Promise<Store> {
  vi.resetModules();
  return import("./selected-bot");
}

describe("selected-bot store", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts empty when nothing was ever picked", async () => {
    const store = await freshStore();
    expect(store.getSelectedBot("/ws", null)).toBeNull();
  });

  it("converts a v1 agent pick into a bot pick and rewrites the key", async () => {
    localStorage.setItem(
      LEGACY_KEY,
      JSON.stringify({
        "/ws::draft": {
          id: "a1",
          name: "太奶",
          icon: "🤖",
          source: "custom",
          prompt: "旧的提示词（现在由 Bot 自己持有）",
        },
      }),
    );
    const store = await freshStore();
    const bot = store.getSelectedBot("/ws", null);
    expect(bot).toMatchObject({
      id: "a1",
      name: "太奶",
      avatar: { type: "emoji", value: "🤖" },
      source: "custom",
    });
    // The inline v1 prompt is not carried along: the migrated bot owns it.
    expect(bot).not.toHaveProperty("prompt");
    const persisted = JSON.parse(localStorage.getItem(NEW_KEY) ?? "{}");
    expect(persisted["/ws::draft"].name).toBe("太奶");
    // The v1 key is left alone so a downgrade still finds its own data.
    expect(localStorage.getItem(LEGACY_KEY)).not.toBeNull();
  });

  it("turns a v1 ASCII preset icon into a deterministic generated avatar", async () => {
    localStorage.setItem(
      LEGACY_KEY,
      JSON.stringify({
        "/ws::draft": { id: "a2", name: "旧图标", icon: "agent-robot-06" },
      }),
    );
    const store = await freshStore();
    const avatar = store.getSelectedBot("/ws", null)?.avatar;
    expect(avatar?.type).toBe("generated");
    const again = await freshStore();
    expect(again.getSelectedBot("/ws", null)?.avatar).toEqual(avatar);
  });

  it("freezes the block, keeps it across a draft→session move, and clears it on refresh", async () => {
    const store = await freshStore();
    store.selectSelectedBot("/ws", null, {
      id: "bot-1",
      name: "太奶",
      avatar: { type: "emoji", value: "🦊" },
    });
    expect(store.getSelectedBot("/ws", null)?.block).toBeUndefined();

    store.freezeSelectedBotBlock("/ws", null, "## Agent Role and Instructions\n\n冻结的");
    const frozen = store.getSelectedBot("/ws", null);
    expect(frozen?.block).toContain("冻结的");
    expect(frozen?.assembledAt).toBeGreaterThan(0);

    // The native session id arrives: the pick (block included) moves with it.
    store.migrateSelectedBot("/ws", "sess-1");
    expect(store.getSelectedBot("/ws", null)).toBeNull();
    expect(store.getSelectedBot("/ws", "sess-1")?.block).toContain("冻结的");

    // 刷新上下文 drops only the block; the pick itself survives.
    expect(store.refreshBotBlocks("bot-1")).toBe(1);
    const refreshed = store.getSelectedBot("/ws", "sess-1");
    expect(refreshed?.block).toBeUndefined();
    expect(refreshed?.assembledAt).toBeUndefined();
    expect(refreshed?.id).toBe("bot-1");
    // Nothing left to refresh the second time.
    expect(store.refreshBotBlocks("bot-1")).toBe(0);
  });

  it("selecting another bot starts a fresh block", async () => {
    const store = await freshStore();
    store.selectSelectedBot("/ws", null, {
      id: "bot-1",
      name: "甲",
      avatar: { type: "emoji", value: "🦊" },
    });
    store.freezeSelectedBotBlock("/ws", null, "block-1");
    store.selectSelectedBot("/ws", null, {
      id: "bot-2",
      name: "乙",
      avatar: { type: "emoji", value: "🧭" },
    });
    expect(store.getSelectedBot("/ws", null)?.block).toBeUndefined();
  });

  it("forgets a deleted bot in every thread", async () => {
    const store = await freshStore();
    for (const [root, session] of [
      ["/a", null],
      ["/a", "s1"],
      ["/b", null],
    ] as Array<[string, string | null]>) {
      store.selectSelectedBot(root, session, {
        id: root === "/b" ? "bot-2" : "bot-1",
        name: "甲",
        avatar: { type: "emoji", value: "🦊" },
      });
    }
    store.forgetBotSelection("bot-1");
    expect(store.getSelectedBot("/a", null)).toBeNull();
    expect(store.getSelectedBot("/a", "s1")).toBeNull();
    expect(store.getSelectedBot("/b", null)?.id).toBe("bot-2");
  });
});
