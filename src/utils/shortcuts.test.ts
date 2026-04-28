import { describe, expect, it } from "vitest";
import { formatShortcutForPlatform, matchesShortcutForPlatform } from "./shortcuts";

describe("formatShortcutForPlatform", () => {
  it("formats shortcuts with symbols on mac", () => {
    expect(formatShortcutForPlatform("cmd+o", true)).toBe("⌘O");
    expect(formatShortcutForPlatform("cmd+shift+arrowdown", true)).toBe("⌘⇧↓");
  });

  it("formats shortcuts with text labels on non-mac platforms", () => {
    expect(formatShortcutForPlatform("cmd+o", false)).toBe("Ctrl+O");
    expect(formatShortcutForPlatform("cmd+shift+arrowdown", false)).toBe("Ctrl+Shift+Down");
    expect(formatShortcutForPlatform("cmd+ctrl+a", false)).toBe("Meta+Ctrl+A");
  });
});

describe("matchesShortcutForPlatform", () => {
  it("does not collapse Cmd+Ctrl shortcuts into Ctrl-only on non-mac platforms", () => {
    const event = {
      key: "a",
      metaKey: false,
      ctrlKey: true,
      altKey: false,
      shiftKey: false,
    } as KeyboardEvent;
    const ctrlMetaEvent = {
      ...event,
      metaKey: true,
    } as KeyboardEvent;

    expect(matchesShortcutForPlatform(event, "cmd+ctrl+a", false)).toBe(false);
    expect(matchesShortcutForPlatform(ctrlMetaEvent, "cmd+ctrl+a", false)).toBe(true);
    expect(matchesShortcutForPlatform(event, "cmd+a", false)).toBe(true);
  });

  it("matches shifted punctuation keys for configured shortcuts", () => {
    expect(
      matchesShortcutForPlatform(
        {
          key: "{",
          metaKey: true,
          ctrlKey: false,
          altKey: false,
          shiftKey: true,
        } as KeyboardEvent,
        "cmd+shift+[",
        true,
      ),
    ).toBe(true);
    expect(
      matchesShortcutForPlatform(
        {
          key: "~",
          metaKey: true,
          ctrlKey: false,
          altKey: false,
          shiftKey: true,
        } as KeyboardEvent,
        "cmd+shift+`",
        true,
      ),
    ).toBe(true);
    expect(
      matchesShortcutForPlatform(
        {
          key: "+",
          metaKey: true,
          ctrlKey: false,
          altKey: false,
          shiftKey: true,
        } as KeyboardEvent,
        "cmd+=",
        true,
      ),
    ).toBe(true);
  });
});
