import { describe, expect, it } from "vitest";
import type { EngineFeatures, EngineType } from "../../types";
import {
  ENGINE_CAPABILITY_KEYS,
  getEngineCapabilityState,
  projectEngineFeaturesToCapabilityStates,
  resolveEngineCapabilityRuntimeStatus,
} from "./engineCapabilityMatrix";

const allFeatures: EngineFeatures = {
  streaming: true,
  reasoning: true,
  toolUse: true,
  imageInput: true,
  sessionContinuation: true,
};

describe("engineCapabilityMatrix", () => {
  it("defines a stable first capability set", () => {
    expect(ENGINE_CAPABILITY_KEYS).toEqual([
      "streaming.text",
      "streaming.reasoning",
      "streaming.tool-output",
      "tool.use",
      "tool.mcp",
      "reasoning.effort",
      "collaboration.mode",
      "session.continuation",
      "image.input",
    ]);
  });

  it("resolves spec-owned capability states by engine", () => {
    expect(getEngineCapabilityState("codex", "reasoning.effort")).toBe("supported");
    expect(getEngineCapabilityState("claude", "reasoning.effort")).toBe("unsupported");
    expect(getEngineCapabilityState("opencode", "tool.mcp")).toBe("unsupported");
  });

  it("projects legacy EngineFeatures into capability states without inventing unknown fields", () => {
    expect(projectEngineFeaturesToCapabilityStates(allFeatures)).toMatchObject({
      "streaming.text": "supported",
      "streaming.reasoning": "supported",
      "streaming.tool-output": "supported",
      "tool.use": "supported",
      "tool.mcp": "unknown",
      "reasoning.effort": "unknown",
      "collaboration.mode": "unknown",
      "session.continuation": "supported",
      "image.input": "supported",
    });
  });

  it("keeps runtime projection conservative when legacy EngineFeatures lack a dimension", () => {
    const status = resolveEngineCapabilityRuntimeStatus(
      {
        engineType: "codex" satisfies EngineType,
        features: allFeatures,
      },
      "reasoning.effort",
    );

    expect(status).toEqual({
      engine: "codex",
      capability: "reasoning.effort",
      specState: "supported",
      runtimeState: "unknown",
      available: true,
    });
  });
});
