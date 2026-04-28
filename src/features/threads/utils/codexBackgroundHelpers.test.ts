import { describe, expect, it } from "vitest";

import { isCodexBackgroundHelperPreview } from "./codexBackgroundHelpers";

describe("codexBackgroundHelpers", () => {
  it("detects known Codex helper prompts", () => {
    expect(
      isCodexBackgroundHelperPreview(
        "Generate a concise title for a coding chat thread from the first user message. Return only title text.",
      ),
    ).toBe(true);
    expect(
      isCodexBackgroundHelperPreview(
        "## Memory Writing Agent: Phase 2 (Consolidation)\n\nYou are consolidating raw memories.",
      ),
    ).toBe(true);
  });

  it("does not hide normal conversations that only mention memory writing", () => {
    expect(
      isCodexBackgroundHelperPreview(
        "请分析 Memory Writing Agent 为什么会出现在会话列表里",
      ),
    ).toBe(false);
  });
});
