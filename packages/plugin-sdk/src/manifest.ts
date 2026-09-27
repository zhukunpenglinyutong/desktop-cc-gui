import type { PluginContext } from "./context";

/**
 * manifest（ccgui.plugin.json / release 的 manifest.json，plan §5.1）与
 * 基础类型。零运行时依赖（纯类型），Node 校验脚本可直接 import。
 */

/** Undo handle returned by every registration; unload runs them in reverse
 *  order of registration (cordis-style effect/dispose). */
export type Disposer = () => void;

/** Trust tiers (ADR-1). "declarative" bundles carry no JS. */
export type PluginTier = "declarative" | "js";

/** 插件入口唯一约定（ADR-5）：宿主动态 import main.js 后调用默认导出。 */
export type PluginActivate = (ctx: PluginContext) => void | (() => void);
/** Safe stable plugin id: total length 2..=64 bytes, dot-separated segments
 *  each matching `[a-z0-9][a-z0-9-]*` (first byte lowercase alphanumeric,
 *  the rest lowercase alphanumerics or hyphens). Empty/dot-only/path-like
 *  segments reject, as does a lone one-character id.
 *
 *  Kept byte-for-byte identical to Rust `is_valid_id`
 *  (src-tauri/src/plugins/manifest.rs) — ids double as directory names, so
 *  this is also the path-traversal guard. Shared vectors:
 *  spec/permissions.json `pluginIdShapes`. */
export function isValidPluginId(id: string): boolean {
  return (
    id.length >= 2 &&
    id.length <= 64 &&
    /^[a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)*$/.test(id)
  );
}


export interface PluginManifest {
  id: string;
  name: string;
  /** Semver 三段（x.y.z）。 */
  version: string;
  /** 要求的宿主最低版本。 */
  minAppVersion?: string;
  /** 要求的 SDK 版本区间（"^0.4" / "~0.4.0" / ">=0.4.0" / 精确 / "*"）。
   *  缺省 = "*"（不校验）。宿主 SDK 不满足时插件进入 incompatible 态。 */
  sdkVersion?: string;
  author?: string;
  description?: string;
  tier: PluginTier;
  /** 基座权限与 `network:`/`exec:` 授权；全集与形状规则见
   *  spec/permissions.json（单一事实源）。`network:none` 是基座权限
   *  （声明无网络），永远不是授权。 */
  permissions: string[];
  contributes?: {
    themes?: { name?: string; tokens: { light?: Record<string, string>; dark?: Record<string, string> } }[];
    i18n?: { lang: string; ns?: string; resources: Record<string, unknown> }[];
    /** Tier-0 static status-bar text chips (plan §5.1). Localize by
     *  pairing with an i18n bundle; JS plugins render their own component
     *  via ctx.ui.registerStatusBarItem instead. */
    statusBarItems?: { key?: string; text: string }[];
    /** Tier-0 palette commands; running one emits `emits` (default
     *  `plugin:<id>:command:<key>`) on the event bus so other plugins or
     *  the host can react. Anything richer needs a JS plugin. */
    commands?: { key: string; title: string; emits?: string }[];
  };
  /** JSON Schema object; the settings UI auto-renders a config form. */
  configSchema?: JsonSchemaObject;
  /** 市场展示用的方形图标：仓库内相对路径（推荐放 `docs/`，如
   *  `docs/icon.png`）或绝对 https URL。缺省 = 市场用插件名首字母瓷砖。
   *  面板页签没注册 `icon` 时也回落到它：市场安装会把索引品牌图按相对路径
   *  落到插件目录（发布包无需内含图片文件），绝对 URL 直接联网加载。 */
  icon?: string;
  /** 市场详情页的效果图：仓库内相对路径或绝对 https URL，≤ 5 张，按数组
   *  顺序展示。缺省 = 详情页不渲染图集。图片在插件仓库默认分支上按路径读取，
   *  换图无需发版。 */
  screenshots?: string[];
}

/** Subset of JSON Schema the declarative config form renders. */
export interface JsonSchemaObject {
  type: "object";
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

export interface JsonSchemaProperty {
  type?: "string" | "number" | "integer" | "boolean";
  title?: string;
  description?: string;
  default?: unknown;
  enum?: (string | number)[];
}
