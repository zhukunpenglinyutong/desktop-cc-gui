import { describe, expect, it } from "vitest";
import type { EngineType, ModelOption } from "../types";
import {
  getEffectiveModels,
  getEffectiveReasoningSupported,
  getEffectiveSelectedModelId,
  getNextEngineSelectedModelId,
} from "./modelSelection";

function createModel(
  id: string,
  overrides: Partial<ModelOption> = {},
): ModelOption {
  return {
    id,
    model: id,
    displayName: id,
    description: "",
    supportedReasoningEfforts: [],
    defaultReasoningEffort: null,
    isDefault: false,
    ...overrides,
  };
}

describe("modelSelection", () => {
  const codexModels = [
    createModel("codex-default", { isDefault: true }),
    createModel("codex-alt"),
  ];
  const engineModels = [
    createModel("engine-default", { isDefault: true }),
    createModel("engine-alt"),
  ];

  it("uses codex models directly when codex is active", () => {
    expect(getEffectiveModels("codex", codexModels, engineModels)).toEqual(codexModels);
  });

  it("uses engine-provided models for non-codex engines", () => {
    expect(getEffectiveModels("claude", codexModels, engineModels)).toEqual(engineModels);
  });

  it("keeps the codex-selected model id when codex is active", () => {
    expect(
      getEffectiveSelectedModelId({
        activeEngine: "codex",
        selectedModelId: "codex-alt",
        activeThreadSelectedModelId: null,
        hasActiveThread: false,
        engineModelsAsOptions: engineModels,
        engineSelectedModelIdByType: {},
        defaultClaudeModelId: "claude-fallback",
      }),
    ).toBe("codex-alt");
  });

  it("falls back to the configured claude default when no claude models are loaded yet", () => {
    expect(
      getEffectiveSelectedModelId({
        activeEngine: "claude",
        selectedModelId: "codex-alt",
        activeThreadSelectedModelId: null,
        hasActiveThread: false,
        engineModelsAsOptions: [],
        engineSelectedModelIdByType: {},
        defaultClaudeModelId: "claude-fallback",
      }),
    ).toBe("claude-fallback");
  });

  it("prefers a valid non-codex engine selection over defaults", () => {
    const engineSelectedModelIdByType: Partial<Record<EngineType, string | null>> = {
      gemini: "engine-alt",
    };
    expect(
      getEffectiveSelectedModelId({
        activeEngine: "gemini",
        selectedModelId: "codex-alt",
        activeThreadSelectedModelId: null,
        hasActiveThread: false,
        engineModelsAsOptions: engineModels,
        engineSelectedModelIdByType,
        defaultClaudeModelId: "claude-fallback",
      }),
    ).toBe("engine-alt");
  });

  it("falls back to the engine default when the saved non-codex selection is invalid", () => {
    const engineSelectedModelIdByType: Partial<Record<EngineType, string | null>> = {
      opencode: "missing-model",
    };
    expect(
      getEffectiveSelectedModelId({
        activeEngine: "opencode",
        selectedModelId: "codex-alt",
        activeThreadSelectedModelId: null,
        hasActiveThread: false,
        engineModelsAsOptions: engineModels,
        engineSelectedModelIdByType,
        defaultClaudeModelId: "claude-fallback",
      }),
    ).toBe("engine-default");
  });

  it("prefers the active thread model over the global engine selection", () => {
    const engineSelectedModelIdByType: Partial<Record<EngineType, string | null>> = {
      claude: "engine-default",
    };
    expect(
      getEffectiveSelectedModelId({
        activeEngine: "claude",
        selectedModelId: "codex-alt",
        activeThreadSelectedModelId: "engine-alt",
        hasActiveThread: true,
        engineModelsAsOptions: engineModels,
        engineSelectedModelIdByType,
        defaultClaudeModelId: "claude-fallback",
      }),
    ).toBe("engine-alt");
  });

  it("ignores the global engine selection for active threads without a stored model", () => {
    const engineSelectedModelIdByType: Partial<Record<EngineType, string | null>> = {
      claude: "engine-alt",
    };
    expect(
      getEffectiveSelectedModelId({
        activeEngine: "claude",
        selectedModelId: "codex-alt",
        activeThreadSelectedModelId: null,
        hasActiveThread: true,
        engineModelsAsOptions: engineModels,
        engineSelectedModelIdByType,
        defaultClaudeModelId: "claude-fallback",
      }),
    ).toBe("engine-default");
  });

  it("keeps the saved non-codex engine selection when it is still valid", () => {
    expect(
      getNextEngineSelectedModelId({
        activeEngine: "claude",
        engineModelsAsOptions: engineModels,
        currentSelection: "engine-alt",
      }),
    ).toBeNull();
  });

  it("suggests the engine default when the saved non-codex selection is missing", () => {
    expect(
      getNextEngineSelectedModelId({
        activeEngine: "opencode",
        engineModelsAsOptions: engineModels,
        currentSelection: "missing-model",
      }),
    ).toBe("engine-default");
  });

  it("exposes reasoning support only for codex", () => {
    expect(getEffectiveReasoningSupported("codex", true)).toBe(true);
    expect(getEffectiveReasoningSupported("gemini", true)).toBe(false);
  });
});
