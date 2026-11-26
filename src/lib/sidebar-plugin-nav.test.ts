import { afterEach, describe, expect, it } from "vitest";
import {
  SIDEBAR_PLUGIN_ORDER_KEY, SIDEBAR_PLUGIN_EXPANDED_KEY,
  readSidebarPluginOrder, readSidebarPluginsExpanded, mergeSidebarPluginOrder,
} from "./sidebar-plugin-nav";

afterEach(() => {
  localStorage.removeItem(SIDEBAR_PLUGIN_ORDER_KEY);
  localStorage.removeItem(SIDEBAR_PLUGIN_EXPANDED_KEY);
});

describe("侧栏插件偏好", () => {
  it("默认展开、校验损坏数据并去重完整入口 id", () => {
    expect(readSidebarPluginsExpanded()).toBe(true);
    expect(readSidebarPluginOrder()).toEqual([]);
    localStorage.setItem(SIDEBAR_PLUGIN_EXPANDED_KEY, "false");
    expect(readSidebarPluginsExpanded()).toBe(false);
    localStorage.setItem(SIDEBAR_PLUGIN_EXPANDED_KEY, '"false"');
    expect(readSidebarPluginsExpanded()).toBe(true);
    localStorage.setItem(SIDEBAR_PLUGIN_ORDER_KEY, "broken");
    expect(readSidebarPluginOrder()).toEqual([]);
    localStorage.setItem(SIDEBAR_PLUGIN_ORDER_KEY, '["plugin:a:one", 2]');
    expect(readSidebarPluginOrder()).toEqual([]);
    localStorage.setItem(SIDEBAR_PLUGIN_ORDER_KEY, '["plugin:a:one", "plugin:a:two", "plugin:a:one"]');
    expect(readSidebarPluginOrder()).toEqual(["plugin:a:one", "plugin:a:two"]);
  });

  it("保留暂时停用入口的位置，未存储的新入口追加", () => {
    expect(mergeSidebarPluginOrder(["a", "disabled", "b"], ["b", "a", "new"]))
      .toEqual(["b", "disabled", "a", "new"]);
    expect(mergeSidebarPluginOrder([], ["b", "a"])).toEqual(["b", "a"]);
  });
});
