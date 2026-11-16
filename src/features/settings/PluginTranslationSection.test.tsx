import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineCatalog, EngineInfo } from "@/lib/ipc";

const listEngineModels = vi.hoisted(() =>
  vi.fn(async (_engine: string): Promise<EngineCatalog> => ({
    models: [
      { id: "haiku", name: "Haiku", provider: "anthropic" },
      { id: "sonnet", name: "Sonnet", provider: "anthropic" },
    ],
    authoritative: true,
  })),
);
vi.mock("@/lib/ipc", () => ({
  ipc: new Proxy(
    { listEngineModels: (engine: string) => listEngineModels(engine) },
    { get: (target, prop) => (prop in target ? Reflect.get(target, prop) : async () => null) },
  ),
}));
vi.mock("@/lib/events", () => ({
  listenMissionAgentEvents: vi.fn(async () => () => {}),
}));

import i18n from "@/lib/i18n";
import { useChatStore } from "@/features/chat/store";
import { usePluginTranslationStore } from "@/features/plugins/hub/translation/store";
import { PluginTranslationSection } from "./PluginTranslationSection";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom lacks CSS.escape, which react-aria's listbox calls when a Select
// opens (useSelectableCollection) — same guard as PluginHub.test.tsx.
if (typeof window.CSS === "undefined" || typeof window.CSS.escape !== "function") {
  const css = (window.CSS ?? {}) as { escape?: (value: string) => string };
  css.escape = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
  window.CSS = css as typeof CSS;
}

function engine(id: string, overrides: Partial<EngineInfo> = {}): EngineInfo {
  return { id, available: true, enabled: true, supportsImages: true, permissions: ["auto"], ...overrides };
}

/** react-aria needs the whole pointer sequence to open a Select in jsdom. */
async function press(el: Element) {
  await act(async () => {
    for (const type of ["pointerdown", "mousedown", "mouseup", "click"]) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
    }
  });
}

async function choose(label: string, optionText: string) {
  const trigger = document.body.querySelector<HTMLElement>(`[aria-label="${label}"] button, button[aria-label="${label}"]`);
  if (!trigger) throw new Error(`select not found: ${label}`);
  await press(trigger);
  const option = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (el) => el.textContent?.trim() === optionText,
  );
  if (!option) throw new Error(`option not rendered: ${optionText}`);
  await press(option);
}

describe("PluginTranslationSection", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    await i18n.changeLanguage("en");
    localStorage.clear();
    listEngineModels.mockClear();
    useChatStore.setState({ engines: [engine("claude"), engine("pi", { enabled: false })], active: null } as never);
    usePluginTranslationStore.setState({ preference: { engine: null, model: null } });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function render() {
    await act(async () => root.render(<PluginTranslationSection />));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("defaults to following the session and loads no model list until an engine is pinned", async () => {
    await render();
    expect(container.textContent).toContain("Follow current session");
    expect(container.textContent).toContain("Model: Claude Code · default model");
    expect(listEngineModels).not.toHaveBeenCalled();
  });

  it("pinning an engine loads its models, and the chosen model is saved and used", async () => {
    await render();
    await choose("Engine", "Claude Code");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(listEngineModels).toHaveBeenCalledWith("claude");
    expect(usePluginTranslationStore.getState().preference).toEqual({ engine: "claude", model: null });

    await choose("Model", "Sonnet");
    expect(usePluginTranslationStore.getState().preference).toEqual({ engine: "claude", model: "sonnet" });
    expect(container.textContent).toContain("Model: Claude Code · sonnet (from settings)");
  });

  it("marks disabled engines and reports a pinned engine that became unavailable", async () => {
    usePluginTranslationStore.setState({ preference: { engine: "pi", model: "gemma4:latest" } });
    await render();
    expect(container.textContent).toContain("PI CLI (disabled)");
    expect(container.textContent).toContain(
      "PI CLI, chosen in translation settings, is not installed or is disabled.",
    );
    expect(listEngineModels).not.toHaveBeenCalled();
  });
});
