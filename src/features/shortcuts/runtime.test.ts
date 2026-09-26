import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ipc", () => ({
  ipc: { getAppSettings: vi.fn(async () => ({})) },
}));
vi.mock("@/lib/events", () => ({
  listenSettingsChanged: vi.fn(async () => () => {}),
}));

import { defaultShortcutFor, resolveShortcut, shortcutActions } from "./actions";
import { registerShortcutHandler, startShortcutRuntime } from "./runtime";
import { useShortcutsStore } from "./store";

const action = (id: string) => {
  const found = shortcutActions.find((a) => a.id === id);
  if (!found) throw new Error(`unknown action ${id}`);
  return found;
};
const originalPlatform = window.navigator.platform;
afterAll(() => {
  Object.defineProperty(window.navigator, "platform", {
    value: originalPlatform,
    configurable: true,
  });
});

function pressKey(
  key: string,
  modifiers: { meta?: boolean; ctrl?: boolean; shift?: boolean } = {},
  target: EventTarget = window,
) {
  const event = new KeyboardEvent("keydown", {
    key,
    metaKey: modifiers.meta ?? false,
    ctrlKey: modifiers.ctrl ?? false,
    shiftKey: modifiers.shift ?? false,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

describe("resolveShortcut", () => {
  it("falls back to the default when the setting is absent", () => {
    expect(resolveShortcut(action("newSession"), {})).toBe("cmd+n");
  });

  it("treats an empty string as explicitly unbound", () => {
    expect(
      resolveShortcut(action("newSession"), { newSessionShortcut: "" }),
    ).toBeNull();
  });

  it("prefers the configured value over the default", () => {
    expect(
      resolveShortcut(action("newSession"), { newSessionShortcut: "cmd+alt+n" }),
    ).toBe("cmd+alt+n");
  });

  it("resolves the platform interrupt default", () => {
    expect(defaultShortcutFor(action("interrupt"))).toMatch(/^ctrl\+(shift\+)?c$/);
  });
});

describe("shortcut runtime dispatch", () => {
  beforeEach(() => {
    useShortcutsStore.setState({ values: {} });
    // Dispatch resolves defaults per-platform; pin macOS so cmd = metaKey.
    Object.defineProperty(window.navigator, "platform", {
      value: "MacIntel",
      configurable: true,
    });
  });

  it("runs the registered handler on the default key and prevents default", () => {
    const stop = startShortcutRuntime();
    const spy = vi.fn();
    const unregister = registerShortcutHandler("commandPalette", spy);
    const event = pressKey("k", { meta: true });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    unregister();
    stop();
  });

  it("does not fire an explicitly unbound (cleared) action", () => {
    const stop = startShortcutRuntime();
    useShortcutsStore.setState({ values: { commandPaletteShortcut: "" } });
    const spy = vi.fn();
    const unregister = registerShortcutHandler("commandPalette", spy);
    pressKey("k", { meta: true });
    expect(spy).not.toHaveBeenCalled();
    unregister();
    stop();
  });

  it("hot-reloads rebound keys from the store", () => {
    const stop = startShortcutRuntime();
    useShortcutsStore.setState({
      values: { commandPaletteShortcut: "cmd+shift+p" },
    });
    const spy = vi.fn();
    const unregister = registerShortcutHandler("commandPalette", spy);
    pressKey("k", { meta: true });
    expect(spy).not.toHaveBeenCalled();
    pressKey("p", { meta: true, shift: true });
    expect(spy).toHaveBeenCalledTimes(1);
    unregister();
    stop();
  });

  it("does not steal the interrupt shortcut from editable targets", () => {
    const stop = startShortcutRuntime();
    const spy = vi.fn();
    const unregister = registerShortcutHandler("interrupt", spy);
    const input = document.createElement("input");
    document.body.appendChild(input);
    pressKey("c", { ctrl: true }, input);
    expect(spy).not.toHaveBeenCalled();
    pressKey("c", { ctrl: true });
    expect(spy).toHaveBeenCalledTimes(1);
    input.remove();
    unregister();
    stop();
  });

  it("ignores the bare keydown Event Chromium fires when a datalist option is picked", () => {
    // WebFormControlElement::SetAutofillValue dispatches Event("keydown") on
    // the field (no key, no modifiers) before filling in the picked value.
    const stop = startShortcutRuntime();
    const errors: unknown[] = [];
    const onError = (event: ErrorEvent) => errors.push(event.error);
    window.addEventListener("error", onError);
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.dispatchEvent(new Event("keydown", { bubbles: true }));
    window.removeEventListener("error", onError);
    expect(errors).toEqual([]);
    input.remove();
    stop();
  });
});
