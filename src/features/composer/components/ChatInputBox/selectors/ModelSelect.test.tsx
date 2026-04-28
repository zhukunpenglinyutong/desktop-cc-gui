// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ModelSelect } from "./ModelSelect";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params?.model
        ? `${key}:${params.model}`
        : params?.message
          ? `${key}:${params.message}`
          : key,
  }),
}));

vi.mock("@lobehub/icons", () => ({
  Claude: {
    Color: ({ size }: { size?: number }) => (
      <span data-testid="claude-icon" style={{ width: size, height: size }} />
    ),
  },
  Gemini: {
    Color: ({ size }: { size?: number }) => (
      <span data-testid="gemini-icon" style={{ width: size, height: size }} />
    ),
  },
}));

vi.mock("../../../../engine/components/EngineIcon", () => ({
  EngineIcon: ({ engine }: { engine: string }) => (
    <span data-testid={`${engine}-icon`} />
  ),
}));

describe("ModelSelect", () => {
  it("does not display the first model when no model value is selected", () => {
    render(
      <ModelSelect
        value=""
        currentProvider="codex"
        onChange={vi.fn()}
        models={[
          {
            id: "gpt-5.5",
            label: "gpt-5.5",
          },
        ]}
      />,
    );

    const buttonText = screen.getByRole("button").textContent ?? "";

    expect(buttonText).toContain("models.selectModel");
    expect(buttonText).not.toContain("gpt-5.5");
  });

  it("renders independent add model and refresh config footer actions", () => {
    const onAddModel = vi.fn();
    const onRefreshConfig = vi.fn();

    render(
      <ModelSelect
        value="gpt-5.5"
        currentProvider="codex"
        onChange={vi.fn()}
        onAddModel={onAddModel}
        onRefreshConfig={onRefreshConfig}
        models={[{ id: "gpt-5.5", label: "gpt-5.5" }]}
      />,
    );

    fireEvent.click(screen.getAllByRole("button")[0]);
    fireEvent.click(screen.getByRole("button", { name: "models.refreshConfig" }));

    expect(onRefreshConfig).toHaveBeenCalledTimes(1);
    expect(onAddModel).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "models.addModel" }));

    expect(onAddModel).toHaveBeenCalledTimes(1);
    expect(onRefreshConfig).toHaveBeenCalledTimes(1);
  });

  it("disables refresh config action while refreshing", () => {
    render(
      <ModelSelect
        value="claude-sonnet-4-6"
        currentProvider="claude"
        onChange={vi.fn()}
        onAddModel={vi.fn()}
        onRefreshConfig={vi.fn()}
        isRefreshingConfig
        models={[{ id: "claude-sonnet-4-6", label: "Sonnet" }]}
      />,
    );

    fireEvent.click(screen.getAllByRole("button")[0]);

    const refreshButton = screen.getByRole("button", {
      name: "models.refreshingConfig",
    });
    expect((refreshButton as HTMLButtonElement).disabled).toBe(true);
    expect(refreshButton.getAttribute("aria-busy")).toBe("true");
  });

  it("keeps the dropdown usable when refresh config fails", async () => {
    render(
      <ModelSelect
        value="gemini-2.5-flash"
        currentProvider="gemini"
        onChange={vi.fn()}
        onAddModel={vi.fn()}
        onRefreshConfig={vi.fn().mockRejectedValue(new Error("settings.json invalid"))}
        models={[{ id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" }]}
      />,
    );

    fireEvent.click(screen.getAllByRole("button")[0]);
    fireEvent.click(screen.getByRole("button", { name: "models.refreshConfig" }));

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toContain("settings.json invalid");
    });

    expect(screen.getAllByText("Gemini 2.5 Flash").length).toBeGreaterThan(0);
  });
});
