import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import { ProcessDisclosure } from "./ProcessDisclosure";
import type { ProcessItem } from "./timeline-rows";
import { StepRow } from "@/components/application/task-list/task-list";
import { findTimelineMatches } from "./timeline-search";
import { useFilesStore } from "@/features/files/store";

// The on-disk fallbacks behind the resolver probe through IPC, which has no
// backend under jsdom. The resolver's own nesting/ambiguity rules live in
// file-link-resolution.test.ts; here we only assert the chip wiring, so the
// resolver is a passthrough that records its arguments.
const resolveMock = vi.hoisted(() => vi.fn(async (path: string, _workspace: string) => path));
vi.mock("@/features/chat/file-link-resolution", () => ({ resolveChatFileLink: resolveMock }));

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
    workspacePath?: string;
  } = {},
) {
  await act(async () => {
    root.render(
      <ProcessDisclosure
        items={items}
        autoExpand={props.autoExpand ?? true}
        turnLive={props.turnLive}
        thinkingAutoCollapse={props.thinkingAutoCollapse}
        processId={1}
        seenTools={seenTools}
        workspacePath={props.workspacePath}
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
    expect(container.querySelector(".whitespace-pre-wrap")!.textContent).toBe(text);
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

  it("retains the complete revealed thinking prefix beyond 2000 characters", async () => {
    const long = "开头必须保留 🙂\n" + "句子与代码 `value`。\n".repeat(300);
    await render([{ type: "thinking", text: long, live: true }], { autoExpand: true, turnLive: true });
    const panel = () => container.querySelector<HTMLElement>(".whitespace-pre-wrap")!;
    expect(panel().textContent).toBe(long);
    expect(panel().className).not.toContain("mask-image");

    const next = long + "新到达的思考内容 👨‍👩‍👧‍👦\n";
    await render([{ type: "thinking", text: next, live: true }], { autoExpand: true, turnLive: true });
    expect(panel().textContent).toBe(long);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 600)); });
    expect(panel().textContent).toBe(next);

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

describe("ProcessDisclosure file chips", () => {
  const IMAGE: ProcessItem = {
    type: "tool",
    text: "Read",
    path: "/ws/.tmp-parent-review-snapshot-2024.png",
  };

  it("renders the tool call's file name", async () => {
    await render([IMAGE]);
    expect(container.textContent).toContain(".tmp-parent-review-snapshot-2024.png");
  });

  it("keeps the chip inert without a workspace root", async () => {
    await render([IMAGE]);
    const chips = [...container.querySelectorAll("button")].filter((el) =>
      el.textContent?.includes(".tmp-parent-review-snapshot-2024.png"),
    );
    expect(chips).toHaveLength(0);
  });

  it("opens the target file when the chip is clicked", async () => {
    const openFile = vi.fn(async (_path: string) => {});
    const original = useFilesStore.getState().openFile;
    useFilesStore.setState({ openFile });
    resolveMock.mockClear();
    try {
      await render([IMAGE], { workspacePath: "/ws" });
      const chip = [...container.querySelectorAll<HTMLButtonElement>("button")].find((el) =>
        el.textContent?.includes(".tmp-parent-review-snapshot-2024.png"),
      );
      expect(chip, "file chip as a button").toBeTruthy();
      expect(chip!.getAttribute("title")).toBe("/ws/.tmp-parent-review-snapshot-2024.png");
      await act(async () => chip!.click());
      await vi.waitFor(() => expect(openFile).toHaveBeenCalled());
      // Relative tool paths anchor at the session workspace, and the chip
      // hands the resolver the full path (not the truncated label).
      expect(resolveMock).toHaveBeenCalledWith(
        "/ws/.tmp-parent-review-snapshot-2024.png",
        "/ws",
      );
      expect(openFile.mock.calls[0][0]).toBe("/ws/.tmp-parent-review-snapshot-2024.png");
    } finally {
      useFilesStore.setState({ openFile: original });
    }
  });

  it("resolves a relative tool path against the workspace", async () => {
    const openFile = vi.fn(async (_path: string) => {});
    const original = useFilesStore.getState().openFile;
    useFilesStore.setState({ openFile });
    resolveMock.mockClear();
    resolveMock.mockImplementation(async () => "/ws/shots/a.png");
    try {
      await render([{ type: "tool", text: "Read", path: "shots/a.png" }], {
        workspacePath: "/ws",
      });
      const chip = [...container.querySelectorAll<HTMLButtonElement>("button")].find((el) =>
        el.textContent?.includes("a.png"),
      );
      await act(async () => chip!.click());
      await vi.waitFor(() => expect(openFile).toHaveBeenCalled());
      expect(resolveMock).toHaveBeenCalledWith("shots/a.png", "/ws");
      expect(openFile.mock.calls[0][0]).toBe("/ws/shots/a.png");
    } finally {
      resolveMock.mockReset();
      resolveMock.mockImplementation(async (path: string) => path);
      useFilesStore.setState({ openFile: original });
    }
  });

  it("does not offer a chip for a folder target", async () => {
    await render(
      [{ type: "tool", text: "Read", path: "/ws/drafts" }],
      { workspacePath: "/ws" },
    );
    expect(container.textContent).toContain("drafts");
    const chips = [...container.querySelectorAll("button")].filter(
      (el) => el.getAttribute("title") === "/ws/drafts",
    );
    expect(chips).toHaveLength(0);
  });
});
