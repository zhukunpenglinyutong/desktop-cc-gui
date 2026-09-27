import { useSyncExternalStore, type ComponentType } from "react";
import type { Components } from "react-markdown";
import type { Disposer } from "./manifest";
import type { PluginConversationProps } from "./context";

export interface ConversationModeDef {
  id: string;
  label: () => string;
  component: ComponentType<PluginConversationProps>;
}

/**
 * 扩展点定义类型（plan §4.2）与注册表（plan §4.1 runtime/registry.ts）。
 * 宿主业务代码与插件运行时都经本包访问，不再触达 features/plugins 内部。
 * 本模块是包内唯一依赖 React 运行时的模块（useSyncExternalStore）。
 */

// ---------------------------------------------------------------------------
// 扩展点定义类型（plan §4.2）
// ---------------------------------------------------------------------------

/** Settings extension point entry. `key` is the `?page=` value; plugin
 *  sections are auto-prefixed `plugin:<id>` by the context. */
export interface SettingsSectionDef {
  id: string;
  /** Settings nav key (URL-stable). */
  key: string;
  /** Resolved at render time so language flips re-label the rail. */
  label: () => string;
  icon?: ComponentType<{ className?: string }>;
  /** Nav group id: 系统 system / 插件 plugins / CLI 管理 cli / 工作区与数据
   *  workspace / 其他 misc. Open string so SDK consumers can introduce new
   *  rails — the settings page appends unknown groups after the known ones. */
  group: string;
  /** Rail order within the group; builtins use their old fixed order,
   *  plugin sections default after them. */
  order: number;
  component: ComponentType;
}

/** Composer "Add" menu extension row (plan §4.2 #3). */
export interface AddMenuRowDef {
  id: string;
  label: () => string;
  description?: () => string;
  icon?: ComponentType<{ className?: string }>;
  onSelect: () => void;
}

/** Composer toolbar slot extension (plan §4.2 #2): an extra control rendered
 *  beside the builtin control of one of the composer's three slots. */
export type ComposerSlotId = "addMenu" | "cliMenu" | "permissionMenu";

export interface ComposerSlotDef {
  id: string;
  slot: ComposerSlotId;
  component: ComponentType;
  /** Within-slot ordering; builtins are not part of the registry. */
  order?: number;
}

/** Chat right-panel tab (plan §4.2 #4). Builtin tabs (files/changes) are
 *  registered through the same registry and keep icon + label in the strip;
 *  plugin tabs render icon-only (label → title/accessible name) inside a
 *  PluginBoundary. */
export interface PanelTabDef {
  id: string;
  label: () => string;
  icon?: ComponentType<{ className?: string }>;
  component: ComponentType<{ workspacePath: string }>;
  order?: number;
}

/** App status bar item (plan §4.2 #8). The plugin owns its chip's look; the
 *  host only provides placement and the crash boundary. */
export interface StatusBarItemDef {
  id: string;
  component: ComponentType;
  order?: number;
  /** Placement zone (0.3.8): "start" renders left-aligned ahead of the
   *  builtin cluster; omitted/"end" keeps the legacy slot after the sync
   *  status, before the version. */
  zone?: "start" | "end";
}
/** Composer status-row item (0.3.9): a chip in the composer's status row
 *  (branch/context meter row), rendered in the left group after the branch
 *  switcher. Same ownership/boundary rules as StatusBarItemDef. */
export interface ComposerStatusItemDef {
  id: string;
  component: ComponentType;
  order?: number;
}

/** Persistent viewport content. The host does not control its placement. */
export interface OverlayDef {
  id: string;
  component: ComponentType;
  order?: number;
}

/** Command palette entry (plan §4.2 #9). */
export interface CommandDef {
  id: string;
  /** Resolved at palette render time so language flips re-title rows. */
  title: () => string;
  /** Extra match terms (aliases, pinyin) beyond the title. */
  keywords?: () => string[];
  run: () => void;
}

/** Session row the sidebar right-click menu was opened on. */
export interface SessionMenuTarget {
  engine: string;
  sessionId: string;
}

/** Sidebar session context-menu item: one extra row under the host's
 *  rename/copy/delete entries. `label` is a thunk so language flips
 *  re-label live menus. */
export interface SessionMenuItemDef {
  id: string;
  label: () => string;
  icon?: ComponentType<{ className?: string }>;
  danger?: boolean;
  run: (target: SessionMenuTarget) => void;
}

/** Markdown pipeline contributions (plan §4.2 #5): extra remark/rehype
 *  plugins and react-markdown component overrides, merged over the host
 *  defaults at render time. remark/rehype arrays are typed loosely — plugin
 *  bundles can't share the host's unified type identities across a blob
 *  import. */
export interface MarkdownRendererDef {
  id: string;
  remarkPlugins?: unknown[];
  rehypePlugins?: unknown[];
  components?: Components;
}

/** Plugin overlay page (plan §4.2 #10), reachable at `#/p/<id>` — the
 *  /settings overlay pattern generalized. Open by navigating (hash) or by
 *  registering a palette command that navigates. */
export interface PageDef {
  id: string;
  title: () => string;
  component: ComponentType;
}

/** Chat timeline row renderer for plugin-defined row kinds (plan §4.2 #5).
 *  The timeline dispatch consults this registry before the host's builtin
 *  kind switch, so a plugin can own the rendering of a row kind the host
 *  doesn't know. Custom-kind rows carry plugin-defined payloads — typed
 *  loosely because blob bundles can't share the host's TimelineRow type
 *  identity. */
export interface TimelineRowRendererDef {
  id: string;
  /** Row kind this renderer handles. Builtin kinds ("msg" / "process") are
   *  owned by the host switch; registering one only shadows it. */
  kind: string;
  component: ComponentType<{ row: { kind: string } }>;
}

export type WorkspaceMenuStatusTone = "success" | "muted";

export interface WorkspaceMenuLabel {
  text: string;
  status?: { text: string; tone: WorkspaceMenuStatusTone };
}

export type WorkspaceMenuLabelValue = string | WorkspaceMenuLabel;

/** Sidebar workspace row context-menu entry (generic extension point). The
 *  host renders its builtin entries (别名 / 归档) first and appends registry
 *  entries after a separator; an owner decides per workspace what it shows. */
export interface WorkspaceMenuItemDef {
  id: string;
  /** Resolved at menu-open time; receives the workspace the user right-clicked. */
  label: (ctx: { workspaceId: string; archived: boolean }) => WorkspaceMenuLabelValue;
  icon?: ComponentType<{ className?: string }>;
  /** Hidden when false; lets an owner scope its entry to some workspaces. */
  visible?: (ctx: { workspaceId: string; archived: boolean }) => boolean;
  onSelect: (ctx: { workspaceId: string; archived: boolean }) => void;
  order?: number;
}

/** Home sidebar nav entry (0.3.12): one row under the builtin 自动化 entry,
 *  rendering through the same chrome as the builtin nav items. `onOpen`
 *  typically opens the plugin's center tab (ctx.ui.openCenterTab). */
export interface SidebarNavEntryDef {
  id: string;
  label: () => string;
  icon?: ComponentType<{ className?: string }>;
  order?: number;
  onOpen: () => void;
}

/** Center-area tab definition (0.3.12): what a plugin can open as a tab in
 *  the center tab strip. Definitions live in this registry; open-tab
 *  INSTANCES are host-side runtime state (features/plugins/runtime/
 *  center-tabs.ts), created via ctx.ui.openCenterTab. */
export interface CenterTabDef {
  id: string;
  title: () => string;
  icon?: ComponentType<{ className?: string }>;
  component: ComponentType;
  order?: number;
}

// ---------------------------------------------------------------------------
// 注册表
// ---------------------------------------------------------------------------

/**
 * Extension-point registry. Host features and plugins register entries; UI
 * surfaces read them via `useRegistry`, which re-renders on every change.
 * Register is upsert semantics so HMR and plugin reloads never throw on
 * duplicates; a disposer only removes the exact entry it registered
 * (identity check), so a stale disposer can't evict a newer registration
 * under the same id.
 */
export class Registry<T extends { id: string }> {
  private entries = new Map<string, T>();
  private listeners = new Set<() => void>();
  private snapshot: readonly T[] = [];

  register(entry: T): Disposer {
    this.entries.set(entry.id, entry);
    this.emit();
    let disposed = false;
    return () => {
      if (disposed || this.entries.get(entry.id) !== entry) return;
      disposed = true;
      this.entries.delete(entry.id);
      this.emit();
    };
  }

  get(id: string): T | undefined {
    return this.entries.get(id);
  }

  getSnapshot = (): readonly T[] => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit() {
    this.snapshot = [...this.entries.values()];
    for (const listener of this.listeners) listener();
  }
}

export function useRegistry<T extends { id: string }>(registry: Registry<T>): readonly T[] {
  return useSyncExternalStore(registry.subscribe, registry.getSnapshot);
}

/** Settings nav/page registry (plan §4.2 #1). */
export const settingsRegistry = new Registry<SettingsSectionDef>();

/** Composer "Add" menu row registry (plan §4.2 #3). */
export const addMenuRegistry = new Registry<AddMenuRowDef>();

/** Composer toolbar slot registry (plan §4.2 #2). */
export const composerSlotRegistry = new Registry<ComposerSlotDef>();

/** Chat right-panel tab registry (plan §4.2 #4). */
export const panelTabRegistry = new Registry<PanelTabDef>();

/** App status bar item registry (plan §4.2 #8). */
export const statusBarRegistry = new Registry<StatusBarItemDef>();
/** Composer status-row item registry (0.3.9). */
export const composerStatusRegistry = new Registry<ComposerStatusItemDef>();

/** Non-modal viewport mounts, independent of the current route. */
export const overlayRegistry = new Registry<OverlayDef>();

/** Command palette registry (plan §4.2 #9). */
export const commandRegistry = new Registry<CommandDef>();

/** Sidebar session context-menu item registry. */
export const sessionMenuRegistry = new Registry<SessionMenuItemDef>();

/** Markdown pipeline registry (plan §4.2 #5). */
export const markdownRegistry = new Registry<MarkdownRendererDef>();

/** Plugin page registry (plan §4.2 #10); entries render at `#/p/<id>`. */
export const pageRegistry = new Registry<PageDef>();

/** Chat timeline row renderer registry (plan §4.2 #5). */
export const timelineRowRegistry = new Registry<TimelineRowRendererDef>();

/** Sidebar workspace row context-menu registry (generic extension point). */
export const workspaceMenuRegistry = new Registry<WorkspaceMenuItemDef>();
/** Home sidebar nav entries (0.3.12); rendered after the builtin 自动化 row. */
export const sidebarNavRegistry = new Registry<SidebarNavEntryDef>();

/** Center-area tab definitions (0.3.12). */
export const centerTabRegistry = new Registry<CenterTabDef>();
export const conversationModeRegistry = new Registry<ConversationModeDef>();

// ---------------------------------------------------------------------------
// 注册表 id / 排序辅助
// ---------------------------------------------------------------------------

/**
 * 插件在注册表里的条目 id：`plugin:<pluginId>`，带可选子键时
 * `plugin:<pluginId>:<key>`（与 ctx.ui.register* 的自动前缀规则一致）。
 */
export function scopedPluginId(pluginId: string, key?: string): string {
  return key ? `plugin:${pluginId}:${key}` : `plugin:${pluginId}`;
}

/**
 * scopedPluginId 的逆运算：从注册表条目 id 取回插件 id。
 * "plugin:foo:bar" → "foo"；"plugin:foo" → "foo"；非插件 id
 * （如内建条目 "files"）原样返回。
 */
export function pluginIdFromRegistryKey(registryId: string): string {
  if (!registryId.startsWith("plugin:")) return registryId;
  const rest = registryId.slice("plugin:".length);
  const sep = rest.indexOf(":");
  return sep === -1 ? rest : rest.slice(0, sep);
}

/**
 * 扩展点条目排序比较器：`order` 升序；`order` 缺省（undefined）按
 * Number.MAX_SAFE_INTEGER 处理——未声明顺序的条目永远排在声明过的之后；
 * order 相同（含双双缺省）时按 id 字典序兜底，保证排序稳定且与注册
 * 顺序无关。配合 `Array.prototype.sort` / `toSorted` 使用。
 */
export function compareByOrder<T extends { id: string; order?: number }>(a: T, b: T): number {
  const ao = a.order ?? Number.MAX_SAFE_INTEGER;
  const bo = b.order ?? Number.MAX_SAFE_INTEGER;
  if (ao !== bo) return ao - bo;
  return a.id.localeCompare(b.id);
}
