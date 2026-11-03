import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import "@/lib/i18n";
import i18n from "@/lib/i18n";
import { EngineFlyout, EngineModelPanel } from "./engine-model-panel";
import type { ModelOption } from "./cli-menu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** More channels than fit the flyout: a machine with a dozen relays used to
 *  render every one of them inline, pushing the model list off the panel. */
const CHANNELS = Array.from({ length: 11 }, (_, index) => ({
  id: `p${index + 1}`,
  label: `provider-${index + 1}`,
}));

describe("EngineModelPanel channel picker", () => {
  let container: HTMLDivElement;
  let root: Root;
  let onPickChannel: Mock;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    onPickChannel = vi.fn();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = (selectedChannelId: string) =>
    act(() => {
      root.render(
        <EngineModelPanel
          option={{ id: "codex", label: "Codex" }}
          models={[]}
          selectedModelId=""
          query=""
          onQueryChange={() => {}}
          effort="medium"
          onPickModel={() => {}}
          onEffortChange={() => {}}
          channels={CHANNELS}
          selectedChannelId={selectedChannelId}
          onPickChannel={onPickChannel}
          ompServiceTier={null}
          onOmpServiceTierChange={async () => {}}
          codexServiceTier={null}
          onCodexServiceTierChange={async () => {}}
        />,
      );
    });

  /** The dropdown trigger is the only aria-expanded control on the panel. */
  const trigger = () =>
    container.querySelector<HTMLButtonElement>("button[aria-expanded]");

  it("shows only the selected channel until the dropdown is opened", () => {
    render("p2");
    expect(trigger()?.textContent).toContain("provider-2");
    expect(trigger()?.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toContain("provider-9");

    act(() => trigger()!.click());
    expect(trigger()?.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("provider-9");
  });

  it("picks a channel and closes the dropdown", () => {
    render("p2");
    act(() => trigger()!.click());
    const row = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "provider-9",
    );
    expect(row).toBeTruthy();
    act(() => row!.click());
    expect(onPickChannel).toHaveBeenCalledWith("codex", "p9");
    expect(trigger()?.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toContain("provider-9");
  });

  it("follows the selected channel the parent hands back", () => {
    render("p2");
    expect(trigger()?.textContent).toContain("provider-2");
    render("p9");
    expect(trigger()?.textContent).toContain("provider-9");
  });

  /** The header field is contracted by its accessible name (the i18n key),
   *  so the assertion does not depend on where it sits in the DOM. */
  const filterInput = () =>
    container.querySelector<HTMLInputElement>(
      `input[aria-label="${i18n.t("chat.channelFilterPlaceholder")}"]`,
    );

  const type = async (input: HTMLInputElement, value: string) => {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  it("narrows the channel list from the header filter", async () => {
    render("p2");
    await type(filterInput()!, "provider-9");
    // Typing opens the list, and only the match survives the filter.
    expect(trigger()?.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("provider-9");
    expect(container.textContent).not.toContain("provider-1");
  });

  it("says so when the channel filter matches nothing", async () => {
    render("p2");
    await type(filterInput()!, "no-such-channel");
    expect(container.textContent).toContain(i18n.t("chat.noMatchingChannels"));
  });

  it("picks a filtered channel and clears the filter", async () => {
    render("p2");
    await type(filterInput()!, "provider-9");
    const row = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "provider-9",
    );
    expect(row).toBeTruthy();
    act(() => row!.click());
    expect(onPickChannel).toHaveBeenCalledWith("codex", "p9");
    expect(trigger()?.getAttribute("aria-expanded")).toBe("false");
    expect(filterInput()?.value).toBe("");
  });

  it("shows no channel UI for an engine without channels", () => {
    // omp until a channel is added in settings: an empty channels array is
    // still truthy, and the filter box used to render narrowing nothing.
    act(() => {
      root.render(
        <EngineModelPanel
          option={{ id: "omp", label: "OMP" }}
          models={[]}
          selectedModelId=""
          query=""
          onQueryChange={() => {}}
          effort="medium"
          onPickModel={() => {}}
          onEffortChange={() => {}}
          channels={[]}
          selectedChannelId=""
          onPickChannel={onPickChannel}
          ompServiceTier={null}
          onOmpServiceTierChange={async () => {}}
          codexServiceTier={null}
          onCodexServiceTierChange={async () => {}}
        />,
      );
    });
    expect(filterInput()).toBeNull();
    expect(trigger()).toBeNull();
  });

  it("renders effort slider for all supported CLI engines", () => {
    // Supported engine: codex
    render("p1");
    expect(container.querySelector("[aria-label='推理强度']")).toBeTruthy();

    // Supported engine: kimi
    act(() => {
      root.render(
        <EngineModelPanel
          option={{ id: "kimi", label: "Kimi" }}
          models={[]}
          selectedModelId=""
          query=""
          onQueryChange={() => {}}
          effort="medium"
          onPickModel={() => {}}
          onEffortChange={() => {}}
          channels={[]}
          selectedChannelId=""
          onPickChannel={onPickChannel}
          ompServiceTier={null}
          onOmpServiceTierChange={async () => {}}
          codexServiceTier={null}
          onCodexServiceTierChange={async () => {}}
        />,
      );
    });
    expect(container.querySelector("[aria-label='推理强度']")).toBeTruthy();
  });
});

describe("EngineModelPanel model sections", () => {
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

  const CODEBUDDY: ModelOption[] = [
    { id: "custom:glm-5.3", label: "GLM 5.3", provider: "enterprise" },
    { id: "hy4-preview", label: "Hunyuan 4 Preview", provider: "hunyuan" },
    { id: "glm-5.3", label: "GLM 5.3", provider: "chatglm" },
  ];

  const render = (engineId: string, models: ModelOption[], selectedModelId: string, query = "") =>
    act(() => {
      root.render(
        <EngineModelPanel
          option={{ id: engineId, label: engineId }}
          models={models}
          selectedModelId={selectedModelId}
          query={query}
          onQueryChange={() => {}}
          effort="medium"
          onPickModel={() => {}}
          onEffortChange={() => {}}
          channels={[]}
          selectedChannelId=""
          ompServiceTier={null}
          onOmpServiceTierChange={async () => {}}
          codexServiceTier={null}
          onCodexServiceTierChange={async () => {}}
        />,
      );
    });

  /** Section headers in display order (the sticky labels above each group). */
  const headers = () =>
    [...container.querySelectorAll('[role="radiogroup"] > div > span')].map(
      (el) => el.textContent,
    );

  it("titles CodeBuddy's enterprise section and files it last", () => {
    render("codebuddy", CODEBUDDY, "glm-5.3");
    expect(headers()).toEqual(["chatglm", "hunyuan", i18n.t("chat.modelGroupEnterprise")]);
  });

  it("keeps a picked enterprise model in view by leading with its section", () => {
    render("codebuddy", CODEBUDDY, "custom:glm-5.3");
    expect(headers()[0]).toBe(i18n.t("chat.modelGroupEnterprise"));
  });

  it("finds the enterprise rows by the title on screen", () => {
    // The first two characters of the header (企业 in the default zh UI).
    render("codebuddy", CODEBUDDY, "", i18n.t("chat.modelGroupEnterprise").slice(0, 2));
    expect(headers()).toEqual([i18n.t("chat.modelGroupEnterprise")]);
  });

  it("shows another engine's relay named enterprise under its own name", () => {
    render(
      "omp",
      [
        { id: "enterprise/gpt-5.4", label: "gpt-5.4", provider: "enterprise" },
        { id: "openai/gpt-5.4", label: "gpt-5.4", provider: "openai" },
      ],
      "",
    );
    // No pick to lead with: catalog order stands, nothing sinks or renames.
    expect(headers()).toEqual(["enterprise", "openai"]);
  });
});

describe("长模型名称", () => {
  it("保留完整名称和描述，并按完整 ID 选择同前缀模型", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onPickModel = vi.fn();
    const models = [
      { id: "relay/deepseek-v4-pro", label: "deepseek-v4-pro", description: "自定义渠道上的完整模型说明" },
      { id: "relay/deepseek-v4.1-flash", label: "deepseek-v4.1-flash" },
    ];
    try {
      act(() => root.render(
        <EngineFlyout
          option={{ id: "pi", label: "PI" }}
          models={models}
          selectedModelId={models[0].id}
          query=""
          onQueryChange={() => {}}
          effort="medium"
          onPickModel={onPickModel}
          onEffortChange={() => {}}
          ompServiceTier={null}
          onOmpServiceTierChange={async () => {}}
          codexServiceTier={null}
          onCodexServiceTierChange={async () => {}}
        />,
      ));
      const rows = [...container.querySelectorAll<HTMLButtonElement>('button[role="radio"]')];
      expect(rows[0].textContent).toContain(models[0].label);
      expect(rows[0].textContent).toContain(models[0].description);
      expect(rows[1].textContent).toContain(models[1].label);
      act(() => rows[1].click());
      expect(onPickModel).toHaveBeenCalledWith("pi", models[1].id);
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it("窗口缩放及外层弹层平移后重新计算可用方向和宽度", async () => {
    const container = document.createElement("div");
    const popover = document.createElement("div");
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.appendChild(container);
    popover.appendChild(dialog);
    document.body.appendChild(popover);
    const root = createRoot(container);
    const bounds = vi.spyOn(container, "getBoundingClientRect").mockReturnValue({ left: 650, right: 906 } as DOMRect);
    const originalWidth = window.innerWidth;
    window.innerWidth = 1000;
    try {
      act(() => root.render(
        <EngineFlyout
          option={{ id: "pi", label: "PI" }} models={[]} selectedModelId=""
          query="" onQueryChange={() => {}} effort="medium"
          onPickModel={() => {}} onEffortChange={() => {}}
          ompServiceTier={null} onOmpServiceTierChange={async () => {}}
          codexServiceTier={null} onCodexServiceTierChange={async () => {}}
        />,
      ));
      const panel = container.querySelector<HTMLElement>("[data-engine-flyout]")!;
      expect(panel.classList.contains("right-full")).toBe(true);
      expect(panel.style.getPropertyValue("--flyout-max-width")).toBe("480px");
      bounds.mockReturnValue({ left: 16, right: 272 } as DOMRect);
      window.innerWidth = 768;
      act(() => window.dispatchEvent(new Event("resize")));
      expect(panel.classList.contains("left-full")).toBe(true);
      expect(panel.style.getPropertyValue("--flyout-max-width")).toBe("472px");
      // 外层只改变位置，没有 resize；模拟入口从短模型切到长模型。
      bounds.mockReturnValue({ left: 120, right: 376 } as DOMRect);
      await act(async () => { popover.style.left = "120px"; });
      expect(panel.style.getPropertyValue("--flyout-max-width")).toBe("368px");
    } finally {
      act(() => root.unmount());
      popover.remove();
      bounds.mockRestore();
      window.innerWidth = originalWidth;
    }
  });
});
