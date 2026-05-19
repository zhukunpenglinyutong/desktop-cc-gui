import { describe, expect, it } from "vitest";
import {
  analyzeStreamingMarkdownComplexity,
  EMPTY_STREAMING_MARKDOWN_COMPLEXITY,
  resolveAssistantMessageStreamingThrottleMs,
  resolveReasoningStreamingThrottleMs,
} from "./messagesStreamingComplexity";

const assistantMessage = {
  id: "assistant-1",
  kind: "message" as const,
  role: "assistant" as const,
  text: "",
};

describe("messagesStreamingComplexity", () => {
  it("returns the empty complexity singleton for blank text", () => {
    expect(analyzeStreamingMarkdownComplexity(" \n\t ")).toBe(
      EMPTY_STREAMING_MARKDOWN_COMPLEXITY,
    );
  });

  it("classifies structured markdown before the huge threshold", () => {
    const complexity = analyzeStreamingMarkdownComplexity([
      "### 总览",
      "### 设计",
      "### 验证",
      "- 第一条",
      "- 第二条",
      "- 第三条",
      "- 第四条",
      "- 第五条",
      "- 第六条",
      "```ts",
      "const value = 1;",
      "```",
    ].join("\n"));

    expect(complexity.isStructuredHeavy).toBe(true);
    expect(complexity.isLarge).toBe(true);
    expect(complexity.isHuge).toBe(false);
  });

  it("resolves staged Codex throttle from complexity", () => {
    const complexity = analyzeStreamingMarkdownComplexity(
      Array.from({ length: 14 }, (_, index) => `- 第 ${index + 1} 条结论`).join("\n"),
    );

    expect(resolveAssistantMessageStreamingThrottleMs(
      assistantMessage,
      true,
      "codex",
      null,
      null,
      complexity,
    )).toBe(160);
  });

  it("lets mitigation profile override assistant and reasoning throttles", () => {
    const complexity = analyzeStreamingMarkdownComplexity("short output");
    const mitigationProfile = {
      id: "claude-qwen-windows-render-safe" as const,
      messageStreamingThrottleMs: 120,
      reasoningStreamingThrottleMs: 260,
    };

    expect(resolveAssistantMessageStreamingThrottleMs(
      assistantMessage,
      true,
      "claude",
      mitigationProfile,
      null,
      complexity,
    )).toBe(120);
    expect(resolveReasoningStreamingThrottleMs(true, mitigationProfile, null)).toBe(260);
  });

  it("keeps completed markdown on history-safe throttle", () => {
    const complexity = analyzeStreamingMarkdownComplexity("# completed");

    expect(resolveAssistantMessageStreamingThrottleMs(
      assistantMessage,
      false,
      "codex",
      null,
      null,
      complexity,
    )).toBe(80);
    expect(resolveReasoningStreamingThrottleMs(false, null, null)).toBe(80);
  });
});
