import { describe, expect, it } from "vitest";
import { CONVERSATION_ASSEMBLY_MIGRATION_GATES } from "../../threads/assembly/conversationMigrationGates";
import { resolvePresentationProfile } from "./presentationProfile";

describe("presentationProfile", () => {
  it("resolves codex profile with codex-only visual hints", () => {
    const profile = resolvePresentationProfile("codex");
    expect(profile).toEqual({
      engine: "codex",
      preferCommandSummary: true,
      codexCanvasMarkdown: true,
      showReasoningLiveDot: true,
      heartbeatWaitingHint: false,
      assistantMarkdownStreamingThrottleMs: 80,
      reasoningStreamingThrottleMs: 180,
      useCodexStagedMarkdownThrottle: true,
    });
  });

  it("keeps claude profile without codex or heartbeat-specific hints", () => {
    const profile = resolvePresentationProfile("claude");
    expect(profile).toEqual({
      engine: "claude",
      preferCommandSummary: false,
      codexCanvasMarkdown: false,
      showReasoningLiveDot: false,
      heartbeatWaitingHint: false,
      assistantMarkdownStreamingThrottleMs: 80,
      reasoningStreamingThrottleMs: 180,
      useCodexStagedMarkdownThrottle: false,
    });
  });

  it("keeps gemini on the shared baseline profile without mitigation defaults", () => {
    const profile = resolvePresentationProfile("gemini");
    expect(profile).toEqual({
      engine: "gemini",
      preferCommandSummary: false,
      codexCanvasMarkdown: false,
      showReasoningLiveDot: false,
      heartbeatWaitingHint: false,
      assistantMarkdownStreamingThrottleMs: 80,
      reasoningStreamingThrottleMs: 180,
      useCodexStagedMarkdownThrottle: false,
    });
  });

  it("uses the local migration gate to disable migrated profile behavior per engine", () => {
    const previousClaudeGate = { ...CONVERSATION_ASSEMBLY_MIGRATION_GATES.claude };
    try {
      CONVERSATION_ASSEMBLY_MIGRATION_GATES.claude.profileEnabled = false;

      expect(resolvePresentationProfile("claude")).toEqual({
        engine: "claude",
        preferCommandSummary: false,
        codexCanvasMarkdown: false,
        showReasoningLiveDot: false,
        heartbeatWaitingHint: false,
        assistantMarkdownStreamingThrottleMs: 80,
        reasoningStreamingThrottleMs: 180,
        useCodexStagedMarkdownThrottle: false,
      });
      expect(resolvePresentationProfile("gemini").engine).toBe("gemini");
    } finally {
      CONVERSATION_ASSEMBLY_MIGRATION_GATES.claude.profileEnabled =
        previousClaudeGate.profileEnabled;
    }
  });

  it("enables heartbeat waiting hint only for opencode profile", () => {
    const profile = resolvePresentationProfile("opencode");
    expect(profile).toEqual({
      engine: "opencode",
      preferCommandSummary: false,
      codexCanvasMarkdown: false,
      showReasoningLiveDot: false,
      heartbeatWaitingHint: true,
      assistantMarkdownStreamingThrottleMs: 80,
      reasoningStreamingThrottleMs: 180,
      useCodexStagedMarkdownThrottle: false,
    });
  });
});
