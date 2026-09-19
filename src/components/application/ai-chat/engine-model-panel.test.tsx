import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import "@/lib/i18n";
import i18n from "@/lib/i18n";
import { EngineModelPanel } from "./engine-model-panel";

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
});
