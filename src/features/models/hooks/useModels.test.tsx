// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceInfo } from "../../../types";
import { getConfigModel, getModelList } from "../../../services/tauri";
import { STORAGE_KEYS } from "../../composer/types/provider";
import { useModels } from "./useModels";

vi.mock("../../../services/tauri", () => ({
  getModelList: vi.fn(),
  getConfigModel: vi.fn(),
}));

const workspace: WorkspaceInfo = {
  id: "workspace-1",
  name: "ccgui",
  path: "/tmp/codex",
  connected: true,
  settings: { sidebarCollapsed: false },
};

describe("useModels", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("adds the config model when it is missing from model/list", async () => {
    vi.mocked(getModelList).mockResolvedValueOnce({
      result: {
        data: [
          {
            id: "remote-1",
            model: "gpt-5.1",
            displayName: "GPT-5.1",
            supportedReasoningEfforts: [],
            defaultReasoningEffort: null,
            isDefault: true,
          },
        ],
      },
    });
    vi.mocked(getConfigModel).mockResolvedValueOnce("custom-model");

    const { result } = renderHook(() =>
      useModels({ activeWorkspace: workspace }),
    );

    await waitFor(() => expect(result.current.selectedModel?.model).toBe("custom-model"));

    expect(getConfigModel).toHaveBeenCalledWith("workspace-1");
    expect(result.current.models[0]).toMatchObject({
      id: "custom-model",
      model: "custom-model",
    });
    expect(result.current.selectedModel?.model).toBe("custom-model");
    expect(result.current.reasoningSupported).toBe(false);
  });

  it("prefers the provider entry when the config model matches by slug", async () => {
    vi.mocked(getModelList).mockResolvedValueOnce({
      result: {
        data: [
          {
            id: "provider-id",
            model: "custom-model",
            displayName: "Provider Custom",
            supportedReasoningEfforts: [
              { reasoningEffort: "medium", description: "Medium" },
              { reasoningEffort: "high", description: "High" },
            ],
            defaultReasoningEffort: "medium",
            isDefault: false,
          },
        ],
      },
    });
    vi.mocked(getConfigModel).mockResolvedValueOnce("custom-model");

    const { result } = renderHook(() =>
      useModels({ activeWorkspace: workspace }),
    );

    await waitFor(() => expect(result.current.selectedModelId).toBe("provider-id"));

    expect(result.current.models[0]?.id).toBe("provider-id");
    expect(result.current.models.some((model) => model.id === "gpt-5.5")).toBe(true);
    expect(result.current.selectedModel?.id).toBe("provider-id");
    expect(result.current.reasoningSupported).toBe(true);
  });

  it("keeps the selected reasoning effort when switching models", async () => {
    vi.mocked(getModelList).mockResolvedValueOnce({
      result: {
        data: [
          {
            id: "remote-1",
            model: "gpt-5.1",
            displayName: "GPT-5.1",
            supportedReasoningEfforts: [
              { reasoningEffort: "low", description: "Low" },
              { reasoningEffort: "medium", description: "Medium" },
            ],
            defaultReasoningEffort: "medium",
            isDefault: true,
          },
        ],
      },
    });
    vi.mocked(getConfigModel).mockResolvedValueOnce("custom-model");

    const { result } = renderHook(() =>
      useModels({ activeWorkspace: workspace }),
    );

    await waitFor(() => expect(result.current.models.some((model) => model.id === "custom-model")).toBe(true));

    act(() => {
      result.current.setSelectedEffort("high");
      result.current.setSelectedModelId("custom-model");
    });

    await waitFor(() => {
      expect(result.current.selectedModelId).toBe("custom-model");
      expect(result.current.selectedEffort).toBe("high");
    });
  });

  it("keeps a user-selected custom Codex model in the selectable model set", async () => {
    window.localStorage.setItem(
      STORAGE_KEYS.CODEX_CUSTOM_MODELS,
      JSON.stringify([{ id: "demo-model", label: "Demo" }]),
    );
    vi.mocked(getModelList).mockResolvedValueOnce({
      result: {
        data: [
          {
            id: "gpt-5.5",
            model: "gpt-5.5",
            displayName: "gpt-5.5",
            supportedReasoningEfforts: [],
            defaultReasoningEffort: "medium",
            isDefault: true,
          },
        ],
      },
    });
    vi.mocked(getConfigModel).mockResolvedValueOnce("gpt-5.5");

    const { result } = renderHook(() =>
      useModels({ activeWorkspace: workspace }),
    );

    await waitFor(() =>
      expect(result.current.models.some((model) => model.id === "demo-model")).toBe(true),
    );

    act(() => {
      result.current.setSelectedModelId("demo-model");
    });

    await waitFor(() => {
      expect(result.current.selectedModelId).toBe("demo-model");
      expect(result.current.selectedModel?.displayName).toBe("Demo");
    });
  });

  it("waits for persisted composer settings before choosing the Codex default model", async () => {
    window.localStorage.setItem(
      STORAGE_KEYS.CODEX_CUSTOM_MODELS,
      JSON.stringify([{ id: "demo-model", label: "Demo" }]),
    );
    vi.mocked(getModelList).mockResolvedValueOnce({
      result: {
        data: [
          {
            id: "gpt-5.5",
            model: "gpt-5.5",
            displayName: "gpt-5.5",
            supportedReasoningEfforts: [],
            defaultReasoningEffort: "medium",
            isDefault: true,
          },
        ],
      },
    });
    vi.mocked(getConfigModel).mockResolvedValueOnce("gpt-5.5");

    type HookProps = {
      preferredModelId: string | null;
      preferredSelectionReady: boolean;
    };
    const initialProps: HookProps = {
      preferredModelId: null,
      preferredSelectionReady: false,
    };

    const { result, rerender } = renderHook(
      ({ preferredModelId, preferredSelectionReady }: HookProps) =>
        useModels({
          activeWorkspace: workspace,
          preferredModelId,
          preferredSelectionReady,
        }),
      {
        initialProps,
      },
    );

    await waitFor(() =>
      expect(result.current.models.some((model) => model.id === "gpt-5.5")).toBe(true),
    );

    expect(result.current.selectedModelId).toBeNull();

    rerender({
      preferredModelId: "demo-model",
      preferredSelectionReady: true,
    });

    await waitFor(() => {
      expect(result.current.selectedModelId).toBe("demo-model");
      expect(result.current.selectedModel?.displayName).toBe("Demo");
    });
  });

  it("resets the user-selected model and effort when the selection scope changes within the same workspace", async () => {
    vi.mocked(getModelList).mockResolvedValueOnce({
      result: {
        data: [
          {
            id: "gpt-5.5",
            model: "gpt-5.5",
            displayName: "gpt-5.5",
            supportedReasoningEfforts: [
              { reasoningEffort: "medium", description: "Medium" },
            ],
            defaultReasoningEffort: "medium",
            isDefault: true,
          },
        ],
      },
    });
    vi.mocked(getConfigModel).mockResolvedValueOnce("gpt-5.5");

    type HookProps = {
      preferredModelId: string | null;
      preferredEffort: string | null;
      selectionScopeKey: string;
    };

    const { result, rerender } = renderHook(
      ({ preferredModelId, preferredEffort, selectionScopeKey }: HookProps) =>
        useModels({
          activeWorkspace: workspace,
          preferredModelId,
          preferredEffort,
          preferredSelectionReady: true,
          selectionScopeKey,
        }),
      {
        initialProps: {
          preferredModelId: "gpt-5.5",
          preferredEffort: "medium",
          selectionScopeKey: "ws-1:thread-a",
        },
      },
    );

    await waitFor(() => {
      expect(result.current.selectedModelId).toBe("gpt-5.5");
      expect(result.current.selectedEffort).toBe("medium");
    });

    act(() => {
      result.current.setSelectedEffort("high");
    });

    await waitFor(() => {
      expect(result.current.selectedEffort).toBe("high");
    });

    rerender({
      preferredModelId: "gpt-5.5",
      preferredEffort: "medium",
      selectionScopeKey: "ws-1:thread-b",
    });

    await waitFor(() => {
      expect(result.current.selectedModelId).toBe("gpt-5.5");
      expect(result.current.selectedEffort).toBe("medium");
    });
  });
});
