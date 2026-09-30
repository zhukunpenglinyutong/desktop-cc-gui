/**
 * 智能体列表与编辑器的回归：行里能认出「是谁 / 干什么」，搜索能命中头衔与
 * @标识，点开编辑器后改名字会落盘（防抖后的 bot_update），拼装预览把空区块
 * 标成「已省略」而不是假装有内容。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BotConfig } from "@/lib/ipc";

const bots = vi.hoisted(() => ({
  list: [] as unknown[],
}));

const memory = vi.hoisted(() => ({
  // 默认两个空账本；测试可以换成带条目的视图。
  view: null as unknown,
  added: [] as Array<{ botId: string | null; target: string; content: string }>,
}));

const emptyLedger = (target: "memory" | "user", botId: string) => ({
  target,
  botId,
  entries: [],
  used: 0,
  limit: target === "user" ? 1375 : 2200,
});

const ipcMock = vi.hoisted(() => ({
  listBots: vi.fn(async (): Promise<unknown[]> => bots.list),
  createBot: vi.fn(),
  updateBot: vi.fn(async () => bots.list[0] ?? null),
  deleteBot: vi.fn(async () => true),
  duplicateBot: vi.fn(),
  memoryList: vi.fn(),
  memoryAdd: vi.fn(
    async (_args: { botId: string | null; target: string; content: string }) => ({
      id: "m-new",
      content: "x",
    }),
  ),
  memoryUpdate: vi.fn(async () => ({ id: "m-1", content: "x" })),
  memoryRemove: vi.fn(async () => undefined),
  memoryClear: vi.fn(async () => 0),
  memoryPendingApprove: vi.fn(async () => ({ kind: "applied" as const, entry: null, created: false })),
  memoryPendingReject: vi.fn(async () => ({ id: "p-1" })),
  memoryReview: vi.fn(async () => ({
    status: "empty" as const,
    applied: 0,
    staged: 0,
    failed: 0,
    at: Date.now(),
  })),
  listBuiltInAgents: vi.fn(async () => ({
    provider: {
      id: "p",
      displayName: "catalog",
      sourceUrl: "https://example.com",
      sourceRevision: "rev",
      license: "MIT",
    },
    divisions: [],
    agents: [],
  })),
}));

vi.mock("@/lib/ipc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ipc")>();
  return { ...actual, ipc: { ...actual.ipc, ...ipcMock } };
});

vi.mock("@/features/skills/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/skills/api")>();
  return {
    ...actual,
    cachedInstalledSkills: vi.fn(async () => ({
      targets: [],
      skills: [
        {
          id: "s1",
          key: "pdf-translate",
          name: "pdf-translate",
          description: "翻译 PDF 并保留中英对照",
          directory: "pdf-translate",
          readmeUrl: null,
          repoOwner: null,
          repoName: null,
          repoBranch: null,
          installedAt: null,
          managed: true,
          sourceKind: "managed" as const,
          readonly: false,
          targets: [],
          targetStates: {},
        },
      ],
      generatedAt: Date.now(),
    })),
  };
});

import "@/lib/i18n";
import { useBotStore } from "@/features/bots/bot-store";
import { useMemoryStore } from "@/features/bots/memory";
import { BotsPane } from "./BotsPane";
import { PlannedSection } from "./bot-editor-sections";

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
globalThis.IntersectionObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
  root = null;
  rootMargin = "";
  thresholds = [];
} as unknown as typeof IntersectionObserver;

// jsdom has neither matchMedia nor a 2D canvas context; the BoardUI avatar
// engine asks for both (it pauses on prefers-reduced-motion and draws to a
// canvas). The stubs render nothing but keep the real component mounted.
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;
HTMLCanvasElement.prototype.getContext ??= (() =>
  new Proxy(
    { canvas: document.createElement("canvas") },
    {
      get: (target, prop) =>
        prop in target ? (target as Record<string, unknown>)[prop as string] : () => undefined,
      set: () => true,
    },
  )) as unknown as typeof HTMLCanvasElement.prototype.getContext;
globalThis.crypto.getRandomValues ??= ((array: Uint32Array) => {
  array.fill(1);
  return array;
}) as typeof crypto.getRandomValues;

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function makeBot(overrides: Partial<BotConfig> = {}): BotConfig {
  return {
    id: "bot-1",
    slug: "tainai",
    name: "太奶",
    title: "耐心的讲解员",
    description: "把复杂的东西讲成家常话",
    avatar: { type: "generated", foldShape: "flower", hue: 181, saturation: 49, eyes: "happy" },
    soul: "先给结论。",
    instructions: "",
    capabilities: { skills: ["pdf-translate"], tools: [], mcpServers: [] },
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

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  ipcMock.listBots.mockClear();
  ipcMock.updateBot.mockClear();
  ipcMock.memoryAdd.mockClear();
  memory.added = [];
  memory.view = {
    memory: emptyLedger("memory", "bot-1"),
    user: emptyLedger("user", ""),
    pending: [],
  };
  ipcMock.memoryList.mockImplementation(async (botId: string | null) => {
    const base = memory.view as { memory: ReturnType<typeof emptyLedger>; user: ReturnType<typeof emptyLedger> };
    return { ...base, memory: botId ? { ...base.memory, botId } : null };
  });
  ipcMock.memoryAdd.mockImplementation(
    async (args: { botId: string | null; target: string; content: string }) => {
      memory.added.push(args);
      return { id: "m-new", content: args.content };
    },
  );
  useMemoryStore.setState({ botId: null, view: null, loading: false, error: null });
  bots.list = [
    makeBot(),
    makeBot({ id: "bot-2", slug: "reviewer", name: "代码评审员", title: "严格的守门员" }),
  ];
  useBotStore.setState({ bots: [], builtInAgents: [], builtInDivisions: [], loaded: false });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render() {
  await act(async () => {
    root.render(<BotsPane />);
  });
  await act(async () => {});
}

/** The editor is a modal (react-aria portal), so assertions read the body. */
function text(): string {
  return document.body.textContent ?? "";
}

function findButton(predicate: (el: HTMLElement) => boolean): HTMLElement | undefined {
  return [...document.querySelectorAll("button")].find((el) =>
    predicate(el as HTMLElement),
  ) as HTMLElement | undefined;
}

/** React tracks the DOM value, so a plain `input.value = x` is swallowed.
 *  Going through the native setter is what makes onChange fire. */
async function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Same native-setter trick for the memory panel's textareas. */
async function typeIntoTextarea(input: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Click the section tab by its exact label (记忆 / 能力 / …). */
async function openTab(label: string) {
  const tab = findButton((el) => el.textContent?.trim() === label);
  expect(tab).toBeTruthy();
  await act(async () => {
    tab!.click();
  });
  await act(async () => {});
}

function firstRow(): HTMLElement {
  return document.querySelector('[data-testid="bot-row"]') as HTMLElement;
}

async function openEditor() {
  await act(async () => {
    firstRow().click();
  });
  await act(async () => {});
}

describe("BotsPane", () => {
  it("lists each bot with its identity and filters by search", async () => {
    await render();
    expect(text()).toContain("太奶");
    expect(text()).toContain("耐心的讲解员");
    expect(text()).toContain("代码评审员");

    await typeInto(document.querySelector("input") as HTMLInputElement, "评审");
    expect(text()).toContain("代码评审员");
    expect(text()).not.toContain("太奶");
  });

  it("filters by @handle as well as by name", async () => {
    await render();
    await typeInto(document.querySelector("input") as HTMLInputElement, "tainai");
    expect(text()).toContain("太奶");
    expect(text()).not.toContain("代码评审员");
  });

  it("opens the editor on a row and autosaves an edit", async () => {
    await render();
    await openEditor();
    // The editor's identity column and the section tabs are up.
    expect(text()).toContain("人格（SOUL）");
    expect(text()).toContain("工作规则");
    expect(text()).toContain("能力");

    // The identity column starts with the avatar studio (which has a colour
    // input), so pick the field by its current value rather than by order.
    const nameInput = [...document.querySelectorAll("input")].find(
      (input) => input.value === "太奶",
    ) as HTMLInputElement;
    expect(nameInput).toBeTruthy();
    await typeInto(nameInput, "太奶（改）");
    await vi.waitFor(() => {
      expect(ipcMock.updateBot).toHaveBeenCalled();
    });
    const [id, patch] = ipcMock.updateBot.mock.calls[0] as unknown as [
      string,
      { name: string },
    ];
    expect(id).toBe("bot-1");
    expect(patch.name).toBe("太奶（改）");
  });

  it("shuffles the avatar, silhouette and expression in one click", async () => {
    await render();
    await openEditor();
    const dice = findButton((el) => el.getAttribute("aria-label") === "随机生成形象");
    expect(dice).toBeTruthy();
    await act(async () => {
      dice!.click();
    });
    await vi.waitFor(() => {
      expect(ipcMock.updateBot).toHaveBeenCalled();
    });
    const [, patch] = ipcMock.updateBot.mock.calls[0] as unknown as [
      string,
      { avatar: { type: string; foldShape?: string; eyes?: string } },
    ];
    expect(patch.avatar.type).toBe("generated");
    expect(patch.avatar.foldShape).toBeTruthy();
    expect(patch.avatar.eyes).toBeTruthy();
  });

  it("shows the prompt preview with the empty blocks marked omitted", async () => {
    await render();
    await openEditor();
    const toggle = findButton((el) => el.textContent?.includes("拼装预览"));
    expect(toggle).toBeTruthy();
    await act(async () => {
      toggle?.click();
    });
    await act(async () => {});
    expect(text()).toContain("# 你的人格");
    expect(text()).toContain("工作规则");
    // 工作规则 is blank for this bot: it must say so, not fake a block.
    expect(text()).toContain("已省略");
    expect(text()).toContain("# 可用 Skills");
    // 记忆开着，且记忆工具已上线：使用说明就是会注入的正文，不是「即将支持」。
    expect(text()).toContain("# 记忆使用说明");
    expect(text()).not.toContain("阶段");
  });

  it("keeps 记忆 in the tab bar and hides the other unshipped sections", async () => {
    await render();
    await openEditor();
    // 记忆已上线，页签常驻；运行后端 / 定时任务 / 协作 仍隐藏。
    expect(findButton((el) => el.textContent?.startsWith("记忆"))).toBeTruthy();
    for (const label of ["运行后端", "定时任务", "协作"] as const) {
      expect(findButton((el) => el.textContent?.startsWith(label))).toBeUndefined();
    }
    expect(findButton((el) => el.textContent === "人格")).toBeTruthy();
    expect(findButton((el) => el.textContent === "工作规则")).toBeTruthy();
    expect(findButton((el) => el.textContent === "能力")).toBeTruthy();
  });

  it("lists memory entries and adds one through the panel", async () => {
    const entry = {
      id: "m-1",
      target: "memory" as const,
      botId: "bot-1",
      content: "项目用 pnpm workspace",
      source: "agent" as const,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    (memory.view as { memory: unknown }).memory = {
      target: "memory",
      botId: "bot-1",
      entries: [entry],
      used: entry.content.length + 2,
      limit: 2200,
    };
    await render();
    await openEditor();
    await openTab("记忆");

    expect(text()).toContain("项目用 pnpm workspace");
    // 用量条读的是注入时的字符数（每条带 `- ` 前缀），不是裸内容长度。
    expect(text()).toContain(`${entry.content.length + 2} / 2,200`);
    // 两个开关已接上：不存在「即将支持」，切开关会走 bot_update。
    expect(text()).toContain("写入需要审批");
    expect(text()).toContain("会话结束后后台复盘");
    expect(text()).not.toContain("即将支持");
    const approval = document.querySelector(
      'input[aria-label="写入需要审批"]',
    ) as HTMLInputElement;
    expect(approval).toBeTruthy();
    await act(async () => {
      approval.click();
    });
    await vi.waitFor(() => {
      expect(ipcMock.updateBot).toHaveBeenCalledWith(
        "bot-1",
        expect.objectContaining({
          memory: expect.objectContaining({ writeApproval: true }),
        }),
      );
    });

    // 左栏的身份描述也是一个 textarea；只认记忆账本那一行（它的 placeholder）。
    const addBox = document.querySelector(
      'textarea[placeholder^="手动加一条"]',
    ) as HTMLTextAreaElement;
    expect(addBox).toBeTruthy();
    await typeIntoTextarea(addBox, "用户喜欢先给结论");
    const add = findButton((el) => el.textContent === "添加");
    expect(add).toBeTruthy();
    await act(async () => {
      add!.click();
    });
    await vi.waitFor(() => {
      expect(ipcMock.memoryAdd).toHaveBeenCalledWith({
        botId: "bot-1",
        target: "memory",
        content: "用户喜欢先给结论",
      });
    });

    // 后端退回（超限）时：错误就地可见，输入框里的草稿不能被清掉。
    ipcMock.memoryAdd.mockRejectedValueOnce({
      code: "limit",
      message: "memory is full",
      used: 2410,
      limit: 2200,
    });
    await typeIntoTextarea(addBox, "再来一条就超了");
    await act(async () => {
      add!.click();
    });
    await vi.waitFor(() => {
      expect(text()).toContain("超出上限");
    });
    const refreshedBox = document.querySelector(
      'textarea[placeholder^="手动加一条"]',
    ) as HTMLTextAreaElement;
    expect(refreshedBox.value).toBe("再来一条就超了");
  });

  it("lists pending writes and approves one through the queue", async () => {
    const pending = {
      id: "p-1",
      op: "replace" as const,
      target: "memory" as const,
      botId: "bot-1",
      content: "项目用 pnpm workspace",
      oldText: "npm",
      targetEntryId: "m-1",
      targetSnapshot: "项目用 npm",
      origin: "review" as const,
      createdAt: Date.now(),
    };
    (memory.view as { pending: unknown[] }).pending = [pending];
    ipcMock.memoryPendingApprove.mockClear();
    await render();
    await openEditor();
    await openTab("记忆");

    expect(text()).toContain("待审批（1 条）");
    // replace 类待审批展示修改前后的对比。
    expect(text()).toContain("项目用 npm");
    expect(text()).toContain("项目用 pnpm workspace");
    expect(text()).toContain("后台复盘");

    const approve = findButton((el) => el.textContent === "批准");
    expect(approve).toBeTruthy();
    await act(async () => {
      approve!.click();
    });
    await vi.waitFor(() => {
      expect(ipcMock.memoryPendingApprove).toHaveBeenCalledWith("p-1");
    });
  });

  it("keeps the planned sections as read-only 即将支持 concept flows", async () => {
    // Rendered directly: the tab is hidden for now, not deleted, so the
    // section behind it has to stay presentable for when it comes back. Its
    // copy says 即将支持 rather than a roadmap phase number — 「阶段 3」 read
    // like a version the user could wait for. The phases stay in 计划.md.
    // 记忆已经换成真面板（见上一个测试），这里用仍属概念图的运行后端。
    await act(async () => {
      root.render(<PlannedSection tab="runtime" avatar={null} name="太奶" />);
    });
    expect(text()).toContain("即将支持");
    expect(text()).not.toContain("阶段");
    // The diagram is an illustration, not a disabled form.
    const diagram = document.querySelector('[data-testid="bot-concept"]');
    expect(diagram).toBeTruthy();
    expect(diagram!.textContent).toContain("运行后端");
    expect(
      diagram!.querySelectorAll("input, textarea, button, [role='switch']"),
    ).toHaveLength(0);
  });
});
