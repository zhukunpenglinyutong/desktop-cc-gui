import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  emitSessionActivated,
  pluginBus,
  resetPluginBusForTests,
  SESSION_ACTIVATED_TOPIC,
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
    expect(seen).toEqual([{ engine: "codex", sessionId: "s-1" }]);

    emitSessionActivated("claude", "s-2");
    expect(seen).toEqual([
      { engine: "codex", sessionId: "s-1" },
      { engine: "claude", sessionId: "s-2" },
    ]);
  });

  it("replays only the newest value, not the history", () => {
    emitSessionActivated("codex", "s-1");
    emitSessionActivated("claude", "s-2");

    const seen: unknown[] = [];
    pluginBus.on(SESSION_ACTIVATED_TOPIC, (data) => seen.push(data));

    expect(seen).toEqual([{ engine: "claude", sessionId: "s-2" }]);
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
