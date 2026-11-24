import { readStoredJson } from "./storage";

// 侧栏以完整入口 id 排序，不使用设置页的 section key 或存储键。
export const SIDEBAR_PLUGIN_ORDER_KEY = "ccgui-next.sidebarPluginNavOrder:v1";
export const SIDEBAR_PLUGIN_EXPANDED_KEY = "ccgui-next.sidebarPluginNavExpanded:v1";

export const readSidebarPluginOrder = (): string[] =>
  readStoredJson(SIDEBAR_PLUGIN_ORDER_KEY, (value) =>
    Array.isArray(value) && value.every((key) => typeof key === "string")
      ? [...new Set<string>(value)]
      : null,
  ) ?? [];

export const readSidebarPluginsExpanded = (): boolean =>
  readStoredJson(SIDEBAR_PLUGIN_EXPANDED_KEY, (value) =>
    typeof value === "boolean" ? value : null,
  ) ?? true;

/** 重排当前入口时保留暂时停用的入口位置，新入口追加。 */
export function mergeSidebarPluginOrder(previous: string[], keys: string[]): string[] {
  const visible = new Set(keys);
  let index = 0;
  const next = previous.map((key) => visible.has(key) ? keys[index++] : key);
  return [...next, ...keys.slice(index)];
}
