import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Collapsible } from "./collapsible";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Collapsible visibility", () => {
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

  const render = (open: boolean) => {
    act(() =>
      root.render(
        <Collapsible open={open} seconds={0.15}>
          <span>content</span>
        </Collapsible>,
      ),
    );
    return container.firstElementChild as HTMLElement;
  };

  it("leaves visibility to the ancestor when open", () => {
    // Forcing `visible` here used to make content inside a hidden tab/surface
    // (visibility: hidden on the ancestor) keep painting.
    expect(render(true).style.visibility).toBe("");
    expect(container.textContent).toContain("content");
  });

  it("hides the collapsed content but keeps it mounted", () => {
    expect(render(false).style.visibility).toBe("hidden");
    expect(container.textContent).toContain("content");
  });
});
