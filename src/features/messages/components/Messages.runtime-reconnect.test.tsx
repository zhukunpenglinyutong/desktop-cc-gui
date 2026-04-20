// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationItem } from "../../../types";
import { ensureRuntimeReady } from "../../../services/tauri";
import { Messages } from "./Messages";

vi.mock("../../../services/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../services/tauri")>();
  return {
    ...actual,
    ensureRuntimeReady: vi.fn(),
  };
});

describe("Messages runtime reconnect", () => {
  beforeAll(() => {
    if (!HTMLElement.prototype.scrollIntoView) {
      HTMLElement.prototype.scrollIntoView = vi.fn();
    }
    if (!HTMLElement.prototype.scrollTo) {
      HTMLElement.prototype.scrollTo = vi.fn();
    }
  });

  beforeEach(() => {
    window.localStorage.setItem("ccgui.claude.hideReasoningModule", "0");
    window.localStorage.removeItem("ccgui.messages.live.autoFollow");
    window.localStorage.removeItem("ccgui.messages.live.collapseMiddleSteps");
    vi.mocked(ensureRuntimeReady).mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  function renderMessages(items: ConversationItem[], options?: {
    threadId?: string;
    workspaceId?: string | null;
    onRecoverThreadRuntime?: (
      workspaceId: string,
      threadId: string,
    ) => Promise<string | null | void> | string | null | void;
    onRecoverThreadRuntimeAndResend?: (
      workspaceId: string,
      threadId: string,
      message: { text: string; images?: string[] },
    ) => Promise<string | null | void> | string | null | void;
  }) {
    return render(
      <Messages
        items={items}
        threadId={options?.threadId ?? "thread-runtime-reconnect"}
        workspaceId={
          options && Object.prototype.hasOwnProperty.call(options, "workspaceId")
            ? options.workspaceId
            : "ws-runtime"
        }
        isThinking={false}
        activeEngine="codex"
        onRecoverThreadRuntime={options?.onRecoverThreadRuntime}
        onRecoverThreadRuntimeAndResend={options?.onRecoverThreadRuntimeAndResend}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );
  }

  it("shows reconnect runtime recovery card for broken pipe errors and triggers ensureRuntimeReady", async () => {
    vi.mocked(ensureRuntimeReady).mockResolvedValue(undefined);
    const onRecoverThreadRuntime = vi.fn().mockResolvedValue("thread-runtime-reconnect");

    renderMessages([
      {
        id: "assistant-broken-pipe",
        kind: "message",
        role: "assistant",
        text: "Broken pipe (os error 32)",
      },
    ], {
      threadId: "thread-runtime-reconnect",
      onRecoverThreadRuntime,
    });

    expect(screen.getByRole("group", { name: "messages.runtimeReconnectTitle" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "messages.runtimeReconnectAction" }));

    await waitFor(() => {
      expect(vi.mocked(ensureRuntimeReady)).toHaveBeenCalledWith("ws-runtime");
    });
    expect(onRecoverThreadRuntime).toHaveBeenCalledWith("ws-runtime", "thread-runtime-reconnect");
  });

  it("shows a recover-specific error when runtime resumes but thread recovery returns null", async () => {
    vi.mocked(ensureRuntimeReady).mockResolvedValue(undefined);
    const onRecoverThreadRuntime = vi.fn().mockResolvedValue(null);

    renderMessages([
      {
        id: "assistant-broken-pipe-recover-null",
        kind: "message",
        role: "assistant",
        text: "Broken pipe (os error 32)",
      },
    ], {
      threadId: "thread-runtime-reconnect-null",
      onRecoverThreadRuntime,
    });

    fireEvent.click(screen.getByRole("button", { name: "messages.runtimeReconnectAction" }));

    await waitFor(() => {
      expect(vi.mocked(ensureRuntimeReady)).toHaveBeenCalledWith("ws-runtime");
    });
    expect(onRecoverThreadRuntime).toHaveBeenCalledWith("ws-runtime", "thread-runtime-reconnect-null");
    expect(screen.getByText("messages.runtimeReconnectFailed")).toBeTruthy();
    expect(screen.getByText("messages.runtimeReconnectRecoverFailed")).toBeTruthy();
  });

  it("dedupes repeated runtime reconnect cards and only renders the latest one", () => {
    renderMessages([
      {
        id: "assistant-broken-pipe-1",
        kind: "message",
        role: "assistant",
        text: "Broken pipe (os error 32)",
      },
      {
        id: "assistant-broken-pipe-2",
        kind: "message",
        role: "assistant",
        text: "Broken pipe (os error 32)",
      },
    ], {
      threadId: "thread-runtime-reconnect-dedupe",
    });

    expect(screen.getAllByRole("group", { name: "messages.runtimeReconnectTitle" })).toHaveLength(1);
  });

  it("keeps compatibility when no thread-level recovery callback is provided", async () => {
    vi.mocked(ensureRuntimeReady).mockResolvedValue(undefined);

    renderMessages([
      {
        id: "assistant-broken-pipe-compat",
        kind: "message",
        role: "assistant",
        text: "Broken pipe (os error 32)",
      },
    ], {
      threadId: "thread-runtime-reconnect-compat",
    });

    fireEvent.click(screen.getByRole("button", { name: "messages.runtimeReconnectAction" }));

    await waitFor(() => {
      expect(vi.mocked(ensureRuntimeReady)).toHaveBeenCalledWith("ws-runtime");
    });
  });

  it("shows reconnect runtime recovery card for Windows pipe disconnect errors", () => {
    renderMessages([
      {
        id: "assistant-windows-pipe",
        kind: "message",
        role: "assistant",
        text: "The pipe is being closed. (os error 232)",
      },
    ], {
      threadId: "thread-runtime-reconnect-windows",
    });

    expect(screen.getByRole("group", { name: "messages.runtimeReconnectTitle" })).toBeTruthy();
  });

  it("shows only the resend action for stale thread recovery cards", () => {
    const onRecoverThreadRuntimeAndResend = vi.fn().mockResolvedValue("thread-recovered");

    renderMessages([
      {
        id: "user-before-thread-not-found",
        kind: "message",
        role: "user",
        text: "继续",
      },
      {
        id: "assistant-thread-not-found",
        kind: "message",
        role: "assistant",
        text: "会话启动失败： thread not found: 019da207-c1ae-7cb3-9cb6-25f281fbfb30",
      },
    ], {
      threadId: "thread-runtime-stale",
      onRecoverThreadRuntimeAndResend,
    });

    expect(screen.getByRole("group", { name: "messages.threadRecoveryTitle" })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "messages.threadRecoveryAction" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "messages.threadRecoveryResendAction" }),
    ).toBeTruthy();
  });

  it("reacquires runtime before resending from a stale thread recovery card", async () => {
    vi.mocked(ensureRuntimeReady).mockResolvedValue(undefined);
    const onRecoverThreadRuntime = vi.fn().mockResolvedValue("thread-recovered-resend");
    const onRecoverThreadRuntimeAndResend = vi.fn().mockResolvedValue("thread-recovered-resend");

    renderMessages([
      {
        id: "user-before-thread-recovery-resend",
        kind: "message",
        role: "user",
        text: "继续",
      },
      {
        id: "assistant-thread-not-found-resend",
        kind: "message",
        role: "assistant",
        text: "会话启动失败： thread not found: 019da207-c1ae-7cb3-9cb6-25f281fbfb30",
      },
    ], {
      threadId: "thread-runtime-stale-resend",
      onRecoverThreadRuntime,
      onRecoverThreadRuntimeAndResend,
    });

    fireEvent.click(screen.getByRole("button", { name: "messages.threadRecoveryResendAction" }));

    await waitFor(() => {
      expect(vi.mocked(ensureRuntimeReady)).toHaveBeenCalledWith("ws-runtime");
      expect(onRecoverThreadRuntimeAndResend).toHaveBeenCalledWith(
        "ws-runtime",
        "thread-runtime-stale-resend",
        { text: "继续", images: undefined },
      );
    });
  });

  it("allows stale thread resend when only the resend recovery callback is available", async () => {
    vi.mocked(ensureRuntimeReady).mockResolvedValue(undefined);
    const onRecoverThreadRuntimeAndResend = vi.fn().mockResolvedValue("thread-recovered-resend-only");

    renderMessages([
      {
        id: "user-before-thread-recovery-resend-only",
        kind: "message",
        role: "user",
        text: "继续",
      },
      {
        id: "assistant-thread-not-found-resend-only",
        kind: "message",
        role: "assistant",
        text: "会话启动失败： thread not found: 019da207-c1ae-7cb3-9cb6-25f281fbfb30",
      },
    ], {
      threadId: "thread-runtime-stale-resend-only",
      onRecoverThreadRuntimeAndResend,
    });

    fireEvent.click(screen.getByRole("button", { name: "messages.threadRecoveryResendAction" }));

    await waitFor(() => {
      expect(vi.mocked(ensureRuntimeReady)).toHaveBeenCalledWith("ws-runtime");
      expect(onRecoverThreadRuntimeAndResend).toHaveBeenCalledWith(
        "ws-runtime",
        "thread-runtime-stale-resend-only",
        { text: "继续", images: undefined },
      );
    });
  });

  it("does not turn a normal assistant reply quoting broken pipe into a reconnect card", () => {
    renderMessages([
      {
        id: "assistant-broken-pipe-quoted",
        kind: "message",
        role: "assistant",
        text: "Broken pipe (os error 32)\n\n结论先行：这是 stale session，需要重建 runtime。",
      },
    ], {
      threadId: "thread-runtime-reconnect-quoted",
    });

    expect(screen.queryByRole("group", { name: "messages.runtimeReconnectTitle" })).toBeNull();
    expect(
      screen.getByText("结论先行：这是 stale session，需要重建 runtime。"),
    ).toBeTruthy();
  });

  it("shows unavailable hint when the message is not bound to a workspace runtime", () => {
    renderMessages([
      {
        id: "assistant-missing-workspace-runtime",
        kind: "message",
        role: "assistant",
        text: "workspace not connected",
      },
    ], {
      threadId: "thread-runtime-reconnect-unavailable",
      workspaceId: null,
    });

    expect(screen.getByText("messages.runtimeReconnectUnavailable")).toBeTruthy();
    expect(screen.getByRole("button", { name: "messages.runtimeReconnectAction" }).hasAttribute("disabled")).toBe(true);
  });

  it("reconnects and resends the previous prompt from the latest user message", async () => {
    vi.mocked(ensureRuntimeReady).mockResolvedValue(undefined);
    const onRecoverThreadRuntimeAndResend = vi.fn().mockResolvedValue("thread-runtime-resend");

    renderMessages([
      {
        id: "user-before-runtime-resend",
        kind: "message",
        role: "user",
        text: "完事没",
      },
      {
        id: "assistant-broken-pipe-resend",
        kind: "message",
        role: "assistant",
        text: "Broken pipe (os error 32)",
      },
    ], {
      threadId: "thread-runtime-resend",
      onRecoverThreadRuntimeAndResend,
    });

    fireEvent.click(screen.getByRole("button", { name: "messages.runtimeReconnectResendAction" }));

    await waitFor(() => {
      expect(vi.mocked(ensureRuntimeReady)).toHaveBeenCalledWith("ws-runtime");
    });
    expect(onRecoverThreadRuntimeAndResend).toHaveBeenCalledWith(
      "ws-runtime",
      "thread-runtime-resend",
      { text: "完事没", images: undefined },
    );
  });

  it("replays the nearest previous user prompt before the reconnect error", async () => {
    vi.mocked(ensureRuntimeReady).mockResolvedValue(undefined);
    const onRecoverThreadRuntimeAndResend = vi.fn().mockResolvedValue("thread-runtime-resend-nearest");

    renderMessages([
      {
        id: "user-before-runtime-resend-nearest",
        kind: "message",
        role: "user",
        text: "真正应该重发的是这句",
      },
      {
        id: "assistant-broken-pipe-resend-nearest",
        kind: "message",
        role: "assistant",
        text: "Broken pipe (os error 32)",
      },
      {
        id: "user-after-runtime-resend-nearest",
        kind: "message",
        role: "user",
        text: "这句是后来的，不该被重发",
      },
    ], {
      threadId: "thread-runtime-resend-nearest",
      onRecoverThreadRuntimeAndResend,
    });

    fireEvent.click(screen.getByRole("button", { name: "messages.runtimeReconnectResendAction" }));

    await waitFor(() => {
      expect(onRecoverThreadRuntimeAndResend).toHaveBeenCalledWith(
        "ws-runtime",
        "thread-runtime-resend-nearest",
        { text: "真正应该重发的是这句", images: undefined },
      );
    });
  });

  it("disables resend when there is no previous user prompt to replay", () => {
    renderMessages([
      {
        id: "assistant-broken-pipe-resend-unavailable",
        kind: "message",
        role: "assistant",
        text: "Broken pipe (os error 32)",
      },
    ], {
      threadId: "thread-runtime-resend-unavailable",
    });

    expect(screen.getByText("messages.runtimeReconnectResendUnavailable")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "messages.runtimeReconnectResendAction" }).hasAttribute("disabled"),
    ).toBe(true);
  });
});
