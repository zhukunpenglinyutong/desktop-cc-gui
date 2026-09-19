import { act } from "react";
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

const CHANNELS = { codex: [{ id: "c1", label: "codex-one" }] };

function Harness() {
  return (
    <CliMenu
      options={OPTIONS}
      value="claude"
      onChange={() => {}}
      modelsByEngine={MODELS}
      models={{}}
      onModelChange={() => {}}
      efforts={{}}
      onEffortChange={() => {}}
      channelsByEngine={CHANNELS}
      selectedChannels={{ codex: "c1" }}
      onChannelChange={() => {}}
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

  const render = () =>
    act(() => {
      root.render(<Harness />);
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

  const click = async (element: Element) => {
    await act(async () => {
      (element as HTMLElement).click();
    });
  };

  it("指针掠过引擎行不会换掉正在使用的面板", async () => {
    render();
    await openMenu();
    await click(engineRow("Codex")!);
    expect(flyoutTitle()).toBe("Codex CLI 引擎");

    // A pointer passing over Claude's row (the path from the engine rows to
    // the panel's own controls) must not swap the panel out from under the
    // filter or search the user is working in — only a click switches it.
    await enter(engineRow("Claude")!);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
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
