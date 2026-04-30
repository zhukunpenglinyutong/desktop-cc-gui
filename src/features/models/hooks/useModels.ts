import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DebugEntry, ModelOption, WorkspaceInfo } from "../../../types";
import { getConfigModel, getModelList } from "../../../services/tauri";
import { CODEX_MODEL_CATALOG } from "../codexModelCatalog";
import {
  STORAGE_KEYS as PROVIDER_STORAGE_KEYS,
  validateCodexCustomModels,
} from "../../composer/types/provider";
import {
  STORAGE_KEYS,
  getModelMapping,
  applyModelMapping as applyMappingToDisplayName,
} from "../constants";

type UseModelsOptions = {
  activeWorkspace: WorkspaceInfo | null;
  onDebug?: (entry: DebugEntry) => void;
  preferredModelId?: string | null;
  preferredEffort?: string | null;
  preferredSelectionReady?: boolean;
  selectionScopeKey?: string;
};

const CONFIG_MODEL_DESCRIPTION = "Configured in CODEX_HOME/config.toml";

const createModelOption = (
  id: string,
  displayName: string,
  description = "",
): ModelOption => ({
  id,
  model: id,
  displayName,
  description,
  supportedReasoningEfforts: [],
  defaultReasoningEffort: null,
  isDefault: false,
});

const normalizeModelIdentity = (model: ModelOption): string => {
  const modelId = model.model.trim().toLowerCase();
  if (modelId.length > 0) {
    return modelId;
  }
  return model.id.trim().toLowerCase();
};

const mergeModelOption = (existing: ModelOption, next: ModelOption): ModelOption => ({
  ...existing,
  id: next.id || existing.id,
  model: next.model || existing.model,
  displayName: next.displayName || existing.displayName,
  description: next.description || existing.description,
});

const upsertModelOption = (
  mergedModels: ModelOption[],
  seenIdentities: Map<string, number>,
  model: ModelOption,
  replaceExisting = false,
) => {
  const identity = normalizeModelIdentity(model);
  if (identity.length === 0) {
    return;
  }
  const existingIndex = seenIdentities.get(identity);
  if (existingIndex === undefined) {
    seenIdentities.set(identity, mergedModels.length);
    mergedModels.push(model);
    return;
  }
  if (replaceExisting) {
    mergedModels[existingIndex] = mergeModelOption(mergedModels[existingIndex], model);
  }
};

const readCustomCodexModelOptions = (): ModelOption[] => {
  if (typeof window === "undefined" || !window.localStorage) {
    return [];
  }
  try {
    const stored = window.localStorage.getItem(PROVIDER_STORAGE_KEYS.CODEX_CUSTOM_MODELS);
    if (!stored) {
      return [];
    }
    return validateCodexCustomModels(JSON.parse(stored)).map((model) =>
      createModelOption(model.id, model.label, model.description ?? ""),
    );
  } catch {
    return [];
  }
};

const getBuiltInCodexModelOptions = (): ModelOption[] =>
  CODEX_MODEL_CATALOG.map((model) =>
    createModelOption(model.id, model.label, model.description),
  );

const mergeCodexSelectableModels = (baseModels: ModelOption[]): ModelOption[] => {
  const mergedModels: ModelOption[] = [];
  const seenIdentities = new Map<string, number>();

  baseModels.forEach((model) => upsertModelOption(mergedModels, seenIdentities, model));
  readCustomCodexModelOptions().forEach((model) =>
    upsertModelOption(mergedModels, seenIdentities, model, true),
  );
  getBuiltInCodexModelOptions().forEach((model) =>
    upsertModelOption(mergedModels, seenIdentities, model),
  );

  return mergedModels;
};

const normalizeEffort = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const findModelByIdOrModel = (
  models: ModelOption[],
  idOrModel: string | null,
): ModelOption | null => {
  if (!idOrModel) {
    return null;
  }
  return (
    models.find((model) => model.id === idOrModel) ??
    models.find((model) => model.model === idOrModel) ??
    null
  );
};

const pickDefaultModel = (models: ModelOption[], configModel: string | null) =>
  findModelByIdOrModel(models, configModel) ??
  models.find((model) => model.isDefault) ??
  models[0] ??
  null;

export function useModels({
  activeWorkspace,
  onDebug,
  preferredModelId = null,
  preferredEffort = null,
  preferredSelectionReady = true,
  selectionScopeKey,
}: UseModelsOptions) {
  const [rawModels, setRawModels] = useState<ModelOption[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [configModel, setConfigModel] = useState<string | null>(null);
  const [selectedModelId, setSelectedModelIdState] = useState<string | null>(null);
  const [selectedEffort, setSelectedEffortState] = useState<string | null>(null);
  const [modelMappingVersion, setModelMappingVersion] = useState(0);
  const lastFetchedWorkspaceId = useRef<string | null>(null);
  const inFlight = useRef(false);
  const hasUserSelectedModel = useRef(false);
  const hasUserSelectedEffort = useRef(false);
  const lastWorkspaceId = useRef<string | null>(null);
  const lastSelectionScopeKey = useRef<string | null>(selectionScopeKey ?? null);

  const workspaceId = activeWorkspace?.id ?? null;
  const isConnected = Boolean(activeWorkspace?.connected);

  // Apply model mapping to raw models
  useEffect(() => {
    const mapping = getModelMapping();
    const mappedModels = rawModels.map((model) => ({
      ...model,
      displayName: applyMappingToDisplayName(model.displayName, model.id, mapping),
    }));
    setModels(mergeCodexSelectableModels(mappedModels));
  }, [rawModels, modelMappingVersion]);

  // Listen for localStorage changes (cross-tab sync + custom events)
  useEffect(() => {
    const isRelevantStorageKey = (key: string | null | undefined) =>
      key === STORAGE_KEYS.CLAUDE_MODEL_MAPPING ||
      key === PROVIDER_STORAGE_KEYS.CODEX_CUSTOM_MODELS;

    const handleStorageChange = (e: StorageEvent) => {
      if (isRelevantStorageKey(e.key)) {
        setModelMappingVersion((v) => v + 1);
      }
    };

    const handleCustomStorageChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ key: string }>;
      if (isRelevantStorageKey(customEvent.detail?.key)) {
        setModelMappingVersion((v) => v + 1);
      }
    };

    window.addEventListener("storage", handleStorageChange);
    window.addEventListener("localStorageChange", handleCustomStorageChange);

    // Initial read of model mapping in case it was set before we started listening
    const initialMapping = getModelMapping();
    const hasMapping = Object.keys(initialMapping).length > 0;
    const hasCustomCodexModels = readCustomCodexModelOptions().length > 0;
    if (hasMapping || hasCustomCodexModels) {
      // Trigger a re-apply of model mapping
      setModelMappingVersion((v) => v + 1);
    }

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("localStorageChange", handleCustomStorageChange);
    };
  }, []);

  useEffect(() => {
    if (workspaceId === lastWorkspaceId.current) {
      return;
    }
    hasUserSelectedModel.current = false;
    hasUserSelectedEffort.current = false;
    lastWorkspaceId.current = workspaceId;
    setConfigModel(null);
  }, [workspaceId]);

  useEffect(() => {
    const nextSelectionScopeKey = selectionScopeKey ?? null;
    if (nextSelectionScopeKey === lastSelectionScopeKey.current) {
      return;
    }
    hasUserSelectedModel.current = false;
    hasUserSelectedEffort.current = false;
    lastSelectionScopeKey.current = nextSelectionScopeKey;
  }, [selectionScopeKey]);

  useEffect(() => {
    if (selectedEffort === null) {
      return;
    }
    if (selectedEffort.trim().length > 0) {
      return;
    }
    hasUserSelectedEffort.current = false;
    setSelectedEffortState(null);
  }, [selectedEffort]);

  const setSelectedModelId = useCallback((next: string | null) => {
    hasUserSelectedModel.current = true;
    setSelectedModelIdState(next);
  }, []);

  const setSelectedEffort = useCallback((next: string | null) => {
    hasUserSelectedEffort.current = true;
    setSelectedEffortState(next);
  }, []);

  const selectedModel = useMemo(
    () => models.find((model) => model.id === selectedModelId) ?? null,
    [models, selectedModelId],
  );

  const reasoningSupported = useMemo(() => {
    if (!selectedModel) {
      return false;
    }
    return (
      selectedModel.supportedReasoningEfforts.length > 0 ||
      selectedModel.defaultReasoningEffort !== null
    );
  }, [selectedModel]);

  const reasoningOptions = useMemo(() => {
    const supported = selectedModel?.supportedReasoningEfforts.map(
      (effort) => effort.reasoningEffort,
    );
    if (supported && supported.length > 0) {
      return supported;
    }
    const defaultEffort = normalizeEffort(selectedModel?.defaultReasoningEffort);
    return defaultEffort ? [defaultEffort] : [];
  }, [selectedModel]);

  const resolveEffort = useCallback(
    (model: ModelOption, preferCurrent: boolean) => {
      const supportedEfforts = model.supportedReasoningEfforts.map(
        (effort) => effort.reasoningEffort,
      );
      const currentEffort = normalizeEffort(selectedEffort);
      if (preferCurrent && currentEffort) {
        return currentEffort;
      }
      if (supportedEfforts.length === 0) {
        return normalizeEffort(preferredEffort);
      }
      const preferred = normalizeEffort(preferredEffort);
      if (preferred && supportedEfforts.includes(preferred)) {
        return preferred;
      }
      return normalizeEffort(model.defaultReasoningEffort);
    },
    [preferredEffort, selectedEffort],
  );

  const refreshModels = useCallback(async () => {
    if (!workspaceId || !isConnected) {
      return;
    }
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    onDebug?.({
      id: `${Date.now()}-client-model-list`,
      timestamp: Date.now(),
      source: "client",
      label: "model/list",
      payload: { workspaceId },
    });
    try {
      const [modelListResult, configModelResult] = await Promise.allSettled([
        getModelList(workspaceId),
        getConfigModel(workspaceId),
      ]);
      const configModelFromConfig =
        configModelResult.status === "fulfilled"
          ? configModelResult.value
          : null;
      if (configModelResult.status === "rejected") {
        onDebug?.({
          id: `${Date.now()}-client-config-model-error`,
          timestamp: Date.now(),
          source: "error",
          label: "config/model error",
          payload:
            configModelResult.reason instanceof Error
              ? configModelResult.reason.message
              : String(configModelResult.reason),
        });
      }
      const response =
        modelListResult.status === "fulfilled" ? modelListResult.value : null;
      if (modelListResult.status === "rejected") {
        onDebug?.({
          id: `${Date.now()}-client-model-list-error`,
          timestamp: Date.now(),
          source: "error",
          label: "model/list error",
          payload:
            modelListResult.reason instanceof Error
              ? modelListResult.reason.message
              : String(modelListResult.reason),
        });
      }
      onDebug?.({
        id: `${Date.now()}-server-model-list`,
        timestamp: Date.now(),
        source: "server",
        label: "model/list response",
        payload: response,
      });
      setConfigModel(configModelFromConfig);
      const rawData = response?.result?.data ?? response?.data ?? [];
      const dataFromServer: ModelOption[] = rawData.map((item: any) => ({
        id: String(item.id ?? item.model ?? ""),
        model: String(item.model ?? item.id ?? ""),
        displayName: String(item.displayName ?? item.display_name ?? item.model ?? ""),
        description: String(item.description ?? ""),
        supportedReasoningEfforts: Array.isArray(item.supportedReasoningEfforts)
          ? item.supportedReasoningEfforts
          : Array.isArray(item.supported_reasoning_efforts)
            ? item.supported_reasoning_efforts.map((effort: any) => ({
                reasoningEffort: String(
                  effort.reasoningEffort ?? effort.reasoning_effort ?? "",
                ),
                description: String(effort.description ?? ""),
              }))
            : [],
        defaultReasoningEffort: normalizeEffort(
          item.defaultReasoningEffort ?? item.default_reasoning_effort,
        ),
        isDefault: Boolean(item.isDefault ?? item.is_default ?? false),
      }));
      const data = (() => {
        if (!configModelFromConfig) {
          return dataFromServer;
        }
        const hasConfigModel = dataFromServer.some(
          (model) => model.model === configModelFromConfig,
        );
        if (hasConfigModel) {
          return dataFromServer;
        }
        const configOption: ModelOption = {
          id: configModelFromConfig,
          model: configModelFromConfig,
          displayName: `${configModelFromConfig} (config)`,
          description: CONFIG_MODEL_DESCRIPTION,
          supportedReasoningEfforts: [],
          defaultReasoningEffort: null,
          isDefault: false,
        };
        return [configOption, ...dataFromServer];
      })();
      const selectableData = mergeCodexSelectableModels(data);
      setRawModels(data);
      lastFetchedWorkspaceId.current = workspaceId;
      if (!preferredSelectionReady && !hasUserSelectedModel.current) {
        return;
      }
      const defaultModel = pickDefaultModel(selectableData, configModelFromConfig);
      const existingSelection = findModelByIdOrModel(selectableData, selectedModelId);
      if (selectedModelId && !existingSelection) {
        hasUserSelectedModel.current = false;
      }
      const preferredSelection = findModelByIdOrModel(selectableData, preferredModelId);
      const shouldKeepExisting =
        hasUserSelectedModel.current && existingSelection !== null;
      const nextSelection =
        (shouldKeepExisting ? existingSelection : null) ??
        preferredSelection ??
        defaultModel ??
        existingSelection;
      if (nextSelection) {
        if (nextSelection.id !== selectedModelId) {
          setSelectedModelIdState(nextSelection.id);
        }
        const nextEffort = resolveEffort(
          nextSelection,
          hasUserSelectedEffort.current,
        );
        if (nextEffort !== selectedEffort) {
          setSelectedEffortState(nextEffort);
        }
      }
    } finally {
      inFlight.current = false;
    }
  }, [
    isConnected,
    onDebug,
    preferredModelId,
    preferredSelectionReady,
    selectedEffort,
    selectedModelId,
    resolveEffort,
    workspaceId,
  ]);

  useEffect(() => {
    if (!workspaceId || !isConnected) {
      return;
    }
    if (lastFetchedWorkspaceId.current === workspaceId && rawModels.length > 0) {
      return;
    }
    refreshModels();
  }, [isConnected, rawModels.length, refreshModels, workspaceId]);

  useEffect(() => {
    if (!selectedModel) {
      return;
    }
    const currentEffort = normalizeEffort(selectedEffort);
    if (currentEffort) {
      return;
    }
    const nextEffort = normalizeEffort(selectedModel.defaultReasoningEffort);
    if (nextEffort === null) {
      return;
    }
    hasUserSelectedEffort.current = false;
    setSelectedEffortState(nextEffort);
  }, [selectedEffort, selectedModel]);

  useEffect(() => {
    if (!models.length) {
      return;
    }
    if (!preferredSelectionReady && !hasUserSelectedModel.current) {
      return;
    }
    const preferredSelection = findModelByIdOrModel(models, preferredModelId);
    const defaultModel = pickDefaultModel(models, configModel);
    const existingSelection = findModelByIdOrModel(models, selectedModelId);
    if (selectedModelId && !existingSelection) {
      hasUserSelectedModel.current = false;
    }
    const shouldKeepUserSelection =
      hasUserSelectedModel.current && existingSelection !== null;
    if (shouldKeepUserSelection) {
      return;
    }
    const nextSelection =
      preferredSelection ?? defaultModel ?? existingSelection ?? null;
    if (!nextSelection) {
      return;
    }
    if (nextSelection.id !== selectedModelId) {
      setSelectedModelIdState(nextSelection.id);
    }
    const nextEffort = resolveEffort(nextSelection, hasUserSelectedEffort.current);
    if (nextEffort !== selectedEffort) {
      setSelectedEffortState(nextEffort);
    }
  }, [
    configModel,
    models,
    preferredModelId,
    preferredSelectionReady,
    selectedEffort,
    selectedModelId,
    resolveEffort,
    selectionScopeKey,
  ]);

  return {
    models,
    selectedModel,
    reasoningSupported,
    selectedModelId,
    setSelectedModelId,
    reasoningOptions,
    selectedEffort,
    setSelectedEffort,
    refreshModels,
  };
}
