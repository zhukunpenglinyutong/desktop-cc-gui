import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentClaudeConfig: vi.fn(),
  appendRendererDiagnostic: vi.fn(),
  isWindowsPlatform: vi.fn(),
  isMacPlatform: vi.fn(),
}));

vi.mock("../../../services/tauri", () => ({
  getCurrentClaudeConfig: mocks.getCurrentClaudeConfig,
}));

vi.mock("../../../services/rendererDiagnostics", () => ({
  appendRendererDiagnostic: mocks.appendRendererDiagnostic,
}));

vi.mock("../../../utils/platform", () => ({
  isWindowsPlatform: mocks.isWindowsPlatform,
  isMacPlatform: mocks.isMacPlatform,
}));

import {
  completeThreadStreamTurn,
  getThreadStreamLatencySnapshot,
  noteThreadDeltaReceived,
  noteThreadTurnStarted,
  noteThreadVisibleTextRendered,
  noteThreadVisibleRender,
  primeThreadStreamLatencyContext,
  reportThreadVisibleOutputStallAfterFirstDelta,
  reportThreadUpstreamPending,
  resetThreadStreamLatencyDiagnosticsForTests,
  resolveActiveThreadStreamMitigation,
} from "./streamLatencyDiagnostics";

describe("streamLatencyDiagnostics", () => {
  beforeEach(() => {
    mocks.getCurrentClaudeConfig.mockReset();
    mocks.appendRendererDiagnostic.mockReset();
    mocks.isWindowsPlatform.mockReset();
    mocks.isMacPlatform.mockReset();
    mocks.isWindowsPlatform.mockReturnValue(false);
    mocks.isMacPlatform.mockReturnValue(false);
    resetThreadStreamLatencyDiagnosticsForTests();
  });

  afterEach(() => {
    resetThreadStreamLatencyDiagnosticsForTests();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("activates the Qwen Windows mitigation only after render amplification evidence appears", async () => {
    mocks.isWindowsPlatform.mockReturnValue(true);
    mocks.getCurrentClaudeConfig.mockResolvedValue({
      apiKey: "",
      baseUrl: "https://dashscope.aliyuncs.com/apps/anthropic",
      providerId: "qwen",
      providerName: "Qwen",
    });

    await primeThreadStreamLatencyContext({
      workspaceId: "ws-1",
      threadId: "thread-1",
      engine: "claude",
      model: "qwen3.6-plus",
    });

    noteThreadTurnStarted({
      workspaceId: "ws-1",
      threadId: "thread-1",
      turnId: "turn-1",
      startedAt: 1_000,
    });
    noteThreadDeltaReceived("thread-1", 1_100);
    noteThreadVisibleRender("thread-1", {
      visibleItemCount: 2,
      renderAt: 1_340,
    });

    const snapshot = getThreadStreamLatencySnapshot("thread-1");
    const mitigation = resolveActiveThreadStreamMitigation(snapshot);

    expect(snapshot?.latencyCategory).toBe("render-amplification");
    expect(snapshot?.firstVisibleRenderAfterDeltaMs).toBe(240);
    expect(mitigation?.id).toBe("claude-qwen-windows-render-safe");
    expect(mitigation?.messageStreamingThrottleMs).toBe(120);
    expect(mitigation?.reasoningStreamingThrottleMs).toBe(260);
    expect(mocks.appendRendererDiagnostic).toHaveBeenCalledWith(
      "stream-latency/mitigation-activated",
      expect.objectContaining({
        providerId: "qwen",
        model: "qwen3.6-plus",
        platform: "windows",
        latencyCategory: "render-amplification",
      }),
    );
  });

  it("activates native Claude Windows mitigation from render evidence without a Qwen/provider fingerprint", async () => {
    mocks.isWindowsPlatform.mockReturnValue(true);
    mocks.getCurrentClaudeConfig.mockResolvedValue({
      apiKey: "",
      baseUrl: "https://api.anthropic.test",
      providerId: "custom",
      providerName: "Custom Provider",
    });

    await primeThreadStreamLatencyContext({
      workspaceId: "ws-1",
      threadId: "thread-2",
      engine: "claude",
      model: "claude-sonnet-4.5",
    });

    noteThreadTurnStarted({
      workspaceId: "ws-1",
      threadId: "thread-2",
      turnId: "turn-2",
      startedAt: 2_000,
    });
    noteThreadDeltaReceived("thread-2", 2_120);
    noteThreadVisibleRender("thread-2", {
      visibleItemCount: 2,
      renderAt: 2_360,
    });

    const snapshot = getThreadStreamLatencySnapshot("thread-2");
    const mitigation = resolveActiveThreadStreamMitigation(snapshot);

    expect(snapshot?.latencyCategory).toBe("render-amplification");
    expect(snapshot?.candidateMitigationProfile).toBe("claude-windows-visible-stream");
    expect(snapshot?.candidateMitigationReason).toBe("first-delta-visible-stream-candidate");
    expect(snapshot?.mitigationProfile).toBe("claude-windows-visible-stream");
    expect(snapshot?.mitigationReason).toBe("render-lag-after-first-delta");
    expect(mitigation?.id).toBe("claude-windows-visible-stream");
    expect(mitigation?.renderPlainTextWhileStreaming).toBe(true);
    expect(mocks.appendRendererDiagnostic).toHaveBeenCalledWith(
      "stream-latency/render-amplification",
      expect.objectContaining({
        mitigationEligible: true,
        providerMitigationEligible: false,
      }),
    );
  });

  it("classifies visible output stall after first delta independent of provider/model", async () => {
    mocks.isWindowsPlatform.mockReturnValue(true);
    mocks.getCurrentClaudeConfig.mockResolvedValue({
      apiKey: "",
      baseUrl: "https://api.anthropic.test",
      providerId: "custom",
      providerName: "Custom Provider",
    });

    await primeThreadStreamLatencyContext({
      workspaceId: "ws-1",
      threadId: "thread-visible-stall",
      engine: "claude",
      model: "claude-sonnet-4.5",
    });

    noteThreadTurnStarted({
      workspaceId: "ws-1",
      threadId: "thread-visible-stall",
      turnId: "turn-visible-stall",
      startedAt: 4_000,
    });
    noteThreadDeltaReceived("thread-visible-stall", 4_050);
    noteThreadVisibleTextRendered("thread-visible-stall", {
      itemId: "assistant-visible-stall",
      visibleTextLength: 2,
      renderAt: 4_070,
    });
    noteThreadDeltaReceived("thread-visible-stall", 4_120);

    reportThreadVisibleOutputStallAfterFirstDelta("thread-visible-stall", {
      stallAt: 4_900,
      reason: "test-visible-gap",
    });

    const snapshot = getThreadStreamLatencySnapshot("thread-visible-stall");

    expect(snapshot?.latencyCategory).toBe("visible-output-stall-after-first-delta");
    expect(snapshot?.providerId).toBe("custom");
    expect(snapshot?.model).toBe("claude-sonnet-4.5");
    expect(snapshot?.lastVisibleTextItemId).toBe("assistant-visible-stall");
    expect(snapshot?.lastVisibleTextLength).toBe(2);
    expect(mocks.appendRendererDiagnostic).toHaveBeenCalledWith(
      "stream-latency/visible-output-stall-after-first-delta",
      expect.objectContaining({
        workspaceId: "ws-1",
        threadId: "thread-visible-stall",
        engine: "claude",
        platform: "windows",
        latencyCategory: "visible-output-stall-after-first-delta",
        providerId: "custom",
        model: "claude-sonnet-4.5",
        visibleStallMs: 780,
      }),
    );
  });

  it("classifies Gemini visible output stall without activating mitigation by default", async () => {
    await primeThreadStreamLatencyContext({
      workspaceId: "ws-gemini",
      threadId: "thread-gemini-visible-stall",
      engine: "gemini",
      model: "gemini-2.5-pro",
    });

    noteThreadTurnStarted({
      workspaceId: "ws-gemini",
      threadId: "thread-gemini-visible-stall",
      turnId: "turn-gemini-visible-stall",
      startedAt: 4_100,
    });
    noteThreadDeltaReceived("thread-gemini-visible-stall", 4_150);
    noteThreadVisibleTextRendered("thread-gemini-visible-stall", {
      itemId: "assistant-gemini-visible-stall",
      visibleTextLength: 3,
      renderAt: 4_170,
    });
    noteThreadDeltaReceived("thread-gemini-visible-stall", 4_220);

    reportThreadVisibleOutputStallAfterFirstDelta("thread-gemini-visible-stall", {
      stallAt: 4_950,
      reason: "test-gemini-visible-gap",
    });

    const snapshot = getThreadStreamLatencySnapshot("thread-gemini-visible-stall");

    expect(snapshot?.latencyCategory).toBe("visible-output-stall-after-first-delta");
    expect(snapshot?.engine).toBe("gemini");
    expect(snapshot?.mitigationProfile).toBeNull();
    expect(resolveActiveThreadStreamMitigation(snapshot)).toBeNull();
    expect(mocks.appendRendererDiagnostic).toHaveBeenCalledWith(
      "stream-latency/visible-output-stall-after-first-delta",
      expect.objectContaining({
        workspaceId: "ws-gemini",
        threadId: "thread-gemini-visible-stall",
        engine: "gemini",
        model: "gemini-2.5-pro",
        latencyCategory: "visible-output-stall-after-first-delta",
        reason: "test-gemini-visible-gap",
      }),
    );
  });

  it("activates engine-level Claude markdown stream recovery on macOS after visible stall evidence", async () => {
    mocks.isWindowsPlatform.mockReturnValue(false);
    mocks.isMacPlatform.mockReturnValue(true);
    mocks.getCurrentClaudeConfig.mockResolvedValue({
      apiKey: "",
      baseUrl: "https://api.anthropic.test",
      providerId: "anthropic",
      providerName: "Anthropic",
    });

    await primeThreadStreamLatencyContext({
      workspaceId: "ws-1",
      threadId: "thread-mac-visible-stall",
      engine: "claude",
      model: "claude-sonnet-4.5",
    });

    noteThreadTurnStarted({
      workspaceId: "ws-1",
      threadId: "thread-mac-visible-stall",
      turnId: "turn-mac-visible-stall",
      startedAt: 4_000,
    });
    noteThreadDeltaReceived("thread-mac-visible-stall", 4_050);
    noteThreadVisibleTextRendered("thread-mac-visible-stall", {
      itemId: "assistant-mac-visible-stall",
      visibleTextLength: 2,
      renderAt: 4_070,
    });
    noteThreadDeltaReceived("thread-mac-visible-stall", 4_120);

    reportThreadVisibleOutputStallAfterFirstDelta("thread-mac-visible-stall", {
      stallAt: 4_900,
      reason: "mac-visible-gap",
    });

    const snapshot = getThreadStreamLatencySnapshot("thread-mac-visible-stall");
    const mitigation = resolveActiveThreadStreamMitigation(snapshot);

    expect(snapshot?.candidateMitigationProfile).toBeNull();
    expect(snapshot?.mitigationProfile).toBe("claude-markdown-stream-recovery");
    expect(snapshot?.mitigationReason).toBe("visible-output-stall-after-first-delta");
    expect(snapshot?.latencyCategory).toBe("visible-output-stall-after-first-delta");
    expect(mitigation?.id).toBe("claude-markdown-stream-recovery");
    expect(mitigation?.renderPlainTextWhileStreaming).toBe(true);
    expect(mocks.appendRendererDiagnostic).toHaveBeenCalledWith(
      "stream-latency/mitigation-activated",
      expect.objectContaining({
        threadId: "thread-mac-visible-stall",
        platform: "macos",
        mitigationProfile: "claude-markdown-stream-recovery",
        latencyCategory: "visible-output-stall-after-first-delta",
      }),
    );
  });

  it("activates Codex markdown stream recovery after visible stall evidence", async () => {
    await primeThreadStreamLatencyContext({
      workspaceId: "ws-1",
      threadId: "thread-codex-visible-stall",
      engine: "codex",
      model: "gpt-5.4",
    });

    noteThreadTurnStarted({
      workspaceId: "ws-1",
      threadId: "thread-codex-visible-stall",
      turnId: "turn-codex-visible-stall",
      startedAt: 9_000,
    });
    noteThreadDeltaReceived("thread-codex-visible-stall", 9_050);
    noteThreadVisibleTextRendered("thread-codex-visible-stall", {
      itemId: "assistant-codex-visible-stall",
      visibleTextLength: 4,
      renderAt: 9_070,
    });
    noteThreadDeltaReceived("thread-codex-visible-stall", 9_120);

    reportThreadVisibleOutputStallAfterFirstDelta("thread-codex-visible-stall", {
      stallAt: 9_920,
      reason: "codex-visible-gap",
    });

    const snapshot = getThreadStreamLatencySnapshot("thread-codex-visible-stall");
    const mitigation = resolveActiveThreadStreamMitigation(snapshot);

    expect(snapshot?.latencyCategory).toBe("visible-output-stall-after-first-delta");
    expect(snapshot?.mitigationProfile).toBe("codex-markdown-stream-recovery");
    expect(snapshot?.mitigationReason).toBe("visible-output-stall-after-first-delta");
    expect(mitigation?.id).toBe("codex-markdown-stream-recovery");
    expect(mitigation?.renderPlainTextWhileStreaming).toBe(true);
    expect(mocks.appendRendererDiagnostic).toHaveBeenCalledWith(
      "stream-latency/mitigation-activated",
      expect.objectContaining({
        threadId: "thread-codex-visible-stall",
        engine: "codex",
        mitigationProfile: "codex-markdown-stream-recovery",
        latencyCategory: "visible-output-stall-after-first-delta",
      }),
    );
  });

  it("classifies repeat-turn blanking only for Claude after a non-empty surface disappears", async () => {
    mocks.isWindowsPlatform.mockReturnValue(false);
    mocks.isMacPlatform.mockReturnValue(true);
    mocks.getCurrentClaudeConfig.mockResolvedValue({
      apiKey: "",
      baseUrl: "https://api.anthropic.test",
      providerId: "anthropic",
      providerName: "Anthropic",
    });

    await primeThreadStreamLatencyContext({
      workspaceId: "ws-1",
      threadId: "thread-repeat-blanking",
      engine: "claude",
      model: "claude-sonnet-4.5",
    });

    noteThreadTurnStarted({
      workspaceId: "ws-1",
      threadId: "thread-repeat-blanking",
      turnId: "turn-repeat-blanking",
      startedAt: 5_000,
    });
    noteThreadDeltaReceived("thread-repeat-blanking", 5_050);
    noteThreadVisibleRender("thread-repeat-blanking", {
      visibleItemCount: 2,
      renderAt: 5_080,
    });
    noteThreadVisibleRender("thread-repeat-blanking", {
      visibleItemCount: 0,
      renderAt: 5_160,
    });

    const snapshot = getThreadStreamLatencySnapshot("thread-repeat-blanking");
    const mitigation = resolveActiveThreadStreamMitigation(snapshot);

    expect(snapshot?.latencyCategory).toBe("repeat-turn-blanking");
    expect(snapshot?.repeatTurnBlankingReported).toBe(true);
    expect(snapshot?.lastNonEmptyVisibleItemCount).toBe(2);
    expect(snapshot?.mitigationProfile).toBe("claude-markdown-stream-recovery");
    expect(mitigation?.id).toBe("claude-markdown-stream-recovery");
    expect(mocks.appendRendererDiagnostic).toHaveBeenCalledWith(
      "stream-latency/repeat-turn-blanking",
      expect.objectContaining({
        threadId: "thread-repeat-blanking",
        platform: "macos",
        latencyCategory: "repeat-turn-blanking",
        blankingDurationMs: 80,
        lastNonEmptyVisibleItemCount: 2,
      }),
    );
  });

  it("does not classify repeat-turn blanking for non-Claude engines or without prior visible output", async () => {
    mocks.isWindowsPlatform.mockReturnValue(false);
    mocks.isMacPlatform.mockReturnValue(true);

    await primeThreadStreamLatencyContext({
      workspaceId: "ws-1",
      threadId: "thread-repeat-blanking-guard",
      engine: "codex",
      model: "gpt-5.4",
    });

    noteThreadTurnStarted({
      workspaceId: "ws-1",
      threadId: "thread-repeat-blanking-guard",
      turnId: "turn-repeat-blanking-guard",
      startedAt: 6_000,
    });
    noteThreadDeltaReceived("thread-repeat-blanking-guard", 6_020);
    noteThreadVisibleRender("thread-repeat-blanking-guard", {
      visibleItemCount: 0,
      renderAt: 6_040,
    });

    const snapshot = getThreadStreamLatencySnapshot("thread-repeat-blanking-guard");

    expect(snapshot?.latencyCategory).toBeNull();
    expect(snapshot?.repeatTurnBlankingReported).toBe(false);
    expect(mocks.appendRendererDiagnostic).not.toHaveBeenCalledWith(
      "stream-latency/repeat-turn-blanking",
      expect.anything(),
    );
  });

  it("tracks visible text growth per assistant item instead of comparing global length", async () => {
    mocks.isWindowsPlatform.mockReturnValue(true);
    mocks.getCurrentClaudeConfig.mockResolvedValue({
      apiKey: "",
      baseUrl: "https://api.anthropic.test",
      providerId: "anthropic",
      providerName: "Anthropic",
    });

    await primeThreadStreamLatencyContext({
      workspaceId: "ws-1",
      threadId: "thread-visible-items",
      engine: "claude",
      model: "claude-sonnet-4.5",
    });

    noteThreadTurnStarted({
      workspaceId: "ws-1",
      threadId: "thread-visible-items",
      turnId: "turn-visible-items",
      startedAt: 4_000,
    });
    noteThreadDeltaReceived("thread-visible-items", 4_050);
    noteThreadVisibleTextRendered("thread-visible-items", {
      itemId: "assistant-first",
      visibleTextLength: 120,
      renderAt: 4_070,
    });
    noteThreadDeltaReceived("thread-visible-items", 4_120);
    noteThreadVisibleTextRendered("thread-visible-items", {
      itemId: "assistant-second",
      visibleTextLength: 4,
      renderAt: 4_130,
    });

    const snapshot = getThreadStreamLatencySnapshot("thread-visible-items");

    expect(snapshot?.lastVisibleTextItemId).toBe("assistant-second");
    expect(snapshot?.lastVisibleTextLength).toBe(4);
    expect(snapshot?.visibleTextGrowthCount).toBe(2);
    expect(snapshot?.pendingVisibleTextSinceDeltaAt).toBeNull();
  });

  it("normalizes invalid visible text lengths without poisoning the snapshot", async () => {
    mocks.isWindowsPlatform.mockReturnValue(true);
    mocks.getCurrentClaudeConfig.mockResolvedValue({
      apiKey: "",
      baseUrl: "https://api.anthropic.test",
      providerId: "anthropic",
      providerName: "Anthropic",
    });

    await primeThreadStreamLatencyContext({
      workspaceId: "ws-1",
      threadId: "thread-visible-invalid",
      engine: "claude",
      model: "claude-sonnet-4.5",
    });

    noteThreadTurnStarted({
      workspaceId: "ws-1",
      threadId: "thread-visible-invalid",
      turnId: "turn-visible-invalid",
      startedAt: 4_000,
    });
    noteThreadDeltaReceived("thread-visible-invalid", 4_050);
    noteThreadVisibleTextRendered("thread-visible-invalid", {
      itemId: "assistant-invalid",
      visibleTextLength: Number.NaN,
      renderAt: 4_060,
    });
    noteThreadVisibleTextRendered("thread-visible-invalid", {
      itemId: "assistant-invalid",
      visibleTextLength: Number.POSITIVE_INFINITY,
      renderAt: 4_070,
    });
    noteThreadVisibleTextRendered("thread-visible-invalid", {
      itemId: "assistant-invalid",
      visibleTextLength: -5,
      renderAt: 4_080,
    });

    const snapshot = getThreadStreamLatencySnapshot("thread-visible-invalid");

    expect(snapshot?.lastVisibleTextItemId).toBe("assistant-invalid");
    expect(snapshot?.lastVisibleTextLength).toBe(0);
    expect(snapshot?.visibleTextGrowthCount).toBe(0);
    expect(snapshot?.pendingVisibleTextSinceDeltaAt).toBe(4_050);
  });

  it("reports visible output stall from the bounded timer and clears it on turn completion", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(7_000);
    mocks.isWindowsPlatform.mockReturnValue(true);
    mocks.getCurrentClaudeConfig.mockResolvedValue({
      apiKey: "",
      baseUrl: "https://api.anthropic.test",
      providerId: "custom",
      providerName: "Custom Provider",
    });

    await primeThreadStreamLatencyContext({
      workspaceId: "ws-1",
      threadId: "thread-visible-timer",
      engine: "claude",
      model: "claude-sonnet-4.5",
    });

    noteThreadTurnStarted({
      workspaceId: "ws-1",
      threadId: "thread-visible-timer",
      turnId: "turn-visible-timer",
      startedAt: 7_000,
    });
    vi.setSystemTime(7_050);
    noteThreadDeltaReceived("thread-visible-timer");
    vi.setSystemTime(7_070);
    noteThreadVisibleTextRendered("thread-visible-timer", {
      itemId: "assistant-visible-timer",
      visibleTextLength: 2,
    });
    vi.setSystemTime(7_120);
    noteThreadDeltaReceived("thread-visible-timer");

    vi.advanceTimersByTime(699);
    expect(
      getThreadStreamLatencySnapshot("thread-visible-timer")?.latencyCategory,
    ).toBeNull();

    vi.advanceTimersByTime(1);
    expect(getThreadStreamLatencySnapshot("thread-visible-timer")?.latencyCategory).toBe(
      "visible-output-stall-after-first-delta",
    );
    expect(mocks.appendRendererDiagnostic).toHaveBeenCalledWith(
      "stream-latency/visible-output-stall-after-first-delta",
      expect.objectContaining({
        visibleStallMs: 700,
        reason: "visible-text-not-growing",
      }),
    );

    noteThreadTurnStarted({
      workspaceId: "ws-1",
      threadId: "thread-visible-timer-cleanup",
      turnId: "turn-visible-timer-cleanup",
      startedAt: 8_000,
    });
    vi.setSystemTime(8_050);
    noteThreadDeltaReceived("thread-visible-timer-cleanup");
    completeThreadStreamTurn("thread-visible-timer-cleanup");
    vi.advanceTimersByTime(1_000);

    expect(
      getThreadStreamLatencySnapshot("thread-visible-timer-cleanup")?.latencyCategory,
    ).toBeNull();
  });

  it("does not activate engine-level mitigation for non-Claude engines or macOS Claude without evidence", async () => {
    mocks.isWindowsPlatform.mockReturnValue(true);
    await primeThreadStreamLatencyContext({
      workspaceId: "ws-1",
      threadId: "thread-codex",
      engine: "codex",
      model: "gpt-5.4",
    });
    noteThreadTurnStarted({
      workspaceId: "ws-1",
      threadId: "thread-codex",
      turnId: "turn-codex",
      startedAt: 5_000,
    });
    noteThreadDeltaReceived("thread-codex", 5_040);

    expect(resolveActiveThreadStreamMitigation(
      getThreadStreamLatencySnapshot("thread-codex"),
    )).toBeNull();

    resetThreadStreamLatencyDiagnosticsForTests();
    mocks.isWindowsPlatform.mockReturnValue(false);
    mocks.isMacPlatform.mockReturnValue(true);
    mocks.getCurrentClaudeConfig.mockResolvedValue({
      apiKey: "",
      baseUrl: "https://api.anthropic.test",
      providerId: "anthropic",
      providerName: "Anthropic",
    });

    await primeThreadStreamLatencyContext({
      workspaceId: "ws-1",
      threadId: "thread-mac-claude",
      engine: "claude",
      model: "claude-sonnet-4.5",
    });
    noteThreadTurnStarted({
      workspaceId: "ws-1",
      threadId: "thread-mac-claude",
      turnId: "turn-mac-claude",
      startedAt: 5_500,
    });
    noteThreadDeltaReceived("thread-mac-claude", 5_540);

    expect(resolveActiveThreadStreamMitigation(
      getThreadStreamLatencySnapshot("thread-mac-claude"),
    )).toBeNull();
  });

  it("does not report baseline profile activation as stream mitigation", async () => {
    mocks.isWindowsPlatform.mockReturnValue(false);
    mocks.isMacPlatform.mockReturnValue(true);
    await primeThreadStreamLatencyContext({
      workspaceId: "ws-1",
      threadId: "thread-baseline-profile",
      engine: "gemini",
      model: "gemini-2.5-pro",
    });
    noteThreadTurnStarted({
      workspaceId: "ws-1",
      threadId: "thread-baseline-profile",
      turnId: "turn-baseline-profile",
      startedAt: 5_900,
    });
    noteThreadDeltaReceived("thread-baseline-profile", 5_940);
    noteThreadVisibleTextRendered("thread-baseline-profile", {
      itemId: "assistant-baseline-profile",
      visibleTextLength: 12,
      renderAt: 5_960,
    });

    const snapshot = getThreadStreamLatencySnapshot("thread-baseline-profile");

    expect(snapshot?.candidateMitigationProfile).toBeNull();
    expect(snapshot?.mitigationProfile).toBeNull();
    expect(snapshot?.mitigationReason).toBeNull();
    expect(resolveActiveThreadStreamMitigation(snapshot)).toBeNull();
    expect(mocks.appendRendererDiagnostic).not.toHaveBeenCalledWith(
      "stream-latency/mitigation-activated",
      expect.anything(),
    );
  });

  it("keeps diagnostics while the rollback flag suppresses the active mitigation profile", async () => {
    const getItem = vi.fn((key: string) =>
      key === "ccgui.debug.streamMitigation.disabled" ? "true" : null,
    );
    vi.stubGlobal("window", {
      localStorage: { getItem },
    });
    mocks.isWindowsPlatform.mockReturnValue(true);
    mocks.getCurrentClaudeConfig.mockResolvedValue({
      apiKey: "",
      baseUrl: "https://api.anthropic.test",
      providerId: "custom",
      providerName: "Custom Provider",
    });

    await primeThreadStreamLatencyContext({
      workspaceId: "ws-1",
      threadId: "thread-disabled",
      engine: "claude",
      model: "claude-sonnet-4.5",
    });
    noteThreadTurnStarted({
      workspaceId: "ws-1",
      threadId: "thread-disabled",
      turnId: "turn-disabled",
      startedAt: 6_000,
    });
    noteThreadDeltaReceived("thread-disabled", 6_050);
    noteThreadVisibleTextRendered("thread-disabled", {
      itemId: "assistant-disabled",
      visibleTextLength: 2,
      renderAt: 6_060,
    });
    noteThreadDeltaReceived("thread-disabled", 6_140);
    reportThreadVisibleOutputStallAfterFirstDelta("thread-disabled", {
      stallAt: 6_900,
      reason: "test-disabled-still-records",
    });

    const snapshot = getThreadStreamLatencySnapshot("thread-disabled");

    expect(snapshot?.candidateMitigationProfile).toBe("claude-windows-visible-stream");
    expect(snapshot?.mitigationProfile).toBe("claude-windows-visible-stream");
    expect(snapshot?.latencyCategory).toBe("visible-output-stall-after-first-delta");
    expect(resolveActiveThreadStreamMitigation(snapshot)).toBeNull();
    expect(mocks.appendRendererDiagnostic).toHaveBeenCalledWith(
      "stream-latency/mitigation-activated",
      expect.objectContaining({
        mitigationProfile: "claude-windows-visible-stream",
        mitigationSuppressed: "disabled-flag",
      }),
    );
    expect(mocks.appendRendererDiagnostic).toHaveBeenCalledWith(
      "stream-latency/visible-output-stall-after-first-delta",
      expect.objectContaining({
        mitigationSuppressed: "disabled-flag",
        reason: "test-disabled-still-records",
      }),
    );
  });

  it("records upstream-pending diagnostics with correlated provider dimensions", async () => {
    mocks.isWindowsPlatform.mockReturnValue(true);
    mocks.getCurrentClaudeConfig.mockResolvedValue({
      apiKey: "",
      baseUrl: "https://dashscope.aliyuncs.com/apps/anthropic",
      providerId: "qwen",
      providerName: "Qwen",
    });

    await primeThreadStreamLatencyContext({
      workspaceId: "ws-1",
      threadId: "thread-3",
      engine: "claude",
      model: "qwen3-max",
    });

    noteThreadTurnStarted({
      workspaceId: "ws-1",
      threadId: "thread-3",
      turnId: "turn-3",
      startedAt: 3_000,
    });

    reportThreadUpstreamPending("thread-3", {
      elapsedMs: 6_000,
      diagnosticCategory: "first-token-delay",
    });

    expect(mocks.appendRendererDiagnostic).toHaveBeenCalledWith(
      "stream-latency/upstream-pending",
      expect.objectContaining({
        workspaceId: "ws-1",
        threadId: "thread-3",
        turnId: "turn-3",
        providerId: "qwen",
        model: "qwen3-max",
        platform: "windows",
        diagnosticCategory: "first-token-delay",
      }),
    );
  });

  it("clears stale provider fingerprint when a newer non-claude turn primes the same thread", async () => {
    let resolveConfig: ((value: {
      apiKey: string;
      baseUrl: string;
      providerId: string;
      providerName: string;
    }) => void) | null = null;
    mocks.getCurrentClaudeConfig.mockReturnValueOnce(
      new Promise<{
        apiKey: string;
        baseUrl: string;
        providerId: string;
        providerName: string;
      }>((resolve) => {
        resolveConfig = resolve;
      }),
    );

    const pendingPrime = primeThreadStreamLatencyContext({
      workspaceId: "ws-1",
      threadId: "thread-4",
      engine: "claude",
      model: "qwen3-max",
    });

    await primeThreadStreamLatencyContext({
      workspaceId: "ws-1",
      threadId: "thread-4",
      engine: "codex",
      model: "gpt-5.4",
    });

    expect(resolveConfig).toBeTypeOf("function");
    if (!resolveConfig) {
      throw new Error("expected pending config resolver");
    }
    const applyConfig: (value: {
      apiKey: string;
      baseUrl: string;
      providerId: string;
      providerName: string;
    }) => void = resolveConfig;
    applyConfig({
      apiKey: "",
      baseUrl: "https://dashscope.aliyuncs.com/apps/anthropic",
      providerId: "qwen",
      providerName: "Qwen",
    });
    await pendingPrime;

    expect(getThreadStreamLatencySnapshot("thread-4")).toMatchObject({
      engine: "codex",
      model: "gpt-5.4",
      providerId: null,
      providerName: null,
      baseUrl: null,
    });
  });

  it("clears previous provider fingerprint when claude config refresh fails", async () => {
    mocks.getCurrentClaudeConfig.mockResolvedValueOnce({
      apiKey: "",
      baseUrl: "https://dashscope.aliyuncs.com/apps/anthropic",
      providerId: "qwen",
      providerName: "Qwen",
    });
    await primeThreadStreamLatencyContext({
      workspaceId: "ws-1",
      threadId: "thread-5",
      engine: "claude",
      model: "qwen3-max",
    });

    mocks.getCurrentClaudeConfig.mockRejectedValueOnce(new Error("network down"));
    await primeThreadStreamLatencyContext({
      workspaceId: "ws-1",
      threadId: "thread-5",
      engine: "claude",
      model: "claude-sonnet-4.5",
    });

    expect(getThreadStreamLatencySnapshot("thread-5")).toMatchObject({
      engine: "claude",
      model: "claude-sonnet-4.5",
      providerId: null,
      providerName: null,
      baseUrl: null,
    });
  });
});
