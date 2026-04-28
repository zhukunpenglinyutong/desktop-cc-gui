// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useNewAgentShortcut } from "./useNewAgentShortcut";

type HarnessProps = {
  shortcut: string | null;
  onTrigger: () => void;
};

function NewAgentShortcutHarness({ shortcut, onTrigger }: HarnessProps) {
  useNewAgentShortcut({
    isEnabled: true,
    shortcut,
    onTrigger,
  });
  return <input aria-label="editor" />;
}

afterEach(() => {
  cleanup();
});

describe("useNewAgentShortcut", () => {
  it("uses platform-aware matching and respects cleared settings", () => {
    const originalPlatform = window.navigator.platform;
    Object.defineProperty(window.navigator, "platform", {
      value: "Win32",
      configurable: true,
    });
    try {
      const onTrigger = vi.fn();
      const { rerender } = render(
        <NewAgentShortcutHarness shortcut="cmd+n" onTrigger={onTrigger} />,
      );

      fireEvent.keyDown(window, { key: "n", ctrlKey: true });
      expect(onTrigger).toHaveBeenCalledTimes(1);

      rerender(<NewAgentShortcutHarness shortcut={null} onTrigger={onTrigger} />);
      fireEvent.keyDown(window, { key: "n", ctrlKey: true });
      expect(onTrigger).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window.navigator, "platform", {
        value: originalPlatform,
        configurable: true,
      });
    }
  });

  it("does not steal shortcuts from editable targets", () => {
    const originalPlatform = window.navigator.platform;
    Object.defineProperty(window.navigator, "platform", {
      value: "Win32",
      configurable: true,
    });
    try {
      const onTrigger = vi.fn();
      const { getByLabelText } = render(
        <NewAgentShortcutHarness shortcut="cmd+n" onTrigger={onTrigger} />,
      );
      const input = getByLabelText("editor");
      input.focus();

      fireEvent.keyDown(input, { key: "n", ctrlKey: true });
      fireEvent.keyDown(window, { key: "n", ctrlKey: true });

      expect(onTrigger).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window.navigator, "platform", {
        value: originalPlatform,
        configurable: true,
      });
    }
  });
});
