import { beforeEach, describe, expect, it } from "vitest";
import {
  applyChatColumnWidth,
  centerColumnClass,
  CHAT_COLUMN_DEFAULT,
  CHAT_COLUMN_KEY,
  CHAT_COLUMN_PRESETS,
  CHAT_COLUMN_VAR,
  readChatColumnWidth,
  timelineColumnClass,
} from "./chat-column";

const columnVar = () => document.documentElement.style.getPropertyValue(CHAT_COLUMN_VAR);

describe("chat column width", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.style.removeProperty(CHAT_COLUMN_VAR);
  });

  it("defaults to the 750px column", () => {
    expect(CHAT_COLUMN_DEFAULT).toBe(750);
    expect(readChatColumnWidth()).toBe(CHAT_COLUMN_DEFAULT);
  });

  it("persists a preset and writes the shared custom property", () => {
    applyChatColumnWidth(1200);
    expect(localStorage.getItem(CHAT_COLUMN_KEY)).toBe("1200");
    expect(columnVar()).toBe("1200px");
    expect(readChatColumnWidth()).toBe(1200);
  });

  it("clears the cap when the column should fill its pane", () => {
    applyChatColumnWidth(0);
    expect(columnVar()).toBe("none");
  });

  // The default must not pin the composer track to 750px: unset, the
  // timeline falls back to 750px and the composer track to 48rem (768px).
  it("leaves the property unset for the default preset", () => {
    applyChatColumnWidth(960);
    applyChatColumnWidth(CHAT_COLUMN_DEFAULT);
    expect(columnVar()).toBe("");
    expect(timelineColumnClass(false)).toContain("max-w-[var(--chat-column-max-width,750px)]");
    expect(centerColumnClass(false)).toContain("max-w-[var(--chat-column-max-width,48rem)]");
  });

  // 「宽幕布」 wins by dropping the classes that read the property, so a stored
  // preset cannot cap the wide column, and no generic utility class reads it.
  it("keeps the property off the wide column and off generic utilities", () => {
    for (const wide of [timelineColumnClass(true), centerColumnClass(true)]) {
      expect(wide).not.toContain(CHAT_COLUMN_VAR);
    }
    for (const narrow of [timelineColumnClass(false), centerColumnClass(false)]) {
      expect(narrow).not.toMatch(/(^|\s)max-w-(3xl|\[750px\])(\s|$)/);
    }
  });

  it("falls back to the default for values outside the presets", () => {
    localStorage.setItem(CHAT_COLUMN_KEY, "9999");
    expect(readChatColumnWidth()).toBe(CHAT_COLUMN_DEFAULT);

    applyChatColumnWidth(9999);
    expect(localStorage.getItem(CHAT_COLUMN_KEY)).toBe(String(CHAT_COLUMN_DEFAULT));
  });

  it("keeps every preset reachable through a round trip", () => {
    for (const preset of CHAT_COLUMN_PRESETS) {
      applyChatColumnWidth(preset);
      expect(readChatColumnWidth()).toBe(preset);
    }
  });
});
