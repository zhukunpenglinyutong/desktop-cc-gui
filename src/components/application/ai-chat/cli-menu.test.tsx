import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";
import { CliMenu } from "./cli-menu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const OPTIONS = [
  { id: "claude", label: "Claude Code", available: true },
  { id: "codex", label: "Codex", available: true },
  { id: "omp", label: "OMP", available: true },
];

const MODELS = {
  claude: [{ id: "default", label: "Default" }],
  codex: [{ id: "gpt-6-astra", label: "gpt-6-astra" }],
  omp: [{ id: "openai/gpt-5", label: "gpt-5" }],
};

const CHANNELS = {
  codex: [
    { id: "c1", label: "codex-one" },
    { id: "c2", label: "codex-two" },
  ],
};

function Harness({ initialEngine = "claude" }: { initialEngine?: string }) {
  const [engine, setEngine] = useState(initialEngine);
  const [selectedChannels, setSelectedChannels] = useState({ codex: "c1" });
  return (
    <CliMenu
      options={OPTIONS}
      value={engine}
      onChange={setEngine}
      modelsByEngine={MODELS}
      models={{}}
      onModelChange={() => {}}
      efforts={{}}
      onEffortChange={() => {}}
      channelsByEngine={CHANNELS}
      selectedChannels={selectedChannels}
      onChannelChange={(engine, id) => {
        setSelectedChannels((channels) => ({ ...channels, [engine]: id }));
      }}
      ompServiceTier={null}
      onOmpServiceTierChange={async () => {}}
      codexServiceTier={null}
      onCodexServiceTierChange={async () => {}}
    />
  );
}

describe("CliMenu flyout switching", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    // jsdom has no matchMedia; desktop (no match) is the branch under test.
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const render = (initialEngine?: string) =>
    act(() => {
      root.render(<Harness initialEngine={initialEngine} />);
    });

  /** The flyout is the panel carrying the engine header. */
  const flyoutTitle = () =>
    [...document.querySelectorAll("span")]
      .map((span) => span.textContent ?? "")
      .find((text) => text.endsWith("引擎")) ?? null;

  /** Engine rows live in the popover's dialog; the composer chip is a button
   *  too and shares the engine's display name, so scope the lookup. */
  const engineRow = (label: string) => {
    const dialog = document.querySelector('[role="dialog"]');
    return (
      [...(dialog?.querySelectorAll("button") ?? [])].find((button) =>
        button.textContent?.trim().startsWith(label),
      ) ?? null
    );
  };

  const openMenu = async () => {
    const chip = container.querySelector<HTMLButtonElement>("button")!;
    await act(async () => {
      chip.click();
    });
  };

  const enter = async (element: Element) => {
    await act(async () => {
      element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
  };
  const leave = async (element: Element) => {
    await act(async () => {
      element.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    });
  };
  /** Let the hover-intent timer (and then some) elapse. */
  const settleHover = async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 400);
    await act(async () => {
      await promise;
    });
  };

  const click = async (element: Element) => {
    await act(async () => {
      (element as HTMLElement).click();
    });
  };

  it("切换 Codex 渠道后保留面板并将焦点交回渠道按钮", async () => {
    render("codex");
    await openMenu();
    await click(engineRow("Codex")!);
    const trigger = document.querySelector<HTMLButtonElement>(
      "[data-engine-flyout] button[aria-expanded]",
    )!;
    await click(trigger);
    const list = document.getElementById(trigger.getAttribute("aria-controls")!)!;
    const row = [...list.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find(
      (button) => button.textContent?.trim() === "codex-two",
    )!;

    // A real pointer/keyboard activation focuses the row before selecting it.
    // A bare .click() misses the focus loss when the dropdown unmounts it.
    await act(async () => {
      row.focus();
      row.click();
    });

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.textContent).toContain("codex-two");
    expect(document.activeElement).toBe(trigger);
    expect(flyoutTitle()).toBe("Codex CLI 引擎");
    expect(engineRow("Codex")?.getAttribute("aria-pressed")).toBe("true");
  });

  it("指针掠过引擎行不触发切换", async () => {
    render();
    await openMenu();
    await click(engineRow("Codex")!);
    expect(flyoutTitle()).toBe("Codex CLI 引擎");

    // A pointer crossing Claude's row on its way into the panel leaves
    // before the hover-intent delay, so the panel must stay put.
    await enter(engineRow("Claude")!);
    await leave(engineRow("Claude")!);
    await settleHover();
    expect(flyoutTitle()).toBe("Codex CLI 引擎");
  });

  it("悬停停留后打开对应引擎面板", async () => {
    render();
    await openMenu();
    await click(engineRow("Codex")!);
    expect(flyoutTitle()).toBe("Codex CLI 引擎");

    // Dwelling on a row past the intent delay pre-opens its flyout.
    await enter(engineRow("Claude")!);
    await settleHover();
    expect(flyoutTitle()).toBe("Claude Code 引擎");
  });

  it("面板搜索框输入期间悬停不换面板", async () => {
    render();
    await openMenu();
    await click(engineRow("Codex")!);
    expect(flyoutTitle()).toBe("Codex CLI 引擎");

    // While the user is typing in the panel's search field, a dwelling
    // hover must not yank the panel away; the click path still works.
    const search = document.querySelector<HTMLInputElement>(
      "[data-engine-flyout] input",
    )!;
    await act(async () => {
      search.focus();
    });
    await enter(engineRow("Claude")!);
    await settleHover();
    expect(flyoutTitle()).toBe("Codex CLI 引擎");
  });

  it("点击引擎行切换面板", async () => {
    render();
    await openMenu();
    await click(engineRow("Codex")!);
    expect(flyoutTitle()).toBe("Codex CLI 引擎");

    await click(engineRow("Claude")!);
    expect(flyoutTitle()).toBe("Claude Code 引擎");
  });
});
