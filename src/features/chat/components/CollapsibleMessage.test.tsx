import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CollapsibleMessage } from "./CollapsibleMessage";

const actEnvironment = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no ResizeObserver and reports scrollHeight as 0; both are
// stubbed so the collapse threshold can be exercised.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function mockScrollHeight(px: number) {
  return vi
    .spyOn(HTMLElement.prototype, "scrollHeight", "get")
    .mockReturnValue(px);
}

describe("CollapsibleMessage", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const render = () =>
    act(() => {
      root.render(
        <CollapsibleMessage>
          <p>content</p>
        </CollapsibleMessage>,
      );
    });

  const toggle = () =>
    container.querySelector<HTMLButtonElement>("button[aria-expanded]");

  it("clamps tall content behind an expand affordance", () => {
    mockScrollHeight(600);
    render();

    const content = container.querySelector("p")!.parentElement!;
    expect(content.style.maxHeight).toBe("320px");
    expect(toggle()?.getAttribute("aria-expanded")).toBe("false");
  });

  it("expands on click and offers collapse again", () => {
    mockScrollHeight(600);
    render();

    act(() => toggle()!.click());
    const content = container.querySelector("p")!.parentElement!;
    expect(content.style.maxHeight).toBe("600px");
    expect(toggle()?.getAttribute("aria-expanded")).toBe("true");

    act(() => toggle()!.click());
    expect(content.style.maxHeight).toBe("320px");
  });

  it("leaves short content untouched", () => {
    mockScrollHeight(200);
    render();

    const content = container.querySelector("p")!.parentElement!;
    expect(content.style.maxHeight).toBe("");
    expect(toggle()).toBeNull();
  });

  it("fades into the bubble background", () => {
    mockScrollHeight(600);
    render();

    const fade = container.querySelector("[aria-hidden]")!;
    expect(fade.className).toContain("from-bubble-user");
  });
});
