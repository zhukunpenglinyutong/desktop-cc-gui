import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  emitSessionActivated,
  emitSessionSelectionChanged,
  pluginBus,
  resetPluginBusForTests,
  SESSION_ACTIVATED_TOPIC,
  SESSION_SELECTION_CHANGED_TOPIC,
  USAGE_UPDATED_TOPIC,
} from "./events";

describe("pluginBus retained topics", () => {
  beforeEach(() => resetPluginBusForTests());

  it("replays the latest active session to a late subscriber", () => {
    // 宿主在应用启动、插件还没加载完时就发过事件
    emitSessionActivated("codex", "s-1");

    const seen: unknown[] = [];
    pluginBus.on(SESSION_ACTIVATED_TOPIC, (data) => seen.push(data));

    // 迟到的订阅者立刻拿到当前值
    expect(seen).toEqual([
      { engine: "codex", sessionId: "s-1", provider: null, model: null },
    ]);

    emitSessionActivated("claude", "s-2");
    expect(seen).toEqual([
      { engine: "codex", sessionId: "s-1", provider: null, model: null },
      { engine: "claude", sessionId: "s-2", provider: null, model: null },
    ]);
  });

  it("replays only the newest value, not the history", () => {
    emitSessionActivated("codex", "s-1");
    emitSessionActivated("claude", "s-2");

    const seen: unknown[] = [];
    pluginBus.on(SESSION_ACTIVATED_TOPIC, (data) => seen.push(data));

    expect(seen).toEqual([
      { engine: "claude", sessionId: "s-2", provider: null, model: null },
    ]);
  });

  it("delivers nothing before the first emit", () => {
    const listener = vi.fn();
    pluginBus.on(SESSION_ACTIVATED_TOPIC, listener);
    expect(listener).not.toHaveBeenCalled();
  });

  it("keeps other topics fire-and-forget", () => {
    const late = vi.fn();
    pluginBus.emit(USAGE_UPDATED_TOPIC, { kind: "usage" });
    pluginBus.on(USAGE_UPDATED_TOPIC, late);
    expect(late).not.toHaveBeenCalled();

    const live = vi.fn();
    pluginBus.on(USAGE_UPDATED_TOPIC, live);
    pluginBus.emit(USAGE_UPDATED_TOPIC, { kind: "usage", seq: 2 });
    expect(live).toHaveBeenCalledTimes(1);
  });

  it("stops delivering after the disposer runs", () => {
    emitSessionActivated("codex", "s-1");
    const listener = vi.fn();
    const dispose = pluginBus.on(SESSION_ACTIVATED_TOPIC, listener);
    expect(listener).toHaveBeenCalledTimes(1);

    dispose();
    emitSessionActivated("claude", "s-2");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("isolates a throwing retained listener", () => {
    emitSessionActivated("codex", "s-1");
    const good = vi.fn();
    expect(() =>
      pluginBus.on(SESSION_ACTIVATED_TOPIC, () => {
        throw new Error("boom");
      }),
    ).not.toThrow();
    pluginBus.on(SESSION_ACTIVATED_TOPIC, good);
    expect(good).toHaveBeenCalledTimes(1);
  });
});

describe("session selection", () => {
  beforeEach(() => resetPluginBusForTests());

  it("carries provider and model on activation", () => {
    emitSessionActivated("pi", "s-1", {
      provider: null,
      model: "deepseek/deepseek-flash",
    });

    const seen: unknown[] = [];
    pluginBus.on(SESSION_ACTIVATED_TOPIC, (data) => seen.push(data));

    expect(seen).toEqual([
      {
        engine: "pi",
        sessionId: "s-1",
        provider: null,
        model: "deepseek/deepseek-flash",
      },
    ]);
  });

  it("delivers selection changes live and keeps the retained activation current", () => {
    emitSessionActivated("pi", "s-1", {
      provider: null,
      model: "deepseek/deepseek-flash",
    });

    const live: unknown[] = [];
    pluginBus.on(SESSION_SELECTION_CHANGED_TOPIC, (data) => live.push(data));
    emitSessionSelectionChanged("pi", "s-1", {
      provider: null,
      model: "deepseek/deepseek-v4-pro",
    });

    expect(live).toEqual([
      {
        engine: "pi",
        sessionId: "s-1",
        provider: null,
        model: "deepseek/deepseek-v4-pro",
      },
    ]);

    // A plugin loading after the change still replays the current selection.
    const replay: unknown[] = [];
    pluginBus.on(SESSION_ACTIVATED_TOPIC, (data) => replay.push(data));
    expect(replay).toEqual(live);
  });

  it("does not rewrite the retained activation for another session", () => {
    emitSessionActivated("codex", "s-1");
    emitSessionSelectionChanged("pi", "s-2", {
      provider: "channel-1",
      model: "deepseek/deepseek-flash",
    });

    const replay: unknown[] = [];
    pluginBus.on(SESSION_ACTIVATED_TOPIC, (data) => replay.push(data));

    expect(replay).toEqual([
      { engine: "codex", sessionId: "s-1", provider: null, model: null },
    ]);
  });

  it("keeps selection changes fire-and-forget for late subscribers", () => {
    emitSessionSelectionChanged("pi", "s-1", { provider: null, model: "m" });

    const late = vi.fn();
    pluginBus.on(SESSION_SELECTION_CHANGED_TOPIC, late);

    expect(late).not.toHaveBeenCalled();
  });
});
