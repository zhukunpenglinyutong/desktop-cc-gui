/**
 * 记忆区块的组装回归：两个账本按注入行进入提示词，记忆使用说明只在工具真的
 * 会挂上时出现——教模型调用一个不存在的工具比不注入更糟。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BotConfig } from "@/lib/ipc";

const memory = vi.hoisted(() => ({
  view: {
    memory: {
      target: "memory",
      botId: "bot-1",
      entries: [
        {
          id: "m-1",
          target: "memory",
          botId: "bot-1",
          content: "项目用 pnpm workspace",
          source: "agent",
          createdAt: 0,
          updatedAt: 0,
        },
      ],
      used: 24,
      limit: 2200,
    },
    user: {
      target: "user",
      botId: "",
      entries: [
        {
          id: "u-1",
          target: "user",
          botId: "",
          content: "用户喜欢先给结论",
          source: "user",
          createdAt: 0,
          updatedAt: 0,
        },
      ],
      used: 22,
      limit: 1375,
    },
  },
  calls: 0,
  fail: false,
}));

vi.mock("@/lib/ipc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ipc")>();
  return {
    ...actual,
    ipc: {
      ...actual.ipc,
      memoryList: vi.fn(async () => {
        memory.calls += 1;
        if (memory.fail) throw new Error("db locked");
        return memory.view;
      }),
    },
  };
});

vi.mock("@/features/skills/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/skills/api")>();
  return { ...actual, cachedInstalledSkills: vi.fn(async () => null) };
});

import { buildBotPromptBlock } from "./bot-block";

function makeBot(overrides: Partial<BotConfig> = {}): BotConfig {
  return {
    id: "bot-1",
    slug: "tainai",
    name: "太奶",
    title: null,
    description: null,
    avatar: { type: "generated" },
    soul: "先给结论。",
    instructions: "",
    capabilities: { skills: [], tools: [], mcpServers: [] },
    runtime: {
      kind: "claude-code",
      model: null,
      cwd: null,
      extraArgs: [],
      permissionMode: "ask",
    },
    memory: {
      enabled: true,
      writeApproval: false,
      memoryCharLimit: 2200,
      reviewEnabled: true,
      reviewEveryNTurns: 5,
    },
    source: "custom",
    builtinId: null,
    pinned: false,
    hidden: false,
    schemaVersion: 1,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

beforeEach(() => {
  memory.fail = false;
  memory.calls = 0;
});

describe("buildBotPromptBlock", () => {
  it("injects both ledgers and the guide when the tool will be mounted", async () => {
    const block = await buildBotPromptBlock(makeBot(), { memoryToolAvailable: true });
    expect(block).toContain("## Agent Role and Instructions");
    expect(block).toContain("# 关于用户 (USER)");
    expect(block).toContain("- 用户喜欢先给结论");
    expect(block).toContain("# 你的笔记 (MEMORY)");
    expect(block).toContain("- 项目用 pnpm workspace");
    expect(block).toContain("# 记忆使用说明");
  });

  it("injects the ledgers but not the guide when the engine cannot mount the tool", async () => {
    const block = await buildBotPromptBlock(makeBot());
    expect(block).toContain("# 你的笔记 (MEMORY)");
    expect(block).toContain("- 项目用 pnpm workspace");
    expect(block).not.toContain("# 记忆使用说明");
  });

  it("skips both the ledgers and the guide when memory is off", async () => {
    const block = await buildBotPromptBlock(
      makeBot({ memory: { ...makeBot().memory, enabled: false } }),
      { memoryToolAvailable: true },
    );
    expect(block).not.toContain("# 你的笔记 (MEMORY)");
    expect(block).not.toContain("# 关于用户 (USER)");
    expect(block).not.toContain("# 记忆使用说明");
    expect(memory.calls).toBe(0);
  });

  it("sends without memory when the ledger read fails", async () => {
    memory.fail = true;
    const block = await buildBotPromptBlock(makeBot(), { memoryToolAvailable: true });
    expect(block).toContain("# 你的人格");
    expect(block).toContain("# 记忆使用说明");
    expect(block).not.toContain("# 你的笔记 (MEMORY)");
  });
});
