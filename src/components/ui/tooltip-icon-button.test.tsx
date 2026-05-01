// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipIconButton } from "./tooltip-icon-button";

function renderTooltipButton(props: Partial<Parameters<typeof TooltipIconButton>[0]> = {}) {
  render(
    <TooltipIconButton label="Hide right sidebar" {...props}>
      <span aria-hidden>icon</span>
    </TooltipIconButton>,
  );

  return screen.getByRole("button", { name: props["aria-label"] ?? "Hide right sidebar" });
}

async function openTooltip(button: HTMLElement) {
  await act(async () => {
    fireEvent.mouseEnter(button);
    await vi.advanceTimersByTimeAsync(250);
  });
}

describe("TooltipIconButton", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("does not create a native title tooltip by default", () => {
    const button = renderTooltipButton();

    expect(button.getAttribute("aria-label")).toBe("Hide right sidebar");
    expect(button.getAttribute("title")).toBeNull();
  });

  it("preserves an explicit title when a caller provides one", () => {
    const button = renderTooltipButton({ title: "Native fallback" });

    expect(button.getAttribute("title")).toBe("Native fallback");
  });

  it("closes the custom tooltip when the trigger is clicked", async () => {
    const onClick = vi.fn();
    const button = renderTooltipButton({ onClick });

    await openTooltip(button);
    expect(screen.getByRole("tooltip").textContent).toContain("Hide right sidebar");

    await act(async () => {
      fireEvent.click(button);
    });

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("closes the custom tooltip when the window loses focus", async () => {
    const button = renderTooltipButton();

    await openTooltip(button);
    expect(screen.getByRole("tooltip").textContent).toContain("Hide right sidebar");

    await act(async () => {
      window.dispatchEvent(new Event("blur"));
    });

    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("closes the custom tooltip when the pointer interaction is cancelled", async () => {
    const button = renderTooltipButton();

    await openTooltip(button);
    expect(screen.getByRole("tooltip").textContent).toContain("Hide right sidebar");

    await act(async () => {
      fireEvent.pointerCancel(button);
    });

    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
