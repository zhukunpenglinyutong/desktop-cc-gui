import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatDuration } from "./format-duration";
import { MessageRow, MessageTimeline } from "./MessageTimeline";
import { buildBotBlock } from "./agent-block";
import { useBotStore } from "@/features/bots/bot-store";
import type { BotConfig, Message } from "@/lib/ipc";
import { EMPTY_SESSION } from "../store/stream";
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

  it("keeps the button hover-revealed and keyboard-reachable", async () => {
    await act(async () => {
      root.render(
        <MessageRow message={userMessage("hello")} workspacePath="/ws" turnFinal />,
      );
    });
    const button = container.querySelector<HTMLButtonElement>("button")!;
    expect(button.className).toContain("group-hover:opacity-100");
    expect(button.className).toContain("focus-visible:opacity-100");
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
