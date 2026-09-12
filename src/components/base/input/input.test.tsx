import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import "@/lib/i18n";
import { Input } from "./input";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Input password reveal", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("reveals the value when the eye is pressed", async () => {
    await act(async () => {
      root.render(<Input label="token" type="password" value="secret" onChange={() => {}} />);
    });
    const input = container.querySelector("input")!;
    expect(input.type).toBe("password");
    const eye = [...container.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === "显示明文",
    );
    expect(eye).toBeTruthy();
    await act(async () => {
      // jsdom has no PointerEvent constructor; the handler only reads the type.
      eye!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(input.type).toBe("text");
    expect(
      [...container.querySelectorAll("button")].some(
        (b) => b.getAttribute("aria-label") === "隐藏明文",
      ),
    ).toBe(true);
  });
});
