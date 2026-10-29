import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatDuration } from "./format-duration";
import { MessageRow, MessageTimeline, resolveForkAnchors } from "./MessageTimeline";
import { buildBotBlock } from "./agent-block";
import { useChatStore } from "../store";
import { useBotStore } from "@/features/bots/bot-store";
import type { BotConfig, Message } from "@/lib/ipc";
import { EMPTY_SESSION, type SessionState } from "../store/stream";
import { sha256Hex } from "@/lib/sha256";
import i18n from "@/lib/i18n";

const searchHarness = vi.hoisted(() => ({ handlers: new Map<string, () => void>(), scrollToIndex: vi.fn() }));

vi.mock("@/features/shortcuts/runtime", () => ({
  registerShortcutHandler: (name: string, handler: () => void) => {
    searchHarness.handlers.set(name, handler);
    return () => searchHarness.handlers.delete(name);
  },
}));

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (options: { count: number }) => ({
    getVirtualItems: () => Array.from({ length: options.count }, (_, index) => ({ index, key: index, start: index * 72 })),
    getTotalSize: () => options.count * 72,
    measureElement: () => {},
    scrollToIndex: searchHarness.scrollToIndex,
  }),
}));

// React's act() environment flag — same setup as Markdown.test.tsx.
const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no ResizeObserver (CollapsibleMessage measures with it); stub
// it the same way CollapsibleMessage.test.tsx does.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);
vi.stubGlobal("IntersectionObserver", ResizeObserverStub);

describe("timeline search within bounded process history", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    await i18n.changeLanguage("zh");
    searchHarness.scrollToIndex.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function renderTimeline(extraMatches = false) {
    const messages: Message[] = Array.from({ length: 500 }, (_, index) => ({
      seq: index + 1,
      role: "tool",
      text: `工具 ${index} ${[0, 80, 499].includes(index) ? "目标🙂" : "普通"}${extraMatches && index === 0 ? " 目标🙂" : ""}`,
      ts: null,
    }));
    if (extraMatches) messages.unshift({ seq: 0, role: "user", text: "目标🙂", ts: null });
    await act(async () => {
      root.render(<MessageTimeline session={{ ...EMPTY_SESSION, messages }} streaming={false} onLoadEarlier={() => {}} workspacePath="/ws" />);
    });
  }

  async function click(label: string) {
    const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find((element) => element.getAttribute("aria-label") === label || element.textContent === label);
    expect(button, label).toBeTruthy();
    await act(async () => button!.click());
  }

  async function search(query: string) {
    if (!container.querySelector("search input")) await act(async () => searchHarness.handlers.get("chatSearch")!());
    const input = container.querySelector<HTMLInputElement>("search input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, query);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("opens a manually collapsed group and navigates matches across its pages", async () => {
    await renderTimeline();
    await click("工具调用 500 次");
    await search("目标🙂");
    expect(container.querySelector("button[aria-expanded]")!.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("工具 0 目标🙂");
    expect(container.textContent).toContain("1/3");
    expect(container.querySelectorAll("li").length).toBeLessThanOrEqual(40);
    await click(i18n.t("chat.searchNextMatch"));
    expect(container.textContent).toContain("工具 80 目标🙂");
    expect(container.textContent).toContain("2/3");
    await click(i18n.t("chat.searchNextMatch"));
    expect(container.textContent).toContain("工具 499 目标🙂");
    await click(i18n.t("chat.searchPrevMatch"));
    expect(container.textContent).toContain("工具 80 目标🙂");
    expect(container.querySelectorAll("li").length).toBeLessThanOrEqual(40);
  });

  it("reopens the same single hit after a manual collapse and handles a changed query", async () => {
    await renderTimeline();
    await search("工具 80 目标🙂");
    expect(container.textContent).toContain("工具 80 目标🙂");
    await click("工具调用 500 次");
    await click(i18n.t("chat.searchNextMatch"));
    expect(container.querySelector("button[aria-expanded]")!.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("工具 80 目标🙂");
    await search("工具 0 目标🙂");
    expect(container.textContent).toContain("工具 0 目标🙂");
    await click(i18n.t("chat.searchClose"));
    await search("工具 499 目标🙂");
    expect(container.textContent).toContain("工具 499 目标🙂");
  });

  it("maps occurrences rather than item counts after matches in an earlier row", async () => {
    await renderTimeline(true);
    await search("目标🙂");
    expect(container.textContent).toContain("1/5");
    await click(i18n.t("chat.searchNextMatch"));
    expect(container.textContent).toContain("2/5");
    expect(container.textContent).toContain("工具 0 目标🙂 目标🙂");
    await click(i18n.t("chat.searchNextMatch"));
    expect(container.textContent).toContain("3/5");
    expect(container.textContent).toContain("工具 0 目标🙂 目标🙂");
    await click(i18n.t("chat.searchNextMatch"));
    expect(container.textContent).toContain("4/5");
    expect(container.textContent).toContain("工具 80 目标🙂");
    expect(container.querySelectorAll("li").length).toBeLessThanOrEqual(40);
  });
});

describe("formatDuration", () => {
  it("returns null for null, undefined, 0, or negative values", () => {
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(undefined)).toBeNull();
    expect(formatDuration(0)).toBeNull();
    expect(formatDuration(-100)).toBeNull();
  });

  it("formats seconds under 60 with 1 decimal place", () => {
    expect(formatDuration(500)).toBe("0.5s");
    expect(formatDuration(12340)).toBe("12.3s");
    expect(formatDuration(59900)).toBe("59.9s");
  });

  it("formats minutes and seconds for values >= 60s and < 1h", () => {
    expect(formatDuration(60000)).toBe("1m");
    expect(formatDuration(84000)).toBe("1m24s");
    expect(formatDuration(125000)).toBe("2m5s");
  });

  it("formats hours and minutes for values >= 1h", () => {
    expect(formatDuration(3600000)).toBe("1h");
    expect(formatDuration(3720000)).toBe("1h2m");
    expect(formatDuration(7380000)).toBe("2h3m");
  });
});

describe("user bubble copy affordance", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  function userMessage(text: string): Message {
    return { seq: 1, role: "user", text, ts: null };
  }

  it("renders the copy button as a footer after the bubble, not at its left edge", async () => {
    await act(async () => {
      root.render(
        <MessageRow message={userMessage("hello")} workspacePath="/ws" turnFinal />,
      );
    });
    // The user row's only button is the copy affordance (short text does not
    // trigger CollapsibleMessage's expand toggle). aria-label is localized,
    // so don't match on its value.
    const button = container.querySelector<HTMLButtonElement>("button");
    expect(button).not.toBeNull();
    expect(button!.getAttribute("aria-label")).toBeTruthy();
    const bubble = container.querySelector<HTMLDivElement>(".bg-bubble-user");
    expect(bubble).not.toBeNull();
    // Footer placement: the button follows the bubble in document order and
    // is not nested inside it (the old layout sat it in a left side-slot).
    expect(bubble!.compareDocumentPosition(button!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(bubble!.contains(button)).toBe(false);
  });

  it("reveals the user bubble copy button on hover and on keyboard focus", async () => {
    await act(async () => {
      root.render(
        <MessageRow message={userMessage("hello")} workspacePath="/ws" turnFinal />,
      );
    });
    const button = container.querySelector<HTMLButtonElement>("button")!;
    // 用户气泡刻意**不常驻**操作行：hover 才显形，`focus-visible` 一并点亮，
    // 键盘 Tab 到时看得见。分叉入口不在这一侧（只出现在助手回复下方）。
    expect(button.className).toContain("opacity-0");
    expect(button.className).toContain("group-hover:opacity-100");
    expect(button.className).toContain("focus-visible:opacity-100");
    // 焦点环只走 focus-visible（ui-ux-spec §3）。
    expect(button.className).toContain("focus-visible:ring-2");
  });

  it("keeps long unbroken user content inside the conversation width", async () => {
    await act(async () => {
      root.render(
        <MessageRow message={userMessage("x".repeat(2_000))} workspacePath="/ws" turnFinal />,
      );
    });
    const bubble = container.querySelector<HTMLDivElement>(".bg-bubble-user")!;
    expect(bubble.className).toContain("w-fit");
    expect(bubble.className).toContain("max-w-[72%]");
    expect(bubble.className).toContain("max-md:max-w-[85%]");
    expect(bubble.className).toContain("[overflow-wrap:anywhere]");
    expect(bubble.parentElement?.className).toContain("min-w-0");
    expect(bubble.parentElement?.className).toContain("w-full");
    expect(bubble.firstElementChild?.className).toContain("max-w-full");
  });

  it("omits the button for a whitespace-only message", async () => {
    await act(async () => {
      root.render(
        <MessageRow message={userMessage("   ")} workspacePath="/ws" turnFinal />,
      );
    });
    expect(container.querySelector("button")).toBeNull();
  });

  /// The readout is the first thing that shows a huge prompt side (cache-heavy
  /// turns run into the millions), and it used to stop at "k": 1.5M tokens
  /// rendered as "1503.9k". It shares `formatTokens` now, so the unit rolls.
  it("rolls the per-message token readout past k into M", async () => {
    const heavy: Message = {
      seq: 2,
      role: "assistant",
      text: "done",
      ts: null,
      usage: { input: 1_503_900, output: 2_200 },
    };
    await act(async () => {
      root.render(<MessageRow message={heavy} workspacePath="/ws" turnFinal />);
    });
    const shown = container.textContent ?? "";
    expect(shown).toContain("↑1.5M");
    expect(shown).toContain("↓2.2k");
  });
});

/** design §4.3.1：**助手回复**的操作区常驻（复制 + 分支），元信息才走 hover；
 *  分支图标用 GitFork 而不是 GitBranch（状态栏 git 切换器已占用后者）。
 *  用户气泡不常驻、也没有分叉入口（见下面的 user bubble copy affordance）。 */
describe("assistant message actions", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const reply: Message = { seq: 2, role: "assistant", text: "答案", ts: null };

  it("keeps copy visible and offers a fork entry that is not GitBranch", async () => {
    await act(async () => {
      root.render(
        <MessageRow
          message={reply}
          workspacePath="/ws"
          turnFinal
          forkAnchor={resolveForkAnchors([{ seq: 1, role: "user", text: "问题", ts: null }, reply]).get(reply) ?? null}
        />,
      );
    });
    // 按稳定的 class 钩子选，不按 i18n 之后的 aria-label 文案（切语言就变）。
    const copy = container.querySelector<HTMLButtonElement>(".message-copy-btn");
    expect(copy).not.toBeNull();
    expect(copy!.className).not.toContain("opacity-0");
    const fork = container.querySelector<HTMLButtonElement>(".message-fork-btn");
    expect(fork).not.toBeNull();
    // GitFork 是「两上节点 + 汇合线 + 一下节点」；GitBranch 是一条竖线 + 弧线。
    // 断言靠在场的那条 GitFork 专属路径上，避免两个图标被换用而测试察觉不到。
    expect(fork!.querySelector('path[d="M12 12v3"]')).not.toBeNull();
    expect(fork!.querySelector("line")).toBeNull();
  });

  it("keeps history actions usable while only the current turn streams", async () => {
    // 真机反馈：回复途中，**历史轮**的复制/分叉也被一起禁用了（`turnLive` 是会话级
    // 标志）。正确语义是只有「当前正在输出的这一轮」不可操作。
    const renderRow = async (seq: number) => {
      await act(async () => {
        root.render(
          <MessageRow
            message={{ ...reply, seq }}
            workspacePath="/ws"
            turnFinal={false}
            turnLive
            turnStartSeq={5}
            forkAnchor={{ text: "问题", seq: 1, tail: 0 }}
          />,
        );
      });
      return container.querySelector<HTMLButtonElement>(".message-copy-btn")!;
    };

    // 历史轮（seq < 当前轮起点）：可用。
    expect((await renderRow(2)).disabled).toBe(false);
    // 当前轮（seq ≥ 起点）：禁用。
    expect((await renderRow(7)).disabled).toBe(true);
  });

  it("disables copy and fork together while the turn streams", async () => {
    // 规范（ui-ux-spec §3）：流式期间「复制 + 分叉」一起禁用。复制单独漏掉的话，
    // 回复还在增长时点复制只能拿到半句话，而且会立刻显示「已复制」——
    // 一个明确的成功反馈配上不完整的内容。
    await act(async () => {
      root.render(
        <MessageRow
          message={{ ...reply, live: true }}
          workspacePath="/ws"
          turnFinal={false}
          forkAnchor={{ text: "问题", seq: 1, tail: 0 }}
        />,
      );
    });
    const copy = container.querySelector<HTMLButtonElement>(".message-copy-btn");
    expect(copy).not.toBeNull();
    expect(copy!.disabled).toBe(true);
    expect(copy!.className).toContain("disabled:cursor-not-allowed");
    // 分叉按钮的流式禁用由 `fork entry through the real row build` 里的
    // 「keeps the entry present but disabled while the turn streams」覆盖；
    // 这里不重复断言，避免受本用例未激活会话（engine 原因优先于 live）影响。
  });

  it("hides the fork entry when the turn's user message is not loaded", async () => {
    // 只有助手行、没有本轮提问：宁可不给入口，也不猜分叉位置。
    await act(async () => {
      root.render(
        <MessageRow message={reply} workspacePath="/ws" turnFinal forkAnchor={resolveForkAnchors([reply]).get(reply) ?? null} />,
      );
    });
    expect(container.querySelector(".message-fork-btn")).toBeNull();
    expect(container.querySelector(".message-copy-btn")).not.toBeNull();
  });

  it("shows the meta readout only on a turn-final reply", async () => {
    await act(async () => {
      root.render(
        <MessageRow
          message={{ ...reply, ts: "2026-10-21T12:00:00.000Z" }}
          workspacePath="/ws"
          turnFinal={false}
          forkAnchor={{ text: "问题", seq: 1, tail: 0 }}
        />,
      );
    });
    // 未定稿的行仍给操作入口（按钮常驻），但不给元信息（时间/用量/模型）。
    expect(container.querySelector(".message-copy-btn")).not.toBeNull();
    expect(container.textContent ?? "").not.toContain("·");
  });
});

/** 分叉入口走**真实的 buildRows 路径**（不是手传 turnFinal）：可见性只看
 *  「这条消息能否当分叉锚点」。
 *
 *  入口**只出现在助手回复下方**（用户气泡没有分叉按钮）。`turnFinal` 只由
 *  buildRows 的收尾扫描打给助手行（timeline-rows.ts），所以它不能当闸门：
 *  想分叉的那条回复未必是本轮最后一段。可见性与可用性也分开：不可用只置灰并
 *  说明，不隐藏（design §4.3.1）。 */
describe("fork entry through the real row build", () => {
  let container: HTMLDivElement;
  let root: Root;
  const TAB = { engine: "claude", sessionId: "s-1", workspacePath: "/ws" };
  const realForkSession = useChatStore.getState().forkSession;
  const conversation: Message[] = [
    { seq: 1, role: "user", text: "你好，你是谁", ts: null },
    { seq: 2, role: "assistant", text: "你好，我是 Claude。", ts: null },
  ];

  beforeEach(async () => {
    await i18n.changeLanguage("zh");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    useChatStore.setState({
      active: TAB,
      sessions: [{ ...TAB, title: "甲会话" } as never],
      forkingByKey: {},
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    useChatStore.setState({
      active: null,
      sessions: [],
      forkingByKey: {},
      forkSession: realForkSession,
    });
  });

  function spyOnFork() {
    const forkSession = vi.fn(
      async (
        _engine: string,
        _sessionId: string,
        _workspacePath: string,
        _anchor?: { userTextSha256: string; seqHint?: number; tailOccurrence?: number } | null,
      ) => {},
    );
    useChatStore.setState({ forkSession });
    return forkSession;
  }

  async function renderTimeline(streaming = false) {
    await act(async () => {
      root.render(
        <MessageTimeline
          session={{ ...EMPTY_SESSION, messages: conversation }}
          streaming={streaming}
          onLoadEarlier={() => {}}
          workspacePath="/ws"
        />,
      );
    });
  }

  /** 分叉入口**只出现在助手回复下方**（用户气泡没有入口）：整条时间线里
   *  `.message-fork-btn` 应当恰好只有回复那一颗。 */
  function replyForkButton(): HTMLButtonElement {
    const buttons = container.querySelectorAll<HTMLButtonElement>(".message-fork-btn");
    expect(buttons.length).toBe(1);
    return buttons[0];
  }

  it("offers the fork entry on the assistant reply and forks at that turn", async () => {
    const forkSession = spyOnFork();
    await renderTimeline();

    const fork = replyForkButton();
    expect(fork.disabled).toBe(false);
    expect(fork.getAttribute("aria-disabled")).toBeNull();

    await act(async () => fork.click());
    // 点用户提问这一轮 = 从「这一轮结束」分叉，锚点就是这条用户消息的原文
    // （resolveForkAnchor 的契约：用户行包含它自己）。
    expect(forkSession).toHaveBeenCalledTimes(1);
    expect(forkSession).toHaveBeenCalledWith("claude", "s-1", "/ws", {
      userTextSha256: sha256Hex("你好，你是谁"),
      seqHint: 1,
      // 从尾部数的同文本序号：这条之后没有同样的文本 ⇒ 0。
      tailOccurrence: 0,
    });
  });

  it("keeps the entry present but disabled while the turn streams", async () => {
    const forkSession = spyOnFork();
    await renderTimeline(true);

    const fork = replyForkButton();
    // 流式期间**保留占位 + 禁用**而非隐藏（ui-ux-spec §3）：隐藏会在回复结束
    // 时凭空多出一行。这类禁用原因自明，用原生 disabled 即可。
    expect(fork.disabled).toBe(true);
    expect(fork.className).toContain("disabled:cursor-not-allowed");
    await act(async () => fork.click());
    expect(forkSession).not.toHaveBeenCalled();
    // 时间线里只有回复那一颗入口；用户气泡没有分叉按钮。
    expect(container.querySelectorAll(".message-fork-btn")).toHaveLength(1);
  });

  it("greys a remote session's entry with the reason, and never forks", async () => {
    const forkSession = spyOnFork();
    useChatStore.setState({ sessions: [{ ...TAB, remote: true } as never] });
    await renderTimeline();

    const fork = replyForkButton();
    // 解释性禁用走 aria-disabled + 点击守卫：原生 disabled 收不到 hover /
    // focus，挂在 title 上的原因就读不到（ui-ux-spec §3）。
    expect(fork.getAttribute("aria-disabled")).toBe("true");
    expect(fork.disabled).toBe(false);
    expect(fork.getAttribute("title")).toBe(i18n.t("chat.forkUnavailableRemote"));
    await act(async () => fork.click());
    expect(forkSession).not.toHaveBeenCalled();
  });

  it("greys the entry for an engine outside the backend allow-list", async () => {
    const forkSession = spyOnFork();
    useChatStore.setState({
      active: { engine: "kimi", sessionId: "s-1", workspacePath: "/ws" },
      sessions: [
        { engine: "kimi", sessionId: "s-1", workspacePath: "/ws" } as never,
      ],
    });
    await renderTimeline();

    const fork = replyForkButton();
    expect(fork.getAttribute("aria-disabled")).toBe("true");
    expect(fork.getAttribute("title")).toBe(i18n.t("chat.forkUnavailableEngine"));
    await act(async () => fork.click());
    expect(forkSession).not.toHaveBeenCalled();
  });

  it("marks the entry busy with the wait cursor while a fork is in flight", async () => {
    const forkSession = spyOnFork();
    useChatStore.setState({ forkingByKey: { "claude/s-1": true } });
    await renderTimeline();

    const fork = replyForkButton();
    // 「进行中」与「前提不满足」是两种禁用（ui-ux-spec §3）：等待态用
    // cursor-wait，不能拿它表达"你还没准备好前提"。
    expect(fork.disabled).toBe(true);
    expect(fork.className).toContain("disabled:cursor-wait");
    await act(async () => fork.click());
    expect(forkSession).not.toHaveBeenCalled();
  });
});

describe("settled response check record", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    await i18n.changeLanguage("zh");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  function settledMessage(): Message {
    return {
      seq: 2,
      role: "assistant",
      text: "ok",
      ts: null,
      model: "gpt-6-astra",
      effort: "max",
      responseCheck: {
        requested: { model: "gpt-6-astra", effort: "max" },
        served: { model: "gpt-5.6-luna", effort: "low" },
      },
    };
  }

  it("keeps the check available after the turn ends", async () => {
    await act(async () => {
      root.render(
        <MessageRow message={settledMessage()} workspacePath="/ws" turnFinal />,
      );
    });
    const badge = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="响应校验"]',
    );
    expect(badge).not.toBeNull();
    expect(badge!.getAttribute("aria-label")).toBe("响应校验：与响应不一致");
    // Hover-revealed together with the rest of the meta row.
    expect(container.textContent).toContain("模型 gpt-6-astra");
  });

  it("shows no badge for a message with no recorded check", async () => {
    await act(async () => {
      root.render(
        <MessageRow
          message={{ seq: 2, role: "assistant", text: "ok", ts: null, model: "gpt-6-astra" }}
          workspacePath="/ws"
          turnFinal
        />,
      );
    });
    expect(container.querySelector('button[aria-label^="响应校验"]')).toBeNull();
  });

  it("keeps the footer on the reply when a card is the newest row", async () => {
    // A denied tool leaves a grant card after the reply; the card renders its
    // own chrome and must not steal the footer slot from the assistant row.
    const messages: Message[] = [
      { seq: 1, role: "user", text: "go", ts: null },
      {
        seq: 2,
        role: "assistant",
        text: "ok",
        ts: null,
        model: "gpt-6-astra",
        responseCheck: {
          requested: { model: "gpt-6-astra", effort: "max" },
          served: { model: "gpt-6-astra", effort: "max" },
        },
      },
      {
        seq: 3,
        role: "grant",
        text: "",
        ts: null,
        path: "S:\\ws\\package.json",
        grant: { status: "pending", dir: "S:\\ws" },
      },
    ];
    await act(async () => {
      root.render(
        <MessageTimeline
          session={{ ...EMPTY_SESSION, messages }}
          streaming={false}
          onLoadEarlier={() => {}}
          workspacePath="/ws"
        />,
      );
    });
    const badge = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="响应校验"]',
    );
    expect(badge).not.toBeNull();
    expect(badge!.getAttribute("aria-label")).toBe("响应校验：与响应一致");
  });
});

describe("user bubble agent badge", () => {
  let container: HTMLDivElement;
  let root: Root;
  const realGetContext = HTMLCanvasElement.prototype.getContext;

  beforeEach(() => {
    // jsdom has no 2D context. The engine skips its loop when getContext
    // returns null, but jsdom would also log the missing implementation.
    HTMLCanvasElement.prototype.getContext = (() =>
      null) as typeof HTMLCanvasElement.prototype.getContext;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    HTMLCanvasElement.prototype.getContext = realGetContext;
    useBotStore.setState({ bots: [], builtInAgents: [], builtInDivisions: [], loaded: false });
  });

  function bot(overrides: Partial<BotConfig> = {}): BotConfig {
    return {
      id: "bot-1",
      slug: "reviewer",
      name: "CCGUI PR审查工程师",
      title: null,
      description: null,
      avatar: { type: "generated", foldShape: "shield", eyes: "angry", hue: 0, saturation: 78 },
      soul: "",
      instructions: "",
      capabilities: { skills: [], tools: [], mcpServers: [] },
      runtime: { kind: "direct", model: null, cwd: null, extraArgs: [], permissionMode: "ask" },
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

  /** A committed user turn: the bare prompt followed by the frozen block
   *  sendPrompt appends. */
  function messageWithBlock(input: { name?: string; icon?: string; botId?: string }): Message {
    return {
      seq: 1,
      role: "user",
      text: `https://github.com/zhukunpenglinyutong/jetbrains-cc-gui/pull/1895\n\n${buildBotBlock({
        name: input.name ?? "CCGUI PR审查工程师",
        icon: input.icon ?? "",
        botId: input.botId ?? "bot-1",
        body: "你是评审工程师。",
      })}`,
      ts: null,
    };
  }

  async function renderBadge(message: Message) {
    await act(async () => {
      root.render(<MessageRow message={message} workspacePath="/ws" turnFinal />);
    });
    return container.querySelector<HTMLElement>(".text-caption-1-regular");
  }

  it("renders the bot's paper avatar next to the frozen name", async () => {
    useBotStore.setState({ bots: [bot()], loaded: true });
    const badge = await renderBadge(messageWithBlock({}));
    expect(badge?.textContent).toContain("CCGUI PR审查工程师");
    const avatar = badge?.querySelector<HTMLElement>('[data-testid="bot-avatar"]');
    expect(avatar?.dataset.avatarType).toBe("generated");
    expect(avatar?.querySelector("canvas")).not.toBeNull();
  });

  it("follows the live bot when its avatar was edited after the send", async () => {
    useBotStore.setState({ bots: [bot({ avatar: { type: "emoji", value: "🧐" } })], loaded: true });
    const badge = await renderBadge(messageWithBlock({}));
    const avatar = badge?.querySelector<HTMLElement>('[data-testid="bot-avatar"]');
    expect(avatar?.dataset.avatarType).toBe("emoji");
    expect(avatar?.textContent).toBe("🧐");
  });

  it("keeps the recorded emoji when the bot no longer exists", async () => {
    const badge = await renderBadge(messageWithBlock({ icon: "🔍", botId: "deleted" }));
    const avatar = badge?.querySelector<HTMLElement>('[data-testid="bot-avatar"]');
    expect(avatar?.dataset.avatarType).toBe("emoji");
    expect(avatar?.textContent).toBe("🔍");
  });

  it("falls back to a deterministic paper avatar when only an id was recorded", async () => {
    const badge = await renderBadge(messageWithBlock({ botId: "deleted" }));
    const avatar = badge?.querySelector<HTMLElement>('[data-testid="bot-avatar"]');
    expect(avatar?.dataset.avatarType).toBe("generated");
    const label = avatar?.querySelector("canvas")?.getAttribute("aria-label");
    expect(label).toBeTruthy();
    // Same message, same face: the fallback seed is the recorded id, not a
    // random pick that repaints on every mount.
    await renderBadge(messageWithBlock({ botId: "deleted" }));
    expect(
      container.querySelector("canvas")?.getAttribute("aria-label"),
    ).toBe(label);
  });
});

describe("host compaction rows", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    await i18n.changeLanguage("zh");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function renderCompacting(
    messages: Message[],
    compaction: SessionState["compaction"],
    streaming: boolean,
  ) {
    await act(async () => {
      root.render(
        <MessageTimeline
          session={{ ...EMPTY_SESSION, messages, compaction }}
          streaming={streaming}
          onLoadEarlier={() => {}}
          workspacePath="/ws"
        />,
      );
    });
  }

  const hintText = () => `< ${i18n.t("chat.compactingContext")} >`;
  const curtains = () => container.querySelectorAll('[data-testid="compaction-curtain"]');

  it("keeps the compaction as one grey line in place and drops the resume nudge", async () => {
    const messages: Message[] = [
      { seq: 1, role: "user", text: "读一下那个文件", ts: null },
      { seq: 2, role: "user", text: "/compact", ts: null },
      { seq: 3, role: "user", text: i18n.t("chat.autoCompactResume"), ts: null },
      { seq: 4, role: "assistant", text: "文件已经读完了。", ts: null },
    ];
    // Settled: no compaction running, which is exactly when the line has to
    // stay — it is the transcript's only record of the compaction.
    await renderCompacting(messages, null, false);

    expect(container.textContent).toContain("读一下那个文件");
    // The rows stay in the store (compact-turn detection reads them) and are
    // handled at render time — including on a history page reloaded from the
    // engine's transcript, where only the texts identify them.
    expect(container.textContent).not.toContain("/compact");
    expect(container.textContent).not.toContain(i18n.t("chat.autoCompactResume"));

    expect(curtains().length).toBe(1);
    const line = curtains()[0];
    expect(line.textContent).toBe(hintText());
    expect(line.querySelector("span")?.className).toContain("text-text-tertiary");
    expect(line.className).toContain("justify-end");
  });

  it("does not double the line while a host compaction runs", async () => {
    const messages: Message[] = [
      { seq: 1, role: "user", text: "继续", ts: null },
      { seq: 2, role: "user", text: "/compact", ts: null },
    ];
    await renderCompacting(messages, { automatic: false, startedAt: 1 }, true);
    // The row already shows it; the tail must stay quiet instead of adding a
    // second line or the ordinary thinking indicator.
    expect(curtains().length).toBe(1);
    expect(container.textContent).not.toContain(i18n.t("chat.thinking"));
  });

  it("mounts the line at the tail for an engine compaction, then returns to the indicator", async () => {
    const messages: Message[] = [{ seq: 1, role: "user", text: "继续", ts: null }];
    await renderCompacting(messages, { automatic: true, startedAt: 1 }, true);
    expect(curtains().length).toBe(1);
    expect(container.textContent).not.toContain(i18n.t("chat.thinking"));

    await renderCompacting(messages, null, true);
    expect(curtains().length).toBe(0);
    expect(container.textContent).toContain(i18n.t("chat.thinking"));
  });
});

describe("chat column width (宽幕布)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    useChatStore.setState({ wideLayout: false });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    useChatStore.setState({ wideLayout: false });
  });

  async function render(wide: boolean) {
    useChatStore.setState({ wideLayout: wide });
    await act(async () => {
      root.render(
        <MessageTimeline
          session={{
            ...EMPTY_SESSION,
            messages: [{ seq: 1, role: "user", text: "hi", ts: null }],
          }}
          streaming={false}
          onLoadEarlier={() => {}}
          workspacePath="/ws"
        />,
      );
    });
    return container.querySelector<HTMLElement>("[data-virtual-inner]")!;
  }

  it("keeps the centered 750px column by default", async () => {
    const inner = await render(false);
    expect(inner.className).toContain("mx-auto");
    expect(inner.className).toContain("max-w-[750px]");
  });

  it("drops the cap while 宽幕布 is on, and restores it when switched off", async () => {
    const inner = await render(true);
    expect(inner.className).toContain("w-full");
    expect(inner.className).not.toContain("max-w-[750px]");

    // Live toggle: the mounted timeline follows the store slice.
    await act(async () => useChatStore.setState({ wideLayout: false }));
    expect(inner.className).toContain("max-w-[750px]");
  });
});

describe("process run fold timing", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    await i18n.changeLanguage("zh");
    useChatStore.setState({ thinkingAutoCollapse: true });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    useChatStore.setState({ thinkingAutoCollapse: true });
  });

  it("keeps a running process open and folds it only when answer text follows", async () => {
    const messages: Message[] = [
      { seq: 1, role: "user", text: "做一下", ts: null },
      { seq: 2, role: "thinking", text: "先看文件", ts: null, live: true },
      { seq: 3, role: "tool", text: "Read", ts: null },
    ];
    const renderSession = async (next: Message[]) => {
      await act(async () => {
        root.render(
          <MessageTimeline
            session={{ ...EMPTY_SESSION, messages: next, streaming: true }}
            streaming
            onLoadEarlier={() => {}}
            workspacePath="/ws"
          />,
        );
      });
    };
    const header = () => container.querySelector("button[aria-expanded]");

    await renderSession(messages);
    expect(header()!.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("先看文件");

    // Thinking settled at the tool boundary, but no answer text yet: keep open.
    await renderSession([...messages.slice(0, 2), { ...messages[2] }]);
    expect(header()!.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("先看文件");

    // Assistant text appears after the run: now fold.
    await renderSession([
      ...messages,
      { seq: 4, role: "assistant", text: "答复", ts: null, live: true },
    ]);
    expect(header()!.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).toContain("答复");

    // The next turn's process run opens; the previous turn's answer text must
    // not keep marking the new run as answered.
    await renderSession([
      ...messages,
      { seq: 4, role: "assistant", text: "答复", ts: null },
      { seq: 5, role: "user", text: "再改一下", ts: null },
      { seq: 6, role: "thinking", text: "第二轮分析", ts: null, live: true },
    ]);
    expect(
      [...container.querySelectorAll("button[aria-expanded]")].map((button) =>
        button.getAttribute("aria-expanded"),
      ),
    ).toEqual(["false", "true"]);
    expect(container.textContent).toContain("第二轮分析");
  });
});
