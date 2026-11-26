import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import { sidebarNavRegistry, type Disposer } from "@ccgui/plugin-sdk";
import { SIDEBAR_PLUGIN_ORDER_KEY, SIDEBAR_PLUGIN_EXPANDED_KEY } from "@/lib/sidebar-plugin-nav";
import { SidebarPrimaryNav } from "./sidebar-chrome";

const PLUGINS_NAV_ORDER_KEY = "ccgui-next.settingsPluginsNavOrder:v1";
const PLUGINS_NAV_EXPANDED_KEY = "ccgui-next.settingsPluginsNavExpanded:v1";

const sortable = vi.hoisted(() => ({ reorder: null as null | ((keys: string[]) => void) }));
vi.mock("./workspace-sortable-list", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./workspace-sortable-list")>();
  return {
    ...actual,
    WorkspaceSortableList: (props: Parameters<typeof actual.WorkspaceSortableList>[0]) => {
      sortable.reorder = props.onReorder ?? null;
      return <actual.WorkspaceSortableList {...props} />;
    },
  };
});

/**
 * M0 入口验收：侧栏「自动化」占位项被原生「任务工作台」取代，
 * 点击打开工作台中心页签。
 */

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let disposers: Disposer[];

beforeEach(() => {
  localStorage.clear();
  disposers = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  act(() => root.unmount());
  container.remove();
  disposers.forEach((dispose) => dispose());
  vi.unstubAllGlobals();
  await i18n.changeLanguage("zh");
});

describe("SidebarPrimaryNav", () => {
  it("replaces the automation placeholder with the native mission workbench entry", () => {
    const onOpenMission = vi.fn();
    act(() => {
      root.render(
        <SidebarPrimaryNav
          onNewSession={() => {}}
          onNewBrowser={() => {}}
          onOpenMission={onOpenMission}
        />,
      );
    });

    const labels = [...container.querySelectorAll("button")].map((button) =>
      button.getAttribute("aria-label"),
    );
    expect(labels).toContain("新建会话");
    expect(labels).toContain("新建浏览器");
    expect(labels).toContain("任务工作台");
    expect(container.textContent).not.toContain("自动化");
    expect(container.textContent).not.toContain("即将开放");

    const entry = container.querySelector<HTMLButtonElement>('button[aria-label="任务工作台"]')!;
    act(() => {
      entry.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(onOpenMission).toHaveBeenCalledTimes(1);
  });

  it("puts the 插件 hub entry directly under 新建会话", () => {
    const onOpenPlugins = vi.fn();
    act(() => {
      root.render(
        <SidebarPrimaryNav
          onNewSession={() => {}}
          onOpenPlugins={onOpenPlugins}
        />,
      );
    });

    const labels = [...container.querySelectorAll("button")].map((button) =>
      button.getAttribute("aria-label"),
    );
    expect(labels[0]).toBe("新建会话");
    expect(labels[1]).toBe("插件");

    const entry = container.querySelector<HTMLButtonElement>('button[aria-label="插件"]')!;
    act(() => {
      entry.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(onOpenPlugins).toHaveBeenCalledTimes(1);
  });
});


function addPlugin(id: string, onOpen = vi.fn()) {
  const dispose = sidebarNavRegistry.register({ id, label: () => id, onOpen });
  disposers.push(dispose);
  return dispose;
}
const toggle = () => container.querySelector<HTMLButtonElement>("button[aria-expanded]");
const labels = () => [...container.querySelectorAll("[data-workspace-id]")].map((row) => row.getAttribute("data-workspace-id"));
const render = (onOpenPlugins = vi.fn()) => act(() => root.render(<SidebarPrimaryNav onOpenPlugins={onOpenPlugins} onNewBrowser={() => {}} />));

describe("侧栏插件分组", () => {
  it("入口数量从零到多项再到一项时控件正确，单入口保持旧位置并始终可见", () => {
    render();
    expect(toggle()).toBeNull();
    act(() => { addPlugin("plugin:a:one"); });
    expect(toggle()).toBeNull();
    const first = [...container.querySelectorAll("button")].map((row) => row.getAttribute("aria-label"));
    expect(first.indexOf("plugin:a:one")).toBeGreaterThan(first.indexOf("新建浏览器"));
    let removeB!: Disposer;
    act(() => { removeB = addPlugin("plugin:a:two"); });
    expect(toggle()?.getAttribute("aria-expanded")).toBe("true");
    act(() => toggle()!.click());
    expect(localStorage.getItem(SIDEBAR_PLUGIN_EXPANDED_KEY)).toBe("false");
    act(() => removeB());
    expect(toggle()).toBeNull();
    expect(container.querySelector('[aria-hidden="true"][inert]')).toBeNull();
    expect(container.textContent).toContain("plugin:a:one");
    act(() => { addPlugin("plugin:a:two"); });
    expect(toggle()?.getAttribute("aria-expanded")).toBe("false");
  });

  it("尾随箭头与插件中心独立，无嵌套按钮，手柄点击不打开页面", () => {
    const hub = vi.fn();
    const open = vi.fn();
    addPlugin("plugin:a", open);
    addPlugin("plugin:b");
    render(hub);
    const header = toggle()!.parentElement!;
    expect(header.firstElementChild?.getAttribute("aria-label")).toBe("插件");
    expect(header.lastElementChild).toBe(toggle());
    expect(toggle()!.getAttribute("aria-controls")).toBeTruthy();
    expect(container.querySelector("button button")).toBeNull();
    act(() => (header.firstElementChild as HTMLButtonElement).click());
    expect(hub).toHaveBeenCalledTimes(1);
    expect(toggle()?.getAttribute("aria-expanded")).toBe("true");
    act(() => container.querySelector<HTMLButtonElement>('[title="拖拽排序：plugin:a"]')!.click());
    expect(open).not.toHaveBeenCalled();
    act(() => toggle()!.click());
    expect(hub).toHaveBeenCalledTimes(1);
    expect(toggle()?.getAttribute("aria-expanded")).toBe("false");
    const list = document.getElementById(toggle()!.getAttribute("aria-controls")!);
    expect(list?.querySelector('[aria-hidden="true"][inert]')).not.toBeNull();
  });

  it("保存独立排序与折叠，入口增减、新增以及重建均保留用户顺序", () => {
    const settingsOrder = '["plugin:settings-only"]';
    localStorage.setItem(PLUGINS_NAV_ORDER_KEY, settingsOrder);
    localStorage.setItem(PLUGINS_NAV_EXPANDED_KEY, "false");
    localStorage.setItem(SIDEBAR_PLUGIN_ORDER_KEY, '["plugin:b", "plugin:a"]');
    addPlugin("plugin:a");
    const removeB = addPlugin("plugin:b");
    render();
    expect(toggle()?.getAttribute("aria-expanded")).toBe("true");
    expect(labels()).toEqual(["plugin:b", "plugin:a"]);
    act(() => { addPlugin("plugin:new"); removeB(); });
    expect(labels()).toEqual(["plugin:a", "plugin:new"]);
    act(() => sortable.reorder!(["plugin:new", "plugin:a"]));
    expect(localStorage.getItem(SIDEBAR_PLUGIN_ORDER_KEY)).toBe('["plugin:b","plugin:new","plugin:a"]');
    act(() => { addPlugin("plugin:b"); });
    expect(labels()).toEqual(["plugin:b", "plugin:new", "plugin:a"]);
    act(() => toggle()!.click());
    act(() => root.unmount());
    root = createRoot(container);
    render();
    expect(toggle()?.getAttribute("aria-expanded")).toBe("false");
    act(() => toggle()!.click());
    expect(labels()).toEqual(["plugin:b", "plugin:new", "plugin:a"]);
    expect(localStorage.getItem(PLUGINS_NAV_ORDER_KEY)).toBe(settingsOrder);
    expect(localStorage.getItem(PLUGINS_NAV_EXPANDED_KEY)).toBe("false");
  });
});


it("存储被拒绝时仍可折叠和打开插件，重新挂载回退默认值", () => {
  const denied = () => { throw new DOMException("storage denied", "SecurityError"); };
  vi.stubGlobal("localStorage", { getItem: denied, setItem: denied });
  const open = vi.fn();
  addPlugin("plugin:denied:a", open);
  addPlugin("plugin:denied:b");
  expect(() => render()).not.toThrow();
  expect(toggle()?.getAttribute("aria-expanded")).toBe("true");
  act(() => toggle()!.click());
  expect(toggle()?.getAttribute("aria-expanded")).toBe("false");
  act(() => toggle()!.click());
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="plugin:denied:a"]')!.click());
  expect(open).toHaveBeenCalledOnce();
  act(() => sortable.reorder!(["plugin:denied:b", "plugin:denied:a"]));
  expect(labels()).toEqual(["plugin:denied:b", "plugin:denied:a"]);
  act(() => root.unmount());
  root = createRoot(container);
  render();
  expect(toggle()?.getAttribute("aria-expanded")).toBe("true");
  expect(labels()).toEqual(["plugin:denied:a", "plugin:denied:b"]);
});

it.each(["zh", "en", "ko"])("%s 语言下折叠与拖拽控件具有正确可访问名称", async (language) => {
  await i18n.changeLanguage(language);
  addPlugin("plugin:locale:a");
  addPlugin("plugin:locale:b");
  render();
  expect(toggle()?.getAttribute("aria-label")).toBe(i18n.t("plugins.hub.collapseEntries"));
  expect(container.querySelector('[title]')?.getAttribute("title")).toBe(i18n.t("plugins.hub.dragEntry", { name: "plugin:locale:a" }));
  act(() => toggle()!.click());
  expect(toggle()?.getAttribute("aria-label")).toBe(i18n.t("plugins.hub.expandEntries"));
});
