import { describe, expect, it } from "vitest";
import {
  isSharedSessionSupportedEngine,
  normalizeSharedSessionEngine,
} from "./sharedSessionEngines";

describe("sharedSessionEngines", () => {
  it("uses capability matrix semantics for codex collaboration support", () => {
    expect(isSharedSessionSupportedEngine("codex")).toBe(true);
    expect(normalizeSharedSessionEngine("codex")).toBe("codex");
  });

  it("keeps non-collaboration shared-session engines on claude fallback", () => {
    expect(isSharedSessionSupportedEngine("gemini")).toBe(false);
    expect(isSharedSessionSupportedEngine("opencode")).toBe(false);
    expect(normalizeSharedSessionEngine("gemini")).toBe("claude");
  });
});
