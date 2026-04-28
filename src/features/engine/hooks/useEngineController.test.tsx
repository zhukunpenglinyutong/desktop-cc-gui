// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEngineController } from "./useEngineController";
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
import type { EngineStatus } from "../../../types";
import { STORAGE_KEYS as PROVIDER_STORAGE_KEYS } from "../../composer/types/provider";
import { STORAGE_KEYS as MODEL_STORAGE_KEYS } from "../../models/constants";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

vi.mock("../../../services/tauri", () => ({
  detectEngines: vi.fn(),
  getActiveEngine: vi.fn(),
  getEngineModels: vi.fn(),
  getOpenCodeCommandsList: vi.fn(),
  isWebServiceRuntime: vi.fn(),
  switchEngine: vi.fn(),
}));
vi.mock("../../../services/clientStorage", () => ({
  getClientStoreSync: vi.fn(),
  writeClientStoreValue: vi.fn(),
}));

const detectEnginesMock = vi.mocked(detectEngines);
const getActiveEngineMock = vi.mocked(getActiveEngine);
const getEngineModelsMock = vi.mocked(getEngineModels);
const getOpenCodeCommandsListMock = vi.mocked(getOpenCodeCommandsList);
const isWebServiceRuntimeMock = vi.mocked(isWebServiceRuntime);
const switchEngineMock = vi.mocked(switchEngine);
const getClientStoreSyncMock = vi.mocked(getClientStoreSync);
const writeClientStoreValueMock = vi.mocked(writeClientStoreValue);

describe("useEngineController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    isWebServiceRuntimeMock.mockReturnValue(false);
    getOpenCodeCommandsListMock.mockResolvedValue([]);
    switchEngineMock.mockResolvedValue(undefined);
    getClientStoreSyncMock.mockReturnValue(undefined);
    writeClientStoreValueMock.mockReset();
  });

  it("preserves default flag when custom claude model overrides same id", async () => {
    const claudeModels: EngineStatus["models"] = [
      {
        id: "claude-sonnet-4-6",
        displayName: "Sonnet 4.6",
        description: "default",
        isDefault: true,
      },
      {
        id: "claude-haiku-4-5",
        displayName: "Haiku 4.5",
        description: "",
        isDefault: false,
      },
    ];
    detectEnginesMock.mockResolvedValue([
      {
        engineType: "claude",
        installed: true,
        version: "1.0.0",
        binPath: null,
        features: {
          streaming: true,
          reasoning: true,
          toolUse: true,
          imageInput: true,
          sessionContinuation: true,
        },
        models: claudeModels,
        error: null,
      },
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValue(claudeModels);
    window.localStorage.setItem(
      PROVIDER_STORAGE_KEYS.CLAUDE_CUSTOM_MODELS,
      JSON.stringify([
        {
          id: "claude-sonnet-4-6",
          label: "Custom Sonnet Alias",
          description: "custom",
        },
      ]),
    );

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    await waitFor(() =>
      expect(result.current.engineModelsAsOptions.length).toBeGreaterThan(0),
    );

    const sonnet = result.current.engineModelsAsOptions.find(
      (model) => model.id === "claude-sonnet-4-6",
    );
    expect(sonnet).toBeDefined();
    expect(sonnet?.displayName).toBe("Custom Sonnet Alias");
    expect(sonnet?.isDefault).toBe(true);
  });

  it("passes mapped Claude model values through the runtime model field", async () => {
    const claudeModels: EngineStatus["models"] = [
      {
        id: "claude-sonnet-4-6",
        displayName: "Sonnet 4.6",
        description: "default",
        isDefault: true,
      },
    ];
    detectEnginesMock.mockResolvedValue([
      {
        engineType: "claude",
        installed: true,
        version: "1.0.0",
        binPath: null,
        features: {
          streaming: true,
          reasoning: true,
          toolUse: true,
          imageInput: true,
          sessionContinuation: true,
        },
        models: claudeModels,
        error: null,
      },
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValue(claudeModels);
    window.localStorage.setItem(
      MODEL_STORAGE_KEYS.CLAUDE_MODEL_MAPPING,
      JSON.stringify({ sonnet: "GLM-5.1" }),
    );

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    await waitFor(() =>
      expect(result.current.engineModelsAsOptions.length).toBeGreaterThan(0),
    );

    const sonnet = result.current.engineModelsAsOptions.find(
      (model) => model.id === "claude-sonnet-4-6",
    );
    expect(sonnet).toBeDefined();
    expect(sonnet?.displayName).toBe("GLM-5.1");
    expect(sonnet?.model).toBe("GLM-5.1");
  });

  it("loads legacy claude custom model entries even when label is missing", async () => {
    const claudeModels: EngineStatus["models"] = [
      {
        id: "claude-sonnet-4-6",
        displayName: "Sonnet 4.6",
        description: "default",
        isDefault: true,
      },
    ];
    detectEnginesMock.mockResolvedValue([
      {
        engineType: "claude",
        installed: true,
        version: "1.0.0",
        binPath: null,
        features: {
          streaming: true,
          reasoning: true,
          toolUse: true,
          imageInput: true,
          sessionContinuation: true,
        },
        models: claudeModels,
        error: null,
      },
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValue(claudeModels);
    window.localStorage.setItem(
      PROVIDER_STORAGE_KEYS.CLAUDE_CUSTOM_MODELS,
      JSON.stringify([
        {
          id: "GLM-5.1",
        },
      ]),
    );

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    await waitFor(() =>
      expect(result.current.engineModelsAsOptions.length).toBeGreaterThan(0),
    );

    const legacyModel = result.current.engineModelsAsOptions.find(
      (model) => model.id === "GLM-5.1",
    );
    expect(legacyModel).toBeDefined();
    expect(legacyModel?.displayName).toBe("GLM-5.1");
  });

  it("filters invalid/duplicate claude custom models while keeping valid legacy entries", async () => {
    const claudeModels: EngineStatus["models"] = [
      {
        id: "claude-sonnet-4-6",
        displayName: "Sonnet 4.6",
        description: "default",
        isDefault: true,
      },
    ];
    detectEnginesMock.mockResolvedValue([
      {
        engineType: "claude",
        installed: true,
        version: "1.0.0",
        binPath: null,
        features: {
          streaming: true,
          reasoning: true,
          toolUse: true,
          imageInput: true,
          sessionContinuation: true,
        },
        models: claudeModels,
        error: null,
      },
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValue(claudeModels);
    window.localStorage.setItem(
      PROVIDER_STORAGE_KEYS.CLAUDE_CUSTOM_MODELS,
      JSON.stringify([
        { id: "GLM-5.1", label: "GLM", description: "ok" },
        { id: "GLM-5.1", label: "GLM duplicated", description: "dup" },
        { id: "provider/model:202603[beta]" },
        { id: "bad model with spaces", label: "invalid" },
        null,
        { foo: "bar" },
      ]),
    );

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    await waitFor(() =>
      expect(result.current.engineModelsAsOptions.length).toBeGreaterThan(0),
    );

    const glmModels = result.current.engineModelsAsOptions.filter(
      (model) => model.id === "GLM-5.1",
    );
    expect(glmModels).toHaveLength(1);
    expect(glmModels[0]?.displayName).toBe("GLM");

    const bracketModel = result.current.engineModelsAsOptions.find(
      (model) => model.id === "provider/model:202603[beta]",
    );
    expect(bracketModel).toBeDefined();
    expect(bracketModel?.displayName).toBe("provider/model:202603[beta]");

    const invalidModel = result.current.engineModelsAsOptions.find(
      (model) => model.id === "bad model with spaces",
    );
    expect(invalidModel).toBeUndefined();
  });

  it("marks every engine as loading before detection finishes", () => {
    detectEnginesMock.mockImplementation(
      () => new Promise<EngineStatus[]>((_resolve) => undefined),
    );
    getActiveEngineMock.mockImplementation(
      () => new Promise<"claude">((_resolve) => undefined),
    );

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );

    expect(result.current.availableEngines).toHaveLength(4);
    expect(
      result.current.availableEngines.every(
        (engine) => engine.availabilityState === "loading",
      ),
    ).toBe(true);
  });

  it("keeps opencode ready without automatic provider health probing", async () => {
    detectEnginesMock.mockResolvedValue([
      {
        engineType: "claude",
        installed: true,
        version: "1.0.0",
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
      {
        engineType: "codex",
        installed: true,
        version: "1.0.0",
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
      {
        engineType: "gemini",
        installed: true,
        version: "1.0.0",
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
      {
        engineType: "opencode",
        installed: true,
        version: "1.4.4",
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
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValue([]);

    const { result } = renderHook(() =>
      useEngineController({
        activeWorkspace: {
          id: "ws-1",
          name: "mossx",
          path: "/tmp/mossx",
          connected: true,
          kind: "main",
          settings: {
            sidebarCollapsed: false,
            worktreeSetupScript: null,
          },
        },
      }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    const opencodeEngine = result.current.availableEngines.find(
      (engine) => engine.type === "opencode",
    );
    expect(opencodeEngine?.availabilityState).toBe("ready");
    expect(opencodeEngine?.availabilityLabelKey).toBeNull();
  });

  it("restores opencode through command fallback even when detectEngines omits the row", async () => {
    detectEnginesMock.mockResolvedValue([
      {
        engineType: "claude",
        installed: true,
        version: "1.0.0",
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
      {
        engineType: "codex",
        installed: true,
        version: "1.0.0",
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
      {
        engineType: "gemini",
        installed: true,
        version: "1.0.0",
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
    ]);
    getOpenCodeCommandsListMock.mockResolvedValue(["opencode"]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValue([]);

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    const opencodeEngine = result.current.availableEngines.find(
      (engine) => engine.type === "opencode",
    );
    expect(opencodeEngine?.installed).toBe(true);
    expect(opencodeEngine?.availabilityState).toBe("ready");
    expect(opencodeEngine?.version).toBe("unknown");
  });

  it("restores persisted engine selection when the stored engine is installed", async () => {
    detectEnginesMock.mockResolvedValue([
      {
        engineType: "claude",
        installed: true,
        version: "1.0.0",
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
      {
        engineType: "gemini",
        installed: true,
        version: "1.0.0",
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
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValue([]);
    getClientStoreSyncMock.mockReturnValue("gemini");

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    await waitFor(() => expect(result.current.activeEngine).toBe("gemini"));

    expect(switchEngineMock).toHaveBeenCalledWith("gemini");
  });

  it("refreshEngineModels reloads only the requested engine catalog", async () => {
    detectEnginesMock.mockResolvedValue([
      {
        engineType: "claude",
        installed: true,
        version: "1.0.0",
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
      {
        engineType: "opencode",
        installed: true,
        version: "1.4.4",
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
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValue([]);

    const { result } = renderHook(() =>
      useEngineController({
        activeWorkspace: {
          id: "ws-1",
          name: "mossx",
          path: "/tmp/mossx",
          connected: true,
          kind: "main",
          settings: {
            sidebarCollapsed: false,
            worktreeSetupScript: null,
          },
        },
      }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    expect(getEngineModelsMock).toHaveBeenCalledWith("claude");

    getEngineModelsMock.mockClear();

    await act(async () => {
      await result.current.refreshEngineModels("claude");
    });

    expect(getEngineModelsMock).toHaveBeenCalledTimes(1);
    expect(getEngineModelsMock).toHaveBeenCalledWith("claude");
    expect(getEngineModelsMock).not.toHaveBeenCalledWith("opencode");
  });

  it("does not refresh opencode when claude models are manually refreshed", async () => {
    detectEnginesMock.mockResolvedValue([
      {
        engineType: "claude",
        installed: true,
        version: "1.0.0",
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
      {
        engineType: "opencode",
        installed: true,
        version: "1.4.4",
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
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValue([]);

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    getEngineModelsMock.mockClear();

    await act(async () => {
      await result.current.refreshEngineModels("claude");
    });

    expect(getEngineModelsMock).toHaveBeenCalledTimes(1);
    expect(getEngineModelsMock).toHaveBeenCalledWith("claude");
    expect(getOpenCodeCommandsListMock).not.toHaveBeenCalled();
  });

  it("passes force refresh when manually reloading the requested engine catalog", async () => {
    detectEnginesMock.mockResolvedValue([
      {
        engineType: "claude",
        installed: true,
        version: "1.0.0",
        binPath: null,
        features: {
          streaming: true,
          reasoning: true,
          toolUse: true,
          imageInput: true,
          sessionContinuation: true,
        },
        models: [
          {
            id: "claude-sonnet-4-6",
            displayName: "Sonnet 4.6",
            description: "cached",
            isDefault: true,
          },
        ],
        error: null,
      },
      {
        engineType: "opencode",
        installed: true,
        version: "1.4.4",
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
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValueOnce([
      {
        id: "claude-sonnet-4-6",
        displayName: "Sonnet 4.6",
        description: "cached",
        isDefault: true,
      },
    ]);

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );

    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    getEngineModelsMock.mockClear();
    getEngineModelsMock.mockResolvedValueOnce([
      {
        id: "glm-5.1",
        displayName: "GLM-5.1",
        description: "Configured in ~/.claude/settings.json",
        isDefault: true,
      },
    ]);

    await act(async () => {
      await result.current.refreshEngineModels("claude", { forceRefresh: true });
    });

    expect(getEngineModelsMock).toHaveBeenCalledTimes(1);
    expect(getEngineModelsMock).toHaveBeenCalledWith("claude", {
      forceRefresh: true,
    });
    expect(getEngineModelsMock).not.toHaveBeenCalledWith("opencode");
    expect(result.current.engineModelsAsOptions[0]?.id).toBe("glm-5.1");
  });

  it("refreshes active engine models on workspace switch without probing unrelated engines", async () => {
    detectEnginesMock.mockResolvedValue([
      {
        engineType: "claude",
        installed: true,
        version: "1.0.0",
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
      {
        engineType: "opencode",
        installed: true,
        version: "1.4.4",
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
    ]);
    getActiveEngineMock.mockResolvedValue("claude");
    getEngineModelsMock.mockResolvedValue([]);

    const { rerender } = renderHook(
      ({ workspace }) => useEngineController({ activeWorkspace: workspace }),
      {
        initialProps: {
          workspace: {
            id: "ws-1",
            name: "mossx",
            path: "/tmp/mossx",
            connected: true,
            kind: "main" as const,
            settings: {
              sidebarCollapsed: false,
              worktreeSetupScript: null,
            },
          },
        },
      },
    );

    await waitFor(() => expect(getEngineModelsMock).toHaveBeenCalledWith("claude"));
    getEngineModelsMock.mockClear();

    rerender({
      workspace: {
        id: "ws-2",
        name: "mossx-2",
        path: "/tmp/mossx-2",
        connected: true,
        kind: "main" as const,
        settings: {
          sidebarCollapsed: false,
          worktreeSetupScript: null,
        },
      },
    });

    await waitFor(() => expect(getEngineModelsMock).toHaveBeenCalledWith("claude"));
    expect(getEngineModelsMock).not.toHaveBeenCalledWith("opencode");
  });

  it("reuses the in-flight engine detection when refresh is clicked during initial load", async () => {
    const detectDeferred = createDeferred<EngineStatus[]>();
    const activeEngineDeferred = createDeferred<"claude">();

    detectEnginesMock.mockReturnValueOnce(detectDeferred.promise);
    getActiveEngineMock.mockReturnValueOnce(activeEngineDeferred.promise);
    getEngineModelsMock.mockResolvedValue([]);

    const { result } = renderHook(() =>
      useEngineController({ activeWorkspace: null }),
    );

    expect(result.current.isDetecting).toBe(true);
    expect(detectEnginesMock).toHaveBeenCalledTimes(1);

    let refreshSettled = false;
    let refreshResult:
      | Awaited<ReturnType<typeof result.current.refreshEngines>>
      | undefined;
    let refreshPromise: Promise<void>;
    act(() => {
      refreshPromise = result.current.refreshEngines().then((value) => {
        refreshResult = value;
        refreshSettled = true;
      });
    });

    await Promise.resolve();
    expect(detectEnginesMock).toHaveBeenCalledTimes(1);
    expect(refreshSettled).toBe(false);

    detectDeferred.resolve([
      {
        engineType: "claude",
        installed: true,
        version: "1.0.0",
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
    ]);
    activeEngineDeferred.resolve("claude");

    await act(async () => {
      await refreshPromise;
    });
    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    expect(refreshSettled).toBe(true);
    expect(detectEnginesMock).toHaveBeenCalledTimes(1);
    expect(refreshResult?.availableEngines.find((engine) => engine.type === "claude")?.installed).toBe(true);
  });
});
