import type { ComposerSessionSelection } from "./selectedComposerSession";
import type { EngineType, ModelOption } from "../types";

type GetEffectiveSelectedModelIdOptions = {
  activeEngine: EngineType;
  selectedModelId: string | null;
  activeThreadSelectedModelId: string | null;
  hasActiveThread: boolean;
  engineModelsAsOptions: ModelOption[];
  engineSelectedModelIdByType: Partial<Record<EngineType, string | null>>;
  defaultClaudeModelId: string;
};

type GetNextEngineSelectedModelIdOptions = {
  activeEngine: EngineType;
  engineModelsAsOptions: ModelOption[];
  currentSelection: string | null;
};

type GetEffectiveSelectedEffortOptions = {
  activeEngine: EngineType;
  hasActiveThread: boolean;
  selectedEffort: string | null;
  activeThreadSelection: ComposerSessionSelection | null;
};

function findModelById(models: ModelOption[], id: string | null) {
  if (!id) {
    return null;
  }
  return models.find((model) => model.id === id) ?? null;
}

function getDefaultModelId(models: ModelOption[]) {
  return models.find((model) => model.isDefault)?.id ?? models[0]?.id ?? null;
}

export function getEffectiveModels(
  activeEngine: EngineType,
  codexModels: ModelOption[],
  engineModelsAsOptions: ModelOption[],
) {
  return activeEngine === "codex" ? codexModels : engineModelsAsOptions;
}

export function getNextEngineSelectedModelId({
  activeEngine,
  engineModelsAsOptions,
  currentSelection,
}: GetNextEngineSelectedModelIdOptions) {
  if (activeEngine === "codex" || engineModelsAsOptions.length === 0) {
    return null;
  }
  if (findModelById(engineModelsAsOptions, currentSelection)) {
    return null;
  }
  return getDefaultModelId(engineModelsAsOptions);
}

export function getEffectiveSelectedModelId({
  activeEngine,
  selectedModelId,
  activeThreadSelectedModelId,
  hasActiveThread,
  engineModelsAsOptions,
  engineSelectedModelIdByType,
  defaultClaudeModelId,
}: GetEffectiveSelectedModelIdOptions) {
  if (activeEngine === "codex") {
    if (hasActiveThread) {
      return activeThreadSelectedModelId ?? selectedModelId;
    }
    return selectedModelId;
  }
  const engineSelection = engineSelectedModelIdByType[activeEngine] ?? null;
  if (engineModelsAsOptions.length === 0) {
    if (hasActiveThread) {
      return activeThreadSelectedModelId ?? (activeEngine === "claude" ? defaultClaudeModelId : null);
    }
    return activeEngine === "claude" ? engineSelection ?? defaultClaudeModelId : engineSelection;
  }
  if (hasActiveThread) {
    return (
      findModelById(engineModelsAsOptions, activeThreadSelectedModelId)?.id ??
      getDefaultModelId(engineModelsAsOptions)
    );
  }
  return (
    findModelById(engineModelsAsOptions, engineSelection)?.id ??
    getDefaultModelId(engineModelsAsOptions)
  );
}

export function getEffectiveSelectedEffort({
  activeEngine,
  hasActiveThread,
  selectedEffort,
  activeThreadSelection,
}: GetEffectiveSelectedEffortOptions) {
  if (activeEngine !== "codex" || !hasActiveThread) {
    return selectedEffort;
  }
  if (!activeThreadSelection) {
    return selectedEffort;
  }
  return activeThreadSelection.effort;
}

export function getEffectiveReasoningSupported(
  activeEngine: EngineType,
  codexReasoningSupported: boolean,
) {
  return activeEngine === "codex" ? codexReasoningSupported : false;
}
