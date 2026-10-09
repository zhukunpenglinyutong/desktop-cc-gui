import { beforeEach, describe, expect, it } from "vitest";
import {
  AUTO_COMPACT_STORAGE_KEY,
  DEFAULT_AUTO_COMPACT_THRESHOLD,
  getAutoCompactSettings,
  hasPendingUserInput,
  migrateAutoCompactSettings,
  normalizeAutoCompactThreshold,
  nativeAutoCompactThreshold,
  autoCompactThresholdRange,
  setAutoCompactEnabled,
  setAutoCompactThreshold,
  shouldAutoCompact,
  shouldResumeAfterAutoCompact,
} from "./auto-compact-context";

const SESSION_A = "omp/session-a/workspace-a";
const SESSION_B = "claude/session-b/workspace-b";

describe("auto compact context settings", () => {
  beforeEach(() => {
    localStorage.clear();
    setAutoCompactEnabled(SESSION_A, false);
    setAutoCompactThreshold(SESSION_A, DEFAULT_AUTO_COMPACT_THRESHOLD);
  });

  it.each([
    [0, 1],
    [101, 100],
    ["42", 42],
    ["", DEFAULT_AUTO_COMPACT_THRESHOLD],
    ["not-a-number", DEFAULT_AUTO_COMPACT_THRESHOLD],
  ])("normalizes %s to %s", (value, expected) => {
    expect(normalizeAutoCompactThreshold(value)).toBe(expected);
  });

  it("persists settings per session without leaking between sessions", () => {
    setAutoCompactEnabled(SESSION_A, true);
    setAutoCompactThreshold(SESSION_A, 72);

    expect(getAutoCompactSettings(SESSION_A)).toEqual({ enabled: true, threshold: 72 });
    expect(getAutoCompactSettings(SESSION_B)).toEqual({
      enabled: false,
      threshold: DEFAULT_AUTO_COMPACT_THRESHOLD,
    });
    expect(JSON.parse(localStorage.getItem(AUTO_COMPACT_STORAGE_KEY) ?? "{}")[SESSION_A]).toEqual({
      enabled: true,
      threshold: 72,
    });
  });
  it("does not persist an empty session key", () => {
    localStorage.clear();
    setAutoCompactEnabled("", true);
    setAutoCompactThreshold("", 55);
    expect(localStorage.getItem(AUTO_COMPACT_STORAGE_KEY)).toBeNull();
  });

  it("carries a pending tab's settings onto the native session it adopts", () => {
    localStorage.clear();
    const pending = "new:omp:S:/ws";
    const native = "omp/sess-1";
    setAutoCompactThreshold(pending, 5);
    setAutoCompactEnabled(pending, true);

    migrateAutoCompactSettings(pending, native);

    expect(getAutoCompactSettings(native)).toEqual({ enabled: true, threshold: 5 });
    const stored = JSON.parse(localStorage.getItem(AUTO_COMPACT_STORAGE_KEY) ?? "{}");
    expect(stored[pending]).toBeUndefined();
  });

  it("keeps settings the native session already has", () => {
    localStorage.clear();
    const pending = "new:omp:S:/ws";
    const native = "omp/sess-2";
    setAutoCompactThreshold(pending, 5);
    setAutoCompactEnabled(native, true);
    setAutoCompactThreshold(native, 60);

    migrateAutoCompactSettings(pending, native);

    expect(getAutoCompactSettings(native)).toEqual({ enabled: true, threshold: 60 });
    expect(
      JSON.parse(localStorage.getItem(AUTO_COMPACT_STORAGE_KEY) ?? "{}")[pending],
    ).toBeUndefined();
  });

  it("is a no-op without pending settings or with equal keys", () => {
    localStorage.clear();
    migrateAutoCompactSettings("new:omp:S:/ws", "omp/sess-3");
    expect(localStorage.getItem(AUTO_COMPACT_STORAGE_KEY)).toBeNull();
    setAutoCompactEnabled("omp/sess-3", true);
    migrateAutoCompactSettings("omp/sess-3", "omp/sess-3");
    expect(getAutoCompactSettings("omp/sess-3")).toEqual({ enabled: true, threshold: 80 });
  });
});

describe("native auto-compaction thresholds", () => {
  it("converts the chosen window without clamping Claude's invalid values", () => {
    expect(nativeAutoCompactThreshold("claude", { enabled: true, threshold: 50 }, 200_000)).toBe(100_000);
    expect(nativeAutoCompactThreshold("claude", { enabled: true, threshold: 100 }, 1_000_000)).toBe(1_000_000);
    expect(() => nativeAutoCompactThreshold("claude", { enabled: true, threshold: 49 }, 200_000)).toThrow();
    expect(() => nativeAutoCompactThreshold("claude", { enabled: true, threshold: 80 }, 2_000_000)).toThrow();
    expect(autoCompactThresholdRange("claude", 200_000)).toEqual({ min: 50, max: 100 });
    expect(autoCompactThresholdRange("claude", 50_000)).toBeNull();
  });

  it("keeps off and non-native engines unset and accepts positive safe Codex tokens", () => {
    expect(nativeAutoCompactThreshold("claude", { enabled: false, threshold: 1 }, 200_000)).toBeUndefined();
    expect(nativeAutoCompactThreshold("omp", { enabled: true, threshold: 1 }, 200_000)).toBeUndefined();
    expect(nativeAutoCompactThreshold("codex", { enabled: true, threshold: 1 }, 100)).toBe(1);
    expect(nativeAutoCompactThreshold("codex", { enabled: true, threshold: 29 }, 100)).toBe(29);
    expect(nativeAutoCompactThreshold("codex", { enabled: true, threshold: 100 }, Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => nativeAutoCompactThreshold("codex", { enabled: true, threshold: 100 }, Number.MAX_SAFE_INTEGER + 1)).toThrow();
  });
});

describe("shouldAutoCompact", () => {
  const base = {
    enabled: true,
    threshold: 80,
    usagePct: 80,
    streaming: false,
    compacting: false,
    attemptedAtPct: null as number | null,
    canCompactWhileStreaming: false,
  };

  it("triggers at the threshold", () => {
    expect(shouldAutoCompact(base)).toBe(true);
  });

  it("does not trigger below the threshold, while streaming, while compacting, or when disabled", () => {
    expect(shouldAutoCompact({ ...base, usagePct: 79 })).toBe(false);
    expect(shouldAutoCompact({ ...base, streaming: true })).toBe(false);
    expect(shouldAutoCompact({ ...base, compacting: true })).toBe(false);
    expect(shouldAutoCompact({ ...base, enabled: false })).toBe(false);
    expect(shouldAutoCompact({ ...base, usagePct: undefined })).toBe(false);
  });

  it("holds the level it already tried and retries once the context grows past it", () => {
    expect(shouldAutoCompact({ ...base, attemptedAtPct: 80 })).toBe(false);
    expect(shouldAutoCompact({ ...base, attemptedAtPct: 79 })).toBe(true);
    expect(shouldAutoCompact({ ...base, usagePct: 82, attemptedAtPct: 80 })).toBe(true);
    expect(shouldAutoCompact({ ...base, usagePct: 80.2, attemptedAtPct: 80.1 })).toBe(false);
    expect(shouldAutoCompact({ ...base, usagePct: 80.6, attemptedAtPct: 80.1 })).toBe(true);
  });

  it("compacts inside a live turn only when the run can compact while streaming", () => {
    // OMP rpc-ui: the host can compact in place, so a never-settling turn
    // still gets maintenance.
    expect(
      shouldAutoCompact({ ...base, streaming: true, canCompactWhileStreaming: true }),
    ).toBe(true);
    // Codex/Claude: no lossless in-place compact, so streaming still blocks.
    expect(
      shouldAutoCompact({ ...base, streaming: true, canCompactWhileStreaming: false }),
    ).toBe(false);
    // The latch still applies inside a live turn.
    expect(
      shouldAutoCompact({
        ...base,
        streaming: true,
        canCompactWhileStreaming: true,
        attemptedAtPct: 80,
      }),
    ).toBe(false);
    // Compacting already in flight wins over the live capability.
    expect(
      shouldAutoCompact({
        ...base,
        streaming: true,
        canCompactWhileStreaming: true,
        compacting: true,
      }),
    ).toBe(false);
  });
});

describe("hasPendingUserInput", () => {
  it("flags a live question, grant or plan dock and ignores settled rows", () => {
    expect(hasPendingUserInput([])).toBe(false);
    expect(hasPendingUserInput([{ question: { status: "answered" } }])).toBe(false);
    expect(hasPendingUserInput([{ question: { status: "pending" } }])).toBe(true);
    expect(hasPendingUserInput([{ grant: { status: "pending" } }])).toBe(true);
    expect(hasPendingUserInput([{ grant: { status: "granted" } }])).toBe(false);
    expect(hasPendingUserInput([{ planReview: { status: "awaiting_review" } }])).toBe(true);
    expect(hasPendingUserInput([{ planReview: { status: "submitting" } }])).toBe(true);
    expect(hasPendingUserInput([{ planReview: { status: "approved" } }])).toBe(false);
  });
});

describe("shouldResumeAfterAutoCompact", () => {
  const base = {
    trigger: "threshold" as const,
    errorAfter: null as string | null,
    interrupted: false,
    streaming: false,
    queued: 0,
    parked: false,
    sessionId: "01a10ded" as string | null,
  };

  it("resumes the task after a threshold compaction", () => {
    expect(shouldResumeAfterAutoCompact(base)).toBe(true);
  });

  it("keeps hands off after a manual click, a stop, a queued message, a parked dialog or without a native session", () => {
    expect(shouldResumeAfterAutoCompact({ ...base, trigger: "manual" })).toBe(false);
    expect(shouldResumeAfterAutoCompact({ ...base, interrupted: true })).toBe(false);
    expect(shouldResumeAfterAutoCompact({ ...base, streaming: true })).toBe(false);
    expect(shouldResumeAfterAutoCompact({ ...base, queued: 1 })).toBe(false);
    expect(shouldResumeAfterAutoCompact({ ...base, parked: true })).toBe(false);
    expect(shouldResumeAfterAutoCompact({ ...base, sessionId: null })).toBe(false);
  });

  it("stays quiet when the attempt itself reported an error", () => {
    expect(
      shouldResumeAfterAutoCompact({
        ...base,
        errorAfter: "omp 压缩失败:Nothing to compact (session too small)",
      }),
    ).toBe(false);
  });
});
