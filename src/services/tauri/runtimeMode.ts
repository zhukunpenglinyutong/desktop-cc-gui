import type { EngineStatus, EngineType } from "../../types";

export const WEB_SERVICE_CLI_ENGINE_MESSAGE =
  "Web 服务当前仅支持 Codex CLI。请切换到 Codex CLI（Web service currently supports Codex CLI only）.";

let daemonEngineRpcSupported: boolean | null = null;

export function isMissingTauriInvokeError(error: unknown): boolean {
  return (
    error instanceof TypeError &&
    (error.message.includes("reading 'invoke'") ||
      error.message.includes('reading "invoke"'))
  );
}

export function normalizeInvokeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function isUnknownMethodError(error: unknown, method: string): boolean {
  return normalizeInvokeErrorMessage(error)
    .toLowerCase()
    .includes(`unknown method: ${method}`);
}

export function isWebServiceRuntime(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return window.__MOSSX_WEB_SERVICE__ === true;
}

export function shouldUseWebServiceFallback(): boolean {
  return isWebServiceRuntime();
}

export function isEngineRpcFallbackMode(): boolean {
  return shouldUseWebServiceFallback() && daemonEngineRpcSupported === false;
}

export function markDaemonEngineRpcSupported(
  supported: boolean | null,
): void {
  daemonEngineRpcSupported = supported;
}

function webServiceEngineFeatures(
  engineType: EngineType,
): EngineStatus["features"] {
  if (engineType === "codex") {
    return {
      streaming: true,
      reasoning: true,
      toolUse: true,
      imageInput: true,
      sessionContinuation: true,
    };
  }
  return {
    streaming: true,
    reasoning: true,
    toolUse: true,
    imageInput: false,
    sessionContinuation: true,
  };
}

export function webServiceCodexOnlyStatuses(): EngineStatus[] {
  const types: EngineType[] = ["claude", "codex", "gemini", "opencode"];
  return types.map((engineType) => ({
    engineType,
    installed: engineType === "codex",
    version: engineType === "codex" ? "web-service" : null,
    binPath: null,
    features: webServiceEngineFeatures(engineType),
    models: [],
    error:
      engineType === "codex" ? null : WEB_SERVICE_CLI_ENGINE_MESSAGE,
  }));
}

export function resetRuntimeModeStateForTests(): void {
  daemonEngineRpcSupported = null;
}
