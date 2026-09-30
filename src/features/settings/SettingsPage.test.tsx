import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineInfo, PluginInfo } from "@/lib/ipc";

// The settings page never probes IPC for the rail itself (engine states come
// from the chat store); the proxy resolves any other method to null so section
// module imports and the stub page stay inert. Methods a rendered section
// actually consumes are called out: `pluginReadArtwork` so the plugin
// rail-icon fallback can be asserted.
const { pluginReadArtwork } = vi.hoisted(() => ({
  pluginReadArtwork: vi.fn(
    async (_id: string, _path: string): Promise<string> =>
      "data:image/png;base64,AAAA",
  ),
}));
vi.mock("@/lib/ipc", () => ({
  ipc: new Proxy(
    { pluginReadArtwork },
    {
      get: (target, prop) =>
        prop in target ? Reflect.get(target, prop) : async () => null,
    },
  ),
}));

import { settingsRegistry } from "@ccgui/plugin-sdk";
import i18n from "@/lib/i18n";
import { useChatStore } from "@/features/chat/store";
import { usePluginsStore } from "@/features/plugins/manager/usePlugins";
import SettingsPage from "./SettingsPage";

// React 18's act() requires this flag to be set by the test environment.
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no ResizeObserver; PillTabList (the capability pages' tab strip)
// measures its selection thumb with one.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

// Landing page for every render: a registered stub keeps real section bodies
// (General/Usage/…) unmounted while the rail lists every registered section.
settingsRegistry.register({
  id: "stub",
  key: "stub",
  label: () => "Stub",
  group: "settings",
  order: 99,
  component: () => <div>stub page</div>,
});

const engine = (id: string, available: boolean, enabled: boolean): EngineInfo => ({
  id,
  available,
  enabled,
  supportsImages: false,
  permissions: [],
});

/** Row labels currently rendered in the nav rail (exact text, no substring
 *  collisions like "Qoder CLI" vs "Qoder CLI CN"). */
function navLabels(): string[] {
  const nav = document.querySelector("nav");
  if (!nav) throw new Error("nav rail not rendered");
  return [...nav.querySelectorAll("button, span")]
    .map((el) => el.textContent?.trim() ?? "")
    .filter(Boolean);
}

/** Item labels under one section heading. The rail renders every group as a
 *  heading directly above its item buttons, so the heading scopes the
 *  lookup: a static heading span's parent is the group, a collapsible
 *  heading is a chevron toggle wrapping the label. Folded items stay in the
 *  DOM (the md+ rail hides the list with a class), so they still count. */
function itemsUnder(labelKey: string): string[] {
  const label = i18n.t(labelKey);
  const heading = [...document.querySelectorAll("nav span")].find(
    (el) => el.textContent?.trim() === label,
  );
  if (!heading) throw new Error(`section heading not rendered: ${labelKey}`);
  const group =
    heading.closest("button")?.parentElement ?? heading.parentElement;
  return [
    ...(group?.querySelectorAll("button:not([aria-expanded])") ?? []),
  ].map((button) => button.textContent?.trim() ?? "");
}

/** Chevron toggle of a collapsible group (item rows never carry the
 *  attribute, so it identifies the heading button on its own). */
function groupToggle(labelKey: string): HTMLButtonElement {
  const label = i18n.t(labelKey);
  const toggle = [
    ...document.querySelectorAll<HTMLButtonElement>("nav button[aria-expanded]"),
  ].find((button) => button.textContent?.trim() === label);
  if (!toggle) throw new Error(`group toggle not rendered: ${labelKey}`);
  return toggle;
}

/** Item list a group heading owns (the heading's next sibling). */
function itemsContainerOf(labelKey: string): HTMLElement {
  const label = i18n.t(labelKey);
  const heading = [...document.querySelectorAll("nav button, nav span")].find(
    (el) => el.textContent?.trim() === label,
  );
  const container = heading?.nextElementSibling;
  if (!(container instanceof HTMLElement)) {
    throw new Error(`item list not rendered: ${labelKey}`);
  }
  return container;
}

/** Rail block that owns a section heading (the block carries the group's
 *  spacing classes). */
function groupBlock(labelKey: string): HTMLElement {
  const label = i18n.t(labelKey);
  const heading = [...document.querySelectorAll("nav button, nav span")].find(
    (el) => el.textContent?.trim() === label,
  );
  const block =
    heading?.closest("button")?.parentElement ?? heading?.parentElement;
  if (!(block instanceof HTMLElement)) {
    throw new Error(`group block not rendered: ${labelKey}`);
  }
  return block;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  pluginReadArtwork.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useChatStore.setState({ engines: [] });
});

function installedPlugin(id: string, icon: string | null): PluginInfo {
  return {
    id,
    name: id,
    version: "1.0.0",
    description: "",
    author: "ccgui",
    tier: "js",
    source: "marketplace",
    enabled: true,
    quarantined: false,
    lastError: null,
    permissions: ["ui:settings-section"],
    installedAt: 0,
    minAppVersion: null,
    icon,
    screenshots: [],
  };
}

/** Rail item button carrying the given label (the icon slot holds no text). */
function railRow(label: string): HTMLButtonElement | null {
  return (
    [...document.querySelectorAll<HTMLButtonElement>("nav button")].find(
      (button) => button.textContent?.trim() === label,
    ) ?? null
  );
}

async function render(engines: EngineInfo[], page = "stub") {
  useChatStore.setState({ engines });
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[`/settings?page=${page}`]}>
        <SettingsPage />
      </MemoryRouter>,
    );
  });
}



describe("SettingsPage misc rail", () => {
  it("lists 内测功能, 检查更新, 社区与反馈 and 性能诊断 in that order", async () => {
    await render([]);

    const labels = navLabels();
    const betaAt = labels.indexOf(i18n.t("settings.betaFeatures"));
    const updateAt = labels.indexOf(i18n.t("settings.checkUpdates"));
    const aboutAt = labels.indexOf(i18n.t("settings.about"));
    const diagnosticsAt = labels.indexOf(i18n.t("diagnostics.title"));
    expect(betaAt).toBeGreaterThan(-1);
    expect(updateAt).toBeGreaterThan(betaAt);
    expect(aboutAt).toBeGreaterThan(updateAt);
    expect(diagnosticsAt).toBeGreaterThan(aboutAt);
  });
});

describe("SettingsPage system rail", () => {
  it("keeps 智能体, 提示词 and 网络代理 under 系统, after 快捷键", async () => {
    await render([]);

    expect(itemsUnder("settings.groupSystem")).toEqual([
      i18n.t("settings.general"),
      i18n.t("settings.webAccess"),
      i18n.t("shortcuts.sectionTitle"),
      i18n.t("settings.agents"),
      i18n.t("settings.prompts"),
      i18n.t("settings.proxy"),
    ]);

    // 其他 holds the release/feedback pages, the 性能诊断 entry, the
    // 内测功能 gate and the extracted 桌面宠物 page — engine sections used to
    // lead that group.
    expect(itemsUnder("settings.groupMisc")).toEqual([
      i18n.t("settings.betaFeatures"),
      i18n.t("settings.checkUpdates"),
      i18n.t("settings.about"),
      i18n.t("diagnostics.title"),
      i18n.t("settings.pet"),
    ]);
  });
});

describe("SettingsPage CLI rail", () => {
  it("buckets uninstalled CLIs under 未安装, disabled ones under 未启用", async () => {
    await render([
      engine("claude", true, true),
      engine("codex", true, false),
      engine("qoder", false, true),
      engine("agy", false, false),
    ]);

    // Headings stay visible while folded, so every bucket is discoverable.
    const labels = navLabels();
    expect(labels).toContain("Claude Code");
    expect(labels).toContain("Codex CLI");
    expect(labels).toContain("Qoder CLI");
    expect(labels).toContain("Antigravity CLI");

    // Main rail holds only the installed+enabled CLI.
    expect(itemsUnder("settings.cliManage")).toEqual(["Claude Code"]);

    // 未安装 holds every uninstalled CLI (the probe lists 4 engines, the rail
    // registers all of them); 未启用 only the installed disabled one — an
    // uninstalled CLI never lands in the disabled bucket.
    const missingItems = itemsUnder("settings.cliNotInstalledGroup");
    expect(missingItems).toEqual(
      expect.arrayContaining(["Qoder CLI", "Antigravity CLI"]),
    );
    expect(missingItems).not.toContain("Claude Code");
    expect(missingItems).not.toContain("Codex CLI");
    expect(itemsUnder("settings.cliDisabledGroup")).toEqual(["Codex CLI"]);

    // 未安装 sorts before 未启用 in the rail.
    const missingAt = labels.indexOf(i18n.t("settings.cliNotInstalledGroup"));
    const disabledAt = labels.indexOf(i18n.t("settings.cliDisabledGroup"));
    expect(missingAt).toBeGreaterThan(-1);
    expect(disabledAt).toBeGreaterThan(missingAt);
  });

  it("tucks the two buckets under the CLI 管理 rail (tighter gap than a section)", async () => {
    await render([
      engine("claude", true, true),
      engine("codex", true, false),
      engine("qoder", false, true),
    ]);

    // Both buckets carry the negative top margin that shrinks the 24px
    // section gap to 12px; full rail sections never do — PI CLI
    // (≡ the last main-rail row) must stay 24px above 未安装.
    for (const key of [
      "settings.cliNotInstalledGroup",
      "settings.cliDisabledGroup",
    ]) {
      expect(groupBlock(key).className).toContain("md:-mt-3");
    }
    expect(groupBlock("settings.cliManage").className).not.toContain(
      "md:-mt-3",
    );
    expect(groupBlock("settings.groupSystem").className).not.toContain(
      "md:-mt-3",
    );
  });

  it("keeps every CLI while the engine probe is out (empty list = unknown)", async () => {
    await render([]);

    const labels = navLabels();
    expect(labels).toContain("Claude Code");
    expect(labels).toContain("Qoder CLI");
    expect(labels).toContain("Antigravity CLI");
  });

  it("folds the two buckets by default and toggles them on click", async () => {
    await render([
      engine("claude", true, true),
      engine("codex", true, false),
      engine("qoder", false, true),
    ]);

    // CLI 管理 starts open; 未安装 and 未启用 start folded (their lists carry
    // the md+ hide class so the mobile rail keeps every item).
    expect(groupToggle("settings.cliManage").getAttribute("aria-expanded")).toBe(
      "true",
    );
    for (const key of [
      "settings.cliNotInstalledGroup",
      "settings.cliDisabledGroup",
    ]) {
      expect(groupToggle(key).getAttribute("aria-expanded")).toBe("false");
      expect(itemsContainerOf(key).className).toContain("md:hidden");
    }

    act(() => groupToggle("settings.cliNotInstalledGroup").click());
    expect(groupToggle("settings.cliNotInstalledGroup").getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(itemsContainerOf("settings.cliNotInstalledGroup").className).not.toContain(
      "md:hidden",
    );

    act(() => groupToggle("settings.cliNotInstalledGroup").click());
    expect(groupToggle("settings.cliNotInstalledGroup").getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("leaves the other rail groups as static headings", async () => {
    await render([
      engine("claude", true, true),
      engine("codex", true, false),
      engine("qoder", false, true),
    ]);

    // Only the three CLI sections fold.
    expect(document.querySelectorAll("nav button[aria-expanded]").length).toBe(3);
    const systemHeading = [...document.querySelectorAll("nav span")].find(
      (el) => el.textContent?.trim() === i18n.t("settings.groupSystem"),
    );
    expect(systemHeading).toBeTruthy();
    expect(systemHeading?.closest("button")).toBeNull();
  });

  it("trails the fold chevron after the heading label", async () => {
    await render([
      engine("claude", true, true),
      engine("codex", true, false),
      engine("qoder", false, true),
    ]);

    // The chevron is the heading row's trailing element, so the label keeps
    // the rail's left text inset (same column as a static heading like 系统)
    // instead of sitting in the item-icon column.
    for (const key of [
      "settings.cliManage",
      "settings.cliNotInstalledGroup",
      "settings.cliDisabledGroup",
    ]) {
      const toggle = groupToggle(key);
      expect(toggle.firstElementChild?.textContent).toBe(i18n.t(key));
      expect(toggle.lastElementChild?.tagName.toLowerCase()).toBe("svg");
    }
  });

  it("uses the installed plugin's own artwork when the section registers no icon", async () => {
    usePluginsStore.setState({
      installed: [installedPlugin("auto-title", "docs/icon.png")],
    });
    const dispose = settingsRegistry.register({
      id: "plugin:auto-title",
      key: "plugin:auto-title",
      label: () => "自动命名",
      group: "plugins",
      order: 1000,
      component: () => <div>auto-title page</div>,
    });
    try {
      await render([]);
      expect(pluginReadArtwork).toHaveBeenCalledWith("auto-title", "docs/icon.png");
      expect(railRow("自动命名")?.querySelector("img")?.getAttribute("src")).toBe(
        "data:image/png;base64,AAAA",
      );
    } finally {
      await act(async () => {
        dispose();
        usePluginsStore.setState({ installed: [] });
      });
    }
  });

  it("keeps the shared grid glyph for a plugin that ships no artwork", async () => {
    usePluginsStore.setState({
      installed: [installedPlugin("plain-plugin", null)],
    });
    const dispose = settingsRegistry.register({
      id: "plugin:plain-plugin",
      key: "plugin:plain-plugin",
      label: () => "无素材插件",
      group: "plugins",
      order: 1000,
      component: () => <div>plain page</div>,
    });
    try {
      await render([]);
      expect(pluginReadArtwork).not.toHaveBeenCalled();
      const row = railRow("无素材插件");
      expect(row?.querySelector("img")).toBeNull();
      expect(row?.querySelector("svg.lucide-layout-grid")).not.toBeNull();
    } finally {
      await act(async () => {
        dispose();
        usePluginsStore.setState({ installed: [] });
      });
    }
  });


describe("SettingsPage capabilities rail", () => {
  it("puts 能力扩展 between CLI 管理 and 工作区与数据", async () => {
    await render([]);

    const labels = navLabels();
    const cliAt = labels.indexOf(i18n.t("settings.cliManage"));
    const capabilitiesAt = labels.indexOf(i18n.t("settings.groupCapabilities"));
    const workspaceAt = labels.indexOf(i18n.t("settings.groupWorkspace"));
    expect(cliAt).toBeGreaterThan(-1);
    expect(capabilitiesAt).toBeGreaterThan(cliAt);
    expect(workspaceAt).toBeGreaterThan(capabilitiesAt);

    // Skills leads, MCP follows — all in the same static group. The
    // 电脑操控 entry is temporarily hidden (see sections.tsx).
    expect(itemsUnder("settings.groupCapabilities")).toEqual([
      i18n.t("settings.skills"),
      i18n.t("settings.mcp"),
      // 电脑操控入口暂时隐藏：恢复时取消注释。
      // i18n.t("settings.computerUse"),
    ]);
    // The new group is static (no fold toggle) like 系统/工作区.
    const capabilityHeading = [...document.querySelectorAll("nav span")].find(
      (el) => el.textContent?.trim() === i18n.t("settings.groupCapabilities"),
    );
    expect(capabilityHeading).toBeTruthy();
    expect(capabilityHeading?.closest("button")).toBeNull();
  });

  it("does not load the Skills page (or its IPC) when ordinary settings open", async () => {
    await render([]);
    // Only the landing stub is mounted; the capability sections stay behind
    // React.lazy and their data hooks never run.
    expect(document.body.textContent).toContain("stub page");
    expect(document.body.textContent).not.toContain("我的 Skills");
  });

  it(
    "deep-links to the Skills page through the lazy loader",
    async () => {
      useChatStore.setState({ engines: [] });
      await act(async () => {
        root.render(
          <MemoryRouter initialEntries={[`/settings?page=skills`]}>
            <SettingsPage />
          </MemoryRouter>,
        );
      });
      // The rail selection is immediate; the body loads lazily (Vitest
      // transforms the chunk on demand) through the Suspense fallback. jsdom
      // reports as a web runtime, so the page's own desktop-only gate is the
      // loaded evidence.
      const skillsRow = railRow(i18n.t("settings.skills"));
      expect(skillsRow?.getAttribute("aria-current")).toBe("page");
      expect(document.body.textContent).toContain(i18n.t("common.loading"));
      await vi.waitFor(
        () => {
          expect(document.body.textContent).toContain(i18n.t("skills.desktopOnly"));
        },
        { timeout: 10000, interval: 50 },
      );
    },
    20000,
  );
});

  it("unfolds the bucket that holds a deep-linked page", async () => {
    // A CLI-keyed stub section (unknown engine id) lands in 未安装 once the
    // probe is in, and renders a stub body instead of a real config page.
    const dispose = settingsRegistry.register({
      id: "cli:stubcli",
      key: "cli:stubcli",
      label: () => "Stub CLI",
      group: "cli",
      order: 98,
      component: () => <div>stub cli page</div>,
    });
    try {
      await render([engine("claude", true, true)], "cli:stubcli");

      expect(
        groupToggle("settings.cliNotInstalledGroup").getAttribute("aria-expanded"),
      ).toBe("true");
      // The fold is user-owned: collapsing it now must stick.
      act(() => groupToggle("settings.cliNotInstalledGroup").click());
      expect(
        groupToggle("settings.cliNotInstalledGroup").getAttribute("aria-expanded"),
      ).toBe("false");
    } finally {
      // Dropping the stub re-renders the open page back to General (the
      // unknown-key fallback) and GeneralSection reads settings on mount;
      // flush both inside act like every other render in this file.
      await act(async () => {
        dispose();
      });
    }
  });
});
