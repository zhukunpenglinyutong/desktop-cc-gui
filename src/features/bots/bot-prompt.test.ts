import { describe, expect, it } from "vitest";
import type { BotConfig } from "@/lib/ipc";
import {
  PROSE_LIMIT,
  SKILL_INDEX_LIMIT,
  assembleBotPrompt,
  builtInBotShell,
  duplicateProseLines,
  identityText,
  proseOverLimit,
  skillsIndexText,
} from "./bot-prompt";

function makeBot(overrides: Partial<BotConfig> = {}): BotConfig {
  return {
    id: "bot-1",
    slug: "tainai",
    name: "太奶",
    title: null,
    description: null,
    avatar: { type: "generated", foldShape: "flower", hue: 181, saturation: 49, eyes: "happy" },
    soul: "",
    instructions: "",
    capabilities: { skills: [], tools: [], mcpServers: [] },
    runtime: {
      kind: "direct",
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

describe("assembleBotPrompt", () => {
  it("keeps the documented block order", () => {
    const assembled = assembleBotPrompt({
      bot: makeBot({
        soul: "先讲结论。",
        instructions: "# 流程\n1. 判断问题层次",
        title: "耐心的讲解员",
      }),
      user: "- 用户是独立开发者",
      memory: "- 项目用 Tauri v2",
      skills: [{ name: "sql-explain", description: "解释执行计划" }],
      collaborators: [{ slug: "reviewer", description: "代码评审" }],
    });
    expect(assembled.blocks.map((block) => block.id)).toEqual([
      "app",
      "identity",
      "soul",
      "instructions",
      "user",
      "memory",
      "skills",
      "memoryGuide",
      "collaborators",
    ]);
    // The host prompt is context, not something the bot authored.
    expect(assembled.text).not.toContain("应用基础系统提示");
    // Order is observable in the text itself.
    const order = ["# 你的身份", "# 你的人格", "# 工作规则", "# 关于用户 (USER)"];
    const positions = order.map((heading) => assembled.text.indexOf(heading));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("omits empty blocks whole — no empty headings", () => {
    const assembled = assembleBotPrompt({ bot: makeBot({ soul: "只有人格。" }) });
    const headings = assembled.blocks
      .filter((block) => !block.omitted && !block.external)
      .map((block) => block.title);
    expect(headings).toEqual(["你的身份", "你的人格"]);
    // The empty blocks leave no trace at all.
    expect(assembled.text).not.toContain("# 工作规则");
    expect(assembled.text).not.toContain("# 可用 Skills");
    expect(assembled.text).not.toContain("# 协作者");
    // The memory guide is a later phase, so it contributes no heading yet.
    expect(assembled.text).not.toContain("# 记忆使用说明");
  });

  it("a v1-era bot (soul only) adds nothing but the identity block", () => {
    // The migration contract: an agent that only had a prompt behaves exactly
    // like before — the prompt still explains who it is, and no new machinery
    // sneaks in.
    const legacy = makeBot({
      soul: "你是代码审查员，只看会不会坏。",
      memory: { ...makeBot().memory, enabled: false },
    });
    const assembled = assembleBotPrompt({ bot: legacy });
    expect(assembled.text).toBe(
      "# 你的身份\n你是「太奶」。\n\n# 你的人格\n你是代码审查员，只看会不会坏。",
    );
    expect(assembled.totalChars).toBe([...assembled.text].length);
  });

  it("keeps the memory guide out of the prompt until the tool exists", () => {
    // Memory is enabled on the bot, but this build has no `memory` tool:
    // telling the model to use one it cannot call is worse than saying
    // nothing, so the guide is listed as a later phase instead.
    const pending = assembleBotPrompt({ bot: makeBot() });
    expect(pending.text).not.toContain("记忆工具");
    expect(pending.blocks.find((b) => b.id === "memoryGuide")).toMatchObject({
      omitted: true,
      planned: 2,
    });

    // A build that has the tool emits the guide.
    const live = assembleBotPrompt({
      bot: makeBot(),
      memoryAvailable: true,
      memory: "- 用户喜欢先看结论",
    });
    expect(live.text).toContain("# 记忆使用说明");
    expect(live.text).toContain("memory");
    expect(live.blocks.find((b) => b.id === "memory")).toMatchObject({ omitted: false });

    // Memory switched off on the bot: nothing, and no phase badge either.
    const off = assembleBotPrompt({
      bot: makeBot({ memory: { ...makeBot().memory, enabled: false } }),
      memoryAvailable: true,
    });
    expect(off.text).not.toContain("# 记忆使用说明");
    expect(off.blocks.find((b) => b.id === "memoryGuide")?.planned).toBeUndefined();
  });

  it("reports the memory block's limit so the editor can show a usage bar", () => {
    const assembled = assembleBotPrompt({
      bot: makeBot({ memory: { ...makeBot().memory, memoryCharLimit: 2200 } }),
      memory: "- 一条笔记",
      memoryAvailable: true,
    });
    expect(assembled.blocks.find((b) => b.id === "memory")).toMatchObject({
      limit: 2200,
      omitted: false,
      chars: 6,
      preview: "- 一条笔记",
    });
  });

  it("counts characters as code points, not UTF-16 units", () => {
    const assembled = assembleBotPrompt({ bot: makeBot({ soul: "🤖🤖" }) });
    expect(assembled.blocks.find((b) => b.id === "soul")?.chars).toBe(2);
  });
});

describe("skillsIndexText", () => {
  it("lists name and description only", () => {
    const index = skillsIndexText([
      { name: "pdf-translate", description: "翻译长文档并保留中英对照" },
    ]);
    expect(index.text).toBe("- pdf-translate：翻译长文档并保留中英对照");
    expect(index.truncated).toBe(0);
  });

  it("truncates at the budget and points at what is left", () => {
    const many = Array.from({ length: 200 }, (_, i) => ({
      name: `skill-${i}`,
      description: "x".repeat(60),
    }));
    const index = skillsIndexText(many);
    expect(index.truncated).toBeGreaterThan(0);
    expect([...index.text].length).toBeLessThanOrEqual(SKILL_INDEX_LIMIT + 40);
    expect(index.text).toContain(
      `还有 ${index.truncated} 个 skill 可以用 skill_list 查看`,
    );
    // Everything that did fit was kept in order.
    expect(index.text.startsWith("- skill-0：")).toBe(true);
  });

  it("keeps the counter honest when nothing was dropped", () => {
    const index = skillsIndexText([{ name: "a", description: "b" }]);
    expect(index.text).not.toContain("skill_list");
  });
});

describe("prose budget", () => {
  it("flags the shared SOUL + AGENTS budget", () => {
    expect(proseOverLimit(makeBot({ soul: "a".repeat(PROSE_LIMIT) }))).toBe(false);
    expect(proseOverLimit(makeBot({ instructions: "a".repeat(PROSE_LIMIT + 1) }))).toBe(true);
  });

  it("finds lines that live on both pages", () => {
    const bot = makeBot({
      soul: "先给结论，再讲道理。\n- 说话像唠家常\n不确定就直说。",
      instructions: "# 流程\n1. 先给结论，再讲道理。\n2. 给例子",
    });
    expect(duplicateProseLines(bot)).toEqual(["先给结论，再讲道理。"]);
  });

  it("ignores short lines and list markers when comparing", () => {
    const bot = makeBot({
      soul: "- 说人话。\n- 先给出结论再讲道理",
      instructions: "1. 先给出结论再讲道理\n2. 给例子",
    });
    // The bullet/number prefixes are stripped before comparing.
    expect(duplicateProseLines(bot)).toEqual(["先给出结论再讲道理"]);
  });
});

describe("identityText", () => {
  it("lists only the parts that exist", () => {
    expect(identityText({ name: "太奶", title: null, description: null })).toBe(
      "你是「太奶」。",
    );
    expect(
      identityText({ name: "太奶", title: "讲解员", description: "先讲结论" }),
    ).toBe("你是「太奶」。\n头衔：讲解员\n简介：先讲结论");
    // Whitespace-only parts count as absent.
    expect(identityText({ name: "太奶", title: "  ", description: "" })).toBe(
      "你是「太奶」。",
    );
  });
});

describe("builtInBotShell", () => {
  it("wraps a catalog prompt as a soul-only bot with no capabilities", () => {
    const shell = builtInBotShell("UI 设计师", "你是 UI 设计师。");
    expect(shell.name).toBe("UI 设计师");
    expect(shell.soul).toBe("你是 UI 设计师。");
    expect(shell.instructions).toBe("");
    expect(shell.capabilities.skills).toEqual([]);
    expect(shell.memory.enabled).toBe(false);
    expect(assembleBotPrompt({ bot: shell }).text).toContain("你是 UI 设计师。");
  });
});
