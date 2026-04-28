// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useGlobalSearchShortcut } from "./useGlobalSearchShortcut";

type HarnessProps = {
  shortcut: string | null;
  onTrigger: () => void;
};

function GlobalSearchShortcutHarness({ shortcut, onTrigger }: HarnessProps) {
  useGlobalSearchShortcut({
    isEnabled: true,
    shortcut,
    onTrigger,
  });
  return <input aria-label="editor" />;
}

afterEach(() => {
  cleanup();
});

describe("useGlobalSearchShortcut", () => {
  it("uses only the configured shortcut and respects cleared settings", () => {
    const originalPlatform = window.navigator.platform;
    Object.defineProperty(window.navigator, "platform", {
      value: "Win32",
      configurable: true,
    });
    try {
      const onTrigger = vi.fn();
      const { rerender } = render(
        <GlobalSearchShortcutHarness shortcut="cmd+o" onTrigger={onTrigger} />,
      );

      fireEvent.keyDown(window, { key: "o", ctrlKey: true });
      fireEvent.keyDown(window, { key: "f", ctrlKey: true });
      expect(onTrigger).toHaveBeenCalledTimes(1);

      rerender(<GlobalSearchShortcutHarness shortcut={null} onTrigger={onTrigger} />);
      fireEvent.keyDown(window, { key: "o", ctrlKey: true });
      expect(onTrigger).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window.navigator, "platform", {
        value: originalPlatform,
        configurable: true,
      });
    }
  });

  it("does not steal configured shortcut from editable targets", () => {
    const originalPlatform = window.navigator.platform;
    Object.defineProperty(window.navigator, "platform", {
      value: "Win32",
      configurable: true,
    });
    try {
      const onTrigger = vi.fn();
      const { getByLabelText } = render(
        <GlobalSearchShortcutHarness shortcut="cmd+o" onTrigger={onTrigger} />,
      );
      const input = getByLabelText("editor");
      input.focus();

      fireEvent.keyDown(input, { key: "o", ctrlKey: true });
      fireEvent.keyDown(window, { key: "o", ctrlKey: true });

      expect(onTrigger).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window.navigator, "platform", {
        value: originalPlatform,
        configurable: true,
      });
    }
  });
});
