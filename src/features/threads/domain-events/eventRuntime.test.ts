import { describe, expect, it, vi } from "vitest";
import { domainEventFactories } from "./eventFactories";
import { createDomainEventRuntime, createDomainEventRuntimeController } from "./eventRuntime";

const event = domainEventFactories.turnStarted({
  occurredAt: "2026-05-20T00:00:00.000Z",
  workspaceId: "workspace-1",
  sessionId: "thread-1",
  engine: "codex",
  turnId: "turn-1",
});

describe("domain event runtime", () => {
  it("exposes subscribe-only public semantics with an internal emit hook", () => {
    const { runtime, emitInternal } = createDomainEventRuntimeController();
    const subscriber = vi.fn();
    const unsubscribe = runtime.subscribe(subscriber);

    emitInternal(event);
    unsubscribe();
    unsubscribe();
    emitInternal(event);

    expect(runtime.firstConsumer).toBe("governance-evidence-bridge");
    expect(subscriber).toHaveBeenCalledTimes(1);
    expect(subscriber).toHaveBeenCalledWith(event);
    expect("publish" in runtime).toBe(false);
    expect("emit" in runtime).toBe(false);
    expect("emitInternal" in runtime).toBe(false);
  });

  it("keeps application runtime consumers on a subscribe-only object", () => {
    const runtime = createDomainEventRuntime();

    expect(runtime.firstConsumer).toBe("governance-evidence-bridge");
    expect("publish" in runtime).toBe(false);
    expect("emit" in runtime).toBe(false);
    expect("emitInternal" in runtime).toBe(false);
  });

  it("does not write persistence or transport channels", () => {
    const { emitInternal } = createDomainEventRuntimeController();
    vi.stubGlobal("postMessage", vi.fn());
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const postMessageSpy = vi.mocked(globalThis.postMessage);

    emitInternal(event);

    expect(setItem).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(postMessageSpy).not.toHaveBeenCalled();

    setItem.mockRestore();
    fetchSpy.mockRestore();
    vi.unstubAllGlobals();
  });
});
