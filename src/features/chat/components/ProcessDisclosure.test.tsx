import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import { ProcessDisclosure, liveThinkingWindow } from "./ProcessDisclosure";
import type { ProcessItem } from "./timeline-rows";
import { StepRow } from "@/components/application/task-list/task-list";
import { findTimelineMatches } from "./timeline-search";

vi.mock("@/components/application/task-list/task-list", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/application/task-list/task-list")>();
  return { ...actual, StepRow: vi.fn(actual.StepRow) };
});

// jsdom reports a reduced-motion preference, which would make every reveal
// publish its text immediately and hide the pacing under test.
vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useReducedMotion: () => false,
}));

const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let seenTools: Set<string>;

beforeEach(async () => {
  await i18n.changeLanguage("zh");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  seenTools = new Set();
  vi.mocked(StepRow).mockClear();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const ITEMS: ProcessItem[] = [
  { type: "thinking", text: "先读文件" },
  {
    type: "tool",
    text: "Read",
    path: "src/a.ts",
    args: { file_path: "src/a.ts", offset: 1, limit: 40 },
  },
  { type: "tool", text: "Grep", path: null },
];


async function render(
  items: ProcessItem[] = ITEMS,
  props: {
    autoExpand?: boolean;
    turnLive?: boolean;
    thinkingAutoCollapse?: boolean;
    thinkingAutoExpand?: boolean;
  } = {},
) {
  await act(async () => {
    root.render(
      <ProcessDisclosure
        items={items}
        autoExpand={props.autoExpand ?? true}
        turnLive={props.turnLive}
        thinkingAutoCollapse={props.thinkingAutoCollapse}
        thinkingAutoExpand={props.thinkingAutoExpand}
        processId={1}
        seenTools={seenTools}
      />,
    );
  });
}

function headerExpanded(): boolean {
  return container.querySelector("button[aria-expanded]")?.getAttribute("aria-expanded") === "true";
}

function tools(count: number): ProcessItem[] {
  return Array.from({ length: count }, (_, index) => ({
    type: "tool",
    text: `工具 ${index} 中文 👨‍👩‍👧‍👦`,
    args: { command: `读取 ${index} 🙂` },
    result: `结果 ${index} ✅`,
  }));
}

async function clickButton(label: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find((element) =>
    element.textContent === label || element.getAttribute("aria-label") === label,
  );
  expect(button, label).toBeTruthy();
  await act(async () => button!.click());
}

describe("liveThinkingWindow", () => {
  it("returns text within the budget untouched", () => {
    expect(liveThinkingWindow("abc")).toEqual({ body: "abc", truncated: false });
  });

  it("snaps the cut to a line boundary when the window keeps its budget", () => {
    // 100 short lines (~32 chars each): the first newline after the char cut
    // is a whole-row slide-out, well within the window.
    const text = Array.from({ length: 100 }, (_, i) => `line-${i}-${"x".repeat(24)}`).join("\n");
    const { body, truncated } = liveThinkingWindow(text);
    expect(truncated).toBe(true);
    expect(body.startsWith("line-")).toBe(true);
    expect(body.length).toBeLessThanOrEqual(2000);
    expect(body.length).toBeGreaterThanOrEqual(1000);
  });

  /** 一行超 2000 字符且其后还有内容：行边界截断会把窗口塌缩到巨行之后的
   *  几字符，必须退回字符截断保住窗口。 */
  it("falls back to the char cut when a giant line would collapse the window", () => {
    const text = `${"x".repeat(2900)}\nshort tail`;
    const { body, truncated } = liveThinkingWindow(text);
    expect(truncated).toBe(true);
    expect(body).toHaveLength(2000);
    expect(body).toBe(text.slice(text.length - 2000));
  });

  it("keeps the char cut when the window holds no newline at all", () => {
    const text = "x".repeat(3000);
    const { body, truncated } = liveThinkingWindow(text);
    expect(truncated).toBe(true);
    expect(body).toHaveLength(2000);
  });
});

describe("ProcessDisclosure bounded history", () => {
  it.each([120, 500])("mounts at most 40 of %i tools and visits every history page", async (count) => {
    const items = tools(count);
    await render(items);
    expect(vi.mocked(StepRow).mock.calls.length).toBeLessThanOrEqual(40);
    expect(container.querySelectorAll("li").length).toBeLessThanOrEqual(40);
    expect(container.textContent).toContain(items[count - 1].text);
    const visited = new Set<string>();
    for (let page = Math.ceil(count / 40) - 1; page >= 0; page--) {
      expect(container.querySelectorAll("li").length).toBeLessThanOrEqual(40);
      for (const item of items) {
        if (container.textContent!.includes(item.text)) visited.add(item.text);
      }
      if (page > 0) await clickButton(i18n.t("chat.processPreviousPage"));
    }
    expect(visited.size).toBe(count);
    await clickButton("展开工具参数");
    expect(container.textContent).toContain("读取 0 🙂");
    expect(container.textContent).toContain("结果 0 ✅");
    await clickButton(i18n.t("chat.processNextPage"));
    expect(container.textContent).toContain(items[40].text);
    expect(container.textContent).not.toContain("读取 0 🙂");
    await clickButton(i18n.t("chat.processLatestPage"));
    expect(container.textContent).toContain(items[count - 1].text);
    expect(vi.mocked(StepRow).mock.calls.every(([props]) => props.reduce)).toBe(true);
  });

  it("bounds mixed thinking/tool sections across the whole disclosure", async () => {
    const items = tools(120).flatMap((tool, index): ProcessItem[] => [
      { type: "thinking", text: `完整思考 ${index} 中文🙂` }, tool,
    ]);
    await render(items);
    expect(container.querySelectorAll("li").length).toBe(20);
    expect(container.querySelectorAll(".whitespace-pre-wrap").length).toBe(20);
    expect(container.textContent).toContain("完整思考 119 中文🙂");
  });

  it("keeps whole-group search matches while only the selected page has DOM text", async () => {
    const items = tools(120);
    await render(items);
    expect(findTimelineMatches([{ kind: "process", firstSeq: 1, items }], "中文")).toHaveLength(120);
    expect(findTimelineMatches([{ kind: "process", firstSeq: 1, items }], items[0].text)).toEqual([{ rowIndex: 0 }]);
    expect(container.textContent).not.toContain(items[0].text);
    await clickButton(i18n.t("chat.processPreviousPage"));
    await clickButton(i18n.t("chat.processPreviousPage"));
    expect(container.textContent).toContain(items[0].text);
  });

  it("keeps historical pages stable during arrivals and resumes latest explicitly", async () => {
    await render(tools(120));
    await clickButton(i18n.t("chat.processPreviousPage"));
    const row = container.querySelector("li");
    await clickButton("展开工具参数");
    await render(tools(500));
    expect(container.querySelector("li")).toBe(row);
    expect(container.textContent).toContain("读取 40 🙂");
    expect(container.textContent).not.toContain("工具 499 中文");
    await clickButton(i18n.t("chat.processLatestPage"));
    await render(tools(501));
    expect(container.textContent).toContain("工具 500 中文 👨‍👩‍👧‍👦");
    expect(container.querySelectorAll("li").length).toBeLessThanOrEqual(40);
  });

  it("suppresses bulk entrances but keeps a single new tool entrance", async () => {
    const items = tools(5);
    await render(items.slice(0, 1));
    expect(vi.mocked(StepRow).mock.calls.at(-1)![0].reduce).toBe(false);
    vi.mocked(StepRow).mockClear();
    await render(items.slice(0, 4));
    const arrivals = vi.mocked(StepRow).mock.calls.filter(([props]) => props.step.label !== items[0].text);
    expect(arrivals).toHaveLength(3);
    expect(arrivals.every(([props]) => props.reduce)).toBe(true);
    expect(container.querySelector(".grid")!.className).not.toContain("transition-[grid-template-rows]");
    vi.mocked(StepRow).mockClear();
    await render(items);
    expect(vi.mocked(StepRow).mock.calls.at(-1)![0].reduce).toBe(false);
  });

  it("unmounts large histories on collapse and keeps reopening bounded", async () => {
    await render(tools(500), { autoExpand: false });
    expect(container.querySelectorAll("li")).toHaveLength(0);
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    expect(container.querySelectorAll("li").length).toBeGreaterThan(0);
    expect(container.querySelectorAll("li").length).toBeLessThanOrEqual(40);
    expect(container.querySelector(".grid")!.className).not.toContain("transition-[grid-template-rows]");
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    expect(container.querySelectorAll("li")).toHaveLength(0);
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    expect(container.querySelectorAll("li").length).toBeLessThanOrEqual(40);
  });

  it("follows page boundaries without replaying original-index tool entrances", async () => {
    const items = tools(121);
    await render(items.slice(0, 120));
    expect(seenTools.size).toBe(120);
    expect(seenTools.has("1:119")).toBe(true);
    await render(items);
    expect(container.querySelectorAll("li")).toHaveLength(1);
    expect(container.textContent).toContain(items[120].text);
    await clickButton(i18n.t("chat.processPreviousPage"));
    expect(container.querySelectorAll("li")).toHaveLength(40);
    expect(container.textContent).toContain(items[80].text);
    expect(vi.mocked(StepRow).mock.calls.every(([props]) => props.reduce)).toBe(true);
  });

  it("preserves large-group thinking auto-collapse and a manual override", async () => {
    const items = tools(120);
    const text = "中文与 emoji 👨‍👩‍👧‍👦\n".repeat(300);
    await render([...items, { type: "thinking", text, live: true }], { turnLive: true });
    const liveBody = container.querySelector<HTMLElement>(".whitespace-pre-wrap")!;
    expect(liveBody.textContent).not.toBe(text);
    expect(liveBody.textContent!.length).toBeLessThanOrEqual(2000);
    expect(liveBody.textContent).toContain(text.slice(-80));
    expect(liveBody.className).toContain("mask-image");
    await render([...items, { type: "thinking", text }], { turnLive: true });
    expect(headerExpanded()).toBe(false);
    expect(container.querySelector(".whitespace-pre-wrap")).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    expect(container.querySelector(".whitespace-pre-wrap")!.textContent).toBe(text);
    await render([...items, { type: "thinking", text, live: true }], { turnLive: true });
    await render([...items, { type: "thinking", text }], { turnLive: true });
    expect(headerExpanded()).toBe(true);
  });
});

describe("ProcessDisclosure tool args", () => {
  it("hides args until the tool row is expanded", async () => {
    await render();
    expect(container.textContent).toContain("Read");
    expect(container.textContent).toContain("参数");
    expect(container.querySelector("pre")).toBeNull();

    const toggle = [...container.querySelectorAll("button")].find((el) =>
      el.getAttribute("aria-label")?.includes("展开工具参数"),
    );
    expect(toggle).toBeTruthy();
    await act(async () => {
      toggle!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector("pre")?.textContent).toContain("file_path");
    expect(container.querySelector("pre")?.textContent).toContain("src/a.ts");
  });

  it("omits the args toggle when a tool has no payload", async () => {
    await render();
    const toggles = [...container.querySelectorAll("button")].filter((el) =>
      el.getAttribute("aria-label")?.includes("工具参数"),
    );
    expect(toggles).toHaveLength(1);
  });

  it("renders git diff style comparison for Edit tool calls", async () => {
    const editItem: ProcessItem = {
      type: "tool",
      text: "Edit",
      path: "src/utils.ts",
      args: {
        file_path: "src/utils.ts",
        old_string: "const a = 1;",
        new_string: "const a = 2;\nconst b = 3;",
      },
    };
    await render([editItem]);

    const toggle = [...container.querySelectorAll("button")].find((el) =>
      el.getAttribute("aria-label")?.includes("展开工具参数"),
    );
    expect(toggle).toBeTruthy();
    await act(async () => {
      toggle!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("src/utils.ts");
    expect(container.textContent).toContain("-");
    expect(container.textContent).toContain("const a = 1;");
    expect(container.textContent).toContain("+");
    expect(container.textContent).toContain("const a = 2;");
    expect(container.textContent).toContain("const b = 3;");
  });

  it("renders bash command, tool name and execution result", async () => {
    const bashItem: ProcessItem = {
      type: "tool",
      text: "Bash",
      args: {
        command: "git status",
        description: "Check working tree",
      },
      result: {
        stdout: "On branch main\nnothing to commit",
        stderr: "",
      },
    };
    await render([bashItem]);

    const toggle = [...container.querySelectorAll("button")].find((el) =>
      el.getAttribute("aria-label")?.includes("展开工具参数"),
    );
    expect(toggle).toBeTruthy();
    await act(async () => {
      toggle!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain("Bash");
    expect(container.textContent).toContain("Check working tree");
    expect(container.textContent).toContain("git status");
    expect(container.textContent).toContain("执行结果");

    expect(container.textContent).toContain("On branch main");
  });
});

describe("ProcessDisclosure inner thinking sections", () => {
  const sectionHeaders = () =>
    [...container.querySelectorAll("button")].filter((el) =>
      el.textContent?.includes("思考过程"),
    );

  it("lets each thinking section inside a mixed body fold independently", async () => {
    await render([
      { type: "thinking", text: "先读文件" },
      { type: "tool", text: "Read", path: "src/a.ts" },
      { type: "thinking", text: "再检查依赖" },
    ]);
    // Two titled thinking sections, both expanded by default.
    expect(sectionHeaders()).toHaveLength(2);
    expect(sectionHeaders()[0].getAttribute("aria-expanded")).toBe("true");
    expect(sectionHeaders()[1].getAttribute("aria-expanded")).toBe("true");

    await act(async () => {
      sectionHeaders()[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // Only the first section folds; the second and the tool row stay.
    expect(sectionHeaders()[0].getAttribute("aria-expanded")).toBe("false");
    expect(sectionHeaders()[1].getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("再检查依赖");
    expect(container.textContent).toContain("Read");
  });

  it("keeps a folded inner thinking section folded as live thinking grows", async () => {
    await render([
      { type: "thinking", text: "第一段" },
      { type: "tool", text: "Read", path: "src/a.ts" },
      { type: "thinking", text: "第二段", live: true },
    ]);
    expect(sectionHeaders()).toHaveLength(2);

    await act(async () => {
      sectionHeaders()[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(sectionHeaders()[1].getAttribute("aria-expanded")).toBe("false");

    await render([
      { type: "thinking", text: "第一段" },
      { type: "tool", text: "Read", path: "src/a.ts" },
      { type: "thinking", text: "第二段，继续增长", live: true },
    ]);
    expect(sectionHeaders()[1].getAttribute("aria-expanded")).toBe("false");
  });
});

describe("ProcessDisclosure thinking expansion", () => {
  it("folds thinking when the stream settles by default", async () => {
    await render([{ type: "thinking", text: "先分析需求", live: true }], { turnLive: true });
    expect(headerExpanded()).toBe(true);
    expect(container.textContent).toContain("先分析需求");

    await render([{ type: "thinking", text: "先分析需求" }], { turnLive: true });
    expect(headerExpanded()).toBe(false);
  });

  it("keeps thinking expanded after the stream settles when auto-collapse is off", async () => {
    await render([{ type: "thinking", text: "先分析需求", live: true }], {
      turnLive: true,
      thinkingAutoCollapse: false,
    });
    expect(headerExpanded()).toBe(true);
    expect(container.textContent).toContain("先分析需求");

    await render([{ type: "thinking", text: "先分析需求" }], {
      turnLive: true,
      thinkingAutoCollapse: false,
    });
    expect(headerExpanded()).toBe(true);
    expect(container.textContent).toContain("先分析需求");
  });

  it("paces a live thinking burst instead of landing it whole", async () => {
    const opening = "先读文件";
    await render([{ type: "thinking", text: opening, live: true }], { autoExpand: true, turnLive: true });
    const body = () => container.querySelector(".whitespace-pre-wrap")?.textContent ?? "";
    // Mount shows what had already arrived — history must never animate in.
    expect(body()).toBe(opening);

    // One provider burst (OMP writes ~100 characters every ~144ms at
    // 200 tok/s) must not appear in a single commit. The reveal is a layout
    // effect, so this is deterministic: no frame has run yet.
    const burst = "汉".repeat(100);
    await render([{ type: "thinking", text: opening + burst, live: true }], { autoExpand: true, turnLive: true });
    expect(body()).toBe(opening);

    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 600)); });
    expect(body()).toBe(opening + burst);
  });

  it("windows paced live thinking but restores the full text after settlement", async () => {
    const long = "开头必须保留 🙂\n" + "句子与代码 `value`。\n".repeat(300);
    await render([{ type: "thinking", text: long, live: true }], { autoExpand: true, turnLive: true });
    const panel = () => container.querySelector<HTMLElement>(".whitespace-pre-wrap")!;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 600)); });
    expect(panel().textContent).not.toContain("开头必须保留");
    expect(panel().textContent!.length).toBeLessThanOrEqual(2000);
    expect(panel().textContent).toContain("句子与代码");
    expect(panel().className).toContain("mask-image");

    const next = long + "新到达的思考内容 👨‍👩‍👧‍👦\n";
    await render([{ type: "thinking", text: next, live: true }], { autoExpand: true, turnLive: true });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 600)); });
    expect(panel().textContent!.length).toBeLessThanOrEqual(2000);
    expect(panel().textContent).toContain("新到达的思考内容 👨‍👩‍👧‍👦");

    await render([{ type: "thinking", text: next }], { autoExpand: true, turnLive: true });
    expect(panel().textContent).toBe(next);
    expect(panel().className).not.toContain("mask-image");
  });

  it("clips height when folding instead of fading a scaled ghost", async () => {
    await render([{ type: "thinking", text: "先分析需求" }], { autoExpand: true });
    expect(headerExpanded()).toBe(true);

    const header = container.querySelector("button[aria-expanded]");
    await act(async () => {
      header!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const panel = [...container.querySelectorAll<HTMLElement>("[aria-hidden]")].find((el) =>
      (el.getAttribute("class") ?? "").includes("grid-rows-"),
    );
    expect(panel).toBeTruthy();
    expect(panel!.className).toContain("grid-rows-[0fr]");
    expect(panel!.className).not.toMatch(/opacity-0/);
    expect(panel!.style.transform).toBe("");
    expect(container.textContent).toContain("先分析需求");
  });

  it("keeps live thinking folded after the user folds it mid-stream", async () => {
    await render([{ type: "thinking", text: "先分析", live: true }], { turnLive: true });
    expect(headerExpanded()).toBe(true);

    const header = container.querySelector("button[aria-expanded]");
    await act(async () => {
      header!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(headerExpanded()).toBe(false);

    // A stream flush grows the same live thinking row; the fold must stick.
    await render([{ type: "thinking", text: "先分析，再深入", live: true }], { turnLive: true });
    expect(headerExpanded()).toBe(false);

    // Thinking settles mid-turn; the fold still sticks.
    await render([{ type: "thinking", text: "先分析，再深入" }], { turnLive: true });
    expect(headerExpanded()).toBe(false);
  });

  it("still lets the user collapse thinking after it settles", async () => {
    await render([{ type: "thinking", text: "先分析需求", live: true }], {
      turnLive: true,
      thinkingAutoCollapse: false,
    });
    await render([{ type: "thinking", text: "先分析需求" }], {
      turnLive: true,
      thinkingAutoCollapse: false,
    });

    const header = container.querySelector("button[aria-expanded]");
    expect(header).toBeTruthy();
    await act(async () => {
      header!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(headerExpanded()).toBe(false);
  });
});

describe("ProcessDisclosure default-collapsed streaming (auto-expand off)", () => {
  const collapsedProps = {
    turnLive: true,
    autoExpand: false,
    thinkingAutoExpand: false,
  };

  it("keeps a streaming row collapsed and stays collapsed when it settles", async () => {
    await render([{ type: "thinking", text: "先分析需求", live: true }], collapsedProps);
    expect(headerExpanded()).toBe(false);

    await render([{ type: "thinking", text: "先分析需求" }], collapsedProps);
    expect(headerExpanded()).toBe(false);
  });

  it("does not reopen when thinking resumes after a tool call", async () => {
    await render([{ type: "thinking", text: "先读文件", live: true }], collapsedProps);
    expect(headerExpanded()).toBe(false);

    await render(
      [
        { type: "thinking", text: "先读文件" },
        { type: "tool", text: "Read", path: "src/a.ts" },
      ],
      collapsedProps,
    );
    expect(headerExpanded()).toBe(false);

    // Extended thinking resumes between tool calls — with auto-expand off
    // this must not flash the row open again.
    await render(
      [
        { type: "thinking", text: "先读文件" },
        { type: "tool", text: "Read", path: "src/a.ts" },
        { type: "thinking", text: "再检查依赖", live: true },
      ],
      collapsedProps,
    );
    expect(headerExpanded()).toBe(false);

    // The user can still expand it by hand.
    const header = container.querySelector("button[aria-expanded]");
    await act(async () => {
      header!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(headerExpanded()).toBe(true);
  });

  it("still opens on a search jump while auto-expand is off", async () => {
    await render([{ type: "thinking", text: "先分析需求", live: true }], collapsedProps);
    expect(headerExpanded()).toBe(false);

    // A search jump arrives as an autoExpand flip, not a streaming change.
    await render([{ type: "thinking", text: "先分析需求", live: true }], {
      ...collapsedProps,
      autoExpand: true,
    });
    expect(headerExpanded()).toBe(true);
  });
});

describe("ProcessDisclosure left-to-right marquee on the collapsed streaming row", () => {
  const collapsedProps = {
    turnLive: true,
    autoExpand: false,
    thinkingAutoExpand: false,
  };

  it("keeps the thinking icon and marquee classes while folded thinking streams", async () => {
    await render([{ type: "thinking", text: "先分析需求", live: true }], collapsedProps);
    expect(headerExpanded()).toBe(false);
    expect(container.querySelector("button.process-live-marquee")).toBeTruthy();
    expect(container.querySelector(".process-live-content")).toBeTruthy();
    expect(container.querySelector(".process-live-content-live")).toBeTruthy();
    expect(container.querySelector(".process-live-thinking-icon")).toBeTruthy();
    expect(container.querySelector(".agent-progress-loading-text")).toBeTruthy();

    // The moment the thinking settles both effects go away, fold unchanged.
    await render([{ type: "thinking", text: "先分析需求" }], collapsedProps);
    expect(headerExpanded()).toBe(false);
    expect(container.querySelector(".process-live-marquee")).toBeNull();
    expect(container.querySelector(".process-live-content-live")).toBeNull();
    expect(container.querySelector(".process-live-thinking-icon")).toBeNull();
    expect(container.querySelector(".agent-progress-loading-text")).toBeNull();
  });

  it("drops the marquee when the user expands the row", async () => {
    await render([{ type: "thinking", text: "先分析需求", live: true }], collapsedProps);
    expect(container.querySelector("button.process-live-marquee")).toBeTruthy();
    expect(container.querySelector(".process-live-thinking-icon")).toBeTruthy();

    const header = container.querySelector("button[aria-expanded]");
    await act(async () => {
      header!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(headerExpanded()).toBe(true);
    expect(container.querySelector(".process-live-marquee")).toBeNull();
    expect(container.querySelector(".process-live-content-live")).toBeNull();
    expect(container.querySelector(".process-live-thinking-icon")).toBeNull();
    expect(container.querySelector(".agent-progress-loading-text")).toBeNull();
  });

  it("keeps the thinking icon in front of a mixed thinking summary", async () => {
    await render(
      [
        { type: "thinking", text: "先分析", live: true },
        { type: "tool", text: "Read", path: "src/a.ts" },
      ],
      collapsedProps,
    );
    expect(headerExpanded()).toBe(false);
    expect(container.querySelector("button.process-live-marquee")).toBeTruthy();
    expect(container.querySelector(".process-live-thinking-icon")).toBeTruthy();
    expect(container.textContent).toContain("思考");
    expect(container.textContent).toContain("工具调用");
  });
});
