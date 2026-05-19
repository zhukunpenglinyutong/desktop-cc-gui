import type { EngineFeatures, EngineStatus, EngineType } from "../../types";
import matrixFixture from "../../../openspec/specs/engine-capability-matrix/fixtures/matrix.json";

const ENGINE_CAPABILITY_KEY_VALUES = [
  "streaming.text",
  "streaming.reasoning",
  "streaming.tool-output",
  "tool.use",
  "tool.mcp",
  "reasoning.effort",
  "collaboration.mode",
  "session.continuation",
  "image.input",
] as const;

export type EngineCapabilityState =
  | "supported"
  | "compat-input"
  | "unsupported"
  | "unknown";

export type EngineCapabilityKey = (typeof ENGINE_CAPABILITY_KEY_VALUES)[number];

export type EngineCapabilityRuntimeStatus = {
  engine: EngineType;
  capability: EngineCapabilityKey;
  specState: EngineCapabilityState;
  runtimeState: EngineCapabilityState;
  available: boolean;
};

const ENGINE_CAPABILITY_MATRIX = matrixFixture.engines as Record<
  EngineType,
  Record<EngineCapabilityKey, EngineCapabilityState>
>;

export const ENGINE_CAPABILITY_KEYS = ENGINE_CAPABILITY_KEY_VALUES;

export function getEngineCapabilityState(
  engine: EngineType,
  capability: EngineCapabilityKey,
): EngineCapabilityState {
  return ENGINE_CAPABILITY_MATRIX[engine]?.[capability] ?? "unknown";
}

export function isEngineCapabilityAvailable(
  engine: EngineType,
  capability: EngineCapabilityKey,
): boolean {
  return getEngineCapabilityState(engine, capability) === "supported";
}

export function projectEngineFeaturesToCapabilityStates(
  features: EngineFeatures,
): Record<EngineCapabilityKey, EngineCapabilityState> {
  return {
    "streaming.text": features.streaming ? "supported" : "unsupported",
    "streaming.reasoning": features.streaming && features.reasoning ? "supported" : "unsupported",
    "streaming.tool-output": features.streaming && features.toolUse ? "supported" : "unsupported",
    "tool.use": features.toolUse ? "supported" : "unsupported",
    "tool.mcp": "unknown",
    "reasoning.effort": "unknown",
    "collaboration.mode": "unknown",
    "session.continuation": features.sessionContinuation ? "supported" : "unsupported",
    "image.input": features.imageInput ? "supported" : "unsupported",
  };
}

export function resolveEngineCapabilityRuntimeStatus(
  status: Pick<EngineStatus, "engineType" | "features">,
  capability: EngineCapabilityKey,
): EngineCapabilityRuntimeStatus {
  const specState = getEngineCapabilityState(status.engineType, capability);
  const runtimeState = projectEngineFeaturesToCapabilityStates(status.features)[capability];
  return {
    engine: status.engineType,
    capability,
    specState,
    runtimeState,
    available: specState === "supported" && runtimeState !== "unsupported",
  };
}
