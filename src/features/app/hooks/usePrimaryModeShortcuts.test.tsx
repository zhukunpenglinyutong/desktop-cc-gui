// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePrimaryModeShortcuts } from "./usePrimaryModeShortcuts";

type HarnessProps = {
  onOpenChat: () => void;
  onOpenKanban: () => void;
};

function ShortcutHarness({ onOpenChat, onOpenKanban }: HarnessProps) {
  usePrimaryModeShortcuts({
    isEnabled: true,
    openChatShortcut: "cmd+j",
    openKanbanShortcut: "cmd+k",
    onOpenChat,
    onOpenKanban,
  });
  return <input aria-label="editor" />;
}

afterEach(() => {
  cleanup();
});

describe("usePrimaryModeShortcuts", () => {
  it("triggers chat mode on Ctrl+J in Windows", () => {
    const originalPlatform = window.navigator.platform;
    Object.defineProperty(window.navigator, "platform", {
      value: "Win32",
      configurable: true,
    });
    try {
      const onOpenChat = vi.fn();
      const onOpenKanban = vi.fn();
      render(<ShortcutHarness onOpenChat={onOpenChat} onOpenKanban={onOpenKanban} />);
      fireEvent.keyDown(window, { key: "j", ctrlKey: true });
      expect(onOpenChat).toHaveBeenCalledTimes(1);
      expect(onOpenKanban).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window.navigator, "platform", {
        value: originalPlatform,
        configurable: true,
      });
    }
  });

  it("triggers kanban mode on Ctrl+K in Windows", () => {
    const originalPlatform = window.navigator.platform;
    Object.defineProperty(window.navigator, "platform", {
      value: "Win32",
      configurable: true,
    });
    try {
      const onOpenChat = vi.fn();
      const onOpenKanban = vi.fn();
      render(<ShortcutHarness onOpenChat={onOpenChat} onOpenKanban={onOpenKanban} />);
      fireEvent.keyDown(window, { key: "k", ctrlKey: true });
      expect(onOpenKanban).toHaveBeenCalledTimes(1);
      expect(onOpenChat).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window.navigator, "platform", {
        value: originalPlatform,
        configurable: true,
      });
    }
  });

  it("does not trigger while focus is in editable targets", () => {
    const originalPlatform = window.navigator.platform;
    Object.defineProperty(window.navigator, "platform", {
      value: "Win32",
      configurable: true,
    });
    try {
      const onOpenChat = vi.fn();
      const onOpenKanban = vi.fn();
      render(<ShortcutHarness onOpenChat={onOpenChat} onOpenKanban={onOpenKanban} />);
      const input = screen.getByLabelText("editor");
      input.focus();
      fireEvent.keyDown(input, { key: "j", ctrlKey: true });
      fireEvent.keyDown(input, { key: "k", ctrlKey: true });
      expect(onOpenChat).not.toHaveBeenCalled();
      expect(onOpenKanban).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window.navigator, "platform", {
        value: originalPlatform,
        configurable: true,
      });
    }
  });

  it("uses Cmd shortcuts on macOS", () => {
    const originalPlatform = window.navigator.platform;
    Object.defineProperty(window.navigator, "platform", {
      value: "MacIntel",
      configurable: true,
    });
    try {
      const onOpenChat = vi.fn();
      const onOpenKanban = vi.fn();
      render(<ShortcutHarness onOpenChat={onOpenChat} onOpenKanban={onOpenKanban} />);
      fireEvent.keyDown(window, { key: "j", ctrlKey: true });
      fireEvent.keyDown(window, { key: "k", ctrlKey: true });
      expect(onOpenChat).not.toHaveBeenCalled();
      expect(onOpenKanban).not.toHaveBeenCalled();

      fireEvent.keyDown(window, { key: "j", metaKey: true });
      fireEvent.keyDown(window, { key: "k", metaKey: true });
      expect(onOpenChat).toHaveBeenCalledTimes(1);
      expect(onOpenKanban).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window.navigator, "platform", {
        value: originalPlatform,
        configurable: true,
      });
    }
  });
});
