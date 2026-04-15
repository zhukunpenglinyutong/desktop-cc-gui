import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  setSharedSessionSelectedEngine,
  sendSharedSessionMessage,
  registerSharedSessionNativeBinding,
  rebindSharedSessionNativeThread,
} = vi.hoisted(() => ({
  setSharedSessionSelectedEngine: vi.fn(),
  sendSharedSessionMessage: vi.fn(),
  registerSharedSessionNativeBinding: vi.fn(),
  rebindSharedSessionNativeThread: vi.fn(),
}));

vi.mock("../services/sharedSessions", () => ({
  setSharedSessionSelectedEngine,
  sendSharedSessionMessage,
}));

vi.mock("./sharedSessionBridge", () => ({
  registerSharedSessionNativeBinding,
  rebindSharedSessionNativeThread,
}));

import { sendSharedSessionTurn } from "./sendSharedSessionTurn";

describe("sendSharedSessionTurn", () => {
  beforeEach(() => {
    setSharedSessionSelectedEngine.mockReset();
    sendSharedSessionMessage.mockReset();
    registerSharedSessionNativeBinding.mockReset();
    rebindSharedSessionNativeThread.mockReset();
  });

  it("registers the selected native binding before sending the shared turn", async () => {
    rebindSharedSessionNativeThread.mockReturnValueOnce({
      workspaceId: "ws-1",
      sharedThreadId: "shared:thread-1",
      nativeThreadId: "codex-native-thread-1",
      engine: "codex",
    });
    setSharedSessionSelectedEngine.mockResolvedValue({
      nativeThreadId: "codex-pending-shared-1",
    });
    sendSharedSessionMessage.mockResolvedValue({
      nativeThreadId: "codex-native-thread-1",
    });

    await sendSharedSessionTurn({
      workspaceId: "ws-1",
      threadId: "shared:thread-1",
      engine: "codex",
      text: "hello",
      model: null,
      effort: null,
      images: [],
    });

    expect(registerSharedSessionNativeBinding).toHaveBeenNthCalledWith(1, {
      workspaceId: "ws-1",
      sharedThreadId: "shared:thread-1",
      nativeThreadId: "codex-pending-shared-1",
      engine: "codex",
    });
    expect(rebindSharedSessionNativeThread).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      oldNativeThreadId: "codex-pending-shared-1",
      newNativeThreadId: "codex-native-thread-1",
    });
    expect(registerSharedSessionNativeBinding).toHaveBeenCalledTimes(1);
    expect(registerSharedSessionNativeBinding).toHaveBeenNthCalledWith(1, {
      workspaceId: "ws-1",
      sharedThreadId: "shared:thread-1",
      nativeThreadId: "codex-pending-shared-1",
      engine: "codex",
    });
    expect(setSharedSessionSelectedEngine.mock.invocationCallOrder[0]).toBeLessThan(
      registerSharedSessionNativeBinding.mock.invocationCallOrder[0],
    );
    expect(registerSharedSessionNativeBinding.mock.invocationCallOrder[0]).toBeLessThan(
      sendSharedSessionMessage.mock.invocationCallOrder[0],
    );
  });

  it("updates the bridge when the send response finalizes a native thread id", async () => {
    rebindSharedSessionNativeThread.mockReturnValueOnce({
      workspaceId: "ws-2",
      sharedThreadId: "shared:thread-2",
      nativeThreadId: "claude:session-1",
      engine: "claude",
    });
    setSharedSessionSelectedEngine.mockResolvedValue({
      nativeThreadId: "claude-pending-shared-1",
    });
    sendSharedSessionMessage.mockResolvedValue({
      nativeThreadId: "claude:session-1",
    });

    await sendSharedSessionTurn({
      workspaceId: "ws-2",
      threadId: "shared:thread-2",
      engine: "claude",
      text: "hello",
      model: null,
      effort: null,
      images: [],
    });

    expect(registerSharedSessionNativeBinding).toHaveBeenNthCalledWith(1, {
      workspaceId: "ws-2",
      sharedThreadId: "shared:thread-2",
      nativeThreadId: "claude-pending-shared-1",
      engine: "claude",
    });
    expect(rebindSharedSessionNativeThread).toHaveBeenCalledWith({
      workspaceId: "ws-2",
      oldNativeThreadId: "claude-pending-shared-1",
      newNativeThreadId: "claude:session-1",
    });
    expect(registerSharedSessionNativeBinding).toHaveBeenCalledTimes(1);
  });
});
