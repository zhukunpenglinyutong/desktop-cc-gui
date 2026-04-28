// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAppSurfaceShortcuts } from "./useAppSurfaceShortcuts";

type HarnessProps = {
  isCompact?: boolean;
  rightPanelAvailable?: boolean;
  sidebarCollapsed?: boolean;
  rightPanelCollapsed?: boolean;
  onExpandSidebar?: () => void;
  onCollapseSidebar?: () => void;
  onExpandRightPanel?: () => void;
  onCollapseRightPanel?: () => void;
  onToggleRuntimeConsole?: () => void;
  onOpenFilesSurface?: () => void;
};

function SurfaceShortcutHarness({
  isCompact = false,
  rightPanelAvailable = true,
  sidebarCollapsed = false,
  rightPanelCollapsed = true,
  onExpandSidebar = vi.fn(),
  onCollapseSidebar = vi.fn(),
  onExpandRightPanel = vi.fn(),
  onCollapseRightPanel = vi.fn(),
  onToggleRuntimeConsole = vi.fn(),
  onOpenFilesSurface = vi.fn(),
}: HarnessProps) {
  useAppSurfaceShortcuts({
    isCompact,
    rightPanelAvailable,
    sidebarCollapsed,
    rightPanelCollapsed,
    toggleLeftConversationSidebarShortcut: "cmd+alt+[",
    toggleRightConversationSidebarShortcut: "cmd+alt+]",
    toggleRuntimeConsoleShortcut: "cmd+shift+`",
    toggleFilesSurfaceShortcut: "cmd+shift+e",
    onExpandSidebar,
    onCollapseSidebar,
    onExpandRightPanel,
    onCollapseRightPanel,
    onToggleRuntimeConsole,
    onOpenFilesSurface,
  });
  return <input aria-label="editor" />;
}

afterEach(() => {
  cleanup();
});

describe("useAppSurfaceShortcuts", () => {
  it("toggles runtime console and files surface from configured shortcuts", () => {
    const originalPlatform = window.navigator.platform;
    Object.defineProperty(window.navigator, "platform", {
      value: "Win32",
      configurable: true,
    });
    try {
      const onToggleRuntimeConsole = vi.fn();
      const onOpenFilesSurface = vi.fn();
      render(
        <SurfaceShortcutHarness
          onToggleRuntimeConsole={onToggleRuntimeConsole}
          onOpenFilesSurface={onOpenFilesSurface}
        />,
      );

      fireEvent.keyDown(window, { key: "`", ctrlKey: true, shiftKey: true });
      fireEvent.keyDown(window, { key: "e", ctrlKey: true, shiftKey: true });

      expect(onToggleRuntimeConsole).toHaveBeenCalledTimes(1);
      expect(onOpenFilesSurface).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window.navigator, "platform", {
        value: originalPlatform,
        configurable: true,
      });
    }
  });

  it("toggles sidebars while respecting compact and availability guards", () => {
    const originalPlatform = window.navigator.platform;
    Object.defineProperty(window.navigator, "platform", {
      value: "MacIntel",
      configurable: true,
    });
    try {
      const onCollapseSidebar = vi.fn();
      const onExpandRightPanel = vi.fn();
      const { rerender } = render(
        <SurfaceShortcutHarness
          onCollapseSidebar={onCollapseSidebar}
          onExpandRightPanel={onExpandRightPanel}
        />,
      );

      fireEvent.keyDown(window, { key: "[", metaKey: true, altKey: true });
      fireEvent.keyDown(window, { key: "]", metaKey: true, altKey: true });

      expect(onCollapseSidebar).toHaveBeenCalledTimes(1);
      expect(onExpandRightPanel).toHaveBeenCalledTimes(1);

      rerender(
        <SurfaceShortcutHarness
          isCompact
          onCollapseSidebar={onCollapseSidebar}
          onExpandRightPanel={onExpandRightPanel}
        />,
      );
      fireEvent.keyDown(window, { key: "[", metaKey: true, altKey: true });
      fireEvent.keyDown(window, { key: "]", metaKey: true, altKey: true });

      expect(onCollapseSidebar).toHaveBeenCalledTimes(1);
      expect(onExpandRightPanel).toHaveBeenCalledTimes(1);
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
      const onOpenFilesSurface = vi.fn();
      render(<SurfaceShortcutHarness onOpenFilesSurface={onOpenFilesSurface} />);
      const input = screen.getByLabelText("editor");
      input.focus();

      fireEvent.keyDown(input, { key: "e", ctrlKey: true, shiftKey: true });

      expect(onOpenFilesSurface).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window.navigator, "platform", {
        value: originalPlatform,
        configurable: true,
      });
    }
  });
});
