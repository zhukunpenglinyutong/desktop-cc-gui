import { create } from "zustand";
import { readStoredJson, writeStored } from "./storage";

/**
 * 底部状态栏的显隐偏好（设置 → 插件 → 状态栏显示）。
 *
 * 存**隐藏集合**而不是显示集合：默认空集＝全部可见，新装的插件和宿主新增
 * 的内置项都会自动出现，不需要给老用户做数据迁移。
 *
 * 只存本机 localStorage，理由有二：
 * 1. 这是纯视觉偏好，换机器重设一次的代价可以忽略；
 * 2. 后端 AppSettings 是 Rust 侧的结构体，加字段要同步改 `src-tauri`，
 *    版本不一致时写入会被静默丢弃——用 localStorage 才能让这条偏好
 *    在旧版内核上也立即生效。
 */

/** 内置项的稳定 id：跟随语义而不是位置或文案，宿主重排 UI 时不受影响。 */
export const STATUS_BAR_BUILTIN_IDS = {
  performance: "builtin:performance",
  zoom: "builtin:zoom",
  sync: "builtin:sync",
  version: "builtin:version",
} as const;

export type StatusBarBuiltinId =
  (typeof STATUS_BAR_BUILTIN_IDS)[keyof typeof STATUS_BAR_BUILTIN_IDS];

/**
 * 内置项目录：设置页的开关、搜索索引都从这一份推导，避免三处各写一遍
 * 文案键而漂移。顺序就是设置页的展示顺序。
 */
export const STATUS_BAR_BUILTIN_CATALOG = [
  {
    id: STATUS_BAR_BUILTIN_IDS.performance,
    labelKey: "settings.statusBarPerformance",
    /** `SettingsRow anchor`；搜索索引按同一份值声明。 */
    anchor: "statusBar-performance",
  },
  {
    id: STATUS_BAR_BUILTIN_IDS.zoom,
    labelKey: "settings.statusBarZoom",
    anchor: "statusBar-zoom",
  },
  {
    id: STATUS_BAR_BUILTIN_IDS.sync,
    labelKey: "settings.statusBarSync",
    anchor: "statusBar-sync",
  },
  {
    id: STATUS_BAR_BUILTIN_IDS.version,
    labelKey: "settings.statusBarVersion",
    anchor: "statusBar-version",
  },
] as const satisfies readonly {
  id: StatusBarBuiltinId;
  labelKey: string;
  anchor: string;
}[];

const STORAGE_KEY = "ccgui.statusBar.hidden";

/**
 * 读盘：只接受字符串数组，其余（缺失、损坏、类型不符）一律退化成
 * 「全部可见」——隐错一项比多显示一项更烦人，默认必须是保守的可见。
 */
function readHidden(): string[] {
  const stored = readStoredJson<string[]>(STORAGE_KEY, (value) =>
    Array.isArray(value) && value.every((item) => typeof item === "string")
      ? (value as string[])
      : null,
  );
  return stored ?? [];
}

interface StatusBarVisibilityState {
  /** 被隐藏的项：内置 `builtin:*`，或插件的 `plugin:<pluginId>[:<key>]`。 */
  hidden: ReadonlySet<string>;
  /** 一次改多个 id（按插件一个开关＝多个 chip 同进同退）。 */
  setVisible: (ids: readonly string[], visible: boolean) => void;
}

export const useStatusBarVisibilityStore = create<StatusBarVisibilityState>(
  (set, get) => ({
    hidden: new Set(readHidden()),
    setVisible: (ids, visible) => {
      const next = new Set(get().hidden);
      for (const id of ids) {
        if (visible) next.delete(id);
        else next.add(id);
      }
      set({ hidden: next });
      // 应用内即改即生效；写盘失败只是不跨重启，不影响本次会话。
      writeStored(STORAGE_KEY, JSON.stringify([...next]));
    },
  }),
);

/** 组件里读当前隐藏集合（O(1) 查询，不复制）。 */
export function useStatusBarHidden(): ReadonlySet<string> {
  return useStatusBarVisibilityStore((state) => state.hidden);
}

/** 命令式读写，给非组件路径（测试、快捷键）用。 */
export function isStatusBarItemHidden(id: string): boolean {
  return useStatusBarVisibilityStore.getState().hidden.has(id);
}

export function setStatusBarItemsVisible(
  ids: readonly string[],
  visible: boolean,
): void {
  useStatusBarVisibilityStore.getState().setVisible(ids, visible);
}
