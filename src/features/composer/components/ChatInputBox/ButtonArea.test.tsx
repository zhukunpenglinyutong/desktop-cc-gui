// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEYS } from "../../types/provider";
import { ButtonArea } from "./ButtonArea";

vi.mock("./selectors", () => ({
  ConfigSelect: () => <div data-testid="config-select" />,
  ModelSelect: ({
    models,
    onAddModel,
    onRefreshConfig,
    isRefreshingConfig,
  }: {
    models: Array<{ id: string; label?: string }>;
    onAddModel?: () => void;
    onRefreshConfig?: () => void;
    isRefreshingConfig?: boolean;
  }) => (
    <div>
      <div data-testid="model-select">
        {models.map((model) => `${model.id}:${model.label ?? model.id}`).join(",")}
      </div>
      {onAddModel && (
        <button type="button" data-testid="model-add" onClick={onAddModel}>
          add
        </button>
      )}
      {onRefreshConfig && (
        <button type="button" data-testid="model-refresh" onClick={onRefreshConfig}>
          refresh
        </button>
      )}
      <span data-testid="model-refreshing">{isRefreshingConfig ? "yes" : "no"}</span>
    </div>
  ),
  ModeSelect: () => <div data-testid="mode-select" />,
  ProviderSelect: () => <div data-testid="provider-select" />,
  ReasoningSelect: () => <div data-testid="reasoning-select" />,
  ShortcutActionsSelect: () => <div data-testid="shortcut-actions-select" />,
}));

describe("ButtonArea custom model storage refresh", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("refreshes the rendered model list after same-tab custom model updates", async () => {
    render(
      <ButtonArea
        currentProvider="claude"
        models={[]}
        selectedModel=""
        hasInputContent
        onSubmit={vi.fn()}
        shortcutActions={[]}
      />,
    );

    expect(screen.getByTestId("model-select").textContent).not.toContain("claude-custom-alpha");

    act(() => {
      window.localStorage.setItem(
        STORAGE_KEYS.CLAUDE_CUSTOM_MODELS,
        JSON.stringify([{ id: "claude-custom-alpha", label: "Claude Custom Alpha" }]),
      );
      window.dispatchEvent(
        new CustomEvent("localStorageChange", {
          detail: { key: STORAGE_KEYS.CLAUDE_CUSTOM_MODELS },
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("model-select").textContent).toContain("claude-custom-alpha");
    });
  });

  it("merges Codex config/runtime models with built-in fallback models", () => {
    render(
      <ButtonArea
        currentProvider="codex"
        models={[
          {
            id: "gpt-5.5",
            label: "gpt-5.5 (config)",
          },
        ]}
        selectedModel="gpt-5.5"
        hasInputContent
        onSubmit={vi.fn()}
        shortcutActions={[]}
      />,
    );

    const modelList = screen.getByTestId("model-select").textContent ?? "";

    expect(modelList).toContain("gpt-5.5:gpt-5.5 (config)");
    expect(modelList).toContain("gpt-5.4:gpt-5.4");
    expect(modelList).toContain("gpt-5.3-codex:gpt-5.3-codex");
    expect(modelList.match(/gpt-5\.5:/g)).toHaveLength(1);
  });

  it("keeps custom Codex model labels while deduplicating built-in matches", () => {
    window.localStorage.setItem(
      STORAGE_KEYS.CODEX_CUSTOM_MODELS,
      JSON.stringify([{ id: "gpt-5.4", label: "My GPT 5.4" }]),
    );

    render(
      <ButtonArea
        currentProvider="codex"
        models={[]}
        selectedModel=""
        hasInputContent
        onSubmit={vi.fn()}
        shortcutActions={[]}
      />,
    );

    const modelList = screen.getByTestId("model-select").textContent ?? "";

    expect(modelList).toContain("gpt-5.4:My GPT 5.4");
    expect(modelList.match(/gpt-5\.4:/g)).toHaveLength(1);
    expect(modelList).toContain("gpt-5.5:gpt-5.5");
  });

  it("routes add model and refresh config actions to the current provider", () => {
    const onAddModel = vi.fn();
    const onRefreshModelConfig = vi.fn();

    render(
      <ButtonArea
        currentProvider="gemini"
        models={[]}
        selectedModel=""
        hasInputContent
        onSubmit={vi.fn()}
        onAddModel={onAddModel}
        onRefreshModelConfig={onRefreshModelConfig}
        isModelConfigRefreshing
        shortcutActions={[]}
      />,
    );

    act(() => {
      screen.getByTestId("model-add").click();
      screen.getByTestId("model-refresh").click();
    });

    expect(onAddModel).toHaveBeenCalledWith("gemini");
    expect(onRefreshModelConfig).toHaveBeenCalledWith("gemini");
    expect(screen.getByTestId("model-refreshing").textContent).toBe("yes");
  });
});
