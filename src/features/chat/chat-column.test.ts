import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyChatColumnWidth,
  CHAT_COLUMN_DEFAULT,
  CHAT_COLUMN_KEY,
  CHAT_COLUMN_PRESETS,
  CHAT_COLUMN_VAR,
  readChatColumnWidth,
} from "./chat-column";

/** jsdom does not round-trip custom properties, so assert the write itself. */
function spyOnVarWrite() {
  return vi.spyOn(document.documentElement.style, "setProperty");
}

describe("chat column width", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to the 750px column", () => {
    expect(CHAT_COLUMN_DEFAULT).toBe(750);
    expect(readChatColumnWidth()).toBe(CHAT_COLUMN_DEFAULT);
  });

  it("persists a preset and writes the shared custom property", () => {
    const spy = spyOnVarWrite();
    applyChatColumnWidth(1200);
    expect(localStorage.getItem(CHAT_COLUMN_KEY)).toBe("1200");
    expect(spy).toHaveBeenCalledWith(CHAT_COLUMN_VAR, "1200px");
    expect(readChatColumnWidth()).toBe(1200);
    spy.mockRestore();
  });

  it("clears the cap when the column should fill its pane", () => {
    const spy = spyOnVarWrite();
    applyChatColumnWidth(0);
    expect(spy).toHaveBeenCalledWith(CHAT_COLUMN_VAR, "none");
    spy.mockRestore();
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
