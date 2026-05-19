import { useEffect, useState } from "react";
import { getActiveEngine, getEngineStatus } from "../../../services/tauri";
import type { EngineType } from "../../../types";
import {
  getEngineCapabilityState,
  resolveEngineCapabilityRuntimeStatus,
  type EngineCapabilityKey,
  type EngineCapabilityState,
} from "../engineCapabilityMatrix";

export type CapabilityLookupState = {
  engine: EngineType | null;
  capability: EngineCapabilityKey;
  specState: EngineCapabilityState;
  runtimeState: EngineCapabilityState;
  available: boolean;
  supported: boolean;
  isLoading: boolean;
  error: string | null;
};

const UNKNOWN_RUNTIME_STATE: EngineCapabilityState = "unknown";

function createPendingCapabilityState(
  capability: EngineCapabilityKey,
  engine: EngineType | null,
): CapabilityLookupState {
  return {
    engine,
    capability,
    specState: "unknown",
    runtimeState: UNKNOWN_RUNTIME_STATE,
    available: false,
    supported: false,
    isLoading: true,
    error: null,
  };
}

function createSpecOnlyCapabilityState(
  engine: EngineType,
  capability: EngineCapabilityKey,
): CapabilityLookupState {
  const specState = getEngineCapabilityState(engine, capability);
  return {
    engine,
    capability,
    specState,
    runtimeState: UNKNOWN_RUNTIME_STATE,
    available: specState === "supported",
    supported: specState === "supported",
    isLoading: false,
    error: null,
  };
}

function normalizeCapabilityError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useCapability(
  capability: EngineCapabilityKey,
  engineOverride?: EngineType | null,
): CapabilityLookupState {
  const [state, setState] = useState<CapabilityLookupState>(() =>
    createPendingCapabilityState(capability, engineOverride ?? null),
  );

  useEffect(() => {
    let cancelled = false;
    setState(createPendingCapabilityState(capability, engineOverride ?? null));

    async function resolveCapability() {
      let resolvedEngine = engineOverride ?? null;
      try {
        resolvedEngine = engineOverride ?? (await getActiveEngine());
        const runtimeStatus = await getEngineStatus(resolvedEngine);
        const nextState = runtimeStatus
          ? (() => {
              const runtimeCapability = resolveEngineCapabilityRuntimeStatus(
                runtimeStatus,
                capability,
              );
              return {
                ...runtimeCapability,
                supported: runtimeCapability.available,
                isLoading: false,
                error: null,
              };
            })()
          : createSpecOnlyCapabilityState(resolvedEngine, capability);

        if (!cancelled) {
          setState(nextState);
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            ...createPendingCapabilityState(capability, resolvedEngine),
            isLoading: false,
            error: normalizeCapabilityError(error),
          });
        }
      }
    }

    void resolveCapability();

    return () => {
      cancelled = true;
    };
  }, [capability, engineOverride]);

  return state;
}
