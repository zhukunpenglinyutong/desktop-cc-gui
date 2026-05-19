import type { EngineType } from "../../../types";
import { isEngineCapabilityAvailable } from "../../engine/engineCapabilityMatrix";

export type SharedSessionSupportedEngine = "claude" | "codex";

const SHARED_SESSION_BASE_ENGINES = new Set<EngineType>(["claude"]);

export function isSharedSessionSupportedEngine(
  engine: EngineType | null | undefined,
): engine is SharedSessionSupportedEngine {
  if (!engine) {
    return false;
  }
  return (
    SHARED_SESSION_BASE_ENGINES.has(engine) ||
    isEngineCapabilityAvailable(engine, "collaboration.mode")
  );
}

export function normalizeSharedSessionEngine(
  engine: EngineType | null | undefined,
): SharedSessionSupportedEngine {
  return isSharedSessionSupportedEngine(engine) &&
    isEngineCapabilityAvailable(engine, "collaboration.mode")
    ? "codex"
    : "claude";
}
