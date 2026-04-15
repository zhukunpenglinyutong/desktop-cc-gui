import { describe, expect, it } from "vitest";
import {
  clearSharedSessionBindingsForSharedThread,
  registerSharedSessionNativeBinding,
  rebindSharedSessionNativeThread,
  resolvePendingSharedSessionBindingForEngine,
  resolveSharedSessionBindingByNativeThread,
} from "./sharedSessionBridge";

describe("sharedSessionBridge", () => {
  it("registers and resolves native thread bindings for shared sessions", () => {
    registerSharedSessionNativeBinding({
      workspaceId: "ws-1",
      sharedThreadId: "shared:thread-1",
      nativeThreadId: "claude-pending-shared-1",
      engine: "claude",
    });

    expect(
      resolveSharedSessionBindingByNativeThread("ws-1", "claude-pending-shared-1"),
    ).toEqual({
      workspaceId: "ws-1",
      sharedThreadId: "shared:thread-1",
      nativeThreadId: "claude-pending-shared-1",
      engine: "claude",
    });

    clearSharedSessionBindingsForSharedThread("ws-1", "shared:thread-1");
  });

  it("rebinds pending native thread ids to finalized session ids", () => {
    registerSharedSessionNativeBinding({
      workspaceId: "ws-2",
      sharedThreadId: "shared:thread-2",
      nativeThreadId: "claude-pending-shared-1",
      engine: "claude",
    });

    const rebound = rebindSharedSessionNativeThread({
      workspaceId: "ws-2",
      oldNativeThreadId: "claude-pending-shared-1",
      newNativeThreadId: "claude:session-1",
    });

    expect(rebound?.nativeThreadId).toBe("claude:session-1");
    expect(
      resolveSharedSessionBindingByNativeThread("ws-2", "claude:session-1")?.sharedThreadId,
    ).toBe("shared:thread-2");
    expect(resolveSharedSessionBindingByNativeThread("ws-2", "claude-pending-shared-1")).toBeNull();

    clearSharedSessionBindingsForSharedThread("ws-2", "shared:thread-2");
  });

  it("resolves a unique pending binding for engine-level shared routing", () => {
    registerSharedSessionNativeBinding({
      workspaceId: "ws-3",
      sharedThreadId: "shared:thread-3",
      nativeThreadId: "codex-pending-shared-3",
      engine: "codex",
    });
    expect(
      resolvePendingSharedSessionBindingForEngine("ws-3", "codex")?.sharedThreadId,
    ).toBe("shared:thread-3");
    clearSharedSessionBindingsForSharedThread("ws-3", "shared:thread-3");
  });

  it("requires pending binding match to be unique", () => {
    registerSharedSessionNativeBinding({
      workspaceId: "ws-4",
      sharedThreadId: "shared:thread-4a",
      nativeThreadId: "codex-pending-shared-4a",
      engine: "codex",
    });
    registerSharedSessionNativeBinding({
      workspaceId: "ws-4",
      sharedThreadId: "shared:thread-4b",
      nativeThreadId: "codex-pending-shared-4b",
      engine: "codex",
    });
    expect(resolvePendingSharedSessionBindingForEngine("ws-4", "codex")).toBeNull();
    clearSharedSessionBindingsForSharedThread("ws-4", "shared:thread-4a");
    clearSharedSessionBindingsForSharedThread("ws-4", "shared:thread-4b");
  });

  it("ignores stale pending bindings when resolving by engine", () => {
    const now = Date.now();
    registerSharedSessionNativeBinding({
      workspaceId: "ws-5",
      sharedThreadId: "shared:thread-5",
      nativeThreadId: "codex-pending-shared-5",
      engine: "codex",
      registeredAtMs: now - 31_000,
    });
    expect(resolvePendingSharedSessionBindingForEngine("ws-5", "codex")).toBeNull();
    clearSharedSessionBindingsForSharedThread("ws-5", "shared:thread-5");
  });
});
