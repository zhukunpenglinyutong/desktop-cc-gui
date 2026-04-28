import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DebugEntry,
  EngineModelInfo,
  EngineStatus,
  EngineType,
  ModelOption,
  WorkspaceInfo,
} from "../../../types";
import {
  detectEngines,
  getActiveEngine,
  getEngineModels,
  getOpenCodeCommandsList,
  isWebServiceRuntime,
  switchEngine,
} from "../../../services/tauri";
import {
  getClientStoreSync,
  writeClientStoreValue,
} from "../../../services/clientStorage";
import { pushGlobalRuntimeNotice } from "../../../services/globalRuntimeNotices";
import {
  STORAGE_KEYS as MODEL_STORAGE_KEYS,
  getModelMapping,
  applyModelMapping as applyMappingToDisplayName,
  resolveModelMappingValue,
} from "../../models/constants";
import {
  STORAGE_KEYS as PROVIDER_STORAGE_KEYS,
  isValidModelId,
  validateCodexCustomModels,
} from "../../composer/types/provider";

type UseEngineControllerOptions = {
  activeWorkspace: WorkspaceInfo | null;
  onDebug?: (entry: DebugEntry) => void;
};

type RefreshEngineModelsOptions = {
  forceRefresh?: boolean;
};

/**
 * Engine display information for UI
 */
export type EngineDisplayInfo = {
  type: EngineType;
  displayName: string;
  shortName: string;
  installed: boolean;
  version: string | null;
  error: string | null;
  availabilityState?: "loading" | "ready" | "requires-login" | "unavailable";
  availabilityLabelKey?: string | null;
};

export type EngineRefreshResult = {
  availableEngines: EngineDisplayInfo[];
  activeEngine: EngineType;
};

/**
 * Map engine type to display information
 */
const ENGINE_DISPLAY_MAP: Record<
  EngineType,
  { displayName: string; shortName: string }
> = {
  claude: { displayName: "Claude Code", shortName: "Claude Code" },
  codex: { displayName: "Codex CLI", shortName: "Codex" },
  gemini: { displayName: "Gemini CLI", shortName: "Gemini" },
  opencode: { displayName: "OpenCode", shortName: "OpenCode" },
};

function buildAvailableEngines(
  engineStatuses: EngineStatus[],
  isInitialized: boolean,
): EngineDisplayInfo[] {
  return ENGINE_TYPES.map((engineType) => {
    const status = engineStatuses.find((entry) => entry.engineType === engineType) ?? null;
    const baseInfo = ENGINE_DISPLAY_MAP[engineType];
    let availabilityState: EngineDisplayInfo["availabilityState"] = "unavailable";
    let availabilityLabelKey: string | null = "sidebar.cliNotInstalled";

    if (!isInitialized) {
      availabilityState = "loading";
      availabilityLabelKey = "workspace.engineStatusLoading";
    } else if (status?.installed) {
      availabilityState = "ready";
      availabilityLabelKey = null;
    }

    return {
      type: engineType,
      displayName: baseInfo?.displayName ?? engineType,
      shortName: baseInfo?.shortName ?? engineType,
      installed: status?.installed ?? false,
      version: availabilityState === "loading" ? null : (status?.version ?? null),
      error: status?.error ?? null,
      availabilityState,
      availabilityLabelKey,
    };
  });
}

const GEMINI_VENDOR_UPDATED_EVENT = "ccgui:gemini-vendor-updated";
const WEB_RUNTIME_DEFAULT_ENGINE: EngineType = "codex";
const ENGINE_TYPES: EngineType[] = ["claude", "codex", "gemini", "opencode"];
const ENGINE_SELECTION_STORE = "composer";
const ENGINE_SELECTION_KEY = "selectedEngine";
const WEB_RUNTIME_INITIAL_STATUSES: EngineStatus[] = [
  {
    engineType: "codex",
    installed: true,
    version: "web-service",
    binPath: null,
    features: {
      streaming: true,
      reasoning: true,
      toolUse: true,
      imageInput: true,
      sessionContinuation: true,
    },
    models: [],
    error: null,
  },
];
const GEMINI_DEFAULT_MODEL_ID = "gemini-2.5-flash-lite";
const GEMINI_PRESET_MODEL_IDS = [
  "gemini-2.5-flash-lite",
  "gemini-3-flash-preview",
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-3.1-pro-preview",
] as const;

function normalizeGeminiModelEntry(
  model: Partial<EngineModelInfo> & { id: string },
): EngineModelInfo {
  const normalizedId = model.id.trim();
  return {
    id: normalizedId,
    displayName:
      model.displayName && model.displayName.trim().length > 0
        ? model.displayName.trim()
        : normalizedId,
    description: model.description?.trim() ?? "",
    isDefault: Boolean(model.isDefault),
  };
}

function appendGeminiPresetModels(models: EngineModelInfo[]): EngineModelInfo[] {
  const merged: EngineModelInfo[] = [];
  const seenIds = new Set<string>();

  const pushModel = (model: Partial<EngineModelInfo> & { id: string }) => {
    const normalized = normalizeGeminiModelEntry(model);
    if (!normalized.id || seenIds.has(normalized.id)) {
      return;
    }
    seenIds.add(normalized.id);
    merged.push(normalized);
  };

  models.forEach(pushModel);
  GEMINI_PRESET_MODEL_IDS.forEach((id) => {
    pushModel({ id, displayName: id, description: id, isDefault: false });
  });

  return merged;
}

function enforceGeminiDefaultModel(models: EngineModelInfo[]): EngineModelInfo[] {
  if (!models.some((model) => model.id === GEMINI_DEFAULT_MODEL_ID)) {
    return models;
  }
  return models.map((model) => ({
    ...model,
    isDefault: model.id === GEMINI_DEFAULT_MODEL_ID,
  }));
}

function readCustomGeminiModels(): EngineModelInfo[] {
  if (typeof window === "undefined" || !window.localStorage) {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(PROVIDER_STORAGE_KEYS.GEMINI_CUSTOM_MODELS);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    const models = validateCodexCustomModels(parsed);
    return models.map((model) => ({
      id: model.id,
      displayName: model.label?.trim() || model.id,
      description: model.description?.trim() ?? "",
      isDefault: false,
    }));
  } catch {
    return [];
  }
}

function readCustomClaudeModels(): EngineModelInfo[] {
  if (typeof window === "undefined" || !window.localStorage) {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(PROVIDER_STORAGE_KEYS.CLAUDE_CUSTOM_MODELS);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    const seenIds = new Set<string>();
    const models: EngineModelInfo[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const idValue = (entry as { id?: unknown }).id;
      if (typeof idValue !== "string") {
        continue;
      }
      const id = idValue.trim();
      if (!isValidModelId(id) || seenIds.has(id)) {
        continue;
      }
      const labelValue = (entry as { label?: unknown }).label;
      const descriptionValue = (entry as { description?: unknown }).description;
      models.push({
        id,
        displayName:
          typeof labelValue === "string" && labelValue.trim().length > 0
            ? labelValue.trim()
            : id,
        description:
          typeof descriptionValue === "string"
            ? descriptionValue.trim()
            : "",
        isDefault: false,
      });
      seenIds.add(id);
    }
    return models;
  } catch {
    return [];
  }
}

function mergeClaudeModelsPreserveDefault(
  engineModels: EngineModelInfo[],
  customModels: EngineModelInfo[],
): EngineModelInfo[] {
  if (customModels.length === 0) {
    return engineModels;
  }
  const engineDefaultIds = new Set(
    engineModels.filter((model) => model.isDefault).map((model) => model.id),
  );
  const patchedCustomModels = customModels.map((model) => ({
    ...model,
    isDefault: engineDefaultIds.has(model.id),
  }));
  const customIds = new Set(patchedCustomModels.map((model) => model.id));
  return [
    ...patchedCustomModels,
    ...engineModels.filter((model) => !customIds.has(model.id)),
  ];
}

function isSupportedEngineType(value: unknown): value is EngineType {
  return (
    value === "claude" ||
    value === "codex" ||
    value === "gemini" ||
    value === "opencode"
  );
}

function readPersistedEngineSelection(): EngineType | null {
  const stored = getClientStoreSync<string>(
    ENGINE_SELECTION_STORE,
    ENGINE_SELECTION_KEY,
  );
  return isSupportedEngineType(stored) ? stored : null;
}

function persistEngineSelection(engineType: EngineType) {
  writeClientStoreValue(
    ENGINE_SELECTION_STORE,
    ENGINE_SELECTION_KEY,
    engineType,
    { immediate: true },
  );
}

function createFallbackEngineStatus(
  engineType: EngineType,
  version: string | null = "unknown",
): EngineStatus {
  return {
    engineType,
    installed: true,
    version,
    binPath: null,
    features: {
      streaming: true,
      reasoning: true,
      toolUse: true,
      imageInput: engineType === "codex",
      sessionContinuation: true,
    },
    models: [],
    error: null,
  };
}

/**
 * Convert EngineModelInfo to ModelOption format for UI compatibility
 */
function engineModelToOption(model: EngineModelInfo): ModelOption {
  return {
    id: model.id,
    model: model.model ?? model.id,
    displayName: model.displayName,
    description: model.description,
    supportedReasoningEfforts: [],
    defaultReasoningEffort: null,
    isDefault: model.isDefault,
  };
}

/**
 * Hook for managing multi-engine state and selection
 */
export function useEngineController({
  activeWorkspace,
  onDebug,
}: UseEngineControllerOptions) {
  // Engine detection state
  const [engineStatuses, setEngineStatuses] = useState<EngineStatus[]>(() =>
    isWebServiceRuntime() ? WEB_RUNTIME_INITIAL_STATUSES : [],
  );
  const [activeEngine, setActiveEngineState] = useState<EngineType>(() =>
    isWebServiceRuntime() ? WEB_RUNTIME_DEFAULT_ENGINE : "claude",
  );
  const [engineModels, setEngineModels] = useState<EngineModelInfo[]>([]);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [modelMapping, setModelMapping] = useState(getModelMapping);
  const [customModelsVersion, setCustomModelsVersion] = useState(0);

  // Track initialization
  const initRef = useRef(false);
  const detectPromiseRef = useRef<Promise<EngineRefreshResult | void> | null>(null);
  const lastWorkspaceId = useRef<string | null>(null);
  const previousAvailabilityRef = useRef<
    Partial<Record<EngineType, EngineDisplayInfo["availabilityState"]>>
  >({});

  const workspaceId = activeWorkspace?.id ?? null;
  const isConnected = Boolean(activeWorkspace?.connected);

  const loadModelsForEngine = useCallback(
    async (
      engineType: EngineType,
      fallbackModels: EngineModelInfo[] = [],
      options: RefreshEngineModelsOptions = {},
    ) => {
      try {
        const models = options.forceRefresh
          ? await getEngineModels(engineType, { forceRefresh: true })
          : await getEngineModels(engineType);
        const nextModels = models.length > 0 ? models : fallbackModels;
        // Keep fallback instead of clearing to empty, avoids transient "-" model state.
        setEngineModels(nextModels);
        return nextModels;
      } catch (error) {
        onDebug?.({
          id: `${Date.now()}-engine-models-load-error`,
          timestamp: Date.now(),
          source: "error",
          label: "engine/models load error",
          payload: {
            engine: engineType,
            error: error instanceof Error ? error.message : String(error),
          },
        });
        setEngineModels(fallbackModels);
        return fallbackModels;
      }
    },
    [onDebug],
  );

  const refreshEngineModels = useCallback(
    async (
      engineType: EngineType,
      options: RefreshEngineModelsOptions = {},
    ) => {
      const status = engineStatuses.find((entry) => entry.engineType === engineType);
      if (!status?.installed) {
        return;
      }
      const nextModels = await loadModelsForEngine(
        engineType,
        status.models,
        options,
      );
      if (options.forceRefresh && nextModels.length > 0) {
        setEngineStatuses((currentStatuses) =>
          currentStatuses.map((entry) =>
            entry.engineType === engineType
              ? { ...entry, models: nextModels }
              : entry,
          ),
        );
      }
    },
    [engineStatuses, loadModelsForEngine],
  );

  /**
   * Detect all installed engines
   */
  const refreshEngines = useCallback(async () => {
    if (detectPromiseRef.current) {
      return await detectPromiseRef.current;
    }

    const detectPromise = (async () => {
      setIsDetecting(true);

      onDebug?.({
        id: `${Date.now()}-engine-detect`,
        timestamp: Date.now(),
        source: "client",
        label: "engine/detect",
        payload: {},
      });

      try {
        const [rawStatuses, detectedEngine] = await Promise.all([
          detectEngines(),
          getActiveEngine(),
        ]);
        let statuses = rawStatuses;
        const opencodeIndex = statuses.findIndex((s) => s.engineType === "opencode");
        const opencodeInstalled =
          opencodeIndex >= 0 ? statuses[opencodeIndex]?.installed : false;
        if (!opencodeInstalled) {
          try {
            const commands = await getOpenCodeCommandsList(false);
            if (Array.isArray(commands) && commands.length > 0) {
              if (opencodeIndex >= 0) {
                const existingStatus = statuses[opencodeIndex];
                if (!existingStatus) {
                  return;
                }
                statuses = [...statuses];
                statuses[opencodeIndex] = {
                  ...existingStatus,
                  installed: true,
                  error: null,
                  version: existingStatus.version ?? "unknown",
                };
              } else {
                statuses = [
                  ...statuses,
                  createFallbackEngineStatus("opencode"),
                ];
              }
            }
          } catch {
            // Keep backend detection result when fallback probe fails.
          }
        }

        let nextActiveEngine = detectedEngine;
        const persistedEngine = readPersistedEngineSelection();
        const persistedEngineInstalled = persistedEngine
          ? Boolean(
              statuses.find((status) => status.engineType === persistedEngine)
                ?.installed,
            )
          : false;
        if (
          persistedEngine &&
          persistedEngineInstalled &&
          persistedEngine !== detectedEngine
        ) {
          try {
            await switchEngine(persistedEngine);
            nextActiveEngine = persistedEngine;
          } catch (error) {
            onDebug?.({
              id: `${Date.now()}-engine-restore-selection-error`,
              timestamp: Date.now(),
              source: "error",
              label: "engine/restore persisted selection error",
              payload: {
                engine: persistedEngine,
                error: error instanceof Error ? error.message : String(error),
              },
            });
          }
        }

        onDebug?.({
          id: `${Date.now()}-engine-detect-result`,
          timestamp: Date.now(),
          source: "server",
          label: "engine/detect response",
          payload: { statuses, currentEngine: nextActiveEngine },
        });

        const nextAvailableEngines = buildAvailableEngines(statuses, true);

        setEngineStatuses(statuses);
        setActiveEngineState(nextActiveEngine);
        setIsInitialized(true);

        // Get models from the detected status first.
        const currentStatus = statuses.find((s) => s.engineType === nextActiveEngine);
        if (currentStatus?.installed && currentStatus.models.length > 0) {
          setEngineModels(currentStatus.models);
        } else {
          setEngineModels([]);
        }

        // For OpenCode, always refresh from CLI model list to ensure "all models"
        // are shown independent of provider login status.
        if (currentStatus?.installed) {
          await loadModelsForEngine(nextActiveEngine, currentStatus.models);
        }

        return {
          availableEngines: nextAvailableEngines,
          activeEngine: nextActiveEngine,
        };
      } catch (error) {
        onDebug?.({
          id: `${Date.now()}-engine-detect-error`,
          timestamp: Date.now(),
          source: "error",
          label: "engine/detect error",
          payload: error instanceof Error ? error.message : String(error),
        });
      } finally {
        detectPromiseRef.current = null;
        setIsDetecting(false);
      }
    })();

    detectPromiseRef.current = detectPromise;
    return await detectPromise;
  }, [loadModelsForEngine, onDebug]);

  /**
   * Switch to a different engine
   */
  const setActiveEngine = useCallback(
    async (engineType: EngineType) => {
      if (engineType === activeEngine) {
        return;
      }

      // Check if engine is installed
      const status = engineStatuses.find((s) => s.engineType === engineType);
      if (!status?.installed) {
        onDebug?.({
          id: `${Date.now()}-engine-switch-error`,
          timestamp: Date.now(),
          source: "error",
          label: "engine/switch error",
          payload: `Engine ${engineType} is not installed`,
        });
        return;
      }

      onDebug?.({
        id: `${Date.now()}-engine-switch`,
        timestamp: Date.now(),
        source: "client",
        label: "engine/switch",
        payload: { from: activeEngine, to: engineType },
      });

      try {
        await switchEngine(engineType);
        setActiveEngineState(engineType);
        persistEngineSelection(engineType);
        // Immediately switch visible model list to target engine snapshot to avoid
        // showing stale models from previous engine while CLI refresh is in flight.
        setEngineModels(status.models.length > 0 ? status.models : []);

        // Always refresh models from CLI and keep status models as fallback.
        await refreshEngineModels(engineType);

        onDebug?.({
          id: `${Date.now()}-engine-switch-success`,
          timestamp: Date.now(),
          source: "server",
          label: "engine/switch success",
          payload: { engine: engineType, models: status.models },
        });
      } catch (error) {
        onDebug?.({
          id: `${Date.now()}-engine-switch-error`,
          timestamp: Date.now(),
          source: "error",
          label: "engine/switch error",
          payload: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [activeEngine, engineStatuses, onDebug, refreshEngineModels],
  );

  /**
   * Get display information for all engines
   */
  const availableEngines = useMemo(
    () => buildAvailableEngines(engineStatuses, isInitialized),
    [engineStatuses, isInitialized],
  );

  /**
   * Get display information for installed engines only
   */
  const installedEngines = useMemo((): EngineDisplayInfo[] => {
    return availableEngines.filter((e) => e.installed);
  }, [availableEngines]);

  /**
   * Get current engine status
   */
  const currentEngineStatus = useMemo((): EngineStatus | null => {
    return engineStatuses.find((s) => s.engineType === activeEngine) ?? null;
  }, [engineStatuses, activeEngine]);

  /**
   * Get current engine display info
   */
  const currentEngineDisplay = useMemo((): EngineDisplayInfo | null => {
    return availableEngines.find((e) => e.type === activeEngine) ?? null;
  }, [availableEngines, activeEngine]);

  /**
   * Check if multiple engines are available
   */
  const hasMultipleEngines = useMemo(() => {
    return installedEngines.length > 1;
  }, [installedEngines]);

  const mappedEngineModels = useMemo((): EngineModelInfo[] => {
    // Keep memo output aligned with localStorage-backed custom model mutations.
    const storageRevision = customModelsVersion;
    void storageRevision;
    if (activeEngine === "gemini") {
      const customGeminiModels = readCustomGeminiModels();
      const customGeminiIds = new Set(
        customGeminiModels.map((model) => model.id),
      );
      const mergedModels =
        customGeminiModels.length === 0
          ? engineModels
          : [
              ...customGeminiModels,
              ...engineModels.filter(
                (model) => !customGeminiIds.has(model.id),
              ),
            ];
      return enforceGeminiDefaultModel(
        appendGeminiPresetModels(mergedModels),
      );
    }
    if (activeEngine !== "claude") {
      return engineModels;
    }
    const customClaudeModels = readCustomClaudeModels();
    const mergedModels = mergeClaudeModelsPreserveDefault(
      engineModels,
      customClaudeModels,
    );
    return mergedModels.map((model) => ({
      ...model,
      model: resolveModelMappingValue(model.id, modelMapping) ?? model.model,
      displayName: applyMappingToDisplayName(
        model.displayName,
        model.id,
        modelMapping,
      ),
    }));
  }, [activeEngine, engineModels, customModelsVersion, modelMapping]);

  /**
   * Convert engine models to ModelOption format for UI compatibility
   */
  const engineModelsAsOptions = useMemo((): ModelOption[] => {
    return mappedEngineModels.map(engineModelToOption);
  }, [mappedEngineModels]);

  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === MODEL_STORAGE_KEYS.CLAUDE_MODEL_MAPPING) {
        setModelMapping(getModelMapping());
      } else if (
        e.key === PROVIDER_STORAGE_KEYS.GEMINI_CUSTOM_MODELS ||
        e.key === PROVIDER_STORAGE_KEYS.CLAUDE_CUSTOM_MODELS
      ) {
        setCustomModelsVersion((value) => value + 1);
      }
    };

    const handleCustomStorageChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ key: string }>;
      if (customEvent.detail?.key === MODEL_STORAGE_KEYS.CLAUDE_MODEL_MAPPING) {
        setModelMapping(getModelMapping());
      } else if (
        customEvent.detail?.key === PROVIDER_STORAGE_KEYS.GEMINI_CUSTOM_MODELS ||
        customEvent.detail?.key === PROVIDER_STORAGE_KEYS.CLAUDE_CUSTOM_MODELS
      ) {
        setCustomModelsVersion((value) => value + 1);
      }
    };

    window.addEventListener("storage", handleStorageChange);
    window.addEventListener("localStorageChange", handleCustomStorageChange);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("localStorageChange", handleCustomStorageChange);
    };
  }, []);

  // Initialize on mount
  useEffect(() => {
    if (initRef.current) {
      return;
    }
    initRef.current = true;
    refreshEngines();
  }, [refreshEngines]);

  useEffect(() => {
    const handleGeminiVendorUpdated = () => {
      void refreshEngines();
    };

    window.addEventListener(
      GEMINI_VENDOR_UPDATED_EVENT,
      handleGeminiVendorUpdated,
    );
    return () => {
      window.removeEventListener(
        GEMINI_VENDOR_UPDATED_EVENT,
        handleGeminiVendorUpdated,
      );
    };
  }, [refreshEngines]);

  // Reset models when workspace changes
  useEffect(() => {
    if (workspaceId === lastWorkspaceId.current) {
      return;
    }
    lastWorkspaceId.current = workspaceId;
    // Optionally refresh models when workspace changes
    if (workspaceId && isConnected && currentEngineStatus?.installed) {
      void refreshEngineModels(activeEngine);
    }
  }, [
    workspaceId,
    isConnected,
    activeEngine,
    currentEngineStatus?.installed,
    refreshEngineModels,
  ]);

  useEffect(() => {
    if (!isInitialized) {
      return;
    }

    const previousAvailability = previousAvailabilityRef.current;
    const nextAvailability: Partial<
      Record<EngineType, EngineDisplayInfo["availabilityState"]>
    > = {};

    availableEngines.forEach((engine) => {
      const nextState = engine.availabilityState ?? (engine.installed ? "ready" : "unavailable");
      const previousState = previousAvailability[engine.type];
      nextAvailability[engine.type] = nextState;

      if (nextState === previousState) {
        return;
      }

      let severity: "info" | "warning" = "info";
      let messageKey: string | null = null;

      if (nextState === "requires-login") {
        severity = "warning";
        messageKey = "runtimeNotice.engine.requiresLogin";
      } else if (nextState === "unavailable") {
        severity = "warning";
        messageKey = "runtimeNotice.engine.unavailable";
      } else if (
        nextState === "ready" &&
        previousState != null &&
        previousState !== "ready"
      ) {
        messageKey = "runtimeNotice.engine.ready";
      }

      if (!messageKey) {
        return;
      }

      pushGlobalRuntimeNotice({
        severity,
        category: "diagnostic",
        messageKey,
        messageParams: {
          engine: engine.displayName,
        },
        dedupeKey: `engine:${engine.type}:${nextState}`,
      });
    });

    previousAvailabilityRef.current = nextAvailability;
  }, [availableEngines, isInitialized]);

  return {
    // State
    activeEngine,
    engineStatuses,
    engineModels,
    engineModelsAsOptions,
    isDetecting,
    isInitialized,

    // Computed
    availableEngines,
    installedEngines,
    currentEngineStatus,
    currentEngineDisplay,
    hasMultipleEngines,

    // Actions
    setActiveEngine,
    refreshEngines,
    refreshEngineModels,
  };
}
