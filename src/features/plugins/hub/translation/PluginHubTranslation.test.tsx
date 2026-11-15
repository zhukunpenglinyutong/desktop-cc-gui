import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeaturedPlugin, MarketPlugin } from "@/lib/ipc";

let readmeText = "# 标题\n\n正文";
const pluginFetchMarketReadme = vi.fn(async (_id: string) => readmeText);
let marketEntries: MarketPlugin[] = [];
let featuredEntries: FeaturedPlugin[] = [];
vi.mock("@/lib/ipc", () => ({
  ipc: {
    pluginFetchIndex: vi.fn(async () => marketEntries),
    pluginFetchFeatured: vi.fn(async () => featuredEntries),
    pluginFetchMarketReadme: (id: string) => pluginFetchMarketReadme(id),
    pluginCheckUpdates: vi.fn(async () => []),
    pluginList: vi.fn(async () => []),
    pluginReadArtwork: vi.fn(async () => "data:image/png;base64,AAAA"),
  },
}));
vi.mock("@/lib/events", () => ({
  listenPluginInstallProgress: vi.fn(async () => () => {}),
  listenMissionAgentEvents: vi.fn(async () => () => {}),
}));
vi.mock("@/lib/platform", () => ({
  isWeb: false,
  openExternal: vi.fn(),
  pickDirectory: vi.fn(async () => null),
}));
const STATES_SNAPSHOT: never[] = [];
vi.mock("../../runtime/loader", () => ({
  bootstrapPlugins: vi.fn(async () => []),
  getPluginStatesSnapshot: () => STATES_SNAPSHOT,
  ipcBackend: {},
  loadPlugin: vi.fn(async () => {}),
  reloadPlugin: vi.fn(async () => {}),
  pluginsBootstrapped: () => true,
  prunePluginRuntimeState: vi.fn(),
  subscribePluginStates: () => () => {},
  unloadPlugin: vi.fn(),
}));
vi.mock("../../builtin", () => ({ BUILTIN_PLUGINS: [] }));

import i18n from "@/lib/i18n";
import { PluginHub } from "../PluginHub";
import { usePluginHubStore } from "../store";
import { usePluginsStore } from "../../manager/usePlugins";
import { useMarketplaceStore } from "../../marketplace/store";
import { useChatStore } from "@/features/chat/store";
import { textFingerprint } from "./fingerprint";
import {
  summaryFingerprint,
  translationKey,
  usePluginTranslationStore,
  type SummarySource,
} from "./store";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

const ENTRY: MarketPlugin = {
  id: "auto-title",
  repo: "someone/ccgui-plugin-auto-title",
  name: "会话自动命名",
  description: "每轮对话结束后生成会话标题",
  author: "someone",
  tier: "js",
  version: "0.7.1",
  permissions: [],
  screenshots: [],
  updatedAt: null,
  minAppVersion: null,
  sdkVersion: null,
  downloads: null,
  icon: null,
};
const FEATURED: FeaturedPlugin = { id: "auto-title", tagline: "再也不用起名字", note: "官方出品", image: null };

function source(entry: MarketPlugin, featured: FeaturedPlugin | null): SummarySource {
  return {
    name: entry.name,
    description: entry.description,
    tagline: featured?.tagline ?? null,
    note: featured?.note ?? null,
  };
}

function seedTranslation(original: SummarySource, readme: string | null) {
  usePluginTranslationStore.setState({
    displayLanguage: "ru",
    lastLanguage: "ru",
    summaries: {
      [translationKey("auto-title", "ru")]: {
        pluginId: "auto-title",
        language: "ru",
        name: "Автоназвание сессий",
        description: "Создаёт заголовок после каждого хода",
        tagline: original.tagline ? "Больше не нужно придумывать названия" : null,
        note: original.note ? "Официальный плагин" : null,
        hash: summaryFingerprint(original),
        engine: "claude",
        model: null,
        translatedAt: 1,
      },
    },
    readmes:
      readme === null
        ? {}
        : {
            [translationKey("auto-title", "ru")]: {
              pluginId: "auto-title",
              language: "ru",
              text: "# Заголовок\n\nТекст README",
              hash: textFingerprint(readme),
              engine: "claude",
              model: null,
              translatedAt: 1,
            },
          },
  });
}

function buttonContaining(text: string): HTMLButtonElement {
  const button = [...document.body.querySelectorAll("button")].find((candidate) =>
    candidate.textContent?.includes(text),
  );
  if (!button) throw new Error(`button containing ${text} not found`);
  return button;
}

describe("plugin hub translation", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(async () => {
    await i18n.changeLanguage("en");
    localStorage.clear();
    readmeText = "# 标题\n\n正文";
    marketEntries = [ENTRY];
    featuredEntries = [];
    usePluginsStore.setState({ installed: [], loaded: true, error: null, installing: null });
    useMarketplaceStore.setState({
      entries: [ENTRY],
      featured: [],
      loaded: true,
      error: null,
      updates: [],
      installing: null,
    });
    useChatStore.setState({
      engines: [{ id: "claude", available: true, enabled: true, supportsImages: true, permissions: ["auto"] }],
      active: null,
    } as never);
    usePluginHubStore.setState({ open: true, active: true, view: "market" });
    usePluginTranslationStore.setState({
      summaries: {},
      readmes: {},
      displayLanguage: null,
      lastLanguage: null,
      jobs: {},
      errors: {},
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root?.unmount());
    container.remove();
    root = null;
  });

  async function render() {
    await act(async () => {
      root!.render(<PluginHub onCreatePluginChat={() => {}} />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("puts the list translation next to Create plugin and a per-row button next to Install", async () => {
    await render();
    const header = buttonContaining("Create plugin").parentElement!;
    const headerButtons = [...header.querySelectorAll("button")];
    const listIndex = headerButtons.findIndex((button) => button.textContent?.includes("Translate list"));
    const createIndex = headerButtons.findIndex((button) => button.textContent?.includes("Create plugin"));
    expect(listIndex).toBeGreaterThanOrEqual(0);
    expect(listIndex).toBe(createIndex - 1);

    const install = [...container.querySelectorAll("tbody button")].find(
      (button) => button.textContent?.trim() === "Install",
    )!;
    const rowTranslate = install.parentElement!.querySelector('button[aria-label="Translate this plugin"]');
    expect(rowTranslate).not.toBeNull();
  });

  it("shows cached translations in the row, keeps the original in the tooltip and searches translated text", async () => {
    seedTranslation(source(ENTRY, null), null);
    await render();

    expect(container.textContent).toContain("Автоназвание сессий");
    expect(container.textContent).toContain("Создаёт заголовок после каждого хода");
    expect(container.textContent).not.toContain("每轮对话结束后生成会话标题");
    expect(container.querySelector('[title="会话自动命名"]')).not.toBeNull();
    expect(container.textContent).toContain("Translation: Русский");

    const search = container.querySelector<HTMLInputElement>("input")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(search, "заголовок");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.textContent).toContain("Автоназвание сессий");
  });

  it("translates the featured carousel copy from the same cached summary", async () => {
    useMarketplaceStore.setState({ featured: [FEATURED] });
    featuredEntries = [FEATURED];
    seedTranslation(source(ENTRY, FEATURED), null);
    await render();
    expect(container.textContent).toContain("Больше не нужно придумывать названия");
    expect(container.textContent).toContain("Официальный плагин");
    expect(container.textContent).not.toContain("再也不用起名字");
  });

  it("flags an outdated row translation after the original changes upstream", async () => {
    seedTranslation(source(ENTRY, null), null);
    const changed = { ...ENTRY, description: "作者改过的简介" };
    useMarketplaceStore.setState({ entries: [changed] });
    marketEntries = [changed];
    await render();
    const rowTranslate = container.querySelector('button[aria-label="Translate this plugin"]')!;
    expect(rowTranslate.querySelector("[title]")?.getAttribute("title")).toBe(
      "The translation is outdated: the original changed",
    );
  });

  it("detail page shows the translated header and README, and offers Translate again once the README changes", async () => {
    seedTranslation(source(ENTRY, null), readmeText);
    await render();
    await act(async () => buttonContaining("Автоназвание сессий").click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.querySelector("h2")?.textContent).toBe("Автоназвание сессий");
    expect(container.textContent).toContain("Текст README");
    expect(container.textContent).toContain("Translated to Русский by Claude Code");
    expect(container.querySelector('button[aria-label="Translate this plugin"]')?.textContent).toContain(
      "Translate",
    );

    // Upstream README changes → reopen → outdated notice with Translate again.
    await act(async () => buttonContaining("Back to plugins").click());
    readmeText = "# 标题\n\n新正文";
    await act(async () => buttonContaining("Автоназвание сессий").click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).toContain("The original changed after this Русский translation");
    expect(buttonContaining("Translate again")).toBeTruthy();
    // The outdated translation stays readable until the user acts.
    expect(container.textContent).toContain("Текст README");

    await act(async () => buttonContaining("Show original").click());
    expect(container.querySelector("h2")?.textContent).toBe("会话自动命名");
    expect(usePluginTranslationStore.getState().displayLanguage).toBeNull();
  });
});
