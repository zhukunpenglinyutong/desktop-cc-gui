import type { EngineType } from "../../../types";

export type SharedSessionSupportedEngine = "claude" | "codex";

export function isSharedSessionSupportedEngine(
  engine: EngineType | null | undefined,
): engine is SharedSessionSupportedEngine {
  return engine === "claude" || engine === "codex";
}

export function normalizeSharedSessionEngine(
  engine: EngineType | null | undefined,
): SharedSessionSupportedEngine {
  return engine === "codex" ? "codex" : "claude";
}
