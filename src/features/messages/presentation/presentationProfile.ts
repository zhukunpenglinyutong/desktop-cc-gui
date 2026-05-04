import type { ConversationEngine } from "../../threads/contracts/conversationCurtainContracts";
import { resolveConversationAssemblyMigrationGate } from "../../threads/assembly/conversationMigrationGates";

export type PresentationProfile = {
  engine: ConversationEngine;
  preferCommandSummary: boolean;
  codexCanvasMarkdown: boolean;
  showReasoningLiveDot: boolean;
  heartbeatWaitingHint: boolean;
  assistantMarkdownStreamingThrottleMs: number;
  reasoningStreamingThrottleMs: number;
  useCodexStagedMarkdownThrottle: boolean;
};

export function resolvePresentationProfile(
  engine: ConversationEngine,
): PresentationProfile {
  const migrationGate = resolveConversationAssemblyMigrationGate(engine);
  if (migrationGate && !migrationGate.profileEnabled) {
    return {
      engine,
      preferCommandSummary: false,
      codexCanvasMarkdown: false,
      showReasoningLiveDot: false,
      heartbeatWaitingHint: false,
      assistantMarkdownStreamingThrottleMs: 80,
      reasoningStreamingThrottleMs: 180,
      useCodexStagedMarkdownThrottle: false,
    };
  }
  if (engine === "codex") {
    return {
      engine,
      preferCommandSummary: true,
      codexCanvasMarkdown: true,
      showReasoningLiveDot: true,
      heartbeatWaitingHint: false,
      assistantMarkdownStreamingThrottleMs: 80,
      reasoningStreamingThrottleMs: 180,
      useCodexStagedMarkdownThrottle: true,
    };
  }
  if (engine === "opencode") {
    return {
      engine,
      preferCommandSummary: false,
      codexCanvasMarkdown: false,
      showReasoningLiveDot: false,
      heartbeatWaitingHint: true,
      assistantMarkdownStreamingThrottleMs: 80,
      reasoningStreamingThrottleMs: 180,
      useCodexStagedMarkdownThrottle: false,
    };
  }
  return {
    engine,
    preferCommandSummary: false,
    codexCanvasMarkdown: false,
    showReasoningLiveDot: false,
    heartbeatWaitingHint: false,
    assistantMarkdownStreamingThrottleMs: 80,
    reasoningStreamingThrottleMs: 180,
    useCodexStagedMarkdownThrottle: false,
  };
}
