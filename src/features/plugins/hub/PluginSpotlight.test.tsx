import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeaturedPlugin, MarketPlugin } from "@/lib/ipc";

/**
 * 轮播的合同只有四条，测试按这四条写：
 * 1. 没有精选数据 = 整个区块不渲染（装饰层不影响表格）。
 * 2. 翻页三条路都要通：进度条跑满、箭头、圆点；键盘 ←/→ 只在轮播内生效。
 * 3. 自动播放要能停：悬停 / 焦点进入 / 减少动效下进度条暂停，不翻页。
 * 4. 素材降级不留空洞：封面 404 → 截图 → icon → 渐变瓦片，永远画满。
 */
const pluginFetchIndex = vi.fn(async (_force?: boolean): Promise<MarketPlugin[]> => []);
const pluginFetchFeatured = vi.fn(async (_force?: boolean): Promise<FeaturedPlugin[]> => []);
const pluginCheckUpdates = vi.fn(async () => []);
const pluginInstallFromMarketplace = vi.fn(async (id: string) => ({ id }));
const pluginList = vi.fn(async () => []);
vi.mock("@/lib/ipc", () => ({
  ipc: {
    pluginFetchIndex: (force?: boolean) => pluginFetchIndex(force),
    pluginFetchFeatured: (force?: boolean) => pluginFetchFeatured(force),
    pluginCheckUpdates: () => pluginCheckUpdates(),
    pluginInstallFromMarketplace: (id: string) => pluginInstallFromMarketplace(id),
    pluginList: () => pluginList(),
    pluginReadArtwork: vi.fn(async () => "data:image/png;base64,AAAA"),
  },
}));
vi.mock("@/lib/events", () => ({ listenPluginInstallProgress: vi.fn(async () => () => {}) }));
vi.mock("@/lib/platform", () => ({ isWeb: false, openExternal: vi.fn(), pickFile: vi.fn(async () => null) }));

const reduceMotion = { value: false };
vi.mock("motion/react", () => ({ useReducedMotion: () => reduceMotion.value }));

import { PluginSpotlight } from "./PluginSpotlight";
import { useMarketplaceStore } from "../marketplace/store";
import { usePluginsStore } from "../manager/usePlugins";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function entry(over: Partial<MarketPlugin> = {}): MarketPlugin {
  return {
    id: "react-doctor",
    repo: "zhukunpenglinyutong/ccgui-plugin-react-doctor",
    name: "React Doctor",
    description: "索引里的原始描述",
    author: "zhukunpenglinyutong",
    tier: "js",
    version: "0.3.1",
    updatedAt: null,
    minAppVersion: null,
    sdkVersion: null,
    permissions: [],
    downloads: 318,
    screenshots: [],
    icon: null,
    ...over,
  };
}

const featured = (over: Partial<FeaturedPlugin> = {}): FeaturedPlugin => ({
  id: "react-doctor",
  tagline: "一条命令给项目做体检",
  note: null,
  image: null,
  ...over,
});

describe("PluginSpotlight", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    reduceMotion.value = false;
    usePluginsStore.setState({ installed: [], loaded: true, error: null, installing: null });
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    container?.remove();
    root = null;
  });

  /** Render with the given index / featured fixtures (no IPC involved). */
  async function renderMarket(entries: MarketPlugin[], rows: FeaturedPlugin[]) {
    useMarketplaceStore.setState({
      entries,
      featured: rows,
      loaded: true,
      error: null,
      updates: [],
      installing: null,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(<PluginSpotlight onOpenDetail={() => {}} />);
    });
  }

  const carousel = () => document.body.querySelector('[aria-roledescription="carousel"]');
  const slides = () => document.body.querySelectorAll('[aria-roledescription="slide"]');
  const progress = () =>
    document.body.querySelector<HTMLElement>(".animate-spotlight-progress");
  const byLabel = (label: string) =>
    document.body.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  const byText = (text: string) =>
    [...document.body.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)!;
  /** react-aria 的 Button 走 pointerdown + click 成对事件；只派 click 不会触发 onClick。 */
  async function press(el: Element) {
    await act(async () => {
      for (const type of ["pointerdown", "mousedown", "mouseup", "click"]) {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
      }
    });
  }

  it("renders nothing at all when the featured list is empty", async () => {
    await renderMarket([entry()], []);
    expect(carousel()).toBeNull();
  });

  it("drops featured rows whose id is not in the index", async () => {
    await renderMarket([entry()], [featured({ id: "ghost" })]);
    // 后端已经过滤过一次，这里兜「刷新到一半」的中间态：宁可整块不渲染
    expect(carousel()).toBeNull();
  });

  it("opens on the first row and shows the editorial copy over the index data", async () => {
    await renderMarket([entry()], [featured()]);
    const text = carousel()!.textContent ?? "";
    expect(text).toContain("一条命令给项目做体检"); // tagline
    expect(text).toContain("React Doctor");
    expect(text).toContain("318"); // 安装量仍以索引为准
    expect(text).toContain("1 / 1");
  });

  it("falls back to the index description when the row carries no tagline", async () => {
    await renderMarket([entry()], [featured({ tagline: null })]);
    expect(carousel()!.textContent).toContain("索引里的原始描述");
  });

  it("moves to the next slide when the progress bar finishes (the bar is the timer)", async () => {
    await renderMarket(
      [entry(), entry({ id: "auto-title", name: "会话自动命名" })],
      [featured(), featured({ id: "auto-title", tagline: "再也不用起名字" })],
    );
    expect(progress()).not.toBeNull();

    await act(async () => {
      progress()!.dispatchEvent(new Event("animationend", { bubbles: true }));
    });

    expect(carousel()!.textContent).toContain("2 / 2");
    const slidesNow = slides();
    expect(slidesNow[1]!.getAttribute("aria-hidden")).toBe("false");
    expect(slidesNow[0]!.getAttribute("aria-hidden")).toBe("true");
  });

  it("navigates with the arrows and the dots, and stops autoplay while hovered", async () => {
    await renderMarket(
      [entry(), entry({ id: "auto-title", name: "会话自动命名" })],
      [featured(), featured({ id: "auto-title", tagline: "再也不用起名字" })],
    );

    await act(async () => {
      carousel()!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    // 悬停：进度条暂停 —— 进度条就是计时器，条停 = 翻页停
    expect(progress()!.className).toContain("[animation-play-state:paused]");

    await press(byLabel("上一条精选"));
    expect(carousel()!.textContent).toContain("2 / 2"); // 首页往前 = 绕到最后一张

    await press(byLabel("下一条精选"));
    expect(carousel()!.textContent).toContain("1 / 2");

    const dot = [...document.body.querySelectorAll<HTMLElement>('[role="tab"]')][1]!;
    await press(dot);
    expect(carousel()!.textContent).toContain("2 / 2");
  });

  it("does not autoplay under prefers-reduced-motion", async () => {
    reduceMotion.value = true;
    await renderMarket([entry()], [featured()]);
    // 关键帧降级成 animate-none → 没有 animationend → 永不自动翻页
    expect(progress()!.className).toContain("motion-reduce:animate-none");
  });

  it("keeps arrow keys inside the carousel", async () => {
    await renderMarket(
      [entry(), entry({ id: "auto-title", name: "会话自动命名" })],
      [featured(), featured({ id: "auto-title" })],
    );
    await act(async () => {
      byLabel("下一条精选").dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    expect(carousel()!.textContent).toContain("2 / 2");
  });

  it("degrades a broken cover to the screenshot, then the icon, then the tile", async () => {
    const shots = ["https://raw.test/shot.png"];
    const icon = "https://raw.test/icon.png";
    await renderMarket(
      [entry({ screenshots: shots, icon })],
      [featured({ image: "https://raw.test/cover.png" })],
    );

    const cover = () => document.body.querySelector<HTMLImageElement>("img");
    expect(cover()!.src).toContain("cover.png");

    // 编辑封面 404 → 插件自己的截图（原比例装帧，不裁切）
    await act(async () => {
      cover()!.dispatchEvent(new Event("error"));
    });
    expect(cover()!.src).toContain("shot.png");
    expect(cover()!.className).toContain("object-contain");

    // 截图也 404 → icon
    await act(async () => {
      cover()!.dispatchEvent(new Event("error"));
    });
    expect(cover()!.src).toContain("icon.png");

    // icon 也 404 → 渐变瓦片（PluginAvatar 自己消化失败，卡片不留空洞）
    await act(async () => {
      cover()!.dispatchEvent(new Event("error"));
    });
    expect(document.body.querySelector("img")).toBeNull();
    expect(carousel()!.textContent).toContain("R"); // 首字瓦片
  });

  it("installs from the carousel through the same store action the table row uses", async () => {
    await renderMarket([entry()], [featured()]);

    await press(byText("安装"));

    expect(pluginInstallFromMarketplace).toHaveBeenCalledWith("react-doctor");
  });
});
