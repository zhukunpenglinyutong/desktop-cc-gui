import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeaturedPlugin, MarketPlugin, PluginInfo, PluginUpdate } from "@/lib/ipc";

const pluginFetchIndex = vi.fn(async (_force?: boolean): Promise<MarketPlugin[]> => []);
const pluginFetchFeatured = vi.fn(async (_force?: boolean): Promise<FeaturedPlugin[]> => []);
const pluginCheckUpdates = vi.fn(async (): Promise<PluginUpdate[]> => []);
const pluginFetchMarketReadme = vi.fn(
  async (_id: string): Promise<string> => "# React Doctor\n\n一键运行代码体检。",
);
const pluginList = vi.fn(async (): Promise<PluginInfo[]> => []);
const pluginInstallFromMarketplace = vi.fn(async (id: string) =>
  installedPlugin({ id, enabled: true }),
);
const pluginUninstall = vi.fn(async (_id: string, _deleteData: boolean) => {});
const pluginSetEnabled = vi.fn(async (id: string, enabled: boolean) =>
  installedPlugin({ id, enabled }),
);
const pluginReadArtwork = vi.fn(
  async (_id: string, _path: string): Promise<string> => "data:image/png;base64,AAAA",
);
vi.mock("@/lib/ipc", () => ({
  ipc: {
    pluginFetchIndex: (force?: boolean) => pluginFetchIndex(force),
    pluginFetchFeatured: (force?: boolean) => pluginFetchFeatured(force),
    pluginFetchMarketReadme: (id: string) => pluginFetchMarketReadme(id),
    pluginCheckUpdates: () => pluginCheckUpdates(),
    pluginList: () => pluginList(),
    pluginInstallFromMarketplace: (id: string) => pluginInstallFromMarketplace(id),
    pluginUninstall: (id: string, deleteData: boolean) => pluginUninstall(id, deleteData),
    pluginSetEnabled: (id: string, enabled: boolean) => pluginSetEnabled(id, enabled),
    pluginReadArtwork: (id: string, path: string) => pluginReadArtwork(id, path),
  },
}));
vi.mock("@/lib/events", () => ({
  listenPluginInstallProgress: vi.fn(async () => () => {}),
}));
const openExternal = vi.fn((_url: string) => {});
vi.mock("@/lib/platform", () => ({
  isWeb: false,
  openExternal: (url: string) => openExternal(url),
  pickDirectory: vi.fn(async () => null),
}));
// Stable empty snapshot: useSyncExternalStore loops forever on a fresh [].
const STATES_SNAPSHOT: never[] = [];
vi.mock("../runtime/loader", () => ({
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
vi.mock("../builtin", () => ({ BUILTIN_PLUGINS: [] }));

import i18n from "@/lib/i18n";
import { PluginHub } from "./PluginHub";
import { usePluginHubStore } from "./store";
import { usePluginsStore } from "../manager/usePlugins";
import { useMarketplaceStore } from "../marketplace/store";

// React 18's act() requires this flag to be set by the test environment.
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no ResizeObserver; PillTabList measures its selection thumb with it.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

// jsdom lacks CSS.escape, which react-aria's listbox calls when the 已安装筛选
// Select opens (useSelectableCollection). The ids here are plain words, so a
// minimal polyfill suffices (same guard as font-settings.test.tsx).
if (typeof window.CSS === "undefined" || typeof window.CSS.escape !== "function") {
  const css = (window.CSS ?? {}) as { escape?: (value: string) => string };
  css.escape = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
  window.CSS = css as typeof CSS;
}

const DOWNLOADS = 47;
const UPDATED_AT = "2026-09-20T08:30:00Z";

const MARKET_ENTRY: MarketPlugin = {
  id: "react-doctor",
  repo: "zhukupenglinyutong/ccgui-plugin-react-doctor",
  name: "React Doctor",
  description: "一键运行代码体检",
  author: "zhukunpeng",
  tier: "js",
  version: "0.2.0",
  minAppVersion: "1.0.0",
  sdkVersion: "^0.3",
  permissions: ["storage", "exec:claude", "ui:status-bar"],
  downloads: DOWNLOADS,
  updatedAt: UPDATED_AT,
  screenshots: [
    "https://raw.githubusercontent.com/zhukupenglinyutong/ccgui-plugin-react-doctor/HEAD/docs/shot-1.png",
    "https://raw.githubusercontent.com/zhukupenglinyutong/ccgui-plugin-react-doctor/HEAD/docs/shot-2.png",
  ],
  icon: "https://raw.githubusercontent.com/zhukupenglinyutong/ccgui-plugin-react-doctor/HEAD/docs/icon.png",
};

function installedPlugin(overrides: Partial<PluginInfo> & { id: string }): PluginInfo {
  return {
    name: "会话自动命名",
    version: "0.7.0",
    description: "每轮对话结束后生成会话标题",
    author: "zhukunpeng",
    tier: "js",
    source: "marketplace",
    enabled: true,
    quarantined: false,
    lastError: null,
    permissions: ["storage"],
    // Unix 秒：与 backend 的 plugins.json 同单位（毫秒值会被当成未来时间）。
    installedAt: 1_700_000_000,
    minAppVersion: "1.0.2",
    icon: null,
    screenshots: [],
    ...overrides,
  };
}

function buttonByLabel(label: string): HTMLButtonElement {
  const button = document.body.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!button) throw new Error(`button not found: ${label}`);
  return button;
}

function buttonByText(text: string): HTMLButtonElement {
  const button = [...document.body.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  if (!button) throw new Error(`button not found: ${text}`);
  return button;
}

function buttonContaining(text: string): HTMLButtonElement {
  const button = [...document.body.querySelectorAll("button")].find((candidate) =>
    candidate.textContent?.includes(text),
  );
  if (!button) throw new Error(`button containing ${text} not found`);
  return button;
}

/** react-aria pairs pointerdown + click when PointerEvent exists and the
 *  mousedown/up pair otherwise; dispatching the whole sequence keeps presses
 *  working regardless of the jsdom code path (same pattern as
 *  font-settings.test.tsx). */
async function press(el: Element) {
  await act(async () => {
    for (const type of ["pointerdown", "mousedown", "mouseup", "click"]) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
    }
  });
}

/** Open the 已安装页头的筛选 Select and pick the option with the given text. */
async function selectInstalledFilter(optionText: string) {
  await press(buttonByLabel(i18n.t("plugins.hub.installedFilter.label")));
  const option = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (el) => el.textContent?.trim() === optionText,
  );
  if (!option) throw new Error(`option not rendered: ${optionText}`);
  await press(option);
}

describe("PluginHub", () => {
  let container: HTMLDivElement;
  let root: Root | null;

  beforeEach(() => {
    vi.clearAllMocks();
    pluginFetchIndex.mockImplementation(async () => [MARKET_ENTRY]);
    pluginCheckUpdates.mockImplementation(async () => []);
    pluginList.mockImplementation(async () => []);
    usePluginsStore.setState({ installed: [], loaded: true, error: null, installing: null });
    useMarketplaceStore.setState({
      entries: [],
      featured: [],
      loaded: true,
      error: null,
      updates: [],
      installing: null,
    });
    usePluginHubStore.setState({ open: true, active: true, view: "market" });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
    });
    container.remove();
    root = null;
  });

  async function render() {
    await act(async () => {
      root!.render(<PluginHub />);
    });
  }

  it("renders the featured carousel above the table with the editorial copy", async () => {
    pluginFetchFeatured.mockImplementation(async () => [
      { id: "react-doctor", tagline: "一条命令给项目做体检", note: "发版前跑一次", image: null },
    ]);

    await render();

    const body = document.body.textContent ?? "";
    expect(body).toContain(i18n.t("plugins.hub.spotlight"));
    expect(body).toContain("一条命令给项目做体检");
    // 轮播在表格之前：推荐位是编辑层，表格仍是精确查找的入口。
    const carousel = document.body.querySelector('[aria-roledescription="carousel"]');
    const table = document.body.querySelector("table");
    expect(carousel).not.toBeNull();
    expect(table).not.toBeNull();
    expect(
      carousel!.compareDocumentPosition(table!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("hides the carousel when the featured file is unavailable", async () => {
    pluginFetchFeatured.mockRejectedValue(new Error("404"));

    await render();

    expect(document.body.querySelector('[aria-roledescription="carousel"]')).toBeNull();
    // 表格照常：装饰数据拿不到不影响浏览与安装
    expect(document.body.textContent).toContain("React Doctor");
  });

  it("browses the market table: column headers, counted chips, install from the row", async () => {
    await render();

    for (const key of [
      "tableName",
      "tableDeveloper",
      "tableDownloads",
      "tableVersion",
      "tableActions",
    ]) {
      expect(document.body.textContent).toContain(i18n.t(`plugins.hub.${key}`));
    }
    expect(document.body.textContent).toContain("React Doctor");

    // 分类 chips carry the count, so the filter row describes the index.
    const chip = [...document.body.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")].find(
      (candidate) => candidate.textContent?.includes(i18n.t("plugins.hub.categories.dev")),
    );
    expect(chip?.textContent).toContain("1");

    await act(async () => {
      buttonByText(i18n.t("plugins.hub.install")).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(pluginInstallFromMarketplace).toHaveBeenCalledWith("react-doctor");
  });

  it("uses the developer's real GitHub avatar in the market row", async () => {
    await render();

    // author `zhukunpeng` is the GitHub login, the chip asks for 2×20px.
    const avatar = document.body.querySelector<HTMLImageElement>(
      'tbody img[src="https://github.com/zhukunpeng.png?size=40"]',
    );
    expect(avatar).not.toBeNull();
  });

  it("shows the official badge instead of developer info for first-party plugins", async () => {
    pluginFetchIndex.mockImplementation(async () => [
      { ...MARKET_ENTRY, author: "zhukunpenglinyutong" },
      { ...MARKET_ENTRY, id: "rainbow", name: "彩虹边界线", author: "libo-zhou" },
    ]);
    await render();

    const rows = [...document.body.querySelectorAll<HTMLTableRowElement>("tbody tr")];
    const officialRow = rows.find((row) => row.textContent?.includes("React Doctor"))!;
    const thirdPartyRow = rows.find((row) => row.textContent?.includes("彩虹边界线"))!;
    // The account is replaced by the badge, not repeated next to it.
    expect(officialRow.textContent).toContain(i18n.t("plugins.hub.official"));
    expect(officialRow.textContent).not.toContain("zhukunpenglinyutong");
    expect(thirdPartyRow.textContent).not.toContain(i18n.t("plugins.hub.official"));
    expect(thirdPartyRow.textContent).toContain("libo-zhou");

    await act(async () => {
      buttonContaining("React Doctor").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {});
    // The rail keeps the same rule: brand, no personal account printed — the
    // badge itself is the link to the brand account.
    expect(document.body.textContent).toContain(i18n.t("plugins.hub.official"));
    expect(document.body.textContent).not.toContain("zhukunpenglinyutong");
    const officialBadge = buttonByText(i18n.t("plugins.hub.official"));
    expect(officialBadge.getAttribute("title")).toBe(
      i18n.t("plugins.hub.authorGithub", { login: "zhukunpenglinyutong" }),
    );
    await act(async () => {
      officialBadge.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(openExternal).toHaveBeenCalledWith("https://github.com/zhukunpenglinyutong");
  });

  it("shows the indexed plugin icon and keeps the letter tile without one", async () => {
    pluginFetchIndex.mockImplementation(async () => [
      MARKET_ENTRY,
      { ...MARKET_ENTRY, id: "plain-plugin", name: "Plain Plugin", icon: null },
    ]);
    await render();

    const rows = () => [...document.body.querySelectorAll<HTMLTableRowElement>("tbody tr")];
    const iconRow = rows().find((row) => row.textContent?.includes("React Doctor"))!;
    expect(iconRow.querySelector(`img[src="${MARKET_ENTRY.icon}"]`)).not.toBeNull();

    // No icon in the index = the deterministic initial tile, never a broken img.
    const plainRow = rows().find((row) => row.textContent?.includes("Plain Plugin"))!;
    expect(plainRow.querySelector(`img[src="${MARKET_ENTRY.icon}"]`)).toBeNull();
    expect(plainRow.querySelector<HTMLElement>("div[aria-hidden]")?.textContent).toBe("P");
  });

  it("loads market metadata in the installed tab so its rows show the indexed icon", async () => {
    usePluginHubStore.setState({ view: "installed" });
    pluginList.mockImplementation(async () => [installedPlugin({ id: "react-doctor" })]);
    await render();
    await act(async () => {});

    // Artwork lives in the index, not in the install record: the installed
    // tab must fetch it too, or a locally installed plugin keeps the letter.
    expect(pluginFetchIndex).toHaveBeenCalled();
    expect(document.body.querySelector(`img[src="${MARKET_ENTRY.icon}"]`)).not.toBeNull();
  });

  it("reads artwork from the installed manifest when the market has no entry", async () => {
    // A locally developed plugin the index does not carry: the only artwork
    // source is its own manifest, read through the path-scoped host command.
    usePluginHubStore.setState({ view: "installed" });
    pluginFetchIndex.mockImplementation(async () => []);
    pluginList.mockImplementation(async () => [
      installedPlugin({ id: "kimi-lb", name: "Kimi LB", source: "local", icon: "docs/icon.png" }),
    ]);
    await render();
    await act(async () => {});

    expect(pluginReadArtwork).toHaveBeenCalledWith("kimi-lb", "docs/icon.png");
    expect(
      document.body.querySelector<HTMLImageElement>('img[src="data:image/png;base64,AAAA"]'),
    ).not.toBeNull();
  });

  it("fills the detail gallery from the installed manifest for a market-less plugin", async () => {
    usePluginHubStore.setState({ view: "installed" });
    pluginFetchIndex.mockImplementation(async () => []);
    pluginList.mockImplementation(async () => [
      installedPlugin({
        id: "kimi-lb",
        name: "Kimi LB",
        source: "local",
        icon: "docs/icon.png",
        screenshots: ["docs/screenshot-1.png"],
      }),
    ]);
    await render();
    await act(async () => {});
    await act(async () => {
      buttonContaining("Kimi LB").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {});

    // The index has no entry for this plugin, so the gallery can only come
    // from the installed manifest, read as a data URL through the host.
    expect(pluginReadArtwork).toHaveBeenCalledWith("kimi-lb", "docs/screenshot-1.png");
    const gallery = document.body.querySelector(
      `section[aria-label="${i18n.t("plugins.hub.screenshotsTitle")}"]`,
    );
    expect(gallery).not.toBeNull();
    expect(gallery!.querySelector("img")).not.toBeNull();
  });

  it("filters by category, by query, and clears an empty result", async () => {
    pluginFetchIndex.mockImplementation(async () => [
      MARKET_ENTRY,
      {
        ...MARKET_ENTRY,
        id: "composer-rainbow-border",
        name: "彩虹跑马灯边界线",
        description: "为聊天输入框添加彩虹跑马灯",
        author: "libo-zhou",
        downloads: 5,
      },
    ]);
    await render();

    const chipFor = (label: string) =>
      [...document.body.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")].find(
        (candidate) => candidate.textContent?.includes(label),
      );
    const rows = () => document.body.querySelectorAll("tbody tr").length;

    expect(rows()).toBe(2);
    await act(async () => {
      chipFor(i18n.t("plugins.hub.categories.dev"))!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(rows()).toBe(1);
    expect(document.body.textContent).not.toContain("彩虹跑马灯边界线");

    // React's value tracker needs the native setter before a synthetic change.
    const search = document.body.querySelector<HTMLInputElement>(
      `input[placeholder="${i18n.t("plugins.hub.searchPlaceholder")}"]`,
    )!;
    expect(search).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        search,
        "not-a-plugin",
      );
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(document.body.textContent).toContain(i18n.t("plugins.hub.noMatch"));

    await act(async () => {
      buttonByText(i18n.t("plugins.hub.clearFilters")).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(rows()).toBe(2);
  });

  it("marks installed market entries with the installed action instead of install", async () => {
    pluginList.mockImplementation(async () => [installedPlugin({ id: "react-doctor" })]);
    await render();
    await act(async () => {
      // The market view refreshes the installed list on mount.
    });

    expect(() => buttonByText(i18n.t("plugins.hub.install"))).toThrow();
    expect(buttonByText(i18n.t("plugins.hub.installed"))).toBeDefined();
  });

  it("turns the installed action into an update when the index is newer", async () => {
    pluginFetchIndex.mockImplementation(async () => [{ ...MARKET_ENTRY, version: "0.3.0" }]);
    pluginCheckUpdates.mockImplementation(async () => [
      { id: "react-doctor", currentVersion: "0.2.0", latestVersion: "0.3.0" },
    ]);
    pluginList.mockImplementation(async () => [
      installedPlugin({ id: "react-doctor", version: "0.2.0" }),
    ]);
    await render();
    await act(async () => {});

    expect(buttonByText(i18n.t("plugins.hub.updateTo", { version: "0.3.0" }))).toBeDefined();
    expect(() => buttonByText(i18n.t("plugins.hub.install"))).toThrow();
  });

  it("drops the installs column when the index has no stats", async () => {
    pluginFetchIndex.mockImplementation(async () => [{ ...MARKET_ENTRY, downloads: null }]);
    await render();

    expect(document.body.textContent).not.toContain(i18n.t("plugins.hub.tableDownloads"));
    expect(document.body.textContent).not.toContain(DOWNLOADS.toLocaleString());
  });

  it("abbreviates install counts once they round to 1K", async () => {
    pluginFetchIndex.mockImplementation(async () => [{ ...MARKET_ENTRY, downloads: 1280 }]);
    await render();

    expect(document.body.textContent).toContain("1.3K");
    expect(document.body.textContent).not.toContain("1,280");
  });

  it("opens the full-page detail: carousel, README, rail and repo link", async () => {
    await render();
    await act(async () => {
      buttonContaining("React Doctor").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // The README arrives through a mocked IPC round-trip in an effect.
    await act(async () => {});

    expect(pluginFetchMarketReadme).toHaveBeenCalledWith("react-doctor");
    // The detail owns the whole surface — the browse chrome is gone.
    expect(document.body.textContent).toContain(i18n.t("plugins.hub.backToList"));
    expect(
      document.body.querySelector(
        `button[aria-label="${i18n.t("plugins.hub.refresh")}"]`,
      ),
    ).toBeNull();
    // README markdown rendered below the gallery.
    expect(document.body.textContent).toContain("一键运行代码体检。");
    // The detail header keeps the indexed icon, not just the letter tile.
    expect(document.body.querySelector(`img[src="${MARKET_ENTRY.icon}"]`)).not.toBeNull();

    // Carousel: two screenshots, counter + navigation affordances.
    expect(
      document.body.textContent,
    ).toContain(i18n.t("plugins.hub.screenshotCounter", { current: 1, total: 2 }));
    expect(buttonByLabel(i18n.t("plugins.hub.screenshotNext"))).toBeDefined();

    // The rail carries author / compatibility / permissions / links.
    expect(document.body.textContent).toContain(i18n.t("plugins.hub.author"));
    expect(document.body.textContent).toContain(i18n.t("plugins.hub.compatibility"));
    expect(document.body.textContent).toContain(
      i18n.t("plugins.hub.minAppShort", { version: MARKET_ENTRY.minAppVersion! }),
    );
    expect(document.body.textContent).toContain(i18n.t("plugins.hub.permissionsTitle"));
    // Grant-shaped permissions read as sentences, not raw ids.
    expect(document.body.textContent).toContain(i18n.t("plugins.hub.permissions.storage"));
    expect(document.body.textContent).toContain("claude");
    // Freshness is the index stamp, formatted for the active locale.
    expect(document.body.textContent).toContain(i18n.t("plugins.hub.updatedAt"));
    expect(document.body.textContent).toContain(
      new Date(UPDATED_AT).toLocaleDateString(i18n.language),
    );

    const repoLink = buttonContaining(i18n.t("plugins.hub.repo"));
    // Each destination names its surface with an icon (GitHub mark / tag /
    // issue dot), so the three links are tellable apart before reading them.
    expect(repoLink.querySelector(".lucide-github")).not.toBeNull();
    expect(buttonContaining(i18n.t("plugins.hub.releases")).querySelector(".lucide-tag"))
      .not.toBeNull();
    expect(buttonContaining(i18n.t("plugins.hub.issues")).querySelector(".lucide-circle-dot"))
      .not.toBeNull();
    await act(async () => {
      repoLink.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(openExternal).toHaveBeenCalledWith(`https://github.com/${MARKET_ENTRY.repo}`);

    // Back returns to the browse surface.
    await act(async () => {
      buttonByText(i18n.t("plugins.hub.backToList")).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(document.body.textContent).toContain(i18n.t("plugins.hub.tableName"));
  });

  it("opens the developer's GitHub profile from the detail rail", async () => {
    await render();
    await act(async () => {
      buttonContaining("React Doctor").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {});

    const authorChip = [...document.body.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.trim() === MARKET_ENTRY.author,
    );
    expect(authorChip).toBeDefined();
    expect(authorChip!.getAttribute("title")).toBe(
      i18n.t("plugins.hub.authorGithub", { login: MARKET_ENTRY.author }),
    );
    await act(async () => {
      authorChip!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(openExternal).toHaveBeenCalledWith(`https://github.com/${MARKET_ENTRY.author}`);
  });

  it("keeps the developer rail inert when no GitHub account is resolvable", async () => {
    pluginFetchIndex.mockImplementation(async () => [
      { ...MARKET_ENTRY, author: "Libo Zhou", repo: "" },
    ]);
    await render();
    await act(async () => {
      buttonContaining("React Doctor").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {});

    // A display name with no repo owner to fall back to is not a link: no
    // guessed GitHub URL, and the name still reads as plain rail text.
    expect(document.body.textContent).toContain("Libo Zhou");
    expect(
      [...document.body.querySelectorAll("button")].some(
        (candidate) => candidate.textContent?.trim() === "Libo Zhou",
      ),
    ).toBe(false);
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("hides the update time for index entries without a stamp", async () => {
    pluginFetchIndex.mockImplementation(async () => [{ ...MARKET_ENTRY, updatedAt: null }]);
    await render();
    await act(async () => {
      buttonContaining("React Doctor").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {});

    // No stamp means no row — the rail never shows a placeholder date.
    expect(document.body.textContent).not.toContain(i18n.t("plugins.hub.updatedAt"));
  });

  it("filters installed plugins by source and recency from the header select", async () => {
    usePluginHubStore.setState({ view: "installed" });
    // installedAt 是 Unix 秒，和 backend 同单位。
    const nowSecs = Math.floor(Date.now() / 1000);
    pluginList.mockImplementation(async () => [
      installedPlugin({
        id: "auto-title",
        name: "会话自动命名",
        source: "marketplace",
        installedAt: nowSecs - 3600,
      }),
      installedPlugin({
        id: "kimi-lb",
        name: "Kimi LB",
        source: "local",
        installedAt: nowSecs - 20 * 24 * 3600,
      }),
      installedPlugin({
        id: "git-tasks",
        name: "Git 任务管理",
        source: "local",
        installedAt: nowSecs - 3600,
      }),
    ]);
    await render();
    // refresh() runs in an effect; flush the mocked IPC round-trip.
    await act(async () => {});

    const shows = (name: string) => document.body.textContent?.includes(name) ?? false;
    expect(shows("会话自动命名")).toBe(true);
    expect(shows("Kimi LB")).toBe(true);
    expect(shows("Git 任务管理")).toBe(true);

    // 最近安装：只留 3 天窗口内的，20 天前的本地插件出局。
    await selectInstalledFilter(i18n.t("plugins.hub.installedFilter.recent"));
    expect(shows("会话自动命名")).toBe(true);
    expect(shows("Git 任务管理")).toBe(true);
    expect(shows("Kimi LB")).toBe(false);

    // 市场安装：来源为 marketplace 的只剩一个。
    await selectInstalledFilter(i18n.t("plugins.hub.installedFilter.marketplace"));
    expect(shows("会话自动命名")).toBe(true);
    expect(shows("Git 任务管理")).toBe(false);

    // 本地安装 + 搜索无命中：空状态把搜索框与下拉一起复位。
    await selectInstalledFilter(i18n.t("plugins.hub.installedFilter.local"));
    const search = document.body.querySelector<HTMLInputElement>(
      `input[placeholder="${i18n.t("plugins.hub.searchPlaceholder")}"]`,
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        search,
        "not-a-plugin",
      );
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(document.body.textContent).toContain(i18n.t("plugins.hub.noMatch"));
    await act(async () => {
      buttonByText(i18n.t("plugins.hub.clearFilters")).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(shows("会话自动命名")).toBe(true);
    expect(shows("Kimi LB")).toBe(true);
    expect(shows("Git 任务管理")).toBe(true);
  });

  it("manages installed plugins: uninstall confirmation and quarantine retry", async () => {
    usePluginHubStore.setState({ view: "installed" });
    pluginList.mockImplementation(async () => [
      installedPlugin({ id: "auto-title" }),
      installedPlugin({ id: "broken", name: "Broken", quarantined: true, enabled: false }),
    ]);
    await render();
    // refresh() runs in an effect; flush the mocked IPC round-trip.
    await act(async () => {});
    expect(document.body.textContent).toContain("会话自动命名");
    // Quarantined rows surface the explicit reload affordance.
    expect(buttonByLabel(i18n.t("plugins.reload"))).toBeDefined();

    // Quarantine → retry re-enables through the backend's trust-it-again upsert.
    await act(async () => {
      buttonByLabel(i18n.t("plugins.reload")).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(pluginSetEnabled).toHaveBeenCalledWith("broken", true);

    // Uninstall goes through the real modal.
    await act(async () => {
      buttonByLabel(i18n.t("plugins.uninstall")).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(document.body.textContent).toContain(
      i18n.t("plugins.uninstallConfirm", { name: "会话自动命名" }),
    );
    await act(async () => {
      buttonByText(i18n.t("common.confirm")).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(pluginUninstall).toHaveBeenCalledWith("auto-title", false);
  });

  it("keeps the development guide behind the header entry", async () => {
    await render();
    expect(document.body.textContent).not.toContain(i18n.t("plugins.market.localTitle"));

    await act(async () => {
      buttonByText(i18n.t("plugins.hub.guide")).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(document.body.textContent).toContain(i18n.t("plugins.market.developTitle"));
    expect(document.body.textContent).toContain(i18n.t("plugins.market.aiTitle"));
    expect(document.body.textContent).toContain(i18n.t("plugins.market.localTitle"));
    expect(document.body.textContent).toContain(i18n.t("plugins.market.submitTitle"));
  });

  it("hands 「创建插件」 to the chat layer and blocks it without a workspace", async () => {
    const onCreatePluginChat = vi.fn();
    await act(async () => {
      root!.render(<PluginHub onCreatePluginChat={onCreatePluginChat} />);
    });
    await act(async () => {
      buttonByText(i18n.t("plugins.hub.create")).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(onCreatePluginChat).toHaveBeenCalledTimes(1);

    // 没有工作区时（ChatCenterPane 传 null）：按钮置灰且有指针提示，不是静默无反应。
    await act(async () => {
      root!.render(<PluginHub onCreatePluginChat={null} />);
    });
    const blocked = buttonByText(i18n.t("plugins.hub.create"));
    expect(blocked.disabled).toBe(true);
    expect(blocked.title).toBe(i18n.t("plugins.hub.createNoWorkspace"));
  });
});
